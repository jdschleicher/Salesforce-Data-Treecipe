import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE, RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL } from '../../../RecipeCockpitRecordTypesConstants';
import { IRecordTypesTreeState } from './RecordTypeTypes';

/*
    "Record type fields only" (#320): the Treecipe tab's own check, per card and panel-only, kept
    in the reader's place. A card whose objects have no record types to choose from draws it
    disabled with a note saying why, so turning it on can never empty the tab silently.
    These names are the panel script's own, read when a function runs.
*/
declare function displayTitleOf(tree: unknown): string;
declare function applyStructureFilter(treeState: IRecordTypesTreeState): void;
declare function savePanelPlace(): void;

// OBJECT API NAME -> FIELD API NAME -> THE DEVELOPER NAMES RESTRICTING IT
export type RecordTypeFieldsIndex = Record<string, Record<string, string[]>>;

// A CARD'S OBJECTS ARE FIXED FOR ITS MODEL, SO THE ANSWER IS KEPT ON THE CARD
function hasRecordTypeObjects(treeState: IRecordTypesTreeState): boolean {
    if (typeof treeState.hasRecordTypeObjects !== 'boolean') {
        treeState.hasRecordTypeObjects = treeState.objectStates.some(function (treeObjectState) { return treeObjectState.hasRecordTypes; });
    }
    return treeState.hasRecordTypeObjects;
}

export function isRecordTypeFieldsOnlyIn(treeState: IRecordTypesTreeState): boolean {
    return treeState.isRecordTypeFieldsOnly === true && hasRecordTypeObjects(treeState);
}

export function appendRecordTypeFieldsToggle(treeState: IRecordTypesTreeState, tileElement: HTMLElement): void {

    const rowElement = createElement('div', 'treecipeFilterRow');
    tileElement.appendChild(rowElement);
    // THE SAME BOX EVERY OTHER CHECKBOX DRAWS (#343), WITH ITS LABEL BESIDE IT AS "Remember this selection" HAS
    const checkElement = createElement('span', 'treeRecordTypeFieldsCheck');
    const toggleElement = createButton('check', 'treeFieldInclude treeRecordTypeFieldsToggle');
    const labelElement = createElement('span', 'treeRecordTypeFieldsLabel', RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL);
    toggleElement.setAttribute('role', 'checkbox');
    toggleElement.setAttribute('aria-label', RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');

    if (hasRecordTypeObjects(treeState)) {
        const title = 'Show only the picklist fields a record type restricts';
        const toggleRecordTypeFieldsOnly = function () {
            if (toggleElement.disabled) { return; }
            treeState.isRecordTypeFieldsOnly = !treeState.isRecordTypeFieldsOnly;
            applyStructureFilter(treeState);
            savePanelPlace();
        };
        toggleElement.setAttribute('title', title);
        labelElement.setAttribute('title', title);
        toggleElement.addEventListener('click', toggleRecordTypeFieldsOnly);
        labelElement.addEventListener('click', toggleRecordTypeFieldsOnly);
    } else {
        toggleElement.disabled = true;
        toggleElement.setAttribute('title', RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE);
        checkElement.classList.add('disabled');
    }

    treeState.recordTypeFieldsToggleElement = toggleElement;
    checkElement.appendChild(toggleElement);
    checkElement.appendChild(labelElement);
    rowElement.appendChild(checkElement);

    if (!hasRecordTypeObjects(treeState)) {
        rowElement.appendChild(createElement('span', 'treeRecordTypeFieldsNote muted', RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE));
    }

    drawRecordTypeFieldsToggle(treeState);

}

export function drawRecordTypeFieldsToggle(treeState: IRecordTypesTreeState): void {

    const toggleElement = treeState.recordTypeFieldsToggleElement;
    if (!toggleElement) { return; }

    const isChecked = isRecordTypeFieldsOnlyIn(treeState);
    toggleElement.textContent = isChecked ? '✓' : '';
    toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');

}

function isRecordLike(candidate: unknown): candidate is Record<string, unknown> {
    return !!candidate && typeof candidate === 'object' && !Array.isArray(candidate);
}

/*
    The fields each object's record types restrict (#320), in the order the Record types section
    lists them. Drawn from objects[].recordTypes[].impacts the model already carries, so the host
    sends nothing new. Keyed by names from files, so no prototype; an impact naming a field the
    object does not list, one that is not an object, and anything named __proto__ add nothing.
*/
export function indexRecordTypeFields(objects: unknown[]): RecordTypeFieldsIndex {

    const recordTypeFieldsIndex: RecordTypeFieldsIndex = Object.create(null);

    objects.forEach(function (object) {

        if (!isRecordLike(object) || typeof object.objectApiName !== 'string' || object.objectApiName === '__proto__') { return; }
        if (!Array.isArray(object.recordTypes) || object.recordTypes.length < 2) { return; }

        const listedFieldApiNames: Record<string, true> = Object.create(null);
        (Array.isArray(object.fields) ? object.fields as unknown[] : []).forEach(function (field) {
            if (isRecordLike(field) && typeof field.fieldApiName === 'string') { listedFieldApiNames[field.fieldApiName] = true; }
        });

        const developerNamesByFieldApiName: Record<string, string[]> = Object.create(null);

        (object.recordTypes as unknown[]).forEach(function (recordType) {
            if (!isRecordLike(recordType) || typeof recordType.developerName !== 'string' || !Array.isArray(recordType.impacts)) { return; }
            const developerName = recordType.developerName;
            (recordType.impacts as unknown[]).forEach(function (impact) {
                if (!isRecordLike(impact)) { return; }
                const fieldApiName = impact.fieldApiName;
                if (typeof fieldApiName !== 'string' || fieldApiName === '__proto__' || listedFieldApiNames[fieldApiName] !== true) { return; }
                const developerNames = developerNamesByFieldApiName[fieldApiName] || (developerNamesByFieldApiName[fieldApiName] = []);
                if (developerNames.indexOf(developerName) === -1) { developerNames.push(developerName); }
            });
        });

        recordTypeFieldsIndex[object.objectApiName] = developerNamesByFieldApiName;

    });

    return recordTypeFieldsIndex;

}
