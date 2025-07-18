import { exec } from 'child_process';
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

            const generateCommand = `snowfakery ${ fullRecipeFileNamePath } --output-format json`;
            const handleSnowfakeryDataGenerationCallback = (cliCommandError, snowfakeryCliJson) => {

                if (cliCommandError) {
                    
                    const executedCommand = "SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile";
                    
                    const customFakerEvaluationError = new Error();
                    customFakerEvaluationError.message = cliCommandError.message;
            
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
            exec(generateCommand, { maxBuffer: 1024 * 1024 * 10}, handleSnowfakeryDataGenerationCallback);

        });

        return snowfakeryJsonResult;

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
    
}