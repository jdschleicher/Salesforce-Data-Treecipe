import { RecipeMockService } from "../../../RecipeService/tests/mocks/RecipeMockService";
import { RecordTypeWrapper } from "../../../RecordTypeService/RecordTypesWrapper";
import { MockRecordTypeService } from "../../../RecordTypeService/tests/MockRecordTypeService";
import { SnowfakeryFakerService } from "../SnowfakeryFakerService";

describe('SnowfakeryFakerService Shared Intstance Tests', () => {

    let snowfakeryService = new SnowfakeryFakerService();

    describe('getMapSalesforceFieldToFakerValue', () => {

        const fieldTypeToSnowfakeryMappings = snowfakeryService.getMapSalesforceFieldToFakerValue();
        const placeholderForXMLMarkupDependentValue = 'GENERATED BY FIELD XML MARKUP';
        const referenceValuePlaceholder = '### TODO -- REFERENCE ID REQUIRED';
        const seeOnePagerPlaceholder = '"### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"';

        test('Text field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['text']).toBe('${{fake.text(max_nb_chars=50)}}');
        });

        test('TextArea field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['textarea']).toBe('${{fake.paragraph()}}');
        });

        test('LongTextArea field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['longtextarea']).toBe('${{fake.text(max_nb_chars=1000)}}');
        });

        test('RichTextArea html field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['html']).toBe('${{fake.text(max_nb_chars=1000)}}');
        });

        test('Email field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['email']).toBe('${{fake.email()}}');
        });

        test('Phone field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['phone']).toBe('${{fake.phone_number()}}');
        });

        test('Url field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['url']).toBe('${{fake.url()}}');
        });

        test('Number field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['number']).toBe('${{fake.random_int(min=0, max=999999)}}');
        });

        test('Currency field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['currency']).toBe('${{fake.pydecimal(left_digits=6, right_digits=2, positive=True)}}');
        });

        test('Percent field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['percent']).toBe('${{fake.pydecimal(left_digits=2, right_digits=2, positive=True)}}');
        });

        test('Date field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['date']).toBe('${{date(fake.date_between(start_date="-1y", end_date="today"))}}');
        });

        test('DateTime field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['datetime']).toBe('${{ (fake.date_time_between(start_date="-1y", end_date="now")).strftime("%Y-%m-%dT%H:%M:%S.000+0000") }}');
        });

        test('Time field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['time']).toBe('${{fake.time()}}');
        });

        test('Picklist field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['picklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('MultiselectPicklist field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['multiselectpicklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('Checkbox field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['checkbox']).toBe('${{ (random_choice("true", "false")).lower() }}');
        });

        test('Lookup field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['lookup']).toBe(referenceValuePlaceholder);
        });

        test('MasterDetail field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['masterdetail']).toBe(referenceValuePlaceholder);
        });

        test('Formula field returns correct message', () => {
            expect(fieldTypeToSnowfakeryMappings['formula']).toBe('### TODO - REMOVE ME - Formula fields are calculated, not generated');
        });

        test('Location field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['location']).toBe(seeOnePagerPlaceholder);
        });

        test('All Salesforce field types have a corresponding mapping', () => {
            const expectedFields = [
                'text', 'textarea', 'longtextarea', 'html', 'email', 
                'phone', 'url', 'number', 'currency', 'percent', 'date', 
                'datetime', 'time', 'picklist', 'multiselectpicklist', 'checkbox', 
                'lookup', 'masterdetail', 'formula', 'location'
            ];

            expectedFields.forEach(field => {
                expect(fieldTypeToSnowfakeryMappings).toHaveProperty(field);
            });
        });

        test('All mapping values are strings', () => {
            Object.values(fieldTypeToSnowfakeryMappings).forEach(value => {
                expect(typeof value).toBe('string');
            });
        });

    });

    describe('generateTabs', ()=> {

        test('given 1 tab argument, returns expected spaces', () => {

            const expectedTabs = 4; 
            const actualTabResult = snowfakeryService.generateTabs(1);
            const actualSpacesCount = actualTabResult.length;
            expect(actualSpacesCount).toEqual(expectedTabs);

        });

    });

    describe('buildMultiSelectPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected list of choices and empty recordtype selections, returns expected multiselect picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const fakeFieldApiName = "Picklist__c";
            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const actualFakerValue = snowfakeryService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(possibleChoices, 
                                                                                                emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap, 
                                                                                                fakeFieldApiName);

            const expectedRecipeValue = "${{ (';').join((fake.random_sample(elements=('apple', 'orange', 'banana')))) }}";
            expect(actualFakerValue).toBe(expectedRecipeValue);

        });

        test('given expected list of choices, returns expected multiselect picklist faker value', () => {

            const possibleChoices: string[] = ['chicken', 'chorizo', 'egg', 'fish', 'pork', 'steak', 'tofu'];
            const expectedFieldApiName = "MultiPicklist__c";
            const recordTypeNameByRecordTypeNameToXRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualFakerValue = snowfakeryService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(possibleChoices, 
                                                                                                recordTypeNameByRecordTypeNameToXRecordTypeWrapperMap, 
                                                                                                expectedFieldApiName);

            
            
            const expectedRecipeValue = RecipeMockService.getMockMultiselectPicklistRecipeCobminedWithRecordTypes();

            expect(actualFakerValue).toBe(expectedRecipeValue);
       
        });

    });

    describe('buildDependentPicklistRecipeFakerValue', () => {

        test('given expected controlling value picklist options WITHOUT record type markup, returns expected dependent picklist faker value', () => {

            const expectedControllingValueToPicklistOptions: Record<string, string[]> = {
                Toyota: ["Corolla", "Camry", "Prius"],
                Ford: ["F-150", "Mustang", "Explorer"],
                Honda: ["Civic", "Accord", "Pilot"],
                Tesla: ["Model S", "Model 3", "Model X"],
            };            

            const controllingField = "CarBrand__c";
            
            const expectedDependentPicklistRecipeValue =`
      if:
        - choice:
            when: \${{ ${controllingField} == 'Toyota' }}
            pick:
                random_choice:
                    - Corolla
                    - Camry
                    - Prius
        - choice:
            when: \${{ ${controllingField} == 'Ford' }}
            pick:
                random_choice:
                    - F-150
                    - Mustang
                    - Explorer
        - choice:
            when: \${{ ${controllingField} == 'Honda' }}
            pick:
                random_choice:
                    - Civic
                    - Accord
                    - Pilot
        - choice:
            when: \${{ ${controllingField} == 'Tesla' }}
            pick:
                random_choice:
                    - Model S
                    - Model 3
                    - Model X`;


            const emptyRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const fakeFieldApiName = "CarModel__c";
            const actualFakerValue = snowfakeryService.buildDependentPicklistRecipeFakerValue(expectedControllingValueToPicklistOptions, 
                                                                                                emptyRecordTypeApiToRecordTypeWrapperMap, 
                                                                                                controllingField, 
                                                                                                fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);

        });

        test('given expected controlling value picklist options with multiplue record types markup, returns expected dependent picklist faker value with TODO lines', () => {

            
            const expectedControllingValueToPicklistOptionsTwo = MockRecordTypeService.getDependentPicklistControllingFieldToAvailablePicklistValues();

            const controllingField = "Picklist__c";
            
            const expectedDependentPicklistRecipeValue = RecipeMockService.getMockRecordTypeDrivenDependentPicklistRecipeValue();

            const expectedRecTypesToXMLDetailMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const actualFakerValue = snowfakeryService.buildDependentPicklistRecipeFakerValue(expectedControllingValueToPicklistOptionsTwo, 
                                                                                                expectedRecTypesToXMLDetailMap, 
                                                                                                controllingField, 
                                                                                                fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);
            
        });

    });

    describe('buildPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected available picklist choices and NO record type options, returns expected picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = "${{ random_choice('apple', 'orange', 'banana') }}";
            const fakeFieldApiName = "Picklist__c";
            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const actualFakerValue = snowfakeryService.buildPicklistRecipeValueByXMLFieldDetail(possibleChoices, 
                                                                                                emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap, 
                                                                                                fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedRecipeValue);

        });

        test('given expected available picklist choices, returns expected picklist faker value', () => {

            const possibleChoices: string[] = ['cle','eastlake','madison','mentor','wickliffe','willoughby'];
            const expectedFieldApiName = "Picklist__c";
            const recordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const actualFakerValue = snowfakeryService.buildPicklistRecipeValueByXMLFieldDetail(possibleChoices, recordTypeToPicklistFieldsToAvailablePicklistValuesMap, expectedFieldApiName);
            
            const expectedFakerValue = RecipeMockService.getMockPicklistRecipeCobminedWithRecordTypes();

            expect(actualFakerValue).toBe(expectedFakerValue);

        });

    });

    describe('updateDependentPicklistRecipeFakerValueByRecordTypeSections', () => {

        test('given expected cle controlling field recipe choices and expected recordtype to picklist map returns expected choices breakdown', () => {
            
            const expectedRecordTypeDeveloperNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'cle';
            const controllingFieldApiName = 'Picklist__c';

            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                expectedRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const cleControllingValueToPicklistOptions = MockRecordTypeService.getCleControllingValueToDependentPicklistOptions();
            expect(actualUpdatedRandomChoicesBreakdown).toBe(cleControllingValueToPicklistOptions);
        
        });

        test('given expected madison controlling field recipe choices and expected recordtype to picklist map returns expected choices breakdown', () => {
            
            const expectedRecordTypeDeveloperNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'madison';
            const controllingFieldApiName = 'Picklist__c';

    
            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                expectedRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const expectedRecordTypeControllingValueToPicklistOptionsFakerValue = MockRecordTypeService.getNotAvailableControllingValueToDependentPicklistOptionsVerbiageBasedOnExpectedRecordTypes(controllingFieldValue, controllingFieldApiName);
            expect(actualUpdatedRandomChoicesBreakdown).toBe(expectedRecordTypeControllingValueToPicklistOptionsFakerValue);
        
        });

        test('given expected record type files but no record type associated xml markup, "no record type selections" verbiage is added to recipe value', () => {
            
            const expectedRecordTypeDeveloperNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'madison';
            const controllingFieldApiName = 'apiFieldThatDoesntExistInAnyRecordTypeXMLMarkup';

    
            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                expectedRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const expectedRecordTypeControllingValueToPicklistOptionsFakerValue = MockRecordTypeService.getNotAvailableControllingValueToDependentPicklistOptionsVerbiageBasedOnExpectedRecordTypes(controllingFieldValue, controllingFieldApiName);
            expect(actualUpdatedRandomChoicesBreakdown).toBe(expectedRecordTypeControllingValueToPicklistOptionsFakerValue);
        
        });

        test('given NO record type files at all, no record type verbiage is added to recipe value', () => {
            
            const noRecordTypeDeveloperNameToRecordTypeWrapperMap = {};
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'madison';
            const controllingFieldApiName = 'apiFieldThatDoesntExistInAnyRecordTypeXMLMarkup';

    
            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                noRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const expectedRecordTypeControllingValueToPicklistOptionsFakerValue = "";
            expect(actualUpdatedRandomChoicesBreakdown).toBe(expectedRecordTypeControllingValueToPicklistOptionsFakerValue);
        
        });
    
    });

    describe('buildRecordTypeBasedPicklistRecipeValue', () => {

        test('given expected record type to picklist values map, returns expected record type based picklist faker value', () => {

            const expectedRecordTypeDeveloperNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "Picklist__c";
            const actualFakerValue = snowfakeryService.buildRecordTypeBasedPicklistRecipeValue(expectedRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName);

            const expectedFakerValue = RecipeMockService.getMockPicklistRecordTypesRecipe();

            expect(actualFakerValue).toBe(expectedFakerValue);

        });

    });

    describe('buildRecordTypeBasedPicklistRecipeValue', () => {

        test('given expected record type to picklist values map, returns expected record type based picklist faker value', () => {

            const expectedRecordTypeDeveloperNameToRecordTypeWrapperMap = MockRecordTypeService.getMultipleRecordTypeToFieldToRecordTypeWrapperMap();
            const fakeFieldApiName = "MultiPicklist__c";
            const actualFakerValue = snowfakeryService.buildRecordTypeBasedMultipicklistRecipeValue(expectedRecordTypeDeveloperNameToRecordTypeWrapperMap, 
                                                                                                fakeFieldApiName);

            const expectedFakerValue = RecipeMockService.getMockMultiselectPicklistRecordTypesRecipe();

            expect(actualFakerValue).toBe(expectedFakerValue);

        });

    });

    describe('getOOTBExpectedObjectToFakerValueMappings', () => { 

        test('given expected list of OOTB object keys, mapping keys are found', () => {
            
            const actualMappings = snowfakeryService.getOOTBObjectApiNameToFieldApiNameMap();

            const expectedObjectsInMappings = [
                'Account',
                'Contact',
                'Opportunity',
                'Lead',
                'Case',
                'Product2',
                'Pricebook2'
            ];

            expectedObjectsInMappings.forEach(objectName => {
                expect(objectName in actualMappings).toBe(true);
            });

            expect(Object.keys(actualMappings).length).toBe(expectedObjectsInMappings.length);

        });

    });

});