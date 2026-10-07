import { Connection, SfError } from "@salesforce/core";
import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { SalesforceOrgService } from "../SalesforceOrgService/SalesforceOrgService";
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

        return await SalesforceOrgService.getConnection(orgAlias);

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
            collectionsApiJson = this.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg, path.basename(collectionsApiFilePath));
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

    static readonly maximumUnmatchedRecordTypeNamesInWarning = 20;

    /*
        Only a record's own RecordTypeId is resolved, and only when it EQUALS "<its object>.<DeveloperName>"
        for a record type the org returned for that object. A text replace over the whole JSON rewrote
        "Account.Business_Customer" with Business's Id whenever Business came back first, and rewrote any
        other field value that happened to contain the text (#167).
    */
    static updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson: string,
                                                                recordTypeDetailFromTargetOrg: unknown,
                                                                collectionsApiFileName?: string): string {

        const orgRecordTypeIdByObjectQualifiedName = this.buildOrgRecordTypeIdByObjectQualifiedName(recordTypeDetailFromTargetOrg);

        let collectionsApiDetail: unknown;
        try {
            collectionsApiDetail = JSON.parse(collectionsApiJson);
        } catch {
            return collectionsApiJson;
        }

        const records = (collectionsApiDetail as { records?: unknown } | null)?.records;
        if ( !Array.isArray(records) ) {
            return collectionsApiJson;
        }

        const unmatchedDeveloperNamesByObject: Map<string, Set<string>> = new Map();
        let isAnyRecordTypeIdResolved = false;

        for ( const recordCandidate of records ) {

            if ( recordCandidate === null || typeof recordCandidate !== 'object' || !Object.prototype.hasOwnProperty.call(recordCandidate, 'RecordTypeId') ) {
                continue;
            }

            const record = recordCandidate as { RecordTypeId: unknown; attributes?: { type?: unknown } };

            const recordTypeId = record.RecordTypeId;
            const objectApiName = record.attributes?.type;
            if ( typeof recordTypeId !== 'string' || typeof objectApiName !== 'string' ) {
                continue;
            }

            // a value with no dot is not "<object>.<DeveloperName>", such as an Id typed into the recipe
            if ( !recordTypeId.includes('.') ) {
                continue;
            }

            const objectQualifiedPrefix = `${objectApiName}.`;
            const orgRecordTypeId = recordTypeId.startsWith(objectQualifiedPrefix)
                ? orgRecordTypeIdByObjectQualifiedName.get(recordTypeId)
                : undefined;
            if ( orgRecordTypeId !== undefined ) {
                record.RecordTypeId = orgRecordTypeId;
                isAnyRecordTypeIdResolved = true;
                continue;
            }

            if ( !unmatchedDeveloperNamesByObject.has(objectApiName) ) {
                unmatchedDeveloperNamesByObject.set(objectApiName, new Set());
            }
            const unmatchedName = recordTypeId.startsWith(objectQualifiedPrefix)
                ? recordTypeId.slice(objectQualifiedPrefix.length)
                : recordTypeId;
            unmatchedDeveloperNamesByObject.get(objectApiName).add(unmatchedName);

        }

        this.warnOfUnmatchedRecordTypeDeveloperNames(unmatchedDeveloperNamesByObject, collectionsApiFileName);

        return isAnyRecordTypeIdResolved
            ? JSON.stringify(collectionsApiDetail, null, 2)
            : collectionsApiJson;

    }

    static buildOrgRecordTypeIdByObjectQualifiedName(recordTypeDetailFromTargetOrg: unknown): Map<string, string> {

        const orgRecordTypeIdByObjectQualifiedName: Map<string, string> = new Map();
        const orgRecordTypeRows = (recordTypeDetailFromTargetOrg as { records?: unknown } | null)?.records;
        const orgRecordTypes: Array<{ SobjectType?: unknown; DeveloperName?: unknown; Id?: unknown } | null> = Array.isArray(orgRecordTypeRows) ? orgRecordTypeRows : [];

        for ( const recordTypeInfo of orgRecordTypes ) {

            const objectName = recordTypeInfo?.SobjectType;
            const recordTypeDeveloperName = recordTypeInfo?.DeveloperName;
            const recordTypeIdForOrg = recordTypeInfo?.Id;
            if ( typeof objectName !== 'string' || typeof recordTypeDeveloperName !== 'string' || typeof recordTypeIdForOrg !== 'string' ) {
                continue;
            }

            orgRecordTypeIdByObjectQualifiedName.set(`${objectName}.${recordTypeDeveloperName}`, recordTypeIdForOrg);

        }

        return orgRecordTypeIdByObjectQualifiedName;

    }

    static warnOfUnmatchedRecordTypeDeveloperNames(unmatchedDeveloperNamesByObject: Map<string, Set<string>>, collectionsApiFileName?: string): void {

        if ( unmatchedDeveloperNamesByObject.size === 0 ) {
            return;
        }

        const maximumNames = this.maximumUnmatchedRecordTypeNamesInWarning;
        const unmatchedDescriptions = [...unmatchedDeveloperNamesByObject.entries()].map(([objectApiName, developerNames]) => {

            const quotedDeveloperNames = [...developerNames]
                .slice(0, maximumNames)
                .map(developerName => `"${DirectoryProcessor.escapeForNotification(developerName)}"`)
                .join(', ');
            const unlistedNamesNote = developerNames.size > maximumNames
                ? ` and ${developerNames.size - maximumNames} more`
                : '';
            return `${DirectoryProcessor.escapeForNotification(objectApiName)}: ${quotedDeveloperNames}${unlistedNamesNote}`;

        });

        const fileNote = collectionsApiFileName
            ? ` in ${DirectoryProcessor.escapeForNotification(collectionsApiFileName)}`
            : '';
        vscode.window.showWarningMessage(`Treecipe found RecordTypeId values${fileNote} naming record types the target org does not have for their object, and sent them unchanged, so Salesforce will reject those records. ${unmatchedDescriptions.join('; ')}. Create the record type in the org, or change the RecordTypeId in the recipe to a developer name the org has.`);

    }

    static updateLookupReferencesInCollectionApiJson(collectionsApiJson: string, objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string>) {

        const referenceRegexMatch = /(Reference_\d+__)/;

        const nicknameToOrgIdEntries: { nicknameValue: string; orgRecordId: string }[] = [];

        for (const [referenceIdKey, orgRecordId] of Object.entries(objectReferenceIdToOrgCreatedRecordIdMap)) {
            const splitReferenceIdentifiers = referenceIdKey.split(referenceRegexMatch).filter(Boolean);
            const nicknameLookupReferenceMatchIndex = 2;
            const nicknameValue = splitReferenceIdentifiers[nicknameLookupReferenceMatchIndex];
            if (nicknameValue) {
                nicknameToOrgIdEntries.push({ nicknameValue, orgRecordId });
            }
        }

        /*
            Only a JSON string that IS the nickname is replaced -- never one that merely contains it,
            and never a key. A nested friend's nickname is built from its parent's
            ("Contact_Account_NickName" holds "Account_NickName"), so a substring replace rewrote
            the friend's own attributes.referenceId and lost every reference to it (#46). An exact
            match also makes the order of replacement irrelevant, which is why the nicknames are no
            longer sorted longest-first; records sharing a nickname keep insertion order, so the
            first inserted still wins.
        */
        for (const { nicknameValue, orgRecordId } of nicknameToOrgIdEntries) {
            const quotedNickname = JSON.stringify(nicknameValue);
            const quotedNicknameValuePattern = new RegExp(`${quotedNickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\s*:)`, 'g');
            collectionsApiJson = collectionsApiJson.replace(quotedNicknameValuePattern, () => JSON.stringify(orgRecordId));
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
