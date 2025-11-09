import { Connection, Org, SfError } from "@salesforce/core";
import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";

import * as vscode from 'vscode';
import * as fs from 'fs';
import path = require('path');

export class CollectionsApiService {

    static async promptForDataSetObjectsPathVSCodeQuickItems(): Promise<vscode.QuickPickItem> | undefined {

        const expectedFakeDataSetsPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const generatedFakeDataSetsPath = `${workspaceRoot}/${expectedFakeDataSetsPath}`;

        let fakeDataSetDirectoryVSCodeQuickPickItems: vscode.QuickPickItem[] = [];

        while (true) {
            
            fakeDataSetDirectoryVSCodeQuickPickItems = await VSCodeWorkspaceService.getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(generatedFakeDataSetsPath, fakeDataSetDirectoryVSCodeQuickPickItems);

            const selection = await vscode.window.showQuickPick(
                fakeDataSetDirectoryVSCodeQuickPickItems,
                {
                    placeHolder: 'Select Data Set directory that contains the expected CollectionsApi JSON files',
                    ignoreFocusOut: true
                }
            );

            if (!selection) {
                // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
                return undefined; 
            } else {
                return selection;
            }

        }
    
    }

    static async getExpectedSalesforceOrgToInsertAgainst() {

        const userPromptForInputMessage = 'What Salesforce alias will the data set be inserted against? -- DO NOT USE PRODUCTION ORG';
        const salesforceOrgToInsertAgainst = await VSCodeWorkspaceService.promptForUserInput(userPromptForInputMessage);
        return salesforceOrgToInsertAgainst;

    }

    static async promptForAllOrNoneInsertDecision(): Promise<boolean | undefined> {
            
        let allOrNoneItems = this.getAllOrNoneQuickPickItemSelections();
        
        const allOrNoneSelection = await vscode.window.showQuickPick(
            allOrNoneItems,
            {
                placeHolder: 'Select AllOrNone preference:',
                ignoreFocusOut: true
            }
        );

        if (!allOrNoneSelection) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return undefined; 
        } else {
            const booleanConvertedAllOrNone:boolean = (allOrNoneSelection.detail.toLowerCase() === "true"); 
            return booleanConvertedAllOrNone;
        }

    }

    static getAllOrNoneQuickPickItemSelections() {

        const allOrNoneItems: vscode.QuickPickItem[] = [
            {
                label: 'AllOrNone: TRUE',
                description: 'If true, any insert failure will reset any successful inserts previously made',
                iconPath: new vscode.ThemeIcon('getting-started-item-checked'),
                detail: 'true'
            },
            {
                label: 'AllOrNone: FALSE',
                description: 'If false, all Collection Api calls will be processed and any inserts will be kept',
                iconPath: new vscode.ThemeIcon('getting-started-item-unchecked'),
                detail: 'false'
            }
        ];

        return allOrNoneItems;

    }

    static async getConnectionFromAlias(orgAlias: string) {

        const localOrgDetail = await Org.create({ aliasOrUsername: orgAlias });
        const connection = localOrgDetail.getConnection();
        
        return connection;
    }

    static async upsertDataSetToSelectedOrg(selectedDataSetFullDirectoryPath: string,
                                            datasetChildFoldersToFilesMap: Record<string, string[]>, 
                                            recordTypeDetailFromTargetOrg: any,
                                            aliasAuthenticationConnection: Connection,
                                            allOrNoneSelection: boolean) {

        const collectionsApiFilesDirectoryFolderName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
        let collectionApiFiles = datasetChildFoldersToFilesMap[collectionsApiFilesDirectoryFolderName];

        // Get the treecipe wrapper to access relationship levels
        const treecipeObjectWrapperDetail = await this.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);
        
        // Sort collection API files based on relationship levels from the wrapper
        collectionApiFiles = this.sortCollectionApiFilesByRelationshipLevel(collectionApiFiles, treecipeObjectWrapperDetail);

        const insertAttemptsDirectoryName = 'InsertAttempts';
        const pathToInsertAttemptsDirectory = path.join(selectedDataSetFullDirectoryPath, insertAttemptsDirectoryName);
        if (!fs.existsSync(pathToInsertAttemptsDirectory)) {
            fs.mkdirSync(pathToInsertAttemptsDirectory);
        }

        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();                                
        const timestampedInsertAttemptDirectoryFullPath = `${pathToInsertAttemptsDirectory}/insertAttempt-${isoDateTimestamp}`;
        fs.mkdirSync(timestampedInsertAttemptDirectoryFullPath);

        // File and directory prep for capturing Collection Api call results
        const resultsFileName = `insertAttemptResults-${isoDateTimestamp}.json`;
        const fullPathToResultsFile = path.join(timestampedInsertAttemptDirectoryFullPath, resultsFileName);

        let allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>> = {
            'SuccessResults' : {},
            'FailureResults' : {}
        };
        let objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {};

        await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Inserting Salesforce Collection API files...",
              cancellable: true
            },
            
            async (progress, token) => {

              const totalFiles = collectionApiFiles.length;
          
              for (let i = 0; i < totalFiles; i++) {

                if (token.isCancellationRequested) {
                  vscode.window.showWarningMessage("Import cancelled by user. Deleting any previously saved records...");
                  await this.deletePreviouslySavedRecords(fullPathToResultsFile, aliasAuthenticationConnection);
                  return;
                }
          
                const collectionsApiFilePath = collectionApiFiles[i];
          
                // Optional: just the filename (not full path)
                const fileName = path.basename(collectionsApiFilePath);
          
                progress.report({
                    message: `Processing file ${i + 1} of ${totalFiles}: ${fileName}`,
                    increment: (100 / totalFiles)
                });
          
                try {

                    const successResult = await this.processAndInsertCollectionFile(collectionsApiFilePath, 
                                                            recordTypeDetailFromTargetOrg,
                                                            objectReferenceIdToOrgCreatedRecordIdMap,
                                                            aliasAuthenticationConnection,
                                                            allOrNoneSelection,
                                                            allCollectionApiFilesSobjectResults,
                                                            fullPathToResultsFile,
                                                            token);

                    if (!successResult) {
                        vscode.window.showWarningMessage(`Failed to process ${fileName}`);
                        break;                    
                    }

                } catch (error) {

                    vscode.window.showWarningMessage(`Failed to process ${fileName}`);

                }

              }
          
              vscode.window.showInformationMessage("All files processed.");

            }
        );

    }

    static async processAndInsertCollectionFile(collectionsApiFilePath,
                                                recordTypeDetailFromTargetOrg,
                                                objectReferenceIdToOrgCreatedRecordIdMap,
                                                aliasAuthenticationConnection,
                                                allOrNoneSelection,
                                                allCollectionApiFilesSobjectResults,
                                                fullPathToResultsFile,
                                                token: vscode.CancellationToken): Promise<boolean> {
    
            let collectionsApiJson = await VSCodeWorkspaceService.getFileContentByPath(collectionsApiFilePath);
            collectionsApiJson = this.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
            collectionsApiJson = this.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);
            const preparedCollectionsApiDetail = JSON.parse(collectionsApiJson);

            const objectNameForFile = this.getObjectNameFromCollectionsApiFilePath(collectionsApiFilePath);
            const collectionsApiSobjectResult = await this.makeCollectionsApiCall(preparedCollectionsApiDetail, 
                                                                            aliasAuthenticationConnection,
                                                                            allOrNoneSelection,
                                                                            objectNameForFile);
                
            allCollectionApiFilesSobjectResults = this.updateCompleteCollectionApiSobjectResults(allCollectionApiFilesSobjectResults, 
                                                                                                    collectionsApiSobjectResult, 
                                                                                                    objectNameForFile, 
                                                                                                    aliasAuthenticationConnection);

            this.appendInsertAttemptsFileWithLatestSobjectResults(allCollectionApiFilesSobjectResults, fullPathToResultsFile);

            // IF ALLORNONE ARGUMENT SET TO --TRUE-- AND ANY OBJECT KEYS ARE FOUND IN FAILURE RESULTS, DELETE PREVIOUS SAVED RECORDS
            if ( allOrNoneSelection && Object.keys(allCollectionApiFilesSobjectResults.FailureResults).length > 0 ) {
                await this.deletePreviouslySavedRecords(fullPathToResultsFile, aliasAuthenticationConnection);
                return false;
            }

            objectReferenceIdToOrgCreatedRecordIdMap = this.updateReferenceIdMapWithCreatedRecords(objectReferenceIdToOrgCreatedRecordIdMap, collectionsApiSobjectResult, preparedCollectionsApiDetail.records);
            return true;

    
    }

    static updateCompleteCollectionApiSobjectResults(allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>>, 
                                                        sObjectResults, 
                                                        sobjectApiName,
                                                        aliasAuthenticationConnection: Connection, ) {

        for ( let i = 0; i < sObjectResults.length; i++) {

            const recordResult = sObjectResults[i];
            if ( recordResult.success ) {

                const currentSuccessResultsMap = allCollectionApiFilesSobjectResults["SuccessResults"];
                recordResult.orgRecordLink = `${aliasAuthenticationConnection.instanceUrl}/${recordResult.id}`;
                allCollectionApiFilesSobjectResults["SuccessResults"] = this.addItemToRecordMap(currentSuccessResultsMap, sobjectApiName, recordResult);   

            } else {

                const currentFailureResultsMap = allCollectionApiFilesSobjectResults["FailureResults"];
                allCollectionApiFilesSobjectResults["FailureResults"] = this.addItemToRecordMap(currentFailureResultsMap, sobjectApiName, recordResult);   

            }

        }

        return allCollectionApiFilesSobjectResults;
        
    }

    static appendInsertAttemptsFileWithLatestSobjectResults(allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>>, fullPathToResultsFile: string) {
       
        const allCollectionApiFilesSobjectResultsJson = JSON.stringify(allCollectionApiFilesSobjectResults, null, 2);
        fs.writeFileSync(fullPathToResultsFile, allCollectionApiFilesSobjectResultsJson);
        
    }

    static async deletePreviouslySavedRecords(fullPathToInsertAttemptResultsFile:string, aliasAuthenticationConnection: Connection) {

        const previousSaveResultsJson = await VSCodeWorkspaceService.getFileContentByPath(fullPathToInsertAttemptResultsFile);

        const saveResultsDetail:Record<string, Record<string, any[]>> = JSON.parse(previousSaveResultsJson);

        const objectToSuccessfulRecordCreationResults = saveResultsDetail["SuccessResults"];

        const collectionsApiRecordBatchSizeLimitPerRestCall = 200;

        // may do something with the batched delete results in the future; just collecting results at the moment
        const deleteSobjectsResults = new Array<any>();

        for (const [objectKey, successfulSavesForObject ] of  Object.entries(objectToSuccessfulRecordCreationResults)) {

            for (let i = 0; i < successfulSavesForObject.length; i += collectionsApiRecordBatchSizeLimitPerRestCall) {
                
                const recordsBatchToUpdate = successfulSavesForObject.slice(i, i + collectionsApiRecordBatchSizeLimitPerRestCall);
                const recordIdsToDelete:string[] = recordsBatchToUpdate.map((savedRecordInBatch) => savedRecordInBatch.id);

                const chunkResults = await this.deleteCollectionsApiCallout(
                    recordIdsToDelete,
                    aliasAuthenticationConnection,
                    objectKey
                );
            
                deleteSobjectsResults.push(...chunkResults);

            }

        }

    }

    static async deleteCollectionsApiCallout(recordIdsToDelete: string[],
                                                aliasAuthenticationConnection: Connection,
                                                sobjectApiNameOfRecordIdsToDelete) {

        const deleteChunkResults = await aliasAuthenticationConnection
                                    .sobject(sobjectApiNameOfRecordIdsToDelete) 
                                    .delete(recordIdsToDelete)
                                    .catch((err) => {
                                        throw new SfError(`Error deleting records for ${sobjectApiNameOfRecordIdsToDelete}: ${err}`);
                                    });

        return deleteChunkResults;

    }

    static addItemToRecordMap(recordMap: Record<string, any[]>, key: string, item: any) {
       
        if (key in recordMap) {
            recordMap[key].push(item);
        } else {
            recordMap[key] = [item];
        }

        return recordMap;

    }

    static updateReferenceIdMapWithCreatedRecords(objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string>, sObjectResults, orderedCollectionsApiRecordsDetailJustUpserted ) {

        for ( let i = 0; i < sObjectResults.length; i++) {

            const referenceName = orderedCollectionsApiRecordsDetailJustUpserted[i].attributes.referenceId;
            const recordId = sObjectResults[i].id;

            if ( !(referenceName in objectReferenceIdToOrgCreatedRecordIdMap) ) {
                objectReferenceIdToOrgCreatedRecordIdMap[referenceName] = recordId;
            }
        
        }

        return objectReferenceIdToOrgCreatedRecordIdMap;

    }

    static async makeCollectionsApiCall(preparedCollectionsApiDetail: any,
                                        aliasAuthenticationConnection: Connection,
                                        allOrNoneSelection: boolean,
                                        sobjectNameToUpsert) {

        const sobjectsResult = new Array<any>();
        const recordsToInsert = preparedCollectionsApiDetail.records;

        if (recordsToInsert && recordsToInsert.length > 0) {

            const collectionsApiRecordBatchSizeLimitPerRestCall = 200;

            // INSERTING RECORDS
            if (recordsToInsert.length > 0) {
             
                for (let i = 0; i < recordsToInsert.length; i += collectionsApiRecordBatchSizeLimitPerRestCall) {

                    const recordsBatchToInsert = recordsToInsert.slice(i, i + collectionsApiRecordBatchSizeLimitPerRestCall);

                    const chunkResults = await this.insertCollectionsApiCallout(
                        recordsBatchToInsert,
                        aliasAuthenticationConnection,
                        allOrNoneSelection,
                        sobjectNameToUpsert
                    );

                    sobjectsResult.push(...chunkResults);

                }

            }
            
        }

        return sobjectsResult;

    }

    static async insertCollectionsApiCallout(recordsBatchToInsert: any,
                                                aliasAuthenticationConnection: Connection,
                                                allOrNoneSelection: boolean,
                                                sobjectNameToInsert) {

        const insertCollectionsApiResults = await aliasAuthenticationConnection
                                                    .sobject(sobjectNameToInsert) 
                                                    .insert(recordsBatchToInsert, { 
                                                        allowRecursive: false, 
                                                        allOrNone: allOrNoneSelection 
                                                    })
                                                    .catch((err) => {
                                                        throw new SfError(`Error importing records: ${err}`);
                                                    });

        return insertCollectionsApiResults;

    }

    static getObjectNameFromCollectionsApiFilePath(filePath: string): string | null {
        // expected filename pattern should be "collectionsApi-Example_Object__c.json"
        const matchObjectNameInFilePathRegex = /collectionsApi-(.*?)\.json$/;
        
        const expectedObjectNameMatch = filePath.match(matchObjectNameInFilePathRegex);
        
        if (expectedObjectNameMatch) {
            return expectedObjectNameMatch[1]; 
        } else {
            return null; 
        }

    }

    static async getDataSetChildDirectoriesNameToFilesMap(datasetDirectoryName: string): Promise<Record<string, string[]>> {

        const baseArtficactFilesDirectoryName = ConfigurationService.getBaseArtifactsFolderName();
        const datasetCollectionsApiFilesDirectoryName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
        const childFoldersToRetrieveFilesFrom = [baseArtficactFilesDirectoryName, datasetCollectionsApiFilesDirectoryName];

        const childFolderToFilesMap = await this.getFilesFromChildDirectoriesBySharedParentDirectory(datasetDirectoryName, childFoldersToRetrieveFilesFrom);
        
        return childFolderToFilesMap;

    }

    static async getFilesFromChildDirectoriesBySharedParentDirectory(datasetParentDirectory: string, datasetChildDirectoriesToGetFilesFrom: string[]): Promise<Record<string, string[]>> {

        const filesByDirectory: Record<string, string[]> = {};
        for ( const childFolderName of datasetChildDirectoriesToGetFilesFrom ) {

            const fullPath = `${datasetParentDirectory}/${childFolderName}`;
            const files = await VSCodeWorkspaceService.getFilesInDirectory(fullPath);
            filesByDirectory[childFolderName] = files;

        }
    
        return filesByDirectory;
        
    }

    static async getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap: Record<string, string[]>) {
        
        const expectedObjectsInfoWrapperNamePrefix = 'originalTreecipeWrapper';
        const baseArtifactFilesDirectory = ConfigurationService.getBaseArtifactsFolderName();

        const originalTreecipeWrapperFilePath = datasetChildFoldersToFilesMap[baseArtifactFilesDirectory].filter(
            fileName => fileName.includes(expectedObjectsInfoWrapperNamePrefix)
        );

        const treecipeObjectInfoWrapperJson = await VSCodeWorkspaceService.getFileContentByPath(originalTreecipeWrapperFilePath[0]);
        const treecipeObjectInfoWrapperDetail = JSON.parse(treecipeObjectInfoWrapperJson);

        return treecipeObjectInfoWrapperDetail;

    }

    static updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson: string, recordTypeDetailFromTargetOrg: any): any {
    
        for ( const recordTypeInfo of recordTypeDetailFromTargetOrg.records ) {

            const objectName = recordTypeInfo.SobjectType;
            const recordTypeDeveloperName = recordTypeInfo.DeveloperName;
            const recordTypeIdForOrg = recordTypeInfo.Id;

            const recordTypeIdentifierToReplace = `${objectName}.${recordTypeDeveloperName}`;
            collectionsApiJson = collectionsApiJson.replaceAll(recordTypeIdentifierToReplace, recordTypeIdForOrg);

        }

        return collectionsApiJson;
    
    }

    static updateLookupReferencesInCollectionApiJson(collectionsApiJson: string, objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string>) {

        const jsonReferenceMap = JSON.stringify(objectReferenceIdToOrgCreatedRecordIdMap);
        const referenceRegexMatch = /(Reference_\d+__)/; // can be a match of "Reference_1_" to "Reference_1000000000__"
        for (const [referenceIdKey, referenceIdAssociatedRecordIdValue ] of  Object.entries(objectReferenceIdToOrgCreatedRecordIdMap)) {

            const splitReferenceIdentifiers = referenceIdKey.split(referenceRegexMatch).filter(Boolean);

            const nicknameLookupReferenceMatchIndex = 2;
  
            // Not every object and associated could have a "nickname" property so the reference key would not include the double underscore split
            const nicknameValue = splitReferenceIdentifiers[nicknameLookupReferenceMatchIndex];
            if ( nicknameValue ) {
                collectionsApiJson = collectionsApiJson.replaceAll(nicknameValue, `${referenceIdAssociatedRecordIdValue}`);
            }

        }

        return collectionsApiJson;

    }

    static createCollectionsApiFile(objectApiName: string, collectionsApiFormattedRecords: any, uniqueTimeStampedFakeDataSetsFolderName: string ) {

        const expectedCollectionsApiOutputFile = this.buildCollectionsApiFileNameBySobjectName(objectApiName);
        const fullCollectionsApiFilePath = `${uniqueTimeStampedFakeDataSetsFolderName}/${expectedCollectionsApiOutputFile}`;

        const jsonStringFormattedRecords = JSON.stringify(collectionsApiFormattedRecords, null, 2);

        fs.writeFile(fullCollectionsApiFilePath, jsonStringFormattedRecords, error => {
            
            if (error) {
                throw new Error(`Error occurred in Collections Api file creation: ${error.message}`);
            } 

        });

    }

    static buildCollectionsApiFileNameBySobjectName(sobjectApiName: string):string {

        const collectionsApiFileName = `collectionsApi-${sobjectApiName}.json`;
        return collectionsApiFileName;

    }

    /**
     * Sort Collection API files based on relationship levels from the treecipe wrapper
     * Objects are sorted by their level property (0 = top-level parents, higher = deeper children)
     * This ensures parent records are inserted before child records
     */
    static sortCollectionApiFilesByRelationshipLevel(
        collectionApiFiles: string[], 
        treecipeObjectWrapperDetail: any
    ): string[] {
        
        const objectToObjectInfoMap = treecipeObjectWrapperDetail.ObjectToObjectInfoMap;
        
        // Sort files based on relationship level (lower levels first)
        return collectionApiFiles.sort((fileA, fileB) => {
            const objectA = this.getObjectNameFromCollectionsApiFilePath(fileA);
            const objectB = this.getObjectNameFromCollectionsApiFilePath(fileB);
            
            if (!objectA || !objectB) {
                return 0;
            }
            
            // Get the level from RelationshipDetail, default to 999 if not found
            const levelA = objectToObjectInfoMap[objectA]?.RelationshipDetail?.level ?? 999;
            const levelB = objectToObjectInfoMap[objectB]?.RelationshipDetail?.level ?? 999;
            
            return levelA - levelB;
        });
    }

}
