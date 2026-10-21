import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_NO_TREE_TODOS_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The Troubleshooting tab's sub-tabs (#365): one area at a time, the first selected until the
    reader picks another, each with its own search, the choice and the searches kept in the place.
    In the tree workspace the Account card's recipe has five TODOs, each a field's whole value and
    so posted without its text (#354); the Lead-ONLY card has none.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
    TREE_WORKSPACE_ROOT,
    RUN_FOLDER_NAME
).recipeViewModel;

const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;

type Panel = ReturnType<typeof runPanelScript>;

const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel = loadRecipe(), savedState?: any): Panel => {
    const panel = runPanelScript(savedState ? { savedState } : {});
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const accountCardOf = (panel: Panel) => panel.treeCards()[0];
const leadCardOf = (panel: Panel) => panel.treeCards()[1];
const subTabsOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'troubleshootingSubTab');
const subTabNamed = (panel: Panel, treeCard: any, label: string) => subTabsOf(panel, treeCard).find((tabElement: any) => tabElement.textContent.startsWith(label));
const subPanelOf = (panel: Panel, treeCard: any, subTab: string) => panel.findAll(treeCard, `troubleshootingSubPanel-${subTab}`)[0];
const selectedSubTabOf = (panel: Panel, treeCard: any) => RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.filter(subTab => !panel.isHidden(subPanelOf(panel, treeCard, subTab)));
const searchInputOf = (panel: Panel, treeCard: any, subTab: string) => panel.findAll(subPanelOf(panel, treeCard, subTab), 'tabSearchInput')[0];
const typeInto = (panel: Panel, treeCard: any, subTab: string, searchText: string) => panel.typeIntoTabSearch(treeCard, `troubleshootingSubPanel-${subTab}`, searchText);
const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);

const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    runFolderName: RUN_FOLDER_NAME,
    isOrgPickerInUse: false,
    isFavoritesOnly: false,
    scrollY: 0,
    trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'troubleshooting', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
});

describe('RecipeCockpitService, the Troubleshooting tab\'s sub-tabs (#365)', () => {

    describe('the strip', () => {

        it('draws six sub-tabs, in order, as a tab list, with the first selected and only its panel shown', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const subTabs = subTabsOf(panel, accountCard);
            expect(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS).toEqual(['todos', 'fields', 'permissions', 'validationRules', 'recordTypes', 'globalValueSets']);
            expect(subTabs.map((tabElement: any) => tabElement.textContent)).toEqual(['TODO\'s (5)', 'Fields', 'Permissions', 'Validation Rules', 'Record Types', 'Global Value Sets']);
            expect(subTabs[0].parentNode.attributes.role).toBe('tablist');
            subTabs.forEach((tabElement: any, tabIndex: number) => {
                expect(tabElement.attributes.role).toBe('tab');
                expect(tabElement.attributes['aria-selected']).toBe(tabIndex === 0 ? 'true' : 'false');
            });
            expect(selectedSubTabOf(panel, accountCard)).toEqual(['todos']);
            expect(subPanelOf(panel, accountCard, 'fields').attributes).toMatchObject({ role: 'tabpanel', 'aria-label': RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS.fields });
            // THE STACKED SECTIONS, THEIR TITLES AND THE TAB-WIDE SEARCH ARE GONE
            ['troubleshootingSection', 'troubleshootingSectionTitle', 'troubleshootingIntro'].forEach(className => expect(panel.findAll(accountCard, className)).toEqual([]));

        });

        it('shows one sub-tab at a time on a click, moves the underline toward it and keeps the choice in the place', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            subTabNamed(panel, accountCard, 'Permissions').dispatch('click');

            expect(selectedSubTabOf(panel, accountCard)).toEqual(['permissions']);
            expect(subTabNamed(panel, accountCard, 'Permissions').attributes['aria-selected']).toBe('true');
            expect(subTabNamed(panel, accountCard, 'TODO').attributes['aria-selected']).toBe('false');
            expect(subTabsOf(panel, accountCard)[0].parentNode.classList.contains('movingRight')).toBe(true);
            expect(savedTreeOf(panel).troubleshootingSubTab).toBe('permissions');

            subTabNamed(panel, accountCard, 'TODO').dispatch('click');

            expect(subTabsOf(panel, accountCard)[0].parentNode.classList.contains('movingLeft')).toBe(true);
            // THE FIRST IS THE DEFAULT, SO IT IS NEVER WRITTEN
            expect(savedTreeOf(panel)).not.toHaveProperty('troubleshootingSubTab');

        });

        it('holds every action in its own sub-tab', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const classNamesIn = (subTab: string) => panel.findAll(subPanelOf(panel, accountCard, subTab), 'troubleshootingAction')
                .map((actionElement: any) => actionElement.children[0].className.split(' ').filter((className: string) => !className.startsWith('sdtButton') && className !== 'actionCard').join(' '));

            expect(classNamesIn('todos')).toEqual([]);
            expect(classNamesIn('fields')).toEqual(['troubleshootingDeploy troubleshootingDeploy-fields']);
            expect(classNamesIn('permissions')).toEqual(['treePermissionSets', 'treeGeneratePermissionSet', 'troubleshootingDeploy troubleshootingDeploy-permissionSet']);
            expect(classNamesIn('validationRules')).toEqual(['treeRetrieveValidationRules']);
            expect(classNamesIn('recordTypes')).toEqual(['troubleshootingDeploy troubleshootingDeploy-recordTypes']);
            expect(classNamesIn('globalValueSets')).toEqual(['troubleshootingDeploy troubleshootingDeploy-globalValueSets']);
            // THE TREECIPE TAB KEEPS WHAT DECIDES WHAT IS GENERATED
            expect(panel.findAll(panel.tabPanelOf(accountCard, 'treeStructure'), 'treeTodosToggle')).toHaveLength(1);
            expect(panel.findAll(panel.tabPanelOf(accountCard, 'treeStructure'), 'treeRecordTypeFieldsToggle')).toHaveLength(1);

        });

    });

    describe('the TODO\'s sub-tab', () => {

        it('lists every TODO by object, with the text read back from the field\'s value and a link to its own line', () => {

            const recipe = loadRecipe();
            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const todosPanel = subPanelOf(panel, accountCard, 'todos');
            expect(panel.findAll(todosPanel, 'troubleshootingTodoObject').map((headingElement: any) => headingElement.textContent)).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(panel.findAll(todosPanel, 'troubleshootingTodo').map((todoElement: any) => todoElement.children.slice(0, 2).map((childElement: any) => childElement.textContent))).toEqual([
                ['Regions__c', '### TODO -- NO PICKLIST VALUES'],
                ['ParentId', '### TODO -- REFERENCE ID REQUIRED'],
                ['OwnerId', '### TODO -- REFERENCE ID REQUIRED'],
                ['AccountId', '### TODO -- REFERENCE ID REQUIRED'],
                ['Contact__c', '### TODO -- REFERENCE ID REQUIRED']
            ]);
            expect(panel.findAll(todosPanel, 'tabMatchCount')[0].textContent).toBe('5 TODOs');

            panel.findAll(todosPanel, 'treeTodoSource')[2].dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'openSource', filePath: objectOf(recipe, 'Account').recipeFilePath, lineNumber: 22 });

        });

        it('lists an object\'s own TODOs as "on the object", and a field TODO whose text is not in its value by name only', () => {

            const recipe = loadRecipe();
            objectOf(recipe, 'Contact').todos = [{ lineNumber: 33, text: '### TODO -- VALIDATION RULE NOT APPLIED -- "Rule" -- why' }];
            const accountField = objectOf(recipe, 'Account').fields.find(field => field.fieldApiName === 'Name');
            if (accountField) { accountField.todos = [{ lineNumber: 11 }]; }

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const todoTexts = panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'troubleshootingTodo').map((todoElement: any) => todoElement.children.slice(0, 2).map((childElement: any) => childElement.textContent));
            expect(todoTexts).toContainEqual(['on the object', '### TODO -- VALIDATION RULE NOT APPLIED -- "Rule" -- why']);
            expect(todoTexts).toContainEqual(['Name', RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL]);
            expect(subTabNamed(panel, accountCard, 'TODO').textContent).toBe('TODO\'s (7)');

        });

        it('narrows to the TODOs its search names by object, field or text, and hides an object left with none', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            typeInto(panel, accountCard, 'todos', 'picklist');

            const todosPanel = subPanelOf(panel, accountCard, 'todos');
            expect(panel.findAll(todosPanel, 'troubleshootingTodo').filter((todoElement: any) => !panel.isHidden(todoElement))).toHaveLength(1);
            expect(panel.findAll(todosPanel, 'troubleshootingTodoGroup').map((groupElement: any) => panel.isHidden(groupElement))).toEqual([false, true, true]);
            expect(panel.findAll(todosPanel, 'tabMatchCount')[0].textContent).toBe('1 of 5 TODOs');

            typeInto(panel, accountCard, 'todos', 'contact');

            // CONTACT BY ITS OBJECT, Contact__c BY ITS FIELD
            expect(panel.findAll(todosPanel, 'tabMatchCount')[0].textContent).toBe('2 of 5 TODOs');

        });

        it('says so, with no count on its label, on a card whose recipe has none', () => {

            const panel = drawRecipe();
            const leadCard = leadCardOf(panel);
            panel.openTab(leadCard, 'Troubleshooting');

            expect(subTabNamed(panel, leadCard, 'TODO').textContent).toBe('TODO\'s');
            expect(panel.findAll(subPanelOf(panel, leadCard, 'todos'), 'treeEmpty')[0].textContent).toBe(RECIPE_COCKPIT_NO_TREE_TODOS_NOTE);

        });

        it('writes hand-edited TODO text as text, whatever it holds', () => {

            const hostileTexts = ['### TODO <img src=x onerror=alert(1)>', '### TODO [run](command:workbench.action.terminal.new)', '### TODO __proto__'];
            const recipe = loadRecipe();
            objectOf(recipe, 'Account').todos = hostileTexts.map((text, todoIndex) => ({ lineNumber: 7 + todoIndex, text: text }));

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const textElements = panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'troubleshootingTodoText').slice(0, 3);
            expect(textElements.map((textElement: any) => textElement.textContent)).toEqual(hostileTexts);
            textElements.forEach((textElement: any) => expect(textElement.children).toHaveLength(0));

        });

        it('shows a field TODO posted without its text from the span of the value the host named, and says so when the span does not fit', () => {

            const recipe = loadRecipe();
            const account = objectOf(recipe, 'Account');
            const regions = account.fields.find(field => field.fieldApiName === 'Regions__c');
            const parentId = account.fields.find(field => field.fieldApiName === 'ParentId');
            // A QUOTED " # TODO" AHEAD OF THE REAL ONE IS NOT WHAT THE ENTRY SHOWS
            const regionsValue = "${{ faker.helpers.arrayElement(['Fix # TODO list', 'West']) }}\n### TODO: -- RecordType Options -- Business";
            if (regions) {
                regions.recipeValue = regionsValue;
                regions.todos = RecipeCockpitService.buildFieldTodoViewModels([{ lineNumber: 20, text: '### TODO: -- RecordType Options -- Business' }], regionsValue);
            }
            if (parentId) { parentId.todos = [{ lineNumber: 21, valueStart: 5, valueLength: 100000 }]; }

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const texts = panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'troubleshootingTodoText').map((textElement: any) => textElement.textContent);
            expect(texts[0]).toBe('### TODO: -- RecordType Options -- Business');
            expect(texts[1]).toBe(RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL);

        });

    });

    describe('the TODO\'s sub-tab at scale', () => {

        it('opens groups within the auto-expand budgets and builds a closed group\'s rows only when it is opened', () => {

            const recipe = loadRecipe();
            const manyTodos = (startLine: number) => Array.from({ length: 1500 }, (_, todoIndex) => ({ lineNumber: startLine + todoIndex, text: `### TODO ${todoIndex}` }));
            objectOf(recipe, 'Account').todos = manyTodos(1000);
            objectOf(recipe, 'Contact').todos = manyTodos(5000);

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const groups = panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'troubleshootingTodoGroup');
            const rowCountOf = (groupElement: any) => panel.findAll(groupElement, 'troubleshootingTodo').length;
            const toggleOf = (groupElement: any) => panel.findAll(groupElement, 'troubleshootingTodoToggle')[0];

            // THE FIRST GROUP ALWAYS OPENS; THE NEXT WOULD PASS THE ROW BUDGET, SO IT AND EVERY LATER ONE STAY CLOSED AND UNBUILT
            expect(groups.map(rowCountOf)).toEqual([1503, 0, 0]);
            expect(groups.map((groupElement: any) => toggleOf(groupElement).attributes['aria-expanded'])).toEqual(['true', 'false', 'false']);
            expect(groups.every((groupElement: any) => toggleOf(groupElement).classList.contains('chevronToggle'))).toBe(true);
            expect(panel.findAll(groups[1], 'troubleshootingTodoCount')[0].textContent).toBe('1501 TODOs');

            toggleOf(groups[1]).dispatch('click');

            expect(rowCountOf(groups[1])).toBe(1501);
            expect(panel.isHidden(panel.findAll(groups[1], 'troubleshootingTodoRows')[0])).toBe(false);

        });

        it('searches entries it has not built, and opens the groups that match', () => {

            const recipe = loadRecipe();
            objectOf(recipe, 'Account').todos = Array.from({ length: 2500 }, (_, todoIndex) => ({ lineNumber: 1000 + todoIndex, text: `### TODO ${todoIndex}` }));

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            const groups = panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'troubleshootingTodoGroup');
            expect(panel.findAll(groups[1], 'troubleshootingTodo')).toHaveLength(0);

            typeInto(panel, accountCard, 'todos', 'accountid');

            expect(panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'tabMatchCount')[0].textContent).toBe('1 of 2505 TODOs');
            expect(groups.map((groupElement: any) => panel.isHidden(groupElement))).toEqual([true, false, true]);
            expect(panel.findAll(groups[1], 'troubleshootingTodo').map((todoElement: any) => todoElement.children[0].textContent)).toEqual(['AccountId']);

        });

    });

    describe('each sub-tab\'s search', () => {

        it('matches what an action draws, never its tooltip, and again when a run changes what it draws', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');
            panel.postToPanel({ command: 'troubleshootingSummary', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, permissionSetCount: 2, customFieldCount: 6, standardFieldCount: 0, unreadableFieldCount: 0, globalValueSetCount: 1, missingGlobalValueSetCount: 0, recordTypeCount: 2 });

            const countOf = () => panel.findAll(subPanelOf(panel, accountCard, 'fields'), 'tabMatchCount')[0].textContent;

            typeInto(panel, accountCard, 'fields', 'sandbox');
            expect(countOf()).toBe('no matches');

            typeInto(panel, accountCard, 'fields', 'deploying');
            expect(countOf()).toBe('no matches');

            panel.findAll(subPanelOf(panel, accountCard, 'fields'), 'troubleshootingDeploy-fields')[0].dispatch('click');

            expect(countOf()).toBe('1 of 1 action');

        });

        it('is the sub-tab\'s own: its text survives a switch and is kept in the place, the others\' untouched', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');

            typeInto(panel, accountCard, 'permissions', 'assign');
            subTabNamed(panel, accountCard, 'Fields').dispatch('click');
            subTabNamed(panel, accountCard, 'Permissions').dispatch('click');

            expect(searchInputOf(panel, accountCard, 'permissions').value).toBe('assign');
            expect(searchInputOf(panel, accountCard, 'fields').value).toBe('');
            // "assign" NAMES THE ASSIGN CARD AND THE DEPLOY CARD'S WHY LINE ("before assigning them"), WHICH IS ON SCREEN (#381)
            expect(panel.findAll(subPanelOf(panel, accountCard, 'permissions'), 'tabMatchCount')[0].textContent).toBe('2 of 3 actions');
            expect(savedTreeOf(panel).troubleshootingSearchQueries).toEqual({ permissions: 'assign' });
            expect(savedTreeOf(panel).searchQueries).not.toHaveProperty('troubleshooting');

        });

    });

    describe('the saved place', () => {

        it('restores the sub-tab and every search in the next document', () => {

            const firstPanel = drawRecipe();
            openTroubleshootingAndChoose(firstPanel);

            const panel = runPanelScript({ savedState: firstPanel.savedState() });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });

            const accountCard = accountCardOf(panel);
            expect(selectedSubTabOf(panel, accountCard)).toEqual(['validationRules']);
            expect(searchInputOf(panel, accountCard, 'todos').value).toBe('regions');
            expect(panel.findAll(subPanelOf(panel, accountCard, 'todos'), 'tabMatchCount')[0].textContent).toBe('1 of 5 TODOs');

        });

        it('opens the first sub-tab for an older place, or one naming a sub-tab that does not exist', () => {

            [{}, { troubleshootingSubTab: 'deployments' }, { troubleshootingSubTab: 7 }].forEach(treePlace => {
                const panel = runPanelScript({ savedState: savedPlaceWith(treePlace) });
                panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
                expect(selectedSubTabOf(panel, accountCardOf(panel))).toEqual(['todos']);
            });

        });

        it('keeps the sub-tab on a reload of the run on screen that focuses the Troubleshooting tab', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, 'Troubleshooting');
            subTabNamed(panel, accountCard, 'Record Types').dispatch('click');

            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 4, focusTree: { treeKey: ACCOUNT_TREE_KEY, tab: 'troubleshooting' } });
            panel.postToPanel({ command: 'rendered' });

            expect(selectedSubTabOf(panel, accountCardOf(panel))).toEqual(['recordTypes']);

        });

        it('keeps, through normalizePanelPlace, a sub-tab other than the first and searches that are text, and nothing else', () => {

            const normalizedTree = (treePlace: Record<string, unknown>) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith(treePlace))?.trees[0];

            expect(normalizedTree({ troubleshootingSubTab: 'fields', troubleshootingSearchQueries: { todos: 'lookup', fields: '', permissions: 3, __proto__: 'x', recordTypes: 'Business' } })).toMatchObject({
                troubleshootingSubTab: 'fields',
                troubleshootingSearchQueries: { todos: 'lookup', recordTypes: 'Business' }
            });
            expect(normalizedTree({ troubleshootingSearchQueries: { todos: 'lookup' } })?.troubleshootingSearchQueries).toEqual({ todos: 'lookup' });
            [{ troubleshootingSubTab: 'todos' }, { troubleshootingSubTab: 'nope' }, { troubleshootingSubTab: null }].forEach(treePlace => {
                expect(normalizedTree(treePlace)).not.toHaveProperty('troubleshootingSubTab');
            });
            [{ troubleshootingSearchQueries: { todos: '' } }, { troubleshootingSearchQueries: 'todos' }, { troubleshootingSearchQueries: ['x'] }].forEach(treePlace => {
                expect(normalizedTree(treePlace)).not.toHaveProperty('troubleshootingSearchQueries');
            });
            // THE TAB-WIDE SEARCH #346 SAVED IS DROPPED
            expect(normalizedTree({ searchQueries: { treecipe: '', datasets: '', troubleshooting: 'field' } })?.searchQueries).toEqual({ treecipe: '', datasets: '' });

        });

    });

});

function openTroubleshootingAndChoose(panel: Panel): void {
    const accountCard = accountCardOf(panel);
    panel.openTab(accountCard, 'Troubleshooting');
    typeInto(panel, accountCard, 'todos', 'regions');
    subTabNamed(panel, accountCard, 'Validation Rules').dispatch('click');
}
