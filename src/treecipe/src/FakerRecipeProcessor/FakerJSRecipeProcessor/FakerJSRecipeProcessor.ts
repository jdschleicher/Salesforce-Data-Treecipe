import { exec } from 'child_process';

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';


export class FakerJSRecipeProcessor implements IFakerRecipeProcessor {

    static baseFakerJSInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';

   async isRecipeProcessorSetup(): Promise<boolean> {

        const theValue:boolean = true;
        return Promise.resolve(theValue);

    }

    // static async runSnowfakeryFakeDataGenerationBySelectedRecipeFile(fullRecipeFileNamePath: string) {
    async generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        // const snowfakeryJsonResult = await new Promise((resolve, reject) => {

        //     const generateCommand = `snowfakery ${ fullRecipeFileNamePath } --output-format json`;
        //     const handleSnowfakeryDataGenerationCallback = (cliCommandError, snowfakeryCliJson) => {

        //         if (cliCommandError) {
                    
        //             const snowfakeryError = new Error(`${this.baseFakerJSInstallationErrorMessage}: ${cliCommandError.message}`);
        //             reject(snowfakeryError);

        //         } else {

        //             /*
        //              IF NO ERROR THEN stdout CONTAINS THE VERSION INFORMATION 
        //              AND WE CAN RETURN SNOWFAKERY JSON
        //              */
        //             resolve(snowfakeryCliJson);

        //         }

        //     };

        //     // perform CLI snowfakery command
        //     exec(generateCommand, handleSnowfakeryDataGenerationCallback);

        // });

        return '';

    }

    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiJsonStructure>();

        const snowfakeryRecords = JSON.parse(fakerContent);

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

                const objectApiToRecords:CollectionsApiJsonStructure = {
                    allOrNone: true,
                    records: [sobjectGeneratedDetail] 
                };

                objectApiToGeneratedRecords.set(objectApiName, objectApiToRecords);

            }

        });

        return objectApiToGeneratedRecords;

    
    }

    
}