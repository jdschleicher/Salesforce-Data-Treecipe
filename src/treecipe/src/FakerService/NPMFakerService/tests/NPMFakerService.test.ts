import { NPMFakerService } from "../NPMFakerService";

describe('NPMFakerService Shared Intstance Tests', () => {

    let npmFakerService = new NPMFakerService();

    describe('getMapSalesforceFieldToFakerValue', () => {

        let fakerService = new NPMFakerService();
        const fieldTypeToNPMFakerMappings = fakerService.getMapSalesforceFieldToFakerValue();
        
        
        const placeholderForXMLMarkupDependentValue = 'GENERATED BY FIELD XML MARKUP';
        const referenceValuePlaceholder = '"TODO -- REFERENCE ID REQUIRED"';
        const seeOnePagerPlaceholder = '"SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445"';

        test('Text field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['text']).toBe('{{ faker.lorem.text(50) }}');
        });

        test('TextArea field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['textarea']).toBe('{{ faker.lorem.paragraph() }}');
        });

        test('LongTextArea field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['longtextarea']).toBe('{{ faker.lorem.text(1000) }}');
        });

        test('RichTextArea field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['richtextarea']).toBe('{{ faker.lorem.text(1000) }}');
        });

        test('Email field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['email']).toBe('{{ faker.internet.email() }}');
        });

        test('Phone field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['phone']).toBe('{{ faker.phone.number() }}');
        });

        test('Url field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['url']).toBe('{{ faker.internet.url() }}');
        });

        test('Number field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['number']).toBe('{{ faker.datatype.number({ min: 0, max: 999999 }) }}');
        });

        test('Currency field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['currency']).toBe('{{ faker.finance.amount(0, 999999, 2) }}');
        });

        test('Percent field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['percent']).toBe('{{ faker.finance.amount(0, 99, 2) }}');
        });

        test('Date field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['date']).toBe('{{ faker.date.between("2023-01-01", "2024-01-01").toISOString().split("T")[0] }}');
        });

        test('DateTime field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['datetime']).toBe('{{ faker.date.between("2023-01-01", "2024-01-01").toISOString() }}');
        });

        test('Time field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['time']).toBe('{{ faker.date.recent().toISOString().split("T")[1] }}');
        });

        test('Picklist field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['picklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('MultiselectPicklist field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['multiselectpicklist']).toBe(placeholderForXMLMarkupDependentValue);
        });

        test('Checkbox field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['checkbox']).toBe('{{ faker.datatype.boolean() }}');
        });

        test('Lookup field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['lookup']).toBe(referenceValuePlaceholder);
        });

        test('MasterDetail field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['masterdetail']).toBe(referenceValuePlaceholder);
        });

        test('Formula field returns correct message', () => {
            expect(fieldTypeToNPMFakerMappings['formula']).toBe('Formula fields are calculated, not generated');
        });

        test('Location field returns correct npm faker expression', () => {
            expect(fieldTypeToNPMFakerMappings['location']).toBe(seeOnePagerPlaceholder);
        });

        test('All Salesforce field types have a corresponding mapping', () => {
            const expectedFields = [
                'text', 'textarea', 'longtextarea', 'richtextarea', 'email', 
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
            const actualTabResult = npmFakerService.generateTabs(1);
            const actualSpacesCount = actualTabResult.length;
            expect(actualSpacesCount).toEqual(expectedTabs);

        });

    });

    describe('buildMultiSelectPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected list of choices, returns expected multiselect picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = `faker.helpers.arrayElements(['apple','orange','banana'])`;
            const actualFakerValue = npmFakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(possibleChoices);

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
            when: "${controllingField} == 'Toyota'"
            pick:
                random_choice:
                    - Corolla
                    - Camry
                    - Prius
        - choice:
            when: "${controllingField} == 'Ford'"
            pick:
                random_choice:
                    - F-150
                    - Mustang
                    - Explorer
        - choice:
            when: "${controllingField} == 'Honda'"
            pick:
                random_choice:
                    - Civic
                    - Accord
                    - Pilot
        - choice:
            when: "${controllingField} == 'Tesla'"
            pick:
                random_choice:
                    - Model S
                    - Model 3
                    - Model X`;


            const recordTypeNameByRecordTypeNameToXMLMarkup: Record<string, object> = {};
            const fakeFieldApiName = "CarModel__c";
            const actualFakerValue = npmFakerService.buildDependentPicklistRecipeFakerValue(expectedControllingValueToPicklistOptions, 
                                                        recordTypeNameByRecordTypeNameToXMLMarkup, 
                                                        controllingField, 
                                                        fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedDependentPicklistRecipeValue);
        });

    });

    describe('buildPicklistRecipeValueByXMLFieldDetail', () => {

        test('given expected list of choices, returns expected  picklist faker value', () => {

            const possibleChoices: string[] = ['apple', 'orange', 'banana'];
            const expectedRecipeValue = `faker.helpers.arrayElement(['apple','orange','banana'])`;
            const emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap: Record<string, Record<string, string[]>> = {};
            const fakeFieldApiName = "Fruit__c";
            const actualFakerValue = npmFakerService.buildPicklistRecipeValueByXMLFieldDetail(possibleChoices, 
                                                                                                emptyRecordTypeToPicklistFieldsToAvailablePicklistValuesMap, 
                                                                                                fakeFieldApiName);

            expect(actualFakerValue).toBe(expectedRecipeValue);
        });

    });

});