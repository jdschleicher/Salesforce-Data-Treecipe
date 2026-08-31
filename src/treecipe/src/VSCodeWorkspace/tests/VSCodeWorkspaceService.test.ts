import { ConfigurationService } from "../../ConfigurationService/ConfigurationService";
import { MockDirectoryService } from "../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService";
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
        showInputBox: jest.fn(),
        createOutputChannel: jest.fn()
    },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });


describe('Shared VSCodeWorkspaceService unit tests', () => {

    describe('buildAuthenticatedOrgQuickPickItems', () => {

        test('given an alias, the alias labels the item and the username still describes it', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(quickPickItems[0].label).toBe('devhub');
            // THE USERNAME IS WHAT KEEPS TWO ALIASES ON ONE ORG TELLABLE APART
            expect(quickPickItems[0].description).toBe('jd@example.com');
            expect(quickPickItems[0].detail).toBe('devhub');

        });

        test('given no alias, the username labels the item', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com', alias: undefined }
            ] as any);

            expect(quickPickItems[0].label).toBe('jd@example.com');
            expect(quickPickItems[0].detail).toBe('jd@example.com');

        });

        test('given no authenticated orgs, produces an empty list rather than throwing', () => {
            expect(VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([])).toEqual([]);
        });

    });

    describe('promptForAuthenticatedTargetOrg', () => {

        test('given a selection, returns the target org identifier carried on detail', async () => {

            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
                label: 'devhub',
                description: 'jd@example.com',
                detail: 'devhub'
            } as never);

            const selectedTargetOrg = await VSCodeWorkspaceService.promptForAuthenticatedTargetOrg([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(selectedTargetOrg).toBe('devhub');

        });

        test('given the quick pick is dismissed, returns undefined', async () => {

            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

            const selectedTargetOrg = await VSCodeWorkspaceService.promptForAuthenticatedTargetOrg([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' }
            ] as any);

            expect(selectedTargetOrg).toBeUndefined();

        });

        /*
            A selection returns `detail`, so an org reaching the quick pick with an empty
            targetOrgIdentifier would be indistinguishable from a dismissal and the command would
            silently do nothing. That cannot happen because buildAuthenticatedOrgDetails drops an
            unusable identifier before it ever gets here -- this pins the property the safety of
            `?.detail` actually rests on.
        */
        test('every quick pick item carries a non-empty detail to select by', () => {

            const quickPickItems = VSCodeWorkspaceService.buildAuthenticatedOrgQuickPickItems([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' },
                { targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com', alias: undefined }
            ] as any);

            quickPickItems.forEach(quickPickItem => {
                expect(quickPickItem.detail).toBeTruthy();
            });

        });

    });

    describe('picklist dependency check output channel', () => {

        function buildMockOutputChannel() {
            return { clear: jest.fn(), appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };
        }

        beforeEach(() => {
            // THE CHANNEL IS CACHED ON THE CLASS, SO IT HAS TO BE CLEARED BETWEEN CASES
            (VSCodeWorkspaceService as any).picklistDependencyCheckOutputChannel = undefined;
            (VSCodeWorkspaceService as any).extensionSubscriptions = undefined;
        });

        test('creates the channel lazily and reuses the same one across calls', () => {

            const mockOutputChannel = buildMockOutputChannel();
            const createOutputChannelSpy = jest.spyOn(vscode.window, 'createOutputChannel')
                .mockReturnValue(mockOutputChannel as never);

            const firstChannel = VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();
            const secondChannel = VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();

            expect(createOutputChannelSpy).toHaveBeenCalledTimes(1);
            expect(firstChannel).toBe(secondChannel);

        });

        test('registers the channel for disposal when the extension supplied subscriptions', () => {

            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(buildMockOutputChannel() as never);

            const subscriptions: any[] = [];
            VSCodeWorkspaceService.registerExtensionSubscriptions(subscriptions);

            VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel();

            expect(subscriptions.length).toBe(1);

        });

        // NOTHING REGISTERS SUBSCRIPTIONS IN A JEST RUN, AND THAT MUST NOT THROW
        test('creates the channel without throwing when no subscriptions were registered', () => {

            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(buildMockOutputChannel() as never);

            expect(() => VSCodeWorkspaceService.getPicklistDependencyCheckOutputChannel()).not.toThrow();

        });

        /*
            Clearing before appending is what makes the visible output belong to the run that just
            finished. Appending without it silently accumulates every previous run's report.
        */
        test('clears the channel before writing the report, then reveals it', () => {

            const mockOutputChannel = buildMockOutputChannel();
            jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(mockOutputChannel as never);

            VSCodeWorkspaceService.showPicklistDependencyCheckReport('report body');

            expect(mockOutputChannel.clear).toHaveBeenCalled();
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('report body');
            expect(mockOutputChannel.show).toHaveBeenCalledWith(true);

            const clearCallOrder = mockOutputChannel.clear.mock.invocationCallOrder[0];
            const appendCallOrder = mockOutputChannel.appendLine.mock.invocationCallOrder[0];
            expect(clearCallOrder).toBeLessThan(appendCallOrder);

        });

    });

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
            jest.spyOn(VSCodeWorkspaceService, 'getPotentialTreecipeObjectDirectoryPathsQuickPickItems').mockResolvedValue(mockedVSCodeQuickPickItems);

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

        test('given a directory entry, builds a relative-path label from the traversed directoryPath rather than the deprecated Dirent.path', async () => {

            const mockWorkspaceRoot = '/mockWorkspace';
            const startingDirectoryPath = `${mockWorkspaceRoot}/force-app/main/default`;

            // Dirent intentionally has no path/parentPath to mirror the DEP0178 runtime where
            // fs.Dirent.path is undefined; the label must still resolve from directoryPath
            const objectsDirent = Object.assign(new fs.Dirent(), {
                name: 'objects',
                isDirectory: () => true
            });

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(fs.promises, 'readdir')
                .mockResolvedValueOnce([objectsDirent] as unknown as fs.Dirent[])
                .mockResolvedValueOnce([] as unknown as fs.Dirent[]);
            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const result = await VSCodeWorkspaceService.getPotentialTreecipeObjectDirectoryPathsQuickPickItems(startingDirectoryPath);

            expect(result.length).toEqual(1);
            expect(result[0].label).toBe('./force-app/main/default/objects/');
            expect(result[0].label).not.toContain('undefined');
            expect(result[0].detail).toBe(`${startingDirectoryPath}/objects`);

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
       
        const mockedDirents = [
            // Top-level files
            MockDirectoryService.createMockedDirent('recipe1.yaml', '/parent-path-mock/GeneratedRecipes', 'file'),
            MockDirectoryService.createMockedDirent('recipe2.yaml', '/parent-path-mock/GeneratedRecipes', 'file'),
          
            // First Top-level fakerjs directory
            MockDirectoryService.createMockedDirent('recipe-fakerjs-datetimestuff', '/parent-path-mock/GeneratedRecipes', 'dir'),
          
            // Nested files in First Top-Level expected fakerjs folder
            MockDirectoryService.createMockedDirent('recipe-fakerjs-test.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
            MockDirectoryService.createMockedDirent('recipe-fakerjs-nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
            MockDirectoryService.createMockedDirent('nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff', 'file'),
          
            //  nested folder that doesn't match faker-js indicator and would match for snowfakery
            MockDirectoryService.createMockedDirent('recipe-snowfakery-timestampfolder', '/parent-path-mock/GeneratedRecipes', 'dir'),
          
            // Nested files for snowfakery 
            MockDirectoryService.createMockedDirent('recipe-fakerjs-shouldntmatchsecond-test.yaml', '/parent-path-mock/GeneratedRecipes/rrecipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowmatch-1.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowmatch-2.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),
            MockDirectoryService.createMockedDirent('recipe-snowfakery-3.yaml', '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder', 'file'),

            // Second Top-level fakerjs directory
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second', '/parent-path-mock/GeneratedRecipes', 'dir'),
    
            // Nested files in Second Top-Level expected fakerjs folder
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second-test.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file'),
            MockDirectoryService.createMockedDirent('recipe-fakerjs-second-nested-recipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file'),
            MockDirectoryService.createMockedDirent('nested-no-matchrecipe.yaml', '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second', 'file')
    
        ];

        test('should return an empty array if no files are found', async () => {

            const expectedEmptyQuickPickItems = [];
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(expectedEmptyQuickPickItems);
            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
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
            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
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

        test('given file Dirents whose deprecated path property is undefined, builds detail from folderPathToParse without throwing', async () => {

            const folderPathToParse = '/mock/generated-recipes';

            // path/parentPath intentionally omitted to mirror the DEP0178 runtime where
            // fs.Dirent.path is undefined; path.join(undefined, name) would otherwise throw
            const mockDirents = [
                Object.assign(new fs.Dirent(), {
                    name: 'recipe1.yaml',
                    isFile: () => true
                }),
            ];

            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(mockDirents);
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, folderPathToParse);

            expect(actualQuickPickItems).toHaveLength(1);
            expect(actualQuickPickItems[0].detail).toBe('/mock/generated-recipes/recipe1.yaml');
            expect(actualQuickPickItems[0].detail).not.toContain('undefined');

        });


        test('given faker-js as selected faker service and directories with both fakerjs recipes and snowfakery, should return expected QuickPickItems for each file found', async () => {
                          
            const readdirMockFunctionImplementation = MockDirectoryService.getReaddirMockImplBySetOfMockedDirents(mockedDirents);

            jest.spyOn(fs.promises, 'readdir').mockImplementation(readdirMockFunctionImplementation);

            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('faker-js');
            
            const expectedFakerJSOnlyQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe-fakerjs-test.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff/recipe-fakerjs-test.yaml'
                },
                {
                    label: 'recipe-fakerjs-nested-recipe.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-datetimestuff/recipe-fakerjs-nested-recipe.yaml'
                },
                {
                    label: 'recipe-fakerjs-second-test.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second/recipe-fakerjs-second-test.yaml'
                },
                {
                    label: 'recipe-fakerjs-second-nested-recipe.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-fakerjs-second/recipe-fakerjs-second-nested-recipe.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/parent-path-mock/GeneratedRecipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedFakerJSOnlyQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedFakerJSOnlyQuickPickItems);

        });

        test('given snowfakery as selected faker service and directories with both fakerjs recipes and snowfakery, should return expected QuickPickItems for each file found', async () => {
     
            const readdirMockFunctionImplementation = MockDirectoryService.getReaddirMockImplBySetOfMockedDirents(mockedDirents);

            jest.spyOn(fs.promises, 'readdir').mockImplementation(readdirMockFunctionImplementation);

            // this mock below doesn't drive behavior but the test will fail as the getExtensionConfigValue tries to pull value from users local settings which do not exist as part of stand alone unit tests
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
            
            const expectedSnowfakeryOnlyQuickPickItems:vscode.QuickPickItem[] = [
                {
                    label: 'recipe1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe1.yaml'
                },
                {
                    label: 'recipe2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe2.yaml'
                },
                {
                    label: 'recipe-snowmatch-1.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowmatch-1.yaml'
                },
                {
                    label: 'recipe-snowmatch-2.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowmatch-2.yaml'
                },
                {
                    label: 'recipe-snowfakery-3.yaml',
                    description: 'File',
                    iconPath:  new vscode.ThemeIcon('file'),
                    detail: '/parent-path-mock/GeneratedRecipes/recipe-snowfakery-timestampfolder/recipe-snowfakery-3.yaml'
                }
            ];   

            let emptyQuickPickItems: vscode.QuickPickItem[] = [];
            const actualQuickPickItems = await VSCodeWorkspaceService.getAvailableRecipeFileQuickPickItemsByDirectory(emptyQuickPickItems, '/parent-path-mock/GeneratedRecipes');

            console.log('Actual Keys:', Object.keys(actualQuickPickItems));
            console.log('Expected Keys:', Object.keys(expectedSnowfakeryOnlyQuickPickItems));

            expect(actualQuickPickItems).toEqual(expectedSnowfakeryOnlyQuickPickItems);

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
            const parentDirectoryPath = `${fakeWorkspaceRoot}/${pathToFakeDirectory}`;

            const mockDirent = {
                name: fakeDirectoryName,
            } as fs.Dirent;


            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const actualQuickPickItemEntry = VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(mockDirent, fakeWorkspaceRoot, parentDirectoryPath);

            const fullFakePath = `${fakeWorkspaceRoot}/${pathToFakeDirectory}/${fakeDirectoryName}`;
            const fakeRelativePath = `./${pathToFakeDirectory}/${fakeDirectoryName}/`;
            expect(actualQuickPickItemEntry).toEqual({
                label: fakeRelativePath,
                description: 'Directory',
                iconPath: mockIcon,
                detail: fullFakePath,
            });

        });

        test('given a Dirent whose deprecated path property is undefined, should still build a defined label from the caller-supplied parent path', () => {

            const fakeWorkspaceRoot = '/mock/workspace/root';
            const fakeDirectoryName = 'objects';
            const parentDirectoryPath = `${fakeWorkspaceRoot}/force-app/main/default`;

            const mockDirent = {
                path: undefined,
                name: fakeDirectoryName,
            } as unknown as fs.Dirent;

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);

            const actualQuickPickItemEntry = VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(mockDirent, fakeWorkspaceRoot, parentDirectoryPath);

            expect(actualQuickPickItemEntry.label).toBe('./force-app/main/default/objects/');
            expect(actualQuickPickItemEntry.label).not.toContain('undefined');

        });

    });

    describe('getDataSetDirectoryQuickPickItemsByStartingDirectoryPath', () => {

        test('given snowfakery mocked as faker service and expected "dataset-" and "dataset-fakerjs" named folders, should return quick pick items for directories containing "dataset-" only and no "dataset-fakerjs"', async () => {

            const mockDirectoriesWithDataSetFolders = MockDirectoryService.getMockedDirectoriesWithDatSetItemsIncluded();
            jest.spyOn(fs.promises, "readdir").mockReturnValue(Promise.resolve(mockDirectoriesWithDataSetFolders));
    
            const mockWorkspaceRoot = 'theworkspaceroot'; // "theworkspaceroot" is found in the "path" property of the expected mocked directories. The matching workspaceroot is needed to build out quickpickitems correctly
            jest.spyOn(VSCodeWorkspaceService, "getWorkspaceRoot").mockReturnValue(mockWorkspaceRoot);

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);
       
            const quickPickItems: vscode.QuickPickItem[] = [];
            // the directory being read is the shared parent of every entry; it lives under the
            // workspace root so the derived relative-path label resolves correctly
            const directoryPath = 'theworkspaceroot/andotherthings';

            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("snowfakery");

            const actualDataSetQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);

            expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath, { withFileTypes: true });
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();

            const expectedQuickPickItems = [
                {
                    "label": "./andotherthings/dataset-foldernameone/rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-foldernameone/rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset-abc/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-abc/anotherone-rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset--fff-fakerjs/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset--fff-fakerjs/anotherone-rest-ofdirectoryname"
                }
            ];

            expect(actualDataSetQuickPickItems).toEqual(expectedQuickPickItems);

        });

        test('given faker-js mocked as faker service and expected "dataset-" and "dataset-fakerjs" named folders, should return quick pick items for directories containing "dataset-fakerjs" only and no "dataset-"', async () => {

            const mockDirectoriesWithDataSetFolders = MockDirectoryService.getMockedDirectoriesWithDatSetItemsIncluded();
            jest.spyOn(fs.promises, "readdir").mockReturnValue(Promise.resolve(mockDirectoriesWithDataSetFolders));
    
            const mockWorkspaceRoot = 'theworkspaceroot'; // "theworkspaceroot" is found in the "path" property of the expected mocked directories. The matching workspaceroot is needed to build out quickpickitems correctly
            jest.spyOn(VSCodeWorkspaceService, "getWorkspaceRoot").mockReturnValue(mockWorkspaceRoot);

            const mockIcon = new vscode.ThemeIcon('folder');
            jest.spyOn(vscode, "ThemeIcon").mockReturnValue(mockIcon);
       
            const quickPickItems: vscode.QuickPickItem[] = [];
            // the directory being read is the shared parent of every entry; it lives under the
            // workspace root so the derived relative-path label resolves correctly
            const directoryPath = 'theworkspaceroot/andotherthings';

            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("faker-js");

            const actualDataSetQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);

            expect(fs.promises.readdir).toHaveBeenCalledWith(directoryPath, { withFileTypes: true });
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();
            
            const expectedQuickPickItems = [
                {
                    "label": "./andotherthings/dataset-fakerjs-test/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-fakerjs-test/anotherone-rest-ofdirectoryname"
                },
                {
                    "label": "./andotherthings/dataset-fakerjs-testtwo/anotherone-rest-ofdirectoryname/",
                    "description": "Directory",
                    "iconPath": {
                    "id": "folder"
                    },
                    "detail": "theworkspaceroot/andotherthings/dataset-fakerjs-testtwo/anotherone-rest-ofdirectoryname"
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

            //mocking faker service to avoid test run time failure
            jest.spyOn(ConfigurationService, "getSelectedDataFakerServiceConfig").mockReturnValue("faker-js");

            const result = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath, quickPickItems);
    
            expect(result).toEqual([]); 
        
        });

    });

    describe('createUniqueTimeStampedFakeDataSetsFolderName', () => {
        
        test('should create a unique timestamped folder for fake data sets', () => {

            const uniqueTimeStampedFakeDataSetsFolderName = '2024-11-25T16-24-15';
            const mockWorkspaceRoot = '/mock/workspace';
            const mockFakeDataSetsFolderPath = 'treecipe/FakeDataSets';
            const mockExpectedFolderPath = `${mockWorkspaceRoot}/${mockFakeDataSetsFolderPath}`;
            const mockUniqueFolderName = `dataset-${uniqueTimeStampedFakeDataSetsFolderName}`;
            const mockFullPathToUniqueFolder = `${mockExpectedFolderPath}/${mockUniqueFolderName}`;

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'createFakeDatasetsTimeStampedFolderName').mockReturnValue(mockUniqueFolderName);

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'mkdirSync').mockImplementation();

            const result = VSCodeWorkspaceService.createUniqueTimeStampedFakeDataSetsFolderName(mockUniqueFolderName);

            expect(fs.existsSync).toHaveBeenCalledWith(mockExpectedFolderPath);
            expect(fs.mkdirSync).toHaveBeenCalledWith(mockFullPathToUniqueFolder);
            expect(result).toBe(mockFullPathToUniqueFolder);
        
        });

    });

    describe('createFakeDatasetsTimeStampedFolderName', () => {

        test('given snowfakery selected as faker service, should create a unique timestamped folder name', () => {

            const fakeTimestamp = '2024-11-25T16-24-15';
            const mockDate = new Date('2024-11-25T16:24:15Z');
            jest.spyOn(global, 'Date').mockReturnValue(mockDate);

            jest.spyOn(global, 'Date').mockImplementation();
            jest.spyOn(mockDate, 'toISOString').mockReturnValue('2024-11-25T16:24:15.000Z');

            const expectedFolderName = `dataset-${fakeTimestamp}`;

            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('snowfakery');

            const actualFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(fakeTimestamp);
            expect(actualFolderName).toBe(expectedFolderName);

        });

        test('given fakerjs selected as faker service, should create a unique timestamped folder name with fakerjs included', () => {

            const fakeTimestamp = '2024-11-25T16-24-15';
            const mockDate = new Date('2024-11-25T16:24:15Z');
            jest.spyOn(global, 'Date').mockReturnValue(mockDate);

            jest.spyOn(global, 'Date').mockImplementation();
            jest.spyOn(mockDate, 'toISOString').mockReturnValue('2024-11-25T16:24:15.000Z');

            const expectedFolderName = `dataset-fakerjs-${fakeTimestamp}`;

            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');

            const actualFolderName = VSCodeWorkspaceService.createFakeDatasetsTimeStampedFolderName(fakeTimestamp);
            expect(actualFolderName).toBe(expectedFolderName);

        });

    });

});




