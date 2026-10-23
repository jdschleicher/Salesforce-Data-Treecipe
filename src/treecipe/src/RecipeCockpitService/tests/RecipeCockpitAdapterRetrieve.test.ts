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
    RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL,
    RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL,
    RECIPE_COCKPIT_ADAPTER_APPLY_LABEL,
    RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON,
    RECIPE_COCKPIT_ADAPTER_APPLYING_LABEL,
    RECIPE_COCKPIT_ADAPTER_AUDIT_TRAIL_HEADING,
    RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL,
    RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL,
    RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_NOTE,
    RECIPE_COCKPIT_ADAPTER_SOURCE_TRACKING_HEADING,
    RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL,
    RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE,
    RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL,
    RECIPE_COCKPIT_ADAPTER_RETRIEVE_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { RecipeCockpitOrgChangeDetection } from '../RecipeCockpitOrgChangeDetection';
import { IPanelScriptOptions, runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const fieldXml = (fieldApiName: string, fieldType: string, extra = '') => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <fullName>${fieldApiName}</fullName>`,
    `    <label>${fieldApiName}</label>`,
    extra,
    `    <type>${fieldType}</type>`,
    '</CustomField>',
    ''
].join('\n');

const retrieveRequest = (renderSequence: number, overrides: Record<string, unknown> = {}) => ({
    command: 'retrieveAdapterMetadata',
    treeKey: ACCOUNT_TREE_KEY,
    renderSequence: renderSequence,
    parentObjectApiName: 'Account',
    ...overrides
});

// WHAT THE HOST SENDS AFTER A RETRIEVE: Legacy_Code__c CHANGED, Is_Priority__c NEW, AND A FIELD ONLY THE ORG HOLDS THAT THE RECIPE LISTS TOO
const changesMessage = (renderSequence: number) => ({
    command: 'adapterMetadataChanges',
    renderSequence: renderSequence,
    treeKey: ACCOUNT_TREE_KEY,
    orgLabel: 'qa · qa@example.com.qa',
    objects: [
        {
            objectApiName: 'Account',
            isRetrieved: true,
            unchangedFieldCount: 3,
            unreadableFieldCount: 0,
            fieldChanges: [
                { fieldApiName: 'Is_Priority__c', status: 'new', fieldType: 'Checkbox', fieldLabel: 'Is Priority', differences: [] },
                { fieldApiName: 'Legacy_Code__c', status: 'changed', fieldType: 'Text', fieldLabel: 'Legacy Code', differences: ['length: 50 → 255'] }
            ]
        },
        { objectApiName: 'Contact', isRetrieved: true, unchangedFieldCount: 2, unreadableFieldCount: 0, fieldChanges: [] },
        { objectApiName: 'OtherChildObject__c', isRetrieved: false, unchangedFieldCount: 0, unreadableFieldCount: 0, fieldChanges: [] }
    ]
});

describe('RecipeCockpitService, the Treecipe Adapter\'s Retrieve latest metadata (#445)', () => {

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

        const notRunning = { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY };

        it('routes the parent and the objects under it, planned by the host, from the selected sandbox', () => {

            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3), withSandbox(buildPanelState()))).toEqual({
                kind: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectApiNames: ['Account', 'Contact', 'OtherChildObject__c'], isOrgPrompted: false
            });
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3, { parentObjectApiName: 'Contact' }), withSandbox(buildPanelState())))
                .toMatchObject({ objectApiNames: ['Contact', 'OtherChildObject__c'] });

        });

        it('asks for the org, as the load does, when none is chosen', () => {

            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3), buildPanelState())).toMatchObject({ kind: 'retrieveAdapterMetadata', isOrgPrompted: true });

        });

        it.each([
            ['an org that is not a sandbox', (panelState: IRecipeCockpitPanelState) => withSandbox(panelState, false), expect.stringContaining('is not a sandbox or scratch org')],
            ['an org not checked yet', (panelState: IRecipeCockpitPanelState) => withSandbox(panelState, null), expect.stringContaining('has not been checked yet')],
            ['a parent the card does not list', (panelState: IRecipeCockpitPanelState) => { withSandbox(panelState); return panelState; }, 'Nothing was retrieved: the parent object is not an object of this treecipe.'],
            ['an insert holding the selection', (panelState: IRecipeCockpitPanelState) => { withSandbox(panelState).insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; return panelState; }, RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL],
            ['a permission set assignment holding the selection', (panelState: IRecipeCockpitPanelState) => { withSandbox(panelState).permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY } as any; return panelState; }, RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL],
            ['a metadata deploy holding the selection', (panelState: IRecipeCockpitPanelState) => { withSandbox(panelState).metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' } as any; return panelState; }, RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL]
        ])('refuses %s, saying why', (description, prepare, refusalText) => {

            const panelMessage = description.startsWith('a parent') ? retrieveRequest(3, { parentObjectApiName: 'Lead' }) : retrieveRequest(3);

            expect(RecipeCockpitService.routePanelMessage(panelMessage, prepare(buildPanelState()))).toEqual({ kind: 'refuseUpdaterLoad', refusalText: refusalText, hostMessage: notRunning });

        });

        it('refuses a card key or parent that is not text, and a scratch org run holding the selection', () => {

            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3, { treeKey: 7 }), withSandbox(buildPanelState()))).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: { ...notRunning, treeKey: '' } });
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3, { parentObjectApiName: 7 }), withSandbox(buildPanelState()))).toMatchObject({ refusalText: 'Nothing was retrieved: the parent object is not an object of this treecipe.' });

            const panelState = withSandbox(buildPanelState());
            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true } as any;
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3), panelState)).toMatchObject({ refusalText: RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL });

            const unconfirmedState = buildPanelState();
            unconfirmedState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3), unconfirmedState)).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: notRunning });

        });

        it('answers with the running state while a load, generation, update or retrieve holds the window, and refuses a card or model not on screen', () => {

            const running = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' } as const;
            const panelState = withSandbox(buildPanelState());
            panelState.updaterLoadStateMessage = running;
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3), panelState)).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: running });

            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(2), withSandbox(buildPanelState()))).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: notRunning });
            expect(RecipeCockpitService.routePanelMessage(retrieveRequest(3, { treeKey: 'Lead-ONLY' }), withSandbox(buildPanelState())))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: { ...notRunning, treeKey: 'Lead-ONLY' } });

        });

    });

    describe('routePanelMessage, Apply retrieved files to project', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.adapterMetadataChangesMessage = changesMessage(3) as any;
            panelState.adapterRetrieveStagingFolderPath = '/workspace/treecipe/OrgOperations/qa/1-adapter-retrieve';
            return panelState;
        };
        const applyRequest = (overrides: Record<string, unknown> = {}) => ({ command: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, ...overrides });
        const notRunning = { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY };

        afterEach(() => {
            (RecipeCockpitService as any).isMetadataDeployInFlight = false;
            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
        });

        it('routes the changes on screen, carrying nothing but the card and the model', () => {

            expect(RecipeCockpitService.routePanelMessage(applyRequest({ files: ['/etc/passwd'] }), buildPanelState())).toEqual({ kind: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });

        });

        it.each([
            ['another card', applyRequest({ treeKey: 'Lead-ONLY' }), (panelState: IRecipeCockpitPanelState) => panelState],
            ['a card key that is not text', applyRequest({ treeKey: 7 }), (panelState: IRecipeCockpitPanelState) => panelState],
            ['another model', applyRequest({ renderSequence: 2 }), (panelState: IRecipeCockpitPanelState) => panelState],
            ['changes found on an older model', applyRequest(), (panelState: IRecipeCockpitPanelState) => { panelState.recipeDataMessage!.renderSequence = 4; return panelState; }],
            ['no retrieve on screen', applyRequest(), (panelState: IRecipeCockpitPanelState) => { panelState.adapterMetadataChangesMessage = undefined; return panelState; }],
            ['no staged files held', applyRequest(), (panelState: IRecipeCockpitPanelState) => { panelState.adapterRetrieveStagingFolderPath = undefined; return panelState; }],
            ['a card that cannot be named', applyRequest(), (panelState: IRecipeCockpitPanelState) => { panelState.treeHistoryAllowLists.nameableTreeKeys = new Set(); return panelState; }]
        ])('refuses %s, quietly', (_description, panelMessage, prepare) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, prepare(buildPanelState()))).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: expect.objectContaining({ isRunning: false }) });

        });

        it('answers with the running state while a load, generation, update, restore or retrieve holds the window', () => {

            const panelState = buildPanelState();
            const running = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'retrieve' } as const;
            panelState.updaterLoadStateMessage = running;

            expect(RecipeCockpitService.routePanelMessage(applyRequest(), panelState)).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: running });

        });

        it.each([
            ['a metadata deploy', (panelState: IRecipeCockpitPanelState) => { (RecipeCockpitService as any).isMetadataDeployInFlight = true; return panelState; }],
            ['a Troubleshooting retrieve', (panelState: IRecipeCockpitPanelState) => { (RecipeCockpitService as any).isMetadataRetrieveInFlight = true; return panelState; }],
            ['a recipe write', (panelState: IRecipeCockpitPanelState) => { panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true } as any; return panelState; }],
            ['a generation', (panelState: IRecipeCockpitPanelState) => { panelState.isGenerateTreecipeInFlight = true; return panelState; }]
        ])('refuses while %s runs, saying why', (_description, prepare) => {

            expect(RecipeCockpitService.routePanelMessage(applyRequest(), prepare(buildPanelState()))).toEqual({ kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL, hostMessage: notRunning });

        });

    });

    describe('the host, against a faked org selection and CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let cliCalls: string[][];
        let cliAnswer: (cliArguments: string[]) => { stdout: string; stderr: string; exitCode: number | null; timedOut?: boolean };
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([warningText]) => warningText);
        const informations = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([informationText]) => informationText);
        const packageDirectoryFiles = () => fs.readdirSync(path.join(workspaceRoot, 'force-app'), { recursive: true } as any).map(String).sort()
            .map(relativePath => [relativePath, fs.statSync(path.join(workspaceRoot, 'force-app', relativePath)).isFile() ? fs.readFileSync(path.join(workspaceRoot, 'force-app', relativePath), 'utf-8') : '']);

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

        // THE ORG'S ANSWER: THE FILES IT WOULD WRITE UNDER --output-dir, AND A --json SUCCESS
        const succeedWithStagedFiles = (cliArguments: string[]) => {
            const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
            const stagedFieldsFolder = path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', 'Account', 'fields');
            fs.mkdirSync(stagedFieldsFolder, { recursive: true });
            fs.writeFileSync(path.join(stagedFieldsFolder, 'Legacy_Code__c.field-meta.xml'), fieldXml('Legacy_Code__c', 'Text', '    <length>255</length>'));
            fs.writeFileSync(path.join(stagedFieldsFolder, 'Is_Priority__c.field-meta.xml'), fieldXml('Is_Priority__c', 'Checkbox'));
            fs.mkdirSync(path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', 'Contact', 'fields'), { recursive: true });
            return { stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), stderr: '', exitCode: 0 };
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapter-retrieve-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));
            const localFieldsFolder = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields');
            fs.mkdirSync(localFieldsFolder, { recursive: true });
            fs.writeFileSync(path.join(localFieldsFolder, 'Legacy_Code__c.field-meta.xml'), fieldXml('Legacy_Code__c', 'Text', '    <length>50</length>'));

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            cliAnswer = succeedWithStagedFiles;
            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
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
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockImplementation(async (cliArguments: string[]) => {
                cliCalls.push(cliArguments);
                return cliAnswer(cliArguments);
            });

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('retrieves the objects into a staging folder under treecipe/OrgOperations, never a package directory', async () => {

            await openCockpit();
            selectSandbox();
            const packageDirectoryBefore = packageDirectoryFiles();

            await send(retrieveRequest(lastRenderSequence()));

            expect(cliCalls).toHaveLength(1);
            const cliArguments = cliCalls[0];
            const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
            const manifestPath = cliArguments[cliArguments.indexOf('--manifest') + 1];
            expect(cliArguments.slice(0, 6)).toEqual(['project', 'retrieve', 'start', '--json', '--target-org', SANDBOX_ORG.username]);
            expect(outputDirectory).toMatch(/^treecipe\/OrgOperations\/qa@example\.com\.qa\/\d{8}-\d{6}-adapter-retrieve$/);
            expect(manifestPath).toBe(`${outputDirectory}-package.xml`);
            expect(fs.readFileSync(path.join(workspaceRoot, manifestPath), 'utf-8')).toContain('<members>Account</members>\n        <members>Contact</members>\n        <members>OtherChildObject__c</members>\n        <name>CustomObject</name>');
            expect(packageDirectoryFiles()).toEqual(packageDirectoryBefore);

        });

        it('posts what is new and changed in the org, keeps the staging folder on the host only, and says so once', async () => {

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            const [changes] = postedNamed('adapterMetadataChanges');
            expect(changes).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa · qa@example.com.qa' });
            expect(changes.objects.map((objectChanges: any) => [objectChanges.objectApiName, objectChanges.isRetrieved, objectChanges.fieldChanges.map((fieldChange: any) => [fieldChange.fieldApiName, fieldChange.status])])).toEqual([
                ['Account', true, [['Is_Priority__c', 'new'], ['Legacy_Code__c', 'changed']]],
                ['Contact', true, []],
                ['OtherChildObject__c', false, []]
            ]);
            expect(JSON.stringify(changes)).not.toContain(workspaceRoot);
            expect(panelState().adapterRetrieveStagingFolderPath).toMatch(/adapter-retrieve$/);
            expect(warnings()).toEqual([expect.stringContaining('did not return OtherChildObject__c')]);
            expect(warnings()[0]).toContain('1 field is new and 1 field changed in the org against this project');
            expect(postedNamed('updaterLoadState').map(stateMessage => [stateMessage.isRunning, stateMessage.runKind])).toEqual([[true, 'retrieve'], [false, undefined]]);

        });

        it('says it found nothing as information when every object came back unchanged', async () => {

            cliAnswer = (cliArguments: string[]) => {
                const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
                ['Account', 'Contact', 'OtherChildObject__c'].forEach(objectApiName => fs.mkdirSync(path.join(workspaceRoot, outputDirectory, 'objects', objectApiName, 'fields'), { recursive: true }));
                return { stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '', exitCode: 0 };
            };

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            expect(informations()).toEqual([expect.stringContaining('No field is new or changed against this project. Nothing in the project changed.')]);

        });

        it('keeps what the last retrieve marked when the next fails, and offers its output', async () => {

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));
            const firstChanges = panelState().adapterMetadataChangesMessage;

            cliAnswer = () => ({ stdout: JSON.stringify({ status: 1, message: 'INVALID_SESSION_ID' }), stderr: '', exitCode: 1 });
            (vscode.window.showWarningMessage as jest.Mock).mockClear();
            await send(retrieveRequest(lastRenderSequence()));

            expect(postedNamed('adapterMetadataChanges')).toHaveLength(1);
            expect(panelState().adapterMetadataChangesMessage).toBe(firstChanges);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)).toEqual([
                expect.stringContaining('could not be retrieved from qa · qa@example.com.qa: INVALID_SESSION_ID'),
                'View output'
            ]);

        });

        it('changes nothing when the reader cancels', async () => {

            cliAnswer = () => { cancellationToken.isCancellationRequested = true; return { stdout: '', stderr: '', exitCode: null }; };
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => {
                const result = await progressTask({ report: jest.fn() }, cancellationToken);
                cancellationToken.onCancellationRequested.mock.calls.forEach(([listener]) => listener());
                return result;
            });

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            expect(postedNamed('adapterMetadataChanges')).toEqual([]);
            expect(warnings()).toEqual([expect.stringContaining('was cancelled. Nothing in the project changed.')]);

        });

        it('retrieves nothing from a project with no sfdx-project.json, asking for no org', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await openCockpit();
            await send(retrieveRequest(lastRenderSequence()));

            expect(cliCalls).toEqual([]);
            expect(promptSpy).not.toHaveBeenCalled();
            expect(warnings()).toEqual([expect.stringMatching(/^Nothing was retrieved: /)]);

        });

        it('asks for the org through the load\'s prompt when none is chosen', async () => {

            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (listing: any) => (await listing).orgDetails[0]);
            jest.spyOn(require('../../SalesforceOrgService/SalesforceOrgService').SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgReasonCounts: {} });
            jest.spyOn(RecipeCockpitService as any, 'selectDataOrg').mockImplementation(async (_cockpitPanel: any, selectedPanelState: any, orgIndex: any) => {
                selectedPanelState.dataOrgSelection = { orgIndex: orgIndex, orgDetail: selectedPanelState.dataOrgDetails[orgIndex], requestSequence: 2, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            });

            await openCockpit();
            await send(retrieveRequest(lastRenderSequence()));

            expect(promptSpy).toHaveBeenCalledWith(expect.anything(), RECIPE_COCKPIT_ADAPTER_RETRIEVE_ORG_PLACEHOLDER);
            expect(cliCalls).toHaveLength(1);
            expect(panelState().isUpdaterOrgPromptOpen).toBe(false);

        });

        it('answers a retrieve that reaches the host while another run holds the window with that run, starting nothing', async () => {

            await openCockpit();
            selectSandbox();
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            await send(retrieveRequest(lastRenderSequence()));

            expect(cliCalls).toEqual([]);
            expect(postedNamed('updaterLoadState')).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);

            const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY', runKind: 'generate' };
            (RecipeCockpitService as any).updaterLoadRunStateMessage = runningState;
            await send(retrieveRequest(lastRenderSequence()));
            expect(postedNamed('updaterLoadState').at(-1)).toEqual(runningState);
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;

        });

        it('retrieves nothing when the prompt is dismissed', async () => {

            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValue(undefined);
            jest.spyOn(require('../../SalesforceOrgService/SalesforceOrgService').SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgReasonCounts: {} });

            await openCockpit();
            await send(retrieveRequest(lastRenderSequence()));

            expect(cliCalls).toEqual([]);
            expect(warnings()).toEqual([]);

        });

        it('retrieves nothing when the staging folder cannot be made, or the argv cannot be built', async () => {

            await openCockpit();
            selectSandbox();

            const makeSpy = jest.spyOn(RecipeCockpitOrgChangeDetection, 'makeStagingFolder').mockReturnValue(undefined);
            await send(retrieveRequest(lastRenderSequence()));
            expect(warnings().at(-1)).toBe('Nothing was retrieved: the staging folder could not be made under treecipe/OrgOperations in this workspace.');
            makeSpy.mockRestore();

            jest.spyOn(RecipeCockpitOrgChangeDetection, 'buildRetrieveArguments').mockImplementation(() => { throw new Error('The staging folder is not under treecipe/, so nothing was retrieved.'); });
            await send(retrieveRequest(lastRenderSequence()));
            expect(warnings().at(-1)).toBe('Nothing was retrieved: The staging folder is not under treecipe/, so nothing was retrieved.');
            expect(cliCalls).toEqual([]);

        });

        it('marks nothing when the run on screen changed while the org answered', async () => {

            cliAnswer = (cliArguments: string[]) => {
                const answer = succeedWithStagedFiles(cliArguments);
                panelState().recipeDataMessage = { ...panelState().recipeDataMessage!, renderSequence: 99 };
                return answer;
            };

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            expect(postedNamed('adapterMetadataChanges')).toEqual([]);
            expect(warnings()).toEqual([expect.stringContaining('the run on screen changed meanwhile, so nothing was marked')]);

        });

        it('names an org with no alias by its username and a renamed card by its name, and offers the output when a field file could not be read', async () => {

            cliAnswer = (cliArguments: string[]) => {
                const answer = succeedWithStagedFiles(cliArguments);
                const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
                ['Contact', 'OtherChildObject__c'].forEach(objectApiName => fs.mkdirSync(path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', objectApiName, 'fields'), { recursive: true }));
                fs.writeFileSync(path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', 'Contact', 'fields', 'Broken__c.field-meta.xml'), '<<not xml');
                return answer;
            };
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('View output');
            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);

            await openCockpit();
            panelState().dataOrgDetails = [{ targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa' } as any];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: { targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa' } as any, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            panelState().recipeDataMessage!.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!.customName = 'Accounts';
            await send(retrieveRequest(lastRenderSequence()));
            await flushAsyncWork();

            expect(warnings()).toEqual([expect.stringMatching(/^Retrieved the latest metadata of 3 objects of Accounts from qa@example\.com\.qa\. .* 1 field file could not be read, so it was not compared\./)]);
            expect(postedNamed('adapterMetadataChanges')[0].orgLabel).toBe('qa@example.com.qa');
            expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/-adapter-retrieve\.json$/), workspaceRoot, expect.any(String));

        });

        it('says they were not compared when several field files could not be read', async () => {

            cliAnswer = (cliArguments: string[]) => {
                const answer = succeedWithStagedFiles(cliArguments);
                const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
                ['Contact', 'OtherChildObject__c'].forEach(objectApiName => fs.mkdirSync(path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', objectApiName, 'fields'), { recursive: true }));
                ['Broken__c', 'Broken2__c'].forEach(fieldApiName => fs.writeFileSync(path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', 'Contact', 'fields', `${fieldApiName}.field-meta.xml`), '<<not xml'));
                return answer;
            };
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('View output');
            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);

            await openCockpit();
            panelState().dataOrgDetails = [{ targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa' } as any];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: { targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa' } as any, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            panelState().recipeDataMessage!.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!.customName = 'Accounts';
            await send(retrieveRequest(lastRenderSequence()));
            await flushAsyncWork();

            expect(warnings()).toEqual([expect.stringMatching(/^Retrieved the latest metadata of 3 objects of Accounts from qa@example\.com\.qa\. .* 2 field files could not be read, so they were not compared\./)]);
            expect(postedNamed('adapterMetadataChanges')[0].orgLabel).toBe('qa@example.com.qa');
            expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/-adapter-retrieve\.json$/), workspaceRoot, expect.any(String));

        });

        it('offers no output when the CLI\'s answer was too large to read', async () => {

            cliAnswer = () => ({ stdout: '', stderr: '', exitCode: null, isOutputTooLarge: true } as any);

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)).toEqual([expect.stringContaining('could not be retrieved')]);
            expect(fs.readdirSync(path.join(workspaceRoot, 'treecipe', 'OrgOperations', SANDBOX_ORG.username)).filter(fileName => fileName.endsWith('.json'))).toEqual([]);

        });

        it('says the CLI could not be run, with no output to offer', async () => {

            cliAnswer = () => ({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) } as any);

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)).toEqual([expect.stringContaining('The Salesforce CLI, sf, could not be run')]);

        });

        describe('what the org says beside the files', () => {

            const { Org } = jest.requireMock('@salesforce/core');
            let connection: any;

            beforeEach(() => {
                SalesforceOrgService.clearDescribeCache();
                connection = {
                    describe: jest.fn().mockImplementation(async (objectApiName: string) => objectApiName === 'OtherChildObject__c'
                        ? Promise.reject(Object.assign(new Error('not found'), { errorCode: 'NOT_FOUND' }))
                        : { name: objectApiName, label: objectApiName === 'Account' ? 'Customer' : objectApiName, fields: [], childRelationships: objectApiName === 'Account'
                            ? [{ childSObject: 'Gadget__c', field: 'Account__c' }, { childSObject: 'Contact', field: 'AccountId' }, { childSObject: 'OtherChildObject__c', field: 'Account__c' }]
                            : [] }),
                    query: jest.fn().mockResolvedValue({ records: [
                        { Display: 'Created custom field Is Priority on Customer', CreatedDate: '2026-10-21T09:00:00Z', CreatedBy: { Name: 'Ada' } },
                        { Display: 'Changed Opportunity settings' }
                    ] }),
                    tooling: { query: jest.fn().mockResolvedValue({ records: [{ MemberType: 'CustomField', MemberName: 'Account.Is_Priority__c', LastModifiedDate: '2026-10-21T09:00:00.000+0000' }] }) }
                };
                (Org.create as jest.Mock).mockResolvedValue({ getConnection: () => connection });
            });

            afterEach(() => {
                (Org.create as jest.Mock).mockReset();
                SalesforceOrgService.clearDescribeCache();
            });

            it('lists source tracking and audit trail rows naming the tree\'s objects, and the custom child objects the tree lacks', async () => {

                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));

                const [changes] = postedNamed('adapterMetadataChanges');
                expect(Org.create).toHaveBeenCalledWith({ aliasOrUsername: SANDBOX_ORG.username });
                expect(changes.hints.sourceTracking.rows).toEqual([{ objectApiName: 'Account', text: 'CustomField Account.Is_Priority__c', changedAt: '2026-10-21T09:00:00.000+0000' }]);
                expect(changes.hints.auditTrail.rows).toEqual([{ objectApiName: 'Account', text: 'Created custom field Is Priority on Customer · Ada', changedAt: '2026-10-21T09:00:00Z' }]);
                expect(changes.objects[0].newChildObjects).toEqual([{ childObjectApiName: 'Gadget__c', fieldApiName: 'Account__c' }]);
                expect(changes.objects[1]).not.toHaveProperty('newChildObjects');
                expect(changes.childObjectsNote).toBe('1 object could not be described in the org, so its new child objects are not listed.');

            });

            it('says nothing about child objects when every object was described', async () => {

                connection.describe.mockImplementation(async (objectApiName: string) => ({ name: objectApiName, label: objectApiName, fields: [] }));
                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));

                const [changes] = postedNamed('adapterMetadataChanges');
                expect(changes).not.toHaveProperty('childObjectsNote');
                expect(changes.objects.some((objectChanges: any) => 'newChildObjects' in objectChanges)).toBe(false);

            });

            it('describes the objects afresh, since the org just changed', async () => {

                const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));

                expect(clearSpy.mock.calls).toEqual(expect.arrayContaining([[SANDBOX_ORG.username, 'Account'], [SANDBOX_ORG.username, 'Contact'], [SANDBOX_ORG.username, 'OtherChildObject__c']]));

            });

            it('notes what it could not read when the org cannot be connected to, still marking from the files', async () => {

                (Org.create as jest.Mock).mockRejectedValue(new Error('expired access token 00D!secret'));
                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));

                const [changes] = postedNamed('adapterMetadataChanges');
                expect(changes.objects[0].fieldChanges).toHaveLength(2);
                expect(changes.hints.sourceTracking.note).toContain('could not be connected to');
                expect(changes.hints.auditTrail.note).toContain('could not be connected to');
                expect(changes.childObjectsNote).toContain('new child objects are not listed');
                expect(JSON.stringify(changes)).not.toContain('secret');

            });

            it('notes that no child object is listed when the describes themselves throw', async () => {

                jest.spyOn(SalesforceOrgService, 'describeObjects').mockRejectedValue(new Error('describe failed'));
                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));

                const [changes] = postedNamed('adapterMetadataChanges');
                expect(changes.childObjectsNote).toBe('3 objects could not be described in the org, so their new child objects are not listed.');
                expect(changes.hints.sourceTracking.rows).toHaveLength(1);

            });

        });

        describe('Apply retrieved files to project', () => {

            const applyRequest = () => ({ command: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: panelState().recipeDataMessage!.renderSequence });
            const localFieldPath = (fieldApiName: string) => path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', `${fieldApiName}.field-meta.xml`);
            let confirmSpy: jest.SpyInstance;

            const retrieveFirst = async () => {
                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));
                (vscode.window.showWarningMessage as jest.Mock).mockClear();
                (vscode.window.showInformationMessage as jest.Mock).mockClear();
                postedPanelMessages = [];
            };

            beforeEach(() => {
                confirmSpy = jest.spyOn(RecipeCockpitService, 'confirmInPanel').mockResolvedValue(RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL);
                (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            });

            afterEach(() => {
                (RecipeCockpitService as any).isMetadataDeployInFlight = false;
            });

            it('asks first, naming each file it overwrites and adds, then copies them and marks again from the files', async () => {

                await retrieveFirst();
                await send(applyRequest());

                expect(confirmSpy).toHaveBeenCalledTimes(1);
                const [title, confirmOptions, confirmLabel] = confirmSpy.mock.calls[0];
                expect(title).toBe('Apply 2 field files retrieved from qa · qa@example.com.qa to this project?');
                expect(confirmOptions.isDestructive).toBe(true);
                expect(confirmOptions.detail).toContain('Overwritten with the org\'s version (1):\nforce-app/main/default/objects/Account/fields/Legacy_Code__c.field-meta.xml');
                expect(confirmOptions.detail).toContain('Added (1):\nforce-app/main/default/objects/Account/fields/Is_Priority__c.field-meta.xml');
                expect(confirmLabel).toBe(RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL);

                expect(fs.readFileSync(localFieldPath('Legacy_Code__c'), 'utf-8')).toContain('<length>255</length>');
                expect(fs.readFileSync(localFieldPath('Is_Priority__c'), 'utf-8')).toContain('<type>Checkbox</type>');
                const [remarked] = postedNamed('adapterMetadataChanges');
                expect(remarked.objects[0].fieldChanges).toEqual([]);
                expect(panelState().adapterMetadataChangesMessage).toBe(remarked);
                expect(postedNamed('updaterLoadState').map(stateMessage => [stateMessage.isRunning, stateMessage.runKind])).toEqual([[true, 'apply'], [false, undefined]]);
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
                    expect.stringMatching(/^Applied 2 field files retrieved from qa · qa@example\.com\.qa to this project\. Run Generate Treecipe/),
                    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL
                );

            });

            it('keeps the child objects the retrieve listed when it marks again', async () => {

                await openCockpit();
                selectSandbox();
                await send(retrieveRequest(lastRenderSequence()));
                const retrieved = panelState().adapterMetadataChangesMessage!;
                panelState().adapterMetadataChangesMessage = { ...retrieved, objects: retrieved.objects.map(objectChanges => objectChanges.objectApiName === 'Account' ? { ...objectChanges, newChildObjects: [{ childObjectApiName: 'Gadget__c', fieldApiName: 'Account__c' }], moreNewChildObjectCount: 0 } : objectChanges) };
                postedPanelMessages = [];

                await send(applyRequest());

                const [remarked] = postedNamed('adapterMetadataChanges');
                expect(remarked.objects[0].newChildObjects).toEqual([{ childObjectApiName: 'Gadget__c', fieldApiName: 'Account__c' }]);
                expect(remarked.objects[1]).not.toHaveProperty('newChildObjects');

            });

            it('names only what it overwrites, or only what it adds, for one file', async () => {

                await retrieveFirst();
                const stagedFolder = path.join(panelState().adapterRetrieveStagingFolderPath!, 'main', 'default', 'objects', 'Account', 'fields');
                fs.rmSync(path.join(stagedFolder, 'Is_Priority__c.field-meta.xml'));
                await send(applyRequest());

                expect(confirmSpy.mock.calls[0][0]).toBe('Apply 1 field file retrieved from qa · qa@example.com.qa to this project?');
                expect(confirmSpy.mock.calls[0][1].detail).not.toContain('Added');

                fs.writeFileSync(path.join(stagedFolder, 'Is_Priority__c.field-meta.xml'), fieldXml('Is_Priority__c', 'Checkbox'));
                await send(applyRequest());

                expect(confirmSpy.mock.calls[1][1].detail).toMatch(/^Added \(1\):/);
                expect(confirmSpy.mock.calls[1][1].detail).not.toContain('Overwritten');

            });

            it('answers with the state it is not running when the window was held without one', async () => {

                await retrieveFirst();
                (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
                (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;

                await (RecipeCockpitService as any).applyAdapterRetrievedFilesFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: panelState().recipeDataMessage!.renderSequence });

                expect(postedNamed('updaterLoadState')).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);
                (RecipeCockpitService as any).isUpdaterLoadInFlight = false;

            });

            it('writes nothing when the reader cancels', async () => {

                await retrieveFirst();
                const legacyBefore = fs.readFileSync(localFieldPath('Legacy_Code__c'), 'utf-8');
                confirmSpy.mockResolvedValue(undefined);

                await send(applyRequest());

                expect(fs.readFileSync(localFieldPath('Legacy_Code__c'), 'utf-8')).toBe(legacyBefore);
                expect(fs.existsSync(localFieldPath('Is_Priority__c'))).toBe(false);
                expect(postedNamed('adapterMetadataChanges')).toEqual([]);
                expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

            });

            it('writes nothing when the files changed while it asked', async () => {

                await retrieveFirst();
                const stagedFolder = path.join(panelState().adapterRetrieveStagingFolderPath!, 'main', 'default', 'objects', 'Account', 'fields');
                confirmSpy.mockImplementation(async () => {
                    fs.rmSync(path.join(stagedFolder, 'Is_Priority__c.field-meta.xml'));
                    return RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL;
                });

                await send(applyRequest());

                expect(fs.existsSync(localFieldPath('Is_Priority__c'))).toBe(false);
                expect(fs.readFileSync(localFieldPath('Legacy_Code__c'), 'utf-8')).toContain('<length>50</length>');
                expect(warnings()).toEqual([expect.stringContaining('changed while the confirmation was open')]);

            });

            it('writes nothing when a metadata deploy started while it asked', async () => {

                await retrieveFirst();
                confirmSpy.mockImplementation(async () => {
                    (RecipeCockpitService as any).isMetadataDeployInFlight = true;
                    return RECIPE_COCKPIT_ADAPTER_APPLY_CONFIRM_LABEL;
                });

                await send(applyRequest());

                expect(fs.existsSync(localFieldPath('Is_Priority__c'))).toBe(false);
                expect(warnings()).toEqual([RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL]);

            });

            it('says there is nothing to apply when the files already match, asking nothing', async () => {

                await retrieveFirst();
                const stagedFolder = path.join(panelState().adapterRetrieveStagingFolderPath!, 'main', 'default', 'objects', 'Account', 'fields');
                fs.copyFileSync(path.join(stagedFolder, 'Legacy_Code__c.field-meta.xml'), localFieldPath('Legacy_Code__c'));
                fs.copyFileSync(path.join(stagedFolder, 'Is_Priority__c.field-meta.xml'), localFieldPath('Is_Priority__c'));

                await send(applyRequest());

                expect(confirmSpy).not.toHaveBeenCalled();
                expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(`Nothing was applied: ${RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON}`);

            });

            it('applies nothing from a project whose sfdx-project.json cannot be read', async () => {

                await retrieveFirst();
                fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ not json');

                await send(applyRequest());

                expect(confirmSpy).not.toHaveBeenCalled();
                expect(warnings()).toEqual([expect.stringMatching(/^Nothing was applied: /)]);

            });

            it('names each file it could not write, as a warning that still offers Generate Treecipe for the rest', async () => {

                await retrieveFirst();
                jest.spyOn(RecipeCockpitOrgChangeDetection, 'copyFieldFiles').mockReturnValue({ copiedCount: 1, failures: ['Account.Is_Priority__c: its folder is not inside this workspace'] });

                await send(applyRequest());

                expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Applied 1 field file retrieved from qa · qa@example.com.qa to this project. 1 file was not written: Account.Is_Priority__c: its folder is not inside this workspace.'),
                    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL
                );

            });

            it('offers nothing to follow when no file could be written, and keeps quiet about a run on screen that changed', async () => {

                await retrieveFirst();
                jest.spyOn(RecipeCockpitOrgChangeDetection, 'copyFieldFiles').mockImplementation(() => {
                    panelState().adapterMetadataChangesMessage = undefined;
                    return { copiedCount: 0, failures: ['Account.A__c: x', 'Account.B__c: y'] };
                });

                await send(applyRequest());

                expect(postedNamed('adapterMetadataChanges')).toEqual([]);
                expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringMatching(/Applied 0 field files .* 2 files were not written: Account\.A__c: x; Account\.B__c: y\. Nothing was deployed\.$/));

            });

            it('answers an apply that reaches the host while another run holds the window with that run', async () => {

                await retrieveFirst();
                const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };
                (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
                (RecipeCockpitService as any).updaterLoadRunStateMessage = runningState;

                await (RecipeCockpitService as any).applyAdapterRetrievedFilesFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: panelState().recipeDataMessage!.renderSequence });

                expect(postedNamed('updaterLoadState')).toEqual([runningState]);
                expect(confirmSpy).not.toHaveBeenCalled();

            });

            it('does nothing for changes it no longer holds', async () => {

                await retrieveFirst();

                await (RecipeCockpitService as any).applyAdapterRetrievedFilesFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'applyAdapterRetrievedFiles', treeKey: 'Lead-ONLY', renderSequence: panelState().recipeDataMessage!.renderSequence });

                expect(confirmSpy).not.toHaveBeenCalled();

            });

        });

        it('replays what it found on a reveal of the same model, and lets it go with a new model', async () => {

            await openCockpit();
            selectSandbox();
            await send(retrieveRequest(lastRenderSequence()));

            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('adapterMetadataChanges')).toHaveLength(1);

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await flushAsyncWork();
            expect(panelState().adapterMetadataChangesMessage).toBeUndefined();
            expect(panelState().adapterRetrieveStagingFolderPath).toBeUndefined();

        });

    });

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawAdapter = (panelScriptOptions: IPanelScriptOptions = {}) => {
            const panel = runPanelScript(panelScriptOptions);
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            return { panel, accountCard };
        };

        const updaterPanelOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'treeUpdater')[0];
        const objectNamed = (panel: Panel, treeCard: any, objectApiName: string) => panel.findAll(updaterPanelOf(panel, treeCard), 'updaterObject')
            .find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === objectApiName);
        const expand = (panel: Panel, objectElement: any) => panel.findAll(objectElement.children[0], 'updaterObjectToggle')[0].dispatch('click');
        const rowNamed = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(objectElement, 'updaterField')
            .find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);
        const chipOf = (panel: Panel, element: any) => panel.findAll(element, 'updaterOrgChangeChip')[0];

        it('posts the card and the parent alone, and says it is retrieving while it runs, keeping the records on screen', () => {

            const { panel, accountCard } = drawAdapter();
            const retrieveButton = panel.findAll(updaterPanelOf(panel, accountCard), 'updaterRetrieveMetadata')[0];

            retrieveButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, parentObjectApiName: 'Account' });
            expect(retrieveButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL);
            expect(retrieveButton.disabled).toBe(true);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterLoad')[0].disabled).toBe(true);

            panel.postToPanel({ command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: [{ objectApiName: 'Account', totalSize: 1, recordCount: 1, isTruncated: false, columns: ['Id'], rows: [['001']], hiddenColumnCount: 0 }] });
            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'retrieve' });
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterLoadNote')[0].textContent).toBe('Loaded 1 record from qa');

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(retrieveButton.disabled).toBe(false);

        });

        it('marks a changed field on its row, with what changed in its title, and counts the object\'s changes', () => {

            const { panel, accountCard } = drawAdapter();
            const accountObject = objectNamed(panel, accountCard, 'Account');
            expand(panel, accountObject);

            panel.postToPanel(changesMessage(1));

            const legacyChip = chipOf(panel, rowNamed(panel, accountObject, 'Legacy_Code__c'));
            expect(legacyChip.textContent).toBe(RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL);
            expect(legacyChip.attributes.title).toBe(`${RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL}: length: 50 → 255`);
            expect(panel.isHidden(chipOf(panel, rowNamed(panel, accountObject, 'Rating__c')))).toBe(true);
            expect(chipOf(panel, accountObject.children[0]).textContent).toBe(`1 ${RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL} · 1 ${RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL}`);
            expect(chipOf(panel, objectNamed(panel, accountCard, 'OtherChildObject__c').children[0]).textContent).toBe(RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL);
            expect(panel.isHidden(chipOf(panel, objectNamed(panel, accountCard, 'Contact').children[0]))).toBe(true);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterOrgChangesNote')[0].textContent)
                .toBe(`Retrieved from qa · qa@example.com.qa: 1 field ${RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL}, 1 field ${RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL}.`);

        });

        it('draws a field only the org holds as a row of its own, with no box to choose it, on an object opened before or after', () => {

            const { panel, accountCard } = drawAdapter();
            panel.postToPanel(changesMessage(1));

            const accountObject = objectNamed(panel, accountCard, 'Account');
            expand(panel, accountObject);

            const orgOnlyRow = panel.findAll(accountObject, 'updaterOrgOnlyField')[0];
            expect(panel.findAll(orgOnlyRow, 'updaterFieldName')[0].textContent).toBe('Is_Priority__c');
            expect(panel.findAll(orgOnlyRow, 'updaterFieldLabel')[0].textContent).toBe('Is Priority');
            expect(panel.findAll(orgOnlyRow, 'fieldType')[0].textContent).toBe('Checkbox');
            expect(chipOf(panel, orgOnlyRow).textContent).toBe(RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL);
            expect(panel.findAll(orgOnlyRow, 'updaterFieldNote')[0].textContent).toBe(RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE);
            expect(panel.findAll(orgOnlyRow, 'updaterFieldChoose')).toEqual([]);

        });

        it('lets the filter find the markers, and narrows the org-only rows with the rest', () => {

            const { panel, accountCard } = drawAdapter();
            const accountObject = objectNamed(panel, accountCard, 'Account');
            expand(panel, accountObject);
            panel.postToPanel(changesMessage(1));

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'changed in org');
            expect(panel.isHidden(rowNamed(panel, accountObject, 'Legacy_Code__c'))).toBe(false);
            expect(panel.isHidden(rowNamed(panel, accountObject, 'Rating__c'))).toBe(true);
            expect(panel.isHidden(panel.findAll(accountObject, 'updaterOrgOnlyField')[0])).toBe(true);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'new in org');
            expect(panel.isHidden(panel.findAll(accountObject, 'updaterOrgOnlyField')[0])).toBe(false);
            expect(panel.isHidden(rowNamed(panel, accountObject, 'Legacy_Code__c'))).toBe(true);

        });

        it('draws only on the model it was found on, and again when step 2 is drawn for another parent', () => {

            const { panel, accountCard } = drawAdapter();
            panel.postToPanel(changesMessage(2));
            expect(panel.isHidden(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterOrgChangesNote')[0])).toBe(true);

            panel.postToPanel(changesMessage(1));
            panel.findAll(updaterPanelOf(panel, accountCard), 'updaterChangeParent')[0].dispatch('click');
            panel.findAll(updaterPanelOf(panel, accountCard), 'updaterNext')[0].dispatch('click');

            expect(chipOf(panel, objectNamed(panel, accountCard, 'Account').children[0]).textContent).toContain(RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL);

        });

        it('shows Apply once something was found, enabled only when a file is new or changed, and says it is applying', () => {

            const { panel, accountCard } = drawAdapter();
            const applyButton = panel.findAll(updaterPanelOf(panel, accountCard), 'updaterApplyRetrieved')[0];
            expect(panel.isHidden(applyButton)).toBe(true);

            const unchanged = changesMessage(1);
            unchanged.objects[0].fieldChanges = [];
            panel.postToPanel(unchanged);
            expect(panel.isHidden(applyButton)).toBe(false);
            expect(applyButton.disabled).toBe(true);
            expect(applyButton.attributes.title).toBe(RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON);

            panel.postToPanel(changesMessage(1));
            expect(applyButton.disabled).toBe(false);
            expect(applyButton.textContent).toBe(RECIPE_COCKPIT_ADAPTER_APPLY_LABEL);

            applyButton.dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'applyAdapterRetrievedFiles', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 });
            expect(applyButton.textContent).toBe(RECIPE_COCKPIT_ADAPTER_APPLYING_LABEL);
            expect(applyButton.disabled).toBe(true);
            const postedCount = panel.postedHostMessages.length;
            applyButton.dispatch('click');
            expect(panel.postedHostMessages).toHaveLength(postedCount);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'apply' });
            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(applyButton.textContent).toBe(RECIPE_COCKPIT_ADAPTER_APPLY_LABEL);
            expect(applyButton.disabled).toBe(false);

        });

        it('lists recent changes in the org under their hint, and each hint\'s note when it could not be read', () => {

            const { panel, accountCard } = drawAdapter();
            const hintsElement = panel.findAll(updaterPanelOf(panel, accountCard), 'updaterOrgHints')[0];
            expect(panel.isHidden(hintsElement)).toBe(true);

            panel.postToPanel({ ...changesMessage(1), hints: {
                sourceTracking: { rows: [], moreCount: 0, skippedCount: 0, note: 'This org does not track source.' },
                auditTrail: { rows: [{ objectApiName: 'Account', text: 'Created custom field Tier on Account · Ada', changedAt: '2026-10-21T09:00:00Z' }, { objectApiName: 'Contact', text: 'Changed Contact layout', changedAt: '' }], moreCount: 4, skippedCount: 1 }
            } });

            expect(panel.isHidden(hintsElement)).toBe(false);
            const sourceTracking = panel.findAll(hintsElement, 'updaterOrgHintsSourceTracking')[0];
            expect(panel.findAll(sourceTracking, 'updaterOrgHintListHeading')[0].textContent).toBe(RECIPE_COCKPIT_ADAPTER_SOURCE_TRACKING_HEADING);
            expect(panel.findAll(sourceTracking, 'updaterOrgHintNote').map((noteElement: any) => noteElement.textContent)).toEqual(['This org does not track source.']);
            const auditTrail = panel.findAll(hintsElement, 'updaterOrgHintsAuditTrail')[0];
            expect(panel.findAll(auditTrail, 'updaterOrgHintListHeading')[0].textContent).toBe(RECIPE_COCKPIT_ADAPTER_AUDIT_TRAIL_HEADING);
            expect(panel.findAll(auditTrail, 'updaterOrgHint').map((rowElement: any) => rowElement.children.map((child: any) => child.textContent))).toEqual([
                ['2026-10-21 09:00', 'Account', 'Created custom field Tier on Account · Ada'],
                ['Contact', 'Changed Contact layout']
            ]);
            expect(panel.findAll(auditTrail, 'updaterOrgHintNote').map((noteElement: any) => noteElement.textContent)).toEqual(['4 more not shown.', '1 row could not be read.']);

            panel.postToPanel({ ...changesMessage(1), hints: { sourceTracking: { rows: [], moreCount: 0, skippedCount: 0 }, auditTrail: { rows: [], moreCount: 0, skippedCount: 0 } } });
            expect(panel.findAll(hintsElement, 'updaterOrgHintNote').map((noteElement: any) => noteElement.textContent)).toEqual(['Nothing listed for these objects.', 'Nothing listed for these objects.']);

            panel.postToPanel(changesMessage(1));
            expect(panel.isHidden(hintsElement)).toBe(true);

        });

        it('draws each new child object in the org as a row under its parent, counted on the object, found by the filter, and says why some are not listed', () => {

            const { panel, accountCard } = drawAdapter();
            const message: any = changesMessage(1);
            message.objects[0].newChildObjects = [{ childObjectApiName: 'Gadget__c', fieldApiName: 'Account__c' }, { childObjectApiName: 'Widget__c', fieldApiName: 'Owner_Account__c' }];
            message.objects[0].moreNewChildObjectCount = 3;
            message.childObjectsNote = '1 object could not be described in the org, so its new child objects are not listed.';
            panel.postToPanel(message);
            const accountObject = objectNamed(panel, accountCard, 'Account');
            expand(panel, accountObject);

            const childRows = panel.findAll(accountObject, 'updaterOrgOnlyObject');
            expect(childRows.map((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent)).toEqual(['Gadget__c', 'Widget__c']);
            expect(panel.findAll(childRows[1], 'updaterFieldLabel')[0].textContent).toBe('via Owner_Account__c');
            expect(chipOf(panel, childRows[0]).textContent).toBe(RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL);
            expect(panel.findAll(childRows[0], 'updaterFieldNote')[0].textContent).toBe(RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_NOTE);
            expect(panel.findAll(childRows[0], 'updaterFieldChoose')).toEqual([]);
            expect(panel.findAll(accountObject, 'updaterOrgOnlyMore')[0].textContent).toBe('3 more new child objects in org not listed');
            expect(chipOf(panel, accountObject.children[0]).textContent).toBe(`1 ${RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL} · 1 ${RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL} · 5 new child objects in org`);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterOrgChangesNote')[0].textContent).toContain('its new child objects are not listed.');

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'widget');
            expect(panel.isHidden(childRows[0])).toBe(true);
            expect(panel.isHidden(childRows[1])).toBe(false);

        });

        it('writes every name from the org as text, never as markup', () => {

            const { panel, accountCard } = drawAdapter();
            const message = changesMessage(1);
            message.objects[0].fieldChanges[0] = { fieldApiName: '<img src=x onerror=alert(1)>__c', status: 'new', fieldType: '<b>Checkbox</b>', fieldLabel: '<script>', differences: [] };
            panel.postToPanel(message);
            const accountObject = objectNamed(panel, accountCard, 'Account');
            expand(panel, accountObject);

            const orgOnlyRow = panel.findAll(accountObject, 'updaterOrgOnlyField')[0];
            expect(panel.findAll(orgOnlyRow, 'updaterFieldName')[0].textContent).toBe('<img src=x onerror=alert(1)>__c');
            expect(panel.findAll(orgOnlyRow, 'updaterFieldName')[0].children).toEqual([]);

        });

    });

});
