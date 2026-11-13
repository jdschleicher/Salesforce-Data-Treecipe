import { createButton, createElement, drawToggle, setShown, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_ADAPTER_APPLY_LABEL,
    RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE,
    RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_INTRO,
    RECIPE_COCKPIT_UPDATER_LOAD_LABEL,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_NEXT_LABEL,
    RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN,
    RECIPE_COCKPIT_UPDATER_PARENT_SELECT_LABEL,
    RECIPE_COCKPIT_UPDATER_PARENT_STEP_HEADING,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NONE_NOTE,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NOTE_PREFIX,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE,
    RECIPE_COCKPIT_UPDATER_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_SNAPSHOTS_HEADING,
    RECIPE_COCKPIT_UPDATER_STRUCTURE_STEP_HEADING_PREFIX,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_FIELD_TYPES,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON,
    RECIPE_COCKPIT_UPDATER_UPDATE_LABEL,
    RECIPE_COCKPIT_UPDATER_WHERE_PLACEHOLDER
} from '../../RecipeCockpitAdapterConstants';
import { buildActionCard, buildTabSearch, buildToggleElement } from '../RecipeCockpitPanelBuilders';
import { applyAdapterMetadataChanges, drawAdapterFieldOrgChip, drawAdapterObjectOrgOnlyFields, requestAdapterMetadataRetrieve, requestAdapterRetrievedFilesApply } from './AdapterRetrieve';
import { buildAdapterChildBlock } from './AdapterChild';
import { buildUpdaterFieldEditElement, drawUpdaterFieldEdit } from './AdapterFieldEditor';
import { applyUpdaterRecords, applyUpdaterValues, drawUpdaterLoadButtons, drawUpdaterObjectRecords, drawUpdaterObjectValues, requestUpdaterRecords, requestUpdaterUpdate, requestUpdaterValues } from './AdapterLoadAndUpdate';
import type {
    AdapterOrgOnlyRowState,
    IAdapterField,
    IAdapterOrgOnlyFieldState,
    IAdapterTree,
    IAdapterTreeObject,
    IAdapterTreeObjectState,
    IAdapterTreeState,
    IUpdaterFieldObjectState,
    IUpdaterFieldRowState,
    IUpdaterFieldTreeState,
    IUpdaterObjectState
} from './AdapterTypes';

/*
    The Treecipe Adapter tab (#415, #443, #641): its two steps, the objects and field rows of step 2,
    the summary and the filter. These names are the panel script's own, read when a function runs.
*/
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function indexTreeLookupFields(tree: IAdapterTree): Record<string, true>;
declare function displayTitleOf(tree: unknown): string;
declare function savePanelPlace(): void;
declare function buildSourceLink(className: string, labelText: string, filePath: string, lineNumber: number): HTMLElement;
declare function formatParentLookups(treeObject: IAdapterTreeObject, disabledFieldApiNames?: string[]): string;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function expandMatchesWithinBudget<GroupState>(groupStates: GroupState[], matchCountOf: (groupState: GroupState) => number, rowCountOf: (groupState: GroupState) => number, setExpanded: (groupState: GroupState, isExpanded: boolean) => void): void;
// THE TREECIPE TAB'S FIXED-VALUE RULES, WHICH ITS SLICE (#643) MOVES
declare const FIXED_VALUE_LOOKUP_FIELD_TYPES: string[];
declare const FIXED_VALUE_DEPENDENT_REASON_PREFIX: string;
// RecipeCockpitTreeUpdaterQuery.ts HOLDS THE LIMIT BESIDE ITS CHECK AND IMPORTS OTHER HOST FILES, SO THE SHELL PASSES THE NUMBER IN
declare const UPDATER_WHERE_MAX_LENGTH: number;

/*
    The Treecipe Adapter tab (#415, #443): step 2 draws the parent and its descendants in insert
    order, each once (an iteration is the same object), with its lookups and its field rows as
    the Treecipe tab draws them, and one box per field to choose it. Choosing posts nothing: the
    choice is the panel's, kept in the place.
*/
export function updaterFieldKeyOf(objectApiName: string, fieldApiName: string): string {
    return objectApiName + '\n' + fieldApiName;
}

function findUpdaterFieldLockReason(tree: IAdapterTree, objectApiName: string, field: IAdapterField): string {

    if (field.isOnlyInRecipeFile) { return RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON; }
    if (field.fieldApiName === 'RecordTypeId') { return RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON; }

    const isTreeLookup = hasOwnKey(indexTreeLookupFields(tree), objectApiName + '\n' + field.fieldApiName);
    if (isTreeLookup || FIXED_VALUE_LOOKUP_FIELD_TYPES.indexOf(String(field.fieldType)) !== -1) { return RECIPE_COCKPIT_UPDATER_LOOKUP_REASON; }
    if (field.controllingField) { return FIXED_VALUE_DEPENDENT_REASON_PREFIX + field.controllingField; }
    if (RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_FIELD_TYPES.indexOf(String(field.fieldType)) !== -1) { return RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON; }

    return '';

}

/*
    The Adapter's two steps (#443). Step 1 chooses the parent object, starting on the card's root,
    and the WHERE for the parent records expected. Step 2 draws the tree rooted at that parent,
    under the filter, with Change parent back to step 1. The step, the parent and its WHERE are
    the panel's, kept in the place; moving between the steps posts nothing.
*/
export function buildUpdaterTab(treeState: IAdapterTreeState, panelElement: HTMLElement): void {

    treeState.updaterCardObjectApiNames = listUpdaterCardObjectApiNames(treeState);

    // A PLACE CAN NAME A PARENT THE CARD NO LONGER LISTS; THE TAB THEN OPENS ON STEP 1, ON THE ROOT
    if (treeState.updaterCardObjectApiNames.indexOf(treeState.updaterParentObjectApiName) === -1) {
        treeState.updaterParentObjectApiName = '';
        treeState.updaterStep = 'parent';
    }

    treeState.updaterParentStepElement = buildUpdaterParentStep(treeState);
    panelElement.appendChild(treeState.updaterParentStepElement);

    const structureElement = createElement('div', 'updaterStructureStep hidden');
    const headingRowElement = createElement('div', 'updaterStepHeadingRow');
    treeState.updaterStructureHeadingElement = createElement('div', 'updaterStepHeading');
    const changeParentElement = createButton('link', 'updaterChangeParent', RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL);
    changeParentElement.addEventListener('click', function () {
        treeState.updaterStep = 'parent';
        drawUpdaterStep(treeState);
        if (typeof treeState.updaterParentSelectElement.focus === 'function') { treeState.updaterParentSelectElement.focus(); }
        savePanelPlace();
    });
    headingRowElement.appendChild(treeState.updaterStructureHeadingElement);
    headingRowElement.appendChild(changeParentElement);
    structureElement.appendChild(headingRowElement);

    treeState.updaterParentWhereNoteElement = createElement('div', 'updaterParentWhereNote muted');
    structureElement.appendChild(treeState.updaterParentWhereNoteElement);

    // THE FILTER, AND BESIDE IT "Retrieve latest metadata" (#445), WHICH CAN BE PRESSED AT ANY TIME NO RUN HOLDS THE WINDOW
    const filterRowElement = createElement('div', 'updaterFilterRow');
    const updaterSearch = buildTabSearch(treeState, 'updater', RECIPE_COCKPIT_UPDATER_SEARCH_PLACEHOLDER, applyUpdaterFilter);
    treeState.updaterSearch = updaterSearch;
    filterRowElement.appendChild(updaterSearch.element);
    const retrieveMetadataElement = createButton('secondary', 'updaterRetrieveMetadata', RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL);
    treeState.updaterRetrieveMetadataElement = retrieveMetadataElement;
    retrieveMetadataElement.setAttribute('title', RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE);
    retrieveMetadataElement.addEventListener('click', function () { requestAdapterMetadataRetrieve(treeState); });
    filterRowElement.appendChild(retrieveMetadataElement);
    const orgChangesNoteElement = createElement('div', 'updaterOrgChangesNote muted hidden');
    treeState.updaterOrgChangesNoteElement = orgChangesNoteElement;
    structureElement.appendChild(filterRowElement);
    structureElement.appendChild(orgChangesNoteElement);
    // WHAT THE LAST RETRIEVE FOUND CAN BE COPIED INTO THE PROJECT; THE HOST PLANS AND ASKS
    const applyRetrievedElement = createButton('secondary', 'updaterApplyRetrieved hidden', RECIPE_COCKPIT_ADAPTER_APPLY_LABEL);
    treeState.updaterApplyRetrievedElement = applyRetrievedElement;
    applyRetrievedElement.addEventListener('click', function () { requestAdapterRetrievedFilesApply(treeState); });
    structureElement.appendChild(applyRetrievedElement);
    const orgHintsElement = createElement('div', 'updaterOrgHints hidden');
    treeState.updaterOrgHintsElement = orgHintsElement;
    structureElement.appendChild(orgHintsElement);

    structureElement.appendChild(createElement('div', 'updaterIntro muted', RECIPE_COCKPIT_UPDATER_INTRO));

    treeState.updaterSummaryElement = createElement('div', 'updaterSummary');
    structureElement.appendChild(treeState.updaterSummaryElement);

    const loadRowElement = createElement('div', 'updaterLoadRow');
    const cardsElement = createElement('div', 'updaterCards actionCards');
    treeState.updaterLoadCard = buildActionCard('loadUpdaterRecords', 'updaterLoad', RECIPE_COCKPIT_UPDATER_LOAD_LABEL);
    const loadButtonElement = treeState.updaterLoadCard.buttonElement;
    treeState.updaterLoadButtonElement = loadButtonElement;
    loadButtonElement.addEventListener('click', function () { requestUpdaterRecords(treeState); });
    treeState.updaterLoadNoteElement = createElement('span', 'updaterLoadNote muted');
    const generateCard = buildActionCard('generateUpdaterValues', 'updaterGenerate', RECIPE_COCKPIT_UPDATER_GENERATE_LABEL);
    treeState.updaterGenerateCard = generateCard;
    treeState.updaterGenerateButtonElement = generateCard.buttonElement;
    treeState.updaterGenerateButtonElement.addEventListener('click', function () { requestUpdaterValues(treeState); });
    const updateCard = buildActionCard('updateUpdaterRecords', 'updaterUpdate', RECIPE_COCKPIT_UPDATER_UPDATE_LABEL);
    treeState.updaterUpdateCard = updateCard;
    treeState.updaterUpdateButtonElement = updateCard.buttonElement;
    treeState.updaterUpdateButtonElement.addEventListener('click', function () { requestUpdaterUpdate(treeState); });
    cardsElement.appendChild(loadButtonElement);
    cardsElement.appendChild(treeState.updaterGenerateButtonElement);
    cardsElement.appendChild(treeState.updaterUpdateButtonElement);
    loadRowElement.appendChild(treeState.updaterLoadNoteElement);
    structureElement.appendChild(cardsElement);
    structureElement.appendChild(loadRowElement);

    treeState.updaterObjectsElement = createElement('div', 'updaterObjects');
    structureElement.appendChild(treeState.updaterObjectsElement);
    treeState.updaterStructureStepElement = structureElement;
    panelElement.appendChild(structureElement);

    // THE SNAPSHOTS EARLIER UPDATES SAVED (#419), LISTED BY NAME ONLY ON EITHER STEP; ASKED FOR EACH TIME THE TAB IS SELECTED
    const snapshotsElement = createElement('div', 'updaterSnapshots');
    snapshotsElement.appendChild(createElement('div', 'updaterSnapshotsHeading', RECIPE_COCKPIT_UPDATER_SNAPSHOTS_HEADING));
    const snapshotListElement = createElement('div', 'updaterSnapshotList');
    treeState.updaterSnapshotListElement = snapshotListElement;
    snapshotListElement.appendChild(createElement('div', 'updaterSnapshotsNote muted', 'Reading the saved old values…'));
    treeState.updaterSnapshotButtonElements = [];
    snapshotsElement.appendChild(snapshotListElement);
    panelElement.appendChild(snapshotsElement);

    treeState.updaterObjectStates = [];
    if (treeState.updaterStep === 'structure') { drawUpdaterStructure(treeState); }
    drawUpdaterStep(treeState);
    drawUpdaterLoadButtons();

}

// THE CARD'S OBJECTS IN INSERT ORDER, EACH ONCE: AN ITERATION IS THE SAME OBJECT
function listUpdaterCardObjectApiNames(treeState: IAdapterTreeState): string[] {

    const objectApiNames: string[] = [];
    treeState.objectStates.forEach(function (treeObjectState) {
        const objectApiName = treeObjectState.object.objectApiName;
        if (treeObjectState.isIteration || objectApiNames.indexOf(objectApiName) !== -1) { return; }
        objectApiNames.push(objectApiName);
    });

    return objectApiNames;

}

/*
    The parent and every object whose lookups, to parents in the tree, lead up to it: what step 2
    draws, and the host's RecipeCockpitTreeUpdaterQuery.planLoad, which refuses a load of any
    other set (#444). Only the card's drawn objects are walked through, as the host walks only
    objects with fields. A self-lookup is never followed.
*/
function indexUpdaterSubtree(treeState: IAdapterTreeState, parentObjectApiName: string): Record<string, true> {

    const tree = treeState.tree;
    const drawableObjectApiNames = treeState.updaterCardObjectApiNames;

    const subtreeObjectApiNames: Record<string, true> = Object.create(null);
    subtreeObjectApiNames[parentObjectApiName] = true;
    let isGrowing = true;

    while (isGrowing) {
        isGrowing = false;
        tree.objects.forEach(function (treeObject) {
            if (hasOwnKey(subtreeObjectApiNames, treeObject.objectApiName) || drawableObjectApiNames.indexOf(treeObject.objectApiName) === -1) { return; }
            const isUnderParent = treeObject.parentLookups.some(function (parentLookup) {
                return parentLookup.parentObjectApiName !== treeObject.objectApiName && hasOwnKey(subtreeObjectApiNames, parentLookup.parentObjectApiName);
            });
            if (!isUnderParent) { return; }
            subtreeObjectApiNames[treeObject.objectApiName] = true;
            isGrowing = true;
        });
    }

    return subtreeObjectApiNames;

}

function buildUpdaterParentStep(treeState: IAdapterTreeState): HTMLElement {

    const stepElement = createElement('div', 'updaterParentStep');
    const fieldsElement = createElement('div', 'updaterParentFields');
    const selectId = 'updaterParentSelect-' + treeState.tree.treeKey.replace(/[^A-Za-z0-9_-]/g, '_');
    const labelElement = createElement('label', 'updaterParentSelectLabel', RECIPE_COCKPIT_UPDATER_PARENT_SELECT_LABEL);
    const selectElement = createElement('select', 'updaterParentSelect');
    const whereInputElement = createElement('input', 'updaterParentWhereInput');
    const nextElement = createButton('primary', 'updaterNext', RECIPE_COCKPIT_UPDATER_NEXT_LABEL);
    const objectApiNames = treeState.updaterCardObjectApiNames;
    const chosenIndex = Math.max(0, objectApiNames.indexOf(treeState.updaterParentObjectApiName));

    stepElement.appendChild(createElement('div', 'updaterStepHeading', RECIPE_COCKPIT_UPDATER_PARENT_STEP_HEADING));

    selectElement.setAttribute('id', selectId);
    selectElement.setAttribute('aria-label', RECIPE_COCKPIT_UPDATER_PARENT_SELECT_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');
    labelElement.setAttribute('for', selectId);
    objectApiNames.forEach(function (objectApiName, optionIndex) {
        const optionElement = createElement('option', '', objectApiName);
        optionElement.value = String(optionIndex);
        optionElement.selected = optionIndex === chosenIndex;
        selectElement.appendChild(optionElement);
    });
    selectElement.value = objectApiNames.length > 0 ? String(chosenIndex) : '';
    selectElement.disabled = objectApiNames.length === 0;

    whereInputElement.setAttribute('type', 'text');
    whereInputElement.setAttribute('placeholder', RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER);
    whereInputElement.setAttribute('maxlength', String(UPDATER_WHERE_MAX_LENGTH));
    whereInputElement.setAttribute('aria-label', RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER);
    whereInputElement.value = treeState.updaterParentWhereText;
    whereInputElement.addEventListener('input', function () {
        treeState.updaterParentWhereText = String(whereInputElement.value || '');
        savePanelPlace();
    });

    nextElement.disabled = objectApiNames.length === 0;
    nextElement.addEventListener('click', function () {
        const optionIndex = /^[0-9]+$/.test(String(selectElement.value)) ? Number(selectElement.value) : -1;
        const objectApiName = objectApiNames[optionIndex];
        if (!objectApiName) { return; }
        treeState.updaterParentObjectApiName = objectApiName;
        treeState.updaterStep = 'structure';
        drawUpdaterStructure(treeState);
        drawUpdaterStep(treeState);
        savePanelPlace();
    });

    fieldsElement.appendChild(labelElement);
    fieldsElement.appendChild(selectElement);
    fieldsElement.appendChild(whereInputElement);
    fieldsElement.appendChild(nextElement);
    stepElement.appendChild(fieldsElement);

    if (objectApiNames.length === 0) {
        stepElement.appendChild(createElement('div', 'treeEmpty muted', 'This tree has no objects with a recipe.'));
    }

    treeState.updaterParentSelectElement = selectElement;
    treeState.updaterParentWhereInputElement = whereInputElement;

    return stepElement;

}

function drawUpdaterStep(treeState: IAdapterTreeState): void {

    const isStructure = treeState.updaterStep === 'structure';
    setShown(treeState.updaterParentStepElement, !isStructure);
    setShown(treeState.updaterStructureStepElement, isStructure);

}

// STEP 2'S OBJECTS, FOR THE PARENT CHOSEN NOW; A NEW PARENT REBUILDS THEM, AND THE RECORDS OR VALUES ON SCREEN ARE DRAWN ON WHAT IS LEFT
function drawUpdaterStructure(treeState: IAdapterTreeState): void {

    const parentObjectApiName = treeState.updaterParentObjectApiName;
    const subtreeObjectApiNames = indexUpdaterSubtree(treeState, parentObjectApiName);
    const drawnObjectApiNames: Record<string, true> = Object.create(null);
    const updaterObjectStates: IUpdaterObjectState[] = [];

    treeState.updaterObjectsElement.textContent = '';
    treeState.updaterObjectStates = updaterObjectStates;

    treeState.objectStates.forEach(function (treeObjectState) {
        const objectApiName = treeObjectState.object.objectApiName;
        if (treeObjectState.isIteration || hasOwnKey(drawnObjectApiNames, objectApiName) || !hasOwnKey(subtreeObjectApiNames, objectApiName)) { return; }
        drawnObjectApiNames[objectApiName] = true;
        updaterObjectStates.push(buildUpdaterObjectState(treeState, treeObjectState));
    });

    /*
        A PLACE CAN NAME A FIELD THE TREE NO LONGER HAS, OR ONE WHOSE BOX IS LOCKED NOW; NEITHER STAYS CHOSEN. A CHOICE ON
        ANOTHER OF THE CARD'S OBJECTS IS KEPT FOR WHEN IT IS DRAWN AGAIN, AND ONE ON AN OBJECT THE CARD NO LONGER LISTS IS NOT
    */
    const chosenFieldKeys: Record<string, true> = Object.create(null);
    const choosableOrgOnlyFieldKeys = listAdapterChoosableOrgOnlyFieldKeys(treeState);
    Object.keys(treeState.updaterChosenFieldKeys).forEach(function (fieldKey) {
        const objectApiName = fieldKey.split('\n')[0];
        if (!hasOwnKey(drawnObjectApiNames, objectApiName) && treeState.updaterCardObjectApiNames.indexOf(objectApiName) !== -1) { chosenFieldKeys[fieldKey] = true; }
        // A FIELD ONLY THE ORG HOLDS (#446) STAYS CHOSEN WHILE THE LAST RETRIEVE STILL OFFERS IT; applyAdapterMetadataChanges COUNTS IT
        if (hasOwnKey(drawnObjectApiNames, objectApiName) && hasOwnKey(choosableOrgOnlyFieldKeys, fieldKey)) { chosenFieldKeys[fieldKey] = true; }
    });
    updaterObjectStates.forEach(function (updaterObjectState) {
        updaterObjectState.fieldStates.forEach(function (fieldState) {
            if (!fieldState.lockReason && hasOwnKey(treeState.updaterChosenFieldKeys, fieldState.fieldKey)) {
                chosenFieldKeys[fieldState.fieldKey] = true;
                updaterObjectState.chosenFieldCount++;
            }
        });
    });
    treeState.updaterChosenFieldKeys = chosenFieldKeys;

    const expandedObjectKeys: Record<string, true> = Object.create(null);
    updaterObjectStates.forEach(function (updaterObjectState) {
        if (updaterObjectState.isExpandedByReader) { expandedObjectKeys[updaterObjectState.object.objectApiName] = true; }
    });
    treeState.updaterExpandedObjectKeys = expandedObjectKeys;

    updaterObjectStates.forEach(function (updaterObjectState) { treeState.updaterObjectsElement.appendChild(updaterObjectState.element); });

    treeState.updaterStructureHeadingElement.textContent = RECIPE_COCKPIT_UPDATER_STRUCTURE_STEP_HEADING_PREFIX + parentObjectApiName;
    drawUpdaterParentWhereNote(treeState);
    drawUpdaterSummary(treeState);
    applyUpdaterFilter(treeState);
    drawUpdaterLoadButtons();
    if (treeState.updaterRecordsMessage) { applyUpdaterRecords(treeState, treeState.updaterRecordsMessage); }
    if (treeState.updaterValuesMessage) { applyUpdaterValues(treeState, treeState.updaterValuesMessage); }
    applyAdapterMetadataChanges(treeState);
    // A BLOCK REPLAYED BEFORE THIS TAB WAS BUILT IS DRAWN NOW; ONE ALREADY DRAWN IS PUT BACK UNDER ITS ROW BY THE LINE ABOVE
    if (treeState.adapterChildBlockMessage && !treeState.adapterChild) { buildAdapterChildBlock(treeState); }

}

function drawUpdaterParentWhereNote(treeState: IAdapterTreeState): void {
    const whereText = treeState.updaterParentWhereText.trim();
    treeState.updaterParentWhereNoteElement.textContent = whereText ? RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NOTE_PREFIX + whereText : RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NONE_NOTE;
}

function buildUpdaterObjectState(treeState: IAdapterTreeState, treeObjectState: IAdapterTreeObjectState): IUpdaterObjectState {

    const object = treeObjectState.object;
    const objectElement = createElement('div', 'updaterObject');
    const headerElement = createElement('div', 'updaterObjectHeader');
    const toggleElement = buildToggleElement('updaterObjectToggle');

    const updaterObjectState: IUpdaterObjectState = {
        object: object,
        element: objectElement,
        toggleElement: toggleElement,
        bodyElement: createElement('div', 'updaterObjectBody hidden'),
        countElement: createElement('span', 'updaterObjectCount muted'),
        // WHAT THE LAST "Retrieve latest metadata" FOUND FOR THIS OBJECT (#445), ITS CHIP, AND ITS ORG-ONLY ROWS ONCE THE BODY IS BUILT
        orgChanges: null,
        orgChangesChipElement: createElement('span', 'updaterOrgChangeChip hidden'),
        orgOnlyFieldsElement: null,
        orgOnlyFieldStates: [],
        objectSearchText: object.objectApiName.toLowerCase(),
        isBodyBuilt: false,
        isExpanded: false,
        isExpandedByReader: hasOwnKey(treeState.updaterExpandedObjectKeys, object.objectApiName),
        matchingFieldCount: object.fields.length,
        chosenFieldCount: 0,
        countText: '',
        // WHAT THE LAST LOAD READ FOR THIS OBJECT (#416), AND ITS SECTION ONCE THE BODY IS BUILT
        loadedRecords: null,
        recordsElement: null,
        // WHAT THE LAST GENERATION MADE FOR THIS OBJECT (#417), AND ITS SECTION ONCE THE BODY IS BUILT
        generatedValues: null,
        valuesElement: null,
        fieldStates: object.fields.map(function (field) {
            return {
                field: field,
                fieldKey: updaterFieldKeyOf(object.objectApiName, field.fieldApiName),
                lockReason: findUpdaterFieldLockReason(treeState.tree, object.objectApiName, field),
                orgChange: null,
                orgChipElement: null,
                orgSearchText: '',
                // WHAT THE ROW DRAWS: NAME, LABEL, SIZED TYPE AND FAKER EXPRESSION
                searchText: [field.fieldApiName, field.fieldLabel, field.fieldTypeWithSize || field.fieldType, field.recipeValue].join('\n').toLowerCase(),
                isMatch: true,
                rowElement: null,
                chooseElement: null,
                editButtonElement: null,
                editBadgeElement: null,
                editedValueElement: null,
                expressionRowElement: null,
                editorElement: null,
                isEditorOpen: false
            };
        })
    };

    toggleElement.setAttribute('aria-expanded', 'false');
    toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
    toggleElement.addEventListener('click', function () {
        updaterObjectState.isExpandedByReader = !updaterObjectState.isExpanded;
        if (updaterObjectState.isExpandedByReader) {
            treeState.updaterExpandedObjectKeys[object.objectApiName] = true;
        } else {
            delete treeState.updaterExpandedObjectKeys[object.objectApiName];
        }
        setUpdaterObjectExpanded(treeState, updaterObjectState, updaterObjectState.isExpandedByReader, true);
        savePanelPlace();
    });

    headerElement.appendChild(toggleElement);
    headerElement.appendChild(buildSourceLink('updaterObjectName', object.objectApiName, object.recipeFilePath, object.lineNumber));

    const parentLookupsText = formatParentLookups(treeObjectState.treeObject);
    if (parentLookupsText) { headerElement.appendChild(createElement('span', 'treeLookups muted', parentLookupsText)); }

    headerElement.appendChild(updaterObjectState.countElement);
    headerElement.appendChild(updaterObjectState.orgChangesChipElement);

    objectElement.appendChild(headerElement);
    objectElement.appendChild(updaterObjectState.bodyElement);

    return updaterObjectState;

}

function setUpdaterObjectExpanded(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState, isExpanded: boolean, isAnimated: boolean): void {

    if (isExpanded && !updaterObjectState.isBodyBuilt) {
        // THE PARENT'S RECORDS ARE STEP 1'S WHERE, SO ONLY ITS DESCENDANTS TAKE ONE OF THEIR OWN
        if (updaterObjectState.object.objectApiName !== treeState.updaterParentObjectApiName) {
            updaterObjectState.bodyElement.appendChild(buildUpdaterWhereElement(treeState, updaterObjectState));
        }
        updaterObjectState.recordsElement = createElement('div', 'updaterRecords hidden');
        updaterObjectState.bodyElement.appendChild(updaterObjectState.recordsElement);
        drawUpdaterObjectRecords(updaterObjectState);
        updaterObjectState.valuesElement = createElement('div', 'updaterValues hidden');
        updaterObjectState.bodyElement.appendChild(updaterObjectState.valuesElement);
        drawUpdaterObjectValues(updaterObjectState);
        updaterObjectState.fieldStates.forEach(function (fieldState) {
            const rowElement = buildUpdaterFieldRow(treeState, updaterObjectState, fieldState);
            setShown(rowElement, fieldState.isMatch);
            updaterObjectState.bodyElement.appendChild(rowElement);
        });
        updaterObjectState.orgOnlyFieldsElement = createElement('div', 'updaterOrgOnlyFields');
        updaterObjectState.bodyElement.appendChild(updaterObjectState.orgOnlyFieldsElement);
        updaterObjectState.isBodyBuilt = true;
        drawAdapterObjectOrgOnlyFields(treeState, updaterObjectState);
    }

    setShownWithMotion(updaterObjectState.bodyElement, isExpanded, isAnimated);
    updaterObjectState.isExpanded = isExpanded;
    drawToggle(updaterObjectState.toggleElement, isExpanded, isAnimated);

}

// A ROW WITH A BOX: A RECIPE FIELD, A FIELD ONLY THE ORG HOLDS THAT THE HOST OFFERED (#446), OR A NEW CHILD'S FIELD (#447)
export function buildUpdaterFieldRow(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): HTMLElement {

    const field = fieldState.field;
    // A FIELD ONLY THE ORG HOLDS (#446) CARRIES THE FIELD CHANGE THE RETRIEVE FOUND
    const isOrgOnlyField = !!fieldState.fieldChange;
    const rowElement = createElement('div', isOrgOnlyField ? 'updaterField updaterOrgOnlyField' : 'updaterField');
    const headerElement = createElement('div', 'updaterFieldHeader');
    const chooseElement = createButton('check', 'updaterFieldChoose');

    chooseElement.setAttribute('role', 'checkbox');
    chooseElement.addEventListener('click', function () {
        if (chooseElement.disabled) { return; }
        // ONLY THIS BOX, ITS OBJECT'S COUNT AND THE SUMMARY CHANGE: A CHOICE CHANGES NO MATCH, SO NO ROW OPENS OR CLOSES
        if (hasOwnKey(treeState.updaterChosenFieldKeys, fieldState.fieldKey)) {
            delete treeState.updaterChosenFieldKeys[fieldState.fieldKey];
            updaterObjectState.chosenFieldCount--;
        } else {
            treeState.updaterChosenFieldKeys[fieldState.fieldKey] = true;
            updaterObjectState.chosenFieldCount++;
        }
        drawUpdaterFieldChoice(treeState, updaterObjectState, fieldState);
        drawUpdaterObjectCount(updaterObjectState);
        drawUpdaterSummary(treeState);
        drawUpdaterLoadButtons();
        savePanelPlace();
    });
    fieldState.chooseElement = chooseElement;

    headerElement.appendChild(chooseElement);
    if (!fieldState.lockReason) { headerElement.appendChild(buildUpdaterFieldEditElement(treeState, updaterObjectState, fieldState)); }
    headerElement.appendChild(createElement('span', 'updaterFieldName', field.fieldApiName));

    if (field.fieldLabel && field.fieldLabel !== field.fieldApiName) {
        headerElement.appendChild(createElement('span', 'updaterFieldLabel muted', field.fieldLabel));
    }

    const fieldTypeText = field.fieldTypeWithSize || field.fieldType;
    if (fieldTypeText) {
        headerElement.appendChild(createElement('span', 'fieldType', fieldTypeText));
    }

    if (fieldState.lockReason) {
        headerElement.appendChild(createElement('span', 'updaterFieldNote muted', fieldState.lockReason));
    }

    fieldState.editBadgeElement = createElement('span', 'fixedValueBadge hidden');
    headerElement.appendChild(fieldState.editBadgeElement);
    fieldState.orgChipElement = createElement('span', 'updaterOrgChangeChip hidden');
    headerElement.appendChild(fieldState.orgChipElement);
    drawAdapterFieldOrgChip(fieldState);

    if (isOrgOnlyField) {
        headerElement.appendChild(createElement('span', 'updaterFieldNote muted', RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE));
        if (fieldState.orgOnlyNote) { headerElement.appendChild(createElement('span', 'updaterFieldNote updaterOrgOnlyFixedNote muted', fieldState.orgOnlyNote)); }
    }

    rowElement.appendChild(headerElement);

    if (field.recipeValue) {
        fieldState.expressionRowElement = createElement('div', 'expressionRow');
        fieldState.expressionRowElement.appendChild(createElement('pre', 'expression', field.recipeValue));
        rowElement.appendChild(fieldState.expressionRowElement);
    }

    fieldState.editedValueElement = createElement('pre', 'updaterEditedValue hidden');
    rowElement.appendChild(fieldState.editedValueElement);
    fieldState.rowElement = rowElement;

    drawUpdaterFieldChoice(treeState, updaterObjectState, fieldState);
    drawUpdaterFieldEdit(treeState, updaterObjectState, fieldState);

    return rowElement;

}

function drawUpdaterFieldChoice(treeState: IUpdaterFieldTreeState, updaterObjectState: IUpdaterFieldObjectState, fieldState: IUpdaterFieldRowState): void {

    const chooseElement = fieldState.chooseElement;
    if (!chooseElement) { return; }

    const fieldName = updaterObjectState.object.objectApiName + '.' + fieldState.field.fieldApiName;
    const isChosen = hasOwnKey(treeState.updaterChosenFieldKeys, fieldState.fieldKey);
    const title = fieldState.lockReason ? 'Cannot be chosen: ' + fieldState.lockReason
        : isChosen ? 'Chosen — click to leave this field as it is'
        : 'Click to choose this field to fill';

    chooseElement.textContent = isChosen ? '✓' : '';
    chooseElement.setAttribute('aria-checked', isChosen ? 'true' : 'false');
    chooseElement.disabled = !!fieldState.lockReason;
    chooseElement.setAttribute('title', title);
    chooseElement.setAttribute('aria-label', fieldName + ': ' + title);

}

// A FIELD ONLY THE ORG HOLDS GETS A BOX ONLY WHEN THE HOST OFFERED A FIELD FOR IT (#446)
export function isChoosableOrgOnlyRow(orgOnlyRowState: AdapterOrgOnlyRowState): orgOnlyRowState is IAdapterOrgOnlyFieldState & { field: IAdapterField } {
    return !!orgOnlyRowState.field;
}

// AN OBJECT'S FIELD ROWS A LOAD AND A GENERATION READ: THE RECIPE'S, THEN THE FIELDS ONLY THE ORG HOLDS THE LAST RETRIEVE OFFERED (#446)
export function listUpdaterChoosableFieldStates(updaterObjectState: IUpdaterObjectState): IUpdaterFieldRowState[] {
    const recipeFieldStates: IUpdaterFieldRowState[] = updaterObjectState.fieldStates;
    return recipeFieldStates.concat(updaterObjectState.orgOnlyFieldStates.filter(isChoosableOrgOnlyRow));
}

// "<object>\n<field>" OF EVERY FIELD ONLY THE ORG HOLDS THAT THE CARD'S LAST RETRIEVE OFFERED UNLOCKED (#446)
function listAdapterChoosableOrgOnlyFieldKeys(treeState: IAdapterTreeState): Record<string, true> {
    const fieldKeys: Record<string, true> = Object.create(null);
    const changesMessage = treeState.adapterChangesMessage;
    (changesMessage && Array.isArray(changesMessage.objects) ? changesMessage.objects : []).forEach(function (objectChanges) {
        (objectChanges && Array.isArray(objectChanges.fieldChanges) ? objectChanges.fieldChanges : []).forEach(function (fieldChange) {
            if (fieldChange && fieldChange.orgOnly && typeof fieldChange.orgOnly === 'object' && !fieldChange.orgOnly.lockReason) {
                fieldKeys[updaterFieldKeyOf(String(objectChanges?.objectApiName), String(fieldChange.fieldApiName))] = true;
            }
        });
    });
    return fieldKeys;
}

export function drawUpdaterObjectCount(updaterObjectState: IUpdaterFieldObjectState): void {
    const loadedRecords = updaterObjectState.loadedRecords;
    updaterObjectState.countElement.textContent = updaterObjectState.countText
        + (updaterObjectState.chosenFieldCount > 0 ? ' · ' + updaterObjectState.chosenFieldCount + ' chosen' : '')
        + (!loadedRecords ? '' : loadedRecords.failureMessage || loadedRecords.skippedReason ? ' · not read' : ' · ' + pluralize(Number(loadedRecords.recordCount) || 0, 'record', 'records'));
}

// THE READER'S OWN WHERE FOR ONE OBJECT (#416): KEPT IN THE PANEL BY OBJECT NAME AND POSTED WITH THE LOAD, WHICH THE HOST CHECKS
function buildUpdaterWhereElement(treeState: IAdapterTreeState, updaterObjectState: IUpdaterObjectState): HTMLElement {

    const objectApiName = updaterObjectState.object.objectApiName;
    const whereElement = createElement('div', 'updaterWhere');
    const inputElement = createElement('input', 'updaterWhereInput');

    inputElement.setAttribute('type', 'text');
    inputElement.setAttribute('placeholder', RECIPE_COCKPIT_UPDATER_WHERE_PLACEHOLDER);
    inputElement.setAttribute('maxlength', String(UPDATER_WHERE_MAX_LENGTH));
    inputElement.setAttribute('aria-label', 'WHERE for ' + objectApiName + ' records');
    inputElement.value = hasOwnKey(treeState.updaterWhereTexts, objectApiName) ? treeState.updaterWhereTexts[objectApiName] : '';
    inputElement.addEventListener('input', function () {
        treeState.updaterWhereTexts[objectApiName] = String(inputElement.value || '');
    });

    whereElement.appendChild(inputElement);
    updaterObjectState.whereInputElement = inputElement;

    return whereElement;

}

export function drawUpdaterSummary(treeState: IUpdaterFieldTreeState): void {

    if (!treeState.updaterSummaryElement || !treeState.updaterObjectStates) { return; }

    let chosenFieldCount = 0;
    let chosenObjectCount = 0;

    treeState.updaterObjectStates.forEach(function (updaterObjectState) {
        chosenFieldCount += updaterObjectState.chosenFieldCount;
        if (updaterObjectState.chosenFieldCount > 0) { chosenObjectCount++; }
    });

    treeState.updaterSummaryElement.textContent = chosenFieldCount === 0
        ? RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN
        : pluralize(chosenFieldCount, 'field', 'fields') + ' chosen on ' + pluralize(chosenObjectCount, 'object', 'objects');

}

// THE TREECIPE TAB'S RULE: AN OBJECT IS NEVER HIDDEN, ONLY ITS ROWS, AND A SEARCH OPENS ITS MATCHES WITHIN THE SAME BUDGET
export function applyUpdaterFilter(treeState: IAdapterTreeState): void {

    const updaterSearch = treeState.updaterSearch;
    const updaterObjectStates = treeState.updaterObjectStates;
    if (!updaterSearch || !updaterObjectStates) { return; }

    const searchQuery = treeState.searchQueries.updater;
    let totalFieldCount = 0;
    let matchingFieldCount = 0;

    updaterObjectStates.forEach(function (updaterObjectState) {

        const isObjectNameMatch = !searchQuery || updaterObjectState.objectSearchText.indexOf(searchQuery) !== -1;
        let objectMatchingFieldCount = 0;

        updaterObjectState.fieldStates.forEach(function (fieldState) {
            fieldState.isMatch = isObjectNameMatch || fieldState.searchText.indexOf(searchQuery) !== -1 || (fieldState.orgSearchText !== '' && fieldState.orgSearchText.indexOf(searchQuery) !== -1);
            if (fieldState.isMatch) { objectMatchingFieldCount++; }
            if (fieldState.rowElement) { setShown(fieldState.rowElement, fieldState.isMatch); }
        });

        // A FIELD ONLY THE ORG HOLDS (#445) IS SHOWN OR HIDDEN BY THE SAME SEARCH, AND COUNTED APART FROM THE RECIPE'S FIELDS
        updaterObjectState.orgOnlyFieldStates.forEach(function (orgOnlyFieldState) {
            orgOnlyFieldState.isMatch = !searchQuery || isObjectNameMatch || orgOnlyFieldState.searchText.indexOf(searchQuery) !== -1;
            if (orgOnlyFieldState.rowElement) { setShown(orgOnlyFieldState.rowElement, orgOnlyFieldState.isMatch); }
        });

        const objectFieldCount = updaterObjectState.fieldStates.length;
        updaterObjectState.matchingFieldCount = objectMatchingFieldCount;
        totalFieldCount += objectFieldCount;
        matchingFieldCount += objectMatchingFieldCount;

        updaterObjectState.countText = !searchQuery || isObjectNameMatch
            ? pluralize(objectFieldCount, 'field', 'fields')
            : objectMatchingFieldCount > 0 ? objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields') : 'no matching fields';
        drawUpdaterObjectCount(updaterObjectState);

    });

    updaterSearch.matchCountElement.textContent = !searchQuery
        ? pluralize(totalFieldCount, 'field', 'fields')
        : matchingFieldCount > 0 ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') : 'no matches';

    if (!searchQuery) {
        updaterObjectStates.forEach(function (updaterObjectState) {
            setUpdaterObjectExpanded(treeState, updaterObjectState, updaterObjectState.isExpandedByReader, false);
        });
        return;
    }

    expandMatchesWithinBudget(updaterObjectStates,
        function (updaterObjectState) { return updaterObjectState.matchingFieldCount; },
        function (updaterObjectState) { return updaterObjectState.fieldStates.length; },
        function (updaterObjectState, isExpanded) { setUpdaterObjectExpanded(treeState, updaterObjectState, isExpanded, false); });

}
