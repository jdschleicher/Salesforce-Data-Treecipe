import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_STANDARD_FIELDS_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #477: beside an object's "All fields" box (#410), a "Standard fields" box ticks or unticks every
    field whose api name does not end in __c, leaving each custom field's tick as it was, and the
    object's own "TODOs only" narrows that object's rows to the fields with a TODO. In the history
    workspace Account writes Name, ParentId and OwnerId (standard) and five custom fields, three of
    its fields are TODOs; Contact writes LastName and AccountId, AccountId a TODO; Lead writes Company
    and Status with no TODO.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_STANDARD_FIELDS = ['Name', 'ParentId', 'OwnerId'];
const ACCOUNT_CUSTOM_FIELDS = ['Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Sub_Rating__c', 'Regions__c'];

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldSelectionOf = (tree: IRecipeCockpitTreeViewModel, objectApiName: string) => tree.fieldSelection?.objects.find(objectFieldSelection => objectFieldSelection.objectApiName === objectApiName);

const untick = (recipe: IRecipeCockpitRecipeViewModel, fieldsByObject: Record<string, string[]>) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(),
    new Map([[ACCOUNT_TREE_KEY, new Map(Object.entries(fieldsByObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]])
);

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

const storedSelections = (excludedObjectApiNamesByFolderName: Record<string, unknown>, excludedFieldApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: {},
    validationRulesOffByFolderName: {}
});

answerInPanelConfirmationsThroughWarningMock();

beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readOrgDisplayDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, the "Standard fields" box and an object\'s own "TODOs only" (#477)', () => {

    describe('isStandardFieldApiName', () => {

        it.each([
            ['Name', true],
            ['ParentId', true],
            ['RecordTypeId', true],
            ['Legacy_Code__c', false],
            ['Legacy_Code__C', false],
            ['ns__Thing__c', false],
            ['Location__Latitude__s', true],
            ['Person__pc', true]
        ])('reads %s as standard: %s', (fieldApiName, isStandard) => {

            expect(RecipeCockpitService.isStandardFieldApiName(fieldApiName)).toBe(isStandard);

        });

    });

    describe('routePanelMessage', () => {

        const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it('routes the standard scope with the object\'s key, and the box with no scope as before', () => {

            const panelState = buildDrawnPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false, fieldScope: 'standard' } as any, panelState))
                .toEqual({ kind: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Account', isIncluded: false, fieldScope: 'standard' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: true } as any, panelState))
                .toEqual({ kind: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Account', isIncluded: true });

        });

        it.each([
            ['custom', 'custom'],
            ['an upper-cased scope', 'STANDARD'],
            ['a scope that is not a string', 1],
            ['a null scope', null]
        ])('does nothing for %s', (_caseName, fieldScope) => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false, fieldScope } as any, buildDrawnPanelState())).toBeUndefined();

        });

        it('does nothing for the standard scope on an object of another card', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Account', included: false, fieldScope: 'standard' } as any, buildDrawnPanelState())).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        const postedAccountExclusions = () => fieldSelectionOf(lastPosted('objectSelection'), 'Account')?.excludedFieldApiNames ?? [];
        const setStandard = (included: boolean, objectApiName = 'Account') => receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: objectApiName, included: included, fieldScope: 'standard' });

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
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

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        beforeEach(() => {
            postedPanelMessages = [];
            (vscode.commands.executeCommand as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('unticks every standard field and no custom one, then ticks them again', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await setStandard(false);
            expect(postedAccountExclusions()).toEqual(ACCOUNT_STANDARD_FIELDS);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [ACCOUNT_TREE_KEY]: { Account: ACCOUNT_STANDARD_FIELDS } }));

            await setStandard(true);
            expect(postedAccountExclusions()).toEqual([]);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, {}));

        });

        it('keeps a custom field\'s untick through both directions', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', included: false });

            await setStandard(false);
            expect(postedAccountExclusions()).toEqual(['Name', 'Legacy_Code__c', 'ParentId', 'OwnerId']);

            await setStandard(true);
            expect(postedAccountExclusions()).toEqual(['Legacy_Code__c']);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }));

        });

        it('ticks only the standard fields after "All fields" unticked everything', async () => {

            await openAndDraw(buildWorkspaceState());
            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false });

            await setStandard(true);

            expect(postedAccountExclusions()).toEqual(ACCOUNT_CUSTOM_FIELDS);

        });

        it('leaves a locked standard field ticked', async () => {

            await openAndDraw(buildWorkspaceState());
            const panelState = ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;
            const account = objectOf(panelState.recipeDataMessage!.recipe, 'Account');
            account.hasRecordTypeSections = true;
            account.fields.push({ ...account.fields[0], fieldApiName: 'RecordTypeId', lineNumber: 99 });

            await setStandard(false);

            const accountSelection = fieldSelectionOf(lastPosted('objectSelection'), 'Account');
            expect(accountSelection?.excludedFieldApiNames).toEqual(ACCOUNT_STANDARD_FIELDS);
            expect(accountSelection?.lockedFields).toContainEqual({ fieldApiName: 'RecordTypeId', reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON });

        });

        // FROM THE REVIEW OF #478: A STANDARD CONTROLLER WITH A CUSTOM DEPENDENT IS NOT STORED, SO UNTICKING THE DEPENDENT LATER CANNOT DROP IT
        it('leaves a standard controlling field of a custom dependent out of what it stores', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const panelState = ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;
            const subRating = objectOf(panelState.recipeDataMessage!.recipe, 'Account').fields.find(field => field.fieldApiName === 'Sub_Rating__c')!;
            subRating.controllingField = 'Name';

            await setStandard(false);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [ACCOUNT_TREE_KEY]: { Account: ['ParentId', 'OwnerId'] } }));

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Sub_Rating__c', included: false });
            expect(postedAccountExclusions()).toEqual(['Sub_Rating__c', 'ParentId', 'OwnerId']);

        });

        it('still frees a controlling field through "All fields", which unticks its dependents too', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false });

            expect(postedAccountExclusions()).toContain('Rating__c');

        });

        it('writes nothing for an excluded object', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }) });
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await setStandard(false, 'Contact');
            await setStandard(false, 'OtherChildObject__c');

            expect(workspaceState.update).not.toHaveBeenCalled();

        });

    });

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            const recipe = loadRecipe();
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        const objectNamed = (panel: Panel, objectApiName: string) => panel.objectElements().find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
        const expanded = (panel: Panel, objectApiName: string) => {
            const objectElement = objectNamed(panel, objectApiName);
            panel.expandObject(objectElement);
            return objectElement;
        };
        const rowOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldSelectAllRow')[0];
        const standardOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldSelectStandard')[0];
        const todosOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeObjectTodosToggle')[0];
        // THE ROW'S CHECK SPAN THAT HOLDS A BOX: EACH BOX HIDES WITH ITS SPAN (#477)
        const checkSpanOf = (panel: Panel, objectElement: any, toggleClassName: string) => panel.findAll(rowOf(panel, objectElement), 'treeFieldSelectAllCheck')
            .find((checkElement: any) => panel.findAll(checkElement, toggleClassName).length > 0);
        const postedSelectAll = (panel: Panel) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setAllFieldsIncluded');

        describe('the "Standard fields" box', () => {

            it('draws a labelled checkbox right of "All fields", ticked while every standard field is', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                const standardElement = standardOf(panel, account);
                const rowChildren = rowOf(panel, account).children;

                expect(panel.findAll(rowChildren[0], 'treeFieldSelectAll')).toHaveLength(1);
                expect(panel.findAll(rowChildren[1], 'treeFieldSelectStandard')).toEqual([standardElement]);
                expect(standardElement.tagName).toBe('button');
                expect(standardElement.classList.contains('sdtButton-check')).toBeTrue();
                expect(standardElement.attributes.role).toBe('checkbox');
                expect(standardElement.attributes['aria-checked']).toBe('true');
                expect(standardElement.textContent).toBe('✓');
                expect(standardElement.attributes.title).toBe('Every standard field ticked — click to leave every standard field out that can be unticked');
                expect(standardElement.attributes['aria-label']).toBe(`${RECIPE_COCKPIT_STANDARD_FIELDS_LABEL} of Account: ` + standardElement.attributes.title);
                expect(panel.findAll(rowChildren[1], 'treeFieldSelectStandardLabel')[0].textContent).toBe(RECIPE_COCKPIT_STANDARD_FIELDS_LABEL);

            });

            it('counts only the standard fields, so custom unticks leave it ticked and "All fields" mixed', () => {

                const panel = drawRecipe(recipe => untick(recipe, { Account: ACCOUNT_CUSTOM_FIELDS }));
                const account = expanded(panel, 'Account');

                expect(standardOf(panel, account).attributes['aria-checked']).toBe('true');
                expect(panel.findAll(panel.objectBodyOf(account), 'treeFieldSelectAll')[0].attributes['aria-checked']).toBe('mixed');

            });

            it('reads mixed and unticked from the standard fields, and posts the scope with names only', () => {

                const mixedPanel = drawRecipe(recipe => untick(recipe, { Account: ['Name'] }));
                const mixedElement = standardOf(mixedPanel, expanded(mixedPanel, 'Account'));
                expect(mixedElement.attributes['aria-checked']).toBe('mixed');
                expect(mixedElement.textContent).toBe('−');
                expect(mixedElement.attributes.title).toBe('2 of 3 standard fields ticked — click to tick every standard field');
                mixedElement.dispatch('click');
                expect(postedSelectAll(mixedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: true, fieldScope: 'standard' }]);

                const untickedPanel = drawRecipe(recipe => untick(recipe, { Account: ACCOUNT_STANDARD_FIELDS }));
                const untickedAccount = expanded(untickedPanel, 'Account');
                const untickedElement = standardOf(untickedPanel, untickedAccount);
                expect(untickedElement.attributes['aria-checked']).toBe('false');
                panelLabelClick(untickedPanel, untickedAccount);
                expect(postedSelectAll(untickedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: true, fieldScope: 'standard' }]);
                // ONLY THE HOST'S ANSWER REDRAWS IT
                expect(untickedElement.attributes['aria-checked']).toBe('false');

                const tickedPanel = drawRecipe();
                standardOf(tickedPanel, expanded(tickedPanel, 'Account')).dispatch('click');
                expect(postedSelectAll(tickedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false, fieldScope: 'standard' }]);

            });

            const panelLabelClick = (panel: Panel, objectElement: any) => panel.findAll(rowOf(panel, objectElement), 'treeFieldSelectStandardLabel')[0].dispatch('click');

            it('is hidden for an object whose fields are all custom or whose standard fields are all locked', () => {

                const panel = drawRecipe(recipe => {
                    treeOf(recipe, ACCOUNT_TREE_KEY).fieldSelection = { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'LastName', reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON }, { fieldApiName: 'AccountId', reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON }] }] };
                });
                const other = expanded(panel, 'OtherChildObject__c');
                const contact = expanded(panel, 'Contact');

                expect(panel.isHidden(checkSpanOf(panel, other, 'treeFieldSelectStandard'))).toBeTrue();
                expect(panel.isHidden(checkSpanOf(panel, contact, 'treeFieldSelectStandard'))).toBeTrue();
                expect(panel.isHidden(rowOf(panel, contact))).toBeFalse();

            });

            // FROM THE REVIEW OF #478: THE PANEL'S RULE IS HELD TO THE HOST'S
            it('counts exactly the fields the host reads as standard', () => {

                const names = ['Name', 'Thing__C', 'Person__pc', 'Spot__Latitude__s', 'ns__Item__c', 'Legacy_Code__c'];
                const panel = drawRecipe(recipe => {
                    const account = objectOf(recipe, 'Account');
                    const template = account.fields[0];
                    account.fields = names.map((fieldApiName, fieldIndex) => ({ ...template, fieldApiName, controllingField: '', lineNumber: 100 + fieldIndex }));
                });
                const standardElement = standardOf(panel, expanded(panel, 'Account'));
                const standardNames = names.filter(fieldApiName => RecipeCockpitService.isStandardFieldApiName(fieldApiName));

                expect(standardNames).toEqual(['Name', 'Person__pc', 'Spot__Latitude__s']);
                expect(standardElement.attributes.title).toBe('Every standard field ticked — click to leave every standard field out that can be unticked');

                const mixedPanel = drawRecipe(recipe => {
                    const account = objectOf(recipe, 'Account');
                    const template = account.fields[0];
                    account.fields = names.map((fieldApiName, fieldIndex) => ({ ...template, fieldApiName, controllingField: '', lineNumber: 100 + fieldIndex }));
                    untick(recipe, { Account: ['Name'] });
                });
                expect(standardOf(mixedPanel, expanded(mixedPanel, 'Account')).attributes.title).toBe(`2 of ${standardNames.length} standard fields ticked — click to tick every standard field`);

            });

            it('is disabled while the object is excluded', () => {

                const panel = drawRecipe(recipe => RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]), new Map()));
                const standardElement = standardOf(panel, expanded(panel, 'Contact'));

                expect(standardElement.disabled).toBeTrue();
                expect(standardElement.attributes.title).toBe('Contact is excluded, so its fields are read-only');
                standardElement.dispatch('click');
                expect(postedSelectAll(panel)).toEqual([]);

            });

        });

        describe('an object\'s own "TODOs only"', () => {

            it('draws an unticked check with the object\'s TODO count, last in the row', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                const todosElement = todosOf(panel, account);
                const rowChildren = rowOf(panel, account).children;

                expect(panel.findAll(rowChildren[rowChildren.length - 1], 'treeObjectTodosToggle')).toEqual([todosElement]);
                expect(todosElement.classList.contains('sdtButton-check')).toBeTrue();
                expect(todosElement.attributes.role).toBe('checkbox');
                expect(todosElement.attributes['aria-checked']).toBe('false');
                expect(todosElement.disabled).toBeFalse();
                expect(panel.findAll(rowOf(panel, account), 'treeObjectTodosLabel')[0].textContent).toBe(`${RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL} (3)`);

            });

            it('narrows only its own object\'s rows, posts nothing, and gives them back', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                const contact = expanded(panel, 'Contact');
                const postedBefore = panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace').length;

                todosOf(panel, account).dispatch('click');

                expect(todosOf(panel, account).attributes['aria-checked']).toBe('true');
                expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'ParentId', 'OwnerId']);
                expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName', 'AccountId']);
                expect(panel.isHidden(panel.objectBodyOf(account))).toBeFalse();
                expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace')).toHaveLength(postedBefore);

                todosOf(panel, account).dispatch('click');
                expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);

            });

            it('combines with the Treecipe search', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                todosOf(panel, account).dispatch('click');

                panel.typeIntoFilter('parent');

                expect(panel.visibleFieldNamesOf(account)).toEqual(['ParentId']);

            });

            // FROM THE REVIEW OF #478: ONE OBJECT'S CLICK NEVER RE-RUNS THE CARD'S EXPAND BUDGET
            it('folds and opens no other object, under a search or with none', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                const contact = expanded(panel, 'Contact');
                panel.typeIntoFilter('name');
                const isOpen = (objectElement: any) => !panel.isHidden(panel.objectBodyOf(objectElement));
                const openBefore = panel.objectElements().map(isOpen);
                panel.expandObject(contact);
                const openAfterReader = panel.objectElements().map(isOpen);

                todosOf(panel, account).dispatch('click');

                expect(panel.objectElements().map(isOpen)).toEqual(openAfterReader);
                expect(isOpen(account)).toBeTrue();
                expect(openBefore.length).toBe(openAfterReader.length);

            });

            it('combines with the card-wide "TODOs only", and counts its hidden rows in the tab\'s count', () => {

                const panel = drawRecipe();
                const account = expanded(panel, 'Account');
                const matchCount = () => panel.findAll(panel.treeCards()[0], 'tabMatchCount')[0].textContent;
                const totalBefore = matchCount();

                todosOf(panel, account).dispatch('click');
                expect(matchCount()).not.toBe(totalBefore);
                expect(matchCount()).toMatch(/^\d+ of /);

                panel.findAll(panel.treeCards()[0], 'treeTodosToggle')[0].dispatch('click');
                expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'ParentId', 'OwnerId']);

                todosOf(panel, account).dispatch('click');
                expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'ParentId', 'OwnerId']);
                expect(todosOf(panel, account).attributes['aria-checked']).toBe('false');

            });

            it('is disabled with a reason on an object with no TODO', () => {

                const panel = drawRecipe();
                const lead = expanded(panel, 'Lead');
                const todosElement = todosOf(panel, lead);

                expect(todosElement.disabled).toBeTrue();
                expect(todosElement.attributes.title).toBe(RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE);
                todosElement.dispatch('click');
                expect(panel.visibleFieldNamesOf(lead)).toEqual(['Company', 'Status']);

            });

            const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);

            it('is saved in the place by object key, and restored in the next document', () => {

                const firstPanel = drawRecipe();
                todosOf(firstPanel, expanded(firstPanel, 'Account')).dispatch('click');
                expect(savedTreeOf(firstPanel).todosOnlyObjectKeys).toEqual(['Account\n']);

                const panel = drawRecipe(undefined, firstPanel.savedState());
                const account = objectNamed(panel, 'Account');

                expect(todosOf(panel, account).attributes['aria-checked']).toBe('true');
                expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'ParentId', 'OwnerId']);

                todosOf(panel, account).dispatch('click');
                expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('todosOnlyObjectKeys');

            });

            it('drops a saved key naming an object that is gone or has no TODO', () => {

                const firstPanel = drawRecipe();
                todosOf(firstPanel, expanded(firstPanel, 'Account')).dispatch('click');
                const savedState = firstPanel.savedState();
                savedTreeOf(firstPanel).todosOnlyObjectKeys.push('Gone__c\n', 'Lead\n');

                const panel = drawRecipe(recipe => {
                    objectOf(recipe, 'Account').fields.forEach(field => { delete field.todos; });
                    delete objectOf(recipe, 'Account').todos;
                }, savedState);
                const account = expanded(panel, 'Account');

                expect(todosOf(panel, account).attributes['aria-checked']).toBe('false');
                expect(todosOf(panel, account).disabled).toBeTrue();
                expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);

            });

            it('keeps the keys through normalizePanelPlace only when there are any', () => {

                const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
                    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                    runFolderName: CURRENT_RUN_FOLDER_NAME,
                    isOrgPickerInUse: false,
                    isFavoritesOnly: false,
                    scrollY: 0,
                    trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
                });
                const normalizedTree = (todosOnlyObjectKeys: unknown) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith({ todosOnlyObjectKeys }))?.trees[0];

                expect(normalizedTree(['Account\n'])?.todosOnlyObjectKeys).toEqual(['Account\n']);
                [[], 'Account', 1, null, undefined].forEach(candidateValue => expect(normalizedTree(candidateValue)).not.toHaveProperty('todosOnlyObjectKeys'));

            });

        });

    });

});
