import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
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
    RECIPE_COCKPIT_INSERT_ACTION_LABEL,
    RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE,
    RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT,
    RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON,
    RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER,
    RECIPE_COCKPIT_REFRESH_ORGS_LABEL,
    RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX
} from '../RecipeCockpitService';
import { AuthInfo } from '@salesforce/core';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import {
    IDataOrgListing,
    IHiddenAuthorizedOrg,
    NO_AUTHORIZED_ORGS_MESSAGE,
    ORG_TYPE_UNKNOWN_LABEL,
    OrgConnectionStatusUnavailableError,
    SalesforceOrgService
} from '../../SalesforceOrgService/SalesforceOrgService';
import { IAuthenticatedOrgDetail, PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
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

// A CONNECTION STAND-IN: THE ORGANIZATION ROW (OR A THROW) FOR THE TYPE QUERY, AND A FAILURE FOR ANY OTHER QUERY
function buildFakeConnection(organizationRow: unknown = { IsSandbox: true, OrganizationType: 'Unlimited Edition' }) {

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
            throw new Error(`The Treecipe tab's org picker sent a query it should not have: ${soql}`);
        })
    };

}


// THE ORG SHOWN WHILE THE CONNECTIONS ARE CHECKED (#305) IS READ FROM THE MACHINE'S OWN AUTHORIZATIONS, SO NO SUITE DEPENDS ON THEM
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockResolvedValue(undefined);
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, the Treecipe tab\'s org picker (Data-by-Org, #255)', () => {

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

        it('refuses a selection before the model it checks is confirmed drawn', () => {

            const panelState = buildRenderedPanelState();
            panelState.dataOrgObjectApiNames = new Set();

            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();

        });

        it('refreshes once a model with tree objects is confirmed drawn, with or without a selection', () => {

            const panelState = buildRenderedPanelState();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toEqual({ kind: 'refreshDataOrgs' });

            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toEqual({ kind: 'refreshDataOrgs' });

            panelState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toBeUndefined();

        });

        // #537: THE PANEL CLEARED ITS PICKER ON THE CLICK, SO AN UNANSWERED REFUSAL LEFT IT SPINNING UNTIL VS CODE RESTARTED
        it.each([
            ['A new scratch org run is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true }; }],
            ['An insert is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: 'Lead-ONLY' }; }],
            ['A permission set assignment is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: 'Lead-ONLY' }; }],
            ['A metadata deploy is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: 'Lead-ONLY', deployKind: 'fields' }; }],
            ['A prompt asking for an org is open', (panelState: IRecipeCockpitPanelState) => { panelState.isOrgPromptOpen = true; }],
            ['A prompt asking for an org is open', (panelState: IRecipeCockpitPanelState) => { panelState.isUpdaterOrgPromptOpen = true; }],
            ['A Treecipe Adapter update is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY', runKind: 'update' }; }],
            ['A Treecipe Adapter restore is using the selected org', (panelState: IRecipeCockpitPanelState) => { panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY', runKind: 'restore' }; }]
        ])('answers ⟳ and a listing with a refusal naming %s while it holds the selection (#537)', (runLabel, holdSelection) => {

            const panelState = buildRenderedPanelState();
            holdSelection(panelState);

            const refusal = {
                kind: 'refuseDataOrgListing',
                hostMessage: { command: 'dataOrgListingRefused', renderSequence: 1, message: `${runLabel}${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}` }
            };
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toEqual(refusal);
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toEqual(refusal);

        });

        it('routes ⟳ again once nothing holds the selection, and a Treecipe Adapter load holds nothing (#537)', () => {

            const panelState = buildRenderedPanelState();
            panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' };

            expect(RecipeCockpitService.describeSelectionHoldingRun(panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toEqual({ kind: 'refreshDataOrgs' });

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
        const checkedObjects = () => postedNamed('dataOrgReadiness').flatMap(readinessMessage => readinessMessage.objects.map((readiness: any) => readiness.objectApiName));

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

        it('on ⟳, forgets what was described in each org the CLI listed, and nothing else (#537)', async () => {

            const clearForOrgSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCacheForOrg');
            const clearDescribeCacheSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            expect(clearForOrgSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(clearForOrgSpy.mock.calls).toEqual([[SANDBOX_ORG.username], [SECOND_ORG.username]]);
            expect(clearDescribeCacheSpy).not.toHaveBeenCalled();
            expect(refreshConnectedOrgsSpy).toHaveBeenCalledTimes(1);
            expect(postedNamed('dataOrgList')).toHaveLength(2);

        });

        it('forgets no describe on a ⟳ whose listing failed, since it listed nothing (#537)', async () => {

            const clearForOrgSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCacheForOrg');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            (SalesforceOrgService.listDataOrgDetails as jest.Mock).mockRejectedValue(new OrgConnectionStatusUnavailableError('The Salesforce CLI did not answer.'));

            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(clearForOrgSpy).not.toHaveBeenCalled();
            expect(postedNamed('dataOrgList').slice(-1)[0]).toMatchObject({ orgLabels: [], noOrgsMessage: expect.stringContaining('The Salesforce CLI did not answer.') });

        });

        it('answers ⟳ while an insert holds the selection with a refusal, and neither lists, refreshes nor forgets a describe (#537)', async () => {

            const clearDescribeCacheSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const clearForOrgSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCacheForOrg');
            const listSpy = SalesforceOrgService.listDataOrgDetails as jest.Mock;

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            const listCallCount = listSpy.mock.calls.length;
            (RecipeCockpitService as any).recipeCockpitPanelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: 'Lead-ONLY' };

            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(postedNamed('dataOrgListingRefused')).toEqual([{
                command: 'dataOrgListingRefused',
                renderSequence: lastRenderSequence(),
                message: `An insert is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}`
            }]);
            expect(listSpy.mock.calls.length).toBe(listCallCount);
            expect(refreshConnectedOrgsSpy).not.toHaveBeenCalled();
            expect(clearDescribeCacheSpy).not.toHaveBeenCalled();
            expect(clearForOrgSpy).not.toHaveBeenCalled();

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
                hiddenOrgNote: '',
                forgottenOrgNotice: '',
                renderSequence: lastRenderSequence()
            }]);
            expect(JSON.stringify(postedPanelMessages)).not.toContain('qa@example.com.qa');
            expect(getConnectionSpy).not.toHaveBeenCalled();

        });

        // #305: THE ORG SHOWN WHILE THE CHECK RUNS, AND THE CLI'S DEFAULT ORG
        it('posts the CLI\'s default org as a label before the list, reading it locally, and passes the workspace to the listing', async () => {

            const readLocalSpy = jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockResolvedValue({ ...SANDBOX_ORG, isDefault: true });
            const listSpy = SalesforceOrgService.listDataOrgDetails as jest.Mock;
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const orgMessages = postedPanelMessages.filter(hostMessage => ['dataOrgProvisional', 'dataOrgList'].includes(hostMessage.command));
            expect(orgMessages.map(hostMessage => hostMessage.command)).toEqual(['dataOrgProvisional', 'dataOrgList']);
            expect(orgMessages[0]).toEqual({ command: 'dataOrgProvisional', orgLabel: 'qa (default)', requestSequence: expect.any(Number), renderSequence: lastRenderSequence() });
            expect(readLocalSpy).toHaveBeenCalledWith(undefined, TREE_WORKSPACE_ROOT);
            expect(listSpy).toHaveBeenCalledWith(TREE_WORKSPACE_ROOT);
            expect(JSON.stringify(orgMessages[0])).not.toContain('qa@example.com.qa');
            expect(getConnectionSpy).not.toHaveBeenCalled();

        });

        it('shows the org chosen last, rather than the default, while the check runs', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'prod@example.com');
            const readLocalSpy = jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockResolvedValue(SECOND_ORG);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(readLocalSpy).toHaveBeenCalledWith('prod@example.com', TREE_WORKSPACE_ROOT);
            expect(postedNamed('dataOrgProvisional').map(hostMessage => hostMessage.orgLabel)).toEqual(['prod@example.com']);
            expect(postedNamed('dataOrgList')[0].selectedOrgIndex).toBe(1);

        });

        it('posts no provisional org when none is remembered or set as the default, or when reading it fails, and lists the orgs all the same', async () => {

            jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockRejectedValue(new Error('auth files unreadable'));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgProvisional')).toEqual([]);
            expect(postedNamed('dataOrgList')[0].orgLabels).toEqual(['qa', 'prod@example.com']);

        });

        it('labels the default org "(default)" and selects it when no org was chosen before, so its own Organization row decides the insert', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([{ ...SECOND_ORG, isDefault: true } as IAuthenticatedOrgDetail, SANDBOX_ORG]));
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ IsSandbox: false, OrganizationType: 'Enterprise Edition' }) as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: ['prod@example.com (default)', 'qa'], selectedOrgIndex: 0 });
            expect(getConnectionSpy).toHaveBeenCalledWith('prod@example.com');
            const [lastSelection] = postedNamed('dataOrgSelection').slice(-1);
            expect(lastSelection.isSandbox).toBe(false);
            expect(lastSelection.failureMessage).toContain('It inserts records only into a sandbox or scratch org.');
            // REFUSED: THE ROUTER ANSWERS THE PANEL THAT NO INSERT RUNS, AND NEVER ROUTES ONE
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: 'Account-thru-OtherChildObject__c' }, (RecipeCockpitService as any).recipeCockpitPanelState)).toEqual({
                kind: 'postInsertState',
                hostMessage: { command: 'insertState', isRunning: false, treeKey: 'Account-thru-OtherChildObject__c' }
            });

        });

        it('keeps the org chosen last selected over the default', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'qa@example.com.qa');
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([{ ...SECOND_ORG, isDefault: true } as IAuthenticatedOrgDetail, SANDBOX_ORG]));
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0].selectedOrgIndex).toBe(1);

        });

        it('says the org chosen last is no longer connected, and forgets it, when it falls back to the default', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'old@example.com');
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing(
                [{ ...SANDBOX_ORG, isDefault: true } as IAuthenticatedOrgDetail, SECOND_ORG],
                [{ username: 'old@example.com', label: 'old-scratch', reason: 'expired' }]
            ));
            const rememberSpy = workspaceState.update;
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({
                orgLabels: ['qa (default)', 'prod@example.com'],
                selectedOrgIndex: 0,
                forgottenOrgNotice: 'The last org used, old-scratch, is no longer connected.'
            });
            expect(rememberSpy.mock.calls.map(updateCall => updateCall[1])).toEqual([undefined, 'qa@example.com.qa']);

        });

        it('drops a provisional org read for a check a ready has replaced', async () => {

            let answerLocalRead: (orgDetail: any) => void = () => undefined;
            jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockImplementation(() => new Promise(resolveRead => { answerLocalRead = resolveRead; }));

            await openRenderedCockpit();
            const listing = receivedMessageHandler({ command: 'loadDataOrgs' });
            await new Promise(resolveYield => setImmediate(resolveYield));
            await receivedMessageHandler({ command: 'ready' });
            answerLocalRead({ ...SANDBOX_ORG, isDefault: true });
            await listing;

            expect(postedNamed('dataOrgProvisional')).toEqual([]);

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

        it('connects by username, labels a sandbox, checks every tree object for the insert, counts nothing, and remembers the org for the workspace', async () => {

            const fakeConnection = buildFakeConnection();
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(getConnectionSpy).toHaveBeenCalledWith('qa@example.com.qa');
            expect(fakeConnection.sentQueries).toEqual(['SELECT IsSandbox, OrganizationType FROM Organization']);
            expect(postedNamed('dataOrgSelection').map(selection => [selection.orgTypeLabel, selection.isSandbox, selection.failureMessage])).toEqual([['', null, ''], ['', true, ''], ['Sandbox', true, '']]);
            expect(postedNamed('dataOrgCounts')).toEqual([]);
            expect(checkedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);
            expect(workspaceStateValues.get(RECIPE_COCKPIT_DATA_ORG_STATE_KEY)).toBe('qa@example.com.qa');

        });

        describe('says whether a sandbox is a scratch org, from the local authorization (#458, #499)', () => {

            const selectionLabels = () => postedNamed('dataOrgSelection').map(selection => [selection.orgTypeLabel, selection.isSandbox, selection.failureMessage]);

            it('reads the local authorization only once the Organization row says sandbox, and labels a scratch org with its expiration date when it answers', async () => {

                let answerDisplay: (scratchOrgDetail: { isScratchOrg: boolean; expirationDate?: string } | undefined) => void = () => undefined;
                const readScratchOrgDetailSpy = jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockImplementation(() => new Promise(resolveDisplay => { answerDisplay = resolveDisplay; }));
                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ IsSandbox: true, OrganizationType: 'Developer Edition' }) as any);

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

                expect(readScratchOrgDetailSpy).toHaveBeenCalledWith('qa@example.com.qa');
                // THE LABEL WAITS; THE DESCRIBES DO NOT
                expect(selectionLabels()).toEqual([['', null, ''], ['', true, '']]);
                expect(checkedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);

                answerDisplay({ isScratchOrg: true, expirationDate: '2026-11-01' });
                await new Promise(resolveYield => setImmediate(resolveYield));

                expect(selectionLabels().slice(-1)).toEqual([['Scratch org · expires 2026-11-01', true, '']]);
                // THE SAME SELECTION: THE PANEL KEEPS ITS READINESS
                expect(new Set(postedNamed('dataOrgSelection').map(selection => selection.requestSequence)).size).toBe(1);

            });

            it('drops the answer read for an org the reader has since replaced', async () => {

                const answersByUsername = new Map<string, (scratchOrgDetail: { isScratchOrg: boolean } | undefined) => void>();
                jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockImplementation(username => new Promise(resolveDisplay => { answersByUsername.set(username, resolveDisplay); }));
                jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([SANDBOX_ORG, { ...SANDBOX_ORG, username: 'uat@example.com.uat', alias: 'uat' } as IAuthenticatedOrgDetail]));
                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 1 });
                const postedBeforeLateAnswer = postedNamed('dataOrgSelection').length;

                answersByUsername.get('qa@example.com.qa')?.({ isScratchOrg: true });
                await new Promise(resolveYield => setImmediate(resolveYield));

                expect(postedNamed('dataOrgSelection')).toHaveLength(postedBeforeLateAnswer);

                answersByUsername.get('uat@example.com.uat')?.({ isScratchOrg: false });
                await new Promise(resolveYield => setImmediate(resolveYield));

                const [lastSelection] = postedNamed('dataOrgSelection').slice(-1);
                expect([lastSelection.orgIndex, lastSelection.orgTypeLabel]).toEqual([1, 'Sandbox']);

            });

            it('falls back to "Sandbox" when the local authorization cannot answer', async () => {

                jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

                expect(selectionLabels().slice(-1)).toEqual([['Sandbox', true, '']]);

            });

            it('labels production from its Organization row without waiting for the local authorization, and never relabels it', async () => {

                const readScratchOrgDetailSpy = jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockImplementation(() => new Promise(() => undefined));
                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ IsSandbox: false, OrganizationType: 'Enterprise Edition' }) as any);

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

                const [lastLabel] = selectionLabels().slice(-1);
                expect(lastLabel[0]).toBe('Production · Enterprise Edition');
                expect(lastLabel[2]).toContain('It inserts records only into a sandbox or scratch org.');
                // ONLY A SANDBOX IS ASKED: A PRODUCTION DEFAULT NEVER READS THE AUTHORIZATION
                expect(readScratchOrgDetailSpy).not.toHaveBeenCalled();

            });

            it('keeps "type unknown" and the connection failure when the org could not be connected to, whatever the local authorization says', async () => {

                const readScratchOrgDetailSpy = jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue({ isScratchOrg: true, expirationDate: '2026-11-01' });
                jest.spyOn(SalesforceOrgService, 'getConnection').mockRejectedValue(new Error('expired token'));

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
                await new Promise(resolveYield => setImmediate(resolveYield));

                const [lastLabel] = selectionLabels().slice(-1);
                expect(lastLabel[0]).toBe('type unknown');
                expect(lastLabel[2]).toContain('Could not connect to qa');
                expect(readScratchOrgDetailSpy).not.toHaveBeenCalled();

            });

            it('labels a scratch org from its local authorization, with no CLI process, and posts and stores no part of its token (#499)', async () => {

                (SalesforceOrgService.readScratchOrgDetail as jest.Mock).mockRestore();
                const authorizationFields = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks', 'authFieldsScratchOrg.json'), 'utf8'));
                const getFields = jest.fn(() => authorizationFields);
                const createAuthInfoSpy = jest.spyOn(AuthInfo, 'create').mockResolvedValue({ getFields: getFields } as unknown as AuthInfo);
                const runSalesforceCliSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');
                jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

                await openRenderedCockpit();
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
                await new Promise(resolveYield => setImmediate(resolveYield));

                expect(createAuthInfoSpy).toHaveBeenCalledWith({ username: 'qa@example.com.qa' });
                expect(getFields.mock.calls.every(callArguments => callArguments.length === 0)).toBe(true);
                expect(runSalesforceCliSpy.mock.calls.map(([cliArguments]) => cliArguments.slice(0, 2).join(' '))).not.toContain('org display');
                expect(selectionLabels().slice(-1)).toEqual([['Scratch org · expires 2026-11-01', true, '']]);
                expect(JSON.stringify(postedPanelMessages)).not.toContain(authorizationFields.accessToken);
                expect(JSON.stringify([...workspaceStateValues.entries()])).not.toContain(authorizationFields.accessToken);

            });

        });

        it('lists only the orgs the CLI knows are not production and reports connected, and says only that it lists sandboxes, with no count of what it left out', async () => {

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
                hiddenOrgNote: 'The Treecipe tab lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, plus the CLI\'s default org, and inserts only into a sandbox or scratch org.',
                forgottenOrgNotice: '',
                noOrgsMessage: ''
            });
            expect(postedNamed('dataOrgList')[0]).not.toHaveProperty('hiddenOrgCount');
            expect(postedNamed('dataOrgList')[0].hiddenOrgNote).not.toMatch(/authorized orgs? (is|are) not listed|\d/);

        });

        it('says no sandbox is authorized when every authorized org was left out as production', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue(buildDataOrgListing([], [{ username: 'prod@example.com', label: 'prod', reason: 'production' }]));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE });

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
            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(refreshConnectedOrgsSpy).toHaveBeenCalledTimes(1);
            expect(refreshConnectedOrgsSpy.mock.invocationCallOrder[0]).toBeLessThan(listSpy.mock.invocationCallOrder[1]);
            expect(postedNamed('dataOrgList').map(dataOrgList => dataOrgList.orgLabels)).toEqual([[], ['qa']]);

        });

        it.each([
            ['answers that it is production, Developer Edition included', { IsSandbox: false, OrganizationType: 'Developer Edition' }, 'Production · Developer Edition', false, 'answered that it is Production · Developer Edition'],
            ['cannot say what it is', new Error('INSUFFICIENT_ACCESS'), ORG_TYPE_UNKNOWN_LABEL, null, 'could not say whether it is a sandbox']
        ])('asks an org that %s nothing more: no describe, and the insert refused', async (_description, organizationRow, expectedTypeLabel, expectedIsSandbox, expectedReason) => {

            const fakeConnection = buildFakeConnection(organizationRow);
            const describeSpy = jest.spyOn(SalesforceOrgService, 'describeObjects');
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgTypeLabel: expectedTypeLabel, isSandbox: expectedIsSandbox });
            expect(fakeConnection.sentQueries).toEqual(['SELECT IsSandbox, OrganizationType FROM Organization']);
            expect(describeSpy).not.toHaveBeenCalled();
            expect(postedNamed('dataOrgSelection').at(-1).failureMessage).toContain(`qa ${expectedReason}, so the Treecipe tab asked it nothing more. It inserts records only into a sandbox or scratch org.`);
            expect(postedNamed('dataOrgReadiness').at(-1).objects.every((readiness: any) => readiness.disabledReason !== '')).toBe(true);

        });

        it('reports a failed connection once for the whole org, not per object', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockRejectedValue(new Error('expired access/refresh token'));

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            expect(postedNamed('dataOrgSelection').at(-1).failureMessage).toContain('Could not connect to qa: expired access/refresh token');
            expect(postedNamed('dataOrgReadiness')).toEqual([]);
            // A QUERY (#439) READS FROM ANY ORG THAT ANSWERED, SO THE SELECTION SAYS WHEN NONE DID
            expect((RecipeCockpitService as any).recipeCockpitPanelState.dataOrgSelection.isConnectionFailed).toBe(true);

        });

        it('preselects the remembered org on reopen, contacting it only once the Treecipe tab asks', async () => {

            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'prod@example.com');
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            expect(getConnectionSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0].selectedOrgIndex).toBe(1);
            expect(getConnectionSpy).toHaveBeenCalledWith('prod@example.com');
            expect(checkedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);

        });

        it('still checks the org when remembering it fails, and leaves no rejection unhandled', async () => {

            workspaceState.update.mockRejectedValue(new Error('workspace state is read-only'));
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await new Promise(resolveYield => setImmediate(resolveYield));

            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, SANDBOX_ORG.username);
            expect(checkedObjects()).toIncludeSameMembers(TREE_OBJECT_API_NAMES);

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

        it('discards the first org\'s answers when another org is chosen mid-check', async () => {

            let releaseFirstOrg: () => void;
            const firstOrgGate = new Promise<void>(resolveGate => { releaseFirstOrg = resolveGate; });
            const firstConnection = buildFakeConnection();
            const firstQuery = firstConnection.query.getMockImplementation();
            firstConnection.query.mockImplementation(async (soql: string) => {
                await firstOrgGate;
                return firstQuery(soql);
            });
            const secondConnection = buildFakeConnection({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

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

            expect(postedNamed('dataOrgSelection').filter(selection => selection.orgTypeLabel === 'Sandbox')).toEqual([]);
            expect(postedNamed('dataOrgReadiness').every(readinessMessage => readinessMessage.requestSequence === secondRequestSequence)).toBe(true);

        });

        it('ends the selection when the org list is reloaded, and selects the same org again by username in the new list', async () => {

            const listSpy = jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG, SECOND_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

            // THE CLI'S LIST CHANGED ORDER: INDEX 0 IS NOW ANOTHER ORG
            listSpy.mockResolvedValue({ orgDetails: [SECOND_ORG, SANDBOX_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } });
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList').at(-1).selectedOrgIndex).toBe(1);
            expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgIndex: 1, orgLabel: 'qa' });

            getConnectionSpy.mockClear();
            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(getConnectionSpy).toHaveBeenCalledWith(SANDBOX_ORG.username);
            expect(getConnectionSpy).not.toHaveBeenCalledWith(SECOND_ORG.username);

        });

        it('ends a selection still being checked when the panel fails to draw', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);
            jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const selection = receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await selection;

            expect(postedNamed('dataOrgReadiness')).toEqual([]);
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

        });

        it('never sends a COUNT() query, whether an org is selected, selected again or refreshed with ⟳', async () => {

            const fakeConnection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(fakeConnection as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'refreshDataOrgs' });

            expect(fakeConnection.sentQueries).toHaveLength(3);
            expect(fakeConnection.sentQueries.filter(soql => /COUNT\(/i.test(soql))).toEqual([]);
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).not.toContain('dataOrgCounts');

        });

        it('ends a selection still being checked when a new model is posted, so its answers are not drawn over the new one', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const selection = receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: TREE_RUN_FOLDER_NAME });
            await selection;

            const latestRenderSequence = lastRenderSequence();
            expect(postedNamed('dataOrgReadiness').filter(readinessMessage => readinessMessage.renderSequence === latestRenderSequence)).toEqual([]);
            // THE NEW MODEL'S OBJECTS ARE NOT CHECKABLE UNTIL IT IS CONFIRMED DRAWN
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

        });


        // #266: THE COMPARE TAB IS GONE, AND WITH IT THE ONE MESSAGE THAT DESCRIBED A CARD IN AN ORG FOR A COMPARISON
        it.each([
            [{ command: 'selectOrg', treeKey: 'Account-thru-OtherChildObject__c' }],
            [{ command: 'selectOrg', treeKey: 'Account-thru-OtherChildObject__c', chooseOrg: true }]
        ])('describes nothing and posts no comparison for a posted %o', async (panelMessage) => {

            const describeObjectsSpy = jest.spyOn(SalesforceOrgService, 'describeObjects');
            const promptSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg');
            workspaceStateValues.set(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, SANDBOX_ORG.username);

            await openRenderedCockpit();
            expect(RecipeCockpitService.routePanelMessage(panelMessage, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();
            await receivedMessageHandler(panelMessage);

            expect(describeObjectsSpy).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(postedNamed('orgDescribe')).toEqual([]);
            expect(postedNamed('orgProgress')).toEqual([]);

        });
    });

    describe('the panel script, the org picker in each card\'s Treecipe tab and the tree insert (#217, #255)', () => {

        const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
        const LEAD_TREE_KEY = 'Lead-ONLY';

        const renderDataOrgPanel = (focusTree?: { treeKey: string; tab: string }) => {
            const panel = runPanelScript();
            const recipe = loadTreeRecipe();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, focusTree: focusTree });
            return { panel, recipe };
        };

        const viewOf = (panel: any, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];
        // EVERY CARD OPENED, ON ITS TREECIPE TAB -- WHICH IS WHERE EACH CARD DRAWS ITS VIEW OF THE ORG PICKER
        const openTreecipeViews = (panel: any) => panel.expandAllTrees();
        const textOf = (panel: any, className: string) => panel.findAll(panel.cockpitBodyElement, className).map((element: any) => element.textContent);
        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        const postSelectionAndReadiness = (panel: any, requestSequence: number, disabledReason = '', renderSequence = 1) => {
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence, renderSequence });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: TREE_OBJECT_API_NAMES.map(objectApiName => ({ objectApiName, disabledReason, requiredLookups: [] })),
                createTargets: [], requestSequence, renderSequence
            });
        };
        const insertReasonsOf = (panel: any) => textOf(panel, 'treeInsertReason');
        const insertButtonsOf = (panel: any) => panel.findAll(panel.cockpitBodyElement, 'treeInsert');

        it('puts no org picker in the toolbar or in a card and no view switch, asks for no orgs when the panel opens, and draws ONE picker view in the Target Org Manager section (#348, #355)', () => {

            const { panel } = renderDataOrgPanel();
            const toolbarElement = panel.cockpitBodyElement.children[0];

            expect(panel.findAll(panel.cockpitBodyElement, 'viewButton')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'dataTreeCard')).toEqual([]);
            expect(panel.findAll(toolbarElement, 'dataOrgControls')).toEqual([]);
            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([]);

            panel.expandAllTrees();

            const viewElements = panel.findAll(panel.cockpitBodyElement, 'dataOrgView');
            expect(viewElements).toHaveLength(1);
            expect(viewElements[0].parentNode.attributes.id).toBe('cockpitOrgSectionBody');
            expect(panel.findAll(viewElements[0], 'dataOrgLoad').map((element: any) => element.textContent)).toEqual(['Choose org…']);
            expect(panel.findAll(viewElements[0], 'dataOrgSelect')).toHaveLength(1);
            expect(panel.findAll(viewElements[0], 'dataOrgRefresh')).toHaveLength(1);
            panel.treeCards().forEach((treeCard: any) => {
                const treecipeHeaderElement = panel.findAll(treeCard, 'treecipeHeader')[0];
                expect(panel.findAll(treecipeHeaderElement, 'dataOrgView')).toEqual([]);
                expect(panel.findAll(treecipeHeaderElement, 'treeInsert')).toHaveLength(1);
            });
            expect(panel.findAll(toolbarElement, 'dataOrgControls')).toEqual([]);

        });

        it('asks for the orgs once, the first time a card opens on its Treecipe tab', () => {

            const { panel } = renderDataOrgPanel();
            const [firstCard, secondCard] = panel.treeCards();

            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([]);

            panel.chooseTreeCard(firstCard);

            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([{ command: 'loadDataOrgs' }]);

            panel.openTab(firstCard, 'Treecipe');
            panel.chooseTreeCard(secondCard);

            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([{ command: 'loadDataOrgs' }]);
            panel.findAll(panel.cockpitBodyElement, 'dataOrgLoad').forEach((loadElement: any) => expect(panel.isHidden(loadElement)).toBe(true));

        });

        it('asks for the orgs when a focus opens a card on its Treecipe tab', () => {

            const { panel } = renderDataOrgPanel({ treeKey: LEAD_TREE_KEY, tab: 'treecipe' });

            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([{ command: 'loadDataOrgs' }]);

        });

        it('asks for the orgs once, however often "Choose org…" is used after the card opened on its Treecipe tab', () => {

            const { panel } = renderDataOrgPanel({ treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' });
            const accountCard = panel.treeCards()[0];

            viewOf(panel, 'dataOrgLoad').dispatch('click');
            viewOf(panel, 'dataOrgLoad').dispatch('click');
            panel.openTab(accountCard, 'Treecipe');

            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([{ command: 'loadDataOrgs' }]);

        });

        it('draws one selection into the picker and every card\'s insert, including a card opened only after it arrived, and counts no records in the org', () => {

            const { panel } = renderDataOrgPanel();
            const [firstCard, secondCard] = panel.treeCards();
            panel.chooseTreeCard(firstCard);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1, 'first reason');

            expect(panel.findAll(firstCard, 'treeInsertReason').map((element: any) => element.textContent)).toEqual(["Can't insert: first reason"]);

            panel.chooseTreeCard(secondCard);

            expect(panel.findAll(secondCard, 'treeInsertReason').map((element: any) => element.textContent)).toEqual(["Can't insert: first reason"]);
            expect(viewOf(panel, 'dataOrgSelect').value).toBe('0');
            expect(viewOf(panel, 'dataOrgType').textContent).toBe('Sandbox');
            expect(panel.findAll(panel.cockpitBodyElement, 'dataObjectCount')).toEqual([]);
            expect(postedNamed(panel, 'selectDataOrg')).toEqual([]);

        });

        it('offers the posted labels in a native select and posts back only the chosen index', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod@example.com'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            const selectElements = panel.findAll(panel.cockpitBodyElement, 'dataOrgSelect');
            expect(selectElements).toHaveLength(1);
            selectElements.forEach((selectElement: any) => {
                expect(selectElement.tagName).toBe('select');
                expect(selectElement.children.map((optionElement: any) => [optionElement.value, optionElement.textContent])).toEqual([['', 'Choose org…'], ['0', 'qa'], ['1', 'prod@example.com']]);
            });
            expect(textOf(panel, 'dataOrgStatus')).toEqual(['Choose an org to insert into.']);

            selectElements[0].value = '1';
            selectElements[0].dispatch('change');

            expect(postedNamed(panel, 'selectDataOrg')).toEqual([{ command: 'selectDataOrg', orgIndex: 1 }]);

            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 1, orgLabel: 'prod@example.com', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 1, renderSequence: 1 });

            expect(selectElements.map((selectElement: any) => selectElement.value)).toEqual(['1']);

        });

        it('says it lists only sandboxes when it left an org out, and that the org used last is no longer connected', () => {

            const hiddenOrgNote = 'The Treecipe tab lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, plus the CLI\'s default org, and inserts only into a sandbox or scratch org.';
            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgNote: hiddenOrgNote, forgottenOrgNotice: 'The last org used, <b>old</b>, is no longer connected.', renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(false);
            const expectedNote = `The last org used, <b>old</b>, is no longer connected. ${hiddenOrgNote}`;
            expect(textOf(panel, 'dataOrgHiddenNote')).toEqual([expectedNote]);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(true);

        });

        const optionsOf = (selectElement: any) => selectElement.children.map((optionElement: any) => [optionElement.value, optionElement.textContent]);

        // #305: THE PICKER NEVER VANISHES WHILE "sf org list" CHECKS THE CONNECTIONS
        it('keeps the dropdown, ⟳ and "+ New scratch org" drawn and enabled while the check runs, with a spinner to the right of the dropdown and "Checking org connections…" below', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);

            ['dataOrgSelect', 'dataOrgRefresh', 'dataOrgNewScratch', 'dataOrgSpinner'].forEach(className => {
                panel.findAll(panel.cockpitBodyElement, className).forEach((element: any) => {
                    expect(panel.isHidden(element)).toBe(false);
                    expect(element.disabled).toBeFalsy();
                });
            });
            panel.findAll(panel.cockpitBodyElement, 'dataOrgSelect').forEach((selectElement: any) => {
                expect(optionsOf(selectElement)).toEqual([['', RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER]]);
            });
            const controlsElement = viewOf(panel, 'dataOrgControls');
            const controlClasses = controlsElement.children.map((element: any) => element.className.split(' ')[0]);
            expect(controlClasses.indexOf('dataOrgSpinner')).toBe(controlClasses.indexOf('dataOrgSelect') + 1);
            expect(viewOf(panel, 'dataOrgSpinner').attributes['aria-hidden']).toBe('true');
            expect(textOf(panel, 'dataOrgStatus')).toEqual([RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT]);

        });

        it('holds every insert disabled while the check runs, with the reason that it is checking', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);

            const checkingReason = `Can't insert: ${RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON}`;
            expect(insertReasonsOf(panel)).toEqual([checkingReason, checkingReason]);
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, true], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, true]]);

        });

        it('shows the org the host read locally as the dropdown\'s one option while the check runs, never posting it as a selection', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgProvisional', orgLabel: 'qa (default)', requestSequence: 1, renderSequence: 1 });

            panel.findAll(panel.cockpitBodyElement, 'dataOrgSelect').forEach((selectElement: any) => {
                expect(optionsOf(selectElement)).toEqual([['', 'qa (default)']]);
                selectElement.dispatch('change');
            });
            expect(postedNamed(panel, 'selectDataOrg')).toEqual([]);
            expect(insertReasonsOf(panel)[0]).toBe(`Can't insert: ${RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON}`);

        });

        it('drops a provisional org for another model, an older check, or once the list has arrived', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgProvisional', orgLabel: 'other model', requestSequence: 1, renderSequence: 2 });
            panel.postToPanel({ command: 'dataOrgProvisional', orgLabel: 'newer', requestSequence: 3, renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgProvisional', orgLabel: 'older', requestSequence: 2, renderSequence: 1 });

            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'newer']]);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgProvisional', orgLabel: 'late', requestSequence: 4, renderSequence: 1 });

            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'Choose org…'], ['0', 'qa']]);
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgSpinner').every((element: any) => panel.isHidden(element))).toBe(true);

        });

        it('stops the spinner and leaves the dropdown drawn when the check fails', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: 'The Salesforce CLI could not report which authorized orgs are connected, so no org is listed.', renderSequence: 1 });

            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgSpinner').every((element: any) => panel.isHidden(element))).toBe(true);
            expect(panel.isHidden(viewOf(panel, 'dataOrgSelect'))).toBe(false);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toContain('could not report');
            expect(insertReasonsOf(panel)[0]).toBe(RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE);

        });

        it('offers ⟳ even when no org is listed, so a re-authorized org can be listed', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgRefresh'))).toBe(false);

        });

        // #263: THE ⟳ ALONE WAS TOO SMALL TO READ, SO THE BUTTON SAYS WHAT IT DOES AND DRAWS THE GLYPH ON ITS OWN, LARGER
        it('labels ⟳ "Refresh orgs", with the glyph in its own aria-hidden span and an accessible name that starts with the label', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            const refreshElement = viewOf(panel, 'dataOrgRefresh');
            const [iconElement] = panel.findAll(refreshElement, 'dataOrgRefreshIcon');

            expect(iconElement.textContent).toBe('⟳');
            expect(iconElement.attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(refreshElement, 'dataOrgRefreshLabel').map((element: any) => element.textContent)).toEqual([RECIPE_COCKPIT_REFRESH_ORGS_LABEL]);
            expect(RECIPE_COCKPIT_REFRESH_ORGS_LABEL).toBe('Refresh orgs');
            expect(refreshElement.attributes['aria-label']).toBe('Refresh orgs: check the org connections again');
            expect(refreshElement.attributes['aria-label'].startsWith(RECIPE_COCKPIT_REFRESH_ORGS_LABEL)).toBe(true);
            expect(refreshElement.attributes.title).toBe('Check the org connections again');

        });

        it('shows the no authorized orgs message when there are none', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSelect'))).toBe(false);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER]]);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(NO_AUTHORIZED_ORGS_MESSAGE);
            expect(insertReasonsOf(panel)).toEqual([RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE, RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE]);

        });

        it('draws the org type and says it is checking the org until its readiness arrives, then offers each tree\'s insert into that org', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 1, renderSequence: 1 });

            expect(viewOf(panel, 'dataOrgType').textContent).toBe('Sandbox');
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('Checking qa…');
            expect(insertReasonsOf(panel)).toEqual(["Can't insert: checking whether this tree can be inserted…", "Can't insert: checking whether this tree can be inserted…"]);
            // #375: DISABLED UNTIL THE TREE CAN BE INSERTED -- IT NEVER GENERATES ONLY
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, true], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, true]]);

            postSelectionAndReadiness(panel, 1);

            expect(panel.isHidden(viewOf(panel, 'dataOrgStatus'))).toBe(true);
            expect(insertReasonsOf(panel)).toEqual(['', '']);
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([
                [`${RECIPE_COCKPIT_INSERT_ACTION_LABEL} into qa`, false],
                [`${RECIPE_COCKPIT_INSERT_ACTION_LABEL} into qa`, false]
            ]);

        });

        it('drops an answer for an older selection or an older model', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 2, 'current');

            postSelectionAndReadiness(panel, 1, 'older selection');
            postSelectionAndReadiness(panel, 3, 'older model', 0);

            expect(insertReasonsOf(panel)).toEqual(["Can't insert: current", "Can't insert: current"]);

        });

        it('says once that the connection failed, and leaves no tree waiting on a check that will not come', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: ORG_TYPE_UNKNOWN_LABEL, isSandbox: null, failureMessage: 'Could not connect to qa: expired.', requestSequence: 1, renderSequence: 1 });

            expect(textOf(panel, 'dataOrgStatus')).toEqual(['Could not connect to qa: expired.']);
            expect(viewOf(panel, 'dataOrgStatus').classList.contains('failed')).toBe(true);
            expect(insertReasonsOf(panel)).toEqual(["Can't insert: Could not connect to qa: expired.", "Can't insert: Could not connect to qa: expired."]);
            // #375: DISABLED UNTIL THE TREE CAN BE INSERTED -- IT NEVER GENERATES ONLY
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, true], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, true]]);

        });

        it('drops a failed selection\'s message and insert reason when a new selection starts', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'uat'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: ORG_TYPE_UNKNOWN_LABEL, isSandbox: null, failureMessage: 'Could not connect to qa: expired.', requestSequence: 1, renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 1, orgLabel: 'uat', orgTypeLabel: '', isSandbox: null, failureMessage: '', requestSequence: 2, renderSequence: 1 });

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('Checking uat…');
            expect(viewOf(panel, 'dataOrgStatus').classList.contains('failed')).toBe(false);
            expect(insertReasonsOf(panel)).toEqual(["Can't insert: checking whether this tree can be inserted…", "Can't insert: checking whether this tree can be inserted…"]);

        });

        it('keeps a not-a-sandbox answer on screen, and as every tree\'s insert reason, when the refused readiness arrives after it', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Production', isSandbox: false, failureMessage: 'qa answered that it is Production.', requestSequence: 1, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: TREE_OBJECT_API_NAMES.map(objectApiName => ({ objectApiName, disabledReason: 'Records are inserted only into a sandbox or scratch org.', requiredLookups: [] })),
                createTargets: [], requestSequence: 1, renderSequence: 1
            });

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('qa answered that it is Production.');
            expect(insertReasonsOf(panel)).toEqual(["Can't insert: qa answered that it is Production.", "Can't insert: qa answered that it is Production."]);
            // #375: DISABLED UNTIL THE TREE CAN BE INSERTED -- IT NEVER GENERATES ONLY
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, true], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, true]]);

        });

        it('posts ⟳ as a payload-free refresh, and takes the selection away until the orgs are listed again, keeping the dropdown drawn with only the check\'s option', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');

            expect(postedNamed(panel, 'refreshDataOrgs')).toEqual([{ command: 'refreshDataOrgs' }]);
            panel.findAll(panel.cockpitBodyElement, 'dataOrgSelect').forEach((selectElement: any) => {
                expect(panel.isHidden(selectElement)).toBe(false);
                expect(optionsOf(selectElement)).toEqual([['', RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER]]);
            });
            expect(textOf(panel, 'dataOrgStatus')).toEqual([RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT]);
            const checkingReason = `Can't insert: ${RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON}`;
            expect(insertReasonsOf(panel)).toEqual([checkingReason, checkingReason]);
            // #375: DISABLED UNTIL THE TREE CAN BE INSERTED -- IT NEVER GENERATES ONLY
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, true], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, true]]);

        });

        it('puts the picker back and stops the spinner when the host refuses ⟳, saying which run holds the org (#537)', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod@example.com'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgNote: 'One org is hidden.', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1);
            const reasonsBefore = insertReasonsOf(panel);
            const buttonsBefore = insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled]);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(false);

            const refusalText = `An insert is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}`;
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 2, message: refusalText });
            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(false);

            // ONE REFUSAL PER CLICK: THE PICKER COMES BACK ONLY WITH THE ANSWER TO THE LAST
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: refusalText });
            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(false);
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: refusalText });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(true);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'Choose org…'], ['0', 'qa'], ['1', 'prod@example.com']]);
            expect(viewOf(panel, 'dataOrgSelect').value).toBe('0');
            expect(viewOf(panel, 'dataOrgType').textContent).toBe('Sandbox');
            expect(viewOf(panel, 'dataOrgHiddenNote').textContent).toBe('One org is hidden.');
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(refusalText);
            expect(insertReasonsOf(panel)).toEqual(reasonsBefore);
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual(buttonsBefore);

            // A LATER ANSWER FOR THE SAME SELECTION IS STILL DRAWN
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Scratch org', isSandbox: true, failureMessage: '', requestSequence: 1, renderSequence: 1 });
            expect(viewOf(panel, 'dataOrgType').textContent).toBe('Scratch org');

        });

        it('keeps checking when a ⟳ is refused while an earlier one is still being answered, and draws that answer when it comes (#537 review)', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'prod@example.com'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1);

            // THE FIRST ⟳ IS ACCEPTED: THE HOST HAS DROPPED ITS LIST AND SELECTION, AND IS ASKING THE CLI
            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            // THE SECOND IS REFUSED, A RUN HAVING TAKEN THE SELECTION MEANWHILE
            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: `A prompt asking for an org is open${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}` });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(false);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER]]);
            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT);

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['uat'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(true);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'Choose org…'], ['0', 'uat']]);

            // THE COUNT STARTS AGAIN WITH THE LIST: THE NEXT REFUSED ⟳ PUTS BACK WHAT THAT LIST DREW
            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: `An insert is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}` });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(true);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'Choose org…'], ['0', 'uat']]);

        });

        it('keeps a restored selection\'s failure on screen before the refusal (#537 review)', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Production', isSandbox: false, failureMessage: 'qa answered that it is Production.', requestSequence: 1, renderSequence: 1 });

            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            const refusalText = `An insert is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}`;
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: refusalText });

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe('qa answered that it is Production. ' + refusalText);
            expect(viewOf(panel, 'dataOrgStatus').classList.contains('failed')).toBe(true);
            expect(insertReasonsOf(panel)).toEqual(["Can't insert: qa answered that it is Production.", "Can't insert: qa answered that it is Production."]);

        });

        it('says a late refusal with no check on screen, and changes nothing else (#537 review)', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1);
            const reasonsBefore = insertReasonsOf(panel);

            const refusalText = `A metadata deploy is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}`;
            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: refusalText });

            expect(viewOf(panel, 'dataOrgStatus').textContent).toBe(refusalText);
            expect(optionsOf(viewOf(panel, 'dataOrgSelect'))).toEqual([['', 'Choose org…'], ['0', 'qa']]);
            expect(viewOf(panel, 'dataOrgSelect').value).toBe('0');
            expect(insertReasonsOf(panel)).toEqual(reasonsBefore);

        });

        it('asks for the orgs again after a refused first listing, once the run that held the org has ended (#537)', () => {

            const { panel } = renderDataOrgPanel();
            const [firstCard] = panel.treeCards();

            panel.chooseTreeCard(firstCard);
            expect(postedNamed(panel, 'loadDataOrgs')).toHaveLength(1);

            panel.postToPanel({ command: 'dataOrgListingRefused', renderSequence: 1, message: `A metadata deploy is using the selected org${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}` });

            expect(panel.isHidden(viewOf(panel, 'dataOrgSpinner'))).toBe(true);
            expect(panel.isHidden(viewOf(panel, 'dataOrgLoad'))).toBe(false);

            viewOf(panel, 'dataOrgLoad').dispatch('click');
            expect(postedNamed(panel, 'loadDataOrgs')).toHaveLength(2);

        });

        // #305: THE HOST JOINS A CHECK ALREADY IN FLIGHT, SO A SECOND CLICK STARTS NO SECOND "sf org list"
        it('keeps ⟳ enabled while the check is out, so a second click asks again', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            const refreshElements = panel.findAll(panel.cockpitBodyElement, 'dataOrgRefresh');
            expect(refreshElements).toHaveLength(1);
            refreshElements[0].dispatch('click');
            expect(refreshElements[0].disabled).toBe(false);
            refreshElements[0].dispatch('click');

            expect(postedNamed(panel, 'refreshDataOrgs')).toHaveLength(2);

        });

        it('after a ⟳ that forgets the org, leaves every insert asking for an org again, and draws nothing more of the old selection', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndReadiness(panel, 1);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [], selectedOrgIndex: null, noOrgsMessage: NO_AUTHORIZED_ORGS_MESSAGE, forgottenOrgNotice: 'The last org used, qa, is no longer connected.', hiddenOrgNote: '', renderSequence: 1 });

            const insertOffered = () => insertButtonsOf(panel).some((buttonElement: any) => buttonElement.textContent !== RECIPE_COCKPIT_INSERT_ACTION_LABEL);
            expect(insertOffered()).toBe(false);
            expect(insertReasonsOf(panel)).toEqual([RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE, RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE]);
            // #375: WITH NO ORG CHOSEN THE BUTTON STAYS ENABLED, AND A CLICK ASKS FOR THE ORG
            expect(insertButtonsOf(panel).map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([[RECIPE_COCKPIT_INSERT_ACTION_LABEL, false], [RECIPE_COCKPIT_INSERT_ACTION_LABEL, false]]);

            // AN ANSWER STILL ON ITS WAY FOR THE CLEARED SELECTION IS DROPPED
            postSelectionAndReadiness(panel, 1);
            expect(insertOffered()).toBe(false);

        });

        it('asks again for the next model drawn once the picker has been used, and never before', () => {

            const { panel, recipe } = renderDataOrgPanel();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });
            expect(postedNamed(panel, 'loadDataOrgs')).toEqual([]);

            panel.chooseTreeCard(panel.treeCards()[0]);
            expect(postedNamed(panel, 'loadDataOrgs')).toHaveLength(1);

            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });

            expect(postedNamed(panel, 'loadDataOrgs')).toHaveLength(2);
            // AFTER THE NEW MODEL'S ACK, SO THE HOST HAS ALREADY MADE ITS OBJECTS CHECKABLE
            const postedCommands = panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);
            expect(postedCommands.lastIndexOf('loadDataOrgs')).toBeGreaterThan(postedCommands.lastIndexOf('rendered'));

        });

        it('writes org labels and object names as text, never as markup', () => {

            const { panel } = renderDataOrgPanel();
            openTreecipeViews(panel);
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['<img src=x onerror=alert(1)>'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });

            expect(viewOf(panel, 'dataOrgSelect').children[1].textContent).toBe('<img src=x onerror=alert(1)>');

        });

    });

});
