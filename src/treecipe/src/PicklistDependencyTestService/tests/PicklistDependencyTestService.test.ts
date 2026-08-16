import { PicklistDependencyTestService, IPicklistDependencySpecDetail } from "../PicklistDependencyTestService";
import { XmlFileProcessor } from "../../XMLProcessingService/XmlFileProcessor";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: {
            readDirectory: jest.fn(),
            readFile: jest.fn()
        }
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath }),
        joinPath: jest.fn().mockImplementation((baseUri, ...pathSegments) => ({
            fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}`.replace(/\/+/g, '/')
        }))
    },
    window: {
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn()
    },
    FileType: {
        Directory: 2,
        File: 1,
        SymbolicLink: 64
    }
}), { virtual: true });

const mockMetadataDirectoryPath = path.join(__dirname, 'mocks', 'MockPicklistDependencyMetadataDirectory', 'objects');
const mockDependencyExampleFieldsPath = path.join(mockMetadataDirectoryPath, 'Dependency_Example__c', 'fields');

const existingDirectoryProcessingMocksFieldsPath = path.join(
    __dirname, '..', '..',
    'DirectoryProcessingService', 'tests', 'mocks',
    'MockSalesforceMetadataDirectory', 'objects', 'Example_Everything__c', 'fields'
);

async function getFieldDetailByFixtureFileName(fieldsDirectoryPath: string, fieldFileName: string): Promise<XMLFieldDetail> {

    const fieldXmlContent = fs.readFileSync(path.join(fieldsDirectoryPath, fieldFileName), 'utf-8');
    return await XmlFileProcessor.processXmlFieldContent(fieldXmlContent, fieldFileName);

}

/*
    Backs the mocked vscode filesystem with the real fixture directory so the recursive walk is
    exercised against genuine Salesforce source-format metadata layout.
*/
function pointMockedVSCodeFileSystemAtFixtures() {

    (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (directoryUri: any) => {

        const directoryEntries = fs.readdirSync(directoryUri.fsPath, { withFileTypes: true });
        return directoryEntries.map(directoryEntry => [
            directoryEntry.name,
            directoryEntry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
        ]);

    });

    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (fileUri: any) => {
        return fs.readFileSync(fileUri.fsPath);
    });

}

describe('PicklistDependencyTestService', () => {

    describe('buildSpecDetailsByObjectFieldDetails', () => {

        test('given existing DependentPicklist__c fixture and its controlling field, builds one spec with an expectAtLeast per controlling value', async () => {

            const dependentFieldDetail = await getFieldDetailByFixtureFileName(existingDirectoryProcessingMocksFieldsPath, 'DependentPicklist__c.field-meta.xml');
            const controllingFieldDetail = await getFieldDetailByFixtureFileName(existingDirectoryProcessingMocksFieldsPath, 'Picklist__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Example_Everything__c',
                [dependentFieldDetail, controllingFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(1);
            expect(collectionResult.skippedFieldWarnings).toHaveLength(0);

            const specDetail = collectionResult.specDetails[0];
            expect(specDetail.objectApiName).toBe('Example_Everything__c');
            expect(specDetail.fieldApiName).toBe('DependentPicklist__c');
            expect(specDetail.controllingFieldApiName).toBe('Picklist__c');

            const cleExpectation = specDetail.expectations.find(expectation => expectation.controllingValue === 'cle');
            expect(cleExpectation.dependentValues).toIncludeSameMembers(['tree', 'weed', 'mulch', 'rocks']);

            const mentorExpectation = specDetail.expectations.find(expectation => expectation.controllingValue === 'mentor');
            expect(mentorExpectation.dependentValues).toIncludeSameMembers(['weed', 'plant']);

            // EVERY CONTROLLING VALUE ON Picklist__c UNLOCKS SOMETHING SO NO expectNone LINES ARE EXPECTED
            const emptyExpectations = specDetail.expectations.filter(expectation => expectation.dependentValues.length === 0);
            expect(emptyExpectations).toHaveLength(0);

        });

        test('given a controlling value that unlocks nothing, builds an empty expectation for that value', async () => {

            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');
            const dependentFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'Neighborhood__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [controllingFieldDetail, dependentFieldDetail]
            );

            const specDetail = collectionResult.specDetails[0];

            const akronExpectation = specDetail.expectations.find(expectation => expectation.controllingValue === 'akron');
            expect(akronExpectation).toBeDefined();
            expect(akronExpectation.dependentValues).toHaveLength(0);

            const cleExpectation = specDetail.expectations.find(expectation => expectation.controllingValue === 'cle');
            expect(cleExpectation.dependentValues).toIncludeSameMembers(['ohiocity', 'tremont']);

        });

        test('given a controlling field that is not among the parsed fields, emits no expectNone expectations', async () => {

            const dependentFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'Neighborhood__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [dependentFieldDetail]
            );

            const specDetail = collectionResult.specDetails[0];
            expect(specDetail.expectations).toHaveLength(2);
            expect(specDetail.expectations.every(expectation => expectation.dependentValues.length > 0)).toBe(true);

        });

        test('given a controllingField with no valueSettings, skips the field with a warning naming object and field', async () => {

            const noValueSettingsFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'NoValueSettingsDependent__c.field-meta.xml');
            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [noValueSettingsFieldDetail, controllingFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(0);
            expect(collectionResult.skippedFieldWarnings).toHaveLength(1);
            expect(collectionResult.skippedFieldWarnings[0]).toContain('Dependency_Example__c.NoValueSettingsDependent__c');
            expect(collectionResult.skippedFieldWarnings[0]).toContain('City__c');

        });

        test('given a field with no controllingField, builds no spec for it', async () => {

            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [controllingFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(0);
            expect(collectionResult.skippedFieldWarnings).toHaveLength(0);

        });

    });

    describe('collectSpecDetailsByObjectsDirectory', () => {

        test('given a metadata objects directory, walks it and collects specs and skip warnings together', async () => {

            pointMockedVSCodeFileSystemAtFixtures();

            const objectsDirectoryUri = vscode.Uri.file(mockMetadataDirectoryPath);
            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            const generatedFieldApiNames = collectionResult.specDetails.map(specDetail => specDetail.fieldApiName);
            expect(generatedFieldApiNames).toIncludeSameMembers(['Neighborhood__c', 'SpecialCharacterDependent__c']);

            collectionResult.specDetails.forEach(specDetail => {
                expect(specDetail.objectApiName).toBe('Dependency_Example__c');
                expect(specDetail.controllingFieldApiName).toBe('City__c');
            });

            expect(collectionResult.skippedFieldWarnings).toHaveLength(1);
            expect(collectionResult.skippedFieldWarnings[0]).toContain('NoValueSettingsDependent__c');

        });

        test('given a symlinked object directory, walks it rather than skipping it', async () => {

            // VS CODE REPORTS A SYMLINKED DIRECTORY AS THE "Directory | SymbolicLink" BITMASK, NOT AS Directory
            const symlinkedDirectoryType = vscode.FileType.Directory | vscode.FileType.SymbolicLink;

            (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (directoryUri: any) => {

                if ( directoryUri.fsPath.endsWith('/objects') ) {
                    return [['Dependency_Example__c', symlinkedDirectoryType]];
                }
                if ( directoryUri.fsPath.endsWith('/Dependency_Example__c') ) {
                    return [['fields', vscode.FileType.Directory]];
                }
                return fs.readdirSync(mockDependencyExampleFieldsPath, { withFileTypes: true })
                    .map(directoryEntry => [directoryEntry.name, vscode.FileType.File]);

            });

            (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (fileUri: any) => {
                return fs.readFileSync(path.join(mockDependencyExampleFieldsPath, path.basename(fileUri.fsPath)));
            });

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(
                vscode.Uri.file('/metadata/objects')
            );

            expect(collectionResult.specDetails.length).toBeGreaterThan(0);

        });

        /*
            Symlinked directories are walked, so a link pointing back up the tree would recurse
            until the stack is exhausted without a visited guard.
        */
        test('given a symlink loop back to an ancestor, terminates instead of recursing forever', async () => {

            const symlinkedDirectoryType = vscode.FileType.Directory | vscode.FileType.SymbolicLink;

            // EVERY DIRECTORY REPORTS A "loop" CHILD, AND realpath RESOLVES THEM ALL TO THE SAME DIRECTORY
            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([['loop', symlinkedDirectoryType]]);
            jest.spyOn(PicklistDependencyTestService, 'getRealDirectoryPath').mockReturnValue('/metadata/objects');

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(
                vscode.Uri.file('/metadata/objects')
            );

            expect(collectionResult.specDetails).toHaveLength(0);

        });

        test('given an empty directory, returns an empty collection result', async () => {

            (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);

            const objectsDirectoryUri = vscode.Uri.file('/no/entries/here');
            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            expect(collectionResult.specDetails).toHaveLength(0);
            expect(collectionResult.skippedFieldWarnings).toHaveLength(0);

        });

    });

    describe('escapeApexStringLiteral', () => {

        test('given a value containing a single quote, escapes it for an Apex string literal', () => {

            expect(PicklistDependencyTestService.escapeApexStringLiteral(`Bob's Diner`)).toBe(`Bob\\'s Diner`);

        });

        test('given a value containing a backslash, escapes the backslash before the quote escaping', () => {

            expect(PicklistDependencyTestService.escapeApexStringLiteral(`Back\\Slash`)).toBe(`Back\\\\Slash`);

        });

        test('given a value containing a newline, escapes it so the literal stays on one line', () => {

            expect(PicklistDependencyTestService.escapeApexStringLiteral("line\nbreak")).toBe('line\\nbreak');

        });

        test('given a value with an ampersand, leaves it untouched as it needs no Apex escaping', () => {

            expect(PicklistDependencyTestService.escapeApexStringLiteral('Tom & Jerry')).toBe('Tom & Jerry');

        });

    });

    describe('buildSpecsApexClassBody', () => {

        const specDetailWithBothMatchModes: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [
                { controllingValue: 'cle', dependentValues: ['ohiocity', 'tremont'] },
                { controllingValue: 'akron', dependentValues: [] }
            ]
        };

        test('given spec details, emits forField, controlledBy, expectAtLeast and expectNone markup', () => {

            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody([specDetailWithBothMatchModes]);

            expect(apexClassBody).toContain(`public class PicklistDependencySpecs {`);
            expect(apexClassBody).toContain(`PicklistDependencySpec.forField('Dependency_Example__c', 'Neighborhood__c')`);
            expect(apexClassBody).toContain(`.controlledBy('City__c')`);
            expect(apexClassBody).toContain(`.expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })`);
            expect(apexClassBody).toContain(`.expectNone('akron')`);

        });

        test('given multiple specs, separates the list elements with a comma', () => {

            const secondSpecDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'SpecialCharacterDependent__c',
                controllingFieldApiName: 'City__c',
                expectations: [{ controllingValue: 'cle', dependentValues: [`Bob's Diner`] }]
            };

            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody([specDetailWithBothMatchModes, secondSpecDetail]);

            expect(apexClassBody).toContain(`,\n            PicklistDependencySpec.forField('Dependency_Example__c', 'SpecialCharacterDependent__c')`);

        });

        test('given picklist values with special characters, emits escaped Apex string literals', async () => {

            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');
            const specialCharacterFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'SpecialCharacterDependent__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [controllingFieldDetail, specialCharacterFieldDetail]
            );
            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody(collectionResult.specDetails);

            expect(apexClassBody).toContain(`'Bob\\'s Diner'`);
            expect(apexClassBody).toContain(`'Back\\\\Slash'`);
            expect(apexClassBody).toContain(`'Tom & Jerry\\'s'`);

            // API NAMES ARE EMITTED VERBATIM
            expect(apexClassBody).toContain(`'SpecialCharacterDependent__c'`);

        });

        test('given no spec details, emits a compiling class returning an empty list', () => {

            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody([]);

            expect(apexClassBody).toContain('return new List<PicklistDependencySpec>();');

        });

    });

    describe('resolveDefaultPackageDirectoryPath', () => {

        test('given multiple package directories, resolves the one marked default', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [
                    { path: 'utilities' },
                    { path: 'force-app', default: true }
                ]
            }));

            const resolvedPackageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace');

            expect(resolvedPackageDirectoryPath).toBe(path.join('/workspace', 'force-app'));

        });

        test('given no package directory marked default, falls back to the first entry', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: 'utilities' }, { path: 'force-app' }]
            }));

            const resolvedPackageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace');

            expect(resolvedPackageDirectoryPath).toBe(path.join('/workspace', 'utilities'));

        });

        test('given no sfdx-project.json, throws an actionable error', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace'))
                .toThrow(/No "sfdx-project.json" found/);

        });

        test('given an sfdx-project.json with no packageDirectories, throws an actionable error', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ packageDirectories: [] }));

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace'))
                .toThrow(/No "packageDirectories" entries found/);

        });

        test('given a default package directory with no path value, throws an actionable error', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ default: true }]
            }));

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace'))
                .toThrow(/has no "path" value/);

        });

        /*
            The package directory path comes from a workspace file. path.join would silently
            normalize a traversing path into a location outside the folder the user opened, so
            containment is asserted rather than assumed.
        */
        test('given a package directory that traverses outside the workspace, throws and resolves nothing', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: '../../../../tmp/evil', default: true }]
            }));

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace/project'))
                .toThrow(/outside the workspace/);

        });

        test('given an absolute package directory path, throws rather than writing outside the project', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: path.sep + path.join('tmp', 'evil'), default: true }]
            }));

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace/project'))
                .toThrow(/is an absolute path/);

        });

        test('given a nested but contained package directory, resolves it normally', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: 'packages/core', default: true }]
            }));

            const resolvedPackageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace/project');

            expect(resolvedPackageDirectoryPath).toBe(path.resolve('/workspace/project', 'packages/core'));

        });

        /*
            "." is a legal packageDirectories path for a project that keeps metadata at the repo
            root, and resolves to the workspace root itself.
        */
        test('given a package directory of ".", resolves the workspace root rather than rejecting it', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'realpathSync').mockImplementation((checkedPath: any) => String(checkedPath));
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: '.', default: true }]
            }));

            const resolvedPackageDirectoryPath = PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace/project');

            expect(resolvedPackageDirectoryPath).toBe(path.resolve('/workspace/project'));

        });

        test('given a package directory whose real path escapes the workspace via a symlink, throws', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                packageDirectories: [{ path: 'force-app', default: true }]
            }));

            // THE PATH STRING IS INSIDE THE WORKSPACE BUT RESOLVES OUTSIDE IT
            jest.spyOn(fs, 'realpathSync').mockImplementation((checkedPath: any) => {
                return String(checkedPath).includes('force-app') ? '/somewhere/else' : String(checkedPath);
            });

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace/project'))
                .toThrow(/outside the workspace/);

        });

        test('given malformed sfdx-project.json, throws an actionable parse error naming the file', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue('{ "packageDirectories": [ }');

            expect(() => PicklistDependencyTestService.resolveDefaultPackageDirectoryPath('/workspace'))
                .toThrow(/Could not parse .*sfdx-project\.json.* as JSON/);

        });

    });

    describe('getSourceApiVersion', () => {

        test('given a sourceApiVersion in sfdx-project.json, returns it', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ sourceApiVersion: '62.0' }));

            expect(PicklistDependencyTestService.getSourceApiVersion('/workspace')).toBe('62.0');

        });

        test('given no sfdx-project.json, returns the default api version', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            expect(PicklistDependencyTestService.getSourceApiVersion('/workspace')).toBe('64.0');

        });

        // THE VERSION IS INTERPOLATED INTO GENERATED XML, SO ANYTHING BUT A PLAIN VERSION NUMBER IS REJECTED
        test('given a sourceApiVersion carrying XML markup, falls back to the default rather than emitting it', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
                sourceApiVersion: '64.0</apiVersion><fullName>Injected</fullName><apiVersion>64.0'
            }));

            const sourceApiVersion = PicklistDependencyTestService.getSourceApiVersion('/workspace');

            expect(sourceApiVersion).toBe('64.0');
            expect(PicklistDependencyTestService.buildApexClassMetaXml(sourceApiVersion)).not.toContain('Injected');

        });

        test('given a non-string sourceApiVersion, falls back to the default', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ sourceApiVersion: 64 }));

            expect(PicklistDependencyTestService.getSourceApiVersion('/workspace')).toBe('64.0');

        });

    });

    describe('buildApexClassMetaXml', () => {

        test('given an api version, builds ApexClass metadata markup carrying it', () => {

            const metaXml = PicklistDependencyTestService.buildApexClassMetaXml('64.0');

            expect(metaXml).toContain('<apiVersion>64.0</apiVersion>');
            expect(metaXml).toContain('<status>Active</status>');

        });

    });

    describe('writeSpecsClassFiles', () => {

        test('given a classes directory, writes the cls and its meta xml', () => {

            const makeDirectorySpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

            const classesDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'classes');
            const writtenFilePath = PicklistDependencyTestService.writeSpecsClassFiles(classesDirectoryPath, 'apex body', '64.0');

            expect(makeDirectorySpy).toHaveBeenCalledWith(classesDirectoryPath, { recursive: true });
            expect(writtenFilePath).toBe(path.join(classesDirectoryPath, 'PicklistDependencySpecs.cls'));
            expect(writeFileSpy).toHaveBeenCalledWith(writtenFilePath, 'apex body');
            expect(writeFileSpy).toHaveBeenCalledWith(`${writtenFilePath}-meta.xml`, expect.stringContaining('<apiVersion>64.0</apiVersion>'));

        });

    });

    describe('scaffoldMissingFrameworkClasses', () => {

        const extensionPath = '/extension';
        const classesDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'classes');
        const shippedFrameworkClassesPath = path.join(extensionPath, 'force-app', 'main', 'default', 'classes');

        test('given no framework classes in the workspace, copies every shipped framework class and its meta xml', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            const copyFileSpy = jest.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                // ONLY THE SHIPPED SOURCE FILES EXIST -- THE WORKSPACE HAS NONE OF THEM YET
                return String(checkedPath).startsWith(shippedFrameworkClassesPath);
            });

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.scaffoldedClassNames).toIncludeSameMembers(PicklistDependencyTestService.getFrameworkClassNames());
            expect(frameworkScaffoldResult.unavailableClassNames).toHaveLength(0);
            // ONE CALL FOR THE CLASS AND ONE FOR ITS META XML
            expect(copyFileSpy).toHaveBeenCalledTimes(PicklistDependencyTestService.getFrameworkClassNames().length * 2);

        });

        test('given a framework class already in the workspace, leaves it alone so a customized copy is preserved', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);

            const alreadyPresentClassPath = path.join(classesDirectoryPath, 'PicklistDependencySpec.cls');
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                return String(checkedPath).startsWith(shippedFrameworkClassesPath) || String(checkedPath) === alreadyPresentClassPath;
            });

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.scaffoldedClassNames).not.toContain('PicklistDependencySpec');
            expect(frameworkScaffoldResult.scaffoldedClassNames).toContain('PicklistDependencyValidator');
            expect(frameworkScaffoldResult.unavailableClassNames).toHaveLength(0);

        });

        /*
            The generated specs class cannot compile without the framework, so a class that could not
            be supplied has to be reported back instead of silently skipped.
        */
        test('given no shipped framework classes directory, reports every class as unavailable rather than silently scaffolding nothing', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.scaffoldedClassNames).toHaveLength(0);
            expect(frameworkScaffoldResult.unavailableClassNames).toIncludeSameMembers(PicklistDependencyTestService.getFrameworkClassNames());

        });

        test('given a shipped class with no companion meta xml, reports it unavailable and copies neither file', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            const copyFileSpy = jest.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);

            const missingMetaFilePath = path.join(shippedFrameworkClassesPath, 'PicklistDependencyValidator.cls-meta.xml');
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                if ( String(checkedPath) === missingMetaFilePath ) {
                    return false;
                }
                return String(checkedPath).startsWith(shippedFrameworkClassesPath);
            });

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.unavailableClassNames).toEqual(['PicklistDependencyValidator']);
            expect(frameworkScaffoldResult.scaffoldedClassNames).not.toContain('PicklistDependencyValidator');

            // NO ORPHANED .cls IS LEFT BEHIND FOR THE CLASS WHOSE META XML WAS MISSING
            const copiedPaths = copyFileSpy.mock.calls.map(copyFileCall => String(copyFileCall[1]));
            expect(copiedPaths).not.toContain(path.join(classesDirectoryPath, 'PicklistDependencyValidator.cls'));

        });

    });

    /*
        Adversarial coverage. Api names reach the emitter from a raw XML <fullName> text node and
        from a directory name on disk, so neither is trustworthy by construction.
    */
    describe('untrusted api name handling', () => {

        test('given an api name that breaks out of an Apex string literal, skips the spec with a warning instead of emitting it', () => {

            const dependentFieldDetail = {
                apiName: `X'); System.abortJob('`,
                fieldType: 'Picklist',
                controllingField: 'City__c',
                picklistValues: [
                    {
                        picklistOptionApiName: 'ohiocity',
                        label: 'ohiocity',
                        default: false,
                        isActive: true,
                        controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle']
                    }
                ]
            } as XMLFieldDetail;

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [dependentFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(0);
            expect(collectionResult.skippedFieldWarnings[0]).toContain('is not a valid Salesforce api name');

        });

        test('given an object directory name containing a quote, skips the spec rather than emitting the name', async () => {

            const dependentFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'Neighborhood__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                `Evil'__c`,
                [dependentFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(0);
            expect(collectionResult.skippedFieldWarnings[0]).toContain(`Evil'__c`);

        });

        test('given a controlling field api name with an embedded newline, skips the spec', async () => {

            const dependentFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'Neighborhood__c.field-meta.xml');
            dependentFieldDetail.controllingField = "City__c\nSystem.debug('x');";

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [dependentFieldDetail]
            );

            expect(collectionResult.specDetails).toHaveLength(0);

        });

        test('given legitimate api names including namespaces and custom suffixes, accepts them', () => {

            ['Account', 'Neighborhood__c', 'ns__Custom_Object__c', 'Event__e', 'X123_y'].forEach(validApiName => {
                expect(PicklistDependencyTestService.isValidSalesforceApiName(validApiName)).toBe(true);
            });

            [`Bad'Name`, 'has space', 'has-dash', '', 'semi;colon', 'new\nline'].forEach(invalidApiName => {
                expect(PicklistDependencyTestService.isValidSalesforceApiName(invalidApiName)).toBe(false);
            });

        });

        test('emitted api names are escaped even when they reach the statement builder directly', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: `Evil'Object`,
                fieldApiName: `Evil'Field`,
                controllingFieldApiName: `Evil'Controller`,
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'] }]
            };

            const specStatement = PicklistDependencyTestService.buildSpecStatement(specDetail);

            expect(specStatement).toContain(`'Evil\\'Object'`);
            expect(specStatement).toContain(`'Evil\\'Field'`);
            expect(specStatement).toContain(`'Evil\\'Controller'`);

        });

    });

    describe('generated Apex against the shipped framework API', () => {

        test('emitted builder methods all exist on the shipped PicklistDependencySpec class', async () => {

            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');
            const dependentFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'Neighborhood__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [controllingFieldDetail, dependentFieldDetail]
            );
            const apexClassBody = PicklistDependencyTestService.buildSpecsApexClassBody(collectionResult.specDetails);

            const shippedSpecClassPath = path.join(__dirname, '..', '..', '..', '..', '..', 'force-app', 'main', 'default', 'classes', 'PicklistDependencySpec.cls');
            const shippedSpecClassBody = fs.readFileSync(shippedSpecClassPath, 'utf-8');

            // ONLY CHAINED INSTANCE BUILDER CALLS -- forField IS STATIC AND IS ASSERTED SEPARATELY BELOW
            const emittedBuilderMethodNames = [...apexClassBody.matchAll(/^\s+\.([a-zA-Z]+)\(/gm)].map(matchResult => matchResult[1]);
            const uniqueEmittedBuilderMethodNames = [...new Set(emittedBuilderMethodNames)];

            expect(uniqueEmittedBuilderMethodNames).toIncludeSameMembers(['controlledBy', 'expectAtLeast', 'expectNone']);

            expect(uniqueEmittedBuilderMethodNames.length).toBeGreaterThan(0);
            uniqueEmittedBuilderMethodNames.forEach(builderMethodName => {
                expect(shippedSpecClassBody).toContain(`public PicklistDependencySpec ${builderMethodName}(`);
            });

            expect(shippedSpecClassBody).toContain('public static PicklistDependencySpec forField(');

        });

    });

});
