import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    env: { openExternal: jest.fn() },
    window: {
        createWebviewPanel: jest.fn(),
        createQuickPick: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_UPDATER_BUSY_REFUSAL,
    RECIPE_COCKPIT_UPDATER_LIMIT_SKIPPED_REASON,
    RECIPE_COCKPIT_UPDATER_LOAD_LABEL,
    RECIPE_COCKPIT_UPDATER_LOADING_LABEL,
    RECIPE_COCKPIT_UPDATER_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_PREVIEW_ROW_LIMIT,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH } from '../RecipeCockpitTreeUpdaterQuery';
import { RECIPE_COCKPIT_QUERY_RECORD_CAP, RECIPE_COCKPIT_QUERY_VALUE_BUDGET } from '../RecipeCockpitQuery';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const accountTreeOf = (recipe: any) => recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY);

const loadRequest = (renderSequence: number, overrides: Record<string, unknown> = {}) => ({
    command: 'loadUpdaterRecords',
    treeKey: ACCOUNT_TREE_KEY,
    renderSequence: renderSequence,
    objects: [
        { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'], whereClause: '' },
        { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: 'LastName != null' },
        { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
    ],
    ...overrides
});

describe('RecipeCockpitService, the Treecipe Updater\'s load (#416)', () => {

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.dataOrgObjectApiNames = new Set(['Account', 'Contact', 'OtherChildObject__c']);
            return panelState;
        };

        const withSandbox = (panelState: IRecipeCockpitPanelState, isSandbox: boolean | null = true) => {
            panelState.dataOrgSelection = {
                orgIndex: 0,
                orgDetail: SANDBOX_ORG,
                requestSequence: 1,
                ...( isSandbox === null ? {} : { orgTypeDetail: { isSandbox: isSandbox, organizationType: isSandbox ? 'Developer Edition' : 'Enterprise Edition' } } )
            };
            return panelState;
        };

        const notRunning = (treeKey: string = ACCOUNT_TREE_KEY) => ({ command: 'updaterLoadState', isRunning: false, treeKey: treeKey });

        it('routes a load of the card\'s objects from the selected sandbox, with each object\'s fields and WHERE', () => {

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), withSandbox(buildPanelState()))).toEqual({
                kind: 'loadUpdaterRecords',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: 3,
                isOrgPrompted: false,
                requests: [
                    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: 'LastName != null' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            });

        });

        it('asks for the org, as the insert does, when none is chosen yet', () => {

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), buildPanelState())).toMatchObject({ kind: 'loadUpdaterRecords', isOrgPrompted: true });

            // A MODEL NOT YET CONFIRMED DRAWN HAS NO OBJECTS TO CHECK A PICK WITH
            const panelState = buildPanelState();
            panelState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), panelState)).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: notRunning() });

        });

        it('refuses an org that is not a sandbox, or has not answered yet, saying why', () => {

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), withSandbox(buildPanelState(), false))).toEqual({
                kind: 'refuseUpdaterLoad',
                refusalText: 'Records were not loaded: qa is not a sandbox or scratch org, and the Treecipe Updater reads only from a sandbox or scratch org.',
                hostMessage: notRunning()
            });
            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), withSandbox(buildPanelState(), null))).toMatchObject({
                kind: 'refuseUpdaterLoad',
                refusalText: expect.stringContaining('has not been checked yet')
            });

        });

        it.each([
            ['another model', { renderSequence: 2 }],
            ['a card it did not draw', { treeKey: 'Lead-ONLY' }],
            ['a card key that is not text', { treeKey: 7 }]
        ])('gives the button back and loads nothing for %s', (_description, overrides) => {

            const routed = RecipeCockpitService.routePanelMessage(loadRequest(3, overrides), withSandbox(buildPanelState()));
            expect(routed).toMatchObject({ kind: 'refuseUpdaterLoad', hostMessage: { command: 'updaterLoadState', isRunning: false } });
            expect(routed).not.toHaveProperty('refusalText');

        });

        it.each([
            ['an object of another card', [{ objectApiName: 'Lead', fieldApiNames: [] }]],
            ['a field the object does not list', [{ objectApiName: 'Account', fieldApiNames: ['LastName'] }]],
            ['no objects at all', []]
        ])('refuses the whole load for %s, saying so', (_description, objects) => {

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3, { objects: objects }), withSandbox(buildPanelState()))).toMatchObject({
                kind: 'refuseUpdaterLoad',
                refusalText: expect.stringMatching(/^Records were not loaded: /),
                hostMessage: notRunning()
            });

        });

        it('answers a load while one runs with the running state', () => {

            const panelState = withSandbox(buildPanelState());
            const runningState = { command: 'updaterLoadState' as const, isRunning: true, treeKey: 'Lead-ONLY' };
            panelState.updaterLoadStateMessage = runningState;

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), panelState)).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: runningState });

        });

        it.each([
            ['an insert', (panelState: IRecipeCockpitPanelState) => { panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a scratch org run', (panelState: IRecipeCockpitPanelState) => { panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true } as any; }],
            ['a permission set assignment', (panelState: IRecipeCockpitPanelState) => { panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a metadata deploy', (panelState: IRecipeCockpitPanelState) => { panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }; }],
            ['a query asking for an org', (panelState: IRecipeCockpitPanelState) => { panelState.isQueryOrgPromptOpen = true; }]
        ])('is refused while %s holds the org selection', (_description, holdSelection) => {

            const panelState = withSandbox(buildPanelState());
            holdSelection(panelState);

            expect(RecipeCockpitService.routePanelMessage(loadRequest(3), panelState)).toEqual({ kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_UPDATER_BUSY_REFUSAL, hostMessage: notRunning() });

        });

        it.each([
            ['selectDataOrg', { command: 'selectDataOrg', orgIndex: 0 }],
            ['loadDataOrgs', { command: 'loadDataOrgs' }],
            ['refreshDataOrgs', { command: 'refreshDataOrgs' }],
            ['createScratchOrg', { command: 'createScratchOrg' }],
            ['insertTree', { command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }],
            ['regenerateWithRecordTypes', { command: 'regenerateWithRecordTypes', treeKey: ACCOUNT_TREE_KEY, recordTypeSelection: {} }]
        ])('routes no %s while the load asks for its org, since the pick becomes the selection', (_description, panelMessage) => {

            const panelState = withSandbox(buildPanelState());
            panelState.dataOrgDetails = [SANDBOX_ORG];
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryAllowLists.recordTypeTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/recipe.yml');
            const routedFree = RecipeCockpitService.routePanelMessage(panelMessage, panelState);
            panelState.isUpdaterOrgPromptOpen = true;
            const routedHeld = RecipeCockpitService.routePanelMessage(panelMessage, panelState);

            expect(routedHeld).not.toEqual(routedFree);
            expect(routedHeld === undefined || /^refuse|^post/.test((routedHeld as any).kind)).toBe(true);

        });

    });

    describe('the host, against a faked org selection and connection', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let storedWorkspaceState: Map<string, unknown>;
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let connectionSpy: jest.SpyInstance;
        let sentQueries: string[];
        let queryAnswer: (soql: string) => Promise<unknown>;
        let cancellationToken: { isCancellationRequested: boolean };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([warningText]) => warningText);
        const informations = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([informationText]) => informationText);

        const selectSandbox = () => {
            panelState().dataOrgDetails = [SANDBOX_ORG];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
        };

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const recordsOf = (objectApiName: string, count: number) => Array.from({ length: count }, (_value, recordIndex) => ({
            attributes: { type: objectApiName },
            Id: `${objectApiName}-${recordIndex}`,
            Name: `${objectApiName} ${recordIndex}`
        }));

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-updater-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();

            postedPanelMessages = [];
            sentQueries = [];
            storedWorkspaceState = new Map();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };
            queryAnswer = async (soql: string) => {
                const objectApiName = /FROM (\w+)/.exec(soql)![1];
                const records = recordsOf(objectApiName, objectApiName === 'Contact' ? 25 : 2);
                return { totalSize: records.length, done: true, records: records };
            };

            cancellationToken = { isCancellationRequested: false };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockReset();

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
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation((warningText: string) => { vscode.window.showWarningMessage(warningText); });
            jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation((informationText: string) => { vscode.window.showInformationMessage(informationText); });
            connectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => { sentQueries.push(soql); return await queryAnswer(soql); },
                queryMore: async () => { throw new Error('no more pages'); }
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads one SELECT per tree object, built from the tree, from the selected sandbox by its username', async () => {

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(connectionSpy).toHaveBeenCalledTimes(1);
            expect(connectionSpy).toHaveBeenCalledWith(SANDBOX_ORG.username);
            expect(sentQueries).toHaveLength(3);
            expect(sentQueries[0]).toMatch(/^SELECT Id, (\w+, )*Legacy_Code__c FROM Account$/);
            expect(sentQueries[0]).toContain('ParentId');
            expect(sentQueries[1]).toBe('SELECT Id, AccountId, LastName FROM Contact WHERE LastName != null');
            expect(sentQueries[2]).toBe('SELECT Id, Contact__c FROM OtherChildObject__c');

        });

        it('holds the records on the host and posts only counts and a preview, then says how it went once', async () => {

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(29);

            const [recordsMessage] = postedNamed('updaterRecords');
            expect(recordsMessage).toMatchObject({ command: 'updaterRecords', renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa · qa@example.com.qa' });
            const contactRecords = recordsMessage.objects.find((loadedObject: any) => loadedObject.objectApiName === 'Contact');
            expect(contactRecords).toMatchObject({ totalSize: 25, recordCount: 25, isTruncated: false, columns: ['Id', 'Name'], hiddenColumnCount: 0 });
            expect(contactRecords.rows).toHaveLength(RECIPE_COCKPIT_UPDATER_PREVIEW_ROW_LIMIT);
            expect(contactRecords.rows[0]).toEqual(['Contact-0', 'Contact 0']);
            expect(JSON.stringify(recordsMessage)).not.toContain('attributes');

            expect(postedNamed('updaterLoadState').map(stateMessage => stateMessage.isRunning)).toEqual([true, false]);
            expect(informations()).toEqual(['Loaded 29 records of Account-thru-OtherChildObject__c from qa · qa@example.com.qa.']);
            expect(warnings()).toEqual([]);

        });

        it('keeps an object the org refuses as that object\'s, and names it in a warning', async () => {

            queryAnswer = async (soql: string) => {
                if ( soql.includes('FROM Contact') ) { throw new Error('No such column \'LastName\' on entity \'Contact\''); }
                return { totalSize: 1, done: true, records: recordsOf('Account', 1) };
            };

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            const [recordsMessage] = postedNamed('updaterRecords');
            expect(recordsMessage.objects.find((loadedObject: any) => loadedObject.objectApiName === 'Contact')).toMatchObject({ recordCount: 0, failureMessage: 'No such column \'LastName\' on entity \'Contact\'' });
            expect(recordsMessage.objects.find((loadedObject: any) => loadedObject.objectApiName === 'Account')).toMatchObject({ recordCount: 1 });
            expect(warnings()).toEqual([expect.stringContaining('Contact could not be read')]);

        });

        it('sends nothing for a WHERE that would be a second statement, and gives the button back', async () => {

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence(), { objects: [{ objectApiName: 'Account', fieldApiNames: [], whereClause: 'Name = \'A\'; DELETE' }] }));

            expect(connectionSpy).not.toHaveBeenCalled();
            expect(sentQueries).toEqual([]);
            expect(warnings()).toEqual([expect.stringMatching(/^Records were not loaded: The query for Account was not sent/)]);
            expect(postedNamed('updaterLoadState').at(-1)).toEqual({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('says a connection could not be opened with a fixed warning, and keeps nothing', async () => {

            connectionSpy.mockRejectedValue(new Error('https://login.example.com/?token=secret'));

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(warnings()).toEqual([expect.stringMatching(/^Records were not loaded: qa · qa@example\.com\.qa could not be connected to\./)]);
            expect(warnings()[0]).not.toContain('secret');
            expect(postedNamed('updaterRecords')).toEqual([]);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);

        });

        it('keeps nothing when the reader cancels', async () => {

            cancellationToken.isCancellationRequested = true;

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(sentQueries).toEqual([]);
            expect(postedNamed('updaterRecords')).toEqual([]);
            expect(warnings()).toEqual([expect.stringContaining('was cancelled, so none were kept')]);

        });

        it('asks for the org through the insert\'s prompt when none is chosen, then reads from the pick', async () => {

            const promptOpenStates: unknown[] = [];
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (listing: any) => {
                promptOpenStates.push(panelState().isUpdaterOrgPromptOpen);
                return (await listing).orgDetails[0];
            });
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgReasonCounts: {} } as any);
            const selectSpy = jest.spyOn(RecipeCockpitService as any, 'selectDataOrg').mockImplementation(async (_cockpitPanel: any, selectedPanelState: any, orgIndex: any) => {
                selectedPanelState.dataOrgSelection = { orgIndex: orgIndex, orgDetail: selectedPanelState.dataOrgDetails[orgIndex], requestSequence: 2, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            });

            await openCockpit();
            await send(loadRequest(lastRenderSequence()));

            expect(promptSpy).toHaveBeenCalledWith(expect.anything(), RECIPE_COCKPIT_UPDATER_ORG_PLACEHOLDER);
            // THE PROMPT HOLDS THE ORG SELECTION WHILE IT IS OPEN, AND LETS IT GO ONCE ANSWERED
            expect(promptOpenStates).toEqual([true]);
            expect(panelState().isUpdaterOrgPromptOpen).toBe(false);
            expect(selectSpy).toHaveBeenCalledTimes(1);
            expect(postedNamed('dataOrgList').at(-1)).toMatchObject({ selectedOrgIndex: 0 });
            expect(sentQueries).toHaveLength(3);
            expect(postedNamed('updaterRecords')).toHaveLength(1);

        });

        it('reads nothing when the prompt is dismissed, or the pick is not a sandbox', async () => {

            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgReasonCounts: {} } as any);
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValue(undefined);
            jest.spyOn(RecipeCockpitService as any, 'selectDataOrg').mockImplementation(async (_cockpitPanel: any, selectedPanelState: any, orgIndex: any) => {
                selectedPanelState.dataOrgSelection = { orgIndex: orgIndex, orgDetail: selectedPanelState.dataOrgDetails[orgIndex], requestSequence: 2, orgTypeDetail: { isSandbox: false, organizationType: 'Enterprise Edition' } };
            });

            await openCockpit();
            await send(loadRequest(lastRenderSequence()));
            expect(sentQueries).toEqual([]);
            expect(warnings()).toEqual([]);

            promptSpy.mockImplementation(async (listing: any) => (await listing).orgDetails[0]);
            await send(loadRequest(lastRenderSequence()));
            expect(sentQueries).toEqual([]);
            expect(warnings()).toEqual(['Records were not loaded: qa is not a sandbox or scratch org, and the Treecipe Updater reads only from a sandbox or scratch org.']);
            expect(postedNamed('updaterLoadState').at(-1)).toMatchObject({ isRunning: false });

        });

        it('warns and gives the button back when the router refuses, reading nothing', async () => {

            await openCockpit();
            selectSandbox();
            panelState().dataOrgSelection!.orgTypeDetail = { isSandbox: false, organizationType: 'Enterprise Edition' };
            await send(loadRequest(lastRenderSequence()));

            expect(connectionSpy).not.toHaveBeenCalled();
            expect(warnings()).toEqual(['Records were not loaded: qa is not a sandbox or scratch org, and the Treecipe Updater reads only from a sandbox or scratch org.']);
            expect(postedNamed('updaterLoadState')).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);

        });

        it('answers a load that reaches the host while another runs with the run\'s state, and a reopened panel adopts it', async () => {

            const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' };

            await openCockpit();
            selectSandbox();
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            await send(loadRequest(lastRenderSequence()));
            expect(sentQueries).toEqual([]);
            expect(postedNamed('updaterLoadState')).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);

            (RecipeCockpitService as any).updaterLoadRunStateMessage = runningState;
            await send(loadRequest(lastRenderSequence()));
            expect(postedNamed('updaterLoadState').at(-1)).toEqual(runningState);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            postedPanelMessages = [];
            await openCockpit();
            expect(panelState().updaterLoadStateMessage).toEqual(runningState);
            expect(postedNamed('updaterLoadState')).toContainEqual(runningState);

        });

        it('reads every page of an object, and keeps nothing when the reader cancels between pages', async () => {

            queryAnswer = async (soql: string) => {
                const objectApiName = /FROM (\w+)/.exec(soql)![1];
                return { totalSize: 3, done: false, nextRecordsUrl: `/next/${objectApiName}`, records: recordsOf(objectApiName, 2) };
            };
            const queryMoreSpy = jest.fn(async (nextRecordsUrl: string) => ({ totalSize: 3, done: true, records: recordsOf(nextRecordsUrl.split('/').pop()!, 1) }));
            connectionSpy.mockImplementation(async () => ({
                query: async (soql: string) => { sentQueries.push(soql); return await queryAnswer(soql); },
                queryMore: queryMoreSpy
            }) as any);

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(queryMoreSpy).toHaveBeenCalledTimes(3);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(9);

            queryAnswer = async (soql: string) => {
                cancellationToken.isCancellationRequested = true;
                return { totalSize: 3, done: false, nextRecordsUrl: '/next/Account', records: recordsOf('Account', 2) };
            };
            (vscode.window.showWarningMessage as jest.Mock).mockClear();
            await send(loadRequest(lastRenderSequence()));

            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);
            expect(warnings()).toEqual([expect.stringContaining('was cancelled, so none were kept')]);

        });

        it('stops at the value budget the whole load shares, and says so', async () => {

            queryAnswer = async (soql: string) => {
                const objectApiName = /FROM (\w+)/.exec(soql)![1];
                const records = objectApiName === 'Account'
                    ? [{ attributes: { type: 'Account' }, Id: 'a', Big: new Array(RECIPE_COCKPIT_QUERY_VALUE_BUDGET).fill(1) }]
                    : recordsOf(objectApiName, 1);
                return { totalSize: records.length, done: true, records: records };
            };

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            const [recordsMessage] = postedNamed('updaterRecords');
            expect(recordsMessage.objects.find((loadedObject: any) => loadedObject.objectApiName === 'Account')).toMatchObject({ recordCount: 0, totalSize: 1, isTruncated: true });
            expect(warnings()).toEqual([expect.stringContaining('and stopped there')]);
            expect(informations()).toEqual([]);

        });

        it('holds the whole load to one record cap, and reads no object past it, saying which', async () => {

            queryAnswer = async (soql: string) => {
                const objectApiName = /FROM (\w+)/.exec(soql)![1];
                const records = recordsOf(objectApiName, objectApiName === 'Account' ? RECIPE_COCKPIT_QUERY_RECORD_CAP : 1);
                return { totalSize: records.length, done: true, records: records };
            };

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(sentQueries).toHaveLength(1);
            const [recordsMessage] = postedNamed('updaterRecords');
            expect(recordsMessage.objects.map((loadedObject: any) => [loadedObject.objectApiName, loadedObject.skippedReason])).toEqual([
                ['Account', undefined],
                ['Contact', RECIPE_COCKPIT_UPDATER_LIMIT_SKIPPED_REASON],
                ['OtherChildObject__c', RECIPE_COCKPIT_UPDATER_LIMIT_SKIPPED_REASON]
            ]);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(RECIPE_COCKPIT_QUERY_RECORD_CAP);
            expect(warnings()).toEqual([expect.stringContaining('and stopped there')]);

        });

        it('lets the last load\'s records go as a new one starts, so a cancelled load leaves none on screen or replayed', async () => {

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBeGreaterThan(0);

            cancellationToken.isCancellationRequested = true;
            await send(loadRequest(lastRenderSequence()));
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);

            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('updaterRecords')).toEqual([]);

        });

        it('keeps nothing when the org selection changed while the records were read', async () => {

            queryAnswer = async (soql: string) => {
                panelState().dataOrgSelection = { orgIndex: 0, orgDetail: { ...SANDBOX_ORG, username: 'other@example.com.qa' }, requestSequence: 2, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
                return { totalSize: 1, done: true, records: recordsOf('Account', 1) };
            };

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(postedNamed('updaterRecords')).toEqual([]);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);
            expect(warnings()).toEqual([expect.stringContaining('were not kept: the run or the org on screen changed')]);

        });

        it('checks again at the run what the router checked at the click, reading nothing when it no longer holds', async () => {

            await openCockpit();
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            const runLoad = async (overrides: Record<string, unknown>) => await (RecipeCockpitService as any).loadUpdaterRecordsFromPanel(cockpitPanel, panelState(), {
                kind: 'loadUpdaterRecords',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                requests: [{ objectApiName: 'Account', fieldApiNames: [], whereClause: '' }],
                isOrgPrompted: false,
                ...overrides
            });

            // NO SANDBOX SELECTED ANY MORE
            await runLoad({});
            // ANOTHER MODEL, AND A CARD THE MODEL DOES NOT HOLD
            selectSandbox();
            await runLoad({ renderSequence: -1 });
            await runLoad({ treeKey: 'No-Such-Tree' });
            expect(connectionSpy).not.toHaveBeenCalled();
            expect(warnings()).toEqual([]);

            // AN OBJECT NO LONGER IN THE TREE
            await runLoad({ requests: [{ objectApiName: 'Lead', fieldApiNames: [], whereClause: '' }] });
            expect(connectionSpy).not.toHaveBeenCalled();
            expect(warnings()).toEqual(['Records were not loaded: Lead is no longer in this treecipe.']);
            expect(postedNamed('updaterLoadState').map(stateMessage => stateMessage.isRunning)).toEqual([true, false, true, false, true, false, true, false]);

        });

        it('names an org with no alias by its username and a renamed card by its name, and counts one record as one', async () => {

            queryAnswer = async (soql: string) => ({ totalSize: soql.includes('FROM Account') ? 1 : 0, done: true, records: soql.includes('FROM Account') ? recordsOf('Account', 1) : [] });

            await openCockpit();
            selectSandbox();
            panelState().dataOrgSelection!.orgDetail = { targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa' };
            accountTreeOf(panelState().recipeDataMessage!.recipe).customName = 'Accounts';
            await send(loadRequest(lastRenderSequence()));

            expect(postedNamed('updaterRecords')[0].orgLabel).toBe('qa@example.com.qa');
            expect(informations()).toEqual(['Loaded 1 record of Accounts from qa@example.com.qa.']);

        });

        it('keeps nothing when the org selection was cleared while the records were read', async () => {

            queryAnswer = async () => {
                panelState().dataOrgSelection = undefined;
                return { totalSize: 1, done: true, records: recordsOf('Account', 1) };
            };

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));

            expect(postedNamed('updaterRecords')).toEqual([]);
            expect(warnings()).toEqual([expect.stringContaining('were not kept')]);

        });

        it('replays the records on a reveal of the same model, and lets them go with a new model', async () => {

            await openCockpit();
            selectSandbox();
            await send(loadRequest(lastRenderSequence()));
            const [recordsMessage] = postedNamed('updaterRecords');

            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('updaterRecords')).toEqual([recordsMessage]);
            expect(postedNamed('updaterLoadState')).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);

            await openCockpit();
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);
            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('updaterRecords')).toEqual([]);

        });

    });

    describe('the panel script', () => {

        const renderUpdater = () => {
            const recipe = loadTreeRecipe();
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
            return { panel, accountCard, updaterPanel, recipe };
        };

        const objectNamed = (panel: any, updaterPanel: any, objectApiName: string) => panel.findAll(updaterPanel, 'updaterObject')
            .find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === objectApiName);

        const expand = (panel: any, objectElement: any) => panel.findAll(objectElement.children[0], 'updaterObjectToggle')[0].dispatch('click');

        const rowNamed = (panel: any, objectElement: any, fieldApiName: string) => panel.findAll(objectElement, 'updaterField')
            .find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

        const recordsMessage = (overrides: Record<string, unknown> = {}) => ({
            command: 'updaterRecords',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            orgLabel: 'qa · qa@example.com.qa',
            objects: [
                { objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id', 'Name'], rows: [['001A', '<b>Acme</b>'], ['001B', 'Globex']], hiddenColumnCount: 0 },
                { objectApiName: 'Contact', totalSize: 0, recordCount: 0, isTruncated: false, columns: [], rows: [], hiddenColumnCount: 0, failureMessage: 'No such column' },
                { objectApiName: 'OtherChildObject__c', totalSize: 900, recordCount: 50, isTruncated: true, columns: ['Id'], rows: Array.from({ length: 10 }, () => ['a0X']), hiddenColumnCount: 0 }
            ],
            ...overrides
        });

        it('posts every object with its chosen fields and the WHERE typed, and holds every Load records button until the host answers', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            expand(panel, accountObject);
            expand(panel, contactObject);
            panel.findAll(rowNamed(panel, accountObject, 'Legacy_Code__c'), 'updaterFieldChoose')[0].dispatch('click');
            const whereInput = panel.findAll(contactObject, 'updaterWhereInput')[0];
            expect(whereInput.attributes['aria-label']).toBe('WHERE for Contact records');
            expect(whereInput.attributes['maxlength']).toBe(String(RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH));
            whereInput.value = 'LastName != null';
            whereInput.dispatch('input');

            const loadButton = panel.findAll(updaterPanel, 'updaterLoad')[0];
            expect(loadButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_LOAD_LABEL);
            expect(loadButton.className).toContain('sdtButton-primary');
            loadButton.dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadUpdaterRecords')).toEqual([{
                command: 'loadUpdaterRecords',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: 1,
                objects: [
                    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: [], whereClause: 'LastName != null' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            }]);
            expect(loadButton.disabled).toBe(true);
            expect(loadButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_LOADING_LABEL);

            // A SECOND CLICK WHILE IT RUNS POSTS NOTHING
            loadButton.dispatch('click');
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadUpdaterRecords')).toHaveLength(1);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(loadButton.disabled).toBe(false);
            expect(loadButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_LOAD_LABEL);

        });

        it('draws each object\'s records as counts, a preview table and why one could not be read, all as text', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            const otherObject = objectNamed(panel, updaterPanel, 'OtherChildObject__c');
            expand(panel, accountObject);

            panel.postToPanel(recordsMessage());

            expect(panel.findAll(updaterPanel, 'updaterLoadNote')[0].textContent).toBe('Loaded 52 records from qa · qa@example.com.qa');
            expect(panel.findAll(accountObject.children[0], 'updaterObjectCount')[0].textContent).toMatch(/ · 2 records$/);
            expect(panel.findAll(contactObject.children[0], 'updaterObjectCount')[0].textContent).toMatch(/ · not read$/);

            const accountRecords = panel.findAll(accountObject, 'updaterRecords')[0];
            expect(panel.isHidden(accountRecords)).toBe(false);
            expect(panel.findAll(accountRecords, 'updaterRecordsSummary')[0].textContent).toBe('2 records');
            const cells = panel.findAll(accountRecords, 'treeQueryRow').map((rowElement: any) => rowElement.children.map((cellElement: any) => cellElement.textContent));
            expect(cells).toEqual([['001A', '<b>Acme</b>'], ['001B', 'Globex']]);
            expect(panel.findAll(accountRecords, 'b')).toEqual([]);

            // AN OBJECT OPENED AFTER THE RECORDS ARRIVED DRAWS THEM WHEN ITS BODY IS BUILT
            expand(panel, contactObject);
            expect(panel.findAll(contactObject, 'updaterRecordsFailure')[0].textContent).toBe('Could not be read: No such column');
            expand(panel, otherObject);
            expect(panel.findAll(otherObject, 'updaterRecordsSummary')[0].textContent).toBe('50 records, the first of 900 it matched. Showing the first 10');

        });

        it('says an object past the load\'s limit was not read, and clears every card\'s records when a load starts', () => {

            const { panel, updaterPanel } = renderUpdater();
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            expand(panel, contactObject);

            panel.postToPanel(recordsMessage({ objects: [
                { objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id'], rows: [['001A'], ['001B']], hiddenColumnCount: 0 },
                { objectApiName: 'Contact', totalSize: 0, recordCount: 0, isTruncated: true, columns: [], rows: [], hiddenColumnCount: 0, skippedReason: 'Not read: the limit' }
            ] }));

            expect(panel.findAll(contactObject, 'updaterRecordsSkipped')[0].textContent).toBe('Not read: the limit');
            expect(panel.findAll(contactObject.children[0], 'updaterObjectCount')[0].textContent).toMatch(/ · not read$/);
            expect(panel.findAll(updaterPanel, 'updaterLoadNote')[0].textContent).toBe('Loaded 2 records from qa · qa@example.com.qa');

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' });

            expect(panel.findAll(updaterPanel, 'updaterLoadNote')[0].textContent).toBe('');
            expect(panel.findAll(contactObject.children[0], 'updaterObjectCount')[0].textContent).not.toMatch(/not read/);
            expect(panel.findAll(contactObject, 'updaterRecordsSkipped').filter((skippedElement: any) => !panel.isHidden(skippedElement))).toEqual([]);

        });

        it('draws records only on the model they were loaded on, and draws them on a tab built later', () => {

            const recipe = loadTreeRecipe();
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();

            panel.postToPanel(recordsMessage({ renderSequence: 2 }));
            panel.postToPanel(recordsMessage());

            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];

            expect(panel.findAll(updaterPanel, 'updaterLoadNote')[0].textContent).toBe('Loaded 52 records from qa · qa@example.com.qa');

            const stalePanel = renderUpdater();
            stalePanel.panel.postToPanel(recordsMessage({ renderSequence: 2 }));
            expect(stalePanel.panel.findAll(stalePanel.updaterPanel, 'updaterLoadNote')[0].textContent).toBe('');

        });

        it('holds the button of every card while another card loads, and keeps the WHERE out of the saved place', () => {

            const { panel, updaterPanel, accountCard } = renderUpdater();
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            expand(panel, contactObject);
            const whereInput = panel.findAll(contactObject, 'updaterWhereInput')[0];
            whereInput.value = 'LastName = \'Secret\'';
            whereInput.dispatch('input');

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' });
            const loadButton = panel.findAll(updaterPanel, 'updaterLoad')[0];
            expect(loadButton.disabled).toBe(true);
            expect(loadButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_LOAD_LABEL);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'last');
            expect(JSON.stringify(panel.savedState())).not.toContain('Secret');

        });

    });

});
