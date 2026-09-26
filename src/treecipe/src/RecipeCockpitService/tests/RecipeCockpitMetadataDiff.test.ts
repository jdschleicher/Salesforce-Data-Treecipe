import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

import type { IRecipeCockpitObjectViewModel } from '../RecipeCockpitService';
import type { INormalizedOrgObjectDescribe } from '../../SalesforceOrgService/SalesforceOrgService';
import {
    RecipeCockpitMetadataDiff,
    IMetadataDiffFieldResult,
    IMetadataDiffObjectResult,
    IMetadataDiffOrgObject,
    IMetadataDiffRecipeObject,
    METADATA_DIFF_FIELD_STATUSES
} from '../RecipeCockpitMetadataDiff';

const mocksPath = path.join(__dirname, 'mocks', 'metadataDiff');

interface IRecipeFixture {
    objects: IRecipeCockpitObjectViewModel[];
    picklistValuesByObjectApiName: Record<string, Record<string, string[]>>;
}

function loadRecipeFixture(): IRecipeFixture {
    return JSON.parse(fs.readFileSync(path.join(mocksPath, 'recipeObjects.json'), 'utf-8'));
}

function loadOrgFixture(): INormalizedOrgObjectDescribe[] {
    return JSON.parse(fs.readFileSync(path.join(mocksPath, 'orgDescribes.json'), 'utf-8'));
}

function toPicklistMap(picklistValuesByObjectApiName: Record<string, Record<string, string[]>>): Map<string, Map<string, string[]>> {
    return new Map(Object.entries(picklistValuesByObjectApiName).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]));
}

function diffFixtures() {
    const recipeFixture = loadRecipeFixture();
    return RecipeCockpitMetadataDiff.computeMetadataDiff(recipeFixture.objects, loadOrgFixture(), toPicklistMap(recipeFixture.picklistValuesByObjectApiName));
}

function findObject(objectResults: IMetadataDiffObjectResult[], objectApiName: string): IMetadataDiffObjectResult {
    const objectResult = objectResults.find(candidate => candidate.objectApiName === objectApiName);
    expect(objectResult).toBeDefined();
    return objectResult as IMetadataDiffObjectResult;
}

function findField(objectResult: IMetadataDiffObjectResult, fieldApiName: string): IMetadataDiffFieldResult {
    const fieldResult = objectResult.fields.find(candidate => candidate.fieldApiName === fieldApiName);
    expect(fieldResult).toBeDefined();
    return fieldResult as IMetadataDiffFieldResult;
}

function recipeObject(objectApiName: string, fields: Array<[string, string]>): IMetadataDiffRecipeObject {
    return { objectApiName: objectApiName, fields: fields.map(([fieldApiName, fieldType]) => ({ fieldApiName, fieldType })) };
}

function orgObject(objectApiName: string, fields: Array<[string, string, string[]?]>): IMetadataDiffOrgObject {
    return {
        objectApiName: objectApiName,
        fields: fields.map(([fieldApiName, fieldType, picklistValues]) => ({
            fieldApiName: fieldApiName,
            fieldType: fieldType,
            picklistValues: (picklistValues ?? []).map(value => ({ value: value, isActive: true })),
            isCreateable: true
        }))
    };
}

describe('RecipeCockpitMetadataDiff', () => {

    describe('the inputs are the models the cockpit already builds', () => {

        test('the recipe view model and the normalized describe are accepted without conversion', () => {

            // A COMPILE-TIME ASSERTION AS MUCH AS A RUNTIME ONE: ts-jest FAILS THIS FILE IF EITHER MODEL STOPS SATISFYING THE INPUT TYPE
            const recipeObjects: IMetadataDiffRecipeObject[] = loadRecipeFixture().objects;
            const orgObjects: IMetadataDiffOrgObject[] = loadOrgFixture();

            expect(() => RecipeCockpitMetadataDiff.computeMetadataDiff(recipeObjects, orgObjects)).not.toThrow();

        });

        test('the module imports nothing, so it cannot reach vscode, an org or the configuration', () => {

            const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitMetadataDiff.ts'), 'utf-8');

            expect(moduleSource).not.toMatch(/^\s*import\s/m);
            expect(moduleSource).not.toMatch(/\brequire\s*\(/);

        });

    });

    describe('computeMetadataDiff, against the fixtures', () => {

        test('a field in the org and not in the recipe is new-in-org', () => {

            const regionField = findField(findObject(diffFixtures().objects, 'Account'), 'Region__c');

            expect(regionField).toEqual({
                fieldApiName: 'Region__c',
                status: 'new-in-org',
                recipeFieldType: '',
                orgFieldType: 'string',
                isTypeComparable: false,
                addedPicklistValues: [],
                removedPicklistValues: []
            });

        });

        test('a field in the recipe and not in the org is removed-from-org', () => {

            const legacyField = findField(findObject(diffFixtures().objects, 'Account'), 'Legacy_Code__c');

            expect(legacyField.status).toBe('removed-from-org');
            expect(legacyField.recipeFieldType).toBe('Text');
            expect(legacyField.orgFieldType).toBe('');
            expect(legacyField.isTypeComparable).toBeTrue();

        });

        test('a field whose metadata type does not describe as the org type is type-changed', () => {

            const ratingField = findField(findObject(diffFixtures().objects, 'Account'), 'Rating__c');

            expect(ratingField.status).toBe('type-changed');
            expect(ratingField.recipeFieldType).toBe('Text');
            expect(ratingField.orgFieldType).toBe('picklist');
            expect(ratingField.addedPicklistValues).toEqual([]);

        });

        test('a picklist whose active values differ is picklist-changed, naming what was added and removed', () => {

            const industryField = findField(findObject(diffFixtures().objects, 'Account'), 'Industry');

            // BANKING IS STILL ON THE ORG'S LIST, BUT INACTIVE -- NOT A VALUE A RECORD CAN BE GIVEN
            expect(industryField.status).toBe('picklist-changed');
            expect(industryField.addedPicklistValues).toEqual(['Technology']);
            expect(industryField.removedPicklistValues).toEqual(['Banking']);

        });

        test('a picklist whose values match in a different order is unchanged', () => {

            const typeField = findField(findObject(diffFixtures().objects, 'Account'), 'Type');

            expect(typeField.status).toBe('unchanged');
            expect(typeField.addedPicklistValues).toEqual([]);
            expect(typeField.removedPicklistValues).toEqual([]);

        });

        test('metadata and describe type vocabularies are mapped rather than compared as strings', () => {

            const numberField = findField(findObject(diffFixtures().objects, 'Account'), 'Number_of_Contacts__c');

            expect(numberField.status).toBe('unchanged');
            expect(numberField.recipeFieldType).toBe('Number');
            expect(numberField.orgFieldType).toBe('double');
            expect(numberField.isTypeComparable).toBeTrue();

        });

        test('a field only the recipe file carries is matched on presence and makes no claim about its type', () => {

            const nameField = findField(findObject(diffFixtures().objects, 'Account'), 'Name');

            expect(nameField.status).toBe('unchanged');
            expect(nameField.isTypeComparable).toBeFalse();

        });

        test('org fields a recipe cannot write are counted, never listed as new-in-org', () => {

            const accountResult = findObject(diffFixtures().objects, 'Account');

            expect(accountResult.fields.map(fieldResult => fieldResult.fieldApiName)).not.toIncludeAnyMembers(['Id', 'CreatedDate']);
            expect(accountResult.uncreateableOrgOnlyFieldCount).toBe(2);

        });

        test('an object only the recipe has is recipe-only, and every field is removed-from-org', () => {

            const contactResult = findObject(diffFixtures().objects, 'Contact');

            expect(contactResult.presence).toBe('recipe-only');
            expect(contactResult.fields.map(fieldResult => fieldResult.status)).toEqual(['removed-from-org']);

        });

        test('an object only the org has is org-only, and every createable field is new-in-org', () => {

            const opportunityResult = findObject(diffFixtures().objects, 'Opportunity');

            expect(opportunityResult.presence).toBe('org-only');
            expect(opportunityResult.fields.map(fieldResult => [fieldResult.fieldApiName, fieldResult.status])).toEqual([['StageName', 'new-in-org']]);
            expect(opportunityResult.uncreateableOrgOnlyFieldCount).toBe(1);

        });

        test('status counts total per object and across the diff', () => {

            const diffResult = diffFixtures();

            expect(findObject(diffResult.objects, 'Account').statusCounts).toEqual({
                'new-in-org': 1, 'removed-from-org': 1, 'type-changed': 1, 'picklist-changed': 1, 'unchanged': 3
            });
            expect(diffResult.statusCounts).toEqual({
                'new-in-org': 2, 'removed-from-org': 2, 'type-changed': 1, 'picklist-changed': 1, 'unchanged': 3
            });

        });

        test('the whole result is ordered by api name, whatever order either side arrived in', () => {

            const recipeFixture = loadRecipeFixture();
            const picklistMap = toPicklistMap(recipeFixture.picklistValuesByObjectApiName);

            const forwardResult = RecipeCockpitMetadataDiff.computeMetadataDiff(recipeFixture.objects, loadOrgFixture(), picklistMap);

            const reversedRecipe = [...recipeFixture.objects].reverse().map(objectViewModel => ({ ...objectViewModel, fields: [...objectViewModel.fields].reverse() }));
            const reversedOrg = [...loadOrgFixture()].reverse().map(describe => ({ ...describe, fields: [...describe.fields].reverse() }));
            const reversedResult = RecipeCockpitMetadataDiff.computeMetadataDiff(reversedRecipe, reversedOrg, picklistMap);

            expect(reversedResult).toEqual(forwardResult);
            expect(forwardResult.objects.map(objectResult => objectResult.objectApiName)).toEqual(['Account', 'Contact', 'Opportunity']);
            expect(findObject(forwardResult.objects, 'Account').fields.map(fieldResult => fieldResult.fieldApiName)).toEqual([
                'Industry', 'Legacy_Code__c', 'Name', 'Number_of_Contacts__c', 'Rating__c', 'Region__c', 'Type'
            ]);

        });

    });

    describe('computeMetadataDiff, edge cases', () => {

        test('empty inputs give an empty diff', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff([], []);

            expect(diffResult.objects).toEqual([]);
            expect(diffResult.statusCounts).toEqual(RecipeCockpitMetadataDiff.buildEmptyStatusCounts());

        });

        test('api names match case-insensitively and keep the recipe spelling', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('account', [['legacy_code__c', 'Text']])],
                [orgObject('Account', [['Legacy_Code__c', 'string']])]
            );

            expect(diffResult.objects).toHaveLength(1);
            expect(diffResult.objects[0].objectApiName).toBe('account');
            expect(diffResult.objects[0].presence).toBe('in-both');
            expect(diffResult.objects[0].fields).toEqual([expect.objectContaining({ fieldApiName: 'legacy_code__c', status: 'unchanged' })]);

        });

        test('a picklist field the recipe recorded no values for is not compared on its values', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist']])],
                [orgObject('Account', [['Industry', 'picklist', ['Agriculture']]])]
            );

            expect(diffResult.objects[0].fields[0].status).toBe('unchanged');

        });

        test('an empty recorded value list is a claim, so every org value is added', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist']])],
                [orgObject('Account', [['Industry', 'picklist', ['Retail', 'Agriculture']]])],
                new Map([['Account', new Map([['Industry', []]])]])
            );

            expect(diffResult.objects[0].fields[0]).toEqual(expect.objectContaining({
                status: 'picklist-changed',
                addedPicklistValues: ['Agriculture', 'Retail'],
                removedPicklistValues: []
            }));

        });

        test('recorded picklist values are looked up case-insensitively by object and field', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist']])],
                [orgObject('Account', [['Industry', 'picklist', ['Retail']]])],
                new Map([['ACCOUNT', new Map([['industry', ['Retail', 'Banking']]])]])
            );

            expect(diffResult.objects[0].fields[0]).toEqual(expect.objectContaining({ status: 'picklist-changed', removedPicklistValues: ['Banking'] }));

        });

        test('a picklist recorded on the recipe side is not compared once the org has made it another type', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist']])],
                [orgObject('Account', [['Industry', 'string']])],
                new Map([['Account', new Map([['Industry', ['Retail']]])]])
            );

            expect(diffResult.objects[0].fields[0]).toEqual(expect.objectContaining({ status: 'type-changed', removedPicklistValues: [] }));

        });

        test('a multi-select picklist compares its values like a picklist', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Regions__c', 'MultiselectPicklist']])],
                [orgObject('Account', [['Regions__c', 'multipicklist', ['East', 'West']]])],
                new Map([['Account', new Map([['Regions__c', ['East']]])]])
            );

            expect(diffResult.objects[0].fields[0]).toEqual(expect.objectContaining({ status: 'picklist-changed', addedPicklistValues: ['West'] }));

        });

        test('a metadata type with no describe equivalent is never reported as a type change', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Total__c', 'Summary']])],
                [orgObject('Account', [['Total__c', 'double']])]
            );

            expect(diffResult.objects[0].fields[0]).toEqual(expect.objectContaining({ status: 'unchanged', isTypeComparable: false }));

        });

        test('a name that repeats on one side in another case is diffed once', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist'], ['INDUSTRY', 'Text']]), recipeObject('ACCOUNT', [])],
                [orgObject('Account', [['Industry', 'picklist']])]
            );

            expect(diffResult.objects).toHaveLength(1);
            expect(diffResult.objects[0].fields).toEqual([expect.objectContaining({ fieldApiName: 'Industry', status: 'unchanged' })]);

        });

        test('recorded picklist values that repeat an object or field in another case are read once, first entry first', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('Account', [['Industry', 'Picklist']])],
                [orgObject('Account', [['Industry', 'picklist', ['Retail']]])],
                new Map([
                    ['Account', new Map([['Industry', ['Retail']], ['INDUSTRY', ['Banking']]])],
                    ['ACCOUNT', new Map([['Industry', ['Banking']]])]
                ])
            );

            expect(diffResult.objects[0].fields[0].status).toBe('unchanged');

        });

        test('names that differ only in case sort together and in a total order', () => {

            const diffResult = RecipeCockpitMetadataDiff.computeMetadataDiff(
                [recipeObject('b', []), recipeObject('A', [])],
                [orgObject('a', []), orgObject('B', [])]
            );

            expect(diffResult.objects.map(objectResult => objectResult.objectApiName)).toEqual(['A', 'b']);

        });

    });

    describe('type mapping', () => {

        test.each([
            ['Text', 'string'], ['TextArea', 'textarea'], ['LongTextArea', 'textarea'], ['Html', 'textarea'],
            ['EncryptedText', 'encryptedstring'], ['Email', 'email'], ['Phone', 'phone'], ['Url', 'url'],
            ['Number', 'double'], ['Number', 'int'], ['Number', 'long'], ['Percent', 'percent'], ['Currency', 'currency'],
            ['Checkbox', 'boolean'], ['Date', 'date'], ['DateTime', 'datetime'], ['Time', 'time'],
            ['Picklist', 'picklist'], ['MultiselectPicklist', 'multipicklist'],
            ['Lookup', 'reference'], ['MasterDetail', 'reference'], ['Hierarchy', 'reference'],
            ['ExternalLookup', 'reference'], ['IndirectLookup', 'reference'],
            ['AutoNumber', 'string'], ['Location', 'location']
        ])('%s describes as %s', (recipeFieldType, orgFieldType) => {

            expect(RecipeCockpitMetadataDiff.isSameFieldType(recipeFieldType, orgFieldType)).toBeTrue();

        });

        test('a mapped type that describes as something else is not the same type', () => {

            expect(RecipeCockpitMetadataDiff.isSameFieldType('Checkbox', 'string')).toBeFalse();

        });

        test('an unmapped or empty type is not comparable', () => {

            expect(RecipeCockpitMetadataDiff.isTypeMapped('')).toBeFalse();
            expect(RecipeCockpitMetadataDiff.isTypeMapped('Summary')).toBeFalse();
            expect(RecipeCockpitMetadataDiff.isSameFieldType('Summary', 'double')).toBeFalse();

        });

        test('every status has a count', () => {

            expect(Object.keys(RecipeCockpitMetadataDiff.buildEmptyStatusCounts())).toEqual([...METADATA_DIFF_FIELD_STATUSES]);

        });

    });

});
