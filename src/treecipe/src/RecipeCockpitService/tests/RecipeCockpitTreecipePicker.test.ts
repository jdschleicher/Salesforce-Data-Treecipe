import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RECIPE_COCKPIT_TREECIPES_SEARCH_MORE_SUFFIX,
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_NO_FAVORITES_MESSAGE,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH,
    RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX,
    RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT,
    RECIPE_COCKPIT_TREE_PICKER_NO_OBJECTS,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The Treecipes section draws ONE card, chosen in a dropdown, under one search across every card
    (#374). Every test runs the REAL panel script against the fake DOM.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const OTHER_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-09-10T00-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';

type Panel = ReturnType<typeof runPanelScript>;

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const buildUngroupedTree = (): IRecipeCockpitTreeViewModel => ({
    treeKey: '',
    title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    folderName: '',
    objects: [],
    fieldCount: 0
});

const treeKeys = [ACCOUNT_TREE_KEY, LEAD_TREE_KEY, ''];

const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, panelScriptOptions = {}, extraMessage: any = {}) => {
    const panel = runPanelScript(panelScriptOptions);
    const recipe = loadRecipe();
    recipe.trees.push(buildUngroupedTree());
    recipeChanges(recipe);
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, ...extraMessage });
    return { panel, recipe };
};

const cardOf = (panel: Panel, treeKey: string) => panel.treeCards()[treeKeys.indexOf(treeKey)];
const drawnTreeKeys = (panel: Panel) => treeKeys.filter(treeKey => !panel.isHidden(cardOf(panel, treeKey)));
const chosenLabel = (panel: Panel) => panel.treePicker().children[Number(panel.treePicker().value)]?.textContent;
const choose = (panel: Panel, optionLabel: string) => panel.chooseTreeByLabel(optionLabel);
const favoritesToggleOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'favoritesToggle')[0];
const noFavoritesOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'emptyState')
    .find((element: any) => element.textContent === RECIPE_COCKPIT_NO_FAVORITES_MESSAGE);
const treecipesSectionBodyOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'cockpitSection')
    .find((sectionElement: any) => sectionElement.attributes.id === 'cockpitTreecipesSection').children[1];
const searchCountOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'treecipesSearchCount')[0].textContent;
const resultsOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'treecipesSearchResults')[0];
const resultRows = (panel: Panel) => panel.findAll(resultsOf(panel), 'treecipesResult').map((resultElement: any) => [
    panel.findAll(resultElement, 'treecipesResultKind')[0].textContent,
    panel.findAll(resultElement, 'treecipesResultText')[0].textContent
]);
const resultGroups = (panel: Panel) => panel.findAll(resultsOf(panel), 'treecipesResultTree').map((element: any) => element.textContent);
const resultNamed = (panel: Panel, kindLabel: string, resultText: string) => panel.findAll(resultsOf(panel), 'treecipesResult')
    .find((resultElement: any) => panel.findAll(resultElement, 'treecipesResultKind')[0].textContent === kindLabel
        && panel.findAll(resultElement, 'treecipesResultText')[0].textContent === resultText);
const objectNamed = (panel: Panel, treeKey: string, objectApiName: string) => panel.findAll(cardOf(panel, treeKey), 'treeObject')
    .find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
const selectedTabOf = (panel: Panel, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'treeTab')
    .find((tabElement: any) => tabElement.classList.contains('selected'))?.textContent;
const objectsLineOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'treePickerObjects')[0];
// THE LINE AS READ: EVERY TEXT BUT THE TOGGLE'S, WHICH IS A CONTROL RATHER THAN A PART OF THE LIST (#464)
const lineTextOf = (element: any): string => element.classList.contains('treePickerObjectsToggle') ? ''
    : element.children.length === 0 ? element.textContent : element.children.map(lineTextOf).join('');
const objectsLineText = (panel: Panel) => lineTextOf(objectsLineOf(panel));
const objectsListOf = (panel: Panel) => panel.findAll(objectsLineOf(panel), 'treePickerObjectsList')[0];
const objectsToggleOf = (panel: Panel) => panel.findAll(objectsLineOf(panel), 'treePickerObjectsToggle')[0];
const cutObjectsList = (panel: Panel) => { Object.assign(objectsListOf(panel), { scrollWidth: 900, clientWidth: 300 }); panel.resizeWindow(); };
const fitObjectsList = (panel: Panel) => { Object.assign(objectsListOf(panel), { scrollWidth: 300, clientWidth: 300 }); panel.resizeWindow(); };
const excludedObjectsOf = (panel: Panel) => panel.findAll(objectsLineOf(panel), 'treePickerObject')
    .filter((element: any) => element.classList.contains('excluded'))
    .map((element: any) => element.textContent);
const ACCOUNT_TREE_LINE = 'Insert order:Account → Contact → OtherChildObject__c · 3 objects';
const commandsPosted = (panel: Panel) => panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);

describe('RecipeCockpitService, the Treecipes dropdown and section search (#374)', () => {

    describe('the dropdown', () => {

        it('lists every card in RecipeFiles order by its display title, the ungrouped card included, a favorite starred', () => {

            const { panel } = drawRecipe(recipe => {
                recipe.trees[1].customName = 'Leads';
                recipe.trees[1].isFavorite = true;
            });

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c', '★ Leads', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            expect(panel.treePicker().disabled).toBe(false);
            expect(panel.treePicker().attributes['aria-label']).toBe('Treecipe');

        });

        // #389: EACH OPTION IS THE FOLDER THE TREE WAS WRITTEN TO, AND A FOLDER A HAND-EDITED WRAPPER REPEATS IS NUMBERED
        it('names each option by its folder, numbering a repeated folder so the options differ', () => {

            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees = RecipeCockpitService.buildRecipeTreeViewModels({
                recipeTrees: [{ objectApiNames: ['Account', 'Contact', 'OtherChildObject__c'] }, { objectApiNames: ['Lead'] }, { objectApiNames: ['Lead'] }],
                parentLookupsByObjectApiName: new Map()
            }, recipe.objects, [], 'run').trees;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c', 'Lead-ONLY', 'Lead-ONLY (2)']);

            choose(panel, 'Lead-ONLY (2)');
            expect(chosenLabel(panel)).toBe('Lead-ONLY (2)');

        });

        it('sits in the Treecipes section under the search box and its results, above the one card drawn', () => {

            const { panel } = drawRecipe();
            const controls = treecipesSectionBodyOf(panel).children[0];

            expect(controls.classList.contains('treecipesControls')).toBe(true);
            expect(controls.children.map((element: any) => element.className.split(' ')[0])).toEqual(['treecipesSearch', 'treecipesSearchResults', 'treePicker', 'treePickerObjects']);
            expect(treecipesSectionBodyOf(panel).children[1].classList.contains('treesView')).toBe(true);

        });

        it('draws only the first card, already built, until another is chosen, and its header neither folds it nor draws a ▸', () => {

            const { panel } = drawRecipe();

            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(panel.isHidden(panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeBody')[0])).toBe(false);
            expect(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeTab')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeToggle')).toEqual([]);
            // ✎ AND ☆ STAY ON THE HEADER
            expect(panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeFavorite')).toHaveLength(1);
            expect(panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeRename')).toHaveLength(1);

            panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeHeader')[0].dispatch('click');
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

            choose(panel, 'Lead-ONLY');

            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(chosenLabel(panel)).toBe('Lead-ONLY');
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Treecipe');

        });

        it('never lists orgs on its own draw, and lists them once the reader chooses a card on its Treecipe tab, as opening a card did', () => {

            const { panel } = drawRecipe();
            expect(commandsPosted(panel)).not.toContain('loadDataOrgs');

            choose(panel, 'Lead-ONLY');

            expect(commandsPosted(panel).filter(command => command === 'loadDataOrgs')).toHaveLength(1);

        });

        it('lets a keystroke in the section search finish the fade of a card the reader just picked', () => {

            jest.useFakeTimers();
            try {
                const { panel } = drawRecipe();
                choose(panel, 'Lead-ONLY');
                expect(cardOf(panel, LEAD_TREE_KEY).classList.contains('motionReveal')).toBe(true);

                panel.typeIntoTreecipesSearch('Lead');

                expect(cardOf(panel, LEAD_TREE_KEY).classList.contains('motionReveal')).toBe(true);
            } finally {
                jest.useRealTimers();
            }

        });

        it('keeps each card\'s own tab, search and opened objects while another is on screen', () => {

            const { panel } = drawRecipe();
            panel.expandObject(objectNamed(panel, ACCOUNT_TREE_KEY, 'Contact'));
            panel.typeIntoFilter('Name', cardOf(panel, ACCOUNT_TREE_KEY));
            const accountSearchInput = panel.findAll(panel.tabPanelOf(cardOf(panel, ACCOUNT_TREE_KEY), 'treeStructure'), 'tabSearchInput')[0];

            choose(panel, 'Lead-ONLY');
            panel.openTab(cardOf(panel, LEAD_TREE_KEY), 'Previously Used Data Sets');
            choose(panel, 'Account-thru-OtherChildObject__c');

            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(accountSearchInput.value).toBe('Name');
            expect(panel.findAll(panel.tabPanelOf(cardOf(panel, ACCOUNT_TREE_KEY), 'treeStructure'), 'tabSearchInput')[0]).toBe(accountSearchInput);

            choose(panel, 'Lead-ONLY');
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');

        });

        it('given a one-tree run, still draws the dropdown with its one entry', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees = [recipe.trees[1]]; });

            expect(panel.treePickerLabels()).toEqual(['Lead-ONLY']);
            expect(panel.treePicker().disabled).toBe(false);
            expect(panel.shownTreeCards()).toHaveLength(1);

        });

        it('given a run with no trees, draws the notice and neither a dropdown nor a section search', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees = []; });

            expect(panel.treePicker()).toBeUndefined();
            expect(panel.findAll(panel.cockpitBodyElement, 'treecipesSearchInput')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState').map((element: any) => element.textContent)[0]).toContain('no relationship trees');

        });

        it('relabels its option in place when the host renames or stars the card, keeping the card on screen', () => {

            const { panel } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            panel.postToPanel({ command: 'treePreferences', renderSequence: 1, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Leads', isFavorite: true }] });

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c', '★ Leads', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            expect(chosenLabel(panel)).toBe('★ Leads');
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);

        });

    });

    describe('the reader\'s place', () => {

        it('saves the chosen card, only when it is not the first, and a rebuilt document opens on it', () => {

            const { panel, recipe } = drawRecipe();
            expect(panel.savedState()).not.toHaveProperty('selectedTreeKey');

            choose(panel, 'Lead-ONLY');
            expect(panel.savedState().selectedTreeKey).toBe(LEAD_TREE_KEY);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace').pop().place.selectedTreeKey).toBe(LEAD_TREE_KEY);

            const reopenedPanel = runPanelScript({ savedState: panel.savedState() });
            reopenedPanel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            expect(drawnTreeKeys(reopenedPanel)).toEqual([LEAD_TREE_KEY]);
            expect(chosenLabel(reopenedPanel)).toBe('Lead-ONLY');
            // CHOOSING A CARD ON ITS TREECIPE TAB USED THE ORG PICKER, AS OPENING ONE DID, SO THE REBUILT DOCUMENT ASKS AGAIN AFTER THE DRAW
            expect(panel.savedState().isOrgPickerInUse).toBe(true);
            expect(commandsPosted(reopenedPanel).indexOf('loadDataOrgs')).toBeGreaterThan(commandsPosted(reopenedPanel).indexOf('rendered'));

        });

        it('opens on the place the host kept, when the document has none of its own', () => {

            const hostPlace = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0, trees: [], selectedTreeKey: '' };
            const { panel } = drawRecipe(() => undefined, {}, { restorePlace: hostPlace });

            expect(drawnTreeKeys(panel)).toEqual(['']);
            expect(chosenLabel(panel)).toBe(RECIPE_COCKPIT_UNGROUPED_TREE_TITLE);

        });

        it.each([
            ['a card the run no longer has', 'Gone-ONLY'],
            ['__proto__', '__proto__'],
            ['a name that is not a string', 7]
        ])('given a saved choice naming %s, opens on the first card without an error', (_description, selectedTreeKey) => {

            const savedState = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0, trees: [], selectedTreeKey };
            const { panel } = drawRecipe(() => undefined, { savedState });

            expect(commandsPosted(panel)).not.toContain('renderFailed');
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(panel.savedState()).not.toHaveProperty('selectedTreeKey');

        });

        it('given an older place with per-card expanded state, opens on the first card and ignores what no longer applies', () => {

            const olderPlace = {
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: CURRENT_RUN_FOLDER_NAME,
                isOrgPickerInUse: false,
                isFavoritesOnly: false,
                scrollY: 0,
                trees: [
                    { treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'datasets', searchQueries: { treecipe: '', datasets: '09-21' }, expandedObjectKeys: [], openPicklistKeys: [] },
                    { treeKey: ACCOUNT_TREE_KEY, isExpanded: false, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: ['Account\n'], openPicklistKeys: [] }
                ]
            };
            const { panel } = drawRecipe(() => undefined, { savedState: olderPlace });

            expect(commandsPosted(panel)).not.toContain('renderFailed');
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(panel.isHidden(panel.objectBodyOf(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account')))).toBe(false);

            choose(panel, 'Lead-ONLY');
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');

        });

        it('given an older place and a focus, opens on the focused card', () => {

            const olderPlace = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [] }] };
            const { panel } = drawRecipe(() => undefined, { savedState: olderPlace }, { focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });

            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(chosenLabel(panel)).toBe('Lead-ONLY');
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');

        });

        it('keeps the choice across a reload of the same run in the same document, and starts on the first card for another run', () => {

            const { panel, recipe } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);

            panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: OTHER_RUN_FOLDER_NAME }, renderSequence: 3 });
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

        });

        it('normalizePanelPlace keeps the choice and the section search only as bounded, non-empty text', () => {

            const basePlace = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0, trees: [] };

            expect(RecipeCockpitService.normalizePanelPlace({ ...basePlace, selectedTreeKey: LEAD_TREE_KEY, treecipesSearchText: ' Rating ' }))
                .toEqual({ ...basePlace, selectedTreeKey: LEAD_TREE_KEY, treecipesSearchText: ' Rating ' });
            expect(RecipeCockpitService.normalizePanelPlace({ ...basePlace, selectedTreeKey: '', treecipesSearchText: '' })).toEqual(basePlace);
            expect(RecipeCockpitService.normalizePanelPlace({ ...basePlace, selectedTreeKey: 7, treecipesSearchText: ['x'] })).toEqual(basePlace);
            expect(RecipeCockpitService.normalizePanelPlace({ ...basePlace, selectedTreeKey: 'x'.repeat(100000) })).toEqual(basePlace);
            // A PLACE SAVED BEFORE #374 HAS NEITHER
            expect(RecipeCockpitService.normalizePanelPlace(basePlace)).toEqual(basePlace);

        });

    });

    describe('the objects line under the dropdown (#385)', () => {

        it('names the shown card\'s objects in insert order, with a count, right under the dropdown', () => {

            const { panel } = drawRecipe();

            expect(panel.isHidden(objectsLineOf(panel))).toBe(false);
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);
            expect(excludedObjectsOf(panel)).toEqual([]);

        });

        it('lists an object written more than once, and each iteration, once', () => {

            const { panel } = drawRecipe(recipe => {
                recipe.trees[0].objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });
                recipe.trees[0].objects.push({ objectApiName: 'Contact', parentLookups: [] });
            });

            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

        });

        it('follows the dropdown: a pick, Favorites only, a focus and a result click', () => {

            const { panel, recipe } = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });

            choose(panel, 'Lead-ONLY');
            expect(objectsLineText(panel)).toBe('Insert order:Lead · 1 object');

            favoritesToggleOf(panel).dispatch('click');
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);
            favoritesToggleOf(panel).dispatch('click');

            panel.postToPanel({ command: 'focusTree', renderSequence: 1, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });
            expect(objectsLineText(panel)).toBe('Insert order:Lead · 1 object');

            panel.typeIntoTreecipesSearch('contact');
            resultNamed(panel, 'object', 'Contact').dispatch('click');
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'treecipe' } });
            expect(objectsLineText(panel)).toBe('Insert order:Lead · 1 object');

        });

        it('describes the card a rebuilt document restores', () => {

            const { panel, recipe } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            const reopenedPanel = runPanelScript({ savedState: panel.savedState() });
            reopenedPanel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            expect(objectsLineText(reopenedPanel)).toBe('Insert order:Lead · 1 object');

        });

        it('keeps describing the card on screen while the section search does not match it', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('Company');
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

            panel.typeIntoTreecipesSearch('zzz-nothing');
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

        });

        it('is hidden while no card is drawn, and comes back with the card', () => {

            const { panel } = drawRecipe();

            favoritesToggleOf(panel).dispatch('click');
            expect(panel.isHidden(objectsLineOf(panel))).toBe(true);
            expect(objectsLineOf(panel).children).toEqual([]);

            favoritesToggleOf(panel).dispatch('click');
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

        });

        it('given a run with no trees, draws no line', () => {

            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees = [];
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            expect(objectsLineOf(panel)).toBeUndefined();

        });

        it('lists the ungrouped card\'s objects in the order the host gave them', () => {

            const { panel } = drawRecipe(recipe => {
                recipe.trees[2].objects.push({ objectApiName: 'Zeta__c', parentLookups: [] }, { objectApiName: 'Alpha__c', parentLookups: [] });
            });
            choose(panel, RECIPE_COCKPIT_UNGROUPED_TREE_TITLE);

            expect(objectsLineText(panel)).toBe('Insert order:Zeta__c → Alpha__c · 2 objects');

        });

        it('given a card with no objects, says so', () => {

            const { panel } = drawRecipe();
            choose(panel, RECIPE_COCKPIT_UNGROUPED_TREE_TITLE);

            expect(objectsLineText(panel)).toBe('Insert order:' + RECIPE_COCKPIT_TREE_PICKER_NO_OBJECTS);

        });

        it('marks an excluded and an auto-excluded object in text, and redraws in place when the selection changes', () => {

            const objectSelection = {
                exclusions: [
                    { objectApiName: 'Contact', kind: 'excluded' },
                    { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
                ],
                disabledLookups: [] as any[],
                includedObjectCount: 1,
                objectCount: 3
            };
            const { panel } = drawRecipe(recipe => { recipe.trees[0].objectSelection = objectSelection as any; });
            const lineElement = objectsLineOf(panel);

            expect(objectsLineText(panel)).toBe('Insert order:Account → Contact (excluded) → OtherChildObject__c (auto-excluded) · 3 objects');
            expect(excludedObjectsOf(panel)).toEqual(['Contact (excluded)', 'OtherChildObject__c (auto-excluded)']);

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 });

            expect(objectsLineOf(panel)).toBe(lineElement);
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

            // AN UPDATE TO A CARD NOT ON SCREEN LEAVES THE LINE ALONE
            panel.postToPanel({ command: 'objectSelection', treeKey: LEAD_TREE_KEY, renderSequence: 1, objectSelection: { ...objectSelection, exclusions: [{ objectApiName: 'Lead', kind: 'excluded' }] } });
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);
            choose(panel, 'Lead-ONLY');
            expect(objectsLineText(panel)).toBe('Insert order:Lead (excluded) · 1 object');

        });

        it('writes every name with textContent, and lists an object named __proto__', () => {

            const { panel } = drawRecipe(recipe => {
                recipe.trees[1].objects.push({ objectApiName: '__proto__', parentLookups: [] } as any);
                recipe.trees[1].objects.push({ objectApiName: '<img src=x>', parentLookups: [] } as any);
            });
            choose(panel, 'Lead-ONLY');

            expect(objectsLineText(panel)).toBe('Insert order:Lead → __proto__ → <img src=x> · 3 objects');
            expect(panel.findAll(objectsLineOf(panel), 'treePickerObject').every((element: any) => element.children.length === 0)).toBe(true);

        });

    });

    describe('the objects line cut to one line (#464)', () => {

        it('draws no toggle while the list fits on one line', () => {

            const { panel } = drawRecipe();

            expect(panel.isHidden(objectsToggleOf(panel))).toBe(true);
            fitObjectsList(panel);
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(true);
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(false);
            expect(objectsLineText(panel)).toBe(ACCOUNT_TREE_LINE);

        });

        it('given a list wider than its line, cuts it and offers Show all, with the count still beside it', () => {

            const { panel } = drawRecipe();
            cutObjectsList(panel);

            const toggleElement = objectsToggleOf(panel);
            expect(panel.isHidden(toggleElement)).toBe(false);
            expect(toggleElement.tagName).toBe('button');
            expect(toggleElement.className).toBe('sdtButton sdtButton-secondary sdtButton-compact treePickerObjectsToggle');
            expect(toggleElement.textContent).toBe(RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL);
            expect(toggleElement.attributes['aria-expanded']).toBe('false');
            expect(toggleElement.attributes['aria-controls']).toBe(objectsListOf(panel).attributes.id);
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(false);
            expect(objectsLineOf(panel).children.map((element: any) => element.className.split(' ')[0]))
                .toEqual(['treePickerObjectsLabel', 'treePickerObjectsList', 'treePickerObjectsCount', 'sdtButton']);

        });

        it('opens and closes the whole list, and keeps the toggle while open', () => {

            const { panel } = drawRecipe();
            cutObjectsList(panel);

            objectsToggleOf(panel).dispatch('click');
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(true);
            expect(objectsToggleOf(panel).textContent).toBe(RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS);
            expect(objectsToggleOf(panel).attributes['aria-expanded']).toBe('true');

            // AN OPENED LIST WRAPS, SO IT NO LONGER OVERFLOWS; IT STILL HAS TO BE CLOSABLE
            fitObjectsList(panel);
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(false);

            // CLOSED AGAIN, THE ONE LINE OVERFLOWS AS IT DID BEFORE
            Object.assign(objectsListOf(panel), { scrollWidth: 900, clientWidth: 300 });
            objectsToggleOf(panel).dispatch('click');
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(false);
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(false);
            expect(objectsToggleOf(panel).textContent).toBe(RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL);
            expect(objectsToggleOf(panel).attributes['aria-expanded']).toBe('false');

        });

        it('measures again when the panel is resized', () => {

            const { panel } = drawRecipe();
            cutObjectsList(panel);
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(false);

            fitObjectsList(panel);
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(true);

        });

        it('keeps the list open when the same card\'s selection is redrawn, and closes it for another card', () => {

            const { panel } = drawRecipe();
            cutObjectsList(panel);
            objectsToggleOf(panel).dispatch('click');

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1 });
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(true);
            expect(objectsToggleOf(panel).textContent).toBe(RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS);

            choose(panel, 'Lead-ONLY');
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(false);
            expect(panel.isHidden(objectsToggleOf(panel))).toBe(true);

            choose(panel, ACCOUNT_TREE_KEY);
            expect(objectsListOf(panel).classList.contains('expanded')).toBe(false);

        });

        it('posts nothing and saves nothing new in the place when toggled', () => {

            const { panel } = drawRecipe();
            cutObjectsList(panel);
            const postedCount = panel.postedHostMessages.length;
            const savedBefore = JSON.stringify(panel.savedState());

            objectsToggleOf(panel).dispatch('click');

            expect(panel.postedHostMessages.length).toBe(postedCount);
            expect(JSON.stringify(panel.savedState())).toBe(savedBefore);

        });

    });

    describe('Favorites only', () => {

        it('narrows the dropdown to the favorites rather than hiding cards, and moves the choice to the first favorite', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees[1].isFavorite = true; });
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

            favoritesToggleOf(panel).dispatch('click');

            expect(panel.treePickerLabels()).toEqual(['★ Lead-ONLY']);
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(panel.findAll(panel.cockpitBodyElement, 'favoritesCount')[0].textContent).toBe('1 of 3 trees');

            favoritesToggleOf(panel).dispatch('click');

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c', '★ Lead-ONLY', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            // THE CHOICE MOVED WITH THE FILTER
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);

        });

        it('keeps a chosen favorite on screen when the filter is turned on', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; recipe.trees[1].isFavorite = true; });
            choose(panel, '★ Lead-ONLY');

            favoritesToggleOf(panel).dispatch('click');

            expect(panel.treePickerLabels()).toEqual(['★ Account-thru-OtherChildObject__c', '★ Lead-ONLY']);
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);

        });

        it('given no favorite, shows the notice and draws no card, and turning it off draws the card chosen before', () => {

            const { panel } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            favoritesToggleOf(panel).dispatch('click');

            expect(panel.isHidden(noFavoritesOf(panel))).toBe(false);
            expect(drawnTreeKeys(panel)).toEqual([]);
            expect(panel.treePickerLabels()).toEqual([]);
            expect(panel.treePicker().disabled).toBe(true);

            favoritesToggleOf(panel).dispatch('click');

            expect(panel.isHidden(noFavoritesOf(panel))).toBe(true);
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);

        });

        it('given a focus on a card the filter leaves out, turns the filter off and chooses the card', () => {

            const { panel, recipe } = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });

            expect(favoritesToggleOf(panel).attributes['aria-pressed']).toBe('false');
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(chosenLabel(panel)).toBe('Lead-ONLY');

        });

    });

    describe('focusTree', () => {

        it('chooses the card in the dropdown before it applies, on a new model and in place', () => {

            const { panel, recipe } = drawRecipe(() => undefined, {}, { focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });

            expect(chosenLabel(panel)).toBe('Lead-ONLY');
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');

            panel.postToPanel({ command: 'focusTree', renderSequence: 1, focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'fields' } });

            expect(chosenLabel(panel)).toBe('Account-thru-OtherChildObject__c');
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Troubleshooting');

            // A RECORD TYPES FOCUS (#321) CHOOSES ITS CARD TOO
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2, focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe', recordTypes: { objectApiName: 'Account' } } });
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(panel.isHidden(panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'recordTypesSectionBody')[0])).toBe(false);

        });

    });

    describe('the section search', () => {

        it('holds the search icon, the count and the results right under the section header', () => {

            const { panel } = drawRecipe();
            const searchElement = panel.findAll(panel.cockpitBodyElement, 'treecipesSearch')[0];
            const iconElement = panel.findAll(searchElement, 'tabSearchField')[0].children[0];

            expect(iconElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(iconElement.attributes).toMatchObject({ class: 'tabSearchIcon', 'aria-hidden': 'true' });
            expect(panel.findAll(searchElement, 'treecipesSearchInput')[0].attributes['aria-label']).toBe('Search treecipes, objects, fields and record types');
            expect(panel.isHidden(resultsOf(panel))).toBe(true);

        });

        it.each([
            ['a title', 'THRU', [['treecipe', 'Account-thru-OtherChildObject__c']]],
            ['a folder name', 'lead-only', [['treecipe', 'Lead-ONLY']]],
            // THE FIRST CARD'S FOLDER NAMES THE OBJECT TOO
            ['an object api name', 'othercHILD', [['treecipe', 'Account-thru-OtherChildObject__c'], ['object', 'OtherChildObject__c']]],
            ['a field api name', 'SUB_RATING', [['field', 'Account.Sub_Rating__c · Sub Rating']]],
            ['a field label', 'annual budget', [['field', 'Account.Annual_Budget__c · Annual Budget']]],
            ['an object and field as the result row writes them', 'account.legacy_code', [['field', 'Account.Legacy_Code__c · Legacy Code']]],
            ['a record type developer name', 'partner', [['record type', 'Account · Partner']]]
        ])('matches %s, case-insensitively', (_description, searchText, expectedRows) => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch(searchText);

            expect(resultRows(panel)).toEqual(expectedRows);
            expect(panel.isHidden(resultsOf(panel))).toBe(false);

        });

        // #389: THE DEFAULT TITLE IS THE FOLDER, SO A RESULT NAMES THE FOLDER BESIDE A TITLE ONLY WHEN THE READER RENAMED THE CARD
        it.each([
            ['its own name', 'my leads'],
            ['its folder', 'LEAD-only']
        ])('finds a renamed card by %s, naming the folder beside the name', (_description, searchText) => {

            const { panel } = drawRecipe(recipe => { recipe.trees[1].customName = 'My Leads'; });

            panel.typeIntoTreecipesSearch(searchText);

            expect(resultRows(panel)).toEqual([['treecipe', 'My Leads · Lead-ONLY']]);

        });

        it('groups the hits by treecipe, then by kind (treecipe · object · field · record type), narrows the dropdown and counts the treecipes', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('e');

            expect(resultGroups(panel)).toEqual(['Account-thru-OtherChildObject__c', 'Lead-ONLY', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            const kindsOfFirstGroup = panel.findAll(panel.findAll(resultsOf(panel), 'treecipesResultGroup')[0], 'treecipesResultKind').map((element: any) => element.textContent);
            const kindOrder = ['treecipe', 'object', 'field', 'record type'];
            expect(kindsOfFirstGroup.map((kind: string) => kindOrder.indexOf(kind))).toEqual([...kindsOfFirstGroup.map((kind: string) => kindOrder.indexOf(kind))].sort((left, right) => left - right));
            expect(searchCountOf(panel)).toBe('3 of 3 treecipes');

            panel.typeIntoTreecipesSearch('rating');

            expect(resultGroups(panel)).toEqual(['Account-thru-OtherChildObject__c']);
            expect(searchCountOf(panel)).toBe('1 of 3 treecipes');
            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c']);

        });

        it('lists only the matching treecipes, keeping the one on screen first and marked when it does not match', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('Company');

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c' + RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX, 'Lead-ONLY']);
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(searchCountOf(panel)).toBe('1 of 3 treecipes');

            choose(panel, 'Lead-ONLY');

            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(panel.treePickerLabels()).toEqual(['Lead-ONLY']);

        });

        it('given no match, says so, disables the dropdown and leaves the card on screen', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('zzz-nothing');

            expect(searchCountOf(panel)).toBe('no matches');
            expect(panel.findAll(resultsOf(panel), 'treecipesResultNone')[0].textContent).toBe(RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH);
            expect(panel.treePicker().disabled).toBe(true);
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

        });

        it('given the search cleared, gives back the full dropdown and the card chosen', () => {

            const { panel } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            panel.typeIntoTreecipesSearch('Rating');
            panel.typeIntoTreecipesSearch('');

            expect(panel.treePickerLabels()).toEqual(['Account-thru-OtherChildObject__c', 'Lead-ONLY', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            expect(chosenLabel(panel)).toBe('Lead-ONLY');
            expect(panel.treePicker().disabled).toBe(false);
            expect(panel.isHidden(resultsOf(panel))).toBe(true);
            expect(searchCountOf(panel)).toBe('');

        });

        it('leaves each tab\'s own search working as it did', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('Rating');
            panel.typeIntoFilter('Legacy', cardOf(panel, ACCOUNT_TREE_KEY));

            expect(panel.findAll(panel.tabPanelOf(cardOf(panel, ACCOUNT_TREE_KEY), 'treeStructure'), 'tabMatchCount')[0].textContent).toBe('1 of 13 fields');
            expect(resultRows(panel).map(row => row[1])).toContain('Account.Rating__c · Rating');

        });

        it('saves the search as typed, outside a restore, and a rebuilt document restores it with its results', () => {

            const { panel, recipe } = drawRecipe();
            panel.typeIntoTreecipesSearch(' Rating ');

            expect(panel.savedState().treecipesSearchText).toBe(' Rating ');

            const reopenedPanel = runPanelScript({ savedState: panel.savedState() });
            reopenedPanel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            expect(reopenedPanel.findAll(reopenedPanel.cockpitBodyElement, 'treecipesSearchInput')[0].value).toBe(' Rating ');
            expect(resultRows(reopenedPanel)).toEqual(resultRows(panel));
            // THE RESTORE SAVES ONCE, AFTER IT
            expect(reopenedPanel.setStateCalls).toHaveLength(1);

            panel.typeIntoTreecipesSearch('');
            expect(panel.savedState()).not.toHaveProperty('treecipesSearchText');

        });

        it('caps the results at the stated limit, with one "N more" line', () => {

            const { panel } = drawRecipe(recipe => {
                recipe.objects = recipe.objects.map(object => object.objectApiName !== 'Lead' ? object : {
                    ...object,
                    fields: Array.from({ length: 80 }, (_unused, fieldIndex) => ({ ...object.fields[0], fieldApiName: `Many_${fieldIndex}__c`, fieldLabel: `Many ${fieldIndex}` }))
                });
            });

            panel.typeIntoTreecipesSearch('many_');

            expect(resultRows(panel)).toHaveLength(RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT);
            expect(panel.findAll(resultsOf(panel), 'treecipesResultMore')[0].textContent).toBe(`${80 - RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT}${RECIPE_COCKPIT_TREECIPES_SEARCH_MORE_SUFFIX}`);

        });

        it('writes every result with textContent, so markup in a name is shown as text', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees[1].customName = '<img src=x onerror=alert(1)>'; });

            panel.typeIntoTreecipesSearch('<img');

            expect(resultGroups(panel)).toEqual(['<img src=x onerror=alert(1)>']);
            expect(panel.findAll(resultsOf(panel), 'treecipesResult').every((resultElement: any) => resultElement.className.includes('sdtButton-link'))).toBe(true);

        });

        it('finds an object named __proto__, whose name keys no prototype', () => {

            const { panel } = drawRecipe(recipe => {
                const leadObject = recipe.objects.find(object => object.objectApiName === 'Lead')!;
                recipe.objects.push({ ...leadObject, objectApiName: '__proto__' });
                recipe.trees[1].objects.push({ objectApiName: '__proto__', parentLookups: [] } as any);
            });

            panel.typeIntoTreecipesSearch('__proto');

            expect(commandsPosted(panel)).not.toContain('renderFailed');
            expect(resultRows(panel)).toEqual([['object', '__proto__']]);

            resultNamed(panel, 'object', '__proto__').dispatch('click');

            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(panel.isHidden(panel.objectBodyOf(objectNamed(panel, LEAD_TREE_KEY, '__proto__')))).toBe(false);

        });

    });

    describe('a click on a result', () => {

        it('on an object, chooses its treecipe on the Treecipe tab and opens and scrolls to the object', () => {

            const { panel } = drawRecipe();
            choose(panel, 'Lead-ONLY');
            panel.openTab(cardOf(panel, LEAD_TREE_KEY), 'Previously Used Data Sets');
            panel.openTab(cardOf(panel, ACCOUNT_TREE_KEY), 'Previously Used Data Sets');

            panel.typeIntoTreecipesSearch('contact');
            resultNamed(panel, 'object', 'Contact').dispatch('click');

            const contactElement = objectNamed(panel, ACCOUNT_TREE_KEY, 'Contact');
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Treecipe');
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(contactElement.scrolledIntoViewCount).toBe(1);
            // THE SEARCH STAYS, SO THE READER CAN GO ON TO THE NEXT RESULT
            expect(resultRows(panel)).not.toEqual([]);

        });

        it('on a field, opens its object and scrolls to its row, clearing a tab search that hid it', () => {

            const { panel } = drawRecipe();
            panel.typeIntoFilter('Legacy', cardOf(panel, ACCOUNT_TREE_KEY));

            panel.typeIntoTreecipesSearch('Sub Rating');
            resultNamed(panel, 'field', 'Account.Sub_Rating__c · Sub Rating').dispatch('click');

            const accountElement = objectNamed(panel, ACCOUNT_TREE_KEY, 'Account');
            const fieldRow = panel.fieldRowNamed(accountElement, 'Sub_Rating__c');
            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.isHidden(fieldRow)).toBe(false);
            expect(fieldRow.scrolledIntoViewCount).toBe(1);
            expect(panel.findAll(panel.tabPanelOf(cardOf(panel, ACCOUNT_TREE_KEY), 'treeStructure'), 'tabSearchInput')[0].value).toBe('');

        });

        it('on a field the TODOs only check hid, unticks the check and redraws it', () => {

            const { panel } = drawRecipe();
            const todosToggle = panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeTodosToggle')[0];
            todosToggle.dispatch('click');
            expect(todosToggle.attributes['aria-checked']).toBe('true');

            panel.typeIntoTreecipesSearch('Annual');
            resultNamed(panel, 'field', 'Account.Annual_Budget__c · Annual Budget').dispatch('click');

            expect(todosToggle.attributes['aria-checked']).toBe('false');
            expect(panel.isHidden(panel.fieldRowNamed(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'), 'Annual_Budget__c'))).toBe(false);

        });

        it('on a record type, opens the Record types section scrolled to its object', () => {

            const { panel } = drawRecipe();
            choose(panel, 'Lead-ONLY');

            panel.typeIntoTreecipesSearch('business');
            resultNamed(panel, 'record type', 'Account · Business').dispatch('click');

            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            const recordTypesBody = panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'recordTypesSectionBody')[0];
            expect(panel.isHidden(recordTypesBody)).toBe(false);
            const accountRow = panel.findAll(recordTypesBody, 'recordTypeObject')
                .find((rowElement: any) => rowElement.scrolledIntoViewCount > 0);
            expect(accountRow).toBeDefined();

        });

        it('on a treecipe, chooses it and scrolls to its card', () => {

            const { panel } = drawRecipe();

            panel.typeIntoTreecipesSearch('Lead-ONLY');
            resultNamed(panel, 'treecipe', 'Lead-ONLY').dispatch('click');

            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(cardOf(panel, LEAD_TREE_KEY).scrolledIntoViewCount).toBe(1);
            expect(panel.savedState().selectedTreeKey).toBe(LEAD_TREE_KEY);

        });

        it('under Favorites only, searches only the favorites, and turning the filter off searches every card again', () => {

            const { panel } = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            panel.typeIntoTreecipesSearch('Status');
            expect(searchCountOf(panel)).toBe('no matches');

            favoritesToggleOf(panel).dispatch('click');

            expect(resultGroups(panel)).toEqual(['Lead-ONLY']);
            expect(resultRows(panel)).toEqual([['field', 'Lead.Status · Status']]);

        });

    });

    describe('the keystroke cost at 12,000 fields', () => {

        // 12 TREES OF 10 OBJECTS OF 100 FIELDS: THE SCALE CLAUDE.md MEASURES THE COCKPIT AT
        const buildLargeRecipe = (): IRecipeCockpitRecipeViewModel => {
            const recipe = loadRecipe();
            const fieldTemplate = recipe.objects[0].fields[1];
            const objects = Array.from({ length: 120 }, (_unused, objectIndex) => ({
                objectApiName: `Object_${objectIndex}__c`,
                recipeFilePath: recipe.objects[0].recipeFilePath,
                lineNumber: 1,
                fields: Array.from({ length: 100 }, (_unusedField, fieldIndex) => ({ ...fieldTemplate, fieldApiName: `Field_${objectIndex}_${fieldIndex}__c`, fieldLabel: `Field ${objectIndex} ${fieldIndex}`, lineNumber: undefined, todos: undefined }))
            }));
            return {
                ...recipe,
                objects: objects as any,
                trees: Array.from({ length: 12 }, (_unused, treeIndex) => ({
                    treeKey: `Tree_${treeIndex}`,
                    title: `Relationship Tree ${treeIndex + 1}`,
                    folderName: `Tree_${treeIndex}`,
                    objects: objects.slice(treeIndex * 10, treeIndex * 10 + 10).map(object => ({ objectApiName: object.objectApiName, parentLookups: [] })),
                    fieldCount: 1000
                })) as any
            };
        };

        it('lowercases the index once per model, never per keystroke, and records the time', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: buildLargeRecipe(), renderSequence: 1 });

            const firstStart = process.hrtime.bigint();
            panel.typeIntoTreecipesSearch('field_7');
            const firstMilliseconds = Number(process.hrtime.bigint() - firstStart) / 1e6;

            const toLowerCaseSpy = jest.spyOn(String.prototype, 'toLowerCase');
            const laterStart = process.hrtime.bigint();
            panel.typeIntoTreecipesSearch('field_77');
            const laterMilliseconds = Number(process.hrtime.bigint() - laterStart) / 1e6;
            const laterLowerCaseCalls = toLowerCaseSpy.mock.calls.length;
            toLowerCaseSpy.mockRestore();

            console.info(`#374 section search at 12,000 fields: first keystroke ${firstMilliseconds.toFixed(1)} ms (builds the index), a later one ${laterMilliseconds.toFixed(1)} ms`);

            expect(laterLowerCaseCalls).toBeLessThan(10);
            expect(resultRows(panel)).toHaveLength(RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT);
            expect(laterMilliseconds).toBeLessThan(1000);

        });

    });

});
