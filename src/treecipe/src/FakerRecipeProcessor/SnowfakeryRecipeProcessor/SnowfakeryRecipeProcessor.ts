import { exec, execFile, ExecFileOptionsWithStringEncoding } from 'child_process';
import * as vscode from 'vscode';

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

export class SnowfakeryRecipeProcessor implements IFakerRecipeProcessor {

    async isRecipeProcessorSetup(): Promise<boolean> {

        return new Promise((resolve, reject) => {
            
            const snowfakeryVersionCheckCommand = 'snowfakery --version';
            const handleSnowfakeryVersionCheckCallback = (cliCommandError, cliCommandStandardOut) => {

                if (cliCommandError) {
                    reject(new Error(`An error occurred in checking for snowfakery installation: ${cliCommandError.message}`));
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

    async generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const snowfakeryJsonResult = await new Promise((resolve, reject) => {

            /*
                The recipe path is a file name from the workspace -- content that arrives with a cloned
                repository -- so it is handed to snowfakery as ONE argv element and never reaches a shell.
                Interpolating it into an exec string made backticks, $(), ; and && in a file name live,
                and split any path containing a space into two arguments.
            */
            const snowfakeryArguments = [fullRecipeFileNamePath, '--output-format', 'json'];
            const execFileOptions: ExecFileOptionsWithStringEncoding = {
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10
            };

            const handleSnowfakeryDataGenerationCallback = (cliCommandError: NodeJS.ErrnoException | null, snowfakeryCliJson: string) => {

                if (cliCommandError) {
                    
                    const executedCommand = "SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile";
                    
                    const customFakerEvaluationError = new Error();
                    customFakerEvaluationError.message = SnowfakeryRecipeProcessor.getSnowfakeryGenerationErrorMessage(cliCommandError);
            
                    customFakerEvaluationError.name = "SnowfakeryEvaluationError";
                    customFakerEvaluationError.stack = cliCommandError.stack;
            
                    customFakerEvaluationError.cause = cliCommandError.message;
            
                    ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile(customFakerEvaluationError, executedCommand);
                    reject(customFakerEvaluationError);

                } else {

                    /*
                     IF NO ERROR THEN stdout CONTAINS THE VERSION INFORMATION 
                     AND WE CAN RETURN SNOWFAKERY JSON
                     */
                    resolve(snowfakeryCliJson);

                }

            };

            // perform CLI snowfakery command
            execFile('snowfakery', snowfakeryArguments, execFileOptions, handleSnowfakeryDataGenerationCallback);

        });

        return snowfakeryJsonResult;

    }

    /*
        execFile reports both failures through one error object, and "code" tells them apart: a STRING
        is an errno from a spawn that never ran (ENOENT when snowfakery is not on PATH), a NUMBER is
        snowfakery's own non zero exit, whose message already carries its stderr.
    */
    static getSnowfakeryGenerationErrorMessage(cliCommandError: NodeJS.ErrnoException): string {

        if ( typeof cliCommandError.code === 'string' ) {
            return `The snowfakery CLI could not be started (${ cliCommandError.code }). Confirm snowfakery is installed and on PATH, then run the command again. ${ cliCommandError.message }`;
        }

        return cliCommandError.message;

    }

    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiJsonStructure>();

        const snowfakeryRecords = JSON.parse(fakerContent);

        snowfakeryRecords.forEach(record => {

            const objectApiName = record._table; // snowfakery captures the object api name value in _table property
            const recordTrackingReferenceId = this.createCombinedNickNameReferenceForRecord(
                objectApiName,
                record
            );
            const sobjectGeneratedDetail = {
                attributes: {
                    type: objectApiName,
                    referenceId: recordTrackingReferenceId
                },
                ...record
            };
          
            // remove snowfakery properties not needed for collections api 
            delete sobjectGeneratedDetail.id;
            delete sobjectGeneratedDetail.nickname;
            delete sobjectGeneratedDetail._table;

            if (objectApiToGeneratedRecords.has(objectApiName)) {

                objectApiToGeneratedRecords.get(objectApiName).records.push(sobjectGeneratedDetail);

            } else {

                const objectApiToRecords:CollectionsApiJsonStructure = {
                    allOrNone: true,
                    records: [sobjectGeneratedDetail] 
                };

                objectApiToGeneratedRecords.set(objectApiName, objectApiToRecords);

            }

        });

        return objectApiToGeneratedRecords;

    
    }

    createCombinedNickNameReferenceForRecord(objectApiName:string, recordDetail: any):string {

        let referenceTrackingId = `${objectApiName}_Reference_${recordDetail.id}`;
        if ( recordDetail.nickname ) {
            referenceTrackingId = `${referenceTrackingId}__${recordDetail.nickname}`;
        }

        return referenceTrackingId;

    }

    getStandardAndGlobalValueSetTODOPlaceholderWithExample():string {

        const emptyPicklistXMLDetailRecipePlaceholder = `### TODO: POSSIBLE GLOBAL OR STANDARD VALUE SET USED FOR THIS PICKLIST AS DETAILS ARE NOT IN FIELD XML MARKUP -- FIND ASSOCIATED VALUE SET AND REPALCE COMMA SEPARATED FRUITS WITH VALUE SET OPTIONS: \${{ random_choice('apple', 'orange', 'banana') }}`;
        return emptyPicklistXMLDetailRecipePlaceholder;

    }
    
    
}