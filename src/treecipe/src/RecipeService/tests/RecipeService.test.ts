import { RecipeService } from "../../RecipeService/RecipeService";
import { XMLMarkupMockService } from "../../XMLProcessingService/tests/mocks/XMLMarkupMockService";
import { XMLFieldDetail } from "../../XMLProcessingService/XMLFieldDetail";

import { RecipeMockService } from "./mocks/RecipeMockService";

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

    test('given invalid or not yet handled field type, logs message and returns "FieldType Not Handled Value', () => {

        const fakeFieldTypeValue = "heyooo";
        let fakeXMLFieldDetail: XMLFieldDetail = {
            fieldType: fakeFieldTypeValue,
            apiName: "Fake__c",
            fieldLabel: "Fake"
        };
        const expectedRecipeValue = `"FieldType Not Handled -- ${fakeFieldTypeValue} does not exist in this programs Salesforce field map."`;
        const actualRecipeValue = RecipeService.getRecipeFakeValueByXMLFieldDetail(fakeXMLFieldDetail);
        expect(expectedRecipeValue).toBe(actualRecipeValue);
    });

    test('given expected Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getPicklistXMLFieldDetail();
        const expectedPicklistSnowfakeryValue = "${{ random_choice('cle','eastlake','madison','mentor','wickliffe','willoughby') }}";
        const actualPicklistSnowfakeryValue = RecipeService.getRecipeFakeValueByXMLFieldDetail(expectedPicklistXMLFieldDetail);

        expect(actualPicklistSnowfakeryValue).toBe(expectedPicklistSnowfakeryValue);

    });

    test('given expected MultiSelect Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedMultiSelectPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getMultiSelectPicklistXMLFieldDetail();
        const expectedMultiSelectPicklistSnowfakeryValue = "${{ (';').join((fake.random_sample(elements=('chicken','chorizo','egg','fish','pork','steak','tofu')))) }}";
        const actualMultiSelectPicklistSnowfakeryValue = RecipeService.getRecipeFakeValueByXMLFieldDetail(expectedMultiSelectPicklistXMLFieldDetail);

        expect(actualMultiSelectPicklistSnowfakeryValue).toBe(expectedMultiSelectPicklistSnowfakeryValue);

    });

    test('given expected Dependent Picklist XMLFieldDetail, returns the expected snowfakery YAML recipe value', () => {

        const expectedDependentPicklistXMLFieldDetail:XMLFieldDetail = XMLMarkupMockService.getDependentPicklistXMLFieldDetail();
        const expectedDependentPicklistSnowfakeryValue = 
`\n${RecipeService.generateTabs(1.5)}if:
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'cle' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
                    - rocks
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'eastlake' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'madison' }}
            pick:
                random_choice:
                    - tree
                    - plant
                    - weed
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'willoughby' }}
            pick:
                random_choice:
                    - tree
                    - weed
                    - mulch
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'mentor' }}
            pick:
                random_choice:
                    - plant
                    - weed
        - choice:
            when: ${RecipeService.openingRecipeSyntax} Picklist__c == 'wickliffe' }}
            pick:
                random_choice:
                    - weed
                    - rocks`;
        const actualDependentPicklistSnowfakeryValue = RecipeService.getRecipeFakeValueByXMLFieldDetail(expectedDependentPicklistXMLFieldDetail);

        // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
        // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
        // fs.writeFileSync("test.yaml", actualDependentPicklistSnowfakeryValue, { encoding: 'utf8' });
        // fs.writeFileSync("test2.yaml", expectedDependentPicklistSnowfakeryValue, { encoding: 'utf8' });

        expect(actualDependentPicklistSnowfakeryValue).toBe(expectedDependentPicklistSnowfakeryValue);

    });

});

describe('salesforceFieldToSnowfakeryMap', () => {

    const fieldTypeToSnowfakeryMappings = RecipeService.salesforceFieldToSnowfakeryMap;
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

describe('initiateRecipeByObjectName', () => {

    test('given object api name, the expected initiation recipe properties are returned in a string', () => {

        const objectApiName = "Account";
        const expectedRecipeInitiation = 
`\n- object: ${objectApiName}
  nickname: ${objectApiName}_NickName
  count: 1
  fields:`;

        const actualRecipeInitiation = RecipeService.initiateRecipeByObjectName(objectApiName);
        expect(actualRecipeInitiation).toBe(expectedRecipeInitiation);

    });

});

describe('appendFieldRecipeToObjectRecipe', () => {

    test('given existing object recipe string and new recipe value, the resulting updated recipe is returned', () => {

        const initialMarkup = RecipeMockService.getFakeInitialObjectRecipeMarkup();
        const fakeRecipevalue = "${{fake.superduperfakeFirstName}}";
        const fakeFieldApiName = "FirstName__c";
        const fakeFieldRecipeValue = `${fakeFieldApiName}: ${fakeRecipevalue}`;
        const expectedUpdateRecipe = 
`${initialMarkup}
${RecipeService.generateTabs(1)}${fakeFieldRecipeValue}`;

        const actualUpdatedRecipe = RecipeService.appendFieldRecipeToObjectRecipe(initialMarkup, fakeRecipevalue, fakeFieldApiName );

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
${RecipeService.generateTabs(1)}${firstFakeFieldRecipeValue}
${RecipeService.generateTabs(1)}${secondFakeFieldRecipeValue}`;

        const firstUpdatedRecipe = RecipeService.appendFieldRecipeToObjectRecipe(initialMarkup, firstFakeRecipevalue, firstFakeFieldApiName );
        const secondUpdatedRecipe = RecipeService.appendFieldRecipeToObjectRecipe(firstUpdatedRecipe, secondFakeRecipeValue, secondFakeFieldApiName );

        // THE BELOW FILE CREATION LINES HELP FOR VISUAL FULL FILE COMPARISON AND WHERE ADJUSTMENTS NEED MADE
        // UNCOMMENT FOR TROUBLESHOOTING OR MAKING NEW CHANGES THAT NEED TO BE VERIFIED
        // fs.writeFileSync("appendFieldActual.yaml", secondUpdatedRecipe, { encoding: 'utf8' }); 
        // fs.writeFileSync("appendFieldExpected.yaml", expectedUpdateRecipe, { encoding: 'utf8' });

        expect(secondUpdatedRecipe).toBe(expectedUpdateRecipe);
    });

});
