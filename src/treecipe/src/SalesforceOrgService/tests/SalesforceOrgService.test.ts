import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { showWarningMessage: jest.fn(), showQuickPick: jest.fn() }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
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
    ORG_DESCRIBE_CANCELLED_MESSAGE,
    ORG_DESCRIBE_CONCURRENCY,
    ORG_DESCRIBE_UNUSABLE_NAME_MESSAGE,
    ORG_ORGANIZATION_QUERY,
    ORG_TYPE_UNKNOWN_LABEL,
    DEVELOPER_EDITION_ORGANIZATION_TYPE,
    IOrgQuerySource,
    OrgConnectionStatusUnavailableError,
    SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS,
    NO_AUTHORIZED_DEV_HUB_MESSAGE,
    TARGET_DEV_HUB_ENVIRONMENT_VARIABLE,
    TARGET_ORG_ENVIRONMENT_VARIABLE,
    LEGACY_TARGET_ORG_ENVIRONMENT_VARIABLE,
    ORG_PARENT_SEARCH_RESULT_LIMIT
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
            const runSalesforceCliSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');
            answerOrgList();

            await SalesforceOrgService.listConnectedOrgAuthorizations();

            expect(execFile).toHaveBeenCalledTimes(1);
            const [command, args, options] = (execFile as unknown as jest.Mock).mock.calls[0];
            expect(command).toBe('sf');
            expect(args).toEqual(['org', 'list', '--json', '--verbose']);
            expect(options).toMatchObject({ shell: false });
            // THE TIMEOUT IS runSalesforceCli'S OWN TIMER, SO IT CAN END THE WHOLE PROCESS TREE ON WINDOWS
            expect(runSalesforceCliSpy.mock.calls[0][2]).toBe(SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS);
            expect(args).not.toContain('--skip-connection-status');

        });

        it('runs sf.cmd on Windows, with the same arguments quoted for its shim', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            const runSalesforceCliSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');
            answerOrgList();

            await SalesforceOrgService.listConnectedOrgAuthorizations();

            const [command, args] = (execFile as unknown as jest.Mock).mock.calls[0];
            expect(command).toBe('sf.cmd');
            expect(args).toEqual(['"org"', '"list"', '"--json"', '"--verbose"']);
            expect(runSalesforceCliSpy.mock.calls[0][2]).toBe(SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS);

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

        it('reports a run the timeout ended as a timeout, though a killed Windows process exits with code 1', () => {

            expect(() => SalesforceOrgService.parseOrgListInvocation({ stdout: '', stderr: '', exitCode: 1, timedOut: true }))
                .toThrow(`"sf org list" did not answer within ${SALESFORCE_CLI_ORG_LIST_TIMEOUT_MILLISECONDS / 1000} seconds.`);

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

    describe('queryPermissionSetNames (#302)', () => {

        it('asks for the named permission sets in one query and keeps only the api names the org answers with', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn().mockResolvedValue({ records: [
                { Name: 'Account_Tree_Access' }, { Name: 'bad name' }, { Name: 7 }, null, { Id: '0PS000000000001' }
            ] }) };

            expect(await SalesforceOrgService.queryPermissionSetNames(querySource, ['Account_Tree_Access', 'Contact_Reader'])).toEqual(['Account_Tree_Access']);
            expect(querySource.query).toHaveBeenCalledWith('SELECT Name FROM PermissionSet WHERE Name IN (\'Account_Tree_Access\', \'Contact_Reader\')');

        });

        it('sends no query for no names, and refuses a name that could close the quote before any query', async () => {

            const querySource: IOrgQuerySource = { query: jest.fn() };

            expect(await SalesforceOrgService.queryPermissionSetNames(querySource, [])).toEqual([]);
            await expect(SalesforceOrgService.queryPermissionSetNames(querySource, ['Ok', "x') OR Name != ('"])).rejects.toThrow('is not a Salesforce api name');
            expect(querySource.query).not.toHaveBeenCalled();

        });

        it('throws, rather than answering "none", for a failed query or an answer with no records list', async () => {

            await expect(SalesforceOrgService.queryPermissionSetNames({ query: jest.fn().mockRejectedValue(new Error('INVALID_SESSION_ID')) }, ['A'])).rejects.toThrow('INVALID_SESSION_ID');
            await expect(SalesforceOrgService.queryPermissionSetNames({ query: jest.fn().mockResolvedValue({ records: 'x' }) }, ['A'])).rejects.toThrow('could not be read');
            await expect(SalesforceOrgService.queryPermissionSetNames({ query: jest.fn().mockResolvedValue(undefined) }, ['A'])).rejects.toThrow('could not be read');

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

    describe('the alias an org is labelled by (#286)', () => {

        const SANDBOX_USERNAME = 'qa@example.com.qa';
        const SANDBOX_INSTANCE_URL = 'https://acme--qa.sandbox.my.salesforce.com';

        function buildSandboxAuthorization(aliases: unknown, username = SANDBOX_USERNAME) {
            return { username: username, aliases: aliases, orgId: '00D1', oauthMethod: 'web', configs: null, isExpired: false, isSandbox: true, instanceUrl: SANDBOX_INSTANCE_URL };
        }

        function answerSandboxOrgList(orgListEntry: Record<string, unknown>) {
            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [{ username: SANDBOX_USERNAME, connectedStatus: 'Connected', ...orgListEntry }] }) });
        }

        beforeEach(() => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            (execFile as unknown as jest.Mock).mockClear();
            (StateAggregator.clearInstance as jest.Mock).mockClear();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockReset();
        });

        it('drops the cached StateAggregator before every authorization read, so an alias set since is read from disk', async () => {

            answerSandboxOrgList({});
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

            answerSandboxOrgList({});
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([])]);

            const listedBefore = await SalesforceOrgService.listDataOrgDetails();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization(['myQa'])]);
            const listedAfter = await SalesforceOrgService.listDataOrgDetails();

            expect(listedBefore.orgDetails).toEqual([{ targetOrgIdentifier: SANDBOX_USERNAME, username: SANDBOX_USERNAME, alias: undefined }]);
            expect(listedAfter.orgDetails).toEqual([{ targetOrgIdentifier: 'myQa', username: SANDBOX_USERNAME, alias: 'myQa' }]);
            expect(execFile).toHaveBeenCalledTimes(1);

        });

        it('labels an org the authorizations name no alias for by the alias "sf org list" answers, and only as a label', async () => {

            answerSandboxOrgList({ alias: 'qa' });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([])]);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            expect(dataOrgListing.orgDetails).toEqual([{ targetOrgIdentifier: SANDBOX_USERNAME, username: SANDBOX_USERNAME, alias: 'qa' }]);

        });

        it('picks up an alias "sf org list" answers on ⟳', async () => {

            answerSandboxOrgList({});
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization(undefined)]);
            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails[0].alias).toBeUndefined();

            answerSandboxOrgList({ alias: 'qa' });
            await SalesforceOrgService.refreshConnectedOrgAuthorizations();

            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails[0].alias).toBe('qa');

        });

        it('prefers the alias the authorizations read fresh over the CLI answer, which may be cached', async () => {

            answerSandboxOrgList({ alias: 'oldAlias' });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization(['newAlias'])]);

            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails[0].alias).toBe('newAlias');

        });

        it('does not put an alias back on an org once the fresh authorizations show it moved to another', async () => {

            answerOrgList({ stdout: buildOrgListStdout({ nonScratchOrgs: [
                { username: SANDBOX_USERNAME, connectedStatus: 'Connected', alias: 'qa' },
                { username: 'qa2@example.com.qa2', connectedStatus: 'Connected' }
            ] }) });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                buildSandboxAuthorization([]),
                null,
                buildSandboxAuthorization(['qa'], 'qa2@example.com.qa2')
            ]);

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            expect(dataOrgListing.orgDetails.map(orgDetail => [orgDetail.username, orgDetail.alias])).toEqual([
                [SANDBOX_USERNAME, undefined],
                ['qa2@example.com.qa2', 'qa']
            ]);

        });

        it('does not label an org by a cached CLI alias once the alias it held when the CLI ran is removed', async () => {

            answerSandboxOrgList({ alias: 'qa' });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization(['qa'])]);
            expect((await SalesforceOrgService.listDataOrgDetails()).orgDetails[0].alias).toBe('qa');

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([buildSandboxAuthorization([])]);
            const listedAfterUnset = await SalesforceOrgService.listDataOrgDetails();

            expect(listedAfterUnset.orgDetails).toEqual([{ targetOrgIdentifier: SANDBOX_USERNAME, username: SANDBOX_USERNAME, alias: undefined }]);
            expect(execFile).toHaveBeenCalledTimes(1);

        });

        it('labels a hidden org by the same rule', async () => {

            answerSandboxOrgList({ connectedStatus: 'RefreshTokenAuthError', alias: 'qa' });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([
                buildSandboxAuthorization([]),
                buildSandboxAuthorization([], 'never-listed@example.com')
            ]);

            expect((await SalesforceOrgService.listDataOrgDetails()).hiddenOrgs).toEqual([
                { username: SANDBOX_USERNAME, label: 'qa', reason: 'notConnected' },
                { username: 'never-listed@example.com', label: 'never-listed@example.com', reason: 'notConnected' }
            ]);

        });

        it('labels the Dev Hub picker by the same rule', async () => {

            answerSandboxOrgList({ alias: 'hub' });
            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([{ ...buildSandboxAuthorization([]), isDevHub: true }]);

            const devHubListing = await SalesforceOrgService.listDevHubOrgDetails(os.tmpdir(), os.tmpdir(), {});

            expect(devHubListing.orgDetails.map(orgDetail => [orgDetail.username, orgDetail.alias])).toEqual([[SANDBOX_USERNAME, 'hub']]);

        });

        it.each([
            ['an alias string', { alias: 'qa' }, 'qa'],
            ['the first string of aliases', { aliases: [7, '', 'qa', 'other'] }, 'qa'],
            ['alias over aliases', { alias: 'qa', aliases: ['other'] }, 'qa'],
            ['aliases when alias is empty', { alias: '', aliases: ['qa'] }, 'qa'],
            ['no alias', {}, undefined],
            ['an alias that is not a string', { alias: 7 }, undefined],
            ['aliases that is not a list', { aliases: 'qa' }, undefined],
            ['an alias that could not be an org identifier', { alias: '-o' }, undefined],
            ['an alias carrying a line break', { alias: 'qa\nother' }, undefined],
            ['an alias carrying markdown', { alias: '[x](command:y)' }, undefined]
        ])('reads %s from an "sf org list" entry as untrusted', (_description, orgListEntry, expectedAlias) => {

            expect(SalesforceOrgService.readOrgListEntryAlias(orgListEntry)).toBe(expectedAlias);

        });

        it('keeps the first alias the answer names for a username, across groups', () => {

            const orgStatusListing = SalesforceOrgService.normalizeOrgListResult({
                nonScratchOrgs: [{ username: 'x@example.com', connectedStatus: 'Connected', alias: 'first' }],
                sandboxes: [{ username: 'x@example.com', connectedStatus: 'Connected', alias: 'second' }]
            });

            expect([...(orgStatusListing.aliasesByUsername ?? new Map()).entries()]).toEqual([['x@example.com', 'first']]);

        });

        it('lists an org with no alias anywhere by its username', async () => {

            answerSandboxOrgList({});
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

        const listWithProduction = (connectedStatus: string) => {
            SalesforceOrgService.clearConnectedOrgStatusCache();
            const orgListResult = JSON.parse(SF_ORG_LIST_STDOUT).result;
            answerOrgList({ stdout: buildOrgListStdout({
                ...orgListResult,
                nonScratchOrgs: [...orgListResult.nonScratchOrgs, { username: 'prod@example.com', connectedStatus: connectedStatus, instanceUrl: 'https://acme.my.salesforce.com' }]
            }) });
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

            listWithProduction('Connected');
            writeConfigFile(workspaceRoot, '.sf', 'config.json', JSON.stringify({ 'target-org': 'prod' }));

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, {});

            expect(dataOrgListing.orgDetails).toEqual([
                { targetOrgIdentifier: 'prod', username: 'prod@example.com', alias: 'prod', isDefault: true },
                CONNECTED_SANDBOX,
                ACTIVE_SCRATCH_ORG
            ]);
            expect(dataOrgListing.hiddenOrgReasonCounts).toEqual({ production: 0, expired: 1, deleted: 1, notConnected: 2 });
            expect(dataOrgListing.hiddenOrgCount).toBe(4);

        });

        it('moves a default sandbox to the top by username, without listing it twice', async () => {

            listWithProduction('Connected');

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'test-active@example.com' });

            expect(dataOrgListing.orgDetails).toEqual([{ ...ACTIVE_SCRATCH_ORG, isDefault: true }, CONNECTED_SANDBOX]);

        });

        it('still leaves out a default org the CLI does not report connected', async () => {

            listWithProduction('RefreshTokenAuthError');

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails(workspaceRoot, homeDirectoryPath, { [TARGET_ORG_ENVIRONMENT_VARIABLE]: 'prod' });

            expect(dataOrgListing.orgDetails).toEqual([CONNECTED_SANDBOX, ACTIVE_SCRATCH_ORG]);
            expect(dataOrgListing.hiddenOrgs).toContainEqual({ username: 'prod@example.com', label: 'prod', reason: 'production' });

        });

        it('lists no default when it names no authorized org, or when no workspace is given', async () => {

            listWithProduction('Connected');

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

        const answerConnected = (connectedStatusByUsername: Record<string, string>) => answerOrgList({ stdout: buildOrgListStdout({
            nonScratchOrgs: Object.entries(connectedStatusByUsername).map(([username, connectedStatus]) => ({ username, connectedStatus }))
        }) });

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

        it('leaves out a Dev Hub the CLI does not report connected, and says how many and why', async () => {

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

        it('given a CLI that cannot answer, lists nothing -- never every Dev Hub unchecked', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB]);
            answerOrgList({ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });

            const pickerListing = await SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot);

            expect(pickerListing.orgDetails).toEqual([]);
            expect(pickerListing.emptyListMessage).toContain('could not report which authorized orgs are connected, so no org is listed');

        });

        it('asks the CLI again once when a cached answer leaves no Dev Hub, so a Dev Hub just re-authorized is listed', async () => {

            (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([HUB]);
            answerConnected({ 'hub@example.com': 'RefreshTokenAuthError' });
            await SalesforceOrgService.listConnectedOrgAuthorizations();

            answerConnected({ 'hub@example.com': 'Connected' });

            expect(( await SalesforceOrgService.listDevHubOrgDetails(workspaceRoot, homeDirectoryPath, {}) ).orgDetails).toHaveLength(1);
            expect(execFile).toHaveBeenCalledTimes(2);

        });

    });

});

