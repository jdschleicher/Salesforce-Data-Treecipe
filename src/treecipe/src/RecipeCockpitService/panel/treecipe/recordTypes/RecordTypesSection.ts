import { createButton, createElement, setShown, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL,
    RECIPE_COCKPIT_RECORD_TYPES_INTRO,
    RECIPE_COCKPIT_RECORD_TYPES_SECTION_TITLE,
    RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY,
    RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL,
    RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE
} from '../../../RecipeCockpitRecordTypesConstants';
import type { RecipeCockpitRecordTypeImpactKind } from '../../../RecipeCockpitRecordTypesConstants';
import { IRecordType, IRecordTypeObject, IRecordTypeRowState, IRecordTypesTreeState } from './RecordTypeTypes';

/*
    The Record types section of the Treecipe tab (#321, the #195 tab before it), opened by the
    "Manage record types" button in the filter tile under the search (#490, replacing the header
    line and its ▸). The button carries aria-expanded and names the body it opens and the summary
    beside it, which says how many objects the section lists and whether the choice still matches
    the run. The body sits under the tile, collapsed until the reader opens it, and its rows are
    built on first expand.

    The choice is the PANEL's (#195), per object and shared by every card that lists the object:
    object api name -> developer names, in the order ticked. The script resets it, the row states
    and "Remember this selection" with every model, so they stay the script's and are read here
    when a function runs.
*/
declare const treeStates: IRecordTypesTreeState[];
declare const recordTypeChoices: Record<string, string[]>;
declare const recordTypeObjects: IRecordTypeObject[];
declare const recordTypeRowStates: IRecordTypeRowState[];
declare const recordTypeRememberElements: HTMLButtonElement[];
declare let isRecordTypeSelectionRemembered: boolean;
declare const insertRunningTreeKey: string | null;
declare function displayTitleOf(tree: unknown): string;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;

// EACH SECTION'S BUTTON NAMES ITS BODY AND ITS SUMMARY BY ID, SO A SCREEN READER ANNOUNCES "changed" ON THE BUTTON (#321)
let recordTypesSectionCount = 0;

// WHAT THE TREECIPE SEARCH MATCHES IN A ROW: THE OBJECT, ITS RECORD TYPES AND THE FIELDS THEY RESTRICT; BUILT ONCE PER OBJECT, NOT PER KEYSTROKE
const recordTypeSearchTextByObject = new WeakMap<IRecordTypeObject, string>();

const RECORD_TYPE_IMPACT_KIND_LABELS: Readonly<Record<RecipeCockpitRecordTypeImpactKind, string>> = Object.freeze({ picklist: 'Picklist', multiselect: 'Multi-select', dependent: 'Dependent picklist' });

// EVERY OBJECT THE CARD DRAWS THAT HAS RECORD TYPES TO CHOOSE FROM, ONCE, IN THE CARD'S ORDER
// A CARD'S OBJECTS ARE FIXED FOR ITS MODEL, AND THE SEARCH AND EVERY TICK ASK FOR THIS LIST (#321), SO IT IS BUILT ONCE PER CARD
export function listRecordTypeObjects(treeState: IRecordTypesTreeState): IRecordTypeObject[] {

    if (treeState.listedRecordTypeObjects) { return treeState.listedRecordTypeObjects; }

    const listedObjectApiNames: Record<string, true> = Object.create(null);

    treeState.listedRecordTypeObjects = treeState.objectStates
        .filter(function (treeObjectState) { return !treeObjectState.isIteration && Array.isArray(treeObjectState.object.recordTypes); })
        .map(function (treeObjectState) { return treeObjectState.object; })
        .filter(function (object) {
            if (listedObjectApiNames[object.objectApiName] === true) { return false; }
            listedObjectApiNames[object.objectApiName] = true;
            return true;
        });

    return treeState.listedRecordTypeObjects;

}

function describeRecordTypeImpacts(recordType: IRecordType): string {

    if (recordType.impacts.length === 0) { return 'Restricts no picklist values'; }

    return recordType.impacts.map(function (impact) {
        return RECORD_TYPE_IMPACT_KIND_LABELS[impact.kind] + ' ' + impact.fieldApiName + ': ' + pluralize(impact.valueCount, 'value', 'values');
    }).join(' · ');

}

export function buildRecordTypesSection(treeState: IRecordTypesTreeState, tileElement: HTMLElement): HTMLElement {

    const rowElement = createElement('div', 'treecipeFilterRow recordTypesManageRow');
    const toggleElement = createButton('secondary', 'recordTypesSectionToggle recordTypesManageButton', RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL);
    const bodyElement = createElement('div', 'recordTypesSectionBody hidden');
    const summaryElement = createElement('span', 'recordTypesSectionSummary muted');

    recordTypesSectionCount++;
    bodyElement.setAttribute('id', 'recordTypesSectionBody' + recordTypesSectionCount);
    bodyElement.setAttribute('role', 'region');
    bodyElement.setAttribute('aria-label', RECIPE_COCKPIT_RECORD_TYPES_SECTION_TITLE + ' (' + displayTitleOf(treeState.tree) + ')');
    summaryElement.setAttribute('id', 'recordTypesSectionSummary' + recordTypesSectionCount);
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');
    toggleElement.setAttribute('aria-controls', 'recordTypesSectionBody' + recordTypesSectionCount);
    toggleElement.setAttribute('aria-describedby', 'recordTypesSectionSummary' + recordTypesSectionCount);
    toggleElement.setAttribute('aria-expanded', 'false');
    toggleElement.addEventListener('click', function () {
        setRecordTypesExpanded(treeState, !treeState.isRecordTypesExpanded, true);
        savePanelPlace();
    });

    rowElement.appendChild(toggleElement);
    rowElement.appendChild(summaryElement);
    tileElement.appendChild(rowElement);

    treeState.recordTypesSection = { toggleElement: toggleElement, bodyElement: bodyElement, summaryElement: summaryElement, isBuilt: false };
    drawRecordTypesSummary(treeState);

    return bodyElement;

}

/*
    A card with no object offering two or more record types still draws the button (#338, #490),
    disabled, so the reader learns the section exists and why this tree has nothing in it. There is
    no body and no listener, and treeState.recordTypesSection stays unset, so a click, a search, a
    restored place and a focus all stop at the guards every other path already has.
*/
export function appendUnavailableRecordTypesButton(treeState: IRecordTypesTreeState, tileElement: HTMLElement): void {

    const rowElement = createElement('div', 'treecipeFilterRow recordTypesManageRow disabled');
    const toggleElement = createButton('secondary', 'recordTypesSectionToggle recordTypesManageButton', RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL);
    const summaryElement = createElement('span', 'recordTypesSectionSummary muted', RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY);

    recordTypesSectionCount++;
    summaryElement.setAttribute('id', 'recordTypesSectionSummary' + recordTypesSectionCount);
    toggleElement.disabled = true;
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');
    toggleElement.setAttribute('aria-describedby', 'recordTypesSectionSummary' + recordTypesSectionCount);
    toggleElement.setAttribute('title', RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY);

    rowElement.appendChild(toggleElement);
    rowElement.appendChild(summaryElement);
    tileElement.appendChild(rowElement);

}

export function setRecordTypesExpanded(treeState: IRecordTypesTreeState, isExpanded: boolean, isAnimated: boolean): void {

    const section = treeState.recordTypesSection;
    if (!section) { return; }

    if (isExpanded && !section.isBuilt) {
        section.isBuilt = true;
        buildRecordTypesRows(treeState, section.bodyElement);
    }

    setShownWithMotion(section.bodyElement, isExpanded, isAnimated);
    section.toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    treeState.isRecordTypesExpanded = isExpanded;

}

function recordTypeObjectSearchText(object: IRecordTypeObject): string {

    const knownSearchText = recordTypeSearchTextByObject.get(object);
    if (knownSearchText !== undefined) { return knownSearchText; }

    const searchTextParts = [object.objectApiName];
    object.recordTypes.forEach(function (recordType) {
        searchTextParts.push(recordType.developerName);
        recordType.impacts.forEach(function (impact) { searchTextParts.push(impact.fieldApiName); });
    });
    const searchText = searchTextParts.join('\n').toLowerCase();
    recordTypeSearchTextByObject.set(object, searchText);
    return searchText;

}

function drawRecordTypesSummary(treeState: IRecordTypesTreeState): void {

    const section = treeState.recordTypesSection;
    if (!section) { return; }

    const objects = listRecordTypeObjects(treeState);
    const searchQuery = treeState.searchQueries.treecipe;
    const matchingCount = objects.filter(function (object) { return !searchQuery || recordTypeObjectSearchText(object).indexOf(searchQuery) !== -1; }).length;
    const isChanged = objects.some(function (object) { return !isSameChoice(recordTypeChoices[object.objectApiName] || [], object.generatedRecordTypeDeveloperNames || []); });
    const isApplied = objects.some(function (object) { return object.isRecordTypeSelectionApplied === true; });
    const countText = !searchQuery
        ? pluralize(objects.length, 'object', 'objects')
        : matchingCount > 0 ? matchingCount + ' of ' + pluralize(objects.length, 'object', 'objects') : 'no matching objects';

    section.summaryElement.textContent = countText + ' · ' + (isChanged ? 'changed' : isApplied ? 'generated from a choice' : 'generated by default');

}

/*
    The section's rows: every object of the card with two or more record types, each record
    type a checkbox with what it restricts, and "Remember this selection". The choice they draw
    is panel-wide, so a tick here is drawn on every card listing the object.
*/
function buildRecordTypesRows(treeState: IRecordTypesTreeState, panelElement: HTMLElement): void {

    panelElement.appendChild(createElement('div', 'recordTypesIntro muted', RECIPE_COCKPIT_RECORD_TYPES_INTRO));

    treeState.recordTypeObjectStates = listRecordTypeObjects(treeState).map(function (object) {

        const objectElement = createElement('div', 'recordTypeObject');
        const headingElement = createElement('div', 'recordTypeObjectHeading');
        const statusElement = createElement('span', 'recordTypeObjectStatus muted');

        headingElement.appendChild(createElement('span', 'recordTypeObjectName', object.objectApiName));
        headingElement.appendChild(statusElement);
        objectElement.appendChild(headingElement);

        object.recordTypes.forEach(function (recordType) {

            const rowElement = createElement('div', 'recordTypeRow');
            const checkboxElement = createButton('check', 'treeFieldInclude recordTypeInclude');
            const labelElement = createElement('span', 'recordTypeName', recordType.developerName);

            checkboxElement.setAttribute('role', 'checkbox');
            checkboxElement.setAttribute('aria-label', recordType.developerName + ' (' + object.objectApiName + ')');
            checkboxElement.addEventListener('click', function () {
                if (checkboxElement.disabled) { return; }
                toggleRecordTypeChoice(object.objectApiName, recordType.developerName);
            });

            rowElement.appendChild(checkboxElement);
            rowElement.appendChild(labelElement);
            if (!recordType.isActive) { rowElement.appendChild(createElement('span', 'recordTypeInactive muted', 'inactive')); }
            rowElement.appendChild(createElement('div', 'recordTypeImpact muted', describeRecordTypeImpacts(recordType)));
            objectElement.appendChild(rowElement);

            recordTypeRowStates.push({ objectApiName: object.objectApiName, developerName: recordType.developerName, checkboxElement: checkboxElement });

        });

        panelElement.appendChild(objectElement);

        return { object: object, element: objectElement, statusElement: statusElement, searchText: recordTypeObjectSearchText(object) };

    });

    const rememberRowElement = createElement('div', 'recordTypesRememberRow');
    const rememberElement = createButton('check', 'treeFieldInclude recordTypesRemember');
    const rememberLabelElement = createElement('span', 'recordTypesRememberLabel', RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL);

    rememberElement.setAttribute('role', 'checkbox');
    rememberElement.setAttribute('aria-label', RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL);
    rememberElement.setAttribute('title', RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE);
    rememberLabelElement.setAttribute('title', RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE);
    rememberElement.addEventListener('click', function () {
        if (rememberElement.disabled) { return; }
        toggleRecordTypeSelectionRemembered();
    });
    rememberLabelElement.addEventListener('click', function () {
        if (rememberElement.disabled) { return; }
        toggleRecordTypeSelectionRemembered();
    });

    rememberRowElement.appendChild(rememberElement);
    rememberRowElement.appendChild(rememberLabelElement);
    panelElement.appendChild(rememberRowElement);
    recordTypeRememberElements.push(rememberElement);

    drawRecordTypeChoices();
    applyRecordTypesFilter(treeState);

}

// THE TREECIPE TAB'S ONE SEARCH ALSO NARROWS THE SECTION'S ROWS; THE COUNT IS IN ITS HEADER
export function applyRecordTypesFilter(treeState: IRecordTypesTreeState): void {

    const searchQuery = treeState.searchQueries.treecipe;

    (treeState.recordTypeObjectStates || []).forEach(function (objectState) {
        setShown(objectState.element, !searchQuery || objectState.searchText.indexOf(searchQuery) !== -1);
    });
    drawRecordTypesSummary(treeState);

}

// A CHOICE KEEPS AT LEAST ONE RECORD TYPE: "NONE" IS NOT A RECORD TYPE
function toggleRecordTypeChoice(objectApiName: string, developerName: string): void {

    const choice = recordTypeChoices[objectApiName] || [];
    const choiceIndex = choice.indexOf(developerName);

    if (choiceIndex === -1) {
        choice.push(developerName);
    } else if (choice.length > 1) {
        choice.splice(choiceIndex, 1);
    }

    recordTypeChoices[objectApiName] = choice;
    drawRecordTypeChoices();

}

function toggleRecordTypeSelectionRemembered(): void {

    isRecordTypeSelectionRemembered = !isRecordTypeSelectionRemembered;
    drawRecordTypeChoices();

}

function isSameChoice(firstNames: string[], secondNames: string[]): boolean {

    return firstNames.length === secondNames.length && firstNames.every(function (name, nameIndex) { return name === secondNames[nameIndex]; });

}

/*
    What "Generate fake data and insert" sends (#623), names only: every object the reader
    changed, and every object the run on screen was already generated from a choice for. An
    object left at its default is left out, so a card left as generated posts and inserts
    exactly as it did before.
*/
export function buildRecordTypeSelection(): Record<string, string[]> {

    const recordTypeSelection: Record<string, string[]> = Object.create(null);

    recordTypeObjects.forEach(function (object) {
        const choice = recordTypeChoices[object.objectApiName] || [];
        const isChanged = !isSameChoice(choice, object.generatedRecordTypeDeveloperNames || []);
        if (choice.length > 0 && (isChanged || object.isRecordTypeSelectionApplied === true)) {
            recordTypeSelection[object.objectApiName] = choice.slice();
        }
    });

    return recordTypeSelection;

}

export function drawRecordTypeChoices(): void {

    recordTypeRowStates.forEach(function (rowState) {
        const choice = recordTypeChoices[rowState.objectApiName] || [];
        const isTicked = choice.indexOf(rowState.developerName) !== -1;
        const isLastTicked = isTicked && choice.length === 1;
        rowState.checkboxElement.textContent = isTicked ? '✓' : '';
        rowState.checkboxElement.setAttribute('aria-checked', isTicked ? 'true' : 'false');
        rowState.checkboxElement.disabled = insertRunningTreeKey !== null || isLastTicked;
        if (isLastTicked) {
            rowState.checkboxElement.setAttribute('title', 'Each object keeps at least one record type');
        } else {
            rowState.checkboxElement.removeAttribute('title');
        }
    });

    treeStates.forEach(function (treeState) {
        (treeState.recordTypeObjectStates || []).forEach(function (objectState) {
            const object = objectState.object;
            const choice = recordTypeChoices[object.objectApiName] || [];
            const isChanged = !isSameChoice(choice, object.generatedRecordTypeDeveloperNames || []);
            objectState.statusElement.textContent = isChanged
                ? 'changed: the next generate writes ' + choice.join(', ')
                : (object.isRecordTypeSelectionApplied === true ? 'generated: ' : 'generated by default: ') + choice.join(', ');
        });
    });

    treeStates.forEach(drawRecordTypesSummary);

    recordTypeRememberElements.forEach(function (rememberElement) {
        rememberElement.textContent = isRecordTypeSelectionRemembered ? '✓' : '';
        rememberElement.setAttribute('aria-checked', isRecordTypeSelectionRemembered ? 'true' : 'false');
        rememberElement.disabled = insertRunningTreeKey !== null;
    });

}
