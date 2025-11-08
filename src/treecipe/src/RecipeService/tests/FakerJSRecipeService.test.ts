import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { RecipeMockService } from "./mocks/RecipeMockService";

import { IPicklistValue } from "../../ObjectInfoWrapper/FieldInfo";
import { MockRecordTypeService } from "../../RecordTypeService/tests/MockRecordTypeService";
import { RecordTypeWrapper } from "../../RecordTypeService/RecordTypesWrapper";

import { FakerJSRecipeFakerService } from "../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService";
import { GlobalValueSetSingleton } from "../../GlobalValueSetSingleton/GlobalValueSetSingleton";

import * as fs from 'fs';
import * as vscode from 'vscode';
import { MockDirectoryService } from "../../DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory/MockDirectoryService";

jest.mock('vscode', () => ({
  workspace: {
      workspaceFolders: undefined,
      fs: { 
          readDirectory: jest.fn(),
          readFile: jest.fn()
      }
  },
  Uri: {
      file: (path: string) => ({ fsPath: path }),
      joinPath: jest.fn().mockImplementation((baseUri, ...pathSegments) => ({
        fsPath: `${baseUri.fsPath}/${pathSegments.join('/')}`.replace(/\/+/g, '/'), // Ensure no double slashes
      }))
  },
  FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
  }

}), { virtual: true });

describe('FakerJSRecipeService IRecipeService Implementation Shared Intstance Tests', () => {

    const fakerJSRecipeService = new FakerJSRecipeFakerService();
    let recipeServiceWithFakerJS = new RecipeService(fakerJSRecipeService);  
    const salesforceOOTBFakerMappings:Record<string, Record<string, string>> = recipeServiceWithFakerJS.getOOTBExpectedObjectToFakerValueMappings();

    describe('getRecipeFakeValueByXMLFieldDetail', () => {

        test('given invalid or not yet handled field type, logs message and returns "### TODO -- FieldType Not Handled Value', () => {

            const fakeFieldTypeValue = "heyooo";
            let fakeXMLFieldDetail: XMLFieldDetail = {
                fieldType: fakeFieldTypeValue,
                apiName: "Fake__c",
                fieldLabel: "Fake",
                xmlMarkup: "<xml></xml>"
            };
            const expectedRecipeValue = `"### TODO -- FieldType Not Handled -- ${fakeFieldTypeValue} does not exist in this programs Salesforce field map."`;
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualRecipeValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);
            expect(expectedRecipeValue).toBe(actualRecipeValue);
        });

        test('given expected Picklist XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
            const expectedPicklistFakerJSValue = "\${{ faker.helpers.arrayElement(['cle','eastlake','madison','mentor','wickliffe','willoughby']) }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistFakerJSExpression = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistFakerJSExpression).toBe(expectedPicklistFakerJSValue);

        });

        test('given expected Picklist XMLFieldDetail that doesnt have a preset map to picklist values, returns the expected TODO', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getExpectedStandardValueSetPicklistXMLFieldDetailThatIsntTrackedInValueSetMap();
            const expectedTODOStatement = "### TODO: This picklist field needs manually updated with either a standard value set list or global value set";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistFakerJSExpression = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistFakerJSExpression).toBe(expectedTODOStatement);

        });

        test('given expected Standard Value Set Picklist XMLFieldDetail, returns the expected fakerjs YAML recipe value', () => {

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getExpectedStandardValueSetLeadSourcePicklistXMLFieldDetail();
            const expectedPicklistFakerJSValue = "\${{ faker.helpers.arrayElement(['Web','Phone Inquiry','Partner Referral','Purchased List','Other']) }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistFakerJSValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistFakerJSValue).toBe(expectedPicklistFakerJSValue);

        });

        test('given expected GLOBAL Value Set Picklist XMLFieldDetail, returns the expected fakerjs YAML recipe value', async() => {

            const jsonMockedSalesforceMetadataDirectoryStructure = MockDirectoryService.getVSCodeFileTypeMockedGlobalValueSetFiles();
            const mockReadDirectory = jest.fn().mockResolvedValueOnce(jsonMockedSalesforceMetadataDirectoryStructure);
            jest.spyOn(vscode.workspace.fs, 'readDirectory').mockImplementation(mockReadDirectory);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);

            const cleGlobalValueSetXMLContent = XMLMarkupMockService.getCLEGlobalValueSetXMLMarkup();
            const planetsGlobalValueSetXMLContent = XMLMarkupMockService.getPlanetsGlobalValueSetXMLFileContent();
            const expectedGlobalValueSetFileNameToPicklistValuesSetMap = {
                'CLEGlobal.globalValueSet-meta.xml': Promise.resolve(
                    cleGlobalValueSetXMLContent
                ),
                'Planets.globalValueSet-meta.xml': Promise.resolve(
                    planetsGlobalValueSetXMLContent
                )
            };
        
            const globalValueSetSingleton = GlobalValueSetSingleton.getInstance();

            jest.spyOn(globalValueSetSingleton, 'getGlobalValueSetPicklistXMLFileContent')
                .mockImplementation(async (globalValueSetURI, globalValueSetFileName) => {
                return expectedGlobalValueSetFileNameToPicklistValuesSetMap[globalValueSetFileName] || Promise.resolve(null);
            });
    
            const generateRecipeOverride = true;

            const uri = vscode.Uri.file('./src/treecipe/src/DirectoryProcessingService/tests/mocks/MockSalesforceMetadataDirectory');
            await globalValueSetSingleton.initialize(uri.fsPath, generateRecipeOverride);

            const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getExpectedGlobalValueSetCLEGlobalPicklistXMLFieldDetail();
            const expectedPicklistFakerJSValue = "\${{ faker.helpers.arrayElement(['guardians','cavs','browns','monsters','crunch']) }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualPicklistFakerJSValue = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualPicklistFakerJSValue).toBe(expectedPicklistFakerJSValue);

        });

        test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
            const expectedFakerJSMultiSelectPicklistExpression = "\${{ (faker.helpers.arrayElements(['chicken','chorizo','egg','fish','pork','steak','tofu'])).join(';') }}";
            const recordTypeNameToRecordTypeXMLMarkup = {};
            const actualMultiSelectPicklistFakerJSExpression = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail, recordTypeNameToRecordTypeXMLMarkup);

            expect(actualMultiSelectPicklistFakerJSExpression).toBe(expectedFakerJSMultiSelectPicklistExpression);

        });

        test('given expected datetime XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedDatetimeXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getDateTimeFieldDetail();
            const expectedDatetimeFakerJSExpression = `|
                \${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}`;
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualDatetimeFakerJSExpression = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedDatetimeXMLFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualDatetimeFakerJSExpression).toBe(expectedDatetimeFakerJSExpression);

        });

        test('given expected url XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedUrlFieldDetail:XMLFieldDetail = XMLMarkupMockService.getUrlXMLFieldDetail();
            const expectedUrlFakerJSExpressionValue = "\${{ faker.internet.url() }}";
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualUrlFakerJSExpression = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedUrlFieldDetail, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualUrlFakerJSExpression).toBe(expectedUrlFakerJSExpressionValue);

        });

        test('given expected phone XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedXMLDetailForPhone:XMLFieldDetail = XMLMarkupMockService.getPhoneXMLFieldDetail();
            const expectedFakerJSExpressionForPhone = `|
                \${{ faker.phone.number({style:'national'}) }}`;
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   
            const actualFakerJSExpressionForPhone = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForPhone, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualFakerJSExpressionForPhone).toBe(expectedFakerJSExpressionForPhone);

        });

        test('given expected number XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedXMLDetailForNumber:XMLFieldDetail = XMLMarkupMockService.getNumberXMLFieldDetail();
            const expectedFakerJSExpressionForNumber =  `|
                \${{ faker.number.int({min: 0, max: 999999}) }}`;
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};   

            const actualFakerJSForNumber = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForNumber, recordTypeNameByRecordTypeNameToXMLMarkup);
            expect(actualFakerJSForNumber).toBe(expectedFakerJSExpressionForNumber);

        });

        test('given expected currency XMLFieldDetail, returns the expected fakerJS YAML recipe value', () => {

            const expectedXMLDetailForCurrency:XMLFieldDetail = XMLMarkupMockService.getCurrencyFieldDetail();
            const expectedFakerJSExpressionForCurrency = "\${{ faker.finance.amount(0, 999999, 2) }}";
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const actualFakerJSForCurrency = recipeServiceWithFakerJS.getRecipeFakeValueByXMLFieldDetail(expectedXMLDetailForCurrency, recordTypeNameByRecordTypeNameToXMLMarkup);

            expect(actualFakerJSForCurrency).toBe(expectedFakerJSExpressionForCurrency);

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

            // ok to use fakerjs mock return as we are testing what appending will do to the recipe and this behavior should be the same for both implementations
            const initialMarkup = RecipeMockService.getFakerJSExpectedEvertyingExampleFullObjectRecipeMarkup();
            const fakeRecipevalue = `"\${{ fake.superduperfakeFirstName }}"`;
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

        test('given expected XMLDetail expected controllingvalue to options are built and correct fakerjs fake value is returned', () => {
        
            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    picklistOptionApiName: 'tree',
                    label: 'tree',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'willoughby']
                },
                {
                    picklistOptionApiName: 'weed',
                    label: 'weed',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
                },
                {
                    picklistOptionApiName: 'mulch',
                    label: 'mulch',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'willoughby']
                },
                {
                    picklistOptionApiName: 'rocks',
                    label: 'rocks',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'wickliffe']
                },
                {
                    picklistOptionApiName: 'plant',
                    label: 'plant',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['madison', 'mentor']
                }
               
            ];
         
            const expectedXMLFieldDetail:XMLFieldDetail = {
                fieldType : "picklist",
                apiName : "DependentPicklist__c",
                picklistValues : expectedPicklistFieldDetails,
                referenceTo : "",
                fieldLabel : "Dependent Picklist",
                controllingField : "Picklist__c",
                xmlMarkup: XMLMarkupMockService.getDependentPicklistFieldTypeXMLMarkup()
            };
 
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const expectedDependentListFakeValue = RecipeMockService.getMockFakerJSDependentPicklistRecipeValueWithoutRecordTypeDetail();
            const actualRecipeValue = recipeServiceWithFakerJS.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail, 
                recordTypeNameByRecordTypeNameToXMLMarkup
            );

            expect(actualRecipeValue).toBe(expectedDependentListFakeValue);

        });

        test('given no controllingValueToPicklistOptions with record type markup, returns expected dependent picklist faker value', () => {

            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    picklistOptionApiName: 'tree',
                    label: 'tree',
                    default: false
                },
                {
                    picklistOptionApiName: 'weed',
                    label: 'weed',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: []
                },
                {
                    picklistOptionApiName: 'mulch',
                    label: 'mulch',
                    default: false,
                },
                {
                    picklistOptionApiName: 'rocks',
                    label: 'rocks',
                    default: false                
                },
                {
                    picklistOptionApiName: 'plant',
                    label: 'plant',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: []
                }
               
            ];
         
            const expectedXMLFieldDetail:XMLFieldDetail = {
                fieldType : "picklist",
                apiName : "DependentPicklist__c",
                picklistValues : expectedPicklistFieldDetails,
                referenceTo : "",
                fieldLabel : "Dependent Picklist",
                controllingField : "Picklist__c",
                xmlMarkup : XMLMarkupMockService.getDependentPicklistFieldTypeXMLMarkup()
            };

            const expectedDependentPicklistRecipeValue = recipeServiceWithFakerJS.getNoValueSettingsToDoRecipeValue(expectedXMLFieldDetail);
            const emptyRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const actualFakerValue = recipeServiceWithFakerJS.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail,
                emptyRecordTypeApiToRecordTypeWrapperMap,

            );

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);

        });

        test('given expected XMLDetail with isActive options set to false and active, expected controllingvalue to options are built and correct fakerjs fake value is returned', () => {
        
            const expectedPicklistFieldDetails:IPicklistValue[] = [
                {
                    picklistOptionApiName: 'tree',
                    label: 'tree',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'willoughby']
                },
                {
                    picklistOptionApiName: 'weed',
                    label: 'weed',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby']
                },
                {
                    picklistOptionApiName: 'mulch',
                    label: 'mulch',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'eastlake', 'willoughby']
                },
                {
                    picklistOptionApiName: 'rocks',
                    label: 'rocks',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['cle', 'wickliffe']
                },
                {
                    picklistOptionApiName: 'plant',
                    label: 'plant',
                    default: false,
                    controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['madison', 'mentor']
                }
               
            ];
         
            const expectedXMLFieldDetail:XMLFieldDetail = {
                fieldType : "picklist",
                apiName : "DependentPicklist__c",
                picklistValues : expectedPicklistFieldDetails,
                referenceTo : "",
                fieldLabel : "Dependent Picklist",
                controllingField : "Picklist__c",
                xmlMarkup: XMLMarkupMockService.getDependentPicklistFieldTypeWithIsActiveTagsXMLMarkup()
            };
 
            const recordTypeNameByRecordTypeNameToXMLMarkup = {};
            const expectedDependentListFakeValue = RecipeMockService.getMockFakerJSDependentPicklistRecipeValueWithoutRecordTypeDetail();
            const actualRecipeValue = recipeServiceWithFakerJS.getDependentPicklistRecipeFakerValue(
                expectedXMLFieldDetail, 
                recordTypeNameByRecordTypeNameToXMLMarkup
            );

            expect(actualRecipeValue).toBe(expectedDependentListFakeValue);

        });



    });

    describe('getFakeValueIfExpectedSalesforceFieldType', () => {

        test('given expected fieldToRecipeValueMap and fieldtypes, returns the expected fakerjs YAML recipe value', () => {

            const expectedFieldToRecipeValue = fakerJSRecipeService.getMapSalesforceFieldToFakerValue();
            for ( const fieldTypeKey in expectedFieldToRecipeValue ) {
                const recipeValue = expectedFieldToRecipeValue[fieldTypeKey];
                const actualRecipeValue = recipeServiceWithFakerJS.getFakeValueIfExpectedSalesforceFieldType(fieldTypeKey);
                expect(actualRecipeValue).toBe(recipeValue);
            }
            
        });

    });

});