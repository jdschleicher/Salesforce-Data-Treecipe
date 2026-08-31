/**
 * Compares a set of SDTPicklistDependencySpec against org reality (via an
 * ISDTPicklistDependencySource) and returns the mismatches.
 *
 * Never throws on a mismatch: a bad or unreachable spec becomes a Failure so a single
 * broken spec cannot hide the results of the others. Each source exception is caught per
 * spec and reported as LOOKUP_ERROR, and the remaining specs are still validated.
 *
 * Chained dependencies are resolved through SDTPicklistDependencySpec.upstreamSpec. When a
 * spec's controlling field is itself a broken dependent picklist, repeating the same describe
 * mismatch once per downstream link buries the one fact that matters, so the break is reported
 * at its source and each downstream spec gets a single UPSTREAM_FAILURE naming it.
 */
public class SDTPicklistDependencyValidator {

    public enum FailureKind {
        MISSING_VALUES,
        UNEXPECTED_VALUES,
        FORBIDDEN_VALUES_PRESENT,
        UNKNOWN_CONTROLLING_VALUE,
        CONTROLLING_FIELD_MISMATCH,
        UPSTREAM_FAILURE,
        CIRCULAR_DEPENDENCY,
        LOOKUP_ERROR
    }

    public class Failure {
        public String objectApiName;
        public String fieldApiName;
        public String controllingValue;
        public FailureKind kind;
        public String message;
        public List<String> details;

        public Failure(SDTPicklistDependencySpec spec, String controllingValue, FailureKind kind, String message, List<String> details) {
            this.objectApiName = spec.objectApiName;
            this.fieldApiName = spec.fieldApiName;
            this.controllingValue = controllingValue;
            this.kind = kind;
            this.message = message;
            this.details = details == null ? new List<String>() : details;
        }

        public String toLine() {
            String scope = objectApiName + '.' + fieldApiName;
            if (controllingValue != null) {
                scope += ' @ ' + controllingValue;
            }
            return kind.name() + ' — ' + scope + ': ' + message;
        }
    }

    private final ISDTPicklistDependencySource source;

    /*
        An upstream spec is validated on demand rather than being required in the caller's list:
        a chain can cross objects, and the generated test class validates one object at a time.
        Results are memoized so a controlling field shared by several dependent picklists costs
        one describe rather than one per dependent.
    */
    private Map<String, List<Failure>> failuresBySpecLabel;
    private Set<String> specLabelsBeingValidated;

    public SDTPicklistDependencyValidator(ISDTPicklistDependencySource source) {
        this.source = source;
    }

    public List<Failure> validate(List<SDTPicklistDependencySpec> specs) {

        failuresBySpecLabel = new Map<String, List<Failure>>();
        specLabelsBeingValidated = new Set<String>();

        List<Failure> failures = new List<Failure>();
        if (specs == null) {
            return failures;
        }

        // A LABEL ALREADY REPORTED IS NOT REPORTED AGAIN, SO A SPEC LISTED TWICE YIELDS ONE SET OF FAILURES
        Set<String> reportedSpecLabels = new Set<String>();

        for (SDTPicklistDependencySpec spec : specs) {
            if (spec == null || reportedSpecLabels.contains(spec.label())) {
                continue;
            }
            reportedSpecLabels.add(spec.label());
            failures.addAll(resolveFailures(spec));
        }

        return failures;
    }

    private List<Failure> resolveFailures(SDTPicklistDependencySpec spec) {

        String specLabel = spec.label();

        /*
            Salesforce cannot express a cyclic picklist dependency, but a hand-edited dependsOn
            chain can, and unguarded recursion would exhaust the stack instead of reporting it.
        */
        if (specLabelsBeingValidated.contains(specLabel)) {
            return new List<Failure>{
                new Failure(spec, null, FailureKind.CIRCULAR_DEPENDENCY,
                    'Spec participates in a circular dependsOn chain and cannot be validated', null)
            };
        }

        if (failuresBySpecLabel.containsKey(specLabel)) {
            return failuresBySpecLabel.get(specLabel);
        }

        specLabelsBeingValidated.add(specLabel);

        List<Failure> failures;
        try {
            failures = resolveUpstreamThenOwnFailures(spec);
        } finally {
            specLabelsBeingValidated.remove(specLabel);
        }

        failuresBySpecLabel.put(specLabel, failures);
        return failures;
    }

    private List<Failure> resolveUpstreamThenOwnFailures(SDTPicklistDependencySpec spec) {

        if (spec.upstreamSpec != null) {

            List<Failure> upstreamFailures = resolveFailures(spec.upstreamSpec);

            if (!upstreamFailures.isEmpty()) {
                return new List<Failure>{
                    new Failure(spec, null, FailureKind.UPSTREAM_FAILURE,
                        'Controlling field spec ' + spec.upstreamSpec.label() + ' failed ('
                            + upstreamFailures[0].kind.name() + '), so this spec was not evaluated. '
                            + 'Fix ' + spec.upstreamSpec.label() + ' first.',
                        new List<String>{ spec.upstreamSpec.label() })
                };
            }
        }

        return validateSpec(spec);
    }

    private List<Failure> validateSpec(SDTPicklistDependencySpec spec) {

        List<Failure> failures = new List<Failure>();

        SDTPicklistDependencySnapshot snapshot;
        try {
            snapshot = source.fetch(spec);
        } catch (Exception e) {
            failures.add(new Failure(spec, null, FailureKind.LOOKUP_ERROR, e.getMessage(), null));
            return failures;
        }

        if (snapshot == null) {
            failures.add(new Failure(spec, null, FailureKind.LOOKUP_ERROR, 'Source returned no snapshot for this field', null));
            return failures;
        }

        if (spec.controllingFieldApiName != null
                && snapshot.controllingFieldApiName != null
                && !spec.controllingFieldApiName.equalsIgnoreCase(snapshot.controllingFieldApiName)) {

            failures.add(new Failure(
                spec,
                null,
                FailureKind.CONTROLLING_FIELD_MISMATCH,
                'Spec declares controlling field ' + spec.controllingFieldApiName
                    + ' but the org has ' + snapshot.controllingFieldApiName,
                new List<String>{ snapshot.controllingFieldApiName }
            ));
            return failures;
        }

        for (SDTPicklistDependencySpec.Expectation expectation : spec.expectations) {

            Set<String> actual = snapshot.valuesValidFor(expectation.controllingValue);

            if (actual == null) {
                List<String> orgControllingValues = sortedList(snapshot.controllingValues());
                failures.add(new Failure(
                    spec,
                    expectation.controllingValue,
                    FailureKind.UNKNOWN_CONTROLLING_VALUE,
                    'Controlling value not found in the org; the org has: ['
                        + String.join(orgControllingValues, ', ') + ']',
                    orgControllingValues
                ));
                continue;
            }

            if (expectation.mode == SDTPicklistDependencySpec.MatchMode.NOT_ALLOWED) {

                Set<String> present = new Set<String>(actual);
                present.retainAll(expectation.forbiddenValues);

                if (!present.isEmpty()) {
                    List<String> presentList = sortedList(present);
                    failures.add(new Failure(
                        spec,
                        expectation.controllingValue,
                        FailureKind.FORBIDDEN_VALUES_PRESENT,
                        'Org unlocks values this controlling value must not unlock: ['
                            + String.join(presentList, ', ') + ']',
                        presentList
                    ));
                }

                continue;
            }

            Set<String> missing = new Set<String>(expectation.expectedValues);
            missing.removeAll(actual);
            if (!missing.isEmpty()) {
                List<String> missingList = sortedList(missing);
                failures.add(new Failure(
                    spec,
                    expectation.controllingValue,
                    FailureKind.MISSING_VALUES,
                    'Expected values no longer valid: [' + String.join(missingList, ', ') + ']',
                    missingList
                ));
            }

            if (expectation.mode == SDTPicklistDependencySpec.MatchMode.EXACTLY) {
                Set<String> unexpected = new Set<String>(actual);
                unexpected.removeAll(expectation.expectedValues);
                if (!unexpected.isEmpty()) {
                    List<String> unexpectedList = sortedList(unexpected);
                    failures.add(new Failure(
                        spec,
                        expectation.controllingValue,
                        FailureKind.UNEXPECTED_VALUES,
                        'Org exposes values not in the exact expectation: ['
                            + String.join(unexpectedList, ', ') + ']',
                        unexpectedList
                    ));
                }
            }
        }

        return failures;
    }

    private static List<String> sortedList(Set<String> values) {
        List<String> result = new List<String>(values);
        result.sort();
        return result;
    }
}
