import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX,
    RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL,
    RECIPE_COCKPIT_NO_UNSELECTED_FIELDS_NOTE,
    RECIPE_COCKPIT_SELECT_ALL_FIELDS_LABEL,
    RECIPE_COCKPIT_STANDARD_FIELDS_LABEL,
    RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE
} from '../../../RecipeCockpitFieldRowsConstants';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { buildObjectTodosToggle } from '../recordTypes/TodosToggles';
import { drawFieldRowSelection, drawNoFieldsSelected, findFieldLockingExclusion, findObjectExclusion, findObjectFieldSelection, isTreeFieldUnticked, occurrenceNicknameOf } from './SelectionCascade';
import type { FieldRowsPanelMessage, FieldScopeCheckedState, IFieldRowObjectState, IFieldRowTreeState, IHideUnselectedState } from './FieldRowTypes';
import { drawStructureMatchCount, filterTreeObjectRows } from '../navigation/StructureFilter';

/*
    An object's field scope boxes and its own filter (#410, #477, #483): "All fields", "Standard
    fields" and "Hide unselected". A box posts names only, and which fields it touches is the host's
    decision; "Hide unselected" posts nothing. filterTreeObjectRows, drawStructureMatchCount and
    savePanelPlace are the panel script's, declared here.
*/
declare const vscodeApi: { postMessage(message: FieldRowsPanelMessage): void };
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;

type FieldScopeCheckedStateKey = 'selectAllCheckedState' | 'selectStandardCheckedState';

interface IFieldScopeCount {
    untickable: number;
    ticked: number;
}

// ONE OBJECT'S WARNING, THEN EVERY ROW IT HAS BUILT
export function drawObjectFieldSelection(treeObjectState: IFieldRowObjectState): boolean {

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, occurrenceNicknameOf(treeObjectState.object));
    const exclusion = findObjectExclusion(tree, objectApiName);
    const isEveryFieldUnticked = !!objectFieldSelection && !!objectFieldSelection.isEveryFieldExcluded;
    // THE HOST LEAVES THE OBJECT OUT AS noFieldsSelected; AN ITERATION IS NO PART OF THE CASCADE, SO ITS OWN FIELDS DECIDE
    const isNoFieldsSelected = exclusion ? exclusion.kind === 'noFieldsSelected' && ( !treeObjectState.isIteration || isEveryFieldUnticked ) : isEveryFieldUnticked;

    drawNoFieldsSelected(treeObjectState, isNoFieldsSelected);

    if (treeObjectState.isBodyBuilt) {
        treeObjectState.fieldStates.forEach(function (fieldState) { drawFieldRowSelection(treeObjectState, fieldState); });
        drawSelectAllFields(treeObjectState);
    }

    return refreshHideUnselectedFields(treeObjectState);

}

/*
    The object's "All fields" box (#410): ticked when every field the reader can untick is ticked,
    unticked when none is, mixed otherwise. A locked field is left out of that count, so after
    "untick all" the box reads unticked while RecordTypeId and the like stay ticked. A click posts
    setAllFieldsIncluded with NAMES only; which fields it touches is the host's decision.
*/
export function buildSelectAllFieldsElement(treeObjectState: IFieldRowObjectState, hasSelectableFields: boolean): HTMLElement {

    const rowElement = createElement('div', 'treeFieldSelectAllRow');
    treeObjectState.selectAllRowElement = rowElement;

    if (hasSelectableFields) {
        const selectAll = buildFieldScopeCheck(treeObjectState, 'treeFieldInclude treeFieldSelectAll', 'treeFieldSelectAllLabel', RECIPE_COCKPIT_SELECT_ALL_FIELDS_LABEL, undefined, 'selectAllCheckedState');
        treeObjectState.selectAllCheckElement = selectAll.checkElement;
        treeObjectState.selectAllElement = selectAll.toggleElement;
        rowElement.appendChild(selectAll.checkElement);
        // "Standard fields" (#477): THE SAME BOX OVER THE FIELDS WHOSE API NAME DOES NOT END IN __c
        const selectStandard = buildFieldScopeCheck(treeObjectState, 'treeFieldSelectStandard', 'treeFieldSelectStandardLabel', RECIPE_COCKPIT_STANDARD_FIELDS_LABEL, RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE, 'selectStandardCheckedState');
        treeObjectState.selectStandardCheckElement = selectStandard.checkElement;
        treeObjectState.selectStandardElement = selectStandard.toggleElement;
        rowElement.appendChild(selectStandard.checkElement);
        rowElement.appendChild(buildHideUnselectedToggle(treeObjectState));
    }

    rowElement.appendChild(buildObjectTodosToggle(treeObjectState));

    return rowElement;

}

function buildFieldScopeCheck(treeObjectState: IFieldRowObjectState, toggleClassName: string, labelClassName: string, labelText: string, fieldScope: string | undefined,
                                checkedStateKey: FieldScopeCheckedStateKey): { checkElement: HTMLElement; toggleElement: HTMLButtonElement } {

    const object = treeObjectState.object;
    const checkElement = createElement('span', 'treeFieldSelectAllCheck');
    const toggleElement = createButton('check', toggleClassName);
    const labelElement = createElement('span', labelClassName, labelText);
    toggleElement.setAttribute('role', 'checkbox');

    const toggleFields = function (): void {
        if (toggleElement.disabled) { return; }
        const message: FieldRowsPanelMessage = {
            command: 'setAllFieldsIncluded',
            treeKey: treeObjectState.tree.treeKey,
            objectApiName: object.objectApiName,
            included: treeObjectState[checkedStateKey] !== 'true'
        };
        if (object.nickname) { message.nickname = object.nickname; }
        if (fieldScope) { message.fieldScope = fieldScope; }
        vscodeApi.postMessage(message);
    };
    toggleElement.addEventListener('click', toggleFields);
    labelElement.addEventListener('click', toggleFields);

    checkElement.appendChild(toggleElement);
    checkElement.appendChild(labelElement);

    return { checkElement: checkElement, toggleElement: toggleElement };

}

function isStandardFieldApiName(fieldApiName: string): boolean {
    const lowerCaseName = fieldApiName.toLowerCase();
    return lowerCaseName.slice(lowerCaseName.length - RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX.length) !== RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX;
}

function drawSelectAllFields(treeObjectState: IFieldRowObjectState): void {

    if (!treeObjectState.selectAllElement) { return; }

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, occurrenceNicknameOf(treeObjectState.object));
    const isObjectExcluded = !!findFieldLockingExclusion(tree, objectApiName);
    const counts = { all: { untickable: 0, ticked: 0 }, standard: { untickable: 0, ticked: 0 } };

    treeObjectState.fieldStates.forEach(function (fieldState) {
        const fieldApiName = fieldState.field.fieldApiName;
        if (!fieldState.field.lineNumber) { return; }
        if (objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName)) { return; }
        const isTicked = !objectFieldSelection || !hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName);
        counts.all.untickable++;
        if (isTicked) { counts.all.ticked++; }
        if (isStandardFieldApiName(fieldApiName)) {
            counts.standard.untickable++;
            if (isTicked) { counts.standard.ticked++; }
        }
    });

    treeObjectState.selectAllCheckedState = drawFieldScopeCheck(treeObjectState.selectAllElement, treeObjectState.selectAllCheckElement as HTMLElement, counts.all, isObjectExcluded, objectApiName, RECIPE_COCKPIT_SELECT_ALL_FIELDS_LABEL, 'field', 'fields');
    treeObjectState.selectStandardCheckedState = drawFieldScopeCheck(treeObjectState.selectStandardElement as HTMLButtonElement, treeObjectState.selectStandardCheckElement as HTMLElement, counts.standard, isObjectExcluded, objectApiName, RECIPE_COCKPIT_STANDARD_FIELDS_LABEL, 'standard field', 'standard fields');

}

/*
    A field box over a set of fields (#410, #477): ticked when every field of the set the reader can
    untick is ticked, unticked when none is, mixed otherwise. Hidden when the set has no field the
    reader can untick, and never toggled here: only the host's answer redraws it.
*/
function drawFieldScopeCheck(toggleElement: HTMLButtonElement, checkElement: HTMLElement, count: IFieldScopeCount, isObjectExcluded: boolean, objectApiName: string,
                                labelText: string, singular: string, plural: string): FieldScopeCheckedState {

    if (count.untickable === 0) {
        checkElement.classList.add('hidden');
        return null;
    }
    checkElement.classList.remove('hidden');

    const checkedState = count.ticked === count.untickable ? 'true' : count.ticked === 0 ? 'false' : 'mixed';
    toggleElement.textContent = checkedState === 'true' ? '✓' : checkedState === 'mixed' ? '−' : '';
    toggleElement.setAttribute('aria-checked', checkedState);
    toggleElement.disabled = isObjectExcluded;
    if (isObjectExcluded) { checkElement.classList.add('disabled'); } else { checkElement.classList.remove('disabled'); }

    const title = isObjectExcluded ? describeExcludedObjectFields(objectApiName)
        : checkedState === 'true' ? 'Every ' + singular + ' ticked — click to leave every ' + singular + ' out that can be unticked'
        : checkedState === 'mixed' ? count.ticked + ' of ' + count.untickable + ' ' + plural + ' ticked — click to tick every ' + singular
        : 'No ' + singular + ' ticked — click to tick every ' + singular;
    toggleElement.setAttribute('title', title);
    toggleElement.setAttribute('aria-label', labelText + ' of ' + objectApiName + ': ' + title);

    return checkedState;

}

/*
    The object's own "Hide unselected" (#483): hides THIS object's rows whose box is unticked, the
    ones an excluded parent cut included, with the search and every "TODOs only". Panel-only: it
    posts nothing, and only the host's answer unticks a field, so a row hides once that answer is
    drawn. With nothing unticked, or the object excluded, it is off and disabled.
*/
function countUnselectedFields(treeObjectState: IFieldRowObjectState): number {

    if (!treeObjectState.canSelectFields) { return 0; }

    const objectFieldSelection = findObjectFieldSelection(treeObjectState.tree, treeObjectState.object.objectApiName, occurrenceNicknameOf(treeObjectState.object));
    if (!objectFieldSelection) { return 0; }

    return treeObjectState.fieldStates.filter(function (fieldState) {
        return !!fieldState.field.lineNumber && isTreeFieldUnticked(objectFieldSelection, fieldState.field.fieldApiName);
    }).length;

}

export function describeExcludedObjectFields(objectApiName: string): string {
    return objectApiName + ' is excluded, so its fields are read-only';
}

// THE REASON IT IS OFF, OR '' WITH HOW MANY ROWS IT HIDES: ONE COUNT PER DRAW
function readHideUnselectedState(treeObjectState: IFieldRowObjectState): IHideUnselectedState {
    if (findFieldLockingExclusion(treeObjectState.tree, treeObjectState.object.objectApiName)) { return { reason: describeExcludedObjectFields(treeObjectState.object.objectApiName), unselectedCount: 0 }; }
    const unselectedCount = countUnselectedFields(treeObjectState);
    return { reason: unselectedCount === 0 ? RECIPE_COCKPIT_NO_UNSELECTED_FIELDS_NOTE : '', unselectedCount: unselectedCount };
}

export function findHideUnselectedReason(treeObjectState: IFieldRowObjectState): string {
    return readHideUnselectedState(treeObjectState).reason;
}

export function isObjectHidingUnselectedIn(treeObjectState: IFieldRowObjectState): boolean {
    return treeObjectState.isHidingUnselected === true;
}

function buildHideUnselectedToggle(treeObjectState: IFieldRowObjectState): HTMLElement {

    const objectApiName = treeObjectState.object.objectApiName;
    const checkElement = createElement('span', 'treeFieldSelectAllCheck treeHideUnselectedCheck');
    const toggleElement = createButton('check', 'treeHideUnselectedToggle');
    const labelElement = createElement('span', 'treeHideUnselectedLabel', RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL);
    toggleElement.setAttribute('role', 'checkbox');
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL + ' (' + objectApiName + ')');

    const toggleHideUnselected = function (): void {
        if (toggleElement.disabled) { return; }
        treeObjectState.isHidingUnselected = !treeObjectState.isHidingUnselected;
        if (treeObjectState.treeState.structureSearch) {
            filterTreeObjectRows(treeObjectState.treeState, treeObjectState);
            drawStructureMatchCount(treeObjectState.treeState);
        }
        drawHideUnselectedToggle(treeObjectState);
        savePanelPlace();
    };
    toggleElement.addEventListener('click', toggleHideUnselected);
    labelElement.addEventListener('click', toggleHideUnselected);

    treeObjectState.hideUnselectedCheckElement = checkElement;
    treeObjectState.hideUnselectedLabelElement = labelElement;
    treeObjectState.hideUnselectedToggleElement = toggleElement;
    checkElement.appendChild(toggleElement);
    checkElement.appendChild(labelElement);
    drawHideUnselectedToggle(treeObjectState);

    return checkElement;

}

export function drawHideUnselectedToggle(treeObjectState: IFieldRowObjectState, hideUnselectedState?: IHideUnselectedState): void {

    const toggleElement = treeObjectState.hideUnselectedToggleElement;
    if (!toggleElement) { return; }

    const state = hideUnselectedState || readHideUnselectedState(treeObjectState);
    const reason = state.reason;
    const unselectedCount = state.unselectedCount;
    const isChecked = isObjectHidingUnselectedIn(treeObjectState);
    const title = reason || ( isChecked
        ? 'Hiding ' + pluralize(unselectedCount, 'unticked field', 'unticked fields') + ' of ' + treeObjectState.object.objectApiName + ' — click to show them'
        : 'Hide the ' + pluralize(unselectedCount, 'unticked field', 'unticked fields') + ' of ' + treeObjectState.object.objectApiName );

    toggleElement.textContent = isChecked ? '✓' : '';
    toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    toggleElement.disabled = !!reason;
    toggleElement.setAttribute('title', title);
    ( treeObjectState.hideUnselectedLabelElement as HTMLElement ).setAttribute('title', title);
    const checkElement = treeObjectState.hideUnselectedCheckElement as HTMLElement;
    if (reason) { checkElement.classList.add('disabled'); } else { checkElement.classList.remove('disabled'); }

}

/*
    After the host's answer: a filter with nothing left to hide turns itself off, so the next
    untick shows its row until the reader asks again. True when the object's rows were filtered
    again, so the caller redraws the tab's count once.
*/
function refreshHideUnselectedFields(treeObjectState: IFieldRowObjectState): boolean {

    const wasHiding = isObjectHidingUnselectedIn(treeObjectState);
    if (!wasHiding && !treeObjectState.hideUnselectedToggleElement) { return false; }

    const hideUnselectedState = readHideUnselectedState(treeObjectState);
    if (wasHiding && hideUnselectedState.reason) {
        treeObjectState.isHidingUnselected = false;
        // A SAVED KEY WOULD TURN IT BACK ON AT THE NEXT RESTORE, OVER ROWS THE READER SAW SHOWN
        savePanelPlace();
    }
    drawHideUnselectedToggle(treeObjectState, hideUnselectedState);

    if (!wasHiding || !treeObjectState.treeState || !treeObjectState.treeState.structureSearch) { return false; }

    filterTreeObjectRows(treeObjectState.treeState, treeObjectState);
    return true;

}
