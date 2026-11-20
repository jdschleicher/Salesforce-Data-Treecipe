import { isConfirmDialogOpen } from '../../../../CockpitKit/panel/CockpitConfirmDialogPanel';
import { SVG_NAMESPACE, createButton, createElement, drawToggle, focusElement, isMotionReduced, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { OBJECT_REFRESH_KINDS, OBJECT_REFRESH_KIND_LABELS, RECIPE_COCKPIT_OBJECT_REFRESH_GLYPH_PATH, RECIPE_COCKPIT_OBJECT_REFRESH_LABEL } from '../../../RecipeCockpitObjectRefreshConstants';
import type { ObjectRefreshKind } from '../../../RecipeCockpitObjectRefreshConstants';
import { RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH, RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX } from '../../../RecipeCockpitPanelConstants';
import { buildRowTable } from '../../RecipeCockpitPanelBuilders';
import { cockpitBodyElement, cockpitDialogHostElement, cockpitMetaElement, loadStatusElement, vscodeApi } from '../../RecipeCockpitPanelConnection';
import { renderedSequence } from '../../shell/PanelRender';
import { dataOrgPicker } from '../dataOrg/DataOrgPickerState';
import { buildDataOrgView } from '../dataOrg/DataOrgView';
import type { IDataOrgView } from '../dataOrg/DataOrgTypes';

/*
    The panel half of "Get latest detail" (#612): the row's button and the dialog the host drives
    through objectRefreshState. The dialog draws over the cockpit with the confirmation's own
    overlay classes, writes every host string through textContent, and answers only with the
    dialog's id, kind names from the fixed list, and item indexes. Its styles are ObjectRefreshDialog.css
    beside it, which the cockpit's stylesheet includes (#644).
*/

type ObjectRefreshStep = 'choose' | 'retrieving' | 'applying' | 'review';

interface IObjectRefreshDialog {
    refreshId: string;
    step: ObjectRefreshStep;
    overlayElement: HTMLElement;
    orgView: IDataOrgView | null;
    focusableElements: Array<HTMLElement & { disabled?: boolean }>;
    cancelElement: HTMLButtonElement | null;
    onCancel: (() => void) | null;
    firstFocusElement: HTMLElement | null;
}

interface IObjectRefreshItem {
    name?: unknown;
    status?: unknown;
    detail?: unknown;
    differences?: unknown;
    recipeNote?: unknown;
}

interface IObjectRefreshGroup {
    label?: unknown;
    items?: unknown;
    unchangedCount?: number;
    unreadableCount?: number;
}

// WHAT THE HOST POSTS: EVERY FIELD IS CHECKED BEFORE IT IS DRAWN
interface IObjectRefreshStateMessage {
    refreshId?: unknown;
    renderSequence?: unknown;
    objectApiName?: unknown;
    nickname?: unknown;
    kinds?: unknown;
    step?: unknown;
    orgLabel?: unknown;
    groups?: unknown;
    tickedItemIndexes?: unknown;
}

// A STATE CHECKED BY renderObjectRefreshState: ITS ID, OBJECT, KINDS AND STEP ARE WHAT EACH STEP DRAWS FROM
interface IObjectRefreshState extends IObjectRefreshStateMessage {
    refreshId: string;
    objectApiName: string;
    kinds: unknown[];
    step: ObjectRefreshStep;
}

type ObjectRefreshStepBuilder = (hostMessage: IObjectRefreshState, bodyElement: HTMLElement, actionsElement: HTMLElement) => void;

// THE ONE "Get latest object detail" DIALOG ON SCREEN (#612), OR null; ITS OPENER OUTLIVES A STEP ASIDE FOR THE CONFIRMATION
let objectRefreshDialog: IObjectRefreshDialog | null = null;
let objectRefreshOpenerElement: HTMLButtonElement | null = null;

/*
    The row's button (#612): only the occurrence it is on, by name and, for an object with
    iterations, its nickname. Everything after this is the host's to decide.
*/
export function buildObjectRefreshButton(treeKey: string, object: { objectApiName: string; nickname?: string }): HTMLButtonElement {

    const buttonElement = createButton('secondary', 'treeObjectRefresh', '', 'compact');
    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
    glyphElement.setAttribute('class', 'objectRefreshGlyph');
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', RECIPE_COCKPIT_OBJECT_REFRESH_GLYPH_PATH);
    glyphElement.appendChild(pathElement);
    buttonElement.appendChild(glyphElement);
    buttonElement.appendChild(createElement('span', 'objectRefreshButtonLabel', RECIPE_COCKPIT_OBJECT_REFRESH_LABEL));
    // THE NAME STARTS WITH THE VISIBLE LABEL (WCAG 2.5.3) AND SAYS WHICH ROW, SINCE EVERY OBJECT ROW HAS ONE
    buttonElement.setAttribute('aria-label', RECIPE_COCKPIT_OBJECT_REFRESH_LABEL + ' for ' + object.objectApiName + (object.nickname ? ' · ' + object.nickname : ''));
    buttonElement.setAttribute('title', 'Retrieve ' + object.objectApiName + '\'s fields, validation rules, record types and global value sets from an org, see what is new or changed, and apply only what you tick');
    buttonElement.addEventListener('click', function () {
        if (renderedSequence === null) { return; }
        objectRefreshOpenerElement = buttonElement;
        const openMessage: { command: 'openObjectRefresh'; treeKey: string; renderSequence: number; objectApiName: string; nickname?: string } = { command: 'openObjectRefresh', treeKey: treeKey, renderSequence: renderedSequence, objectApiName: object.objectApiName };
        if (object.nickname) { openMessage.nickname = object.nickname; }
        vscodeApi.postMessage(openMessage);
    });

    return buttonElement;

}

// ONE STEP OF THE DIALOG, AS THE HOST POSTED IT; A STATE FOR A MODEL NOT ON SCREEN, OR OUT OF SHAPE, IS NOT DRAWN
export function renderObjectRefreshState(hostMessage: IObjectRefreshStateMessage): void {

    if (typeof hostMessage.refreshId !== 'string' || !hostMessage.refreshId || hostMessage.renderSequence !== renderedSequence) { return; }
    if (typeof hostMessage.objectApiName !== 'string' || !Array.isArray(hostMessage.kinds)) { return; }

    if (hostMessage.step === 'closed' || hostMessage.step === 'confirming') {
        closeObjectRefreshDialog(hostMessage.step === 'closed');
        return;
    }

    const stepBuilders: Record<ObjectRefreshStep, ObjectRefreshStepBuilder> = { choose: drawObjectRefreshChoose, retrieving: drawObjectRefreshProgress, applying: drawObjectRefreshProgress, review: drawObjectRefreshReview };
    if (typeof hostMessage.step !== 'string' || !Object.prototype.hasOwnProperty.call(stepBuilders, hostMessage.step)) { return; }
    // A CONFIRMATION ON SCREEN IS THE HOST'S QUESTION: THE DIALOG COMES BACK ONCE IT IS ANSWERED
    if (isConfirmDialogOpen()) { return; }

    const refreshState = hostMessage as IObjectRefreshState;

    closeObjectRefreshDialog(false);

    const overlayElement = createElement('div', 'confirmOverlay objectRefreshOverlay');
    const dialogElement = createElement('div', 'confirmDialog objectRefreshDialog');
    const objectLabel = refreshState.objectApiName + (typeof refreshState.nickname === 'string' && refreshState.nickname ? ' · ' + refreshState.nickname : '');
    const titleElement = createElement('h2', 'confirmTitle', RECIPE_COCKPIT_OBJECT_REFRESH_LABEL + ': ' + objectLabel);
    const bodyElement = createElement('div', 'confirmBody');
    const actionsElement = createElement('div', 'confirmActions');

    titleElement.setAttribute('id', 'objectRefreshTitle');
    bodyElement.setAttribute('tabindex', '0');
    dialogElement.setAttribute('role', 'dialog');
    dialogElement.setAttribute('aria-modal', 'true');
    dialogElement.setAttribute('aria-labelledby', 'objectRefreshTitle');

    const dialog: IObjectRefreshDialog = { refreshId: refreshState.refreshId, step: refreshState.step, overlayElement: overlayElement, orgView: null, focusableElements: [bodyElement], cancelElement: null, onCancel: null, firstFocusElement: null };
    objectRefreshDialog = dialog;

    stepBuilders[refreshState.step](refreshState, bodyElement, actionsElement);

    dialogElement.appendChild(titleElement);
    dialogElement.appendChild(bodyElement);
    dialogElement.appendChild(actionsElement);
    overlayElement.appendChild(dialogElement);

    dialogElement.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            if (objectRefreshDialog && objectRefreshDialog.onCancel && objectRefreshDialog.cancelElement && !objectRefreshDialog.cancelElement.disabled) { objectRefreshDialog.onCancel(); }
            return;
        }
        if (event.key !== 'Tab' || !objectRefreshDialog) { return; }
        const focusableElements = objectRefreshDialog.focusableElements.filter(function (element) { return !element.disabled; });
        const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
            : (currentIndex === -1 || currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        focusElement(focusableElements[nextIndex]);
    });

    overlayElement.addEventListener('mousedown', function (event) {
        if (event.target === overlayElement && typeof event.preventDefault === 'function') { event.preventDefault(); }
    });

    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.setAttribute('inert', ''); }
    });

    if (!isMotionReduced()) { dialogElement.classList.add('motionReveal'); }
    cockpitDialogHostElement.appendChild(overlayElement);

    focusElement(dialog.firstFocusElement || bodyElement);

}

function addObjectRefreshButton(actionsElement: HTMLElement, kind: 'primary' | 'secondary', className: string, label: string, onClick: () => void): HTMLButtonElement {
    const dialog = objectRefreshDialog as IObjectRefreshDialog;
    const buttonElement = createButton(kind, className, label);
    buttonElement.addEventListener('click', onClick);
    // THE CANCEL BUTTON'S OWN ACTION IS WHAT ESCAPE DOES
    if (className === 'objectRefreshCancel') { dialog.onCancel = onClick; }
    actionsElement.appendChild(buttonElement);
    dialog.focusableElements.push(buttonElement);
    return buttonElement;
}

function postObjectRefreshCancel(): void {
    if (!objectRefreshDialog) { return; }
    vscodeApi.postMessage({ command: 'cancelObjectRefresh', refreshId: objectRefreshDialog.refreshId });
}

// STEP 1: THE ORG, THROUGH THE COCKPIT'S OWN PICKER, AND THE KINDS TO COMPARE
function drawObjectRefreshChoose(hostMessage: IObjectRefreshState, bodyElement: HTMLElement, actionsElement: HTMLElement): void {

    const dialog = objectRefreshDialog as IObjectRefreshDialog;

    bodyElement.appendChild(createElement('div', 'confirmSummary', 'Choose the org to read ' + hostMessage.objectApiName + ' from, then what to compare with this project and the recipe. Nothing is written until you apply what you tick.'));

    const orgElement = createElement('div', 'objectRefreshOrg');
    // THE DIALOG ONLY CHOOSES AN ORG TO READ (#617): THE BUTTONS THAT ADD ONE START A RUN WITH A CONFIRMATION OF ITS OWN, AND STAY IN TARGET ORG MANAGER
    const orgView = buildDataOrgView(false);
    orgElement.appendChild(orgView.element);
    bodyElement.appendChild(orgElement);
    dialog.orgView = orgView;
    [orgView.loadElement, orgView.orgSelect.triggerElement, orgView.openOrgElement, orgView.refreshElement].forEach(function (element) { dialog.focusableElements.push(element); });

    const tickedKinds: ObjectRefreshKind[] = OBJECT_REFRESH_KINDS.filter(function (kind) { return hostMessage.kinds.indexOf(kind) !== -1; });
    const kindsElement = createElement('div', 'objectRefreshKinds');
    kindsElement.setAttribute('role', 'group');
    kindsElement.setAttribute('aria-label', 'What to compare');

    let nextElement: HTMLButtonElement | null = null;
    const drawNext = function () { ( nextElement as HTMLButtonElement ).disabled = tickedKinds.length === 0; };

    OBJECT_REFRESH_KINDS.forEach(function (kind) {
        const rowElement = createElement('div', 'objectRefreshKind');
        const checkElement = createButton('check', 'objectRefreshKindCheck');
        const labelElement = createElement('span', 'objectRefreshKindLabel', OBJECT_REFRESH_KIND_LABELS[kind]);
        const drawCheck = function () {
            const isTicked = tickedKinds.indexOf(kind) !== -1;
            checkElement.setAttribute('aria-checked', isTicked ? 'true' : 'false');
            checkElement.textContent = isTicked ? '✓' : '';
        };
        const toggleKind = function () {
            const kindIndex = tickedKinds.indexOf(kind);
            if (kindIndex === -1) { tickedKinds.push(kind); } else { tickedKinds.splice(kindIndex, 1); }
            drawCheck();
            drawNext();
        };
        checkElement.setAttribute('role', 'checkbox');
        checkElement.setAttribute('aria-label', OBJECT_REFRESH_KIND_LABELS[kind]);
        checkElement.addEventListener('click', toggleKind);
        labelElement.addEventListener('click', toggleKind);
        drawCheck();
        rowElement.appendChild(checkElement);
        rowElement.appendChild(labelElement);
        kindsElement.appendChild(rowElement);
        dialog.focusableElements.push(checkElement);
    });
    bodyElement.appendChild(kindsElement);

    const nextButtonElement = addObjectRefreshButton(actionsElement, 'primary', 'objectRefreshNext', 'Next', function () {
        if (!objectRefreshDialog || tickedKinds.length === 0) { return; }
        nextButtonElement.disabled = true;
        vscodeApi.postMessage({ command: 'startObjectRefresh', refreshId: objectRefreshDialog.refreshId, kinds: OBJECT_REFRESH_KINDS.filter(function (kind) { return tickedKinds.indexOf(kind) !== -1; }) });
    });
    nextElement = nextButtonElement;
    drawNext();
    dialog.cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', 'Cancel', function () {
        postObjectRefreshCancel();
        closeObjectRefreshDialog(true);
    });
    dialog.firstFocusElement = nextButtonElement.disabled ? dialog.cancelElement : nextButtonElement;

}

// STEP 2, AND AN APPLY RUNNING: WHAT IS BEING DONE, AND -- ONLY WHILE RETRIEVING -- A CANCEL
function drawObjectRefreshProgress(hostMessage: IObjectRefreshState, bodyElement: HTMLElement, actionsElement: HTMLElement): void {

    const kindLabels = hostMessage.kinds.filter(function (kind): kind is ObjectRefreshKind { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(OBJECT_REFRESH_KIND_LABELS, kind); })
        .map(function (kind) { return OBJECT_REFRESH_KIND_LABELS[kind].toLowerCase(); });
    const orgText = typeof hostMessage.orgLabel === 'string' && hostMessage.orgLabel ? hostMessage.orgLabel : 'the org';
    const progressText = hostMessage.step === 'retrieving'
        ? 'Retrieving the ' + kindLabels.join(', ') + ' of ' + hostMessage.objectApiName + ' from ' + orgText + '…'
        : 'Copying the ticked files into the project and writing their recipe lines…';
    const progressElement = createElement('div', 'objectRefreshProgress', progressText);
    progressElement.setAttribute('role', 'status');
    bodyElement.appendChild(progressElement);

    if (hostMessage.step !== 'retrieving') { return; }

    const dialog = objectRefreshDialog as IObjectRefreshDialog;
    const cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', 'Cancel', function () {
        cancelElement.disabled = true;
        cancelElement.textContent = 'Cancelling…';
        postObjectRefreshCancel();
    });
    dialog.cancelElement = cancelElement;
    dialog.firstFocusElement = cancelElement;

}

/*
    STEP 3: one folded group per kind, its title counting what is new and changed; opened, a
    column table of its items, each with a box. An item's index is its place across every
    group's items, which is the only thing Apply posts.
*/
function drawObjectRefreshReview(hostMessage: IObjectRefreshState, bodyElement: HTMLElement, actionsElement: HTMLElement): void {

    const dialog = objectRefreshDialog as IObjectRefreshDialog;
    const groups: IObjectRefreshGroup[] = Array.isArray(hostMessage.groups) ? hostMessage.groups : [];
    const tickedIndexes: number[] = Array.isArray(hostMessage.tickedItemIndexes) ? hostMessage.tickedItemIndexes.slice() : [];
    const orgText = typeof hostMessage.orgLabel === 'string' && hostMessage.orgLabel ? hostMessage.orgLabel : 'the org';
    const itemCount = groups.reduce(function (count, group) { return count + (Array.isArray(group.items) ? group.items.length : 0); }, 0);
    let applyElement: HTMLButtonElement | null = null;
    const drawApply = function () { if (applyElement) { applyElement.disabled = tickedIndexes.length === 0; } };

    bodyElement.appendChild(createElement('div', 'confirmSummary', itemCount === 0
        ? hostMessage.objectApiName + ' in ' + orgText + ' holds nothing new or changed for what you chose.'
        : 'What ' + orgText + ' holds that is new or changed against this project. Tick what to apply: only those files are copied, and only their recipe lines are written.'));

    let nextItemIndex = 0;
    groups.forEach(function (group, groupIndex) {

        const items: IObjectRefreshItem[] = Array.isArray(group.items) ? group.items : [];
        const firstItemIndex = nextItemIndex;
        nextItemIndex += items.length;
        const newCount = items.filter(function (item) { return item.status === 'new'; }).length;
        const changedCount = items.length - newCount;
        const titleParts = [String(group.label)];
        if (newCount > 0) { titleParts.push(newCount + ' new'); }
        if (changedCount > 0) { titleParts.push(changedCount + ' changed'); }
        if (items.length === 0) { titleParts.push('Up to date'); }

        const sectionElement = createElement('div', 'confirmSection objectRefreshGroup');
        const toggleElement = createButton('secondary', 'confirmSectionToggle objectRefreshGroupToggle');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
        const groupBodyElement = createElement('div', 'confirmSectionBody objectRefreshGroupBody hidden');
        const groupBodyId = 'objectRefreshGroup' + groupIndex;
        let isGroupExpanded = false;
        let isBuilt = false;

        glyphElement.setAttribute('class', 'toggleGlyph');
        glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        toggleElement.appendChild(glyphElement);
        toggleElement.appendChild(createElement('span', 'confirmSectionTitle', titleParts.join(' · ')));
        toggleElement.appendChild(createElement('span', 'confirmSectionCount', String(items.length)));
        groupBodyElement.setAttribute('id', groupBodyId);
        toggleElement.setAttribute('aria-controls', groupBodyId);
        drawToggle(toggleElement, false, false);

        const buildGroupBody = function () {

            const notes: string[] = [];
            const unchangedCount = group.unchangedCount as number;
            const unreadableCount = group.unreadableCount as number;
            if (unchangedCount > 0) { notes.push(unchangedCount + ' the same as the project.'); }
            if (unreadableCount > 0) { notes.push(unreadableCount + ' could not be read, so ' + (unreadableCount === 1 ? 'it was' : 'they were') + ' not compared.'); }
            notes.forEach(function (note) { groupBodyElement.appendChild(createElement('div', 'objectRefreshGroupNote muted', note)); });
            if (items.length === 0) { return; }

            const rowChecks: Array<() => void> = [];
            const groupActionsElement = createElement('div', 'objectRefreshGroupActions');
            const setGroupTicked = function (isTicked: boolean) {
                items.forEach(function (_item, itemOffset) {
                    const itemIndex = firstItemIndex + itemOffset;
                    const tickedAt = tickedIndexes.indexOf(itemIndex);
                    if (isTicked && tickedAt === -1) { tickedIndexes.push(itemIndex); }
                    if (!isTicked && tickedAt !== -1) { tickedIndexes.splice(tickedAt, 1); }
                });
                rowChecks.forEach(function (drawRowCheck) { drawRowCheck(); });
                drawApply();
            };
            const selectAllElement = createButton('link', 'objectRefreshSelectAll', 'Select all');
            const selectNoneElement = createButton('link', 'objectRefreshSelectNone', 'Select none');
            selectAllElement.addEventListener('click', function () { setGroupTicked(true); });
            selectNoneElement.addEventListener('click', function () { setGroupTicked(false); });
            groupActionsElement.appendChild(selectAllElement);
            groupActionsElement.appendChild(selectNoneElement);
            groupBodyElement.appendChild(groupActionsElement);
            dialog.focusableElements.push(selectAllElement, selectNoneElement);

            const rowTable = buildRowTable({
                className: 'objectRefreshTable',
                columnClassName: 'objectRefresh',
                columns: [{ key: 'apply', label: 'Apply' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'detail', label: 'Type' }, { key: 'differences', label: 'What changed' }, { key: 'recipe', label: 'Recipe' }]
            });

            items.forEach(function (item, itemOffset) {
                const itemIndex = firstItemIndex + itemOffset;
                const rowElement = createElement('tr', 'objectRefreshItem');
                const checkCellElement = createElement('td', 'objectRefreshItemApply');
                const checkElement = createButton('check', 'objectRefreshItemCheck');
                const statusCellElement = createElement('td', 'objectRefreshItemStatus');
                const differencesCellElement = createElement('td', 'objectRefreshItemDifferences');
                const drawRowCheck = function () {
                    const isTicked = tickedIndexes.indexOf(itemIndex) !== -1;
                    checkElement.setAttribute('aria-checked', isTicked ? 'true' : 'false');
                    checkElement.textContent = isTicked ? '✓' : '';
                };
                checkElement.setAttribute('role', 'checkbox');
                checkElement.setAttribute('aria-label', 'Apply ' + String(item.name));
                checkElement.addEventListener('click', function () {
                    const tickedAt = tickedIndexes.indexOf(itemIndex);
                    if (tickedAt === -1) { tickedIndexes.push(itemIndex); } else { tickedIndexes.splice(tickedAt, 1); }
                    drawRowCheck();
                    drawApply();
                });
                drawRowCheck();
                rowChecks.push(drawRowCheck);
                dialog.focusableElements.push(checkElement);

                checkCellElement.appendChild(checkElement);
                statusCellElement.appendChild(createElement('span', 'objectRefreshStatus', String(item.status)));
                (Array.isArray(item.differences) ? item.differences : []).forEach(function (difference: unknown) {
                    differencesCellElement.appendChild(createElement('span', 'objectRefreshDifference', String(difference)));
                });
                rowElement.appendChild(checkCellElement);
                rowElement.appendChild(createElement('td', 'objectRefreshItemName', String(item.name)));
                rowElement.appendChild(statusCellElement);
                rowElement.appendChild(createElement('td', 'objectRefreshItemDetail', String(item.detail)));
                rowElement.appendChild(differencesCellElement);
                rowElement.appendChild(createElement('td', 'objectRefreshItemRecipe', String(item.recipeNote)));
                rowTable.bodyElement.appendChild(rowElement);
            });

            groupBodyElement.appendChild(rowTable.wrapElement);

        };

        const setGroupExpanded = function (isExpanded: boolean, isAnimated: boolean) {
            isGroupExpanded = isExpanded;
            if (isGroupExpanded && !isBuilt) {
                buildGroupBody();
                isBuilt = true;
            }
            drawToggle(toggleElement, isGroupExpanded, isAnimated);
            setShownWithMotion(groupBodyElement, isGroupExpanded, isAnimated);
        };
        toggleElement.addEventListener('click', function () { setGroupExpanded(!isGroupExpanded, !isMotionReduced()); });

        sectionElement.appendChild(toggleElement);
        sectionElement.appendChild(groupBodyElement);
        bodyElement.appendChild(sectionElement);
        dialog.focusableElements.push(toggleElement);

        // A GROUP HOLDING A TICKED ITEM OPENS, SO WHAT IS TICKED IS IN SIGHT AFTER A CANCELLED CONFIRMATION
        if (tickedIndexes.some(function (itemIndex) { return itemIndex >= firstItemIndex && itemIndex < firstItemIndex + items.length; })) {
            setGroupExpanded(true, false);
        }

    });

    if (itemCount > 0) {
        const applyButtonElement = addObjectRefreshButton(actionsElement, 'primary', 'objectRefreshApply', 'Apply', function () {
            if (!objectRefreshDialog || tickedIndexes.length === 0) { return; }
            applyButtonElement.disabled = true;
            vscodeApi.postMessage({ command: 'applyObjectRefresh', refreshId: objectRefreshDialog.refreshId, itemIndexes: tickedIndexes.slice().sort(function (first, second) { return first - second; }) });
        });
        applyElement = applyButtonElement;
        drawApply();
    }
    dialog.cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', itemCount > 0 ? 'Cancel' : 'Close', function () {
        postObjectRefreshCancel();
        closeObjectRefreshDialog(true);
    });
    dialog.firstFocusElement = dialog.focusableElements.find(function (element) { return element.className.indexOf('objectRefreshGroupToggle') !== -1; }) || dialog.cancelElement;

}

// CLOSING DROPS THE DIALOG'S ORG PICKER FROM THE PICKERS THE COCKPIT REDRAWS, AND GIVES THE COCKPIT BACK
export function closeObjectRefreshDialog(isFocusReturned: boolean): void {

    if (!objectRefreshDialog) { return; }

    const orgView = objectRefreshDialog.orgView;
    if (orgView) { dataOrgPicker.dataOrgViews = dataOrgPicker.dataOrgViews.filter(function (dataOrgView) { return dataOrgView !== orgView; }); }
    cockpitDialogHostElement.textContent = '';
    objectRefreshDialog = null;

    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
    });

    if (isFocusReturned && objectRefreshOpenerElement && !objectRefreshOpenerElement.disabled) { focusElement(objectRefreshOpenerElement); }
    if (isFocusReturned) { objectRefreshOpenerElement = null; }

}
