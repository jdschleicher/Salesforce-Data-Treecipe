import { exec } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';


export class SnowfakeryIntegrationService {

    static baseSnowfakeryInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static snowfakeryGenerationErrorMessage:string = 'An error occurred genertating snowfakery against the recipe file';

    //2DO -  NOT USING AT THE MOMEMNT, MAY JUST GUT IN TIME - 2DO
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

    static transformSnowfakeryJsonData(snowfakeryJsonFileContent: any) {

        const snowfakeryRecords = JSON.parse(snowfakeryJsonFileContent);

        const transformedData = snowfakeryRecords.map(record => {
        
            const objectApiName = record._table; // Use the _table value dynamically as type
            const recordTrackingReferenceId = `${objectApiName}_Reference_${record.id}`;
            const collectionsApiConvertedRecord = {
                attributes: {
                    type: objectApiName,
                    referenceId: recordTrackingReferenceId
                },
                ...record
            };
          
            // remove snowfakery properties not needed for collections api 
            delete collectionsApiConvertedRecord.id;
            delete collectionsApiConvertedRecord._table;

            return collectionsApiConvertedRecord;

        });

        return transformedData;

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

    static createCollectionsApiFile(collectionsApiFormattedRecords: any[], 
                                    selectedRecipeFilePathName: string,
                                    uniqueTimeStampedFakeDataSetsFolderName: string ) {

        const expectedCollectionsApiOutputFile = this.buildCollectionsApiFileNameBySelectedRecipeFileName(selectedRecipeFilePathName);
        const fullCollectionsApiFilePath = `${uniqueTimeStampedFakeDataSetsFolderName}/${expectedCollectionsApiOutputFile}`;

        const jsonStringFormattedRecords = JSON.stringify(collectionsApiFormattedRecords, null, 2);

        fs.writeFile(fullCollectionsApiFilePath, jsonStringFormattedRecords, error => {
            
            if (error) {
                new Error(`Error occurred in Collections Api file creation: ${error.message}`);
            } else {
                vscode.window.showInformationMessage(`Collections Api file created at: ${fullCollectionsApiFilePath}`);
            }

        });

    }

    static buildCollectionsApiFileNameBySelectedRecipeFileName(selectedRecipeFilePathName: string):string {

        const extensionRemovedFileName = selectedRecipeFilePathName.split('.')[0];
        const collectionsApiFileName = `collectionsApi-${extensionRemovedFileName}.json`;

        return collectionsApiFileName;

    }

    static createFakeDataSetsTimeStampedFolderName():string {
        
        const isoDateTimestamp = new Date().toISOString().split(".")[0].replace(/:/g,"-"); // expecting format '2024-11-25T16-24-15'
        const fakeDataSetsFolderName = `dataset-${isoDateTimestamp}`;

        return fakeDataSetsFolderName;

    }
    
}