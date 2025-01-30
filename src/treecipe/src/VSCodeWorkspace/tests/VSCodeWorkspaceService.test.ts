import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
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


describe('Shared VSCodeWorkspaceService unit tests', () => {

    describe('promptForObjectsPath', () => {

        test('if no selection made, should return undefined', async () => {
            const fakeWorkspaceRoot = '/fake/workspace';
            const mockedVSCodeQuickPickItems = MockVSCodeWorkspaceService.getMockVSCodeQuickPickItems();

            jest.spyOn(VSCodeWorkspaceService as any, 'getPotentialTreecipeObjectDirectoryPathsQuickPickItems').mockResolvedValue(mockedVSCodeQuickPickItems);

            const result = await VSCodeWorkspaceService.promptForObjectsPath(fakeWorkspaceRoot);
            expect(result).toBeUndefined();

        });

        test('should return undefined when user makes no selection', async () => {       

            const mockedVSCodeQuickPickItems = MockVSCodeWorkspaceService.getMockVSCodeQuickPickItems();
            jest.spyOn(VSCodeWorkspaceService as any, 'getPotentialTreecipeObjectDirectoryPathsQuickPickItems').mockResolvedValue(mockedVSCodeQuickPickItems);

            const expectedPath = "/test/path";
            const result = await VSCodeWorkspaceService.promptForObjectsPath(expectedPath);
            
            expect(VSCodeWorkspaceService.getPotentialTreecipeObjectDirectoryPathsQuickPickItems).toHaveBeenCalledWith(expectedPath);
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

    describe('getDirectoryQuickPickItemsByStartingDirectoryPath', () => {
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

            const result = await VSCodeWorkspaceService.getPotentialTreecipeObjectDirectoryPathsQuickPickItems(mockDirPath);

            // TEST IS SETUP TO AVOID RECURSIVE
            expect(result.length).toEqual(0);
            
        });


    });

    describe('isPossibleTreecipeUsableDirectory', () => {

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
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
            
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
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
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
            
            const isPossibleTreecipeDirectory = VSCodeWorkspaceService.isPossibleTreecipeUsableDirectory(mockDirent);
            expect(isPossibleTreecipeDirectory).toBeFalsy();

        });

    });

    describe('promptForDirectoryToGenerateFIleQuickItemsFrom', () => {

        test('should return undefined if no showQuickPick selection is mocked to undefined', async () => {
            
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

            const result = await VSCodeWorkspaceService.promptForDirectoryToGenerateFIleQuickItemsFrom();
            expect(result).toBeUndefined();

        });

        test('should return the expected mock selected recipe file passed into mocked showQuickPick', async () => {

            const expectedMockQuickPickItem = { label: 'recipe1.json', description: 'File', iconPath: expect.any(Object), detail: '/mock/workspace/generated-recipes/recipe1.json' };
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(expectedMockQuickPickItem);

            const actualQuickPickSelectedRecipeFileToProcess = await VSCodeWorkspaceService.promptForDirectoryToGenerateFIleQuickItemsFrom();
            expect(actualQuickPickSelectedRecipeFileToProcess).toEqual(expectedMockQuickPickItem);

        });

        afterEach(() => {        
            jest.restoreAllMocks();
        });

    });

    describe('getAvailableFileQuickPickItemsByDirectory', () => {

        test('should return an empty array if no files are found', async () => {

            const expectedEmptyQuickPickItems = [];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedEmptyQuickPickItems);

            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableFileQuickPickItemsByDirectory('/mock/generated-recipes');
            expect(actualQuickPickItems).toEqual(expectedEmptyQuickPickItems);

        });

        test('should return an array of QuickPickItems for each file found', async () => {
            
            const mockDirents = [
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe1.json', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe2.json', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
            ];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents);

            const expectedQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe1.json',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe1.json'
                },
                {
                    label: 'recipe2.json',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe2.json'
                }
            ];   
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableFileQuickPickItemsByDirectory('/mock/generated-recipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedQuickPickItems);

        });

    });

});
