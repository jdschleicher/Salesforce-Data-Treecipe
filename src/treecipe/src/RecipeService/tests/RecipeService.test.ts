import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import { RecipeMockService } from "./mocks/RecipeMockService";
import { SnowfakeryRecipeFakerService } from "../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService";
import { IPicklistValue } from "../../ObjectInfoWrapper/FieldInfo";
import { MockRecordTypeService } from "../../RecordTypeService/tests/MockRecordTypeService";
import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";
import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";

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


describe('SnowfakeryRecipeService IRecipeService Implementation Shared Intstance Tests', () => {

    const snowFakerService = new SnowfakeryRecipeFakerService();
    let recipeServiceWithSnow = new RecipeService(snowFakerService);  
    const salesforceOOTBFakerMappings:Record<string, Record<string, string>> = recipeServiceWithSnow.getOOTBExpectedObjectToFakerValueMappings();

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
            const expectedDatetimeSnowfakeryValue = '${{ (fake.date_time_between(start_date="-1y", end_date="now")).strftime("%Y-%m-%dT%H:%M:%S.000+0000") }}';
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

        const objectApiName = "Account";
        let expectedRecipeInitiation = 
`\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:`;

        let fieldsToAddToRecipe = "";
        Object.entries(salesforceOOTBFakerMappings[objectApiName]).forEach(([ootbFieldApiName, expectedOOTBFieldRecipe]) => {
            fieldsToAddToRecipe = recipeServiceWithSnow.appendFieldRecipeToObjectRecipe(
                fieldsToAddToRecipe, 
                expectedOOTBFieldRecipe, 
                ootbFieldApiName
            );
        });


        test('given OOTB Account object api name and empty recordtype map, the expected initiation recipe properties are returned in a string and RecordTypeId is NOT added to the intial recipe', () => {

            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(objectApiName, 
                                                            emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                            salesforceOOTBFakerMappings
                                                        );
            const initialRecipeCombinedWithAccountExpectedFieldsWithoutRecordTypeId = expectedRecipeInitiation + fieldsToAddToRecipe;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithAccountExpectedFieldsWithoutRecordTypeId);

        });

        test('given Accont OOTB object api name and expected mocked recordtype map, the expected initiation recipe properties are returned in a string with an appended RecordTypeId field', () => {

            const expectedRecordTypeMarkup = `\n    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection
                    Account.OneRecType
                    Account.TwoRecType`;

            const expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(
                                                                        objectApiName,
                                                                        expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                                        salesforceOOTBFakerMappings
                                                                    );


            const initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields = expectedRecipeInitiation + expectedRecordTypeMarkup + fieldsToAddToRecipe;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields);

        });

        test('given Custom object api name and expected mocked recordtype map, the expected initiation recipe properties are returned in a string with an appended RecordTypeId field', () => {

            const customFakeObjectName = 'CustomFake__c';

            let expectedRecipeInitiation = 
`\n- object: ${customFakeObjectName}
  nickname: ${customFakeObjectName}_NickName
  count: 1
  fields:`;

            const expectedRecordTypeMarkup = `\n    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection
                    ${customFakeObjectName}.OneRecType
                    ${customFakeObjectName}.TwoRecType`;

            const expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualRecipeInitiation = recipeServiceWithSnow.initiateRecipeByObjectName(
                                                                        customFakeObjectName,
                                                                        expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                                        salesforceOOTBFakerMappings
                                                                    );

            const initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields = expectedRecipeInitiation + expectedRecordTypeMarkup;;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields);

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

        test('given no controllingValueToPicklistOptions with record type markup, returns expected dependent picklist faker value', () => {

            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    fullName: 'tree',
                    label: 'tree',
                    default: false
                },
                {
                    fullName: 'weed',
                    label: 'weed',
                    default: false,
                    availableForControllingValues: []
                },
                {
                    fullName: 'mulch',
                    label: 'mulch',
                    default: false,
                },
                {
                    fullName: 'rocks',
                    label: 'rocks',
                    default: false                
                },
                {
                    fullName: 'plant',
                    label: 'plant',
                    default: false,
                    availableForControllingValues: []
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

            const expectedDependentPicklistRecipeValue = recipeServiceWithSnow.getNoValueSettingsToDoRecipeValue(expectedXMLFieldDetail);
            const emptyRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const actualFakerValue = recipeServiceWithSnow.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail,
                emptyRecordTypeApiToRecordTypeWrapperMap,

            );

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);

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

describe('FakerJSRecipeService IRecipeService Implementation Shared Intstance Tests', () => {

    const fakerJSRecipeService = new FakerJSRecipeFakerService();
    let recipeServiceWithFakerJS = new RecipeService(fakerJSRecipeService);  
    const salesforceOOTBFakerMappings:Record<string, Record<string, string>> = recipeServiceWithFakerJS.getOOTBExpectedObjectToFakerValueMappings();

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
            const actualRecipeValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);
            expect(expectedRecipeValue).toBe(actualRecipeValue);
        });

        test('given expected Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
            const expectedPicklistSnowfakeryValue = "${{ random_choice('cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby') }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistSnowfakeryValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistSnowfakeryValue).toBe(expectedPicklistSnowfakeryValue);

        });

        test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
            const expectedMultiSelectPicklistSnowfakeryValue = "${{ (';').join((fake.random_sample(elements=('chicken', 'chorizo', 'egg', 'fish', 'pork', 'steak', 'tofu')))) }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualMultiSelectPicklistSnowfakeryValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualMultiSelectPicklistSnowfakeryValue).toBe(expectedMultiSelectPicklistSnowfakeryValue);

        });

        test('given expected datetime XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedDatetimeXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getDateTimeFieldDetail();
            const expectedDatetimeSnowfakeryValue = '${{ (fake.date_time_between(start_date="-1y", end_date="now")).strftime("%Y-%m-%dT%H:%M:%S.000+0000") }}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualDatetimeSnowfakeryValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedDatetimeXMLFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualDatetimeSnowfakeryValue).toBe(expectedDatetimeSnowfakeryValue);

        });

        test('given expected url XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedUrlFieldDetail:XMLFieldDetail = XMLMarkupMockService.getUrlXMLFieldDetail();
            const expectedUrlSnowfakeryValue = '${{fake.url()}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualUrlSnowfakeryValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedUrlFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualUrlSnowfakeryValue).toBe(expectedUrlSnowfakeryValue);

        });

        test('given expected phone XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForPhone:XMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();
            const expectedSnowfakeryValueForPhone = '${{fake.phone_number()}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   
            const actualSnowfakeryValueForPhone = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForPhone, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForPhone).toBe(expectedSnowfakeryValueForPhone);

        });

        test('given expected number XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForNumber:XMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();
            const expectedSnowfakeryValueForNumber = '${{fake.random_int(min=0, max=999999)}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   

            const actualSnowfakeryValueForNumber = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForNumber, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForNumber).toBe(expectedSnowfakeryValueForNumber);

        });

        test('given expected currency XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

            const expectedXMLDetailForCurrency:XMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();
            const expectedSnowfakeryValueForCurrency = '${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}';
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualSnowfakeryValueForCurrency = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForCurrency, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualSnowfakeryValueForCurrency).toBe(expectedSnowfakeryValueForCurrency);

        });

    });

    describe('initiateRecipeByObjectName', () => {

        const objectApiName = "Account";
        let expectedRecipeInitiation = 
`\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:`;

        let fieldsToAddToRecipe = "";
        Object.entries(salesforceOOTBFakerMappings[objectApiName]).forEach(([ootbFieldApiName, expectedOOTBFieldRecipe]) => {
            fieldsToAddToRecipe = recipeServiceWithFakerJS.appendFieldRecipeToObjectRecipe(
                fieldsToAddToRecipe, 
                expectedOOTBFieldRecipe, 
                ootbFieldApiName
            );
        });


        test('given OOTB Account object api name and empty recordtype map, the expected initiation recipe properties are returned in a string and RecordTypeId is NOT added to the intial recipe', () => {

            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const actualRecipeInitiation = recipeServiceWithFakerJS.initiateRecipeByObjectName(objectApiName, 
                                                            emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                            salesforceOOTBFakerMappings
                                                        );
            const initialRecipeCombinedWithAccountExpectedFieldsWithoutRecordTypeId = expectedRecipeInitiation + fieldsToAddToRecipe;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithAccountExpectedFieldsWithoutRecordTypeId);

        });

        test('given Accont OOTB object api name and expected mocked recordtype map, the expected initiation recipe properties are returned in a string with an appended RecordTypeId field', () => {

            const expectedRecordTypeMarkup = `\n    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection
                    Account.OneRecType
                    Account.TwoRecType`;

            const expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualRecipeInitiation = recipeServiceWithFakerJS.initiateRecipeByObjectName(
                                                                        objectApiName,
                                                                        expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                                        salesforceOOTBFakerMappings
                                                                    );


            const initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields = expectedRecipeInitiation + expectedRecordTypeMarkup + fieldsToAddToRecipe;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields);

        });

        test('given Custom object api name and expected mocked recordtype map, the expected initiation recipe properties are returned in a string with an appended RecordTypeId field', () => {

            const customFakeObjectName = 'CustomFake__c';

            let expectedRecipeInitiation = 
`\n- object: ${customFakeObjectName}
  nickname: ${customFakeObjectName}_NickName
  count: 1
  fields:`;

            const expectedRecordTypeMarkup = `\n    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection
                    ${customFakeObjectName}.OneRecType
                    ${customFakeObjectName}.TwoRecType`;

            const expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualRecipeInitiation = recipeServiceWithFakerJS.initiateRecipeByObjectName(
                                                                        customFakeObjectName,
                                                                        expectedMockedRecordTypeToPicklistFieldsToAvailablePicklistValuesMap,
                                                                        salesforceOOTBFakerMappings
                                                                    );

            const initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields = expectedRecipeInitiation + expectedRecordTypeMarkup;;
            expect(actualRecipeInitiation).toBe(initialRecipeCombinedWithRecordTypeMarkupAndAccountExpectedFields);

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

            const actualUpdatedRecipe = recipeServiceWithFakerJS.appendFieldRecipeToObjectRecipe(initialMarkup, fakeRecipevalue, fakeFieldApiName );

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

            const firstUpdatedRecipe = recipeServiceWithFakerJS.appendFieldRecipeToObjectRecipe(initialMarkup, firstFakeRecipevalue, firstFakeFieldApiName );
            const secondUpdatedRecipe = recipeServiceWithFakerJS.appendFieldRecipeToObjectRecipe(firstUpdatedRecipe, secondFakeRecipeValue, secondFakeFieldApiName );

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
            const actualRecipeValue = recipeServiceWithFakerJS.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail, 
                recordTypeNameByRecordTypeNameToXMLMarkup
            );

            expect(actualRecipeValue).toBe(expectedDependentListFakeValue);

        });

        test('given no controllingValueToPicklistOptions with record type markup, returns expected dependent picklist faker value', () => {

            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    fullName: 'tree',
                    label: 'tree',
                    default: false
                },
                {
                    fullName: 'weed',
                    label: 'weed',
                    default: false,
                    availableForControllingValues: []
                },
                {
                    fullName: 'mulch',
                    label: 'mulch',
                    default: false,
                },
                {
                    fullName: 'rocks',
                    label: 'rocks',
                    default: false                
                },
                {
                    fullName: 'plant',
                    label: 'plant',
                    default: false,
                    availableForControllingValues: []
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

            const expectedDependentPicklistRecipeValue = recipeServiceWithFakerJS.getNoValueSettingsToDoRecipeValue(expectedXMLFieldDetail);
            const emptyRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const actualFakerValue = recipeServiceWithFakerJS.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail,
                emptyRecordTypeApiToRecordTypeWrapperMap,

            );

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);

        });

    });

    describe('getFakeValueIfExpectedSalesforceFieldType', () => {

        test('given expected fieldToRecipeValueMap and fieldtypes, returns the expected snowfakery YAML recipe value', () => {

            const expectedFieldToRecipeValue = recipeServiceWithFakerJS.getMapSalesforceFieldToFakerValue();
            for ( const fieldTypeKey in expectedFieldToRecipeValue ) {
                const recipeValue = expectedFieldToRecipeValue[fieldTypeKey];
                const actualRecipeValue = recipeServiceWithFakerJS.getFakeValueIfExpectedSalesforceFieldType(fieldTypeKey);
                expect(actualRecipeValue).toBe(recipeValue);
            }
            
        });

    });

});