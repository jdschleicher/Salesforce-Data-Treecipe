import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";

import * as vscode from 'vscode';
import { MockVSCodeWorkspaceService } from "./mocks/MockVSCodeWorkspaceService";

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn()
    },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });


describe('promptForObjectsPath', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('if no workspace folder definied, should return undefined when no workspace root is provided and expected error message shown', async () => {
        const result = await VSCodeWorkspaceService.promptForObjectsPath('');
        const expectedErrorMessage = 'No workspace folder found';
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expectedErrorMessage);
        expect(result).toBeUndefined();
    });

    test('should return undefined when user makes no selection', async () => {       

        let mockedVSCodeQuickPickItems = MockVSCodeWorkspaceService.getMockVSCodeQuickPickItems();
        jest.spyOn(VSCodeWorkspaceService as any, 'getVSCodeQuickPickDirectoryItems').mockResolvedValue(mockedVSCodeQuickPickItems);

        const expectedPath = "/test/path";
        const result = await VSCodeWorkspaceService.promptForObjectsPath(expectedPath);
        
        expect(VSCodeWorkspaceService.getVSCodeQuickPickDirectoryItems).toHaveBeenCalledWith(expectedPath);
        expect(vscode.window.showQuickPick).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
    
});
