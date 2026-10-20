jest.mock('vscode', () => ({}), { virtual: true });

import * as fs from 'fs';
import * as path from 'path';
import { ALL_OR_NONE_ROLLED_BACK_STATUS_CODE, InsertFailureTroubleshootingSubTab, RecipeCockpitInsertFailureTriage } from '../RecipeCockpitInsertFailureTriage';
import { RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS } from '../RecipeCockpitService';
import { INSERT_REQUEST_FAILED_STATUS_CODE } from '../../CollectionsApiService/CollectionsApiService';

// #375: WHICH TROUBLESHOOTING SUB-TAB A FAILED TREE INSERT'S "Open Troubleshooting" OPENS
describe('RecipeCockpitInsertFailureTriage', () => {

    describe('resolveSubTab', () => {

        it.each([
            ['INVALID_FIELD', 'fields'],
            ['INVALID_FIELD_WHEN_USING_TEMPLATE', 'fields'],
            ['INVALID_FIELD_FOR_INSERT_UPDATE', 'permissions'],
            ['INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY', 'permissions'],
            ['INSUFFICIENT_ACCESS_OR_READONLY', 'permissions'],
            ['FIELD_CUSTOM_VALIDATION_EXCEPTION', 'validationRules'],
            ['INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', 'globalValueSets'],
            ['REQUIRED_FIELD_MISSING', 'todos'],
            [INSERT_REQUEST_FAILED_STATUS_CODE, 'todos'],
            ['SOMETHING_SALESFORCE_ADDS_LATER', 'todos'],
            ['constructor', 'todos'],
            ['', 'todos']
        ])('routes %s to %s', (statusCode, expectedSubTab) => {

            expect(RecipeCockpitInsertFailureTriage.resolveSubTab({ statusCode: statusCode, fields: [] })).toBe(expectedSubTab);

        });

        it('routes any error naming RecordTypeId, whatever its code, to Record Types', () => {

            expect(RecipeCockpitInsertFailureTriage.resolveSubTab({ statusCode: 'INVALID_CROSS_REFERENCE_KEY', fields: ['RecordTypeId'] })).toBe('recordTypes');
            expect(RecipeCockpitInsertFailureTriage.resolveSubTab({ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', fields: ['Name', 'recordtypeid'] })).toBe('recordTypes');
            expect(RecipeCockpitInsertFailureTriage.resolveSubTab({ statusCode: 'INVALID_CROSS_REFERENCE_KEY', fields: ['AccountId'] })).toBe('todos');

        });

        it('routes no failure at all to TODO\'s', () => {

            expect(RecipeCockpitInsertFailureTriage.resolveSubTab(undefined)).toBe('todos');

        });

        it('names only sub-tabs the Troubleshooting tab draws', () => {

            const routedSubTabs: InsertFailureTroubleshootingSubTab[] = ['todos', 'fields', 'permissions', 'validationRules', 'recordTypes', 'globalValueSets'];

            expect([...RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS].sort()).toEqual([...routedSubTabs].sort());

        });

        it('imports nothing', () => {

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitInsertFailureTriage.ts'), 'utf8');

            expect(source).not.toMatch(/^\s*import\s/m);
            expect(source).not.toMatch(/require\(/);

        });

    });

    describe('readFirstError and readFirstFailure', () => {

        it('reads the first error of a record\'s answer, with its fields, and skips an all-or-none rollback answer', () => {

            expect(RecipeCockpitInsertFailureTriage.readFirstError({
                success: false,
                errors: [
                    { statusCode: ALL_OR_NONE_ROLLED_BACK_STATUS_CODE, message: 'rolled back', fields: [] },
                    { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'rejected', fields: ['Amount__c'] }
                ]
            })).toEqual({ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', fields: ['Amount__c'] });

        });

        it('falls back to the rollback answer when it is the only one, and to nothing for an answer with no usable error', () => {

            expect(RecipeCockpitInsertFailureTriage.readFirstError({ errors: [{ statusCode: ALL_OR_NONE_ROLLED_BACK_STATUS_CODE }] }))
                .toEqual({ statusCode: ALL_OR_NONE_ROLLED_BACK_STATUS_CODE, fields: [] });
            expect(RecipeCockpitInsertFailureTriage.readFirstError({ errors: 'INVALID_FIELD' })).toBeUndefined();
            expect(RecipeCockpitInsertFailureTriage.readFirstError({ errors: [{ statusCode: 42 }, null, 'x'] })).toBeUndefined();
            expect(RecipeCockpitInsertFailureTriage.readFirstError(null)).toBeUndefined();
            expect(RecipeCockpitInsertFailureTriage.readFirstError(undefined)).toBeUndefined();

        });

        it('keeps only string field names from an org\'s answer', () => {

            expect(RecipeCockpitInsertFailureTriage.readFirstError({ errors: [{ statusCode: 'INVALID_FIELD', fields: ['Name', 7, null, 'Industry'] }] }))
                .toEqual({ statusCode: 'INVALID_FIELD', fields: ['Name', 'Industry'] });
            expect(RecipeCockpitInsertFailureTriage.readFirstError({ errors: [{ statusCode: 'INVALID_FIELD', fields: 'Name' }] }))
                .toEqual({ statusCode: 'INVALID_FIELD', fields: [] });

        });

        it('across a file\'s failed records, takes the first cause that is not a rollback answer', () => {

            const rolledBack = { success: false, errors: [{ statusCode: ALL_OR_NONE_ROLLED_BACK_STATUS_CODE, fields: [] }] };
            const rejected = { success: false, errors: [{ statusCode: 'INVALID_FIELD_FOR_INSERT_UPDATE', fields: ['Secret__c'] }] };

            expect(RecipeCockpitInsertFailureTriage.readFirstFailure([rolledBack, rolledBack, rejected])).toEqual({ statusCode: 'INVALID_FIELD_FOR_INSERT_UPDATE', fields: ['Secret__c'] });
            expect(RecipeCockpitInsertFailureTriage.readFirstFailure([rolledBack])).toEqual({ statusCode: ALL_OR_NONE_ROLLED_BACK_STATUS_CODE, fields: [] });
            expect(RecipeCockpitInsertFailureTriage.readFirstFailure([])).toBeUndefined();

        });

    });

});
