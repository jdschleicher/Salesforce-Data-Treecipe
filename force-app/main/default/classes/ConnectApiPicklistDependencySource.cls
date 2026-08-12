/**
 * Production IPicklistDependencySource backed by the UI API.
 *
 * ConnectApi.UiApi.getPicklistValues is the only Apex-reachable surface that exposes
 * dependency data — Schema.PicklistEntry.getValidFor() is not available in Apex. It
 * returns controllerValues (controlling value -> bit index) and per-value validFor
 * (the controlling indexes each dependent value is valid for), which this class
 * translates into a plain PicklistDependencySnapshot at the boundary.
 *
 * ConnectApi calls behave like callouts inside @IsTest, so this class cannot be unit
 * tested against a real org; the decode and match-mode logic is covered by
 * PicklistDependencyValidatorTest via a stubbed source. Verification against a live org
 * runs as anonymous Apex (scripts/apex/runPicklistDependencyChecks.apex).
 */
public with sharing class ConnectApiPicklistDependencySource implements IPicklistDependencySource {

    /** The seeded id of the master record type, valid for every object. */
    public static final String MASTER_RECORD_TYPE_ID = '012000000000000AAA';

    public class PicklistDependencyException extends Exception {}

    public PicklistDependencySnapshot fetch(PicklistDependencySpec spec) {

        String recordTypeId = resolveRecordTypeId(spec);

        // NOTE: confirm the exact argument order against the target API version; the
        // ConnectApi surface is deliberately isolated here so a signature change is a
        // one-line edit that never reaches the validator or its tests.
        ConnectApi.PicklistValues picklistValues = ConnectApi.UiApi.getPicklistValues(
            recordTypeId,
            spec.objectApiName,
            spec.fieldApiName
        );

        return translate(spec, picklistValues);
    }

    private PicklistDependencySnapshot translate(PicklistDependencySpec spec, ConnectApi.PicklistValues picklistValues) {

        PicklistDependencySnapshot snapshot = new PicklistDependencySnapshot();
        snapshot.objectApiName = spec.objectApiName;
        snapshot.fieldApiName = spec.fieldApiName;
        snapshot.controllingFieldApiName = describeControllingField(spec);

        if (picklistValues != null && picklistValues.controllerValues != null) {
            snapshot.controllerValues = new Map<String, Integer>(picklistValues.controllerValues);
        }

        if (picklistValues != null && picklistValues.values != null) {
            for (ConnectApi.PicklistValue picklistValue : picklistValues.values) {
                List<Integer> validFor = picklistValue.validFor == null
                    ? new List<Integer>()
                    : new List<Integer>(picklistValue.validFor);
                snapshot.dependentValueValidFor.put(picklistValue.value, validFor);
            }
        }

        return snapshot;
    }

    private String describeControllingField(PicklistDependencySpec spec) {

        Schema.SObjectType objectType = Schema.getGlobalDescribe().get(spec.objectApiName);
        if (objectType == null) {
            return null;
        }

        Schema.SObjectField fieldToken = objectType.getDescribe().fields.getMap().get(spec.fieldApiName);
        if (fieldToken == null) {
            return null;
        }

        Schema.SObjectField controller = fieldToken.getDescribe().getController();
        return controller == null ? null : controller.getDescribe().getName();
    }

    private String resolveRecordTypeId(PicklistDependencySpec spec) {

        if (spec.recordTypeDeveloperName == null) {
            return MASTER_RECORD_TYPE_ID;
        }

        List<RecordType> recordTypes = [
            SELECT Id
            FROM RecordType
            WHERE SObjectType = :spec.objectApiName
                AND DeveloperName = :spec.recordTypeDeveloperName
            LIMIT 1
        ];

        if (recordTypes.isEmpty()) {
            throw new PicklistDependencyException(
                'No record type "' + spec.recordTypeDeveloperName + '" found on ' + spec.objectApiName
            );
        }

        return recordTypes[0].Id;
    }
}
