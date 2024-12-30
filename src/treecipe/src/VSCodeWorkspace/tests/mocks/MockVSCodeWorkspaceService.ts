import * as vscode from 'vscode';


export class MockVSCodeWorkspaceService {

    static getMockVSCodeQuickPickItems():vscode.QuickPickItem[] {

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

    static getFakeVSCodeUri(): vscode.Uri {

        const mockedUri = {
            scheme: 'http',
            authority: 'mocked.url',
            path: '/',
            query: '',
            fragment: '',
            toString: jest.fn().mockReturnValue('http://mocked.url')
        };

        const castGymasticsForFakeUri = mockedUri as unknown as vscode.Uri;
        return castGymasticsForFakeUri;
        
    }

   

}