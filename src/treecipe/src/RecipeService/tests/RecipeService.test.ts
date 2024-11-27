import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import { RecipeMockService } from "./mocks/RecipeMockService";
import { NPMFakerService } from "../../FakerService/NPMFakerService/NPMFakerService";

// USED TO WRITE COMPARE FILES WHEN DEVELOPING TESTS
// import * as fs from 'fs';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    }
  }), { virtual: true });



describe('getRecipeFakeValueByXMLFieldDetail', () => {

    const iFakerService = NPMFakerService;
    let recipeService = new RecipeService(iFakerService);   
    

    test('given invalid or not yet handled field type, logs message and returns "FieldType Not Handled Value', () => {

        const fakeFieldTypeValue = "heyooo";
        let fakeXMLFieldDetail: XMLFieldDetail = {
            fieldType: fakeFieldTypeValue,
            apiName: "Fake__c",
            fieldLabel: "Fake"
        };
        const expectedRecipeValue = `"FieldType Not Handled -- ${fakeFieldTypeValue} does not exist in this programs Salesforce field map."`;
        const actualRecipeValue = recipeService.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail);
        expect(expectedRecipeValue).toBe(actualRecipeValue);
    });

    test('given expected Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
        const expectedPicklistSnowfakeryValue = "${{ random_choice('cle','eastlake','madison','mentor','wickliffe','willoughby') }}";
        const actualPicklistSnowfakeryValue = recipeService.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail);

        expect(actualPicklistSnowfakeryValue).toBe(expectedPicklistSnowfakeryValue);

    });

    test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
        const expectedMultiSelectPicklistSnowfakeryValue = "${{ (';').join((fake.random_sample(elements=('chicken','chorizo','egg','fish','pork','steak','tofu')))) }}";
        const actualMultiSelectPicklistSnowfakeryValue = recipeService.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail);

        expect(actualMultiSelectPicklistSnowfakeryValue).toBe(expectedMultiSelectPicklistSnowfakeryValue);

    });

    test('given expected Dependent Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedDependentPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getDependentPicklistXMLFieldDetail();
        const expectedDependentPicklistSnowfakeryValue = 
`\n${recipeService.generateTabs(1.5)}if:
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'cle' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    - rocks
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'eastlake' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'madison' }}
            pick:
                random_choice:
                    - tree
                    - plant
                    - weed
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'willoughby' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'mentor' }}
            pick:
                random_choice:
                    - plant
                    - weed
        - choice:
            when: ${recipeService.openingRecipeSyntax} Picklist__c == 'wickliffe' }}
            pick:
                random_choice:
                    - weed
                    - rocks`;
        const actualDependentPicklistSnowfakeryValue = recipeService.getRecipeFakeValueByXMLFieldDetail(expectedDependentPicklistXMLFieldDetail);

        // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
        // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
        // fs.writeFileSync("test.yaml", actualDependentPicklistSnowfakeryValue, { encoding: 'utf8' });
        // fs.writeFileSync("test2.yaml", expectedDependentPicklistSnowfakeryValue, { encoding: 'utf8' });

        expect(actualDependentPicklistSnowfakeryValue).toBe(expectedDependentPicklistSnowfakeryValue);

    });

});

describe('initiateRecipeByObjectName', () => {

    test('given object api name, the expected initiation recipe properties are returned in a string', () => {

        const objectApiName = "Account";
        const expectedRecipeInitiation = 
`\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:`;

        const actualRecipeInitiation = recipeService.initiateRecipeByObjectName(objectApiName);
        expect(actualRecipeInitiation).toBe(expectedRecipeInitiation);

    });

});

describe('appendFieldRecipeToObjectRecipe', () => {

    test('given existing object recipe string and new recipe value, the resulting updated recipe is returned', () => {

        const initialMarkup = RecipeMockService.getSnowfakeryExpectedEvertyingExampleFullObjectRecipeMarkup();
        const fakeRecipevalue = "${{fake.superduperfakeFirstName}}";
        const fakeFieldApiName = "FirstName__c";
        const fakeFieldRecipeValue = `${fakeFieldApiName}: ${fakeRecipevalue}`;
        const expectedUpdateRecipe = 
`${initialMarkup}
${recipeService.generateTabs(1)}${fakeFieldRecipeValue}`;

        const actualUpdatedRecipe = recipeService.appendFieldRecipeToObjectRecipe(initialMarkup, fakeRecipevalue, fakeFieldApiName );

        // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
        // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
        // fs.writeFileSync("appendFieldActual.yaml", actualUpdatedRecipe, { encoding: 'utf8' }); 
        // fs.writeFileSync("appendFieldExpected.yaml", expectedUpdateRecipe, { encoding: 'utf8' });

        expect(actualUpdatedRecipe).toBe(expectedUpdateRecipe);
    });

    test('given existing object recipe with existing fields already appended, a new field property and recipe is added correctly', () => {

        const initialMarkup = RecipeMockService.getFakeInitialObjectRecipeMarkup();
        const firstFakeRecipevalue = "${{fake.superduperfakeFirstName}}";
        const firstFakeFieldApiName = "FirstName__c";
        const firstFakeFieldRecipeValue = `${firstFakeFieldApiName}: ${firstFakeRecipevalue}`;
        const secondFakeRecipeValue = "${{fake.asthefirstbutbetter}}";
        const secondFakeFieldApiName = "SecondLastName__c";
        const secondFakeFieldRecipeValue = `${secondFakeFieldApiName}: ${secondFakeRecipeValue}`;

        
        const expectedUpdateRecipe = 
`${initialMarkup}
${recipeService.generateTabs(1)}${firstFakeFieldRecipeValue}
${recipeService.generateTabs(1)}${secondFakeFieldRecipeValue}`;

        const firstUpdatedRecipe = recipeService.appendFieldRecipeToObjectRecipe(initialMarkup, firstFakeRecipevalue, firstFakeFieldApiName );
        const secondUpdatedRecipe = recipeService.appendFieldRecipeToObjectRecipe(firstUpdatedRecipe, secondFakeRecipeValue, secondFakeFieldApiName );

        // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
        // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
        // fs.writeFileSync("appendFieldActual.yaml", secondUpdatedRecipe, { encoding: 'utf8' }); 
        // fs.writeFileSync("appendFieldExpected.yaml", expectedUpdateRecipe, { encoding: 'utf8' });

        expect(secondUpdatedRecipe).toBe(expectedUpdateRecipe);
    });

});
