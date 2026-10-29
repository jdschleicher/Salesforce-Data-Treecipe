import * as crypto from 'crypto';

/*
    The in-panel confirmation every cockpit asks with (#349, #402, #457, #480; shared by #524). The
    HOST keeps the decision: it posts a request under a random id, the panel draws it with
    textContent only and answers with the INDEX of a button it was given, and readAnswer turns that
    back into a label or Cancel. Which panel is asked, whether it is visible and what an answer
    starts again stay with the cockpit that asks.
*/
export const COCKPIT_CONFIRM_WARNINGS_LABEL = 'Before you confirm';
export const COCKPIT_CONFIRM_CHANGE_ORG_LABEL = 'Change org…';

export interface ICockpitConfirmAnswer {
    chosenLabel: string | undefined;
    isChecked: boolean;
}

/*
    The names the dialog's panel script uses and does not declare (the kit's state and labels
    scripts declare confirmDialog and the two labels). A cockpit that includes the script declares
    each of these in the same scope: a name it misses throws while a request is drawn, before any
    answer is posted, and the host's confirmInPanel would wait on it. A test derives the list from
    every free identifier in the script, so a new one cannot be left off.
*/
export const COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT_REQUIRES: readonly string[] = Object.freeze([
    'vscodeApi', 'renderedSequence', 'createElement', 'createButton', 'focusElement', 'isMotionReduced',
    'drawToggle', 'setShownWithMotion', 'SVG_NAMESPACE', 'TREE_GLYPH_VIEW_BOX', 'TOGGLE_COLLAPSED_GLYPH_PATH',
    'cockpitDialogHostElement', 'cockpitBodyElement', 'cockpitMetaElement', 'loadStatusElement'
]);

/*
    The classes the dialog draws with that COCKPIT_KIT_CONFIRM_DIALOG_STYLES does not style: the
    section chevron and the reveal it names itself, and those its required helpers set (a folded
    section is hidden by setShownWithMotion, its chevron held still by drawToggle). A cockpit that
    includes the dialog styles these too, or a folded section draws open.
*/
export const COCKPIT_KIT_CONFIRM_DIALOG_STYLE_REQUIRES: readonly string[] = Object.freeze([
    'toggleGlyph', 'motionReveal', 'hidden', 'motionConceal', 'noMotion'
]);

export const COCKPIT_KIT_CONFIRM_DIALOG_STYLES = `    .confirmOverlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background-color: var(--sdt-dialog-backdrop);
    }
    .confirmDialog {
        display: flex;
        flex-direction: column;
        width: min(42rem, 100%);
        max-height: calc(100vh - 32px);
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    .confirmTitle { margin: 0; padding: 0.9rem 1rem 0.5rem 1rem; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
    .confirmBody {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 60vh;
        overflow-y: auto;
        padding: 0.25rem 1rem 0.75rem 1rem;
        border-top: 1px solid var(--sdt-border);
        border-bottom: 1px solid var(--sdt-border);
    }
    .confirmLine { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.15rem 0; }
    .confirmBullets { margin: 0.15rem 0; padding-left: 1.25rem; }
    .confirmBullets .confirmBullet { margin: 0.2rem 0; }
    .confirmBullet::marker { color: var(--sdt-muted); }
    .confirmSubBullets { margin: 0.1rem 0 0.25rem 0; list-style-type: circle; }
    .confirmWarnings .confirmBullet::marker { color: var(--sdt-changed); }
    .confirmGap { height: 0.6rem; }
    .confirmSummary { margin: 0.5rem 0; font-size: 1.02rem; }
    .confirmOrg { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.45rem; margin: 0.5rem 0; padding: 0.4rem 0.6rem; border: 1px solid var(--sdt-border); border-radius: 6px; }
    .confirmOrgLabel { color: var(--sdt-muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .confirmOrgAlias { font-weight: 700; color: var(--sdt-accent); overflow-wrap: anywhere; }
    .confirmOrgSeparator { color: var(--sdt-muted); }
    .confirmOrgUsername { font-family: var(--vscode-editor-font-family), monospace; color: var(--sdt-muted); overflow-wrap: anywhere; }
    .confirmOrg .confirmBadge { margin-top: 0; }
    .confirmChangeOrg { margin-left: auto; }
    .confirmBadge { display: inline-block; margin-top: 0.3rem; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .confirmWarnings { margin: 0.6rem 0; padding: 0.45rem 0.7rem; color: var(--sdt-text); background-color: var(--sdt-surface); border: 1px solid var(--sdt-border); border-left: 4px solid var(--sdt-changed); border-radius: 6px; }
    .confirmWarningsHeading { margin-bottom: 0.15rem; font-weight: 600; color: var(--sdt-changed); }
    .confirmSection { margin: 0.35rem 0; }
    .confirmSectionToggle { display: flex; align-items: center; gap: 0.4rem; width: 100%; padding: 0.35rem 0.5rem; text-align: left; line-height: 1.3; }
    .confirmSectionTitle { flex: 1 1 auto; font-weight: 600; overflow-wrap: anywhere; }
    .confirmSectionCount { flex: none; padding: 0 0.45rem; border-radius: 999px; font-size: 0.85rem; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .confirmSectionBody { padding: 0.2rem 0.5rem 0.2rem 2rem; }
    .confirmCheckRow { flex: none; display: flex; align-items: center; gap: 0.4rem; padding: 0.75rem 1rem 0 1rem; }
    .confirmCheckLabel { cursor: pointer; overflow-wrap: anywhere; }
    .confirmActions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; }`;

// MARKUP: A STATIC SIBLING AFTER THE BODY, SO THE SHELL BUILDER STILL TAKES ONLY A NONCE
export const COCKPIT_KIT_CONFIRM_DIALOG_HOST_MARKUP = `<div id="cockpitDialogHost"></div>`;

// PANEL SCRIPT, DECLARED WITH THE PANEL'S OTHER STATE
export const COCKPIT_KIT_CONFIRM_DIALOG_STATE_SCRIPT = `    // THE ONE IN-PANEL CONFIRMATION ON SCREEN (#349), OR null
    let confirmDialog = null;`;

// PANEL SCRIPT, DECLARED WITH THE PANEL'S OTHER CONSTANTS
export const COCKPIT_KIT_CONFIRM_LABELS_SCRIPT = `    const CONFIRM_WARNINGS_LABEL = ${JSON.stringify(COCKPIT_CONFIRM_WARNINGS_LABEL)};
    const CONFIRM_CHANGE_ORG_LABEL = ${JSON.stringify(COCKPIT_CONFIRM_CHANGE_ORG_LABEL)};`;

// PANEL SCRIPT: DRAWING, ANSWERING AND CLOSING THE DIALOG
export const COCKPIT_KIT_CONFIRM_DIALOG_SCRIPT = `    /*
        A confirmation the HOST asked for (#349), drawn over the cockpit in place of VS Code's modal.
        Every string is the host's and goes through textContent; the panel answers only with the
        index of a button it was given (null is Cancel), under the id it was asked with. A request
        for a model that is not the one on screen is answered Cancel without being drawn. Focus moves
        into the dialog and stays there, Escape is Cancel, and focus goes back to what opened it.
    */
    function renderConfirmRequest(hostMessage) {

        const confirmationId = hostMessage.confirmationId;
        if (typeof confirmationId !== 'string' || !confirmationId) { return; }

        const content = readConfirmContent(hostMessage);
        const buttonLabels = Array.isArray(hostMessage.buttons) ? hostMessage.buttons.filter(function (label) { return typeof label === 'string' && !!label; }) : null;

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
        let checkElement = null;
        let checkRowElement = null;
        const checkState = { isChecked: false };
        if (checkboxLabel) {
            checkRowElement = createElement('div', 'confirmCheckRow');
            checkElement = createButton('check', 'confirmCheck');
            const checkLabelElement = createElement('span', 'confirmCheckLabel', checkboxLabel);
            const toggleCheck = function () {
                checkState.isChecked = !checkState.isChecked;
                checkElement.setAttribute('aria-checked', checkState.isChecked ? 'true' : 'false');
                checkElement.textContent = checkState.isChecked ? '✓' : '';
            };
            checkElement.setAttribute('role', 'checkbox');
            checkElement.setAttribute('aria-checked', 'false');
            checkElement.setAttribute('aria-label', checkboxLabel);
            checkElement.addEventListener('click', toggleCheck);
            checkLabelElement.addEventListener('click', toggleCheck);
            checkRowElement.appendChild(checkElement);
            checkRowElement.appendChild(checkLabelElement);
        }

        buttonElements.forEach(function (buttonElement) { actionsElement.appendChild(buttonElement); });
        actionsElement.appendChild(cancelElement);

        dialogElement.appendChild(titleElement);
        dialogElement.appendChild(bodyElement);
        if (checkRowElement) { dialogElement.appendChild(checkRowElement); }
        dialogElement.appendChild(actionsElement);
        overlayElement.appendChild(dialogElement);

        const focusableElements = [bodyElement].concat(sectionToggleElements, checkElement ? [checkElement] : [], buttonElements, [cancelElement]);

        dialogElement.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (typeof event.preventDefault === 'function') { event.preventDefault(); }
                answerConfirm(null);
                return;
            }
            if (event.key !== 'Tab') { return; }
            const currentIndex = focusableElements.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
                : (currentIndex === -1 || currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            focusElement(focusableElements[nextIndex]);
        });

        // A PRESS ON THE BACKDROP WOULD MOVE FOCUS OUT OF THE DIALOG, WHERE TAB IS NO LONGER KEPT INSIDE IT
        overlayElement.addEventListener('mousedown', function (event) {
            if (event.target === overlayElement && typeof event.preventDefault === 'function') { event.preventDefault(); }
        });

        // THE REST OF THE COCKPIT IS OUT OF REACH WHILE THE DIALOG IS OPEN
        [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
            if (backgroundElement) { backgroundElement.setAttribute('inert', ''); }
        });

        if (!isMotionReduced()) { dialogElement.classList.add('motionReveal'); }
        cockpitDialogHostElement.appendChild(overlayElement);

        confirmDialog = { confirmationId: confirmationId, overlayElement: overlayElement, openerElement: openerElement, checkState: checkElement ? checkState : null };

        // AN ACTION WITH NO UNDO STARTS ON CANCEL
        focusElement(isDestructive ? cancelElement : buttonElements[0]);

    }

    /*
        The parts of a confirmation (#457), read whole or not at all: a summary of strings, warnings
        of strings, and sections each with a title, lines and an optional count. Anything out of shape
        is null, and the request is answered Cancel rather than drawn with a part missing.
    */
    function readConfirmContent(hostMessage) {

        const isStringList = function (value) { return Array.isArray(value) && value.every(function (item) { return typeof item === 'string'; }); };

        if (!isStringList(hostMessage.summary) || !isStringList(hostMessage.warnings) || !Array.isArray(hostMessage.sections)) { return null; }
        if (hostMessage.badge !== undefined && typeof hostMessage.badge !== 'string') { return null; }
        const org = hostMessage.org;
        if (org !== undefined && !(org && typeof org === 'object' && typeof org.username === 'string' && !!org.username && (org.alias === undefined || typeof org.alias === 'string'))) { return null; }

        const isReadableSection = function (section) {
            return !!section && typeof section === 'object' && typeof section.title === 'string' && !!section.title && isStringList(section.lines)
                && (section.count === undefined || (typeof section.count === 'number' && Number.isSafeInteger(section.count) && section.count >= 0));
        };
        if (!hostMessage.sections.every(isReadableSection)) { return null; }

        return {
            summary: hostMessage.summary,
            org: org ? { alias: org.alias || '', username: org.username } : null,
            badge: hostMessage.badge || '',
            warnings: hostMessage.warnings.filter(function (warning) { return warning.trim() !== ''; }),
            sections: hostMessage.sections.filter(function (section) { return section.lines.some(function (line) { return line.trim() !== ''; }); })
        };

    }

    /*
        Each statement is its own bullet (#457), so separate thoughts never run together: a blank line
        starts a new group, a line that ends with ":" leads in the indented lines under it as a nested
        list, and any other indented line is a bullet of its own. A part with one statement and no
        bullets asked for is drawn as plain text.
    */
    function drawConfirmLines(parentElement, lines, isBulleted) {

        const groups = [[]];
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
            let leadInItem = null;
            let leadInList = null;

            group.forEach(function (line) {
                const isIndented = /^\\s/.test(line);
                // AN INDENTED LINE LOSES ONLY ITS TWO-SPACE STEP, SO A RECIPE LINE KEEPS ITS OWN INDENTATION; A WRITTEN "- " MARKER GIVES WAY TO THE BULLET
                const text = isIndented ? line.replace(/^ {1,2}/, '').trimEnd() : line.trim().replace(/^[-•]\\s+/, '');
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

    function countConfirmStatements(lines) {
        return lines.filter(function (line) { return line.trim() !== '' && !/^\\s/.test(line); }).length;
    }

    /*
        Summary first; then the org (#480), its alias and username each in their own style so neither
        reads as part of the sentence around it, with the org type's badge and, when the host offered
        it, "Change org…"; then the warnings in one callout that is always on screen; then each
        section folded under a toggle that names it and its count. A section's lines are built the
        first time it opens, since a long one (every component of a deploy) costs nothing until the
        reader asks for it. Returns the org's button and the toggles, in order, for the Tab cycle.
    */
    function drawConfirmContent(bodyElement, content, canChangeOrg) {

        const summaryElement = createElement('div', 'confirmSummary');
        drawConfirmLines(summaryElement, content.summary, countConfirmStatements(content.summary) > 1);
        bodyElement.appendChild(summaryElement);

        let changeOrgElement = null;

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
                changeOrgElement = createButton('secondary', 'confirmChangeOrg', CONFIRM_CHANGE_ORG_LABEL, 'compact');
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
            warningsElement.setAttribute('aria-label', CONFIRM_WARNINGS_LABEL);
            warningsElement.appendChild(createElement('div', 'confirmWarningsHeading', CONFIRM_WARNINGS_LABEL));
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
    function answerConfirmChangeOrg() {

        if (!confirmDialog) { return; }
        vscodeApi.postMessage({ command: 'confirmResponse', confirmationId: confirmDialog.confirmationId, choice: null, changeOrg: true });
        closeConfirmDialog(true);

    }

    function answerConfirm(choice) {

        if (!confirmDialog) { return; }
        const response = { command: 'confirmResponse', confirmationId: confirmDialog.confirmationId, choice: choice };
        if (confirmDialog.checkState) { response.isChecked = choice !== null && confirmDialog.checkState.isChecked; }
        vscodeApi.postMessage(response);
        closeConfirmDialog(true);

    }

    // A DIALOG CLOSED WITHOUT AN ANSWER IS ONE THE HOST ALREADY ANSWERED CANCEL: A NEW MODEL, A FAILURE TO DRAW OR A NEWER REQUEST
    function closeConfirmDialog(isFocusReturned) {

        if (!confirmDialog) { return; }

        const openerElement = confirmDialog.openerElement;
        cockpitDialogHostElement.textContent = '';
        confirmDialog = null;

        [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
            if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
        });

        if (isFocusReturned && openerElement && !openerElement.disabled) { focusElement(openerElement); }

    }`;

export class CockpitConfirmDialog {

    static buildConfirmationId(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    /*
        SPENT ONCE by the caller. An index the host did not offer is Cancel, and so is an isChecked
        that is neither absent nor a boolean; a box only counts when one was drawn.
    */
    static readAnswer(buttonLabels: readonly string[], hasCheckbox: boolean, choice: unknown, isChecked?: unknown): ICockpitConfirmAnswer {

        const isOfferedChoice = typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < buttonLabels.length;
        const isReadableCheck = isChecked === undefined || typeof isChecked === 'boolean';

        return isOfferedChoice && isReadableCheck
            ? { chosenLabel: buttonLabels[choice], isChecked: hasCheckbox && isChecked === true }
            : { chosenLabel: undefined, isChecked: false };

    }

}
