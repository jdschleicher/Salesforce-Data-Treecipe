import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { buildPencilGlyph } from '../../RecipeCockpitPanelBuilders';
import { vscodeApi } from '../../RecipeCockpitPanelConnection';
import { isSameOccurrence, occurrenceNicknameOf } from '../fieldRows/SelectionCascade';
import { asCardObjectState } from './CardTypes';
import type { CardObjectState, ICardObject } from './CardTypes';
import type { ITreeObjectStateView } from '../navigation/NavigationTypes';

/*
    The count right of an object's name (#255) reads as what is created (#438): "Create [5 ✎]
    Contact record(s) per Account", a nested faker-js friend's count being records PER parent
    record, as "count:" means there. The count is a button; a click anywhere on it swaps in the
    number box, where Enter or leaving the box keeps the count and Escape puts the button back.
    Only a whole number of one or more is posted, anything else is refused on the row and the box
    stays open. The host holds the count to the same rule again, and the recipe file is never
    written.
*/
export function buildRecordCountElement(treeObjectState: CardObjectState): HTMLElement {

    const countElement = createElement('span', 'treeRecordCount');
    const buttonElement = createButton('secondary', 'treeRecordCountButton', '', 'compact');
    const valueElement = createElement('span', 'treeRecordCountValue');
    const changedElement = createElement('span', 'treeRecordCountChanged hidden', 'changed');
    const labelElement = createElement('span', 'treeRecordCountLabel');

    buttonElement.appendChild(valueElement);
    buttonElement.appendChild(buildPencilGlyph('default'));
    buttonElement.appendChild(changedElement);

    buttonElement.addEventListener('click', function () {
        if (buttonElement.disabled) { return; }
        openRecordCountEditor(treeObjectState);
    });

    countElement.appendChild(createElement('span', 'treeRecordCountVerb', 'Create'));
    countElement.appendChild(buttonElement);
    countElement.appendChild(labelElement);
    treeObjectState.recordCountElement = countElement;
    treeObjectState.countButtonElement = buttonElement;
    treeObjectState.countValueElement = valueElement;
    treeObjectState.countChangedElement = changedElement;
    treeObjectState.countLabelElement = labelElement;
    drawRecordCount(treeObjectState, false);

    return countElement;

}

// "Contact record(s) per Account" WHATEVER THE COUNT (#490); THE PARENT'S RECORD IS ALWAYS ONE
function describeRecordCount(object: ICardObject): string {

    return object.objectApiName + ' record(s)' + (object.countParentObjectApiName ? ' per ' + object.countParentObjectApiName : '');

}

/*
    The button says the whole sentence to a screen reader, and whether the count differs from the
    recipe's own. A redraw of an object's selection redraws every row, so a row whose count,
    exclusion and recipe count are what it last drew is left alone.
*/
export function drawRecordCount(treeObjectStateView: ITreeObjectStateView, isExcluded: boolean): void {

    const treeObjectState = asCardObjectState(treeObjectStateView);

    const object = treeObjectState.object;
    const recordCount = currentRecordCountOf(treeObjectState);
    const isChanged = recordCount !== object.recordCount;
    const buttonElement = treeObjectState.countButtonElement as HTMLButtonElement;
    const drawnKey = recordCount + '|' + (isExcluded ? 1 : 0);

    if (isExcluded && treeObjectState.isCountEditorOpen) {
        const wasFocused = document.activeElement === treeObjectState.countInputElement;
        closeRecordCountEditor(treeObjectState, false);
        if (wasFocused && treeObjectState.includeElement) { treeObjectState.includeElement.focus(); }
    }
    if (treeObjectState.countDrawnKey === drawnKey) { return; }
    treeObjectState.countDrawnKey = drawnKey;

    ( treeObjectState.countValueElement as HTMLElement ).textContent = String(recordCount);
    ( treeObjectState.countLabelElement as HTMLElement ).textContent = describeRecordCount(object);
    buttonElement.disabled = !!isExcluded;
    if (isChanged) { buttonElement.classList.add('changed'); } else { buttonElement.classList.remove('changed'); }
    if (isChanged) { ( treeObjectState.countChangedElement as HTMLElement ).classList.remove('hidden'); } else { ( treeObjectState.countChangedElement as HTMLElement ).classList.add('hidden'); }
    buttonElement.setAttribute('title', isExcluded
        ? 'Excluded objects are not generated, so their count cannot be changed.'
        : (isChanged ? 'recipe: ' + object.recordCount + '. ' : '') + 'Click to change the count.');
    buttonElement.setAttribute('aria-label', 'Create ' + recordCount + ' ' + object.objectApiName + ' record(s)'
        + (object.countParentObjectApiName ? ' per ' + object.countParentObjectApiName + ' record' : '')
        + (isChanged ? ', changed from the recipe\'s ' + object.recordCount : '')
        + ', edit count');

}

// THE BOX AND ITS REFUSAL ARE BUILT ON THE FIRST OPEN: FEW READERS EVER CHANGE A COUNT, AND A CARD CAN HOLD THOUSANDS OF ROWS
function ensureRecordCountEditor(treeObjectState: CardObjectState): void {

    if (treeObjectState.countInputElement) { return; }

    const object = treeObjectState.object;
    const inputElement = createElement('input', 'treeRecordCountInput hidden');
    const errorElement = createElement('span', 'treeRecordCountError hidden');
    const recordCountElement = treeObjectState.recordCountElement as HTMLElement;

    inputElement.setAttribute('type', 'text');
    inputElement.setAttribute('inputmode', 'numeric');
    inputElement.setAttribute('aria-label', object.objectApiName + ' record(s)' + (object.countParentObjectApiName ? ' per ' + object.countParentObjectApiName + ' record' : ''));
    inputElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            commitRecordCount(treeObjectState);
        } else if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            closeRecordCountEditor(treeObjectState, true);
        }
    });
    inputElement.addEventListener('blur', function () {
        if (treeObjectState.isCountEditorOpen) { commitRecordCount(treeObjectState); }
    });

    recordCountElement.insertBefore(inputElement, treeObjectState.countLabelElement);
    recordCountElement.appendChild(errorElement);
    treeObjectState.countInputElement = inputElement;
    treeObjectState.countErrorElement = errorElement;

}

function openRecordCountEditor(treeObjectState: CardObjectState): void {

    ensureRecordCountEditor(treeObjectState);
    const inputElement = treeObjectState.countInputElement as HTMLInputElement;

    treeObjectState.isCountEditorOpen = true;
    inputElement.value = String(currentRecordCountOf(treeObjectState));
    ( treeObjectState.countButtonElement as HTMLButtonElement ).classList.add('hidden');
    inputElement.classList.remove('hidden');
    inputElement.focus();
    if (typeof inputElement.select === 'function') { inputElement.select(); }

}

// CLOSED BEFORE FOCUS MOVES, SO THE BOX'S OWN blur DOES NOT COMMIT A COUNT THE READER CANCELLED
function closeRecordCountEditor(treeObjectState: CardObjectState, isFocusReturned: boolean): void {

    const buttonElement = treeObjectState.countButtonElement as HTMLButtonElement;
    const errorElement = treeObjectState.countErrorElement as HTMLElement;

    treeObjectState.isCountEditorOpen = false;
    ( treeObjectState.countInputElement as HTMLInputElement ).classList.add('hidden');
    buttonElement.classList.remove('hidden');
    errorElement.textContent = '';
    errorElement.classList.add('hidden');
    if (isFocusReturned) { buttonElement.focus(); }

}

function commitRecordCount(treeObjectState: CardObjectState): void {

    const object = treeObjectState.object;
    const countText = String(( treeObjectState.countInputElement as HTMLInputElement ).value);
    const recordCount = Number(countText);

    if (!/^[1-9][0-9]*$/.test(countText) || !Number.isSafeInteger(recordCount)) {
        const errorElement = treeObjectState.countErrorElement as HTMLElement;
        errorElement.textContent = 'Enter a whole number of 1 or more.';
        errorElement.classList.remove('hidden');
        return;
    }

    closeRecordCountEditor(treeObjectState, true);
    if (recordCount === currentRecordCountOf(treeObjectState)) { return; }

    const countMessage: { command: 'setObjectCount'; treeKey: string; objectApiName: string; count: number; nickname?: string } = { command: 'setObjectCount', treeKey: treeObjectState.tree.treeKey, objectApiName: object.objectApiName, count: recordCount };
    if (object.nickname) { countMessage.nickname = object.nickname; }
    vscodeApi.postMessage(countMessage);

}

// THE COUNT THE CARD GENERATES WITH: THE ONE THE READER SET, ELSE THE RECIPE'S OWN
function currentRecordCountOf(treeObjectState: CardObjectState): number | undefined {

    const objectCounts = (Array.isArray(treeObjectState.tree.objectCounts) ? treeObjectState.tree.objectCounts : []) as Array<{ objectApiName: string; nickname?: string; count: number }>;
    const nickname = occurrenceNicknameOf(treeObjectState.object);
    const storedCount = objectCounts.find(function (objectCount) { return isSameOccurrence(objectCount, treeObjectState.object.objectApiName, nickname); });

    return storedCount ? storedCount.count : treeObjectState.object.recordCount;

}
