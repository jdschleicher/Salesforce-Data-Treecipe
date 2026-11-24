jest.mock('vscode', () => ({}), { virtual: true });

import * as yaml from 'js-yaml';
import { RecipeService } from '../RecipeService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';

/*
    #717: every standard object a backend maps is written into a recipe from its built-in values,
    so each one's recipe, as initiateRecipeByObjectName writes it, must load as YAML with every
    mapped field a template value -- a plain scalar holding ": " (faker-js {min: 0, ...}) does not.
*/

type LoadedObjectRecipe = { object: string; fields: Record<string, unknown> };

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
] as const)('every %s standard object recipe written from its built-in values', (unusedBackend, createFakerService: () => IRecipeFakerService) => {

    const recipeService = new RecipeService(createFakerService());
    const standardFieldValuesByObject = recipeService.getOOTBExpectedObjectToFakerValueMappings();

    test.each(Object.keys(standardFieldValuesByObject))('%s loads as YAML, with every mapped field a template value', (objectApiName) => {

        const objectRecipe = recipeService.initiateRecipeByObjectName(objectApiName, {}, standardFieldValuesByObject, undefined);
        const [loadedObjectRecipe] = yaml.load(objectRecipe) as LoadedObjectRecipe[];

        expect(loadedObjectRecipe.object).toBe(objectApiName);
        expect(Object.keys(loadedObjectRecipe.fields)).toEqual(Object.keys(standardFieldValuesByObject[objectApiName]));
        Object.values(loadedObjectRecipe.fields).forEach(loadedFieldValue => {
            expect(String(loadedFieldValue).trim()).toMatch(/^\$\{\{.*\}\}/s);
        });

    });

});
