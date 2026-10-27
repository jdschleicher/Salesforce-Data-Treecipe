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
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_NO_SNAPSHOTS_NOTE,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE,
    RECIPE_COCKPIT_UPDATER_RESTORE_BUSY_REFUSAL,
    RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_RESTORE_LABEL,
    RECIPE_COCKPIT_UPDATER_RESTORE_SNAPSHOT_FAILED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_RESTORING_LABEL,
    RECIPE_COCKPIT_UPDATER_SNAPSHOTS_HEADING,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL
} from '../RecipeCockpitService';
import {
    IUpdateSnapshot,
    RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME,
    RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT,
    RECIPE_COCKPIT_UPDATE_SNAPSHOT_MAX_BYTES,
    RecipeCockpitRecordUpdate
} from '../RecipeCockpitRecordUpdate';
import { makeTreeRunArtifactsLocation } from './RecipeCockpitRunArtifactsFixture';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

const ACCOUNT_ID_PREFIX = '001';
const CONTACT_ID_PREFIX = '003';
const buildRecordId = (keyPrefix: string, recordIndex: number) => `${keyPrefix}${String(recordIndex).padStart(12, '0')}AAA`;

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const validSnapshot = (): IUpdateSnapshot => ({
    orgUsername: 'qa@example.com.qa',
    treeFolderName: ACCOUNT_TREE_KEY,
    takenAt: '2026-10-23T10:00:00.000Z',
    objects: [{
        objectApiName: 'Account',
        fieldApiNames: ['Legacy_Code__c', 'Rating__c'],
        records: [
            { recordId: buildRecordId(ACCOUNT_ID_PREFIX, 0), fieldValues: { Legacy_Code__c: 'OLD-0', Rating__c: null } },
            { recordId: buildRecordId(ACCOUNT_ID_PREFIX, 1).slice(0, 15), fieldValues: { Legacy_Code__c: 7, Rating__c: true } }
        ]
    }]
});

answerInPanelConfirmationsThroughWarningMock();

// AN ORG SELECTED HERE IS NOT ASKED "sf org display" (#458); RecipeCockpitDataByOrg.test.ts COVERS THE LABEL
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readOrgDisplayDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, the Treecipe Adapter\'s restore (#419)', () => {

    describe('RecipeCockpitRecordUpdate', () => {

        let temporaryRoot: string;
        let treeFolderPath: string;

        const writeSnapshotFile = (fileName: string, content = '{}') => fs.writeFileSync(path.join(treeFolderPath, fileName), content);

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-record-restore-'));
            treeFolderPath = path.join(temporaryRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, ACCOUNT_TREE_KEY);
            fs.mkdirSync(treeFolderPath, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads a snapshot it wrote, built afresh with only the fields it names', () => {

            const snapshot = validSnapshot();
            expect(RecipeCockpitRecordUpdate.parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);

            const files = RecipeCockpitRecordUpdate.writeSnapshot(makeTreeRunArtifactsLocation(temporaryRoot), snapshot, new Date(2026, 9, 23, 10, 0, 0));
            expect(RecipeCockpitRecordUpdate.readSnapshotFile(files!.snapshotFilePath)).toEqual(snapshot);

        });

        const tamper = (change: (snapshot: any) => void) => {
            const snapshot: any = validSnapshot();
            change(snapshot);
            return JSON.stringify(snapshot);
        };

        it.each([
            ['text that is not JSON', '{"orgUsername": ', 'it is not JSON'],
            ['an array', '[]', 'it is not a snapshot'],
            ['null', 'null', 'it is not a snapshot'],
            ['no org username', tamper(snapshot => { delete snapshot.orgUsername; }), 'it names no usable org username'],
            ['a username with a line break', tamper(snapshot => { snapshot.orgUsername = 'qa@example.com\nevil'; }), 'it names no usable org username'],
            ['a tree folder that leaves its folder', tamper(snapshot => { snapshot.treeFolderName = '..'; }), 'it names no usable tree folder'],
            ['a tree folder with a separator', tamper(snapshot => { snapshot.treeFolderName = 'a/b'; }), 'it names no usable tree folder'],
            ['no usable time', tamper(snapshot => { snapshot.takenAt = 'yesterday'; }), 'it says no usable time it was taken'],
            ['no objects', tamper(snapshot => { snapshot.objects = []; }), 'it holds no objects'],
            ['an object that is not an api name', tamper(snapshot => { snapshot.objects[0].objectApiName = 'Account WHERE'; }), 'an object in it is not an api name'],
            ['an object twice', tamper(snapshot => { snapshot.objects.push({ ...snapshot.objects[0], objectApiName: 'account' }); }), 'it lists account twice'],
            ['no fields', tamper(snapshot => { snapshot.objects[0].fieldApiNames = []; }), 'a field of Account in it is not an api name'],
            ['a field that is not an api name', tamper(snapshot => { snapshot.objects[0].fieldApiNames[1] = '__proto__'; }), 'a field of Account in it is not an api name'],
            ['a field twice', tamper(snapshot => { snapshot.objects[0].fieldApiNames[1] = 'legacy_code__c'; }), 'it lists a field of Account twice, or its Id as a field'],
            ['the Id as a field', tamper(snapshot => { snapshot.objects[0].fieldApiNames[1] = 'ID'; }), 'it lists a field of Account twice, or its Id as a field'],
            ['no records list', tamper(snapshot => { snapshot.objects[0].records = {}; }), 'it holds no records of Account'],
            ['an Id that is not a Salesforce Id', tamper(snapshot => { snapshot.objects[0].records[0].recordId = '001\') OR Id != (\''; }), 'a record of Account in it has no Salesforce Id or no values'],
            ['a record with no values', tamper(snapshot => { snapshot.objects[0].records[0].fieldValues = null; }), 'a record of Account in it has no Salesforce Id or no values'],
            ['one record twice, as its 15- and 18-character Id', tamper(snapshot => { snapshot.objects[0].records[1].recordId = buildRecordId(ACCOUNT_ID_PREFIX, 0).slice(0, 15); }),
                `it lists the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0).slice(0, 15)} twice`],
            ['a value for a field it does not name', tamper(snapshot => { snapshot.objects[0].records[0].fieldValues.OwnerId = '005000000000000AAA'; }),
                `the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0)} holds other values than its fields`],
            ['a field with no value', tamper(snapshot => { delete snapshot.objects[0].records[0].fieldValues.Rating__c; }),
                `the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0)} holds other values than its fields`],
            ['a field named twice by its values in another case', tamper(snapshot => { snapshot.objects[0].records[0].fieldValues = { Legacy_Code__c: 'x', rating__c: 'y' }; }),
                `the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0)} has no usable value for Rating__c`],
            ['an object as a value', tamper(snapshot => { snapshot.objects[0].records[0].fieldValues.Rating__c = { nested: true }; }),
                `the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0)} has no usable value for Rating__c`],
            ['a list as a value', tamper(snapshot => { snapshot.objects[0].records[0].fieldValues.Rating__c = ['Hot']; }),
                `the Account record ${buildRecordId(ACCOUNT_ID_PREFIX, 0)} has no usable value for Rating__c`]
        ])('refuses the whole file for %s', (_description, snapshotText, expectedRefusal) => {

            expect(RecipeCockpitRecordUpdate.parseSnapshot(snapshotText)).toEqual({ refusal: expectedRefusal });

        });

        it('lists the tree\'s snapshots newest first, a same-second one above the first, and nothing that is not one', () => {

            writeSnapshotFile('20261022-090000-before.json');
            writeSnapshotFile('20261023-100000-before.json');
            writeSnapshotFile('20261023-100000-2-before.json');
            writeSnapshotFile('20261023-100000-10-before.json');
            writeSnapshotFile('20261023-100000-results.json');
            writeSnapshotFile('notes-before.json');
            writeSnapshotFile('20261023-100000-21-before.json');
            fs.mkdirSync(path.join(treeFolderPath, '20261024-100000-before.json'));
            fs.symlinkSync(path.join(treeFolderPath, '20261022-090000-before.json'), path.join(treeFolderPath, '20261025-100000-before.json'));

            expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY)).toEqual({
                snapshotFileNames: ['20261023-100000-10-before.json', '20261023-100000-2-before.json', '20261023-100000-before.json', '20261022-090000-before.json'],
                hiddenSnapshotCount: 0
            });

            // A LINK, A FOLDER AND A NAME NO UPDATE WRITES NEVER RESOLVE
            expect(RecipeCockpitRecordUpdate.resolveSnapshotFilePath(temporaryRoot, ACCOUNT_TREE_KEY, '20261023-100000-before.json')).toBe(path.join(treeFolderPath, '20261023-100000-before.json'));
            ['20261025-100000-before.json', '20261024-100000-before.json', 'notes-before.json', '../20261023-100000-before.json', '20261099-000000-before.json'].forEach(snapshotFileName => {
                expect(RecipeCockpitRecordUpdate.resolveSnapshotFilePath(temporaryRoot, ACCOUNT_TREE_KEY, snapshotFileName)).toBeUndefined();
            });

        });

        it('lists the snapshots in the tree\'s RunArtifacts and those written before #470 together, newest first, a name both hold once and resolved to RunArtifacts', () => {

            const location = makeTreeRunArtifactsLocation(temporaryRoot, 'recipe-2026-09-20T10-00-00', ACCOUNT_TREE_KEY);
            const newFolderPath = path.join(location.folderPath, RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME);
            fs.mkdirSync(newFolderPath, { recursive: true });
            writeSnapshotFile('20261022-090000-before.json');
            writeSnapshotFile('20261024-090000-before.json');
            fs.writeFileSync(path.join(newFolderPath, '20261023-100000-before.json'), '{}');
            fs.writeFileSync(path.join(newFolderPath, '20261024-090000-before.json'), '{}');

            expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY, location)).toEqual({
                snapshotFileNames: ['20261024-090000-before.json', '20261023-100000-before.json', '20261022-090000-before.json'],
                hiddenSnapshotCount: 0
            });
            expect(RecipeCockpitRecordUpdate.resolveSnapshotFilePath(temporaryRoot, ACCOUNT_TREE_KEY, '20261024-090000-before.json', location)).toBe(path.join(newFolderPath, '20261024-090000-before.json'));
            expect(RecipeCockpitRecordUpdate.resolveSnapshotFilePath(temporaryRoot, ACCOUNT_TREE_KEY, '20261022-090000-before.json', location)).toBe(path.join(treeFolderPath, '20261022-090000-before.json'));
            // WITHOUT THE LOCATION ONLY THE OLD FOLDER IS READ
            expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY).snapshotFileNames).toEqual(['20261024-090000-before.json', '20261022-090000-before.json']);

            // A FOLDER THAT CANNOT BE LISTED LISTS NOTHING, AND THE OTHER IS STILL READ
            const realReaddirSync = fs.readdirSync;
            const readdirSpy = jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, options?: any) => {
                if ( String(folderPath) === newFolderPath ) {
                    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
                }
                return (realReaddirSync as any)(folderPath, options);
            }) as any);
            expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY, location).snapshotFileNames).toEqual(['20261024-090000-before.json', '20261022-090000-before.json']);
            readdirSpy.mockRestore();

            // A RunArtifacts/UpdateAttempts THAT IS A LINK IS NOT READ
            fs.rmSync(newFolderPath, { recursive: true });
            const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-outside-snapshots-'));
            try {
                fs.writeFileSync(path.join(outsideFolderPath, '20261025-090000-before.json'), '{}');
                fs.symlinkSync(outsideFolderPath, newFolderPath);
                expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY, location).snapshotFileNames).toEqual(['20261024-090000-before.json', '20261022-090000-before.json']);
                expect(RecipeCockpitRecordUpdate.resolveSnapshotFilePath(temporaryRoot, ACCOUNT_TREE_KEY, '20261025-090000-before.json', location)).toBeUndefined();
            } finally {
                fs.rmSync(outsideFolderPath, { recursive: true, force: true });
            }

        });

        it('lists at most the newest fifty and counts the rest, and nothing for a folder name that is not plain or a tree with none', () => {

            for ( let snapshotIndex = 0; snapshotIndex < RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT + 3; snapshotIndex++ ) {
                writeSnapshotFile(`2026102${Math.floor(snapshotIndex / 60)}-1000${String(snapshotIndex % 60).padStart(2, '0')}-before.json`);
            }

            const snapshotList = RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, ACCOUNT_TREE_KEY);
            expect(snapshotList.snapshotFileNames).toHaveLength(RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT);
            expect(snapshotList.snapshotFileNames[0]).toBe('20261020-100052-before.json');
            expect(snapshotList.hiddenSnapshotCount).toBe(3);

            ['..', '.', 'a/b', 'CON', 'trailing.'].forEach(folderName => {
                expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, folderName)).toEqual({ snapshotFileNames: [], hiddenSnapshotCount: 0 });
            });
            expect(RecipeCockpitRecordUpdate.listSnapshots(temporaryRoot, 'Lead-ONLY')).toEqual({ snapshotFileNames: [], hiddenSnapshotCount: 0 });

        });

        it('refuses a file larger than any update writes without reading it, and one it cannot read', () => {

            writeSnapshotFile('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            const snapshotFilePath = path.join(treeFolderPath, '20261023-100000-before.json');
            const readSpy = jest.spyOn(fs, 'readFileSync');
            const closeSpy = jest.spyOn(fs, 'closeSync');
            jest.spyOn(fs, 'fstatSync').mockReturnValueOnce({ size: RECIPE_COCKPIT_UPDATE_SNAPSHOT_MAX_BYTES + 1, isFile: () => true } as fs.Stats);

            expect(RecipeCockpitRecordUpdate.readSnapshotFile(snapshotFilePath)).toEqual({ refusal: 'it is larger than any update writes' });
            expect(readSpy).not.toHaveBeenCalled();
            // THE HANDLE IS CLOSED ON A REFUSAL TOO
            expect(closeSpy).toHaveBeenCalledTimes(1);
            expect(RecipeCockpitRecordUpdate.readSnapshotFile(path.join(treeFolderPath, 'gone-before.json'))).toEqual({ refusal: 'it could not be read' });

        });

        it('reads the file through one handle that never follows a link, so a link swapped in after the check is refused', () => {

            fs.writeFileSync(path.join(temporaryRoot, 'outside.json'), JSON.stringify(validSnapshot()));
            fs.symlinkSync(path.join(temporaryRoot, 'outside.json'), path.join(treeFolderPath, '20261023-100000-before.json'));

            expect(RecipeCockpitRecordUpdate.readSnapshotFile(path.join(treeFolderPath, '20261023-100000-before.json'))).toEqual({ refusal: 'it could not be read' });

            // A FOLDER UNDER A SNAPSHOT'S NAME IS NOT READ EITHER
            fs.mkdirSync(path.join(treeFolderPath, '20261023-100001-before.json'));
            expect(RecipeCockpitRecordUpdate.readSnapshotFile(path.join(treeFolderPath, '20261023-100001-before.json'))).toEqual({ refusal: 'it could not be read' });

        });

    });

    describe('the host, against a faked org', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let orgRecords: Record<string, Map<string, Record<string, unknown>>>;
        let updateCalls: Array<{ objectApiName: string; records: any[]; options: any }>;
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let describeAnswers: Record<string, unknown>;
        let allOrNoneAnswer: boolean | undefined;
        let confirmationAnswers: Record<string, string | undefined>;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.inPanel).map(([warningText]) => warningText);
        const restoreConfirmations = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([title, options]) => options?.inPanel && String(title).startsWith('Restore '));
        const attemptsFolderPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, 'RunArtifacts', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME);
        // WHERE SNAPSHOTS WENT BEFORE #470, WHICH A RESTORE STILL FINDS
        const legacyAttemptsFolderPath = () => path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, ACCOUNT_TREE_KEY);
        const attemptFiles = () => [attemptsFolderPath(), legacyAttemptsFolderPath()].flatMap(folderPath => fs.existsSync(folderPath) ? fs.readdirSync(folderPath) : []).sort();
        const orgValues = (objectApiName: string, fieldApiName: string) => [...orgRecords[objectApiName].values()].map(record => record[fieldApiName]);

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const selectOrg = (isSandbox = true) => {
            panelState().dataOrgDetails = [SANDBOX_ORG];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1, orgTypeDetail: { isSandbox: isSandbox, organizationType: isSandbox ? 'Developer Edition' : 'Enterprise Edition' } };
        };

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg();
        };

        const loadGenerateAndUpdate = async () => {
            await send({
                command: 'loadUpdaterRecords',
                parentObjectApiName: 'Account',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [
                    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Rating__c'], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: '' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            });
            await send({
                command: 'generateUpdaterValues',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                fields: [
                    { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
                    { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' },
                    { objectApiName: 'Contact', fieldApiName: 'LastName' }
                ]
            });
            const valuesMessage = postedNamed('updaterValues').at(-1);
            await send({ command: 'updaterValuesRendered', renderSequence: valuesMessage.renderSequence, valuesSequence: valuesMessage.valuesSequence });
            await send({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
        };

        const listAndAcknowledgeSnapshots = async () => {
            await send({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            const snapshotsMessage = postedNamed('updaterSnapshots').at(-1);
            await send({ command: 'updaterSnapshotsRendered', renderSequence: snapshotsMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: snapshotsMessage.snapshotsSequence });
            return snapshotsMessage;
        };

        const writeWorkspaceSnapshot = (fileName: string, snapshotText: string, folderPath: string = legacyAttemptsFolderPath()) => {
            fs.mkdirSync(folderPath, { recursive: true });
            fs.writeFileSync(path.join(folderPath, fileName), snapshotText);
        };

        const requestRestore = (snapshotName: string) => send({ command: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: snapshotName });

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-updater-restore-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();
            SalesforceOrgService.clearDescribeCache();

            postedPanelMessages = [];
            updateCalls = [];
            organizationAnswers = [];
            allOrNoneAnswer = false;
            confirmationAnswers = {
                'Generate new values': RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
                'Update ': RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL,
                'Restore ': RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL
            };
            orgRecords = {
                Account: new Map([0, 1, 2].map(recordIndex => [buildRecordId(ACCOUNT_ID_PREFIX, recordIndex), { Id: buildRecordId(ACCOUNT_ID_PREFIX, recordIndex), Legacy_Code__c: `OLD-${recordIndex}`, Rating__c: recordIndex === 1 ? null : 'Warm' }])),
                Contact: new Map([0, 1].map(recordIndex => [buildRecordId(CONTACT_ID_PREFIX, recordIndex), { Id: buildRecordId(CONTACT_ID_PREFIX, recordIndex), LastName: `Old ${recordIndex}` }])),
                OtherChildObject__c: new Map()
            };
            describeAnswers = {
                Account: { name: 'Account', updateable: true, fields: [{ name: 'Legacy_Code__c', type: 'string', updateable: true }, { name: 'Rating__c', type: 'string', updateable: true }] },
                Contact: { name: 'Contact', updateable: true, fields: [{ name: 'LastName', type: 'string', updateable: true }] }
            };

            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false }));
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
                    const askedIds = [...soql.matchAll(/'([A-Za-z0-9]{15,18})'/g)].map(idMatch => idMatch[1]);
                    const records = [...orgRecords[objectApiName].values()]
                        .filter(record => !/WHERE Id IN/.test(soql) || askedIds.some(askedId => String(record.Id).startsWith(askedId)))
                        .map(record => ({ attributes: { type: objectApiName }, ...record }));
                    return { totalSize: records.length, done: true, records: records };
                },
                queryMore: async () => { throw new Error('no more pages'); },
                describe: async (objectApiName: string) => describeAnswers[objectApiName],
                sobject: (objectApiName: string) => ({
                    update: async (records: any[], options: any) => {
                        updateCalls.push({ objectApiName: objectApiName, records: records, options: options });
                        return records.map(record => {
                            const orgRecord = orgRecords[objectApiName].get(record.Id);
                            if ( !orgRecord ) {
                                return { success: false, errors: [{ statusCode: 'ENTITY_IS_DELETED', message: 'gone', fields: [] }] };
                            }
                            Object.keys(record).filter(key => key !== 'attributes' && key !== 'Id').forEach(fieldApiName => { orgRecord[fieldApiName] = record[fieldApiName]; });
                            return { id: record.Id, success: true, errors: [] };
                        });
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

        it('round-trips an update: the values it overwrote are put back by Id, after the values of now are saved as a snapshot of their own', async () => {

            await openCockpit();
            await loadGenerateAndUpdate();

            expect(orgValues('Account', 'Legacy_Code__c')).toEqual(['Legacy_Code__c-new-0', 'Legacy_Code__c-new-1', 'Legacy_Code__c-new-2']);
            expect(orgValues('Account', 'Rating__c')).toEqual(['Hot', 'Hot', 'Hot']);
            // THE UPDATE LISTED ITS SNAPSHOT ON ITS OWN
            const [updateSnapshotName] = attemptFiles().filter(fileName => fileName.endsWith('-before.json'));
            expect(postedNamed('updaterSnapshots').at(-1)).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, snapshotNames: [updateSnapshotName], hiddenSnapshotCount: 0 });

            const snapshotsMessage = await listAndAcknowledgeSnapshots();
            expect(snapshotsMessage.snapshotNames).toEqual([updateSnapshotName]);
            // NO PATH IS EVER POSTED
            expect(JSON.stringify(postedNamed('updaterSnapshots'))).not.toContain(workspaceRoot);

            updateCalls = [];
            await requestRestore(updateSnapshotName);

            const [[title, options, ...buttons]] = restoreConfirmations();
            expect(title).toBe('Restore 5 records of Account-thru-OtherChildObject__c in qa · qa@example.com.qa?');
            expect(options.isDestructive).toBe(true);
            expect(buttons).toEqual([RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL]);
            expect(options.detail.split('\n').slice(2, 6)).toEqual(['', 'Records and fields · 2', 'Account: 3 records -- Legacy_Code__c, Rating__c', 'Contact: 2 records -- LastName']);

            // PARENTS FIRST, ALL-OR-NONE AS CHOSEN, ONLY THE SNAPSHOT'S FIELDS
            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.records.length, updateCall.options])).toEqual([
                ['Account', 3, { allowRecursive: false, allOrNone: false }],
                ['Contact', 2, { allowRecursive: false, allOrNone: false }]
            ]);
            expect(orgValues('Account', 'Legacy_Code__c')).toEqual(['OLD-0', 'OLD-1', 'OLD-2']);
            expect(orgValues('Account', 'Rating__c')).toEqual(['Warm', null, 'Warm']);
            expect(orgValues('Contact', 'LastName')).toEqual(['Old 0', 'Old 1']);

            // ITS OWN SNAPSHOT (THE UPDATED VALUES) AND RESULTS, AND BOTH SNAPSHOTS LISTED, NEWEST FIRST
            const beforeFiles = attemptFiles().filter(fileName => fileName.endsWith('-before.json'));
            const resultsFiles = attemptFiles().filter(fileName => fileName.endsWith('-results.json'));
            expect(beforeFiles).toHaveLength(2);
            expect(resultsFiles).toHaveLength(2);
            const restoreSnapshotName = beforeFiles.find(fileName => fileName !== updateSnapshotName)!;
            const restoreSnapshot = JSON.parse(fs.readFileSync(path.join(attemptsFolderPath(), restoreSnapshotName), 'utf8'));
            expect(restoreSnapshot.objects[0].records[0]).toEqual({ recordId: buildRecordId(ACCOUNT_ID_PREFIX, 0), fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-0', Rating__c: 'Hot' } });
            const restoreResults = JSON.parse(fs.readFileSync(path.join(attemptsFolderPath(), restoreSnapshotName.replace('-before.json', '-results.json')), 'utf8'));
            expect(restoreResults).toMatchObject({ operation: 'restore', restoredFromSnapshotFile: updateSnapshotName, snapshotFile: restoreSnapshotName, outcome: 'completed', updatedRecordCount: 5, failedRecordCount: 0, missingRecordCount: 0 });
            expect(postedNamed('updaterSnapshots').at(-1).snapshotNames).toEqual([restoreSnapshotName, updateSnapshotName]);

            expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith(
                `5 records of Account-thru-OtherChildObject__c were restored in qa · qa@example.com.qa. Their old values are in ${restoreSnapshotName}.`,
                RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL
            );
            expect(postedNamed('updaterLoadState').slice(-2)).toEqual([
                { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore' },
                { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore', isRecordsSpent: true }
            ]);

            // AND THE RESTORE IS ITSELF RESTORABLE
            await listAndAcknowledgeSnapshots();
            await requestRestore(restoreSnapshotName);
            expect(orgValues('Account', 'Legacy_Code__c')).toEqual(['Legacy_Code__c-new-0', 'Legacy_Code__c-new-1', 'Legacy_Code__c-new-2']);

        });

        it('offers Restore only on a name it listed and the panel confirmed drawing, so a forged name routes to nothing', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await send({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            const snapshotsMessage = postedNamed('updaterSnapshots').at(-1);
            expect(snapshotsMessage.snapshotNames).toEqual(['20261023-100000-before.json']);

            const notRunning = { kind: 'refuseUpdaterLoad', hostMessage: { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore' } };
            const route = (snapshotName: unknown, treeKey: unknown = ACCOUNT_TREE_KEY) => RecipeCockpitService.routePanelMessage({ command: 'restoreUpdaterSnapshot', treeKey: treeKey, snapshotName: snapshotName }, panelState());

            // LISTED BUT NOT YET DRAWN
            expect(route('20261023-100000-before.json')).toEqual(notRunning);
            // AN ACK OF ANOTHER LIST, MODEL OR CARD ACTIVATES NOTHING
            expect(RecipeCockpitService.routePanelMessage({ command: 'updaterSnapshotsRendered', renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: snapshotsMessage.snapshotsSequence + 1 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updaterSnapshotsRendered', renderSequence: lastRenderSequence() + 1, treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: snapshotsMessage.snapshotsSequence }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'updaterSnapshotsRendered', renderSequence: lastRenderSequence(), treeKey: 'Lead-ONLY', snapshotsSequence: snapshotsMessage.snapshotsSequence }, panelState())).toBeUndefined();

            await send({ command: 'updaterSnapshotsRendered', renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: snapshotsMessage.snapshotsSequence });
            expect(route('20261023-100000-before.json')).toEqual({ kind: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: '20261023-100000-before.json' });

            // A NAME IT DID NOT LIST, A PATH, ANOTHER CARD, A NON-STRING
            [
                route('20261023-100001-before.json'),
                route('../../../../etc/passwd'),
                route(path.join(legacyAttemptsFolderPath(), '20261023-100000-before.json')),
                route(42),
                route('20261023-100000-before.json', 'Lead-ONLY')
            ].forEach(routed => expect(routed).toMatchObject({ kind: 'refuseUpdaterLoad', hostMessage: { isRunning: false } }));

            // A FORGED NAME POSTED FOR REAL WRITES AND SENDS NOTHING
            await requestRestore('20261023-100001-before.json');
            expect(updateCalls).toEqual([]);
            expect(restoreConfirmations()).toEqual([]);

            // A RELOADED DOCUMENT, A FAILURE TO DRAW AND A NEW MODEL EACH EMPTY THE LISTS
            await send({ command: 'ready' });
            expect(panelState().restorableSnapshots.size).toBe(0);
            expect(panelState().pendingRestorableSnapshots.size).toBe(0);

        });

        it('empties both lists on a failure to draw and on a new model', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();
            expect(panelState().restorableSnapshots.get(ACCOUNT_TREE_KEY)?.has('20261023-100000-before.json')).toBe(true);

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            await send({ command: 'renderFailed', message: 'draw failed', stack: '', phase: 'render' });
            expect(panelState().restorableSnapshots.size).toBe(0);
            expect(panelState().pendingRestorableSnapshots.size).toBe(0);

            await send({ command: 'rendered', renderSequence: lastRenderSequence() });
            await listAndAcknowledgeSnapshots();
            expect(panelState().restorableSnapshots.size).toBe(1);
            await send({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            expect(panelState().pendingRestorableSnapshots.size).toBe(1);

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await flushAsyncWork();
            expect(panelState().restorableSnapshots.size).toBe(0);
            expect(panelState().pendingRestorableSnapshots.size).toBe(0);

        });

        it('lists nothing for a card with no folder or a model not on screen', async () => {

            await openCockpit();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() + 1 }, panelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadUpdaterSnapshots', treeKey: 'Not-A-Tree', renderSequence: lastRenderSequence() }, panelState())).toBeUndefined();

            await send({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            expect(postedNamed('updaterSnapshots').at(-1)).toMatchObject({ snapshotNames: [], hiddenSnapshotCount: 0 });

        });

        it.each([
            ['malformed JSON', () => '{ "orgUsername": "qa@example.com.qa", ', 'Nothing was restored: 20261023-100000-before.json was refused, because it is not JSON.'],
            ['an Id written to break out of the query', () => { const snapshot: any = validSnapshot(); snapshot.objects[0].records[0].recordId = '001\') OR (Id != \''; return JSON.stringify(snapshot); },
                'Nothing was restored: 20261023-100000-before.json was refused, because a record of Account in it has no Salesforce Id or no values.'],
            ['another org', () => JSON.stringify({ ...validSnapshot(), orgUsername: 'prod@example.com' }),
                'Nothing was restored: 20261023-100000-before.json was taken in prod@example.com, not qa · qa@example.com.qa. Select that org in Target Org Manager.'],
            ['another tree', () => JSON.stringify({ ...validSnapshot(), treeFolderName: 'Lead-ONLY' }),
                `Nothing was restored: 20261023-100000-before.json names the tree Lead-ONLY, not ${ACCOUNT_TREE_KEY}.`],
            ['an object that is not the tree\'s', () => { const snapshot: any = validSnapshot(); snapshot.objects[0].objectApiName = 'Opportunity'; return JSON.stringify(snapshot); },
                'Nothing was restored: 20261023-100000-before.json names Opportunity, which is not an object of Account-thru-OtherChildObject__c.'],
            ['a field the run does not have', () => { const snapshot: any = validSnapshot(); snapshot.objects[0].fieldApiNames = ['Bogus__c']; snapshot.objects[0].records.forEach((record: any) => { record.fieldValues = { Bogus__c: 'x' }; }); return JSON.stringify(snapshot); },
                'Nothing was restored: 20261023-100000-before.json names Account.Bogus__c, which the Treecipe Adapter does not write: it is not a field of the object in this run.'],
            ['a lookup', () => { const snapshot: any = validSnapshot(); snapshot.objects[0].fieldApiNames = ['OwnerId']; snapshot.objects[0].records.forEach((record: any) => { record.fieldValues = { OwnerId: '005000000000000AAA' }; }); return JSON.stringify(snapshot); },
                'Nothing was restored: 20261023-100000-before.json names Account.OwnerId, which the Treecipe Adapter does not write: a lookup points to another record, which the Adapter does not change.']
        ])('refuses a tampered snapshot with %s, and connects to and writes nothing', async (_description, buildSnapshotText, expectedWarning) => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', buildSnapshotText());
            const getConnectionSpy = SalesforceOrgService.getConnection as jest.Mock;
            getConnectionSpy.mockClear();
            await listAndAcknowledgeSnapshots();
            await requestRestore('20261023-100000-before.json');

            expect(warnings()).toContain(expectedWarning);
            expect(getConnectionSpy).not.toHaveBeenCalled();
            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual(['20261023-100000-before.json']);
            expect(postedNamed('updaterLoadState').at(-1)).toEqual({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore' });

        });

        it('refuses a snapshot that was removed, or replaced by a link, after it was listed', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            fs.rmSync(path.join(legacyAttemptsFolderPath(), '20261023-100000-before.json'));
            fs.writeFileSync(path.join(temporaryRoot, 'outside.json'), JSON.stringify(validSnapshot()));
            fs.symlinkSync(path.join(temporaryRoot, 'outside.json'), path.join(legacyAttemptsFolderPath(), '20261023-100000-before.json'));
            await requestRestore('20261023-100000-before.json');

            expect(warnings()).toContain('Nothing was restored: 20261023-100000-before.json is no longer where it was listed from.');
            expect(updateCalls).toEqual([]);

        });

        it('leaves out a record the org no longer returns, and says so before it asks', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            orgRecords.Account.delete(buildRecordId(ACCOUNT_ID_PREFIX, 0));
            await listAndAcknowledgeSnapshots();
            await requestRestore('20261023-100000-before.json');

            const [[title, options]] = restoreConfirmations();
            expect(title).toBe('Restore 1 record of Account-thru-OtherChildObject__c in qa · qa@example.com.qa?');
            expect(options.detail).toContain('1 record of the snapshot is no longer in the org, or not visible to this user, and will not be restored.');
            // THE 15-CHARACTER Id IN THE FILE IS SENT AS THE ORG'S 18-CHARACTER ONE
            expect(updateCalls).toEqual([{
                objectApiName: 'Account',
                records: [{ attributes: { type: 'Account' }, Id: buildRecordId(ACCOUNT_ID_PREFIX, 1), Legacy_Code__c: 7, Rating__c: true }],
                options: { allowRecursive: false, allOrNone: false }
            }]);

            orgRecords.Account.clear();
            (vscode.window.showWarningMessage as jest.Mock).mockClear();
            await listAndAcknowledgeSnapshots();
            await requestRestore('20261023-100000-before.json');
            expect(warnings()).toContain('Nothing was restored: none of the records in 20261023-100000-before.json are in qa · qa@example.com.qa any more.');

        });

        it('applies the update\'s guards: a field the org will not let be updated, a non-sandbox answer after the confirmation, a dismissed question, a failed save of the values of now', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            // THE ORGANIZATION ROW, ASKED AGAIN ON THE CONNECTION, IS NOT A SANDBOX
            organizationAnswers = [{ IsSandbox: false, OrganizationType: 'Enterprise Edition' }];
            await requestRestore('20261023-100000-before.json');
            expect(warnings().at(-1)).toMatch(/^Nothing was restored in qa · qa@example\.com\.qa: it answered/);

            // CANCEL, THEN NO ALL-OR-NONE ANSWER
            confirmationAnswers['Restore '] = undefined;
            await requestRestore('20261023-100000-before.json');
            confirmationAnswers['Restore '] = RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL;
            allOrNoneAnswer = undefined;
            await requestRestore('20261023-100000-before.json');
            allOrNoneAnswer = false;

            // THE VALUES OF NOW CANNOT BE SAVED
            jest.spyOn(RecipeCockpitRecordUpdate, 'writeSnapshot').mockReturnValueOnce(undefined);
            await requestRestore('20261023-100000-before.json');
            expect(warnings().at(-1)).toBe(RECIPE_COCKPIT_UPDATER_RESTORE_SNAPSHOT_FAILED_REFUSAL);

            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual(['20261023-100000-before.json']);

            // A FIELD THE ORG CALCULATES
            SalesforceOrgService.clearDescribeCache();
            jest.spyOn(SalesforceOrgService, 'describeObjects').mockResolvedValueOnce({
                outcomes: [{ objectApiName: 'Account', describe: { objectApiName: 'Account', isUpdateable: true, fields: [{ fieldApiName: 'Legacy_Code__c', isUpdateable: false, isCalculated: true }, { fieldApiName: 'Rating__c', isUpdateable: true, isCalculated: false }] } }]
            } as any);
            await requestRestore('20261023-100000-before.json');
            expect(warnings().at(-1)).toBe('Nothing was restored in qa · qa@example.com.qa: Account.Legacy_Code__c is calculated in the org, so it cannot be updated.');
            expect(updateCalls).toEqual([]);

        });

        it('with all-or-none, stops at a failed request and sets back what the restore changed', async () => {

            await openCockpit();
            const snapshot: any = validSnapshot();
            snapshot.objects.push({ objectApiName: 'Contact', fieldApiNames: ['LastName'], records: [{ recordId: buildRecordId(CONTACT_ID_PREFIX, 0), fieldValues: { LastName: 'Restored' } }] });
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(snapshot));
            await listAndAcknowledgeSnapshots();
            allOrNoneAnswer = true;

            const contactUpdate = jest.fn();
            const getConnection = SalesforceOrgService.getConnection as jest.Mock;
            const fakedConnection = await getConnection('qa@example.com.qa');
            getConnection.mockResolvedValue({
                ...fakedConnection,
                sobject: (objectApiName: string) => objectApiName === 'Contact'
                    ? { update: async (records: any[]) => { contactUpdate(records); return records.map(() => ({ success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] }] })); } }
                    : fakedConnection.sobject(objectApiName)
            });

            await requestRestore('20261023-100000-before.json');

            expect(contactUpdate).toHaveBeenCalledTimes(1);
            // ACCOUNT WAS RESTORED, THEN SET BACK TO WHAT IT HELD BEFORE THE RESTORE
            expect(orgValues('Account', 'Legacy_Code__c')).toEqual(['OLD-0', 'OLD-1', 'OLD-2']);
            expect(orgValues('Account', 'Rating__c')).toEqual(['Warm', null, 'Warm']);
            expect(updateCalls.map(updateCall => [updateCall.objectApiName, updateCall.options.allOrNone])).toEqual([['Account', true], ['Account', false]]);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringMatching(/^The restore of Account-thru-OtherChildObject__c in qa · qa@example\.com\.qa stopped at a request that failed: 1 record failed\. The 2 records it had restored were set back/),
                expect.anything()
            );

        });

        it('stops quietly when the read of the current values is cancelled, and refuses an answer it cannot read', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            // THE READ IS A CANCELLABLE PROGRESS OF ITS OWN
            (vscode.window.withProgress as jest.Mock).mockImplementationOnce(async (options: any, progressTask: any) => {
                expect(options).toMatchObject({ cancellable: true, title: 'Recipe Cockpit: reading the current values of Account-thru-OtherChildObject__c in qa · qa@example.com.qa' });
                return await progressTask({ report: jest.fn() }, { isCancellationRequested: true });
            });
            await requestRestore('20261023-100000-before.json');
            expect(restoreConfirmations()).toEqual([]);
            expect(warnings()).toEqual([]);
            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual(['20261023-100000-before.json']);

            // AN ANSWER THAT IS NOT DONE IN ONE PAGE IS NOT READ AS NONE
            const getConnection = SalesforceOrgService.getConnection as jest.Mock;
            const fakedConnection = await getConnection('qa@example.com.qa');
            getConnection.mockResolvedValue({
                ...fakedConnection,
                query: async (soql: string) => /FROM Organization/.test(soql) ? fakedConnection.query(soql) : { done: false, records: [] }
            });
            await requestRestore('20261023-100000-before.json');
            expect(warnings()).toContain('Nothing was restored: the current values of the records could not be read from qa · qa@example.com.qa.');
            expect(restoreConfirmations()).toEqual([]);

            // A CONNECTION THAT CANNOT BE OPENED QUOTES NOTHING OF ITS ERROR
            getConnection.mockRejectedValue(new Error('token=SECRET'));
            await requestRestore('20261023-100000-before.json');
            expect(warnings().at(-1)).toMatch(/^Nothing was restored: qa · qa@example\.com\.qa could not be connected to\./);
            expect(warnings().join('\n')).not.toContain('SECRET');
            expect(updateCalls).toEqual([]);

        });

        it('refuses a snapshot that holds no records, and a selection that changed while the confirmation was open', async () => {

            await openCockpit();
            const emptySnapshot: any = validSnapshot();
            emptySnapshot.objects[0].records = [];
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(emptySnapshot));
            writeWorkspaceSnapshot('20261023-100001-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            await requestRestore('20261023-100000-before.json');
            expect(warnings()).toContain('Nothing was restored: 20261023-100000-before.json holds no records.');

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string, options?: { inPanel?: boolean }) => {
                if ( options?.inPanel && message.startsWith('Restore ') ) {
                    selectOrg();
                    return Promise.resolve(RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL);
                }
                return Promise.resolve(undefined);
            });
            await requestRestore('20261023-100001-before.json');
            expect(warnings()).toContain('Nothing was restored: the run or the org selection changed after qa · qa@example.com.qa was confirmed.');
            expect(updateCalls).toEqual([]);
            expect(attemptFiles()).toEqual(['20261023-100000-before.json', '20261023-100001-before.json']);

        });

        it('says the org decides a picklist on an object with record types, as the update does', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            await requestRestore('20261023-100000-before.json');
            expect(restoreConfirmations()[0][1].detail).not.toContain(RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE);

            describeAnswers = {
                ...describeAnswers,
                Account: { name: 'Account', updateable: true, fields: [{ name: 'Legacy_Code__c', type: 'string', updateable: true }, { name: 'Rating__c', type: 'picklist', updateable: true }] }
            };
            SalesforceOrgService.clearDescribeCache();
            await requestRestore('20261023-100000-before.json');
            expect(restoreConfirmations()[1][1].detail.split('\n').slice(2, 3)).toEqual([RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE]);

        });

        it('shares the update\'s one run per window and holds the org selection while it runs', async () => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();

            const runningLoad = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' } as const;
            panelState().updaterLoadStateMessage = runningLoad;
            expect(RecipeCockpitService.routePanelMessage({ command: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: '20261023-100000-before.json' }, panelState()))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: runningLoad });

            panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore' };
            expect(RecipeCockpitService.isSelectionHeldByPromptOrUpdater(panelState())).toBe(true);
            expect(RecipeCockpitService.routePanelMessage({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY }, panelState())).toMatchObject({ kind: 'refuseUpdaterLoad', hostMessage: { runKind: 'restore', isRunning: true } });
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState())).toBeUndefined();
            panelState().updaterLoadStateMessage = undefined;

            // ONE THAT REACHES THE EXECUTOR WHILE A RUN IS IN FLIGHT IS ANSWERED WITH THAT RUN'S STATE AND STARTS NOTHING
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = runningLoad;
            await requestRestore('20261023-100000-before.json');
            expect(postedNamed('updaterLoadState').at(-1)).toEqual(runningLoad);
            expect(restoreConfirmations()).toEqual([]);
            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;

        });

        it.each([
            ['an insert', (state: IRecipeCockpitPanelState) => { state.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY }; }],
            ['a metadata deploy', (state: IRecipeCockpitPanelState) => { state.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, deployKind: 'fields' }; }],
            ['a load asking for an org', (state: IRecipeCockpitPanelState) => { state.isUpdaterOrgPromptOpen = true; }],
            ['a query asking for an org', (state: IRecipeCockpitPanelState) => { state.isQueryOrgPromptOpen = true; }]
        ])('refuses a restore while %s holds the org selection, and one into an org that is not a sandbox', async (_description, holdSelection) => {

            await openCockpit();
            writeWorkspaceSnapshot('20261023-100000-before.json', JSON.stringify(validSnapshot()));
            await listAndAcknowledgeSnapshots();
            const route = () => RecipeCockpitService.routePanelMessage({ command: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: '20261023-100000-before.json' }, panelState());

            selectOrg(false);
            expect(route()).toMatchObject({ refusalText: 'Nothing was restored: qa is not a sandbox or scratch org, and the Treecipe Adapter restores only a sandbox or scratch org.' });
            panelState().dataOrgSelection = undefined;
            expect(route()).toMatchObject({ refusalText: 'Nothing was restored: choose the sandbox or scratch org the update was made in, in Target Org Manager.' });

            selectOrg();
            holdSelection(panelState());
            expect(route()).toMatchObject({ kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_UPDATER_RESTORE_BUSY_REFUSAL });

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

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        const snapshotsMessage = {
            command: 'updaterSnapshots',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            snapshotNames: ['20261023-100000-2-before.json', '<img src=x>-before.json'],
            hiddenSnapshotCount: 3,
            snapshotsSequence: 4
        };

        it('asks for the card\'s snapshots when the tab opens, lists them by name, acks the list and posts only the name on Restore', () => {

            const { panel, updaterPanel } = renderUpdater();
            expect(postedNamed(panel, 'loadUpdaterSnapshots')).toEqual([{ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 }]);
            expect(panel.findAll(updaterPanel, 'updaterSnapshotsHeading')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_SNAPSHOTS_HEADING);

            // ANOTHER MODEL'S LIST IS NOT DRAWN OR ACKED
            panel.postToPanel({ ...snapshotsMessage, renderSequence: 2 });
            expect(postedNamed(panel, 'updaterSnapshotsRendered')).toEqual([]);

            panel.postToPanel(snapshotsMessage);
            expect(postedNamed(panel, 'updaterSnapshotsRendered')).toEqual([{ command: 'updaterSnapshotsRendered', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: 4 }]);
            expect(panel.findAll(updaterPanel, 'updaterSnapshotName').map((nameElement: any) => nameElement.textContent)).toEqual(snapshotsMessage.snapshotNames);
            expect(panel.findAll(updaterPanel, 'updaterSnapshotsNote').map((noteElement: any) => noteElement.textContent)).toEqual(['3 older not shown: they are in RunArtifacts/UpdateAttempts in the tree folder, or in treecipe/UpdateAttempts for updates made before it.']);

            const restoreButtons = panel.findAll(updaterPanel, 'updaterRestore');
            expect(restoreButtons.map((restoreButton: any) => restoreButton.textContent)).toEqual([RECIPE_COCKPIT_UPDATER_RESTORE_LABEL, RECIPE_COCKPIT_UPDATER_RESTORE_LABEL]);
            expect(restoreButtons[0].classList.contains('sdtButton-secondary')).toBe(true);
            expect(restoreButtons[0].disabled).toBe(false);

            restoreButtons[0].dispatch('click');
            expect(postedNamed(panel, 'restoreUpdaterSnapshot')).toEqual([{ command: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: '20261023-100000-2-before.json' }]);
            expect(restoreButtons[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_RESTORING_LABEL);
            expect(restoreButtons[1].textContent).toBe(RECIPE_COCKPIT_UPDATER_RESTORE_LABEL);
            expect(restoreButtons.every((restoreButton: any) => restoreButton.disabled)).toBe(true);

            // A SECOND CLICK WHILE IT RUNS POSTS NOTHING, AND THE HOST'S ANSWER GIVES THE BUTTONS BACK
            restoreButtons[1].dispatch('click');
            expect(postedNamed(panel, 'restoreUpdaterSnapshot')).toHaveLength(1);
            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'restore' });
            expect(restoreButtons[0].disabled).toBe(false);
            expect(restoreButtons[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_RESTORE_LABEL);

            // ANY OTHER UPDATER RUN HOLDS THEM TOO
            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            expect(restoreButtons[0].disabled).toBe(true);
            expect(restoreButtons[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_RESTORE_LABEL);

        });

        it('says when the tree has no snapshot yet', () => {

            const { panel, updaterPanel } = renderUpdater();
            panel.postToPanel({ ...snapshotsMessage, snapshotNames: [], hiddenSnapshotCount: 0 });
            expect(panel.findAll(updaterPanel, 'updaterSnapshotsNote').map((noteElement: any) => noteElement.textContent)).toEqual([RECIPE_COCKPIT_UPDATER_NO_SNAPSHOTS_NOTE]);
            expect(panel.findAll(updaterPanel, 'updaterRestore')).toEqual([]);

        });

    });

});
