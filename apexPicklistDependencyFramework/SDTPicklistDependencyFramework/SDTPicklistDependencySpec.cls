/**
 * Fluent description of the picklist-dependency combinations expected to exist in an org.
 *
 * One spec targets one dependent picklist (object + field) and its controlling field, and
 * carries one expectation per controlling value.
 *
 * Specs are not record-type scoped. Schema describe exposes no record-type-aware picklist
 * values, so the describe-based source could not honour such a scope; rather than offer a
 * builder method that always fails, none is provided.
 *
 * Match modes are per controlling-value line, not per spec:
 *   - expectAtLeast  : the controlling value must unlock AT LEAST the listed values
 *                      (org-added values are tolerated). This is what the generator emits.
 *   - expectNotAllowed : the controlling value must unlock NONE of the listed values. The
 *                      generator emits the complement of expectAtLeast -- every value the
 *                      dependent field declares that this controlling value does not unlock.
 *                      Together the two catch a value being removed from a combination AND a
 *                      value drifting into one, without expectExactly's intolerance of values
 *                      the org has legitimately added since generation.
 *   - expectExactly  : the controlling value must unlock EXACTLY the listed values
 *                      (a deliberate tightening by the spec owner).
 *   - expectNone     : the controlling value must exist and unlock nothing.
 *
 * dependsOn links a spec to the spec for its controlling field, where that field is itself a
 * dependent picklist. The validator reports a break at its source rather than once per
 * downstream link -- see SDTPicklistDependencyValidator.
 *
 * Example:
 *   SDTPicklistDependencySpec.forField('Account', 'Region__c')
 *       .controlledBy('Country__c')
 *       .expectAtLeast('United States', new List<String>{ 'West', 'East' })
 *       .expectNotAllowed('United States', new List<String>{ 'Ontario', 'Quebec' })
 *       .expectNone('Antarctica');
 */
public class SDTPicklistDependencySpec {

    public enum MatchMode { EXACTLY, AT_LEAST, NOT_ALLOWED }

    public class Expectation {
        public String controllingValue;
        public MatchMode mode;

        /** Values the controlling value must unlock. Empty for NOT_ALLOWED. */
        public Set<String> expectedValues;

        /** Values the controlling value must NOT unlock. Empty for every mode but NOT_ALLOWED. */
        public Set<String> forbiddenValues;

        public Expectation(String controllingValue, MatchMode mode, Set<String> expectedValues, Set<String> forbiddenValues) {
            this.controllingValue = controllingValue;
            this.mode = mode;
            this.expectedValues = expectedValues == null ? new Set<String>() : expectedValues;
            this.forbiddenValues = forbiddenValues == null ? new Set<String>() : forbiddenValues;
        }
    }

    public String objectApiName;
    public String fieldApiName;
    public String controllingFieldApiName;
    public List<Expectation> expectations;

    /**
     * The spec for this spec's controlling field, when that field is itself a dependent
     * picklist. Null for the root of a chain, which is the common case.
     */
    public SDTPicklistDependencySpec upstreamSpec;

    private SDTPicklistDependencySpec(String objectApiName, String fieldApiName) {
        this.objectApiName = objectApiName;
        this.fieldApiName = fieldApiName;
        this.expectations = new List<Expectation>();
    }

    public static SDTPicklistDependencySpec forField(String objectApiName, String fieldApiName) {
        return new SDTPicklistDependencySpec(objectApiName, fieldApiName);
    }

    public SDTPicklistDependencySpec controlledBy(String controllingFieldApiName) {
        this.controllingFieldApiName = controllingFieldApiName;
        return this;
    }

    public SDTPicklistDependencySpec dependsOn(SDTPicklistDependencySpec upstreamSpec) {
        this.upstreamSpec = upstreamSpec;
        return this;
    }

    public SDTPicklistDependencySpec expectExactly(String controllingValue, List<String> values) {
        expectations.add(new Expectation(controllingValue, MatchMode.EXACTLY, toSet(values), null));
        return this;
    }

    public SDTPicklistDependencySpec expectAtLeast(String controllingValue, List<String> values) {
        expectations.add(new Expectation(controllingValue, MatchMode.AT_LEAST, toSet(values), null));
        return this;
    }

    public SDTPicklistDependencySpec expectNotAllowed(String controllingValue, List<String> values) {
        expectations.add(new Expectation(controllingValue, MatchMode.NOT_ALLOWED, null, toSet(values)));
        return this;
    }

    public SDTPicklistDependencySpec expectNone(String controllingValue) {
        expectations.add(new Expectation(controllingValue, MatchMode.EXACTLY, new Set<String>(), null));
        return this;
    }

    public String label() {
        return objectApiName + '.' + fieldApiName;
    }

    private static Set<String> toSet(List<String> values) {
        Set<String> result = new Set<String>();
        if (values != null) {
            result.addAll(values);
        }
        return result;
    }
}
