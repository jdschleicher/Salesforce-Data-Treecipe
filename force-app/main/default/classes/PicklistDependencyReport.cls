/**
 * Formats a validator run into a human-readable report and a machine-readable result
 * marker for the CI runner. Emitted from anonymous Apex; the Node runner keys its exit
 * code off the RESULT_MARKER line.
 */
public class PicklistDependencyReport {

    public static final String RESULT_MARKER = 'PICKLIST_DEPENDENCY_CHECK_RESULT=';

    public Integer specCount;
    public Integer failureCount;
    public List<PicklistDependencyValidator.Failure> failures;

    private PicklistDependencyReport(Integer specCount, List<PicklistDependencyValidator.Failure> failures) {
        this.specCount = specCount;
        this.failures = failures == null ? new List<PicklistDependencyValidator.Failure>() : failures;
        this.failureCount = this.failures.size();
    }

    public static PicklistDependencyReport build(List<PicklistDependencySpec> specs, List<PicklistDependencyValidator.Failure> failures) {
        Integer count = specs == null ? 0 : specs.size();
        return new PicklistDependencyReport(count, failures);
    }

    public Boolean hasFailures() {
        return failureCount > 0;
    }

    public String resultMarker() {
        return RESULT_MARKER + (hasFailures() ? 'FAIL' : 'PASS');
    }

    public String toDisplayString() {

        List<String> lines = new List<String>();
        lines.add('Picklist Dependency Check');
        lines.add('  specs checked: ' + specCount);
        lines.add('  failures:      ' + failureCount);

        if (hasFailures()) {
            lines.add('');
            for (PicklistDependencyValidator.Failure failure : failures) {
                lines.add('  - ' + failure.toLine());
            }
        } else {
            lines.add('  all expected picklist dependency combinations still valid');
        }

        return String.join(lines, '\n');
    }
}
