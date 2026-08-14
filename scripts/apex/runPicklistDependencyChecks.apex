// Anonymous Apex entry point for the picklist dependency check.
//
// Runs every spec in PicklistDependencySpecs.all() against the target org via
// SchemaPicklistDependencySource and prints a report plus a machine-readable RESULT
// marker (PICKLIST_DEPENDENCY_CHECK_RESULT=PASS|FAIL|EMPTY) that the Node runner keys
// its exit code off of.
//
// The describe-based source works inside @IsTest too, so this script is not the only
// way to run the check — but as anonymous Apex it needs no deploy of a test class and
// reports against the org's real metadata.

List<PicklistDependencySpec> specs = PicklistDependencySpecs.all();

PicklistDependencyValidator validator =
    new PicklistDependencyValidator(new SchemaPicklistDependencySource());

List<PicklistDependencyValidator.Failure> failures = validator.validate(specs);

PicklistDependencyReport report = PicklistDependencyReport.build(specs, failures);

System.debug(LoggingLevel.ERROR, '\n' + report.toDisplayString());
System.debug(LoggingLevel.ERROR, report.resultMarker());
