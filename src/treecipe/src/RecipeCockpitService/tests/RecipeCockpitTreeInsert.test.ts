import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: {
        createWebviewPanel: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showErrorMessage: jest.fn().mockResolvedValue(undefined)
    },
    commands: { executeCommand: jest.fn() },
    workspace: {
        workspaceFolders: undefined,
        fs: { readFile: jest.fn(async (fileUri: { fsPath: string }) => jest.requireActual('fs').readFileSync(fileUri.fsPath)) }
    },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    ThemeIcon: class { constructor(public id: string) {} },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

/*
    snowfakery is a CLI, so its execFile is answered here: the recipe it was handed is read and each
    object written count times, the way snowfakery's JSON output carries them (_table, id, nickname
    and the fields). A template is written as "generated" and a TODO comment as null.
*/
const snowfakeryCalls: Array<{ command: string; argumentList: string[] }> = [];

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    exec: jest.fn(),
    execFile: jest.fn().mockImplementation((command: string, argumentList: string[], _options: Record<string, unknown>, callback: Function) => {
        snowfakeryCalls.push({ command, argumentList });
        const recipeEntries = (jest.requireActual('js-yaml') as typeof yaml).load(jest.requireActual('fs').readFileSync(argumentList[0], 'utf-8')) as any[];
        const generatedRows = recipeEntries.flatMap(recipeEntry => Array.from({ length: recipeEntry.count }, (_row, rowIndex) => ({
            id: rowIndex + 1,
            _table: recipeEntry.object,
            nickname: recipeEntry.nickname,
            ...Object.fromEntries(Object.entries(recipeEntry.fields ?? {}).map(([fieldApiName, fieldValue]) => [
                fieldApiName,
                typeof fieldValue === 'string' && fieldValue.includes('${{') ? 'generated' : fieldValue
            ]))
        })));
        callback(null, JSON.stringify(generatedRows));
    })
}));

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    RECIPE_COCKPIT_INSERT_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { ExtensionCommandService } from '../../ExtensionCommandService/ExtensionCommandService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const SNOWFAKERY_RUN = 'recipe-2026-09-20T10-00-00';
const FAKER_JS_RUN = 'recipe-fakerjs-2026-09-21T00-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const TIMESTAMP = '2026-10-07T12-00-00';

const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const SANDBOX_TYPE = { isSandbox: true, organizationType: 'Unlimited Edition' };
const OUTSIDE_REGION_IDS = ['a05000000000001AAA', 'a05000000000002AAA'];

// A faker-js RUN OF THE TREE: Contact NESTED UNDER Account, OtherChildObject__c UNDER Contact, EACH CHILD WIRED TO ITS PARENT'S NICKNAME
const buildFakerJsAccountRecipe = (accountCount: number, contactCount: number) => `# Relationship Tree: RelationshipTree_1

- object: Account
  nickname: Account_NickName
  count: ${accountCount}
  fields:
    Name: \${{faker.company.name()}}
  friends:
    - object: Contact
      nickname: Contact_NickName
      count: ${contactCount}
      fields:
        LastName: \${{faker.person.lastName()}}
        AccountId: Account_NickName
      friends:
        - object: OtherChildObject__c
          nickname: OtherChildObject__c_NickName
          count: 1
          fields:
            Score__c: \${{faker.number.int(99)}}
            Contact__c: Contact_NickName
`;

// THE SAME TREE AS snowfakery WRITES IT: FLAT, EVERY LOOKUP AN UNWIRED TODO
const SNOWFAKERY_ACCOUNT_RECIPE = `# Relationship Tree: RelationshipTree_1

- object: Account
  nickname: Account_NickName
  count: 2
  fields:
    Name: \${{fake.Company}}
    ParentId: ### TODO -- REFERENCE ID REQUIRED

- object: Contact
  nickname: Contact_NickName
  count: 3
  fields:
    LastName: \${{fake.LastName}}
    AccountId: ### TODO -- REFERENCE ID REQUIRED

- object: OtherChildObject__c
  nickname: OtherChildObject__c_NickName
  count: 1
  fields:
    Score__c: \${{ random_number(min=0, max=99) }}
    Contact__c: ### TODO -- REFERENCE ID REQUIRED
`;

// Contact NEEDS AN Account; OtherChildObject__c NEEDS A Contact; withOutsideParent ADDS A REQUIRED LOOKUP TO AN OBJECT NO TREE INSERTS
function buildRawDescribes(withOutsideParent: boolean): Record<string, unknown> {

    return {
        Account: {
            name: 'Account', createable: true,
            fields: [
                { name: 'Name', type: 'string', nillable: false, createable: true },
                { name: 'ParentId', type: 'reference', referenceTo: ['Account'], nillable: true, createable: true },
                { name: 'OwnerId', type: 'reference', referenceTo: ['User'], nillable: false, createable: true, defaultedOnCreate: true }
            ]
        },
        Contact: {
            name: 'Contact', createable: true,
            fields: [
                { name: 'LastName', type: 'string', nillable: false, createable: true },
                { name: 'AccountId', type: 'reference', referenceTo: ['Account'], nillable: false, createable: true },
                { name: 'ReportsToId', type: 'reference', referenceTo: ['Contact'], nillable: true, createable: true },
                ...( withOutsideParent ? [{ name: 'Region__c', type: 'reference', referenceTo: ['Region__c'], nillable: false, createable: true }] : [] )
            ]
        },
        OtherChildObject__c: {
            name: 'OtherChildObject__c', createable: true,
            fields: [
                { name: 'Score__c', type: 'double', nillable: true, createable: true },
                { name: 'Contact__c', type: 'reference', referenceTo: ['Contact'], nillable: false, createable: true }
            ]
        },
        Lead: { name: 'Lead', createable: true, fields: [{ name: 'Company', type: 'string', nillable: false, createable: true }] }
    };

}

const ID_PREFIXES: Record<string, string> = { Account: '001', Contact: '003', OtherChildObject__c: 'a01', Lead: '00Q' };

interface IFakeConnectionOptions {
    isSandbox?: boolean;
    organizationQueryFails?: boolean;
    withOutsideParent?: boolean;
    outsideParentIds?: string[];
    rejectRecord?: (objectApiName: string, record: any) => boolean;
}

function buildFakeConnection(options: IFakeConnectionOptions = {}) {

    const rawDescribes = buildRawDescribes(options.withOutsideParent === true);
    const sentQueries: string[] = [];
    const insertCalls: Array<{ objectApiName: string; records: any[]; insertOptions: any }> = [];
    const insertedRecordsById = new Map<string, { objectApiName: string; record: any }>();
    const deleteCalls: string[][] = [];
    const idCounters: Record<string, number> = {};

    const connection = {
        instanceUrl: 'https://qa.sandbox.my.salesforce.com',
        sentQueries,
        insertCalls,
        insertedRecordsById,
        deleteCalls,
        describe: jest.fn().mockImplementation(async (objectApiName: string) => {
            if ( !rawDescribes[objectApiName] ) {
                throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
            }
            return rawDescribes[objectApiName];
        }),
        query: jest.fn().mockImplementation(async (soql: string) => {
            sentQueries.push(soql);
            if ( soql.includes('FROM Organization') ) {
                if ( options.organizationQueryFails ) {
                    throw new Error('INVALID_SESSION_ID');
                }
                return { records: [{ IsSandbox: options.isSandbox ?? true, OrganizationType: options.isSandbox === false ? 'Enterprise Edition' : 'Unlimited Edition' }] };
            }
            if ( soql === 'SELECT Id FROM Region__c LIMIT 2000' ) {
                return { records: ( options.outsideParentIds ?? OUTSIDE_REGION_IDS ).map(recordId => ({ Id: recordId })) };
            }
            if ( soql.includes('FROM RecordType') ) {
                return { records: [] };
            }
            throw new Error(`unexpected query: ${soql}`);
        }),
        sobject: jest.fn().mockImplementation((objectApiName: string) => ({
            insert: jest.fn().mockImplementation(async (records: any[], insertOptions: any) => {
                insertCalls.push({ objectApiName, records: JSON.parse(JSON.stringify(records)), insertOptions });
                return records.map(record => {
                    if ( options.rejectRecord?.(objectApiName, record) ) {
                        return { success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'rejected' }] };
                    }
                    idCounters[objectApiName] = ( idCounters[objectApiName] ?? 0 ) + 1;
                    const recordId = `${ID_PREFIXES[objectApiName]}${String(idCounters[objectApiName]).padStart(12, '0')}AAA`;
                    insertedRecordsById.set(recordId, { objectApiName, record: JSON.parse(JSON.stringify(record)) });
                    return { id: recordId, success: true, errors: [] };
                });
            }),
            delete: jest.fn().mockImplementation(async (recordIds: string[]) => { deleteCalls.push(recordIds); return []; })
        }))
    };

    return connection;

}

type FakeConnection = ReturnType<typeof buildFakeConnection>;

// THE RECORDS OF ONE OBJECT THE ORG ACCEPTED, AS THEY WERE SENT
const insertedOf = (connection: FakeConnection, objectApiName: string) => [...connection.insertedRecordsById.entries()]
    .filter(([, inserted]) => inserted.objectApiName === objectApiName)
    .map(([recordId, inserted]) => ({ recordId, ...inserted.record }));

const buildWorkspaceState = () => {
    const storedValues = new Map<string, unknown>();
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

describe('RecipeCockpitService, Generate fake data and insert a whole tree (#255)', () => {

    beforeEach(() => {
        SalesforceOrgService.clearDescribeCache();
    });

    describe('the open panel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let temporaryWorkspaceRoot: string;
        let showWarningMessageSpy: jest.SpyInstance;
        let allOrNoneSpy: jest.SpyInstance;
        let getConnectionSpy: jest.SpyInstance;
        let selectedFakerService: string;
        let handleCapturedErrorSpy: jest.SpyInstance;
        let expectsCapturedError = false;
        const executeCommand = vscode.commands.executeCommand as jest.Mock;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const fakeDataSetsFolderPath = () => path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets');
        const datasetFolderNames = () => fs.existsSync(fakeDataSetsFolderPath()) ? fs.readdirSync(fakeDataSetsFolderPath()) : [];
        const runFakerCalls = () => executeCommand.mock.calls.filter(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND);
        const generatedRecipesFolderPath = () => path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes');
        const accountRecipeFilePath = (runFolderName: string) => path.join(generatedRecipesFolderPath(), runFolderName, ACCOUNT_TREE_KEY,
            runFolderName === SNOWFAKERY_RUN ? `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml` : `recipe-fakerjs--${ACCOUNT_TREE_KEY}-2026-09-21T00-00-00.yml`);

        // A COPY OF THE TREE WORKSPACE WITH THE TWO RECIPES ABOVE, AND A faker-js RUN NEWER THAN THE snowfakery ONE
        const buildWorkspace = (fakerJsRecipe: string) => {

            temporaryWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-tree-insert-'));
            fs.cpSync(TREE_WORKSPACE_ROOT, temporaryWorkspaceRoot, { recursive: true });

            fs.mkdirSync(path.join(generatedRecipesFolderPath(), FAKER_JS_RUN, ACCOUNT_TREE_KEY), { recursive: true });
            fs.writeFileSync(accountRecipeFilePath(FAKER_JS_RUN), fakerJsRecipe);
            fs.writeFileSync(accountRecipeFilePath(SNOWFAKERY_RUN), SNOWFAKERY_ACCOUNT_RECIPE);
            fs.copyFileSync(
                path.join(generatedRecipesFolderPath(), SNOWFAKERY_RUN, 'treecipeObjectsWrapper-2026-09-20T10-00-00.json'),
                path.join(generatedRecipesFolderPath(), FAKER_JS_RUN, 'treecipeObjectsWrapper-2026-09-21T00-00-00.json')
            );

        };

        const openSelectedCockpit = async (runFolderName: string, workspaceState?: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(temporaryWorkspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            if ( postedNamed('recipeData').at(-1).recipe.selectedRunFolderName !== runFolderName ) {
                await receivedMessageHandler({ command: 'selectRun', runFolderName });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            }
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
        };

        const useConnection = (connection: FakeConnection) => getConnectionSpy.mockResolvedValue(connection as any);

        const insertAccountTree = () => receivedMessageHandler({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY });

        beforeEach(() => {

            postedPanelMessages = [];
            snowfakeryCalls.length = 0;
            buildWorkspace(buildFakerJsAccountRecipe(2, 3));

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
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_INSERT_CONFIRM_LABEL);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_progressOptions: unknown, progressTask: Function) =>
                progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));

            // THE COMMAND THE COCKPIT EXECUTES IS THE REAL Run Faker, AS extension.ts REGISTERS IT
            executeCommand.mockReset();
            executeCommand.mockImplementation(async (commandId: string, recipeFilePath?: unknown, filteredRecipe?: unknown, runOptions?: unknown) => {
                if ( commandId !== RECIPE_COCKPIT_RUN_FAKER_COMMAND ) {
                    return undefined;
                }
                return new ExtensionCommandService().runFakerGenerationByRecipeFile(
                    typeof recipeFilePath === 'string' ? recipeFilePath : undefined,
                    filteredRecipe as any,
                    ExtensionCommandService.readRunFakerOptions(runOptions)
                );
            });

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockImplementation(() => temporaryWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'getNowIsoDateTimestamp').mockReturnValue(TIMESTAMP);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgCount: 0, hiddenOrgs: [], hiddenOrgReasonCounts: { production: 0, expired: 0, deleted: 0, notConnected: 0 } } as any);
            selectedFakerService = 'faker-js';
            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockImplementation(() => selectedFakerService);
            allOrNoneSpy = jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockResolvedValue(false);
            getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');
            useConnection(buildFakeConnection());
            handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            // AN ERROR NO TEST ASKED FOR IS A FAILURE, NOT A NOTIFICATION NOBODY READS
            if ( !expectsCapturedError ) {
                expect(handleCapturedErrorSpy).not.toHaveBeenCalled();
            }
            expectsCapturedError = false;
            fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true });
        });

        it('given faker-js, confirms every object with its total, then generates the tree through Run Faker and inserts it parents first, each child under a parent of this run', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            // THE HOST-SIDE MODAL: EACH OBJECT'S TOTAL, A NESTED FRIEND'S PER-PARENT COUNT, AND NO LARGE-RUN WARNING
            const [modalMessage, modalOptions, modalAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(modalMessage).toBe('Generate Relationship Tree 1 and insert it into qa (qa@example.com.qa)?');
            expect(modalOptions.modal).toBe(true);
            expect(modalAction).toBe(RECIPE_COCKPIT_INSERT_CONFIRM_LABEL);
            expect(modalOptions.detail.split('\n')).toIncludeAllMembers([
                'Org: qa (qa@example.com.qa)',
                'Type: Sandbox',
                'Backend: faker-js',
                'Records, inserted parents first:',
                '  Account: 2',
                '  Contact: 6 (3 per Account)',
                '  OtherChildObject__c: 6 (1 per Contact)'
            ]);
            expect(modalOptions.detail).not.toContain('This run will take time');
            expect(allOrNoneSpy).toHaveBeenCalledTimes(1);

            // GENERATED BY THE SAME COMMAND ▶ Run Faker RUNS, ITS OWN MODAL ANSWERED BY THIS ONE
            expect(runFakerCalls()).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, accountRecipeFilePath(FAKER_JS_RUN), undefined, { isConfirmed: true }]]);
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(expect.anything(), { modal: true }, 'Generate Data');
            expect(datasetFolderNames()).toEqual([`dataset-fakerjs-${TIMESTAMP}`]);

            // PARENTS FIRST, allOrNone AS CHOSEN, NO ROLLBACK
            expect(connection.insertCalls.map(insertCall => insertCall.objectApiName)).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            connection.insertCalls.forEach(insertCall => expect(insertCall.insertOptions).toEqual({ allowRecursive: false, allOrNone: false }));
            expect(connection.deleteCalls).toEqual([]);

            const accounts = insertedOf(connection, 'Account');
            const contacts = insertedOf(connection, 'Contact');
            const otherChildren = insertedOf(connection, 'OtherChildObject__c');
            expect([accounts.length, contacts.length, otherChildren.length]).toEqual([2, 6, 6]);

            const accountIds = accounts.map(account => account.recordId);
            const contactIds = contacts.map(contact => contact.recordId);
            contacts.forEach(contact => expect(accountIds).toContain(contact.AccountId));
            otherChildren.forEach(otherChild => expect(contactIds).toContain(otherChild.Contact__c));
            // EACH CONTACT UNDER THE ACCOUNT IT WAS GENERATED UNDER: THREE PER ACCOUNT
            expect(accountIds.map(accountId => contacts.filter(contact => contact.AccountId === accountId).length)).toEqual([3, 3]);
            // A LOOKUP THE RECIPE DID NOT WIRE AND THE ORG DOES NOT REQUIRE IS LEFT BLANK, NEVER SENT AS TEXT
            contacts.forEach(contact => expect(contact).not.toHaveProperty('ReportsToId'));
            accounts.forEach(account => expect(account).not.toHaveProperty('ParentId'));

            // THE DATA SET IS THE ONE RUN FAKER WRITES, AND THE INSERT'S RESULTS SIT IN IT AS INSERT DATA SET BY DIRECTORY'S DO
            const datasetFolderPath = path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0]);
            expect(JSON.parse(fs.readFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'datasetSource.json'), 'utf-8'))).toMatchObject({
                recipeRunFolderName: FAKER_JS_RUN,
                recipeTreeFolderName: ACCOUNT_TREE_KEY,
                fakerService: 'faker-js',
                recordCountsByObject: { Account: 2, Contact: 6, OtherChildObject__c: 6 }
            });
            expect(fs.readdirSync(path.join(datasetFolderPath, 'InsertAttempts'))).toEqual([`insertAttempt-${TIMESTAMP}`]);

            // RELOADED ONTO THE CARD'S TREECIPE TAB, THE STATE MESSAGE LAST
            expect(postedNamed('recipeData').at(-1).focusTree).toEqual({ treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' });
            expect(postedNamed('insertState').map(insertState => insertState.isRunning)).toEqual([true, false]);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('given snowfakery, gives every unwired TODO lookup a parent this run inserted', async () => {

            selectedFakerService = 'snowfakery';
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await insertAccountTree();

            expect(runFakerCalls()).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, accountRecipeFilePath(SNOWFAKERY_RUN), undefined, { isConfirmed: true }]]);
            expect(snowfakeryCalls).toHaveLength(1);
            expect(snowfakeryCalls[0].argumentList[0]).toBe(accountRecipeFilePath(SNOWFAKERY_RUN));

            const accountIds = insertedOf(connection, 'Account').map(account => account.recordId);
            const contacts = insertedOf(connection, 'Contact');
            const contactIds = contacts.map(contact => contact.recordId);
            expect(accountIds).toHaveLength(2);
            expect(contacts).toHaveLength(3);
            contacts.forEach(contact => expect(accountIds).toContain(contact.AccountId));
            insertedOf(connection, 'OtherChildObject__c').forEach(otherChild => expect(contactIds).toContain(otherChild.Contact__c));
            // NO ACCOUNT EXISTED BEFORE THE ACCOUNTS FILE, SO THE OPTIONAL SELF-LOOKUP IS LEFT BLANK RATHER THAN SENT AS null
            insertedOf(connection, 'Account').forEach(account => expect(account).not.toHaveProperty('ParentId'));
            // NO PARENT OUTSIDE THE TREE IS REQUIRED, SO NO RECORD IS ASKED OF THE ORG
            expect(connection.sentQueries.filter(soql => /^SELECT Id FROM/.test(soql))).toEqual([]);

        });

        it('splits a large tree into requests of at most 200 records, attempts every record, and warns of the total first', async () => {

            buildWorkspace(buildFakerJsAccountRecipe(300, 5));
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            const modalDetail: string = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail;
            expect(modalDetail).toContain('  Account: 300');
            expect(modalDetail).toContain('  Contact: 1500 (5 per Account)');
            expect(modalDetail).toContain('This run will take time: 3300 records in at least 18 Collections API requests.');

            const recordsSentByObject = (objectApiName: string) => connection.insertCalls.filter(insertCall => insertCall.objectApiName === objectApiName);
            connection.insertCalls.forEach(insertCall => expect(insertCall.records.length).toBeLessThanOrEqual(200));
            expect(recordsSentByObject('Account').map(insertCall => insertCall.records.length)).toEqual([200, 100]);
            expect(recordsSentByObject('Contact').reduce((recordCount, insertCall) => recordCount + insertCall.records.length, 0)).toBe(1500);
            expect(recordsSentByObject('OtherChildObject__c').reduce((recordCount, insertCall) => recordCount + insertCall.records.length, 0)).toBe(1500);
            expect(connection.insertCalls).toHaveLength(18);
            expect(connection.insertedRecordsById.size).toBe(3300);

            const accountIds = new Set(insertedOf(connection, 'Account').map(account => account.recordId));
            insertedOf(connection, 'Contact').forEach(contact => expect(accountIds.has(contact.AccountId)).toBe(true));

        }, 60000);

        it('generates and writes nothing when the confirmation is cancelled', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            const recipeDataPostsBefore = postedNamed('recipeData').length;
            await insertAccountTree();

            expect(allOrNoneSpy).not.toHaveBeenCalled();
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore);
            expect(postedNamed('insertState').map(insertState => insertState.isRunning)).toEqual([true, false]);

        });

        it('generates nothing when the all-or-none choice is dismissed', async () => {

            allOrNoneSpy.mockResolvedValue(undefined);
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(allOrNoneSpy).toHaveBeenCalledTimes(1);
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('inserts with all-or-none true when that is chosen, through the same insert', async () => {

            allOrNoneSpy.mockResolvedValue(true);
            const insertSpy = jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg');
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(insertSpy).toHaveBeenCalledTimes(1);
            const [datasetFolderPath, insertConnection, allOrNone, insertOptions] = insertSpy.mock.calls[0];
            expect(datasetFolderPath).toBe(path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0]));
            expect(insertConnection).toBe(connection);
            expect(allOrNone).toBe(true);
            expect(Object.keys(insertOptions)).toEqual(['prepareRecords']);
            expect(typeof insertOptions.prepareRecords).toBe('function');
            connection.insertCalls.forEach(insertCall => expect(insertCall.insertOptions.allOrNone).toBe(true));

        });

        it.each([
            ['answers it is not a sandbox', { isSandbox: false }, 'Nothing was inserted into qa (qa@example.com.qa) (Production · Enterprise Edition): the Recipe Cockpit inserts only into a sandbox or scratch org.'],
            ['cannot answer the Organization query', { organizationQueryFails: true }, 'Nothing was inserted into qa (qa@example.com.qa) (']
        ])('asks the Organization row again on the insert connection after the confirm, and refuses an org that %s before anything is written', async (_description, connectionOptions, expectedWarning) => {

            useConnection(buildFakeConnection());
            await openSelectedCockpit(FAKER_JS_RUN);

            const insertConnection = buildFakeConnection(connectionOptions);
            useConnection(insertConnection);
            await insertAccountTree();

            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect(insertConnection.sentQueries.filter(soql => soql.includes('FROM Organization'))).toHaveLength(1);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining(expectedWarning));
            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('inserts only into a sandbox or scratch org');
            expect(runFakerCalls()).toEqual([]);
            expect(insertConnection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('refuses an Organization row that answers nothing usable, the same as a production one', async () => {

            useConnection(buildFakeConnection());
            await openSelectedCockpit(FAKER_JS_RUN);

            const insertConnection = buildFakeConnection();
            insertConnection.query.mockImplementation(async (soql: string) => {
                insertConnection.sentQueries.push(soql);
                return { records: [] };
            });
            useConnection(insertConnection);
            await insertAccountTree();

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('inserts only into a sandbox or scratch org');
            expect(runFakerCalls()).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('fills a required lookup to a parent outside the tree from the org\'s existing records, asking for them only after the confirm', async () => {

            const connection = buildFakeConnection({ withOutsideParent: true });
            useConnection(connection);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                expect(connection.sentQueries).not.toContain('SELECT Id FROM Region__c LIMIT 2000');
                return RECIPE_COCKPIT_INSERT_CONFIRM_LABEL;
            });

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail)
                .toContain('Required lookups to objects this tree does not insert get a random existing record of: Region__c (none means nothing is inserted).');
            expect(connection.sentQueries).toContain('SELECT Id FROM Region__c LIMIT 2000');
            const contacts = insertedOf(connection, 'Contact');
            expect(contacts).toHaveLength(6);
            contacts.forEach(contact => expect(OUTSIDE_REGION_IDS).toContain(contact.Region__c));
            // AN IN-TREE PARENT IS NEVER ASKED OF THE ORG
            expect(connection.sentQueries).not.toContain('SELECT Id FROM Account LIMIT 2000');

        });

        it('refuses before writing anything when the parent outside the tree has no records', async () => {

            const connection = buildFakeConnection({ withOutsideParent: true, outsideParentIds: [] });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith('Relationship Tree 1 needs an existing Region__c record for a required lookup, and qa (qa@example.com.qa) returned none, so nothing was generated or inserted.');
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(postedNamed('insertState').at(-1).isRunning).toBe(false);

        });

        it('keeps what was inserted when records fail, offers View errors for them, and reloads onto the Treecipe tab', async () => {

            const connection = buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Contact' && record.attributes.referenceId.startsWith('Contact_Reference_2__') });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(connection.deleteCalls).toEqual([]);
            expect(insertedOf(connection, 'Account')).toHaveLength(2);
            expect(insertedOf(connection, 'Contact').length).toBeGreaterThan(0);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringMatching(/^\d+ records were inserted into qa \(qa@example\.com\.qa\) from Relationship Tree 1 and \d+ failed\. Nothing was rolled back; "View errors" in the Treecipe tab opens the results\.$/));
            expect(postedNamed('recipeData').at(-1).focusTree).toEqual({ treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' });
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            // THE RELOADED PANEL ASKS AGAIN, AS THE REAL ONE DOES ON ITS NEXT DRAW, AND THE RESULT RIDES ON ITS READINESS
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const insertResults = postedNamed('dataOrgReadiness').at(-1).insertResults;
            expect(insertResults).toHaveLength(1);
            expect(insertResults[0]).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, outcome: 'completed' });
            expect(insertResults[0].failedCount).toBeGreaterThan(0);
            expect(insertResults[0].savedCount).toBe(connection.insertedRecordsById.size);
            expect(JSON.stringify(insertResults)).not.toContain('InsertAttempts');

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            await receivedMessageHandler({ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY, resultsFilePath: '/etc/passwd' });
            expect(openFileSpy).toHaveBeenCalledWith(path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0], 'InsertAttempts', `insertAttempt-${TIMESTAMP}`, `insertAttemptResults-${TIMESTAMP}.json`));

            // AND SAYS SO WHEN THE FILE IS GONE
            openFileSpy.mockClear();
            fs.rmSync(fakeDataSetsFolderPath(), { recursive: true, force: true });
            await receivedMessageHandler({ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY });
            expect(openFileSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith('The results file of that insert no longer exists in this workspace.');

        });

        /*
            KNOWN DEFECT (left failing on purpose): with all-or-none false, a FAILED record's result
            carries no id, and CollectionsApiService.updateReferenceIdMapWithCreatedRecords still records
            it (referenceId -> undefined). updateLookupReferencesInCollectionApiJson then replaces the
            failed parent's nickname with JSON.stringify(undefined), writing the bare word undefined into
            the children's JSON, which no longer parses -- so the WHOLE child file is skipped as "Failed to
            process", children of the saved parent included, and the outcome still reads "completed".
        */
        it('given a parent that failed, still inserts the children of every parent that was saved, each under a saved parent', async () => {

            const connection = buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Account' && record.attributes.referenceId.startsWith('Account_Reference_1__') });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            const savedAccountIds = insertedOf(connection, 'Account').map(account => account.recordId);
            const contacts = insertedOf(connection, 'Contact');
            expect(savedAccountIds).toHaveLength(1);
            expect(showWarningMessageSpy).not.toHaveBeenCalledWith('Failed to process collectionsApi-Contact.json');
            expect(contacts.length).toBeGreaterThanOrEqual(3);
            contacts.forEach(contact => expect(savedAccountIds).toContain(contact.AccountId));

        });

        it('still reloads and re-enables when the insert throws after the data set was written, then reports the failure', async () => {

            expectsCapturedError = true;
            jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg').mockRejectedValue(new Error('REQUEST_LIMIT_EXCEEDED'));

            await openSelectedCockpit(FAKER_JS_RUN);
            const recipeDataPostsBefore = postedNamed('recipeData').length;
            await insertAccountTree();

            expect(datasetFolderNames()).toHaveLength(1);
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore + 1);
            expect(postedNamed('recipeData').at(-1).focusTree).toEqual({ treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' });
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'REQUEST_LIMIT_EXCEEDED' }), 'openRecipeCockpit');

        });

        it('reloads nothing when generation wrote no data set, and says nothing was inserted', async () => {

            executeCommand.mockResolvedValue(undefined);
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            const recipeDataPostsBefore = postedNamed('recipeData').length;
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith('Relationship Tree 1 was not generated, so nothing was inserted into qa (qa@example.com.qa).');
            expect(connection.insertCalls).toEqual([]);
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('generates from the card\'s counts on a filtered copy, and the confirmation counts what that copy makes', async () => {

            const workspaceState = buildWorkspaceState();
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN, workspaceState);
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 4 });
            expect(postedNamed('objectSelection').at(-1)).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, objectCounts: [{ objectApiName: 'Contact', count: 4 }] });
            await insertAccountTree();

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail).toContain('  Contact: 8 (4 per Account)');
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail).toContain('  OtherChildObject__c: 8 (1 per Contact)');
            const [, recipeFilePath, filteredRecipe, runOptions] = runFakerCalls()[0];
            expect(recipeFilePath).toBe(accountRecipeFilePath(FAKER_JS_RUN));
            expect(filteredRecipe.objectCountsByObject).toEqual({ Contact: 4 });
            expect(runOptions).toEqual({ isConfirmed: true });
            expect(insertedOf(connection, 'Contact')).toHaveLength(8);

        });

        it('refuses, naming the tree, when the filtered copy does not read back, and generates and inserts nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN, workspaceState);
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 4 });
            jest.spyOn(RecipeCockpitRecipeWriter, 'buildFilteredRecipe').mockReturnValue({
                isFiltered: false,
                refusal: { reason: 'unsupported-filter-layout', message: 'The filtered copy did not read back as the kept objects nested where they were meant to be, with the counts that were set, so it was not used.', objectApiName: 'Contact' }
            } as any);
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledTimes(1);
            expect(showWarningMessageSpy.mock.calls[0][0]).toStartWith('Nothing was generated or inserted for Relationship Tree 1: The filtered copy did not read back');
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('refuses, before any modal, a tree one of whose objects the org cannot take', async () => {

            const connection = buildFakeConnection();
            connection.describe.mockImplementation(async (objectApiName: string) => {
                if ( objectApiName === 'OtherChildObject__c' ) {
                    throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                }
                return (buildRawDescribes(false) as any)[objectApiName];
            });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toStartWith('Nothing was inserted into qa (qa@example.com.qa): OtherChildObject__c is not in this org');
            expect(runFakerCalls()).toEqual([]);

        });

        it('refuses a recipe generated for the other backend, as Run Faker does', async () => {

            await openSelectedCockpit(FAKER_JS_RUN);
            selectedFakerService = 'snowfakery';
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith('This recipe was generated for faker-js — switch with "Select Faker Implementation".');
            expect(runFakerCalls()).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('refuses if the selection changed while the dialog was open', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
                return RECIPE_COCKPIT_INSERT_CONFIRM_LABEL;
            });
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The org selection changed after qa (qa@example.com.qa) was confirmed'));
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);

        });

        it('lets the Compare tab send only describes and the Organization query: no COUNT and no data SELECT', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY });

            const orgDescribe = postedNamed('orgDescribe').at(-1);
            expect(orgDescribe).toMatchObject({ treeKey: ACCOUNT_TREE_KEY });
            expect(connection.describe).toHaveBeenCalled();
            expect(connection.sentQueries.length).toBeGreaterThan(0);
            connection.sentQueries.forEach(soql => expect(soql).toBe('SELECT IsSandbox, OrganizationType FROM Organization'));
            expect(connection.insertCalls).toEqual([]);

        });

        it('sends no COUNT and no data SELECT from choosing an org through an insert, except the Ids of a required parent outside the tree', async () => {

            const connection = buildFakeConnection({ withOutsideParent: true });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await receivedMessageHandler({ command: 'selectOrg', treeKey: ACCOUNT_TREE_KEY });
            await insertAccountTree();

            expect(connection.sentQueries.filter(soql => /COUNT\s*\(/i.test(soql))).toEqual([]);
            expect(connection.sentQueries.filter(soql => !soql.includes('FROM Organization') && !soql.includes('FROM RecordType'))).toEqual(['SELECT Id FROM Region__c LIMIT 2000']);

        });

        describe('the allow-list of insertable trees', () => {

            const insertableOf = () => [...panelState().insertableTreeKeys];

            it('is built pending at post and promoted only by the rendered acknowledgement of that model', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(temporaryWorkspaceRoot);
                await receivedMessageHandler({ command: 'ready' });

                expect(insertableOf()).toEqual([]);
                expect([...panelState().pendingInsertableTreeKeys]).toEqual([ACCOUNT_TREE_KEY]);

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() - 1 });
                expect(insertableOf()).toEqual([]);

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                expect(insertableOf()).toEqual([ACCOUNT_TREE_KEY]);

            });

            it('empties on ready, on a newly posted model, and on a failure to draw -- but not on a throw after a draw', async () => {

                await openSelectedCockpit(FAKER_JS_RUN);
                expect(insertableOf()).toEqual([ACCOUNT_TREE_KEY]);

                await receivedMessageHandler({ command: 'renderFailed', phase: 'runtime', message: 'keystroke threw' });
                expect(insertableOf()).toEqual([ACCOUNT_TREE_KEY]);

                await receivedMessageHandler({ command: 'selectRun', runFolderName: SNOWFAKERY_RUN });
                expect(insertableOf()).toEqual([]);
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                expect(insertableOf()).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

                await receivedMessageHandler({ command: 'ready' });
                expect(insertableOf()).toEqual([]);
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                expect(insertableOf()).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

                expectsCapturedError = true;
                await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'draw threw' });
                expect(insertableOf()).toEqual([]);

            });

            it('refuses an insert of a tree before its model is confirmed drawn, answering that nothing runs', async () => {

                await openSelectedCockpit(FAKER_JS_RUN);
                await receivedMessageHandler({ command: 'ready' });
                postedPanelMessages.length = 0;

                await insertAccountTree();

                expect(postedPanelMessages).toEqual([{ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }]);
                expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

            });

        });

    });

    describe('routePanelMessage', () => {

        const RECIPE_FILE_PATH = '/workspace/recipe.yml';

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const routedPanelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            routedPanelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 4 } as any;
            routedPanelState.dataOrgDetails = [SANDBOX_ORG];
            routedPanelState.dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 2, orgTypeDetail: SANDBOX_TYPE } as any;
            routedPanelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            routedPanelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, RECIPE_FILE_PATH);
            return routedPanelState;
        };

        const insertTree = { command: 'insertTree', treeKey: ACCOUNT_TREE_KEY };
        const refusal = (treeKey = ACCOUNT_TREE_KEY) => ({ kind: 'postInsertState', hostMessage: { command: 'insertState', isRunning: false, treeKey } });

        it('routes the tree key alone to the host-held recipe file, reading nothing else the panel sends', () => {

            expect(RecipeCockpitService.routePanelMessage(insertTree, buildPanelState())).toEqual({ kind: 'insertTree', treeKey: ACCOUNT_TREE_KEY, recipeFilePath: RECIPE_FILE_PATH });
            expect(RecipeCockpitService.routePanelMessage({ ...insertTree, orgIndex: 3, count: 5000, recipeFilePath: '/etc/passwd' } as any, buildPanelState()))
                .toEqual({ kind: 'insertTree', treeKey: ACCOUNT_TREE_KEY, recipeFilePath: RECIPE_FILE_PATH });

        });

        it('refuses a tree the confirmed-drawn model did not offer, one with no recipe file, and a key that is not a string', () => {

            const undrawn = buildPanelState();
            undrawn.insertableTreeKeys = new Set();
            undrawn.pendingInsertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            expect(RecipeCockpitService.routePanelMessage(insertTree, undrawn)).toEqual(refusal());

            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: LEAD_TREE_KEY }, buildPanelState())).toEqual(refusal(LEAD_TREE_KEY));

            const noRecipe = buildPanelState();
            noRecipe.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.clear();
            expect(RecipeCockpitService.routePanelMessage(insertTree, noRecipe)).toEqual(refusal());

            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: { toString: () => ACCOUNT_TREE_KEY } }, buildPanelState())).toEqual(refusal(''));
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree' }, buildPanelState())).toEqual(refusal(''));

        });

        it('cannot reach production with a forged message, nor an org whose type was not read, nor no org at all', () => {

            const production = buildPanelState();
            production.dataOrgSelection.orgTypeDetail = { isSandbox: false, organizationType: 'Developer Edition' };
            expect(RecipeCockpitService.routePanelMessage(insertTree, production)).toEqual(refusal());

            const truthy = buildPanelState();
            truthy.dataOrgSelection.orgTypeDetail = { isSandbox: 'true' as any, organizationType: '' };
            expect(RecipeCockpitService.routePanelMessage(insertTree, truthy)).toEqual(refusal());

            const unknownType = buildPanelState();
            delete unknownType.dataOrgSelection.orgTypeDetail;
            expect(RecipeCockpitService.routePanelMessage(insertTree, unknownType)).toEqual(refusal());

            const unselected = buildPanelState();
            unselected.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage(insertTree, unselected)).toEqual(refusal());

            const noModel = buildPanelState();
            noModel.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(insertTree, noModel)).toEqual(refusal());

        });

        it('refuses while a scratch org run or a Run Faker is in flight, and answers nothing while another insert runs', () => {

            const scratchOrgRunning = buildPanelState();
            scratchOrgRunning.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true, statusText: '', isFailure: false, hasOutput: false } as any;
            expect(RecipeCockpitService.routePanelMessage(insertTree, scratchOrgRunning)).toEqual(refusal());

            const runFakerRunning = buildPanelState();
            runFakerRunning.runFakerStateMessage = { command: 'runFakerState', isRunning: true, treeKey: LEAD_TREE_KEY } as any;
            expect(RecipeCockpitService.routePanelMessage(insertTree, runFakerRunning)).toEqual(refusal());

            const insertRunning = buildPanelState();
            insertRunning.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: LEAD_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(insertTree, insertRunning)).toBeUndefined();

        });

        it('opens an insert\'s results only for the selected org\'s tree that had failures', () => {

            const routedPanelState = buildPanelState();
            const storeResult = (orgUsername: string, failedCount: number) => routedPanelState.dataOrgInsertResults.set(
                RecipeCockpitService.buildInsertResultKey(orgUsername, ACCOUNT_TREE_KEY),
                { viewModel: { treeKey: ACCOUNT_TREE_KEY, savedCount: 2, failedCount, outcome: 'completed' }, resultsFilePath: '/workspace/results.json' }
            );
            const viewErrors = { command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY };

            expect(RecipeCockpitService.routePanelMessage(viewErrors, routedPanelState)).toBeUndefined();
            storeResult('other@example.com', 4);
            expect(RecipeCockpitService.routePanelMessage(viewErrors, routedPanelState)).toBeUndefined();
            storeResult(SANDBOX_ORG.username, 0);
            expect(RecipeCockpitService.routePanelMessage(viewErrors, routedPanelState)).toBeUndefined();
            storeResult(SANDBOX_ORG.username, 1);
            expect(RecipeCockpitService.routePanelMessage(viewErrors, routedPanelState)).toEqual({ kind: 'viewInsertErrors', resultsFilePath: '/workspace/results.json' });
            expect(RecipeCockpitService.routePanelMessage({ ...viewErrors, resultsFilePath: '/etc/passwd' } as any, routedPanelState)).toEqual({ kind: 'viewInsertErrors', resultsFilePath: '/workspace/results.json' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'viewInsertErrors', treeKey: LEAD_TREE_KEY }, routedPanelState)).toBeUndefined();

            routedPanelState.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage(viewErrors, routedPanelState)).toBeUndefined();

        });

    });

    describe('the model\'s insertable trees and objects', () => {

        const loadSnowfakeryModel = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;
        };

        it('offers the insert on every card ▶ Run Faker can run', () => {

            const recipe = loadSnowfakeryModel();

            expect(RecipeCockpitService.collectInsertableTreeKeys(recipe)).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

            recipe.trees[1].runFakerRecipeFileName = undefined;
            expect(RecipeCockpitService.collectInsertableTreeKeys(recipe)).toEqual([ACCOUNT_TREE_KEY]);

        });

        it('sends each object of the tree once, with a recipe, leaving out an excluded one', () => {

            const recipe = loadSnowfakeryModel();
            const accountTree = recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);

            expect(RecipeCockpitService.listTreeInsertObjectApiNames(recipe, accountTree)).toEqual(['Account', 'Contact', 'OtherChildObject__c']);

            accountTree.objectSelection = {
                includedObjectCount: 1,
                objectCount: 3,
                exclusions: [
                    { objectApiName: 'Contact', kind: 'excluded' },
                    { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
                ]
            } as any;
            expect(RecipeCockpitService.listTreeInsertObjectApiNames(recipe, accountTree)).toEqual(['Account']);

        });

    });

    describe('buildInsertConfirmationDetail', () => {

        const recipeRuns = () => RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
        const detailOf = (recordTotals: Array<[string, number]>, outsideParents: string[] = []) => {
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns(), TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;
            const accountTree = recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);
            return RecipeCockpitService.buildInsertConfirmationDetail('qa (qa@example.com.qa)', SANDBOX_TYPE, accountTree, recipe, new Map(recordTotals), outsideParents, 'snowfakery', 'recipe.yml');
        };

        it('lists the org, its type, the tree, the backend and each object\'s total', () => {

            const detailLines = detailOf([['Account', 1], ['Contact', 1]]).split('\n');

            expect(detailLines.slice(0, 7)).toEqual([
                'Org: qa (qa@example.com.qa)',
                'Type: Sandbox',
                'Recipe tree: Relationship Tree 1 (recipe.yml)',
                'Backend: snowfakery',
                'Records, inserted parents first:',
                '  Account: 1',
                '  Contact: 1'
            ]);
            expect(detailLines.at(-1)).toContain('you choose all-or-none next');

        });

        it('warns past 2,000 records with the total and the requests, and not at 2,000', () => {

            expect(detailOf([['Account', 1000], ['Contact', 1000]])).not.toContain('This run will take time');
            expect(detailOf([['Account', 1000], ['Contact', 1001]])).toContain('This run will take time: 2001 records in at least 11 Collections API requests.');

        });

        it('names a required parent outside the tree, and escapes what it names', () => {

            expect(detailOf([['Contact', 1]], ['Region__c'])).toContain('Required lookups to objects this tree does not insert get a random existing record of: Region__c (none means nothing is inserted).');
            expect(detailOf([['Contact', 1]], ['[x](command:evil)'])).not.toContain('[x](command:evil)');

        });

    });

    describe('buildTreeInsertRecordPreparer', () => {

        const normalizedDescribe = (objectApiName: string) => {
            const rawDescribe = (buildRawDescribes(false) as any)[objectApiName];
            return rawDescribe ? SalesforceOrgService.normalizeDescribeResult(objectApiName, rawDescribe) : undefined;
        };

        beforeEach(() => {
            jest.spyOn(SalesforceOrgService, 'getCachedDescribe').mockImplementation((_orgUsername: string, objectApiName: string) => normalizedDescribe(objectApiName) as any);
        });

        const createdIds = {
            'Account_Reference_1__Account_NickName': '001000000000001AAA',
            'Account_Reference_2__Account_NickName': '001000000000002AAA'
        };

        it('gives an unwired Contact an Account this run inserted, and keeps an Id the insert already resolved', () => {

            const prepare = RecipeCockpitService.buildTreeInsertRecordPreparer(SANDBOX_ORG.username, new Set(['Account', 'Contact']), new Map(), () => 1);

            const prepared = prepare('Contact', [
                { attributes: { type: 'Contact', referenceId: 'Contact_Reference_1__Contact_NickName' }, LastName: 'Ng', AccountId: null, ReportsToId: 'Contact_NickName' },
                { attributes: { type: 'Contact', referenceId: 'Contact_Reference_2__Contact_NickName' }, LastName: 'Li', AccountId: '001000000000001AAA' }
            ], createdIds) as any[];

            expect(prepared[0].AccountId).toBe('001000000000002AAA');
            // A NICKNAME OF A RECORD OF THE SAME FILE IS KEPT FOR A LATER ROUND TO RESOLVE
            expect(prepared[0].ReportsToId).toBe('Contact_NickName');
            expect(prepared[1].AccountId).toBe('001000000000001AAA');

        });

        // KNOWN DEFECT (left failing on purpose): A FAILED RECORD'S referenceId MAPS TO undefined, AND THE PREPARER OFFERS IT AS A RUN PARENT
        it('never hands a record the Id of a parent that failed to insert', () => {

            const choiceCounts: number[] = [];
            const prepare = RecipeCockpitService.buildTreeInsertRecordPreparer(SANDBOX_ORG.username, new Set(['Account', 'Contact']), new Map(),
                choiceCount => { choiceCounts.push(choiceCount); return choiceCount - 1; });

            const [prepared] = prepare('Contact', [{ LastName: 'Ng', AccountId: null }], {
                'Account_Reference_1__Account_NickName_1': '001000000000001AAA',
                'Account_Reference_2__Account_NickName_2': undefined as unknown as string
            }) as any[];

            expect(prepared.AccountId).toBe('001000000000001AAA');
            expect(choiceCounts).toEqual([1]);

        });

        it('never takes an Id of an object the tree does not insert, and sends an object it has no describe for as generated', () => {

            const prepare = RecipeCockpitService.buildTreeInsertRecordPreparer(SANDBOX_ORG.username, new Set(['Contact']), new Map(), () => 0);
            const [prepared] = prepare('Contact', [{ AccountId: 'TODO' }], createdIds) as any[];
            expect(prepared).not.toHaveProperty('AccountId');

            const records = [{ Company: 'x', Whatever__c: 'TODO' }];
            expect(prepare('Ghost__c', records, createdIds)).toBe(records);

        });

        it('fills a required lookup to a parent outside the tree from the org Ids it was handed', () => {

            jest.spyOn(SalesforceOrgService, 'getCachedDescribe').mockImplementation(() => SalesforceOrgService.normalizeDescribeResult('Contact', (buildRawDescribes(true) as any).Contact) as any);
            const prepare = RecipeCockpitService.buildTreeInsertRecordPreparer(SANDBOX_ORG.username, new Set(['Account', 'Contact']), new Map([['Region__c', OUTSIDE_REGION_IDS]]), () => 0);

            const [prepared] = prepare('Contact', [{ LastName: 'Ng', Region__c: '### TODO' }], createdIds) as any[];

            expect(prepared.Region__c).toBe(OUTSIDE_REGION_IDS[0]);
            expect(prepared.AccountId).toBe('001000000000001AAA');

        });

    });

    describe('the panel script, the tree insert', () => {

        const loadModel = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;
        };

        const renderPanel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            return panel;
        };

        const selectOrg = (panel: any, failureMessage?: string) => {
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: failureMessage ? 'Production · Enterprise Edition' : 'Sandbox',
                isSandbox: !failureMessage, requestSequence: 3, renderSequence: 1, ...( failureMessage ? { failureMessage } : {} )
            });
        };

        const postReadiness = (panel: any, otherChildReason = '', insertResults: any[] = []) => panel.postToPanel({
            command: 'dataOrgReadiness',
            objects: [
                { objectApiName: 'Account', disabledReason: '', requiredLookups: [] },
                { objectApiName: 'Contact', disabledReason: '', requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] },
                { objectApiName: 'OtherChildObject__c', disabledReason: otherChildReason, requiredLookups: [] },
                { objectApiName: 'Lead', disabledReason: '', requiredLookups: [] }
            ],
            createTargets: [],
            insertResults: insertResults,
            requestSequence: 3,
            renderSequence: 1
        });

        const accountCard = (panel: any) => panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeInsertControls').length > 0
            && panel.findAll(treeCard, 'treeTitle').concat(panel.findAll(treeCard, 'treeName')).some((titleElement: any) => /Relationship Tree 1/.test(titleElement.textContent)))
            ?? panel.treeCards()[0];
        const partOf = (panel: any, rootElement: any, className: string) => panel.findAll(rootElement, className)[0];
        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('draws the insert at the top of the Treecipe tab, disabled with its reason while no org is selected', () => {

            const panel = renderPanel();
            const card = accountCard(panel);

            const header = partOf(panel, card, 'treecipeHeader');
            expect(header).toBeDefined();
            expect(partOf(panel, header, 'treeInsertControls')).toBeDefined();
            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('Choose an org above to insert into.');

        });

        it('disables the insert with the selection\'s failure as its reason when the org could not be used', () => {

            const panel = renderPanel();
            selectOrg(panel, 'qa could not be reached: INVALID_SESSION_ID');
            const card = accountCard(panel);

            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('qa could not be reached: INVALID_SESSION_ID');

        });

        it('waits for the host\'s readiness, then names the first object that cannot be inserted', () => {

            const panel = renderPanel();
            selectOrg(panel);
            const card = accountCard(panel);

            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('checking whether this tree can be inserted…');

            postReadiness(panel, 'OtherChildObject__c is not createable in this org.');
            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('OtherChildObject__c is not createable in this org.');

        });

        it('posts the tree key alone, and holds every insert disabled until the host says it ended', () => {

            const panel = renderPanel();
            selectOrg(panel);
            postReadiness(panel);
            const card = accountCard(panel);
            const insertButton = partOf(panel, card, 'treeInsert');

            expect(insertButton.disabled).toBe(false);
            expect(insertButton.textContent).toBe('Generate fake data and insert into qa');
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('');

            insertButton.dispatch('click');

            expect(postedNamed(panel, 'insertTree')).toEqual([{ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }]);
            expect(insertButton.textContent).toBe('Inserting…');
            expect(panel.findAll(panel.cockpitBodyElement, 'treeInsert').every((buttonElement: any) => buttonElement.disabled)).toBe(true);

            panel.postToPanel({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(insertButton.disabled).toBe(false);

        });

        it('draws the result of the last insert, and View errors posts the tree key alone', () => {

            const panel = renderPanel();
            selectOrg(panel);
            postReadiness(panel, '', [{ treeKey: ACCOUNT_TREE_KEY, savedCount: 12, failedCount: 2, outcome: 'completed' }]);
            const card = accountCard(panel);

            expect(partOf(panel, card, 'treeInsertResult').textContent).toBe('12 inserted · 2 failed');
            const errorsButton = partOf(panel, card, 'treeInsertErrors');
            expect(panel.isHidden(errorsButton)).toBe(false);

            errorsButton.dispatch('click');
            expect(postedNamed(panel, 'viewInsertErrors')).toEqual([{ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY }]);

        });

    });

});
