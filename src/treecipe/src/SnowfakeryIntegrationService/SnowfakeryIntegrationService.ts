import { exec } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';


export class SnowfakeryIntegrationService {

    static baseSnowfakeryInstallationErrorMessage:string  = 'An error occurred in checking for Snowfakery installation';
    
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

    // static async promptForRecipeFileToRunRecipe() {

    // }

    static async runSnowfakeryGenerationByRecipeFile() {
       
        const cliExecPromise = new Promise((resolve, reject) => {
            
            const generateCommand = `snowfakery treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml --output-format json --output-file 'thisname.json' --output-folder .`;
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
            exec(generateCommand, handleSnowfakeryVersionCheckCallback);

        });

        // check if file exists 
        const fileName = 'thisname.json';
        let snowfakeryJsonFileContent = null;
        if (fs.existsSync(fileName)) {
            snowfakeryJsonFileContent = fs.readFileSync(fileName, 'utf-8');
        } else {
            const error = new Error(); 
            error.message = `Missing expected snowfakery json file at path of: ${ fileName } -- or unknown failure`; 
            throw(error);
        }

        const collectionsApiFormattedRecords = this.transformSnowfakeryJsonData(snowfakeryJsonFileContent);

        this.createCollectionsApiFile(collectionsApiFormattedRecords, fileName);

    }


    static transformSnowfakeryJsonData(snowfakeryJsonFileContent: any) {

        const snowfakeryRecords = JSON.parse(`[${snowfakeryJsonFileContent}]`); // Wrap in `[]` to handle newline-separated JSON

        const transformedData = snowfakeryRecords.map(record => {
        
            const objectApiName = record._table; // Use the _table value dynamically as type
            const recordTrackingReferenceId = `${objectApiName}_${record.id}`;
            const collectionsApiConvertedRecord = {
                attributes: {
                  type: objectApiName,
                  referenceId: recordTrackingReferenceId
                },
                ...record
              };
          
              // Remove unnecessary fields
              delete collectionsApiConvertedRecord.id;
              delete collectionsApiConvertedRecord._table;

            return collectionsApiConvertedRecord;

        });

        return transformedData;

    }


    static createCollectionsApiFile(collectionsApiFormattedRecords: any, outputFile: string) {

        // Write the transformed data to a new file
        // const outputFile = 'path/to/output.json';
        fs.writeFile(outputFile, JSON.stringify(collectionsApiFormattedRecords, null, 2), err => {
        if (err) {
            console.error('Error writing the output file:', err);
        } else {
            console.log('Transformed data saved to:', outputFile);
        }
        });

    }

    
}