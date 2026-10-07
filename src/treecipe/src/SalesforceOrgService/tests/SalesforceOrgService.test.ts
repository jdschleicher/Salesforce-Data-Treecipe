import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { showWarningMessage: jest.fn(), showQuickPick: jest.fn() }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    Org: { create: jest.fn() }
}));

import { AuthInfo, Org } from '@salesforce/core';

import {
    SalesforceOrgService,
    IOrgDescribeSource,
    NO_AUTHORIZED_ORGS_MESSAGE,
    ORG_DESCRIBE_CANCELLED_MESSAGE,
    ORG_DESCRIBE_CONCURRENCY,
    ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE,
    ORG_ORGANIZATION_QUERY,
    ORG_TYPE_UNKNOWN_LABEL,
    IOrgQuerySource
} from '../SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const ACCOUNT_DESCRIBE = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'describeAccount.json'), 'utf-8'));

const ORG_USERNAME = 'jd@example.com';

// A CONNECTION STAND-IN THAT ANSWERS FROM A TABLE AND COUNTS WHAT IT WAS ASKED
function buildDescribeSource(describesByObjectApiName: Record<string, unknown>) {

    const describedObjectApiNames: string[] = [];

    const describeSource: IOrgDescribeSource = {
        describe: jest.fn().mockImplementation(async (objectApiName: string) => {
            describedObjectApiNames.push(objectApiName);
            if ( !Object.prototype.hasOwnProperty.call(describesByObjectApiName, objectApiName) ) {
                throw Object.assign(new Error(`The requested resource does not exist`), { errorCode: 'NOT_FOUND' });
            }
            return describesByObjectApiName[objectApiName];
        })
    };

    return { describeSource, describedObjectApiNames };

}

describe('SalesforceOrgService', () => {

    beforeEach(() => {
        SalesforceOrgService.clearDescribeCache();
    });

    describe('normalizeDescribeResult', () => {

        it('reduces a describe to the comparable field model, keeping precision, scale and picklist values', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Account', ACCOUNT_DESCRIBE);

            expect(normalizedDescribe.objectApiName).toBe('Account');
            expect(normalizedDescribe.objectLabel).toBe('Account');
            expect(normalizedDescribe.fields.map(field => field.fieldApiName)).toEqual([
                'Id', 'Name', 'AnnualRevenue__c', 'Region__c', 'Country__c', 'ParentId', 'Rating_Score__c'
            ]);

            expect(normalizedDescribe.fields.find(field => field.fieldApiName === 'AnnualRevenue__c')).toEqual({
                fieldApiName: 'AnnualRevenue__c',
                fieldLabel: 'Annual Revenue',
                fieldType: 'currency',
                length: 0,
                precision: 18,
                scale: 2,
                picklistValues: [],
                controllingField: '',
                referenceTo: [],
                isNillable: true,
                isCreateable: true,
                isCalculated: false,
                isDefaultedOnCreate: false
            });

            expect(normalizedDescribe.fields.find(field => field.fieldApiName === 'Region__c').picklistValues).toEqual([
                { value: 'NA', label: 'North America', isActive: true, isDefault: true },
                { value: 'EMEA', label: 'Europe & Middle East', isActive: true, isDefault: false },
                { value: 'Retired', label: 'Retired', isActive: false, isDefault: false }
            ]);

        });

        it('carries the controlling field of a dependent picklist and the targets of a lookup', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Account', ACCOUNT_DESCRIBE);

            expect(normalizedDescribe.fields.find(field => field.fieldApiName === 'Country__c').controllingField).toBe('Region__c');
            expect(normalizedDescribe.fields.find(field => field.fieldApiName === 'ParentId').referenceTo).toEqual(['Account']);

        });

        it('marks a formula field calculated and not createable', () => {

            const ratingScoreField = SalesforceOrgService.normalizeDescribeResult('Account', ACCOUNT_DESCRIBE).fields
                .find(field => field.fieldApiName === 'Rating_Score__c');

            expect(ratingScoreField.isCalculated).toBe(true);
            expect(ratingScoreField.isCreateable).toBe(false);

        });

        // THE RESULT CAME OVER THE NETWORK, SO NO VALUE IN IT IS ASSUMED TO BE THE TYPE IT SHOULD BE
        it('drops a field with no name, and defaults every value that is not the type it should be', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Widget__c', {
                fields: [
                    { label: 'No name at all' },
                    null,
                    'not a field',
                    {
                        name: 'Odd__c',
                        label: 42,
                        type: null,
                        length: '255',
                        precision: Number.NaN,
                        scale: undefined,
                        picklistValues: [{ value: 7 }, null, { value: 'Kept' }],
                        referenceTo: ['Account', 3],
                        nillable: 'true',
                        createable: 1,
                        calculated: {}
                    }
                ]
            });

            expect(normalizedDescribe).toEqual({
                objectApiName: 'Widget__c',
                objectLabel: '',
                isCreateable: false,
                fields: [{
                    fieldApiName: 'Odd__c',
                    fieldLabel: '',
                    fieldType: '',
                    length: 0,
                    precision: 0,
                    scale: 0,
                    picklistValues: [{ value: 'Kept', label: 'Kept', isActive: false, isDefault: false }],
                    controllingField: '',
                    referenceTo: ['Account'],
                    isNillable: false,
                    isCreateable: false,
                    isCalculated: false,
                    isDefaultedOnCreate: false
                }]
            });

        });

        it.each([
            ['nothing', undefined],
            ['an array', []],
            ['a describe with no field list', { name: 'Account' }],
            ['a field list that is not a list', { name: 'Account', fields: {} }]
        ])('given %s, throws rather than answering with an object that has no fields', (unusedDescription, describeResult) => {

            expect(() => SalesforceOrgService.normalizeDescribeResult('Account', describeResult)).toThrow('The describe of Account returned no field list.');

        });

    });

    describe('describeObjects', () => {

        it('describes each requested object once, in the order requested, and reports progress per object', async () => {

            const { describeSource } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE, Contact: { name: 'Contact', fields: [] } });
            const progressReports: [number, number][] = [];

            const describeResult = await SalesforceOrgService.describeObjects(
                ORG_USERNAME,
                ['Account', 'Contact', 'Account'],
                async () => describeSource,
                { onObjectDescribed: (completedCount, requestedCount) => progressReports.push([completedCount, requestedCount]) }
            );

            expect(describeResult.wasCancelled).toBe(false);
            expect(describeResult.outcomes.map(outcome => outcome.objectApiName)).toEqual(['Account', 'Contact']);
            expect(describeResult.outcomes.every(outcome => !!outcome.describe && !outcome.wasCached)).toBe(true);
            expect(describeSource.describe).toHaveBeenCalledTimes(2);
            expect(progressReports).toEqual([[1, 2], [2, 2]]);

        });

        it('answers a repeat request from the session cache without connecting at all', async () => {

            const { describeSource } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE });
            const describeSourceFactory = jest.fn().mockResolvedValue(describeSource);

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], describeSourceFactory);
            const repeatResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['account'], describeSourceFactory);

            expect(describeSourceFactory).toHaveBeenCalledTimes(1);
            expect(describeSource.describe).toHaveBeenCalledTimes(1);
            expect(repeatResult.outcomes[0].wasCached).toBe(true);
            expect(repeatResult.outcomes[0].describe.fields).toHaveLength(7);

        });

        it('connects only for the objects the cache cannot answer', async () => {

            const { describeSource, describedObjectApiNames } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE, Contact: { fields: [] } });

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource);
            describedObjectApiNames.length = 0;

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account', 'Contact'], async () => describeSource);

            expect(describedObjectApiNames).toEqual(['Contact']);
            expect(describeResult.outcomes.map(outcome => outcome.wasCached)).toEqual([true, false]);

        });

        // AN ALIAS CAN BE RE-POINTED BETWEEN TWO REQUESTS, SO THE CACHE ANSWERS PER ORG USERNAME
        it('never answers one org\'s request from another org\'s describe', async () => {

            const { describeSource } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE });

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource);
            await SalesforceOrgService.describeObjects('someone.else@example.com', ['Account'], async () => describeSource);

            expect(describeSource.describe).toHaveBeenCalledTimes(2);

        });

        it('records a failed describe on its own object, carries on with the rest, and does not cache the failure', async () => {

            const { describeSource } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE });

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Missing__c', 'Account'], async () => describeSource);

            expect(describeResult.outcomes).toEqual([
                { objectApiName: 'Missing__c', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false },
                expect.objectContaining({ objectApiName: 'Account', wasCached: false })
            ]);

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Missing__c'], async () => describeSource);

            expect((describeSource.describe as jest.Mock).mock.calls.filter(([objectApiName]) => objectApiName === 'Missing__c')).toHaveLength(2);

        });

        /*
            The names come from files in the workspace, and jsforce joins the name into the describe
            URL's path unencoded -- a name that is not an api name is refused before any request.
        */
        it.each([
            ['a path traversal', 'x/../../query?q=SELECT+Id+FROM+User'],
            ['a slash', 'Account/describe'],
            ['a leading digit', '1Account'],
            ['a space', 'My Object'],
            ['nothing', '']
        ])('given %s for a name, sends no request for it and records it as that object\'s failure', async (unusedDescription, objectApiName) => {

            const { describeSource, describedObjectApiNames } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE });

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, [objectApiName, 'Account'], async () => describeSource);

            expect(describedObjectApiNames).toEqual(['Account']);
            expect(describeResult.outcomes[0]).toEqual({ objectApiName: objectApiName, failureMessage: ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE, wasCached: false });

        });

        it('given only unusable names, makes no connection at all', async () => {

            const describeSourceFactory = jest.fn();

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['../sobjects'], describeSourceFactory);

            expect(describeSourceFactory).not.toHaveBeenCalled();
            expect(describeResult.wasCancelled).toBe(false);

        });

        it.each([
            'Account', 'Custom_Object__c', 'ns__Custom__c', 'Setting__mdt', 'Order_Event__e', 'External__x', 'Account__History'
        ])('accepts %s as an object api name', (objectApiName) => {

            expect(SalesforceOrgService.isUsableObjectApiName(objectApiName)).toBe(true);

        });

        it('records a describe that answered with no field list as that object\'s failure', async () => {

            const { describeSource } = buildDescribeSource({ Account: { name: 'Account' } });

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource);

            expect(describeResult.outcomes[0].failureMessage).toBe('The describe of Account returned no field list.');

        });

        it('does not repeat an error code the message already starts with, and describes a thrown non-error', async () => {

            const describeSource: IOrgDescribeSource = {
                describe: jest.fn()
                    .mockRejectedValueOnce(Object.assign(new Error('INVALID_TYPE: sObject type is not supported'), { errorCode: 'INVALID_TYPE' }))
                    .mockRejectedValueOnce('socket hang up')
            };

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['First__c', 'Second__c'], async () => describeSource);

            expect(describeResult.outcomes.map(outcome => outcome.failureMessage).sort()).toEqual([
                'INVALID_TYPE: sObject type is not supported',
                'socket hang up'
            ]);

        });

        // A CONNECTION FAILURE IS AN ANSWER ABOUT THE ORG, NOT ABOUT ANY ONE OBJECT
        it('given the connection cannot be made, rejects with its error', async () => {

            await expect(SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => {
                throw new Error('No authorization information found for devhub.');
            })).rejects.toThrow('No authorization information found for devhub.');

        });

        it('stops describing once cancelled, and marks every object it did not reach', async () => {

            let isCancelled = false;
            const describeSource: IOrgDescribeSource = {
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    // AFTER A TURN, SO EVERY WORKER HAS STARTED ITS FIRST DESCRIBE BEFORE THE CANCEL LANDS
                    await Promise.resolve();
                    isCancelled = true;
                    return { name: objectApiName, fields: [] };
                })
            };

            const objectApiNames = Array.from({ length: ORG_DESCRIBE_CONCURRENCY * 3 }, (unused, objectIndex) => `Object${objectIndex}__c`);

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, objectApiNames, async () => describeSource, {
                isCancellationRequested: () => isCancelled
            });

            expect(describeResult.wasCancelled).toBe(true);
            expect(describeSource.describe).toHaveBeenCalledTimes(ORG_DESCRIBE_CONCURRENCY);
            expect(describeResult.outcomes).toHaveLength(objectApiNames.length);
            expect(describeResult.outcomes.filter(outcome => outcome.failureMessage === ORG_DESCRIBE_CANCELLED_MESSAGE)).toHaveLength(ORG_DESCRIBE_CONCURRENCY * 2);

        });

        it('given a request cancelled before it started, makes no connection', async () => {

            const describeSourceFactory = jest.fn();

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], describeSourceFactory, {
                isCancellationRequested: () => true
            });

            expect(describeSourceFactory).not.toHaveBeenCalled();
            expect(describeResult.wasCancelled).toBe(true);

        });

        it(`never has more than ${ORG_DESCRIBE_CONCURRENCY} describes in flight at once`, async () => {

            let inFlightCount = 0;
            let maximumInFlightCount = 0;

            const describeSource: IOrgDescribeSource = {
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    inFlightCount++;
                    maximumInFlightCount = Math.max(maximumInFlightCount, inFlightCount);
                    await new Promise(resolveDelay => setImmediate(resolveDelay));
                    inFlightCount--;
                    return { name: objectApiName, fields: [] };
                })
            };

            const objectApiNames = Array.from({ length: 23 }, (unused, objectIndex) => `Object${objectIndex}__c`);

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, objectApiNames, async () => describeSource);

            expect(maximumInFlightCount).toBe(ORG_DESCRIBE_CONCURRENCY);
            expect(describeResult.outcomes.every(outcome => !!outcome.describe)).toBe(true);

        });

    });

    describe('getConnection', () => {

        it('resolves the alias or username through Org.create and hands back its connection', async () => {

            const fakeConnection = { describe: jest.fn() };
            (Org.create as jest.Mock).mockResolvedValue({ getConnection: () => fakeConnection });

            const actualConnection = await SalesforceOrgService.getConnection('devhub');

            expect(Org.create).toHaveBeenCalledWith({ aliasOrUsername: 'devhub' });
            expect(actualConnection).toBe(fakeConnection);

        });

    });

    describe('promptForAuthorizedOrg', () => {

        it('given no authorized org, says so rather than showing an empty picker', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([]);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetail');

            expect(await SalesforceOrgService.promptForAuthorizedOrg('pick one')).toBeUndefined();

            expect(showWarningMessageSpy).toHaveBeenCalledWith(NO_AUTHORIZED_ORGS_MESSAGE);
            expect(promptSpy).not.toHaveBeenCalled();

        });

        it('lists every authorized org the CLI knows, and returns the one chosen', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'jd@example.com', aliases: ['devhub'], orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false },
                { username: 'scratch@example.com', aliases: null, orgId: '00D2', oauthMethod: 'jwt', configs: null, isExpired: false }
            ]);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetail').mockImplementation(async (orgDetails) => orgDetails[1]);

            const selectedOrgDetail = await SalesforceOrgService.promptForAuthorizedOrg('pick one');

            expect(promptSpy).toHaveBeenCalledWith([
                { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' },
                { targetOrgIdentifier: 'scratch@example.com', username: 'scratch@example.com', alias: undefined }
            ], 'pick one');
            expect(selectedOrgDetail).toEqual({ targetOrgIdentifier: 'scratch@example.com', username: 'scratch@example.com', alias: undefined });

        });

    });

    describe('countRecords', () => {

        beforeEach(() => {
            SalesforceOrgService.clearRecordCountCache();
        });

        // A CONNECTION STAND-IN THAT ANSWERS COUNT() BY OBJECT AND RECORDS EVERY SOQL IT WAS SENT
        function buildQuerySource(answersByObjectApiName: Record<string, number | Error>) {

            const sentQueries: string[] = [];
            let inFlightCount = 0;
            let maximumInFlightCount = 0;

            const querySource: IOrgQuerySource = {
                query: jest.fn().mockImplementation(async (soql: string) => {
                    sentQueries.push(soql);
                    inFlightCount++;
                    maximumInFlightCount = Math.max(maximumInFlightCount, inFlightCount);
                    await new Promise(resolveYield => setImmediate(resolveYield));
                    inFlightCount--;
                    const objectApiName = soql.replace('SELECT COUNT() FROM ', '');
                    const answer = answersByObjectApiName[objectApiName];
                    if ( answer instanceof Error ) {
                        throw answer;
                    }
                    return { totalSize: answer, done: true, records: [] };
                })
            };

            return { querySource, sentQueries, maxInFlight: () => maximumInFlightCount };

        }

        it('counts each object and reports count, notInOrg, noAccess and failed', async () => {

            const { querySource, sentQueries } = buildQuerySource({
                Account: 12,
                Ghost__c: Object.assign(new Error("sObject type 'Ghost__c' is not supported."), { errorCode: 'INVALID_TYPE' }),
                Secret__c: Object.assign(new Error('no access'), { errorCode: 'INSUFFICIENT_ACCESS_OR_READONLY' }),
                Broken__c: new Error('socket hang up')
            });

            const countResult = await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account', 'Ghost__c', 'Secret__c', 'Broken__c'], async () => querySource);

            expect(sentQueries).toContain('SELECT COUNT() FROM Account');
            expect(countResult.wasCancelled).toBe(false);
            expect(countResult.outcomes.map(outcome => [outcome.objectApiName, outcome.status, outcome.recordCount])).toEqual([
                ['Account', 'count', 12],
                ['Ghost__c', 'notInOrg', undefined],
                ['Secret__c', 'noAccess', undefined],
                ['Broken__c', 'failed', undefined]
            ]);
            expect(countResult.outcomes[3].failureMessage).toBe('socket hang up');

        });

        it('refuses a name that is not an api name before any query, and connects not at all when nothing else is asked', async () => {

            const querySourceFactory = jest.fn();

            const countResult = await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account; DELETE', 'x/../query'], querySourceFactory);

            expect(querySourceFactory).not.toHaveBeenCalled();
            expect(countResult.outcomes.map(outcome => [outcome.status, outcome.failureMessage])).toEqual([
                ['failed', ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE],
                ['failed', ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE]
            ]);

        });

        it('runs five queries at a time', async () => {

            const objectApiNames = Array.from({ length: 12 }, (_, objectIndex) => `Object_${objectIndex}__c`);
            const { querySource, maxInFlight } = buildQuerySource(Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, 1])));

            await SalesforceOrgService.countRecords(ORG_USERNAME, objectApiNames, async () => querySource);

            expect(maxInFlight()).toBe(ORG_DESCRIBE_CONCURRENCY);

        });

        it('caches successes per username and object for the session, and never failures', async () => {

            const { querySource, sentQueries } = buildQuerySource({ Account: 3, Broken__c: new Error('boom') });
            const querySourceFactory = jest.fn().mockResolvedValue(querySource);

            await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account', 'Broken__c'], querySourceFactory);
            const repeatResult = await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account', 'Broken__c'], querySourceFactory);

            expect(sentQueries.filter(soql => soql.endsWith('Account'))).toHaveLength(1);
            expect(sentQueries.filter(soql => soql.endsWith('Broken__c'))).toHaveLength(2);
            expect(repeatResult.outcomes[0]).toEqual({ objectApiName: 'Account', status: 'count', recordCount: 3, wasCached: true });

            await SalesforceOrgService.countRecords('other@example.com', ['Account'], querySourceFactory);
            expect(sentQueries.filter(soql => soql.endsWith('Account'))).toHaveLength(2);

        });

        it('clears one org, or one object of one org, from the cache', async () => {

            const { querySource } = buildQuerySource({ Account: 3, Contact: 4 });

            await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account', 'Contact'], async () => querySource);
            await SalesforceOrgService.countRecords('other@example.com', ['Account'], async () => querySource);

            SalesforceOrgService.clearRecordCountCache(ORG_USERNAME, 'Account');
            expect(SalesforceOrgService.getCachedRecordCount(ORG_USERNAME, 'Account')).toBeUndefined();
            expect(SalesforceOrgService.getCachedRecordCount(ORG_USERNAME, 'Contact')).toBe(4);

            SalesforceOrgService.clearRecordCountCache(ORG_USERNAME);
            expect(SalesforceOrgService.getCachedRecordCount(ORG_USERNAME, 'Contact')).toBeUndefined();
            expect(SalesforceOrgService.getCachedRecordCount('other@example.com', 'Account')).toBe(3);

        });

        it('throws a failed connection, once, for the whole request', async () => {

            await expect(SalesforceOrgService.countRecords(ORG_USERNAME, ['Account'], async () => { throw new Error('expired'); })).rejects.toThrow('expired');

        });

        it('stops when cancelled, and names what it did not count', async () => {

            const { querySource } = buildQuerySource({ Account: 1, Contact: 2 });
            let isCancelled = false;

            const countResult = await SalesforceOrgService.countRecords(ORG_USERNAME, ['Account', 'Contact', 'Lead', 'Case', 'Order', 'Asset'], async () => querySource, {
                onObjectCounted: () => { isCancelled = true; },
                isCancellationRequested: () => isCancelled
            });

            expect(countResult.wasCancelled).toBe(true);
            expect(countResult.outcomes.filter(outcome => outcome.failureMessage === ORG_DESCRIBE_CANCELLED_MESSAGE).length).toBeGreaterThan(0);

        });

        it('reads a count from totalSize and refuses an answer that has none', () => {

            expect(SalesforceOrgService.readTotalSize({ totalSize: 0 })).toBe(0);
            expect(() => SalesforceOrgService.readTotalSize({ records: [] })).toThrow();
            expect(() => SalesforceOrgService.readTotalSize({ totalSize: -1 })).toThrow();

        });

    });

    describe('the org type query', () => {

        it('queries IsSandbox and OrganizationType and labels a sandbox', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ totalSize: 1, records: [{ IsSandbox: true, OrganizationType: 'Unlimited Edition' }] }) };

            const orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);

            expect(querySource.query).toHaveBeenCalledWith(ORG_ORGANIZATION_QUERY);
            expect(orgTypeDetail).toEqual({ isSandbox: true, organizationType: 'Unlimited Edition' });
            expect(SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)).toBe('Sandbox');

        });

        it('labels anything that is not a sandbox as Production with its type, Developer Edition included', () => {

            expect(SalesforceOrgService.buildOrgTypeLabel({ isSandbox: false, organizationType: 'Developer Edition' })).toBe('Production · Developer Edition');

        });

        it('answers undefined, labelled "type unknown", when the query fails or answers with the wrong shape', async () => {

            expect(await SalesforceOrgService.queryOrganizationType({ query: jest.fn().mockRejectedValue(new Error('nope')) })).toBeUndefined();
            expect(SalesforceOrgService.normalizeOrganizationResult({ records: [{ IsSandbox: 'true', OrganizationType: 'x' }] })).toBeUndefined();
            expect(SalesforceOrgService.normalizeOrganizationResult({ records: [] })).toBeUndefined();
            expect(SalesforceOrgService.buildOrgTypeLabel(undefined)).toBe(ORG_TYPE_UNKNOWN_LABEL);

        });

    });

    describe('queryRecordIds', () => {

        it('asks for up to 2000 Ids and keeps only what is Id-shaped', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ records: [
                { Id: '001000000000001AAA' }, { Id: '001000000000002' }, { Id: 'not an id!' }, { Id: 7 }, null
            ] }) };

            expect(await SalesforceOrgService.queryRecordIds(querySource, 'Account')).toEqual(['001000000000001AAA', '001000000000002']);
            expect(querySource.query).toHaveBeenCalledWith('SELECT Id FROM Account LIMIT 2000');

        });

        it('refuses a name that is not an api name before any query', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn() };

            await expect(SalesforceOrgService.queryRecordIds(querySource, 'Account; DELETE')).rejects.toThrow();
            expect(querySource.query).not.toHaveBeenCalled();

        });

    });

    describe('normalizeDescribeResult, what a Create reads', () => {

        it('carries the object\'s createable and each field\'s defaultedOnCreate', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Account', {
                name: 'Account', createable: true,
                fields: [{ name: 'OwnerId', type: 'reference', nillable: false, createable: true, defaultedOnCreate: true, referenceTo: ['Group', 'User'] }]
            });

            expect(normalizedDescribe.isCreateable).toBe(true);
            expect(normalizedDescribe.fields[0].isDefaultedOnCreate).toBe(true);

        });

    });

});

