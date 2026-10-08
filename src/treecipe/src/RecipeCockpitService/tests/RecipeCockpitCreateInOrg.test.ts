import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    workspace: { workspaceFolders: undefined },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

/*
    snowfakery is a CLI, so its execFile is answered here: the recipe it was handed is read and each
    object written count times, the way snowfakery's JSON output carries them (_table, id, nickname
    and the fields). A template is written as "generated" and a TODO comment as null -- what matters
    is that the CUT recipe reached the CLI as one argv element with no shell, and that its records
    come back through the real transform.
*/
const snowfakeryCalls: Array<{ command: string; argumentList: string[]; options: Record<string, unknown> }> = [];

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    exec: jest.fn(),
    execFile: jest.fn().mockImplementation((command: string, argumentList: string[], options: Record<string, unknown>, callback: Function) => {
        snowfakeryCalls.push({ command, argumentList, options });
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
    RECIPE_COCKPIT_CREATE_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { DatasetSourceService } from '../../DatasetSourceService/DatasetSourceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const SNOWFAKERY_RUN = 'recipe-2026-09-20T10-00-00';
const FAKER_JS_RUN = 'recipe-fakerjs-2026-09-21T00-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';

const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const PARENT_ACCOUNT_IDS = ['001000000000001AAA', '001000000000002AAA'];
const PARTNER_RECORD_TYPE_ID = '012000000000001AAA';

// A faker-js RUN OF THE SAME TREE: Contact NESTED UNDER Account, ITS AccountId WIRED TO THE PARENT'S NICKNAME, AND A RECORD TYPE
const FAKER_JS_ACCOUNT_RECIPE = `# Relationship Tree: RelationshipTree_1

- object: Account
  nickname: Account_NickName
  count: 1
  fields:
    Name: \${{faker.company.name()}}
    OwnerId: ### TODO -- REFERENCE ID REQUIRED
  friends:
    - object: Contact
      nickname: Contact_NickName
      count: 1
      fields:
        LastName: \${{faker.person.lastName()}}
        RecordTypeId: Contact.Partner
        AccountId: Account_NickName
        ReportsToId: ### TODO -- REFERENCE ID REQUIRED
      friends:
        - object: OtherChildObject__c
          nickname: OtherChildObject__c_NickName
          count: 1
          fields:
            Score__c: \${{faker.number.int({min: 0, max: 99})}}
            Contact__c: Contact_NickName
`;

// THE ORG AS A DESCRIBE WOULD ANSWER: Contact NEEDS AN Account, OwnerId IS THE ORG'S TO FILL, ReportsToId IS OPTIONAL
const RAW_DESCRIBES: Record<string, unknown> = {
    Contact: {
        name: 'Contact', createable: true,
        fields: [
            { name: 'LastName', type: 'string', nillable: false, createable: true },
            { name: 'AccountId', type: 'reference', referenceTo: ['Account'], nillable: false, createable: true },
            { name: 'OwnerId', type: 'reference', referenceTo: ['User'], nillable: false, createable: true, defaultedOnCreate: true },
            { name: 'ReportsToId', type: 'reference', referenceTo: ['Contact'], nillable: true, createable: true },
            { name: 'RecordTypeId', type: 'reference', referenceTo: ['RecordType'], nillable: true, createable: true }
        ]
    },
    Account: { name: 'Account', createable: true, fields: [{ name: 'Name', type: 'string', nillable: false, createable: true }] },
    Lead: { name: 'Lead', createable: true, fields: [{ name: 'Company', type: 'string', nillable: false, createable: true }] },
    OtherChildObject__c: {
        name: 'OtherChildObject__c', createable: true,
        fields: [{ name: 'Contact__c', type: 'reference', referenceTo: ['Contact'], nillable: false, createable: true }]
    }
};

function buildFakeConnection(options: { isSandbox?: boolean; accountCount?: number; rejectedRecordIndexes?: number[] } = {}) {

    const sentQueries: string[] = [];
    const insertedBatches: Array<{ objectApiName: string; records: any[]; insertOptions: unknown }> = [];

    const connection = {
        instanceUrl: 'https://qa.sandbox.my.salesforce.com',
        sentQueries,
        insertedBatches,
        describe: jest.fn().mockImplementation(async (objectApiName: string) => {
            if ( !RAW_DESCRIBES[objectApiName] ) {
                throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
            }
            return RAW_DESCRIBES[objectApiName];
        }),
        query: jest.fn().mockImplementation(async (soql: string) => {
            sentQueries.push(soql);
            if ( soql.includes('FROM Organization') ) {
                return { records: [{ IsSandbox: options.isSandbox ?? true, OrganizationType: options.isSandbox === false ? 'Developer Edition' : 'Unlimited Edition' }] };
            }
            if ( soql.startsWith('SELECT COUNT() FROM Account') ) {
                return { totalSize: options.accountCount ?? PARENT_ACCOUNT_IDS.length };
            }
            if ( soql.startsWith('SELECT COUNT()') ) {
                return { totalSize: 4 };
            }
            if ( soql === 'SELECT Id FROM Account LIMIT 2000' ) {
                return { records: PARENT_ACCOUNT_IDS.map(accountId => ({ Id: accountId })) };
            }
            if ( soql.includes('FROM RecordType') ) {
                return { records: [{ Id: PARTNER_RECORD_TYPE_ID, SobjectType: 'Contact', DeveloperName: 'Partner' }] };
            }
            throw new Error(`unexpected query: ${soql}`);
        }),
        sobject: jest.fn().mockImplementation((objectApiName: string) => ({
            insert: jest.fn().mockImplementation(async (records: any[], insertOptions: unknown) => {
                insertedBatches.push({ objectApiName, records, insertOptions });
                return records.map((_record, recordIndex) => ( options.rejectedRecordIndexes ?? [] ).includes(recordIndex)
                    ? { success: false, errors: [{ statusCode: 'ENTITY_IS_DELETED', message: 'entity is deleted' }] }
                    : { id: `003${String(recordIndex + 1).padStart(15, '0')}`, success: true, errors: [] });
            }),
            delete: jest.fn()
        }))
    };

    return connection;

}

describe('RecipeCockpitService, Create in org (#180)', () => {

    beforeEach(() => {
        SalesforceOrgService.clearRecordCountCache();
        SalesforceOrgService.clearDescribeCache();
    });

    describe('collectCreatableObjectKeys', () => {

        it('names each object of each tree that has a recipe file to cut it from', () => {

            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;

            expect(RecipeCockpitService.collectCreatableObjectKeys(recipe)).toEqual([
                `${ACCOUNT_TREE_KEY}\nAccount`, `${ACCOUNT_TREE_KEY}\nContact`, `${ACCOUNT_TREE_KEY}\nOtherChildObject__c`, `${LEAD_TREE_KEY}\nLead`
            ]);

        });

    });

    describe('routePanelMessage, createRecords', () => {

        const RECIPE_FILE_PATH = '/workspace/recipe.yml';

        const buildPanelState = (orgTypeDetail: { isSandbox: boolean; organizationType: string } = { isSandbox: true, organizationType: 'Unlimited Edition' }): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 4 };
            panelState.dataOrgDetails = [SANDBOX_ORG, { targetOrgIdentifier: 'prod', username: 'prod@example.com', alias: 'prod' }];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 2, orgTypeDetail: orgTypeDetail };
            panelState.creatableObjectKeys = new Set([`${ACCOUNT_TREE_KEY}\nContact`]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, RECIPE_FILE_PATH);
            return panelState;
        };

        const validMessage = { command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 25 };
        const refusal = (objectApiName = 'Contact') => ({ kind: 'postCreateState', hostMessage: { command: 'createState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, objectApiName } });

        it('routes a count of 1 to 200 for the selected sandbox, the rendered tree and object, to the host-held recipe file', () => {

            expect(RecipeCockpitService.routePanelMessage(validMessage, buildPanelState())).toEqual({
                kind: 'createRecords', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', recordCount: 25, recipeFilePath: RECIPE_FILE_PATH
            });

        });

        it.each([
            ['0', 0],
            ['201', 201],
            ['2.5', 2.5],
            ['"abc"', 'abc'],
            ['"25"', '25'],
            ['NaN', Number.NaN],
            ['no count', undefined]
        ])('refuses the count %s, and answers that nothing runs', (_description, count) => {

            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, count }, buildPanelState())).toEqual(refusal());

        });

        it('refuses another org\'s index, a tree or object the model did not offer, and a payload that is not names', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, orgIndex: 1 }, buildPanelState())).toEqual(refusal());
            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, orgIndex: '0' }, buildPanelState())).toEqual(refusal());
            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, objectApiName: 'Account' }, buildPanelState())).toEqual(refusal('Account'));
            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, treeKey: LEAD_TREE_KEY }, buildPanelState())).toMatchObject({ kind: 'postCreateState' });
            expect(RecipeCockpitService.routePanelMessage({ ...validMessage, treeKey: { toString: () => ACCOUNT_TREE_KEY } }, buildPanelState())).toMatchObject({ kind: 'postCreateState' });

        });

        it('cannot reach a production org with a forged message, nor one whose type could not be read', () => {

            expect(RecipeCockpitService.routePanelMessage(validMessage, buildPanelState({ isSandbox: false, organizationType: 'Developer Edition' }))).toEqual(refusal());
            const unknownTypeState = buildPanelState();
            delete unknownTypeState.dataOrgSelection.orgTypeDetail;
            expect(RecipeCockpitService.routePanelMessage(validMessage, unknownTypeState)).toEqual(refusal());

        });

        it('refuses with no org selected, and before a model is confirmed drawn', () => {

            const unselectedState = buildPanelState();
            unselectedState.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage(validMessage, unselectedState)).toEqual(refusal());

            const undrawnState = buildPanelState();
            undrawnState.creatableObjectKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage(validMessage, undrawnState)).toEqual(refusal());

        });

        it('answers nothing while another Create is running, which already holds every button disabled', () => {

            const panelState = buildPanelState();
            panelState.createStateMessage = { command: 'createState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' };

            expect(RecipeCockpitService.routePanelMessage(validMessage, panelState)).toBeUndefined();

        });

        it('opens a Create\'s results only for a row of the selected org that had failures', () => {

            const panelState = buildPanelState();
            const storeResult = (failedCount: number) => panelState.dataOrgCreateResults.set(
                RecipeCockpitService.buildCreateResultKey(SANDBOX_ORG.username, ACCOUNT_TREE_KEY, 'Contact'),
                { viewModel: { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', createdCount: 2, failedCount, message: '' }, resultsFilePath: '/workspace/results.json' }
            );
            const viewErrors = { command: 'viewCreateErrors', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' };

            expect(RecipeCockpitService.routePanelMessage(viewErrors, panelState)).toBeUndefined();
            storeResult(0);
            expect(RecipeCockpitService.routePanelMessage(viewErrors, panelState)).toBeUndefined();
            storeResult(1);
            expect(RecipeCockpitService.routePanelMessage(viewErrors, panelState)).toEqual({ kind: 'viewCreateErrors', resultsFilePath: '/workspace/results.json' });
            expect(RecipeCockpitService.routePanelMessage({ ...viewErrors, filePath: '/etc/passwd', objectApiName: 'Lead' }, panelState)).toBeUndefined();

        });

    });

    describe('computeCreateReadiness', () => {

        it('asks a production org nothing more, and refuses every object', async () => {

            const connection = buildFakeConnection({ isSandbox: false });

            const readiness = await RecipeCockpitService.computeCreateReadiness(SANDBOX_ORG.username, connection, SalesforceOrgService.toQuerySource(connection as any),
                ['Account', 'Contact'], { isSandbox: false, organizationType: 'Developer Edition' }, () => false);

            expect(connection.describe).not.toHaveBeenCalled();
            expect(connection.query).not.toHaveBeenCalled();
            expect([...readiness.values()].map(objectReadiness => objectReadiness.disabledReason)).toEqual([
                'Records are created only in a sandbox, and this org is Production · Developer Edition.',
                'Records are created only in a sandbox, and this org is Production · Developer Edition.'
            ]);

        });

        it('describes each object in a sandbox, counts each required parent, and offers what passes every guard', async () => {

            const connection = buildFakeConnection({ accountCount: 0 });

            const readiness = await RecipeCockpitService.computeCreateReadiness(SANDBOX_ORG.username, connection, SalesforceOrgService.toQuerySource(connection as any),
                ['Account', 'Contact', 'Ghost__c'], { isSandbox: true, organizationType: 'Unlimited Edition' }, () => false);

            expect(readiness.get('Account')).toEqual({ objectApiName: 'Account', disabledReason: '', requiredLookups: [] });
            expect(readiness.get('Contact')).toEqual({
                objectApiName: 'Contact',
                disabledReason: 'AccountId needs a Account record, and the org has none.',
                requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', parentRecordCount: 0 }]
            });
            expect(readiness.get('Ghost__c').disabledReason).toContain('Ghost__c is not in this org');
            expect(connection.sentQueries).toContain('SELECT COUNT() FROM Account');

        });

    });

    describe('buildCreateConfirmationDetail', () => {

        it('names the org and its username, Sandbox, the object, the count, each required lookup with its parent count, the backend and the tree', () => {

            const detail = RecipeCockpitService.buildCreateConfirmationDetail(
                'qa (qa@example.com.qa)', { isSandbox: true, organizationType: 'Unlimited Edition' }, 'Contact', 25,
                { objectApiName: 'Contact', disabledReason: '', requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', parentRecordCount: 1200 }] },
                'snowfakery', ACCOUNT_TREE_KEY, 'recipe--Account.yml'
            );

            expect(detail.split('\n')).toEqual([
                'Org: qa (qa@example.com.qa)',
                'Type: Sandbox',
                'Object: Contact',
                'Records: 25',
                'Required lookups:',
                '  AccountId → a random one of 1200 Account records',
                'Every other lookup is left blank.',
                'Backend: snowfakery',
                `Recipe tree: ${ACCOUNT_TREE_KEY} (recipe--Account.yml)`,
                '',
                'Records are inserted with allOrNone false, and nothing is rolled back: what Salesforce accepts stays in the org.'
            ]);

        });

    });

    describe('the open panel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let temporaryWorkspaceRoot: string;
        let showWarningMessageSpy: jest.SpyInstance;
        let selectedFakerService: string;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const fakeDataSetsFolderPath = () => path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets');
        const datasetFolderNames = () => fs.existsSync(fakeDataSetsFolderPath()) ? fs.readdirSync(fakeDataSetsFolderPath()) : [];

        // A COPY OF THE TREE WORKSPACE, WITH A faker-js RUN OF THE SAME TREE NEWER THAN THE snowfakery ONE
        const buildWorkspace = () => {

            temporaryWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-create-'));
            fs.cpSync(TREE_WORKSPACE_ROOT, temporaryWorkspaceRoot, { recursive: true });

            const generatedRecipesFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes');
            const fakerJsTreeFolderPath = path.join(generatedRecipesFolderPath, FAKER_JS_RUN, ACCOUNT_TREE_KEY);
            fs.mkdirSync(fakerJsTreeFolderPath, { recursive: true });
            fs.writeFileSync(path.join(fakerJsTreeFolderPath, `recipe-fakerjs--${ACCOUNT_TREE_KEY}-2026-09-21T00-00-00.yml`), FAKER_JS_ACCOUNT_RECIPE);
            fs.copyFileSync(
                path.join(generatedRecipesFolderPath, SNOWFAKERY_RUN, 'treecipeObjectsWrapper-2026-09-20T10-00-00.json'),
                path.join(generatedRecipesFolderPath, FAKER_JS_RUN, 'treecipeObjectsWrapper-2026-09-21T00-00-00.json')
            );

        };

        const openSelectedCockpit = async (runFolderName: string) => {
            await RecipeCockpitService.openRecipeCockpitPanel(temporaryWorkspaceRoot);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            if ( postedNamed('recipeData').at(-1).recipe.selectedRunFolderName !== runFolderName ) {
                await receivedMessageHandler({ command: 'selectRun', runFolderName });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            }
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
        };

        beforeEach(() => {

            postedPanelMessages = [];
            snowfakeryCalls.length = 0;
            buildWorkspace();

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
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_CREATE_CONFIRM_LABEL);

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockImplementation(() => temporaryWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'getNowIsoDateTimestamp').mockReturnValue('2026-10-07T12-00-00');
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG], hiddenOrgCount: 0 });
            selectedFakerService = 'snowfakery';
            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockImplementation(() => selectedFakerService);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true });
        });

        it('offers Create for each object once the counts are in, with each required parent and its count', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(FAKER_JS_RUN);

            const readinessMessage = postedNamed('dataOrgReadiness').at(-1);
            const countsIndex = postedPanelMessages.lastIndexOf(postedNamed('dataOrgCounts').at(-1));

            expect(postedPanelMessages.indexOf(readinessMessage)).toBeGreaterThan(countsIndex);
            expect(readinessMessage.objects.find((readiness: any) => readiness.objectApiName === 'Contact')).toEqual({
                objectApiName: 'Contact', disabledReason: '', requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', parentRecordCount: 2 }]
            });
            expect(JSON.stringify(readinessMessage)).not.toContain(SANDBOX_ORG.username);

        });

        it.each([
            ['faker-js', FAKER_JS_RUN],
            ['snowfakery', SNOWFAKERY_RUN]
        ])('given %s, cuts the object\'s block, generates N records, sets the required lookup to a parent Id, blanks the rest, swaps the record type, inserts with allOrNone false and records the data set', async (fakerService, runFolderName) => {

            selectedFakerService = fakerService;
            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(runFolderName);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            // THE HOST-SIDE MODAL, WITH WHAT THE HOST CHECKED
            const [modalMessage, modalOptions, modalAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(modalMessage).toBe('Create 3 Contact records in qa (qa@example.com.qa)?');
            expect(modalOptions.modal).toBe(true);
            expect(modalOptions.detail).toContain('Type: Sandbox');
            expect(modalOptions.detail).toContain('AccountId → a random one of 2 Account records');
            expect(modalOptions.detail).toContain(`Backend: ${fakerService}`);
            expect(modalAction).toBe(RECIPE_COCKPIT_CREATE_CONFIRM_LABEL);

            const [datasetFolderName] = datasetFolderNames();
            const datasetFolderPath = path.join(fakeDataSetsFolderPath(), datasetFolderName);
            expect(datasetFolderName).toBe(fakerService === 'faker-js' ? 'dataset-fakerjs-2026-10-07T12-00-00' : 'dataset-2026-10-07T12-00-00');

            const createRecipe = yaml.load(fs.readFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'createRecipe-Contact.yml'), 'utf-8')) as any[];
            expect(createRecipe).toHaveLength(1);
            expect(createRecipe[0]).toMatchObject({ object: 'Contact', count: 3 });
            expect(createRecipe[0].friends).toBeUndefined();

            // THE INSERT: ONE REQUEST, allOrNone FALSE, EVERY RECORD ATTACHED TO AN EXISTING ACCOUNT
            expect(connection.insertedBatches).toHaveLength(1);
            const [insertedBatch] = connection.insertedBatches;
            expect(insertedBatch.objectApiName).toBe('Contact');
            expect(insertedBatch.insertOptions).toEqual({ allowRecursive: false, allOrNone: false });
            expect(insertedBatch.records).toHaveLength(3);
            insertedBatch.records.forEach((insertedRecord: any) => {
                expect(PARENT_ACCOUNT_IDS).toContain(insertedRecord.AccountId);
                expect(insertedRecord).not.toHaveProperty('ReportsToId');
                expect(insertedRecord).not.toHaveProperty('OwnerId');
                expect(insertedRecord.attributes.type).toBe('Contact');
            });
            if ( fakerService === 'faker-js' ) {
                insertedBatch.records.forEach((insertedRecord: any) => expect(insertedRecord.RecordTypeId).toBe(PARTNER_RECORD_TYPE_ID));
            }

            const collectionsApiRecords = JSON.parse(fs.readFileSync(path.join(datasetFolderPath, 'DatasetFilesForCollectionsApi', 'collectionsApi-Contact.json'), 'utf-8')).records;
            expect(collectionsApiRecords).toEqual(insertedBatch.records);

            // RESULTS AS TODAY, AND THE SOURCE FILE NAMING THE ORG, THE OBJECT AND THE IDS
            expect(fs.readdirSync(path.join(datasetFolderPath, 'InsertAttempts'))).toEqual(['insertAttempt-2026-10-07T12-00-00']);
            const datasetSource = JSON.parse(fs.readFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'datasetSource.json'), 'utf-8'));
            expect(datasetSource).toMatchObject({
                origin: 'createInOrg',
                orgUsername: SANDBOX_ORG.username,
                createdObjectApiName: 'Contact',
                createdRecordIds: ['003000000000000001', '003000000000000002', '003000000000000003'],
                recipeRunFolderName: runFolderName,
                recipeTreeFolderName: ACCOUNT_TREE_KEY,
                fakerService: fakerService,
                recordCountsByObject: { Contact: 3 }
            });

            // THE RELOAD LISTS IT IN THE TREE'S PREVIOUS FAKE SETS
            const reloadedTree = postedNamed('recipeData').at(-1).recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY);
            expect(reloadedTree.history.datasets.map((dataset: any) => dataset.datasetFolderName)).toContain(datasetFolderName);
            expect(postedNamed('createState').map(createState => createState.isRunning)).toEqual([true, false]);

            if ( fakerService === 'snowfakery' ) {
                expect(snowfakeryCalls).toHaveLength(1);
                expect(snowfakeryCalls[0].command).toBe('snowfakery');
                expect(snowfakeryCalls[0].argumentList).toEqual([path.join(datasetFolderPath, 'BaseArtifactFiles', 'createRecipe-Contact.yml'), '--output-format', 'json']);
                expect(snowfakeryCalls[0].options).not.toHaveProperty('shell');
            }

        });

        it('shows the result on the row after the reload, and re-counts the object', async () => {

            const connection = buildFakeConnection({ rejectedRecordIndexes: [1] });
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            const contactCountQueries = () => connection.sentQueries.filter(soql => soql === 'SELECT COUNT() FROM Contact').length;
            const countsBefore = contactCountQueries();

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            // THE RELOADED PANEL ASKS AGAIN, AS THE REAL ONE DOES ON ITS NEXT DRAW
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });

            const readinessMessage = postedNamed('dataOrgReadiness').at(-1);
            expect(readinessMessage.renderSequence).toBe(lastRenderSequence());
            expect(readinessMessage.createResults).toEqual([{
                treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', createdCount: 2, failedCount: 1, message: 'ENTITY_IS_DELETED: entity is deleted'
            }]);
            expect(contactCountQueries()).toBe(countsBefore + 1);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('2 Contact records were created in qa (qa@example.com.qa) and 1 failed. Nothing was rolled back'));

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            await receivedMessageHandler({ command: 'viewCreateErrors', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' });
            expect(openFileSpy).toHaveBeenCalledWith(expect.stringMatching(/InsertAttempts[\\/]insertAttempt-2026-10-07T12-00-00[\\/]insertAttemptResults-2026-10-07T12-00-00\.json$/));

        });

        it('writes nothing and contacts the org no further when the modal is cancelled', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            const queriesBeforeCreate = connection.sentQueries.length;
            const recipeDataPostsBefore = postedNamed('recipeData').length;

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            const queriesAfterModal = connection.sentQueries.slice(queriesBeforeCreate);
            expect(queriesAfterModal.every(soql => soql.includes('FROM Organization') || soql.startsWith('SELECT COUNT()'))).toBe(true);
            expect(queriesAfterModal).not.toContain('SELECT Id FROM Account LIMIT 2000');
            expect(connection.insertedBatches).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);
            expect(snowfakeryCalls).toEqual([]);
            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore);
            expect(postedNamed('createState').at(-1).isRunning).toBe(false);

        });

        it('refuses if the selected org changed between the click and the confirm', async () => {

            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);
            jest.spyOn(SalesforceOrgService, 'listDataOrgDetails').mockResolvedValue({ orgDetails: [SANDBOX_ORG, { targetOrgIdentifier: 'other', username: 'other@example.com.qa', alias: 'other' }], hiddenOrgCount: 0 });

            await openSelectedCockpit(SNOWFAKERY_RUN);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 1 });
                return RECIPE_COCKPIT_CREATE_CONFIRM_LABEL;
            });

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith('The org selection changed after qa (qa@example.com.qa) was confirmed (another org was chosen, or the counts or the run were reloaded), so no Contact records were created. Choose + Create again.');
            expect(connection.insertedBatches).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('refuses, before any modal, an org that now answers it is not a sandbox', async () => {

            const sandboxConnection = buildFakeConnection();
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(sandboxConnection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            const productionConnection = buildFakeConnection({ isSandbox: false });
            getConnectionSpy.mockResolvedValue(productionConnection as any);

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Records are created only in a sandbox, and this org is Production · Developer Edition.'));
            expect(productionConnection.insertedBatches).toEqual([]);

        });

        it('refuses a recipe generated for the other backend, as Run Faker does', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            selectedFakerService = 'faker-js';
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith('This recipe was generated for snowfakery — switch with "Select Faker Implementation".');
            expect(datasetFolderNames()).toEqual([]);

        });

        it('reports a parent deleted between counting and inserting as per-record failures, and rolls nothing back', async () => {

            const connection = buildFakeConnection({ rejectedRecordIndexes: [0, 1, 2] });
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            const datasetFolderPath = path.join(fakeDataSetsFolderPath(), datasetFolderNames()[0]);
            const insertResults = JSON.parse(fs.readFileSync(path.join(datasetFolderPath, 'InsertAttempts', 'insertAttempt-2026-10-07T12-00-00', 'insertAttemptResults-2026-10-07T12-00-00.json'), 'utf-8'));

            expect(insertResults.FailureResults.Contact).toHaveLength(3);
            expect(connection.sobject('Contact').delete).not.toHaveBeenCalled();
            expect(DatasetSourceService.typeCheckDatasetSource(JSON.parse(fs.readFileSync(path.join(datasetFolderPath, 'BaseArtifactFiles', 'datasetSource.json'), 'utf-8'))))
                .toMatchObject({ origin: 'createInOrg', createdRecordIds: [] });

        });

        const accountRecipeFilePath = (runFolderName: string) => path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', runFolderName, ACCOUNT_TREE_KEY,
            runFolderName === SNOWFAKERY_RUN ? `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml` : `recipe-fakerjs--${ACCOUNT_TREE_KEY}-2026-09-21T00-00-00.yml`);

        it('refuses a recipe file deleted since the model was drawn, writing nothing', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            fs.rmSync(accountRecipeFilePath(SNOWFAKERY_RUN));
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists in this workspace, so no Contact records were created.'));
            expect(datasetFolderNames()).toEqual([]);
            expect(postedNamed('createState').at(-1).isRunning).toBe(false);

        });

        it('refuses an object whose block cannot be cut from the recipe, saying why', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            const recipeFilePath = accountRecipeFilePath(SNOWFAKERY_RUN);
            fs.writeFileSync(recipeFilePath, fs.readFileSync(recipeFilePath, 'utf-8').replace('  nickname: Contact_NickName\n  count: 1\n', '  nickname: Contact_NickName\n'));
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The Contact block could not be cut from'));
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(datasetFolderNames()).toEqual([]);

        });

        it('refuses when the parent Id query returns no records after the confirm, writing nothing', async () => {

            const connection = buildFakeConnection();
            const countingQuery = connection.query.getMockImplementation();
            connection.query.mockImplementation(async (soql: string) => soql === 'SELECT Id FROM Account LIMIT 2000' ? { records: [] } : countingQuery(soql));
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith('AccountId needs a Account record, and qa (qa@example.com.qa) returned none, so no Contact records were created.');
            expect(connection.insertedBatches).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('refuses a Create when the run is reloaded while the dialog is open, even with the same org re-selected', async () => {

            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                await receivedMessageHandler({ command: 'selectRun', runFolderName: SNOWFAKERY_RUN });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'loadDataOrgs' });
                return RECIPE_COCKPIT_CREATE_CONFIRM_LABEL;
            });

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The org selection changed after qa (qa@example.com.qa) was confirmed'));
            expect(connection.insertedBatches).toEqual([]);
            expect(datasetFolderNames()).toEqual([]);

        });

        it('inserts nothing when the backend generates more records than were confirmed', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            const tooManyRecords = Array.from({ length: 5 }, (_record, recordIndex) => ({ attributes: { type: 'Contact', referenceId: `Contact_Reference_${recordIndex + 1}` }, LastName: 'x' }));
            jest.spyOn(ConfigurationService, 'getFakerRecipeProcessorByExtensionConfigSelection').mockReturnValue({
                generateFakeDataBySelectedRecipeFile: jest.fn().mockResolvedValue('[]'),
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: jest.fn().mockReturnValue(new Map([['Contact', { allOrNone: true, records: tooManyRecords }]]))
            });
            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(connection.insertedBatches).toEqual([]);
            expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: 'The snowfakery backend generated 5 Contact records from the cut recipe where 3 were confirmed, so nothing was inserted.'
            }), 'openRecipeCockpit');

        });

        it('reports a backend that generated no records of the object, and inserts nothing', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            jest.spyOn(ConfigurationService, 'getFakerRecipeProcessorByExtensionConfigSelection').mockReturnValue({
                generateFakeDataBySelectedRecipeFile: jest.fn().mockResolvedValue('[]'),
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: jest.fn().mockReturnValue(new Map())
            });
            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(connection.insertedBatches).toEqual([]);
            expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'The snowfakery backend generated 0 Contact records from the cut recipe where 3 were confirmed, so nothing was inserted.' }), 'openRecipeCockpit');

        });

        it('answers a refused Create with the state that re-enables the buttons', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 201 });

            expect(postedNamed('createState')).toEqual([{ command: 'createState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' }]);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        it('says so when the results file View errors opens is gone', async () => {

            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection({ rejectedRecordIndexes: [0] }) as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 1 });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            fs.rmSync(fakeDataSetsFolderPath(), { recursive: true, force: true });

            const openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            await receivedMessageHandler({ command: 'viewCreateErrors', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' });

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith('The insert results file of that Create no longer exists in this workspace.');

        });

        it('disables Create on every object when the describe itself fails, saying why', async () => {

            const connection = buildFakeConnection();
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection as any);
            jest.spyOn(SalesforceOrgService, 'describeObjects').mockRejectedValue(new Error('REQUEST_LIMIT_EXCEEDED'));

            await openSelectedCockpit(SNOWFAKERY_RUN);

            expect(postedNamed('dataOrgReadiness').at(-1).objects.map((readiness: any) => readiness.disabledReason)).toEqual(Array(4).fill(
                'The objects could not be described in this org (REQUEST_LIMIT_EXCEEDED), so nothing is created in it.'
            ));

        });

        it('given generation fails after the data set folder was made, still reloads and re-enables, then reports the failure', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            jest.spyOn(ErrorHandlingService, 'createFakerExpressionEvaluationErrorCaptureFile').mockImplementation(() => undefined);
            jest.spyOn(ConfigurationService, 'getFakerRecipeProcessorByExtensionConfigSelection').mockReturnValue({
                generateFakeDataBySelectedRecipeFile: jest.fn().mockRejectedValue(new Error('snowfakery exited 1')),
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: jest.fn()
            });
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(buildFakeConnection() as any);

            await openSelectedCockpit(SNOWFAKERY_RUN);
            const recipeDataPostsBefore = postedNamed('recipeData').length;

            await receivedMessageHandler({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 3 });

            expect(postedNamed('recipeData')).toHaveLength(recipeDataPostsBefore + 1);
            expect(postedNamed('createState').at(-1).isRunning).toBe(false);
            expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowfakery exited 1' }), 'openRecipeCockpit');

        });

    });

    describe('the panel script, Create controls', () => {

        const renderSelectedPanel = () => {
            const panel = runPanelScript();
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence: 3, renderSequence: 1 });
            return panel;
        };

        const postReadiness = (panel: any, contactReason = '', createResults: any[] = []) => panel.postToPanel({
            command: 'dataOrgReadiness',
            objects: [
                { objectApiName: 'Account', disabledReason: '', requiredLookups: [] },
                { objectApiName: 'Contact', disabledReason: contactReason, requiredLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account', parentRecordCount: 2 }] },
                { objectApiName: 'OtherChildObject__c', disabledReason: 'OtherChildObject__c is not createable in this org.', requiredLookups: [] },
                { objectApiName: 'Lead', disabledReason: '', requiredLookups: [] }
            ],
            createResults: createResults,
            requestSequence: 3,
            renderSequence: 1
        });

        const rowNamed = (panel: any, objectApiName: string) => panel.findAll(panel.cockpitBodyElement, 'dataObject')
            .find((rowElement: any) => panel.findAll(rowElement, 'dataObjectName')[0].textContent === objectApiName);
        const partOf = (panel: any, rowElement: any, className: string) => panel.findAll(rowElement, className)[0];
        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('shows a number input and "+ Create" on each row once an org is selected, disabled until the host says why or why not', () => {

            const panel = renderSelectedPanel();
            const contactRow = rowNamed(panel, 'Contact');

            expect(panel.isHidden(partOf(panel, contactRow, 'dataCreateControls'))).toBe(false);
            expect(partOf(panel, contactRow, 'dataCreateCount').attributes).toMatchObject({ type: 'number', min: '1', max: '200' });
            expect(partOf(panel, contactRow, 'dataCreate').disabled).toBe(true);

            postReadiness(panel);

            expect(partOf(panel, contactRow, 'dataCreate').disabled).toBe(false);
            expect(partOf(panel, contactRow, 'dataCreate').attributes.title).toBe('Each record gets a random existing Account for AccountId');
            expect(partOf(panel, rowNamed(panel, 'OtherChildObject__c'), 'dataCreate').disabled).toBe(true);
            expect(partOf(panel, rowNamed(panel, 'OtherChildObject__c'), 'dataCreateReason').textContent).toBe('OtherChildObject__c is not createable in this org.');

        });

        it('posts the org index, the tree, the object and the count, and disables every Create until the host answers', () => {

            const panel = renderSelectedPanel();
            postReadiness(panel);
            const contactRow = rowNamed(panel, 'Contact');

            partOf(panel, contactRow, 'dataCreateCount').value = '25';
            partOf(panel, contactRow, 'dataCreate').dispatch('click');

            expect(postedNamed(panel, 'createRecords')).toEqual([{ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', count: 25 }]);
            expect(partOf(panel, contactRow, 'dataCreate').textContent).toBe('Creating…');
            expect(panel.findAll(panel.cockpitBodyElement, 'dataCreate').every((buttonElement: any) => buttonElement.disabled)).toBe(true);

            panel.postToPanel({ command: 'createState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' });

            expect(partOf(panel, contactRow, 'dataCreate').disabled).toBe(false);

        });

        it.each(['0', '201', '2.5', 'abc', ''])('does not post the count "%s", and says what it takes', countText => {

            const panel = renderSelectedPanel();
            postReadiness(panel);
            const contactRow = rowNamed(panel, 'Contact');

            partOf(panel, contactRow, 'dataCreateCount').value = countText;
            partOf(panel, contactRow, 'dataCreate').dispatch('click');

            expect(postedNamed(panel, 'createRecords')).toEqual([]);
            expect(partOf(panel, contactRow, 'dataCreateReason').textContent).toBe('Enter a whole number from 1 to 200.');

        });

        it('shows "✓ 25 created", or "23 created · 2 failed" with View errors, from the host\'s results', () => {

            const panel = renderSelectedPanel();
            postReadiness(panel, '', [
                { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', createdCount: 25, failedCount: 0, message: '' },
                { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', createdCount: 23, failedCount: 2, message: 'ENTITY_IS_DELETED: entity is deleted' }
            ]);

            expect(partOf(panel, rowNamed(panel, 'Account'), 'dataCreateResult').textContent).toBe('✓ 25 created');
            expect(panel.isHidden(partOf(panel, rowNamed(panel, 'Account'), 'dataCreateErrors'))).toBe(true);

            const contactRow = rowNamed(panel, 'Contact');
            expect(partOf(panel, contactRow, 'dataCreateResult').textContent).toBe('23 created · 2 failed');
            expect(panel.isHidden(partOf(panel, contactRow, 'dataCreateErrors'))).toBe(false);

            partOf(panel, contactRow, 'dataCreateErrors').dispatch('click');
            expect(postedNamed(panel, 'viewCreateErrors')).toEqual([{ command: 'viewCreateErrors', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' }]);

        });

        it('drops readiness for an older selection', () => {

            const panel = renderSelectedPanel();
            panel.postToPanel({ command: 'dataOrgReadiness', objects: [{ objectApiName: 'Contact', disabledReason: '', requiredLookups: [] }], createResults: [], requestSequence: 2, renderSequence: 1 });

            expect(partOf(panel, rowNamed(panel, 'Contact'), 'dataCreate').disabled).toBe(true);

        });

        it('keeps every Create disabled across a new model while the host says one is running', () => {

            const panel = renderSelectedPanel();
            postReadiness(panel);
            panel.postToPanel({ command: 'createState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' });

            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, SNOWFAKERY_RUN).recipeViewModel, renderSequence: 2 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence: 4, renderSequence: 2 });
            panel.postToPanel({ command: 'dataOrgReadiness', objects: [{ objectApiName: 'Lead', disabledReason: '', requiredLookups: [] }], createResults: [], requestSequence: 4, renderSequence: 2 });

            expect(partOf(panel, rowNamed(panel, 'Lead'), 'dataCreate').disabled).toBe(true);

        });

    });

});
