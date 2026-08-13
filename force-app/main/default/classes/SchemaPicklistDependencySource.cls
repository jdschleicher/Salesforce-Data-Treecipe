/**
 * Production IPicklistDependencySource backed by Schema describe.
 *
 * Dependency data is read without a callout. Schema.PicklistEntry has no getValidFor()
 * accessor in Apex, but JSON.serialize(entry) does emit a "validFor" key: a base64-encoded
 * bitmap whose set bits are the indexes of the controlling values that unlock the entry.
 * Index order is the controlling field's own getPicklistValues() order — verified against
 * the UI API's controllerValues map, which reports identical indexes.
 *
 * A non-dependent picklist serializes validFor as null, which decodes to "valid for
 * nothing" rather than an error.
 *
 * This replaces an earlier ConnectApi.UiApi-based source: ConnectApi.UiApi does not exist
 * in Apex (deploy fails with "Variable does not exist: ConnectApi.UiApi"). The UI API is
 * reachable only as a REST callout, which would require Remote Site or Named Credential
 * setup and cannot run inside @IsTest at all. Describe has neither constraint.
 */
public with sharing class SchemaPicklistDependencySource implements IPicklistDependencySource {

    public class PicklistDependencyException extends Exception {}

    private static final Map<String, Integer> HEX_DIGIT_TO_VALUE = new Map<String, Integer>{
        '0' => 0, '1' => 1, '2' => 2, '3' => 3, '4' => 4, '5' => 5, '6' => 6, '7' => 7,
        '8' => 8, '9' => 9, 'a' => 10, 'b' => 11, 'c' => 12, 'd' => 13, 'e' => 14, 'f' => 15
    };

    public PicklistDependencySnapshot fetch(PicklistDependencySpec spec) {

        if (spec.recordTypeDeveloperName != null) {
            throw new PicklistDependencyException(
                'Record-type-scoped specs are not supported by the describe-based source. '
                    + 'Schema describe exposes no record-type-aware picklist values; '
                    + 'remove .forRecordType("' + spec.recordTypeDeveloperName + '") from this spec.'
            );
        }

        Schema.DescribeFieldResult dependentDescribe = describeField(spec.objectApiName, spec.fieldApiName);
        Schema.SObjectField controllerToken = dependentDescribe.getController();

        if (controllerToken == null) {
            throw new PicklistDependencyException(
                spec.objectApiName + '.' + spec.fieldApiName + ' is not a dependent picklist '
                    + '(the org reports no controlling field).'
            );
        }

        Schema.DescribeFieldResult controllingDescribe = controllerToken.getDescribe();

        PicklistDependencySnapshot snapshot = new PicklistDependencySnapshot();
        snapshot.objectApiName = spec.objectApiName;
        snapshot.fieldApiName = spec.fieldApiName;
        snapshot.controllingFieldApiName = controllingDescribe.getName();

        List<String> controllingValues = controllingValuesInIndexOrder(controllingDescribe);
        for (Integer index = 0; index < controllingValues.size(); index++) {
            snapshot.controllerValues.put(controllingValues[index], index);
        }

        for (Schema.PicklistEntry entry : dependentDescribe.getPicklistValues()) {
            snapshot.dependentValueValidFor.put(
                entry.getValue(),
                decodeValidForIndexes(validForOf(entry), controllingValues.size())
            );
        }

        return snapshot;
    }

    /**
     * Checkbox controlling fields report no picklist values; their controlling values are
     * the literal strings "true" and "false", indexed in that order.
     */
    private static List<String> controllingValuesInIndexOrder(Schema.DescribeFieldResult controllingDescribe) {

        if (controllingDescribe.getType() == Schema.DisplayType.BOOLEAN) {
            return new List<String>{ 'true', 'false' };
        }

        List<String> controllingValues = new List<String>();
        for (Schema.PicklistEntry entry : controllingDescribe.getPicklistValues()) {
            controllingValues.add(entry.getValue());
        }
        return controllingValues;
    }

    private static Schema.DescribeFieldResult describeField(String objectApiName, String fieldApiName) {

        Schema.SObjectType objectType = Schema.getGlobalDescribe().get(objectApiName);
        if (objectType == null) {
            throw new PicklistDependencyException('Unknown object "' + objectApiName + '".');
        }

        Schema.SObjectField fieldToken = objectType.getDescribe().fields.getMap().get(fieldApiName);
        if (fieldToken == null) {
            throw new PicklistDependencyException(
                'Field "' + objectApiName + '.' + fieldApiName + '" was not found. It may not exist, '
                    + 'or the running user may lack field-level security on it — an invisible field is '
                    + 'absent from describe entirely.'
            );
        }

        return fieldToken.getDescribe();
    }

    /**
     * Schema.PicklistEntry exposes no getValidFor() in Apex, but serializes one.
     */
    @TestVisible
    private static String validForOf(Schema.PicklistEntry entry) {
        Map<String, Object> serialized = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(entry));
        Object validFor = serialized.get('validFor');
        return validFor == null ? null : String.valueOf(validFor);
    }

    /**
     * Decodes a base64 validFor bitmap into the controlling-value indexes it marks.
     *
     * Bits are most-significant-first: index 0 is the high bit of the first byte. Decoding
     * proceeds a hex nibble at a time, so bit i lives in nibble i/4 at position 3 - (i mod 4).
     *
     * @param validForBase64 the serialized bitmap; null or blank for a non-dependent picklist
     * @param controllingValueCount how many controlling values exist; bits beyond this are
     *        padding and are ignored
     */
    @TestVisible
    private static List<Integer> decodeValidForIndexes(String validForBase64, Integer controllingValueCount) {

        List<Integer> indexes = new List<Integer>();

        if (String.isBlank(validForBase64) || controllingValueCount == null || controllingValueCount <= 0) {
            return indexes;
        }

        String hex = EncodingUtil.convertToHex(EncodingUtil.base64Decode(validForBase64)).toLowerCase();

        for (Integer index = 0; index < controllingValueCount; index++) {

            Integer nibbleIndex = index / 4;
            if (nibbleIndex >= hex.length()) {
                break;
            }

            Integer nibble = HEX_DIGIT_TO_VALUE.get(hex.substring(nibbleIndex, nibbleIndex + 1));
            if (nibble == null) {
                continue;
            }

            if (((nibble >> (3 - Math.mod(index, 4))) & 1) == 1) {
                indexes.add(index);
            }
        }

        return indexes;
    }
}
