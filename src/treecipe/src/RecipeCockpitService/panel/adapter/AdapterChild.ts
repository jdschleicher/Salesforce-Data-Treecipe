import { createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL,
    RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX} from '../../RecipeCockpitAdapterConstants';
import { drawUpdaterLoadButtons } from './AdapterLoadAndUpdate';
import { buildNewRecordsPanel } from './AdapterNewRecords';
import { drawAdapterObjectOrgOnlyFields } from './AdapterRetrieve';
import { updaterFieldKeyOf } from './AdapterTab';
import type {
    AdapterPanelMessage,
    IAdapterChild,
    IAdapterChildBlockMessage,
    IAdapterChildObjectRowState,
    IAdapterNewChildObject,
    IAdapterTreeState,
    IUpdaterFieldRowState,
    IUpdaterObjectState
} from './AdapterTypes';
import { findObjectExclusion } from '../treecipe/fieldRows/SelectionCascade';
import { findTreeState, renderedSequence, treeStates } from '../shell/PanelRender';
import { pluralize } from '../RecipeCockpitPanelShared';
import { vscodeApi as cockpitVscodeApi } from '../RecipeCockpitPanelConnection';
import { runLocks } from '../RecipeCockpitRunLocks';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: AdapterPanelMessage): void } = cockpitVscodeApi;

/*
    "Add to data set" (#447, #641): a custom child object only the org holds, added under the loaded
    records with a block of its own and a preview the host generates. The run locks are runLocks', also
    set by the host's updaterLoadState message.
*/

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

    if (runLocks.updaterLoadRunningTreeKey !== null) { return 'Records are being loaded, generated, updated or restored.'; }
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
    const isPreparing = runLocks.updaterRunKind === 'prepareChild' && runLocks.updaterLoadRunningTreeKey === treeState.tree.treeKey && runLocks.adapterChildPreparingKey === adapterChildKeyOf(parentObjectApiName, orgOnlyFieldState.childObject);

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

}

export function requestAdapterChild(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, childObject: IAdapterNewChildObject): void {

    if (renderedSequence === null || runLocks.updaterLoadRunningTreeKey !== null) { return; }

    runLocks.updaterLoadRunningTreeKey = treeState.tree.treeKey;
    runLocks.updaterRunKind = 'prepareChild';
    runLocks.adapterChildPreparingKey = adapterChildKeyOf(updaterObjectState.object.objectApiName, childObject);
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
        if (!adapterChild) { return; }
        // ITS NEW RECORDS WERE GENERATED FOR THIS BLOCK, SO ITS PREVIEW GOES WITH IT
        delete treeState.updaterNewRecordsMessages[adapterChild.childObjectApiName];
        treeState.adapterChild = null;
        // ITS PARENT'S ROWS ARE DRAWN AGAIN, NOW WITHOUT IT
        (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
            if (updaterObjectState.object.objectApiName === adapterChild.parentObjectApiName) { drawAdapterObjectOrgOnlyFields(treeState, updaterObjectState); }
        });
    });

}

/*
    The new child's block (#447), under its row: the same Generate new records panel a tree
    object's second tab holds (#722) -- how many per loaded parent record, each of its fields
    with a box and an editor, Generate records and the paged preview -- built from the fields
    the host retrieved for it. What it posts is names, a count and the values typed; the host
    checks each again.
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
    const editorElement = createElement('div', 'adapterChildEditor');
    editorElement.setAttribute('role', 'group');
    editorElement.setAttribute('aria-label', 'Add ' + childObjectApiName + ' under the loaded ' + parentObjectApiName + ' records');
    editorElement.appendChild(createElement('div', 'adapterChildHeading muted',
        'Retrieved from ' + String(blockMessage.orgLabel || 'the org') + ', generated by ' + String(blockMessage.fakerService) + '.'));

    const newRecordsState = buildNewRecordsPanel(treeState, {
        objectApiName: childObjectApiName,
        containerElement: editorElement,
        fieldRows: (Array.isArray(blockMessage.fields) ? blockMessage.fields : []).map(function (childField) {
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
                orgChange: null, orgChipElement: null, isMatch: true, rowElement: null, chooseElement: null, editButtonElement: null, editBadgeElement: null,
                editedValueElement: null, expressionRowElement: null, editorElement: null, isEditorOpen: false
            };
            return {
                fieldState: fieldState,
                // A FIELD WITH AN EXPRESSION STARTS TICKED, AS THE TREECIPE TAB'S FIELDS DO; A FIXED-VALUE-ONLY ONE WAITS FOR ITS VALUE
                isTicked: fieldState.field.recipeValue !== '',
                decorateRow: function (rowElement: HTMLElement) {
                    const headerElement = rowElement.firstChild as HTMLElement;
                    if (childField.isRequired === true) { headerElement.appendChild(createElement('span', 'adapterChildRequired', 'required')); }
                    if (fieldState.orgOnlyNote) { headerElement.appendChild(createElement('span', 'updaterFieldNote muted', fieldState.orgOnlyNote)); }
                }
            };
        }),
        fixedValues: [],
        // THE BLOCK IS BUILT ONLY FOR PARENTS THE HOST HELD WHEN IT RETRIEVED THE CHILD, AND GOES WHEN THEY DO
        readParent: function () { return { parentObjectApiName: parentObjectApiName, parentRecordCount: parentRecordCount }; },
        readUnreadFieldApiNames: function () { return []; }
    });

    const unreadableFieldCount = Number(blockMessage.unreadableFieldCount) || 0;
    if (unreadableFieldCount > 0) {
        editorElement.appendChild(createElement('div', 'adapterChildUnreadable muted', pluralize(unreadableFieldCount, 'field file', 'field files') + ' could not be read and ' + (unreadableFieldCount === 1 ? 'is' : 'are') + ' left out.'));
    }

    treeState.adapterChild = {
        parentObjectApiName: parentObjectApiName,
        childObjectApiName: childObjectApiName,
        lookupFieldApiName: String(blockMessage.lookupFieldApiName),
        editorElement: editorElement,
        newRecords: newRecordsState
    };

    const parentObjectState = (treeState.updaterObjectStates || []).find(function (updaterObjectState) { return updaterObjectState.object.objectApiName === parentObjectApiName; });
    if (parentObjectState) { drawAdapterObjectOrgOnlyFields(treeState, parentObjectState); }
    drawUpdaterLoadButtons();

}
