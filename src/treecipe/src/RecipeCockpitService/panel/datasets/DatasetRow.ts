import { createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_DATASET_ADAPTED_LABEL,
    RECIPE_COCKPIT_DATASET_INSERT_INTERRUPTED_NOTE,
    RECIPE_COCKPIT_DATASET_INSERT_RESULTS_LABEL,
    RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY,
    RECIPE_COCKPIT_DATASET_INSERT_UNRECORDED_NOTE,
    RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH,
    RECIPE_COCKPIT_DATASET_RECORD_TYPES_LABEL_PREFIX,
    RECIPE_COCKPIT_FAVORITE_TREE_LABEL,
    RECIPE_COCKPIT_INSERT_RUNNING_LABEL,
    RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL,
    RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON,
    RecipeCockpitDatasetInsertStatus
} from '../../RecipeCockpitDatasetsTabConstants';
import { buildPencilGlyph } from '../RecipeCockpitPanelBuilders';
import { buildDatasetJourneyToggle, setDatasetJourneyExpanded } from './DatasetJourney';
import { IDataset, IDatasetRecordCount, IDatasetRecordCountsMessage, IDatasetRecordTypes, IDatasetRowState, IDatasetsTreeState, INameEditor } from './DatasetTypes';

/*
    One row of the Previously Used Data Sets tab (#226, #312, #469, #621, #642): its name and star,
    record types, record counts, newest insert and Insert…. These names are the panel script's own,
    read when a function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const treeStates: IDatasetsTreeState[];
declare const dataOrgLabels: string[] | null;
declare const dataOrgSelectedIndex: number | null;
declare const insertRunningTreeKey: string | null;
declare const insertRunningDatasetFolderName: string | null;
declare const isDataOrgChecking: boolean;
declare const isScratchOrgRunning: boolean;
declare const isPermissionSetAssignRunning: boolean;
declare const isMetadataDeployRunning: boolean;
// THE SCRIPT EMPTIES BOTH FOR EVERY NEW MODEL, SO THEY ARE READ FROM IT AT EACH CALL
declare let pendingDatasetCountElements: Record<string, HTMLElement[]>;
declare let answeredDatasetCounts: Record<string, IDatasetRecordCountsMessage>;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;
// THE TREECIPE TAB AND THE HISTORY SUB-TAB USE THESE TOO, SO THEY MOVE WITH THE TREECIPE TAB (#643)
declare function versionLabelOf(treeState: IDatasetsTreeState, runFolderName: string | null): string;
declare function buildNameEditor(nameEditorOptions: {
    nameTarget: string;
    nameKey: string;
    maxLength: number;
    openerElement: HTMLElement;
    displayElement: HTMLElement;
    placeholderText: string;
    readCustomName: () => string;
    readDisplayName: () => string;
    onClose: () => void;
}): INameEditor;

function formatRecordCounts(recordCounts: IDatasetRecordCount[]): string {

    if (recordCounts.length === 0) { return 'no records'; }

    return recordCounts.map(function (recordCount) {
        return recordCount.objectApiName + ': ' + pluralize(recordCount.recordCount, 'record', 'records');
    }).join(' · ');

}

function drawDatasetRecordCounts(countsElement: HTMLElement, recordCountsMessage: IDatasetRecordCountsMessage): void {

    const countsText = recordCountsMessage.recordCounts.length > 0 || !recordCountsMessage.failureMessage
        ? formatRecordCounts(recordCountsMessage.recordCounts)
        : '';

    countsElement.textContent = [countsText, recordCountsMessage.failureMessage].filter(function (countsPart) { return !!countsPart; }).join(' · ');

}

// A DATA SET FROM BEFORE datasetSource.json HAS ITS COUNTS READ WHEN IT IS EXPANDED, ONCE PER MODEL
function requestDatasetRecordCounts(datasetFolderName: string, countsElement: HTMLElement): void {

    if (Object.prototype.hasOwnProperty.call(answeredDatasetCounts, datasetFolderName)) {
        drawDatasetRecordCounts(countsElement, answeredDatasetCounts[datasetFolderName]);
        return;
    }

    countsElement.textContent = 'Loading record counts…';

    if (Object.prototype.hasOwnProperty.call(pendingDatasetCountElements, datasetFolderName)) {
        pendingDatasetCountElements[datasetFolderName].push(countsElement);
        return;
    }

    pendingDatasetCountElements[datasetFolderName] = [countsElement];
    vscodeApi.postMessage({ command: 'loadDatasetRecordCounts', datasetFolderName: datasetFolderName });

}

export function renderDatasetRecordCounts(recordCountsMessage: IDatasetRecordCountsMessage): void {

    if (recordCountsMessage.renderSequence !== renderedSequence) { return; }

    const datasetFolderName = recordCountsMessage.datasetFolderName;
    answeredDatasetCounts[datasetFolderName] = recordCountsMessage;

    if (!Object.prototype.hasOwnProperty.call(pendingDatasetCountElements, datasetFolderName)) { return; }

    const countsElements = pendingDatasetCountElements[datasetFolderName];
    delete pendingDatasetCountElements[datasetFolderName];

    countsElements.forEach(function (countsElement) { drawDatasetRecordCounts(countsElement, recordCountsMessage); });

}

function buildHistoryAction(className: string, labelText: string, titleText: string, hostMessage: object): HTMLButtonElement {

    const actionElement = createButton('secondary', 'historyAction ' + className, labelText);
    actionElement.setAttribute('title', titleText);
    actionElement.addEventListener('click', function () { vscodeApi.postMessage(hostMessage); });
    return actionElement;

}

// "Record types: Account · Business, Partner; Contact · Customer" (#621)
function formatDatasetRecordTypes(recordTypes: IDatasetRecordTypes[]): string {

    return RECIPE_COCKPIT_DATASET_RECORD_TYPES_LABEL_PREFIX + recordTypes.map(function (recordType) {
        return recordType.objectApiName + ' · ' + recordType.developerNames.join(', ');
    }).join('; ');

}

/*
    ONE DATA SET: ITS OWN NAME AND STAR, WHEN, WHICH VERSION, ITS RECORD COUNTS, AND OPEN /
    INSERT BY FOLDER NAME. ☆ POSTS THE FOLDER NAME ONLY; ✎ OPENS THE ROW'S INLINE NAME BOX (#551).
*/
export function buildDatasetRowState(treeState: IDatasetsTreeState, dataset: IDataset): IDatasetRowState {

    const datasetElement = createElement('div', 'treeDataset');
    const datasetHeaderElement = createElement('div', 'treeDatasetHeader sdtRowHeader');
    // #558: WHAT A READER DECIDES ON (NAME, STATUS, ACTIONS) IS LINE ONE; WHEN AND HOW IT WAS MADE IS LINE TWO, LED BY THE ▸
    const primaryLineElement = createElement('div', 'sdtRowHeaderPrimary');
    const detailLineElement = createElement('div', 'sdtRowHeaderDetail');
    const countsElement = createElement('div', 'treeDatasetCounts muted');
    const actionMessage = { datasetFolderName: dataset.datasetFolderName, treeKey: treeState.tree.treeKey, tab: 'datasets' };
    // FILLED IN BELOW IN THE ORDER THE ROW IS DRAWN; THE NAME EDITOR AND THE JOURNEY TOGGLE CLOSE OVER IT
    const rowState = { element: datasetElement, dataset: dataset, searchText: '', nameElement: null, favoriteElement: null, renameElement: null } as unknown as IDatasetRowState;

    rowState.favoriteElement = createButton('secondary', 'historyAction treeDatasetFavorite');
    rowState.favoriteElement.addEventListener('click', function () {
        vscodeApi.postMessage({ command: 'toggleFavoriteDataset', datasetFolderName: dataset.datasetFolderName });
    });
    primaryLineElement.appendChild(rowState.favoriteElement);

    rowState.renameElement = createButton('secondary', 'historyAction treeDatasetRename');
    rowState.renameElement.appendChild(buildPencilGlyph('default'));
    primaryLineElement.appendChild(rowState.renameElement);

    rowState.nameElement = createElement('span', 'treeDatasetName');
    primaryLineElement.appendChild(rowState.nameElement);

    // THE RECORD TYPES ITS RECORDS CARRY (#621), BESIDE THE NAME A READER PICKS A DATA SET BY; ITS OWN CLASS, SO NO .recordTypeChip SELECTOR FINDS IT
    if (dataset.recordTypes) {
        const recordTypesText = formatDatasetRecordTypes(dataset.recordTypes);
        const recordTypesChipElement = createElement('span', 'treeDatasetRecordTypes', recordTypesText);
        recordTypesChipElement.setAttribute('title', 'Generated with ' + recordTypesText);
        primaryLineElement.appendChild(recordTypesChipElement);
    }

    rowState.nameEditor = buildNameEditor({
        nameTarget: 'dataset',
        nameKey: dataset.datasetFolderName,
        maxLength: RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH,
        openerElement: rowState.renameElement,
        displayElement: rowState.nameElement,
        placeholderText: dataset.datasetFolderName,
        readCustomName: function () { return rowState.dataset.customName || ''; },
        readDisplayName: function () { return rowState.dataset.customName || rowState.dataset.datasetFolderName; },
        onClose: function () { drawDatasetName(rowState); }
    });

    // SLOTS DRAW NO BOX OF THEIR OWN, SO A ROW NEVER INSERTED LOOKS AS IT ALWAYS DID; A LATER INSERT REFILLS THEM IN PLACE
    rowState.lastInsertSlotElement = createElement('span', 'treeDatasetInsertSlot');
    primaryLineElement.appendChild(rowState.lastInsertSlotElement);

    primaryLineElement.appendChild(buildHistoryAction('treeDatasetOpen', 'Open', 'Reveal the folder of this data set in the Explorer',
        Object.assign({ command: 'openDataset' }, actionMessage)));
    rowState.lastInsertResultsSlotElement = createElement('span', 'treeDatasetInsertSlot');
    primaryLineElement.appendChild(rowState.lastInsertResultsSlotElement);
    // THE TARGET ORG MANAGER'S SELECTION IS POSTED BY INDEX AT THE CLICK (#541); WITH NONE THE HOST ASKS FOR THE ORG
    rowState.insertElement = createButton('secondary', 'historyAction treeDatasetInsert', 'Insert…');
    rowState.insertElement.addEventListener('click', function () {
        const insertMessage: { command: string; orgIndex?: number } = Object.assign({ command: 'insertDataset' }, actionMessage);
        if (dataOrgSelectedIndex !== null) { insertMessage.orgIndex = dataOrgSelectedIndex; }
        vscodeApi.postMessage(insertMessage);
    });
    primaryLineElement.appendChild(rowState.insertElement);

    rowState.journeyToggleElement = buildDatasetJourneyToggle(treeState, rowState);
    detailLineElement.appendChild(rowState.journeyToggleElement);

    detailLineElement.appendChild(createElement('span', 'treeDatasetDate', dataset.generatedAtLabel));
    detailLineElement.appendChild(createElement('span', 'treeDatasetBackend muted', dataset.fakerService));

    // A DATA SET THE TREECIPE ADAPTER WROTE (#448), SAID IN TEXT SO THE LABEL IS NEVER COLOUR ALONE
    if (dataset.isAdapted === true) {
        detailLineElement.appendChild(createElement('span', 'treeDatasetAdapted muted', RECIPE_COCKPIT_DATASET_ADAPTED_LABEL));
    }

    detailLineElement.appendChild(createElement('span', dataset.runFolderName === null ? 'treeDatasetVersion unknownVersion' : 'treeDatasetVersion', versionLabelOf(treeState, dataset.runFolderName)));

    detailLineElement.appendChild(createElement('span', 'treeDatasetFolder muted', dataset.datasetFolderName));

    datasetHeaderElement.appendChild(primaryLineElement);
    datasetHeaderElement.appendChild(detailLineElement);
    datasetElement.appendChild(datasetHeaderElement);
    datasetElement.appendChild(countsElement);
    datasetElement.appendChild(rowState.journeyElement);

    // A LEGACY DATA SET'S COUNTS ARE READ FROM ITS COLLECTIONS API FILES, WHICH HOLD EVERY RECORD, SO ONLY WHEN THE ROW'S OWN BUTTON ASKS
    if (dataset.recordCounts) {
        countsElement.textContent = formatRecordCounts(dataset.recordCounts);
    } else {
        const loadCountsElement = createButton('secondary', 'historyAction treeDatasetCountsLoad', 'Show record counts');
        loadCountsElement.setAttribute('title', 'Count the records in the Collections API files of this data set');
        loadCountsElement.addEventListener('click', function () { requestDatasetRecordCounts(dataset.datasetFolderName, countsElement); });
        countsElement.appendChild(loadCountsElement);
    }

    drawDatasetLastInsert(rowState);
    drawDatasetName(rowState);
    drawDatasetInsert(rowState);

    if (treeState.expandedJourneyDatasetFolderNames[dataset.datasetFolderName] === true) {
        setDatasetJourneyExpanded(treeState, rowState, true, false);
    }

    return rowState;

}

// ONE INSERT AT A TIME, AND NONE WHILE A RUN HOLDS THE ORG SELECTION; THE TOOLTIP NAMES THE TARGET ORG MANAGER'S ORG (#541)
function drawDatasetInsert(rowState: IDatasetRowState): void {

    const insertElement = rowState.insertElement;
    if (!insertElement) { return; }

    const orgLabel = dataOrgLabels && dataOrgSelectedIndex !== null && dataOrgLabels[dataOrgSelectedIndex] ? dataOrgLabels[dataOrgSelectedIndex] : '';
    // WHILE THE ORGS ARE CHECKED THE SELECTION IS CLEARED, SO A CLICK WOULD ASK FOR AN ORG BESIDE THE LISTING IN FLIGHT
    insertElement.disabled = insertRunningTreeKey !== null || isDataOrgChecking || isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
    insertElement.textContent = insertRunningDatasetFolderName === rowState.dataset.datasetFolderName ? RECIPE_COCKPIT_INSERT_RUNNING_LABEL : 'Insert…';
    insertElement.setAttribute('title', isDataOrgChecking ? RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON
        : orgLabel ? 'Insert this data set into ' + orgLabel + ', the org selected in the Target Org Manager'
        : 'Choose the org to insert this data set into');

}

export function drawDatasetInserts(): void {
    treeStates.forEach(function (treeState) {
        (treeState.datasetRowStates || []).forEach(drawDatasetInsert);
    });
}

// THE ROW'S NAME AND STAR, DRAWN AT FIRST AND AGAIN WHEN THE HOST SAYS EITHER CHANGED; THE SEARCH MATCHES THE NAME TOO
export function drawDatasetName(rowState: IDatasetRowState): void {

    const dataset = rowState.dataset;
    const displayName = dataset.customName || dataset.datasetFolderName;

    rowState.nameElement.textContent = dataset.customName || '';
    // AN OPEN RENAME BOX STANDS IN THE NAME'S PLACE UNTIL IT CLOSES, WHICH DRAWS THE NAME AGAIN
    const isNameEditorOpen = !!(rowState.nameEditor && rowState.nameEditor.isOpen);
    if (dataset.customName && !isNameEditorOpen) { rowState.nameElement.classList.remove('hidden'); } else { rowState.nameElement.classList.add('hidden'); }

    rowState.favoriteElement.textContent = dataset.isFavorite ? RECIPE_COCKPIT_FAVORITE_TREE_LABEL : RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL;
    rowState.favoriteElement.setAttribute('aria-pressed', dataset.isFavorite ? 'true' : 'false');
    rowState.favoriteElement.setAttribute('aria-label', dataset.isFavorite ? 'Remove ' + displayName + ' from favorites' : 'Mark ' + displayName + ' as a favorite');
    rowState.favoriteElement.setAttribute('title', dataset.isFavorite ? 'Remove from favorites' : 'Mark as a favorite');

    rowState.renameElement.setAttribute('aria-label', 'Rename ' + displayName);
    rowState.renameElement.setAttribute('title', 'Rename this data set');

    rowState.searchText = (dataset.datasetFolderName + '\n' + (dataset.customName || '') + '\n' + (rowState.lastInsertSearchText || '')).toLowerCase();

}

/*
    A data set's newest insert (#469): a chip whose emoji the label repeats in words, a tooltip
    with when, where and how many, and "View results" when the host found its results file.
    Absent for a data set never inserted, which draws as it always did.
*/
export function drawDatasetLastInsert(rowState: IDatasetRowState): void {

    rowState.lastInsertSlotElement.textContent = '';
    rowState.lastInsertResultsSlotElement.textContent = '';
    rowState.lastInsertSearchText = '';

    const lastInsertElements = buildDatasetLastInsertElements(rowState.dataset);
    if (!lastInsertElements) { return; }

    rowState.lastInsertSlotElement.appendChild(lastInsertElements.statusElement);
    if (lastInsertElements.resultsElement) {
        rowState.lastInsertResultsSlotElement.appendChild(lastInsertElements.resultsElement);
    }
    rowState.lastInsertSearchText = lastInsertElements.searchText;

}

function buildDatasetLastInsertElements(dataset: IDataset): { statusElement: HTMLElement; resultsElement: HTMLButtonElement | null; searchText: string } | null {

    const lastInsert = dataset.lastInsert;
    if (!lastInsert || !hasOwnKey(RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY, lastInsert.status)) {
        return null;
    }

    const statusDisplay = RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY[lastInsert.status as RecipeCockpitDatasetInsertStatus];
    const statusElement = createElement('span', 'treeDatasetInsertStatus treeDatasetInsertStatus-' + lastInsert.status);
    const emojiElement = createElement('span', 'treeDatasetInsertStatusEmoji', statusDisplay.emoji);
    emojiElement.setAttribute('aria-hidden', 'true');
    statusElement.appendChild(emojiElement);
    statusElement.appendChild(createElement('span', 'treeDatasetInsertStatusLabel', statusDisplay.label));

    const detailParts = ['Last insert: ' + lastInsert.attemptedAtLabel + (typeof lastInsert.orgLabel === 'string' ? ' into ' + lastInsert.orgLabel : '')];
    const notes: string[] = [];
    if (lastInsert.isInterrupted === true) { notes.push(RECIPE_COCKPIT_DATASET_INSERT_INTERRUPTED_NOTE); }
    if (lastInsert.isOutcomeUnrecorded === true) { notes.push(RECIPE_COCKPIT_DATASET_INSERT_UNRECORDED_NOTE); }
    if (typeof lastInsert.savedRecordCount === 'number') {
        detailParts.push(lastInsert.savedRecordCount + (lastInsert.savedRecordCount === 1 ? ' record saved' : ' records saved'));
    }
    if (typeof lastInsert.failedRecordCount === 'number') {
        detailParts.push(lastInsert.failedRecordCount + (lastInsert.failedRecordCount === 1 ? ' record failed' : ' records failed'));
    }
    const detailText = detailParts.join(' · ') + notes.map(function (note) { return '. ' + note; }).join('');
    statusElement.setAttribute('title', detailText);
    // A SPAN'S aria-label IS READ ONLY WITH A ROLE: THE CHIP IS ONE IMAGE OF ITS STATE, NAMED IN WORDS
    statusElement.setAttribute('role', 'img');
    statusElement.setAttribute('aria-label', statusDisplay.label + '. ' + detailText);

    let resultsElement: HTMLButtonElement | null = null;
    if (lastInsert.hasResultsFile === true) {
        resultsElement = buildHistoryAction('treeDatasetInsertResults', RECIPE_COCKPIT_DATASET_INSERT_RESULTS_LABEL, 'Open the results file of the last insert of this data set',
            { command: 'viewDatasetInsertResults', datasetFolderName: dataset.datasetFolderName });
    }

    return { statusElement: statusElement, resultsElement: resultsElement, searchText: statusDisplay.label };

}
