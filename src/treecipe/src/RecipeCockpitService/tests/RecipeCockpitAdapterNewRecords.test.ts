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
import { RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL } from '../RecipeCockpitAdapterNewRecords';
import { RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE } from '../RecipeCockpitAdapterEdits';
import { ReadOnlyFields } from '../../ObjectInfoWrapper/ReadOnlyFields';
import { RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX, RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX } from '../RecipeCockpitFieldRowsConstants';
import { RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH } from '../RecipeCockpitTreecipeFieldEditorConstants';
import {
    RECIPE_COCKPIT_UPDATER_ID_COLUMN_LOCK_REASON,
    RECIPE_COCKPIT_UPDATER_TYPED_NICKNAME_REFUSAL,
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

describe('RecipeCockpitService, the Treecipe Adapter\'s Generate new records (#722)', () => {

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

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-adapter-new-records-'));
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

        const generateMessage = (objectApiName: string, countPerParent: unknown, fields: unknown, overrides: Record<string, unknown> = {}) => ({
            command: 'generateUpdaterNewRecords', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: objectApiName, countPerParent: countPerParent, fields: fields, ...overrides
        });
        const generate = (objectApiName: string, countPerParent: unknown, fields: unknown, overrides: Record<string, unknown> = {}) => send(generateMessage(objectApiName, countPerParent, fields, overrides));
        const heldNewRecords = (objectApiName: string) => RecipeCockpitAdapterState.heldUpdaterNewRecords?.byObjectApiName.get(objectApiName);
        const lastNewRecords = () => postedNamed('updaterNewRecords').at(-1);
        const informations = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([informationText]) => informationText);

        beforeEach(() => {
            confirmationAnswers = { 'Generate ': RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL };
        });

        describe('what a load says of each object', () => {

            it('offers new records for every object it read below the parent, naming the object they go under, its lookup and how many were loaded, and never for the parent', async () => {

                await openCockpitAndLoad();

                expect(loadedObject('Account').newRecordsParent).toBeUndefined();
                expect(loadedObject('Contact').newRecordsParent).toEqual({ parentObjectApiName: 'Account', lookupFieldApiName: 'AccountId', parentRecordCount: 3 });

            });

        });

        describe('Generate records', () => {

            it('generates count x loaded parents records with the recipe\'s own backend, each under a loaded parent in load order, and holds them without writing anything', async () => {

                await openCockpitAndLoad();
                await generate('Contact', 2, [{ fieldApiName: 'LastName' }]);

                const [[confirmationTitle, confirmationOptions]] = confirmations();
                expect(confirmationTitle).toBe('Generate 6 new Contact records under the loaded Account records?');
                expect(JSON.stringify(confirmationOptions)).toContain('2 per Account record, under 3 Account records: 6 Contact records');
                expect(backendRuns()).toEqual([expect.objectContaining({ fakerService: 'snowfakery', objectApiName: 'Contact', valueCount: 6, fields: [expect.objectContaining({ fieldApiName: 'LastName' })] })]);

                const accountIds = [0, 1, 2].map(recordIndex => fakeRecordId('Account', recordIndex));
                expect(heldNewRecords('Contact')).toMatchObject({ parentObjectApiName: 'Account', lookupFieldApiName: 'AccountId', countPerParent: 2, columnFieldApiNames: ['AccountId', 'LastName'] });
                expect(heldNewRecords('Contact')!.records.map(record => record.AccountId)).toEqual([accountIds[0], accountIds[0], accountIds[1], accountIds[1], accountIds[2], accountIds[2]]);
                expect(heldNewRecords('Contact')!.records.map(record => (record.attributes as any).referenceId)).toEqual([1, 2, 3, 4, 5, 6].map(recordNumber => `Contact_Adapter_Reference_${recordNumber}`));

                expect(lastNewRecords()).toEqual({
                    command: 'updaterNewRecords', renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', parentObjectApiName: 'Account',
                    countPerParent: 2, recordCount: 6, pageCount: 1, columns: ['AccountId', 'LastName'],
                    rows: [0, 1, 2, 3, 4, 5].map(recordIndex => [accountIds[Math.floor(recordIndex / 2)], `LastName-new-${recordIndex}`])
                });
                expect(informations().slice(-1)).toEqual(['Generated 6 new Contact records, 2 per loaded Account record. Nothing was written to the org.']);
                expect(updateCalls).toEqual([]);
                expect(panelState().updaterNewRecordsMessages).toEqual([lastNewRecords()]);

            });

            it('leaves an unticked field out of the records, and gives a fixed value as typed, as the kind its field takes, with no backend run for it', async () => {

                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName', value: 'Okafor' }]);

                expect(generateSpy).not.toHaveBeenCalled();
                expect(heldNewRecords('Contact')!.records.map(record => record.LastName)).toEqual(['Okafor', 'Okafor', 'Okafor']);
                expect(Object.keys(heldNewRecords('Contact')!.records[0]).sort()).toEqual(['AccountId', 'LastName', 'attributes']);

            });

            it('asks nothing of the backend and keeps nothing when the confirmation is not answered Generate records', async () => {

                confirmationAnswers = {};
                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);

                expect(generateSpy).not.toHaveBeenCalled();
                expect(heldNewRecords('Contact')).toBeUndefined();
                expect(postedNamed('updaterNewRecords')).toEqual([]);

            });

            it('keeps each object\'s records apart, and replaces an object\'s own when it is generated again', async () => {

                describeAnswers.OtherChildObject__c = { name: 'OtherChildObject__c', updateable: true, fields: [{ name: 'Name', type: 'string', updateable: true }] };
                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);
                await generate('Contact', 2, [{ fieldApiName: 'LastName' }]);

                expect(heldNewRecords('Contact')!.records).toHaveLength(6);
                expect(panelState().updaterNewRecordsMessages!.map(newRecordsMessage => [newRecordsMessage.objectApiName, newRecordsMessage.recordCount])).toEqual([['Contact', 6]]);

            });

            it.each([
                ['a count that is not a whole number of one or more', 0, [{ fieldApiName: 'LastName' }], 'No new Contact records were generated: the count per parent record must be a whole number of one or more.'],
                ['a count that is text', '2', [{ fieldApiName: 'LastName' }], 'No new Contact records were generated: the count per parent record must be a whole number of one or more.'],
                ['a count over the limit', 20000, [{ fieldApiName: 'LastName' }], 'No new Contact records were generated: 20000 per record under 3 Account records is more than the 50000 one block generates.'],
                ['the lookup to the parent, which is set by Id', 1, [{ fieldApiName: 'AccountId' }], 'No new Contact records were generated: Contact.AccountId cannot be filled: the last load did not read it, or it is a field the Adapter does not set. Untick it.'],
                ['a field the load did not read', 1, [{ fieldApiName: 'Gone__c' }], 'No new Contact records were generated: Contact.Gone__c cannot be filled: the last load did not read it, or it is a field the Adapter does not set. Untick it.'],
                ['a field named twice', 1, [{ fieldApiName: 'LastName' }, { fieldApiName: 'LastName' }], 'No new Contact records were generated: Contact.LastName cannot be filled: the last load did not read it, or it is a field the Adapter does not set. Untick it.'],
                ['a value that is not text', 1, [{ fieldApiName: 'LastName', value: 7 }], 'No new Contact records were generated: Contact.LastName cannot be filled: the last load did not read it, or it is a field the Adapter does not set. Untick it.']
            ])('refuses %s, with the reason, and generates nothing', async (_description: string, countPerParent: unknown, fields: unknown, expectedWarning: string) => {

                await openCockpitAndLoad();
                await generate('Contact', countPerParent, fields);

                expect(warnings()).toEqual([expectedWarning]);
                expect(confirmations()).toEqual([]);
                expect(generateSpy).not.toHaveBeenCalled();
                expect(postedNamed('updaterLoadState').at(-1)).toMatchObject({ isRunning: false, runKind: 'generateNew' });

            });

            it.each([
                ['the parent object, which has nothing above it', { objectApiName: 'Account' }],
                ['an object the load did not read', { objectApiName: 'Lead' }],
                ['an object named __proto__', { objectApiName: '__proto__' }],
                ['another card', { treeKey: 'Lead-ONLY' }],
                ['another model', { renderSequence: -1 }],
                ['fields that are not a list', { fields: 'LastName' }]
            ])('drops a request for %s without a word', async (_description: string, overrides: Record<string, unknown>) => {

                await openCockpitAndLoad();
                await send(generateMessage('Contact', 1, [{ fieldApiName: 'LastName' }], overrides));

                expect(warnings()).toEqual([]);
                expect(confirmations()).toEqual([]);
                expect(generateSpy).not.toHaveBeenCalled();

            });

            it('refuses when the load read no records of the object above, since there is nothing to add under', async () => {

                recordCountByObject = { Account: 0, Contact: 0, OtherChildObject__c: 0 };
                await openCockpitAndLoad();

                // NOT READ AT ALL: THE LOAD SKIPS AN OBJECT WHOSE PARENT HAS NO RECORDS, SO IT OFFERS NO NEW RECORDS FOR IT
                expect(loadedObject('Contact').newRecordsParent).toBeUndefined();
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);
                expect(confirmations()).toEqual([]);
                expect(generateSpy).not.toHaveBeenCalled();

            });

            it('refuses a typed value its field cannot take, and a ticked field with no expression and nothing typed, naming the field', async () => {

                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName', value: 'Contact_NickName' }]);

                expect(warnings().at(-1)).toMatch(/^No new Contact records were generated: Contact\.LastName: "Contact_NickName" is a nickname in this recipe/);
                expect(generateSpy).not.toHaveBeenCalled();

            });

            it('refuses a run that answers another number of records than asked for, and keeps none', async () => {

                await openCockpitAndLoad();
                generateSpy.mockResolvedValue({ records: [{ LastName: 'Only one' }] });
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);

                expect(warnings()).toEqual(['No new Contact records were generated: snowfakery generated 1 records where 3 were asked for.']);
                expect(heldNewRecords('Contact')).toBeUndefined();

            });

            it('says why when the backend refuses, and gives the run lock back', async () => {

                await openCockpitAndLoad();
                generateSpy.mockResolvedValue({ refusal: 'snowfakery is not installed.' });
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);

                expect(warnings()).toEqual(['No new Contact records were generated: snowfakery is not installed.']);
                expect((RecipeCockpitAdapterState as any).isUpdaterLoadInFlight).toBe(false);
                // THE STATE NAMES THE OBJECT, SO A REOPENED PANEL KNOWS WHOSE BUTTON IS RUNNING
                expect(postedNamed('updaterLoadState').map(stateMessage => [stateMessage.isRunning, stateMessage.runKind, stateMessage.objectApiName]).slice(-2)).toEqual([[true, 'generateNew', 'Contact'], [false, 'generateNew', 'Contact']]);

            });

        });

        describe('the preview\'s pages and what lets the records go', () => {

            const pageMessage = (pageIndex: unknown, overrides: Record<string, unknown> = {}) => ({ command: 'loadUpdaterNewRecordsPage', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), objectApiName: 'Contact', pageIndex: pageIndex, ...overrides });

            it('cuts each page of 50 from the records held, and answers only for a page they have', async () => {

                await openCockpitAndLoad();
                await generate('Contact', 40, [{ fieldApiName: 'LastName' }]);

                expect(lastNewRecords()).toMatchObject({ recordCount: 120, pageCount: 3 });
                expect(lastNewRecords().rows).toHaveLength(RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE);

                await send(pageMessage(2));
                expect(postedNamed('updaterNewRecordsPage')).toEqual([{
                    command: 'updaterNewRecordsPage', renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', pageIndex: 2,
                    rows: Array.from({ length: 20 }, (_value, rowIndex) => [fakeRecordId('Account', 2), `LastName-new-${100 + rowIndex}`])
                }]);

                for ( const refusedMessage of [pageMessage(3), pageMessage(-1), pageMessage(0.5), pageMessage('1'), pageMessage(0, { objectApiName: 'Account' }), pageMessage(0, { treeKey: 'Lead-ONLY' }), pageMessage(0, { renderSequence: -1 })] ) {
                    expect(RecipeCockpitService.routePanelMessage(refusedMessage as any, panelState())).toBeUndefined();
                }

            });

            it('says in the Change parent object and Update records confirmations that the new records are let go too', async () => {

                confirmationAnswers = { 'Generate ': RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL };
                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);

                await send({ command: 'changeUpdaterParent', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
                expect(JSON.stringify(confirmations().at(-1))).toContain('The 5 loaded records, and the 3 new records generated under them are let go');

                await edit('markRow', { rowIndex: 0 });
                await edit('generateCell', { rowIndex: 0, columnIndex: columnIndexOf('Account', 'Legacy_Code__c') });
                await send({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
                expect(JSON.stringify(confirmations().at(-1))).toContain('The 3 new records generated under the loaded records are let go when this update is sent: they are a preview and were not inserted.');
                // BOTH WERE LEFT UNANSWERED, SO THE RECORDS ARE STILL HELD
                expect(heldNewRecords('Contact')!.records).toHaveLength(3);

            });

            it('lets the new records go with the load they were generated under: a new load, and Change parent object', async () => {

                await openCockpitAndLoad();
                await generate('Contact', 1, [{ fieldApiName: 'LastName' }]);
                expect(heldNewRecords('Contact')).toBeDefined();

                await send({ command: 'loadUpdaterRecords', parentObjectApiName: 'Account', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(),
                    objects: [{ objectApiName: 'Account', whereClause: '' }, { objectApiName: 'Contact', whereClause: '' }, { objectApiName: 'OtherChildObject__c', whereClause: '' }] });

                expect(RecipeCockpitAdapterState.heldUpdaterNewRecords).toBeUndefined();
                expect(panelState().updaterNewRecordsMessages).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage(pageMessage(0) as any, panelState())).toBeUndefined();

            });

        });

    });

});
