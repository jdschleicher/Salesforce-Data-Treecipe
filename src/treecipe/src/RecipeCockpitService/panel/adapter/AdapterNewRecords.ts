import { createButton, createElement, focusElement, setShown } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_UPDATER_EDIT_HEADING,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATING_LABEL,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_LOADED_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_READ_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_PREVIEW_NOTE,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_NEXT_PAGE_LABEL,
    RECIPE_COCKPIT_UPDATER_PREVIOUS_PAGE_LABEL
} from '../../RecipeCockpitAdapterConstants';
import { buildRecordTable } from '../RecipeCockpitRecordTable';
import { drawUpdaterLoadButtons } from './AdapterLoadAndUpdate';
import { buildUpdaterFieldRow, drawUpdaterObjectCount } from './AdapterTab';
import type {
    AdapterPanelMessage,
    IAdapterChildFieldRequest,
    IAdapterTreeState,
    IUpdaterFieldObjectState,
    IUpdaterFieldRowState,
    IUpdaterFieldTreeState,
    IUpdaterNewRecordsMessage,
    IUpdaterNewRecordsPageMessage,
    IUpdaterNewRecordsState,
    IUpdaterObjectState,
    UpdaterRecordTab
} from './AdapterTypes';
import { hasOwnKey } from '../RecipeCockpitOwnKey';
import { findTreeState, renderedSequence, treeStates } from '../shell/PanelRender';
import { pluralize } from '../RecipeCockpitPanelShared';
import { vscodeApi as cockpitVscodeApi } from '../RecipeCockpitPanelConnection';
import { runLocks } from '../RecipeCockpitRunLocks';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: AdapterPanelMessage): void } = cockpitVscodeApi;

/*
    "Generate new records" (#722): the second tab of every object below the chosen parent, beside
    "Edit existing records". The reader ticks the object's fields, may type a value for one, sets
    a count per loaded parent record and presses Generate records; the host generates the records
    under the loaded parents and answers with a preview. The ticks, the typed values and the
    count are this tab's own and are posted only with Generate records; the records, and what a
    field generates from, are the host's.
*/

// WHAT THE LAST LOAD SAID OF THE OBJECT NEW RECORDS GO UNDER, READ AS UNTRUSTED
function readNewRecordsParent(updaterObjectState: IUpdaterObjectState): { parentObjectApiName: string; parentRecordCount: number } | null {
    const loadedRecords = updaterObjectState.loadedRecords;
    const newRecordsParent = (loadedRecords && loadedRecords.newRecordsParent && typeof loadedRecords.newRecordsParent === 'object' ? loadedRecords.newRecordsParent : null) as { parentObjectApiName?: unknown; parentRecordCount?: unknown } | null;
    return newRecordsParent && typeof newRecordsParent.parentObjectApiName === 'string'
        ? { parentObjectApiName: newRecordsParent.parentObjectApiName, parentRecordCount: Number(newRecordsParent.parentRecordCount) || 0 }
        : null;
}

function selectRecordTab(newRecordsState: IUpdaterNewRecordsState, recordTab: UpdaterRecordTab): void {
    newRecordsState.selectedTab = recordTab;
    (['edit', 'new'] as UpdaterRecordTab[]).forEach(function (candidateTab) {
        const isSelected = candidateTab === recordTab;
        const tabElement = newRecordsState.tabElements[candidateTab];
        if (isSelected) { tabElement.classList.add('selected'); } else { tabElement.classList.remove('selected'); }
        tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tabElement.setAttribute('tabindex', isSelected ? '0' : '-1');
        setShown(newRecordsState.panelElements[candidateTab], isSelected);
    });
}

/*
    The two tabs of an object below the parent, built with its section. recordsElement, which holds
    the loaded table, becomes the first tab's panel content; the second is the new records tab.
    Both are built at once, so switching keeps what each holds.
*/
export function buildUpdaterRecordTabs(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, recordsElement: HTMLElement): HTMLElement {

    const objectApiName = updaterObjectState.object.objectApiName;
    const tabsElement = createElement('div', 'updaterRecordTabs');
    const stripElement = createElement('div', 'troubleshootingSubTabs updaterRecordTabStrip');
    stripElement.setAttribute('role', 'tablist');
    stripElement.setAttribute('aria-label', objectApiName + ' records');

    const buildTab = function (recordTab: UpdaterRecordTab, label: string): { tabElement: HTMLButtonElement; panelElement: HTMLElement } {
        const tabElement = createButton('secondary', 'troubleshootingSubTab updaterRecordTab updaterRecordTab-' + recordTab, label);
        const panelElement = createElement('div', 'updaterRecordTabPanel updaterRecordTabPanel-' + recordTab);
        tabElement.setAttribute('data-label', label);
        tabElement.setAttribute('role', 'tab');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', label + ' of ' + objectApiName);
        tabElement.addEventListener('click', function () { selectRecordTab(newRecordsState, recordTab); });
        // LEFT AND RIGHT MOVE BETWEEN THE TWO TABS, AS A TAB LIST DOES
        tabElement.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return; }
            event.preventDefault();
            const otherTab: UpdaterRecordTab = recordTab === 'edit' ? 'new' : 'edit';
            selectRecordTab(newRecordsState, otherTab);
            focusElement(newRecordsState.tabElements[otherTab]);
        });
        stripElement.appendChild(tabElement);
        return { tabElement: tabElement, panelElement: panelElement };
    };

    const editTab = buildTab('edit', RECIPE_COCKPIT_UPDATER_EDIT_HEADING);
    const newTab = buildTab('new', RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL);

    const fieldTreeState: IUpdaterFieldTreeState = {
        tree: { treeKey: treeState.tree.treeKey, fixedValues: treeState.tree.fixedValues },
        updaterChosenFieldKeys: Object.create(null),
        isFieldChoiceOffered: true,
        updaterEditedValues: Object.create(null),
        updaterObjectStates: [],
        updaterSummaryElement: null
    };
    const fieldObjectState: IUpdaterFieldObjectState = { object: { objectApiName: objectApiName }, chosenFieldCount: 0, countText: '', countElement: createElement('span', 'updaterNewRecordsChosen muted'), loadedRecords: null };

    const headingElement = createElement('div', 'updaterNewRecordsHeading');
    const countRowElement = createElement('div', 'adapterChildCount updaterNewRecordsCount');
    const countInputElement = createElement('input', 'adapterChildCountInput updaterNewRecordsCountInput');
    const countLabelElement = createElement('span', 'adapterChildCountText');
    countInputElement.setAttribute('type', 'text');
    countInputElement.setAttribute('inputmode', 'numeric');
    countInputElement.setAttribute('maxlength', '6');
    countInputElement.value = '1';
    countRowElement.appendChild(createElement('span', 'adapterChildCountText', 'Create'));
    countRowElement.appendChild(countInputElement);
    countRowElement.appendChild(countLabelElement);
    countRowElement.appendChild(fieldObjectState.countElement);

    const fieldsElement = createElement('div', 'updaterNewRecordsFields');
    const fieldStates = updaterObjectState.fieldStates.map(function (recipeFieldState) {
        const fieldState: IUpdaterFieldRowState = {
            fieldChange: null, childObject: null, field: recipeFieldState.field, fieldKey: recipeFieldState.fieldKey,
            lockReason: recipeFieldState.lockReason === RECIPE_COCKPIT_UPDATER_LOOKUP_REASON ? RECIPE_COCKPIT_UPDATER_NEW_RECORDS_LOOKUP_REASON : recipeFieldState.lockReason,
            orgChange: null, orgChipElement: null, isMatch: true, rowElement: null, chooseElement: null, editButtonElement: null, editBadgeElement: null,
            editedValueElement: null, expressionRowElement: null, editorElement: null, isEditorOpen: false
        };
        // A FIELD WITH AN EXPRESSION STARTS TICKED, AS THE TREECIPE TAB'S FIELDS DO; ONE WHOSE RECIPE VALUE IS A COMMENT (A TODO) WAITS FOR A VALUE
        const recipeValue = String(fieldState.field.recipeValue || '');
        if (!fieldState.lockReason && recipeValue !== '' && recipeValue.charAt(0) !== '#') {
            fieldTreeState.updaterChosenFieldKeys[fieldState.fieldKey] = true;
            fieldObjectState.chosenFieldCount++;
        }
        // A ROW OF ITS OWN KIND: THE SECTION'S FILTER AND COUNTS READ updaterField, WHICH DESCRIBES THE OBJECT'S FIELDS ONCE
        const rowElement = buildUpdaterFieldRow(fieldTreeState, fieldObjectState, fieldState);
        rowElement.classList.remove('updaterField');
        rowElement.classList.add('updaterNewRecordsField');
        fieldsElement.appendChild(rowElement);
        return fieldState;
    });
    drawUpdaterObjectCount(fieldObjectState);

    const refusalElement = createElement('div', 'adapterChildRefusal updaterNewRecordsRefusal hidden');
    refusalElement.setAttribute('role', 'alert');
    const generateElement = createButton('primary', 'updaterNewRecordsGenerate', RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL, 'compact');
    const reasonElement = createElement('span', 'updaterNewRecordsReason muted');
    const actionRowElement = createElement('div', 'updaterNewRecordsAction');
    actionRowElement.appendChild(generateElement);
    actionRowElement.appendChild(reasonElement);
    const previewElement = createElement('div', 'updaterNewRecordsPreview hidden');

    [headingElement, countRowElement, fieldsElement, refusalElement, actionRowElement, createElement('div', 'adapterChildPreviewNote muted', RECIPE_COCKPIT_UPDATER_NEW_RECORDS_PREVIEW_NOTE), previewElement]
        .forEach(function (childElement) { newTab.panelElement.appendChild(childElement); });
    editTab.panelElement.appendChild(recordsElement);

    const newRecordsState: IUpdaterNewRecordsState = {
        selectedTab: 'edit',
        tabElements: { edit: editTab.tabElement, new: newTab.tabElement },
        panelElements: { edit: editTab.panelElement, new: newTab.panelElement },
        fieldTreeState: fieldTreeState,
        fieldStates: fieldStates,
        headingElement: headingElement,
        countInputElement: countInputElement,
        countLabelElement: countLabelElement,
        refusalElement: refusalElement,
        generateElement: generateElement,
        reasonElement: reasonElement,
        previewElement: previewElement,
        previewPageIndex: 0,
        previewRows: null,
        isPageRequested: false
    };
    updaterObjectState.newRecords = newRecordsState;

    generateElement.addEventListener('click', function () { requestNewRecords(treeState, updaterObjectState); });
    countInputElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); requestNewRecords(treeState, updaterObjectState); }
    });

    tabsElement.appendChild(stripElement);
    tabsElement.appendChild(editTab.panelElement);
    tabsElement.appendChild(newTab.panelElement);
    selectRecordTab(newRecordsState, 'edit');
    drawNewRecordsControls(treeState, updaterObjectState);
    drawNewRecordsPreview(treeState, updaterObjectState);

    return tabsElement;

}

// WHY Generate records CANNOT RUN NOW, OR '': THE HOST HOLDS A REQUEST TO THE SAME RULES
function findNewRecordsReason(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): string {
    if (runLocks.updaterLoadRunningTreeKey !== null) { return 'Records are being loaded, generated, updated or restored.'; }
    if (!treeState.updaterRecordsMessage) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_LOADED_REASON; }
    const newRecordsParent = readNewRecordsParent(updaterObjectState);
    if (!newRecordsParent) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_READ_REASON; }
    if (newRecordsParent.parentRecordCount === 0) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON; }
    return '';
}

// THE HEADING, THE COUNT'S LABEL AND THE BUTTON, AS THE LAST LOAD AND THE RUN IN FLIGHT LEAVE THEM; drawUpdaterLoadButtons CALLS THIS FOR EVERY OBJECT
export function drawNewRecordsControls(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): void {

    const newRecordsState = updaterObjectState.newRecords;
    if (!newRecordsState) { return; }

    const objectApiName = updaterObjectState.object.objectApiName;
    const newRecordsParent = readNewRecordsParent(updaterObjectState);
    const parentName = newRecordsParent ? newRecordsParent.parentObjectApiName : 'parent';
    const countLabel = objectApiName + ' records per loaded ' + parentName + ' record';
    const reason = findNewRecordsReason(treeState, updaterObjectState);
    const isGenerating = runLocks.updaterRunKind === 'generateNew' && runLocks.updaterLoadRunningTreeKey === treeState.tree.treeKey && runLocks.updaterNewRecordsObjectApiName === objectApiName;

    newRecordsState.headingElement.textContent = newRecordsParent
        ? 'Add new ' + objectApiName + ' records under the ' + pluralize(newRecordsParent.parentRecordCount, parentName + ' record', parentName + ' records') + ' loaded.'
        : 'Add new ' + objectApiName + ' records under the records a load read of the object above it.';
    newRecordsState.countLabelElement.textContent = countLabel;
    newRecordsState.countInputElement.setAttribute('aria-label', countLabel);
    newRecordsState.generateElement.textContent = isGenerating ? RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATING_LABEL : RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL;
    newRecordsState.generateElement.setAttribute('aria-label', RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL + ' of ' + objectApiName);
    newRecordsState.generateElement.disabled = reason !== '';
    newRecordsState.generateElement.setAttribute('title', reason);
    newRecordsState.reasonElement.textContent = isGenerating ? '' : reason;

    const pagerElements = newRecordsState.pagerElements;
    if (pagerElements) {
        const isHeld = runLocks.updaterLoadRunningTreeKey !== null || newRecordsState.isPageRequested;
        pagerElements.previousElement.disabled = isHeld || pagerElements.isPreviousAtEnd;
        pagerElements.nextElement.disabled = isHeld || pagerElements.isNextAtEnd;
    }

}

function requestNewRecords(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): void {

    const newRecordsState = updaterObjectState.newRecords;
    if (!newRecordsState || renderedSequence === null || findNewRecordsReason(treeState, updaterObjectState) !== '') { return; }

    const objectApiName = updaterObjectState.object.objectApiName;
    const countText = String(newRecordsState.countInputElement.value || '').trim();
    const countPerParent = Number(countText);

    if (!/^[1-9][0-9]*$/.test(countText) || !Number.isSafeInteger(countPerParent)) {
        newRecordsState.refusalElement.textContent = 'The count per loaded record must be a whole number of one or more.';
        setShown(newRecordsState.refusalElement, true);
        return;
    }
    newRecordsState.refusalElement.textContent = '';
    setShown(newRecordsState.refusalElement, false);

    const fields: IAdapterChildFieldRequest[] = [];
    newRecordsState.fieldStates.forEach(function (fieldState) {
        if (fieldState.lockReason || !hasOwnKey(newRecordsState.fieldTreeState.updaterChosenFieldKeys, fieldState.fieldKey)) { return; }
        const fieldRequest: IAdapterChildFieldRequest = { fieldApiName: fieldState.field.fieldApiName };
        if (hasOwnKey(newRecordsState.fieldTreeState.updaterEditedValues, fieldState.fieldKey)) { fieldRequest.value = newRecordsState.fieldTreeState.updaterEditedValues[fieldState.fieldKey]; }
        fields.push(fieldRequest);
    });

    runLocks.updaterLoadRunningTreeKey = treeState.tree.treeKey;
    runLocks.updaterRunKind = 'generateNew';
    runLocks.updaterNewRecordsObjectApiName = objectApiName;
    drawUpdaterLoadButtons();
    vscodeApi.postMessage({ command: 'generateUpdaterNewRecords', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence, objectApiName: objectApiName, countPerParent: countPerParent, fields: fields });

}

function findObjectState(treeState: IAdapterTreeState, objectApiName: unknown): IUpdaterObjectState | undefined {
    return (treeState.updaterObjectStates || []).find(function (candidateObjectState) { return candidateObjectState.object.objectApiName === objectApiName; });
}

// AN OBJECT'S NEW RECORDS ARE DRAWN ONLY ON THE MODEL THEY WERE GENERATED ON; A TAB NOT YET BUILT DRAWS THEM WHEN IT IS
export function renderUpdaterNewRecords(newRecordsMessage: IUpdaterNewRecordsMessage): void {

    if (renderedSequence === null || newRecordsMessage.renderSequence !== renderedSequence || typeof newRecordsMessage.objectApiName !== 'string') { return; }

    const treeState = findTreeState(newRecordsMessage.treeKey);
    if (!treeState) { return; }

    treeState.updaterNewRecordsMessages[newRecordsMessage.objectApiName] = newRecordsMessage;
    const updaterObjectState = findObjectState(treeState, newRecordsMessage.objectApiName);
    if (updaterObjectState && updaterObjectState.newRecords) {
        updaterObjectState.newRecords.previewPageIndex = 0;
        updaterObjectState.newRecords.previewRows = null;
        updaterObjectState.newRecords.isPageRequested = false;
        drawNewRecordsPreview(treeState, updaterObjectState);
    }

}

export function renderUpdaterNewRecordsPage(pageMessage: IUpdaterNewRecordsPageMessage): void {

    if (renderedSequence === null || pageMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(pageMessage.treeKey);
    const updaterObjectState = treeState ? findObjectState(treeState, pageMessage.objectApiName) : undefined;
    const newRecordsState = updaterObjectState ? updaterObjectState.newRecords : undefined;
    const pageIndex = Number(pageMessage.pageIndex);

    if (!treeState || !updaterObjectState || !newRecordsState || !Number.isInteger(pageIndex) || pageIndex < 0 || !Array.isArray(pageMessage.rows)) { return; }

    const isMovingForward = pageIndex > newRecordsState.previewPageIndex;
    newRecordsState.previewPageIndex = pageIndex;
    newRecordsState.previewRows = pageMessage.rows;
    newRecordsState.isPageRequested = false;
    drawNewRecordsPreview(treeState, updaterObjectState);

    // THE PAGER WAS REDRAWN WITH THE TABLE, SO THE KEYBOARD'S PLACE GOES BACK TO THE BUTTON PRESSED, OR TO THE OTHER AT AN END
    const pagerElements = newRecordsState.pagerElements;
    if (!pagerElements) { return; }
    const pressedElement = isMovingForward ? pagerElements.nextElement : pagerElements.previousElement;
    focusElement(pressedElement.disabled ? (isMovingForward ? pagerElements.previousElement : pagerElements.nextElement) : pressedElement);

}

// A NEW LOAD, A PARENT CHANGE OR A SPENT UPDATE LETS THE NEW RECORDS GO WITH THE LOADED ONES THEY WERE GENERATED UNDER
export function clearUpdaterNewRecords(): void {
    treeStates.forEach(function (treeState) {
        treeState.updaterNewRecordsMessages = Object.create(null);
        (treeState.updaterObjectStates || []).forEach(function (updaterObjectState) {
            if (!updaterObjectState.newRecords) { return; }
            updaterObjectState.newRecords.previewRows = null;
            updaterObjectState.newRecords.previewPageIndex = 0;
            drawNewRecordsPreview(treeState, updaterObjectState);
        });
    });
}

function drawNewRecordsPreview(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): void {

    const newRecordsState = updaterObjectState.newRecords;
    if (!newRecordsState) { return; }

    const objectApiName = updaterObjectState.object.objectApiName;
    const previewElement = newRecordsState.previewElement;
    const previewMessage = hasOwnKey(treeState.updaterNewRecordsMessages, objectApiName) ? treeState.updaterNewRecordsMessages[objectApiName] : null;
    previewElement.textContent = '';
    newRecordsState.pagerElements = null;

    if (!previewMessage) {
        setShown(previewElement, false);
        return;
    }

    const columns: string[] = Array.isArray(previewMessage.columns) ? previewMessage.columns.map(String) : [];
    const pageIndex = newRecordsState.previewPageIndex;
    const rows: unknown[] = newRecordsState.previewRows || (Array.isArray(previewMessage.rows) ? previewMessage.rows : []);
    const recordCount = Number(previewMessage.recordCount) || 0;
    const pageCount = Math.max(Number(previewMessage.pageCount) || 0, 1);

    previewElement.appendChild(createElement('div', 'updaterNewRecordsSummary muted',
        pluralize(recordCount, 'new ' + objectApiName + ' record', 'new ' + objectApiName + ' records') + ', ' + String(previewMessage.countPerParent) + ' per ' + String(previewMessage.parentObjectApiName) + ' record'));
    if (columns.length > 0) { previewElement.appendChild(buildRecordTable(columns, rows)); }

    const pagerElement = createElement('div', 'updaterRecordsPager');
    const pageLabelElement = createElement('span', 'updaterRecordsPageLabel muted', 'Page ' + (pageIndex + 1) + ' of ' + pageCount);
    // A NEW PAGE IS SAID ALOUD: THE TABLE IS REDRAWN UNDER THE READER
    pageLabelElement.setAttribute('aria-live', 'polite');

    if (pageCount > 1) {
        const previousElement = createButton('secondary', 'updaterNewRecordsPrevious', RECIPE_COCKPIT_UPDATER_PREVIOUS_PAGE_LABEL, 'compact');
        const nextElement = createButton('secondary', 'updaterNewRecordsNext', RECIPE_COCKPIT_UPDATER_NEXT_PAGE_LABEL, 'compact');
        previousElement.setAttribute('aria-label', 'Previous page of new ' + objectApiName + ' records');
        nextElement.setAttribute('aria-label', 'Next page of new ' + objectApiName + ' records');
        const requestPage = function (requestedPageIndex: number): void {
            if (renderedSequence === null || newRecordsState.isPageRequested || runLocks.updaterLoadRunningTreeKey !== null) { return; }
            newRecordsState.isPageRequested = true;
            drawNewRecordsControls(treeState, updaterObjectState);
            vscodeApi.postMessage({ command: 'loadUpdaterNewRecordsPage', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence, objectApiName: objectApiName, pageIndex: requestedPageIndex });
        };
        previousElement.addEventListener('click', function () { requestPage(pageIndex - 1); });
        nextElement.addEventListener('click', function () { requestPage(pageIndex + 1); });
        pagerElement.appendChild(previousElement);
        pagerElement.appendChild(pageLabelElement);
        pagerElement.appendChild(nextElement);
        newRecordsState.pagerElements = { previousElement: previousElement, nextElement: nextElement, isPreviousAtEnd: pageIndex === 0, isNextAtEnd: pageIndex >= pageCount - 1 };
    } else {
        pagerElement.appendChild(pageLabelElement);
    }

    previewElement.appendChild(pagerElement);
    setShown(previewElement, true);
    drawNewRecordsControls(treeState, updaterObjectState);

}
