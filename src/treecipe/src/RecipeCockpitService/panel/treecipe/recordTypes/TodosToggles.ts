import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE,
    RECIPE_COCKPIT_NO_TODOS_NOTE,
    RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL,
    RECIPE_COCKPIT_TODOS_ONLY_LABEL,
    RECIPE_COCKPIT_TODO_IN_VALUE_LABEL
} from '../../../RecipeCockpitRecordTypesConstants';
import { IRecipeTodo, IRecordTypesTreeObjectState, IRecordTypesTreeState } from './RecordTypeTypes';

/*
    The Treecipe tab's "TODOs only" checks: the card's (#354) and each object's (#477), and the list
    of a field's or an object's TODO comments. These names are the panel script's own, read when a
    function runs.
*/
declare function displayTitleOf(tree: unknown): string;
declare function applyStructureFilter(treeState: IRecordTypesTreeState): void;
declare function filterTreeObjectRows(treeState: IRecordTypesTreeState, treeObjectState: IRecordTypesTreeObjectState): void;
declare function drawStructureMatchCount(treeState: IRecordTypesTreeState): void;
declare function buildSourceLink(className: string, labelText: string, filePath: string, lineNumber: number): HTMLElement;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;

/*
    The card's "TODOs only" (#354): per card and panel-only, kept in the reader's place. It narrows
    the rows to the fields whose recipe lines carry a TODO comment, with the search, and never hides
    an object. A card with no TODO draws it disabled.
*/
function todoCountOf(treeState: IRecordTypesTreeState): number {
    if (typeof treeState.todoCount !== 'number') {
        treeState.todoCount = treeState.objectStates.reduce(function (todoCount, treeObjectState) { return todoCount + treeObjectState.todoCount; }, 0);
    }
    return treeState.todoCount;
}

export function isTodosOnlyIn(treeState: IRecordTypesTreeState): boolean {
    return treeState.isTodosOnly === true && todoCountOf(treeState) > 0;
}

export function appendTodosToggle(treeState: IRecordTypesTreeState, tileElement: HTMLElement): void {

    const rowElement = createElement('div', 'treecipeFilterRow');
    tileElement.appendChild(rowElement);
    const todoCount = todoCountOf(treeState);
    const checkElement = createElement('span', 'treeTodosCheck');
    const toggleElement = createButton('check', 'treeFieldInclude treeTodosToggle');
    const labelElement = createElement('span', 'treeTodosLabel', todoCount > 0 ? RECIPE_COCKPIT_TODOS_ONLY_LABEL + ' (' + todoCount + ')' : RECIPE_COCKPIT_TODOS_ONLY_LABEL);
    toggleElement.setAttribute('role', 'checkbox');
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_TODOS_ONLY_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');

    if (todoCount > 0) {
        const title = 'Show only the fields and objects with a TODO comment in the recipe (' + pluralize(todoCount, 'TODO', 'TODOs') + ')';
        const toggleTodosOnly = function () {
            if (toggleElement.disabled) { return; }
            treeState.isTodosOnly = !treeState.isTodosOnly;
            applyStructureFilter(treeState);
            savePanelPlace();
        };
        toggleElement.setAttribute('title', title);
        labelElement.setAttribute('title', title);
        toggleElement.addEventListener('click', toggleTodosOnly);
        labelElement.addEventListener('click', toggleTodosOnly);
    } else {
        toggleElement.disabled = true;
        toggleElement.setAttribute('title', RECIPE_COCKPIT_NO_TODOS_NOTE);
        checkElement.classList.add('disabled');
    }

    treeState.todosToggleElement = toggleElement;
    checkElement.appendChild(toggleElement);
    checkElement.appendChild(labelElement);
    rowElement.appendChild(checkElement);

    if (todoCount === 0) {
        rowElement.appendChild(createElement('span', 'treeTodosNote muted', RECIPE_COCKPIT_NO_TODOS_NOTE));
    }

    drawTodosToggle(treeState);

}

export function drawTodosToggle(treeState: IRecordTypesTreeState): void {

    const toggleElement = treeState.todosToggleElement;
    if (!toggleElement) { return; }

    const isChecked = isTodosOnlyIn(treeState);
    toggleElement.textContent = isChecked ? '✓' : '';
    toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');

}

// A FIELD'S OR AN OBJECT'S TODO COMMENTS (#354): THE TEXT, AS TEXT, AND A LINK TO ITS LINE
export function buildTodoListElement(recipeFilePath: string | null | undefined, todos: IRecipeTodo[]): HTMLElement {

    const listElement = createElement('div', 'treeTodos');

    todos.forEach(function (todo) {
        const todoElement = createElement('div', 'treeTodo');
        // A TODO WITH NO TEXT IS ONE THE FIELD'S DRAWN VALUE ALREADY SHOWS: THE ROW POINTS AT IT RATHER THAN POSTING IT TWICE
        todoElement.appendChild(typeof todo.text === 'string'
            ? createElement('span', 'treeTodoText', todo.text)
            : createElement('span', 'treeTodoText muted', RECIPE_COCKPIT_TODO_IN_VALUE_LABEL + ' (line ' + todo.lineNumber + ')'));
        if (recipeFilePath && todo.lineNumber) {
            todoElement.appendChild(buildSourceLink('treeTodoSource', '↗ yml', recipeFilePath, todo.lineNumber));
        }
        listElement.appendChild(todoElement);
    });

    return listElement;

}

/*
    The object's own "TODOs only" (#477): narrows THIS object's rows to the fields whose recipe lines
    carry a TODO, with the search and the card-wide check (#354). Panel-only: it posts nothing.
*/
export function isObjectTodosOnlyIn(treeObjectState: IRecordTypesTreeObjectState): boolean {
    return treeObjectState.isTodosOnly === true && treeObjectState.todoCount > 0;
}

export function buildObjectTodosToggle(treeObjectState: IRecordTypesTreeObjectState): HTMLElement {

    const objectApiName = treeObjectState.object.objectApiName;
    const checkElement = createElement('span', 'treeFieldSelectAllCheck treeObjectTodosCheck');
    const toggleElement = createButton('check', 'treeObjectTodosToggle');
    const labelText = treeObjectState.todoCount > 0 ? RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL + ' (' + treeObjectState.todoCount + ')' : RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL;
    const labelElement = createElement('span', 'treeObjectTodosLabel', labelText);
    toggleElement.setAttribute('role', 'checkbox');
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL + ' (' + objectApiName + ')');

    if (treeObjectState.todoCount > 0) {
        const title = 'Show only the fields of ' + objectApiName + ' with a TODO comment in the recipe (' + pluralize(treeObjectState.todoCount, 'TODO', 'TODOs') + ')';
        const toggleTodosOnly = function () {
            if (toggleElement.disabled) { return; }
            treeObjectState.isTodosOnly = !treeObjectState.isTodosOnly;
            if (treeObjectState.treeState.structureSearch) {
                filterTreeObjectRows(treeObjectState.treeState, treeObjectState);
                drawStructureMatchCount(treeObjectState.treeState);
            }
            drawObjectTodosToggle(treeObjectState);
            savePanelPlace();
        };
        toggleElement.setAttribute('title', title);
        labelElement.setAttribute('title', title);
        toggleElement.addEventListener('click', toggleTodosOnly);
        labelElement.addEventListener('click', toggleTodosOnly);
    } else {
        toggleElement.disabled = true;
        toggleElement.setAttribute('title', RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE);
        labelElement.setAttribute('title', RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE);
        checkElement.classList.add('disabled');
    }

    treeObjectState.todosToggleElement = toggleElement;
    checkElement.appendChild(toggleElement);
    checkElement.appendChild(labelElement);
    drawObjectTodosToggle(treeObjectState);

    return checkElement;

}

export function drawObjectTodosToggle(treeObjectState: IRecordTypesTreeObjectState): void {

    const toggleElement = treeObjectState.todosToggleElement;
    if (!toggleElement) { return; }

    const isChecked = isObjectTodosOnlyIn(treeObjectState);
    toggleElement.textContent = isChecked ? '✓' : '';
    toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');

}
