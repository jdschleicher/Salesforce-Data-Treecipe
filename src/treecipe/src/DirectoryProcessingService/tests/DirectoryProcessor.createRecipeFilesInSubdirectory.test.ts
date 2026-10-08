import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessor";
import { ObjectInfoWrapper } from "../../ObjectInfoWrapper/ObjectInfoWrapper";
import { RelationshipService } from "../../RelationshipService/RelationshipService";
import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";
import { VSCodeWorkspaceService } from "../../VSCodeWorkspace/VSCodeWorkspaceService";
import { SOQLTemplateService } from "../../SOQLTemplateService/SOQLTemplateService";
import { MermaidService } from "../../MermaidService/MermaidService";

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined },
    window: {
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn()
    }
}), { virtual: true });

/*
    Every write used to be an un-awaited fs.writeFile whose callback showed a toast, so a run with
    N trees raised 3N + 1 notifications, finished before its files existed, and threw a write
    failure into a callback nothing caught (#206). These run against a real directory because the
    property is "on disk when the promise resolves", which a mocked fs cannot show.
*/
describe('DirectoryProcessor.createRecipeFilesInSubdirectory', () => {

    const isoDateTimestamp = '2026-10-08T12-00-00';
    const accountTreeObjects = ['Account', 'Contact'];
    const leadTreeObjects = ['Lead'];

    let workspaceRoot: string;
    let directoryProcessor: DirectoryProcessor;

    const buildObjectsInfoWrapper = (): ObjectInfoWrapper => {

        const objectsInfoWrapper = new ObjectInfoWrapper();
        objectsInfoWrapper.RecipeFiles = [
            { fileName: 'tree-1.yml', content: '- object: Account\n', objectCount: 2, maxLevel: 1, objects: accountTreeObjects },
            { fileName: 'tree-2.yml', content: '- object: Lead\n', objectCount: 1, maxLevel: 0, objects: leadTreeObjects }
        ];
        return objectsInfoWrapper;

    };

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-generate-'));
        fs.mkdirSync(path.join(workspaceRoot, 'treecipe'));

        jest.spyOn(ConfigurationService, 'getFakerImplementationByExtensionConfigSelection').mockReturnValue(new FakerJSRecipeFakerService());
        jest.spyOn(VSCodeWorkspaceService, 'getNowIsoDateTimestamp').mockReturnValue(isoDateTimestamp);
        jest.spyOn(SOQLTemplateService, 'generateSOQLTemplateMarkdownForTree').mockReturnValue('# soql');
        jest.spyOn(MermaidService, 'generateMermaidMarkdownForTree').mockReturnValue('# erd');

        directoryProcessor = new DirectoryProcessor();

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test.each([
        ['faker-js', 'recipe-fakerjs'],
        ['snowfakery', 'recipe']
    ])('given the %s service, returns the run folder and one recipe per tree in RecipeFiles order', async (fakerServiceName, recipePrefix) => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue(fakerServiceName);

        const generatedRecipeRun = await directoryProcessor.createRecipeFilesInSubdirectory(buildObjectsInfoWrapper(), workspaceRoot);

        const expectedRunFolderPath = `${workspaceRoot}/treecipe/GeneratedRecipes/${recipePrefix}-${isoDateTimestamp}`;
        const expectedRecipeFilePaths = [accountTreeObjects, leadTreeObjects].map(treeObjects => {
            const treeFolderName = RelationshipService.buildRecipeTreeFolderName(treeObjects);
            return `${expectedRunFolderPath}/${treeFolderName}/${recipePrefix}--${treeFolderName}-${isoDateTimestamp}.yml`;
        });

        expect(generatedRecipeRun).toEqual({
            runFolderPath: expectedRunFolderPath,
            recipeFilePaths: expectedRecipeFilePaths
        });

    });

    test('given the returned promise resolved, every file of the run is already on disk with its content', async () => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');

        const generatedRecipeRun = await directoryProcessor.createRecipeFilesInSubdirectory(buildObjectsInfoWrapper(), workspaceRoot);

        expect(fs.readFileSync(generatedRecipeRun.recipeFilePaths[0], 'utf8')).toBe('- object: Account\n');
        expect(fs.readFileSync(generatedRecipeRun.recipeFilePaths[1], 'utf8')).toBe('- object: Lead\n');

        const runFolderEntries = fs.readdirSync(generatedRecipeRun.runFolderPath);
        expect(runFolderEntries).toContain(`treecipeObjectsWrapper-${isoDateTimestamp}.json`);

        generatedRecipeRun.recipeFilePaths.forEach(recipeFilePath => {
            const treeFolderEntries = fs.readdirSync(path.dirname(recipeFilePath));
            expect(treeFolderEntries).toHaveLength(3);
            expect(treeFolderEntries.some(entryName => entryName.startsWith('soql-sosl-templates--'))).toBe(true);
            expect(treeFolderEntries.some(entryName => entryName.startsWith('mermaid-erd--'))).toBe(true);
        });

    });

    test('given a run of several trees, shows no notification of its own -- the command reports the run once', async () => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');

        await directoryProcessor.createRecipeFilesInSubdirectory(buildObjectsInfoWrapper(), workspaceRoot);

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    });

    test('given a write that fails, rejects naming the file rather than reporting success', async () => {

        jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');
        jest.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('EACCES: permission denied'));

        await expect(directoryProcessor.createRecipeFilesInSubdirectory(buildObjectsInfoWrapper(), workspaceRoot))
            .rejects.toThrow('an error occurred when parsing objects directory and generating a recipe yaml file. EACCES: permission denied');

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    });

});
