import { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH } from '../../RecipeCockpitAdapterConstants';
import {
    RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS,
    RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB,
    RECIPE_COCKPIT_REMOVED_TREE_TABS,
    RECIPE_COCKPIT_TABS_WITHOUT_SEARCH,
    RECIPE_COCKPIT_TREE_TAB_RENAMES,
    RECIPE_COCKPIT_TREE_TABS
} from '../../RecipeCockpitShellConstants';
import { RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS } from '../../RecipeCockpitTroubleshootingConstants';
import type { RecipeCockpitTroubleshootingSubTab } from '../../RecipeCockpitTroubleshootingConstants';
import type { RecipeCockpitTreeTab } from '../../RecipeCockpitShellConstants';
import { setDatasetJourneyExpanded } from '../datasets/DatasetJourney';
import { applyDatasetsFilter } from '../datasets/DatasetsTab';
import { vscodeApi } from '../RecipeCockpitPanelConnection';
import { hasAnyString, hasString, toStringSet } from '../RecipeCockpitPanelShared';
import { readHistorySort } from '../troubleshooting/TroubleshootingHistory';
import { troubleshootingSearchKey } from '../troubleshooting/TroubleshootingTab';
import { ensureTreeBodyBuilt, selectTreeTab } from '../treecipe/card/TreeCardTabs';
import { dataOrgPicker } from '../treecipe/dataOrg/DataOrgPickerState';
import { drawHideUnselectedToggle, findHideUnselectedReason, isObjectHidingUnselectedIn } from '../treecipe/fieldRows/FieldScope';
import { navigationState } from '../treecipe/navigation/NavigationState';
import { applyStructureFilter } from '../treecipe/navigation/StructureFilter';
import { isRecordTypeFieldsOnlyIn } from '../treecipe/recordTypes/RecordTypeFieldsToggle';
import { setRecordTypesExpanded } from '../treecipe/recordTypes/RecordTypesSection';
import { drawObjectTodosToggle, isObjectTodosOnlyIn, isTodosOnlyIn } from '../treecipe/recordTypes/TodosToggles';
import { isHelpOpen, restoreHelpExpanded } from './Help';
import { findTreeState, renderedRunFolderName, renderedSequence, treeStates } from './PanelRender';
import type { CardObjectState, CardTreeState, ICardModel } from '../treecipe/card/CardTypes';
import type { IFieldRowFieldState } from '../treecipe/fieldRows/FieldRowTypes';

/*
    The reader's place (#222), kept with vscodeApi.setState so it outlives the document VS Code
    throws away when the tab is hidden. It holds NAMES only -- tree keys, object api names and
    nicknames, field api names, run folder names, tab names -- each tab's search as the panel
    holds it, whether the org picker was in use, and a scroll offset: nothing the host
    keeps to itself, no path, no picklist value, no org label or username.
*/

export interface ITreePlace {
    treeKey: string;
    isExpanded: boolean;
    selectedTab: string;
    searchQueries: Record<string, string>;
    expandedObjectKeys: string[];
    openPicklistKeys: string[];
    isDatasetFavoritesOnly?: true;
    expandedJourneyDatasetFolderNames?: string[];
    isRecordTypesExpanded?: true;
    isRecordTypeFieldsOnly?: true;
    isTodosOnly?: true;
    todosOnlyObjectKeys?: string[];
    hideUnselectedObjectKeys?: string[];
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    troubleshootingSearchQueries?: Record<string, string>;
    todosView?: 'removed';
    removedTodosSearchText?: string;
    troubleshootingHistorySort?: { column: string; isDescending: boolean };
    updaterExpandedObjectKeys?: string[];
    updaterStep?: 'structure';
    updaterParentObjectApiName?: string;
    updaterParentWhereText?: string;
}

export interface IPanelPlace {
    version: number;
    runFolderName: string;
    isOrgPickerInUse?: unknown;
    isFavoritesOnly?: unknown;
    scrollY?: unknown;
    trees?: unknown;
    isHelpExpanded?: unknown;
    selectedTreeKey?: unknown;
    treecipesSearchText?: unknown;
}

// A SAVED TREE AS IT IS READ BACK: WHATEVER A FILE OR AN OLDER VERSION HOLDS, EACH FIELD CHECKED BEFORE IT IS USED
interface ISavedTreePlace {
    treeKey?: unknown;
    selectedTab?: unknown;
    searchQueries?: unknown;
    expandedObjectKeys?: unknown;
    openPicklistKeys?: unknown;
    todosOnlyObjectKeys?: unknown;
    hideUnselectedObjectKeys?: unknown;
    troubleshootingSearchQueries?: unknown;
    troubleshootingSubTab?: unknown;
    todosView?: unknown;
    removedTodosSearchText?: unknown;
    troubleshootingHistorySort?: unknown;
    isDatasetFavoritesOnly?: unknown;
    expandedJourneyDatasetFolderNames?: unknown;
    isRecordTypeFieldsOnly?: unknown;
    isTodosOnly?: unknown;
    updaterExpandedObjectKeys?: unknown;
    updaterParentObjectApiName?: unknown;
    updaterStep?: unknown;
    updaterParentWhereText?: unknown;
    isRecordTypesExpanded?: unknown;
}

/*
    Where the reader was when this document was last on screen (#222). A hidden tab's document
    is thrown away, so the place is read ONCE, when the panel starts, and spent on the first model
    drawn -- and only if that model is the run it was saved for. Nothing is saved until it is
    spent, or the default view drawn first would overwrite the place before it is read.
*/
let restorablePlace: IPanelPlace | null = null;
let isPlaceRestoreSettled = false;
// EACH TAB A RESTORE SELECTS WOULD SAVE A HALF-RESTORED PLACE, WALKING EVERY CARD; THE RENDER SAVES ONCE AFTER IT
export let isRestoringPlace = false;
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function readRestorablePlace(): void {
    restorablePlace = readSavedPanelPlace();
}

function readSavedPanelPlace(): IPanelPlace | null {

    // A PLACE THAT CANNOT BE READ IS NO PLACE: THE PANEL DRAWS ITS DEFAULT RATHER THAN NOTHING
    try {

        const savedState = upgradePlace(typeof vscodeApi.getState === 'function' ? vscodeApi.getState() : null);

        if (!isReadablePlace(savedState)) {
            return null;
        }

        return savedState;

    } catch (getStateError) {
        return null;
    }

}

function buildObjectPlaceKey(treeObjectState: CardObjectState): string {
    return treeObjectState.object.objectApiName + '\n' + (treeObjectState.object.nickname || '');
}

function buildFieldPlaceKey(treeObjectState: CardObjectState, fieldState: IFieldRowFieldState): string {
    return buildObjectPlaceKey(treeObjectState) + '\n' + fieldState.field.fieldApiName;
}

function buildTreePlace(treeState: CardTreeState): ITreePlace | null {

    const expandedObjectKeys: string[] = [];
    const openPicklistKeys: string[] = [];
    const todosOnlyObjectKeys: string[] = [];
    const hideUnselectedObjectKeys: string[] = [];
    const searchQueries: Record<string, string> = {};
    let hasSearch = false;

    treeState.objectStates.forEach(function (treeObjectState) {
        if (treeObjectState.isExpandedByReader) { expandedObjectKeys.push(buildObjectPlaceKey(treeObjectState)); }
        if (isObjectTodosOnlyIn(treeObjectState)) { todosOnlyObjectKeys.push(buildObjectPlaceKey(treeObjectState)); }
        if (isObjectHidingUnselectedIn(treeObjectState)) { hideUnselectedObjectKeys.push(buildObjectPlaceKey(treeObjectState)); }
        // ONLY A BUILT ROW CAN HAVE BEEN OPENED, SO AN OBJECT NOBODY EXPANDED COSTS NOTHING HERE
        if (!treeObjectState.isBodyBuilt) { return; }
        treeObjectState.fieldStates.forEach(function (fieldState) {
            if (fieldState.isPicklistExpanded) { openPicklistKeys.push(buildFieldPlaceKey(treeObjectState, fieldState)); }
        });
    });

    RECIPE_COCKPIT_TREE_TABS.forEach(function (tabName) {
        if (RECIPE_COCKPIT_TABS_WITHOUT_SEARCH.indexOf(tabName) !== -1) { return; }
        const searchText = treeState.searchTexts[tabName] || '';
        if (RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS.indexOf(tabName) !== -1 && !searchText) { return; }
        searchQueries[tabName] = searchText;
        if (treeState.searchQueries[tabName]) { hasSearch = true; }
    });

    // THE TROUBLESHOOTING SUB-TAB AND ITS SEARCHES (#365): EACH ONLY WHEN IT IS NOT THE DEFAULT
    const troubleshootingSearchQueries: Record<string, string> = {};
    let hasTroubleshootingSearch = false;
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {
        const searchText = treeState.searchTexts[troubleshootingSearchKey(subTab)] || '';
        if (!searchText) { return; }
        troubleshootingSearchQueries[subTab] = searchText;
        hasTroubleshootingSearch = true;
    });
    const troubleshootingSubTab = treeState.troubleshootingSubTab && RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.indexOf(treeState.troubleshootingSubTab) > 0 ? treeState.troubleshootingSubTab : null;
    if (hasTroubleshootingSearch || troubleshootingSubTab) { hasSearch = true; }
    // THE TODO'S SUB-TAB'S REMOVED LIST AND ITS SEARCH (#391), EACH ONLY WHEN THERE IS ONE
    const isRemovedTodosView = treeState.todosView === 'removed';
    const removedTodosSearchText = treeState.searchTexts[troubleshootingSearchKey('todosRemoved')] || '';
    if (isRemovedTodosView || removedTodosSearchText) { hasSearch = true; }
    // THE HISTORY'S SORT (#485), ONLY WHEN IT IS NOT THE DEFAULT
    const historySort = treeState.historySort && !(treeState.historySort.column === 'time' && treeState.historySort.isDescending) ? treeState.historySort : null;
    if (historySort) { hasSearch = true; }

    const updaterExpandedObjectKeys = Object.keys(treeState.updaterExpandedObjectKeys);
    const isUpdaterStructureStep = treeState.updaterStep === 'structure' && !!treeState.updaterParentObjectApiName;
    if (updaterExpandedObjectKeys.length > 0) { hasSearch = true; }
    if (isUpdaterStructureStep || treeState.updaterParentObjectApiName || treeState.updaterParentWhereText) { hasSearch = true; }

    const selectedTab = treeState.selectedTab || 'treecipe';

    const expandedJourneyDatasetFolderNames = Object.keys(treeState.expandedJourneyDatasetFolderNames || {});
    if (expandedJourneyDatasetFolderNames.length > 0) { hasSearch = true; }

    if (selectedTab === 'treecipe' && !hasSearch && !treeState.isDatasetFavoritesOnly && !treeState.isRecordTypesExpanded
            && !isRecordTypeFieldsOnlyIn(treeState) && !isTodosOnlyIn(treeState) && expandedObjectKeys.length === 0 && openPicklistKeys.length === 0
            && todosOnlyObjectKeys.length === 0 && hideUnselectedObjectKeys.length === 0) {
        return null;
    }

    const treePlace: ITreePlace = {
        treeKey: treeState.tree.treeKey,
        isExpanded: treeState.tree.treeKey === navigationState.selectedTreeKey,
        selectedTab: selectedTab,
        searchQueries: searchQueries,
        expandedObjectKeys: expandedObjectKeys,
        openPicklistKeys: openPicklistKeys
    };

    if (treeState.isDatasetFavoritesOnly) { treePlace.isDatasetFavoritesOnly = true; }
    if (expandedJourneyDatasetFolderNames.length > 0) { treePlace.expandedJourneyDatasetFolderNames = expandedJourneyDatasetFolderNames; }
    if (treeState.isRecordTypesExpanded) { treePlace.isRecordTypesExpanded = true; }
    if (isRecordTypeFieldsOnlyIn(treeState)) { treePlace.isRecordTypeFieldsOnly = true; }
    if (isTodosOnlyIn(treeState)) { treePlace.isTodosOnly = true; }
    if (todosOnlyObjectKeys.length > 0) { treePlace.todosOnlyObjectKeys = todosOnlyObjectKeys; }
    if (hideUnselectedObjectKeys.length > 0) { treePlace.hideUnselectedObjectKeys = hideUnselectedObjectKeys; }
    if (troubleshootingSubTab) { treePlace.troubleshootingSubTab = troubleshootingSubTab; }
    if (hasTroubleshootingSearch) { treePlace.troubleshootingSearchQueries = troubleshootingSearchQueries; }
    if (isRemovedTodosView) { treePlace.todosView = 'removed'; }
    if (removedTodosSearchText) { treePlace.removedTodosSearchText = removedTodosSearchText; }
    if (historySort) { treePlace.troubleshootingHistorySort = { column: historySort.column, isDescending: historySort.isDescending }; }
    if (updaterExpandedObjectKeys.length > 0) { treePlace.updaterExpandedObjectKeys = updaterExpandedObjectKeys; }
    if (isUpdaterStructureStep) { treePlace.updaterStep = 'structure'; }
    if (treeState.updaterParentObjectApiName) { treePlace.updaterParentObjectApiName = treeState.updaterParentObjectApiName; }
    if (treeState.updaterParentWhereText) { treePlace.updaterParentWhereText = treeState.updaterParentWhereText; }

    return treePlace;

}

export function savePanelPlace(): void {

    // NOTHING IS SAVED UNTIL THE SAVED PLACE IS SPENT, NOR FOR A PANEL WITH NO MODEL DRAWN
    if (!isPlaceRestoreSettled || isRestoringPlace || renderedSequence === null || typeof vscodeApi.setState !== 'function') { return; }

    let panelPlace: IPanelPlace | null = null;

    try {
        panelPlace = buildPanelPlace();
        vscodeApi.setState(panelPlace);
    } catch (setStateError) {
        // A PLACE THAT COULD NOT BE KEPT COSTS THE READER A RE-OPEN, NEVER THE PANEL
    }

    // THE HOST KEEPS IT IN workspaceState TOO, SO IT OUTLIVES A CLOSE OR A WINDOW RELOAD (#230); IT THROTTLES THE WRITES
    if (panelPlace) { vscodeApi.postMessage({ command: 'savePlace', place: panelPlace }); }

}

// A SCROLL FIRES PER FRAME, AND A SAVE WALKS EVERY CARD, SO A RUN OF THEM IS SAVED ONCE
export function saveScrolledPlace(): void {

    if (scrollSaveTimer !== null) { return; }

    scrollSaveTimer = setTimeout(function () {
        scrollSaveTimer = null;
        savePanelPlace();
    }, RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY);

}

function buildPanelPlace(): IPanelPlace {

    const panelPlace: IPanelPlace = {
        version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
        runFolderName: renderedRunFolderName,
        isOrgPickerInUse: dataOrgPicker.isDataOrgPickerInUse,
        isFavoritesOnly: navigationState.isFavoritesOnly,
        scrollY: typeof window.scrollY === 'number' ? window.scrollY : 0,
        trees: treeStates.map(buildTreePlace).filter(Boolean)
    };
    if (isHelpOpen()) { panelPlace.isHelpExpanded = true; }
    // THE FIRST CARD IS WHERE A PLACE WITHOUT ONE OPENS, SO ONLY ANOTHER CARD IS WRITTEN
    const selectedTreeKey = navigationState.selectedTreeKey;
    if (typeof selectedTreeKey === 'string' && treeStates.length > 0 && treeStates[0].tree.treeKey !== selectedTreeKey) { panelPlace.selectedTreeKey = selectedTreeKey; }
    if (navigationState.treecipesSearchText) { panelPlace.treecipesSearchText = navigationState.treecipesSearchText; }

    return panelPlace;

}

/*
    A reload in the same document (#225) -- Generate, Create, Add friend -- redraws every card
    from scratch. When it is the run already on screen, the place on screen is taken BEFORE the
    redraw drops it and restored like a saved one; a run switch, or a reload that landed on
    another run, starts fresh. A model that failed to draw left nothing to take.
*/
export function takeSameRunPlace(recipe: ICardModel): IPanelPlace | null {

    if (!isPlaceRestoreSettled || renderedSequence === null || !recipe || recipe.objects.length === 0
            || renderedRunFolderName !== recipe.selectedRunFolderName) {
        return null;
    }

    // A PLACE THAT CANNOT BE TAKEN COSTS THE READER THEIR PLACE, NEVER THE DRAW
    try {
        return buildPanelPlace();
    } catch (placeError) {
        return null;
    }

}

/*
    A place saved before #255 names the Structure and Data-by-Org tabs: it is read as the tabs
    they became rather than dropped. A place of EITHER version can name a tab the card no longer
    has (RECIPE_COCKPIT_REMOVED_TREE_TABS: Previous Versions #265, Compare #266): it opens on
    Treecipe, and that tab's search, status filter and opened rows are dropped, never moved onto
    another tab's.
*/
function upgradePlace(candidatePlace: unknown): unknown {

    if (!candidatePlace || typeof candidatePlace !== 'object') { return candidatePlace; }

    const candidate = candidatePlace as { version?: unknown; trees?: unknown };
    if (candidate.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB && candidate.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION) { return candidatePlace; }

    const isOlderPlace = candidate.version === RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB;
    const renameTab = function (tabName: string): string { return isOlderPlace && Object.prototype.hasOwnProperty.call(RECIPE_COCKPIT_TREE_TAB_RENAMES, tabName) ? RECIPE_COCKPIT_TREE_TAB_RENAMES[tabName] : tabName; };
    const isRemovedTab = function (tabName: unknown): boolean { return RECIPE_COCKPIT_REMOVED_TREE_TABS.indexOf(tabName as string) !== -1; };

    return Object.assign({}, candidatePlace, {
        version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
        trees: (Array.isArray(candidate.trees) ? candidate.trees : []).map(function (savedTree: unknown) {
            if (!savedTree || typeof savedTree !== 'object') { return savedTree; }
            const savedTreePlace = savedTree as ISavedTreePlace;
            const savedQueries = savedTreePlace.searchQueries && typeof savedTreePlace.searchQueries === 'object' ? savedTreePlace.searchQueries as Record<string, unknown> : {};
            const searchQueries: Record<string, unknown> = Object.create(null);
            Object.keys(savedQueries).forEach(function (tabName) {
                const currentTabName = renameTab(tabName);
                if (!isRemovedTab(currentTabName)) { searchQueries[currentTabName] = savedQueries[tabName]; }
            });
            const selectedTab = typeof savedTreePlace.selectedTab === 'string' ? renameTab(savedTreePlace.selectedTab) : savedTreePlace.selectedTab;
            const upgradedTree: ISavedTreePlace = Object.assign({}, savedTree, {
                selectedTab: isRemovedTab(selectedTab) ? 'treecipe' : selectedTab,
                searchQueries: searchQueries
            });
            // A CARD SAVED ON THE RECORD TYPES TAB, BEFORE IT BECAME A SECTION (#321), OPENS WITH THE SECTION EXPANDED
            if (selectedTab === 'recordTypes') { upgradedTree.isRecordTypesExpanded = true; }
            return upgradedTree;
        })
    });

}

function isReadablePlace(candidatePlace: unknown): candidatePlace is IPanelPlace {

    return !!candidatePlace && typeof candidatePlace === 'object' && (candidatePlace as IPanelPlace).version === RECIPE_COCKPIT_PANEL_PLACE_VERSION && typeof (candidatePlace as IPanelPlace).runFolderName === 'string';

}

/*
    The document's own getState first: it is newer whenever it has one. A document with none
    -- a panel opened after a close or a window reload -- takes the place the host kept (#230).
*/
export function takeRestorablePlace(recipe: ICardModel, hostPlace: unknown): IPanelPlace | null {

    if (isPlaceRestoreSettled) { return null; }

    const upgradedHostPlace = upgradePlace(hostPlace);
    const savedPlace = restorablePlace || (isReadablePlace(upgradedHostPlace) ? upgradedHostPlace : null);
    restorablePlace = null;
    isPlaceRestoreSettled = true;

    return savedPlace && recipe && savedPlace.runFolderName === recipe.selectedRunFolderName && recipe.objects.length > 0 ? savedPlace : null;

}

// BEFORE THE DRAW: A PICKER THE READER HAD USED ASKS FOR ITS ORGS AGAIN ONCE THE MODEL IS DRAWN, AS IT DOES FOR ANY NEW MODEL
export function applyPlaceBeforeRender(savedPlace: IPanelPlace | null): void {

    if (savedPlace && savedPlace.isOrgPickerInUse === true) { dataOrgPicker.isDataOrgPickerInUse = true; }
    if (savedPlace) { navigationState.isFavoritesOnly = savedPlace.isFavoritesOnly === true; }
    if (savedPlace) { restoreHelpExpanded(savedPlace.isHelpExpanded === true); }
    // THE CARD AND THE SECTION SEARCH (#374) ARE THE PLACE'S: ANOTHER RUN, OR NO PLACE, OPENS ON THE FIRST CARD WITH NO SEARCH
    navigationState.selectedTreeKey = savedPlace && typeof savedPlace.selectedTreeKey === 'string' ? savedPlace.selectedTreeKey : null;
    navigationState.treecipesSearchText = savedPlace && typeof savedPlace.treecipesSearchText === 'string' ? savedPlace.treecipesSearchText : '';

}

/*
    The rest of the place, AFTER "rendered": opening a picklist row asks the host, which answers
    only once the ack has activated this model's allow-lists. An entry naming a card, object or
    tab this model does not have is passed over on its own -- the rest of the place still comes
    back.
*/
export function restorePlaceAfterRender(savedPlace: IPanelPlace | null): void {

    if (!savedPlace) { return; }

    isRestoringPlace = true;

    try {
        restoreSavedTrees(savedPlace);
    } finally {
        isRestoringPlace = false;
    }

}

function restoreSavedTrees(savedPlace: IPanelPlace): void {

    const savedTrees: unknown[] = Array.isArray(savedPlace.trees) ? savedPlace.trees : [];

    savedTrees.forEach(function (savedTreeCandidate) {

        if (!savedTreeCandidate || typeof savedTreeCandidate !== 'object') { return; }
        const savedTree = savedTreeCandidate as ISavedTreePlace;
        if (typeof savedTree.treeKey !== 'string') { return; }

        const treeState = findTreeState(savedTree.treeKey);
        if (!treeState) { return; }

        const expandedObjectKeys = toStringSet(savedTree.expandedObjectKeys);
        const openPicklistKeys = toStringSet(savedTree.openPicklistKeys);
        const todosOnlyObjectKeys = toStringSet(savedTree.todosOnlyObjectKeys);
        const hideUnselectedObjectKeys = toStringSet(savedTree.hideUnselectedObjectKeys);
        const savedSearchQueries = savedTree.searchQueries && typeof savedTree.searchQueries === 'object' ? savedTree.searchQueries as Record<string, unknown> : {};

        // BEFORE ANY TAB IS BUILT: A TAB READS ITS SEARCH, AND APPLIES IT, WHEN IT IS BUILT
        RECIPE_COCKPIT_TREE_TABS.forEach(function (tabName) {
            if (RECIPE_COCKPIT_TABS_WITHOUT_SEARCH.indexOf(tabName) !== -1) { return; }
            const savedQuery = Object.prototype.hasOwnProperty.call(savedSearchQueries, tabName) ? savedSearchQueries[tabName] : '';
            if (typeof savedQuery === 'string') {
                treeState.searchTexts[tabName] = savedQuery;
                treeState.searchQueries[tabName] = savedQuery.trim().toLowerCase();
            }
        });

        // THE TROUBLESHOOTING SUB-TAB AND ITS SEARCHES (#365), READ BEFORE THE TAB IS BUILT; AN UNKNOWN SUB-TAB READS AS THE FIRST
        const savedSubTabQueries = savedTree.troubleshootingSearchQueries && typeof savedTree.troubleshootingSearchQueries === 'object' ? savedTree.troubleshootingSearchQueries as Record<string, unknown> : {};
        RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {
            const savedQuery = Object.prototype.hasOwnProperty.call(savedSubTabQueries, subTab) ? savedSubTabQueries[subTab] : '';
            const searchKey = troubleshootingSearchKey(subTab);
            treeState.searchTexts[searchKey] = typeof savedQuery === 'string' ? savedQuery : '';
            treeState.searchQueries[searchKey] = treeState.searchTexts[searchKey].trim().toLowerCase();
        });
        const savedSubTab = savedTree.troubleshootingSubTab as RecipeCockpitTroubleshootingSubTab;
        treeState.troubleshootingSubTab = RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.indexOf(savedSubTab) !== -1 ? savedSubTab : RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS[0];
        treeState.todosView = savedTree.todosView === 'removed' ? 'removed' : 'open';
        const removedTodosSearchKey = troubleshootingSearchKey('todosRemoved');
        treeState.searchTexts[removedTodosSearchKey] = typeof savedTree.removedTodosSearchText === 'string' ? savedTree.removedTodosSearchText : '';
        treeState.searchQueries[removedTodosSearchKey] = treeState.searchTexts[removedTodosSearchKey].trim().toLowerCase();
        treeState.historySort = readHistorySort(savedTree.troubleshootingHistorySort);

        // BEFORE THE DATA SETS TAB IS BUILT, WHICH APPLIES IT; A TAB ALREADY BUILT APPLIES IT NOW
        treeState.isDatasetFavoritesOnly = savedTree.isDatasetFavoritesOnly === true;
        if (treeState.datasetRowStates) { applyDatasetsFilter(treeState); }

        // EACH DATA SET ROW WHOSE JOURNEY WAS OPEN (#471), OPENED WHEN ITS ROW IS BUILT
        treeState.expandedJourneyDatasetFolderNames = Object.create(null);
        (Array.isArray(savedTree.expandedJourneyDatasetFolderNames) ? savedTree.expandedJourneyDatasetFolderNames : []).forEach(function (datasetFolderName: unknown) {
            if (typeof datasetFolderName === 'string') { treeState.expandedJourneyDatasetFolderNames[datasetFolderName] = true; }
        });
        (treeState.datasetRowStates || []).forEach(function (rowState) {
            if (treeState.expandedJourneyDatasetFolderNames[rowState.dataset.datasetFolderName] === true && !rowState.isJourneyExpanded) {
                setDatasetJourneyExpanded(treeState, rowState, true, false);
            }
        });

        // APPLIED BY THE applyStructureFilter BELOW, OR BY THE TREECIPE TAB WHEN IT IS BUILT
        treeState.isRecordTypeFieldsOnly = savedTree.isRecordTypeFieldsOnly === true;
        treeState.isTodosOnly = savedTree.isTodosOnly === true;

        // READ BEFORE THE UPDATER TAB IS BUILT, WHICH DRAWS THEM. A PLACE SAVED BEFORE #721 MAY NAME CHOSEN FIELDS: THE CARD HAS NONE NOW, SO THEY ARE NOT READ
        treeState.updaterExpandedObjectKeys = Object.create(null);
        (Array.isArray(savedTree.updaterExpandedObjectKeys) ? savedTree.updaterExpandedObjectKeys : []).forEach(function (objectKey: unknown) {
            if (typeof objectKey === 'string') { treeState.updaterExpandedObjectKeys[objectKey] = true; }
        });
        // A PLACE SAVED BEFORE #443 HAS NONE OF THESE AND OPENS ON STEP 1; A PARENT THE CARD NO LONGER LISTS IS DROPPED WHEN THE TAB IS BUILT
        treeState.updaterParentObjectApiName = typeof savedTree.updaterParentObjectApiName === 'string' ? savedTree.updaterParentObjectApiName : '';
        treeState.updaterStep = savedTree.updaterStep === 'structure' && treeState.updaterParentObjectApiName ? 'structure' : 'parent';
        treeState.updaterParentWhereText = typeof savedTree.updaterParentWhereText === 'string' ? savedTree.updaterParentWhereText.slice(0, RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH) : '';

        const hasOpenPicklists = hasAnyString(openPicklistKeys);

        treeState.objectStates.forEach(function (treeObjectState) {
            if (hasString(expandedObjectKeys, buildObjectPlaceKey(treeObjectState))) { treeObjectState.isExpandedByReader = true; }
            // A KEY NAMING AN OBJECT WITH NO TODO NOW IS DROPPED: THE FILTER WOULD HIDE NOTHING AND ITS BOX IS DISABLED
            treeObjectState.isTodosOnly = hasString(todosOnlyObjectKeys, buildObjectPlaceKey(treeObjectState)) && treeObjectState.todoCount > 0;
            drawObjectTodosToggle(treeObjectState);
            // A KEY NAMING AN OBJECT WITH NOTHING UNTICKED NOW, OR EXCLUDED, IS DROPPED THE SAME WAY (#483)
            treeObjectState.isHidingUnselected = hasString(hideUnselectedObjectKeys, buildObjectPlaceKey(treeObjectState)) && !findHideUnselectedReason(treeObjectState);
            drawHideUnselectedToggle(treeObjectState);
            // A PICKLIST KEY IS BUILT PER FIELD, SO A PLACE THAT OPENED NONE BUILDS NONE
            if (!hasOpenPicklists) { return; }
            treeObjectState.fieldStates.forEach(function (fieldState) {
                if (fieldState.field.isPicklist && hasString(openPicklistKeys, buildFieldPlaceKey(treeObjectState, fieldState))) { fieldState.isPicklistExpanded = true; }
            });
        });

        if (typeof savedTree.selectedTab === 'string' && RECIPE_COCKPIT_TREE_TABS.indexOf(savedTree.selectedTab as RecipeCockpitTreeTab) !== -1) {
            selectTreeTab(treeState, savedTree.selectedTab);
        }

        if (savedTree.isRecordTypesExpanded === true) {
            ensureTreeBodyBuilt(treeState);
            setRecordTypesExpanded(treeState, true, false);
        }

        // A CARD NO LONGER FOLDS (#374): THE ONE ON SCREEN IS THE DROPDOWN'S, SO A SAVED isExpanded IS IGNORED
        // THE CARD ON SCREEN WAS BUILT WITH AN EMPTY BOX, SO IT SHOWS THE RESTORED SEARCH NOW
        if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = treeState.searchTexts.treecipe; }

        // A STRUCTURE TAB BUILT BEFORE ITS OBJECTS WERE MARKED OPEN APPLIES THEM NOW; ONE NOT YET BUILT APPLIES THEM WHEN IT IS
        applyStructureFilter(treeState);

    });

}

export function restoreScroll(savedPlace: IPanelPlace | null): void {

    if (!savedPlace || typeof savedPlace.scrollY !== 'number' || !isFinite(savedPlace.scrollY) || savedPlace.scrollY <= 0) { return; }
    if (typeof window.scrollTo === 'function') { window.scrollTo(0, savedPlace.scrollY); }

}
