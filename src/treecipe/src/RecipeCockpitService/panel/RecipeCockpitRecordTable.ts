import { createButton, createElement } from '../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_RECORD_LINK_TITLE } from '../RecipeCockpitAdapterConstants';
import { buildRowTable } from './RecipeCockpitPanelBuilders';
import type { IRecordLinksMessage } from './adapter/AdapterTypes';

/*
    A preview of records as text (#641): the Query tab's (#367) and the Treecipe Adapter's (#416,
    #417, #447). These names are the panel script's own, read when a function runs.
*/
declare const vscodeApi: { postMessage(message: RecordLinkPanelMessage): void };
declare const renderedSequence: number | null;

// WHAT A PREVIEW POSTS; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
type RecordLinkPanelMessage =
    | { command: 'openPreviewRecord'; renderSequence: number; recordLinkSequence: unknown; rowIndex: number; objectApiName?: string }
    | { command: 'recordLinksRendered'; renderSequence: number; recordLinkSequence: number };

// WHICH ROWS OF A PREVIEW OPEN THEIR RECORD, AS THE HOST SENT IT (#556); READ AS UNTRUSTED
interface IRecordLinks {
    columnIndex?: unknown;
    rowIndexes?: unknown;
}

/*
    A row whose own Id opens its record (#556) draws that cell as a link. The click posts the
    preview's sequence and the row's position -- never the Id, a URL or an org -- and the host
    opens the Id it keeps for that row, in the org it was read from.
*/
export function buildRecordTable(columns: string[], rows: unknown[], recordLinks?: unknown, recordLinkSequence?: unknown, objectApiName?: string): HTMLElement {

    const links = recordLinks as IRecordLinks | null | undefined;
    const linkColumnIndex = links && typeof recordLinkSequence === 'number' && Number.isInteger(links.columnIndex) ? links.columnIndex as number : -1;
    const linkedRowIndexes = new Set<unknown>(linkColumnIndex !== -1 && links && Array.isArray(links.rowIndexes) ? links.rowIndexes : []);

    const rowTable = buildRowTable({
        className: 'treeQueryTable',
        columns: columns.map(function (column, columnIndex) { return { key: String(columnIndex), label: String(column) }; })
    });
    rows.forEach(function (row, rowIndex) {
        const rowElement = createElement('tr', 'treeQueryRow');
        columns.forEach(function (_column, columnIndex) {
            const cellText = Array.isArray(row) && row[columnIndex] !== undefined ? String(row[columnIndex]) : '';
            if (columnIndex !== linkColumnIndex || !linkedRowIndexes.has(rowIndex) || cellText === '') {
                rowElement.appendChild(createElement('td', '', cellText));
                return;
            }
            const cellElement = createElement('td', '');
            const recordLinkElement = createButton('link', 'treeQueryRecordLink', cellText);
            recordLinkElement.setAttribute('title', RECIPE_COCKPIT_RECORD_LINK_TITLE);
            recordLinkElement.addEventListener('click', function () {
                if (renderedSequence === null) { return; }
                const openMessage: RecordLinkPanelMessage = { command: 'openPreviewRecord', renderSequence: renderedSequence, recordLinkSequence: recordLinkSequence, rowIndex: rowIndex };
                if (typeof objectApiName === 'string') { openMessage.objectApiName = objectApiName; }
                vscodeApi.postMessage(openMessage);
            });
            cellElement.appendChild(recordLinkElement);
            rowElement.appendChild(cellElement);
        });
        rowTable.bodyElement.appendChild(rowElement);
    });

    return rowTable.wrapElement;

}

// ONLY THIS ACK LETS A PREVIEW'S ROWS OPEN THEIR RECORD (#556), AND ONLY FOR THE MODEL ON SCREEN
export function acknowledgeRecordLinks(previewMessage: IRecordLinksMessage): void {

    if (renderedSequence === null || previewMessage.renderSequence !== renderedSequence || typeof previewMessage.recordLinkSequence !== 'number') { return; }

    vscodeApi.postMessage({ command: 'recordLinksRendered', renderSequence: renderedSequence, recordLinkSequence: previewMessage.recordLinkSequence });

}
