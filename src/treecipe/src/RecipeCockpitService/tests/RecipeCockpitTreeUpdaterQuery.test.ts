import * as fs from 'fs';
import * as path from 'path';

import {
    IRecipeCockpitUpdaterTreeObject,
    RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE,
    RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH,
    RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH,
    RecipeCockpitTreeUpdaterQuery
} from '../RecipeCockpitTreeUpdaterQuery';
import { RECIPE_COCKPIT_QUERY_MAX_LENGTH, RecipeCockpitQuery } from '../RecipeCockpitQuery';

const ACCOUNT: IRecipeCockpitUpdaterTreeObject = { objectApiName: 'Account', fieldApiNames: ['Name', 'Legacy_Code__c', 'Rating__c', 'ParentId'], lookupFieldApiNames: ['ParentId'], treeLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }] };
const CONTACT: IRecipeCockpitUpdaterTreeObject = { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'], lookupFieldApiNames: ['AccountId'], treeLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] };
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
                { objectApiName: 'Account', fieldApiNames: ['Name', 'ParentId', 'OwnerId'], lookupFieldApiNames: ['ParentId'], treeLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }] },
                { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'], lookupFieldApiNames: ['AccountId'], treeLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }
            ]);

        });

        it('lists an object\'s other lookups after its lookups to parents in the tree, each once (#720)', () => {

            const [accountTreeObject] = RecipeCockpitTreeUpdaterQuery.listTreeObjects(
                [{ objectApiName: 'Account', parentLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }] }],
                fieldApiNamesByObjectApiName,
                new Map([['Account', ['OwnerId', 'ParentId']]])
            );

            expect(accountTreeObject.lookupFieldApiNames).toEqual(['ParentId', 'OwnerId']);
            expect(accountTreeObject.treeLookups).toEqual([{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]);

        });

        it('leaves out an object the model draws no fields for', () => {

            expect(RecipeCockpitTreeUpdaterQuery.listTreeObjects([{ objectApiName: 'User', parentLookups: [] }], fieldApiNamesByObjectApiName)).toEqual([]);

        });

    });

    describe('readRequest', () => {

        it('keeps the parent and the objects under it, a level at a time, each below the parent narrowed by its lookup, a missing WHERE read as none', () => {

            expect(RecipeCockpitTreeUpdaterQuery.readRequest([
                { objectApiName: 'Contact' },
                { objectApiName: 'Account', whereClause: 'Name LIKE \'A%\'' }
            ], TREE_OBJECTS, 'Account')).toEqual({ requests: [
                { objectApiName: 'Account', fieldApiNames: ACCOUNT.fieldApiNames, whereClause: 'Name LIKE \'A%\'' },
                { objectApiName: 'Contact', fieldApiNames: CONTACT.fieldApiNames, whereClause: '', narrowingLookup: { fieldApiName: 'AccountId', parentObjectApiName: 'Account' } }
            ] });

        });

        it('reads every field the tree lists for an object, whatever fields the panel posts (#720)', () => {

            const requestRead = RecipeCockpitTreeUpdaterQuery.readRequest([
                { objectApiName: 'Account', fieldApiNames: ['Name'] },
                { objectApiName: 'Contact', fieldApiNames: ['Password__c', 7, 'LastName', 'LastName'] }
            ], TREE_OBJECTS, 'Account');

            expect('requests' in requestRead ? requestRead.requests.map(request => request.fieldApiNames) : []).toEqual([ACCOUNT.fieldApiNames, CONTACT.fieldApiNames]);

        });

        it.each([
            ['not a list', 'Account'],
            ['an empty list', []],
            ['more objects than the card lists', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Contact', fieldApiNames: [] }, { objectApiName: 'Lead', fieldApiNames: [] }]],
            ['an object the card does not list', [{ objectApiName: 'Lead', fieldApiNames: [] }]],
            ['an object named twice', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Account', fieldApiNames: [] }]],
            ['a WHERE that is not text', [{ objectApiName: 'Account', fieldApiNames: [], whereClause: 3 }]],
            ['a WHERE past the length', [{ objectApiName: 'Account', fieldApiNames: [], whereClause: 'x'.repeat(RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH + 1) }]],
            ['an entry that is not an object', [null]],
            ['an object named __proto__', [{ objectApiName: '__proto__', fieldApiNames: [] }]],
            ['an object name that is not text', [{ objectApiName: 7, fieldApiNames: [] }]]
        ])('refuses the whole request for %s', (_description, candidateObjects) => {

            expect(RecipeCockpitTreeUpdaterQuery.readRequest(candidateObjects, TREE_OBJECTS, 'Account')).toHaveProperty('refusal');

        });

        // EACH WITH THE PARENT'S WHOLE SUBTREE, SO THE CHECK THE CASE NAMES IS THE ONE THAT REFUSES
        it.each([
            ['an object named twice', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Account', fieldApiNames: [] }], 'not the parent and the objects under it'],
            ['an entry that is not an object', [{ objectApiName: 'Account', fieldApiNames: [] }, null], 'not the objects of this treecipe'],
            ['a WHERE past the length', [{ objectApiName: 'Account', fieldApiNames: [] }, { objectApiName: 'Contact', fieldApiNames: [], whereClause: 'x'.repeat(RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH + 1) }], 'is longer than']
        ])('refuses %s in an otherwise whole request, saying why', (_description, candidateObjects, refusalText) => {

            const requestRead = RecipeCockpitTreeUpdaterQuery.readRequest(candidateObjects, TREE_OBJECTS, 'Account');
            expect('refusal' in requestRead ? requestRead.refusal : '').toContain(refusalText);

        });

    });

    describe('buildObjectQuery', () => {

        it('selects, for a request read from the tree, the Id, the lookups and every recipe field, each once, in a query the Query tab would send (#720)', () => {

            const requestRead = RecipeCockpitTreeUpdaterQuery.readRequest([{ objectApiName: 'Account' }, { objectApiName: 'Contact' }], TREE_OBJECTS, 'Account');
            const [accountRequest] = 'requests' in requestRead ? requestRead.requests : [];
            const build = RecipeCockpitTreeUpdaterQuery.buildObjectQuery(ACCOUNT, accountRequest);

            expect(build).toEqual({ objectQuery: { objectApiName: 'Account', query: 'SELECT Id, ParentId, Name, Legacy_Code__c, Rating__c FROM Account' } });
            expect(RecipeCockpitQuery.checkQueryText('SELECT Id, ParentId, Name, Legacy_Code__c, Rating__c FROM Account')).toEqual({ query: 'SELECT Id, ParentId, Name, Legacy_Code__c, Rating__c FROM Account' });

        });

        it('orders the columns Id, then the lookups, then the other fields in recipe order (#720)', () => {

            const opportunity: IRecipeCockpitUpdaterTreeObject = {
                objectApiName: 'Opportunity',
                fieldApiNames: ['Name', 'OwnerId', 'StageName', 'AccountId', 'Amount', 'accountid'],
                lookupFieldApiNames: ['AccountId', 'OwnerId'],
                treeLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]
            };

            expect(RecipeCockpitTreeUpdaterQuery.listSelectedFieldApiNames(opportunity, opportunity.fieldApiNames)).toEqual(['Id', 'AccountId', 'OwnerId', 'Name', 'StageName', 'Amount']);

        });

        it('leaves out the fields the org does not describe, whatever their case, and names them (#720)', () => {

            const request = { objectApiName: 'Account', fieldApiNames: [...ACCOUNT.fieldApiNames], whereClause: '' };
            const readable = RecipeCockpitTreeUpdaterQuery.leaveOutUnreadFields({ ...ACCOUNT, lookupFieldApiNames: ['ParentId', 'Secret_Owner__c'] }, request, ['id', 'NAME', 'parentid', 'Rating__c']);

            expect(readable.unreadFieldApiNames).toEqual(['Secret_Owner__c', 'Legacy_Code__c']);
            expect(readable.treeObject.treeLookups).toEqual(ACCOUNT.treeLookups);
            expect(RecipeCockpitTreeUpdaterQuery.buildObjectQuery(readable.treeObject, readable.request)).toEqual({ objectQuery: { objectApiName: 'Account', query: 'SELECT Id, ParentId, Name, Rating__c FROM Account' } });

        });

        it('leaves nothing out when the org describes every field', () => {

            const request = { objectApiName: 'Contact', fieldApiNames: [...CONTACT.fieldApiNames], whereClause: '' };

            expect(RecipeCockpitTreeUpdaterQuery.leaveOutUnreadFields(CONTACT, request, ['Id', 'LastName', 'AccountId', 'Email'])).toEqual({ treeObject: CONTACT, request: request, unreadFieldApiNames: [] });

        });

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

    describe('a load rooted at a parent (#444)', () => {

        const treeObject = (objectApiName: string, treeLookups: [string, string][]): IRecipeCockpitUpdaterTreeObject => ({
            objectApiName: objectApiName,
            fieldApiNames: ['Name', ...treeLookups.map(([fieldApiName]) => fieldApiName)],
            lookupFieldApiNames: treeLookups.map(([fieldApiName]) => fieldApiName),
            treeLookups: treeLookups.map(([fieldApiName, parentObjectApiName]) => ({ fieldApiName, parentObjectApiName }))
        });

        // Account <- Contact <- Case, Opportunity -> Account and Contact, Lead stands apart
        const ACCOUNT_TREE = [
            treeObject('Account', [['ParentId', 'Account']]),
            treeObject('Contact', [['AccountId', 'Account'], ['ReportsToId', 'Contact']]),
            treeObject('Opportunity', [['ContactId__c', 'Contact'], ['AccountId', 'Account']]),
            treeObject('Case', [['ContactId', 'Contact']]),
            treeObject('Lead', [])
        ];

        const accountId = (index: number) => `001${String(index).padStart(15, '0')}`;

        describe('planLoad', () => {

            it('puts the parent first and each object after its parents, narrowed by its lookup to the deepest of them', () => {

                expect(RecipeCockpitTreeUpdaterQuery.planLoad(ACCOUNT_TREE, 'Account')).toEqual([
                    { objectApiName: 'Account', depth: 0 },
                    { objectApiName: 'Contact', depth: 1, narrowingLookup: { fieldApiName: 'AccountId', parentObjectApiName: 'Account' } },
                    { objectApiName: 'Opportunity', depth: 2, narrowingLookup: { fieldApiName: 'ContactId__c', parentObjectApiName: 'Contact' } },
                    { objectApiName: 'Case', depth: 2, narrowingLookup: { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' } }
                ]);

            });

            it('waits for a deeper parent listed later in the tree, and takes the first lookup on a tie', () => {

                const laterParentTree = [
                    treeObject('Account', []),
                    treeObject('Opportunity', [['AccountId', 'Account'], ['Project__c', 'Project__c']]),
                    treeObject('Project__c', [['Account__c', 'Account']]),
                    treeObject('Task__c', [['Owner__c', 'Account'], ['Sponsor__c', 'Account']])
                ];

                expect(RecipeCockpitTreeUpdaterQuery.planLoad(laterParentTree, 'Account')?.map(loadStep => [loadStep.objectApiName, loadStep.depth, loadStep.narrowingLookup?.fieldApiName]))
                    .toEqual([['Account', 0, undefined], ['Project__c', 1, 'Account__c'], ['Opportunity', 2, 'Project__c'], ['Task__c', 1, 'Owner__c']]);

            });

            it('places objects in a lookup cycle under the deepest parent already placed, and ignores a parent outside the subtree', () => {

                const cycleTree = [
                    treeObject('Account', []),
                    treeObject('First__c', [['Account__c', 'Account'], ['Second__c', 'Second__c'], ['Outside__c', 'Outside__c']]),
                    treeObject('Second__c', [['First__c', 'First__c']]),
                    treeObject('Outside__c', [])
                ];

                expect(RecipeCockpitTreeUpdaterQuery.planLoad(cycleTree, 'Account')?.map(loadStep => [loadStep.objectApiName, loadStep.depth, loadStep.narrowingLookup?.fieldApiName]))
                    .toEqual([['Account', 0, undefined], ['First__c', 1, 'Account__c'], ['Second__c', 2, 'First__c']]);

            });

            it('roots the plan at a child, leaving out everything above it, and never follows a self-lookup', () => {

                expect(RecipeCockpitTreeUpdaterQuery.planLoad(ACCOUNT_TREE, 'Contact')?.map(loadStep => [loadStep.objectApiName, loadStep.narrowingLookup?.fieldApiName]))
                    .toEqual([['Contact', undefined], ['Opportunity', 'ContactId__c'], ['Case', 'ContactId']]);
                expect(RecipeCockpitTreeUpdaterQuery.planLoad(ACCOUNT_TREE, 'Case')).toEqual([{ objectApiName: 'Case', depth: 0 }]);

            });

            it('answers nothing for a parent the card does not list', () => {

                expect(RecipeCockpitTreeUpdaterQuery.planLoad(ACCOUNT_TREE, 'User')).toBeUndefined();

            });

        });

        describe('readRequest with a parent', () => {

            const everyObjectUnder = (objectApiNames: string[]) => objectApiNames.map(objectApiName => ({ objectApiName: objectApiName, fieldApiNames: [] }));

            it('refuses a parent the card does not list, or that is not text', () => {

                expect(RecipeCockpitTreeUpdaterQuery.readRequest(everyObjectUnder(['Lead']), ACCOUNT_TREE, 'User')).toHaveProperty('refusal');
                expect(RecipeCockpitTreeUpdaterQuery.readRequest(everyObjectUnder(['Account']), ACCOUNT_TREE, undefined)).toHaveProperty('refusal');

            });

            it('refuses objects that are not exactly the parent and the objects under it', () => {

                expect(RecipeCockpitTreeUpdaterQuery.readRequest(everyObjectUnder(['Account', 'Contact', 'Opportunity']), ACCOUNT_TREE, 'Account')).toHaveProperty('refusal');
                expect(RecipeCockpitTreeUpdaterQuery.readRequest(everyObjectUnder(['Account', 'Contact', 'Opportunity', 'Lead']), ACCOUNT_TREE, 'Account')).toHaveProperty('refusal');
                expect(RecipeCockpitTreeUpdaterQuery.readRequest(everyObjectUnder(['Account', 'Contact', 'Opportunity', 'Case']), ACCOUNT_TREE, 'Account')).not.toHaveProperty('refusal');

            });

        });

        describe('buildNarrowedQueries', () => {

            const contactTreeObject = ACCOUNT_TREE[1];
            const contactRequest = { objectApiName: 'Contact', fieldApiNames: ['Name'], whereClause: '', narrowingLookup: { fieldApiName: 'AccountId', parentObjectApiName: 'Account' } };

            it('reads only the records under the Ids loaded a level above', () => {

                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, contactRequest, [accountId(1), accountId(2)])).toEqual({
                    queries: [`SELECT Id, AccountId, ReportsToId, Name FROM Contact WHERE AccountId IN ('${accountId(1)}', '${accountId(2)}')`]
                });

            });

            it('splits 2,500 parent Ids into queries of at most the chunk size, each within the query limit, naming every Id once', () => {

                const parentRecordIds = Array.from({ length: 2500 }, (_unused, index) => accountId(index));
                const build = RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, contactRequest, [...parentRecordIds, accountId(7)]);

                if ( 'refusal' in build ) { throw new Error(build.refusal); }
                expect(build.queries).toHaveLength(Math.ceil(2500 / RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE));
                build.queries.forEach(query => {
                    expect(query.length).toBeLessThanOrEqual(RECIPE_COCKPIT_QUERY_MAX_LENGTH);
                    expect((query.match(/'001/g) ?? []).length).toBeLessThanOrEqual(RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE);
                });
                const namedIds = build.queries.flatMap(query => query.match(/001[0-9]{15}/g) ?? []);
                expect(namedIds).toHaveLength(2500);
                expect(new Set(namedIds).size).toBe(2500);

            });

            describe('a SELECT of every recipe field, sent in the address of a GET (#720)', () => {

                const wideContact = (fieldCount: number): IRecipeCockpitUpdaterTreeObject => ({
                    ...contactTreeObject,
                    fieldApiNames: Array.from({ length: fieldCount }, (_unused, fieldIndex) => `Long_Custom_Field_Name_Number_${fieldIndex}__c`)
                });
                const requestOf = (wideTreeObject: IRecipeCockpitUpdaterTreeObject) => ({ ...contactRequest, fieldApiNames: [...wideTreeObject.fieldApiNames] });
                const parentIds = Array.from({ length: 400 }, (_unused, parentIndex) => accountId(parentIndex + 1));
                const queriesOf = (wideTreeObject: IRecipeCockpitUpdaterTreeObject) => {
                    const build = RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(wideTreeObject, requestOf(wideTreeObject), parentIds);
                    if ( 'refusal' in build ) { throw new Error(build.refusal); }
                    return build.queries;
                };

                it('names fewer parent Ids a query when its SELECT is long, so every query fits what an org accepts and every Id is still named once', () => {

                    const wideTreeObject = wideContact(320);
                    const queries = queriesOf(wideTreeObject);

                    expect(queries.length).toBeGreaterThan(Math.ceil(parentIds.length / RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE));
                    queries.forEach(query => expect(encodeURIComponent(query).length).toBeLessThanOrEqual(RECIPE_COCKPIT_UPDATER_QUERY_ENCODED_MAX_LENGTH));
                    expect(queries.flatMap(query => query.match(/'001\w{15}'/g) ?? [])).toEqual(parentIds.map(parentId => `'${parentId}'`));
                    expect(RecipeCockpitTreeUpdaterQuery.findTooLongQueryReason(wideTreeObject, requestOf(wideTreeObject), queries)).toBeUndefined();

                });

                it('keeps the usual 150 Ids a query for a SELECT of ordinary length', () => {

                    expect(queriesOf(wideContact(20))).toHaveLength(Math.ceil(parentIds.length / RECIPE_COCKPIT_UPDATER_PARENT_ID_CHUNK_SIZE));

                });

                it('says an object\'s SELECT is too long even one Id at a time, naming its field count and what to do', () => {

                    const wideTreeObject = wideContact(600);
                    const queries = queriesOf(wideTreeObject);
                    const reason = RecipeCockpitTreeUpdaterQuery.findTooLongQueryReason(wideTreeObject, requestOf(wideTreeObject), queries);

                    // ONE Id A QUERY: IT WENT AS FAR AS IT COULD BEFORE SAYING SO
                    expect(queries).toHaveLength(parentIds.length);
                    expect(reason).toMatch(/^its query names 603 fields and is \d+ characters once sent, more than the 14000 an org accepts in one request\./);
                    expect(reason).toContain('Customize and create new recipe');
                    expect(reason).toContain('Contact fields you do not need');

                });

            });

            it('keeps the reader\'s WHERE, grouped, beside the narrowing', () => {

                const build = RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, { ...contactRequest, whereClause: 'WHERE LastName = \'A\' OR LastName = \'B\'' }, [accountId(1)]);

                expect(build).toEqual({ queries: [`SELECT Id, AccountId, ReportsToId, Name FROM Contact WHERE (LastName = 'A' OR LastName = 'B') AND AccountId IN ('${accountId(1)}')`] });

            });

            it.each([
                ['a WHERE that closes the group', 'LastName = \'A\') OR (Id != null'],
                ['a WHERE that leaves one open', '(LastName = \'A\''],
                ['FOR UPDATE', 'LastName = \'A\' FOR UPDATE']
            ])('refuses %s', (_description, whereClause) => {

                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, { ...contactRequest, whereClause: whereClause }, [accountId(1)])).toHaveProperty('refusal');

            });

            it('keeps a parenthesis inside a quoted value', () => {

                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, { ...contactRequest, whereClause: 'LastName = \'Smith (Jr\'' }, [accountId(1)])).not.toHaveProperty('refusal');

            });

            it('refuses an Id that is not a record Id, so no other text reaches the query', () => {

                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, contactRequest, ['001000000000000AAA\') OR Id != (\''])).toHaveProperty('refusal');

            });

            it('refuses a narrowing lookup whose name is not a field api name', () => {

                const forgedTreeObject = treeObject('Contact', [['Account Id', 'Account']]);
                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(forgedTreeObject, { ...contactRequest, narrowingLookup: { fieldApiName: 'Account Id', parentObjectApiName: 'Account' } }, [accountId(1)]))
                    .toEqual({ refusal: 'Contact.Account Id is not a field api name.' });

            });

            it('refuses a narrowing lookup the object does not have, and sends nothing for no Ids', () => {

                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, { ...contactRequest, narrowingLookup: { fieldApiName: 'OwnerId', parentObjectApiName: 'User' } }, [accountId(1)])).toHaveProperty('refusal');
                expect(RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(contactTreeObject, contactRequest, [])).toEqual({ queries: [] });

            });

            it('checks a request\'s query before any record is read, with a placeholder Id for one below the parent', () => {

                expect(RecipeCockpitTreeUpdaterQuery.checkRequestQuery(contactTreeObject, contactRequest)).toBeUndefined();
                expect(RecipeCockpitTreeUpdaterQuery.checkRequestQuery(contactTreeObject, { ...contactRequest, whereClause: 'x) OR (y' })).toHaveProperty('refusal');
                expect(RecipeCockpitTreeUpdaterQuery.checkRequestQuery(ACCOUNT_TREE[0], { objectApiName: 'Account', fieldApiNames: [], whereClause: 'Name = 1 FOR UPDATE' })).toHaveProperty('refusal');

            });

        });

    });

});
