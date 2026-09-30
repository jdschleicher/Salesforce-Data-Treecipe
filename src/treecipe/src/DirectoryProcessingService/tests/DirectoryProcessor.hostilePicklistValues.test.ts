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
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import {
    HOSTILE_PICKLIST_VALUES,
    INJECTED_FIELD_API_NAME,
    INJECTION_MARKER,
    isPythonModuleAvailable,
    loadWithPyYaml
} from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';

const HOSTILE_METADATA_PATH = path.join(__dirname, 'mocks', 'HostileSalesforceMetadataDirectory');
const HOSTILE_OBJECTS_PATH = path.join(HOSTILE_METADATA_PATH, 'objects');

// THE FIXTURE CARRIES EVERY HOSTILE VALUE, THEN THREE ORDINARY ONES -- THE ONLY CONTROLLING VALUES ONE RECORD TYPE MAKES AVAILABLE
const FIXTURE_PICKLIST_VALUES = [...HOSTILE_PICKLIST_VALUES.map(([, hostileValue]) => hostileValue), "Rock 'n' Roll", 'A&B', 'C#'];
const DECLARED_FIELD_API_NAMES = ['Controlling__c', 'Dependent__c', 'Global__c', 'Multi__c', 'RecordTypeId'];

const isPyYamlAvailable = isPythonModuleAvailable('yaml');

type LoadedRecipeEntry = { object?: string, fields?: Record<string, unknown> };

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);
    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(HOSTILE_OBJECTS_PATH));

    return new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper);

}

describe('the hostile metadata fixture', () => {

    test('decodes to exactly the hostile values, so the tests below are about them', async () => {

        await GlobalValueSetSingleton.getInstance().initialize(HOSTILE_METADATA_PATH);

        expect(GlobalValueSetSingleton.getInstance().getPicklistValueMaps()['HostileGlobal']).toEqual(FIXTURE_PICKLIST_VALUES);

    });

});

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

    (isPyYamlAvailable ? test : test.skip)('every recipe file loads with PyYAML exactly as js-yaml loads it', () => {

        const recipeTexts = recipeFiles.map(recipeFile => recipeFile.content);

        expect(loadWithPyYaml(recipeTexts)).toEqual(recipeTexts.map(recipeText => yaml.load(recipeText)));

    });

    test('the recipe text names no injected field on any line', () => {

        recipeFiles.forEach(recipeFile => {
            recipeFile.content.split(/\r\n|\r|\n|\u0085|\u2028|\u2029/).forEach(recipeLine => {
                expect(recipeLine).not.toMatch(new RegExp(`^\\s*${INJECTED_FIELD_API_NAME}:`));
            });
        });

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
            record type line is a TODO the user resolves by hand before a run; it is resolved here to
            one of the fixture's record types, as a user would.
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
