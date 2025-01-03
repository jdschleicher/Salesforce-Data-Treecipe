import { exec } from 'child_process';
import * as vscode from 'vscode';

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

    static async runSnowfakeryGenerationByRecipeFile() {
       
        const snowfakeryCliExists = await this.isSnowfakeryInstalled();

        if (snowfakeryCliExists) {
            console.log('Snowfakery is installed');
        }

    }
    
}