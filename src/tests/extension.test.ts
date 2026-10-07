import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn() })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        createOutputChannel: jest.fn()
    },
    commands: { registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }) },
    Uri: { file: (filePath: string) => ({ fsPath: filePath }), joinPath: jest.fn(), parse: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    Org: { create: jest.fn() }
}));

import { activate } from '../extension';
import { ConfigurationService } from '../treecipe/src/ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../treecipe/src/VSCodeWorkspace/VSCodeWorkspaceService';
import { ExtensionCommandService } from '../treecipe/src/ExtensionCommandService/ExtensionCommandService';

/*
    The only tests for the extension entry point, and they exist for one behaviour rather than for
    coverage of the registration glue around it.

    activate() writes "useSnowfakeryAsDefault" at WORKSPACE scope. VS Code rejects that write in a
    window with no folder open -- there is no .vscode/settings.json to write into -- and the write
    used to be made unconditionally, which is how someone who opened a single file was warned about
    a setting they never chose. A guard is only worth having if something fails when it is removed.
*/
describe('activate', () => {

    const buildExtensionContext = () => ({ subscriptions: [] as unknown[], extensionPath: '/extension' });

    beforeEach(() => {

        jest.spyOn(VSCodeWorkspaceService, 'registerExtensionSubscriptions').mockImplementation(() => undefined);

        // A jest.fn() FROM THE MODULE FACTORY, WHICH restoreMocks DOES NOT COVER -- ITS CALLS ACCUMULATE
        (vscode.commands.registerCommand as jest.Mock).mockClear();

    });

    it('given no workspace folder is open, writes no configuration value', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
        const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue')
            .mockResolvedValue(true);

        await activate(buildExtensionContext() as never);

        expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();

    });

    it('given a workspace folder is open, writes the snowfakery default', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
        const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue')
            .mockResolvedValue(true);

        await activate(buildExtensionContext() as never);

        expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('useSnowfakeryAsDefault', false);

    });

    // EVERY COMMAND THE MANIFEST DECLARES IS REGISTERED, WHATEVER THE WORKSPACE STATE
    it('registers every command in a window with no workspace folder', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

        await activate(buildExtensionContext() as never);

        const registeredCommandIds = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(
            registerCall => registerCall[0]
        );

        expect(registeredCommandIds).toContain('treecipe.openRecipeCockpit');
        expect(registeredCommandIds).toContain('treecipe.generateTreecipe');
        expect(registeredCommandIds).toHaveLength(require('../../package.json').contributes.commands.length);

    });

    /*
        The Recipe Cockpit's "Regenerate recipe" awaits executeCommand and then loads the run that
        generation wrote. executeCommand settles with whatever the handler RETURNS, so a handler that
        starts generation without returning it lets the cockpit reload before anything was written.
    */
    it('returns the generation from the Generate Treecipe handler, so a caller can wait for it', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const generation = Promise.resolve();
        jest.spyOn(ExtensionCommandService.prototype, 'generateRecipeFromConfigurationDetail').mockReturnValue(generation);

        await activate(buildExtensionContext() as never);

        const [, generateTreecipeHandler] = (vscode.commands.registerCommand as jest.Mock).mock.calls
            .find(registerCall => registerCall[0] === 'treecipe.generateTreecipe');

        expect(generateTreecipeHandler()).toBe(generation);

    });

    // THE RECIPE COCKPIT'S Insert… HANDS OVER THE DATA SET FOLDER, AND WAITS FOR THE INSERT
    it('passes a pre-selected folder to Insert Data Set by Directory and returns the insert, and passes nothing that is not a path', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const insert = Promise.resolve();
        const insertSpy = jest.spyOn(ExtensionCommandService.prototype, 'insertDataSetBySelectedDirectory').mockReturnValue(insert);

        await activate(buildExtensionContext() as never);

        const [, insertDataSetHandler] = (vscode.commands.registerCommand as jest.Mock).mock.calls
            .find(registerCall => registerCall[0] === 'treecipe.insertDataSetBySelectedDirectory');

        expect(insertDataSetHandler('/workspace/treecipe/FakeDataSets/dataset-2026-09-21T00-00-00')).toBe(insert);
        insertDataSetHandler();
        insertDataSetHandler({ fsPath: '/elsewhere' });

        expect(insertSpy.mock.calls).toEqual([['/workspace/treecipe/FakeDataSets/dataset-2026-09-21T00-00-00'], [undefined], [undefined]]);

    });

    // THE RECIPE COCKPIT'S Run Faker HANDS OVER ITS TREE'S RECIPE FILE, AND WAITS FOR THE DATA SET
    it('passes a recipe file to Run Faker by Recipe and returns the run, and passes nothing that is not a path', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const fakerRun = Promise.resolve();
        const runFakerSpy = jest.spyOn(ExtensionCommandService.prototype, 'runFakerGenerationByRecipeFile').mockReturnValue(fakerRun);

        await activate(buildExtensionContext() as never);

        const [, runFakerHandler] = (vscode.commands.registerCommand as jest.Mock).mock.calls
            .find(registerCall => registerCall[0] === 'treecipe.runFakerByRecipe');

        expect(runFakerHandler('/workspace/treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/recipe--Lead-ONLY-2026-09-20T10-00-00.yml')).toBe(fakerRun);
        expect(runFakerHandler()).toBe(fakerRun);
        runFakerHandler({ fsPath: '/elsewhere' });

        expect(runFakerSpy.mock.calls).toEqual([
            ['/workspace/treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/recipe--Lead-ONLY-2026-09-20T10-00-00.yml'],
            [undefined],
            [undefined]
        ]);

    });

});
