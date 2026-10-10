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
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_DATA_ORG_STATE_KEY,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL,
    RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService, TARGET_DEV_HUB_ENVIRONMENT_VARIABLE } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME, ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const PROJECT_WORKSPACE_ROOT = path.join(__dirname, '..', '..', 'ScratchOrgService', 'tests', 'mocks', 'projectWorkspace');
const SCRATCH_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'ScratchOrgService', 'tests', 'mocks');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));
const SCRATCH_CREATE_SUCCESS = fs.readFileSync(path.join(SCRATCH_ORG_MOCKS_PATH, 'scratchCreateSuccess.json'), 'utf-8');
const SCRATCH_CREATE_LIMIT_REACHED = fs.readFileSync(path.join(SCRATCH_ORG_MOCKS_PATH, 'scratchCreateLimitReached.json'), 'utf-8');
const DEPLOY_SUCCESS = fs.readFileSync(path.join(SCRATCH_ORG_MOCKS_PATH, 'deploySuccess.json'), 'utf-8');
const DEPLOY_ONE_COMPONENT_FAILURE = fs.readFileSync(path.join(SCRATCH_ORG_MOCKS_PATH, 'deployOneComponentFailure.json'), 'utf-8');

const NEW_SCRATCH_USERNAME = 'test-newscratch@example.com';
const DEV_HUB_AUTHORIZATION = { username: 'hub@example.com', aliases: ['devhub'], isDevHub: true, instanceUrl: 'https://acme.my.salesforce.com' };
const LEAD_TREE_KEY = 'Lead-ONLY';

// THE ORG AS A DESCRIBE WOULD ANSWER IT: EVERY FIELD THE FIXTURE RECIPES SEND, SO A CREATE IS READY WHERE NOTHING ELSE STOPS IT
const RAW_DESCRIBES: Record<string, unknown> = {
    Lead: { name: 'Lead', createable: true, fields: [
        { name: 'Company', type: 'string', nillable: false, createable: true },
        { name: 'Status', type: 'picklist', nillable: true, createable: true }
    ] },
    Account: { name: 'Account', createable: true, fields: [{ name: 'Name', type: 'string', nillable: false, createable: true }] },
    Contact: { name: 'Contact', createable: true, fields: [{ name: 'LastName', type: 'string', nillable: false, createable: true }] },
    OtherChildObject__c: { name: 'OtherChildObject__c', createable: true, fields: [] }
};

function buildFakeConnection() {

    return {
        instanceUrl: 'https://ability-new-7.scratch.my.salesforce.com',
        describe: jest.fn().mockImplementation(async (objectApiName: string) => RAW_DESCRIBES[objectApiName]),
        query: jest.fn().mockImplementation(async (soql: string) => (
            soql.includes('FROM Organization')
                ? { records: [{ IsSandbox: true, OrganizationType: 'Developer Edition' }] }
                : { totalSize: 3, records: [] }
        )),
        sobject: jest.fn()
    };

}

type CliHandler = (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';

describe('RecipeCockpitService, "+ New scratch org" in Data-by-Org (#200)', () => {

    describe('routePanelMessage', () => {

        const buildRenderedPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.dataOrgObjectApiNames = new Set(['Lead']);
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' }];
            return panelState;
        };

        const runningState = { command: 'scratchOrgState' as const, isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false };

        it('routes a createScratchOrg beside a drawn picker, whatever else the message carries -- none of it is read', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, buildRenderedPanelState())).toEqual({ kind: 'createScratchOrg' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg', filePath: '/etc/passwd', orgIndex: 0 } as any, buildRenderedPanelState())).toEqual({ kind: 'createScratchOrg' });

        });

        it('answers a createScratchOrg before the model was drawn with a state that runs nothing', () => {

            const panelState = buildRenderedPanelState();
            panelState.dataOrgObjectApiNames = new Set();

            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)).toEqual({
                kind: 'postScratchOrgState',
                hostMessage: { command: 'scratchOrgState', isRunning: false, statusText: '', isFailure: false, hasOutput: false }
            });

        });

        it('refuses a second createScratchOrg, and a Create, an org selection or ⟳, while one is running', () => {

            const panelState = buildRenderedPanelState();
            panelState.scratchOrgStateMessage = runningState;
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            panelState.creatableObjectKeys = new Set([`${LEAD_TREE_KEY}\nLead`]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(LEAD_TREE_KEY, '/workspace/lead.yml');

            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgCounts' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'createRecords', orgIndex: 0, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', count: 1 }, panelState))
                .toMatchObject({ kind: 'postCreateState', hostMessage: { isRunning: false } });

            panelState.scratchOrgStateMessage = { ...runningState, isRunning: false };

            expect(RecipeCockpitService.routePanelMessage({ command: 'createRecords', orgIndex: 0, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', count: 1 }, panelState))
                .toMatchObject({ kind: 'createRecords' });

        });

        it('refuses a createScratchOrg while a Create is in flight', () => {

            const panelState = buildRenderedPanelState();
            panelState.createStateMessage = { command: 'createState', isRunning: true, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead' };

            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');

        });

        it('opens only the result file the host holds, never a path from the panel, and nothing while running', () => {

            const panelState = buildRenderedPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewScratchOrgOutput', filePath: '/etc/passwd' }, panelState)).toBeUndefined();

            panelState.scratchOrgOutputFilePath = '/workspace/treecipe/OrgOperations/x/1-scratch-deploy.json';

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewScratchOrgOutput', filePath: '/etc/passwd' }, panelState))
                .toEqual({ kind: 'viewScratchOrgOutput', outputFilePath: '/workspace/treecipe/OrgOperations/x/1-scratch-deploy.json' });

            panelState.scratchOrgStateMessage = runningState;

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewScratchOrgOutput' }, panelState)).toBeUndefined();

        });

        it('replays the run\'s status line to a reloaded document', () => {

            const panelState = buildRenderedPanelState();
            panelState.scratchOrgStateMessage = runningState;

            expect(RecipeCockpitService.buildReplayMessages(panelState)).toContainEqual(runningState);

        });

    });

    describe('the preview warning', () => {

        it('says Data-by-Org can create a scratch org through the configured Dev Hub', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"+ New scratch org" creates a scratch org through the Dev Hub the Salesforce CLI has configured as its default (target-dev-hub)');

        });

    });

    describe('the host, against a faked Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedDevHubEnvironmentValue: string | undefined;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let cliHandlers: Partial<Record<'create' | 'deploy', CliHandler>>;
        let isNewOrgListedByCli: boolean;
        let isNewOrgAuthorized: boolean;
        let heldCliCallbacks: Array<() => void>;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let workspaceStateUpdate: jest.Mock;
        let openFileSpy: jest.SpyInstance;
        let notificationWarningSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const cliCallKinds = () => cliCalls.map(argumentList => argumentList.slice(0, 2).join(' '));
        const lastScratchOrgState = () => postedNamed('scratchOrgState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const aliasOf = (createArguments: string[]) => createArguments[createArguments.indexOf('--alias') + 1];

        const buildOrgListStdout = () => {
            const orgList = JSON.parse(JSON.stringify(SF_ORG_LIST));
            if ( isNewOrgListedByCli && isNewOrgAuthorized ) {
                orgList.result.scratchOrgs.push({ username: NEW_SCRATCH_USERNAME, alias: 'new', isScratch: true, status: 'Active', isExpired: false });
            }
            return JSON.stringify(orgList);
        };

        const openRenderedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: workspaceStateUpdate });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-scratch-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(PROJECT_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(workspaceRoot, '.sf'));
            fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), JSON.stringify({ 'target-dev-hub': 'devhub' }));
            fs.mkdirSync(path.join(temporaryRoot, 'home'));
            jest.spyOn(os, 'homedir').mockReturnValue(path.join(temporaryRoot, 'home'));
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');
            savedDevHubEnvironmentValue = process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
            delete process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];

            SalesforceOrgService.clearConnectedOrgStatusCache();
            SalesforceOrgService.clearRecordCountCache();
            SalesforceOrgService.clearDescribeCache();
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            heldCliCallbacks = [];
            cancellationListeners = [];
            isNewOrgListedByCli = true;
            isNewOrgAuthorized = false;
            cliHandlers = {
                create: () => ({ stdout: SCRATCH_CREATE_SUCCESS }),
                deploy: () => ({ stdout: DEPLOY_SUCCESS })
            };
            workspaceStateUpdate = jest.fn().mockResolvedValue(undefined);

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                if ( argumentList[0] === 'org' && argumentList[1] === 'list' ) {
                    answerWith({ stdout: buildOrgListStdout() });
                } else {
                    const cliAnswer = cliHandlers[argumentList[0] === 'org' ? 'create' : 'deploy'](argumentList);
                    if ( cliAnswer === 'hold' ) {
                        heldCliCallbacks.push(() => answerWith({ stdout: argumentList[0] === 'org' ? SCRATCH_CREATE_SUCCESS : DEPLOY_SUCCESS }));
                    } else {
                        if ( argumentList[0] === 'org' && !cliAnswer.error ) {
                            isNewOrgAuthorized = true;
                        }
                        answerWith(cliAnswer);
                    }
                }
                return { kill: jest.fn(() => undefined) };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => [
                ...ORG_AUTHORIZATIONS,
                DEV_HUB_AUTHORIZATION,
                ...( isNewOrgAuthorized ? [{ username: NEW_SCRATCH_USERNAME, aliases: ['new'], isScratchOrg: true, isExpired: false, instanceUrl: 'https://ability-new-7.scratch.my.salesforce.com' }] : [] )
            ]);

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancellationListeners.push(listener); } };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
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
            notificationWarningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => buildFakeConnection() as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {

            process.env.PATH = savedPathVariable;

            if ( savedDevHubEnvironmentValue === undefined ) {
                delete process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
            } else {
                process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE] = savedDevHubEnvironmentValue;
            }

            fs.rmSync(temporaryRoot, { recursive: true, force: true });

        });

        it('names the Dev Hub, the definition file, the package directories, the alias and 7 days in a modal, and Cancel starts no process', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            const [modalMessage, modalOptions, modalAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(modalMessage).toBe('Create a scratch org through the Dev Hub devhub (hub@example.com) and deploy this project\'s source to it?');
            expect(modalOptions.modal).toBe(true);
            expect(modalOptions.detail).toContain('Dev Hub: devhub (hub@example.com) — set by this project\'s .sf or .sfdx config');
            expect(modalOptions.detail).toContain('  Edition: Developer');
            expect(modalOptions.detail).toContain('This deploys metadata authored in this repository, and the definition file decides who administers the new org.');
            expect(modalOptions.detail).not.toContain('replacements');
            expect(modalOptions.detail).toContain(`Definition file: ${path.join('config', 'project-scratch-def.json')}`);
            expect(modalOptions.detail).toContain('Package directories to deploy: force-app, unpackaged');
            expect(modalOptions.detail).toMatch(/Alias: treecipe-\d{8}-\d{6}/);
            expect(modalOptions.detail).toContain('Duration: 7 days');
            expect(modalAction).toBe(RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL);

            expect(execFile).not.toHaveBeenCalled();
            expect(vscode.window.withProgress).not.toHaveBeenCalled();
            expect(lastScratchOrgState()).toEqual({ command: 'scratchOrgState', isRunning: false, statusText: '', isFailure: false, hasOutput: false });

        });

        it('creates, deploys, refreshes the connected-org cache, then selects the new org by username, remembers it, counts it and offers + Create', async () => {

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();

            expect(cliCallKinds()).toEqual(['org list']);

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds()).toEqual(['org list', 'org create', 'project deploy', 'org list']);
            const [createArguments, deployArguments] = [cliCalls[1], cliCalls[2]];
            const alias = createArguments[createArguments.indexOf('--alias') + 1];
            expect(alias).toMatch(/^treecipe-\d{8}-\d{6}$/);
            expect(createArguments).toEqual([
                'org', 'create', 'scratch',
                '--definition-file', path.join('config', 'project-scratch-def.json'),
                '--alias', alias,
                '--duration-days', '7',
                '--target-dev-hub', 'devhub',
                '--json'
            ]);
            expect(deployArguments).toEqual(['project', 'deploy', 'start', '--target-org', alias, '--json']);
            expect(deployArguments).not.toContain('--ignore-errors');

            const lastList = postedNamed('dataOrgList').at(-1);
            const newOrgIndex = lastList.orgLabels.indexOf('new');
            expect(newOrgIndex).toBeGreaterThanOrEqual(0);
            expect(lastList.selectedOrgIndex).toBe(newOrgIndex);
            expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgIndex: newOrgIndex, isSandbox: true });
            expect(workspaceStateUpdate).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, NEW_SCRATCH_USERNAME);
            expect(postedNamed('dataOrgCounts').at(-1)).toMatchObject({ isComplete: true, connectionFailureMessage: '' });
            expect(postedNamed('dataOrgReadiness').at(-1).createTargets.find((readiness: any) => readiness.treeKey === LEAD_TREE_KEY && readiness.objectApiName === 'Lead'))
                .toMatchObject({ disabledReason: '' });

            const phases = postedNamed('scratchOrgState').map(scratchOrgState => scratchOrgState.statusText);
            expect(phases).toIncludeAllMembers(['Creating scratch org…', 'Deploying source…']);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: false, hasOutput: true });
            expect(lastScratchOrgState().statusText).toContain(`Scratch org ${alias} (${NEW_SCRATCH_USERNAME}) is ready: 3 components deployed. It is selected in Data-by-Org.`);
            expect(postedPanelMessages.indexOf(lastScratchOrgState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgReadiness').at(-1)));
            expect(JSON.stringify(postedNamed('scratchOrgState'))).not.toContain(workspaceRoot);

        });

        it('shows an ERROR naming the alias and the failure count when the deploy fails, keeps and selects the org, and View output opens the saved deploy result', async () => {

            cliHandlers.deploy = () => ({ stdout: DEPLOY_ONE_COMPONENT_FAILURE, error: Object.assign(new Error('exit 1'), { code: 1 }) });
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });
            await flushAsyncWork();

            const alias = aliasOf(cliCalls.find(argumentList => argumentList[1] === 'create'));
            const [errorText, errorAction] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
            expect(errorText).toBe(`Deploy to ${alias} failed — 1 component failure`);
            expect(errorAction).toBe(RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL);
            // THE ONLY WARNING IS THE CONFIRMATION -- A FAILED DEPLOY IS NEVER A WARNING
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect(notificationWarningSpy).not.toHaveBeenCalled();

            expect(cliCallKinds().slice(-1)).toEqual(['org list']);
            expect(postedNamed('dataOrgSelection').at(-1).orgLabel).toBe('new');
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: true });
            expect(lastScratchOrgState().statusText).toStartWith(`Deploy to ${alias} failed — 1 component failure. The scratch org is kept, but it has none of the project's metadata until a deploy succeeds. It is selected in Data-by-Org.`);

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME);
            const deployResultFileName = fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-scratch-deploy.json'));
            const deployResultFilePath = path.join(operationsFolderPath, deployResultFileName);
            expect(readJson(deployResultFilePath)).toEqual(JSON.parse(DEPLOY_ONE_COMPONENT_FAILURE));
            expect(openFileSpy).toHaveBeenCalledWith(deployResultFilePath);

            openFileSpy.mockClear();
            await receivedMessageHandler({ command: 'viewScratchOrgOutput', filePath: '/etc/passwd' });

            expect(openFileSpy).toHaveBeenCalledTimes(1);
            expect(openFileSpy).toHaveBeenCalledWith(deployResultFilePath);

        });

        it('selects no other org in its place when the refreshed list does not include the new org, and says it is not listed yet', async () => {

            isNewOrgListedByCli = false;
            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();
            const selectionsBefore = postedNamed('dataOrgSelection').length;

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds().indexOf('org create')).toBeLessThan(cliCallKinds().lastIndexOf('org list'));
            expect(postedNamed('dataOrgSelection')).toHaveLength(selectionsBefore);
            expect(postedNamed('dataOrgList').at(-1).selectedOrgIndex).toBeNull();
            expect(lastScratchOrgState().statusText).toContain(`does not list`);
            expect(lastScratchOrgState().statusText).toContain('so no org was selected in its place');
            expect(workspaceStateUpdate).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, undefined);

        });

        it('refuses before any process when no default Dev Hub is set, naming "sf config set target-dev-hub"', async () => {

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(execFile).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('sf config set target-dev-hub'));
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true });

        });

        it.each([
            ['a missing config/project-scratch-def.json', () => fs.rmSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json')), 'No scratch org definition file found'],
            ['a missing sfdx-project.json', () => fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json')), 'No "sfdx-project.json" found'],
            ['an unparseable sfdx-project.json', () => fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{'), 'Could not parse']
        ])('refuses %s before any process', async (_label, breakWorkspace, expectedMessage) => {

            breakWorkspace();
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(execFile).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining(expectedMessage));

        });

        it('says the Salesforce CLI is required when sf is not installed, and leaves nothing behind', async () => {

            cliHandlers.create = () => ({ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds()).toEqual(['org create']);
            // NO "View output": THERE IS NO OUTPUT
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0]).toEqual([
                RecipeYamlScalar.escapeForNotification(`The scratch org ${aliasOf(cliCalls[0])} was not created: ${ScratchOrgService.buildCliRequiredMessage()}`)
            ]);
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME))).toBe(false);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: false });

        });

        it('shows the CLI\'s message escaped when the create fails, attempts no deploy, and offers its saved output', async () => {

            cliHandlers.create = () => ({ stdout: SCRATCH_CREATE_LIMIT_REACHED, error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds()).toEqual(['org create']);
            const [errorText, errorAction] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
            expect(errorText).toContain('has reached its active scratch org limit');
            expect(errorText).not.toContain('[Click](command:');
            expect(errorAction).toBe(RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: true });
            expect(lastScratchOrgState().statusText).toContain('No deploy was attempted.');

            const alias = aliasOf(cliCalls[0]);
            expect(fs.readdirSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, alias))).toEqual([expect.stringMatching(/-scratch-create\.json$/)]);

        });

        it('reports a create that answered malformed JSON as a failure', async () => {

            cliHandlers.create = () => ({ stdout: '{"status":0,"result":{"username":"--json"}}' });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds()).toEqual(['org create']);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true });
            expect(postedNamed('dataOrgSelection')).toHaveLength(0);

        });

        it('kills the deploy when cancelled, then refreshes, lists and selects the kept org, saying the deploy stopped partway', async () => {

            cliHandlers.deploy = () => {
                cancellationToken.isCancellationRequested = true;
                cancellationListeners.forEach(cancellationListener => cancellationListener());
                return { stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) };
            };
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            const deployProcess = (execFile as unknown as jest.Mock).mock.results[cliCallKinds().indexOf('project deploy')].value;
            expect(deployProcess.kill).toHaveBeenCalled();
            expect(cliCallKinds()).toEqual(['org create', 'project deploy', 'org list']);
            expect(postedNamed('dataOrgSelection').at(-1).orgLabel).toBe('new');
            expect(lastScratchOrgState().statusText).toContain('was stopped partway, so some components may be missing');
            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls.at(-1)[0]).toContain('stopped partway');

        });

        it('kills the create when cancelled and says a scratch org may still have been created', async () => {

            cliHandlers.create = () => {
                cancellationToken.isCancellationRequested = true;
                cancellationListeners.forEach(cancellationListener => cancellationListener());
                return { stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) };
            };
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect((execFile as unknown as jest.Mock).mock.results[0].value.kill).toHaveBeenCalled();
            expect(cliCallKinds()).toEqual(['org create']);
            expect(lastScratchOrgState().statusText).toContain('A scratch org may still have been created: check with "sf org list".');

        });

        it('tells a panel closed and reopened mid-run where the run is, and its router refuses what the run holds', async () => {

            cliHandlers.create = () => 'hold';
            await openRenderedCockpit();
            const firstRun = receivedMessageHandler({ command: 'createScratchOrg' });
            await flushAsyncWork();
            await flushAsyncWork();

            // CLOSED: onDidDispose RESETS THE PANEL STATE, AND THE NEXT OPEN BUILDS A NEW PANEL
            const disposeHandler = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1).value.onDidDispose.mock.calls[0][0];
            disposeHandler();
            postedPanelMessages.length = 0;
            await openRenderedCockpit();

            expect((RecipeCockpitService as any).recipeCockpitPanelState.scratchOrgStateMessage).toMatchObject({ isRunning: true, statusText: 'Creating scratch org…' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, (RecipeCockpitService as any).recipeCockpitPanelState)).toBeUndefined();

            await receivedMessageHandler({ command: 'ready' });
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'scratchOrgState').at(-1)).toMatchObject({ isRunning: true });

            isNewOrgAuthorized = true;
            heldCliCallbacks.forEach(releaseCliCallback => releaseCliCallback());
            await firstRun;

            // THE RUN'S CLOSING STATE REACHES THE PANEL OPEN NOW, NOT THE ONE IT STARTED IN
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false });
            expect((RecipeCockpitService as any).recipeCockpitPanelState.scratchOrgStateMessage).toMatchObject({ isRunning: false });

        });

        it('answers a panel that missed the run with the run\'s state rather than leaving its button disabled', async () => {

            cliHandlers.create = () => 'hold';
            await openRenderedCockpit();
            const firstRun = receivedMessageHandler({ command: 'createScratchOrg' });
            await flushAsyncWork();
            await flushAsyncWork();
            (RecipeCockpitService as any).recipeCockpitPanelState.scratchOrgStateMessage = undefined;
            postedPanelMessages.length = 0;

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(postedPanelMessages).toEqual([expect.objectContaining({ command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…' })]);

            heldCliCallbacks.forEach(releaseCliCallback => releaseCliCallback());
            await firstRun;

        });

        it('notes replacements and the definition\'s admin in the modal, each on a line of its own', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            fs.writeFileSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'), JSON.stringify({ edition: 'Developer', adminEmail: 'author@example.com\nDev Hub: fake' }));
            const sfdxProject = readJson(path.join(workspaceRoot, 'sfdx-project.json'));
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), JSON.stringify({ ...sfdxProject, replacements: [{ filename: 'a', stringToReplace: 'b', replaceWithFile: '/etc/hosts' }] }));
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            const modalDetail: string = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail;
            expect(modalDetail).toContain('  Admin email: author@example.com Dev Hub: fake');
            expect(modalDetail.split('\n').filter(detailLine => detailLine.startsWith('Dev Hub:'))).toHaveLength(1);
            expect(modalDetail).toContain('sfdx-project.json has "replacements" that copy local files or environment variables into the deployed metadata.');

        });

        it('says a cancel between the create and the deploy deployed nothing', async () => {

            cliHandlers.create = () => {
                cancellationToken.isCancellationRequested = true;
                return { stdout: SCRATCH_CREATE_SUCCESS };
            };
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(cliCallKinds()).toEqual(['org create', 'org list']);
            expect(lastScratchOrgState().statusText).toContain('before anything was deployed to it');
            expect(postedNamed('dataOrgSelection').at(-1).orgLabel).toBe('new');

        });

        it('warns, rather than reporting a failure, when the deploy\'s answer was too large to read', async () => {

            cliHandlers.deploy = () => ({ stdout: '', error: Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('its answer was too large to read, so whether it succeeded is unknown'));
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: false });
            expect(postedNamed('dataOrgSelection').at(-1).orgLabel).toBe('new');

        });

        it('runs one setup at a time whatever the panel sends, and replays its phase to a reloaded document', async () => {

            cliHandlers.create = () => 'hold';
            await openRenderedCockpit();

            const firstRun = receivedMessageHandler({ command: 'createScratchOrg' });
            await flushAsyncWork();
            await flushAsyncWork();

            expect(cliCallKinds()).toEqual(['org create']);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: true, statusText: 'Creating scratch org…' });

            await receivedMessageHandler({ command: 'createScratchOrg' });
            await receivedMessageHandler({ command: 'ready' });

            expect(cliCallKinds()).toEqual(['org create']);
            expect(vscode.window.withProgress).toHaveBeenCalledTimes(1);
            expect(postedPanelMessages.at(-1)).toMatchObject({ command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…' });

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            isNewOrgAuthorized = true;
            heldCliCallbacks.forEach(releaseCliCallback => releaseCliCallback());
            await firstRun;

            expect(cliCallKinds()).toEqual(['org create', 'project deploy', 'org list']);
            expect(lastScratchOrgState()).toMatchObject({ isRunning: false });

        });

    });

    describe('the host, at its edges', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let temporaryRoot: string;
        let workspaceRoot: string;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const lastScratchOrgState = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'scratchOrgState').at(-1);

        const openCockpit = async (isRendered = true) => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });
            if ( isRendered ) {
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            }
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-scratch-edges-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            postedPanelMessages = [];
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (execFile as unknown as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
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
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        const PLAN = {
            workspaceRoot: '',
            definitionFilePath: '/def.json',
            definitionFileRelativePath: 'config/project-scratch-def.json',
            packageDirectoryPaths: ['force-app'],
            devHub: { targetOrgIdentifier: 'hub@example.com', username: 'hub@example.com', configSource: 'global' as const },
            alias: 'treecipe-20261010-000000',
            durationDays: 7,
            definitionSummary: {},
            hasFileOrEnvironmentReplacements: false
        };

        it('answers a click before the model was drawn with a state that runs nothing, through the executor', async () => {

            await openCockpit(false);

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(lastScratchOrgState()).toEqual({ command: 'scratchOrgState', isRunning: false, statusText: '', isFailure: false, hasOutput: false });
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        it('runs nothing while the window already has a run in flight, even for a panel state that does not know it', async () => {

            await openCockpit();
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = true;
            const resolvePlanSpy = jest.spyOn(ScratchOrgService, 'resolveScratchOrgPlan');

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(resolvePlanSpy).not.toHaveBeenCalled();

        });

        it('names the Dev Hub by username alone when it has no alias, and says "1 component"', async () => {

            jest.spyOn(ScratchOrgService, 'resolveScratchOrgPlan').mockResolvedValue({ ...PLAN, workspaceRoot });
            jest.spyOn(ScratchOrgService, 'runScratchOrgSetup').mockResolvedValue({ kind: 'deployed', username: 'test-one@example.com', deployedComponentCount: 1 });
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [], hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 }, hiddenOrgCount: 0 });
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
            await openCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toBe('Create a scratch org through the Dev Hub hub@example.com and deploy this project\'s source to it?');
            expect(lastScratchOrgState().statusText).toStartWith('Scratch org treecipe-20261010-000000 (test-one@example.com) is ready: 1 component deployed.');
            expect(lastScratchOrgState()).toMatchObject({ isFailure: true, hasOutput: false });

        });

        it('ends the run and reports an unexpected failure like any other error, leaving the panel usable', async () => {

            jest.spyOn(ScratchOrgService, 'resolveScratchOrgPlan').mockResolvedValue({ ...PLAN, workspaceRoot });
            (vscode.window.withProgress as jest.Mock).mockRejectedValue(new Error('progress broke'));
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined as any);
            await openCockpit();

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(lastScratchOrgState()).toEqual({ command: 'scratchOrgState', isRunning: false, statusText: 'The scratch org setup stopped: progress broke', isFailure: true, hasOutput: false });
            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect((RecipeCockpitService as any).isScratchOrgSetupInFlight).toBe(false);

        });

        it('opens no result file that has gone since the run wrote it', async () => {

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            await openCockpit();
            (RecipeCockpitService as any).recipeCockpitPanelState.scratchOrgOutputFilePath = path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, 'gone', 'x-scratch-deploy.json');

            await receivedMessageHandler({ command: 'viewScratchOrgOutput' });

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith('The scratch org result file no longer exists in this workspace.');

        });

        it('only remembers the new org, and asks the CLI whether it is listed, when the panel closed mid-run', async () => {

            const workspaceStateUpdate = jest.fn().mockResolvedValue(undefined);
            jest.spyOn(ScratchOrgService, 'resolveScratchOrgPlan').mockResolvedValue({ ...PLAN, workspaceRoot });
            jest.spyOn(ScratchOrgService, 'runScratchOrgSetup').mockImplementation(async () => {
                (RecipeCockpitService as any).recipeCockpitPanel = undefined;
                return { kind: 'deployed', username: 'test-closed@example.com', deployedComponentCount: 2 };
            });
            const listSpy = jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({
                orgDetails: [{ targetOrgIdentifier: 'closed', username: 'test-closed@example.com', alias: 'closed' }],
                hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 }, hiddenOrgCount: 0
            });
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: workspaceStateUpdate });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(listSpy).toHaveBeenCalledTimes(1);
            expect(workspaceStateUpdate).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'test-closed@example.com');
            expect(postedPanelMessages.slice(postedBefore).filter(hostMessage => hostMessage.command !== 'scratchOrgState' || hostMessage.isRunning)).toEqual([
                expect.objectContaining({ command: 'scratchOrgState', isRunning: true })
            ]);

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
        };

        const renderPanel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            return panel;
        };

        const firstOf = (panel: ReturnType<typeof runPanelScript>, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];

        const selectOrgWithLeadReady = (panel: ReturnType<typeof runPanelScript>) => {
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence: 5, renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgReadiness', objects: [{ objectApiName: 'Lead', disabledReason: '', requiredLookups: [] }], createTargets: [], createResults: [], requestSequence: 5, renderSequence: 1 });
        };

        const leadCreateButton = (panel: ReturnType<typeof runPanelScript>) => {
            const leadCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeName').some((nameElement: any) => nameElement.textContent.includes('Lead')))
                ?? panel.treeCards().at(-1);
            return panel.findAll(leadCard, 'dataCreate')[0];
        };

        it('draws "+ New scratch org" beside the toolbar\'s org dropdown, and posts a message that carries nothing', () => {

            const panel = renderPanel();
            const pickerElement = firstOf(panel, 'dataOrgControls');
            const newScratchElement = firstOf(panel, 'dataOrgNewScratch');

            expect(newScratchElement.textContent).toBe('+ New scratch org');
            expect(newScratchElement.parentNode).toBe(pickerElement);
            expect(pickerElement.children.indexOf(newScratchElement)).toBeGreaterThan(pickerElement.children.indexOf(firstOf(panel, 'dataOrgSelect')));

            panel.postToPanel({ command: 'rendered' });
            newScratchElement.dispatch('click');

            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'createScratchOrg')).toEqual([{ command: 'createScratchOrg' }]);
            expect(newScratchElement.disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);

            newScratchElement.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'createScratchOrg')).toHaveLength(1);

        });

        it('draws no button where there is no tree to count', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: 'No runs.' }, renderSequence: 1 });

            expect(firstOf(panel, 'dataOrgNewScratch')).toBeUndefined();

        });

        it('disables the button, the dropdown, ⟳ and every + Create while a run is in flight, and gives them back when it ends', () => {

            const panel = renderPanel();
            panel.expandAllTrees();
            panel.treeCards().forEach((treeCard: any) => panel.openTab(treeCard, 'Data-by-Org'));
            selectOrgWithLeadReady(panel);

            expect(leadCreateButton(panel).disabled).toBe(false);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true, statusText: 'Deploying source…', isFailure: false, hasOutput: false });

            expect(leadCreateButton(panel).disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgRefresh').disabled).toBe(true);
            expect(firstOf(panel, 'scratchOrgStatusText').textContent).toBe('Deploying source…');
            expect(panel.isHidden(firstOf(panel, 'scratchOrgViewOutput'))).toBe(true);

            // A LISTING THE RUN POSTS ON ITS WAY OUT DOES NOT RE-ENABLE WHAT THE RUN HOLDS
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'new'], selectedOrgIndex: 1, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgRefresh').disabled).toBe(true);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: false, statusText: 'Deploy to treecipe-x failed — 1 component failure.', isFailure: true, hasOutput: true });

            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(false);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(false);
            expect(firstOf(panel, 'dataOrgRefresh').disabled).toBe(false);
            expect(firstOf(panel, 'scratchOrgStatus').classList.contains('failed')).toBe(true);
            expect(firstOf(panel, 'scratchOrgStatusText').textContent).toBe('Deploy to treecipe-x failed — 1 component failure.');

            const viewOutputElement = firstOf(panel, 'scratchOrgViewOutput');
            expect(panel.isHidden(viewOutputElement)).toBe(false);
            viewOutputElement.dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'viewScratchOrgOutput' });

        });

        it('holds the button while a Create runs, and posts no org listing while a run is in flight', () => {

            const panel = renderPanel();
            panel.postToPanel({ command: 'rendered' });
            panel.postToPanel({ command: 'createState', isRunning: true, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead' });

            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);

            panel.postToPanel({ command: 'createState', isRunning: false, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead' });
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(false);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false });
            firstOf(panel, 'dataOrgLoad').dispatch('click');
            panel.expandAllTrees();
            panel.treeCards().forEach((treeCard: any) => panel.openTab(treeCard, 'Data-by-Org'));

            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadDataOrgs')).toHaveLength(0);

        });

        it('draws a run replayed before the model is rendered again once the picker exists', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false });
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });

            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);
            expect(firstOf(panel, 'scratchOrgStatusText').textContent).toBe('Creating scratch org…');

        });

        it('builds the shell from the nonce alone, so every new line reaches the panel through postMessage', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);
            expect(RecipeCockpitService.buildWebviewShellHtml('n')).not.toContain('Creating scratch org…');
            expect(ScratchOrgService.buildCliRequiredMessage()).toContain('Salesforce CLI');

        });

    });

});
