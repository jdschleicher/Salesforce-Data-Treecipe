import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH,
    RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES,
    RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES,
    RECIPE_COCKPIT_LOOKUP_ID_EDIT_HINT,
    RECIPE_COCKPIT_LOOKUP_ID_PLACEHOLDER
} from '../../../RecipeCockpitTreecipeFieldEditorConstants';
import type { FieldEditorPanelMessage, IFieldEditResultMessage, ISetFieldFixedValueMessage, ITreeFieldState, ITreeObjectState, ITreeState, ITreecipeField, ITreecipeObject, ITreecipeTree } from './FieldEditorTypes';
import { renderPicklistChoiceResult } from './PicklistTiles';

/*
    The Treecipe tab's inline field editor (#337, #356, #653). These names are the panel script's
    own, read when a function runs; the field row that opens the editor is drawn there (#643's 3e-4).
*/
declare const vscodeApi: { postMessage(message: FieldEditorPanelMessage): void };
declare const renderedSequence: number | null;
declare function findTreeState(treeKey: unknown): ITreeState | null;
declare function drawFieldRowFixedValue(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): void;
declare function isLookupField(tree: ITreecipeTree, objectApiName: string, field: ITreecipeField): boolean;
declare function findFixedValue(tree: ITreecipeTree, objectApiName: string, fieldApiName: string, nickname: string): string | null;
declare function occurrenceNicknameOf(object: ITreecipeObject): string;
declare function findEditorStartValue(tree: ITreecipeTree, object: ITreecipeObject, field: ITreecipeField): string;
declare function isExpressionValue(value: unknown): boolean;

/*
    A field's inline editor (#337, one box since #356) under the row, with Save, Clear and
    Cancel. Enter saves and Escape cancels. Save posts the NAMES the edit button always posted
    plus what was typed; the host checks it against the field again and answers with
    fieldEditResult -- a refusal is written under the box with textContent and the editor stays
    open, a save closes it once the card has been redrawn. Clicking the button again closes it.
*/
export function toggleFieldEditor(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState, edit: string): void {

    const isSameEditOpen = fieldState.editorEdit === edit;
    closeFieldEditor(fieldState);
    if (!isSameEditOpen) { openFieldEditor(treeObjectState, fieldState, edit); }
    drawFieldRowFixedValue(treeObjectState, fieldState);

}

export function closeFieldEditor(fieldState: ITreeFieldState): void {

    if (!fieldState.editorElement || !fieldState.editorEdit) { return; }

    const openerElement = fieldState.fixedValueButtonElement;
    fieldState.editorElement.textContent = '';
    fieldState.editorElement.classList.add('hidden');
    fieldState.editorEdit = '';
    fieldState.editorRefusalElement = null;
    if (openerElement) {
        openerElement.setAttribute('aria-expanded', 'false');
        if (!openerElement.disabled && typeof openerElement.focus === 'function') { openerElement.focus(); }
    }

}

// THE ADAPTER'S EDITOR (#641) SAYS THE SAME, SO IT IMPORTS THIS
export function describeFixedValueForm(field: { fieldApiName: string; fieldType?: string; isPicklist?: boolean }): string {

    if (field.fieldType === 'Checkbox') { return 'Type true or false.'; }
    if (field.fieldType === 'Date') { return 'Type a date as YYYY-MM-DD, such as 2026-01-31.'; }
    if (field.fieldType === 'DateTime') { return 'Type a date and time as ISO 8601 with a zone, such as 2026-01-31T09:30:00Z.'; }
    if (RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES.indexOf(String(field.fieldType)) !== -1) { return 'Type a plain number, such as 42, -7 or 3.25.'; }
    const geolocationComponent = field.fieldType === 'Text'
        ? Object.keys(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES).find(function (componentKey) { return field.fieldApiName.endsWith(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[componentKey].suffix); })
        : undefined;
    if (geolocationComponent !== undefined) {
        const limit = RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[geolocationComponent].limit;
        return 'Type a ' + geolocationComponent.toLowerCase() + ' from -' + limit + ' to ' + limit + '.';
    }
    if (field.fieldType === 'MultiselectPicklist') { return 'Type values this picklist declares, separated by ;.'; }
    if (field.isPicklist) { return 'Type a value this picklist declares.'; }
    return 'Type the text every record gets.';

}

export function buildFieldEditorInput(maxLength: number, value: string, ariaLabel: string, placeholder: string): HTMLInputElement {

    const inputElement = createElement('input', 'fieldEditorInput');
    inputElement.setAttribute('type', 'text');
    inputElement.setAttribute('maxlength', String(maxLength));
    inputElement.setAttribute('aria-label', ariaLabel);
    if (placeholder) { inputElement.setAttribute('placeholder', placeholder); }
    inputElement.value = value;

    return inputElement;

}

function openFieldEditor(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState, edit: string): void {

    if (!fieldState.rowElement) { return; }

    const field = fieldState.field;
    const tree = treeObjectState.tree;
    const object = treeObjectState.object;
    const fieldLabel = object.objectApiName + '.' + field.fieldApiName;

    if (!fieldState.editorElement) {
        fieldState.editorElement = createElement('div', 'fieldEditor hidden');
        fieldState.editorElement.setAttribute('role', 'group');
        // THE EDITOR EDITS THE FAKER VALUE, SO IT OPENS UNDER IT, ABOVE A PICKLIST'S EDIT VALUES (#398)
        fieldState.rowElement.insertBefore(fieldState.editorElement, fieldState.picklistSectionElement);
    }

    const editorElement = fieldState.editorElement;
    const inputsElement = createElement('div', 'fieldEditorInputs');

    // A LOOKUP (#627) TAKES ONE RECORD'S Id, SO IT STARTS FROM THE Id IT HOLDS, NEVER FROM ITS TODO OR NICKNAME
    const isLookup = isLookupField(tree, object.objectApiName, field);
    editorElement.setAttribute('aria-label', 'Edit ' + fieldLabel);
    const valueElement = isLookup
        ? buildFieldEditorInput(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH, findFixedValue(tree, object.objectApiName, field.fieldApiName, occurrenceNicknameOf(object)) || '', 'Record Id for ' + fieldLabel, RECIPE_COCKPIT_LOOKUP_ID_PLACEHOLDER)
        : buildFieldEditorInput(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH, findEditorStartValue(tree, object, field), 'Value or faker expression for ' + fieldLabel, '');
    inputsElement.appendChild(valueElement);
    const collectTypedValue = function (isClearing: boolean): string {
        const typedValue = String(valueElement.value);
        return isClearing ? '' : isLookup || isExpressionValue(typedValue.trim()) ? typedValue.trim() : typedValue;
    };

    // THE HINT SAYS WHICH OF THE TWO SAVE WRITES, AS THE READER TYPES
    const describeEdit = function (): string {
        if (isLookup) { return RECIPE_COCKPIT_LOOKUP_ID_EDIT_HINT; }
        return ( isExpressionValue(String(valueElement.value).trim())
            ? 'Saved as a faker expression: one ${{ ... }} on one line. Change its arguments, or call another faker method.'
            : 'Saved as a fixed value. ' + describeFixedValueForm(field) + ' Start with ${{ to save a faker expression instead.' )
            + ' Save writes it into the recipe file; Clear puts back the lines the field had.';
    };
    const hintElement = createElement('div', 'fieldEditorHint muted', describeEdit());
    valueElement.addEventListener('input', function () { hintElement.textContent = describeEdit(); });
    const refusalElement = createElement('div', 'fieldEditorRefusal hidden');
    refusalElement.setAttribute('role', 'alert');

    const post = function (isClearing: boolean): void {
        const message: ISetFieldFixedValueMessage = {
            command: 'setFieldFixedValue',
            treeKey: tree.treeKey,
            objectApiName: object.objectApiName,
            fieldApiName: field.fieldApiName,
            value: collectTypedValue(isClearing)
        };
        if (object.nickname) { message.nickname = object.nickname; }
        refusalElement.textContent = '';
        refusalElement.classList.add('hidden');
        vscodeApi.postMessage(message);
    };

    const actionsElement = createElement('div', 'fieldEditorActions');
    const saveElement = createButton('primary', 'fieldEditorSave', 'Save', 'compact');
    const clearElement = createButton('secondary', 'fieldEditorClear', 'Clear', 'compact');
    const cancelElement = createButton('secondary', 'fieldEditorCancel', 'Cancel', 'compact');
    saveElement.addEventListener('click', function (event) { event.stopPropagation(); post(false); });
    clearElement.addEventListener('click', function (event) { event.stopPropagation(); post(true); });
    cancelElement.addEventListener('click', function (event) { event.stopPropagation(); toggleFieldEditor(treeObjectState, fieldState, edit); });
    actionsElement.appendChild(saveElement);
    actionsElement.appendChild(clearElement);
    actionsElement.appendChild(cancelElement);

    valueElement.addEventListener('keydown', function (event) {
        // AN IME COMPOSING CJK TEXT CONFIRMS A CANDIDATE WITH ENTER, WHICH IS NOT A SAVE
        if (event.isComposing) { return; }
        if (event.key === 'Enter') { event.stopPropagation(); post(false); }
        if (event.key === 'Escape') { event.stopPropagation(); toggleFieldEditor(treeObjectState, fieldState, edit); }
    });

    editorElement.textContent = '';
    editorElement.appendChild(inputsElement);
    editorElement.appendChild(hintElement);
    editorElement.appendChild(refusalElement);
    editorElement.appendChild(actionsElement);
    editorElement.classList.remove('hidden');
    fieldState.editorEdit = edit;
    fieldState.editorRefusalElement = refusalElement;

    if (typeof valueElement.focus === 'function') { valueElement.focus(); }

}

// HOW AN INLINE EDIT ENDED (#337), FOR THE MODEL ON SCREEN: A REFUSAL UNDER THE BOXES, OR THE EDITOR CLOSED
export function renderFieldEditResult(fieldEditResultMessage: IFieldEditResultMessage): void {

    if (renderedSequence === null || fieldEditResultMessage.renderSequence !== renderedSequence) { return; }
    if (fieldEditResultMessage.edit === 'picklistValues') { renderPicklistChoiceResult(fieldEditResultMessage); return; }

    const treeState = findTreeState(fieldEditResultMessage.treeKey);
    if (!treeState) { return; }

    treeState.objectStates.forEach(function (treeObjectState) {
        if (treeObjectState.object.objectApiName !== fieldEditResultMessage.objectApiName) { return; }
        treeObjectState.fieldStates.forEach(function (fieldState) {
            if (fieldState.field.fieldApiName !== fieldEditResultMessage.fieldApiName || fieldState.editorEdit !== fieldEditResultMessage.edit) { return; }
            if (typeof fieldEditResultMessage.refusal === 'string' && fieldState.editorRefusalElement) {
                fieldState.editorRefusalElement.textContent = fieldEditResultMessage.refusal;
                fieldState.editorRefusalElement.classList.remove('hidden');
                return;
            }
            toggleFieldEditor(treeObjectState, fieldState, fieldState.editorEdit);
        });
    });

}

export function buildTreeFieldState(field: ITreecipeField): ITreeFieldState {

    return {
        field: field,
        typeSearchText: String(field.fieldTypeWithSize || field.fieldType || '').toLowerCase(),
        isMatch: true,
        rowElement: null,
        isPicklistExpanded: false,
        includeElement: null,
        noteElement: null,
        isIncluded: true,
        fixedValueButtonElement: null,
        fixedValueBadgeElement: null,
        fixedValueElement: null,
        expressionElement: null,
        picklistSectionElement: null,
        validationRuleElement: null,
        isValidationRuleApplied: true,
        recordTypeDeveloperNames: null,
        todos: Array.isArray(field.todos) ? field.todos : [],
        editorElement: null,
        editorEdit: '',
        editorRefusalElement: null,
        setPicklistExpanded: null,
        picklistRefusalElement: null,
        endPicklistSave: null
    };

}
