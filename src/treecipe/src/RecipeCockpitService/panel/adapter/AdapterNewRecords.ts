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
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_UNREAD_FIELD_REASON,
    RECIPE_COCKPIT_UPDATER_NEXT_PAGE_LABEL,
    RECIPE_COCKPIT_UPDATER_PREVIOUS_PAGE_LABEL
} from '../../RecipeCockpitAdapterConstants';
import { buildRecordTable } from '../RecipeCockpitRecordTable';
import { drawUpdaterLoadButtons } from './AdapterLoadAndUpdate';
import { buildUpdaterFieldRow, drawUpdaterFieldChoice, drawUpdaterObjectCount } from './AdapterTab';
import { findFixedValue, isExpressionValue } from '../treecipe/fieldRows/FieldRowFixedValue';
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
    "Edit existing records", and the block "Add to data set" opens for a child object only the org
    holds (#447). The reader ticks the object's fields, may type a value for one, sets a count per
    loaded parent record and presses Generate records; the host generates the records under the
    loaded parents and answers with a preview. The ticks, the typed values and the count are this
    panel's own and are posted only with Generate records; the records, and what a field
    generates from, are the host's.
*/

// WHAT THE LAST LOAD SAID OF THE OBJECT NEW RECORDS GO UNDER, READ AS UNTRUSTED
function readLoadedParent(updaterObjectState: IUpdaterObjectState): INewRecordsParent | null {
    const loadedRecords = updaterObjectState.loadedRecords;
    const newRecordsParent = (loadedRecords && loadedRecords.newRecordsParent && typeof loadedRecords.newRecordsParent === 'object' ? loadedRecords.newRecordsParent : null) as { parentObjectApiName?: unknown; parentRecordCount?: unknown } | null;
    return newRecordsParent && typeof newRecordsParent.parentObjectApiName === 'string'
        ? { parentObjectApiName: newRecordsParent.parentObjectApiName, parentRecordCount: Number(newRecordsParent.parentRecordCount) || 0 }
        : null;
}

// EVERY Generate new records PANEL OF A CARD: EACH BUILT OBJECT BELOW THE PARENT, AND THE ORG-ONLY CHILD Add to data set OPENED
export function listNewRecordsStates(treeState: IAdapterTreeState): IUpdaterNewRecordsState[] {
    const newRecordsStates = (treeState.updaterObjectStates || []).flatMap(function (updaterObjectState) { return updaterObjectState.newRecords ? [updaterObjectState.newRecords] : []; });
    return treeState.adapterChild ? newRecordsStates.concat([treeState.adapterChild.newRecords]) : newRecordsStates;
}

function findNewRecordsState(treeState: IAdapterTreeState, objectApiName: unknown): IUpdaterNewRecordsState | undefined {
    return listNewRecordsStates(treeState).find(function (newRecordsState) { return newRecordsState.objectApiName === objectApiName; });
}

function selectRecordTab(newRecordsState: IUpdaterNewRecordsState, recordTab: UpdaterRecordTab): void {
    const tabElements = newRecordsState.tabElements;
    const panelElements = newRecordsState.panelElements;
    if (!tabElements || !panelElements) { return; }
    newRecordsState.selectedTab = recordTab;
    (['edit', 'new'] as UpdaterRecordTab[]).forEach(function (candidateTab) {
        const isSelected = candidateTab === recordTab;
        const tabElement = tabElements[candidateTab];
        if (isSelected) { tabElement.classList.add('selected'); } else { tabElement.classList.remove('selected'); }
        tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tabElement.setAttribute('tabindex', isSelected ? '0' : '-1');
        setShown(panelElements[candidateTab], isSelected);
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

    const buildTab = function (recordTab: UpdaterRecordTab, label: string, panelElement: HTMLElement): { tabElement: HTMLButtonElement; panelElement: HTMLElement } {
        const tabElement = createButton('secondary', 'troubleshootingSubTab updaterRecordTab updaterRecordTab-' + recordTab, label);
        tabElement.setAttribute('data-label', label);
        tabElement.setAttribute('role', 'tab');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', label + ' of ' + objectApiName);
        tabElement.addEventListener('click', function () { selectRecordTab(newRecordsState, recordTab); });
        tabElements[recordTab] = tabElement;
        // LEFT AND RIGHT MOVE BETWEEN THE TWO TABS, AS A TAB LIST DOES
        tabElement.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return; }
            event.preventDefault();
            const otherTab: UpdaterRecordTab = recordTab === 'edit' ? 'new' : 'edit';
            selectRecordTab(newRecordsState, otherTab);
            focusElement(tabElements[otherTab]);
        });
        stripElement.appendChild(tabElement);
        return { tabElement: tabElement, panelElement: panelElement };
    };

    const tabElements = {} as Record<UpdaterRecordTab, HTMLButtonElement>;
    const newPanelElement = createElement('div', 'updaterRecordTabPanel updaterRecordTabPanel-new');
    // BUILT FIRST, SO THE TABS BELOW CAN NAME IT
    const newRecordsState = buildNewRecordsPanel(treeState, {
        objectApiName: objectApiName,
        containerElement: newPanelElement,
        fieldRows: updaterObjectState.fieldStates.map(function (recipeFieldState) {
            const fieldState: IUpdaterFieldRowState = {
                fieldChange: null, childObject: null, field: recipeFieldState.field, fieldKey: recipeFieldState.fieldKey,
                lockReason: recipeFieldState.lockReason === RECIPE_COCKPIT_UPDATER_LOOKUP_REASON ? RECIPE_COCKPIT_UPDATER_NEW_RECORDS_LOOKUP_REASON : recipeFieldState.lockReason,
                orgChange: null, orgChipElement: null, isMatch: true, rowElement: null, chooseElement: null, editButtonElement: null, editBadgeElement: null,
                editedValueElement: null, expressionRowElement: null, editorElement: null, isEditorOpen: false
            };
            // A FIELD THE HOST CAN GENERATE STARTS TICKED, AS THE TREECIPE TAB'S FIELDS DO: ONE WITH AN EXPRESSION LINE, OR A VALUE FIXED ON THE TREECIPE TAB.
            // ANY OTHER (A TODO, A LITERAL TYPED INTO THE RECIPE) WAITS FOR A VALUE
            const hasExpression = String(fieldState.field.recipeValue || '').split('\n').some(function (valueLine) { return isExpressionValue(valueLine.trim()); });
            return { fieldState: fieldState, isTicked: hasExpression || findFixedValue(treeState.tree, objectApiName, fieldState.field.fieldApiName, undefined) !== null };
        }),
        fixedValues: treeState.tree.fixedValues,
        readParent: function () { return readLoadedParent(updaterObjectState); },
        readUnreadFieldApiNames: function () {
            const loadedRecords = updaterObjectState.loadedRecords;
            return loadedRecords && Array.isArray(loadedRecords.unreadFieldApiNames) ? loadedRecords.unreadFieldApiNames.map(String) : [];
        }
    });

    const editTab = buildTab('edit', RECIPE_COCKPIT_UPDATER_EDIT_HEADING, createElement('div', 'updaterRecordTabPanel updaterRecordTabPanel-edit'));
    const newTab = buildTab('new', RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL, newPanelElement);
    editTab.panelElement.appendChild(recordsElement);
    newRecordsState.tabElements = tabElements;
    newRecordsState.panelElements = { edit: editTab.panelElement, new: newTab.panelElement };
    updaterObjectState.newRecords = newRecordsState;

    tabsElement.appendChild(stripElement);
    tabsElement.appendChild(editTab.panelElement);
    tabsElement.appendChild(newTab.panelElement);
    selectRecordTab(newRecordsState, 'edit');

    return tabsElement;

}

export interface INewRecordsParent {
    parentObjectApiName: string;
    parentRecordCount: number;
}

// WHAT ONE Generate new records PANEL IS BUILT FROM: THE OBJECT, ITS FIELD ROWS AND WHICH START TICKED, AND WHERE IT READS WHAT A LOAD SAID
export interface INewRecordsPanelOptions {
    objectApiName: string;
    containerElement: HTMLElement;
    fieldRows: Array<{ fieldState: IUpdaterFieldRowState; isTicked: boolean; decorateRow?: (rowElement: HTMLElement) => void }>;
    fixedValues: IAdapterTreeState['tree']['fixedValues'];
    readParent: () => INewRecordsParent | null;
    readUnreadFieldApiNames: () => string[];
}

/*
    The panel itself: a heading, the count per loaded parent record, the object's fields with a
    box each, Generate records and the preview. The same for a tree object's tab and for an
    org-only child's block, which differ only in where their fields and their parent come from.
*/
export function buildNewRecordsPanel(treeState: IAdapterTreeState, panelOptions: INewRecordsPanelOptions): IUpdaterNewRecordsState {

    const objectApiName = panelOptions.objectApiName;
    const fieldTreeState: IUpdaterFieldTreeState = {
        tree: { treeKey: treeState.tree.treeKey, fixedValues: panelOptions.fixedValues },
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
    const fieldStates = panelOptions.fieldRows.map(function (fieldRow) {
        const fieldState = fieldRow.fieldState;
        if (!fieldState.lockReason && fieldRow.isTicked) {
            fieldTreeState.updaterChosenFieldKeys[fieldState.fieldKey] = true;
            fieldObjectState.chosenFieldCount++;
        }
        // A ROW OF ITS OWN KIND: THE SECTION'S FILTER AND COUNTS READ updaterField, WHICH DESCRIBES THE OBJECT'S FIELDS ONCE
        const rowElement = buildUpdaterFieldRow(fieldTreeState, fieldObjectState, fieldState);
        rowElement.classList.remove('updaterField');
        rowElement.classList.add('updaterNewRecordsField');
        if (fieldRow.decorateRow) { fieldRow.decorateRow(rowElement); }
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
        .forEach(function (childElement) { panelOptions.containerElement.appendChild(childElement); });

    const newRecordsState: IUpdaterNewRecordsState = {
        objectApiName: objectApiName,
        readParent: panelOptions.readParent,
        readUnreadFieldApiNames: panelOptions.readUnreadFieldApiNames,
        selectedTab: 'edit',
        fieldTreeState: fieldTreeState,
        fieldStates: fieldStates,
        fieldObjectState: fieldObjectState,
        baseLockReasons: fieldStates.map(function (fieldState) { return fieldState.lockReason; }),
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

    generateElement.addEventListener('click', function () { requestNewRecords(treeState, newRecordsState); });
    countInputElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); requestNewRecords(treeState, newRecordsState); }
    });

    drawNewRecordsControls(treeState, newRecordsState);
    drawNewRecordsPreview(treeState, newRecordsState);

    return newRecordsState;

}

// WHY Generate records CANNOT RUN NOW, OR '': THE HOST HOLDS A REQUEST TO THE SAME RULES
function findNewRecordsReason(treeState: IAdapterTreeState, newRecordsState: IUpdaterNewRecordsState): string {
    if (runLocks.updaterLoadRunningTreeKey !== null) { return 'Records are being loaded, generated, updated or restored.'; }
    if (!treeState.updaterRecordsMessage) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_LOADED_REASON; }
    const newRecordsParent = newRecordsState.readParent();
    if (!newRecordsParent) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_READ_REASON; }
    if (newRecordsParent.parentRecordCount === 0) { return RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON; }
    return '';
}

// THE HEADING, THE COUNT'S LABEL AND THE BUTTON, AS THE LAST LOAD AND THE RUN IN FLIGHT LEAVE THEM; drawUpdaterLoadButtons CALLS THIS FOR EVERY OBJECT
export function drawNewRecordsControls(treeState: IAdapterTreeState, newRecordsState: IUpdaterNewRecordsState): void {

    const objectApiName = newRecordsState.objectApiName;
    const newRecordsParent = newRecordsState.readParent();
    const parentName = newRecordsParent ? newRecordsParent.parentObjectApiName : 'parent';
    const countLabel = objectApiName + ' records per loaded ' + parentName + ' record';
    const reason = findNewRecordsReason(treeState, newRecordsState);
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

    // A FIELD THE LAST LOAD LEFT OUT IS LOCKED AND UNTICKED UNTIL A LOAD READS IT: THE HOST WOULD REFUSE THE WHOLE REQUEST FOR IT
    const unreadFieldApiNames = newRecordsState.readUnreadFieldApiNames();
    newRecordsState.fieldStates.forEach(function (fieldState, fieldIndex) {
        const lockReason = unreadFieldApiNames.indexOf(fieldState.field.fieldApiName) !== -1 ? RECIPE_COCKPIT_UPDATER_NEW_RECORDS_UNREAD_FIELD_REASON : newRecordsState.baseLockReasons[fieldIndex];
        if (lockReason === fieldState.lockReason) { return; }
        fieldState.lockReason = lockReason;
        if (lockReason && hasOwnKey(newRecordsState.fieldTreeState.updaterChosenFieldKeys, fieldState.fieldKey)) {
            delete newRecordsState.fieldTreeState.updaterChosenFieldKeys[fieldState.fieldKey];
            newRecordsState.fieldObjectState.chosenFieldCount--;
        }
        drawUpdaterFieldChoice(newRecordsState.fieldTreeState, newRecordsState.fieldObjectState, fieldState);
        drawUpdaterObjectCount(newRecordsState.fieldObjectState);
    });

    const pagerElements = newRecordsState.pagerElements;
    if (pagerElements) {
        const isHeld = runLocks.updaterLoadRunningTreeKey !== null || newRecordsState.isPageRequested;
        pagerElements.previousElement.disabled = isHeld || pagerElements.isPreviousAtEnd;
        pagerElements.nextElement.disabled = isHeld || pagerElements.isNextAtEnd;
    }

}

function requestNewRecords(treeState: IAdapterTreeState, newRecordsState: IUpdaterNewRecordsState): void {

    if (renderedSequence === null || findNewRecordsReason(treeState, newRecordsState) !== '') { return; }

    const objectApiName = newRecordsState.objectApiName;
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

// AN OBJECT'S NEW RECORDS ARE DRAWN ONLY ON THE MODEL THEY WERE GENERATED ON; A TAB NOT YET BUILT DRAWS THEM WHEN IT IS
export function renderUpdaterNewRecords(newRecordsMessage: IUpdaterNewRecordsMessage): void {

    if (renderedSequence === null || newRecordsMessage.renderSequence !== renderedSequence || typeof newRecordsMessage.objectApiName !== 'string') { return; }

    const treeState = findTreeState(newRecordsMessage.treeKey);
    if (!treeState) { return; }

    treeState.updaterNewRecordsMessages[newRecordsMessage.objectApiName] = newRecordsMessage;
    const newRecordsState = findNewRecordsState(treeState, newRecordsMessage.objectApiName);
    if (newRecordsState) {
        newRecordsState.previewPageIndex = 0;
        newRecordsState.previewRows = null;
        newRecordsState.isPageRequested = false;
        drawNewRecordsPreview(treeState, newRecordsState);
    }

}

export function renderUpdaterNewRecordsPage(pageMessage: IUpdaterNewRecordsPageMessage): void {

    if (renderedSequence === null || pageMessage.renderSequence !== renderedSequence) { return; }

    const treeState = findTreeState(pageMessage.treeKey);
    const newRecordsState = treeState ? findNewRecordsState(treeState, pageMessage.objectApiName) : undefined;
    const pageIndex = Number(pageMessage.pageIndex);

    if (!treeState || !newRecordsState || !Number.isInteger(pageIndex) || pageIndex < 0 || !Array.isArray(pageMessage.rows)) { return; }

    const isMovingForward = pageIndex > newRecordsState.previewPageIndex;
    newRecordsState.previewPageIndex = pageIndex;
    newRecordsState.previewRows = pageMessage.rows;
    newRecordsState.isPageRequested = false;
    drawNewRecordsPreview(treeState, newRecordsState);

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
        listNewRecordsStates(treeState).forEach(function (newRecordsState) {
            newRecordsState.previewRows = null;
            newRecordsState.previewPageIndex = 0;
            drawNewRecordsPreview(treeState, newRecordsState);
        });
    });
}

function drawNewRecordsPreview(treeState: IAdapterTreeState, newRecordsState: IUpdaterNewRecordsState): void {

    const objectApiName = newRecordsState.objectApiName;
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
            drawNewRecordsControls(treeState, newRecordsState);
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
    drawNewRecordsControls(treeState, newRecordsState);

}
