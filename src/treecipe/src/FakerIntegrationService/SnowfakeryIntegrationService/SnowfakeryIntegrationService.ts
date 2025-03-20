import { exec } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';

interface CollectionsApiStructure {
    allOrNone: boolean;
    records: any[];
}

export class SnowfakeryIntegrationService {

    static baseSnowfakeryInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static snowfakeryGenerationErrorMessage:string = 'An error occurred genertating snowfakery against the recipe file';

    static async isSnowfakeryInstalled(): Promise<boolean> {

        return new Promise((resolve, reject) => {
            
            const snowfakeryVersionCheckCommand = 'snowfakery --version';
            const handleSnowfakeryVersionCheckCallback = (cliCommandError, cliCommandStandardOut) => {

                if (cliCommandError) {
                    reject(new Error(`${this.baseSnowfakeryInstallationErrorMessage}: ${cliCommandError.message}`));
                } else {

                    /*
                        IF NO ERROR THEN stdout CONTAINS THE VERSION INFORMATION 
                        AND WE CAN RETURN TRUE FOR SNOWFAKERY BEING INSTALLED
                     */
                    vscode.window.showInformationMessage(cliCommandStandardOut);
                    resolve(true);

                }

            };

            // perform CLI snowfakery command
            exec(snowfakeryVersionCheckCommand, handleSnowfakeryVersionCheckCallback);

        });

    }

    static async selectFakerRecipeFileToProcess() {

        const expectedGeneratedRecipesFolderPath = ConfigurationService.getGeneratedRecipesFolderPath();
        const vsCodeQuickPickItemPromptLabel = 'Select recipe file to process';
        const selectedRecipeFilePathNameQuickPickItem:vscode.QuickPickItem  = await VSCodeWorkspaceService.promptForDirectoryToGenerateQuickItemsForFileSelection(expectedGeneratedRecipesFolderPath, vsCodeQuickPickItemPromptLabel);
        return selectedRecipeFilePathNameQuickPickItem;
        
    }

    static async runSnowfakeryFakeDataGenerationBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const snowfakeryJsonResult = await new Promise((resolve, reject) => {

            const generateCommand = `snowfakery ${ fullRecipeFileNamePath } --output-format json`;
            const handleSnowfakeryDataGenerationCallback = (cliCommandError, snowfakeryCliJson) => {

                if (cliCommandError) {
                    
                    const snowfakeryError = new Error(`${this.baseSnowfakeryInstallationErrorMessage}: ${cliCommandError.message}`);
                    reject(snowfakeryError);

                } else {

                    /*
                     IF NO ERROR THEN stdout CONTAINS THE VERSION INFORMATION 
                     AND WE CAN RETURN SNOWFAKERY JSON
                     */
                    resolve(snowfakeryCliJson);

                }

            };

            // perform CLI snowfakery command
            exec(generateCommand, handleSnowfakeryDataGenerationCallback);

        });

        return snowfakeryJsonResult;

    }

    static transformSnowfakeryJsonDataToCollectionApiFormattedFilesBySObject(snowfakeryJsonFileContent: any, fullPathToUniqueTimeStampedFakeDataSetsFolder: string) {

        const mappedSObjectApiToRecords = this.mapSnowfakeryJsonResultsToSobjectMap(snowfakeryJsonFileContent);   

        const directoryToStoreCollectionDatasetFiles = 'DatasetFilesForCollectionsApi';
        const fullPathToStoreDatasetFiles = `${fullPathToUniqueTimeStampedFakeDataSetsFolder}/${directoryToStoreCollectionDatasetFiles}`;
        fs.mkdirSync(fullPathToStoreDatasetFiles);

        mappedSObjectApiToRecords.forEach((collectionsApiContent, sobjectApiName) => {

            SnowfakeryIntegrationService.createCollectionsApiFile(
                sobjectApiName, 
                collectionsApiContent, 
                fullPathToStoreDatasetFiles
            );

        });
    
    }

    static mapSnowfakeryJsonResultsToSobjectMap(snowfakeryJsonFileContent: any): Map<string, CollectionsApiStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiStructure>();

        const snowfakeryRecords = JSON.parse(snowfakeryJsonFileContent);

        snowfakeryRecords.forEach(record => {

            const objectApiName = record._table; // snowfakery captures the object api name value in _table property
            const recordTrackingReferenceId = `${objectApiName}_Reference_${record.id}`;
            const sobjectGeneratedDetail = {
                attributes: {
                    type: objectApiName,
                    referenceId: recordTrackingReferenceId
                },
                ...record
            };
          
            // remove snowfakery properties not needed for collections api 
            delete sobjectGeneratedDetail.id;
            delete sobjectGeneratedDetail._table;

            if (objectApiToGeneratedRecords.has(objectApiName)) {

                objectApiToGeneratedRecords.get(objectApiName).records.push(sobjectGeneratedDetail);

            } else {

                const objectApiToRecords:CollectionsApiStructure = {
                    allOrNone: true,
                    records: [sobjectGeneratedDetail] 
                };

                objectApiToGeneratedRecords.set(objectApiName, objectApiToRecords);

            }

        });

        return objectApiToGeneratedRecords;
    
    }

    static createUniqueTimeStampedFakeDataSetsFolderName(uniqueTimeStampedFakeDataSetsFolderName: string):string {

        const fakeDataSetsFolderPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const expectedFakeDataSetsFolerPath = `${workspaceRoot}/${fakeDataSetsFolderPath}`;

        if (!fs.existsSync(expectedFakeDataSetsFolerPath)) {
            fs.mkdirSync(expectedFakeDataSetsFolerPath);
        }

        const fullPathToUniqueTimeStampedFakeDataSetsFolder = `${expectedFakeDataSetsFolerPath}/${uniqueTimeStampedFakeDataSetsFolderName}`;
        fs.mkdirSync(`${fullPathToUniqueTimeStampedFakeDataSetsFolder}`);

        return fullPathToUniqueTimeStampedFakeDataSetsFolder;

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

    static createFakeDatasetsTimeStampedFolderName(isoDateTimestamp):string {
        
        const fakeDataSetsFolderName = `dataset-${isoDateTimestamp}`;
        return fakeDataSetsFolderName;

    }
    
}