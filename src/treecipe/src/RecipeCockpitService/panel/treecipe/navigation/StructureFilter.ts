import { setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT, RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET } from '../../../RecipeCockpitNavigationConstants';
import { RECIPE_COCKPIT_TODOS_VIEWS } from '../../../RecipeCockpitTroubleshootingConstants';
import { selectTroubleshootingSubTab } from '../../troubleshooting/TroubleshootingTab';
import { selectTodosView } from '../../troubleshooting/TroubleshootingTodos';
import { applyTreeFieldVisibility, isFieldTextMatch } from '../fieldRows/FieldRow';
import { isObjectHidingUnselectedIn } from '../fieldRows/FieldScope';
import { findObjectFieldSelection, isTreeFieldUnticked, occurrenceNicknameOf } from '../fieldRows/SelectionCascade';
import { drawRecordTypeFieldsToggle, isRecordTypeFieldsOnlyIn } from '../recordTypes/RecordTypeFieldsToggle';
import { applyRecordTypesFilter, setRecordTypesExpanded } from '../recordTypes/RecordTypesSection';
import { drawTodosToggle, isObjectTodosOnlyIn, isTodosOnlyIn } from '../recordTypes/TodosToggles';
import { applyTreecipesSearch } from './TreecipesSearch';
import { chooseTree, isHiddenByFavorites } from './TreePicker';
import { asNavigationObjectState, asNavigationTreeState } from './NavigationTypes';
import type { IFocusTree, INavigationObjectState, INavigationTreeState, ITreeObjectStateView, ITreeStateView, ScriptTreeState } from './NavigationTypes';
import { treeStates } from '../../shell/PanelRender';
import { pluralize } from '../../RecipeCockpitPanelShared';
import { savePanelPlace } from '../../shell/PanelPlace';
import { ensureTreeBodyBuilt, selectTreeTab } from '../card/TreeCardTabs';
import { setTreeObjectExpanded } from '../card/TreeObjectRow';
import { navigationState } from './NavigationState';

/*
    The Treecipe tab's own filter (its search, "Record type fields only", "TODOs only" and "Hide
    unselected"), how far a search may open rows, and the focus a reload or a link asks for (#256,
    #320, #354, #374, #477, #483). isFavoritesOnly is navigationState's, kept with the reader's
    place; the card, its tabs and rows are treecipe/card/'s.
*/

// THE TREECIPE TAB'S OWN SEARCH AND ITS TWO CHECKS, CLEARED SO A ROW THE READER ASKED TO SEE IS NOT HIDDEN BY THEM
export function clearStructureFilters(treeState: INavigationTreeState): void {

    treeState.searchTexts.treecipe = '';
    treeState.searchQueries.treecipe = '';
    treeState.isRecordTypeFieldsOnly = false;
    treeState.isTodosOnly = false;
    if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = ''; }
    applyStructureFilter(treeState);

}

// A RELOAD THE HOST MADE AFTER A DATA SET WENT MISSING, OR A CREATE, RE-OPENS THE CARD AND TAB THE READER ACTED FROM
export function applyTreeFocus(focusTree: IFocusTree | null | undefined): boolean | undefined {

    if (!focusTree) { return; }

    const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === focusTree.treeKey; });

    if (!treeState) { return; }

    // WHAT THE READER JUST ACTED ON IS CHOSEN IN THE DROPDOWN (#374), AND SHOWN EVEN WHEN IT IS NOT A FAVORITE;
    // TURNING THE FILTER OFF RUNS THE SECTION SEARCH AGAIN, SINCE IT SEARCHED THE FAVORITES ONLY
    if (isHiddenByFavorites(treeState)) {
        navigationState.isFavoritesOnly = false;
        applyTreecipesSearch();
    }
    chooseTree(treeState, false);

    selectTreeTab(treeState, focusTree.tab);

    // A FAILED INSERT'S "Open Troubleshooting" (#375) OPENS THE SUB-TAB ITS ERROR POINTS AT
    if (focusTree.tab === 'troubleshooting' && typeof focusTree.troubleshootingSubTab === 'string') {
        selectTroubleshootingSubTab(treeState, focusTree.troubleshootingSubTab, false);
        // A REMOVE OR A RESTORE (#391) RELOADS ONTO THE LIST IT WAS CLICKED IN
        if (focusTree.troubleshootingSubTab === 'todos' && focusTree.todosView !== undefined && RECIPE_COCKPIT_TODOS_VIEWS.indexOf(focusTree.todosView) !== -1) {
            treeState.todosView = focusTree.todosView;
            selectTodosView(treeState, focusTree.todosView, false);
        }
    }

    // A REGENERATE, AND "Change record types" (#196), RE-OPEN THE RECORD TYPES SECTION, SCROLLED TO THE OBJECT IT IS ABOUT
    if (!focusTree.recordTypes || typeof focusTree.recordTypes !== 'object') { return false; }

    setRecordTypesExpanded(treeState, true, false);
    savePanelPlace();

    const objectApiName = focusTree.recordTypes.objectApiName;
    const objectState = (treeState.recordTypeObjectStates || []).find(function (candidateState) { return candidateState.object.objectApiName === objectApiName; });
    if (!objectState || typeof objectState.element.scrollIntoView !== 'function') { return false; }

    // A SEARCH RESTORED FROM THE PLACE WOULD HIDE THE ROW THE READER ASKED TO SEE, SO IT IS CLEARED
    if (objectState.element.classList.contains('hidden') && treeState.searchQueries.treecipe) {
        treeState.searchTexts.treecipe = '';
        treeState.searchQueries.treecipe = '';
        if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = ''; }
        applyStructureFilter(treeState);
        savePanelPlace();
    }

    objectState.element.scrollIntoView({ block: 'nearest' });
    return true;

}

// THE SAME FOCUS ON THE MODEL ALREADY DRAWN, SCROLLED TO THE CARD, SO NOTHING RELOADS
export function focusTreeInPlace(focusTree: unknown): void {

    if (!focusTree || typeof focusTree !== 'object' || typeof (focusTree as IFocusTree).treeKey !== 'string') { return; }

    const treeKey = (focusTree as IFocusTree).treeKey;
    const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === treeKey; });
    if (!treeState) { return; }

    applyTreeFocus(focusTree as IFocusTree);
    savePanelPlace();
    if (typeof treeState.element.scrollIntoView === 'function') { treeState.element.scrollIntoView({ block: 'start' }); }

}

export function setTreeExpanded(treeState: INavigationTreeState, isExpanded: boolean, isAnimated?: boolean): void {

    if (isExpanded) { ensureTreeBodyBuilt(treeState); }
    setShownWithMotion(treeState.bodyElement, isExpanded, isAnimated === true);

    treeState.isExpanded = isExpanded;

}

/*
    What a search may open, under the RECIPE_COCKPIT_AUTO_EXPAND_* limits. Each search box
    spends its own budget, so a keystroke's cost is bounded by what it expands rather than by
    what it matches. A row with no match is closed.
*/
export function expandMatchesWithinBudget<RowState>(rowStates: RowState[], matchCountOf: (rowState: RowState) => number, rowCountOf: (rowState: RowState) => number,
                                                    setExpanded: (rowState: RowState, isExpanded: boolean) => void): void {

    let expandedObjectCount = 0;
    let expandedRowCount = 0;
    let isBudgetSpent = false;

    rowStates.forEach(function (rowState) {

        if (matchCountOf(rowState) === 0 || isBudgetSpent) {
            setExpanded(rowState, false);
            return;
        }

        const rowCount = rowCountOf(rowState);
        const fitsRowBudget = expandedObjectCount === 0 || expandedRowCount + rowCount <= RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET;

        if (expandedObjectCount >= RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT || !fitsRowBudget) {
            isBudgetSpent = true;
            setExpanded(rowState, false);
            return;
        }

        expandedObjectCount++;
        expandedRowCount += rowCount;
        setExpanded(rowState, true);

    });

}

/*
    The Structure tab's search, over its own card only. It narrows rows and never hides an
    OBJECT: one with no match stays on screen, collapsed and labelled, because hiding it would
    make a search look like a truncation -- the reader could not tell "not in the recipe" from
    "filtered away". A cleared search gives back what the reader had opened.
*/
export function applyStructureFilter(treeStateView: ITreeStateView): void {

    const treeState = asNavigationTreeState(treeStateView);
    if (!treeState.structureSearch) { return; }

    drawRecordTypeFieldsToggle(treeState);
    drawTodosToggle(treeState);

    treeState.objectStates.forEach(function (treeObjectState) { filterTreeObjectRows(treeState, treeObjectState); });
    drawStructureMatchCount(treeState);

    applyRecordTypesFilter(treeState);

    if (!isStructureFilteredIn(treeState)) {
        treeState.objectStates.forEach(function (treeObjectState) { setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader); });
        return;
    }

    expandMatchesWithinBudget(treeState.objectStates,
        function (treeObjectState) { return treeObjectState.matchingFieldCount + (treeObjectState.hasMatchingObjectTodos ? 1 : 0); },
        function (treeObjectState) { return treeObjectState.fieldStates.length; },
        setTreeObjectExpanded);

}

function isStructureFilteredIn(treeState: INavigationTreeState): boolean {
    return !!treeState.searchQueries.treecipe || isRecordTypeFieldsOnlyIn(treeState) || isTodosOnlyIn(treeState);
}

/*
    One object's rows and count under the card's filters and its own "TODOs only" (#477). The
    object's own filter calls this alone, never applyStructureFilter, so a click on one object
    neither folds nor opens any other.
*/
export function filterTreeObjectRows(treeStateView: ITreeStateView, treeObjectStateView: ITreeObjectStateView): void {

    const treeState = asNavigationTreeState(treeStateView);
    const treeObjectState = asNavigationObjectState(treeObjectStateView);
    const searchQuery = treeState.searchQueries.treecipe;
    // "Record type fields only" (#320) NARROWS WHAT THE SEARCH MATCHES: A FIELD SHOWS ONLY IF IT PASSES BOTH
    const isRecordTypeFieldsOnly = isRecordTypeFieldsOnlyIn(treeState);
    // "TODOs only" (#354), THE CARD'S OR THE OBJECT'S OWN, NARROWS THE SAME WAY, AND AN OBJECT'S OWN TODOS COUNT AS A MATCH SO IT STILL OPENS
    const isObjectTodosOnly = isTodosOnlyIn(treeState) || isObjectTodosOnlyIn(treeObjectState);
    // "Hide unselected" (#483) IS THE OBJECT'S OWN AND NARROWS THE SAME WAY
    const isHidingUnselected = isObjectHidingUnselectedIn(treeObjectState);
    const isObjectFiltered = !!searchQuery || isRecordTypeFieldsOnly || isObjectTodosOnly || isHidingUnselected;
    const isObjectNameMatch = !searchQuery || treeObjectState.objectSearchText.indexOf(searchQuery) !== -1 || treeObjectState.friendSearchText.indexOf(searchQuery) !== -1;
    let objectMatchingFieldCount = 0;
    let selectedFieldCount = 0;
    const objectFieldSelection = isHidingUnselected ? findObjectFieldSelection(treeObjectState.tree, treeObjectState.object.objectApiName, occurrenceNicknameOf(treeObjectState.object)) : null;

    treeObjectState.fieldStates.forEach(function (fieldState) {
        const isSelected = !isHidingUnselected || !fieldState.field.lineNumber || !isTreeFieldUnticked(objectFieldSelection, fieldState.field.fieldApiName);
        if (isSelected) { selectedFieldCount++; }
        fieldState.isMatch = isSelected
            && (!isRecordTypeFieldsOnly || fieldState.recordTypeDeveloperNames !== null)
            && (!isObjectTodosOnly || fieldState.todos.length > 0)
            && (isObjectNameMatch || isFieldTextMatch(fieldState, searchQuery));
        if (fieldState.isMatch) { objectMatchingFieldCount++; }
        applyTreeFieldVisibility(fieldState);
    });

    const objectFieldCount = treeObjectState.fieldStates.length;
    const hasMatchingObjectTodos = isObjectTodosOnly && !isRecordTypeFieldsOnly && isObjectNameMatch && treeObjectState.objectTodos.length > 0;
    treeObjectState.matchingFieldCount = objectMatchingFieldCount;
    treeObjectState.hasMatchingObjectTodos = hasMatchingObjectTodos;
    treeObjectState.isFilteredByStructure = isObjectFiltered;

    if (!isObjectFiltered || (isObjectNameMatch && !isRecordTypeFieldsOnly && !isObjectTodosOnly && !isHidingUnselected)) {
        treeObjectState.countElement.textContent = pluralize(objectFieldCount, 'field', 'fields');
    } else if (isObjectTodosOnly && treeObjectState.todoCount === 0) {
        treeObjectState.countElement.textContent = 'no TODOs';
    } else if (isObjectTodosOnly && !searchQuery && !isRecordTypeFieldsOnly) {
        treeObjectState.countElement.textContent = pluralize(treeObjectState.todoCount, 'TODO', 'TODOs');
    } else if (objectMatchingFieldCount > 0) {
        treeObjectState.countElement.textContent = objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields');
    } else if (isRecordTypeFieldsOnly && treeObjectState.recordTypeFieldCount === 0) {
        treeObjectState.countElement.textContent = 'no record type fields';
    } else if (hasMatchingObjectTodos) {
        treeObjectState.countElement.textContent = pluralize(treeObjectState.objectTodos.length, 'TODO', 'TODOs') + ' on the object';
    } else if (isHidingUnselected && selectedFieldCount === 0) {
        treeObjectState.countElement.textContent = 'no selected fields';
    } else {
        treeObjectState.countElement.textContent = 'no matching fields';
    }

}

// THE TAB'S COUNT: "N of M fields" WHENEVER ANY FILTER, A CARD'S OR ONE OBJECT'S OWN, HIDES A ROW
export function drawStructureMatchCount(treeStateView: ITreeStateView): void {

    const treeState = asNavigationTreeState(treeStateView);
    let totalFieldCount = 0;
    let matchingFieldCount = 0;
    let isAnyObjectFiltered = false;

    treeState.objectStates.forEach(function (treeObjectState) {
        totalFieldCount += treeObjectState.fieldStates.length;
        matchingFieldCount += treeObjectState.matchingFieldCount;
        if (treeObjectState.isFilteredByStructure) { isAnyObjectFiltered = true; }
    });

    ( treeState.structureSearch as NonNullable<INavigationTreeState['structureSearch']> ).matchCountElement.textContent = !isAnyObjectFiltered
        ? pluralize(totalFieldCount, 'field', 'fields')
        : matchingFieldCount > 0 ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') : 'no matches';

}

export function buildTreeObjectKey(treeKey: string, objectApiName: string): string {
    return treeKey + '\n' + objectApiName;
}
