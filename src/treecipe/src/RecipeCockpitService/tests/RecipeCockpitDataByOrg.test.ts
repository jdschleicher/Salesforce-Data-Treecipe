import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_DATA_ORG_STATE_KEY,
    RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import {
    IDataOrgListing,
    IHiddenAuthorizedOrg,
    NO_AUTHORIZED_ORGS_MESSAGE,
    ORG_TYPE_UNKNOWN_LABEL,
    OrgConnectionStatusUnavailableError,
    SalesforceOrgService
} from '../../SalesforceOrgService/SalesforceOrgService';
import { IAuthenticatedOrgDetail } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const TREE_OBJECT_API_NAMES = ['Account', 'Contact', 'OtherChildObject__c', 'Lead'];

const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const SECOND_ORG = { targetOrgIdentifier: 'prod@example.com', username: 'prod@example.com', alias: undefined as string | undefined };

function buildDataOrgListing(orgDetails: IAuthenticatedOrgDetail[], hiddenOrgs: IHiddenAuthorizedOrg[] = []): IDataOrgListing {

    const hiddenOrgReasonCounts = SalesforceOrgService.countHiddenOrgReasons(hiddenOrgs);

    return { orgDetails, hiddenOrgs, hiddenOrgReasonCounts, hiddenOrgCount: SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts) };

}

function loadTreeRecipe(): IRecipeCockpitRecipeViewModel {

    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;

}

// A CONNECTION STAND-IN: COUNT() BY OBJECT FROM A TABLE, AND THE ORGANIZATION ROW (OR A THROW) FOR THE TYPE QUERY
function buildFakeConnection(recordCountsByObject: Record<string, number>, organizationRow: unknown = { IsSandbox: true, OrganizationType: 'Unlimited Edition' }) {

    const sentQueries: string[] = [];

    return {
        sentQueries,
        query: jest.fn().mockImplementation(async (soql: string) => {
            sentQueries.push(soql);
            if ( soql.includes('FROM Organization') ) {
                if ( organizationRow instanceof Error ) {
                    throw organizationRow;
                }
                return { totalSize: 1, records: [organizationRow] };
            }
            const objectApiName = soql.replace('SELECT COUNT() FROM ', '');
            if ( !Object.prototype.hasOwnProperty.call(recordCountsByObject, objectApiName) ) {
                throw Object.assign(new Error(`sObject type '${objectApiName}' is not supported.`), { errorCode: 'INVALID_TYPE' });
            }
            return { totalSize: recordCountsByObject[objectApiName], records: [] };
        })
    };

}

describe('RecipeCockpitService, Data-by-Org', () => {

    beforeEach(() => {
        SalesforceOrgService.clearRecordCountCache();
    });

    describe('collectDataOrgObjectApiNames', () => {

        it('lists every object a tree card lists, once, in Recipe Trees order', () => {

            expect(RecipeCockpitService.collectDataOrgObjectApiNames(loadTreeRecipe())).toEqual(TREE_OBJECT_API_NAMES);

        });

        it('leaves out a later occurrence of an object, which is the same object in the org', () => {

            const recipe = loadTreeRecipe();
            recipe.trees[0].objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });

            expect(RecipeCockpitService.collectDataOrgObjectApiNames(recipe)).toEqual(TREE_OBJECT_API_NAMES);

        });

    });

    describe('buildDataOrgLabel', () => {

        it('labels an org by alias, or by username when it has none', () => {

            expect(RecipeCockpitService.buildDataOrgLabel(SANDBOX_ORG)).toBe('qa');
            expect(RecipeCockpitService.buildDataOrgLabel(SECOND_ORG)).toBe('prod@example.com');

        });

    });

    describe('routePanelMessage, index-only routing', () => {

        const buildRenderedPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(TREE_WORKSPACE_ROOT);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 };
            panelState.dataOrgObjectApiNames = new Set(TREE_OBJECT_API_NAMES);
            panelState.dataOrgDetails = [SANDBOX_ORG, SECOND_ORG];
            return panelState;
        };

        it('answers loadDataOrgs only once a model with tree objects is confirmed drawn', () => {

            const panelState = buildRenderedPanelState();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toEqual({ kind: 'loadDataOrgs' });

            panelState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toBeUndefined();

        });

        it('selects an org by its index into the list the host posted', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 1 }, buildRenderedPanelState()))
                .toEqual({ kind: 'selectDataOrg', orgIndex: 1 });

        });

        it.each([
            ['a username', 'qa@example.com.qa'],
            ['an alias', 'qa'],
            ['an index string', '0'],
            ['an index past the list', 2],
            ['a negative index', -1],
            ['a fractional index', 0.5],
            ['no index', undefined]
        ])('refuses %s', (_description, orgIndex) => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: orgIndex }, buildRenderedPanelState())).toBeUndefined();

        });

        it('refuses a selection before the model it counts is confirmed drawn', () => {

            const panelState = buildRenderedPanelState();
            panelState.dataOrgObjectApiNames = new Set();

            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();

        });

        it('refreshes once a model with tree objects is confirmed drawn, with or without a selection', () => {

            const panelState = buildRenderedPanelState();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toEqual({ kind: 'refreshDataOrgCounts' });

            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toEqual({ kind: 'refreshDataOrgCounts' });

            panelState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toBeUndefined();

        });

    });

    describe('the open panel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceStateValues: Map<string, unknown>;
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let refreshConnectedOrgsSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const countedObjects = () => postedNamed('dataOrgCounts').flatMap(countsMessage => countsMessage.counts.map((count: any) => count.objectApiName));

        const openRenderedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(TREE_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        beforeEach(() => {

            postedPanelMessages = [];
            workspaceStateValues = new Map();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => workspaceStateValues.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { workspaceStateValues.set(stateKey, stateValue); })
            };

            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                reveal: jest.fn(),
                onDidDispose: jest.fn(),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: any) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            }));

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG, SECOND_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });
            refreshConnectedOrgsSpy = jest.spyOn(SalesforceOrgService, 'refreshConnectedOrgAuthorizations').mockResolvedValue({ connectionStatesByUsername: new Map() });

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('lists the orgs as labels only, and contacts no org until one is chosen', async () => {

            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')).toEqual([{
                command: 'dataOrgList',
                orgLabels: ['qa', 'prod@example.com'],
                selectedOrgIndex: null,
                noOrgsMessage: '',
                hiddenOrgCount: 0,
                hiddenOrgNote: '',
                forgottenOrgNotice: '',
                renderSequence: lastRenderSequence()
            }]);
            expect(JSON.stringify(postedPanelMessages)).not.toContain('qa@example.com.qa');
            expect(getConnectionSpy).not.toHaveBeenCalled();

        });

        it('says why when the authorized orgs could not be listed', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockRejectedValue(new Error('auth files unreadable'));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: 'The authorized Salesforce orgs could not be listed: auth files unreadable' });

        });

        it('says there are no authorized orgs with the existing message', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE });

        });

        it('connects by username, labels a sandbox, counts every tree object and remembers the org for the workspace', async () => {

            const fakeConnection = buildFakeConnection({ Account: 1200, Contact: 3, OtherChildObject__c: 0, Lead: 7 });
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(getConnectionSpy).toHaveBeenCalledWith('qa@example.com.qa');
            expect(fakeConnection.sentQueries[0]).toBe('SELECT IsSandbox, OrganizationType FROM Organization');
            expect(postedNamed('dataOrgSelection').map(selection => [selection.orgTypeLabel, selection.isSandbox])).toEqual([['', null], ['Sandbox', true]]);
            expect(postedNamed('dataOrgCounts').at(-1)).toMatchObject({ isComplete: true, connectionFailureMessage: '', requestedCount: 4, completedCount: 4 });
            expect(postedNamed('dataOrgCounts').flatMap(countsMessage => countsMessage.counts)).toIncludeSameMembers([
                { objectApiName: 'Account', status: 'count', recordCount: 1200, failureMessage: '' },
                { objectApiName: 'Contact', status: 'count', recordCount: 3, failureMessage: '' },
                { objectApiName: 'OtherChildObject__c', status: 'count', recordCount: 0, failureMessage: '' },
                { objectApiName: 'Lead', status: 'count', recordCount: 7, failureMessage: '' }
            ]);
            expect(workspaceStateValues.get(RECIPE_COCKPIT_DATA_ORG_STATE_KEY)).toBe('qa@example.com.qa');

        });

        it('lists only the orgs the CLI knows are not production and reports connected, and counts each reason it left one out', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([SANDBOX_ORG], [
                { username: 'prod@example.com', label: 'prod', reason: 'production' },
                { username: 'old@example.com', label: 'old', reason: 'expired' },
                { username: 'gone@example.com', label: 'gone', reason: 'deleted' },
                { username: 'uat@example.com', label: 'uat', reason: 'notConnected' },
                { username: 'dev@example.com', label: 'dev', reason: 'notConnected' }
            ]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({
                orgLabels: ['qa'],
                hiddenOrgCount: 5,
                hiddenOrgNote: '5 authorized orgs are not listed: 1 production, 1 expired, 1 deleted, 2 not connected. Data-by-Org lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, never production.',
                forgottenOrgNotice: '',
                noOrgsMessage: ''
            });

        });

        it('says no sandbox is authorized when every authorized org was left out as production', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([], [{ username: 'prod@example.com', label: 'prod', reason: 'production' }]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], hiddenOrgCount: 1, noOrgsMessage: RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE });

        });

        it('says no connected sandbox is authorized, and how to re-authorize one, when the rest are not connected', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([], [
                { username: 'prod@example.com', label: 'prod', reason: 'production' },
                { username: 'old@example.com', label: 'old', reason: 'expired' }
            ]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE });
            expect(RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE).toContain('sf org login web');

        });

        it('lists no org when the CLI could not say which are connected, and says why', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockRejectedValue(new OrgConnectionStatusUnavailableError('The Salesforce CLI ("sf") is not installed or not on PATH.'));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0].orgLabels).toEqual([]);
            expect(postedNamed('dataOrgList')[0].noOrgsMessage).toBe('The Salesforce CLI could not report which authorized orgs are connected, so no org is listed. The Salesforce CLI ("sf") is not installed or not on PATH.');

        });

        it('forgets a remembered org that is no longer connected, and says so once', async () => {

            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');
            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'old@example.com');
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([SANDBOX_ORG], [{ username: 'old@example.com', label: 'old-scratch', reason: 'expired' }]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList').map(dataOrgList => [dataOrgList.selectedOrgIndex, dataOrgList.forgottenOrgNotice])).toEqual([
                [null, 'The last org used, old-scratch, is no longer connected.'],
                [null, '']
            ]);
            expect(workspaceStateValues.get(RECIPE_COCKPIT_DATA_ORG_STATE_KEY)).toBeUndefined();
            expect(getConnectionSpy).not.toHaveBeenCalled();

        });

        it('forgets a remembered org that is no longer authorized without a word', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'removed@example.com');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ selectedOrgIndex: null, forgottenOrgNotice: '' });

        });

        it('allows no selection while the connection check is out, and discards its answer once a ready replaces the document', async () => {

            let answerListing: (dataOrgListing: any) => void = () => undefined;
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockImplementation(() => new Promise(resolveListing => { answerListing = resolveListing; }));

            await openRenderedCockpit();
            const listing = receivedMessageHandler({ command: 'loadDataOrgs' });
            await new Promise(resolveYield => setImmediate(resolveYield));

            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

            await receivedMessageHandler({ command: 'ready' });
            answerListing(buildDataOrgListing([SANDBOX_ORG, SECOND_ORG]));
            await listing;

            expect(postedNamed('dataOrgList')).toEqual([]);

        });

        it('discards a check\'s answer when a new model is posted while it is out', async () => {

            let answerListing: (dataOrgListing: any) => void = () => undefined;
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockImplementation(() => new Promise(resolveListing => { answerListing = resolveListing; }));

            await openRenderedCockpit();
            const listing = receivedMessageHandler({ command: 'loadDataOrgs' });
            await new Promise(resolveYield => setImmediate(resolveYield));

            await receivedMessageHandler({ command: 'selectRun', runFolderName: TREE_RUN_FOLDER_NAME });
            answerListing(buildDataOrgListing([SANDBOX_ORG]));
            await listing;

            expect(postedNamed('dataOrgList')).toEqual([]);

        });

        it('⟳ asks the CLI again before re-listing the orgs, even with no org selected', async () => {

            const listSpy = jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([], [{ username: 'qa@example.com.qa', label: 'qa', reason: 'notConnected' }]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            expect(refreshConnectedOrgsSpy).not.toHaveBeenCalled();

            listSpy.mockResolvedValue(buildDataOrgListing([SANDBOX_ORG]));
            await receivedMessageHandler({ command: 'refreshDataOrgCounts' });

            expect(refreshConnectedOrgsSpy).toHaveBeenCalledTimes(1);
            expect(refreshConnectedOrgsSpy.mock.invocationCallOrder[0]).toBeLessThan(listSpy.mock.invocationCallOrder[1]);
            expect(postedNamed('dataOrgList').map(dataOrgList => dataOrgList.orgLabels)).toEqual([[], ['qa']]);

        });

        it.each([
            ['answers that it is production, Developer Edition included', { IsSandbox: false, OrganizationType: 'Developer Edition' }, 'Production · Developer Edition', false, 'answered that it is Production · Developer Edition'],
            ['cannot say what it is', new Error('INSUFFICIENT_ACCESS'), ORG_TYPE_UNKNOWN_LABEL, null, 'could not say whether it is a sandbox']
        ])('asks an org that %s nothing more: no count, no describe, and Create refused', async (_description, organizationRow, expectedTypeLabel, expectedIsSandbox, expectedReason) => {

            const fakeConnection = buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }, organizationRow);
            const describeSpy = jest.spyOn(SalesforceOrgService, 'describeObjects');
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgTypeLabel: expectedTypeLabel, isSandbox: expectedIsSandbox });
            expect(fakeConnection.sentQueries).toEqual(['SELECT IsSandbox, OrganizationType FROM Organization']);
            expect(describeSpy).not.toHaveBeenCalled();
            expect(postedNamed('dataOrgCounts')).toEqual([expect.objectContaining({
                counts: [],
                isComplete: true,
                connectionFailureMessage: expect.stringContaining(`qa ${expectedReason}, so Data-by-Org asked it nothing more.`)
            })]);
            expect(postedNamed('dataOrgReadiness').at(-1).objects.every((readiness: any) => readiness.disabledReason !== '')).toBe(true);

        });

        it('reports a failed connection once for the whole org, not per object', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockRejectedValue(new Error('expired access/refresh token'));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(postedNamed('dataOrgCounts')).toEqual([expect.objectContaining({
                counts: [],
                isComplete: true,
                connectionFailureMessage: expect.stringContaining('Could not connect to qa: expired access/refresh token')
            })]);

        });

        it('reports an object the org does not have as notInOrg', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, Lead: 1 }) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(postedNamed('dataOrgCounts').flatMap(countsMessage => countsMessage.counts).find((count: any) => count.objectApiName === 'OtherChildObject__c'))
                .toMatchObject({ status: 'notInOrg' });

        });

        it('preselects the remembered org on reopen, contacting it only once Data-by-Org asks', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'prod@example.com');
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);

            await openRenderedCockpit();
            expect(getConnectionSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0].selectedOrgIndex).toBe(1);
            expect(getConnectionSpy).toHaveBeenCalledWith('prod@example.com');
            expect(countedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);

        });

        it('still counts when remembering the org fails, and leaves no rejection unhandled', async () => {

            workspaceState.update.mockRejectedValue(new Error('workspace state is read-only'));
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await new Promise(resolveYield => setImmediate(resolveYield));

            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, SANDBOX_ORG.username);
            expect(countedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);

        });

        it('drops a remembered org that is no longer authorized, without a word', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'gone@example.com');
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0].selectedOrgIndex).toBeNull();
            expect(workspaceStateValues.get(RECIPE_COCKPIT_DATA_ORG_STATE_KEY)).toBeUndefined();
            expect(getConnectionSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        it('discards the first org\'s answers when another org is chosen mid-count', async () => {

            let releaseFirstOrg: () => void;
            const firstOrgGate = new Promise<void>(resolveGate => { releaseFirstOrg = resolveGate; });
            const firstConnection = buildFakeConnection({ Account: 111, Contact: 111, OtherChildObject__c: 111, Lead: 111 });
            const firstQuery = firstConnection.query.getMockImplementation();
            firstConnection.query.mockImplementation(async (soql: string) => {
                if ( soql.startsWith('SELECT COUNT()') ) {
                    await firstOrgGate;
                }
                return firstQuery(soql);
            });
            const secondConnection = buildFakeConnection({ Account: 2, Contact: 2, OtherChildObject__c: 2, Lead: 2 }, { IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async (orgUsername: string) => (
                orgUsername === SANDBOX_ORG.username ? firstConnection : secondConnection
            ) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const firstSelection = receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await new Promise(resolveYield => setImmediate(resolveYield));
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 1 });
            releaseFirstOrg();
            await firstSelection;

            const secondRequestSequence = postedNamed('dataOrgSelection').at(-1).requestSequence;
            const postedCounts = postedNamed('dataOrgCounts').flatMap(countsMessage => countsMessage.counts);

            expect(postedCounts.every((count: any) => count.recordCount === 2)).toBe(true);
            expect(postedNamed('dataOrgCounts').every(countsMessage => countsMessage.requestSequence === secondRequestSequence)).toBe(true);
            // THE FIRST ORG'S COUNT LOOP STOPPED, SO NO MORE THAN ITS IN-FLIGHT QUERIES WERE EVER SENT
            expect(firstConnection.sentQueries.filter(soql => soql.startsWith('SELECT COUNT()')).length).toBeLessThanOrEqual(TREE_OBJECT_API_NAMES.length);

        });

        it('ends the selection when the org list is reloaded, and selects the same org again by username in the new list', async () => {

            const listSpy = jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG, SECOND_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            // THE CLI'S LIST CHANGED ORDER: INDEX 0 IS NOW ANOTHER ORG
            listSpy.mockResolvedValue({ orgDetails: [SECOND_ORG, SANDBOX_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList').at(-1).selectedOrgIndex).toBe(1);
            expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgIndex: 1, orgLabel: 'qa' });

            getConnectionSpy.mockClear();
            await receivedMessageHandler({ command: 'refreshDataOrgCounts' });

            expect(getConnectionSpy).toHaveBeenCalledWith(SANDBOX_ORG.username);
            expect(getConnectionSpy).not.toHaveBeenCalledWith(SECOND_ORG.username);

        });

        it('ends a selection still counting when the panel fails to draw', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);
            jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const selection = receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await selection;

            expect(postedNamed('dataOrgCounts')).toEqual([]);
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

        });

        it('⟳ clears the selected org\'s cached counts and counts again', async () => {

            const fakeConnection = buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 });
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            const countQueries = () => fakeConnection.sentQueries.filter(soql => soql.startsWith('SELECT COUNT()'));
            expect(countQueries()).toHaveLength(4);

            await receivedMessageHandler({ command: 'refreshDataOrgCounts' });

            expect(countQueries()).toHaveLength(8);

        });

        it('ends a selection still counting when a new model is posted, so its answers are not drawn over the new one', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const selection = receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: TREE_RUN_FOLDER_NAME });
            await selection;

            const latestRenderSequence = lastRenderSequence();
            expect(postedNamed('dataOrgCounts').filter(countsMessage => countsMessage.renderSequence === latestRenderSequence)).toEqual([]);
            // THE NEW MODEL'S OBJECTS ARE NOT COUNTABLE UNTIL IT IS CONFIRMED DRAWN
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

        });


        /*
            Compare with an org… sits in a card's Structure tab and describes in the org Data-by-Org
            picked, so a reader who chose an org once is not asked again. Only with none picked or
            remembered does the authorized-org picker open.
        */
        describe('Compare with an org… in a card', () => {

            const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
            let describeObjectsSpy: jest.SpyInstance;
            let promptSpy: jest.SpyInstance;

            beforeEach(() => {

                describeObjectsSpy = jest.spyOn(SalesforceOrgService, 'describeObjects').mockImplementation(async (orgUsername: string, objectApiNames: string[]) => ({
                    outcomes: objectApiNames.map(objectApiName => ({ objectApiName: objectApiName, failureMessage: 'NOT_FOUND', wasCached: false })),
                    wasCancelled: false
                }));
                promptSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue({ targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' });
                jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
                (vscode.window.withProgress as jest.Mock).mockReset();
                (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions: any, progressTask: Function) => (
                    progressTask({ report: jest.fn() }, { isCancellationRequested: false })
                ));

            });

            const describedUsernames = () => describeObjectsSpy.mock.calls.map(describeCall => describeCall[0]);

            it('uses the org picked in Data-by-Org, describes only that card\'s objects, and tags the answer with the card', async () => {

                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ Account: 1, Contact: 1, OtherChildObject__c: 1, Lead: 1 }) as any);
                jest.spyOn(RecipeCockpitService, 'computeCreateReadinessByTarget').mockResolvedValue({ byObjectApiName: new Map(), byCreateKey: new Map() });

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 1 });
                await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY });

                expect(promptSpy).not.toHaveBeenCalled();
                expect(describeObjectsSpy).toHaveBeenCalledTimes(1);
                expect(describeObjectsSpy.mock.calls[0][0]).toBe('prod@example.com');
                expect(describeObjectsSpy.mock.calls[0][1]).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
                expect(postedNamed('orgDescribe')).toEqual([expect.objectContaining({ treeKey: ACCOUNT_TREE_KEY, orgLabel: 'prod@example.com' })]);

                await receivedMessageHandler({ command: 'selectOrg', treeKey: 'Lead-ONLY' });

                expect(describeObjectsSpy.mock.calls[1][1]).toEqual(['Lead']);
                // EACH CARD KEEPS ITS OWN ANSWER, SO A RELOADED DOCUMENT GETS BOTH BACK
                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });
                expect(postedNamed('orgDescribe').map(orgDescribe => orgDescribe.treeKey)).toEqual([ACCOUNT_TREE_KEY, 'Lead-ONLY']);

            });

            it('given Data-by-Org was not opened, uses the org it remembers for this workspace, connecting to nothing to find it', async () => {

                workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, SANDBOX_ORG.username);
                const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY });

                expect(promptSpy).not.toHaveBeenCalled();
                expect(describedUsernames()).toEqual([SANDBOX_ORG.username]);
                // THE DESCRIBE IS HANDED A CONNECTION FACTORY, WHICH THIS SPY NEVER RUNS -- LISTING THE ORGS CONNECTED TO NONE
                expect(getConnectionSpy).not.toHaveBeenCalled();

            });

            it.each([
                ['nothing is picked or remembered', undefined, () => undefined],
                ['the remembered org is no longer authorized', 'gone@example.com', () => undefined],
                ['the authorized orgs cannot be listed', SANDBOX_ORG.username, () => jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockRejectedValue(new Error('auth files unreadable'))]
            ])('given %s, asks for an org with the picker', async (_description, rememberedUsername, arrange) => {

                if ( rememberedUsername ) {
                    workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, rememberedUsername);
                }
                arrange();

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY });

                expect(promptSpy).toHaveBeenCalledTimes(1);
                expect(describedUsernames()).toEqual(['jd@example.com']);

            });

            // DATA-BY-ORG NEVER LISTS PRODUCTION, SO "Choose another org…" IS HOW A READER COMPARES WITH IT
            it('given "Choose another org…", asks with the picker even though Data-by-Org remembers an org', async () => {

                workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, SANDBOX_ORG.username);
                const listSpy = SalesforceOrgService.listDataOrgDetails as unknown as jest.SpyInstance;

                await openRenderedCockpit();
                listSpy.mockClear();
                await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY, chooseOrg: true });

                expect(promptSpy).toHaveBeenCalledTimes(1);
                expect(listSpy).not.toHaveBeenCalled();
                expect(describedUsernames()).toEqual(['jd@example.com']);

            });

            it('given a card the rendered model does not have, describes nothing', async () => {

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'selectOrg', treeKey: 'Opportunity-ONLY' });

                expect(promptSpy).not.toHaveBeenCalled();
                expect(describeObjectsSpy).not.toHaveBeenCalled();

            });

        });
    });

    describe('the panel script, Data-by-Org view', () => {

        const renderDataOrgPanel = () => {
            const panel = runPanelScript();
            const recipe = loadTreeRecipe();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            return { panel, recipe };
        };

        const viewOf = (panel: any, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];
        const openDataOrgView = (panel: any) => panel.findAll(panel.cockpitBodyElement, 'viewButton')
            .find((element: any) => element.textContent === 'Data-by-Org').dispatch('click');
        const textOf = (panel: any, className: string) => panel.findAll(panel.cockpitBodyElement, className).map((element: any) => element.textContent);
        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        const postSelectionAndCounts = (panel: any, requestSequence: number, recordCount: number, renderSequence = 1) => {
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence, renderSequence });
            panel.postToPanel({
                command: 'dataOrgCounts',
                counts: TREE_OBJECT_API_NAMES.map(objectApiName => ({ objectApiName, status: 'count', recordCount, failureMessage: '' })),
                completedCount: 4, requestedCount: 4, isComplete: true, connectionFailureMessage: '', requestSequence, renderSequence
            });
        };

        it('joins the view switch beside Recipe Trees, and asks for the orgs once, when it is first shown', () => {

            const { panel } = renderDataOrgPanel();

            expect(textOf(panel, 'viewButton')).toEqual(['Recipe Trees', 'Data-by-Org']);
            expect(panel.isHidden(viewOf(panel, 'dataOrgView'))).toBe(true);
            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([]);

            openDataOrgView(panel);
            openDataOrgView(panel);

            expect(panel.isHidden(viewOf(panel, 'dataOrgView'))).toBe(false);
            expect(panel.isHidden(viewOf(panel, 'treesView'))).toBe(true);
            expect(panel.isHidden(viewOf(panel, 'filterInput'))).toBe(true);
            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([{ command: 'loadDataOrgs' }]);

        });

        it('lists every tree in Recipe Trees order, and its objects in insert order', () => {

            const { panel } = renderDataOrgPanel();

            expect(textOf(panel, 'dataTreeTitle')).toEqual(['Relationship Tree 1', 'Relationship Tree 2']);
            expect(textOf(panel, 'dataObjectName')).toEqual(TREE_OBJECT_API_NAMES);
            expect(textOf(panel, 'dataTreeCount')).toEqual(['3 objects', '1 object']);

        });

        it('offers the posted labels in a native select and posts back only the chosen index', () => {

            const { panel } = renderDataOrgPanel();
            openDataOrgView(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod@example.com'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            const selectElement = viewOf(panel, 'dataOrgSelect');
            expect(selectElement.tagName).toBe('select');
            expect(selectElement.children.map((optionElement: any) => [optionElement.value, optionElement.textContent])).toEqual([['', 'Choose an org…'], ['0', 'qa'], ['1', 'prod@example.com']]);

            selectElement.value = '1';
            selectElement.dispatch('change');

            expect(postedNamed(panel, 'selectDataOrg')).toEqual([{ command: 'selectDataOrg', orgIndex: 1 }]);

        });

        it('says how many authorized orgs it left out, and why, and that the org used last is no longer connected', () => {

            const hiddenOrgNote = '3 authorized orgs are not listed: 1 production, 1 expired, 1 not connected. Data-by-Org lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, never production.';
            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgCount: 3, hiddenOrgNote: hiddenOrgNote, forgottenOrgNotice: 'The last org used, <b>old</b>, is no longer connected.', renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(false);
            expect(viewOf(panel, 'dataOrgHiddenNote').textContent).toBe(`The last org used, <b>old</b>, is no longer connected. ${hiddenOrgNote}`);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(true);

        });

        it('shows "Checking org connections…" in place of the dropdown until the list arrives', () => {

            const { panel } = renderDataOrgPanel();
            openDataOrgView(panel);

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT);
            expect(panel.isHidden(viewOf(panel, 'dataOrgSelect'))).toBe(true);

        });

        it('offers ⟳ even when no org is listed, so a re-authorized org can be listed', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgRefresh'))).toBe(false);

        });

        it('shows the no authorized orgs message when there are none', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSelect'))).toBe(true);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(NO_AUTHORIZED_ORGS_MESSAGE);

        });

        it('draws the org type, each object\'s count and each tree\'s total', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndCounts(panel, 1, 1500);

            expect(viewOf(panel, 'dataOrgType').textContent).toBe('Sandbox');
            expect(textOf(panel, 'dataObjectCount')).toEqual(['1,500 records', '1,500 records', '1,500 records', '1,500 records']);
            expect(textOf(panel, 'dataTreeCount')).toEqual(['3 objects · 4,500 records in the org', '1 object · 1,500 records in the org']);

        });

        it('says which objects could not be counted, and why on hover', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence: 1, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgCounts',
                counts: [
                    { objectApiName: 'Account', status: 'count', recordCount: 1, failureMessage: '' },
                    { objectApiName: 'Contact', status: 'notInOrg', recordCount: 0, failureMessage: 'INVALID_TYPE' },
                    { objectApiName: 'OtherChildObject__c', status: 'noAccess', recordCount: 0, failureMessage: 'INSUFFICIENT_ACCESS' }
                ],
                completedCount: 3, requestedCount: 4, isComplete: false, connectionFailureMessage: '', requestSequence: 1, renderSequence: 1
            });

            expect(textOf(panel, 'dataObjectCount')).toEqual(['1 record', 'not in org', 'no access', 'counting…']);
            expect(textOf(panel, 'dataTreeCount')).toEqual(['3 objects · 1 record in the org · 2 not counted', '1 object · counting…']);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('Counted 3 of 4 objects…');

        });

        it('drops counts for an older selection or an older model', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndCounts(panel, 2, 5);

            postSelectionAndCounts(panel, 1, 999);
            postSelectionAndCounts(panel, 3, 777, 0);

            expect(textOf(panel, 'dataObjectCount')).toEqual(['5 records', '5 records', '5 records', '5 records']);

        });

        it('marks every object not counted when the connection failed, and says so once', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: ORG_TYPE_UNKNOWN_LABEL, isSandbox: null, requestSequence: 1, renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgCounts', counts: [], completedCount: 0, requestedCount: 4, isComplete: true, connectionFailureMessage: 'Could not connect to qa: expired.', requestSequence: 1, renderSequence: 1 });

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('Could not connect to qa: expired.');
            expect(viewOf(panel, 'dataOrgStatus').classList.contains('failed')).toBe(true);
            expect(textOf(panel, 'dataObjectCount')).toEqual(['could not count', 'could not count', 'could not count', 'could not count']);

        });

        it('posts ⟳ as a payload-free refresh, and takes the dropdown and the counts away until the orgs are listed again', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndCounts(panel, 1, 1);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');

            expect(postedNamed(panel, 'refreshDataOrgCounts')).toEqual([{ command: 'refreshDataOrgCounts' }]);
            expect(panel.isHidden(viewOf(panel, 'dataOrgSelect'))).toBe(true);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT);
            expect(textOf(panel, 'dataObjectCount')).not.toContain('1 record');

        });

        it('disables ⟳ while the check is out, and enables it again with the list it asked for', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            expect(viewOf(panel, 'dataOrgRefresh').disabled).toBe(true);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
            expect(viewOf(panel, 'dataOrgRefresh').disabled).toBe(false);

        });

        it('after a ⟳ that forgets the org, reads "—" rather than "counting…", hides Create, and draws nothing more of the old selection', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndCounts(panel, 1, 5);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, forgottenOrgNotice: 'The last org used, qa, is no longer connected.', hiddenOrgNote: '', renderSequence: 1 });

            expect(textOf(panel, 'dataObjectCount')).toEqual(['—', '—', '—', '—']);
            expect(textOf(panel, 'dataTreeCount').join(' ')).not.toContain('counting…');
            expect(panel.findAll(panel.cockpitBodyElement, 'dataCreateControls').every((controlsElement: any) => panel.isHidden(controlsElement))).toBe(true);

            // AN ANSWER STILL ON ITS WAY FOR THE CLEARED SELECTION IS DROPPED
            postSelectionAndCounts(panel, 1, 999);
            expect(textOf(panel, 'dataObjectCount')).toEqual(['—', '—', '—', '—']);

        });

        it('asks again for the next model drawn while Data-by-Org is on screen', () => {

            const { panel, recipe } = renderDataOrgPanel();
            openDataOrgView(panel);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgView'))).toBe(false);
            expect(postedNamed(panel, 'loadDataOrgs')).toHaveLength(2);
            // AFTER THE NEW MODEL'S ACK, SO THE HOST HAS ALREADY MADE ITS OBJECTS COUNTABLE
            const postedCommands = panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);
            expect(postedCommands.lastIndexOf('loadDataOrgs')).toBeGreaterThan(postedCommands.lastIndexOf('rendered'));

        });

        it('writes org labels and object names as text, never as markup', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['<img src=x onerror=alert(1)>'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            expect(viewOf(panel, 'dataOrgSelect').children[1].textContent).toBe('<img src=x onerror=alert(1)>');

        });

    });

});
