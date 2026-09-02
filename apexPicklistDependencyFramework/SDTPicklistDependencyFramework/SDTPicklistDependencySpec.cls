/**
 * Fluent description of the picklist-dependency combinations expected to exist in an org.
 *
 * One spec targets one dependent picklist (object + field) and its controlling field, and
 * carries one expectation per controlling value.
 *
 * A spec is either field level (forField) or record-type scoped (forRecordType). A record-type
 * scoped spec narrows the same combinations to what one record type assigns, and asserting it
 * needs a source that can read record-type-filtered picklist values. Schema describe cannot:
 * SDTSchemaPicklistDependencySource rejects a record-type scoped spec rather than answering it
 * with field-level data, which would report a scope it never checked as green. The generated
 * SDTPLDSpecs keeps them out of all() for that reason and exposes them through
 * allRecordTypeScoped(), ready for a record-type aware ISDTPicklistDependencySource.
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
 *   - expectUnavailable : the controlling value must NOT be available at all. Only meaningful
 *                      for a record-type scoped spec, where a controlling value the record type
 *                      does not assign is absent rather than empty -- expectNone would demand
 *                      the value exist and so would fail on exactly the metadata that is
 *                      correct. This is the record-type equivalent of expectNone.
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
 *
 *   SDTPicklistDependencySpec.forRecordType('Account', 'Region__c', 'US_Only')
 *       .controlledBy('Country__c')
 *       .expectAtLeast('United States', new List<String>{ 'West' })
 *       .expectUnavailable('Canada');
 */
public class SDTPicklistDependencySpec {

    public enum MatchMode { EXACTLY, AT_LEAST, NOT_ALLOWED, UNAVAILABLE }

    public class Expectation {
        public String controllingValue;
        public MatchMode mode;

        /** Values the controlling value must unlock. Empty for NOT_ALLOWED and UNAVAILABLE. */
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
     * The record type this spec's combinations are scoped to, or null for a field-level spec.
     * Part of label(), so a field's field-level spec and its record-type scoped ones are distinct
     * to the validator rather than collapsing onto one another.
     */
    public String recordTypeDeveloperName;

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

    /**
     * A spec covering only the combinations one record type exposes. The expectations are the
     * field-level ones narrowed by that record type's picklist assignments, so they can only ever
     * be a subset of what forField would assert for the same field.
     */
    public static SDTPicklistDependencySpec forRecordType(String objectApiName, String fieldApiName, String recordTypeDeveloperName) {
        SDTPicklistDependencySpec spec = new SDTPicklistDependencySpec(objectApiName, fieldApiName);
        spec.recordTypeDeveloperName = recordTypeDeveloperName;
        return spec;
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

    /**
     * The controlling value must not be reachable at all under this spec's scope.
     *
     * A record type that does not assign a controlling value does not expose it as an empty
     * choice -- it does not expose it. Asserting that with expectNone would fail against a
     * faithful record-type aware source, because expectNone requires the value to exist.
     */
    public SDTPicklistDependencySpec expectUnavailable(String controllingValue) {
        expectations.add(new Expectation(controllingValue, MatchMode.UNAVAILABLE, null, null));
        return this;
    }

    public Boolean isRecordTypeScoped() {
        return recordTypeDeveloperName != null;
    }

    public String label() {
        String fieldLabel = objectApiName + '.' + fieldApiName;
        return isRecordTypeScoped() ? fieldLabel + ' [' + recordTypeDeveloperName + ']' : fieldLabel;
    }

    private static Set<String> toSet(List<String> values) {
        Set<String> result = new Set<String>();
        if (values != null) {
            result.addAll(values);
        }
        return result;
    }
}
