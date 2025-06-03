import * as fs from 'fs';
import * as yaml from 'js-yaml';

import { faker } from '@faker-js/faker';

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { ProcessedYamlWrapper } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/ProcessedYamlWrapper';

export class FakerJSRecipeProcessor implements IFakerRecipeProcessor {

    static baseFakerJSInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static regExpressionForSurroundingFakerJSSyntax = /\${{(.*?)}}/g;
    
    async generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const yamlContent = fs.readFileSync(fullRecipeFileNamePath, 'utf8'); // Read the YAML file
        const parsedData = yaml.load(yamlContent) as any[]; 
    
        let processedYamlWrapper:ProcessedYamlWrapper = {
            ObjectPropertyToExistingProcessedYaml: {},
            VariablePropertyToExistingProcessedYaml: {}
        };
    
        for (const entry of parsedData) {

            const objectType = entry.object;
            const variableName = entry.var;
            
            if ( objectType !== undefined && variableName === undefined ) {
                // handle object type declaration 
                // this function evaluates directly to generated data because it loops over fieleds that get pushed to generated data - could be refactored
                processedYamlWrapper = await this.processObjectDeclarationForYamlDocumentItem(objectType, entry, processedYamlWrapper);

            } else if ( variableName !== undefined && objectType === undefined ) {

                // handle variable type declaraition
                const variableFakerJSVariableEvaluation = await this.processVariableDeclarationForYamlDocumentItem(entry, processedYamlWrapper);
                processedYamlWrapper.VariablePropertyToExistingProcessedYaml[variableName] = variableFakerJSVariableEvaluation;

            } else {

                // do nothing as there could be yaml used for somethign else like adding context to the recipe file

            }

        };
    
        const parsedObjectValuesOnly = Object.values(processedYamlWrapper.ObjectPropertyToExistingProcessedYaml).flat();
        const jsonGeneratedData = JSON.stringify(parsedObjectValuesOnly, null, 2);
        return jsonGeneratedData;

    }

    async processObjectDeclarationForYamlDocumentItem(objectType: string, 
                                                        objectYamlEntry: any, 
                                                        processedYamlWrapper: ProcessedYamlWrapper) {
        
        const nickname = objectYamlEntry.nickname;
        const count = objectYamlEntry.count || 1; // Default to 1 if count isn't provided
        const fieldsTemplate = objectYamlEntry.fields;

        for (let i = 0; i < count; i++) {

            let fieldApiNameByFakerJSEvaluations: Record<string, string> = {};
            for (const [yamlFieldName, yamlFieldValue] of Object.entries(fieldsTemplate)) {

                try {

                    fieldApiNameByFakerJSEvaluations[yamlFieldName] = await this.evaluateProvidedYamlPropertyValue(yamlFieldValue, 
                                                                                                                    fieldApiNameByFakerJSEvaluations, 
                                                                                                                    yamlFieldName,
                                                                                                                    processedYamlWrapper);
                
                } catch (error) {
                    
                    const executedCommand = "FakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile";
                    const customErrorMessage = `Error evaluating faker-js expression syntax << ${yamlFieldName} - ${ yamlFieldValue } >> - ${error.message}`;
                    
                    const customFakerJSEvaluationError = new Error();
                    customFakerJSEvaluationError.message = customErrorMessage;
            
                    customFakerJSEvaluationError.name = "FakerJSExpressionEvaluationError";
                    customFakerJSEvaluationError.stack = error.stack;
            
                    customFakerJSEvaluationError.cause = error.message;
            
                    ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile(customFakerJSEvaluationError, executedCommand);
                    
                    throw customFakerJSEvaluationError;
                                
                }
                
            }

            const newFieldConfigurationToObject = {
                id: (i+1),
                object: objectType,
                nickname: nickname,
                fields: fieldApiNameByFakerJSEvaluations,
            };

            if ( processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType] === undefined ) {
            
                processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType] = [ newFieldConfigurationToObject ];

            } else {
                
                processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType].push(newFieldConfigurationToObject);
            
            }

         

        }

        return processedYamlWrapper;
    }

    async processVariableDeclarationForYamlDocumentItem(varYamlEntry: any, processedYamlData: any) {
        
        let fakerJSVariableEvaluation:any;
    
        try {

            let emptyFieldToPropertyEvaluations:Record<string, string> = null;
            fakerJSVariableEvaluation = await this.evaluateProvidedYamlPropertyValue(varYamlEntry.value, 
                                                                                        emptyFieldToPropertyEvaluations, 
                                                                                        varYamlEntry.name,
                                                                                        processedYamlData);

        } catch (error) {
            
            const executedCommand = "FakerJSRecipeProcessor.processVariableDeclarationForYamlDocumentItem";
            const customErrorMessage = `Error evaluating faker-js expression syntax << ${varYamlEntry.var} - ${ varYamlEntry.value } >> - ${error.message}`;
            
            const customFakerJSEvaluationError = new Error();
            customFakerJSEvaluationError.message = customErrorMessage;
    
            customFakerJSEvaluationError.name = "FakerJSExpressionEvaluationError";
            customFakerJSEvaluationError.stack = error.stack;
    
            customFakerJSEvaluationError.cause = error.message;
    
            ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile(customFakerJSEvaluationError, executedCommand);
            
            throw customFakerJSEvaluationError;
                        
        }

        return fakerJSVariableEvaluation;

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

    async evaluateProvidedYamlPropertyValue(providedYamlPropertyValue: any, 
                                    fieldApiNameByFakerJSEvaluations: Record<string, string>,
                                    yamlPropertyFieldApiNameToEvaluate: string,
                                    alreadyProcessedYamlWrapper: ProcessedYamlWrapper): Promise<string> {

        
        let processedYamlPropertyValue = null;

        const fakerJSExpressionStartIndicator = "${{";
        const fakerJSExpressionStopIndicator = "${{";
        const containsExpressionSyntax = (typeof providedYamlPropertyValue === 'string' 
                                        && providedYamlPropertyValue.includes(fakerJSExpressionStartIndicator) 
                                        && providedYamlPropertyValue.includes(fakerJSExpressionStopIndicator) );

        if ( containsExpressionSyntax ) {
            
            processedYamlPropertyValue = await this.getFakeValueFromFakerJSExpression(providedYamlPropertyValue, alreadyProcessedYamlWrapper.VariablePropertyToExistingProcessedYaml);

        } else {

            processedYamlPropertyValue = this.handleNonFakerJSExpressionSyntaxValueScenarios(providedYamlPropertyValue, 
                                                                                                fieldApiNameByFakerJSEvaluations, 
                                                                                                yamlPropertyFieldApiNameToEvaluate);
        
        }

        return processedYamlPropertyValue;

    }

    getVariableValueFromExistingProcessedYamlProperties(variableToAlreadyEvaluatedValueReferenceMap: Record<string, any>, variableNameFromExpression) {

        let yamlValueFromVariable = null;

        const fromPreviousGenerated = variableToAlreadyEvaluatedValueReferenceMap[variableNameFromExpression];
        if ( fromPreviousGenerated !== undefined ) {
            yamlValueFromVariable = fromPreviousGenerated;
        } else {
            const missingVariableKeyReferenceTodoMessage = "### TODO : THIS VARIABLE SETTING IS MADE BEFORE THE ACTUAL VARIABLE OBJECT. MOVE THE VARIABLE DELCARATION '- var: vaiable name ' ABOVE THIS SECTION OF THE RECIPE";
            yamlValueFromVariable = missingVariableKeyReferenceTodoMessage;
        }

        return yamlValueFromVariable;

    }

    extractVariableNameFromExpressionSyntax(input: string): string {
        const pattern = /\bvar\.([a-zA-Z_][a-zA-Z0-9_]*)\b/;
        const match = input.match(pattern);
        return match ? match[1] : null;

    }


    handleNonFakerJSExpressionSyntaxValueScenarios(providedYamlPropertyValue: any,
                                                    fieldApiNameByFakerJSEvaluations,
                                                    yamlPropertyFieldApiNameToEvaluate): any {

        let evaluatedYamlPropertyValue = null;
        const dependentPicklistKeyIndicator = "if";
        if ( (typeof providedYamlPropertyValue !== 'string') 
                && (dependentPicklistKeyIndicator in providedYamlPropertyValue) 
                && Object.keys(providedYamlPropertyValue).length === 1 ) {
    
                const evaluatedRandomChoiceFromAvailablePicklistDependencyOptions = this.evaluateDependentPicklistFakerJSExpression(providedYamlPropertyValue, 
                                                                                                                                    fieldApiNameByFakerJSEvaluations, 
                                                                                                                                    yamlPropertyFieldApiNameToEvaluate);
                evaluatedYamlPropertyValue = evaluatedRandomChoiceFromAvailablePicklistDependencyOptions;

        } else {

            /*
                if no expected faker-js expression syntax, 
                field value may be hard coded string or special value 
                like object nickname or record type api name
             */

            evaluatedYamlPropertyValue = providedYamlPropertyValue;
        }

        return evaluatedYamlPropertyValue;

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
            throw new Error('Incorrect format for dependent picklist faker value. Should match the following pattern: \"${{ PicklistApiName__c == \'picklistValue\' }}\"');
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

    async getFakeValueFromFakerJSExpression(fakerJSExpression: string, variableToEvaluatedValueReferenceMap): Promise<string> {

        const regexExpressionForFakerSyntaxBookEnds = FakerJSRecipeProcessor.regExpressionForSurroundingFakerJSSyntax;
        const expressionSyntaxMatches = [...fakerJSExpression.matchAll(regexExpressionForFakerSyntaxBookEnds)];

        let originalExpressionCopyForFakerEvalReplacements = fakerJSExpression;

        for (let i = expressionSyntaxMatches.length - 1; i >= 0; i--) {
            
            const expressionMatch = expressionSyntaxMatches[i];
            const [fullIndexMatch, fakerJSCode] = expressionMatch;

            const matchIndex = expressionMatch.index; 
            const matchCharactersLength = fullIndexMatch.length;
            const trimmedFakerJSCode = fakerJSCode.trim();

            let processedYamlPropertyValueFromExpression = null;
            const variableNameFromExpressionSyntax = this.extractVariableNameFromExpressionSyntax(trimmedFakerJSCode);
            if ( variableNameFromExpressionSyntax !== null ) {

                processedYamlPropertyValueFromExpression = this.getVariableValueFromExistingProcessedYamlProperties(variableToEvaluatedValueReferenceMap, variableNameFromExpressionSyntax);

            } else {

                processedYamlPropertyValueFromExpression = this.getFakerJSExpressionEvaluation(trimmedFakerJSCode);

            }         

            
            
            originalExpressionCopyForFakerEvalReplacements = originalExpressionCopyForFakerEvalReplacements.substring(0, matchIndex) + 
                                                                processedYamlPropertyValueFromExpression + 
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
            throw new Error(`getFakeValueFromFakerJSExpression: Error evaluating expression: ${trimmedFakerJSCode} - ${error.message}`);
        }

        return fakerEvalExpressionResult;  

    }

    prepareFakerDateSyntax(originalCode) {

        const {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex,
            matchingCustomFunctionRegex
        } = this.getExpectedDateRegExPatterns();

        let modifiedCode = originalCode;

        // Replace date_between
        modifiedCode = modifiedCode.replace(dateBetweenRegex, (match, fromValue, toValue) => {

            console.log('Date Between Match:', { match, fromValue, toValue });
            return `dateUtils.date_between({from: '${fromValue}', to: '${toValue}'})`;

        });

        // Replace datetime_between
        modifiedCode = modifiedCode.replace(datetimeBetweenRegex, (match, fromValue, toValue) => {

            console.log('Datetime Between Match:', { match, fromValue, toValue });
            return `dateUtils.datetime_between({from: '${fromValue}', to: '${toValue}'})`;

        });

        // Replace date
        modifiedCode = modifiedCode.replace(dateRegex, (match, inputValue) => {

            console.log('Date Match:', { match, inputValue });
            return `dateUtils.date('${inputValue}')`;
        
        });

        // Replace datetime
        modifiedCode = modifiedCode.replace(datetimeRegex, (match, inputValue) => {

            console.log('Datetime Match:', { match, inputValue });
            return `dateUtils.datetime('${inputValue}')`;

        });

        return modifiedCode;

    }

    // THESE DATE UTILS ARE LEVERAGED AS PART OF THE prepareFakerDateSyntax FUNCTION
    dateUtils = {
        
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
            const fromResult = this.parseRelativeDate(from);
            const toResult = this.parseRelativeDate(to);

            const fakerDate = faker.date.between({
                from: fromResult,
                to: toResult
            }).toISOString().split('T')[0];

            console.log('date_between fakerDate:', fakerDate);

            return fakerDate;
        },
      
        datetime_between({ from, to }) {

            const fromResult = this.parseRelativeDate(from, true);
            const toResult = this.parseRelativeDate(to, true);

            const fakerDate = faker.date.between({
                from: fromResult,
                to: toResult
            }).toISOString();

            console.log('datetime_between fakerDate:', fakerDate);
            return fakerDate;
        },

        parseRelativeDate(dateArgument, isDateTime = false) {
       
            // Trim whitespace
            dateArgument = dateArgument.trim();

            // If it's already a valid JavaScript date expression, return as-is
            const startOfLine = '^';
            const optionalWhitespaceStart = '\\s*';
            const optionalOpeningQuote = "['\"]?";  // matches ' or "
            const datePattern = '\\d{4}-\\d{2}-\\d{2}';  // yyyy-mm-dd
            const optionalClosingQuote = "['\"]?";
            const optionalWhitespaceEnd = '\\s*';
            const endOfLine = '$';
            const combinedDateRegexPattern = startOfLine 
                                                + optionalWhitespaceStart 
                                                + optionalOpeningQuote 
                                                + datePattern 
                                                + optionalClosingQuote 
                                                + optionalWhitespaceEnd 
                                                + endOfLine;

            const dateYYYYMMDDRegexPattern = new RegExp(combinedDateRegexPattern);
            if (!dateArgument 
                || typeof dateArgument === 'object' 
                || dateYYYYMMDDRegexPattern.test(dateArgument)) {

                return dateArgument;

            }
            
            // Check for special keywords
            if (dateArgument.toLowerCase() === 'today') {
                const todaysDate = new Date();
                const todaysDateFormatted = (isDateTime)
                                        ? todaysDate.toISOString() 
                                        : todaysDate.toISOString().split('T')[0];
                return todaysDateFormatted;
            }
            
            // Handle relative date syntax
            const expectedSyntaxForDayIncreaseOrDecreaseRegexMatch = /^([+-])(\d+)$/;
            const matches = dateArgument.match(expectedSyntaxForDayIncreaseOrDecreaseRegexMatch);
            if (matches) {
                const [, sign, days] = matches;
                const date = new Date();
                
                // Adjust the date based on the sign
                const daysToShift = parseInt(days);
   
                if (sign === '+') {
                    date.setDate(date.getDate() + daysToShift);
                } else {
                    date.setDate(date.getDate() - daysToShift);
                }

                const minSalesforceDate = new Date('0001-01-01T00:00:00.000Z');
                const maxSalesforceDate = new Date('9999-12-31T23:59:59.999Z');

                const isWithinSalesforceDateRange = (date.getTime() >= minSalesforceDate.getTime() 
                                                        && date.getTime() <= maxSalesforceDate.getTime());

                if (!isWithinSalesforceDateRange) {
                    throw new Error(`Shifted date "${sign}${days}" is outside the valid Salesforce date range. minimum date is 0001-01-01 and maximum date is 9999-12-31.`);
                }

                const formattedDate = isDateTime ? 
                                        date.toISOString() 
                                        : date.toISOString().split('T')[0];

                console.log('formattedDate:', formattedDate);
                return formattedDate;
            }
            
            // If no special syntax is found, return the original input
            const dateArgumentTodoSyntax = `${dateArgument} ### TODO: THIS MAY NOT BE A VALID DATE VALUE`;
            return dateArgumentTodoSyntax;
    
        }

    };
      
    getExpectedDateRegExPatterns() {

        // Whitespace handling
        const OPTIONAL_WHITESPACE = '\\s*';
        
        // Quote handling
        const OPTIONAL_QUOTE = '[\'\""]?';
        
        // Value capture (supports relative dates, 'today', and hardcoded dates)
        const VALUE_CAPTURE = "([^'\"},]+)";
        
        // Expected "Date" function expression patterns
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
        
        const dateBetweenRegex = new RegExp(
          `${DATE_BETWEEN_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPENING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeBetweenRegex = new RegExp(
          `${DATETIME_BETWEEN_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPENING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const dateRegex = new RegExp(
          `${DATE_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeRegex = new RegExp(
          `${DATETIME_NAME}${OPENING_PARENTHESIS}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );

        // THE BELOW FUNCTION NAMES INCLUDE OPENING PARENTHESIS TO DIFFERENTIATE THEM FROM COMMON USE CASES OF "new Date" AND "faker.date.between"
        const fakerCustomDateMethods = [
            DATETIME_BETWEEN_NAME,
            DATE_BETWEEN_NAME,
            DATE_NAME,
            DATETIME_NAME
        ];

        const OR_OPERATOR_REGEX = '|';
        
        // Create individual name patterns
        const individualMethodNameMatchingPattern = fakerCustomDateMethods.map(name => `${name}${OPENING_PARENTHESIS}`);
        const combinedPatterns = individualMethodNameMatchingPattern.join(OR_OPERATOR_REGEX);
        const matchingCustomFunctionRegex = new RegExp(combinedPatterns);
      
        return {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex,
            matchingCustomFunctionRegex
        };
      
    }

}





