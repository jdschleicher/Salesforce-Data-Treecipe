import { createButton, createElement } from '../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_RECORD_LINK_TITLE } from '../RecipeCockpitAdapterConstants';
import { buildRowTable } from './RecipeCockpitPanelBuilders';
import type { IRecordLinksMessage } from './adapter/AdapterTypes';
import { renderedSequence } from './shell/PanelRender';
import { vscodeApi as cockpitVscodeApi } from './RecipeCockpitPanelConnection';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: RecordLinkPanelMessage): void } = cockpitVscodeApi;

/*
    A preview of records as text (#641): the Query tab's (#367) and the Treecipe Adapter's (#416,
    #417, #447).
*/

// WHAT A PREVIEW POSTS; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
type RecordLinkPanelMessage =
    | { command: 'openPreviewRecord'; renderSequence: number; recordLinkSequence: unknown; rowIndex: number; objectApiName?: string; pageIndex?: number; columnIndex?: number }
    | { command: 'recordLinksRendered'; renderSequence: number; recordLinkSequence: number };

// WHICH ROWS OF A PREVIEW OPEN THEIR RECORD, AS THE HOST SENT IT (#556); READ AS UNTRUSTED
export interface IRecordLinks {
    columnIndex?: unknown;
    rowIndexes?: unknown;
}

// ONE PAGE OF AN ADAPTER RECORD TABLE (#720): WHICH PAGE IT IS, AND ITS LOOKUP CELLS THAT HOLD A WHOLE RECORD Id
export interface IRecordTablePage {
    pageIndex: number;
    lookupLinks?: unknown;
}

/*
    A row whose own Id opens its record (#556) draws that cell as a link, and so does a lookup
    cell of an Adapter record table (#720). The click posts the preview's sequence and the cell's
    position -- row, and for those tables page and lookup column -- never the Id, a URL or an org,
    and the host opens the Id it keeps at that position, in the org it was read from.
*/
export function buildRecordTable(columns: string[], rows: unknown[], recordLinks?: unknown, recordLinkSequence?: unknown, objectApiName?: string, tablePage?: IRecordTablePage): HTMLElement {

    const links = recordLinks as IRecordLinks | null | undefined;
    const linkColumnIndex = links && typeof recordLinkSequence === 'number' && Number.isInteger(links.columnIndex) ? links.columnIndex as number : -1;
    const linkedRowIndexesByColumnIndex = new Map<number, Set<unknown>>();
    if (linkColumnIndex !== -1 && links && Array.isArray(links.rowIndexes)) { linkedRowIndexesByColumnIndex.set(linkColumnIndex, new Set<unknown>(links.rowIndexes)); }
    if (tablePage && typeof recordLinkSequence === 'number' && Array.isArray(tablePage.lookupLinks)) {
        (tablePage.lookupLinks as Array<IRecordLinks | null>).forEach(function (lookupLinks) {
            if (lookupLinks && Number.isInteger(lookupLinks.columnIndex) && Array.isArray(lookupLinks.rowIndexes)) {
                linkedRowIndexesByColumnIndex.set(lookupLinks.columnIndex as number, new Set<unknown>(lookupLinks.rowIndexes));
            }
        });
    }

    const rowTable = buildRowTable({
        className: 'treeQueryTable',
        columns: columns.map(function (column, columnIndex) { return { key: String(columnIndex), label: String(column) }; })
    });
    rows.forEach(function (row, rowIndex) {
        const rowElement = createElement('tr', 'treeQueryRow');
        columns.forEach(function (_column, columnIndex) {
            const cellText = Array.isArray(row) && row[columnIndex] !== undefined ? String(row[columnIndex]) : '';
            const linkedRowIndexes = linkedRowIndexesByColumnIndex.get(columnIndex);
            if (!linkedRowIndexes || !linkedRowIndexes.has(rowIndex) || cellText === '') {
                rowElement.appendChild(createElement('td', '', cellText));
                return;
            }
            const cellElement = createElement('td', '');
            cellElement.appendChild(buildRecordLinkElement(cellText, {
                recordLinkSequence: recordLinkSequence,
                rowIndex: rowIndex,
                objectApiName: objectApiName,
                pageIndex: tablePage ? tablePage.pageIndex : undefined,
                columnIndex: columnIndex !== linkColumnIndex ? columnIndex : undefined
            }));
            rowElement.appendChild(cellElement);
        });
        rowTable.bodyElement.appendChild(rowElement);
    });

    return rowTable.wrapElement;

}

// ONE CELL'S LINK: ITS CLICK POSTS THE CELL'S POSITION, AND ONLY THE PARTS OF IT GIVEN
export function buildRecordLinkElement(cellText: string, position: { recordLinkSequence: unknown; rowIndex: number; objectApiName?: string; pageIndex?: number; columnIndex?: number }): HTMLButtonElement {

    const recordLinkElement = createButton('link', 'treeQueryRecordLink', cellText);
    recordLinkElement.setAttribute('title', RECIPE_COCKPIT_RECORD_LINK_TITLE);
    recordLinkElement.addEventListener('click', function () {
        if (renderedSequence === null) { return; }
        const openMessage: RecordLinkPanelMessage = { command: 'openPreviewRecord', renderSequence: renderedSequence, recordLinkSequence: position.recordLinkSequence, rowIndex: position.rowIndex };
        if (typeof position.objectApiName === 'string') { openMessage.objectApiName = position.objectApiName; }
        if (position.pageIndex !== undefined) { openMessage.pageIndex = position.pageIndex; }
        if (position.columnIndex !== undefined) { openMessage.columnIndex = position.columnIndex; }
        vscodeApi.postMessage(openMessage);
    });

    return recordLinkElement;

}

// ONLY THIS ACK LETS A PREVIEW'S ROWS OPEN THEIR RECORD (#556), AND ONLY FOR THE MODEL ON SCREEN
export function acknowledgeRecordLinks(previewMessage: IRecordLinksMessage): void {

    if (renderedSequence === null || previewMessage.renderSequence !== renderedSequence || typeof previewMessage.recordLinkSequence !== 'number') { return; }

    vscodeApi.postMessage({ command: 'recordLinksRendered', renderSequence: renderedSequence, recordLinkSequence: previewMessage.recordLinkSequence });

}
