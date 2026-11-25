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
import { IRecipeCockpitPanelState } from '../RecipeCockpitViewModel';
import {
    RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL,
    RecipeCockpitAdapterRecords
} from '../RecipeCockpitAdapterRecords';
import { RecipeCockpitAdapterState } from '../RecipeCockpitAdapterState';
import { RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH } from '../RecipeCockpitTreecipeFieldEditorConstants';
import {
    RECIPE_COCKPIT_UPDATER_ID_COLUMN_LOCK_REASON,
    RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE,
    RecipeCockpitAdapterEdits
} from '../RecipeCockpitAdapterEdits';
import { RECIPE_COCKPIT_UPDATER_LOOKUP_REASON, RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON } from '../RecipeCockpitAdapterConstants';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';

// A RECORD Id OF THE SALESFORCE SHAPE, SINCE THE LOAD NARROWS A CHILD ONLY BY Ids THAT ARE (#444)
const fakeRecordId = (objectApiName: string, recordIndex: number) =>
    `${({ Account: '001', Contact: '003', OtherChildObject__c: 'a01' } as Record<string, string>)[objectApiName] ?? 'a99'}${String(recordIndex).padStart(15, '0')}`;

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

answerInPanelConfirmationsThroughWarningMock();

// AN ORG SELECTED HERE HAS NO LOCAL AUTHORIZATION READ FOR ITS LABEL (#458, #499); RecipeCockpitDataByOrg.test.ts COVERS THE LABEL
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, the Treecipe Adapter\'s edits of existing records (#721)', () => {

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
        // WHAT AN UPDATE THAT LANDED ADDS TO ITS NOTIFICATION (#448): THE ADAPTED DATA SET AND RECIPE IT WROTE

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

        // WHAT AN UPDATE WOULD WRITE NOW, AS THE HOST PLANS IT

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

        // THE ORG DESCRIBES MORE OF Account HERE, SO THE TABLE HAS A LOCKED COLUMN OF EACH KIND AND ONE WITH NO EXPRESSION
        const describeWideAccount = () => {
            describeAnswers.Account = {
                name: 'Account',
                updateable: true,
                fields: ['Name', 'Legacy_Code__c', 'Rating__c', 'Sub_Rating__c', 'Regions__c', 'ParentId'].map(fieldApiName => ({ name: fieldApiName, type: 'string', updateable: true }))
            };
        };

        const openCockpitAndLoad = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({
                command: 'loadUpdaterRecords',
                parentObjectApiName: 'Account',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [{ objectApiName: 'Account', whereClause: '' }, { objectApiName: 'Contact', whereClause: '' }, { objectApiName: 'OtherChildObject__c', whereClause: '' }]
            });
        };

        const loadedObject = (objectApiName: string) => postedNamed('updaterRecords').at(-1).objects.find((objectRecords: any) => objectRecords.objectApiName === objectApiName);
        const columnIndexOf = (objectApiName: string, fieldApiName: string): number => loadedObject(objectApiName).columns.indexOf(fieldApiName);
        const editMessage = (editKind: string, position: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => ({
            command: 'editUpdaterRecords', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account', pageIndex: 0, editKind: editKind, ...position, ...overrides
        });
        const edit = (editKind: string, position: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => send(editMessage(editKind, position, overrides));
        const lastPage = () => postedNamed('updaterRecordsPage').at(-1);
        const cellOf = (rowIndex: number, fieldApiName: string) => lastPage().rows[rowIndex][columnIndexOf('Account', fieldApiName)];
        const backendRuns = () => generateSpy.mock.calls.map(([, fakerService, objectApiName, valueCount, fields]) => ({ fakerService, objectApiName, valueCount, fields }));
        let generateSpy: jest.SpyInstance;

        beforeEach(() => {
            generateSpy = jest.spyOn(RecipeCockpitAdapterRecords, 'generateUpdaterObjectValues');
        });

        describe('what a load says of each column', () => {

            it('locks the Id, a lookup, a dependent picklist and a field read only from the recipe file, each with its reason, and gives 🎲 only to a field with an expression', async () => {

                describeWideAccount();
                await openCockpitAndLoad();

                const account = loadedObject('Account');
                expect(Object.fromEntries(account.columns.map((column: string, columnIndex: number) => [column, account.columnEdits[columnIndex]]))).toEqual({
                    Id: { lockReason: RECIPE_COCKPIT_UPDATER_ID_COLUMN_LOCK_REASON, canGenerate: false },
                    ParentId: { lockReason: RECIPE_COCKPIT_UPDATER_LOOKUP_REASON, canGenerate: false },
                    Name: { lockReason: RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON, canGenerate: false },
                    Legacy_Code__c: { canGenerate: true },
                    Rating__c: { canGenerate: true },
                    Sub_Rating__c: { lockReason: 'depends on Rating__c', canGenerate: false },
                    // A TODO IN THE RECIPE: NO EXPRESSION TO GENERATE FROM, AND NOT LOCKED
                    Regions__c: { canGenerate: false }
                });
                expect(account).toMatchObject({ markedRowIndexes: [], changedCells: [], editSummary: { markedRecordCount: 0, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } });

            });

        });

        describe('marking rows', () => {

            it('marks and unmarks a row by its position, answering with the page and the object\'s totals, and changing nothing in the org', async () => {

                await openCockpitAndLoad();

                await edit('markRow', { rowIndex: 1 });
                expect(lastPage()).toMatchObject({ command: 'updaterRecordsPage', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', pageIndex: 0, markedRowIndexes: [1], changedCells: [], editSummary: { markedRecordCount: 1, updatableRecordCount: 0 } });
                expect(lastPage()).not.toHaveProperty('columns');

                await edit('markRow', { rowIndex: 0 });
                await edit('markRow', { rowIndex: 0 });
                expect(lastPage().markedRowIndexes).toEqual([0, 1]);

                await edit('unmarkRow', { rowIndex: 1 });
                expect(lastPage()).toMatchObject({ markedRowIndexes: [0], editSummary: { markedRecordCount: 1 } });
                expect(updateCalls).toEqual([]);
                expect(generateSpy).not.toHaveBeenCalled();

            });

            it('keeps a reopened panel\'s first page as the host holds it', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 2 });
                await edit('generateCell', { rowIndex: 2, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                const replayedAccount = panelState().updaterRecordsMessage!.objects.find(objectRecords => objectRecords.objectApiName === 'Account')!;
                expect(replayedAccount).toMatchObject({ markedRowIndexes: [2], changedCells: [[2, columnIndexOf('Account', 'Legacy_Code__c')]], editSummary: { markedRecordCount: 1, updatableRecordCount: 1, changedFieldApiNames: ['Legacy_Code__c'] } });
                expect(replayedAccount.rows[2][columnIndexOf('Account', 'Legacy_Code__c')]).toBe('Legacy_Code__c-new-0');
                expect(replayedAccount.columns).toEqual(['Id', 'Legacy_Code__c', 'Rating__c']);

            });

        });

        describe('🎲 on a cell and on a column', () => {

            it('makes a value for one cell of a marked row from the recipe\'s own expression, with the recipe\'s backend, and changes no other cell', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 1 });
                await edit('generateCell', { rowIndex: 1, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Legacy_Code__c')])).toEqual(['OLD-0', 'Legacy_Code__c-new-0', 'OLD-2']);
                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Rating__c')])).toEqual(['Warm', 'Warm', 'Warm']);
                expect(lastPage()).toMatchObject({ changedCells: [[1, columnIndexOf('Account', 'Legacy_Code__c')]], editSummary: { markedRecordCount: 1, updatableRecordCount: 1, changedFieldApiNames: ['Legacy_Code__c'], hasUnmarkedChanges: false } });
                // THE FIXTURE'S RECIPE IS A SNOWFAKERY ONE, AND THE EXPRESSION IS THE RECIPE'S OWN
                expect(backendRuns()).toEqual([{ fakerService: 'snowfakery', objectApiName: 'Account', valueCount: RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE, fields: [{ fieldApiName: 'Legacy_Code__c', valueText: '"${{fake.Word}}"' }] }]);
                expect(confirmations()).toEqual([]);
                expect(updateCalls).toEqual([]);

            });

            it('runs a faker-js recipe\'s expression with faker-js', async () => {

                await openCockpitAndLoad();
                jest.spyOn(RecipeCockpitService, 'readTreeFakerService').mockReturnValue('faker-js');
                await edit('markRow', { rowIndex: 0 });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(backendRuns().map(backendRun => backendRun.fakerService)).toEqual(['faker-js']);
                expect(RecipeCockpitAdapterRecords.createUpdaterRecipeProcessor).toHaveBeenCalledWith('faker-js');
                expect(cellOf(0, 'Legacy_Code__c')).toBe('Legacy_Code__c-new-0');

            });

            it('hands out one run\'s values a click at a time, and runs the backend again only when they are used up', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                const legacyColumnIndex = columnIndexOf('Account', 'Legacy_Code__c');

                for ( let clickNumber = 1; clickNumber <= RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE; clickNumber++ ) {
                    await edit('generateCell', { rowIndex: 0, columnIndex: legacyColumnIndex });
                }
                expect(generateSpy).toHaveBeenCalledTimes(1);
                expect(cellOf(0, 'Legacy_Code__c')).toBe(`Legacy_Code__c-new-${RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE - 1}`);

                await edit('generateCell', { rowIndex: 0, columnIndex: legacyColumnIndex });
                expect(generateSpy).toHaveBeenCalledTimes(2);
                expect(cellOf(0, 'Legacy_Code__c')).toBe('Legacy_Code__c-new-0');

                // ANOTHER FIELD HAS VALUES OF ITS OWN
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Rating__c') });
                expect(generateSpy).toHaveBeenCalledTimes(3);
                expect(cellOf(0, 'Rating__c')).toBe('Rating__c-new-0');

            });

            it('makes no value for a cell of a row that is not marked', async () => {

                await openCockpitAndLoad();
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(generateSpy).not.toHaveBeenCalled();
                expect(lastPage().changedCells).toEqual([]);

            });

            it('fills a column for the marked rows only, in one run, and leaves the rows that are not marked as loaded', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await edit('markRow', { rowIndex: 2 });
                await edit('generateColumn', { columnIndex: columnIndexOf('Account', 'Rating__c') });

                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Rating__c')])).toEqual(['Rating__c-new-0', 'Warm', 'Rating__c-new-1']);
                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Legacy_Code__c')])).toEqual(['OLD-0', 'OLD-1', 'OLD-2']);
                expect(lastPage().editSummary).toEqual({ markedRecordCount: 2, updatableRecordCount: 2, changedFieldApiNames: ['Rating__c'], hasUnmarkedChanges: false });
                expect(generateSpy).toHaveBeenCalledTimes(1);

            });

            it('fills a column of more marked rows than one run\'s values in a single run of that many, behind a progress that can cancel', async () => {

                recordCountByObject = { Account: 120, Contact: 0, OtherChildObject__c: 0 };
                await openCockpitAndLoad();
                const accountEdits = RecipeCockpitAdapterEdits.readObjectEdits(RecipeCockpitAdapterState.heldUpdaterRecords!, 'Account');
                Array.from({ length: 120 }, (_unused, recordIndex) => accountEdits.markedRecordIds.add(fakeRecordId('Account', recordIndex)));
                (vscode.window.withProgress as jest.Mock).mockClear();

                await edit('generateColumn', { columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(backendRuns().map(backendRun => backendRun.valueCount)).toEqual([120]);
                expect((vscode.window.withProgress as jest.Mock).mock.calls.map(([options]) => options)).toEqual([expect.objectContaining({ title: 'Recipe Cockpit: generating 120 values for Account.Legacy_Code__c with snowfakery', cancellable: true })]);
                expect(lastPage().editSummary).toMatchObject({ markedRecordCount: 120, updatableRecordCount: 120 });

                // THE SECOND PAGE SHOWS ITS OWN MARKS AND VALUES
                await send({ command: 'loadUpdaterRecordsPage', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account', pageIndex: 1 });
                expect(lastPage()).toMatchObject({ pageIndex: 1, markedRowIndexes: Array.from({ length: 50 }, (_unused, rowIndex) => rowIndex) });
                expect(lastPage().rows[0][columnIndexOf('Account', 'Legacy_Code__c')]).toBe('Legacy_Code__c-new-50');

            });

            it('uses a fixed value from the Treecipe tab as it is, for a cell and for a column, and runs nothing for it', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                selectOrg(SANDBOX_ORG);
                const accountTree = panelState().recipeDataMessage!.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)!;
                accountTree.fixedValues = [{ objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot', kind: 'text' } as any];
                await send({ command: 'loadUpdaterRecords', parentObjectApiName: 'Account', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(),
                    objects: [{ objectApiName: 'Account', whereClause: '' }, { objectApiName: 'Contact', whereClause: '' }, { objectApiName: 'OtherChildObject__c', whereClause: '' }] });

                await edit('markRow', { rowIndex: 0 });
                await edit('markRow', { rowIndex: 1 });
                await edit('generateColumn', { columnIndex: columnIndexOf('Account', 'Rating__c') });

                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Rating__c')])).toEqual(['Hot', 'Hot', 'Warm']);
                expect(generateSpy).not.toHaveBeenCalled();

            });

            it('counts a value equal to the one loaded as no change, so an update never writes a record its own value', async () => {

                await openCockpitAndLoad();
                generateSpy.mockResolvedValue({ records: Array.from({ length: RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE }, () => ({ Rating__c: 'Warm' })) });
                await edit('markRow', { rowIndex: 0 });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Rating__c') });

                expect(lastPage()).toMatchObject({ changedCells: [], editSummary: { markedRecordCount: 1, updatableRecordCount: 0 } });

            });

            it('says once why no value was made, names the field, changes no cell and gives the buttons back', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                generateSpy.mockResolvedValueOnce({ refusal: 'snowfakery is not installed.' });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(warnings()).toEqual(['No value was generated for Account.Legacy_Code__c: snowfakery is not installed.']);
                expect(lastPage().changedCells).toEqual([]);
                expect(postedNamed('updaterLoadState').slice(-2)).toEqual([
                    { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' },
                    { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' }
                ]);

                // A BACKEND THAT THREW, AND A CARD WHOSE BACKEND CANNOT BE TOLD
                generateSpy.mockRejectedValueOnce(new Error('spawn ENOENT'));
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
                expect(warnings().at(-1)).toBe('No value was generated for Account.Legacy_Code__c: spawn ENOENT');

                jest.spyOn(RecipeCockpitService, 'readTreeFakerService').mockReturnValue(undefined);
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
                expect(warnings().at(-1)).toBe('No value was generated for Account.Legacy_Code__c: this card has no single recipe file whose faker backend can be told.');
                expect(RecipeCockpitAdapterState.isUpdaterLoadInFlight).toBe(false);

            });

            it('keeps no value made for records that were let go, or replaced, while the backend ran', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                const pageCount = postedNamed('updaterRecordsPage').length;
                generateSpy.mockImplementationOnce(async () => {
                    RecipeCockpitAdapterState.clearHeldUpdaterRecords();
                    return { records: [{ Legacy_Code__c: 'LATE' }] };
                });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                expect(postedNamed('updaterRecordsPage')).toHaveLength(pageCount);
                expect(RecipeCockpitAdapterState.heldUpdaterEdits).toBeUndefined();

            });

        });

        describe('a value typed into a cell (#721, part 2)', () => {

            const describeTypedAccount = () => {
                describeAnswers.Account = {
                    name: 'Account',
                    updateable: true,
                    fields: ['Name', 'Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Regions__c', 'ParentId'].map(fieldApiName => ({ name: fieldApiName, type: 'string', updateable: true }))
                };
            };
            const typeCell = (rowIndex: number, fieldApiName: string, value: unknown) => edit('typeCell', { rowIndex: rowIndex, columnIndex: columnIndexOf('Account', fieldApiName), value: value });
            const plannedAccountValues = () => RecipeCockpitAdapterEdits.planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account']).valuesByObjectApiName.get('Account');

            it('puts the value typed in one cell of a marked row, as the kind its field takes, and runs no backend', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 1 });
                await typeCell(1, 'Legacy_Code__c', 'LEG-7');
                await typeCell(1, 'Annual_Budget__c', '1250.5');

                expect(cellOf(1, 'Legacy_Code__c')).toBe('LEG-7');
                expect(cellOf(0, 'Legacy_Code__c')).toBe('OLD-0');
                expect(lastPage().editSummary).toMatchObject({ markedRecordCount: 1, updatableRecordCount: 1, changedFieldApiNames: ['Legacy_Code__c', 'Annual_Budget__c'] });
                // A NUMBER FIELD'S VALUE GOES TO THE ORG AS A NUMBER, A TEXT FIELD'S AS THE TEXT TYPED
                expect(plannedAccountValues()).toEqual([{ recordId: fakeRecordId('Account', 1), fieldValues: { Legacy_Code__c: 'LEG-7', Annual_Budget__c: 1250.5 } }]);
                expect(generateSpy).not.toHaveBeenCalled();
                expect(warnings()).toEqual([]);

            });

            it('takes a value for a field with no faker expression, which has no 🎲', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                expect(loadedObject('Account').columnEdits[columnIndexOf('Account', 'Regions__c')]).toEqual({ canGenerate: false });

                await edit('markRow', { rowIndex: 0 });
                await typeCell(0, 'Regions__c', 'EMEA');

                expect(cellOf(0, 'Regions__c')).toBe('EMEA');
                expect(plannedAccountValues()).toEqual([{ recordId: fakeRecordId('Account', 0), fieldValues: { Regions__c: 'EMEA' } }]);

            });

            it.each([
                ['a value that is not a number for a number field', 'Annual_Budget__c', 'plenty', 'Account.Annual_Budget__c was not changed: Type a plain number, such as 42, -7 or 3.25.'],
                ['a picklist value its field does not declare', 'Rating__c', 'Tepid', 'Account.Rating__c was not changed: "Tepid" is not a value this picklist declares.'],
                ['an expression, which a cell does not take', 'Legacy_Code__c', '${{ fake.Word }}', 'Account.Legacy_Code__c was not changed: a cell takes a value, not a faker expression. Use 🎲 for a generated one.']
            ])('refuses %s, naming the field, and changes no cell', async (_description: string, fieldApiName: string, value: string, expectedWarning: string | RegExp) => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await typeCell(0, fieldApiName, value);

                expect(warnings()).toHaveLength(1);
                expect(warnings()[0]).toMatch(expectedWarning instanceof RegExp ? expectedWarning : new RegExp(`^${expectedWarning.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
                expect(lastPage()).toMatchObject({ changedCells: [], editSummary: { updatableRecordCount: 0 } });

            });

            it('types nothing into a row that is not marked', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await typeCell(0, 'Legacy_Code__c', 'LEG-7');

                expect(lastPage()).toMatchObject({ changedCells: [], editSummary: { markedRecordCount: 0, updatableRecordCount: 0 } });

            });

            it.each([
                ['a value that is not text', { value: 7 }],
                ['no value', {}],
                ['an empty value', { value: '' }],
                ['a value longer than the editor holds', { value: 'x'.repeat(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH + 1) }]
            ])('drops a typeCell with %s without a word', async (_description: string, valuePart: Record<string, unknown>) => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                const typeMessage = editMessage('typeCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c'), ...valuePart });

                expect(RecipeCockpitService.routePanelMessage(typeMessage as any, panelState())).toBeUndefined();
                await send(typeMessage);
                expect(lastPage().changedCells).toEqual([]);
                expect(warnings()).toEqual([]);

            });

            it('drops a value posted with an edit that takes none, and a typed value for a locked column', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });

                expect(RecipeCockpitService.routePanelMessage(editMessage('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c'), value: 'LEG-7' }) as any, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage(editMessage('typeCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'ParentId'), value: fakeRecordId('Account', 2) }) as any, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage(editMessage('typeCell', { rowIndex: 0, columnIndex: 0, value: fakeRecordId('Account', 2) }) as any, panelState())).toBeUndefined();

            });

            it('writes the adapted recipe a typed field as the one value typed, and keeps the expression of a field typed differently per record', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await edit('markRow', { rowIndex: 1 });
                await typeCell(0, 'Rating__c', 'Hot');
                await typeCell(1, 'Rating__c', 'Hot');
                await typeCell(0, 'Legacy_Code__c', 'LEG-A');
                await typeCell(1, 'Legacy_Code__c', 'LEG-B');
                await typeCell(0, 'Regions__c', 'EMEA');
                await typeCell(1, 'Regions__c', 'APAC');

                const adaptedFields = RecipeCockpitAdapterEdits.planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account']).adaptedRecipeFields;
                expect(adaptedFields.map(adaptedField => [adaptedField.fieldApiName, adaptedField.valueText, adaptedField.isRecipeValue === true])).toEqual([
                    ['Legacy_Code__c', '"${{fake.Word}}"', true],
                    ['Rating__c', '"Hot"', false],
                    // NO EXPRESSION AND NO ONE VALUE: THE FIRST RECORD'S, SO THE FIELD IS STILL NAMED AS UPDATED
                    ['Regions__c', '"EMEA"', false]
                ]);

            });

            it('lets 🎲 and ↺ replace a typed value, which then no longer counts as typed', async () => {

                describeTypedAccount();
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await typeCell(0, 'Rating__c', 'Hot');
                await edit('resetCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Rating__c') });
                expect(cellOf(0, 'Rating__c')).toBe('Warm');

                await typeCell(0, 'Legacy_Code__c', 'LEG-A');
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
                expect(cellOf(0, 'Legacy_Code__c')).toBe('Legacy_Code__c-new-0');
                const adaptedFields = RecipeCockpitAdapterEdits.planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account']).adaptedRecipeFields;
                expect(adaptedFields).toEqual([expect.objectContaining({ fieldApiName: 'Legacy_Code__c', isRecipeValue: true })]);

            });

        });

        describe('↺ reset', () => {

            const loadMarkAndFill = async () => {
                // THE SECOND ACCOUNT WAS LOADED WITH NO Rating__c AT ALL
                const queryRecords = (SalesforceOrgService.getConnection as jest.Mock).getMockImplementation()!;
                (SalesforceOrgService.getConnection as jest.Mock).mockImplementation(async (...connectionArguments: unknown[]) => {
                    const connection = await queryRecords(...connectionArguments);
                    return { ...connection, query: async (soql: string) => {
                        const answer = await connection.query(soql);
                        if ( /FROM Account/.test(soql) ) { answer.records[1].Rating__c = null; }
                        return answer;
                    } };
                });
                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await edit('markRow', { rowIndex: 1 });
                await edit('generateColumn', { columnIndex: columnIndexOf('Account', 'Rating__c') });
                await edit('generateColumn', { columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
            };

            it('puts one cell back to the value it was loaded with, null included, and leaves the others changed', async () => {

                await loadMarkAndFill();
                expect(cellOf(1, 'Rating__c')).toBe('Rating__c-new-1');

                await edit('resetCell', { rowIndex: 1, columnIndex: columnIndexOf('Account', 'Rating__c') });

                expect(cellOf(1, 'Rating__c')).toBe('');
                expect(cellOf(0, 'Rating__c')).toBe('Rating__c-new-0');
                expect(lastPage().changedCells).toEqual([[0, 1], [0, 2], [1, 1]]);
                expect(RecipeCockpitAdapterEdits.planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account']).valuesByObjectApiName.get('Account')).toEqual([
                    { recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-0', Rating__c: 'Rating__c-new-0' } },
                    { recordId: fakeRecordId('Account', 1), fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-1' } }
                ]);

            });

            it('puts a whole column back, on marked and unmarked rows alike, and Reset all clears every change of the object but keeps its marks', async () => {

                await loadMarkAndFill();
                await edit('unmarkRow', { rowIndex: 1 });
                await edit('resetColumn', { columnIndex: columnIndexOf('Account', 'Rating__c') });

                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Rating__c')])).toEqual(['Warm', '', 'Warm']);
                expect(lastPage().changedCells).toEqual([[0, 1], [1, 1]]);

                await edit('resetObject');
                expect(lastPage()).toMatchObject({ changedCells: [], markedRowIndexes: [0], editSummary: { markedRecordCount: 1, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } });
                expect(lastPage().rows.map((row: string[]) => row[columnIndexOf('Account', 'Legacy_Code__c')])).toEqual(['OLD-0', 'OLD-1', 'OLD-2']);

            });

            it('keeps an unmarked row\'s changes on screen, leaves them out of the update, and says so', async () => {

                await loadMarkAndFill();
                await edit('unmarkRow', { rowIndex: 1 });

                expect(cellOf(1, 'Legacy_Code__c')).toBe('Legacy_Code__c-new-1');
                expect(lastPage()).toMatchObject({ markedRowIndexes: [0], editSummary: { markedRecordCount: 1, updatableRecordCount: 1, hasUnmarkedChanges: true } });
                expect(RecipeCockpitAdapterEdits.planUpdate(RecipeCockpitAdapterState.heldUpdaterRecords!, ['Account']).plannedObjects.map(plannedObject => plannedObject.recordValues.map(recordValue => recordValue.recordId)))
                    .toEqual([[fakeRecordId('Account', 0)]]);

                // MARKED AGAIN, ITS CHANGES ARE WRITTEN AGAIN
                await edit('markRow', { rowIndex: 1 });
                expect(lastPage().editSummary).toMatchObject({ updatableRecordCount: 2, hasUnmarkedChanges: false });

            });

        });

        describe('what the router refuses', () => {

            const route = (editKind: unknown, position: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
                RecipeCockpitService.routePanelMessage(editMessage(editKind as string, position, overrides) as any, panelState());

            it('routes an edit with exactly the position its rule needs, and the object\'s name as the host holds it', async () => {

                describeWideAccount();
                await openCockpitAndLoad();
                const legacyColumnIndex = columnIndexOf('Account', 'Legacy_Code__c');

                expect(route('markRow', { rowIndex: 2 })).toEqual({ kind: 'editUpdaterRecords', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Account', pageIndex: 0, editKind: 'markRow', rowIndex: 2 });
                expect(route('generateColumn', { columnIndex: legacyColumnIndex })).toMatchObject({ editKind: 'generateColumn', columnIndex: legacyColumnIndex });
                expect(route('generateColumn', { columnIndex: legacyColumnIndex })).not.toHaveProperty('rowIndex');
                expect(route('resetCell', { rowIndex: 0, columnIndex: legacyColumnIndex })).toMatchObject({ editKind: 'resetCell', rowIndex: 0, columnIndex: legacyColumnIndex });
                expect(route('resetObject')).toMatchObject({ editKind: 'resetObject' });
                // A FIELD WITH NO EXPRESSION CAN STILL BE RESET, AND HAS NO 🎲
                expect(route('resetColumn', { columnIndex: columnIndexOf('Account', 'Regions__c') })).toMatchObject({ editKind: 'resetColumn' });
                expect(route('generateColumn', { columnIndex: columnIndexOf('Account', 'Regions__c') })).toBeUndefined();

            });

            it.each([
                ['an edit that is not one of the rules', 'deleteRow', { rowIndex: 0 }, {}],
                ['an edit named after an object\'s own property', 'constructor', { rowIndex: 0 }, {}],
                ['an edit that is not text', 7, { rowIndex: 0 }, {}],
                ['a row edit with no row', 'markRow', {}, {}],
                ['a row past the records loaded', 'markRow', { rowIndex: 3 }, {}],
                ['a row past the page', 'markRow', { rowIndex: 50 }, {}],
                ['a row that is not a whole number', 'markRow', { rowIndex: 0.5 }, {}],
                ['a negative row', 'markRow', { rowIndex: -1 }, {}],
                ['a row on an edit that takes none', 'generateColumn', { rowIndex: 0, columnIndex: 1 }, {}],
                ['a column on an edit that takes none', 'markRow', { rowIndex: 0, columnIndex: 1 }, {}],
                ['a column edit with no column', 'generateColumn', {}, {}],
                ['a column past the table', 'resetColumn', { columnIndex: 99 }, {}],
                ['the Id column', 'generateCell', { rowIndex: 0, columnIndex: 0 }, {}],
                ['a locked column, even to reset it', 'resetCell', { rowIndex: 0, columnIndex: 'ParentId' }, {}],
                ['a column with no expression to generate from', 'generateCell', { rowIndex: 0, columnIndex: 'Regions__c' }, {}],
                ['a page the host did not post', 'markRow', { rowIndex: 0 }, { pageIndex: 1 }],
                ['a page that is not a whole number', 'markRow', { rowIndex: 0 }, { pageIndex: '0' }],
                ['an object the load did not read', 'markRow', { rowIndex: 0 }, { objectApiName: 'Lead' }],
                ['an object named __proto__', 'markRow', { rowIndex: 0 }, { objectApiName: '__proto__' }],
                ['another card', 'markRow', { rowIndex: 0 }, { treeKey: 'Lead-ONLY' }],
                ['another model', 'markRow', { rowIndex: 0 }, { renderSequence: -1 }]
            ])('drops %s without a word', async (_description: string, editKind: unknown, position: { rowIndex?: number; columnIndex?: number | string }, overrides: Record<string, unknown>) => {

                describeWideAccount();
                await openCockpitAndLoad();
                const namedPosition = typeof position.columnIndex === 'string' ? { ...position, columnIndex: columnIndexOf('Account', position.columnIndex) } : position;

                expect(route(editKind, namedPosition, overrides)).toBeUndefined();
                await send(editMessage(editKind as string, namedPosition, overrides));
                expect(postedNamed('updaterRecordsPage')).toEqual([]);
                expect(warnings()).toEqual([]);

            });

            it('drops every edit while a run holds the records, and once they are let go', async () => {

                await openCockpitAndLoad();
                panelState().updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' };
                expect(route('markRow', { rowIndex: 0 })).toBeUndefined();

                panelState().updaterLoadStateMessage = undefined;
                expect(route('markRow', { rowIndex: 0 })).toBeDefined();
                RecipeCockpitAdapterState.clearHeldUpdaterRecords();
                expect(route('markRow', { rowIndex: 0 })).toBeUndefined();

            });

        });

        describe('what lets the edits go', () => {

            it('starts a new load with no row marked and no cell changed, and takes no value made for the load before it', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });

                await send({ command: 'loadUpdaterRecords', parentObjectApiName: 'Account', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(),
                    objects: [{ objectApiName: 'Account', whereClause: '' }, { objectApiName: 'Contact', whereClause: '' }, { objectApiName: 'OtherChildObject__c', whereClause: '' }] });

                expect(RecipeCockpitAdapterState.heldUpdaterEdits).toBeUndefined();
                expect(loadedObject('Account')).toMatchObject({ markedRowIndexes: [], changedCells: [], editSummary: { markedRecordCount: 0, updatableRecordCount: 0 } });
                expect(RecipeCockpitAdapterEdits.countUpdatableRecords()).toBe(0);

            });

            it('names the unwritten changes when Change parent object asks, and lets them go with the records', async () => {

                await openCockpitAndLoad();
                await edit('markRow', { rowIndex: 0 });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
                confirmationAnswers['Change the parent object'] = 'Change parent object';

                await send({ command: 'changeUpdaterParent', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });

                expect(confirmations().at(-1)[1].detail).toContain('The 5 loaded records and the changes made to them, which were not written to the org are let go');
                expect(RecipeCockpitAdapterState.heldUpdaterRecords).toBeUndefined();
                expect(RecipeCockpitAdapterState.heldUpdaterEdits).toBeUndefined();

            });

        });

    });

});
