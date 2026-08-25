/**
 * Formats a validator run into a human-readable report and a machine-readable result
 * marker for the CI runner. Emitted from anonymous Apex; the Node runner keys its exit
 * code off the RESULT_MARKER line.
 */
public class SDTPicklistDependencyReport {

    public static final String RESULT_MARKER = 'PICKLIST_DEPENDENCY_CHECK_RESULT=';

    public Integer specCount;
    public Integer failureCount;
    public List<SDTPicklistDependencyValidator.Failure> failures;

    private SDTPicklistDependencyReport(Integer specCount, List<SDTPicklistDependencyValidator.Failure> failures) {
        this.specCount = specCount;
        this.failures = failures == null ? new List<SDTPicklistDependencyValidator.Failure>() : failures;
        this.failureCount = this.failures.size();
    }

    public static SDTPicklistDependencyReport build(List<SDTPicklistDependencySpec> specs, List<SDTPicklistDependencyValidator.Failure> failures) {
        Integer count = specs == null ? 0 : specs.size();
        return new SDTPicklistDependencyReport(count, failures);
    }

    public Boolean hasFailures() {
        return failureCount > 0;
    }

    /**
     * An empty registry would otherwise report PASS and exit 0, turning the CI gate into a
     * green check that verified nothing. EMPTY is reported distinctly so the runner can
     * fail loudly instead.
     */
    public Boolean isEmpty() {
        return specCount == 0;
    }

    public String resultMarker() {
        if (isEmpty()) {
            return RESULT_MARKER + 'EMPTY';
        }
        return RESULT_MARKER + (hasFailures() ? 'FAIL' : 'PASS');
    }

    public String toDisplayString() {

        List<String> lines = new List<String>();
        lines.add('Picklist Dependency Check');
        lines.add('  specs checked: ' + specCount);
        lines.add('  failures:      ' + failureCount);

        if (isEmpty()) {
            lines.add('  no specs registered — SDTPicklistDependencySpecs.all() returned nothing,');
            lines.add('  so this run verified nothing. Add specs by hand or generate them.');
        } else if (hasFailures()) {
            lines.add('');
            for (SDTPicklistDependencyValidator.Failure failure : failures) {
                lines.add('  - ' + failure.toLine());
            }
        } else {
            lines.add('  all expected picklist dependency combinations still valid');
        }

        return String.join(lines, '\n');
    }
}
