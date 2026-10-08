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

        const parentCounts = new Map<string, number | undefined>([['Account', 12], ['Master__c', 3]]);

        it('offers Create in a sandbox for a createable object whose required parents have records', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: CONTACT_DESCRIBE, parentRecordCountsByObject: parentCounts
            })).toEqual({
                objectApiName: 'Contact',
                disabledReason: '',
                requiredLookups: [
                    { fieldApiName: 'AccountId', parentObjectApiName: 'Account', parentRecordCount: 12 },
                    { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c', parentRecordCount: 3 }
                ]
            });

        });

        it.each([
            ['Production', { isSandbox: false, organizationType: 'Enterprise Edition' }, 'Production · Enterprise Edition'],
            ['a Developer Edition', { isSandbox: false, organizationType: 'Developer Edition' }, 'Production · Developer Edition']
        ])('refuses %s, whatever else is true', (_description, orgTypeDetail, expectedText) => {

            const readiness = RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: orgTypeDetail, describe: CONTACT_DESCRIBE, parentRecordCountsByObject: parentCounts
            });

            expect(readiness.disabledReason).toContain('only in a sandbox');
            expect(readiness.disabledReason).toContain(expectedText);

        });

        it('fails closed when the Organization query failed', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: undefined, describe: CONTACT_DESCRIBE, parentRecordCountsByObject: parentCounts
            }).disabledReason).toBe('The org\'s type could not be read, so nothing is created in it.');

        });

        it('fails closed on a sandbox flag that is not the boolean true', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: { isSandbox: 'true' as any, organizationType: '' }, describe: CONTACT_DESCRIBE, parentRecordCountsByObject: parentCounts
            }).disabledReason).not.toBe('');

        });

        it('refuses an object the org does not have, and one it does not let the user create', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Ghost__c', orgTypeDetail: SANDBOX, describeFailureMessage: 'NOT_FOUND', parentRecordCountsByObject: parentCounts
            }).disabledReason).toBe('Ghost__c is not in this org (NOT_FOUND).');

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: { ...CONTACT_DESCRIBE, isCreateable: false }, parentRecordCountsByObject: parentCounts
            }).disabledReason).toBe('Contact is not createable in this org.');

        });

        it('refuses a required lookup that is polymorphic', () => {

            const readiness = RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Task', orgTypeDetail: SANDBOX, parentRecordCountsByObject: parentCounts,
                describe: { objectApiName: 'Task', isCreateable: true, fields: [lookup('WhatId', ['Account', 'Opportunity'], { isNillable: false })] }
            });

            expect(readiness.disabledReason).toContain('WhatId is required and can point at more than one object (Account, Opportunity)');

        });

        it('refuses when a required parent has 0 records, or could not be counted', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: CONTACT_DESCRIBE,
                parentRecordCountsByObject: new Map([['Account', 0], ['Master__c', 3]])
            }).disabledReason).toBe('AccountId needs a Account record, and the org has none.');

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: CONTACT_DESCRIBE,
                parentRecordCountsByObject: new Map([['Account', 2]])
            }).disabledReason).toBe('Master__c needs a Master__c record, and Master__c could not be counted.');

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
