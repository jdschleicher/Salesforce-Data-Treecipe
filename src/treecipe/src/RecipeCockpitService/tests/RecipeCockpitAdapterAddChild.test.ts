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

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn(), exec: jest.fn() }));

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_OTHER_LOOKUP_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX,
    RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE,
    RECIPE_COCKPIT_UPDATER_FORMULA_REASON,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitRecordCreation } from '../RecipeCockpitRecordCreation';
import { IOrgStagedFieldDetail, RecipeCockpitOrgChangeDetection } from '../RecipeCockpitOrgChangeDetection';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';

const fakeRecordId = (objectApiName: string, recordIndex: number) =>
    `${({ Account: '001', Contact: '003', OtherChildObject__c: 'a01' } as Record<string, string>)[objectApiName] ?? 'a99'}${String(recordIndex).padStart(12, '0')}AAA`;

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const OTHER_SANDBOX_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };
const CHILD_OBJECT = 'Shipment__c';

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const fieldXml = (fieldApiName: string, fieldType: string, extra = '') => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <fullName>${fieldApiName}</fullName>`,
    `    <label>${fieldApiName.replace(/__c$/, '').replace(/_/g, ' ')}</label>`,
    extra,
    `    <type>${fieldType}</type>`,
    '</CustomField>',
    ''
].join('\n');

// A CUSTOM CHILD OBJECT ONLY THE ORG HOLDS, AS ITS RETRIEVE STAGES IT: A TEXT NAME, THE LOOKUP TO Account, AND A FIELD OF EVERY KIND THE BLOCK DECIDES ON
const CHILD_OBJECT_FILE = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">',
    '    <label>Shipment</label>',
    '    <nameField><label>Shipment Name</label><type>Text</type></nameField>',
    '</CustomObject>',
    ''
].join('\n');
const CHILD_FIELD_FILES: Record<string, string> = {
    'Account__c': fieldXml('Account__c', 'MasterDetail', '    <referenceTo>Account</referenceTo>'),
    'Carrier__c': fieldXml('Carrier__c', 'Text', '    <length>40</length>\n    <required>true</required>'),
    'Contact__c': fieldXml('Contact__c', 'Lookup', '    <referenceTo>Contact</referenceTo>'),
    'Total__c': fieldXml('Total__c', 'Number', '    <formula>1 + 1</formula>\n    <precision>18</precision>\n    <scale>0</scale>'),
    'Mood__c': fieldXml('Mood__c', 'Hologram'),
    'Broken__c': '<CustomField><unclosed>'
};

const stageChildObject = (stagingFolderPath: string) => {
    const objectFolderPath = path.join(stagingFolderPath, 'main', 'default', 'objects', CHILD_OBJECT);
    fs.mkdirSync(path.join(objectFolderPath, 'fields'), { recursive: true });
    fs.writeFileSync(path.join(objectFolderPath, `${CHILD_OBJECT}.object-meta.xml`), CHILD_OBJECT_FILE);
    Object.entries(CHILD_FIELD_FILES).forEach(([fieldApiName, fieldText]) => fs.writeFileSync(path.join(objectFolderPath, 'fields', `${fieldApiName}.field-meta.xml`), fieldText));
};

const stagedField = (fieldApiName: string, overrides: Partial<IOrgStagedFieldDetail> = {}): IOrgStagedFieldDetail => ({
    objectApiName: CHILD_OBJECT,
    fieldApiName: fieldApiName,
    fieldType: 'Text',
    fieldLabel: fieldApiName,
    referenceTo: '',
    controllingField: '',
    isFormula: false,
    valueSetName: '',
    picklistValues: [],
    isRequired: false,
    ...overrides
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, the Treecipe Adapter adds a new child object under the loaded parents (#447, E1)', () => {

    describe('RecipeCockpitOrgChangeDetection.readStagedObjectFields', () => {

        let temporaryRoot: string;

        beforeEach(() => { temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapter-child-staged-')); });
        afterEach(() => { fs.rmSync(temporaryRoot, { recursive: true, force: true }); });

        it('reads the Text name from the object file and every field file, with whether each is required, and counts a file it cannot read', async () => {

            const stagingFolderPath = path.join(temporaryRoot, 'treecipe', 'OrgOperations', 'qa', 'staged');
            stageChildObject(stagingFolderPath);

            const stagedObject = await RecipeCockpitOrgChangeDetection.readStagedObjectFields(temporaryRoot, stagingFolderPath, CHILD_OBJECT);

            expect(stagedObject.isRetrieved).toBe(true);
            expect(stagedObject.unreadableFieldCount).toBe(1);
            expect(stagedObject.fields.map(field => [field.fieldApiName, field.fieldType, field.isRequired])).toEqual([
                ['Name', 'Text', true],
                ['Account__c', 'MasterDetail', false],
                ['Carrier__c', 'Text', true],
                ['Contact__c', 'Lookup', false],
                ['Mood__c', 'Hologram', false],
                ['Total__c', 'Number', false]
            ]);
            expect(stagedObject.fields.find(field => field.fieldApiName === 'Carrier__c')).toMatchObject({ length: 40, referenceTo: '' });

        });

        it('lists no Name for an Auto Number name, and says when the object was not retrieved', async () => {

            const stagingFolderPath = path.join(temporaryRoot, 'staged');
            stageChildObject(stagingFolderPath);
            fs.writeFileSync(path.join(stagingFolderPath, 'main', 'default', 'objects', CHILD_OBJECT, `${CHILD_OBJECT}.object-meta.xml`), CHILD_OBJECT_FILE.replace('<type>Text</type>', '<type>AutoNumber</type>'));

            const stagedObject = await RecipeCockpitOrgChangeDetection.readStagedObjectFields(temporaryRoot, stagingFolderPath, CHILD_OBJECT);
            expect(stagedObject.fields.map(field => field.fieldApiName)).not.toContain('Name');

            expect(await RecipeCockpitOrgChangeDetection.readStagedObjectFields(temporaryRoot, stagingFolderPath, 'Missing__c')).toEqual({ isRetrieved: false, fields: [], unreadableFieldCount: 0 });

        });

    });

    describe('RecipeCockpitRecipeWriter.buildAdapterChildRecipe', () => {

        it('writes one block of the count given, with only the fields given, read back as one object', () => {

            const recipeBuild = RecipeCockpitRecipeWriter.buildAdapterChildRecipe(CHILD_OBJECT, 6, [{ fieldApiName: 'Carrier__c', valueText: '"${{ faker.company.name() }}"' }]);

            expect(recipeBuild.isBuilt).toBe(true);
            expect(yaml.load((recipeBuild as { recipeText: string }).recipeText)).toEqual([
                { object: CHILD_OBJECT, nickname: 'Shipment__c_Adapter_NickName', count: 6, fields: { Carrier__c: '${{ faker.company.name() }}' } }
            ]);

        });

        it('writes a block with no field and no fields line, since the lookup is set after generation', () => {

            const recipeBuild = RecipeCockpitRecipeWriter.buildAdapterChildRecipe(CHILD_OBJECT, 2, []);

            expect(yaml.load((recipeBuild as { recipeText: string }).recipeText)).toEqual([{ object: CHILD_OBJECT, nickname: 'Shipment__c_Adapter_NickName', count: 2 }]);

        });

        it('refuses a count that is not a whole number of one or more, a name that is not an api name, and a value that adds a line', () => {

            expect(RecipeCockpitRecipeWriter.buildAdapterChildRecipe(CHILD_OBJECT, 0, [])).toMatchObject({ isBuilt: false });
            expect(RecipeCockpitRecipeWriter.buildAdapterChildRecipe(CHILD_OBJECT, 1.5, [])).toMatchObject({ isBuilt: false });
            expect(RecipeCockpitRecipeWriter.buildAdapterChildRecipe('Ship ment', 1, [])).toMatchObject({ isBuilt: false });
            expect(RecipeCockpitRecipeWriter.buildAdapterChildRecipe(CHILD_OBJECT, 1, [{ fieldApiName: 'Carrier__c', valueText: 'a\n- object: Account' }])).toMatchObject({ isBuilt: false });

        });

        it('leaves the Updater\'s value recipe as it was: no field is still refused', () => {

            expect(RecipeCockpitRecipeWriter.buildUpdaterValueRecipe('Account', 3, [])).toEqual({ isBuilt: false, refusal: 'No field of Account has a value to generate.' });
            expect(yaml.load((RecipeCockpitRecipeWriter.buildUpdaterValueRecipe('Account', 3, [{ fieldApiName: 'Name', valueText: 'Acme' }]) as { recipeText: string }).recipeText))
                .toEqual([{ object: 'Account', nickname: 'Account_Updater_NickName', count: 3, fields: { Name: 'Acme' } }]);

        });

    });

    describe('RecipeCockpitRecordCreation.spreadParentIds', () => {

        it('gives each loaded parent its count of records in a row, in the order the parents were read', () => {
            expect(RecipeCockpitRecordCreation.spreadParentIds(['A', 'B', 'C'], 2)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
            expect(RecipeCockpitRecordCreation.spreadParentIds(['A'], 1)).toEqual(['A']);
        });

        it('points no record at no parent', () => {
            expect(RecipeCockpitRecordCreation.spreadParentIds([], 2)).toBeUndefined();
            expect(RecipeCockpitRecordCreation.spreadParentIds(['A'], 0)).toBeUndefined();
            expect(RecipeCockpitRecordCreation.spreadParentIds(['A'], 1.5)).toBeUndefined();
        });

    });

    describe('offerAdapterChildFields', () => {

        const recipe = loadTreeRecipe();
        const tree = recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
        const stagedFields = [
            stagedField('Name', { length: 80, isRequired: true }),
            stagedField('Account__c', { fieldType: 'MasterDetail', referenceTo: 'Account' }),
            stagedField('Carrier__c', { length: 40, isRequired: true }),
            stagedField('Contact__c', { fieldType: 'Lookup', referenceTo: 'Contact' }),
            stagedField('Mood__c', { fieldType: 'Hologram' }),
            stagedField('Total__c', { fieldType: 'Number', isFormula: true })
        ];

        it.each([
            ['faker-js' as const, '${{ faker.lorem.text(40).substring(0, 40) }}'],
            ['snowfakery' as const, '${{fake.text(max_nb_chars=40)}}']
        ])('offers each field with the %s backend\'s expression, the lookup to the parent and any other lookup locked', (fakerService, carrierExpression) => {

            const offer = RecipeCockpitService.offerAdapterChildFields(stagedFields, 'Account', CHILD_OBJECT, 'Account__c', tree, fakerService);
            const offersByName = Object.fromEntries(offer.fieldViewModels.map(fieldViewModel => [fieldViewModel.fieldApiName, fieldViewModel]));

            expect(offer.fieldViewModels.map(fieldViewModel => fieldViewModel.fieldApiName)).toEqual(['Name', 'Account__c', 'Carrier__c', 'Contact__c', 'Mood__c', 'Total__c']);
            expect(offersByName.Account__c).toEqual({ fieldApiName: 'Account__c', fieldLabel: 'Account__c', fieldTypeWithSize: 'MasterDetail', isRequired: false, lockReason: `${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX}Account Id` });
            expect(offersByName.Contact__c.lockReason).toBe(RECIPE_COCKPIT_ADAPTER_CHILD_OTHER_LOOKUP_REASON);
            expect(offersByName.Total__c.lockReason).toBe(RECIPE_COCKPIT_UPDATER_FORMULA_REASON);
            expect(offersByName.Carrier__c).toEqual({ fieldApiName: 'Carrier__c', fieldLabel: 'Carrier__c', fieldTypeWithSize: 'Text(40)', isRequired: true, expression: carrierExpression });
            expect(offersByName.Name.expression).toMatch(/^\$\{\{/);
            expect(offersByName.Mood__c).toMatchObject({ note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE });
            expect(offer.offeredFields.get('Carrier__c')?.expression).toBe(carrierExpression);

        });

    });

    describe('the host, from the retrieve to the preview, against a faked org, CLI and processor', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let generatedRecipeTexts: string[];
        let cliArgumentLists: string[][];
        let accountRecordCount: number;
        let generatedCountOffset: number;
        let processorSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.inPanel).map(([warningText]) => warningText);
        const confirmations = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.inPanel);
        const recipeFilePath = () => panelState().treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(ACCOUNT_TREE_KEY)!;

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const selectOrg = (orgDetail: typeof SANDBOX_ORG, isSandbox = true) => {
            panelState().dataOrgDetails = [orgDetail];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: orgDetail, requestSequence: 1, orgTypeDetail: { isSandbox: isSandbox, organizationType: isSandbox ? 'Developer Edition' : 'Enterprise Edition' } };
        };

        const openRetrieveAndLoad = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({ command: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), parentObjectApiName: 'Account' });
            await send({
                command: 'loadUpdaterRecords',
                parentObjectApiName: 'Account',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [
                    { objectApiName: 'Account', fieldApiNames: [], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: [], whereClause: '' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            });
        };

        const prepareMessage = () => ({ command: 'prepareAdapterChild', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), parentObjectApiName: 'Account', childObjectApiName: CHILD_OBJECT, lookupFieldApiName: 'Account__c' });
        const generateMessage = (countPerParent: unknown, fields: unknown) => ({ command: 'generateAdapterChild', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), childObjectApiName: CHILD_OBJECT, countPerParent: countPerParent, fields: fields });

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapter-child-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));
            fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields'), { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();
            SalesforceOrgService.clearDescribeCache();

            postedPanelMessages = [];
            generatedRecipeTexts = [];
            cliArgumentLists = [];
            accountRecordCount = 3;
            generatedCountOffset = 0;

            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string, options?: { inPanel?: boolean }) => {
                if ( options?.inPanel && message.startsWith('Generate ') ) { return Promise.resolve(RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_CONFIRM_LABEL); }
                return Promise.resolve(undefined);
            });
            (vscode.window.showInformationMessage as jest.Mock).mockReset();

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
            jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockImplementation(async () => false);

            // EVERY RETRIEVE STAGES THE CHILD OBJECT'S FILES UNDER --output-dir
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockImplementation(async (cliArguments: string[]) => {
                cliArgumentLists.push(cliArguments);
                stageChildObject(path.join(workspaceRoot, cliArguments[cliArguments.indexOf('--output-dir') + 1]));
                return { stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), stderr: '', exitCode: 0 };
            });

            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => {
                    if ( /FROM Organization/.test(soql) ) {
                        return { totalSize: 1, done: true, records: [{ IsSandbox: true, OrganizationType: 'Developer Edition' }] };
                    }
                    if ( /FROM SetupAuditTrail/.test(soql) ) {
                        return { totalSize: 0, done: true, records: [] };
                    }
                    const objectApiName = /FROM (\w+)/.exec(soql)![1];
                    const records = Array.from({ length: objectApiName === 'Account' ? accountRecordCount : 0 }, (_value, recordIndex) => ({ attributes: { type: objectApiName }, Id: fakeRecordId(objectApiName, recordIndex) }));
                    return { totalSize: records.length, done: true, records: records };
                },
                queryMore: async () => { throw new Error('no more pages'); },
                tooling: { query: async () => { throw Object.assign(new Error('no source tracking'), { errorCode: 'INVALID_TYPE' }); } },
                describe: async (objectApiName: string) => ({
                    name: objectApiName,
                    label: objectApiName,
                    updateable: true,
                    fields: [],
                    childRelationships: objectApiName === 'Account' ? [{ childSObject: CHILD_OBJECT, field: 'Account__c' }] : []
                })
            }) as any);

            const standInProcessor: IFakerRecipeProcessor = {
                generateFakeDataBySelectedRecipeFile: async (recipePath: string) => {
                    const recipeText = fs.readFileSync(recipePath, 'utf8');
                    generatedRecipeTexts.push(recipeText);
                    return recipeText;
                },
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: (recipeText: string) => {
                    const [recipe] = yaml.load(recipeText) as any[];
                    return new Map([[recipe.object, {
                        allOrNone: true,
                        records: Array.from({ length: recipe.count + generatedCountOffset }, (_value, recordIndex) => ({
                            attributes: { type: recipe.object, referenceId: `${recipe.nickname}_${recordIndex}` },
                            ...Object.fromEntries(Object.keys(recipe.fields ?? {}).map(fieldApiName => [fieldApiName, `${fieldApiName}-new-${recordIndex}`]))
                        }))
                    }]]);
                }
            } as unknown as IFakerRecipeProcessor;
            processorSpy = jest.spyOn(RecipeCockpitService, 'createUpdaterRecipeProcessor').mockReturnValue(standInProcessor);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('lists the child under its parent, retrieves it on its own into a new staging folder, and posts its block', async () => {

            await openRetrieveAndLoad();
            const accountChanges = postedNamed('adapterMetadataChanges')[0].objects.find((objectChanges: any) => objectChanges.objectApiName === 'Account');
            expect(accountChanges.newChildObjects).toEqual([{ childObjectApiName: CHILD_OBJECT, fieldApiName: 'Account__c' }]);

            await send(prepareMessage());

            const childRetrieve = cliArgumentLists.at(-1)!;
            const manifestText = fs.readFileSync(path.join(workspaceRoot, childRetrieve[childRetrieve.indexOf('--manifest') + 1]), 'utf8');
            expect(manifestText).toContain(`<members>${CHILD_OBJECT}</members>`);
            expect(manifestText).not.toContain('<members>Account</members>');
            expect(childRetrieve[childRetrieve.indexOf('--output-dir') + 1]).not.toBe(cliArgumentLists[0][cliArgumentLists[0].indexOf('--output-dir') + 1]);
            expect(childRetrieve[childRetrieve.indexOf('--target-org') + 1]).toBe(SANDBOX_ORG.username);

            const [blockMessage] = postedNamed('adapterChildBlock');
            expect(blockMessage).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, parentObjectApiName: 'Account', childObjectApiName: CHILD_OBJECT, lookupFieldApiName: 'Account__c', parentRecordCount: 3, fakerService: 'snowfakery', unreadableFieldCount: 1 });
            expect(blockMessage.fields.map((field: any) => [field.fieldApiName, field.lockReason ?? field.expression ?? field.note])).toEqual([
                ['Name', '${{fake.text(max_nb_chars=80)}}'],
                ['Account__c', `${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX}Account Id`],
                ['Carrier__c', '${{fake.text(max_nb_chars=40)}}'],
                ['Contact__c', RECIPE_COCKPIT_ADAPTER_CHILD_OTHER_LOOKUP_REASON],
                ['Mood__c', RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE],
                ['Total__c', RECIPE_COCKPIT_UPDATER_FORMULA_REASON]
            ]);
            expect(panelState().adapterChildBlockMessage).toBe(blockMessage);

        });

        it('refuses Add to data set before a load, under no loaded parents, under an excluded parent, and from another org than the parents came from', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({ command: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), parentObjectApiName: 'Account' });

            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad', refusalText: `${CHILD_OBJECT} was not added: ${RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON}` });

            accountRecordCount = 0;
            await openRetrieveAndLoad();
            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ refusalText: `${CHILD_OBJECT} was not added: ${RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON}` });

            accountRecordCount = 3;
            await openRetrieveAndLoad();
            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ kind: 'prepareAdapterChild' });

            const tree = panelState().recipeDataMessage!.recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
            tree.objectSelection = { exclusions: [{ objectApiName: 'Account', kind: 'direct' } as any], disabledLookups: [], includedObjectCount: 0, objectCount: 3 };
            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ refusalText: `${CHILD_OBJECT} was not added: ${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX}Account.` });
            tree.objectSelection = undefined;

            selectOrg(OTHER_SANDBOX_ORG);
            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ refusalText: expect.stringContaining('not the sandbox or scratch org the parent records were loaded from') });
            selectOrg(SANDBOX_ORG, false);
            expect(RecipeCockpitService.routePanelMessage(prepareMessage(), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

            // A CHILD THE LAST RETRIEVE DID NOT LIST UNDER THIS PARENT IS NOT ONE TO ADD
            selectOrg(SANDBOX_ORG);
            expect(RecipeCockpitService.routePanelMessage({ ...prepareMessage(), childObjectApiName: 'Gadget__c' }, panelState())).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: expect.objectContaining({ isRunning: false }) });
            expect(RecipeCockpitService.routePanelMessage({ ...prepareMessage(), parentObjectApiName: 'Contact' }, panelState())).toEqual({ kind: 'refuseUpdaterLoad', hostMessage: expect.objectContaining({ isRunning: false }) });

        });

        it('generates 2 per Account under 3 loaded Accounts: 6 records, each lookup a loaded Account Id, from a block outside the workspace, the recipe byte for byte as it was', async () => {

            await openRetrieveAndLoad();
            const recipeBefore = fs.readFileSync(recipeFilePath());
            await send(prepareMessage());

            await send(generateMessage(2, [{ fieldApiName: 'Name' }, { fieldApiName: 'Carrier__c' }, { fieldApiName: 'Mood__c', value: 'Calm' }]));

            expect(processorSpy).toHaveBeenCalledWith('snowfakery');
            expect(generatedRecipeTexts.map(recipeText => yaml.load(recipeText))).toEqual([[{
                object: CHILD_OBJECT,
                nickname: 'Shipment__c_Adapter_NickName',
                count: 6,
                fields: { Name: '${{fake.text(max_nb_chars=80)}}', Carrier__c: '${{fake.text(max_nb_chars=40)}}' }
            }]]);
            expect(confirmations().at(-1)[0]).toBe(`Generate 6 ${CHILD_OBJECT} records under the loaded Account records?`);
            expect(confirmations().at(-1)[1].detail.split('\n').slice(2)).toEqual([
                '2 per Account record, under 3 Account records: 6 Shipment__c records',
                '  Account__c -- the Id of a loaded Account record, 2 in a row',
                '  Name -- expression the recipe\'s backend writes for its type in the org: ${{fake.text(max_nb_chars=80)}}',
                '  Carrier__c -- expression the recipe\'s backend writes for its type in the org: ${{fake.text(max_nb_chars=40)}}',
                '  Mood__c -- fixed value: Calm'
            ]);

            const records = RecipeCockpitService.readHeldAdapterChildRecords()!;
            expect(records).toHaveLength(6);
            expect(records.map(record => record.Account__c)).toEqual([0, 0, 1, 1, 2, 2].map(recordIndex => fakeRecordId('Account', recordIndex)));
            expect(records.map(record => record.Mood__c)).toEqual(Array(6).fill('Calm'));
            expect(records[3]).toMatchObject({ Name: 'Name-new-3', Carrier__c: 'Carrier__c-new-3' });

            const [previewMessage] = postedNamed('adapterChildPreview');
            expect(previewMessage).toMatchObject({ childObjectApiName: CHILD_OBJECT, countPerParent: 2, recordCount: 6, columns: ['Account__c', 'Name', 'Carrier__c', 'Mood__c'] });
            expect(previewMessage.rows[2][0]).toBe(fakeRecordId('Account', 1));

            expect(fs.readFileSync(recipeFilePath()).equals(recipeBefore)).toBe(true);
            expect(fs.readdirSync(path.dirname(recipeFilePath())).filter(fileName => /adapterChild/.test(fileName))).toEqual([]);

        });

        it('refuses a generated count that differs from count times parents, and keeps nothing', async () => {

            await openRetrieveAndLoad();
            await send(prepareMessage());
            generatedCountOffset = -1;

            await send(generateMessage(2, [{ fieldApiName: 'Carrier__c' }]));

            expect(warnings().at(-1)).toBe(`No ${CHILD_OBJECT} records were generated: snowfakery generated 5 ${CHILD_OBJECT} records for 6 asked for.`);
            expect(RecipeCockpitService.readHeldAdapterChildRecords()).toBeUndefined();
            expect(postedNamed('adapterChildPreview')).toEqual([]);

        });

        it('generates the block with the real faker-js processor when the card\'s recipe is faker-js, the lookup alone with no field ticked', async () => {

            processorSpy.mockRestore();
            jest.spyOn(VSCodeWorkspaceService, 'readRecipeFakerService').mockReturnValue('faker-js');
            await openRetrieveAndLoad();
            await send(prepareMessage());
            expect(postedNamed('adapterChildBlock')[0].fields.find((field: any) => field.fieldApiName === 'Carrier__c').expression).toBe('${{ faker.lorem.text(40).substring(0, 40) }}');

            await send(generateMessage(1, [{ fieldApiName: 'Carrier__c' }]));
            const records = RecipeCockpitService.readHeldAdapterChildRecords()!;
            expect(records.map(record => record.Account__c)).toEqual([0, 1, 2].map(recordIndex => fakeRecordId('Account', recordIndex)));
            records.forEach(record => expect(String(record.Carrier__c).length).toBeWithin(1, 41));

            await send(generateMessage(2, []));
            expect(RecipeCockpitService.readHeldAdapterChildRecords()!.map(record => record.Account__c)).toEqual([0, 0, 1, 1, 2, 2].map(recordIndex => fakeRecordId('Account', recordIndex)));

        });

        it('refuses a locked field, a field it never offered, a count that is not one or more, and a typed expression for a fixed-value-only field', async () => {

            await openRetrieveAndLoad();
            await send(prepareMessage());

            expect(RecipeCockpitService.routePanelMessage(generateMessage(2, [{ fieldApiName: 'Account__c', value: fakeRecordId('Account', 9) }]), panelState())).toMatchObject({ refusalText: `No ${CHILD_OBJECT} records were generated: ${CHILD_OBJECT}.Account__c is not one this block offers to fill.` });
            expect(RecipeCockpitService.routePanelMessage(generateMessage(2, [{ fieldApiName: 'Secret__c' }]), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });
            expect(RecipeCockpitService.routePanelMessage(generateMessage(2, [{ fieldApiName: 'Carrier__c' }, { fieldApiName: 'Carrier__c' }]), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });
            expect(RecipeCockpitService.routePanelMessage(generateMessage(0, []), panelState())).toMatchObject({ refusalText: expect.stringContaining('whole number of one or more') });
            expect(RecipeCockpitService.routePanelMessage(generateMessage('2', []), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });
            expect(RecipeCockpitService.routePanelMessage(generateMessage(20000, []), panelState())).toMatchObject({ refusalText: expect.stringContaining('more than the 50000') });

            await send(generateMessage(1, [{ fieldApiName: 'Mood__c', value: '${{ fake.Word }}' }]));
            expect(warnings().at(-1)).toMatch(/^No Shipment__c records were generated: Shipment__c\.Mood__c: /);
            await send(generateMessage(1, [{ fieldApiName: 'Mood__c' }]));
            expect(warnings().at(-1)).toBe(`No ${CHILD_OBJECT} records were generated: ${CHILD_OBJECT}.Mood__c: ${RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE}`);
            expect(generatedRecipeTexts).toEqual([]);

        });

        it('lets the child go with the next load, and replays the block and its preview while their model is on screen', async () => {

            await openRetrieveAndLoad();
            await send(prepareMessage());
            await send(generateMessage(1, [{ fieldApiName: 'Carrier__c' }]));

            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('adapterChildBlock')).toHaveLength(1);
            expect(postedNamed('adapterChildPreview')).toHaveLength(1);

            await send({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({
                command: 'loadUpdaterRecords',
                parentObjectApiName: 'Account',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: lastRenderSequence(),
                objects: [
                    { objectApiName: 'Account', fieldApiNames: [], whereClause: '' },
                    { objectApiName: 'Contact', fieldApiNames: [], whereClause: '' },
                    { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
                ]
            });
            expect(RecipeCockpitService.readHeldAdapterChildRecords()).toBeUndefined();
            expect(panelState().adapterChildBlockMessage).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage(generateMessage(1, []), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

        });

    });

    describe('the panel script', () => {

        const recipe = loadTreeRecipe();
        const objects = [{ objectApiName: 'Account', isRetrieved: true, unchangedFieldCount: 0, unreadableFieldCount: 0, fieldChanges: [], newChildObjects: [{ childObjectApiName: CHILD_OBJECT, fieldApiName: 'Account__c' }], moreNewChildObjectCount: 0 }];
        const blockMessage = {
            command: 'adapterChildBlock',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            parentObjectApiName: 'Account',
            childObjectApiName: CHILD_OBJECT,
            lookupFieldApiName: 'Account__c',
            parentRecordCount: 3,
            orgLabel: 'qa · qa@example.com.qa',
            fakerService: 'snowfakery',
            unreadableFieldCount: 1,
            fields: [
                { fieldApiName: 'Account__c', fieldLabel: 'Account', fieldTypeWithSize: 'MasterDetail', isRequired: false, lockReason: `${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_LOOKUP_REASON_PREFIX}Account Id` },
                { fieldApiName: 'Carrier__c', fieldLabel: 'Carrier', fieldTypeWithSize: 'Text(40)', isRequired: true, expression: '${{fake.text(max_nb_chars=40)}}' },
                { fieldApiName: 'Mood__c', fieldLabel: 'Mood', fieldTypeWithSize: 'Hologram', isRequired: false, note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE }
            ]
        };
        const recordsMessage = (accountCount: number) => ({
            command: 'updaterRecords',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            orgLabel: 'qa',
            objects: [{ objectApiName: 'Account', totalSize: accountCount, recordCount: accountCount, isTruncated: false, columns: ['Id'], rows: [], hiddenColumnCount: 0 }]
        });

        const openUpdaterTab = (panel: any) => {
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const card = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openAdapterStructure(card, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(card, 'treeUpdater')[0];
            panel.postToPanel({ command: 'adapterMetadataChanges', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: objects });
            const accountObject = panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
            panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].dispatch('click');
            const childRow = () => panel.findAll(accountObject, 'updaterOrgOnlyObject')[0];
            const addButton = () => panel.findAll(childRow(), 'adapterChildAdd')[0];
            return { accountObject: accountObject, childRow: childRow, addButton: addButton };
        };

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('offers Add to data set on a new child object only once records of its parent are loaded', () => {

            const panel = runPanelScript();
            const { addButton } = openUpdaterTab(panel);

            expect(addButton().textContent).toBe(RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL);
            expect(addButton().disabled).toBe(true);
            expect(addButton().attributes.title).toBe(RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON);

            panel.postToPanel(recordsMessage(0));
            expect(addButton().disabled).toBe(true);
            expect(addButton().attributes.title).toBe(RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON);

            panel.postToPanel(recordsMessage(3));
            expect(addButton().disabled).toBe(false);
            addButton().dispatch('click');

            expect(postedNamed(panel, 'prepareAdapterChild')).toEqual([{ command: 'prepareAdapterChild', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, parentObjectApiName: 'Account', childObjectApiName: CHILD_OBJECT, lookupFieldApiName: 'Account__c' }]);

        });

        it('draws the block under the child: a count per parent, each field with its box, its reason or its expression, and posts the count and the ticked fields', () => {

            const panel = runPanelScript();
            const { childRow } = openUpdaterTab(panel);
            panel.postToPanel(recordsMessage(3));
            panel.postToPanel(blockMessage);

            const editor = panel.findAll(childRow(), 'adapterChildEditor')[0];
            expect(editor).toBeDefined();
            const rowNamed = (fieldApiName: string) => panel.findAll(editor, 'updaterField').find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

            expect(panel.findAll(rowNamed('Account__c'), 'updaterFieldChoose')[0].disabled).toBe(true);
            expect(panel.findAll(rowNamed('Carrier__c'), 'updaterFieldChoose')[0].attributes['aria-checked']).toBe('true');
            expect(panel.findAll(rowNamed('Carrier__c'), 'adapterChildRequired')[0].textContent).toBe('required');
            expect(panel.findAll(rowNamed('Mood__c'), 'updaterFieldChoose')[0].attributes['aria-checked']).toBe('false');
            expect(panel.findAll(editor, 'adapterChildUnreadable')[0].textContent).toBe('1 field file could not be read and is left out.');

            const countInput = panel.findAll(editor, 'adapterChildCountInput')[0];
            countInput.value = 'two';
            panel.findAll(editor, 'adapterChildGenerate')[0].dispatch('click');
            expect(postedNamed(panel, 'generateAdapterChild')).toEqual([]);
            expect(panel.findAll(editor, 'adapterChildRefusal')[0].classList.contains('hidden')).toBe(false);

            panel.findAll(rowNamed('Mood__c'), 'updaterFieldChoose')[0].dispatch('click');
            panel.findAll(rowNamed('Mood__c'), 'updaterFieldEdit')[0].dispatch('click');
            panel.findAll(rowNamed('Mood__c'), 'fieldEditorInput')[0].value = 'Calm';
            panel.findAll(rowNamed('Mood__c'), 'fieldEditorSave')[0].dispatch('click');
            countInput.value = '2';
            panel.findAll(editor, 'adapterChildGenerate')[0].dispatch('click');

            expect(postedNamed(panel, 'generateAdapterChild')).toEqual([{
                command: 'generateAdapterChild',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: 1,
                childObjectApiName: CHILD_OBJECT,
                countPerParent: 2,
                fields: [{ fieldApiName: 'Carrier__c' }, { fieldApiName: 'Mood__c', value: 'Calm' }]
            }]);

            // THE CARD'S OWN CHOICE IS UNTOUCHED: A CHILD FIELD IS NEVER LOADED OR GENERATED AS THE PARENT'S
            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generateChild' });
            panel.postToPanel({ command: 'adapterChildPreview', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, childObjectApiName: CHILD_OBJECT, countPerParent: 2, recordCount: 6, columns: ['Account__c', 'Carrier__c'], rows: [['001000000000000AAA', 'Acme']], hiddenColumnCount: 0 });
            expect(panel.findAll(editor, 'adapterChildPreviewSummary')[0].textContent).toBe('6 new Shipment__c records, 2 per Account record. Showing the first 1');

        });

        it('keeps the block under its row when the retrieve\'s rows are drawn again, and lets it go when the next load starts', () => {

            const panel = runPanelScript();
            const { childRow } = openUpdaterTab(panel);
            panel.postToPanel(recordsMessage(3));
            panel.postToPanel(blockMessage);

            panel.postToPanel({ command: 'adapterMetadataChanges', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: objects });
            expect(panel.findAll(childRow(), 'adapterChildEditor')).toHaveLength(1);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(panel.findAll(childRow(), 'adapterChildEditor')).toHaveLength(0);

        });

    });

});
