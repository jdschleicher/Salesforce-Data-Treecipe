import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    #155. Generate Treecipe's real pipeline -- DirectoryProcessor, global value sets, record types,
    RelationshipService grouping -- over metadata a hostile repository could hold: a picklist, a
    dependent picklist, a multi-select picklist, a global value set and two record types whose
    values carry every line break either YAML parser recognises, and every quote that could close
    the string a value is written into. The breaks are XML character references (&#10;, &#x2028;),
    so each value reads as ONE line in the source and only xml2js turns it into a break.

    Every file must load in js-yaml and PyYAML with no field the metadata did not declare, and Run
    Faker by Recipe over the faker-js recipe must evaluate nothing a value carries.

    vscode is replaced by a read-only stand-in over the real file system, as in
    DirectoryProcessor.generatedRecipeYaml.test.ts.
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
import { RelationshipService, RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import {
    HOSTILE_PICKLIST_VALUES,
    INJECTED_FIELD_API_NAME,
    INJECTION_MARKER
} from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';

import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const HOSTILE_METADATA_PATH = path.join(__dirname, 'mocks', 'HostileSalesforceMetadataDirectory');
const HOSTILE_OBJECTS_PATH = path.join(HOSTILE_METADATA_PATH, 'objects');

// THE FIXTURE CARRIES EVERY HOSTILE VALUE, THEN THREE ORDINARY ONES -- THE ONLY CONTROLLING VALUES ONE RECORD TYPE MAKES AVAILABLE
const FIXTURE_PICKLIST_VALUES = [...HOSTILE_PICKLIST_VALUES.map(([, hostileValue]) => hostileValue), "Rock 'n' Roll", 'A&B', 'C#'];
const DECLARED_FIELD_API_NAMES = ['Controlling__c', 'Dependent__c', 'Global__c', 'Multi__c', 'RecordTypeId'];

type LoadedRecipeEntry = { object?: string, fields?: Record<string, unknown> };

async function processHostileMetadata(createFakerService: () => IRecipeFakerService): Promise<ObjectInfoWrapper> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);
    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(HOSTILE_OBJECTS_PATH));

}

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    // WHAT GENERATE TREECIPE WRITES -- NESTED UNDER friends: FOR faker-js (#46), FLAT FOR SNOWFAKERY
    return (await processHostileMetadata(createFakerService)).RecipeFiles;

}

/*
    The fixture's one object has no parent, so its faker-js recipe is flat. Nesting is the case that
    moves every one of its lines -- every hostile value included -- four spaces deeper, so Hostile__c
    is given a parent here and the tree is written again with nesting on (#46).
*/
async function generateNestedRecipeFiles(): Promise<RecipeFileOutput[]> {

    const objectInfoWrapper = await processHostileMetadata(() => new FakerJSRecipeFakerService());
    const relationshipService = new RelationshipService();

    objectInfoWrapper.addKeyToObjectInfoMap('HostileParent__c');
    const parentObjectInfo = objectInfoWrapper.ObjectToObjectInfoMap['HostileParent__c'];
    parentObjectInfo.RelationshipDetail = relationshipService.buildNewRelationshipDetail('HostileParent__c');
    parentObjectInfo.FullRecipe = '\n- object: HostileParent__c\n  nickname: HostileParent__c_NickName\n  count: 1\n  fields:\n    Name: ${{ faker.company.name() }}';
    relationshipService.buildBidirectionalChildAndParentRelationshipReferences(
        new FieldInfo('Hostile__c', 'HostileParent__c', 'Hostile Parent', 'Lookup'),
        objectInfoWrapper,
        'Hostile__c',
        'HostileParent__c'
    );
    relationshipService.processAllRelationships(objectInfoWrapper);

    return relationshipService.generateSeparateRecipeFiles(objectInfoWrapper, true);

}

describe('the hostile metadata fixture', () => {

    test('decodes to exactly the hostile values, so the tests below are about them', async () => {

        await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);

        expect(GlobalValueSetSingleton.getInstance().getPicklistValueMaps()['HostileGlobal']).toEqual(FIXTURE_PICKLIST_VALUES);

    });

});

// ONE PROBE FOR THE FILE, NOT ONE PER BACKEND describe.each RUNS
const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over hostile picklist values', (unusedBackend, createFakerService) => {

    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(createFakerService);
    });

    const everyLoadedObjectEntry = (loadedRecipes: unknown[]): LoadedRecipeEntry[] =>
        loadedRecipes.flatMap(loadedRecipe => loadedRecipe as LoadedRecipeEntry[]).filter(recipeEntry => recipeEntry.object !== undefined);

    test('writes the hostile object with every picklist field, so the checks below are about them', () => {

        const hostileEntries = everyLoadedObjectEntry(recipeFiles.map(recipeFile => yaml.load(recipeFile.content)))
            .filter(recipeEntry => recipeEntry.object === 'Hostile__c');

        expect(hostileEntries).toHaveLength(1);
        expect(Object.keys(hostileEntries[0].fields).sort()).toEqual(DECLARED_FIELD_API_NAMES);

    });

    test('every recipe file loads with js-yaml, and declares no field the metadata did not', () => {

        const loadedRecipes = recipeFiles.map(recipeFile => yaml.load(recipeFile.content));

        everyLoadedObjectEntry(loadedRecipes).forEach(recipeEntry => {
            expect(DECLARED_FIELD_API_NAMES).toEqual(expect.arrayContaining(Object.keys(recipeEntry.fields)));
        });

    });

    testRequiringPyYaml('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = recipeFiles.map(recipeFile => recipeFile.content);

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

    test('the recipe text names no injected field on any line', () => {

        recipeFiles.forEach(recipeFile => {
            recipeFile.content.split(/\r\n|\r|\n|\u0085|\u2028|\u2029/).forEach(recipeLine => {
                expect(recipeLine).not.toMatch(new RegExp(`^\\s*${INJECTED_FIELD_API_NAME}:`));
            });
        });

    });

});

/*
    snowfakery renders every dependent choice it picks, in whichever of its Jinja environments the
    item's delimiters select -- including the legacy "<<" / "<%" one. Rendered that way, each choice
    the real pipeline wrote must come back as exactly a value the metadata declared.
*/
describe('Run Faker by Recipe with snowfakery over the hostile recipe', () => {

    PythonTestHarness.testRequiringModules('jinja2')('renders every dependent choice to exactly a declared value', async () => {

        const recipeFiles = await generateRecipeFiles(() => new SnowfakeryRecipeFakerService());
        const hostileEntry = recipeFiles
            .flatMap(recipeFile => yaml.load(recipeFile.content) as LoadedRecipeEntry[])
            .find(recipeEntry => recipeEntry.object === 'Hostile__c');
        const dependentChoices = (hostileEntry.fields['Dependent__c'] as { if: Array<{ choice: { pick: { random_choice: string[] } } }> }).if;
        const everyChoiceItem = dependentChoices.flatMap(dependentChoice => dependentChoice.choice.pick.random_choice);

        const renderResults = PythonTestHarness.renderWithSnowfakeryJinja(everyChoiceItem.map(choiceItem => ({ template: choiceItem })));

        expect(dependentChoices).toHaveLength(FIXTURE_PICKLIST_VALUES.length);
        renderResults.forEach(renderResult => {
            expect(FIXTURE_PICKLIST_VALUES).toContain(renderResult.rendered);
        });
        expect(new Set(renderResults.map(renderResult => renderResult.rendered))).toEqual(new Set(FIXTURE_PICKLIST_VALUES));

    });

});

describe('Run Faker by Recipe with faker-js over the hostile recipe', () => {

    let recipeDirectoryPath: string;
    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(() => new FakerJSRecipeFakerService());
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-'));
    });

    afterAll(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[INJECTION_MARKER];
    });

    test('generates only fixture values and never evaluates an injected expression', async () => {

        const hostileRecipeFile = recipeFiles.find(recipeFile => recipeFile.content.includes('- object: Hostile__c'));
        const recipeFilePath = path.join(recipeDirectoryPath, hostileRecipeFile.fileName);
        /*
            MANY RECORDS, SO THE RANDOM PICKS REACH EVERY CONTROLLING VALUE'S when: CONDITION. And the
            record type line, which defaults to the first record type, is set to EveryValue, as a user
            choosing a record type would.
        */
        const runnableRecipeText = hostileRecipeFile.content
            .replace(/^(- object: Hostile__c\n(?: {2}\S.*\n)*?) {2}count: 1\n/m, '$1  count: 200\n')
            .replace(/^( {4}RecordTypeId: ).*$/m, '$1EveryValue');
        expect(runnableRecipeText).toContain('  count: 200\n');
        fs.writeFileSync(recipeFilePath, runnableRecipeText);

        const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, string> }>;
        const hostileRecords = generatedRecords.filter(generatedRecord => generatedRecord.object === 'Hostile__c');

        expect(globalThis).not.toHaveProperty(INJECTION_MARKER);
        expect(hostileRecords).toHaveLength(200);
        hostileRecords.forEach(hostileRecord => {
            expect(Object.keys(hostileRecord.fields).sort()).toEqual(DECLARED_FIELD_API_NAMES);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Controlling__c']);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Dependent__c']);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Global__c']);
        });

    });

});

describe('faker-js over hostile picklist values nested under a parent\'s friends: block (#46)', () => {

    let flatRecipeFiles: RecipeFileOutput[];
    let nestedRecipeFiles: RecipeFileOutput[];
    let recipeDirectoryPath: string;

    beforeAll(async () => {
        flatRecipeFiles = await generateRecipeFiles(() => new FakerJSRecipeFakerService());
        nestedRecipeFiles = await generateNestedRecipeFiles();
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-hostile-nested-'));
    });

    afterAll(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[INJECTION_MARKER];
    });

    const findHostileEntry = (recipeContent: string): LoadedRecipeEntry => {
        const loadedEntries = yaml.load(recipeContent) as Array<LoadedRecipeEntry & { friends?: LoadedRecipeEntry[] }>;
        return loadedEntries.flatMap(loadedEntry => [loadedEntry, ...(loadedEntry.friends ?? [])]).find(loadedEntry => loadedEntry.object === 'Hostile__c');
    };

    test('Hostile__c is written under the parent, and loads with exactly the fields the flat recipe gives it', () => {

        const [nestedRecipeFile] = nestedRecipeFiles;
        const flatHostileRecipeFile = flatRecipeFiles.find(recipeFile => recipeFile.content.includes('- object: Hostile__c'));

        expect(nestedRecipeFiles).toHaveLength(1);
        expect(nestedRecipeFile.content).toContain('  friends:\n');
        expect(nestedRecipeFile.content).toMatch(/^ {4}- object: Hostile__c$/m);
        expect(findHostileEntry(nestedRecipeFile.content)).toEqual(findHostileEntry(flatHostileRecipeFile.content));

    });

    testRequiringPyYaml('the nested recipe loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = nestedRecipeFiles.map(recipeFile => recipeFile.content);

        expect(PythonTestHarness.loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

    test('the nested recipe text names no injected field on any line', () => {

        nestedRecipeFiles[0].content.split(/\r\n|\r|\n|\u0085|\u2028|\u2029/).forEach(recipeLine => {
            expect(recipeLine).not.toMatch(new RegExp(`^\\s*${INJECTED_FIELD_API_NAME}:`));
        });

    });

    test('Run Faker by Recipe over the nested recipe generates only fixture values and never evaluates an injected expression', async () => {

        const recipeFilePath = path.join(recipeDirectoryPath, nestedRecipeFiles[0].fileName);
        const runnableRecipeText = nestedRecipeFiles[0].content
            .replace(/^( {4}- object: Hostile__c\n(?: {6}\S.*\n)*?) {6}count: 1\n/m, '$1      count: 200\n')
            .replace(/^( {8}RecordTypeId: ).*$/m, '$1EveryValue');
        expect(runnableRecipeText).toContain('      count: 200\n');
        fs.writeFileSync(recipeFilePath, runnableRecipeText);

        const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, string> }>;
        const hostileRecords = generatedRecords.filter(generatedRecord => generatedRecord.object === 'Hostile__c');

        expect(globalThis).not.toHaveProperty(INJECTION_MARKER);
        expect(hostileRecords).toHaveLength(200);
        hostileRecords.forEach(hostileRecord => {
            expect(Object.keys(hostileRecord.fields).sort()).toEqual(DECLARED_FIELD_API_NAMES);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Controlling__c']);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Dependent__c']);
            expect(FIXTURE_PICKLIST_VALUES).toContain(hostileRecord.fields['Global__c']);
        });

    });

});
