import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspaceService";
import { MockVSCodeWorkspaceService } from "./mocks/MockVSCodeWorkspaceService";

import * as fs from 'fs';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        fs: {
            readFile: jest.fn()
        },
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn()
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

    describe('promptForDirectoryToGenerateQuickItemsForFileSelection', () => {

        test('should return undefined if no showQuickPick selection is mocked to undefined', async () => {
            
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableRecipeFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

            const fakeDirectoryPath = 'treecipe/';
            const fakeQuickPickItemLabel = 'Select the thing';
            const result = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(fakeDirectoryPath, fakeQuickPickItemLabel);
            expect(result).toBeUndefined();

        });

        test('should return the expected mock selected recipe file passed into mocked showQuickPick', async () => {

            const expectedMockQuickPickItem = { label: 'recipe1.json', description: 'File', iconPath: expect.any(Object), detail: '/mock/workspace/generated-recipes/recipe1.json' };
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/mock/workspace');
            jest.spyOn(ConfigurationService, 'getGeneratedRecipesFolderPath').mockReturnValue('generated-recipes');
            jest.spyOn(VSCodeWorkspaceService, 'getAvailableRecipeFileQuickPickItemsByDirectory').mockResolvedValue([]);
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(expectedMockQuickPickItem);

            const fakeDirectoryPath = 'treecipe/';
            const fakeQuickPickItemLabel = 'Select the thing';
            const actualQuickPickSelectedRecipeFileToProcess = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(fakeDirectoryPath, fakeQuickPickItemLabel);
            expect(actualQuickPickSelectedRecipeFileToProcess).toEqual(expectedMockQuickPickItem);

        });

        afterEach(() => {        
            jest.restoreAllMocks();
        });

    });

    describe('getAvailableRecipeFileQuickPickItemsByDirectory', () => {

        test('should return an empty array if no files are found', async () => {

            const expectedEmptyQuickPickItems = [];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedEmptyQuickPickItems);

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/mock/generated-recipes');
            expect(actualQuickPickItems).toEqual(emptyQuickPickItems);

        });

        test('should return an array of QuickPickItems for each file found', async () => {
            
            const mockDirents = [
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe1.yaml', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
                Object.assign(new fs.Dirent(), { 
                    name: 'recipe2.yaml', 
                    isFile: () => true, 
                    path: '/mock/generated-recipes'
                }),
            ];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents);

            const expectedQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe1.yaml'
                },
                {
                    label: 'recipe2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/mock/generated-recipes/recipe2.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/mock/generated-recipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedQuickPickItems);

        });

    });

    describe('promptForUserInput', () => {

        test('should return user input when showInputBox is called', async () => {

            const expectedMockedResponse = 'test input';
            const expectedPlaceholderArgument = 'Please enter a value:';
            (vscode.window.showInputBox as jest.Mock).mockResolvedValue(expectedMockedResponse);

            const actualResponse = await VSCodeWorkspaceService.promptForUserInput(expectedPlaceholderArgument);

            expect(actualResponse).toBe(expectedMockedResponse);
            expect(vscode.window.showInputBox).toHaveBeenCalledWith({
                placeHolder: expectedPlaceholderArgument
            });

        });

        test('should return undefined if the user cancels the input', async () => {

            (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);

            const result = await VSCodeWorkspaceService.promptForUserInput('Please enter a value:');

            expect(result).toBeUndefined();

        });

    });

    describe('getFileContentByPath', () => {

        test('given expected file content to be returned from readFile, should return file content when readFile is successful', async () => {
            
            const filePath = '/path/to/file.txt';
            const fileContent = 'File content here';
            (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(fileContent));

            const result = await VSCodeWorkspaceService.getFileContentByPath(filePath);

            expect(result).toBe(fileContent);
            expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(vscode.Uri.file(filePath));
        
        });

    });

    describe('getNowIsoDateTimestamp', () => {
        test('given expected value for datetime, should return the correctly formatted ISO date timestamp', () => {

            const expectedDateTimeToBeFormatted = new Date('2024-11-25T16:24:15.000Z');
            jest.spyOn(global, 'Date').mockImplementationOnce(() => expectedDateTimeToBeFormatted as any);

            const actualIsoDateTimeResult = VSCodeWorkspaceService.getNowIsoDateTimestamp();

            expect(actualIsoDateTimeResult).toBe('2024-11-25T16-24-15');

        });

    });

    describe('buildDirectoryVSCodeQuickPickItemByDirectoryEntry', () => {
        
        test('given expected arguments and mocked out modules, should build the correct quickPickItem', () => {
            
            const fakeWorkspaceRoot = '/mock/workspace/root';
            const fakeDirectoryName = 'fakeDirectory';
            const pathToFakeDirectory = 'mock/path/to/entry';
            const rootPathToFakeDirectory = `${fakeWorkspaceRoot}/${pathToFakeDirectory}`;
            
            const mockDirent = {
                path: rootPathToFakeDirectory, 
                name: fakeDirectoryName, 
            } as fs.Dirent;
    
    
            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const actualQuickPickItemEntry = VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(mockDirent, fakeWorkspaceRoot);
    
            const fullFakePath = `${fakeWorkspaceRoot}/${pathToFakeDirectory}/${fakeDirectoryName}`;
            const fakeRelativePath = `./${pathToFakeDirectory}/${fakeDirectoryName}/`;
            expect(actualQuickPickItemEntry).toEqual({
                label: fakeRelativePath,
                description: 'Directory',
                iconPath: mockIcon,
                detail: fullFakePath,
            });

        });

    });

    describe('getDataSetDirectoryQuickPickItemsByStartingDirectoryPath', () => {

        test('should return quick pick items for directories containing "dataset"', async () => {

            const subStringToIdentifyDirectoryAsDataSetDirectory = 'dataset';
            const mockReaddir = jest.fn().mockResolvedValue([
                { 
                    name: `${subStringToIdentifyDirectoryAsDataSetDirectory}/rest-ofdirectoryname`, 
                    isDirectory: () => true }, 
                { 
                    name: 'other', 
                    isDirectory: () => true }, // expected to not be in returned quickpick items
                { 
                    name: `${subStringToIdentifyDirectoryAsDataSetDirectory}/anotherone-rest-ofdirectoryname`, 
                    isDirectory: () => true } 
            ]);
            fs.promises.readdir = mockReaddir;
    
            const mockWorkspaceRoot = '/mock/workspace/root';
            jest.spyOn(VSCodeWorkspaceService, "getWorkspaceRoot").mockReturnValue(mockWorkspaceRoot);

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);
            const mockQuickPickItem = { 
                label: 'mock label', 
                description: 'mock description', 
                iconPath: mockIcon, 
                detail: 'mock detail' 
            };
            jest.spyOn(VSCodeWorkspaceService, 'buildDirectoryVSCodeQuickPickItemByDirectoryEntry').mockReturnValue(mockQuickPickItem);
    
            const quickPickItems: vscode.QuickPickItem[] = [];
            const directoryPath = '/mock/directory/path';
            const actualDataSetQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);
    
            expect(mockReaddir).toHaveBeenCalledWith(directoryPath, { withFileTypes: true });
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();
            
            const expectedQuickPickItems = [
                { 
                    label: 'mock label', 
                    description: 'mock description', 
                    iconPath: mockIcon, 
                    detail: 'mock detail' 
                },
                { 
                    label: 'mock label', 
                    description: 'mock description', 
                    iconPath: mockIcon, 
                    detail: 'mock detail' 
                }
            ];

            expect(actualDataSetQuickPickItems).toEqual(expectedQuickPickItems);

        });
    
        test('given no directories with dataset substring, should not return non-dataset directories', async () => {

            const mockReaddir = jest.fn().mockResolvedValue([
                { name: 'other1', isDirectory: () => true },
                { name: 'other2', isDirectory: () => true }
            ]);
            fs.promises.readdir = mockReaddir;
    
            const quickPickItems: vscode.QuickPickItem[] = [];
            const directoryPath = '/mock/directory/path';
            const result = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);
    
            expect(result).toEqual([]); 
        
        });

    });

});




