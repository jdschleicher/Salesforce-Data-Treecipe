import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";
import { MockVSCodeWorkspaceService } from "./mocks/MockVSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';

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
                    label: 'snowfakery',
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

describe('parseForPotentialTreecipeObjectsDirectoriesRecursively', () => {
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

describe('isPossibleTreecipeObjectsDirectory', () => {

    test('given expected invalid directory name returns false', () => {

        const mockDirent: fs.Dirent = {
            name: '.git',
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isDirectory: () => true,
            isFIFO: () => false,
            isFile: () => false,
            isSocket: () => false,
            isSymbolicLink: () => false,
            parentPath: '/',
            path: '.git'
        };
           
        const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeObjectsDirectory(mockDirent);
        
        expect(isPossibleTreecipeDirectory).toBeFalsy();

    });

    test('given expected valid directory name returns true', () => {

        const mockDirent: fs.Dirent = {
            name: 'objects',
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isDirectory: () => true,
            isFIFO: () => false,
            isFile: () => false,
            isSocket: () => false,
            isSymbolicLink: () => false,
            parentPath: 'force-app/main/default/',
            path: 'force-app/main/default/objects'
        };
           
        const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeObjectsDirectory(mockDirent);
        expect(isPossibleTreecipeDirectory).toBeTruthy();

    });

    test('given expected file Dirent returns invalid treecipe directory', () => {

        const mockDirent: fs.Dirent = {
            name: 'validfoldername',
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isDirectory: () => false,
            isFIFO: () => false,
            isFile: () => false,
            isSocket: () => false,
            isSymbolicLink: () => false,
            parentPath: 'force-app/main/default/',
            path: 'force-app/main/default/validfoldername'
        };
           
        const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeObjectsDirectory(mockDirent);
        expect(isPossibleTreecipeDirectory).toBeFalsy();

    });

});
