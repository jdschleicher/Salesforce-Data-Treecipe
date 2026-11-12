import { COCKPIT_CONFIRM_CHANGE_ORG_LABEL, COCKPIT_CONFIRM_WARNINGS_LABEL, ICockpitConfirmRecordTypeSetMode } from '../CockpitConfirmLabels';

/*
    The panel half of the in-panel confirmation every cockpit asks with (#349, #402, #457, #480,
    #623), checked by tsc and ESLint and bundled into the cockpit's script at build time (#637).
    The HOST keeps the decision: it posts a request under a random id, this draws it with
    textContent only and answers with the INDEX of a button it was given, and the host's
    CockpitConfirmDialog.readAnswer turns that back into a label or Cancel.

    The bundle is inlined inside the cockpit script's outer function, so the names below are the
    cockpit's own locals, read when a request is drawn. Each one is in
    COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES, which a test holds to this list.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare function createElement(tagName: string, className?: string, textContent?: string): HTMLElement;
declare function createButton(kind: string, className: string, textContent?: string, size?: string): HTMLButtonElement;
declare function focusElement(element: Element | null): void;
declare function isMotionReduced(): boolean;
declare function drawToggle(toggleElement: HTMLElement, isExpanded: boolean, isAnimated: boolean): void;
declare function setShownWithMotion(element: HTMLElement, isShown: boolean, isAnimated: boolean): void;
declare const SVG_NAMESPACE: string;
declare const TREE_GLYPH_VIEW_BOX: string;
declare const TOGGLE_COLLAPSED_GLYPH_PATH: string;
declare const cockpitDialogHostElement: HTMLElement;
declare const cockpitBodyElement: HTMLElement | null;
declare const cockpitMetaElement: HTMLElement | null;
declare const loadStatusElement: HTMLElement | null;

// THE ONE CONFIRMATION ON SCREEN, OR null: DECLARED BY THE KIT'S STATE SCRIPT, BECAUSE THE OBJECT REFRESH DIALOG READS IT TOO
declare let confirmDialog: ICockpitConfirmDialogState | null;

export interface ICockpitConfirmDialogState {
    confirmationId: string;
    overlayElement: HTMLElement;
    openerElement: Element | null;
    checkState: { isChecked: boolean } | null;
    modeState: { chosenName: string | null } | null;
}

// WHAT THE HOST POSTS: EVERY FIELD IS READ AS unknown AND CHECKED BEFORE IT IS DRAWN
export interface ICockpitConfirmRequestMessage {
    confirmationId?: unknown;
    renderSequence?: unknown;
    title?: unknown;
    buttons?: unknown;
    isDestructive?: unknown;
    canChangeOrg?: unknown;
    checkboxLabel?: unknown;
    recordTypeSetModes?: unknown;
    recordTypeSetModeLegend?: unknown;
    summary?: unknown;
    warnings?: unknown;
    sections?: unknown;
    badge?: unknown;
    org?: unknown;
}

interface IConfirmSection {
    title: string;
    lines: string[];
    count?: number;
}

interface IConfirmContent {
    summary: string[];
    org: { alias: string; username: string } | null;
    badge: string;
    warnings: string[];
    sections: IConfirmSection[];
}

interface IConfirmResponse {
    command: 'confirmResponse';
    confirmationId: string;
    choice: number | null;
    isChecked?: boolean;
    recordTypeSetMode?: string | null;
    changeOrg?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(function (item) { return typeof item === 'string'; });
}

/*
    A confirmation the HOST asked for (#349), drawn over the cockpit in place of VS Code's modal.
    Every string is the host's and goes through textContent; the panel answers only with the
    index of a button it was given (null is Cancel), under the id it was asked with. A request
    for a model that is not the one on screen is answered Cancel without being drawn. Focus moves
    into the dialog and stays there, Escape is Cancel, and focus goes back to what opened it.
*/
export function renderConfirmRequest(hostMessage: ICockpitConfirmRequestMessage): void {

    const confirmationId = hostMessage.confirmationId;
    if (typeof confirmationId !== 'string' || !confirmationId) { return; }

    const content = readConfirmContent(hostMessage);
    const buttonLabels = Array.isArray(hostMessage.buttons) ? (hostMessage.buttons as unknown[]).filter(function (label: unknown): label is string { return typeof label === 'string' && !!label; }) : null;

    if (hostMessage.renderSequence !== renderedSequence || typeof hostMessage.title !== 'string' || !content || !buttonLabels || buttonLabels.length === 0) {
        vscodeApi.postMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: null });
        return;
    }

    // THE HOST ANSWERED AN OPEN ONE CANCEL BEFORE ASKING AGAIN; THE NEW ONE TAKES ITS PLACE
    const openerElement = confirmDialog ? confirmDialog.openerElement : document.activeElement;
    closeConfirmDialog(false);

    const isDestructive = hostMessage.isDestructive === true;
    const overlayElement = createElement('div', 'confirmOverlay');
    const dialogElement = createElement('div', 'confirmDialog');
    const titleElement = createElement('h2', 'confirmTitle', hostMessage.title);
    const bodyElement = createElement('div', 'confirmBody');
    const actionsElement = createElement('div', 'confirmActions');

    titleElement.setAttribute('id', 'confirmTitle');
    bodyElement.setAttribute('id', 'confirmBody');
    // THE BODY SCROLLS, SO A KEYBOARD READER CAN REACH IT TO SCROLL IT
    bodyElement.setAttribute('tabindex', '0');
    dialogElement.setAttribute('role', isDestructive ? 'alertdialog' : 'dialog');
    dialogElement.setAttribute('aria-modal', 'true');
    dialogElement.setAttribute('aria-labelledby', 'confirmTitle');
    dialogElement.setAttribute('aria-describedby', 'confirmBody');

    const sectionToggleElements = drawConfirmContent(bodyElement, content, hostMessage.canChangeOrg === true);

    const buttonElements = buttonLabels.map(function (label, labelIndex) {
        const buttonElement = createButton(labelIndex === 0 ? 'primary' : 'secondary', 'confirmChoice', label);
        buttonElement.addEventListener('click', function () { answerConfirm(labelIndex); });
        return buttonElement;
    });
    const cancelElement = createButton('secondary', 'confirmCancel', 'Cancel');
    cancelElement.addEventListener('click', function () { answerConfirm(null); });

    // ONE UNTICKED BOX WHEN THE HOST ASKS FOR IT (#402); ITS STATE GOES BACK WITH THE ANSWER, AND WHAT IT ADDS IS THE HOST'S
    const checkboxLabel = typeof hostMessage.checkboxLabel === 'string' && hostMessage.checkboxLabel ? hostMessage.checkboxLabel : null;
    let checkElement: HTMLButtonElement | null = null;
    let checkRowElement: HTMLElement | null = null;
    const checkState = { isChecked: false };
    if (checkboxLabel) {
        const drawnCheckElement = createButton('check', 'confirmCheck');
        checkRowElement = createElement('div', 'confirmCheckRow');
        const checkLabelElement = createElement('span', 'confirmCheckLabel', checkboxLabel);
        const toggleCheck = function () {
            checkState.isChecked = !checkState.isChecked;
            drawnCheckElement.setAttribute('aria-checked', checkState.isChecked ? 'true' : 'false');
            drawnCheckElement.textContent = checkState.isChecked ? '✓' : '';
        };
        drawnCheckElement.setAttribute('role', 'checkbox');
        drawnCheckElement.setAttribute('aria-checked', 'false');
        drawnCheckElement.setAttribute('aria-label', checkboxLabel);
        drawnCheckElement.addEventListener('click', toggleCheck);
        checkLabelElement.addEventListener('click', toggleCheck);
        checkRowElement.appendChild(drawnCheckElement);
        checkRowElement.appendChild(checkLabelElement);
        checkElement = drawnCheckElement;
    }

    // THE RECORD TYPE SET MODES THE HOST OFFERS (#623), ONE RADIO EACH, THE FIRST CHOSEN; THE ANSWER NAMES THE ONE CHOSEN
    const offeredModes = readConfirmRecordTypeSetModes(hostMessage);
    const modeState = { chosenName: offeredModes.length > 0 ? offeredModes[0].name : null };
    let modeGroupElement: HTMLElement | null = null;
    const modeRadioElements: HTMLButtonElement[] = [];
    if (offeredModes.length > 0) {
        const drawnModeGroupElement = createElement('div', 'confirmModeGroup');
        const modeLegend = typeof hostMessage.recordTypeSetModeLegend === 'string' ? hostMessage.recordTypeSetModeLegend : '';
        drawnModeGroupElement.setAttribute('role', 'radiogroup');
        drawnModeGroupElement.setAttribute('aria-label', modeLegend);
        if (modeLegend) { drawnModeGroupElement.appendChild(createElement('div', 'confirmModeLegend', modeLegend)); }
        const drawModes = function () {
            modeRadioElements.forEach(function (radioElement, modeIndex) {
                const isChosen = offeredModes[modeIndex].name === modeState.chosenName;
                radioElement.setAttribute('aria-checked', isChosen ? 'true' : 'false');
                radioElement.textContent = isChosen ? '●' : '';
            });
        };
        offeredModes.forEach(function (offeredMode) {
            const modeRowElement = createElement('div', 'confirmModeRow');
            const radioElement = createButton('check', 'confirmModeRadio');
            const modeLabelElement = createElement('span', 'confirmModeLabel', offeredMode.label);
            const chooseMode = function () { modeState.chosenName = offeredMode.name; drawModes(); };
            radioElement.setAttribute('role', 'radio');
            radioElement.setAttribute('aria-label', offeredMode.label);
            radioElement.addEventListener('click', chooseMode);
            modeLabelElement.addEventListener('click', chooseMode);
            modeRowElement.appendChild(radioElement);
            modeRowElement.appendChild(modeLabelElement);
            drawnModeGroupElement.appendChild(modeRowElement);
            modeRadioElements.push(radioElement);
        });
        drawModes();
        modeGroupElement = drawnModeGroupElement;
    }

    buttonElements.forEach(function (buttonElement) { actionsElement.appendChild(buttonElement); });
    actionsElement.appendChild(cancelElement);

    dialogElement.appendChild(titleElement);
    dialogElement.appendChild(bodyElement);
    if (modeGroupElement) { dialogElement.appendChild(modeGroupElement); }
    if (checkRowElement) { dialogElement.appendChild(checkRowElement); }
    dialogElement.appendChild(actionsElement);
    overlayElement.appendChild(dialogElement);

    const focusableElements: Element[] = ([bodyElement] as Element[]).concat(sectionToggleElements, modeRadioElements, checkElement ? [checkElement] : [], buttonElements, [cancelElement]);

    dialogElement.addEventListener('keydown', function (event: KeyboardEvent) {
        if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            answerConfirm(null);
            return;
        }
        if (event.key !== 'Tab') { return; }
        const currentIndex = document.activeElement ? focusableElements.indexOf(document.activeElement) : -1;
        const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
            : (currentIndex === -1 || currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        focusElement(focusableElements[nextIndex]);
    });

    // A PRESS ON THE BACKDROP WOULD MOVE FOCUS OUT OF THE DIALOG, WHERE TAB IS NO LONGER KEPT INSIDE IT
    overlayElement.addEventListener('mousedown', function (event: MouseEvent) {
        if (event.target === overlayElement && typeof event.preventDefault === 'function') { event.preventDefault(); }
    });

    // THE REST OF THE COCKPIT IS OUT OF REACH WHILE THE DIALOG IS OPEN
    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.setAttribute('inert', ''); }
    });

    if (!isMotionReduced()) { dialogElement.classList.add('motionReveal'); }
    cockpitDialogHostElement.appendChild(overlayElement);

    confirmDialog = { confirmationId: confirmationId, overlayElement: overlayElement, openerElement: openerElement, checkState: checkElement ? checkState : null, modeState: modeGroupElement ? modeState : null };

    // AN ACTION WITH NO UNDO STARTS ON CANCEL
    focusElement(isDestructive ? cancelElement : buttonElements[0]);

}

// THE MODES OF A REQUEST (#623): EACH A NAME AND A LABEL, BOTH STRINGS WITH TEXT; ANYTHING ELSE IS NO MODES AT ALL
function readConfirmRecordTypeSetModes(hostMessage: ICockpitConfirmRequestMessage): ICockpitConfirmRecordTypeSetMode[] {

    const postedModes = hostMessage.recordTypeSetModes;
    const isReadableMode = function (mode: unknown): mode is ICockpitConfirmRecordTypeSetMode {
        return isRecord(mode) && typeof mode.name === 'string' && !!mode.name && typeof mode.label === 'string' && !!mode.label;
    };

    return Array.isArray(postedModes) && (postedModes as unknown[]).every(isReadableMode)
        ? (postedModes as ICockpitConfirmRecordTypeSetMode[]).map(function (mode) { return { name: mode.name, label: mode.label }; })
        : [];

}

/*
    The parts of a confirmation (#457), read whole or not at all: a summary of strings, warnings
    of strings, and sections each with a title, lines and an optional count. Anything out of shape
    is null, and the request is answered Cancel rather than drawn with a part missing.
*/
function readConfirmContent(hostMessage: ICockpitConfirmRequestMessage): IConfirmContent | null {

    const summary = hostMessage.summary;
    const warnings = hostMessage.warnings;
    const sections = hostMessage.sections;

    if (!isStringList(summary) || !isStringList(warnings) || !Array.isArray(sections)) { return null; }
    const postedSections: unknown[] = sections;
    if (hostMessage.badge !== undefined && typeof hostMessage.badge !== 'string') { return null; }
    const org = hostMessage.org;
    if (org !== undefined && !(isRecord(org) && typeof org.username === 'string' && !!org.username && (org.alias === undefined || typeof org.alias === 'string'))) { return null; }

    const isReadableSection = function (section: unknown): section is IConfirmSection {
        return isRecord(section) && typeof section.title === 'string' && !!section.title && isStringList(section.lines)
            && (section.count === undefined || (typeof section.count === 'number' && Number.isSafeInteger(section.count) && section.count >= 0));
    };
    if (!postedSections.every(isReadableSection)) { return null; }

    const readableOrg = isRecord(org) ? org as { alias?: string; username: string } : null;

    return {
        summary: summary,
        org: readableOrg ? { alias: readableOrg.alias || '', username: readableOrg.username } : null,
        badge: typeof hostMessage.badge === 'string' ? hostMessage.badge : '',
        warnings: warnings.filter(function (warning) { return warning.trim() !== ''; }),
        sections: (postedSections as IConfirmSection[]).filter(function (section) { return section.lines.some(function (line) { return line.trim() !== ''; }); })
    };

}

/*
    Each statement is its own bullet (#457), so separate thoughts never run together: a blank line
    starts a new group, a line that ends with ":" leads in the indented lines under it as a nested
    list, and any other indented line is a bullet of its own. A part with one statement and no
    bullets asked for is drawn as plain text.
*/
function drawConfirmLines(parentElement: HTMLElement, lines: string[], isBulleted: boolean): void {

    const groups: string[][] = [[]];
    lines.forEach(function (line) {
        if (line.trim() === '') {
            if (groups[groups.length - 1].length > 0) { groups.push([]); }
            return;
        }
        groups[groups.length - 1].push(line);
    });

    groups.filter(function (group) { return group.length > 0; }).forEach(function (group, groupIndex) {

        if (groupIndex > 0) { parentElement.appendChild(createElement('div', 'confirmGap')); }

        if (!isBulleted) {
            group.forEach(function (line) { parentElement.appendChild(createElement('div', 'confirmLine', line)); });
            return;
        }

        const listElement = createElement('ul', 'confirmBullets');
        let leadInItem: HTMLElement | null = null;
        let leadInList: HTMLElement | null = null;

        group.forEach(function (line) {
            const isIndented = /^\s/.test(line);
            // AN INDENTED LINE LOSES ONLY ITS TWO-SPACE STEP, SO A RECIPE LINE KEEPS ITS OWN INDENTATION; A WRITTEN "- " MARKER GIVES WAY TO THE BULLET
            const text = isIndented ? line.replace(/^ {1,2}/, '').trimEnd() : line.trim().replace(/^[-•]\s+/, '');
            if (isIndented && leadInItem) {
                // THE NESTED LIST IS MADE WITH ITS FIRST ITEM, SO A LEAD-IN WITH NOTHING UNDER IT KEEPS NO EMPTY LIST
                if (!leadInList) {
                    leadInList = createElement('ul', 'confirmBullets confirmSubBullets');
                    leadInItem.appendChild(leadInList);
                }
                leadInList.appendChild(createElement('li', 'confirmLine confirmBullet confirmSubBullet', text));
                return;
            }
            const itemElement = createElement('li', 'confirmLine confirmBullet', text);
            listElement.appendChild(itemElement);
            leadInItem = !isIndented && /:$/.test(text) ? itemElement : null;
            leadInList = null;
        });

        parentElement.appendChild(listElement);

    });

}

function countConfirmStatements(lines: string[]): number {
    return lines.filter(function (line) { return line.trim() !== '' && !/^\s/.test(line); }).length;
}

/*
    Summary first; then the org (#480), its alias and username each in their own style so neither
    reads as part of the sentence around it, with the org type's badge and, when the host offered
    it, "Change org…"; then the warnings in one callout that is always on screen; then each
    section folded under a toggle that names it and its count. A section's lines are built the
    first time it opens, since a long one (every component of a deploy) costs nothing until the
    reader asks for it. Returns the org's button and the toggles, in order, for the Tab cycle.
*/
function drawConfirmContent(bodyElement: HTMLElement, content: IConfirmContent, canChangeOrg: boolean): HTMLButtonElement[] {

    const summaryElement = createElement('div', 'confirmSummary');
    drawConfirmLines(summaryElement, content.summary, countConfirmStatements(content.summary) > 1);
    bodyElement.appendChild(summaryElement);

    let changeOrgElement: HTMLButtonElement | null = null;

    if (content.org) {
        const orgElement = createElement('div', 'confirmOrg');
        orgElement.appendChild(createElement('span', 'confirmOrgLabel', 'Org'));
        if (content.org.alias) {
            orgElement.appendChild(createElement('span', 'confirmOrgAlias', content.org.alias));
            const separatorElement = createElement('span', 'confirmOrgSeparator', '·');
            separatorElement.setAttribute('aria-hidden', 'true');
            orgElement.appendChild(separatorElement);
        }
        orgElement.appendChild(createElement('span', 'confirmOrgUsername', content.org.username));
        if (content.badge) { orgElement.appendChild(createElement('span', 'confirmBadge', content.badge)); }
        if (canChangeOrg) {
            changeOrgElement = createButton('secondary', 'confirmChangeOrg', COCKPIT_CONFIRM_CHANGE_ORG_LABEL, 'compact');
            changeOrgElement.addEventListener('click', function () { answerConfirmChangeOrg(); });
            orgElement.appendChild(changeOrgElement);
        }
        bodyElement.appendChild(orgElement);
    } else if (content.badge) {
        summaryElement.appendChild(createElement('span', 'confirmBadge', content.badge));
    }

    if (content.warnings.length > 0) {
        const warningsElement = createElement('div', 'confirmWarnings');
        warningsElement.setAttribute('role', 'note');
        warningsElement.setAttribute('aria-label', COCKPIT_CONFIRM_WARNINGS_LABEL);
        warningsElement.appendChild(createElement('div', 'confirmWarningsHeading', COCKPIT_CONFIRM_WARNINGS_LABEL));
        drawConfirmLines(warningsElement, content.warnings, true);
        bodyElement.appendChild(warningsElement);
    }

    const sectionToggleElements = content.sections.map(function (section, sectionIndex) {

        const sectionElement = createElement('div', 'confirmSection');
        const toggleElement = createButton('secondary', 'confirmSectionToggle');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
        const sectionBodyElement = createElement('div', 'confirmSectionBody hidden');
        const sectionBodyId = 'confirmSection' + sectionIndex;
        let isBuilt = false;
        let isSectionExpanded = false;

        glyphElement.setAttribute('class', 'toggleGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', TOGGLE_COLLAPSED_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        toggleElement.appendChild(glyphElement);
        toggleElement.appendChild(createElement('span', 'confirmSectionTitle', section.title));
        if (section.count !== undefined) { toggleElement.appendChild(createElement('span', 'confirmSectionCount', String(section.count))); }

        sectionBodyElement.setAttribute('id', sectionBodyId);
        toggleElement.setAttribute('aria-controls', sectionBodyId);
        drawToggle(toggleElement, false, false);

        toggleElement.addEventListener('click', function () {
            isSectionExpanded = !isSectionExpanded;
            if (isSectionExpanded && !isBuilt) {
                drawConfirmLines(sectionBodyElement, section.lines, true);
                isBuilt = true;
            }
            drawToggle(toggleElement, isSectionExpanded, !isMotionReduced());
            setShownWithMotion(sectionBodyElement, isSectionExpanded, !isMotionReduced());
        });

        sectionElement.appendChild(toggleElement);
        sectionElement.appendChild(sectionBodyElement);
        bodyElement.appendChild(sectionElement);

        return toggleElement;

    });

    return (changeOrgElement ? [changeOrgElement] : []).concat(sectionToggleElements);

}

// "Change org…" (#480): NOT A BUTTON'S ANSWER -- THE HOST CANCELS THE ACTION, ASKS FOR THE ORG, AND STARTS THE ACTION AGAIN
function answerConfirmChangeOrg(): void {

    if (!confirmDialog) { return; }
    const response: IConfirmResponse = { command: 'confirmResponse', confirmationId: confirmDialog.confirmationId, choice: null, changeOrg: true };
    vscodeApi.postMessage(response);
    closeConfirmDialog(true);

}

function answerConfirm(choice: number | null): void {

    if (!confirmDialog) { return; }
    const response: IConfirmResponse = { command: 'confirmResponse', confirmationId: confirmDialog.confirmationId, choice: choice };
    if (confirmDialog.checkState) { response.isChecked = choice !== null && confirmDialog.checkState.isChecked; }
    if (confirmDialog.modeState && choice !== null) { response.recordTypeSetMode = confirmDialog.modeState.chosenName; }
    vscodeApi.postMessage(response);
    closeConfirmDialog(true);

}

// A DIALOG CLOSED WITHOUT AN ANSWER IS ONE THE HOST ALREADY ANSWERED CANCEL: A NEW MODEL, A FAILURE TO DRAW OR A NEWER REQUEST
export function closeConfirmDialog(isFocusReturned: boolean): void {

    if (!confirmDialog) { return; }

    const openerElement = confirmDialog.openerElement;
    cockpitDialogHostElement.textContent = '';
    confirmDialog = null;

    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
    });

    if (isFocusReturned && openerElement && !(openerElement as HTMLButtonElement).disabled) { focusElement(openerElement); }

}
