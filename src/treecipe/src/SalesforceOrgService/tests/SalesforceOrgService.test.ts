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

jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { AuthInfo, Org } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    SalesforceOrgService,
    IOrgDescribeSource,
    NO_AUTHORIZED_ORGS_MESSAGE,
    ORG_DESCRIBE_CANCELLED_MESSAGE,
    ORG_DESCRIBE_CONCURRENCY,
    ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE,
    ORG_ORGANIZATION_QUERY,
    ORG_TYPE_UNKNOWN_LABEL,
    IOrgQuerySource,
    OrgConnectionStatusUnavailableError,
    SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS
} from '../SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';

const ACCOUNT_DESCRIBE = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'describeAccount.json'), 'utf-8'));

const ORG_USERNAME = 'jd@example.com';

const SF_ORG_LIST_STDOUT = fs.readFileSync(path.join(__dirname, 'mocks', 'sfOrgListVerbose.json'), 'utf-8');
const ORG_AUTHORIZATIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', 'orgAuthorizations.json'), 'utf-8'));

const CONNECTED_SANDBOX = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const ACTIVE_SCRATCH_ORG = { targetOrgIdentifier: 'activeScratch', username: 'test-active@example.com', alias: 'activeScratch' };

/*
    What execFile hands its callback for one "sf org list" run. Answered on a later turn, as a real
    child process does, so two listings can be asked while one is in flight.
*/
function answerOrgList(orgListAnswer: { error?: unknown; stdout?: string; stderr?: string } = { stdout: SF_ORG_LIST_STDOUT }) {

    (execFile as unknown as jest.Mock).mockImplementation((_command: string, _args: string[], _options: unknown, callback: any) => {
        setImmediate(() => callback(orgListAnswer.error ?? null, orgListAnswer.stdout ?? '', orgListAnswer.stderr ?? ''));
        return { kill: jest.fn() };
    });

}

function buildOrgListStdout(orgListResult: Record<string, unknown>): string {

    return JSON.stringify({ status: 0, result: orgListResult, warnings: [] });

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

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
        });

        it('given no authorized org, says so rather than showing an empty picker', async () => {

            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [], scratchOrgs: [] }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([]);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValue(undefined);

            expect(await SalesforceOrgService.promptForAuthorizedOrg('pick one')).toBeUndefined();

            expect(await promptSpy.mock.calls[0][0]).toEqual({ orgDetails: [], emptyListMessage: NO_AUTHORIZED_ORGS_MESSAGE });

        });

        it('offers only the orgs the CLI reports as connected, production included, and returns the one chosen', async () => {

            answerOrgList({ stdout: buildOrgListStdout({
                nonScratchOrgs: [
                    { username: 'jd@example.com', connectedStatus: 'Connected' },
                    { username: 'old@example.com', connectedStatus: 'RefreshTokenAuthError' }
                ],
                scratchOrgs: [{ username: 'scratch@example.com', status: 'Active', isExpired: false }]
            }) });
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

            answerOrgList();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS.filter((authorization: any) => ![CONNECTED_SANDBOX.username, ACTIVE_SCRATCH_ORG.username].includes(authorization.username)));

            expect(await SalesforceOrgService.listAuthorizedOrgDetailsForPicker()).toEqual({
                orgDetails: [],
                emptyListMessage: 'No connected Salesforce org is authorized: 4 authorized orgs are not listed (1 expired, 1 deleted, 2 not connected). Re-authorize one with "sf org login web" and try again.'
            });

        });

        it('given a CLI that cannot answer, lists nothing and says why -- never every authorization unchecked', async () => {

            answerOrgList({ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);

            const pickerListing = await SalesforceOrgService.listAuthorizedOrgDetailsForPicker();

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toContain('could not report which authorized orgs are connected, so no org is listed');
            // THE CLI'S OWN TEXT IS ESCAPED: A NOTIFICATION RENDERS [label](command:...) AS A LINK THAT RUNS IT
            expect(pickerListing.emptyListMessage).toContain('The Salesforce CLI \\u0028"sf"\\u0029 is not installed or not on PATH');
            expect(pickerListing.emptyListMessage).not.toMatch(/[[\]()]/);

        });

    });

    describe('listConnectedOrgAuthorizations', () => {

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            (execFile as unknown as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);
        });

        it('runs "sf org list --json --verbose" through execFile with no shell and a timeout, never skipping the connection check', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            answerOrgList();

            await SalesforceOrgService.listConnectedOrgAuthorizations();

            expect(execFile).toHaveBeenCalledTimes(1);
            const [command, args, options] = (execFile as unknown as jest.Mock).mock.calls[0];
            expect(command).toBe('sf');
            expect(args).toEqual(['org', 'list', '--json', '--verbose']);
            expect(options).toMatchObject({ shell: false, timeout: SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS });
            expect(args).not.toContain('--skip-connection-status');

        });

        it('runs sf.cmd on Windows, with the same arguments quoted for its shim', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            answerOrgList();

            await SalesforceOrgService.listConnectedOrgAuthorizations();

            const [command, args, options] = (execFile as unknown as jest.Mock).mock.calls[0];
            expect(command).toBe('sf.cmd');
            expect(args).toEqual(['"org"', '"list"', '"--json"', '"--verbose"']);
            expect(options).toMatchObject({ timeout: SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS });

        });

        it('lists only the Connected org and the active scratch org: not RefreshTokenAuthError, Unknown, expired or deleted', async () => {

            answerOrgList();

            const authorizedOrgListing = await SalesforceOrgService.listAuthorizedOrgDetails();

            expect(authorizedOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(authorizedOrgListing.hiddenOrgs).toEqual([
                { username: 'uat@example.com.uat', label: 'uat', reason: 'notConnected' },
                { username: 'stale@example.com.dev', label: 'stale', reason: 'notConnected' },
                { username: 'test-expired@example.com', label: 'expiredScratch', reason: 'expired' },
                { username: 'test-deleted@example.com', label: 'deletedScratch', reason: 'deleted' }
            ]);
            expect(authorizedOrgListing.hiddenOrgReasonCounts).toEqual({ production: 0, expired: 1, deleted: 1, notConnected: 2 });

        });

        it('counts "Unknown" as not connected', () => {

            expect(SalesforceOrgService.classifyOrgListEntry({ username: 'x', connectedStatus: 'Unknown' }, false)).toBe('notConnected');

        });

        it.each([
            ['Connected', { connectedStatus: 'Connected' }, false, 'connected'],
            ['an auth error code', { connectedStatus: 'RefreshTokenAuthError' }, false, 'notConnected'],
            ['no connectedStatus', {}, false, 'notConnected'],
            ['a connectedStatus that is not a string', { connectedStatus: true }, false, 'notConnected'],
            ['"connected" in another case', { connectedStatus: 'connected' }, false, 'notConnected'],
            ['an active scratch org', { status: 'Active', isExpired: false }, true, 'connected'],
            ['an expired scratch org', { status: 'Active', isExpired: true }, true, 'expired'],
            ['a scratch org with status Expired', { status: 'Expired' }, true, 'expired'],
            ['a deleted scratch org', { status: 'Deleted', isExpired: true }, true, 'deleted'],
            ['a scratch org with no status', { isExpired: false }, true, 'notConnected'],
            ['a scratch org whose isExpired is not a boolean', { status: 'Active', isExpired: 'false' }, true, 'notConnected'],
            ['a scratch org whose status is not a string', { status: 1 }, true, 'notConnected'],
            ['a scratch org carrying a connectedStatus other than Connected', { status: 'Active', connectedStatus: 'Unknown' }, true, 'notConnected']
        ])('reads %s', (_description, orgListEntry, isScratchOrg, expectedState) => {

            expect(SalesforceOrgService.classifyOrgListEntry({ username: 'x', ...orgListEntry }, isScratchOrg)).toBe(expectedState);

        });

        it('leaves out a username the CLI names with no authorization file, and an unusable identifier', async () => {

            answerOrgList({ stdout: buildOrgListStdout({
                nonScratchOrgs: [
                    { username: 'ghost@example.com', connectedStatus: 'Connected' },
                    { username: 'bad@example.com', connectedStatus: 'Connected' }
                ]
            }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                { username: 'bad@example.com', aliases: ['-o'], orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false }
            ]);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([]);

        });

        it('lets one entry saying an org is not usable outvote another saying it is Connected', () => {

            const orgStatusListing = SalesforceOrgService.normalizeOrgListResult({
                nonScratchOrgs: [{ username: 'x@example.com', connectedStatus: 'Connected' }],
                sandboxes: [{ username: 'x@example.com', connectedStatus: 'Unknown' }]
            });

            expect(orgStatusListing.connectionStatesByUsername.get('x@example.com')).toBe('notConnected');

        });

        it('skips an entry with no username, and a group that is not a list', () => {

            const orgStatusListing = SalesforceOrgService.normalizeOrgListResult({
                nonScratchOrgs: [{ connectedStatus: 'Connected' }, null, 'x', { username: 7, connectedStatus: 'Connected' }],
                scratchOrgs: 'not a list'
            });

            expect(orgStatusListing.connectionStatesByUsername.size).toBe(0);

        });

        it('asks the CLI once a session: three listings run "sf org list" once', async () => {

            answerOrgList();

            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetailsForPicker();

            expect(execFile).toHaveBeenCalledTimes(1);
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(true);

        });

        it('shares one process between two listings asked while a check is in flight', async () => {

            answerOrgList();

            const [firstListing, secondListing] = await Promise.all([
                SalesforceOrgService.listConnectedOrgAuthorizations(),
                SalesforceOrgService.listConnectedOrgAuthorizations()
            ]);

            expect(execFile).toHaveBeenCalledTimes(1);
            expect(secondListing).toBe(firstListing);

        });

        it('runs the CLI again on a refresh, and replaces the cached answer', async () => {

            answerOrgList();
            const firstListing = await SalesforceOrgService.listConnectedOrgAuthorizations();

            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [{ username: 'uat@example.com.uat', connectedStatus: 'Connected' }] }) });
            const refreshedListing = await SalesforceOrgService.refreshConnectedOrgAuthorizations();

            expect(execFile).toHaveBeenCalledTimes(2);
            expect(refreshedListing).not.toBe(firstListing);
            expect(await SalesforceOrgService.listConnectedOrgAuthorizations()).toBe(refreshedListing);
            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails.map(orgDetail => orgDetail.username)).toEqual(['uat@example.com.uat']);

        });

        it('never lets a check started before a clear write over the answer asked for after it', async () => {

            answerOrgList();
            const staleCheck = SalesforceOrgService.listConnectedOrgAuthorizations();
            SalesforceOrgService.clearConnectedOrgStatusCache();
            await staleCheck;

            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

        });

        it.each([
            ['the CLI is missing (ENOENT)', { error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }, 'The Salesforce CLI ("sf") is not installed or not on PATH'],
            ['a timeout', { error: Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', code: null }), stdout: '{"status":' }, `did not answer within ${SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS / 1000} seconds`],
            ['a non-zero exit', { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: JSON.stringify({ status: 1, name: 'Error', message: 'No auth files' }) }, '"sf org list" failed (exit code 1): No auth files'],
            ['a non-zero exit with no JSON', { error: Object.assign(new Error('exit 2'), { code: 2 }), stdout: '', stderr: 'boom' }, 'did not return usable JSON (exit code 2)'],
            ['malformed JSON', { stdout: '{"status": 0, "result": ' }, 'did not return usable JSON (exit code 0)'],
            ['JSON with no org list', { stdout: JSON.stringify({ status: 0, result: [] }) }, 'returned no org list']
        ])('given %s, lists no org, caches nothing, and asks again next time', async (_description, orgListAnswer, expectedMessage) => {

            answerOrgList(orgListAnswer);

            const failedListing = SalesforceOrgService.listDataOrgDetails();
            await expect(failedListing).rejects.toThrow(OrgConnectionStatusUnavailableError);
            await expect(failedListing).rejects.toThrow(expectedMessage);
            expect(SalesforceOrgService.isConnectedOrgStatusCached()).toBe(false);

            answerOrgList();
            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(execFile).toHaveBeenCalledTimes(2);

        });

        it.each([
            ['the CLI\'s own message', { message: 'No auth files' }, 'stderr text', '"sf org list" failed (exit code 1): No auth files'],
            ['stderr when the payload names nothing', { status: 1 }, '  stderr text  ', '"sf org list" failed (exit code 1): stderr text'],
            ['no detail when there is none', { status: 1 }, '', '"sf org list" failed (exit code 1).']
        ])('reports a non-zero exit with %s', (_description, payload, stderr, expectedMessage) => {

            expect(() => SalesforceOrgService.parseOrgListInvocation({ stdout: JSON.stringify(payload), stderr: stderr, exitCode: 1 }))
                .toThrow(expectedMessage);

        });

        it('leaves out a non-scratch org whose status is anything but Active, even when Connected', () => {

            expect(SalesforceOrgService.classifyOrgListEntry({ username: 'x', connectedStatus: 'Connected', status: 'Inactive' }, false)).toBe('notConnected');

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

        it('says the authorized orgs could not be listed when the authorization files cannot be read', async () => {

            answerOrgList();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValue(new Error('auth files unreadable'));

            expect(await SalesforceOrgService.listAuthorizedOrgDetailsForPicker()).toEqual({
                orgDetails: [],
                emptyListMessage: 'The authorized Salesforce orgs could not be listed: auth files unreadable'
            });

        });

        it('asks again when an authorization was added after the cached check, and only then', async () => {

            answerOrgList();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);
            await SalesforceOrgService.listAuthorizedOrgDetails();
            await SalesforceOrgService.listDataOrgDetails();
            expect(execFile).toHaveBeenCalledTimes(1);

            const newlyAuthorizedOrg = { username: 'new@example.com.qa', aliases: ['newqa'], orgId: '00D7', oauthMethod: 'web', configs: null, isExpired: false, isSandbox: true };
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([...ORG_AUTHORIZATIONS, newlyAuthorizedOrg]);
            answerOrgList({ stdout: buildOrgListStdout({
                ...JSON.parse(SF_ORG_LIST_STDOUT).result,
                nonScratchOrgs: [...JSON.parse(SF_ORG_LIST_STDOUT).result.nonScratchOrgs, { username: 'new@example.com.qa', connectedStatus: 'Connected' }]
            }) });

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails.map(orgDetail => orgDetail.username)).toContain('new@example.com.qa');
            await SalesforceOrgService.listDataOrgDetails();

            expect(execFile).toHaveBeenCalledTimes(2);

        });

        it('asks again once when a cached answer leaves a quick pick nothing to offer, as after "sf org login web"', async () => {

            const disconnectedOrgList = buildOrgListStdout({ nonScratchOrgs: [{ username: 'qa@example.com.qa', connectedStatus: 'RefreshTokenAuthError' }] });
            answerOrgList({ stdout: disconnectedOrgList });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([ORG_AUTHORIZATIONS[0]]);

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([]);
            expect(execFile).toHaveBeenCalledTimes(1);

            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [{ username: 'qa@example.com.qa', connectedStatus: 'Connected' }] }) });

            expect((await SalesforceOrgService.listAuthorizedOrgDetails()).orgDetails).toEqual([CONNECTED_SANDBOX]);
            expect(execFile).toHaveBeenCalledTimes(2);

        });

        it('does not ask again for an authorization the cached check already answered, an expired scratch org the CLI leaves out included', async () => {

            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [{ username: 'qa@example.com.qa', connectedStatus: 'Connected' }] }) });

            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listDataOrgDetails();
            await SalesforceOrgService.listAuthorizedOrgDetails();

            expect(execFile).toHaveBeenCalledTimes(1);

        });

        it('shares a check already in flight with a refresh, rather than starting a second process', async () => {

            answerOrgList();

            const [listing, refreshedListing] = await Promise.all([
                SalesforceOrgService.listConnectedOrgAuthorizations(),
                SalesforceOrgService.refreshConnectedOrgAuthorizations()
            ]);

            expect(execFile).toHaveBeenCalledTimes(1);
            expect(refreshedListing).toBe(listing);

        });

        it('never logs out of, deletes or changes an org', async () => {

            answerOrgList();
            await SalesforceOrgService.refreshConnectedOrgAuthorizations();
            await SalesforceOrgService.listDataOrgDetails();

            const sentArguments = (execFile as unknown as jest.Mock).mock.calls.map(([, args]) => (args as string[]).join(' '));
            expect(sentArguments.every(sentArgument => sentArgument === 'org list --json --verbose')).toBe(true);
            expect(sentArguments.join('\n')).not.toMatch(/logout|delete/);

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

        it('lists only the non-production orgs the CLI reports connected, and counts each reason the rest are left out', async () => {

            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgList({ stdout: buildOrgListStdout({
                ...JSON.parse(SF_ORG_LIST_STDOUT).result,
                nonScratchOrgs: [
                    ...JSON.parse(SF_ORG_LIST_STDOUT).result.nonScratchOrgs,
                    { username: 'prod@example.com', connectedStatus: 'Connected', instanceUrl: 'https://acme.my.salesforce.com' }
                ]
            }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                ...ORG_AUTHORIZATIONS,
                { username: 'prod@example.com', aliases: ['prod'], orgId: '00D2', oauthMethod: 'web', configs: null, isExpired: false, instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false }
            ]);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            expect(dataOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(dataOrgListing.hiddenOrgCount).toBe(5);
            expect(dataOrgListing.hiddenOrgReasonCounts).toEqual({ production: 1, expired: 1, deleted: 1, notConnected: 2 });
            expect(dataOrgListing.hiddenOrgs).toContainEqual({ username: 'prod@example.com', label: 'prod', reason: 'production' });

        });

        it('leaves out an authorization the CLI does not mention: expired when its file says so, otherwise not connected', async () => {

            SalesforceOrgService.clearConnectedOrgStatusCache();
            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [], scratchOrgs: [] }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);

            expect((await SalesforceOrgService.listDataOrgDetails()).hiddenOrgReasonCounts).toEqual({ production: 0, expired: 2, deleted: 0, notConnected: 4 });

        });

        it('formats each reason that left an org out, in a fixed order, leaving out the reasons with none', () => {

            expect(SalesforceOrgService.formatHiddenOrgReasons({ production: 1, expired: 1, deleted: 0, notConnected: 1 })).toBe('1 production, 1 expired, 1 not connected');

        });

    });

});

