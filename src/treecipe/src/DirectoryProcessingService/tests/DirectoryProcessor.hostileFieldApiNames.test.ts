import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #120. Generate Treecipe's real pipeline over fields whose <fullName> -- the api name written as a
    recipe line's YAML KEY -- carries every line break either YAML parser recognises, a ": ", a
    template literal, and only whitespace. (An EMPTY <fullName> never reaches the recipe: FieldInfo.create
    refuses it; RecipeService.test.ts covers it at the writer.) The breaks are XML character references
    (&#10;, &#x2028;), so each name reads as ONE line in the source and only xml2js turns it into a
    break. Location covers the compound path: its component names are built from the hostile name.

    The same object also carries the two other metadata NAMES that reach a recipe: a record type
    <fullName> (written into the RecordTypeId options and every record-type line in both backends)
    and a dependent picklist's <controllingField> (written into its when: expression). One record
    type and one controlling field are ordinary, so the valid path is exercised beside the refused one.

    Every file must load in js-yaml and PyYAML with only the declared valid fields, and Run Faker by
    Recipe over the faker-js recipe must evaluate nothing a name carries.

    vscode is replaced by a read-only stand-in over the real file system, as in
    DirectoryProcessor.hostilePicklistValues.test.ts.
*/
jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    try {
                        return realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath)
            }
        },
        Uri: {
            file: toUri,
            parse: (uriText: string) => toUri(uriText.replace(/^file:\/\//, '')),
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        },
        window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn()
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { GlobalValueSetSingleton } from '../../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { INJECTED_FIELD_API_NAME, INJECTION_MARKER } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const HOSTILE_METADATA_PATH = path.join(__dirname, 'mocks', 'HostileFieldApiNameSalesforceMetadataDirectory');
const HOSTILE_OBJECTS_PATH = path.join(HOSTILE_METADATA_PATH, 'objects');
const HOSTILE_OBJECT_API_NAME = 'HostileApiName__c';

const INJECTED_LINE = `${INJECTED_FIELD_API_NAME}: \${{ globalThis.${INJECTION_MARKER} = true }}`;
const EXPECTED_HOSTILE_FIELD_NAMES = [
    `A\n    ${INJECTED_LINE}\n    Z`,
    `A\r    ${INJECTED_LINE}\r    Z`,
    `A\r\n    ${INJECTED_LINE}\r\n    Z`,
    `A\u2028    ${INJECTED_LINE}\u2028    Z`,
    `A\u0085    ${INJECTED_LINE}\u0085    Z`,
    INJECTED_LINE,
    `a\`\${globalThis.${INJECTION_MARKER}=true}\`b`,
    '   ',
    `Geo\n    ${INJECTED_LINE}\n    Geo__c`
];
// LOCATION EXPANDS TO TWO COMPONENTS, EACH CARRYING THE HOSTILE NAME
const EXPECTED_SKIPPED_FIELD_COUNT = EXPECTED_HOSTILE_FIELD_NAMES.length + 1;
const EXPECTED_HOSTILE_CONTROLLING_FIELD_NAMES = [
    `Controlling__c\n    ${INJECTED_LINE}\n    Z`,
    `Controlling__c == 'A' or globalThis.${INJECTION_MARKER} or Controlling__c`
];
const EXPECTED_HOSTILE_RECORD_TYPE_NAMES = [
    `Evil\n    ${INJECTED_LINE}\n    Z`,
    `Evil\u2028    ${INJECTED_LINE}\u2028    Z`
];
const DECLARED_FIELD_API_NAMES = ['Controlling__c', 'DependentExpression__c', 'DependentLineBreak__c', 'Ordinary__c', 'RecordTypeId', 'RecordTypePicklist__c'];
const SKIPPED_FIELD_TODO_PATTERN = /^ {4}### TODO -- FIELD SKIPPED -- api name ".*" is not a valid Salesforce api name/;
const SKIPPED_RECORD_TYPE_TODO_PATTERN = /^ {4}### TODO -- RECORD TYPE SKIPPED -- developer name ".*" is not a valid Salesforce api name/;
const SKIPPED_DEPENDENT_PICKLIST_TODO_PATTERN = /^ {4}(?:DependentExpression__c|DependentLineBreak__c): {2}### TODO -- DEPENDENT PICKLIST SKIPPED -- controlling field ".*" is not a valid Salesforce api name/;
const EVERY_LINE_BREAK = /\r\n|\r|\n|\u0085|\u2028|\u2029/;

type LoadedRecipeEntry = { object?: string, fields?: Record<string, unknown> };

function mockConfiguration(createFakerService: () => IRecipeFakerService) {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

}

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    mockConfiguration(createFakerService);
    await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);
    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(HOSTILE_OBJECTS_PATH));

    // WHAT GENERATE TREECIPE WRITES -- NESTED UNDER friends: FOR faker-js (#46), FLAT FOR SNOWFAKERY
    return objectInfoWrapper.RecipeFiles;

}

const findHostileRecipeFile = (recipeFiles: RecipeFileOutput[]): RecipeFileOutput =>
    recipeFiles.find(recipeFile => recipeFile.content.includes(`- object: ${HOSTILE_OBJECT_API_NAME}`));

describe('the hostile field api name fixture', () => {

    test('decodes to exactly the hostile names, so the tests below are about them', async () => {

        mockConfiguration(() => new FakerJSRecipeFakerService());
        await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);
        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(HOSTILE_OBJECTS_PATH));
        const decodedFieldNames = objectInfoWrapper.ObjectToObjectInfoMap[HOSTILE_OBJECT_API_NAME].Fields.map(fieldInfo => fieldInfo.fieldName);

        expect(decodedFieldNames).toEqual(expect.arrayContaining([...DECLARED_FIELD_API_NAMES.filter(fieldName => fieldName !== 'RecordTypeId'), ...EXPECTED_HOSTILE_FIELD_NAMES.filter(fieldName => !fieldName.startsWith('Geo'))]));
        expect(decodedFieldNames.filter(fieldName => fieldName.startsWith('Geo'))).toHaveLength(2);
        expect(objectInfoWrapper.ObjectToObjectInfoMap[HOSTILE_OBJECT_API_NAME].Fields
            .filter(fieldInfo => fieldInfo.controllingField)
            .map(fieldInfo => fieldInfo.controllingField)
            .sort()).toEqual([...EXPECTED_HOSTILE_CONTROLLING_FIELD_NAMES].sort());
        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap[HOSTILE_OBJECT_API_NAME].RecordTypesMap).sort())
            .toEqual([...EXPECTED_HOSTILE_RECORD_TYPE_NAMES, 'Valid'].sort());

    });

});

// ONE PROBE FOR THE FILE, NOT ONE PER BACKEND describe.each RUNS
const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over hostile field api names', (unusedBackend, createFakerService) => {

    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(createFakerService);
    });

    test('writes the hostile object with only the declared valid fields', () => {

        const hostileEntries = recipeFiles
            .flatMap(recipeFile => yaml.load(recipeFile.content) as LoadedRecipeEntry[])
            .filter(recipeEntry => recipeEntry.object === HOSTILE_OBJECT_API_NAME);

        expect(hostileEntries).toHaveLength(1);
        expect(Object.keys(hostileEntries[0].fields).sort()).toEqual(DECLARED_FIELD_API_NAMES);
        expect(hostileEntries[0].fields['DependentLineBreak__c']).toBeNull();
        expect(hostileEntries[0].fields['DependentExpression__c']).toBeNull();

    });

    test('writes each skipped field, record type and dependent picklist as one TODO line, and no line names the injected field', () => {

        const recipeLines = findHostileRecipeFile(recipeFiles).content.split(EVERY_LINE_BREAK);

        expect(recipeLines.filter(recipeLine => SKIPPED_FIELD_TODO_PATTERN.test(recipeLine))).toHaveLength(EXPECTED_SKIPPED_FIELD_COUNT);
        expect(recipeLines.filter(recipeLine => SKIPPED_RECORD_TYPE_TODO_PATTERN.test(recipeLine))).toHaveLength(EXPECTED_HOSTILE_RECORD_TYPE_NAMES.length);
        expect(recipeLines.filter(recipeLine => SKIPPED_DEPENDENT_PICKLIST_TODO_PATTERN.test(recipeLine))).toHaveLength(EXPECTED_HOSTILE_CONTROLLING_FIELD_NAMES.length);
        recipeLines.forEach(recipeLine => {
            expect(recipeLine).not.toMatch(new RegExp(`^\\s*${INJECTED_FIELD_API_NAME}:`));
        });

    });

    testRequiringPyYaml('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = recipeFiles.map(recipeFile => recipeFile.content);

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

});

describe('Run Faker by Recipe with faker-js over hostile field api names', () => {

    let recipeDirectoryPath: string;

    beforeAll(() => {
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-api-name-'));
    });

    afterAll(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[INJECTION_MARKER];
    });

    test('generates only the declared valid fields and never evaluates an injected expression', async () => {

        const hostileRecipeFile = findHostileRecipeFile(await generateRecipeFiles(() => new FakerJSRecipeFakerService()));
        const recipeFilePath = path.join(recipeDirectoryPath, hostileRecipeFile.fileName);
        // THE RECORD TYPE LINE IS SET TO THE ONE VALID RECORD TYPE, AS A USER CHOOSING ONE WOULD -- THE GENERATED DEFAULT IS ALREADY ONE DEVELOPER NAME (#157)
        const runnableRecipeText = hostileRecipeFile.content.replace(/^( {4}RecordTypeId: ).*$/m, '$1Valid');
        fs.writeFileSync(recipeFilePath, runnableRecipeText);

        const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, string> }>;
        const hostileRecords = generatedRecords.filter(generatedRecord => generatedRecord.object === HOSTILE_OBJECT_API_NAME);

        expect(globalThis).not.toHaveProperty(INJECTION_MARKER);
        expect(hostileRecords).toHaveLength(1);
        expect(Object.keys(hostileRecords[0].fields).sort()).toEqual(DECLARED_FIELD_API_NAMES);

    });

});

describe('Generate Treecipe over the ordinary mock metadata', () => {

    test('skips no field, so every ordinary api name is written exactly as before', async () => {

        const mockMetadataPath = path.join(__dirname, 'mocks', 'MockSalesforceMetadataDirectory');
        mockConfiguration(() => new FakerJSRecipeFakerService());
        await GlobalValueSetSingleton.getInstance().initialize(mockMetadataPath);
        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(path.join(mockMetadataPath, 'objects')));
        const recipeFiles = objectInfoWrapper.RecipeFiles;

        expect(recipeFiles.length).toBeGreaterThan(0);
        recipeFiles.forEach(recipeFile => {
            expect(recipeFile.content).not.toContain('FIELD SKIPPED');
        });

    });

});
