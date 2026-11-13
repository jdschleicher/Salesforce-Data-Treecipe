import { createButton, createElement, setShown } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL,
    RECIPE_COCKPIT_ADAPTER_AUDIT_TRAIL_HEADING,
    RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL,
    RECIPE_COCKPIT_ADAPTER_HINTS_HEADING,
    RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL,
    RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_NOTE,
    RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL,
    RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE,
    RECIPE_COCKPIT_ADAPTER_SOURCE_TRACKING_HEADING
} from '../../RecipeCockpitAdapterConstants';
import { drawAdapterChildAddButton, isAdapterChildOf, requestAdapterChild } from './AdapterChild';
import { drawUpdaterLoadButtons } from './AdapterLoadAndUpdate';
import { applyUpdaterFilter, buildUpdaterFieldRow, drawUpdaterObjectCount, drawUpdaterSummary, isChoosableOrgOnlyRow, listUpdaterChoosableFieldStates, updaterFieldKeyOf } from './AdapterTab';
import type {
    AdapterOrgOnlyRowState,
    AdapterPanelMessage,
    IAdapterChangesMessage,
    IAdapterField,
    IAdapterFieldChange,
    IAdapterHintList,
    IAdapterHintRow,
    IAdapterObjectChanges,
    IAdapterOrgHints,
    IAdapterOrgOnlyFieldState,
    IAdapterTreeState,
    IUpdaterObjectState
} from './AdapterTypes';

/*
    The Treecipe Adapter's "Retrieve latest metadata" (#445), "Apply retrieved files to project",
    the fields only the org holds (#446) and the org's recent changes (#641). These names are the
    panel script's own, read when a function runs; the run locks are also set by the script's
    updaterLoadState message.
*/
declare const vscodeApi: { postMessage(message: AdapterPanelMessage): void };
declare const renderedSequence: number | null;
declare const treeStates: IAdapterTreeState[];
declare let updaterLoadRunningTreeKey: string | null;
declare let updaterRunKind: string;
declare function findTreeState(treeKey: unknown): IAdapterTreeState | null;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;

/*
    "Retrieve latest metadata" (#445): posts the card and the parent step 1 chose, nothing
    else; the host plans the objects and picks the org. What comes back marks each drawn row
    "new in org" or "changed in org", counts them on the object, and draws a field only the org
    holds as a row of its own -- every value written with textContent.
*/
export function requestAdapterMetadataRetrieve(treeState: IAdapterTreeState): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null || !treeState.updaterParentObjectApiName) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'retrieve';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'retrieveAdapterMetadata', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence, parentObjectApiName: treeState.updaterParentObjectApiName });

}

export function requestAdapterRetrievedFilesApply(treeState: IAdapterTreeState): void {

    if (renderedSequence === null || !treeState.adapterChangesMessage || updaterLoadRunningTreeKey !== null) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'apply';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'applyAdapterRetrievedFiles', treeKey: treeState.tree.treeKey, renderSequence: treeState.adapterChangesMessage.renderSequence });

}

// THE FIELD FILES THE LAST RETRIEVE FOUND NEW OR CHANGED, WHICH IS WHAT APPLY WOULD COPY
export function countAdapterFileChanges(treeState: IAdapterTreeState): number {
    const changesMessage = treeState.adapterChangesMessage;
    if (!changesMessage || !Array.isArray(changesMessage.objects)) { return 0; }
    return changesMessage.objects.reduce(function (total: number, objectChanges) {
        return total + (objectChanges && Array.isArray(objectChanges.fieldChanges) ? objectChanges.fieldChanges.length : 0);
    }, 0);
}

export function renderAdapterMetadataChanges(changesMessage: IAdapterChangesMessage): void {

    if (renderedSequence === null || changesMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(changesMessage.treeKey);
    if (!treeState) { return; }

    // THE HOST HOLDS ONE RETRIEVE (#446): ANOTHER CARD'S MARKS, AND THE FIELDS ONLY THE ORG HOLDS IT OFFERED, ARE NO LONGER ONES IT ACCEPTS
    treeStates.forEach(function (otherTreeState) {
        if (otherTreeState !== treeState && otherTreeState.adapterChangesMessage) { clearAdapterMetadataChanges(otherTreeState); }
    });

    treeState.adapterChangesMessage = changesMessage;
    applyAdapterMetadataChanges(treeState);

}

function clearAdapterMetadataChanges(treeState: IAdapterTreeState): void {

    treeState.adapterChangesMessage = { objects: [], orgLabel: '' };
    applyAdapterMetadataChanges(treeState);
    treeState.adapterChangesMessage = null;
    if (treeState.updaterOrgChangesNoteElement) { setShown(treeState.updaterOrgChangesNoteElement, false); }
    if (treeState.updaterApplyRetrievedElement) { setShown(treeState.updaterApplyRetrievedElement, false); }
    drawUpdaterLoadButtons();

}

export function applyAdapterMetadataChanges(treeState: IAdapterTreeState): void {

    const changesMessage = treeState.adapterChangesMessage;
    const orgChangesNoteElement = treeState.updaterOrgChangesNoteElement;
    if (!changesMessage || !treeState.updaterObjectStates || !orgChangesNoteElement) { return; }

    const objectChangesByName: Record<string, IAdapterObjectChanges> = Object.create(null);
    (Array.isArray(changesMessage.objects) ? changesMessage.objects : []).forEach(function (objectChanges) {
        if (objectChanges && typeof objectChanges.objectApiName === 'string') { objectChangesByName[objectChanges.objectApiName] = objectChanges; }
    });

    let newCount = 0;
    let changedCount = 0;

    treeState.updaterObjectStates.forEach(function (updaterObjectState) {

        const objectChanges = hasOwnKey(objectChangesByName, updaterObjectState.object.objectApiName) ? objectChangesByName[updaterObjectState.object.objectApiName] : null;
        // THE SCRIPT READ EVERY ENTRY AS A CHANGE; A null ONE FAILED THERE AS IT DOES HERE
        const fieldChanges = (objectChanges && Array.isArray(objectChanges.fieldChanges) ? objectChanges.fieldChanges : []) as IAdapterFieldChange[];
        const fieldChangesByLowerName: Record<string, IAdapterFieldChange> = Object.create(null);
        fieldChanges.forEach(function (fieldChange) {
            if (fieldChange && typeof fieldChange.fieldApiName === 'string') { fieldChangesByLowerName[fieldChange.fieldApiName.toLowerCase()] = fieldChange; }
        });

        updaterObjectState.orgChanges = objectChanges;
        updaterObjectState.fieldStates.forEach(function (fieldState) {
            const lowerFieldName = fieldState.field.fieldApiName.toLowerCase();
            fieldState.orgChange = hasOwnKey(fieldChangesByLowerName, lowerFieldName) ? fieldChangesByLowerName[lowerFieldName] : null;
            fieldState.orgSearchText = fieldState.orgChange ? describeAdapterFieldChange(fieldState.orgChange).toLowerCase() : '';
            drawAdapterFieldOrgChip(fieldState);
        });

        // A NEW FIELD THE RECIPE DOES NOT LIST IS A ROW OF ITS OWN; ONE IT LISTS IS MARKED ON ITS ROW
        const modelFieldNames: Record<string, true> = Object.create(null);
        updaterObjectState.fieldStates.forEach(function (fieldState) { modelFieldNames[fieldState.field.fieldApiName.toLowerCase()] = true; });
        const newChildObjects = objectChanges && Array.isArray(objectChanges.newChildObjects) ? objectChanges.newChildObjects : [];
        const orgOnlyFieldStates: AdapterOrgOnlyRowState[] = fieldChanges
            .filter(function (fieldChange) { return fieldChange.status === 'new' && !hasOwnKey(modelFieldNames, String(fieldChange.fieldApiName).toLowerCase()); })
            .map(function (fieldChange) { return buildAdapterOrgOnlyFieldState(updaterObjectState, fieldChange); });
        updaterObjectState.orgOnlyFieldStates = orgOnlyFieldStates
            // A CUSTOM CHILD OBJECT ONLY THE ORG HOLDS IS A ROW UNDER ITS PARENT, DRAWN UNTIL #447 CAN ADD IT
            .concat(newChildObjects.map(function (childObject) {
                return {
                    fieldChange: null,
                    childObject: childObject,
                    searchText: [childObject.childObjectApiName, childObject.fieldApiName, RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL].join('\n').toLowerCase(),
                    isMatch: true,
                    rowElement: null
                };
            }));
        const moreNewChildObjectCount = objectChanges ? Number(objectChanges.moreNewChildObjectCount) || 0 : 0;
        updaterObjectState.moreNewChildObjectCount = moreNewChildObjectCount;

        // A CHOICE IS KEPT ONLY ON A FIELD THIS OBJECT STILL OFFERS; THE COUNT IS MADE AGAIN FROM WHAT IS CHOSEN
        const choosableFieldKeys: Record<string, true> = Object.create(null);
        listUpdaterChoosableFieldStates(updaterObjectState).forEach(function (fieldState) {
            if (!fieldState.lockReason) { choosableFieldKeys[fieldState.fieldKey] = true; }
        });
        updaterObjectState.chosenFieldCount = 0;
        Object.keys(treeState.updaterChosenFieldKeys).forEach(function (fieldKey) {
            if (fieldKey.split('\n')[0] !== updaterObjectState.object.objectApiName) { return; }
            if (hasOwnKey(choosableFieldKeys, fieldKey)) {
                updaterObjectState.chosenFieldCount++;
            } else {
                delete treeState.updaterChosenFieldKeys[fieldKey];
            }
        });
        drawUpdaterObjectCount(updaterObjectState);

        const objectNewCount = fieldChanges.filter(function (fieldChange) { return fieldChange.status === 'new'; }).length;
        const objectChangedCount = fieldChanges.filter(function (fieldChange) { return fieldChange.status === 'changed'; }).length;
        newCount += objectNewCount;
        changedCount += objectChangedCount;

        const chipParts: string[] = [];
        if (objectChanges && objectChanges.isRetrieved === false) { chipParts.push(RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL); }
        if (objectNewCount > 0) { chipParts.push(objectNewCount + ' ' + RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL); }
        if (objectChangedCount > 0) { chipParts.push(objectChangedCount + ' ' + RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL); }
        const childObjectCount = newChildObjects.length + moreNewChildObjectCount;
        if (childObjectCount > 0) { chipParts.push(pluralize(childObjectCount, RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL, RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL.replace('object', 'objects'))); }
        updaterObjectState.orgChangesChipElement.textContent = chipParts.join(' · ');
        setShown(updaterObjectState.orgChangesChipElement, chipParts.length > 0);

        drawAdapterObjectOrgOnlyFields(treeState, updaterObjectState);

    });

    drawUpdaterSummary(treeState);
    orgChangesNoteElement.textContent = 'Retrieved from ' + String(changesMessage.orgLabel || 'the org') + ': '
        + pluralize(newCount, 'field', 'fields') + ' ' + RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL + ', ' + pluralize(changedCount, 'field', 'fields') + ' ' + RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL + '.';
    if (changesMessage.childObjectsNote) { orgChangesNoteElement.textContent += ' ' + String(changesMessage.childObjectsNote); }
    setShown(orgChangesNoteElement, true);
    if (treeState.updaterApplyRetrievedElement) { setShown(treeState.updaterApplyRetrievedElement, true); }
    drawAdapterOrgHints(treeState, changesMessage.hints);
    drawUpdaterLoadButtons();

    if (treeState.searchQueries.updater) { applyUpdaterFilter(treeState); }

}

function describeAdapterFieldChange(fieldChange: IAdapterFieldChange): string {
    const differences: string[] = Array.isArray(fieldChange.differences) ? fieldChange.differences.map(String) : [];
    return (fieldChange.status === 'new' ? RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL : RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL) + (differences.length > 0 ? ': ' + differences.join('; ') : '');
}

export function drawAdapterFieldOrgChip(fieldState: { orgChipElement: HTMLElement | null; orgChange: IAdapterFieldChange | null }): void {

    const chipElement = fieldState.orgChipElement;
    if (!chipElement) { return; }

    if (!fieldState.orgChange) {
        chipElement.textContent = '';
        chipElement.removeAttribute('title');
        setShown(chipElement, false);
        return;
    }

    chipElement.textContent = fieldState.orgChange.status === 'new' ? RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL : RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL;
    chipElement.setAttribute('title', describeAdapterFieldChange(fieldState.orgChange));
    setShown(chipElement, true);

}

/*
    A field only the org holds (#446): a row the Updater's own parts draw -- its box, its editor
    and its expression -- from what the host offered: the expression the recipe's backend
    writes for its type, why it is locked, or that it takes a fixed value only. One the host
    offered nothing for is a row with no box, as #445 drew it.
*/
function buildAdapterOrgOnlyFieldState(updaterObjectState: IUpdaterObjectState, fieldChange: IAdapterFieldChange): IAdapterOrgOnlyFieldState {

    const orgOnly = fieldChange.orgOnly && typeof fieldChange.orgOnly === 'object' ? fieldChange.orgOnly : null;
    const fieldApiName = String(fieldChange.fieldApiName);
    const field: IAdapterField | null = !orgOnly ? null : {
        fieldApiName: fieldApiName,
        fieldLabel: String(fieldChange.fieldLabel || ''),
        fieldType: String(fieldChange.fieldType || ''),
        fieldTypeWithSize: String(orgOnly.fieldTypeWithSize || ''),
        recipeValue: typeof orgOnly.expression === 'string' ? orgOnly.expression : '',
        controllingField: '',
        isOnlyInRecipeFile: false
    };
    const orgOnlyNote = orgOnly && typeof orgOnly.note === 'string' ? orgOnly.note : '';

    return {
        fieldChange: fieldChange,
        childObject: null,
        field: field,
        fieldKey: updaterFieldKeyOf(updaterObjectState.object.objectApiName, fieldApiName),
        lockReason: !orgOnly ? RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE : typeof orgOnly.lockReason === 'string' ? orgOnly.lockReason : '',
        orgOnlyNote: orgOnlyNote,
        orgChange: fieldChange,
        orgChipElement: null,
        orgSearchText: '',
        searchText: [fieldApiName, fieldChange.fieldLabel, field ? field.fieldTypeWithSize || field.fieldType : fieldChange.fieldType, field ? field.recipeValue : '', RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL, orgOnlyNote].join('\n').toLowerCase(),
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

}

export function drawAdapterObjectOrgOnlyFields(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): void {

    const containerElement = updaterObjectState.orgOnlyFieldsElement;
    if (!containerElement) { return; }

    containerElement.textContent = '';
    updaterObjectState.orgOnlyFieldStates.forEach(function (orgOnlyFieldState) {

        if (orgOnlyFieldState.childObject) {
            const childObject = orgOnlyFieldState.childObject;
            const childRowElement = createElement('div', 'updaterField updaterOrgOnlyObject');
            const childHeaderElement = createElement('div', 'updaterFieldHeader');
            childHeaderElement.appendChild(createElement('span', 'updaterFieldName', String(childObject.childObjectApiName)));
            childHeaderElement.appendChild(createElement('span', 'updaterFieldLabel muted', 'via ' + String(childObject.fieldApiName)));
            childHeaderElement.appendChild(createElement('span', 'updaterOrgChangeChip', RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL));
            childHeaderElement.appendChild(createElement('span', 'updaterFieldNote muted', RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_NOTE));
            const addElement = createButton('secondary', 'adapterChildAdd', RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL, 'compact');
            addElement.addEventListener('click', function () {
                if (addElement.disabled) { return; }
                requestAdapterChild(treeState, updaterObjectState, childObject);
            });
            orgOnlyFieldState.addElement = addElement;
            childHeaderElement.appendChild(addElement);
            childRowElement.appendChild(childHeaderElement);
            // A REDRAW OF THE ROWS PUTS THE OPEN BLOCK BACK UNDER ITS ROW, AS IT WAS
            const adapterChild = treeState.adapterChild;
            if (adapterChild && isAdapterChildOf(adapterChild, updaterObjectState.object.objectApiName, childObject)) {
                childRowElement.appendChild(adapterChild.editorElement);
            }
            drawAdapterChildAddButton(treeState, updaterObjectState, orgOnlyFieldState);
            orgOnlyFieldState.rowElement = childRowElement;
            setShown(childRowElement, orgOnlyFieldState.isMatch);
            containerElement.appendChild(childRowElement);
            return;
        }

        if (isChoosableOrgOnlyRow(orgOnlyFieldState)) {
            const fieldRowElement = buildUpdaterFieldRow(treeState, updaterObjectState, orgOnlyFieldState);
            setShown(fieldRowElement, orgOnlyFieldState.isMatch);
            containerElement.appendChild(fieldRowElement);
            return;
        }

        const fieldChange = orgOnlyFieldState.fieldChange;
        const rowElement = createElement('div', 'updaterField updaterOrgOnlyField');
        const headerElement = createElement('div', 'updaterFieldHeader');

        headerElement.appendChild(createElement('span', 'updaterFieldName', String(fieldChange.fieldApiName)));
        if (fieldChange.fieldLabel && fieldChange.fieldLabel !== fieldChange.fieldApiName) {
            headerElement.appendChild(createElement('span', 'updaterFieldLabel muted', String(fieldChange.fieldLabel)));
        }
        if (fieldChange.fieldType) {
            headerElement.appendChild(createElement('span', 'fieldType', String(fieldChange.fieldType)));
        }
        headerElement.appendChild(createElement('span', 'updaterOrgChangeChip', RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL));
        headerElement.appendChild(createElement('span', 'updaterFieldNote muted', RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE));

        rowElement.appendChild(headerElement);
        orgOnlyFieldState.rowElement = rowElement;
        setShown(rowElement, orgOnlyFieldState.isMatch);
        containerElement.appendChild(rowElement);

    });

    const moreNewChildObjectCount = updaterObjectState.moreNewChildObjectCount || 0;
    if (moreNewChildObjectCount > 0) {
        containerElement.appendChild(createElement('div', 'updaterOrgOnlyMore muted', moreNewChildObjectCount + ' more ' + RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL.replace('object', 'objects') + ' not listed'));
    }

}

/*
    "Recent changes in the org" (#445): source tracking and the setup audit trail as the host read
    them, each a short list or the note saying why it is empty. They are hints beside the marks,
    never what decides one.
*/
function drawAdapterOrgHints(treeState: IAdapterTreeState, hints: IAdapterOrgHints | null | undefined): void {

    const hintsElement = treeState.updaterOrgHintsElement;
    if (!hintsElement) { return; }

    hintsElement.textContent = '';
    if (!hints) {
        setShown(hintsElement, false);
        return;
    }

    hintsElement.appendChild(createElement('div', 'updaterOrgHintsHeading', RECIPE_COCKPIT_ADAPTER_HINTS_HEADING));
    const hintParts: Array<[string, IAdapterHintList | null | undefined, string]> = [
        [RECIPE_COCKPIT_ADAPTER_SOURCE_TRACKING_HEADING, hints.sourceTracking, 'updaterOrgHintsSourceTracking'],
        [RECIPE_COCKPIT_ADAPTER_AUDIT_TRAIL_HEADING, hints.auditTrail, 'updaterOrgHintsAuditTrail']
    ];
    hintParts.forEach(function (hintPart) {

        const hintList: IAdapterHintList = hintPart[1] || {};
        const rows: IAdapterHintRow[] = Array.isArray(hintList.rows) ? hintList.rows : [];
        const listElement = createElement('div', 'updaterOrgHintList ' + hintPart[2]);
        listElement.appendChild(createElement('div', 'updaterOrgHintListHeading', hintPart[0]));

        if (hintList.note) {
            listElement.appendChild(createElement('div', 'updaterOrgHintNote muted', String(hintList.note)));
        } else if (rows.length === 0) {
            listElement.appendChild(createElement('div', 'updaterOrgHintNote muted', 'Nothing listed for these objects.'));
        }

        rows.forEach(function (hintRow) {
            const rowElement = createElement('div', 'updaterOrgHint');
            if (hintRow.changedAt) { rowElement.appendChild(createElement('span', 'updaterOrgHintTime muted', String(hintRow.changedAt).slice(0, 16).replace('T', ' '))); }
            rowElement.appendChild(createElement('span', 'updaterOrgHintObject', String(hintRow.objectApiName)));
            rowElement.appendChild(createElement('span', 'updaterOrgHintText', String(hintRow.text)));
            listElement.appendChild(rowElement);
        });

        const moreCount = Number(hintList.moreCount) || 0;
        const skippedCount = Number(hintList.skippedCount) || 0;
        if (moreCount > 0) { listElement.appendChild(createElement('div', 'updaterOrgHintNote muted', moreCount + ' more not shown.')); }
        if (skippedCount > 0) { listElement.appendChild(createElement('div', 'updaterOrgHintNote muted', pluralize(skippedCount, 'row', 'rows') + ' could not be read.')); }

        hintsElement.appendChild(listElement);

    });

    setShown(hintsElement, true);

}
