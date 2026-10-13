import { Connection, SfError } from "@salesforce/core";
import { ConfigurationService } from "../ConfigurationService/ConfigurationService";
import { DirectoryProcessor } from "../DirectoryProcessingService/DirectoryProcessor";
import { SalesforceOrgService } from "../SalesforceOrgService/SalesforceOrgService";
import { VSCodeWorkspaceService } from "../VSCodeWorkspace/VSCodeWorkspaceService";
import { RecordTypeService } from "../RecordTypeService/RecordTypeService";
import { RecipeYamlScalar } from "../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar";
import { IAuthenticatedOrgDetail } from "../PicklistDependencyCheckService/PicklistDependencyCheckService";

import * as vscode from 'vscode';
import * as fs from 'fs';
import path = require('path');

export const INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER = 'Select the Salesforce org the data set will be inserted into -- production orgs are refused (sandbox, scratch and Developer Edition orgs are allowed)';

/*
    How an insert of a data set ended. "completed" went through every file, "cancelled" was stopped
    by the reader and rolled back, and "stopped" stopped at a file that could not be inserted -- an
    all-or-none failure, or a request that threw (a dropped connection, an expired session, a limit).
    isRolledBack says whether what was saved was deleted again: always for a cancel, and for a stop
    under all-or-none. savedRecordCount is what is still in the org.
*/
export type DataSetInsertOutcome = 'completed' | 'cancelled' | 'stopped';

export interface IDataSetInsertResult {
    outcome: DataSetInsertOutcome;
    isRolledBack: boolean;
    resultsFilePath: string;
    savedRecordCount: number;
    failedRecordCount: number;
    // THE FILE AND ERROR OF A REQUEST THAT THREW, FOR A CALLER THAT REPORTS THE OUTCOME ITSELF; UNESCAPED
    requestFailureDetail?: string;
}

/*
    One file's records just before they are inserted, after every reference to a record an earlier
    file created was swapped for its Id: what the Recipe Cockpit's tree insert (#255) uses to fill
    or clear the lookups the recipe could not wire. createdRecordIdsByReferenceId is every Id this
    insert has created so far, keyed by the referenceId of the record it was created from.
*/
export type DataSetRecordPreparer = (objectApiName: string, records: unknown[], createdRecordIdsByReferenceId: Readonly<Record<string, string>>) => unknown[];

/*
    isFailureReportedByCaller: the caller shows how the insert ended in its own notification (the
    Recipe Cockpit's tree insert), so a file that stops the insert shows no second one here.
*/
export interface IDataSetInsertOptions {
    prepareRecords?: DataSetRecordPreparer;
    isFailureReportedByCaller?: boolean;
}

export const INSERT_VIEW_ERRORS_LABEL = 'View errors';
export const INSERT_RESULTS_FILE_MISSING_TEXT = 'The insert results file no longer exists in this workspace.';
// A FailureResults ENTRY FOR A REQUEST THAT THREW: NOT A RECORD THE ORG REJECTED, SO NEVER COUNTED AS ONE
export const INSERT_REQUEST_FAILED_STATUS_CODE = 'REQUEST_FAILED';

type InsertProgress = vscode.Progress<{ message?: string; increment?: number }>;

export class CollectionsApiService {

    static readonly insertAttemptsDirectoryName = 'InsertAttempts';

    static readonly collectionsApiRecordBatchSizeLimit = 200;

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

    /*
        Picked from the orgs the Salesforce CLI reports as connected rather than typed in, so a dead
        scratch org or a disconnected sandbox is never offered. Production is still listed: the CLI's
        local data cannot tell a Developer Edition org from production, so the insert asks the org
        itself once connected and refuses there. Connect by the USERNAME: an alias is a local nickname
        that could be re-pointed between the pick and the connection.
    */
    static async getExpectedSalesforceOrgToInsertAgainst(): Promise<IAuthenticatedOrgDetail | undefined> {

        return await SalesforceOrgService.promptForAuthorizedOrg(INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER);

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

    /*
        Inserts a data set folder's Collections API files, parents first, into the org the connection
        names: the one insert every command uses -- Insert Data Set by Directory and the Recipe
        Cockpit's tree insert (#255) alike. The org's record type Ids replace the developer names the
        recipe wrote, and each file's lookups to records an earlier file created are swapped for
        their Ids. It runs in a cancellable progress notification, reporting each file and each insert
        round; Cancel, or an all-or-none failure, deletes every record this insert saved.
    */
    static async insertDataSetFolderIntoOrg(datasetFolderPath: string,
                                            aliasAuthenticationConnection: Connection,
                                            allOrNoneSelection: boolean,
                                            insertOptions: IDataSetInsertOptions = {}): Promise<IDataSetInsertResult> {

        const datasetChildFoldersToFilesMap = await this.getDataSetChildDirectoriesNameToFilesMap(datasetFolderPath);
        const treecipeObjectWrapperDetail = await this.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);
        const objectApiNamesToGetRecordTypeInfoFrom = Object.keys(treecipeObjectWrapperDetail.ObjectToObjectInfoMap);
        const recordTypeDetailFromOrg = await RecordTypeService.getRecordTypeIdsByConnection(aliasAuthenticationConnection, objectApiNamesToGetRecordTypeInfoFrom);

        return this.upsertDataSetToSelectedOrg(datasetFolderPath,
                                                datasetChildFoldersToFilesMap,
                                                recordTypeDetailFromOrg,
                                                aliasAuthenticationConnection,
                                                allOrNoneSelection,
                                                insertOptions);

    }

    static async upsertDataSetToSelectedOrg(selectedDataSetFullDirectoryPath: string,
                                            datasetChildFoldersToFilesMap: Record<string, string[]>, 
                                            recordTypeDetailFromTargetOrg: any,
                                            aliasAuthenticationConnection: Connection,
                                            allOrNoneSelection: boolean,
                                            insertOptions: IDataSetInsertOptions = {}): Promise<IDataSetInsertResult> {

        const collectionsApiFilesDirectoryFolderName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
        let collectionApiFiles = datasetChildFoldersToFilesMap[collectionsApiFilesDirectoryFolderName] ?? [];

        // Get the treecipe wrapper to access relationship levels
        const treecipeObjectWrapperDetail = await this.getTreecipeObjectsWrapperDetailByDataSetDirectoriesToFilesMap(datasetChildFoldersToFilesMap);
        
        // Sort collection API files based on relationship levels from the wrapper
        collectionApiFiles = this.sortCollectionApiFilesByRelationshipLevel(collectionApiFiles, treecipeObjectWrapperDetail);

        const pathToInsertAttemptsDirectory = path.join(selectedDataSetFullDirectoryPath, this.insertAttemptsDirectoryName);
        if (!fs.existsSync(pathToInsertAttemptsDirectory)) {
            fs.mkdirSync(pathToInsertAttemptsDirectory);
        }

        const isoDateTimestamp = VSCodeWorkspaceService.getNowIsoDateTimestamp();                                
        const timestampedInsertAttemptDirectoryFullPath = `${pathToInsertAttemptsDirectory}/insertAttempt-${isoDateTimestamp}`;
        fs.mkdirSync(timestampedInsertAttemptDirectoryFullPath);

        // File and directory prep for capturing Collection Api call results
        const resultsFileName = `insertAttemptResults-${isoDateTimestamp}.json`;
        const fullPathToResultsFile = path.join(timestampedInsertAttemptDirectoryFullPath, resultsFileName);

        const allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>> = {
            'SuccessResults' : {},
            'FailureResults' : {}
        };
        const objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string> = {};
        const countRecordFailures = (objectResults: any[] | undefined) => (objectResults ?? []).filter(objectResult => !this.isRequestFailureResult(objectResult)).length;
        let outcome: DataSetInsertOutcome = 'completed';
        let isRolledBack = false;
        let requestFailureDetail: string | undefined;

        await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Inserting Salesforce Collection API files...",
              cancellable: true
            },
            
            async (progress, token) => {

              const totalFiles = collectionApiFiles.length;
              const rollBackCancelledInsert = async () => {
                  outcome = 'cancelled';
                  isRolledBack = true;
                  vscode.window.showWarningMessage("Import cancelled by user. Deleting any previously saved records...");
                  if ( fs.existsSync(fullPathToResultsFile) ) {
                      await this.deletePreviouslySavedRecords(fullPathToResultsFile, aliasAuthenticationConnection);
                  }
              };
              // processAndInsertCollectionFile ROLLS BACK AN ALL-OR-NONE FAILURE ITSELF, SO A CANCEL SEEN AFTER ONE IS NOT A SECOND DELETE
              const hasAllOrNoneFailure = () => allOrNoneSelection && Object.keys(allCollectionApiFilesSobjectResults.FailureResults).length > 0;
              const showInsertFailure = (notificationText: string) => {
                  if ( insertOptions.isFailureReportedByCaller ) {
                      return;
                  }
                  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                  // THE FILE NAME AND THE ERROR ARE BOTH WORKSPACE OR ORG TEXT, AND A NOTIFICATION RENDERS [label](command:…) AS A LINK
                  VSCodeWorkspaceService.showNotificationWithWorkspaceFile('error', RecipeYamlScalar.escapeForNotification(notificationText), INSERT_VIEW_ERRORS_LABEL,
                      workspaceRoot && fs.existsSync(fullPathToResultsFile) ? fullPathToResultsFile : undefined,
                      workspaceRoot ?? '', INSERT_RESULTS_FILE_MISSING_TEXT);
              };
          
              for (let i = 0; i < totalFiles; i++) {

                if (token.isCancellationRequested) {
                  await rollBackCancelledInsert();
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
                                                            token,
                                                            progress,
                                                            insertOptions.prepareRecords);

                    if ( !successResult && token.isCancellationRequested && !hasAllOrNoneFailure() ) {
                        await rollBackCancelledInsert();
                        return;
                    }

                    if (!successResult) {
                        outcome = 'stopped';
                        isRolledBack = allOrNoneSelection;
                        const failedCount = countRecordFailures(allCollectionApiFilesSobjectResults.FailureResults[this.getObjectNameFromCollectionsApiFilePath(collectionsApiFilePath)]);
                        showInsertFailure(`Failed to process ${fileName}: ${failedCount} ${failedCount === 1 ? 'record' : 'records'} failed${isRolledBack ? ', and every record this insert had saved was deleted, because all-or-none was chosen' : ''}.`);
                        break;                    
                    }

                } catch (error) {

                    /*
                        A request that threw saved nothing it could report, so the files after it --
                        whose lookups name its records -- stop here too. Under all-or-none what the
                        earlier files saved is deleted, as an all-or-none failure is.
                    */
                    outcome = 'stopped';
                    const errorMessage = String((error as { message?: unknown })?.message ?? error);
                    requestFailureDetail = `${fileName} failed: ${errorMessage}`;
                    this.recordRequestFailure(allCollectionApiFilesSobjectResults, this.getObjectNameFromCollectionsApiFilePath(collectionsApiFilePath), fileName, errorMessage, fullPathToResultsFile);
                    if ( allOrNoneSelection ) {
                        isRolledBack = true;
                        if ( fs.existsSync(fullPathToResultsFile) ) {
                            await this.deletePreviouslySavedRecords(fullPathToResultsFile, aliasAuthenticationConnection);
                        }
                    }
                    showInsertFailure(`Failed to process ${fileName}: ${errorMessage}${isRolledBack ? ' — every record this insert had saved was deleted, because all-or-none was chosen.' : ''}`);
                    break;

                }

              }
          
              if ( outcome === 'completed' ) {
                  vscode.window.showInformationMessage("All files processed.");
              }

            }
        );

        const countResults = (resultsByObject: Record<string, any[]> | undefined) => Object.values(resultsByObject ?? {}).reduce((recordCount, objectResults) => recordCount + countRecordFailures(objectResults), 0);

        return {
            outcome: outcome,
            isRolledBack: isRolledBack,
            resultsFilePath: fullPathToResultsFile,
            savedRecordCount: isRolledBack ? 0 : countResults(allCollectionApiFilesSobjectResults.SuccessResults),
            failedRecordCount: countResults(allCollectionApiFilesSobjectResults.FailureResults),
            ...(requestFailureDetail === undefined ? {} : { requestFailureDetail })
        };

    }

    static async processAndInsertCollectionFile(collectionsApiFilePath,
                                                recordTypeDetailFromTargetOrg,
                                                objectReferenceIdToOrgCreatedRecordIdMap,
                                                aliasAuthenticationConnection,
                                                allOrNoneSelection,
                                                allCollectionApiFilesSobjectResults,
                                                fullPathToResultsFile,
                                                token: vscode.CancellationToken,
                                                progress?: InsertProgress,
                                                prepareRecords?: DataSetRecordPreparer): Promise<boolean> {
    
            let collectionsApiJson = await VSCodeWorkspaceService.getFileContentByPath(collectionsApiFilePath);
            collectionsApiJson = this.updateCollectionApiJsonContentWithOrgRecordTypeIds(collectionsApiJson, recordTypeDetailFromTargetOrg, path.basename(collectionsApiFilePath));
            collectionsApiJson = this.updateLookupReferencesInCollectionApiJson(collectionsApiJson, objectReferenceIdToOrgCreatedRecordIdMap);
            const preparedCollectionsApiDetail = JSON.parse(collectionsApiJson);

            const objectNameForFile = this.getObjectNameFromCollectionsApiFilePath(collectionsApiFilePath);
            if ( prepareRecords && Array.isArray(preparedCollectionsApiDetail.records) ) {
                preparedCollectionsApiDetail.records = prepareRecords(objectNameForFile, preparedCollectionsApiDetail.records, objectReferenceIdToOrgCreatedRecordIdMap);
            }
            const insertRounds = this.partitionRecordsIntoInsertRounds(preparedCollectionsApiDetail.records);
            // THE IDS THIS FILE'S OWN ROUNDS CREATED -- EVERY EARLIER FILE'S REFERENCE WAS ALREADY RESOLVED ABOVE, SO A LATER ROUND IS MATCHED AGAINST THESE ALONE
            const referenceIdToOrgIdCreatedByThisFile: Record<string, string> = {};

            for ( let insertRoundIndex = 0; insertRoundIndex < insertRounds.length; insertRoundIndex++ ) {

                // A CANCEL BETWEEN ROUNDS STOPS BEFORE THE NEXT REQUEST; THE CALLER ROLLS BACK WHAT WAS SAVED
                if ( insertRoundIndex > 0 && token?.isCancellationRequested ) {
                    return false;
                }

                progress?.report({ message: `Inserting ${objectNameForFile}: round ${insertRoundIndex + 1} of ${insertRounds.length}` });

                // A LATER ROUND'S LOOKUPS NAME RECORDS OF THIS FILE, WHICH ONLY THE ROUNDS BEFORE IT GAVE AN ID
                const insertRoundDetail = insertRoundIndex === 0
                    ? { ...preparedCollectionsApiDetail, records: insertRounds[insertRoundIndex] }
                    : JSON.parse(this.updateLookupReferencesInCollectionApiJson(JSON.stringify({ ...preparedCollectionsApiDetail, records: insertRounds[insertRoundIndex] }),
                                                                                referenceIdToOrgIdCreatedByThisFile));

                const collectionsApiSobjectResult = await this.makeCollectionsApiCall(insertRoundDetail, 
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

                objectReferenceIdToOrgCreatedRecordIdMap = this.updateReferenceIdMapWithCreatedRecords(objectReferenceIdToOrgCreatedRecordIdMap, collectionsApiSobjectResult, insertRoundDetail.records);
                this.updateReferenceIdMapWithCreatedRecords(referenceIdToOrgIdCreatedByThisFile, collectionsApiSobjectResult, insertRoundDetail.records);

            }

            return true;

    
    }

    /*
        A request that threw has no per-record answer, so the results file would otherwise not say
        why the insert stopped -- or not exist at all, when it was the first file. One entry under
        the object's FailureResults records the file and the error. NOTHING here may throw: the
        caller rolls back an all-or-none insert after this, and an object named from a file
        (`collectionsApi-constructor.json`) meets addItemToRecordMap's `in` check on a plain
        object. Anything that fails leaves the file as it was, and the notification without a button.
    */
    static recordRequestFailure(allCollectionApiFilesSobjectResults: Record<string, Record<string, any[]>>,
                                objectApiName: string,
                                fileName: string,
                                errorMessage: string,
                                fullPathToResultsFile: string) {

        const requestFailure = { success: false, fileName: fileName, errors: [{ statusCode: INSERT_REQUEST_FAILED_STATUS_CODE, message: errorMessage, fields: [] as string[] }] };

        try {
            allCollectionApiFilesSobjectResults.FailureResults = this.addItemToRecordMap(allCollectionApiFilesSobjectResults.FailureResults, objectApiName, requestFailure);
            this.appendInsertAttemptsFileWithLatestSobjectResults(allCollectionApiFilesSobjectResults, fullPathToResultsFile);
        } catch {
            // THE NOTIFICATION STILL SHOWS, WITHOUT A BUTTON
        }

    }

    static isRequestFailureResult(objectResult: any): boolean {

        return Array.isArray(objectResult?.errors)
                && objectResult.errors.some((resultError: any) => resultError?.statusCode === INSERT_REQUEST_FAILED_STATUS_CODE)
                && typeof objectResult?.fileName === 'string';

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
            const recordId = sObjectResults[i]?.id;

            // A RECORD SALESFORCE REJECTED HAS NO Id: MAPPED, ITS CHILDREN'S FILE WOULD BE WRITTEN WITH A BARE undefined AND SKIPPED WHOLE
            if ( sObjectResults[i]?.success === false || typeof recordId !== 'string' ) {
                continue;
            }

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

            const collectionsApiRecordBatchSizeLimitPerRestCall = this.collectionsApiRecordBatchSizeLimit;

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

    // THE NICKNAME A REFERENCE ID ENDS IN -- "Account_Reference_1__Account_NickName" GIVES "Account_NickName"
    static readNicknameFromReferenceId(referenceId: string): string | undefined {

        const referenceRegexMatch = /(Reference_\d+__)/;
        const splitReferenceIdentifiers = referenceId.split(referenceRegexMatch).filter(Boolean);
        const nicknameLookupReferenceMatchIndex = 2;
        return splitReferenceIdentifiers[nicknameLookupReferenceMatchIndex];

    }

    /*
        One file's records in the order they can be inserted. A record whose field IS the nickname of
        another record in the SAME file -- a child Account's ParentId naming the Account above it
        (#188) -- cannot be resolved until that record has an Id, and every record of a file used to
        go in one request, so it was sent with the nickname text as its lookup. Each round holds the
        records whose same-file references name a nickname some earlier round inserted; a file with
        none is one round, exactly the request it always was. References that can never be met (a
        cycle) are inserted together in a last round, as they were before, and Salesforce reports them.
    */
    static partitionRecordsIntoInsertRounds(records: unknown): unknown[][] {

        if ( !Array.isArray(records) || records.length === 0 ) {
            return [records as unknown[]];
        }

        const readFieldEntries = (record: unknown): Array<[string, unknown]> => ( record && typeof record === 'object' ? Object.entries(record) : [] );
        const nicknames = records.map(record => {
            const attributes = readFieldEntries(record).find(([fieldName]) => fieldName === 'attributes')?.[1];
            const referenceId = readFieldEntries(attributes).find(([attributeName]) => attributeName === 'referenceId')?.[1];
            return typeof referenceId === 'string' ? this.readNicknameFromReferenceId(referenceId) : undefined;
        });

        const recordIndexesByNickname = new Map<string, number[]>();
        nicknames.forEach((nickname, recordIndex) => {
            if ( !nickname ) {
                return;
            }
            const holderIndexes = recordIndexesByNickname.get(nickname);
            if ( holderIndexes ) {
                holderIndexes.push(recordIndex);
            } else {
                recordIndexesByNickname.set(nickname, [recordIndex]);
            }
        });

        // A NICKNAME HELD BY SEVERAL RECORDS IS A REFERENCE FROM ANY OF THEM, SO ONLY ITS FIRST TWO HOLDERS ARE NEEDED TO TELL "ANOTHER RECORD" FROM "ITSELF"
        const referencedNicknamesByRecordIndex = records.map((record, recordIndex) => {
            const referencedNicknames = new Set<string>();
            readFieldEntries(record).forEach(([fieldName, fieldValue]) => {
                if ( fieldName === 'attributes' || typeof fieldValue !== 'string' ) {
                    return;
                }
                const holderIndexes = recordIndexesByNickname.get(fieldValue);
                if ( holderIndexes && ( holderIndexes[0] !== recordIndex || holderIndexes.length > 1 ) ) {
                    referencedNicknames.add(fieldValue);
                }
            });
            return referencedNicknames;
        });

        const insertedNicknames = new Set<string>();
        let remainingRecordIndexes = records.map((_record, recordIndex) => recordIndex);
        const insertRounds: unknown[][] = [];

        while ( remainingRecordIndexes.length > 0 ) {

            const readyRecordIndexes = remainingRecordIndexes.filter(recordIndex => (
                [...referencedNicknamesByRecordIndex[recordIndex]].every(referencedNickname => insertedNicknames.has(referencedNickname))
            ));
            const roundRecordIndexes = readyRecordIndexes.length > 0 ? readyRecordIndexes : remainingRecordIndexes;
            const roundRecordIndexSet = new Set(roundRecordIndexes);

            insertRounds.push(roundRecordIndexes.map(recordIndex => records[recordIndex]));
            roundRecordIndexes.forEach(recordIndex => {
                if ( nicknames[recordIndex] ) {
                    insertedNicknames.add(nicknames[recordIndex]);
                }
            });
            remainingRecordIndexes = remainingRecordIndexes.filter(recordIndex => !roundRecordIndexSet.has(recordIndex));

        }

        return insertRounds;

    }

    static updateLookupReferencesInCollectionApiJson(collectionsApiJson: string, objectReferenceIdToOrgCreatedRecordIdMap: Record<string, string>) {

        const nicknameToOrgIdEntries: { nicknameValue: string; orgRecordId: string }[] = [];

        for (const [referenceIdKey, orgRecordId] of Object.entries(objectReferenceIdToOrgCreatedRecordIdMap)) {
            const nicknameValue = this.readNicknameFromReferenceId(referenceIdKey);
            if (nicknameValue && typeof orgRecordId === 'string') {
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

        // WRITTEN BEFORE THIS RETURNS: THE COCKPIT'S TREE INSERT (#255) READS THE FILES THE MOMENT GENERATION ENDS
        fs.writeFileSync(fullCollectionsApiFilePath, jsonStringFormattedRecords);

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
