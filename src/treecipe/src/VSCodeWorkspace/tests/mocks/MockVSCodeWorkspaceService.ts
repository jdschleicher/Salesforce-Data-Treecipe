import * as vscode from 'vscode';


export class MockVSCodeWorkspaceService {

    static convertJSONDirectoryTemplateIntoVSCodeQuickPickItems(directoryJSONTemplate: string) {

    }


    static getMockVSCodeQuickPickItems():vscode.QuickPickItem[] {

        // get string of vscode directory
        // convert to vscodequickpickitems

        const mockedDirectoryStructure = new MockVSCodeWorkspaceService;
        let vsCodeQuickPickMockItems:vscode.QuickPickItem[] = [
            { 
                label: 'folder1', 
                description: 'desc1',
                iconPath: new vscode.ThemeIcon('folder') 
            },
            { 
                label: 'folder2', 
                description: 'desc2',
                iconPath: new vscode.ThemeIcon('folder')
            }
        ];


        return vsCodeQuickPickMockItems;
    }

   

}