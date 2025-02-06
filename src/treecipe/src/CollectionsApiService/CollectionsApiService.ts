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

    static getExpectedSalesforceOrgToInsertAgainst() {

        const userPromptForInputMessage = 'What Salesforce alias will the data set be inserted against? -- DO NOT USE PRODUCTION ORG';
        const salesforceOrgToInsertAgainst = VSCodeWorkspaceService.promptForUserInput(userPromptForInputMessage);
        return salesforceOrgToInsertAgainst;

    }

     static async promptForAllOrNoneInsertDecision(): Promise<boolean | undefined> {
            
        let items: vscode.QuickPickItem[] = [
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

        const allOrNoneSelection = await vscode.window.showQuickPick(
            items,
            {
                placeHolder: 'Select AllOrNone preference:',
                ignoreFocusOut: true
            }
        );

        if (!allOrNoneSelection) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return undefined; 
        } else {
            return allOrNoneSelection.detail as unknown as boolean;
        }

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
        const collectionApiFiles = datasetChildFoldersToFilesMap[collectionsApiFilesDirectoryFolderName];

        const insertAttemptsDirectoryName = 'InsertAttempts';
        const pathToInsertAttemptsDirectory = path.join(selectedDataSetFullDirectoryPath, insertAttemptsDirectoryName);
        if (!fs.existsSync(pathToInsertAttemptsDirectory)) {
            fs.mkdirSync(pathToInsertAttemptsDirectory);
        }

        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();                                
        const timestampedInsertAttemptDirectoryFullPath = `${pathToInsertAttemptsDirectory}/insertAttempt-${isoDateTimestamp}`;
        fs.mkdirSync(timestampedInsertAttemptDirectoryFullPath);

        let allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>> = {
            'SuccessResults' : {},
            'FailureResults' : {}
        };
        let objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {};

        for ( const collectionsApiFilePath of collectionApiFiles ) {

            let collectionsApiJson = await VSCodeWorkspaceService.getFileContentByPath(collectionsApiFilePath);
            collectionsApiJson = this.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg);
            collectionsApiJson = this.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);
            const preparedCollectionsApiDetail = JSON.parse(collectionsApiJson);

            const objectNameForFile = this.getObjectNameFromCollectionsApiFilePath(collectionsApiFilePath);
            const collectionsApiSobjectResult = await this.makeCollectionsApiCall(preparedCollectionsApiDetail, 
                                                                            aliasAuthenticationConnection,
                                                                            allOrNoneSelection,
                                                                            objectNameForFile);

                
            allCollectionApiFilesSobjectResults = this.updateCompleteCollectionApiSobjectResults(allCollectionApiFilesSobjectResults, collectionsApiSobjectResult, objectNameForFile);
            objectReferenceIdToOrgCreatedRecordIdMap = this.updateReferenceIdMapWithCreatedRecords(objectReferenceIdToOrgCreatedRecordIdMap, collectionsApiSobjectResult, preparedCollectionsApiDetail.records);
       
        }

        const resultsFileName = `insertAttemptResults-${isoDateTimestamp}.json`;
        const fullPathToResultsFile = path.join(timestampedInsertAttemptDirectoryFullPath, resultsFileName);
        
        const allCollectionApiFilesSobjectResultsJson = JSON.stringify(allCollectionApiFilesSobjectResults, null, 2);
        fs.writeFile(fullPathToResultsFile, allCollectionApiFilesSobjectResultsJson, (err) => {
            if (err) {
                throw new Error('an error occurred when creating results file.');
            }
        });

    }

    static updateCompleteCollectionApiSobjectResults(allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>>, sObjectResults, sobjectApiName ) {

        for ( let i = 0; i < sObjectResults.length; i++) {

            const recordResult = sObjectResults[i];
            if ( recordResult.success ) {

                const currentSuccessResultsMap = allCollectionApiFilesSobjectResults["SuccessResults"];
                allCollectionApiFilesSobjectResults["SuccessResults"] = this.addItemToRecordMap(currentSuccessResultsMap, sobjectApiName, recordResult);   

            } else {

                const currentFailureResultsMap = allCollectionApiFilesSobjectResults["FailureResults"];
                allCollectionApiFilesSobjectResults["FailureResults"] = this.addItemToRecordMap(currentFailureResultsMap, sobjectApiName, recordResult);   

            }

        }

        return allCollectionApiFilesSobjectResults;
        
    }

    // Function to add an item to the list corresponding to a key
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
                                        sobjectNameToUpsert ) {

        const sobjectsResult = new Array<any>();
        const recordsToUpsert = preparedCollectionsApiDetail.records;

        if (recordsToUpsert && recordsToUpsert.length > 0) {

            const recordsToInsert: any[] = new Array<any>();
            const recordsToUpdate: any[] = new Array<any>();

            for (const record of recordsToUpsert) {
                if (record.Id) {
                // There is an Id, so it's an update
                    recordsToUpdate.push(record);
                } else {
                // No Id, insert record
                    recordsToInsert.push(record);
                }
            }

            const batchSize = 200;

            // UPDATING RECORDS
            if (recordsToUpdate.length > 0) {
    
                for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
                // @ts-ignore: Don't know why, but TypeScript doesn't use the correct method override
                    
                    const recordsBatchToUpdate = recordsToUpdate.slice(i, i + batchSize);
                    const chunkResults = await aliasAuthenticationConnection
                        .sobject(sobjectNameToUpsert) // @ts-ignore: TODO: working code, but look at TS warning
                        .update(recordsBatchToUpdate, { 
                                    allowRecursive: true, 
                                    allOrNone: allOrNoneSelection 
                                })
                        .catch((err) => {
                            throw new SfError(`Error importing records: ${err}`);
                            });

                    sobjectsResult.push(...chunkResults);

                }

            }
    
            // INSERTING RECORDS
            if (recordsToInsert.length > 0) {
             
                for (let i = 0; i < recordsToInsert.length; i += batchSize) {

                    const recordsBatchToInsert = recordsToInsert.slice(i, i + batchSize);

                    const chunkResults = await aliasAuthenticationConnection
                        .sobject(sobjectNameToUpsert) 
                        .insert(recordsBatchToInsert, { 
                                allowRecursive: true, 
                                allOrNone: allOrNoneSelection 
                            })
                        .catch((err) => {
                            throw new SfError(`Error importing records: ${err}`);
                        });

                    sobjectsResult.push(...chunkResults);

                }

            }
            
        }

        return sobjectsResult;

    }



    static getObjectNameFromCollectionsApiFilePath(filePath: string): string | null {
        
        const matchObjectNameInFilePathRegex = /collectionsApi-(.*?)\.json$/;
        
        const expectedObjectNameMatch = filePath.match(matchObjectNameInFilePathRegex);
        
        if (expectedObjectNameMatch) {
            return expectedObjectNameMatch[1]; // This will be the captured object name (Example_Everything__c)
        } else {
            return null; // If the pattern doesn't match, return null
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
            const files = await this.getFilesInDirectory(fullPath);
            filesByDirectory[childFolderName] = files;

        }
    
        return filesByDirectory;
        
    }

    static async getFilesInDirectory(directoryToGetFilesFrom: string): Promise<string[]> {

        const entries = await fs.promises.readdir(directoryToGetFilesFrom, { withFileTypes: true });
       
        const filesFromDirectory: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(directoryToGetFilesFrom, entry.name);
            if (entry.isFile()) {
                filesFromDirectory.push(fullPath);
            }
        }

        return filesFromDirectory;

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

        for (const [referenceIdKey, referenceIdAssociatedRecordIdValue ] of  Object.entries(objectReferenceIdToOrgCreatedRecordIdMap)) {

            collectionsApiJson = collectionsApiJson.replaceAll(referenceIdKey, referenceIdAssociatedRecordIdValue);
        
        }

        return collectionsApiJson;

    }

}