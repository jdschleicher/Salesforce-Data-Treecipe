// Anonymous Apex entry point for the picklist dependency check.
//
// Runs every spec in SDTPLDSpecs.all() against the target org via
// SDTSchemaPicklistDependencySource and prints a report plus a machine-readable RESULT
// marker (PICKLIST_DEPENDENCY_CHECK_RESULT=PASS|FAIL|EMPTY) that the Node runner keys
// its exit code off of.
//
// The describe-based source works inside @IsTest too, so this script is not the only
// way to run the check — but as anonymous Apex it needs no deploy of a test class and
// reports against the org's real metadata.

List<SDTPicklistDependencySpec> specs = SDTPLDSpecs.all();

SDTPicklistDependencyValidator validator =
    new SDTPicklistDependencyValidator(new SDTSchemaPicklistDependencySource());

List<SDTPicklistDependencyValidator.Failure> failures = validator.validate(specs);

SDTPicklistDependencyReport report = SDTPicklistDependencyReport.build(specs, failures);

System.debug(LoggingLevel.ERROR, '\n' + report.toDisplayString());
System.debug(LoggingLevel.ERROR, report.resultMarker());
