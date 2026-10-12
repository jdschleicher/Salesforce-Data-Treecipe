import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

import {
    COLLECTIONS_API_RECORDS_PER_REQUEST,
    ICreateDescribeField,
    ICreateObjectDescribe,
    ITreeInsertLookupContext,
    RecipeCockpitRecordCreation,
    RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD
} from '../RecipeCockpitRecordCreation';

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

    describe('countInsertRequests and the large-insert threshold', () => {

        it('is 200 records to a request, per object, rounded up', () => {

            expect(COLLECTIONS_API_RECORDS_PER_REQUEST).toBe(200);
            expect(RecipeCockpitRecordCreation.countInsertRequests(new Map([['Account', 300], ['Contact', 1500]]))).toBe(2 + 8);
            expect(RecipeCockpitRecordCreation.countInsertRequests(new Map([['Account', 200]]))).toBe(1);
            expect(RecipeCockpitRecordCreation.countInsertRequests(new Map([['Account', 1]]))).toBe(1);
            expect(RecipeCockpitRecordCreation.countInsertRequests(new Map())).toBe(0);

        });

        it('warns past 2,000 records, ten requests of the API\'s limit', () => {

            expect(RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD).toBe(2000);
            expect(RecipeCockpitRecordCreation.countInsertRequests(new Map([['Account', RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD]]))).toBe(10);

        });

    });

    describe('findRequiredLookups', () => {

        it('is every lookup the describe marks not nillable, master-detail included, leaving out what the org fills or the user cannot write', () => {

            expect(RecipeCockpitRecordCreation.findRequiredLookups(CONTACT_DESCRIBE)).toEqual([
                { fieldApiName: 'AccountId', referenceTo: ['Account'] },
                { fieldApiName: 'Master__c', referenceTo: ['Master__c'] }
            ]);

        });

    });

    describe('findTreeInsertLookups', () => {

        it('is every lookup but RecordTypeId, with its one parent and whether the org requires it', () => {

            expect(RecipeCockpitRecordCreation.findTreeInsertLookups(CONTACT_DESCRIBE)).toEqual([
                { fieldApiName: 'AccountId', parentObjectApiName: 'Account', isRequired: true },
                { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c', isRequired: true },
                { fieldApiName: 'OwnerId', isRequired: false },
                { fieldApiName: 'CreatedById', parentObjectApiName: 'User', isRequired: false },
                { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact', isRequired: false }
            ]);

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

            expect(readiness.disabledReason).toContain('only into a sandbox or scratch org');
            expect(readiness.disabledReason).toContain(expectedText);

        });

        it('fails closed when the Organization query failed', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: undefined, describe: CONTACT_DESCRIBE
            }).disabledReason).toBe('The org\'s type could not be read, so nothing is inserted into it.');

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

    describe('buildCreateReadiness no longer checks the recipe\'s fields against the describe (#264)', () => {

        // A DESCRIBE THAT LACKS EVERY CUSTOM FIELD A RECIPE COULD CARRY AND WILL NOT LET THE USER SET Name
        const contactDescribe: ICreateObjectDescribe = {
            ...CONTACT_DESCRIBE,
            fields: [...CONTACT_DESCRIBE.fields, buildField('Legacy_Id__c', { isCreateable: false }), buildField('Name', { isCreateable: false })]
        };
        const readinessOf = (overrides: Partial<Parameters<typeof RecipeCockpitRecordCreation.buildCreateReadiness>[0]> = {}) =>
            RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Contact', orgTypeDetail: SANDBOX, describe: contactDescribe, ...overrides
            });

        it('offers the insert on a sandbox whose describe lacks fields or will not let them be set, carrying no field lists', () => {

            const readiness = readinessOf();

            expect(readiness).toEqual({
                objectApiName: 'Contact',
                disabledReason: '',
                requiredLookups: [
                    { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                    { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c' }
                ]
            });
            expect(readiness).not.toHaveProperty('missingFieldApiNames');
            expect(readiness).not.toHaveProperty('notCreateableFieldApiNames');
            expect(readiness).not.toHaveProperty('isMetadataDeployable');

        });

        it('no longer has the field check, its reason or its field lists', () => {

            const recordCreation = RecipeCockpitRecordCreation as unknown as Record<string, unknown>;
            expect(recordCreation.checkRecipeFields).toBeUndefined();
            expect(recordCreation.buildFieldCheckReason).toBeUndefined();

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRecordCreation.ts'), 'utf8');
            ['IRecipeFieldCheck', 'missingFieldApiNames', 'notCreateableFieldApiNames', 'recipe field in this org', 'recipe fields in this org', 'will not let you set']
                .forEach(removed => expect(source).not.toContain(removed));

        });

        it('still refuses production, an unreadable org type, a missing object and an uncreateable one, first', () => {

            expect(readinessOf({ orgTypeDetail: { isSandbox: false, organizationType: 'Enterprise Edition' } }).disabledReason).toContain('only into a sandbox or scratch org');
            expect(readinessOf({ orgTypeDetail: undefined }).disabledReason).toBe('The org\'s type could not be read, so nothing is inserted into it.');
            expect(readinessOf({ describe: undefined, describeFailureMessage: 'NOT_FOUND' }).disabledReason).toBe('Contact is not in this org (NOT_FOUND).');
            expect(readinessOf({ describe: { ...contactDescribe, isCreateable: false } }).disabledReason).toBe('Contact is not createable in this org.');

        });

        it('marks no reason as deployable: "Deploy this metadata…" no longer depends on the readiness (#273)', () => {

            expect(readinessOf({ describe: undefined, describeFailureMessage: 'NOT_FOUND' })).not.toHaveProperty('isMetadataDeployable');
            expect(readinessOf({ describe: undefined, describeFailureMessage: 'timed out' })).not.toHaveProperty('isMetadataDeployable');

        });

        it('still refuses with the reason the block could not be read, after the guards that come first', () => {

            expect(readinessOf({ recipeFieldRefusalReason: 'The recipe file is gone.' }).disabledReason).toBe('The recipe file is gone.');
            expect(readinessOf({ recipeFieldRefusalReason: 'The recipe file is gone.', describe: { ...contactDescribe, isCreateable: false } }).disabledReason)
                .toBe('Contact is not createable in this org.');

        });

        it('still refuses an unticked field the org requires, keeping the required lookups', () => {

            const readiness = readinessOf({ excludedFieldApiNames: ['LastName'] });

            expect(readiness.disabledReason).toBe('Contact has 1 unticked field this org requires: LastName. Tick it in the Treecipe tab to insert records.');
            expect(readiness.requiredLookups).toHaveLength(2);

        });

        it('still refuses a polymorphic required lookup', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({
                objectApiName: 'Task', orgTypeDetail: SANDBOX,
                describe: { objectApiName: 'Task', isCreateable: true, fields: [lookup('WhatId', ['Account', 'Opportunity'], { isNillable: false })] }
            }).disabledReason).toContain('WhatId is required and can point at more than one object (Account, Opportunity)');

        });

    });

    describe('prepareTreeInsertRecords, tested pure (#255)', () => {

        const contactLookups = RecipeCockpitRecordCreation.findTreeInsertLookups(CONTACT_DESCRIBE);
        const buildContext = (overrides: Partial<ITreeInsertLookupContext> = {}): ITreeInsertLookupContext => ({
            isRunReference: value => value.startsWith('001RUN') || value === 'Contact_child_NickName',
            runRecordIdsByObject: new Map([['Account', ['001RUN1', '001RUN2']]]),
            orgRecordIdsByObject: new Map([['Master__c', ['a00ORG1', 'a00ORG2']], ['Account', ['001ORG1']]]),
            inTreeObjectApiNames: new Set(['Account', 'Contact']),
            ...overrides
        });

        it('keeps a value that names a record of this insert, and fills an unwired lookup from the run\'s own parents', () => {

            const prepared = RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                [
                    { LastName: 'Ng', AccountId: '001RUN2', Master__c: 'TODO', ReportsToId: 'Contact_child_NickName', OwnerId: 'x', RecordTypeId: 'Contact.Partner' },
                    { LastName: 'Li', AccountId: '### TODO -- REFERENCE ID REQUIRED' }
                ],
                contactLookups, buildContext(), () => 1
            );

            expect(prepared).toEqual([
                { LastName: 'Ng', AccountId: '001RUN2', Master__c: 'a00ORG2', ReportsToId: 'Contact_child_NickName', RecordTypeId: 'Contact.Partner' },
                { LastName: 'Li', AccountId: '001RUN2', Master__c: 'a00ORG2' }
            ]);

        });

        it('prefers the run\'s Ids of an in-tree parent over existing org records, even for a required lookup', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ AccountId: 'Account_NickName' }], contactLookups, buildContext(), () => 0);

            expect((prepared as any).AccountId).toBe('001RUN1');

        });

        it('falls back to org records for a required lookup only when the run created none of that parent', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ AccountId: 'Account_NickName' }], contactLookups,
                buildContext({ runRecordIdsByObject: new Map() }), () => 0);

            expect((prepared as any).AccountId).toBe('001ORG1');

        });

        it('fills a lookup the record does not carry at all, so a record with no lookup line still hangs off a run parent', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ LastName: 'Ng' }],
                [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', isRequired: false }], buildContext(), () => 0);

            expect(prepared).toEqual({ LastName: 'Ng', AccountId: '001RUN1' });

        });

        it('never takes a parent the tree does not insert from the run, and removes an optional lookup it cannot fill', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ AccountId: 'x', ReportsToId: 'Somebody' }], contactLookups,
                buildContext({ inTreeObjectApiNames: new Set(['Contact']), orgRecordIdsByObject: new Map() }), () => 0);

            expect(prepared).toEqual({});

        });

        it('leaves a required lookup with nothing to fill it blank rather than guessing', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ LastName: 'Ng', Master__c: 'TODO' }], contactLookups,
                buildContext({ orgRecordIdsByObject: new Map(), runRecordIdsByObject: new Map() }), () => 0);

            expect(prepared).toEqual({ LastName: 'Ng' });

        });

        it('reads a lookup key in whatever case the recipe wrote it, and keeps one run reference among duplicates', () => {

            const [prepared] = RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                [{ accountid: 'TODO', ACCOUNTID: '001RUN1', reportstoid: 'nobody' }],
                contactLookups, buildContext({ orgRecordIdsByObject: new Map([['Master__c', ['a00ORG1']]]) }), () => 0
            );

            expect(prepared).toEqual({ ACCOUNTID: '001RUN1', Master__c: 'a00ORG1' });

        });

        it('leaves the records it was handed unchanged', () => {

            const handed = [{ AccountId: 'TODO', ReportsToId: 'x' }];
            const copy = JSON.parse(JSON.stringify(handed));

            RecipeCockpitRecordCreation.prepareTreeInsertRecords(handed, contactLookups, buildContext(), () => 0);

            expect(handed).toEqual(copy);

        });

        it('keeps a pick in range whatever the randomness answers', () => {

            const [low, high] = [-5, 99].map(pickedIndex => RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                [{ AccountId: 'x' }], [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', isRequired: false }], buildContext(), () => pickedIndex
            )[0]);

            expect(low).toEqual({ AccountId: '001RUN1' });
            expect(high).toEqual({ AccountId: '001RUN2' });

        });

        it('hands the randomness the number of choices', () => {

            const choiceCounts: number[] = [];
            RecipeCockpitRecordCreation.prepareTreeInsertRecords([{ AccountId: 'x', Master__c: 'y' }], contactLookups, buildContext(),
                choiceCount => { choiceCounts.push(choiceCount); return 0; });

            expect(choiceCounts).toEqual([2, 2]);

        });

        it('passes anything that is not a record through untouched', () => {

            expect(RecipeCockpitRecordCreation.prepareTreeInsertRecords([null, 'x', [1]], contactLookups, buildContext(), () => 0))
                .toEqual([null, 'x', [1]]);

        });

    });

    describe('choosing parents per lookup (#254)', () => {

        it('asks about each single-object, writable lookup the cut block carries, in the block\'s order, matching names case-insensitively', () => {

            expect(RecipeCockpitRecordCreation.findPickableLookups(CONTACT_DESCRIBE, ['LastName', 'reportstoid', 'AccountId', 'Master__c'])).toEqual([
                { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact', isRequired: false },
                { fieldApiName: 'AccountId', parentObjectApiName: 'Account', isRequired: true },
                { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c', isRequired: true }
            ]);

        });

        it('asks nothing about a polymorphic, unwritable, record-type or unknown lookup, or a lookup the block does not carry, and asks once per field', () => {

            expect(RecipeCockpitRecordCreation.findPickableLookups(CONTACT_DESCRIBE, ['OwnerId', 'CreatedById', 'RecordTypeId', 'Unknown__c', 'LastName'])).toEqual([]);
            expect(RecipeCockpitRecordCreation.findPickableLookups(CONTACT_DESCRIBE, ['AccountId', 'accountid']).map(pickableLookup => pickableLookup.fieldApiName)).toEqual(['AccountId']);

        });

        const OUTSIDE_LOOKUPS = [
            { fieldApiName: 'AccountId', parentObjectApiName: 'Account', isRequired: true },
            { fieldApiName: 'Master__c', parentObjectApiName: 'Master__c', isRequired: true },
            { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact', isRequired: false }
        ];
        const buildOutsideContext = (outsideParents: Array<[string, any]>) => ({
            isRunReference: () => false,
            runRecordIdsByObject: new Map<string, string[]>(),
            orgRecordIdsByObject: new Map<string, string[]>([['Account', ['001RANDOM']]]),
            inTreeObjectApiNames: new Set<string>(),
            outsideParentsByFieldApiName: new Map(outsideParents)
        });

        it('gives record i the parent at i mod K for a lookup whose parents were chosen in its picker (#254), and never asks for randomness', () => {

            const records = Array.from({ length: 7 }, (_record, recordIndex) => ({ LastName: `L${recordIndex}`, AccountId: 'Account_NickName' }));
            const pickIndex = jest.fn();

            const preparedRecords = RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                records,
                [OUTSIDE_LOOKUPS[0]],
                buildOutsideContext([['AccountId', { assignment: 'roundRobin', parentRecordIds: ['001P1', '001P2', '001P3'] }]]),
                pickIndex
            ) as Array<Record<string, unknown>>;

            expect(preparedRecords.map(preparedRecord => preparedRecord.AccountId)).toEqual(['001P1', '001P2', '001P3', '001P1', '001P2', '001P3', '001P1']);
            expect(pickIndex).not.toHaveBeenCalled();

        });

        it('gives every record the one parent chosen, a random one of a Random lookup\'s Ids, and leaves a Leave blank lookup blank rather than falling back to the org', () => {

            const preparedRecords = RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                [{ LastName: 'A', ReportsToId: 'Contact_NickName' }, { LastName: 'B' }],
                OUTSIDE_LOOKUPS,
                buildOutsideContext([
                    ['AccountId', { assignment: 'roundRobin', parentRecordIds: ['001ONLY'] }],
                    ['Master__c', { assignment: 'random', parentRecordIds: ['a00A', 'a00B'] }],
                    ['ReportsToId', { assignment: 'blank' }]
                ]),
                () => 1
            );

            expect(preparedRecords).toEqual([{ LastName: 'A', AccountId: '001ONLY', Master__c: 'a00B' }, { LastName: 'B', AccountId: '001ONLY', Master__c: 'a00B' }]);

        });

        it('prefers a parent this run inserted over the picker\'s answer, and keeps a value that already names a record of the run', () => {

            const preparedRecords = RecipeCockpitRecordCreation.prepareTreeInsertRecords(
                [{ AccountId: '001RUN' }, { AccountId: 'TODO' }],
                [OUTSIDE_LOOKUPS[0]],
                {
                    ...buildOutsideContext([['AccountId', { assignment: 'roundRobin', parentRecordIds: ['001PICKED'] }]]),
                    isRunReference: (value: string) => value === '001RUN',
                    runRecordIdsByObject: new Map([['Account', ['001RUN']]]),
                    inTreeObjectApiNames: new Set(['Account'])
                },
                () => 0
            );

            expect(preparedRecords).toEqual([{ AccountId: '001RUN' }, { AccountId: '001RUN' }]);

        });

        it('accepts chosen Ids only when each is a Salesforce Id the lookup\'s own search returned', () => {

            const returnedIds = new Set(['001000000000001AAA', '001000000000002AAA']);

            expect(RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch(['001000000000002AAA', '001000000000001AAA'], returnedIds)).toBe(true);
            expect(RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch([], returnedIds)).toBe(false);
            expect(RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch(['001000000000003AAA'], returnedIds)).toBe(false);
            expect(RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch(['001000000000001AAA', '001000000000003AAA'], returnedIds)).toBe(false);
            expect(RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch(['not an id'], new Set(['not an id']))).toBe(false);

        });

        it('records a choice as "random", "blank" or a copy of the chosen Ids', () => {

            const chosenIds = ['001000000000001AAA'];
            const recorded = RecipeCockpitRecordCreation.toRecordedLookupParentChoice({ kind: 'chosen', parentRecordIds: chosenIds });

            expect(RecipeCockpitRecordCreation.toRecordedLookupParentChoice({ kind: 'random' })).toBe('random');
            expect(RecipeCockpitRecordCreation.toRecordedLookupParentChoice({ kind: 'blank' })).toBe('blank');
            expect(recorded).toEqual(chosenIds);
            expect(recorded).not.toBe(chosenIds);

        });

    });

});
