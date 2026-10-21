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
    RECIPE_COCKPIT_INSERT_ACTION_LABEL,
    RECIPE_COCKPIT_CANNOT_INSERT_PREFIX,
    RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_OPEN_COMMAND,
    RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL,
    RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL,
    RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitTreeHistory } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { OrgConnectionStatusUnavailableError, SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { ExtensionCommandService } from '../../ExtensionCommandService/ExtensionCommandService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

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
    // FIELDS THE ORG DOES NOT HAVE, BY OBJECT: LEFT OUT OF ITS DESCRIBE
    missingFieldsByObject?: Record<string, string[]>;
    // FIELDS THE ORG HAS BUT WILL NOT LET THE USER SET, BY OBJECT
    notCreateableFieldsByObject?: Record<string, string[]>;
}

function buildFakeConnection(options: IFakeConnectionOptions = {}) {

    const rawDescribes = buildRawDescribes(options.withOutsideParent === true);
    Object.entries(rawDescribes).forEach(([objectApiName, rawDescribe]: [string, any]) => {
        const missingFields = options.missingFieldsByObject?.[objectApiName] ?? [];
        const notCreateableFields = options.notCreateableFieldsByObject?.[objectApiName] ?? [];
        rawDescribe.fields = rawDescribe.fields
            .filter((field: any) => !missingFields.includes(field.name))
            .map((field: any) => notCreateableFields.includes(field.name) ? { ...field, createable: false } : field);
    });
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


// THE ORG SHOWN WHILE THE CONNECTIONS ARE CHECKED (#305) IS READ FROM THE MACHINE'S OWN AUTHORIZATIONS, SO NO SUITE DEPENDS ON THEM
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readLocalDataOrgDetail').mockResolvedValue(undefined);
});

answerInPanelConfirmationsThroughWarningMock();

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
        // THE TREE INSERT'S RESULT NOTIFICATIONS (#301): NOT A MODAL, AND WITH A BUTTON -- THE SHARED INSERT'S OWN PROGRESS NOTES HAVE NONE
        const resultNotificationCalls = (notify: unknown) => ( notify as jest.Mock ).mock.calls.filter(notificationCall => notificationCall.length > 1 && !notificationCall[1]?.inPanel);
        const insertResultsFilePath = () => path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0], 'InsertAttempts', `insertAttempt-${TIMESTAMP}`, `insertAttemptResults-${TIMESTAMP}.json`);
        // THE MODAL IS CONFIRMED; A RESULT NOTIFICATION IS LEFT OPEN UNTIL THE TEST CLICKS ITS BUTTON
        const holdResultNotifications = () => {
            const clickButton: { answer?: (label: string | undefined) => void } = {};
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options?: { inPanel?: boolean }) => options?.inPanel
                ? RECIPE_COCKPIT_INSERT_CONFIRM_LABEL
                : new Promise(resolve => { clickButton.answer = resolve; }));
            return clickButton;
        };
        const flushNotificationClick = () => new Promise(resolve => setImmediate(resolve));

        beforeEach(() => {

            postedPanelMessages = [];
            snowfakeryCalls.length = 0;
            buildWorkspace(buildFakerJsAccountRecipe(2, 3));

            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                visible: true,
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

        // #375: THE DIALOG NO LONGER OFFERS "Generate only"; CANCEL GENERATES NOTHING
        it('offers only Generate and insert in the dialog, and a cancel generates and inserts nothing', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openSelectedCockpit(FAKER_JS_RUN);
            postedPanelMessages.length = 0;
            await insertAccountTree();

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0].slice(2)).toEqual([RECIPE_COCKPIT_INSERT_CONFIRM_LABEL]);
            expect(runFakerCalls()).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        describe('with no org chosen yet (#375)', () => {

            let promptSpy: jest.SpyInstance;

            const openUnselectedCockpit = async (runFolderName: string) => {
                await RecipeCockpitService.openRecipeCockpitPanel(temporaryWorkspaceRoot);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                if ( postedNamed('recipeData').at(-1).recipe.selectedRunFolderName !== runFolderName ) {
                    await receivedMessageHandler({ command: 'selectRun', runFolderName });
                    await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                }
            };

            beforeEach(() => {
                promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed')
                    .mockImplementation(async (orgListing: Promise<any>) => ( await orgListing ).orgDetails[0]);
            });

            it('asks for the org in the command palette, selects it in the dropdown as a pick there would, then inserts', async () => {

                const connection = buildFakeConnection();
                useConnection(connection);

                await openUnselectedCockpit(FAKER_JS_RUN);
                expect(panelState().dataOrgSelection).toBeUndefined();
                postedPanelMessages.length = 0;
                await insertAccountTree();

                expect(promptSpy).toHaveBeenCalledTimes(1);
                expect(promptSpy.mock.calls[0][1]).toBe(RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER);
                expect(postedNamed('dataOrgList')).toEqual([expect.objectContaining({ orgLabels: [expect.stringContaining('qa')], selectedOrgIndex: 0 })]);
                expect(postedNamed('dataOrgSelection').at(-1)).toMatchObject({ orgIndex: 0, isSandbox: true });
                expect(panelState().dataOrgSelection?.orgDetail.username).toBe(SANDBOX_ORG.username);
                expect(runFakerCalls()).toHaveLength(1);
                expect(insertedOf(connection, 'Account')).toHaveLength(2);
                expect(postedNamed('insertState').map(insertState => insertState.isRunning)).toEqual([true, true, false]);
                expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('given a dismissed pick, selects nothing, connects to nothing and gives the button back', async () => {

                promptSpy.mockResolvedValue(undefined);

                await openUnselectedCockpit(FAKER_JS_RUN);
                postedPanelMessages.length = 0;
                await insertAccountTree();

                expect(getConnectionSpy).not.toHaveBeenCalled();
                expect(postedNamed('dataOrgList')).toEqual([]);
                expect(panelState().dataOrgSelection).toBeUndefined();
                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState')).toEqual([
                    { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY },
                    { command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }
                ]);

            });

            it('given an org that answers it is not a sandbox, says so and generates and inserts nothing', async () => {

                const connection = buildFakeConnection({ isSandbox: false });
                useConnection(connection);

                await openUnselectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(showWarningMessageSpy).toHaveBeenCalledWith('Nothing was generated or inserted: qa is not a sandbox or scratch org, and the Treecipe tab inserts only into a sandbox or scratch org.');
                expect(runFakerCalls()).toEqual([]);
                expect(connection.insertCalls).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('given an org whose type could not be read, says so and generates and inserts nothing', async () => {

                useConnection(buildFakeConnection({ organizationQueryFails: true }));

                await openUnselectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(showWarningMessageSpy).toHaveBeenCalledWith('Nothing was generated or inserted: qa could not be checked, and the Treecipe tab inserts only into a sandbox or scratch org.');
                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('inserts nothing when the selection the check made is replaced before it ends, or a run takes the window meanwhile', async () => {

                useConnection(buildFakeConnection());
                await openUnselectedCockpit(FAKER_JS_RUN);
                const selectDataOrgSpy = jest.spyOn(RecipeCockpitService as any, 'selectDataOrg');

                // ANOTHER SELECTION REPLACED THE ONE THE PICK MADE
                selectDataOrgSpy.mockImplementationOnce(async () => { panelState().dataOrgSelection = undefined; });
                postedPanelMessages.length = 0;
                await insertAccountTree();
                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

                // A SCRATCH ORG RUN STARTED WHILE THE ORG WAS CHECKED: THE ROUTER REFUSES THE INSERT AS IT WOULD A CLICK
                selectDataOrgSpy.mockImplementationOnce(async (_panel: unknown, checkedPanelState: IRecipeCockpitPanelState, orgIndex: number) => {
                    checkedPanelState.dataOrgSelection = { orgIndex: orgIndex, orgDetail: checkedPanelState.dataOrgDetails[orgIndex], requestSequence: 50, orgTypeDetail: SANDBOX_TYPE } as any;
                    checkedPanelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
                });
                panelState().dataOrgSelection = undefined;
                postedPanelMessages.length = 0;
                await insertAccountTree();
                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
                panelState().scratchOrgStateMessage = undefined;

            });

            it('given a CLI that cannot list the orgs, says why and gives the button back (#378 review)', async () => {

                const listingError = new OrgConnectionStatusUnavailableError('sf org list timed out [x](command:y).');
                (SalesforceOrgService.listDataOrgDetails as jest.Mock).mockRejectedValue(listingError);

                await openUnselectedCockpit(FAKER_JS_RUN);
                postedPanelMessages.length = 0;
                await insertAccountTree();

                expect(showWarningMessageSpy).toHaveBeenCalledWith(`Nothing was generated or inserted: ${RecipeYamlScalar.escapeForNotification(listingError.message)}`);
                expect(showWarningMessageSpy.mock.calls[0][0]).not.toContain('[x](command:y)');
                expect(getConnectionSpy).not.toHaveBeenCalled();
                expect(panelState().insertStateMessage).toBeUndefined();
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('given any other listing failure, gives the button back and reports it as an error', async () => {

                expectsCapturedError = true;
                promptSpy.mockRejectedValue(new Error('picker exploded'));

                await openUnselectedCockpit(FAKER_JS_RUN);
                postedPanelMessages.length = 0;
                await insertAccountTree();

                expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'picker exploded' }), expect.any(String));
                expect(panelState().insertStateMessage).toBeUndefined();
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('gives the button back, and reports the error, when checking the picked org throws', async () => {

                expectsCapturedError = true;
                useConnection(buildFakeConnection());
                await openUnselectedCockpit(FAKER_JS_RUN);
                jest.spyOn(RecipeCockpitService as any, 'selectDataOrg').mockRejectedValue(new Error('describe exploded'));
                postedPanelMessages.length = 0;

                await insertAccountTree();

                expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'describe exploded' }), expect.any(String));
                expect(runFakerCalls()).toEqual([]);
                expect(panelState().insertStateMessage).toBeUndefined();
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('holds the window while the picked org is checked, so a reveal replays the insert and the router refuses a run that would change the selection (#378 review)', async () => {

                const connection = buildFakeConnection();
                useConnection(connection);
                await openUnselectedCockpit(FAKER_JS_RUN);
                const realSelectDataOrg = ( RecipeCockpitService as any ).selectDataOrg.bind(RecipeCockpitService);
                let heldDuringCheck: unknown;
                let routedDuringCheck: unknown;
                jest.spyOn(RecipeCockpitService as any, 'selectDataOrg').mockImplementation(async (...selectArguments: any[]) => {
                    heldDuringCheck = panelState().insertStateMessage;
                    routedDuringCheck = RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState());
                    return realSelectDataOrg(...selectArguments);
                });

                await insertAccountTree();

                expect(heldDuringCheck).toEqual({ command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
                expect(routedDuringCheck).toMatchObject({ kind: 'postScratchOrgState' });
                expect(insertedOf(connection, 'Account')).toHaveLength(2);
                expect(panelState().insertStateMessage).toBeUndefined();

            });

            it('inserts nothing when the router no longer routes the insert after the check', async () => {

                useConnection(buildFakeConnection());
                await openUnselectedCockpit(FAKER_JS_RUN);
                const realRoutePanelMessage = RecipeCockpitService.routePanelMessage.bind(RecipeCockpitService);
                jest.spyOn(RecipeCockpitService, 'routePanelMessage').mockImplementation((panelMessage: any, routedPanelState: any) => (
                    panelMessage?.command === 'insertTree' && routedPanelState.dataOrgSelection ? undefined : realRoutePanelMessage(panelMessage, routedPanelState)
                ));
                postedPanelMessages.length = 0;

                await insertAccountTree();

                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

            it('given a pick while another org was chosen in the dropdown meanwhile, leaves that choice alone', async () => {

                useConnection(buildFakeConnection());
                await openUnselectedCockpit(FAKER_JS_RUN);
                promptSpy.mockImplementation(async (orgListing: Promise<any>) => {
                    const listing = await orgListing;
                    panelState().dataOrgDetails = listing.orgDetails;
                    panelState().dataOrgSelection = { orgIndex: 0, orgDetail: listing.orgDetails[0], requestSequence: 99 } as any;
                    return listing.orgDetails[0];
                });

                await insertAccountTree();

                expect(postedNamed('dataOrgList')).toEqual([]);
                expect(panelState().dataOrgSelection?.requestSequence).toBe(99);
                expect(runFakerCalls()).toEqual([]);
                expect(postedNamed('insertState').at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            });

        });

        it('given faker-js, confirms every object with its total, then generates the tree through Run Faker and inserts it parents first, each child under a parent of this run', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            const recipeDataPostsBefore = postedNamed('recipeData').length;
            await insertAccountTree();

            // THE HOST-SIDE MODAL: EACH OBJECT'S TOTAL, A NESTED FRIEND'S PER-PARENT COUNT, AND NO LARGE-RUN WARNING
            const [modalMessage, modalOptions, modalAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(modalMessage).toBe('Generate Account-thru-OtherChildObject__c and insert it into qa (qa@example.com.qa)?');
            expect(modalOptions.inPanel).toBe(true);
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

            // GENERATED BY Run Faker by Recipe, ITS OWN MODAL ANSWERED BY THIS ONE
            expect(runFakerCalls()).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, accountRecipeFilePath(FAKER_JS_RUN), undefined, { confirmationToken: expect.stringMatching(/^[0-9a-f]{64}$/) }]]);
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

            // NO RELOAD (#226): THE CARD'S RESULT AND ITS NEW DATA SET ARRIVE IN PLACE, THE STATE MESSAGE LAST
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore);
            expect(postedNamed('datasetAdded')).toEqual([{
                command: 'datasetAdded',
                treeKeys: [ACCOUNT_TREE_KEY],
                dataset: {
                    datasetFolderName: `dataset-fakerjs-${TIMESTAMP}`,
                    generatedAtLabel: '2026-10-07 12:00:00 UTC',
                    fakerService: 'faker-js',
                    runFolderName: FAKER_JS_RUN,
                    recordCounts: [{ objectApiName: 'Account', recordCount: 2 }, { objectApiName: 'Contact', recordCount: 6 }, { objectApiName: 'OtherChildObject__c', recordCount: 6 }]
                },
                renderSequence: lastRenderSequence(),
                updateSequence: 1
            }]);
            // HOW IT WENT IS A NOTIFICATION'S, WITH THE RESULTS FILE ONE CLICK AWAY (#301)
            expect(resultNotificationCalls(vscode.window.showInformationMessage)).toEqual([
                ['14 records were inserted into qa (qa@example.com.qa) from Account-thru-OtherChildObject__c.', RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL]
            ]);
            expect(resultNotificationCalls(vscode.window.showWarningMessage)).toEqual([]);
            expect(postedNamed('insertState').map(insertState => insertState.isRunning)).toEqual([true, false]);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('given snowfakery, gives every unwired TODO lookup a parent this run inserted', async () => {

            selectedFakerService = 'snowfakery';
            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await insertAccountTree();

            expect(runFakerCalls()).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, accountRecipeFilePath(SNOWFAKERY_RUN), undefined, { confirmationToken: expect.stringMatching(/^[0-9a-f]{64}$/) }]]);
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
            expect(Object.keys(insertOptions)).toEqual(['prepareRecords', 'isFailureReportedByCaller']);
            // THE CARD'S OWN NOTIFICATION SAYS HOW IT ENDED, SO THE SHARED INSERT SHOWS NONE OF ITS OWN (#310)
            expect(insertOptions.isFailureReportedByCaller).toBe(true);
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

        describe('a parent picker for each lookup of the tree to a parent it does not insert (#254)', () => {

            const CHOSEN_REGION_IDS = ['a05000000000007AAA', 'a05000000000008AAA'];
            const recipeWithRegion = () => buildFakerJsAccountRecipe(2, 3).replace(
                '        AccountId: Account_NickName\n',
                '        AccountId: Account_NickName\n        Region__c: ### TODO -- REFERENCE ID REQUIRED -- Region__c\n'
            );
            const answerPickers = (answerPicker: (pickerOptions: any) => Promise<any>) =>
                jest.spyOn(VSCodeWorkspaceService, 'promptForParentRecords').mockImplementation(answerPicker);

            beforeEach(() => {
                buildWorkspace(recipeWithRegion());
                jest.spyOn(SalesforceOrgService, 'searchParentRecords').mockResolvedValue({
                    matches: CHOSEN_REGION_IDS.map((recordId, matchIndex) => ({ recordId: recordId, recordName: `Region ${matchIndex}` })),
                    hasMoreMatches: false
                });
            });

            it('asks after the confirm, only about the outside lookup, and gives the chosen parents out round-robin', async () => {

                const connection = buildFakeConnection({ withOutsideParent: true });
                useConnection(connection);
                const askedOrder: string[] = [];
                (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => { askedOrder.push('confirm'); return RECIPE_COCKPIT_INSERT_CONFIRM_LABEL; });
                allOrNoneSpy.mockImplementation(async () => { askedOrder.push('allOrNone'); return false; });
                const pickerSpy = answerPickers(async (pickerOptions: any) => {
                    askedOrder.push(`picker:${pickerOptions.fieldApiName}`);
                    await pickerOptions.search('Region');
                    return { kind: 'chosen', records: CHOSEN_REGION_IDS.map(recordId => ({ recordId: recordId, recordName: recordId })) };
                });

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(askedOrder).toEqual(['confirm', 'picker:Region__c', 'allOrNone']);
                expect(pickerSpy).toHaveBeenCalledTimes(1);
                expect(pickerSpy.mock.calls[0][0]).toMatchObject({ fieldApiName: 'Region__c', parentObjectApiName: 'Region__c', isRequired: true });
                expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail).toContain('  Contact.Region__c → Region__c (required)');
                expect(connection.sentQueries).not.toContain('SELECT Id FROM Region__c LIMIT 2000');
                const contacts = insertedOf(connection, 'Contact');
                expect(contacts).toHaveLength(6);
                expect(contacts.map(contact => contact.Region__c)).toEqual([0, 1, 2, 3, 4, 5].map(contactIndex => CHOSEN_REGION_IDS[contactIndex % 2]));

            });

            it('gives each record a random existing parent when Random parent is chosen', async () => {

                const connection = buildFakeConnection({ withOutsideParent: true });
                useConnection(connection);
                answerPickers(async () => ({ kind: 'random' }));

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(connection.sentQueries).toContain('SELECT Id FROM Region__c LIMIT 2000');
                insertedOf(connection, 'Contact').forEach(contact => expect(OUTSIDE_REGION_IDS).toContain(contact.Region__c));

            });

            it('generates and inserts nothing when a picker is cancelled, and says which lookup had no parent', async () => {

                const connection = buildFakeConnection({ withOutsideParent: true });
                useConnection(connection);
                answerPickers(async () => undefined);

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('no Region__c parent was chosen for Contact.Region__c');
                expect(allOrNoneSpy).not.toHaveBeenCalled();
                expect(runFakerCalls()).toEqual([]);
                expect(connection.insertCalls).toEqual([]);
                expect(datasetFolderNames()).toEqual([]);

            });

            it('refuses Ids its own search did not return, before anything is written', async () => {

                const connection = buildFakeConnection({ withOutsideParent: true });
                useConnection(connection);
                answerPickers(async () => ({ kind: 'chosen', records: [{ recordId: 'a05000000000099AAA', recordName: 'forged' }] }));

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('are not ones its search returned');
                expect(runFakerCalls()).toEqual([]);
                expect(connection.insertCalls).toEqual([]);

            });

            it('never asks about a lookup to a parent the tree inserts', async () => {

                buildWorkspace(buildFakerJsAccountRecipe(2, 3));
                useConnection(buildFakeConnection());
                const pickerSpy = answerPickers(async () => ({ kind: 'random' }));

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();

                expect(pickerSpy).not.toHaveBeenCalled();

            });

        });

        it('refuses before writing anything when the parent outside the tree has no records', async () => {

            const connection = buildFakeConnection({ withOutsideParent: true, outsideParentIds: [] });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith('Account-thru-OtherChildObject__c needs an existing Region__c record for a required lookup, and qa (qa@example.com.qa) returned none, so nothing was generated or inserted.');
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(postedNamed('insertState').at(-1).isRunning).toBe(false);

        });

        it('keeps what was inserted when records fail, and its warning\'s View errors opens the results file (#301)', async () => {

            const connection = buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Contact' && record.attributes.referenceId.startsWith('Contact_Reference_2__') });
            useConnection(connection);
            const clickButton = holdResultNotifications();
            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            expect(connection.deleteCalls).toEqual([]);
            expect(insertedOf(connection, 'Account')).toHaveLength(2);
            expect(insertedOf(connection, 'Contact').length).toBeGreaterThan(0);
            // #375: THE FIRST FILE THAT FAILED IS NAMED AND ONE CLICK AWAY, AND THE ERROR POINTS AT A TROUBLESHOOTING SUB-TAB
            expect(resultNotificationCalls(vscode.window.showWarningMessage)).toEqual([[
                expect.stringMatching(/^\d+ records were inserted into qa \(qa@example\.com\.qa\) from Account-thru-OtherChildObject__c and \d+ failed\. Nothing was rolled back\. The first file that failed is collectionsApi-Contact\.json; its Validation Rules in the Troubleshooting tab may fix it\.$/),
                RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL,
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
                RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL
            ]]);
            expect(postedNamed('datasetAdded').at(-1)).not.toHaveProperty('insertResult');
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            // THE BUTTON IS WHAT OPENS THE FILE; THE PANEL HAS NO WAY TO
            clickButton.answer?.(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);
            await flushNotificationClick();
            expect(openFileSpy).toHaveBeenCalledWith(insertResultsFilePath());

            openFileSpy.mockClear();
            await receivedMessageHandler({ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY });
            expect(openFileSpy).not.toHaveBeenCalled();

            // A REVEALED PANEL ASKS AGAIN, AND ITS READINESS CARRIES NO INSERT RESULT
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            expect(postedNamed('dataOrgReadiness').at(-1)).not.toHaveProperty('insertResults');

        });

        it('opens nothing from View errors once the results file is gone, and says so', async () => {

            const connection = buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Contact' && record.attributes.referenceId.startsWith('Contact_Reference_2__') });
            useConnection(connection);
            const clickButton = holdResultNotifications();
            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();
            fs.rmSync(fakeDataSetsFolderPath(), { recursive: true, force: true });

            clickButton.answer?.(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);
            await flushNotificationClick();

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith('The insert results file no longer exists in this workspace.');

        });

        it('opens the first generated file that failed from View failed file (#375)', async () => {

            useConnection(buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Contact' && record.attributes.referenceId.startsWith('Contact_Reference_2__') }));
            const clickButton = holdResultNotifications();
            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();

            clickButton.answer?.(RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL);
            await flushNotificationClick();

            expect(openFileSpy).toHaveBeenCalledTimes(1);
            expect(openFileSpy.mock.calls[0][0]).toMatch(/collectionsApi-Contact\.json$/);
            expect(openFileSpy.mock.calls[0][0].startsWith(path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0]))).toBe(true);

        });

        it('opens the card on its Troubleshooting tab IN PLACE from Open Troubleshooting, on the sub-tab the error points at, keeping the org selection (#375)', async () => {

            useConnection(buildFakeConnection({ rejectRecord: (objectApiName, record) => objectApiName === 'Contact' && record.attributes.referenceId.startsWith('Contact_Reference_2__') }));
            const clickButton = holdResultNotifications();

            await openSelectedCockpit(FAKER_JS_RUN);
            await insertAccountTree();
            const selectionBefore = panelState().dataOrgSelection;
            const recipeDataPostsBefore = postedNamed('recipeData').length;
            executeCommand.mockClear();

            clickButton.answer?.(RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL);
            await flushNotificationClick();

            expect(postedNamed('focusTree')).toEqual([{
                command: 'focusTree',
                focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'validationRules' },
                renderSequence: lastRenderSequence()
            }]);
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore);
            expect(panelState().dataOrgSelection).toBe(selectionBefore);
            expect(executeCommand).not.toHaveBeenCalledWith(RECIPE_COCKPIT_OPEN_COMMAND, expect.anything());

        });

        it('focuses a HIDDEN cockpit through the model\'s replay, since its reveal reloads the document (#378 review)', async () => {

            await openSelectedCockpit(FAKER_JS_RUN);
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            cockpitPanel.visible = false;
            postedPanelMessages.length = 0;
            const focusTree = { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'fields' };

            await RecipeCockpitService.openTroubleshootingAfterInsert(temporaryWorkspaceRoot, { runFolderName: FAKER_JS_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'fields' });

            expect(cockpitPanel.reveal).toHaveBeenCalled();
            expect(postedNamed('focusTree')).toEqual([]);
            expect(executeCommand).not.toHaveBeenCalledWith(RECIPE_COCKPIT_OPEN_COMMAND, expect.anything());

            // THE RELOADED DOCUMENT SAYS "ready", AND THE REPLAYED MODEL CARRIES THE FOCUS UNTIL IT IS DRAWN
            await receivedMessageHandler({ command: 'ready' });
            expect(postedNamed('recipeData').at(-1).focusTree).toEqual(focusTree);
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            expect(panelState().openFocusTree).toBeUndefined();

        });

        it('reopens the cockpit on the inserted run when the open cockpit shows another run (#375)', async () => {

            await openSelectedCockpit(SNOWFAKERY_RUN);
            postedPanelMessages.length = 0;
            executeCommand.mockClear();
            const focusRequest = { runFolderName: FAKER_JS_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'todos' as const };

            await RecipeCockpitService.openTroubleshootingAfterInsert(temporaryWorkspaceRoot, focusRequest);

            expect(postedNamed('focusTree')).toEqual([]);
            expect(executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_OPEN_COMMAND, { focusTroubleshooting: true, ...focusRequest });

        });

        it('reopens the cockpit through its command on the inserted run when the panel was closed, and warns instead when the run is gone (#375)', async () => {

            const focusRequest = { runFolderName: FAKER_JS_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'permissions' as const };
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;

            await RecipeCockpitService.openTroubleshootingAfterInsert(temporaryWorkspaceRoot, focusRequest);
            expect(executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_OPEN_COMMAND, { focusTroubleshooting: true, ...focusRequest });

            executeCommand.mockClear();
            fs.rmSync(path.join(generatedRecipesFolderPath(), FAKER_JS_RUN), { recursive: true, force: true });
            await RecipeCockpitService.openTroubleshootingAfterInsert(temporaryWorkspaceRoot, focusRequest);

            expect(executeCommand).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(`The run ${FAKER_JS_RUN} or its tree ${ACCOUNT_TREE_KEY} no longer exists, so the Troubleshooting tab was not opened.`);

        });

        it('opens a closed cockpit on the named run, focused on the tree\'s Troubleshooting sub-tab once it is drawn (#375)', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(temporaryWorkspaceRoot, undefined, { runFolderName: SNOWFAKERY_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'fields' });
            await receivedMessageHandler({ command: 'ready' });

            const replayedModel = postedNamed('recipeData').at(-1);
            expect(replayedModel.recipe.selectedRunFolderName).toBe(SNOWFAKERY_RUN);
            expect(replayedModel.focusTree).toEqual({ treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'fields' });

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

            expect(showWarningMessageSpy).toHaveBeenCalledWith('Account-thru-OtherChildObject__c was not generated, so nothing was inserted into qa (qa@example.com.qa).');
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
            expect(runOptions).toEqual({ confirmationToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
            // SPENT BY THE RUN: THE SAME TOKEN CANNOT SKIP THE MODAL A SECOND TIME
            expect(ExtensionCommandService.readRunFakerOptions(runOptions)).toEqual({});
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
            expect(showWarningMessageSpy.mock.calls[0][0]).toStartWith('Nothing was generated or inserted for Account-thru-OtherChildObject__c: The filtered copy did not read back');
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        describe('a sandbox that lacks some of the recipe\'s fields, or will not let them be set (#264)', () => {

            // THE ORG HAS NO Score__c AND WILL NOT LET Name BE SET, SO IT REJECTS EVERY RECORD CARRYING EITHER, AS A REAL ORG WOULD
            const buildLackingConnection = () => buildFakeConnection({
                missingFieldsByObject: { OtherChildObject__c: ['Score__c'] },
                notCreateableFieldsByObject: { Account: ['Name'] },
                rejectRecord: (objectApiName, record) => objectApiName === 'OtherChildObject__c' && 'Score__c' in record
            });

            it('offers the insert, with no sentence naming a missing or unsettable field anywhere', async () => {

                useConnection(buildLackingConnection());
                await openSelectedCockpit(FAKER_JS_RUN);

                const readinessMessage = postedNamed('dataOrgReadiness').at(-1);
                const treeTargets = readinessMessage.createTargets.filter((readiness: any) => readiness.treeKey === ACCOUNT_TREE_KEY);
                expect(treeTargets.map((readiness: any) => readiness.objectApiName).sort()).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
                treeTargets.forEach((readiness: any) => {
                    expect(readiness.disabledReason).toBe('');
                    expect(readiness).not.toHaveProperty('missingFieldApiNames');
                    expect(readiness).not.toHaveProperty('notCreateableFieldApiNames');
                    expect(readiness).not.toHaveProperty('isMetadataDeployable');
                });
                const postedText = JSON.stringify(postedPanelMessages);
                expect(postedText).not.toMatch(/missing \d+ recipe fields?/);
                expect(postedText).not.toContain('will not let you set');
                expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState())?.kind).toBe('insertTree');

            });

            it('inserts, and reports each record the org rejected through the insert\'s warning and its View errors', async () => {

                const connection = buildLackingConnection();
                useConnection(connection);
                const clickButton = holdResultNotifications();
                await openSelectedCockpit(FAKER_JS_RUN);

                await insertAccountTree();

                expect(( vscode.window.showWarningMessage as jest.Mock ).mock.calls.filter(notificationCall => notificationCall[1]?.inPanel)).toHaveLength(1);
                expect(runFakerCalls()).toHaveLength(1);
                expect(connection.deleteCalls).toEqual([]);
                expect(insertedOf(connection, 'Account')).toHaveLength(2);
                expect(insertedOf(connection, 'Contact').length).toBeGreaterThan(0);
                expect(insertedOf(connection, 'OtherChildObject__c')).toEqual([]);
                const rejectedCount = connection.insertCalls.filter(insertCall => insertCall.objectApiName === 'OtherChildObject__c')
                    .reduce((count, insertCall) => count + insertCall.records.length, 0);
                expect(rejectedCount).toBeGreaterThan(0);
                expect(resultNotificationCalls(vscode.window.showWarningMessage)).toEqual([[
                    `${connection.insertedRecordsById.size} records were inserted into qa (qa@example.com.qa) from Account-thru-OtherChildObject__c and ${rejectedCount} failed. Nothing was rolled back. The first file that failed is collectionsApi-OtherChildObject__c.json; its Validation Rules in the Troubleshooting tab may fix it.`,
                    RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL,
                    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
                    RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL
                ]]);

                const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
                clickButton.answer?.(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);
                await flushNotificationClick();
                const resultsFilePath = insertResultsFilePath();
                expect(openFileSpy).toHaveBeenCalledWith(resultsFilePath);
                expect(fs.readFileSync(resultsFilePath, 'utf8')).toContain('FIELD_CUSTOM_VALIDATION_EXCEPTION');

            });

            it('rolls back every record it saved when all-or-none is chosen, leaving nothing behind', async () => {

                allOrNoneSpy.mockResolvedValue(true);
                const connection = buildLackingConnection();
                useConnection(connection);
                await openSelectedCockpit(FAKER_JS_RUN);

                await insertAccountTree();

                const savedRecordIds = [...connection.insertedRecordsById.keys()];
                expect(savedRecordIds.length).toBeGreaterThan(0);
                expect(connection.deleteCalls.flat().sort()).toEqual(savedRecordIds.sort());
                // ONE RED NOTIFICATION, THE CARD'S, AND NO "Failed to process" FROM THE SHARED INSERT BESIDE IT (#310)
                expect(resultNotificationCalls(vscode.window.showErrorMessage)).toEqual([[
                    expect.stringMatching(/^The insert of Account-thru-OtherChildObject__c into qa \(qa@example\.com\.qa\) stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen\. \d+ records? failed\. The first file that failed is collectionsApi-OtherChildObject__c\.json; its Validation Rules in the Troubleshooting tab may fix it\.$/),
                    RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL,
                    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
                    RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL
                ]]);
                expect(( vscode.window.showErrorMessage as jest.Mock ).mock.calls.filter(notificationCall => String(notificationCall[0]).startsWith('Failed to process'))).toEqual([]);
                expect(resultNotificationCalls(vscode.window.showWarningMessage)).toEqual([]);

            });

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

        it('ignores an org selection, a listing or a generate of the same tree posted while the insert runs: the host holds the org it confirmed (#259 review)', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            const confirmedSelection = panelState().dataOrgSelection;
            const listSpy = SalesforceOrgService.listDataOrgDetails as jest.Mock;
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                const listCallCount = listSpy.mock.calls.length;
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
                await receivedMessageHandler({ command: 'refreshDataOrgs' });
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });
                await receivedMessageHandler({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY });
                expect(panelState().dataOrgSelection).toBe(confirmedSelection);
                expect(listSpy.mock.calls.length).toBe(listCallCount);
                return RECIPE_COCKPIT_INSERT_CONFIRM_LABEL;
            });
            await insertAccountTree();

            expect(runFakerCalls()).toHaveLength(1);
            expect(insertedOf(connection, 'Contact')).toHaveLength(6);

        });

        it('refuses if the selection changed while the dialog was open', async () => {

            const connection = buildFakeConnection();
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                // A RELOAD OF THE RUN OR A NEW SELECTION REPLACES THE OBJECT THE INSERT CONFIRMED
                panelState().dataOrgSelection = { ...( panelState().dataOrgSelection as any ) };
                return RECIPE_COCKPIT_INSERT_CONFIRM_LABEL;
            });
            await insertAccountTree();

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The org selection changed after qa (qa@example.com.qa) was confirmed'));
            expect(runFakerCalls()).toEqual([]);
            expect(connection.insertCalls).toEqual([]);

        });

        it('sends no COUNT and no data SELECT from choosing an org through an insert, except the Ids of a required parent outside the tree', async () => {

            const connection = buildFakeConnection({ withOutsideParent: true });
            useConnection(connection);

            await openSelectedCockpit(FAKER_JS_RUN);
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


        describe('updating only what the insert changed (#226)', () => {

            const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
            const insertedDatasetFolderName = `dataset-fakerjs-${TIMESTAMP}`;
            const openMessage = { command: 'openDataset', datasetFolderName: insertedDatasetFolderName };
            const insertMessage = { command: 'insertDataset', datasetFolderName: insertedDatasetFolderName };

            it('keeps the org selection, so nothing is listed, selected or checked again', async () => {

                useConnection(buildFakeConnection());

                await openSelectedCockpit(FAKER_JS_RUN);
                const selectionBefore = panelState().dataOrgSelection;
                const [listsBefore, readinessBefore] = [postedNamed('dataOrgList').length, postedNamed('dataOrgReadiness').length];

                await insertAccountTree();

                expect(panelState().dataOrgSelection).toBe(selectionBefore);
                expect(postedNamed('dataOrgList')).toHaveLength(listsBefore);
                expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessBefore);
                expect(postedNamed('datasetAdded')).toHaveLength(1);

            });

            it('offers Open and Insert… on the new data set only once the panel says it drew it', async () => {

                useConnection(buildFakeConnection());

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();
                const { renderSequence, updateSequence } = postedNamed('datasetAdded')[0];

                expect(RecipeCockpitService.routePanelMessage(openMessage, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage(insertMessage, panelState())).toBeUndefined();

                // AN ACK OF ANOTHER POST, OF ANOTHER MODEL, OR NOT A NUMBER, PROMOTES NOTHING
                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence, updateSequence: updateSequence + 1 }, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence: renderSequence - 1, updateSequence }, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence, updateSequence: String(updateSequence) }, panelState())).toBeUndefined();

                await receivedMessageHandler({ command: 'partialRendered', renderSequence, updateSequence });

                const datasetFolderPath = path.join(fakeDataSetsFolderPath(), insertedDatasetFolderName);
                expect(RecipeCockpitService.routePanelMessage(openMessage, panelState())).toEqual({ kind: 'openDataset', datasetFolderName: insertedDatasetFolderName, datasetFolderPath: datasetFolderPath });
                expect(RecipeCockpitService.routePanelMessage(insertMessage, panelState())).toEqual({ kind: 'insertDataset', datasetFolderName: insertedDatasetFolderName, datasetFolderPath: datasetFolderPath });

            });

            /*
                The real panel cannot send these -- it acks only a datasetAdded it drew over the model it
                drew -- so each is a forged or late message, and none may activate the model's actions.
            */
            it.each([
                ['a reload of the document', async () => { await receivedMessageHandler({ command: 'ready' }); }],
                ['a draw that failed', async () => {
                    // A FAILURE TO DRAW IS REPORTED, AS IT ALWAYS IS
                    expectsCapturedError = true;
                    await receivedMessageHandler({ command: 'renderFailed', message: 'boom', phase: 'render' });
                }]
            ])('refuses a partialRendered after %s, until that model is "rendered" again', async (_description, interrupt) => {

                useConnection(buildFakeConnection());

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();
                const { renderSequence, updateSequence } = postedNamed('datasetAdded')[0];

                await interrupt();
                await receivedMessageHandler({ command: 'partialRendered', renderSequence, updateSequence });

                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence, updateSequence }, panelState())).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage(openMessage, panelState())).toBeUndefined();

            });

            it('refuses a partialRendered naming a newer model that has not been "rendered" yet', async () => {

                useConnection(buildFakeConnection());

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();
                const { updateSequence } = postedNamed('datasetAdded')[0];

                await receivedMessageHandler({ command: 'selectRun', runFolderName: SNOWFAKERY_RUN });

                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence: lastRenderSequence(), updateSequence }, panelState())).toBeUndefined();

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

                expect(RecipeCockpitService.routePanelMessage({ command: 'partialRendered', renderSequence: lastRenderSequence(), updateSequence }, panelState())).toEqual({ kind: 'activateDatasetActions' });

            });

            it('adds the data set to the stored model, so a revealed panel draws it and its "rendered" offers it', async () => {

                useConnection(buildFakeConnection());

                await openSelectedCockpit(FAKER_JS_RUN);
                await insertAccountTree();
                await receivedMessageHandler({ command: 'ready' });

                const replayedRecipeData = postedNamed('recipeData').at(-1);
                const replayedTree = replayedRecipeData.recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY);
                expect(replayedTree.history.datasets[0].datasetFolderName).toBe(insertedDatasetFolderName);
                expect(RecipeCockpitService.routePanelMessage(openMessage, panelState())).toBeUndefined();

                await receivedMessageHandler({ command: 'rendered', renderSequence: replayedRecipeData.renderSequence });

                expect(RecipeCockpitService.routePanelMessage(openMessage, panelState())).toMatchObject({ kind: 'openDataset' });

            });

            it('reloads onto the Treecipe tab as before when the data set cannot be placed on a card', async () => {

                useConnection(buildFakeConnection());
                jest.spyOn(RecipeCockpitTreeHistory, 'buildAddedDataset').mockReturnValue(undefined);

                await openSelectedCockpit(FAKER_JS_RUN);
                const recipeDataPostsBefore = postedNamed('recipeData').length;
                await insertAccountTree();

                expect(postedNamed('datasetAdded')).toEqual([]);
                expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore + 1);
                expect(postedNamed('recipeData').at(-1).focusTree).toEqual({ treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' });

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

            // #375: NO ORG CHOSEN ASKS FOR ONE, BUT ONLY OVER A CONFIRMED-DRAWN MODEL'S OBJECTS
            const unselected = buildPanelState();
            unselected.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage(insertTree, unselected)).toEqual(refusal());
            unselected.dataOrgObjectApiNames = new Set(['Account']);
            expect(RecipeCockpitService.routePanelMessage(insertTree, unselected)).toEqual({ kind: 'promptInsertOrg', treeKey: ACCOUNT_TREE_KEY, recipeFilePath: RECIPE_FILE_PATH });
            expect(RecipeCockpitService.routePanelMessage({ ...insertTree, orgIndex: 0 } as any, unselected)).toEqual({ kind: 'promptInsertOrg', treeKey: ACCOUNT_TREE_KEY, recipeFilePath: RECIPE_FILE_PATH });

            const unselectedUndrawn = buildPanelState();
            unselectedUndrawn.dataOrgSelection = undefined;
            unselectedUndrawn.dataOrgObjectApiNames = new Set(['Account']);
            unselectedUndrawn.insertableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage(insertTree, unselectedUndrawn)).toEqual(refusal());

            const unselectedBusy = buildPanelState();
            unselectedBusy.dataOrgSelection = undefined;
            unselectedBusy.dataOrgObjectApiNames = new Set(['Account']);
            unselectedBusy.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: LEAD_TREE_KEY, deployKind: 'fields' } as any;
            expect(RecipeCockpitService.routePanelMessage(insertTree, unselectedBusy)).toEqual(refusal());

            const noModel = buildPanelState();
            noModel.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(insertTree, noModel)).toEqual(refusal());

        });

        it('refuses while a scratch org run is in flight, and answers another tree\'s running insert', () => {

            const scratchOrgRunning = buildPanelState();
            scratchOrgRunning.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(insertTree, scratchOrgRunning)).toEqual(refusal());

            // ANOTHER TREE'S INSERT IS ANSWERED WITH ITS OWN STATE, SO THE CLICKED CARD GIVES ITS BUTTON BACK
            const insertRunning = buildPanelState();
            insertRunning.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: LEAD_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(insertTree, insertRunning)).toEqual({ kind: 'postInsertState', hostMessage: insertRunning.insertStateMessage });

            const sameTreeInserting = buildPanelState();
            sameTreeInserting.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(insertTree, sameTreeInserting)).toBeUndefined();

        });

        // #301: THE RESULTS FILE IS OPENED FROM THE INSERT'S NOTIFICATION, SO THE PANEL HAS NO MESSAGE THAT OPENS IT
        it('routes nothing for a posted viewInsertErrors', () => {

            const routedPanelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY }, routedPanelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'viewInsertErrors', treeKey: ACCOUNT_TREE_KEY, resultsFilePath: '/etc/passwd' } as any, routedPanelState)).toBeUndefined();

        });

    });

    // #301: HOW AN INSERT ENDED IS ONE NOTIFICATION, AND THE RESULTS FILE IS ITS BUTTON
    describe('showTreeInsertNotification', () => {

        // AN EXISTING FILE INSIDE THE WORKSPACE STANDS IN FOR THE INSERT'S RESULTS FILE
        const RESULTS_FILE_PATH = path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'treecipeObjectsWrapper-2026-09-20T10-00-00.json');
        const showInsertNotification = (insertResult: Record<string, unknown>) => ( RecipeCockpitService as any ).showTreeInsertNotification(
            { resultsFilePath: RESULTS_FILE_PATH, isRolledBack: false, savedRecordCount: 0, failedRecordCount: 0, ...insertResult },
            'Account-thru-OtherChildObject__c',
            'qa',
            TREE_WORKSPACE_ROOT
        );

        beforeEach(() => {
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
        });

        it.each([
            ['a full success', { outcome: 'completed', savedRecordCount: 1 }, 'showInformationMessage', '1 record was inserted into qa from Account-thru-OtherChildObject__c.', RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL],
            ['records that failed', { outcome: 'completed', savedRecordCount: 3, failedRecordCount: 1 }, 'showWarningMessage', '3 records were inserted into qa from Account-thru-OtherChildObject__c and 1 failed. Nothing was rolled back.', RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL],
            ['a stop that kept what it saved', { outcome: 'stopped', savedRecordCount: 1, failedRecordCount: 2 }, 'showErrorMessage', 'The insert of Account-thru-OtherChildObject__c into qa stopped at a file that could not be inserted. 1 record was kept, because all-or-none was not chosen, and 2 failed.', RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL],
            ['a stop that rolled back', { outcome: 'stopped', isRolledBack: true, failedRecordCount: 1 }, 'showErrorMessage', 'The insert of Account-thru-OtherChildObject__c into qa stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen. 1 record failed.', RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL],
            ['a cancel', { outcome: 'cancelled', isRolledBack: true }, 'showWarningMessage', 'The insert of Account-thru-OtherChildObject__c into qa was cancelled and every record it had inserted was deleted.', RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL]
        ])('reports %s in one notification with the button that opens the results file', (_label, insertResult, notifyName, expectedText, expectedButton) => {

            showInsertNotification(insertResult);

            expect((vscode.window as any)[notifyName].mock.calls).toEqual([[expectedText, expectedButton]]);

        });

        it('names a request that threw, with its error escaped, since the shared insert shows nothing of its own (#312 review)', () => {

            showInsertNotification({ outcome: 'stopped', requestFailureDetail: 'collectionsApi-Contact.json failed: Error importing records: [x](command:y)' });

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls).toEqual([[
                `The insert of Account-thru-OtherChildObject__c into qa stopped at a file that could not be inserted. 0 records were kept, because all-or-none was not chosen, and 0 failed. The request for ${RecipeYamlScalar.escapeForNotification('collectionsApi-Contact.json failed: Error importing records: [x](command:y)')}`,
                RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL
            ]]);

        });

        it('opens the results file from a stopped insert\'s red notification (#310)', async () => {

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);

            showInsertNotification({ outcome: 'stopped', failedRecordCount: 1 });
            await new Promise(resolve => setImmediate(resolve));

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(openFileSpy).toHaveBeenCalledWith(RESULTS_FILE_PATH);

        });

        it('changes nothing, and throws nothing, when the notification itself fails to show', async () => {

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockRejectedValue(new Error('no window'));

            expect(() => showInsertNotification({ outcome: 'completed', savedRecordCount: 1 })).not.toThrow();
            await new Promise(resolve => setImmediate(resolve));

            expect(openFileSpy).not.toHaveBeenCalled();

        });

        it('offers no button when the insert wrote no results file -- a cancel or a failure before the first file is sent', () => {

            showInsertNotification({ outcome: 'completed', savedRecordCount: 2, resultsFilePath: '' });
            showInsertNotification({ outcome: 'cancelled', resultsFilePath: path.join(TREE_WORKSPACE_ROOT, 'InsertAttempts', 'never-written.json') });

            expect((vscode.window.showInformationMessage as jest.Mock).mock.calls).toEqual([['2 records were inserted into qa from Account-thru-OtherChildObject__c.']]);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls).toEqual([['The insert of Account-thru-OtherChildObject__c into qa was cancelled.']]);

        });

        // #375: A FAILED INSERT NAMES ITS FIRST FAILED FILE, OPENS IT, AND OFFERS THE TROUBLESHOOTING SUB-TAB ITS ERROR POINTS AT
        describe('a failure that names its first failed file (#375)', () => {

            const FAILED_FILE_PATH = path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', ACCOUNT_TREE_KEY, 'recipe--Account-thru-OtherChildObject__c-2026-09-20T10-00-00.yml');
            const INSERTED_TREE = { runFolderName: SNOWFAKERY_RUN, treeFolderName: ACCOUNT_TREE_KEY };
            const showFailure = (insertResult: Record<string, unknown>, insertedTree: unknown = INSERTED_TREE) => ( RecipeCockpitService as any ).showTreeInsertNotification(
                { resultsFilePath: RESULTS_FILE_PATH, isRolledBack: false, savedRecordCount: 1, failedRecordCount: 1, outcome: 'completed', failedFilePath: FAILED_FILE_PATH, ...insertResult },
                'Account-thru-OtherChildObject__c',
                'qa',
                TREE_WORKSPACE_ROOT,
                insertedTree
            );

            it.each([
                [{ statusCode: 'INVALID_FIELD', fields: [] }, 'Fields', 'fields'],
                [{ statusCode: 'INVALID_FIELD_FOR_INSERT_UPDATE', fields: ['Secret__c'] }, 'Permissions', 'permissions'],
                [{ statusCode: 'INVALID_CROSS_REFERENCE_KEY', fields: ['RecordTypeId'] }, 'Record Types', 'recordTypes'],
                [undefined, 'TODO\'s', 'todos']
            ])('names the file and the sub-tab for %o, and opens that sub-tab from Open Troubleshooting', async (firstFailure, subTabLabel, subTab) => {

                const openTroubleshootingSpy = jest.spyOn(RecipeCockpitService, 'openTroubleshootingAfterInsert').mockResolvedValue(undefined);
                (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL);

                showFailure({ firstFailure });
                await new Promise(resolve => setImmediate(resolve));

                expect((vscode.window.showWarningMessage as jest.Mock).mock.calls).toEqual([[
                    `1 record was inserted into qa from Account-thru-OtherChildObject__c and 1 failed. Nothing was rolled back. The first file that failed is ${path.basename(FAILED_FILE_PATH)}; its ${subTabLabel} in the Troubleshooting tab may fix it.`,
                    RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL,
                    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
                    RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL
                ]]);
                expect(openTroubleshootingSpy).toHaveBeenCalledWith(TREE_WORKSPACE_ROOT, { ...INSERTED_TREE, troubleshootingSubTab: subTab });

            });

            it('escapes a failed file name a notification would draw as a link', () => {

                showFailure({ failedFilePath: path.join(TREE_WORKSPACE_ROOT, 'collectionsApi-[x](command:y).json') });

                expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain(`The first file that failed is ${RecipeYamlScalar.escapeForNotification('collectionsApi-[x](command:y).json')};`);

            });

            it('offers no View failed file once that file is gone, and still offers the rest', () => {

                showFailure({ failedFilePath: path.join(TREE_WORKSPACE_ROOT, 'never-written.json') });

                expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0].slice(1)).toEqual([RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL, RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL]);

            });

            it('offers no Open Troubleshooting for a tree with no folder, and none of the failure buttons for a cancel', () => {

                showFailure({}, { runFolderName: SNOWFAKERY_RUN, treeFolderName: '' });
                showFailure({ outcome: 'cancelled', isRolledBack: true, failedRecordCount: 0 });

                expect((vscode.window.showWarningMessage as jest.Mock).mock.calls.map(call => call.slice(1))).toEqual([
                    [RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL, RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL],
                    [RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL]
                ]);

            });

        });

        describe('the Open Troubleshooting request (#375)', () => {

            it('keeps only plain folder names and a sub-tab the tab draws, from a caller of the command id', () => {

                const request = { focusTroubleshooting: true, runFolderName: SNOWFAKERY_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'fields' };

                expect(RecipeCockpitService.readTroubleshootingFocusRequest(request)).toEqual({ runFolderName: SNOWFAKERY_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'fields' });
                expect(RecipeCockpitService.readTroubleshootingFocusRequest({ ...request, extra: '/etc/passwd' })).toEqual({ runFolderName: SNOWFAKERY_RUN, treeFolderName: ACCOUNT_TREE_KEY, troubleshootingSubTab: 'fields' });
                [
                    undefined,
                    { ...request, focusTroubleshooting: 'true' },
                    { ...request, runFolderName: '../outside' },
                    { ...request, treeFolderName: 'a/b' },
                    { ...request, treeFolderName: '..' },
                    { ...request, runFolderName: '' },
                    { ...request, runFolderName: 7 },
                    { ...request, troubleshootingSubTab: 'compare' },
                    { ...request, troubleshootingSubTab: '__proto__' },
                    { focusRecordTypes: true }
                ].forEach(openOptions => expect(RecipeCockpitService.readTroubleshootingFocusRequest(openOptions)).toBeUndefined());

            });

            it('finds the card by its folder, and no card for a folder no card has', () => {

                const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
                const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;

                expect(RecipeCockpitService.resolveTroubleshootingFocus(recipe, { runFolderName: SNOWFAKERY_RUN, treeFolderName: LEAD_TREE_KEY, troubleshootingSubTab: 'globalValueSets' }))
                    .toEqual({ treeKey: LEAD_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'globalValueSets' });
                expect(RecipeCockpitService.resolveTroubleshootingFocus(recipe, { runFolderName: SNOWFAKERY_RUN, treeFolderName: 'Opportunity-ONLY', troubleshootingSubTab: 'fields' })).toBeUndefined();

            });

        });

        it('opens nothing, and says so, when the results file is outside the workspace by the time the button is clicked', async () => {

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL);

            showInsertNotification({ outcome: 'completed', savedRecordCount: 1, failedRecordCount: 1, resultsFilePath: __filename });
            await new Promise(resolve => setImmediate(resolve));

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(warningSpy).toHaveBeenCalledWith('The insert results file no longer exists in this workspace.');

        });

    });

    describe('the model\'s insertable trees and objects', () => {

        const loadSnowfakeryModel = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;
        };

        it('offers the insert on every card that can generate', () => {

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
                'Recipe tree: Account-thru-OtherChildObject__c (recipe.yml)',
                'Backend: snowfakery',
                'Records, inserted parents first:',
                '  Account: 1',
                '  Contact: 1'
            ]);
            expect(detailLines.at(-1)).toContain('you choose all-or-none next');
            expect(detailLines.join('\n')).not.toContain('Generate only');

        });

        it('warns past 2,000 records with the total and the requests, and not at 2,000', () => {

            expect(detailOf([['Account', 1000], ['Contact', 1000]])).not.toContain('This run will take time');
            expect(detailOf([['Account', 1000], ['Contact', 1001]])).toContain('This run will take time: 2001 records in at least 11 Collections API requests.');

        });

        // THE IN-PANEL DIALOG WRITES IT WITH textContent (#349), SO A NAME IS SHOWN AS WRITTEN
        it('names a required parent outside the tree, as written', () => {

            expect(detailOf([['Contact', 1]], ['Region__c'])).toContain('Required lookups to objects this tree does not insert get a random existing record of: Region__c (none means nothing is inserted).');
            expect(detailOf([['Contact', 1]], ['[x](command:evil)'])).toContain('a random existing record of: [x](command:evil) (none');

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

        // A FAILED RECORD'S referenceId USED TO MAP TO undefined, AND THE PREPARER OFFERED IT AS A RUN PARENT
        it('counts each created Id once as the insert moves from file to file, and reads an Id with no nickname suffix (#259 review)', () => {

            const choiceCounts: number[] = [];
            const prepare = RecipeCockpitService.buildTreeInsertRecordPreparer(SANDBOX_ORG.username, new Set(['Account', 'Contact']), new Map(),
                choiceCount => { choiceCounts.push(choiceCount); return choiceCount - 1; });
            const growingIds: Record<string, string> = { 'Account_Reference_1__Account_NickName': '001000000000001AAA' };

            prepare('Contact', [{ LastName: 'A' }], growingIds);
            growingIds['Account_Reference_2'] = '001000000000002AAA';
            const [prepared] = prepare('Contact', [{ LastName: 'B' }], growingIds) as any[];

            // THE SECOND FILE SEES BOTH ACCOUNTS ONCE EACH -- NOT THE FIRST ONE TWICE
            expect(choiceCounts).toEqual([1, 2]);
            expect(prepared.AccountId).toBe('001000000000002AAA');

        });

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

        const postReadiness = (panel: any, otherChildReason = '') => panel.postToPanel({
            command: 'dataOrgReadiness',
            objects: [
                { objectApiName: 'Account', disabledReason: '', requiredLookups: [] },
                { objectApiName: 'Contact', disabledReason: '', requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] },
                { objectApiName: 'OtherChildObject__c', disabledReason: otherChildReason, requiredLookups: [] },
                { objectApiName: 'Lead', disabledReason: '', requiredLookups: [] }
            ],
            createTargets: [],
            requestSequence: 3,
            renderSequence: 1
        });

        const accountCard = (panel: any) => panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeInsertControls').length > 0
            && panel.findAll(treeCard, 'treeTitle').concat(panel.findAll(treeCard, 'treeName')).some((titleElement: any) => /Account-thru-OtherChildObject__c/.test(titleElement.textContent)))
            ?? panel.treeCards()[0];
        const partOf = (panel: any, rootElement: any, className: string) => panel.findAll(rootElement, className)[0];
        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        // #375: THE BUTTON ALWAYS GENERATES AND INSERTS, AND IS DISABLED WITH ITS REASON UNTIL THE TREE CAN BE INSERTED
        it('draws the button at the top of the Treecipe tab, disabled as Generate fake data and insert with its reason while the org check runs (#305)', () => {

            const panel = renderPanel();
            const card = accountCard(panel);

            const header = partOf(panel, card, 'treecipeHeader');
            expect(header).toBeDefined();
            expect(partOf(panel, header, 'treeInsertControls')).toBeDefined();
            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsert').textContent).toBe(RECIPE_COCKPIT_INSERT_ACTION_LABEL);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}${RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON}`);

        });

        it('is disabled, with the selection\'s failure as its reason, when the org could not be used, and a click posts nothing', () => {

            const panel = renderPanel();
            selectOrg(panel, 'qa could not be reached: INVALID_SESSION_ID');
            const card = accountCard(panel);
            const button = partOf(panel, card, 'treeInsert');

            expect([button.disabled, button.textContent]).toEqual([true, RECIPE_COCKPIT_INSERT_ACTION_LABEL]);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}qa could not be reached: INVALID_SESSION_ID`);

            button.dispatch('click');
            expect(postedNamed(panel, 'generateTree')).toEqual([]);
            expect(postedNamed(panel, 'insertTree')).toEqual([]);

        });

        it('is disabled while the host checks the org, then names the first object that cannot be inserted', () => {

            const panel = renderPanel();
            selectOrg(panel);
            const card = accountCard(panel);

            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}checking whether this tree can be inserted…`);

            postReadiness(panel, 'OtherChildObject__c is not createable in this org.');
            expect(partOf(panel, card, 'treeInsert').disabled).toBe(true);
            expect(partOf(panel, card, 'treeInsert').textContent).toBe(RECIPE_COCKPIT_INSERT_ACTION_LABEL);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe(`${RECIPE_COCKPIT_CANNOT_INSERT_PREFIX}OtherChildObject__c is not createable in this org.`);

        });

        it('with no org chosen, stays enabled, says the org will be asked for, and posts the tree key alone', () => {

            const panel = renderPanel();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
            const card = accountCard(panel);
            const button = partOf(panel, card, 'treeInsert');

            expect([button.disabled, button.textContent]).toEqual([false, RECIPE_COCKPIT_INSERT_ACTION_LABEL]);
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe(RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE);

            button.dispatch('click');
            expect(postedNamed(panel, 'insertTree')).toEqual([{ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }]);
            expect(button.disabled).toBe(true);

        });

        it('posts the tree key alone, holds that card until the host says it ended, and disables every other card meanwhile', () => {

            const panel = renderPanel();
            selectOrg(panel);
            postReadiness(panel);
            const card = accountCard(panel);
            const insertButton = partOf(panel, card, 'treeInsert');
            const otherButton = panel.findAll(panel.cockpitBodyElement, 'treeInsert').find((buttonElement: any) => buttonElement !== insertButton);

            expect(insertButton.disabled).toBe(false);
            expect(insertButton.textContent).toBe('Generate fake data and insert into qa');
            expect(partOf(panel, card, 'treeInsertReason').textContent).toBe('');

            insertButton.dispatch('click');
            insertButton.dispatch('click');

            expect(postedNamed(panel, 'insertTree')).toEqual([{ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }]);
            expect(insertButton.textContent).toBe('Inserting…');
            expect(insertButton.disabled).toBe(true);
            expect([otherButton.disabled, otherButton.textContent]).toEqual([true, RECIPE_COCKPIT_INSERT_ACTION_LABEL]);

            otherButton.dispatch('click');
            expect(postedNamed(panel, 'generateTree')).toHaveLength(0);
            expect(postedNamed(panel, 'insertTree')).toHaveLength(1);

            panel.postToPanel({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(insertButton.disabled).toBe(false);
            expect(insertButton.textContent).toBe('Generate fake data and insert into qa');

        });

        // #375: "Open Troubleshooting" ON THE MODEL ON SCREEN FOCUSES THE CARD IN PLACE
        it('opens the card on the Troubleshooting tab and the sub-tab a posted focusTree names, and ignores one for another model', () => {

            const panel = renderPanel();
            const card = accountCard(panel);
            const selectedTabOf = () => panel.findAll(card, 'treeTab').find((tabElement: any) => tabElement.attributes['aria-selected'] === 'true')?.textContent;

            panel.postToPanel({ command: 'focusTree', focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'validationRules' }, renderSequence: 2 });
            expect(selectedTabOf()).toBe('Treecipe');

            panel.postToPanel({ command: 'focusTree', focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'validationRules' }, renderSequence: 1 });
            expect(selectedTabOf()).toBe('Troubleshooting');
            const selectedSubTab = panel.findAll(card, 'troubleshootingSubTab').find((tabElement: any) => tabElement.attributes['aria-selected'] === 'true');
            expect(selectedSubTab?.textContent).toContain('Validation Rules');

        });

        // #301: AN INSERT'S RESULT AND ITS RESULTS FILE ARE THE NOTIFICATION'S, SO THE CARD GROWS NO LINE WHEN ONE ENDS
        it('draws no insert result and no View errors, and adds no node to the card when an insert ends', () => {

            const panel = renderPanel();
            selectOrg(panel);
            postReadiness(panel);
            const card = accountCard(panel);
            const descendantsOf = (element: any): any[] => [element, ...element.children.flatMap(descendantsOf)];

            partOf(panel, card, 'treeInsert').dispatch('click');
            const nodesWhileRunning = descendantsOf(card);
            panel.postToPanel({ command: 'insertState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

            expect(descendantsOf(card)).toEqual(nodesWhileRunning);
            expect(panel.findAll(card, 'treeInsertResult')).toEqual([]);
            expect(panel.findAll(card, 'treeInsertErrors')).toEqual([]);
            expect(postedNamed(panel, 'viewInsertErrors')).toEqual([]);

        });

    });

});
