import { PicklistDependencyTestService } from '../PicklistDependencyTestService';
import { IPicklistDependencySpecDetail } from '../PicklistDependencySpecDetail';
import { XMLFieldDetail } from '../../XMLProcessingService/XMLFieldDetail';

import * as fs from 'fs';
import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn(() => ({
            get: jest.fn()
        }))
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showQuickPick: jest.fn()
    },
    FileType: {
        File: 1,
        Directory: 2
    }
}), { virtual: true });

const existingSalesforceMetadataMockObjectsPath = path.resolve(
    __dirname,
    '../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/objects'
);

const picklistDependencyMockObjectsPath = path.resolve(
    __dirname,
    './mocks/MockPicklistDependencyDirectory/objects'
);

describe('Shared PicklistDependencyTestService Tests', () => {

    describe('collectSpecDetailsByObjectsDirectory', () => {

        test('given the existing MockSalesforceMetadataDirectory, builds a spec for the DependentPicklist__c fixture with expectations ordered by the controlling field value set', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(existingSalesforceMetadataMockObjectsPath);

            const dependentPicklistSpecDetail = collectionResult.specDetails.find(
                specDetail => specDetail.fieldApiName === 'DependentPicklist__c'
            );

            expect(dependentPicklistSpecDetail).toBeDefined();
            expect(dependentPicklistSpecDetail.objectApiName).toBe('Example_Everything__c');
            expect(dependentPicklistSpecDetail.controllingFieldApiName).toBe('Picklist__c');

            // ORDER MIRRORS Picklist__c's valueSetDefinition RATHER THAN THE ORDER valueSettings HAPPEN TO APPEAR IN
            expect(dependentPicklistSpecDetail.expectations).toEqual([
                { controllingValue: 'cle', dependentValues: ['tree', 'weed', 'mulch', 'rocks'] },
                { controllingValue: 'eastlake', dependentValues: ['tree', 'weed', 'mulch'] },
                { controllingValue: 'madison', dependentValues: ['tree', 'plant', 'weed'] },
                { controllingValue: 'mentor', dependentValues: ['plant', 'weed'] },
                { controllingValue: 'wickliffe', dependentValues: ['weed', 'rocks'] },
                { controllingValue: 'willoughby', dependentValues: ['tree', 'weed', 'mulch'] }
            ]);

        });

        test('given a dependent picklist whose controlling field is not in the parsed directory, falls back to the controlling values named in valueSettings', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(existingSalesforceMetadataMockObjectsPath);

            const unresolvableControllingFieldSpecDetail = collectionResult.specDetails.find(
                specDetail => specDetail.fieldApiName === 'gfh__c'
            );

            expect(unresolvableControllingFieldSpecDetail).toBeDefined();
            expect(unresolvableControllingFieldSpecDetail.controllingFieldApiName).toBe('nv__c');
            expect(unresolvableControllingFieldSpecDetail.expectations).toEqual([
                { controllingValue: 'a', dependentValues: ['1', '2'] },
                { controllingValue: 'b', dependentValues: ['3'] },
                { controllingValue: 'c', dependentValues: ['3', '4'] }
            ]);

        });

        test('given a controlling value that unlocks nothing, an expectation with no dependent values is produced', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);

            const specialCharactersSpecDetail = collectionResult.specDetails.find(
                specDetail => specDetail.objectApiName === 'Special_Characters__c'
            );

            expect(specialCharactersSpecDetail.expectations).toEqual([
                { controllingValue: "O'Brien", dependentValues: ["Value's One", 'Plain'] },
                { controllingValue: 'Back\\Slash', dependentValues: ['Plain'] },
                { controllingValue: 'Unlocks_Nothing', dependentValues: [] }
            ]);

        });

        test('given a field with a controllingField but no valueSettings markup, the field is skipped with a warning naming object and field', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);

            const orphanSpecDetail = collectionResult.specDetails.find(
                specDetail => specDetail.fieldApiName === 'Orphan_Dependent__c'
            );

            expect(orphanSpecDetail).toBeUndefined();
            expect(collectionResult.skippedFieldWarnings).toHaveLength(1);
            expect(collectionResult.skippedFieldWarnings[0]).toContain('No_Value_Settings__c.Orphan_Dependent__c');
            expect(collectionResult.skippedFieldWarnings[0]).toContain('Controlling__c');

        });

        test('given a directory with dependent picklists, the run is not aborted by the skipped field', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);

            expect(collectionResult.specDetails).toHaveLength(1);
            expect(collectionResult.skippedFieldWarnings).toHaveLength(1);

        });

        test('given an objects directory that does not exist, an actionable error is thrown', async () => {

            const nonExistentObjectsPath = path.join(picklistDependencyMockObjectsPath, 'DoesNotExist');

            await expect(
                PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(nonExistentObjectsPath)
            ).rejects.toThrow('Unable to find the configured Salesforce objects directory');

        });

        test('given the same unchanged directory processed twice, identical spec details are produced', async () => {

            const firstCollectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);
            const secondCollectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);

            expect(PicklistDependencyTestService.generateApexSpecsClassContent(firstCollectionResult.specDetails))
                .toBe(PicklistDependencyTestService.generateApexSpecsClassContent(secondCollectionResult.specDetails));

        });

    });

    describe('buildExpectations', () => {

        test('given a controlling value in valueSettings that the controlling field no longer declares, the expectation is still produced', () => {

            const controllingFieldDetail = new XMLFieldDetail();
            controllingFieldDetail.picklistValues = [
                { picklistOptionApiName: 'known', label: 'known' }
            ];

            const expectations = PicklistDependencyTestService.buildExpectations(
                { known: ['one'], removedFromControllingField: ['two'] },
                controllingFieldDetail
            );

            expect(expectations).toEqual([
                { controllingValue: 'known', dependentValues: ['one'] },
                { controllingValue: 'removedFromControllingField', dependentValues: ['two'] }
            ]);

        });

        test('given no controlling field detail, expectations come only from the valueSettings map', () => {

            const expectations = PicklistDependencyTestService.buildExpectations({ alpha: ['one'] }, undefined);

            expect(expectations).toEqual([
                { controllingValue: 'alpha', dependentValues: ['one'] }
            ]);

        });

    });

    describe('buildSpecDetail', () => {

        test('given a dependent field with no picklist values, null is returned so the caller can warn and continue', () => {

            const dependentFieldDetail = new XMLFieldDetail();
            dependentFieldDetail.apiName = 'Dependent__c';
            dependentFieldDetail.controllingField = 'Controlling__c';

            const specDetail = PicklistDependencyTestService.buildSpecDetail('Object__c', dependentFieldDetail, undefined);

            expect(specDetail).toBeNull();

        });

    });

    describe('escapeApexStringLiteral', () => {

        test('given a value containing a single quote, the quote is escaped for an Apex string literal', () => {
            expect(PicklistDependencyTestService.escapeApexStringLiteral("O'Brien")).toBe("O\\'Brien");
        });

        test('given a value containing a backslash, the backslash is escaped before the quote escape is applied', () => {
            expect(PicklistDependencyTestService.escapeApexStringLiteral('Back\\Slash')).toBe('Back\\\\Slash');
        });

        test('given a value containing a backslash immediately before a quote, both are escaped independently', () => {
            expect(PicklistDependencyTestService.escapeApexStringLiteral("Back\\'Quote")).toBe("Back\\\\\\'Quote");
        });

        test('given a value containing newline, carriage return and tab, each is escaped', () => {
            expect(PicklistDependencyTestService.escapeApexStringLiteral('a\r\nb\tc')).toBe('a\\r\\nb\\tc');
        });

        test('given a value with no special characters, the value is returned unchanged', () => {
            expect(PicklistDependencyTestService.escapeApexStringLiteral('Plain_Value')).toBe('Plain_Value');
        });

    });

    describe('generateApexSpecsClassContent', () => {

        const buildSpecDetail = (): IPicklistDependencySpecDetail => ({
            objectApiName: 'Account',
            fieldApiName: 'Region__c',
            controllingFieldApiName: 'Country__c',
            expectations: [
                { controllingValue: 'United States', dependentValues: ['West', 'East'] },
                { controllingValue: 'Antarctica', dependentValues: [] }
            ]
        });

        test('given a spec detail, the generated Apex targets the PicklistDependencySpec fluent API', () => {

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([buildSpecDetail()]);

            expect(generatedApex).toContain(`public class PicklistDependencySpecs {`);
            expect(generatedApex).toContain(`public static List<PicklistDependencySpec> all() {`);
            expect(generatedApex).toContain(`PicklistDependencySpec.forField('Account', 'Region__c')`);
            expect(generatedApex).toContain(`.controlledBy('Country__c')`);
            expect(generatedApex).toContain(`.expectAtLeast('United States', new List<String>{ 'West', 'East' })`);

        });

        test('given a controlling value with no dependent values, expectNone is emitted rather than an empty expectAtLeast', () => {

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([buildSpecDetail()]);

            expect(generatedApex).toContain(`.expectNone('Antarctica')`);
            expect(generatedApex).not.toContain(`.expectAtLeast('Antarctica'`);

        });

        test('given generated content, no emitted expectation line uses expectExactly', () => {

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([buildSpecDetail()]);

            // THE HEADER COMMENT NAMES expectExactly TO EXPLAIN WHY IT IS ABSENT, SO ONLY THE all() BODY IS ASSERTED
            const allMethodBody = generatedApex.split('public static List<PicklistDependencySpec> all() {')[1];

            expect(allMethodBody).not.toContain('expectExactly');
            expect(allMethodBody).toContain('expectAtLeast');

        });

        test('given every spec detail, controlledBy is always emitted so the CONTROLLING_FIELD_MISMATCH check stays active', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(existingSalesforceMetadataMockObjectsPath);
            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent(collectionResult.specDetails);

            const forFieldCount = (generatedApex.match(/PicklistDependencySpec\.forField\(/g) || []).length;
            const controlledByCount = (generatedApex.match(/\.controlledBy\(/g) || []).length;

            expect(forFieldCount).toBeGreaterThan(0);
            expect(controlledByCount).toBe(forFieldCount);

        });

        test('given multiple spec details, each statement is comma separated inside the list initializer', () => {

            const secondSpecDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Case',
                fieldApiName: 'Sub_Type__c',
                controllingFieldApiName: 'Type',
                expectations: [{ controllingValue: 'Problem', dependentValues: ['Hardware'] }]
            };

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([buildSpecDetail(), secondSpecDetail]);

            expect(generatedApex).toContain(`.expectNone('Antarctica'),`);
            expect(generatedApex).toContain(`PicklistDependencySpec.forField('Case', 'Sub_Type__c')`);

        });

        test('given picklist values containing quotes and backslashes, the emitted Apex escapes them', async () => {

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(picklistDependencyMockObjectsPath);
            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent(collectionResult.specDetails);

            expect(generatedApex).toContain(`.expectAtLeast('O\\'Brien', new List<String>{ 'Value\\'s One', 'Plain' })`);
            expect(generatedApex).toContain(`.expectAtLeast('Back\\\\Slash', new List<String>{ 'Plain' })`);
            expect(generatedApex).toContain(`.expectNone('Unlocks_Nothing')`);

        });

        test('given no spec details, an empty list initializer is produced', () => {

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([]);

            expect(generatedApex).toContain('return new List<PicklistDependencySpec>();');

        });

        test('given generated content, api names are emitted verbatim', () => {

            const generatedApex = PicklistDependencyTestService.generateApexSpecsClassContent([buildSpecDetail()]);

            expect(generatedApex).toContain(`forField('Account', 'Region__c')`);

        });

    });

    describe('getApexClassMetaContent', () => {

        test('given a source api version, the meta xml carries that api version', () => {

            const metaContent = PicklistDependencyTestService.getApexClassMetaContent('64.0');

            expect(metaContent).toContain('<apiVersion>64.0</apiVersion>');
            expect(metaContent).toContain('<status>Active</status>');

        });

    });

    describe('bundled framework assets', () => {

        const frameworkAssetsDirectoryPath = path.resolve(__dirname, '../../../../../resources/apex');
        const forceAppClassesDirectoryPath = path.resolve(__dirname, '../../../../../force-app/main/default/classes');

        test('given the extension assets directory, every framework class the generated file compiles against is bundled', () => {

            PicklistDependencyTestService.getFrameworkClassNames().forEach(frameworkClassName => {

                expect(fs.existsSync(path.join(frameworkAssetsDirectoryPath, `${frameworkClassName}.cls`))).toBe(true);
                expect(fs.existsSync(path.join(frameworkAssetsDirectoryPath, `${frameworkClassName}.cls-meta.xml`))).toBe(true);

            });

        });

        /*
            The .vsix excludes force-app/**, so the bundled copies under resources/apex are what a user
            actually receives. Silent drift between the two would ship a stale framework, so the copies
            are asserted identical rather than trusted to be kept in sync by hand.
        */
        test('given the bundled assets, each is byte identical to its force-app source of truth', () => {

            PicklistDependencyTestService.getFrameworkClassNames().forEach(frameworkClassName => {

                [`${frameworkClassName}.cls`, `${frameworkClassName}.cls-meta.xml`].forEach(frameworkFileName => {

                    const bundledContent = fs.readFileSync(path.join(frameworkAssetsDirectoryPath, frameworkFileName), 'utf8');
                    const forceAppContent = fs.readFileSync(path.join(forceAppClassesDirectoryPath, frameworkFileName), 'utf8');

                    expect(bundledContent).toBe(forceAppContent);

                });

            });

        });

        test('given the test-only stub source, it is not bundled for scaffolding into a user org', () => {

            expect(PicklistDependencyTestService.getFrameworkClassNames()).not.toContain('StubPicklistDependencySource');
            expect(fs.existsSync(path.join(frameworkAssetsDirectoryPath, 'StubPicklistDependencySource.cls'))).toBe(false);

        });

        test('given the generated specs class name, it is not scaffolded as a framework class', () => {

            expect(PicklistDependencyTestService.getFrameworkClassNames()).not.toContain('PicklistDependencySpecs');

        });

    });

    describe('getFrameworkAssetsDirectoryPath', () => {

        test('given the extension layout, the bundled resources/apex directory is resolved', () => {

            const frameworkAssetsDirectoryPath = PicklistDependencyTestService.getFrameworkAssetsDirectoryPath();

            expect(fs.existsSync(frameworkAssetsDirectoryPath)).toBe(true);
            expect(frameworkAssetsDirectoryPath.endsWith(path.join('resources', 'apex'))).toBe(true);

        });

        test('given no resources/apex directory anywhere above the service, an actionable error is thrown', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            expect(() => PicklistDependencyTestService.getFrameworkAssetsDirectoryPath())
                .toThrow('Unable to locate the bundled Apex picklist dependency framework assets');

        });

    });

    describe('scaffoldFrameworkClasses', () => {

        test('given a classes directory missing every framework class, each bundled file is copied', () => {

            jest.spyOn(PicklistDependencyTestService, 'getFrameworkAssetsDirectoryPath').mockReturnValue('/mock/resources/apex');
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath) => {
                return String(checkedPath).startsWith('/mock/resources/apex');
            });
            const copyFileSyncSpy = jest.spyOn(fs, 'copyFileSync').mockReturnValue();

            const scaffoldedFileNames = PicklistDependencyTestService.scaffoldFrameworkClasses('/mock/classes');

            const expectedFileCount = PicklistDependencyTestService.getFrameworkClassNames().length * 2;
            expect(scaffoldedFileNames).toHaveLength(expectedFileCount);
            expect(copyFileSyncSpy).toHaveBeenCalledTimes(expectedFileCount);

        });

        test('given a classes directory that already has the framework classes, nothing is overwritten', () => {

            jest.spyOn(PicklistDependencyTestService, 'getFrameworkAssetsDirectoryPath').mockReturnValue('/mock/resources/apex');
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            const copyFileSyncSpy = jest.spyOn(fs, 'copyFileSync').mockReturnValue();

            const scaffoldedFileNames = PicklistDependencyTestService.scaffoldFrameworkClasses('/mock/classes');

            expect(scaffoldedFileNames).toHaveLength(0);
            expect(copyFileSyncSpy).not.toHaveBeenCalled();

        });

        test('given a bundled asset that is absent, the missing asset is skipped rather than throwing', () => {

            jest.spyOn(PicklistDependencyTestService, 'getFrameworkAssetsDirectoryPath').mockReturnValue('/mock/resources/apex');
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            const copyFileSyncSpy = jest.spyOn(fs, 'copyFileSync').mockReturnValue();

            const scaffoldedFileNames = PicklistDependencyTestService.scaffoldFrameworkClasses('/mock/classes');

            expect(scaffoldedFileNames).toHaveLength(0);
            expect(copyFileSyncSpy).not.toHaveBeenCalled();

        });

    });

    describe('generated file naming', () => {

        test('given the service, the generated class and meta file names match the Apex framework registry class', () => {

            expect(PicklistDependencyTestService.getApexSpecsClassName()).toBe('PicklistDependencySpecs');
            expect(PicklistDependencyTestService.getApexSpecsClassFileName()).toBe('PicklistDependencySpecs.cls');
            expect(PicklistDependencyTestService.getApexSpecsClassMetaFileName()).toBe('PicklistDependencySpecs.cls-meta.xml');

        });

    });

});
