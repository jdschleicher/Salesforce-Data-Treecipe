import { ICreatedFileNotificationAction, VSCodeWorkspaceService } from "../VSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        openTextDocument: jest.fn()
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath })
    },
    window: {
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showTextDocument: jest.fn()
    },
    commands: {
        executeCommand: jest.fn()
    }
}), { virtual: true });

/*
    The completion notification of Initiate Configuration File and Generate Treecipe (#206). Its
    buttons act on a path the command wrote, but the toast can sit open while that path is moved
    or deleted, so the target is checked again on the click rather than trusted from the build.
*/
describe('VSCodeWorkspaceService completion notification', () => {

    let workspaceRoot: string;
    let outsideWorkspaceRoot: string;
    let configurationFilePath: string;
    let runFolderPath: string;

    const buildActions = (targetPath: string): ICreatedFileNotificationAction[] => [
        { label: 'Open Configuration File', targetPath: targetPath, kind: 'openInEditor' },
        { label: 'Reveal in Explorer', targetPath: targetPath, kind: 'revealInExplorer' }
    ];

    beforeEach(() => {

        jest.clearAllMocks();

        workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-notify-')));
        outsideWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-notify-outside-')));

        fs.mkdirSync(path.join(workspaceRoot, 'treecipe'));
        configurationFilePath = path.join(workspaceRoot, 'treecipe', 'treecipe.config.json');
        fs.writeFileSync(configurationFilePath, '{}');

        runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-fakerjs-2026-10-08T12-00-00');
        fs.mkdirSync(runFolderPath, { recursive: true });

        (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ uri: configurationFilePath });
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({});

    });

    afterEach(() => {
        (vscode.workspace as any).workspaceFolders = undefined;
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
        fs.rmSync(outsideWorkspaceRoot, { recursive: true, force: true });
    });

    test('shows one information message carrying every action label as a button', async () => {

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

        await VSCodeWorkspaceService.showCreatedFilesNotification('Created "treecipe/treecipe.config.json".', buildActions(configurationFilePath));

        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Created "treecipe/treecipe.config.json".', 'Open Configuration File', 'Reveal in Explorer');

    });

    test('given Reveal in Explorer is clicked, reveals the target in the Explorer and opens no editor', async () => {

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Reveal in Explorer');

        await VSCodeWorkspaceService.showCreatedFilesNotification('Generated', [
            { label: 'Reveal in Explorer', targetPath: runFolderPath, kind: 'revealInExplorer' }
        ]);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealInExplorer', { fsPath: runFolderPath });
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();

    });

    test('given the open action is clicked, opens the target in an editor and does not touch the Explorer', async () => {

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Open Configuration File');

        await VSCodeWorkspaceService.showCreatedFilesNotification('Created', buildActions(configurationFilePath));

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: configurationFilePath });
        expect(vscode.window.showTextDocument).toHaveBeenCalled();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

    });

    test('given the notification is dismissed, nothing is opened or revealed', async () => {

        (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

        await VSCodeWorkspaceService.showCreatedFilesNotification('Created', buildActions(configurationFilePath));

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();

    });

    test('given a toast nobody answers, returns without waiting for it so a command can settle', () => {

        (vscode.window.showInformationMessage as jest.Mock).mockReturnValue(new Promise(() => undefined));

        const notificationResult = VSCodeWorkspaceService.showCreatedFilesNotification('Created', buildActions(configurationFilePath));

        expect(notificationResult).toBeInstanceOf(Promise);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

    });

    test('given the target was deleted while the toast was open, warns and neither opens nor reveals it', async () => {

        fs.rmSync(configurationFilePath);

        await VSCodeWorkspaceService.runCreatedFileNotificationAction(buildActions(configurationFilePath)[1]);
        await VSCodeWorkspaceService.runCreatedFileNotificationAction(buildActions(configurationFilePath)[0]);

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);

    });

    test('given a target outside the workspace, never opens or reveals it', async () => {

        const outsideFilePath = path.join(outsideWorkspaceRoot, 'treecipe.config.json');
        fs.writeFileSync(outsideFilePath, '{}');

        await VSCodeWorkspaceService.runCreatedFileNotificationAction({ label: 'Reveal in Explorer', targetPath: outsideFilePath, kind: 'revealInExplorer' });
        await VSCodeWorkspaceService.runCreatedFileNotificationAction({ label: 'Open', targetPath: outsideFilePath, kind: 'openInEditor' });

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();

    });

    test('given a target reached through a symlink out of the workspace, never reveals it', async () => {

        const linkedFolderPath = path.join(workspaceRoot, 'treecipe', 'linked');
        fs.symlinkSync(outsideWorkspaceRoot, linkedFolderPath, 'dir');

        await VSCodeWorkspaceService.runCreatedFileNotificationAction({ label: 'Reveal in Explorer', targetPath: linkedFolderPath, kind: 'revealInExplorer' });

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

    });

    test('given no workspace is open, does nothing', async () => {

        (vscode.workspace as any).workspaceFolders = undefined;

        await VSCodeWorkspaceService.runCreatedFileNotificationAction(buildActions(configurationFilePath)[1]);

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

    });

    test('given the reveal command rejects, reports it instead of leaving an unhandled rejection', async () => {

        (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('no explorer'));

        await VSCodeWorkspaceService.runCreatedFileNotificationAction({ label: 'Reveal in Explorer', targetPath: runFolderPath, kind: 'revealInExplorer' });

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('no explorer'));

    });

    describe('toWorkspaceRelativeDisplayPath', () => {

        test('names the path relative to the workspace with forward slashes', () => {

            expect(VSCodeWorkspaceService.toWorkspaceRelativeDisplayPath(runFolderPath, workspaceRoot))
                .toBe('treecipe/GeneratedRecipes/recipe-fakerjs-2026-10-08T12-00-00');

        });

        test('escapes link syntax, so a folder name cannot render as a command link in the notification', () => {

            const hostileFolderPath = path.join(workspaceRoot, '[click](command:workbench.action.terminal.new)');

            const displayPath = VSCodeWorkspaceService.toWorkspaceRelativeDisplayPath(hostileFolderPath, workspaceRoot);

            expect(displayPath).not.toContain('[click](command:');
            expect(displayPath).not.toMatch(/(?<!\\)\[/);

        });

    });

});
