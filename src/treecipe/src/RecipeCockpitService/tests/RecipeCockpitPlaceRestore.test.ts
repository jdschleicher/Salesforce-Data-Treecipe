import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitCarriedPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { INormalizedOrgObjectDescribe } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    The reader's place (#222): a hidden Recipe Cockpit tab's document is thrown away and rebuilt on
    reveal, and re-running the command reloads the panel. Every panel test here runs the REAL panel
    script twice -- once to save, once, from what it saved, to restore -- as VS Code does.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const FAKER_JS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-09-10T00-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ORG_USERNAME = 'jd@example.com';

const loadHistoryRecipe = (runFolderName?: string) => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    runFolderName
);

// AN ACCOUNT THE ORG HAS WITH ONE FIELD THE RECIPE DOES NOT, SO A COMPARISON HAS A ROW OF EVERY KIND TO FILTER
const ACCOUNT_ORG_DESCRIBE: INormalizedOrgObjectDescribe = {
    objectApiName: 'Account',
    objectLabel: 'Account',
    isCreateable: true,
    fields: [{
        fieldApiName: 'Brand_New__c',
        fieldLabel: 'Brand New',
        fieldType: 'string',
        length: 10,
        precision: 0,
        scale: 0,
        picklistValues: [],
        controllingField: '',
        referenceTo: [],
        isNillable: true,
        isCreateable: true,
        isCalculated: false,
        isDefaultedOnCreate: false
    }]
};

const buildAccountComparison = (recipe: IRecipeCockpitRecipeViewModel, renderSequence: number) => {
    const describeResult = { outcomes: [{ objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false }], wasCancelled: false };
    return RecipeCockpitService.buildOrgDescribeMessage(ACCOUNT_TREE_KEY, `devhub (${ORG_USERNAME})`, describeResult, renderSequence,
        RecipeCockpitService.buildRecipeDiffViewModel(recipe.objects, describeResult, new Map()));
};

describe('RecipeCockpitService, the reader\'s place', () => {

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const treeCardOf = (panel: Panel, treeKey: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === treeKey);
        const isCardOpen = (panel: Panel, treeKey: string) => !panel.isHidden(panel.findAll(treeCardOf(panel, treeKey), 'treeBody')[0]);
        const openCard = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeToggle')[0].dispatch('click');
        const clickTab = (panel: Panel, treeKey: string, tabLabel: string) => panel.openTab(treeCardOf(panel, treeKey), tabLabel);
        const selectedTabOf = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeTab')
            .find((tabElement: any) => tabElement.classList.contains('selected'))?.textContent;
        const objectNamed = (panel: Panel, treeKey: string, objectApiName: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeObject')
            .find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
        const isObjectOpen = (panel: Panel, treeKey: string, objectApiName: string) => !panel.isHidden(panel.objectBodyOf(objectNamed(panel, treeKey, objectApiName)));
        const picklistToggleOf = (panel: Panel, treeKey: string, objectApiName: string, fieldApiName: string) =>
            panel.findAll(panel.fieldRowNamed(objectNamed(panel, treeKey, objectApiName), fieldApiName), 'picklistToggle')[0];
        const versionToggles = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeVersionToggle');
        const visibleVersionCount = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeVersion')
            .filter((versionElement: any) => !panel.isHidden(versionElement)).length;
        const searchInputOf = (panel: Panel, treeKey: string, panelClassName: string) =>
            panel.findAll(panel.tabPanelOf(treeCardOf(panel, treeKey), panelClassName), 'tabSearchInput')[0];
        const matchCountOf = (panel: Panel, treeKey: string, panelClassName: string) =>
            panel.findAll(panel.tabPanelOf(treeCardOf(panel, treeKey), panelClassName), 'tabMatchCount')[0].textContent;
        const dataObjectNamed = (panel: Panel, treeKey: string, objectApiName: string) => panel.dataObjectElements(treeCardOf(panel, treeKey))
            .find((dataObjectElement: any) => panel.findAll(dataObjectElement, 'dataObjectName')[0].textContent === objectApiName);
        const visibleDataFieldNamesOf = (panel: Panel, dataObjectElement: any) => panel.findAll(dataObjectElement, 'dataField')
            .filter((dataFieldElement: any) => !panel.isHidden(dataFieldElement) && !panel.isHidden(dataFieldElement.parentNode))
            .map((dataFieldElement: any) => panel.findAll(dataFieldElement, 'dataFieldName')[0].textContent);
        const statusFilterOf = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'statusFilter')[0];
        const commandsPosted = (panel: Panel) => panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);
        const indexOfCommand = (panel: Panel, command: string) => commandsPosted(panel).indexOf(command);

        const render = (panel: Panel, recipe: IRecipeCockpitRecipeViewModel, renderSequence = 1, focusTree?: any) =>
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: renderSequence, ...( focusTree ? { focusTree } : {} ) });

        // THE READER'S SESSION: TWO CARDS OPEN, AN OBJECT AND A PICKLIST OPENED, A HISTORY TAB SEARCHED WITH A VERSION OPENED, SCROLLED
        const buildReaderSession = () => {

            jest.useFakeTimers();

            const recipe = loadHistoryRecipe().recipeViewModel;
            const panel = runPanelScript();
            render(panel, recipe);

            openCard(panel, ACCOUNT_TREE_KEY);
            panel.expandObject(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'));
            picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').dispatch('click');

            openCard(panel, LEAD_TREE_KEY);
            clickTab(panel, LEAD_TREE_KEY, 'Previous Versions');
            versionToggles(panel, LEAD_TREE_KEY)[1].dispatch('click');
            panel.typeIntoTabSearch(treeCardOf(panel, LEAD_TREE_KEY), 'treeVersions', 'FakerJS');

            panel.scrollTo(480);
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY);

            return { panel, recipe };

        };

        afterEach(() => {
            jest.useRealTimers();
        });

        it('given the document is rebuilt, puts back every card, tab, object, picklist, version and search the reader had, and the scroll', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Structure');
            expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(true);
            expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Contact')).toBe(false);
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').attributes['aria-expanded']).toBe('true');
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Regions__c').attributes['aria-expanded']).toBe('false');

            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previous Versions');
            expect(versionToggles(panel, LEAD_TREE_KEY).map((toggleElement: any) => toggleElement.attributes['aria-expanded'])).toEqual(['false', 'true', 'false']);
            expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeVersions').value).toBe('FakerJS');
            expect(visibleVersionCount(panel, LEAD_TREE_KEY)).toBe(1);

            expect(panel.scrollToCalls).toEqual([480]);

        });

        // THE HOST HONOURS loadPicklistValues AND loadVersionSummaries ONLY ONCE "rendered" HAS ACTIVATED THIS MODEL'S ALLOW-LISTS
        it('asks the host for the values and summaries it re-opens only after acknowledging the draw', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(indexOfCommand(panel, 'rendered')).toBeGreaterThan(-1);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues'))
                .toEqual([{ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' }]);
            expect(indexOfCommand(panel, 'loadPicklistValues')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));
            expect(indexOfCommand(panel, 'loadVersionSummaries')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));

        });

        it('given a Structure search, restores it as typed and the rows it narrowed to', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);
            openCard(hiddenPanel, ACCOUNT_TREE_KEY);
            hiddenPanel.typeIntoFilter('  Rating ', treeCardOf(hiddenPanel, ACCOUNT_TREE_KEY));

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(searchInputOf(panel, ACCOUNT_TREE_KEY, 'treeStructure').value).toBe('  Rating ');
            expect(matchCountOf(panel, ACCOUNT_TREE_KEY, 'treeStructure')).toBe(matchCountOf(hiddenPanel, ACCOUNT_TREE_KEY, 'treeStructure'));
            expect(panel.visibleFieldNamesOf(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account')))
                .toEqual(hiddenPanel.visibleFieldNamesOf(objectNamed(hiddenPanel, ACCOUNT_TREE_KEY, 'Account')));

        });

        it('given the reader was on a Data-by-Org tab, comes back to it and asks for the orgs again after the draw', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);
            openCard(hiddenPanel, ACCOUNT_TREE_KEY);
            clickTab(hiddenPanel, ACCOUNT_TREE_KEY, 'Data-by-Org');

            expect(hiddenPanel.savedState().isOrgPickerInUse).toBe(true);

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Data-by-Org');
            expect(indexOfCommand(panel, 'loadDataOrgs')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));
            expect(commandsPosted(panel).filter(command => command === 'loadDataOrgs')).toHaveLength(1);

        });

        it('given the reader had used the toolbar\'s org picker, asks for the orgs again after the draw with no tab open', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);
            hiddenPanel.findAll(hiddenPanel.cockpitBodyElement, 'dataOrgLoad')[0].dispatch('click');

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(indexOfCommand(panel, 'loadDataOrgs')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));

        });

        it('given the reader never touched the org picker, lists no orgs: listing them runs the CLI\'s connection check', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(commandsPosted(panel)).not.toContain('loadDataOrgs');

        });

        it('given the reader opened nothing, saves the default place and restores it as the default', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);

            expect(hiddenPanel.savedState()).toEqual({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: CURRENT_RUN_FOLDER_NAME,
                isOrgPickerInUse: false,
                scrollY: 0,
                trees: []
            });

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
            expect(panel.scrollToCalls).toEqual([]);

        });

        it('given the first model drawn is another run, restores nothing and saves the place of the run on screen', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();
            // THE SAME CARDS UNDER ANOTHER RUN'S NAME, SO ONLY THE RUN DECIDES WHETHER THE PLACE APPLIES
            const otherRecipe = { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME };

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, otherRecipe);

            expect(panel.treeCards()).toHaveLength(2);
            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
            expect(panel.scrollToCalls).toEqual([]);
            expect(panel.savedState().runFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
            expect(panel.savedState().trees).toEqual([]);

        });

        describe('given a later model of the same run in the same document (#225)', () => {

            // WHAT Regenerate, Run Faker, Create AND Add friend DO: THE HOST RELOADS THE RUN ON SCREEN AND POSTS IT AGAIN
            const reload = (panel: Panel, recipe: IRecipeCockpitRecipeViewModel, focusTree?: any) => {
                const scrollCallsBefore = panel.scrollToCalls.length;
                render(panel, recipe, 2, focusTree);
                return panel.scrollToCalls.slice(scrollCallsBefore);
            };

            const expectReaderSessionRestored = (panel: Panel) => {
                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(true);
                expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Contact')).toBe(false);
                expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').attributes['aria-expanded']).toBe('true');
                expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Regions__c').attributes['aria-expanded']).toBe('false');
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
                expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeVersions').value).toBe('FakerJS');
                expect(versionToggles(panel, LEAD_TREE_KEY).map((toggleElement: any) => toggleElement.attributes['aria-expanded'])).toEqual(['false', 'true', 'false']);
            };

            it('puts back every card, tab, object, picklist, version and search the reader had, and the scroll', () => {

                const { panel, recipe } = buildReaderSession();

                const scrollCalls = reload(panel, recipe);

                expectReaderSessionRestored(panel);
                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Structure');
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previous Versions');
                expect(visibleVersionCount(panel, LEAD_TREE_KEY)).toBe(1);
                expect(scrollCalls).toEqual([480]);
                expect(commandsPosted(panel)).not.toContain('renderFailed');

            });

            it.each([
                ['Run Faker', { treeKey: LEAD_TREE_KEY, tab: 'datasets' }, LEAD_TREE_KEY, 'Previous Fake Sets'],
                ['Create', { treeKey: ACCOUNT_TREE_KEY, tab: 'dataByOrg' }, ACCOUNT_TREE_KEY, 'Data-by-Org'],
                ['Add friend, or a Regenerate that failed and reloaded the same run', { treeKey: LEAD_TREE_KEY, tab: 'structure' }, LEAD_TREE_KEY, 'Structure']
            ])('given %s\'s focus, opens its card on its tab and restores everything else', (_action, focusTree, focusedTreeKey, focusedTabLabel) => {

                const { panel, recipe } = buildReaderSession();

                reload(panel, recipe, focusTree);

                expect(selectedTabOf(panel, focusedTreeKey)).toBe(focusedTabLabel);
                expectReaderSessionRestored(panel);
                const otherTreeKey = focusedTreeKey === ACCOUNT_TREE_KEY ? LEAD_TREE_KEY : ACCOUNT_TREE_KEY;
                expect(selectedTabOf(panel, otherTreeKey)).toBe(otherTreeKey === LEAD_TREE_KEY ? 'Previous Versions' : 'Structure');

            });

            it('given a focus on a card the reader had closed, opens it and leaves the open cards open', () => {

                jest.useFakeTimers();
                const recipe = loadHistoryRecipe().recipeViewModel;
                const panel = runPanelScript();
                render(panel, recipe);
                openCard(panel, ACCOUNT_TREE_KEY);

                reload(panel, recipe, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previous Fake Sets');

            });

            it('given the reload landed on another run, starts fresh', () => {

                const { panel, recipe } = buildReaderSession();

                const scrollCalls = reload(panel, { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
                expect(scrollCalls).toEqual([]);
                expect(panel.savedState().runFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
                expect(panel.savedState().trees).toEqual([]);

            });

            // Regenerate WRITES A NEW RUN FOLDER WHOSE CARDS CARRY THE SAME TREE FOLDER NAMES, AND THE HOST SAYS SO
            it('given Regenerate\'s marker, restores every card, tab, search and the scroll on the new run, its focus winning for its card', () => {

                const { panel, recipe } = buildReaderSession();
                const regeneratedRunFolderName = 'recipe-2026-10-10T12-00-00';
                const scrollCallsBefore = panel.scrollToCalls.length;

                panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: regeneratedRunFolderName }, renderSequence: 2,
                    focusTree: { treeKey: LEAD_TREE_KEY, tab: 'structure' }, carryPlaceAcrossRuns: true });

                expectReaderSessionRestored(panel);
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Structure');
                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Structure');
                expect(panel.scrollToCalls.slice(scrollCallsBefore)).toEqual([480]);
                // SAVED UNDER THE RUN NOW ON SCREEN, SO A LATER HIDE AND REVEAL RESTORES IT THERE
                expect(panel.savedState().runFolderName).toBe(regeneratedRunFolderName);
                expect(panel.savedState().trees.map((savedTree: any) => savedTree.treeKey)).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

            });

            it('honours the marker only as a literal true', () => {

                const { panel, recipe } = buildReaderSession();

                panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME }, renderSequence: 2, carryPlaceAcrossRuns: 'true' });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            it('given the reader switched runs, starts fresh, and switching back starts fresh too', () => {

                const { panel, recipe } = buildReaderSession();

                render(panel, { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME }, 2);
                render(panel, recipe, 3);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            it('given the model before it failed to draw, starts fresh', () => {

                const { panel, recipe } = buildReaderSession();

                // AN OBJECT WITH NO FIELDS LIST IS A MODEL THE PANEL CANNOT DRAW
                render(panel, { ...recipe, objects: recipe.objects.map(object => object.objectApiName === 'Account' ? { objectApiName: 'Account' } : object) } as any, 2);
                expect(commandsPosted(panel)).toContain('renderFailed');
                render(panel, recipe, 3);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            // A Regenerate THAT RENAMED A TREE FOLDER, AND AN Add friend THAT ADDED A NICKNAME
            it('passes over a card, object or version the reloaded model no longer has and restores the rest, without throwing', () => {

                const { panel, recipe } = buildReaderSession();
                const reloadedRecipe = {
                    ...recipe,
                    objects: recipe.objects.map(object => object.objectApiName === 'Account' ? { ...object, nickname: 'Account_Ref_2' } : object),
                    trees: recipe.trees.map(tree => tree.treeKey === LEAD_TREE_KEY
                        ? { ...tree, treeKey: 'Lead-thru-Task', folderName: 'Lead-thru-Task', history: undefined }
                        : tree)
                };

                const postedBeforeReload = panel.postedHostMessages.length;

                reload(panel, reloadedRecipe);

                expect(commandsPosted(panel)).not.toContain('renderFailed');
                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                // THE OBJECT'S PLACE IS KEYED BY ITS NICKNAME, SO THE RENAMED OCCURRENCE IS NOT THE ONE THE READER OPENED
                expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(false);
                expect(commandsPosted(panel).slice(postedBeforeReload)).not.toContain('loadPicklistValues');
                expect(isCardOpen(panel, 'Lead-thru-Task')).toBe(false);
                expect(panel.savedState().trees.map((savedTree: any) => savedTree.treeKey)).toEqual([ACCOUNT_TREE_KEY]);

            });

            it('asks the host for the values and summaries it re-opens only after acknowledging the new draw', () => {

                const { panel, recipe } = buildReaderSession();
                const postedBeforeReload = panel.postedHostMessages.length;

                reload(panel, recipe);

                const postedByReload = commandsPosted(panel).slice(postedBeforeReload);
                expect(postedByReload).toContain('rendered');
                expect(postedByReload.indexOf('loadPicklistValues')).toBeGreaterThan(postedByReload.indexOf('rendered'));
                expect(postedByReload.indexOf('loadVersionSummaries')).toBeGreaterThan(postedByReload.indexOf('rendered'));
                expect(panel.postedHostMessages.slice(postedBeforeReload).find((hostMessage: any) => hostMessage.command === 'rendered').renderSequence).toBe(2);

            });

            it('saves the restored place once, after the restore', () => {

                const { panel, recipe } = buildReaderSession();
                const placeBeforeReload = panel.savedState();
                const savesBeforeReload = panel.setStateCalls.length;

                reload(panel, recipe);

                expect(panel.setStateCalls).toHaveLength(savesBeforeReload + 1);
                expect(panel.savedState()).toEqual(placeBeforeReload);

            });

            it('given a compared Data-by-Org tab with a status filter and an opened row, holds both until the card\'s comparison is drawn again', () => {

                const recipe = loadHistoryRecipe().recipeViewModel;
                const panel = runPanelScript();
                render(panel, recipe);
                openCard(panel, ACCOUNT_TREE_KEY);
                clickTab(panel, ACCOUNT_TREE_KEY, 'Data-by-Org');
                panel.postToPanel(buildAccountComparison(recipe, 1));
                panel.findAll(dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'), 'dataObjectToggle')[0].dispatch('click');
                const statusFilterElement = statusFilterOf(panel, ACCOUNT_TREE_KEY);
                statusFilterElement.value = 'new-in-org';
                statusFilterElement.dispatch('change');

                reload(panel, recipe, { treeKey: ACCOUNT_TREE_KEY, tab: 'dataByOrg' });

                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Data-by-Org');
                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('all');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual([]);

                panel.postToPanel(buildAccountComparison(recipe, 2));

                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('new-in-org');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual(['Brand_New__c']);

            });

            it('given the document\'s saved place was spent on its first model, restores the place on screen rather than the saved one', () => {

                const { panel: hiddenPanel, recipe } = buildReaderSession();

                const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
                render(panel, recipe, 1);
                openCard(panel, LEAD_TREE_KEY);
                render(panel, recipe, 2);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

        });

        it('given a focus posted with the model, opens the focused card on its tab over the saved one', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe, 1, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });

            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previous Fake Sets');
            // THE REST OF THE PLACE STILL COMES BACK
            expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(true);

        });

        it('keeps saving the place after a restore, so a second reload finds the latest one', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const secondPanel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(secondPanel, recipe);
            openCard(secondPanel, ACCOUNT_TREE_KEY);

            const thirdPanel = runPanelScript({ savedState: secondPanel.savedState() });
            render(thirdPanel, recipe);

            expect(isCardOpen(thirdPanel, ACCOUNT_TREE_KEY)).toBe(false);
            expect(isCardOpen(thirdPanel, LEAD_TREE_KEY)).toBe(true);

        });

        it('given a run of scroll events, saves once when they stop', () => {

            jest.useFakeTimers();

            const panel = runPanelScript();
            render(panel, loadHistoryRecipe().recipeViewModel);
            const savesBeforeScrolling = panel.setStateCalls.length;

            [100, 200, 300].forEach(scrollY => panel.scrollTo(scrollY));
            expect(panel.setStateCalls).toHaveLength(savesBeforeScrolling);

            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY);

            expect(panel.setStateCalls).toHaveLength(savesBeforeScrolling + 1);
            expect(panel.savedState().scrollY).toBe(300);

        });

        // EACH TAB A RESTORE SELECTS WOULD OTHERWISE SAVE A HALF-RESTORED PLACE, WALKING EVERY CARD
        it('saves the restored place once, after the restore, rather than per tab it selects', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(panel.setStateCalls).toHaveLength(1);
            expect(panel.savedState()).toEqual(hiddenPanel.savedState());

        });

        it('saves nothing before a model is drawn', () => {

            const panel = runPanelScript({ savedState: { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, trees: [] } });
            panel.postToPanel({ command: 'loadPhase', message: 'Reading the run…' });

            expect(panel.setStateCalls).toEqual([]);

        });

        describe('given a compared Data-by-Org tab, a status filter and an opened row', () => {

            const buildComparedSession = () => {
                const recipe = loadHistoryRecipe().recipeViewModel;
                const hiddenPanel = runPanelScript();
                render(hiddenPanel, recipe);
                openCard(hiddenPanel, ACCOUNT_TREE_KEY);
                clickTab(hiddenPanel, ACCOUNT_TREE_KEY, 'Data-by-Org');
                hiddenPanel.postToPanel(buildAccountComparison(recipe, 1));
                hiddenPanel.findAll(dataObjectNamed(hiddenPanel, ACCOUNT_TREE_KEY, 'Account'), 'dataObjectToggle')[0].dispatch('click');
                const statusFilterElement = statusFilterOf(hiddenPanel, ACCOUNT_TREE_KEY);
                statusFilterElement.value = 'new-in-org';
                statusFilterElement.dispatch('change');
                return { recipe, hiddenPanel, savedState: hiddenPanel.savedState() };
            };

            it('holds both until the card\'s comparison is drawn again, then narrows and opens the rows as they were', () => {

                const { recipe, hiddenPanel, savedState } = buildComparedSession();
                expect(visibleDataFieldNamesOf(hiddenPanel, dataObjectNamed(hiddenPanel, ACCOUNT_TREE_KEY, 'Account'))).toEqual(['Brand_New__c']);

                const panel = runPanelScript({ savedState: savedState });
                render(panel, recipe);

                // NO COMPARISON YET: NO ROW HAS A STATUS, SO APPLYING THE FILTER NOW WOULD HIDE EVERY ROW
                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Data-by-Org');
                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('all');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual([]);

                panel.postToPanel(buildAccountComparison(recipe, 1));

                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('new-in-org');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual(['Brand_New__c']);

            });

            it('given an open row and no status filter, opens the row once compared', () => {

                const recipe = loadHistoryRecipe().recipeViewModel;
                const hiddenPanel = runPanelScript();
                render(hiddenPanel, recipe);
                openCard(hiddenPanel, ACCOUNT_TREE_KEY);
                clickTab(hiddenPanel, ACCOUNT_TREE_KEY, 'Data-by-Org');
                hiddenPanel.postToPanel(buildAccountComparison(recipe, 1));
                hiddenPanel.findAll(dataObjectNamed(hiddenPanel, ACCOUNT_TREE_KEY, 'Account'), 'dataObjectToggle')[0].dispatch('click');

                const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
                render(panel, recipe);
                panel.postToPanel(buildAccountComparison(recipe, 1));

                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account')))
                    .toEqual(visibleDataFieldNamesOf(hiddenPanel, dataObjectNamed(hiddenPanel, ACCOUNT_TREE_KEY, 'Account')));
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toContain('Brand_New__c');

            });

            it('given the comparison comes back failed, drops both rather than keeping them for a later one', () => {

                const { recipe, savedState } = buildComparedSession();

                const panel = runPanelScript({ savedState: savedState });
                render(panel, recipe);
                panel.postToPanel(RecipeCockpitService.buildOrgConnectionFailureMessage(ACCOUNT_TREE_KEY, 'devhub', 'ECONNRESET', 1));
                panel.postToPanel(buildAccountComparison(recipe, 1));

                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('all');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual([]);

            });

            /*
                The comparison a filter was saved under comes back only as a replay. One the reader
                asks for is new, and must not open already narrowed by a filter set on an old one --
                which a reopen whose rows changed, and so carried nothing, would otherwise leave.
            */
            it.each([['Compare', 'describeInOrg'], ['Choose another org…', 'describeInChosenOrg']])('given the reader asks for a comparison with %s before any is replayed, drops both', (_label, buttonClassName) => {

                const { recipe, savedState } = buildComparedSession();

                const panel = runPanelScript({ savedState: savedState });
                render(panel, recipe);
                panel.findAll(treeCardOf(panel, ACCOUNT_TREE_KEY), buttonClassName)[0].dispatch('click');

                const droppedTree = panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);
                expect(droppedTree.statusFilter).toBe('all');
                expect(droppedTree.expandedDataObjectApiNames).toEqual([]);

                panel.postToPanel(buildAccountComparison(recipe, 1));

                expect(statusFilterOf(panel, ACCOUNT_TREE_KEY).value).toBe('all');
                expect(visibleDataFieldNamesOf(panel, dataObjectNamed(panel, ACCOUNT_TREE_KEY, 'Account'))).toEqual([]);

            });

            it('keeps both saved while they wait, so a reload before the comparison arrives does not lose them', () => {

                const { recipe, savedState } = buildComparedSession();

                const waitingPanel = runPanelScript({ savedState: savedState });
                render(waitingPanel, recipe);

                const waitingTree = waitingPanel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);
                expect(waitingTree.statusFilter).toBe('new-in-org');
                expect(waitingTree.expandedDataObjectApiNames).toEqual(['Account']);

            });

        });

        /*
            The place is the panel's own state, but what it names came from files on disk; it must
            hold only names, never a path, a picklist value or anything that names an org.
        */
        it('saves names only: no path, no picklist value, no org', () => {

            const { panel, recipe } = buildReaderSession();
            panel.postToPanel({ command: 'picklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c', picklistValues: ['Hot', 'Warm'], recordTypePicklistValues: [], renderSequence: 1 });
            clickTab(panel, ACCOUNT_TREE_KEY, 'Data-by-Org');
            panel.postToPanel(buildAccountComparison(recipe, 1));
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [`devhub (${ORG_USERNAME})`], selectedOrgIndex: 0, hiddenOrgNote: '', noOrgsMessage: '', renderSequence: 1 });
            clickTab(panel, ACCOUNT_TREE_KEY, 'Structure');

            const savedText = JSON.stringify(panel.savedState());

            expect(savedText).not.toContain(HISTORY_WORKSPACE_ROOT);
            expect(savedText).not.toContain('.yml');
            expect(savedText).not.toContain('Hot');
            expect(savedText).not.toContain(ORG_USERNAME);
            expect(savedText).not.toContain('devhub');
            expect(Object.keys(panel.savedState()).sort()).toEqual(['isOrgPickerInUse', 'runFolderName', 'scrollY', 'trees', 'version']);
            panel.savedState().trees.forEach((savedTree: any) => {
                expect(Object.keys(savedTree).sort()).toEqual(['expandedDataObjectApiNames', 'expandedObjectKeys', 'expandedVersionRunFolderNames',
                    'isExpanded', 'openPicklistKeys', 'searchQueries', 'selectedTab', 'statusFilter', 'treeKey']);
                expect(Object.keys(savedTree.searchQueries).sort()).toEqual(['dataByOrg', 'datasets', 'structure', 'versions']);
            });

        });

        describe('given a saved place the panel cannot use as it is', () => {

            const renderFrom = (savedState: any) => {
                const recipe = loadHistoryRecipe().recipeViewModel;
                const panel = runPanelScript({ savedState: savedState });
                render(panel, recipe);
                return panel;
            };

            it('passes over each entry naming nothing on screen and restores the rest, without throwing', () => {

                const panel = renderFrom({
                    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                    runFolderName: CURRENT_RUN_FOLDER_NAME,
                    isOrgPickerInUse: 'yes',
                    scrollY: 'far',
                    trees: [
                        null,
                        5,
                        { treeKey: '__proto__', isExpanded: true },
                        { treeKey: 'Gone-ONLY', isExpanded: true },
                        {
                            treeKey: LEAD_TREE_KEY,
                            selectedTab: 'nope',
                            statusFilter: 'constructor',
                            searchQueries: { structure: 7, toString: 'x', __proto__: 'y' },
                            expandedObjectKeys: 'Lead',
                            openPicklistKeys: [7],
                            expandedDataObjectApiNames: ['__proto__'],
                            expandedVersionRunFolderNames: ['__proto__']
                        },
                        { treeKey: ACCOUNT_TREE_KEY, isExpanded: true, searchQueries: 'rating', expandedObjectKeys: ['toString', 'Account\nAccount_Ref_1'] }
                    ]
                });

                expect(commandsPosted(panel)).not.toContain('renderFailed');
                expect(commandsPosted(panel)).not.toContain('loadDataOrgs');
                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(searchInputOf(panel, ACCOUNT_TREE_KEY, 'treeStructure').value).toBe('');
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
                // NO TAB IS BUILT FOR ROWS THE CARD DOES NOT HAVE, AND A TAB NAME THE PANEL DOES NOT DRAW IS IGNORED
                expect(commandsPosted(panel)).not.toContain('loadVersionSummaries');
                openCard(panel, LEAD_TREE_KEY);
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Structure');
                expect(panel.scrollToCalls).toEqual([]);

            });

            it.each([
                ['a place saved in another shape', { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION + 1, runFolderName: CURRENT_RUN_FOLDER_NAME, trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true }] }],
                ['a place with no run', { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true }] }],
                ['a place that is not an object', 'Account'],
                ['nothing at all', undefined]
            ])('given %s, draws the default place', (_description, savedState) => {

                const panel = renderFrom(savedState);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(commandsPosted(panel)).not.toContain('renderFailed');

            });

            it('given a webview whose state api throws or is missing, draws and works as before', () => {

                const recipe = loadHistoryRecipe().recipeViewModel;
                const panelWithoutStateApi = runPanelScript({ isStateApiMissing: true });
                render(panelWithoutStateApi, recipe);
                openCard(panelWithoutStateApi, ACCOUNT_TREE_KEY);

                expect(isCardOpen(panelWithoutStateApi, ACCOUNT_TREE_KEY)).toBe(true);
                expect(commandsPosted(panelWithoutStateApi)).not.toContain('renderFailed');

                const throwingState = { get version(): number { throw new Error('state is gone'); } };
                const panelWithThrowingState = renderFrom(throwingState);

                expect(isCardOpen(panelWithThrowingState, ACCOUNT_TREE_KEY)).toBe(false);
                expect(commandsPosted(panelWithThrowingState)).not.toContain('renderFailed');

            });

        });

    });

    describe('carryOrgDescribeMessages', () => {

        const recipe = loadHistoryRecipe().recipeViewModel;
        const carriedFrom = (recipeOnScreen: IRecipeCockpitRecipeViewModel): IRecipeCockpitCarriedPanelState => ({
            recipeDataMessage: { command: 'recipeData', recipe: recipeOnScreen, renderSequence: 3 },
            orgDescribeMessagesByTreeKey: new Map([[ACCOUNT_TREE_KEY, buildAccountComparison(recipeOnScreen, 3)]])
        });

        it('given the reload draws the same rows, carries every comparison under the new model\'s renderSequence', () => {

            const carriedMessages = RecipeCockpitService.carryOrgDescribeMessages(carriedFrom(recipe), loadHistoryRecipe().recipeViewModel, 9);

            expect([...carriedMessages.keys()]).toEqual([ACCOUNT_TREE_KEY]);
            expect(carriedMessages.get(ACCOUNT_TREE_KEY)).toEqual({ ...buildAccountComparison(recipe, 3), renderSequence: 9 });

        });

        it('given only the history or the run list changed, still carries them: those are not rows', () => {

            const reloadedRecipe = {
                ...recipe,
                runs: [...recipe.runs, { runFolderName: 'recipe-2026-10-01T00-00-00', label: 'newer' }],
                trees: recipe.trees.map(tree => ({ ...tree, history: undefined }))
            };

            expect(RecipeCockpitService.carryOrgDescribeMessages(carriedFrom(recipe), reloadedRecipe, 9).size).toBe(1);

        });

        it.each([
            ['a field changed', (reloaded: IRecipeCockpitRecipeViewModel) => ({ ...reloaded, objects: reloaded.objects.map((object, objectIndex) => objectIndex === 0 ? { ...object, fields: object.fields.slice(1) } : object) })],
            ['a card lists other objects', (reloaded: IRecipeCockpitRecipeViewModel) => ({ ...reloaded, trees: reloaded.trees.map(tree => ({ ...tree, objects: tree.objects.slice(1) })) })],
            ['another run is shown', (reloaded: IRecipeCockpitRecipeViewModel) => ({ ...reloaded, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME })]
        ])('given %s, carries nothing', (_description, changeModel) => {

            expect(RecipeCockpitService.carryOrgDescribeMessages(carriedFrom(recipe), changeModel(loadHistoryRecipe().recipeViewModel), 9).size).toBe(0);

        });

        it('given nothing to carry, carries nothing', () => {

            expect(RecipeCockpitService.carryOrgDescribeMessages(undefined, recipe, 9).size).toBe(0);

        });

    });

    describe('openRecipeCockpitPanel, run again on an open panel', () => {

        let createdWebviewPanel: any;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const panelState = () => (RecipeCockpitService as any).recipeCockpitPanelState;

        const openAndDraw = async (workspaceRoot = HISTORY_WORKSPACE_ROOT) => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData')?.renderSequence });
        };

        beforeEach(() => {

            postedPanelMessages = [];
            createdWebviewPanel = {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                        postedPanelMessages.push(hostMessage);
                        return Promise.resolve(true);
                    }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            };

            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => createdWebviewPanel);
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('reloads the run the reader picked rather than the newest', async () => {

            await openAndDraw();
            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            await openAndDraw();

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
            expect(lastPosted('recipeData').recipe.selectedRunFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);

        });

        it('given the picked run is gone, reloads the newest, as any run that cannot be found does', async () => {

            await openAndDraw();
            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            const findGeneratedRecipeRuns = RecipeCockpitService.findGeneratedRecipeRuns.bind(RecipeCockpitService);
            jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation((generatedRecipesFolderPath: string) =>
                findGeneratedRecipeRuns(generatedRecipesFolderPath).filter(recipeRun => recipeRun.runFolderName !== FAKER_JS_RUN_FOLDER_NAME));

            await openAndDraw();

            expect(lastPosted('recipeData').recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);

        });

        it('given the panel is opened for another workspace, carries nothing over', async () => {

            await openAndDraw();
            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            panelState().dataOrgCreateResults.set('key', { resultsFilePath: '/x' });

            await openAndDraw(path.join(__dirname, 'mocks', 'treeWorkspace'));

            expect(lastPosted('recipeData').recipe.selectedRunFolderName).not.toBe(FAKER_JS_RUN_FOLDER_NAME);
            expect(panelState().dataOrgCreateResults.size).toBe(0);

        });

        // AT SCALE THE OLD MODEL IS TENS OF MB, SO IT IS NOT HELD THROUGH A RELOAD THAT HAS NOTHING TO CHECK AGAINST IT
        it('given no comparison to carry, carries the run alone', async () => {

            await openAndDraw();
            const carryOrgDescribeMessagesSpy = jest.spyOn(RecipeCockpitService, 'carryOrgDescribeMessages');

            await openAndDraw();

            expect(carryOrgDescribeMessagesSpy).toHaveBeenCalledWith(undefined, expect.anything(), expect.any(Number));

        });

        it('replays the comparisons drawn over the same rows, under the reloaded model\'s renderSequence', async () => {

            await openAndDraw();
            const drawnRecipeData = lastPosted('recipeData');
            panelState().orgDescribeMessagesByTreeKey.set(ACCOUNT_TREE_KEY, buildAccountComparison(drawnRecipeData.recipe, drawnRecipeData.renderSequence));

            await openAndDraw();

            const reloadedRecipeData = lastPosted('recipeData');
            expect(reloadedRecipeData.renderSequence).not.toBe(drawnRecipeData.renderSequence);
            expect(lastPosted('orgDescribe')).toEqual({ ...buildAccountComparison(drawnRecipeData.recipe, 0), renderSequence: reloadedRecipeData.renderSequence });
            expect(postedPanelMessages.map(hostMessage => hostMessage.command).slice(-2)).toEqual(['recipeData', 'orgDescribe']);

        });

        it('given the reload reads back different rows, drops the comparisons as before', async () => {

            await openAndDraw();
            const drawnRecipeData = lastPosted('recipeData');
            panelState().orgDescribeMessagesByTreeKey.set(ACCOUNT_TREE_KEY, buildAccountComparison(drawnRecipeData.recipe, drawnRecipeData.renderSequence));

            const loadRecipeRunByRuns = RecipeCockpitService.loadRecipeRunByRuns.bind(RecipeCockpitService);
            jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns').mockImplementation((recipeRuns, workspaceRoot, requestedRunFolderName) => {
                const loadedRecipe = loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName);
                loadedRecipe.recipeViewModel.objects = loadedRecipe.recipeViewModel.objects.slice(1);
                return loadedRecipe;
            });
            postedPanelMessages.length = 0;

            await openAndDraw();

            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).not.toContain('orgDescribe');
            expect(panelState().orgDescribeMessagesByTreeKey.size).toBe(0);

        });

        it('keeps the Create results a "View errors" link opens', async () => {

            await openAndDraw();
            const storedCreateResult = { resultsFilePath: path.join(HISTORY_WORKSPACE_ROOT, 'results.json') };
            panelState().dataOrgCreateResults.set('jd@example.com\nLead-ONLY\nLead', storedCreateResult);
            const dataOrgRequestSequence = panelState().dataOrgRequestSequence;

            await openAndDraw();

            expect(panelState().dataOrgCreateResults.get('jd@example.com\nLead-ONLY\nLead')).toBe(storedCreateResult);
            expect(panelState().dataOrgRequestSequence).toBeGreaterThan(dataOrgRequestSequence);

        });

    });

});
