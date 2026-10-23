import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
        showTextDocument: jest.fn(),
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
    Org: { create: jest.fn() },
    SfError: class SfError extends Error {}
}));

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn(), exec: jest.fn() }));

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_NOT_GENERATED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE,
    RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL,
    RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATE_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATING_LABEL
} from '../RecipeCockpitService';
import { IUpdateObjectDescribe, IUpdateRequestRecord, RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, RecipeCockpitRecordUpdate } from '../RecipeCockpitRecordUpdate';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const OTHER_SANDBOX_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const ACCOUNT_DESCRIBE: IUpdateObjectDescribe = {
    objectApiName: 'Account',
    isUpdateable: true,
    fields: [
        { fieldApiName: 'Legacy_Code__c', isUpdateable: true, isCalculated: false },
        { fieldApiName: 'Formula_Code__c', isUpdateable: false, isCalculated: true },
        { fieldApiName: 'Locked_Code__c', isUpdateable: false, isCalculated: false }
    ]
};

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, the Treecipe Adapter\'s update (#418)', () => {

    describe('RecipeCockpitRecordUpdate', () => {

        let temporaryRoot: string;

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-record-update-'));
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('imports no vscode', () => {

            const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRecordUpdate.ts'), 'utf8');
            expect(source).not.toMatch(/from 'vscode'/);

        });

        it.each([
            ['an object the org could not describe', ['Legacy_Code__c'], undefined, 'NOT_FOUND: no such object', 'Account could not be described in the org: NOT_FOUND: no such object.'],
            ['an object the org could not describe, with no reason given', ['Legacy_Code__c'], undefined, undefined, 'Account could not be described in the org.'],
            ['an object the user cannot update', ['Legacy_Code__c'], { ...ACCOUNT_DESCRIBE, isUpdateable: false }, undefined, 'Account records cannot be updated by this user in the org.'],
            ['a field the org does not have', ['Gone__c'], ACCOUNT_DESCRIBE, undefined, 'Account.Gone__c is not in the org. Deploy it first from Troubleshooting → Fields.'],
            ['a calculated field', ['Formula_Code__c'], ACCOUNT_DESCRIBE, undefined, 'Account.Formula_Code__c is calculated in the org, so it cannot be updated.'],
            ['a field the user cannot update', ['Locked_Code__c'], ACCOUNT_DESCRIBE, undefined, 'Account.Locked_Code__c cannot be updated by this user in the org.']
        ])('gives a reason for %s, never a default', (_description, fieldApiNames, describe, describeFailureMessage, expectedReason) => {

            expect(RecipeCockpitRecordUpdate.findUpdateReason('Account', fieldApiNames, describe, describeFailureMessage)).toBe(expectedReason);

        });

        it('passes a field the org lets the user update, whatever the case of its name', () => {

            expect(RecipeCockpitRecordUpdate.findUpdateReason('Account', ['legacy_code__C'], ACCOUNT_DESCRIBE)).toBeUndefined();

        });

        it('sends the type, the Id and only the fields being updated, a field with no value as null', () => {

            expect(RecipeCockpitRecordUpdate.buildRequestRecords('Account', ['Legacy_Code__c', 'Rating__c'], [
                { recordId: '001A', fieldValues: { Legacy_Code__c: 'NEW', Rating__c: 'Hot', Other__c: 'never sent' } },
                { recordId: '001B', fieldValues: { Legacy_Code__c: 'NEW-B' } }
            ])).toEqual([
                { attributes: { type: 'Account' }, Id: '001A', Legacy_Code__c: 'NEW', Rating__c: 'Hot' },
                { attributes: { type: 'Account' }, Id: '001B', Legacy_Code__c: 'NEW-B', Rating__c: null }
            ]);

        });

        it('splits records into requests of at most 200', () => {

            const records = Array.from({ length: 450 }, (_value, recordIndex) => recordIndex);
            expect(RecipeCockpitRecordUpdate.splitIntoRequests(records).map(request => request.length)).toEqual([200, 200, 50]);
            expect(RecipeCockpitRecordUpdate.splitIntoRequests([])).toEqual([]);

        });

        it('reads the org\'s answer per record, and an answer it cannot read as a failure of every record', () => {

            const requestRecords: IUpdateRequestRecord[] = [
                { attributes: { type: 'Account' }, Id: '001A' },
                { attributes: { type: 'Account' }, Id: '001B' }
            ];

            expect(RecipeCockpitRecordUpdate.readRequestResults(requestRecords, [
                { id: '001A', success: true, errors: [] },
                { id: '001B', success: false, errors: [{ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'bad value', fields: ['Rating__c', 7] }, null] }
            ])).toEqual([
                { recordId: '001A', isSuccess: true, errors: [] },
                { recordId: '001B', isSuccess: false, errors: [
                    { statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'bad value', fields: ['Rating__c'] },
                    { statusCode: 'UNKNOWN', message: '', fields: [] }
                ] }
            ]);

            // AN ANSWER IT CANNOT READ SAYS NOTHING ABOUT WHETHER THE ORG SAVED THE RECORD: A FAILURE, AND UNCERTAIN
            [undefined, {}, [{ success: true }], ['yes', null]].forEach(unreadableAnswer => {
                const results = RecipeCockpitRecordUpdate.readRequestResults(requestRecords, unreadableAnswer);
                expect(results.every(result => !result.isSuccess && result.isUncertain === true)).toBe(true);
            });

            expect(RecipeCockpitRecordUpdate.readRequestResults(requestRecords, [{ success: 'true' }, { success: true }]).map(result => result.isSuccess)).toEqual([false, true]);

            expect(RecipeCockpitRecordUpdate.failRequestRecords(requestRecords, 'socket hang up')).toEqual([
                { recordId: '001A', isSuccess: false, errors: [{ statusCode: 'REQUEST_FAILED', message: 'socket hang up', fields: [] }], isUncertain: true },
                { recordId: '001B', isSuccess: false, errors: [{ statusCode: 'REQUEST_FAILED', message: 'socket hang up', fields: [] }], isUncertain: true }
            ]);

        });

        it('snapshots each updated field\'s old value from the loaded records, a field matched whatever its case and one not read as null', () => {

            const snapshotObject = RecipeCockpitRecordUpdate.buildSnapshotObject('Account', ['Legacy_Code__c', 'Rating__c'], [
                { attributes: { type: 'Account' }, Id: '001A', legacy_code__c: 'OLD', Rating__c: null },
                { Id: '001B' }
            ]);

            expect(snapshotObject).toEqual({
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
                records: [
                    { recordId: '001A', fieldValues: { Legacy_Code__c: 'OLD', Rating__c: null } },
                    { recordId: '001B', fieldValues: { Legacy_Code__c: null, Rating__c: null } }
                ]
            });
            expect(RecipeCockpitRecordUpdate.selectSnapshotRecords(snapshotObject, new Set(['001B']))).toEqual([snapshotObject.records[1]]);

        });

        it('writes the snapshot under UpdateAttempts, never over an earlier one, with a .gitignore of everything beside it', () => {

            const snapshot = { orgUsername: 'qa@example.com.qa', treeFolderName: 'Account-thru-Contact', takenAt: '2026-10-22T10:00:00.000Z', objects: [] };
            const date = new Date(2026, 9, 22, 10, 0, 5);
            const attemptFolderPath = path.join(temporaryRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, 'Account-thru-Contact');

            const firstFiles = RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, snapshot, date);
            const secondFiles = RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, snapshot, date);

            expect(firstFiles).toEqual({
                snapshotFilePath: path.join(attemptFolderPath, '20261022-100005-before.json'),
                resultsFilePath: path.join(attemptFolderPath, '20261022-100005-results.json')
            });
            expect(secondFiles?.snapshotFilePath).toBe(path.join(attemptFolderPath, '20261022-100005-2-before.json'));
            expect(JSON.parse(fs.readFileSync(firstFiles!.snapshotFilePath, 'utf8'))).toEqual(snapshot);
            expect(fs.readFileSync(path.join(temporaryRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, '.gitignore'), 'utf8')).toBe('*\n');

            expect(RecipeCockpitRecordUpdate.writeResults(firstFiles!.resultsFilePath, temporaryRoot, { outcome: 'completed' })).toBe(true);
            expect(JSON.parse(fs.readFileSync(firstFiles!.resultsFilePath, 'utf8'))).toEqual({ outcome: 'completed' });
            // "wx": A RESULTS FILE IS NEVER WRITTEN OVER, AND ONE OUTSIDE THE WORKSPACE IS NEVER WRITTEN
            expect(RecipeCockpitRecordUpdate.writeResults(firstFiles!.resultsFilePath, temporaryRoot, {})).toBe(false);
            expect(RecipeCockpitRecordUpdate.writeResults(path.join(os.tmpdir(), 'outside-results.json'), temporaryRoot, {})).toBe(false);

        });

        it.each([
            ['a folder name with a separator', { treeFolderName: '../outside', objects: [] }],
            ['a ".." folder name', { treeFolderName: '..', objects: [] }],
            ['a folder name ending in a dot, which Windows strips', { treeFolderName: 'Account.', objects: [] }],
            ['a Windows device name', { treeFolderName: 'NUL', objects: [] }],
            ['an object that is not an api name', { treeFolderName: 'Account', objects: [{ objectApiName: 'Account/../x', fieldApiNames: [], records: [] }] }]
        ])('writes nothing for %s', (_description, snapshotFields) => {

            const files = RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, { orgUsername: 'qa', takenAt: '', ...snapshotFields }, new Date());
            expect(files).toBeUndefined();
            expect(fs.existsSync(path.join(temporaryRoot, 'treecipe'))).toBe(false);

        });

        it('writes nothing when a folder leaves the workspace, before or after it is made, or when a write fails for another reason than a clash', () => {

            const snapshot = { orgUsername: 'qa', treeFolderName: 'Account', takenAt: '', objects: [] };
            const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValueOnce(false);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, snapshot, new Date())).toBeUndefined();
            expect(fs.existsSync(path.join(temporaryRoot, 'treecipe'))).toBe(false);

            containmentSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, snapshot, new Date())).toBeUndefined();
            containmentSpy.mockRestore();

            const realWriteFileSync = fs.writeFileSync;
            jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
                if ( String(filePath).endsWith('-before.json') ) {
                    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
                }
                return ( realWriteFileSync as any )(filePath, ...rest);
            }) as typeof fs.writeFileSync);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, snapshot, new Date())).toBeUndefined();

        });

        it('answers undefined when the folder cannot be made', () => {

            fs.mkdirSync(path.join(temporaryRoot, 'treecipe'));
            fs.writeFileSync(path.join(temporaryRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME), 'a file, not a folder');

            expect(RecipeCockpitRecordUpdate.writeSnapshot(temporaryRoot, { orgUsername: 'qa', treeFolderName: 'Account', takenAt: '', objects: [] }, new Date())).toBeUndefined();

        });

    });

    describe('the describe and the Collections API', () => {

        it('reads whether an object and a field can be updated from the org\'s describe, anything but true as no', () => {

            const normalizedDescribe = SalesforceOrgService.normalizeDescribeResult('Account', {
                name: 'Account',
                updateable: true,
                fields: [{ name: 'Name', updateable: true }, { name: 'Id', updateable: 'true' }]
            });

            expect(normalizedDescribe.isUpdateable).toBe(true);
            expect(normalizedDescribe.fields.map(field => field.isUpdateable)).toEqual([true, false]);
            expect(SalesforceOrgService.normalizeDescribeResult('Account', { fields: [] }).isUpdateable).toBe(false);

        });

        it('sends one PATCH composite/sobjects request through jsforce, all-or-none as chosen, and refuses more than 200 records', async () => {

            const update = jest.fn().mockResolvedValue([{ id: '001A', success: true, errors: [] }]);
            const connection = { sobject: jest.fn().mockReturnValue({ update: update }) } as any;
            const records = [{ Id: '001A', Legacy_Code__c: 'NEW' }];

            await expect(CollectionsApiService.updateCollectionsApiCallout(records, connection, true, 'Account')).resolves.toEqual([{ id: '001A', success: true, errors: [] }]);
            expect(connection.sobject).toHaveBeenCalledWith('Account');
            expect(update).toHaveBeenCalledWith(records, { allowRecursive: false, allOrNone: true });

            await expect(CollectionsApiService.updateCollectionsApiCallout(Array.from({ length: 201 }, (_value, recordIndex) => ({ Id: `001${recordIndex}` })), connection, false, 'Account'))
                .rejects.toThrow('One update request carries at most 200 records, and 201 were given.');
            expect(update).toHaveBeenCalledTimes(1);

        });

    });

    describe('the host, against a faked org, records and processor', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let recordCountByObject: Record<string, number>;
        let updateCalls: Array<{ objectApiName: string; records: any[]; options: any }>;
        let updateAnswer: (objectApiName: string, records: any[], callNumber: number) => unknown;
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let describeAnswers: Record<string, unknown>;
        let allOrNoneAnswer: boolean | undefined;
        let confirmationAnswers: Record<string, string | undefined>;
        let cancelAfterRequests: number | undefined;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.inPanel).map(([warningText]) => warningText);
        const confirmations = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.inPanel);
        const updateConfirmations = () => confirmations().filter(([title]) => String(title).startsWith('Update '));
        const attemptsFolderPath = () => path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, ACCOUNT_TREE_KEY);
        const attemptFiles = () => fs.existsSync(attemptsFolderPath()) ? fs.readdirSync(attemptsFolderPath()).sort() : [];
        const readAttemptFile = (suffix: string) => JSON.parse(fs.readFileSync(path.join(attemptsFolderPath(), attemptFiles().find(fileName => fileName.endsWith(suffix))!), 'utf8'));

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const selectOrg = (orgDetail: typeof SANDBOX_ORG, isSandbox = true) => {
            panelState().dataOrgDetails = [orgDetail];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: orgDetail, requestSequence: 1, orgTypeDetail: { isSandbox: isSandbox, organizationType: isSandbox ? 'Developer Edition' : 'Enterprise Edition' } };
        };

        const openCockpitLoadAndGenerate = async (fields: unknown = [
            { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
            { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' },
            { objectApiName: 'Contact', fieldApiName: 'LastName' }
        ]) => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({
                command: 'loadUpdaterRecords',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [
                    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Rating__c'], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: '' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            });
            await send({ command: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fields: fields });
        };

        const acknowledgeValues = async () => {
            const valuesMessage = postedNamed('updaterValues').at(-1);
            await send({ command: 'updaterValuesRendered', renderSequence: valuesMessage.renderSequence, valuesSequence: valuesMessage.valuesSequence });
        };

        const requestUpdate = () => send({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-updater-update-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();
            SalesforceOrgService.clearDescribeCache();

            postedPanelMessages = [];
            recordCountByObject = { Account: 3, Contact: 2, OtherChildObject__c: 0 };
            updateCalls = [];
            updateAnswer = (_objectApiName, records) => records.map(record => ({ id: record.Id, success: true, errors: [] }));
            organizationAnswers = [];
            allOrNoneAnswer = false;
            cancelAfterRequests = undefined;
            confirmationAnswers = {
                'Generate new values': RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
                'Update ': RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL
            };
            describeAnswers = {
                Account: { name: 'Account', updateable: true, fields: [{ name: 'Legacy_Code__c', type: 'string', updateable: true }, { name: 'Rating__c', type: 'picklist', updateable: true }] },
                Contact: { name: 'Contact', updateable: true, fields: [{ name: 'LastName', type: 'string', updateable: true }] }
            };

            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask(
                { report: jest.fn() },
                { get isCancellationRequested() { return cancelAfterRequests !== undefined && updateCalls.length >= cancelAfterRequests; } }
            ));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string, options?: { inPanel?: boolean }) => {
                if ( !options?.inPanel ) { return Promise.resolve(undefined); }
                const answerKey = Object.keys(confirmationAnswers).find(titlePrefix => message.startsWith(titlePrefix));
                return Promise.resolve(answerKey ? confirmationAnswers[answerKey] : undefined);
            });
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockReset();

            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                reveal: jest.fn(),
                visible: true,
                onDidDispose: jest.fn(),
                onDidChangeViewState: jest.fn(),
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
            jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation((informationText: string) => { vscode.window.showInformationMessage(informationText); });
            jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockImplementation(async () => allOrNoneAnswer);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => {
                    if ( /FROM Organization/.test(soql) ) {
                        const organizationAnswer = organizationAnswers.shift() ?? { IsSandbox: true, OrganizationType: 'Developer Edition' };
                        return { totalSize: 1, done: true, records: [organizationAnswer] };
                    }
                    const objectApiName = /FROM (\w+)/.exec(soql)![1];
                    const records = Array.from({ length: recordCountByObject[objectApiName] ?? 0 }, (_value, recordIndex) => ({
                        attributes: { type: objectApiName },
                        Id: `${objectApiName}-${recordIndex}`,
                        Legacy_Code__c: `OLD-${recordIndex}`,
                        Rating__c: 'Warm',
                        LastName: `Old ${recordIndex}`
                    }));
                    return { totalSize: records.length, done: true, records: records };
                },
                queryMore: async () => { throw new Error('no more pages'); },
                describe: async (objectApiName: string) => {
                    if ( !Object.prototype.hasOwnProperty.call(describeAnswers, objectApiName) ) {
                        throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                    }
                    return describeAnswers[objectApiName];
                },
                sobject: (objectApiName: string) => ({
                    update: async (records: any[], options: any) => {
                        updateCalls.push({ objectApiName: objectApiName, records: records, options: options });
                        return updateAnswer(objectApiName, records, updateCalls.length);
                    }
                })
            }) as any);

            const standInProcessor: IFakerRecipeProcessor = {
                generateFakeDataBySelectedRecipeFile: async (recipePath: string) => fs.readFileSync(recipePath, 'utf8'),
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: (recipeText: string) => {
                    const [recipe] = yaml.load(recipeText) as any[];
                    return new Map([[recipe.object, {
                        allOrNone: true,
                        records: Array.from({ length: recipe.count }, (_value, recordIndex) => ({
                            attributes: { type: recipe.object },
                            ...Object.fromEntries(Object.keys(recipe.fields).map(fieldApiName => [fieldApiName, `${fieldApiName}-new-${recordIndex}`]))
                        }))
                    }]]);
                }
            } as unknown as IFakerRecipeProcessor;
            jest.spyOn(RecipeCockpitService, 'createUpdaterRecipeProcessor').mockReturnValue(standInProcessor);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('offers the update only once the panel says it drew the values it echoes', async () => {

            await openCockpitLoadAndGenerate();
            const valuesMessage = postedNamed('updaterValues').at(-1);
            expect(valuesMessage.valuesSequence).toEqual(expect.any(Number));

            // NOT YET DRAWN: REFUSED, AND THE BUTTON GIVEN BACK
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState()))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' } });

            // AN ACK OF OTHER VALUES, OR OF ANOTHER MODEL, ACTIVATES NOTHING
            expect(RecipeCockpitService.routePanelMessage({ command: 'updaterValuesRendered', renderSequence: valuesMessage.renderSequence, valuesSequence: valuesMessage.valuesSequence + 1 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updaterValuesRendered', renderSequence: valuesMessage.renderSequence + 1, valuesSequence: valuesMessage.valuesSequence }, panelState())).toBeUndefined();

            await acknowledgeValues();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toEqual({ kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: 'Lead-ONLY' }, panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: 7 }, panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

            // A RELOADED DOCUMENT HAS NOT DRAWN THEM YET
            await send({ command: 'ready' });
            expect(panelState().updatableTreeKeys.size).toBe(0);

        });

        it.each([
            ['an insert', (state: IRecipeCockpitPanelState) => { state.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a scratch org run', (state: IRecipeCockpitPanelState) => { state.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true }; }],
            ['a permission set assignment', (state: IRecipeCockpitPanelState) => { state.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a metadata deploy', (state: IRecipeCockpitPanelState) => { state.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }; }],
            ['a load asking for an org', (state: IRecipeCockpitPanelState) => { state.isUpdaterOrgPromptOpen = true; }]
        ])('refuses the update while %s holds the org selection', async (_description, holdSelection) => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            holdSelection(panelState());

            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toEqual({
                kind: 'refuseUpdaterLoad',
                refusalText: RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL,
                hostMessage: { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' }
            });

        });

        it('refuses an org that has not answered that it is a sandbox, and no org at all, before any connection', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();

            selectOrg(SANDBOX_ORG, false);
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({
                kind: 'refuseUpdaterLoad',
                refusalText: 'Nothing was updated: qa is not a sandbox or scratch org, and the Treecipe Adapter updates only a sandbox or scratch org.'
            });

            panelState().dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({
                kind: 'refuseUpdaterLoad',
                refusalText: 'Nothing was updated: choose the sandbox or scratch org the records were loaded from in Target Org Manager.'
            });

        });

        it('holds the org selection while an update runs: the insert, the org picker, ⟳, the listing, the deploys and the assignment are refused', async () => {

            await openCockpitLoadAndGenerate();
            panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' };
            panelState().dataOrgObjectApiNames = new Set(['Account']);
            panelState().assignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState().insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);

            expect(RecipeCockpitService.isSelectionHeldByUpdater(panelState())).toBe(true);
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'postInsertState' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refusePermissionSetAssign' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refuseMetadataDeploy' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState())).toMatchObject({ kind: 'postScratchOrgState' });
            // A SECOND UPDATE IS TOLD ABOUT THE ONE RUNNING
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState()))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: panelState().updaterLoadStateMessage });

            // A LOAD OR A GENERATION ON ITS OWN DOES NOT HOLD THE SELECTION
            panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };
            expect(RecipeCockpitService.isSelectionHeldByUpdater(panelState())).toBe(false);

        });

        it('saves the old values, then updates every record by Id, parents first, and says so with View results', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            const [[title, options, ...buttons]] = updateConfirmations();
            expect(title).toBe('Update 5 records of Account-thru-OtherChildObject__c in qa · qa@example.com.qa?');
            expect(options.isDestructive).toBe(true);
            expect(buttons).toEqual([RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL]);
            expect(options.detail.split('\n')).toEqual([
                'Org: qa · qa@example.com.qa (Sandbox)',
                `Each record is updated by its Id. The old values are saved first to treecipe/${RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME}/${ACCOUNT_TREE_KEY}/, and nothing is updated if they cannot be.`,
                '',
                'Account: 3 records -- Legacy_Code__c, Rating__c',
                'Contact: 2 records -- LastName',
                '',
                RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE
            ]);

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.records.length, updateCall.options])).toEqual([
                ['Account', 3, { allowRecursive: false, allOrNone: false }],
                ['Contact', 2, { allowRecursive: false, allOrNone: false }]
            ]);
            expect(updateCalls[0].records[0]).toEqual({ attributes: { type: 'Account' }, Id: 'Account-0', Legacy_Code__c: 'Legacy_Code__c-new-0', Rating__c: 'Hot' });

            expect(attemptFiles()).toEqual([expect.stringMatching(/^\d{8}-\d{6}-before\.json$/), expect.stringMatching(/^\d{8}-\d{6}-results\.json$/)]);
            const snapshot = readAttemptFile('-before.json');
            expect(snapshot).toMatchObject({ orgUsername: 'qa@example.com.qa', treeFolderName: ACCOUNT_TREE_KEY });
            expect(snapshot.objects[0]).toEqual({
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
                records: [0, 1, 2].map(recordIndex => ({ recordId: `Account-${recordIndex}`, fieldValues: { Legacy_Code__c: `OLD-${recordIndex}`, Rating__c: 'Warm' } }))
            });
            const results = readAttemptFile('-results.json');
            expect(results).toMatchObject({ outcome: 'completed', allOrNone: false, updatedRecordCount: 5, failedRecordCount: 0, snapshotFile: attemptFiles()[0] });
            expect(results.putBack).toBeUndefined();

            expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
                `5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}.`,
                RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL
            );

            // THE LOADED RECORDS AND THEIR VALUES ARE SPENT
            expect(postedNamed('updaterLoadState').slice(-2)).toEqual([
                { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' },
                { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update', isRecordsSpent: true }
            ]);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(0);
            expect(panelState().updaterValuesMessage).toBeUndefined();
            expect(panelState().updatableTreeKeys.size).toBe(0);

        });

        it('sends at most 200 records per request', async () => {

            recordCountByObject = { Account: 450, Contact: 0, OtherChildObject__c: 0 };
            await openCockpitLoadAndGenerate([{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]);
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.records.length)).toEqual([200, 200, 50]);
            expect(updateCalls[2].records[49].Id).toBe('Account-449');
            // NO PICKLIST CHOSEN: NO RECORD TYPE NOTE
            expect(updateConfirmations()[0][1].detail).not.toContain(RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE);

        });

        it('keeps going without all-or-none, and says how many failed with View errors', async () => {

            updateAnswer = (objectApiName, records) => records.map((record, recordIndex) => objectApiName === 'Account' && recordIndex === 1
                ? { id: record.Id, success: false, errors: [{ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'Rating: bad value for restricted picklist field: Hot', fields: ['Rating__c'] }] }
                : { id: record.Id, success: true, errors: [] });

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.objectApiName)).toEqual(['Account', 'Contact']);
            const results = readAttemptFile('-results.json');
            expect(results).toMatchObject({ outcome: 'completed', updatedRecordCount: 4, failedRecordCount: 1 });
            expect(results.objects[0].results[1]).toEqual({
                recordId: 'Account-1',
                isSuccess: false,
                errors: [{ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'Rating: bad value for restricted picklist field: Hot', fields: ['Rating__c'] }]
            });
            expect(warnings().at(-1)).toBe(`4 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa and 1 failed. Their old values are in ${attemptFiles()[0]}.`);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)[1]).toBe(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);

        });

        it('with all-or-none, stops at the request that failed and puts back what the earlier requests updated, as an error', async () => {

            allOrNoneAnswer = true;
            updateAnswer = (objectApiName, records) => objectApiName === 'Contact'
                ? records.map(record => ({ id: record.Id, success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] }] }))
                : records.map(record => ({ id: record.Id, success: true, errors: [] }));

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.options.allOrNone])).toEqual([
                ['Account', true],
                ['Contact', true],
                ['Account', false]
            ]);
            // PUT BACK FROM THE SNAPSHOT, NOT FROM WHAT WAS SENT
            expect(updateCalls[2].records).toEqual([0, 1, 2].map(recordIndex => ({ attributes: { type: 'Account' }, Id: `Account-${recordIndex}`, Legacy_Code__c: `OLD-${recordIndex}`, Rating__c: 'Warm' })));

            const results = readAttemptFile('-results.json');
            expect(results).toMatchObject({ outcome: 'stopped', allOrNone: true, updatedRecordCount: 3, failedRecordCount: 2, putBack: { putBackRecordCount: 3, failedRecordCount: 0 } });
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                'The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa stopped at a request that failed: 2 records failed. The 3 records it had updated were set back to their old values, because all-or-none was chosen.',
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            );

        });

        it('sets back the records of a request that threw, since the org may have saved them, and says which could not be', async () => {

            allOrNoneAnswer = true;
            updateAnswer = (objectApiName, records, callNumber) => {
                if ( objectApiName === 'Contact' ) { throw new Error('socket hang up'); }
                return records.map((record, recordIndex) => ({ id: record.Id, success: callNumber === 1 || recordIndex > 0, errors: [] }));
            };

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            // THE UPDATE: Account, THEN Contact THREW; THE SET-BACK: Account's 3, THEN Contact's 2 IT MAY HAVE SAVED
            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.records.length, updateCall.options.allOrNone])).toEqual([
                ['Account', 3, true],
                ['Contact', 2, true],
                ['Account', 3, false],
                ['Contact', 2, false]
            ]);
            expect(updateCalls[3].records[0]).toEqual({ attributes: { type: 'Contact' }, Id: 'Contact-0', LastName: 'Old 0' });

            const results = readAttemptFile('-results.json');
            expect(results.objects[1].results[0]).toEqual({ recordId: 'Contact-0', isSuccess: false, errors: [{ statusCode: 'REQUEST_FAILED', message: 'socket hang up', fields: [] }], isUncertain: true });
            expect(results.putBack).toMatchObject({ putBackRecordCount: 2, failedRecordCount: 3, uncertainRecordCount: 2, requestFailureDetail: 'Contact failed: socket hang up' });
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                `The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa stopped at a request that failed: 2 records failed. 2 records it had updated or may have updated were set back to their old values, and 3 records could not be: their old values are in ${attemptFiles()[0]}. The request for Contact failed: socket hang up Setting back Contact failed: socket hang up`,
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            );

        });

        it('names a set-back request that threw as the set-back\'s, not the update\'s, behind its own progress', async () => {

            allOrNoneAnswer = true;
            updateAnswer = (objectApiName, records, callNumber) => {
                if ( callNumber === 3 ) { throw new Error('timed out'); }
                return records.map(record => ({ id: record.Id, success: objectApiName === 'Account', errors: [] }));
            };

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            const progressTitles = (vscode.window.withProgress as jest.Mock).mock.calls.map(([options]) => [options.title, options.cancellable]);
            expect(progressTitles.slice(-2)).toEqual([
                ['Recipe Cockpit: updating Account-thru-OtherChildObject__c in qa · qa@example.com.qa', true],
                ['Recipe Cockpit: setting Account-thru-OtherChildObject__c back to its old values in qa · qa@example.com.qa', false]
            ]);
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                `The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa stopped at a request that failed: 2 records failed. 0 records it had updated were set back to their old values, and 3 records could not be: their old values are in ${attemptFiles()[0]}. Setting back Account failed: timed out`,
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            );

        });

        it('refuses values that do not cover every record, which would clear a field in the org', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            const heldValues = (RecipeCockpitService as any).heldUpdaterValues;
            delete heldValues.valuesByObjectApiName.get('Account')[1].fieldValues.Rating__c;
            await requestUpdate();

            expect(updateConfirmations()).toEqual([]);
            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated: the new values for Account do not cover every record. Generate them again.');

        });

        it('warns when treecipe/UpdateAttempts/.gitignore does not ignore everything, even after a full success', async () => {

            fs.mkdirSync(path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME), { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, '.gitignore'), '*\n!*.json\n');
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls).toHaveLength(2);
            expect(RecipeCockpitRecordUpdate.isUpdateAttemptsFolderGitIgnored(workspaceRoot)).toBe(false);
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(`5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}. ${RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE}`));

        });

        it('empties the active list on a failure to draw and on a new model', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            expect(panelState().updatableTreeKeys.has(ACCOUNT_TREE_KEY)).toBe(true);

            // THE FAILURE IS REPORTED THROUGH THE ERROR HANDLER, WHICH WAITS ON ITS NOTIFICATION
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            await send({ command: 'renderFailed', message: 'draw failed', stack: '', phase: 'render' });
            expect(panelState().updatableTreeKeys.size).toBe(0);

            await acknowledgeValues();
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await flushAsyncWork();
            expect(panelState().updatableTreeKeys.size).toBe(0);
            expect(panelState().pendingUpdatableTreeKeys.size).toBe(0);

        });

        it('on a cancel keeps what was updated without all-or-none, and puts it back with it', async () => {

            cancelAfterRequests = 1;
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.objectApiName)).toEqual(['Account']);
            expect(readAttemptFile('-results.json')).toMatchObject({ outcome: 'cancelled', updatedRecordCount: 3 });
            expect(warnings().at(-1)).toBe('The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa was cancelled after 3 records.');

        });

        it('puts back what a cancelled all-or-none update had changed', async () => {

            allOrNoneAnswer = true;
            cancelAfterRequests = 1;
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.options.allOrNone])).toEqual([['Account', true], ['Account', false]]);
            expect(warnings().at(-1)).toBe('The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa was cancelled after 3 records. The 3 records it had updated were set back to their old values, because all-or-none was chosen.');

        });

        it('writes and sends nothing when the confirmation or the all-or-none question is dismissed, and keeps the records', async () => {

            confirmationAnswers['Update '] = undefined;
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            allOrNoneAnswer = undefined;
            confirmationAnswers['Update '] = RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL;
            await acknowledgeValues();
            await requestUpdate();

            expect(updateConfirmations()).toHaveLength(2);
            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(5);
            expect(postedNamed('updaterLoadState').at(-1)).toEqual({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });

        });

        it('writes and sends nothing when the Organization row, asked again on the connection, is not a sandbox', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            organizationAnswers = [{ IsSandbox: false, OrganizationType: 'Enterprise Edition' }];
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated in qa · qa@example.com.qa: it answered Production · Enterprise Edition, and the Treecipe Adapter updates only a sandbox or scratch org.');

        });

        it('sends nothing when the old values cannot be saved', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME), 'a file where the folder goes');
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe(RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL);
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(5);

        });

        it.each([
            ['a field the user cannot update', { Account: { name: 'Account', updateable: true, fields: [{ name: 'Legacy_Code__c', updateable: false }, { name: 'Rating__c', updateable: true }] } },
                'Nothing was updated in qa · qa@example.com.qa: Account.Legacy_Code__c cannot be updated by this user in the org.'],
            ['a field the org does not have', { Account: { name: 'Account', updateable: true, fields: [{ name: 'Rating__c', updateable: true }] } },
                'Nothing was updated in qa · qa@example.com.qa: Account.Legacy_Code__c is not in the org. Deploy it first from Troubleshooting → Fields.'],
            ['an object the org could not describe', { Account: undefined },
                'Nothing was updated in qa · qa@example.com.qa: Account could not be described in the org: NOT_FOUND: The requested resource does not exist.']
        ])('refuses %s before asking anything', async (_description, describeOverrides, expectedWarning) => {

            Object.entries(describeOverrides).forEach(([objectApiName, describeAnswer]) => {
                if ( describeAnswer === undefined ) { delete describeAnswers[objectApiName]; } else { describeAnswers[objectApiName] = describeAnswer; }
            });
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateConfirmations()).toEqual([]);
            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe(expectedWarning);

        });

        it('refuses an org other than the one the records were loaded from, and values for records let go', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            selectOrg(OTHER_SANDBOX_ORG);
            await requestUpdate();

            expect(updateConfirmations()).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated: the records of Account-thru-OtherChildObject__c were loaded from qa@example.com.qa, not uat · uat@example.com.uat. Load them again from the org selected now.');

            selectOrg(SANDBOX_ORG);
            RecipeCockpitService.clearHeldUpdaterValues();
            await requestUpdate();
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_UPDATER_NOT_GENERATED_REFUSAL));
            expect(updateCalls).toEqual([]);

        });

        it('refuses when the org selection changed while the confirmation was open', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string, options?: { inPanel?: boolean }) => {
                if ( options?.inPanel && message.startsWith('Update ') ) {
                    selectOrg(SANDBOX_ORG);
                    return Promise.resolve(RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL);
                }
                return Promise.resolve(undefined);
            });
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated: the run, the org selection or the loaded records changed after qa · qa@example.com.qa was confirmed. Load and generate again.');

        });

        it('says when a connection cannot be opened, quoting nothing of its error', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValue(new Error('token xyz expired'));
            await requestUpdate();

            expect(warnings().at(-1)).toBe('Nothing was updated: qa · qa@example.com.qa could not be connected to. Log in to it again with sf org login web, then run the query again.');

        });

        it('names an org with no alias by its username and a renamed card by its name, counts one record as one, names the first request that threw, and offers no button when the results could not be written', async () => {

            const NO_ALIAS_ORG = { targetOrgIdentifier: 'solo@example.com.dev', username: 'solo@example.com.dev' } as typeof SANDBOX_ORG;
            recordCountByObject = { Account: 1, Contact: 1, OtherChildObject__c: 0 };
            updateAnswer = () => Promise.reject('socket hang up');
            await openCockpitLoadAndGenerate([{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }, { objectApiName: 'Contact', fieldApiName: 'LastName' }]);
            // LOADED FROM, AND WRITTEN TO, AN ORG WITH NO ALIAS
            (RecipeCockpitService as any).heldUpdaterRecords.orgUsername = NO_ALIAS_ORG.username;
            selectOrg(NO_ALIAS_ORG);
            panelState().recipeDataMessage!.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!.customName = 'My accounts';
            jest.spyOn(RecipeCockpitRecordUpdate, 'writeResults').mockReturnValue(false);
            await acknowledgeValues();
            await requestUpdate();

            expect(updateConfirmations()[0][0]).toBe('Update 2 records of My accounts in solo@example.com.dev?');
            expect(updateConfirmations()[0][1].detail.split('\n').slice(3, 5)).toEqual(['Account: 1 record -- Legacy_Code__c', 'Contact: 1 record -- LastName']);
            expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith('0 records of My accounts were updated in solo@example.com.dev and 2 failed. Their old values are in ' + attemptFiles()[0] + '. The request for Account failed: socket hang up');

        });

        it('says nothing was set back when all-or-none stopped at the first request', async () => {

            allOrNoneAnswer = true;
            recordCountByObject = { Account: 1, Contact: 2, OtherChildObject__c: 0 };
            updateAnswer = (_objectApiName, records) => records.map(record => ({ id: record.Id, success: false, errors: [] }));
            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            await requestUpdate();

            expect(updateCalls).toHaveLength(1);
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                'The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa stopped at a request that failed: 1 record failed.',
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            );

        });

        it('writes and sends nothing when the Organization row asked again cannot be read', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            organizationAnswers = [{ IsSandbox: 'yes', OrganizationType: 7 } as any];
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toMatch(/^Nothing was updated in qa · qa@example\.com\.qa: it answered /);

        });

        it('refuses when the held values no longer match the loaded records, or a check at the run finds the card or the sandbox gone', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            const runUpdate = (treeKey = ACCOUNT_TREE_KEY) => (RecipeCockpitService as any).updateUpdaterRecordsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: treeKey });

            // A CARD THE MODEL ON SCREEN NO LONGER DRAWS: NOTHING ASKED, NOTHING SAID
            const warningCount = warnings().length;
            await runUpdate('Gone-Tree');
            expect(warnings()).toHaveLength(warningCount);

            // THE SELECTION STOPPED BEING A CHECKED SANDBOX BETWEEN THE CLICK AND THE RUN
            selectOrg(SANDBOX_ORG, false);
            await runUpdate();
            expect(warnings().at(-1)).toBe('Nothing was updated: the org selected in Target Org Manager has not answered that it is a sandbox or scratch org.');

            selectOrg(SANDBOX_ORG);
            const heldValues = (RecipeCockpitService as any).heldUpdaterValues;
            heldValues.valuesByObjectApiName = new Map([['Account', [heldValues.valuesByObjectApiName.get('Account')[0]]]]);
            await runUpdate();
            expect(warnings().at(-1)).toBe('Nothing was updated: there are no new values for the loaded records of Account-thru-OtherChildObject__c.');
            expect(updateCalls).toEqual([]);

            // AN UNCHECKED SELECTION IS REFUSED BY THE ROUTER
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({
                refusalText: 'Nothing was updated: qa has not been checked yet, and the Treecipe Adapter updates only a sandbox or scratch org.'
            });

        });

        it('answers an update while one is in flight with no stored state as not running', async () => {

            await openCockpitLoadAndGenerate();
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            postedPanelMessages = [];

            await (RecipeCockpitService as any).updateUpdaterRecordsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

            expect(postedPanelMessages).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' }]);

        });

        it('answers an update that reaches the host while a run is in flight with that run\'s state', async () => {

            await openCockpitLoadAndGenerate();
            await acknowledgeValues();
            const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = runningState;
            postedPanelMessages = [];

            await (RecipeCockpitService as any).updateUpdaterRecordsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

            expect(postedPanelMessages).toEqual([runningState]);
            expect(updateCalls).toEqual([]);

        });

    });

    describe('the panel script', () => {

        const renderUpdater = () => {
            const recipe = loadTreeRecipe();
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
            return { panel, accountCard, updaterPanel };
        };

        const loadedMessage = {
            command: 'updaterRecords',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            orgLabel: 'qa · qa@example.com.qa',
            objects: [{ objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id'], rows: [['001A'], ['001B']], hiddenColumnCount: 0 }]
        };

        const valuesMessage = {
            command: 'updaterValues',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            valuesSequence: 7,
            objects: [
                { objectApiName: 'Account', recordCount: 2, fieldApiNames: ['Legacy_Code__c'], columns: ['Id', 'Legacy_Code__c (current)', 'Legacy_Code__c (new)'], rows: [['001A', 'OLD', 'NEW'], ['001B', 'OLD', 'NEW']], hiddenColumnCount: 0 },
                { objectApiName: 'Contact', recordCount: 1, fieldApiNames: ['LastName'], columns: [], rows: [], hiddenColumnCount: 0 }
            ]
        };

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('holds Update records until values are drawn, names how many and where, and posts the card\'s key alone', () => {

            const { panel, updaterPanel } = renderUpdater();
            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];

            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toMatch(/^Generate values first/);
            expect(updateButton.classList.contains('sdtButton-card')).toBe(true);
            expect(panel.findAll(updateButton, 'actionCardEmoji')[0].textContent).toBe('✍️');

            panel.postToPanel(loadedMessage);
            panel.postToPanel({ ...valuesMessage, renderSequence: 2 });
            expect(updateButton.disabled).toBe(true);
            expect(postedNamed(panel, 'updaterValuesRendered')).toEqual([]);

            panel.postToPanel(valuesMessage);
            expect(postedNamed(panel, 'updaterValuesRendered')).toEqual([{ command: 'updaterValuesRendered', renderSequence: 1, valuesSequence: 7 }]);
            expect(updateButton.disabled).toBe(false);
            expect(panel.cardTitleOf(updateButton)).toBe('Update 3 records in qa · qa@example.com.qa');

            updateButton.dispatch('click');
            expect(postedNamed(panel, 'updateUpdaterRecords')).toEqual([{ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }]);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATING_LABEL);
            expect(updateButton.disabled).toBe(true);

            // A SECOND CLICK WHILE IT RUNS POSTS NOTHING
            updateButton.dispatch('click');
            expect(postedNamed(panel, 'updateUpdaterRecords')).toHaveLength(1);

        });

        it('keeps the preview while an update asks, and lets the records and values go once it says they were spent', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
            panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].dispatch('click');
            panel.postToPanel(loadedMessage);
            panel.postToPanel(valuesMessage);
            const valuesElement = panel.findAll(accountObject, 'updaterValues')[0];
            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            expect(panel.isHidden(valuesElement)).toBe(false);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATING_LABEL);

            // A CANCELLED CONFIRMATION SPENDS NOTHING
            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            expect(panel.isHidden(valuesElement)).toBe(false);
            expect(updateButton.disabled).toBe(false);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update', isRecordsSpent: true });
            expect(panel.isHidden(valuesElement)).toBe(true);
            expect(panel.isHidden(panel.findAll(accountObject, 'updaterRecords')[0])).toBe(true);
            expect(updateButton.disabled).toBe(true);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);

        });

        it('says when the values hold no record to write', () => {

            const { panel, updaterPanel } = renderUpdater();
            panel.postToPanel(loadedMessage);
            panel.postToPanel({ ...valuesMessage, objects: [{ objectApiName: 'Account', recordCount: 0, fieldApiNames: [], columns: [], rows: [], hiddenColumnCount: 0 }, null] });

            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toBe('There are no new values to write: the last load read no records.');

        });

    });

});
