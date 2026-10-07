import * as childProcess from 'child_process';
import * as fs from 'fs';
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
                        const directoryEntries = realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1]);
                        return mockRecordTypesListing.order(directoryUri.fsPath, directoryEntries);
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

type DirectoryEntry = [string, number];

// readDirectory LISTS IN THE FILE SYSTEM'S ORDER; A TEST CAN FIX THE recordTypes/ LISTING TO SHOW THE RECIPE DOES NOT DEPEND ON IT (#166)
const mockRecordTypesListing = {
    arrange: (directoryEntries: DirectoryEntry[]): DirectoryEntry[] => directoryEntries,
    order(directoryPath: string, directoryEntries: DirectoryEntry[]): DirectoryEntry[] {
        return directoryPath.endsWith('recordTypes') ? this.arrange(directoryEntries) : directoryEntries;
    }
};
const sortDirectoryEntries = (directoryEntries: DirectoryEntry[]) => [...directoryEntries].sort(([first], [second]) => ( first < second ? -1 : ( first > second ? 1 : 0 ) ));

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { RelationshipService, RecipeFileOutput } from '../../RelationshipService/RelationshipService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';

import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { RecordTypeService } from '../../RecordTypeService/RecordTypeService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';

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

async function processMockMetadata(createFakerService: () => IRecipeFakerService): Promise<ObjectInfoWrapper> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    return new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH));

}

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    // WHAT GENERATE TREECIPE WRITES -- NESTED UNDER friends: FOR faker-js (#46), FLAT FOR SNOWFAKERY
    return (await processMockMetadata(createFakerService)).RecipeFiles;

}

type LoadedObjectRecipe = { object: string, fields: Record<string, unknown> | null, friends?: LoadedObjectRecipe[] };

// EVERY OBJECT AT EVERY DEPTH -- A faker-js RECIPE NESTS CHILD OBJECTS UNDER friends: (#46)
const flattenObjectRecipes = (objectRecipes: LoadedObjectRecipe[]): LoadedObjectRecipe[] =>
    objectRecipes.flatMap(objectRecipe => [objectRecipe, ...flattenObjectRecipes(objectRecipe.friends ?? [])]);

/*
    The RecordTypeId block, at whatever depth its object is written: the field line at the object's
    field indent, and its options sixteen spaces deeper than that, as RecipeService writes them.
*/
const buildRecordTypeIdBlockPattern = (selectedRecordTypeName: string, commentedRecordTypeName: string): RegExp => new RegExp([
    `^( {4}(?: {4})*)RecordTypeId: Example_Everything__c\\.${selectedRecordTypeName}`,
    '\\1 {16}### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection',
    `\\1 {16}# Example_Everything__c\\.${commentedRecordTypeName}$`
].join('\n'), 'm');

function collectRecordTypeIdsByObject(loadedRecipes: unknown[]): Record<string, unknown[]> {

    const recordTypeIdsByObject: Record<string, unknown[]> = {};
    flattenObjectRecipes((loadedRecipes as LoadedObjectRecipe[][]).flat()).forEach(objectRecipe => {
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

        expect(recipeText).toMatch(/^( *)### TODO: -- RecordType Options -- \w+ -- Below is the faker recipe for the record type \w+ for the field Picklist__c\n\1# \$\{\{/m);
        expect(recipeText).toMatch(/^( *)### TODO: -- RecordType Options -- \w+ -- Below is the Multiselect faker recipe for the record type \w+ for the field MultiPicklist__c\n\1# \$\{\{/m);

    });

    test('writes RecordTypeId as the first active record type in developer name order, with the other commented under its TODO', () => {

        const recipeText = recipeFiles.map(recipeFile => recipeFile.content).join('\n');

        expect(recipeText).toMatch(buildRecordTypeIdBlockPattern('OneRecType', 'TwoRecType'));

    });

    describe('given recordTypes/ listed in a different order (#166)', () => {

        afterEach(() => {
            mockRecordTypesListing.arrange = (directoryEntries) => directoryEntries;
        });

        test('writes byte-identical recipe files from a sorted and a reversed listing', async () => {

            mockRecordTypesListing.arrange = sortDirectoryEntries;
            const sortedListingRecipeFiles = await generateRecipeFiles(createFakerService);

            mockRecordTypesListing.arrange = (directoryEntries) => sortDirectoryEntries(directoryEntries).reverse();
            const reversedListingRecipeFiles = await generateRecipeFiles(createFakerService);

            expect(reversedListingRecipeFiles).toEqual(sortedListingRecipeFiles);
            expect(reversedListingRecipeFiles).toEqual(recipeFiles);

        });

        test('lays out every record-type section in developer name order, from a reversed listing', async () => {

            mockRecordTypesListing.arrange = (directoryEntries) => sortDirectoryEntries(directoryEntries).reverse();
            const recipeText = (await generateRecipeFiles(createFakerService)).map(recipeFile => recipeFile.content).join('\n');

            /*
                A field's record-type sections -- picklist and multi-select variants, and a dependent
                picklist's per-record-type choices under each when: -- each name the record types once,
                in map order, so within one field (or one when: block) the names must come out sorted.
            */
            const recordTypeNamesBySection = recipeText
                .split(/\n(?= {4}(?: {4})*\w+:| *when:)/)
                .map(section => [...section.matchAll(/### TODO: -- RecordType Options -- (\w+) --/g)].map(([, recordTypeName]) => recordTypeName))
                .map(recordTypeNames => recordTypeNames.filter((recordTypeName, index) => recordTypeName !== recordTypeNames[index - 1]))
                .filter(recordTypeNames => recordTypeNames.length > 1);

            expect(recordTypeNamesBySection.length).toBeGreaterThan(2);
            recordTypeNamesBySection.forEach(recordTypeNames => {
                expect(recordTypeNames).toEqual(['OneRecType', 'TwoRecType']);
            });
            expect(recipeText).toMatch(/### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- OneRecType[\s\S]*?### TODO: -- RecordType Options -- TwoRecType -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- TwoRecType/);

        });

    });

    test('given the first record type inactive, writes the first active one as RecordTypeId and keeps the inactive one as a commented option (#166)', async () => {

        const isActiveByXMLDetail = RecordTypeService.isActiveByXMLDetail.bind(RecordTypeService);
        jest.spyOn(RecordTypeService, 'isActiveByXMLDetail').mockImplementation((recordTypeXMLDetail) =>
            (recordTypeXMLDetail as { fullName: string[] }).fullName[0] === 'OneRecType' ? false : isActiveByXMLDetail(recordTypeXMLDetail)
        );

        const inactiveFirstRecipeFiles = await generateRecipeFiles(createFakerService);
        const recipeText = inactiveFirstRecipeFiles.map(recipeFile => recipeFile.content).join('\n');

        expect(recipeText).toMatch(buildRecordTypeIdBlockPattern('TwoRecType', 'OneRecType'));
        expect(collectRecordTypeIdsByObject(inactiveFirstRecipeFiles.map(recipeFile => yaml.load(recipeFile.content)))).toEqual({
            Example_Everything__c: ['Example_Everything__c.TwoRecType']
        });

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

    /*
        Nesting moves an object's lines four spaces deeper per friends: level and fills in the lookups
        to its ancestors -- nothing else. So every object loads with the same fields as the flat
        recipe, apart from a lookup that was the REFERENCE ID REQUIRED TODO (null) and is now an
        ancestor's nickname (#46). For snowfakery, which stays flat, the two are identical.
    */
    test('every object loads with the same fields as the flat recipe, apart from the lookups nesting wired', async () => {

        const objectInfoWrapper = await processMockMetadata(createFakerService);
        const loadObjectRecipesByName = (recipeContents: string[]): Map<string, LoadedObjectRecipe> => new Map(
            flattenObjectRecipes(recipeContents.flatMap(recipeContent => yaml.load(recipeContent) as LoadedObjectRecipe[]))
                .map(objectRecipe => [objectRecipe.object, objectRecipe])
        );

        const writtenObjectRecipes = loadObjectRecipesByName(objectInfoWrapper.RecipeFiles.map(recipeFile => recipeFile.content));
        const flatObjectRecipes = loadObjectRecipesByName(new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper, false).map(recipeFile => recipeFile.content));
        const nicknames = new Set(Array.from(flatObjectRecipes.values()).map(objectRecipe => (objectRecipe as unknown as { nickname: string }).nickname));

        expect(Array.from(writtenObjectRecipes.keys()).sort()).toEqual(Array.from(flatObjectRecipes.keys()).sort());

        let wiredLookupCount = 0;
        flatObjectRecipes.forEach((flatObjectRecipe, objectApiName) => {
            const writtenFields = writtenObjectRecipes.get(objectApiName).fields ?? {};
            const flatFields = flatObjectRecipe.fields ?? {};
            expect(Object.keys(writtenFields)).toEqual(Object.keys(flatFields));
            Object.keys(flatFields).forEach(fieldApiName => {
                if ( flatFields[fieldApiName] === null && nicknames.has(writtenFields[fieldApiName] as string) ) {
                    wiredLookupCount++;
                    return;
                }
                expect([objectApiName, fieldApiName, writtenFields[fieldApiName]]).toEqual([objectApiName, fieldApiName, flatFields[fieldApiName]]);
            });
        });

        expect(wiredLookupCount > 0).toBe(objectInfoWrapper.RecipeFiles.some(recipeFile => recipeFile.content.includes('friends:')));

    });

    // THE RECIPE COCKPIT'S NESTED WRITER FIXTURE IS THIS PIPELINE'S OUTPUT, SO A CHANGE TO THE LAYOUT THAT DOES NOT REGENERATE IT FAILS HERE
    test('the first tree is byte-identical to the Recipe Cockpit\'s writer fixture for this backend', () => {

        const fixtureFileName = createFakerService() instanceof FakerJSRecipeFakerService
            ? 'recipe-fakerjs-nested--RelationshipTree_1.yml'
            : undefined;
        if ( !fixtureFileName ) {
            expect(recipeFiles[0].content).not.toContain('friends:');
            return;
        }

        const fixturePath = path.join(__dirname, '..', '..', 'RecipeCockpitService', 'tests', 'mocks', 'recipeWriter', fixtureFileName);
        expect(recipeFiles[0].content).toBe(fs.readFileSync(fixturePath, 'utf-8'));

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
