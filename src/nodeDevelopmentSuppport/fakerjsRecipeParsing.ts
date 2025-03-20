import * as fs from 'fs';
import yaml from 'js-yaml';
import { faker } from '@faker-js/faker';

// Helper functions for generating random values
const getRandomChoice = (...options: string[]) => options[Math.floor(Math.random() * options.length)];
const getRandomNumber = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Evaluates expressions within `${{ ... }}` dynamically using Faker.js and helper functions.
 */
const evaluateExpression = (expression: string): string => {
    return expression.replace(/\${{(.*?)}}/g, (_, code) => {
        try {
            return eval(code.trim()); // Executes the dynamic code
        } catch (error) {
            console.error(`Error evaluating: ${code}`, error);
            return `ERROR`;
        }
    });
};

/**
 * Reads the YAML file and processes each entry by replacing placeholder values with fake data.
 */
const generateFakeDataFromYaml = (filePath: string): any[] => {
    const yamlContent = fs.readFileSync(filePath, 'utf8'); // Read the YAML file
    const parsedData = yaml.load(yamlContent) as any[]; // Parse YAML into JavaScript objects

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
                populatedFields[fieldName] = evaluateExpression(fieldExpression as string);
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
const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
const fakeData = generateFakeDataFromYaml(fileToProcess); // Replace with your YAML file path
console.log(JSON.stringify(fakeData, null, 2));
