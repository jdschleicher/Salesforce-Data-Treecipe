/**
 * Test double for ISDTPicklistDependencySource. Lets SDTPicklistDependencyValidatorTest drive
 * the decode and match-mode logic with hand-built snapshots, without ConnectApi (which
 * behaves like a callout inside @IsTest and cannot read a real org).
 *
 * Keyed by "Object.Field". Register a snapshot with withSnapshot, or an exception with
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

    public SDTStubPicklistDependencySource withException(String objectApiName, String fieldApiName, Exception thrownException) {
        exceptionsByField.put(key(objectApiName, fieldApiName), thrownException);
        return this;
    }

    public SDTPicklistDependencySnapshot fetch(SDTPicklistDependencySpec spec) {
        String fieldKey = key(spec.objectApiName, spec.fieldApiName);
        if (exceptionsByField.containsKey(fieldKey)) {
            throw exceptionsByField.get(fieldKey);
        }
        return snapshotsByField.get(fieldKey);
    }

    private String key(String objectApiName, String fieldApiName) {
        return objectApiName + '.' + fieldApiName;
    }
}
