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
    RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { NO_AUTHORIZED_ORGS_MESSAGE, ORG_TYPE_UNKNOWN_LABEL, SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const TREE_OBJECT_API_NAMES = ['Account', 'Contact', 'OtherChildObject__c', 'Lead'];

const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const SECOND_ORG = { targetOrgIdentifier: 'prod@example.com', username: 'prod@example.com', alias: undefined as string | undefined };

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

        it('refreshes only a selection that exists', () => {

            const panelState = buildRenderedPanelState();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toBeUndefined();

            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toEqual({ kind: 'refreshDataOrgCounts' });

        });

    });

    describe('the open panel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceStateValues: Map<string, unknown>;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

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
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG, SECOND_ORG], hiddenOrgCount: 0 });

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

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [], hiddenOrgCount: 0 });

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

        it('lists only the orgs the CLI knows are not production, and says how many it left out', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgCount: 2 });

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: ['qa'], hiddenOrgCount: 2, noOrgsMessage: '' });

        });

        it('says no sandbox is authorized when every authorized org was left out', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [], hiddenOrgCount: 1 });

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], hiddenOrgCount: 1, noOrgsMessage: RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE });

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

        it('joins the view switch between Recipe Trees and the Classic list, and asks for the orgs once, when it is first shown', () => {

            const { panel } = renderDataOrgPanel();

            expect(textOf(panel, 'viewButton')).toEqual(['Recipe Trees', 'Data-by-Org', 'Classic list']);
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

        it('says how many authorized orgs it left out, and why', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgCount: 2, renderSequence: 1 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(false);
            expect(viewOf(panel, 'dataOrgHiddenNote').textContent).toBe('2 authorized orgs are not listed: Data-by-Org connects only to orgs the Salesforce CLI knows as a sandbox or a scratch org, never to production.');

            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', hiddenOrgCount: 0, renderSequence: 1 });
            expect(panel.isHidden(viewOf(panel, 'dataOrgHiddenNote'))).toBe(true);

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

        it('posts ⟳ as a payload-free refresh', () => {

            const { panel } = renderDataOrgPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            postSelectionAndCounts(panel, 1, 1);

            viewOf(panel, 'dataOrgRefresh').dispatch('click');

            expect(postedNamed(panel, 'refreshDataOrgCounts')).toEqual([{ command: 'refreshDataOrgCounts' }]);

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
