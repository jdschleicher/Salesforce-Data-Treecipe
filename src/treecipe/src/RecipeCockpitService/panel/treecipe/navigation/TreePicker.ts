import { createButton, createElement, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_FAVORITE_TREE_LABEL, RECIPE_COCKPIT_FAVORITES_ONLY_LABEL, RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL } from '../../../RecipeCockpitDatasetsTabConstants';
import {
    RECIPE_COCKPIT_TREECIPE_PICKER_LABEL,
    RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX,
    RECIPE_COCKPIT_TREE_PICKER_AUTO_EXCLUDED_SUFFIX,
    RECIPE_COCKPIT_TREE_PICKER_EXCLUDED_SUFFIX,
    RECIPE_COCKPIT_TREE_PICKER_IMPACTED_SUFFIX,
    RECIPE_COCKPIT_TREE_PICKER_NO_FIELDS_SELECTED_SUFFIX,
    RECIPE_COCKPIT_TREE_PICKER_NO_OBJECTS,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_LABEL,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SEPARATOR,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL,
    RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS
} from '../../../RecipeCockpitNavigationConstants';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { requestDataOrgs } from '../dataOrg/DataOrgListing';
import { indexObjectExclusions, indexObjectImpacts } from '../fieldRows/SelectionCascade';
import type { ISelectionTree } from '../fieldRows/FieldRowTypes';
import { listFriendLabelsByObjectApiName } from './Friends';
import { setTreeExpanded } from './StructureFilter';
import { applyTreecipesSearch } from './TreecipesSearch';
import type { ScriptTreeState } from './NavigationTypes';

/*
    The Treecipes section's dropdown, Favorites only, and the shown card's insert order line
    (#235, #374, #385, #464). The choice, the favourites filter and the elements a new model
    replaces are the panel script's lets, declare let here: it keeps them with the reader's place
    and resets them for every model. The insert order line's measuring state is this module's own.
*/
declare let isFavoritesOnly: boolean;
declare let favoritesToggleElement: HTMLButtonElement | null;
declare let favoritesCountElement: HTMLElement | null;
declare const noFavoritesElement: HTMLElement | null;
declare let selectedTreeKey: string | null;
declare let treePickerElement: HTMLSelectElement | null;
declare const treePickerObjectsElement: HTMLElement | null;
declare let treePickerTreeStates: ScriptTreeState[];
declare let treePickerShownTreeState: ScriptTreeState | null;
declare let isTreePickerObjectsExpanded: boolean;
declare let treecipesMatchedTreeKeys: Record<string, true> | null;
declare const treeStates: ScriptTreeState[];
declare const renderedSequence: number | null;
declare const isRestoringPlace: boolean;
declare function findTreeState(treeKey: unknown): ScriptTreeState | null;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;
declare function toStringSet(values: unknown[]): Record<string, true>;
declare function hasString(stringSet: Record<string, true>, value: unknown): boolean;

let treePickerObjectsListElement: HTMLElement | null = null;
let treePickerObjectsToggleElement: HTMLButtonElement | null = null;
let treePickerObjectsResizeObserver: ResizeObserver | null = null;
let isTreePickerObjectsMeasureScheduled = false;

export function describeTreeDifferences(tree: ISelectionTree): string[] {

    const countOf = function (candidateList: unknown): number { return Array.isArray(candidateList) ? candidateList.length : 0; };
    const describe = function (count: number, singular: string, plural: string): string { return count + ' ' + (count === 1 ? singular : plural); };

    const exclusions = tree.objectSelection && Array.isArray(tree.objectSelection.exclusions) ? tree.objectSelection.exclusions : [];
    // AN EXCLUDED OBJECT KEEPS ITS UNTICKED FIELDS AND STORED COUNT FOR WHEN IT COMES BACK, BUT GENERATION APPLIES NEITHER
    const excludedObjectApiNames = toStringSet(exclusions.map(function (exclusion) { return exclusion.objectApiName; }));
    const isGenerated = function (entry: unknown): boolean { return !!entry && !hasString(excludedObjectApiNames, (entry as { objectApiName?: unknown }).objectApiName); };
    const generatedEntries = function (candidateList: unknown): unknown[] { return Array.isArray(candidateList) ? candidateList.filter(isGenerated) : []; };

    const untickedFieldCount = generatedEntries(tree.fieldSelection && tree.fieldSelection.objects)
        .reduce(function (total: number, objectFieldSelection) { return total + countOf((objectFieldSelection as { excludedFieldApiNames?: unknown }).excludedFieldApiNames); }, 0);

    const rulesOffCount = generatedEntries(tree.validationRulesOff).length;

    const differences: Array<[number, string, string]> = [
        [exclusions.length, 'object excluded', 'objects excluded'],
        [untickedFieldCount, 'field unticked', 'fields unticked'],
        [generatedEntries(tree.objectCounts).length, 'count changed', 'counts changed'],
        [rulesOffCount, 'field without its rules', 'fields without their rules']
    ];
    return differences.filter(function (difference) { return difference[0] > 0; })
        .map(function (difference) { return describe(difference[0], difference[1], difference[2]); });

}

// A PANEL-ONLY FILTER (#235): IT HIDES CARDS, ASKS THE HOST NOTHING, AND IS KEPT WITH THE READER'S PLACE
function renderFavoritesToggle(containerElement: HTMLElement): void {

    const favoritesElement = createElement('span', 'favoritesControls');

    const toggleElement = createButton('primary', 'favoritesToggle');
    favoritesToggleElement = toggleElement;
    toggleElement.setAttribute('title', 'Show only the trees marked as favorites');
    toggleElement.addEventListener('click', function () {
        isFavoritesOnly = !isFavoritesOnly;
        applyTreecipesSearch();
        savePanelPlace();
    });

    const countElement = createElement('span', 'favoritesCount muted hidden');
    favoritesCountElement = countElement;

    favoritesElement.appendChild(toggleElement);
    favoritesElement.appendChild(countElement);
    containerElement.appendChild(favoritesElement);

}

// EVERY TAB NAMES A CARD THIS WAY, WHICHEVER VIEW OF THE TREE IT HOLDS
export function displayTitleOf(tree: unknown): string {
    const namedTree = tree as { customName?: string; title: string };
    return namedTree.customName || namedTree.title;
}

// ONLY WHILE ITS TOGGLE IS DRAWN: A MODEL WITH NO CARD TO MARK WOULD OTHERWISE HIDE EVERY CARD WITH NO WAY TO TURN IT OFF
export function isHiddenByFavorites(treeState: ScriptTreeState): boolean {
    return isFavoritesOnly && favoritesToggleElement !== null && treeState.tree.isFavorite !== true;
}

/*
    Favorites only narrows the DROPDOWN (#374): the card on screen moves to the first favorite
    when it is not one, and the choice moves with it; with no favorite nothing is drawn but the
    notice, and turning the filter off draws the card chosen before.
*/
export function applyFavoritesFilter(isAnimated?: boolean): void {

    const shownCount = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); }).length;

    applyTreePicker(isAnimated);

    if (favoritesToggleElement) {
        favoritesToggleElement.textContent = (isFavoritesOnly ? RECIPE_COCKPIT_FAVORITE_TREE_LABEL : RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL) + ' ' + RECIPE_COCKPIT_FAVORITES_ONLY_LABEL;
        favoritesToggleElement.setAttribute('aria-pressed', isFavoritesOnly ? 'true' : 'false');
    }

    if (favoritesCountElement) {
        favoritesCountElement.textContent = shownCount + ' of ' + pluralize(treeStates.length, 'tree', 'trees');
        if (isFavoritesOnly) { favoritesCountElement.classList.remove('hidden'); } else { favoritesCountElement.classList.add('hidden'); }
    }

    if (noFavoritesElement) {
        if (isFavoritesOnly && favoritesToggleElement !== null && shownCount === 0) { noFavoritesElement.classList.remove('hidden'); } else { noFavoritesElement.classList.add('hidden'); }
    }

}

function treePickerLabelOf(treeState: ScriptTreeState): string {
    return (treeState.tree.isFavorite === true ? RECIPE_COCKPIT_FAVORITE_TREE_LABEL + ' ' : '') + displayTitleOf(treeState.tree);
}

/*
    What the dropdown lists and which card is drawn (#374): the cards Favorites only leaves, in
    RecipeFiles order, narrowed to the ones the section search matched. The card on screen stays
    on screen while a search does not match it -- listed first, marked -- and a search matching
    nothing disables the dropdown rather than taking the card away.
*/
function applyTreePicker(isAnimated?: boolean): void {

    const pickerElement = treePickerElement;
    if (!pickerElement) { return; }

    const pickableTreeStates = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); });
    const chosenTreeState = findTreeState(selectedTreeKey);
    const shownTreeState = chosenTreeState && !isHiddenByFavorites(chosenTreeState) ? chosenTreeState : (pickableTreeStates[0] || null);

    if (shownTreeState) { selectedTreeKey = shownTreeState.tree.treeKey; }

    const matchedTreeKeys = treecipesMatchedTreeKeys;
    const listedTreeStates = matchedTreeKeys === null
        ? pickableTreeStates
        : pickableTreeStates.filter(function (treeState) { return hasString(matchedTreeKeys, treeState.tree.treeKey); });
    const isShownUnlisted = !!shownTreeState && listedTreeStates.indexOf(shownTreeState) === -1;

    const pickedTreeStates = isShownUnlisted && shownTreeState ? [shownTreeState].concat(listedTreeStates) : listedTreeStates;
    treePickerTreeStates = pickedTreeStates;
    pickerElement.textContent = '';
    pickedTreeStates.forEach(function (treeState, optionIndex) {
        const label = treePickerLabelOf(treeState) + (isShownUnlisted && optionIndex === 0 ? RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX : '');
        const optionElement = createElement('option', '', label);
        optionElement.value = String(optionIndex);
        optionElement.selected = treeState === shownTreeState;
        pickerElement.appendChild(optionElement);
    });
    pickerElement.value = shownTreeState ? String(pickedTreeStates.indexOf(shownTreeState)) : '';
    pickerElement.disabled = listedTreeStates.length === 0;

    // ONLY THE INCOMING CARD FADES, AND ONLY ON THE READER'S PICK; THE OUTGOING ONE IS GONE AT ONCE. A CARD ALREADY
    // IN ITS STATE IS LEFT ALONE, SO A KEYSTROKE NEVER CUTS A FADE SHORT
    treeStates.forEach(function (treeState) {
        const isHidden = treeState.element.classList.contains('hidden');
        if (treeState === shownTreeState) {
            if (isHidden) { setShownWithMotion(treeState.element, true, isAnimated === true); }
        } else if (!isHidden) {
            setShownWithMotion(treeState.element, false, false);
        }
    });

    if (shownTreeState && !shownTreeState.isExpanded) { setTreeExpanded(shownTreeState, true); }

    // A KEYSTROKE IN THE SECTION SEARCH COMES THROUGH HERE TOO, SO THE LINE IS REDRAWN ONLY FOR ANOTHER CARD
    if (shownTreeState !== treePickerShownTreeState) {
        treePickerShownTreeState = shownTreeState;
        isTreePickerObjectsExpanded = false;
        drawTreePickerObjects();
    }

}

/*
    The shown card's objects in insert order (#385), the card's own order, each object once:
    an iteration or a later record type block is the same object. An excluded object stays
    listed and says so in text, not only in its style. Nothing is drawn while no card is.
*/
export function drawTreePickerObjects(): void {

    const objectsElement = treePickerObjectsElement;
    if (!objectsElement) { return; }

    releaseTreePickerObjectsList();
    objectsElement.textContent = '';
    const shownTreeState = treePickerShownTreeState;
    if (!shownTreeState) {
        objectsElement.classList.add('hidden');
        return;
    }
    objectsElement.classList.remove('hidden');

    const listedObjectApiNames: Record<string, true> = Object.create(null);
    const objectApiNames: string[] = [];
    shownTreeState.tree.objects.forEach(function (treeObject) {
        if (treeObject.iterationNickname || listedObjectApiNames[treeObject.objectApiName] === true) { return; }
        listedObjectApiNames[treeObject.objectApiName] = true;
        objectApiNames.push(treeObject.objectApiName);
    });

    objectsElement.appendChild(createElement('span', 'treePickerObjectsLabel', RECIPE_COCKPIT_TREE_PICKER_OBJECTS_LABEL));
    const listElement = createElement('span', isTreePickerObjectsExpanded ? 'treePickerObjectsList expanded' : 'treePickerObjectsList');
    listElement.setAttribute('id', 'treePickerObjectsList');
    objectsElement.appendChild(listElement);
    treePickerObjectsListElement = listElement;

    if (objectApiNames.length === 0) {
        listElement.appendChild(createElement('span', 'treePickerNoObjects muted', RECIPE_COCKPIT_TREE_PICKER_NO_OBJECTS));
        return;
    }

    const exclusionsByObjectApiName = indexObjectExclusions(shownTreeState.tree);
    const impactsByObjectApiName = indexObjectImpacts(shownTreeState.tree);
    const friendLabelsByObjectApiName = listFriendLabelsByObjectApiName(shownTreeState);
    objectApiNames.forEach(function (objectApiName, objectIndex) {
        if (objectIndex > 0) { listElement.appendChild(createElement('span', 'treePickerObjectSeparator muted', RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SEPARATOR)); }
        const exclusion = Object.prototype.hasOwnProperty.call(exclusionsByObjectApiName, objectApiName) ? exclusionsByObjectApiName[objectApiName] : null;
        const suffix = !exclusion ? ( hasOwnKey(impactsByObjectApiName, objectApiName) ? RECIPE_COCKPIT_TREE_PICKER_IMPACTED_SUFFIX : '' )
            : exclusion.kind === 'autoExcluded' ? RECIPE_COCKPIT_TREE_PICKER_AUTO_EXCLUDED_SUFFIX
            : exclusion.kind === 'noFieldsSelected' ? RECIPE_COCKPIT_TREE_PICKER_NO_FIELDS_SELECTED_SUFFIX : RECIPE_COCKPIT_TREE_PICKER_EXCLUDED_SUFFIX;
        const friendLabels = hasOwnKey(friendLabelsByObjectApiName, objectApiName) ? friendLabelsByObjectApiName[objectApiName] : [];
        const friendText = friendLabels.length > 0 ? ' (' + friendLabels.join(', ') + ')' : '';
        listElement.appendChild(createElement('span', exclusion ? 'treePickerObject excluded' : 'treePickerObject', objectApiName + friendText + suffix));
    });

    objectsElement.appendChild(createElement('span', 'treePickerObjectsCount muted', ' · ' + pluralize(objectApiNames.length, 'object', 'objects')));

    const toggleElement = createButton('secondary', 'treePickerObjectsToggle hidden', RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL, 'compact');
    toggleElement.setAttribute('aria-controls', 'treePickerObjectsList');
    toggleElement.addEventListener('click', function () {
        isTreePickerObjectsExpanded = !isTreePickerObjectsExpanded;
        if (isTreePickerObjectsExpanded) { listElement.classList.add('expanded'); } else { listElement.classList.remove('expanded'); }
        drawTreePickerObjectsToggle();
    });
    objectsElement.appendChild(toggleElement);
    treePickerObjectsToggleElement = toggleElement;

    // THE LIST IS ONLY MEASURABLE ONCE IT IS LAID OUT, WHICH A DRAW DURING A RENDER CAN COME BEFORE; THE
    // OBSERVER'S FIRST DELIVERY IS THAT MEASURE. WITHOUT ONE, THE LIST IS MEASURED NOW AND ON EVERY RESIZE
    if (typeof window.ResizeObserver === 'function') {
        treePickerObjectsResizeObserver = treePickerObjectsResizeObserver || new window.ResizeObserver(scheduleTreePickerObjectsToggle);
        treePickerObjectsResizeObserver.observe(listElement);
    } else {
        drawTreePickerObjectsToggle();
    }

}

/*
    Whether the one-line list is cut is a fact about the rendered width, not about a character
    count (#464), so it is measured: on every draw and whenever the panel's width changes. An
    opened list keeps its toggle so it can be closed again.
*/
export function releaseTreePickerObjectsList(): void {

    if (treePickerObjectsResizeObserver) { treePickerObjectsResizeObserver.disconnect(); }
    treePickerObjectsListElement = null;
    treePickerObjectsToggleElement = null;

}

/*
    Showing or hiding the toggle changes the observed list's own width, and a size changed inside an
    observer callback is reported by the browser as a "ResizeObserver loop" error on window, which the
    panel's error listener reports to the host. So the observer only schedules the measure for the
    next frame, once per frame however many deliveries arrive.
*/
function scheduleTreePickerObjectsToggle(): void {

    if (isTreePickerObjectsMeasureScheduled) { return; }
    if (typeof window.requestAnimationFrame !== 'function') {
        drawTreePickerObjectsToggle();
        return;
    }
    isTreePickerObjectsMeasureScheduled = true;
    window.requestAnimationFrame(function () {
        isTreePickerObjectsMeasureScheduled = false;
        drawTreePickerObjectsToggle();
    });

}

export function drawTreePickerObjectsToggle(): void {

    if (!treePickerObjectsToggleElement || !treePickerObjectsListElement) { return; }

    treePickerObjectsToggleElement.textContent = isTreePickerObjectsExpanded ? RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS : RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL;
    treePickerObjectsToggleElement.setAttribute('aria-expanded', isTreePickerObjectsExpanded ? 'true' : 'false');
    const isCut = treePickerObjectsListElement.scrollWidth > treePickerObjectsListElement.clientWidth;
    if (isTreePickerObjectsExpanded || isCut) {
        treePickerObjectsToggleElement.classList.remove('hidden');
    } else {
        treePickerObjectsToggleElement.classList.add('hidden');
    }

}

// THE READER'S PICK, OR A RESULT THEY CLICKED: OPENING A CARD ON ITS TREECIPE TAB LISTS THE ORGS ITS INSERT OFFERS, AS IT ALWAYS HAS
export function chooseTree(treeState: ScriptTreeState, isByReader: boolean): void {

    if (isHiddenByFavorites(treeState)) { isFavoritesOnly = false; }
    selectedTreeKey = treeState.tree.treeKey;
    applyFavoritesFilter(isByReader);

    if (isByReader && treeState.selectedTab === 'treecipe' && renderedSequence !== null && !isRestoringPlace) { requestDataOrgs(); }

}

export function buildTreePicker(trees: Array<{ folderName?: string }>): HTMLElement {

    const pickerElement = createElement('div', 'treePicker');
    const labelElement = createElement('label', 'treePickerLabel', RECIPE_COCKPIT_TREECIPE_PICKER_LABEL);

    const treePickerSelectElement = createElement('select', 'treePickerSelect');
    treePickerElement = treePickerSelectElement;
    treePickerSelectElement.setAttribute('id', 'treePickerSelect');
    treePickerSelectElement.setAttribute('aria-label', RECIPE_COCKPIT_TREECIPE_PICKER_LABEL);
    labelElement.setAttribute('for', 'treePickerSelect');
    treePickerSelectElement.addEventListener('change', function () {
        const optionIndex = /^[0-9]+$/.test(String(treePickerSelectElement.value)) ? Number(treePickerSelectElement.value) : -1;
        const treeState = treePickerTreeStates[optionIndex];
        if (!treeState) { return; }
        chooseTree(treeState, true);
        savePanelPlace();
    });

    pickerElement.appendChild(labelElement);
    pickerElement.appendChild(treePickerSelectElement);

    // FAVORITES ONLY NARROWS THIS DROPDOWN (#374), SO IT IS DRAWN ON ITS ROW (#548), AND ONLY WHEN A CARD CAN BE STARRED
    if (trees.some(function (tree) { return !!tree.folderName; })) {
        renderFavoritesToggle(pickerElement);
    }

    return pickerElement;

}
