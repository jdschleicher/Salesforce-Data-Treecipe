import {
    PicklistDependencyManifestService,
    PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING
} from "../PicklistDependencyManifestService";

import {
    IPicklistDependencyCollectionResult,
    IPicklistDependencySpecDetail,
    IRecordTypePicklistDependencySpecDetail,
    PicklistDependencyTestService
} from "../../PicklistDependencyTestService/PicklistDependencyTestService";

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => ({}), { virtual: true });

function buildChainSpecDetails(): IPicklistDependencySpecDetail[] {

    return [
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'City__c',
            controllingFieldApiName: 'State__c',
            upstreamFieldApiName: 'State__c',
            expectations: [
                { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin', 'Toronto'] },
                { controllingValue: 'Ontario', dependentValues: [], forbiddenValues: [] }
            ]
        },
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'State__c',
            controllingFieldApiName: 'Country__c',
            expectations: [
                { controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: ['Ohio'] },
                { controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: ['Ontario'] }
            ]
        }
    ];

}

function buildRecordTypeSpecDetails(): IRecordTypePicklistDependencySpecDetail[] {

    return [
        {
            objectApiName: 'Chain_Example__c',
            fieldApiName: 'State__c',
            controllingFieldApiName: 'Country__c',
            recordTypeDeveloperName: 'North_America',
            expectations: [
                { controllingValue: 'Canada', dependentValues: ['Ontario'], forbiddenValues: [] },
                { controllingValue: 'Mexico', dependentValues: [], forbiddenValues: [], controllingValueUnavailable: true }
            ]
        }
    ];

}

function buildCollectionResult(overrides: Partial<IPicklistDependencyCollectionResult> = {}): IPicklistDependencyCollectionResult {

    return {
        specDetails: buildChainSpecDetails(),
        recordTypeSpecDetails: buildRecordTypeSpecDetails(),
        skippedFieldWarnings: [],
        skippedFields: [],
        ...overrides
    };

}

function buildManifestFromCollectionResult(collectionResult: IPicklistDependencyCollectionResult = buildCollectionResult()) {

    return PicklistDependencyManifestService.buildManifest(
        collectionResult,
        '/workspace/force-app/main/default/objects',
        '/workspace/force-app/main/default/classes',
        '3.5.0',
        '2026-09-03T12:00:00Z',
        'fingerprint-abc'
    );

}

describe('PicklistDependencyManifestService', () => {

    /*
        Temp directories are tracked and removed in afterEach rather than at the end of each test.
        An assertion that fails mid-test would otherwise skip its own cleanup and leak, and the
        recursive remove needs maxRetries: it races the OS on a directory whose entries were only
        just written, which surfaces as an intermittent ENOTEMPTY under parallel workers.
    */
    let temporaryDirectoryPaths: string[] = [];

    function buildTemporaryDirectory(prefix: string): string {

        const temporaryDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        temporaryDirectoryPaths.push(temporaryDirectoryPath);

        return temporaryDirectoryPath;

    }

    afterEach(() => {

        temporaryDirectoryPaths.forEach(temporaryDirectoryPath => {

            /*
                Never allowed to throw. Cleanup is housekeeping, and some filesystems -- overlayfs
                in a container among them -- return ENOTEMPTY for a recursive remove of a directory
                whose entries were only just unlinked, which retries do not settle. Failing a green
                test over a temp directory would report a defect that does not exist.
            */
            try {
                fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
            } catch {
                // INTENTIONALLY IGNORED -- SEE ABOVE
            }

        });

        temporaryDirectoryPaths = [];

    });

    describe('buildManifest', () => {

        test('records the manifest format version so a future reader can refuse a shape it does not know', () => {

            const manifest = buildManifestFromCollectionResult();

            expect(manifest.manifestVersion).toBe(PicklistDependencyManifestService.getManifestVersion());

        });

        test('records the test suite the generated tests are registered in', () => {

            const manifest = buildManifestFromCollectionResult();

            expect(manifest.testSuiteName).toBe(PicklistDependencyTestService.getTestSuiteName());
            expect(manifest.testSuiteFilePath).toEndWith('SDTPicklistDependencyTests.testSuite-meta.xml');

            /*
                Written by the run that generated the Apex rather than recomputed by a reader, for the
                reason every other name here is: two derivations of one name is the disagreement this
                artifact exists to remove.
            */
            expect(manifest.testSuiteFilePath).toBe(
                PicklistDependencyTestService.getTestSuiteFilePath(manifest.classesDirectoryPath)
            );

        });

        test('records the provenance a reader needs to explain what they are looking at', () => {

            const manifest = buildManifestFromCollectionResult();

            expect(manifest.generatedAt).toBe('2026-09-03T12:00:00Z');
            expect(manifest.generatorVersion).toBe('3.5.0');
            expect(manifest.objectsDirectoryPath).toBe('/workspace/force-app/main/default/objects');
            expect(manifest.classesDirectoryPath).toBe('/workspace/force-app/main/default/classes');
            expect(manifest.sourceFingerprint).toBe('fingerprint-abc');

        });

        /*
            The parity assertion this whole feature turns on. Both artifacts are emitted from one
            model, so the method names the manifest records must be the identical strings the Apex
            declares -- a manifest naming a method the class does not define is exactly the silent
            disagreement the artifact exists to prevent.
        */
        test('every spec method it names is a method the generated Apex class actually declares', () => {

            const collectionResult = buildCollectionResult();
            const manifest = buildManifestFromCollectionResult(collectionResult);

            const manifestObject = manifest.objects.find(entry => entry.objectApiName === 'Chain_Example__c');

            const apexClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                'Chain_Example__c',
                manifestObject.generatedClassName,
                collectionResult.specDetails,
                collectionResult.recordTypeSpecDetails
            );

            manifestObject.fields.forEach(manifestField => {
                expect(apexClassBody).toContain(`public static SDTPicklistDependencySpec ${manifestField.specMethodName}()`);
            });

            manifestObject.recordTypeScopedFields.forEach(manifestRecordTypeScopedField => {
                expect(apexClassBody).toContain(`public static SDTPicklistDependencySpec ${manifestRecordTypeScopedField.specMethodName}()`);
            });

        });

        test('names the same per-object class and test method the generator emits', () => {

            const manifest = buildManifestFromCollectionResult();
            const manifestObject = manifest.objects[0];

            expect(manifestObject.generatedClassName)
                .toBe(PicklistDependencyTestService.buildPerObjectSpecsClassName('Chain_Example__c'));
            expect(manifestObject.testMethodName)
                .toBe(PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Chain_Example__c'));
            expect(manifestObject.generatedClassFilePath).toContain(manifestObject.generatedClassName);

        });

        test('carries every expectation the spec details declare, including the record type scoped ones', () => {

            const manifest = buildManifestFromCollectionResult();
            const manifestObject = manifest.objects[0];

            expect(manifestObject.fields).toHaveLength(2);
            expect(manifestObject.recordTypeScopedFields).toHaveLength(1);

            const stateField = manifestObject.fields.find(field => field.fieldApiName === 'State__c');
            expect(stateField.expectations.map(expectation => expectation.controllingValue)).toEqual(['Canada', 'USA']);

            const scopedField = manifestObject.recordTypeScopedFields[0];
            expect(scopedField.recordTypeDeveloperName).toBe('North_America');
            expect(scopedField.expectations.find(expectation => expectation.controllingValue === 'Mexico').controllingValueUnavailable).toBe(true);

        });

        test('carries the upstream field so a chained dependency is still a chain in the panel', () => {

            const manifest = buildManifestFromCollectionResult();
            const cityField = manifest.objects[0].fields.find(field => field.fieldApiName === 'City__c');

            expect(cityField.upstreamFieldApiName).toBe('State__c');

        });

        /*
            An expectation that never declared a forbidden list asserts only the positive half, and
            normalising that to an empty array here would turn "asserts nothing about what this
            value must not unlock" into "asserts that it unlocks everything" -- a claim the
            generated Apex does not make.
        */
        test('given an expectation with no forbidden list, records no forbidden list rather than an empty one', () => {

            const collectionResult = buildCollectionResult({
                specDetails: [{
                    objectApiName: 'Account',
                    fieldApiName: 'Region__c',
                    controllingFieldApiName: 'Country__c',
                    expectations: [{ controllingValue: 'USA', dependentValues: ['East'] }]
                }],
                recordTypeSpecDetails: []
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);

            expect(manifest.objects[0].fields[0].expectations[0]).not.toHaveProperty('forbiddenValues');

        });

        test('carries skipped fields with the object and field each concerns, alongside the warning text', () => {

            const collectionResult = buildCollectionResult({
                skippedFieldWarnings: ['No "valueSettings" markup found for dependent picklist "Account.Region__c"'],
                skippedFields: [{
                    objectApiName: 'Account',
                    fieldApiName: 'Region__c',
                    warning: 'No "valueSettings" markup found for dependent picklist "Account.Region__c"',
                    reason: 'noValueSettings'
                }]
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);

            expect(manifest.skippedFields).toHaveLength(1);
            expect(manifest.skippedFields[0].objectApiName).toBe('Account');
            expect(manifest.skippedFields[0].fieldApiName).toBe('Region__c');
            expect(manifest.skippedFields[0].reason).toBe('noValueSettings');
            expect(manifest.skippedFieldWarnings).toHaveLength(1);

        });

    });

    describe('skipped field reasons across manifest versions', () => {

        /*
            A manifest written before the reason existed, or hand edited to one this version does not
            define, still names a real skip. Dropping the row would understate what generation left
            out -- the one thing the skipped-field list exists to prevent.
        */
        test('given a skipped field with no reason, loads it as unknown rather than dropping it', () => {

            const skippedField = PicklistDependencyManifestService.buildSkippedFieldByEntry({
                objectApiName: 'Account',
                fieldApiName: 'Region__c',
                warning: 'No "valueSettings" markup found for dependent picklist "Account.Region__c"'
            });

            expect(skippedField).toBeDefined();
            expect(skippedField!.reason).toBe('unknown');
            expect(skippedField!.warning).toContain('valueSettings');

        });

        test('given a reason this version does not define, loads it as unknown rather than trusting the string', () => {

            const skippedField = PicklistDependencyManifestService.buildSkippedFieldByEntry({
                objectApiName: 'Account',
                fieldApiName: 'Region__c',
                warning: 'a warning',
                reason: 'somethingThisBuildHasNeverHeardOf'
            });

            expect(skippedField!.reason).toBe('unknown');

        });

        test('given a recognised reason, round trips it unchanged', () => {

            const skippedField = PicklistDependencyManifestService.buildSkippedFieldByEntry({
                objectApiName: 'Account',
                fieldApiName: 'Region__c',
                warning: 'a warning',
                reason: 'valueNotDeclaredInGlobalValueSet'
            });

            expect(skippedField!.reason).toBe('valueNotDeclaredInGlobalValueSet');

        });

        test('given an entry with no object api name, still drops it -- a row naming nothing cannot be rendered', () => {

            expect(PicklistDependencyManifestService.buildSkippedFieldByEntry({ warning: 'a warning' })).toBeUndefined();

        });

    });

    /*
        The parity claim rests on the GROUPING step, which a single-object fixture never exercises.
        These drive multiple objects, each with record types, so an ordering or naming divergence
        between the manifest and the emitted Apex would show up as a missing method here.
    */
    describe('manifest and Apex agree across MULTIPLE objects', () => {

        function buildMultiObjectCollectionResult(): IPicklistDependencyCollectionResult {

            const buildObjectSpecs = (objectApiName: string): IPicklistDependencySpecDetail[] => ([
                {
                    objectApiName,
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    upstreamFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin'] }]
                },
                {
                    objectApiName,
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: ['Ontario'] }]
                }
            ]);

            const buildObjectRecordTypeSpecs = (objectApiName: string): IRecordTypePicklistDependencySpecDetail[] => ([
                {
                    objectApiName,
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    recordTypeDeveloperName: 'US_Only',
                    expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] }]
                }
            ]);

            return {
                specDetails: [
                    ...buildObjectSpecs('Alpha__c'),
                    ...buildObjectSpecs('Beta__c'),
                    ...buildObjectSpecs('Gamma__c')
                ],
                recordTypeSpecDetails: [
                    ...buildObjectRecordTypeSpecs('Alpha__c'),
                    ...buildObjectRecordTypeSpecs('Beta__c'),
                    ...buildObjectRecordTypeSpecs('Gamma__c')
                ],
                skippedFieldWarnings: [],
                skippedFields: []
            };

        }

        test('every spec method the manifest names is declared by that object\'s generated class', () => {

            const collectionResult = buildMultiObjectCollectionResult();
            const manifest = buildManifestFromCollectionResult(collectionResult);

            expect(manifest.objects).toHaveLength(3);

            const specDetailsByObject = PicklistDependencyTestService.groupSpecDetailsByObjectApiName(collectionResult.specDetails);
            const recordTypeSpecDetailsByObject = PicklistDependencyTestService
                .groupSpecDetailsByObjectApiName(collectionResult.recordTypeSpecDetails) as Record<string, IRecordTypePicklistDependencySpecDetail[]>;

            manifest.objects.forEach(manifestObject => {

                const apexClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                    manifestObject.objectApiName,
                    manifestObject.generatedClassName,
                    specDetailsByObject[manifestObject.objectApiName],
                    recordTypeSpecDetailsByObject[manifestObject.objectApiName]
                );

                manifestObject.fields.forEach(manifestField => {
                    expect(apexClassBody).toContain(`public static SDTPicklistDependencySpec ${manifestField.specMethodName}()`);
                });

                manifestObject.recordTypeScopedFields.forEach(manifestScopedField => {
                    expect(apexClassBody).toContain(`public static SDTPicklistDependencySpec ${manifestScopedField.specMethodName}()`);
                });

            });

        });

        test('each object gets its own class name and test method name, none shared', () => {

            const manifest = buildManifestFromCollectionResult(buildMultiObjectCollectionResult());

            const classNames = manifest.objects.map(manifestObject => manifestObject.generatedClassName);
            const testMethodNames = manifest.objects.map(manifestObject => manifestObject.testMethodName);

            expect(new Set(classNames).size).toBe(3);
            expect(new Set(testMethodNames).size).toBe(3);

        });

        /*
            An object that produced ONLY record-type-scoped specs still gets a generated class, so it
            must get a manifest entry too. Deriving the object set from the field-level details alone
            would leave its Apex on disk with nothing in the panel describing it.
        */
        test('given an object with only record type scoped specs, still records it', () => {

            const collectionResult = buildMultiObjectCollectionResult();

            collectionResult.recordTypeSpecDetails.push({
                objectApiName: 'ScopedOnly__c',
                fieldApiName: 'Region__c',
                controllingFieldApiName: 'Country__c',
                recordTypeDeveloperName: 'US_Only',
                expectations: [{ controllingValue: 'USA', dependentValues: ['East'], forbiddenValues: [] }]
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);

            const scopedOnlyObject = manifest.objects.find(manifestObject => manifestObject.objectApiName === 'ScopedOnly__c');

            expect(scopedOnlyObject).toBeDefined();
            expect(scopedOnlyObject.fields).toBeEmpty();
            expect(scopedOnlyObject.recordTypeScopedFields).toHaveLength(1);
            expect(scopedOnlyObject.generatedClassName).not.toBe('');
            expect(scopedOnlyObject.testMethodName).not.toBe('');

        });

    });

    /*
        The manifest used to write forbiddenValues on EVERY expectation, so the file grew with
        combinations x declared values when the information content of those two lists is their sum.
        On a synthetic org of 150 objects x 8 dependent picklists x 40 controlling values x 120
        declared values it reached 153 MB, and parsing it was ~59% of a two-second Explorer open.

        What replaces it has to hold three properties at once, and each test below pins one: the
        complement is DERIVABLE (so the universe recorded is complete), an empty forbidden assertion
        stays distinguishable from no assertion at all, and what is read back is IDENTICAL to what
        generation held in memory rather than merely equivalent to it.
    */
    describe('the forbidden complement is recorded once per field, not once per expectation', () => {

        function findFieldEntry(manifest: ReturnType<typeof buildManifestFromCollectionResult>, fieldApiName: string) {

            return manifest.objects[0].fields.find(manifestField => manifestField.fieldApiName === fieldApiName)!;

        }

        test('records the marker instead of the values when the forbidden set IS the complement', () => {

            const cityField = findFieldEntry(buildManifestFromCollectionResult(), 'City__c');
            const ohioExpectation = cityField.expectations.find(expectation => expectation.controllingValue === 'Ohio')!;

            expect(ohioExpectation.forbiddenValuesAreDeclaredComplement).toBe(true);
            expect(ohioExpectation.forbiddenValues).toBeUndefined();

        });

        test('records the field declared universe once, complete enough to draw the complement from', () => {

            const cityField = findFieldEntry(buildManifestFromCollectionResult(), 'City__c');

            expect(cityField.declaredValues).toIncludeSameMembers(['Columbus', 'Austin', 'Toronto']);

        });

        /*
            A record-type-scoped complement is drawn against the values the RECORD TYPE assigns, not
            everything the field declares -- naming a value the record type never exposes would assert
            something about the field instead of about this scope. Recording the universe per field
            ENTRY rather than per field api name is what keeps the two scopes from sharing one.
        */
        test('scopes a record type field universe to what that record type assigns', () => {

            const collectionResult = buildCollectionResult();

            collectionResult.recordTypeSpecDetails = [
                {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    recordTypeDeveloperName: 'North_America',
                    expectations: [
                        { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Toronto'] }
                    ]
                }
            ];

            const manifest = buildManifestFromCollectionResult(collectionResult);
            const scopedField = manifest.objects[0].recordTypeScopedFields[0];
            const fieldLevelCityValues = findFieldEntry(manifest, 'City__c').declaredValues;

            expect(scopedField.declaredValues).toIncludeSameMembers(['Columbus', 'Toronto']);
            expect(fieldLevelCityValues).toContain('Austin');
            expect(scopedField.declaredValues).not.toContain('Austin');

        });

        /*
            expectNone and expectUnavailable both assert an EMPTY forbidden set against a universe
            that is not empty, so neither is the complement. Recording the marker for them would have
            the panel render every declared value as forbidden under a controlling value whose Apex
            asserts no such thing.
        */
        test('writes an empty forbidden assertion out literally rather than as the complement', () => {

            const cityField = findFieldEntry(buildManifestFromCollectionResult(), 'City__c');
            const ontarioExpectation = cityField.expectations.find(expectation => expectation.controllingValue === 'Ontario')!;

            expect(ontarioExpectation.forbiddenValuesAreDeclaredComplement).toBeUndefined();
            expect(ontarioExpectation.forbiddenValues).toEqual([]);

        });

        test('carries neither the marker nor a list for an expectation that asserted nothing', () => {

            const collectionResult = buildCollectionResult({
                specDetails: [
                    {
                        objectApiName: 'Chain_Example__c',
                        fieldApiName: 'City__c',
                        controllingFieldApiName: 'State__c',
                        expectations: [{ controllingValue: 'Ohio', dependentValues: ['Columbus'] }]
                    }
                ],
                recordTypeSpecDetails: []
            });

            const positiveOnlyExpectation = buildManifestFromCollectionResult(collectionResult).objects[0].fields[0].expectations[0];

            expect(positiveOnlyExpectation.forbiddenValuesAreDeclaredComplement).toBeUndefined();
            expect(positiveOnlyExpectation.forbiddenValues).toBeUndefined();

            const rebuiltExpectation = PicklistDependencyManifestService
                .buildExpectationsByManifestExpectations([positiveOnlyExpectation], ['Columbus'])[0];

            expect(rebuiltExpectation.forbiddenValues).toBeUndefined();

        });

        /*
            "Asserted nothing" and "asserted an empty set" are different claims, and the panel renders
            them differently -- hasForbiddenAssertion is exactly this distinction. Two shapes now
            produce an array where one used to, so the three states are asserted together rather than
            one at a time.
        */
        test('keeps all three forbidden states distinguishable through a round trip', () => {

            const manifestExpectations = [
                { combinationKey: 'k1', controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValuesAreDeclaredComplement: true },
                { combinationKey: 'k2', controllingValue: 'Ontario', dependentValues: [], forbiddenValues: [] },
                { combinationKey: 'k3', controllingValue: 'Texas', dependentValues: ['Austin'] }
            ];

            const rebuiltExpectations = PicklistDependencyManifestService.buildExpectationsByManifestExpectations(
                manifestExpectations,
                ['Austin', 'Columbus', 'Toronto']
            );

            expect(rebuiltExpectations[0].forbiddenValues).toEqual(['Austin', 'Toronto']);
            expect(rebuiltExpectations[1].forbiddenValues).toEqual([]);
            expect(rebuiltExpectations[2].forbiddenValues).toBeUndefined();

        });

        /*
            The complement comes back in EMISSION order, not in the order the universe happens to be
            recorded in. The manifest records the universe as the expectations declare it, which is a
            first-seen union and so is not sorted -- reconstructing straight off it would return the
            right values in the wrong order, which reads as identical to a set comparison and is not
            identical to the round trip this manifest is held to.

            Asserted through the per-field entry point rather than through buildDeclaredComplement,
            because ordering the universe once per field instead of once per expectation is the whole
            shape of that split: the complement itself takes an already ordered universe.
        */
        test('rebuilds the complement in the order the generator emits it, whatever order the universe is recorded in', () => {

            const rebuiltExpectations = PicklistDependencyManifestService.buildExpectationsByManifestExpectations(
                [{ combinationKey: 'k1', controllingValue: 'Ohio', dependentValues: ['Alpha'], forbiddenValuesAreDeclaredComplement: true }],
                ['Charlie', 'Alpha', 'Bravo']
            );

            expect(rebuiltExpectations[0].forbiddenValues)
                .toEqual(PicklistDependencyTestService.sortValuesForEmission(['Charlie', 'Bravo']));

        });

        /*
            A spec detail assembled by hand -- a test, or a parsed Apex spec naming a partial
            expectNotAllowed list -- is entitled to forbid something that is not the complement.
            Deriving it back would rewrite the assertion into one the spec never made, so the values
            are written out instead. This is what makes the round trip a property rather than a
            coincidence of what the generator happens to emit.
        */
        test('given a forbidden set that is not the complement, records it literally rather than rewriting it', () => {

            const collectionResult = buildCollectionResult({
                specDetails: [
                    {
                        objectApiName: 'Chain_Example__c',
                        fieldApiName: 'City__c',
                        controllingFieldApiName: 'State__c',
                        expectations: [
                            { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin'] },
                            { controllingValue: 'Texas', dependentValues: ['Austin'], forbiddenValues: ['Columbus', 'Toronto'] }
                        ]
                    }
                ],
                recordTypeSpecDetails: []
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);
            const partialExpectation = manifest.objects[0].fields[0].expectations
                .find(expectation => expectation.controllingValue === 'Ohio')!;

            expect(partialExpectation.forbiddenValues).toEqual(['Austin']);
            expect(partialExpectation.forbiddenValuesAreDeclaredComplement).toBeUndefined();

            expect(PicklistDependencyManifestService.buildSpecDetailsByManifest(manifest).specDetails)
                .toEqual(collectionResult.specDetails);

        });

        /*
            The size property itself, asserted rather than described. A field whose controlling values
            each unlock exactly one of many declared values is the worst case for the old shape: every
            value appeared once per controlling value that did not unlock it, so the file grew with
            the PRODUCT of the two picklists.
        */
        test('does not write a declared value once per combination that forbids it', () => {

            const declaredDependentValues = Array.from({ length: 12 }, (unusedValue, valueIndex) => `Dependent_${valueIndex}__c`);

            const expectations = declaredDependentValues.map(dependentValue => ({
                controllingValue: `Controlling_${dependentValue}`,
                dependentValues: [dependentValue],
                forbiddenValues: PicklistDependencyTestService.sortValuesForEmission(
                    declaredDependentValues.filter(declaredValue => declaredValue !== dependentValue)
                )
            }));

            const collectionResult = buildCollectionResult({
                specDetails: [
                    {
                        objectApiName: 'Wide__c',
                        fieldApiName: 'Dependent__c',
                        controllingFieldApiName: 'Controlling__c',
                        expectations: expectations
                    }
                ],
                recordTypeSpecDetails: []
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);
            const serializedManifest = PicklistDependencyManifestService.serializeManifest(manifest);

            /*
                Once in declaredValues and once as the value its own controlling value unlocks. The old
                shape wrote each of these 12 values 13 times; anything above that ceiling means the
                complement is being written out again.
            */
            const occurrenceCount = serializedManifest.split('"Dependent_5__c"').length - 1;
            expect(occurrenceCount).toBe(2);

            expect(PicklistDependencyManifestService.buildSpecDetailsByManifest(manifest).specDetails)
                .toEqual(collectionResult.specDetails);

        });

    });

    describe('buildCombinationKey', () => {

        test('shapes a field level key to match the failure lines the validator emits', () => {

            expect(PicklistDependencyManifestService.buildCombinationKey('Account', 'Region__c', 'USA'))
                .toBe('Account.Region__c @ USA');

        });

        test('shapes a record type scoped key with the scope the validator names', () => {

            expect(PicklistDependencyManifestService.buildCombinationKey('Account', 'Region__c', 'USA', 'US_Only'))
                .toBe('Account.Region__c [US_Only] @ USA');

        });

        test('keeps a field level and a record type scoped combination distinguishable', () => {

            const fieldLevelKey = PicklistDependencyManifestService.buildCombinationKey('Account', 'Region__c', 'USA');
            const scopedKey = PicklistDependencyManifestService.buildCombinationKey('Account', 'Region__c', 'USA', 'US_Only');

            expect(fieldLevelKey).not.toEqual(scopedKey);

        });

    });

    describe('serialize and load round trip', () => {

        test('a manifest written and read back describes the same specs', () => {

            const manifest = buildManifestFromCollectionResult();
            const serializedManifest = PicklistDependencyManifestService.serializeManifest(manifest);

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                JSON.parse(serializedManifest),
                '/workspace/treecipe/PicklistDependencySpecs/manifest.json'
            );

            expect(manifestLoad.state).toBe('loaded');
            expect(manifestLoad.manifest.objects).toHaveLength(1);
            expect(manifestLoad.manifest.objects[0].fields.map(field => field.fieldApiName)).toEqual(['City__c', 'State__c']);
            expect(manifestLoad.manifest.objects[0].recordTypeScopedFields[0].recordTypeDeveloperName).toBe('North_America');

        });

        test('the spec details rebuilt from a manifest match the ones it was built from', () => {

            const collectionResult = buildCollectionResult();
            const manifest = buildManifestFromCollectionResult(collectionResult);

            const rebuiltSpecDetails = PicklistDependencyManifestService.buildSpecDetailsByManifest(manifest);

            expect(rebuiltSpecDetails.specDetails).toEqual(collectionResult.specDetails);
            expect(rebuiltSpecDetails.recordTypeSpecDetails).toEqual(collectionResult.recordTypeSpecDetails);

        });

        test('writes the manifest under the specs folder, creating it when absent', () => {

            const temporaryDirectoryPath = buildTemporaryDirectory('treecipe-manifest-');
            const specsFolderPath = path.join(temporaryDirectoryPath, 'PicklistDependencySpecs');

            const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, buildManifestFromCollectionResult());

            expect(fs.existsSync(manifestFilePath)).toBe(true);
            expect(path.basename(manifestFilePath)).toBe('manifest.json');

            const manifestLoad = PicklistDependencyManifestService.loadManifest(specsFolderPath);
            expect(manifestLoad.state).toBe('loaded');

        });

    });

    /*
        The manifest is committed alongside the generated Apex, so it inherits the same property the
        classes gained in 3.4.0: regenerating from unchanged metadata must not put a change in the
        commit. Its generatedAt is the one field guaranteed to move on every run, so a naive write
        would churn the file every time and defeat exactly that.
    */
    describe('writeManifest is a no-op when nothing changed', () => {

        test('given an identical manifest but a later timestamp, leaves the file byte for byte alone', () => {

            const specsFolderPath = buildTemporaryDirectory('treecipe-manifest-');

            const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, buildManifestFromCollectionResult());
            const firstWrittenContent = fs.readFileSync(manifestFilePath, 'utf-8');

            const laterManifest = PicklistDependencyManifestService.buildManifest(
                buildCollectionResult(),
                '/workspace/force-app/main/default/objects',
                '/workspace/force-app/main/default/classes',
                '3.5.0',
                '2026-12-25T23:59:59Z',
                'fingerprint-abc'
            );

            PicklistDependencyManifestService.writeManifest(specsFolderPath, laterManifest);

            expect(fs.readFileSync(manifestFilePath, 'utf-8')).toBe(firstWrittenContent);

        });

        /*
            A changed fingerprint MUST rewrite even though the specs are identical. Leaving the old
            one in place would keep the staleness banner raised against specs the user just
            regenerated -- telling them to regenerate immediately after they did.
        */
        test('given the same specs but a changed fingerprint, rewrites so the staleness banner clears', () => {

            const specsFolderPath = buildTemporaryDirectory('treecipe-manifest-');

            const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, buildManifestFromCollectionResult());

            const refingerprintedManifest = PicklistDependencyManifestService.buildManifest(
                buildCollectionResult(),
                '/workspace/force-app/main/default/objects',
                '/workspace/force-app/main/default/classes',
                '3.5.0',
                '2026-12-25T23:59:59Z',
                'a-different-fingerprint'
            );

            PicklistDependencyManifestService.writeManifest(specsFolderPath, refingerprintedManifest);

            const rewrittenManifest = JSON.parse(fs.readFileSync(manifestFilePath, 'utf-8'));

            expect(rewrittenManifest.sourceFingerprint).toBe('a-different-fingerprint');
            expect(rewrittenManifest.generatedAt).toBe('2026-12-25T23:59:59Z');

        });

        test('given changed specs, rewrites the file', () => {

            const specsFolderPath = buildTemporaryDirectory('treecipe-manifest-');

            const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, buildManifestFromCollectionResult());

            const changedSpecDetails = buildChainSpecDetails();
            changedSpecDetails[1].expectations[1].dependentValues = ['Ohio', 'Michigan'];

            PicklistDependencyManifestService.writeManifest(
                specsFolderPath,
                buildManifestFromCollectionResult(buildCollectionResult({ specDetails: changedSpecDetails }))
            );

            expect(fs.readFileSync(manifestFilePath, 'utf-8')).toContain('Michigan');

        });

        test('given an unreadable manifest already on disk, replaces it rather than failing', () => {

            const specsFolderPath = buildTemporaryDirectory('treecipe-manifest-');
            fs.writeFileSync(path.join(specsFolderPath, 'manifest.json'), '{ not json');

            const manifestFilePath = PicklistDependencyManifestService.writeManifest(specsFolderPath, buildManifestFromCollectionResult());

            expect(PicklistDependencyManifestService.loadManifest(specsFolderPath).state).toBe('loaded');
            expect(manifestFilePath).toContain('manifest.json');

        });

    });

    describe('loadManifest', () => {

        test('given no manifest on disk, reports it as missing and names the generate command', () => {

            const temporaryDirectoryPath = buildTemporaryDirectory('treecipe-manifest-');

            const manifestLoad = PicklistDependencyManifestService.loadManifest(temporaryDirectoryPath);

            expect(manifestLoad.state).toBe('noManifestFound');
            expect(manifestLoad.message).toContain('Generate Picklist Dependency Tests');
            expect(manifestLoad.manifest).toBeUndefined();

        });

        test('given a manifest that is not JSON, reports the parse failure rather than throwing', () => {

            const temporaryDirectoryPath = buildTemporaryDirectory('treecipe-manifest-');
            fs.writeFileSync(path.join(temporaryDirectoryPath, 'manifest.json'), '{ not json');

            const manifestLoad = PicklistDependencyManifestService.loadManifest(temporaryDirectoryPath);

            expect(manifestLoad.state).toBe('unreadableManifest');
            expect(manifestLoad.message).toContain('could not be read as JSON');
            expect(manifestLoad.manifestFilePath).toContain('manifest.json');

        });

        test('given JSON with no objects list, reports it as unreadable rather than rendering nothing', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                { manifestVersion: 1, generatedAt: 'now' },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('unreadableManifest');
            expect(manifestLoad.message).toContain('objects');

        });

        /*
            A version this build does not know cannot be rendered honestly: reading a future shape
            against today's assumptions is how the panel would come to show something the Apex does
            not say, which is the failure mode the manifest was introduced to close.
        */
        test('given a manifest version this build does not read, refuses it rather than parsing hopefully', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                { manifestVersion: 99, objects: [] },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('unreadableManifest');
            expect(manifestLoad.message).toContain('format version 99');

        });

        /*
            A version 2 manifest is structurally readable -- it has objects, fields and expectations
            in the shapes this build walks -- which is exactly why it has to be refused by version
            rather than by shape. It carries no declaredValues, so every complement drawn against it
            would be empty and the panel would show specs that forbid nothing at all.
        */
        test('given a version 2 manifest carrying forbidden values per expectation, refuses it rather than reading it as empty', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: 2,
                    objects: [
                        {
                            objectApiName: 'Chain_Example__c',
                            fields: [
                                {
                                    fieldApiName: 'City__c',
                                    controllingFieldApiName: 'State__c',
                                    expectations: [
                                        { controllingValue: 'Ohio', dependentValues: ['Columbus'], forbiddenValues: ['Austin', 'Toronto'] }
                                    ]
                                }
                            ],
                            recordTypeScopedFields: []
                        }
                    ]
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('unreadableManifest');
            expect(manifestLoad.message).toContain('format version 2');
            expect(manifestLoad.message).toContain('Generate Picklist Dependency Tests');
            expect(manifestLoad.manifest).toBeUndefined();

        });

        /*
            The suite fields arrived with format version 2. A manifest from 3.9.0 carries neither, and
            reading it as if it did would have the Explorer name a suite the generated Apex was never
            registered in.
        */
        test('given a manifest written before the test suite existed, refuses it rather than assuming a suite', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                { manifestVersion: 1, objects: [], specsTestClassName: 'SDTPLDSpecsTest' },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('unreadableManifest');
            expect(manifestLoad.message).toContain('format version 1');
            expect(manifestLoad.message).toContain('Generate Picklist Dependency Tests');

        });

        test('given a current manifest, round trips the suite name and path', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: PicklistDependencyManifestService.getManifestVersion(),
                    objects: [],
                    testSuiteName: 'SDTPicklistDependencyTests',
                    testSuiteFilePath: '/workspace/force-app/main/default/testSuites/SDTPicklistDependencyTests.testSuite-meta.xml'
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('loaded');
            expect(manifestLoad.manifest?.testSuiteName).toBe('SDTPicklistDependencyTests');
            expect(manifestLoad.manifest?.testSuiteFilePath).toEndWith('SDTPicklistDependencyTests.testSuite-meta.xml');

        });

        test('given a manifest carrying no suite fields at the current version, reads them as empty rather than throwing', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                { manifestVersion: PicklistDependencyManifestService.getManifestVersion(), objects: [] },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('loaded');
            expect(manifestLoad.manifest?.testSuiteName).toBe('');
            expect(manifestLoad.manifest?.testSuiteFilePath).toBe('');

        });

        test('given an object entry with no api name, drops it rather than rendering an unnamed row', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: PicklistDependencyManifestService.getManifestVersion(),
                    objects: [{ fields: [] }, { objectApiName: 'Account', fields: [], recordTypeScopedFields: [] }]
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('loaded');
            expect(manifestLoad.manifest.objects).toHaveLength(1);
            expect(manifestLoad.manifest.objects[0].objectApiName).toBe('Account');

        });

        /*
            The key is rebuilt from the entry's own object, field and controlling value rather than
            taken from the file. A manifest is an editable json artifact, and a key trusted as
            written could point a failure at a combination it does not describe.
        */
        test('rebuilds a combination key from the entry rather than trusting the one written in the file', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: PicklistDependencyManifestService.getManifestVersion(),
                    objects: [{
                        objectApiName: 'Account',
                        fields: [{
                            fieldApiName: 'Region__c',
                            controllingFieldApiName: 'Country__c',
                            specMethodName: 'specFor_Account_Region_c',
                            expectations: [{
                                combinationKey: 'Totally.Different @ Key',
                                controllingValue: 'USA',
                                dependentValues: ['East']
                            }]
                        }],
                        recordTypeScopedFields: []
                    }]
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.manifest.objects[0].fields[0].expectations[0].combinationKey)
                .toBe('Account.Region__c @ USA');

        });

    });

    describe('source fingerprint', () => {

        const buildObjectsDirectory = () => {

            const temporaryDirectoryPath = buildTemporaryDirectory('treecipe-fingerprint-');
            const fieldsDirectoryPath = path.join(temporaryDirectoryPath, 'Account', 'fields');
            fs.mkdirSync(fieldsDirectoryPath, { recursive: true });
            fs.writeFileSync(path.join(fieldsDirectoryPath, 'Region__c.field-meta.xml'), '<CustomField/>');

            return temporaryDirectoryPath;

        };

        test('collects only the files that could contribute a spec', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            fs.writeFileSync(path.join(objectsDirectoryPath, 'Account', 'Account.object-meta.xml'), '<CustomObject/>');

            const fingerprintEntries = PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath);

            expect(fingerprintEntries).toHaveLength(1);
            expect(fingerprintEntries[0]).toContain('Account/fields/Region__c.field-meta.xml');

        });

        test('given unchanged files, produces the same fingerprint twice', () => {

            const objectsDirectoryPath = buildObjectsDirectory();

            expect(PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath))
                .toBe(PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath));

        });

        test('given an edited field file, produces a different fingerprint', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const fieldFilePath = path.join(objectsDirectoryPath, 'Account', 'fields', 'Region__c.field-meta.xml');

            const beforeFingerprint = PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath);

            fs.writeFileSync(fieldFilePath, '<CustomField><fullName>Region__c</fullName></CustomField>');

            expect(PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath)).not.toBe(beforeFingerprint);

        });

        test('given a newly added field file, produces a different fingerprint', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const beforeFingerprint = PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath);

            fs.writeFileSync(path.join(objectsDirectoryPath, 'Account', 'fields', 'City__c.field-meta.xml'), '<CustomField/>');

            expect(PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath)).not.toBe(beforeFingerprint);

        });

        /*
            The short-circuit is an optimisation of the WALK, not of the answer. Proving the digest is
            unchanged by the directories it skips is what makes it safe -- a faster fingerprint that
            reported different bytes would raise a staleness banner on metadata nobody touched.
        */
        test('given sibling metadata directories under an object, skips them without changing the digest', () => {

            const objectsDirectoryPath = buildObjectsDirectory();

            const beforeEntries = PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath);
            const beforeFingerprint = PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath);

            ['listViews', 'compactLayouts', 'webLinks', 'validationRules'].forEach(siblingDirectoryName => {
                const siblingDirectoryPath = path.join(objectsDirectoryPath, 'Account', siblingDirectoryName);
                fs.mkdirSync(siblingDirectoryPath, { recursive: true });
                fs.writeFileSync(path.join(siblingDirectoryPath, `Thing.${siblingDirectoryName}-meta.xml`), '<Any/>');
            });

            expect(PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath)).toEqual(beforeEntries);
            expect(PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath)).toBe(beforeFingerprint);

        });

        test('still digests record type files, which live beside fields rather than under it', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const recordTypesDirectoryPath = path.join(objectsDirectoryPath, 'Account', 'recordTypes');
            fs.mkdirSync(recordTypesDirectoryPath, { recursive: true });
            fs.writeFileSync(path.join(recordTypesDirectoryPath, 'US_Only.recordType-meta.xml'), '<RecordType/>');

            const fingerprintEntries = PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath);

            expect(fingerprintEntries).toHaveLength(2);
            expect(fingerprintEntries.some(entry => entry.includes('recordTypes/US_Only.recordType-meta.xml'))).toBe(true);

        });

        /*
            A symlinked field file answers false to Dirent.isDirectory(), so treating a symlink as a
            directory sent it to readdirSync, which threw ENOTDIR and dropped it. Edits to it would
            then never move the digest -- a staleness blind spot rather than a crash.
        */
        test('given a field file reached through a symlink, includes it in the fingerprint', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const realFieldFilePath = path.join(objectsDirectoryPath, 'Account', 'fields', 'Region__c.field-meta.xml');
            const symlinkedFieldFilePath = path.join(objectsDirectoryPath, 'Account', 'fields', 'Linked__c.field-meta.xml');

            try {
                fs.symlinkSync(realFieldFilePath, symlinkedFieldFilePath);
            } catch {
                // A FILESYSTEM THAT DISALLOWS SYMLINKS HAS NOTHING TO ASSERT HERE
                return;
            }

            const fingerprintEntries = PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath);

            expect(fingerprintEntries).toHaveLength(2);
            expect(fingerprintEntries.some(entry => entry.includes('Linked__c.field-meta.xml'))).toBe(true);

        });

        test('given a broken symlink, skips it rather than throwing', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const brokenSymlinkPath = path.join(objectsDirectoryPath, 'Account', 'fields', 'Missing__c.field-meta.xml');

            try {
                fs.symlinkSync(path.join(objectsDirectoryPath, 'nowhere', 'Nothing.field-meta.xml'), brokenSymlinkPath);
            } catch {
                return;
            }

            expect(() => PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath)).not.toThrow();
            expect(PicklistDependencyManifestService.collectSourceFingerprintEntries(objectsDirectoryPath)).toHaveLength(1);

        });

        test('given a symlink cycle, terminates rather than recursing forever', () => {

            const objectsDirectoryPath = buildObjectsDirectory();
            const nestedDirectoryPath = path.join(objectsDirectoryPath, 'nested');
            fs.mkdirSync(nestedDirectoryPath, { recursive: true });

            try {
                fs.symlinkSync(objectsDirectoryPath, path.join(nestedDirectoryPath, 'loop'));
            } catch {
                return;
            }

            expect(() => PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath)).not.toThrow();

        });

        test('given an unreadable directory, returns a fingerprint rather than throwing', () => {

            expect(() => PicklistDependencyManifestService.buildSourceFingerprint('/no/such/directory/anywhere')).not.toThrow();

        });

    });

    describe('manifest load rejects api names the generator could never have emitted', () => {

        /*
            buildFieldSourceFilePath throws on a name outside /^[A-Za-z0-9_]+$/, and an entry that
            reached it would abort the whole Explorer command rather than costing one row. Dropping
            it at the boundary is how every other malformed entry is already handled.
        */
        test('given an object api name carrying path syntax, drops the entry rather than loading it', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: PicklistDependencyManifestService.getManifestVersion(),
                    objects: [
                        { objectApiName: '../../../etc', fields: [], recordTypeScopedFields: [] },
                        { objectApiName: 'Account', fields: [], recordTypeScopedFields: [] }
                    ]
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.state).toBe('loaded');
            expect(manifestLoad.manifest.objects.map(manifestObject => manifestObject.objectApiName)).toEqual(['Account']);

        });

        test('given a field api name carrying path syntax, drops that field and keeps the object', () => {

            const manifestLoad = PicklistDependencyManifestService.buildManifestLoadByParsedContent(
                {
                    manifestVersion: PicklistDependencyManifestService.getManifestVersion(),
                    objects: [{
                        objectApiName: 'Account',
                        fields: [
                            { fieldApiName: '../secret', controllingFieldApiName: 'Country__c', specMethodName: 'x', expectations: [] },
                            { fieldApiName: 'Region__c', controllingFieldApiName: 'Country__c', specMethodName: 'y', expectations: [] }
                        ],
                        recordTypeScopedFields: []
                    }]
                },
                '/tmp/manifest.json'
            );

            expect(manifestLoad.manifest.objects[0].fields.map(field => field.fieldApiName)).toEqual(['Region__c']);

        });

    });

    describe('resolveManifestFreshness', () => {

        test('given an unchanged fingerprint and the same directory, reports fresh', () => {

            const manifest = buildManifestFromCollectionResult();
            jest.spyOn(PicklistDependencyManifestService, 'buildSourceFingerprint').mockReturnValue('fingerprint-abc');

            const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                manifest,
                '/workspace/force-app/main/default/objects'
            );

            expect(freshnessResult.freshness).toBe('fresh');
            expect(freshnessResult.message).toBe('');

        });

        test('given a changed fingerprint, reports stale metadata and names the generate command', () => {

            const manifest = buildManifestFromCollectionResult();
            jest.spyOn(PicklistDependencyManifestService, 'buildSourceFingerprint').mockReturnValue('a-different-fingerprint');

            const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                manifest,
                '/workspace/force-app/main/default/objects'
            );

            expect(freshnessResult.freshness).toBe('staleMetadata');
            expect(freshnessResult.message).toContain('Generate Picklist Dependency Tests');

        });

        /*
            Reported apart from a metadata change on purpose. A manifest recorded against another
            directory is not describing changed metadata, it is describing something else, and
            telling the reader their metadata changed would send them hunting an edit they never made.
        */
        test('given a different objects directory, reports that rather than a metadata change', () => {

            const manifest = buildManifestFromCollectionResult();

            const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                manifest,
                '/workspace/some-other-package/objects'
            );

            expect(freshnessResult.freshness).toBe('staleObjectsDirectory');
            expect(freshnessResult.message).toContain('/workspace/some-other-package/objects');
            expect(freshnessResult.message).toContain('/workspace/force-app/main/default/objects');

        });

        test('given the same directory written with redundant path segments, does not report it as different', () => {

            const manifest = buildManifestFromCollectionResult();
            jest.spyOn(PicklistDependencyManifestService, 'buildSourceFingerprint').mockReturnValue('fingerprint-abc');

            const freshnessResult = PicklistDependencyManifestService.resolveManifestFreshness(
                manifest,
                '/workspace/force-app/main/default/../default/objects'
            );

            expect(freshnessResult.freshness).toBe('fresh');

        });

    });

    describe('getGeneratorVersion', () => {

        test('reads the version from the package manifest the extension ships with', () => {

            const extensionPath = path.join(__dirname, '..', '..', '..', '..', '..');
            const packageJson = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf-8'));

            expect(PicklistDependencyManifestService.getGeneratorVersion(extensionPath)).toBe(packageJson.version);

        });

        test('given no readable package manifest, degrades to unknown rather than failing a generation', () => {

            expect(PicklistDependencyManifestService.getGeneratorVersion('/no/such/extension/path')).toBe('unknown');

        });

    });


    describe('PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING', () => {

        it('is the freshness a model carries before the walk has run, and is frozen against a caller editing it', () => {

            expect(PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING.freshness).toBe('pendingCheck');
            expect(PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING.message).toBe('');

            /*
                It is handed to every model build as the pending answer, so it is shared across opens.
                A caller mutating it would change what every later open starts from.
            */
            expect(Object.isFrozen(PICKLIST_DEPENDENCY_MANIFEST_FRESHNESS_PENDING)).toBe(true);

        });

        it('is never what resolveManifestFreshness returns -- the walk always answers one way or the other', () => {

            // THROUGH THE TRACKED HELPER, SO CLEANUP IS THE FILE'S TOLERANT afterEach RATHER THAN AN rmSync THAT CAN ENOTEMPTY
            const manifestDirectoryPath = buildTemporaryDirectory('treecipe-freshness-');
            const objectsDirectoryPath = path.join(manifestDirectoryPath, 'objects');
            fs.mkdirSync(objectsDirectoryPath, { recursive: true });

            const manifest = PicklistDependencyManifestService.buildManifest(
                { specDetails: buildChainSpecDetails(), recordTypeSpecDetails: [], skippedFieldWarnings: [], skippedFields: [] },
                objectsDirectoryPath,
                path.join(manifestDirectoryPath, 'classes'),
                '9.9.9',
                '2026-01-01T00:00:00Z',
                PicklistDependencyManifestService.buildSourceFingerprint(objectsDirectoryPath)
            );

            const freshResult = PicklistDependencyManifestService.resolveManifestFreshness(manifest, objectsDirectoryPath);
            expect(freshResult.freshness).toBe('fresh');

            fs.writeFileSync(path.join(objectsDirectoryPath, 'Added__c.field-meta.xml'), '<x/>');

            const staleResult = PicklistDependencyManifestService.resolveManifestFreshness(manifest, objectsDirectoryPath);
            expect(staleResult.freshness).toBe('staleMetadata');

        });

    });

});
