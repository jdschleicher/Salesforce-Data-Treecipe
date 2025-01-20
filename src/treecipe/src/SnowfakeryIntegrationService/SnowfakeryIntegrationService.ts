import { exec } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';

interface CollectionsApiStructure {
    allOrNone: boolean;
    records: any[];
}

export class SnowfakeryIntegrationService {

    static baseSnowfakeryInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static snowfakeryGenerationErrorMessage:string = 'An error occurred genertating snowfakery against the recipe file';

    //2DO -  NOT CURRENTLY USING, MAY JUST GUT IN TIME - 2DO
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

    static async selectSnowfakeryRecipeFileToProcess() {

        const selectedRecipeFilePathNameQuickPickItem:vscode.QuickPickItem  = await VSCodeWorkspaceService.promptForRecipeFileToProcess();
        return selectedRecipeFilePathNameQuickPickItem;
        
    }

    static async runSnowfakeryFakeDataGenerationBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const snowfakeryJsonResult = await new Promise((resolve, reject) => {

            const generateCommand = `snowfakery ${ fullRecipeFileNamePath } --output-format json`;
            const handleSnowfakeryDataGenerationCallback = (cliCommandError, snowfakeryCliJson) => {

                if (cliCommandError) {
                    reject(new Error(`${this.baseSnowfakeryInstallationErrorMessage}: ${cliCommandError.message}`));
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

        mappedSObjectApiToRecords.forEach((collectionsApiContent, sobjectApiName) => {

            SnowfakeryIntegrationService.createCollectionsApiFile(
                sobjectApiName, 
                collectionsApiContent, 
                fullPathToUniqueTimeStampedFakeDataSetsFolder
            );

        });
    
    }

    static mapSnowfakeryJsonResultsToSobjectMap(snowfakeryJsonFileContent: any): Map<string, CollectionsApiStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiStructure>();

        const snowfakeryRecords = JSON.parse(snowfakeryJsonFileContent);

        snowfakeryRecords.forEach(record => {

            const objectApiName = record._table; // Use the _table value dynamically as type
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

    static createUniqueTimeStampedFakeDataSetsFolderName():string {

        const fakeDataSetsFolderPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const expectedFakeDataSetsFolerPath = `${workspaceRoot}/${fakeDataSetsFolderPath}`;

        if (!fs.existsSync(expectedFakeDataSetsFolerPath)) {
            fs.mkdirSync(expectedFakeDataSetsFolerPath);
        }

        const uniqueTimeStampedFakeDataSetsFolderName = this.createFakeDataSetsTimeStampedFolderName();
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
                new Error(`Error occurred in Collections Api file creation: ${error.message}`);
            } 

        });

    }

    static buildCollectionsApiFileNameBySobjectName(sobjectApiName: string):string {

        const collectionsApiFileName = `collectionsApi-${sobjectApiName}.json`;
        return collectionsApiFileName;

    }

    static createFakeDataSetsTimeStampedFolderName():string {
        
        const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting format '2024-11-25T16-24-15'
        const fakeDataSetsFolderName = `dataset-${isoDateTimestamp}`;

        return fakeDataSetsFolderName;

    }
    
}