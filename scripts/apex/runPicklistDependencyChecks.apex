// Anonymous Apex entry point for the picklist dependency check.
//
// Runs every spec in PicklistDependencySpecs.all() against the target org via
// ConnectApiPicklistDependencySource and prints a report plus a machine-readable
// RESULT marker (PICKLIST_DEPENDENCY_CHECK_RESULT=PASS|FAIL) that the Node runner
// keys its exit code off of. ConnectApi reads only work outside @IsTest, which is
// why verification lives here rather than in an Apex unit test.

List<PicklistDependencySpec> specs = PicklistDependencySpecs.all();

PicklistDependencyValidator validator =
    new PicklistDependencyValidator(new ConnectApiPicklistDependencySource());

List<PicklistDependencyValidator.Failure> failures = validator.validate(specs);

PicklistDependencyReport report = PicklistDependencyReport.build(specs, failures);

System.debug(LoggingLevel.ERROR, '\n' + report.toDisplayString());
System.debug(LoggingLevel.ERROR, report.resultMarker());
