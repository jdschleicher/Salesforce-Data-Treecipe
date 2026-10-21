import * as fs from 'fs';
import * as path from 'path';
import { StandardFieldParentReferenceMap } from '../StandardFieldParentReferenceMap';
import { SalesforceApiName } from '../../RecipeService/SalesforceApiName';

describe('StandardFieldParentReferenceMap (#400)', () => {

    test.each([
        ['Account', 'ParentId', 'Account'],
        ['Campaign', 'ParentId', 'Campaign'],
        ['Case', 'AccountId', 'Account'],
        ['Case', 'ContactId', 'Contact'],
        ['Case', 'ParentId', 'Case'],
        ['Contact', 'AccountId', 'Account'],
        ['Contact', 'ReportsToId', 'Contact'],
        ['Opportunity', 'AccountId', 'Account']
    ])('maps %s.%s to %s', (objectApiName, fieldApiName, expectedParentObjectApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBe(expectedParentObjectApiName);

    });

    test('holds exactly the confirmed set, so a new entry is a decision made in a test', () => {

        expect(StandardFieldParentReferenceMap.listMappedObjectFields().sort()).toEqual([
            'Account.ParentId',
            'Campaign.ParentId',
            'Case.AccountId',
            'Case.ContactId',
            'Case.ParentId',
            'Contact.AccountId',
            'Contact.ReportsToId',
            'Opportunity.AccountId'
        ]);

    });

    test('every key and every parent is a Salesforce api name', () => {

        StandardFieldParentReferenceMap.listMappedObjectFields().forEach(objectField => {
            const [objectApiName, fieldApiName] = objectField.split('.');
            expect(SalesforceApiName.isApiName(objectApiName)).toBe(true);
            expect(SalesforceApiName.isApiName(fieldApiName)).toBe(true);
            expect(SalesforceApiName.isApiName(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName))).toBe(true);
        });

    });

    test.each([
        ['User', 'ManagerId'],
        ['Lead', 'ParentId'],
        ['account', 'ParentId'],
        ['Account', 'parentid'],
        ['Task', 'WhoId'],
        ['Task', 'WhatId'],
        ['Account', 'OwnerId']
    ])('answers nothing for %s.%s, which it does not name', (objectApiName, fieldApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBeUndefined();

    });

    test.each([
        ['constructor', ''],
        ['__proto__', ''],
        ['Account', 'toString'],
        ['hasOwnProperty', 'x']
    ])('answers nothing for a prototype-named key %s.%s', (objectApiName, fieldApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBeUndefined();

    });

    test('imports nothing', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'StandardFieldParentReferenceMap.ts'), 'utf-8');

        expect(source).not.toMatch(/^\s*import\b/m);
        expect(source).not.toMatch(/\brequire\(/);

    });

});
