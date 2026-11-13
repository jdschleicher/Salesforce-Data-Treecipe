import { createButton, createElement, setShown } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_COUNT_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX,
    RECIPE_COCKPIT_ADAPTER_CHILD_PREVIEW_NOTE
} from '../../RecipeCockpitAdapterConstants';
import { buildRecordTable } from '../RecipeCockpitRecordTable';
import { drawUpdaterLoadButtons } from './AdapterLoadAndUpdate';
import { drawAdapterObjectOrgOnlyFields } from './AdapterRetrieve';
import { buildUpdaterFieldRow, drawUpdaterObjectCount, updaterFieldKeyOf } from './AdapterTab';
import type {
    AdapterPanelMessage,
    IAdapterChild,
    IAdapterChildBlockMessage,
    IAdapterChildFieldRequest,
    IAdapterChildObjectRowState,
    IAdapterChildPreviewMessage,
    IAdapterNewChildObject,
    IAdapterTree,
    IAdapterTreeState,
    IUpdaterFieldObjectState,
    IUpdaterFieldRowState,
    IUpdaterFieldTreeState,
    IUpdaterObjectState
} from './AdapterTypes';

/*
    "Add to data set" (#447, #641): a custom child object only the org holds, added under the loaded
    records with a block of its own and a preview the host generates. These names are the panel
    script's own, read when a function runs; the run locks are also set by the script's
    updaterLoadState message.
*/
declare const vscodeApi: { postMessage(message: AdapterPanelMessage): void };
declare const renderedSequence: number | null;
declare const treeStates: IAdapterTreeState[];
declare let updaterLoadRunningTreeKey: string | null;
declare let updaterRunKind: string;
declare let adapterChildPreparingKey: string;
declare function findTreeState(treeKey: unknown): IAdapterTreeState | null;
declare function findObjectExclusion(tree: IAdapterTree, objectApiName: string): unknown;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;

export function isAdapterChildOf(adapterChild: IAdapterChild | null, parentObjectApiName: string, childObject: IAdapterNewChildObject | null): boolean {
    return !!adapterChild && !!childObject
        && adapterChild.parentObjectApiName === parentObjectApiName
        && adapterChild.childObjectApiName === String(childObject.childObjectApiName)
        && adapterChild.lookupFieldApiName === String(childObject.fieldApiName);
}

/*
    Why "Add to data set" (#447) cannot run for a new child under this parent: a run holds the
    Adapter, the Treecipe tab excludes the parent, no records are loaded, or the last load read
    none of the parent. The host checks every one again.
*/
function findAdapterChildAddReason(treeState: IAdapterTreeState, parentObjectApiName: string): string {

    if (updaterLoadRunningTreeKey !== null) { return 'Records are being loaded, generated, updated or restored.'; }
    if (findObjectExclusion(treeState.tree, parentObjectApiName)) { return RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX + parentObjectApiName + '.'; }
    if (!treeState.updaterRecordsMessage) { return RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON; }

    const loadedObjects = Array.isArray(treeState.updaterRecordsMessage.objects) ? treeState.updaterRecordsMessage.objects : [];
    const parentRecords = loadedObjects.find(function (loadedObject) { return loadedObject && loadedObject.objectApiName === parentObjectApiName; });

    return parentRecords && Number(parentRecords.recordCount) > 0 ? '' : RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON;

}

export function drawAdapterChildAddButton(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, orgOnlyFieldState: IAdapterChildObjectRowState): void {

    const addElement = orgOnlyFieldState.addElement;
    if (!addElement) { return; }

    const parentObjectApiName = updaterObjectState.object.objectApiName;
    const reason = findAdapterChildAddReason(treeState, parentObjectApiName);
    const isPreparing = updaterRunKind === 'prepareChild' && updaterLoadRunningTreeKey === treeState.tree.treeKey && adapterChildPreparingKey === adapterChildKeyOf(parentObjectApiName, orgOnlyFieldState.childObject);

    addElement.textContent = isPreparing ? 'Retrieving…' : RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL;
    addElement.disabled = reason !== '';
    addElement.setAttribute('title', reason || 'Retrieve ' + String(orgOnlyFieldState.childObject.childObjectApiName) + ' from the org the records were loaded from, then set how many to add under each loaded ' + parentObjectApiName + ' record and which fields to fill.');

}

function adapterChildKeyOf(parentObjectApiName: string, childObject: IAdapterNewChildObject): string {
    return [parentObjectApiName, String(childObject.childObjectApiName), String(childObject.fieldApiName)].join('\n');
}

export function drawAdapterChildControls(treeState: IAdapterTreeState): void {

    (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
        (updaterObjectState.orgOnlyFieldStates || []).forEach(function (orgOnlyFieldState) {
            if (orgOnlyFieldState.childObject) { drawAdapterChildAddButton(treeState, updaterObjectState, orgOnlyFieldState); }
        });
    });

    const adapterChild = treeState.adapterChild;
    if (!adapterChild) { return; }

    const isGenerating = updaterRunKind === 'generateChild' && updaterLoadRunningTreeKey === treeState.tree.treeKey;
    adapterChild.generateElement.textContent = isGenerating ? 'Generating…' : RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_LABEL;
    adapterChild.generateElement.disabled = updaterLoadRunningTreeKey !== null;
    adapterChild.generateElement.setAttribute('title', updaterLoadRunningTreeKey !== null
        ? 'Records are being loaded, generated, updated or restored.'
        : 'Generate the new ' + adapterChild.childObjectApiName + ' records with the recipe’s own backend and show a preview. Nothing is written to the org.');

}

export function requestAdapterChild(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, childObject: IAdapterNewChildObject): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'prepareChild';
    adapterChildPreparingKey = adapterChildKeyOf(updaterObjectState.object.objectApiName, childObject);
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({
        command: 'prepareAdapterChild',
        treeKey: treeState.tree.treeKey,
        renderSequence: renderedSequence,
        parentObjectApiName: updaterObjectState.object.objectApiName,
        childObjectApiName: String(childObject.childObjectApiName),
        lookupFieldApiName: String(childObject.fieldApiName)
    });

}

export function clearAdapterChildren(): void {

    treeStates.forEach(function (treeState) {
        const adapterChild = treeState.adapterChild;
        treeState.adapterChildBlockMessage = null;
        treeState.adapterChildPreviewMessage = null;
        if (!adapterChild) { return; }
        treeState.adapterChild = null;
        // ITS PARENT'S ROWS ARE DRAWN AGAIN, NOW WITHOUT IT
        (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
            if (updaterObjectState.object.objectApiName === adapterChild.parentObjectApiName) { drawAdapterObjectOrgOnlyFields(treeState, updaterObjectState); }
        });
    });

}

export function clearAdapterChildPreviews(): void {

    treeStates.forEach(function (treeState) {
        treeState.adapterChildPreviewMessage = null;
        if (treeState.adapterChild) { drawAdapterChildPreview(treeState.adapterChild, null); }
    });

}

/*
    The new child's block (#447), under its row: how many per loaded parent record, and each of
    its fields with the Updater's own parts -- its box, its editor, its expression, or the lock's
    reason -- in a box and an editor of its own, so nothing here touches the card's own choice.
    What it posts is names, a count and the values typed; the host checks each again.
*/
export function renderAdapterChildBlock(blockMessage: IAdapterChildBlockMessage): void {

    if (renderedSequence === null || blockMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(blockMessage.treeKey);
    if (!treeState) { return; }

    clearAdapterChildren();
    // KEPT ON THE CARD, SO A REPLAY INTO A DOCUMENT WHOSE ADAPTER TAB IS NOT BUILT YET IS DRAWN WHEN IT IS
    treeState.adapterChildBlockMessage = blockMessage;
    if (treeState.updaterObjectStates) { buildAdapterChildBlock(treeState); }

}

export function buildAdapterChildBlock(treeState: IAdapterTreeState): void {

    const blockMessage = treeState.adapterChildBlockMessage;
    if (!blockMessage) { return; }

    const childObjectApiName = String(blockMessage.childObjectApiName);
    const parentObjectApiName = String(blockMessage.parentObjectApiName);
    const parentRecordCount = Number(blockMessage.parentRecordCount) || 0;
    const childTreeState: IUpdaterFieldTreeState = {
        tree: { treeKey: treeState.tree.treeKey, fixedValues: [] },
        updaterChosenFieldKeys: Object.create(null),
        updaterEditedValues: Object.create(null),
        updaterObjectStates: [],
        updaterSummaryElement: null
    };
    const childObjectState: IUpdaterFieldObjectState = { object: { objectApiName: childObjectApiName }, chosenFieldCount: 0, countText: '', countElement: createElement('span', 'adapterChildChosen muted'), loadedRecords: null };
    const editorElement = createElement('div', 'adapterChildEditor');
    editorElement.setAttribute('role', 'group');
    editorElement.setAttribute('aria-label', 'Add ' + childObjectApiName + ' under the loaded ' + parentObjectApiName + ' records');

    editorElement.appendChild(createElement('div', 'adapterChildHeading',
        'Add ' + childObjectApiName + ' under the ' + pluralize(parentRecordCount, parentObjectApiName + ' record', parentObjectApiName + ' records') + ' loaded from ' + String(blockMessage.orgLabel || 'the org')
        + ', generated by ' + String(blockMessage.fakerService) + '.'));

    const countRowElement = createElement('div', 'adapterChildCount');
    const countInputElement = createElement('input', 'adapterChildCountInput');
    countInputElement.setAttribute('type', 'text');
    countInputElement.setAttribute('inputmode', 'numeric');
    countInputElement.setAttribute('maxlength', '6');
    countInputElement.setAttribute('aria-label', childObjectApiName + ' records ' + RECIPE_COCKPIT_ADAPTER_CHILD_COUNT_LABEL + ' ' + parentObjectApiName);
    countInputElement.value = '1';
    countRowElement.appendChild(createElement('span', 'adapterChildCountText', 'Create'));
    countRowElement.appendChild(countInputElement);
    countRowElement.appendChild(createElement('span', 'adapterChildCountText', childObjectApiName + ' records ' + RECIPE_COCKPIT_ADAPTER_CHILD_COUNT_LABEL + ' ' + parentObjectApiName));
    countRowElement.appendChild(childObjectState.countElement);
    editorElement.appendChild(countRowElement);

    const fieldsElement = createElement('div', 'adapterChildFields');
    const fieldStates = (Array.isArray(blockMessage.fields) ? blockMessage.fields : []).map(function (childField) {
        const fieldApiName = String(childField.fieldApiName);
        const fieldState: IUpdaterFieldRowState = {
            fieldChange: null,
            childObject: null,
            field: {
                fieldApiName: fieldApiName,
                fieldLabel: String(childField.fieldLabel || ''),
                fieldType: String(childField.fieldTypeWithSize || ''),
                fieldTypeWithSize: String(childField.fieldTypeWithSize || ''),
                recipeValue: typeof childField.expression === 'string' ? childField.expression : '',
                controllingField: '',
                isOnlyInRecipeFile: false
            },
            fieldKey: updaterFieldKeyOf(childObjectApiName, fieldApiName),
            lockReason: typeof childField.lockReason === 'string' ? childField.lockReason : '',
            orgOnlyNote: typeof childField.note === 'string' ? childField.note : '',
            orgChange: null,
            orgChipElement: null,
            isMatch: true,
            rowElement: null,
            chooseElement: null,
            editButtonElement: null,
            editBadgeElement: null,
            editedValueElement: null,
            expressionRowElement: null,
            editorElement: null,
            isEditorOpen: false
        };
        // A FIELD WITH AN EXPRESSION STARTS TICKED, AS THE TREECIPE TAB'S FIELDS DO; A FIXED-VALUE-ONLY ONE WAITS FOR ITS VALUE
        if (!fieldState.lockReason && fieldState.field.recipeValue) {
            childTreeState.updaterChosenFieldKeys[fieldState.fieldKey] = true;
            childObjectState.chosenFieldCount++;
        }
        const rowElement = buildUpdaterFieldRow(childTreeState, childObjectState, fieldState);
        const headerElement = rowElement.firstChild as HTMLElement;
        if (childField.isRequired === true) { headerElement.appendChild(createElement('span', 'adapterChildRequired', 'required')); }
        if (fieldState.orgOnlyNote) { headerElement.appendChild(createElement('span', 'updaterFieldNote muted', fieldState.orgOnlyNote)); }
        fieldsElement.appendChild(rowElement);
        return fieldState;
    });
    drawUpdaterObjectCount(childObjectState);
    editorElement.appendChild(fieldsElement);

    const unreadableFieldCount = Number(blockMessage.unreadableFieldCount) || 0;
    if (unreadableFieldCount > 0) {
        editorElement.appendChild(createElement('div', 'adapterChildUnreadable muted', pluralize(unreadableFieldCount, 'field file', 'field files') + ' could not be read and ' + (unreadableFieldCount === 1 ? 'is' : 'are') + ' left out.'));
    }

    const refusalElement = createElement('div', 'adapterChildRefusal hidden');
    refusalElement.setAttribute('role', 'alert');
    editorElement.appendChild(refusalElement);

    const generateElement = createButton('primary', 'adapterChildGenerate', RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_LABEL, 'compact');
    editorElement.appendChild(generateElement);
    editorElement.appendChild(createElement('div', 'adapterChildPreviewNote muted', RECIPE_COCKPIT_ADAPTER_CHILD_PREVIEW_NOTE));
    const previewElement = createElement('div', 'adapterChildPreview hidden');
    editorElement.appendChild(previewElement);

    const adapterChild: IAdapterChild = {
        parentObjectApiName: parentObjectApiName,
        childObjectApiName: childObjectApiName,
        lookupFieldApiName: String(blockMessage.lookupFieldApiName),
        childTreeState: childTreeState,
        fieldStates: fieldStates,
        editorElement: editorElement,
        countInputElement: countInputElement,
        refusalElement: refusalElement,
        generateElement: generateElement,
        previewElement: previewElement
    };
    generateElement.addEventListener('click', function () {
        if (generateElement.disabled) { return; }
        requestAdapterChildPreview(treeState, adapterChild);
    });
    countInputElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); requestAdapterChildPreview(treeState, adapterChild); }
    });
    treeState.adapterChild = adapterChild;

    if (treeState.adapterChildPreviewMessage) { drawAdapterChildPreview(adapterChild, treeState.adapterChildPreviewMessage); }

    const parentObjectState = (treeState.updaterObjectStates || []).find(function (updaterObjectState) { return updaterObjectState.object.objectApiName === parentObjectApiName; });
    if (parentObjectState) { drawAdapterObjectOrgOnlyFields(treeState, parentObjectState); }
    drawUpdaterLoadButtons();

}

function requestAdapterChildPreview(treeState: IAdapterTreeState, adapterChild: IAdapterChild): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null || treeState.adapterChild !== adapterChild) { return; }

    const countText = String(adapterChild.countInputElement.value || '').trim();
    const countPerParent = Number(countText);

    if (!/^[1-9][0-9]*$/.test(countText) || !Number.isSafeInteger(countPerParent)) {
        adapterChild.refusalElement.textContent = 'The count per ' + adapterChild.parentObjectApiName + ' record must be a whole number of one or more.';
        setShown(adapterChild.refusalElement, true);
        return;
    }
    adapterChild.refusalElement.textContent = '';
    setShown(adapterChild.refusalElement, false);

    const fields: IAdapterChildFieldRequest[] = [];
    adapterChild.fieldStates.forEach(function (fieldState) {
        if (fieldState.lockReason || !hasOwnKey(adapterChild.childTreeState.updaterChosenFieldKeys, fieldState.fieldKey)) { return; }
        const fieldRequest: IAdapterChildFieldRequest = { fieldApiName: fieldState.field.fieldApiName };
        if (hasOwnKey(adapterChild.childTreeState.updaterEditedValues, fieldState.fieldKey)) { fieldRequest.value = adapterChild.childTreeState.updaterEditedValues[fieldState.fieldKey]; }
        fields.push(fieldRequest);
    });

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'generateChild';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({
        command: 'generateAdapterChild',
        treeKey: treeState.tree.treeKey,
        renderSequence: renderedSequence,
        childObjectApiName: adapterChild.childObjectApiName,
        countPerParent: countPerParent,
        fields: fields
    });

}

export function renderAdapterChildPreview(previewMessage: IAdapterChildPreviewMessage): void {

    if (renderedSequence === null || previewMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(previewMessage.treeKey);
    if (!treeState || !treeState.adapterChildBlockMessage || treeState.adapterChildBlockMessage.childObjectApiName !== previewMessage.childObjectApiName) { return; }

    treeState.adapterChildPreviewMessage = previewMessage;
    if (treeState.adapterChild) { drawAdapterChildPreview(treeState.adapterChild, previewMessage); }

}

function drawAdapterChildPreview(adapterChild: IAdapterChild, previewMessage: IAdapterChildPreviewMessage | null): void {

    const previewElement = adapterChild.previewElement;
    previewElement.textContent = '';

    if (!previewMessage) {
        setShown(previewElement, false);
        return;
    }

    const columns: string[] = Array.isArray(previewMessage.columns) ? previewMessage.columns.map(String) : [];
    const rows: unknown[] = Array.isArray(previewMessage.rows) ? previewMessage.rows : [];
    const recordCount = Number(previewMessage.recordCount) || 0;
    const hiddenColumnCount = Number(previewMessage.hiddenColumnCount) || 0;
    let summaryText = pluralize(recordCount, 'new ' + adapterChild.childObjectApiName + ' record', 'new ' + adapterChild.childObjectApiName + ' records')
        + ', ' + String(previewMessage.countPerParent) + ' per ' + adapterChild.parentObjectApiName + ' record';
    if (rows.length < recordCount) { summaryText += '. Showing the first ' + rows.length; }
    if (hiddenColumnCount > 0) { summaryText += (rows.length < recordCount ? ', ' : '. Showing ') + pluralize(columns.length, 'column', 'columns') + ', ' + hiddenColumnCount + ' more not shown'; }

    previewElement.appendChild(createElement('div', 'adapterChildPreviewSummary muted', summaryText));
    if (columns.length > 0) { previewElement.appendChild(buildRecordTable(columns, rows)); }
    setShown(previewElement, true);

}
