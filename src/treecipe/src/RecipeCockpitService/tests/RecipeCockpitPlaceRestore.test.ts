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
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB,
    RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY,
    RECIPE_COCKPIT_PICKLIST_SHOW_VALUES_LABEL,
    RECIPE_COCKPIT_PICKLIST_HIDE_VALUES_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
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

describe('RecipeCockpitService, the reader\'s place', () => {

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const treeCardOf = (panel: Panel, treeKey: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === treeKey);
        // THE CARD THE TREECIPES DROPDOWN DRAWS (#374): ONE AT A TIME
        const isCardOpen = (panel: Panel, treeKey: string) => !panel.isHidden(treeCardOf(panel, treeKey));
        const openCard = (panel: Panel, treeKey: string) => panel.chooseTreeCard(treeCardOf(panel, treeKey));
        const clickTab = (panel: Panel, treeKey: string, tabLabel: string) => panel.openTab(treeCardOf(panel, treeKey), tabLabel);
        const selectedTabOf = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeTab')
            .find((tabElement: any) => tabElement.classList.contains('selected'))?.textContent;
        const objectNamed = (panel: Panel, treeKey: string, objectApiName: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeObject')
            .find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
        const isObjectOpen = (panel: Panel, treeKey: string, objectApiName: string) => !panel.isHidden(panel.objectBodyOf(objectNamed(panel, treeKey, objectApiName)));
        const picklistToggleOf = (panel: Panel, treeKey: string, objectApiName: string, fieldApiName: string) =>
            panel.findAll(panel.fieldRowNamed(objectNamed(panel, treeKey, objectApiName), fieldApiName), 'picklistToggle')[0];
        const visibleDatasetCount = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeDataset')
            .filter((datasetElement: any) => !panel.isHidden(datasetElement)).length;
        const searchInputOf = (panel: Panel, treeKey: string, panelClassName: string) =>
            panel.findAll(panel.tabPanelOf(treeCardOf(panel, treeKey), panelClassName), 'tabSearchInput')[0];
        const matchCountOf = (panel: Panel, treeKey: string, panelClassName: string) =>
            panel.findAll(panel.tabPanelOf(treeCardOf(panel, treeKey), panelClassName), 'tabMatchCount')[0].textContent;
        const commandsPosted = (panel: Panel) => panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);
        const indexOfCommand = (panel: Panel, command: string) => commandsPosted(panel).indexOf(command);

        const render = (panel: Panel, recipe: IRecipeCockpitRecipeViewModel, renderSequence = 1, focusTree?: any) =>
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: renderSequence, ...( focusTree ? { focusTree } : {} ) });

        // THE READER'S SESSION: TWO CARDS OPEN, AN OBJECT AND A PICKLIST OPENED, THE DATA SETS TAB SEARCHED, SCROLLED
        const buildReaderSession = () => {

            jest.useFakeTimers();

            const recipe = loadHistoryRecipe().recipeViewModel;
            const panel = runPanelScript();
            render(panel, recipe);

            openCard(panel, ACCOUNT_TREE_KEY);
            panel.expandObject(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'));
            picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').dispatch('click');

            openCard(panel, LEAD_TREE_KEY);
            clickTab(panel, LEAD_TREE_KEY, 'Previously Used Data Sets');
            panel.typeIntoTabSearch(treeCardOf(panel, LEAD_TREE_KEY), 'treeDatasets', '09-21');

            panel.scrollTo(480);
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY);

            return { panel, recipe };

        };

        afterEach(() => {
            jest.useRealTimers();
        });

        it('given the document is rebuilt, puts back every card, tab, object, picklist and search the reader had, and the scroll', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            // ONE CARD IS DRAWN AT A TIME (#374): THE ONE CHOSEN LAST; THE OTHER KEEPS ITS TAB, OBJECTS AND PICKLISTS FOR WHEN IT IS CHOSEN
            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Treecipe');
            expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(true);
            expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Contact')).toBe(false);
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').attributes['aria-expanded']).toBe('true');
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').textContent).toBe(RECIPE_COCKPIT_PICKLIST_HIDE_VALUES_LABEL);
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Regions__c').attributes['aria-expanded']).toBe('false');
            expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Regions__c').textContent).toBe(RECIPE_COCKPIT_PICKLIST_SHOW_VALUES_LABEL);

            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');
            expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeDatasets').value).toBe('09-21');
            expect(visibleDatasetCount(panel, LEAD_TREE_KEY)).toBe(1);

            expect(panel.scrollToCalls).toEqual([480]);

        });

        // #277: A ROW REBUILT OPEN USED TO APPEND ITS VALUES BEFORE ITS HEADER, SO THEY DREW ABOVE THE FIELD NAME
        it('draws a re-opened picklist\'s values under its own header, where a click puts them', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            const ratingRow = panel.fieldRowNamed(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'), 'Rating__c');
            expect(ratingRow.children[0].classList.contains('treeFieldHeader')).toBe(true);
            // #398: THE VALUES SIT UNDER THE SHOW VALUES BUTTON, WHICH IS UNDER THE FAKER VALUE AT THE END OF THE ROW
            const picklistSection = ratingRow.children[ratingRow.children.length - 1];
            expect(picklistSection.classList.contains('picklistSection')).toBe(true);
            expect(picklistSection.children[0].classList.contains('picklistToggle')).toBe(true);
            expect(picklistSection.children[picklistSection.children.length - 1].classList.contains('picklistValues')).toBe(true);
            expect(panel.findAll(ratingRow, 'picklistValues')).toHaveLength(1);

        });

        // THE HOST HONOURS loadPicklistValues ONLY ONCE "rendered" HAS ACTIVATED THIS MODEL'S ALLOW-LISTS
        it('asks the host for the values it re-opens only after acknowledging the draw', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(indexOfCommand(panel, 'rendered')).toBeGreaterThan(-1);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues'))
                .toEqual([{ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' }]);
            expect(indexOfCommand(panel, 'loadPicklistValues')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));
            expect(commandsPosted(panel)).not.toContain('loadVersionSummaries');

        });

        it('given a Treecipe search, restores it as typed and the rows it narrowed to', () => {

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

        // OPENING A CARD ON ITS TREECIPE TAB IS OPENING THE ORG PICKER THAT TAB DRAWS
        it('given the reader opened a card on its Treecipe tab and moved to its data sets, comes back to the data sets and asks for the orgs again after the draw', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);
            openCard(hiddenPanel, LEAD_TREE_KEY);

            expect(commandsPosted(hiddenPanel)).toContain('loadDataOrgs');

            clickTab(hiddenPanel, LEAD_TREE_KEY, 'Previously Used Data Sets');

            expect(hiddenPanel.savedState().isOrgPickerInUse).toBe(true);

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');
            expect(indexOfCommand(panel, 'loadDataOrgs')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));
            expect(commandsPosted(panel).filter(command => command === 'loadDataOrgs')).toHaveLength(1);

        });

        it('given the reader had used the org picker, asks for the orgs again after the draw with no card chosen', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);
            hiddenPanel.findAll(hiddenPanel.cockpitBodyElement, 'dataOrgLoad')[0].dispatch('click');

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
            expect(indexOfCommand(panel, 'loadDataOrgs')).toBeGreaterThan(indexOfCommand(panel, 'rendered'));

        });

        // A RESTORE IS THE PANEL'S OWN OPEN, NOT THE READER OPENING A TREECIPE TAB, SO IT NEVER RUNS THE CLI'S CONNECTION CHECK BY ITSELF
        it('given a place whose org picker was never used, lists no orgs even with a card restored on its Treecipe tab: listing them runs the CLI\'s connection check', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();
            // THE FIRST CARD, RESTORED ON ITS TREECIPE TAB, IS THE ONE THE DROPDOWN DRAWS
            const savedPlace = { ...hiddenPanel.savedState(), isOrgPickerInUse: false, selectedTreeKey: undefined };
            expect(savedPlace.trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY).selectedTab).toBe('treecipe');

            const panel = runPanelScript({ savedState: savedPlace });
            render(panel, recipe);

            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Treecipe');
            expect(commandsPosted(panel)).not.toContain('loadDataOrgs');

        });

        describe('given a place saved before the Treecipe tab (version 1)', () => {

            const toVersionOnePlace = (place: any) => ({
                ...place,
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB,
                trees: place.trees.map((savedTree: any) => ({
                    ...savedTree,
                    selectedTab: ({ treecipe: 'structure' } as Record<string, string>)[savedTree.selectedTab] ?? savedTree.selectedTab,
                    searchQueries: { structure: savedTree.searchQueries.treecipe, datasets: savedTree.searchQueries.datasets }
                }))
            });

            it('given its own getState naming the Structure tab and its search, opens the Treecipe tab with the search as typed', () => {

                const recipe = loadHistoryRecipe().recipeViewModel;
                const hiddenPanel = runPanelScript();
                render(hiddenPanel, recipe);
                openCard(hiddenPanel, ACCOUNT_TREE_KEY);
                hiddenPanel.typeIntoFilter('Rating', treeCardOf(hiddenPanel, ACCOUNT_TREE_KEY));
                const versionOnePlace = toVersionOnePlace(hiddenPanel.savedState());
                expect(versionOnePlace.trees[0]).toMatchObject({ selectedTab: 'structure', searchQueries: { structure: 'Rating' } });

                const panel = runPanelScript({ savedState: versionOnePlace });
                render(panel, recipe);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Treecipe');
                expect(searchInputOf(panel, ACCOUNT_TREE_KEY, 'treeStructure').value).toBe('Rating');
                // SAVED BACK IN THE CURRENT SHAPE
                expect(panel.savedState().version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);
                expect(panel.savedState().trees[0]).toEqual(expect.objectContaining({ selectedTab: 'treecipe', searchQueries: { treecipe: 'Rating', datasets: '' } }));

            });

        });

        // #265: THE TAB IS GONE, SO A CARD SAVED ON IT OPENS ON TREECIPE, AND ITS SEARCH AND OPENED VERSIONS ARE DROPPED -- NEVER MOVED ONTO ANOTHER TAB
        describe('given a place saved on the removed Previous Versions tab', () => {

            const buildPlaceOnPreviousVersions = (placeVersion: number) => {
                const recipe = loadHistoryRecipe().recipeViewModel;
                const hiddenPanel = runPanelScript();
                render(hiddenPanel, recipe);
                openCard(hiddenPanel, LEAD_TREE_KEY);
                const savedPlace = hiddenPanel.savedState();
                const leadTreePlace = savedPlace.trees.find((savedTree: any) => savedTree.treeKey === LEAD_TREE_KEY)
                    ?? { treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [] };
                return {
                    recipe,
                    place: {
                        ...savedPlace,
                        version: placeVersion,
                        trees: [{
                            ...leadTreePlace,
                            selectedTab: 'versions',
                            searchQueries: { ...leadTreePlace.searchQueries, versions: 'FakerJS' },
                            expandedVersionRunFolderNames: [FAKER_JS_RUN_FOLDER_NAME]
                        }]
                    }
                };
            };

            const expectOpenedOnTreecipe = (panel: Panel) => {
                expect(commandsPosted(panel)).not.toContain('renderFailed');
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Treecipe');
                expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeStructure').value).toBe('');
                expect(panel.findAll(treeCardOf(panel, LEAD_TREE_KEY), 'treeVersions')).toEqual([]);
                expect(commandsPosted(panel)).not.toContain('loadVersionSummaries');
                const savedLeadTree = panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === LEAD_TREE_KEY);
                // A CARD BACK AT ITS DEFAULT IS NOT WRITTEN AT ALL
                expect(savedLeadTree?.selectedTab ?? 'treecipe').toBe('treecipe');
                expect(JSON.stringify(panel.savedState())).not.toMatch(/FakerJS|versions|expandedVersionRunFolderNames/);
            };

            it.each([
                ['2', RECIPE_COCKPIT_PANEL_PLACE_VERSION],
                ['1', RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB]
            ])('given its own version %s getState, opens the card on Treecipe and keeps nothing of that tab', (_versionLabel, placeVersion) => {

                const { recipe, place } = buildPlaceOnPreviousVersions(placeVersion);

                const panel = runPanelScript({ savedState: place });
                render(panel, recipe);

                expectOpenedOnTreecipe(panel);

            });

            it('given the host\'s version 2 place, opens the card on Treecipe and keeps nothing of that tab', () => {

                const { recipe, place } = buildPlaceOnPreviousVersions(RECIPE_COCKPIT_PANEL_PLACE_VERSION);

                const panel = runPanelScript();
                panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, restorePlace: place });

                expectOpenedOnTreecipe(panel);

            });

        });

        // #266: THE COMPARE TAB (DATA-BY-ORG BEFORE VERSION 2) IS GONE, SO A CARD SAVED ON IT OPENS ON TREECIPE, AND ITS SEARCH, STATUS FILTER AND OPENED ROWS ARE DROPPED
        describe('given a place saved on the removed Compare tab', () => {

            const buildPlaceOnCompare = (placeVersion: number, savedTabName: string) => {
                const recipe = loadHistoryRecipe().recipeViewModel;
                const hiddenPanel = runPanelScript();
                render(hiddenPanel, recipe);
                openCard(hiddenPanel, LEAD_TREE_KEY);
                const savedPlace = hiddenPanel.savedState();
                const leadTreePlace = savedPlace.trees.find((savedTree: any) => savedTree.treeKey === LEAD_TREE_KEY)
                    ?? { treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [] };
                return {
                    recipe,
                    place: {
                        ...savedPlace,
                        version: placeVersion,
                        trees: [{
                            ...leadTreePlace,
                            selectedTab: savedTabName,
                            searchQueries: { ...leadTreePlace.searchQueries, [savedTabName]: 'Brand' },
                            statusFilter: 'new-in-org',
                            expandedDataObjectApiNames: ['Lead']
                        }]
                    }
                };
            };

            const expectOpenedOnTreecipe = (panel: Panel) => {
                expect(commandsPosted(panel)).not.toContain('renderFailed');
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Treecipe');
                expect(panel.findAll(treeCardOf(panel, LEAD_TREE_KEY), 'treeTab').map((tabElement: any) => tabElement.textContent)).not.toContain('Compare');
                expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeStructure').value).toBe('');
                expect(panel.findAll(treeCardOf(panel, LEAD_TREE_KEY), 'statusFilter')).toEqual([]);
                const savedLeadTree = panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === LEAD_TREE_KEY);
                // A CARD BACK AT ITS DEFAULT IS NOT WRITTEN AT ALL
                expect(savedLeadTree?.selectedTab ?? 'treecipe').toBe('treecipe');
                expect(JSON.stringify(panel.savedState())).not.toMatch(/Brand|statusFilter|new-in-org|expandedDataObjectApiNames|compare|dataByOrg/);
            };

            it.each([
                ['2', RECIPE_COCKPIT_PANEL_PLACE_VERSION, 'compare'],
                ['1', RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB, 'dataByOrg']
            ])('given its own version %s getState, opens the card on Treecipe and keeps nothing of that tab', (_versionLabel, placeVersion, savedTabName) => {

                const { recipe, place } = buildPlaceOnCompare(placeVersion, savedTabName);

                const panel = runPanelScript({ savedState: place });
                render(panel, recipe);

                expectOpenedOnTreecipe(panel);

            });

            it.each([
                ['2', RECIPE_COCKPIT_PANEL_PLACE_VERSION, 'compare'],
                ['1', RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB, 'dataByOrg']
            ])('given the host\'s version %s place, opens the card on Treecipe and keeps nothing of that tab', (_versionLabel, placeVersion, savedTabName) => {

                const { recipe, place } = buildPlaceOnCompare(placeVersion, savedTabName);

                const panel = runPanelScript();
                panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, restorePlace: place });

                expectOpenedOnTreecipe(panel);

            });

        });

        it('given the reader opened nothing, saves the default place and restores it as the default', () => {

            const recipe = loadHistoryRecipe().recipeViewModel;
            const hiddenPanel = runPanelScript();
            render(hiddenPanel, recipe);

            expect(hiddenPanel.savedState()).toEqual({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: CURRENT_RUN_FOLDER_NAME,
                isOrgPickerInUse: false,
                isFavoritesOnly: false,
                scrollY: 0,
                trees: []
            });

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe);

            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
            expect(panel.scrollToCalls).toEqual([]);

        });

        it('given the first model drawn is another run, restores nothing and saves the place of the run on screen', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();
            // THE SAME CARDS UNDER ANOTHER RUN'S NAME, SO ONLY THE RUN DECIDES WHETHER THE PLACE APPLIES
            const otherRecipe = { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME };

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, otherRecipe);

            expect(panel.treeCards()).toHaveLength(2);
            expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
            expect(panel.scrollToCalls).toEqual([]);
            expect(panel.savedState().runFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
            expect(panel.savedState().trees).toEqual([]);

        });

        describe('given a later model of the same run in the same document (#225)', () => {

            // WHAT Run Faker, an insert AND Add friend DO: THE HOST RELOADS THE RUN ON SCREEN AND POSTS IT AGAIN
            const reload = (panel: Panel, recipe: IRecipeCockpitRecipeViewModel, focusTree?: any) => {
                const scrollCallsBefore = panel.scrollToCalls.length;
                render(panel, recipe, 2, focusTree);
                return panel.scrollToCalls.slice(scrollCallsBefore);
            };

            // THE CARD ON SCREEN IS THE ONE CHOSEN LAST, OR THE ONE A FOCUS NAMES (#374); THE OTHER KEEPS ITS PLACE, HIDDEN
            const expectReaderSessionRestored = (panel: Panel, shownTreeKey = LEAD_TREE_KEY) => {
                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(shownTreeKey === ACCOUNT_TREE_KEY);
                expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Account')).toBe(true);
                expect(isObjectOpen(panel, ACCOUNT_TREE_KEY, 'Contact')).toBe(false);
                expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Rating__c').attributes['aria-expanded']).toBe('true');
                expect(picklistToggleOf(panel, ACCOUNT_TREE_KEY, 'Account', 'Regions__c').attributes['aria-expanded']).toBe('false');
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(shownTreeKey === LEAD_TREE_KEY);
                expect(searchInputOf(panel, LEAD_TREE_KEY, 'treeDatasets').value).toBe('09-21');
            };

            it('puts back every card, tab, object, picklist and search the reader had, and the scroll', () => {

                const { panel, recipe } = buildReaderSession();

                const scrollCalls = reload(panel, recipe);

                expectReaderSessionRestored(panel);
                expect(selectedTabOf(panel, ACCOUNT_TREE_KEY)).toBe('Treecipe');
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');
                expect(visibleDatasetCount(panel, LEAD_TREE_KEY)).toBe(1);
                expect(scrollCalls).toEqual([480]);
                expect(commandsPosted(panel)).not.toContain('renderFailed');

            });

            it.each([
                ['Run Faker', { treeKey: LEAD_TREE_KEY, tab: 'datasets' }, LEAD_TREE_KEY, 'Previously Used Data Sets'],
                ['an insert', { treeKey: ACCOUNT_TREE_KEY, tab: 'treecipe' }, ACCOUNT_TREE_KEY, 'Treecipe'],
                // #266: THE COMPARE TAB IS GONE, SO A FOCUS NAMING IT OPENS THE CARD ON THE TAB IT HAD
                ['a focus naming the removed Compare tab', { treeKey: ACCOUNT_TREE_KEY, tab: 'compare' }, ACCOUNT_TREE_KEY, 'Treecipe'],
                ['Add friend', { treeKey: LEAD_TREE_KEY, tab: 'treecipe' }, LEAD_TREE_KEY, 'Treecipe']
            ])('given %s\'s focus, opens its card on its tab and restores everything else', (_action, focusTree, focusedTreeKey, focusedTabLabel) => {

                const { panel, recipe } = buildReaderSession();

                reload(panel, recipe, focusTree);

                expect(selectedTabOf(panel, focusedTreeKey)).toBe(focusedTabLabel);
                expectReaderSessionRestored(panel, focusedTreeKey);
                const otherTreeKey = focusedTreeKey === ACCOUNT_TREE_KEY ? LEAD_TREE_KEY : ACCOUNT_TREE_KEY;
                expect(selectedTabOf(panel, otherTreeKey)).toBe(otherTreeKey === LEAD_TREE_KEY ? 'Previously Used Data Sets' : 'Treecipe');

            });

            it('given a focus on another card than the one chosen, chooses it and keeps the other card\'s place', () => {

                jest.useFakeTimers();
                const recipe = loadHistoryRecipe().recipeViewModel;
                const panel = runPanelScript();
                render(panel, recipe);
                openCard(panel, ACCOUNT_TREE_KEY);

                reload(panel, recipe, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(false);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(true);
                expect(panel.treePicker().value).toBe('1');
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');

            });

            it('given the reload landed on another run, starts fresh', () => {

                const { panel, recipe } = buildReaderSession();

                const scrollCalls = reload(panel, { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
                expect(scrollCalls).toEqual([]);
                expect(panel.savedState().runFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
                expect(panel.savedState().trees).toEqual([]);

            });

            // #263: Regenerate WAS THE ONE RELOAD THAT CARRIED THE PLACE ACROSS RUNS; WITH IT GONE, A STRAY MARKER CARRIES NOTHING
            it('ignores a carryPlaceAcrossRuns marker, so a model of another run starts fresh', () => {

                const { panel, recipe } = buildReaderSession();

                panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME }, renderSequence: 2, carryPlaceAcrossRuns: true });

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            it('given the reader switched runs, starts fresh, and switching back starts fresh too', () => {

                const { panel, recipe } = buildReaderSession();

                render(panel, { ...recipe, selectedRunFolderName: FAKER_JS_RUN_FOLDER_NAME }, 2);
                render(panel, recipe, 3);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            it('given the model before it failed to draw, starts fresh', () => {

                const { panel, recipe } = buildReaderSession();

                // AN OBJECT WITH NO FIELDS LIST IS A MODEL THE PANEL CANNOT DRAW
                render(panel, { ...recipe, objects: recipe.objects.map(object => object.objectApiName === 'Account' ? { objectApiName: 'Account' } : object) } as any, 2);
                expect(commandsPosted(panel)).toContain('renderFailed');
                render(panel, recipe, 3);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

            // A RELOAD WHOSE RUN LOST A TREE FOLDER, AND AN Add friend THAT ADDED A NICKNAME
            it('passes over a card or object the reloaded model no longer has and restores the rest, without throwing', () => {

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
                // THE CHOSEN CARD IS GONE, SO THE FIRST IS DRAWN, AND IT HAS NOTHING OF ITS OWN TO KEEP
                expect(panel.savedState().selectedTreeKey).toBeUndefined();
                expect(panel.savedState().trees.map((savedTree: any) => savedTree.treeKey)).toEqual([]);

            });

            it('asks the host for the values it re-opens only after acknowledging the new draw', () => {

                const { panel, recipe } = buildReaderSession();
                const postedBeforeReload = panel.postedHostMessages.length;

                reload(panel, recipe);

                const postedByReload = commandsPosted(panel).slice(postedBeforeReload);
                expect(postedByReload).toContain('rendered');
                expect(postedByReload.indexOf('loadPicklistValues')).toBeGreaterThan(postedByReload.indexOf('rendered'));
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

            it('given the document\'s saved place was spent on its first model, restores the place on screen rather than the saved one', () => {

                const { panel: hiddenPanel, recipe } = buildReaderSession();

                const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
                render(panel, recipe, 1);
                openCard(panel, ACCOUNT_TREE_KEY);
                render(panel, recipe, 2);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);

            });

        });

        it('given a focus posted with the model, opens the focused card on its tab over the saved one', () => {

            const { panel: hiddenPanel, recipe } = buildReaderSession();

            const panel = runPanelScript({ savedState: hiddenPanel.savedState() });
            render(panel, recipe, 1, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });

            expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Previously Used Data Sets');
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

            expect(isCardOpen(thirdPanel, ACCOUNT_TREE_KEY)).toBe(true);
            expect(isCardOpen(thirdPanel, LEAD_TREE_KEY)).toBe(false);

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

        /*
            The place is the panel's own state, but what it names came from files on disk; it must
            hold only names, never a path, a picklist value or anything that names an org.
        */
        it('saves names only: no path, no picklist value, no org', () => {

            const { panel } = buildReaderSession();
            panel.postToPanel({ command: 'picklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c', picklistValues: ['Hot', 'Warm'], recordTypePicklistValues: [], renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgList', orgLabels: [`devhub (${ORG_USERNAME})`], selectedOrgIndex: 0, hiddenOrgNote: '', noOrgsMessage: '', renderSequence: 1 });

            const savedText = JSON.stringify(panel.savedState());

            expect(savedText).not.toContain(HISTORY_WORKSPACE_ROOT);
            expect(savedText).not.toContain('.yml');
            expect(savedText).not.toContain('Hot');
            expect(savedText).not.toContain(ORG_USERNAME);
            expect(savedText).not.toContain('devhub');
            expect(Object.keys(panel.savedState()).sort()).toEqual(['isFavoritesOnly', 'isOrgPickerInUse', 'runFolderName', 'scrollY', 'selectedTreeKey', 'trees', 'version']);
            panel.savedState().trees.forEach((savedTree: any) => {
                expect(Object.keys(savedTree).sort()).toEqual(['expandedObjectKeys',
                    'isExpanded', 'openPicklistKeys', 'searchQueries', 'selectedTab', 'treeKey']);
                expect(Object.keys(savedTree.searchQueries).sort()).toEqual(['datasets', 'treecipe']);
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
                            searchQueries: { treecipe: 7, toString: 'x', __proto__: 'y' },
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
                expect(selectedTabOf(panel, LEAD_TREE_KEY)).toBe('Treecipe');
                expect(panel.scrollToCalls).toEqual([]);

            });

            it.each([
                ['a place saved in another shape', { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION + 1, runFolderName: CURRENT_RUN_FOLDER_NAME, trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true }] }],
                ['a place with no run', { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true }] }],
                ['a place that is not an object', 'Account'],
                ['nothing at all', undefined]
            ])('given %s, draws the default place', (_description, savedState) => {

                const panel = renderFrom(savedState);

                expect(isCardOpen(panel, ACCOUNT_TREE_KEY)).toBe(true);
                expect(isCardOpen(panel, LEAD_TREE_KEY)).toBe(false);
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

                expect(isCardOpen(panelWithThrowingState, ACCOUNT_TREE_KEY)).toBe(true);
                expect(commandsPosted(panelWithThrowingState)).not.toContain('renderFailed');

            });

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

            await openAndDraw(path.join(__dirname, 'mocks', 'treeWorkspace'));

            expect(lastPosted('recipeData').recipe.selectedRunFolderName).not.toBe(FAKER_JS_RUN_FOLDER_NAME);

        });

        // #266: THERE IS NO COMPARISON TO CARRY, SO A REOPEN POSTS THE MODEL AND NOTHING ABOUT AN ORG'S FIELDS
        it('posts no comparison on a reopen', async () => {

            await openAndDraw();
            postedPanelMessages.length = 0;

            await openAndDraw();

            const postedCommands = postedPanelMessages.map(hostMessage => hostMessage.command);
            expect(postedCommands).toContain('recipeData');
            expect(postedCommands).not.toContain('orgDescribe');
            expect(postedCommands).not.toContain('orgProgress');
            expect(panelState()).not.toHaveProperty('orgDescribeMessagesByTreeKey');

        });

        // #301: AN INSERT'S RESULT IS ITS NOTIFICATION'S, SO NOTHING OF IT IS HELD FOR A REOPEN
        it('keeps the org selection\'s request sequence, and holds no insert result', async () => {

            await openAndDraw();
            const dataOrgRequestSequence = panelState().dataOrgRequestSequence;

            await openAndDraw();

            expect(panelState()).not.toHaveProperty('dataOrgInsertResults');
            expect(panelState().dataOrgRequestSequence).toBeGreaterThan(dataOrgRequestSequence);

        });

    });

});
