import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import { RecipeMockService } from "./mocks/RecipeMockService";
import { SnowfakeryFakerService } from "../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService";
import { IPicklistValue } from "../../ObjectInfoWrapper/FieldInfo";
import { MockRecordTypeService } from "../../RecordTypeService/tests/MockRecordTypeService";

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
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualRecipeValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);
            expect(expectedRecipeValue).toBe(actualRecipeValue);
        });

        test('given expected Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
            const expectedPicklistSnowfakeryValue = "${{ random_choice('cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby') }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistSnowfakeryValue).toBe(expectedPicklistSnowfakeryValue);

        });

        test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
            const expectedMultiSelectPicklistSnowfakeryValue = "${{ (';').join((fake.random_sample(elements=('chicken', 'chorizo', 'egg', 'fish', 'pork', 'steak', 'tofu')))) }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualMultiSelectPicklistSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualMultiSelectPicklistSnowfakeryValue).toBe(expectedMultiSelectPicklistSnowfakeryValue);

        });

        test('given expected datetime XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedDatetimeXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getDateTimeFieldDetail();
            const expectedDatetimeSnowfakeryValue = '${{fake.date_time_between(start_date="-1y", end_date="now")}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualDatetimeSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedDatetimeXMLFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualDatetimeSnowfakeryValue).toBe(expectedDatetimeSnowfakeryValue);

        });

        test('given expected url XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedUrlFieldDetail:XMLFieldDetail = XMLMarkupMockService.getUrlXMLFieldDetail();
            const expectedUrlSnowfakeryValue = '${{fake.url()}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualUrlSnowfakeryValue = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedUrlFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualUrlSnowfakeryValue).toBe(expectedUrlSnowfakeryValue);

        });

        test('given expected phone XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForPhone:XMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();
            const expectedSnowfakeryValueForPhone = '${{fake.phone_number()}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   
            const actualSnowfakeryValueForPhone = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForPhone, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForPhone).toBe(expectedSnowfakeryValueForPhone);

        });

        test('given expected number XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForNumber:XMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();
            const expectedSnowfakeryValueForNumber = '${{fake.random_int(min=0, max=999999)}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   

            const actualSnowfakeryValueForNumber = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForNumber, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForNumber).toBe(expectedSnowfakeryValueForNumber);

        });

        test('given expected currency XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForCurrency:XMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();
            const expectedSnowfakeryValueForCurrency = '${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualSnowfakeryValueForCurrency = recipeServiceWithSnow.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForCurrency, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForCurrency).toBe(expectedSnowfakeryValueForCurrency);

        });

    });

    describe('initiateRecipeByObjectName', () => {

        test('given object api name and empty recordtype map, the expected initiation recipe properties are returned in a string and RecordTypeId is NOT added to the intial recipe', () => {

            const objectApiName = "Account";
            const expectedRecipeInitiation = 
    `\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:`;

            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(objectApiName, emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap);
            expect(actualRecipeInitiation).toBe(expectedRecipeInitiation);

        });

        test('given object api name and expected mocked recordtype map, the expected initiation recipe properties are returned in a string with an appended RecordTypeId field', () => {

            const objectApiName = "Account";
            const expectedRecipeInitiation = 
    `\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:
    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection
                    OneRecType
                    TwoRecType`;

            const expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(objectApiName, expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap);
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
                    availableForControllingValues: ['cle', 'eastlake', 'madison', 'willoughby']
                },
                {
                    fullName: 'weed',
                    label: 'weed',
                    default: false,
                    availableForControllingValues: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
                },
                {
                    fullName: 'mulch',
                    label: 'mulch',
                    default: false,
                    availableForControllingValues: ['cle', 'eastlake', 'willoughby']
                },
                {
                    fullName: 'rocks',
                    label: 'rocks',
                    default: false,
                    availableForControllingValues: ['cle', 'wickliffe']
                },
                {
                    fullName: 'plant',
                    label: 'plant',
                    default: false,
                    availableForControllingValues: ['madison', 'mentor']
                }
               
            ];
         
            const expectedXMLFieldDetail:XMLFieldDetail = {
                fieldType : "picklist",
                apiName : "DependentPicklist__c",
                picklistValues : expectedPicklistFieldDetails,
                referenceTo : "",
                fieldLabel : "Dependent Picklist",
                controllingField : "Picklist__c"
            };
 
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const expectedDependentListFakeValue = RecipeMockService.getMockSnowfakeryDependentPicklistRecipeValueWithoutRecordTypeDetail();
            const actualRecipeValue = recipeServiceWithSnow.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail, 
                recordTypeNameByRecordTypeNameToXMLMarkup
            );

            expect(actualRecipeValue).toBe(expectedDependentListFakeValue);

        });
    });

    describe('getFakeValueIfExpectedSalesforceFieldType', () => {

        test('given expected fieldToRecipeValueMap and fieldtypes, returns the expected snowfakery YAML recipe value', () => {

            const expectedFieldToRecipeValue = snowFakerService.getMapSalesforceFieldToFakerValue();
            for ( const fieldTypeKey in expectedFieldToRecipeValue ) {
                const recipeValue = expectedFieldToRecipeValue[fieldTypeKey];
                const actualRecipeValue = recipeServiceWithSnow.getFakeValueIfExpectedSalesforceFieldType(fieldTypeKey);
                expect(actualRecipeValue).toBe(recipeValue);
            }
            
        });

    });

});
