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






// static async promptForObjectsPath(workspaceRoot:string ): Promise<string | undefined> {
// 
//     console.log('Workspace Root:', workspaceRoot);

//     if (!workspaceRoot) {
//         void vscode.window.showErrorMessage('No workspace folder found');
//         return undefined;
//     }

//     let currentPath = workspaceRoot;
    
//     while (true) {
        
//         const items = await this.getVSCodeQuickPickDirectoryItems(currentPath);
        
//         const selection = await vscode.window.showQuickPick(
//             items,
//             {
//                 placeHolder: 'Select directory that contains the Salesforce objects',
//                 ignoreFocusOut: true
//             }
//         );

//         if (!selection) {
//             // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
//             return undefined; 
//         } else {
//             return selection.label;
//         }

//     }
// }
