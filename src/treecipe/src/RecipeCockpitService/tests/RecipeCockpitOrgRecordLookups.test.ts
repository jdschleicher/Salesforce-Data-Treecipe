import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showQuickPick: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL,
    RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL,
    RECIPE_COCKPIT_ORG_RECORD_TYPED_VALUE_REFUSAL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitFixedValueStore } from '../RecipeCockpitFixedValueStore';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    An empty lookup's two decisions (#421): "Create <Parent> in recipe" (#294's addition) and "Use
    existing <Parent> from org…", which pins an existing record's Id through the fixed-value path
    (#342) with the org it came from kept beside it. The tree insert's half -- the Id kept and checked
    in the org inserted into, and no parent picker -- is asserted in RecipeCockpitTreeInsert.test.ts.

    The tree is Account, User and Opportunity (lookup targets with no recipe) and Contact, as in
    RecipeCockpitAddParentObjectPanel.test.ts: AccountId can be created; Owner__c points at User, which
    has no template; Related__c can name Account or Opportunity; ReportsToId is a self-lookup.
*/

const TODO = '### TODO -- REFERENCE ID REQUIRED';
const TREE_OBJECTS = ['Account', 'User', 'Opportunity', 'Contact'];
const TREE_KEY = RelationshipService.buildRecipeTreeFolderName(TREE_OBJECTS);
const ACCOUNT_ID = '001000000000011AAA';
const ACCOUNT_ID_15 = '001000000000011';

const RECIPE_TEXT = [
    '# Relationship Tree: RelationshipTree_1',
    '',
    '# Contact (Parents: Account, Contact, Opportunity, User)',
    '- object: Contact',
    '  nickname: Contact_NickName',
    '  count: 2',
    '  fields:',
    '    LastName: ${{ faker.person.lastName() }}',
    `    AccountId: ${TODO}`,
    `    ReportsToId: ${TODO}`,
    `    Owner__c: ${TODO}`,
    `    Related__c: ${TODO}`,
    ''
].join('\n');

const buildWrapperField = (objectApiName: string, fieldApiName: string, fieldType: string) => ({
    objectName: objectApiName, fieldName: fieldApiName, fieldLabel: fieldApiName, type: fieldType, recipeValue: fieldType === 'Lookup' ? TODO : ''
});

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        User: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        Opportunity: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        Contact: {
            Fields: [
                buildWrapperField('Contact', 'LastName', 'Text'),
                buildWrapperField('Contact', 'AccountId', 'Lookup'),
                buildWrapperField('Contact', 'ReportsToId', 'Lookup'),
                buildWrapperField('Contact', 'Owner__c', 'Lookup'),
                buildWrapperField('Contact', 'Related__c', 'Lookup')
            ],
            RelationshipDetail: {
                level: 1,
                parentObjectToFieldReferences: { Account: ['AccountId', 'Related__c'], Contact: ['ReportsToId'], User: ['Owner__c'], Opportunity: ['Related__c'] }
            }
        }
    },
    RecipeFiles: [{ objects: TREE_OBJECTS }]
};

const ACCOUNT_LOOKUP = { objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiName: 'Account' };
const USE_ACCOUNT_MESSAGE = { command: 'useOrgRecordForLookup', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'AccountId' };
const NOTHING_RUNS = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };
const DEV_ORG = { targetOrgIdentifier: 'dev', username: 'dev@example.com', alias: 'dev' };

const BACKENDS: ReadonlyArray<[string, string]> = [
    ['faker-js', 'recipe-fakerjs-2026-10-01T00-00-00'],
    ['snowfakery', 'recipe-2026-10-01T00-00-00']
];

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitRecipeWriter.listEmptyLookups (#421)', () => {

    const LOOKUP_CONTEXT = {
        parentLookupsByObjectApiName: new Map([['Contact', [
            { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
            { fieldApiName: 'Related__c', parentObjectApiName: 'Account' },
            { fieldApiName: 'Related__c', parentObjectApiName: 'Opportunity' },
            { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' },
            { fieldApiName: 'Owner__c', parentObjectApiName: 'User' }
        ]]]),
        levelsByObjectApiName: new Map([['Account', 0], ['User', 0], ['Opportunity', 0], ['Contact', 1]])
    };
    const TEMPLATES = new Set(['Account', 'Contact', 'Lead', 'Opportunity', 'Case']);

    it('lists every TODO lookup to one parent in file order, each with why Create would be refused, and no polymorphic one', () => {

        expect(RecipeCockpitRecipeWriter.listEmptyLookups(RECIPE_TEXT, LOOKUP_CONTEXT, TEMPLATES)).toEqual([
            { ...ACCOUNT_LOOKUP },
            { objectApiName: 'Contact', fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact', createRefusalReason: 'parent-object-already-exists' },
            { objectApiName: 'Contact', fieldApiName: 'Owner__c', parentObjectApiName: 'User', createRefusalReason: 'no-parent-template' }
        ]);

    });

    it('agrees with listAddableParentObjects: exactly the lookups with no createRefusal can be added', () => {

        const addable = RecipeCockpitRecipeWriter.listAddableParentObjects(RECIPE_TEXT, LOOKUP_CONTEXT, TEMPLATES);
        const creatable = RecipeCockpitRecipeWriter.listEmptyLookups(RECIPE_TEXT, LOOKUP_CONTEXT, TEMPLATES).filter(emptyLookup => emptyLookup.createRefusalReason === undefined);

        expect(creatable.map(({ objectApiName, fieldApiName, parentObjectApiName }) => ({ objectApiName, fieldApiName, parentObjectApiName }))).toEqual(addable);

    });

    it('lists no lookup that is already set, wired or pinned', () => {

        const filledText = RECIPE_TEXT
            .replace(`AccountId: ${TODO}`, `AccountId: "${ACCOUNT_ID}"`)
            .replace(`Owner__c: ${TODO}`, 'Owner__c: User_NickName');

        expect(RecipeCockpitRecipeWriter.listEmptyLookups(filledText, LOOKUP_CONTEXT, TEMPLATES).map(emptyLookup => emptyLookup.fieldApiName)).toEqual(['ReportsToId']);

    });

    it('lists a lookup the card does not name for that object as nothing, and accepts a nested tree\'s " -- <Parent>" TODO', () => {

        const nestedText = RECIPE_TEXT.replace(`AccountId: ${TODO}`, `AccountId: ${TODO} -- Account`);

        expect(RecipeCockpitRecipeWriter.listEmptyLookups(nestedText, LOOKUP_CONTEXT, TEMPLATES)[0]).toEqual(ACCOUNT_LOOKUP);
        expect(RecipeCockpitRecipeWriter.listEmptyLookups(RECIPE_TEXT, { parentLookupsByObjectApiName: new Map() }, TEMPLATES)).toEqual([]);

    });

    it('refuses an org record on an object written twice when another occurrence already sets the field, since a pin writes every occurrence', () => {

        const iteratedText = [
            '- object: Contact',
            '  nickname: Contact_NickName',
            '  count: 1',
            '  fields:',
            `    ReportsToId: ${TODO}`,
            '  friends:',
            '    - object: Contact',
            '      nickname: Contact_child_NickName',
            '      count: 1',
            '      fields:',
            '        ReportsToId: Contact_NickName',
            ''
        ].join('\n');

        expect(RecipeCockpitRecipeWriter.listEmptyLookups(iteratedText, LOOKUP_CONTEXT, TEMPLATES)).toEqual([{
            objectApiName: 'Contact',
            objectNickname: 'Contact_NickName',
            fieldApiName: 'ReportsToId',
            parentObjectApiName: 'Contact',
            createRefusalReason: 'parent-object-already-exists',
            orgRecordRefusal: 'The recipe writes Contact 2 times and ReportsToId is already set on 1 of them; an org record is written on every one, so it would replace that value.'
        }]);

    });

});

describe('RecipeCockpitFixedValueStore, an org record beside a pinned Id (#421)', () => {

    const ORG_RECORD = { orgUsername: 'dev@example.com', orgAlias: 'dev', parentObjectApiName: 'Account' };
    const pinnedEntry = () => {
        const pinResult = RecipeCockpitRecipeWriter.pinField(RECIPE_TEXT, 'Contact', 'AccountId', { value: ACCOUNT_ID, kind: 'text' });
        if ( 'refusal' in pinResult ) { throw new Error(pinResult.refusal.message); }
        return { objectApiName: 'Contact', fieldApiName: 'AccountId', value: ACCOUNT_ID, orgRecord: ORG_RECORD, occurrences: pinResult.occurrences };
    };

    it('round-trips the org record, written right after the value', () => {

        const serialized = RecipeCockpitFixedValueStore.serialize([pinnedEntry()]);

        expect(RecipeCockpitFixedValueStore.parse(serialized)).toEqual({ entries: [pinnedEntry()], isUnreadable: false });
        expect(serialized.indexOf('"orgRecord"')).toBeGreaterThan(serialized.indexOf('"value"'));
        expect(serialized.indexOf('"orgRecord"')).toBeLessThan(serialized.indexOf('"occurrences"'));

    });

    it('keeps an org record with no alias', () => {

        const { orgAlias: _orgAlias, ...noAlias } = ORG_RECORD;
        const parsed = RecipeCockpitFixedValueStore.parse(RecipeCockpitFixedValueStore.serialize([{ ...pinnedEntry(), orgRecord: noAlias }]));

        expect(parsed.entries[0].orgRecord).toEqual(noAlias);

    });

    it.each([
        ['a value that is not a Salesforce Id', { value: 'not-an-id' }, undefined],
        ['an org named across two lines', {}, { orgUsername: 'dev@example.com\nEvil__c: x' }],
        ['an empty username', {}, { orgUsername: '' }],
        ['an alias that is not text', {}, { orgAlias: 7 }],
        ['a parent that is not an api name', {}, { parentObjectApiName: 'Account; DELETE' }],
        ['an org record that is not an object', {}, 'dev']
    ])('drops the org record for %s, so the entry reads as a plain fixed value', (_description, entryOverride, orgRecordOverride) => {

        const storedEntry: any = { ...pinnedEntry(), ...entryOverride };
        storedEntry.orgRecord = typeof orgRecordOverride === 'string' ? orgRecordOverride : { ...ORG_RECORD, ...( orgRecordOverride ?? {} ) };
        // A WRITTEN LINE MUST BE THE ONE ITS VALUE WRITES, SO A CHANGED VALUE GETS ITS OWN LINE
        storedEntry.occurrences = storedEntry.occurrences.map((occurrence: any) => ({ ...occurrence, writtenLine: `    AccountId: "${storedEntry.value}"` }));

        const parsed = RecipeCockpitFixedValueStore.parse(JSON.stringify({ version: 1, fields: [storedEntry] }));

        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0]).not.toHaveProperty('orgRecord');

    });

    it('keeps the org record of the newest pin, and a typed pin over it carries none', () => {

        const withOrgRecord = RecipeCockpitFixedValueStore.upsertEntry([], pinnedEntry());
        const { orgRecord: _orgRecord, ...typedEntry } = pinnedEntry();

        expect(withOrgRecord[0].orgRecord).toEqual(ORG_RECORD);
        expect(RecipeCockpitFixedValueStore.upsertEntry(withOrgRecord, typedEntry)[0]).not.toHaveProperty('orgRecord');

    });

    it('tells a Salesforce Id from anything else', () => {

        expect([ACCOUNT_ID, ACCOUNT_ID_15, '001', `${ACCOUNT_ID}X`, '001000000000011A!A', 7].map(candidate => RecipeCockpitFixedValueStore.isSalesforceRecordId(candidate))).toEqual([true, true, false, false, false, false]);

    });

});

describe.each(BACKENDS)('RecipeCockpitService, "Use existing <Parent> from org…" on a %s recipe (#421)', (backendName, runFolderName) => {

    let workspaceRoot: string;
    let recipeFilePath: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-org-record-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', runFolderName);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        const recipePrefix = backendName === 'faker-js' ? 'recipe-fakerjs' : 'recipe';
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `${recipePrefix}--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        fs.writeFileSync(recipeFilePath, RECIPE_TEXT);
        SalesforceOrgService.clearDescribeCache();

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
        SalesforceOrgService.clearDescribeCache();
    });

    // THE MODEL AS THE PANEL'S LOAD POSTS IT: THE PINS THE FIXED-VALUES FILE HOLDS APPLIED TO THE CARDS
    const loadModel = (): IRecipeCockpitRecipeViewModel => {
        const generatedRecipesFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes');
        const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(RecipeCockpitService.findGeneratedRecipeRuns(generatedRecipesFolderPath), workspaceRoot);
        RecipeCockpitService.applyTreeSelections(loadedRecipe.recipeViewModel, RecipeCockpitService.withPinnedFixedValues(RecipeCockpitService.readTreeSelections(undefined), loadedRecipe.pinnedFixedValuesByFolderName));
        return loadedRecipe.recipeViewModel;
    };
    const treeOf = (recipeViewModel: IRecipeCockpitRecipeViewModel) => recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === TREE_KEY);

    const buildActivePanelState = (recipeViewModel = loadModel()): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 };
        panelState.pendingOrgRecordLookupTargets = RecipeCockpitService.collectOrgRecordLookupTargets(recipeViewModel, new Map([[TREE_KEY, recipeFilePath]]));
        panelState.orgRecordLookupTargets = panelState.pendingOrgRecordLookupTargets;
        return panelState;
    };

    // WHAT "Use existing Account from org…" WRITES: THE PINNED LINE AND THE FIXED-VALUES FILE WITH THE ORG BESIDE IT
    const writeOrgRecordPin = (recordId = ACCOUNT_ID, orgRecord: any = { orgUsername: DEV_ORG.username, orgAlias: DEV_ORG.alias, parentObjectApiName: 'Account' }) => {
        const pinResult = RecipeCockpitRecipeWriter.pinField(RECIPE_TEXT, 'Contact', 'AccountId', { value: recordId, kind: 'text' });
        if ( 'refusal' in pinResult ) { throw new Error(pinResult.refusal.message); }
        fs.writeFileSync(recipeFilePath, pinResult.recipeText);
        fs.writeFileSync(RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath), RecipeCockpitFixedValueStore.serialize([{
            objectApiName: 'Contact', fieldApiName: 'AccountId', value: recordId, orgRecord: orgRecord, occurrences: pinResult.occurrences
        }]));
    };

    describe('the model', () => {

        it('lists the card\'s empty lookups to one parent, and maps each enabled "Use existing" to the card\'s recipe file, host-only', () => {

            const recipeViewModel = loadModel();

            expect(treeOf(recipeViewModel).emptyLookups.map(emptyLookup => [emptyLookup.fieldApiName, emptyLookup.parentObjectApiName, !!emptyLookup.createRefusalReason]))
                .toEqual([['AccountId', 'Account', false], ['ReportsToId', 'Contact', true], ['Owner__c', 'User', true]]);
            expect([...RecipeCockpitService.collectOrgRecordLookupTargets(recipeViewModel, new Map([[TREE_KEY, recipeFilePath]])).keys()])
                .toEqual([`${TREE_KEY}\nContact\n\nAccountId`, `${TREE_KEY}\nContact\n\nReportsToId`, `${TREE_KEY}\nContact\n\nOwner__c`]);
            expect(RecipeCockpitService.collectOrgRecordLookupTargets(recipeViewModel, new Map()).size).toBe(0);
            expect(RecipeCockpitService.listTreeEmptyLookups(path.join(workspaceRoot, 'missing.yml'), treeOf(recipeViewModel), undefined)).toEqual([]);

        });

        it('draws a pinned org record as the card\'s fixed value with the org it came from, and no longer as an empty lookup', () => {

            writeOrgRecordPin();
            const tree = treeOf(loadModel());

            expect(tree.orgRecordLookups).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', recordId: ACCOUNT_ID, parentObjectApiName: 'Account', orgLabel: 'dev' }]);
            expect(tree.fixedValues).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', value: ACCOUNT_ID, kind: 'text', orgRecord: { orgLabel: 'dev', parentObjectApiName: 'Account' } }]);
            expect(tree.emptyLookups.map(emptyLookup => emptyLookup.fieldApiName)).toEqual(['ReportsToId', 'Owner__c']);

        });

        it('draws a stored org record whose parent is not the field\'s tree parent as nothing, since the insert checks the Id as a record of it', () => {

            writeOrgRecordPin(ACCOUNT_ID, { orgUsername: DEV_ORG.username, parentObjectApiName: 'User' });
            const tree = treeOf(loadModel());

            expect(tree.orgRecordLookups).toHaveLength(1);
            expect(tree).not.toHaveProperty('fixedValues');

        });

        it('labels the org by its username when it has no alias', () => {

            writeOrgRecordPin(ACCOUNT_ID, { orgUsername: DEV_ORG.username, parentObjectApiName: 'Account' });

            expect(treeOf(loadModel()).fixedValues[0].orgRecord).toEqual({ orgLabel: DEV_ORG.username, parentObjectApiName: 'Account' });

        });

        it('draws a typed value on a lookup as nothing: a lookup takes only an org record', () => {

            writeOrgRecordPin(ACCOUNT_ID, null);
            const tree = treeOf(loadModel());

            expect(tree).not.toHaveProperty('orgRecordLookups');
            expect(tree).not.toHaveProperty('fixedValues');

        });

        it('lets a lookup hold a value only as an org record, and still holds back every other lock', () => {

            const recipeViewModel = loadModel();
            const tree = treeOf(recipeViewModel);
            const contact = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact');
            const accountId = contact.fields.find(field => field.fieldApiName === 'AccountId');

            expect(RecipeCockpitService.findFixedValueLockReason(tree, contact, accountId)).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(RecipeCockpitService.findFixedValueLockReason(tree, contact, accountId, true)).toBeUndefined();

            tree.objectSelection = { exclusions: [{ objectApiName: 'Contact', isDirect: true } as any], disabledLookups: [], includedObjectCount: 0, objectCount: 1 };
            expect(RecipeCockpitService.findFixedValueLockReason(tree, contact, accountId, true)).toBe(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON);

        });

        PythonTestHarness.testRequiringModules('yaml')(`loads the pinned Id as a string in PyYAML, snowfakery's parser, and in js-yaml`, () => {

            writeOrgRecordPin();
            const recipeText = fs.readFileSync(recipeFilePath, 'utf-8');

            expect(recipeText).toContain(`    AccountId: "${ACCOUNT_ID}"`);
            expect((yaml.load(recipeText) as any[])[0].fields.AccountId).toBe(ACCOUNT_ID);
            const [pyYamlLoaded] = PythonTestHarness.loadWithPyYaml([recipeText]) as any[][];
            expect(pyYamlLoaded[0].fields.AccountId).toBe(ACCOUNT_ID);

        });

    });

    describe('routePanelMessage', () => {

        it('routes by names to the host-only recipe file, never a path, org or Id the message carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...USE_ACCOUNT_MESSAGE, filePath: '/etc/passwd', recordId: '001EVIL', username: 'prod@example.com' } as any, buildActivePanelState())).toEqual({
                kind: 'useOrgRecordForLookup',
                treeKey: TREE_KEY,
                recipeFilePath: recipeFilePath,
                emptyLookup: ACCOUNT_LOOKUP
            });

        });

        it.each([
            ['until the panel has confirmed drawing the model', (panelState: IRecipeCockpitPanelState) => { panelState.orgRecordLookupTargets = new Map(); }, {}],
            ['a polymorphic lookup', () => undefined, { fieldApiName: 'Related__c' }],
            ['a field that is not a lookup', () => undefined, { fieldApiName: 'LastName' }],
            ['an occurrence nickname the row does not draw', () => undefined, { objectNickname: 'Contact_NickName' }],
            ['another card', () => undefined, { treeKey: 'Lead-ONLY' }],
            ['a field that is not a string', () => undefined, { fieldApiName: ['AccountId'] }],
            ['while the model is not on screen', (panelState: IRecipeCockpitPanelState) => { panelState.recipeDataMessage = undefined; }, {}],
            ['while a friend is being added', (panelState: IRecipeCockpitPanelState) => { panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true }; }, {}]
        ])('refuses %s', (_description, adjust, override) => {

            const panelState = buildActivePanelState();
            adjust(panelState);

            expect(RecipeCockpitService.routePanelMessage({ ...USE_ACCOUNT_MESSAGE, ...override }, panelState)).toEqual(NOTHING_RUNS);

        });

        it('shares the one recipe write lock', () => {

            const panelState = buildActivePanelState();
            panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };

            expect(RecipeCockpitService.routePanelMessage(USE_ACCOUNT_MESSAGE, panelState)).toBeUndefined();

        });

        it('routes a Clear of an org record, and a typed value only so the executor can refuse it', () => {

            writeOrgRecordPin();
            const panelState = buildActivePanelState();
            panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(panelState.recipeDataMessage.recipe, new Map([[TREE_KEY, recipeFilePath]]));
            const clearMessage = { command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'AccountId', value: '' };

            expect(RecipeCockpitService.routePanelMessage(clearMessage, panelState)).toMatchObject({ kind: 'setFieldFixedValue', value: '' });
            expect(RecipeCockpitService.routePanelMessage({ ...clearMessage, fieldApiName: 'Owner__c', value: '005000000000001AAA' }, panelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel, the write', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let showWarningMessageSpy: jest.SpyInstance;
        let showInformationMessageSpy: jest.SpyInstance;
        let promptForOrgSpy: jest.SpyInstance;
        let promptForParentRecordSpy: jest.SpyInstance;
        let connection: any;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const lastModel = (): IRecipeCockpitRecipeViewModel => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData').recipe;
        const fixedValueFilePath = () => RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);

        const openRenderedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;
        };

        const chooseHow = (label: string) => (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (items: any[]) => items.find(item => item.label === label));

        beforeEach(() => {

            postedPanelMessages = [];

            const fakeWebviewPanel = {
                visible: true,
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            };

            // THESE LIVE ON THE MODULE FACTORY RATHER THAN ON A SPY, SO restoreMocks DOES NOT REACH THEM
            (vscode.window.createWebviewPanel as jest.Mock).mockReset().mockImplementation(() => fakeWebviewPanel);
            (vscode.window.showWarningMessage as jest.Mock).mockReset().mockResolvedValue(RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL);
            (vscode.window.showQuickPick as jest.Mock).mockReset();
            (vscode.window.showInputBox as jest.Mock).mockReset();

            connection = {
                sentQueries: [] as string[],
                describe: jest.fn().mockResolvedValue({
                    name: 'Account', keyPrefix: '001', createable: true,
                    fields: [{ name: 'Id', type: 'id' }, { name: 'Name', type: 'string', nameField: true }]
                }),
                query: jest.fn().mockImplementation(async (soql: string) => {
                    connection.sentQueries.push(soql);
                    const idInMatch = /^SELECT Id FROM Account WHERE Id IN \('(\w+)'\)$/.exec(soql);
                    return { records: idInMatch && idInMatch[1].startsWith(ACCOUNT_ID_15) ? [{ Id: ACCOUNT_ID }] : [] };
                })
            };

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showInformationMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);
            promptForOrgSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(DEV_ORG as any);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(connection);
            promptForParentRecordSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForParentRecord').mockImplementation(async pickerOptions => {
                await pickerOptions.search('Acme');
                return { recordId: ACCOUNT_ID, recordName: 'Acme East' };
            });
            jest.spyOn(SalesforceOrgService, 'searchParentRecords').mockResolvedValue({ matches: [{ recordId: ACCOUNT_ID, recordName: 'Acme East' }], hasMoreMatches: false });

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('asks for the org every time, searches the parent, confirms naming the org, then pins the Id with the org beside it and reloads', async () => {

            chooseHow('Search Account');

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(promptForOrgSpy).toHaveBeenCalledWith('Choose the org that holds the Account record Contact.AccountId points at');
            expect(promptForParentRecordSpy.mock.calls[0][0]).toMatchObject({ fieldApiName: 'AccountId', parentObjectApiName: 'Account', nameFieldApiName: 'Name' });

            const writtenText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(writtenText).toBe(RECIPE_TEXT.replace(`    AccountId: ${TODO}`, `    AccountId: "${ACCOUNT_ID}"`));
            expect((yaml.load(writtenText) as any[])[0].fields.AccountId).toBe(ACCOUNT_ID);

            const storedEntry = RecipeCockpitFixedValueStore.parse(fs.readFileSync(fixedValueFilePath(), 'utf-8')).entries[0];
            expect(storedEntry).toMatchObject({ objectApiName: 'Contact', fieldApiName: 'AccountId', value: ACCOUNT_ID, orgRecord: { orgUsername: 'dev@example.com', orgAlias: 'dev', parentObjectApiName: 'Account' } });
            expect(storedEntry.occurrences[0].originalText).toBe(`    AccountId: ${TODO}`);

            const [title, options, confirmLabel] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(title).toBe('Point Contact.AccountId at an existing Account record?');
            expect(options.inPanel).toBe(true);
            expect(options.isDestructive).toBeUndefined();
            expect(options.detail).toContain('Org: dev · dev@example.com');
            expect(options.detail).toContain(`Record: Acme East · ${ACCOUNT_ID}`);
            expect(options.detail).toContain('The Id exists only in dev · dev@example.com.');
            expect(confirmLabel).toBe(RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL);
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining(`Contact.AccountId now points at the Account record ${ACCOUNT_ID} from dev · dev@example.com`));

            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'wireLookupState').map(hostMessage => hostMessage.isRunning)).toEqual([true, false]);
            expect(treeOf(lastModel()).fixedValues).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', value: ACCOUNT_ID, kind: 'text', orgRecord: { orgLabel: 'dev', parentObjectApiName: 'Account' } }]);

        });

        it('takes an entered Id once the org holds it as an Account, and writes its 18-character form', async () => {

            chooseHow(RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL);
            (vscode.window.showInputBox as jest.Mock).mockImplementation(async (inputOptions: any) => {
                expect(inputOptions.validateInput('001!')).toContain('15- or 18-character');
                expect(inputOptions.validateInput(` ${ACCOUNT_ID_15} `)).toBeUndefined();
                return ` ${ACCOUNT_ID_15} `;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(connection.sentQueries).toContain(`SELECT Id FROM Account WHERE Id IN ('${ACCOUNT_ID_15}')`);
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toContain(`    AccountId: "${ACCOUNT_ID}"`);
            expect(promptForParentRecordSpy).not.toHaveBeenCalled();

        });

        it.each([
            ['whose key prefix is not Account\'s', '003000000000011AAA', 'does not start with 001, the key prefix of Account records'],
            ['the org does not hold', '001000000000099AAA', 'dev · dev@example.com has no Account record with the Id 001000000000099AAA']
        ])('refuses an entered Id %s, writing nothing', async (_description, enteredId, refusalText) => {

            chooseHow(RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL);
            (vscode.window.showInputBox as jest.Mock).mockResolvedValue(enteredId);

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain(refusalText);
            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toStartWith('Contact.AccountId was not set to an existing Account record:');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(fixedValueFilePath())).toBe(false);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        it('refuses a record its search did not return', async () => {

            chooseHow('Search Account');
            promptForParentRecordSpy.mockResolvedValue({ recordId: '001000000000077AAA', recordName: 'forged' });

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('the record chosen is not one its search returned');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);

        });

        it.each([
            ['the org prompt is dismissed', () => promptForOrgSpy.mockResolvedValue(undefined)],
            ['the way to choose is dismissed', () => (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined)],
            ['the record picker is dismissed', () => { chooseHow('Search Account'); promptForParentRecordSpy.mockResolvedValue(undefined); }],
            ['the Id box is dismissed', () => { chooseHow(RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL); (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined); }],
            ['the confirmation is cancelled', () => { chooseHow('Search Account'); (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined); }]
        ])('writes nothing, says nothing and gives the buttons back when %s', async (_description, arrange) => {

            arrange();

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(fixedValueFilePath())).toBe(false);
            expect(showWarningMessageSpy).not.toHaveBeenCalled();
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData')).toEqual([]);
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'wireLookupState', isRunning: false });

        });

        it('refuses, writing nothing, when the lookup was filled by hand after the cockpit drew its button', async () => {

            chooseHow('Search Account');
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.writeFileSync(recipeFilePath, RECIPE_TEXT.replace(`    AccountId: ${TODO}`, '    AccountId: Account_NickName'));
                return RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('is no longer a "### TODO -- REFERENCE ID REQUIRED" lookup');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toContain('    AccountId: Account_NickName');
            expect(fs.existsSync(fixedValueFilePath())).toBe(false);

        });

        it('says the org could not be connected to, rather than reporting an error, when its connection fails', async () => {

            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValue(new Error('expired access/refresh token'));

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toBe('Contact.AccountId was not set to an existing Account record: dev · dev@example.com could not be connected to. Check its authorization with "sf org list", then try again.');
            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
            expect(postedPanelMessages.at(-1)).toEqual({ command: 'wireLookupState', isRunning: false });

        });

        it('refuses when the parent cannot be described in the chosen org', async () => {

            connection.describe.mockRejectedValue(Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' }));

            await openRenderedCockpit();
            await receivedMessageHandler(USE_ACCOUNT_MESSAGE);

            expect(showWarningMessageSpy.mock.calls.at(-1)[0]).toContain('Account could not be described in dev · dev@example.com');
            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();

        });

        it('Clear puts the TODO line back exactly, and a typed value on the lookup is refused under the editor', async () => {

            writeOrgRecordPin();
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);

            await openRenderedCockpit();
            const editMessage = { command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'AccountId' };

            await receivedMessageHandler({ ...editMessage, value: '001000000000077AAA' });
            expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'fieldEditResult')).toMatchObject({ refusal: RECIPE_COCKPIT_ORG_RECORD_TYPED_VALUE_REFUSAL });
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toContain(`    AccountId: "${ACCOUNT_ID}"`);

            await receivedMessageHandler({ ...editMessage, value: '' });
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(fixedValueFilePath())).toBe(false);
            expect(treeOf(lastModel()).emptyLookups.map(emptyLookup => emptyLookup.fieldApiName)).toEqual(['AccountId', 'ReportsToId', 'Owner__c']);

        });

    });

    describe('the panel script', () => {

        const renderModel = (recipeViewModel = loadModel()) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            return panel;
        };
        const contactElementOf = (panel: any) => panel.objectElements().find((objectElement: any) => panel.findAll(objectElement, 'treeUseOrgRecord').length > 0);
        const useButtonOf = (panel: any, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(contactElementOf(panel), fieldApiName), 'treeUseOrgRecord')[0];

        it('draws both decisions side by side, as createButton kinds, on every empty lookup to one parent and on no other row', () => {

            const panel = renderModel();
            const contactElement = contactElementOf(panel);
            const accountRow = panel.fieldRowNamed(contactElement, 'AccountId');
            const [decisionElement] = panel.findAll(accountRow, 'treeLookupDecision');

            expect(decisionElement.children.map((child: any) => child.textContent)).toEqual(['Create Account in recipe', 'Use existing Account from org…']);
            decisionElement.children.forEach((child: any) => expect(child.classList.contains('sdtButton-secondary')).toBe(true));
            expect(panel.findAll(panel.cockpitBodyElement, 'treeUseOrgRecord').map((buttonElement: any) => [buttonElement.textContent, buttonElement.disabled])).toEqual([
                ['Use existing Account from org…', false],
                ['Use existing Contact from org…', false],
                ['Use existing User from org…', false]
            ]);
            ['Related__c', 'LastName'].forEach(fieldApiName => expect(panel.findAll(panel.fieldRowNamed(contactElement, fieldApiName), 'treeLookupDecision')).toHaveLength(0));

        });

        it('posts names only, and holds every decision until the host answers', () => {

            const panel = renderModel();

            useButtonOf(panel, 'AccountId').dispatch('click');
            useButtonOf(panel, 'AccountId').dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'useOrgRecordForLookup')).toEqual([USE_ACCOUNT_MESSAGE]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeUseOrgRecord').every((buttonElement: any) => buttonElement.disabled)).toBe(true);

            panel.postToPanel({ command: 'wireLookupState', isRunning: false });
            expect(useButtonOf(panel, 'AccountId').disabled).toBe(false);
            // A REASON OUTLIVES THE LOCK: CREATE User STAYS DISABLED
            expect(panel.findAll(panel.fieldRowNamed(contactElementOf(panel), 'Owner__c'), 'treeAddParentObject')[0].disabled).toBe(true);

        });

        it('draws "Use existing" disabled with its reason, and keeps it disabled past the lock', () => {

            const recipeViewModel = loadModel();
            treeOf(recipeViewModel).emptyLookups[0].orgRecordRefusal = 'Contact is written twice.';
            const panel = renderModel(recipeViewModel);

            expect(useButtonOf(panel, 'AccountId').disabled).toBe(true);
            expect(useButtonOf(panel, 'AccountId').attributes.title).toBe('Cannot use an org record: Contact is written twice.');
            panel.postToPanel({ command: 'wireLookupState', isRunning: false });
            expect(useButtonOf(panel, 'AccountId').disabled).toBe(true);

        });

        it('draws neither decision on a lookup to an excluded object', () => {

            const recipeViewModel = loadModel();
            treeOf(recipeViewModel).fieldSelection = { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: ['AccountId'], lockedFields: [{ fieldApiName: 'AccountId', reason: 'parent excluded' }] }] };
            const panel = renderModel(recipeViewModel);
            const [decisionElement] = panel.findAll(panel.fieldRowNamed(contactElementOf(panel), 'AccountId'), 'treeLookupDecision');

            expect(decisionElement.classList.contains('hidden')).toBe(true);
            expect(panel.findAll(panel.fieldRowNamed(contactElementOf(panel), 'Owner__c'), 'treeLookupDecision')[0].classList.contains('hidden')).toBe(false);

        });

        it('badges a lookup set to an org record with the org, says the Id exists only there, and lets the pencil clear it', () => {

            writeOrgRecordPin();
            const panel = renderModel();
            const contactElement = panel.objectElements().find((objectElement: any) => panel.findAll(objectElement, 'treeFieldName').some((nameElement: any) => nameElement.textContent === 'AccountId'));
            const accountRow = panel.fieldRowNamed(contactElement, 'AccountId');
            const [badgeElement] = panel.findAll(accountRow, 'fixedValueBadge');
            const [pencilElement] = panel.findAll(accountRow, 'treeFieldFixedValue');

            expect(badgeElement.textContent).toBe('org record · dev');
            expect(badgeElement.classList.contains('hidden')).toBe(false);
            expect(badgeElement.attributes.title).toContain('not generated data. The Id exists only in that org');
            expect(panel.findAll(accountRow, 'treeLookupDecision')).toHaveLength(0);
            expect(pencilElement.disabled).toBe(false);
            expect(pencilElement.attributes.title).toBe('Existing Account record of dev — click to clear it');

            const [ownerPencilElement] = panel.findAll(panel.fieldRowNamed(contactElement, 'Owner__c'), 'treeFieldFixedValue');
            expect(ownerPencilElement.disabled).toBe(true);

        });

    });

});
