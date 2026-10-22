import * as fs from 'fs';
import * as path from 'path';

import {
    IRecipeCockpitUpdaterTreeObject,
    RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH,
    RecipeCockpitTreeUpdaterQuery
} from '../RecipeCockpitTreeUpdaterQuery';

const ACCOUNT: IRecipeCockpitUpdaterTreeObject = { objectApiName: 'Account', fieldApiNames: ['Name', 'Legacy_Code__c', 'Rating__c', 'ParentId'], lookupFieldApiNames: ['ParentId'] };
const CONTACT: IRecipeCockpitUpdaterTreeObject = { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'], lookupFieldApiNames: ['AccountId'] };
const TREE_OBJECTS = [ACCOUNT, CONTACT];

const queryOf = (treeObject: IRecipeCockpitUpdaterTreeObject, fieldApiNames: string[], whereClause = '') => {
    const build = RecipeCockpitTreeUpdaterQuery.buildObjectQuery(treeObject, { objectApiName: treeObject.objectApiName, fieldApiNames: fieldApiNames, whereClause: whereClause });
    if ( 'refusal' in build ) { throw new Error(build.refusal); }
    return build.objectQuery.query;
};

describe('RecipeCockpitTreeUpdaterQuery (#416)', () => {

    it('imports no vscode', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitTreeUpdaterQuery.ts'), 'utf8');
        expect(source).not.toMatch(/from 'vscode'/);

    });

    describe('listTreeObjects', () => {

        const fieldApiNamesByObjectApiName = new Map<string, string[]>([
            ['Account', ['Name', 'ParentId', 'OwnerId']],
            ['Contact', ['LastName', 'AccountId']]
        ]);

        it('lists each object once, in the card\'s order, with only the lookups to parents the card also lists', () => {

            const treeObjects = RecipeCockpitTreeUpdaterQuery.listTreeObjects([
                { objectApiName: 'Account', parentLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }, { fieldApiName: 'OwnerId', parentObjectApiName: 'User' }] },
                { objectApiName: 'Contact', parentLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] },
                { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' }
            ], fieldApiNamesByObjectApiName);

            expect(treeObjects).toEqual([
                { objectApiName: 'Account', fieldApiNames: ['Name', 'ParentId', 'OwnerId'], lookupFieldApiNames: ['ParentId'] },
                { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'], lookupFieldApiNames: ['AccountId'] }
            ]);

        });

        it('leaves out an object the model draws no fields for', () => {

            expect(RecipeCockpitTreeUpdaterQuery.listTreeObjects([{ objectApiName: 'User', parentLookups: [] }], fieldApiNamesByObjectApiName)).toEqual([]);

        });

    });

    describe('readRequest', () => {

        it('keeps what the card lists, in the order asked, a missing WHERE read as none', () => {

            expect(RecipeCockpitTreeUpdaterQuery.readRequest([
                { objectApiName: 'Contact', fieldApiNames: ['LastName'] },
                { objectApiName: 'Account', fieldApiNames: [], whereClause: 'Name LIKE \'A%\'' }
            ], TREE_OBJECTS)).toEqual({ requests: [
                { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: '' },
                { objectApiName: 'Account', fieldApiNames: [], whereClause: 'Name LIKE \'A%\'' }
            ] });

        });

        it.each([
            ['not a list', 'Account'],
            ['an empty list', []],
            ['more objects than the card lists', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Contact', fieldApiNames: [] }, { objectApiName: 'Lead', fieldApiNames: [] }]],
            ['an object the card does not list', [{ objectApiName: 'Lead', fieldApiNames: [] }]],
            ['an object named twice', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Account', fieldApiNames: [] }]],
            ['a field the object does not list', [{ objectApiName: 'Account', fieldApiNames: ['LastName'] }]],
            ['a field named twice', [{ objectApiName: 'Account', fieldApiNames: ['Name', 'Name'] }]],
            ['a field that is not text', [{ objectApiName: 'Account', fieldApiNames: [7] }]],
            ['fields that are not a list', [{ objectApiName: 'Account', fieldApiNames: 'Name' }]],
            ['a WHERE that is not text', [{ objectApiName: 'Account', fieldApiNames: [], whereClause: 3 }]],
            ['a WHERE past the length', [{ objectApiName: 'Account', fieldApiNames: [], whereClause: 'x'.repeat(RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH + 1) }]],
            ['an entry that is not an object', [null]],
            ['an object named __proto__', [{ objectApiName: '__proto__', fieldApiNames: [] }]],
            ['an object name that is not text', [{ objectApiName: 7, fieldApiNames: [] }]]
        ])('refuses the whole request for %s', (_description, candidateObjects) => {

            expect(RecipeCockpitTreeUpdaterQuery.readRequest(candidateObjects, TREE_OBJECTS)).toHaveProperty('refusal');

        });

    });

    describe('buildObjectQuery', () => {

        it('selects the Id, the lookups to parents in the tree and the chosen fields, each once', () => {

            expect(queryOf(ACCOUNT, ['Legacy_Code__c', 'parentid', 'Rating__c'])).toBe('SELECT Id, ParentId, Legacy_Code__c, Rating__c FROM Account');
            expect(queryOf(CONTACT, [])).toBe('SELECT Id, AccountId FROM Contact');

        });

        it('adds the reader\'s WHERE, trimmed, whether or not it starts with the keyword', () => {

            expect(queryOf(ACCOUNT, [], '  CreatedDate = TODAY ')).toBe('SELECT Id, ParentId FROM Account WHERE CreatedDate = TODAY');
            expect(queryOf(ACCOUNT, [], 'where Name = \'Acme; Inc\'')).toBe('SELECT Id, ParentId FROM Account WHERE Name = \'Acme; Inc\'');
            expect(queryOf(ACCOUNT, [], '   ')).toBe('SELECT Id, ParentId FROM Account');

        });

        it.each([
            ['a second statement', 'Name = \'A\'; DELETE'],
            ['a quoted value never closed', 'Name = \'A'],
            ['a control character', 'Name = \'A\'\u0000'],
            ['FOR VIEW', 'Name = \'A\' FOR VIEW'],
            ['FOR REFERENCE', 'Name = \'A\' for  reference'],
            ['FOR UPDATE', 'Name = \'A\' FOR UPDATE']
        ])('refuses a WHERE with %s', (_description, whereClause) => {

            expect(RecipeCockpitTreeUpdaterQuery.buildObjectQuery(ACCOUNT, { objectApiName: 'Account', fieldApiNames: [], whereClause: whereClause })).toHaveProperty('refusal');

        });

        it('keeps FOR UPDATE named inside a quoted value, which is a value and not a clause', () => {

            expect(queryOf(ACCOUNT, [], 'Name = \'ready for update\'')).toBe('SELECT Id, ParentId FROM Account WHERE Name = \'ready for update\'');

        });

        it('refuses an object or field name that is not an api name, so no other text reaches the query', () => {

            expect(RecipeCockpitTreeUpdaterQuery.buildObjectQuery({ ...ACCOUNT, objectApiName: 'Account FROM Contact' }, { objectApiName: 'Account FROM Contact', fieldApiNames: [], whereClause: '' })).toHaveProperty('refusal');
            expect(RecipeCockpitTreeUpdaterQuery.buildObjectQuery({ ...ACCOUNT, fieldApiNames: ['Name, (SELECT Id FROM Contacts)'] }, { objectApiName: 'Account', fieldApiNames: ['Name, (SELECT Id FROM Contacts)'], whereClause: '' })).toHaveProperty('refusal');
            expect(RecipeCockpitTreeUpdaterQuery.buildObjectQuery({ ...ACCOUNT, lookupFieldApiNames: ['Parent Id'] }, { objectApiName: 'Account', fieldApiNames: [], whereClause: '' })).toHaveProperty('refusal');

        });

    });

});
