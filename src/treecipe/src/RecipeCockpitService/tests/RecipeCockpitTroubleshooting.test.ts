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

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_ACTION_VERB_EMOJI,
    RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND,
    RECIPE_COCKPIT_DEPLOY_ACTION_LABELS,
    RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL,
    RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL,
    RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_TREE_TABS,
    RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS,
    RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL
} from '../RecipeCockpitService';
import { RecipeCockpitMetadataDeploy } from '../RecipeCockpitMetadataDeploy';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME, SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const findDescendantsByClass = (rootElement: any, className: string): any[] => {
    const found: any[] = [];
    const visit = (element: any) => {
        if ( element.classList.contains(className) ) { found.push(element); }
        element.children.forEach(visit);
    };
    rootElement.children.forEach(visit);
    return found;
};

// A CARD'S TITLE IS ITS OWN SPAN (#381): A RUNNING LABEL REPLACES IT AND NOTHING ELSE ON THE CARD
const cardTitleOf = (buttonElement: any): string => findDescendantsByClass(buttonElement, 'actionCardTitle')[0].textContent;

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const QA_USERNAME = 'qa@example.com.qa';
const ACCOUNT_CUSTOM_FIELDS = ['Account.Annual_Budget__c', 'Account.Rating__c', 'Account.Sub_Rating__c', 'OtherChildObject__c.Contact__c', 'OtherChildObject__c.Ratio__c', 'OtherChildObject__c.Score__c'];

const DEPLOY_COMMANDS = ['deployTreePermissionSet', 'deployTreeFields', 'deployTreeGlobalValueSets', 'deployTreeRecordTypes'];

const buildDeployAnswer = (componentCount: number, componentFailures: Array<{ fullName: string; problem: string }> = []) => JSON.stringify({
    status: componentFailures.length === 0 ? 0 : 1,
    result: {
        success: componentFailures.length === 0,
        numberComponentsDeployed: componentFailures.length === 0 ? componentCount : 0,
        details: { componentSuccesses: [], componentFailures: componentFailures }
    }
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, the Troubleshooting tab (#346)', () => {

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' }];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 7, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.assignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const notRunning = (deployKind: string, treeKey: string = ACCOUNT_TREE_KEY) => ({ command: 'metadataDeployState', isRunning: false, treeKey: treeKey, deployKind: deployKind });

        it('routes each section\'s deploy with the tree KEY and whether the selection is the org, never anything else the message carries', () => {

            const panelState = buildPanelState();
            const expectedKinds = ['permissionSet', 'fields', 'globalValueSets', 'recordTypes'];

            DEPLOY_COMMANDS.forEach((command, commandIndex) => {
                expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: ACCOUNT_TREE_KEY, orgIndex: 0, names: ['Evil'], username: 'prod@example.com', manifest: '/etc/passwd' } as any, panelState))
                    .toEqual({ kind: 'deployTreeMetadataComponents', treeKey: ACCOUNT_TREE_KEY, deployKind: expectedKinds[commandIndex], isSelectedOrg: true });
                expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: ACCOUNT_TREE_KEY }, panelState))
                    .toEqual({ kind: 'deployTreeMetadataComponents', treeKey: ACCOUNT_TREE_KEY, deployKind: expectedKinds[commandIndex], isSelectedOrg: false });
            });

        });

        it('routes nothing but the clicked button back for a forged tree key not on screen, or a key that is not a string', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: LEAD_TREE_KEY, orgIndex: 0 }, panelState)).toEqual({ kind: 'refuseMetadataDeploy', hostMessage: notRunning('fields', LEAD_TREE_KEY) });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: 7 }, panelState)).toEqual({ kind: 'refuseMetadataDeploy', hostMessage: notRunning('fields', '') });

            panelState.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('refuseMetadataDeploy');

        });

        it('accepts an org index only when it IS the selection, names the same username, and that org answered it is a sandbox: production is never routed', () => {

            const panelState = buildPanelState();
            const deployFields = (orgIndex: unknown) => RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY, orgIndex: orgIndex }, panelState);

            [1, -1, 0.5, '0'].forEach(orgIndex => {
                expect(deployFields(orgIndex)).toEqual({ kind: 'refuseMetadataDeploy', refusalText: expect.stringContaining('has not answered that it is a sandbox'), hostMessage: notRunning('fields') });
            });

            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'prod', username: 'prod@example.com' }];
            expect(deployFields(0)?.kind).toBe('refuseMetadataDeploy');

            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' }];
            panelState.dataOrgSelection.orgTypeDetail = { isSandbox: false, organizationType: 'Enterprise Edition' };
            expect(deployFields(0)?.kind).toBe('refuseMetadataDeploy');

            panelState.dataOrgSelection.orgTypeDetail = undefined;
            expect(deployFields(0)?.kind).toBe('refuseMetadataDeploy');

        });

        it('is refused, saying why, while an insert, a scratch org run, an assignment or a retrieve runs', () => {

            const busyStates: Array<(panelState: IRecipeCockpitPanelState) => void> = [
                panelState => { panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; },
                panelState => { panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true }; },
                panelState => { panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; },
                panelState => { panelState.metadataRetrieveStateMessage = { command: 'metadataRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'validationRules' }; }
            ];

            busyStates.forEach(makeBusy => {
                const panelState = buildPanelState();
                makeBusy(panelState);
                expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeRecordTypes', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 }, panelState))
                    .toEqual({ kind: 'refuseMetadataDeploy', refusalText: RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL, hostMessage: notRunning('recordTypes') });
            });

        });

        it('while a deploy runs, answers a second with the running state and holds the insert, the assignment, the retrieve, the scratch org run and the org selection', () => {

            const panelState = buildPanelState();
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' };
            panelState.dataOrgObjectApiNames = new Set(['Account']);
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/account.yml');

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeGlobalValueSets', treeKey: ACCOUNT_TREE_KEY }, panelState))
                .toEqual({ kind: 'refuseMetadataDeploy', hostMessage: panelState.metadataDeployStateMessage });
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).not.toBe('insertTree');
            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState)).toMatchObject({ kind: 'refusePermissionSetAssign', refusalText: expect.stringContaining('metadata deploy') });
            expect(RecipeCockpitService.routePanelMessage({ command: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY }, panelState)).toMatchObject({ kind: 'refuseMetadataRetrieve', refusalText: RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL });
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 0 }, panelState)).toEqual({ kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: false } });

        });

        it('still routes nothing for the removed whole-folder deploy, its Deployment Status page and its inline output', () => {

            const panelState = buildPanelState();

            ['deployTreeMetadata', 'openMetadataDeployStatus', 'viewMetadataDeployOutput'].forEach(command => {
                expect(RecipeCockpitService.routePanelMessage({ command: command, orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState)).toBeUndefined();
            });

        });

        it('routes a summary request only for the model on screen and a card with a folder', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 }, panelState))
                .toEqual({ kind: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingSummary', treeKey: LEAD_TREE_KEY, renderSequence: 3 }, panelState)).toBeUndefined();

        });

        it('replays a deploy still running, so a reloaded document keeps every button it holds disabled', () => {

            const panelState = buildPanelState();
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' };

            expect(RecipeCockpitService.buildReplayMessages(panelState)).toContainEqual(panelState.metadataDeployStateMessage);

        });

        it('is named, with every deploy button, in the preview warning\'s "It CAN WRITE TO AN ORG" notice', () => {

            Object.values(RECIPE_COCKPIT_DEPLOY_ACTION_LABELS).forEach(actionLabel => expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain(`"${actionLabel}"`));
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('They never reach production.');

        });

        it('is a tab a saved place can name, without a new place version, and drops the tab-wide search #365 replaced with one per sub-tab', () => {

            expect(RECIPE_COCKPIT_TREE_TABS).toEqual(['treecipe', 'datasets', 'troubleshooting', 'query']);

            const place = RecipeCockpitService.normalizePanelPlace({
                version: 2,
                runFolderName: 'recipe-2026-09-20T10-00-00',
                isOrgPickerInUse: false,
                isFavoritesOnly: false,
                scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'troubleshooting', searchQueries: { treecipe: '', datasets: '', troubleshooting: 'field' }, expandedObjectKeys: [], openPicklistKeys: [] }]
            });

            expect(place?.trees[0]).toMatchObject({ selectedTab: 'troubleshooting' });
            expect(place?.trees[0].searchQueries).toEqual({ treecipe: '', datasets: '' });

            const olderPlace = RecipeCockpitService.normalizePanelPlace({
                version: 2,
                runFolderName: 'recipe-2026-09-20T10-00-00',
                isOrgPickerInUse: false,
                isFavoritesOnly: false,
                scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [] }]
            });

            expect(olderPlace?.trees[0].searchQueries).toEqual({ treecipe: '', datasets: '' });

        });

    });

    describe('the host, against a faked org and Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let deployHandler: (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';
        let deployedManifests: string[];
        let heldCallbacks: Array<() => void>;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let informationCalls: () => any[][];
        let describeCalls: string[];
        let childKill: jest.Mock;
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let modalAnswer: string | undefined;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project' && argumentList[1] === 'deploy');
        const lastDeployState = () => postedNamed('metadataDeployState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const quickPick = () => vscode.window.showQuickPick as jest.Mock;
        const warningCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls;
        const modalCalls = () => warningCalls().filter(([, options]) => options?.inPanel);
        const notificationWarnings = () => warningCalls()
            .filter(([, options]) => !( options && typeof options === 'object' && options.inPanel ))
            .map(([warningText, ...actions]) => ({ text: warningText as string, actions: actions as string[] }));
        const lastWarning = () => notificationWarnings().at(-1);
        const operationsFolderPath = () => path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
        const operationFiles = () => fs.existsSync(operationsFolderPath()) ? fs.readdirSync(operationsFolderPath()) : [];
        const packageXmlFiles = () => operationFiles().filter(fileName => fileName.endsWith('-package.xml'));

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const openCockpitWithQaSelected = async () => {
            await openCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();
        };

        const deploy = async (command: string, treeKey: string = ACCOUNT_TREE_KEY, orgIndex: number | null = 0) => {
            await receivedMessageHandler({ command: command, treeKey: treeKey, ...( orgIndex === null ? {} : { orgIndex: orgIndex } ) });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-troubleshooting-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');

            SalesforceOrgService.clearConnectedOrgStatusCache();
            SalesforceOrgService.clearDescribeCache();
            RecipeCockpitService.clearTroubleshootingSummaries();
            (RecipeCockpitService as any).isMetadataDeployInFlight = false;
            (RecipeCockpitService as any).metadataDeployRunStateMessage = undefined;
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = false;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = undefined;
            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            (RecipeCockpitService as any).metadataRetrieveRunStateMessage = undefined;
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            describeCalls = [];
            deployedManifests = [];
            heldCallbacks = [];
            cancellationListeners = [];
            organizationAnswers = [];
            modalAnswer = RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL;
            childKill = jest.fn();
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            deployHandler = () => ({ stdout: buildDeployAnswer(6) });

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], execOptions: any, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                if ( argumentList[0] === 'org' && argumentList[1] === 'list' ) {
                    answerWith({ stdout: JSON.stringify(SF_ORG_LIST) });
                    return { kill: childKill };
                }
                const manifestIndex = argumentList.indexOf('--manifest');
                if ( manifestIndex !== -1 ) {
                    deployedManifests.push(fs.readFileSync(path.join(execOptions.cwd, argumentList[manifestIndex + 1]), 'utf-8'));
                }
                const cliAnswer = deployHandler(argumentList);
                if ( cliAnswer === 'hold' ) {
                    heldCallbacks.push(() => answerWith({ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }));
                } else {
                    answerWith(cliAnswer);
                }
                return { kill: childKill };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS);

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancellationListeners.push(listener); } };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.inPanel ? modalAnswer : undefined);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            informationCalls = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls;
            quickPick().mockReset();
            quickPick().mockImplementation(async (items: any[]) => items.filter(item => item.picked));

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
            jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    describeCalls.push(objectApiName);
                    return { name: objectApiName, createable: true, fields: [] };
                }),
                query: jest.fn().mockImplementation(async (soql: string) => {
                    if ( soql.includes('FROM Organization') ) {
                        return { records: [organizationAnswers.shift() ?? { IsSandbox: true, OrganizationType: 'Developer Edition' }] };
                    }
                    throw new Error(`A query was sent that should not have been: ${soql}`);
                }),
                sobject: jest.fn()
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('deploys only the tree\'s custom fields through a generated package.xml, after an escaped modal naming the org, the folder and every field, and says how it went in a notification', async () => {

            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const describesBefore = describeCalls.length;

            await deploy('deployTreeFields');

            const [modalMessage, modalOptions, modalAction] = modalCalls()[0];
            expect(modalMessage).toBe(`Deploy 6 components for Account-thru-OtherChildObject__c to qa · ${QA_USERNAME}?`);
            expect(modalAction).toBe(RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(modalOptions.detail).toContain('From: force-app');
            expect(modalOptions.detail).toContain(`6 CustomField: ${ACCOUNT_CUSTOM_FIELDS.join(', ')}`);
            expect(modalOptions.detail).toContain('Not deployed: standard fields — the org enables these through a feature or setting: ');
            expect(modalOptions.detail).toContain('Account.ParentId');
            expect(modalOptions.detail).toContain('Not deployed: 2 custom fields whose source file is missing or could not be read: Account.Legacy_Code__c, Account.Regions__c');
            expect(modalOptions.detail).not.toMatch(/[()[\]]/);

            expect(deployCalls()).toHaveLength(1);
            const [deployArgv] = deployCalls();
            expect(deployArgv.slice(0, 7)).toEqual(['project', 'deploy', 'start', '--json', '--target-org', QA_USERNAME, '--manifest']);
            expect(deployArgv[7]).toMatch(new RegExp(`^treecipe/${ORG_OPERATIONS_FOLDER_NAME}/${QA_USERNAME.replace(/\./g, '\\.')}/\\d{8}-\\d{6}-field-deploy-package\\.xml$`));
            expect(deployArgv).not.toContain('--ignore-errors');
            expect(deployArgv).not.toContain('--metadata');

            const typeNames = [...deployedManifests[0].matchAll(/<name>([^<]*)<\/name>/g)].map(match => match[1]);
            const members = [...deployedManifests[0].matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);
            expect(typeNames).toEqual(['CustomField']);
            expect(members).toEqual(ACCOUNT_CUSTOM_FIELDS);
            expect(deployedManifests[0]).toContain('<version>64.0</version>');

            // PROJECT MODE, THE SCRATCH ORG DEPLOY'S BUFFER
            const deployExecCall = (execFile as unknown as jest.Mock).mock.calls.find(([, argumentList]) => argumentList[1] === 'deploy');
            expect(deployExecCall[2].cwd).toBe(path.resolve(workspaceRoot));
            expect(deployExecCall[2].maxBuffer).toBe(SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES);

            expect(informationCalls()).toContainEqual([`Deployed 6 components for Account-thru-OtherChildObject__c to qa · ${QA_USERNAME}.`, RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL]);
            expect(notificationWarnings()).toEqual([]);
            expect(postedNamed('metadataDeployState')).toEqual([
                { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' },
                { command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }
            ]);
            expect(operationFiles().filter(fileName => fileName.endsWith('-field-deploy.json'))).toHaveLength(1);
            expect(packageXmlFiles()).toHaveLength(1);

            // A DEPLOY THAT LANDED DROPS THE DEPLOYED OBJECTS' DESCRIBES AND RE-CHECKS THE CARDS LISTING THEM
            ['Account', 'OtherChildObject__c'].forEach(objectApiName => expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, objectApiName));
            expect(describeCalls.slice(describesBefore)).toEqual(expect.arrayContaining(['Account', 'OtherChildObject__c']));

        });

        it('leaves an unticked field and an excluded object out of what it deploys', async () => {

            await openCockpitWithQaSelected();
            const accountTree = panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);
            accountTree.fieldSelection = { objects: [{ objectApiName: 'Account', excludedFieldApiNames: ['Rating__c'], lockedFields: [] }] } as any;
            accountTree.objectSelection = { exclusions: [{ objectApiName: 'OtherChildObject__c' }] } as any;

            await deploy('deployTreeFields');

            const members = [...deployedManifests[0].matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);
            expect(members).toEqual(['Account.Annual_Budget__c', 'Account.Sub_Rating__c']);

        });

        it('starts no process and writes no package.xml when the modal is cancelled', async () => {

            await openCockpitWithQaSelected();
            modalAnswer = undefined;

            await deploy('deployTreeFields');

            expect(modalCalls()).toHaveLength(1);
            expect(deployCalls()).toEqual([]);
            expect(packageXmlFiles()).toEqual([]);
            expect(notificationWarnings()).toEqual([]);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' });

        });

        it('asks the org again on the connection after the modal, and deploys nothing to an org that is not a sandbox', async () => {

            await openCockpitWithQaSelected();
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deploy('deployTreeRecordTypes');

            expect(deployCalls()).toEqual([]);
            expect(packageXmlFiles()).toEqual([]);
            expect(lastWarning()?.text).toMatch(/^Nothing was deployed: qa · qa@example\.com\.qa answered that it is .*Metadata is deployed only to a sandbox or scratch org\.$/);

        });

        it('opens no prompt for a project whose sfdx-project.json cannot be read', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ not json');
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await deploy('deployTreePermissionSet', ACCOUNT_TREE_KEY, null);

            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(lastWarning()?.text).toMatch(/^Nothing was deployed: /);

        });

        it('with no org selected, asks for one from the Treecipe tab\'s non-production list', async () => {

            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                const listing = await orgListing;
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });

            await deploy('deployTreeRecordTypes', ACCOUNT_TREE_KEY, null);

            expect(promptSpy.mock.calls[0][1]).toBe(RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER);
            const members = [...deployedManifests[0].matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);
            expect(deployedManifests[0]).toContain('<name>RecordType</name>');
            expect(members).toEqual(['Account.Business', 'Account.Partner']);

        });

        it('deploys the global value sets the tree\'s fields name, and names the one the project does not hold', async () => {

            await openCockpitWithQaSelected();

            await deploy('deployTreeGlobalValueSets');

            expect(modalCalls()[0][1].detail).toContain('Not deployed: 1 global value set a field names that this project does not hold: Missing_Set');
            expect([...deployedManifests[0].matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1])).toEqual(['Account_Ratings']);
            expect(deployedManifests[0]).toContain('<name>GlobalValueSet</name>');

        });

        it('refuses, opening nothing, a section with nothing to deploy', async () => {

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'recordTypes'), { recursive: true });
            await openCockpitWithQaSelected();

            await deploy('deployTreeRecordTypes');

            expect(lastWarning()).toEqual({ text: 'Account-thru-OtherChildObject__c has no record type in this project, so nothing was deployed.', actions: [] });
            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);

        });

        it('offers this tree\'s generated permission set first and preselected, deploys the picks, and offers "Assign permission sets to me…" routed like a click', async () => {

            await openCockpitWithQaSelected();
            let chooseAssign = true;
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (_text: string, ...actions: string[]) => {
                if ( chooseAssign && actions.includes(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL) ) {
                    chooseAssign = false;
                    return RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL;
                }
                return undefined;
            });
            const routeSpy = jest.spyOn(RecipeCockpitService, 'routePanelMessage');

            await deploy('deployTreePermissionSet');
            await flushAsyncWork();
            await flushAsyncWork();

            const [pickItems, pickOptions] = quickPick().mock.calls[0];
            expect(pickOptions).toMatchObject({ canPickMany: true });
            expect(pickItems.map((pickItem: any) => [pickItem.label, pickItem.picked])).toEqual([
                ['SDT_Account_thru_OtherChildObject_c', true],
                ['Account_Tree_Access', false]
            ]);
            expect([...deployedManifests[0].matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1])).toEqual(['SDT_Account_thru_OtherChildObject_c']);
            expect(deployedManifests[0]).toContain('<name>PermissionSet</name>');
            expect(informationCalls()[0]).toEqual([`Deployed 1 component for Account-thru-OtherChildObject__c to qa · ${QA_USERNAME}.`, RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL, RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL]);
            expect(routeSpy).toHaveBeenCalledWith({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 }, expect.anything());

        });

        it('names each failed component in a warning with View output, and keeps the describes it may have changed out of the cache', async () => {

            await openCockpitWithQaSelected();
            deployHandler = () => ({ stdout: buildDeployAnswer(0, [{ fullName: 'Account.Rating__c', problem: 'Value set Account_Ratings not found' }]) });
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await deploy('deployTreeFields');

            expect(lastWarning()).toEqual({
                text: `Nothing was deployed to qa · ${QA_USERNAME}: Account.Rating__c: Value set Account_Ratings not found`,
                actions: [RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL]
            });
            expect(informationCalls()).toEqual([]);
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');

        });

        it('kills the process tree on cancel and says whether it landed is unknown', async () => {

            await openCockpitWithQaSelected();
            deployHandler = () => 'hold';

            const deployDone = deploy('deployTreeFields');
            while ( deployCalls().length === 0 ) {
                await flushAsyncWork();
            }
            cancellationToken.isCancellationRequested = true;
            cancellationListeners.forEach(listener => listener());
            heldCallbacks.forEach(answer => answer());
            await deployDone;
            await flushAsyncWork();

            expect(childKill).toHaveBeenCalled();
            expect(lastWarning()?.text).toBe(`The deploy of 6 components for Account-thru-OtherChildObject__c to qa · ${QA_USERNAME} was cancelled, so whether it landed is unknown.`);
            expect(lastDeployState()).toMatchObject({ isRunning: false });

        });

        it('stops after the modal when an insert started while it was open', async () => {

            await openCockpitWithQaSelected();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => {
                if ( options?.inPanel ) {
                    panelState().insertStateMessage = { command: 'insertState', isRunning: true, treeKey: LEAD_TREE_KEY };
                    return RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL;
                }
                return undefined;
            });

            await deploy('deployTreeFields');

            expect(deployCalls()).toEqual([]);
            expect(packageXmlFiles()).toEqual([]);
            expect(lastWarning()?.text).toBe(RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL);

        });

        it('answers a summary request with counts only, for the model it was asked for', async () => {

            await openCockpit();

            await receivedMessageHandler({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            await flushAsyncWork();

            expect(postedNamed('troubleshootingSummary')).toEqual([{
                command: 'troubleshootingSummary',
                renderSequence: lastRenderSequence(),
                treeKey: ACCOUNT_TREE_KEY,
                permissionSetCount: 2,
                customFieldCount: 6,
                standardFieldCount: expect.any(Number),
                unreadableFieldCount: 2,
                globalValueSetCount: 1,
                missingGlobalValueSetCount: 1,
                recordTypeCount: 2
            }]);
            expect(cliCalls.filter(argumentList => argumentList[1] !== 'list')).toEqual([]);

            // ASKED AGAIN, IT IS ANSWERED FROM WHAT WAS READ: THE PROJECT IS NOT READ A SECOND TIME
            const summarizeSpy = jest.spyOn(RecipeCockpitMetadataDeploy, 'summarizeTreeMetadata');
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ not json');
            await receivedMessageHandler({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            await flushAsyncWork();

            expect(summarizeSpy).not.toHaveBeenCalled();
            expect(postedNamed('troubleshootingSummary').at(-1)).toMatchObject({ customFieldCount: 6 });

            // ONCE CLEARED IT IS READ AGAIN, AND A PROJECT THAT CANNOT BE READ IS NOT KEPT
            RecipeCockpitService.clearTroubleshootingSummaries();
            await receivedMessageHandler({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            await flushAsyncWork();

            expect(postedNamed('troubleshootingSummary').at(-1)).toMatchObject({ customFieldCount: 0, failureMessage: expect.stringMatching(/^Nothing can be deployed: /) });

            fs.copyFileSync(path.join(METADATA_DEPLOY_WORKSPACE_ROOT, 'sfdx-project.json'), path.join(workspaceRoot, 'sfdx-project.json'));
            await receivedMessageHandler({ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            await flushAsyncWork();

            expect(postedNamed('troubleshootingSummary').at(-1)).toMatchObject({ customFieldCount: 6 });
            expect(postedNamed('troubleshootingSummary').at(-1)).not.toHaveProperty('failureMessage');

        });

        it('refuses, opening nothing, a permission set deploy when no permission set in source covers the tree, and is a quiet cancel when the pick or the org prompt is dismissed', async () => {

            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValue(undefined);

            quickPick().mockResolvedValue(undefined);
            await deploy('deployTreePermissionSet', ACCOUNT_TREE_KEY, null);
            expect(promptSpy).not.toHaveBeenCalled();

            await deploy('deployTreeFields', ACCOUNT_TREE_KEY, null);
            expect(promptSpy).toHaveBeenCalledTimes(1);
            expect(modalCalls()).toEqual([]);
            expect(notificationWarnings()).toEqual([]);

            promptSpy.mockRejectedValue(new Error('The Salesforce CLI could not say which orgs are connected.'));
            await deploy('deployTreeFields', ACCOUNT_TREE_KEY, null);
            expect(lastWarning()?.text).toBe('Nothing was deployed: The Salesforce CLI could not say which orgs are connected.');

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true });
            await deploy('deployTreePermissionSet', ACCOUNT_TREE_KEY, null);
            expect(lastWarning()?.text).toBe('No permission set in this workspace\'s source grants access to any object of Account-thru-OtherChildObject__c, so nothing was deployed. Generate permission set… writes one.');
            expect(deployCalls()).toEqual([]);

        });

        it('deploys nothing when the org cannot be connected to after the modal', async () => {

            await openCockpitWithQaSelected();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValueOnce(new Error('expired'));

            await deploy('deployTreeFields');

            expect(deployCalls()).toEqual([]);
            expect(lastWarning()?.text).toBe(`Nothing was deployed: could not connect to qa · ${QA_USERNAME}: expired`);

        });

        it('says when the CLI is missing, and when the deploy stopped before its answer, offering the output it left', async () => {

            await openCockpitWithQaSelected();
            deployHandler = () => ({ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });

            await deploy('deployTreeFields');
            expect(lastWarning()).toEqual({ text: expect.stringContaining('is not installed or not on PATH'), actions: [] });

            deployHandler = () => ({ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM', killed: true }) });
            jest.spyOn(require('../../PicklistDependencyCheckService/PicklistDependencyCheckService').PicklistDependencyCheckService, 'runSalesforceCli')
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: null, timedOut: true });

            await deploy('deployTreeFields');
            expect(lastWarning()).toEqual({ text: 'The deploy did not finish in time and was stopped, so whether it landed is unknown.', actions: [RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL] });

        });

        it('opens the result file from the notification\'s View output', async () => {

            await openCockpitWithQaSelected();
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL);
            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);

            await deploy('deployTreeFields');
            await flushAsyncWork();

            expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/-field-deploy\.json$/), workspaceRoot, 'The deploy result file no longer exists in this workspace.');

        });

        it('runs one deploy per window: a second click is answered with the running state, and a panel reopened mid-deploy adopts it', async () => {

            await openCockpitWithQaSelected();
            deployHandler = () => 'hold';

            const deployDone = deploy('deployTreeFields');
            while ( deployCalls().length === 0 ) {
                await flushAsyncWork();
            }

            const runningState = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' };
            await (RecipeCockpitService as any).deployTreeMetadataFromPanel((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY, 'recordTypes', true);
            expect(postedPanelMessages.at(-1)).toEqual(runningState);

            const rebuiltState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            (RecipeCockpitService as any).adoptMetadataDeployRunState(rebuiltState);
            expect(rebuiltState.metadataDeployStateMessage).toEqual(runningState);

            heldCallbacks.forEach(answer => answer());
            await deployDone;
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: false });

        });

        it('posts no summary for a tree no longer on screen or a model replaced meanwhile, and starts no deploy for a selection that is gone', async () => {

            await openCockpit();
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            const summariesBefore = postedNamed('troubleshootingSummary').length;

            await (RecipeCockpitService as any).postTroubleshootingSummary(cockpitPanel, 'Gone-Tree', lastRenderSequence());
            await (RecipeCockpitService as any).postTroubleshootingSummary(cockpitPanel, ACCOUNT_TREE_KEY, lastRenderSequence() + 1);
            expect(postedNamed('troubleshootingSummary')).toHaveLength(summariesBefore);

            await (RecipeCockpitService as any).deployTreeMetadataFromPanel(cockpitPanel, ACCOUNT_TREE_KEY, 'fields', true);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' });
            expect(modalCalls()).toEqual([]);

        });

        it('deploys to a prompted org without re-checking any card, since the selection did not change', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                const listing = await orgListing;
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });
            const readinessBefore = postedNamed('dataOrgReadiness').length;

            await deploy('deployTreeFields', ACCOUNT_TREE_KEY, null);

            expect(deployCalls()).toHaveLength(1);
            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessBefore);

        });

        it('warns, and gives the button back, when the router refuses a deploy while an assignment runs', async () => {

            await openCockpitWithQaSelected();
            panelState().permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };

            await deploy('deployTreeFields');

            expect(lastWarning()).toEqual({ text: RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL, actions: [] });
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' });
            expect(modalCalls()).toEqual([]);

        });

        it('deploys nothing when the package.xml cannot be written', async () => {

            fs.mkdirSync(path.join(workspaceRoot, 'treecipe'), { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME), 'a file where the folder goes');
            await openCockpitWithQaSelected();

            await deploy('deployTreeRecordTypes');

            expect(deployCalls()).toEqual([]);
            expect(lastWarning()?.text).toBe(`Nothing was deployed: the package.xml could not be written under treecipe/${ORG_OPERATIONS_FOLDER_NAME} in this workspace.`);

        });

        it('names the project\'s replacements in the confirmation, since they copy local files or environment variables into the deploy', async () => {

            const projectFilePath = path.join(workspaceRoot, 'sfdx-project.json');
            const project = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
            fs.writeFileSync(projectFilePath, JSON.stringify({ ...project, replacements: [{ filename: 'x', stringToReplace: 'y', replaceWithEnv: 'SECRET_TOKEN' }] }));
            await openCockpitWithQaSelected();
            modalAnswer = undefined;

            await deploy('deployTreeRecordTypes');

            expect(modalCalls()[0][1].detail).toContain('sfdx-project.json has \u0022replacements\u0022'.replace(/\\u0022/g, '"'));

        });

        it('shows a landed deploy\'s notification only once the run has ended, then reads and posts the tree\'s counts again', async () => {

            await openCockpitWithQaSelected();
            let isRunningWhenShown: boolean | undefined;
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async () => {
                isRunningWhenShown = lastDeployState()?.isRunning;
                return undefined;
            });
            const summariesBefore = postedNamed('troubleshootingSummary').length;

            await deploy('deployTreeFields');
            await flushAsyncWork();

            expect(isRunningWhenShown).toBe(false);
            expect(postedNamed('troubleshootingSummary').length).toBe(summariesBefore + 1);
            expect(postedNamed('troubleshootingSummary').at(-1)).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, customFieldCount: 6 });

        });

        it('offers the assign follow-up for the org the sets were deployed to: with another org selected, it posts no index, so the assign asks', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                const listing = await orgListing;
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (_text: string, ...actions: string[]) => {
                // THE READER SELECTED ANOTHER ORG ABOVE BEFORE CLICKING THE BUTTON
                const currentState = panelState();
                currentState.dataOrgDetails = [{ targetOrgIdentifier: 'dev', username: 'dev@example.com.dev', alias: 'dev' }];
                currentState.dataOrgSelection = { orgIndex: 0, orgDetail: currentState.dataOrgDetails[0], requestSequence: 99, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };
                return actions.includes(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL) ? RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL : undefined;
            });
            const routeSpy = jest.spyOn(RecipeCockpitService, 'routePanelMessage');

            await deploy('deployTreePermissionSet', ACCOUNT_TREE_KEY, null);
            await flushAsyncWork();
            await flushAsyncWork();

            expect(routeSpy).toHaveBeenCalledWith({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, expect.anything());

        });

        it('builds no deploy argv on any path but the generated manifest\'s', () => {

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitService.ts'), 'utf-8');

            expect(source).not.toContain('--ignore-errors');
            expect(source).not.toMatch(/'--metadata'/);

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
        };

        const cardOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes(objectApiName)));

        const renderTrees = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const summary = (overrides: Record<string, unknown> = {}) => ({
            command: 'troubleshootingSummary',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            permissionSetCount: 2,
            customFieldCount: 6,
            standardFieldCount: 4,
            unreadableFieldCount: 2,
            globalValueSetCount: 1,
            missingGlobalValueSetCount: 1,
            recordTypeCount: 2,
            ...overrides
        });

        const deployButtonOf = (panel: ReturnType<typeof runPanelScript>, deployKind: string, objectApiName = 'OtherChildObject__c') =>
            panel.findAll(cardOf(panel, objectApiName), `troubleshootingDeploy-${deployKind}`)[0];

        it('draws Troubleshooting after Treecipe and Previously Used Data Sets, with six sub-tabs each searched by its own box, and asks the host for its counts when selected', () => {

            const panel = renderTrees();
            const accountCard = cardOf(panel, 'OtherChildObject__c');

            expect(panel.findAll(accountCard, 'treeTab').map((tabElement: any) => tabElement.textContent)).toEqual(['Treecipe', 'Previously Used Data Sets', 'Troubleshooting', 'Query']);
            // NOTHING IS BUILT OR ASKED FOR UNTIL THE TAB IS OPENED
            expect(panel.findAll(accountCard, 'troubleshootingSubPanel')).toEqual([]);
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadTroubleshootingSummary')).toEqual([]);

            panel.openTab(accountCard, 'Troubleshooting');

            expect(panel.findAll(accountCard, 'troubleshootingSubTab').map((tabElement: any) => tabElement.textContent)).toEqual(['TODO\'s (5)', 'Fields', 'Permissions', 'Validation Rules', 'Record Types', 'Global Value Sets']);
            // ONE PER SUB-TAB, AND THE TODO'S REMOVED LIST'S OWN (#391)
            expect(panel.findAll(panel.tabPanelOf(accountCard, 'treeTroubleshooting'), 'tabSearchInput')).toHaveLength(7);
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadTroubleshootingSummary')).toEqual([{ command: 'loadTroubleshootingSummary', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 }]);
            // THE ASSIGN, GENERATE AND RETRIEVE BUTTONS ARE HERE NOW, AND NOWHERE ELSE ON THE CARD
            ['treePermissionSets', 'treeGeneratePermissionSet', 'treeRetrieveValidationRules'].forEach(className => {
                expect(panel.findAll(accountCard, className)).toHaveLength(1);
                expect(panel.findAll(panel.tabPanelOf(accountCard, 'treeTroubleshooting'), className)).toHaveLength(1);
            });
            expect(panel.findAll(panel.tabPanelOf(accountCard, 'treeStructure'), 'treePermissionSets')).toEqual([]);

        });

        it('shows what each section would deploy, and draws a section with nothing disabled with the reason', () => {

            const panel = renderTrees();
            const accountCard = cardOf(panel, 'OtherChildObject__c');
            panel.openTab(accountCard, 'Troubleshooting');

            Object.keys(RECIPE_COCKPIT_DEPLOY_ACTION_LABELS).forEach(deployKind => {
                expect(deployButtonOf(panel, deployKind).disabled).toBe(true);
                expect(deployButtonOf(panel, deployKind).attributes.title).toBe('Reading this project…');
            });

            panel.postToPanel(summary({ recordTypeCount: 0 }));

            const summaryTexts = panel.findAll(accountCard, 'troubleshootingSummary').map((summaryElement: any) => summaryElement.textContent);
            // IN SUB-TAB ORDER: FIELDS, PERMISSIONS, RECORD TYPES, GLOBAL VALUE SETS
            expect(summaryTexts).toEqual([
                '6 CustomField; 4 standard fields never deployed; 2 custom fields with no readable source file.',
                '2 permission sets in this project grant access to this tree.',
                '0 RecordType.',
                '1 GlobalValueSet; 1 named value set this project does not hold.'
            ]);
            expect(deployButtonOf(panel, 'fields').disabled).toBe(false);
            expect(cardTitleOf(deployButtonOf(panel, 'fields'))).toBe('Deploy fields…');
            expect(deployButtonOf(panel, 'recordTypes').disabled).toBe(true);
            expect(deployButtonOf(panel, 'recordTypes').attributes.title).toBe('No object of this tree has a record type in this project.\n0 RecordType.');

            // AN ANSWER FOR ANOTHER MODEL IS DROPPED
            panel.postToPanel(summary({ renderSequence: 2, customFieldCount: 0 }));
            expect(deployButtonOf(panel, 'fields').disabled).toBe(false);

        });

        it('posts the tree key and the selected org\'s index alone, and holds every deploy, insert, assign, retrieve and the picker until the host says it ended', () => {

            const panel = renderTrees();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });
            panel.openTroubleshootingTabs();
            panel.postToPanel(summary());
            panel.postToPanel(summary({ treeKey: LEAD_TREE_KEY }));

            deployButtonOf(panel, 'fields').dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 });
            expect(cardTitleOf(deployButtonOf(panel, 'fields'))).toBe('Deploying…');
            expect(deployButtonOf(panel, 'recordTypes').disabled).toBe(true);
            expect(deployButtonOf(panel, 'fields', 'Lead').disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treePermissionSets')[0].disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treeRetrieveValidationRules')[0].disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treeInsertReason')[0].textContent).toBe("Can't insert: Metadata is being deployed.");

            deployButtonOf(panel, 'fields').dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployTreeFields')).toHaveLength(1);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' });

            expect(deployButtonOf(panel, 'fields').disabled).toBe(false);
            expect(cardTitleOf(deployButtonOf(panel, 'fields'))).toBe('Deploy fields…');
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treePermissionSets')[0].disabled).toBe(false);

        });

        it('posts no org index when none is selected, so the host asks for one', () => {

            const panel = renderTrees();
            panel.openTroubleshootingTabs();
            panel.postToPanel(summary());

            deployButtonOf(panel, 'permissionSet').dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreePermissionSet', treeKey: ACCOUNT_TREE_KEY });

        });

        describe('the action cards (#381)', () => {

            const CARD_CLASS_BY_ACTION: Record<string, string> = {
                assignPermissionSets: 'treePermissionSets',
                generatePermissionSet: 'treeGeneratePermissionSet',
                retrieveValidationRules: 'treeRetrieveValidationRules',
                ...Object.fromEntries(Object.entries(RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND).map(([deployKind, action]) => [action, `troubleshootingDeploy-${deployKind}`])),
                // THE OTHER RETRIEVES (#382)
                retrieveFields: 'troubleshootingRetrieve-fields',
                retrieveRecordTypes: 'troubleshootingRetrieve-recordTypes',
                retrieveGlobalValueSets: 'troubleshootingRetrieve-globalValueSets'
            };

            const partOf = (buttonElement: any, className: string) => findDescendantsByClass(buttonElement, className)[0];

            const openAccountTroubleshooting = () => {
                const panel = renderTrees();
                const accountCard = cardOf(panel, 'OtherChildObject__c');
                panel.openTab(accountCard, 'Troubleshooting');
                return { panel, accountCard };
            };

            it('draws every action as ONE card button: the verb\'s hidden emoji and the title, the why line, a detail line and a reason line, named by its title and described by the rest', () => {

                const { panel, accountCard } = openAccountTroubleshooting();

                expect(Object.keys(CARD_CLASS_BY_ACTION).sort()).toEqual(Object.keys(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS).sort());
                expect(Object.keys(CARD_CLASS_BY_ACTION)).toHaveLength(10);
                Object.entries(CARD_CLASS_BY_ACTION).forEach(([action, className]) => {

                    const buttonElements = panel.findAll(accountCard, className);
                    expect(buttonElements).toHaveLength(1);
                    const buttonElement = buttonElements[0];
                    const card = RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS[action as keyof typeof RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS];

                    expect(buttonElement.tagName).toBe('button');
                    expect(buttonElement.className.split(' ').filter((buttonClassName: string) => buttonClassName.startsWith('sdtButton-'))).toEqual(['sdtButton-card']);
                    expect(buttonElement.parentNode.classList.contains('troubleshootingAction')).toBe(true);
                    expect(buttonElement.parentNode.parentNode.classList.contains('troubleshootingCards')).toBe(true);
                    // NO CONTROL INSIDE THE CARD: THE CARD IS THE ONE BUTTON
                    expect(findDescendantsByClass(buttonElement, 'sdtButton')).toEqual([]);

                    const emojiElement = partOf(buttonElement, 'actionCardEmoji');
                    expect(emojiElement.textContent).toBe(RECIPE_COCKPIT_ACTION_VERB_EMOJI[card.verb]);
                    expect(emojiElement.attributes['aria-hidden']).toBe('true');
                    expect(partOf(buttonElement, 'actionCardWhy').textContent).toBe(card.why);

                    const titleElement = partOf(buttonElement, 'actionCardTitle');
                    expect(buttonElement.attributes['aria-labelledby']).toBe(titleElement.attributes.id);
                    expect(buttonElement.attributes['aria-describedby'].split(' ')).toEqual(
                        ['actionCardWhy', 'actionCardDetail', 'actionCardReason'].map(partClassName => partOf(buttonElement, partClassName).attributes.id));

                });
                expect(cardTitleOf(panel.findAll(accountCard, 'treePermissionSets')[0])).toBe(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL);
                Object.entries(RECIPE_COCKPIT_DEPLOY_ACTION_LABELS).forEach(([deployKind, label]) => expect(cardTitleOf(deployButtonOf(panel, deployKind))).toBe(label));

            });

            it('takes every emoji from the one verb map, so actions that share a verb share an emoji', () => {

                const verbs = Object.keys(RECIPE_COCKPIT_ACTION_VERB_EMOJI);
                Object.values(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS).forEach(card => expect(verbs).toContain(card.verb));
                // ONE EMOJI PER VERB, SO NO TWO VERBS CAN BE TOLD APART ONLY BY THEIR TITLES
                expect(new Set(Object.values(RECIPE_COCKPIT_ACTION_VERB_EMOJI)).size).toBe(verbs.length);
                Object.values(RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND).forEach(action => expect(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS[action].verb).toBe('deploy'));

                const { panel, accountCard } = openAccountTroubleshooting();
                const emojiByVerb = new Map<string, Set<string>>();
                Object.entries(CARD_CLASS_BY_ACTION).forEach(([action, className]) => {
                    const verb = RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS[action as keyof typeof RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS].verb;
                    const emojis = emojiByVerb.get(verb) ?? new Set<string>();
                    emojis.add(partOf(panel.findAll(accountCard, className)[0], 'actionCardEmoji').textContent);
                    emojiByVerb.set(verb, emojis);
                });
                emojiByVerb.forEach(emojis => expect(emojis.size).toBe(1));
                expect(emojiByVerb.get('deploy')).toEqual(new Set(['🚀']));
                // EVERY RETRIEVE, #326'S AND #382'S, SHARES 📥
                expect(emojiByVerb.get('retrieve')).toEqual(new Set(['📥']));

            });

            it('says on the card why it is disabled, never the same text twice, and keeps the summary as its detail', () => {

                const { panel } = openAccountTroubleshooting();
                const recordTypesCard = deployButtonOf(panel, 'recordTypes');

                // NO SUMMARY YET: THE DETAIL SAYS IT, SO THE REASON LINE STAYS HIDDEN
                expect(recordTypesCard.disabled).toBe(true);
                expect(partOf(recordTypesCard, 'actionCardDetail').textContent).toBe('Reading this project…');
                expect(panel.isHidden(partOf(recordTypesCard, 'actionCardReason'))).toBe(true);

                panel.postToPanel(summary({ recordTypeCount: 0 }));

                expect(recordTypesCard.disabled).toBe(true);
                expect(partOf(recordTypesCard, 'actionCardDetail').textContent).toBe('0 RecordType.');
                expect(partOf(recordTypesCard, 'actionCardReason').textContent).toBe('No object of this tree has a record type in this project.');
                expect(panel.isHidden(partOf(recordTypesCard, 'actionCardReason'))).toBe(false);

                // THE CARD MAY CLAMP ITS DETAIL, SO THE TOOLTIP CARRIES IT WHOLE, AFTER THE REASON
                expect(recordTypesCard.attributes.title).toBe('No object of this tree has a record type in this project.\n0 RecordType.');

                const fieldsCard = deployButtonOf(panel, 'fields');
                expect(fieldsCard.disabled).toBe(false);
                expect(panel.isHidden(partOf(fieldsCard, 'actionCardReason'))).toBe(true);
                expect(fieldsCard.attributes.title.split('\n')[1]).toBe(partOf(fieldsCard, 'actionCardDetail').textContent);

            });

            it('replaces only the running card\'s title while a deploy runs, and shows the busy reason on every card it holds', () => {

                const { panel, accountCard } = openAccountTroubleshooting();
                panel.postToPanel(summary());
                const fieldsCard = deployButtonOf(panel, 'fields');

                fieldsCard.dispatch('click');

                expect(cardTitleOf(fieldsCard)).toBe('Deploying…');
                expect(partOf(fieldsCard, 'actionCardEmoji').textContent).toBe('🚀');
                expect(partOf(fieldsCard, 'actionCardWhy').textContent).toBe(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS.deployFields.why);
                expect(cardTitleOf(deployButtonOf(panel, 'recordTypes'))).toBe(RECIPE_COCKPIT_DEPLOY_ACTION_LABELS.recordTypes);
                ['treePermissionSets', 'treeGeneratePermissionSet', 'treeRetrieveValidationRules'].forEach(className => {
                    const buttonElement = panel.findAll(accountCard, className)[0];
                    expect(buttonElement.disabled).toBe(true);
                    expect(partOf(buttonElement, 'actionCardReason').textContent).toBe('Metadata is being deployed.');
                });

                panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' });

                expect(panel.isHidden(partOf(panel.findAll(accountCard, 'treePermissionSets')[0], 'actionCardReason'))).toBe(true);

            });

            it('posts from a click anywhere on an enabled card, and nothing from a disabled one', () => {

                const { panel } = openAccountTroubleshooting();
                panel.postToPanel(summary({ recordTypeCount: 0 }));

                partOf(deployButtonOf(panel, 'recordTypes'), 'actionCardWhy').dispatch('click');
                expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployTreeRecordTypes')).toEqual([]);

                partOf(deployButtonOf(panel, 'fields'), 'actionCardWhy').dispatch('click');
                expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployTreeFields')).toEqual([{ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY }]);

            });

            it('matches a sub-tab\'s search against the why line, which is on screen', () => {

                const { panel, accountCard } = openAccountTroubleshooting();
                panel.postToPanel(summary());

                panel.typeIntoTabSearch(accountCard, 'troubleshootingSubPanel-fields', 'invalid_field');
                expect(panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-fields')[0], 'tabMatchCount')[0].textContent).toBe('1 of 2 actions');

                panel.typeIntoTabSearch(accountCard, 'troubleshootingSubPanel-globalValueSets', 'restricted picklist');
                expect(panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-globalValueSets')[0], 'tabMatchCount')[0].textContent).toBe('1 of 2 actions');

                panel.typeIntoTabSearch(accountCard, 'troubleshootingSubPanel-globalValueSets', 'nothing says this');
                expect(panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-globalValueSets')[0], 'tabMatchCount')[0].textContent).toBe('no matches');

            });

            it('styles the card by its kind alone: one fixed size, a wrapping grid that is one column in a narrow panel, and clamped text', () => {

                const styleSheet = RecipeCockpitService.buildWebviewShellHtml('testNonce');
                expect(styleSheet).toMatch(/\.sdtButton-card \{[^}]*height: 10.5rem;[^}]*overflow: hidden;/);
                expect(styleSheet).toMatch(/\.troubleshootingCards \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 18rem\), 1fr\)\);/);
                expect(styleSheet).toMatch(/\.actionCardTitle \{ -webkit-line-clamp: 2; font-size: inherit; \}/);
                expect(styleSheet).toMatch(/\.actionCardWhy, \.actionCardDetail \{ -webkit-line-clamp: 2; \}/);
                expect(styleSheet).toMatch(/\.actionCardReason \{ -webkit-line-clamp: 1; \}/);
                expect(styleSheet).toMatch(/\.sdtButton-card:hover:not\(:disabled\) \{[^}]*border-color: var\(--sdt-accent\);/);

            });

        });

        it('narrows a sub-tab\'s actions to the ones its own search matches, and counts them', () => {

            const panel = renderTrees();
            const accountCard = cardOf(panel, 'OtherChildObject__c');
            panel.openTab(accountCard, 'Troubleshooting');
            panel.postToPanel(summary());

            panel.typeIntoTabSearch(accountCard, 'troubleshootingSubPanel-permissions', 'generate');

            const permissionsPanel = panel.findAll(accountCard, 'troubleshootingSubPanel-permissions')[0];
            expect(panel.findAll(permissionsPanel, 'troubleshootingAction').map((actionElement: any) => panel.isHidden(actionElement))).toEqual([true, false, true]);
            expect(panel.findAll(permissionsPanel, 'tabMatchCount')[0].textContent).toBe('1 of 3 actions');
            // A SEARCH IS ITS OWN SUB-TAB'S: THE OTHERS ARE UNTOUCHED
            expect(panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-fields')[0], 'tabMatchCount')[0].textContent).toBe('2 actions');

        });

    });

});
