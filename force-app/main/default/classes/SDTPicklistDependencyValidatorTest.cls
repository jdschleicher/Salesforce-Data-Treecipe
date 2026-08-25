@IsTest
private class SDTPicklistDependencyValidatorTest {

    private static final String OBJ = 'Account';
    private static final String FIELD = 'Region__c';
    private static final String CONTROLLING = 'Country__c';

    private static SDTPicklistDependencySnapshot regionSnapshot() {
        SDTPicklistDependencySnapshot snapshot = new SDTPicklistDependencySnapshot();
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
        SDTPicklistDependencySnapshot snapshot = regionSnapshot();

        Assert.areEqual(new Set<String>{ 'West', 'East' }, snapshot.valuesValidFor('United States'),
            'United States should unlock West and East');
        Assert.areEqual(new Set<String>(), snapshot.valuesValidFor('Mexico'),
            'Mexico exists but unlocks nothing -> empty set, not null');
        Assert.isNull(snapshot.valuesValidFor('Brazil'),
            'A controlling value the org does not have -> null');
    }

    @IsTest
    static void expectAtLeastPassesWhenOrgIsSuperset() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'expectAtLeast tolerates org-added values');
    }

    @IsTest
    static void expectAtLeastReportsMissingValues() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West', 'Central' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'one missing value should produce one failure');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.MISSING_VALUES, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Central' }, failures[0].details, 'only the missing value is reported');
    }

    @IsTest
    static void expectExactlyPassesOnExactMatch() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectExactly('United States', new List<String>{ 'West', 'East' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'exact expectation matches the org exactly');
    }

    @IsTest
    static void expectExactlyReportsUnexpectedValues() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectExactly('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'exact mode flags org values not in the expectation');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UNEXPECTED_VALUES, failures[0].kind);
        Assert.areEqual(new List<String>{ 'East' }, failures[0].details);
    }

    @IsTest
    static void expectNonePassesWhenControllingValueUnlocksNothing() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectNone('Mexico');

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'Mexico unlocks nothing, so expectNone passes');
    }

    @IsTest
    static void expectNoneFailsWhenControllingValueUnlocksSomething() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectNone('United States');

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'United States unlocks values, so expectNone fails');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UNEXPECTED_VALUES, failures[0].kind);
    }

    @IsTest
    static void unknownControllingValueIsReportedWithOrgValues() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('Brazil', new List<String>{ 'Amazonas' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UNKNOWN_CONTROLLING_VALUE, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Canada', 'Mexico', 'United States' }, failures[0].details,
            'the controlling values the org actually reports, sorted');
    }

    @IsTest
    static void controllingFieldMismatchIsReported() {
        SDTPicklistDependencySnapshot snapshot = regionSnapshot();
        snapshot.controllingFieldApiName = 'Region_Category__c';

        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, snapshot);

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'a mismatched controlling field short-circuits the spec');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.CONTROLLING_FIELD_MISMATCH, failures[0].kind);
        Assert.areEqual(new List<String>{ 'Region_Category__c' }, failures[0].details);
    }

    @IsTest
    static void sourceExceptionBecomesLookupErrorAndDoesNotAbortOtherSpecs() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withException(OBJ, 'Broken__c', new SDTStubPicklistDependencySource.StubSourceException('boom'))
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec broken = SDTPicklistDependencySpec.forField(OBJ, 'Broken__c')
            .expectAtLeast('United States', new List<String>{ 'West' });
        SDTPicklistDependencySpec healthy = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ broken, healthy });

        Assert.areEqual(1, failures.size(), 'the healthy spec still validates after the broken one throws');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
        Assert.areEqual('Broken__c', failures[0].fieldApiName);
    }

    @IsTest
    static void sourceMessageIsCarriedOntoTheLookupErrorFailure() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withException(OBJ, FIELD, new SDTStubPicklistDependencySource.StubSourceException('is not a dependent picklist'));

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
        Assert.areEqual('is not a dependent picklist', failures[0].message,
            'the source message is what tells the reader why the spec could not be resolved');
    }

    @IsTest
    static void nullSnapshotSurfacesAsLookupError() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource();

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, 'Never_Registered__c')
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size());
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.LOOKUP_ERROR, failures[0].kind);
    }

    @IsTest
    static void expectNotAllowedPassesWhenNoForbiddenValueIsUnlocked() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West', 'East' })
            .expectNotAllowed('United States', new List<String>{ 'Ontario', 'Quebec' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'United States unlocks neither Ontario nor Quebec');
    }

    @IsTest
    static void expectNotAllowedReportsOnlyTheForbiddenValuesActuallyUnlocked() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectNotAllowed('United States', new List<String>{ 'East', 'Ontario' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'a value drifting into the combination is one failure');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.FORBIDDEN_VALUES_PRESENT, failures[0].kind);
        Assert.areEqual(new List<String>{ 'East' }, failures[0].details,
            'Ontario is genuinely not unlocked, so only East is reported');
        Assert.areEqual('United States', failures[0].controllingValue);
    }

    /*
        The whole point of the complement over expectExactly: a value the org has gained since the
        specs were generated is not in the forbidden list, so it passes rather than failing the run.
    */
    @IsTest
    static void expectNotAllowedToleratesAValueTheOrgAddedAfterGeneration() {
        SDTPicklistDependencySnapshot snapshot = regionSnapshot();
        snapshot.dependentValueValidFor.put('Central', new List<Integer>{ 0 });

        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, snapshot);

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'West', 'East' })
            .expectNotAllowed('United States', new List<String>{ 'Ontario', 'Quebec' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(0, failures.size(), 'a newly added org value is tolerated, unlike under expectExactly');
    }

    @IsTest
    static void expectNotAllowedOnAnUnknownControllingValueIsReportedAsUnknownRatherThanPassing() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectNotAllowed('Brazil', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec });

        Assert.areEqual(1, failures.size(), 'a missing controlling value must not pass by unlocking nothing');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UNKNOWN_CONTROLLING_VALUE, failures[0].kind);
    }

    private static SDTPicklistDependencySnapshot countrySnapshot() {
        SDTPicklistDependencySnapshot snapshot = new SDTPicklistDependencySnapshot();
        snapshot.objectApiName = OBJ;
        snapshot.fieldApiName = CONTROLLING;
        snapshot.controllerValues = new Map<String, Integer>{ 'North America' => 0 };
        snapshot.dependentValueValidFor = new Map<String, List<Integer>>{
            'United States' => new List<Integer>{ 0 },
            'Canada' => new List<Integer>{ 0 }
        };
        return snapshot;
    }

    @IsTest
    static void aHealthyChainValidatesBothLinks() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, CONTROLLING, countrySnapshot())
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec countrySpec = SDTPicklistDependencySpec.forField(OBJ, CONTROLLING)
            .expectAtLeast('North America', new List<String>{ 'United States', 'Canada' });

        SDTPicklistDependencySpec regionSpec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .dependsOn(countrySpec)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ countrySpec, regionSpec });

        Assert.areEqual(0, failures.size(), 'both links are intact');
    }

    /*
        The break is reported once, where it is -- the downstream spec gets a pointer to it rather
        than a second copy of the same describe mismatch.
    */
    @IsTest
    static void aBrokenUpstreamIsReportedAtItsSourceAndPointedAtFromDownstream() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, CONTROLLING, countrySnapshot())
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec countrySpec = SDTPicklistDependencySpec.forField(OBJ, CONTROLLING)
            .expectAtLeast('North America', new List<String>{ 'United States', 'Mexico' });

        SDTPicklistDependencySpec regionSpec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .controlledBy(CONTROLLING)
            .dependsOn(countrySpec)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ countrySpec, regionSpec });

        Assert.areEqual(2, failures.size(), 'one failure at the source, one pointer from downstream');

        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.MISSING_VALUES, failures[0].kind,
            'the upstream break is reported as what it actually is');
        Assert.areEqual(CONTROLLING, failures[0].fieldApiName);

        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UPSTREAM_FAILURE, failures[1].kind);
        Assert.areEqual(FIELD, failures[1].fieldApiName);
        Assert.areEqual(new List<String>{ OBJ + '.' + CONTROLLING }, failures[1].details,
            'the downstream failure names the spec to fix first');
    }

    /*
        A chain can cross into a field the caller did not list -- the generated test class validates
        one object at a time -- so the upstream must be resolved on demand rather than assumed present.
    */
    @IsTest
    static void anUpstreamNotInTheValidatedListIsStillResolved() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, CONTROLLING, countrySnapshot())
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec countrySpec = SDTPicklistDependencySpec.forField(OBJ, CONTROLLING)
            .expectAtLeast('North America', new List<String>{ 'Mexico' });

        SDTPicklistDependencySpec regionSpec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .dependsOn(countrySpec)
            .expectAtLeast('United States', new List<String>{ 'West' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ regionSpec });

        Assert.areEqual(1, failures.size(), 'only the listed spec is reported on');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UPSTREAM_FAILURE, failures[0].kind);
    }

    @IsTest
    static void aCircularDependsOnChainIsReportedRatherThanRecursingForever() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, CONTROLLING, countrySnapshot())
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec countrySpec = SDTPicklistDependencySpec.forField(OBJ, CONTROLLING)
            .expectAtLeast('North America', new List<String>{ 'United States' });

        SDTPicklistDependencySpec regionSpec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .dependsOn(countrySpec)
            .expectAtLeast('United States', new List<String>{ 'West' });

        // ONLY A HAND EDITED SPEC CAN DO THIS -- SALESFORCE CANNOT EXPRESS A CYCLIC DEPENDENCY
        countrySpec.dependsOn(regionSpec);

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ regionSpec });

        Assert.isFalse(failures.isEmpty(), 'the cycle is reported rather than exhausting the stack');
        Assert.areEqual(SDTPicklistDependencyValidator.FailureKind.UPSTREAM_FAILURE, failures[0].kind,
            'the listed spec reports that its controlling field could not be validated');
    }

    @IsTest
    static void aSpecListedTwiceIsReportedOnce() {
        SDTStubPicklistDependencySource source = new SDTStubPicklistDependencySource()
            .withSnapshot(OBJ, FIELD, regionSnapshot());

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField(OBJ, FIELD)
            .expectAtLeast('United States', new List<String>{ 'Central' });

        List<SDTPicklistDependencyValidator.Failure> failures =
            new SDTPicklistDependencyValidator(source).validate(new List<SDTPicklistDependencySpec>{ spec, spec });

        Assert.areEqual(1, failures.size(), 'the same spec twice is still one set of failures');
    }

    @IsTest
    static void reportSummarisesPassAndFail() {
        List<SDTPicklistDependencySpec> specs = new List<SDTPicklistDependencySpec>{
            SDTPicklistDependencySpec.forField(OBJ, FIELD)
        };

        SDTPicklistDependencyReport passing = SDTPicklistDependencyReport.build(specs, new List<SDTPicklistDependencyValidator.Failure>());
        Assert.isFalse(passing.hasFailures());
        Assert.isTrue(passing.resultMarker().endsWith('PASS'));

        List<SDTPicklistDependencyValidator.Failure> failures = new List<SDTPicklistDependencyValidator.Failure>{
            new SDTPicklistDependencyValidator.Failure(specs[0], 'United States',
                SDTPicklistDependencyValidator.FailureKind.MISSING_VALUES, 'missing', new List<String>{ 'West' })
        };
        SDTPicklistDependencyReport failing = SDTPicklistDependencyReport.build(specs, failures);
        Assert.isTrue(failing.hasFailures());
        Assert.isTrue(failing.resultMarker().endsWith('FAIL'));
        Assert.isTrue(failing.toDisplayString().contains('MISSING_VALUES'));
    }
}
