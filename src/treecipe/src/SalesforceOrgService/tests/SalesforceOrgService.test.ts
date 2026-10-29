import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { showWarningMessage: jest.fn(), showQuickPick: jest.fn() }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn(), create: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { AuthInfo, Org, StateAggregator } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    SalesforceOrgService,
    IOrgDescribeSource,
    NO_AUTHORIZED_ORGS_MESSAGE,
    ORG_FRONT_DOOR_FAILURE_TEXTS,
    ORG_FRONT_DOOR_SINGLE_ACCESS_PATH,
    ORG_FRONT_DOOR_TIMEOUT_MILLISECONDS,
    ORG_DESCRIBE_CANCELLED_MESSAGE,
    ORG_DESCRIBE_CONCURRENCY,
    ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE,
    ORG_ORGANIZATION_QUERY,
    ORG_TYPE_UNKNOWN_LABEL,
    DEVELOPER_EDITION_ORGANIZATION_TYPE,
    IOrgQuerySource,
    OrgConnectionStatusUnavailableError,
    ORG_CONNECTION_CHECK_CONCURRENCY,
    NO_AUTHORIZED_DEV_HUB_MESSAGE,
    TARGET_DEV_HUB_ENVIRONMENT_VARIABLE,
    TARGET_ORG_ENVIRONMENT_VARIABLE,
    LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE,
    ORG_PARENT_SEARCH_RESULT_LIMIT,
    PERMISSION_SET_QUERY_NAME_CHUNK_SIZE
} from '../SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { answerOrgConnectionPings, CONNECTED_ORG_USERNAMES } from './OrgConnectionPings';

const ACCOUNT_DESCRIBE = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'describeAccount.json'), 'utf-8'));

const ORG_USERNAME = 'jd@example.com';

const ORG_AUTHORIZATIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'orgAuthorizations.json'), 'utf-8'));

const CONNECTED_SANDBOX = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const ACTIVE_SCRATCH_ORG = { targetOrgIdentifier: 'activeScratch', username: 'test-active@example.com', alias: 'activeScratch' };

// THE IN-PROCESS CONNECTION CHECK'S PINGS (#502), AND WHO WAS PINGED
let pingedUsernames: jest.Mock = jest.fn();

function answerOrgPings(isConnected?: (username: string) => boolean) {

    pingedUsernames = answerOrgConnectionPings(Org.create as jest.Mock, isConnected);

}

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
                isUpdateable: true,
                isCalculated: false,
                isDefaultedOnCreate: false,
                isNameField: false
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
                        updateable: 'true',
                        calculated: {}
                    }
                ]
            });

            expect(normalizedDescribe).toEqual({
                objectApiName: 'Widget__c',
                objectLabel: '',
                isCreateable: false,
                isUpdateable: false,
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
                    isUpdateable: false,
                    isCalculated: false,
                    isDefaultedOnCreate: false,
                    isNameField: false
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

        it('forgets one org\'s describes on clearDescribeCacheForOrg, and keeps every other org\'s (#537)', async () => {

            const { describeSource, describedObjectApiNames } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE, Contact: { fields: [] } });
            const otherOrgUsername = 'someone.else@example.com';
            const prefixedOrgUsername = `${ORG_USERNAME}.uat`;

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account', 'Contact'], async () => describeSource);
            await SalesforceOrgService.describeObjects(otherOrgUsername, ['Account'], async () => describeSource);
            await SalesforceOrgService.describeObjects(prefixedOrgUsername, ['Account'], async () => describeSource);
            describedObjectApiNames.length = 0;

            SalesforceOrgService.clearDescribeCacheForOrg(ORG_USERNAME);

            expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Account')).toBeUndefined();
            expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Contact')).toBeUndefined();
            expect(SalesforceOrgService.getCachedDescribe(otherOrgUsername, 'Account')).toBeDefined();
            expect(SalesforceOrgService.getCachedDescribe(prefixedOrgUsername, 'Account')).toBeDefined();

        });

        it('never puts back a describe that was asked for before a clear and answered after it (#537 review)', async () => {

            let answerDescribe: (describeResult: unknown) => void = () => undefined;
            const describeSource = { describe: jest.fn().mockImplementation(() => new Promise(resolve => { answerDescribe = resolve; })) };

            const describeRequest = SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource as any);
            await new Promise(resolve => setImmediate(resolve));
            SalesforceOrgService.clearDescribeCacheForOrg(ORG_USERNAME);
            answerDescribe(ACCOUNT_DESCRIBE);
            const describeResult = await describeRequest;

            expect(describeResult.outcomes[0].describe).toBeDefined();
            expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Account')).toBeUndefined();

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
                { objectApiName: 'Missing__c', failureMessage: 'NOT_FOUND: The requested resource does not exist', isNotFound: true, wasCached: false },
                expect.objectContaining({ objectApiName: 'Account', wasCached: false })
            ]);

            await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Missing__c'], async () => describeSource);

            expect((describeSource.describe as jest.Mock).mock.calls.filter(([objectApiName]) => objectApiName === 'Missing__c')).toHaveLength(2);

        });

        // ONLY THE ORG'S OWN "NO SUCH OBJECT" IS A MISSING OBJECT (#211): A FAILURE TO ASK SAYS NOTHING ABOUT IT
        it('marks a failure isNotFound only when the org answered NOT_FOUND', async () => {

            const describeSource = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('Session expired or invalid'), { errorCode: 'INVALID_SESSION_ID' })) };

            const describeResult = await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource);

            expect(describeResult.outcomes[0].failureMessage).toBe('INVALID_SESSION_ID: Session expired or invalid');
            expect(describeResult.outcomes[0]).not.toHaveProperty('isNotFound');
            expect(SalesforceOrgService.isNotFoundError(null)).toBe(false);
            expect(SalesforceOrgService.isNotFoundError(Object.assign(new Error('x'), { errorCode: 'NOT_FOUND' }))).toBe(true);

        });

        describe('clearDescribeCache for one org and object (#211)', () => {

            it('drops only that org\'s describe of that object, matched case-insensitively, so the next request describes it afresh', async () => {

                const { describeSource, describedObjectApiNames } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE, Contact: { fields: [] } });

                await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account', 'Contact'], async () => describeSource);
                await SalesforceOrgService.describeObjects('someone.else@example.com', ['Account'], async () => describeSource);
                describedObjectApiNames.length = 0;

                SalesforceOrgService.clearDescribeCache(ORG_USERNAME, 'account');

                expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Account')).toBeUndefined();
                expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Contact')).toBeDefined();
                expect(SalesforceOrgService.getCachedDescribe('someone.else@example.com', 'Account')).toBeDefined();

                await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account', 'Contact'], async () => describeSource);

                expect(describedObjectApiNames).toEqual(['Account']);

            });

            it('still clears everything when called with no org or object', async () => {

                const { describeSource } = buildDescribeSource({ Account: ACCOUNT_DESCRIBE });

                await SalesforceOrgService.describeObjects(ORG_USERNAME, ['Account'], async () => describeSource);
                SalesforceOrgService.clearDescribeCache();

                expect(SalesforceOrgService.getCachedDescribe(ORG_USERNAME, 'Account')).toBeUndefined();

            });

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

    describe('requestOrgFrontDoorUrl (#501)', () => {

        const ACCESS_TOKEN = '00D000000000001!AQEAQaccessTokenSecret';
        const FRONT_DOOR_URI = 'https://acme--qa.sandbox.my.salesforce.com/secur/frontdoor.jsp?otp=oneTimeCode&cshc=x';

        const answerOrg = (requestGet: jest.Mock, refreshAuth: jest.Mock = jest.fn().mockResolvedValue(undefined)) => {
            const connection = { instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com', accessToken: ACCESS_TOKEN, requestGet };
            (Org.create as jest.Mock).mockResolvedValue({ refreshAuth, getConnection: () => connection });
            return { connection, refreshAuth };
        };

        it('asks the single-access endpoint of the org named by USERNAME, after refreshing its authorization, and opens its https: one-time address', async () => {

            const requestGet = jest.fn().mockResolvedValue({ frontdoor_uri: FRONT_DOOR_URI });
            const { refreshAuth } = answerOrg(requestGet);

            await expect(SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa')).resolves.toEqual({ isOpenable: true, url: FRONT_DOOR_URI });

            expect(Org.create).toHaveBeenCalledWith({ aliasOrUsername: 'qa@example.com.qa' });
            expect(refreshAuth).toHaveBeenCalledTimes(1);
            expect(refreshAuth.mock.invocationCallOrder[0]).toBeLessThan(requestGet.mock.invocationCallOrder[0]);
            expect(requestGet).toHaveBeenCalledWith(`https://acme--qa.sandbox.my.salesforce.com${ORG_FRONT_DOOR_SINGLE_ACCESS_PATH}`);
            expect(execFile).not.toHaveBeenCalled();

        });

        it('never builds an address carrying the access token', async () => {

            answerOrg(jest.fn().mockResolvedValue({ frontdoor_uri: FRONT_DOOR_URI }));

            const frontDoorResult = await SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa');

            expect(JSON.stringify(frontDoorResult)).not.toContain(ACCESS_TOKEN);
            expect(fs.readFileSync(path.join(__dirname, '..', 'SalesforceOrgService.ts'), 'utf-8')).not.toMatch(/getOrgFrontDoorUrl\s*\(|frontdoor\.jsp\?sid=\$\{|accessToken/);

        });

        it('answers a connection that cannot be made, and a request that fails, with fixed texts that quote nothing', async () => {

            (Org.create as jest.Mock).mockRejectedValue(new Error(`NoAuthInfoFound ${ACCESS_TOKEN}`));
            const connectionResult = await SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa');
            expect(connectionResult).toEqual({ isOpenable: false, failure: 'connectionFailed', failureMessage: ORG_FRONT_DOOR_FAILURE_TEXTS.connectionFailed });

            answerOrg(jest.fn(), jest.fn().mockRejectedValue(new Error('expired')));
            await expect(SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa')).resolves.toMatchObject({ failure: 'connectionFailed' });

            answerOrg(jest.fn().mockRejectedValue(new Error(`403 for https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=${ACCESS_TOKEN}`)));
            const requestResult = await SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa');
            expect(requestResult).toEqual({ isOpenable: false, failure: 'requestFailed', failureMessage: ORG_FRONT_DOOR_FAILURE_TEXTS.requestFailed });

            expect(JSON.stringify([connectionResult, requestResult])).not.toContain(ACCESS_TOKEN);

        });

        it('gives up after its timeout with a fixed text', async () => {

            jest.useFakeTimers();
            try {
                answerOrg(jest.fn().mockImplementation(() => new Promise(() => undefined)));
                const pendingResult = SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa');
                await jest.advanceTimersByTimeAsync(ORG_FRONT_DOOR_TIMEOUT_MILLISECONDS);
                await expect(pendingResult).resolves.toEqual({ isOpenable: false, failure: 'timedOut', failureMessage: ORG_FRONT_DOOR_FAILURE_TEXTS.timedOut });
            } finally {
                jest.useRealTimers();
            }

        });

        it('clears its timer on success, and drops an address that arrives after the timeout', async () => {

            jest.useFakeTimers();
            try {
                answerOrg(jest.fn().mockResolvedValue({ frontdoor_uri: FRONT_DOOR_URI }));
                await expect(SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa')).resolves.toMatchObject({ isOpenable: true });
                expect(jest.getTimerCount()).toBe(0);

                let answerLate: (response: unknown) => void = () => undefined;
                answerOrg(jest.fn().mockImplementation(() => new Promise(resolve => { answerLate = resolve; })));
                const pendingResult = SalesforceOrgService.requestOrgFrontDoorUrl('qa@example.com.qa');
                await jest.advanceTimersByTimeAsync(ORG_FRONT_DOOR_TIMEOUT_MILLISECONDS);
                answerLate({ frontdoor_uri: FRONT_DOOR_URI });
                await expect(pendingResult).resolves.toMatchObject({ isOpenable: false, failure: 'timedOut' });
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                jest.useRealTimers();
            }

        });

        it('opens nothing but an https: frontdoor_uri string', () => {

            ['http://acme.my.salesforce.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'command:workbench.action.terminal.new', 'not a url'].forEach(frontdoor_uri => {
                expect(SalesforceOrgService.readOrgFrontDoorResponse({ frontdoor_uri }))
                    .toEqual({ isOpenable: false, failure: 'notHttps', failureMessage: ORG_FRONT_DOOR_FAILURE_TEXTS.notHttps });
            });

            [undefined, null, 'https://acme.my.salesforce.com/', [FRONT_DOOR_URI], {}, { frontdoor_uri: 42 }, { frontdoor_uri: '' }, { url: FRONT_DOOR_URI }].forEach(response => {
                expect(SalesforceOrgService.readOrgFrontDoorResponse(response))
                    .toEqual({ isOpenable: false, failure: 'noAddress', failureMessage: ORG_FRONT_DOOR_FAILURE_TEXTS.noAddress });
            });

        });

        it('words every failure without a URL, a token or a parenthesis the notification escaper would mangle', () => {

            Object.values(ORG_FRONT_DOOR_FAILURE_TEXTS).forEach(failureText => {
                expect(failureText).not.toMatch(/https?:|sid=|otp=|[()[\]]/);
            });

        });

    });

    describe('promptForAuthorizedOrg', () => {

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
        });

        it('given no authorized org, says so rather than showing an empty picker', async () => {

            answerOrgPings();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([]);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValue(undefined);

            expect(await SalesforceOrgService.promptForAuthorizedOrg('pick one')).toBeUndefined();

            expect(await promptSpy.mock.calls[0][0]).toEqual({ orgDetails: [], emptyListMessage: NO_AUTHORIZED_ORGS_MESSAGE });

        });

        it('offers only the orgs that answer their ping, production included, and returns the one chosen', async () => {

            answerOrgPings(username => username !== 'old@example.com');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'jd@example.com', aliases: ['devhub'], orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false, instanceUrl: 'https://acme.my.salesforce.com' },
                { username: 'old@example.com', aliases: ['old'], orgId: '00D3', oauthMethod: 'web', configs: null, isExpired: false },
                { username: 'scratch@example.com', aliases: null, orgId: '00D2', oauthMethod: 'jwt', configs: null, isExpired: false, isScratchOrg: true }
            ]);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed')
                .mockImplementation(async (orgListing) => (await orgListing).orgDetails[1]);

            const selectedOrgDetail = await SalesforceOrgService.promptForAuthorizedOrg('pick one');

            expect(await promptSpy.mock.calls[0][0]).toEqual({
                orgDetails: [
                    { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' },
                    { targetOrgIdentifier: 'scratch@example.com', username: 'scratch@example.com', alias: undefined }
                ],
                emptyListMessage: expect.any(String)
            });
            expect(promptSpy.mock.calls[0][1]).toBe('pick one');
            expect(selectedOrgDetail).toEqual({ targetOrgIdentifier: 'scratch@example.com', username: 'scratch@example.com', alias: undefined });

        });

        it('given every authorized org filtered out, names how many were left out as expired, deleted or not connected', async () => {

            answerOrgPings();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS.filter((authorization: any) => ![CONNECTED_SANDBOX.username, ACTIVE_SCRATCH_ORG.username].includes(authorization.username)));

            expect(await SalesforceOrgService.listAuthorizedOrgDetailsForPicker()).toEqual({
                orgDetails: [],
                emptyListMessage: 'No connected Salesforce org is authorized: 4 authorized orgs are not listed (1 expired, 3 not connected). Re-authorize one with "sf org login web" and try again.'
            });

        });

        it('given authorizations that cannot be read, lists nothing and says why -- never every authorization unchecked', async () => {

            answerOrgPings();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValue(new Error('EACCES: permission denied (alias.json)'));

            const pickerListing = await SalesforceOrgService.listAuthorizedOrgDetailsForPicker();

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toContain('could not be read, so no org is listed');
            // THE ERROR'S OWN TEXT IS ESCAPED: A NOTIFICATION RENDERS [label](command:...) AS A LINK THAT RUNS IT
            expect(pickerListing.emptyListMessage).toContain('EACCES: permission denied \\u0028alias.json\\u0029');
            expect(pickerListing.emptyListMessage).not.toMatch(/[[\]()]/);

        });

    });

    describe('listConnectedOrgAuthorizations', () => {

        let checkSpy: jest.SpyInstance;

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            (execFile as unknown as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);
            checkSpy = jest.spyOn(SalesforceOrgService, 'checkOrgConnections');
        });

        it('pings every authorization in process, by username, and starts no Salesforce CLI process (#502)', async () => {

            const runSalesforceCliSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');
            answerOrgPings();

            await SalesforceOrgService.listConnectedOrgAuthorizations();

            expect(execFile).not.toHaveBeenCalled();
            expect(runSalesforceCliSpy).not.toHaveBeenCalled();
            // THE EXPIRED SCRATCH ORG IS ANSWERED FROM ITS FILE, WITH NO REQUEST
            expect(pingedUsernames.mock.calls.map(([username]) => username).sort()).toEqual([
                'qa@example.com.qa', 'stale@example.com.dev', 'test-active@example.com', 'test-deleted@example.com', 'uat@example.com.uat'
            ]);
            expect((Org.create as jest.Mock).mock.calls.map(([options]) => Object.keys(options))).toSatisfyAll((optionKeys: string[]) => optionKeys.join() === 'aliasOrUsername');

        });

        it('lists only the orgs that answer their ping: not a failed refresh, an unreachable host, an expired or a deleted scratch org', async () => {

            answerOrgPings();

            const authorizedOrgListing = await SalesforceOrgService.listAuthorizedOrgDetails();

            expect(authorizedOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(authorizedOrgListing.hiddenOrgs).toEqual([
                { username: 'uat@example.com.uat', label: 'uat', reason: 'notConnected' },
                { username: 'stale@example.com.dev', label: 'stale', reason: 'notConnected' },
                { username: 'test-expired@example.com', label: 'expiredScratch', reason: 'expired' },
                { username: 'test-deleted@example.com', label: 'deletedScratch', reason: 'notConnected' }
            ]);
            expect(authorizedOrgListing.hiddenOrgReasonCounts).toEqual({ production: 0, expired: 1, deleted: 0, notConnected: 3 });

        });

        it.each([
            ['a ping that answers', { username: 'x@example.com' }, () => Promise.resolve(), 'connected'],
            ['a ping that fails', { username: 'x@example.com' }, () => Promise.reject(new Error('expired access/refresh token')), 'notConnected'],
            ['a scratch org past its expiration date, with no request', { username: 'x@example.com', isScratchOrg: true, isExpired: true }, undefined, 'expired'],
            ['an authorization @salesforce/core could not read, with no request', { username: 'x@example.com', error: 'bad auth file', isExpired: 'unknown' }, undefined, 'notConnected'],
            ['a username that could be read as a flag, with no request', { username: '-o' }, undefined, 'notConnected'],
            ['no username, with no request', { username: 7 }, undefined, 'notConnected']
        ])('reads %s', async (_description, authorization, refreshAuth, expectedState) => {

            (Org.create as jest.Mock).mockReset().mockResolvedValue({ getUsername: () => 'x@example.com', refreshAuth: jest.fn(refreshAuth) });

            expect(await SalesforceOrgService.checkOrgConnection(authorization as any)).toBe(expectedState);
            expect(Org.create).toHaveBeenCalledTimes(refreshAuth ? 1 : 0);

        });

        it('pings nothing, and reads not connected, when the username opens an org under another username, as an alias spelled like it would', async () => {

            const refreshAuth = jest.fn().mockResolvedValue(undefined);
            (Org.create as jest.Mock).mockResolvedValue({ getUsername: () => 'other@example.com', refreshAuth: refreshAuth });

            expect(await SalesforceOrgService.checkOrgConnection({ username: 'x@example.com' } as any)).toBe('notConnected');
            expect(refreshAuth).not.toHaveBeenCalled();

        });

        it('reads an org that cannot even be opened as not connected, and never throws', async () => {

            (Org.create as jest.Mock).mockRejectedValue(new Error('NamedOrgNotFoundError'));

            expect(await SalesforceOrgService.checkOrgConnection({ username: 'x@example.com' } as any)).toBe('notConnected');

        });

        it('reads an org that does not answer within its own time as not connected', async () => {

            (Org.create as jest.Mock).mockResolvedValue({ getUsername: () => 'x@example.com', refreshAuth: () => new Promise(() => undefined) });

            expect(await SalesforceOrgService.checkOrgConnection({ username: 'x@example.com' } as any, 5)).toBe('notConnected');

        });

        it(`checks at most ${ORG_CONNECTION_CHECK_CONCURRENCY} orgs at a time`, async () => {

            let inFlightCount = 0;
            let mostInFlight = 0;
            (Org.create as jest.Mock).mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
                getUsername: () => aliasOrUsername,
                refreshAuth: async () => {
                    inFlightCount++;
                    mostInFlight = Math.max(mostInFlight, inFlightCount);
                    await new Promise(resolve => setImmediate(resolve));
                    inFlightCount--;
                }
            }));
            const authorizations = Array.from({ length: ORG_CONNECTION_CHECK_CONCURRENCY * 3 }, (_unused, index) => ({ username: `org${index}@example.com` }));

            const orgConnectionCheck = await SalesforceOrgService.checkOrgConnections(authorizations as any);

            expect(mostInFlight).toBe(ORG_CONNECTION_CHECK_CONCURRENCY);
            expect(orgConnectionCheck.isComplete).toBe(true);
            expect([...orgConnectionCheck.connectionStatesByUsername.values()]).toSatisfyAll((connectionState: string) => connectionState === 'connected');

        });

        it('leaves out only the org still unanswered when the listing\'s own time runs out, never the whole list, and says the check is not complete', async () => {

            (Org.create as jest.Mock).mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
                getUsername: () => aliasOrUsername,
                refreshAuth: () => aliasOrUsername === 'hung@example.com' ? new Promise(() => undefined) : Promise.resolve()
            }));

            const orgConnectionCheck = await SalesforceOrgService.checkOrgConnections([
                { username: 'hung@example.com' }, { username: 'quick@example.com' }, { username: 'quick2@example.com' }
            ] as any, 20, 1000);

            expect(orgConnectionCheck.connectionStatesByUsername).toEqual(new Map([['hung@example.com', 'notConnected'], ['quick@example.com', 'connected'], ['quick2@example.com', 'connected']]));
            expect(orgConnectionCheck.isComplete).toBe(false);

        });

        it('keeps an org that answers after the listing\'s own time ran out as not connected', async () => {

            let answerLatePing: () => void = () => undefined;
            (Org.create as jest.Mock).mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
                getUsername: () => aliasOrUsername,
                refreshAuth: () => new Promise<void>(resolve => { answerLatePing = resolve; })
            }));

            const orgConnectionCheck = await SalesforceOrgService.checkOrgConnections([{ username: 'late@example.com' }] as any, 10, 1000);
            answerLatePing();
            await new Promise(resolve => setImmediate(resolve));

            expect(orgConnectionCheck.connectionStatesByUsername.get('late@example.com')).toBe('notConnected');

        });

        it('does not cache a listing whose own time ran out, so the next picker checks again', async () => {

            answerOrgPings();
            checkSpy.mockResolvedValueOnce({ connectionStatesByUsername: new Map([['qa@example.com.qa', 'connected']]), isComplete: false });

            expect((await SalesforceOrgService.listConnectedOrgAuthorizations()).isComplete).toBe(false);
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

            expect((await SalesforceOrgService.listConnectedOrgAuthorizations()).isComplete).toBe(true);
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(true);
            expect(checkSpy).toHaveBeenCalledTimes(2);

        });

        it('leaves out a username the check names with no authorization file, and an unusable identifier', async () => {

            answerOrgPings(() => true);
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'bad@example.com', aliases: ['-o'], orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false }
            ]);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([]);

        });

        it('checks once a session: three listings run one check', async () => {

            answerOrgPings();

            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetailsForPicker();

            expect(checkSpy).toHaveBeenCalledTimes(1);
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(true);

        });

        it('shares one check between two listings asked while a check is in flight', async () => {

            answerOrgPings();

            const [firstListing, secondListing] = await Promise.all([
                SalesforceOrgService.listConnectedOrgAuthorizations(),
                SalesforceOrgService.listConnectedOrgAuthorizations()
            ]);

            expect(checkSpy).toHaveBeenCalledTimes(1);
            expect(secondListing).toBe(firstListing);

        });

        it('checks again on a refresh, and replaces the cached answer', async () => {

            answerOrgPings();
            const firstListing = await SalesforceOrgService.listConnectedOrgAuthorizations();

            answerOrgPings(username => username === 'uat@example.com.uat');
            const refreshedListing = await SalesforceOrgService.refreshConnectedOrgAuthorizations();

            expect(checkSpy).toHaveBeenCalledTimes(2);
            expect(refreshedListing).not.toBe(firstListing);
            expect(await SalesforceOrgService.listConnectedOrgAuthorizations()).toBe(refreshedListing);
            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails.map(orgDetail => orgDetail.username)).toEqual(['uat@example.com.uat']);

        });

        it('never lets a check started before a clear write over the answer asked for after it', async () => {

            answerOrgPings();
            const staleCheck = SalesforceOrgService.listConnectedOrgAuthorizations();
            SalesforceOrgService.clearConnectedOrgStatusCache();
            await staleCheck;

            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

        });

        it('lists no org when the authorizations cannot be read, caches nothing, and asks again next time', async () => {

            answerOrgPings();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValueOnce(new Error('auth files unreadable'));

            const failedListing = SalesforceOrgService.listDataOrgDetails();
            await expect(failedListing).rejects.toThrow(OrgConnectionStatusUnavailableError);
            await expect(failedListing).rejects.toThrow('The authorized Salesforce orgs could not be read, so no org is listed. auth files unreadable');
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);

        });

        it('caches nothing when the check itself throws, so the next listing checks again', async () => {

            answerOrgPings();
            checkSpy.mockRejectedValueOnce(new Error('check failed'));

            await expect(SalesforceOrgService.listConnectedOrgAuthorizations()).rejects.toThrow('check failed');
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(checkSpy).toHaveBeenCalledTimes(2);

        });

        it('says the orgs could not be listed, in its own words, when the check fails some other way', async () => {

            answerOrgPings();
            checkSpy.mockRejectedValueOnce(new Error('check failed')).mockRejectedValueOnce('no error object');

            expect((await SalesforceOrgService.listAuthorizedOrgDetailsForPicker()).emptyListMessage).toBe('The authorized Salesforce orgs could not be listed: check failed');
            expect((await SalesforceOrgService.listAuthorizedOrgDetailsForPicker()).emptyListMessage).toBe('The authorized Salesforce orgs could not be listed: no error object');

        });

        it('reads authorizations that reject with something other than an error, and skips an entry with no authorization', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValueOnce('alias.json is locked');
            await expect(SalesforceOrgService.listConnectedOrgAuthorizations()).rejects.toThrow('could not be read, so no org is listed. alias.json is locked');

            answerOrgPings(() => true);
            expect((await SalesforceOrgService.checkOrgConnections([null, { username: 'x@example.com' }] as any)).connectionStatesByUsername).toEqual(new Map([['x@example.com', 'connected']]));

        });

        it('leaves out an authorization the check has no answer for: expired when its file says so, otherwise not connected', () => {

            const connectedOrgStatusListing = { connectionStatesByUsername: new Map<string, any>() };

            expect(SalesforceOrgService.buildConnectedOrgListing([
                { username: 'old@example.com', isExpired: true } as any,
                { username: 'unchecked@example.com', isExpired: false } as any
            ], connectedOrgStatusListing, false).hiddenOrgs).toEqual([
                { username: 'old@example.com', label: 'old@example.com', reason: 'expired' },
                { username: 'unchecked@example.com', label: 'unchecked@example.com', reason: 'notConnected' }
            ]);

        });

        it('skips an authorization with no username, labels one with no alias by username, and reads a missing list as empty', () => {

            const connectedOrgStatusListing = { connectionStatesByUsername: new Map<string, any>([['a@example.com', 'expired']]) };

            expect(SalesforceOrgService.buildConnectedOrgListing([
                { username: '' } as any,
                null as any,
                { username: 'a@example.com', aliases: null } as any
            ], connectedOrgStatusListing, false).hiddenOrgs).toEqual([{ username: 'a@example.com', label: 'a@example.com', reason: 'expired' }]);

            expect(SalesforceOrgService.buildConnectedOrgListing(undefined as any, connectedOrgStatusListing, false).orgDetails).toEqual([]);

        });

        it('says the authorized orgs could not be read, as escaped text, when the authorization files cannot be read', async () => {

            answerOrgPings();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValue(new Error('auth files [unreadable](command:x)'));

            const pickerListing = await SalesforceOrgService.listAuthorizedOrgDetailsForPicker();

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toContain('could not be read, so no org is listed');
            expect(pickerListing.emptyListMessage).not.toContain('Salesforce CLI');
            expect(pickerListing.emptyListMessage).not.toMatch(/[[\]()]/);

        });

        it('asks again when an authorization was added after the cached check, and only then', async () => {

            answerOrgPings();
            await SalesforceOrgService.listAuthorizedOrgDetails();
            await SalesforceOrgService.listDataOrgDetails();
            expect(checkSpy).toHaveBeenCalledTimes(1);

            const newlyAuthorizedOrg = { username: 'new@example.com.qa', aliases: ['newqa'], orgId: '00D7', oauthMethod: 'web', configs: null, isExpired: false, isSandbox: true };
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([...ORG_AUTHORIZATIONS, newlyAuthorizedOrg]);
            answerOrgPings(username => [...CONNECTED_ORG_USERNAMES, 'new@example.com.qa'].includes(username));

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails.map(orgDetail => orgDetail.username)).toContain('new@example.com.qa');
            await SalesforceOrgService.listDataOrgDetails();

            expect(checkSpy).toHaveBeenCalledTimes(2);

        });

        it('asks again once when a cached answer leaves a quick pick nothing to offer, as after "sf org login web"', async () => {

            answerOrgPings(() => false);
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([ORG_AUTHORIZATIONS[0]]);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([]);
            expect(checkSpy).toHaveBeenCalledTimes(1);

            answerOrgPings(() => true);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX]);
            expect(checkSpy).toHaveBeenCalledTimes(2);

        });

        it('does not ask again for an authorization the cached check already answered, an expired scratch org included', async () => {

            answerOrgPings();

            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetails();

            expect(checkSpy).toHaveBeenCalledTimes(1);

        });

        it('shares a check already in flight with a refresh, rather than starting a second', async () => {

            answerOrgPings();

            const [listing, refreshedListing] = await Promise.all([
                SalesforceOrgService.listConnectedOrgAuthorizations(),
                SalesforceOrgService.refreshConnectedOrgAuthorizations()
            ]);

            expect(checkSpy).toHaveBeenCalledTimes(1);
            expect(refreshedListing).toBe(listing);

        });

        it('never logs out of, deletes or changes an org: a ping is one refreshAuth and nothing else', async () => {

            const orgMethodsCalled: string[] = [];
            (Org.create as jest.Mock).mockImplementation(async () => new Proxy({}, {
                get: (_target, methodName: string) => {
                    orgMethodsCalled.push(methodName);
                    if ( methodName === 'getUsername' ) {
                        return () => 'qa@example.com.qa';
                    }
                    return methodName === 'refreshAuth' ? () => Promise.resolve() : undefined;
                }
            }));

            await SalesforceOrgService.refreshConnectedOrgAuthorizations();
            await SalesforceOrgService.listDataOrgDetails();

            expect(new Set(orgMethodsCalled.filter(methodName => methodName !== 'then'))).toEqual(new Set(['getUsername', 'refreshAuth']));

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

        it('allows a data set insert into a sandbox or scratch org, or a Developer Edition org matched exactly, and nothing else', () => {

            expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert({ isSandbox: true, organizationType: 'Unlimited Edition' })).toBe(true);
            expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert({ isSandbox: true, organizationType: '' })).toBe(true);
            expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert({ isSandbox: false, organizationType: DEVELOPER_EDITION_ORGANIZATION_TYPE })).toBe(true);

            ['Enterprise Edition', 'Unlimited Edition', 'Professional Edition', '', 'developer edition', 'DEVELOPER EDITION', ' Developer Edition', 'Developer Edition ', 'Developer  Edition']
                .forEach(organizationType => {
                    expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert({ isSandbox: false, organizationType: organizationType })).toBe(false);
                });

            expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert(undefined)).toBe(false);

        });

        it('allows nothing whose Organization answer could not be read', async () => {

            const unreadableAnswers: unknown[] = [
                { records: [] },
                { records: [{ IsSandbox: false, OrganizationType: 'Developer Edition' }, { IsSandbox: false, OrganizationType: 'Developer Edition' }] },
                { records: [{ IsSandbox: 'false', OrganizationType: 'Developer Edition' }] },
                { records: [{ IsSandbox: false, OrganizationType: null }] },
                undefined
            ];

            for ( const unreadableAnswer of unreadableAnswers ) {
                const orgTypeDetail = await SalesforceOrgService.queryOrganizationType({ query: jest.fn().mockResolvedValue(unreadableAnswer) });
                expect(SalesforceOrgService.isOrgTypeAllowedForDataSetInsert(orgTypeDetail)).toBe(false);
            }

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

    describe('queryExistingRecordIds and isSameRecordId (#421)', () => {

        it('asks for the named Ids of one object in one query and keeps only the Id-shaped answers', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ records: [{ Id: '001000000000001AAA' }, { Id: 'bad id' }, null] }) };

            expect(await SalesforceOrgService.queryExistingRecordIds(querySource, 'Account', ['001000000000001', '001000000000002AAA', '001000000000001'])).toEqual(['001000000000001AAA']);
            expect(querySource.query).toHaveBeenCalledWith("SELECT Id FROM Account WHERE Id IN ('001000000000001', '001000000000002AAA')");

        });

        it('sends no query for no Ids, and refuses an Id that could close the quote, or an object that is not an api name, before any query', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn() };

            expect(await SalesforceOrgService.queryExistingRecordIds(querySource, 'Account', [])).toEqual([]);
            await expect(SalesforceOrgService.queryExistingRecordIds(querySource, 'Account', ["001') OR Id != ('"])).rejects.toThrow('is not a Salesforce Id');
            await expect(SalesforceOrgService.queryExistingRecordIds(querySource, 'Account; DELETE', ['001000000000001AAA'])).rejects.toThrow();
            expect(querySource.query).not.toHaveBeenCalled();

        });

        it('throws, rather than answering "none exist", for an answer with no records list', async () => {

            await expect(SalesforceOrgService.queryExistingRecordIds({ query: jest.fn().mockResolvedValue({ records: 'x' }) }, 'Account', ['001000000000001AAA'])).rejects.toThrow('could not be read');

        });

        it('reads a 15-character Id as the case-sensitive head of its 18-character form', () => {

            expect(SalesforceOrgService.isSameRecordId('001000000000001AAA', '001000000000001')).toBe(true);
            expect(SalesforceOrgService.isSameRecordId('001000000000001', '001000000000001AAA')).toBe(true);
            expect(SalesforceOrgService.isSameRecordId('001000000000001AAA', '001000000000001AAA')).toBe(true);
            expect(SalesforceOrgService.isSameRecordId('001000000000001AAA', '001000000000001AAB')).toBe(false);
            expect(SalesforceOrgService.isSameRecordId('001000000000001aaa', '001000000000001')).toBe(true);
            expect(SalesforceOrgService.isSameRecordId('001000000000001', '00100000000000a')).toBe(false);
            expect(SalesforceOrgService.isSameRecordId('001', '001')).toBe(false);

        });

        it('keeps a describe\'s key prefix only when it is three letters or digits', () => {

            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', keyPrefix: '001', fields: [] }).keyPrefix).toBe('001');
            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', keyPrefix: null, fields: [] })).not.toHaveProperty('keyPrefix');
            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', keyPrefix: "0'1", fields: [] })).not.toHaveProperty('keyPrefix');

        });

        it('keeps a describe\'s child relationships whose child and field are api names, and none at all when no entry is (#445)', () => {

            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', fields: [], childRelationships: [
                { childSObject: 'Gadget__c', field: 'Account__c', relationshipName: 'Gadgets__r' },
                { childSObject: 'Contact', field: 'AccountId' },
                { childSObject: 'Bad Name', field: 'AccountId' },
                { childSObject: 'Case', field: 7 },
                null
            ] }).childRelationships).toEqual([
                { childObjectApiName: 'Gadget__c', fieldApiName: 'Account__c' },
                { childObjectApiName: 'Contact', fieldApiName: 'AccountId' }
            ]);
            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', fields: [], childRelationships: [{ childSObject: 'x y', field: 'z' }] })).not.toHaveProperty('childRelationships');
            expect(SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', fields: [], childRelationships: 'nope' })).not.toHaveProperty('childRelationships');

        });

    });

    describe('queryPermissionSets (#302, #500)', () => {

        it('asks for the named permission sets in one query and keeps only api names with a Salesforce Id, with each one\'s namespace', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ records: [
                { Id: '0PS000000000001AAA', Name: 'Account_Tree_Access', NamespacePrefix: null },
                { Id: '0PS000000000002AAA', Name: 'Account_Tree_Access', NamespacePrefix: 'pkg' },
                { Id: '0PS000000000003AAA', Name: 'bad name' }, { Id: '0PS000000000004AAA', Name: 7 }, null,
                { Id: 'not-an-id', Name: 'Contact_Reader' }, { Name: 'Contact_Reader' }, { Id: '0PS000000000005', Name: 'Gadget_Access', NamespacePrefix: '' }
            ] }) };

            expect(await SalesforceOrgService.queryPermissionSets(querySource, ['Account_Tree_Access', 'Contact_Reader', 'Gadget_Access'])).toEqual([
                { id: '0PS000000000001AAA', name: 'Account_Tree_Access', namespacePrefix: undefined },
                { id: '0PS000000000002AAA', name: 'Account_Tree_Access', namespacePrefix: 'pkg' },
                { id: '0PS000000000005', name: 'Gadget_Access', namespacePrefix: undefined }
            ]);
            expect(querySource.query).toHaveBeenCalledWith('SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE Name IN (\'Account_Tree_Access\', \'Contact_Reader\', \'Gadget_Access\')');

        });

        it('asks for at most PERMISSION_SET_QUERY_NAME_CHUNK_SIZE names a query, so 200 long names stay under the URL limit, and joins the answers', async () => {

            const names = Array.from({ length: 2 * PERMISSION_SET_QUERY_NAME_CHUNK_SIZE + 1 }, (_unused, nameIndex) => `Set_${nameIndex}`);
            const querySource: IOrgQuerySource = { query: jest.fn().mockImplementation(async (soql: string) => ({
                records: names.filter(name => soql.includes(`'${name}'`)).map((name, nameIndex) => ({ Id: `0PS${String(nameIndex).padStart(12, '0')}`, Name: name }))
            })) };

            expect((await SalesforceOrgService.queryPermissionSets(querySource, names)).map(permissionSet => permissionSet.name)).toEqual(names);
            expect(querySource.query).toHaveBeenCalledTimes(3);
            (querySource.query as jest.Mock).mock.calls.forEach(([soql]) => expect((soql.match(/'/g) ?? []).length / 2).toBeLessThanOrEqual(PERMISSION_SET_QUERY_NAME_CHUNK_SIZE));

            // ONE CHUNK THAT CANNOT BE READ FAILS THE WHOLE ANSWER: NEVER "THE ORG HOLDS ONLY THE OTHERS"
            const failingSource: IOrgQuerySource = { query: jest.fn().mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({}) };
            await expect(SalesforceOrgService.queryPermissionSets(failingSource, names)).rejects.toThrow('could not be read');

        });

        it('sends no query for no names, and refuses a name that could close the quote before any query', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn() };

            expect(await SalesforceOrgService.queryPermissionSets(querySource, [])).toEqual([]);
            await expect(SalesforceOrgService.queryPermissionSets(querySource, ['Ok', "x') OR Name != ('"])).rejects.toThrow('is not a Salesforce api name');
            expect(querySource.query).not.toHaveBeenCalled();

        });

        it('throws, rather than answering "none", for a failed query or an answer with no records list', async () => {

            await expect(SalesforceOrgService.queryPermissionSets({ query: jest.fn().mockRejectedValue(new Error('INVALID_SESSION_ID')) }, ['A'])).rejects.toThrow('INVALID_SESSION_ID');
            await expect(SalesforceOrgService.queryPermissionSets({ query: jest.fn().mockResolvedValue({ records: 'x' }) }, ['A'])).rejects.toThrow('could not be read');
            await expect(SalesforceOrgService.queryPermissionSets({ query: jest.fn().mockResolvedValue(undefined) }, ['A'])).rejects.toThrow('could not be read');

        });

    });

    describe('queryUserId (#500)', () => {

        it('asks for the user by its username, with backslashes and quotes escaped, and answers its Id', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ records: [{ Id: '005000000000001AAA' }] }) };

            expect(await SalesforceOrgService.queryUserId(querySource, "o'brien\\x@example.com")).toBe('005000000000001AAA');
            expect(querySource.query).toHaveBeenCalledWith("SELECT Id FROM User WHERE Username = 'o\\'brien\\\\x@example.com'");

        });

        it('throws for a failed query, no user, more than one, or an Id that is not a Salesforce Id', async () => {

            await expect(SalesforceOrgService.queryUserId({ query: jest.fn().mockRejectedValue(new Error('INVALID_SESSION_ID')) }, 'a@b.c')).rejects.toThrow('INVALID_SESSION_ID');
            const unsentSource: IOrgQuerySource = { query: jest.fn() };
            for ( const username of ['a@b.c\n', 'a\u2028@b.c', 'a\u0000b@c.d'] ) {
                await expect(SalesforceOrgService.queryUserId(unsentSource, username)).rejects.toThrow('control character');
            }
            expect(unsentSource.query).not.toHaveBeenCalled();
            for ( const answer of [undefined, { records: 'x' }, { records: [] }, { records: [{ Id: '005000000000001' }, { Id: '005000000000002' }] }, { records: [{ Id: 'x' }] }, { records: [null] }] ) {
                await expect(SalesforceOrgService.queryUserId({ query: jest.fn().mockResolvedValue(answer) }, 'a@b.c')).rejects.toThrow('could not be read');
            }

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

    describe('the parent search of a Create (#254)', () => {

        const buildSearchField = (fieldApiName: string, isNameField: boolean) => SalesforceOrgService.normalizeDescribeResult('X', {
            fields: [{ name: fieldApiName, type: 'string', nameField: isNameField }]
        }).fields[0];

        it('normalizes the describe\'s nameField, and anything but true is false', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Case', {
                name: 'Case',
                fields: [{ name: 'CaseNumber', type: 'string', nameField: true }, { name: 'Subject', type: 'string', nameField: 'true' }, { name: 'Id', type: 'id' }]
            });

            expect(normalizedDescribe.fields.map(describeField => describeField.isNameField)).toEqual([true, false, false]);
            expect(SalesforceOrgService.findNameFieldApiName(normalizedDescribe)).toBe('CaseNumber');

        });

        it('finds no name field when the describe marks none, more than one, or one that is not an api name', () => {

            expect(SalesforceOrgService.findNameFieldApiName({ fields: [buildSearchField('Name', false)] })).toBeUndefined();
            expect(SalesforceOrgService.findNameFieldApiName({ fields: [buildSearchField('Name', true), buildSearchField('Other', true)] })).toBeUndefined();
            expect(SalesforceOrgService.findNameFieldApiName({ fields: [buildSearchField('Name) FROM User --', true)] })).toBeUndefined();

        });

        it('builds a "contains" query on the name field, one more than the limit, with no COUNT()', () => {

            expect(SalesforceOrgService.buildParentSearchQuery('Account', 'Name', 'Acme'))
                .toBe(`SELECT Id, Name FROM Account WHERE Name LIKE '%Acme%' ORDER BY Name LIMIT ${ORG_PARENT_SEARCH_RESULT_LIMIT + 1}`);
            expect(SalesforceOrgService.buildParentSearchQuery('Account', 'Name', 'Acme')).not.toMatch(/COUNT\(/i);

        });

        it.each([
            ['a quote', 'O\'Brien', 'O\\\'Brien'],
            ['a quote that would end the literal', '\' OR Name != \'', '\\\' OR Name != \\\''],
            ['a backslash before a quote', '\\\' OR Id != null --', '\\\\\\\' OR Id != null --'],
            ['a lone backslash', 'back\\slash', 'back\\\\slash'],
            ['a percent sign', '100%', '100\\%'],
            ['an underscore', 'a_b', 'a\\_b'],
            ['a double quote', 'say "hi"', 'say \\"hi\\"'],
            ['every one together', '%_\'\\', '\\%\\_\\\'\\\\']
        ])('matches %s literally', (_label, searchText, expectedEscapedText) => {

            const searchQuery = SalesforceOrgService.buildParentSearchQuery('Account', 'Name', searchText) as string;

            expect(SalesforceOrgService.escapeSoqlLikeSearchText(searchText)).toBe(expectedEscapedText);
            expect(searchQuery).toBe(`SELECT Id, Name FROM Account WHERE Name LIKE '%${expectedEscapedText}%' ORDER BY Name LIMIT ${ORG_PARENT_SEARCH_RESULT_LIMIT + 1}`);

            // THE LITERAL ENDS ONLY AT THE CLOSING '%': EVERY OTHER QUOTE INSIDE IT IS ESCAPED BY AN ODD RUN OF BACKSLASHES
            const literalBody = searchQuery.slice(searchQuery.indexOf('\'%') + 2, searchQuery.lastIndexOf('%\''));
            const unescapedQuotes = [...literalBody.matchAll(/(\\*)'/g)].filter(quoteMatch => quoteMatch[1].length % 2 === 0);
            expect(unescapedQuotes).toEqual([]);
            const unescapedWildcards = [...literalBody.matchAll(/(\\*)[%_]/g)].filter(wildcardMatch => wildcardMatch[1].length % 2 === 0);
            expect(unescapedWildcards).toEqual([]);

        });

        it.each([
            ['a line feed', 'Acme\nCorp'],
            ['a carriage return', 'Acme\rCorp'],
            ['a NUL', 'Acme\u0000'],
            ['U+0085', 'Acme\u0085'],
            ['U+2028', 'Acme '],
            ['U+2029', 'Acme ']
        ])('refuses search text carrying %s', (_label, searchText) => {

            expect(SalesforceOrgService.escapeSoqlLikeSearchText(searchText)).toBeUndefined();
            expect(SalesforceOrgService.buildParentSearchQuery('Account', 'Name', searchText)).toBeUndefined();

        });

        it('refuses an object or name field that is not an api name before building anything', () => {

            expect(SalesforceOrgService.buildParentSearchQuery('Account WHERE Id != null', 'Name', 'a')).toBeUndefined();
            expect(SalesforceOrgService.buildParentSearchQuery('Account', 'Name, (SELECT Id FROM Contacts)', 'a')).toBeUndefined();
            expect(SalesforceOrgService.buildParentSearchQuery('', 'Name', 'a')).toBeUndefined();

        });

        it('keeps only Id-shaped, distinct Ids with their names, and says when more matched than are listed', async () => {

            const overflowingRecords = Array.from({ length: ORG_PARENT_SEARCH_RESULT_LIMIT + 1 }, (_record, recordIndex) => ({
                Id: `001${String(recordIndex).padStart(15, '0')}`, Name: `Acme ${recordIndex}`
            }));
            const querySource: IOrgQuerySource = { query: jest.fn()
                .mockResolvedValueOnce({ records: [
                    { Id: '001000000000001AAA', Name: 'Acme' }, { Id: '001000000000001AAA', Name: 'Acme again' },
                    { Id: 'not an id!', Name: 'Forged' }, { Id: 7 }, { Name: 'No Id' }, null, { Id: '001000000000002AAA', Name: 42 }
                ] })
                .mockResolvedValueOnce({ records: overflowingRecords }) };

            expect(await SalesforceOrgService.searchParentRecords(querySource, 'Account', 'Name', 'Acme')).toEqual({
                matches: [{ recordId: '001000000000001AAA', recordName: 'Acme' }, { recordId: '001000000000002AAA', recordName: '' }],
                hasMoreMatches: false
            });

            const overflowingResult = await SalesforceOrgService.searchParentRecords(querySource, 'Account', 'Name', 'Acme');
            expect(overflowingResult.matches).toHaveLength(ORG_PARENT_SEARCH_RESULT_LIMIT);
            expect(overflowingResult.hasMoreMatches).toBe(true);

        });

        it('throws without querying when the search cannot be built', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn() };

            await expect(SalesforceOrgService.searchParentRecords(querySource, 'Account', 'Name', 'a\nb')).rejects.toThrow('could not be sent');
            expect(querySource.query).not.toHaveBeenCalled();

        });

    });

    describe('which orgs Data-by-Org may connect to', () => {

        it.each([
            ['a scratch org', { isScratchOrg: true }],
            ['an org the CLI recorded as a sandbox', { isSandbox: true }],
            ['an enhanced-domain sandbox url', { instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com' }],
            ['a legacy sandbox url', { instanceUrl: 'https://acme--uat.my.salesforce.com' }]
        ])('accepts %s', (_description, authorization) => {

            expect(SalesforceOrgService.isKnownNonProductionAuthorization(authorization)).toBe(true);

        });

        it.each([
            ['a production My Domain', { instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false, isScratchOrg: false }],
            ['a Developer Edition', { instanceUrl: 'https://acme-dev-ed.develop.my.salesforce.com' }],
            ['a login url', { instanceUrl: 'https://login.salesforce.com' }],
            ['a lookalike host', { instanceUrl: 'https://acme--qa.sandbox.my.salesforce.com.evil.example' }],
            ['an authorization that says nothing', {}],
            ['a url that does not parse', { instanceUrl: 'not a url' }],
            ['flags that are truthy but not true', { isSandbox: 'true' as any, isScratchOrg: 1 as any }],
            ['no authorization at all', undefined]
        ])('refuses %s', (_description, authorization) => {

            expect(SalesforceOrgService.isKnownNonProductionAuthorization(authorization)).toBe(false);

        });

        it('lists only the non-production orgs that answer their ping, and counts each reason the rest are left out', async () => {

            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgPings(username => [...CONNECTED_ORG_USERNAMES, 'prod@example.com'].includes(username));
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                ...ORG_AUTHORIZATIONS,
                { username: 'prod@example.com', aliases: ['prod'], orgId: '00D2', oauthMethod: 'web', configs: null, isExpired: false, instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false }
            ]);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            expect(dataOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(dataOrgListing.hiddenOrgCount).toBe(5);
            expect(dataOrgListing.hiddenOrgReasonCounts).toEqual({ production: 1, expired: 1, deleted: 0, notConnected: 3 });
            expect(dataOrgListing.hiddenOrgs).toContainEqual({ username: 'prod@example.com', label: 'prod', reason: 'production' });

        });

        it('leaves out every authorization when no ping answers: expired when its file says so, otherwise not connected', async () => {

            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgPings(() => false);
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);

            expect((await SalesforceOrgService.listDataOrgDetails()).hiddenOrgReasonCounts).toEqual({ production: 0, expired: 1, deleted: 0, notConnected: 5 });

        });

        it('formats each reason that left an org out, in a fixed order, leaving out the reasons with none', () => {

            expect(SalesforceOrgService.formatHiddenOrgReasons({ production: 1, expired: 1, deleted: 0, notConnected: 1 })).toBe('1 production, 1 expired, 1 not connected');

        });

    });

    describe('the alias an org is labelled by (#286)', () => {

        const SANDBOX_USERNAME = 'qa@example.com.qa';
        const SANDBOX_INSTANCE_URL = 'https://acme--qa.sandbox.my.salesforce.com';

        function buildSandboxAuthorization(aliases: unknown, username = SANDBOX_USERNAME) {
            return { username: username, aliases: aliases, orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false, isSandbox: true, instanceUrl: SANDBOX_INSTANCE_URL };
        }

        let checkSpy: jest.SpyInstance;

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgPings(username => username !== 'never-listed@example.com');
            checkSpy = jest.spyOn(SalesforceOrgService, 'checkOrgConnections');
            (StateAggregator.clearInstance as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockReset();
        });

        it('drops the cached StateAggregator before every authorization read, so an alias set since is read from disk', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([])]);

            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetails();
            await SalesforceOrgService.listAliasHolders();

            const clearOrder = (StateAggregator.clearInstance as jest.Mock).mock.invocationCallOrder;
            const readOrder = (AuthInfo.listAllAuthorizations as jest.Mock).mock.invocationCallOrder;
            expect(readOrder.length).toBeGreaterThan(0);
            expect(clearOrder).toHaveLength(readOrder.length);
            readOrder.forEach((readCall, readIndex) => {
                expect(clearOrder[readIndex]).toBeLessThan(readCall);
                expect(readIndex === 0 || clearOrder[readIndex] > readOrder[readIndex - 1]).toBe(true);
            });

        });

        it('labels an org by an alias set after VS Code started, on the next listing, with no ⟳', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([])]);

            const listedBefore = await SalesforceOrgService.listDataOrgDetails();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization(['myQa'])]);
            const listedAfter = await SalesforceOrgService.listDataOrgDetails();

            expect(listedBefore.orgDetails).toEqual([{ targetOrgIdentifier: SANDBOX_USERNAME, username: SANDBOX_USERNAME, alias: undefined }]);
            expect(listedAfter.orgDetails).toEqual([{ targetOrgIdentifier: 'myQa', username: SANDBOX_USERNAME, alias: 'myQa' }]);
            expect(checkSpy).toHaveBeenCalledTimes(1);

        });

        it('labels a hidden org by its own alias, else its username', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                buildSandboxAuthorization(['qa'], 'never-listed@example.com'),
                buildSandboxAuthorization([], 'never-listed@example.com')
            ]);

            expect((await SalesforceOrgService.listDataOrgDetails()).hiddenOrgs).toEqual([
                { username: 'never-listed@example.com', label: 'qa', reason: 'notConnected' },
                { username: 'never-listed@example.com', label: 'never-listed@example.com', reason: 'notConnected' }
            ]);

        });

        it('lists an org with no alias anywhere by its username', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([42, ''])]);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            expect(dataOrgListing.orgDetails).toEqual([{ targetOrgIdentifier: SANDBOX_USERNAME, username: SANDBOX_USERNAME, alias: undefined }]);

        });

    });

    describe('listAliasHolders (#279)', () => {

        it('maps each alias to the org holding it, from the local authorizations alone', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'uat@example.com', aliases: ['uat', 'qa'] },
                { username: 'other@example.com', aliases: ['qa'] },
                { username: 'proto@example.com', aliases: ['__proto__'] },
                { username: 'no-alias@example.com' },
                { aliases: ['orphan'] },
                { username: 'odd@example.com', aliases: [42, ''] }
            ]);

            const aliasHolders = await SalesforceOrgService.listAliasHolders();

            expect([...aliasHolders.entries()]).toEqual([
                ['uat', 'uat@example.com'],
                ['qa', 'uat@example.com'],
                ['__proto__', 'proto@example.com']
            ]);

        });

    });

    describe('the default Dev Hub (#200)', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let homeDirectoryPath: string;

        const writeConfig = (rootPath: string, configContent: string) => {
            fs.mkdirSync(path.join(rootPath, '.sf'), { recursive: true });
            fs.writeFileSync(path.join(rootPath, '.sf', 'config.json'), configContent);
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-dev-hub-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            homeDirectoryPath = path.join(temporaryRoot, 'home');
            fs.mkdirSync(workspaceRoot);
            fs.mkdirSync(homeDirectoryPath);
            (execFile as unknown as jest.Mock).mockReset();
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads the environment first, then the project config, then the global config, as the CLI does', () => {

            writeConfig(workspaceRoot, JSON.stringify({ 'target-dev-hub': 'projectHub' }));
            writeConfig(homeDirectoryPath, JSON.stringify({ 'target-dev-hub': 'globalHub' }));

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, { [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE]: 'envHub' }))
                .toEqual({ identifier: 'envHub', configSource: 'environment' });
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {}))
                .toEqual({ identifier: 'projectHub', configSource: 'project' });

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {}))
                .toEqual({ identifier: 'globalHub', configSource: 'global' });
            expect(execFile).not.toHaveBeenCalled();

        });

        it.each([
            ['no config at all', undefined],
            ['a config that is not JSON', '{ "target-dev-hub": '],
            ['a config with no target-dev-hub', '{ "target-org": "qa" }'],
            ['a non-string target-dev-hub', '{ "target-dev-hub": 7 }']
        ])('answers nothing for %s', (_label, configContent) => {

            if ( configContent !== undefined ) {
                writeConfig(workspaceRoot, configContent);
            }

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {})).toBeUndefined();

        });

        it('answers nothing for a configured value that would read as a flag, rather than falling through to the global one', () => {

            writeConfig(workspaceRoot, JSON.stringify({ 'target-dev-hub': '--json' }));
            writeConfig(homeDirectoryPath, JSON.stringify({ 'target-dev-hub': 'globalHub' }));

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {})).toBeUndefined();

        });

        it('answers nothing for an environment value that would read as a flag', () => {

            writeConfig(workspaceRoot, JSON.stringify({ 'target-dev-hub': 'projectHub' }));

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, { [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE]: '-x' })).toBeUndefined();
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, { [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE]: '  ' }))
                .toEqual({ identifier: 'projectHub', configSource: 'project' });

        });

        it('reads no setting from a config path that is a directory, or a config that is a JSON array', () => {

            fs.mkdirSync(path.join(workspaceRoot, '.sf', 'config.json'), { recursive: true });
            writeConfig(homeDirectoryPath, JSON.stringify(['target-dev-hub']));

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {})).toBeUndefined();

        });

        it('defaults to the real home directory and environment when none is handed in', () => {

            jest.spyOn(os, 'homedir').mockReturnValue(homeDirectoryPath);
            writeConfig(homeDirectoryPath, JSON.stringify({ 'target-dev-hub': 'globalHub' }));
            const savedEnvironmentValue = process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
            delete process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];

            try {
                expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot)).toEqual({ identifier: 'globalHub', configSource: 'global' });
            } finally {
                if ( savedEnvironmentValue !== undefined ) {
                    process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE] = savedEnvironmentValue;
                }
            }

        });

        it('reads the legacy sfdx names after their sf counterparts, at each level', () => {

            const writeLegacyConfig = (rootPath: string, configContent: string) => {
                fs.mkdirSync(path.join(rootPath, '.sfdx'), { recursive: true });
                fs.writeFileSync(path.join(rootPath, '.sfdx', 'sfdx-config.json'), configContent);
            };

            writeLegacyConfig(workspaceRoot, JSON.stringify({ defaultdevhubusername: 'legacyProjectHub' }));
            writeConfig(homeDirectoryPath, JSON.stringify({ 'target-dev-hub': 'globalHub' }));

            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, { SFDX_DEFAULTDEVHUBUSERNAME: 'legacyEnvHub' }))
                .toEqual({ identifier: 'legacyEnvHub', configSource: 'environment' });
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, { [TARGET_DEV_HUB_ENVIRONMENT_VARIABLE]: 'envHub', SFDX_DEFAULTDEVHUBUSERNAME: 'legacyEnvHub' }))
                .toEqual({ identifier: 'envHub', configSource: 'environment' });
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {}))
                .toEqual({ identifier: 'legacyProjectHub', configSource: 'project' });

            writeConfig(workspaceRoot, JSON.stringify({ 'target-dev-hub': 'projectHub' }));
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {}))
                .toEqual({ identifier: 'projectHub', configSource: 'project' });

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });
            fs.rmSync(path.join(workspaceRoot, '.sfdx'), { recursive: true });
            fs.rmSync(path.join(homeDirectoryPath, '.sf'), { recursive: true });
            writeLegacyConfig(homeDirectoryPath, JSON.stringify({ defaultdevhubusername: 'legacyGlobalHub' }));
            expect(SalesforceOrgService.readDefaultDevHubIdentifier(workspaceRoot, homeDirectoryPath, {}))
                .toEqual({ identifier: 'legacyGlobalHub', configSource: 'global' });

        });

    });

    describe('the default target org (#305)', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let homeDirectoryPath: string;

        const PRODUCTION_AUTHORIZATION = { username: 'prod@example.com', aliases: ['prod'], orgId: '00D2', oauthMethod: 'web', configs: null, isExpired: false, instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false };

        const writeConfigFile = (rootPath: string, folderName: string, fileName: string, configContent: string) => {
            fs.mkdirSync(path.join(rootPath, folderName), { recursive: true });
            fs.writeFileSync(path.join(rootPath, folderName, fileName), configContent);
        };

        const listWithProduction = (isProductionConnected: boolean) => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgPings(username => CONNECTED_ORG_USERNAMES.includes(username) || ( isProductionConnected && username === 'prod@example.com' ));
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([...ORG_AUTHORIZATIONS, PRODUCTION_AUTHORIZATION]);
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-target-org-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            homeDirectoryPath = path.join(temporaryRoot, 'home');
            fs.mkdirSync(workspaceRoot);
            fs.mkdirSync(homeDirectoryPath);
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads the environment, then the project\'s sf and sfdx config, then the global ones, each sf name before its legacy sfdx one', () => {

            writeConfigFile(workspaceRoot, '.sf', 'config.json', JSON.stringify({ 'target-org': 'projectOrg', 'target-dev-hub': 'projectHub' }));
            writeConfigFile(workspaceRoot, '.sfdx', 'sfdx-config.json', JSON.stringify({ defaultusername: 'legacyProjectOrg' }));
            writeConfigFile(homeDirectoryPath, '.sf', 'config.json', JSON.stringify({ 'target-org': 'globalOrg' }));
            writeConfigFile(homeDirectoryPath, '.sfdx', 'sfdx-config.json', JSON.stringify({ defaultusername: 'legacyGlobalOrg' }));

            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'envOrg', [LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE]: 'legacyEnvOrg' }))
                .toEqual({ identifier: 'envOrg', configSource: 'environment' });
            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, { [LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE]: 'legacyEnvOrg' }))
                .toEqual({ identifier: 'legacyEnvOrg', configSource: 'environment' });
            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toEqual({ identifier: 'projectOrg', configSource: 'project' });

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });
            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toEqual({ identifier: 'legacyProjectOrg', configSource: 'project' });

            fs.rmSync(path.join(workspaceRoot, '.sfdx'), { recursive: true });
            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toEqual({ identifier: 'globalOrg', configSource: 'global' });

            fs.rmSync(path.join(homeDirectoryPath, '.sf'), { recursive: true });
            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toEqual({ identifier: 'legacyGlobalOrg', configSource: 'global' });

        });

        it('never reads the default Dev Hub as the default org', () => {

            writeConfigFile(workspaceRoot, '.sf', 'config.json', JSON.stringify({ 'target-dev-hub': 'projectHub' }));

            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toBeUndefined();

        });

        it.each([
            ['a config that is not JSON', '{ not json'],
            ['a config whose target-org is not a string', JSON.stringify({ 'target-org': 42 })],
            ['a config whose target-org is empty', JSON.stringify({ 'target-org': '  ' })],
            ['a target-org the CLI could not be handed', JSON.stringify({ 'target-org': '-x' })]
        ])('answers no default for %s', (_description, configContent) => {

            writeConfigFile(workspaceRoot, '.sf', 'config.json', configContent);

            expect(SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot, homeDirectoryPath, {})).toBeUndefined();

        });

        it('lists the default org first and marks it, even a production org, and leaves it out of what was hidden', async () => {

            listWithProduction(true);
            writeConfigFile(workspaceRoot, '.sf', 'config.json', JSON.stringify({ 'target-org': 'prod' }));

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(dataOrgListing.orgDetails).toEqual([
                { targetOrgIdentifier: 'prod', username: 'prod@example.com', alias: 'prod', isDefault: true },
                CONNECTED_SANDBOX,
                ACTIVE_SCRATCH_ORG
            ]);
            expect(dataOrgListing.hiddenOrgReasonCounts).toEqual({ production: 0, expired: 1, deleted: 0, notConnected: 3 });
            expect(dataOrgListing.hiddenOrgCount).toBe(4);

        });

        it('moves a default sandbox to the top by username, without listing it twice', async () => {

            listWithProduction(true);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'test-active@example.com' });

            expect(dataOrgListing.orgDetails).toEqual([{ ...ACTIVE_SCRATCH_ORG, isDefault: true }, CONNECTED_SANDBOX]);

        });

        it('still leaves out a default org that does not answer its ping', async () => {

            listWithProduction(false);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'prod' });

            expect(dataOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(dataOrgListing.hiddenOrgs).toContainEqual({ username: 'prod@example.com', label: 'prod', reason: 'production' });

        });

        it('lists no default when it names no authorized org, or when no workspace is given', async () => {

            listWithProduction(true);

            expect((await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'nobody' })).orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);

        });

        it('reads an org locally by username or alias, marking the default, and starts no CLI process', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([...ORG_AUTHORIZATIONS, PRODUCTION_AUTHORIZATION]);
            (execFile as unknown as jest.Mock).mockReset();
            const defaultEnvironment = { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'prod' };

            expect(await SalesforceOrgService.readLocalDataOrgDetail(undefined, workspaceRoot, homeDirectoryPath, defaultEnvironment))
                .toEqual({ targetOrgIdentifier: 'prod', username: 'prod@example.com', alias: 'prod', isDefault: true });
            expect(await SalesforceOrgService.readLocalDataOrgDetail('qa@example.com.qa', workspaceRoot, homeDirectoryPath, defaultEnvironment)).toEqual(CONNECTED_SANDBOX);
            expect(await SalesforceOrgService.readLocalDataOrgDetail('qa', workspaceRoot, homeDirectoryPath, defaultEnvironment)).toEqual(CONNECTED_SANDBOX);
            expect(await SalesforceOrgService.readLocalDataOrgDetail('gone@example.com', workspaceRoot, homeDirectoryPath, defaultEnvironment)).toBeUndefined();
            expect(await SalesforceOrgService.readLocalDataOrgDetail(undefined, workspaceRoot, homeDirectoryPath, {})).toBeUndefined();
            expect(execFile).not.toHaveBeenCalled();

        });

    });

    describe('the Dev Hubs a scratch org can be created through (#243)', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let homeDirectoryPath: string;

        const HUB = { username: 'hub@example.com', aliases: ['devhub'], isDevHub: true, isExpired: false };
        const OTHER_HUB = { username: 'other-hub@example.com', aliases: [], isDevHub: true, isExpired: false };
        const SANDBOX = { username: 'qa@example.com.qa', aliases: ['qa'], isDevHub: false, isSandbox: true, isExpired: false };

        const answerConnected = (connectedStatusByUsername: Record<string, string>) => answerOrgPings(username => connectedStatusByUsername[username] === 'Connected');

        const writeProjectDefault = (devHubIdentifier: string) => {
            fs.mkdirSync(path.join(workspaceRoot, '.sf'), { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), JSON.stringify({ 'target-dev-hub': devHubIdentifier }));
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-dev-hubs-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            homeDirectoryPath = path.join(temporaryRoot, 'home');
            fs.mkdirSync(workspaceRoot);
            fs.mkdirSync(homeDirectoryPath);
            SalesforceOrgService.clearConnectedOrgStatusCache();
            (execFile as unknown as jest.Mock).mockReset();
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('lists only authorizations whose isDevHub is exactly true -- never a missing, string or false one', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                HUB,
                SANDBOX,
                { username: 'missing@example.com', aliases: [], isExpired: false },
                { username: 'string@example.com', aliases: [], isDevHub: 'true', isExpired: false },
                OTHER_HUB
            ]);
            answerConnected({ 'hub@example.com': 'Connected', 'qa@example.com.qa': 'Connected', 'missing@example.com': 'Connected', 'string@example.com': 'Connected', 'other-hub@example.com': 'Connected' });

            const devHubListing = await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(devHubListing.orgDetails).toEqual([
                { targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub' },
                { targetOrgIdentifier: 'other-hub@example.com', username: 'other-hub@example.com', alias: undefined }
            ]);
            expect(devHubListing.defaultUsername).toBeUndefined();

        });

        it('leaves out a Dev Hub that does not answer its ping, and says how many and why', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB, OTHER_HUB]);
            answerConnected({ 'hub@example.com': 'RefreshTokenAuthError' });

            const pickerListing = await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot);

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toBe('No connected Dev Hub is authorized, so no scratch org was created: 2 authorized Dev Hubs are not listed (2 not connected). Authorize one with "sf org login web --set-default-dev-hub" and try again.');

        });

        it('lists the default first, carrying where it was set, without choosing it', async () => {

            writeProjectDefault('hub@example.com');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([OTHER_HUB, HUB]);
            answerConnected({ 'hub@example.com': 'Connected', 'other-hub@example.com': 'Connected' });

            const devHubListing = await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(devHubListing.orgDetails).toEqual([
                { targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub', configSource: 'project' },
                { targetOrgIdentifier: 'other-hub@example.com', username: 'other-hub@example.com', alias: undefined }
            ]);
            expect(devHubListing.defaultUsername).toBe('hub@example.com');

        });

        it('matches the default by alias as well as by username', async () => {

            writeProjectDefault('devhub');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([OTHER_HUB, HUB]);
            answerConnected({ 'hub@example.com': 'Connected', 'other-hub@example.com': 'Connected' });

            expect(( await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {}) ).defaultUsername).toBe('hub@example.com');

        });

        it('marks nothing as the default when the default is not a connected Dev Hub', async () => {

            writeProjectDefault('qa');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB, SANDBOX]);
            answerConnected({ 'hub@example.com': 'Connected', 'qa@example.com.qa': 'Connected' });

            const devHubListing = await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(devHubListing.orgDetails).toEqual([{ targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub' }]);
            expect(devHubListing.defaultUsername).toBeUndefined();

            writeProjectDefault('hub@example.com');
            answerConnected({ 'qa@example.com.qa': 'Connected' });
            SalesforceOrgService.clearConnectedOrgStatusCache();

            const disconnectedListing = await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(disconnectedListing.orgDetails).toEqual([]);
            expect(disconnectedListing.defaultUsername).toBeUndefined();

        });

        it('skips a null authorization and one whose aliases are not a list when matching the default', async () => {

            writeProjectDefault('devhub');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                null,
                { username: 'no-aliases@example.com', aliases: null, isDevHub: true, isExpired: false },
                HUB
            ]);
            answerConnected({ 'no-aliases@example.com': 'Connected', 'hub@example.com': 'Connected' });

            const devHubListing = await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(devHubListing.orgDetails.map(orgDetail => orgDetail.username)).toEqual(['hub@example.com', 'no-aliases@example.com']);
            expect(devHubListing.defaultUsername).toBe('hub@example.com');

        });

        it('never offers a Dev Hub whose username could not be handed to --target-dev-hub, even with a usable alias', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: "o'brien@example.com", aliases: ['quotedHub'], isDevHub: true, isExpired: false },
                HUB
            ]);
            answerConnected({ "o'brien@example.com": 'Connected', 'hub@example.com': 'Connected' });

            expect(( await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {}) ).orgDetails.map(orgDetail => orgDetail.username))
                .toEqual(['hub@example.com']);

        });

        it('says "1 authorized Dev Hub is" when exactly one was left out', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB]);
            answerConnected({ 'hub@example.com': 'RefreshTokenAuthError' });

            expect(( await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot) ).emptyListMessage)
                .toContain(': 1 authorized Dev Hub is not listed (1 not connected).');

        });

        it('still lists a lone Dev Hub for the reader to pick, rather than answering it', async () => {

            writeProjectDefault('devhub');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB]);
            answerConnected({ 'hub@example.com': 'Connected' });

            const pickerListing = await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot);

            expect(pickerListing.orgDetails).toHaveLength(1);
            expect(pickerListing.defaultUsername).toBe('hub@example.com');

        });

        it('with no Dev Hub authorized at all, names "sf org login web --set-default-dev-hub"', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([SANDBOX]);
            answerConnected({ 'qa@example.com.qa': 'Connected' });

            expect(await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot)).toEqual({
                orgDetails: [],
                defaultUsername: undefined,
                emptyListMessage: NO_AUTHORIZED_DEV_HUB_MESSAGE
            });
            expect(NO_AUTHORIZED_DEV_HUB_MESSAGE).toContain('sf org login web --set-default-dev-hub');

        });

        it('given authorizations that cannot be read, lists nothing -- never every Dev Hub unchecked', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValue(new Error('auth files unreadable'));
            answerOrgPings(() => true);

            const pickerListing = await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot);

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toContain('could not be read, so no org is listed');

        });

        it('checks again once when a cached answer leaves no Dev Hub, so a Dev Hub just re-authorized is listed', async () => {

            const checkSpy = jest.spyOn(SalesforceOrgService, 'checkOrgConnections');
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB]);
            answerConnected({ 'hub@example.com': 'RefreshTokenAuthError' });
            await SalesforceOrgService.listConnectedOrgAuthorizations();

            answerConnected({ 'hub@example.com': 'Connected' });

            expect(( await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {}) ).orgDetails).toHaveLength(1);
            expect(checkSpy).toHaveBeenCalledTimes(2);

        });

    });

    /*
        #458, read from the local authorization since #499. The two fixtures follow the shape of the
        CLI's ~/.sfdx/<username>.json, with every identifier and token made up.
    */
    describe('the local authorization tells a scratch org from a sandbox (#458, #499)', () => {

        const FIXTURE_TOKEN_TEXT = 'fixture-encrypted';
        const readAuthFieldsFixture = (fileName: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', fileName), 'utf8'));

        // AN AuthInfo STAND-IN WHOSE getFields IS SPIED ON, SO A DECRYPTING READ WOULD BE SEEN
        const answerAuthInfoWith = (authorizationFields: unknown) => {
            const getFields = jest.fn(() => authorizationFields);
            (AuthInfo.create as jest.Mock).mockResolvedValue({ getFields: getFields });
            return getFields;
        };

        beforeEach(() => {
            (AuthInfo.create as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockClear();
        });

        it('reads the authorization by username in process: no CLI, and getFields is never asked to decrypt', async () => {

            const runSalesforceCliSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');
            const getFields = answerAuthInfoWith(readAuthFieldsFixture('authFieldsScratchOrg.json'));

            const scratchOrgDetail = await SalesforceOrgService.readScratchOrgDetail('test-fixture@example.com');

            expect(AuthInfo.create).toHaveBeenCalledWith({ username: 'test-fixture@example.com' });
            expect(getFields).toHaveBeenCalledTimes(1);
            expect(getFields.mock.calls[0]).toEqual([]);
            expect(runSalesforceCliSpy).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();
            expect(scratchOrgDetail).toEqual({ isScratchOrg: true, expirationDate: '2026-11-01' });

        });

        it('keeps nothing of the authorization but the two facts, so no token is kept', async () => {

            answerAuthInfoWith(readAuthFieldsFixture('authFieldsScratchOrg.json'));

            const scratchOrgDetail = await SalesforceOrgService.readScratchOrgDetail('test-fixture@example.com');

            expect(Object.keys(scratchOrgDetail ?? {})).toIncludeSameMembers(['isScratchOrg', 'expirationDate']);
            expect(JSON.stringify(scratchOrgDetail)).not.toContain(FIXTURE_TOKEN_TEXT);

        });

        it('reads a sandbox as not a scratch org', async () => {

            answerAuthInfoWith(readAuthFieldsFixture('authFieldsSandbox.json'));

            expect(await SalesforceOrgService.readScratchOrgDetail('qa@example.com.qa')).toEqual({ isScratchOrg: false });

        });

        it('answers unknown when the authorization cannot be read, or reads as something other than an object', async () => {

            (AuthInfo.create as jest.Mock).mockRejectedValue(Object.assign(new Error('No authorization information found for gone@example.com.'), { name: 'NamedOrgNotFoundError' }));
            expect(await SalesforceOrgService.readScratchOrgDetail('gone@example.com')).toBeUndefined();

            (AuthInfo.create as jest.Mock).mockResolvedValue({ getFields: () => { throw new Error('unreadable'); } });
            expect(await SalesforceOrgService.readScratchOrgDetail('gone@example.com')).toBeUndefined();

            for ( const unreadableFields of [undefined, null, 'devHubUsername', ['devHubUsername']] ) {
                answerAuthInfoWith(unreadableFields);
                expect(await SalesforceOrgService.readScratchOrgDetail('gone@example.com')).toBeUndefined();
            }

        });

        it('reads no file for a username that is not a usable target org, an access-token-shaped one ("!") included', async () => {

            expect(await SalesforceOrgService.readScratchOrgDetail('--json')).toBeUndefined();
            expect(await SalesforceOrgService.readScratchOrgDetail('00D000000000001AAA!fixture.token')).toBeUndefined();
            expect(AuthInfo.create).not.toHaveBeenCalled();

        });

        it('keeps a scratch org with no date when the expiration date is missing, mistyped or not a real day', () => {

            const scratchOrgWith = (expirationDate: unknown) => SalesforceOrgService.parseScratchOrgAuthorizationFields({ devHubUsername: 'hub@example.com', expirationDate: expirationDate });

            expect(scratchOrgWith(undefined)).toEqual({ isScratchOrg: true });
            expect(scratchOrgWith(20261101)).toEqual({ isScratchOrg: true });
            expect(scratchOrgWith('2026-02-30')).toEqual({ isScratchOrg: true });
            expect(scratchOrgWith('next week')).toEqual({ isScratchOrg: true });
            expect(scratchOrgWith('2026-11-01T00:00:00.000+0000')).toEqual({ isScratchOrg: true, expirationDate: '2026-11-01' });

        });

        it('reads an empty or mistyped devHubUsername as not a scratch org, and an isScratch of exactly true as one', () => {

            expect(SalesforceOrgService.parseScratchOrgAuthorizationFields({ devHubUsername: '  ', expirationDate: '2026-11-01' })).toEqual({ isScratchOrg: false });
            expect(SalesforceOrgService.parseScratchOrgAuthorizationFields({ devHubUsername: true })).toEqual({ isScratchOrg: false });
            expect(SalesforceOrgService.parseScratchOrgAuthorizationFields({ isScratch: 'true' })).toEqual({ isScratchOrg: false });
            expect(SalesforceOrgService.parseScratchOrgAuthorizationFields({ isScratch: true, expirationDate: '2026-11-01' })).toEqual({ isScratchOrg: true, expirationDate: '2026-11-01' });

        });

        it('caches nothing: every read is a fresh local read, so a re-created scratch org is labelled by its new authorization', async () => {

            answerAuthInfoWith(readAuthFieldsFixture('authFieldsScratchOrg.json'));
            expect(await SalesforceOrgService.readScratchOrgDetail('test-fixture@example.com')).toEqual({ isScratchOrg: true, expirationDate: '2026-11-01' });

            answerAuthInfoWith({ ...readAuthFieldsFixture('authFieldsScratchOrg.json'), expirationDate: '2026-11-30' });
            expect(await SalesforceOrgService.readScratchOrgDetail('test-fixture@example.com')).toEqual({ isScratchOrg: true, expirationDate: '2026-11-30' });

            expect(AuthInfo.create).toHaveBeenCalledTimes(2);

        });

        it('labels a scratch org with its expiration date, a sandbox as a sandbox, and leaves production and an unknown type as they were', () => {

            const sandboxRow = { isSandbox: true, organizationType: 'Developer Edition' };

            expect(SalesforceOrgService.buildOrgTypeLabel(sandboxRow, { isScratchOrg: true, expirationDate: '2026-11-01' })).toBe('Scratch org · expires 2026-11-01');
            expect(SalesforceOrgService.buildOrgTypeLabel(sandboxRow, { isScratchOrg: true })).toBe('Scratch org');
            expect(SalesforceOrgService.buildOrgTypeLabel(sandboxRow, { isScratchOrg: false })).toBe('Sandbox');
            expect(SalesforceOrgService.buildOrgTypeLabel(sandboxRow, undefined)).toBe('Sandbox');
            expect(SalesforceOrgService.buildOrgTypeLabel({ isSandbox: false, organizationType: 'Enterprise Edition' }, { isScratchOrg: true, expirationDate: '2026-11-01' })).toBe('Production · Enterprise Edition');
            expect(SalesforceOrgService.buildOrgTypeLabel(undefined, { isScratchOrg: true })).toBe(ORG_TYPE_UNKNOWN_LABEL);

        });

    });

});
