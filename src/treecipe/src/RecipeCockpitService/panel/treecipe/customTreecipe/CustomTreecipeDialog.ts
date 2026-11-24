import { isConfirmDialogOpen } from '../../../../CockpitKit/panel/CockpitConfirmDialogPanel';
import { SVG_NAMESPACE, createButton, createElement, focusElement, isMotionReduced } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_CUSTOMIZE_TREE_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_BACK_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_CANCEL_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_CLOSE_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_CONFIRM_SAVE_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_NOTE,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_TITLE,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_CONFIRM_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_KEEP_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_OBJECTS_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_FIELDS_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_OBJECTS_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_EVERY_FIELD_REMOVED_TEXT,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_PLACEHOLDER,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_NO_MATCH_PREFIX,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_LEFT_NOTE,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_REMOVED_NOTE,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_TEXT,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_WITH_PREFIX,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_TEXT,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_WITH_PREFIX,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_EVERY_FIELD_PREFIX,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_SHOWN_FIELDS_PREFIX,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_RESTORE_ALL_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_SAVE_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_LABEL,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_SOURCE_NOTE,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_TITLE
} from '../../../RecipeCockpitCustomTreecipeConstants';
import { RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH, RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH, RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM, RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX, RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH } from '../../../RecipeCockpitPanelConstants';
import { cockpitBodyElement, cockpitDialogHostElement, cockpitMetaElement, loadStatusElement, vscodeApi } from '../../RecipeCockpitPanelConnection';
import { renderedSequence } from '../../shell/PanelRender';
import type { CardTreeState, ICardField, ICardTree } from '../card/CardTypes';

/*
    The panel half of "Customize and create new recipe" (#677): a card's objects and fields in a
    modal, each with a red ✕ that takes it out of a new recipe, and Save as new Treecipe in the
    bottom right. The panel decides nothing: every ✕, ↺ and chain link posts the whole removal by
    NAME as previewCustomTreecipe, and the host answers with the card's own cascade and locks
    (customTreecipePreview), which is all a row draws from. Save posts the same removal and a name;
    the host plans and writes again. Every host string is written with textContent. Its styles are
    CustomTreecipeDialog.css beside it, which the cockpit's stylesheet includes.
*/

interface IExclusion {
    objectApiName: string;
    kind: string;
    excludedParentObjectApiName?: string;
    removedLookupFieldApiName?: string;
}

interface ILockedField {
    fieldApiName: string;
    reason: string;
}

// WHAT THE HOST POSTS: EVERY FIELD IS CHECKED BEFORE IT IS READ
interface ICustomTreecipePreviewMessage {
    renderSequence?: unknown;
    previewSequence?: unknown;
    treeKey?: unknown;
    objectSelection?: { exclusions?: unknown; disabledLookups?: unknown };
    fieldSelection?: { objects?: unknown };
    outOfRunExclusions?: unknown;
    keptObjectCount?: unknown;
    objectCount?: unknown;
    folderName?: unknown;
    refusal?: unknown;
}

interface ICustomTreecipePreview {
    removedByObject: Map<string, IExclusion>;
    outOfRunByObject: Map<string, IExclusion>;
    cutLookupKeys: Set<string>;
    lockedFieldsByObject: Map<string, Map<string, string>>;
    keptObjectCount: number;
    objectCount: number;
    folderName: string | null;
    refusal: string | null;
}

interface IDialogObject {
    objectApiName: string;
    parentLookups: Array<{ fieldApiName: string; parentObjectApiName: string }>;
    fields: ICardField[];
}

interface ICustomTreecipeDialog {
    tree: ICardTree;
    objects: IDialogObject[];
    removedObjects: Set<string>;
    removedFields: Map<string, Set<string>>;
    outOfRunObjects: Set<string>;
    expandedObjects: Set<string>;
    // WHAT THE SEARCH BOX HOLDS, AND THE OBJECTS OPENED OR CLOSED WHILE IT DID: CLEARED WITH EVERY KEYSTROKE, SO expandedObjects IS AS IT WAS BEFORE THE SEARCH (#711)
    searchText: string;
    searchToggledObjects: Set<string>;
    isRootRemovalAsked: boolean;
    isEveryFieldRemovalAsked: boolean;
    step: 'edit' | 'save';
    previewSequence: number;
    preview: ICustomTreecipePreview | null;
    overlayElement: HTMLElement;
    summaryElement: HTMLElement;
    bodyElement: HTMLElement;
    statusElement: HTMLElement;
    cancelElement: HTMLButtonElement;
    saveElement: HTMLButtonElement;
    nameInputElement: HTMLInputElement | null;
    // WHAT THE READER TYPED ON THE SAVE STEP, KEPT ACROSS A REDRAW (A PREVIEW CAN LAND WHILE THEY TYPE)
    typedName: string;
    openerElement: HTMLElement | null;
    /*
        Every control drawn, in tab order, under a KEY naming what it acts on (the object or field),
        never its label: ✕ becomes ↺ on the same key, so a redraw puts focus back on the row the
        reader was on rather than at the top of the list. The focus trap reads this, not the DOM.
    */
    controls: Array<{ key: string; element: HTMLButtonElement | HTMLInputElement }>;
    frameControls: Array<{ key: string; element: HTMLButtonElement | HTMLInputElement }>;
    // THE TOOLBAR, IN TAB ORDER BETWEEN THE CLOSE ✕ AND THE BODY; DRAWN ONCE, ITS DISABLED STATES SET BY EVERY DRAW
    toolbar: ICustomTreecipeToolbar;
    // EACH OBJECT'S ROW, AND ITS FIELD LIST, AS LAST DRAWN, EACH UNDER THE SIGNATURE OF WHAT IT WAS DRAWN FROM
    rowsByObject: Map<string, IDrawnElement>;
    fieldListsByObject: Map<string, IDrawnElement>;
}

interface ICustomTreecipeToolbar {
    searchElement: HTMLInputElement;
    deselectObjectsElement: HTMLButtonElement;
    deselectFieldsElement: HTMLButtonElement;
    restoreAllElement: HTMLButtonElement;
    controls: Array<{ key: string; element: HTMLButtonElement | HTMLInputElement }>;
}

// AN OBJECT THE SEARCH SHOWS: EVERY FIELD WHEN ITS NAME MATCHES, ELSE ONLY THE FIELDS THAT DO, WITH ITS LIST OPENED FOR THEM
interface IShownObject {
    dialogObject: IDialogObject;
    shownFields: ICardField[];
    isShownByFieldsOnly: boolean;
}

/*
    An object's row or its field list, kept between redraws: a ✕ changes the rows of the object it was
    on and of what the cascade took with it, so every other object's rows -- hundreds of fields, for a
    tree with every object open -- are put back as they were rather than built again. The two are kept
    apart (#684) because a chain toggle or a ↺ changes rows but not the fields under them, and a field
    list stays kept while its object is closed or removed, ready for when it opens again.
*/
interface IDrawnElement {
    signature: string;
    element: HTMLElement;
    controls: Array<{ key: string; element: HTMLButtonElement | HTMLInputElement }>;
}

let customTreecipeDialog: ICustomTreecipeDialog | null = null;

// THE CARD'S BUTTON: ONLY ON A CARD WITH ITS OWN RECIPE FILE, WHICH IS WHAT A COPY IS BUILT FROM
export function buildCustomizeTreeButton(treeState: CardTreeState): HTMLButtonElement | null {

    const tree = treeState.tree;
    if (!tree.folderName || !tree.runFakerRecipeFileName) { return null; }

    const buttonElement = createButton('secondary', 'treeCustomize', RECIPE_COCKPIT_CUSTOMIZE_TREE_LABEL);
    buttonElement.addEventListener('click', function () { openCustomTreecipeDialog(treeState, buttonElement); });
    return buttonElement;

}

function listDialogObjects(treeState: CardTreeState): IDialogObject[] {

    const seenObjectApiNames = new Set<string>();
    const dialogObjects: IDialogObject[] = [];

    treeState.tree.objects.forEach(function (treeObject) {
        if (treeObject.iterationNickname !== undefined || seenObjectApiNames.has(treeObject.objectApiName)) { return; }
        const objectState = treeState.objectStates.find(function (candidate) { return candidate.object.objectApiName === treeObject.objectApiName; });
        if (!objectState) { return; }
        seenObjectApiNames.add(treeObject.objectApiName);
        const seenFieldApiNames = new Set<string>();
        dialogObjects.push({
            objectApiName: treeObject.objectApiName,
            parentLookups: treeObject.parentLookups,
            // THE FIELDS THE CARD DRAWS A CHECKBOX FOR: THE ONES ITS RECIPE WRITES
            fields: objectState.object.fields.filter(function (field) {
                if (field.lineNumber === undefined || seenFieldApiNames.has(field.fieldApiName)) { return false; }
                seenFieldApiNames.add(field.fieldApiName);
                return true;
            })
        });
    });

    return dialogObjects;

}

export function openCustomTreecipeDialog(treeState: CardTreeState, openerElement: HTMLElement | null): void {

    if (renderedSequence === null || isConfirmDialogOpen()) { return; }
    closeCustomTreecipeDialog(false);

    const overlayElement = createElement('div', 'confirmOverlay customTreecipeOverlay');
    const dialogElement = createElement('div', 'confirmDialog customTreecipeDialog');
    const headerElement = createElement('div', 'customTreecipeHeader');
    const titleBlockElement = createElement('div');
    const titleElement = createElement('h2', 'confirmTitle', RECIPE_COCKPIT_CUSTOM_TREECIPE_TITLE);
    const sourceElement = createElement('p', 'customTreecipeSource muted', 'From ' + treeState.tree.folderName + '. ' + RECIPE_COCKPIT_CUSTOM_TREECIPE_SOURCE_NOTE);
    const closeElement = createButton('icon', 'customTreecipeClose', '✕');
    const summaryElement = createElement('p', 'customTreecipeSummary muted');
    const toolbar = buildToolbar();
    const bodyElement = createElement('div', 'confirmBody customTreecipeBody');
    const footerElement = createElement('div', 'confirmActions customTreecipeFooter');
    const statusElement = createElement('p', 'customTreecipeStatus muted');
    const cancelElement = createButton('secondary', 'customTreecipeCancel', RECIPE_COCKPIT_CUSTOM_TREECIPE_CANCEL_LABEL);
    const saveElement = createButton('primary', 'customTreecipeSave', RECIPE_COCKPIT_CUSTOM_TREECIPE_SAVE_LABEL);

    titleElement.setAttribute('id', 'customTreecipeTitle');
    closeElement.setAttribute('aria-label', RECIPE_COCKPIT_CUSTOM_TREECIPE_CLOSE_LABEL);
    closeElement.setAttribute('title', RECIPE_COCKPIT_CUSTOM_TREECIPE_CLOSE_LABEL);
    statusElement.setAttribute('aria-live', 'polite');
    dialogElement.setAttribute('role', 'dialog');
    dialogElement.setAttribute('aria-modal', 'true');
    dialogElement.setAttribute('aria-labelledby', 'customTreecipeTitle');

    titleBlockElement.appendChild(titleElement);
    titleBlockElement.appendChild(sourceElement);
    headerElement.appendChild(titleBlockElement);
    headerElement.appendChild(closeElement);
    footerElement.appendChild(statusElement);
    footerElement.appendChild(cancelElement);
    footerElement.appendChild(saveElement);
    dialogElement.appendChild(headerElement);
    dialogElement.appendChild(summaryElement);
    dialogElement.appendChild(toolbar.element);
    dialogElement.appendChild(bodyElement);
    dialogElement.appendChild(footerElement);
    overlayElement.appendChild(dialogElement);

    const objects = listDialogObjects(treeState);
    customTreecipeDialog = {
        tree: treeState.tree,
        objects: objects,
        removedObjects: new Set(),
        removedFields: new Map(),
        outOfRunObjects: new Set(),
        expandedObjects: new Set(objects.length > 1 ? [objects[1].objectApiName] : []),
        searchText: '',
        searchToggledObjects: new Set(),
        isRootRemovalAsked: false,
        isEveryFieldRemovalAsked: false,
        step: 'edit',
        previewSequence: 0,
        preview: null,
        overlayElement: overlayElement,
        summaryElement: summaryElement,
        bodyElement: bodyElement,
        statusElement: statusElement,
        cancelElement: cancelElement,
        saveElement: saveElement,
        nameInputElement: null,
        typedName: '',
        openerElement: openerElement,
        controls: [],
        rowsByObject: new Map(),
        fieldListsByObject: new Map(),
        toolbar: toolbar.toolbar,
        frameControls: [
            { key: 'frame:close', element: closeElement },
            { key: 'frame:cancel', element: cancelElement },
            { key: 'frame:save', element: saveElement }
        ]
    };

    closeElement.addEventListener('click', function () { closeCustomTreecipeDialog(true); });
    cancelElement.addEventListener('click', function () { closeCustomTreecipeDialog(true); });
    saveElement.addEventListener('click', function () {
        if (!customTreecipeDialog || saveElement.disabled) { return; }
        customTreecipeDialog.step = 'save';
        drawCustomTreecipeDialog();
    });

    dialogElement.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            closeCustomTreecipeDialog(true);
            return;
        }
        if (event.key !== 'Tab' || !customTreecipeDialog) { return; }
        const enabledElements = [customTreecipeDialog.frameControls[0]].concat(customTreecipeDialog.toolbar.controls, customTreecipeDialog.controls, customTreecipeDialog.frameControls.slice(1))
            .map(function (control) { return control.element; })
            .filter(function (element) { return !element.disabled && !element.classList.contains('hidden'); });
        if (enabledElements.length === 0) { return; }
        const currentIndex = enabledElements.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? enabledElements.length - 1 : currentIndex - 1)
            : (currentIndex === -1 || currentIndex === enabledElements.length - 1 ? 0 : currentIndex + 1);
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        focusElement(enabledElements[nextIndex]);
    });

    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.setAttribute('inert', ''); }
    });

    if (!isMotionReduced()) { dialogElement.classList.add('motionReveal'); }
    cockpitDialogHostElement.appendChild(overlayElement);

    drawCustomTreecipeDialog();
    postCustomTreecipePreview();
    focusElement(closeElement);

}

export function closeCustomTreecipeDialog(isFocusReturned: boolean): void {

    if (!customTreecipeDialog) { return; }

    const openerElement = customTreecipeDialog.openerElement;
    cockpitDialogHostElement.textContent = '';
    customTreecipeDialog = null;

    [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
        if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
    });

    if (isFocusReturned && openerElement) { focusElement(openerElement); }

}

/*
    The toolbar (#711): a search over object and field API names, which changes only what is shown,
    and bulk ✕ and ↺ that change the same removals a row's ✕ and ↺ do, over what the search shows.
*/
function buildToolbar(): { element: HTMLElement; toolbar: ICustomTreecipeToolbar } {

    const toolbarElement = createElement('div', 'customTreecipeToolbar');
    const searchElement = createElement('input', 'customTreecipeSearch');
    searchElement.setAttribute('type', 'search');
    searchElement.setAttribute('maxlength', '80');
    searchElement.setAttribute('aria-label', RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_LABEL);
    searchElement.setAttribute('placeholder', RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_PLACEHOLDER);
    searchElement.addEventListener('input', function () {
        if (!customTreecipeDialog) { return; }
        customTreecipeDialog.searchText = searchElement.value;
        customTreecipeDialog.searchToggledObjects.clear();
        drawCustomTreecipeDialog();
    });
    searchElement.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && typeof event.preventDefault === 'function') { event.preventDefault(); }
    });

    const deselectObjectsElement = createButton('secondary', 'customTreecipeDeselectObjects', RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_OBJECTS_LABEL, 'compact');
    deselectObjectsElement.addEventListener('click', function () {
        if (!customTreecipeDialog || deselectObjectsElement.disabled) { return; }
        const objectApiNames = listDeselectableObjectApiNames(customTreecipeDialog);
        changeRemoval(function (dialog) {
            objectApiNames.forEach(function (objectApiName) {
                dialog.removedObjects.add(objectApiName);
                dialog.outOfRunObjects.delete(objectApiName);
            });
        });
    });

    const deselectFieldsElement = createButton('secondary', 'customTreecipeDeselectFields', RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_LABEL, 'compact');
    deselectFieldsElement.addEventListener('click', function () {
        if (!customTreecipeDialog || deselectFieldsElement.disabled) { return; }
        customTreecipeDialog.isEveryFieldRemovalAsked = true;
        drawCustomTreecipeDialog();
    });

    const restoreAllElement = createButton('secondary', 'customTreecipeRestoreAll', RECIPE_COCKPIT_CUSTOM_TREECIPE_RESTORE_ALL_LABEL, 'compact');
    restoreAllElement.addEventListener('click', function () {
        if (!customTreecipeDialog || restoreAllElement.disabled) { return; }
        changeRemoval(function (dialog) {
            dialog.removedObjects.clear();
            dialog.removedFields.clear();
            dialog.isRootRemovalAsked = false;
            dialog.isEveryFieldRemovalAsked = false;
        });
    });

    [searchElement, deselectObjectsElement, deselectFieldsElement, restoreAllElement].forEach(function (element) { toolbarElement.appendChild(element); });

    return {
        element: toolbarElement,
        toolbar: {
            searchElement: searchElement,
            deselectObjectsElement: deselectObjectsElement,
            deselectFieldsElement: deselectFieldsElement,
            restoreAllElement: restoreAllElement,
            controls: [
                { key: 'toolbar:search', element: searchElement },
                { key: 'toolbar:deselectObjects', element: deselectObjectsElement },
                { key: 'toolbar:deselectFields', element: deselectFieldsElement },
                { key: 'toolbar:restoreAll', element: restoreAllElement }
            ]
        }
    };

}

function readSearchText(dialog: ICustomTreecipeDialog): string {
    return dialog.searchText.trim().toLowerCase();
}

function listShownObjects(dialog: ICustomTreecipeDialog): IShownObject[] {

    const searchText = readSearchText(dialog);
    const shownObjects: IShownObject[] = [];

    dialog.objects.forEach(function (dialogObject) {
        if (searchText === '' || dialogObject.objectApiName.toLowerCase().indexOf(searchText) !== -1) {
            shownObjects.push({ dialogObject: dialogObject, shownFields: dialogObject.fields, isShownByFieldsOnly: false });
            return;
        }
        const matchingFields = dialogObject.fields.filter(function (field) { return field.fieldApiName.toLowerCase().indexOf(searchText) !== -1; });
        if (matchingFields.length > 0) { shownObjects.push({ dialogObject: dialogObject, shownFields: matchingFields, isShownByFieldsOnly: true }); }
    });

    return shownObjects;

}

function isObjectRemoved(dialog: ICustomTreecipeDialog, objectApiName: string): boolean {
    return dialog.removedObjects.has(objectApiName) || (!!dialog.preview && dialog.preview.removedByObject.has(objectApiName));
}

// OPEN WHEN THE READER OPENED IT, OR WHEN THE SEARCH SHOWS IT FOR ITS FIELDS; A CHEVRON CLICKED DURING A SEARCH TURNS THAT OVER UNTIL THE NEXT KEYSTROKE
function isFieldListShown(dialog: ICustomTreecipeDialog, shownObject: IShownObject): boolean {
    const objectApiName = shownObject.dialogObject.objectApiName;
    if (isObjectRemoved(dialog, objectApiName)) { return false; }
    if (readSearchText(dialog) === '') { return dialog.expandedObjects.has(objectApiName); }
    const isOpenForSearch = dialog.expandedObjects.has(objectApiName) || shownObject.isShownByFieldsOnly;
    return dialog.searchToggledObjects.has(objectApiName) ? !isOpenForSearch : isOpenForSearch;
}

// EVERY SHOWN OBJECT BUT THE ROOT THAT IS STILL KEPT: ONE THE CASCADE TOOK STAYS THE CASCADE'S, SO ↺ ON ITS PARENT STILL BRINGS IT BACK
function listDeselectableObjectApiNames(dialog: ICustomTreecipeDialog): string[] {
    const rootObjectApiName = dialog.objects.length > 0 ? dialog.objects[0].objectApiName : null;
    return listShownObjects(dialog)
        .map(function (shownObject) { return shownObject.dialogObject.objectApiName; })
        .filter(function (objectApiName) { return objectApiName !== rootObjectApiName && !isObjectRemoved(dialog, objectApiName); });
}

// A FIELD WHOSE ✕ IS ON: NOT REMOVED, NOT LOCKED BY THE CARD, NOT CUT WITH ITS PARENT
function isFieldRemovable(dialog: ICustomTreecipeDialog, objectApiName: string, fieldApiName: string): boolean {
    const preview = dialog.preview;
    const lockedFields = preview ? preview.lockedFieldsByObject.get(objectApiName) : undefined;
    return !removedFieldsOf(dialog, objectApiName).has(fieldApiName)
        && !(lockedFields && lockedFields.has(fieldApiName))
        && !(preview && preview.cutLookupKeys.has(objectApiName + '\n' + fieldApiName));
}

function listRemovableShownFieldApiNames(dialog: ICustomTreecipeDialog, shownObject: IShownObject): string[] {
    const objectApiName = shownObject.dialogObject.objectApiName;
    if (isObjectRemoved(dialog, objectApiName)) { return []; }
    return shownObject.shownFields
        .map(function (field) { return field.fieldApiName; })
        .filter(function (fieldApiName) { return isFieldRemovable(dialog, objectApiName, fieldApiName); });
}

function removeFields(dialog: ICustomTreecipeDialog, objectApiName: string, fieldApiNames: string[]): void {
    const removedFields = removedFieldsOf(dialog, objectApiName);
    fieldApiNames.forEach(function (fieldApiName) { removedFields.add(fieldApiName); });
    dialog.removedFields.set(objectApiName, removedFields);
}

function countRemovableShownFields(dialog: ICustomTreecipeDialog): number {
    return listShownObjects(dialog).reduce(function (total, shownObject) { return total + listRemovableShownFieldApiNames(dialog, shownObject).length; }, 0);
}

function buildEveryFieldConfirmation(dialog: ICustomTreecipeDialog): HTMLElement {

    const boxElement = createElement('div', 'customTreecipeAsk');
    boxElement.setAttribute('role', 'alert');
    boxElement.appendChild(createElement('span', 'customTreecipeAskTitle', RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_TITLE));
    boxElement.appendChild(createElement('span', '', 'Removes ' + countRemovableShownFields(dialog) + ' field(s). ' + RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_NOTE));
    const actionsElement = createElement('div', 'customTreecipeAskActions');
    const keepElement = addControl(createButton('secondary', 'customTreecipeKeepFields', RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_KEEP_LABEL), 'everyField:keep');
    keepElement.addEventListener('click', function () {
        if (!customTreecipeDialog) { return; }
        customTreecipeDialog.isEveryFieldRemovalAsked = false;
        drawCustomTreecipeDialog();
    });
    const removeElement = addControl(createButton('secondary', 'customTreecipeRemoveFields', RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_CONFIRM_LABEL), 'everyField:remove');
    removeElement.addEventListener('click', function () {
        changeRemoval(function (changedDialog) {
            changedDialog.isEveryFieldRemovalAsked = false;
            listShownObjects(changedDialog).forEach(function (shownObject) {
                removeFields(changedDialog, shownObject.dialogObject.objectApiName, listRemovableShownFieldApiNames(changedDialog, shownObject));
            });
        });
    });
    actionsElement.appendChild(keepElement);
    actionsElement.appendChild(removeElement);
    boxElement.appendChild(actionsElement);
    return boxElement;

}

function drawToolbar(dialog: ICustomTreecipeDialog): void {

    const toolbar = dialog.toolbar;
    const isSearching = readSearchText(dialog) !== '';
    toolbar.deselectObjectsElement.textContent = isSearching ? RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_OBJECTS_LABEL : RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_OBJECTS_LABEL;
    toolbar.deselectFieldsElement.textContent = isSearching ? RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_FIELDS_LABEL : RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_LABEL;
    toolbar.deselectObjectsElement.disabled = listDeselectableObjectApiNames(dialog).length === 0;
    toolbar.deselectFieldsElement.disabled = dialog.isEveryFieldRemovalAsked || countRemovableShownFields(dialog) === 0;
    toolbar.restoreAllElement.disabled = !hasRemovals(dialog);

}

function buildRemovalMessage(dialog: ICustomTreecipeDialog): Record<string, unknown> {

    const removedFields: Array<{ objectApiName: string; fieldApiName: string }> = [];
    dialog.removedFields.forEach(function (fieldApiNames, objectApiName) {
        fieldApiNames.forEach(function (fieldApiName) { removedFields.push({ objectApiName: objectApiName, fieldApiName: fieldApiName }); });
    });

    return {
        treeKey: dialog.tree.treeKey,
        renderSequence: renderedSequence,
        removedObjectApiNames: Array.from(dialog.removedObjects),
        removedFields: removedFields,
        outOfRunObjectApiNames: Array.from(dialog.outOfRunObjects)
    };

}

function postCustomTreecipePreview(): void {

    if (!customTreecipeDialog) { return; }
    customTreecipeDialog.previewSequence += 1;
    const message = buildRemovalMessage(customTreecipeDialog);
    message.command = 'previewCustomTreecipe';
    message.previewSequence = customTreecipeDialog.previewSequence;
    vscodeApi.postMessage(message);

}

// A CHANGE IS DRAWN AT ONCE FROM WHAT THE READER DID, AND AGAIN WHEN THE HOST'S CASCADE COMES BACK
function changeRemoval(applyChange: (dialog: ICustomTreecipeDialog) => void): void {

    if (!customTreecipeDialog) { return; }
    applyChange(customTreecipeDialog);
    drawCustomTreecipeDialog();
    postCustomTreecipePreview();

}

function readExclusions(candidate: unknown): IExclusion[] {

    if (!Array.isArray(candidate)) { return []; }
    return candidate.filter(function (exclusion): exclusion is IExclusion {
        return !!exclusion && typeof exclusion.objectApiName === 'string' && typeof exclusion.kind === 'string';
    });

}

// THE HOST'S ANSWER FOR THE LATEST CHANGE ON THE MODEL ON SCREEN; AN OLDER ONE IS DROPPED
export function renderCustomTreecipePreview(hostMessage: ICustomTreecipePreviewMessage): void {

    const dialog = customTreecipeDialog;
    if (!dialog || hostMessage.renderSequence !== renderedSequence || hostMessage.treeKey !== dialog.tree.treeKey || hostMessage.previewSequence !== dialog.previewSequence) { return; }

    const removedByObject = new Map<string, IExclusion>();
    readExclusions(hostMessage.objectSelection && hostMessage.objectSelection.exclusions).forEach(function (exclusion) { removedByObject.set(exclusion.objectApiName, exclusion); });
    const outOfRunByObject = new Map<string, IExclusion>();
    readExclusions(hostMessage.outOfRunExclusions).forEach(function (exclusion) { outOfRunByObject.set(exclusion.objectApiName, exclusion); });

    const cutLookupKeys = new Set<string>();
    const disabledLookups = hostMessage.objectSelection && hostMessage.objectSelection.disabledLookups;
    if (Array.isArray(disabledLookups)) {
        disabledLookups.forEach(function (disabledLookup) {
            if (disabledLookup && typeof disabledLookup.objectApiName === 'string' && typeof disabledLookup.fieldApiName === 'string') {
                cutLookupKeys.add(disabledLookup.objectApiName + '\n' + disabledLookup.fieldApiName);
            }
        });
    }

    const lockedFieldsByObject = new Map<string, Map<string, string>>();
    const fieldSelectionObjects = hostMessage.fieldSelection && hostMessage.fieldSelection.objects;
    if (Array.isArray(fieldSelectionObjects)) {
        fieldSelectionObjects.forEach(function (objectFieldSelection) {
            if (!objectFieldSelection || typeof objectFieldSelection.objectApiName !== 'string' || !Array.isArray(objectFieldSelection.lockedFields)) { return; }
            const lockedFields = lockedFieldsByObject.get(objectFieldSelection.objectApiName) || new Map<string, string>();
            (objectFieldSelection.lockedFields as unknown[]).forEach(function (lockedField) {
                const field = lockedField as ILockedField;
                if (field && typeof field.fieldApiName === 'string' && typeof field.reason === 'string') { lockedFields.set(field.fieldApiName, field.reason); }
            });
            lockedFieldsByObject.set(objectFieldSelection.objectApiName, lockedFields);
        });
    }

    dialog.preview = {
        removedByObject: removedByObject,
        outOfRunByObject: outOfRunByObject,
        cutLookupKeys: cutLookupKeys,
        lockedFieldsByObject: lockedFieldsByObject,
        keptObjectCount: typeof hostMessage.keptObjectCount === 'number' ? hostMessage.keptObjectCount : dialog.objects.length,
        objectCount: typeof hostMessage.objectCount === 'number' ? hostMessage.objectCount : dialog.objects.length,
        folderName: typeof hostMessage.folderName === 'string' ? hostMessage.folderName : null,
        refusal: typeof hostMessage.refusal === 'string' ? hostMessage.refusal : null
    };

    drawCustomTreecipeDialog();

}

function buildGlyph(className: string, pathData: string, transform?: string): SVGSVGElement {

    const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
    const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
    glyphElement.setAttribute('class', className);
    glyphElement.setAttribute('viewBox', RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX);
    glyphElement.setAttribute('aria-hidden', 'true');
    glyphElement.setAttribute('focusable', 'false');
    pathElement.setAttribute('d', pathData);
    if (transform) { pathElement.setAttribute('transform', transform); }
    glyphElement.appendChild(pathElement);
    return glyphElement;

}

// A CONTROL OF THE BODY, KEPT IN TAB ORDER UNDER ITS KEY
function addControl<ControlElement extends HTMLButtonElement | HTMLInputElement>(element: ControlElement, key: string): ControlElement {
    if (customTreecipeDialog) { customTreecipeDialog.controls.push({ key: key, element: element }); }
    return element;
}

function buildRoundButton(className: string, symbol: string, label: string, key: string, onClick: () => void): HTMLButtonElement {

    const buttonElement = createButton('icon', className, symbol);
    buttonElement.setAttribute('aria-label', label);
    buttonElement.setAttribute('title', label);
    buttonElement.addEventListener('click', onClick);
    return addControl(buttonElement, key);

}

function removedFieldsOf(dialog: ICustomTreecipeDialog, objectApiName: string): Set<string> {
    return dialog.removedFields.get(objectApiName) || new Set<string>();
}

function describeRemoval(exclusion: IExclusion): string {

    if (exclusion.kind === 'excluded') { return RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_TEXT; }
    if (exclusion.kind === 'noFieldsSelected') { return RECIPE_COCKPIT_CUSTOM_TREECIPE_EVERY_FIELD_REMOVED_TEXT; }
    if (exclusion.removedLookupFieldApiName) { return RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_WITH_PREFIX + exclusion.objectApiName + '.' + exclusion.removedLookupFieldApiName; }
    return RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_WITH_PREFIX + (exclusion.excludedParentObjectApiName || '');

}

function describeOutOfRun(exclusion: IExclusion): string {
    return exclusion.kind === 'excluded' ? RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_TEXT : RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_WITH_PREFIX + (exclusion.excludedParentObjectApiName || '');
}

// ✕ ON THE ROOT ASKS FIRST: WITHOUT IT NOTHING IS LEFT
function removeObject(objectApiName: string): void {

    if (!customTreecipeDialog) { return; }
    if (customTreecipeDialog.objects.length > 0 && customTreecipeDialog.objects[0].objectApiName === objectApiName) {
        customTreecipeDialog.isRootRemovalAsked = true;
        drawCustomTreecipeDialog();
        return;
    }
    changeRemoval(function (dialog) {
        dialog.removedObjects.add(objectApiName);
        dialog.outOfRunObjects.delete(objectApiName);
    });

}

/*
    One object row: ✕ (or the ↺ that undoes what removed it), the chain link, the chevron, the name
    with its lookups and what happened to it, and its kept field count. A row removed by its own
    lookup or fields has its ↺ here, since its fields are folded away.
*/
function buildObjectRow(dialog: ICustomTreecipeDialog, shownObject: IShownObject, isListShown: boolean): HTMLElement {

    const dialogObject = shownObject.dialogObject;
    const objectApiName = dialogObject.objectApiName;
    const removal = dialog.preview ? dialog.preview.removedByObject.get(objectApiName) : undefined;
    const outOfRun = !removal && dialog.preview ? dialog.preview.outOfRunByObject.get(objectApiName) : undefined;
    const isDirectlyRemoved = dialog.removedObjects.has(objectApiName);
    // A TWO-LINE ROW HEADER (#558): LINE 1 ✕, 🔗, ›, THE NAME AND ITS COUNT; LINE 2 ITS LOOKUPS AND WHAT HAPPENED TO IT. THE › SITS BESIDE THE CHAIN, AS #677 ASKED
    const rowElement = createElement('div', 'customTreecipeObject sdtRowHeader' + (removal || isDirectlyRemoved ? ' isRemoved' : outOfRun ? ' isOutOfRun' : ''));
    const primaryElement = createElement('div', 'sdtRowHeaderPrimary customTreecipeObjectPrimary');
    const detailElement = createElement('div', 'sdtRowHeaderDetail customTreecipeObjectDetail');
    rowElement.appendChild(primaryElement);

    if (isDirectlyRemoved) {
        primaryElement.appendChild(buildRoundButton('customTreecipeRestore', '↺', 'Restore ' + objectApiName, 'object:' + objectApiName, function () {
            changeRemoval(function (changedDialog) { changedDialog.removedObjects.delete(objectApiName); });
        }));
    } else if (removal && removal.removedLookupFieldApiName) {
        const lookupFieldApiName = removal.removedLookupFieldApiName;
        primaryElement.appendChild(buildRoundButton('customTreecipeRestore', '↺', 'Restore ' + objectApiName + '.' + lookupFieldApiName, 'object:' + objectApiName, function () {
            changeRemoval(function (changedDialog) { removedFieldsOf(changedDialog, objectApiName).delete(lookupFieldApiName); });
        }));
    } else if (removal && removal.kind === 'noFieldsSelected') {
        primaryElement.appendChild(buildRoundButton('customTreecipeRestore', '↺', 'Restore every field of ' + objectApiName, 'object:' + objectApiName, function () {
            changeRemoval(function (changedDialog) { changedDialog.removedFields.delete(objectApiName); });
        }));
    } else if (removal) {
        primaryElement.appendChild(createElement('span', 'customTreecipeSlot'));
    } else {
        primaryElement.appendChild(buildRoundButton('customTreecipeRemove', '✕', 'Remove ' + objectApiName + ' from the new recipe', 'object:' + objectApiName, function () { removeObject(objectApiName); }));
    }

    const isOutDirectly = dialog.outOfRunObjects.has(objectApiName);
    const chainElement = createButton('icon', 'customTreecipeChain');
    const chainLabel = isOutDirectly ? objectApiName + ': left out of a run. Click to include it' : objectApiName + ': included in a run. Click to leave it out';
    chainElement.setAttribute('aria-label', chainLabel);
    chainElement.setAttribute('title', chainLabel);
    chainElement.setAttribute('aria-pressed', isOutDirectly || outOfRun ? 'false' : 'true');
    chainElement.disabled = !!removal || isDirectlyRemoved || (!!outOfRun && !isOutDirectly);
    chainElement.appendChild(buildGlyph('treeGlyph', isOutDirectly || outOfRun || removal || isDirectlyRemoved ? RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH : RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH, RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM));
    chainElement.addEventListener('click', function () {
        changeRemoval(function (changedDialog) {
            if (isOutDirectly) { changedDialog.outOfRunObjects.delete(objectApiName); } else { changedDialog.outOfRunObjects.add(objectApiName); }
        });
    });
    primaryElement.appendChild(addControl(chainElement, 'chain:' + objectApiName));

    const isExpanded = isListShown;
    const chevronElement = createButton('icon', 'customTreecipeChevron' + (isExpanded ? ' isExpanded' : ''));
    const chevronLabel = (isExpanded ? 'Hide' : 'Show') + ' the fields of ' + objectApiName;
    chevronElement.setAttribute('aria-label', chevronLabel);
    chevronElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    chevronElement.disabled = !!removal || isDirectlyRemoved;
    chevronElement.appendChild(buildGlyph('customTreecipeChevronGlyph', RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH));
    chevronElement.addEventListener('click', function () {
        if (!customTreecipeDialog) { return; }
        const toggledObjects = readSearchText(customTreecipeDialog) === '' ? customTreecipeDialog.expandedObjects : customTreecipeDialog.searchToggledObjects;
        if (toggledObjects.has(objectApiName)) { toggledObjects.delete(objectApiName); } else { toggledObjects.add(objectApiName); }
        drawCustomTreecipeDialog();
    });
    primaryElement.appendChild(addControl(chevronElement, 'chevron:' + objectApiName));

    primaryElement.appendChild(createElement('span', 'customTreecipeObjectName', objectApiName));

    const keptFieldCount = removal || isDirectlyRemoved ? 0 : countKeptFields(dialog, dialogObject);
    primaryElement.appendChild(createElement('span', 'customTreecipeFieldCount muted', keptFieldCount + ' of ' + dialogObject.fields.length + ' fields'));

    // THE ROW'S BULK ✕ FOR ITS OPEN LIST (#711), LAST ON LINE 1 AS #558 PUTS A ROW'S ACTIONS: NO QUESTION, SINCE ONE ↺ ON THE OBJECT UNDOES IT
    if (isListShown) {
        const removableFieldApiNames = listRemovableShownFieldApiNames(dialog, shownObject);
        const removeEveryElement = addControl(createButton('secondary', 'customTreecipeRemoveEveryField', describeRemoveEveryField(shownObject), 'compact'), 'fields:' + objectApiName);
        removeEveryElement.disabled = removableFieldApiNames.length === 0;
        removeEveryElement.addEventListener('click', function () {
            changeRemoval(function (changedDialog) { removeFields(changedDialog, objectApiName, removableFieldApiNames); });
        });
        primaryElement.appendChild(removeEveryElement);
    }

    if (dialogObject.parentLookups.length > 0) {
        detailElement.appendChild(createElement('span', 'customTreecipeLookups muted', dialogObject.parentLookups.map(function (lookup) { return lookup.fieldApiName + ' → ' + lookup.parentObjectApiName; }).join(', ')));
    }
    if (removal || isDirectlyRemoved) {
        detailElement.appendChild(createElement('span', 'customTreecipeState', removal ? describeRemoval(removal) : RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_TEXT));
    } else if (outOfRun) {
        detailElement.appendChild(createElement('span', 'customTreecipeState', describeOutOfRun(outOfRun)));
    }
    if (detailElement.children.length > 0) { rowElement.appendChild(detailElement); }

    return rowElement;

}

function describeRemoveEveryField(shownObject: IShownObject): string {
    const prefix = shownObject.shownFields.length === shownObject.dialogObject.fields.length ? RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_EVERY_FIELD_PREFIX : RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_SHOWN_FIELDS_PREFIX;
    return prefix + shownObject.dialogObject.objectApiName;
}

function countKeptFields(dialog: ICustomTreecipeDialog, dialogObject: IDialogObject): number {

    const removedFields = removedFieldsOf(dialog, dialogObject.objectApiName);
    return dialogObject.fields.filter(function (field) {
        return !removedFields.has(field.fieldApiName) && !(dialog.preview && dialog.preview.cutLookupKeys.has(dialogObject.objectApiName + '\n' + field.fieldApiName));
    }).length;

}

/*
    How tall a field list not yet drawn is (#693): its field count rounded up to one of these, each a
    rule in CustomTreecipeDialog.css at 2.35rem a row: a one-line field row's 1.7rem ✕, its 0.25rem
    padding above and below, and the 0.15rem gap to the next. A class,
    since the panel sets no inline style; one height for every list would move the scroll bar under
    the reader, and one at most twice too tall does not.
*/
const CUSTOM_TREECIPE_FIELD_LIST_SIZE_FIELD_COUNTS = [8, 16, 32, 64, 128, 256, 512, 1024];

function customTreecipeFieldListSizeClassName(fieldCount: number): string {
    const sizeFieldCount = CUSTOM_TREECIPE_FIELD_LIST_SIZE_FIELD_COUNTS.find(function (candidate) { return fieldCount <= candidate; })
        || CUSTOM_TREECIPE_FIELD_LIST_SIZE_FIELD_COUNTS[CUSTOM_TREECIPE_FIELD_LIST_SIZE_FIELD_COUNTS.length - 1];
    return 'fieldCountUpTo' + sizeFieldCount;
}

// ONE OBJECT'S FIELDS, EACH WITH ITS ✕; A LOCK THE CARD HOLDS (RecordTypeId, A CONTROLLING FIELD) TURNS ITS ✕ OFF WITH THE REASON
function buildFieldList(dialog: ICustomTreecipeDialog, shownObject: IShownObject): HTMLElement {

    const dialogObject = shownObject.dialogObject;
    const objectApiName = dialogObject.objectApiName;
    // A BORDERED ROW BOX (#558): THE OBJECT'S FIELDS, EDITED IN PLACE UNDER IT
    const listElement = createElement('ul', 'treeFieldsBox customTreecipeFields ' + customTreecipeFieldListSizeClassName(shownObject.shownFields.length));
    listElement.setAttribute('aria-label', 'Fields of ' + objectApiName);
    const removedFields = removedFieldsOf(dialog, objectApiName);
    const lockedFields = dialog.preview ? dialog.preview.lockedFieldsByObject.get(objectApiName) : undefined;

    shownObject.shownFields.forEach(function (field) {

        const qualifiedName = objectApiName + '.' + field.fieldApiName;
        const isRemoved = removedFields.has(field.fieldApiName);
        const isCut = !isRemoved && !!dialog.preview && dialog.preview.cutLookupKeys.has(objectApiName + '\n' + field.fieldApiName);
        const lockReason = !isRemoved && lockedFields ? lockedFields.get(field.fieldApiName) : undefined;
        const lookup = dialogObject.parentLookups.find(function (candidate) { return candidate.fieldApiName === field.fieldApiName; });
        const fieldElement = createElement('li', 'treeField customTreecipeField' + (isRemoved ? ' isRemoved' : isCut ? ' isCut' : ''));

        if (isRemoved) {
            fieldElement.appendChild(buildRoundButton('customTreecipeRestore isSmall', '↺', 'Restore ' + qualifiedName, 'field:' + qualifiedName, function () {
                changeRemoval(function (changedDialog) { removedFieldsOf(changedDialog, objectApiName).delete(field.fieldApiName); });
            }));
        } else {
            const removeLabel = lockReason ? field.fieldApiName + ' cannot be removed: ' + lockReason
                : isCut ? field.fieldApiName + ' goes with ' + (lookup ? lookup.parentObjectApiName : 'its parent')
                : 'Remove ' + qualifiedName + ' from the new recipe';
            const removeElement = buildRoundButton('customTreecipeRemove isSmall', '✕', removeLabel, 'field:' + qualifiedName, function () {
                changeRemoval(function (changedDialog) {
                    changedDialog.removedFields.set(objectApiName, removedFieldsOf(changedDialog, objectApiName).add(field.fieldApiName));
                });
            });
            removeElement.disabled = !!lockReason || isCut;
            fieldElement.appendChild(removeElement);
        }

        const nameElement = createElement('span', 'customTreecipeFieldName');
        nameElement.appendChild(createElement('span', 'customTreecipeFieldApiName', field.fieldApiName));
        nameElement.appendChild(createElement('span', 'customTreecipeFieldType muted', (field.fieldTypeWithSize || field.fieldType) + (lookup ? ' → ' + lookup.parentObjectApiName : '')));
        fieldElement.appendChild(nameElement);
        fieldElement.appendChild(createElement('span', 'customTreecipeFieldState muted', isRemoved ? 'Removed' : isCut ? 'Removed with ' + (lookup ? lookup.parentObjectApiName : 'its parent') : lockReason ? 'Kept: ' + lockReason : ''));

        listElement.appendChild(fieldElement);

    });

    return listElement;

}

function buildRootConfirmation(dialog: ICustomTreecipeDialog): HTMLElement {

    const rootObjectApiName = dialog.objects[0].objectApiName;
    const boxElement = createElement('div', 'customTreecipeAsk');
    boxElement.setAttribute('role', 'alert');
    boxElement.appendChild(createElement('span', 'customTreecipeAskTitle', 'Remove ' + rootObjectApiName + '?'));
    boxElement.appendChild(createElement('span', '', rootObjectApiName + ' is the root of this tree. Removing it removes every object under it, so nothing is left to save.'));
    const actionsElement = createElement('div', 'customTreecipeAskActions');
    const keepElement = addControl(createButton('secondary', 'customTreecipeKeepRoot', 'Keep ' + rootObjectApiName), 'root:keep');
    keepElement.addEventListener('click', function () {
        if (!customTreecipeDialog) { return; }
        customTreecipeDialog.isRootRemovalAsked = false;
        drawCustomTreecipeDialog();
    });
    const removeElement = addControl(createButton('secondary', 'customTreecipeRemoveRoot', 'Remove ' + rootObjectApiName), 'root:remove');
    removeElement.addEventListener('click', function () {
        changeRemoval(function (changedDialog) {
            changedDialog.isRootRemovalAsked = false;
            changedDialog.removedObjects.add(rootObjectApiName);
            changedDialog.outOfRunObjects.delete(rootObjectApiName);
        });
    });
    actionsElement.appendChild(keepElement);
    actionsElement.appendChild(removeElement);
    boxElement.appendChild(actionsElement);
    return boxElement;

}

function countRemovedFields(dialog: ICustomTreecipeDialog): number {
    let removedFieldCount = 0;
    dialog.removedFields.forEach(function (fieldApiNames) { removedFieldCount += fieldApiNames.size; });
    return removedFieldCount;
}

// THE SAVE STEP INSIDE THE MODAL: WHERE IT GOES, WHAT IT KEEPS, AN OPTIONAL NAME; SAVE POSTS, AND THE HOST PLANS AGAIN
function buildSaveForm(dialog: ICustomTreecipeDialog): HTMLElement {

    // A REGION, NOT A <form>: A FORM'S Enter WOULD TRY TO NAVIGATE THE WEBVIEW, WHICH ITS CSP REFUSES
    const formElement = createElement('div', 'customTreecipeSaveForm');
    formElement.setAttribute('role', 'region');
    formElement.setAttribute('aria-label', RECIPE_COCKPIT_CUSTOM_TREECIPE_SAVE_LABEL);
    formElement.appendChild(createElement('span', 'customTreecipeAskTitle', RECIPE_COCKPIT_CUSTOM_TREECIPE_SAVE_LABEL));

    const detailsElement = createElement('dl', 'customTreecipeSaveDetails');
    const preview = dialog.preview;
    [
        ['Folder', preview && preview.folderName ? preview.folderName : '—'],
        ['Copy of', dialog.tree.folderName || ''],
        ['Keeps', (preview ? preview.keptObjectCount : dialog.objects.length) + ' of ' + dialog.objects.length + ' objects, ' + countRemovedFields(dialog) + ' field(s) removed']
    ].forEach(function (pair) {
        detailsElement.appendChild(createElement('dt', 'muted', pair[0]));
        detailsElement.appendChild(createElement('dd', '', pair[1]));
    });
    const nameLabelElement = createElement('dt', 'muted', RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_LABEL);
    const nameCellElement = createElement('dd');
    const nameInputElement = createElement('input', 'customTreecipeNameInput');
    nameInputElement.setAttribute('id', 'customTreecipeName');
    nameInputElement.setAttribute('maxlength', '80');
    nameInputElement.setAttribute('placeholder', RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_PLACEHOLDER);
    nameInputElement.setAttribute('aria-label', RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_LABEL);
    nameInputElement.value = dialog.typedName;
    nameInputElement.addEventListener('input', function () {
        if (customTreecipeDialog) { customTreecipeDialog.typedName = nameInputElement.value; }
    });
    nameLabelElement.setAttribute('id', 'customTreecipeNameLabel');
    nameCellElement.appendChild(addControl(nameInputElement, 'save:name'));
    detailsElement.appendChild(nameLabelElement);
    detailsElement.appendChild(nameCellElement);
    formElement.appendChild(detailsElement);
    dialog.nameInputElement = nameInputElement;

    const actionsElement = createElement('div', 'customTreecipeAskActions');
    const backElement = addControl(createButton('secondary', 'customTreecipeBack', RECIPE_COCKPIT_CUSTOM_TREECIPE_BACK_LABEL), 'save:back');
    backElement.setAttribute('type', 'button');
    backElement.addEventListener('click', function () {
        if (!customTreecipeDialog) { return; }
        customTreecipeDialog.step = 'edit';
        drawCustomTreecipeDialog();
    });
    const confirmElement = addControl(createButton('primary', 'customTreecipeConfirmSave', RECIPE_COCKPIT_CUSTOM_TREECIPE_CONFIRM_SAVE_LABEL), 'save:confirm');
    confirmElement.setAttribute('type', 'button');
    confirmElement.disabled = !preview || !preview.folderName || !!preview.refusal;
    actionsElement.appendChild(backElement);
    actionsElement.appendChild(confirmElement);
    formElement.appendChild(actionsElement);

    const postSave = function () {
        if (!customTreecipeDialog || confirmElement.disabled) { return; }
        const message = buildRemovalMessage(customTreecipeDialog);
        message.command = 'saveCustomTreecipe';
        message.name = nameInputElement.value;
        vscodeApi.postMessage(message);
        // THE HOST'S NOTIFICATION SAYS HOW IT ENDED, AND A SAVE OPENS THE NEW TREE IN ITS OWN ENTRY
        closeCustomTreecipeDialog(true);
    };
    confirmElement.addEventListener('click', postSave);
    nameInputElement.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') { return; }
        if (typeof event.preventDefault === 'function') { event.preventDefault(); }
        postSave();
    });

    return formElement;

}

function focusWithoutScrolling(element: HTMLElement): void {
    if (typeof element.focus === 'function') { element.focus({ preventScroll: true }); }
}

/*
    The body's rows put in place with as little moved as possible: a row drawn last time stays where it
    is, a row no longer drawn is taken out, and a new or rebuilt one is put in at its place, so the
    browser lays out what changed rather than every row of every open object. Rows keep their order
    from draw to draw, so a kept row never has to move.
*/
function placeBodyElements(bodyElement: HTMLElement, nextElements: HTMLElement[]): void {

    const keptElements = new Set(nextElements);
    (Array.prototype.slice.call(bodyElement.children) as HTMLElement[]).forEach(function (previousElement) {
        if (!keptElements.has(previousElement)) { bodyElement.removeChild(previousElement); }
    });

    nextElements.forEach(function (element, elementIndex) {
        const elementAtIndex = bodyElement.children[elementIndex] as HTMLElement | undefined;
        if (elementAtIndex !== element) { bodyElement.insertBefore(element, elementAtIndex || null); }
    });

}

// EVERYTHING buildObjectRow READS: THE SAME SIGNATURE IS THE SAME ROW, SO IT IS REUSED
function signatureOfObjectRow(dialog: ICustomTreecipeDialog, shownObject: IShownObject, isListShown: boolean): string {

    const dialogObject = shownObject.dialogObject;
    const objectApiName = dialogObject.objectApiName;
    const preview = dialog.preview;

    return JSON.stringify([
        !!preview,
        dialog.removedObjects.has(objectApiName),
        dialog.outOfRunObjects.has(objectApiName),
        isListShown,
        preview ? preview.removedByObject.get(objectApiName) || null : null,
        preview ? preview.outOfRunByObject.get(objectApiName) || null : null,
        countKeptFields(dialog, dialogObject),
        isListShown ? [describeRemoveEveryField(shownObject), listRemovableShownFieldApiNames(dialog, shownObject)] : null
    ]);

}

// EVERYTHING buildFieldList READS, AND NOTHING ELSE: A CHAIN OR AN OBJECT'S ✕ AND ↺ LEAVE IT THE SAME, SO THE FIELDS UNDER THEM ARE REUSED
function signatureOfFieldList(dialog: ICustomTreecipeDialog, shownObject: IShownObject): string {

    const dialogObject = shownObject.dialogObject;
    const objectApiName = dialogObject.objectApiName;
    const preview = dialog.preview;
    const lockedFields = preview ? preview.lockedFieldsByObject.get(objectApiName) : undefined;

    return JSON.stringify([
        !!preview,
        Array.from(removedFieldsOf(dialog, objectApiName)).sort(),
        lockedFields ? Array.from(lockedFields.entries()).sort() : [],
        dialogObject.fields.filter(function (field) { return !!preview && preview.cutLookupKeys.has(objectApiName + '\n' + field.fieldApiName); }).map(function (field) { return field.fieldApiName; }),
        shownObject.shownFields.length === dialogObject.fields.length ? null : shownObject.shownFields.map(function (field) { return field.fieldApiName; })
    ]);

}

// THE ELEMENT DRAWN LAST TIME WHEN ITS SIGNATURE IS UNCHANGED, ELSE A NEW ONE; EITHER WAY ITS CONTROLS JOIN THE TAB ORDER HERE
function reuseOrBuild(dialog: ICustomTreecipeDialog, drawnByObject: Map<string, IDrawnElement>, objectApiName: string, signature: string, build: () => HTMLElement): HTMLElement {

    const drawnElement = drawnByObject.get(objectApiName);
    if (drawnElement && drawnElement.signature === signature) {
        drawnElement.controls.forEach(function (control) { dialog.controls.push(control); });
        return drawnElement.element;
    }

    const firstControlIndex = dialog.controls.length;
    const element = build();
    drawnByObject.set(objectApiName, { signature: signature, element: element, controls: dialog.controls.slice(firstControlIndex) });
    return element;

}

function hasRemovals(dialog: ICustomTreecipeDialog): boolean {
    return dialog.removedObjects.size > 0 || countRemovedFields(dialog) > 0;
}

function drawCustomTreecipeDialog(): void {

    const dialog = customTreecipeDialog;
    if (!dialog) { return; }

    const preview = dialog.preview;
    const keptObjectCount = preview ? preview.keptObjectCount : dialog.objects.length;
    const keptFieldCount = dialog.objects.reduce(function (total, dialogObject) {
        const isRemoved = dialog.removedObjects.has(dialogObject.objectApiName) || (!!preview && preview.removedByObject.has(dialogObject.objectApiName));
        return total + (isRemoved ? 0 : countKeptFields(dialog, dialogObject));
    }, 0);
    const totalFieldCount = dialog.objects.reduce(function (total, dialogObject) { return total + dialogObject.fields.length; }, 0);
    dialog.summaryElement.textContent = 'New recipe keeps ' + keptObjectCount + ' of ' + dialog.objects.length + ' objects · ' + keptFieldCount + ' of ' + totalFieldCount + ' fields';

    const focusedControl = dialog.controls.find(function (control) { return control.element === document.activeElement; });
    const focusedKey = focusedControl ? focusedControl.key : null;
    const focusedToolbarControl = dialog.toolbar.controls.find(function (control) { return control.element === document.activeElement; });
    const scrollTop = dialog.bodyElement.scrollTop;
    dialog.nameInputElement = null;
    dialog.controls = [];
    const nextElements: HTMLElement[] = [];

    if (dialog.isRootRemovalAsked) { nextElements.push(buildRootConfirmation(dialog)); }
    if (dialog.isEveryFieldRemovalAsked) { nextElements.push(buildEveryFieldConfirmation(dialog)); }

    const shownObjects = listShownObjects(dialog);
    if (shownObjects.length === 0) {
        nextElements.push(createElement('p', 'customTreecipeNoMatch muted', RECIPE_COCKPIT_CUSTOM_TREECIPE_NO_MATCH_PREFIX + '"' + dialog.searchText.trim() + '".'));
    }
    shownObjects.forEach(function (shownObject) {
        const dialogObject = shownObject.dialogObject;
        const objectApiName = dialogObject.objectApiName;
        const isListShown = isFieldListShown(dialog, shownObject);
        nextElements.push(reuseOrBuild(dialog, dialog.rowsByObject, objectApiName, signatureOfObjectRow(dialog, shownObject, isListShown), function () { return buildObjectRow(dialog, shownObject, isListShown); }));
        if (isListShown) {
            nextElements.push(reuseOrBuild(dialog, dialog.fieldListsByObject, objectApiName, signatureOfFieldList(dialog, shownObject), function () { return buildFieldList(dialog, shownObject); }));
        }
    });

    if (dialog.step === 'save') { nextElements.push(buildSaveForm(dialog)); }
    placeBodyElements(dialog.bodyElement, nextElements);
    drawToolbar(dialog);

    const isNothingLeft = keptObjectCount === 0;
    if (dialog.step === 'edit') { dialog.saveElement.classList.remove('hidden'); } else { dialog.saveElement.classList.add('hidden'); }
    dialog.saveElement.disabled = !hasRemovals(dialog) || isNothingLeft || !preview || !!preview.refusal;
    dialog.statusElement.textContent = isNothingLeft ? RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_LEFT_NOTE
        : !hasRemovals(dialog) ? RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_REMOVED_NOTE
        : preview && preview.refusal ? preview.refusal
        : preview && preview.folderName ? 'Ready to save as ' + preview.folderName + '.'
        : '';

    // A REDRAW KEEPS THE READER'S PLACE: THE CONTROL THAT WAS FOCUSED, BY ITS KEY, OR THE NAME BOX ON THE SAVE STEP
    // THE BODY KEEPS ITS SCROLL, AND FOCUS RETURNS WITHOUT SCROLLING, SO A ✕ DEEP IN A LONG LIST LEAVES THE READER WHERE THEY WERE
    dialog.bodyElement.scrollTop = scrollTop;
    if (dialog.step === 'save' && dialog.nameInputElement) {
        focusWithoutScrolling(dialog.nameInputElement);
    } else if ((focusedToolbarControl && focusedToolbarControl.element.disabled) || (focusedKey && focusedKey.indexOf('everyField:') === 0)) {
        focusWithoutScrolling(dialog.toolbar.searchElement);
    } else if (focusedKey) {
        const enabledControls = dialog.controls.filter(function (control) { return !control.element.disabled; });
        const sameControl = enabledControls.find(function (control) { return control.key === focusedKey; })
            || enabledControls.find(function (control) { return control.key.split(':')[1] === focusedKey.split(':')[1]; });
        focusWithoutScrolling(sameControl ? sameControl.element : dialog.saveElement);
    }

}

