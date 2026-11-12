import { createButton, createElement, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_NO_REMOVED_TODOS_NOTE,
    RECIPE_COCKPIT_NO_TREE_TODOS_NOTE,
    RECIPE_COCKPIT_REMOVED_TODOS_PLACEHOLDER,
    RECIPE_COCKPIT_TODOS_VIEWS,
    RECIPE_COCKPIT_TODOS_VIEW_LABELS,
    RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL,
    RECIPE_COCKPIT_TODO_NO_RECIPE_REASON,
    RECIPE_COCKPIT_TODO_OTHER_RECIPE_REASON,
    RECIPE_COCKPIT_TODO_REFERENCE_LOOKUP_REASON,
    RECIPE_COCKPIT_TODO_REMOVE_LABEL,
    RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS,
    RECIPE_COCKPIT_TODO_RESTORE_LABEL,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS,
    RecipeCockpitTodoRemoveLock,
    RecipeCockpitTodosView
} from '../../RecipeCockpitTroubleshootingConstants';
import { buildTabSearch } from '../RecipeCockpitPanelBuilders';
import { applyTroubleshootingFilter, buildTroubleshootingGroupCard, drawTroubleshootingGroupExpanded, setShownIfChanged, troubleshootingSearchKey } from './TroubleshootingTab';
import {
    IRecipeTodo,
    IRemovedTodo,
    IRemovedTodoEntry,
    IRemovedTodoGroupState,
    ITodoEntry,
    ITodoGroupState,
    ITodosFrame,
    ITodosViewState,
    ITodoTreeObject,
    ITroubleshootingSubTabState,
    ITroubleshootingTree,
    ITroubleshootingTreeState
} from './TroubleshootingTypes';

/*
    The TODO's sub-tab (#365, #391, #639): the open TODOs of the card's recipe, one group per object
    occurrence, and the ones the reader removed. These names are the panel script's own, read when a
    function runs; the wire-lookup lock is shared with the Treecipe tab's lookups.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const isWireLookupRunning: boolean;
declare const wireLookupButtonElements: HTMLButtonElement[];
// OWNED BY RelationshipService (LAYER 3), WHICH NO PANEL MODULE CAN IMPORT, SO THE SCRIPT STILL DECLARES IT
declare const REFERENCE_ID_REQUIRED_TODO_TEXT: string;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;
declare function setWireLookupRunning(isRunning: boolean): void;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function buildSourceLink(className: string, labelText: string, filePath: string, lineNumber: number): HTMLElement;

/*
    Every TODO comment of the card's recipe (#365, from #354's todos), one group per object
    occurrence: a header with its count, and rows -- the field (or "on the object"), the text
    and a link to the TODO's own line -- built only when the group opens, like a Treecipe
    object's rows. A field TODO posted without its text is one its value holds, so the text is
    read back from that value. Search matches what each entry saved at build, so it needs no
    rows; groups open within the auto-expand budgets, so a tree of thousands of TODOs costs its
    headers and the rows the budget allows.
*/
export function buildTroubleshootingTodos(treeState: ITroubleshootingTreeState, subTabState: ITroubleshootingSubTabState): void {

    subTabState.noun = ['TODO', 'TODOs'];
    const todoGroups: ITodoGroupState[] = [];
    subTabState.todoGroups = todoGroups;

    treeState.objectStates.forEach(function (treeObjectState) {

        if (treeObjectState.todoCount === 0) { return; }

        const object = treeObjectState.object;
        // AN OBJECT WRITTEN MORE THAN ONCE IS TOLD APART BY THE NICKNAME OF THE OCCURRENCE
        const hasNickname = !!object.nickname && (!!object.iteration || Array.isArray(object.iterations));
        const objectLabel = object.objectApiName + (hasNickname ? ' · ' + object.nickname : '');
        const groupState: ITodoGroupState = {
            object: object,
            treeState: treeState,
            element: null,
            toggleElement: null,
            countElement: createElement('span', 'troubleshootingTodoCount muted'),
            bodyElement: createElement('div', 'troubleshootingTodoRows hidden'),
            entries: [],
            matchingCount: 0,
            isBuilt: false,
            isExpanded: false,
            isShown: true
        };

        const addEntry = function (fieldLabel: string, todo: IRecipeTodo, todoText: string, isFieldTodo: boolean) {
            groupState.entries.push({
                fieldLabel: fieldLabel,
                todo: todo,
                todoText: todoText,
                isFieldTodo: isFieldTodo,
                removeReason: findTodoRemoveReason(treeState.tree, object, todo, todoText),
                searchText: [object.objectApiName, object.nickname || '', fieldLabel, todoText].join('\n').toLowerCase(),
                isMatch: true,
                element: null
            });
        };

        treeObjectState.objectTodos.forEach(function (todo) {
            addEntry('on the object', todo, typeof todo.text === 'string' ? todo.text : '', false);
        });

        treeObjectState.fieldStates.forEach(function (fieldState) {
            fieldState.todos.forEach(function (todo) {
                addEntry(fieldState.field.fieldApiName, todo, readFieldTodoText(todo, fieldState.field.recipeValue), true);
            });
        });

        const groupCard = buildTroubleshootingGroupCard('todos', 'troubleshootingTodoGroup', 'troubleshootingTodoToggle', objectLabel, 'troubleshootingTodoObject', groupState.countElement, groupState.bodyElement, true);
        groupState.element = groupCard.element;
        groupState.toggleElement = groupCard.headerElement;
        groupState.toggleElement.addEventListener('click', function () {
            setTodoGroupExpanded(groupState, !groupState.isExpanded, true);
        });

        if (!subTabState.groupGridElement) {
            subTabState.groupGridElement = createElement('div', 'troubleshootingGroupCards');
            subTabState.listElement.appendChild(subTabState.groupGridElement);
        }
        subTabState.groupGridElement.appendChild(groupState.element);
        todoGroups.push(groupState);

    });

    const todoCount = todoGroups.reduce(function (count, groupState) { return count + groupState.entries.length; }, 0);
    subTabState.tabElement.textContent = todoCount > 0 ? RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS.todos + ' (' + todoCount + ')' : RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS.todos;
    subTabState.tabElement.setAttribute('data-label', subTabState.tabElement.textContent);

    if (todoCount === 0) {
        subTabState.listElement.appendChild(createElement('div', 'treeEmpty muted', RECIPE_COCKPIT_NO_TREE_TODOS_NOTE));
    }

    buildRemovedTodos(treeState, subTabState);
    drawTodosViewLabels(subTabState, todoCount);
    selectTodosView(treeState, treeState.todosView, false);

}


/*
    The TODO's sub-tab's Open and Removed lists (#391): a strip of two buttons, each list in its
    own panel with its own search. Which is open is the card's todosView, kept in the place.
*/
export function buildTodosViewFrame(treeState: ITroubleshootingTreeState, subPanelElement: HTMLElement): ITodosFrame {

    const stripElement = createElement('div', 'todosViews');
    stripElement.setAttribute('role', 'tablist');
    stripElement.setAttribute('aria-label', RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS.todos);
    subPanelElement.appendChild(stripElement);

    const viewStates: Record<RecipeCockpitTodosView, ITodosViewState> = Object.create(null);
    RECIPE_COCKPIT_TODOS_VIEWS.forEach(function (todosView) {
        const tabElement = createButton('secondary', 'todosView todosView-' + todosView, RECIPE_COCKPIT_TODOS_VIEW_LABELS[todosView]);
        const panelElement = createElement('div', 'todosViewPanel todosViewPanel-' + todosView + (todosView === 'open' ? '' : ' hidden'));
        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', todosView === 'open' ? 'true' : 'false');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', RECIPE_COCKPIT_TODOS_VIEW_LABELS[todosView]);
        tabElement.addEventListener('click', function () { selectTodosView(treeState, todosView, true); });
        stripElement.appendChild(tabElement);
        subPanelElement.appendChild(panelElement);
        viewStates[todosView] = { tabElement: tabElement, panelElement: panelElement };
    });

    if (treeState.todosView === undefined || RECIPE_COCKPIT_TODOS_VIEWS.indexOf(treeState.todosView) === -1) { treeState.todosView = RECIPE_COCKPIT_TODOS_VIEWS[0]; }

    return { stripElement: stripElement, viewStates: viewStates };

}


export function selectTodosView(treeState: ITroubleshootingTreeState, todosView: RecipeCockpitTodosView | undefined, isAnimated: boolean): void {

    const subTabState = (treeState.troubleshootingSubTabStates || []).find(function (candidate) { return candidate.subTab === 'todos'; });
    if (!subTabState || !subTabState.todosFrame || todosView === undefined || RECIPE_COCKPIT_TODOS_VIEWS.indexOf(todosView) === -1) { return; }

    const todosFrame = subTabState.todosFrame;
    treeState.todosView = todosView;
    RECIPE_COCKPIT_TODOS_VIEWS.forEach(function (candidateView) {
        const viewState = todosFrame.viewStates[candidateView];
        const isSelected = candidateView === todosView;
        if (isSelected) { viewState.tabElement.classList.add('selected'); } else { viewState.tabElement.classList.remove('selected'); }
        viewState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        setShownWithMotion(viewState.panelElement, isSelected, isSelected && isAnimated);
    });

    savePanelPlace();

}


function drawTodosViewLabels(subTabState: ITroubleshootingSubTabState, openCount: number): void {
    const viewStates = (subTabState.todosFrame as ITodosFrame).viewStates;
    const removedCount = (subTabState.removedEntries as IRemovedTodoEntry[]).length;
    viewStates.open.tabElement.textContent = RECIPE_COCKPIT_TODOS_VIEW_LABELS.open + ' (' + openCount + ')';
    viewStates.removed.tabElement.textContent = RECIPE_COCKPIT_TODOS_VIEW_LABELS.removed + ' (' + removedCount + ')';
}


/*
    Why a TODO's Remove TODO is disabled, or '' when it is not: the host's lock (#391), a TODO of
    another card's recipe file, or a card with no single recipe file. A lookup's TODO says to wire
    the lookup. The host decides again on the click.
*/
function findTodoRemoveReason(tree: ITroubleshootingTree, object: ITodoTreeObject, todo: IRecipeTodo, todoText: string): string {

    if (!tree.runFakerRecipeFileName) { return RECIPE_COCKPIT_TODO_NO_RECIPE_REASON; }
    if (fileNameOf(object.recipeFilePath) !== tree.runFakerRecipeFileName) { return RECIPE_COCKPIT_TODO_OTHER_RECIPE_REASON; }
    if (typeof todo.removeLock !== 'string') { return ''; }
    if (todo.removeLock === 'field-value' && todoText.indexOf(REFERENCE_ID_REQUIRED_TODO_TEXT) === 0) { return RECIPE_COCKPIT_TODO_REFERENCE_LOOKUP_REASON; }
    return hasOwnKey(RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS, todo.removeLock) ? RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS[todo.removeLock as RecipeCockpitTodoRemoveLock] : RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS['field-value'];

}


// THE OWNER, ITS "↗ yml" LINK AND ITS BUTTON ON ONE LINE, THE TODO'S TEXT UNDER THEM (#391)
function buildTodoRowElement(isMatch: boolean, ownerLabel: string, isFieldOwner: boolean, sourceLinkElement: HTMLElement | null, actionElement: HTMLElement, todoText: string): HTMLElement {

    const todoElement = createElement('div', isMatch ? 'troubleshootingTodo' : 'troubleshootingTodo hidden');
    const headElement = createElement('div', 'troubleshootingTodoHead');
    headElement.appendChild(createElement('span', isFieldOwner ? 'troubleshootingTodoField' : 'troubleshootingTodoField muted', ownerLabel));
    if (sourceLinkElement) { headElement.appendChild(sourceLinkElement); }
    headElement.appendChild(actionElement);
    todoElement.appendChild(headElement);
    todoElement.appendChild(createElement('span', todoText ? 'troubleshootingTodoText' : 'troubleshootingTodoText muted', todoText || RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL));
    return todoElement;

}


function buildRemoveTodoButton(treeState: ITroubleshootingTreeState, entry: ITodoEntry): HTMLButtonElement {

    const removeElement = createButton('secondary', 'troubleshootingTodoAction troubleshootingTodoRemove', RECIPE_COCKPIT_TODO_REMOVE_LABEL, 'compact');
    removeElement.setAttribute('aria-label', RECIPE_COCKPIT_TODO_REMOVE_LABEL + ': ' + entry.fieldLabel + ', line ' + entry.todo.lineNumber);

    if (entry.removeReason) {
        removeElement.disabled = true;
        removeElement.setAttribute('title', entry.removeReason);
        return removeElement;
    }

    removeElement.setAttribute('title', 'Remove this TODO comment from the recipe file, after a confirmation. It is kept under Removed, where Restore puts it back.');
    removeElement.addEventListener('click', function () {
        if (isWireLookupRunning) { return; }
        setWireLookupRunning(true);
        vscodeApi.postMessage({ command: 'removeTodo', treeKey: treeState.tree.treeKey, lineNumber: entry.todo.lineNumber });
    });
    removeElement.disabled = isWireLookupRunning;
    wireLookupButtonElements.push(removeElement);
    return removeElement;

}


/*
    The TODOs the reader removed from the card's recipe (#391), grouped by object occurrence like
    the open list and built at once: the host lists only what is still out of the recipe, a short
    list next to the open one. Each row's Restore posts the row's removalKey, and the host puts
    back the line its removed-TODOs file holds.
*/
function buildRemovedTodos(treeState: ITroubleshootingTreeState, subTabState: ITroubleshootingSubTabState): void {

    const removedPanelElement = (subTabState.todosFrame as ITodosFrame).viewStates.removed.panelElement;
    const searchKey = troubleshootingSearchKey('todosRemoved');
    if (typeof treeState.searchTexts[searchKey] !== 'string') {
        treeState.searchTexts[searchKey] = '';
        treeState.searchQueries[searchKey] = '';
    }

    const removedSearch = buildTabSearch(treeState, searchKey, RECIPE_COCKPIT_REMOVED_TODOS_PLACEHOLDER, function () { applyTroubleshootingFilter(treeState, 'todos'); });
    const removedListElement = createElement('div', 'troubleshootingList troubleshootingGroupCards');
    const removedGroups: IRemovedTodoGroupState[] = [];
    const removedEntries: IRemovedTodoEntry[] = [];
    subTabState.removedSearch = removedSearch;
    subTabState.removedListElement = removedListElement;
    subTabState.removedGroups = removedGroups;
    subTabState.removedEntries = removedEntries;
    removedPanelElement.appendChild(removedSearch.element);
    removedPanelElement.appendChild(removedListElement);

    const removedTodos: IRemovedTodo[] = Array.isArray(treeState.tree.removedTodos) ? treeState.tree.removedTodos : [];
    const groupsByLabel: Record<string, IRemovedTodoGroupState> = Object.create(null);

    removedTodos.forEach(function (removedTodo) {

        const objectLabel = removedTodo.objectApiName + (removedTodo.objectNickname ? ' · ' + removedTodo.objectNickname : '');
        let groupState = groupsByLabel[objectLabel];
        if (!groupState) {
            // A REMOVED GROUP IS BUILT OPEN AND STAYS OPEN, SO ITS HEADER IS TEXT ON THE SAME CARD
            const countElement = createElement('span', 'troubleshootingTodoCount muted');
            const bodyElement = createElement('div', 'troubleshootingTodoRows');
            groupState = {
                element: buildTroubleshootingGroupCard('todos', 'troubleshootingTodoGroup expanded', '', objectLabel, 'troubleshootingTodoObject', countElement, bodyElement, false).element,
                countElement: countElement,
                bodyElement: bodyElement,
                entries: [],
                matchingCount: 0,
                isShown: true
            };
            removedListElement.appendChild(groupState.element);
            groupsByLabel[objectLabel] = groupState;
            removedGroups.push(groupState);
        }

        const fieldLabel = removedTodo.fieldApiName || 'on the object';
        const restoreElement = createButton('secondary', 'troubleshootingTodoAction troubleshootingTodoRestore', RECIPE_COCKPIT_TODO_RESTORE_LABEL, 'compact');
        restoreElement.setAttribute('aria-label', RECIPE_COCKPIT_TODO_RESTORE_LABEL + ': ' + fieldLabel + ', ' + removedTodo.text);
        restoreElement.setAttribute('title', 'Put this TODO comment back in the recipe file where it was, after a confirmation');
        restoreElement.addEventListener('click', function () {
            if (isWireLookupRunning) { return; }
            setWireLookupRunning(true);
            vscodeApi.postMessage({ command: 'restoreTodo', treeKey: treeState.tree.treeKey, removalKey: removedTodo.removalKey });
        });
        restoreElement.disabled = isWireLookupRunning;
        wireLookupButtonElements.push(restoreElement);

        const entry: IRemovedTodoEntry = {
            searchText: [removedTodo.objectApiName, removedTodo.objectNickname || '', fieldLabel, removedTodo.text].join('\n').toLowerCase(),
            isMatch: true,
            isShown: true,
            element: buildTodoRowElement(true, fieldLabel, !!removedTodo.fieldApiName, null, restoreElement, removedTodo.text)
        };
        groupState.entries.push(entry);
        groupState.bodyElement.appendChild(entry.element);
        removedEntries.push(entry);

    });

    if (removedTodos.length === 0) {
        removedListElement.appendChild(createElement('div', 'treeEmpty muted', RECIPE_COCKPIT_NO_REMOVED_TODOS_NOTE));
    }

}


export function setTodoGroupExpanded(groupState: ITodoGroupState, isExpanded: boolean, isAnimated: boolean): void {

    if (isExpanded && !groupState.isBuilt) {
        groupState.entries.forEach(function (entry) {
            const object = groupState.object;
            const sourceLinkElement = object.recipeFilePath && entry.todo.lineNumber
                ? buildSourceLink('treeTodoSource', '↗ yml', object.recipeFilePath, entry.todo.lineNumber)
                : null;
            const todoElement = buildTodoRowElement(entry.isMatch, entry.fieldLabel, entry.isFieldTodo, sourceLinkElement, buildRemoveTodoButton(groupState.treeState, entry), entry.todoText);
            entry.element = todoElement;
            groupState.bodyElement.appendChild(todoElement);
        });
        groupState.isBuilt = true;
    }

    groupState.isExpanded = isExpanded;
    setShownWithMotion(groupState.bodyElement, isExpanded, isAnimated);
    drawTroubleshootingGroupExpanded(groupState, isExpanded);

}


// A FIELD TODO'S TEXT: ITS OWN, OR THE SPAN OF THE FIELD'S VALUE THE HOST SAID HOLDS IT; '' WHEN NEITHER IS USABLE
function readFieldTodoText(todo: IRecipeTodo, recipeValue: unknown): string {

    if (typeof todo.text === 'string') { return todo.text; }

    const value = typeof recipeValue === 'string' ? recipeValue : '';
    const valueStart = todo.valueStart;
    const valueLength = todo.valueLength;
    const isUsableSpan = Number.isInteger(valueStart) && Number.isInteger(valueLength)
        && (valueStart as number) >= 0 && (valueLength as number) > 0 && (valueStart as number) + (valueLength as number) <= value.length;

    return isUsableSpan ? value.substr(valueStart as number, valueLength as number) : '';

}


// THE REMOVED LIST'S OWN SEARCH (#391): A ROW IS MATCHED BY ITS SAVED TEXT, A GROUP SHOWN WHILE ONE OF ITS ROWS MATCHES
export function applyRemovedTodosFilter(treeState: ITroubleshootingTreeState, subTabState: ITroubleshootingSubTabState): void {

    if (!subTabState.removedGroups) { return; }

    const searchQuery = treeState.searchQueries[troubleshootingSearchKey('todosRemoved')] || '';
    let matchingCount = 0;

    subTabState.removedGroups.forEach(function (groupState) {
        groupState.matchingCount = 0;
        groupState.entries.forEach(function (entry) {
            entry.isMatch = !searchQuery || entry.searchText.indexOf(searchQuery) !== -1;
            if (entry.isMatch) { groupState.matchingCount++; }
            setShownIfChanged(entry, entry.element, entry.isMatch);
        });
        matchingCount += groupState.matchingCount;
        setShownIfChanged(groupState, groupState.element, !searchQuery || groupState.matchingCount > 0);
        groupState.countElement.textContent = searchQuery
            ? groupState.matchingCount + ' of ' + pluralize(groupState.entries.length, 'TODO', 'TODOs')
            : pluralize(groupState.entries.length, 'TODO', 'TODOs');
    });

    const total = (subTabState.removedEntries as IRemovedTodoEntry[]).length;
    (subTabState.removedSearch as NonNullable<ITroubleshootingSubTabState['removedSearch']>).matchCountElement.textContent = !searchQuery
        ? pluralize(total, 'removed TODO', 'removed TODOs')
        : matchingCount > 0 ? matchingCount + ' of ' + pluralize(total, 'removed TODO', 'removed TODOs') : 'no matches';

}


function fileNameOf(filePath: unknown): string {
    const pathParts = String(filePath || '').split(/[\\/]/);
    return pathParts[pathParts.length - 1];
}
