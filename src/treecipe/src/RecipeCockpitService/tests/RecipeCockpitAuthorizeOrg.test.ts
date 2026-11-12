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
    env: { openExternal: jest.fn(), clipboard: { writeText: jest.fn() } },
    window: {
        createWebviewPanel: jest.fn(),
        createQuickPick: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string, isStrict?: boolean) => ({ parsedFrom: uriValue, isStrict: isStrict, toString: () => uriValue }) }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() },
    WebOAuthServer: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo, Org } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_ACTION_VERB_EMOJI,
    RECIPE_COCKPIT_DATA_ORG_STATE_KEY,
    RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL,
    RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE,
    RECIPE_COCKPIT_VERB_BUTTON_VERBS
} from '../RecipeCockpitService';
import {
    RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PROMPT,
    RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_DEFAULT_CHECKBOX_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PLACEHOLDER,
    RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT
} from '../RecipeCockpitOrgAuthorize';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { ICoreLibraryOrgLoginRun, IOrgLoginRun, OrgLoginOutcome, SalesforceOrgLogin, SANDBOX_SUBDOMAIN_REFUSAL } from '../../SalesforceOrgService/SalesforceOrgLogin';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { answerOrgConnectionPings, CONNECTED_ORG_USERNAMES } from '../../SalesforceOrgService/tests/OrgConnectionPings';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');
const ORG_AUTHORIZATIONS = JSON.parse(fs.readFileSync(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'), 'utf-8'));

const NEW_SANDBOX_USERNAME = 'new@example.com.newsbx';
const NEW_SANDBOX_AUTHORIZATION = { username: NEW_SANDBOX_USERNAME, aliases: ['newsbx'], isSandbox: true, isExpired: false, instanceUrl: 'https://acme--newsbx.sandbox.my.salesforce.com' };
const PRODUCTION_USERNAME = 'admin@example.com';
const PRODUCTION_AUTHORIZATION = { username: PRODUCTION_USERNAME, aliases: [], isExpired: false, instanceUrl: 'https://acme.my.salesforce.com' };
const CHOSEN_ALIAS = 'newsbx';
const TYPED_SANDBOX_SUBDOMAIN = 'acme--newsbx';
const SANDBOX_LOGIN_ADDRESS = 'https://acme--newsbx.sandbox.my.salesforce.com';
const AUTHORIZATION_URL = 'https://test.salesforce.com/services/oauth2/authorize?client_id=PlatformCLI';
const LEAD_TREE_KEY = 'Lead-ONLY';

beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockResolvedValue(undefined);
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, "Authorize org" beside "+ New scratch org" (#630)', () => {

    describe('routePanelMessage', () => {

        const buildRenderedPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.dataOrgObjectApiNames = new Set(['Lead']);
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' }];
            return panelState;
        };

        const idleRefusal = { kind: 'postScratchOrgState', hostMessage: { command: 'scratchOrgState', isRunning: false } };

        it('routes an authorizeOrg beside a drawn picker, whatever else the message carries -- none of it is read', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg' }, buildRenderedPanelState())).toEqual({ kind: 'authorizeOrg' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg', loginUrl: 'https://evil.example.com', alias: 'x', isChecked: true } as any, buildRenderedPanelState()))
                .toEqual({ kind: 'authorizeOrg' });

        });

        it('answers an authorizeOrg before the model was drawn with a state that runs nothing', () => {

            const panelState = buildRenderedPanelState();
            panelState.dataOrgObjectApiNames = new Set();

            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg' }, panelState)).toEqual(idleRefusal);

        });

        it('refuses an authorizeOrg while an insert, a permission set assignment or a metadata deploy is in flight', () => {

            const insertState = buildRenderedPanelState();
            insertState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: LEAD_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg' }, insertState)).toEqual(idleRefusal);

            const assignState = buildRenderedPanelState();
            assignState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: LEAD_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg' }, assignState)).toEqual(idleRefusal);

        });

        it('shares one lock with "+ New scratch org": neither starts while the other runs, and the login\'s state is replayed', () => {

            const loginRunningState = { command: 'scratchOrgState' as const, isRunning: true, isAuthorizing: true };
            const panelState = buildRenderedPanelState();
            panelState.scratchOrgStateMessage = loginRunningState;

            expect(RecipeCockpitService.routePanelMessage({ command: 'authorizeOrg' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)?.kind).toBe('refuseDataOrgListing');
            expect(RecipeCockpitService.buildReplayMessages(panelState)).toContainEqual(loginRunningState);

        });

    });

    describe('the alias box', () => {

        it('accepts an empty alias, refuses an unusable one, and warns when another org holds it', () => {

            const aliasHolders = new Map([['qa', 'qa@example.com.qa']]);

            expect(RecipeCockpitService.validateOrgAuthorizeAliasInput('', aliasHolders)).toBeUndefined();
            expect(RecipeCockpitService.validateOrgAuthorizeAliasInput('  ', aliasHolders)).toBeUndefined();
            expect(RecipeCockpitService.validateOrgAuthorizeAliasInput('new-sandbox', aliasHolders)).toBeUndefined();
            expect(RecipeCockpitService.validateOrgAuthorizeAliasInput('a@b', aliasHolders)).toContain('"@"');
            expect(RecipeCockpitService.validateOrgAuthorizeAliasInput('qa', aliasHolders)).toEqual({
                message: '"qa" is currently qa@example.com.qa. Authorizing will move it to the org you log in to.',
                severity: vscode.InputBoxValidationSeverity.Warning
            });

        });

        it('escapes a holder\'s username, which an input box would render as a link', () => {

            const validation = RecipeCockpitService.validateOrgAuthorizeAliasInput('qa', new Map([['qa', '[x](command:evil)']])) as vscode.InputBoxValidationMessage;

            expect(validation.message).not.toContain('[x](command:evil)');

        });

    });

    describe('the messages shown with no org to list', () => {

        it('point at the Authorize org button before the terminal command', () => {

            [RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE, RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE].forEach(noOrgsMessage => {
                expect(noOrgsMessage).toContain(`press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL}, or run "sf org login web --instance-url https://test.salesforce.com"`);
            });

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
        const postedAuthorizeMessages = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'authorizeOrg');

        it('draws "Authorize org" right after "+ New scratch org", a primary button with the authorize verb\'s emoji, and posts a message that carries nothing', () => {

            const panel = renderPanel();
            const pickerElement = firstOf(panel, 'dataOrgControls');
            const authorizeElement = firstOf(panel, 'dataOrgAuthorize');

            expect(authorizeElement.textContent).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL);
            expect(authorizeElement.className).toBe('sdtButton sdtButton-primary dataOrgAuthorize');
            expect(pickerElement.children.indexOf(authorizeElement)).toBe(pickerElement.children.indexOf(firstOf(panel, 'dataOrgNewScratch')) + 1);
            expect(RECIPE_COCKPIT_ACTION_VERB_EMOJI[RECIPE_COCKPIT_VERB_BUTTON_VERBS.dataOrgAuthorize]).toBe('🔑');

            panel.postToPanel({ command: 'rendered' });
            authorizeElement.dispatch('click');

            expect(postedAuthorizeMessages(panel)).toEqual([{ command: 'authorizeOrg' }]);
            expect(authorizeElement.disabled).toBe(true);
            expect(authorizeElement.textContent).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').textContent).toBe(RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);

            authorizeElement.dispatch('click');
            expect(postedAuthorizeMessages(panel)).toHaveLength(1);

        });

        it('draws no button where there is no tree', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: 'No runs.' }, renderSequence: 1 });

            expect(firstOf(panel, 'dataOrgAuthorize')).toBeUndefined();

        });

        it('shows a replayed login as running on its own button only, and gives every control back when it ends', () => {

            const panel = renderPanel();

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true, isAuthorizing: true });

            expect(firstOf(panel, 'dataOrgAuthorize').textContent).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL);
            expect(firstOf(panel, 'dataOrgAuthorize').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').textContent).toBe(RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: false });

            expect(firstOf(panel, 'dataOrgAuthorize').textContent).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL);
            expect(firstOf(panel, 'dataOrgAuthorize').disabled).toBe(false);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(false);

        });

        it('leaves "Authorize org" idle, but disabled, while a scratch org is being set up', () => {

            const panel = renderPanel();

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true });

            expect(firstOf(panel, 'dataOrgAuthorize').textContent).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL);
            expect(firstOf(panel, 'dataOrgAuthorize').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').textContent).toBe('Setting up scratch org…');

        });

    });

    describe('the login run', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let postedPanelMessages: any[];
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let workspaceStateUpdate: jest.Mock;
        let authorizedAuthorizations: object[];
        let loginSpy: jest.SpyInstance;
        let aliasSpy: jest.SpyInstance;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };

        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const lastOrgList = () => postedNamed('dataOrgList').at(-1);
        const configFilePath = () => path.join(workspaceRoot, '.sf', 'config.json');
        const notificationTexts = (notificationMock: unknown) => (notificationMock as jest.Mock).mock.calls
            .filter(([, firstOption]) => !( firstOption && typeof firstOption === 'object' && firstOption.inPanel ))
            .map(([notificationText]) => notificationText);

        const openRenderedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: workspaceStateUpdate });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        // THE CONFIRMATION IS THE ONE showWarningMessage CALL MARKED inPanel; EVERY OTHER IS A NOTIFICATION, WHICH ANSWERS NOTHING
        // EACH INPUT BOX IS ANSWERED BY ITS PROMPT, SO A TEST CAN ESCAPE ONE QUESTION AND NOT THE OTHER
        const answerInputBoxes = (subdomainAnswer: string | undefined, aliasAnswer: string | undefined) => {
            (vscode.window.showInputBox as jest.Mock).mockImplementation(async (inputBoxOptions: { prompt: string }) =>
                inputBoxOptions.prompt === RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT ? subdomainAnswer : aliasAnswer);
        };

        const answerConfirmation = (confirmAnswer: unknown) => {
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, firstOption: any) => (
                firstOption && typeof firstOption === 'object' && firstOption.inPanel ? confirmAnswer : undefined
            ));
        };

        const answerLogin = (loginOutcome: OrgLoginOutcome, authorization?: object) => {
            loginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithSalesforceCli').mockImplementation(async () => {
                if ( authorization ) {
                    authorizedAuthorizations.push(authorization);
                }
                return loginOutcome;
            });
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-authorize-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'home'));
            jest.spyOn(os, 'homedir').mockReturnValue(path.join(temporaryRoot, 'home'));

            SalesforceOrgService.clearConnectedOrgStatusCache();
            SalesforceOrgService.clearDescribeCache();
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            authorizedAuthorizations = [];
            workspaceStateUpdate = jest.fn().mockResolvedValue(undefined);

            (execFile as unknown as jest.Mock).mockReset();
            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => [...ORG_AUTHORIZATIONS, ...authorizedAuthorizations]);
            answerOrgConnectionPings(Org.create as jest.Mock, username => CONNECTED_ORG_USERNAMES.includes(username) || username === NEW_SANDBOX_USERNAME || username === PRODUCTION_USERNAME);

            cancellationListeners = [];
            cancellationToken = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancellationListeners.push(listener); } };
            aliasSpy = jest.spyOn(SalesforceOrgLogin, 'setAlias').mockResolvedValue(undefined);
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            [vscode.window.showWarningMessage, vscode.window.showErrorMessage, vscode.window.showInformationMessage, vscode.window.showInputBox, vscode.window.showQuickPick, vscode.env.openExternal]
                .forEach(windowMock => (windowMock as jest.Mock).mockReset());
            answerConfirmation(RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL);
            answerInputBoxes(TYPED_SANDBOX_SUBDOMAIN, CHOSEN_ALIAS);
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

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
            jest.spyOn(SalesforceOrgService, 'listAliasHolders').mockResolvedValue(new Map([['qa', 'qa@example.com.qa']]));
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                instanceUrl: NEW_SANDBOX_AUTHORIZATION.instanceUrl,
                describe: jest.fn().mockResolvedValue({ name: 'Lead', createable: true, fields: [] }),
                query: jest.fn().mockResolvedValue({ records: [{ IsSandbox: true, OrganizationType: 'Enterprise Edition' }] }),
                sobject: jest.fn()
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('asks the sandbox subdomain and the alias, with no quick pick, then confirms in the panel with one checkbox, and Cancel starts no login', async () => {

            answerConfirmation(undefined);
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
            expect((vscode.window.showInputBox as jest.Mock).mock.calls.map(([inputBoxOptions]) => inputBoxOptions.prompt))
                .toEqual([RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT, RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PROMPT]);

            const subdomainBoxOptions = (vscode.window.showInputBox as jest.Mock).mock.calls[0][0];
            expect(subdomainBoxOptions.placeHolder).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PLACEHOLDER);
            expect(`${subdomainBoxOptions.prompt} ${subdomainBoxOptions.placeHolder}`).not.toContain('https://');
            expect(subdomainBoxOptions.validateInput(TYPED_SANDBOX_SUBDOMAIN)).toBeUndefined();
            expect(subdomainBoxOptions.validateInput('acme')).toBe(SANDBOX_SUBDOMAIN_REFUSAL);

            const [confirmMessage, confirmOptions, ...confirmLabels] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(confirmMessage).toBe('Log in to a Salesforce org at acme--newsbx.sandbox.my.salesforce.com in your browser?');
            expect(confirmOptions.detail).toContain(`Login address: ${SANDBOX_LOGIN_ADDRESS}`);
            expect(confirmOptions.inPanel).toBe(true);
            expect(confirmOptions.checkboxLabel).toBe(RECIPE_COCKPIT_AUTHORIZE_ORG_DEFAULT_CHECKBOX_LABEL);
            expect(confirmOptions.detail).toContain(`Alias: ${CHOSEN_ALIAS}`);
            expect(confirmLabels).toEqual([RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL]);
            expect(confirmOptions.detail).toContain('Salesforce CLI or @salesforce/core');

            expect(loginSpy).not.toHaveBeenCalled();
            expect(vscode.window.withProgress).not.toHaveBeenCalled();
            expect(postedNamed('scratchOrgState')).toEqual([
                { command: 'scratchOrgState', isRunning: true, isAuthorizing: true },
                { command: 'scratchOrgState', isRunning: false }
            ]);

        });

        it.each([
            ['the sandbox subdomain', () => answerInputBoxes(undefined, CHOSEN_ALIAS)],
            ['the alias', () => answerInputBoxes(TYPED_SANDBOX_SUBDOMAIN, undefined)]
        ])('treats Escape at %s as a cancel: no confirmation, no login, the lock released', async (_caseName, escapeQuestion) => {

            escapeQuestion();
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

        it.each([
            ['a production My Domain name', 'acme'],
            ['another host', 'acme--qa.evil.com'],
            ['the shared sandbox login', 'https://test.salesforce.com']
        ])('starts no login for %s, even when the input box answers it', async (_caseName, typedText) => {

            answerInputBoxes(typedText, CHOSEN_ALIAS);
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

        it('with the box unticked: logs in through the browser, lists the org, and changes neither the selection nor .sf/config.json', async () => {

            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(loginSpy).toHaveBeenCalledWith(SANDBOX_LOGIN_ADDRESS, expect.anything());
            expect(aliasSpy).toHaveBeenCalledWith(CHOSEN_ALIAS, NEW_SANDBOX_USERNAME);
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();

            expect(lastOrgList().orgLabels.some((orgLabel: string) => orgLabel.includes(CHOSEN_ALIAS))).toBe(true);
            expect(workspaceStateUpdate).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, NEW_SANDBOX_USERNAME);
            expect(fs.existsSync(configFilePath())).toBe(false);

            expect(notificationTexts(vscode.window.showInformationMessage)).toEqual([`${CHOSEN_ALIAS} · ${NEW_SANDBOX_USERNAME} is authorized and listed in Target Org Manager.`]);
            expect(notificationTexts(vscode.window.showWarningMessage)).toEqual([]);
            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

        it('with Authorize with @salesforce/core: logs in inside VS Code, which opens the authorization address, and starts no sf process', async () => {

            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL, isChecked: false });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            const coreLoginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithCoreLibrary').mockImplementation(async (_loginUrl: string, loginRun: ICoreLibraryOrgLoginRun) => {
                await loginRun.openLoginPage(AUTHORIZATION_URL);
                authorizedAuthorizations.push(NEW_SANDBOX_AUTHORIZATION);
                return { kind: 'authorized', username: NEW_SANDBOX_USERNAME };
            });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(coreLoginSpy).toHaveBeenCalledWith(SANDBOX_LOGIN_ADDRESS, expect.anything());
            expect(loginSpy).not.toHaveBeenCalled();
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0]).toMatchObject({ parsedFrom: AUTHORIZATION_URL, isStrict: true });
            expect(execFile).not.toHaveBeenCalled();
            expect(aliasSpy).toHaveBeenCalledWith(CHOSEN_ALIAS, NEW_SANDBOX_USERNAME);
            expect(notificationTexts(vscode.window.showInformationMessage)).toEqual([`${CHOSEN_ALIAS} · ${NEW_SANDBOX_USERNAME} is authorized and listed in Target Org Manager.`]);

        });

        it('starts no login for a chosen label the confirmation did not offer', async () => {

            answerConfirmation({ chosenLabel: 'Authorize org', isChecked: true });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            const coreLoginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithCoreLibrary');
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(loginSpy).not.toHaveBeenCalled();
            expect(coreLoginSpy).not.toHaveBeenCalled();
            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

        it('with the box ticked: selects the org and sets target-org in this workspace\'s .sf/config.json', async () => {

            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(workspaceStateUpdate).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, NEW_SANDBOX_USERNAME);
            expect(JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))).toEqual({ 'target-org': CHOSEN_ALIAS });
            expect(lastOrgList().orgLabels[lastOrgList().selectedOrgIndex]).toContain(CHOSEN_ALIAS);
            expect(notificationTexts(vscode.window.showInformationMessage))
                .toEqual([`${CHOSEN_ALIAS} · ${NEW_SANDBOX_USERNAME} is authorized, selected in Target Org Manager, and this workspace's default org.`]);

        });

        it('with the box ticked and no alias: the default org is the username', async () => {

            answerInputBoxes(TYPED_SANDBOX_SUBDOMAIN, '');
            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(aliasSpy).not.toHaveBeenCalled();
            expect(JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))).toEqual({ 'target-org': NEW_SANDBOX_USERNAME });

        });

        it('never selects a production org, makes it the default, or puts the alias on it, even with the box ticked', async () => {

            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin({ kind: 'authorized', username: PRODUCTION_USERNAME }, PRODUCTION_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(aliasSpy).not.toHaveBeenCalled();
            expect(workspaceStateUpdate).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, PRODUCTION_USERNAME);
            expect(fs.existsSync(configFilePath())).toBe(false);
            expect(notificationTexts(vscode.window.showWarningMessage)).toEqual([
                `${PRODUCTION_USERNAME} is authorized, but it is not a sandbox or scratch org. Target Org Manager lists only those and the Salesforce CLI's default org. It was not selected or made this workspace's default org.`
                + ` The alias ${CHOSEN_ALIAS} was not set. If you still want it, set it with "sf alias set ${CHOSEN_ALIAS}=${PRODUCTION_USERNAME}".`
            ]);

        });

        it('makes the username the default org, and says how to set the alias, when the alias does not land', async () => {

            aliasSpy.mockResolvedValue('alias file is locked');
            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))).toEqual({ 'target-org': NEW_SANDBOX_USERNAME });
            expect(notificationTexts(vscode.window.showWarningMessage)[0]).toContain(`The alias ${CHOSEN_ALIAS} could not be set: alias file is locked.`);

        });

        it('says so when SF_TARGET_ORG still overrides the workspace default it wrote', async () => {

            const savedTargetOrgVariable = process.env.SF_TARGET_ORG;
            process.env.SF_TARGET_ORG = 'qa';

            try {
                answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
                answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'authorizeOrg' });

                expect(JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))).toEqual({ 'target-org': CHOSEN_ALIAS });
                expect(notificationTexts(vscode.window.showWarningMessage)[0]).toContain('An environment variable still makes qa the default org');
            } finally {
                if ( savedTargetOrgVariable === undefined ) { delete process.env.SF_TARGET_ORG; } else { process.env.SF_TARGET_ORG = savedTargetOrgVariable; }
            }

        });

        it('hands the progress notification\'s Cancel to the login, including one pressed before the login started listening', async () => {

            let cancelCount = 0;
            loginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithSalesforceCli').mockImplementation(async (_loginUrl: string, loginRun: IOrgLoginRun) => {
                loginRun.onCancellationRequested(() => { cancelCount++; });
                cancellationListeners.forEach(listener => listener());
                return { kind: 'cancelled' };
            });
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });
            expect(cancelCount).toBe(1);

            cancellationToken.isCancellationRequested = true;
            await receivedMessageHandler({ command: 'authorizeOrg' });
            expect(cancelCount).toBeGreaterThanOrEqual(3);

        });

        it('releases the lock when the login throws', async () => {

            loginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithSalesforceCli').mockRejectedValue(new Error('unexpected'));
            await openRenderedCockpit();

            await Promise.resolve(receivedMessageHandler({ command: 'authorizeOrg' })).catch(() => undefined);

            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });
            expect((RecipeCockpitService as any).isScratchOrgSetupInFlight).toBe(false);

        });

        it('keeps the login and the selection, and says why, when the workspace config cannot be written', async () => {

            fs.mkdirSync(path.join(workspaceRoot, '.sf'));
            fs.writeFileSync(configFilePath(), '[]');
            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin({ kind: 'authorized', username: NEW_SANDBOX_USERNAME }, NEW_SANDBOX_AUTHORIZATION);
            await openRenderedCockpit();

            await receivedMessageHandler({ command: 'authorizeOrg' });

            expect(workspaceStateUpdate).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, NEW_SANDBOX_USERNAME);
            expect(fs.readFileSync(configFilePath(), 'utf8')).toBe('[]');
            const [warningText] = notificationTexts(vscode.window.showWarningMessage);
            expect(warningText).toStartWith(`${CHOSEN_ALIAS} · ${NEW_SANDBOX_USERNAME} is authorized and selected in Target Org Manager, but it was not made this workspace's default org:`);

        });

        it.each([
            [{ kind: 'cancelled' as const }, 'showInformationMessage' as const, 'Authorize org was cancelled.'],
            [{ kind: 'timedOut' as const }, 'showWarningMessage' as const, 'Authorize org stopped waiting'],
            [{ kind: 'portInUse' as const }, 'showWarningMessage' as const, 'Authorize org could not start'],
            [{ kind: 'failed' as const, failureMessage: '[x](command:evil)' }, 'showErrorMessage' as const, 'Authorize org did not finish. The login reported:']
        ])('ends %j in one notification, lists nothing again, and releases the lock', async (loginOutcome, notificationName, expectedStart) => {

            answerConfirmation({ chosenLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL, isChecked: true });
            answerLogin(loginOutcome);
            await openRenderedCockpit();
            const orgListCountBefore = postedNamed('dataOrgList').length;

            await receivedMessageHandler({ command: 'authorizeOrg' });

            const shownTexts = [vscode.window.showInformationMessage, vscode.window.showWarningMessage, vscode.window.showErrorMessage].flatMap(notificationTexts);
            expect(shownTexts).toHaveLength(1);
            expect(notificationTexts(vscode.window[notificationName])[0]).toStartWith(expectedStart);
            expect(shownTexts[0]).not.toContain('[x](command:evil)');
            expect(postedNamed('dataOrgList')).toHaveLength(orgListCountBefore);
            expect(fs.existsSync(configFilePath())).toBe(false);
            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

        it('starts no second login while one is in flight, and tells the panel which run holds the picker', async () => {

            let finishLogin: (loginOutcome: OrgLoginOutcome) => void = () => undefined;
            loginSpy = jest.spyOn(SalesforceOrgLogin, 'authorizeWithSalesforceCli').mockImplementation(() => new Promise(resolve => { finishLogin = resolve; }));
            await openRenderedCockpit();

            const firstRun = receivedMessageHandler({ command: 'authorizeOrg' });
            await new Promise(resolve => setImmediate(resolve));
            await receivedMessageHandler({ command: 'authorizeOrg' });
            await receivedMessageHandler({ command: 'createScratchOrg' });

            expect(loginSpy).toHaveBeenCalledTimes(1);
            expect(execFile).not.toHaveBeenCalled();

            finishLogin({ kind: 'cancelled' });
            await firstRun;

            expect(postedNamed('scratchOrgState').at(-1)).toEqual({ command: 'scratchOrgState', isRunning: false });

        });

    });

});
