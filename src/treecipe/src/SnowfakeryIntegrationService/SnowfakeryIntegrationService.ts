import { exec } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';


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

    static async promptForRecipeFileToRunRecipe() {

    }

    static async runSnowfakeryGenerationBySelectedRecipeFile() {
       
        const selectedRecipeFilePathName = this.promptForRecipeFileToRunRecipe();
        const snowfakeryJsonResult = new Promise((resolve, reject) => {

            selectedRecipeFilePathName = `treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml`;
            const generateCommand = `snowfakery  ${ selectedRecipeFilePathName } --output-format json`;
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

        const collectionsApiFormattedRecords = this.transformSnowfakeryJsonData(snowfakeryJsonResult);
        this.createCollectionsApiFile(collectionsApiFormattedRecords, selectedRecipeFilePathName);

    }

    static buildCollectionsApiFileNameBySelectedRecipeFileName(selectedRecipeFilePathName: string):string {
        throw new Error('Method not implemented.');
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

    static createCollectionsApiFile(collectionsApiFormattedRecords: string, selectedRecipeFilePathName: string) {

        const expectedCollectionsApiOutputFile = this.buildCollectionsApiFileNameBySelectedRecipeFileName(selectedRecipeFilePathName);

        fs.writeFile(expectedCollectionsApiOutputFile, JSON.stringify(collectionsApiFormattedRecords, null, 2), error => {
            
            if (error) {
                new Error(`Error occurred in Collections Api file creation: ${error.message}`);
            } else {
                vscode.window.showInformationMessage(`Collections Api file created at: ${expectedCollectionsApiOutputFile}`);
            }

        });

    }

    
}