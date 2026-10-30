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
    RecipeCockpitRecordLinkPreviewKind,
    RecipeCockpitService,
    RECIPE_COCKPIT_QUERY_TAB_LABEL,
    RECIPE_COCKPIT_RECORD_LINK_BUSY_REFUSAL,
    RECIPE_COCKPIT_RECORD_LINK_OPEN_RUNNING_REFUSAL,
    RECIPE_COCKPIT_RECORD_LINK_ORG_GONE_REFUSAL,
    RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL,
    RECIPE_COCKPIT_RECORD_LINK_TITLE,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import {
    ORG_FRONT_DOOR_FAILURE_TEXTS,
    ORG_FRONT_DOOR_RETURN_PARAMETER,
    ORG_FRONT_DOOR_SINGLE_ACCESS_PATH
} from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const QA_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const UAT_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

const ACCOUNT_ID = '001DK000017d3k5YAA';
const CONTACT_ID = '003DK000017d3k5YAA';

const SESSION_ID = '00D000000000001!AQEAQsessionSecret';
const ONE_TIME_CODE = 'oneTimeCodeSecret';
const INSTANCE_URL = 'https://acme--qa.sandbox.my.salesforce.com';
const FRONT_DOOR_URI = `${INSTANCE_URL}/secur/frontdoor.jsp?otp=${ONE_TIME_CODE}&cshc=x`;

const previewDetail = (previewKind: RecipeCockpitRecordLinkPreviewKind, heldSource: object, renderSequence: number, recordIdsByObjectApiName: Map<string, (string | undefined)[]>, orgUsername = QA_ORG.username) => ({
    previewKind: previewKind,
    renderSequence: renderSequence,
    treeKey: ACCOUNT_TREE_KEY,
    orgUsername: orgUsername,
    heldSource: heldSource,
    recordIdsByObjectApiName: recordIdsByObjectApiName
});

describe('RecipeCockpitService, a record Id opened from a preview (#556)', () => {

    describe('routePanelMessage', () => {

        const heldSource = {};

        const buildPanelState = (): { panelState: IRecipeCockpitPanelState; recordLinkSequence: number } => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.dataOrgDetails = [QA_ORG, UAT_ORG];
            const recordLinkSequence = RecipeCockpitService.registerRecordLinkPreview(panelState,
                previewDetail('updaterRecords', heldSource, 3, new Map([['Account', [ACCOUNT_ID, undefined]], ['Contact', [CONTACT_ID]]])))!;
            return { panelState, recordLinkSequence };
        };

        const drawn = () => {
            const built = buildPanelState();
            const activation = RecipeCockpitService.routePanelMessage({ command: 'recordLinksRendered', renderSequence: 3, recordLinkSequence: built.recordLinkSequence }, built.panelState);
            expect(activation).toEqual({ kind: 'activateRecordLinks', recordLinkSequence: built.recordLinkSequence });
            built.panelState.openableRecordPreviews.set(built.recordLinkSequence, built.panelState.pendingOpenableRecordPreviews.get(built.recordLinkSequence)!);
            return built;
        };

        it('opens the Id the HOST keeps for the row, in the org it was read from, whatever else the message carries', () => {

            const { panelState, recordLinkSequence } = drawn();

            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Contact', rowIndex: 0 }, panelState))
                .toEqual({ kind: 'openPreviewRecord', preview: expect.objectContaining({ previewKind: 'updaterRecords', recordLinkSequence }), recordId: CONTACT_ID, orgDetail: QA_ORG });
            expect(RecipeCockpitService.routePanelMessage({
                command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex: 0,
                recordId: '001000000000000AAA', filePath: 'https://evil.example.com', orgIndex: 1
            } as any, panelState)).toMatchObject({ kind: 'openPreviewRecord', recordId: ACCOUNT_ID, orgDetail: QA_ORG });

        });

        it('opens nothing from a preview the panel has not said it drew, nor before the model is acknowledged', () => {

            const { panelState, recordLinkSequence } = buildPanelState();
            const click = { command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex: 0 };

            expect(RecipeCockpitService.routePanelMessage(click, panelState)).toEqual({ kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL });

            panelState.acknowledgedRenderSequence = null;
            expect(RecipeCockpitService.routePanelMessage({ command: 'recordLinksRendered', renderSequence: 3, recordLinkSequence }, panelState)).toBeUndefined();

        });

        it('promotes only the sequence posted, over the model on screen', () => {

            const { panelState, recordLinkSequence } = buildPanelState();

            [
                { renderSequence: 3, recordLinkSequence: recordLinkSequence + 1 },
                { renderSequence: 2, recordLinkSequence },
                { renderSequence: 3, recordLinkSequence: String(recordLinkSequence) },
                { renderSequence: 3 }
            ].forEach(ackFields => {
                expect(RecipeCockpitService.routePanelMessage({ command: 'recordLinksRendered', ...ackFields } as any, panelState)).toBeUndefined();
            });

        });

        it('drops a forged row, object or sequence without a word, so no org is contacted', () => {

            const { panelState, recordLinkSequence } = drawn();

            [-1, 2, 1.5, '0', null, undefined, Number.NaN].forEach(rowIndex => {
                expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex } as any, panelState)).toBeUndefined();
            });
            // A ROW WHOSE CELL HELD NO Id, AN OBJECT THE PREVIEW DOES NOT LIST, AND AN OBJECT NAME THAT IS NOT TEXT
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex: 1 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Lead', rowIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 7, rowIndex: 0 } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, rowIndex: 0 }, panelState)).toBeUndefined();
            [undefined, '1', 1.5].forEach(forgedSequence => {
                expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence: forgedSequence, objectApiName: 'Account', rowIndex: 0 } as any, panelState)).toBeUndefined();
            });

        });

        it('refuses a preview for another model, and one a newer preview of its kind replaced, with the fixed stale text', () => {

            const { panelState, recordLinkSequence } = drawn();
            const stale = { kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL };

            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 2, recordLinkSequence, objectApiName: 'Account', rowIndex: 0 }, panelState)).toEqual(stale);

            RecipeCockpitService.registerRecordLinkPreview(panelState, previewDetail('updaterRecords', {}, 3, new Map([['Account', [ACCOUNT_ID]]])));
            expect(panelState.openableRecordPreviews.has(recordLinkSequence)).toBe(false);
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex: 0 }, panelState)).toEqual(stale);

        });

        it('keeps one preview per kind, and registers nothing for a preview with no linked row', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');

            const querySequence = RecipeCockpitService.registerRecordLinkPreview(panelState, previewDetail('query', {}, 1, new Map([['', [ACCOUNT_ID]]])));
            const valuesSequence = RecipeCockpitService.registerRecordLinkPreview(panelState, previewDetail('updaterValues', {}, 1, new Map([['Account', [ACCOUNT_ID]]])));
            expect([...panelState.pendingOpenableRecordPreviews.keys()]).toEqual([querySequence, valuesSequence]);

            expect(RecipeCockpitService.registerRecordLinkPreview(panelState, previewDetail('query', {}, 1, new Map([['', [undefined]]])))).toBeUndefined();
            expect([...panelState.pendingOpenableRecordPreviews.keys()]).toEqual([valuesSequence]);

        });

        it('refuses while a run holds the org selection, while an open is running, and for an org gone from the list', () => {

            const busyStates: ((panelState: IRecipeCockpitPanelState) => void)[] = [
                panelState => { panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true }; },
                panelState => { panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: 'x' }; },
                panelState => { panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: 'x', deployKind: 'fields' } as any; },
                panelState => { panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'x', runKind: 'update' }; },
                panelState => { panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'x', runKind: 'restore' }; }
            ];

            busyStates.forEach(makeBusy => {
                const { panelState, recordLinkSequence } = drawn();
                makeBusy(panelState);
                expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence, objectApiName: 'Account', rowIndex: 0 }, panelState))
                    .toEqual({ kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_BUSY_REFUSAL });
            });

            const openingState = drawn();
            openingState.panelState.isOrgOpenInFlight = true;
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence: openingState.recordLinkSequence, objectApiName: 'Account', rowIndex: 0 }, openingState.panelState))
                .toEqual({ kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_OPEN_RUNNING_REFUSAL });

            const relistedState = drawn();
            relistedState.panelState.dataOrgDetails = [UAT_ORG];
            expect(RecipeCockpitService.routePanelMessage({ command: 'openPreviewRecord', renderSequence: 3, recordLinkSequence: relistedState.recordLinkSequence, objectApiName: 'Account', rowIndex: 0 }, relistedState.panelState))
                .toEqual({ kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_ORG_GONE_REFUSAL });

        });

        it('words every refusal with no parenthesis, URL or bracket a notification would mangle', () => {

            [RECIPE_COCKPIT_RECORD_LINK_BUSY_REFUSAL, RECIPE_COCKPIT_RECORD_LINK_OPEN_RUNNING_REFUSAL, RECIPE_COCKPIT_RECORD_LINK_ORG_GONE_REFUSAL, RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL].forEach(refusalText => {
                expect(refusalText).not.toMatch(/https?:|[()[\]]/);
            });

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let warningSpy: jest.SpyInstance;
        let requestGetMock: jest.Mock;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;

        const answerOrgOpen = (singleAccessAnswer: () => Promise<unknown>) => {
            requestGetMock = jest.fn().mockImplementation(singleAccessAnswer);
            (Org.create as jest.Mock).mockResolvedValue({
                refreshAuth: jest.fn().mockResolvedValue(undefined),
                getConnection: () => ({ instanceUrl: INSTANCE_URL, accessToken: SESSION_ID, requestGet: requestGetMock })
            });
        };

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            panelState().dataOrgDetails = [QA_ORG, UAT_ORG];
        };

        // A PREVIEW THE HOST POSTED AND THE PANEL SAID IT DREW, OVER HELD DATA OF ITS KIND
        const drawPreview = async (previewKind: RecipeCockpitRecordLinkPreviewKind, recordIdsByObjectApiName: Map<string, (string | undefined)[]>) => {
            const heldSource = { records: [] };
            const heldField = { query: 'heldTreeQueryResult', updaterRecords: 'heldUpdaterRecords', updaterValues: 'heldUpdaterValues' }[previewKind];
            (RecipeCockpitService as any)[heldField] = heldSource;
            const recordLinkSequence = RecipeCockpitService.registerRecordLinkPreview(panelState(), previewDetail(previewKind, heldSource, lastRenderSequence(), recordIdsByObjectApiName))!;
            await receivedMessageHandler({ command: 'recordLinksRendered', renderSequence: lastRenderSequence(), recordLinkSequence });
            return recordLinkSequence;
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

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-record-links-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            postedPanelMessages = [];

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (RecipeCockpitService as any).isOrgOpenInFlightForWindow = false;
            (execFile as unknown as jest.Mock).mockReset();
            (Org.create as jest.Mock).mockReset();
            (vscode.env.openExternal as jest.Mock).mockReset();
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
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
            warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

        });

        afterEach(() => {
            RecipeCockpitService.clearHeldTreeQueryResult();
            RecipeCockpitService.clearHeldUpdaterRecords();
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it.each([
            ['query', '', ACCOUNT_ID],
            ['updaterRecords', 'Contact', CONTACT_ID],
            ['updaterValues', 'Account', ACCOUNT_ID]
        ] as const)('opens a %s row\'s record through a one-time address with retURL, runs no CLI, and hands it to the browser alone', async (previewKind, objectApiName, recordId) => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const recordLinkSequence = await drawPreview(previewKind, new Map([[objectApiName, [recordId]]]));
            const postedBefore = postedPanelMessages.length;

            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence, rowIndex: 0, ...( objectApiName ? { objectApiName } : {} ) });

            expect(execFile).not.toHaveBeenCalled();
            expect(Org.create).toHaveBeenCalledWith({ aliasOrUsername: QA_ORG.username });
            expect(requestGetMock).toHaveBeenCalledWith(`${INSTANCE_URL}${ORG_FRONT_DOOR_SINGLE_ACCESS_PATH}`);
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            const openedUrl = new URL((vscode.env.openExternal as jest.Mock).mock.calls[0][0].parsedFrom);
            expect(openedUrl.origin + openedUrl.pathname).toBe(`${INSTANCE_URL}/secur/frontdoor.jsp`);
            expect(openedUrl.searchParams.get(ORG_FRONT_DOOR_RETURN_PARAMETER)).toBe(`/${recordId}`);
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0].isStrict).toBe(true);

            expect(postedPanelMessages.slice(postedBefore)).toEqual([{ command: 'orgOpenState', isRunning: false }]);
            const everythingShown = JSON.stringify([postedPanelMessages, warningSpy.mock.calls, (vscode.window.showErrorMessage as jest.Mock).mock.calls, (vscode.window.showInformationMessage as jest.Mock).mock.calls]);
            [SESSION_ID, ONE_TIME_CODE, 'frontdoor.jsp', 'sid='].forEach(secret => expect(everythingShown).not.toContain(secret));
            [SESSION_ID, ONE_TIME_CODE].forEach(secret => expect(everythingWritten()).not.toContain(secret));
            expect(panelState().isOrgOpenInFlight).toBe(false);

        });

        it('refuses a click after a newer query run replaced the preview, and opens no record of the earlier run', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const earlierSequence = await drawPreview('query', new Map([['', [ACCOUNT_ID]]]));
            await drawPreview('query', new Map([['', [CONTACT_ID]]]));

            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence: earlierSequence, rowIndex: 0 });

            expect(Org.create).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(warningSpy).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL));

        });

        it('refuses a click once the held data is let go: records an update spent, a result a new run cleared', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const recordsSequence = await drawPreview('updaterRecords', new Map([['Account', [ACCOUNT_ID]]]));
            const valuesSequence = await drawPreview('updaterValues', new Map([['Account', [ACCOUNT_ID]]]));
            const querySequence = await drawPreview('query', new Map([['', [ACCOUNT_ID]]]));

            // AN UPDATE THAT SENT A REQUEST LETS THE RECORDS AND THEIR VALUES GO (isRecordsSpent), AND A RUN LETS THE LAST RESULT GO
            RecipeCockpitService.clearHeldUpdaterRecords();
            RecipeCockpitService.clearHeldTreeQueryResult();

            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence: recordsSequence, objectApiName: 'Account', rowIndex: 0 });
            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence: valuesSequence, objectApiName: 'Account', rowIndex: 0 });
            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence: querySequence, rowIndex: 0 });

            expect(Org.create).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(warningSpy.mock.calls).toEqual(Array(3).fill([RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL)]));

        });

        it('refuses held data REPLACED by data of the same kind, even before a new preview is registered', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const valuesSequence = await drawPreview('updaterValues', new Map([['Account', [ACCOUNT_ID]]]));
            (RecipeCockpitService as any).heldUpdaterValues = { records: [] };

            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence: valuesSequence, objectApiName: 'Account', rowIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(warningSpy).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL));

        });

        it('keeps only a token for the held data, so a preview never holds a released result, load or set of values in memory', async () => {

            await openCockpit();
            const heldRecords = { records: [{ Id: ACCOUNT_ID }] };
            (RecipeCockpitService as any).heldUpdaterRecords = heldRecords;
            const recordLinkSequence = RecipeCockpitService.registerRecordLinkPreview(panelState(), previewDetail('updaterRecords', heldRecords, lastRenderSequence(), new Map([['Account', [ACCOUNT_ID]]])))!;

            const storedPreview = panelState().pendingOpenableRecordPreviews.get(recordLinkSequence)!;
            expect(Object.values(storedPreview)).not.toContain(heldRecords);
            expect(storedPreview).not.toHaveProperty('heldSource');
            expect(storedPreview.heldSourceToken).toEqual(expect.any(Number));

        });

        it('contacts no org for a forged row index', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const recordLinkSequence = await drawPreview('query', new Map([['', [ACCOUNT_ID]]]));

            for (const rowIndex of [-1, 1, 0.5, '0', 99]) {
                await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence, rowIndex });
            }

            expect(Org.create).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(warningSpy).not.toHaveBeenCalled();

        });

        it('lets every preview\'s links go with a reload of the document and with a new model, until the panel draws them again', async () => {

            answerOrgOpen(async () => ({ frontdoor_uri: FRONT_DOOR_URI }));
            await openCockpit();
            const recordLinkSequence = await drawPreview('query', new Map([['', [ACCOUNT_ID]]]));

            await receivedMessageHandler({ command: 'ready' });
            expect(panelState().openableRecordPreviews.size).toBe(0);
            expect(panelState().pendingOpenableRecordPreviews.has(recordLinkSequence)).toBe(true);

            await openCockpit();
            expect(panelState().pendingOpenableRecordPreviews.size).toBe(0);
            expect(panelState().openableRecordPreviews.size).toBe(0);

        });

        it('names the record and the org in one fixed-text error, quoting neither the error nor a token, when the org will not give an address', async () => {

            answerOrgOpen(async () => { throw new Error(`403 [x](command:workbench.action.terminal.new) ${INSTANCE_URL}/secur/frontdoor.jsp?sid=${SESSION_ID}`); });
            await openCockpit();
            const recordLinkSequence = await drawPreview('query', new Map([['', [ACCOUNT_ID]]]));

            await receivedMessageHandler({ command: 'openPreviewRecord', renderSequence: lastRenderSequence(), recordLinkSequence, rowIndex: 0 });

            expect(vscode.env.openExternal).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(RecipeYamlScalar.escapeForNotification(
                `Record ${ACCOUNT_ID} in qa · qa@example.com.qa was not opened: ${ORG_FRONT_DOOR_FAILURE_TEXTS.requestFailed}`
            ));
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain(SESSION_ID);
            expect(JSON.stringify((vscode.window.showErrorMessage as jest.Mock).mock.calls)).not.toContain('command:');
            expect(panelState().isOrgOpenInFlight).toBe(false);

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
        };

        const renderedPanel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            return { panel, accountCard };
        };

        const posted = (panel: ReturnType<typeof runPanelScript>, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        const cellTexts = (panel: ReturnType<typeof runPanelScript>, containerElement: any) => panel.findAll(containerElement, 'treeQueryRow')
            .map((rowElement: any) => rowElement.children.map((cellElement: any) => cellElement.children.length > 0 ? `[${cellElement.children[0].textContent}]` : cellElement.textContent));

        describe('the Query tab', () => {

            const queryResult = (overrides: Record<string, unknown> = {}) => ({
                command: 'treeQueryResult',
                renderSequence: 1,
                treeKey: ACCOUNT_TREE_KEY,
                queryKey: 'Contact:base:0',
                orgLabel: 'qa · qa@example.com.qa',
                totalSize: 3,
                recordCount: 3,
                isTruncated: false,
                columns: ['LastName', 'Id', 'AccountId'],
                rows: [['Smith', CONTACT_ID, ACCOUNT_ID], ['<b>No</b>', 'not an id', ''], ['Jones', '003DK000017d3k6', '']],
                hiddenColumnCount: 0,
                recordLinkSequence: 9,
                recordLinks: { columnIndex: 1, rowIndexes: [0, 2] },
                ...overrides
            });

            const renderQuery = () => {
                const { panel, accountCard } = renderedPanel();
                panel.openTab(accountCard, RECIPE_COCKPIT_QUERY_TAB_LABEL);
                panel.postToPanel({
                    command: 'treeQueries', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY,
                    queries: [{ queryKey: 'Contact:base:0', objectApiName: 'Contact', kindLabel: 'base', notes: [], generatedText: 'SELECT Id, LastName, AccountId FROM Contact' }]
                });
                return { panel, accountCard };
            };

            it('draws each linked row\'s own Id as a link button with textContent, and every other cell as text', () => {

                const { panel, accountCard } = renderQuery();
                panel.postToPanel(queryResult());

                expect(cellTexts(panel, accountCard)).toEqual([['Smith', `[${CONTACT_ID}]`, ACCOUNT_ID], ['<b>No</b>', 'not an id', ''], ['Jones', '[003DK000017d3k6]', '']]);
                const recordLinks = panel.findAll(accountCard, 'treeQueryRecordLink');
                expect(recordLinks).toHaveLength(2);
                recordLinks.forEach((recordLink: any) => {
                    expect(recordLink.tagName.toLowerCase()).toBe('button');
                    expect(recordLink.className).toContain('sdtButton-link');
                    expect(recordLink.attributes['title']).toBe(RECIPE_COCKPIT_RECORD_LINK_TITLE);
                });
                expect(panel.findAll(accountCard, 'b')).toEqual([]);

            });

            it('acknowledges the links it drew, and a click posts the preview and row alone -- never the Id, a URL or an org', () => {

                const { panel, accountCard } = renderQuery();
                panel.postToPanel(queryResult());

                expect(posted(panel, 'recordLinksRendered')).toEqual([{ command: 'recordLinksRendered', renderSequence: 1, recordLinkSequence: 9 }]);

                panel.findAll(accountCard, 'treeQueryRecordLink')[1].dispatch('click');

                expect(posted(panel, 'openPreviewRecord')).toEqual([{ command: 'openPreviewRecord', renderSequence: 1, recordLinkSequence: 9, rowIndex: 2 }]);
                expect(JSON.stringify(posted(panel, 'openPreviewRecord'))).not.toContain('003DK');

            });

            it('draws no link and acknowledges nothing for a preview with no links, or one for another model', () => {

                const { panel, accountCard } = renderQuery();

                panel.postToPanel(queryResult({ renderSequence: 2 }));
                expect(panel.findAll(accountCard, 'treeQueryRow')).toEqual([]);
                expect(posted(panel, 'recordLinksRendered')).toEqual([]);

                const { recordLinkSequence, recordLinks, ...unlinkedResult } = queryResult();
                expect([recordLinkSequence, recordLinks]).not.toContain(undefined);
                panel.postToPanel(unlinkedResult);
                expect(panel.findAll(accountCard, 'treeQueryRow')).toHaveLength(3);
                expect(panel.findAll(accountCard, 'treeQueryRecordLink')).toEqual([]);
                expect(posted(panel, 'recordLinksRendered')).toEqual([]);

            });

            it('links no row a forged or malformed recordLinks names past the rows, and no cell left empty', () => {

                const { panel, accountCard } = renderQuery();
                panel.postToPanel(queryResult({ recordLinks: { columnIndex: 2, rowIndexes: [1, 5, -1] } }));

                expect(panel.findAll(accountCard, 'treeQueryRecordLink')).toEqual([]);

                panel.postToPanel(queryResult({ recordLinks: { columnIndex: '1', rowIndexes: [0] } }));
                expect(panel.findAll(accountCard, 'treeQueryRecordLink')).toEqual([]);

            });

        });

        describe('the Treecipe Adapter', () => {

            const renderUpdater = () => {
                const { panel, accountCard } = renderedPanel();
                panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
                const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
                const accountObject = panel.findAll(updaterPanel, 'updaterObject')
                    .find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
                panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].dispatch('click');
                return { panel, accountObject };
            };

            it('links the loaded records\' own Ids, naming the object in the click', () => {

                const { panel, accountObject } = renderUpdater();
                panel.postToPanel({
                    command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa · qa@example.com.qa', recordLinkSequence: 4,
                    objects: [{ objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id', 'Name'], rows: [[ACCOUNT_ID, 'Acme'], ['bad', 'Globex']], hiddenColumnCount: 0, recordLinks: { columnIndex: 0, rowIndexes: [0] } }]
                });

                const recordsElement = panel.findAll(accountObject, 'updaterRecords')[0];
                expect(cellTexts(panel, recordsElement)).toEqual([[`[${ACCOUNT_ID}]`, 'Acme'], ['bad', 'Globex']]);
                expect(posted(panel, 'recordLinksRendered')).toEqual([{ command: 'recordLinksRendered', renderSequence: 1, recordLinkSequence: 4 }]);

                panel.findAll(recordsElement, 'treeQueryRecordLink')[0].dispatch('click');
                expect(posted(panel, 'openPreviewRecord')).toEqual([{ command: 'openPreviewRecord', renderSequence: 1, recordLinkSequence: 4, objectApiName: 'Account', rowIndex: 0 }]);

            });

            it('links the generated values\' Ids, and lets them go with the records an update spent', () => {

                const { panel, accountObject } = renderUpdater();
                panel.postToPanel({
                    command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', recordLinkSequence: 4,
                    objects: [{ objectApiName: 'Account', totalSize: 1, recordCount: 1, isTruncated: false, columns: ['Id'], rows: [[ACCOUNT_ID]], hiddenColumnCount: 0, recordLinks: { columnIndex: 0, rowIndexes: [0] } }]
                });
                panel.postToPanel({
                    command: 'updaterValues', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, valuesSequence: 1, recordLinkSequence: 5,
                    objects: [{ objectApiName: 'Account', recordCount: 1, fieldApiNames: ['Name'], columns: ['Id', 'Name (current)', 'Name (new)'], rows: [[ACCOUNT_ID, 'Acme', 'New']], hiddenColumnCount: 0, recordLinks: { columnIndex: 0, rowIndexes: [0] } }]
                });

                const valuesElement = panel.findAll(accountObject, 'updaterValues')[0];
                expect(cellTexts(panel, valuesElement)).toEqual([[`[${ACCOUNT_ID}]`, 'Acme', 'New']]);
                expect(posted(panel, 'recordLinksRendered').at(-1)).toEqual({ command: 'recordLinksRendered', renderSequence: 1, recordLinkSequence: 5 });

                panel.findAll(valuesElement, 'treeQueryRecordLink')[0].dispatch('click');
                expect(posted(panel, 'openPreviewRecord').at(-1)).toEqual({ command: 'openPreviewRecord', renderSequence: 1, recordLinkSequence: 5, objectApiName: 'Account', rowIndex: 0 });

                panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, isRecordsSpent: true });
                expect(panel.findAll(accountObject, 'treeQueryRecordLink')).toEqual([]);

            });

            it('draws no link in a new child object\'s preview, whose records have no Id yet', () => {

                const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitService.ts'), 'utf-8');
                const childPreviewFunction = source.slice(source.indexOf('function drawAdapterChildPreview('));
                const childPreviewBody = childPreviewFunction.slice(0, childPreviewFunction.indexOf('\n    }\n'));

                expect(childPreviewBody).toContain('buildRecordTable(columns, rows)');
                expect(childPreviewBody).not.toContain('recordLink');
                expect(source).not.toMatch(/registerRecordLinkPreview\([^)]*'adapterChild/);

            });

        });

    });

});
