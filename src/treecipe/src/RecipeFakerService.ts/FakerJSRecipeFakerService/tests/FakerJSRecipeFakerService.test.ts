import { RecordTypeWrapper } from "../../../RecordTypeService/RecordTypesWrapper";
import { FakerJSRecipeFakerService } from "../FakerJSRecipeFakerService";

describe('FakerJSRecipeFakerService Shared Intstance Tests', () => {

    let fakerJSRecipeFakerService = new FakerJSRecipeFakerService();

    describe('getMapSalesforceFieldToFakerValue', () => {

        const fieldTypeToNPMFakerMappings = fakerJSRecipeFakerService.getMapSalesforceFieldToFakerValue();
        const placeholderForXMLMarkupDependentValue = 'GENERATED BY FIELD XML MARKUP';
        const referenceValuePlaceholder = '### TODO -- REFERENCE ID REQUIRED';
        const seeOnePagerPlaceholder = '### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445';

        test('Text field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['text']).toBe('${{ faker.lorem.text(5).substring(0, 255) }}');
        });

        test('TextArea field returns correct npm faker expression', () => {

            const textAreaExpression = fieldTypeToNPMFakerMappings['textarea'];
            expect(textAreaExpression).toBe('${{ faker.lorem.paragraph() }}');
            
        });

        test('LongTextArea field returns correct npm faker expression', () => {
            const longTextAreaExpression = fieldTypeToNPMFakerMappings['longtextarea'];
            expect(longTextAreaExpression).toBe('${{ faker.lorem.text(100) }}');
        });

        test('RichTextArea Html field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['html']).toBe('${{ faker.string.alpha(10) }}');
        });

        test('Email field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['email']).toBe('\${{ faker.internet.email() }}');
        });

        test('Phone field returns correct npm faker expression', () => {
            const phoneFakerExpression = fieldTypeToNPMFakerMappings['phone'];
            expect(phoneFakerExpression).toBe(`|
                \${{ faker.phone.number({style:\'national\'}) }}`);
        });

        test('Url field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['url']).toBe('\${{ faker.internet.url() }}');
        });

        test('Number field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['number']).toBe(`|
                \${{ faker.number.int({min: 0, max: 999999}) }}`);
        });

        test('Currency field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['currency']).toBe('\${{ faker.finance.amount(0, 999999, 2) }}');
        });

        test('Percent field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['percent']).toBe(`|
                \${{ faker.number.float({ min: 0, max: 99, precision: 0.01 }).toFixed(2) }}`);
        });

        test('Date field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['date']).toBe(`|
                \${{ faker.date.between({ from: new Date(\'2023-01-01\'), to: new Date() }).toISOString().split(\'T\')[0] }}`);
        });

        test('DateTime field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['datetime']).toBe(`|
                \${{ faker.date.between({ from: new Date(\'2023-01-01T00:00:00Z\'), to: new Date() }).toISOString() }}`);
        });

        test('Time field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['time']).toBe(`|
                \${{ faker.date.between({ from: new Date(\'1970-01-01T00:00:00Z\'), to: new Date(\'1970-01-01T23:59:59Z\') }).toISOString().split(\'T\')[1] }}`);
        });

        test('Picklist field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['picklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('MultiselectPicklist field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['multiselectpicklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('Checkbox field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['checkbox']).toBe('\${{ faker.datatype.boolean() }}');
        });

        test('Lookup field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['lookup']).toBe(referenceValuePlaceholder);
        });

        test('MasterDetail field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['masterdetail']).toBe(referenceValuePlaceholder);
        });

        test('Formula field returns correct message', () => {
            expect(fieldTypeToNPMFakerMappings['formula']).toBe('### TODO - Formula fields are calculated, not generated - remove this line');
        });

        test('Location field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['location']).toBe(seeOnePagerPlaceholder);
        });

        test('All Salesforce field types have a corresponding mapping', () => {
            const expectedFields = [
                'text', 'textarea', 'longtextarea', 'html', 'email', 
                'phone', 'url', 'number', 'currency', 'percent', 'date', 
                'datetime', 'time', 'picklist', 'multiselectpicklist', 'checkbox', 
                'lookup', 'masterdetail', 'formula', 'location'
            ];

            expectedFields.forEach(field => {
                expect(fieldTypeToNPMFakerMappings).toHaveProperty(field);
            });
        });

        test('All mapping values are strings', () => {
            Object.values(fieldTypeToNPMFakerMappings).forEach(value => {
                expect(typeof value).toBe('string');
            });
        });

    });

    describe('generateTabs', ()=> {

        test('given 1 tab argument, returns expected spaces', () => {

            const expectedTabs = 4; 
            const actualTabResult = fakerJSRecipeFakerService.generateTabs(1);
            const actualSpacesCount = actualTabResult.length;
            expect(actualSpacesCount).toEqual(expectedTabs);

        });

    });

    describe('buildMultiSelectPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected list of choices, returns expected multiselect picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = `\${{ (faker.helpers.arrayElements(['apple','orange','banana'])).join(';') }}`;
            const emptyRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const fakeFieldApiName = "Fruit__c";
            const actualFakerValue = fakerJSRecipeFakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(possibleChoices, emptyRecordTypeApiToRecordTypeWrapperMap, fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedRecipeValue);
        });

    });

    describe('buildDependentPicklistRecipeFakerValue', () => {

        test('given expected controlling value picklist options, returns expected dependent picklist faker value', () => {

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


            const emptyRecordTypeNameByRecordTypeNameToXRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const fakeFieldApiName = "CarModel__c";
            const actualFakerValue = fakerJSRecipeFakerService.buildDependentPicklistRecipeFakerValue(expectedControllingValueToPicklistOptions, 
                                                        emptyRecordTypeNameByRecordTypeNameToXRecordTypeWrapperMap, 
                                                        controllingField, 
                                                        fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);
        });

    });

    describe('buildPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected list of choices, returns expected  picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = `\${{ faker.helpers.arrayElement(['apple','orange','banana']) }}`;
            const emptyRecordTypeNameByRecordTypeNameToXRecordTypeWrapperMap: Record<string, RecordTypeWrapper> = {};
            const fakeFieldApiName = "Fruit__c";
            const actualFakerValue = fakerJSRecipeFakerService.buildPicklistRecipeValueByXMLFieldDetail(possibleChoices, 
                                                                        emptyRecordTypeNameByRecordTypeNameToXRecordTypeWrapperMap, 
                                                                        fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedRecipeValue);
        });

    });

    describe('getOOTBExpectedObjectToFakerValueMappings', () => { 

        test('given expected list of OOTB object keys, mapping keys are found', () => {
            
            const actualMappings = fakerJSRecipeFakerService.getOOTBObjectApiNameToFieldApiNameMap();

            const expectedObjectsInMappings = [
                'Account',
                'Contact',
                'Opportunity',
                'Lead',
                'Case',
                'Campaign',
                'Task',
                'Event',
                'Product2',
                'PriceBook2',
                'Asset',
                'Contract'
            ];

            expectedObjectsInMappings.forEach(objectName => {
                expect(objectName in actualMappings).toBe(true);
            });

            expect(Object.keys(actualMappings).length).toBe(expectedObjectsInMappings.length);

        });

    });

});