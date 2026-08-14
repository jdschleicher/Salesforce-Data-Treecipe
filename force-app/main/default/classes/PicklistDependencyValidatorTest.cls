@IsTest
private class PicklistDependencyValidatorTest {

    private static final String OBJ = 'Account';
    private static final String FIELD = 'Region__c';
    private static final String CONTROLLING = 'Country__c';

    private static PicklistDependencySnapshot regionSnapshot() {
        PicklistDependencySnapshot snapshot = new PicklistDependencySnapshot();
        snapshot.objectApiName = OBJ;
        snapshot.fieldApiName = FIELD;
        snapshot.controllingFieldApiName = CONTROLLING;
        snapshot.controllerValues = new Map<String, Integer>{
            'United States' => 0,
            'Canada' => 1,
            'Mexico' => 2
        };
        snapshot.dependentValueValidFor = new Map<String, List<Integer>>{
            'West' => new List<Integer>{ 0 },
            'East' => new List<Integer>{ 0 },
            'Ontario' => new List<Integer>{ 1 },
            'Quebec' => new List<Integer>{ 1 }
        };
        return snapshot;
    }

    @IsTest
    static void snapshotDecodesValidForIndexes() {
        PicklistDependencySnapshot snapshot = regionSnapshot();

        Assert.areEqual(new Set<String>{ 'West', 'East' }, snapshot.valuesValidFor('United States'),
            'United States should unlock West and East');
        Assert.areEqual(new Set<String>(), snapshot.valuesValidFor('Mexico'),
            'Mexico exists but unlocks nothing -> empty set, not null');
        Assert.isNull(snapshot.valuesValidFor('Brazil'),
            'A controlling value the org does not have -> null');
    }

    @IsTest
    static void expectAtLeastPassesWhenOrgIsSuperset() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'expectAtLeast tolerates org-added values');
    }

    @IsTest
    static void expectAtLeastReportsMissingValues() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West', 'Central' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'one missing value should produce one failure');
        Assert.areEqual(PicklistDependencyValidator.FailureKind.MISSING_VALUES, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Central' }, failures[0].details, 'only the missing value is reported');
    }

    @IsTest
    static void expectExactlyPassesOnExactMatch() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectExactly('United States', new List<String>{ 'West', 'East' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'exact expectation matches the org exactly');
    }

    @IsTest
    static void expectExactlyReportsUnexpectedValues() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectExactly('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'exact mode flags org values not in the expectation');
        Assert.areEqual(PicklistDependencyValidator.FailureKind.UNEXPECTED_VALUES, failures[0].kind);
        Assert.areEqual(new List<String>{ 'East' }, failures[0].details);
    }

    @IsTest
    static void expectNonePassesWhenControllingValueUnlocksNothing() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectNone('Mexico');

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'Mexico unlocks nothing, so expectNone passes');
    }

    @IsTest
    static void expectNoneFailsWhenControllingValueUnlocksSomething() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectNone('United States');

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'United States unlocks values, so expectNone fails');
        Assert.areEqual(PicklistDependencyValidator.FailureKind.UNEXPECTED_VALUES, failures[0].kind);
    }

    @IsTest
    static void unknownControllingValueIsReportedWithOrgValues() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('Brazil', new List<String>{ 'Amazonas' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(PicklistDependencyValidator.FailureKind.UNKNOWN_CONTROLLING_VALUE, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Canada', 'Mexico', 'United States' }, failures[0].details,
            'the controlling values the org actually reports, sorted');
    }

    @IsTest
    static void controllingFieldMismatchIsReported() {
        PicklistDependencySnapshot snapshot = regionSnapshot();
        snapshot.controllingFieldApiName = 'Region_Category__c';

        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, snapshot);

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'a mismatched controlling field short-circuits the spec');
        Assert.areEqual(PicklistDependencyValidator.FailureKind.CONTROLLING_FIELD_MISMATCH, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Region_Category__c' }, failures[0].details);
    }

    @IsTest
    static void sourceExceptionBecomesLookupErrorAndDoesNotAbortOtherSpecs() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withException(OBJ, 'Broken__c', new StubPicklistDependencySource.StubSourceException('boom'))
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        PicklistDependencySpec broken = PicklistDependencySpec.forField(OBJ, 'Broken__c')
            .expectAtLeast('United States', new List<String>{ 'West' });
        PicklistDependencySpec healthy = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ broken, healthy });

        Assert.areEqual(1, failures.size(), 'the healthy spec still validates after the broken one throws');
        Assert.areEqual(PicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
        Assert.areEqual('Broken__c', failures[0].fieldApiName);
    }

    @IsTest
    static void sourceMessageIsCarriedOntoTheLookupErrorFailure() {
        StubPicklistDependencySource source = new StubPicklistDependencySource()
            .withException(OBJ, FIELD, new StubPicklistDependencySource.StubSourceException('is not a dependent picklist'));

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(PicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
        Assert.areEqual('is not a dependent picklist', failures[0].message,
            'the source message is what tells the reader why the spec could not be resolved');
    }

    @IsTest
    static void nullSnapshotSurfacesAsLookupError() {
        StubPicklistDependencySource source = new StubPicklistDependencySource();

        PicklistDependencySpec spec = PicklistDependencySpec.forField(OBJ, 'Never_Registered__c')
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<PicklistDependencyValidator.Failure> failures =
            new PicklistDependencyValidator(source).validate(new List<PicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(PicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
    }

    @IsTest
    static void reportSummarisesPassAndFail() {
        List<PicklistDependencySpec> specs = new List<PicklistDependencySpec>{
            PicklistDependencySpec.forField(OBJ, FIELD)
        };

        PicklistDependencyReport passing = PicklistDependencyReport.build(specs, new List<PicklistDependencyValidator.Failure>());
        Assert.isFalse(passing.hasFailures());
        Assert.isTrue(passing.resultMarker().endsWith('PASS'));

        List<PicklistDependencyValidator.Failure> failures = new List<PicklistDependencyValidator.Failure>{
            new PicklistDependencyValidator.Failure(specs[0], 'United States',
                PicklistDependencyValidator.FailureKind.MISSING_VALUES, 'missing', new List<String>{ 'West' })
        };
        PicklistDependencyReport failing = PicklistDependencyReport.build(specs, failures);
        Assert.isTrue(failing.hasFailures());
        Assert.isTrue(failing.resultMarker().endsWith('FAIL'));
        Assert.isTrue(failing.toDisplayString().contains('MISSING_VALUES'));
    }
}
