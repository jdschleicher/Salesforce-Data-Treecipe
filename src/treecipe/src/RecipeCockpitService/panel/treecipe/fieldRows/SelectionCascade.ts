import { createButton } from '../../../../CockpitKit/panel/CockpitPanelElements';
import type { IObjectSelectionDisabledLookup, IObjectSelectionExclusion } from '../../../RecipeCockpitObjectSelection';
import { RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON } from '../../../RecipeCockpitFieldRowsConstants';
import { RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH, RECIPE_COCKPIT_TREE_IMPACTED_GLYPH_PATH, RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH } from '../../../RecipeCockpitPanelConstants';
import { buildTreeGlyph } from '../../RecipeCockpitPanelBuilders';
import { hasOwnKey } from '../../RecipeCockpitOwnKey';
import { drawFieldRowLookupDecision } from '../fieldEditor/LookupWiring';
import { drawFieldRowFixedValue } from './FieldRowFixedValue';
import { drawFieldRowValidationRule } from './FieldRowValidationRule';
import { drawFieldSelection, drawResetSelection, formatParentLookups } from './FieldRow';
import { describeExcludedObjectFields } from './FieldScope';
import type {
    FieldRowsPanelMessage,
    IFieldRowFieldState,
    IFieldRowObjectState,
    IFieldRowTreeState,
    IObjectFieldSelection,
    IObjectImpact,
    ISelectionTree
} from './FieldRowTypes';
import { pluralize } from '../../RecipeCockpitPanelShared';
import { drawRecordCount } from '../card/RecordCount';
import { vscodeApi as cockpitVscodeApi } from '../../RecipeCockpitPanelConnection';

// THIS MODULE POSTS ONLY ITS OWN COMMANDS: THE TYPE HOLDS EVERY MESSAGE TO THEM
const vscodeApi: { postMessage(message: FieldRowsPanelMessage): void } = cockpitVscodeApi;

/*
    The host's object and field cascade drawn onto a card (#219, #220, #449, #467, #611): which
    objects are excluded, auto-excluded or impacted, which lookups an excluded parent disables, and
    each field box. The panel never decides a selection: the host posts it and re-derives every lock
    before it writes.
*/

export function buildIncludeElement(treeObjectState: IFieldRowObjectState, treeKey: string): void {

    const includeElement = createButton('icon', 'treeObjectInclude');
    const object = treeObjectState.object;

    treeObjectState.glyphElement = buildTreeGlyph(treeObjectState);
    treeObjectState.includeElement = includeElement;
    includeElement.appendChild(treeObjectState.glyphElement);
    includeElement.addEventListener('click', function () {
        if (includeElement.disabled) { return; }
        const message: FieldRowsPanelMessage = { command: 'setObjectIncluded', treeKey: treeKey, objectApiName: object.objectApiName, included: !treeObjectState.isIncluded };
        if (object.nickname) { message.nickname = object.nickname; }
        vscodeApi.postMessage(message);
    });

}

// KEYED BY OBJECT NAMES FROM DISK, SO NO PROTOTYPE: AN OBJECT NAMED __proto__ IS A KEY LIKE ANY OTHER
// ONE INDEX PER SELECTION THE HOST POSTED, SO EVERY CREATE ROW OF A CARD READS THE SAME ONE
const exclusionIndexesBySelection = new WeakMap<object, Record<string, IObjectSelectionExclusion>>();

export function indexObjectExclusions(tree: ISelectionTree): Record<string, IObjectSelectionExclusion> {

    const objectSelection = tree.objectSelection;
    if (!objectSelection || typeof objectSelection !== 'object') { return Object.create(null); }
    const indexedExclusions = exclusionIndexesBySelection.get(objectSelection);
    if (indexedExclusions) { return indexedExclusions; }

    const exclusionsByObjectApiName: Record<string, IObjectSelectionExclusion> = Object.create(null);
    const exclusions = Array.isArray(objectSelection.exclusions) ? objectSelection.exclusions : [];

    exclusions.forEach(function (exclusion) { exclusionsByObjectApiName[exclusion.objectApiName] = exclusion; });
    exclusionIndexesBySelection.set(objectSelection, exclusionsByObjectApiName);

    return exclusionsByObjectApiName;

}

/*
    #449: an object the cascade kept INCLUDED whose lookup to an excluded parent is disabled --
    the host's disabledLookups, read here and drawn, never decided. A self-lookup is never one,
    and an object the selection excludes is drawn as excluded instead. Parents and fields are
    listed once each, sorted with "<".
*/
const impactIndexesBySelection = new WeakMap<object, Record<string, IObjectImpact>>();

export function indexObjectImpacts(tree: ISelectionTree & { objects?: unknown[] }): Record<string, IObjectImpact> {

    const objectSelection = tree.objectSelection;
    if (!objectSelection || typeof objectSelection !== 'object') { return Object.create(null); }
    const indexedImpacts = impactIndexesBySelection.get(objectSelection);
    if (indexedImpacts) { return indexedImpacts; }

    const exclusionsByObjectApiName = indexObjectExclusions(tree);
    const impactsByObjectApiName: Record<string, IObjectImpact> = Object.create(null);
    // ONLY OBJECTS THE CARD DRAWS, SO THE HEADER'S COUNT AND THE ROWS NEVER DISAGREE
    const drawnObjectApiNames: Record<string, true> = Object.create(null);
    ( Array.isArray(tree.objects) ? tree.objects : [] ).forEach(function (treeObject: unknown) {
        const objectApiName = treeObject && typeof treeObject === 'object' ? (treeObject as { objectApiName?: unknown }).objectApiName : undefined;
        if (typeof objectApiName === 'string') { drawnObjectApiNames[objectApiName] = true; }
    });
    const disabledLookups: unknown[] = Array.isArray(objectSelection.disabledLookups) ? objectSelection.disabledLookups : [];
    const compareNames = function (left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; };

    disabledLookups.forEach(function (disabledLookup) {
        if (!disabledLookup || typeof disabledLookup !== 'object') { return; }
        const { objectApiName, parentObjectApiName, fieldApiName } = disabledLookup as Partial<Record<keyof IObjectSelectionDisabledLookup, unknown>>;
        if (typeof objectApiName !== 'string' || typeof parentObjectApiName !== 'string' || typeof fieldApiName !== 'string') { return; }
        if (objectApiName === parentObjectApiName || hasOwnKey(exclusionsByObjectApiName, objectApiName) || !hasOwnKey(drawnObjectApiNames, objectApiName)) { return; }
        if (!hasOwnKey(impactsByObjectApiName, objectApiName)) {
            impactsByObjectApiName[objectApiName] = { parentObjectApiNames: [], fieldApiNames: [] };
        }
        const impact = impactsByObjectApiName[objectApiName];
        if (impact.parentObjectApiNames.indexOf(parentObjectApiName) === -1) { impact.parentObjectApiNames.push(parentObjectApiName); }
        if (impact.fieldApiNames.indexOf(fieldApiName) === -1) { impact.fieldApiNames.push(fieldApiName); }
    });

    Object.keys(impactsByObjectApiName).forEach(function (objectApiName) {
        impactsByObjectApiName[objectApiName].parentObjectApiNames.sort(compareNames);
        impactsByObjectApiName[objectApiName].fieldApiNames.sort(compareNames);
    });
    impactIndexesBySelection.set(objectSelection, impactsByObjectApiName);

    return impactsByObjectApiName;

}

function describeObjectImpact(impact: IObjectImpact): string {

    const parentText = impact.parentObjectApiNames.length === 1 ? 'parent ' + impact.parentObjectApiNames[0] : 'parents ' + impact.parentObjectApiNames.join(', ');
    return parentText + ' excluded';

}

export function findObjectExclusion(tree: ISelectionTree, objectApiName: string | undefined): IObjectSelectionExclusion | null {

    const exclusionsByObjectApiName = indexObjectExclusions(tree);

    return Object.prototype.hasOwnProperty.call(exclusionsByObjectApiName, objectApiName as PropertyKey) ? exclusionsByObjectApiName[objectApiName as string] : null;

}

// AN OBJECT LEFT OUT FOR HAVING NO FIELD TICKED (#611), OR CUT OFF BY ITS OWN REMOVED LOOKUP (#677), KEEPS ITS BOXES: TICKING ONE IS HOW IT COMES BACK
export function findFieldLockingExclusion(tree: ISelectionTree, objectApiName: string): IObjectSelectionExclusion | null {
    const exclusion = findObjectExclusion(tree, objectApiName);
    return exclusion && exclusion.kind !== 'noFieldsSelected' && exclusion.removedLookupFieldApiName === undefined ? exclusion : null;
}

// EVERYTHING AFTER THE OBJECT'S NAME GIVES WAY TO ONE RED MESSAGE; THE ▸ STAYS, SO A FIELD CAN BE TICKED AGAIN
export function drawNoFieldsSelected(treeObjectState: IFieldRowObjectState, isNoFieldsSelected: boolean): void {
    treeObjectState.headerDetailElements.forEach(function (detailElement) {
        if (isNoFieldsSelected) { detailElement.classList.add('noFieldsSelectedHidden'); } else { detailElement.classList.remove('noFieldsSelectedHidden'); }
    });
    if (isNoFieldsSelected) { treeObjectState.noFieldsSelectedElement.classList.remove('hidden'); } else { treeObjectState.noFieldsSelectedElement.classList.add('hidden'); }
    if (isNoFieldsSelected) { treeObjectState.element.classList.add('noFieldsSelected'); } else { treeObjectState.element.classList.remove('noFieldsSelected'); }
}

function formatTreeCount(treeState: IFieldRowTreeState): string {

    const objectSelection = treeState.tree.objectSelection;
    const objectText = objectSelection
        ? objectSelection.includedObjectCount + ' of ' + pluralize(objectSelection.objectCount, 'object', 'objects')
        : pluralize(treeState.countedObjectCount, 'object', 'objects');

    const impactedObjectCount = Object.keys(indexObjectImpacts(treeState.tree)).length;
    const impactedText = impactedObjectCount > 0 ? ' · ' + impactedObjectCount + ' impacted' : '';

    return objectText + impactedText + ' · ' + pluralize(treeState.countedFieldCount, 'field', 'fields');

}

/*
    The host's cascade drawn onto one card: each row's icon, overlay and label, the lookups of
    an included object that point at an excluded parent, and the header's count. The state is
    never colour alone -- the icon's SHAPE, aria-pressed, the title and the label all say it.
*/
export function drawObjectSelection(treeState: IFieldRowTreeState): void {

    const tree = treeState.tree;
    const disabledLookups: unknown[] = tree.objectSelection && Array.isArray(tree.objectSelection.disabledLookups) ? tree.objectSelection.disabledLookups : [];
    const exclusionsByObjectApiName = indexObjectExclusions(tree);
    const impactsByObjectApiName = indexObjectImpacts(tree);
    // INDEXED ONCE PER DRAW: A PER-ROW SCAN OF THE LISTS WAS OVER A SECOND AT 11,000 ROWS
    const disabledFieldApiNamesByObjectApiName: Record<string, string[]> = Object.create(null);
    disabledLookups.forEach(function (disabledLookup) {
        if (!disabledLookup || typeof disabledLookup !== 'object') { return; }
        const { objectApiName, fieldApiName } = disabledLookup as Partial<Record<keyof IObjectSelectionDisabledLookup, unknown>>;
        if (typeof objectApiName !== 'string' || typeof fieldApiName !== 'string') { return; }
        if (!Object.prototype.hasOwnProperty.call(disabledFieldApiNamesByObjectApiName, objectApiName)) {
            disabledFieldApiNamesByObjectApiName[objectApiName] = [];
        }
        disabledFieldApiNamesByObjectApiName[objectApiName].push(fieldApiName);
    });

    treeState.objectStates.forEach(function (treeObjectState) {

        const objectApiName = treeObjectState.object.objectApiName;
        const exclusion = Object.prototype.hasOwnProperty.call(exclusionsByObjectApiName, objectApiName) ? exclusionsByObjectApiName[objectApiName] : null;
        const isAutoExcluded = !!exclusion && exclusion.kind === 'autoExcluded';
        const isNoFieldsSelected = !!exclusion && exclusion.kind === 'noFieldsSelected';
        const removedLookupText = exclusion && exclusion.removedLookupFieldApiName !== undefined ? objectApiName + '.' + exclusion.removedLookupFieldApiName : null;
        const impact = !exclusion && hasOwnKey(impactsByObjectApiName, objectApiName) ? impactsByObjectApiName[objectApiName] : null;
        const excludedParent = isAutoExcluded ? findObjectExclusion(tree, exclusion.excludedParentObjectApiName) : null;
        const excludedParentState = excludedParent && excludedParent.kind === 'noFieldsSelected' ? ' has no fields selected' : ' excluded';

        // A ROW WITH NO FIELD TICKED IS NOT DIMMED: ITS RED MESSAGE IS WHAT THE READER MUST SEE (#611)
        if (exclusion && !isNoFieldsSelected) { treeObjectState.element.classList.add('excluded'); } else { treeObjectState.element.classList.remove('excluded'); }

        treeObjectState.exclusionElement.textContent = impact ? describeObjectImpact(impact)
            : !exclusion ? ''
            : removedLookupText ? 'cut off — ' + removedLookupText + ' removed'
            : isAutoExcluded ? 'auto-excluded — parent ' + exclusion.excludedParentObjectApiName + excludedParentState
            : isNoFieldsSelected ? 'not generated — ' + objectApiName + ' has no fields selected'
            : 'excluded';
        if (exclusion || impact) { treeObjectState.exclusionElement.classList.remove('hidden'); } else { treeObjectState.exclusionElement.classList.add('hidden'); }

        const disabledFieldApiNames = Object.prototype.hasOwnProperty.call(disabledFieldApiNamesByObjectApiName, objectApiName)
            ? disabledFieldApiNamesByObjectApiName[objectApiName]
            : [];
        treeObjectState.lookupsElement.textContent = formatParentLookups(treeObjectState.treeObject, disabledFieldApiNames);
        if (treeObjectState.lookupsElement.textContent) { treeObjectState.lookupsElement.classList.remove('hidden'); } else { treeObjectState.lookupsElement.classList.add('hidden'); }

        // AN EXCLUDED OBJECT IS NOT GENERATED, SO ITS COUNT CANNOT BE CHANGED; RE-INCLUDED, ITS STORED COUNT COMES BACK
        if (treeObjectState.countButtonElement) { drawRecordCount(treeObjectState, !!exclusion); }

        if (!treeObjectState.includeElement) { return; }

        const includeElement = treeObjectState.includeElement;
        const glyphKind = exclusion ? exclusion.kind : impact ? 'impacted' : 'included';
        const isRefused = !!treeObjectState.object.hasIndistinctOccurrences;

        treeObjectState.isIncluded = !exclusion;
        ( treeObjectState.glyphElement as SVGSVGElement ).setAttribute('class', 'treeGlyph ' + glyphKind);
        ( treeObjectState.glyphPathElement as SVGPathElement ).setAttribute('d', exclusion ? RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH : impact ? RECIPE_COCKPIT_TREE_IMPACTED_GLYPH_PATH : RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH);
        includeElement.setAttribute('aria-pressed', exclusion ? 'false' : 'true');
        includeElement.disabled = isAutoExcluded || isNoFieldsSelected || isRefused;

        const title = isRefused ? objectApiName + ' is written more than once in its recipe with no nickname to tell them apart, so it cannot be excluded'
            : isNoFieldsSelected ? 'No fields selected, so no records will be generated. Tick a field to include it'
            : removedLookupText ? 'Cut off because ' + removedLookupText + ' was removed. Tick it to include ' + objectApiName
            : isAutoExcluded ? 'Excluded because parent ' + exclusion.excludedParentObjectApiName + ( excludedParent && excludedParent.kind === 'noFieldsSelected' ? ' has no fields selected' : ' is excluded' )
            : exclusion ? 'Excluded — click to include'
            : impact ? 'Included — ' + describeObjectImpact(impact) + ', so ' + impact.fieldApiNames.join(', ') + ( impact.fieldApiNames.length === 1 ? ' is' : ' are' ) + ' left out. Click to exclude'
            : 'Included — click to exclude';
        includeElement.setAttribute('title', title);
        includeElement.setAttribute('aria-label', objectApiName + ': ' + title);

    });

    if (treeState.countElement) { treeState.countElement.textContent = formatTreeCount(treeState); }

    drawFieldSelection(treeState);
    drawResetSelection(treeState);

}

// ONE INDEX PER FIELD SELECTION THE HOST POSTED; EVERY MAP IS KEYED BY NAMES FROM DISK, SO NONE HAS A PROTOTYPE
const fieldSelectionIndexesBySelection = new WeakMap<object, Record<string, IObjectFieldSelection>>();

function indexFieldSelection(tree: ISelectionTree): Record<string, IObjectFieldSelection> {

    const fieldSelection = tree.fieldSelection;
    if (!fieldSelection || typeof fieldSelection !== 'object' || !Array.isArray(fieldSelection.objects)) { return Object.create(null); }
    const indexedSelections = fieldSelectionIndexesBySelection.get(fieldSelection);
    if (indexedSelections) { return indexedSelections; }

    const selectionsByObjectApiName: Record<string, IObjectFieldSelection> = Object.create(null);

    fieldSelection.objects.forEach(function (objectFieldSelection) {
        const excludedFieldApiNames: Record<string, true> = Object.create(null);
        const lockReasonsByFieldApiName: Record<string, string> = Object.create(null);
        ( Array.isArray(objectFieldSelection.excludedFieldApiNames) ? objectFieldSelection.excludedFieldApiNames : [] )
            .forEach(function (fieldApiName) { excludedFieldApiNames[fieldApiName] = true; });
        ( Array.isArray(objectFieldSelection.lockedFields) ? objectFieldSelection.lockedFields : [] )
            .forEach(function (lockedField) { lockReasonsByFieldApiName[lockedField.fieldApiName] = String(lockedField.reason); });
        selectionsByObjectApiName[objectFieldSelection.objectApiName + '\n' + ( objectFieldSelection.nickname || '' )] = {
            excludedFieldApiNames: excludedFieldApiNames,
            lockReasonsByFieldApiName: lockReasonsByFieldApiName,
            excludedFieldCount: Object.keys(excludedFieldApiNames).length,
            isEveryFieldExcluded: objectFieldSelection.isEveryFieldExcluded === true
        };
    });

    fieldSelectionIndexesBySelection.set(fieldSelection, selectionsByObjectApiName);

    return selectionsByObjectApiName;

}

// ONE OCCURRENCE'S SELECTION (#467): THE HOST KEYS EVERY OCCURRENCE OF AN OBJECT WITH iterations BY ITS NICKNAME
export function findObjectFieldSelection(tree: ISelectionTree, objectApiName: string, nickname: string | undefined): IObjectFieldSelection | null {

    const selectionsByObjectApiName = indexFieldSelection(tree);
    const selectionKey = objectApiName + '\n' + ( nickname || '' );

    return Object.prototype.hasOwnProperty.call(selectionsByObjectApiName, selectionKey) ? selectionsByObjectApiName[selectionKey] : null;

}

/*
    The occurrence a row's own settings are kept for (#467), the host's readOccurrenceNickname:
    every occurrence of an object with iterations has its nickname, an object written once none.
*/
export function occurrenceNicknameOf(object: { objectApiName: string; nickname?: string; iteration?: unknown; iterations?: unknown }): string {
    return object.iteration || ( Array.isArray(object.iterations) && object.iterations.length > 0 ) ? ( object.nickname || '' ) : '';
}

export function isSameOccurrence(candidate: { objectApiName: string; nickname?: string }, objectApiName: string, nickname: string | undefined): boolean {
    return candidate.objectApiName === objectApiName && ( candidate.nickname || '' ) === ( nickname || '' );
}

// A FIELD'S BOX READS UNTICKED WHEN THE READER UNTICKED IT OR AN EXCLUDED PARENT CUT IT (#220); "Hide unselected" (#483) READS THE SAME
export function isTreeFieldUnticked(objectFieldSelection: IObjectFieldSelection | null, fieldApiName: string): boolean {
    if (!objectFieldSelection) { return false; }
    const lockReason = hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) ? objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] : '';
    return lockReason === RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON || hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName);
}

/*
    One field row's checkbox, dimming and note (#220), all drawn from the host's answer. The
    state is never colour alone: the box's mark, aria-checked, the title and the note all say it.
*/
export function drawFieldRowSelection(treeObjectState: IFieldRowObjectState, fieldState: IFieldRowFieldState): void {

    if (!fieldState.rowElement) { return; }

    const tree = treeObjectState.tree;
    const objectApiName = treeObjectState.object.objectApiName;
    const fieldApiName = fieldState.field.fieldApiName;
    const objectFieldSelection = findObjectFieldSelection(tree, objectApiName, occurrenceNicknameOf(treeObjectState.object));
    const isObjectExcluded = !!findFieldLockingExclusion(tree, objectApiName);
    const lockReason = objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) ? objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] : '';
    const isExcluded = isTreeFieldUnticked(objectFieldSelection, fieldApiName);

    if (isExcluded) { fieldState.rowElement.classList.add('fieldExcluded'); } else { fieldState.rowElement.classList.remove('fieldExcluded'); }

    if (fieldState.noteElement) {
        fieldState.noteElement.textContent = lockReason;
        if (fieldState.noteElement.textContent) { fieldState.noteElement.classList.remove('hidden'); } else { fieldState.noteElement.classList.add('hidden'); }
    }

    drawFieldRowFixedValue(treeObjectState, fieldState);
    drawFieldRowValidationRule(treeObjectState, fieldState);
    drawFieldRowLookupDecision(treeObjectState, fieldState);

    const includeElement = fieldState.includeElement;
    if (!includeElement) { return; }

    fieldState.isIncluded = !isExcluded;
    includeElement.textContent = isExcluded ? '' : '✓';
    includeElement.setAttribute('aria-checked', isExcluded ? 'false' : 'true');
    includeElement.disabled = isObjectExcluded || !!lockReason;

    const title = isObjectExcluded ? describeExcludedObjectFields(objectApiName)
        : lockReason ? 'Cannot be unticked: ' + lockReason
        : isExcluded ? 'Unticked — click to generate this field'
        : 'Ticked — click to leave this field out';
    includeElement.setAttribute('title', title);
    includeElement.setAttribute('aria-label', fieldApiName + ': ' + title);

}
