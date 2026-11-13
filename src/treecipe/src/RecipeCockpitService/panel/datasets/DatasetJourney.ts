import { createButton, createElement, drawToggle, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_DATASET_JOURNEY_COLUMNS,
    RECIPE_COCKPIT_DATASET_JOURNEY_FIRST_TIME_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_SORT_COLUMNS,
    RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY,
    RECIPE_COCKPIT_DATASET_JOURNEY_TOGGLE_LABEL,
    RECIPE_COCKPIT_DATASET_JOURNEY_VIEW_FILE_LABEL
} from '../../RecipeCockpitDatasetsTabConstants';
import type { RunHistoryRowStatus } from '../../RecipeCockpitTroubleshootingConstants';
import { buildRowTable, buildToggleElement } from '../RecipeCockpitPanelBuilders';
import { DatasetJourneySortColumn, IDatasetJourneyEntry, IDatasetJourneyFile, IDatasetJourneyMessage, IDatasetJourneySort, IDatasetRowState, IDatasetsTreeState } from './DatasetTypes';

/*
    A data set's insert journey (#471): a ▸ on every row. A row never inserted opens to "No
    inserts yet" without asking the host; any other asks for its timeline the first time it opens
    for a model (loadDatasetJourney), which is never posted with the model. Every value is written
    with textContent, and a file opens by its index in the entries the host posted. These names
    are the panel script's own, read when a function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const treeStates: IDatasetsTreeState[];
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;

let datasetJourneyCount = 0;

export function buildDatasetJourneyToggle(treeState: IDatasetsTreeState, rowState: IDatasetRowState): HTMLElement {

    const toggleElement = buildToggleElement('treeDatasetJourneyToggle');
    const journeyId = 'treeDatasetJourney' + (++datasetJourneyCount);
    rowState.journeyElement = createElement('div', 'treeDatasetJourney hidden');
    rowState.journeyElement.setAttribute('id', journeyId);
    toggleElement.setAttribute('aria-controls', journeyId);
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_DATASET_JOURNEY_TOGGLE_LABEL + ': ' + rowState.dataset.datasetFolderName);
    toggleElement.setAttribute('title', 'Show every insert of this data set and the Troubleshooting steps between them');
    drawToggle(toggleElement, false, false);
    toggleElement.addEventListener('click', function () {
        setDatasetJourneyExpanded(treeState, rowState, rowState.isJourneyExpanded !== true, true);
        savePanelPlace();
    });

    return toggleElement;

}

export function setDatasetJourneyExpanded(treeState: IDatasetsTreeState, rowState: IDatasetRowState, isExpanded: boolean, isAnimated: boolean): void {

    const datasetFolderName = rowState.dataset.datasetFolderName;
    rowState.isJourneyExpanded = isExpanded;
    if (isExpanded) { treeState.expandedJourneyDatasetFolderNames[datasetFolderName] = true; } else { delete treeState.expandedJourneyDatasetFolderNames[datasetFolderName]; }
    drawToggle(rowState.journeyToggleElement, isExpanded, isAnimated);
    setShownWithMotion(rowState.journeyElement, isExpanded, isAnimated);

    if (!isExpanded) { return; }

    if (!rowState.dataset.lastInsert) {
        rowState.journeyElement.textContent = '';
        rowState.journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted', RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE));
        return;
    }

    // AN ANSWER THAT ARRIVED WHILE THE ROW WAS CLOSED IS DRAWN NOW, NOT ASKED FOR AGAIN
    if (rowState.journeyMessage) {
        drawDatasetJourney(rowState);
        return;
    }

    requestDatasetJourney(rowState);

}

// ASKED ONCE PER MODEL PER ROW; ONE OPENED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE) ASKS ONCE IT IS
export function requestDatasetJourney(rowState: IDatasetRowState): void {

    if (rowState.isJourneyRequested) { return; }

    if (!rowState.journeyMessage) {
        rowState.journeyElement.textContent = '';
        rowState.journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted', RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE));
    }

    if (renderedSequence === null) {
        rowState.isJourneyWanted = true;
        return;
    }

    rowState.isJourneyWanted = false;
    rowState.isJourneyRequested = true;
    vscodeApi.postMessage({ command: 'loadDatasetJourney', datasetFolderName: rowState.dataset.datasetFolderName, renderSequence: renderedSequence });

}

export function renderDatasetJourney(journeyMessage: IDatasetJourneyMessage): void {

    if (renderedSequence === null || journeyMessage.renderSequence !== renderedSequence || typeof journeyMessage.datasetFolderName !== 'string') { return; }

    let isDrawn = false;
    treeStates.forEach(function (treeState) {
        (treeState.datasetRowStates || [])
            .filter(function (rowState) { return rowState.dataset.datasetFolderName === journeyMessage.datasetFolderName; })
            .forEach(function (rowState) {
                rowState.journeyMessage = journeyMessage;
                if (rowState.isJourneyExpanded && rowState.dataset.lastInsert) {
                    drawDatasetJourney(rowState);
                }
                isDrawn = true;
            });
    });

    if (isDrawn) {
        vscodeApi.postMessage({ command: 'datasetJourneyRendered', renderSequence: renderedSequence, datasetFolderName: journeyMessage.datasetFolderName, journeySequence: journeyMessage.journeySequence });
    }

}

function drawDatasetJourney(rowState: IDatasetRowState): void {

    const journeyMessage = rowState.journeyMessage as IDatasetJourneyMessage;
    const journeyElement = rowState.journeyElement;
    const entries: IDatasetJourneyEntry[] = Array.isArray(journeyMessage.entries) ? journeyMessage.entries : [];
    journeyElement.textContent = '';

    if (entries.length === 0) {
        journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted', RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE));
        return;
    }

    if (!rowState.journeySort) { rowState.journeySort = { column: 'time', isDescending: true }; }
    const journeySort = rowState.journeySort;
    const rowTable = buildRowTable({
        className: 'treeDatasetJourneyTable',
        columnClassName: 'treeDatasetJourney',
        columns: RECIPE_COCKPIT_DATASET_JOURNEY_COLUMNS,
        sortColumns: RECIPE_COCKPIT_DATASET_JOURNEY_SORT_COLUMNS,
        sort: journeySort,
        onSort: function (column) { sortDatasetJourney(rowState, column as DatasetJourneySortColumn); }
    });
    rowState.journeySortButtons = rowTable.sortButtons;
    sortDatasetJourneyEntries(journeySort, entries).forEach(function (placedEntry) {
        rowTable.bodyElement.appendChild(buildDatasetJourneyEntry(rowState, journeyMessage, placedEntry.entry));
    });
    journeyElement.appendChild(rowTable.wrapElement);

    const hiddenEntryCount = journeyMessage.hiddenEntryCount as number;
    const otherOrgStepCount = journeyMessage.otherOrgStepCount as number;
    const untrackedStepCount = journeyMessage.untrackedStepCount as number;

    // THE TABLE OPENS NEWEST FIRST, SO THE OLDEST ENTRIES THE CAP DROPPED ARE SAID UNDER IT, AS HISTORY DOES
    if (hiddenEntryCount > 0) {
        journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted',
            pluralize(hiddenEntryCount, 'earlier entry is', 'earlier entries are') + ' not shown.'));
    }

    if (entries.length === 1 && entries[0].kind === 'insert' && entries[0].status === 'succeeded' && !(hiddenEntryCount > 0)) {
        journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted', RECIPE_COCKPIT_DATASET_JOURNEY_FIRST_TIME_NOTE));
    }
    if (otherOrgStepCount > 0) {
        journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted',
            pluralize(otherOrgStepCount, 'Troubleshooting step', 'Troubleshooting steps') + ' of this tree in this time ran against another org, so ' + (otherOrgStepCount === 1 ? 'it is' : 'they are') + ' not shown.'));
    }
    if (untrackedStepCount > 0) {
        journeyElement.appendChild(createElement('div', 'treeDatasetJourneyNote muted',
            pluralize(untrackedStepCount, 'step', 'steps') + ' in treecipe/OrgOperations, which records no tree, ran in this time and ' + (untrackedStepCount === 1 ? 'is' : 'are') + ' not placed on this timeline.'));
    }

}

function datasetJourneyStatusOf(entry: IDatasetJourneyEntry): { emoji: string; label: string } {

    return hasOwnKey(RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY, entry.status) ? RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY[entry.status as RunHistoryRowStatus] : { emoji: '', label: String(entry.status) };

}

// ENTRIES COME OLDEST FIRST WITH NO TIME VALUE, SO TIME SORTS BY THAT PLACE, WHICH ALSO BREAKS EVERY TIE, NEWEST FIRST
function sortDatasetJourneyEntries(sort: IDatasetJourneySort, entries: IDatasetJourneyEntry[]): Array<{ entry: IDatasetJourneyEntry; place: number }> {

    const sortValueOf = function (placedEntry: { entry: IDatasetJourneyEntry; place: number }): number | string {
        if (sort.column === 'time') { return placedEntry.place; }
        if (sort.column === 'step') { return String(placedEntry.entry.kindLabel).toLowerCase(); }
        if (sort.column === 'org') { return typeof placedEntry.entry.orgLabel === 'string' ? placedEntry.entry.orgLabel.toLowerCase() : ''; }
        return datasetJourneyStatusOf(placedEntry.entry).label.toLowerCase();
    };

    return entries
        .map(function (entry, place) { return { entry: entry, place: place }; })
        .sort(function (first, second) {
            const firstValue = sortValueOf(first);
            const secondValue = sortValueOf(second);
            const order = firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
            if (order !== 0) { return sort.isDescending ? -order : order; }
            return second.place - first.place;
        });

}

// A HEADER CLICK SORTS BY ITS COLUMN; THE SAME COLUMN AGAIN TURNS THE ORDER. TIME STARTS NEWEST FIRST, THE REST A TO Z
function sortDatasetJourney(rowState: IDatasetRowState, column: DatasetJourneySortColumn): void {

    const currentSort = rowState.journeySort as IDatasetJourneySort;
    rowState.journeySort = currentSort.column === column
        ? { column: column, isDescending: !currentSort.isDescending }
        : { column: column, isDescending: column === 'time' };
    drawDatasetJourney(rowState);
    // THE HEADERS ARE DRAWN AGAIN, SO FOCUS MOVES TO THE NEW BUTTON OF THE COLUMN CLICKED
    const sortButton = rowState.journeySortButtons && rowState.journeySortButtons[column];
    if (sortButton && typeof sortButton.focus === 'function') { sortButton.focus(); }

}

function buildDatasetJourneyEntry(rowState: IDatasetRowState, journeyMessage: IDatasetJourneyMessage, entry: IDatasetJourneyEntry): HTMLElement {

    const entryElement = createElement('tr', 'treeDatasetJourneyEntry treeDatasetJourneyEntry-' + String(entry.status));
    const statusDisplay = datasetJourneyStatusOf(entry);

    entryElement.appendChild(createElement('td', 'treeDatasetJourneyTime', String(entry.timeLabel)));
    entryElement.appendChild(createElement('td', 'treeDatasetJourneyKind', String(entry.kindLabel)));
    entryElement.appendChild(createElement('td', 'treeDatasetJourneyOrg', typeof entry.orgLabel === 'string' ? entry.orgLabel : ''));

    const statusCell = createElement('td', 'treeDatasetJourneyStatusCell');
    const statusElement = createElement('span', 'treeDatasetJourneyStatus treeDatasetJourneyStatus-' + entry.status);
    const emojiElement = createElement('span', 'treeDatasetJourneyStatusEmoji', statusDisplay.emoji);
    emojiElement.setAttribute('aria-hidden', 'true');
    statusElement.appendChild(emojiElement);
    statusElement.appendChild(createElement('span', 'treeDatasetJourneyStatusLabel', statusDisplay.label));
    statusCell.appendChild(statusElement);
    entryElement.appendChild(statusCell);

    const detailCell = createElement('td', 'treeDatasetJourneyDetail');
    if (typeof entry.summaryText === 'string' && entry.summaryText) {
        detailCell.appendChild(createElement('div', 'treeDatasetJourneySummary muted', entry.summaryText));
    }
    if (typeof entry.errorExcerpt === 'string' && entry.errorExcerpt) {
        detailCell.appendChild(createElement('div', 'treeDatasetJourneyError', entry.errorExcerpt));
    }
    entryElement.appendChild(detailCell);

    const filesCell = createElement('td', 'treeDatasetJourneyFiles');
    const files: IDatasetJourneyFile[] = Array.isArray(entry.files) ? entry.files : [];
    files.forEach(function (file) {
        const fileElement = createElement('div', 'treeDatasetJourneyFile');
        fileElement.appendChild(createElement('span', 'treeDatasetJourneyPath', String(file.relativePath)));
        const viewElement = createButton('secondary', 'historyAction treeDatasetJourneyView', RECIPE_COCKPIT_DATASET_JOURNEY_VIEW_FILE_LABEL);
        viewElement.setAttribute('title', 'Open ' + String(file.relativePath));
        viewElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'openDatasetJourneyFile', renderSequence: renderedSequence, datasetFolderName: rowState.dataset.datasetFolderName, journeySequence: journeyMessage.journeySequence, fileIndex: file.fileIndex });
        });
        fileElement.appendChild(viewElement);
        filesCell.appendChild(fileElement);
    });
    entryElement.appendChild(filesCell);

    return entryElement;

}
