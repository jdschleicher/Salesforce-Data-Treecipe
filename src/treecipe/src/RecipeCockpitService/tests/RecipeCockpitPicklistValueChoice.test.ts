import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL,
    RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL,
    RECIPE_COCKPIT_PICKLIST_CHOICE_EMPTY_REASON,
    RECIPE_COCKPIT_PICKLIST_CHOICE_UNCHANGED_REFUSAL,
    RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL,
    RECIPE_COCKPIT_PICKLIST_OTHER_EDIT_NOTE,
    RECIPE_COCKPIT_PICKLIST_RESET_LABEL,
    RECIPE_COCKPIT_PICKLIST_RESET_NOTHING_REFUSAL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { RecipeCockpitFixedValueStore } from '../RecipeCockpitFixedValueStore';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { HOSTILE_PICKLIST_VALUES, INJECTION_MARKER, ORDINARY_PICKLIST_VALUES } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { pinFieldInRecipeFile, restoreRecipeFiles } from './RecipeCockpitFixedValueFiles';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #465: a picklist's "Edit values" opens a tile per value. Saving the ticked ones writes the
    field's choice over only those values -- built by the recipe's own backend, every value through
    its escaper -- through the same fixed-value write an edited expression takes.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const LEAD_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, LEAD_TREE_KEY, `recipe--${LEAD_TREE_KEY}-2026-09-20T10-00-00.yml`);
const LEAD_FIXED_VALUE_FILE_PATH = RecipeCockpitFixedValueStore.buildFilePath(LEAD_RECIPE_FILE_PATH);
const GENERATED_STATUS_LINE = "    Status: ${{ random_choice('Open','Closed') }}";

const BACKENDS: Array<['faker-js' | 'snowfakery', () => IRecipeFakerService]> = [
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
];

const picklistField = (fieldType = 'Picklist'): IRecipeCockpitFieldViewModel => ({ fieldApiName: 'Status', fieldType: fieldType } as IRecipeCockpitFieldViewModel);

const loadRecipeRun = () => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
);

// ONE OBJECT WHOSE ONE FIELD IS THE LINE THE COCKPIT WRITES FOR AN EDITED EXPRESSION
const buildOneFieldRecipe = (expression: string, count = 1) => [
    '- object: Gadget__c',
    '  nickname: Gadget_NickName',
    `  count: ${count}`,
    '  fields:',
    RecipeCockpitRecipeWriter.buildConstrainedExpressionFieldLine('    ', 'Choice__c', expression),
    ''
].join('\n');

async function generateWithFakerJs(recipeText: string): Promise<Array<{ fields: Record<string, unknown> }>> {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-picklist-choice-test-'));
    const recipeFilePath = path.join(directoryPath, 'recipe.yml');
    fs.writeFileSync(recipeFilePath, recipeText);
    try {
        return JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath) as string);
    } finally {
        fs.rmSync(directoryPath, { recursive: true, force: true });
    }
}

answerInPanelConfirmationsThroughWarningMock();

describe('buildPicklistChoiceExpression (#465)', () => {

    it.each(BACKENDS)('with %s, builds exactly the line generation writes when every value is chosen', (_backend, createFakerService) => {

        const fakerService = createFakerService();
        const values = ['Hot', 'Warm', 'Cold'];

        expect(fakerService.buildPicklistChoiceExpression(values, false)).toBe(fakerService.buildPicklistRecipeValueByXMLFieldDetail(values, {}, 'Rating__c'));
        expect(fakerService.buildPicklistChoiceExpression(values, true)).toBe(fakerService.buildMultiSelectPicklistRecipeValueByXMLFieldDetail(values, {}, 'Regions__c'));

    });

    it('builds one line per backend that the writer takes as an edited expression', () => {

        expect(new FakerJSRecipeFakerService().buildPicklistChoiceExpression(['Open', 'Closed'], false)).toBe('${{ faker.helpers.arrayElement([`Open`,`Closed`]) }}');
        expect(new FakerJSRecipeFakerService().buildPicklistChoiceExpression(['Open'], true)).toBe("${{ (faker.helpers.arrayElements([`Open`])).join(';') }}");
        expect(new SnowfakeryRecipeFakerService().buildPicklistChoiceExpression(['Open', 'Closed'], false)).toBe("${{ random_choice('Open', 'Closed') }}");
        // ONE VALUE IS STILL A TUPLE, OR random_sample WOULD SAMPLE THE STRING'S LETTERS
        expect(new SnowfakeryRecipeFakerService().buildPicklistChoiceExpression(['Open'], true)).toBe("${{ (';').join((fake.random_sample(elements=('Open',)))) }}");

        BACKENDS.forEach(([, createFakerService]) => [false, true].forEach(isMultiSelect =>
            expect(RecipeCockpitRecipeWriter.checkConstrainedExpression(createFakerService().buildPicklistChoiceExpression(ORDINARY_PICKLIST_VALUES, isMultiSelect))).toBeUndefined()));

    });

    it('generates only the chosen values through the faker-js processor', async () => {

        const expression = new FakerJSRecipeFakerService().buildPicklistChoiceExpression(["Rock 'n' Roll", 'A&B'], false);
        const records = await generateWithFakerJs(buildOneFieldRecipe(expression, 40));

        expect(records).toHaveLength(40);
        records.forEach(record => expect(["Rock 'n' Roll", 'A&B']).toContain(record.fields.Choice__c));

    });

    // THE CASES BELOW RETURN EARLY FOR A REFUSED EXPRESSION; THIS KEEPS THEM FROM PASSING BECAUSE EVERY ONE IS REFUSED
    it.each(BACKENDS)('with %s, writes most hostile values rather than refusing them, and refuses only what carries a template delimiter', (_backend, createFakerService) => {

        const refusals = HOSTILE_PICKLIST_VALUES.map(([, hostileValue]) => RecipeCockpitRecipeWriter.checkConstrainedExpression(createFakerService().buildPicklistChoiceExpression([hostileValue], false)));

        expect(refusals.filter(refusal => refusal === undefined).length).toBeGreaterThan(HOSTILE_PICKLIST_VALUES.length / 2);
        refusals.filter((refusal): refusal is string => refusal !== undefined).forEach(refusal => expect(refusal).toMatch(/^contains "(\$\{|<<|<%|\}\})" inside it\.$/));

    });

    describe.each(HOSTILE_PICKLIST_VALUES)('a hostile value: %s', (_payloadName, hostileValue) => {

        it.each(BACKENDS)('with %s, is refused as an expression or written as a line that loads as exactly the expression, and is read back as the choice', (backend, createFakerService) => {

            expect(backend).toBeOneOf(['faker-js', 'snowfakery']);
            [false, true].forEach(isMultiSelect => {
                const expression = createFakerService().buildPicklistChoiceExpression([hostileValue, 'Other'], isMultiSelect);
                if ( RecipeCockpitRecipeWriter.checkConstrainedExpression(expression) !== undefined ) {
                    return;
                }

                const loaded = yaml.load(buildOneFieldRecipe(expression)) as Array<{ fields: Record<string, unknown> }>;
                expect(loaded[0].fields).toEqual({ Choice__c: expression });
                expect(RecipeCockpitService.recoverPicklistValueChoice(expression, [hostileValue, 'Other', 'Unchosen'], picklistField(isMultiSelect ? 'MultiselectPicklist' : 'Picklist'))).toEqual([hostileValue, 'Other']);
            });

        });

        it('with faker-js, generates the value itself and runs nothing it carries, picked alone or as a multi-select', async () => {

            const expression = new FakerJSRecipeFakerService().buildPicklistChoiceExpression([hostileValue], false);
            if ( RecipeCockpitRecipeWriter.checkConstrainedExpression(expression) !== undefined ) {
                return;
            }

            const records = await generateWithFakerJs(buildOneFieldRecipe(expression));
            expect(records[0].fields.Choice__c).toBe(hostileValue);
            const multiSelectRecords = await generateWithFakerJs(buildOneFieldRecipe(new FakerJSRecipeFakerService().buildPicklistChoiceExpression([hostileValue], true)));
            expect(multiSelectRecords[0].fields.Choice__c).toBe(hostileValue);
            expect((globalThis as Record<string, unknown>)[INJECTION_MARKER]).toBeUndefined();

        });

        PythonTestHarness.testRequiringModules('yaml', 'jinja2')('with snowfakery, read with PyYAML and rendered with Jinja as the value itself', () => {

            const expression = new SnowfakeryRecipeFakerService().buildPicklistChoiceExpression([hostileValue], false);
            if ( RecipeCockpitRecipeWriter.checkConstrainedExpression(expression) !== undefined ) {
                return;
            }

            const [loaded] = PythonTestHarness.loadWithPyYaml([buildOneFieldRecipe(expression)]) as Array<Array<{ fields: Record<string, unknown> }>>;
            expect(loaded[0].fields).toEqual({ Choice__c: expression });
            expect(PythonTestHarness.renderWithSnowfakeryJinja([{ template: expression }])).toEqual([{ rendered: hostileValue }]);

        });

    });

});

describe('recoverPicklistValueChoice (#465)', () => {

    it.each(BACKENDS)('with %s, reads back the values a choice was built from, a picklist and a multi-select', (_backend, createFakerService) => {

        const declared = ['Hot', 'Very Hot', 'Warm', 'Cold'];
        [false, true].forEach(isMultiSelect => {
            const field = picklistField(isMultiSelect ? 'MultiselectPicklist' : 'Picklist');
            [['Hot'], ['Very Hot'], ['Hot', 'Cold'], ['Very Hot', 'Warm', 'Cold'], declared].forEach(chosen => {
                expect(RecipeCockpitService.recoverPicklistValueChoice(createFakerService().buildPicklistChoiceExpression(chosen, isMultiSelect), declared, field)).toEqual(chosen);
            });
        });

    });

    it('reads nothing from an expression it would not build: hand-written, of another field kind, or naming a value the field does not declare', () => {

        const declared = ['Open', 'Closed'];
        expect(RecipeCockpitService.recoverPicklistValueChoice('${{ random_choice("Open") }}', declared, picklistField())).toBeUndefined();
        expect(RecipeCockpitService.recoverPicklistValueChoice("${{ random_choice('Open','Closed') }}", declared, picklistField())).toBeUndefined();
        expect(RecipeCockpitService.recoverPicklistValueChoice('${{ faker.helpers.arrayElement([`Open`]) }}', declared, picklistField('MultiselectPicklist'))).toBeUndefined();
        expect(RecipeCockpitService.recoverPicklistValueChoice("${{ random_choice('Open', 'Gone') }}", declared, picklistField())).toBeUndefined();
        expect(RecipeCockpitService.recoverPicklistValueChoice('${{ faker.string.alpha(4) }}', declared, picklistField())).toBeUndefined();

    });

});

describe('routePanelMessage setPicklistValueChoice (#465)', () => {

    const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
        const loadedRecipe = loadRecipeRun();
        const recipe: IRecipeCockpitRecipeViewModel = loadedRecipe.recipeViewModel;
        RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map(), undefined, new Map(), new Map());
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
        panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
        panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
        return panelState;
    };

    const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) =>
        RecipeCockpitService.routePanelMessage({ command: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: ['Closed'], ...payload } as any, panelState);

    it('routes a drawn, free picklist with the values ticked, put back in the field\'s own order', () => {

        expect(route({ extra: 'ignored' })).toEqual({ kind: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: ['Closed'] });
        expect(route({ picklistValues: ['Closed', 'Open'] })).toMatchObject({ picklistValues: ['Open', 'Closed'] });

    });

    it.each([
        ['no values', { picklistValues: [] }],
        ['values that are not a list', { picklistValues: 'Open' }],
        ['a value that is not a string', { picklistValues: ['Open', 7] }],
        ['a value twice', { picklistValues: ['Open', 'Open'] }],
        ['a value the field does not declare', { picklistValues: ['Open', 'Pending'] }],
        ['a value named like an Object member', { picklistValues: ['__proto__'] }],
        ['a field that is not a picklist', { fieldApiName: 'Company', picklistValues: ['Open'] }],
        ['a dependent picklist', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Sub_Rating__c', picklistValues: ['Very Hot'] }],
        ['a controlling picklist a dependent holds', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Rating__c', picklistValues: ['Hot'] }],
        ['a field of another card', { treeKey: ACCOUNT_TREE_KEY }],
        ['a nickname the object is not drawn with', { nickname: 'Lead_Other_NickName' }],
        ['a key that is not a string', { treeKey: 7 }],
        ['an object name that is not an api name', { objectApiName: 'Lead Name' }]
    ])('does nothing for %s', (_caseName, payload) => {

        expect(route(payload)).toBeUndefined();

    });

    it('does nothing before "rendered", or with no model', () => {

        const undrawnPanelState = buildDrawnPanelState();
        undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
        const modelLessPanelState = buildDrawnPanelState();
        modelLessPanelState.recipeDataMessage = undefined;

        expect(route({}, undrawnPanelState)).toBeUndefined();
        expect(route({}, modelLessPanelState)).toBeUndefined();

    });

    it('answers a loadPicklistValues that names a card with what the card\'s edit ticks, and one that names none as before', () => {

        const panelState = buildDrawnPanelState();
        panelState.loadablePicklistKeys = new Set(RecipeCockpitService.collectLoadablePicklistKeys(panelState.recipeDataMessage?.recipe as IRecipeCockpitRecipeViewModel));
        const leadTree = panelState.recipeDataMessage?.recipe.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);
        const load = (payload: Record<string, unknown>) => RecipeCockpitService.routePanelMessage({ command: 'loadPicklistValues', objectApiName: 'Lead', fieldApiName: 'Status', ...payload } as any, panelState) as any;

        expect(load({}).hostMessage).not.toHaveProperty('treeKey');
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).toMatchObject({ treeKey: LEAD_TREE_KEY, picklistValues: ['Open', 'Closed'] });
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('isEdited');
        expect(load({ treeKey: 7 })).toBeUndefined();

        ( leadTree as any ).fixedValues = [{ objectApiName: 'Lead', fieldApiName: 'Status', value: "${{ random_choice('Closed') }}", kind: 'expression' }];
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).toMatchObject({ chosenPicklistValues: ['Closed'], isEdited: true });

        ( leadTree as any ).fixedValues = [{ objectApiName: 'Lead', fieldApiName: 'Status', value: 'Open', kind: 'text' }];
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).toMatchObject({ isOtherEdit: true, isEdited: true });
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');

        // WITH NO EDIT, A GENERATED LINE THE BACKEND BUILDS STARTS THE TILES FROM WHAT IT CHOOSES; ONE IT DOES NOT BUILD STARTS THEM ALL TICKED
        ( leadTree as any ).fixedValues = undefined;
        const statusField = panelState.recipeDataMessage?.recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Lead')?.fields.find(field => field.fieldApiName === 'Status') as IRecipeCockpitFieldViewModel;
        statusField.recipeValue = "${{ random_choice('Closed') }}";
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).toMatchObject({ chosenPicklistValues: ['Closed'] });
        statusField.recipeValue = '"${{ faker.helpers.arrayElement([`Open`]) }}"\n### Driven by ValidationRule Open_Only';
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).toMatchObject({ chosenPicklistValues: ['Open'] });
        statusField.recipeValue = "${{ random_choice('Open','Closed') }}";
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');
        statusField.recipeValue = '"not json';
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');
        statusField.recipeValue = '"not json"x"';
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');
        delete ( statusField as Partial<IRecipeCockpitFieldViewModel> ).recipeValue;
        expect(load({ treeKey: LEAD_TREE_KEY }).hostMessage).not.toHaveProperty('chosenPicklistValues');
        expect(RecipeCockpitService.readPicklistValueChoice(panelState.recipeDataMessage?.recipe as IRecipeCockpitRecipeViewModel, LEAD_TREE_KEY, 'Gone__c', 'Status', ['Open']))
            .toEqual({ treeKey: LEAD_TREE_KEY });

        // AN EDIT OF A FIELD THE MODEL NO LONGER LISTS TICKS NOTHING IT CAN NAME
        expect(RecipeCockpitService.readPicklistValueChoice(panelState.recipeDataMessage?.recipe as IRecipeCockpitRecipeViewModel, LEAD_TREE_KEY, 'Lead', 'Gone__c', ['Open']))
            .toEqual({ treeKey: LEAD_TREE_KEY });

        // A CARD NOT ON SCREEN IS ANSWERED THE VALUES ALONE
        expect(load({ treeKey: 'Gone-Tree' }).hostMessage).not.toHaveProperty('treeKey');

    });

});

describe('routePanelMessage resetPicklistValueChoice (#479)', () => {

    const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
        const loadedRecipe = loadRecipeRun();
        const recipe: IRecipeCockpitRecipeViewModel = loadedRecipe.recipeViewModel;
        RecipeCockpitService.applyObjectSelections(recipe, new Map(), new Map(), undefined, new Map(), new Map());
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
        panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
        panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
        return panelState;
    };

    const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) =>
        RecipeCockpitService.routePanelMessage({ command: 'resetPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', ...payload } as any, panelState);

    it('routes a drawn, free picklist by its names alone, ignoring any values posted with them', () => {

        expect(route({ picklistValues: ['Closed'], value: 'x' })).toEqual({ kind: 'resetPicklistValueChoice', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status' });

    });

    it.each([
        ['a field that is not a picklist', { fieldApiName: 'Company' }],
        ['a dependent picklist', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Sub_Rating__c' }],
        ['a field of another card', { treeKey: ACCOUNT_TREE_KEY }],
        ['a nickname the object is not drawn with', { nickname: 'Lead_Other_NickName' }],
        ['a nickname that is not a string', { nickname: 7 }],
        ['a key that is not a string', { treeKey: 7 }],
        ['an object name that is not an api name', { objectApiName: 'Lead Name' }],
        ['a field name that is not an api name', { fieldApiName: '__proto__ x' }]
    ])('does nothing for %s', (_caseName, payload) => {

        expect(route(payload)).toBeUndefined();

    });

    it('does nothing before "rendered", or with no model', () => {

        const undrawnPanelState = buildDrawnPanelState();
        undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
        const modelLessPanelState = buildDrawnPanelState();
        modelLessPanelState.recipeDataMessage = undefined;

        expect(route({}, undrawnPanelState)).toBeUndefined();
        expect(route({}, modelLessPanelState)).toBeUndefined();

    });

});

describe('openRecipeCockpitPanel: saving a choice of values (#465)', () => {

    let receivedMessageHandler: (panelMessage: any) => Promise<void>;
    let disposeHandler: (() => void) | undefined;
    let postedPanelMessages: any[];

    const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
    const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;

    const buildWorkspaceState = () => {
        const storedValues = new Map<string, unknown>();
        return {
            get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
            update: jest.fn((key: string, value: unknown) => { storedValues.set(key, value); return Promise.resolve(); }) as jest.Mock
        };
    };

    const buildWebviewPanel = () => ({
        reveal: jest.fn(),
        dispose: jest.fn(),
        visible: true,
        onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
        webview: {
            html: '',
            postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
            onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                receivedMessageHandler = messageHandler;
                return { dispose: jest.fn() };
            })
        }
    });

    const acknowledgeLatest = () => receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });

    const openAndDraw = async () => {
        await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, buildWorkspaceState());
        await receivedMessageHandler({ command: 'ready' });
        await acknowledgeLatest();
    };

    const choose = (picklistValues: string[]) =>
        receivedMessageHandler({ command: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: picklistValues });

    const askForValues = async () => {
        postedPanelMessages = [];
        await receivedMessageHandler({ command: 'loadPicklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: LEAD_TREE_KEY });
        return lastPosted('picklistValues');
    };

    const committedRecipe = fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8');

    beforeEach(() => {
        postedPanelMessages = [];
        showWarningMessage.mockReset();
        (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
        jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
    });

    afterEach(() => {
        disposeHandler?.();
        disposeHandler = undefined;
        restoreRecipeFiles(LEAD_RECIPE_FILE_PATH, committedRecipe, undefined);
    });

    it('writes the choice with the recipe\'s own backend after the save confirmation, reads it back as ticked, and every value ticked again puts the recipe back byte for byte', async () => {

        expect(committedRecipe).toContain(GENERATED_STATUS_LINE);
        await openAndDraw();

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
        await choose(['Closed']);

        expect(showWarningMessage).toHaveBeenCalledTimes(1);
        expect(showWarningMessage.mock.calls[0][0]).toBe('Write an edited faker expression into Lead.Status?');
        const writtenLine = "    Status: \"${{ random_choice('Closed') }}\"";
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe.replace(GENERATED_STATUS_LINE, writtenLine));
        expect(RecipeCockpitFixedValueStore.parse(fs.readFileSync(LEAD_FIXED_VALUE_FILE_PATH, 'utf8')).entries).toEqual([{
            objectApiName: 'Lead', fieldApiName: 'Status', value: "${{ random_choice('Closed') }}",
            occurrences: [expect.objectContaining({ writtenLine: writtenLine, originalText: GENERATED_STATUS_LINE })]
        }]);
        expect(lastPosted('fieldEditResult')).toBeUndefined();
        await acknowledgeLatest();

        expect(await askForValues()).toMatchObject({ treeKey: LEAD_TREE_KEY, picklistValues: ['Open', 'Closed'], chosenPicklistValues: ['Closed'] });

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
        await choose(['Open', 'Closed']);

        expect(showWarningMessage.mock.calls[1][0]).toStartWith('Clear the edit of ');
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);
        expect(fs.existsSync(LEAD_FIXED_VALUE_FILE_PATH)).toBeFalse();

    });

    it('writes a faker-js recipe\'s choice with faker-js', async () => {

        jest.spyOn(RecipeCockpitService as any, 'readTreeFakerService').mockReturnValue('faker-js');
        await openAndDraw();

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
        await choose(['Open']);

        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe.replace(GENERATED_STATUS_LINE, '    Status: "${{ faker.helpers.arrayElement([`Open`]) }}"'));
        await acknowledgeLatest();
        expect(await askForValues()).toMatchObject({ chosenPicklistValues: ['Open'] });

    });

    it('answers every value ticked on a field with no edit as nothing to save, and asks and writes nothing', async () => {

        await openAndDraw();
        await choose(['Closed', 'Open']);

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('fieldEditResult')).toMatchObject({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues', refusal: RECIPE_COCKPIT_PICKLIST_CHOICE_UNCHANGED_REFUSAL });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

    });

    it('starts from, and compares a save with, what a narrowed generated line chooses -- not every declared value (#472 review)', async () => {

        await openAndDraw();
        const panelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
        const statusField = panelState.recipeDataMessage?.recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Lead')?.fields.find(field => field.fieldApiName === 'Status') as IRecipeCockpitFieldViewModel;
        // AS A VALIDATION RULE'S ISPICKVAL WRITES IT: THE BACKEND'S OWN CHOICE OVER FEWER VALUES, DOUBLE-QUOTED
        statusField.recipeValue = `"${new SnowfakeryRecipeFakerService().buildPicklistChoiceExpression(['Open'], false)}"\n### Driven by ValidationRule Status_Open_Only`;

        expect(await askForValues()).toMatchObject({ chosenPicklistValues: ['Open'] });

        await choose(['Open']);
        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('fieldEditResult')).toMatchObject({ refusal: RECIPE_COCKPIT_PICKLIST_CHOICE_UNCHANGED_REFUSAL });

        // TICKING A VALUE THE RULE LEFT OUT IS AN EDIT, NOT "NOTHING TO SAVE"
        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
        await choose(['Open', 'Closed']);
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe.replace(GENERATED_STATUS_LINE, "    Status: \"${{ random_choice('Open', 'Closed') }}\""));

    });

    it('refuses a choice whose expression would pass the edited expression\'s limit, under the tiles, and asks and writes nothing', async () => {

        await openAndDraw();
        const manyValues = Array.from({ length: 80 }, (_, valueIndex) => `Long picklist value number ${valueIndex}`);
        const panelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
        panelState.picklistDisplayValuesByObjectApiName.get('Lead')?.set('Status', { picklistValues: manyValues, recordTypePicklistValues: [] });

        await choose(manyValues.slice(1));

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('fieldEditResult')).toMatchObject({ edit: 'picklistValues', refusal: 'Not saved: the faker expression for the values you ticked is longer than 1000 characters.' });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

    });

    it('answers a cancelled confirmation under the tiles, and writes nothing', async () => {

        await openAndDraw();
        showWarningMessage.mockResolvedValueOnce(undefined);
        await choose(['Open']);

        expect(lastPosted('fieldEditResult')).toMatchObject({ edit: 'picklistValues', refusal: expect.any(String) });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

    });

    it('refuses under the tiles, and writes nothing, for a recipe whose path does not say which backend wrote it', async () => {

        jest.spyOn(RecipeCockpitService as any, 'readTreeFakerService').mockReturnValue(undefined);
        await openAndDraw();
        await choose(['Open']);

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('fieldEditResult')).toMatchObject({ edit: 'picklistValues', refusal: 'Not saved: the recipe file does not say which faker service it was written for.' });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

    });

    it('does nothing for a panel state that is no longer the open panel\'s, or a field it no longer draws', async () => {

        await openAndDraw();
        const action = { kind: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: ['Open'] };
        const panelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
        postedPanelMessages = [];

        await (RecipeCockpitService as any).setPicklistValueChoice(buildWebviewPanel(), RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT), action);
        await (RecipeCockpitService as any).setPicklistValueChoice(buildWebviewPanel(), panelState, { ...action, fieldApiName: 'Gone__c' });

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(postedPanelMessages).toEqual([]);
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

    });

    const reset = () =>
        receivedMessageHandler({ command: 'resetPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status' });

    it('puts a saved choice back byte for byte with Reset to generated, through the Clear confirmation, answered under the tiles (#479)', async () => {

        await openAndDraw();
        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL);
        await choose(['Closed']);
        expect(showWarningMessage.mock.calls[0][1].detail).toContain(`How ${RECIPE_COCKPIT_PICKLIST_RESET_LABEL} puts it back`);
        expect(showWarningMessage.mock.calls[0][1].detail).not.toContain('Clear');
        await acknowledgeLatest();
        expect(await askForValues()).toMatchObject({ isEdited: true });

        showWarningMessage.mockResolvedValueOnce(undefined);
        await reset();
        expect(showWarningMessage.mock.calls[1][0]).toStartWith('Clear the edit of ');
        expect(lastPosted('fieldEditResult')).toMatchObject({ edit: 'picklistValues', refusal: expect.any(String) });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).not.toBe(committedRecipe);

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
        postedPanelMessages = [];
        await reset();
        expect(lastPosted('fieldEditResult')).toBeUndefined();
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);
        expect(fs.existsSync(LEAD_FIXED_VALUE_FILE_PATH)).toBeFalse();
        await acknowledgeLatest();
        expect(await askForValues()).not.toHaveProperty('isEdited');

    });

    it('clears an edit that is not a choice of values with Reset to generated (#479)', async () => {

        const restore = pinFieldInRecipeFile(LEAD_RECIPE_FILE_PATH, 'Lead', 'Status', { value: '${{ random_choice("Open") }}', kind: 'expression' });
        try {
            await openAndDraw();
            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL);
            await reset();
            expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);
        } finally {
            restore();
        }

    });

    it('answers Reset to generated on a field with no edit as nothing to reset, under the tiles, and asks and writes nothing (#479)', async () => {

        await openAndDraw();
        await reset();

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('fieldEditResult')).toMatchObject({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues', refusal: RECIPE_COCKPIT_PICKLIST_RESET_NOTHING_REFUSAL });
        expect(fs.readFileSync(LEAD_RECIPE_FILE_PATH, 'utf8')).toBe(committedRecipe);

        postedPanelMessages = [];
        const action = { kind: 'resetPicklistValueChoice', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status' };
        await (RecipeCockpitService as any).resetPicklistValueChoice(buildWebviewPanel(), RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT), action);
        expect(postedPanelMessages).toEqual([]);

    });

    it('says a field edited some other way has an edit a choice replaces', async () => {

        const restore = pinFieldInRecipeFile(LEAD_RECIPE_FILE_PATH, 'Lead', 'Status', { value: '${{ random_choice("Open") }}', kind: 'expression' });
        try {
            await openAndDraw();
            const answer = await askForValues();
            expect(answer).toMatchObject({ isOtherEdit: true });
            expect(answer).not.toHaveProperty('chosenPicklistValues');
        } finally {
            restore();
        }

    });

});

describe('the panel script: a picklist\'s value tiles (#465)', () => {

    const loadHistoryRecipe = () => loadRecipeRun().recipeViewModel;

    const treeCardOf = (panel: any, treeKey: string) => panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === treeKey);

    const openRow = (treeKey: string, objectApiName: string, fieldApiName: string, prepareRecipe: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
        const panel = runPanelScript();
        const recipe = loadHistoryRecipe();
        prepareRecipe(recipe);
        panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
        panel.chooseTreeCard(treeCardOf(panel, treeKey));
        const objectElement = panel.findAll(treeCardOf(panel, treeKey), 'treeObject').find((element: any) => panel.objectNameOf(element) === objectApiName);
        panel.expandObject(objectElement);
        const rowElement = panel.fieldRowNamed(objectElement, fieldApiName);
        return { panel, rowElement };
    };

    const openEditor = (answer: Record<string, unknown> = {}, rowName: [string, string, string] = [LEAD_TREE_KEY, 'Lead', 'Status'], prepareRecipe?: (recipe: IRecipeCockpitRecipeViewModel) => void) => {
        const opened = openRow(...rowName, prepareRecipe);
        const toggleElement = opened.panel.findAll(opened.rowElement, 'picklistToggle')[0];
        toggleElement.dispatch('click');
        opened.panel.postToPanel({
            command: 'picklistValues', objectApiName: rowName[1], fieldApiName: rowName[2], treeKey: rowName[0],
            picklistValues: ['Open', 'Closed'], recordTypePicklistValues: [], renderSequence: 1, ...answer
        });
        const editorElement = opened.panel.findAll(opened.rowElement, 'picklistEditor')[0];
        return { ...opened, toggleElement, editorElement };
    };

    const tilesOf = (panel: any, editorElement: any) => panel.findAll(editorElement, 'picklistTile');
    const tileStates = (panel: any, editorElement: any) => tilesOf(panel, editorElement)
        .map((tileElement: any) => [panel.findAll(tileElement, 'picklistValue')[0].textContent, panel.findAll(tileElement, 'picklistTileCheck')[0].attributes['aria-checked']]);
    const choiceMessages = (panel: any) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setPicklistValueChoice');
    const saveOf = (panel: any, editorElement: any) => panel.findAll(editorElement, 'picklistEditorSave')[0];
    const resetOf = (panel: any, editorElement: any) => panel.findAll(editorElement, 'picklistEditorReset')[0];
    const resetMessages = (panel: any) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'resetPicklistValueChoice');

    it('opens the tiles under the faker value with every value ticked, each tile a check box named by its value', () => {

        const { panel, rowElement, toggleElement, editorElement } = openEditor();

        expect(toggleElement.textContent).toBe(RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL);
        expect(toggleElement.attributes['aria-expanded']).toBe('true');
        expect(panel.isHidden(editorElement)).toBe(false);
        expect(editorElement.attributes).toMatchObject({ role: 'group', 'aria-label': 'Edit values of Lead.Status' });
        expect(panel.postedHostMessages).toContainEqual({ command: 'loadPicklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: LEAD_TREE_KEY });
        expect(tileStates(panel, editorElement)).toEqual([['Open', 'true'], ['Closed', 'true']]);
        tilesOf(panel, editorElement).forEach((tileElement: any) => {
            const checkElement = panel.findAll(tileElement, 'picklistTileCheck')[0];
            expect(checkElement.classList.contains('sdtButton-check')).toBe(true);
            expect(checkElement.attributes.role).toBe('checkbox');
        });
        // NOTHING CHANGED YET, SO NOTHING TO SAVE (#479)
        expect(saveOf(panel, editorElement).disabled).toBe(true);
        expect(panel.isHidden(panel.findAll(editorElement, 'picklistEditorReason')[0])).toBe(true);
        expect(resetOf(panel, editorElement)).toBeUndefined();
        expect(panel.findAll(editorElement, 'fieldEditorHint')[0].textContent).toBe(`Tick the values Status generates. Save writes them into the recipe file; ${RECIPE_COCKPIT_PICKLIST_RESET_LABEL} puts back the lines the field had.`);
        expect(rowElement.children[rowElement.children.length - 1].classList.contains('picklistSection')).toBe(true);

    });

    it('toggles a tile on a click of the tile or its box, and posts only the ticked values, in order, on Save', () => {

        const { panel, editorElement } = openEditor({ picklistValues: ['Open', 'Closed', 'Pending'] });
        const [openTile, , pendingTile] = tilesOf(panel, editorElement);

        openTile.dispatch('click');
        panel.findAll(pendingTile, 'picklistTileCheck')[0].dispatch('click');
        expect(tileStates(panel, editorElement)).toEqual([['Open', 'false'], ['Closed', 'true'], ['Pending', 'false']]);
        expect(openTile.classList.contains('chosen')).toBe(false);
        expect(choiceMessages(panel)).toEqual([]);

        pendingTile.dispatch('click');
        saveOf(panel, editorElement).dispatch('click');

        expect(choiceMessages(panel)).toEqual([{ command: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: ['Closed', 'Pending'] }]);

        // ONE SAVE AT A TIME: A SECOND CLICK BEFORE THE HOST ANSWERS POSTS NOTHING
        expect(saveOf(panel, editorElement).disabled).toBe(true);
        saveOf(panel, editorElement).dispatch('click');
        expect(choiceMessages(panel)).toHaveLength(1);

    });

    it('enables Save only while the ticks differ from what the tiles opened with (#479)', () => {

        const { panel, editorElement } = openEditor({ chosenPicklistValues: ['Closed'] });
        const [openTile, closedTile] = tilesOf(panel, editorElement);
        expect(saveOf(panel, editorElement).disabled).toBe(true);

        openTile.dispatch('click');
        expect(saveOf(panel, editorElement).disabled).toBe(false);
        openTile.dispatch('click');
        expect(saveOf(panel, editorElement).disabled).toBe(true);

        // A DIFFERENT SET OF THE SAME SIZE IS A CHANGE
        openTile.dispatch('click');
        closedTile.dispatch('click');
        expect(saveOf(panel, editorElement).disabled).toBe(false);
        saveOf(panel, editorElement).dispatch('click');
        expect(choiceMessages(panel)).toEqual([{ command: 'setPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', picklistValues: ['Open'] }]);

    });

    it('enables Save from the start over another kind of edit, which any choice replaces (#479)', () => {

        const { panel, editorElement } = openEditor({ isOtherEdit: true, isEdited: true });
        expect(saveOf(panel, editorElement).disabled).toBe(false);

    });

    it('draws Reset to generated only for an edited field, posting its names and holding Save and Reset until the host answers (#479)', () => {

        const { panel, editorElement } = openEditor({ chosenPicklistValues: ['Closed'], isEdited: true });
        const resetElement = resetOf(panel, editorElement);

        expect(resetElement.textContent).toBe(RECIPE_COCKPIT_PICKLIST_RESET_LABEL);
        expect(resetElement.classList.contains('sdtButton-secondary')).toBe(true);
        expect(resetElement.classList.contains('sdtButton-compact')).toBe(true);
        expect(resetElement.disabled).toBe(false);
        const actionClasses = panel.findAll(editorElement, 'fieldEditorActions')[0].children.map((element: any) => element.classList.contains('picklistEditorSave') ? 'save' : element.classList.contains('picklistEditorReset') ? 'reset' : 'cancel');
        expect(actionClasses).toEqual(['save', 'reset', 'cancel']);

        tilesOf(panel, editorElement)[0].dispatch('click');
        resetElement.dispatch('click');
        expect(resetMessages(panel)).toEqual([{ command: 'resetPicklistValueChoice', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status' }]);
        expect(choiceMessages(panel)).toEqual([]);
        expect(resetElement.disabled).toBe(true);
        expect(saveOf(panel, editorElement).disabled).toBe(true);
        resetElement.dispatch('click');
        expect(resetMessages(panel)).toHaveLength(1);

        // A REFUSAL GIVES BOTH BACK, UNDER THE TILES
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues', refusal: 'Not saved: cancelled.' });
        expect(panel.findAll(editorElement, 'fieldEditorRefusal')[0].textContent).toBe('Not saved: cancelled.');
        expect(resetElement.disabled).toBe(false);
        expect(saveOf(panel, editorElement).disabled).toBe(false);

    });

    it('draws Reset to generated over another kind of edit too, and disabled on a locked picklist (#479)', () => {

        const other = openEditor({ isOtherEdit: true, isEdited: true });
        expect(resetOf(other.panel, other.editorElement).disabled).toBe(false);

        const locked = openEditor({ picklistValues: ['Very Hot'], isEdited: true }, [ACCOUNT_TREE_KEY, 'Account', 'Sub_Rating__c']);
        expect(resetOf(locked.panel, locked.editorElement).disabled).toBe(true);
        resetOf(locked.panel, locked.editorElement).dispatch('click');
        expect(resetMessages(locked.panel)).toEqual([]);

    });

    it('disables Save, saying why, while nothing is ticked', () => {

        const { panel, editorElement } = openEditor();
        tilesOf(panel, editorElement).forEach((tileElement: any) => tileElement.dispatch('click'));

        const reasonElement = panel.findAll(editorElement, 'picklistEditorReason')[0];
        expect(saveOf(panel, editorElement).disabled).toBe(true);
        expect(reasonElement.textContent).toBe(RECIPE_COCKPIT_PICKLIST_CHOICE_EMPTY_REASON);
        expect(panel.isHidden(reasonElement)).toBe(false);
        saveOf(panel, editorElement).dispatch('click');
        expect(choiceMessages(panel)).toEqual([]);

        tilesOf(panel, editorElement)[1].dispatch('click');
        expect(saveOf(panel, editorElement).disabled).toBe(false);
        expect(panel.isHidden(reasonElement)).toBe(true);

    });

    it.each([
        ['Cancel', (panel: any, editorElement: any) => panel.findAll(editorElement, 'picklistEditorCancel')[0].dispatch('click')],
        ['the × button', (panel: any, editorElement: any) => panel.findAll(editorElement, 'picklistEditorClose')[0].dispatch('click')],
        ['Escape', (panel: any, editorElement: any) => tilesOf(panel, editorElement)[0].dispatch('keydown', { key: 'Escape' })]
    ])('closes on %s, posts nothing, and shows Edit values again with focus on it', (_caseName, close) => {

        const { panel, editorElement, toggleElement } = openEditor();
        tilesOf(panel, editorElement)[0].dispatch('click');

        close(panel, editorElement);

        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);
        expect(toggleElement.attributes['aria-expanded']).toBe('false');
        expect(panel.activeElement()).toBe(toggleElement);
        expect(choiceMessages(panel)).toEqual([]);
        expect(tilesOf(panel, editorElement)).toEqual([]);

    });

    it('asks again on every open and starts from what the host says the edit ticks, saying when another kind of edit will be replaced', () => {

        const { panel, editorElement, toggleElement } = openEditor({ chosenPicklistValues: ['Closed'] });
        expect(tileStates(panel, editorElement)).toEqual([['Open', 'false'], ['Closed', 'true']]);
        expect(panel.findAll(editorElement, 'picklistEditorNote')).toEqual([]);

        panel.findAll(editorElement, 'picklistEditorCancel')[0].dispatch('click');
        toggleElement.dispatch('click');
        expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues')).toHaveLength(2);
        expect(panel.findAll(editorElement, 'picklistLoading')).toHaveLength(1);

        panel.postToPanel({ command: 'picklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: LEAD_TREE_KEY, picklistValues: ['Open', 'Closed'], recordTypePicklistValues: [], renderSequence: 1, isOtherEdit: true });
        expect(tileStates(panel, editorElement)).toEqual([['Open', 'true'], ['Closed', 'true']]);
        expect(panel.findAll(editorElement, 'picklistEditorNote')[0].textContent).toBe(RECIPE_COCKPIT_PICKLIST_OTHER_EDIT_NOTE);

    });

    it('draws nothing for an answer about another card, and an answer that arrives after the editor closed', () => {

        const { panel, rowElement } = openRow(LEAD_TREE_KEY, 'Lead', 'Status');
        const toggleElement = panel.findAll(rowElement, 'picklistToggle')[0];
        const editorElement = panel.findAll(rowElement, 'picklistEditor')[0];
        toggleElement.dispatch('click');

        panel.postToPanel({ command: 'picklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: ACCOUNT_TREE_KEY, picklistValues: ['Wrong'], recordTypePicklistValues: [], renderSequence: 1 });
        expect(tilesOf(panel, editorElement)).toEqual([]);

        panel.findAll(rowElement, 'picklistEditorClose')[0].dispatch('click');
        panel.postToPanel({ command: 'picklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: LEAD_TREE_KEY, picklistValues: ['Late'], recordTypePicklistValues: [], renderSequence: 1 });
        expect(tilesOf(panel, editorElement)).toEqual([]);

    });

    it('writes a refusal under the tiles and keeps them open, and closes them on any other answer', () => {

        const { panel, editorElement, toggleElement } = openEditor();
        tilesOf(panel, editorElement)[0].dispatch('click');
        saveOf(panel, editorElement).dispatch('click');

        const hostileRefusal = '<b>Not saved</b>';
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues', refusal: hostileRefusal });
        const refusalElement = panel.findAll(editorElement, 'fieldEditorRefusal')[0];
        expect(refusalElement.textContent).toBe(hostileRefusal);
        expect(refusalElement.attributes.role).toBe('alert');
        expect(panel.isHidden(editorElement)).toBe(false);
        // THE TICKS THE READER MADE ARE STILL THERE TO SAVE AGAIN
        expect(tileStates(panel, editorElement)).toEqual([['Open', 'false'], ['Closed', 'true']]);
        expect(saveOf(panel, editorElement).disabled).toBe(false);

        // AN ANSWER FOR THE ONE-BOX EDITOR, OR FOR ANOTHER MODEL, LEAVES THE TILES ALONE
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'fixedValue' });
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 9, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues' });
        expect(panel.isHidden(editorElement)).toBe(false);

        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues' });
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(toggleElement.attributes['aria-expanded']).toBe('false');

    });

    it('keeps Edit values hidden after a Save the host has not answered, though the place already says closed, and closes on Cancel (#495)', () => {

        const { panel, editorElement, toggleElement } = openEditor();
        tilesOf(panel, editorElement)[0].dispatch('click');
        saveOf(panel, editorElement).dispatch('click');

        // A CLICK THAT REACHES THE HIDDEN BUTTON ANYWAY CHANGES NOTHING
        toggleElement.dispatch('click');
        expect(panel.isHidden(editorElement)).toBe(false);
        expect(panel.isHidden(toggleElement)).toBe(true);

        panel.findAll(editorElement, 'picklistEditorCancel')[0].dispatch('click');
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);
        expect(toggleElement.attributes['aria-expanded']).toBe('false');

    });

    it('hides Edit values while the tiles are open, so Save or Cancel ends the edit, and shows it again with focus on it (#495)', () => {

        const { panel, rowElement, editorElement, toggleElement } = openEditor();
        expect(panel.isHidden(toggleElement)).toBe(true);
        expect(panel.isHidden(editorElement)).toBe(false);

        // CANCEL POSTS NOTHING AND PUTS THE BUTTON BACK
        panel.findAll(editorElement, 'picklistEditorCancel')[0].dispatch('click');
        expect(choiceMessages(panel)).toEqual([]);
        expect(resetMessages(panel)).toEqual([]);
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);
        expect(panel.activeElement()).toBe(toggleElement);

        // AN ACCEPTED SAVE CLOSES THE TILES AND PUTS THE BUTTON BACK
        toggleElement.dispatch('click');
        expect(panel.isHidden(toggleElement)).toBe(true);
        panel.postToPanel({ command: 'picklistValues', objectApiName: 'Lead', fieldApiName: 'Status', treeKey: LEAD_TREE_KEY, picklistValues: ['Open', 'Closed'], recordTypePicklistValues: [], renderSequence: 1 });
        tilesOf(panel, editorElement)[0].dispatch('click');
        saveOf(panel, editorElement).dispatch('click');
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues', refusal: 'Not saved' });
        expect(panel.isHidden(toggleElement)).toBe(true);
        panel.postToPanel({ command: 'fieldEditResult', renderSequence: 1, treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', edit: 'picklistValues' });
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);
        expect(panel.activeElement()).toBe(toggleElement);
        expect(panel.findAll(rowElement, 'picklistToggle')).toEqual([toggleElement]);

    });

    it('closes with × or Escape while the values load, before Save and Cancel are drawn, and shows Edit values again (#495)', () => {

        const { panel, rowElement } = openRow(LEAD_TREE_KEY, 'Lead', 'Status');
        const toggleElement = panel.findAll(rowElement, 'picklistToggle')[0];
        const editorElement = panel.findAll(rowElement, 'picklistEditor')[0];
        const closeElement = panel.findAll(rowElement, 'picklistEditorClose')[0];

        toggleElement.dispatch('click');
        expect(panel.isHidden(toggleElement)).toBe(true);
        expect(panel.findAll(editorElement, 'picklistLoading')).toHaveLength(1);
        expect(panel.findAll(editorElement, 'picklistEditorCancel')).toEqual([]);
        // FOCUS MOVES INTO THE EDITOR RATHER THAN STAYING ON A BUTTON THAT IS GONE
        expect(panel.activeElement()).toBe(closeElement);

        closeElement.dispatch('click');
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);

        toggleElement.dispatch('click');
        editorElement.dispatch('keydown', { key: 'Escape' });
        expect(panel.isHidden(editorElement)).toBe(true);
        expect(panel.isHidden(toggleElement)).toBe(false);

    });

    it('lists each record type\'s own values under the tiles as text, never as tiles', () => {

        const { panel, editorElement } = openEditor({ recordTypePicklistValues: [{ recordTypeDeveloperName: 'Business', picklistValues: ['Open'] }] });

        expect(tilesOf(panel, editorElement)).toHaveLength(2);
        expect(panel.findAll(editorElement, 'recordTypeHeading').map((element: any) => element.textContent)).toEqual(['Record type: Business']);

    });

    it('draws a locked picklist\'s tiles disabled with the reason, and a click changes nothing', () => {

        const { panel, editorElement } = openEditor({ picklistValues: ['Very Hot'] }, [ACCOUNT_TREE_KEY, 'Account', 'Sub_Rating__c']);

        const reasonElement = panel.findAll(editorElement, 'picklistEditorReason')[0];
        expect(reasonElement.textContent).not.toBe('');
        expect(panel.isHidden(reasonElement)).toBe(false);
        expect(saveOf(panel, editorElement).disabled).toBe(true);
        panel.findAll(editorElement, 'picklistTileCheck').forEach((checkElement: any) => expect(checkElement.disabled).toBe(true));

        tilesOf(panel, editorElement)[0].dispatch('click');
        expect(tileStates(panel, editorElement)).toEqual([['Very Hot', 'true']]);
        saveOf(panel, editorElement).dispatch('click');
        expect(choiceMessages(panel)).toEqual([]);

    });

    it('says when a picklist declares no values, with nothing to save', () => {

        const { panel, editorElement } = openEditor({ picklistValues: [] });

        expect(panel.findAll(editorElement, 'picklistEmpty').map((element: any) => element.textContent)).toEqual(['no values']);
        expect(saveOf(panel, editorElement).disabled).toBe(true);

    });

    it('writes every value as text, never as markup', () => {

        const hostileValue = '<img src=x onerror=alert(1)>';
        const { panel, editorElement } = openEditor({ picklistValues: [hostileValue] });

        expect(tileStates(panel, editorElement)).toEqual([[hostileValue, 'true']]);
        expect(panel.findAll(editorElement, 'picklistTileCheck')[0].attributes['aria-label']).toBe(hostileValue);

    });

});
