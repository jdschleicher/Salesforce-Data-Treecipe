import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
        onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn(),
        registerWebviewPanelSerializer: jest.fn().mockReturnValue({ dispose: jest.fn() })
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
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

import { activate } from '../extension';
import { ConfigurationService } from '../treecipe/src/ConfigurationService/ConfigurationService';
import { RecipeCockpitService } from '../treecipe/src/RecipeCockpitService/RecipeCockpitService';
import { VSCodeWorkspaceService } from '../treecipe/src/VSCodeWorkspace/VSCodeWorkspaceService';
import { RunFakerConfirmation } from '../treecipe/src/ExtensionCommandService/RunFakerConfirmation';
import { ExtensionCommandService } from '../treecipe/src/ExtensionCommandService/ExtensionCommandService';
import { TreecipeSideBarService } from '../treecipe/src/TreecipeSideBarService/TreecipeSideBarService';

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
        jest.spyOn(VSCodeWorkspaceService, 'registerRecipeCockpitStatusBarItem').mockImplementation(() => undefined);
        jest.spyOn(TreecipeSideBarService, 'register').mockImplementation(() => undefined);

        // A jest.fn() FROM THE MODULE FACTORY, WHICH restoreMocks DOES NOT COVER -- ITS CALLS ACCUMULATE
        (vscode.commands.registerCommand as jest.Mock).mockClear();

        // SO NO TEST INHERITS THE FOLDERS THE ONE BEFORE IT SET ON THE MODULE-FACTORY MOCK
        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;

    });

    // THE ACTIVITY BAR'S TREECIPE VIEW (#456)
    it('registers the side bar once, into the extension\'s subscriptions', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const extensionContext = buildExtensionContext();

        await activate(extensionContext as never);

        expect(TreecipeSideBarService.register).toHaveBeenCalledTimes(1);
        expect(TreecipeSideBarService.register).toHaveBeenCalledWith(extensionContext.subscriptions);

    });

    // THE RECIPE COCKPIT SHOWS THE INSTALLED VERSION AT THE TOP RIGHT (#333)
    it('hands the manifest version to the Recipe Cockpit, and a context without one hands it nothing', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const setExtensionVersionSpy = jest.spyOn(RecipeCockpitService, 'setExtensionVersion');

        await activate({ ...buildExtensionContext(), extension: { packageJSON: { version: '3.90.0' } } } as never);
        await activate(buildExtensionContext() as never);

        expect(setExtensionVersionSpy.mock.calls).toEqual([['3.90.0'], [undefined]]);

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

    // A TREECIPE WORKSPACE NOW ACTIVATES AT WINDOW LOAD (#251), SO A VALUE ALREADY WRITTEN IS NOT WRITTEN AGAIN ON EVERY LOAD
    it('given the workspace already holds the snowfakery default, writes nothing', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
        jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue(false);
        const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue')
            .mockResolvedValue(true);

        await activate(buildExtensionContext() as never);

        expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();

    });

    it('given the workspace holds true for the snowfakery default, writes false', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
        jest.spyOn(ConfigurationService, 'getWorkspaceScopedExtensionConfigValue').mockReturnValue(true);
        const setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue')
            .mockResolvedValue(true);

        await activate(buildExtensionContext() as never);

        expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('useSnowfakeryAsDefault', false);

    });

    it('registers the Recipe Cockpit status bar item against the extension subscriptions (#251)', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const extensionContext = buildExtensionContext();

        await activate(extensionContext as never);

        expect(VSCodeWorkspaceService.registerRecipeCockpitStatusBarItem).toHaveBeenCalledWith(extensionContext.subscriptions);

    });

    /*
        The status bar item shows at window load only in a Treecipe workspace (#251), and that is
        decided by the manifest: elsewhere the extension starts on its first command, as before.
    */
    it('activates at window load only in a workspace containing treecipe/treecipe.config.json', () => {

        const activationEvents: string[] = require('../../package.json').activationEvents ?? [];
        expect(activationEvents).toEqual(['workspaceContains:treecipe/treecipe.config.json']);

    });

    it('declares the status bar setting as a boolean that defaults to true', () => {

        const configurationProperties = require('../../package.json').contributes.configuration[0].properties;
        expect(configurationProperties['salesforce-data-treecipe.showRecipeCockpitStatusBarItem']).toMatchObject({ type: 'boolean', default: true });

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
        The Recipe Cockpit is never reopened by VS Code itself (#230): a window reload leaves it
        closed, and its place comes back only when the reader runs Open Recipe Cockpit. A serializer
        or an onWebviewPanel: activation event would make every reload load a run on its own.
    */
    it('registers no webview panel serializer, and the manifest declares no webview panel activation event', async () => {

        (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        (vscode.window.registerWebviewPanelSerializer as jest.Mock).mockClear();

        await activate(buildExtensionContext() as never);

        expect(vscode.window.registerWebviewPanelSerializer).not.toHaveBeenCalled();
        const activationEvents: string[] = require('../../package.json').activationEvents ?? [];
        expect(activationEvents.filter(activationEvent => activationEvent.startsWith('onWebviewPanel:'))).toEqual([]);

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

    // THE COCKPIT'S Regenerate SUPPRESSES GENERATION'S COMPLETION TOAST THROUGH THIS ARGUMENT (#206), SO A HANDLER THAT DROPS IT SHOWS THE TOAST AGAIN
    it('passes its argument to Generate Treecipe, so the Recipe Cockpit can suppress the completion notification', async () => {

        jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
        const generateSpy = jest.spyOn(ExtensionCommandService.prototype, 'generateRecipeFromConfigurationDetail').mockResolvedValue(undefined);

        await activate(buildExtensionContext() as never);

        const [, generateTreecipeHandler] = (vscode.commands.registerCommand as jest.Mock).mock.calls
            .find(registerCall => registerCall[0] === 'treecipe.generateTreecipe');

        await generateTreecipeHandler({ isCompletionNotificationSuppressed: true });

        expect(generateSpy).toHaveBeenCalledWith({ isCompletionNotificationSuppressed: true });

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
        const fakerRun: Promise<string | undefined> = Promise.resolve('/workspace/treecipe/FakeDataSets/dataset-2026-09-21T00-00-00');
        const runFakerSpy = jest.spyOn(ExtensionCommandService.prototype, 'runFakerGenerationByRecipeFile').mockReturnValue(fakerRun);

        await activate(buildExtensionContext() as never);

        const [, runFakerHandler] = (vscode.commands.registerCommand as jest.Mock).mock.calls
            .find(registerCall => registerCall[0] === 'treecipe.runFakerByRecipe');

        expect(runFakerHandler('/workspace/treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/recipe--Lead-ONLY-2026-09-20T10-00-00.yml')).toBe(fakerRun);
        expect(runFakerHandler()).toBe(fakerRun);
        runFakerHandler({ fsPath: '/elsewhere' });

        const filteredRecipe = { recipeText: '- object: Lead\n', excludedObjectApiNames: [], objectCountsByObject: { Lead: 3 } };
        runFakerHandler('/workspace/recipe.yml', filteredRecipe, { confirmationToken: RunFakerConfirmation.issue() });
        runFakerHandler('/workspace/recipe.yml', undefined, { isConfirmed: true });

        // ONLY A TOKEN THE HOST ISSUED SKIPS THE MODAL; A FLAG A CALLER WRITES DOES NOT (#255)
        expect(runFakerSpy.mock.calls).toEqual([
            ['/workspace/treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/recipe--Lead-ONLY-2026-09-20T10-00-00.yml', undefined, {}],
            [undefined, undefined, {}],
            [undefined, undefined, {}],
            ['/workspace/recipe.yml', filteredRecipe, { isConfirmed: true }],
            ['/workspace/recipe.yml', undefined, {}]
        ]);

    });

});
