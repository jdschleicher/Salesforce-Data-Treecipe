
import { FakerJSRecipeProcessor } from '../treecipe/src/FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';

import { faker } from '@faker-js/faker';

// const test  = faker.color.human();



// Execute the function and display the results
const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06-fakerjs.yaml';
let fakerRecipeProcessor = new FakerJSRecipeProcessor();
// const fakerJsonResult:any = await fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(fileToProcess);
let fakerJsonResult;
(async () => {
    try {
     fakerJsonResult = await fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(fileToProcess);
     console.log(JSON.stringify(fakerJsonResult, null, 2));

    } catch (error) {
      console.error("Error:", error);
    }
  })();
  
// "${{ faker.helpers.arrayElement(['chorizo','pork','steak','tofu']).join(';') }}"

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// npx ts-node fileToProcess

// const fileToProcess = 'extensionDevelopmentScriptsAndArtifacts/treecipe/GeneratedRecipes/recipe-2025-01-03T15-45-06.yaml';
// const yamlContent = fs.readFileSync(fileToProcess, 'utf8'); // Read the YAML file
// // const parsedData = yaml.load(yamlContent) as any[]; 
// const parsedData = yaml.load(yamlContent);