import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL,
    RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitFixedValueStore } from '../RecipeCockpitFixedValueStore';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #467, end to end on the host and in the panel: every occurrence of an object written more than
    once -- a self-lookup's iteration here -- keeps its own unticked fields, count, validation-rule
    switch and edit. The settings are stored under "<Object>\n<Nickname>" beside the object keys
    every entry had before, and an entry an object holds from before still applies to every
    occurrence until one occurrence is changed, when it is split. The writer's half is held in
    RecipeCockpitOccurrenceWriter.test.ts.
*/

const RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T00-00-00';
const TREE_KEY = 'Account-thru-Opportunity';
const FIRST_NICKNAME = 'Account_NickName';
const ITERATION_NICKNAME = 'Account_child_NickName';
const ITERATION_KEY = `Account\n${ITERATION_NICKNAME}`;
const FIRST_KEY = `Account\n${FIRST_NICKNAME}`;
const RECIPE_FIXTURE_PATH = path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml');

const buildWrapperField = (objectApiName: string, fieldApiName: string, fieldType: string) => ({
    objectName: objectApiName, fieldName: fieldApiName, fieldLabel: fieldApiName, type: fieldType, recipeValue: fieldType === 'Text' ? '${{ faker.company.name() }}' : ''
});

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: {
            Fields: [buildWrapperField('Account', 'Name', 'Text'), buildWrapperField('Account', 'ParentId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['ParentId'] } }
        },
        Contact: {
            Fields: [buildWrapperField('Contact', 'LastName', 'Text'), buildWrapperField('Contact', 'AccountId', 'Lookup'), buildWrapperField('Contact', 'ReportsToId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'], Contact: ['ReportsToId'] } }
        },
        Case: {
            Fields: [buildWrapperField('Case', 'Subject', 'Text'), buildWrapperField('Case', 'AccountId', 'Lookup'), buildWrapperField('Case', 'ContactId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'], Contact: ['ContactId'] } }
        },
        Opportunity: {
            Fields: [buildWrapperField('Opportunity', 'Name', 'Text'), buildWrapperField('Opportunity', 'AccountId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'] } }
        }
    },
    RecipeFiles: [{ objects: ['Account', 'Contact', 'Case', 'Opportunity'] }]
};

const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

const storedSelections = (excludedFieldApiNamesByFolderName: Record<string, unknown> = {}, objectCountsByFolderName: Record<string, unknown> = {}, validationRulesOffByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: {},
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: objectCountsByFolderName,
    validationRulesOffByFolderName: validationRulesOffByFolderName
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel) => recipe.trees.find(tree => tree.treeKey === TREE_KEY) as IRecipeCockpitTreeViewModel;

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, settings of one occurrence (#467)', () => {

    let workspaceRoot: string;
    let recipeFilePath: string;
    let fixtureText: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-occurrences-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        const fullFixtureText = fs.readFileSync(RECIPE_FIXTURE_PATH, 'utf-8');
        fixtureText = fullFixtureText.slice(0, fullFixtureText.indexOf('\n# Lead')) + '\n';
        fs.writeFileSync(recipeFilePath, fixtureText);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);

    describe('the model', () => {

        it('carries the iteration\'s own count, and lists each occurrence once', () => {

            const recipe = loadModel();
            const occurrences = RecipeCockpitService.listTreeOccurrences(RecipeCockpitService.buildObjectsByApiName(recipe), treeOf(recipe));

            expect(occurrences.map(occurrence => [occurrence.objectApiName, occurrence.nickname, occurrence.objectViewModel.recordCount])).toEqual([
                ['Account', FIRST_NICKNAME, 2],
                ['Account', ITERATION_NICKNAME, 2],
                ['Contact', undefined, 2],
                ['Case', undefined, 1],
                ['Opportunity', undefined, 1]
            ]);

        });

        it('gives the iteration its own lines, the field line it writes and none it does not', () => {

            const recipe = loadModel();
            const iteration = RecipeCockpitService.findTreeOccurrence(RecipeCockpitService.buildObjectsByApiName(recipe), treeOf(recipe), 'Account', ITERATION_NICKNAME);
            const lines = fixtureText.split('\n');

            expect(iteration.objectViewModel.fields.map(field => [field.fieldApiName, field.lineNumber && lines[field.lineNumber - 1].trim()])).toEqual([
                ['Name', 'Name: ${{ faker.company.name() }}'],
                ['ParentId', `ParentId: ${FIRST_NICKNAME}`]
            ]);
            expect(iteration.objectViewModel.countParentObjectApiName).toBe('Account');

        });

        it('applies an entry its object holds from before #467 to every occurrence', () => {

            const recipe = loadModel();
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([['Account', new Set(['Name'])]])]]));

            expect(treeOf(recipe).fieldSelection?.objects.map(selection => [selection.nickname, selection.excludedFieldApiNames])).toEqual([
                [FIRST_NICKNAME, ['Name']],
                [ITERATION_NICKNAME, ['Name']]
            ]);

        });

        it('applies an occurrence\'s own entry to it alone, over its object\'s', () => {

            const recipe = loadModel();
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([['Account', new Set(['Name'])], [ITERATION_KEY, new Set<string>(['ParentId'])]])]]),
                undefined, new Map([[TREE_KEY, new Map([[ITERATION_KEY, 5]])]]));

            expect(treeOf(recipe).fieldSelection?.objects.map(selection => [selection.nickname, selection.excludedFieldApiNames])).toEqual([
                [FIRST_NICKNAME, ['Name']],
                [ITERATION_NICKNAME, ['ParentId']]
            ]);
            expect(treeOf(recipe).objectCounts).toEqual([{ objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 5 }]);
            expect([...RecipeCockpitService.listExcludedFieldApiNamesByOccurrence(treeOf(recipe))]).toEqual([[FIRST_KEY, ['Name']], [ITERATION_KEY, ['ParentId']]]);
            // THE INSERT'S READINESS REFUSES AN UNTICKED FIELD THE ORG REQUIRES WHEREVER IT IS UNTICKED
            expect(RecipeCockpitService.listExcludedFieldApiNamesByObject(treeOf(recipe)).get('Account')).toEqual(['Name', 'ParentId']);

        });

        it('switches a field\'s validation rules off on the occurrence whose key holds it alone', () => {

            const recipe = loadModel();
            const nameField = recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account').fields.find(field => field.fieldApiName === 'Name');
            nameField.validationRules = { appliedRuleNames: ['Name_Format'], notAppliedRules: [], recipeValue: '${{ faker.company.name() }}', unconstrainedRecipeValue: '${{ faker.lorem.word() }}' } as any;
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map(), undefined, new Map(), new Map(), new Map([[TREE_KEY, new Map([[ITERATION_KEY, new Set(['Name'])]])]]));

            expect(treeOf(recipe).validationRulesOff).toEqual([{ objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name' }]);
            expect([...RecipeCockpitService.listUnconstrainedValuesByObject(recipe, treeOf(recipe)).keys()]).toEqual([ITERATION_KEY]);

        });

        it('lists a field only the iteration writes as one only in the recipe file, with the iteration\'s line', () => {

            const recipe = loadModel();
            const accountObject = recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account');
            accountObject.iterations[0].fields.push({ fieldApiName: 'Description', lineNumber: 99, recipeValue: 'x' });
            const iteration = RecipeCockpitService.findTreeOccurrence(RecipeCockpitService.buildObjectsByApiName(recipe), treeOf(recipe), 'Account', ITERATION_NICKNAME);

            expect(iteration.objectViewModel.fields.find(field => field.fieldApiName === 'Description')).toMatchObject({ isOnlyInRecipeFile: true, lineNumber: 99, recipeValue: 'x' });
            expect(RecipeCockpitService.listSelectableFieldApiNames(iteration.objectViewModel)).toEqual(['Name', 'ParentId', 'Description']);

        });

        it('keeps the object\'s settings for a hand-edited recipe whose nicknames are not api names, as before #467 (#467 review)', () => {

            const recipe = loadModel();
            const accountObject = recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account');
            accountObject.iterations[0].nickname = 'Account-child';

            expect(RecipeCockpitService.listTreeOccurrences(RecipeCockpitService.buildObjectsByApiName(recipe), treeOf(recipe))
                .filter(occurrence => occurrence.objectApiName === 'Account')
                .map(occurrence => occurrence.nickname)).toEqual([undefined]);

        });

        it('leaves a field out of a deploy only when every occurrence leaves it out', () => {

            const recipe = loadModel();
            const deployedAccountFields = () => RecipeCockpitService.listTreeDeployObjects(recipe, treeOf(recipe)).find(deployObject => deployObject.objectApiName === 'Account').fieldApiNames;

            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([[ITERATION_KEY, new Set(['Name'])]])]]));
            expect(deployedAccountFields()).toEqual(['Name', 'ParentId']);

            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([[ITERATION_KEY, new Set(['Name'])], [FIRST_KEY, new Set(['Name'])]])]]));
            expect(deployedAccountFields()).toEqual(['ParentId']);

        });

        it('keeps an object written once on its object key, posting no nickname', () => {

            const recipe = loadModel();
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([['Contact', new Set(['LastName'])]])]]));

            expect(treeOf(recipe).fieldSelection?.objects).toEqual([{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] }]);

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const recipe = loadModel();
            const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 1 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it('routes a field of the iteration with its nickname, and the first occurrence with its own', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', included: false }, panelState))
                .toMatchObject({ kind: 'setFieldIncluded', objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: FIRST_NICKNAME, fieldApiName: 'Name', included: false }, panelState))
                .toMatchObject({ kind: 'setFieldIncluded', nickname: FIRST_NICKNAME });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 4 }, panelState))
                .toMatchObject({ kind: 'setObjectCount', nickname: ITERATION_NICKNAME, count: 4 });

        });

        describe('a picklist\'s value tiles (#465) on an object written more than once', () => {

            const buildPicklistPanelState = (fixedValues?: { nickname: string; value: string }[]): IRecipeCockpitPanelState => {
                const recipe = loadModel();
                recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account')!
                    .fields.find(fieldViewModel => fieldViewModel.fieldApiName === 'Name')!.isPicklist = true;
                if ( fixedValues ) {
                    treeOf(recipe).fixedValues = fixedValues.map(fixedValue => ({ objectApiName: 'Account', fieldApiName: 'Name', kind: 'expression', ...fixedValue })) as any;
                }
                const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
                panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 1 };
                panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
                panelState.picklistDisplayValuesByObjectApiName = new Map([['Account', new Map([['Name', { picklistValues: ['Acme', 'Globex'], recordTypePicklistValues: [] }]])]]);
                panelState.loadablePicklistKeys = new Set([RecipeCockpitService.buildPicklistKey('Account', 'Name')]);
                return panelState;
            };

            it('routes a choice on the iteration with its nickname, and the first occurrence with its own', () => {

                const panelState = buildPicklistPanelState();

                expect(RecipeCockpitService.routePanelMessage({ command: 'setPicklistValueChoice', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', picklistValues: ['Globex'] }, panelState))
                    .toMatchObject({ kind: 'setPicklistValueChoice', objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', picklistValues: ['Globex'] });
                expect(RecipeCockpitService.routePanelMessage({ command: 'setPicklistValueChoice', treeKey: TREE_KEY, objectApiName: 'Account', nickname: FIRST_NICKNAME, fieldApiName: 'Name', picklistValues: ['Acme'] }, panelState))
                    .toMatchObject({ kind: 'setPicklistValueChoice', nickname: FIRST_NICKNAME });
                expect(RecipeCockpitService.routePanelMessage({ command: 'setPicklistValueChoice', treeKey: TREE_KEY, objectApiName: 'Account', nickname: 'Forged_NickName', fieldApiName: 'Name', picklistValues: ['Acme'] }, panelState))
                    .toBeUndefined();

            });

            it('ticks the tiles from the occurrence\'s own edit, and answers with its nickname', () => {

                const panelState = buildPicklistPanelState([{ nickname: ITERATION_NICKNAME, value: RecipeCockpitService.buildPicklistChoiceExpression('faker-js', ['Globex'], { fieldType: 'Picklist' } as any) }]);
                const loadFor = (nickname: string) => RecipeCockpitService.routePanelMessage({ command: 'loadPicklistValues', treeKey: TREE_KEY, objectApiName: 'Account', nickname: nickname, fieldApiName: 'Name' }, panelState) as any;

                expect(loadFor(ITERATION_NICKNAME).hostMessage).toMatchObject({ nickname: ITERATION_NICKNAME, chosenPicklistValues: ['Globex'] });
                expect(loadFor(FIRST_NICKNAME).hostMessage.nickname).toBe(FIRST_NICKNAME);
                expect(loadFor(FIRST_NICKNAME).hostMessage.chosenPicklistValues).not.toEqual(['Globex']);

            });

        });

        it('routes an object written once with no nickname, as before', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: false }, buildPanelState()))
                .toEqual({ kind: 'setFieldIncluded', treeKey: TREE_KEY, folderName: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', isIncluded: false });

        });

        it.each([
            ['a nickname no occurrence holds', { nickname: 'Forged_NickName' }],
            ['another object\'s nickname', { nickname: 'Contact_NickName' }],
            ['a nickname that is not text', { nickname: 7 }]
        ])('writes nothing for %s', (_label, forged) => {

            const panelState = buildPanelState();

            ['setFieldIncluded', 'setFieldFixedValue', 'setFieldValidationRuleApplied'].forEach(command => {
                expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: TREE_KEY, objectApiName: 'Account', fieldApiName: 'Name', included: false, applied: false, value: 'Acme', ...forged }, panelState)).toBeUndefined();
            });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', count: 4, ...forged }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: TREE_KEY, objectApiName: 'Account', included: false, ...forged }, panelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;
        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            visible: true,
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            onDidChangeViewState: jest.fn().mockReturnValue({ dispose: jest.fn() }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        });

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        // THE FILTERED COPY THE CARD'S GENERATE BUTTON RUNS, READ AS IT IS AT THE CLICK
        const resolveFilteredRecipe = () => {
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
            const filteredRecipe = RecipeCockpitService.resolveRunFakerFilteredRecipe(panelState, TREE_KEY, recipeFilePath, 'Nothing was generated for');
            if ( !filteredRecipe || 'refusalMessage' in filteredRecipe ) {
                throw new Error(`expected a filtered copy, got ${JSON.stringify(filteredRecipe)}`);
            }
            return filteredRecipe;
        };

        const readAccounts = (recipeText: string) => {
            const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
            return RecipeCockpitRecipeWriter.scanRecipeObjects(lines)
                .filter(scannedObject => scannedObject.objectApiName === 'Account')
                .map(scannedObject => ({
                    nickname: scannedObject.nicknames[0],
                    count: RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject),
                    fields: scannedObject.fields.map(scannedField => lines[scannedField.startIndex].trim())
                }));
        };

        beforeEach(() => {
            postedPanelMessages = [];
            showWarningMessage.mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('keeps an untick of the iteration under its own key, and generates it on the iteration alone', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', included: false });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [TREE_KEY]: { [ITERATION_KEY]: ['Name'] } }));
            expect(lastPosted('objectSelection').fieldSelection.objects).toEqual([
                { objectApiName: 'Account', nickname: ITERATION_NICKNAME, excludedFieldApiNames: ['Name'], lockedFields: [] }
            ]);

            const filteredRecipe = resolveFilteredRecipe();
            expect(readAccounts(filteredRecipe.recipeText).map(account => [account.nickname, account.fields.map(fieldLine => fieldLine.split(':')[0])])).toEqual([
                [FIRST_NICKNAME, ['Name', 'ParentId']],
                [ITERATION_NICKNAME, ['ParentId']]
            ]);
            expect(filteredRecipe.excludedFieldApiNamesByObject).toEqual({ [ITERATION_KEY]: ['Name'] });

        });

        it('splits an untick its object holds from before #467 when one occurrence is ticked again', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [TREE_KEY]: { Account: ['Name'] } }) });
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', included: true });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [TREE_KEY]: { [FIRST_KEY]: ['Name'] } }));
            expect(lastPosted('objectSelection').fieldSelection.objects.map((selection: any) => [selection.nickname, selection.excludedFieldApiNames])).toEqual([[FIRST_NICKNAME, ['Name']]]);

        });

        it('reads an occurrence\'s untick back: a second untick keeps the first, and a reopen draws both (#467 review)', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', included: false });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'ParentId', included: false });
            await receivedMessageHandler({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 6 });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [TREE_KEY]: { [ITERATION_KEY]: ['Name', 'ParentId'] } }, { [TREE_KEY]: { [ITERATION_KEY]: 6 } }));

            disposeHandler?.();
            disposeHandler = undefined;
            postedPanelMessages = [];
            const reopenedMessage = await openAndDraw(workspaceState);

            expect(treeOf(reopenedMessage.recipe).fieldSelection?.objects.map(selection => [selection.nickname, selection.excludedFieldApiNames])).toEqual([[ITERATION_NICKNAME, ['Name', 'ParentId']]]);
            expect(treeOf(reopenedMessage.recipe).objectCounts).toEqual([{ objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 6 }]);

        });

        it('reads a count stored before #467 as the first occurrence\'s alone, and splits it onto that one only (#467 review)', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({}, { [TREE_KEY]: { Account: 50 } }) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(treeOf(recipeDataMessage.recipe).objectCounts).toEqual([{ objectApiName: 'Account', nickname: FIRST_NICKNAME, count: 50 }]);
            expect(readAccounts(resolveFilteredRecipe().recipeText).map(account => [account.nickname, account.count])).toEqual([[FIRST_NICKNAME, 50], [ITERATION_NICKNAME, 2]]);

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 3 });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [TREE_KEY]: { [FIRST_KEY]: 50, [ITERATION_KEY]: 3 } }));

        });

        it('unticks every field of the iteration with its All fields box, leaving the first occurrence alone', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, included: false });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [TREE_KEY]: { [ITERATION_KEY]: ['Name', 'ParentId'] } }));

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, included: true });

            expect(storedOf(workspaceState)).toEqual(storedSelections());

        });

        it('sets the iteration\'s count alone, and writes it on that occurrence of the copy', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 6 });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [TREE_KEY]: { [ITERATION_KEY]: 6 } }));
            expect(readAccounts(resolveFilteredRecipe().recipeText).map(account => [account.nickname, account.count])).toEqual([[FIRST_NICKNAME, 2], [ITERATION_NICKNAME, 6]]);

            await receivedMessageHandler({ command: 'setObjectCount', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, count: 2 });

            expect(storedOf(workspaceState)).toEqual(storedSelections());

        });

        it('writes an edit into the iteration alone, draws it on that row only, and its Clear gives the file back byte for byte', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: 'Child Co' });

            expect(showWarningMessage.mock.calls[0][0]).toBe(`Write a fixed value into Account · ${ITERATION_NICKNAME}.Name?`);
            expect(showWarningMessage.mock.calls[0][1].detail).toContain('on that Account only, every other Account in it keeping its own value');
            const pinnedText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(readAccounts(pinnedText).map(account => account.fields[0])).toEqual(['Name: ${{ faker.company.name() }}', 'Name: "Child Co"']);

            const fixedValueEntries = RecipeCockpitFixedValueStore.parse(fs.readFileSync(RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath), 'utf-8')).entries;
            expect(fixedValueEntries.map(entry => [entry.objectApiName, entry.scopeNickname, entry.fieldApiName, entry.occurrences.map(occurrence => occurrence.nickname)]))
                .toEqual([['Account', ITERATION_NICKNAME, 'Name', [ITERATION_NICKNAME]]]);

            expect(treeOf(lastPosted('recipeData').recipe).fixedValues).toEqual([
                { objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: 'Child Co', kind: 'text' }
            ]);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: '' });

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(fixtureText);
            expect(treeOf(lastPosted('recipeData').recipe).fixedValues).toBeUndefined();

        });

        it('edits the first occurrence alone too, now that each occurrence keeps its own', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: FIRST_NICKNAME, fieldApiName: 'Name', value: 'Parent Co' });

            expect(readAccounts(fs.readFileSync(recipeFilePath, 'utf-8')).map(account => account.fields[0])).toEqual(['Name: "Parent Co"', 'Name: ${{ faker.company.name() }}']);

        });

        it('draws a pin of every occurrence from before #467 on every row, and its Clear from the iteration puts back every occurrence', async () => {

            const pinResult = RecipeCockpitRecipeWriter.pinField(fixtureText, 'Account', 'Name', { value: 'Same Co', kind: 'text' });
            if ( !pinResult.isPinned ) { throw new Error('expected a pin'); }
            fs.writeFileSync(recipeFilePath, pinResult.recipeText);
            fs.writeFileSync(RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath), RecipeCockpitFixedValueStore.serialize([
                { objectApiName: 'Account', fieldApiName: 'Name', value: 'Same Co', occurrences: pinResult.occurrences }
            ]));

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(treeOf(recipeDataMessage.recipe).fixedValues.map((fixedValue: any) => [fixedValue.nickname, fixedValue.value])).toEqual([[FIRST_NICKNAME, 'Same Co'], [ITERATION_NICKNAME, 'Same Co']]);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: '' });

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(fixtureText);

        });

        it('takes the iteration out of a pin of every occurrence when the iteration is edited on its own', async () => {

            const pinResult = RecipeCockpitRecipeWriter.pinField(fixtureText, 'Account', 'Name', { value: 'Same Co', kind: 'text' });
            if ( !pinResult.isPinned ) { throw new Error('expected a pin'); }
            fs.writeFileSync(recipeFilePath, pinResult.recipeText);
            fs.writeFileSync(RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath), RecipeCockpitFixedValueStore.serialize([
                { objectApiName: 'Account', fieldApiName: 'Name', value: 'Same Co', occurrences: pinResult.occurrences }
            ]));

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: 'Child Co' });

            const entries = RecipeCockpitFixedValueStore.parse(fs.readFileSync(RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath), 'utf-8')).entries;
            expect(entries.map(entry => [entry.scopeNickname, entry.value, entry.occurrences.map(occurrence => occurrence.nickname)])).toEqual([
                [undefined, 'Same Co', [FIRST_NICKNAME]],
                [ITERATION_NICKNAME, 'Child Co', [ITERATION_NICKNAME]]
            ]);

            // CLEAR OF THE WIDER PIN NOW PUTS BACK THE FIRST OCCURRENCE ALONE; THE ITERATION'S OWN STAYS
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: FIRST_NICKNAME, fieldApiName: 'Name', value: '' });

            expect(readAccounts(fs.readFileSync(recipeFilePath, 'utf-8')).map(account => account.fields[0])).toEqual(['Name: ${{ faker.company.name() }}', 'Name: "Child Co"']);

            // AND THE ITERATION'S OWN CLEAR PUTS BACK THE LINE GENERATE TREECIPE WROTE
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', value: '' });

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(fixtureText);

        });

    });

    describe('the panel script', () => {

        const renderModel = (recipe = loadModel()) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.expandAllTrees();
            return panel;
        };

        const iterationElementOf = (panel: any) => panel.objectElements()[1];

        it('draws the iteration\'s field boxes and edit button enabled, and posts its nickname', () => {

            const panel = renderModel();
            const iterationElement = iterationElementOf(panel);
            panel.expandObject(iterationElement);
            const [nameBox] = panel.findAll(panel.objectBodyOf(iterationElement), 'treeFieldInclude').filter((element: any) => !element.classList.contains('treeFieldSelectAll'));
            const [editButton] = panel.findAll(panel.objectBodyOf(iterationElement), 'treeFieldFixedValue');

            expect(nameBox.disabled).toBe(false);
            expect(nameBox.attributes.title).not.toContain('Follows');
            expect(editButton.disabled).toBe(false);

            nameBox.dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setFieldIncluded')).toEqual([
                { command: 'setFieldIncluded', treeKey: TREE_KEY, objectApiName: 'Account', nickname: ITERATION_NICKNAME, fieldApiName: 'Name', included: false }
            ]);

        });

        it('draws the iteration\'s own count box, and reads its own stored count', () => {

            const recipe = loadModel();
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map(), undefined, new Map([[TREE_KEY, new Map([[ITERATION_KEY, 9]])]]));
            const panel = renderModel(recipe);
            const [firstButton] = panel.findAll(panel.objectElements()[0].children[0], 'treeRecordCountButton');
            const [iterationButton] = panel.findAll(iterationElementOf(panel).children[0], 'treeRecordCountButton');

            expect(firstButton.attributes['aria-label']).toBe('Create 2 Account record(s), edit count');
            expect(iterationButton.attributes['aria-label']).toBe('Create 9 Account record(s) per Account record, changed from the recipe\'s 2, edit count');

        });

        it('draws an untick of the iteration on its row alone', () => {

            const recipe = loadModel();
            RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map([[TREE_KEY, new Map([[ITERATION_KEY, new Set(['Name'])]])]]));
            const panel = renderModel(recipe);
            const boxesOf = (objectElement: any) => {
                panel.expandObject(objectElement);
                return panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldInclude')
                    .filter((element: any) => !element.classList.contains('treeFieldSelectAll'))
                    .map((element: any) => element.attributes['aria-checked']);
            };

            expect(boxesOf(panel.objectElements()[0])).toEqual(['true', 'true']);
            expect(boxesOf(iterationElementOf(panel))).toEqual(['false', 'true']);

        });

    });

});
