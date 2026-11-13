import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_PICKLIST_CHOICE_EMPTY_REASON,
    RECIPE_COCKPIT_PICKLIST_OTHER_EDIT_NOTE,
    RECIPE_COCKPIT_PICKLIST_RESET_LABEL
} from '../../../RecipeCockpitTreecipeFieldEditorConstants';
import type {
    FieldEditorPanelMessage,
    IFieldEditResultMessage,
    ILoadPicklistValuesMessage,
    IPicklistValuesMessage,
    IResetPicklistValueChoiceMessage,
    ISetPicklistValueChoiceMessage,
    ITreeFieldState,
    ITreeObjectState,
    ITreeState,
    PicklistValuesCallback
} from './FieldEditorTypes';

/*
    A picklist's value tiles (#465, #653). These names are the panel script's own, read when a
    function runs; pendingPicklistValueElements is its let, since it empties it for every new model.
*/
declare const vscodeApi: { postMessage(message: FieldEditorPanelMessage): void };
declare const renderedSequence: number | null;
declare const pendingPicklistValueElements: Record<string, PicklistValuesCallback[]>;
declare function findTreeState(treeKey: unknown): ITreeState | null;
declare function findFixedValueLockReason(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): string;
declare function savePanelPlace(): void;

interface IPicklistTileState {
    value: unknown;
    isChosen: boolean;
    isStartChosen: boolean;
    tileElement: HTMLElement;
    checkElement: HTMLButtonElement;
}

function appendPicklistValueList(containerElement: HTMLElement, picklistValues: unknown): void {

    if (!Array.isArray(picklistValues) || picklistValues.length === 0) {
        containerElement.appendChild(createElement('div', 'picklistEmpty muted', 'no values'));
        return;
    }

    picklistValues.forEach(function (picklistValue: unknown) {
        containerElement.appendChild(createElement('div', 'picklistValue', String(picklistValue)));
    });

}

function buildPicklistKey(objectApiName: unknown, fieldApiName: unknown, treeKey: unknown, nickname: unknown): string {
    return String(objectApiName) + '\n' + String(fieldApiName) + '\n' + String(treeKey) + '\n' + String(nickname || '');
}

/*
    Asked for on every open, since an edit since the last one changes which tiles start ticked,
    and says so until the host answers. The answer is handed to the callback of the editor that
    asked, which draws it only if that editor is still open.
*/
export function requestPicklistValues(treeKey: string, objectApiName: string, nickname: string | undefined, fieldApiName: string, onValues: PicklistValuesCallback): void {

    const picklistKey = buildPicklistKey(objectApiName, fieldApiName, treeKey, nickname);

    // A HAND-EDITED WRAPPER CAN REPEAT A FIELD, AND EVERY ROW THAT ASKED IS ANSWERED, NOT ONLY THE LAST
    if (!Object.prototype.hasOwnProperty.call(pendingPicklistValueElements, picklistKey)) {
        pendingPicklistValueElements[picklistKey] = [];
    }
    pendingPicklistValueElements[picklistKey].push(onValues);
    const message: ILoadPicklistValuesMessage = { command: 'loadPicklistValues', objectApiName: objectApiName, fieldApiName: fieldApiName, treeKey: treeKey };
    if (nickname) { message.nickname = nickname; }
    vscodeApi.postMessage(message);

}

// DRAWN ONLY INTO A ROW OF THE MODEL ON SCREEN THAT ASKED FOR IT
export function renderPicklistValues(picklistValuesMessage: IPicklistValuesMessage): void {

    if (picklistValuesMessage.renderSequence !== renderedSequence || typeof picklistValuesMessage.treeKey !== 'string') { return; }

    const picklistKey = buildPicklistKey(picklistValuesMessage.objectApiName, picklistValuesMessage.fieldApiName, picklistValuesMessage.treeKey, picklistValuesMessage.nickname);

    if (!Object.prototype.hasOwnProperty.call(pendingPicklistValueElements, picklistKey)) { return; }

    const onValuesCallbacks = pendingPicklistValueElements[picklistKey];
    delete pendingPicklistValueElements[picklistKey];

    onValuesCallbacks.forEach(function (onValues) { onValues(picklistValuesMessage); });

}

/*
    Why a picklist's value tiles cannot be saved here (#465), or '' when they can: the edit
    button's own rule, since a choice is written exactly as an edited expression is.
*/
function findPicklistChoiceLockReason(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState): string {

    if (!treeObjectState.canSelectFields || !fieldState.field.lineNumber) { return 'Values can be chosen only on a card with its own recipe file.'; }
    const lockReason = findFixedValueLockReason(treeObjectState, fieldState);
    return lockReason ? 'Cannot be edited: ' + lockReason : '';

}

/*
    A picklist's value tiles (#465), under its faker value: one tile per value, ticked for what
    the field generates now. Save posts the NAMES the edit button posts plus the values ticked;
    the host builds the expression with the recipe's own backend and writes it as an edit, and a
    refusal comes back under the tiles. Cancel, the close button and Escape post nothing. Record
    types keep their own values, listed under the tiles as they are.
*/
export function drawPicklistValueEditor(treeObjectState: ITreeObjectState, fieldState: ITreeFieldState, editorElement: HTMLElement, picklistValuesMessage: IPicklistValuesMessage, closeEditor: () => void): void {

    const field = fieldState.field;
    const object = treeObjectState.object;
    const lockReason = findPicklistChoiceLockReason(treeObjectState, fieldState);
    const picklistValues: unknown[] = Array.isArray(picklistValuesMessage.picklistValues) ? picklistValuesMessage.picklistValues : [];
    const startValues: unknown[] = Array.isArray(picklistValuesMessage.chosenPicklistValues) ? picklistValuesMessage.chosenPicklistValues : picklistValues;
    const tileStates: IPicklistTileState[] = [];

    editorElement.textContent = '';

    if (picklistValues.length === 0) {
        editorElement.appendChild(createElement('div', 'picklistEmpty muted', 'no values'));
    }

    if (picklistValuesMessage.isOtherEdit && !lockReason) {
        editorElement.appendChild(createElement('div', 'picklistEditorNote muted', RECIPE_COCKPIT_PICKLIST_OTHER_EDIT_NOTE));
    }

    const reasonElement = createElement('div', 'picklistEditorReason muted hidden');
    const refusalElement = createElement('div', 'fieldEditorRefusal hidden');
    refusalElement.setAttribute('role', 'alert');
    const saveElement = createButton('primary', 'picklistEditorSave', 'Save', 'compact');
    const cancelElement = createButton('secondary', 'picklistEditorCancel', 'Cancel', 'compact');
    // THE TILES' OWN WAY BACK (#479), DRAWN ONLY WHILE THE FIELD HAS AN EDIT TO CLEAR
    const resetElement = picklistValuesMessage.isEdited ? createButton('secondary', 'picklistEditorReset', RECIPE_COCKPIT_PICKLIST_RESET_LABEL, 'compact') : null;

    let isSaving = false;
    const drawChoice = function (): void {
        const chosenCount = tileStates.filter(function (tileState) { return tileState.isChosen; }).length;
        // ANOTHER KIND OF EDIT IS NOT WHAT THE TILES START FROM, SO ANY CHOICE OF THEM CHANGES THE FIELD
        const isChanged = !!picklistValuesMessage.isOtherEdit || tileStates.some(function (tileState) { return tileState.isChosen !== tileState.isStartChosen; });
        const reason = lockReason || ( picklistValues.length > 0 && chosenCount === 0 ? RECIPE_COCKPIT_PICKLIST_CHOICE_EMPTY_REASON : '' );
        saveElement.disabled = isSaving || !!reason || picklistValues.length === 0 || !isChanged;
        if (resetElement) { resetElement.disabled = isSaving || !!lockReason; }
        reasonElement.textContent = reason;
        if (reason) { reasonElement.classList.remove('hidden'); } else { reasonElement.classList.add('hidden'); }
    };

    if (picklistValues.length > 0) {

        const tilesElement = createElement('div', 'picklistTiles');
        tilesElement.setAttribute('role', 'group');
        tilesElement.setAttribute('aria-label', 'Values of ' + object.objectApiName + '.' + field.fieldApiName);

        picklistValues.forEach(function (picklistValue) {

            const isStartChosen = startValues.indexOf(picklistValue) !== -1;
            const tileElement = createElement('div', 'picklistTile');
            const checkElement = createButton('check', 'picklistTileCheck');
            const valueElement = createElement('span', 'picklistValue', String(picklistValue));
            const tileState: IPicklistTileState = { value: picklistValue, isChosen: isStartChosen, isStartChosen: isStartChosen, tileElement: tileElement, checkElement: checkElement };

            checkElement.setAttribute('role', 'checkbox');
            checkElement.setAttribute('aria-label', String(picklistValue));
            checkElement.disabled = !!lockReason;
            tileElement.appendChild(checkElement);
            tileElement.appendChild(valueElement);

            // THE WHOLE TILE TOGGLES; A CLICK ON THE BOX BUBBLES HERE, SO THE BOX HAS NO LISTENER OF ITS OWN
            tileElement.addEventListener('click', function () {
                if (lockReason) { return; }
                tileState.isChosen = !tileState.isChosen;
                drawTile(tileState);
                drawChoice();
            });

            drawTile(tileState);
            tileStates.push(tileState);
            tilesElement.appendChild(tileElement);

        });

        editorElement.appendChild(tilesElement);

    }

    const recordTypeSections: unknown[] = Array.isArray(picklistValuesMessage.recordTypePicklistValues) ? picklistValuesMessage.recordTypePicklistValues : [];
    recordTypeSections.forEach(function (recordTypeSection) {
        const { recordTypeDeveloperName, picklistValues: recordTypePicklistValues } = recordTypeSection as { recordTypeDeveloperName?: unknown; picklistValues?: unknown };
        editorElement.appendChild(createElement('div', 'recordTypeHeading', 'Record type: ' + String(recordTypeDeveloperName)));
        appendPicklistValueList(editorElement, recordTypePicklistValues);
    });

    saveElement.addEventListener('click', function (event) {
        event.stopPropagation();
        if (saveElement.disabled) { return; }
        const message: ISetPicklistValueChoiceMessage = {
            command: 'setPicklistValueChoice',
            treeKey: treeObjectState.tree.treeKey,
            objectApiName: object.objectApiName,
            fieldApiName: field.fieldApiName,
            picklistValues: tileStates.filter(function (tileState) { return tileState.isChosen; }).map(function (tileState) { return tileState.value; })
        };
        if (object.nickname) { message.nickname = object.nickname; }
        refusalElement.textContent = '';
        refusalElement.classList.add('hidden');
        // ONE SAVE AT A TIME: SAVE COMES BACK WITH A REFUSAL, AND A WRITE RELOADS THE CARD
        isSaving = true;
        drawChoice();
        // A SAVE RELOADS THE CARD, WHICH SHOULD FIND THE EDITOR CLOSED; A REFUSAL OPENS IT IN THE PLACE AGAIN
        fieldState.isPicklistExpanded = false;
        savePanelPlace();
        vscodeApi.postMessage(message);
    });
    if (resetElement) {
        resetElement.setAttribute('title', 'Put back the lines ' + field.fieldApiName + ' had before it was edited, after a confirmation');
        resetElement.addEventListener('click', function (event) {
            event.stopPropagation();
            if (resetElement.disabled) { return; }
            const message: IResetPicklistValueChoiceMessage = {
                command: 'resetPicklistValueChoice',
                treeKey: treeObjectState.tree.treeKey,
                objectApiName: object.objectApiName,
                fieldApiName: field.fieldApiName
            };
            if (object.nickname) { message.nickname = object.nickname; }
            refusalElement.textContent = '';
            refusalElement.classList.add('hidden');
            isSaving = true;
            drawChoice();
            fieldState.isPicklistExpanded = false;
            savePanelPlace();
            vscodeApi.postMessage(message);
        });
    }
    cancelElement.addEventListener('click', function (event) { event.stopPropagation(); closeEditor(); });

    const actionsElement = createElement('div', 'fieldEditorActions');
    actionsElement.appendChild(saveElement);
    if (resetElement) { actionsElement.appendChild(resetElement); }
    actionsElement.appendChild(cancelElement);
    editorElement.appendChild(reasonElement);
    editorElement.appendChild(refusalElement);
    editorElement.appendChild(actionsElement);
    fieldState.picklistRefusalElement = refusalElement;
    fieldState.endPicklistSave = function () { isSaving = false; drawChoice(); };

    drawChoice();

}

function drawTile(tileState: IPicklistTileState): void {
    tileState.checkElement.setAttribute('aria-checked', tileState.isChosen ? 'true' : 'false');
    tileState.checkElement.textContent = tileState.isChosen ? '✓' : '';
    if (tileState.isChosen) { tileState.tileElement.classList.add('chosen'); } else { tileState.tileElement.classList.remove('chosen'); }
}

// A REFUSAL OF A CHOICE (#465) IS WRITTEN UNDER THE TILES, WHICH STAY OPEN; ANY OTHER ANSWER CLOSES THEM
export function renderPicklistChoiceResult(fieldEditResultMessage: IFieldEditResultMessage): void {

    const treeState = findTreeState(fieldEditResultMessage.treeKey);
    if (!treeState) { return; }

    treeState.objectStates.forEach(function (treeObjectState) {
        if (treeObjectState.object.objectApiName !== fieldEditResultMessage.objectApiName) { return; }
        treeObjectState.fieldStates.forEach(function (fieldState) {
            if (fieldState.field.fieldApiName !== fieldEditResultMessage.fieldApiName || !fieldState.setPicklistExpanded || !fieldState.picklistRefusalElement) { return; }
            if (typeof fieldEditResultMessage.refusal === 'string') {
                fieldState.picklistRefusalElement.textContent = fieldEditResultMessage.refusal;
                fieldState.picklistRefusalElement.classList.remove('hidden');
                if (fieldState.endPicklistSave) { fieldState.endPicklistSave(); }
                fieldState.isPicklistExpanded = true;
                savePanelPlace();
                return;
            }
            fieldState.setPicklistExpanded(false);
        });
    });

}
