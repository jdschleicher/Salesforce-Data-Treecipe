import { createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADAPTER_APPLYING_LABEL,
    RECIPE_COCKPIT_ADAPTER_APPLY_LABEL,
    RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON,
    RECIPE_COCKPIT_ADAPTER_APPLY_TITLE,
    RECIPE_COCKPIT_UPDATER_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATING_LABEL,
    RECIPE_COCKPIT_UPDATER_LOADING_LABEL,
    RECIPE_COCKPIT_UPDATER_LOAD_LABEL,
    RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON,
    RECIPE_COCKPIT_UPDATER_NO_SNAPSHOTS_NOTE,
    RECIPE_COCKPIT_UPDATER_RESTORE_LABEL,
    RECIPE_COCKPIT_UPDATER_RESTORING_LABEL,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE,
    RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATE_LABEL,
    RECIPE_COCKPIT_UPDATER_UPDATING_LABEL
} from '../../RecipeCockpitAdapterConstants';
import type { IActionCardView } from '../RecipeCockpitPanelBuilders';
import { buildRecordTable } from '../RecipeCockpitRecordTable';
import { drawAdapterChildControls } from './AdapterChild';
import { countAdapterFileChanges } from './AdapterRetrieve';
import { drawUpdaterObjectCount, listUpdaterChoosableFieldStates } from './AdapterTab';
import type {
    AdapterPanelMessage,
    IAdapterTreeState,
    IUpdaterFieldValueRequest,
    IUpdaterObjectRequest,
    IUpdaterObjectState,
    IUpdaterPreviewObject,
    IUpdaterRecordsMessage,
    IUpdaterSnapshotsMessage,
    IUpdaterValuesMessage
} from './AdapterTypes';

/*
    The Treecipe Adapter's runs on records (#416 … #419, #641): load, generate values, update and
    restore, each one run per window, with what each drew. These names are the panel script's own,
    read when a function runs; the run locks are also set by the script's updaterLoadState message.
*/
declare const vscodeApi: { postMessage(message: AdapterPanelMessage): void };
declare const renderedSequence: number | null;
declare const treeStates: IAdapterTreeState[];
declare let updaterLoadRunningTreeKey: string | null;
declare let updaterRunKind: string;
declare let updaterRestoringSnapshotName: string;
declare function findTreeState(treeKey: unknown): IAdapterTreeState | null;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function setTextShown(element: HTMLElement, text: string): void;
declare function drawActionCardState(actionCard: IActionCardView, reason: string, title: string): void;

// EVERY OBJECT STEP 2 DRAWS, ITS CHOSEN FIELDS IN ROW ORDER AND ITS WHERE (THE PARENT'S IS STEP 1'S); NAMES ONLY, AND THE HOST MATCHES THEM AGAINST THE CARD IT DREW
export function requestUpdaterRecords(treeState: IAdapterTreeState): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null || !treeState.updaterObjectStates) { return; }

    const objects: IUpdaterObjectRequest[] = treeState.updaterObjectStates.map(function (updaterObjectState) {
        const objectApiName = updaterObjectState.object.objectApiName;
        return {
            objectApiName: objectApiName,
            fieldApiNames: listUpdaterChoosableFieldStates(updaterObjectState)
                .filter(function (fieldState) { return hasOwnKey(treeState.updaterChosenFieldKeys, fieldState.fieldKey); })
                .map(function (fieldState) { return fieldState.field.fieldApiName; }),
            whereClause: objectApiName === treeState.updaterParentObjectApiName ? treeState.updaterParentWhereText
                : hasOwnKey(treeState.updaterWhereTexts, objectApiName) ? treeState.updaterWhereTexts[objectApiName] : ''
        };
    });

    if (objects.length === 0) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'load';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'loadUpdaterRecords', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence, parentObjectApiName: treeState.updaterParentObjectApiName, objects: objects });

}

/*
    "Generate values" (#417): every chosen field of this card, in the tab's order, with the value
    typed for it when there is one. The host checks each again, asks in the panel, and answers
    with updaterValues; the button is held until it says the run ended.
*/
export function requestUpdaterValues(treeState: IAdapterTreeState): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null || !treeState.updaterObjectStates || !treeState.updaterRecordsMessage) { return; }

    const fields: IUpdaterFieldValueRequest[] = [];
    treeState.updaterObjectStates.forEach(function (updaterObjectState) {
        listUpdaterChoosableFieldStates(updaterObjectState).forEach(function (fieldState) {
            if (fieldState.lockReason || !hasOwnKey(treeState.updaterChosenFieldKeys, fieldState.fieldKey)) { return; }
            const fieldRequest: IUpdaterFieldValueRequest = { objectApiName: updaterObjectState.object.objectApiName, fieldApiName: fieldState.field.fieldApiName };
            if (hasOwnKey(treeState.updaterEditedValues, fieldState.fieldKey)) { fieldRequest.value = treeState.updaterEditedValues[fieldState.fieldKey]; }
            fields.push(fieldRequest);
        });
    });

    if (fields.length === 0) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'generate';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'generateUpdaterValues', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence, fields: fields });

}

/*
    "Update records" (#418): the card's KEY and nothing else. What is written, to which records
    and in which org are the host's: the values it holds, which this card shows a preview of.
*/
export function requestUpdaterUpdate(treeState: IAdapterTreeState): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null || !treeState.updaterValuesMessage) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'update';
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'updateUpdaterRecords', treeKey: treeState.tree.treeKey });

}

// ASKED EACH TIME THE TAB IS SELECTED; ONE SELECTED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE OF THE PLACE) ASKS ONCE IT IS
export function requestUpdaterSnapshots(treeState: IAdapterTreeState): void {

    if (renderedSequence === null) {
        treeState.isUpdaterSnapshotsWanted = true;
        return;
    }

    treeState.isUpdaterSnapshotsWanted = false;
    vscodeApi.postMessage({ command: 'loadUpdaterSnapshots', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

}

// EVERY NAME WRITTEN WITH textContent; ONLY THE ACK BELOW MAKES RESTORE ROUTABLE ON THEM
export function renderUpdaterSnapshots(snapshotsMessage: IUpdaterSnapshotsMessage): void {

    if (renderedSequence === null || snapshotsMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(snapshotsMessage.treeKey);
    if (!treeState || !treeState.updaterSnapshotListElement) { return; }

    const listElement = treeState.updaterSnapshotListElement;
    const snapshotButtonElements: NonNullable<IAdapterTreeState['updaterSnapshotButtonElements']> = [];
    listElement.textContent = '';
    treeState.updaterSnapshotButtonElements = snapshotButtonElements;

    const snapshotNames: string[] = Array.isArray(snapshotsMessage.snapshotNames) ? snapshotsMessage.snapshotNames.filter(function (snapshotName): snapshotName is string { return typeof snapshotName === 'string'; }) : [];
    const hiddenSnapshotCount = Number(snapshotsMessage.hiddenSnapshotCount) || 0;

    if (snapshotNames.length === 0) {
        listElement.appendChild(createElement('div', 'updaterSnapshotsNote muted', RECIPE_COCKPIT_UPDATER_NO_SNAPSHOTS_NOTE));
    }

    snapshotNames.forEach(function (snapshotName) {
        const rowElement = createElement('div', 'updaterSnapshot');
        rowElement.appendChild(createElement('span', 'updaterSnapshotName', snapshotName));
        const restoreElement = createButton('secondary', 'updaterRestore', RECIPE_COCKPIT_UPDATER_RESTORE_LABEL, 'compact');
        restoreElement.setAttribute('aria-label', RECIPE_COCKPIT_UPDATER_RESTORE_LABEL + ' ' + snapshotName);
        restoreElement.addEventListener('click', function () { requestUpdaterRestore(treeState, snapshotName); });
        snapshotButtonElements.push({ element: restoreElement, snapshotName: snapshotName });
        rowElement.appendChild(restoreElement);
        listElement.appendChild(rowElement);
    });

    if (hiddenSnapshotCount > 0) {
        listElement.appendChild(createElement('div', 'updaterSnapshotsNote muted', hiddenSnapshotCount + ' older not shown: they are in RunArtifacts/UpdateAttempts in the tree folder, or in treecipe/UpdateAttempts for updates made before it.'));
    }

    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'updaterSnapshotsRendered', renderSequence: renderedSequence, treeKey: treeState.tree.treeKey, snapshotsSequence: snapshotsMessage.snapshotsSequence });

}

/*
    "Restore previous values…" (#419): the card's key and the snapshot's NAME, nothing else. The
    host reads the file, checks every part of it and asks before anything is written.
*/
function requestUpdaterRestore(treeState: IAdapterTreeState, snapshotName: string): void {

    if (renderedSequence === null || updaterLoadRunningTreeKey !== null) { return; }

    updaterLoadRunningTreeKey = treeState.tree.treeKey;
    updaterRunKind = 'restore';
    updaterRestoringSnapshotName = snapshotName;
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'restoreUpdaterSnapshot', treeKey: treeState.tree.treeKey, snapshotName: snapshotName });

}

function countUpdaterValueRecords(valuesMessage: IUpdaterValuesMessage): number {

    return (Array.isArray(valuesMessage.objects) ? valuesMessage.objects : []).reduce(function (total: number, generatedObject) {
        return total + (generatedObject ? Number(generatedObject.recordCount) || 0 : 0);
    }, 0);

}

// THE VALUES ARE DRAWN ONLY ON THE MODEL THEY WERE GENERATED ON, AND A TAB NOT YET BUILT DRAWS THEM WHEN IT IS
export function renderUpdaterValues(valuesMessage: IUpdaterValuesMessage): void {

    if (renderedSequence === null || valuesMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(valuesMessage.treeKey);
    if (!treeState) { return; }

    treeState.updaterValuesMessage = valuesMessage;
    if (treeState.updaterObjectStates) { applyUpdaterValues(treeState, valuesMessage); }
    drawUpdaterLoadButtons();
    // ONLY THIS ACK OFFERS "Update records" ON THESE VALUES (#418)
    vscodeApi.postMessage({ command: 'updaterValuesRendered', renderSequence: renderedSequence, valuesSequence: valuesMessage.valuesSequence });

}

export function applyUpdaterValues(treeState: IAdapterTreeState, valuesMessage: IUpdaterValuesMessage): void {

    const generatedObjects = Array.isArray(valuesMessage.objects) ? valuesMessage.objects : [];

    (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
        updaterObjectState.generatedValues = generatedObjects.find(function (generatedObject) { return generatedObject && generatedObject.objectApiName === updaterObjectState.object.objectApiName; }) || null;
        updaterObjectState.generatedValuesLinkSequence = valuesMessage.recordLinkSequence;
        drawUpdaterObjectValues(updaterObjectState);
    });

}

export function clearUpdaterValues(): void {

    treeStates.forEach(function (treeState) {
        if (!treeState.updaterValuesMessage) { return; }
        treeState.updaterValuesMessage = null;
        if (!treeState.updaterObjectStates) { return; }
        treeState.updaterObjectStates.forEach(function (updaterObjectState) {
            updaterObjectState.generatedValues = null;
            drawUpdaterObjectValues(updaterObjectState);
        });
    });

}

export function drawUpdaterObjectValues(updaterObjectState: IUpdaterObjectState): void {

    const valuesElement = updaterObjectState.valuesElement;
    if (!valuesElement) { return; }

    valuesElement.textContent = '';
    const generatedValues = updaterObjectState.generatedValues;

    if (!generatedValues) {
        valuesElement.classList.add('hidden');
        return;
    }

    const columns: string[] = Array.isArray(generatedValues.columns) ? generatedValues.columns.map(String) : [];
    const rows: unknown[] = Array.isArray(generatedValues.rows) ? generatedValues.rows : [];
    const recordCount = Number(generatedValues.recordCount) || 0;
    const hiddenColumnCount = Number(generatedValues.hiddenColumnCount) || 0;
    let summaryText = recordCount === 0
        ? 'No new values: the last load read no records of this object'
        : 'New values for ' + pluralize(recordCount, 'record', 'records') + ', not written to the org yet';
    if (rows.length < recordCount) { summaryText += '. Showing the first ' + rows.length; }
    if (hiddenColumnCount > 0) { summaryText += (rows.length < recordCount ? ', ' : '. Showing ') + pluralize(columns.length, 'column', 'columns') + ', ' + hiddenColumnCount + ' more not shown'; }

    valuesElement.appendChild(createElement('div', 'updaterValuesSummary muted', summaryText));
    if (columns.length > 0 && rows.length > 0) { valuesElement.appendChild(buildRecordTable(columns, rows, generatedValues.recordLinks, updaterObjectState.generatedValuesLinkSequence, updaterObjectState.object.objectApiName)); }
    valuesElement.classList.remove('hidden');

}

function countUpdaterLoadedRecords(recordsMessage: IUpdaterRecordsMessage): number {
    return (Array.isArray(recordsMessage.objects) ? recordsMessage.objects : []).reduce(function (total: number, loadedObject) {
        return total + (loadedObject ? Number(loadedObject.recordCount) || 0 : 0);
    }, 0);
}

export function drawUpdaterLoadButtons(): void {

    treeStates.forEach(function (treeState) {
        if (!treeState.updaterLoadButtonElement) { return; }
        const updaterObjectStates = treeState.updaterObjectStates || [];
        drawAdapterChildControls(treeState);
        const isThisCardLoading = updaterLoadRunningTreeKey === treeState.tree.treeKey;
        const busyReason = updaterLoadRunningTreeKey !== null ? 'Records are being loaded, generated, updated or restored.' : '';
        setTextShown(treeState.updaterLoadCard.titleElement, isThisCardLoading && updaterRunKind === 'load' ? RECIPE_COCKPIT_UPDATER_LOADING_LABEL : RECIPE_COCKPIT_UPDATER_LOAD_LABEL);
        if (treeState.updaterRetrieveMetadataElement) {
            treeState.updaterRetrieveMetadataElement.textContent = isThisCardLoading && updaterRunKind === 'retrieve' ? RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL : RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL;
            treeState.updaterRetrieveMetadataElement.disabled = updaterLoadRunningTreeKey !== null;
            treeState.updaterRetrieveMetadataElement.setAttribute('title', busyReason || RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE);
        }
        if (treeState.updaterApplyRetrievedElement) {
            const applyReason = busyReason || (countAdapterFileChanges(treeState) === 0 ? RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON : '');
            treeState.updaterApplyRetrievedElement.textContent = isThisCardLoading && updaterRunKind === 'apply' ? RECIPE_COCKPIT_ADAPTER_APPLYING_LABEL : RECIPE_COCKPIT_ADAPTER_APPLY_LABEL;
            treeState.updaterApplyRetrievedElement.disabled = applyReason !== '';
            treeState.updaterApplyRetrievedElement.setAttribute('title', applyReason || RECIPE_COCKPIT_ADAPTER_APPLY_TITLE);
        }
        drawActionCardState(treeState.updaterLoadCard, busyReason || (updaterObjectStates.length === 0 ? 'This tree has no object to load.' : ''),
            'Read this tree’s records, with the fields you chose, from the sandbox or scratch org chosen in Target Org Manager. It only reads.');
        (treeState.updaterSnapshotButtonElements || []).forEach(function (snapshotButton) {
            const isThisRestoring = isThisCardLoading && updaterRunKind === 'restore' && updaterRestoringSnapshotName === snapshotButton.snapshotName;
            snapshotButton.element.disabled = updaterLoadRunningTreeKey !== null;
            snapshotButton.element.textContent = isThisRestoring ? RECIPE_COCKPIT_UPDATER_RESTORING_LABEL : RECIPE_COCKPIT_UPDATER_RESTORE_LABEL;
            snapshotButton.element.setAttribute('title', 'Set each record this update changed back to the value it held before, by Id, in the sandbox selected in Target Org Manager. The values they hold now are saved to RunArtifacts in the tree folder first.');
        });

        if (!treeState.updaterGenerateCard) { return; }
        const hasChosenField = updaterObjectStates.some(function (updaterObjectState) { return updaterObjectState.chosenFieldCount > 0; });
        const generateReason = !treeState.updaterRecordsMessage ? 'Load records first: new values are generated for the records the last load read.'
            : countUpdaterLoadedRecords(treeState.updaterRecordsMessage) === 0 ? RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON
            : !hasChosenField ? 'Choose a field to fill first.'
            : '';
        setTextShown(treeState.updaterGenerateCard.titleElement, isThisCardLoading && updaterRunKind === 'generate' ? RECIPE_COCKPIT_UPDATER_GENERATING_LABEL : RECIPE_COCKPIT_UPDATER_GENERATE_LABEL);
        drawActionCardState(treeState.updaterGenerateCard, generateReason || busyReason,
            'Make a new value for every loaded record of each chosen field, from its faker expression or the value you typed. Nothing is written to the org.');

        if (!treeState.updaterUpdateCard) { return; }
        const valueRecordCount = treeState.updaterValuesMessage ? countUpdaterValueRecords(treeState.updaterValuesMessage) : 0;
        const orgLabel = treeState.updaterRecordsMessage ? String(treeState.updaterRecordsMessage.orgLabel || '') : '';
        const updateReason = treeState.updaterRecordsMessage && countUpdaterLoadedRecords(treeState.updaterRecordsMessage) === 0 ? RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON
            : !treeState.updaterValuesMessage ? 'Generate values first: the update writes the values the last Generate values made.'
            : valueRecordCount === 0 ? 'There are no new values to write: the last load read no records.'
            : '';
        setTextShown(treeState.updaterUpdateCard.titleElement, isThisCardLoading && updaterRunKind === 'update'
            ? RECIPE_COCKPIT_UPDATER_UPDATING_LABEL
            : valueRecordCount > 0
                ? 'Update ' + pluralize(valueRecordCount, 'record', 'records') + (orgLabel ? ' in ' + orgLabel : '')
                : RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);
        drawActionCardState(treeState.updaterUpdateCard, updateReason || busyReason,
            'Write the new values to these records by Id, in the sandbox they were loaded from. Their old values are saved to RunArtifacts in the tree folder first.');
    });

}

// THE RECORDS ARE DRAWN ONLY ON THE MODEL THEY WERE LOADED ON, AND A TAB NOT YET BUILT DRAWS THEM WHEN IT IS
export function renderUpdaterRecords(recordsMessage: IUpdaterRecordsMessage): void {

    if (renderedSequence === null || recordsMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(recordsMessage.treeKey);
    if (!treeState) { return; }

    treeState.updaterRecordsMessage = recordsMessage;
    if (treeState.updaterObjectStates) { applyUpdaterRecords(treeState, recordsMessage); }

}

export function applyUpdaterRecords(treeState: IAdapterTreeState, recordsMessage: IUpdaterRecordsMessage): void {

    const loadedObjects = Array.isArray(recordsMessage.objects) ? recordsMessage.objects : [];
    let recordCount = 0;

    (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
        const loadedRecords: IUpdaterPreviewObject | null = loadedObjects.find(function (loadedObject) { return loadedObject && loadedObject.objectApiName === updaterObjectState.object.objectApiName; }) || null;
        updaterObjectState.loadedRecords = loadedRecords;
        updaterObjectState.loadedRecordsLinkSequence = recordsMessage.recordLinkSequence;
        if (loadedRecords && !loadedRecords.failureMessage && !loadedRecords.skippedReason) { recordCount += Number(loadedRecords.recordCount) || 0; }
        drawUpdaterObjectCount(updaterObjectState);
        drawUpdaterObjectRecords(updaterObjectState);
    });

    treeState.updaterLoadNoteElement.textContent = 'Loaded ' + pluralize(recordCount, 'record', 'records') + ' from ' + String(recordsMessage.orgLabel || 'the org');
    drawUpdaterLoadButtons();

}

export function clearUpdaterRecords(): void {

    treeStates.forEach(function (treeState) {
        if (!treeState.updaterRecordsMessage) { return; }
        treeState.updaterRecordsMessage = null;
        if (!treeState.updaterObjectStates) { return; }
        treeState.updaterObjectStates.forEach(function (updaterObjectState) {
            updaterObjectState.loadedRecords = null;
            drawUpdaterObjectCount(updaterObjectState);
            drawUpdaterObjectRecords(updaterObjectState);
        });
        treeState.updaterLoadNoteElement.textContent = '';
    });
    drawUpdaterLoadButtons();

}

export function drawUpdaterObjectRecords(updaterObjectState: IUpdaterObjectState): void {

    const recordsElement = updaterObjectState.recordsElement;
    if (!recordsElement) { return; }

    recordsElement.textContent = '';
    const loadedRecords = updaterObjectState.loadedRecords;

    if (!loadedRecords) {
        recordsElement.classList.add('hidden');
        return;
    }

    if (loadedRecords.failureMessage) {
        recordsElement.appendChild(createElement('div', 'updaterRecordsFailure', 'Could not be read: ' + String(loadedRecords.failureMessage)));
    } else if (loadedRecords.skippedReason) {
        recordsElement.appendChild(createElement('div', 'updaterRecordsSkipped muted', String(loadedRecords.skippedReason)));
    } else {
        const columns: string[] = Array.isArray(loadedRecords.columns) ? loadedRecords.columns.map(String) : [];
        const rows: unknown[] = Array.isArray(loadedRecords.rows) ? loadedRecords.rows : [];
        const recordCount = Number(loadedRecords.recordCount) || 0;
        const hiddenColumnCount = Number(loadedRecords.hiddenColumnCount) || 0;
        let summaryText = pluralize(recordCount, 'record', 'records');
        if (loadedRecords.isTruncated) { summaryText += ', the first of ' + String(loadedRecords.totalSize) + ' it matched'; }
        if (rows.length < recordCount) { summaryText += '. Showing the first ' + rows.length; }
        if (hiddenColumnCount > 0) { summaryText += (rows.length < recordCount ? ', ' : '. Showing ') + pluralize(columns.length, 'column', 'columns') + ', ' + hiddenColumnCount + ' more not shown'; }
        recordsElement.appendChild(createElement('div', 'updaterRecordsSummary muted', summaryText));
        if (columns.length > 0) { recordsElement.appendChild(buildRecordTable(columns, rows, loadedRecords.recordLinks, updaterObjectState.loadedRecordsLinkSequence, updaterObjectState.object.objectApiName)); }
    }

    recordsElement.classList.remove('hidden');

}
