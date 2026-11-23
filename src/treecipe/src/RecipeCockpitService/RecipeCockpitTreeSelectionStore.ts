/*
    A card's object and field selection, counts and fixed values (#219, #220, #342), kept in
    workspaceState and the fixed-values file, and the checks a fixed value is held to (#671). It never
    loads the hub; a host reads it through the hub's delegates.
*/

import * as fs from 'fs';
import * as path from 'path';
import { ReadOnlyFields } from '../ObjectInfoWrapper/ReadOnlyFields';
import { StandardDerivedFields } from '../ObjectInfoWrapper/StandardDerivedFields';
import {
    IPinnedFieldRestoreRequest,
    RecipeCockpitRecipeWriter,
    RecipeFixedValueKind
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX,
    RECIPE_COCKPIT_EXPRESSION_OPENER,
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX,
    RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON,
    RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL
} from './RecipeCockpitFieldRowsConstants';
import {
    IFixedValueEntry,
    IFixedValueFileRead,
    RecipeCockpitFixedValueStore
} from './RecipeCockpitFixedValueStore';
import {
    IObjectSelectionRemovedLookup,
    RecipeCockpitObjectSelection
} from './RecipeCockpitObjectSelection';
import {
    RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES,
    RecipeCockpitPanelPlace
} from './RecipeCockpitPanelPlace';
import {
    RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH,
    RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES,
    RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES
} from './RecipeCockpitTreecipeFieldEditorConstants';
import { RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX } from './RecipeCockpitTreecipeSelection';
import type {
    IRecipeCockpitFieldReferenceViewModel,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitFixedValueViewModel,
    IRecipeCockpitObjectCountViewModel,
    IRecipeCockpitObjectFieldSelectionViewModel,
    IRecipeCockpitObjectIterationViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitOrgRecordLookupViewModel,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeFieldSelectionViewModel,
    IRecipeCockpitTreeObjectSelectionViewModel,
    IRecipeCockpitTreeObjectViewModel,
    IRecipeCockpitTreeOccurrence,
    IRecipeCockpitTreeSelections,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitWorkspaceState
} from './RecipeCockpitViewModel';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';

/*
    What each tree folder's Structure tab excluded directly (#219) and the fields it unticked (#220);
    the cascade and the locks are recomputed, never stored. Version 2 added the fields; a version 1
    entry still reads, as objects with nothing unticked.
*/
export const RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY = 'treecipe.recipeCockpit.objectSelection';
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION = 7;
// THE LAST VERSION THAT STORED FAKER BOUNDS (#323); #356 EDITS THE EXPRESSION ITSELF, SO THEY ARE NOT READ
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS = 6;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES = 5;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS = 4;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES = 3;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS = 2;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS = 1;

// WHY A FIELD'S CHECKBOX IS DISABLED (#220); EACH IS THE HOST'S ANSWER, WHICH THE PANEL DRAWS
export const RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON = 'record-type sections depend on it';
// A LOOKUP'S PENCIL (#627) TAKES ONE RECORD'S Id: THE TREE INSERT KEEPS AN Id AND REPLACES ANY OTHER VALUE A LOOKUP HOLDS
export const RECIPE_COCKPIT_LOOKUP_VALUE_REFUSAL_SUFFIX = 'is a lookup, so it takes the Id of an existing record. Type a 15- or 18-character Salesforce Id.';

export class RecipeCockpitTreeSelectionStore {




    /*
        Each tree folder's DIRECT exclusions (#219) and unticked fields (#220), as workspaceState kept
        them, each name checked on its own. Which of them still name an object or field is decided
        against the model they are applied to, so a stale name is dropped silently there rather than
        here. A version 1 entry has no fields and reads as nothing unticked; a version 1 or 2 entry
        has no counts (#255) and reads as no count changed.
    */
    static readTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitTreeSelections {

        const treeSelections: IRecipeCockpitTreeSelections = {
            excludedObjectApiNamesByFolderName: new Map(),
            excludedFieldApiNamesByFolderName: new Map(),
            objectCountsByFolderName: new Map(),
            fixedValuesByFolderName: new Map(),
            validationRulesOffByFolderName: new Map()
        };
        let storedSelections: unknown;

        try {
            storedSelections = workspaceState?.get<unknown>(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        } catch {
            return treeSelections;
        }

        const readableVersions: unknown[] = [RECIPE_COCKPIT_OBJECT_SELECTION_VERSION, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS];
        if ( !RecipeCockpitUntrustedValue.isPlainRecord(storedSelections)
                || !readableVersions.includes(storedSelections.version)
                || !RecipeCockpitUntrustedValue.isPlainRecord(storedSelections.excludedObjectApiNamesByFolderName) ) {
            return treeSelections;
        }

        const storedByFolderName = storedSelections.excludedObjectApiNamesByFolderName;
        const isUsableFolderName = (folderName: string) => RecipeCockpitPanelPlace.isBoundedText(folderName) && folderName !== '';

        Object.keys(storedByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const excludedObjectApiNames = RecipeCockpitPanelPlace.normalizePlaceNames(storedByFolderName[folderName]).filter(objectApiName => SalesforceApiName.isApiName(objectApiName));
            if ( isUsableFolderName(folderName) && excludedObjectApiNames.length > 0 ) {
                treeSelections.excludedObjectApiNamesByFolderName.set(folderName, new Set(excludedObjectApiNames));
            }
        });

        // A FIXED VALUE IS IN THE RECIPE FILE SINCE #342, AND FAKER BOUNDS ARE GONE SINCE #356, SO NEITHER IS READ FROM AN OLDER ENTRY
        const hasCounts = storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS
                            && storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS;
        const hasValidationRules = storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION || storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS;
        const storedCountsByFolderName = hasCounts ? storedSelections.objectCountsByFolderName : undefined;
        const storedValidationRulesOffByFolderName = hasValidationRules ? storedSelections.validationRulesOffByFolderName : undefined;

        // THE SAME SHAPE AS THE UNTICKED FIELDS, READ THE SAME WAY (#325)
        const readFieldNamesByFolderName = (storedByFolder: unknown, readInto: Map<string, Map<string, Set<string>>>) => {
            if ( !RecipeCockpitUntrustedValue.isPlainRecord(storedByFolder) ) {
                return;
            }
            Object.keys(storedByFolder).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
                const storedByObject = storedByFolder[folderName];
                if ( !isUsableFolderName(folderName) || !RecipeCockpitUntrustedValue.isPlainRecord(storedByObject) ) {
                    return;
                }
                const fieldNamesByObject = new Map<string, Set<string>>();
                Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                    const fieldApiNames = RecipeCockpitPanelPlace.normalizePlaceNames(storedByObject[objectApiName]).filter(fieldApiName => SalesforceApiName.isApiName(fieldApiName));
                    // AN OBJECT'S KEY, OR ONE OCCURRENCE'S "<Object>\n<Nickname>" (#467)
                    if ( SalesforceApiName.isOccurrenceKey(objectApiName) && fieldApiNames.length > 0 ) {
                        fieldNamesByObject.set(objectApiName, new Set(fieldApiNames));
                    }
                });
                if ( fieldNamesByObject.size > 0 ) {
                    readInto.set(folderName, fieldNamesByObject);
                }
            });
        };

        readFieldNamesByFolderName(storedValidationRulesOffByFolderName, treeSelections.validationRulesOffByFolderName);

        if ( RecipeCockpitUntrustedValue.isPlainRecord(storedCountsByFolderName) ) {
            Object.keys(storedCountsByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
                const storedByObject = storedCountsByFolderName[folderName];
                if ( !isUsableFolderName(folderName) || !RecipeCockpitUntrustedValue.isPlainRecord(storedByObject) ) {
                    return;
                }
                const countsByObject = new Map<string, number>();
                Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                    const recordCount = storedByObject[objectApiName];
                    if ( SalesforceApiName.isOccurrenceKey(objectApiName) && RecipeCockpitRecipeWriter.isRecordCount(recordCount) ) {
                        countsByObject.set(objectApiName, recordCount);
                    }
                });
                if ( countsByObject.size > 0 ) {
                    treeSelections.objectCountsByFolderName.set(folderName, countsByObject);
                }
            });
        }

        const storedFieldsByFolderName = storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS ? storedSelections.excludedFieldApiNamesByFolderName : undefined;

        readFieldNamesByFolderName(storedFieldsByFolderName, treeSelections.excludedFieldApiNamesByFolderName);

        return treeSelections;

    }

    static async writeTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, treeSelections: IRecipeCockpitTreeSelections): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage('The Recipe Cockpit has no workspace to keep excluded objects, unticked fields, record counts and validation rule choices in. Open a folder and re-open the cockpit.');
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER OR OBJECT NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const storedByFolderName: Record<string, string[]> = Object.fromEntries(
            [...treeSelections.excludedObjectApiNamesByFolderName]
                .filter(([, excludedObjectApiNames]) => excludedObjectApiNames.size > 0)
                .map(([folderName, excludedObjectApiNames]) => [folderName, [...excludedObjectApiNames]])
        );
        const toStoredFieldNames = (fieldNamesByFolderName: Map<string, Map<string, Set<string>>>): Record<string, Record<string, string[]>> => Object.fromEntries(
            [...fieldNamesByFolderName]
                .map(([folderName, fieldNamesByObject]) => [folderName, Object.fromEntries(
                    [...fieldNamesByObject]
                        .filter(([, fieldApiNames]) => fieldApiNames.size > 0)
                        .map(([objectApiName, fieldApiNames]) => [objectApiName, [...fieldApiNames]])
                )] as [string, Record<string, string[]>])
                .filter(([, storedByObject]) => Object.keys(storedByObject).length > 0)
        );
        const storedFieldsByFolderName = toStoredFieldNames(treeSelections.excludedFieldApiNamesByFolderName);
        const storedCountsByFolderName: Record<string, Record<string, number>> = Object.fromEntries(
            [...treeSelections.objectCountsByFolderName]
                .filter(([, countsByObject]) => countsByObject.size > 0)
                .map(([folderName, countsByObject]) => [folderName, Object.fromEntries(countsByObject)])
        );
        try {
            await workspaceState.update(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY, {
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
                excludedObjectApiNamesByFolderName: storedByFolderName,
                excludedFieldApiNamesByFolderName: storedFieldsByFolderName,
                objectCountsByFolderName: storedCountsByFolderName,
                validationRulesOffByFolderName: toStoredFieldNames(treeSelections.validationRulesOffByFolderName)
            });
            return true;
        } catch (writeError) {
            VSCodeWorkspaceService.showWarningMessage(`The excluded objects, unticked fields, record counts and validation rule choices could not be saved: ${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}`);
            return false;
        }

    }

    /*
        The objects a card draws a clickable tree icon for: once each, those with a recipe -- what the
        panel resolves a card's objects to -- and never one written twice with no nickname to tell the
        occurrences apart, which the recipe writer refuses as well. A self-lookup's iteration has no
        icon of its own; it follows its object. The caller builds the name map ONCE per model: rebuilt
        per tree it made a load O(trees x objects), seconds at the scale the cockpit is measured at.
    */
    static collectSelectableObjectApiNames(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel): string[] {

        return [...new Set(tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .map(treeObject => treeObject.objectApiName))]
            .filter(objectApiName => objectsByApiName.has(objectApiName) && !objectsByApiName.get(objectApiName)?.hasIndistinctOccurrences);

    }

    // THE CASCADE OF ONE CARD, OR undefined WHEN NOTHING IN IT IS EXCLUDED -- WHICH LEAVES THE CARD'S MODEL AS IT ALWAYS WAS
    static buildObjectsByApiName(recipeViewModel: IRecipeCockpitRecipeViewModel): Map<string, IRecipeCockpitObjectViewModel> {
        return new Map(recipeViewModel.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));
    }

    /*
        Only objects WITH A RECIPE take part in the cascade: a lookup target with none (User) is never
        generated, so counting it as an "included parent" kept a child included that then moved to
        the top level with no parent at all.
    */
    static buildTreeObjectSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    directlyExcludedObjectApiNames: ReadonlySet<string> | undefined,
                                    noFieldsSelectedObjectApiNames: ReadonlySet<string> = new Set(),
                                    storedFieldsByObject?: ReadonlyMap<string, ReadonlySet<string>>): IRecipeCockpitTreeObjectSelectionViewModel | undefined {

        const selectableObjectApiNames = this.collectSelectableObjectApiNames(objectsByApiName, tree);
        const directlyExcluded = selectableObjectApiNames.filter(objectApiName => directlyExcludedObjectApiNames?.has(objectApiName));
        const noFieldsSelected = selectableObjectApiNames.filter(objectApiName => noFieldsSelectedObjectApiNames.has(objectApiName));
        const drawnTreeObjects = tree.objects.filter(treeObject => treeObject.iterationNickname === undefined && objectsByApiName.has(treeObject.objectApiName));
        const removedLookups = this.listRemovedTreeLookups(objectsByApiName, drawnTreeObjects, storedFieldsByObject);

        if ( directlyExcluded.length === 0 && noFieldsSelected.length === 0 && removedLookups.length === 0 ) {
            return undefined;
        }

        const objectSelection = RecipeCockpitObjectSelection.computeObjectSelection(drawnTreeObjects, directlyExcluded, noFieldsSelected, removedLookups);
        const drawnObjectApiNames = new Set(drawnTreeObjects.map(treeObject => treeObject.objectApiName));
        const excludedObjectApiNames = new Set(objectSelection.exclusions.map(exclusion => exclusion.objectApiName));

        return {
            exclusions: objectSelection.exclusions,
            disabledLookups: objectSelection.disabledLookups,
            includedObjectCount: [...drawnObjectApiNames].filter(objectApiName => !excludedObjectApiNames.has(objectApiName)).length,
            objectCount: drawnObjectApiNames.size
        };

    }

    /*
        A lookup field the reader unticked is no edge of the cascade (#677). An iteration follows its
        object, so only the first occurrence's entry counts -- keyed by its nickname once the object
        has iterations (#467), as the field rows read it.
    */
    static listRemovedTreeLookups(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    drawnTreeObjects: readonly IRecipeCockpitTreeObjectViewModel[],
                                    storedFieldsByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): IObjectSelectionRemovedLookup[] {
        return drawnTreeObjects.flatMap(treeObject => {
            const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
            const firstNickname = objectViewModel ? this.readOccurrenceNickname(objectViewModel) : undefined;
            const untickedFieldApiNames = this.pickStoredForOccurrence(storedFieldsByObject, treeObject.objectApiName, firstNickname);
            return treeObject.parentLookups
                .filter(parentLookup => untickedFieldApiNames?.has(parentLookup.fieldApiName))
                .map(parentLookup => ({ objectApiName: treeObject.objectApiName, fieldApiName: parentLookup.fieldApiName }));
        });
    }

    /*
        An object with every field unticked is cut off like an excluded one (#611), and cutting it off
        locks its children's lookups to it, which can leave a child with no field ticked: repeated
        until no new object is cut off. The set only grows, so it ends within the tree's object count.
    */
    static applyTreeObjectAndFieldSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                            tree: IRecipeCockpitTreeViewModel,
                                            directlyExcludedObjectApiNames: ReadonlySet<string> | undefined,
                                            storedFieldsByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): void {

        const noFieldsSelectedObjectApiNames = new Set<string>();

        for ( ;; ) {

            const objectSelection = this.buildTreeObjectSelection(objectsByApiName, tree, directlyExcludedObjectApiNames, noFieldsSelectedObjectApiNames, storedFieldsByObject);
            if ( objectSelection ) {
                tree.objectSelection = objectSelection;
            } else {
                delete tree.objectSelection;
            }

            const fieldSelection = this.buildTreeFieldSelection(objectsByApiName, tree, storedFieldsByObject);
            if ( fieldSelection ) {
                tree.fieldSelection = fieldSelection;
            } else {
                delete tree.fieldSelection;
            }

            // UNTICKING EVERY FIELD UNTICKS THE LOOKUP TOO: "NO FIELDS SELECTED" IS THE TRUER REASON, SO IT OUTRANKS A REMOVED LOOKUP (#677)
            const excludedObjectApiNames = new Set(( tree.objectSelection?.exclusions ?? [] )
                .filter(exclusion => exclusion.removedLookupFieldApiName === undefined)
                .map(exclusion => exclusion.objectApiName));
            const newlyCutOff = this.listTreeOccurrences(objectsByApiName, tree)
                .filter(occurrence => !occurrence.objectViewModel.isIterationOccurrence
                                        && !excludedObjectApiNames.has(occurrence.objectApiName)
                                        && this.findObjectFieldSelection(tree, occurrence.objectViewModel)?.isEveryFieldExcluded)
                .map(occurrence => occurrence.objectApiName);

            if ( newlyCutOff.length === 0 ) {
                return;
            }
            newlyCutOff.forEach(objectApiName => noFieldsSelectedObjectApiNames.add(objectApiName));

        }

    }

    /*
        ONTO THE CARDS, IN PLACE: a card with nothing excluded carries no objectSelection at all, and
        one with no field unticked or locked carries no fieldSelection.
    */
    static applyObjectSelections(recipeViewModel: IRecipeCockpitRecipeViewModel,
                                    excludedObjectApiNamesByFolderName: Map<string, Set<string>>,
                                    excludedFieldApiNamesByFolderName: Map<string, Map<string, Set<string>>> = new Map(),
                                    onlyFolderName?: string,
                                    objectCountsByFolderName: Map<string, Map<string, number>> = new Map(),
                                    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>> = new Map(),
                                    validationRulesOffByFolderName: Map<string, Map<string, Set<string>>> = new Map()): IRecipeCockpitTreeViewModel[] {

        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            if ( onlyFolderName !== undefined && tree.folderName !== onlyFolderName ) {
                return;
            }

            delete tree.objectSelection;
            delete tree.fieldSelection;
            delete tree.objectCounts;
            delete tree.fixedValues;
            delete tree.validationRulesOff;

            if ( tree.folderName === '' ) {
                return;
            }

            this.applyTreeObjectAndFieldSelection(objectsByApiName, tree, excludedObjectApiNamesByFolderName.get(tree.folderName), excludedFieldApiNamesByFolderName.get(tree.folderName));

            const objectCounts = this.buildTreeObjectCounts(objectsByApiName, tree, objectCountsByFolderName.get(tree.folderName));

            if ( objectCounts.length > 0 ) {
                tree.objectCounts = objectCounts;
            }

            // AFTER THE SELECTIONS, WHICH DECIDE WHAT A LOCK HOLDS BACK
            const fixedValues = this.buildTreeFixedValues(objectsByApiName, tree, fixedValuesByFolderName.get(tree.folderName));

            if ( fixedValues.length > 0 ) {
                tree.fixedValues = fixedValues;
            }

            // AFTER THE FIXED VALUES, WHICH LOCK A FIELD'S RULES
            const validationRulesOff = this.buildTreeValidationRulesOff(objectsByApiName, tree, validationRulesOffByFolderName.get(tree.folderName));

            if ( validationRulesOff.length > 0 ) {
                tree.validationRulesOff = validationRulesOff;
            }

        });

        return recipeViewModel.trees;

    }

    /*
        What a card's fixed-values file (#342) pins, read beside its recipe: only a file inside the
        workspace, and only a field whose every recorded occurrence still holds the line the pin
        wrote -- one edited by hand since is the reader's line now, so it is not drawn as pinned, and
        a notice says so. A file that is there and cannot be read pins nothing, with a notice.
    */
    static readPinnedFixedValues(recipeFilePath: string, workspaceRoot: string, recipeText: string | undefined): { valuesByObject: Map<string, Map<string, string>>; orgRecordLookups: IRecipeCockpitOrgRecordLookupViewModel[]; notices: string[] } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const fixedValueFileLabel = path.basename(fixedValueFilePath);
        const fixedValueRead = this.readFixedValueFile(fixedValueFilePath, workspaceRoot);

        if ( fixedValueRead.isUnreadable ) {
            return { valuesByObject: new Map(), orgRecordLookups: [], notices: [`"${fixedValueFileLabel}" is not a fixed-values file the Recipe Cockpit can read, so no field of its recipe is shown as pinned.`] };
        }
        if ( fixedValueRead.entries.length === 0 || recipeText === undefined ) {
            return { valuesByObject: new Map(), orgRecordLookups: [], notices: [] };
        }

        // ONE SCAN FOR EVERY PIN OF THE FILE: A CHECK PER PIN OVER THE WHOLE RECIPE WAS ~200 ms EACH AT 11,000 OBJECTS
        const changedFlags = RecipeCockpitRecipeWriter.listChangedPinnedFields(recipeText, fixedValueRead.entries.map(entry => ({
            objectApiName: entry.objectApiName,
            fieldApiName: entry.fieldApiName,
            restoreRequests: this.buildPinnedFieldRestoreRequests(entry, undefined)
        })));
        const changedFieldLabels = fixedValueRead.entries.filter((_entry, entryIndex) => changedFlags[entryIndex]).map(entry => `${this.describeOccurrence(entry.objectApiName, entry.scopeNickname)}.${entry.fieldApiName}`);
        const currentEntries = fixedValueRead.entries.filter((_entry, entryIndex) => !changedFlags[entryIndex]);

        return {
            valuesByObject: RecipeCockpitFixedValueStore.listValuesByObject(currentEntries),
            orgRecordLookups: currentEntries.flatMap(entry => entry.orgRecord ? [{
                objectApiName: entry.objectApiName,
                fieldApiName: entry.fieldApiName,
                recordId: entry.value,
                parentObjectApiName: entry.orgRecord.parentObjectApiName,
                orgLabel: entry.orgRecord.orgAlias ?? entry.orgRecord.orgUsername
            }] : []),
            notices: changedFieldLabels.length > 0
                ? [`${changedFieldLabels.join(', ')} ${changedFieldLabels.length === 1 ? 'was' : 'were'} changed in the recipe since ${changedFieldLabels.length === 1 ? 'it was' : 'they were'} pinned, so ${changedFieldLabels.length === 1 ? 'it is' : 'they are'} not shown as pinned. "${fixedValueFileLabel}" still holds the earlier ${changedFieldLabels.length === 1 ? 'value' : 'values'}.`]
                : []
        };

    }

    // NO FILE IS NO ENTRIES; ONE OUTSIDE THE WORKSPACE IS NEVER READ
    static readFixedValueFile(fixedValueFilePath: string, workspaceRoot: string): IFixedValueFileRead {

        if ( !this.isUsableWorkspacePath(fixedValueFilePath, workspaceRoot) ) {
            return { entries: [], isUnreadable: false };
        }

        try {
            return RecipeCockpitFixedValueStore.parse(fs.readFileSync(fixedValueFilePath, 'utf-8'));
        } catch {
            return { entries: [], isUnreadable: true };
        }

    }

    // EACH RECORDED OCCURRENCE, WITH ITS ORIGINAL LINES WHEN THE FILE KEPT THEM AND THE RE-DERIVED VALUE OTHERWISE
    static buildPinnedFieldRestoreRequests(entry: IFixedValueEntry, fallbackValueText: string | undefined): IPinnedFieldRestoreRequest[] {
        return entry.occurrences.map(occurrence => ({
            occurrenceIndex: occurrence.occurrenceIndex,
            ...( occurrence.nickname !== undefined ? { nickname: occurrence.nickname } : {} ),
            writtenLine: occurrence.writtenLine,
            ...( occurrence.originalText !== undefined ? { originalText: occurrence.originalText } : {} ),
            ...( occurrence.originalText === undefined && fallbackValueText !== undefined ? { valueText: fallbackValueText } : {} )
        }));
    }

    // THE KIND A FIELD'S FIXED VALUE IS WRITTEN AS (#262), FROM ITS METADATA TYPE; A FIELD OF NO KNOWN TYPE IS TEXT
    static getFixedValueKind(fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        if ( fieldViewModel.fieldType === 'Checkbox' ) {
            return 'boolean';
        }
        return RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES.includes(fieldViewModel.fieldType) || this.findGeolocationComponent(fieldViewModel) !== undefined ? 'number' : 'text';
    }

    // AN EDITED "${{ ... }}" IS AN EXPRESSION (#356), ANYTHING ELSE A LITERAL OF THE FIELD'S OWN KIND
    static resolveFixedValueKind(value: string, fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        return value.startsWith(RECIPE_COCKPIT_EXPRESSION_OPENER) ? 'expression' : this.getFixedValueKind(fieldViewModel);
    }

    // Latitude OR Longitude FOR A CUSTOM GEOLOCATION FIELD'S COMPONENT, WHICH GENERATE TREECIPE LISTS AS Text
    static findGeolocationComponent(fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {
        return fieldViewModel.fieldType === 'Text'
            ? Object.keys(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES).find(componentKey => fieldViewModel.fieldApiName.endsWith(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[componentKey].suffix))
            : undefined;
    }

    /*
        Why a field cannot be given a fixed value (#262), or undefined when it can. A field the tree or
        the insert decides -- RecordTypeId, a dependent picklist whose value a controlling value
        chooses, a field Salesforce sets from another lookup (#680) -- keeps its expression, and so
        does any field a #220 lock holds or the reader unticked: a fixed value on a field generation leaves out would never be written. A lookup is
        open (#627): it takes a record's Id (findLookupValueRefusal). The panel draws the same rule
        from the same model.
    */
    static findFixedValueLockReason(tree: IRecipeCockpitTreeViewModel,
                                    objectViewModel: IRecipeCockpitObjectViewModel,
                                    fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( this.listExcludedObjectApiNames(tree).includes(objectViewModel.objectApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON;
        }

        const objectFieldSelection = this.findObjectFieldSelection(tree, objectViewModel);
        const lockedField = objectFieldSelection?.lockedFields.find(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName);

        if ( lockedField ) {
            return lockedField.reason;
        }
        if ( objectFieldSelection?.excludedFieldApiNames.includes(fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON;
        }
        if ( fieldViewModel.fieldApiName === 'RecordTypeId' ) {
            return RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON;
        }

        const derivedField = StandardDerivedFields.resolveDerivedField(objectViewModel.objectApiName, fieldViewModel.fieldApiName);
        if ( derivedField ) {
            return `${RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX}${derivedField.throughFieldApiName}`;
        }

        const readOnlyReason = ReadOnlyFields.readReason(fieldViewModel.recipeValue);
        if ( readOnlyReason ) {
            return `${RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX}${readOnlyReason}`;
        }

        if ( fieldViewModel.controllingField ) {
            return `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}${fieldViewModel.controllingField}`;
        }

        return undefined;

    }

    // A FIELD OF A LOOKUP TYPE, OR ONE THE TREE WIRES TO A PARENT (A STANDARD FIELD #400 MAPS CAN HAVE NO LOOKUP TYPE IN ITS XML)
    static isLookupField(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel): boolean {
        return RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES.includes(fieldViewModel.fieldType)
                || tree.objects.some(treeObject => treeObject.objectApiName === objectApiName
                                                    && treeObject.parentLookups.some(parentLookup => parentLookup.fieldApiName === fieldViewModel.fieldApiName));
    }

    // WHY A VALUE TYPED INTO A LOOKUP'S PENCIL (#627) IS NOT SAVED: ONLY A RECORD Id SURVIVES THE TREE INSERT
    static findLookupValueRefusal(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel, value: string): string | undefined {
        return this.isLookupField(tree, objectApiName, fieldViewModel) && !RecipeCockpitFixedValueStore.isSalesforceRecordId(value)
            ? `Not saved: ${objectApiName}.${fieldViewModel.fieldApiName} ${RECIPE_COCKPIT_LOOKUP_VALUE_REFUSAL_SUFFIX}`
            : undefined;
    }

    /*
        The fixed values a card generates with (#262): only for a field a pin is drawn for -- a
        selectable object's field with a line in the recipe -- and that no lock holds back now. A
        held-back value stays stored, as an excluded object's count does, and comes back with its
        field. A value its field's kind could not write (a field whose type changed since) is dropped
        here rather than refused at Run Faker.
    */
    static buildTreeFixedValues(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                tree: IRecipeCockpitTreeViewModel,
                                storedFixedValuesByObject: ReadonlyMap<string, ReadonlyMap<string, string>> | undefined): IRecipeCockpitFixedValueViewModel[] {

        if ( !storedFixedValuesByObject || storedFixedValuesByObject.size === 0 ) {
            return [];
        }

        return this.listTreeOccurrences(objectsByApiName, tree).flatMap(({ objectApiName, nickname, objectViewModel }) => {

            // A PIN IS IN THE RECIPE FILE, SO AN OCCURRENCE OF AN OBJECT WITH iterations IS PINNED ONLY WHERE THE FILE SAYS IT IS (#467)
            const storedByField = storedFixedValuesByObject.get(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname));

            if ( !storedByField ) {
                return [];
            }

            const selectableFieldApiNames = new Set(this.listSelectableFieldApiNames(objectViewModel));
            const orgRecordLookup = (fieldViewModel: IRecipeCockpitFieldViewModel) => this.findOrgRecordLookup(tree, objectApiName, fieldViewModel.fieldApiName, storedByField.get(fieldViewModel.fieldApiName));
            return objectViewModel.fields
                .filter((fieldViewModel, fieldIndex) => selectableFieldApiNames.has(fieldViewModel.fieldApiName)
                                                        && storedByField.has(fieldViewModel.fieldApiName)
                                                        && objectViewModel.fields.findIndex(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName) === fieldIndex
                                                        && this.findFixedValueLockReason(tree, objectViewModel, fieldViewModel) === undefined
                                                        && this.findLookupValueRefusal(tree, objectApiName, fieldViewModel, storedByField.get(fieldViewModel.fieldApiName) as string) === undefined)
                .map(fieldViewModel => {
                    const fieldOrgRecordLookup = orgRecordLookup(fieldViewModel);
                    const value = storedByField.get(fieldViewModel.fieldApiName) as string;
                    return {
                        objectApiName: objectApiName,
                        ...( nickname !== undefined ? { nickname: nickname } : {} ),
                        fieldApiName: fieldViewModel.fieldApiName,
                        value: value,
                        // AN Id IS TEXT, SO BOTH BACKENDS LOAD THE DOUBLE-QUOTED LINE AS A STRING
                        kind: fieldOrgRecordLookup ? 'text' as RecipeFixedValueKind : this.resolveFixedValueKind(value, fieldViewModel),
                        ...( fieldOrgRecordLookup ? { orgRecord: { orgLabel: fieldOrgRecordLookup.orgLabel, parentObjectApiName: fieldOrgRecordLookup.parentObjectApiName } } : {} )
                    };
                })
                .filter(fixedValue => RecipeCockpitRecipeWriter.checkFixedValue(fixedValue) === undefined);

        });

    }

    /*
        A card's objects, each occurrence that takes its own settings once (#467): the first
        occurrence of every selectable object, then each of its iterations the card lists, built as
        the panel builds an iteration's row (buildIterationObjectViewModel). An object with no
        iteration is one occurrence with no nickname.
    */
    /*
        Built once per tree and objects map, and reused while both are the same: a load builds every
        card's field selection, counts, fixed values, rule switches and allow-lists from it, and each
        rebuilt it, copying every iteration's fields, five times per tree. onlyObjectApiName narrows a
        message about one object to that object's occurrences, never the whole model's.
    */
    private static readonly treeOccurrencesByTree = new WeakMap<IRecipeCockpitTreeViewModel, { objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>; occurrences: IRecipeCockpitTreeOccurrence[] }>();

    static listTreeOccurrences(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, onlyObjectApiName?: string): IRecipeCockpitTreeOccurrence[] {

        const cached = onlyObjectApiName === undefined ? this.treeOccurrencesByTree.get(tree) : undefined;
        if ( cached && cached.objectsByApiName === objectsByApiName ) {
            return cached.occurrences;
        }

        const listedIterationKeys = new Set(tree.objects
            .filter(treeObject => treeObject.iterationNickname !== undefined && ( onlyObjectApiName === undefined || treeObject.objectApiName === onlyObjectApiName ))
            .map(treeObject => RecipeCockpitRecipeWriter.buildOccurrenceKey(treeObject.objectApiName, treeObject.iterationNickname)));
        const objectApiNames = onlyObjectApiName === undefined
            ? this.collectSelectableObjectApiNames(objectsByApiName, tree)
            : this.collectSelectableObjectApiNames(objectsByApiName, tree).filter(objectApiName => objectApiName === onlyObjectApiName);

        const occurrences = objectApiNames.flatMap(objectApiName => {
            const objectViewModel = objectsByApiName.get(objectApiName) as IRecipeCockpitObjectViewModel;
            const firstNickname = this.readOccurrenceNickname(objectViewModel);
            return [
                { objectApiName: objectApiName, ...( firstNickname !== undefined ? { nickname: firstNickname } : {} ), objectViewModel: objectViewModel },
                ...( firstNickname === undefined ? [] : objectViewModel.iterations ?? [] )
                    .filter(iteration => listedIterationKeys.has(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, iteration.nickname)))
                    .map(iteration => ({ objectApiName: objectApiName, nickname: iteration.nickname, objectViewModel: this.buildIterationObjectViewModel(objectViewModel, iteration) }))
            ];
        });

        if ( onlyObjectApiName === undefined ) {
            this.treeOccurrencesByTree.set(tree, { objectsByApiName: objectsByApiName, occurrences: occurrences });
        }

        return occurrences;

    }

    /*
        The occurrence a setting is kept for: an object with iterations has one per nickname, one
        without none (#467). A hand-edited recipe whose nicknames are not all api names keeps its
        object's settings, as before #467: an occurrence key of such a nickname is one the filtered
        copy refuses.
    */
    static readOccurrenceNickname(objectViewModel: IRecipeCockpitObjectViewModel): string | undefined {
        if ( objectViewModel.isIterationOccurrence ) {
            return objectViewModel.nickname;
        }
        return objectViewModel.nickname !== undefined && ( objectViewModel.iterations?.length ?? 0 ) > 0
                && SalesforceApiName.isApiName(objectViewModel.nickname)
                && ( objectViewModel.iterations ?? [] ).every(iteration => SalesforceApiName.isApiName(iteration.nickname))
            ? objectViewModel.nickname
            : undefined;
    }

    /*
        An iteration as its own object (#467), as the panel's buildIterationObject draws its row:
        every field of the object, with the iteration's line and value where it writes the field and
        no line where it does not, then the fields only it writes. Its count and parent are its own.
    */
    static buildIterationObjectViewModel(objectViewModel: IRecipeCockpitObjectViewModel, iteration: IRecipeCockpitObjectIterationViewModel): IRecipeCockpitObjectViewModel {

        // HOST-ONLY COPIES BUILT PER ITERATION ON EVERY LOAD: Object.assign AND PLAIN ASSIGNMENTS, SINCE AN ES6 TARGET TURNS OBJECT REST INTO A KEY-BY-KEY HELPER (~0.5 s AT 11,000 ITERATIONS)
        const iterationFieldsByApiName = new Map(iteration.fields.map(iterationField => [iterationField.fieldApiName, iterationField]));
        const objectFieldApiNames = new Set<string>();
        const fields: IRecipeCockpitFieldViewModel[] = objectViewModel.fields.map(fieldViewModel => {
            objectFieldApiNames.add(fieldViewModel.fieldApiName);
            const iterationField = iterationFieldsByApiName.get(fieldViewModel.fieldApiName);
            const occurrenceField: IRecipeCockpitFieldViewModel = Object.assign({}, fieldViewModel);
            occurrenceField.lineNumber = iterationField?.lineNumber;
            occurrenceField.todos = undefined;
            if ( iterationField ) {
                occurrenceField.recipeValue = iterationField.recipeValue;
            }
            return occurrenceField;
        });
        iteration.fields
            .filter(iterationField => !objectFieldApiNames.has(iterationField.fieldApiName))
            .forEach(iterationField => fields.push({
                fieldApiName: iterationField.fieldApiName,
                fieldLabel: '',
                fieldType: '',
                fieldTypeWithSize: '',
                recipeValue: iterationField.recipeValue,
                controllingField: '',
                isOnlyInRecipeFile: true,
                lineNumber: iterationField.lineNumber
            } as IRecipeCockpitFieldViewModel));

        const occurrenceObject: IRecipeCockpitObjectViewModel = Object.assign({}, objectViewModel);
        occurrenceObject.lineNumber = iteration.lineNumber;
        occurrenceObject.nickname = iteration.nickname;
        occurrenceObject.isIterationOccurrence = true;
        occurrenceObject.fields = fields;
        occurrenceObject.recordCount = iteration.recordCount;
        occurrenceObject.countParentObjectApiName = iteration.parentObjectApiName;
        occurrenceObject.parentNickname = iteration.parentNickname;
        occurrenceObject.iterations = undefined;
        occurrenceObject.recipeNickname = undefined;
        occurrenceObject.todos = undefined;

        return occurrenceObject;

    }

    // AN OCCURRENCE'S OWN STORED ENTRY, ELSE ITS OBJECT'S -- AN ENTRY STORED BEFORE #467 APPLIES TO EVERY OCCURRENCE
    static pickStoredForOccurrence<T>(storedByKey: ReadonlyMap<string, T> | undefined, objectApiName: string, nickname: string | undefined): T | undefined {
        const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname);
        return nickname !== undefined && storedByKey?.has(occurrenceKey) ? storedByKey.get(occurrenceKey) : storedByKey?.get(objectApiName);
    }

    // THE FIELD SELECTION THE HOST DECIDED FOR ONE OCCURRENCE (#467), OR ITS OBJECT'S WHEN THE OBJECT HAS ONE OCCURRENCE
    static findObjectFieldSelection(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel): IRecipeCockpitObjectFieldSelectionViewModel | undefined {
        const nickname = this.readOccurrenceNickname(objectViewModel);
        return ( tree.fieldSelection?.objects ?? [] ).find(candidate => candidate.objectApiName === objectViewModel.objectApiName && candidate.nickname === nickname);
    }

    // THE ORG RECORD A LOOKUP'S PINNED VALUE IS (#421), ONLY WHILE THE VALUE IS STILL THAT Id
    // THE STORED PARENT MUST BE THE FIELD'S ONE TREE PARENT: THE FIXED-VALUES FILE IS WORKSPACE TEXT, AND THE INSERT CHECKS THE Id AS A RECORD OF IT
    static findOrgRecordLookup(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldApiName: string, value: string | undefined): IRecipeCockpitOrgRecordLookupViewModel | undefined {

        const orgRecordLookup = value === undefined
            ? undefined
            : ( tree.orgRecordLookups ?? [] ).find(candidate => candidate.objectApiName === objectApiName && candidate.fieldApiName === fieldApiName && candidate.recordId === value);
        if ( !orgRecordLookup ) {
            return undefined;
        }

        const parentObjectApiNames = new Set(tree.objects
            .filter(treeObject => treeObject.objectApiName === objectApiName)
            .flatMap(treeObject => treeObject.parentLookups.filter(parentLookup => parentLookup.fieldApiName === fieldApiName).map(parentLookup => parentLookup.parentObjectApiName)));

        return parentObjectApiNames.size === 1 && parentObjectApiNames.has(orgRecordLookup.parentObjectApiName) ? orgRecordLookup : undefined;

    }

    /*
        Why a field's validation-rule checkbox is disabled (#325), or undefined when it can be clicked:
        a field with no applied rule draws no box at all, and one generation leaves out (its object
        excluded, the field unticked or its parent excluded) or writes a fixed value for has nothing
        the rules would shape. Every other #220 lock keeps the field generated, so it is no reason
        here. The panel draws the same rule from the same model.
    */
    static findValidationRuleLockReason(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( !this.hasSwitchableValidationRules(fieldViewModel) ) {
            return RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL;
        }
        if ( this.listExcludedObjectApiNames(tree).includes(objectViewModel.objectApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON;
        }

        const objectFieldSelection = this.findObjectFieldSelection(tree, objectViewModel);
        const lockedField = objectFieldSelection?.lockedFields.find(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName);

        if ( lockedField?.reason === RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON ) {
            return lockedField.reason;
        }
        if ( objectFieldSelection?.excludedFieldApiNames.includes(fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON;
        }
        if ( ( tree.fixedValues ?? [] ).some(fixedValue => fixedValue.objectApiName === objectViewModel.objectApiName && fixedValue.nickname === this.readOccurrenceNickname(objectViewModel)
                                                            && fixedValue.fieldApiName === fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON;
        }
        return undefined;

    }

    // HOW A DIALOG OR NOTIFICATION NAMES ONE OCCURRENCE: "Account · Account_child_NickName", OR THE OBJECT ALONE -- NO PARENTHESES, WHICH A NOTIFICATION ESCAPES
    static describeOccurrence(objectApiName: string, nickname: string | undefined): string {
        return nickname === undefined ? objectApiName : `${objectApiName} · ${nickname}`;
    }

    static hasSwitchableValidationRules(fieldViewModel: IRecipeCockpitFieldViewModel): boolean {
        return fieldViewModel.lineNumber !== undefined && ( fieldViewModel.validationRules?.appliedRuleNames.length ?? 0 ) > 0;
    }

    /*
        The rule-shaped fields a card generates WITHOUT their rules (#325): those the reader unticked.
        Only fields a box is drawn for and no lock holds back; a held-back untick stays stored and
        comes back.
    */
    static buildTreeValidationRulesOff(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                        tree: IRecipeCockpitTreeViewModel,
                                        storedRulesOffByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): IRecipeCockpitFieldReferenceViewModel[] {

        if ( !storedRulesOffByObject || storedRulesOffByObject.size === 0 ) {
            return [];
        }

        return this.listTreeOccurrences(objectsByApiName, tree).flatMap(({ objectApiName, nickname, objectViewModel }) => {

            const storedFieldApiNames = this.pickStoredForOccurrence(storedRulesOffByObject, objectApiName, nickname);
            const listedFieldApiNames = new Set<string>();

            // THE CHEAP "IS IT SWITCHED OFF" TEST FIRST, SO A CARD WITH NOTHING OFF NEVER SCANS ITS FIELDS FOR DUPLICATES
            return objectViewModel.fields
                .filter(fieldViewModel => !!storedFieldApiNames?.has(fieldViewModel.fieldApiName)
                                            && this.hasSwitchableValidationRules(fieldViewModel)
                                            && !listedFieldApiNames.has(fieldViewModel.fieldApiName)
                                            && this.findValidationRuleLockReason(tree, objectViewModel, fieldViewModel) === undefined
                                            && !!listedFieldApiNames.add(fieldViewModel.fieldApiName))
                .map(fieldViewModel => ({ objectApiName: objectApiName, ...( nickname !== undefined ? { nickname: nickname } : {} ), fieldApiName: fieldViewModel.fieldApiName }));

        });

    }

    /*
        Why a value typed for a field cannot be its fixed value (#262), or undefined. Checked while it
        is typed and again once the box closes, against the field as the model holds it: the writer's
        own refusals first (a line break, a template opener), then the field's type -- a number that
        fits its precision and scale, true or false for a checkbox, an ISO date or date-time, text no
        longer than its length, and a picklist value its metadata declares (each, for a multi-select).
        A picklist with no declared values to hold it to takes any value.
    */
    static validateFixedValueInput(value: string, fieldViewModel: IRecipeCockpitFieldViewModel, declaredPicklistValues: readonly string[] | undefined): string | undefined {

        if ( value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH ) {
            return `A fixed value can be at most ${RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH} characters.`;
        }

        const kind = this.resolveFixedValueKind(value, fieldViewModel);
        const writerRefusal = RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: kind });

        // AN EXPRESSION IS NOT A VALUE OF THE FIELD'S TYPE, SO THE WRITER'S SHAPE IS ALL THERE IS TO HOLD IT TO
        if ( kind === 'expression' ) {
            return writerRefusal === undefined ? undefined : `This expression ${writerRefusal} Type one \${{ ... }} on one line, or a value with no \${{.`;
        }

        if ( writerRefusal !== undefined ) {
            if ( kind === 'number' ) {
                return 'Type a plain number, such as 42, -7 or 3.25.';
            }
            if ( kind === 'boolean' ) {
                return 'Type true or false.';
            }
            return `This value ${writerRefusal}`;
        }

        const sizeMatch = /\((\d+)(?:,(\d+))?\)$/.exec(fieldViewModel.fieldTypeWithSize);
        // AN INPUT BOX DRAWS ITS VALIDATION MESSAGE LIKE A NOTIFICATION, SO THE TYPE -- WORKSPACE TEXT -- IS ESCAPED UNLESS IT IS PLAINLY A TYPE
        const typeLabel = this.buildFieldTypeLabel(fieldViewModel);

        if ( kind === 'number' && sizeMatch?.[2] !== undefined ) {
            const precision = Number(sizeMatch[1]);
            const scale = Number(sizeMatch[2]);
            const [wholeDigits, decimalDigits = ''] = value.replace(/^-/, '').split('.');
            if ( decimalDigits.length > scale ) {
                return `${typeLabel} takes at most ${scale} decimal place${scale === 1 ? '' : 's'}.`;
            }
            // A LONE 0 BEFORE THE POINT IS NO DIGIT: Number(2,2) TAKES 0.5
            if ( wholeDigits.replace(/^0+/, '').length > precision - scale ) {
                return `${typeLabel} takes at most ${precision - scale} digit${precision - scale === 1 ? '' : 's'} before the decimal point.`;
            }
        }

        const geolocationComponent = this.findGeolocationComponent(fieldViewModel);
        if ( geolocationComponent !== undefined ) {
            const limit = RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[geolocationComponent].limit;
            if ( Math.abs(Number(value)) > limit ) {
                return `A ${geolocationComponent.toLowerCase()} is a number from -${limit} to ${limit}.`;
            }
        }

        if ( kind === 'text' && sizeMatch && sizeMatch[2] === undefined && value.length > Number(sizeMatch[1]) ) {
            return `${typeLabel} takes at most ${sizeMatch[1]} characters.`;
        }

        if ( fieldViewModel.fieldType === 'Date' && !this.isIsoDate(value) ) {
            return 'Type a date as YYYY-MM-DD, such as 2026-01-31.';
        }

        if ( fieldViewModel.fieldType === 'DateTime' && !this.isIsoDateTime(value) ) {
            return 'Type a date and time as ISO 8601 with a zone, such as 2026-01-31T09:30:00Z.';
        }

        if ( fieldViewModel.isPicklist && declaredPicklistValues && declaredPicklistValues.length > 0 ) {
            const declaredValues = new Set(declaredPicklistValues);
            const typedValues = fieldViewModel.fieldType === 'MultiselectPicklist' ? value.split(';') : [value];
            const undeclaredValue = typedValues.find(typedValue => !declaredValues.has(typedValue));
            if ( undeclaredValue !== undefined ) {
                return `"${RecipeYamlScalar.escapeForNotification(undeclaredValue)}" is not a value this picklist declares.`;
            }
            if ( new Set(typedValues).size !== typedValues.length ) {
                return 'A multi-select picklist value names each value once.';
            }
        }

        return undefined;

    }

    // "Text(50)" AS IT IS -- NO LINK CAN BE MADE OF IT -- AND ANYTHING ELSE THE WRAPPER SAYS THROUGH escapeForNotification
    static buildFieldTypeLabel(fieldViewModel: IRecipeCockpitFieldViewModel): string {
        return /^[A-Za-z]+(?:\(\d+(?:,\d+)?\))?$/.test(fieldViewModel.fieldTypeWithSize)
            ? fieldViewModel.fieldTypeWithSize
            : RecipeYamlScalar.escapeForNotification(fieldViewModel.fieldTypeWithSize);
    }

    static isIsoDate(value: string): boolean {
        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if ( !dateMatch ) {
            return false;
        }
        const parsedDate = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
        return parsedDate.getUTCFullYear() === Number(dateMatch[1])
                && parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1
                && parsedDate.getUTCDate() === Number(dateMatch[3]);
    }

    static isIsoDateTime(value: string): boolean {
        const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
        return !!dateTimeMatch && this.isIsoDate(dateTimeMatch[1]) && !Number.isNaN(Date.parse(value));
    }

    /*
        The counts a card generates with that are not the recipe's own (#255): only an object the card
        draws a count box for -- selectable, with a readable "count:" -- and only where the stored
        count differs, so a stale or no-longer-different count is dropped silently. An excluded
        object keeps its count here: it is not generated, and re-including it brings the count back.
    */
    static buildTreeObjectCounts(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    storedCountsByObject: ReadonlyMap<string, number> | undefined): IRecipeCockpitObjectCountViewModel[] {

        if ( !storedCountsByObject || storedCountsByObject.size === 0 ) {
            return [];
        }

        // A COUNT STORED BEFORE #467 WAS THE FIRST OCCURRENCE'S "count:" AND NEVER AN ITERATION'S, SO IT STILL IS
        return this.listTreeOccurrences(objectsByApiName, tree)
            .map(({ objectApiName, nickname, objectViewModel }) => ({
                objectApiName: objectApiName,
                nickname: nickname,
                recordCount: objectViewModel.recordCount,
                storedCount: objectViewModel.isIterationOccurrence
                    ? storedCountsByObject.get(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname))
                    : this.pickStoredForOccurrence(storedCountsByObject, objectApiName, nickname)
            }))
            .filter(({ recordCount, storedCount }) => recordCount !== undefined && storedCount !== undefined && storedCount !== recordCount)
            .map(({ objectApiName, nickname, storedCount }) => ({ objectApiName: objectApiName, ...( nickname !== undefined ? { nickname: nickname } : {} ), count: storedCount as number }));

    }

    // THE FIELDS A CHECKBOX IS DRAWN FOR: THOSE WITH A LINE IN THE RECIPE, WHICH IS WHAT THE FILTER CAN LEAVE OUT
    static listSelectableFieldApiNames(objectViewModel: IRecipeCockpitObjectViewModel): string[] {
        return [...new Set(objectViewModel.fields.filter(fieldViewModel => fieldViewModel.lineNumber !== undefined).map(fieldViewModel => fieldViewModel.fieldApiName))];
    }

    /*
        One object's fields as generation will see them (#220). A lock holds a field ticked whatever
        the reader stored: RecordTypeId while a record-type section depends on it, and a controlling
        field while any of its dependents is ticked -- a "when:" naming a field the record does not
        have chooses nothing. A dependent can control another, so the locks are found to a fixed
        point. A lookup the object cascade disabled is left out by that cascade, never here.
    */
    static buildObjectFieldSelection(objectViewModel: IRecipeCockpitObjectViewModel,
                                        storedExcludedFieldApiNames: ReadonlySet<string> | undefined,
                                        parentExcludedFieldApiNames: ReadonlySet<string>): IRecipeCockpitObjectFieldSelectionViewModel | undefined {

        const selectableFieldApiNames = this.listSelectableFieldApiNames(objectViewModel);
        const selectableFieldSet = new Set(selectableFieldApiNames);
        const lockReasonsByFieldApiName = new Map<string, string>();

        selectableFieldApiNames
            .filter(fieldApiName => parentExcludedFieldApiNames.has(fieldApiName))
            .forEach(fieldApiName => lockReasonsByFieldApiName.set(fieldApiName, RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON));

        if ( objectViewModel.hasRecordTypeSections && selectableFieldSet.has('RecordTypeId') && !lockReasonsByFieldApiName.has('RecordTypeId') ) {
            lockReasonsByFieldApiName.set('RecordTypeId', RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON);
        }

        const excludedFieldSet = new Set(selectableFieldApiNames.filter(fieldApiName => storedExcludedFieldApiNames?.has(fieldApiName) && !lockReasonsByFieldApiName.has(fieldApiName)));
        const dependentsByControllingField = new Map<string, string[]>();
        objectViewModel.fields
            .filter(fieldViewModel => fieldViewModel.controllingField && selectableFieldSet.has(fieldViewModel.fieldApiName) && selectableFieldSet.has(fieldViewModel.controllingField))
            .forEach(fieldViewModel => {
                const dependentFieldApiNames = dependentsByControllingField.get(fieldViewModel.controllingField) ?? [];
                dependentFieldApiNames.push(fieldViewModel.fieldApiName);
                dependentsByControllingField.set(fieldViewModel.controllingField, dependentFieldApiNames);
            });

        const isTickedForGeneration = (fieldApiName: string) => !excludedFieldSet.has(fieldApiName) && !parentExcludedFieldApiNames.has(fieldApiName);
        for ( let isChanged = true; isChanged; ) {
            isChanged = false;
            dependentsByControllingField.forEach((dependentFieldApiNames, controllingFieldApiName) => {
                const tickedDependents = dependentFieldApiNames.filter(isTickedForGeneration);
                if ( tickedDependents.length > 0 && !lockReasonsByFieldApiName.has(controllingFieldApiName) ) {
                    lockReasonsByFieldApiName.set(controllingFieldApiName, `${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}${tickedDependents.join(', ')}`);
                    isChanged = excludedFieldSet.delete(controllingFieldApiName) || isChanged;
                }
            });
        }

        const excludedFieldApiNames = selectableFieldApiNames.filter(fieldApiName => excludedFieldSet.has(fieldApiName));
        const lockedFields = selectableFieldApiNames
            .filter(fieldApiName => lockReasonsByFieldApiName.has(fieldApiName))
            .map(fieldApiName => ({ fieldApiName: fieldApiName, reason: lockReasonsByFieldApiName.get(fieldApiName) as string }));

        if ( excludedFieldApiNames.length === 0 && lockedFields.length === 0 ) {
            return undefined;
        }

        const isEveryFieldExcluded = excludedFieldApiNames.length > 0 && selectableFieldApiNames.every(fieldApiName => !isTickedForGeneration(fieldApiName));

        const nickname = this.readOccurrenceNickname(objectViewModel);

        return {
            objectApiName: objectViewModel.objectApiName,
            ...( nickname !== undefined ? { nickname: nickname } : {} ),
            excludedFieldApiNames: excludedFieldApiNames,
            lockedFields: lockedFields,
            ...( isEveryFieldExcluded ? { isEveryFieldExcluded: true as const } : {} )
        };

    }

    static buildTreeFieldSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    storedFieldsByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): IRecipeCockpitTreeFieldSelectionViewModel | undefined {

        const parentExcludedFieldsByObject = new Map<string, Set<string>>();
        ( tree.objectSelection?.disabledLookups ?? [] ).forEach(disabledLookup => {
            const parentExcludedFieldApiNames = parentExcludedFieldsByObject.get(disabledLookup.objectApiName) ?? new Set<string>();
            parentExcludedFieldApiNames.add(disabledLookup.fieldApiName);
            parentExcludedFieldsByObject.set(disabledLookup.objectApiName, parentExcludedFieldApiNames);
        });

        const objectFieldSelections = this.listTreeOccurrences(objectsByApiName, tree)
            .map(({ objectApiName, nickname, objectViewModel }) => this.buildObjectFieldSelection(
                objectViewModel,
                this.pickStoredForOccurrence(storedFieldsByObject, objectApiName, nickname),
                parentExcludedFieldsByObject.get(objectApiName) ?? new Set()
            ))
            .filter((objectFieldSelection): objectFieldSelection is IRecipeCockpitObjectFieldSelectionViewModel => !!objectFieldSelection);

        return objectFieldSelections.length > 0 ? { objects: objectFieldSelections } : undefined;

    }

    // EVERY OBJECT A CARD LEAVES OUT OF GENERATION, THE ONES FOLLOWING A PARENT INCLUDED
    static listExcludedObjectApiNames(tree: IRecipeCockpitTreeViewModel | undefined): string[] {
        return ( tree?.objectSelection?.exclusions ?? [] ).map(exclusion => exclusion.objectApiName);
    }

    /*
        Whether a path the model named can still be used: inside the workspace once symlinks are
        resolved -- the allow-list says the model named it, not where it resolves NOW -- and still
        on disk.
    */
    static isUsableWorkspacePath(candidatePath: string, workspaceRoot: string): boolean {

        return fs.existsSync(candidatePath)
                && SfdxProjectService.isPathContainedInWorkspace(path.resolve(candidatePath), path.resolve(workspaceRoot));

    }

}
