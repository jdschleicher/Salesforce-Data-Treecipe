/**
 * Compares a set of PicklistDependencySpecs against org reality (via an
 * IPicklistDependencySource) and returns the mismatches.
 *
 * Never throws on a mismatch: a bad or unreachable spec becomes a Failure so a single
 * broken spec cannot hide the results of the others. Each source exception is caught per
 * spec and reported as LOOKUP_ERROR, and the remaining specs are still validated.
 */
public class PicklistDependencyValidator {

    public enum FailureKind {
        MISSING_VALUES,
        UNEXPECTED_VALUES,
        UNKNOWN_CONTROLLING_VALUE,
        CONTROLLING_FIELD_MISMATCH,
        LOOKUP_ERROR
    }

    public class Failure {
        public String objectApiName;
        public String fieldApiName;
        public String controllingValue;
        public FailureKind kind;
        public String message;
        public List<String> details;

        public Failure(PicklistDependencySpec spec, String controllingValue, FailureKind kind, String message, List<String> details) {
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
                scope += ' @ "' + controllingValue + '"';
            }
            return kind.name() + ' — ' + scope + ': ' + message;
        }
    }

    private final IPicklistDependencySource source;

    public PicklistDependencyValidator(IPicklistDependencySource source) {
        this.source = source;
    }

    public List<Failure> validate(List<PicklistDependencySpec> specs) {
        List<Failure> failures = new List<Failure>();
        if (specs == null) {
            return failures;
        }
        for (PicklistDependencySpec spec : specs) {
            failures.addAll(validateSpec(spec));
        }
        return failures;
    }

    private List<Failure> validateSpec(PicklistDependencySpec spec) {

        List<Failure> failures = new List<Failure>();

        PicklistDependencySnapshot snapshot;
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
                'Spec declares controlling field "' + spec.controllingFieldApiName
                    + '" but org reports "' + snapshot.controllingFieldApiName + '"',
                new List<String>{ snapshot.controllingFieldApiName }
            ));
            return failures;
        }

        for (PicklistDependencySpec.Expectation expectation : spec.expectations) {

            Set<String> actual = snapshot.valuesValidFor(expectation.controllingValue);

            if (actual == null) {
                List<String> orgControllingValues = sortedList(snapshot.controllingValues());
                failures.add(new Failure(
                    spec,
                    expectation.controllingValue,
                    FailureKind.UNKNOWN_CONTROLLING_VALUE,
                    'Controlling value not found in org; org reports: ['
                        + String.join(orgControllingValues, ', ') + ']',
                    orgControllingValues
                ));
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

            if (expectation.mode == PicklistDependencySpec.MatchMode.EXACTLY) {
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
