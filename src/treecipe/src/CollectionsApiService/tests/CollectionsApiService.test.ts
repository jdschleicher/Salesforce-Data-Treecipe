
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CollectionsApiService, INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER } from '../CollectionsApiService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { MockDirectoryService } from '../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService';
import { MockCollectionsApiService } from './mocks/MockCollectionsApiService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { RecordTypeService } from '../../RecordTypeService/RecordTypeService';

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
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        withProgress: jest.fn()
    },
    ProgressLocation: { Notification: 15 },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });


describe('Shared tests for CollectionsApiService', () => {

    describe('getConnectionFromAlias', () => {

        // THE INSERT PATH AND THE RECIPE COCKPIT'S DESCRIBE PATH RESOLVE AN ORG THROUGH ONE HELPER
        test('resolves the org through the shared SalesforceOrgService connection helper', async () => {

            const fakeConnection = { describe: jest.fn() };
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            expect(await CollectionsApiService.getConnectionFromAlias('devhub')).toBe(fakeConnection);
            expect(getConnectionSpy).toHaveBeenCalledWith('devhub');

        });

    });

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

        test('picks from the orgs the Salesforce CLI reports connected and returns the chosen org\'s detail, never a typed alias, saying production is refused', async () => {

            const promptSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue({ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' });

            expect(await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst()).toEqual({ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' });
            expect(promptSpy).toHaveBeenCalledWith(INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER);
            expect(INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER).toContain('production orgs are refused');
            expect(vscode.window.showInputBox).not.toHaveBeenCalled();

        });

        test('given the picker dismissed or no connected org, returns undefined', async () => {

            jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(undefined);

            expect(await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst()).toBeUndefined();

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

        test('given a datasetSource.json listed before the wrapper copy, still reads the wrapper copy', async() => {

            const fakeJsonTreecipeObjectInfoWrapper = MockCollectionsApiService.getFakeTreecipeObjectInfoWrapperJson();
            const getFileContentSpy = jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockReturnValue(Promise.resolve(fakeJsonTreecipeObjectInfoWrapper));

            const datasetChildFoldersToFilesMap = {
                "BaseArtifactFiles": [
                    "/dataset/BaseArtifactFiles/datasetSource.json",
                    "/dataset/BaseArtifactFiles/originalRecipe-recipe--Account-ONLY-2026-09-01T08-00-00.yml",
                    "/dataset/BaseArtifactFiles/originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-01T08-00-00.json"
                ]
            };
            await CollectionsApiService.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);

            expect(getFileContentSpy).toHaveBeenCalledTimes(1);
            expect(getFileContentSpy).toHaveBeenCalledWith("/dataset/BaseArtifactFiles/originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-01T08-00-00.json");

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

            const objectReferenceIdToOrgCreatedRecordIdMap = {
                Order__c_Reference_1__Order__c_NickName: '001ABC',
                Product__c_Reference_1__Product__c_NickName: '002DEF',
            };

            const collectionsApiJson = `
            {
                "allOrNone": true,
                "records": [
                {
                "attributes": {
                    "type": "Order_Item__c",
                    "referenceId": "Order_Item__c_Reference_1__Order_Item__c_NickName"
                },
                "Order__c": "Order__c_NickName",
                "Price__c": "632.01",
                "Product__c": "Product__c_NickName",
                "Qty_L__c": "13077\n",
                "Qty_M__c": "517818\n",
                "Qty_S__c": "294768\n"
                },
                {
                "attributes": {
                    "type": "Order_Item__c",
                    "referenceId": "Order_Item__c_Reference_2__Order_Item__c_NickName"
                },
                "Order__c": "Order__c_NickName",
                "Price__c": "454.34",
                "Product__c": "Product__c_NickName",
                "Qty_L__c": "363799\n",
                "Qty_M__c": "376137\n",
                "Qty_S__c": "407613\n"
                }
                ]
            }`;

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            const expectedCollectionsApiJson = `{
                "allOrNone": true,
                "records": [
                {
                "attributes": {
                    "type": "Order_Item__c",
                    "referenceId": "Order_Item__c_Reference_1__Order_Item__c_NickName"
                },
                "Order__c": "001ABC",
                "Price__c": "632.01",
                "Product__c": "002DEF",
                "Qty_L__c": "13077\n",
                "Qty_M__c": "517818\n",
                "Qty_S__c": "294768\n"
                },
                {
                "attributes": {
                    "type": "Order_Item__c",
                    "referenceId": "Order_Item__c_Reference_2__Order_Item__c_NickName"
                },
                "Order__c": "001ABC",
                "Price__c": "454.34",
                "Product__c": "002DEF",
                "Qty_L__c": "363799\n",
                "Qty_M__c": "376137\n",
                "Qty_S__c": "407613\n"
                }
                ]
            }`;
            expect(result.trim()).toBe(expectedCollectionsApiJson.trim());

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

        test('longer nickname replaced before shorter substring nickname to prevent corruption', () => {

            // "top_account" is a substring of "Account_top_account_1".
            // If the shorter nickname is replaced first it corrupts the longer one.
            // Sorting by length descending ensures the longer value is replaced first.
            const objectReferenceIdToOrgCreatedRecordIdMap = {
                'Account_Reference_1__top_account': '001PARENT',
                'Contact_Reference_1__Contact_top_account': '003CHILD',
            };

            const collectionsApiJson = JSON.stringify({
                allOrNone: true,
                records: [
                    {
                        attributes: { type: 'Contact', referenceId: 'Contact_Reference_1__Contact_top_account' },
                        AccountId: 'top_account',
                        ParentContactId: 'Contact_top_account'
                    }
                ]
            });

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(
                collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap
            );

            const parsed = JSON.parse(result);
            expect(parsed.records[0].AccountId).toBe('001PARENT');
            expect(parsed.records[0].ParentContactId).toBe('003CHILD');

        });

    });

    describe('updateLookupReferencesInCollectionApiJson with nested friends nicknames (#46)', () => {

        test('a friend whose nickname contains its parent nickname keeps its own referenceId, and only exact values are replaced', () => {

            const objectReferenceIdToOrgCreatedRecordIdMap = {
                'Account_Reference_1__Account_NickName': '001PARENT'
            };

            const collectionsApiJson = JSON.stringify({
                allOrNone: true,
                records: [
                    {
                        attributes: { type: 'Contact', referenceId: 'Contact_Reference_1__Contact_Account_NickName' },
                        AccountId: 'Account_NickName',
                        Description: 'met at Account_NickName offsite'
                    }
                ]
            }, null, 2);

            const parsed = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap));

            expect(parsed.records[0].attributes.referenceId).toBe('Contact_Reference_1__Contact_Account_NickName');
            expect(parsed.records[0].AccountId).toBe('001PARENT');
            expect(parsed.records[0].Description).toBe('met at Account_NickName offsite');

        });

        test('a key equal to a nickname is never replaced', () => {

            const objectReferenceIdToOrgCreatedRecordIdMap = { 'Account_Reference_1__Account_NickName': '001PARENT' };
            const collectionsApiJson = '{"records":[{"Account_NickName" : "Account_NickName"}]}';

            const result = CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);

            expect(JSON.parse(result)).toEqual({ records: [ { Account_NickName: '001PARENT' } ] });

        });

        test('a grandchild resolves its parent and its top parent once both were inserted', () => {

            const objectReferenceIdToOrgCreatedRecordIdMap = {
                'Account_Reference_1__Account_NickName_1': '001FIRST',
                'Account_Reference_2__Account_NickName_2': '001SECOND',
                'Other__c_Reference_1__Other__c_Account_NickName_1': 'a01FIRST',
                'Other__c_Reference_1__Other__c_Account_NickName_2': 'a01SECOND'
            };

            const collectionsApiJson = JSON.stringify({
                allOrNone: true,
                records: [
                    {
                        attributes: { type: 'OtherChildObject__c', referenceId: 'OtherChildObject__c_Reference_1__OtherChildObject__c_Other__c_Account_NickName_2' },
                        Other__c: 'Other__c_Account_NickName_2',
                        Account__c: 'Account_NickName_2'
                    }
                ]
            });

            const parsed = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap));

            expect(parsed.records[0]).toEqual({
                attributes: { type: 'OtherChildObject__c', referenceId: 'OtherChildObject__c_Reference_1__OtherChildObject__c_Other__c_Account_NickName_2' },
                Other__c: 'a01SECOND',
                Account__c: '001SECOND'
            });

        });

    });

    describe('updateCollectionApiJsonContentWithOrgRecordTypeIds', () => {

        function buildCollectionsApiJson(records: Array<Record<string, unknown> | null>): string {
            return JSON.stringify({ allOrNone: true, records }, null, 2);
        }

        function buildRecord(objectApiName: string, fields: Record<string, unknown>): Record<string, unknown> {
            return { attributes: { type: objectApiName, referenceId: `${objectApiName}_Reference_1__nickname` }, ...fields };
        }

        function resolveRecords(collectionsApiJson: string, recordTypeDetailFromTargetOrg: unknown, collectionsApiFileName?: string): Array<Record<string, unknown>> {
            return JSON.parse(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg, collectionsApiFileName)).records;
        }

        const businessRecordTypesReturnedShortestFirst = {
            records: [
                { SobjectType: 'Account', DeveloperName: 'Business', Id: '012BUSINESS' },
                { SobjectType: 'Account', DeveloperName: 'Business_Customer', Id: '012BUSINESSCUSTOMER' },
            ],
        };

        beforeEach(() => {
            (vscode.window.showWarningMessage as jest.Mock).mockClear();
        });

        test('replaces each record\'s RecordTypeId with the org Id of its own object\'s record type', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Standard' }),
                buildRecord('Contact', { RecordTypeId: 'Contact.Special' }),
            ]);
            const recordTypeDetailFromTargetOrg = {
                records: [
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                    { SobjectType: 'Contact', DeveloperName: 'Special', Id: 'RTID002' },
                ],
            };

            expect(resolveRecords(collectionsApiJson, recordTypeDetailFromTargetOrg).map(record => record.RecordTypeId)).toEqual(['RTID001', 'RTID002']);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('replaces every record that names the same record type', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Standard' }),
                buildRecord('Account', { RecordTypeId: 'Account.Standard' }),
            ]);
            const recordTypeDetailFromTargetOrg = { records: [ { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' } ] };

            expect(resolveRecords(collectionsApiJson, recordTypeDetailFromTargetOrg).map(record => record.RecordTypeId)).toEqual(['RTID001', 'RTID001']);

        });

        test('gives a developer name that extends another its own Id, even when the shorter one is returned first', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Business_Customer' }),
                buildRecord('Account', { RecordTypeId: 'Account.Business' }),
            ]);

            expect(resolveRecords(collectionsApiJson, businessRecordTypesReturnedShortestFirst).map(record => record.RecordTypeId)).toEqual(['012BUSINESSCUSTOMER', '012BUSINESS']);

        });

        test('leaves any other field whose value contains a record type identifier unchanged', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', {
                    RecordTypeId: 'Account.Business',
                    Description: 'Migrated from Account.Business last year',
                    Name: 'Account.Business',
                }),
            ]);

            const [ resolvedRecord ] = resolveRecords(collectionsApiJson, businessRecordTypesReturnedShortestFirst);

            expect(resolvedRecord).toEqual({
                attributes: { type: 'Account', referenceId: 'Account_Reference_1__nickname' },
                RecordTypeId: '012BUSINESS',
                Description: 'Migrated from Account.Business last year',
                Name: 'Account.Business',
            });

        });

        test('does not resolve a record type of another object, because matching is per object', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Contact.Special' }),
            ]);
            const recordTypeDetailFromTargetOrg = { records: [ { SobjectType: 'Contact', DeveloperName: 'Special', Id: 'RTID002' } ] };

            const result = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg, 'Account.json');

            expect(result).toBe(collectionsApiJson);
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain('Account: "Contact.Special"');

        });

        test('leaves an unmatched RecordTypeId as it is, and warns once per file naming each object and its unmatched developer names', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Missing_One' }),
                buildRecord('Account', { RecordTypeId: 'Account.Missing_One' }),
                buildRecord('Account', { RecordTypeId: 'Account.Missing_Two' }),
                buildRecord('Account', { RecordTypeId: 'Account.Business' }),
                buildRecord('Contact', { RecordTypeId: 'Contact.Missing_Three' }),
            ]);

            const resolvedRecordTypeIds = resolveRecords(collectionsApiJson, businessRecordTypesReturnedShortestFirst, 'Account.json').map(record => record.RecordTypeId);

            expect(resolvedRecordTypeIds).toEqual(['Account.Missing_One', 'Account.Missing_One', 'Account.Missing_Two', '012BUSINESS', 'Contact.Missing_Three']);
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            const warning: string = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];
            expect(warning).toContain('in Account.json');
            expect(warning).toContain('Account: "Missing_One", "Missing_Two"');
            expect(warning).toContain('Contact: "Missing_Three"');

        });

        test('escapes an unmatched developer name in the warning, so it cannot form a notification link', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.[run](command:workbench.action.terminal.sendSequence)' }),
            ]);

            CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst);

            const warning: string = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];
            expect(warning).not.toMatch(/[[\]()]/);

        });

        test('lists at most the maximum number of unmatched developer names per object and counts the rest', () => {

            const maximumNames = CollectionsApiService.maximumUnmatchedRecordTypeNamesInWarning;
            const collectionsApiJson = buildCollectionsApiJson(
                Array.from({ length: maximumNames + 3 }, (_, index) => buildRecord('Account', { RecordTypeId: `Account.Missing_${index}` }))
            );

            CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst);

            const warning: string = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0];
            expect(warning).toContain(`"Missing_${maximumNames - 1}" and 3 more`);
            expect(warning).not.toContain(`"Missing_${maximumNames}"`);

        });

        test('passes a RecordTypeId that is not an object-qualified name, such as an Id, through without a warning', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: '012000000000001AAA' }),
            ]);

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst)).toBe(collectionsApiJson);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('passes records with no RecordTypeId through unchanged', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { Name: 'Account.Business' }),
            ]);

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst)).toBe(collectionsApiJson);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('passes a record with no object type, or a RecordTypeId that is not text, through unchanged', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                null,
                { RecordTypeId: 'Account.Business' },
                buildRecord('Account', { RecordTypeId: null }),
            ]);

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst)).toBe(collectionsApiJson);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('passes JSON with no records array through unchanged', () => {

            const collectionsApiJson = '{"allOrNone":true}';

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, businessRecordTypesReturnedShortestFirst)).toBe(collectionsApiJson);

        });

        test('should handle an empty JSON string gracefully', () => {

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds('', businessRecordTypesReturnedShortestFirst)).toBe('');

        });

        test('should handle an empty record type details object gracefully', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Standard' }),
            ]);

            expect(CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, { records: [] })).toBe(collectionsApiJson);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain('Account: "Standard"');

        });

        test('is applied by processAndInsertCollectionFile to the file it inserts, naming that file in the warning', async () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Business_Customer', Description: 'Account.Business' }),
                buildRecord('Account', { RecordTypeId: 'Account.Missing' }),
            ]);
            jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockResolvedValue(collectionsApiJson);
            const makeCollectionsApiCallSpy = jest.spyOn(CollectionsApiService, 'makeCollectionsApiCall').mockResolvedValue([
                { success: true, id: '001A' },
                { success: false, errors: [] },
            ]);
            jest.spyOn(CollectionsApiService, 'appendInsertAttemptsFileWithLatestSobjectResults').mockImplementation(() => undefined);

            await CollectionsApiService.processAndInsertCollectionFile('/dataset/collectionsApi-Account.json',
                                                                        businessRecordTypesReturnedShortestFirst,
                                                                        {},
                                                                        { instanceUrl: 'https://example.my.salesforce.com' },
                                                                        false,
                                                                        { SuccessResults: {}, FailureResults: {} },
                                                                        '/dataset/results.json',
                                                                        undefined);

            const [ sentRecords ] = makeCollectionsApiCallSpy.mock.calls[0];
            expect(sentRecords.records.map((record: Record<string, unknown>) => [record.RecordTypeId, record.Description])).toEqual([
                ['012BUSINESSCUSTOMER', 'Account.Business'],
                ['Account.Missing', undefined],
            ]);
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain('in collectionsApi-Account.json');

        });

        test('ignores org record type rows that are missing a name or an Id', () => {

            const collectionsApiJson = buildCollectionsApiJson([
                buildRecord('Account', { RecordTypeId: 'Account.Standard' }),
            ]);
            const recordTypeDetailFromTargetOrg = {
                records: [
                    null,
                    { SobjectType: 'Account', DeveloperName: 'Standard' },
                    { SobjectType: 'Account', DeveloperName: 'Standard', Id: 'RTID001' },
                ],
            };

            expect(resolveRecords(collectionsApiJson, recordTypeDetailFromTargetOrg).map(record => record.RecordTypeId)).toEqual(['RTID001']);

        });

    });
    
    describe('a record referencing another record in the same file is inserted after it (#188)', () => {

        const accountRecord = (referenceIndex: number, nickname: string, fields: Record<string, unknown> = {}) => ({
            attributes: { type: 'Account', referenceId: `Account_Reference_${referenceIndex}__${nickname}` },
            Name: `Account ${nickname} ${referenceIndex}`,
            ...fields
        });

        const recordNames = (insertRounds: any[][]) => insertRounds.map(insertRound => insertRound.map(record => record.Name));

        test('a file with no same-file reference is one round, in its own order', () => {

            const records = [accountRecord(1, 'Account_NickName'), accountRecord(2, 'Account_NickName', { ParentId: 'Other_NickName' })];

            expect(CollectionsApiService.partitionRecordsIntoInsertRounds(records)).toEqual([records]);

        });

        test('child iterations wait for the parents they name, and each parent iteration may be named', () => {

            const records = [
                accountRecord(1, 'Account_NickName_1'),
                accountRecord(1, 'Account_Account_NickName_1', { ParentId: 'Account_NickName_1' }),
                accountRecord(2, 'Account_NickName_2'),
                accountRecord(1, 'Account_Account_NickName_2', { ParentId: 'Account_NickName_2' })
            ];

            expect(recordNames(CollectionsApiService.partitionRecordsIntoInsertRounds(records))).toEqual([
                ['Account Account_NickName_1 1', 'Account Account_NickName_2 2'],
                ['Account Account_Account_NickName_1 1', 'Account Account_Account_NickName_2 1']
            ]);

        });

        test('a chain takes one round per link, and a reference to a record\'s own nickname is not a wait', () => {

            const records = [
                accountRecord(1, 'Grandchild', { ParentId: 'Child' }),
                accountRecord(1, 'Child', { ParentId: 'Top' }),
                accountRecord(1, 'Top', { ParentId: 'Top' })
            ];

            expect(recordNames(CollectionsApiService.partitionRecordsIntoInsertRounds(records))).toEqual([
                ['Account Top 1'], ['Account Child 1'], ['Account Grandchild 1']
            ]);

        });

        test('records that can never be met (a cycle) go in one last round, as the whole file used to', () => {

            const records = [
                accountRecord(1, 'Top'),
                accountRecord(1, 'Left', { ParentId: 'Right' }),
                accountRecord(1, 'Right', { ParentId: 'Left' })
            ];

            expect(recordNames(CollectionsApiService.partitionRecordsIntoInsertRounds(records))).toEqual([
                ['Account Top 1'], ['Account Left 1', 'Account Right 1']
            ]);

        });

        test('many records sharing one nickname partition in linear time, as one round', () => {

            // snowfakery GIVES EVERY RECORD OF AN OBJECT ONE NICKNAME; COPYING THE HOLDER LIST PER RECORD TOOK 19 s AT 50,000
            const records = Array.from({ length: 50000 }, (_unused, recordIndex) => accountRecord(recordIndex + 1, 'Account_NickName', { OwnerId: 'User_NickName' }));

            const startedAt = Date.now();
            const insertRounds = CollectionsApiService.partitionRecordsIntoInsertRounds(records);

            expect(Date.now() - startedAt).toBeLessThan(2000);
            expect(insertRounds).toEqual([records]);

        });

        test('records with no records array, no reference id or no fields are passed through', () => {

            expect(CollectionsApiService.partitionRecordsIntoInsertRounds(undefined)).toEqual([undefined]);
            expect(CollectionsApiService.partitionRecordsIntoInsertRounds([])).toEqual([[]]);
            expect(CollectionsApiService.partitionRecordsIntoInsertRounds([null, { Name: 'x' }, { attributes: {}, Name: 'y' }])).toEqual([[null, { Name: 'x' }, { attributes: {}, Name: 'y' }]]);

        });

        test('processAndInsertCollectionFile inserts each round and resolves a later round\'s lookups to the Ids the earlier rounds created', async () => {

            const collectionsApiJson = JSON.stringify({
                allOrNone: true,
                records: [
                    accountRecord(1, 'Account_NickName_1'),
                    accountRecord(1, 'Account_Account_NickName_1', { ParentId: 'Account_NickName_1', Other__c: 'Other_NickName' }),
                    accountRecord(2, 'Account_NickName_2'),
                    accountRecord(1, 'Account_Account_NickName_2', { ParentId: 'Account_NickName_2' })
                ]
            });
            jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockResolvedValue(collectionsApiJson);
            jest.spyOn(CollectionsApiService, 'appendInsertAttemptsFileWithLatestSobjectResults').mockImplementation(() => undefined);
            const makeCollectionsApiCallSpy = jest.spyOn(CollectionsApiService, 'makeCollectionsApiCall')
                .mockResolvedValueOnce([{ success: true, id: '001PARENT1' }, { success: true, id: '001PARENT2' }])
                .mockResolvedValueOnce([{ success: true, id: '001CHILD1' }, { success: true, id: '001CHILD2' }]);
            const referenceIdToOrgId: Record<string, string> = { 'Other__c_Reference_1__Other_NickName': 'a00OTHER' };

            const isInserted = await CollectionsApiService.processAndInsertCollectionFile('/dataset/collectionsApi-Account.json',
                                                                                            { records: [] },
                                                                                            referenceIdToOrgId,
                                                                                            { instanceUrl: 'https://example.my.salesforce.com' },
                                                                                            true,
                                                                                            { SuccessResults: {}, FailureResults: {} },
                                                                                            '/dataset/results.json',
                                                                                            undefined);

            expect(isInserted).toBe(true);
            expect(makeCollectionsApiCallSpy).toHaveBeenCalledTimes(2);
            const [ firstRound, secondRound ] = makeCollectionsApiCallSpy.mock.calls.map(call => call[0].records);
            expect(firstRound.map((record: any) => record.attributes.referenceId)).toEqual(['Account_Reference_1__Account_NickName_1', 'Account_Reference_2__Account_NickName_2']);
            expect(secondRound.map((record: any) => [record.ParentId, record.Other__c])).toEqual([['001PARENT1', 'a00OTHER'], ['001PARENT2', undefined]]);
            expect(makeCollectionsApiCallSpy.mock.calls[1][0].allOrNone).toBe(true);
            expect(referenceIdToOrgId['Account_Reference_1__Account_Account_NickName_2']).toBe('001CHILD2');

        });

        test('an all-or-none failure in a round deletes what was saved and inserts no later round', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockResolvedValue(JSON.stringify({
                allOrNone: true,
                records: [accountRecord(1, 'Top'), accountRecord(1, 'Child', { ParentId: 'Top' })]
            }));
            jest.spyOn(CollectionsApiService, 'appendInsertAttemptsFileWithLatestSobjectResults').mockImplementation(() => undefined);
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);
            const makeCollectionsApiCallSpy = jest.spyOn(CollectionsApiService, 'makeCollectionsApiCall').mockResolvedValue([{ success: false, errors: [] }]);

            const isInserted = await CollectionsApiService.processAndInsertCollectionFile('/dataset/collectionsApi-Account.json',
                                                                                            { records: [] },
                                                                                            {},
                                                                                            { instanceUrl: 'https://example.my.salesforce.com' },
                                                                                            true,
                                                                                            { SuccessResults: {}, FailureResults: {} },
                                                                                            '/dataset/results.json',
                                                                                            undefined);

            expect(isInserted).toBe(false);
            expect(makeCollectionsApiCallSpy).toHaveBeenCalledTimes(1);
            expect(deleteSpy).toHaveBeenCalledTimes(1);

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

            jest.spyOn(fs, 'writeFileSync').mockReturnValue();
            
            CollectionsApiService.createCollectionsApiFile(
                expectedObjectName,
                mockCollectionsApiFormattedRecords,
                mockUniqueTimeStampedFakeDataSetsFolderName
            );

            const expectedFileName = `collectionsApi-${expectedObjectName}.json`;
            const expectedFullPathWithFileName = `${mockUniqueTimeStampedFakeDataSetsFolderName}/${expectedFileName}`;

            const jsonMockCollectionsApiFormattedRecords = JSON.stringify(mockCollectionsApiFormattedRecords, null, 2);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expectedFullPathWithFileName,
                jsonMockCollectionsApiFormattedRecords
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

describe('the one data set insert, shared by Insert Data Set by Directory and the Recipe Cockpit (#255)', () => {

    let datasetFolderPath: string;
    let isCancelled: boolean;
    let progressReport: jest.Mock;

    const record = (objectApiName: string, referenceIndex: number, nickname: string, fields: Record<string, unknown> = {}) => ({
        attributes: { type: objectApiName, referenceId: `${objectApiName}_Reference_${referenceIndex}__${nickname}` },
        Name: `${objectApiName} ${nickname} ${referenceIndex}`,
        ...fields
    });

    // A DATA SET FOLDER AS RUN FAKER WRITES IT: THE WRAPPER COPY IN BaseArtifactFiles, ONE COLLECTIONS API FILE PER OBJECT
    const writeDataSetFolder = (recordsByObject: Record<string, unknown[]>, levelsByObject: Record<string, number>) => {
        fs.mkdirSync(path.join(datasetFolderPath, 'BaseArtifactFiles'), { recursive: true });
        fs.mkdirSync(path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi'), { recursive: true });
        fs.writeFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'originalTreecipeWrapper-2026-10-07T12-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: Object.fromEntries(Object.entries(levelsByObject).map(([objectApiName, level]) => [objectApiName, { RelationshipDetail: { level: level } }]))
        }));
        Object.entries(recordsByObject).forEach(([objectApiName, records]) => {
            fs.writeFileSync(path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi', `collectionsApi-${objectApiName}.json`), JSON.stringify({ allOrNone: true, records: records }));
        });
    };

    // EACH INSERT ANSWERS SUCCESS PER RECORD WITH AN Id NAMED BY ITS OBJECT AND ORDER, UNLESS A TEST SAYS OTHERWISE
    const buildConnection = (insertAnswer?: (objectApiName: string, records: any[]) => unknown) => {
        const insertedBatches: Array<{ objectApiName: string; records: any[]; options: unknown }> = [];
        const deleteMock = jest.fn().mockResolvedValue([]);
        const connection = {
            instanceUrl: 'https://qa.my.salesforce.com',
            insertedBatches,
            deleteMock,
            sobject: jest.fn().mockImplementation((objectApiName: string) => ({
                insert: jest.fn().mockImplementation(async (records: any[], options: unknown) => {
                    insertedBatches.push({ objectApiName, records, options });
                    return insertAnswer
                        ? insertAnswer(objectApiName, records)
                        : records.map((_record, recordIndex) => ({ id: `${objectApiName}-${insertedBatches.length}-${recordIndex}`, success: true, errors: [] }));
                }),
                delete: deleteMock
            }))
        };
        return connection;
    };

    beforeEach(() => {
        datasetFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-dataset-insert-'));
        isCancelled = false;
        progressReport = jest.fn();
        jest.spyOn(VSCodeWorkspaceService, 'getNowIsoDateTimestamp').mockReturnValue('2026-10-07T12-00-00');
        jest.spyOn(VSCodeWorkspaceService, 'getFileContentByPath').mockImplementation(async (filePath: string) => fs.readFileSync(filePath, 'utf8'));
        (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, task: Function) => task(
            { report: progressReport },
            { get isCancellationRequested() { return isCancelled; }, onCancellationRequested: jest.fn() }
        ));
        (vscode.window.showWarningMessage as jest.Mock).mockClear();
        (vscode.window.showInformationMessage as jest.Mock).mockClear();
    });

    afterEach(() => {
        fs.rmSync(datasetFolderPath, { recursive: true, force: true });
    });

    describe('insertDataSetFolderIntoOrg', () => {

        test('maps the folder, reads the org\'s record type Ids for every object of the wrapper, and inserts with the options it was given', async () => {

            writeDataSetFolder({ Account: [record('Account', 1, 'Account_NickName')] }, { Account: 0, Contact: 1 });
            const connection = buildConnection();
            const recordTypeDetail = { records: [{ Id: '012000000000001AAA', DeveloperName: 'Business', SobjectType: 'Account' }] };
            const recordTypeSpy = jest.spyOn(RecordTypeService, 'getRecordTypeIdsByConnection').mockResolvedValue(recordTypeDetail);
            const insertResult = { outcome: 'completed' as const, isRolledBack: false, resultsFilePath: '/results.json', savedRecordCount: 1, failedRecordCount: 0 };
            const upsertSpy = jest.spyOn(CollectionsApiService, 'upsertDataSetToSelectedOrg').mockResolvedValue(insertResult);
            const prepareRecords = jest.fn((_objectApiName: string, records: unknown[]) => records);

            const answered = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection as any, false, { prepareRecords });

            expect(answered).toBe(insertResult);
            expect(recordTypeSpy).toHaveBeenCalledWith(connection, ['Account', 'Contact']);
            expect(upsertSpy).toHaveBeenCalledTimes(1);
            const [folderPath, childFoldersToFiles, passedRecordTypeDetail, passedConnection, allOrNone, insertOptions] = upsertSpy.mock.calls[0];
            expect(folderPath).toBe(datasetFolderPath);
            expect(childFoldersToFiles).toEqual({
                BaseArtifactFiles: [path.join(datasetFolderPath, 'BaseArtifactFiles', 'originalTreecipeWrapper-2026-10-07T12-00-00.json')],
                DatasetFilesForCollectionsApi: [path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi', 'collectionsApi-Account.json')]
            });
            expect(passedRecordTypeDetail).toBe(recordTypeDetail);
            expect(passedConnection).toBe(connection);
            expect(allOrNone).toBe(false);
            expect(insertOptions).toEqual({ prepareRecords });

        });

        test('defaults to no options, and inserts end to end parents first', async () => {

            writeDataSetFolder({
                Contact: [record('Contact', 1, 'Contact_NickName', { AccountId: 'Account_NickName' })],
                Account: [record('Account', 1, 'Account_NickName')]
            }, { Contact: 1, Account: 0 });
            const connection = buildConnection();
            jest.spyOn(RecordTypeService, 'getRecordTypeIdsByConnection').mockResolvedValue({ records: [] });

            const insertResult = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection as any, true);

            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.objectApiName)).toEqual(['Account', 'Contact']);
            expect(connection.insertedBatches[1].records[0].AccountId).toBe('Account-1-0');
            expect(insertResult).toMatchObject({ outcome: 'completed', savedRecordCount: 2, failedRecordCount: 0 });

        });

    });

    describe('upsertDataSetToSelectedOrg', () => {

        const insertFolder = async (connection: ReturnType<typeof buildConnection>, allOrNone: boolean, prepareRecords?: any) => CollectionsApiService.upsertDataSetToSelectedOrg(
            datasetFolderPath,
            await CollectionsApiService.getDataSetChildDirectoriesNameToFilesMap(datasetFolderPath),
            { records: [] },
            connection as any,
            allOrNone,
            prepareRecords ? { prepareRecords } : undefined
        );

        test('answers completed with what was saved and the results file it wrote', async () => {

            writeDataSetFolder({
                Account: [record('Account', 1, 'Account_NickName'), record('Account', 2, 'Account_NickName_2')],
                Contact: [record('Contact', 1, 'Contact_NickName', { AccountId: 'Account_NickName' })]
            }, { Account: 0, Contact: 1 });
            const connection = buildConnection();

            const insertResult = await insertFolder(connection, true);

            expect(insertResult).toEqual({
                outcome: 'completed',
                isRolledBack: false,
                resultsFilePath: path.join(datasetFolderPath, 'InsertAttempts', 'insertAttempt-2026-10-07T12-00-00', 'insertAttemptResults-2026-10-07T12-00-00.json'),
                savedRecordCount: 3,
                failedRecordCount: 0
            });
            expect(fs.existsSync(insertResult.resultsFilePath)).toBe(true);
            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.options)).toEqual([{ allowRecursive: false, allOrNone: true }, { allowRecursive: false, allOrNone: true }]);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('All files processed.');
            expect(progressReport).toHaveBeenCalledWith({ message: 'Processing file 1 of 2: collectionsApi-Account.json', increment: 50 });
            expect(progressReport).toHaveBeenCalledWith({ message: 'Inserting Contact: round 1 of 1' });

        });

        test('hands each file\'s records to prepareRecords with every Id this insert created so far', async () => {

            writeDataSetFolder({
                Account: [record('Account', 1, 'Account_NickName')],
                Contact: [record('Contact', 1, 'Contact_NickName', { AccountId: 'Account_NickName', OwnerId: '### TODO' })]
            }, { Account: 0, Contact: 1 });
            const connection = buildConnection();
            const createdIdsSeen: Array<Record<string, string>> = [];
            const prepareRecords = jest.fn((objectApiName: string, records: any[], createdRecordIdsByReferenceId: Readonly<Record<string, string>>) => {
                createdIdsSeen.push({ ...createdRecordIdsByReferenceId });
                return objectApiName === 'Contact' ? records.map(contact => { const { OwnerId, ...kept } = contact; return { ...kept, OwnerId: '005000000000001AAA' }; }) : records;
            });

            await insertFolder(connection, false, prepareRecords);

            expect(prepareRecords.mock.calls.map(call => call[0])).toEqual(['Account', 'Contact']);
            expect(createdIdsSeen).toEqual([{}, { 'Account_Reference_1__Account_NickName': 'Account-1-0' }]);
            // THE LOOKUP TO AN EARLIER FILE IS ALREADY AN Id WHEN prepareRecords SEES IT
            expect(prepareRecords.mock.calls[1][1][0].AccountId).toBe('Account-1-0');
            expect(connection.insertedBatches[1].records[0].OwnerId).toBe('005000000000001AAA');

        });

        test('a cancel rolls back what was saved through deletePreviouslySavedRecords and answers cancelled', async () => {

            writeDataSetFolder({ Account: [record('Account', 1, 'Account_NickName')], Contact: [record('Contact', 1, 'Contact_NickName')] }, { Account: 0, Contact: 1 });
            const connection = buildConnection((objectApiName, records) => {
                isCancelled = true;
                return records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] }));
            });
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, false);

            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.objectApiName)).toEqual(['Account']);
            expect(deleteSpy).toHaveBeenCalledWith(insertResult.resultsFilePath, connection);
            expect(insertResult).toMatchObject({ outcome: 'cancelled', savedRecordCount: 0, failedRecordCount: 0 });
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Import cancelled by user. Deleting any previously saved records...');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

        });

        test('a cancel before anything was saved deletes nothing, since there is no results file', async () => {

            writeDataSetFolder({ Account: [record('Account', 1, 'Account_NickName')] }, { Account: 0 });
            isCancelled = true;
            const connection = buildConnection();
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, false);

            expect(connection.insertedBatches).toEqual([]);
            expect(deleteSpy).not.toHaveBeenCalled();
            expect(insertResult.outcome).toBe('cancelled');

        });

        test('a cancel between two rounds of one file rolls back too', async () => {

            writeDataSetFolder({ Account: [record('Account', 1, 'Top'), record('Account', 1, 'Child', { ParentId: 'Top' })] }, { Account: 0 });
            const connection = buildConnection((objectApiName, records) => {
                isCancelled = true;
                return records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] }));
            });
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, false);

            expect(connection.insertedBatches).toHaveLength(1);
            expect(deleteSpy).toHaveBeenCalledTimes(1);
            expect(insertResult.outcome).toBe('cancelled');

        });

        test('an all-or-none failure stops at that file, rolled back, and answers stopped with what failed', async () => {

            writeDataSetFolder({
                Account: [record('Account', 1, 'Account_NickName')],
                Contact: [record('Contact', 1, 'Contact_NickName')],
                Opportunity: [record('Opportunity', 1, 'Opportunity_NickName')]
            }, { Account: 0, Contact: 1, Opportunity: 2 });
            const connection = buildConnection((objectApiName, records) => objectApiName === 'Contact'
                ? records.map(() => ({ success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'LastName' }] }))
                : records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] })));
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, true);

            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.objectApiName)).toEqual(['Account', 'Contact']);
            expect(deleteSpy).toHaveBeenCalledTimes(1);
            expect(insertResult).toMatchObject({ outcome: 'stopped', savedRecordCount: 0, failedRecordCount: 1 });
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Failed to process collectionsApi-Contact.json');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

        });

        const throwOnContact = () => buildConnection((objectApiName, records) => {
            if ( objectApiName === 'Contact' ) {
                throw new Error('INVALID_SESSION_ID: Session expired');
            }
            return records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] }));
        });
        const writeThreeFiles = () => writeDataSetFolder({
            Account: [record('Account', 1, 'Account_NickName')],
            Contact: [record('Contact', 1, 'Contact_NickName')],
            Opportunity: [record('Opportunity', 1, 'Opportunity_NickName')]
        }, { Account: 0, Contact: 1, Opportunity: 2 });

        test('a request that throws under all-or-none stops there, rolls back what was saved, and never answers completed (#259 review)', async () => {

            writeThreeFiles();
            const connection = throwOnContact();
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, true);

            // THE CONTACT REQUEST WAS SENT AND THREW; NOTHING AFTER IT IS SENT
            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.objectApiName)).toEqual(['Account', 'Contact']);
            expect(deleteSpy).toHaveBeenCalledTimes(1);
            expect(insertResult).toMatchObject({ outcome: 'stopped', isRolledBack: true, savedRecordCount: 0 });
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)[0]).toContain('Failed to process collectionsApi-Contact.json: ');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

        });

        test('a request that throws without all-or-none stops there and keeps what was saved, saying so', async () => {

            writeThreeFiles();
            const connection = throwOnContact();
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, false);

            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.objectApiName)).toEqual(['Account', 'Contact']);
            expect(deleteSpy).not.toHaveBeenCalled();
            expect(insertResult).toMatchObject({ outcome: 'stopped', isRolledBack: false, savedRecordCount: 1 });

        });

        test('an all-or-none failure seen together with a cancel is rolled back once, not twice', async () => {

            writeThreeFiles();
            const connection = buildConnection((objectApiName, records) => {
                if ( objectApiName === 'Contact' ) {
                    isCancelled = true;
                    return records.map(() => ({ success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'LastName' }] }));
                }
                return records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] }));
            });
            const deleteSpy = jest.spyOn(CollectionsApiService, 'deletePreviouslySavedRecords').mockResolvedValue(undefined);

            const insertResult = await insertFolder(connection, true);

            expect(deleteSpy).toHaveBeenCalledTimes(1);
            expect(insertResult).toMatchObject({ outcome: 'stopped', isRolledBack: true });
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalledWith('Import cancelled by user. Deleting any previously saved records...');

        });

        test('without all-or-none, keeps going past a rejected record and counts it', async () => {

            writeDataSetFolder({ Account: [record('Account', 1, 'Account_NickName'), record('Account', 2, 'Account_NickName')] }, { Account: 0 });
            const connection = buildConnection(() => [{ id: '001A', success: true, errors: [] }, { success: false, errors: [{ message: 'bad' }] }]);

            const insertResult = await insertFolder(connection, false);

            expect(insertResult).toMatchObject({ outcome: 'completed', savedRecordCount: 1, failedRecordCount: 1 });

        });

    });

    describe('processAndInsertCollectionFile', () => {

        const insertFile = async (records: unknown[], connection: ReturnType<typeof buildConnection>, prepareRecords?: any, createdIds: Record<string, string> = {}) => {
            writeDataSetFolder({ Account: records }, { Account: 0 });
            fs.mkdirSync(path.join(datasetFolderPath, 'InsertAttempts'), { recursive: true });
            return CollectionsApiService.processAndInsertCollectionFile(
                path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi', 'collectionsApi-Account.json'),
                { records: [] },
                createdIds,
                connection,
                false,
                { SuccessResults: {}, FailureResults: {} },
                path.join(datasetFolderPath, 'InsertAttempts', 'results.json'),
                { get isCancellationRequested() { return isCancelled; } } as any,
                { report: progressReport },
                prepareRecords
            );
        };

        test('reports each round through the progress it was handed', async () => {

            const connection = buildConnection();

            const isInserted = await insertFile([record('Account', 1, 'Top'), record('Account', 1, 'Child', { ParentId: 'Top' })], connection);

            expect(isInserted).toBe(true);
            expect(progressReport.mock.calls.map(call => call[0])).toEqual([
                { message: 'Inserting Account: round 1 of 2' },
                { message: 'Inserting Account: round 2 of 2' }
            ]);
            expect(connection.insertedBatches[1].records[0].ParentId).toBe('Account-1-0');

        });

        test('applies prepareRecords, with the created-Ids map, before the records are split into rounds', async () => {

            const connection = buildConnection();
            const createdIds = { 'Contact_Reference_1__Contact_NickName': '003000000000001AAA' };
            // THE PREPARER WIRES A SAME-FILE LOOKUP THE FILE DID NOT HAVE, SO THE FILE NEEDS TWO ROUNDS
            const prepareRecords = jest.fn((_objectApiName: string, records: any[], _createdRecordIdsByReferenceId: Readonly<Record<string, string>>) => [records[0], { ...records[1], ParentId: 'Top' }]);

            await insertFile([record('Account', 1, 'Top'), record('Account', 1, 'Child')], connection, prepareRecords, createdIds);

            expect(prepareRecords).toHaveBeenCalledTimes(1);
            expect(prepareRecords.mock.calls[0][0]).toBe('Account');
            expect(prepareRecords.mock.calls[0][2]).toBe(createdIds);
            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.records.map((insertedRecord: any) => insertedRecord.Name))).toEqual([['Account Top 1'], ['Account Child 1']]);
            expect(progressReport).toHaveBeenCalledWith({ message: 'Inserting Account: round 2 of 2' });

        });

        test('answers false, sending no further request, when the token is cancelled between rounds', async () => {

            const connection = buildConnection((objectApiName, records) => {
                isCancelled = true;
                return records.map((_record, recordIndex) => ({ id: `${objectApiName}-${recordIndex}`, success: true, errors: [] }));
            });

            const isInserted = await insertFile([record('Account', 1, 'Top'), record('Account', 1, 'Child', { ParentId: 'Top' })], connection);

            expect(isInserted).toBe(false);
            expect(connection.insertedBatches).toHaveLength(1);
            expect(progressReport).toHaveBeenCalledTimes(1);

        });

        test('sends a 300-record file in 200-record requests', async () => {

            const connection = buildConnection();
            const records = Array.from({ length: 300 }, (_unused, recordIndex) => record('Account', recordIndex + 1, 'Account_NickName'));

            const isInserted = await insertFile(records, connection);

            expect(isInserted).toBe(true);
            expect(connection.insertedBatches.map(insertedBatch => insertedBatch.records.length)).toEqual([200, 100]);
            expect(CollectionsApiService.collectionsApiRecordBatchSizeLimit).toBe(200);
            expect(progressReport).toHaveBeenCalledWith({ message: 'Inserting Account: round 1 of 1' });

        });

    });

});
