import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
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

import { AuthInfo, Org } from '@salesforce/core';
import { execFile } from 'child_process';

import { RECIPE_COCKPIT_DATA_ORG_STATE_KEY, RECIPE_COCKPIT_HIDDEN_ORGS_NOTE, RecipeCockpitService } from '../RecipeCockpitService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { ExtensionCommandService } from '../../ExtensionCommandService/ExtensionCommandService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { answerOrgConnectionPings, CONNECTED_ORG_USERNAMES } from '../../SalesforceOrgService/tests/OrgConnectionPings';

/*
    One connection check (#502: each authorization pinged in process), read by all three org pickers
    through the real SalesforceOrgService: the Treecipe tab's org dropdown, Insert Data Set by
    Directory and Run Picklist Dependency Check (Compare with an org… went with the Compare tab, #266).
    Only the pings and the authorization files are stood in for; no process may start.
*/
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');
const ORG_AUTHORIZATIONS = JSON.parse(fs.readFileSync(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'), 'utf-8'));

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

const CONNECTED_ORG_LABELS = ['qa', 'activeScratch'];

// AN ORG SELECTED HERE HAS NO LOCAL AUTHORIZATION READ FOR ITS LABEL (#458, #499); RecipeCockpitDataByOrg.test.ts COVERS THE LABEL
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, every org picker lists only the orgs that answer their ping (#502)', () => {

    let receivedMessageHandler: (panelMessage: any) => Promise<void>;
    let postedPanelMessages: any[];
    let offeredQuickPickLabels: string[][];
    let checkSpy: jest.SpyInstance;

    const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
    const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);

    const openRenderedCockpit = async () => {
        await RecipeCockpitService.openRecipeCockpitPanel(TREE_WORKSPACE_ROOT, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
        await receivedMessageHandler({ command: 'ready' });
        await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
    };

    beforeEach(() => {

        SalesforceOrgService.clearConnectedOrgStatusCache();
        postedPanelMessages = [];
        offeredQuickPickLabels = [];

        (execFile as unknown as jest.Mock).mockReset();
        answerOrgConnectionPings(Org.create as jest.Mock);
        checkSpy = jest.spyOn(SalesforceOrgService, 'checkOrgConnections');
        (AuthInfo.listAllAuthorizations as jest.Mock).mockClear();
        (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS);

        // EACH QUICK PICK RECORDS THE ORGS IT OFFERED, THEN IS DISMISSED, SO NO COMMAND GOES ON TO CONNECT
        (vscode.window.createQuickPick as jest.Mock).mockImplementation(() => {
            const hideHandlers: (() => void)[] = [];
            const fakeQuickPick: any = {
                show: jest.fn(),
                dispose: jest.fn(),
                hide: jest.fn(() => hideHandlers.forEach(hideHandler => hideHandler())),
                onDidAccept: jest.fn(),
                onDidHide: jest.fn((hideHandler: () => void) => hideHandlers.push(hideHandler))
            };
            Object.defineProperty(fakeQuickPick, 'items', {
                get: () => [],
                set: (offeredItems: vscode.QuickPickItem[]) => {
                    if ( offeredItems.length > 0 ) {
                        offeredQuickPickLabels.push(offeredItems.map(offeredItem => offeredItem.label));
                        setImmediate(() => fakeQuickPick.hide());
                    }
                }
            });
            return fakeQuickPick;
        });

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

        (RecipeCockpitService as any).recipeCockpitPanel = undefined;
        (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

    });

    it('leaves out a failed refresh, an unreachable org, an expired and a deleted scratch org in all three pickers, and checks once for all of them', async () => {

        await openRenderedCockpit();

        await receivedMessageHandler({ command: 'loadDataOrgs' });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
        await (new ExtensionCommandService() as any).promptForPicklistDependencyTargetOrg();

        expect(postedNamed('dataOrgList')[0]).toMatchObject({
            orgLabels: CONNECTED_ORG_LABELS,
            hiddenOrgNote: RECIPE_COCKPIT_HIDDEN_ORGS_NOTE
        });
        expect(offeredQuickPickLabels).toEqual([CONNECTED_ORG_LABELS, CONNECTED_ORG_LABELS]);
        expect(checkSpy).toHaveBeenCalledTimes(1);
        expect(execFile).not.toHaveBeenCalled();

    });

    it('checks again on the Treecipe tab\'s ⟳, and every picker after it reads the new answer', async () => {

        await openRenderedCockpit();
        await receivedMessageHandler({ command: 'loadDataOrgs' });

        answerOrgConnectionPings(Org.create as jest.Mock, username => [...CONNECTED_ORG_USERNAMES, 'uat@example.com.uat'].includes(username));

        await receivedMessageHandler({ command: 'refreshDataOrgs' });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();

        expect(checkSpy).toHaveBeenCalledTimes(2);
        expect(postedNamed('dataOrgList').map(dataOrgList => dataOrgList.orgLabels)).toEqual([CONNECTED_ORG_LABELS, ['qa', 'uat', 'activeScratch']]);
        expect(offeredQuickPickLabels).toEqual([['qa', 'uat', 'activeScratch']]);

    });

    it('lists an org with no alias by its username, while the selection and the remembered org stay the username (#286)', async () => {

        (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue(ORG_AUTHORIZATIONS.map((authorization: any) => ({ ...authorization, aliases: [] })));
        const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockRejectedValue(new Error('no connection in this test'));
        const workspaceStateUpdate = jest.fn().mockResolvedValue(undefined);

        await RecipeCockpitService.openRecipeCockpitPanel(TREE_WORKSPACE_ROOT, { get: jest.fn(), update: workspaceStateUpdate });
        await receivedMessageHandler({ command: 'ready' });
        await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        await receivedMessageHandler({ command: 'loadDataOrgs' });

        expect(postedNamed('dataOrgList')[0].orgLabels).toEqual(['qa@example.com.qa', 'test-active@example.com']);

        await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });

        const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
        expect(panelState.dataOrgSelection.orgDetail).toEqual({ targetOrgIdentifier: 'qa@example.com.qa', username: 'qa@example.com.qa', alias: undefined });
        expect(workspaceStateUpdate).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, 'qa@example.com.qa');
        expect(getConnectionSpy).toHaveBeenCalledWith('qa@example.com.qa');

    });

    it('lists no org anywhere when the authorizations cannot be read, and never falls back to every authorization', async () => {

        (AuthInfo.listAllAuthorizations as jest.Mock).mockRejectedValue(new Error('auth files unreadable'));

        await openRenderedCockpit();
        await receivedMessageHandler({ command: 'loadDataOrgs' });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();

        expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: 'The authorized Salesforce orgs could not be read, so no org is listed. auth files unreadable' });
        expect(offeredQuickPickLabels).toEqual([]);
        expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('could not be read, so no org is listed'));
        expect(execFile).not.toHaveBeenCalled();

    });

    it('lists the orgs that answered when one org never answers, rather than nothing (#502)', async () => {

        (Org.create as jest.Mock).mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
            getUsername: () => aliasOrUsername,
            refreshAuth: () => aliasOrUsername === 'stale@example.com.dev' ? new Promise(() => undefined) : Promise.resolve()
        }));
        // THE REAL CHECK, WITH TIMES SHORT ENOUGH FOR A TEST
        checkSpy.mockRestore();
        const checkOrgConnections = SalesforceOrgService.checkOrgConnections.bind(SalesforceOrgService);
        jest.spyOn(SalesforceOrgService, 'checkOrgConnections').mockImplementation(authorizations => checkOrgConnections(authorizations, 1000, 10));

        await openRenderedCockpit();
        await receivedMessageHandler({ command: 'loadDataOrgs' });

        expect(postedNamed('dataOrgList')[0].orgLabels).toEqual(['qa', 'uat', 'deletedScratch', 'activeScratch']);

    });

});
