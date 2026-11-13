import { createButton, createElement, setShown } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_UPDATER_VALUE_EDIT_HINT } from '../../RecipeCockpitAdapterConstants';
import { buildPencilGlyph } from '../RecipeCockpitPanelBuilders';
import type { IAdapterField, IAdapterObjectName, IAdapterTreeKey, IUpdaterFieldObjectState, IUpdaterFieldRowState, IUpdaterFieldTreeState } from './AdapterTypes';

/*
    The Treecipe Adapter's field editor (#417, #641). These names are the panel script's own, read
    when a function runs. The editor shares no editor code with the Treecipe tab's (openFieldEditor):
    it calls that tab's input, form hint and expression helpers, which the Treecipe tab's slice (#643)
    moves into a module this one then imports.
*/
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function findFixedValue(tree: IAdapterTreeKey, objectApiName: string, fieldApiName: string, nickname: string): string | null;
declare function occurrenceNicknameOf(object: IAdapterObjectName): string;
declare function isExpressionValue(value: unknown): boolean;
declare function unquoteExpressionLine(valueLine: string): string;
declare function buildFieldEditorInput(maxLength: number, value: string, ariaLabel: string, placeholder: string): HTMLInputElement;
declare function describeFixedValueForm(field: IAdapterField): string;
declare const FIXED_VALUE_MAX_LENGTH: number;
declare const FIXED_VALUE_BADGE_LABEL: string;
declare const EDITED_EXPRESSION_BADGE_LABEL: string;

/*
    The Updater's own editor (#417): the Treecipe tab's inline editor's parts -- one input, its
    hint and Save / Clear / Cancel -- but Save keeps the value in this card's panel state ONLY.
    Nothing is written to the recipe: the value is posted with Generate values, where the host
    checks it as a pin's value is checked and shows it in the confirmation before anything runs.
*/
export function buildUpdaterFieldEditElement(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): HTMLButtonElement {

    const buttonElement = createButton('icon', 'updaterFieldEdit');
    buttonElement.appendChild(buildPencilGlyph('default'));
    buttonElement.setAttribute('aria-expanded', 'false');

    buttonElement.addEventListener('click', function () {
        if (buttonElement.disabled) { return; }
        if (fieldState.isEditorOpen) {
            closeUpdaterFieldEditor(fieldState);
        } else {
            openUpdaterFieldEditor(treeState, updaterObjectState, fieldState);
        }
    });
    fieldState.editButtonElement = buttonElement;

    return buttonElement;

}

// WHAT A FIELD GENERATES FROM WITH NOTHING TYPED, AS THE HOST READS IT: A TREECIPE-TAB EDIT IN THE RECIPE FILE, ELSE THE FIRST EXPRESSION LINE
// THE ADAPTER DRAWS EACH OBJECT ONCE, SO IT READS THE FIRST OCCURRENCE'S EDIT (#467)
function findUpdaterRecipeStartValue(tree: IAdapterTreeKey, object: IAdapterObjectName, field: IAdapterField): string {

    const recipeFileEdit = findFixedValue(tree, object.objectApiName, field.fieldApiName, occurrenceNicknameOf(object));
    if (recipeFileEdit !== null) { return recipeFileEdit; }

    const valueLines = String(field.recipeValue || '').split('\n').map(function (valueLine) { return unquoteExpressionLine(valueLine.trim()); });
    const expressionLine = valueLines.find(function (valueLine) { return isExpressionValue(valueLine); });

    return expressionLine !== undefined ? expressionLine : '';

}

function findUpdaterEditStartValue(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): string {

    if (hasOwnKey(treeState.updaterEditedValues, fieldState.fieldKey)) { return treeState.updaterEditedValues[fieldState.fieldKey]; }

    return findUpdaterRecipeStartValue(treeState.tree, updaterObjectState.object, fieldState.field);

}

function openUpdaterFieldEditor(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): void {

    if (!fieldState.rowElement) { return; }

    const field = fieldState.field;
    const fieldLabel = updaterObjectState.object.objectApiName + '.' + field.fieldApiName;
    const recipeStartValue = findUpdaterRecipeStartValue(treeState.tree, updaterObjectState.object, field);

    // BUILT ONCE PER ROW AND EMPTIED ON CLOSE, AS THE TREECIPE TAB'S EDITOR IS
    if (!fieldState.editorElement) {
        fieldState.editorElement = createElement('div', 'fieldEditor updaterFieldEditor hidden');
        fieldState.editorElement.setAttribute('role', 'group');
        fieldState.rowElement.appendChild(fieldState.editorElement);
    }

    const editorElement = fieldState.editorElement;
    const inputsElement = createElement('div', 'fieldEditorInputs');
    const valueElement = buildFieldEditorInput(FIXED_VALUE_MAX_LENGTH, findUpdaterEditStartValue(treeState, updaterObjectState, fieldState), 'New value or faker expression for ' + fieldLabel, '');

    editorElement.setAttribute('aria-label', 'New value for ' + fieldLabel);
    inputsElement.appendChild(valueElement);

    const describeEdit = function (): string {
        return ( isExpressionValue(String(valueElement.value).trim())
            ? 'Generated from this faker expression for every loaded record.'
            : 'This fixed value for every loaded record. ' + describeFixedValueForm(field) + ' Start with ${{ to generate from a faker expression instead.' )
            + ' ' + RECIPE_COCKPIT_UPDATER_VALUE_EDIT_HINT;
    };
    const hintElement = createElement('div', 'fieldEditorHint muted', describeEdit());
    valueElement.addEventListener('input', function () { hintElement.textContent = describeEdit(); });

    const save = function (): void {
        const typedValue = String(valueElement.value);
        const value = isExpressionValue(typedValue.trim()) ? typedValue.trim() : typedValue;
        // THE RECIPE'S OWN EXPRESSION, OR NOTHING, IS NO EDIT: THE FIELD GENERATES FROM ITS RECIPE
        if (value === '' || value === recipeStartValue) {
            delete treeState.updaterEditedValues[fieldState.fieldKey];
        } else {
            treeState.updaterEditedValues[fieldState.fieldKey] = value;
        }
        closeUpdaterFieldEditor(fieldState);
        drawUpdaterFieldEdit(treeState, updaterObjectState, fieldState);
    };

    const actionsElement = createElement('div', 'fieldEditorActions');
    const saveElement = createButton('primary', 'fieldEditorSave', 'Save', 'compact');
    const clearElement = createButton('secondary', 'fieldEditorClear', 'Clear', 'compact');
    const cancelElement = createButton('secondary', 'fieldEditorCancel', 'Cancel', 'compact');
    saveElement.addEventListener('click', function (event) { event.stopPropagation(); save(); });
    clearElement.addEventListener('click', function (event) {
        event.stopPropagation();
        delete treeState.updaterEditedValues[fieldState.fieldKey];
        closeUpdaterFieldEditor(fieldState);
        drawUpdaterFieldEdit(treeState, updaterObjectState, fieldState);
    });
    cancelElement.addEventListener('click', function (event) { event.stopPropagation(); closeUpdaterFieldEditor(fieldState); });
    valueElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); save(); }
        if (event.key === 'Escape') { event.preventDefault(); closeUpdaterFieldEditor(fieldState); }
    });
    actionsElement.appendChild(saveElement);
    actionsElement.appendChild(clearElement);
    actionsElement.appendChild(cancelElement);

    editorElement.appendChild(inputsElement);
    editorElement.appendChild(hintElement);
    editorElement.appendChild(actionsElement);
    editorElement.classList.remove('hidden');
    fieldState.isEditorOpen = true;
    if (fieldState.editButtonElement) { fieldState.editButtonElement.setAttribute('aria-expanded', 'true'); }
    if (typeof valueElement.focus === 'function') { valueElement.focus(); }

}

function closeUpdaterFieldEditor(fieldState: IUpdaterFieldRowState): void {

    if (!fieldState.editorElement || !fieldState.isEditorOpen) { return; }

    fieldState.editorElement.textContent = '';
    fieldState.editorElement.classList.add('hidden');
    fieldState.isEditorOpen = false;
    if (fieldState.editButtonElement) {
        fieldState.editButtonElement.setAttribute('aria-expanded', 'false');
        if (typeof fieldState.editButtonElement.focus === 'function') { fieldState.editButtonElement.focus(); }
    }

}

// A TYPED VALUE TAKES THE EXPRESSION'S PLACE ON THE ROW, WRITTEN WITH textContent; THE PENCIL SAYS SO BY SHAPE, aria-pressed AND TITLE
export function drawUpdaterFieldEdit(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): void {

    const isEdited = hasOwnKey(treeState.updaterEditedValues, fieldState.fieldKey);
    const editedValue = isEdited ? treeState.updaterEditedValues[fieldState.fieldKey] : '';
    const fieldName = updaterObjectState.object.objectApiName + '.' + fieldState.field.fieldApiName;
    const hasNoExpression = !isEdited && findUpdaterEditStartValue(treeState, updaterObjectState, fieldState) === '';

    if (fieldState.editedValueElement) {
        fieldState.editedValueElement.textContent = editedValue;
        setShown(fieldState.editedValueElement, isEdited);
    }
    if (fieldState.expressionRowElement) { setShown(fieldState.expressionRowElement, !isEdited); }
    if (fieldState.editBadgeElement) {
        fieldState.editBadgeElement.textContent = !isEdited ? '' : isExpressionValue(editedValue) ? EDITED_EXPRESSION_BADGE_LABEL : FIXED_VALUE_BADGE_LABEL;
        setShown(fieldState.editBadgeElement, isEdited);
    }
    if (fieldState.editButtonElement) {
        const title = isEdited
            ? 'New value: ' + editedValue + ' — click to change it'
            : hasNoExpression ? 'Its recipe has no faker expression for it: click to type a value or an expression'
            : 'Click to type a fixed value, or edit the faker expression, for this field’s new values';
        fieldState.editButtonElement.setAttribute('aria-pressed', isEdited ? 'true' : 'false');
        fieldState.editButtonElement.setAttribute('title', title);
        fieldState.editButtonElement.setAttribute('aria-label', fieldName + ': ' + title);
    }

}
