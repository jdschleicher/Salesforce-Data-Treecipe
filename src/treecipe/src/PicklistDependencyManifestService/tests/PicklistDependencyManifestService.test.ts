import { PicklistDependencyManifestService } from "../PicklistDependencyManifestService";

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
                    warning: 'No "valueSettings" markup found for dependent picklist "Account.Region__c"'
                }]
            });

            const manifest = buildManifestFromCollectionResult(collectionResult);

            expect(manifest.skippedFields).toHaveLength(1);
            expect(manifest.skippedFields[0].objectApiName).toBe('Account');
            expect(manifest.skippedFields[0].fieldApiName).toBe('Region__c');
            expect(manifest.skippedFieldWarnings).toHaveLength(1);

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

        test('given an unreadable directory, returns a fingerprint rather than throwing', () => {

            expect(() => PicklistDependencyManifestService.buildSourceFingerprint('/no/such/directory/anywhere')).not.toThrow();

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

});
