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
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_OPEN_ORG_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

const QA_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const UAT_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

const SESSION_ID = '00D000000000001!AQEAQsessionSecret';
const ORG_OPEN_URL = `https://acme--qa.sandbox.my.salesforce.com/secur/frontdoor.jsp?sid=${SESSION_ID}`;

const IDLE_STATE = { command: 'orgOpenState', isRunning: false };

describe('RecipeCockpitService, "Open in browser" beside the selected org (#279)', () => {

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

        it('refuses while a scratch org run or a metadata deploy holds the selection', () => {

            const refusal = { kind: 'postOrgOpenState', hostMessage: IDLE_STATE };

            const scratchRunState = buildSelectedPanelState();
            scratchRunState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true, statusText: '', isFailure: false, hasOutput: false };
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 1 }, scratchRunState)).toEqual(refusal);

            const deployState = buildSelectedPanelState();
            deployState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: 'x', statusText: '', isFailure: false, hasOutput: false };
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

        const answerOrgOpen = (stdout: string, extra: { error?: unknown; stderr?: string } = {}) => {
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, _argumentList: string[], _options: unknown, callback: any) => {
                setImmediate(() => callback(extra.error ?? null, stdout, extra.stderr ?? ''));
                return { kill: jest.fn() };
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

        it('runs "sf org open --url-only --json" for the selected USERNAME and hands the https: URL to the browser, and to nothing else', async () => {

            answerOrgOpen(JSON.stringify({ status: 0, result: { orgId: '00D000000000001', url: ORG_OPEN_URL, username: QA_ORG.username } }));
            await openSelectedCockpit();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect((execFile as unknown as jest.Mock).mock.calls).toHaveLength(1);
            const [, argumentList, execOptions] = (execFile as unknown as jest.Mock).mock.calls[0];
            expect(argumentList).toEqual(['org', 'open', '--target-org', QA_ORG.username, '--url-only', '--json']);
            expect(execOptions.cwd).toBeUndefined();
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0]).toMatchObject({ parsedFrom: ORG_OPEN_URL, isStrict: true });

            expect(postedPanelMessages.slice(postedBefore)).toEqual([IDLE_STATE]);
            expect(JSON.stringify(postedPanelMessages)).not.toContain(SESSION_ID);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(warningSpy).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            expect(everythingWritten()).not.toContain('sessionSecret');
            expect(panelState().isOrgOpenInFlight).toBe(false);

        });

        it('opens nothing for a refused message, and answers so the button comes back', async () => {

            await openSelectedCockpit();
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 1 });

            expect(execFile).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(postedPanelMessages.slice(postedBefore)).toEqual([IDLE_STATE]);

        });

        it('shows the CLI\'s failure, escaped and naming the org, without ever opening a browser', async () => {

            answerOrgOpen(JSON.stringify({ status: 1, name: 'NoAuthInfoFound', message: 'No authorization for [qa](command:workbench.action.terminal.new).' }), { error: Object.assign(new Error('Command failed'), { code: 1 }) });
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                'qa · qa@example.com.qa was not opened: NoAuthInfoFound: No authorization for [qa](command:workbench.action.terminal.new).'
            ));
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).not.toContain('](command:');
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);

        });

        it('never opens an address that is not https:', async () => {

            answerOrgOpen(JSON.stringify({ status: 0, result: { url: 'command:workbench.action.terminal.new' } }));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                'qa · qa@example.com.qa was not opened: The Salesforce CLI answered with an address that is not https, so it was not opened.'
            ));

        });

        it('names an org with no alias by its username, and a notification that fails to show changes nothing', async () => {

            answerOrgOpen(JSON.stringify({ status: 0, result: { url: 'http://acme.my.salesforce.com/' } }));
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

        it('says the CLI is required when it is not installed', async () => {

            jest.spyOn(ScratchOrgService, 'resolveOrgOpenUrl').mockResolvedValue(ScratchOrgService.parseOrgOpenOutput({
                stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' })
            }));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('is required to open an org');
            expect(vscode.env.openExternal).not.toHaveBeenCalled();

        });

        it('warns, without quoting the address, when the browser does not accept it', async () => {

            answerOrgOpen(JSON.stringify({ status: 0, result: { url: ORG_OPEN_URL } }));
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(false);
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(warningSpy).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification('qa · qa@example.com.qa was not opened: the browser did not accept the address.'));
            expect(JSON.stringify(warningSpy.mock.calls)).not.toContain(SESSION_ID);

        });

        it('answers a throw with a fixed message that quotes nothing, and never leaves the button disabled', async () => {

            answerOrgOpen(JSON.stringify({ status: 0, result: { url: ORG_OPEN_URL } }));
            (vscode.env.openExternal as jest.Mock).mockRejectedValue(new Error(`could not open ${ORG_OPEN_URL}`));
            await openSelectedCockpit();

            await receivedMessageHandler({ command: 'openDataOrg', orgIndex: 0 });

            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification('qa · qa@example.com.qa was not opened: the browser could not be started.'));
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain(SESSION_ID);
            expect(postedPanelMessages.at(-1)).toEqual(IDLE_STATE);
            expect(panelState().isOrgOpenInFlight).toBe(false);
            expect((RecipeCockpitService as any).isOrgOpenInFlightForWindow).toBe(false);

        });

        it('holds one open per window: a panel reopened mid-open is told it is running, refuses a second, and gets the closing state', async () => {

            let finishOrgOpen: () => void = () => undefined;
            jest.spyOn(ScratchOrgService, 'resolveOrgOpenUrl').mockImplementation(() => new Promise(resolve => {
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
            expect(ScratchOrgService.resolveOrgOpenUrl).toHaveBeenCalledTimes(1);
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

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false });
            openButtons(panel).forEach(openButton => expect(openButton.disabled).toBe(true));
            openButtons(panel)[0].dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'openDataOrg')).toEqual([]);

            panel.postToPanel({ command: 'scratchOrgState', isRunning: false, statusText: '', isFailure: false, hasOutput: false });
            openButtons(panel).forEach(openButton => expect(openButton.disabled).toBe(false));

        });

    });

});
