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

import { AuthInfo, Org } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_ADAPTER_APPLY_RUNNING_REFUSAL,
    RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL,
    RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL,
    RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS,
    RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND,
    RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE,
    RECIPE_COCKPIT_RETRIEVE_ORG_BUSY_REFUSAL,
    RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS,
    RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL
} from '../RecipeCockpitService';
import { IMetadataDeploySummary } from '../RecipeCockpitMetadataDeploy';
import { MetadataRetrieveKind, RecipeCockpitMetadataRetrieve } from '../RecipeCockpitMetadataRetrieve';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #382: the Troubleshooting tab retrieves a tree's custom fields, record types and the global value
    sets its fields name, beside #326's validation rules, through ONE retrieve: fields and value sets
    named in a package.xml, record types listed in the org first and then named in one too (#401), the
    org asked for in the palette every time, nothing deployed, one retrieve per window whatever its kind.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_TREE_OBJECTS = ['Account', 'Contact', 'OtherChildObject__c'];
const PROD_USERNAME = 'admin@example.com';
const PROD_ORG = { targetOrgIdentifier: 'prod', username: PROD_USERNAME, alias: 'prod' };

// THE ACCOUNT TREE'S CUSTOM FIELDS OVER metadataDeployWorkspace: SIX WITH A READABLE FILE, Legacy_Code__c UNPARSEABLE, Regions__c WITH NONE
const ACCOUNT_RETRIEVE_FIELDS = [
    'Account.Annual_Budget__c', 'Account.Legacy_Code__c', 'Account.Rating__c', 'Account.Regions__c', 'Account.Sub_Rating__c',
    'OtherChildObject__c.Contact__c', 'OtherChildObject__c.Ratio__c', 'OtherChildObject__c.Score__c'
];

const invocation = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout: stdout, stderr: '', exitCode: 0, ...extra });

const retrievedFile = (type: string, fullName: string, extra: Record<string, unknown> = {}) => ({ fullName: fullName, type: type, state: 'Created', filePath: `/workspace/${fullName}`, ...extra });

const listedRecordType = (fullName: unknown) => ({ fullName: fullName, type: 'RecordType', id: '012000000000001' });

const buildRetrieveAnswer = (files: unknown[], overrides: Record<string, unknown> = {}) => JSON.stringify({
    status: 0,
    result: { done: true, status: 'Succeeded', success: true, files: files },
    warnings: [],
    ...overrides
});

const emptySummary = (overrides: Partial<IMetadataDeploySummary> = {}): IMetadataDeploySummary => ({
    customFields: [], standardFields: [], unreadableFields: [], globalValueSets: [], missingGlobalValueSets: [], recordTypes: [], customObjects: [], missingCustomObjects: [], unreadableCustomObjects: [], validationRules: [], skippedNameCount: 0, ...overrides
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, retrieving fields, record types and global value sets in the Troubleshooting tab (#382)', () => {

    describe('RecipeCockpitMetadataRetrieve', () => {

        it('lists record types with listMetadata on a connection, as validation rules are (#401, #498), and keeps only the tree\'s', async () => {

            const listedQueries: unknown[] = [];
            const notCancelled = { isCancellationRequested: false, onCancellationRequested: jest.fn() };

            expect(await RecipeCockpitMetadataRetrieve.listOrgMetadata(async () => ({ list: async (query: unknown) => {
                listedQueries.push(query);
                return [
                    listedRecordType('Account.Wholesale'),
                    listedRecordType('Account.Business'),
                    listedRecordType('Lead.Not_This_Tree'),
                    listedRecordType('Account.Bad Name'),
                    { fullName: 'Contact.Rule', type: 'ValidationRule' }
                ];
            } }), 'recordTypes', ACCOUNT_TREE_OBJECTS, 1000, notCancelled)).toEqual({
                kind: 'listed',
                components: [{ type: 'RecordType', member: 'Account.Business' }, { type: 'RecordType', member: 'Account.Wholesale' }],
                skippedCount: 1
            });
            expect(listedQueries).toEqual([{ type: 'RecordType' }]);

            expect(await RecipeCockpitMetadataRetrieve.listOrgMetadata(async () => ({ list: () => new Promise(() => undefined) }), 'recordTypes', ACCOUNT_TREE_OBJECTS, 5, notCancelled))
                .toEqual({ kind: 'unconfirmed', failureMessage: 'The listing did not finish in time and was stopped, so which record types the org holds is unknown.' });

            expect(RecipeCockpitMetadataRetrieve.buildRetrievePackageXml([{ type: 'RecordType', member: 'Account.Business' }])).toContain('<members>Account.Business</members>\n        <name>RecordType</name>');

        });

        it('counts the local file of each listed record type, and not one the org did not list', () => {

            const workspaceRoot = METADATA_DEPLOY_WORKSPACE_ROOT;

            expect(RecipeCockpitMetadataRetrieve.countLocalListedFiles(workspaceRoot, ['force-app'], 'recordTypes', ['Account.Business', 'account.partner', 'Account.Wholesale'])).toBe(2);
            expect(RecipeCockpitMetadataRetrieve.countLocalListedFiles(workspaceRoot, ['force-app'], 'recordTypes', ['Account.Wholesale'])).toBe(0);

        });

        it('retrieves fields and value sets through one --manifest, never one --metadata each, and holds the path to a package.xml inside the workspace', () => {

            const manifestPath = `treecipe/${ORG_OPERATIONS_FOLDER_NAME}/${PROD_USERNAME}/20261021-101500-field-retrieve-package.xml`;

            expect(RecipeCockpitMetadataRetrieve.buildManifestRetrieveArguments(manifestPath, PROD_USERNAME)).toEqual([
                'project', 'retrieve', 'start', '--json', '--target-org', PROD_USERNAME, '--manifest', manifestPath
            ]);
            ['/etc/package.xml', '../outside-package.xml', 'C:/x-package.xml', '-x-package.xml', 'treecipe/a\\b-package.xml', 'treecipe/notes.txt', '']
                .forEach(unplainPath => expect(() => RecipeCockpitMetadataRetrieve.buildManifestRetrieveArguments(unplainPath, PROD_USERNAME))
                    .toThrow('The package.xml path is not a plain path inside the workspace, so nothing was retrieved.'));
            expect(() => RecipeCockpitMetadataRetrieve.buildManifestRetrieveArguments(manifestPath, '--target-org')).toThrow();

        });

        it('builds no deploy argv and spells no deploy subcommand anywhere in the module', () => {

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitMetadataRetrieve.ts'), 'utf-8');

            expect(source).not.toMatch(/['"]deploy['"]/);
            expect(Object.getOwnPropertyNames(RecipeCockpitMetadataRetrieve).filter(propertyName => /deploy/i.test(propertyName))).toEqual([]);

        });

        it('names every custom field the tree writes, held here or not, and every value set those fields name, once each and sorted', () => {

            const summary = emptySummary({
                customFields: ['OtherChildObject__c.Score__c', 'Account.Rating__c'],
                unreadableFields: ['Account.Regions__c', 'Account.Rating__c', 'Account.Bad Name__c'],
                standardFields: ['Account.Name'],
                globalValueSets: ['Account_Ratings'],
                missingGlobalValueSets: ['Missing_Set', 'Not a name']
            });

            expect(RecipeCockpitMetadataRetrieve.listManifestComponents('fields', summary)).toEqual([
                { type: 'CustomField', member: 'Account.Rating__c' },
                { type: 'CustomField', member: 'Account.Regions__c' },
                { type: 'CustomField', member: 'OtherChildObject__c.Score__c' }
            ]);
            expect(RecipeCockpitMetadataRetrieve.listManifestComponents('globalValueSets', summary)).toEqual([
                { type: 'GlobalValueSet', member: 'Account_Ratings' },
                { type: 'GlobalValueSet', member: 'Missing_Set' }
            ]);
            expect(RecipeCockpitMetadataRetrieve.listManifestComponents('fields', emptySummary())).toEqual([]);

        });

        describe('countLocalFieldFiles', () => {

            let temporaryRoot: string;

            beforeEach(() => {
                temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-metadata-retrieve-count-'));
                fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, temporaryRoot, { recursive: true });
            });

            afterEach(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

            it('counts the named fields whose file the project holds, once each, and not a link planted in a field\'s place', () => {

                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app', 'unpackaged'], ACCOUNT_RETRIEVE_FIELDS)).toBe(7);
                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app'], ['account.Rating__c', 'Account.Rating__c'])).toBe(1);
                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app'], ['Lead.Nothing__c', 'no-dot'])).toBe(0);

                const fieldsFolder = path.join(temporaryRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields');
                fs.symlinkSync(path.join(fieldsFolder, 'Rating__c.field-meta.xml'), path.join(fieldsFolder, 'Linked__c.field-meta.xml'));
                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app'], ['Account.Linked__c'])).toBe(0);

            });

            it('matches a field file whatever its case, as the summary does, and lists no linked fields folder', () => {

                const fieldsFolder = path.join(temporaryRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields');
                fs.renameSync(path.join(fieldsFolder, 'Rating__c.field-meta.xml'), path.join(fieldsFolder, 'rating__C.field-meta.xml'));
                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app'], ['Account.Rating__c'])).toBe(1);

                const linkedObjectFolder = path.join(temporaryRoot, 'force-app', 'main', 'default', 'objects', 'Gizmo__c');
                fs.mkdirSync(linkedObjectFolder);
                fs.symlinkSync(fieldsFolder, path.join(linkedObjectFolder, 'fields'));
                expect(RecipeCockpitMetadataRetrieve.countLocalFieldFiles(temporaryRoot, ['force-app'], ['Gizmo__c.Rating__c'])).toBe(0);

            });

        });

        describe('listCustomFieldComponents', () => {

            it('names the same custom fields a summary does, without reading a file', () => {

                const readSpy = jest.spyOn(fs, 'readFileSync');
                expect(RecipeCockpitMetadataRetrieve.listCustomFieldComponents([
                    { objectApiName: 'Account', fieldApiNames: ['Rating__c', 'Name', 'Rating__c', 'bad name__c'] },
                    { objectApiName: 'Account', fieldApiNames: ['Active__c'] },
                    { objectApiName: 'not an object', fieldApiNames: ['Other__c'] }
                ])).toEqual([
                    { type: 'CustomField', member: 'Account.Active__c' },
                    { type: 'CustomField', member: 'Account.Rating__c' }
                ]);
                expect(readSpy).not.toHaveBeenCalled();

            });

        });

        describe('parseRetrieveOutput', () => {

            it('counts a field, value set or record type by its full name, only for what was asked', () => {

                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', invocation(buildRetrieveAnswer([
                    retrievedFile('CustomField', 'Account.Rating__c'),
                    retrievedFile('CustomField', 'account.rating__c', { state: 'Changed' }),
                    retrievedFile('CustomField', 'Account.Not_Asked__c'),
                    retrievedFile('CustomObject', 'Account')
                ])), ['Account.Rating__c', 'Account.Regions__c'])).toEqual({ kind: 'retrieved', componentCount: 1, namesWithComponents: ['Account.Rating__c'], failureMessages: [] });

                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('globalValueSets', invocation(buildRetrieveAnswer([
                    retrievedFile('GlobalValueSet', 'Account_Ratings'),
                    retrievedFile('GlobalValueSet', 'Missing_Set', { state: 'Failed', problemType: 'Error', error: 'Entity of type GlobalValueSet named Missing_Set cannot be found' })
                ])), ['Account_Ratings', 'Missing_Set'])).toEqual({
                    kind: 'retrieved',
                    componentCount: 1,
                    namesWithComponents: ['Account_Ratings'],
                    failureMessages: ['Missing_Set: Entity of type GlobalValueSet named Missing_Set cannot be found']
                });

                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('recordTypes', invocation(buildRetrieveAnswer([
                    retrievedFile('RecordType', 'Account.Business'),
                    retrievedFile('RecordType', 'Account.Partner'),
                    retrievedFile('RecordType', 'Lead.Not_This_Tree'),
                    retrievedFile('ValidationRule', 'Contact.Rule')
                ])), ['Account.Business', 'Account.Partner', 'Contact.Other'])).toEqual({ kind: 'retrieved', componentCount: 2, namesWithComponents: ['Account.Business', 'Account.Partner'], failureMessages: [] });

            });

            it('never reads a failed or unsuccessful answer as a retrieve, and names the kind when the CLI is missing or the answer unknown', () => {

                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', invocation(JSON.stringify({ status: 0, result: { success: false } })), ['Account.Rating__c']).kind).toBe('failed');
                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', invocation('not json'), ['Account.Rating__c']).kind).toBe('failed');
                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', invocation('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }), [])).toEqual({
                    kind: 'cliNotInstalled',
                    failureMessage: expect.stringContaining('The Salesforce CLI is required to retrieve custom fields')
                });
                expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('globalValueSets', invocation('', { timedOut: true }), [])).toEqual({
                    kind: 'unconfirmed',
                    failureMessage: 'The retrieve did not finish in time and was stopped, so which global value sets were retrieved is unknown.'
                });

            });

        });

        it('names the tree, the org, what is asked for, where new files go and what is overwritten in each kind\'s confirmation, each on one line', () => {

            const fieldsDetail = RecipeCockpitService.flattenConfirmContent(RecipeCockpitMetadataRetrieve.buildConfirmationContent('fields', 'Tree\nTwo', { alias: 'prod', username: PROD_USERNAME }, ACCOUNT_RETRIEVE_FIELDS, 'force-app', 7));
            expect(fieldsDetail).toContain('Tree: Tree Two');
            expect(fieldsDetail).toContain(`8 custom fields\n${ACCOUNT_RETRIEVE_FIELDS.join(', ')}`);
            expect(fieldsDetail).toContain('New field files are written under: force-app');
            expect(fieldsDetail).toContain('7 existing local field files for these fields will be overwritten with the org\'s version wherever the org holds the same field.');
            expect(fieldsDetail).toContain('Nothing is deployed.');
            expect(fieldsDetail).not.toMatch(/[()]/);

            const valueSetDetail = RecipeCockpitService.flattenConfirmContent(RecipeCockpitMetadataRetrieve.buildConfirmationContent('globalValueSets', 'T', { username: 'o' }, ['Account_Ratings'], 'force-app', 0));
            expect(valueSetDetail).toContain('1 global value set\nAccount_Ratings\n');
            expect(valueSetDetail).toContain('This project holds no global value set file for these value sets yet.');

            const recordTypeDetail = RecipeCockpitService.flattenConfirmContent(RecipeCockpitMetadataRetrieve.buildConfirmationContent('recordTypes', 'T', { username: 'o' }, ['Account.Business', 'Account.Wholesale'], 'force-app', 1));
            expect(recordTypeDetail).toContain('2 record types\nAccount.Business, Account.Wholesale');
            expect(recordTypeDetail).toContain('1 existing local record type file for these objects will be overwritten');

            const longList = Array.from({ length: 25 }, (_value, index) => `Account.Field${index}__c`);
            expect(RecipeCockpitService.flattenConfirmContent(RecipeCockpitMetadataRetrieve.buildConfirmationContent('fields', 'T', { username: 'o' }, longList, 'force-app', 0))).toContain('and 5 more');

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const newKinds: MetadataRetrieveKind[] = ['fields', 'recordTypes', 'globalValueSets'];

        it('routes each new retrieve by the tree KEY alone, never an org or a name the message carries', () => {

            newKinds.forEach(retrieveKind => {
                expect(RecipeCockpitService.routePanelMessage({ command: RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind], treeKey: ACCOUNT_TREE_KEY, orgIndex: 0, components: ['Evil'] } as any, buildPanelState()))
                    .toEqual({ kind: 'retrieveTreeMetadata', treeKey: ACCOUNT_TREE_KEY, retrieveKind: retrieveKind });
            });

        });

        it('gives the button back for a card not drawn, and refuses with a reason while an insert, an assignment or a deploy runs', () => {

            newKinds.forEach(retrieveKind => {

                const command = RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind];
                const notRunning = { command: 'metadataRetrieveState', isRunning: false, treeKey: 'Other', retrieveKind: retrieveKind };

                expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: 'Other' } as any, buildPanelState()))
                    .toEqual({ kind: 'refuseMetadataRetrieve', hostMessage: notRunning });

                [
                    (panelState: IRecipeCockpitPanelState) => { panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY } as any; },
                    (panelState: IRecipeCockpitPanelState) => { panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; },
                    (panelState: IRecipeCockpitPanelState) => { panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }; }
                ].forEach(makeBusy => {
                    const panelState = buildPanelState();
                    makeBusy(panelState);
                    expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: ACCOUNT_TREE_KEY } as any, panelState))
                        .toEqual({ kind: 'refuseMetadataRetrieve', refusalText: RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL, hostMessage: { ...notRunning, treeKey: ACCOUNT_TREE_KEY } });
                });

            });

        });

        it('runs one retrieve per window whatever its kind, and holds every deploy while one runs', () => {

            const panelState = buildPanelState();
            const runningState = { command: 'metadataRetrieveState' as const, isRunning: true, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'fields' as const };
            panelState.metadataRetrieveStateMessage = runningState;

            ['retrieveTreeValidationRules', 'retrieveTreeFields', 'retrieveTreeRecordTypes', 'retrieveTreeGlobalValueSets'].forEach(command => {
                expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: ACCOUNT_TREE_KEY } as any, panelState))
                    .toEqual({ kind: 'refuseMetadataRetrieve', hostMessage: runningState });
            });

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY } as any, panelState))
                .toMatchObject({ kind: 'refuseMetadataDeploy', refusalText: RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL });

        });

    });

    describe('the host, against a faked org prompt and Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let retrievedManifests: string[];
        let listHandler: (query: { type: string }) => unknown;
        let listedQueries: { username: string; query: unknown }[];
        let retrieveHandler: (argumentList: string[]) => { stdout: string; error?: unknown };
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let promptSpy: jest.Mock;
        let modalAnswer: string | undefined;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const retrieveCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const warningCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls;
        const modalCalls = () => warningCalls().filter(([, options]) => options?.inPanel);
        const notifications = () => [
            ...(vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([text, ...actions]) => ({ severity: 'information', text: text, actions: actions })),
            ...warningCalls()
                .filter(([, options]) => !( options && typeof options === 'object' && options.inPanel ))
                .map(([text, ...actions]) => ({ severity: 'warning', text: text, actions: actions }))
        ];
        const manifestMembers = (manifest: string) => [...manifest.matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const retrieve = async (retrieveKind: MetadataRetrieveKind) => {
            await receivedMessageHandler({ command: RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind], treeKey: ACCOUNT_TREE_KEY });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-metadata-retrieve-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');

            SalesforceOrgService.clearConnectedOrgStatusCache();
            RecipeCockpitService.clearTroubleshootingSummaries();
            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            (RecipeCockpitService as any).metadataRetrieveRunStateMessage = undefined;
            (RecipeCockpitService as any).isMetadataDeployInFlight = false;
            (RecipeCockpitService as any).metadataDeployRunStateMessage = undefined;
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = false;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            retrievedManifests = [];
            modalAnswer = RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL;
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([]) });
            listHandler = () => ([listedRecordType('Account.Business'), listedRecordType('Account.Partner'), listedRecordType('Account.Wholesale'), listedRecordType('Lead.Not_This_Tree')]);

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], execOptions: any, callback: any) => {
                cliCalls.push(argumentList);
                const manifestIndex = argumentList.indexOf('--manifest');
                if ( manifestIndex !== -1 ) {
                    retrievedManifests.push(fs.readFileSync(path.join(execOptions.cwd, argumentList[manifestIndex + 1]), 'utf-8'));
                }
                const cliAnswer = argumentList[0] === 'org' && argumentList[1] === 'list' ? { stdout: JSON.stringify(SF_ORG_LIST) }
                    : retrieveHandler(argumentList);
                setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                return { kill: jest.fn() };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS);

            // #498: THE LISTING IS listMetadata ON A CONNECTION OPENED BY USERNAME, NOT A CLI
            listedQueries = [];
            (Org.create as jest.Mock).mockReset();
            (Org.create as jest.Mock).mockImplementation(async ({ aliasOrUsername }: { aliasOrUsername: string }) => ({
                getConnection: () => ({ metadata: { list: async (query: { type: string }) => {
                    listedQueries.push({ username: aliasOrUsername, query: query });
                    return listHandler(query);
                } } })
            }));

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.inPanel ? modalAnswer : undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
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
            // #480: THE ORG COMES FROM resolveSelectedReadOrg (THE SELECTION, OR A PROMPT WHEN THERE IS NONE); ITS OWN TESTS ARE IN RecipeCockpitMetadataRetrieve.test.ts
            promptSpy = jest.fn().mockResolvedValue(PROD_ORG);
            jest.spyOn(RecipeCockpitService as any, 'resolveSelectedReadOrg').mockImplementation((...resolveArguments: unknown[]) => promptSpy(resolveArguments[3]));

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('retrieves the tree\'s custom fields, held here or not, through a written package.xml, after naming them and the files they overwrite', async () => {

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([
                retrievedFile('CustomField', 'Account.Rating__c'),
                retrievedFile('CustomField', 'Account.Regions__c')
            ]) });
            await openCockpit();

            await retrieve('fields');

            expect(promptSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS.fields);

            const [modalMessage, modalOptions] = modalCalls()[0];
            expect(modalMessage).toBe(`Retrieve 8 custom fields of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}?`);
            expect(modalOptions.detail).toContain(`8 custom fields\n${ACCOUNT_RETRIEVE_FIELDS.join(', ')}`);
            expect(modalOptions.detail).toContain('7 existing local field files for these fields will be overwritten');

            expect(retrieveCalls()).toHaveLength(1);
            const [retrieveArgv] = retrieveCalls();
            expect(retrieveArgv.slice(0, 7)).toEqual(['project', 'retrieve', 'start', '--json', '--target-org', PROD_USERNAME, '--manifest']);
            expect(retrieveArgv[7]).toMatch(new RegExp(`^treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Account-thru-OtherChildObject__c/RunArtifacts/${ORG_OPERATIONS_FOLDER_NAME}/admin@example\\.com/\\d{8}-\\d{6}-field-retrieve-package\\.xml$`));
            expect(retrieveArgv).not.toContain('--metadata');
            expect(cliCalls.some(argumentList => argumentList.includes('deploy'))).toBe(false);

            expect([...retrievedManifests[0].matchAll(/<name>([^<]*)<\/name>/g)].map(match => match[1])).toEqual(['CustomField']);
            expect(manifestMembers(retrievedManifests[0])).toEqual(ACCOUNT_RETRIEVE_FIELDS);
            expect(retrievedManifests[0]).toContain('<version>64.0</version>');

            expect(notifications()).toEqual([{
                severity: 'information',
                text: `Retrieved 2 of the 8 custom fields of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}. Generate Treecipe writes them into the recipe.`,
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL]
            }]);
            expect(postedNamed('metadataRetrieveState')).toEqual([
                { command: 'metadataRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'fields' },
                { command: 'metadataRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'fields' }
            ]);

            const resultFiles = fs.readdirSync(path.join(path.resolve(workspaceRoot), 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME, PROD_USERNAME));
            expect(resultFiles.filter(fileName => fileName.endsWith('-field-retrieve.json'))).toHaveLength(1);
            // THE COUNTS THE CARDS DRAW ARE READ AGAIN AFTER A RETRIEVE
            expect(postedNamed('troubleshootingSummary').length).toBeGreaterThanOrEqual(1);

        });

        it('retrieves every global value set the tree\'s fields name, held here or not, and names those that came back', async () => {

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([retrievedFile('GlobalValueSet', 'Account_Ratings')]) });
            await openCockpit();

            await retrieve('globalValueSets');

            expect(promptSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS.globalValueSets);
            expect(modalCalls()[0][0]).toBe(`Retrieve 2 global value sets of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}?`);
            expect(modalCalls()[0][1].detail).toContain('1 existing local global value set file for these value sets will be overwritten');
            expect(manifestMembers(retrievedManifests[0])).toEqual(['Account_Ratings', 'Missing_Set']);
            expect(retrieveCalls()[0][7]).toMatch(/-global-value-set-retrieve-package\.xml$/);
            expect(notifications()).toEqual([{
                severity: 'information',
                text: `Retrieved 1 of the 2 global value sets of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}: Account_Ratings. Generate Treecipe writes them into the recipe.`,
                actions: [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL]
            }]);

        });

        it('lists every record type of each tree object in the org, retrieves them by name through a package.xml, and counts the files it overwrites (#401)', async () => {

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([retrievedFile('RecordType', 'Account.Business'), retrievedFile('RecordType', 'Account.Wholesale')]) });
            await openCockpit();

            await retrieve('recordTypes');

            expect(promptSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS.recordTypes);
            expect(modalCalls()[0][0]).toBe(`Retrieve 3 record types of 3 objects of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}?`);
            expect(modalCalls()[0][1].detail).toContain('3 record types\nAccount.Business, Account.Partner, Account.Wholesale');
            expect(modalCalls()[0][1].detail).toContain('2 existing local record type files for these objects will be overwritten');
            expect(listedQueries).toEqual([{ username: PROD_USERNAME, query: { type: 'RecordType' } }]);
            expect(retrieveCalls()).toHaveLength(1);
            expect(retrieveCalls()[0]).not.toContain('--metadata');
            expect(retrieveCalls()[0][retrieveCalls()[0].indexOf('--manifest') + 1]).toMatch(/-record-type-retrieve-package\.xml$/);
            expect(retrievedManifests).toHaveLength(1);
            expect(retrievedManifests[0]).toContain([
                '        <members>Account.Business</members>',
                '        <members>Account.Partner</members>',
                '        <members>Account.Wholesale</members>',
                '        <name>RecordType</name>'
            ].join('\n'));
            expect(notifications()[0].text).toBe(`Retrieved 2 record types for 1 of 3 objects of Account-thru-OtherChildObject__c from prod · ${PROD_USERNAME}: Account. Generate Treecipe can then use them in the recipe.`);

        });

        it('writes each retrieve\'s summary for the History once a CLI has run, the listing included, and none for a quiet cancel (#485)', async () => {

            const operationsFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', ACCOUNT_TREE_KEY, 'RunArtifacts', 'OrgOperations', PROD_USERNAME);
            const summaries = () => ( fs.existsSync(operationsFolderPath) ? fs.readdirSync(operationsFolderPath) : [] )
                .filter(fileName => /-summary(-\d+)?\.json$/.test(fileName))
                .sort()
                .map(fileName => JSON.parse(fs.readFileSync(path.join(operationsFolderPath, fileName), 'utf-8')));

            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([retrievedFile('RecordType', 'Account.Business'), retrievedFile('RecordType', 'Account.Wholesale')]) });
            await openCockpit();

            modalAnswer = undefined;
            await retrieve('recordTypes');
            // THE LISTING RAN, BUT A DISMISSED CONFIRMATION CHANGED NOTHING: NO ROW
            expect(summaries()).toEqual([]);

            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            modalAnswer = RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL;
            await retrieve('recordTypes');

            const landed = summaries().find(summary => summary.outcome === 'succeeded');
            expect(landed).toEqual(expect.objectContaining({ step: 'record-type-retrieve', orgUsername: PROD_USERNAME, succeededCount: 2 }));
            expect(landed.fileNames).toEqual([
                expect.stringMatching(/^\d{8}-\d{6}-record-type-retrieve-package\.xml$/),
                expect.stringMatching(/^\d{8}-\d{6}-record-type-retrieve\.json$/)
            ]);

            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            listHandler = () => { throw new Error('No authorization'); };
            await retrieve('recordTypes');

            expect(summaries().map(summary => summary.outcome).sort()).toEqual(['failed', 'succeeded']);

            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            (Org.create as jest.Mock).mockRejectedValueOnce(new Error('No authorization'));
            await retrieve('recordTypes');

            expect(summaries().map(summary => summary.outcome).sort()).toEqual(['failed', 'failed', 'succeeded']);

            // EVERY RECORD TYPE CAME BACK FAILED: NOTHING WAS RETRIEVED, SO THE STEP FAILED RATHER THAN PARTLY SUCCEEDED
            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            listHandler = () => ([listedRecordType('Account.Business')]);
            retrieveHandler = () => ({ stdout: buildRetrieveAnswer([retrievedFile('RecordType', 'Account.Business', { state: 'Failed', problemType: 'Error', error: 'Not found' })]) });
            await retrieve('recordTypes');

            expect(summaries().map(summary => summary.outcome).sort()).toEqual(['failed', 'failed', 'failed', 'succeeded']);
            expect(summaries().find(summary => summary.failedCount === 1)).toEqual(expect.objectContaining({ outcome: 'failed', succeededCount: 0 }));

        });

        describe('the org it reads from: the Target Org Manager selection (#480)', () => {

            const QA_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com', alias: 'qa' };
            const panelState = () => (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
            let selectPromptSpy: jest.SpyInstance;

            beforeEach(() => {
                jest.spyOn(RecipeCockpitService as any, 'resolveSelectedReadOrg').mockRestore();
                selectPromptSpy = jest.spyOn(RecipeCockpitService as any, 'promptAndSelectDataOrg').mockImplementation(async (...promptArguments: any[]) => {
                    expect((promptArguments[1] as IRecipeCockpitPanelState).isOrgPromptOpen).toBeTrue();
                    (promptArguments[1] as IRecipeCockpitPanelState).dataOrgSelection = { orgIndex: 1, orgDetail: PROD_ORG } as any;
                    return true;
                });
            });

            it('retrieves from the org selected, of any type, asking nothing, and offers "Change org…" that starts the same retrieve again', async () => {

                retrieveHandler = () => ({ stdout: buildRetrieveAnswer([retrievedFile('CustomField', 'Account.Rating__c')]) });
                await openCockpit();
                panelState().dataOrgSelection = { orgIndex: 0, orgDetail: QA_ORG, orgTypeDetail: { isSandbox: false } } as any;

                await retrieve('fields');

                expect(selectPromptSpy).not.toHaveBeenCalled();
                expect(retrieveCalls()[0].slice(4, 6)).toEqual(['--target-org', 'qa@example.com']);

                const [title, confirmOptions] = (RecipeCockpitService.confirmInPanel as unknown as jest.Mock).mock.calls[0];
                expect(title).toBe('Retrieve 8 custom fields of Account-thru-OtherChildObject__c from qa · qa@example.com?');
                expect(confirmOptions.org).toEqual({ alias: 'qa', username: 'qa@example.com' });
                expect(confirmOptions.summary.join('\n')).not.toContain('Org:');
                expect(confirmOptions.changeOrg).toEqual({ restartMessage: { command: 'retrieveTreeFields', treeKey: ACCOUNT_TREE_KEY }, isSandboxOnly: false });

            });

            it('asks once when none is selected, over the Target Org Manager listing with no sandbox rule, and the pick becomes the selection', async () => {

                await openCockpit();
                panelState().dataOrgSelection = undefined;

                await retrieve('recordTypes');
                await retrieve('validationRules');

                expect(selectPromptSpy).toHaveBeenCalledTimes(1);
                const promptArguments = selectPromptSpy.mock.calls[0];
                expect(promptArguments.slice(4)).toEqual([RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS.recordTypes, 'Nothing was retrieved']);
                expect(panelState().isOrgPromptOpen).toBeFalse();
                expect(listedQueries.map(listedQuery => listedQuery.username)).toEqual([PROD_USERNAME, PROD_USERNAME]);

            });

            it('retrieves nothing from a selection no connection could be opened to, and says how to fix it', async () => {

                await openCockpit();
                panelState().dataOrgSelection = { orgIndex: 0, orgDetail: QA_ORG, isConnectionFailed: true } as any;

                await retrieve('fields');

                expect(selectPromptSpy).not.toHaveBeenCalled();
                expect(retrieveCalls()).toEqual([]);
                expect(notifications().map(notification => notification.text)).toEqual([`Nothing was retrieved: qa could not be connected to. ${RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE}`]);

            });

            it('asks nothing, and retrieves nothing, when none is selected and another run holds the selection', async () => {

                await openCockpit();
                panelState().dataOrgSelection = undefined;
                panelState().scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true } as any;

                await retrieve('fields');

                expect(selectPromptSpy).not.toHaveBeenCalled();
                expect(retrieveCalls()).toEqual([]);
                expect(notifications().map(notification => notification.text)).toEqual([RECIPE_COCKPIT_RETRIEVE_ORG_BUSY_REFUSAL]);

            });

            it('is a quiet cancel when the pick is dismissed', async () => {

                await openCockpit();
                panelState().dataOrgSelection = undefined;
                selectPromptSpy.mockResolvedValueOnce(false);

                await retrieve('fields');

                expect(retrieveCalls()).toEqual([]);
                expect(modalCalls()).toEqual([]);
                expect(notifications()).toEqual([]);

            });

            it('never opens the command palette list of every connected org', async () => {

                const paletteSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg');
                await openCockpit();
                panelState().dataOrgSelection = undefined;

                for ( const retrieveKind of ['validationRules', 'fields', 'recordTypes', 'globalValueSets'] as MetadataRetrieveKind[] ) {
                    await retrieve(retrieveKind);
                }

                expect(paletteSpy).not.toHaveBeenCalled();

            });

        });

        it('refuses before any org prompt when the tree has nothing of that kind to ask for', async () => {

            await openCockpit();
            const summarizeSpy = jest.spyOn(require('../RecipeCockpitMetadataDeploy').RecipeCockpitMetadataDeploy, 'summarizeTreeMetadata').mockResolvedValue(emptySummary());
            jest.spyOn(RecipeCockpitMetadataRetrieve, 'listCustomFieldComponents').mockReturnValue([]);

            await retrieve('fields');
            await retrieve('globalValueSets');

            expect(summarizeSpy).toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(retrieveCalls()).toEqual([]);
            expect(notifications().map(notification => notification.text)).toEqual([
                'Account-thru-OtherChildObject__c has no custom field to retrieve, so nothing was retrieved.',
                'No field of Account-thru-OtherChildObject__c names a global value set, so nothing was retrieved.'
            ]);

        });

        it('is a quiet cancel when the org pick or the confirmation is dismissed, and writes no package.xml', async () => {

            await openCockpit();
            const summarizeSpy = jest.spyOn(require('../RecipeCockpitMetadataDeploy').RecipeCockpitMetadataDeploy, 'summarizeTreeMetadata');
            const summaryRefreshSpy = jest.spyOn(RecipeCockpitService as any, 'refreshTroubleshootingSummary');
            const ruleListRefreshSpy = jest.spyOn(RecipeCockpitService as any, 'refreshTreeValidationRules');

            promptSpy.mockResolvedValueOnce(undefined);
            await retrieve('fields');
            expect(summarizeSpy).not.toHaveBeenCalled();
            modalAnswer = undefined;
            await retrieve('globalValueSets');

            // NOTHING RAN, SO NOTHING IS READ AGAIN: THE VALUE SET READ BEFORE THE PROMPT IS THE ONLY ONE
            expect(summarizeSpy).toHaveBeenCalledTimes(1);
            expect(summaryRefreshSpy).not.toHaveBeenCalled();
            expect(ruleListRefreshSpy).not.toHaveBeenCalled();
            expect(retrieveCalls()).toEqual([]);
            expect(notifications()).toEqual([]);
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME, PROD_USERNAME))).toBe(false);
            expect(postedNamed('metadataRetrieveState').at(-1)).toEqual({ command: 'metadataRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'globalValueSets' });

        });

        it('retrieves nothing when the package.xml cannot be written into the tree\'s RunArtifacts folder (#470)', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', ACCOUNT_TREE_KEY, 'RunArtifacts'), 'a file where the folder goes');
            await openCockpit();
            await retrieve('fields');

            expect(retrieveCalls()).toEqual([]);
            expect(notifications().at(-1)).toEqual({ severity: 'warning', text: 'No custom fields were retrieved: the package.xml could not be written under the tree\'s RunArtifacts folder in this workspace.', actions: [] });

        });

        it('warns with View output and no Generate Treecipe when the CLI fails, and still offers Generate Treecipe when the outcome is unknown', async () => {

            await openCockpit();

            retrieveHandler = () => ({ stdout: '{"status":1,"name":"NoOrgFound","message":"No authorization"}', error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await retrieve('fields');
            expect(notifications().at(-1)).toMatchObject({ severity: 'warning', text: expect.stringContaining('No custom fields were retrieved from prod'), actions: ['View output'] });

            retrieveHandler = () => ({ stdout: '', error: Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) });
            (RecipeCockpitService as any).isMetadataRetrieveInFlight = false;
            await retrieve('recordTypes');
            expect(notifications().at(-1)).toMatchObject({ severity: 'warning', text: 'The Salesforce CLI\'s answer was too large to read, so which record types were retrieved is unknown.' });
            expect(notifications().at(-1)!.actions).toContain(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL);

        });

        it('starts no retrieve when a deploy started while the prompt or the confirmation was open', async () => {

            await openCockpit();
            promptSpy.mockImplementationOnce(async () => { (RecipeCockpitService as any).isMetadataDeployInFlight = true; return PROD_ORG; });

            await retrieve('fields');

            expect(retrieveCalls()).toEqual([]);
            expect(notifications()).toEqual([{ severity: 'warning', text: RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL, actions: [] }]);

        });

        it('starts no retrieve when an Apply of retrieved files started while the prompt or the confirmation was open', async () => {

            await openCockpit();
            promptSpy.mockImplementationOnce(async () => {
                (RecipeCockpitService as any).recipeCockpitPanelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'Account-thru-OtherChildObject__c', runKind: 'apply' };
                return PROD_ORG;
            });

            await retrieve('fields');

            expect(retrieveCalls()).toEqual([]);
            expect(notifications()).toEqual([{ severity: 'warning', text: RECIPE_COCKPIT_ADAPTER_APPLY_RUNNING_REFUSAL, actions: [] }]);

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

        const summary = (overrides: Record<string, unknown> = {}) => ({
            command: 'troubleshootingSummary', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY,
            permissionSetCount: 1, customFieldCount: 6, standardFieldCount: 1, unreadableFieldCount: 2,
            globalValueSetCount: 1, missingGlobalValueSetCount: 1, recordTypeCount: 2, ...overrides
        });

        const retrieveCardOf = (panel: ReturnType<typeof runPanelScript>, retrieveKind: string, objectApiName = 'OtherChildObject__c') =>
            panel.findAll(cardOf(panel, objectApiName), `troubleshootingRetrieve-${retrieveKind}`)[0];
        const partOf = (panel: ReturnType<typeof runPanelScript>, cardElement: any, className: string) => panel.findAll(cardElement, className)[0];

        it('draws a 📥 card beside each section\'s deploy, with its why line and what it would ask for, and posts the tree key alone', () => {

            const panel = renderTrees();
            panel.postToPanel(summary());

            ([['fields', 'Fields'], ['recordTypes', 'Record Types'], ['globalValueSets', 'Global Value Sets']] as const).forEach(([retrieveKind]) => {

                const retrieveCard = retrieveCardOf(panel, retrieveKind);
                expect(retrieveCard.className).toBe(`sdtButton sdtButton-card actionCard troubleshootingRetrieve troubleshootingRetrieve-${retrieveKind}`);
                expect(retrieveCard.parentNode.parentNode.parentNode.parentNode.classList.contains(`troubleshootingSubPanel-${retrieveKind}`)).toBe(true);
                expect(partOf(panel, retrieveCard, 'actionCardEmoji').textContent).toBe('📥');
                expect(partOf(panel, retrieveCard, 'actionCardTitle').textContent).toBe(RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS[retrieveKind]);
                expect(partOf(panel, retrieveCard, 'actionCardWhy').textContent).toBe(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS[`retrieve${retrieveKind[0].toUpperCase()}${retrieveKind.slice(1)}` as keyof typeof RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS].why);
                expect(retrieveCard.disabled).toBe(false);

                retrieveCard.dispatch('click');
                expect(panel.postedHostMessages.at(-1)).toEqual({ command: RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind], treeKey: ACCOUNT_TREE_KEY });
                panel.postToPanel({ command: 'metadataRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, retrieveKind: retrieveKind });

            });

            expect(partOf(panel, retrieveCardOf(panel, 'fields'), 'actionCardDetail').textContent).toBe('8 custom fields; 6 with a source file here.');
            expect(partOf(panel, retrieveCardOf(panel, 'globalValueSets'), 'actionCardDetail').textContent).toBe('2 named value sets; 1 held here.');
            expect(partOf(panel, retrieveCardOf(panel, 'recordTypes'), 'actionCardDetail').textContent).toBe('3 objects, each asked for every record type the org holds.');

        });

        it('holds a field or value set card until the counts arrive, and disables it with the reason when there is nothing to ask for', () => {

            const panel = renderTrees();

            expect(retrieveCardOf(panel, 'fields').disabled).toBe(true);
            expect(retrieveCardOf(panel, 'globalValueSets').attributes.title).toBe('Reading this project…');
            // RECORD TYPES ARE ASKED PER OBJECT, SO THEY NEED NO COUNT
            expect(retrieveCardOf(panel, 'recordTypes').disabled).toBe(false);

            panel.postToPanel(summary({ customFieldCount: 0, unreadableFieldCount: 0, globalValueSetCount: 0, missingGlobalValueSetCount: 0 }));

            expect(retrieveCardOf(panel, 'fields').disabled).toBe(true);
            expect(partOf(panel, retrieveCardOf(panel, 'fields'), 'actionCardReason').textContent).toBe('This tree has no custom field to retrieve.');
            expect(partOf(panel, retrieveCardOf(panel, 'globalValueSets'), 'actionCardReason').textContent).toBe('No field of this tree names a global value set.');

            retrieveCardOf(panel, 'fields').dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'retrieveTreeFields')).toEqual([]);

            // A PROJECT THE DEPLOY SUMMARY CANNOT READ IS NAMED AS A RETRIEVE ON A RETRIEVE CARD
            panel.postToPanel(summary({ failureMessage: 'Nothing can be deployed: sfdx-project.json could not be parsed.' }));
            expect(partOf(panel, retrieveCardOf(panel, 'globalValueSets'), 'actionCardDetail').textContent).toBe('Nothing can be retrieved: sfdx-project.json could not be parsed.');
            expect(retrieveCardOf(panel, 'globalValueSets').disabled).toBe(true);

        });

        it('reads "Retrieving…" on the clicked card only, and holds every retrieve and deploy of every card until the host says it ended', () => {

            const panel = renderTrees();
            panel.postToPanel(summary());
            panel.postToPanel(summary({ treeKey: 'Lead-ONLY' }));

            retrieveCardOf(panel, 'fields').dispatch('click');

            expect(partOf(panel, retrieveCardOf(panel, 'fields'), 'actionCardTitle').textContent).toBe('Retrieving…');
            expect(partOf(panel, retrieveCardOf(panel, 'recordTypes'), 'actionCardTitle').textContent).toBe(RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS.recordTypes);
            expect(retrieveCardOf(panel, 'recordTypes').disabled).toBe(true);
            expect(retrieveCardOf(panel, 'fields', 'Lead').disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treeRetrieveValidationRules')[0].disabled).toBe(true);
            const deployCard = panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'troubleshootingDeploy-fields')[0];
            expect(deployCard.disabled).toBe(true);
            expect(partOf(panel, deployCard, 'actionCardReason').textContent).toBe('Metadata is being retrieved.');

            // A RELOADED DOCUMENT IS TOLD WHICH CARD IS RUNNING
            panel.postToPanel({ command: 'metadataRetrieveState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'globalValueSets' });
            expect(partOf(panel, retrieveCardOf(panel, 'globalValueSets'), 'actionCardTitle').textContent).toBe('Retrieving…');
            expect(partOf(panel, retrieveCardOf(panel, 'fields'), 'actionCardTitle').textContent).toBe(RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS.fields);

            panel.postToPanel({ command: 'metadataRetrieveState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, retrieveKind: 'globalValueSets' });

            expect(retrieveCardOf(panel, 'fields').disabled).toBe(false);
            expect(deployCard.disabled).toBe(false);
            expect(partOf(panel, retrieveCardOf(panel, 'globalValueSets'), 'actionCardTitle').textContent).toBe(RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS.globalValueSets);

        });

    });

});
