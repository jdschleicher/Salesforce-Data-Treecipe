import * as fs from 'fs';
import * as yaml from 'js-yaml';

const { faker } = require('@faker-js/faker');

// import { exec } from 'child_process';

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';


export class FakerJSRecipeProcessor implements IFakerRecipeProcessor {

    static baseFakerJSInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';

    async isRecipeProcessorSetup(): Promise<boolean> {

        const theValue:boolean = true;
        return Promise.resolve(theValue);

    }

    async generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const yamlContent = fs.readFileSync(fullRecipeFileNamePath, 'utf8'); // Read the YAML file
        const parsedData = yaml.load(yamlContent) as any[]; 
    
        let generatedData: any[] = [];
    
        parsedData.forEach((entry) => {

            const objectType = entry.object;
            const nickname = entry.nickname;
            const count = entry.count || 1; // Default to 1 if count isn't provided
            const fieldsTemplate = entry.fields; // Field definitions with placeholders
    
            for (let i = 0; i < count; i++) {

                let fieldApiNameByFakerJSEvaluations: Record<string, string> = {};
                for (const [fieldName, fieldExpression] of Object.entries(fieldsTemplate)) {
                    fieldApiNameByFakerJSEvaluations[fieldName] = await this.evaluateFakerJSExpression(fieldExpression, 
                                                                                                        fieldApiNameByFakerJSEvaluations, 
                                                                                                        fieldName);
                }
    
                // Store the generated object with populated fields
                generatedData.push({
                    object: objectType,
                    nickname: nickname,
                    fields: fieldApiNameByFakerJSEvaluations,
                });
            }
        });
    
        const jsonGeneratedData = JSON.stringify(generatedData, null, 2);
        console.log(jsonGeneratedData);

        return jsonGeneratedData;
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

    async evaluateFakerJSExpression(fakerJSExpression: any, 
                                    fieldApiNameByFakerJSEvaluations: Record<string, string>,
                                    fieldApiNameToEvaluate: string): Promise<string> {

    
        const dependentPicklistKeyIndicator = "if";
        if ( (typeof fakerJSExpression !== 'string') 
                && (dependentPicklistKeyIndicator in fakerJSExpression) 
                && Object.keys(fakerJSExpression).length === 1 ) {
    
            let picklistValue = '';
            const choices = fakerJSExpression.if;
    
            const whenIndicatorInYamlExpression = choices.length > 0 ? choices[0].choice.when : '';
            if (!whenIndicatorInYamlExpression) {
                throw new Error('No choices available in the YAML data');
            }
        
            const splitResult = whenIndicatorInYamlExpression.split(' == ');
        
            if (splitResult.length !== 2) {
                throw new Error('Invalid condition format in YAML data');
            }
        
            let expectedExistingControllingFieldApiNameForDependentPicklist = splitResult[0];
            if (!fieldApiNameByFakerJSEvaluations || !fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist]) {
                throw new Error(`Field "${expectedExistingControllingFieldApiNameForDependentPicklist}" not found in existing field evaluations`);
            }
    
            picklistValue = fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist];
      
            const matchingControllingFieldGeneratedValueSection = choices.find(item => {
    
                const condition = item.choice.when;
                const [fieldApiName, fieldValue] = condition.split('==');
                
                // Remove quotes from the value for comparison
                const trimmedValue = fieldValue.trim();
                const expectedQuotesAroundPicklistWhenSelection = /['"]/g; 
                const cleanValue = trimmedValue.replace(expectedQuotesAroundPicklistWhenSelection, '');
    
                const trimmedFieldApiName = fieldApiName.trim();
                const availableDependentPicklistChoiceDetailsBasedOnControllingFieldValue = (trimmedFieldApiName === expectedExistingControllingFieldApiNameForDependentPicklist && cleanValue === picklistValue);
                return availableDependentPicklistChoiceDetailsBasedOnControllingFieldValue;
    
            });
            
            if ( matchingControllingFieldGeneratedValueSection ) {

                const availablePicklistOptions = matchingControllingFieldGeneratedValueSection.choice.pick.random_choice;
                const randomChoiceFromAvailablePicklistDependencyOptions = faker.helpers.arrayElement(availablePicklistOptions);
                return randomChoiceFromAvailablePicklistDependencyOptions;

            } else {

                throw new Error(`FakerJSRecipeProcessor: Expected processed and matching value 
                    of controlling picklist field: ${expectedExistingControllingFieldApiNameForDependentPicklist}
                    , no existing matching value for dependent picklist ${fieldApiNameToEvaluate}`);
            // may need to move controlling field up in object detail
            }

        }
    
        const generatedFakerJSExpressionToFakeValue = await this.getFakeValueFromFakerJSExpression(fakerJSExpression);
    
        
        return generatedFakerJSExpressionToFakeValue;

    }

    async getFakeValueFromFakerJSExpression(fakerJSExpression: string): Promise<string> {

        let fakeEvalExpressionResult: string;
        const regexExpressionForFakerSyntaxBookEnds = /\${{(.*?)}}/g;
        
        // fakerJSExpression.replace(regexExpressionForFakerSyntaxBookEnds, (match, code) => {
            
        //     console.log(`Processing match: ${match}`);
        //     const trimmedCode = code.trim();
        
        //     try {
    
        //         const evaluation = eval(trimmedCode);
        //         console.log(`Evaluation result: ${evaluation}`);
        //         fakeEvalExpressionResult = String(evaluation);
    
        //     } catch (error) {
        //         console.error(`Error evaluating expression: ${trimmedCode}`, error);
        //         fakeEvalExpressionResult = "ERROR";
    
        //     }
    
        //     return fakeEvalExpressionResult;
        
        // });

        const matches = [...fakerJSExpression.matchAll(regexExpressionForFakerSyntaxBookEnds)];
        if (matches.length > 1) {
            throw new Error(`Expected exactly one faker-js yaml syntax match, but found ${matches.length} matches. Here is the value leading to multiple matches: ${fakerJSExpression}`);
        }

        if (matches.length === 0) {
            throw new Error(`getFakeValueFromFakerJSExpression: No match found for expected faker-js surrounding expression syntax: ${fakerJSExpression}`);
        }

        const [fullMatch, fakerJSCode] = matches[0];
        const trimmedFakerJSCode = fakerJSCode.trim();

        try {
            
            const evaluationFunction = new Function(`return (${trimmedFakerJSCode})`)();
            fakeEvalExpressionResult = String(evaluationFunction);

        } catch (error) {
            throw new Error(`getFakeValueFromFakerJSExpression: Error evaluating expression: ${trimmedFakerJSCode}`);
        }

        return fakeEvalExpressionResult;

    }

    
}