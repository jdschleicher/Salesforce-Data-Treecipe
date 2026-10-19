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

import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY,
    RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL,
    RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_QUERY_TAB_LABEL,
    RECIPE_COCKPIT_TREE_TABS
} from '../RecipeCockpitService';
import { RECIPE_COCKPIT_QUERY_RECORD_CAP, RecipeCockpitQuery } from '../RecipeCockpitQuery';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const TREE_WRAPPER_FILE_PATH = path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, 'treecipeObjectsWrapper-2026-09-20T10-00-00.json');

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_TREE_OBJECTS = ['Account', 'Contact', 'OtherChildObject__c'];
const PROD_USERNAME = 'admin@example.com';
const PROD_ORG = { targetOrgIdentifier: 'prod', username: PROD_USERNAME, alias: 'prod' };

const ACCOUNT_TREE_QUERIES = RecipeCockpitQuery.listTreeQueries(JSON.parse(fs.readFileSync(TREE_WRAPPER_FILE_PATH, 'utf-8')), ACCOUNT_TREE_OBJECTS);
const CONTACT_BASE_QUERY = ACCOUNT_TREE_QUERIES.find(treeQuery => treeQuery.queryKey === 'Contact:base:0')!;

describe('RecipeCockpitService, the Query tab (#367)', () => {

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        it('is a tab a saved place can name, after Troubleshooting, keeping its search only when there is one', () => {

            expect(RECIPE_COCKPIT_TREE_TABS).toEqual(['treecipe', 'datasets', 'troubleshooting', 'query']);

            const treePlace = (searchQueries: Record<string, string>) => ({
                version: 2,
                runFolderName: TREE_RUN_FOLDER_NAME,
                scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'query', searchQueries: searchQueries, expandedObjectKeys: [], openPicklistKeys: [] }]
            });

            expect(RecipeCockpitService.normalizePanelPlace(treePlace({ treecipe: '', datasets: '', query: 'contact' }))?.trees[0]).toMatchObject({ selectedTab: 'query', searchQueries: { query: 'contact' } });
            expect(RecipeCockpitService.normalizePanelPlace(treePlace({ treecipe: '', datasets: '' }))?.trees[0].searchQueries).not.toHaveProperty('query');

        });

        it('routes a load only for a card the panel confirmed drawing, on the model on screen', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTreeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 }, panelState))
                .toEqual({ kind: 'loadTreeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTreeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTreeQueries', treeKey: 'Lead-ONLY', renderSequence: 3 }, panelState)).toBeUndefined();

        });

        it('routes a save and a run with the key and the text alone, never an org the message names', () => {

            const panelState = buildPanelState();
            const queryMessage = { treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact', orgIndex: 0, username: PROD_USERNAME };

            expect(RecipeCockpitService.routePanelMessage({ command: 'saveTreeQueryEdit', ...queryMessage } as any, panelState))
                .toEqual({ kind: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'runTreeQuery', ...queryMessage } as any, panelState))
                .toEqual({ kind: 'runTreeQuery', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' });

        });

        it('refuses a key, text or format of the wrong shape, giving a run\'s button back', () => {

            const panelState = buildPanelState();
            const notRunning = (treeKey: string, queryKey: string) => ({ kind: 'postTreeQueryState', hostMessage: { command: 'treeQueryState', isRunning: false, treeKey: treeKey, queryKey: queryKey } });

            expect(RecipeCockpitService.routePanelMessage({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'x'.repeat(100001) }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: '', queryText: '' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'runTreeQuery', treeKey: 'Lead-ONLY', queryKey: 'Lead:base:0', queryText: 'SELECT Id FROM Lead' }, panelState)).toEqual(notRunning('Lead-ONLY', 'Lead:base:0'));
            expect(RecipeCockpitService.routePanelMessage({ command: 'runTreeQuery', treeKey: ACCOUNT_TREE_KEY, queryKey: 7, queryText: 'SELECT Id FROM Contact' }, panelState)).toEqual(notRunning(ACCOUNT_TREE_KEY, ''));
            expect(RecipeCockpitService.routePanelMessage({ command: 'runTreeQuery', treeKey: 7, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' }, panelState)).toEqual(notRunning('', 'Contact:base:0'));
            expect(RecipeCockpitService.routePanelMessage({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'xlsx' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'exportTreeQueryResult', treeKey: 'Lead-ONLY', queryKey: 'Lead:base:0', exportFormat: 'csv' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' }, panelState))
                .toEqual({ kind: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });

        });

        it('answers a run while one runs with the running state, and is held by nothing else that runs', () => {

            const panelState = buildPanelState();
            const runMessage = { command: 'runTreeQuery', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' };

            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' };
            expect(RecipeCockpitService.routePanelMessage(runMessage, panelState)).toMatchObject({ kind: 'runTreeQuery' });

            const runningState = { command: 'treeQueryState' as const, isRunning: true, treeKey: 'Lead-ONLY', queryKey: 'Lead:base:0' };
            panelState.treeQueryStateMessage = runningState;
            expect(RecipeCockpitService.routePanelMessage(runMessage, panelState)).toEqual({ kind: 'postTreeQueryState', hostMessage: runningState });

        });

    });

    describe('the host, against a faked org prompt and connection', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let storedWorkspaceState: Map<string, unknown>;
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let promptSpy: jest.SpyInstance;
        let connectionSpy: jest.SpyInstance;
        let sentQueries: string[];
        let queryAnswer: (soql: string) => Promise<unknown>;
        let queryMoreAnswer: (nextRecordsUrl: string) => Promise<unknown>;
        let cancellationToken: { isCancellationRequested: boolean };
        let notificationAnswer: string | undefined;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const notifications = () => [
            ...(vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([text, ...actions]) => ({ severity: 'information', text: text, actions: actions })),
            ...(vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([text, ...actions]) => ({ severity: 'warning', text: text, actions: actions }))
        ];
        const resultsFolderPath = () => path.join(path.resolve(workspaceRoot), 'treecipe', 'QueryResults');

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const loadQueries = async () => {
            await send({ command: 'loadTreeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            return postedNamed('treeQueries').at(-1);
        };

        const run = (queryText: string = CONTACT_BASE_QUERY.text, queryKey = 'Contact:base:0') => send({ command: 'runTreeQuery', treeKey: ACCOUNT_TREE_KEY, queryKey: queryKey, queryText: queryText });

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-query-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitService as any).isTreeQueryInFlight = false;
            (RecipeCockpitService as any).treeQueryRunStateMessage = undefined;
            RecipeCockpitService.clearHeldTreeQueryResult();
            RecipeCockpitService.clearTreeQueryLists();

            postedPanelMessages = [];
            sentQueries = [];
            notificationAnswer = undefined;
            storedWorkspaceState = new Map();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };
            queryAnswer = async () => ({
                totalSize: 2,
                done: true,
                records: [
                    { attributes: { type: 'Contact' }, Id: '003000000000001AAA', LastName: 'Smith', AccountId: null },
                    { attributes: { type: 'Contact' }, Id: '003000000000002AAA', LastName: '=cmd', AccountId: '001000000000001AAA' }
                ]
            });
            queryMoreAnswer = async () => { throw new Error('no more pages'); };

            (execFile as unknown as jest.Mock).mockReset();

            cancellationToken = { isCancellationRequested: false };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => notificationAnswer);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async () => notificationAnswer);

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
            promptSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(PROD_ORG);
            connectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => { sentQueries.push(soql); return await queryAnswer(soql); },
                queryMore: async (nextRecordsUrl: string) => await queryMoreAnswer(nextRecordsUrl)
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('posts the tree\'s generated queries when the tab asks, and contacts no org to open the panel or read them', async () => {

            await openCockpit();
            const queriesMessage = await loadQueries();

            expect(queriesMessage).toMatchObject({ command: 'treeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            expect(queriesMessage.failureMessage).toBeUndefined();
            expect(queriesMessage.queries.map((treeQuery: any) => treeQuery.queryKey)).toEqual(ACCOUNT_TREE_QUERIES.map(treeQuery => treeQuery.queryKey));
            expect(queriesMessage.queries.find((treeQuery: any) => treeQuery.queryKey === 'Contact:base:0')).toEqual({
                queryKey: 'Contact:base:0',
                objectApiName: 'Contact',
                kindLabel: 'Base Query',
                notes: [],
                generatedText: CONTACT_BASE_QUERY.text
            });
            expect(promptSpy).not.toHaveBeenCalled();
            expect(connectionSpy).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();

        });

        it('keeps an edit across loads and reopens, and Reset (an empty or generated text) removes it', async () => {

            await openCockpit();
            await loadQueries();

            await send({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact LIMIT 5' });
            expect(storedWorkspaceState.get(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY)).toEqual({ version: 1, editsByFolderName: { [ACCOUNT_TREE_KEY]: { 'Contact:base:0': { generatedText: CONTACT_BASE_QUERY.text, editedText: 'SELECT Id FROM Contact LIMIT 5' } } } });

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            await openCockpit();
            expect((await loadQueries()).queries.find((treeQuery: any) => treeQuery.queryKey === 'Contact:base:0').editedText).toBe('SELECT Id FROM Contact LIMIT 5');

            await send({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: CONTACT_BASE_QUERY.text });
            expect(storedWorkspaceState.get(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY)).toEqual({ version: 1, editsByFolderName: {} });
            expect((await loadQueries()).queries.find((treeQuery: any) => treeQuery.queryKey === 'Contact:base:0')).not.toHaveProperty('editedText');

            // A KEY THE HOST DID NOT READ FOR THE TREE WRITES NOTHING
            workspaceState.update.mockClear();
            await send({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Lead:base:0', queryText: 'SELECT Id FROM Lead' });
            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY, expect.anything());

        });

        it('drops an edit, rather than drawing it on another query, once its key generates other text (a regeneration moved it)', async () => {

            const accountChildToParent = ACCOUNT_TREE_QUERIES.find(treeQuery => treeQuery.queryKey === 'Account:childToParent:0')!;
            storedWorkspaceState.set(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY, {
                version: 1,
                editsByFolderName: { [ACCOUNT_TREE_KEY]: {
                    'Account:childToParent:0': { generatedText: 'SELECT Id, ParentId FROM Account', editedText: 'SELECT Id, ParentId FROM Account LIMIT 3' },
                    'Contact:base:0': { generatedText: CONTACT_BASE_QUERY.text, editedText: 'SELECT Id FROM Contact LIMIT 2' }
                } }
            });

            await openCockpit();
            const queries = (await loadQueries()).queries;

            expect(queries.find((treeQuery: any) => treeQuery.queryKey === 'Account:childToParent:0')).toEqual(expect.not.objectContaining({ editedText: expect.anything() }));
            expect(queries.find((treeQuery: any) => treeQuery.queryKey === 'Account:childToParent:0').generatedText).toBe(accountChildToParent.text);
            expect(queries.find((treeQuery: any) => treeQuery.queryKey === 'Contact:base:0').editedText).toBe('SELECT Id FROM Contact LIMIT 2');

        });

        it('reads back only edits it could have written, and stores a __proto__ key as a key', () => {

            const stateOf = (storedValue: unknown) => ({ get: <T>() => storedValue as T, update: jest.fn() });
            const edit = (editedText: string) => ({ generatedText: 'SELECT Id FROM Account', editedText: editedText });

            const stored = JSON.parse(JSON.stringify({ version: 1, editsByFolderName: { Tree: { k: 7, ok: edit('SELECT Id FROM Lead'), noGenerated: { editedText: 'SELECT Id FROM Lead' }, '': edit('x') }, Other: 'nope' } }));
            stored.editsByFolderName = JSON.parse(JSON.stringify(stored.editsByFolderName).replace('{"Tree"', '{"__proto__":{"__proto__":' + JSON.stringify(edit('SELECT Id FROM Account LIMIT 1')) + '},"Tree"'));
            const queryEdits = RecipeCockpitService.readQueryEdits(stateOf(stored));

            expect([...queryEdits.keys()]).toEqual(['__proto__', 'Tree']);
            expect(queryEdits.get('__proto__')?.get('__proto__')).toEqual(edit('SELECT Id FROM Account LIMIT 1'));
            expect([...(queryEdits.get('Tree') ?? new Map())]).toEqual([['ok', edit('SELECT Id FROM Lead')]]);
            expect(RecipeCockpitService.readQueryEdits(stateOf({ version: 2, editsByFolderName: {} })).size).toBe(0);
            expect(RecipeCockpitService.readQueryEdits({ get: () => { throw new Error('gone'); }, update: jest.fn() } as any).size).toBe(0);

        });

        it('asks for the org in the command palette every time, queries on a connection by username, posts a preview and says how it went', async () => {

            await openCockpit();
            await loadQueries();
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' }, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };

            await run(`  ${CONTACT_BASE_QUERY.text}  `);
            await run();

            expect(promptSpy).toHaveBeenCalledTimes(2);
            expect(promptSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER);
            expect(connectionSpy).toHaveBeenCalledWith(PROD_USERNAME);
            expect(sentQueries).toEqual([CONTACT_BASE_QUERY.text, CONTACT_BASE_QUERY.text]);

            expect(postedNamed('treeQueryResult').at(-1)).toEqual({
                command: 'treeQueryResult',
                renderSequence: lastRenderSequence(),
                treeKey: ACCOUNT_TREE_KEY,
                queryKey: 'Contact:base:0',
                orgLabel: `prod · ${PROD_USERNAME}`,
                totalSize: 2,
                recordCount: 2,
                isTruncated: false,
                columns: ['Id', 'LastName', 'AccountId'],
                rows: [['003000000000001AAA', 'Smith', ''], ['003000000000002AAA', '=cmd', '001000000000001AAA']],
                hiddenColumnCount: 0
            });
            expect(postedNamed('treeQueryState').slice(0, 2)).toEqual([
                { command: 'treeQueryState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' },
                { command: 'treeQueryState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' }
            ]);
            expect(notifications().at(-1)).toEqual({ severity: 'information', text: `The Contact Base Query returned 2 records from prod · ${PROD_USERNAME}.`, actions: [] });

            // A REPLAY AFTER A RELOAD OF THE DOCUMENT DRAWS THE PREVIEW AGAIN, AND THE STATE
            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('treeQueryResult')).toHaveLength(1);

        });

        it('is a quiet cancel when the org pick is dismissed, and refuses a text that is not one SELECT before any prompt', async () => {

            await openCockpit();
            await loadQueries();

            promptSpy.mockResolvedValueOnce(undefined);
            await run();
            expect(connectionSpy).not.toHaveBeenCalled();
            expect(notifications()).toEqual([]);
            expect(postedNamed('treeQueryState').at(-1)).toMatchObject({ isRunning: false });

            await run('SELECT Id FROM Contact; DELETE Contact');
            expect(promptSpy).toHaveBeenCalledTimes(1);
            expect(notifications()).toEqual([{ severity: 'warning', text: 'The query was not run: The query must be one statement: a ";" outside a quoted value starts another.', actions: [] }]);
            expect(postedNamed('treeQueryState').at(-1)).toEqual({ command: 'treeQueryState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' });

        });

        it('warns with the org\'s error, escaped, and keeps nothing to export', async () => {

            await openCockpit();
            await loadQueries();
            queryAnswer = async () => { throw new Error('MALFORMED_QUERY: unexpected token [click](command:evil)'); };

            await run();

            expect(notifications()).toEqual([{
                severity: 'warning',
                text: `The Contact Base Query failed in prod · ${PROD_USERNAME}: MALFORMED_QUERY: unexpected token \\u005bclick\\u005d\\u0028command:evil\\u0029`,
                actions: []
            }]);
            expect(postedNamed('treeQueryResult')).toEqual([]);

            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'json' });
            expect(notifications().at(-1)?.text).toContain('Nothing was exported: run this query first.');
            expect(fs.existsSync(resultsFolderPath())).toBe(false);

        });

        it('reads every page up to the cap and says the result was truncated', async () => {

            const pageSize = 2000;
            const totalSize = RECIPE_COCKPIT_QUERY_RECORD_CAP + 10;
            const buildPage = (pageIndex: number) => ({
                totalSize: totalSize,
                done: ( pageIndex + 1 ) * pageSize >= totalSize,
                records: Array.from({ length: Math.min(pageSize, totalSize - pageIndex * pageSize) }, (_unused, recordIndex) => ({ Id: String(pageIndex * pageSize + recordIndex) })),
                nextRecordsUrl: `/next/${pageIndex + 1}`
            });
            queryAnswer = async () => buildPage(0);
            queryMoreAnswer = async (nextRecordsUrl: string) => buildPage(Number(nextRecordsUrl.split('/').pop()));

            await openCockpit();
            await loadQueries();
            await run();

            expect(postedNamed('treeQueryResult').at(-1)).toMatchObject({ totalSize: totalSize, recordCount: RECIPE_COCKPIT_QUERY_RECORD_CAP, isTruncated: true });
            expect(postedNamed('treeQueryResult').at(-1).rows).toHaveLength(50);
            expect(notifications().at(-1)).toMatchObject({ severity: 'warning' });
            expect(notifications().at(-1)?.text).toContain(`matched ${totalSize} records`);

        });

        it('says a cancelled run kept nothing to export', async () => {

            queryAnswer = async () => ({ totalSize: 4, done: false, nextRecordsUrl: '/next/1', records: [{ Id: '1' }, { Id: '2' }] });
            cancellationToken.isCancellationRequested = true;

            await openCockpit();
            await loadQueries();
            await run();

            expect(notifications()).toEqual([{ severity: 'warning', text: `The Contact Base Query in prod · ${PROD_USERNAME} was cancelled, so nothing was kept to export.`, actions: [] }]);
            expect(postedNamed('treeQueryResult')).toEqual([]);

        });

        it('exports the result it holds as JSON and CSV under treecipe/QueryResults/<folder>, ignored by git, and opens it from the notification', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            await openCockpit();
            await loadQueries();
            await run();

            notificationAnswer = RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL;
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'json' });
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });
            await flushAsyncWork();

            const exportFolderPath = path.join(resultsFolderPath(), ACCOUNT_TREE_KEY);
            const exportFileNames = fs.readdirSync(exportFolderPath).sort();
            expect(exportFileNames).toHaveLength(2);
            expect(exportFileNames[0]).toMatch(/^\d{8}-\d{6}-Contact-base\.csv$/);
            expect(exportFileNames[1]).toMatch(/^\d{8}-\d{6}-Contact-base\.json$/);
            expect(fs.readFileSync(path.join(resultsFolderPath(), '.gitignore'), 'utf-8')).toBe('*\n');

            expect(JSON.parse(fs.readFileSync(path.join(exportFolderPath, exportFileNames[1]), 'utf-8'))).toEqual([
                { Id: '003000000000001AAA', LastName: 'Smith', AccountId: null },
                { Id: '003000000000002AAA', LastName: '=cmd', AccountId: '001000000000001AAA' }
            ]);
            expect(fs.readFileSync(path.join(exportFolderPath, exportFileNames[0]), 'utf-8'))
                .toBe('Id,LastName,AccountId\r\n003000000000001AAA,Smith,\r\n003000000000002AAA,\'=cmd,001000000000001AAA\r\n');

            const exportNotices = notifications().filter(notice => notice.text.startsWith('Exported'));
            expect(exportNotices).toHaveLength(2);
            expect(exportNotices[0]).toMatchObject({ severity: 'information', actions: [RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL] });
            expect(exportNotices[0].text).toContain(`Exported 2 records from prod · ${PROD_USERNAME} to treecipe/QueryResults/${ACCOUNT_TREE_KEY}/`);
            expect(openSpy).toHaveBeenCalledTimes(2);
            expect(openSpy.mock.calls.map(([filePath]) => path.basename(filePath)).sort()).toEqual(exportFileNames);

        });

        it('exports only the query that was run last, never another one', async () => {

            await openCockpit();
            await loadQueries();
            await run();

            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Account:base:0', exportFormat: 'csv' });

            expect(notifications().at(-1)?.text).toBe('Nothing was exported: run this query first. Only the last query run is kept to export.');
            expect(fs.existsSync(resultsFolderPath())).toBe(false);

        });

        it('warns, and still writes the file, when treecipe/QueryResults/.gitignore does not ignore everything', async () => {

            await openCockpit();
            await loadQueries();
            await run();
            fs.mkdirSync(resultsFolderPath(), { recursive: true });
            fs.writeFileSync(path.join(resultsFolderPath(), '.gitignore'), '*\n!*.csv\n');

            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });

            const exportNotice = notifications().find(notice => notice.text.startsWith('Exported'));
            expect(exportNotice).toMatchObject({ severity: 'warning', actions: [RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL] });
            expect(exportNotice?.text).toContain('could be committed');
            expect(fs.readdirSync(path.join(resultsFolderPath(), ACCOUNT_TREE_KEY))).toHaveLength(1);

        });

        it('warns rather than throwing when an export cannot be built', async () => {

            await openCockpit();
            await loadQueries();
            await run();
            jest.spyOn(RecipeCockpitQuery, 'buildJsonExport').mockImplementation(() => { throw new RangeError('Invalid string length'); });

            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'json' });

            expect(notifications().at(-1)?.text).toBe('Nothing was exported: the JSON file could not be built: Invalid string length');
            expect(fs.existsSync(resultsFolderPath())).toBe(false);

        });

        it('lets a result go when a new model is drawn, so it is never exported from a model it was not run on', async () => {

            await openCockpit();
            await loadQueries();
            await run();

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            await openCockpit();
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'json' });

            expect(notifications().at(-1)?.text).toBe('Nothing was exported: run this query first. Only the last query run is kept to export.');
            expect(fs.existsSync(resultsFolderPath())).toBe(false);

        });

        it('runs one query per window: a run while one runs starts nothing and is told it is running', async () => {

            await openCockpit();
            await loadQueries();
            let releaseQuery: () => void = () => undefined;
            queryAnswer = () => new Promise(resolve => { releaseQuery = () => resolve({ totalSize: 0, done: true, records: [] }); });

            const firstRun = run();
            await flushAsyncWork();
            await run(undefined, 'Account:base:0');

            expect(postedNamed('treeQueryState').at(-1)).toEqual({ command: 'treeQueryState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' });
            expect(promptSpy).toHaveBeenCalledTimes(1);

            releaseQuery();
            await firstRun;
            await flushAsyncWork();
            expect(postedNamed('treeQueryState').at(-1)).toMatchObject({ isRunning: false });

        });

        it('runs nothing for a key the host did not read for the tree', async () => {

            await openCockpit();
            await loadQueries();
            await run('SELECT Id FROM Lead', 'Lead:base:0');

            expect(promptSpy).not.toHaveBeenCalled();
            expect(postedNamed('treeQueryState').at(-1)).toEqual({ command: 'treeQueryState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Lead:base:0' });

        });


        it('says why when the run\'s wrapper cannot be read again, and saves and runs nothing for that tree', async () => {

            await openCockpit();
            fs.rmSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, path.basename(TREE_WRAPPER_FILE_PATH)));

            const queriesMessage = await loadQueries();
            expect(queriesMessage.queries).toEqual([]);
            expect(queriesMessage.failureMessage).toStartWith(`The objects wrapper "${path.basename(TREE_WRAPPER_FILE_PATH)}" could not be read again:`);

            await send({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' });
            await run();
            expect(storedWorkspaceState.has(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY)).toBe(false);
            expect(promptSpy).not.toHaveBeenCalled();

        });

        it('starts its list of read trees again once it holds the most it keeps', async () => {

            await openCockpit();
            const treeQueryLists: Map<string, unknown> = (RecipeCockpitService as any).treeQueryLists;
            Array.from({ length: 50 }, (_unused, index) => treeQueryLists.set(`other-${index}`, []));

            await loadQueries();

            expect(treeQueryLists.size).toBe(1);

        });

        it('posts nothing for a card with no folder, or for a model no longer on screen', async () => {

            await openCockpit();
            postedPanelMessages = [];

            (RecipeCockpitService as any).postTreeQueries((RecipeCockpitService as any).recipeCockpitPanel, 'No-Such-Tree', lastRenderSequence());
            (RecipeCockpitService as any).postTreeQueries((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY, -1);

            expect(postedNamed('treeQueries')).toEqual([]);

        });

        it('warns once when there is no workspace to keep an edit in, or the write fails', async () => {

            expect(await RecipeCockpitService.writeQueryEdits(undefined, new Map())).toBe(false);
            expect(RecipeCockpitService.readQueryEdits(undefined).size).toBe(0);

            const failingState = { get: jest.fn(), update: jest.fn().mockRejectedValue(new Error('disk full')) };
            expect(await RecipeCockpitService.writeQueryEdits(failingState, new Map([['Tree', new Map([['k', { generatedText: 'SELECT Id FROM Account', editedText: 'SELECT Id FROM Account LIMIT 1' }]])]]))).toBe(false);

            expect(notifications().map(notice => notice.text)).toEqual([
                'The Recipe Cockpit has no workspace to keep query edits in. Open a folder and re-open the cockpit.',
                'The query edit could not be saved: disk full'
            ]);

        });

        it('warns when the org list cannot be read, and names an org with no alias by its username, a record in the singular', async () => {

            await openCockpit();
            await loadQueries();

            promptSpy.mockRejectedValueOnce(new Error('The Salesforce CLI could not list orgs'));
            await run();
            expect(notifications().at(-1)?.text).toBe('The query was not run: The Salesforce CLI could not list orgs');
            expect(connectionSpy).not.toHaveBeenCalled();

            promptSpy.mockResolvedValueOnce({ targetOrgIdentifier: PROD_USERNAME, username: PROD_USERNAME });
            queryAnswer = async () => ({ totalSize: 1, done: true, records: [{ attributes: {}, Id: '003000000000001AAA' }] });
            await run();
            const informationTexts = () => notifications().filter(notice => notice.severity === 'information').map(notice => notice.text);
            expect(informationTexts().at(-1)).toBe(`The Contact Base Query returned 1 record from ${PROD_USERNAME}.`);

            notificationAnswer = undefined;
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'json' });
            expect(informationTexts().at(-1)).toStartWith(`Exported 1 record from ${PROD_USERNAME} to treecipe/QueryResults/`);

        });

        it('warns when the export cannot be written, and reports an Open file that throws through the shared handler', async () => {

            const ErrorHandlingService = require('../../ErrorHandlingService/ErrorHandlingService').ErrorHandlingService;
            const capturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpit();
            await loadQueries();
            await run();

            fs.writeFileSync(resultsFolderPath(), 'a file where the folder goes');
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });
            expect(notifications().at(-1)?.text).toBe('Nothing was exported: the CSV file could not be written under treecipe/QueryResults in this workspace.');

            fs.rmSync(resultsFolderPath());
            jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockRejectedValue(new Error('editor gone'));
            notificationAnswer = RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL;
            await send({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });
            await flushAsyncWork();

            expect(capturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'editor gone' }), 'openRecipeCockpit');

        });

        it('holds one run per window even when the run is asked for past the router, and a panel built mid-run adopts it', async () => {

            await openCockpit();
            await loadQueries();
            let releaseQuery: () => void = () => undefined;
            queryAnswer = () => new Promise(resolve => { releaseQuery = () => resolve({ totalSize: 0, done: true, records: [] }); });

            const firstRun = run();
            await flushAsyncWork();
            postedPanelMessages = [];
            await (RecipeCockpitService as any).runTreeQueryFromPanel((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY, 'Account:base:0', 'SELECT Id FROM Account');
            expect(postedNamed('treeQueryState')).toEqual([{ command: 'treeQueryState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' }]);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            await openCockpit();
            expect(panelState().treeQueryStateMessage).toEqual({ command: 'treeQueryState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' });

            releaseQuery();
            await firstRun;
            await flushAsyncWork();
            expect(panelState().treeQueryStateMessage).toMatchObject({ isRunning: false });

        });

        it('replays a preview only over the model it was run on', async () => {

            await openCockpit();
            await loadQueries();
            await run();
            panelState().treeQueryResultMessage = { ...panelState().treeQueryResultMessage!, renderSequence: -1 };

            postedPanelMessages = [];
            await send({ command: 'ready' });

            expect(postedNamed('treeQueryResult')).toEqual([]);

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
        };

        const cardOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes(objectApiName)));

        const queriesMessage = (renderSequence = 1) => ({
            command: 'treeQueries',
            renderSequence: renderSequence,
            treeKey: ACCOUNT_TREE_KEY,
            queries: ACCOUNT_TREE_QUERIES.map(treeQuery => ({
                queryKey: treeQuery.queryKey,
                objectApiName: treeQuery.objectApiName,
                kindLabel: treeQuery.kind,
                notes: treeQuery.notes,
                generatedText: treeQuery.text,
                ...( treeQuery.queryKey === 'Account:base:0' ? { editedText: 'SELECT Id FROM Account LIMIT 1' } : {} )
            }))
        });

        const renderQueryTab = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = cardOf(panel, 'OtherChildObject__c');
            panel.openTab(accountCard, RECIPE_COCKPIT_QUERY_TAB_LABEL);
            return { panel, accountCard };
        };

        const queryOf = (panel: ReturnType<typeof runPanelScript>, accountCard: any, queryKey: string) => {
            const queryIndex = ACCOUNT_TREE_QUERIES.findIndex(treeQuery => treeQuery.queryKey === queryKey);
            return panel.findAll(accountCard, 'treeQuery')[queryIndex];
        };

        it('draws Query after Troubleshooting, builds nothing until it is opened, and then asks the host for the tree\'s queries', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = cardOf(panel, 'OtherChildObject__c');

            expect(panel.findAll(accountCard, 'treeTab').map((tabElement: any) => tabElement.textContent)).toEqual(['Treecipe', 'Previously Used Data Sets', 'Troubleshooting', 'Query']);
            expect(panel.findAll(accountCard, 'treeQueryList')).toEqual([]);
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadTreeQueries')).toEqual([]);

            panel.openTab(accountCard, RECIPE_COCKPIT_QUERY_TAB_LABEL);

            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadTreeQueries')).toEqual([{ command: 'loadTreeQueries', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 }]);
            expect(panel.findAll(accountCard, 'treeQueryList')[0].children[0].textContent).toBe('Reading this run’s queries…');

        });

        it('draws each query with its notes, its saved edit in the box, and an "edited" mark', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel(queriesMessage());

            const queryElements = panel.findAll(accountCard, 'treeQuery');
            expect(queryElements).toHaveLength(ACCOUNT_TREE_QUERIES.length);

            const accountBase = queryOf(panel, accountCard, 'Account:base:0');
            expect(panel.findAll(accountBase, 'treeQueryText')[0].value).toBe('SELECT Id FROM Account LIMIT 1');
            expect(panel.isHidden(panel.findAll(accountBase, 'treeQueryEdited')[0])).toBe(false);

            const recordTypeQuery = queryOf(panel, accountCard, 'Account:recordType:1');
            expect(panel.findAll(recordTypeQuery, 'treeQueryNote').map((noteElement: any) => noteElement.textContent)).toEqual(['Record Type: Partner']);
            expect(panel.isHidden(panel.findAll(recordTypeQuery, 'treeQueryEdited')[0])).toBe(true);

            // EXPORT WAITS FOR A RESULT
            expect(panel.findAll(accountBase, 'treeQueryExport').every((buttonElement: any) => buttonElement.disabled)).toBe(true);

        });

        it('saves an edit when the box loses focus, and Reset puts back the generated text and removes the edit', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel(queriesMessage());
            const contactBase = queryOf(panel, accountCard, 'Contact:base:0');
            const textElement = panel.findAll(contactBase, 'treeQueryText')[0];
            const saves = () => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'saveTreeQueryEdit');

            textElement.value = 'SELECT Id FROM Contact LIMIT 9';
            textElement.dispatch('input');
            expect(panel.isHidden(panel.findAll(contactBase, 'treeQueryEdited')[0])).toBe(false);
            textElement.dispatch('change');
            textElement.dispatch('change');

            expect(saves()).toEqual([{ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact LIMIT 9' }]);

            panel.findAll(contactBase, 'treeQueryReset')[0].dispatch('click');

            expect(textElement.value).toBe(CONTACT_BASE_QUERY.text);
            expect(panel.isHidden(panel.findAll(contactBase, 'treeQueryEdited')[0])).toBe(true);
            expect(saves().at(-1)).toEqual({ command: 'saveTreeQueryEdit', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: '' });

        });

        it('runs the text in the box, holding every Run button until the host says the run ended, and refuses one that is not a SELECT', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel(queriesMessage());
            const contactBase = queryOf(panel, accountCard, 'Contact:base:0');
            const runButton = panel.findAll(contactBase, 'treeQueryRun')[0];
            const runs = () => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'runTreeQuery');

            panel.findAll(contactBase, 'treeQueryText')[0].value = 'DELETE FROM Contact';
            runButton.dispatch('click');
            expect(runs()).toEqual([]);
            const refusalElement = panel.findAll(contactBase, 'fieldEditorRefusal')[0];
            expect(refusalElement.textContent).toBe('The query must be one SOQL SELECT statement.');
            expect(panel.isHidden(refusalElement)).toBe(false);

            panel.findAll(contactBase, 'treeQueryText')[0].value = 'SELECT Id FROM Contact';
            runButton.dispatch('click');

            expect(runs()).toEqual([{ command: 'runTreeQuery', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', queryText: 'SELECT Id FROM Contact' }]);
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'saveTreeQueryEdit').at(-1)).toMatchObject({ queryText: 'SELECT Id FROM Contact' });
            expect(panel.findAll(accountCard, 'treeQueryRun').every((buttonElement: any) => buttonElement.disabled)).toBe(true);
            runButton.dispatch('click');
            expect(runs()).toHaveLength(1);

            panel.postToPanel({ command: 'treeQueryState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0' });
            expect(panel.findAll(accountCard, 'treeQueryRun').every((buttonElement: any) => !buttonElement.disabled)).toBe(true);

        });

        it('draws one preview with textContent, enables its Export buttons, and posts an export with the key and format alone', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel(queriesMessage());
            const contactBase = queryOf(panel, accountCard, 'Contact:base:0');
            const accountBase = queryOf(panel, accountCard, 'Account:base:0');
            const resultMessage = (queryKey: string, renderSequence = 1) => ({
                command: 'treeQueryResult',
                renderSequence: renderSequence,
                treeKey: ACCOUNT_TREE_KEY,
                queryKey: queryKey,
                orgLabel: 'prod · admin@example.com',
                totalSize: 120,
                recordCount: 100,
                isTruncated: true,
                columns: ['Id', 'LastName'],
                rows: [['1', '<img src=x onerror=alert(1)>'], ['2', 'Jones']],
                hiddenColumnCount: 3
            });

            panel.postToPanel(resultMessage('Contact:base:0', 2));
            expect(panel.findAll(accountCard, 'treeQueryTable')).toEqual([]);

            panel.postToPanel(resultMessage('Contact:base:0'));

            expect(panel.findAll(contactBase, 'treeQueryResultSummary')[0].textContent).toBe('100 records from prod · admin@example.com, the first of 120 it matched. Showing the first 2 rows and 2 columns, 3 more not shown; Export writes them all.');
            const rowElements = panel.findAll(contactBase, 'treeQueryRow');
            expect(rowElements.map((rowElement: any) => rowElement.children.map((cellElement: any) => cellElement.textContent))).toEqual([['1', '<img src=x onerror=alert(1)>'], ['2', 'Jones']]);
            expect(rowElements[0].children[1].children).toEqual([]);

            const exportButtons = panel.findAll(contactBase, 'treeQueryExport');
            expect(exportButtons.every((buttonElement: any) => !buttonElement.disabled)).toBe(true);
            exportButtons[1].dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'exportTreeQueryResult', treeKey: ACCOUNT_TREE_KEY, queryKey: 'Contact:base:0', exportFormat: 'csv' });

            // ONE RESULT AT A TIME, AS THE HOST KEEPS ONE
            panel.postToPanel(resultMessage('Account:base:0'));
            expect(panel.findAll(contactBase, 'treeQueryTable')).toEqual([]);
            expect(panel.findAll(contactBase, 'treeQueryExport').every((buttonElement: any) => buttonElement.disabled)).toBe(true);
            expect(panel.findAll(accountBase, 'treeQueryTable')).toHaveLength(1);

        });

        it('searches the queries by object, kind and text, hiding the rest and counting what is left', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel(queriesMessage());

            panel.typeIntoTabSearch(accountCard, 'treeQueries', 'Partner');
            const shownQueries = panel.findAll(accountCard, 'treeQuery').filter((queryElement: any) => !panel.isHidden(queryElement));
            expect(shownQueries).toEqual([queryOf(panel, accountCard, 'Account:recordType:1')]);
            expect(panel.findAll(accountCard, 'tabMatchCount').find((countElement: any) => countElement.textContent.includes('queries'))?.textContent).toBe(`1 of ${ACCOUNT_TREE_QUERIES.length} queries`);

            panel.typeIntoTabSearch(accountCard, 'treeQueries', 'nothing like this');
            expect(panel.findAll(accountCard, 'treeQuery').every((queryElement: any) => panel.isHidden(queryElement))).toBe(true);

        });

        it('shows why there are no queries when the host could not read them', () => {

            const { panel, accountCard } = renderQueryTab();
            panel.postToPanel({ command: 'treeQueries', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, queries: [], failureMessage: 'The objects wrapper could not be read.' });

            expect(panel.findAll(accountCard, 'treeQueryList')[0].children.map((childElement: any) => childElement.textContent)).toEqual(['The objects wrapper could not be read.']);

        });

    });

});
