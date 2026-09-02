/**
 * Test double for ISDTPicklistDependencySource. Lets SDTPicklistDependencyValidatorTest drive
 * the decode and match-mode logic with hand-built snapshots, without ConnectApi (which
 * behaves like a callout inside @IsTest and cannot read a real org).
 *
 * Keyed by the spec's label, so "Object.Field" for a field-level spec and
 * "Object.Field [RecordType]" for a record-type scoped one. A record-type scoped spec falls back
 * to the field-level snapshot when no scoped one is registered, which keeps a test that only cares
 * about scoping from having to restate the org state.
 *
 * Register a snapshot with withSnapshot or withRecordTypeSnapshot, or an exception with
 * withException to exercise the LOOKUP_ERROR path.
 */
@IsTest
public class SDTStubPicklistDependencySource implements ISDTPicklistDependencySource {

    public class StubSourceException extends Exception {}

    private final Map<String, SDTPicklistDependencySnapshot> snapshotsByField = new Map<String, SDTPicklistDependencySnapshot>();
    private final Map<String, Exception> exceptionsByField = new Map<String, Exception>();

    public SDTStubPicklistDependencySource withSnapshot(String objectApiName, String fieldApiName, SDTPicklistDependencySnapshot snapshot) {
        snapshotsByField.put(key(objectApiName, fieldApiName), snapshot);
        return this;
    }

    public SDTStubPicklistDependencySource withRecordTypeSnapshot(String objectApiName, String fieldApiName,
                                                                    String recordTypeDeveloperName, SDTPicklistDependencySnapshot snapshot) {
        snapshotsByField.put(recordTypeKey(objectApiName, fieldApiName, recordTypeDeveloperName), snapshot);
        return this;
    }

    public SDTStubPicklistDependencySource withException(String objectApiName, String fieldApiName, Exception thrownException) {
        exceptionsByField.put(key(objectApiName, fieldApiName), thrownException);
        return this;
    }

    public SDTPicklistDependencySnapshot fetch(SDTPicklistDependencySpec spec) {

        String fieldKey = key(spec.objectApiName, spec.fieldApiName);
        if (exceptionsByField.containsKey(fieldKey)) {
            throw exceptionsByField.get(fieldKey);
        }

        if (spec.isRecordTypeScoped()) {
            String scopedKey = recordTypeKey(spec.objectApiName, spec.fieldApiName, spec.recordTypeDeveloperName);
            if (snapshotsByField.containsKey(scopedKey)) {
                return snapshotsByField.get(scopedKey);
            }
        }

        return snapshotsByField.get(fieldKey);
    }

    private String key(String objectApiName, String fieldApiName) {
        return objectApiName + '.' + fieldApiName;
    }

    private String recordTypeKey(String objectApiName, String fieldApiName, String recordTypeDeveloperName) {
        return key(objectApiName, fieldApiName) + ' [' + recordTypeDeveloperName + ']';
    }
}
