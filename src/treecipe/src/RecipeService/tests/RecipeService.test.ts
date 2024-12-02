import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import { RecipeMockService } from "./mocks/RecipeMockService";
import { SnowfakeryFakerService } from "../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService";
import { IPicklistValue } from "../../ObjectInfoWrapper/FieldInfo";

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


  describe('RecipeService Shared Intstance Tests', () => {

    const snowFakerService = new SnowfakeryFakerService();
    let recipeServiceWithSnow = new RecipeService(snowFakerService);  

    describe('getRecipeFakeValueByXMLFieldDetail', () => {

        test('given invalid or not yet handled field type, logs message and returns "FieldType Not Handled Value', () => {

            const fakeFieldTypeValue = "heyooo";
            let fakeXMLFieldDetail: XMLFieldDetail = {
                fieldType: fakeFieldTypeValue,
                apiName: "Fake__c",
                fieldLabel: "Fake"
            };
            const expectedRecipeValue = `"FieldType Not Handled -- ${fakeFieldTypeValue} does not exist in this programs Salesforce field map."`;
            const actualRecipeValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail);
            expect(expectedRecipeValue).toBe(actualRecipeValue);
        });

        test('given expected Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
            const expectedPicklistSnowfakeryValue = "${{ random_choice('cle','eastlake','madison','mentor','wickliffe','willoughby') }}";
            const actualPicklistSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail);

            expect(actualPicklistSnowfakeryValue).toBe(expectedPicklistSnowfakeryValue);

        });

        test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
            const expectedMultiSelectPicklistSnowfakeryValue = "${{ (';').join((fake.random_sample(elements=('chicken','chorizo','egg','fish','pork','steak','tofu')))) }}";
            const actualMultiSelectPicklistSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail);

            expect(actualMultiSelectPicklistSnowfakeryValue).toBe(expectedMultiSelectPicklistSnowfakeryValue);

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

            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(objectApiName);
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
    ${fakeFieldRecipeValue}`;

            const actualUpdatedRecipe = recipeServiceWithSnow.appendFieldRecipeToObjectRecipe(initialMarkup, fakeRecipevalue, fakeFieldApiName );

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
    ${firstFakeFieldRecipeValue}
    ${secondFakeFieldRecipeValue}`;

            const firstUpdatedRecipe = recipeServiceWithSnow.appendFieldRecipeToObjectRecipe(initialMarkup, firstFakeRecipevalue, firstFakeFieldApiName );
            const secondUpdatedRecipe = recipeServiceWithSnow.appendFieldRecipeToObjectRecipe(firstUpdatedRecipe, secondFakeRecipeValue, secondFakeFieldApiName );

            // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
            // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
            // fs.writeFileSync("appendFieldActual.yaml", secondUpdatedRecipe, { encoding: 'utf8' }); 
            // fs.writeFileSync("appendFieldExpected.yaml", expectedUpdateRecipe, { encoding: 'utf8' });

            expect(secondUpdatedRecipe).toBe(expectedUpdateRecipe);
        });

    });

    describe('getDependentPicklistRecipeFakerValue', () => {

        test('given expected XMLDetail expected controllingvalue to options are built and correct snowfakery fake value is returned', () => {
        
            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    fullName: 'tree',
                    label: 'tree',
                    default: false,
                    availableForControllingValues: ['cle', 'eastlake', 'madison']
                },
                {
                    fullName: 'plant',
                    label: 'plant',
                    default: false,
                    availableForControllingValues: ['madison', 'mentor']
                },
                {
                    fullName: 'weed',
                    label: 'weed',
                    default: false,
                    availableForControllingValues: ['cle', 'mentor', 'wickliffe', 'willoughby']
                }
           
            ];
         
            const expectedXMLFieldDetail:XMLFieldDetail = {
                fieldType : "picklist",
                apiName : "Landscape__c",
                picklistValues : expectedPicklistFieldDetails,
                referenceTo : "",
                fieldLabel : "Landscape Towns",
                controllingField : "Town__c"
            };
 
           

            const expectedDependentListFakeValue = RecipeMockService.getMockSnowfakeryDependentPicklistRecipeValue();
            const actualRecipeValue = recipeServiceWithSnow.getDependentPicklistRecipeFakerValue(expectedXMLFieldDetail);

            expect(actualRecipeValue).toBe(expectedDependentListFakeValue);

        });
    });

});
