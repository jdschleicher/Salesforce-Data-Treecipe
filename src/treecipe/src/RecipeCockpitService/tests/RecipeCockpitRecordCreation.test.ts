import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

import { ICreateDescribeField, ICreateObjectDescribe, RecipeCockpitRecordCreation, RECIPE_COCKPIT_CREATE_MAX_COUNT } from '../RecipeCockpitRecordCreation';

function buildField(fieldApiName: string, overrides: Partial<ICreateDescribeField> = {}): ICreateDescribeField {

    return {
        fieldApiName: fieldApiName,
        fieldType: 'string',
        referenceTo: [],
        isNillable: true,
        isCreateable: true,
        isDefaultedOnCreate: false,
        ...overrides
    };

}

const lookup = (fieldApiName: string, referenceTo: string[], overrides: Partial<ICreateDescribeField> = {}) =>
    buildField(fieldApiName, { fieldType: 'reference', referenceTo: referenceTo, ...overrides });

// A CONTACT WITH ONE OF EVERY KIND OF LOOKUP A CREATE HAS TO TELL APART
const CONTACT_DESCRIBE: ICreateObjectDescribe = {
    objectApiName: 'Contact',
    isCreateable: true,
    fields: [
        buildField('LastName', { isNillable: false }),
        lookup('AccountId', ['Account'], { isNillable: false }),
        lookup('Master__c', ['Master__c'], { isNillable: false }),
        lookup('OwnerId', ['Group', 'User'], { isNillable: false, isDefaultedOnCreate: true }),
        lookup('CreatedById', ['User'], { isNillable: false, isCreateable: false }),
        lookup('ReportsToId', ['Contact']),
        lookup('RecordTypeId', ['RecordType'])
    ]
};

const SANDBOX = { isSandbox: true, organizationType: 'Unlimited Edition' };

describe('RecipeCockpitRecordCreation', () => {

    it('imports nothing, so every rule is asserted on plain values', () => {

        const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRecordCreation.ts'), 'utf-8');

        expect(moduleSource).not.toMatch(/^\s*import\s/m);
        expect(moduleSource).not.toMatch(/require\(/);

    });

    describe('isValidCreateCount', () => {

        it.each([1, 25, RECIPE_COCKPIT_CREATE_MAX_COUNT])('accepts %p', candidateCount => {
            expect(RecipeCockpitRecordCreation.isValidCreateCount(candidateCount)).toBe(true);
        });

        it.each([0, 201, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '25', 'abc', null, undefined, [3], { count: 3 }])('refuses %p', candidateCount => {
            expect(RecipeCockpitRecordCreation.isValidCreateCount(candidateCount)).toBe(false);
        });

    });

    describe('findRequiredLookups', () => {

        it('is every lookup the describe marks not nillable, master-detail included, leaving out what the org fills or the user cannot write', () => {

            expect(RecipeCockpitRecordCreation.findRequiredLookups(CONTACT_DESCRIBE)).toEqual([
                { fieldApiName: 'AccountId', referenceTo: ['Account'] },
                { fieldApiName: 'Master__c', referenceTo: ['Master__c'] }
            ]);

        });

        it('leaves every other lookup to be blanked, RecordTypeId excepted', () => {

            expect(RecipeCockpitRecordCreation.findOptionalLookupFieldApiNames(CONTACT_DESCRIBE)).toEqual(['OwnerId', 'CreatedById', 'ReportsToId']);

        });

    });

    describe('buildCreateReadiness, the production and fail-closed guards', () => {


        it('offers Create in a sandbox for a createable object, without asking whether its required parents have records', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: CONTACT_DESCRIBE
            })).toEqual({
                objectApiName: 'Contact',
                disabledReason: '',
                requiredLookups: [
                    { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                    { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c' }
                ]
            });

        });

        it.each([
            ['Production', { isSandbox: false, organizationType: 'Enterprise Edition' }, 'Production · Enterprise Edition'],
            ['a Developer Edition', { isSandbox: false, organizationType: 'Developer Edition' }, 'Production · Developer Edition']
        ])('refuses %s, whatever else is true', (_description, orgTypeDetail, expectedText) => {

            const readiness = RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: orgTypeDetail, describe: CONTACT_DESCRIBE
            });

            expect(readiness.disabledReason).toContain('only in a sandbox');
            expect(readiness.disabledReason).toContain(expectedText);

        });

        it('fails closed when the Organization query failed', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: undefined, describe: CONTACT_DESCRIBE
            }).disabledReason).toBe('The org\'s type could not be read, so nothing is created in it.');

        });

        it('fails closed on a sandbox flag that is not the boolean true', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: { isSandbox: 'true' as any, organizationType: '' }, describe: CONTACT_DESCRIBE
            }).disabledReason).not.toBe('');

        });

        it('refuses an object the org does not have, and one it does not let the user create', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Ghost__c', orgTypeDetail: SANDBOX, describeFailureMessage: 'NOT_FOUND'
            }).disabledReason).toBe('Ghost__c is not in this org (NOT_FOUND).');

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: { ...CONTACT_DESCRIBE, isCreateable: false }
            }).disabledReason).toBe('Contact is not createable in this org.');

        });

        it('refuses a required lookup that is polymorphic', () => {

            const readiness = RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Task', orgTypeDetail: SANDBOX,
                describe: { objectApiName: 'Task', isCreateable: true, fields: [lookup('WhatId', ['Account', 'Opportunity'], { isNillable: false })] }
            });

            expect(readiness.disabledReason).toContain('WhatId is required and can point at more than one object (Account, Opportunity)');

        });

        it('takes no parent counts and names none, because the Create asks for parent Ids only after the reader confirms', () => {

            const readiness = RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: CONTACT_DESCRIBE
            });

            expect(readiness.disabledReason).toBe('');
            readiness.requiredLookups.forEach(requiredLookup => expect(Object.keys(requiredLookup).sort()).toEqual(['fieldApiName', 'parentObjectApiName']));

        });

    });

    describe('buildCreateReadiness, the recipe fields the insert would send (#210)', () => {

        const contactDescribe: ICreateObjectDescribe = {
            ...CONTACT_DESCRIBE,
            fields: [...CONTACT_DESCRIBE.fields, buildField('Email'), buildField('Legacy_Id__c', { isCreateable: false }), buildField('Name', { isCreateable: false })]
        };
        const readinessOf = (recipeFieldApiNames: readonly string[], overrides: Partial<Parameters<typeof RecipeCockpitRecordCreation.buildCreateReadiness>[0]> = {}) =>
            RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: contactDescribe,
                recipeFieldApiNames: recipeFieldApiNames, ...overrides
            });

        it('offers Create when the describe has every recipe field, and records that nothing is missing', () => {

            expect(readinessOf(['LastName', 'Email', 'AccountId', 'RecordTypeId'])).toEqual({
                objectApiName: 'Contact',
                disabledReason: '',
                requiredLookups: [
                    { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                    { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c' }
                ],
                missingFieldApiNames: [],
                notCreateableFieldApiNames: []
            });

        });

        it('refuses a field the describe does not have, naming it and the count', () => {

            const readiness = readinessOf(['LastName', 'Region__c']);

            expect(readiness.disabledReason).toBe('Contact is missing 1 recipe field in this org: Region__c.');
            expect(readiness.missingFieldApiNames).toEqual(['Region__c']);
            expect(readiness.notCreateableFieldApiNames).toEqual([]);

        });

        it('reports a lookup the describe does not have as missing, since the Create leaves it in every record', () => {

            expect(readinessOf(['LastName', 'Partner__c']).missingFieldApiNames).toEqual(['Partner__c']);

        });

        it('refuses a field the org will not let the user set, and never a lookup the describe knows, which the Create removes', () => {

            const readiness = readinessOf(['LastName', 'Legacy_Id__c', 'CreatedById']);

            expect(readiness.disabledReason).toBe('Contact has 1 recipe field this org will not let you set: Legacy_Id__c.');
            expect(readiness.notCreateableFieldApiNames).toEqual(['Legacy_Id__c']);

        });

        it('keeps the required lookups on a row the fields refuse, so its tooltip still names them', () => {

            expect(readinessOf(['Region__c']).requiredLookups).toEqual([
                { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c' }
            ]);

        });

        it('names both kinds in one reason', () => {

            expect(readinessOf(['Region__c', 'Tier__c', 'Legacy_Id__c', 'Name']).disabledReason).toBe(
                'Contact is missing 2 recipe fields in this org: Region__c, Tier__c. Contact has 2 recipe fields this org will not let you set: Legacy_Id__c, Name.'
            );

        });

        it('spells out ten names and counts the rest, while the view model carries them all', () => {

            const missingFieldApiNames = Array.from({ length: 13 }, (_unused, index) => `Missing_${index + 1}__c`);
            const readiness = readinessOf(missingFieldApiNames);

            expect(readiness.disabledReason).toBe(`Contact is missing 13 recipe fields in this org: ${missingFieldApiNames.slice(0, 10).join(', ')} and 3 more.`);
            expect(readiness.missingFieldApiNames).toEqual(missingFieldApiNames);

        });

        it('matches names case-insensitively, as Salesforce does, and reports them as the recipe writes them', () => {

            expect(readinessOf(['lastname', 'EMAIL', 'accountid']).disabledReason).toBe('');
            expect(readinessOf(['region__C']).missingFieldApiNames).toEqual(['region__C']);

        });

        it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('reports a recipe field named %s as missing, never as inherited', fieldApiName => {

            expect(readinessOf(['LastName', fieldApiName]).missingFieldApiNames).toEqual([fieldApiName]);

        });

        it('checks the fields before a polymorphic required lookup', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Task', orgTypeDetail: SANDBOX, recipeFieldApiNames: ['Region__c'],
                describe: { objectApiName: 'Task', isCreateable: true, fields: [lookup('WhatId', ['Account', 'Opportunity'], { isNillable: false })] }
            }).disabledReason).toBe('Task is missing 1 recipe field in this org: Region__c.');

        });

        it('leaves the production, org-type, missing-object and uncreateable refusals first, with no field lists', () => {

            const production = readinessOf(['Region__c'], { orgTypeDetail: { isSandbox: false, organizationType: 'Enterprise Edition' } });
            expect(production.disabledReason).toContain('only in a sandbox');
            expect(production.missingFieldApiNames).toBeUndefined();

            expect(readinessOf(['Region__c'], { orgTypeDetail: undefined }).disabledReason).toBe('The org\'s type could not be read, so nothing is created in it.');
            expect(readinessOf(['Region__c'], { describe: undefined, describeFailureMessage: 'NOT_FOUND' }).disabledReason).toBe('Contact is not in this org (NOT_FOUND).');
            expect(readinessOf(['Region__c'], { describe: { ...contactDescribe, isCreateable: false } }).disabledReason).toBe('Contact is not createable in this org.');

        });

        it('refuses with the reason the block could not be read, after the guards that come first', () => {

            expect(readinessOf(undefined as any, { recipeFieldRefusalReason: 'The recipe file is gone.' }).disabledReason).toBe('The recipe file is gone.');
            expect(readinessOf(undefined as any, { recipeFieldRefusalReason: 'The recipe file is gone.', describe: { ...contactDescribe, isCreateable: false } }).disabledReason)
                .toBe('Contact is not createable in this org.');

        });

        it('checks no field when it is handed none, as before', () => {

            const readiness = readinessOf(undefined as any);

            expect(readiness.disabledReason).toBe('');
            expect(readiness).not.toHaveProperty('missingFieldApiNames');

        });

    });

    describe('assignLookupIds, tested pure', () => {

        const generatedRecords = [
            { attributes: { type: 'Contact', referenceId: 'Contact_Reference_1__Contact_NickName' }, LastName: 'Ng', AccountId: null, Master__c: 'Master__c_NickName', ReportsToId: 'Contact_NickName', RecordTypeId: 'Contact.Partner' },
            { attributes: { type: 'Contact', referenceId: 'Contact_Reference_2__Contact_NickName' }, LastName: 'Li', AccountId: 'Account_NickName' }
        ];

        it('fills each required lookup with the parent Id the pick names, removes every other lookup, and keeps the rest', () => {

            const pickedChoiceCounts: number[] = [];
            const picks = [1, 0, 2, 1];
            const pickIndex = (choiceCount: number) => { pickedChoiceCounts.push(choiceCount); return picks.shift(); };

            const assignedRecords = RecipeCockpitRecordCreation.assignLookupIds(
                generatedRecords,
                [
                    { fieldApiName: 'AccountId', parentRecordIds: ['001A', '001B', '001C'] },
                    { fieldApiName: 'Master__c', parentRecordIds: ['a00A', 'a00B'] }
                ],
                ['ReportsToId', 'OwnerId'],
                pickIndex
            );

            expect(assignedRecords).toEqual([
                { attributes: { type: 'Contact', referenceId: 'Contact_Reference_1__Contact_NickName' }, LastName: 'Ng', AccountId: '001B', Master__c: 'a00A', RecordTypeId: 'Contact.Partner' },
                { attributes: { type: 'Contact', referenceId: 'Contact_Reference_2__Contact_NickName' }, LastName: 'Li', AccountId: '001C', Master__c: 'a00B' }
            ]);
            expect(pickedChoiceCounts).toEqual([3, 2, 3, 2]);

        });

        it('replaces a lookup whatever case the recipe wrote its key in, as Salesforce reads field names', () => {

            const [assignedRecord] = RecipeCockpitRecordCreation.assignLookupIds(
                [{ LastName: 'Ng', accountid: 'Account_NickName', REPORTSTOID: 'Contact_NickName' }],
                [{ fieldApiName: 'AccountId', parentRecordIds: ['001A'] }],
                ['ReportsToId'],
                () => 0
            );

            expect(assignedRecord).toEqual({ LastName: 'Ng', AccountId: '001A' });

        });

        it('leaves the records it was handed unchanged', () => {

            const handedRecords = JSON.parse(JSON.stringify(generatedRecords));

            RecipeCockpitRecordCreation.assignLookupIds(handedRecords, [{ fieldApiName: 'AccountId', parentRecordIds: ['001A'] }], ['ReportsToId'], () => 0);

            expect(handedRecords).toEqual(generatedRecords);

        });

        it('keeps a pick in range whatever the randomness answers', () => {

            const [lowRecord, highRecord] = [-5, 99].map(pickedIndex => RecipeCockpitRecordCreation.assignLookupIds(
                [{ AccountId: null }], [{ fieldApiName: 'AccountId', parentRecordIds: ['001A', '001B'] }], [], () => pickedIndex
            )[0]);

            expect(lowRecord).toEqual({ AccountId: '001A' });
            expect(highRecord).toEqual({ AccountId: '001B' });

        });

        it('passes anything that is not a record through untouched', () => {

            expect(RecipeCockpitRecordCreation.assignLookupIds([null, 'x', [1]], [{ fieldApiName: 'AccountId', parentRecordIds: ['001A'] }], [], () => 0))
                .toEqual([null, 'x', [1]]);

        });

    });

});
