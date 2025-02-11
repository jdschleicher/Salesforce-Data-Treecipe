// import * as vscode from 'vscode';
// import { CollectionsApiService } from '../yourModule';
// import { VSCodeWorkspaceService } from '../services/VSCodeWorkspaceService';
// import { ConfigurationService } from '../services/ConfigurationService';

// jest.mock('vscode');
// jest.mock('../services/VSCodeWorkspaceService');
// jest.mock('../services/ConfigurationService');


import * as vscode from 'vscode';
import * as fs from 'fs';
import { CollectionsApiService } from '../CollectionsApiService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { MockVSCodeWorkspaceService } from '../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService';
import { MockDirectoryService } from '../../DirectoryProcessingService/tests/MockObjectsDirectory/MockDirectoryService';
import { MockCollectionsApiService } from './mocks/MockCollectionsApiService';
import { allowedNodeEnvironmentFlags } from 'process';

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



describe('Shared tests for CollectionsApiService', () => {

    describe('promptForDataSetObjectsPathVSCodeQuickItems', () => {

        // because we are testing the returned selection of the vscode.windwos.showQuickPickItem, the tests are mainly 
        // mocking out async module methods that would cause the test to fail if called as expected. However, the mocks that are included
        // would be expected to be correct values
        
        test('given mocked modules and given expected quick pick item, should return expected selected QuickPickItem', async () => {
        
            const mockDirectoriesWithDataSetFolders = MockDirectoryService.getMockedDirectoriesWithDatSetItemsIncluded();
            jest.spyOn(fs.promises, "readdir").mockReturnValue(Promise.resolve(mockDirectoriesWithDataSetFolders));
    
            const expectedQuickPickItem = {
                "label": "./andotherthings/dataset/rest-ofdirectoryname/",
                "description": "Directory",
                "iconPath": {
                    "id": "folder"
                },
                "detail": "theworkspaceroot/andotherthings/dataset/rest-ofdirectoryname"
            };

            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(expectedQuickPickItem);

            const actualSelection = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            expect(actualSelection).toEqual(expectedQuickPickItem);
    
        });
    
        test('given no selection made for quickpick item, should return undefined if no selection is made', async () => {
            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    
            const result = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            expect(result).toBeUndefined();
        });

    });

    describe('getExpectedSalesforceOrgToInsertAgainst', () =>{

        test('given mocked module methods and expected return value for entered alias, should return that alias', async () => {
            
            const fakeAlias = 'testAlias';
            jest.spyOn(vscode.window, "showInputBox").mockReturnValue(Promise.resolve(fakeAlias));

            jest.spyOn(VSCodeWorkspaceService, 'promptForUserInput').mockReturnValue(Promise.resolve(fakeAlias));

            const result = await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
            expect(result).toEqual(fakeAlias);

        });

    });

    describe('promptForAllOrNoneInsertDecision', () => {

        test('should have should return true when selected', async () => {
         
            const expectedTrueSelection = { detail: 'true' } as vscode.QuickPickItem;
            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(expectedTrueSelection);
    
            const actualSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            expect(actualSelection).toBe(true);

        });

        test('given no selection made, should return undefined', async () => {

            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    
            const result = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            expect(result).toBeUndefined();
    
        });

    });

    describe('getAllOrNoneQuickPickItemSelections', () => {

        test('given expected values, returns expected details for all or None selections', () => {

            const actualAllOrNoneSelections = CollectionsApiService.getAllOrNoneQuickPickItemSelections();

            expect(actualAllOrNoneSelections[0].detail).toBe('true');
            expect(actualAllOrNoneSelections[1].detail).toBe('false');

        });

    });

    describe('updateCompleteCollectionApiSobjectResults', () => {

        test('given mocked failed and success, returns expected details for all or None selections', () => {

            let initialCollectionApiResults: Record<string, Record<string, any[]>> = {
                'SuccessResults' : {},
                'FailureResults' : {}
            };
            const expectedObjectName = 'Account';
            const mockSobjectCollectionApiResults = MockCollectionsApiService.getMockCombinedSuccessAndFailureCollectionResults();
            const fakeSalesforceCoreConnection = MockCollectionsApiService.getFakeSalesforceCoreConnection();
            const actualAllSobjectCollectionResults = CollectionsApiService.updateCompleteCollectionApiSobjectResults(
                initialCollectionApiResults,
                mockSobjectCollectionApiResults,
                expectedObjectName,
                fakeSalesforceCoreConnection
            );
        
            const countOfAccountSuccessResults = actualAllSobjectCollectionResults.SuccessResults[expectedObjectName].length;
            const countOfAccountFailureResults = actualAllSobjectCollectionResults.FailureResults[expectedObjectName].length;

            expect(countOfAccountSuccessResults).toBe(3);
            expect(countOfAccountFailureResults).toBe(2);

        });

    });

 


  

});
