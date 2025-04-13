import * as fs from 'fs';
import * as yaml from 'js-yaml';

const { faker } = require('@faker-js/faker');

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';

export class FakerJSRecipeProcessor implements IFakerRecipeProcessor {

    static baseFakerJSInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static regExpressionForSurroundingFakerJSSyntax = /"\${{(.*?)}}"/g;
    
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
    
                generatedData.push({
                    id: (i+1),
                    object: objectType,
                    nickname: nickname,
                    fields: fieldApiNameByFakerJSEvaluations,
                });
            }

        };
    
        const jsonGeneratedData = JSON.stringify(generatedData, null, 2);
        return jsonGeneratedData;
    }

    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiJsonStructure>();

        const fakerJSRecords = JSON.parse(fakerContent);
        fakerJSRecords.forEach(record => {

            const objectApiName = record.object;
            const recordTrackingReferenceId = `${objectApiName}_Reference_${record.id}`;
            const sobjectGeneratedDetail = {
                attributes: {
                    type: objectApiName,
                    referenceId: recordTrackingReferenceId
                },
                ...record.fields
            };
          
            // remove unneeded properties
            delete sobjectGeneratedDetail.object;
            delete sobjectGeneratedDetail.id;
            delete sobjectGeneratedDetail.nickname;

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
    
                const evaluatedRandomChoiceFromAvailablePicklistDependencyOptions = this.evaluateDependentPicklistFakerJSExpression(fakerJSExpression, fieldApiNameByFakerJSEvaluations, fieldApiNameToEvaluate);
                return evaluatedRandomChoiceFromAvailablePicklistDependencyOptions;

        }
    
        const generatedFakerJSExpressionToFakeValue = await this.getFakeValueFromFakerJSExpression(fakerJSExpression);

        return generatedFakerJSExpressionToFakeValue;

    }

    evaluateDependentPicklistFakerJSExpression(dependentPicklistfakerJSExpressionDetail:any,  
                                                fieldApiNameByFakerJSEvaluations: Record<string, string>,
                                                fieldApiNameToEvaluate: string): Promise<string> {

        let evaluatedPicklistDependencyOptions;

        const choices = dependentPicklistfakerJSExpressionDetail.if;

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
            evaluatedPicklistDependencyOptions = faker.helpers.arrayElement(availablePicklistOptions);

        } else {

            throw new Error(`FakerJSRecipeProcessor: Expected processed and matching value 
                of controlling picklist field: ${expectedExistingControllingFieldApiNameForDependentPicklist}
                , no existing matching value for dependent picklist ${fieldApiNameToEvaluate}`);
            // may need to move controlling field up in object detail as its not in map yet

        }

        return evaluatedPicklistDependencyOptions;

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

        const regexExpressionForFakerSyntaxBookEnds = FakerJSRecipeProcessor.regExpressionForSurroundingFakerJSSyntax;

        const expressionSyntaxMatches = [...fakerJSExpression.matchAll(regexExpressionForFakerSyntaxBookEnds)];

        if (expressionSyntaxMatches.length === 0) {
            // if no expected faker-js expression syntax, field value may be hard coded string or special value like object nickname or record type api name
            return fakerJSExpression;
        }

        let originalExpressionCopyForFakerEvalReplacements = fakerJSExpression;

        for (let i = expressionSyntaxMatches.length - 1; i >= 0; i--) {
            
            const expressionMatch = expressionSyntaxMatches[i];
            const [fullIndexMatch, fakerJSCode] = expressionMatch;

            const matchIndex = expressionMatch.index; 
            const matchCharactersLength = fullIndexMatch.length;
            const trimmedFakerJSCode = fakerJSCode.trim();
            
            const fakerEvalExpressionResult = this.getFakerJSExpressionEvaluation(trimmedFakerJSCode);
            
            originalExpressionCopyForFakerEvalReplacements = originalExpressionCopyForFakerEvalReplacements.substring(0, matchIndex) + 
                                                                fakerEvalExpressionResult + 
                                                                originalExpressionCopyForFakerEvalReplacements.substring(matchIndex + matchCharactersLength);
        
        }

        return originalExpressionCopyForFakerEvalReplacements;

    }

    getFakerJSExpressionEvaluation(trimmedFakerJSCode) {

        let fakerEvalExpressionResult;
            
        try {

            const preparedCode = this.prepareFakerDateSyntax(trimmedFakerJSCode);
            
            const evaluationFunction = new Function(
                'faker',
                'dateUtils',
                `return (${preparedCode})`
            );
            
            // Execute the function with all necessary dependencies
            fakerEvalExpressionResult = evaluationFunction(
                faker, 
                this.dateUtils
            );
            
        } catch (error) {
            throw new Error(`getFakeValueFromFakerJSExpression: Error evaluating expression: ${trimmedFakerJSCode}`);
        }

        return fakerEvalExpressionResult;  

    }

    prepareFakerDateSyntax(originalCode) {

        const {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex
        } = this.createComposableRegex();

        let modifiedCode = originalCode;

        // Replace date_between
        modifiedCode = modifiedCode.replace(
            dateBetweenRegex, 
            (match, fromValue, toValue) => {
            console.log('Date Between Match:', { match, fromValue, toValue });
            return `dateUtils.date_between({from: '${fromValue}', to: '${toValue}'})`;
            }
        );

        // Replace datetime_between
        modifiedCode = modifiedCode.replace(
            datetimeBetweenRegex, 
            (match, fromValue, toValue) => {
            console.log('Datetime Between Match:', { match, fromValue, toValue });
            return `dateUtils.datetime_between({from: '${fromValue}', to: '${toValue}'})`;
            }
        );

        // Replace date
        modifiedCode = modifiedCode.replace(
            dateRegex, 
            (match, inputValue) => {
            console.log('Date Match:', { match, inputValue });
            return `dateUtils.date('${inputValue}')`;
            }
        );

        // Replace datetime
        modifiedCode = modifiedCode.replace(
            datetimeRegex, 
            (match, inputValue) => {
            console.log('Datetime Match:', { match, inputValue });
            return `dateUtils.datetime('${inputValue}')`;
            }
        );

        return modifiedCode;

    }

    dateUtils = {
        // Date generation functions
        date(input) {
          const parsedInput = this.parseRelativeDate(input);
          
          if (parsedInput instanceof Date) {
            return parsedInput.toISOString().split('T')[0];
          }
          
          return parsedInput;
        },
        
        datetime(input) {
          return this.parseRelativeDate(input, true);
        },
      
        // Date range generation functions
        date_between({ from, to }) {
          return faker.date.between({
            from: this.parseRelativeDate(from),
            to: this.parseRelativeDate(to)
          });
        },
      
        datetime_between({ from, to }) {
          return faker.date.between({
            from: this.parseRelativeDate(from, true),
            to: this.parseRelativeDate(to, true)
          });
        },

        parseRelativeDate(dateStr, isDateTime = false) {
       
            // If it's already a valid JavaScript date expression, return as-is
            if (!dateStr || typeof dateStr === 'object' || /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
                return dateStr;
            }
            
            // Trim whitespace
            dateStr = dateStr.trim();
            
            // Check for special keywords
            if (dateStr.toLowerCase() === 'today') {
                return new Date();
            }
            
            // Handle relative date syntax
            const matches = dateStr.match(/^([+-])(\d+)$/);
            if (matches) {
                const [, sign, days] = matches;
                const date = new Date();
                
                // Adjust the date based on the sign
                if (sign === '+') {
                    date.setDate(date.getDate() + parseInt(days));
                } else {
                    date.setDate(date.getDate() - parseInt(days));
                }
            
                return isDateTime ? date : date.toISOString().split('T')[0];
            }
            
            // If no special syntax is found, return the original input
            return dateStr;
    
        }

    };
      
    createComposableRegex() {

        // Whitespace handling
        const OPTIONAL_WHITESPACE = '\\s*';
        
        // Quote handling
        const OPTIONAL_QUOTE = '[\'\""]?';
        
        // Value capture (supports relative dates, 'today', and hardcoded dates)
        const VALUE_CAPTURE = "([^'\"},]+)";
        
        // Function name patterns
        const DATE_BETWEEN_NAME = 'date_between';
        const DATETIME_BETWEEN_NAME = 'datetime_between';
        const DATE_NAME = 'date';
        const DATETIME_NAME = 'datetime';
        
        // Literal regex components
        const OPENING_PARENTHESIS = '\\(';
        const CLOSING_PARENTHESIS = '\\)';
        const OPENING_BRACE = '\\{';
        const CLOSING_BRACE = '\\}';
        
        // Parameter name components
        const FROM_PARAM = 'from:';
        const TO_PARAM = 'to:';
        
        // Composable regex for each function type
        const dateBetweenRegex = new RegExp(
          `${DATE_BETWEEN_NAME}${OPENING_PARENTHESIS}` +
          `${OPENING_BRACE}` +
          `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeBetweenRegex = new RegExp(
          `${DATETIME_BETWEEN_NAME}${OPENING_PARENTHESIS}` +
          `${OPENING_BRACE}` +
            `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const dateRegex = new RegExp(
          `${DATE_NAME}${OPENING_PARENTHESIS}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeRegex = new RegExp(
          `${DATETIME_NAME}${OPENING_PARENTHESIS}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        return {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex
        };
      
    }

}



