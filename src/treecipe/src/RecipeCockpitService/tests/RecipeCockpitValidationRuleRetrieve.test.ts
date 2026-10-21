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
    RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND,
    RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER
} from '../RecipeCockpitService';
import { RecipeCockpitValidationRuleRetrieve, VALIDATION_RULE_RETRIEVE_MAX_OBJECTS } from '../RecipeCockpitValidationRuleRetrieve';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const PERMISSION_SET_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'permissionSetWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_TREE_OBJECTS = ['Account', 'Contact', 'OtherChildObject__c'];
const PROD_USERNAME = 'admin@example.com';
const PROD_ORG = { targetOrgIdentifier: 'prod', username: PROD_USERNAME, alias: 'prod' };

const invocation = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout: stdout, stderr: '', exitCode: 0, ...extra });

const ruleFile = (fullName: string, extra: Record<string, unknown> = {}) => ({
    fullName: fullName,
    type: 'ValidationRule',
    state: 'Created',
    filePath: `/workspace/force-app/main/default/objects/${fullName.split('.')[0]}/validationRules/${fullName.split('.')[1]}.validationRule-meta.xml`,
    ...extra
});

const buildRetrieveAnswer = (files: unknown[], overrides: Record<string, unknown> = {}) => JSON.stringify({
    status: 0,
    result: { done: true, status: 'Succeeded', success: true, files: files },
    warnings: [],
    ...overrides
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, "Retrieve validation rules…" on a tree card (#326)', () => {

    describe('RecipeCockpitValidationRuleRetrieve', () => {

        it('keeps each object once in the tree\'s order, and sets aside a name that is not an api name', () => {

            expect(RecipeCockpitValidationRuleRetrieve.partitionObjectApiNames(['Account', 'Bad Name', 'Contact', 'Account', 'x\ny']))
                .toEqual({ retrievable: ['Account', 'Contact'], refused: ['Bad Name', 'x\ny'] });

        });

        it('builds one retrieve argv with one --metadata per object and the username as --target-org, and never a deploy argv', () => {

            const retrieveArguments = RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(ACCOUNT_TREE_OBJECTS, PROD_USERNAME);

            expect(retrieveArguments).toEqual([
                'project', 'retrieve', 'start', '--json', '--target-org', PROD_USERNAME,
                '--metadata', 'ValidationRule:Account.*',
                '--metadata', 'ValidationRule:Contact.*',
                '--metadata', 'ValidationRule:OtherChildObject__c.*'
            ]);
            expect(retrieveArguments).not.toContain('deploy');
            expect(Object.getOwnPropertyNames(RecipeCockpitValidationRuleRetrieve).filter(propertyName => /deploy/i.test(propertyName))).toEqual([]);
            // NOTHING IN THE MODULE EVEN SPELLS A DEPLOY SUBCOMMAND
            expect(fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitValidationRuleRetrieve.ts'), 'utf-8')).not.toMatch(/['"]deploy['"]/);

        });

        it('refuses a name that is not an api name, no object, too many objects and an org identifier that could be read as a flag, before any argv', () => {

            expect(() => RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(['Account', 'X.* --target-org evil'], PROD_USERNAME)).toThrow('is not a Salesforce api name, so no validation rule was retrieved.');
            expect(() => RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(['Account\nContact'], PROD_USERNAME)).toThrow('"Account Contact" is not a Salesforce api name');
            expect(() => RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments([], PROD_USERNAME)).toThrow('No object was named');
            expect(() => RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(Array.from({ length: VALIDATION_RULE_RETRIEVE_MAX_OBJECTS + 1 }, (_value, index) => `Object${index}__c`), PROD_USERNAME))
                .toThrow(`at most ${VALIDATION_RULE_RETRIEVE_MAX_OBJECTS} can be retrieved at once`);
            expect(() => RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(['Account'], '--target-org')).toThrow();

        });

        describe('countLocalValidationRuleFiles', () => {

            let temporaryRoot: string;
            let workspaceRoot: string;

            beforeEach(() => {
                temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-validation-rule-count-'));
                workspaceRoot = path.join(temporaryRoot, 'workspace');
                fs.mkdirSync(workspaceRoot);
            });

            afterEach(() => {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            });

            const writeRule = (relativeFolderPath: string, fileName: string) => {
                fs.mkdirSync(path.join(workspaceRoot, relativeFolderPath), { recursive: true });
                fs.writeFileSync(path.join(workspaceRoot, relativeFolderPath, fileName), '<ValidationRule/>');
            };

            it('counts the rule files of the tree\'s objects under every package directory, the object matched case-insensitively', () => {

                writeRule('force-app/main/default/objects/Account/validationRules', 'One.validationRule-meta.xml');
                writeRule('force-app/main/default/objects/Account/validationRules', 'Two.validationRule-meta.xml');
                writeRule('force-app/main/default/objects/Account/validationRules', 'notes.txt');
                writeRule('unpackaged/objects/contact/validationRules', 'Three.validationRule-meta.xml');
                writeRule('force-app/main/default/objects/Lead/validationRules', 'NotThisTree.validationRule-meta.xml');

                expect(RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, ['force-app', 'unpackaged', 'force-app'], ACCOUNT_TREE_OBJECTS)).toBe(3);
                expect(RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, ['force-app'], ['Lead'])).toBe(1);
                expect(RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, ['missing'], ACCOUNT_TREE_OBJECTS)).toBe(0);

            });

            it('follows no link and reads no package directory outside the workspace', () => {

                const outsideObjectsPath = path.join(temporaryRoot, 'outside', 'objects', 'Account', 'validationRules');
                fs.mkdirSync(outsideObjectsPath, { recursive: true });
                fs.writeFileSync(path.join(outsideObjectsPath, 'Outside.validationRule-meta.xml'), '<ValidationRule/>');
                fs.mkdirSync(path.join(workspaceRoot, 'force-app'));
                fs.symlinkSync(path.join(temporaryRoot, 'outside', 'objects'), path.join(workspaceRoot, 'force-app', 'objects'));

                expect(RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, ['force-app'], ['Account'])).toBe(0);
                expect(RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, ['../outside'], ['Account'])).toBe(0);

            });

        });

        describe('parseValidationRuleRetrieveOutput', () => {

            const parse = (stdout: string, extra: Record<string, unknown> = {}) =>
                RecipeCockpitValidationRuleRetrieve.parseValidationRuleRetrieveOutput(invocation(stdout, extra), ACCOUNT_TREE_OBJECTS);

            it('counts each rule under the tree object its full name names, case-insensitively, in the tree\'s order', () => {

                expect(parse(buildRetrieveAnswer([
                    ruleFile('OtherChildObject__c.Amount_Range'),
                    ruleFile('account.Name_Required', { state: 'Changed' }),
                    ruleFile('Account.Phone_Format', { state: 'Unchanged' }),
                    ruleFile('Account.Phone_Format'),
                    ruleFile('Lead.Not_This_Tree'),
                    { fullName: 'Account', type: 'CustomObject', state: 'Created' }
                ]))).toEqual({ kind: 'retrieved', ruleCount: 3, objectApiNamesWithRules: ['Account', 'OtherChildObject__c'], failureMessages: [] });

            });

            it('reads an org that holds no rule as a retrieve of nothing', () => {

                expect(parse(buildRetrieveAnswer([]))).toEqual({ kind: 'retrieved', ruleCount: 0, objectApiNamesWithRules: [], failureMessages: [] });
                expect(parse(JSON.stringify({ status: 0, result: { success: true } }))).toEqual({ kind: 'retrieved', ruleCount: 0, objectApiNamesWithRules: [], failureMessages: [] });

            });

            it('names the rules that came back failed, and still counts the rest', () => {

                expect(parse(buildRetrieveAnswer([
                    ruleFile('Account.Good'),
                    ruleFile('Contact.Broken', { state: 'Failed', problemType: 'Error', error: 'Entity cannot be found' }),
                    ruleFile('Contact.Silent', { problemType: 'Error' })
                ]))).toEqual({
                    kind: 'retrieved',
                    ruleCount: 1,
                    objectApiNamesWithRules: ['Account'],
                    failureMessages: ['Contact.Broken: Entity cannot be found', 'Contact.Silent: it could not be retrieved']
                });

            });

            it('never reads a failed, malformed or unsuccessful answer as a retrieve', () => {

                expect(parse('{"status":1,"name":"NoOrgFound","message":"No authorization"}', { exitCode: 1 })).toEqual({ kind: 'failed', failureMessage: 'NoOrgFound: No authorization' });
                expect(parse(buildRetrieveAnswer([ruleFile('Account.Good')], { status: 1 })).kind).toBe('failed');
                expect(parse(JSON.stringify({ status: 0, result: { success: false, files: [ruleFile('Account.Good')] } })).kind).toBe('failed');
                expect(parse(JSON.stringify({ status: 0, result: { success: 'true' } })).kind).toBe('failed');
                expect(parse(JSON.stringify({ status: '0', result: { success: true } })).kind).toBe('failed');
                expect(parse(JSON.stringify({ status: 0, result: [] })).kind).toBe('failed');
                expect(parse('not json').kind).toBe('failed');
                expect(parse(JSON.stringify({ status: 0, result: { success: true, files: 'x' } })))
                    .toEqual({ kind: 'retrieved', ruleCount: 0, objectApiNamesWithRules: [], failureMessages: [] });
                expect(parse(JSON.stringify({ status: 0, result: { success: true, files: [null, 'Account.X', { type: 'ValidationRule', fullName: 7 }] } }))).toMatchObject({ kind: 'retrieved', ruleCount: 0 });

            });

            it('says the CLI is required on ENOENT, and that a timeout or an answer too large to read leaves the retrieve unknown', () => {

                expect(parse('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }).kind).toBe('cliNotInstalled');
                expect(parse('', { spawnError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) }))
                    .toEqual({ kind: 'failed', failureMessage: 'The Salesforce CLI could not be started: EACCES' });
                expect(parse('', { timedOut: true }).kind).toBe('unconfirmed');
                expect(parse('', { isOutputTooLarge: true }).kind).toBe('unconfirmed');

            });

        });

        it('is named in the opt-in warning as reading from any org, production included, and deploying nothing', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Retrieve validation rules…", on every tree, asks every time in the command palette for any connected org, production included');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('it only reads from that org and deploys nothing.');

        });

        it('names the tree, the org, every object, where new files go and how many local files are overwritten in the confirmation, each on one line', () => {

            const detail = RecipeCockpitValidationRuleRetrieve.buildConfirmationDetail('Tree\nTwo', `prod · ${PROD_USERNAME}`, ACCOUNT_TREE_OBJECTS, 'force-app', 2);

            expect(detail).toContain('Tree: Tree Two');
            expect(detail).toContain(`Org: prod · ${PROD_USERNAME}`);
            expect(detail).toContain('3 objects: Account, Contact, OtherChildObject__c');
            expect(detail).toContain('New rule files are written under: force-app');
            expect(detail).toContain('2 existing local validation rule files for these objects will be overwritten');
            expect(detail).toContain('Nothing is deployed.');
            expect(detail).not.toMatch(/[()]/);

            expect(RecipeCockpitValidationRuleRetrieve.buildConfirmationDetail('T', 'o', ['Account'], 'force-app', 0)).toContain('1 object: Account\n');
            expect(RecipeCockpitValidationRuleRetrieve.buildConfirmationDetail('T', 'o', ['Account'], 'force-app', 0)).toContain('This project holds no validation rule file for these objects yet.');
            expect(RecipeCockpitValidationRuleRetrieve.buildConfirmationDetail('T', 'o', ['Account'], 'force-app', 1)).toContain('1 existing local validation rule file for');

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const retrieveMessage = { command: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY };
        const notRunning = (treeKey: string = ACCOUNT_TREE_KEY) => ({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: treeKey });

        it('routes the tree KEY and nothing else, never an org the message names', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...retrieveMessage, orgIndex: 0, username: PROD_USERNAME, objectApiNames: ['Evil'] } as any, buildPanelState()))
                .toEqual({ kind: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY });

        });

        it('gives the button back, silently, for a card the panel has not confirmed drawing, a key that is not a string, or no model', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ ...retrieveMessage, treeKey: 'Lead-ONLY' }, panelState)).toEqual({ kind: 'refuseValidationRuleRetrieve', hostMessage: notRunning('Lead-ONLY') });
            expect(RecipeCockpitService.routePanelMessage({ ...retrieveMessage, treeKey: 7 }, panelState)).toEqual({ kind: 'refuseValidationRuleRetrieve', hostMessage: notRunning('') });

            panelState.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(retrieveMessage, panelState)).toEqual({ kind: 'refuseValidationRuleRetrieve', hostMessage: notRunning() });

        });

        it('is refused, with a reason, while an insert or a permission set assignment is running, and not for a scratch org run, which deploys nothing (#358)', () => {

            const busyRefusal = { kind: 'refuseValidationRuleRetrieve', refusalText: RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL, hostMessage: notRunning() };
            const panelState = buildPanelState();

            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(retrieveMessage, panelState)).toEqual(busyRefusal);

            panelState.insertStateMessage = undefined;
            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(retrieveMessage, panelState)).toEqual({ kind: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY });

            panelState.scratchOrgStateMessage = undefined;
            panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(retrieveMessage, panelState)).toEqual(busyRefusal);

        });

        it('answers a second click while one runs with the running state, so a reloaded document holds its buttons', () => {

            const panelState = buildPanelState();
            const runningState = { command: 'validationRuleRetrieveState' as const, isRunning: true, treeKey: 'Lead-ONLY' };
            panelState.validationRuleRetrieveStateMessage = runningState;

            expect(RecipeCockpitService.routePanelMessage(retrieveMessage, panelState)).toEqual({ kind: 'refuseValidationRuleRetrieve', hostMessage: runningState });

        });

    });

    describe('the host, against a faked org prompt and Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let retrieveHandler: (argumentList: string[]) => { stdout: string; error?: unknown };
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let promptSpy: jest.SpyInstance;
        let modalAnswer: string | undefined;
        let notificationAnswer: string | undefined;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const retrieveCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warningCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls;
        const modalCalls = () => warningCalls().filter(([, options]) => options?.inPanel);
        const notifications = () => [
            ...(vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([text, ...actions]) => ({ severity: 'information', text: text, actions: actions })),
            ...warningCalls()
                .filter(([, options]) => !( options && typeof options === 'object' && options.inPanel ))
                .map(([text, ...actions]) => ({ severity: 'warning', text: text, actions: actions }))
        ];

        const writeLocalRule = (objectApiName: string, ruleName: string) => {
            const folderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', objectApiName, 'validationRules');
            fs.mkdirSync(folderPath, { recursive: true });
            fs.writeFileSync(path.join(folderPath, `${ruleName}.validationRule-meta.xml`), '<ValidationRule/>');
        };

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const retrieve = async (panelMessage: Record<string, unknown> = {}) => {
            await receivedMessageHandler({ command: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY, ...panelMessage });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-validation-rule-retrieve-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(PERMISSION_SET_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');

            SalesforceOrgService.clearConnectedOrgStatusCache();
            (RecipeCockpitService as any).isValidationRuleRetrieveInFlight = false;
            (RecipeCockpitService as any).validationRuleRetrieveRunStateMessage = undefined;
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = false;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = undefined;
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            modalAnswer = RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL;
            notificationAnswer = undefined;
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([ruleFile('Account.Name_Required'), ruleFile('Account.Phone_Format'), ruleFile('OtherChildObject__c.Amount_Range')]) });

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const cliAnswer = argumentList[0] === 'org' && argumentList[1] === 'list'
                    ? { stdout: JSON.stringify(SF_ORG_LIST) }
                    : retrieveHandler(argumentList);
                setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                return { kill: jest.fn() };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS);

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.inPanel ? modalAnswer : notificationAnswer);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async () => notificationAnswer);
            (vscode.commands.executeCommand as jest.Mock).mockReset();
            (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

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
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            promptSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(PROD_ORG);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('asks for the org in the command palette, names the objects, the org, the package directory and the files it overwrites, and retrieves in project mode', async () => {

            writeLocalRule('Account', 'Name_Required');
            writeLocalRule('Lead', 'Not_This_Tree');
            await openCockpit();

            await retrieve();

            expect(promptSpy).toHaveBeenCalledTimes(1);
            expect(promptSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER);

            const [modalMessage, modalOptions, modalAction] = modalCalls()[0];
            expect(modalMessage).toBe(`Retrieve the validation rules of 3 objects of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}?`);
            expect(modalOptions.detail).toContain('3 objects: Account, Contact, OtherChildObject__c');
            expect(modalOptions.detail).toContain(`Org: prod · ${PROD_USERNAME}`);
            expect(modalOptions.detail).toContain('New rule files are written under: force-app');
            expect(modalOptions.detail).toContain('1 existing local validation rule file for these objects will be overwritten');
            expect(modalAction).toBe(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL);

            expect(retrieveCalls()).toEqual([[
                'project', 'retrieve', 'start', '--json', '--target-org', PROD_USERNAME,
                '--metadata', 'ValidationRule:Account.*',
                '--metadata', 'ValidationRule:Contact.*',
                '--metadata', 'ValidationRule:OtherChildObject__c.*'
            ]]);
            expect(cliCalls.some(argumentList => argumentList.includes('deploy'))).toBe(false);
            const projectCalls = (execFile as unknown as jest.Mock).mock.calls.filter(([, argumentList]) => argumentList[0] === 'project');
            projectCalls.forEach(([command, , execOptions]) => {
                expect(execOptions.cwd).toBe(path.resolve(workspaceRoot));
                expect(path.isAbsolute(String(command).replace(/^"|"$/g, ''))).toBe(true);
            });

            expect(notifications()).toEqual([{
                severity: 'information',
                text: `Retrieved 3 validation rules for 2 of 3 objects of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}: Account, OtherChildObject__c. Generate Treecipe applies them to the recipe.`,
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL]
            }]);
            expect(postedNamed('validationRuleRetrieveState')).toEqual([
                { command: 'validationRuleRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY },
                { command: 'validationRuleRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }
            ]);

            const resultFiles = fs.readdirSync(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, PROD_USERNAME));
            expect(resultFiles.filter(fileName => fileName.endsWith('-validation-rule-retrieve.json'))).toHaveLength(1);

        });

        it('asks for the org every time, even with an org selected in the Treecipe tab or posted by the panel', async () => {

            await openCockpit();
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' }, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };

            await retrieve({ orgIndex: 0 });
            await retrieve({ orgIndex: 0 });

            expect(promptSpy).toHaveBeenCalledTimes(2);
            retrieveCalls().forEach(argumentList => expect(argumentList[argumentList.indexOf('--target-org') + 1]).toBe(PROD_USERNAME));

        });

        it('is a quiet cancel when the org pick or the modal is dismissed, and gives the button back', async () => {

            await openCockpit();

            promptSpy.mockResolvedValueOnce(undefined);
            await retrieve();

            expect(modalCalls()).toEqual([]);

            modalAnswer = undefined;
            await retrieve();

            expect(modalCalls()).toHaveLength(1);
            expect(retrieveCalls()).toEqual([]);
            expect(notifications()).toEqual([]);
            expect(postedNamed('validationRuleRetrieveState').at(-1)).toEqual({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('refuses before any org prompt when the project has no deployable package directory', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpit();

            await retrieve();

            expect(promptSpy).not.toHaveBeenCalled();
            expect(notifications()).toEqual([expect.objectContaining({ severity: 'warning', text: expect.stringMatching(/^No validation rules were retrieved: /), actions: [] })]);

        });

        it('says so, as information and with Generate Treecipe, when the org holds no rule for the tree', async () => {

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([]) });
            await openCockpit();

            await retrieve();

            expect(notifications()).toEqual([{
                severity: 'information',
                text: `prod · ${PROD_USERNAME} holds no validation rule for the 3 objects of Account-thru-OtherChildObject__c, so nothing was written.`,
                actions: []
            }]);

        });

        it('warns with what failed, View output and, when rules came back, Generate Treecipe', async () => {

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([ruleFile('Account.Good'), ruleFile('Contact.Broken', { state: 'Failed', problemType: 'Error', error: 'Entity cannot be found' })]) });
            await openCockpit();

            await retrieve();

            expect(notifications()).toEqual([{
                severity: 'warning',
                text: expect.stringContaining('1 could not be retrieved: Contact.Broken: Entity cannot be found.'),
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL, RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]
            }]);

        });

        it('warns with View output and no Generate Treecipe when the CLI fails, and never reads its answer as a retrieve', async () => {

            retrieveHandler = () => ({ stdout: '{"status":1,"name":"NoOrgFound","message":"No authorization"}', error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpit();

            await retrieve();

            expect(notifications()).toEqual([{
                severity: 'warning',
                text: `No validation rules were retrieved from prod · ${PROD_USERNAME}: NoOrgFound: No authorization`,
                actions: [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]
            }]);

        });

        it('says a cancelled retrieve leaves the written files unknown', async () => {

            cancellationToken.isCancellationRequested = true;
            await openCockpit();

            await retrieve();

            expect(notifications()).toEqual([{
                severity: 'warning',
                text: expect.stringContaining('was cancelled, so which rule files were written is unknown.'),
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL]
            }]);

        });

        it('runs Generate Treecipe through the open cockpit when the notification\'s button is chosen', async () => {

            notificationAnswer = RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL;
            await openCockpit();

            await retrieve();
            await flushAsyncWork();

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND, expect.anything());

        });

        it('does not start Generate Treecipe while an insert holds the selection', async () => {

            notificationAnswer = RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL;
            await openCockpit();
            jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockImplementation(async () => {
                panelState().insertStateMessage = { command: 'insertState', isRunning: true, treeKey: 'Lead-ONLY' };
                return PROD_ORG;
            });

            await retrieve();
            await flushAsyncWork();

            expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND, expect.anything());
            expect(notifications().at(-1)).toEqual(expect.objectContaining({ severity: 'warning', text: expect.stringContaining('Generate Treecipe was not started') }));

        });

        it('starts no retrieve when an insert or an assignment started while the prompt or the modal was open', async () => {

            await openCockpit();
            const startMeanwhile = [
                () => { panelState().insertStateMessage = { command: 'insertState', isRunning: true, treeKey: 'Lead-ONLY' }; },
                () => { panelState().permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: 'Lead-ONLY' }; }
            ];

            for ( const start of startMeanwhile ) {
                (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
                panelState().insertStateMessage = undefined;
                panelState().permissionSetAssignStateMessage = undefined;
                promptSpy.mockImplementationOnce(async () => { start(); return PROD_ORG; });
                await (RecipeCockpitService as any).performValidationRuleRetrieve(workspaceRoot, 'Tree', ACCOUNT_TREE_OBJECTS);
            }
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;

            expect(retrieveCalls()).toEqual([]);
            expect(notifications().map(notification => notification.text)).toEqual(Array(2).fill(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL));

        });

        it('does not hold + New scratch org while a retrieve runs, since a scratch org run deploys nothing (#358)', async () => {

            await openCockpit();
            panelState().dataOrgObjectApiNames = new Set(ACCOUNT_TREE_OBJECTS);
            panelState().validationRuleRetrieveStateMessage = { command: 'validationRuleRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };

            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState())).toEqual({ kind: 'createScratchOrg' });

        });

        it('refuses, before any prompt, a tree with no api name or more objects than one command line holds', async () => {

            const perform = (objectApiNames: string[]) => (RecipeCockpitService as any).performValidationRuleRetrieve(workspaceRoot, 'Big Tree', objectApiNames);

            await perform(['Bad Name']);
            await perform(Array.from({ length: VALIDATION_RULE_RETRIEVE_MAX_OBJECTS + 1 }, (_value, index) => `Object${index}__c`));

            expect(promptSpy).not.toHaveBeenCalled();
            expect(notifications().map(notification => notification.text)).toEqual([
                'No validation rules were retrieved: no object of Big Tree has an api name.',
                `No validation rules were retrieved: Big Tree has ${VALIDATION_RULE_RETRIEVE_MAX_OBJECTS + 1} objects, and at most ${VALIDATION_RULE_RETRIEVE_MAX_OBJECTS} can be retrieved at once.`
            ]);

        });

        it('names a skipped object name in the outcome, and offers View output beside Generate Treecipe', async () => {

            await (RecipeCockpitService as any).performValidationRuleRetrieve(workspaceRoot, 'Tree', ['Account', 'Bad Name']);

            expect(notifications()).toEqual([{
                severity: 'warning',
                text: expect.stringContaining('Skipped 1 name that is not an api name.'),
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL, RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]
            }]);

        });

        it('warns when the org listing fails or names an org the CLI could not be pointed at, and starts no retrieve', async () => {

            await openCockpit();

            promptSpy.mockRejectedValueOnce(new Error('The Salesforce CLI could not say which orgs are connected.'));
            await retrieve();
            promptSpy.mockResolvedValueOnce({ targetOrgIdentifier: '-x', username: '--target-org', alias: '' });
            await retrieve();

            expect(retrieveCalls()).toEqual([]);
            expect(notifications().map(notification => notification.text)).toEqual([
                'No validation rules were retrieved: The Salesforce CLI could not say which orgs are connected.',
                expect.stringMatching(/^No validation rules were retrieved: /)
            ]);

        });

        it('says the CLI is required when it is not installed', async () => {

            retrieveHandler = () => ({ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });
            await openCockpit();

            await retrieve();

            expect(notifications()).toEqual([expect.objectContaining({ severity: 'warning', text: expect.stringContaining('The Salesforce CLI is required to retrieve validation rules'), actions: [] })]);

        });

        it('opens the result file from View output, re-checked in the workspace', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            notificationAnswer = RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL;
            retrieveHandler = () => ({ stdout: '{"status":1,"name":"NoOrgFound","message":"No authorization"}', error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpit();

            await retrieve();
            await flushAsyncWork();

            expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/-validation-rule-retrieve\.json$/), workspaceRoot, expect.any(String));

        });

        it('reports a follow-up that throws through the shared error handler, after the run has ended', async () => {

            const handlerSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined as any);
            jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockRejectedValue(new Error('editor gone'));
            notificationAnswer = RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL;
            retrieveHandler = () => ({ stdout: '{"status":1,"name":"NoOrgFound","message":"No authorization"}', error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpit();

            await retrieve();
            await flushAsyncWork();

            expect(handlerSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'editor gone' }), 'openRecipeCockpit');
            expect(postedNamed('validationRuleRetrieveState').at(-1)).toEqual({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('runs Generate Treecipe as the command when no cockpit is open, and not twice through an open one', async () => {

            await (RecipeCockpitService as any).generateTreecipeAfterValidationRuleRetrieve();
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND);

            (vscode.commands.executeCommand as jest.Mock).mockClear();
            await openCockpit();
            panelState().isGenerateTreecipeInFlight = true;
            await (RecipeCockpitService as any).generateTreecipeAfterValidationRuleRetrieve();

            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(notifications().at(-1)?.text).toContain('Generate Treecipe was not started');

        });

        it('gives the button back for a tree the model no longer holds, and a panel built mid-retrieve adopts the running state', async () => {

            await openCockpit();
            postedPanelMessages = [];

            await (RecipeCockpitService as any).retrieveTreeValidationRulesFromPanel((RecipeCockpitService as any).recipeCockpitPanel, 'Gone-Tree');
            expect(postedNamed('validationRuleRetrieveState')).toEqual([{ command: 'validationRuleRetrieveState', isRunning: false, treeKey: 'Gone-Tree' }]);

            const runningState = { command: 'validationRuleRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            (RecipeCockpitService as any).isValidationRuleRetrieveInFlight = true;
            (RecipeCockpitService as any).validationRuleRetrieveRunStateMessage = runningState;
            const builtState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            (RecipeCockpitService as any).adoptValidationRuleRetrieveRunState(builtState);

            expect(builtState.validationRuleRetrieveStateMessage).toEqual(runningState);

        });

        it('runs one retrieve per window: a click while one runs starts nothing and is told it is running', async () => {

            await openCockpit();
            let releasePrompt: (orgDetail: typeof PROD_ORG) => void = () => undefined;
            promptSpy.mockImplementationOnce(() => new Promise(resolve => { releasePrompt = resolve; }));

            const firstRetrieve = retrieve();
            await flushAsyncWork();
            await retrieve({ treeKey: 'Lead-ONLY' });

            expect(promptSpy).toHaveBeenCalledTimes(1);
            expect(postedNamed('validationRuleRetrieveState').at(-1)).toEqual({ command: 'validationRuleRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });

            // A RELOADED DOCUMENT IS TOLD THE RETRIEVE IS RUNNING
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(postedNamed('validationRuleRetrieveState')).toEqual([{ command: 'validationRuleRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }]);

            releasePrompt(PROD_ORG);
            await firstRetrieve;
            await flushAsyncWork();

            expect(retrieveCalls()).toHaveLength(1);
            expect(postedNamed('validationRuleRetrieveState').at(-1)).toEqual({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

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
            panel.openTroubleshootingTabs();
            return panel;
        };

        const retrieveButtonOf = (panel: ReturnType<typeof runPanelScript>, objectApiName = 'OtherChildObject__c') => panel.findAll(cardOf(panel, objectApiName), 'treeRetrieveValidationRules')[0];

        it('draws the button on every card with a folder and posts the tree key alone, never an org, even with one selected', () => {

            const panel = renderTrees();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });
            const retrieveButton = retrieveButtonOf(panel);

            expect(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL).toBe('Retrieve validation rules…');
            expect(panel.findAll(retrieveButton, 'actionCardTitle')[0].textContent).toBe('Retrieve validation rules…');
            expect(retrieveButton.disabled).toBe(false);
            expect(retrieveButtonOf(panel, 'Lead')).toBeDefined();

            retrieveButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'retrieveTreeValidationRules', treeKey: ACCOUNT_TREE_KEY });
            // ONE PER WINDOW: EVERY CARD'S BUTTON IS HELD UNTIL THE HOST SAYS THE RETRIEVE ENDED
            expect(retrieveButton.disabled).toBe(true);
            expect(retrieveButtonOf(panel, 'Lead').disabled).toBe(true);

            retrieveButton.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'retrieveTreeValidationRules')).toHaveLength(1);

            panel.postToPanel({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(retrieveButton.disabled).toBe(false);
            expect(retrieveButtonOf(panel, 'Lead').disabled).toBe(false);

        });

        it('is held while a retrieve, an insert or a permission set assignment runs, and says why, but never holds or is held by a scratch org run (#358)', () => {

            const panel = renderTrees();

            panel.postToPanel({ command: 'validationRuleRetrieveState', isRunning: true, treeKey: 'Lead-ONLY' });
            expect(retrieveButtonOf(panel).disabled).toBe(true);
            const newScratchButtons = panel.findAll(panel.cockpitBodyElement, 'dataOrgNewScratch');
            expect(newScratchButtons.length).toBeGreaterThan(0);
            newScratchButtons.forEach((newScratchButton: any) => expect(newScratchButton.disabled).toBe(false));
            expect(retrieveButtonOf(panel).attributes.title).toBe('Validation rules are being retrieved.');
            panel.postToPanel({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: 'Lead-ONLY' });

            panel.postToPanel({ command: 'scratchOrgState', isRunning: true });
            expect(retrieveButtonOf(panel).disabled).toBe(false);
            panel.postToPanel({ command: 'scratchOrgState', isRunning: false });

            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(retrieveButtonOf(panel).disabled).toBe(true);
            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            panel.postToPanel({ command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(retrieveButtonOf(panel, 'Lead').disabled).toBe(true);
            expect(retrieveButtonOf(panel, 'Lead').attributes.title).toBe('A tree is being inserted.');
            panel.postToPanel({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            expect(retrieveButtonOf(panel).disabled).toBe(false);
            expect(retrieveButtonOf(panel).attributes.title).toContain('from an org you choose in the command palette');

        });

    });

});
