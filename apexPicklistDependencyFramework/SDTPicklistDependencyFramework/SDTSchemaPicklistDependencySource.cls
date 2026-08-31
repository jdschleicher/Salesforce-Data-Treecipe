/**
 * Production ISDTPicklistDependencySource backed by Schema describe.
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
 *
 * Governor limits: the validator runs every spec in ONE transaction, so all per-spec work
 * here is multiplied by the spec count against a shared 10,000 ms CPU and 6 MB heap budget.
 * Reading via describe costs no SOQL and no callouts, which leaves CPU as the binding limit.
 * The describe lookups dominate it and are cached below.
 *
 * Measured in a scratch org. Each figure is CPU for the DESCRIBE RESOLUTION ALONE (not a full
 * fetch, which also decodes bitmaps), timed in its own transaction:
 *
 *   63 distinct fields on one object : ~827 ms uncached -> ~25 ms cached
 *   the same field 100 times         : ~1130 ms uncached -> ~70 ms cached
 *
 * The distinct-field case is the realistic one — a spec registry holds one spec per dependent
 * field — and it gains MORE, not less, because getGlobalDescribe() is the dominant term and is
 * paid once rather than per spec. Caching therefore hands back roughly a tenth of the whole
 * transaction budget.
 *
 * Heap: ~43 KB for one object with its field describes retained. That figure is PER OBJECT and
 * does not generalize — FIELD_MAPS_BY_OBJECT grows with the number of DISTINCT objects in the
 * spec list, so a registry spanning many objects trades CPU for monotonically growing heap
 * against the 6 MB limit. Revisit if a registry ever spans dozens of objects.
 */
public with sharing class SDTSchemaPicklistDependencySource implements ISDTPicklistDependencySource {

    public class PicklistDependencyException extends Exception {}

    private static final Map<String, Integer> HEX_DIGIT_TO_VALUE = new Map<String, Integer>{
        '0' => 0, '1' => 1, '2' => 2, '3' => 3, '4' => 4, '5' => 5, '6' => 6, '7' => 7,
        '8' => 8, '9' => 9, 'a' => 10, 'b' => 11, 'c' => 12, 'd' => 13, 'e' => 14, 'f' => 15
    };

    /**
     * Per-transaction describe caches.
     *
     * Schema.getGlobalDescribe() is one of the most expensive calls in Apex — it materializes
     * every SObject token in the org — and the field map behind it is rebuilt per object. Both
     * were previously recomputed on every fetch, so a run of N specs paid them N times for an
     * identical answer. Static caches live for the transaction, which is exactly the scope of
     * one validator run.
     *
     * DESCRIBES_BY_TOKEN is keyed on the Schema.SObjectField token rather than an
     * "Object.Field" string on purpose. A controlling field is reached through
     * getController(), which yields a token and no name — naming it would require the very
     * getDescribe() the cache exists to avoid. Keying on the token covers the dependent and
     * controlling paths with one map, and dedupes for free when one spec's controlling field
     * is another spec's dependent field.
     *
     * Object keys are lower-cased because Apex Map<String, ...> compares case-sensitively
     * while describe resolves case-insensitively; without it, specs written 'account' and
     * 'Account' would each get their own entry holding the same field map.
     *
     * NOTE: statics are per-transaction, so these cannot go stale from an admin edit (Metadata
     * API deploys are async) and cannot leak between users in production (one user per
     * transaction). The one exception is System.runAs, which switches running user WITHIN a
     * test transaction and does affect describe/FLS — a cache warmed before a runAs block
     * would be reused inside it. Any future FLS-variant test must call clearCaches() between
     * runAs blocks or it will assert against the previous user's describe and pass falsely.
     */
    private static Map<String, Schema.SObjectType> globalDescribeCache;
    private static final Map<String, Map<String, Schema.SObjectField>> FIELD_MAPS_BY_OBJECT =
        new Map<String, Map<String, Schema.SObjectField>>();
    private static final Map<Schema.SObjectField, Schema.DescribeFieldResult> DESCRIBES_BY_TOKEN =
        new Map<Schema.SObjectField, Schema.DescribeFieldResult>();

    @TestVisible
    private static void clearCaches() {
        globalDescribeCache = null;
        FIELD_MAPS_BY_OBJECT.clear();
        DESCRIBES_BY_TOKEN.clear();
    }

    /**
     * Deliberately does NOT memoize the assembled snapshot by object.field. A spec is one per
     * (object, field) and carries many expectations, so two specs resolving the same field is
     * redundant by construction rather than the normal case — a snapshot cache would add
     * staleness surface and retained heap to serve a workload that a well-formed registry does
     * not produce. The describe caching above is what the realistic distinct-field workload
     * actually benefits from. Revisit only if duplicate specs become legitimate.
     */
    public SDTPicklistDependencySnapshot fetch(SDTPicklistDependencySpec spec) {

        Schema.DescribeFieldResult dependentDescribe = describeField(spec.objectApiName, spec.fieldApiName);
        Schema.SObjectField controllerToken = dependentDescribe.getController();

        if (controllerToken == null) {
            throw new PicklistDependencyException(
                spec.objectApiName + '.' + spec.fieldApiName + ' is not a dependent picklist '
                    + '(the org reports no controlling field).'
            );
        }

        Schema.DescribeFieldResult controllingDescribe = describeOf(controllerToken);

        SDTPicklistDependencySnapshot snapshot = new SDTPicklistDependencySnapshot();
        snapshot.objectApiName = spec.objectApiName;
        snapshot.fieldApiName = spec.fieldApiName;
        snapshot.controllingFieldApiName = controllingDescribe.getName();

        List<String> controllingValues = controllingValuesInIndexOrder(controllingDescribe);
        for (Integer index = 0; index < controllingValues.size(); index++) {
            snapshot.controllerValues.put(controllingValues[index], index);
        }

        for (Schema.PicklistEntry entry : dependentDescribe.getPicklistValues()) {

            String validFor = validForOf(entry);

            // Past the getController() guard above, this field IS dependent, so every entry
            // must carry a bitmap — a value valid for nothing still serializes as all-zero
            // bits, not null. An absent key therefore means the serialization this class
            // relies on has changed, not that the org lost its dependencies. Failing loudly
            // here keeps that from surfacing as MISSING_VALUES on every spec, which reads
            // like an admin deleted the dependency configuration.
            if (validFor == null) {
                throw new PicklistDependencyException(
                    'No "validFor" key in the serialized PicklistEntry for '
                        + spec.objectApiName + '.' + spec.fieldApiName + ' value "' + entry.getValue() + '", '
                        + 'even though the org reports this field as dependent. '
                        + 'Schema.PicklistEntry exposes validFor only through JSON serialization, which is '
                        + 'undocumented — this most likely means that serialization contract has changed.'
                );
            }

            snapshot.dependentValueValidFor.put(
                entry.getValue(),
                decodeValidForIndexes(validFor, controllingValues.size())
            );
        }

        return snapshot;
    }

    /**
     * Checkbox controlling fields report no picklist values of their own, so their
     * controlling values are supplied here.
     *
     * The order is FALSE first, then TRUE, and that is not arbitrary — getting it backwards
     * silently inverts every result for a checkbox-controlled picklist. Verified against a
     * live org: for a picklist where Gold/Silver require the checkbox CHECKED and Direct
     * requires it UNCHECKED, Gold and Silver serialize validFor as "QAAA" (0x40, bit index
     * 1) while Direct serializes as "gAAA" (0x80, bit index 0). The UI API reports the same
     * mapping: controllerValues = {"false": 0, "true": 1}.
     *
     * Note the metadata API spells these values "checked" / "unchecked" in valueSettings,
     * but describe and the UI API both key them as "true" / "false", which is what a spec
     * must use.
     */
    @TestVisible
    private static List<String> controllingValuesInIndexOrder(Schema.DescribeFieldResult controllingDescribe) {

        if (controllingDescribe.getType() == Schema.DisplayType.BOOLEAN) {
            return new List<String>{ 'false', 'true' };
        }

        List<String> controllingValues = new List<String>();
        for (Schema.PicklistEntry entry : controllingDescribe.getPicklistValues()) {
            controllingValues.add(entry.getValue());
        }
        return controllingValues;
    }

    @TestVisible
    private static Schema.DescribeFieldResult describeField(String objectApiName, String fieldApiName) {

        // fields.getMap() resolves case-insensitively, so no key normalization is needed here.
        Schema.SObjectField fieldToken = fieldMapFor(objectApiName).get(fieldApiName);
        if (fieldToken == null) {
            throw new PicklistDependencyException(
                'Field "' + objectApiName + '.' + fieldApiName + '" was not found. It may not exist, '
                    + 'or the running user may lack field-level security on it — an invisible field is '
                    + 'absent from describe entirely.'
            );
        }

        return describeOf(fieldToken);
    }

    private static Schema.DescribeFieldResult describeOf(Schema.SObjectField fieldToken) {

        Schema.DescribeFieldResult fieldDescribe = DESCRIBES_BY_TOKEN.get(fieldToken);
        if (fieldDescribe == null) {
            fieldDescribe = fieldToken.getDescribe();
            DESCRIBES_BY_TOKEN.put(fieldToken, fieldDescribe);
        }
        return fieldDescribe;
    }

    private static Map<String, Schema.SObjectField> fieldMapFor(String objectApiName) {

        String objectKey = objectApiName == null ? null : objectApiName.toLowerCase();

        if (FIELD_MAPS_BY_OBJECT.containsKey(objectKey)) {
            return FIELD_MAPS_BY_OBJECT.get(objectKey);
        }

        if (globalDescribeCache == null) {
            globalDescribeCache = Schema.getGlobalDescribe();
        }

        Schema.SObjectType objectType = globalDescribeCache.get(objectApiName);
        if (objectType == null) {
            throw new PicklistDependencyException('Unknown object "' + objectApiName + '".');
        }

        Map<String, Schema.SObjectField> fieldMap = objectType.getDescribe().fields.getMap();
        FIELD_MAPS_BY_OBJECT.put(objectKey, fieldMap);
        return fieldMap;
    }

    /**
     * Schema.PicklistEntry exposes no getValidFor() in Apex, but serializes one.
     *
     * Batching this per field rather than per entry looks like an obvious win — it is not, and
     * was measured and rejected. Serializing one 32-entry list is no cheaper than serializing
     * 32 entries: ~500 ms either way for 100 specs x 32 entries, with run-to-run noise larger
     * than the difference, because JSON cost tracks bytes rather than call count. Batching only
     * bought a positional-alignment failure mode.
     *
     * That ~500 ms is the JSON WORK ALONE across 3,200 entries and is not comparable to the
     * describe figures in the class header, which time describe resolution alone. Neither is a
     * whole-fetch measurement. Do not read one against the other.
     *
     * This is not the worst-scaling term in the class: JSON scales as O(dependent values) while
     * decodeValidForIndexes below scales as O(dependent values x controlling values), so the
     * decode overtakes it as the controlling picklist grows.
     *
     * Leave it per entry unless a measurement in a fresh transaction says otherwise — measuring
     * successive approaches within ONE transaction does not, as each block there runs slower
     * than the last regardless of what it does.
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
