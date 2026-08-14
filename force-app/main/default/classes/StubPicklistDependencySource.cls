/**
 * Test double for IPicklistDependencySource. Lets PicklistDependencyValidatorTest drive
 * the decode and match-mode logic with hand-built snapshots, without ConnectApi (which
 * behaves like a callout inside @IsTest and cannot read a real org).
 *
 * Keyed by "Object.Field". Register a snapshot with withSnapshot, or an exception with
 * withException to exercise the LOOKUP_ERROR path.
 */
@IsTest
public class StubPicklistDependencySource implements IPicklistDependencySource {

    public class StubSourceException extends Exception {}

    private final Map<String, PicklistDependencySnapshot> snapshotsByField = new Map<String, PicklistDependencySnapshot>();
    private final Map<String, Exception> exceptionsByField = new Map<String, Exception>();

    public StubPicklistDependencySource withSnapshot(String objectApiName, String fieldApiName, PicklistDependencySnapshot snapshot) {
        snapshotsByField.put(key(objectApiName, fieldApiName), snapshot);
        return this;
    }

    public StubPicklistDependencySource withException(String objectApiName, String fieldApiName, Exception thrownException) {
        exceptionsByField.put(key(objectApiName, fieldApiName), thrownException);
        return this;
    }

    public PicklistDependencySnapshot fetch(PicklistDependencySpec spec) {
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
