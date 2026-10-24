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
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_EXPRESSION_REFUSAL,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_NO_RECIPE_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_UPDATER_FORMULA_REASON,
    RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { HOSTILE_PICKLIST_VALUES } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';
import { IOrgNewFieldDetail, IOrgObjectChanges, RecipeCockpitOrgChangeDetection } from '../RecipeCockpitOrgChangeDetection';
import { RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, RecipeCockpitRecordUpdate } from '../RecipeCockpitRecordUpdate';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';

// A RECORD Id OF THE SALESFORCE SHAPE, ITS FIRST 15 CHARACTERS UNIQUE, AS A RESTORE'S SNAPSHOT CHECK READS THEM
const fakeRecordId = (objectApiName: string, recordIndex: number) =>
    `${({ Account: '001', Contact: '003', OtherChildObject__c: 'a01' } as Record<string, string>)[objectApiName] ?? 'a99'}${String(recordIndex).padStart(12, '0')}AAA`;

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };
const OTHER_SANDBOX_ORG = { targetOrgIdentifier: 'uat', username: 'uat@example.com.uat', alias: 'uat' };

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

// EVERY KIND OF FIELD ONLY THE ORG HOLDS THAT #446 NAMES, AS A RETRIEVE STAGES THEM
const ORG_ONLY_FIELD_FILES: Record<string, string> = {
    'Region_Code__c': fieldXml('Region_Code__c', 'Text', '    <length>80</length>'),
    'Parent_Link__c': fieldXml('Parent_Link__c', 'Lookup', '    <referenceTo>Account</referenceTo>'),
    'Sub_Status__c': fieldXml('Sub_Status__c', 'Picklist', [
        '    <valueSet>',
        '        <controllingField>Rating__c</controllingField>',
        '        <valueSetDefinition><value><fullName>Open</fullName><label>Open</label></value></valueSetDefinition>',
        '    </valueSet>'
    ].join('\n')),
    'Score_Formula__c': fieldXml('Score_Formula__c', 'Number', '    <formula>1 + 1</formula>\n    <precision>18</precision>\n    <scale>0</scale>'),
    'Total_Spend__c': fieldXml('Total_Spend__c', 'Summary', '    <summaryOperation>count</summaryOperation>'),
    'Hologram__c': fieldXml('Hologram__c', 'Hologram')
};

const newFieldDetail = (fieldApiName: string, overrides: Partial<IOrgNewFieldDetail> = {}): IOrgNewFieldDetail => ({
    objectApiName: 'Account',
    fieldApiName: fieldApiName,
    fieldType: 'Text',
    fieldLabel: fieldApiName,
    referenceTo: '',
    controllingField: '',
    isFormula: false,
    valueSetName: '',
    picklistValues: [],
    ...overrides
});

const newFieldChanges = (newFields: readonly IOrgNewFieldDetail[], extraChanges: IOrgObjectChanges['fieldChanges'] = []): IOrgObjectChanges[] => [{
    objectApiName: 'Account',
    isRetrieved: true,
    unchangedFieldCount: 0,
    unreadableFieldCount: 0,
    fieldChanges: [
        ...newFields.map(newField => ({ fieldApiName: newField.fieldApiName, status: 'new' as const, fieldType: newField.fieldType, fieldLabel: newField.fieldLabel, differences: [] })),
        ...extraChanges
    ]
}];

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, the Treecipe Adapter fills fields only the org holds (#446)', () => {

    describe('RecipeCockpitOrgChangeDetection.detectFieldChangesWithNewFields', () => {

        let temporaryRoot: string;

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-only-detect-'));
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('reads each new field\'s staged file -- sizes, lookup, controlling field, formula, picklist values -- and the changes as detectFieldChanges does', async () => {

            const stagingFolderPath = path.join(temporaryRoot, 'treecipe', 'OrgOperations', 'qa', 'staged');
            const stagedFieldsFolder = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields');
            fs.mkdirSync(stagedFieldsFolder, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields'), { recursive: true });
            Object.entries(ORG_ONLY_FIELD_FILES).forEach(([fieldApiName, fieldText]) => fs.writeFileSync(path.join(stagedFieldsFolder, `${fieldApiName}.field-meta.xml`), fieldText));
            fs.writeFileSync(path.join(stagedFieldsFolder, 'Odd_Size__c.field-meta.xml'), fieldXml('Odd_Size__c', 'Text', '    <length>eighty</length>'));

            const detected = await RecipeCockpitOrgChangeDetection.detectFieldChangesWithNewFields(temporaryRoot, ['force-app'], stagingFolderPath, ['Account']);
            const newFieldsByName = new Map(detected.newFields.map(newField => [newField.fieldApiName, newField] as const));

            expect(detected.objectChanges).toEqual(await RecipeCockpitOrgChangeDetection.detectFieldChanges(temporaryRoot, ['force-app'], stagingFolderPath, ['Account']));
            expect(newFieldsByName.get('Region_Code__c')).toEqual(newFieldDetail('Region_Code__c', { fieldLabel: 'Region Code', length: 80 }));
            expect(newFieldsByName.get('Parent_Link__c')).toMatchObject({ fieldType: 'Lookup', referenceTo: 'Account', isFormula: false });
            expect(newFieldsByName.get('Sub_Status__c')).toMatchObject({ fieldType: 'Picklist', controllingField: 'Rating__c', picklistValues: ['Open'] });
            expect(newFieldsByName.get('Score_Formula__c')).toMatchObject({ fieldType: 'Number', isFormula: true, precision: 18, scale: 0 });
            expect(newFieldsByName.get('Total_Spend__c')).toMatchObject({ fieldType: 'Summary', isFormula: false });
            expect(newFieldsByName.get('Odd_Size__c')).not.toHaveProperty('length');

        });

    });

    describe('offerAdapterOrgOnlyFields', () => {

        const recipe = loadTreeRecipe();
        const tree = recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
        const offer = (newFields: IOrgNewFieldDetail[], fakerService: 'faker-js' | 'snowfakery' | undefined, extraChanges: IOrgObjectChanges['fieldChanges'] = []) =>
            RecipeCockpitService.offerAdapterOrgOnlyFields(recipe, tree, newFieldChanges(newFields, extraChanges), newFields, fakerService);

        it.each([
            ['faker-js', '${{ faker.lorem.text(80).substring(0, 80) }}'],
            ['snowfakery', '${{fake.text(max_nb_chars=80)}}']
        ] as const)('offers a Text(80) field only the org holds the expression %s writes for Text(80)', (fakerService, textExpression) => {

            const offered = offer([newFieldDetail('Region_Code__c', { length: 80 })], fakerService);

            expect(offered.objects[0].fieldChanges[0].orgOnly).toEqual({ fieldTypeWithSize: 'Text(80)', expression: textExpression });
            expect(offered.orgOnlyFields.get('Account\nRegion_Code__c')).toEqual({
                objectApiName: 'Account',
                fieldViewModel: {
                    fieldApiName: 'Region_Code__c',
                    fieldLabel: 'Region_Code__c',
                    fieldType: 'Text',
                    fieldTypeWithSize: 'Text(80)',
                    recipeValue: textExpression,
                    controllingField: '',
                    isOnlyInRecipeFile: false
                },
                picklistValues: [],
                expression: textExpression
            });

        });

        it.each(['faker-js', 'snowfakery'] as const)('locks a lookup, RecordTypeId, a dependent picklist, a formula, a roll-up and an auto number with %s, each saying why', (fakerService) => {

            const offered = offer([
                newFieldDetail('Parent_Link__c', { fieldType: 'Lookup', referenceTo: 'Account' }),
                newFieldDetail('Owner_Link__c', { fieldType: 'MasterDetail' }),
                newFieldDetail('RecordTypeId', { fieldType: 'Text' }),
                newFieldDetail('Sub_Status__c', { fieldType: 'Picklist', controllingField: 'Rating__c', picklistValues: ['Open'] }),
                newFieldDetail('Score_Formula__c', { fieldType: 'Number', isFormula: true, precision: 18, scale: 0 }),
                newFieldDetail('Total_Spend__c', { fieldType: 'Summary' }),
                newFieldDetail('Ticket_Number__c', { fieldType: 'AutoNumber' })
            ], fakerService);

            expect(offered.objects[0].fieldChanges.map(fieldChange => [fieldChange.fieldApiName, fieldChange.orgOnly?.lockReason, fieldChange.orgOnly?.expression])).toEqual([
                ['Parent_Link__c', RECIPE_COCKPIT_UPDATER_LOOKUP_REASON, undefined],
                ['Owner_Link__c', RECIPE_COCKPIT_UPDATER_LOOKUP_REASON, undefined],
                ['RecordTypeId', RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON, undefined],
                ['Sub_Status__c', `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c`, undefined],
                ['Score_Formula__c', RECIPE_COCKPIT_UPDATER_FORMULA_REASON, undefined],
                ['Total_Spend__c', RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON, undefined],
                ['Ticket_Number__c', RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON, undefined]
            ]);
            expect(RecipeCockpitService.readAdapterOrgOnlyFieldApiNames({
                adapterOrgOnlyFields: offered.orgOnlyFields,
                adapterMetadataChangesMessage: { treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 },
                recipeDataMessage: { renderSequence: 1 }
            } as unknown as IRecipeCockpitPanelState, ACCOUNT_TREE_KEY)).toEqual(new Map());

        });

        it.each(['faker-js', 'snowfakery'] as const)('offers a type %s writes no expression for as a fixed value only, with a note', (fakerService) => {

            const offered = offer([newFieldDetail('Hologram__c', { fieldType: 'Hologram' })], fakerService);

            expect(offered.objects[0].fieldChanges[0].orgOnly).toEqual({ fieldTypeWithSize: 'Hologram', note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE });
            expect(offered.orgOnlyFields.get('Account\nHologram__c')).not.toHaveProperty('expression');

        });

        it('locks every field when the card\'s backend is not known, since Generate values needs its recipe', () => {

            const offered = offer([newFieldDetail('Region_Code__c', { length: 80 })], undefined);

            expect(offered.objects[0].fieldChanges[0].orgOnly).toEqual({ fieldTypeWithSize: 'Text(80)', lockReason: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_NO_RECIPE_REASON });

        });

        it.each(['faker-js', 'snowfakery'] as const)('offers a %s picklist of hostile values either nothing or one expression checkConstrainedExpression accepts', (fakerService) => {

            HOSTILE_PICKLIST_VALUES.forEach(([payloadName, payload]) => {
                const offered = offer([newFieldDetail('Tier__c', { fieldType: 'Picklist', picklistValues: [payload, 'Gold'] })], fakerService);
                const orgOnly = offered.objects[0].fieldChanges[0].orgOnly;
                if ( orgOnly?.expression !== undefined ) {
                    expect([payloadName, RecipeCockpitRecipeWriter.checkConstrainedExpression(orgOnly.expression)]).toEqual([payloadName, undefined]);
                } else {
                    expect([payloadName, orgOnly?.note]).toEqual([payloadName, RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE]);
                }
            });

        });

        it('offers nothing for a changed field, or a new field the recipe already lists whatever its case', () => {

            const offered = offer([newFieldDetail('legacy_code__c')], 'faker-js', [
                { fieldApiName: 'Rating__c', status: 'changed', fieldType: 'Picklist', fieldLabel: 'Rating', differences: ['picklist values added: Frozen'] }
            ]);

            expect(offered.objects[0].fieldChanges.every(fieldChange => fieldChange.orgOnly === undefined)).toBe(true);
            expect(offered.orgOnlyFields.size).toBe(0);

        });

        it('reads a global value set picklist as Generate Treecipe does, and offers an object the recipe does not list its new fields', () => {

            const offered = RecipeCockpitService.offerAdapterOrgOnlyFields(recipe, tree, [
                ...newFieldChanges([newFieldDetail('Shared_Tier__c', { fieldType: 'Picklist', valueSetName: 'Not_Loaded_Set' })]),
                { objectApiName: 'Unlisted__c', isRetrieved: true, unchangedFieldCount: 0, unreadableFieldCount: 0, fieldChanges: [{ fieldApiName: 'Code__c', status: 'new', fieldType: 'Text', fieldLabel: 'Code', differences: [] }] }
            ], [
                newFieldDetail('Shared_Tier__c', { fieldType: 'Picklist', valueSetName: 'Not_Loaded_Set' }),
                newFieldDetail('Code__c', { objectApiName: 'Unlisted__c', length: 10 })
            ], 'faker-js');

            expect(offered.objects[0].fieldChanges[0].orgOnly).toEqual({ fieldTypeWithSize: 'Picklist', note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE });
            expect(offered.objects[1].fieldChanges[0].orgOnly).toEqual({ fieldTypeWithSize: 'Text(10)', expression: '${{ faker.lorem.text(10).substring(0, 10) }}' });

        });

        it('carries a picklist\'s values to its fixed value check, and gives a picklist with values an expression', () => {

            const offered = offer([newFieldDetail('Tier__c', { fieldType: 'Picklist', picklistValues: ['Gold', 'Silver'] })], 'faker-js');

            expect(offered.orgOnlyFields.get('Account\nTier__c')?.picklistValues).toEqual(['Gold', 'Silver']);
            expect(offered.objects[0].fieldChanges[0].orgOnly?.expression).toContain('Gold');

        });

    });

    describe('findDescribedOrgOnlyFieldLockReason', () => {

        const describedField = (overrides: Record<string, unknown>) => SalesforceOrgService.normalizeDescribeResult('Account', { name: 'Account', fields: [{ name: 'Region_Code__c', type: 'string', updateable: true, ...overrides }] }).fields[0];

        it('reads the Updater\'s lock off what the org says a field is', () => {

            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('Region_Code__c', describedField({}))).toBeUndefined();
            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('Region_Code__c', undefined)).toBeUndefined();
            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('Region_Code__c', describedField({ type: 'reference', referenceTo: ['Account'] }))).toBe(RECIPE_COCKPIT_UPDATER_LOOKUP_REASON);
            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('Region_Code__c', describedField({ type: 'picklist', dependentPicklist: true, controllerName: 'Rating__c' }))).toBe(`${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c`);
            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('Region_Code__c', describedField({ calculated: true }))).toBe(RECIPE_COCKPIT_UPDATER_FORMULA_REASON);
            expect(RecipeCockpitService.findDescribedOrgOnlyFieldLockReason('RecordTypeId', describedField({ name: 'RecordTypeId' }))).toBe(RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON);

        });

    });

    describe('RecipeCockpitRecordUpdate, the snapshot\'s fields only the org held', () => {

        const snapshotText = (objectOverrides: Record<string, unknown>) => JSON.stringify({
            orgUsername: 'qa@example.com.qa',
            treeFolderName: ACCOUNT_TREE_KEY,
            takenAt: '2026-10-24T10:00:00.000Z',
            objects: [{ objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Region_Code__c'], records: [{ recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'A', Region_Code__c: null } }], ...objectOverrides }]
        });

        it('records only the fields given that are being updated, and nothing when there are none', () => {

            const loadedRecords = [{ Id: fakeRecordId('Account', 0), Legacy_Code__c: 'A', region_code__c: 'R' }];

            expect(RecipeCockpitRecordUpdate.buildSnapshotObject('Account', ['Legacy_Code__c', 'Region_Code__c'], loadedRecords, ['Region_Code__c', 'Not_Updated__c'])).toEqual({
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Region_Code__c'],
                orgOnlyFieldApiNames: ['Region_Code__c'],
                records: [{ recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'A', Region_Code__c: 'R' } }]
            });
            expect(RecipeCockpitRecordUpdate.buildSnapshotObject('Account', ['Legacy_Code__c'], loadedRecords)).not.toHaveProperty('orgOnlyFieldApiNames');

        });

        it('reads them back, and refuses a list that is not among the object\'s fields', () => {

            expect(RecipeCockpitRecordUpdate.parseSnapshot(snapshotText({ orgOnlyFieldApiNames: ['Region_Code__c'] }))).toMatchObject({ objects: [{ orgOnlyFieldApiNames: ['Region_Code__c'] }] });
            expect(RecipeCockpitRecordUpdate.parseSnapshot(snapshotText({}))).not.toHaveProperty('objects.0.orgOnlyFieldApiNames');

            expect(RecipeCockpitRecordUpdate.parseSnapshot(snapshotText({ fieldApiNames: ['Description', 'Region_Code__c'], records: [{ recordId: fakeRecordId('Account', 0), fieldValues: { Description: 'A', Region_Code__c: null } }], orgOnlyFieldApiNames: ['Description'] })))
                .toEqual({ refusal: 'its fields of Account only in the org are not among its fields' });

            [['Other__c'], [], ['Region_Code__c', 'Region_Code__c'], 'Region_Code__c', [7]].forEach(orgOnlyFieldApiNames => {
                expect(RecipeCockpitRecordUpdate.parseSnapshot(snapshotText({ orgOnlyFieldApiNames: orgOnlyFieldApiNames }))).toEqual({ refusal: 'its fields of Account only in the org are not among its fields' });
            });

        });

    });

    describe('the host, from the retrieve to the restore, against a faked org, CLI and processor', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let queriedSoql: string[];
        let updateCalls: Array<{ objectApiName: string; records: any[] }>;
        let generatedRecipeTexts: string[];
        let describeAnswers: Record<string, unknown>;
        let currentRegionCodes: Record<string, string | null>;
        let processorSpy: jest.SpyInstance;
        let onUpdateRequest: () => void;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.inPanel).map(([warningText]) => warningText);
        const confirmations = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.inPanel);
        const attemptsFolderPath = () => path.join(workspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, ACCOUNT_TREE_KEY);
        const attemptFiles = () => fs.existsSync(attemptsFolderPath()) ? fs.readdirSync(attemptsFolderPath()).sort() : [];
        const readAttemptFiles = (suffix: string) => attemptFiles().filter(fileName => fileName.endsWith(suffix)).map(fileName => JSON.parse(fs.readFileSync(path.join(attemptsFolderPath(), fileName), 'utf8')));

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        const selectOrg = (orgDetail: typeof SANDBOX_ORG) => {
            panelState().dataOrgDetails = [orgDetail];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: orgDetail, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
        };

        const openCockpitAndRetrieve = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            await send({ command: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), parentObjectApiName: 'Account' });
        };

        const loadRequest = (accountFieldApiNames: string[]) => ({
            command: 'loadUpdaterRecords',
            parentObjectApiName: 'Account',
            treeKey: ACCOUNT_TREE_KEY,
            renderSequence: lastRenderSequence(),
            objects: [
                { objectApiName: 'Account', fieldApiNames: accountFieldApiNames, whereClause: '' },
                { objectApiName: 'Contact', fieldApiNames: [], whereClause: '' },
                { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
            ]
        });

        const generate = (fields: unknown) => send({ command: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fields: fields });

        const acknowledgeValuesAndUpdate = async () => {
            const valuesMessage = postedNamed('updaterValues').at(-1);
            await send({ command: 'updaterValuesRendered', renderSequence: valuesMessage.renderSequence, valuesSequence: valuesMessage.valuesSequence });
            await send({ command: 'updateUpdaterRecords', treeKey: ACCOUNT_TREE_KEY });
        };

        const listAndRestore = async (snapshotName: string) => {
            await send({ command: 'loadUpdaterSnapshots', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence() });
            const snapshotsMessage = postedNamed('updaterSnapshots').at(-1);
            await send({ command: 'updaterSnapshotsRendered', renderSequence: snapshotsMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY, snapshotsSequence: snapshotsMessage.snapshotsSequence });
            await send({ command: 'restoreUpdaterSnapshot', treeKey: ACCOUNT_TREE_KEY, snapshotName: snapshotName });
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-adapter-org-only-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));
            fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields'), { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();
            SalesforceOrgService.clearDescribeCache();

            postedPanelMessages = [];
            queriedSoql = [];
            updateCalls = [];
            generatedRecipeTexts = [];
            currentRegionCodes = {};
            onUpdateRequest = () => undefined;
            describeAnswers = {
                Account: {
                    name: 'Account',
                    updateable: true,
                    fields: [
                        { name: 'Legacy_Code__c', type: 'string', updateable: true },
                        { name: 'Region_Code__c', type: 'string', updateable: true },
                        { name: 'Hologram__c', type: 'string', updateable: true }
                    ]
                },
                Contact: { name: 'Contact', updateable: true, fields: [] },
                OtherChildObject__c: { name: 'OtherChildObject__c', updateable: true, fields: [] }
            };

            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((message: string, options?: { inPanel?: boolean }) => {
                if ( !options?.inPanel ) { return Promise.resolve(undefined); }
                if ( message.startsWith('Generate new values') ) { return Promise.resolve(RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL); }
                if ( message.startsWith('Update ') ) { return Promise.resolve(RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL); }
                if ( message.startsWith('Restore ') ) { return Promise.resolve(RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL); }
                return Promise.resolve(undefined);
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
            jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockImplementation(async () => false);

            // THE RETRIEVE: THE ORG'S FILES UNDER --output-dir, EVERY KIND OF FIELD ONLY IT HOLDS
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockImplementation(async (cliArguments: string[]) => {
                const outputDirectory = cliArguments[cliArguments.indexOf('--output-dir') + 1];
                const stagedFieldsFolder = path.join(workspaceRoot, outputDirectory, 'main', 'default', 'objects', 'Account', 'fields');
                fs.mkdirSync(stagedFieldsFolder, { recursive: true });
                Object.entries(ORG_ONLY_FIELD_FILES).forEach(([fieldApiName, fieldText]) => fs.writeFileSync(path.join(stagedFieldsFolder, `${fieldApiName}.field-meta.xml`), fieldText));
                return { stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), stderr: '', exitCode: 0 };
            });

            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => {
                    queriedSoql.push(soql);
                    if ( /FROM Organization/.test(soql) ) {
                        return { totalSize: 1, done: true, records: [{ IsSandbox: true, OrganizationType: 'Developer Edition' }] };
                    }
                    if ( /FROM SetupAuditTrail/.test(soql) ) {
                        return { totalSize: 0, done: true, records: [] };
                    }
                    const objectApiName = /FROM (\w+)/.exec(soql)![1];
                    const records = Array.from({ length: objectApiName === 'Account' ? 3 : 0 }, (_value, recordIndex) => ({
                        attributes: { type: objectApiName },
                        Id: fakeRecordId(objectApiName, recordIndex),
                        Legacy_Code__c: `OLD-${recordIndex}`,
                        Region_Code__c: currentRegionCodes[fakeRecordId(objectApiName, recordIndex)] ?? null
                    }));
                    return { totalSize: records.length, done: true, records: records };
                },
                queryMore: async () => { throw new Error('no more pages'); },
                tooling: { query: async () => { throw Object.assign(new Error('no source tracking'), { errorCode: 'INVALID_TYPE' }); } },
                describe: async (objectApiName: string) => {
                    if ( !Object.prototype.hasOwnProperty.call(describeAnswers, objectApiName) ) {
                        throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                    }
                    return describeAnswers[objectApiName];
                },
                sobject: (objectApiName: string) => ({
                    update: async (records: any[]) => {
                        onUpdateRequest();
                        updateCalls.push({ objectApiName: objectApiName, records: records });
                        records.forEach(record => { if ( 'Region_Code__c' in record ) { currentRegionCodes[record.Id] = record.Region_Code__c; } });
                        return records.map(record => ({ id: record.Id, success: true, errors: [] }));
                    }
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
                        records: Array.from({ length: recipe.count }, (_value, recordIndex) => ({
                            attributes: { type: recipe.object },
                            ...Object.fromEntries(Object.keys(recipe.fields).map(fieldApiName => [fieldApiName, `${fieldApiName}-new-${recordIndex}`]))
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

        it('posts each field only the org holds with what the recipe\'s backend offers for it, and holds the field models on the host', async () => {

            await openCockpitAndRetrieve();

            const [changesMessage] = postedNamed('adapterMetadataChanges');
            const accountChanges = changesMessage.objects.find((objectChanges: any) => objectChanges.objectApiName === 'Account');
            const offersByName = Object.fromEntries(accountChanges.fieldChanges.map((fieldChange: any) => [fieldChange.fieldApiName, fieldChange.orgOnly]));

            expect(offersByName).toEqual({
                Hologram__c: { fieldTypeWithSize: 'Hologram', note: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE },
                Parent_Link__c: { fieldTypeWithSize: 'Lookup', lockReason: RECIPE_COCKPIT_UPDATER_LOOKUP_REASON },
                Region_Code__c: { fieldTypeWithSize: 'Text(80)', expression: '${{fake.text(max_nb_chars=80)}}' },
                Score_Formula__c: { fieldTypeWithSize: 'Number(18,0)', lockReason: RECIPE_COCKPIT_UPDATER_FORMULA_REASON },
                Sub_Status__c: { fieldTypeWithSize: 'Picklist', lockReason: `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c` },
                Total_Spend__c: { fieldTypeWithSize: 'Summary', lockReason: RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON }
            });
            expect(RecipeCockpitService.readAdapterOrgOnlyFieldApiNames(panelState(), ACCOUNT_TREE_KEY)).toEqual(new Map([['Account', ['Hologram__c', 'Region_Code__c']]]));
            expect(RecipeCockpitService.readAdapterOrgOnlyFieldApiNames(panelState(), 'Lead-ONLY')).toBeUndefined();

        });

        it('loads an unlocked field only the org holds, refuses a locked one, and lets them go with a new model', async () => {

            await openCockpitAndRetrieve();

            expect(RecipeCockpitService.routePanelMessage(loadRequest(['Score_Formula__c']), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

            await send(loadRequest(['Legacy_Code__c', 'Region_Code__c']));
            expect(queriedSoql.find(soql => /FROM Account/.test(soql))).toBe("SELECT Id, ParentId, Legacy_Code__c, Region_Code__c FROM Account");

            panelState().adapterOrgOnlyFields = undefined;
            expect(RecipeCockpitService.routePanelMessage(loadRequest(['Region_Code__c']), panelState())).toMatchObject({ kind: 'refuseUpdaterLoad' });

        });

        it('generates an org-only field from the backend\'s expression for the loaded records, says so, and refuses a typed expression for a fixed-value-only field', async () => {

            await openCockpitAndRetrieve();
            await send(loadRequest(['Legacy_Code__c', 'Region_Code__c', 'Hologram__c']));

            await generate([{ objectApiName: 'Account', fieldApiName: 'Hologram__c', value: '${{ fake.Word }}' }]);
            expect(warnings().at(-1)).toBe(`No values were generated: Account.Hologram__c: ${RECIPE_COCKPIT_ADAPTER_ORG_ONLY_EXPRESSION_REFUSAL}.`);

            await generate([{ objectApiName: 'Account', fieldApiName: 'Hologram__c' }]);
            expect(warnings().at(-1)).toBe(`No values were generated: Account.Hologram__c: ${RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE}`);

            await generate([
                { objectApiName: 'Account', fieldApiName: 'Region_Code__c' },
                { objectApiName: 'Account', fieldApiName: 'Hologram__c', value: 'Shimmer' }
            ]);

            expect(processorSpy).toHaveBeenCalledWith('snowfakery');
            expect(generatedRecipeTexts.map(recipeText => yaml.load(recipeText))).toEqual([
                [{ object: 'Account', nickname: 'Account_Updater_NickName', count: 3, fields: { Region_Code__c: '${{fake.text(max_nb_chars=80)}}' } }]
            ]);
            expect(confirmations().at(-1)[1].detail.split('\n').slice(2)).toEqual([
                'Account: 3 records',
                '  Region_Code__c (only in the org) -- expression the recipe\'s backend writes for its type in the org: ${{fake.text(max_nb_chars=80)}}',
                '  Hologram__c (only in the org) -- fixed value: Shimmer'
            ]);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toEqual([0, 1, 2].map(recordIndex => ({
                recordId: fakeRecordId('Account', recordIndex),
                fieldValues: { Region_Code__c: `Region_Code__c-new-${recordIndex}`, Hologram__c: 'Shimmer' }
            })));

        });

        it('holds a typed value for an org-only picklist to the values its staged file lists', async () => {

            ORG_ONLY_FIELD_FILES['Tier__c'] = fieldXml('Tier__c', 'Picklist', '    <valueSet><valueSetDefinition><value><fullName>Gold</fullName><label>Gold</label></value></valueSetDefinition></valueSet>');
            try {
                await openCockpitAndRetrieve();
                await send(loadRequest(['Tier__c']));

                await generate([{ objectApiName: 'Account', fieldApiName: 'Tier__c', value: 'Platinum' }]);
                expect(warnings().at(-1)).toMatch(/^No values were generated: Account\.Tier__c: .*Platinum/);
                expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();

                await generate([{ objectApiName: 'Account', fieldApiName: 'Tier__c', value: 'Gold' }]);
                expect(RecipeCockpitService.readHeldUpdaterValues('Account')?.[0].fieldValues).toEqual({ Tier__c: 'Gold' });
            } finally {
                delete ORG_ONLY_FIELD_FILES['Tier__c'];
            }

        });

        it('locks a field only the org holds when the card has no recipe file to read its backend from', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            panelState().treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.delete(ACCOUNT_TREE_KEY);

            await send({ command: 'retrieveAdapterMetadata', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), parentObjectApiName: 'Account' });

            const accountChanges = postedNamed('adapterMetadataChanges')[0].objects.find((objectChanges: any) => objectChanges.objectApiName === 'Account');
            expect(accountChanges.fieldChanges.find((fieldChange: any) => fieldChange.fieldApiName === 'Region_Code__c').orgOnly).toEqual({ fieldTypeWithSize: 'Text(80)', lockReason: RECIPE_COCKPIT_ADAPTER_ORG_ONLY_NO_RECIPE_REASON });
            expect(RecipeCockpitService.readAdapterOrgOnlyFieldApiNames(panelState(), ACCOUNT_TREE_KEY)).toEqual(new Map());

        });

        it('generates an org-only field\'s values with the real faker-js processor, one per loaded record', async () => {

            processorSpy.mockRestore();
            jest.spyOn(VSCodeWorkspaceService, 'readRecipeFakerService').mockReturnValue('faker-js');
            await openCockpitAndRetrieve();

            const accountChanges = postedNamed('adapterMetadataChanges')[0].objects.find((objectChanges: any) => objectChanges.objectApiName === 'Account');
            expect(accountChanges.fieldChanges.find((fieldChange: any) => fieldChange.fieldApiName === 'Region_Code__c').orgOnly.expression).toBe('${{ faker.lorem.text(80).substring(0, 80) }}');

            await send(loadRequest(['Region_Code__c']));
            await generate([{ objectApiName: 'Account', fieldApiName: 'Region_Code__c' }]);

            const heldValues = RecipeCockpitService.readHeldUpdaterValues('Account')!;
            expect(heldValues.map(recordValues => recordValues.recordId)).toEqual([0, 1, 2].map(recordIndex => fakeRecordId('Account', recordIndex)));
            heldValues.forEach(recordValues => {
                expect(typeof recordValues.fieldValues.Region_Code__c).toBe('string');
                expect(String(recordValues.fieldValues.Region_Code__c).length).toBeWithin(1, 81);
            });

        });

        it('updates only the org the records were loaded from, after a snapshot that names the fields only the org held, and records them in the results', async () => {

            await openCockpitAndRetrieve();
            await send(loadRequest(['Legacy_Code__c', 'Region_Code__c']));
            await generate([{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }, { objectApiName: 'Account', fieldApiName: 'Region_Code__c' }]);

            selectOrg(OTHER_SANDBOX_ORG);
            await acknowledgeValuesAndUpdate();
            expect(updateCalls).toEqual([]);
            expect(warnings().at(-1)).toContain('were loaded from qa@example.com.qa, not uat · uat@example.com.uat');

            selectOrg(SANDBOX_ORG);
            // THE SNAPSHOT IS ON DISK BEFORE THE FIRST REQUEST IS SENT
            const snapshotFilesAtFirstRequest: string[][] = [];
            onUpdateRequest = () => snapshotFilesAtFirstRequest.push(attemptFiles());
            await acknowledgeValuesAndUpdate();

            expect(snapshotFilesAtFirstRequest[0].filter(fileName => fileName.endsWith('-before.json'))).toHaveLength(1);
            expect(updateCalls).toEqual([{
                objectApiName: 'Account',
                records: [0, 1, 2].map(recordIndex => ({ attributes: { type: 'Account' }, Id: fakeRecordId('Account', recordIndex), Legacy_Code__c: `Legacy_Code__c-new-${recordIndex}`, Region_Code__c: `Region_Code__c-new-${recordIndex}` }))
            }]);
            const [snapshot] = readAttemptFiles('-before.json');
            expect(snapshot.objects).toEqual([{
                objectApiName: 'Account',
                fieldApiNames: ['Legacy_Code__c', 'Region_Code__c'],
                orgOnlyFieldApiNames: ['Region_Code__c'],
                records: [0, 1, 2].map(recordIndex => ({ recordId: fakeRecordId('Account', recordIndex), fieldValues: { Legacy_Code__c: `OLD-${recordIndex}`, Region_Code__c: null } }))
            }]);
            const [results] = readAttemptFiles('-results.json');
            expect(results).toMatchObject({ outcome: 'completed', updatedRecordCount: 3, orgOnlyFields: { Account: ['Region_Code__c'] } });

        });

        it('records no org-only fields in the results of an update that wrote none', async () => {

            await openCockpitAndRetrieve();
            await send(loadRequest(['Legacy_Code__c']));
            await generate([{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]);
            await acknowledgeValuesAndUpdate();

            const [results] = readAttemptFiles('-results.json');
            expect(results).not.toHaveProperty('orgOnlyFields');
            expect(readAttemptFiles('-before.json')[0].objects[0]).not.toHaveProperty('orgOnlyFieldApiNames');

        });

        it('restores the values a field only the org held had, from a later model with no retrieve, and saves what it holds now first', async () => {

            await openCockpitAndRetrieve();
            await send(loadRequest(['Region_Code__c']));
            await generate([{ objectApiName: 'Account', fieldApiName: 'Region_Code__c' }]);
            await acknowledgeValuesAndUpdate();
            const [updateSnapshotName] = attemptFiles().filter(fileName => fileName.endsWith('-before.json'));
            expect(currentRegionCodes[fakeRecordId('Account', 0)]).toBe('Region_Code__c-new-0');

            // A REOPEN DRAWS A NEW MODEL: THE RETRIEVE'S OFFER IS GONE, AND THE SNAPSHOT IS WHAT SAYS THE FIELD WAS ONLY THE ORG'S
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            expect(panelState().adapterOrgOnlyFields).toBeUndefined();
            updateCalls = [];

            await listAndRestore(updateSnapshotName);

            expect(updateCalls).toEqual([{
                objectApiName: 'Account',
                records: [0, 1, 2].map(recordIndex => ({ attributes: { type: 'Account' }, Id: fakeRecordId('Account', recordIndex), Region_Code__c: null }))
            }]);
            expect(currentRegionCodes[fakeRecordId('Account', 0)]).toBeNull();
            const restoreSnapshot = readAttemptFiles('-before.json').find(snapshot => snapshot.takenAt !== undefined && snapshot.objects[0].records[0].fieldValues.Region_Code__c === 'Region_Code__c-new-0');
            expect(restoreSnapshot.objects[0].orgOnlyFieldApiNames).toEqual(['Region_Code__c']);
            expect(readAttemptFiles('-results.json').find(results => results.operation === 'restore')).toMatchObject({ outcome: 'completed', orgOnlyFields: { Account: ['Region_Code__c'] } });

        });

        it('restores a field a snapshot marks as only the org\'s that the recipe lists now, by the recipe\'s own lock', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            fs.mkdirSync(attemptsFolderPath(), { recursive: true });
            fs.writeFileSync(path.join(attemptsFolderPath(), '20261024-100000-before.json'), JSON.stringify({
                orgUsername: SANDBOX_ORG.username,
                treeFolderName: ACCOUNT_TREE_KEY,
                takenAt: '2026-10-24T10:00:00.000Z',
                objects: [{ objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'], orgOnlyFieldApiNames: ['Legacy_Code__c'], records: [{ recordId: fakeRecordId('Account', 0), fieldValues: { Legacy_Code__c: 'BEFORE' } }] }]
            }));

            await listAndRestore('20261024-100000-before.json');

            expect(updateCalls).toEqual([{ objectApiName: 'Account', records: [{ attributes: { type: 'Account' }, Id: fakeRecordId('Account', 0), Legacy_Code__c: 'BEFORE' }] }]);

        });

        it('refuses to restore a field only the org held that the org now says is a lookup, and one the snapshot does not mark as only the org\'s', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            selectOrg(SANDBOX_ORG);
            (describeAnswers.Account as any).fields.push({ name: 'Parent_Link__c', type: 'reference', referenceTo: ['Account'], updateable: true });

            const writeSnapshot = (fileName: string, objectOverrides: Record<string, unknown>) => {
                fs.mkdirSync(attemptsFolderPath(), { recursive: true });
                fs.writeFileSync(path.join(attemptsFolderPath(), fileName), JSON.stringify({
                    orgUsername: SANDBOX_ORG.username,
                    treeFolderName: ACCOUNT_TREE_KEY,
                    takenAt: '2026-10-24T10:00:00.000Z',
                    objects: [{ objectApiName: 'Account', records: [{ recordId: fakeRecordId('Account', 0), fieldValues: { Parent_Link__c: null } }], fieldApiNames: ['Parent_Link__c'], ...objectOverrides }]
                }));
            };
            writeSnapshot('20261024-100000-before.json', { orgOnlyFieldApiNames: ['Parent_Link__c'] });
            writeSnapshot('20261024-100001-before.json', {});

            await listAndRestore('20261024-100000-before.json');
            expect(warnings().at(-1)).toBe(`Nothing was restored: 20261024-100000-before.json names Account.Parent_Link__c, which the Treecipe Adapter does not write: ${RECIPE_COCKPIT_UPDATER_LOOKUP_REASON}.`);

            await listAndRestore('20261024-100001-before.json');
            expect(warnings().at(-1)).toBe('Nothing was restored: 20261024-100001-before.json names Account.Parent_Link__c, which the Treecipe Adapter does not write: it is not a field of the object in this run.');

            expect(updateCalls).toEqual([]);

        });

    });

    describe('the panel script', () => {

        const recipe = loadTreeRecipe();
        const offered = RecipeCockpitService.offerAdapterOrgOnlyFields(recipe, recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!, newFieldChanges([
            newFieldDetail('Region_Code__c', { length: 80 }),
            newFieldDetail('Score_Formula__c', { fieldType: 'Number', isFormula: true }),
            newFieldDetail('Hologram__c', { fieldType: 'Hologram' })
        ]), [
            newFieldDetail('Region_Code__c', { length: 80 }),
            newFieldDetail('Score_Formula__c', { fieldType: 'Number', isFormula: true }),
            newFieldDetail('Hologram__c', { fieldType: 'Hologram' })
        ], 'snowfakery');

        const openUpdaterTab = (panel: any) => {
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const card = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openAdapterStructure(card, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(card, 'treeUpdater')[0];
            panel.postToPanel({ command: 'adapterMetadataChanges', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa · qa@example.com.qa', objects: offered.objects });
            const accountObject = panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
            panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].dispatch('click');
            const rowNamed = (fieldApiName: string) => panel.findAll(accountObject, 'updaterOrgOnlyField')
                .find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);
            return { card: updaterPanel, accountObject: accountObject, rowNamed: rowNamed };
        };

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('draws a field only the org holds as a row to choose, its expression, a locked one with its reason and a fixed-value-only one with its note', () => {

            const panel = runPanelScript();
            const { rowNamed } = openUpdaterTab(panel);

            const regionRow = rowNamed('Region_Code__c');
            const regionChoose = panel.findAll(regionRow, 'updaterFieldChoose')[0];
            expect(regionChoose.disabled).toBe(false);
            expect(panel.findAll(regionRow, 'expression')[0].textContent).toBe('${{fake.text(max_nb_chars=80)}}');
            expect(panel.findAll(regionRow, 'fieldType')[0].textContent).toBe('Text(80)');
            expect(panel.findAll(regionRow, 'updaterFieldNote').map((noteElement: any) => noteElement.textContent)).toEqual([RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE]);
            expect(panel.findAll(regionRow, 'updaterFieldEdit')).toHaveLength(1);

            const formulaRow = rowNamed('Score_Formula__c');
            expect(panel.findAll(formulaRow, 'updaterFieldChoose')[0].disabled).toBe(true);
            expect(panel.findAll(formulaRow, 'updaterFieldNote').map((noteElement: any) => noteElement.textContent)).toEqual([RECIPE_COCKPIT_UPDATER_FORMULA_REASON, RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE]);
            expect(panel.findAll(formulaRow, 'updaterFieldEdit')).toHaveLength(0);

            const hologramRow = rowNamed('Hologram__c');
            expect(panel.findAll(hologramRow, 'updaterFieldChoose')[0].disabled).toBe(false);
            expect(panel.findAll(hologramRow, 'expression')).toHaveLength(0);
            expect(panel.findAll(hologramRow, 'updaterOrgOnlyFixedNote')[0].textContent).toBe(RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE);

        });

        it('posts a chosen field only the org holds with the load and, with any value typed, with Generate values', () => {

            const panel = runPanelScript();
            const { card, rowNamed } = openUpdaterTab(panel);

            panel.findAll(rowNamed('Region_Code__c'), 'updaterFieldChoose')[0].dispatch('click');
            panel.findAll(rowNamed('Hologram__c'), 'updaterFieldChoose')[0].dispatch('click');
            panel.findAll(card, 'updaterLoad')[0].dispatch('click');

            const loadMessage = postedNamed(panel, 'loadUpdaterRecords').at(-1);
            expect(loadMessage.objects.find((loadObject: any) => loadObject.objectApiName === 'Account').fieldApiNames).toEqual(['Region_Code__c', 'Hologram__c']);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            panel.postToPanel({
                command: 'updaterRecords',
                renderSequence: 1,
                treeKey: ACCOUNT_TREE_KEY,
                orgLabel: 'qa',
                objects: [{ objectApiName: 'Account', totalSize: 3, recordCount: 3, isTruncated: false, columns: ['Id'], rows: [], hiddenColumnCount: 0 }]
            });

            const hologramRow = rowNamed('Hologram__c');
            panel.findAll(hologramRow, 'updaterFieldEdit')[0].dispatch('click');
            const editorInput = panel.findAll(hologramRow, 'fieldEditorInput')[0];
            editorInput.value = 'Shimmer';
            panel.findAll(hologramRow, 'fieldEditorSave')[0].dispatch('click');
            panel.findAll(card, 'updaterGenerate')[0].dispatch('click');

            const generateMessage = postedNamed(panel, 'generateUpdaterValues').at(-1);
            expect(generateMessage.fields).toEqual([
                { objectApiName: 'Account', fieldApiName: 'Region_Code__c' },
                { objectApiName: 'Account', fieldApiName: 'Hologram__c', value: 'Shimmer' }
            ]);

        });

        it('lets another card\'s offer go when this card retrieves, since the host holds one retrieve', () => {

            const panel = runPanelScript();
            const { card, rowNamed } = openUpdaterTab(panel);
            panel.findAll(rowNamed('Region_Code__c'), 'updaterFieldChoose')[0].dispatch('click');
            expect(panel.findAll(card, 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');

            panel.postToPanel({ command: 'adapterMetadataChanges', renderSequence: 1, treeKey: 'Lead-ONLY', orgLabel: 'qa', objects: [] });

            expect(rowNamed('Region_Code__c')).toBeUndefined();
            expect(panel.findAll(card, 'updaterSummary')[0].textContent).not.toBe('1 field chosen on 1 object');
            expect(panel.findAll(card, 'updaterOrgChangesNote')[0].classList.contains('hidden')).toBe(true);

        });

        it('lets a choice go when the next retrieve no longer offers the field', () => {

            const panel = runPanelScript();
            const { card, rowNamed } = openUpdaterTab(panel);

            panel.findAll(rowNamed('Region_Code__c'), 'updaterFieldChoose')[0].dispatch('click');
            expect(panel.findAll(card, 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');

            panel.postToPanel({ command: 'adapterMetadataChanges', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: [] });
            expect(panel.findAll(card, 'updaterSummary')[0].textContent).not.toBe('1 field chosen on 1 object');

        });

    });

});
