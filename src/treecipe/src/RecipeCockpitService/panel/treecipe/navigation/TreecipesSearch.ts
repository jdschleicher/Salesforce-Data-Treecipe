import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_TREECIPES_SEARCH_MORE_SUFFIX,
    RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH,
    RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT
} from '../../../RecipeCockpitNavigationConstants';
import { buildSearchIconElement } from '../../RecipeCockpitPanelBuilders';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { drawHideUnselectedToggle, isObjectHidingUnselectedIn } from '../fieldRows/FieldScope';
import type { IFieldRowFieldState } from '../fieldRows/FieldRowTypes';
import { drawObjectTodosToggle } from '../recordTypes/TodosToggles';
import { listFriendLabelsByObjectApiName } from './Friends';
import { applyTreeFocus, clearStructureFilters } from './StructureFilter';
import { applyFavoritesFilter, chooseTree, displayTitleOf, isHiddenByFavorites } from './TreePicker';
import { asNavigationObjectState, asNavigationTreeState } from './NavigationTypes';
import type { INavigationObjectState, INavigationTreeState, ITreeObjectStateView, ITreeStateView, ITreecipesSearch, ITreecipesSearchEntry, ITreecipesSearchTree, ScriptTreeState } from './NavigationTypes';

/*
    The Treecipes section's search across every card (#374): its index, built once per model from
    what the model already holds, its result rows, and opening what a result names. The search text,
    its index and matches are the panel script's lets, declare let here: it keeps the text with the
    reader's place and empties the index for every model.
*/
declare let treecipesSearch: ITreecipesSearch | null;
declare let treecipesSearchText: string;
declare let treecipesSearchIndex: ITreecipesSearchTree[] | null;
declare let treecipesMatchedTreeKeys: Record<string, true> | null;
declare const treeStates: ScriptTreeState[];
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;
declare function selectTreeTab(treeState: ScriptTreeState | INavigationTreeState, tab: string, isAnimated?: boolean): void;
declare function setTreeObjectExpanded(treeObjectState: INavigationObjectState, isExpanded: boolean, isAnimated?: boolean): void;

const TREECIPES_SEARCH_KINDS: Array<{ kind: ITreecipesSearchEntry['kind']; label: string }> = [
    { kind: 'treecipe', label: 'treecipe' },
    { kind: 'object', label: 'object' },
    { kind: 'field', label: 'field' },
    { kind: 'recordType', label: 'record type' }
];

/*
    One entry per thing the section search can find, lowercased ONCE per model: a card's title
    and folder, and per object it lists (once, iterations being the same object) its api name,
    its fields' api names and labels and its record types' developer names -- all of it already
    in the model, so the host is asked nothing.
*/
function buildTreecipesSearchIndex(): ITreecipesSearchTree[] {

    return treeStates.map(function (treeState) {

        const tree = treeState.tree;
        const entries: ITreecipesSearchEntry[] = [{ kind: 'treecipe', text: displayTitleOf(tree) + (tree.folderName && tree.customName ? ' · ' + tree.folderName : ''), haystack: (displayTitleOf(tree) + '\n' + (tree.folderName || '')).toLowerCase() }];
        const indexedObjectApiNames: Record<string, true> = Object.create(null);
        const friendLabelsByObjectApiName = listFriendLabelsByObjectApiName(treeState);

        treeState.objectStates.forEach(function (treeObjectState) {

            const object = treeObjectState.object;
            if (treeObjectState.isIteration || indexedObjectApiNames[object.objectApiName] === true) { return; }
            indexedObjectApiNames[object.objectApiName] = true;

            const friendLabels = hasOwnKey(friendLabelsByObjectApiName, object.objectApiName) ? friendLabelsByObjectApiName[object.objectApiName] : [];
            entries.push({
                kind: 'object',
                objectApiName: object.objectApiName,
                text: object.objectApiName + (friendLabels.length > 0 ? ' · ' + friendLabels.join(', ') : ''),
                haystack: [object.objectApiName].concat(friendLabels).join('\n').toLowerCase()
            });

            object.fields.forEach(function (field) {
                const fieldLabel = typeof field.fieldLabel === 'string' ? field.fieldLabel : '';
                entries.push({
                    kind: 'field',
                    objectApiName: object.objectApiName,
                    fieldApiName: field.fieldApiName,
                    text: object.objectApiName + '.' + field.fieldApiName + (fieldLabel ? ' · ' + fieldLabel : ''),
                    haystack: (field.fieldApiName + '\n' + fieldLabel).toLowerCase(),
                    // "Account.Name", AS THE RESULT ROW WRITES IT; MATCHED ONLY BY A QUERY WITH A DOT, SO AN OBJECT'S NAME DOES NOT LIST EVERY FIELD
                    qualifiedHaystack: (object.objectApiName + '.' + field.fieldApiName).toLowerCase()
                });
            });

            (Array.isArray(object.recordTypes) ? object.recordTypes : []).forEach(function (recordType: unknown) {
                const developerName = recordType && typeof recordType === 'object' ? (recordType as { developerName?: unknown }).developerName : undefined;
                if (typeof developerName !== 'string') { return; }
                entries.push({ kind: 'recordType', objectApiName: object.objectApiName, text: object.objectApiName + ' · ' + developerName, haystack: developerName.toLowerCase() });
            });

        });

        return { treeState: treeState, entries: entries };

    });

}

export function buildTreecipesSearch(): ITreecipesSearch {

    // ITS OWN CLASSES, STYLED LIKE A TAB'S SEARCH, SO NOTHING THAT LOOKS FOR A TAB'S BOX FINDS THIS ONE
    const searchElement = createElement('div', 'treecipesSearch');
    const fieldElement = createElement('div', 'tabSearchField');
    const inputElement = createElement('input', 'treecipesSearchInput');
    const iconElement = buildSearchIconElement();

    iconElement.addEventListener('click', function () {
        if (typeof inputElement.focus === 'function') { inputElement.focus(); }
    });

    inputElement.setAttribute('type', 'search');
    inputElement.setAttribute('placeholder', RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER);
    inputElement.setAttribute('aria-label', RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER);
    inputElement.value = treecipesSearchText;
    inputElement.addEventListener('input', function () {
        treecipesSearchText = String(inputElement.value || '');
        applyTreecipesSearch();
        savePanelPlace();
    });

    fieldElement.appendChild(iconElement);
    fieldElement.appendChild(inputElement);
    searchElement.appendChild(fieldElement);

    const search: ITreecipesSearch = {
        element: searchElement,
        inputElement: inputElement,
        matchCountElement: createElement('span', 'treecipesSearchCount muted'),
        resultsElement: createElement('div', 'treecipesSearchResults hidden')
    };
    treecipesSearch = search;
    search.resultsElement.setAttribute('role', 'list');
    search.resultsElement.setAttribute('aria-label', 'Search results');
    searchElement.appendChild(search.matchCountElement);

    return search;

}

/*
    Each keystroke scans the index built once per model; what it draws is bounded by
    TREECIPES_SEARCH_RESULT_LIMIT rows, grouped by treecipe and kind, and one "N more" line.
*/
export function applyTreecipesSearch(): void {

    const search = treecipesSearch;
    if (!search) {
        applyFavoritesFilter();
        return;
    }

    const searchQuery = treecipesSearchText.trim().toLowerCase();
    const isQualifiedQuery = searchQuery.indexOf('.') !== -1;
    const resultsElement = search.resultsElement;

    resultsElement.textContent = '';

    if (!searchQuery) {
        treecipesMatchedTreeKeys = null;
        search.matchCountElement.textContent = '';
        resultsElement.classList.add('hidden');
        applyFavoritesFilter();
        return;
    }

    if (treecipesSearchIndex === null) { treecipesSearchIndex = buildTreecipesSearchIndex(); }

    const matchedTreeKeys: Record<string, true> = Object.create(null);
    treecipesMatchedTreeKeys = matchedTreeKeys;
    let matchedTreeCount = 0;
    let drawnResultCount = 0;
    let hiddenResultCount = 0;

    treecipesSearchIndex.forEach(function (indexedTree) {

        if (isHiddenByFavorites(indexedTree.treeState)) { return; }

        const hitsByKind: Record<string, ITreecipesSearchEntry[]> = Object.create(null);
        let treeHitCount = 0;

        indexedTree.entries.forEach(function (entry) {
            if (entry.haystack.indexOf(searchQuery) === -1 && !(isQualifiedQuery && entry.qualifiedHaystack && entry.qualifiedHaystack.indexOf(searchQuery) !== -1)) { return; }
            (hitsByKind[entry.kind] = hitsByKind[entry.kind] || []).push(entry);
            treeHitCount++;
        });

        if (treeHitCount === 0) { return; }

        matchedTreeKeys[indexedTree.treeState.tree.treeKey] = true;
        matchedTreeCount++;

        if (drawnResultCount >= RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT) {
            hiddenResultCount += treeHitCount;
            return;
        }

        const groupElement = createElement('div', 'treecipesResultGroup');
        groupElement.setAttribute('role', 'listitem');
        groupElement.appendChild(createElement('div', 'treecipesResultTree', displayTitleOf(indexedTree.treeState.tree)));

        TREECIPES_SEARCH_KINDS.forEach(function (searchKind) {
            (hitsByKind[searchKind.kind] || []).forEach(function (entry) {
                if (drawnResultCount >= RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT) {
                    hiddenResultCount++;
                    return;
                }
                groupElement.appendChild(buildTreecipesResult(indexedTree.treeState, entry, searchKind.label));
                drawnResultCount++;
            });
        });

        resultsElement.appendChild(groupElement);

    });

    if (hiddenResultCount > 0) {
        resultsElement.appendChild(createElement('div', 'treecipesResultMore muted', hiddenResultCount + RECIPE_COCKPIT_TREECIPES_SEARCH_MORE_SUFFIX));
    }

    if (matchedTreeCount === 0) {
        resultsElement.appendChild(createElement('div', 'treecipesResultNone muted', RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH));
    }

    const pickableCount = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); }).length;
    search.matchCountElement.textContent = matchedTreeCount > 0 ? matchedTreeCount + ' of ' + pluralize(pickableCount, 'treecipe', 'treecipes') : 'no matches';
    resultsElement.classList.remove('hidden');

    applyFavoritesFilter();

}

function buildTreecipesResult(treeState: ScriptTreeState, entry: ITreecipesSearchEntry, kindLabel: string): HTMLButtonElement {

    const resultElement = createButton('link', 'treecipesResult');
    resultElement.appendChild(createElement('span', 'treecipesResultKind muted', kindLabel));
    resultElement.appendChild(createElement('span', 'treecipesResultText', entry.text));
    resultElement.setAttribute('aria-label', kindLabel + ' ' + entry.text + ' in ' + displayTitleOf(treeState.tree));
    resultElement.addEventListener('click', function () { openTreecipesResult(treeState, entry); });

    return resultElement;

}

/*
    A result opens its treecipe on the Treecipe tab and shows what it named: the card, the
    object opened, the field's row (a tab search hiding it is cleared), or the Record types
    section scrolled to the object. One object is opened, inside the AUTO_EXPAND limits.
*/
function openTreecipesResult(treeState: ScriptTreeState, entry: ITreecipesSearchEntry): void {

    chooseTree(treeState, true);
    selectTreeTab(treeState, 'treecipe', false);

    if (entry.kind === 'recordType') {
        applyTreeFocus({ treeKey: treeState.tree.treeKey, tab: 'treecipe', recordTypes: { objectApiName: entry.objectApiName } });
        savePanelPlace();
        return;
    }

    let scrollTarget: HTMLElement | null = treeState.element;

    if (entry.kind === 'object' || entry.kind === 'field') {

        const treeObjectState = treeState.objectStates.find(function (candidateState) { return !candidateState.isIteration && candidateState.object.objectApiName === entry.objectApiName; });

        if (treeObjectState) {

            const fieldState = entry.kind === 'field'
                ? treeObjectState.fieldStates.find(function (candidateState) { return candidateState.field.fieldApiName === entry.fieldApiName; })
                : null;

            scrollTarget = openTreeObjectRow(treeState, treeObjectState, fieldState);

        }

    }

    savePanelPlace();
    if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') { scrollTarget.scrollIntoView({ block: 'nearest' }); }

}

// OPENS ONE OBJECT OR OCCURRENCE, AND CLEARS THE TREECIPE TAB'S SEARCH AND CHECKS -- THE OBJECT'S OWN TOO (#539) -- WHEN THEY HIDE THE FIELD ASKED FOR; ANSWERS THE ROW TO SCROLL TO
function openTreeObjectRow(treeState: INavigationTreeState, treeObjectState: INavigationObjectState, fieldState: { rowElement?: HTMLElement | null } | null | undefined): HTMLElement {

    treeObjectState.isExpandedByReader = true;
    setTreeObjectExpanded(treeObjectState, true, false);

    if (fieldState && fieldState.rowElement && fieldState.rowElement.classList.contains('hidden')) {
        // HIDE UNSELECTED (#483) HIDES EXACTLY THE UNTICKED FIELD A DISABLED INSERT'S LINK OPENS
        const hadObjectFilter = isObjectHidingUnselectedIn(treeObjectState) || treeObjectState.isTodosOnly === true;
        treeObjectState.isHidingUnselected = false;
        treeObjectState.isTodosOnly = false;
        clearStructureFilters(treeState);
        if (hadObjectFilter) {
            drawHideUnselectedToggle(treeObjectState);
            drawObjectTodosToggle(treeObjectState);
        }
        setTreeObjectExpanded(treeObjectState, true, false);
    }

    return fieldState && fieldState.rowElement ? fieldState.rowElement : treeObjectState.element;

}

/*
    The rows #380 moves between: a parent's nickname list opens a child's field, and a child's
    back-link opens its parent. Both stay on the card's Treecipe tab, scroll the row into view and
    put focus on what the reader can use next there.
*/
export function revealTreeObjectRow(treeStateView: ITreeStateView, treeObjectStateView: ITreeObjectStateView, fieldState: { rowElement?: HTMLElement | null } | null, focusElement: HTMLElement | null): void {

    const treeState = asNavigationTreeState(treeStateView);
    const treeObjectState = asNavigationObjectState(treeObjectStateView);
    selectTreeTab(treeState, 'treecipe', false);
    const scrollTarget = openTreeObjectRow(treeState, treeObjectState, fieldState);

    savePanelPlace();
    if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') { scrollTarget.scrollIntoView({ block: 'nearest' }); }
    if (focusElement && typeof focusElement.focus === 'function') { focusElement.focus(); }

}
