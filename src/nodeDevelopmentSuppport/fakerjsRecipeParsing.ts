import * as fs from 'fs';
import * as yaml from 'js-yaml';

const { faker } = require('@faker-js/faker');

// const test  = faker.color.human();



// // Helper functions for generating random values
// const getRandomChoice = (...options: string[]) => options[Math.floor(Math.random() * options.length)];
// const getRandomNumber = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Evaluates expressions within `${{ ... }}` dynamically using Faker.js and helper functions.
//  */

function getExistingPicklistValue() {

}

const evaluateExpression = (expression: any, existingFieldEvaluations: Record<string, string>): string => {
    
    const regexExpressionForFakerSyntaxBookEnds = /\${{(.*?)}}/g;

    let evalExpressionResult: string;

    const dependentPicklistKeyIndicator = "if";
    if ( (typeof expression !== 'string') 
            && (dependentPicklistKeyIndicator in expression) 
            && Object.keys(expression).length === 1 ) {

        let picklistValue = '';
        const choices = expression.if;

        const whenYamlExpression = choices.length > 0 ? choices[0].choice.when : '';
        if (!whenYamlExpression) {
            throw new Error('No choices available in the YAML data');
        }
    
        const splitResult = whenYamlExpression.split(' == ');
    
        if (splitResult.length !== 2) {
            throw new Error('Invalid condition format in YAML data');
        }
    
        let expectedExistingFieldApiNameForDependentPicklist = splitResult[0];
    
        if (!existingFieldEvaluations || !existingFieldEvaluations[expectedExistingFieldApiNameForDependentPicklist]) {
            throw new Error(`Field "${expectedExistingFieldApiNameForDependentPicklist}" not found in existing field evaluations`);
        }

        picklistValue = existingFieldEvaluations[expectedExistingFieldApiNameForDependentPicklist];
  
        // Find the matching choice based on the picklistValue
        const matchingChoice = choices.find(item => {

            const condition = item.choice.when;
            const [fieldApiName, fieldValue] = condition.split('==');
            
            // Remove quotes from the value for comparison
            const trimmedValue = fieldValue.trim();
            const expectedQuotesAroundPicklistWhenSelection = /['"]/g; 
            const cleanValue = trimmedValue.replace(expectedQuotesAroundPicklistWhenSelection, '');

            const trimmedFieldApiName = fieldApiName.trim();

            return (trimmedFieldApiName === expectedExistingFieldApiNameForDependentPicklist && cleanValue === picklistValue);

        });
        
        if ( matchingChoice ) {
            const availablePicklistOptions = matchingChoice.choice.pick.random_choice;
            const randomChoiceFromAvailablePicklistDependencyOptions = faker.helpers.arrayElement(availablePicklistOptions);
            return randomChoiceFromAvailablePicklistDependencyOptions;
        } else {
            throw new Error('no matching value for expected picklist');
        }
    }


    const generatedFakerValue = expression.replace(regexExpressionForFakerSyntaxBookEnds, (match, code) => {
        
        console.log(`Processing match: ${match}`);
        const trimmedCode = code.trim();
    
        try {

            const evaluation = eval(trimmedCode);
            console.log(`Evaluation result: ${evaluation}`);
            evalExpressionResult = String(evaluation);

        } catch (error) {
            console.error(`Error evaluating expression: ${trimmedCode}`, error);
            evalExpressionResult = "ERROR";

        }

        return evalExpressionResult;
    
    });
    
    return generatedFakerValue;

};

/**
 * Reads the YAML file and processes each entry by replacing placeholder values with fake data.
 */
const generateFakeDataFromYaml = (fileToProcess: string): any[] => {
    const yamlContent = fs.readFileSync(fileToProcess, 'utf8'); // Read the YAML file
    const parsedData = yaml.load(yamlContent); 

    let generatedData: any[] = [];
    
    parsedData.forEach((entry) => {
        const objectType = entry.object;
        const nickname = entry.nickname;
        const count = entry.count || 1; // Default to 1 if count isn't provided
        const fieldsTemplate = entry.fields; // Field definitions with placeholders

        for (let i = 0; i < count; i++) {
            let populatedFields: Record<string, string> = {};

            // Process each field and replace placeholders with actual values
            for (const [fieldName, fieldExpression] of Object.entries(fieldsTemplate)) {
                populatedFields[fieldName] = evaluateExpression(fieldExpression, populatedFields);
            }

            // Store the generated object with populated fields
            generatedData.push({
                object: objectType,
                nickname: nickname,
                fields: populatedFields,
            });
        }
    });

    return generatedData;
};


// Execute the function and display the results
const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06-fakerjs.yaml';
const fakeData = generateFakeDataFromYaml(fileToProcess); // Replace with your YAML file path
console.log(JSON.stringify(fakeData, null, 2));
// "${{ faker.helpers.arrayElement(['chorizo','pork','steak','tofu']).join(';') }}"

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// npx ts-node fileToProcess

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// const yamlContent = fs.readFileSync(fileToProcess, 'utf8'); // Read the YAML file
// // const parsedData = yaml.load(yamlContent) as any[]; 
// const parsedData = yaml.load(yamlContent);