import { createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_QUERY_INTRO } from '../../RecipeCockpitQueryTabConstants';
import { IActionCardView, ITabSearchView, buildActionCard, buildTabSearch } from '../RecipeCockpitPanelBuilders';

/*
    The Query tab (#367, #640): a tree's generated SOQL, each query editable, run against the Target
    Org Manager selection and exported, with one preview of what the last run returned. These names
    are the panel script's own, read when a function runs; isTreeQueryRunning is also set by the
    script's treeQueryState message.
*/
declare const vscodeApi: { postMessage(message: QueryPanelMessage): void };
declare const renderedSequence: number | null;
declare const treeStates: IQueryTreeState[];
declare const dataOrgLabels: string[] | null;
declare const dataOrgSelectedIndex: number | null;
declare let isTreeQueryRunning: boolean;
// RecipeCockpitQuery.ts HOLDS THE LIMIT BESIDE ITS CHECK; IT IMPORTS NODE'S path, SO THE SHELL PASSES THE NUMBER IN
declare const QUERY_MAX_LENGTH: number;
declare function drawActionCardState(actionCard: IActionCardView, reason: string, title: string): void;
declare function pluralize(count: number, singular: string, plural: string): string;
// THE PREVIEW TABLE IS SHARED WITH THE TREECIPE ADAPTER, WHOSE SLICE (#641) MOVES IT
declare function buildRecordTable(columns: string[], rows: unknown[], recordLinks: unknown, recordLinkSequence: unknown, rowClassNames: undefined): HTMLElement;

// WHAT THIS TAB POSTS; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
type QueryExportFormat = 'json' | 'csv';
type QueryPanelMessage =
    | { command: 'loadTreeQueries'; treeKey: string; renderSequence: number }
    | { command: 'saveTreeQueryEdit'; treeKey: string; queryKey: string; queryText: string }
    | { command: 'runTreeQuery'; treeKey: string; queryKey: string; queryText: string }
    | { command: 'exportTreeQueryResult'; treeKey: string; queryKey: string; exportFormat: QueryExportFormat };

// WHAT THE HOST POSTS (IRecipeCockpitTreeQueriesMessage, IRecipeCockpitTreeQueryResultMessage), READ AS UNTRUSTED
interface ITreeQuery {
    queryKey: unknown;
    objectApiName: unknown;
    kindLabel: unknown;
    notes?: unknown;
    generatedText?: unknown;
    editedText?: unknown;
}

interface ITreeQueriesMessage {
    renderSequence: unknown;
    treeKey: unknown;
    queries?: unknown;
    failureMessage?: unknown;
}

interface ITreeQueryResultMessage {
    renderSequence: unknown;
    treeKey: unknown;
    queryKey: unknown;
    orgLabel?: unknown;
    totalSize?: unknown;
    recordCount?: unknown;
    isTruncated?: unknown;
    columns?: unknown;
    rows?: unknown;
    hiddenColumnCount?: unknown;
    recordLinkSequence?: unknown;
    recordLinks?: unknown;
}

interface IQueryState {
    queryKey: string;
    objectApiName: string;
    kindLabel: string;
    notes: string[];
    generatedText: string;
    savedText: string;
    element: HTMLElement;
    textElement: HTMLTextAreaElement;
    editedElement: HTMLElement;
    refusalElement: HTMLElement;
    runCard: IActionCardView;
    drawnRunLabel: string | null;
    exportCards: IActionCardView[];
    resultElement: HTMLElement;
    hasResult: boolean;
}

// THE PARTS OF A TREE CARD'S STATE THIS TAB READS AND WRITES; THE SCRIPT BUILDS THE REST
interface IQueryTreeState {
    tree: { treeKey: string };
    searchTexts: Record<string, string>;
    searchQueries: Record<string, string>;
    querySearch?: ITabSearchView;
    queryListElement?: HTMLElement;
    queryStates?: IQueryState[];
    isTreeQueriesWanted?: boolean;
    pendingQueryResult?: ITreeQueryResultMessage | null;
}

/*
    The Query tab (#367), on every card with a folder: the SOQL Generate Treecipe wrote for the
    tree, read by the host from the run's objects wrapper each time the tab is selected. Each
    query is a text box the reader edits; an edit is saved when the box loses focus and before
    a run, and Reset puts back the generated text. Run posts the KEY and the text, never an org:
    the host asks for the org in the command palette. Only a PREVIEW comes back, written with
    textContent; Export asks the host to write the whole result it holds.
*/
export function buildQueryTab(treeState: IQueryTreeState, panelElement: HTMLElement): void {

    const querySearch = buildTabSearch(treeState, 'query', 'Search queries', applyQueryFilter);
    treeState.querySearch = querySearch;
    panelElement.appendChild(querySearch.element);
    panelElement.appendChild(createElement('div', 'treeQueryIntro muted', RECIPE_COCKPIT_QUERY_INTRO));

    const queryListElement = createElement('div', 'treeQueryList');
    treeState.queryListElement = queryListElement;
    queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', 'Reading this run’s queries…'));
    panelElement.appendChild(queryListElement);
    treeState.queryStates = [];

    applyQueryFilter(treeState);

}

// ASKED EACH TIME THE TAB IS SELECTED; ONE SELECTED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE) ASKS ONCE IT IS
export function requestTreeQueries(treeState: IQueryTreeState): void {

    if (renderedSequence === null) {
        treeState.isTreeQueriesWanted = true;
        return;
    }

    treeState.isTreeQueriesWanted = false;
    vscodeApi.postMessage({ command: 'loadTreeQueries', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

}

// AN EDIT ALREADY ON SCREEN IS KEPT: THE TAB ASKS AGAIN ON EVERY SELECT, AND THE READER MAY BE MID-EDIT
export function renderTreeQueries(queriesMessage: ITreeQueriesMessage): void {

    if (renderedSequence === null || queriesMessage.renderSequence !== renderedSequence) { return; }

    const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === queriesMessage.treeKey; });
    if (!treeState || !treeState.queryListElement) { return; }

    const queryListElement = treeState.queryListElement;
    if ((treeState.queryStates as IQueryState[]).length > 0 && !queriesMessage.failureMessage) { return; }

    queryListElement.textContent = '';
    treeState.queryStates = [];

    if (queriesMessage.failureMessage) {
        queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', String(queriesMessage.failureMessage)));
    } else if (!Array.isArray(queriesMessage.queries) || queriesMessage.queries.length === 0) {
        queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', 'This tree has no generated queries.'));
    } else {
        queriesMessage.queries.forEach(function (treeQuery: ITreeQuery) { buildTreeQuery(treeState, treeQuery); });
    }

    if (treeState.pendingQueryResult) {
        const pendingQueryResult = treeState.pendingQueryResult;
        treeState.pendingQueryResult = null;
        renderTreeQueryResult(pendingQueryResult);
    }

    drawTreeQueryButtons();
    applyQueryFilter(treeState);

}

function buildTreeQuery(treeState: IQueryTreeState, treeQuery: ITreeQuery): void {

    const generatedText = String(treeQuery.generatedText || '');
    const queryTitle = String(treeQuery.objectApiName) + ' · ' + String(treeQuery.kindLabel);
    const notes: unknown[] = Array.isArray(treeQuery.notes) ? treeQuery.notes : [];
    const queryElement = createElement('div', 'treeQuery');
    const textElement = createElement('textarea', 'treeQueryText');
    const editedElement = createElement('span', 'treeQueryEdited muted hidden', 'edited');
    const refusalElement = createElement('div', 'fieldEditorRefusal hidden');
    const controlsElement = createElement('div', 'treeQueryControls');
    const runCard = buildActionCard('runQuery', 'treeQueryRun', 'Run…');
    const runButtonElement = runCard.buttonElement;
    const resetButtonElement = createButton('secondary', 'treeQueryReset', 'Reset');
    const exportJsonCard = buildActionCard('exportQueryJson', 'treeQueryExport treeQueryExport-json', 'Export JSON');
    const exportCsvCard = buildActionCard('exportQueryCsv', 'treeQueryExport treeQueryExport-csv', 'Export CSV');
    const exportJsonButtonElement = exportJsonCard.buttonElement;
    const exportCsvButtonElement = exportCsvCard.buttonElement;
    const cardsElement = createElement('div', 'treeQueryCards actionCards');
    const resultElement = createElement('div', 'treeQueryResult hidden');
    const titleElement = createElement('div', 'treeQueryTitle', queryTitle);

    queryElement.setAttribute('role', 'group');
    queryElement.setAttribute('aria-label', queryTitle);
    titleElement.appendChild(editedElement);
    queryElement.appendChild(titleElement);
    notes.forEach(function (note) {
        queryElement.appendChild(createElement('div', 'treeQueryNote muted', String(note)));
    });

    textElement.value = typeof treeQuery.editedText === 'string' ? treeQuery.editedText : generatedText;
    textElement.setAttribute('aria-label', 'SOQL for ' + queryTitle);
    textElement.setAttribute('spellcheck', 'false');
    textElement.setAttribute('maxlength', String(QUERY_MAX_LENGTH));
    textElement.setAttribute('rows', String(Math.min(12, Math.max(3, generatedText.split('\n').length))));
    queryElement.appendChild(textElement);
    queryElement.appendChild(refusalElement);

    const queryState: IQueryState = {
        queryKey: String(treeQuery.queryKey),
        objectApiName: String(treeQuery.objectApiName),
        kindLabel: String(treeQuery.kindLabel),
        notes: notes.map(String),
        generatedText: generatedText,
        savedText: textElement.value,
        element: queryElement,
        textElement: textElement,
        editedElement: editedElement,
        refusalElement: refusalElement,
        runCard: runCard,
        drawnRunLabel: null,
        exportCards: [exportJsonCard, exportCsvCard],
        resultElement: resultElement,
        hasResult: false
    };

    const drawEdited = function () {
        if (textElement.value !== generatedText) { editedElement.classList.remove('hidden'); } else { editedElement.classList.add('hidden'); }
    };

    const saveEdit = function () {
        if (renderedSequence === null || textElement.value === queryState.savedText) { return; }
        queryState.savedText = textElement.value;
        vscodeApi.postMessage({ command: 'saveTreeQueryEdit', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, queryText: textElement.value === generatedText ? '' : textElement.value });
    };

    textElement.addEventListener('input', function () {
        drawEdited();
        refusalElement.classList.add('hidden');
        // ONLY A SEARCH CAN HIDE A QUERY FOR ITS TEXT, SO A KEYSTROKE WITH NONE RE-FILTERS NOTHING
        if (treeState.searchQueries.query) { applyQueryFilter(treeState); }
    });
    textElement.addEventListener('change', saveEdit);

    runButtonElement.addEventListener('click', function () {
        if (runButtonElement.disabled || renderedSequence === null) { return; }
        const refusal = describeQueryRefusal(textElement.value);
        if (refusal) {
            refusalElement.textContent = refusal;
            refusalElement.setAttribute('role', 'alert');
            refusalElement.classList.remove('hidden');
            return;
        }
        saveEdit();
        isTreeQueryRunning = true;
        drawTreeQueryButtons();
        vscodeApi.postMessage({ command: 'runTreeQuery', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, queryText: textElement.value });
    });

    resetButtonElement.addEventListener('click', function () {
        if (resetButtonElement.disabled) { return; }
        textElement.value = generatedText;
        drawEdited();
        refusalElement.classList.add('hidden');
        saveEdit();
        applyQueryFilter(treeState);
    });

    const exportEntries: Array<[QueryExportFormat, HTMLButtonElement]> = [['json', exportJsonButtonElement], ['csv', exportCsvButtonElement]];
    exportEntries.forEach(function (exportEntry) {
        const exportButtonElement = exportEntry[1];
        exportButtonElement.addEventListener('click', function () {
            if (exportButtonElement.disabled || renderedSequence === null) { return; }
            vscodeApi.postMessage({ command: 'exportTreeQueryResult', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, exportFormat: exportEntry[0] });
        });
    });

    controlsElement.appendChild(resetButtonElement);
    cardsElement.appendChild(runButtonElement);
    cardsElement.appendChild(exportJsonButtonElement);
    cardsElement.appendChild(exportCsvButtonElement);
    queryElement.appendChild(controlsElement);
    queryElement.appendChild(cardsElement);
    queryElement.appendChild(resultElement);

    drawEdited();
    (treeState.queryStates as IQueryState[]).push(queryState);
    (treeState.queryListElement as HTMLElement).appendChild(queryElement);

}

// THE HOST HOLDS THE TEXT TO THE SAME RULE; THIS ONLY SAYS SO BEFORE AN ORG IS ASKED FOR
function describeQueryRefusal(queryText: string): string {

    const trimmedText = String(queryText || '').trim();

    if (!trimmedText) { return 'The query is empty.'; }
    if (trimmedText.length > QUERY_MAX_LENGTH) { return 'The query is longer than ' + QUERY_MAX_LENGTH + ' characters.'; }
    if (!/^select\s/i.test(trimmedText)) { return 'The query must be one SOQL SELECT statement.'; }

    return '';

}

// A QUERY RUNS AGAINST THE TARGET ORG MANAGER SELECTION (#439); WITH NONE, THE HOST ASKS FOR ONE
export function drawTreeQueryButtons(): void {

    const orgLabel = dataOrgLabels && dataOrgSelectedIndex !== null && dataOrgLabels[dataOrgSelectedIndex] ? dataOrgLabels[dataOrgSelectedIndex] : '';
    const runLabel = orgLabel ? 'Run in ' + orgLabel : 'Run…';
    const runTitle = orgLabel ? 'Run this query against ' + orgLabel + ', the org chosen in Target Org Manager' : 'Choose the org to run this query against; it becomes the Target Org Manager selection';

    treeStates.forEach(function (treeState) {
        (treeState.queryStates || []).forEach(function (queryState) {
            drawActionCardState(queryState.runCard, isTreeQueryRunning ? 'A query is running.' : '', runTitle);
            // WRITTEN ONLY ON A CHANGE: EVERY INSERT REDRAW COMES THROUGH HERE
            if (queryState.drawnRunLabel !== runLabel) {
                queryState.drawnRunLabel = runLabel;
                queryState.runCard.titleElement.textContent = runLabel;
            }
            queryState.exportCards.forEach(function (exportCard) {
                drawActionCardState(exportCard, isTreeQueryRunning ? 'A query is running.' : queryState.hasResult ? '' : 'Run this query first', 'Write what this query returned to RunArtifacts in the tree folder');
            });
        });
    });

}

/*
    One preview at a time, as the host keeps one result: every other query's preview and Export
    buttons go. A preview for a tab whose queries have not arrived yet waits for them.
*/
export function renderTreeQueryResult(resultMessage: ITreeQueryResultMessage): void {

    if (renderedSequence === null || resultMessage.renderSequence !== renderedSequence) { return; }

    const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === resultMessage.treeKey; });
    if (!treeState) { return; }

    const queryState = (treeState.queryStates || []).find(function (candidateQueryState) { return candidateQueryState.queryKey === resultMessage.queryKey; });
    if (!queryState) {
        treeState.pendingQueryResult = resultMessage;
        return;
    }

    treeStates.forEach(function (eachTreeState) {
        (eachTreeState.queryStates || []).forEach(function (eachQueryState) {
            eachQueryState.hasResult = false;
            eachQueryState.resultElement.textContent = '';
            eachQueryState.resultElement.classList.add('hidden');
        });
    });

    const columns: string[] = Array.isArray(resultMessage.columns) ? resultMessage.columns.map(String) : [];
    const rows: unknown[] = Array.isArray(resultMessage.rows) ? resultMessage.rows : [];
    const recordCount = Number(resultMessage.recordCount) || 0;
    let summaryText = pluralize(recordCount, 'record', 'records') + ' from ' + String(resultMessage.orgLabel || 'the org');
    if (resultMessage.isTruncated) { summaryText += ', the first of ' + String(resultMessage.totalSize) + ' it matched'; }
    const hiddenColumnCount = Number(resultMessage.hiddenColumnCount) || 0;
    if (rows.length < recordCount) { summaryText += '. Showing the first ' + rows.length + ' rows'; }
    if (hiddenColumnCount > 0) { summaryText += (rows.length < recordCount ? ' and ' : '. Showing ') + pluralize(columns.length, 'column', 'columns') + ', ' + hiddenColumnCount + ' more not shown'; }
    if (rows.length < recordCount || hiddenColumnCount > 0) { summaryText += '; Export writes them all.'; }

    queryState.resultElement.appendChild(createElement('div', 'treeQueryResultSummary muted', summaryText));

    if (columns.length > 0) {
        queryState.resultElement.appendChild(buildRecordTable(columns, rows, resultMessage.recordLinks, resultMessage.recordLinkSequence, undefined));
    }

    queryState.hasResult = true;
    queryState.resultElement.classList.remove('hidden');
    drawTreeQueryButtons();

}

function applyQueryFilter(treeState: IQueryTreeState): void {

    const searchQuery = treeState.searchQueries.query;
    const queryStates = treeState.queryStates || [];
    let matchingCount = 0;

    queryStates.forEach(function (queryState) {
        // WHAT THE QUERY DRAWS: ITS OBJECT, KIND, NOTES AND THE TEXT IN ITS BOX NOW
        const searchText = [queryState.objectApiName, queryState.kindLabel].concat(queryState.notes).concat([String(queryState.textElement.value || '')]).join('\n').toLowerCase();
        const isMatch = !searchQuery || searchText.indexOf(searchQuery) !== -1;
        if (isMatch) { matchingCount++; queryState.element.classList.remove('hidden'); } else { queryState.element.classList.add('hidden'); }
    });

    if (treeState.querySearch) {
        treeState.querySearch.matchCountElement.textContent = !searchQuery
            ? pluralize(queryStates.length, 'query', 'queries')
            : matchingCount > 0 ? matchingCount + ' of ' + pluralize(queryStates.length, 'query', 'queries') : 'no matches';
    }

}
