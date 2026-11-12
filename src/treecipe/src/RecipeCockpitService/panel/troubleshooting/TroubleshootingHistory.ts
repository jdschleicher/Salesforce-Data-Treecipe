import { createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_HISTORY_COLUMNS,
    RECIPE_COCKPIT_HISTORY_EMPTY_NOTE,
    RECIPE_COCKPIT_HISTORY_LOADING_NOTE,
    RECIPE_COCKPIT_HISTORY_SORT_COLUMNS,
    RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY,
    RECIPE_COCKPIT_HISTORY_UNREADABLE_NOTE,
    RECIPE_COCKPIT_HISTORY_UNRECORDED_NOTE,
    RecipeCockpitHistorySortColumn,
    RunHistoryRowStatus
} from '../../RecipeCockpitTroubleshootingConstants';
import { buildRowTable } from '../RecipeCockpitPanelBuilders';
import { applyTroubleshootingFilter } from './TroubleshootingTab';
import { IHistoryFile, IHistoryRow, IHistoryRowState, IHistorySort, ITroubleshootingHistoryMessage, ITroubleshootingSubTabState, ITroubleshootingTreeState } from './TroubleshootingTypes';

/*
    The History sub-tab (#485, #639). These names are the panel script's own, read when a function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare function findTreeState(treeKey: unknown): ITroubleshootingTreeState | null;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;
declare function versionLabelOf(treeState: ITroubleshootingTreeState, runFolderName: string | null): string;

/*
    The History (#485): the tree's Troubleshooting steps as one table, read by the host when the
    sub-tab first opens (loadTroubleshootingHistory) and posted again when a step ends, so the
    posted model does not carry it. Every value is written with textContent; a file is opened by
    its index in the rows the host posted, never by a path.
*/
export function buildTroubleshootingHistory(treeState: ITroubleshootingTreeState, subTabState: ITroubleshootingSubTabState): void {

    subTabState.noun = ['step', 'steps'];
    subTabState.historyRows = [];
    treeState.historySubTabState = subTabState;
    if (!treeState.historySort) { treeState.historySort = readHistorySort(null); }
    const historyListElement = createElement('div', 'troubleshootingHistory');
    treeState.historyListElement = historyListElement;
    historyListElement.appendChild(createElement('div', 'treeEmpty muted', RECIPE_COCKPIT_HISTORY_LOADING_NOTE));
    subTabState.listElement.appendChild(historyListElement);

}


// A SAVED SORT IS KEPT ONLY IN ITS OWN SHAPE; ANYTHING ELSE IS TIME, NEWEST FIRST
export function readHistorySort(savedSort: unknown): IHistorySort {

    if (savedSort && typeof savedSort === 'object') {
        const { column, isDescending } = savedSort as { column?: unknown; isDescending?: unknown };
        if ((RECIPE_COCKPIT_HISTORY_SORT_COLUMNS as readonly unknown[]).indexOf(column) !== -1 && typeof isDescending === 'boolean') {
            return { column: column as RecipeCockpitHistorySortColumn, isDescending: isDescending };
        }
    }
    return { column: 'time', isDescending: true };

}


// ASKED ONCE PER MODEL WHEN THE SUB-TAB IS SHOWN; THE HOST POSTS IT AGAIN WHEN A STEP OF THIS TREE ENDS
export function requestTroubleshootingHistory(treeState: ITroubleshootingTreeState): void {

    if (renderedSequence === null || treeState.isHistoryRequested || !treeState.historyListElement) { return; }

    treeState.isHistoryRequested = true;
    vscodeApi.postMessage({ command: 'loadTroubleshootingHistory', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

}


export function renderTroubleshootingHistory(historyMessage: ITroubleshootingHistoryMessage): void {

    if (renderedSequence === null || historyMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(historyMessage.treeKey);
    if (!treeState || !treeState.historyListElement) { return; }

    treeState.historyMessage = historyMessage;
    drawTroubleshootingHistory(treeState);
    vscodeApi.postMessage({ command: 'troubleshootingHistoryRendered', renderSequence: renderedSequence, treeKey: treeState.tree.treeKey, historySequence: historyMessage.historySequence });

}


function historyStatusOf(row: IHistoryRow): { emoji: string; label: string } {

    return hasOwnKey(RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY, row.status) ? RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY[row.status as RunHistoryRowStatus] : { emoji: '', label: String(row.status) };

}


// WHAT A ROW SORTS BY IN EACH COLUMN; A TIE IS BROKEN BY TIME, NEWEST FIRST
function historySortValue(treeState: ITroubleshootingTreeState, row: IHistoryRow, column: RecipeCockpitHistorySortColumn): number | string {

    if (column === 'time') { return Number(row.timeMs) || 0; }
    if (column === 'step') { return String(row.stepLabel).toLowerCase(); }
    if (column === 'org') { return typeof row.orgLabel === 'string' ? row.orgLabel.toLowerCase() : ''; }
    if (column === 'outcome') { return historyStatusOf(row).label.toLowerCase(); }
    return versionLabelOf(treeState, typeof row.runFolderName === 'string' ? row.runFolderName : null).toLowerCase();

}


function sortHistoryRowStates(treeState: ITroubleshootingTreeState, rowStates: IHistoryRowState[]): IHistoryRowState[] {

    const sort = treeState.historySort as IHistorySort;
    return rowStates.slice().sort(function (first, second) {
        const firstValue = historySortValue(treeState, first.row, sort.column);
        const secondValue = historySortValue(treeState, second.row, sort.column);
        const order = firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
        if (order !== 0) { return sort.isDescending ? -order : order; }
        return (Number(second.row.timeMs) || 0) - (Number(first.row.timeMs) || 0);
    });

}


function drawTroubleshootingHistory(treeState: ITroubleshootingTreeState): void {

    const historyMessage = treeState.historyMessage as ITroubleshootingHistoryMessage;
    const subTabState = treeState.historySubTabState as ITroubleshootingSubTabState;
    const listElement = treeState.historyListElement as HTMLElement;
    const rows: IHistoryRow[] = Array.isArray(historyMessage.rows) ? historyMessage.rows : [];
    const historyRows: IHistoryRowState[] = [];
    listElement.textContent = '';
    subTabState.historyRows = historyRows;

    if (rows.length === 0) {
        listElement.appendChild(createElement('div', 'treeEmpty muted', RECIPE_COCKPIT_HISTORY_EMPTY_NOTE));
        applyTroubleshootingFilter(treeState, 'history');
        return;
    }

    const rowTable = buildRowTable({
        className: 'historyTable',
        columnClassName: 'history',
        columns: RECIPE_COCKPIT_HISTORY_COLUMNS,
        sortColumns: RECIPE_COCKPIT_HISTORY_SORT_COLUMNS,
        sort: treeState.historySort,
        onSort: function (column) { sortTroubleshootingHistory(treeState, column as RecipeCockpitHistorySortColumn); }
    });
    treeState.historySortButtons = rowTable.sortButtons;

    rows.forEach(function (row) {
        historyRows.push(buildHistoryRow(treeState, historyMessage, row));
    });

    sortHistoryRowStates(treeState, historyRows).forEach(function (rowState) { rowTable.bodyElement.appendChild(rowState.element); });

    listElement.appendChild(rowTable.wrapElement);
    treeState.historyBodyElement = rowTable.bodyElement;

    if ((historyMessage.hiddenRowCount as number) > 0) {
        listElement.appendChild(createElement('div', 'historyHiddenNote muted', pluralize(historyMessage.hiddenRowCount as number, 'older step is', 'older steps are') + ' not shown.'));
    }

    applyTroubleshootingFilter(treeState, 'history');

}


function buildHistoryRow(treeState: ITroubleshootingTreeState, historyMessage: ITroubleshootingHistoryMessage, row: IHistoryRow): IHistoryRowState {

    const rowElement = createElement('tr', 'historyRow historyRow-' + String(row.status));
    const statusDisplay = historyStatusOf(row);
    const runLabel = versionLabelOf(treeState, typeof row.runFolderName === 'string' ? row.runFolderName : null);
    const files: IHistoryFile[] = Array.isArray(row.files) ? row.files : [];

    const timeCell = createElement('td', 'historyTime', String(row.timeLabel));
    if (typeof row.finishedAtLabel === 'string') { timeCell.setAttribute('title', 'Ended ' + row.finishedAtLabel); }

    const orgCell = createElement('td', 'historyOrg', typeof row.orgLabel === 'string' ? row.orgLabel : '');
    if (typeof row.orgUsername === 'string') { orgCell.setAttribute('title', row.orgUsername); }

    const outcomeCell = createElement('td', 'historyOutcome');
    const statusElement = createElement('span', 'historyStatus historyStatus-' + String(row.status));
    const emojiElement = createElement('span', 'historyStatusEmoji', statusDisplay.emoji);
    emojiElement.setAttribute('aria-hidden', 'true');
    statusElement.appendChild(emojiElement);
    statusElement.appendChild(createElement('span', 'historyStatusLabel', statusDisplay.label));
    outcomeCell.appendChild(statusElement);

    const detailParts: string[] = [];
    if (typeof row.succeededCount === 'number') { detailParts.push(row.succeededCount + ' succeeded'); }
    if (typeof row.failedCount === 'number') { detailParts.push(row.failedCount + ' failed'); }
    if (typeof row.detail === 'string') { detailParts.push(row.detail); }
    if (row.status === 'unrecorded') { detailParts.push(RECIPE_COCKPIT_HISTORY_UNRECORDED_NOTE); }
    if (row.status === 'unreadable') { detailParts.push(RECIPE_COCKPIT_HISTORY_UNREADABLE_NOTE); }
    const detailText = detailParts.join(' · ');
    if (detailText) { outcomeCell.appendChild(createElement('span', 'historyDetail muted', detailText)); }

    const filesCell = createElement('td', 'historyFiles');
    files.forEach(function (file) {
        const fileButton = createButton('link', 'historyFile', String(file.fileName));
        fileButton.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'openTroubleshootingHistoryFile', renderSequence: renderedSequence, treeKey: treeState.tree.treeKey, historySequence: historyMessage.historySequence, fileIndex: file.fileIndex });
        });
        filesCell.appendChild(fileButton);
    });

    rowElement.appendChild(timeCell);
    rowElement.appendChild(createElement('td', 'historyStep', String(row.stepLabel)));
    rowElement.appendChild(orgCell);
    rowElement.appendChild(outcomeCell);
    rowElement.appendChild(createElement('td', 'historyRun', runLabel));
    rowElement.appendChild(filesCell);

    const searchTexts = [String(row.timeLabel), String(row.stepLabel), statusDisplay.label, runLabel, detailText]
        .concat(typeof row.orgLabel === 'string' ? [row.orgLabel] : [])
        .concat(typeof row.orgUsername === 'string' ? [row.orgUsername] : [])
        .concat(files.map(function (file) { return String(file.fileName); }));

    return { row: row, element: rowElement, isShown: true, searchText: searchTexts.join('\n').toLowerCase() };

}


// A HEADER CLICK SORTS BY ITS COLUMN; THE SAME COLUMN AGAIN TURNS THE ORDER. TIME STARTS NEWEST FIRST, THE REST A TO Z
function sortTroubleshootingHistory(treeState: ITroubleshootingTreeState, column: RecipeCockpitHistorySortColumn): void {

    const currentSort = treeState.historySort as IHistorySort;
    treeState.historySort = currentSort.column === column
        ? { column: column, isDescending: !currentSort.isDescending }
        : { column: column, isDescending: column === 'time' };
    drawTroubleshootingHistory(treeState);
    // THE HEADERS ARE DRAWN AGAIN, SO FOCUS MOVES TO THE NEW BUTTON OF THE COLUMN CLICKED
    const sortButton = treeState.historySortButtons && treeState.historySortButtons[column];
    if (sortButton && typeof sortButton.focus === 'function') { sortButton.focus(); }
    savePanelPlace();

}
