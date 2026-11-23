import * as path from 'path';
import * as vscode from 'vscode';
import {
    IRecipeFixedValue,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeTab
import type {
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitTreeOccurrence,
    IRecipeCockpitTreeSelections,
    IRecipeCockpitTreeViewModel,
    RecipeCockpitFieldEdit,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import type { IRecipeCockpitHubForTreecipeTab } from './RecipeCockpitTreecipeHost';
import {
    RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX,
    RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE,
    RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX
} from './RecipeCockpitFieldRowsConstants';
import { RecipeCockpitTreecipeRecipeEdits } from './RecipeCockpitTreecipeRecipeEdits';
import {
    IFixedValueEntry,
    RecipeCockpitFixedValueStore
} from './RecipeCockpitFixedValueStore';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { RECIPE_COCKPIT_PICKLIST_RESET_LABEL } from './RecipeCockpitTreecipeFieldEditorConstants';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';

/*
    What a tree card's Treecipe tab changes about a run (moved out of the hub by #688): which objects
    and fields it takes, how many records, a field's fixed value and a picklist's chosen values, the
    validation rules switched off, and resetting all of it. Selections are workspace state; a fixed
    value or a picklist choice is a recipe write, through RecipeCockpitTreecipeRecipeEdits. The hub
    checked the click against the drawn model before routing it here.
*/

// WHAT A FIELD'S INLINE EDITOR (#337) SAYS WHEN THE HOST DID NOT STORE WHAT WAS TYPED, FOR A REASON OTHER THAN THE VALUE
// A PIN WRITES THE RECIPE FILE (#342): HOW AN INLINE EDIT ENDS WHEN THAT WRITE DOES NOT HAPPEN
export const RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL = 'Not saved: the recipe file was not changed.';
export const RECIPE_COCKPIT_FIELD_EDIT_WRITE_RUNNING_REFUSAL = 'Not saved: another change to this recipe file is still being written. Try again once it finishes.';
export const RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL = 'Write to recipe';
export const RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL = 'Put back';
export const RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES = 12;
export const RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH = 800;
export const RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL = 'Reset';
export const RECIPE_COCKPIT_PICKLIST_CHOICE_UNCHANGED_REFUSAL = 'Nothing to save: the ticked values are what the field already generates.';
export const RECIPE_COCKPIT_PICKLIST_RESET_NOTHING_REFUSAL = 'Nothing to reset: the field has no edit, so it already generates what Generate Treecipe wrote.';

export class RecipeCockpitTreecipeSelection {

    /*
        Before one occurrence's entry is written, an entry its object holds from before #467 -- which
        applies to every occurrence -- is copied to each occurrence that has none and dropped, so
        changing one occurrence leaves every other exactly as it was, and no later write can fall back
        to it.
    */
    private static splitObjectWideEntry<T>(storedByKey: Map<string, T>, objectApiName: string, occurrenceNicknames: readonly string[], copyEntry: (entry: T) => T): void {
        if ( !storedByKey.has(objectApiName) ) {
            return;
        }
        const objectWideEntry = storedByKey.get(objectApiName) as T;
        occurrenceNicknames.forEach(occurrenceNickname => {
            const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, occurrenceNickname);
            if ( !storedByKey.has(occurrenceKey) ) {
                storedByKey.set(occurrenceKey, copyEntry(objectWideEntry));
            }
        });
        storedByKey.delete(objectApiName);
    }

    // THE nickname AN ACTION CARRIES: SET ONLY FOR AN OCCURRENCE OF AN OBJECT WITH iterations, SO AN OBJECT WRITTEN ONCE ROUTES AS IT DID
    static withOccurrenceNickname(occurrence: IRecipeCockpitTreeOccurrence): { nickname?: string } {
        return occurrence.nickname !== undefined ? { nickname: occurrence.nickname } : {};
    }

    static listNoFieldsSelectedObjectApiNames(tree: IRecipeCockpitTreeViewModel | undefined): string[] {
        return ( tree?.objectSelection?.exclusions ?? [] ).filter(exclusion => exclusion.kind === 'noFieldsSelected').map(exclusion => exclusion.objectApiName);
    }

    // A LEFT-OUT OBJECT'S FIELDS CANNOT BE CHANGED, EXCEPT ONE LEFT OUT FOR HAVING NONE TICKED (#611): TICKING ONE BRINGS IT BACK
    // RE-TICKING THE REMOVED LOOKUP IS HOW A CUT-OFF OBJECT COMES BACK (#677), SO ITS FIELDS STAY EDITABLE LIKE A NO-FIELDS OBJECT'S
    static listFieldReadOnlyObjectApiNames(tree: IRecipeCockpitTreeViewModel | undefined): string[] {
        return ( tree?.objectSelection?.exclusions ?? [] )
            .filter(exclusion => exclusion.kind !== 'noFieldsSelected' && exclusion.removedLookupFieldApiName === undefined)
            .map(exclusion => exclusion.objectApiName);
    }

    static async setObjectIncluded(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: { treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }) {

        // AN OBJECT WITH NO FIELD TICKED (#611) IS LEFT OUT UNTIL ONE IS: ITS CHAIN LINK IS A STATUS, NOT A BUTTON
        const postedTree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);
        if ( this.listNoFieldsSelectedObjectApiNames(postedTree).includes(panelAction.objectApiName) ) {
            return;
        }

        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        const excludedObjectApiNames = treeSelections.excludedObjectApiNamesByFolderName.get(panelAction.folderName) ?? new Set<string>();

        if ( panelAction.isIncluded ) {
            excludedObjectApiNames.delete(panelAction.objectApiName);
        } else {
            excludedObjectApiNames.add(panelAction.objectApiName);
        }
        treeSelections.excludedObjectApiNamesByFolderName.set(panelAction.folderName, excludedObjectApiNames);

        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        A field checkbox (#220). The host re-derives the card's state before it writes anything: a
        field of an excluded object is read-only, and a field a lock holds ticked cannot be unticked,
        so a message the panel should never have sent changes nothing.
    */
    static async setFieldIncluded(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldIncluded' }>) {

        const resolved = RecipeCockpitDrawnModel.resolvePostedOccurrence(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname);
        const tree = resolved?.tree;

        if ( !tree || this.listFieldReadOnlyObjectApiNames(tree).includes(panelAction.objectApiName) ) {
            return;
        }

        const isLocked = hub.findObjectFieldSelection(tree, resolved.occurrence.objectViewModel)
            ?.lockedFields.some(lockedField => lockedField.fieldApiName === panelAction.fieldApiName);

        if ( !panelAction.isIncluded && isLocked ) {
            return;
        }

        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        const excludedFieldsByObject = treeSelections.excludedFieldApiNamesByFolderName.get(panelAction.folderName) ?? new Map<string, Set<string>>();
        const selectionKey = this.prepareOccurrenceSelectionKey(hub, excludedFieldsByObject, panelState, tree, panelAction.objectApiName, panelAction.nickname, fieldApiNames => new Set(fieldApiNames));
        const excludedFieldApiNames = excludedFieldsByObject.get(selectionKey) ?? new Set<string>();

        if ( panelAction.isIncluded ) {
            excludedFieldApiNames.delete(panelAction.fieldApiName);
        } else {
            excludedFieldApiNames.add(panelAction.fieldApiName);
        }
        excludedFieldsByObject.set(selectionKey, excludedFieldApiNames);
        treeSelections.excludedFieldApiNamesByFolderName.set(panelAction.folderName, excludedFieldsByObject);

        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        An object's "All fields" box (#410, which replaced #220's All / None that #343 hid), held to the
        object's allow-list. Unticking all stores every field with a line in the recipe except those a lock
        holds for a reason of its own (RecordTypeId, a parent-excluded lookup); a controlling field is
        stored too, because unticking every dependent with it is what frees it. The "Standard fields"
        box (#477) is the same over the standard fields only: a custom field's tick is never changed.
    */
    static isStandardFieldApiName(fieldApiName: string): boolean {
        return !fieldApiName.toLowerCase().endsWith(RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX);
    }

    static async setAllFieldsIncluded(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setAllFieldsIncluded' }>) {

        const resolved = RecipeCockpitDrawnModel.resolvePostedOccurrence(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname);
        const tree = resolved?.tree;
        const objectViewModel = resolved?.occurrence.objectViewModel;

        if ( !tree || !objectViewModel || this.listFieldReadOnlyObjectApiNames(tree).includes(panelAction.objectApiName) ) {
            return;
        }

        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        const excludedFieldsByObject = treeSelections.excludedFieldApiNamesByFolderName.get(panelAction.folderName) ?? new Map<string, Set<string>>();
        const selectionKey = this.prepareOccurrenceSelectionKey(hub, excludedFieldsByObject, panelState, tree, panelAction.objectApiName, panelAction.nickname, fieldApiNames => new Set(fieldApiNames));

        const isInScope = (fieldApiName: string) => panelAction.fieldScope !== RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE || this.isStandardFieldApiName(fieldApiName);
        const outOfScopeExcludedFieldApiNames = [...( excludedFieldsByObject.get(selectionKey) ?? [] )].filter(fieldApiName => !isInScope(fieldApiName));

        if ( panelAction.isIncluded ) {
            if ( outOfScopeExcludedFieldApiNames.length > 0 ) {
                excludedFieldsByObject.set(selectionKey, new Set(outOfScopeExcludedFieldApiNames));
            } else {
                excludedFieldsByObject.delete(selectionKey);
            }
        } else {
            const heldFieldApiNames = new Set(hub.findObjectFieldSelection(tree, objectViewModel)
                ?.lockedFields
                .filter(lockedField => !lockedField.reason.startsWith(RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX))
                .map(lockedField => lockedField.fieldApiName) ?? []);
            // A CONTROLLING FIELD IS FREED ONLY WHEN THIS CLICK UNTICKS EVERY TICKED DEPENDENT TOO: "Standard fields" LEAVES A CUSTOM ONE TICKED (#477)
            const selectableFieldApiNames = new Set(hub.listSelectableFieldApiNames(objectViewModel));
            objectViewModel.fields.forEach(fieldViewModel => {
                if ( fieldViewModel.controllingField && selectableFieldApiNames.has(fieldViewModel.fieldApiName)
                        && !isInScope(fieldViewModel.fieldApiName) && !outOfScopeExcludedFieldApiNames.includes(fieldViewModel.fieldApiName) ) {
                    heldFieldApiNames.add(fieldViewModel.controllingField);
                }
            });
            const inScopeFieldApiNames = hub.listSelectableFieldApiNames(objectViewModel).filter(fieldApiName => isInScope(fieldApiName) && !heldFieldApiNames.has(fieldApiName));
            excludedFieldsByObject.set(selectionKey, new Set([...outOfScopeExcludedFieldApiNames, ...inScopeFieldApiNames]));
        }
        treeSelections.excludedFieldApiNamesByFolderName.set(panelAction.folderName, excludedFieldsByObject);

        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        A count box (#255). A count equal to the recipe's own is not stored, so setting a box back to
        what the recipe says clears it. The recipe file is never written.
    */
    static async setObjectCount(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setObjectCount' }>) {

        const resolved = RecipeCockpitDrawnModel.resolvePostedOccurrence(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname);
        if ( !resolved ) {
            return;
        }

        const recordCount = resolved.occurrence.objectViewModel.recordCount;
        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        const countsByObject = treeSelections.objectCountsByFolderName.get(panelAction.folderName) ?? new Map<string, number>();
        const selectionKey = this.prepareOccurrenceSelectionKey(hub, countsByObject, panelState, resolved.tree, panelAction.objectApiName, panelAction.nickname, storedCount => storedCount, true);

        if ( panelAction.count === recordCount ) {
            countsByObject.delete(selectionKey);
        } else {
            countsByObject.set(selectionKey, panelAction.count);
        }
        treeSelections.objectCountsByFolderName.set(panelAction.folderName, countsByObject);

        // A COUNT CHANGES NO FIELD AND NO OBJECT THE INSERT SENDS, SO THE ORG'S READINESS NEED NOT BE CHECKED AGAIN
        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, panelAction.folderName, treeSelections, false);

    }

    /*
        A field's pin (#262), saved from its inline editor (#337) and, since #342, written into the
        card's recipe FILE. The panel posts the value as typed, so it is checked here against the
        field the model on screen holds NOW -- the same check the editor's own refusal comes from. A
        value pins the field: its lines become the value on every occurrence of its object, and the
        lines they replaced go into the fixed-values file beside the recipe. '' is Clear, which puts
        those lines back. Either asks in a modal first and shares the one recipe write lock with a
        wiring and an added parent; a write reloads the card, every other ending is answered under the
        editor. A field a lock holds back, or no longer drawn, writes nothing and is answered nothing.
    */
    static async setFieldFixedValue(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldFixedValue' }>,
                                            edit: RecipeCockpitFieldEdit = 'fixedValue') {

        const drawnField = hub.recipeCockpitPanelState === panelState
            ? RecipeCockpitDrawnModel.findDrawnOccurrenceField(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname, panelAction.fieldApiName)
            : undefined;
        if ( !drawnField || drawnField.tree.folderName !== panelAction.folderName || drawnField.fieldViewModel.lineNumber === undefined
                || hub.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
            return;
        }

        const lookupValueRefusal = panelAction.value === '' ? undefined : hub.findLookupValueRefusal(drawnField.tree, panelAction.objectApiName, drawnField.fieldViewModel, panelAction.value);
        if ( lookupValueRefusal !== undefined ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, edit, lookupValueRefusal);
            return;
        }

        if ( panelState.wireLookupStateMessage ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, edit, RECIPE_COCKPIT_FIELD_EDIT_WRITE_RUNNING_REFUSAL);
            return;
        }

        const declaredPicklistValues = RecipeCockpitDrawnModel.listDeclaredPicklistValues(panelState, panelAction.objectApiName, panelAction.fieldApiName);
        const valueRefusal = panelAction.value === '' ? undefined : hub.validateFixedValueInput(panelAction.value, drawnField.fieldViewModel, declaredPicklistValues);
        if ( valueRefusal !== undefined ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, edit, valueRefusal);
            return;
        }

        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(panelAction.treeKey);
        if ( !recipeFilePath ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, edit, 'Not saved: this card has no single recipe file to write the value into.');
            return;
        }

        let writeRefusal: string | undefined;
        await RecipeCockpitTreecipeRecipeEdits.runRecipeLookupWrite(hub, cockpitPanel, panelState, panelAction.treeKey, async () => {
            // A PIN OF AN OBJECT WITH iterations IS WRITTEN INTO THE ROW'S OCCURRENCE ALONE (#467)
            const writeOutcome = panelAction.value === ''
                ? await this.clearFixedValueFromRecipe(hub, recipeFilePath, panelState.workspaceRoot, drawnField.objectViewModel, drawnField.generatedFieldViewModel, panelAction.nickname)
                : await this.writeFixedValueToRecipe(hub, recipeFilePath, panelState.workspaceRoot, panelAction.objectApiName, panelAction.fieldApiName, { value: panelAction.value, kind: hub.resolveFixedValueKind(panelAction.value, drawnField.fieldViewModel) }, panelAction.nickname, edit);
            writeRefusal = writeOutcome.refusal;
            return writeOutcome.isWritten;
        });

        if ( writeRefusal !== undefined ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, edit, writeRefusal);
        }

    }

    /*
        A picklist's value tiles (#465): the router matched every value against the ones the host
        holds for the field, so here the expression is BUILT -- by the card's own backend, every value
        through its escaper -- and written exactly as an edited expression is, under the same lock,
        confirmation and fixed-values file. Every value ticked is the field's own choice again: it
        clears an edit, and with none there is nothing to write.
    */
    static async setPicklistValueChoice(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setPicklistValueChoice' }>) {

        const drawnField = hub.recipeCockpitPanelState === panelState
            ? RecipeCockpitDrawnModel.findDrawnOccurrenceField(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname, panelAction.fieldApiName)
            : undefined;
        const declaredPicklistValues = panelState.picklistDisplayValuesByObjectApiName.get(panelAction.objectApiName)?.get(panelAction.fieldApiName)?.picklistValues;
        if ( !drawnField || !declaredPicklistValues ) {
            return;
        }

        const occurrenceNickname = drawnField.occurrence.nickname;
        const hasEdit = ( drawnField.tree.fixedValues ?? [] ).some(fixedValue => fixedValue.objectApiName === panelAction.objectApiName && fixedValue.nickname === occurrenceNickname && fixedValue.fieldApiName === panelAction.fieldApiName);
        // WHAT GENERATION CHOSE FROM -- NARROWER THAN THE DECLARED VALUES WHEN A VALIDATION RULE OR A SELECTED RECORD TYPE NARROWED IT
        // A LINE THAT IS NOT A CHOICE THE BACKEND BUILDS SAYS NOTHING, SO IT IS TAKEN AS THE DECLARED VALUES, WHICH THE TILES START FROM
        const generatedChoice = RecipeCockpitDrawnModel.readGeneratedPicklistChoice(drawnField.fieldViewModel, declaredPicklistValues) ?? declaredPicklistValues;
        const isGeneratedChoice = generatedChoice.length === panelAction.picklistValues.length
            && generatedChoice.every(generatedValue => panelAction.picklistValues.includes(generatedValue));
        let value = '';

        if ( isGeneratedChoice && !hasEdit ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, 'picklistValues', RECIPE_COCKPIT_PICKLIST_CHOICE_UNCHANGED_REFUSAL);
            return;
        }

        if ( !isGeneratedChoice ) {
            const fakerService = hub.readTreeFakerService(panelState, panelAction.treeKey);
            if ( !fakerService ) {
                this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, 'picklistValues', 'Not saved: the recipe file does not say which faker service it was written for.');
                return;
            }
            value = RecipeCockpitDrawnModel.buildPicklistChoiceExpression(fakerService, panelAction.picklistValues, drawnField.fieldViewModel);
            const expressionRefusal = RecipeCockpitRecipeWriter.checkConstrainedExpression(value);
            if ( expressionRefusal !== undefined ) {
                this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, 'picklistValues', `Not saved: the faker expression for the values you ticked ${expressionRefusal}`);
                return;
            }
        }

        await this.setFieldFixedValue(hub, cockpitPanel, panelState, { ...panelAction, kind: 'setFieldFixedValue', value: value }, 'picklistValues');

    }

    /*
        A picklist's Reset to generated (#479): the tiles' own way back, the same Clear the edit
        button's editor posts -- lock, confirmation, fixed-values file -- answered under the tiles.
        A field with no edit has nothing to reset and is told so, asking and writing nothing.
    */
    static async resetPicklistValueChoice(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    panelAction: Extract<RecipeCockpitPanelAction, { kind: 'resetPicklistValueChoice' }>) {

        const drawnField = hub.recipeCockpitPanelState === panelState
            ? RecipeCockpitDrawnModel.findDrawnOccurrenceField(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname, panelAction.fieldApiName)
            : undefined;
        if ( !drawnField ) {
            return;
        }

        const occurrenceNickname = drawnField.occurrence.nickname;
        const hasEdit = ( drawnField.tree.fixedValues ?? [] ).some(fixedValue => fixedValue.objectApiName === panelAction.objectApiName && fixedValue.nickname === occurrenceNickname && fixedValue.fieldApiName === panelAction.fieldApiName);
        if ( !hasEdit ) {
            this.postFieldEditResult(hub, cockpitPanel, panelState, panelAction, 'picklistValues', RECIPE_COCKPIT_PICKLIST_RESET_NOTHING_REFUSAL);
            return;
        }

        await this.setFieldFixedValue(hub, cockpitPanel, panelState, { ...panelAction, kind: 'setFieldFixedValue', value: '' }, 'picklistValues');

    }

    /*
        Pins a field in the recipe file (#342). The fixed-values file is written FIRST and put back as
        it was when the recipe cannot be, so a recipe never holds a pin that file cannot clear. A
        fixed-values file that is there and cannot be read is never overwritten -- it may be a pin the
        reader still needs -- and one that is a link is never written through.
    */
    private static async writeFixedValueToRecipe(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                                    workspaceRoot: string,
                                                    objectApiName: string,
                                                    fieldApiName: string,
                                                    fixedValue: IRecipeFixedValue,
                                                    scopeNickname?: string,
                                                    edit: RecipeCockpitFieldEdit = 'fixedValue'): Promise<{ isWritten: boolean; refusal?: string }> {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const fixedValueFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(fixedValueFilePath));
        const fieldLabel = `${RecipeYamlScalar.escapeForNotification(hub.describeOccurrence(objectApiName, scopeNickname))}.${RecipeYamlScalar.escapeForNotification(fieldApiName)}`;

        const planned = RecipeCockpitTreecipeRecipeEdits.planFixedValueWrite(hub, recipeFilePath, workspaceRoot, objectApiName, fieldApiName, fixedValue, undefined, scopeNickname);
        if ( 'refusal' in planned ) {
            return { isWritten: false, refusal: planned.refusal };
        }

        const editLabel = fixedValue.kind === 'expression' ? 'an edited faker expression' : 'a fixed value';
        const dialogFieldLabel = `${hub.describeOccurrence(objectApiName, scopeNickname)}.${fieldApiName}`;
        const whereWritten = scopeNickname === undefined ? `on every ${objectApiName} in it` : `on that ${objectApiName} only, every other ${objectApiName} in it keeping its own value`;
        const confirmation = await hub.confirmInPanel(
            `Write ${editLabel} into ${dialogFieldLabel}?`,
            {
                summary: [`This writes to "${path.basename(recipeFilePath)}": ${dialogFieldLabel} becomes ${RecipeCockpitRecipeWriter.toFixedValueScalar(fixedValue)} ${whereWritten}, so Run Faker by Recipe generates it from the palette too. Every other line of the file is left as it is.`],
                // THE TILES HAVE NO CLEAR: THEIR WAY BACK IS RESET TO GENERATED (#479)
                sections: [
                    edit === 'picklistValues'
                        ? { title: `How ${RECIPE_COCKPIT_PICKLIST_RESET_LABEL} puts it back`, lines: [`The lines it replaces are kept in "${path.basename(fixedValueFilePath)}" beside the recipe, so ${RECIPE_COCKPIT_PICKLIST_RESET_LABEL} under Edit values can put them back exactly.`] }
                        : { title: 'How Clear puts it back', lines: [`The lines it replaces are kept in "${path.basename(fixedValueFilePath)}" beside the recipe, so Clear can put them back exactly.`] }
                ]
            },
            RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL ) {
            return { isWritten: false, refusal: RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL };
        }

        // PLANNED AGAIN AFTER THE MODAL: EITHER FILE CAN HAVE CHANGED WHILE IT WAS OPEN
        const confirmed = RecipeCockpitTreecipeRecipeEdits.planFixedValueWrite(hub, recipeFilePath, workspaceRoot, objectApiName, fieldApiName, fixedValue, undefined, scopeNickname);
        if ( 'refusal' in confirmed ) {
            return { isWritten: false, refusal: confirmed.refusal };
        }

        const writeRefusal = RecipeCockpitTreecipeRecipeEdits.writeRecipeWithFixedValueFile(recipeFilePath, confirmed.recipeText, fixedValueFilePath, confirmed.entries);
        if ( writeRefusal !== undefined ) {
            return { isWritten: false, refusal: writeRefusal };
        }

        VSCodeWorkspaceService.showInformationMessage(`Wrote the ${fixedValue.kind === 'expression' ? 'edited expression' : 'fixed value'} of ${fieldLabel} into "${recipeFileLabel}".`);
        return { isWritten: true };

    }

    /*
        Clear (#342): the lines the fixed-values file recorded go back on every occurrence it pinned.
        An occurrence it holds no usable lines for gets the field's value as Generate Treecipe
        wrote it instead -- the objects wrapper's own, or, for a standard field the wrapper does not
        list, the recipe backend's mapping -- and the modal says it is re-derived rather than put back.
    */
    private static async clearFixedValueFromRecipe(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                                    workspaceRoot: string,
                                                    objectViewModel: IRecipeCockpitObjectViewModel,
                                                    fieldViewModel: IRecipeCockpitFieldViewModel,
                                                    occurrenceNickname?: string): Promise<{ isWritten: boolean; refusal?: string }> {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const fixedValueFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(fixedValueFilePath));
        const fieldLabel = `${RecipeYamlScalar.escapeForNotification(hub.describeOccurrence(objectViewModel.objectApiName, occurrenceNickname))}.${RecipeYamlScalar.escapeForNotification(fieldViewModel.fieldApiName)}`;
        const fallbackValueText = this.resolveFixedValueFallback(recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel);

        const planned = this.planFixedValueClear(hub, recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel.fieldApiName, fallbackValueText, occurrenceNickname);
        if ( 'refusal' in planned ) {
            return { isWritten: false, refusal: planned.refusal };
        }

        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const dialogFieldLabel = `${hub.describeOccurrence(objectViewModel.objectApiName, occurrenceNickname)}.${fieldViewModel.fieldApiName}`;
        const confirmation = await hub.confirmInPanel(
            `Clear the edit of ${dialogFieldLabel}?`,
            {
                summary: [
                    planned.isRederived
                        ? `This writes to "${path.basename(recipeFilePath)}": "${path.basename(fixedValueFilePath)}" has no recorded lines for ${dialogFieldLabel}, so it gets back the value Generate Treecipe wrote for it rather than the exact lines it had. Every other line of the file is left as it is.`
                        : `This writes to "${path.basename(recipeFilePath)}": ${dialogFieldLabel} gets back the lines it had before it was pinned, recorded in "${path.basename(fixedValueFilePath)}". Every other line of the file is left as it is.`,
                    // THE FIXED-VALUES FILE IS WORKSPACE TEXT, SO WHAT IT PUTS BACK IS NEVER FOLDED AWAY
                    '',
                    'It puts back:',
                    ...this.buildRestorePreview(planned.previewText).split(/\r\n|\r|\n/).map(previewLine => `  ${previewLine}`)
                ]
            },
            RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL ) {
            return { isWritten: false, refusal: RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL };
        }

        const confirmed = this.planFixedValueClear(hub, recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel.fieldApiName, fallbackValueText, occurrenceNickname);
        if ( 'refusal' in confirmed ) {
            return { isWritten: false, refusal: confirmed.refusal };
        }
        if ( confirmed.isRederived !== planned.isRederived || confirmed.previewText !== planned.previewText ) {
            return { isWritten: false, refusal: `Not saved: "${path.basename(fixedValueFilePath)}" changed while the dialog was open.` };
        }

        const writeRefusal = RecipeCockpitTreecipeRecipeEdits.writeRecipeWithFixedValueFile(recipeFilePath, confirmed.recipeText, fixedValueFilePath, confirmed.entries);
        if ( writeRefusal !== undefined ) {
            return { isWritten: false, refusal: writeRefusal };
        }

        VSCodeWorkspaceService.showInformationMessage(`Cleared the fixed value of ${fieldLabel} in "${recipeFileLabel}".`);
        return { isWritten: true };

    }

    private static planFixedValueClear(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                        workspaceRoot: string,
                                        objectApiName: string,
                                        fieldApiName: string,
                                        fallbackValueText: string | undefined,
                                        occurrenceNickname?: string): { recipeText: string; entries: IFixedValueEntry[]; isRederived: boolean; previewText: string } | { refusal: string } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const located = RecipeCockpitTreecipeRecipeEdits.readFixedValueTarget(hub, recipeFilePath, fixedValueFilePath, workspaceRoot);
        if ( 'refusal' in located ) {
            return located;
        }

        // THE PIN THIS ROW HOLDS (#467): ITS OCCURRENCE'S OWN, ELSE ONE OF EVERY OCCURRENCE, WHICH CLEAR PUTS BACK EVERYWHERE IT WROTE
        const entry = RecipeCockpitFixedValueStore.findHoldingEntry(located.entries, objectApiName, fieldApiName, occurrenceNickname);
        if ( !entry ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" holds no fixed value for ${objectApiName}.${fieldApiName}.` };
        }

        const isRederived = entry.occurrences.some(occurrence => occurrence.originalText === undefined);
        if ( isRederived && fallbackValueText === undefined ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" has no recorded lines for ${objectApiName}.${fieldApiName}, and there is no value Generate Treecipe wrote for it to put back instead.` };
        }

        // A PIN OF EVERY OCCURRENCE NEVER PUTS BACK ONE AN OCCURRENCE'S OWN PIN HOLDS NOW
        const scopedNicknames = located.entries
            .filter(candidate => candidate.objectApiName === objectApiName && candidate.fieldApiName === fieldApiName && candidate.scopeNickname !== undefined)
            .map(candidate => candidate.scopeNickname as string);
        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(located.recipeText, objectApiName, fieldApiName, hub.buildPinnedFieldRestoreRequests(entry, fallbackValueText),
                                                                            entry.scopeNickname !== undefined, scopedNicknames);
        if ( 'refusal' in restoreResult ) {
            return { refusal: `Not saved: ${restoreResult.refusal.message}` };
        }

        return {
            recipeText: restoreResult.recipeText,
            entries: RecipeCockpitFixedValueStore.removeEntry(located.entries, objectApiName, fieldApiName, entry.scopeNickname),
            isRederived: isRederived,
            // WHAT THE MODAL SHOWS: THE FIRST RECORDED LINES, ELSE THE RE-DERIVED VALUE -- A CHANGE ONLY TO THE FIXED-VALUES FILE IS NOT PUT BACK UNSEEN
            previewText: entry.occurrences.find(occurrence => occurrence.originalText !== undefined)?.originalText ?? `${fieldApiName}: ${fallbackValueText}`
        };

    }

    /*
        The value a field is re-derived to when no lines were recorded for it: the objects wrapper's
        own recipe value, which is what Generate Treecipe wrote for the field by its type, size,
        picklist values and validation rules, or, for a standard field the wrapper never lists, the
        value the recipe's own backend maps it to. undefined when neither has one.
    */
    static resolveFixedValueFallback(recipeFilePath: string, workspaceRoot: string, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( !fieldViewModel.isOnlyInRecipeFile ) {
            return fieldViewModel.recipeValue !== '' ? fieldViewModel.recipeValue : undefined;
        }

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const fakerService = VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath);
        if ( !fakerService ) {
            return undefined;
        }

        const standardFieldValues = ( fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService() ).getOOTBObjectApiNameToFieldApiNameMap();
        const valuesByField = Object.prototype.hasOwnProperty.call(standardFieldValues, objectApiName) ? standardFieldValues[objectApiName] : undefined;
        return valuesByField && Object.prototype.hasOwnProperty.call(valuesByField, fieldViewModel.fieldApiName) ? valuesByField[fieldViewModel.fieldApiName] : undefined;

    }

    // LINES AS THE IN-PANEL CONFIRMATION SHOWS THEM (#349): ONE PER LINE, LEFT-ALIGNED, CUT SHORT PAST A SCREEN'S WORTH
    static buildRestorePreview(previewText: string): string {

        const previewLines = previewText.split(/\r\n|\n/);
        const commonIndent = Math.min(...previewLines.filter(previewLine => previewLine.trim() !== '').map(previewLine => RecipeCockpitRecipeWriter.countIndent(previewLine)));
        const shownLines = previewLines.slice(0, RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES)
            .map(previewLine => previewLine.slice(Math.min(commonIndent, RecipeCockpitRecipeWriter.countIndent(previewLine))));
        const previewBody = shownLines.join('\n');
        const isCut = previewLines.length > RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES || previewBody.length > RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH;

        return isCut ? `${previewBody.slice(0, RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH)}\n…` : previewBody;

    }

    // HOW AN INLINE EDIT (#337) ENDED, FOR THE MODEL STILL ON SCREEN ONLY
    private static postFieldEditResult(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        panelAction: { treeKey: string; objectApiName: string; fieldApiName: string },
                                        edit: RecipeCockpitFieldEdit,
                                        refusal: string | undefined) {

        const recipeDataMessage = panelState.recipeDataMessage;
        if ( !recipeDataMessage || hub.recipeCockpitPanelState !== panelState ) {
            return;
        }

        hub.postToPanel(cockpitPanel, {
            command: 'fieldEditResult',
            renderSequence: recipeDataMessage.renderSequence,
            treeKey: panelAction.treeKey,
            objectApiName: panelAction.objectApiName,
            fieldApiName: panelAction.fieldApiName,
            edit: edit,
            ...( refusal !== undefined ? { refusal: refusal } : {} )
        });

    }

    /*
        A field's validation-rule checkbox (#325): the untick is stored, a tick removes it. The router
        matched the field and its lock rule against the model on screen, and nothing is awaited
        between that and this write, so there is nothing to re-derive.
    */
    static async setFieldValidationRuleApplied(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldValidationRuleApplied' }>) {

        const resolved = RecipeCockpitDrawnModel.resolvePostedOccurrence(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.nickname);
        if ( !resolved ) {
            return;
        }

        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        const rulesOffByObject = treeSelections.validationRulesOffByFolderName.get(panelAction.folderName) ?? new Map<string, Set<string>>();
        const selectionKey = this.prepareOccurrenceSelectionKey(hub, rulesOffByObject, panelState, resolved.tree, panelAction.objectApiName, panelAction.nickname, fieldApiNames => new Set(fieldApiNames));
        treeSelections.validationRulesOffByFolderName.set(panelAction.folderName, rulesOffByObject);
        this.setStoredValidationRuleOff(treeSelections, panelAction.folderName, selectionKey, panelAction.fieldApiName, !panelAction.isApplied);

        // THE RULES SHAPE A VALUE, NEVER WHICH FIELDS THE INSERT SENDS, SO THE ORG'S READINESS NEED NOT BE CHECKED AGAIN
        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, panelAction.folderName, treeSelections, false);

    }

    /*
        The key one occurrence's setting is stored under (#467): its object's for an object written
        once, else "<Object>\n<Nickname>", after splitting off an entry its object holds from before
        #467 so every other occurrence keeps what it had.
    */
    private static prepareOccurrenceSelectionKey<T>(hub: IRecipeCockpitHubForTreecipeTab, storedByKey: Map<string, T>,
                                            panelState: IRecipeCockpitPanelState,
                                            tree: IRecipeCockpitTreeViewModel,
                                            objectApiName: string,
                                            nickname: string | undefined,
                                            copyEntry: (entry: T) => T,
                                            isFirstOccurrenceOnly = false): string {

        if ( nickname === undefined || !panelState.recipeDataMessage ) {
            return objectApiName;
        }

        // A COUNT STORED BEFORE #467 MEANT THE FIRST OCCURRENCE ONLY, SO IT IS SPLIT ONTO THAT ONE ALONE
        const occurrenceNicknames = hub.listTreeOccurrences(hub.buildObjectsByApiName(panelState.recipeDataMessage.recipe), tree, objectApiName)
            .filter(occurrence => occurrence.nickname !== undefined && !( isFirstOccurrenceOnly && occurrence.objectViewModel.isIterationOccurrence ))
            .map(occurrence => occurrence.nickname as string);
        this.splitObjectWideEntry(storedByKey, objectApiName, occurrenceNicknames, copyEntry);

        return RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname);

    }

    // objectApiName IS THE KEY THE SETTING IS STORED UNDER: AN OBJECT, OR AN OCCURRENCE'S KEY (#467)
    private static setStoredValidationRuleOff(treeSelections: IRecipeCockpitTreeSelections, folderName: string, objectApiName: string, fieldApiName: string, isOff: boolean) {

        const rulesOffByObject = treeSelections.validationRulesOffByFolderName.get(folderName) ?? new Map<string, Set<string>>();
        const rulesOffFieldApiNames = rulesOffByObject.get(objectApiName) ?? new Set<string>();

        if ( isOff ) {
            rulesOffFieldApiNames.add(fieldApiName);
        } else {
            rulesOffFieldApiNames.delete(fieldApiName);
        }
        rulesOffByObject.set(objectApiName, rulesOffFieldApiNames);
        treeSelections.validationRulesOffByFolderName.set(folderName, rulesOffByObject);

    }

    // A CARD'S Reset selection: EVERY OBJECT INCLUDED, EVERY FIELD TICKED AND EVERY COUNT THE RECIPE'S AGAIN, AFTER THE READER CONFIRMS IN THE HOST'S OWN DIALOG
    static async resetTreeSelection(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, folderName: string) {

        const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);

        if ( !treeSelections.excludedObjectApiNamesByFolderName.has(folderName)
                && !treeSelections.excludedFieldApiNamesByFolderName.has(folderName)
                && !treeSelections.objectCountsByFolderName.has(folderName)
                && !treeSelections.validationRulesOffByFolderName.has(folderName) ) {
            return;
        }

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.folderName === folderName);
        const treeLabel = tree?.customName ?? tree?.title ?? folderName;
        const confirmation = await hub.confirmInPanel(
            `Reset the selection of ${treeLabel}?`,
            {
                summary: ['Every object is included, every field is ticked, every record count goes back to the recipe\'s own again and every validation rule is applied again.'],
                sections: [
                    { title: 'What stays', lines: ['The recipe file is not changed, so an edit written into it stays: clear it with its field\'s edit button.'] }
                ]
            },
            RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL ) {
            return;
        }

        // READ AGAIN AFTER THE DIALOG: A CHOICE MADE ELSEWHERE WHILE IT WAS OPEN IS NOT WRITTEN BACK
        const currentSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
        currentSelections.excludedObjectApiNamesByFolderName.delete(folderName);
        currentSelections.excludedFieldApiNamesByFolderName.delete(folderName);
        currentSelections.objectCountsByFolderName.delete(folderName);
        currentSelections.validationRulesOffByFolderName.delete(folderName);

        await this.saveAndPostTreeSelections(hub, cockpitPanel, panelState, folderName, currentSelections);

    }

    /*
        A failed write is said once and leaves the card as it was: a selection the next open would not
        show is not one to generate by. Otherwise every card of the folder is redrawn in place, and an
        org Data-by-Org already checked is checked again, since what Create would send has changed.
    */
    private static async saveAndPostTreeSelections(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    folderName: string,
                                                    treeSelections: IRecipeCockpitTreeSelections,
                                                    isReadinessAffected = true): Promise<boolean> {

        const isWritten = await hub.writeTreeSelections(hub.recipeCockpitWorkspaceState, treeSelections);
        const recipeDataMessage = panelState.recipeDataMessage;

        if ( !isWritten || !recipeDataMessage || hub.recipeCockpitPanelState !== panelState ) {
            return isWritten;
        }

        // ONLY THIS FOLDER'S CARDS CHANGED, SO ONLY THEY ARE RECOMPUTED; THEIR PINS ARE THE ONES THEIR FIXED-VALUES FILES HELD AT LOAD (#342)
        hub.applyObjectSelections(recipeDataMessage.recipe, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, folderName, treeSelections.objectCountsByFolderName, panelState.pinnedFixedValuesByFolderName ?? new Map(), treeSelections.validationRulesOffByFolderName);

        recipeDataMessage.recipe.trees
            .filter(tree => tree.folderName === folderName)
            .forEach(tree => hub.postToPanel(cockpitPanel, {
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: tree.treeKey,
                ...( tree.objectSelection ? { objectSelection: tree.objectSelection } : {} ),
                ...( tree.fieldSelection ? { fieldSelection: tree.fieldSelection } : {} ),
                ...( tree.objectCounts ? { objectCounts: tree.objectCounts } : {} ),
                ...( tree.fixedValues ? { fixedValues: tree.fixedValues } : {} ),
                ...( tree.validationRulesOff ? { validationRulesOff: tree.validationRulesOff } : {} )
            }));

        const isOrgCheckIdle = !panelState.scratchOrgStateMessage?.isRunning && !panelState.insertStateMessage?.isRunning;
        if ( isOrgCheckIdle && isReadinessAffected ) {
            await this.refreshDataOrgReadinessForFolder(hub, cockpitPanel, panelState, folderName);
        }

        return true;

    }

    /*
        What Create would send for ONE folder's cards changed, so only their targets are checked
        again -- against the org type the selection already answered and the session's describe
        cache, connecting only for an object the cache does not hold. A selection that has not
        answered it is a sandbox has nothing to refresh, and an answer for a selection, model or
        request the reader has moved on from is dropped. The panel merges it by key.
    */
    private static async refreshDataOrgReadinessForFolder(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, folderName: string) {

        await hub.refreshDataOrgReadinessForTrees(cockpitPanel, panelState, tree => tree.folderName === folderName);

    }

}
