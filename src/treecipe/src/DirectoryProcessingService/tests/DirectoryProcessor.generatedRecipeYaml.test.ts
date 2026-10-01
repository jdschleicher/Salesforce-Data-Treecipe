import * as childProcess from 'child_process';
import * as path from 'path';
import * as yaml from 'js-yaml';

/*
    Runs Generate Treecipe's real pipeline -- DirectoryProcessor over the mock metadata, then
    RelationshipService grouping -- with each faker backend, and loads every recipe file it writes.

    The unit tests pin each field's recipe value; this pins the FILE. A field value that is valid
    on its own can still break the recipe it is written into, and Run Faker by Recipe loads the
    whole file, so one bad field fails every object in it. That is how record-type picklist variants
    went unnoticed until another feature's fixtures tried to load a generated recipe.

    vscode is replaced by a read-only stand-in over the real file system: the pipeline reads the
    metadata through vscode.workspace.fs, and nothing here writes.
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
import { RelationshipService, RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';

import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const MOCK_OBJECTS_PATH = path.join(__dirname, 'mocks', 'MockSalesforceMetadataDirectory', 'objects');

// snowfakery reads recipes with PyYAML, whose YAML 1.1 rules differ from js-yaml's; it is checked where the interpreter has it.
// ONE interpreter per backend reads every file (a JSON array on stdin) and prints the name of each it cannot load
const PYYAML_CHECK = [
    'import json, sys, yaml',
    'for recipe_file in json.load(sys.stdin):',
    '    try:',
    '        yaml.safe_load(recipe_file["content"])',
    '    except yaml.YAMLError as yaml_error:',
    '        print(recipe_file["fileName"] + ": " + str(yaml_error).splitlines()[0])'
].join('\n');

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH));

    return new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper);

}

type LoadedObjectRecipe = { object: string, fields: Record<string, unknown> | null };

function collectRecordTypeIdsByObject(loadedRecipes: unknown[]): Record<string, unknown[]> {

    const recordTypeIdsByObject: Record<string, unknown[]> = {};
    (loadedRecipes as LoadedObjectRecipe[][]).flat().forEach(objectRecipe => {
        if ( objectRecipe.fields && 'RecordTypeId' in objectRecipe.fields ) {
            (recordTypeIdsByObject[objectRecipe.object] ??= []).push(objectRecipe.fields.RecordTypeId);
        }
    });
    return recordTypeIdsByObject;

}

// ONE PROBE FOR THE FILE, NOT ONE PER BACKEND describe.each RUNS
const testRequiringPyYaml = PythonTestHarness.testRequiringModules('yaml');

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over the mock metadata', (unusedBackend, createFakerService) => {

    // THE PIPELINE RUNS ONCE PER BACKEND; restoreMocks PUTS THE ConfigurationService SPIES BACK AFTER THE FIRST TEST, WHICH NOTHING LATER NEEDS
    let recipeFiles: RecipeFileOutput[];

    beforeAll(async () => {
        recipeFiles = await generateRecipeFiles(createFakerService);
    });

    test('writes record-type variants for a picklist and a multi-select picklist, so the checks below are about them', () => {

        const recipeText = recipeFiles.map(recipeFile => recipeFile.content).join('\n');

        expect(recipeText).toMatch(/### TODO: -- RecordType Options -- \w+ -- Below is the faker recipe for the record type \w+ for the field Picklist__c\n {20}# \$\{\{/);
        expect(recipeText).toMatch(/### TODO: -- RecordType Options -- \w+ -- Below is the Multiselect faker recipe for the record type \w+ for the field MultiPicklist__c\n {20}# \$\{\{/);

    });

    test('writes RecordTypeId as the first record type, with the other commented under its TODO', () => {

        const recipeText = recipeFiles.map(recipeFile => recipeFile.content).join('\n');

        expect(recipeText).toContain([
            '    RecordTypeId: Example_Everything__c.OneRecType',
            '                    ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection',
            '                    # Example_Everything__c.TwoRecType\n'
        ].join('\n'));

    });

    test('js-yaml loads every RecordTypeId it writes as exactly one developer name', () => {

        expect(collectRecordTypeIdsByObject(recipeFiles.map(recipeFile => yaml.load(recipeFile.content)))).toEqual({
            Example_Everything__c: ['Example_Everything__c.OneRecType']
        });

    });

    testRequiringPyYaml('PyYAML loads every RecordTypeId it writes as exactly one developer name', () => {

        const pyYamlLoadedRecipes = PythonTestHarness.loadWithPyYaml(recipeFiles.map(recipeFile => recipeFile.content));

        expect(collectRecordTypeIdsByObject(pyYamlLoadedRecipes)).toEqual({
            Example_Everything__c: ['Example_Everything__c.OneRecType']
        });

    });

    test('every recipe file it writes loads with js-yaml', () => {

        expect(recipeFiles.length).toBeGreaterThan(1);
        recipeFiles.forEach(recipeFile => {
            expect(() => yaml.load(recipeFile.content)).not.toThrow();
        });

    });

    testRequiringPyYaml('every recipe file it writes loads with PyYAML', () => {

        const pyYamlInput = JSON.stringify(recipeFiles.map(recipeFile => ({ fileName: recipeFile.fileName, content: recipeFile.content })));
        const unloadableRecipeFiles = childProcess.execFileSync('python3', ['-c', PYYAML_CHECK], { input: pyYamlInput, encoding: 'utf-8' });

        expect(unloadableRecipeFiles).toBe('');

    });

});
