/**
 * Fluent description of the picklist-dependency combinations expected to exist in an org.
 *
 * One spec targets one dependent picklist (object + field), optionally scoped to a record
 * type and its controlling field, and carries one expectation per controlling value.
 *
 * Match modes are per controlling-value line, not per spec:
 *   - expectAtLeast : the controlling value must unlock AT LEAST the listed values
 *                     (org-added values are tolerated). This is what the generator emits.
 *   - expectExactly : the controlling value must unlock EXACTLY the listed values
 *                     (a deliberate tightening by the spec owner).
 *   - expectNone    : the controlling value must exist and unlock nothing.
 *
 * Example:
 *   PicklistDependencySpec.forField('Account', 'Region__c')
 *       .controlledBy('Country__c')
 *       .expectAtLeast('United States', new List<String>{ 'West', 'East' })
 *       .expectNone('Antarctica');
 */
public class PicklistDependencySpec {

    public enum MatchMode { EXACTLY, AT_LEAST }

    public class Expectation {
        public String controllingValue;
        public MatchMode mode;
        public Set<String> expectedValues;

        public Expectation(String controllingValue, MatchMode mode, Set<String> expectedValues) {
            this.controllingValue = controllingValue;
            this.mode = mode;
            this.expectedValues = expectedValues == null ? new Set<String>() : expectedValues;
        }
    }

    public String objectApiName;
    public String fieldApiName;
    public String controllingFieldApiName;
    public String recordTypeDeveloperName;
    public List<Expectation> expectations;

    private PicklistDependencySpec(String objectApiName, String fieldApiName) {
        this.objectApiName = objectApiName;
        this.fieldApiName = fieldApiName;
        this.expectations = new List<Expectation>();
    }

    public static PicklistDependencySpec forField(String objectApiName, String fieldApiName) {
        return new PicklistDependencySpec(objectApiName, fieldApiName);
    }

    public PicklistDependencySpec controlledBy(String controllingFieldApiName) {
        this.controllingFieldApiName = controllingFieldApiName;
        return this;
    }

    public PicklistDependencySpec forRecordType(String recordTypeDeveloperName) {
        this.recordTypeDeveloperName = recordTypeDeveloperName;
        return this;
    }

    public PicklistDependencySpec expectExactly(String controllingValue, List<String> values) {
        expectations.add(new Expectation(controllingValue, MatchMode.EXACTLY, toSet(values)));
        return this;
    }

    public PicklistDependencySpec expectAtLeast(String controllingValue, List<String> values) {
        expectations.add(new Expectation(controllingValue, MatchMode.AT_LEAST, toSet(values)));
        return this;
    }

    public PicklistDependencySpec expectNone(String controllingValue) {
        expectations.add(new Expectation(controllingValue, MatchMode.EXACTLY, new Set<String>()));
        return this;
    }

    public String label() {
        String base = objectApiName + '.' + fieldApiName;
        return recordTypeDeveloperName == null ? base : base + ' [' + recordTypeDeveloperName + ']';
    }

    private static Set<String> toSet(List<String> values) {
        Set<String> result = new Set<String>();
        if (values != null) {
            result.addAll(values);
        }
        return result;
    }
}
