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
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import { RecipeCockpitService } from '../RecipeCockpitService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { ExtensionCommandService } from '../../ExtensionCommandService/ExtensionCommandService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    One "sf org list --json --verbose" answer, read by all four org pickers through the real
    SalesforceOrgService: Data-by-Org's dropdown, the Classic list's Compare with an org…, Insert
    Data Set by Directory and Run Picklist Dependency Check. Only execFile and the authorization
    files are stood in for.
*/
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');
const SF_ORG_LIST_STDOUT = fs.readFileSync(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'), 'utf-8');
const ORG_AUTHORIZATIONS = JSON.parse(fs.readFileSync(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'), 'utf-8'));

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

const CONNECTED_ORG_LABELS = ['qa', 'activeScratch'];

describe('RecipeCockpitService, every org picker lists only the orgs the Salesforce CLI reports connected', () => {

    let receivedMessageHandler: (panelMessage: any) => Promise<void>;
    let postedPanelMessages: any[];
    let offeredQuickPickLabels: string[][];

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
        (execFile as unknown as jest.Mock).mockImplementation((_command: string, _args: string[], _options: unknown, callback: any) => {
            setImmediate(() => callback(null, SF_ORG_LIST_STDOUT, ''));
            return { kill: jest.fn() };
        });
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

    it('leaves out RefreshTokenAuthError, Unknown, expired and deleted orgs in all four pickers, and runs "sf org list" once for all of them', async () => {

        await openRenderedCockpit();

        await receivedMessageHandler({ command: 'loadDataOrgs' });
        // COMPARE IS PER TREE CARD; "Choose another org…" ALWAYS OPENS THE PICKER
        const firstTreeKey = postedNamed('recipeData').at(-1).recipe.trees[0].treeKey;
        await receivedMessageHandler({ command: 'selectOrg', treeKey: firstTreeKey, chooseOrg: true });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();
        await (new ExtensionCommandService() as any).promptForPicklistDependencyTargetOrg();

        expect(postedNamed('dataOrgList')[0]).toMatchObject({
            orgLabels: CONNECTED_ORG_LABELS,
            hiddenOrgNote: expect.stringContaining('4 authorized orgs are not listed: 1 expired, 1 deleted, 2 not connected.')
        });
        expect(offeredQuickPickLabels).toEqual([CONNECTED_ORG_LABELS, CONNECTED_ORG_LABELS, CONNECTED_ORG_LABELS]);
        expect(execFile).toHaveBeenCalledTimes(1);
        expect((execFile as unknown as jest.Mock).mock.calls[0][1]).toEqual(['org', 'list', '--json', '--verbose']);

    });

    it('runs "sf org list" again on Data-by-Org\'s ⟳, and every picker after it reads the new answer', async () => {

        await openRenderedCockpit();
        await receivedMessageHandler({ command: 'loadDataOrgs' });

        (execFile as unknown as jest.Mock).mockImplementation((_command: string, _args: string[], _options: unknown, callback: any) => {
            const reconnectedOrgList = JSON.parse(SF_ORG_LIST_STDOUT);
            // THE CLI REPEATS A SANDBOX UNDER "sandboxes", AND EVERY ENTRY FOR AN ORG HAS TO SAY CONNECTED
            [reconnectedOrgList.result.nonScratchOrgs[1], reconnectedOrgList.result.sandboxes[1]].forEach(orgListEntry => { orgListEntry.connectedStatus = 'Connected'; });
            setImmediate(() => callback(null, JSON.stringify(reconnectedOrgList), ''));
            return { kill: jest.fn() };
        });

        await receivedMessageHandler({ command: 'refreshDataOrgCounts' });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();

        expect(execFile).toHaveBeenCalledTimes(2);
        expect(postedNamed('dataOrgList').map(dataOrgList => dataOrgList.orgLabels)).toEqual([CONNECTED_ORG_LABELS, ['qa', 'uat', 'activeScratch']]);
        expect(offeredQuickPickLabels).toEqual([['qa', 'uat', 'activeScratch']]);

    });

    it('lists no org anywhere when the Salesforce CLI is missing, and never falls back to every authorization', async () => {

        (execFile as unknown as jest.Mock).mockImplementation((_command: string, _args: string[], _options: unknown, callback: any) => {
            setImmediate(() => callback(Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }), '', ''));
            return { kill: jest.fn() };
        });

        await openRenderedCockpit();
        await receivedMessageHandler({ command: 'loadDataOrgs' });
        await CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst();

        expect(postedNamed('dataOrgList')[0]).toMatchObject({ orgLabels: [], noOrgsMessage: expect.stringContaining('Salesforce CLI') });
        expect(offeredQuickPickLabels).toEqual([]);
        expect(VSCodeWorkspaceService.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('could not report which authorized orgs are connected'));
        // A FAILURE IS NOT CACHED: THE SECOND PICKER ASKED THE CLI AGAIN
        expect(execFile).toHaveBeenCalledTimes(2);

    });

});
