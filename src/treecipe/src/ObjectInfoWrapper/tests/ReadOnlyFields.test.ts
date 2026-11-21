import * as fs from 'fs';
import * as path from 'path';
import { ReadOnlyFields } from '../ReadOnlyFields';
import { SalesforceApiName } from '../../SalesforceApiName/SalesforceApiName';

describe('ReadOnlyFields (#685)', () => {

    describe('custom fields', () => {

        test.each([
            ['Number', true, 'formula'],
            ['Text', true, 'formula'],
            ['Checkbox', true, 'formula'],
            ['Date', true, 'formula'],
            ['Summary', false, 'roll-up summary'],
            ['AutoNumber', false, 'auto number'],
            ['autonumber', false, 'auto number']
        ])('a %s field with formula=%s is read only as "%s"', (fieldType, hasFormula, expectedReason) => {

            expect(ReadOnlyFields.resolveCustomFieldReason(fieldType, hasFormula)).toBe(expectedReason);

        });

        test('a field with no <type> and no formula is not read only', () => {

            expect(ReadOnlyFields.resolveCustomFieldReason(undefined, false)).toBeUndefined();

        });

        test.each(['Text', 'Number', 'Lookup', 'Picklist', 'AUTO_GENERATED', 'constructor', '__proto__', 'toString'])('a %s field with no formula is not read only', fieldType => {

            expect(ReadOnlyFields.resolveCustomFieldReason(fieldType, false)).toBeUndefined();

        });

    });

    describe('standard fields', () => {

        test('holds exactly the confirmed set, so a new entry is a decision made in a test', () => {

            expect(ReadOnlyFields.listStandardReadOnlyObjectFields().sort()).toEqual([
                'Asset.RootAssetId',
                'Campaign.AmountAllOpportunities',
                'Campaign.AmountWonOpportunities',
                'Campaign.NumberOfContacts',
                'Campaign.NumberOfConvertedLeads',
                'Campaign.NumberOfLeads',
                'Campaign.NumberOfOpportunities',
                'Campaign.NumberOfResponses',
                'Campaign.NumberOfWonOpportunities',
                'CampaignMember.LeadOrContactId',
                'Case.IsClosed',
                'Opportunity.ExpectedRevenue',
                'Opportunity.Fiscal',
                'Opportunity.FiscalQuarter',
                'Opportunity.FiscalYear',
                'Opportunity.ForecastCategory',
                'Opportunity.HasOpportunityLineItem',
                'Opportunity.IsClosed',
                'Opportunity.IsWon'
            ]);

        });

        test('every listed object and field is a Salesforce api name', () => {

            ReadOnlyFields.listStandardReadOnlyObjectFields().forEach(objectField => {
                const [objectApiName, fieldApiName] = objectField.split('.');
                expect(SalesforceApiName.isApiName(objectApiName)).toBe(true);
                expect(SalesforceApiName.isApiName(fieldApiName)).toBe(true);
                expect(ReadOnlyFields.isStandardReadOnlyField(objectApiName, fieldApiName)).toBe(true);
            });

        });

        test.each([
            ['Opportunity', 'Amount'],
            ['Opportunity', 'ForecastCategoryName'],
            ['Campaign', 'ExpectedRevenue'],
            ['opportunity', 'IsWon'],
            ['Opportunity', 'iswon'],
            ['constructor', ''],
            ['__proto__', ''],
            ['Opportunity', 'toString']
        ])('%s.%s is not on the list', (objectApiName, fieldApiName) => {

            expect(ReadOnlyFields.isStandardReadOnlyField(objectApiName, fieldApiName)).toBe(false);

        });

    });

    describe('the recipe value', () => {

        test.each(['formula', 'roll-up summary', 'auto number', 'set by Salesforce'] as const)('"%s" is written as READ ONLY -- %s and read back', reason => {

            const recipeValue = ReadOnlyFields.formatRecipeValue(reason);

            expect(recipeValue).toBe(`READ ONLY -- ${reason}`);
            expect(ReadOnlyFields.readReason(recipeValue)).toBe(reason);
            expect(ReadOnlyFields.isReadOnlyRecipeValue(recipeValue)).toBe(true);

        });

        test.each([
            ['an unknown reason', 'READ ONLY -- because'],
            ['the prefix alone', 'READ ONLY -- '],
            ['a lowercase prefix', 'read only -- formula'],
            ['a faker expression', '${{ faker.number.int() }}'],
            ['a nickname', 'Account_NickName'],
            ['a number', 5],
            ['nothing', null]
        ])('is not read only for %s', (unusedCase, recipeValue) => {

            expect(ReadOnlyFields.isReadOnlyRecipeValue(recipeValue)).toBe(false);

        });

    });

    test('imports nothing, so the panel bundle can read it', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'ReadOnlyFields.ts'), 'utf-8');

        expect(source).not.toMatch(/^\s*import\b/m);
        expect(source).not.toMatch(/\brequire\(/);

    });

});
