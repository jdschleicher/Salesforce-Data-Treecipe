
import { IFakerRecipeProcessor } from '../treecipe/src/FakerRecipeProcessor/IFakerRecipeProcessor';
import { ConfigurationService } from '../treecipe/src/ConfigurationService/ConfigurationService';
import { FakerJSRecipeProcessor } from '../treecipe/src/FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';

const { faker } = require('@faker-js/faker');

// const test  = faker.color.human();



// Execute the function and display the results
const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06-fakerjs.yaml';
let fakerRecipeProcessor = new FakerJSRecipeProcessor();
const fakerJsonResult:any = Promise.resolve(fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(fileToProcess) as any);

// console.log(JSON.stringify(fakeData, null, 2));
// "${{ faker.helpers.arrayElement(['chorizo','pork','steak','tofu']).join(';') }}"

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// npx ts-node fileToProcess

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// const yamlContent = fs.readFileSync(fileToProcess, 'utf8'); // Read the YAML file
// // const parsedData = yaml.load(yamlContent) as any[]; 
// const parsedData = yaml.load(yamlContent);