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

import { RecipeCockpitService } from '../RecipeCockpitService';
import {
    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL
} from '../RecipeCockpitDataOrgConstants';
import { RECIPE_COCKPIT_UPDATER_TAB_LABEL } from '../RecipeCockpitShellConstants';
import {
    RECIPE_COCKPIT_UPDATER_NO_CELL_CHANGED_REASON,
    RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON,
    RECIPE_COCKPIT_UPDATER_NO_ROWS_MARKED,
    RECIPE_COCKPIT_UPDATER_NO_ROW_MARKED_REASON,
    RECIPE_COCKPIT_UPDATER_UPDATE_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATING_LABEL
} from '../RecipeCockpitAdapterConstants';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { IRecipeCockpitPanelState } from '../RecipeCockpitViewModel';
import { RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL } from '../RecipeCockpitAdapterHost';
import {
    RECIPE_COCKPIT_ADAPTER_OPEN_ADAPTED_RECIPE_LABEL,
    RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL,
    RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_NOT_LOADED_FOR_UPDATE_REFUSAL,
    RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE,
    RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL,
    RecipeCockpitAdapterRecords
} from '../RecipeCockpitAdapterRecords';
import { RecipeCockpitAdapterState } from '../RecipeCockpitAdapterState';
import { RecipeCockpitAdapterEdits } from '../RecipeCockpitAdapterEdits';
import { IUpdateObjectDescribe, IUpdateRequestRecord, RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, RecipeCockpitRecordUpdate } from '../RecipeCockpitRecordUpdate';
import { makeTreeRunArtifactsLocation } from '../../RunArtifacts/tests/RecipeCockpitRunArtifactsFixture';
import { RecipeCockpitRunArtifacts } from '../../RunArtifacts/RecipeCockpitRunArtifacts';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';
import { RecipeYamlScalar } from '../../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { DatasetSourceService } from '../../DatasetSourceService/DatasetSourceService';


// A RECORD Id OF THE SALESFORCE SHAPE, SINCE THE LOAD NARROWS A CHILD ONLY BY Ids THAT ARE (#444)
const fakeRecordId = (objectApiName: string, recordIndex: number) =>
    `${({ Account: '001', Contact: '003', OtherChildObject__c: 'a01' } as Record<string, string>)[objectApiName] ?? 'a99'}${String(recordIndex).padStart(15, '0')}`;

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const OTHER_SANDBOX_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitModelBuild.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitModelBuild.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
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

// AN ORG SELECTED HERE HAS NO LOCAL AUTHORIZATION READ FOR ITS LABEL (#458, #499); RecipeCockpitDataByOrg.test.ts COVERS THE LABEL
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

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

        it('sends the type, the Id and, of the fields being updated, only those the record holds a value for: a field it does not hold is never sent as null (#721)', () => {

            expect(RecipeCockpitRecordUpdate.buildRequestRecords('Account', ['Legacy_Code__c', 'Rating__c'], [
                { recordId: '001A', fieldValues: { Legacy_Code__c: 'NEW', Rating__c: 'Hot', Other__c: 'never sent' } },
                { recordId: '001B', fieldValues: { Legacy_Code__c: 'NEW-B' } },
                { recordId: '001C', fieldValues: { Rating__c: null } }
            ])).toEqual([
                { attributes: { type: 'Account' }, Id: '001A', Legacy_Code__c: 'NEW', Rating__c: 'Hot' },
                { attributes: { type: 'Account' }, Id: '001B', Legacy_Code__c: 'NEW-B' },
                { attributes: { type: 'Account' }, Id: '001C', Rating__c: null }
            ]);

        });

        it('snapshots, per record, only the fields updated on it, and leaves out a record that is not updated (#721)', () => {

            const loadedRecords = [
                { Id: '001A', Legacy_Code__c: 'OLD-A', Rating__c: 'Warm' },
                { Id: '001B', Legacy_Code__c: 'OLD-B', Rating__c: null },
                { Id: '001C', Legacy_Code__c: 'OLD-C', Rating__c: 'Cold' }
            ];

            expect(RecipeCockpitRecordUpdate.buildSnapshotObject('Account', ['Legacy_Code__c', 'Rating__c'], loadedRecords, [], new Map([['001A', ['Legacy_Code__c']], ['001B', ['Rating__c', 'Legacy_Code__c']]]))).toEqual({
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
                records: [
                    { recordId: '001A', fieldValues: { Legacy_Code__c: 'OLD-A' } },
                    { recordId: '001B', fieldValues: { Legacy_Code__c: 'OLD-B', Rating__c: null } }
                ]
            });

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

        it('writes the snapshot under the tree\'s RunArtifacts/UpdateAttempts, never over an earlier one, with a .gitignore of everything in RunArtifacts', () => {

            const location = makeTreeRunArtifactsLocation(temporaryRoot);
            const snapshot = { orgUsername: 'qa@example.com.qa', treeFolderName: 'Account-thru-Contact', takenAt: '2026-10-22T10:00:00.000Z', objects: [] };
            const date = new Date(2026, 9, 22, 10, 0, 5);
            const attemptFolderPath = path.join(location.folderPath, RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME);

            const firstFiles = RecipeCockpitRecordUpdate.writeSnapshot(location, snapshot, date);
            const secondFiles = RecipeCockpitRecordUpdate.writeSnapshot(location, snapshot, date);

            expect(firstFiles).toEqual({
                snapshotFilePath: path.join(attemptFolderPath, '20261022-100005-before.json'),
                resultsFilePath: path.join(attemptFolderPath, '20261022-100005-results.json')
            });
            expect(secondFiles?.snapshotFilePath).toBe(path.join(attemptFolderPath, '20261022-100005-2-before.json'));
            expect(JSON.parse(fs.readFileSync(firstFiles!.snapshotFilePath, 'utf8'))).toEqual(snapshot);
            expect(fs.readFileSync(path.join(location.folderPath, '.gitignore'), 'utf8')).toBe('*\n');
            expect(fs.existsSync(path.join(temporaryRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME))).toBe(false);

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

            const location = makeTreeRunArtifactsLocation(temporaryRoot);
            const files = RecipeCockpitRecordUpdate.writeSnapshot(location, { orgUsername: 'qa', takenAt: '', ...snapshotFields }, new Date());
            expect(files).toBeUndefined();
            expect(fs.existsSync(location.folderPath)).toBe(false);

        });

        it('writes nothing when a folder leaves the workspace, before or after it is made, or when a write fails for another reason than a clash', () => {

            const location = makeTreeRunArtifactsLocation(temporaryRoot);
            const snapshot = { orgUsername: 'qa', treeFolderName: 'Account', takenAt: '', objects: [] };
            const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValueOnce(false);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(location, snapshot, new Date())).toBeUndefined();
            expect(fs.existsSync(location.folderPath)).toBe(false);

            containmentSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(location, snapshot, new Date())).toBeUndefined();
            containmentSpy.mockRestore();

            const realWriteFileSync = fs.writeFileSync;
            jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
                if ( String(filePath).endsWith('-before.json') ) {
                    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
                }
                return ( realWriteFileSync as any )(filePath, ...rest);
            }) as typeof fs.writeFileSync);
            expect(RecipeCockpitRecordUpdate.writeSnapshot(location, snapshot, new Date())).toBeUndefined();

        });

        it('answers undefined when the folder cannot be made', () => {

            const location = makeTreeRunArtifactsLocation(temporaryRoot);
            fs.mkdirSync(location.folderPath);
            fs.writeFileSync(path.join(location.folderPath, RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME), 'a file, not a folder');

            expect(RecipeCockpitRecordUpdate.writeSnapshot(location, { orgUsername: 'qa', treeFolderName: 'Account', takenAt: '', objects: [] }, new Date())).toBeUndefined();

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
        const runArtifactsFolderPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, 'RunArtifacts');
        const attemptsFolderPath = () => path.join(runArtifactsFolderPath(), RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME);
        const attemptFiles = () => fs.existsSync(attemptsFolderPath()) ? fs.readdirSync(attemptsFolderPath()).sort() : [];
        // WHAT AN UPDATE THAT LANDED ADDS TO ITS NOTIFICATION (#448): THE ADAPTED DATA SET AND RECIPE IT WROTE
        const adaptedDatasetFolderNames = () => fs.readdirSync(path.join(workspaceRoot, 'treecipe', 'FakeDataSets')).filter(folderName => folderName.includes('-adapted-')).sort();
        const adaptedRecipeFileNames = () => fs.readdirSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY)).filter(fileName => fileName.includes('-adapted-')).sort();
        const adaptedNote = () => ` The adapted data set is ${adaptedDatasetFolderNames().at(-1)}, and the adapted recipe ${adaptedRecipeFileNames().at(-1)}.`;
        const readAttemptFile = (suffix: string) => JSON.parse(fs.readFileSync(path.join(attemptsFolderPath(), attemptFiles().find(fileName => fileName.endsWith(suffix))!), 'utf8'));

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const selectOrg = (orgDetail: typeof SANDBOX_ORG, isSandbox = true) => {
            panelState().dataOrgDetails = [orgDetail];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: orgDetail, requestSequence: 1, orgTypeDetail: { isSandbox: isSandbox, organizationType: isSandbox ? 'Developer Edition' : 'Enterprise Edition' } };
        };

        /*
            The records loaded, then the edits an update writes (#721), put on the host as its own
            edit actions leave them: every Account marked with a new Legacy_Code__c and Rating__c,
            every Contact with a new LastName. RecipeCockpitAdapterEdits.test.ts covers how a reader
            makes them; these tests are about what an update does with them.
        */
        const DEFAULT_EDITS: Record<string, (recordIndex: number) => Record<string, unknown>> = {
            Account: recordIndex => ({ Legacy_Code__c: `Legacy_Code__c-new-${recordIndex}`, Rating__c: 'Hot' }),
            Contact: recordIndex => ({ LastName: `LastName-new-${recordIndex}` })
        };

        const openCockpitLoadAndEdit = async (editsByObject: Record<string, (recordIndex: number) => Record<string, unknown> | undefined> = DEFAULT_EDITS, accountWhereClause = '') => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({
                command: 'loadUpdaterRecords',
                parentObjectApiName: 'Account',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [
                    { objectApiName: 'Account', whereClause: accountWhereClause },
                    { objectApiName: 'Contact', whereClause: '' },
                    { objectApiName: 'OtherChildObject__c', whereClause: '' }
                ]
            });
            const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords!;
            Object.entries(editsByObject).forEach(([objectApiName, editOf]) => {
                const objectEdits = RecipeCockpitAdapterEdits.readObjectEdits(heldRecords, objectApiName);
                ( heldRecords.recordsByObjectApiName.get(objectApiName) ?? [] ).forEach((record, recordIndex) => {
                    const changedValues = editOf(recordIndex);
                    if ( changedValues ) {
                        objectEdits.markedRecordIds.add(String(record.Id));
                        objectEdits.changedValuesByRecordId.set(String(record.Id), new Map(Object.entries(changedValues)));
                    }
                });
            });
        };

        // WHAT AN UPDATE WOULD WRITE NOW, AS THE HOST PLANS IT
        const plannedValuesOf = (objectApiName: string) => RecipeCockpitAdapterEdits
            .planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account', 'Contact', 'OtherChildObject__c']).valuesByObjectApiName.get(objectApiName);

        const requestUpdate = () => send({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-updater-update-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitAdapterState as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitAdapterState as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitAdapterState.clearHeldUpdaterRecords();
            SalesforceOrgService.clearDescribeCache();

            postedPanelMessages = [];
            recordCountByObject = { Account: 3, Contact: 2, OtherChildObject__c: 0 };
            updateCalls = [];
            updateAnswer = (_objectApiName, records) => records.map(record => ({ id: record.Id, success: true, errors: [] }));
            organizationAnswers = [];
            allOrNoneAnswer = false;
            cancelAfterRequests = undefined;
            confirmationAnswers = {
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
                        Id: fakeRecordId(objectApiName, recordIndex),
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
            jest.spyOn(RecipeCockpitAdapterRecords, 'createUpdaterRecipeProcessor').mockReturnValue(standInProcessor);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('offers the update only for the card whose records are on screen, and only once a marked row holds a change (#721)', async () => {

            const refused = { kind: 'refuseUpdaterLoad', hostMessage: { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' } };
            const route = (treeKey: unknown = ACCOUNT_TREE_KEY) => RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: treeKey }, panelState());

            // LOADED, NOTHING MARKED OR CHANGED
            await openCockpitLoadAndEdit({});
            expect(route()).toEqual(refused);

            // MARKED, NO CELL CHANGED
            const accountEdits = RecipeCockpitAdapterEdits.readObjectEdits(RecipeCockpitAdapterState.heldUpdaterRecords!, 'Account');
            accountEdits.markedRecordIds.add(fakeRecordId('Account', 0));
            expect(route()).toEqual(refused);

            // CHANGED ON A ROW THAT IS NOT MARKED
            accountEdits.changedValuesByRecordId.set(fakeRecordId('Account', 1), new Map([['Legacy_Code__c', 'NEW']]));
            expect(route()).toEqual(refused);

            accountEdits.changedValuesByRecordId.set(fakeRecordId('Account', 0), new Map([['Legacy_Code__c', 'NEW']]));
            expect(route()).toEqual({ kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
            expect(route('Lead-ONLY')).toMatchObject({ kind: 'refuseUpdaterLoad' });
            expect(route(7)).toMatchObject({ kind: 'refuseUpdaterLoad' });

            // THE RECORDS LET GO: NOTHING TO UPDATE
            RecipeCockpitAdapterState.clearHeldUpdaterRecords();
            expect(route()).toEqual(refused);

        });

        it.each([
            ['an insert', (state: IRecipeCockpitPanelState) => { state.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a scratch org run', (state: IRecipeCockpitPanelState) => { state.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true }; }],
            ['a permission set assignment', (state: IRecipeCockpitPanelState) => { state.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a metadata deploy', (state: IRecipeCockpitPanelState) => { state.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }; }],
            ['a load asking for an org', (state: IRecipeCockpitPanelState) => { state.isUpdaterOrgPromptOpen = true; }],
            ['a query asking for an org', (state: IRecipeCockpitPanelState) => { state.isQueryOrgPromptOpen = true; }]
        ])('refuses the update while %s holds the org selection', async (_description, holdSelection) => {

            await openCockpitLoadAndEdit();
            holdSelection(panelState());

            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toEqual({
                kind: 'refuseUpdaterLoad',
                refusalText: RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL,
                hostMessage: { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' }
            });

        });

        it('refuses an org that has not answered that it is a sandbox, and no org at all, before any connection', async () => {

            await openCockpitLoadAndEdit();

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

            await openCockpitLoadAndEdit();
            panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' };
            panelState().dataOrgObjectApiNames = new Set(['Account']);
            panelState().assignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState().insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);

            expect(RecipeCockpitService.isSelectionHeldByPromptOrUpdater(panelState())).toBe(true);
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState())).toMatchObject({ kind: 'refuseDataOrgListing', hostMessage: { command: 'dataOrgListingRefused', message: expect.stringContaining('A Treecipe Adapter update') } });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState())).toMatchObject({ kind: 'refuseDataOrgListing', hostMessage: { command: 'dataOrgListingRefused', message: expect.stringContaining('A Treecipe Adapter update') } });
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'postInsertState' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refusePermissionSetAssign' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeFields', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refuseMetadataDeploy' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState())).toMatchObject({ kind: 'postScratchOrgState' });
            // A SECOND UPDATE IS TOLD ABOUT THE ONE RUNNING
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState()))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: panelState().updaterLoadStateMessage });

            // A LOAD OR A GENERATION ON ITS OWN DOES NOT HOLD THE SELECTION
            panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };
            expect(RecipeCockpitService.isSelectionHeldByPromptOrUpdater(panelState())).toBe(false);

        });

        it('names a scratch org, and when it expires, in the confirmation (#458)', async () => {

            await openCockpitLoadAndEdit();
            panelState().dataOrgSelection.scratchOrgDetail = { isScratchOrg: true, expirationDate: '2026-11-01' };
            await requestUpdate();

            expect(updateConfirmations()).toHaveLength(1);
            // #457: THE ORG'S TYPE IS THE CONFIRMATION'S BADGE
            const [, confirmOptions] = (RecipeCockpitService.confirmInPanel as unknown as jest.Mock).mock.calls.find(([title]) => String(title).startsWith('Update '));
            // #480: THE ORG IS ITS OWN PART, ITS ALIAS AND USERNAME DRAWN APART FROM THE SUMMARY
            expect(confirmOptions.summary).toEqual([]);
            expect(confirmOptions.org).toEqual({ alias: 'qa', username: 'qa@example.com.qa' });
            expect(confirmOptions.changeOrg).toBeUndefined();
            expect(confirmOptions.badge).toBe('Scratch org · expires 2026-11-01');

        });

        it('saves the old values, then updates every record by Id, parents first, and says so with View results', async () => {

            await openCockpitLoadAndEdit();
            await requestUpdate();

            const [[title, options, ...buttons]] = updateConfirmations();
            expect(title).toBe('Update 5 records of Account-thru-OtherChildObject__c in qa · qa@example.com.qa?');
            expect(options.isDestructive).toBe(true);
            expect(buttons).toEqual([RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL]);
            // #457: THE ORG AND THE RECORD TYPE NOTE ON SCREEN, THE RECORDS AND THE SNAPSHOT FOLDED
            expect(options.detail.split('\n')).toEqual([
                'Org: qa · qa@example.com.qa',
                RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE,
                '',
                'Records and fields · 2',
                'Account: 3 marked, 3 records to update -- Legacy_Code__c, Rating__c',
                'Contact: 2 marked, 2 records to update -- LastName',
                '',
                'How it can be undone',
                'Each record is updated by its Id.',
                `The old values are saved first to treecipe/${RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME}/${ACCOUNT_TREE_KEY}/, and nothing is updated if they cannot be.`
            ]);
            expect((RecipeCockpitService.confirmInPanel as unknown as jest.Mock).mock.calls.find((call: unknown[]) => String(call[0]).startsWith('Update '))[1].badge).toBe('Sandbox');

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.records.length, updateCall.options])).toEqual([
                ['Account', 3, { allowRecursive: false, allOrNone: false }],
                ['Contact', 2, { allowRecursive: false, allOrNone: false }]
            ]);
            expect(updateCalls[0].records[0]).toEqual({ attributes: { type: 'Account' }, Id: fakeRecordId('Account', 0), Legacy_Code__c: 'Legacy_Code__c-new-0', Rating__c: 'Hot' });

            expect(attemptFiles()).toEqual([expect.stringMatching(/^\d{8}-\d{6}-before\.json$/), expect.stringMatching(/^\d{8}-\d{6}-results\.json$/)]);
            const snapshot = readAttemptFile('-before.json');
            expect(snapshot).toMatchObject({ orgUsername: 'qa@example.com.qa', treeFolderName: ACCOUNT_TREE_KEY });
            expect(snapshot.objects[0]).toEqual({
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
                records: [0, 1, 2].map(recordIndex => ({ recordId: fakeRecordId('Account', recordIndex), fieldValues: { Legacy_Code__c: `OLD-${recordIndex}`, Rating__c: 'Warm' } }))
            });
            const results = readAttemptFile('-results.json');
            expect(results).toMatchObject({ outcome: 'completed', allOrNone: false, updatedRecordCount: 5, failedRecordCount: 0, snapshotFile: attemptFiles()[0] });
            expect(results.putBack).toBeUndefined();

            expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
                `5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}.${adaptedNote()}`,
                RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
                RECIPE_COCKPIT_ADAPTER_OPEN_ADAPTED_RECIPE_LABEL,
                RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL
            );

            // THE LOADED RECORDS AND THEIR VALUES ARE SPENT
            expect(postedNamed('updaterLoadState').slice(-2)).toEqual([
                { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' },
                { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update', isRecordsSpent: true }
            ]);
            expect(RecipeCockpitAdapterState.readHeldUpdaterRecordCount()).toBe(0);
            expect(RecipeCockpitAdapterState.heldUpdaterEdits).toBeUndefined();
            expect(panelState().updaterRecordsMessage).toBeUndefined();

        });

        describe('the adapted copy an update leaves (#448)', () => {

            const recipeFolderPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY);
            const recipeFilePath = () => path.join(recipeFolderPath(), `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);
            const adaptedDatasetPath = () => path.join(workspaceRoot, 'treecipe', 'FakeDataSets', adaptedDatasetFolderNames().at(-1)!);
            const readCollectionsApiFile = (objectApiName: string) => JSON.parse(fs.readFileSync(path.join(adaptedDatasetPath(), 'DatasetFilesForCollectionsApi', `collectionsApi-${objectApiName}.json`), 'utf8'));

            it('writes the loaded records with their new values, keyed by Id, and a datasetSource.json of origin "adapt"', async () => {

                const recipeBefore = fs.readFileSync(recipeFilePath(), 'utf8');

                await openCockpitLoadAndEdit();
                    await requestUpdate();

                expect(adaptedDatasetFolderNames()).toEqual([expect.stringMatching(new RegExp(`^${ACCOUNT_TREE_KEY.replace(/[_]/g, '_')}-adapted-\\d{8}-\\d{6}$`))]);

                const accountFile = readCollectionsApiFile('Account');
                expect(accountFile.allOrNone).toBe(true);
                expect(accountFile.records).toHaveLength(3);
                expect(accountFile.records[0]).toEqual({
                    attributes: { type: 'Account', referenceId: `Account_Reference_1__${fakeRecordId('Account', 0)}` },
                    Legacy_Code__c: 'Legacy_Code__c-new-0',
                    Rating__c: 'Hot',
                    LastName: 'Old 0'
                });
                expect(readCollectionsApiFile('Contact').records[1]).toMatchObject({ LastName: 'LastName-new-1' });
                // AN OBJECT THE LOAD READ NO RECORDS OF IS STILL ONE OF THE DATA SET'S, WITH NONE
                expect(readCollectionsApiFile('OtherChildObject__c').records).toEqual([]);

                const datasetSourceRead = DatasetSourceService.readDatasetSource(adaptedDatasetPath(), DatasetSourceService.findKnownRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')));
                expect(datasetSourceRead.status).toBe('linked');
                expect(datasetSourceRead.recipeTreeFolderName).toBe(ACCOUNT_TREE_KEY);
                expect(datasetSourceRead.datasetSource).toMatchObject({
                    origin: 'adapt',
                    fakerService: 'snowfakery',
                    recipeRunFolderName: TREE_RUN_FOLDER_NAME,
                    recordCountsByObject: { Account: 3, Contact: 2, OtherChildObject__c: 0 },
                    adaptation: {
                        parentObjectApiName: 'Account',
                        whereText: '',
                        orgUsername: 'qa@example.com.qa',
                        updatedFieldsByObject: {
                            Account: [{ fieldApiName: 'Legacy_Code__c' }, { fieldApiName: 'Rating__c' }],
                            Contact: [{ fieldApiName: 'LastName' }]
                        },
                        addedObjectApiNames: [],
                        insertedRecordIdsByObject: {},
                        adaptedRecipeFileName: adaptedRecipeFileNames()[0]
                    }
                });

                // THE ORIGINAL IS NEVER WRITTEN, AND THE ADAPTED RECIPE SITS BESIDE IT, A COPY IN THE DATA SET
                expect(fs.readFileSync(recipeFilePath(), 'utf8')).toBe(recipeBefore);
                const adaptedRecipe = fs.readFileSync(path.join(recipeFolderPath(), adaptedRecipeFileNames()[0]), 'utf8');
                expect(fs.readFileSync(path.join(adaptedDatasetPath(), 'BaseArtifactFiles', adaptedRecipeFileNames()[0]), 'utf8')).toBe(adaptedRecipe);
                expect(fs.readFileSync(path.join(adaptedDatasetPath(), 'BaseArtifactFiles', `originalRecipe-${path.basename(recipeFilePath())}`), 'utf8')).toBe(recipeBefore);

                const adaptedComment = `# ADAPTED ${new Date().toISOString().slice(0, 10)} -- qa`;
                const adaptedLines = adaptedRecipe.split('\n').filter(recipeLine => recipeLine.includes('# ADAPTED'));
                expect(adaptedLines).toEqual([
                    `    Legacy_Code__c: \${{fake.Word}} ${adaptedComment}`,
                    // EVERY VALUE CAME FROM THE RECIPE'S OWN LINE (#721), SO THE LINE IS MARKED AND KEPT
                    `    Rating__c: \${{ random_choice('Hot','Warm','Cold') }} ${adaptedComment}`,
                    `    LastName: \${{fake.LastName}} ${adaptedComment}`
                ]);
                expect(adaptedRecipe.replace(/ # ADAPTED [^\n]*/g, '').replace('Rating__c: "Hot"', 'Rating__c: ${{ random_choice(\'Hot\',\'Warm\',\'Cold\') }}')).toBe(recipeBefore);

            });

            it('adds the data set in place, labelled adapted, and the card still reads one recipe', async () => {

                await openCockpitLoadAndEdit();
                    await requestUpdate();

                const [datasetAdded] = postedNamed('datasetAdded');
                expect(datasetAdded.treeKeys).toEqual([ACCOUNT_TREE_KEY]);
                expect(datasetAdded.dataset).toMatchObject({ datasetFolderName: adaptedDatasetFolderNames()[0], fakerService: 'snowfakery', runFolderName: TREE_RUN_FOLDER_NAME, isAdapted: true });

                // A RELOAD LISTS IT THE SAME WAY, AND THE ADAPTED RECIPE IS NOT READ AS A SECOND RECIPE OF THE TREE
                const reloadedRecipe = RecipeCockpitModelBuild.loadRecipeRunByRuns(RecipeCockpitModelBuild.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')), workspaceRoot, TREE_RUN_FOLDER_NAME).recipeViewModel;
                const reloadedTree = reloadedRecipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!;
                expect(reloadedTree.history!.datasets[0]).toMatchObject({ datasetFolderName: adaptedDatasetFolderNames()[0], isAdapted: true });
                expect(reloadedRecipe.objects.filter(object => object.objectApiName === 'Account')).toHaveLength(1);
                expect(RecipeCockpitModelBuild.collectRecipeFilePaths(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME)).map(filePath => path.basename(filePath))).not.toContain(adaptedRecipeFileNames()[0]);

            });

            it('keeps the loaded values of a record the org did not save, and the parent\'s WHERE as typed', async () => {

                updateAnswer = (objectApiName, records) => records.map((record, recordIndex) => objectApiName === 'Account' && recordIndex === 1
                    ? { id: record.Id, success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] }] }
                    : { id: record.Id, success: true, errors: [] });

                await openCockpitLoadAndEdit({ Account: recordIndex => ({ Legacy_Code__c: `Legacy_Code__c-new-${recordIndex}` }) }, "Name LIKE 'Acme%'");
                await requestUpdate();

                expect(readCollectionsApiFile('Account').records.map((record: any) => record.Legacy_Code__c)).toEqual(['Legacy_Code__c-new-0', 'OLD-1', 'Legacy_Code__c-new-2']);
                const datasetSource = JSON.parse(fs.readFileSync(path.join(adaptedDatasetPath(), 'BaseArtifactFiles', 'datasetSource.json'), 'utf8'));
                expect(datasetSource.adaptation).toMatchObject({ whereText: "Name LIKE 'Acme%'", updatedFieldsByObject: { Account: [{ fieldApiName: 'Legacy_Code__c' }] } });

            });

            it('writes no adapted data set when all-or-none set the updated records back, or nothing was updated', async () => {

                allOrNoneAnswer = true;
                updateAnswer = (objectApiName, records) => records.map(record => ( objectApiName === 'Contact'
                    ? { id: record.Id, success: false, errors: [{ statusCode: 'X', message: 'no', fields: [] }] }
                    : { id: record.Id, success: true, errors: [] } ));

                await openCockpitLoadAndEdit();
                    await requestUpdate();

                expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', 'FakeDataSets')) ? adaptedDatasetFolderNames() : []).toEqual([]);
                expect(adaptedRecipeFileNames()).toEqual([]);
                expect(postedNamed('datasetAdded')).toEqual([]);

            });

            it('says in the notification why no copy was written when the card has no single recipe file, and still reports the update', async () => {

                await openCockpitLoadAndEdit();
                    panelState().treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.delete(ACCOUNT_TREE_KEY);
                await requestUpdate();

                expect(updateCalls).toHaveLength(2);
                expect(warnings().at(-1)).toBe(`5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}. No adapted data set was written: this card has no single recipe file whose backend can be told.`);

            });

            it('writes the data set and says why there is no adapted recipe when the recipe no longer has an updated field', async () => {

                await openCockpitLoadAndEdit();
                    fs.writeFileSync(recipeFilePath(), fs.readFileSync(recipeFilePath(), 'utf8').replace('    LastName: ${{fake.LastName}}\n', ''));
                await requestUpdate();

                expect(adaptedDatasetFolderNames()).toHaveLength(1);
                expect(adaptedRecipeFileNames()).toEqual([]);
                expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
                    `5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}. The adapted data set is ${adaptedDatasetFolderNames()[0]}. No adapted recipe was written: Contact has no LastName line.`,
                    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
                    RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL
                );

            });

            it('says when records of a request that threw keep old values the org may not hold', async () => {

                updateAnswer = (objectApiName, records) => {
                    if ( objectApiName === 'Contact' ) { throw new Error('socket hang up'); }
                    return records.map(record => ({ id: record.Id, success: true, errors: [] }));
                };

                await openCockpitLoadAndEdit();
                    await requestUpdate();

                expect(readCollectionsApiFile('Contact').records.map((record: any) => record.LastName)).toEqual(['Old 0', 'Old 1']);
                expect(readCollectionsApiFile('Account').records.map((record: any) => record.Legacy_Code__c)).toEqual(['Legacy_Code__c-new-0', 'Legacy_Code__c-new-1', 'Legacy_Code__c-new-2']);
                expect(warnings().at(-1)).toContain('2 records the org may have saved keep their old values in the adapted data set, so they may not match the org.');

            });

            it('names an org with no alias by its username in the mark, and one uncertain record in the singular', async () => {

                recordCountByObject = { Account: 3, Contact: 1, OtherChildObject__c: 0 };
                updateAnswer = (objectApiName, records) => {
                    if ( objectApiName === 'Contact' ) { throw new Error('socket hang up'); }
                    return records.map(record => ({ id: record.Id, success: true, errors: [] }));
                };

                await openCockpitLoadAndEdit();
                    selectOrg({ ...SANDBOX_ORG, alias: undefined } as unknown as typeof SANDBOX_ORG);
                await requestUpdate();

                const adaptedRecipe = fs.readFileSync(path.join(recipeFolderPath(), adaptedRecipeFileNames()[0]), 'utf8');
                expect(adaptedRecipe).toContain(`    Legacy_Code__c: \${{fake.Word}} # ADAPTED ${new Date().toISOString().slice(0, 10)} -- qa@example.com.qa\n`);
                expect(warnings().at(-1)).toContain('1 record the org may have saved keeps its old values in the adapted data set, so it may not match the org.');

            });

            it('reveals the data set and opens the adapted recipe from the notification\'s buttons', async () => {

                await openCockpitLoadAndEdit();
                    (vscode.window.showInformationMessage as jest.Mock).mockImplementation((_text: string, ...buttons: string[]) => Promise.resolve(buttons.includes(RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL) ? RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL : undefined));
                await requestUpdate();
                await flushAsyncWork();

                expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealInExplorer', expect.objectContaining({ fsPath: adaptedDatasetPath() }));

            });

            it('warns rather than revealing a data set that is gone when the button is chosen', async () => {

                let chooseOpenDataset: (label: string) => void = () => undefined;
                await openCockpitLoadAndEdit();
                    (vscode.window.showInformationMessage as jest.Mock).mockImplementation((_text: string, ...buttons: string[]) => (
                    buttons.includes(RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL) ? new Promise(resolve => { chooseOpenDataset = resolve; }) : Promise.resolve(undefined)
                ));
                await requestUpdate();

                fs.rmSync(adaptedDatasetPath(), { recursive: true });
                (vscode.commands.executeCommand as jest.Mock).mockClear();
                chooseOpenDataset(RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL);
                await flushAsyncWork();

                expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('revealInExplorer', expect.anything());
                expect(warnings().at(-1)).toBe('The adapted data set no longer exists in this workspace.');

            });

        });

        it('sends at most 200 records per request', async () => {

            recordCountByObject = { Account: 450, Contact: 0, OtherChildObject__c: 0 };
            await openCockpitLoadAndEdit({ Account: recordIndex => ({ Legacy_Code__c: `Legacy_Code__c-new-${recordIndex}` }) });
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.records.length)).toEqual([200, 200, 50]);
            expect(updateCalls[2].records[49].Id).toBe(fakeRecordId('Account', 449));
            // NO PICKLIST CHOSEN: NO RECORD TYPE NOTE
            expect(updateConfirmations()[0][1].detail).not.toContain(RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE);

        });

        it('keeps going without all-or-none, and says how many failed with View errors', async () => {

            updateAnswer = (objectApiName, records) => records.map((record, recordIndex) => objectApiName === 'Account' && recordIndex === 1
                ? { id: record.Id, success: false, errors: [{ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'Rating: bad value for restricted picklist field: Hot', fields: ['Rating__c'] }] }
                : { id: record.Id, success: true, errors: [] });

            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.objectApiName)).toEqual(['Account', 'Contact']);
            const results = readAttemptFile('-results.json');
            expect(results).toMatchObject({ outcome: 'completed', updatedRecordCount: 4, failedRecordCount: 1 });
            expect(results.objects[0].results[1]).toEqual({
                recordId: fakeRecordId('Account', 1),
                isSuccess: false,
                errors: [{ statusCode: 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', message: 'Rating: bad value for restricted picklist field: Hot', fields: ['Rating__c'] }]
            });
            expect(warnings().at(-1)).toBe(`4 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa and 1 failed. Their old values are in ${attemptFiles()[0]}.${adaptedNote()}`);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.at(-1)[1]).toBe(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);

        });

        it('with all-or-none, stops at the request that failed and puts back what the earlier requests updated, as an error', async () => {

            allOrNoneAnswer = true;
            updateAnswer = (objectApiName, records) => objectApiName === 'Contact'
                ? records.map(record => ({ id: record.Id, success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] }] }))
                : records.map(record => ({ id: record.Id, success: true, errors: [] }));

            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.options.allOrNone])).toEqual([
                ['Account', true],
                ['Contact', true],
                ['Account', false]
            ]);
            // PUT BACK FROM THE SNAPSHOT, NOT FROM WHAT WAS SENT
            expect(updateCalls[2].records).toEqual([0, 1, 2].map(recordIndex => ({ attributes: { type: 'Account' }, Id: fakeRecordId('Account', recordIndex), Legacy_Code__c: `OLD-${recordIndex}`, Rating__c: 'Warm' })));

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

            await openCockpitLoadAndEdit();
            await requestUpdate();

            // THE UPDATE: Account, THEN Contact THREW; THE SET-BACK: Account's 3, THEN Contact's 2 IT MAY HAVE SAVED
            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.records.length, updateCall.options.allOrNone])).toEqual([
                ['Account', 3, true],
                ['Contact', 2, true],
                ['Account', 3, false],
                ['Contact', 2, false]
            ]);
            expect(updateCalls[3].records[0]).toEqual({ attributes: { type: 'Contact' }, Id: fakeRecordId('Contact', 0), LastName: 'Old 0' });

            const results = readAttemptFile('-results.json');
            expect(results.objects[1].results[0]).toEqual({ recordId: fakeRecordId('Contact', 0), isSuccess: false, errors: [{ statusCode: 'REQUEST_FAILED', message: 'socket hang up', fields: [] }], isUncertain: true });
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

            await openCockpitLoadAndEdit();
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

        it('writes only the marked rows, and of each only its own changed cells: the request, the snapshot and the plan agree (#721)', async () => {

            // Account 0: BOTH FIELDS. Account 1: ONE FIELD. Account 2: NOT MARKED. Contact 0: MARKED WITH NO CHANGE. Contact 1: CHANGED BUT NOT MARKED
            await openCockpitLoadAndEdit({
                Account: recordIndex => [{ Legacy_Code__c: 'NEW-0', Rating__c: 'Hot' }, { Rating__c: null }, undefined][recordIndex]
            });
            const contactEdits = RecipeCockpitAdapterEdits.readObjectEdits(RecipeCockpitAdapterState.heldUpdaterRecords!, 'Contact');
            contactEdits.markedRecordIds.add(fakeRecordId('Contact', 0));
            contactEdits.changedValuesByRecordId.set(fakeRecordId('Contact', 1), new Map([['LastName', 'Unmarked']]));

            expect(plannedValuesOf('Account')).toEqual([
                { recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'NEW-0', Rating__c: 'Hot' } },
                { recordId: fakeRecordId('Account', 1), fieldValues: { Rating__c: null } }
            ]);
            expect(plannedValuesOf('Contact')).toBeUndefined();

            await requestUpdate();

            expect(updateConfirmations()[0][0]).toBe('Update 2 records of Account-thru-OtherChildObject__c in qa · qa@example.com.qa?');
            expect(updateConfirmations()[0][1].detail).toContain('Account: 2 marked, 2 records to update -- Legacy_Code__c, Rating__c');
            expect(updateConfirmations()[0][1].detail).not.toContain('Contact');
            expect(updateCalls).toHaveLength(1);
            expect(updateCalls[0].records).toEqual([
                { attributes: { type: 'Account' }, Id: fakeRecordId('Account', 0), Legacy_Code__c: 'NEW-0', Rating__c: 'Hot' },
                { attributes: { type: 'Account' }, Id: fakeRecordId('Account', 1), Rating__c: null }
            ]);
            expect(readAttemptFile('-before.json').objects).toEqual([{
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
                records: [
                    { recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'OLD-0', Rating__c: 'Warm' } },
                    { recordId: fakeRecordId('Account', 1), fieldValues: { Rating__c: 'Warm' } }
                ]
            }]);

        });

        it('refuses with what to do when no marked row holds a change', async () => {

            await openCockpitLoadAndEdit({});
            await (RecipeCockpitAdapterRecords as any).updateUpdaterRecordsFromPanel(RecipeCockpitService, (RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

            expect(updateConfirmations()).toEqual([]);
            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL));

        });

        it('warns when the tree\'s RunArtifacts/.gitignore does not ignore everything, even after a full success', async () => {

            fs.mkdirSync(runArtifactsFolderPath(), { recursive: true });
            fs.writeFileSync(path.join(runArtifactsFolderPath(), '.gitignore'), '*\n!*.json\n');
            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls).toHaveLength(2);
            expect(RecipeCockpitRunArtifacts.isFolderWhollyGitIgnored(runArtifactsFolderPath())).toBe(false);
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME))).toBe(false);
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(`5 records of Account-thru-OtherChildObject__c were updated in qa · qa@example.com.qa. Their old values are in ${attemptFiles()[0]}. ${RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE}${adaptedNote()}`));

        });

        it('offers no update once a new model lets the records and their edits go', async () => {

            await openCockpitLoadAndEdit();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toEqual({ kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await flushAsyncWork();

            expect(RecipeCockpitAdapterState.heldUpdaterEdits).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

        });

        it('on a cancel keeps what was updated without all-or-none, and puts it back with it', async () => {

            cancelAfterRequests = 1;
            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls.map(updateCall => updateCall.objectApiName)).toEqual(['Account']);
            expect(readAttemptFile('-results.json')).toMatchObject({ outcome: 'cancelled', updatedRecordCount: 3 });
            expect(warnings().at(-1)).toBe(`The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa was cancelled after 3 records.${adaptedNote()}`);

        });

        it('puts back what a cancelled all-or-none update had changed', async () => {

            allOrNoneAnswer = true;
            cancelAfterRequests = 1;
            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.options.allOrNone])).toEqual([['Account', true], ['Account', false]]);
            expect(warnings().at(-1)).toBe('The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa was cancelled after 3 records. The 3 records it had updated were set back to their old values, because all-or-none was chosen.');

        });

        it('writes and sends nothing when the confirmation or the all-or-none question is dismissed, and keeps the records', async () => {

            confirmationAnswers['Update '] = undefined;
            await openCockpitLoadAndEdit();
            await requestUpdate();

            allOrNoneAnswer = undefined;
            confirmationAnswers['Update '] = RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL;
            await requestUpdate();

            expect(updateConfirmations()).toHaveLength(2);
            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(RecipeCockpitAdapterState.readHeldUpdaterRecordCount()).toBe(5);
            expect(postedNamed('updaterLoadState').at(-1)).toEqual({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });

        });

        it('writes and sends nothing when the Organization row, asked again on the connection, is not a sandbox', async () => {

            await openCockpitLoadAndEdit();
            organizationAnswers = [{ IsSandbox: false, OrganizationType: 'Enterprise Edition' }];
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated in qa · qa@example.com.qa: it answered Production · Enterprise Edition, and the Treecipe Adapter updates only a sandbox or scratch org.');

        });

        it('sends nothing when the snapshot is short of a record the update would write', async () => {

            await openCockpitLoadAndEdit();
            const buildSnapshotObject = RecipeCockpitRecordUpdate.buildSnapshotObject.bind(RecipeCockpitRecordUpdate);
            jest.spyOn(RecipeCockpitRecordUpdate, 'buildSnapshotObject').mockImplementation((...snapshotArguments) => {
                const snapshotObject = buildSnapshotObject(...snapshotArguments);
                return { ...snapshotObject, records: snapshotObject.records.slice(1) };
            });
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toBe(RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL);

        });

        it('sends nothing when the old values cannot be saved', async () => {

            fs.writeFileSync(runArtifactsFolderPath(), 'a file where the folder goes');
            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe(RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL);
            expect(RecipeCockpitAdapterState.readHeldUpdaterRecordCount()).toBe(5);

        });

        it.each([
            ['a field the user cannot update', { Account: { name: 'Account', updateable: true, fields: [{ name: 'Legacy_Code__c', updateable: false }, { name: 'Rating__c', updateable: true }] } },
                'Nothing was updated in qa · qa@example.com.qa: Account.Legacy_Code__c cannot be updated by this user in the org.'],
            ['a field the org does not have', { Account: { name: 'Account', updateable: true, fields: [{ name: 'Rating__c', updateable: true }] } },
                'Nothing was updated in qa · qa@example.com.qa: Account.Legacy_Code__c is not in the org. Deploy it first from Troubleshooting → Fields.'],
            ['an object the org could not describe', { Account: undefined },
                'Nothing was updated in qa · qa@example.com.qa: Account could not be described in the org: NOT_FOUND: The requested resource does not exist.']
        ])('refuses %s before asking anything', async (_description, describeOverrides, expectedWarning) => {

            await openCockpitLoadAndEdit();
            // THE ORG CHANGED AFTER THE LOAD: A FIELD IT LACKED AT THE LOAD IS LEFT OUT THERE AND NEVER REACHES AN UPDATE (#720)
            Object.entries(describeOverrides).forEach(([objectApiName, describeAnswer]) => {
                if ( describeAnswer === undefined ) { delete describeAnswers[objectApiName]; } else { describeAnswers[objectApiName] = describeAnswer; }
                SalesforceOrgService.clearDescribeCache(SANDBOX_ORG.username, objectApiName);
            });
            await requestUpdate();

            expect(updateConfirmations()).toEqual([]);
            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toBe(expectedWarning);

        });

        it('refuses an org other than the one the records were loaded from, and values for records let go', async () => {

            await openCockpitLoadAndEdit();
            selectOrg(OTHER_SANDBOX_ORG);
            await requestUpdate();

            expect(updateConfirmations()).toEqual([]);
            expect(warnings().at(-1)).toBe('Nothing was updated: the records of Account-thru-OtherChildObject__c were loaded from qa@example.com.qa, not uat · uat@example.com.uat. Load them again from the org selected now.');

            // THE EDITS OF ANOTHER LOAD ARE NOT THIS ONE'S, AND RECORDS LET GO HAVE NONE
            const runUpdate = () => (RecipeCockpitAdapterRecords as any).updateUpdaterRecordsFromPanel(RecipeCockpitService, (RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
            selectOrg(SANDBOX_ORG);
            RecipeCockpitAdapterState.heldUpdaterEdits!.resultKey = 'another load';
            await runUpdate();
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL));

            RecipeCockpitAdapterState.clearHeldUpdaterRecords();
            await runUpdate();
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_UPDATER_NOT_LOADED_FOR_UPDATE_REFUSAL));
            expect(updateCalls).toEqual([]);

        });

        it('refuses when the org selection changed while the confirmation was open', async () => {

            await openCockpitLoadAndEdit();
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
            expect(warnings().at(-1)).toBe('Nothing was updated: the run, the org selection or the loaded records changed after qa · qa@example.com.qa was confirmed. Load the records and make the changes again.');

        });

        it('says when a connection cannot be opened, quoting nothing of its error', async () => {

            await openCockpitLoadAndEdit();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValue(new Error('token xyz expired'));
            await requestUpdate();

            expect(warnings().at(-1)).toBe('Nothing was updated: qa · qa@example.com.qa could not be connected to. Log in to it again with sf org login web, then run the query again.');

        });

        it('names an org with no alias by its username and a renamed card by its name, counts one record as one, names the first request that threw, and offers no button when the results could not be written', async () => {

            const NO_ALIAS_ORG = { targetOrgIdentifier: 'solo@example.com.dev', username: 'solo@example.com.dev' } as typeof SANDBOX_ORG;
            recordCountByObject = { Account: 1, Contact: 1, OtherChildObject__c: 0 };
            updateAnswer = () => Promise.reject('socket hang up');
            await openCockpitLoadAndEdit({ Account: () => ({ Legacy_Code__c: 'Legacy_Code__c-new-0' }), Contact: () => ({ LastName: 'LastName-new-0' }) });
            // LOADED FROM, AND WRITTEN TO, AN ORG WITH NO ALIAS
            (RecipeCockpitAdapterState as any).heldUpdaterRecords.orgUsername = NO_ALIAS_ORG.username;
            selectOrg(NO_ALIAS_ORG);
            panelState().recipeDataMessage!.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!.customName = 'My accounts';
            jest.spyOn(RecipeCockpitRecordUpdate, 'writeResults').mockReturnValue(false);
            await requestUpdate();

            expect(updateConfirmations()[0][0]).toBe('Update 2 records of My accounts in solo@example.com.dev?');
            expect(updateConfirmations()[0][1].detail.split('\n').slice(3, 5)).toEqual(['Account: 1 marked, 1 record to update -- Legacy_Code__c', 'Contact: 1 marked, 1 record to update -- LastName']);
            expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith('0 records of My accounts were updated in solo@example.com.dev and 2 failed. Their old values are in ' + attemptFiles()[0] + '. The request for Account failed: socket hang up');

        });

        it('says nothing was set back when all-or-none stopped at the first request', async () => {

            allOrNoneAnswer = true;
            recordCountByObject = { Account: 1, Contact: 2, OtherChildObject__c: 0 };
            updateAnswer = (_objectApiName, records) => records.map(record => ({ id: record.Id, success: false, errors: [] }));
            await openCockpitLoadAndEdit();
            await requestUpdate();

            expect(updateCalls).toHaveLength(1);
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                'The update of Account-thru-OtherChildObject__c in qa · qa@example.com.qa stopped at a request that failed: 1 record failed.',
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            );

        });

        it('writes and sends nothing when the Organization row asked again cannot be read', async () => {

            await openCockpitLoadAndEdit();
            organizationAnswers = [{ IsSandbox: 'yes', OrganizationType: 7 } as any];
            await requestUpdate();

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual([]);
            expect(warnings().at(-1)).toMatch(/^Nothing was updated in qa · qa@example\.com\.qa: it answered /);

        });

        it('refuses when the held values no longer match the loaded records, or a check at the run finds the card or the sandbox gone', async () => {

            await openCockpitLoadAndEdit();
            const runUpdate = (treeKey = ACCOUNT_TREE_KEY) => (RecipeCockpitAdapterRecords as any).updateUpdaterRecordsFromPanel(RecipeCockpitService, (RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: treeKey });

            // A CARD THE MODEL ON SCREEN NO LONGER DRAWS: NOTHING ASKED, NOTHING SAID
            const warningCount = warnings().length;
            await runUpdate('Gone-Tree');
            expect(warnings()).toHaveLength(warningCount);

            // THE SELECTION STOPPED BEING A CHECKED SANDBOX BETWEEN THE CLICK AND THE RUN
            selectOrg(SANDBOX_ORG, false);
            await runUpdate();
            expect(warnings().at(-1)).toBe('Nothing was updated: the org selected in Target Org Manager has not answered that it is a sandbox or scratch org.');

            // EVERY ROW UNMARKED BETWEEN THE CLICK AND THE RUN
            selectOrg(SANDBOX_ORG);
            RecipeCockpitAdapterState.heldUpdaterEdits!.editsByObjectApiName.forEach(objectEdits => objectEdits.markedRecordIds.clear());
            await runUpdate();
            expect(warnings().at(-1)).toBe(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL));
            expect(updateCalls).toEqual([]);

            // AN UNCHECKED SELECTION IS REFUSED BY THE ROUTER
            RecipeCockpitAdapterState.heldUpdaterEdits!.editsByObjectApiName.get('Account')!.markedRecordIds.add(fakeRecordId('Account', 0));
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1 };
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({
                refusalText: 'Nothing was updated: qa has not been checked yet, and the Treecipe Adapter updates only a sandbox or scratch org.'
            });

        });

        it('answers an update while one is in flight with no stored state as not running', async () => {

            await openCockpitLoadAndEdit();
            (RecipeCockpitAdapterState as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitAdapterState as any).updaterLoadRunStateMessage = undefined;
            postedPanelMessages = [];

            await (RecipeCockpitAdapterRecords as any).updateUpdaterRecordsFromPanel(RecipeCockpitService, (RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

            expect(postedPanelMessages).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' }]);

        });

        it('answers an update that reaches the host while a run is in flight with that run\'s state', async () => {

            await openCockpitLoadAndEdit();
            const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };
            (RecipeCockpitAdapterState as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitAdapterState as any).updaterLoadRunStateMessage = runningState;
            postedPanelMessages = [];

            await (RecipeCockpitAdapterRecords as any).updateUpdaterRecordsFromPanel(RecipeCockpitService, (RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });

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
            objects: [{ objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id', 'Legacy_Code__c'], rows: [['001A', 'OLD'], ['001B', 'OLD']], hiddenColumnCount: 0, pageCount: 1, columnEdits: [{ lockReason: 'a record\'s Id is never changed', canGenerate: false }, { canGenerate: true }] }]
        };

        // THE SAME RECORDS ONCE THE HOST HOLDS BOTH ROWS AS MARKED, ONE OF THEM CHANGED
        const editedMessage = {
            ...loadedMessage,
            objects: [{ ...loadedMessage.objects[0], markedRowIndexes: [0, 1], changedCells: [[0, 1]], editSummary: { markedRecordCount: 2, updatableRecordCount: 1, changedFieldApiNames: ['Legacy_Code__c'], hasUnmarkedChanges: false } }]
        };

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('holds Update records, saying why, until a marked row holds a change; then names how many and where, and posts the card\'s key alone (#721)', () => {

            const { panel, updaterPanel } = renderUpdater();
            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];

            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toMatch(/^Load records first/);
            expect(updateButton.classList.contains('sdtButton-card')).toBe(true);
            expect(panel.findAll(updateButton, 'actionCardEmoji')[0].textContent).toBe('✍️');
            expect(panel.findAll(updaterPanel, 'updaterGenerate')).toEqual([]);

            // LOADED, NO ROW MARKED
            panel.postToPanel(loadedMessage);
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toBe(RECIPE_COCKPIT_UPDATER_NO_ROW_MARKED_REASON);
            expect(panel.findAll(updaterPanel, 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_ROWS_MARKED);

            // MARKED, NO CELL CHANGED
            panel.postToPanel({ ...loadedMessage, objects: [{ ...loadedMessage.objects[0], markedRowIndexes: [0], editSummary: { markedRecordCount: 1, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } }] });
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toBe(RECIPE_COCKPIT_UPDATER_NO_CELL_CHANGED_REASON);

            // AN EDIT FOR ANOTHER MODEL CHANGES NOTHING
            panel.postToPanel({ ...editedMessage, renderSequence: 2 });
            expect(updateButton.disabled).toBe(true);

            panel.postToPanel(editedMessage);
            expect(updateButton.disabled).toBe(false);
            expect(panel.cardTitleOf(updateButton)).toBe('Update 1 record in qa · qa@example.com.qa');
            expect(panel.findAll(updaterPanel, 'updaterSummary')[0].textContent).toBe('2 rows marked · 1 record to update');

            updateButton.dispatch('click');
            expect(postedNamed(panel, 'updateUpdaterRecords')).toEqual([{ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }]);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATING_LABEL);
            expect(updateButton.disabled).toBe(true);

            // A SECOND CLICK WHILE IT RUNS POSTS NOTHING
            updateButton.dispatch('click');
            expect(postedNamed(panel, 'updateUpdaterRecords')).toHaveLength(1);

        });

        it('keeps the table while an update asks, and lets the records and their edits go once it says they were spent', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
            panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].dispatch('click');
            panel.postToPanel(editedMessage);
            const recordsElement = panel.findAll(accountObject, 'updaterRecords')[0];
            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            expect(panel.findAll(recordsElement, 'updaterMarkedRow')).toHaveLength(2);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATING_LABEL);
            // NO EDIT WHILE THE UPDATE HOLDS THE RECORDS
            expect(panel.findAll(recordsElement, 'updaterRowMark').every((markButton: any) => markButton.disabled)).toBe(true);

            // A CANCELLED CONFIRMATION SPENDS NOTHING
            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            expect(panel.findAll(recordsElement, 'updaterMarkedRow')).toHaveLength(2);
            expect(panel.findAll(recordsElement, 'updaterRowMark').some((markButton: any) => markButton.disabled)).toBe(false);
            expect(updateButton.disabled).toBe(false);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'update', isRecordsSpent: true });
            expect(panel.isHidden(recordsElement)).toBe(true);
            expect(updateButton.disabled).toBe(true);
            expect(panel.cardTitleOf(updateButton)).toBe(RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);

        });

        it('says a load of 0 records has nothing to update', () => {

            const { panel, updaterPanel } = renderUpdater();
            panel.postToPanel({ ...loadedMessage, objects: [{ ...loadedMessage.objects[0], totalSize: 0, recordCount: 0, rows: [] }] });

            const updateButton = panel.findAll(updaterPanel, 'updaterUpdate')[0];
            expect(updateButton.disabled).toBe(true);
            expect(updateButton.attributes.title).toBe(RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON);

        });

    });

});
