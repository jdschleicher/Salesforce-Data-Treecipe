import { createButton, createElement, focusElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_UPDATER_EDIT_HEADING,
    RECIPE_COCKPIT_UPDATER_GENERATE_GLYPH,
    RECIPE_COCKPIT_UPDATER_LOCKED_GLYPH,
    RECIPE_COCKPIT_UPDATER_MARK_COLUMN_LABEL,
    RECIPE_COCKPIT_UPDATER_MARK_GLYPH,
    RECIPE_COCKPIT_UPDATER_RESET_ALL_LABEL,
    RECIPE_COCKPIT_UPDATER_RESET_GLYPH
} from '../../RecipeCockpitAdapterConstants';
import { buildRowTable } from '../RecipeCockpitPanelBuilders';
import { buildRecordLinkElement } from '../RecipeCockpitRecordTable';
import type { IRecordLinks } from '../RecipeCockpitRecordTable';
import type {
    AdapterPanelMessage,
    IAdapterTreeState,
    IUpdaterEditSummary,
    IUpdaterObjectState,
    UpdaterEditKind
} from './AdapterTypes';
import { renderedSequence } from '../shell/PanelRender';
import { pluralize } from '../RecipeCockpitPanelShared';
import { vscodeApi as cockpitVscodeApi } from '../RecipeCockpitPanelConnection';
import { runLocks } from '../RecipeCockpitRunLocks';

// THIS MODULE POSTS ONLY ITS OWN COMMAND: THE TYPE HOLDS EVERY MESSAGE TO IT
const vscodeApi: { postMessage(message: AdapterPanelMessage): void } = cockpitVscodeApi;

/*
    "Edit existing records" (#721): an object's loaded records as a table the reader edits. A ✎
    at the start of a row marks it to update; a marked row's cell in a column that can be changed
    gets 🎲, which asks the host for a value; a changed cell is highlighted with ↺, which puts its
    loaded value back. A column's header carries the same 🎲 and ↺ for every marked row.

    Nothing is decided here. Every button posts editUpdaterRecords with a POSITION -- the object's
    name, the page, the row and the column -- and the host answers with the page as it now reads.
    The marks, the values and what an update writes are the host's.
*/

// WHAT THE HOST SAYS OF A COLUMN, READ AS UNTRUSTED
interface IColumnEdit {
    lockReason: string;
    canGenerate: boolean;
}

function readColumnEdits(candidateColumnEdits: unknown, columnCount: number): IColumnEdit[] {
    const columnEdits: unknown[] = Array.isArray(candidateColumnEdits) ? candidateColumnEdits : [];
    return Array.from({ length: columnCount }, function (_unused, columnIndex) {
        const columnEdit = columnEdits[columnIndex] as { lockReason?: unknown; canGenerate?: unknown } | null | undefined;
        // A COLUMN THE HOST SAID NOTHING OF IS DRAWN AS TEXT ONLY, WITH NO BUTTON
        if (!columnEdit || typeof columnEdit !== 'object') { return { lockReason: ' ', canGenerate: false }; }
        return { lockReason: typeof columnEdit.lockReason === 'string' ? columnEdit.lockReason : '', canGenerate: columnEdit.canGenerate === true };
    });
}

export function readEditSummary(candidateSummary: unknown): IUpdaterEditSummary {
    const summary = (candidateSummary && typeof candidateSummary === 'object' ? candidateSummary : {}) as Record<string, unknown>;
    return {
        markedRecordCount: Number(summary.markedRecordCount) || 0,
        updatableRecordCount: Number(summary.updatableRecordCount) || 0,
        changedFieldApiNames: Array.isArray(summary.changedFieldApiNames) ? summary.changedFieldApiNames.map(String) : [],
        hasUnmarkedChanges: summary.hasUnmarkedChanges === true
    };
}

function requestUpdaterEdit(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, editKind: UpdaterEditKind, position: { rowIndex?: number; columnIndex?: number }): void {

    if (renderedSequence === null || runLocks.updaterLoadRunningTreeKey !== null) { return; }

    // THE KEY ITS BUTTON WAS BUILT WITH: A ROW'S ✎ IS ONE BUTTON WHETHER IT MARKS OR UNMARKS
    updaterObjectState.pressedEditKey = [String(editKind === 'unmarkRow' ? 'markRow' : editKind)].concat(
        position.rowIndex === undefined ? [] : [String(position.rowIndex)], position.columnIndex === undefined ? [] : [String(position.columnIndex)]).join(':');

    vscodeApi.postMessage({
        command: 'editUpdaterRecords',
        treeKey: treeState.tree.treeKey,
        renderSequence: renderedSequence,
        objectApiName: updaterObjectState.object.objectApiName,
        pageIndex: updaterObjectState.loadedRecordsPageIndex,
        editKind: editKind,
        ...position
    });

}

// EVERY EDIT BUTTON OF THE TABLE ON SCREEN, AND ITS PAGER, IS HELD WHILE A RUN HOLDS THE RECORDS; drawUpdaterLoadButtons CALLS THIS
export function drawUpdaterEditControls(updaterObjectState: IUpdaterObjectState): void {
    const isHeld = runLocks.updaterLoadRunningTreeKey !== null;
    (updaterObjectState.editButtonElements || []).forEach(function (editButton) {
        editButton.element.disabled = isHeld || editButton.isDisabledByEdits;
    });
    // A PAGE TURNED WHILE 🎲 RUNS WOULD BE PULLED BACK BY THE RUN'S ANSWER, WHICH IS THE PAGE THE EDIT WAS MADE ON
    const pagerElements = updaterObjectState.recordsPagerElements;
    if (pagerElements) {
        pagerElements.previousElement.disabled = isHeld || pagerElements.isPreviousAtEnd;
        pagerElements.nextElement.disabled = isHeld || pagerElements.isNextAtEnd;
    }
}

// AFTER AN EDIT'S ANSWER REDRAWS THE TABLE, THE KEYBOARD'S PLACE GOES BACK TO THE BUTTON PRESSED. WHERE THE EDIT TOOK THAT BUTTON AWAY
// OR LEFT IT NOTHING TO DO (A ↺ ON A CELL NOW AS LOADED, Reset all), IT GOES TO THE CELL'S OR COLUMN'S 🎲, THE ROW'S ✎, THEN THE FIRST BUTTON THAT CAN BE PRESSED
export function focusEditButton(updaterObjectState: IUpdaterObjectState, editKey: string): void {
    const [editKind, firstIndex] = editKey.split(':');
    const candidateKeys = [editKey, editKey.replace(/^reset(Cell|Column)/, 'generate$1')].concat(editKind.endsWith('Cell') ? ['markRow:' + firstIndex] : []);
    const enabledButtons = (updaterObjectState.editButtonElements || []).filter(function (candidateButton) { return !candidateButton.element.disabled; });
    const keyedButton = candidateKeys.map(function (candidateKey) { return enabledButtons.find(function (candidateButton) { return candidateButton.editKey === candidateKey; }); })
        .find(function (candidateButton) { return candidateButton !== undefined; });
    const editButton = keyedButton || enabledButtons[0];
    if (editButton) { focusElement(editButton.element); }
}

// "2 rows marked · 1 record to update: Region__c", AND WHAT IS STILL MISSING BEFORE AN UPDATE HAS ANYTHING TO WRITE
export function describeEditSummary(editSummary: IUpdaterEditSummary): string {

    if (editSummary.markedRecordCount === 0) {
        return 'No row marked. Mark the rows to change with ' + RECIPE_COCKPIT_UPDATER_MARK_GLYPH + '.'
            + (editSummary.hasUnmarkedChanges ? ' The changes on rows that are not marked are not written.' : '');
    }

    const markedText = pluralize(editSummary.markedRecordCount, 'row', 'rows') + ' marked';
    return (editSummary.updatableRecordCount === 0
        ? markedText + ', none changed yet. Change a cell with ' + RECIPE_COCKPIT_UPDATER_GENERATE_GLYPH + '.'
        : markedText + ' · ' + pluralize(editSummary.updatableRecordCount, 'record', 'records') + ' to update: ' + editSummary.changedFieldApiNames.join(', '))
        + (editSummary.hasUnmarkedChanges ? ' The changes on rows that are not marked are not written.' : '');

}

export function buildEditableRecordSection(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): HTMLElement {

    const loadedRecords = updaterObjectState.loadedRecords || {};
    const objectApiName = updaterObjectState.object.objectApiName;
    const columns: string[] = Array.isArray(loadedRecords.columns) ? loadedRecords.columns.map(String) : [];
    const rows: unknown[] = Array.isArray(loadedRecords.rows) ? loadedRecords.rows : [];
    const columnEdits = readColumnEdits(loadedRecords.columnEdits, columns.length);
    const editSummary = readEditSummary(loadedRecords.editSummary);
    const pageIndex = updaterObjectState.loadedRecordsPageIndex;
    const recordLinkSequence = updaterObjectState.loadedRecordsLinkSequence;
    const markedRowIndexes = new Set<unknown>(Array.isArray(loadedRecords.markedRowIndexes) ? loadedRecords.markedRowIndexes : []);
    const changedCellKeys = new Set<string>((Array.isArray(loadedRecords.changedCells) ? loadedRecords.changedCells : [])
        .filter(function (changedCell: unknown) { return Array.isArray(changedCell); })
        .map(function (changedCell: unknown[]) { return changedCell[0] + ':' + changedCell[1]; }));
    const editButtonElements: NonNullable<IUpdaterObjectState['editButtonElements']> = [];
    updaterObjectState.editButtonElements = editButtonElements;

    const editButton = function (editKey: string, className: string, glyph: string, label: string, isDisabledByEdits: boolean, onClick: () => void): HTMLButtonElement {
        const buttonElement = createButton('icon', className, glyph, 'compact');
        buttonElement.setAttribute('aria-label', label);
        buttonElement.setAttribute('title', label);
        buttonElement.addEventListener('click', onClick);
        editButtonElements.push({ element: buttonElement, isDisabledByEdits: isDisabledByEdits, editKey: editKey });
        return buttonElement;
    };

    // EVERY LINK OF THE TABLE: THE Id COLUMN'S AND EACH LOOKUP COLUMN'S (#720)
    const linkedRowIndexesByColumnIndex = new Map<number, Set<unknown>>();
    if (typeof recordLinkSequence === 'number') {
        [loadedRecords.recordLinks as IRecordLinks | null | undefined].concat(Array.isArray(loadedRecords.lookupLinks) ? loadedRecords.lookupLinks as IRecordLinks[] : []).forEach(function (links) {
            if (links && Number.isInteger(links.columnIndex) && Array.isArray(links.rowIndexes)) { linkedRowIndexesByColumnIndex.set(links.columnIndex as number, new Set<unknown>(links.rowIndexes)); }
        });
    }
    const idColumnIndex = loadedRecords.recordLinks && Number.isInteger((loadedRecords.recordLinks as IRecordLinks).columnIndex) ? (loadedRecords.recordLinks as IRecordLinks).columnIndex as number : 0;

    const sectionElement = createElement('div', 'updaterRecordEdit');
    const toolbarElement = createElement('div', 'updaterRecordEditToolbar');
    toolbarElement.appendChild(createElement('span', 'updaterRecordEditHeading', RECIPE_COCKPIT_UPDATER_EDIT_HEADING));
    toolbarElement.appendChild(createElement('span', 'updaterRecordEditSummary muted', describeEditSummary(editSummary)));
    const hasChanges = editSummary.updatableRecordCount > 0 || editSummary.hasUnmarkedChanges;
    const resetAllElement = createButton('secondary', 'updaterResetAll', RECIPE_COCKPIT_UPDATER_RESET_ALL_LABEL, 'compact');
    resetAllElement.setAttribute('aria-label', RECIPE_COCKPIT_UPDATER_RESET_ALL_LABEL + ' changes of ' + objectApiName);
    resetAllElement.addEventListener('click', function () { requestUpdaterEdit(treeState, updaterObjectState, 'resetObject', {}); });
    editButtonElements.push({ element: resetAllElement, isDisabledByEdits: !hasChanges, editKey: 'resetObject' });
    toolbarElement.appendChild(resetAllElement);
    sectionElement.appendChild(toolbarElement);

    const rowTable = buildRowTable({
        className: 'treeQueryTable',
        columns: [{ key: 'mark', label: RECIPE_COCKPIT_UPDATER_MARK_COLUMN_LABEL }].concat(columns.map(function (column, columnIndex) { return { key: String(columnIndex), label: column }; }))
    });

    // A COLUMN THAT CAN BE CHANGED HEADS WITH ITS 🎲 AND ↺; A LOCKED ONE SAYS WHY
    columns.forEach(function (column, columnIndex) {
        const headerElement = rowTable.headerElements[columnIndex + 1];
        const columnEdit = columnEdits[columnIndex];
        if (columnEdit.lockReason.trim()) {
            const lockElement = createElement('span', 'updaterColumnLock muted', RECIPE_COCKPIT_UPDATER_LOCKED_GLYPH);
            lockElement.setAttribute('title', 'Cannot be changed: ' + columnEdit.lockReason);
            lockElement.setAttribute('role', 'img');
            lockElement.setAttribute('aria-label', column + ' cannot be changed: ' + columnEdit.lockReason);
            headerElement.appendChild(lockElement);
            return;
        }
        if (columnEdit.lockReason) { return; }
        if (columnEdit.canGenerate) {
            headerElement.appendChild(editButton('generateColumn:' + columnIndex, 'updaterColumnGenerate', RECIPE_COCKPIT_UPDATER_GENERATE_GLYPH, 'Generate ' + column + ' for every marked ' + objectApiName + ' row',
                editSummary.markedRecordCount === 0, function () { requestUpdaterEdit(treeState, updaterObjectState, 'generateColumn', { columnIndex: columnIndex }); }));
        }
        headerElement.appendChild(editButton('resetColumn:' + columnIndex, 'updaterColumnReset', RECIPE_COCKPIT_UPDATER_RESET_GLYPH, 'Put back the loaded ' + column + ' of every ' + objectApiName + ' row',
            editSummary.changedFieldApiNames.indexOf(column) === -1 && !editSummary.hasUnmarkedChanges, function () { requestUpdaterEdit(treeState, updaterObjectState, 'resetColumn', { columnIndex: columnIndex }); }));
    });

    rows.forEach(function (row, rowIndex) {

        const isMarked = markedRowIndexes.has(rowIndex);
        const rowName = Array.isArray(row) && row[idColumnIndex] ? String(row[idColumnIndex]) : 'row ' + (rowIndex + 1);
        const rowElement = createElement('tr', isMarked ? 'treeQueryRow updaterMarkedRow' : 'treeQueryRow');
        const markCellElement = createElement('td', 'updaterMarkCell');
        const markElement = editButton('markRow:' + rowIndex, 'updaterRowMark', RECIPE_COCKPIT_UPDATER_MARK_GLYPH, (isMarked ? 'Marked to update — click to leave ' : 'Mark to update ') + objectApiName + ' ' + rowName, false,
            function () { requestUpdaterEdit(treeState, updaterObjectState, isMarked ? 'unmarkRow' : 'markRow', { rowIndex: rowIndex }); });
        markElement.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
        markCellElement.appendChild(markElement);
        rowElement.appendChild(markCellElement);

        columns.forEach(function (column, columnIndex) {

            const cellText = Array.isArray(row) && row[columnIndex] !== undefined ? String(row[columnIndex]) : '';
            const columnEdit = columnEdits[columnIndex];
            const isChanged = changedCellKeys.has(rowIndex + ':' + columnIndex);
            const cellElement = createElement('td', isChanged ? 'updaterChangedCell' : '');
            const linkedRowIndexes = linkedRowIndexesByColumnIndex.get(columnIndex);

            if (linkedRowIndexes && linkedRowIndexes.has(rowIndex) && cellText !== '') {
                cellElement.appendChild(buildRecordLinkElement(cellText, { recordLinkSequence: recordLinkSequence, rowIndex: rowIndex, objectApiName: objectApiName, pageIndex: pageIndex, columnIndex: columnIndex === idColumnIndex ? undefined : columnIndex }));
            } else {
                cellElement.appendChild(createElement('span', 'updaterCellValue', cellText));
            }

            if (!columnEdit.lockReason) {
                if (isMarked && columnEdit.canGenerate) {
                    cellElement.appendChild(editButton('generateCell:' + rowIndex + ':' + columnIndex, 'updaterCellGenerate', RECIPE_COCKPIT_UPDATER_GENERATE_GLYPH, 'Generate a value for ' + column + ' of ' + objectApiName + ' ' + rowName, false,
                        function () { requestUpdaterEdit(treeState, updaterObjectState, 'generateCell', { rowIndex: rowIndex, columnIndex: columnIndex }); }));
                }
                if (isChanged) {
                    cellElement.appendChild(editButton('resetCell:' + rowIndex + ':' + columnIndex, 'updaterCellReset', RECIPE_COCKPIT_UPDATER_RESET_GLYPH, 'Put back the loaded ' + column + ' of ' + objectApiName + ' ' + rowName, false,
                        function () { requestUpdaterEdit(treeState, updaterObjectState, 'resetCell', { rowIndex: rowIndex, columnIndex: columnIndex }); }));
                }
            }

            rowElement.appendChild(cellElement);

        });

        rowTable.bodyElement.appendChild(rowElement);

    });

    sectionElement.appendChild(rowTable.wrapElement);
    drawUpdaterEditControls(updaterObjectState);

    return sectionElement;

}
