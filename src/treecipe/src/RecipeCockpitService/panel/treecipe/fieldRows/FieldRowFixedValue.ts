import { createButton } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_EDITED_EXPRESSION_BADGE_LABEL,
    RECIPE_COCKPIT_EXPRESSION_OPENER,
    RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_ORG_RECORD_BADGE_PREFIX
} from '../../../RecipeCockpitFieldRowsConstants';
import { buildPencilGlyph } from '../../RecipeCockpitPanelBuilders';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { closeFieldEditor, toggleFieldEditor } from '../fieldEditor/FieldEditor';
import { findObjectExclusion, findObjectFieldSelection, isSameOccurrence, occurrenceNicknameOf } from './SelectionCascade';
import type { ITreeFieldState, ITreeObjectState } from '../fieldEditor/FieldEditorTypes';
import type { IFixedValueOrgRecord, ISelectionTree } from './FieldRowTypes';

/*
    A field row's pencil and the value it pins (#262, #337, #356, #421, #627): what the host says the
    card generates the field with, the badge that says whose value it is, and why the pencil is
    disabled. Every value is written with textContent; the host re-derives each lock before it writes.
*/

// THE VALUE THE HOST SAYS THIS CARD GENERATES THE FIELD WITH (#262), OR null
export function findFixedValue(tree: ISelectionTree, objectApiName: string, fieldApiName: string, nickname: string | undefined): string | null {

    const fixedValues = Array.isArray(tree.fixedValues) ? tree.fixedValues : [];
    const fixedValue = fixedValues.find(function (candidate) { return isSameOccurrence(candidate, objectApiName, nickname) && candidate.fieldApiName === fieldApiName; });

    return fixedValue ? String(fixedValue.value) : null;

}

// EVERY LOOKUP OF A CARD, ONCE PER CARD: A ROW ASKS ON EVERY REDRAW, AND SCANNING THE TREE PER ROW WAS O(ROWS x OBJECTS)
const lookupFieldIndexesByTree = new WeakMap<object, Record<string, true>>();

export function indexTreeLookupFields(tree: { objects: Array<{ objectApiName: string; parentLookups: Array<{ fieldApiName: string }> }> }): Record<string, true> {

    const indexedLookupFields = lookupFieldIndexesByTree.get(tree);
    if (indexedLookupFields) { return indexedLookupFields; }

    const lookupFieldKeys: Record<string, true> = Object.create(null);
    tree.objects.forEach(function (treeObject) {
        treeObject.parentLookups.forEach(function (parentLookup) { lookupFieldKeys[treeObject.objectApiName + '\n' + parentLookup.fieldApiName] = true; });
    });
    lookupFieldIndexesByTree.set(tree, lookupFieldKeys);

    return lookupFieldKeys;

}

// THE HOST'S isLookupField: A LOOKUP'S PENCIL (#627) TAKES A RECORD Id
export function isLookupField(tree: Parameters<typeof indexTreeLookupFields>[0], objectApiName: string, field: { fieldApiName: string; fieldType?: string }): boolean {
    return RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES.indexOf(field.fieldType as string) !== -1 || hasOwnKey(indexTreeLookupFields(tree), objectApiName + '\n' + field.fieldApiName);
}

/*
    Why a field's pin is disabled (#262): the host's own rule (findFixedValueLockReason), drawn
    from the model the panel already holds. The host re-derives it before it writes anything.
*/
export function findFixedValueLockReason(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): string {

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const field = fieldState.field;
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, occurrenceNicknameOf(treeObjectState.object));

    if (findObjectExclusion(tree, objectApiName)) { return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON; }
    if (objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, field.fieldApiName)) { return objectFieldSelection.lockReasonsByFieldApiName[field.fieldApiName]; }
    if (objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, field.fieldApiName)) { return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON; }
    if (field.fieldApiName === 'RecordTypeId') { return RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON; }

    if (field.controllingField) { return RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX + field.controllingField; }

    return '';

}

// THE ORG A LOOKUP'S PINNED Id CAME FROM (#421), AS THE HOST SAYS; null FOR ANY OTHER FIXED VALUE
function findFixedValueOrgRecord(tree: ISelectionTree, objectApiName: string, fieldApiName: string, nickname: string): IFixedValueOrgRecord | null {
    const fixedValues = Array.isArray(tree.fixedValues) ? tree.fixedValues : [];
    const fixedValue = fixedValues.find(function (candidate) { return isSameOccurrence(candidate, objectApiName, nickname) && candidate.fieldApiName === fieldApiName; });
    return fixedValue && fixedValue.orgRecord ? fixedValue.orgRecord : null;
}

export function isExpressionValue(value: unknown): value is string {
    return typeof value === 'string' && value.indexOf(RECIPE_COCKPIT_EXPRESSION_OPENER) === 0;
}

// A DOUBLE-QUOTED "${{ ... }}" (A VALIDATION RULE'S, OR AN EARLIER EDIT'S) STARTS THE EDITOR AS THE EXPRESSION IT HOLDS
export function unquoteExpressionLine(valueLine: string): string {
    if (valueLine.length < 2 || valueLine.charAt(0) !== '"' || valueLine.charAt(valueLine.length - 1) !== '"') { return valueLine; }
    try {
        const unquoted: unknown = JSON.parse(valueLine);
        return isExpressionValue(unquoted) ? unquoted : valueLine;
    } catch (parseError) {
        return valueLine;
    }
}

/*
    The value the editor starts from (#356): what the field holds now -- an edit the host says the
    card generates with, else the first "${{ ... }}" line of its recipe value (a picklist's
    record type variants follow it as comments), else that value's first line.
*/
export function findEditorStartValue(tree: ISelectionTree, object: { objectApiName: string; nickname?: string; iteration?: unknown; iterations?: unknown }, field: { fieldApiName: string; recipeValue?: unknown }): string {

    const fixedValue = findFixedValue(tree, object.objectApiName, field.fieldApiName, occurrenceNicknameOf(object));
    if (fixedValue !== null) { return fixedValue; }

    const valueLines = String(field.recipeValue || '').split('\n').map(function (valueLine) { return unquoteExpressionLine(valueLine.trim()); });
    const expressionLine = valueLines.find(function (valueLine) { return isExpressionValue(valueLine); });
    if (expressionLine !== undefined) { return expressionLine; }

    return valueLines.find(function (valueLine) { return valueLine !== '' && valueLine !== '|'; }) || '';

}

// AN EDIT TAKES THE EXPRESSION'S PLACE ON THE ROW, WRITTEN WITH textContent, AND THE PENCIL SAYS SO BY SHAPE, aria-pressed AND TITLE
export function drawFieldRowFixedValue(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): void {

    const objectApiName = treeObjectState.object.objectApiName;
    const fieldApiName = fieldState.field.fieldApiName;
    const nickname = occurrenceNicknameOf(treeObjectState.object);
    const fixedValue = findFixedValue(treeObjectState.tree, objectApiName, fieldApiName, nickname);
    const isFixed = fixedValue !== null;
    const orgRecord = isFixed ? findFixedValueOrgRecord(treeObjectState.tree, objectApiName, fieldApiName, nickname) : null;

    if (fieldState.fixedValueElement) {
        fieldState.fixedValueElement.textContent = isFixed ? fixedValue : '';
        if (isFixed) { fieldState.fixedValueElement.classList.remove('hidden'); } else { fieldState.fixedValueElement.classList.add('hidden'); }
    }
    if (fieldState.fixedValueBadgeElement) {
        fieldState.fixedValueBadgeElement.textContent = orgRecord ? RECIPE_COCKPIT_ORG_RECORD_BADGE_PREFIX + orgRecord.orgLabel
            : isFixed && isExpressionValue(fixedValue) ? RECIPE_COCKPIT_EDITED_EXPRESSION_BADGE_LABEL : RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL;
        // AN ORG RECORD IS NOT GENERATED DATA (#421): THE BADGE AND ITS TOOLTIP SAY WHOSE RECORD IT IS
        if (orgRecord) {
            fieldState.fixedValueBadgeElement.classList.add('orgRecordBadge');
            fieldState.fixedValueBadgeElement.setAttribute('title', 'An existing ' + orgRecord.parentObjectApiName + ' record of ' + orgRecord.orgLabel + ', not generated data. The Id exists only in that org; the insert checks it exists in the org it inserts into.');
        } else {
            fieldState.fixedValueBadgeElement.classList.remove('orgRecordBadge');
            fieldState.fixedValueBadgeElement.removeAttribute('title');
        }
        if (isFixed) { fieldState.fixedValueBadgeElement.classList.remove('hidden'); } else { fieldState.fixedValueBadgeElement.classList.add('hidden'); }
    }
    if (fieldState.expressionElement) {
        if (isFixed) { fieldState.expressionElement.classList.add('hidden'); } else { fieldState.expressionElement.classList.remove('hidden'); }
    }
    const buttonElement = fieldState.fixedValueButtonElement;
    if (!buttonElement) { return; }

    const lockReason = findFixedValueLockReason(treeObjectState, fieldState);
    buttonElement.disabled = !!lockReason;
    buttonElement.setAttribute('aria-pressed', isFixed ? 'true' : 'false');
    buttonElement.setAttribute('aria-expanded', fieldState.editorEdit === 'fixedValue' ? 'true' : 'false');
    if (buttonElement.disabled && fieldState.editorEdit === 'fixedValue') { closeFieldEditor(fieldState); }

    const title = lockReason ? 'Cannot be edited: ' + lockReason
        : orgRecord ? 'Existing ' + orgRecord.parentObjectApiName + ' record of ' + orgRecord.orgLabel + ' — click to change or clear it'
        : isFixed ? ( isExpressionValue(fixedValue) ? 'Edited expression' : 'Fixed value' ) + ' — click to change or clear it'
        : isLookupField(treeObjectState.tree, treeObjectState.object.objectApiName, fieldState.field) ? 'Give the lookup the Id of an existing record'
        : 'Edit the faker expression, or give the field a fixed value';
    buttonElement.setAttribute('title', title);
    buttonElement.setAttribute('aria-label', fieldApiName + ': ' + title);

}

/*
    A field's edit button (#356): a real button, keyboard operable, its glyph built node by node
    like the chain link. A click opens its inline editor (#337) under the row.
*/
export function buildFieldFixedValueElement(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): HTMLButtonElement {

    const buttonElement = createButton('icon', 'treeFieldFixedValue');
    buttonElement.appendChild(buildPencilGlyph('default'));

    buttonElement.addEventListener('click', function () {
        if (buttonElement.disabled) { return; }
        toggleFieldEditor(treeObjectState, fieldState, 'fixedValue');
    });
    fieldState.fixedValueButtonElement = buttonElement;

    return buttonElement;

}
