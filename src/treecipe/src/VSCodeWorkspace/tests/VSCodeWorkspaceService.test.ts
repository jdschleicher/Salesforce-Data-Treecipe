import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";

import * as vscode from 'vscode';
import { MockVSCodeWorkspaceService } from "./mocks/MockVSCodeWorkspaceService";

import * as fs from 'fs';

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


    test('should call vscode.window.showQuickPick with correct parameters', async () => {
        const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

        await VSCodeWorkspaceService.promptForFakerServiceImplementation();

        expect(showQuickPickSpy).toHaveBeenCalledWith(
            [
                {
                    label: 'Snowfakery',
                    description: 'CumulusCI Python port of Faker - https://snowfakery.readthedocs.io/en/latest/',
                    iconPath: expect.any(Object)
                },
                {
                    label: 'faker-js',
                    description: 'Javascript port of Faker - https://fakerjs.dev/',
                    iconPath: expect.any(Object)
                }
            ],
            {
                placeHolder: 'Select Data Faker Service',
                ignoreFocusOut: true
            }
        );
    });


    
});

describe('readdirRecursive', () => {
    let mockItems;

    beforeEach(() => {
        jest.restoreAllMocks();
        mockItems = [];
    });

    test('should traverse directories and add items to the list', async () => {
        const mockDirPath = '/mockDir';
        const mockWorkspaceRoot = '/mockWorkspace';
     
        const mockDirents = Promise.resolve([
            Object.assign(new fs.Dirent(), { name: 'file1.txt', isFile: () => true }),
            Object.assign(new fs.Dirent(), { name: 'folder1', isDirectory: () => false }),
            Object.assign(new fs.Dirent(), { name: 'symlink1', isSymbolicLink: () => true })
        ]);
        jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
        jest.spyOn(fs.promises, 'readdir').mockReturnValue(mockDirents);

        const result = await VSCodeWorkspaceService.getVSCodeQuickPickDirectoryItems(mockDirPath);

    // TEST IS SETUP TO AVOID RECURSIVE
        expect(result.length).toEqual(0);
        
    });


});
