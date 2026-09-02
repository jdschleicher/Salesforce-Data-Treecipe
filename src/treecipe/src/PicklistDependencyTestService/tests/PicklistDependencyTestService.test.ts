import { PicklistDependencyTestService, IPicklistDependencySpecDetail, IRecordTypePicklistDependencySpecDetail } from "../PicklistDependencyTestService";
import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";
import { XmlFileProcessor } from "../../XMLProcessingService/XmlFileProcessor";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import * as fs from 'fs';
import * as os from 'os';
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
const mockChainExampleFieldsPath = path.join(mockMetadataDirectoryPath, 'Chain_Example__c', 'fields');

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

            const specDetailLabels = collectionResult.specDetails.map(specDetail => `${specDetail.objectApiName}.${specDetail.fieldApiName}`);
            expect(specDetailLabels).toIncludeSameMembers([
                'Dependency_Example__c.Neighborhood__c',
                'Dependency_Example__c.SpecialCharacterDependent__c',
                'Chain_Example__c.State__c',
                'Chain_Example__c.City__c'
            ]);

            const controllingFieldApiNamesByLabel = Object.fromEntries(
                collectionResult.specDetails.map(specDetail => [`${specDetail.objectApiName}.${specDetail.fieldApiName}`, specDetail.controllingFieldApiName])
            );
            expect(controllingFieldApiNamesByLabel['Dependency_Example__c.Neighborhood__c']).toBe('City__c');
            expect(controllingFieldApiNamesByLabel['Chain_Example__c.City__c']).toBe('State__c');

            const noValueSettingsWarnings = collectionResult.skippedFieldWarnings.filter(
                skippedFieldWarning => skippedFieldWarning.includes('NoValueSettingsDependent__c')
            );
            expect(noValueSettingsWarnings).toHaveLength(1);
            expect(noValueSettingsWarnings[0]).toContain('valueSettings');

        });

        test('given a three level chain, links only the middle and leaf specs to their upstream field', async () => {

            pointMockedVSCodeFileSystemAtFixtures();

            const objectsDirectoryUri = vscode.Uri.file(mockMetadataDirectoryPath);
            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            const upstreamFieldApiNamesByLabel = Object.fromEntries(
                collectionResult.specDetails.map(specDetail => [`${specDetail.objectApiName}.${specDetail.fieldApiName}`, specDetail.upstreamFieldApiName])
            );

            // Country__c IS A PLAIN PICKLIST, SO State__c IS THE ROOT OF THE CHAIN AND HAS NO UPSTREAM SPEC
            expect(upstreamFieldApiNamesByLabel['Chain_Example__c.State__c']).toBeUndefined();
            expect(upstreamFieldApiNamesByLabel['Chain_Example__c.City__c']).toBe('State__c');

        });

        test('given a dependent picklist, records the complement of each controlling value as its forbidden values', async () => {

            pointMockedVSCodeFileSystemAtFixtures();

            const objectsDirectoryUri = vscode.Uri.file(mockMetadataDirectoryPath);
            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            const stateSpecDetail = collectionResult.specDetails.find(
                specDetail => specDetail.objectApiName === 'Chain_Example__c' && specDetail.fieldApiName === 'State__c'
            )!;

            const usaExpectation = stateSpecDetail.expectations.find(expectation => expectation.controllingValue === 'USA')!;
            expect(usaExpectation.dependentValues).toIncludeSameMembers(['Ohio', 'Texas']);
            expect(usaExpectation.forbiddenValues).toIncludeSameMembers(['Ontario']);

            const canadaExpectation = stateSpecDetail.expectations.find(expectation => expectation.controllingValue === 'Canada')!;
            expect(canadaExpectation.dependentValues).toIncludeSameMembers(['Ontario']);
            expect(canadaExpectation.forbiddenValues).toIncludeSameMembers(['Ohio', 'Texas']);

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

    describe('buildPerObjectSpecsApexClassBody', () => {

        const specDetailWithBothMatchModes: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [
                { controllingValue: 'cle', dependentValues: ['ohiocity', 'tremont'], forbiddenValues: ['willowick'] },
                { controllingValue: 'akron', dependentValues: [] }
            ]
        };

        const buildBodyForSpecDetails = (specDetails: IPicklistDependencySpecDetail[]) =>
            PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                specDetails[0].objectApiName,
                PicklistDependencyTestService.buildPerObjectSpecsClassName(specDetails[0].objectApiName),
                specDetails
            );

        test('given spec details, emits forField, controlledBy, expectAtLeast and expectNone markup', () => {

            const apexClassBody = buildBodyForSpecDetails([specDetailWithBothMatchModes]);

            expect(apexClassBody).toContain(`public class SDTPLDSpecs_Dependency_Example_c {`);
            expect(apexClassBody).toContain(`SDTPicklistDependencySpec.forField('Dependency_Example__c', 'Neighborhood__c')`);
            expect(apexClassBody).toContain(`.controlledBy('City__c')`);
            expect(apexClassBody).toContain(`.expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })`);
            expect(apexClassBody).toContain(`.expectNone('akron')`);

        });

        test('given forbidden values, emits an expectNotAllowed line beside the expectAtLeast line', () => {

            const apexClassBody = buildBodyForSpecDetails([specDetailWithBothMatchModes]);

            expect(apexClassBody).toContain(`.expectNotAllowed('cle', new List<String>{ 'willowick' })`);

        });

        test('given a controlling value with no forbidden values, emits no expectNotAllowed line for it', () => {

            const apexClassBody = buildBodyForSpecDetails([{
                ...specDetailWithBothMatchModes,
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'], forbiddenValues: [] }]
            }]);

            expect(apexClassBody).toContain(`.expectAtLeast('cle', new List<String>{ 'ohiocity' })`);
            expect(apexClassBody).not.toContain('.expectNotAllowed(');

        });

        test('given a controlling value that unlocks nothing, emits expectNone without a redundant expectNotAllowed', () => {

            const apexClassBody = buildBodyForSpecDetails([{
                ...specDetailWithBothMatchModes,
                expectations: [{ controllingValue: 'akron', dependentValues: [], forbiddenValues: ['ohiocity', 'tremont'] }]
            }]);

            expect(apexClassBody).toContain(`.expectNone('akron')`);
            // expectNone ALREADY ASSERTS NOTHING IS UNLOCKED, WHICH IS STRICTLY STRONGER
            expect(apexClassBody).not.toContain('.expectNotAllowed(');

        });

        test('given a spec whose controlling field is itself dependent, emits a dependsOn call naming that sibling spec method', () => {

            const upstreamSpecDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'State__c',
                controllingFieldApiName: 'Country__c',
                expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: ['Ontario'] }]
            };

            const downstreamSpecDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'City__c',
                controllingFieldApiName: 'State__c',
                expectations: [{ controllingValue: 'Ohio', dependentValues: ['Cleveland'], forbiddenValues: ['Austin'] }],
                upstreamFieldApiName: 'State__c'
            };

            const apexClassBody = buildBodyForSpecDetails([upstreamSpecDetail, downstreamSpecDetail]);

            expect(apexClassBody).toContain('.dependsOn(specFor_Chain_Example_c_State_c())');
            // THE ROOT OF THE CHAIN HAS NOTHING UPSTREAM OF IT
            expect([...apexClassBody.matchAll(/\.dependsOn\(/g)]).toHaveLength(1);

        });

        test('given an upstream field that was skipped, emits no dependsOn rather than naming a method that does not exist', () => {

            /*
                A controlling field can be dependent AND still produce no spec -- a field with a
                controllingField but no valueSettings is skipped with a warning. The downstream spec
                still records it as upstream, so emission has to tolerate the spec method being absent
                or it would name a method that was never generated and the class would not compile.
            */
            const downstreamWithSkippedUpstream: IPicklistDependencySpecDetail = {
                objectApiName: 'Chain_Example__c',
                fieldApiName: 'City__c',
                controllingFieldApiName: 'State__c',
                expectations: [{ controllingValue: 'Ohio', dependentValues: ['Cleveland'], forbiddenValues: ['Austin'] }],
                upstreamFieldApiName: 'State__c'
            };

            const apexClassBody = buildBodyForSpecDetails([downstreamWithSkippedUpstream]);

            expect(apexClassBody).not.toContain('.dependsOn(');
            expect(apexClassBody).toContain(`.controlledBy('State__c')`);
            expect(apexClassBody).toContain(`.expectAtLeast('Ohio', new List<String>{ 'Cleveland' })`);

        });

        test('given multiple specs, emits one method per scenario and returns them all from all()', () => {

            const secondSpecDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'SpecialCharacterDependent__c',
                controllingFieldApiName: 'City__c',
                expectations: [{ controllingValue: 'cle', dependentValues: [`Bob's Diner`] }]
            };

            const apexClassBody = buildBodyForSpecDetails([specDetailWithBothMatchModes, secondSpecDetail]);

            // EACH SCENARIO IS ITS OWN FACTORY METHOD
            expect(apexClassBody).toContain('public static SDTPicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c()');
            expect(apexClassBody).toContain('public static SDTPicklistDependencySpec specFor_Dependency_Example_c_SpecialCharacterDependent_c()');

            // AND all() RETURNS THE COLLECTION OF THEM, COMMA SEPARATED
            expect(apexClassBody).toContain(`            specFor_Dependency_Example_c_Neighborhood_c(),\n            specFor_Dependency_Example_c_SpecialCharacterDependent_c()`);

        });

        test('emits no spec method name containing two consecutive underscores', () => {

            const apexClassBody = buildBodyForSpecDetails([
                { ...specDetailWithBothMatchModes, objectApiName: 'My_NS__Obj__c', fieldApiName: 'Some__Field__c' },
                { ...specDetailWithBothMatchModes, objectApiName: 'My_NS__Obj__c', fieldApiName: 'Other__Field__c' }
            ]);

            const emittedMethodNames = [...apexClassBody.matchAll(/SDTPicklistDependencySpec (\w+)\(\)/g)].map(match => match[1]);

            expect(emittedMethodNames.length).toBeGreaterThan(0);
            expect(emittedMethodNames).toSatisfyAll((methodName: string) => !methodName.includes('__'));

        });

        test('given two scenarios whose names collapse to one identifier, emits distinct method names', () => {

            const apexClassBody = buildBodyForSpecDetails([
                { ...specDetailWithBothMatchModes, objectApiName: 'Foo__c', fieldApiName: 'Bar__c' },
                { ...specDetailWithBothMatchModes, objectApiName: 'Foo__c', fieldApiName: 'Bar_c' }
            ]);

            const emittedMethodNames = [...apexClassBody.matchAll(/public static SDTPicklistDependencySpec (\w+)\(\)/g)].map(match => match[1]);

            expect(new Set(emittedMethodNames).size).toBe(emittedMethodNames.length);

        });

        test('given picklist values with special characters, emits escaped Apex string literals', async () => {

            const controllingFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'City__c.field-meta.xml');
            const specialCharacterFieldDetail = await getFieldDetailByFixtureFileName(mockDependencyExampleFieldsPath, 'SpecialCharacterDependent__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Dependency_Example__c',
                [controllingFieldDetail, specialCharacterFieldDetail]
            );
            const apexClassBody = buildBodyForSpecDetails(collectionResult.specDetails);

            expect(apexClassBody).toContain(`'Bob\\'s Diner'`);
            expect(apexClassBody).toContain(`'Back\\\\Slash'`);
            expect(apexClassBody).toContain(`'Tom & Jerry\\'s'`);

            // API NAMES ARE EMITTED VERBATIM
            expect(apexClassBody).toContain(`'SpecialCharacterDependent__c'`);

        });

        test('given no spec details, emits a compiling class returning an empty list', () => {

            const apexClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                'Dependency_Example__c',
                'SDTPLDSpecs_Dependency_Example_c',
                []
            );

            expect(apexClassBody).toContain('return new List<SDTPicklistDependencySpec>();');
            // NO SCENARIO METHODS AT ALL, RATHER THAN AN EMPTY ONE
            expect(apexClassBody).not.toContain('public static SDTPicklistDependencySpec specFor_');

        });

    });

    describe('buildPerObjectSpecsClassNamesByObjectApiName', () => {

        test('given an object api name, collapses underscore runs into a valid Apex class name', () => {

            expect(PicklistDependencyTestService.buildPerObjectSpecsClassName('Dependency_Example__c'))
                .toBe('SDTPLDSpecs_Dependency_Example_c');

        });

        test('given two object api names that collapse to one identifier, suffixes the later class name', () => {

            const classNamesByObjectApiName = PicklistDependencyTestService
                .buildPerObjectSpecsClassNamesByObjectApiName(['Foo__c', 'Foo_c']);

            expect(classNamesByObjectApiName['Foo__c']).toBe('SDTPLDSpecs_Foo_c');
            expect(classNamesByObjectApiName['Foo_c']).toBe('SDTPLDSpecs_Foo_c_2');

        });

        test('never emits a class name longer than the 40 character Salesforce ApexClass limit', () => {

            /*
                A custom object api name can itself reach 40 characters, so this is not a theoretical
                bound -- the previous "SDTPicklistDependencySpecs_" prefix spent 27 of the 40 before
                the object name began and failed the deploy for almost any custom object.
            */
            const longestPossibleObjectApiName = `${'A'.repeat(37)}__c`;

            const className = PicklistDependencyTestService.buildPerObjectSpecsClassName(longestPossibleObjectApiName);

            expect(className.length).toBeLessThanOrEqual(40);
            expect(className).toStartWith('SDTPLDSpecs_');
            // APEX FORBIDS TWO CONSECUTIVE UNDERSCORES IN AN IDENTIFIER
            expect(className).not.toContain('__');

        });

        test('given the same over-long object api name, returns the same class name on every run', () => {

            const objectApiName = `${'Order_Line_Item'.repeat(3)}__c`;

            const firstRunClassName = PicklistDependencyTestService.buildPerObjectSpecsClassName(objectApiName);
            const secondRunClassName = PicklistDependencyTestService.buildPerObjectSpecsClassName(objectApiName);

            // AN UNSTABLE NAME WOULD ORPHAN THE PREVIOUSLY GENERATED CLASS IN THE ORG ON EVERY REGENERATION
            expect(firstRunClassName).toBe(secondRunClassName);

        });

        test('given two over-long object api names sharing a truncated prefix, still emits distinct class names', () => {

            const firstObjectApiName = `${'Shared_Prefix_Value'.repeat(2)}_One__c`;
            const secondObjectApiName = `${'Shared_Prefix_Value'.repeat(2)}_Two__c`;

            const firstClassName = PicklistDependencyTestService.buildPerObjectSpecsClassName(firstObjectApiName);
            const secondClassName = PicklistDependencyTestService.buildPerObjectSpecsClassName(secondObjectApiName);

            expect(firstClassName).not.toBe(secondClassName);
            expect(firstClassName.length).toBeLessThanOrEqual(40);
            expect(secondClassName.length).toBeLessThanOrEqual(40);

        });

        test('given an object api name starting with a digit, prefixes it so the class name is a valid identifier', () => {

            expect(PicklistDependencyTestService.buildPerObjectSpecsClassName('9Lives__c'))
                .toBe('SDTPLDSpecs_object9Lives_c');

        });

    });

    describe('buildAggregatorSpecsApexClassBody', () => {

        test('given per-object class names, emits an all() that adds each of them', () => {

            const apexClassBody = PicklistDependencyTestService.buildAggregatorSpecsApexClassBody({
                'Account': 'SDTPLDSpecs_Account',
                'Dependency_Example__c': 'SDTPLDSpecs_Dependency_Example_c'
            });

            expect(apexClassBody).toContain('public class SDTPLDSpecs {');
            expect(apexClassBody).toContain('specs.addAll(SDTPLDSpecs_Account.all());');
            expect(apexClassBody).toContain('specs.addAll(SDTPLDSpecs_Dependency_Example_c.all());');

        });

        test('given no per-object classes, emits a compiling all() returning an empty list', () => {

            const apexClassBody = PicklistDependencyTestService.buildAggregatorSpecsApexClassBody({});

            expect(apexClassBody).toContain('return new List<SDTPicklistDependencySpec>();');
            expect(apexClassBody).not.toContain('.all());');

        });

    });

    describe('buildSpecsTestApexClassBody', () => {

        const accountSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Account',
            fieldApiName: 'Type__c',
            controllingFieldApiName: 'Industry__c',
            expectations: [{ controllingValue: 'Tech', dependentValues: ['SaaS'] }]
        };

        const dependencyExampleSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [{ controllingValue: 'cle', dependentValues: ['tremont'] }]
        };

        test('given spec details, emits an IsTest class rather than a plain class', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([accountSpecDetail]);

            expect(apexTestClassBody).toContain('@IsTest');
            expect(apexTestClassBody).toContain('private class SDTPLDSpecsTest {');
            expect(apexTestClassBody).toContain('new SDTPicklistDependencyValidator(new SDTSchemaPicklistDependencySource())');

        });

        test('given specs across multiple objects, emits one test method per object', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([
                accountSpecDetail,
                dependencyExampleSpecDetail
            ]);

            expect(apexTestClassBody).toContain('static void Account_picklistDependenciesMatchSourceMetadata()');
            expect(apexTestClassBody).toContain('static void Dependency_Example_c_picklistDependenciesMatchSourceMetadata()');

        });

        test('given several specs on one object, emits a single test method for that object', () => {

            const secondAccountSpecDetail: IPicklistDependencySpecDetail = {
                ...accountSpecDetail,
                fieldApiName: 'SubType__c'
            };

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([
                accountSpecDetail,
                secondAccountSpecDetail
            ]);

            const accountMethodOccurrences = apexTestClassBody.split('static void Account_picklistDependenciesMatchSourceMetadata()').length - 1;

            expect(accountMethodOccurrences).toBe(1);

        });

        test('always emits an assertion that fails when the spec registry is empty', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([accountSpecDetail]);

            expect(apexTestClassBody).toContain('static void specRegistryIsNotEmpty()');
            expect(apexTestClassBody).toContain('Assert.isFalse(');
            expect(apexTestClassBody).toContain('SDTPLDSpecs.all().isEmpty()');

        });

        test('given no spec details, still emits the empty registry guard so nothing passes vacuously', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([]);

            expect(apexTestClassBody).toContain('static void specRegistryIsNotEmpty()');
            expect(apexTestClassBody).not.toContain('_picklistDependenciesMatchSourceMetadata()');

        });

        /*
            A whole-class guard rather than a per-name one: any future change that reintroduces a
            double underscore anywhere in an emitted identifier fails here, regardless of which
            helper produced it.
        */
        test('emits no apex identifier containing two consecutive underscores', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([
                accountSpecDetail,
                dependencyExampleSpecDetail,
                { ...accountSpecDetail, objectApiName: 'My_NS__Obj__c' }
            ]);

            const emittedMethodNames = [...apexTestClassBody.matchAll(/static void (\w+)\(/g)].map(match => match[1]);

            expect(emittedMethodNames.length).toBeGreaterThan(0);
            expect(emittedMethodNames).toSatisfyAll((methodName: string) => !methodName.includes('__'));

        });

        test('given objects whose names collapse to one identifier, emits distinct method names', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([
                { ...accountSpecDetail, objectApiName: 'Foo__c' },
                { ...accountSpecDetail, objectApiName: 'Foo_c' }
            ]);

            const emittedMethodNames = [...apexTestClassBody.matchAll(/static void (\w+)\(/g)].map(match => match[1]);

            expect(new Set(emittedMethodNames).size).toBe(emittedMethodNames.length);

        });

        test('emits a failure message naming the object and the drifted combinations', () => {

            const apexTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([accountSpecDetail]);

            expect(apexTestClassBody).toContain('Picklist dependency drift on ');
            expect(apexTestClassBody).toContain('failure.toLine()');

        });

    });

    describe('non Salesforce files in a fields directory', () => {

        /*
            The DirectoryProcessing mock fixtures contain "gfh__c.xml" -- CustomField markup for a
            dependent picklist, but WITHOUT the ".field-meta.xml" suffix Salesforce requires. Matching
            on ".xml" alone generated a spec for it, so the registry asserted a field the org has no
            reason to have. The fixture is left in place deliberately as the regression case.
        */
        test('given a fields directory holding an xml file without the field-meta suffix, generates no spec for it', async () => {

            pointMockedVSCodeFileSystemAtFixtures();

            const objectsDirectoryUri = vscode.Uri.file(
                path.join(existingDirectoryProcessingMocksFieldsPath, '..', '..')
            );

            const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            const strayFileSpecDetails = collectionResult.specDetails.filter(specDetail => specDetail.fieldApiName.includes('gfh'));
            expect(strayFileSpecDetails).toBeEmpty();

            // THE PROPERLY NAMED DEPENDENT PICKLIST IN THE SAME DIRECTORY IS STILL PICKED UP
            const realSpecDetails = collectionResult.specDetails.filter(specDetail => specDetail.fieldApiName === 'DependentPicklist__c');
            expect(realSpecDetails).toHaveLength(1);

        });

    });

    describe('record type scoped specs', () => {

        const neighborhoodSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [
                { controllingValue: 'cle', dependentValues: ['ohiocity', 'tremont'], forbiddenValues: ['willowick'] },
                { controllingValue: 'eastlake', dependentValues: ['willowick'], forbiddenValues: ['ohiocity', 'tremont'] },
                { controllingValue: 'akron', dependentValues: [], forbiddenValues: [] }
            ]
        };

        function buildRecordTypeWrapper(developerName: string, picklistValuesByFieldApiName: Record<string, string[]>): RecordTypeWrapper {

            let recordTypeWrapper = new RecordTypeWrapper();
            recordTypeWrapper.DeveloperName = developerName;
            recordTypeWrapper.PicklistFieldSectionsToPicklistDetail = picklistValuesByFieldApiName;

            return recordTypeWrapper;

        }

        describe('buildRecordTypeExpectations', () => {

            test('given a record type assigning a subset of the dependent values, narrows the expectation to that subset', () => {

                const recordTypeExpectations = PicklistDependencyTestService.buildRecordTypeExpectations(
                    neighborhoodSpecDetail.expectations,
                    ['cle', 'eastlake'],
                    ['ohiocity', 'willowick']
                );

                const cleExpectation = recordTypeExpectations.find(expectation => expectation.controllingValue === 'cle');
                expect(cleExpectation.dependentValues).toEqual(['ohiocity']);

                // tremont IS NOT NAMED AS FORBIDDEN: THE RECORD TYPE DOES NOT EXPOSE IT AT ALL
                expect(cleExpectation.forbiddenValues).toEqual(['willowick']);

            });

            test('given a controlling value the record type does not assign, builds an empty expectation for it', () => {

                const recordTypeExpectations = PicklistDependencyTestService.buildRecordTypeExpectations(
                    neighborhoodSpecDetail.expectations,
                    ['cle'],
                    ['ohiocity', 'tremont', 'willowick']
                );

                const eastlakeExpectation = recordTypeExpectations.find(expectation => expectation.controllingValue === 'eastlake');
                expect(eastlakeExpectation.dependentValues).toBeEmpty();
                expect(eastlakeExpectation.forbiddenValues).toBeEmpty();

            });

            test('given a controlling value whose unlocked values the record type assigns none of, builds an empty expectation with no complement', () => {

                const recordTypeExpectations = PicklistDependencyTestService.buildRecordTypeExpectations(
                    neighborhoodSpecDetail.expectations,
                    ['cle', 'eastlake'],
                    ['willowick']
                );

                const cleExpectation = recordTypeExpectations.find(expectation => expectation.controllingValue === 'cle');
                expect(cleExpectation.dependentValues).toBeEmpty();
                expect(cleExpectation.forbiddenValues).toBeEmpty();

                // AND THE COMBINATION THE RECORD TYPE DOES REACH IS STILL ASSERTED
                const eastlakeExpectation = recordTypeExpectations.find(expectation => expectation.controllingValue === 'eastlake');
                expect(eastlakeExpectation.dependentValues).toEqual(['willowick']);

            });

            test('given a record type assigning every declared value, produces the same expectations as the field level ones', () => {

                const recordTypeExpectations = PicklistDependencyTestService.buildRecordTypeExpectations(
                    neighborhoodSpecDetail.expectations,
                    ['cle', 'eastlake', 'akron'],
                    ['ohiocity', 'tremont', 'willowick']
                );

                expect(recordTypeExpectations).toEqual(neighborhoodSpecDetail.expectations);

            });

        });

        describe('buildRecordTypeSpecDetails', () => {

            test('given a record type assigning both fields, builds a scoped spec detail carrying the record type developer name', () => {

                const recordTypeWrapper = buildRecordTypeWrapper('Cleveland_Only', {
                    City__c: ['cle'],
                    Neighborhood__c: ['ohiocity', 'tremont', 'willowick']
                });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.skippedFieldWarnings).toBeEmpty();
                expect(recordTypeResult.recordTypeSpecDetails).toHaveLength(1);

                const recordTypeSpecDetail = recordTypeResult.recordTypeSpecDetails[0];
                expect(recordTypeSpecDetail.recordTypeDeveloperName).toBe('Cleveland_Only');
                expect(recordTypeSpecDetail.objectApiName).toBe('Dependency_Example__c');
                expect(recordTypeSpecDetail.fieldApiName).toBe('Neighborhood__c');
                expect(recordTypeSpecDetail.controllingFieldApiName).toBe('City__c');

                const eastlakeExpectation = recordTypeSpecDetail.expectations.find(expectation => expectation.controllingValue === 'eastlake');
                expect(eastlakeExpectation.dependentValues).toBeEmpty();

            });

            test('given a record type that does not assign the dependent field, skips the combination with a warning naming the field', () => {

                const recordTypeWrapper = buildRecordTypeWrapper('Controlling_Field_Only', { City__c: ['cle', 'eastlake'] });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toBeEmpty();
                expect(recordTypeResult.skippedFieldWarnings).toHaveLength(1);
                expect(recordTypeResult.skippedFieldWarnings[0]).toContain('Controlling_Field_Only');
                expect(recordTypeResult.skippedFieldWarnings[0]).toContain('Neighborhood__c');

            });

            test('given a record type that does not assign the controlling field, skips the combination with a warning naming that field', () => {

                const recordTypeWrapper = buildRecordTypeWrapper('Dependent_Field_Only', { Neighborhood__c: ['ohiocity'] });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toBeEmpty();
                expect(recordTypeResult.skippedFieldWarnings[0]).toContain('"City__c"');

            });

            test('given a record type with no picklist sections at all, skips every combination rather than assuming full assignment', () => {

                const recordTypeWrapper = buildRecordTypeWrapper('No_Picklist_Sections', {});

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toBeEmpty();
                expect(recordTypeResult.skippedFieldWarnings).toHaveLength(1);

            });

            test('given a record type wrapper carrying no picklist sections map at all, skips rather than throwing', () => {

                let recordTypeWrapper = new RecordTypeWrapper();
                recordTypeWrapper.DeveloperName = 'Sections_Never_Parsed';

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toBeEmpty();
                expect(recordTypeResult.skippedFieldWarnings).toHaveLength(1);

            });

            test('given a record type developer name that is not a valid api name, skips it with one warning rather than emitting it', () => {

                const recordTypeWrapper = buildRecordTypeWrapper(`Injected'); System.debug('`, {
                    City__c: ['cle'],
                    Neighborhood__c: ['ohiocity']
                });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([neighborhoodSpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toBeEmpty();
                expect(recordTypeResult.skippedFieldWarnings).toHaveLength(1);
                expect(recordTypeResult.skippedFieldWarnings[0]).toContain('not a valid Salesforce api name');

            });

            test('given a chained spec whose upstream field the record type also scopes, keeps the upstream link', () => {

                const stateSpecDetail: IPicklistDependencySpecDetail = {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'State__c',
                    controllingFieldApiName: 'Country__c',
                    expectations: [{ controllingValue: 'USA', dependentValues: ['Ohio'], forbiddenValues: [] }]
                };

                const citySpecDetail: IPicklistDependencySpecDetail = {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Cleveland'], forbiddenValues: [] }],
                    upstreamFieldApiName: 'State__c'
                };

                const recordTypeWrapper = buildRecordTypeWrapper('North_America', {
                    Country__c: ['USA'],
                    State__c: ['Ohio'],
                    City__c: ['Cleveland']
                });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails(
                    [stateSpecDetail, citySpecDetail],
                    [recordTypeWrapper]
                );

                const scopedCitySpecDetail = recordTypeResult.recordTypeSpecDetails.find(
                    recordTypeSpecDetail => recordTypeSpecDetail.fieldApiName === 'City__c'
                );
                expect(scopedCitySpecDetail.upstreamFieldApiName).toBe('State__c');

            });

            test('given a chained spec whose upstream field the record type skips, drops the upstream link rather than naming a method that will not exist', () => {

                const citySpecDetail: IPicklistDependencySpecDetail = {
                    objectApiName: 'Chain_Example__c',
                    fieldApiName: 'City__c',
                    controllingFieldApiName: 'State__c',
                    expectations: [{ controllingValue: 'Ohio', dependentValues: ['Cleveland'], forbiddenValues: [] }],
                    upstreamFieldApiName: 'State__c'
                };

                const recordTypeWrapper = buildRecordTypeWrapper('North_America', {
                    State__c: ['Ohio'],
                    City__c: ['Cleveland']
                });

                const recordTypeResult = PicklistDependencyTestService.buildRecordTypeSpecDetails([citySpecDetail], [recordTypeWrapper]);

                expect(recordTypeResult.recordTypeSpecDetails).toHaveLength(1);
                expect(recordTypeResult.recordTypeSpecDetails[0].upstreamFieldApiName).toBeUndefined();

            });

        });

        describe('getRecordTypeWrappersByObjectDirectory', () => {

            test('given a fixture object directory, reads its record types sorted by developer name', async () => {

                pointMockedVSCodeFileSystemAtFixtures();

                const objectDirectoryUri = vscode.Uri.file(path.join(mockMetadataDirectoryPath, 'Dependency_Example__c'));
                const recordTypeCollectionResult = await PicklistDependencyTestService.getRecordTypeWrappersByObjectDirectory(
                    objectDirectoryUri,
                    'Dependency_Example__c'
                );

                expect(recordTypeCollectionResult.skippedRecordTypeWarnings).toBeEmpty();
                expect(recordTypeCollectionResult.recordTypeWrappers.map(recordTypeWrapper => recordTypeWrapper.DeveloperName))
                    .toEqual(['Cleveland_Only', 'Controlling_Field_Only']);

                const clevelandOnlyWrapper = recordTypeCollectionResult.recordTypeWrappers[0];
                expect(clevelandOnlyWrapper.PicklistFieldSectionsToPicklistDetail['City__c']).toEqual(['cle']);
                expect(clevelandOnlyWrapper.PicklistFieldSectionsToPicklistDetail['Neighborhood__c'])
                    .toIncludeSameMembers(['ohiocity', 'tremont', 'willowick']);

            });

            test('given a file that is not a record type metadata file, ignores it', async () => {

                (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
                    ['ReadMe.md', vscode.FileType.File],
                    ['Copy_Of_Something.xml', vscode.FileType.File]
                ]);

                /*
                    The jest.fn instances live in the vscode module factory, so their recorded calls
                    survive restoreMocks and carry over from the walk tests above.
                */
                (vscode.workspace.fs.readFile as jest.Mock).mockClear();

                const recordTypeCollectionResult = await PicklistDependencyTestService.getRecordTypeWrappersByObjectDirectory(
                    vscode.Uri.file('/workspace/objects/Dependency_Example__c'),
                    'Dependency_Example__c'
                );

                expect(recordTypeCollectionResult.recordTypeWrappers).toBeEmpty();
                expect(recordTypeCollectionResult.skippedRecordTypeWarnings).toBeEmpty();
                expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();

            });

            test('given a record type file that cannot be parsed, reports it and keeps reading the others', async () => {

                (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
                    ['Broken.recordType-meta.xml', vscode.FileType.File],
                    ['Working.recordType-meta.xml', vscode.FileType.File]
                ]);

                (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (fileUri: any) => {

                    if ( fileUri.fsPath.includes('Broken') ) {
                        return Buffer.from('<RecordType><fullName>Broken</fullName>');
                    }

                    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Working</fullName>
</RecordType>`);

                });

                const recordTypeCollectionResult = await PicklistDependencyTestService.getRecordTypeWrappersByObjectDirectory(
                    vscode.Uri.file('/workspace/objects/Dependency_Example__c'),
                    'Dependency_Example__c'
                );

                expect(recordTypeCollectionResult.recordTypeWrappers.map(recordTypeWrapper => recordTypeWrapper.DeveloperName)).toEqual(['Working']);
                expect(recordTypeCollectionResult.skippedRecordTypeWarnings).toHaveLength(1);
                expect(recordTypeCollectionResult.skippedRecordTypeWarnings[0]).toContain('Broken.recordType-meta.xml');

            });

            test('given a file carrying markup that is not a RecordType, reports it rather than reading a name off nothing', async () => {

                (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
                    ['Impostor.recordType-meta.xml', vscode.FileType.File]
                ]);

                (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Neighborhood__c</fullName></CustomField>')
                );

                const recordTypeCollectionResult = await PicklistDependencyTestService.getRecordTypeWrappersByObjectDirectory(
                    vscode.Uri.file('/workspace/objects/Dependency_Example__c'),
                    'Dependency_Example__c'
                );

                expect(recordTypeCollectionResult.recordTypeWrappers).toBeEmpty();
                expect(recordTypeCollectionResult.skippedRecordTypeWarnings[0]).toContain('Impostor.recordType-meta.xml');

            });

            test('given a record type file with no fullName markup, reports it rather than scoping specs by an undefined name', async () => {

                (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([
                    ['Nameless.recordType-meta.xml', vscode.FileType.File]
                ]);

                (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<RecordType xmlns="http://soap.sforce.com/2006/04/metadata"><label>Nameless</label></RecordType>')
                );

                const recordTypeCollectionResult = await PicklistDependencyTestService.getRecordTypeWrappersByObjectDirectory(
                    vscode.Uri.file('/workspace/objects/Dependency_Example__c'),
                    'Dependency_Example__c'
                );

                expect(recordTypeCollectionResult.recordTypeWrappers).toBeEmpty();
                expect(recordTypeCollectionResult.skippedRecordTypeWarnings[0]).toContain('fullName');

            });

        });

        describe('collectSpecDetailsByObjectsDirectory with record types', () => {

            test('given fixture objects with record types, collects one scoped spec per record type that assigns both fields', async () => {

                pointMockedVSCodeFileSystemAtFixtures();

                const objectsDirectoryUri = vscode.Uri.file(mockMetadataDirectoryPath);
                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

                const recordTypeSpecLabels = collectionResult.recordTypeSpecDetails.map(
                    recordTypeSpecDetail => `${recordTypeSpecDetail.objectApiName}.${recordTypeSpecDetail.fieldApiName} [${recordTypeSpecDetail.recordTypeDeveloperName}]`
                );

                expect(recordTypeSpecLabels).toIncludeSameMembers([
                    'Dependency_Example__c.Neighborhood__c [Cleveland_Only]',
                    'Dependency_Example__c.SpecialCharacterDependent__c [Cleveland_Only]',
                    'Chain_Example__c.State__c [North_America]',
                    'Chain_Example__c.City__c [North_America]'
                ]);

                // THE FIELD LEVEL SPECS ARE UNCHANGED BY RECORD TYPE COLLECTION
                expect(collectionResult.specDetails).toHaveLength(4);

                const scopedNeighborhoodSpecDetail = collectionResult.recordTypeSpecDetails.find(
                    recordTypeSpecDetail => recordTypeSpecDetail.fieldApiName === 'Neighborhood__c'
                );

                const scopedCleExpectation = scopedNeighborhoodSpecDetail.expectations.find(expectation => expectation.controllingValue === 'cle');
                expect(scopedCleExpectation.dependentValues).toIncludeSameMembers(['ohiocity', 'tremont']);
                expect(scopedCleExpectation.forbiddenValues).toEqual(['willowick']);

                // eastlake IS DECLARED BY City__c BUT THE Cleveland_Only RECORD TYPE DOES NOT ASSIGN IT
                const scopedEastlakeExpectation = scopedNeighborhoodSpecDetail.expectations.find(expectation => expectation.controllingValue === 'eastlake');
                expect(scopedEastlakeExpectation.dependentValues).toBeEmpty();

            });

            test('given a record type that assigns only the controlling field, reports the skip through the collection result', async () => {

                pointMockedVSCodeFileSystemAtFixtures();

                const objectsDirectoryUri = vscode.Uri.file(mockMetadataDirectoryPath);
                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

                const controllingFieldOnlyWarnings = collectionResult.skippedFieldWarnings.filter(
                    skippedFieldWarning => skippedFieldWarning.includes('Controlling_Field_Only')
                );

                expect(controllingFieldOnlyWarnings).toHaveLength(2);
                expect(controllingFieldOnlyWarnings[0]).toContain('The field-level spec still covers this field.');

            });

        test('given an object directory with no recordTypes sibling, collects specs but no scoped specs', async () => {

                pointMockedVSCodeFileSystemAtFixtures();

                /*
                    A copy of the Chain_Example__c fixture without its recordTypes directory: the
                    walk must produce the same field-level specs it always did and reach for nothing
                    else.
                */
                const objectDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-object-without-record-types-'));
                fs.cpSync(
                    path.join(mockMetadataDirectoryPath, 'Chain_Example__c', 'fields'),
                    path.join(objectDirectoryPath, 'Chain_Example__c', 'fields'),
                    { recursive: true }
                );

                const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(
                    vscode.Uri.file(objectDirectoryPath)
                );

                expect(collectionResult.specDetails).toHaveLength(2);
                expect(collectionResult.recordTypeSpecDetails).toBeEmpty();
                expect(collectionResult.skippedFieldWarnings).toBeEmpty();

                fs.rmSync(objectDirectoryPath, { recursive: true, force: true });

            });

        });

        describe('record type scoped Apex emission', () => {

            const clevelandOnlySpecDetail: IRecordTypePicklistDependencySpecDetail = {
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'Neighborhood__c',
                controllingFieldApiName: 'City__c',
                recordTypeDeveloperName: 'Cleveland_Only',
                expectations: [
                    { controllingValue: 'cle', dependentValues: ['ohiocity'], forbiddenValues: ['willowick'] },
                    { controllingValue: 'eastlake', dependentValues: [], forbiddenValues: [] }
                ]
            };

            test('given a record type scoped detail, emits forRecordType rather than forField', () => {

                const specStatement = PicklistDependencyTestService.buildSpecStatement(clevelandOnlySpecDetail);

                expect(specStatement).toContain(`SDTPicklistDependencySpec.forRecordType('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only')`);
                expect(specStatement).toContain(`.controlledBy('City__c')`);
                expect(specStatement).toContain(`.expectAtLeast('cle', new List<String>{ 'ohiocity' })`);
                expect(specStatement).toContain(`.expectNotAllowed('cle', new List<String>{ 'willowick' })`);
                expect(specStatement).toContain(`.expectNone('eastlake')`);

            });

            test('given a record type developer name, the spec method name keeps it distinct from the field level one', () => {

                const fieldLevelMethodName = PicklistDependencyTestService.buildSpecMethodName('Dependency_Example__c', 'Neighborhood__c');
                const recordTypeMethodName = PicklistDependencyTestService.buildSpecMethodName('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only');

                expect(recordTypeMethodName).toBe(`${fieldLevelMethodName}_recordType_Cleveland_Only`);
                // APEX IDENTIFIERS MAY NOT CONTAIN TWO CONSECUTIVE UNDERSCORES
                expect(recordTypeMethodName).not.toContain('__');

            });

            test('given record type scoped details, the per object class emits them and a recordTypeSpecs collection', () => {

                const perObjectClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                    'Dependency_Example__c',
                    'SDTPLDSpecs_Dependency_Example_c',
                    [neighborhoodSpecDetail],
                    [clevelandOnlySpecDetail]
                );

                expect(perObjectClassBody).toContain('public static List<SDTPicklistDependencySpec> recordTypeSpecs() {');
                expect(perObjectClassBody).toContain('specFor_Dependency_Example_c_Neighborhood_c_recordType_Cleveland_Only()');

                // THE RECORD TYPE SCOPED SPECS STAY OUT OF all(), WHICH THE GENERATED TEST CLASS VALIDATES
                const allMethodBody = perObjectClassBody.split('public static List<SDTPicklistDependencySpec> all() {')[1]
                                                            .split('}')[0];
                expect(allMethodBody).not.toContain('recordType');

            });

            test('given no record type scoped details, the per object class body is unchanged', () => {

                const withoutRecordTypeArgument = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                    'Dependency_Example__c',
                    'SDTPLDSpecs_Dependency_Example_c',
                    [neighborhoodSpecDetail]
                );

                const withEmptyRecordTypeDetails = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                    'Dependency_Example__c',
                    'SDTPLDSpecs_Dependency_Example_c',
                    [neighborhoodSpecDetail],
                    []
                );

                expect(withEmptyRecordTypeDetails).toBe(withoutRecordTypeArgument);
                expect(withoutRecordTypeArgument).not.toContain('recordType');
                expect(withoutRecordTypeArgument).not.toContain('forRecordType');

            });

            test('given an object with record type scoped specs, the aggregator exposes them separately from all()', () => {

                const aggregatorClassBody = PicklistDependencyTestService.buildAggregatorSpecsApexClassBody(
                    { Dependency_Example__c: 'SDTPLDSpecs_Dependency_Example_c', Chain_Example__c: 'SDTPLDSpecs_Chain_Example_c' },
                    ['Dependency_Example__c']
                );

                expect(aggregatorClassBody).toContain('public static List<SDTPicklistDependencySpec> allRecordTypeScoped() {');
                expect(aggregatorClassBody).toContain('recordTypeScopedSpecs.addAll(SDTPLDSpecs_Dependency_Example_c.recordTypeSpecs());');

                // AN OBJECT WITH NO SCOPED SPECS EMITS NO recordTypeSpecs METHOD, SO IT MUST NOT BE CALLED
                expect(aggregatorClassBody).not.toContain('SDTPLDSpecs_Chain_Example_c.recordTypeSpecs()');

            });

            test('given no object with record type scoped specs, the aggregator is unchanged', () => {

                const aggregatorClassBody = PicklistDependencyTestService.buildAggregatorSpecsApexClassBody(
                    { Dependency_Example__c: 'SDTPLDSpecs_Dependency_Example_c' }
                );

                expect(aggregatorClassBody).not.toContain('allRecordTypeScoped');
                expect(aggregatorClassBody).not.toContain('recordTypeSpecs');

            });

            test('given record type scoped specs, the generated test class still asserts only the field level ones', () => {

                const specsTestClassBody = PicklistDependencyTestService.buildSpecsTestApexClassBody([neighborhoodSpecDetail]);

                expect(specsTestClassBody).toContain('SDTPLDSpecs.all()');
                expect(specsTestClassBody).not.toContain('allRecordTypeScoped');

            });

            test('given record type scoped specs, writeSpecsClassFiles writes them into the per object class file', () => {

                jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
                jest.spyOn(fs, 'existsSync').mockReturnValue(false);

                let writtenContentByFilePath: Record<string, string> = {};
                jest.spyOn(fs, 'writeFileSync').mockImplementation((filePath: any, fileContent: any) => {
                    writtenContentByFilePath[filePath] = fileContent;
                });

                const specsClassWriteResult = PicklistDependencyTestService.writeSpecsClassFiles(
                    '/workspace/force-app/main/default/classes',
                    [neighborhoodSpecDetail],
                    '64.0',
                    [clevelandOnlySpecDetail]
                );

                const perObjectClassFileContent = writtenContentByFilePath[
                    specsClassWriteResult.perObjectClassFilePathsByObjectApiName['Dependency_Example__c']
                ];
                expect(perObjectClassFileContent).toContain(`SDTPicklistDependencySpec.forRecordType('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only')`);

                expect(writtenContentByFilePath[specsClassWriteResult.aggregatorClassFilePath]).toContain('allRecordTypeScoped');

            });

        });

        describe('generated record type Apex against the shipped framework API', () => {

            test('forRecordType and its scoped accessors exist on the shipped SDTPicklistDependencySpec class', () => {

                const shippedSpecClassPath = path.join(
                    __dirname, '..', '..', '..', '..', '..',
                    'apexPicklistDependencyFramework', 'SDTPicklistDependencyFramework', 'SDTPicklistDependencySpec.cls'
                );
                const shippedSpecClassContent = fs.readFileSync(shippedSpecClassPath, 'utf-8');

                expect(shippedSpecClassContent).toContain('public static SDTPicklistDependencySpec forRecordType(String objectApiName, String fieldApiName, String recordTypeDeveloperName)');
                expect(shippedSpecClassContent).toContain('public Boolean isRecordTypeScoped()');

            });

            test('the shipped describe based source refuses a record type scoped spec rather than answering it', () => {

                const shippedSchemaSourcePath = path.join(
                    __dirname, '..', '..', '..', '..', '..',
                    'apexPicklistDependencyFramework', 'SDTPicklistDependencyFramework', 'SDTSchemaPicklistDependencySource.cls'
                );
                const shippedSchemaSourceContent = fs.readFileSync(shippedSchemaSourcePath, 'utf-8');

                expect(shippedSchemaSourceContent).toContain('if (spec.isRecordTypeScoped()) {');
                expect(shippedSchemaSourceContent).toContain('throw new PicklistDependencyException(');

            });

        });

    });

    describe('directory traversal scope', () => {

        /*
            Only "fields" and "recordTypes" are consumed. Descending into listViews or webLinks reads
            directories that cannot contribute a spec, and the cost scales with the number of objects
            in the org rather than the number of dependent picklists.
        */
        test('does not read directories that can contribute neither a field nor a record type', async () => {

            pointMockedVSCodeFileSystemAtFixtures();

            const readDirectoryPaths: string[] = [];
            const realReadDirectory = (vscode.workspace.fs.readDirectory as jest.Mock).getMockImplementation();

            (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (directoryUri: any) => {
                readDirectoryPaths.push(directoryUri.fsPath);
                return realReadDirectory(directoryUri);
            });

            const objectsDirectoryUri = vscode.Uri.file(
                path.join(existingDirectoryProcessingMocksFieldsPath, '..', '..')
            );

            await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(objectsDirectoryUri);

            const nonContributingDirectoriesRead = readDirectoryPaths.filter(readPath => /listViews|webLinks/.test(readPath));
            expect(nonContributingDirectoriesRead).toBeEmpty();

            // AND THE fields DIRECTORIES THEMSELVES ARE STILL READ
            expect(readDirectoryPaths.some(readPath => readPath.endsWith('fields'))).toBeTrue();

            // recordTypes IS READ, BUT ONLY FOR AN OBJECT THAT PRODUCED SPECS TO NARROW
            expect(readDirectoryPaths.some(readPath => readPath.endsWith('recordTypes'))).toBeTrue();

        });

    });

    describe('assertClassesDirectoryContainedInWorkspace', () => {

        test('given a classes directory inside the workspace, does not throw', () => {

            expect(() => PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(
                '/workspace/force-app/main/default/classes',
                '/workspace'
            )).not.toThrow();

        });

        /*
            resolveDefaultPackageDirectoryPath only contains the package directory itself. The
            "main/default/classes" segments appended afterwards can each be a symlink, and
            writeFileSync follows symlinks -- so the final path is re-checked at the point of use.
        */
        test('given a classes directory that escapes the workspace, throws before anything is written', () => {

            expect(() => PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(
                '/somewhere/else/classes',
                '/workspace'
            )).toThrow('outside the workspace');

        });

        test('given a sibling directory sharing the workspace name prefix, throws', () => {

            expect(() => PicklistDependencyTestService.assertClassesDirectoryContainedInWorkspace(
                '/workspace-evil/force-app/main/default/classes',
                '/workspace'
            )).toThrow('outside the workspace');

        });

    });

    describe('buildTestMethodNameByObjectApiName', () => {

        test('given a standard object api name, builds a valid apex identifier', () => {

            expect(PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Account'))
                .toBe('Account_picklistDependenciesMatchSourceMetadata');

        });

        /*
            Apex identifiers may not contain two consecutive underscores. Every custom object api
            name ends in "__c", so embedding one verbatim produced a class that failed to deploy with
            "Invalid character in identifier". Standard objects were unaffected, which is why the
            defect survived a live deploy check.
        */
        test('given a custom object api name, collapses the double underscore so the identifier is valid apex', () => {

            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Dependency_Example__c');

            expect(testMethodName).toBe('Dependency_Example_c_picklistDependenciesMatchSourceMetadata');
            expect(testMethodName).not.toContain('__');

        });

        test('given a namespaced api name, collapses every run of underscores', () => {

            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('My_NS__Obj__c');

            expect(testMethodName).toBe('My_NS_Obj_c_picklistDependenciesMatchSourceMetadata');
            expect(testMethodName).not.toContain('__');

        });

        // COLLAPSING RATHER THAN STRIPPING KEEPS "__c" AND "__e" TELLABLE APART
        test('given custom object and custom event api names, keeps them distinguishable', () => {

            const customObjectMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Thing__c');
            const platformEventMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('Thing__e');

            expect(customObjectMethodName).not.toBe(platformEventMethodName);

        });

        test('given an api name starting with a digit, prefixes it so the identifier stays valid', () => {

            const testMethodName = PicklistDependencyTestService.buildTestMethodNameByObjectApiName('2ndObject__c');

            expect(testMethodName).toStartWith('object2ndObject_c');
            expect(testMethodName).not.toStartWith('2');
            expect(testMethodName).not.toContain('__');

        });

    });

    describe('buildTestMethodNamesByObjectApiName', () => {

        /*
            Collapsing underscores can map two distinct api names onto one identifier, and two Apex
            methods with the same name will not compile.
        */
        test('given api names that collapse to the same identifier, disambiguates them', () => {

            const methodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(['Foo__c', 'Foo_c']);

            expect(methodNamesByObjectApiName['Foo__c']).not.toBe(methodNamesByObjectApiName['Foo_c']);

        });

        test('given no collisions, leaves every name unsuffixed', () => {

            const methodNamesByObjectApiName = PicklistDependencyTestService.buildTestMethodNamesByObjectApiName(['Account', 'Contact__c']);

            expect(methodNamesByObjectApiName['Account']).toBe('Account_picklistDependenciesMatchSourceMetadata');
            expect(methodNamesByObjectApiName['Contact__c']).toBe('Contact_c_picklistDependenciesMatchSourceMetadata');

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

        const classesDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'classes');

        const accountSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Account',
            fieldApiName: 'Region__c',
            controllingFieldApiName: 'Country__c',
            expectations: [{ controllingValue: 'USA', dependentValues: ['West'], forbiddenValues: ['Ontario'] }]
        };

        const dependencyExampleSpecDetail: IPicklistDependencySpecDetail = {
            objectApiName: 'Dependency_Example__c',
            fieldApiName: 'Neighborhood__c',
            controllingFieldApiName: 'City__c',
            expectations: [{ controllingValue: 'cle', dependentValues: ['tremont'], forbiddenValues: ['willowick'] }]
        };

        test('given spec details across two objects, writes one class per object plus the aggregator, each with a meta xml', () => {

            const makeDirectorySpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            const writeResult = PicklistDependencyTestService.writeSpecsClassFiles(
                classesDirectoryPath,
                [accountSpecDetail, dependencyExampleSpecDetail],
                '64.0'
            );

            expect(makeDirectorySpy).toHaveBeenCalledWith(classesDirectoryPath, { recursive: true });

            expect(writeResult.aggregatorClassFilePath).toBe(path.join(classesDirectoryPath, 'SDTPLDSpecs.cls'));
            expect(writeResult.perObjectClassFilePathsByObjectApiName).toEqual({
                'Account': path.join(classesDirectoryPath, 'SDTPLDSpecs_Account.cls'),
                'Dependency_Example__c': path.join(classesDirectoryPath, 'SDTPLDSpecs_Dependency_Example_c.cls')
            });

            // EVERY GENERATED CLASS GETS ITS meta xml, OR IT WILL NOT DEPLOY
            [
                'SDTPLDSpecs_Account.cls',
                'SDTPLDSpecs_Dependency_Example_c.cls',
                'SDTPLDSpecs.cls'
            ].forEach(generatedFileName => {
                const generatedFilePath = path.join(classesDirectoryPath, generatedFileName);
                expect(writeFileSpy).toHaveBeenCalledWith(generatedFilePath, expect.any(String));
                expect(writeFileSpy).toHaveBeenCalledWith(`${generatedFilePath}-meta.xml`, expect.stringContaining('<apiVersion>64.0</apiVersion>'));
            });

        });

        test('the aggregator it writes calls into every per-object class it wrote', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            let writtenBodiesByFilePath: Record<string, string> = {};
            jest.spyOn(fs, 'writeFileSync').mockImplementation((filePath: any, body: any) => {
                writtenBodiesByFilePath[String(filePath)] = String(body);
            });

            PicklistDependencyTestService.writeSpecsClassFiles(
                classesDirectoryPath,
                [accountSpecDetail, dependencyExampleSpecDetail],
                '64.0'
            );

            const aggregatorBody = writtenBodiesByFilePath[path.join(classesDirectoryPath, 'SDTPLDSpecs.cls')];

            expect(aggregatorBody).toContain('specs.addAll(SDTPLDSpecs_Account.all());');
            expect(aggregatorBody).toContain('specs.addAll(SDTPLDSpecs_Dependency_Example_c.all());');

        });

        test('given a generated class for an object no longer in the metadata, removes it and reports the removal', () => {

            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readdirSync').mockReturnValue([
                'SDTPLDSpecs_Account.cls',
                'SDTPLDSpecs_Retired_Object_c.cls',
                'SDTPLDSpecs.cls',
                'SDTPLDSpecsTest.cls',
                'SomeUnrelatedClass.cls'
            ] as any);
            const removeSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined);

            const writeResult = PicklistDependencyTestService.writeSpecsClassFiles(
                classesDirectoryPath,
                [accountSpecDetail],
                '64.0'
            );

            const stalePath = path.join(classesDirectoryPath, 'SDTPLDSpecs_Retired_Object_c.cls');

            expect(writeResult.removedStaleClassFilePaths).toEqual([stalePath]);
            expect(removeSpy).toHaveBeenCalledWith(stalePath, { force: true });
            expect(removeSpy).toHaveBeenCalledWith(`${stalePath}-meta.xml`, { force: true });

            // THE AGGREGATOR, THE TEST CLASS AND THE USER'S OWN APEX ARE NEVER TOUCHED
            const removedPaths = removeSpy.mock.calls.map(removeCall => String(removeCall[0]));
            expect(removedPaths).not.toContain(path.join(classesDirectoryPath, 'SDTPLDSpecs.cls'));
            expect(removedPaths).not.toContain(path.join(classesDirectoryPath, 'SDTPLDSpecsTest.cls'));
            expect(removedPaths).not.toContain(path.join(classesDirectoryPath, 'SomeUnrelatedClass.cls'));

        });

    });

    describe('isPerObjectSpecsClassFileName', () => {

        test('matches a generated per-object class file', () => {
            expect(PicklistDependencyTestService.isPerObjectSpecsClassFileName('SDTPLDSpecs_Account.cls')).toBeTrue();
        });

        test('does not match the aggregator or the generated test class', () => {
            expect(PicklistDependencyTestService.isPerObjectSpecsClassFileName('SDTPLDSpecs.cls')).toBeFalse();
            expect(PicklistDependencyTestService.isPerObjectSpecsClassFileName('SDTPLDSpecsTest.cls')).toBeFalse();
        });

        test('does not match a meta xml or an unrelated class', () => {
            expect(PicklistDependencyTestService.isPerObjectSpecsClassFileName('SDTPLDSpecs_Account.cls-meta.xml')).toBeFalse();
            expect(PicklistDependencyTestService.isPerObjectSpecsClassFileName('AccountService.cls')).toBeFalse();
        });

    });

    describe('detectLegacyGeneratedArtifacts', () => {

        const classesDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'classes');

        test('given a legacy framework directory and legacy spec classes, reports each of their paths', () => {

            const legacyFrameworkDirectoryPath = path.join(classesDirectoryPath, 'PicklistDependencyFramework');
            const legacySpecsClassFilePath = path.join(classesDirectoryPath, 'SFTreecipePicklistDependencySpecs.cls');

            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) =>
                String(checkedPath) === legacyFrameworkDirectoryPath || String(checkedPath) === legacySpecsClassFilePath);

            const legacyArtifactPaths = PicklistDependencyTestService.detectLegacyGeneratedArtifacts(classesDirectoryPath);

            expect(legacyArtifactPaths).toEqual([legacyFrameworkDirectoryPath, legacySpecsClassFilePath]);

        });

        test('given a workspace with nothing from an earlier version, reports nothing', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            expect(PicklistDependencyTestService.detectLegacyGeneratedArtifacts(classesDirectoryPath)).toEqual([]);

        });

        test('the warning names the paths to remove locally and the classes to delete from the org', () => {

            const legacyFrameworkDirectoryPath = path.join(classesDirectoryPath, 'PicklistDependencyFramework');

            const warning = PicklistDependencyTestService.buildLegacyArtifactWarning([legacyFrameworkDirectoryPath]);

            expect(warning).toContain(legacyFrameworkDirectoryPath);
            expect(warning).toContain('SFTreecipePicklistDependencySpecs');
            expect(warning).toContain('PicklistDependencyValidator');
            expect(warning).toContain('SchemaPicklistDependencySource');

        });

    });

    describe('scaffoldMissingFrameworkClasses', () => {

        const extensionPath = '/extension';
        const classesDirectoryPath = path.join('/workspace', 'force-app', 'main', 'default', 'classes');
        const shippedFrameworkClassesPath = path.join(extensionPath, 'apexPicklistDependencyFramework', 'SDTPicklistDependencyFramework');

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

            const alreadyPresentClassPath = path.join(classesDirectoryPath, 'SDTPicklistDependencySpec.cls');
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                return String(checkedPath).startsWith(shippedFrameworkClassesPath) || String(checkedPath) === alreadyPresentClassPath;
            });

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.scaffoldedClassNames).not.toContain('SDTPicklistDependencySpec');
            expect(frameworkScaffoldResult.scaffoldedClassNames).toContain('SDTPicklistDependencyValidator');
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

            const missingMetaFilePath = path.join(shippedFrameworkClassesPath, 'SDTPicklistDependencyValidator.cls-meta.xml');
            jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => {
                if ( String(checkedPath) === missingMetaFilePath ) {
                    return false;
                }
                return String(checkedPath).startsWith(shippedFrameworkClassesPath);
            });

            const frameworkScaffoldResult = PicklistDependencyTestService.scaffoldMissingFrameworkClasses(extensionPath, classesDirectoryPath);

            expect(frameworkScaffoldResult.unavailableClassNames).toEqual(['SDTPicklistDependencyValidator']);
            expect(frameworkScaffoldResult.scaffoldedClassNames).not.toContain('SDTPicklistDependencyValidator');

            // NO ORPHANED .cls IS LEFT BEHIND FOR THE CLASS WHOSE META XML WAS MISSING
            const copiedPaths = copyFileSpy.mock.calls.map(copyFileCall => String(copyFileCall[1]));
            expect(copiedPaths).not.toContain(path.join(classesDirectoryPath, 'SDTPicklistDependencyFramework', 'SDTPicklistDependencyValidator.cls'));

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

        const shippedFrameworkClassesPath = path.join(__dirname, '..', '..', '..', '..', '..', 'apexPicklistDependencyFramework', 'SDTPicklistDependencyFramework');

        test('emitted builder methods all exist on the shipped SDTPicklistDependencySpec class', async () => {

            /*
                The chain fixture is what exercises every builder the generator can emit: a root and a
                dependent-of-a-dependent give dependsOn, and restricted value sets give both halves of
                the positive/negative pair.
            */
            const countryFieldDetail = await getFieldDetailByFixtureFileName(mockChainExampleFieldsPath, 'Country__c.field-meta.xml');
            const stateFieldDetail = await getFieldDetailByFixtureFileName(mockChainExampleFieldsPath, 'State__c.field-meta.xml');
            const cityFieldDetail = await getFieldDetailByFixtureFileName(mockChainExampleFieldsPath, 'City__c.field-meta.xml');

            const collectionResult = PicklistDependencyTestService.buildSpecDetailsByObjectFieldDetails(
                'Chain_Example__c',
                [countryFieldDetail, stateFieldDetail, cityFieldDetail]
            );
            const apexClassBody = PicklistDependencyTestService.buildPerObjectSpecsApexClassBody(
                'Chain_Example__c',
                PicklistDependencyTestService.buildPerObjectSpecsClassName('Chain_Example__c'),
                collectionResult.specDetails
            );

            const shippedSpecClassBody = fs.readFileSync(path.join(shippedFrameworkClassesPath, 'SDTPicklistDependencySpec.cls'), 'utf-8');

            // ONLY CHAINED INSTANCE BUILDER CALLS -- forField IS STATIC AND IS ASSERTED SEPARATELY BELOW
            const emittedBuilderMethodNames = [...apexClassBody.matchAll(/^\s+\.([a-zA-Z]+)\(/gm)].map(matchResult => matchResult[1]);
            const uniqueEmittedBuilderMethodNames = [...new Set(emittedBuilderMethodNames)];

            expect(uniqueEmittedBuilderMethodNames).toIncludeSameMembers(['controlledBy', 'dependsOn', 'expectAtLeast', 'expectNotAllowed']);

            uniqueEmittedBuilderMethodNames.forEach(builderMethodName => {
                expect(shippedSpecClassBody).toContain(`public SDTPicklistDependencySpec ${builderMethodName}(`);
            });

            expect(shippedSpecClassBody).toContain('public static SDTPicklistDependencySpec forField(');

        });

        test('the shipped validator exposes the failure kind the negative assertions rely on', () => {

            const shippedValidatorClassBody = fs.readFileSync(path.join(shippedFrameworkClassesPath, 'SDTPicklistDependencyValidator.cls'), 'utf-8');

            expect(shippedValidatorClassBody).toContain('FORBIDDEN_VALUES_PRESENT');
            expect(shippedValidatorClassBody).toContain('UPSTREAM_FAILURE');
            expect(shippedValidatorClassBody).toContain('CIRCULAR_DEPENDENCY');

        });

        test('every framework class the generator scaffolds exists in the shipped framework directory', () => {

            PicklistDependencyTestService.getFrameworkClassNames().forEach(frameworkClassName => {
                expect(fs.existsSync(path.join(shippedFrameworkClassesPath, `${frameworkClassName}.cls`))).toBeTrue();
                expect(fs.existsSync(path.join(shippedFrameworkClassesPath, `${frameworkClassName}.cls-meta.xml`))).toBeTrue();
            });

        });

    });

});
