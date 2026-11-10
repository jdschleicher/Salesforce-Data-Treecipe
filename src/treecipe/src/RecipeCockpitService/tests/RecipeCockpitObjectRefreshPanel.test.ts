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
    RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_RUNNING_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_CHANGED_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL,
    RECIPE_COCKPIT_OBJECT_REFRESH_LABEL,
    RECIPE_COCKPIT_OBJECT_REFRESH_GLYPH_PATH,
    RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX,
    RecipeCockpitService
} from '../RecipeCockpitService';
import { OBJECT_REFRESH_KINDS } from '../RecipeCockpitObjectRefresh';
import { SalesforceCli } from '../../SalesforceCli/SalesforceCli';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const OBJECT_REFRESH_MOCKS = path.join(__dirname, 'mocks', 'objectRefresh');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_RECIPE_RELATIVE_PATH = path.join('treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);
const QA_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

const loadTreeRecipe = (workspaceRoot: string = TREE_WORKSPACE_ROOT) => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, workspaceRoot, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, Get latest object detail from target org (#612)', () => {

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const openSession = (panelState: IRecipeCockpitPanelState, step: 'choose' | 'retrieving' | 'review' | 'applying' = 'choose', itemCount = 0) => {
            panelState.objectRefreshSession = {
                stateMessage: { command: 'objectRefreshState', refreshId: 'refresh-1', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', step: step, kinds: [...OBJECT_REFRESH_KINDS] },
                cancellation: { isRequested: false },
                plannedItems: Array.from({ length: itemCount }, () => ({} as any))
            } as any;
        };

        it('opens on a row the model on screen draws, carrying only the card, the model and the object', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account' }, panelState))
                .toEqual({ kind: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account' });

        });

        it.each([
            ['a model not on screen', { renderSequence: 2 }],
            ['an object the card does not draw', { objectApiName: 'Opportunity' }],
            ['a card not on screen', { treeKey: 'Lead-ONLY-missing' }],
            ['an object name that is not text', { objectApiName: ['Account'] }],
            ['a nickname that is not one of the object\'s occurrences', { nickname: 'Someone_Else' }]
        ])('opens nothing for %s', (_caseName, overrides) => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account', ...overrides }, panelState)).toBeUndefined();

        });

        it('opens nothing on a card that cannot be named, and refuses while a dialog still retrieves', () => {

            const panelState = buildPanelState();
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account' }, panelState)).toBeUndefined();

            const busyState = buildPanelState();
            openSession(busyState, 'retrieving');
            expect(RecipeCockpitService.routePanelMessage({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account' }, busyState))
                .toMatchObject({ kind: 'refuseObjectRefresh', refusalText: RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL, hostMessage: { step: 'retrieving' } });

        });

        it('starts only the open dialog at step 1, with kinds from the fixed list, in its order', () => {

            const panelState = buildPanelState();
            openSession(panelState);

            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['globalValueSets', 'fields'] }, panelState))
                .toEqual({ kind: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['fields', 'globalValueSets'] });
            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-2', kinds: ['fields'] }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: [] }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['fields', 'apexClasses'] }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: 'fields' }, panelState)).toBeUndefined();

            panelState.recipeDataMessage = { ...panelState.recipeDataMessage, renderSequence: 4 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['fields'] }, panelState)).toBeUndefined();

        });

        it('refuses to start while an insert or another run holds the org or the project, keeping step 1 on screen', () => {

            const panelState = buildPanelState();
            openSession(panelState);
            panelState.insertStateMessage = { command: 'insertState', treeKey: ACCOUNT_TREE_KEY } as any;

            expect(RecipeCockpitService.routePanelMessage({ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['fields'] }, panelState))
                .toMatchObject({ kind: 'refuseObjectRefresh', refusalText: RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL, hostMessage: { step: 'choose' } });

        });

        it('applies only whole, distinct indexes of the items the review showed', () => {

            const panelState = buildPanelState();
            openSession(panelState, 'review', 3);

            expect(RecipeCockpitService.routePanelMessage({ command: 'applyObjectRefresh', refreshId: 'refresh-1', itemIndexes: [2, 0] }, panelState))
                .toEqual({ kind: 'applyObjectRefresh', refreshId: 'refresh-1', itemIndexes: [0, 2] });
            [[], [3], [-1], [0.5], [1, 1], ['0'], 'all'].forEach(itemIndexes => {
                expect(RecipeCockpitService.routePanelMessage({ command: 'applyObjectRefresh', refreshId: 'refresh-1', itemIndexes: itemIndexes }, panelState)).toBeUndefined();
            });

        });

        it('cancels the open dialog by its id, but never an Apply that is writing', () => {

            const panelState = buildPanelState();
            openSession(panelState, 'review');
            expect(RecipeCockpitService.routePanelMessage({ command: 'cancelObjectRefresh', refreshId: 'refresh-1' }, panelState)).toEqual({ kind: 'cancelObjectRefresh', refreshId: 'refresh-1' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'cancelObjectRefresh', refreshId: 'other' }, panelState)).toBeUndefined();

            openSession(panelState, 'applying');
            expect(RecipeCockpitService.routePanelMessage({ command: 'cancelObjectRefresh', refreshId: 'refresh-1' }, panelState)).toBeUndefined();

        });

        it('holds the Adapter\'s Apply, the Troubleshooting runs and generation back while it applies, and says why', () => {

            const panelState = buildPanelState();
            openSession(panelState, 'applying');

            expect(RecipeCockpitService.isApplyingObjectRefresh(panelState)).toBe(true);
            expect(RecipeCockpitService.findRetrievedFilesApplyRefusal(panelState)).toBe(RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_RUNNING_REFUSAL);

            panelState.adapterMetadataChangesMessage = { command: 'adapterMetadataChanges', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: [], hints: {} as any };
            panelState.adapterRetrieveStagingFolderPath = '/workspace/staging';
            expect(RecipeCockpitService.routePanelMessage({ command: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 }, panelState))
                .toMatchObject({ kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL });

            openSession(panelState, 'review');
            expect(RecipeCockpitService.findRetrievedFilesApplyRefusal(panelState)).toBeUndefined();

        });

    });

    describe('the host, against a faked org selection and CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let cliCalls: string[][];
        let cliAnswer: (cliArguments: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
        let confirmAnswer: string | undefined;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const refreshStates = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'objectRefreshState');
        const lastRefreshState = () => refreshStates()[refreshStates().length - 1];
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([warningText]) => warningText).filter(warningText => !String(warningText).startsWith('Apply '));
        const informations = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([informationText]) => informationText);
        const recipeText = () => fs.readFileSync(path.join(workspaceRoot, ACCOUNT_RECIPE_RELATIVE_PATH), 'utf-8');
        const projectFile = (...segments: string[]) => path.join(workspaceRoot, 'force-app', 'main', 'default', ...segments);
        const objectRefreshFolders = () => {
            const orgOperationsFolder = path.join(workspaceRoot, path.dirname(ACCOUNT_RECIPE_RELATIVE_PATH), 'RunArtifacts', 'OrgOperations', QA_ORG.username);
            return fs.existsSync(orgOperationsFolder) ? fs.readdirSync(orgOperationsFolder).filter(entryName => entryName.endsWith('object-refresh')) : [];
        };

        const selectOrg = () => {
            panelState().dataOrgDetails = [QA_ORG];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: QA_ORG, requestSequence: 1, orgTypeDetail: { isSandbox: false, organizationType: 'Developer Edition' } };
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

        const openAndRetrieve = async (kinds: string[] = [...OBJECT_REFRESH_KINDS]) => {
            await openCockpit();
            selectOrg();
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: kinds });
        };

        const itemIndexesNamed = (...names: string[]) => {
            const items = lastRefreshState().groups.flatMap((group: any) => group.items);
            return names.map(name => items.findIndex((item: any) => item.name === name));
        };

        // WHAT THE ORG WOULD WRITE UNDER --output-dir: THE STAGED Account AND ITS GLOBAL VALUE SET, AND A --json SUCCESS
        const succeedWithStagedFiles = async (cliArguments: string[]) => {
            const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
            fs.cpSync(path.join(OBJECT_REFRESH_MOCKS, 'staged'), path.join(workspaceRoot, outputDirectory), { recursive: true });
            return { stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), stderr: '', exitCode: 0 };
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-object-refresh-host-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(path.join(OBJECT_REFRESH_MOCKS, 'project'), path.join(workspaceRoot, 'force-app'), { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));

            postedPanelMessages = [];
            cliCalls = [];
            cliAnswer = succeedWithStagedFiles;
            confirmAnswer = RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL;
            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            const cancellationToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string) => String(message).startsWith('Apply ') ? Promise.resolve(confirmAnswer) : Promise.resolve(undefined));
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
            jest.spyOn(SalesforceCli, 'runSalesforceCli').mockImplementation(async (cliArguments: string[]) => {
                cliCalls.push(cliArguments);
                return cliAnswer(cliArguments);
            });

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('opens on step 1 with every kind ticked, under a fresh id', async () => {

            await openCockpit();
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });

            expect(lastRefreshState()).toMatchObject({ step: 'choose', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', kinds: [...OBJECT_REFRESH_KINDS], renderSequence: lastRenderSequence() });
            expect(lastRefreshState().refreshId).toMatch(/^[0-9a-f-]{36}$/);
            expect(cliCalls).toEqual([]);

        });

        it('retrieves the object and its global value sets into a new object-refresh staging folder, never the project, and lists what is new or changed by name only', async () => {

            const projectBefore = fs.readFileSync(projectFile('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), 'utf-8');

            await openAndRetrieve();

            expect(cliCalls).toHaveLength(1);
            const cliArguments = cliCalls[0];
            const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
            const manifestPath = cliArguments[cliArguments.indexOf('--manifest') + 1];
            expect(cliArguments.slice(0, 6)).toEqual(['project', 'retrieve', 'start', '--json', '--target-org', QA_ORG.username]);
            expect(outputDirectory).toMatch(new RegExp(`/RunArtifacts/OrgOperations/qa@example\\.com\\.qa/\\d{8}-\\d{6}-object-refresh$`));
            expect(fs.readFileSync(path.join(workspaceRoot, manifestPath), 'utf-8')).toContain('<members>Account</members>\n        <name>CustomObject</name>\n    </types>\n    <types>\n        <members>Regions</members>\n        <name>GlobalValueSet</name>');
            expect(fs.readFileSync(projectFile('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), 'utf-8')).toBe(projectBefore);

            const reviewState = lastRefreshState();
            expect(reviewState.step).toBe('review');
            expect(reviewState.orgLabel).toBe('qa · qa@example.com.qa');
            expect(reviewState.groups.map((group: any) => [group.kind, group.items.map((item: any) => `${item.status} ${item.name}`)])).toEqual([
                ['fields', ['new Is_Priority__c', 'new Region_Owner__c', 'new Score__c', 'new Total__c', 'changed Legacy_Code__c']],
                ['validationRules', ['new Legacy_Inactive', 'new Score_Max', 'new Two_Fields']],
                ['recordTypes', ['changed Business', 'new Partner']],
                ['globalValueSets', ['changed Regions']]
            ]);
            expect(JSON.stringify(reviewState)).not.toContain(workspaceRoot);
            expect(Object.keys(reviewState.groups[0].items[0]).sort()).toEqual(['detail', 'differences', 'kind', 'name', 'recipeNote', 'status']);

        });

        it('copies only the ticked files, then writes only their recipe lines, and says so once', async () => {

            const recipeBefore = recipeText();
            await openAndRetrieve();

            await send({ command: 'applyObjectRefresh', refreshId: lastRefreshState().refreshId, itemIndexes: itemIndexesNamed('Is_Priority__c', 'Legacy_Code__c', 'Partner') });

            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'))).toBe(true);
            expect(fs.readFileSync(projectFile('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), 'utf-8')).toContain('<length>255</length>');
            expect(fs.existsSync(projectFile('objects', 'Account', 'recordTypes', 'Partner.recordType-meta.xml'))).toBe(true);
            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Score__c.field-meta.xml'))).toBe(false);

            const recipeLinesBefore = recipeBefore.split('\n');
            const recipeLinesAfter = recipeText().split('\n');
            expect(recipeLinesAfter.filter(recipeLine => !recipeLinesBefore.includes(recipeLine))).toEqual([
                '    Legacy_Code__c: ${{fake.text(max_nb_chars=255)}}',
                '    Is_Priority__c: ${{ (random_choice("true", "false")).lower() }}'
            ]);
            expect(recipeLinesBefore.filter(recipeLine => !recipeLinesAfter.includes(recipeLine))).toEqual(['    Legacy_Code__c: ${{fake.Word}}']);

            expect(informations()).toEqual(['Account: copied 3 files from qa · qa@example.com.qa into the project and wrote 2 recipe lines. A record type changed: run Generate Treecipe to write a new run with its section.']);
            expect(lastRefreshState().step).toBe('closed');
            expect(panelState().objectRefreshSession).toBeUndefined();
            expect(objectRefreshFolders()).toHaveLength(1);

        });

        it('writes nothing when the confirmation is cancelled, and draws the review again with the same items ticked', async () => {

            const recipeBefore = recipeText();
            confirmAnswer = undefined;
            await openAndRetrieve();
            const tickedIndexes = itemIndexesNamed('Is_Priority__c');

            await send({ command: 'applyObjectRefresh', refreshId: lastRefreshState().refreshId, itemIndexes: tickedIndexes });

            expect(refreshStates().map(state => state.step).slice(-2)).toEqual(['confirming', 'review']);
            expect(lastRefreshState().tickedItemIndexes).toEqual(tickedIndexes);
            expect(recipeText()).toBe(recipeBefore);
            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'))).toBe(false);

        });

        it('refuses an Apply when a ticked item would write something the review did not show', async () => {

            await openAndRetrieve();
            const stagingFolderPath = panelState().objectRefreshSession!.stagingFolderPath!;
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string) => {
                if ( String(message).startsWith('Apply ') ) {
                    fs.writeFileSync(path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'), '<CustomField><fullName>Is_Priority__c</fullName><label>P</label><type>Text</type><length>9</length></CustomField>');
                    return Promise.resolve(RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL);
                }
                return Promise.resolve(undefined);
            });

            await send({ command: 'applyObjectRefresh', refreshId: lastRefreshState().refreshId, itemIndexes: itemIndexesNamed('Is_Priority__c') });

            expect(warnings()).toEqual([RECIPE_COCKPIT_OBJECT_REFRESH_CHANGED_REFUSAL]);
            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'))).toBe(false);
            expect(lastRefreshState().step).toBe('review');

        });

        it('changes nothing, and leaves no staging folder, when the reader cancels while it retrieves', async () => {

            const recipeBefore = recipeText();
            cliAnswer = async (cliArguments: string[]) => {
                await succeedWithStagedFiles(cliArguments);
                await receivedMessageHandler({ command: 'cancelObjectRefresh', refreshId: lastRefreshState().refreshId });
                return { stdout: '', stderr: '', exitCode: null };
            };

            await openAndRetrieve();

            expect(warnings()).toEqual(['Getting the latest detail of Account from qa · qa@example.com.qa was cancelled. Nothing in the project or the recipe changed.']);
            expect(lastRefreshState().step).toBe('closed');
            expect(objectRefreshFolders()).toEqual([]);
            expect(recipeText()).toBe(recipeBefore);
            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'))).toBe(false);

        });

        it('closes on Cancel at the review, removing what it staged', async () => {

            await openAndRetrieve();
            expect(objectRefreshFolders()).toHaveLength(1);

            await send({ command: 'cancelObjectRefresh', refreshId: lastRefreshState().refreshId });

            expect(lastRefreshState().step).toBe('closed');
            expect(objectRefreshFolders()).toEqual([]);

        });

        it('says what failed when the org does not confirm the retrieve, and writes nothing', async () => {

            cliAnswer = async () => ({ stdout: JSON.stringify({ status: 1, message: 'INVALID_SESSION_ID: Session expired' }), stderr: '', exitCode: 1 });

            await openAndRetrieve();

            expect(warnings()).toEqual(['The latest detail of Account could not be retrieved from qa · qa@example.com.qa: INVALID_SESSION_ID: Session expired']);
            expect(lastRefreshState().step).toBe('closed');
            expect(objectRefreshFolders()).toEqual([]);

        });

        it('retrieves nothing from a project with no sfdx-project.json', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));

            await openAndRetrieve(['fields']);

            expect(cliCalls).toEqual([]);
            expect(warnings()[0]).toStartWith('Nothing was retrieved for Account: ');
            expect(lastRefreshState().step).toBe('closed');

        });

        it('asks no global value set of the org when that kind is not ticked', async () => {

            await openAndRetrieve(['fields', 'recordTypes']);

            const manifestPath = cliCalls[0][cliCalls[0].indexOf('--manifest') + 1];
            expect(fs.readFileSync(path.join(workspaceRoot, manifestPath), 'utf-8')).not.toContain('GlobalValueSet');
            expect(lastRefreshState().groups.map((group: any) => group.kind)).toEqual(['fields', 'recordTypes']);

        });


        it('goes back to step 1 when no org is chosen and the prompt is dismissed', async () => {

            await openCockpit();
            jest.spyOn(RecipeCockpitService as any, 'resolveSelectedReadOrg').mockResolvedValue(undefined);
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: ['fields'] });

            expect(refreshStates().map(state => state.step)).toEqual(['choose', 'retrieving', 'choose']);
            expect(cliCalls).toEqual([]);

        });

        it('retrieves nothing when the staging folder cannot be made, or the retrieve cannot be named', async () => {

            await openCockpit();
            selectOrg();
            const { RecipeCockpitOrgChangeDetection } = await import('../RecipeCockpitOrgChangeDetection');
            jest.spyOn(RecipeCockpitOrgChangeDetection, 'buildStagingFolderPath').mockReturnValueOnce(undefined);
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: ['fields'] });

            const { RecipeCockpitObjectRefresh } = await import('../RecipeCockpitObjectRefresh');
            jest.spyOn(RecipeCockpitObjectRefresh, 'buildRetrieveComponents').mockImplementationOnce(() => { throw new Error('"Account" is not an object api name, so nothing was retrieved.'); });
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: ['fields'] });

            expect(cliCalls).toEqual([]);
            expect(warnings()).toEqual([
                'Nothing was retrieved for Account: the staging folder could not be made under the tree\'s RunArtifacts folder in this workspace.',
                'Nothing was retrieved for Account: "Account" is not an object api name, so nothing was retrieved.'
            ]);
            expect(lastRefreshState().step).toBe('closed');

        });

        it('lists nothing when the run on screen changed while the org answered, or the org returned nothing for the object', async () => {

            cliAnswer = async (cliArguments: string[]) => {
                const answer = await succeedWithStagedFiles(cliArguments);
                panelState().recipeDataMessage = { ...panelState().recipeDataMessage };
                return answer;
            };
            await openAndRetrieve(['fields']);
            expect(warnings()).toEqual(['The latest detail of Account was retrieved, but the run on screen changed meanwhile, so nothing was listed. Get it again.']);
            expect(objectRefreshFolders()).toEqual([]);

            (vscode.window.showWarningMessage as jest.Mock).mockClear();
            cliAnswer = async () => ({ stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), stderr: '', exitCode: 0 });
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: ['fields'] });
            expect(warnings()).toEqual(['qa · qa@example.com.qa returned nothing for Account, so nothing was listed. Check that the object exists in that org.']);
            expect(lastRefreshState().step).toBe('closed');

        });

        it('applies nothing when another run starts while the confirmation is open', async () => {

            await openAndRetrieve(['fields']);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string) => {
                if ( String(message).startsWith('Apply ') ) {
                    panelState().insertStateMessage = { command: 'insertState', treeKey: ACCOUNT_TREE_KEY } as any;
                    return Promise.resolve(RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL);
                }
                return Promise.resolve(undefined);
            });

            await send({ command: 'applyObjectRefresh', refreshId: lastRefreshState().refreshId, itemIndexes: itemIndexesNamed('Is_Priority__c') });

            expect(warnings()).toEqual([RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL]);
            expect(fs.existsSync(projectFile('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'))).toBe(false);
            expect(lastRefreshState().step).toBe('review');

        });

        it('leaves a pinned field\'s recipe line, and writes no line for a file it could not copy, naming it in a warning while the rest land', async () => {

            await openCockpit();
            const tree = panelState().recipeDataMessage.recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
            tree.fixedValues = [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X', kind: 'text' } as any];
            selectOrg();
            await send({ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account' });
            await send({ command: 'startObjectRefresh', refreshId: lastRefreshState().refreshId, kinds: ['fields'] });
            const legacyCode = lastRefreshState().groups[0].items.find((item: any) => item.name === 'Legacy_Code__c');
            expect(legacyCode.recipeNote).toBe('Pinned to a fixed value: its recipe line is not changed.');

            fs.mkdirSync(projectFile('objects', 'Account', 'fields', 'Score__c.field-meta.xml'));
            const recipeBefore = recipeText();
            await send({ command: 'applyObjectRefresh', refreshId: lastRefreshState().refreshId, itemIndexes: itemIndexesNamed('Legacy_Code__c', 'Score__c') });

            expect(warnings()).toEqual(['Account: copied 1 file from qa · qa@example.com.qa into the project and wrote 0 recipe lines. Not written: Account.Score__c: the project file is not a plain file, so it was left as it is.']);
            expect(fs.readFileSync(projectFile('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), 'utf-8')).toContain('<length>255</length>');
            expect(recipeText()).toBe(recipeBefore);

        });

        it('closes as cancelled, removing what it staged, when Cancel arrives while the files are compared', async () => {

            const { RecipeCockpitObjectRefresh } = await import('../RecipeCockpitObjectRefresh');
            const realCompare = RecipeCockpitObjectRefresh.compareStagedObject.bind(RecipeCockpitObjectRefresh);
            jest.spyOn(RecipeCockpitObjectRefresh, 'compareStagedObject').mockImplementation(async (comparisonRequest) => {
                await receivedMessageHandler({ command: 'cancelObjectRefresh', refreshId: lastRefreshState().refreshId });
                return realCompare(comparisonRequest);
            });

            await openAndRetrieve(['fields']);

            expect(warnings()).toEqual(['Getting the latest detail of Account from qa · qa@example.com.qa was cancelled. Nothing in the project or the recipe changed.']);
            expect(refreshStates().map(state => state.step)).not.toContain('review');
            expect(objectRefreshFolders()).toEqual([]);

        });

        it('removes what it staged when the panel is closed at the review', async () => {

            await openAndRetrieve(['fields']);
            expect(objectRefreshFolders()).toHaveLength(1);

            const disposePanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value.onDidDispose.mock.calls[0][0];
            disposePanel();

            expect(objectRefreshFolders()).toEqual([]);

        });

        it('removes only the package.xml it wrote when that name had to differ, never one it did not write', async () => {

            const { RecipeCockpitMetadataDeploy } = await import('../RecipeCockpitMetadataDeploy');
            let takenPackageXmlPath = '';
            let writtenPackageXmlPath = '';
            jest.spyOn(RecipeCockpitMetadataDeploy, 'writePackageXml').mockImplementation((_location, packageXmlFilePath: string, packageXml: string) => {
                takenPackageXmlPath = packageXmlFilePath;
                writtenPackageXmlPath = packageXmlFilePath.replace(/-package\.xml$/, '-2-package.xml');
                fs.writeFileSync(takenPackageXmlPath, 'another run\'s package.xml');
                fs.writeFileSync(writtenPackageXmlPath, packageXml);
                return writtenPackageXmlPath;
            });

            await openAndRetrieve(['fields']);
            await send({ command: 'cancelObjectRefresh', refreshId: lastRefreshState().refreshId });

            expect(fs.existsSync(writtenPackageXmlPath)).toBe(false);
            expect(fs.readFileSync(takenPackageXmlPath, 'utf-8')).toBe('another run\'s package.xml');

        });
    });

    describe('the panel', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawTreecipe = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };
        const refreshButtons = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'treeObjectRefresh');
        const dialogOf = (panel: Panel) => panel.findAll(panel.cockpitDialogHostElement, 'objectRefreshDialog')[0];
        const postedNamed = (panel: Panel, command: string) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === command);
        const stateMessage = (step: string, extra: Record<string, unknown> = {}) => ({ command: 'objectRefreshState', refreshId: 'refresh-1', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', step: step, kinds: [...OBJECT_REFRESH_KINDS], ...extra });
        const reviewGroups = [
            { kind: 'fields', label: 'Fields', unchangedCount: 3, unreadableCount: 1, items: [
                { kind: 'fields', name: 'Is_Priority__c', status: 'new', detail: 'Checkbox', differences: [], recipeNote: 'Adds one line to the recipe.' },
                { kind: 'fields', name: 'Legacy_Code__c', status: 'changed', detail: 'Text', differences: ['length: 50 → 255'], recipeNote: 'Rewrites its recipe line.' }
            ] },
            { kind: 'recordTypes', label: 'Record types', unchangedCount: 2, unreadableCount: 0, items: [] },
            { kind: 'globalValueSets', label: 'Global value sets', unchangedCount: 0, unreadableCount: 0, items: [
                { kind: 'globalValueSets', name: 'Regions', status: 'changed', detail: '3 values', differences: ['values: +North'], recipeNote: 'Rewrites the recipe line of Regions__c.' }
            ] }
        ];

        it('ends each object row of a card with a folder with the button, which posts only the row it is on', () => {

            const panel = drawTreecipe();
            const accountRow = panel.objectElements().find(objectElement => panel.objectNameOf(objectElement) === 'Account');
            const accountHeader = accountRow.children[0];
            // #611's "no fields selected" message follows the header details, hidden while a field is ticked
            const visibleHeaderChildren = accountHeader.children.filter(headerChild => !headerChild.classList.contains('hidden'));
            const accountButton = visibleHeaderChildren[visibleHeaderChildren.length - 1];

            expect(accountButton.classList.contains('treeObjectRefresh')).toBe(true);
            expect(panel.findAll(accountButton, 'objectRefreshButtonLabel').map(labelElement => labelElement.textContent)).toEqual([RECIPE_COCKPIT_OBJECT_REFRESH_LABEL]);
            // THE RED REFRESH ARROW COMES FIRST AND IS HIDDEN FROM A SCREEN READER: THE aria-label NAMES THE BUTTON
            expect(accountButton.children[0].attributes).toEqual({ 'class': 'objectRefreshGlyph', 'viewBox': RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX, 'aria-hidden': 'true', 'focusable': 'false' });
            expect(accountButton.children[0].children[0].attributes).toEqual({ 'd': RECIPE_COCKPIT_OBJECT_REFRESH_GLYPH_PATH });
            expect(refreshButtons(panel).length).toBe(panel.objectElements().filter(objectElement => panel.findAll(objectElement.children[0], 'treeObjectIncludeSpacer').length === 0).length);

            accountButton.dispatch('click');

            expect(postedNamed(panel, 'openObjectRefresh')).toEqual([{ command: 'openObjectRefresh', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiName: 'Account' }]);

        });

        it('draws step 1 over the inert cockpit: the org picker, every kind ticked, Next posting the kinds still ticked', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('choose'));

            const dialogElement = dialogOf(panel);
            expect(dialogElement.attributes.role).toBe('dialog');
            expect(panel.cockpitBodyElement.attributes.inert).toBe('');
            expect(panel.findAll(dialogElement, 'dataOrgView')).toHaveLength(1);
            // #617: THE DIALOG CHOOSES AN ORG, IT DOES NOT ADD ONE; BOTH BUTTONS STAY IN TARGET ORG MANAGER
            expect(panel.findAll(dialogElement, 'dataOrgSelect')).toHaveLength(1);
            expect(panel.findAll(dialogElement, 'dataOrgNewScratch')).toEqual([]);
            expect(panel.findAll(dialogElement, 'dataOrgAuthorize')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgNewScratch')).toHaveLength(1);
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgAuthorize')).toHaveLength(1);
            const kindChecks = panel.findAll(dialogElement, 'objectRefreshKindCheck');
            expect(kindChecks.map(checkElement => [checkElement.attributes['aria-label'], checkElement.attributes['aria-checked']])).toEqual([
                ['Fields', 'true'], ['Validation rules', 'true'], ['Record types', 'true'], ['Global value sets', 'true']
            ]);

            kindChecks[1].dispatch('click');
            kindChecks[2].dispatch('click');
            panel.findAll(dialogElement, 'objectRefreshNext')[0].dispatch('click');

            expect(postedNamed(panel, 'startObjectRefresh')).toEqual([{ command: 'startObjectRefresh', refreshId: 'refresh-1', kinds: ['fields', 'globalValueSets'] }]);

        });

        it('disables Next with no kind ticked, and on Cancel posts the cancel, closes and gives the cockpit back', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('choose', { kinds: ['fields'] }));
            const dialogElement = dialogOf(panel);

            panel.findAll(dialogElement, 'objectRefreshKindCheck')[0].dispatch('click');
            expect(panel.findAll(dialogElement, 'objectRefreshNext')[0].disabled).toBe(true);

            panel.findAll(dialogElement, 'objectRefreshCancel')[0].dispatch('click');

            expect(postedNamed(panel, 'cancelObjectRefresh')).toEqual([{ command: 'cancelObjectRefresh', refreshId: 'refresh-1' }]);
            expect(dialogOf(panel)).toBeUndefined();
            expect(panel.cockpitBodyElement.attributes.inert).toBeUndefined();

        });

        it('shows what it retrieves, from which org, with a Cancel that asks once', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('retrieving', { kinds: ['fields', 'recordTypes'], orgLabel: 'qa · qa@example.com.qa' }));
            const dialogElement = dialogOf(panel);

            expect(panel.findAll(dialogElement, 'objectRefreshProgress')[0].textContent).toBe('Retrieving the fields, record types of Account from qa · qa@example.com.qa…');
            const cancelElement = panel.findAll(dialogElement, 'objectRefreshCancel')[0];
            cancelElement.dispatch('click');
            cancelElement.dispatch('click');

            expect(postedNamed(panel, 'cancelObjectRefresh')).toHaveLength(1);
            expect(cancelElement.textContent).toBe('Cancelling…');

        });

        it('draws one folded group per kind; opened, a column table of its items, and Apply posts the indexes ticked across groups', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('review', { groups: reviewGroups, orgLabel: 'qa' }));
            const dialogElement = dialogOf(panel);
            const toggles = panel.findAll(dialogElement, 'objectRefreshGroupToggle');

            expect(toggles.map(toggleElement => panel.findAll(toggleElement, 'confirmSectionTitle')[0].textContent)).toEqual([
                'Fields · 1 new · 1 changed', 'Record types · Up to date', 'Global value sets · 1 changed'
            ]);
            expect(panel.findAll(dialogElement, 'objectRefreshItem')).toHaveLength(0);
            expect(panel.findAll(dialogElement, 'objectRefreshApply')[0].disabled).toBe(true);

            toggles[0].dispatch('click');
            toggles[2].dispatch('click');
            const rows = panel.findAll(dialogElement, 'objectRefreshItem');
            expect(rows.map(rowElement => rowElement.children.slice(1).map((cellElement: any) => cellElement.textContent || cellElement.children.map((child: any) => child.textContent).join(' | ')))).toEqual([
                ['Is_Priority__c', 'new', 'Checkbox', '', 'Adds one line to the recipe.'],
                ['Legacy_Code__c', 'changed', 'Text', 'length: 50 → 255', 'Rewrites its recipe line.'],
                ['Regions', 'changed', '3 values', 'values: +North', 'Rewrites the recipe line of Regions__c.']
            ]);
            expect(panel.findAll(dialogElement, 'objectRefreshGroupNote').map(noteElement => noteElement.textContent)).toEqual(['3 the same as the project.', '1 could not be read, so it was not compared.']);

            panel.findAll(rows[2], 'objectRefreshItemCheck')[0].dispatch('click');
            panel.findAll(rows[1], 'objectRefreshItemCheck')[0].dispatch('click');
            panel.findAll(dialogElement, 'objectRefreshApply')[0].dispatch('click');

            expect(postedNamed(panel, 'applyObjectRefresh')).toEqual([{ command: 'applyObjectRefresh', refreshId: 'refresh-1', itemIndexes: [1, 2] }]);

        });

        it('ticks a whole group with Select all, and none with Select none', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('review', { groups: reviewGroups }));
            const dialogElement = dialogOf(panel);
            panel.findAll(dialogElement, 'objectRefreshGroupToggle')[0].dispatch('click');

            panel.findAll(dialogElement, 'objectRefreshSelectAll')[0].dispatch('click');
            expect(panel.findAll(dialogElement, 'objectRefreshItemCheck').map(checkElement => checkElement.attributes['aria-checked'])).toEqual(['true', 'true']);
            panel.findAll(dialogElement, 'objectRefreshSelectNone')[0].dispatch('click');
            expect(panel.findAll(dialogElement, 'objectRefreshApply')[0].disabled).toBe(true);

        });

        it('steps aside for the confirmation, and comes back with the same items ticked and their group open', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('review', { groups: reviewGroups }));
            panel.postToPanel(stateMessage('confirming'));
            expect(dialogOf(panel)).toBeUndefined();

            panel.postToPanel(stateMessage('review', { groups: reviewGroups, tickedItemIndexes: [2] }));
            const dialogElement = dialogOf(panel);
            const checks = panel.findAll(dialogElement, 'objectRefreshItemCheck');

            expect(checks.map(checkElement => checkElement.attributes['aria-checked'])).toEqual(['true']);
            expect(panel.findAll(dialogElement, 'objectRefreshApply')[0].disabled).toBe(false);

        });

        it('says when nothing is new or changed, offering only Close', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('review', { groups: [{ kind: 'fields', label: 'Fields', unchangedCount: 4, unreadableCount: 0, items: [] }], orgLabel: 'qa' }));
            const dialogElement = dialogOf(panel);

            expect(panel.findAll(dialogElement, 'confirmSummary')[0].textContent).toBe('Account in qa holds nothing new or changed for what you chose.');
            expect(panel.findAll(dialogElement, 'objectRefreshApply')).toHaveLength(0);
            expect(panel.findAll(dialogElement, 'objectRefreshCancel')[0].textContent).toBe('Close');

        });

        it('draws no state for a model not on screen, and closes on a new model', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('choose', { renderSequence: 2 }));
            expect(dialogOf(panel)).toBeUndefined();

            panel.postToPanel(stateMessage('choose'));
            expect(dialogOf(panel)).toBeDefined();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 4 });

            expect(dialogOf(panel)).toBeUndefined();
            expect(panel.cockpitBodyElement.attributes.inert).toBeUndefined();

        });

        it('is Cancel on Escape, and keeps Tab inside the dialog', () => {

            const panel = drawTreecipe();
            panel.postToPanel(stateMessage('review', { groups: reviewGroups }));
            const dialogElement = dialogOf(panel);

            for ( let tabPress = 0; tabPress < 8; tabPress++ ) {
                panel.activeElement().dispatch('keydown', { key: 'Tab' });
                expect(panel.findAll(dialogElement, panel.activeElement().className.split(' ')[0]).length > 0 || panel.activeElement() === panel.findAll(dialogElement, 'confirmBody')[0]).toBe(true);
            }

            panel.activeElement().dispatch('keydown', { key: 'Escape' });

            expect(postedNamed(panel, 'cancelObjectRefresh')).toHaveLength(1);
            expect(dialogOf(panel)).toBeUndefined();

        });

    });

});
