
import * as vscode from 'vscode';
import * as fs from 'fs';
import { CollectionsApiService } from '../CollectionsApiService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { MockDirectoryService } from '../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService';
import { MockCollectionsApiService } from './mocks/MockCollectionsApiService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';

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

        /*
            because we are testing the returned selection of the vscode.windwos.showQuickPickItem, the tests are mainly 
            mocking out async module methods that would cause the test to fail if called as expected. However, the mocks that are included
            would be expected to be correct values
         */ 
        test('given mocked modules, expected quick pick item, and snowfakery selected as faker service, should return expected selected QuickPickItem', async () => {
        
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
            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('snowfakery');

            const actualSelection = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            expect(actualSelection).toEqual(expectedQuickPickItem);
    
        });


        test('given mocked modules, given expected quick pick item, and faker-js selected as faker service, should return expected selected QuickPickItem', async () => {
        
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
            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockReturnValue('faker-js');

            const actualSelection = await CollectionsApiService.promptForDataSetObjectsPathVSCodeQuickItems();
            expect(actualSelection).toEqual(expectedQuickPickItem);
    
        });
    
        test('given no selection made for quickpick item, should return undefined if no selection is made', async () => {
            
            const mockWorkspaceRoot = 'rootMock/mock';
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            
            const dontCareAsWeAreExpectingNoSelection = undefined;
            jest.spyOn(VSCodeWorkspaceService, 'getDataSetDirectoryQuickPickItemsByStartingDirectoryPath').mockReturnValue(Promise.resolve(dontCareAsWeAreExpectingNoSelection));

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

        test('given false selection made, should return undefined', async () => {

            const expectedFalseSelection = { detail: 'false' } as vscode.QuickPickItem;
            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(expectedFalseSelection);
        
            const actualSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
            expect(actualSelection).toBe(false);
    
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
            const fakeSalesforceCoreConnection = MockCollectionsApiService.getSimpleCoreConnectionMock();
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

    describe('updateCompleteCollectionApiSobjectResults', () => {
      
        test('given successfull records should add successful records to SuccessResults', () => {
            
            let allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>> = {
                'SuccessResults' : {},
                'FailureResults' : {}
            };

            const fakeSalesforceConnection = MockCollectionsApiService.getSimpleCoreConnectionMock();
            const expectedSuccessfulResults = MockCollectionsApiService.getMockedCollectionApiSuccessfulResults();
 
            const sobjectApiName = 'mockSObjectApiName';
        
            allCollectionApiFilesSobjectResults = CollectionsApiService.updateCompleteCollectionApiSobjectResults(
                allCollectionApiFilesSobjectResults,
                expectedSuccessfulResults,
                sobjectApiName,
                fakeSalesforceConnection
            );
        
            const actualCountOfSuccessResults = Object.values(allCollectionApiFilesSobjectResults.SuccessResults)[0].length;
            const expectedCountOfSucessResults = expectedSuccessfulResults.length;
            expect(actualCountOfSuccessResults).toBe(expectedCountOfSucessResults);
        
        });
        
        test('given fake failure and successful tests, should add to expected FailureResults and SuccessResults maps', () => {
            
            let allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>> = {
                'SuccessResults' : {},
                'FailureResults' : {}
            };

            const sObjectResults = MockCollectionsApiService.getMockCombinedSuccessAndFailureCollectionResults();
            const sobjectApiName = 'mockSObjectApiName';
            const fakeSalesforceConnection = MockCollectionsApiService.getSimpleCoreConnectionMock();

            const spyAddItemsToRecordMap = jest.spyOn(CollectionsApiService, 'addItemToRecordMap');

            allCollectionApiFilesSobjectResults = CollectionsApiService.updateCompleteCollectionApiSobjectResults(
                allCollectionApiFilesSobjectResults,
                sObjectResults,
                sobjectApiName,
                fakeSalesforceConnection
            );

            const expectedSuccessResultsCount = 3;
            const actualCountOfSuccessResults = Object.values(allCollectionApiFilesSobjectResults.SuccessResults)[0].length;
            expect(actualCountOfSuccessResults).toBe(expectedSuccessResultsCount);
            
            const expectedFailureResultsCount = 2;
            const actualCountOfFailureResults = Object.values(allCollectionApiFilesSobjectResults.FailureResults)[0].length;
            expect(actualCountOfFailureResults).toBe(expectedFailureResultsCount);
        
            // not sure how useful this spy test is but with the expected combined mock sobject results being 5 we can confirm its making the expected amount of map updates
            const expectedCountOfSocjectResults = sObjectResults.length;
            expect(spyAddItemsToRecordMap).toHaveBeenCalledTimes(expectedCountOfSocjectResults);

        });

    });

    describe('addItemToRecordMap', () => {
        
        test('given expected records for existing key, should add an item to an existing key in the recordMap', () => {
          
            const expectedExistingRecord = {
                id: 1, name: 'Item 1'
            };
            const recordMap: Record<string, any[]> = {
                'existingKey': [
                    expectedExistingRecord
                ]
            };

            const key = 'existingKey';
            const newRecordToAddToExistingKey = { id: 2, name: 'Item 2' };
        
            const updatedRecordMap = CollectionsApiService.addItemToRecordMap(recordMap, key, newRecordToAddToExistingKey);
        
            expect(updatedRecordMap[key]).toHaveLength(2);
            expect(updatedRecordMap[key]).toEqual(
                expect.arrayContaining([
                    expect.objectContaining(expectedExistingRecord),
                    expect.objectContaining(newRecordToAddToExistingKey),
                ])
            );

        });
      
        test('given empty map, should create a new key and add the item when the key does not exist in the recordMap', () => {
            
            const recordMap: Record<string, any[]> = {};
            const key = 'newKey';
            const newRecordForNewKey = { id: 2, name: 'Item 2' };
        
            const updatedRecordMap = CollectionsApiService.addItemToRecordMap(recordMap, key, newRecordForNewKey);
        
            expect(updatedRecordMap[key]).toHaveLength(1);
            expect(updatedRecordMap[key]).toEqual([expect.objectContaining(newRecordForNewKey)]);

        });
      
 
    });

    describe('getObjectNameFromCollectionsApiFilePath', () => {

        test('given non matching collections api file name pattern, returns null, ', async() => {

            const nonmatchingFileName = 'thiswontwork.json';

            const actualObjectName = CollectionsApiService.getObjectNameFromCollectionsApiFilePath(nonmatchingFileName);

            expect(actualObjectName).toBeNull();

        });

        test('given matching collections api file name pattern, returns object name from file name, ', async() => {

            const expectedObjectName = 'theObjectInTheForest';
            const nonmatchingFileName = `collectionsApi-${expectedObjectName}.json`;

            const actualObjectName = CollectionsApiService.getObjectNameFromCollectionsApiFilePath(nonmatchingFileName);

            expect(actualObjectName).toBe(expectedObjectName);

        });

    });

    describe('getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap', () => {

        test('given mocked file content with expected treecipe json returns expected treecipe info wrapper detail', async() => {

            const fakeJsonTreecipeObjectInfoWrapper = MockCollectionsApiService.getFakeTreecipeObjectInfoWrapperJson();
            jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockReturnValue(Promise.resolve(fakeJsonTreecipeObjectInfoWrapper));
            
            const datasetChildFoldersToFilesMap = {
                "someDirectory": ["file1", "file2"],
                "BaseArtifactFiles": ["originalTreecipeWrapper_123.json", "otherFile.json"]
            };
            const actualTreecipeObjectInfoWrapper = await CollectionsApiService.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);

            expect(actualTreecipeObjectInfoWrapper.propertyone).toBe('fakevalue'); 
        
        });

    });

    describe('updateReferenceIdMapWithCreatedRecords', () => {
        test('should update the map with created record IDs when reference IDs are not already present', () => {
            
            const objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {};
            
            const sObjectResults = [
                { id: '001ABC' },
                { id: '002DEF' },
            ];
    
            const orderedCollectionsApiRecordsDetailJustUpserted = [
                { attributes: { referenceId: 'ref1' } },
                { attributes: { referenceId: 'ref2' } },
            ];
    
            const result = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(
                objectReferenceIdToOrgCreatedRecordIdMap,
                sObjectResults,
                orderedCollectionsApiRecordsDetailJustUpserted
            );
    
            expect(result).toEqual({
                ref1: '001ABC',
                ref2: '002DEF',
            });

        });
    
        test('should not overwrite existing reference IDs in the map', () => {
           
            const objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {
                ref1: 'newlyCreatedId',
            };
            
            const collectionApiJsonToBeInserted = [
                { id: '001ABC' },
                { id: '002DEF' },
            ];
    
            const orderedCollectionsApiRecordsDetailJustUpserted = [
                // ref1 key already exists in objectReferenceIdToOrgCreatedRecordIdMap, so ref1 wont be overwritten with ID
                { attributes: { referenceId: 'ref1' } }, 
                { attributes: { referenceId: 'ref2' } },
            ];
    
            const result = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(
                objectReferenceIdToOrgCreatedRecordIdMap,
                collectionApiJsonToBeInserted,
                orderedCollectionsApiRecordsDetailJustUpserted
            );
    
            expect(result).toEqual({
                ref1: 'newlyCreatedId',
                ref2: '002DEF',
            });
        });
    
        test('should handle empty input arrays gracefully', () => {
            
            const objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {};
    
            const result = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(
                objectReferenceIdToOrgCreatedRecordIdMap,
                [],
                []
            );
    
            expect(result).toEqual({});

        });

    });


    describe('updateLookupReferencesInCollectionApiJson', () => {
    
        test('should replace reference IDs with corresponding record IDs', () => {

            const collectionsApiJson = '{"records":[{"Id":"ref1"},{"Id":"ref2"}]}';
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                ref1__sweetNickname: '001ABC',
                ref2: '002DEF',
            };

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe('{"records":[{"Id":"001ABC"},{"Id":"002DEF"}]}');

        });

        test('nickname or associated reference value will operate as reference id that will get assigned Id value', () => {

            const collectionsApiJson = '{"records":[{"Id":"ref1"},{"Id":"Nickname"}]}';
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                ref1__Nickname: '001ABC',
            };

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe('{"records":[{"Id":"001ABC"},{"Id":"001ABC"}]}');

        });

        test('should replace multiple occurrences of the same reference ID', () => {

            const collectionsApiJson = '{"records":[{"Id":"ref1"},{"Id":"ref1"}]}';
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                ref1: '001ABC',
            };

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe('{"records":[{"Id":"001ABC"},{"Id":"001ABC"}]}');

        });

        test('should not modify the JSON if no reference IDs match', () => {

            const collectionsApiJson = '{"records":[{"Id":"noMatch"}]}';
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                ref1: '001ABC',
            };

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe(collectionsApiJson);

        });

        test('should handle an empty JSON string gracefully', () => {

            const collectionsApiJson = '';
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                ref1: '001ABC',
            };

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe('');

        });

        test('should handle an empty reference map gracefully', () => {
            const collectionsApiJson = '{"records":[{"Id":"ref1"}]}';
            const objectReferenceIdToOrgCreatedRecordIdMap = {};

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(result).toBe(collectionsApiJson);

        });

    });

    describe('updateCollectionApiJsonContentWithOrgRecordTypeIds', () => {
        
        test('should replace record type identifiers with corresponding record type IDs', () => {
            const collectionsApiJson = '{"records":[{"RecordTypeId":"Account.Standard"},{"RecordTypeId":"Contact.Special"}]}';
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                    { SobjectType: 'Contact', DeveloperName: 'Special', Id: 'RTID002' },
                ],
            };

            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);

            expect(result).toBe('{"records":[{"RecordTypeId":"RTID001"},{"RecordTypeId":"RTID002"}]}');
        
        });

        test('should replace multiple occurrences of the same record type identifier', () => {
           
            const collectionsApiJson = '{"records":[{"RecordTypeId":"Account.Standard"},{"RecordTypeId":"Account.Standard"}]}';
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                ],
            };

            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);

            expect(result).toBe('{"records":[{"RecordTypeId":"RTID001"},{"RecordTypeId":"RTID001"}]}');
        
        });

        test('should replace multiple occurrences of the same record type identifier', () => {
            const collectionsApiJson = '{"records":[{"RecordTypeId":"Account.Standard"},{"RecordTypeId":"Account.Standard"}]}';
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                ],
            };
    
            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
    
            expect(result).toBe('{"records":[{"RecordTypeId":"RTID001"},{"RecordTypeId":"RTID001"}]}');
        });
    
        test('should not modify the JSON if no record type identifiers match', () => {
            const collectionsApiJson = '{"records":[{"RecordTypeId":"Unknown.Type"}]}';
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                ],
            };
    
            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
    
            expect(result).toBe(collectionsApiJson);
        });
    
        test('should handle an empty JSON string gracefully', () => {
            const collectionsApiJson = '';
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                ],
            };
    
            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
    
            expect(result).toBe('');
        });
    
        test('should handle an empty record type details object gracefully', () => {
            const collectionsApiJson = '{"records":[{"RecordTypeId":"Account.Standard"}]}';
            const recordTypeDetailFromTargetOrg = { records: [] };
    
            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
    
            expect(result).toBe(collectionsApiJson);
        });

    });
    
    describe('getDataSetChildDirectoriesNameToFilesMap', () => {
            
        test('should return correct mapping of directories to files', async () => {
          
            const datasetDirectoryName = 'testDataset';
            const baseArtifactsFolder = 'artifacts';
            const datasetCollectionsFolder = 'collections';
            
            // Mock configuration service
            jest.spyOn(ConfigurationService, 'getBaseArtifactsFolderName')
                .mockReturnValue(baseArtifactsFolder);
            jest.spyOn(ConfigurationService, 'getDatasetCollectionApiFilesFolderName')
                .mockReturnValue(datasetCollectionsFolder);
        
            // Mock the child directory function
            const expectedResult = {
                'artifacts': ['file1.json', 'file2.json'],
                'collections': ['file3.json', 'file4.json']
            };
            
            jest.spyOn(CollectionsApiService, 'getFilesFromChildDirectoriesBySharedParentDirectory')
                .mockResolvedValue(expectedResult);
        
            // Act
            const result = await CollectionsApiService.getDataSetChildDirectoriesNameToFilesMap(datasetDirectoryName);
        
            // Assert
            expect(result).toEqual(expectedResult);
            expect(ConfigurationService.getBaseArtifactsFolderName).toHaveBeenCalled();
            expect(ConfigurationService.getDatasetCollectionApiFilesFolderName).toHaveBeenCalled();
            expect(CollectionsApiService.getFilesFromChildDirectoriesBySharedParentDirectory)
                .toHaveBeenCalledWith(datasetDirectoryName, [baseArtifactsFolder, datasetCollectionsFolder]);
            
        });
    
        test('should handle empty directory names from configuration', async () => {
          
            const datasetDirectoryName = 'testDataset';
          
            jest.spyOn(ConfigurationService, 'getBaseArtifactsFolderName')
                .mockReturnValue('');
            jest.spyOn(ConfigurationService, 'getDatasetCollectionApiFilesFolderName')
                .mockReturnValue('');
        
            const expectedResult = { '': [] };
            jest.spyOn(CollectionsApiService, 'getFilesFromChildDirectoriesBySharedParentDirectory')
                .mockResolvedValue(expectedResult);
        
            const result = await CollectionsApiService.getDataSetChildDirectoriesNameToFilesMap(datasetDirectoryName);
        
            expect(result).toEqual(expectedResult);

        });

    });

    describe('getFilesFromChildDirectoriesBySharedParentDirectory', () => {

        test('should return correct files for each child directory', async () => {
            
            const parentDir = 'parent';
            const childDirs = ['dir1', 'dir2'];
            
            jest.spyOn(VSCodeWorkspaceService, 'getFilesInDirectory')
                .mockImplementation(async (path) => {
                    return ['file3.json', 'file4.json'];
            });
        
            const parentDirectoryToChildFiles = await CollectionsApiService.getFilesFromChildDirectoriesBySharedParentDirectory(
                parentDir, 
                childDirs
            );

            const directory1ChildFiles = parentDirectoryToChildFiles["dir1"];
            expect(directory1ChildFiles.length).toEqual(2);
         
        });
    
    });


    describe('makeCollectionsApiCall', () => {

        test('given mocked Connection instance and mocked insert funtcion and success results, should return expected sobject results list', async () => {   
            
            const mockSobjectInsertResults:any = MockCollectionsApiService.getMockCombinedSuccessAndFailureCollectionResults();
            const doesntMatterObjectNameToUpsert = 'Account';
            const mockedCollectionsApiDetail = MockCollectionsApiService.getFakeCollectionApiDetail();
            const mockedConnection = MockCollectionsApiService.getMockedSalesforceCoreConnection();

            jest.spyOn(CollectionsApiService, 'insertCollectionsApiCallout').mockReturnValue(Promise.resolve(mockSobjectInsertResults as any));
            const allOrNoneSelection = true;
            const actualMockedResults = await CollectionsApiService.makeCollectionsApiCall(
                mockedCollectionsApiDetail,
                mockedConnection,
                allOrNoneSelection,
                doesntMatterObjectNameToUpsert
            );
    
            expect(actualMockedResults).toEqual(mockSobjectInsertResults);
            
        });

    });

    describe('insertCollectionsApiCallout', () => {

        test('given mocked salesforce core insert call with expected mocked insert funtcion and success results, should return expected sobject results list', async () => {   
            
            const doesntMatterObjectNameToUpsert = 'Account';
            const mockedCollectionsApiDetail = MockCollectionsApiService.getFakeCollectionApiDetail();
            
            const mockSobjectInsertResults:any = MockCollectionsApiService.getMockCombinedSuccessAndFailureCollectionResults();
            const mockedConnection = MockCollectionsApiService.getMockedSalesforceCoreConnection();
    
            // Create mock implementation for chained connectoin funtions and apply the mock implementation to `sobject()`
            const implementation = () => ({
                insert: jest.fn().mockResolvedValue(
                    mockSobjectInsertResults 
                )
            } as any);   
            mockedConnection.sobject.mockImplementation(implementation);
            const mockedSobjectInsertChainedCommand = (mockedConnection.sobject('nomatter').insert as jest.Mock);
            mockedSobjectInsertChainedCommand.mockResolvedValue(mockSobjectInsertResults);
              
            const allOrNoneSelection = true;
            const mockedRecords = mockedCollectionsApiDetail.records;
            const result = await CollectionsApiService.insertCollectionsApiCallout(
                mockedRecords,
                mockedConnection,
                allOrNoneSelection,
                doesntMatterObjectNameToUpsert
            );
    
            expect(result).toEqual(mockSobjectInsertResults);
            
        });

    });

    describe('deletePreviouslySavedRecords', () => {

        test('given mocked Connection instance and mocked insert funtcion and success results, should return expected sobject results list', async () => {   
            
            const mockedConnection = MockCollectionsApiService.getMockedSalesforceCoreConnection();
            const mockedDeleteResult = [
                {
                    "id": "0015g00000Xy2LmAA",
                    "status": "SUCCESS",
                    "errors": []
                }
            ];
            const mockInsertAttemptResults = MockCollectionsApiService.getMockedInsertAttemptFileJsonContent();

            jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockReturnValue(Promise.resolve(mockInsertAttemptResults));

            const mockDeleteCallout = jest.spyOn(CollectionsApiService, 'deleteCollectionsApiCallout').mockReturnValue(Promise.resolve(mockedDeleteResult as any));
            const fakeFullPathToInsertAttemptResultsFile = 'fake/path';
            await CollectionsApiService.deletePreviouslySavedRecords(
                fakeFullPathToInsertAttemptResultsFile,
                mockedConnection
            );

            const expectedIdsToDeleteFromMockedSuccessResults = [
                '001DK000017d3k5YAA'
            ];
            expect(mockDeleteCallout).toHaveBeenCalled();
            expect(mockDeleteCallout).toHaveBeenCalledWith(
                expectedIdsToDeleteFromMockedSuccessResults,
                mockedConnection,
                'Account'
            );
            
        });

    });


    describe('createCollectionsApiFile', () => {

        test('should create a collections API file with the correct content', () => {
            
            const mockCollectionsApiFormattedRecords = [
                {
                    attributes: {
                        type: 'Account',
                        referenceId: 'Account_Reference_1'
                    },
                    name: 'Test Account'
                },
                {
                    attributes: {
                        type: 'Account',
                        referenceId: 'Account_Reference_2'
                    },
                    name: 'Test Account 2'
                },
            ];

            const expectedObjectName = 'Account';
            const mockUniqueTimeStampedFakeDataSetsFolderName = '/mock/workspace/treecipe/FakeDataSets/dataset-2024-11-25T16-24-15';

            jest.spyOn(fs, 'writeFile').mockReturnValue();
            
            CollectionsApiService.createCollectionsApiFile(
                expectedObjectName,
                mockCollectionsApiFormattedRecords,
                mockUniqueTimeStampedFakeDataSetsFolderName
            );

            const expectedFileName = `collectionsApi-${expectedObjectName}.json`;
            const expectedFullPathWithFileName = `${mockUniqueTimeStampedFakeDataSetsFolderName}/${expectedFileName}`;

            const jsonMockCollectionsApiFormattedRecords = JSON.stringify(mockCollectionsApiFormattedRecords, null, 2);
            expect(fs.writeFile).toHaveBeenCalledWith(
                expectedFullPathWithFileName,
                jsonMockCollectionsApiFormattedRecords,
                expect.any(Function)
            );

        });

    });

    describe('buildCollectionsApiFileNameBySobjectName', () => {

        test('should build the correct collections API file name based on the selected recipe file name', () => {
            
            const expectedObjectName = 'Account';
            const expectedFileName = `collectionsApi-${expectedObjectName}.json`;

            const actualBuiltFileName = CollectionsApiService.buildCollectionsApiFileNameBySobjectName(expectedObjectName);
            expect(actualBuiltFileName).toBe(expectedFileName);

        });
        
    });
    
});
