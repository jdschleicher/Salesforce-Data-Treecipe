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

const MOCK_OBJECTS_PATH = path.join(__dirname, 'mocks', 'MockSalesforceMetadataDirectory', 'objects');

// snowfakery reads recipes with PyYAML, whose YAML 1.1 rules differ from js-yaml's; it is checked where the interpreter has it
const PYYAML_CHECK = 'import sys, yaml; yaml.safe_load(sys.stdin.read())';
const isPyYamlAvailable = (() => {
    try {
        childProcess.execFileSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

async function generateRecipeFiles(createFakerService: () => IRecipeFakerService): Promise<RecipeFileOutput[]> {

    jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
    jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
    jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);

    const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(MOCK_OBJECTS_PATH));

    return new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper);

}

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('Generate Treecipe with the %s backend, over the mock metadata', (unusedBackend, createFakerService) => {

    test('writes record-type variants for a picklist and a multi-select picklist, so the check below is about them', async () => {

        const recipeText = (await generateRecipeFiles(createFakerService)).map(recipeFile => recipeFile.content).join('\n');

        expect(recipeText).toMatch(/### TODO: -- RecordType Options -- \w+ -- Below is the faker recipe for the record type \w+ for the field Picklist__c\n {20}# \$\{\{/);
        expect(recipeText).toMatch(/### TODO: -- RecordType Options -- \w+ -- Below is the Multiselect faker recipe for the record type \w+ for the field MultiPicklist__c\n {20}# \$\{\{/);

    });

    test('every recipe file it writes loads with js-yaml', async () => {

        const recipeFiles = await generateRecipeFiles(createFakerService);

        expect(recipeFiles.length).toBeGreaterThan(1);
        recipeFiles.forEach(recipeFile => {
            expect(() => yaml.load(recipeFile.content)).not.toThrow();
        });

    });

    (isPyYamlAvailable ? test : test.skip)('every recipe file it writes loads with PyYAML', async () => {

        const recipeFiles = await generateRecipeFiles(createFakerService);

        recipeFiles.forEach(recipeFile => {
            expect(() => childProcess.execFileSync('python3', ['-c', PYYAML_CHECK], { input: recipeFile.content, stdio: ['pipe', 'ignore', 'pipe'] })).not.toThrow();
        });

    });

});
