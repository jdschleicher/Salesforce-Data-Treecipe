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
    
        for (const entry of parsedData) {

            const objectType = entry.object;
            const nickname = entry.nickname;
            const count = entry.count || 1; // Default to 1 if count isn't provided
            const fieldsTemplate = entry.fields;
    
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

        };
    
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
    
            const choices = fakerJSExpression.if;
    
            const whenIndicatorInYamlExpression = choices.length > 0 ? choices[0].choice.when : '';
            if (!whenIndicatorInYamlExpression) {
                throw new Error('No choices available in the YAML data');
            }
        
            const fieldApiNameInWhenConditionRegex = this.buildWhenConditionRegexMatchForControllingField();
           
            const controllingFieldPicklsitMatch = whenIndicatorInYamlExpression.match(fieldApiNameInWhenConditionRegex);
            if ( !controllingFieldPicklsitMatch ) {
                throw new Error('Incorrect format for dependent picklist faker value. Should match \"${{ Picklist__c == \'cle\' }}\"');
            }
        
            let expectedExistingControllingFieldApiNameForDependentPicklist = controllingFieldPicklsitMatch[1];
            if (!fieldApiNameByFakerJSEvaluations || !fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist]) {
                throw new Error(`Field "${expectedExistingControllingFieldApiNameForDependentPicklist}" not found in existing field evaluations`);
            }
    
            const controllingFieldPicklistValue = fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist];
            const matchingControllingFieldGeneratedValueSection = choices.find(item => {
    
                const controllingFieldWhencondition = item.choice.when;
                const controllingFIeldWhenConditionMatches = controllingFieldWhencondition.match(fieldApiNameInWhenConditionRegex);

                const controllingPicklistValueMatchIndex = 2;
                const controllingFieldValue = controllingFIeldWhenConditionMatches[controllingPicklistValueMatchIndex];
                
                // Remove surrounding quotes from the value for comparison
                const trimmedValue = controllingFieldValue.trim();
                const expectedQuotesAroundPicklistWhenSelection = /['"]/g; 
                const cleanValue = trimmedValue.replace(expectedQuotesAroundPicklistWhenSelection, '');
    
                const availableDependentPicklistChoiceDetailsBasedOnControllingFieldValue = (cleanValue === controllingFieldPicklistValue);
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
                // may need to move controlling field up in object detail as its not in map yet
            }

        }
    
        const generatedFakerJSExpressionToFakeValue = await this.getFakeValueFromFakerJSExpression(fakerJSExpression);
    
        
        return generatedFakerJSExpressionToFakeValue;

    }

    buildWhenConditionRegexMatchForControllingField() {

        const openingExpressionSyntaxLiteral = "\{\\{";
        const whitespaceMatch = "\\s*";
        const allContentBeforeDoubleEqual = "(.*?)";
        const whitespaceFollowingExpectedApiName = "\\s*";
        const doubleEqualsLiteral = "==";
        const allContentAfterDoubleEqual = "(.*?)";
        const closingExpressionSyntaxLiteral = "\}\\}";



        const controllingFieldRegex = new RegExp(openingExpressionSyntaxLiteral 
                                                + whitespaceMatch 
                                                + allContentBeforeDoubleEqual 
                                                + whitespaceFollowingExpectedApiName 
                                                + doubleEqualsLiteral
                                                + allContentAfterDoubleEqual
                                                + closingExpressionSyntaxLiteral); 

        return controllingFieldRegex;

    }   


    async getFakeValueFromFakerJSExpression(fakerJSExpression: string): Promise<string> {

        let fakeEvalExpressionResult: string;
        const regexExpressionForFakerSyntaxBookEnds = /\${{(.*?)}}/g;

        const matches = [...fakerJSExpression.matchAll(regexExpressionForFakerSyntaxBookEnds)];
        if (matches.length > 1) {
            throw new Error(`Expected exactly one faker-js yaml syntax match, but found ${matches.length} matches. Here is the value leading to multiple matches: ${fakerJSExpression}`);
        }

        if (matches.length === 0) {
            // if no expected faker-js expression syntax, field value may be hard coded string or special value like object nickname or record type api name
            return fakerJSExpression;
        }

        const [fullMatch, fakerJSCode] = matches[0];
        const trimmedFakerJSCode = fakerJSCode.trim();

        try {
            
            const fakerInstanceRepresentation = 'faker';
            const evaluationFunction = new Function(fakerInstanceRepresentation, `return (${trimmedFakerJSCode})`);
            fakeEvalExpressionResult = String(evaluationFunction(faker));

        } catch (error) {
            throw new Error(`getFakeValueFromFakerJSExpression: Error evaluating expression: ${trimmedFakerJSCode}`);
        }

        return fakeEvalExpressionResult;

    }

    
}