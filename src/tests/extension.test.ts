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

});
