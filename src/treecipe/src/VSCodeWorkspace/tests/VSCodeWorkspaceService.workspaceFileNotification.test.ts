import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";

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
    }
}), { virtual: true });

/*
    The notification whose one button opens a file a run wrote: the shared insert's failure
    (#310) and the Recipe Cockpit's insert and scratch org outcomes (#301). The file is checked
    again on the click, since the notification can sit open while it is removed or replaced.
*/
describe('VSCodeWorkspaceService notification with a workspace file', () => {

    const MISSING_TEXT = 'The results file no longer exists in this workspace.';
    let workspaceRoot: string;
    let outsideRoot: string;
    let resultsFilePath: string;

    const flushClick = () => new Promise(resolve => setImmediate(resolve));

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-notify-workspace-'));
        outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-notify-outside-'));
        resultsFilePath = path.join(workspaceRoot, 'insertAttemptResults.json');
        fs.writeFileSync(resultsFilePath, '{}');
        (vscode.window.showInformationMessage as jest.Mock).mockReset();
        (vscode.window.showWarningMessage as jest.Mock).mockReset();
        (vscode.window.showErrorMessage as jest.Mock).mockReset();
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
        fs.rmSync(outsideRoot, { recursive: true, force: true });
    });

    it.each([
        ['information', 'showInformationMessage'],
        ['warning', 'showWarningMessage'],
        ['error', 'showErrorMessage']
    ] as const)('shows a %s notification with the button when there is a file', (severity, notifyName) => {

        VSCodeWorkspaceService.showNotificationWithWorkspaceFile(severity, 'It ended.', 'View errors', resultsFilePath, workspaceRoot, MISSING_TEXT);

        expect((vscode.window[notifyName] as jest.Mock).mock.calls).toEqual([['It ended.', 'View errors']]);

    });

    it('offers no button when there is no file', () => {

        VSCodeWorkspaceService.showNotificationWithWorkspaceFile('error', 'It ended.', 'View errors', undefined, workspaceRoot, MISSING_TEXT);

        expect((vscode.window.showErrorMessage as jest.Mock).mock.calls).toEqual([['It ended.']]);

    });

    it('opens the file when the button is clicked, and nothing when the notification is dismissed', async () => {

        const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

        (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);
        VSCodeWorkspaceService.showNotificationWithWorkspaceFile('error', 'It ended.', 'View errors', resultsFilePath, workspaceRoot, MISSING_TEXT);
        await flushClick();
        expect(openSpy).not.toHaveBeenCalled();

        (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce('View errors');
        VSCodeWorkspaceService.showNotificationWithWorkspaceFile('error', 'It ended.', 'View errors', resultsFilePath, workspaceRoot, MISSING_TEXT);
        await flushClick();
        expect(openSpy).toHaveBeenCalledWith(resultsFilePath);

    });

    it('throws nothing when the notification itself fails to show', async () => {

        const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
        (vscode.window.showErrorMessage as jest.Mock).mockRejectedValue(new Error('no window'));

        expect(() => VSCodeWorkspaceService.showNotificationWithWorkspaceFile('error', 'It ended.', 'View errors', resultsFilePath, workspaceRoot, MISSING_TEXT)).not.toThrow();
        await flushClick();

        expect(openSpy).not.toHaveBeenCalled();

    });

    describe('openWorkspaceResultFile', () => {

        it('opens a file that exists inside the workspace', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await VSCodeWorkspaceService.openWorkspaceResultFile(resultsFilePath, workspaceRoot, MISSING_TEXT);

            expect(openSpy).toHaveBeenCalledWith(resultsFilePath);

        });

        it('opens nothing, and says so, for a file that is gone', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            fs.rmSync(resultsFilePath);

            await VSCodeWorkspaceService.openWorkspaceResultFile(resultsFilePath, workspaceRoot, MISSING_TEXT);

            expect(openSpy).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(MISSING_TEXT);

        });

        it('opens nothing for a file outside the workspace', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const outsideFilePath = path.join(outsideRoot, 'insertAttemptResults.json');
            fs.writeFileSync(outsideFilePath, '{}');

            await VSCodeWorkspaceService.openWorkspaceResultFile(outsideFilePath, workspaceRoot, MISSING_TEXT);

            expect(openSpy).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(MISSING_TEXT);

        });

        it('opens nothing for a file replaced by a link out of the workspace', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const outsideFilePath = path.join(outsideRoot, 'secret.json');
            fs.writeFileSync(outsideFilePath, '{}');
            fs.rmSync(resultsFilePath);
            fs.symlinkSync(outsideFilePath, resultsFilePath);

            await VSCodeWorkspaceService.openWorkspaceResultFile(resultsFilePath, workspaceRoot, MISSING_TEXT);

            expect(openSpy).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(MISSING_TEXT);

        });

    });

});
