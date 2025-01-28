import { RecipeMockService } from "../../../RecipeService/tests/mocks/RecipeMockService";
import { MockRecordTypeService } from "../../../RecordTypeService/tests/MockRecordTypeService";
import { SnowfakeryFakerService } from "../SnowfakeryFakerService";

describe('SnowfakeryFakerService Shared Intstance Tests', () => {

    let snowfakeryService = new SnowfakeryFakerService();

    describe('getMapSalesforceFieldToFakerValue', () => {

        const fieldTypeToSnowfakeryMappings = snowfakeryService.getMapSalesforceFieldToFakerValue();
        const placeholderForXMLMarkupDependentValue = 'GENERATED BY FIELD XML MARKUP';
        const referenceValuePlaceholder = '"TODO -- REFERENCE ID REQUIRED"';
        const seeOnePagerPlaceholder = '"SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"';

        test('Text field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['text']).toBe('${{fake.text(max_nb_chars=50)}}');
        });

        test('TextArea field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['textarea']).toBe('${{fake.paragraph()}}');
        });

        test('LongTextArea field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['longtextarea']).toBe('${{fake.text(max_nb_chars=1000)}}');
        });

        test('RichTextArea field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['richtextarea']).toBe('${{fake.text(max_nb_chars=1000)}}');
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
            expect(fieldTypeToSnowfakeryMappings['datetime']).toBe('${{fake.date_time_between(start_date="-1y", end_date="now")}}');
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
            expect(fieldTypeToSnowfakeryMappings['checkbox']).toBe('${{fake.boolean()}}');
        });

        test('Lookup field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['lookup']).toBe(referenceValuePlaceholder);
        });

        test('MasterDetail field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['masterdetail']).toBe(referenceValuePlaceholder);
        });

        test('Formula field returns correct message', () => {
            expect(fieldTypeToSnowfakeryMappings['formula']).toBe('Formula fields are calculated, not generated');
        });

        test('Location field returns correct faker expression', () => {
            expect(fieldTypeToSnowfakeryMappings['location']).toBe(seeOnePagerPlaceholder);
        });

        test('All Salesforce field types have a corresponding mapping', () => {
            const expectedFields = [
                'text', 'textarea', 'longtextarea', 'richtextarea', 'email', 
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

        test('given expected list of choices, returns expected multiselect picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = "${{ (';').join((fake.random_sample(elements=('apple','orange','banana')))) }}";
            const actualFakerValue = snowfakeryService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(possibleChoices);

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


            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap = {};
            const fakeFieldApiName = "CarModel__c";
            const actualFakerValue = snowfakeryService.buildDependentPicklistRecipeFakerValue(expectedControllingValueToPicklistOptions, 
                                                                                                emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap, 
                                                                                                controllingField, 
                                                                                                fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);

        });


        test('given expected controlling value picklist options with multiplue record types markup, returns expected dependent picklist faker value with TODO lines', () => {

            
            const expectedControllingValueToPicklistOptionsTwo = MockRecordTypeService.getDependentPicklistControllingFieldToAvailablePicklistValues();

            const controllingField = "Picklist__c";
            
            const expectedDependentPicklistRecipeValue = RecipeMockService.getMockRecordTypeDrivenDependentPicklistRecipeValue();

            const expectedRecTypesToXMLDetailMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
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
            const fakeFieldApiName = "Picklist__c";
            const recordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
            const actualFakerValue = snowfakeryService.buildPicklistRecipeValueByXMLFieldDetail(possibleChoices, recordTypeToPicklistFieldsToAvailablePicklistValuesMap, fakeFieldApiName);
            
            const expectedFakerValue = RecipeMockService.getMockPicklistRecipeCobminedWithRecordTypes();

            expect(actualFakerValue).toBe(expectedFakerValue);

        });

    });

    describe('updateDependentPicklistRecipeFakerValueByRecordTypeSections', () => {

        test('given expected cle controlling field recipe choices and expected recordtype to picklist map returns expected choices breakdown', () => {
            
            const expectedRecTypesToXMLDetailMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'cle';
            const controllingFieldApiName = 'Picklist__c';

            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                expectedRecTypesToXMLDetailMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const cleControllingValueToPicklistOptions = MockRecordTypeService.getCleControllingValueToDependentPicklistOptions();
            expect(actualUpdatedRandomChoicesBreakdown).toBe(cleControllingValueToPicklistOptions);
        
        });

        test('given expected madison controlling field recipe choices and expected recordtype to picklist map returns expected choices breakdown', () => {
            
            const expectedRecTypesToXMLDetailMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
            const fakeFieldApiName = "DependentPicklist__c";
            const controllingFieldValue = 'madison';
            const controllingFieldApiName = 'Picklist__c';

    
            const actualUpdatedRandomChoicesBreakdown = snowfakeryService.updateDependentPicklistRecipeFakerValueByRecordTypeSections(
                                                                                                expectedRecTypesToXMLDetailMap, 
                                                                                                fakeFieldApiName, 
                                                                                                controllingFieldApiName,
                                                                                                controllingFieldValue
                                                                                            );

            const madisonControllingValueToPicklistOptions = MockRecordTypeService.getMadisonControllingValueToDependentPicklistOptions();
            expect(actualUpdatedRandomChoicesBreakdown).toBe(madisonControllingValueToPicklistOptions);
        
        });
    
    });

    describe('buildRecordTypeBasedPicklistRecipeValue', () => {

        test('given expected record type to picklist values map, returns expected record type based picklist faker value', () => {

            const recordTypeToPicklistFieldsToAvailablePicklistValuesMap = MockRecordTypeService.getMultipleRecordTypeToFieldToPicklistValuesMap();
            const fakeFieldApiName = "Picklist__c";
            const actualFakerValue = snowfakeryService.buildRecordTypeBasedPicklistRecipeValue(recordTypeToPicklistFieldsToAvailablePicklistValuesMap, 
                                                                                                fakeFieldApiName);

            const expectedFakerValue = RecipeMockService.getMockPicklistRecordTypesRecipe();

            expect(actualFakerValue).toBe(expectedFakerValue);

        });

    });


});