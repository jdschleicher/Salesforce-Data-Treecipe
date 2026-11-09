/*
    The panel half of "Get latest detail" (#612): the row's button and the
    dialog the host drives through objectRefreshState. Kept beside the service as the kit keeps its
    confirmation, so the 33,000-line service does not grow by it. The dialog draws over the cockpit
    with the confirmation's own overlay classes, writes every host string through textContent, and
    answers only with the dialog's id, kind names from the fixed list, and item indexes.

    It uses, from the panel script around it: vscodeApi, renderedSequence, createElement,
    createButton, focusElement, isMotionReduced, drawToggle, setShownWithMotion, SVG_NAMESPACE,
    TREE_GLYPH_VIEW_BOX, TOGGLE_COLLAPSED_GLYPH_PATH, OBJECT_REFRESH_GLYPH_PATH, cockpitDialogHostElement, cockpitBodyElement,
    cockpitMetaElement, loadStatusElement, buildDataOrgView, dataOrgViews, buildRowTable and
    confirmDialog. Imports nothing.
*/

export const RECIPE_COCKPIT_OBJECT_REFRESH_DIALOG_STYLES = `    .treeObjectRefresh { margin-left: auto; display: inline-flex; align-items: center; gap: 0.35rem; }
    .objectRefreshGlyph { width: 1rem; height: 1rem; flex: none; }
    .objectRefreshGlyph path { fill: none; stroke: var(--sdt-removed); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .objectRefreshOrg { margin: 0.5rem 0; }
    .objectRefreshKinds { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.5rem 0; }
    .objectRefreshKind { display: flex; align-items: center; gap: 0.45rem; }
    .objectRefreshKindLabel { cursor: pointer; }
    .objectRefreshProgress { margin: 0.75rem 0; }
    .objectRefreshGroupNote { margin: 0.2rem 0; }
    .objectRefreshGroupActions { display: flex; gap: 0.5rem; margin: 0.2rem 0 0.4rem 0; }
    .objectRefreshStatus { display: inline-block; padding: 0 0.45rem; border-radius: 999px; font-size: 0.85rem; color: var(--sdt-chip-text); background-color: var(--sdt-chip-bg); }
    .objectRefreshDifference { display: block; }`;

export const RECIPE_COCKPIT_OBJECT_REFRESH_DIALOG_STATE_SCRIPT = `    // THE ONE "Get latest object detail" DIALOG ON SCREEN (#612), OR null; ITS OPENER OUTLIVES A STEP ASIDE FOR THE CONFIRMATION
    let objectRefreshDialog = null;
    let objectRefreshOpenerElement = null;`;

export const RECIPE_COCKPIT_OBJECT_REFRESH_DIALOG_SCRIPT = `    /*
        The row's button (#612): only the occurrence it is on, by name and, for an object with
        iterations, its nickname. Everything after this is the host's to decide.
    */
    function buildObjectRefreshButton(treeKey, object) {

        const buttonElement = createButton('secondary', 'treeObjectRefresh', '', 'compact');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
        glyphElement.setAttribute('class', 'objectRefreshGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', OBJECT_REFRESH_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        buttonElement.appendChild(glyphElement);
        buttonElement.appendChild(createElement('span', 'objectRefreshButtonLabel', OBJECT_REFRESH_LABEL));
        // THE NAME STARTS WITH THE VISIBLE LABEL (WCAG 2.5.3) AND SAYS WHICH ROW, SINCE EVERY OBJECT ROW HAS ONE
        buttonElement.setAttribute('aria-label', OBJECT_REFRESH_LABEL + ' for ' + object.objectApiName + (object.nickname ? ' · ' + object.nickname : ''));
        buttonElement.setAttribute('title', 'Retrieve ' + object.objectApiName + '\\'s fields, validation rules, record types and global value sets from an org, see what is new or changed, and apply only what you tick');
        buttonElement.addEventListener('click', function () {
            if (renderedSequence === null) { return; }
            objectRefreshOpenerElement = buttonElement;
            const openMessage = { command: 'openObjectRefresh', treeKey: treeKey, renderSequence: renderedSequence, objectApiName: object.objectApiName };
            if (object.nickname) { openMessage.nickname = object.nickname; }
            vscodeApi.postMessage(openMessage);
        });

        return buttonElement;

    }

    // ONE STEP OF THE DIALOG, AS THE HOST POSTED IT; A STATE FOR A MODEL NOT ON SCREEN, OR OUT OF SHAPE, IS NOT DRAWN
    function renderObjectRefreshState(hostMessage) {

        if (typeof hostMessage.refreshId !== 'string' || !hostMessage.refreshId || hostMessage.renderSequence !== renderedSequence) { return; }
        if (typeof hostMessage.objectApiName !== 'string' || !Array.isArray(hostMessage.kinds)) { return; }

        if (hostMessage.step === 'closed' || hostMessage.step === 'confirming') {
            closeObjectRefreshDialog(hostMessage.step === 'closed');
            return;
        }

        const stepBuilders = { choose: drawObjectRefreshChoose, retrieving: drawObjectRefreshProgress, applying: drawObjectRefreshProgress, review: drawObjectRefreshReview };
        if (!Object.prototype.hasOwnProperty.call(stepBuilders, hostMessage.step)) { return; }
        // A CONFIRMATION ON SCREEN IS THE HOST'S QUESTION: THE DIALOG COMES BACK ONCE IT IS ANSWERED
        if (confirmDialog) { return; }

        closeObjectRefreshDialog(false);

        const overlayElement = createElement('div', 'confirmOverlay objectRefreshOverlay');
        const dialogElement = createElement('div', 'confirmDialog objectRefreshDialog');
        const objectLabel = hostMessage.objectApiName + (typeof hostMessage.nickname === 'string' && hostMessage.nickname ? ' · ' + hostMessage.nickname : '');
        const titleElement = createElement('h2', 'confirmTitle', OBJECT_REFRESH_LABEL + ': ' + objectLabel);
        const bodyElement = createElement('div', 'confirmBody');
        const actionsElement = createElement('div', 'confirmActions');

        titleElement.setAttribute('id', 'objectRefreshTitle');
        bodyElement.setAttribute('tabindex', '0');
        dialogElement.setAttribute('role', 'dialog');
        dialogElement.setAttribute('aria-modal', 'true');
        dialogElement.setAttribute('aria-labelledby', 'objectRefreshTitle');

        objectRefreshDialog = { refreshId: hostMessage.refreshId, step: hostMessage.step, overlayElement: overlayElement, orgView: null, focusableElements: [bodyElement], cancelElement: null, onCancel: null, firstFocusElement: null };

        stepBuilders[hostMessage.step](hostMessage, bodyElement, actionsElement);

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
            const currentIndex = focusableElements.indexOf(document.activeElement);
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

        focusElement(objectRefreshDialog.firstFocusElement || bodyElement);

    }

    function addObjectRefreshButton(actionsElement, kind, className, label, onClick) {
        const buttonElement = createButton(kind, className, label);
        buttonElement.addEventListener('click', onClick);
        // THE CANCEL BUTTON'S OWN ACTION IS WHAT ESCAPE DOES
        if (className === 'objectRefreshCancel') { objectRefreshDialog.onCancel = onClick; }
        actionsElement.appendChild(buttonElement);
        objectRefreshDialog.focusableElements.push(buttonElement);
        return buttonElement;
    }

    function postObjectRefreshCancel() {
        if (!objectRefreshDialog) { return; }
        vscodeApi.postMessage({ command: 'cancelObjectRefresh', refreshId: objectRefreshDialog.refreshId });
    }

    // STEP 1: THE ORG, THROUGH THE COCKPIT'S OWN PICKER, AND THE KINDS TO COMPARE
    function drawObjectRefreshChoose(hostMessage, bodyElement, actionsElement) {

        bodyElement.appendChild(createElement('div', 'confirmSummary', 'Choose the org to read ' + hostMessage.objectApiName + ' from, then what to compare with this project and the recipe. Nothing is written until you apply what you tick.'));

        const orgElement = createElement('div', 'objectRefreshOrg');
        const orgView = buildDataOrgView();
        orgElement.appendChild(orgView.element);
        bodyElement.appendChild(orgElement);
        objectRefreshDialog.orgView = orgView;
        [orgView.loadElement, orgView.selectElement, orgView.openOrgElement, orgView.refreshElement, orgView.newScratchElement].forEach(function (element) { objectRefreshDialog.focusableElements.push(element); });

        const tickedKinds = OBJECT_REFRESH_KINDS.filter(function (kind) { return hostMessage.kinds.indexOf(kind) !== -1; });
        const kindsElement = createElement('div', 'objectRefreshKinds');
        kindsElement.setAttribute('role', 'group');
        kindsElement.setAttribute('aria-label', 'What to compare');

        let nextElement = null;
        const drawNext = function () { nextElement.disabled = tickedKinds.length === 0; };

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
            objectRefreshDialog.focusableElements.push(checkElement);
        });
        bodyElement.appendChild(kindsElement);

        nextElement = addObjectRefreshButton(actionsElement, 'primary', 'objectRefreshNext', 'Next', function () {
            if (!objectRefreshDialog || tickedKinds.length === 0) { return; }
            nextElement.disabled = true;
            vscodeApi.postMessage({ command: 'startObjectRefresh', refreshId: objectRefreshDialog.refreshId, kinds: OBJECT_REFRESH_KINDS.filter(function (kind) { return tickedKinds.indexOf(kind) !== -1; }) });
        });
        drawNext();
        objectRefreshDialog.cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', 'Cancel', function () {
            postObjectRefreshCancel();
            closeObjectRefreshDialog(true);
        });
        objectRefreshDialog.firstFocusElement = nextElement.disabled ? objectRefreshDialog.cancelElement : nextElement;

    }

    // STEP 2, AND AN APPLY RUNNING: WHAT IS BEING DONE, AND -- ONLY WHILE RETRIEVING -- A CANCEL
    function drawObjectRefreshProgress(hostMessage, bodyElement, actionsElement) {

        const kindLabels = hostMessage.kinds.filter(function (kind) { return Object.prototype.hasOwnProperty.call(OBJECT_REFRESH_KIND_LABELS, kind); })
            .map(function (kind) { return OBJECT_REFRESH_KIND_LABELS[kind].toLowerCase(); });
        const orgText = typeof hostMessage.orgLabel === 'string' && hostMessage.orgLabel ? hostMessage.orgLabel : 'the org';
        const progressText = hostMessage.step === 'retrieving'
            ? 'Retrieving the ' + kindLabels.join(', ') + ' of ' + hostMessage.objectApiName + ' from ' + orgText + '…'
            : 'Copying the ticked files into the project and writing their recipe lines…';
        const progressElement = createElement('div', 'objectRefreshProgress', progressText);
        progressElement.setAttribute('role', 'status');
        bodyElement.appendChild(progressElement);

        if (hostMessage.step !== 'retrieving') { return; }

        const cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', 'Cancel', function () {
            cancelElement.disabled = true;
            cancelElement.textContent = 'Cancelling…';
            postObjectRefreshCancel();
        });
        objectRefreshDialog.cancelElement = cancelElement;
        objectRefreshDialog.firstFocusElement = cancelElement;

    }

    /*
        STEP 3: one folded group per kind, its title counting what is new and changed; opened, a
        column table of its items, each with a box. An item's index is its place across every
        group's items, which is the only thing Apply posts.
    */
    function drawObjectRefreshReview(hostMessage, bodyElement, actionsElement) {

        const groups = Array.isArray(hostMessage.groups) ? hostMessage.groups : [];
        const tickedIndexes = Array.isArray(hostMessage.tickedItemIndexes) ? hostMessage.tickedItemIndexes.slice() : [];
        const orgText = typeof hostMessage.orgLabel === 'string' && hostMessage.orgLabel ? hostMessage.orgLabel : 'the org';
        const itemCount = groups.reduce(function (count, group) { return count + (Array.isArray(group.items) ? group.items.length : 0); }, 0);
        let applyElement = null;
        const drawApply = function () { if (applyElement) { applyElement.disabled = tickedIndexes.length === 0; } };

        bodyElement.appendChild(createElement('div', 'confirmSummary', itemCount === 0
            ? hostMessage.objectApiName + ' in ' + orgText + ' holds nothing new or changed for what you chose.'
            : 'What ' + orgText + ' holds that is new or changed against this project. Tick what to apply: only those files are copied, and only their recipe lines are written.'));

        let nextItemIndex = 0;
        groups.forEach(function (group, groupIndex) {

            const items = Array.isArray(group.items) ? group.items : [];
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
            glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
            glyphElement.setAttribute('aria-hidden', 'true');
            glyphElement.setAttribute('focusable', 'false');
            pathElement.setAttribute('d', TOGGLE_COLLAPSED_GLYPH_PATH);
            glyphElement.appendChild(pathElement);
            toggleElement.appendChild(glyphElement);
            toggleElement.appendChild(createElement('span', 'confirmSectionTitle', titleParts.join(' · ')));
            toggleElement.appendChild(createElement('span', 'confirmSectionCount', String(items.length)));
            groupBodyElement.setAttribute('id', groupBodyId);
            toggleElement.setAttribute('aria-controls', groupBodyId);
            drawToggle(toggleElement, false, false);

            const buildGroupBody = function () {

                const notes = [];
                if (group.unchangedCount > 0) { notes.push(group.unchangedCount + ' the same as the project.'); }
                if (group.unreadableCount > 0) { notes.push(group.unreadableCount + ' could not be read, so ' + (group.unreadableCount === 1 ? 'it was' : 'they were') + ' not compared.'); }
                notes.forEach(function (note) { groupBodyElement.appendChild(createElement('div', 'objectRefreshGroupNote muted', note)); });
                if (items.length === 0) { return; }

                const rowChecks = [];
                const groupActionsElement = createElement('div', 'objectRefreshGroupActions');
                const setGroupTicked = function (isTicked) {
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
                objectRefreshDialog.focusableElements.push(selectAllElement, selectNoneElement);

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
                    objectRefreshDialog.focusableElements.push(checkElement);

                    checkCellElement.appendChild(checkElement);
                    statusCellElement.appendChild(createElement('span', 'objectRefreshStatus', String(item.status)));
                    (Array.isArray(item.differences) ? item.differences : []).forEach(function (difference) {
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

            const setGroupExpanded = function (isExpanded, isAnimated) {
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
            objectRefreshDialog.focusableElements.push(toggleElement);

            // A GROUP HOLDING A TICKED ITEM OPENS, SO WHAT IS TICKED IS IN SIGHT AFTER A CANCELLED CONFIRMATION
            if (tickedIndexes.some(function (itemIndex) { return itemIndex >= firstItemIndex && itemIndex < firstItemIndex + items.length; })) {
                setGroupExpanded(true, false);
            }

        });

        if (itemCount > 0) {
            applyElement = addObjectRefreshButton(actionsElement, 'primary', 'objectRefreshApply', 'Apply', function () {
                if (!objectRefreshDialog || tickedIndexes.length === 0) { return; }
                applyElement.disabled = true;
                vscodeApi.postMessage({ command: 'applyObjectRefresh', refreshId: objectRefreshDialog.refreshId, itemIndexes: tickedIndexes.slice().sort(function (first, second) { return first - second; }) });
            });
            drawApply();
        }
        objectRefreshDialog.cancelElement = addObjectRefreshButton(actionsElement, 'secondary', 'objectRefreshCancel', itemCount > 0 ? 'Cancel' : 'Close', function () {
            postObjectRefreshCancel();
            closeObjectRefreshDialog(true);
        });
        objectRefreshDialog.firstFocusElement = objectRefreshDialog.focusableElements.find(function (element) { return element.className.indexOf('objectRefreshGroupToggle') !== -1; }) || objectRefreshDialog.cancelElement;

    }

    // CLOSING DROPS THE DIALOG'S ORG PICKER FROM THE PICKERS THE COCKPIT REDRAWS, AND GIVES THE COCKPIT BACK
    function closeObjectRefreshDialog(isFocusReturned) {

        if (!objectRefreshDialog) { return; }

        const orgView = objectRefreshDialog.orgView;
        if (orgView) { dataOrgViews = dataOrgViews.filter(function (dataOrgView) { return dataOrgView !== orgView; }); }
        cockpitDialogHostElement.textContent = '';
        objectRefreshDialog = null;

        [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
            if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
        });

        if (isFocusReturned && objectRefreshOpenerElement && !objectRefreshOpenerElement.disabled) { focusElement(objectRefreshOpenerElement); }
        if (isFocusReturned) { objectRefreshOpenerElement = null; }

    }`;
