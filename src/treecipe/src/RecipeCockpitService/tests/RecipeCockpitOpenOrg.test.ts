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
        showInputBox: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string, isStrict?: boolean) => ({ parsedFrom: uriValue, isStrict: isStrict, toString: () => uriValue }) }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { execFile } from 'child_process';
import { Org } from '@salesforce/core';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_OPEN_ORG_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { ORG_FRONT_DOOR_FAILURE_TEXTS, ORG_FRONT_DOOR_SINGLE_ACCESS_PATH, SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

const QA_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const UAT_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

const SESSION_ID = '00D000000000001!AQEAQsessionSecret';
const ONE_TIME_CODE = 'oneTimeCodeSecret';
const INSTANCE_URL = 'https://acme--qa.sandbox.my.salesforce.com';
const ORG_OPEN_URL = `${INSTANCE_URL}/secur/frontdoor.jsp?otp=${ONE_TIME_CODE}&cshc=x`;

const IDLE_STATE = { command: 'orgOpenState', isRunning: false };

describe('RecipeCockpitService, "Open in browser" beside the selected org (#279, #501)', () => {

    describe('routePanelMessage', () => {

        const buildSelectedPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.dataOrgObjectApiNames = new Set(['Lead']);
            panelState.dataOrgDetails = [QA_ORG, UAT_ORG];
            panelState.dataOrgSelection = { orgIndex: 1, orgDetail: UAT_ORG, requestSequence: 7 };
            return panelState;
        };

        it('opens the org SELECTED now, by the username the host holds, whatever else the message carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, buildSelectedPanelState()))
                .toEqual({ kind: 'openDataOrg', orgDetail: UAT_ORG });
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1, filePath: 'https://evil.example.com', treeKey: 'x' } as any, buildSelectedPanelState()))
                .toEqual({ kind: 'openDataOrg', orgDetail: UAT_ORG });

        });

        it('refuses another listed org, a stale index and anything that is not an index, answering so the button comes back', () => {

            const refusal = { kind: 'postOrgOpenState', hostMessage: IDLE_STATE };

            [0, 2, -1, 1.5, '1', null, undefined, Number.NaN, { orgIndex: 1 }].forEach(orgIndex => {
                expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex } as any, buildSelectedPanelState())).toEqual(refusal);
            });

        });

        it('refuses when nothing is selected, when the model is not drawn, or when the list no longer names the selection', () => {

            const refusal = { kind: 'postOrgOpenState', hostMessage: IDLE_STATE };

            const unselectedState = buildSelectedPanelState();
            unselectedState.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, unselectedState)).toEqual(refusal);

            const undrawnState = buildSelectedPanelState();
            undrawnState.dataOrgObjectApiNames = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, undrawnState)).toEqual(refusal);

            const relistedState = buildSelectedPanelState();
            relistedState.dataOrgDetails = [QA_ORG, QA_ORG];
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, relistedState)).toEqual(refusal);

        });

        it('refuses while a scratch org run or a permission set assignment holds the selection', () => {

            const refusal = { kind: 'postOrgOpenState', hostMessage: IDLE_STATE };

            const scratchRunState = buildSelectedPanelState();
            scratchRunState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, scratchRunState)).toEqual(refusal);

            const deployState = buildSelectedPanelState();
            deployState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: 'x' };
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, deployState)).toEqual(refusal);

        });

        it('starts nothing for a second click while one open is in flight, and says the open is running', () => {

            const panelState = buildSelectedPanelState();
            panelState.isOrgOpenInFlight = true;

            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, panelState))
                .toEqual({ kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: true } });

        });

        it('replays a running open to a reloaded document, and nothing when none is running', () => {

            const panelState = buildSelectedPanelState();

            expect((RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState) as any).hostMessages).not.toContainEqual(expect.objectContaining({ command: 'orgOpenState' }));

            panelState.isOrgOpenInFlight = true;
            expect((RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState) as any).hostMessages).toContainEqual({ command: 'orgOpenState', isRunning: true });

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let warningSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;

        const openSelectedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            panelState().dataOrgDetails = [QA_ORG, UAT_ORG];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: QA_ORG, requestSequence: 2 };
        };

        let requestGetMock: jest.Mock;

        // THE ORG'S OWN CONNECTION ANSWERS THE SINGLE-ACCESS REQUEST; ITS ACCESS TOKEN MUST REACH NOTHING
        const answerOrgOpen = (singleAccessAnswer: () => Promise<unknown>) => {
            requestGetMock = jest.fn().mockImplementation(singleAccessAnswer);
            (Org.create as jest.Mock).mockResolvedValue({
                refreshAuth: jest.fn().mockResolvedValue(undefined),
                getConnection: () => ({ instanceUrl: INSTANCE_URL, accessToken: SESSION_ID, requestGet: requestGetMock })
            });
        };

        const everythingWritten = (): string => {
            const collectFiles = (directoryPath: string): string[] => fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => (
                directoryEntry.isDirectory()
                    ? collectFiles(path.join(directoryPath, directoryEntry.name))
                    : [path.join(directoryPath, directoryEntry.name)]
            ));
            return collectFiles(temporaryRoot).map(filePath => fs.readFileSync(filePath, 'utf-8')).join('\n');
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-open-org-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            postedPanelMessages = [];

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (execFile as unknown as jest.Mock).mockReset();
            (Org.create as jest.Mock).mockReset();
            (vscode.env.openExternal as jest.Mock).mockReset();
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
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
            warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('asks the selected USERNAME\'s org for a one-time address, runs no CLI, and hands the https: URL to the browser, and to nothing else', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: ORG_OPEN_URL }));
            await openSelectedCockpit();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(execFile).not.toHaveBeenCalled();
            expect(Org.create).toHaveBeenCalledWith({ aliasOrUsername: QA_ORG.username });
            expect(requestGetMock).toHaveBeenCalledWith(`${INSTANCE_URL}${ORG_FRONT_DOOR_SINGLE_ACCESS_PATH}`);
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0]).toMatchObject({ parsedFrom: ORG_OPEN_URL, isStrict: true });

            expect(postedPanelMessages.slice(postedBefore)).toEqual([IDLE_STATE]);
            expect(JSON.stringify(postedPanelMessages)).not.toContain(SESSION_ID);
            expect(JSON.stringify(postedPanelMessages)).not.toContain(ONE_TIME_CODE);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(warningSpy).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            expect(everythingWritten()).not.toContain('sessionSecret');
            expect(everythingWritten()).not.toContain(ONE_TIME_CODE);
            expect(panelState().isOrgOpenInFlight).toBe(false);

        });

        it('opens nothing for a refused message, and answers so the button comes back', async () => {

            await openSelectedCockpit();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 1 });

            expect(Org.create).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(postedPanelMessages.slice(postedBefore)).toEqual([IDLE_STATE]);

        });

        it('answers a refused request with ONE fixed-text notification naming the org, quoting neither the error nor a token, and opens nothing', async () => {

            answerOrgOpen(async () => { throw new Error(`403 [qa](command:workbench.action.terminal.new) ${INSTANCE_URL}/secur/frontdoor.jsp?sid=${SESSION_ID}`); });
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                `qa · qa@example.com.qa was not opened: ${ORG_FRONT_DOOR_FAILURE_TEXTS.requestFailed}`
            ));
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain(SESSION_ID);
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain('command:');
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);

        });

        it('answers an org whose authorization cannot be used with its fixed text', async () => {

            (Org.create as jest.Mock).mockRejectedValue(new Error(`NoAuthInfoFound ${SESSION_ID}`));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                `qa · qa@example.com.qa was not opened: ${ORG_FRONT_DOOR_FAILURE_TEXTS.connectionFailed}`
            ));
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();

        });

        it('never opens an address that is not https:', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: 'command:workbench.action.terminal.new' }));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                `qa · qa@example.com.qa was not opened: ${ORG_FRONT_DOOR_FAILURE_TEXTS.notHttps}`
            ));

        });

        it('names an org with no alias by its username, and a notification that fails to show changes nothing', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: 'http://acme.my.salesforce.com/' }));
            (vscode.window.showErrorMessage as jest.Mock).mockRejectedValue(new Error('notification failed'));
            await openSelectedCockpit();
            const unaliasedOrg = { targetOrgIdentifier: 'plain@example.com', username: 'plain@example.com' };
            panelState().dataOrgDetails = [unaliasedOrg];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: unaliasedOrg, requestSequence: 3 };

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });
            await new Promise(resolve => setImmediate(resolve));

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toStartWith(RecipeYamlScalar.escapeForNotification('plain@example.com was not opened:'));
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);

        });

        it('warns, without quoting the address, when the browser does not accept it', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: ORG_OPEN_URL }));
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(false);
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(warningSpy).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification('qa · qa@example.com.qa was not opened: the browser did not accept the address.'));
            expect(JSON.stringify(warningSpy.mock.calls)).not.toContain(ONE_TIME_CODE);

        });

        it('answers a throw with a fixed message that quotes nothing, and never leaves the button disabled', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: ORG_OPEN_URL }));
            (vscode.env.openExternal as jest.Mock).mockRejectedValue(new Error(`could not open ${ORG_OPEN_URL}`));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification('qa · qa@example.com.qa was not opened: the browser could not be started.'));
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain(ONE_TIME_CODE);
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);
            expect(panelState().isOrgOpenInFlight).toBe(false);
            expect((RecipeCockpitService as any).isOrgOpenInFlightForWindow).toBe(false);

        });

        it('holds one open per window: a panel reopened mid-open is told it is running, refuses a second, and gets the closing state', async () => {

            let finishOrgOpen: () => void = () => undefined;
            jest.spyOn(SalesforceOrgService, 'requestOrgFrontDoorUrl').mockImplementation(() => new Promise(resolve => {
                finishOrgOpen = () => resolve({ isOpenable: true, url: ORG_OPEN_URL });
            }));
            await openSelectedCockpit();

            const firstOpen = receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });
            await new Promise(resolve => setImmediate(resolve));

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            postedPanelMessages = [];
            await openSelectedCockpit();

            expect(panelState().isOrgOpenInFlight).toBe(true);
            expect(postedPanelMessages).toContainEqual({ command: 'orgOpenState', isRunning: true });

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });
            expect(SalesforceOrgService.requestOrgFrontDoorUrl).toHaveBeenCalledTimes(1);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'orgOpenState', isRunning: true });

            finishOrgOpen();
            await firstOpen;

            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);
            expect(panelState().isOrgOpenInFlight).toBe(false);

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
            panel.expandAllTrees();
            panel.postToPanel({ command: 'rendered' });
            return panel;
        };

        const openButtons = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitBodyElement, 'dataOrgOpen');

        const listOrgs = (panel: ReturnType<typeof runPanelScript>, selectedOrgIndex: number | null) => {
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa', 'uat'], selectedOrgIndex, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
        };

        const selectOrg = (panel: ReturnType<typeof runPanelScript>, orgIndex: number) => {
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex, orgLabel: ['qa', 'uat'][orgIndex], orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });
        };

        it('draws the button beside the selected org, in every Treecipe tab, only once an org is selected', () => {

            const panel = renderPanel();

            expect(openButtons(panel).length).toBeGreaterThan(0);
            openButtons(panel).forEach(openButton => expect(openButton.classList.contains('hidden')).toBe(true));

            listOrgs(panel, null);
            openButtons(panel).forEach(openButton => expect(openButton.classList.contains('hidden')).toBe(true));

            selectOrg(panel, 1);
            openButtons(panel).forEach(openButton => {
                expect(openButton.classList.contains('hidden')).toBe(false);
                expect(openButton.textContent).toBe(RECIPE_COCKPIT_OPEN_ORG_LABEL);
                expect(openButton.disabled).toBe(false);
                const pickerElement = openButton.parentNode;
                expect(pickerElement.children.indexOf(openButton)).toBeGreaterThan(pickerElement.children.indexOf(panel.findAll(pickerElement, 'dataOrgSelect')[0]));
                expect(pickerElement.children.indexOf(openButton)).toBeLessThan(pickerElement.children.indexOf(panel.findAll(pickerElement, 'dataOrgNewScratch')[0]));
            });

        });

        it('posts the selected index alone, holds every button while it opens, and lets the host\'s answer bring them back', () => {

            const panel = renderPanel();
            listOrgs(panel, null);
            selectOrg(panel, 1);

            openButtons(panel)[0].dispatch('click');

            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'openDataOrg')).toEqual([{ command: 'openDataOrg', orgIndex: 1 }]);
            openButtons(panel).forEach(openButton => {
                expect(openButton.disabled).toBe(true);
                expect(openButton.textContent).toBe('Opening…');
            });

            openButtons(panel)[0].dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'openDataOrg')).toHaveLength(1);

            panel.postToPanel(IDLE_STATE);
            openButtons(panel).forEach(openButton => {
                expect(openButton.disabled).toBe(false);
                expect(openButton.textContent).toBe(RECIPE_COCKPIT_OPEN_ORG_LABEL);
            });

        });

        it('is disabled while a scratch org run or a metadata deploy holds the picker', () => {

            const panel = renderPanel();
            listOrgs(panel, null);
            selectOrg(panel, 0);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true });
            openButtons(panel).forEach(openButton => expect(openButton.disabled).toBe(true));
            openButtons(panel)[0].dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'openDataOrg')).toEqual([]);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: false });
            openButtons(panel).forEach(openButton => expect(openButton.disabled).toBe(false));

        });

    });

});
