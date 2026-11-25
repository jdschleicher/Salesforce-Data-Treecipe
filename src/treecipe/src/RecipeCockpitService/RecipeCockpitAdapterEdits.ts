import * as vscode from 'vscode';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    IAdaptedRecipeField,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    IRecipeCockpitPreviewRecordLinks,
    RecipeCockpitQuery
} from './RecipeCockpitQuery';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';
// TYPES ONLY: THE HOST AND THE RECORDS FILE LOAD THIS ONE, NEVER THE OTHER WAY
import type {
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterLoadStateMessage,
    IRecipeCockpitUpdaterRecordValues,
    IRecipeCockpitUpdaterRecordsPageMessage,
    RecipeCockpitAdapterPanelAction
} from './RecipeCockpitAdapterHost';
import type {
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitViewModel';

/*
    "Edit existing records" (#721, slice B of #719): what the reader marked and changed on the
    records a load holds, and every action that changes it. The reader marks rows, makes a value
    for one cell or one column of the marked rows, and resets any of them; Update records then
    writes only the marked rows' changed cells.

    Everything is held on the HOST, in RecipeCockpitAdapterState.heldUpdaterEdits, beside the
    records it belongs to and let go with them. The panel posts a position (object name, page,
    row, column) and is answered with the page as it now reads. The one value it posts is the
    text the reader typed into a cell (typeCell), held to the Treecipe tab's fixed value rules.
*/

// HOW MANY ROWS OF A RECORD TABLE ONE PAGE HOLDS (#720); EVERY PAGE IS CUT FROM THE RECORDS THE HOST KEEPS
export const RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE = 50;

/*
    How many values one backend run makes for a cell's 🎲. A run costs a snowfakery process start,
    so the values of one run are kept per field and handed out one a click, and the next run comes
    only when they are used up.
*/
export const RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE = 50;

export const RECIPE_COCKPIT_UPDATER_ID_COLUMN_LOCK_REASON = 'a record\'s Id is never changed';
export const RECIPE_COCKPIT_UPDATER_UNLISTED_COLUMN_LOCK_REASON = 'it is not a field this treecipe lists';

/*
    Each edit the panel can ask for, and what it needs of the position posted with it. The router
    holds a message to its row: an edit that needs a row or a column is refused without one, and
    one that needs a value made is refused for a column with no expression to make it from. Only
    typeCell takes a value, and every other edit is refused with one.
*/
export const RECIPE_COCKPIT_UPDATER_EDIT_RULES = Object.freeze({
    markRow: { needsRow: true, needsColumn: false, needsGeneration: false, needsValue: false },
    unmarkRow: { needsRow: true, needsColumn: false, needsGeneration: false, needsValue: false },
    generateCell: { needsRow: true, needsColumn: true, needsGeneration: true, needsValue: false },
    generateColumn: { needsRow: false, needsColumn: true, needsGeneration: true, needsValue: false },
    typeCell: { needsRow: true, needsColumn: true, needsGeneration: false, needsValue: true },
    resetCell: { needsRow: true, needsColumn: true, needsGeneration: false, needsValue: false },
    resetColumn: { needsRow: false, needsColumn: true, needsGeneration: false, needsValue: false },
    resetObject: { needsRow: false, needsColumn: false, needsGeneration: false, needsValue: false }
});

export const RECIPE_COCKPIT_UPDATER_TYPED_EXPRESSION_REFUSAL = 'a cell takes a value, not a faker expression. Use 🎲 for a generated one.';
// A WHOLE-STRING NICKNAME IS A REFERENCE TO faker-js AND THE INSERT'S Id SWAP, NEVER TEXT, AND THE ADAPTED RECIPE (#448) WOULD HOLD IT
export const RECIPE_COCKPIT_UPDATER_TYPED_NICKNAME_REFUSAL = 'is a nickname in this recipe, which a recipe reads as a reference to a record, not as text.';

export type RecipeCockpitUpdaterEditKind = keyof typeof RECIPE_COCKPIT_UPDATER_EDIT_RULES;

// WHERE A COLUMN'S 🎲 VALUE COMES FROM: THE RECIPE'S OWN EXPRESSION, THE TREECIPE TAB'S EDIT OR FIXED VALUE, OR, FOR A FIELD ONLY THE ORG HOLDS, THE EXPRESSION THE BACKEND WRITES FOR ITS TYPE
export type RecipeCockpitUpdaterValueSource = 'recipe' | 'recipeEdit' | 'recipeFixed' | 'orgExpression';

/*
    One column of an object's record table as the host plans it at the load: why it cannot be
    changed, or how 🎲 makes a value for it and what a typed value is held to. A field with no
    expression has no generation, and a typed value still reaches it.
*/
export interface IRecipeCockpitUpdaterColumnPlan {
    fieldApiName: string;
    lockReason?: string;
    // WHAT A VALUE TYPED INTO A CELL IS CHECKED AGAINST: THE FIELD AS THE MODEL DRAWS IT, AND THE PICKLIST VALUES IT DECLARES
    typing?: { fieldViewModel: IRecipeCockpitFieldViewModel; declaredPicklistValues: readonly string[] | undefined; recipeNicknames: readonly string[]; isOrgOnly?: true };
    generation?: {
        source: RecipeCockpitUpdaterValueSource;
        // THE SCALAR A ONE-FIELD RECIPE GENERATES FROM; FOR recipeFixed, THE VALUE ITSELF
        valueText: string;
        fixedValue?: unknown;
        // THE SCALAR THE ADAPTED RECIPE WRITES (#448) WHEN IT IS NOT valueText
        recipeValueText?: string;
        isOrgOnly?: true;
    };
}

// WHAT THE PANEL IS TOLD OF A COLUMN: THE REASON IT IS LOCKED, AND WHETHER IT HAS A 🎲
export interface IRecipeCockpitUpdaterColumnEditView {
    lockReason?: string;
    canGenerate: boolean;
}

// ONE OBJECT'S MARKS AND CHANGES, BY RECORD Id, AND THE VALUES A RUN MADE THAT NO CELL HAS TAKEN YET
export interface IRecipeCockpitUpdaterObjectEdits {
    markedRecordIds: Set<string>;
    changedValuesByRecordId: Map<string, Map<string, unknown>>;
    // THE TEXT TYPED INTO A CELL THAT STILL HOLDS IT, AS THE ADAPTED RECIPE WOULD WRITE IT: fieldApiName → SCALAR, PER RECORD
    typedScalarsByRecordId: Map<string, Map<string, string>>;
    valuePoolsByFieldApiName: Map<string, unknown[]>;
}

// HOW MANY ROWS ARE MARKED, HOW MANY OF THEM AN UPDATE WOULD WRITE, AND WHICH FIELDS IT WOULD WRITE
export interface IRecipeCockpitUpdaterEditSummary {
    markedRecordCount: number;
    updatableRecordCount: number;
    changedFieldApiNames: string[];
    // CHANGES ON ROWS THAT ARE NOT MARKED, WHICH AN UPDATE LEAVES OUT AND "Reset all" STILL CLEARS
    hasUnmarkedChanges: boolean;
}

// ONE PAGE OF A RECORD TABLE AS IT READS NOW: A CHANGED CELL SHOWS ITS NEW VALUE
export interface IRecipeCockpitUpdaterEditedPage {
    columns: string[];
    rows: string[][];
    recordLinks?: IRecipeCockpitPreviewRecordLinks;
    lookupLinks?: IRecipeCockpitPreviewRecordLinks[];
    markedRowIndexes: number[];
    // [rowIndex, columnIndex] OF EACH CELL THAT NO LONGER HOLDS ITS LOADED VALUE
    changedCells: Array<[number, number]>;
    // [rowIndex, columnIndex] OF EACH CELL WHOSE TEXT ON SCREEN IS NOT ITS WHOLE VALUE (CUT SHORT, OR WITH LINE BREAKS): AN EDITOR MUST NOT START FROM IT
    cutCells: Array<[number, number]>;
    editSummary: IRecipeCockpitUpdaterEditSummary;
}

// ONE OBJECT OF AN UPDATE BUILT FROM THE EDITS: ITS MARKED RECORDS THAT CHANGED, EACH WITH ONLY ITS OWN CHANGED FIELDS
export interface IRecipeCockpitUpdaterPlannedObject {
    objectApiName: string;
    fieldApiNames: string[];
    recordValues: IRecipeCockpitUpdaterRecordValues[];
    loadedRecords: Record<string, unknown>[];
    markedRecordCount: number;
}

export interface IRecipeCockpitUpdaterUpdatePlan {
    plannedObjects: IRecipeCockpitUpdaterPlannedObject[];
    valuesByObjectApiName: Map<string, IRecipeCockpitUpdaterRecordValues[]>;
    orgOnlyFieldApiNamesByObjectApiName: Map<string, string[]>;
    adaptedRecipeFields: IAdaptedRecipeField[];
}

// THE BACKEND RUN AN EDIT ASKS FOR, HANDED IN BY THE HOST SO THIS FILE NEVER LOADS THE RECORDS FILE
export type RecipeCockpitUpdaterValueGenerator = (fakerService: 'faker-js' | 'snowfakery',
                                                  objectApiName: string,
                                                  valueCount: number,
                                                  fields: readonly { fieldApiName: string; valueText: string }[],
                                                  isCancelled: () => boolean) => Promise<{ records: Record<string, unknown>[] } | { refusal: string } | { isCancelled: true }>;

type HeldUpdaterRecords = NonNullable<typeof RecipeCockpitAdapterState.heldUpdaterRecords>;

export class RecipeCockpitAdapterEdits {

    /*
        Each column of an object's table, planned once at the load from the model on screen: Id and
        a field the treecipe does not list are locked, a recipe field keeps findUpdaterFieldLockReason's
        reason, and an unlocked field gets the source its 🎲 generates from, in #417's order -- the
        Treecipe tab's fixed value or edited expression first, then the recipe's own expression.
    */
    static planColumns(panelState: IRecipeCockpitPanelState,
                       recipe: IRecipeCockpitRecipeViewModel,
                       tree: IRecipeCockpitTreeViewModel,
                       objectApiName: string,
                       columnFieldApiNames: readonly string[]): IRecipeCockpitUpdaterColumnPlan[] {

        const objectViewModel: IRecipeCockpitObjectViewModel | undefined = recipe.objects.find(object => object.objectApiName === objectApiName);
        // THE OBJECT'S FIRST OCCURRENCE'S EDIT: A LATER OCCURRENCE'S OWN (#467) IS NOT WHAT THE ADAPTER'S ONE TABLE PER OBJECT SHOWS
        const recipeFileEditsByFieldApiName = new Map(( tree.fixedValues ?? [] )
            .filter(fixedValue => fixedValue.objectApiName === objectApiName && ( fixedValue.nickname === undefined || fixedValue.nickname === objectViewModel?.nickname ))
            .map(fixedValue => [fixedValue.fieldApiName, fixedValue] as const));

        // EVERY NICKNAME THE RECIPE WRITES: AN OBJECT'S ONE, AND EACH OCCURRENCE'S OF AN OBJECT WRITTEN MORE THAN ONCE
        const recipeNicknames = recipe.objects.flatMap(object => [object.nickname, object.recipeNickname, ...( object.iterations ?? [] ).map(iteration => iteration.nickname)])
            .filter((nickname): nickname is string => typeof nickname === 'string' && nickname !== '');

        return columnFieldApiNames.map((fieldApiName): IRecipeCockpitUpdaterColumnPlan => {

            if ( fieldApiName === 'Id' ) {
                return { fieldApiName: fieldApiName, lockReason: RECIPE_COCKPIT_UPDATER_ID_COLUMN_LOCK_REASON };
            }

            const recipeFieldViewModel = objectViewModel?.fields.find(field => field.fieldApiName === fieldApiName);
            const orgOnlyField = recipeFieldViewModel ? undefined : RecipeCockpitAdapterState.findAdapterOrgOnlyField(panelState, tree.treeKey, objectApiName, fieldApiName);

            if ( orgOnlyField ) {
                return {
                    fieldApiName: fieldApiName,
                    ...( orgOnlyField.lockReason !== undefined
                        ? { lockReason: orgOnlyField.lockReason }
                        : { typing: { fieldViewModel: orgOnlyField.fieldViewModel, declaredPicklistValues: orgOnlyField.picklistValues.length > 0 ? orgOnlyField.picklistValues : undefined, recipeNicknames: recipeNicknames, isOrgOnly: true as const } } ),
                    ...( orgOnlyField.lockReason === undefined && orgOnlyField.expression !== undefined
                        ? { generation: { source: 'orgExpression' as const, valueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: orgOnlyField.expression, kind: 'expression' }), isOrgOnly: true as const } }
                        : {} )
                };
            }

            if ( !recipeFieldViewModel ) {
                return { fieldApiName: fieldApiName, lockReason: RECIPE_COCKPIT_UPDATER_UNLISTED_COLUMN_LOCK_REASON };
            }

            const lockReason = RecipeCockpitAdapterState.findUpdaterFieldLockReason(tree, objectApiName, recipeFieldViewModel);
            if ( lockReason !== undefined ) {
                return { fieldApiName: fieldApiName, lockReason: lockReason };
            }

            const typing = { fieldViewModel: recipeFieldViewModel, declaredPicklistValues: RecipeCockpitDrawnModel.listDeclaredPicklistValues(panelState, objectApiName, fieldApiName), recipeNicknames: recipeNicknames };
            const recipeFileEdit = recipeFileEditsByFieldApiName.get(fieldApiName);
            if ( recipeFileEdit && recipeFileEdit.kind !== 'expression' ) {
                return {
                    fieldApiName: fieldApiName,
                    typing: typing,
                    generation: {
                        source: 'recipeFixed',
                        valueText: recipeFileEdit.value,
                        fixedValue: RecipeCockpitAdapterState.toUpdaterFixedValue(recipeFileEdit.value, recipeFileEdit.kind),
                        recipeValueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: recipeFileEdit.value, kind: recipeFileEdit.kind })
                    }
                };
            }

            const expression = recipeFileEdit ? recipeFileEdit.value : RecipeCockpitDrawnModel.findRecipeExpression(recipeFieldViewModel.recipeValue);
            if ( expression === undefined ) {
                return { fieldApiName: fieldApiName, typing: typing };
            }

            // DOUBLE-QUOTED, SO ": " OR "#" IN THE EXPRESSION IS NEVER READ AS YAML; IT LOADS AS THE SAME STRING
            return {
                fieldApiName: fieldApiName,
                typing: typing,
                generation: { source: recipeFileEdit ? 'recipeEdit' : 'recipe', valueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: expression, kind: 'expression' }) }
            };

        });

    }

    static toColumnEditViews(columnPlans: readonly IRecipeCockpitUpdaterColumnPlan[]): IRecipeCockpitUpdaterColumnEditView[] {
        return columnPlans.map(columnPlan => ({
            ...( columnPlan.lockReason !== undefined ? { lockReason: columnPlan.lockReason } : {} ),
            canGenerate: columnPlan.lockReason === undefined && columnPlan.generation !== undefined
        }));
    }

    // THE EDITS OF THE LOAD HELD NOW, MADE ON FIRST USE; ANOTHER LOAD'S EDITS ARE REPLACED, NEVER READ
    static readObjectEdits(heldRecords: HeldUpdaterRecords, objectApiName: string): IRecipeCockpitUpdaterObjectEdits {

        if ( RecipeCockpitAdapterState.heldUpdaterEdits?.resultKey !== heldRecords.resultKey ) {
            RecipeCockpitAdapterState.heldUpdaterEdits = { resultKey: heldRecords.resultKey, editsByObjectApiName: new Map() };
        }

        const editsByObjectApiName = RecipeCockpitAdapterState.heldUpdaterEdits.editsByObjectApiName;
        let objectEdits = editsByObjectApiName.get(objectApiName);
        if ( !objectEdits ) {
            objectEdits = { markedRecordIds: new Set(), changedValuesByRecordId: new Map(), typedScalarsByRecordId: new Map(), valuePoolsByFieldApiName: new Map() };
            editsByObjectApiName.set(objectApiName, objectEdits);
        }

        return objectEdits;

    }

    private static findObjectEdits(heldRecords: HeldUpdaterRecords, objectApiName: string): IRecipeCockpitUpdaterObjectEdits | undefined {
        return RecipeCockpitAdapterState.heldUpdaterEdits?.resultKey === heldRecords.resultKey
            ? RecipeCockpitAdapterState.heldUpdaterEdits.editsByObjectApiName.get(objectApiName)
            : undefined;
    }

    static summarizeObjectEdits(heldRecords: HeldUpdaterRecords, objectApiName: string): IRecipeCockpitUpdaterEditSummary {

        const objectEdits = this.findObjectEdits(heldRecords, objectApiName);
        const columnFieldApiNames = heldRecords.columnFieldApiNamesByObjectApiName.get(objectApiName) ?? [];
        const changedFieldApiNames = new Set<string>();
        let updatableRecordCount = 0;
        let hasUnmarkedChanges = false;

        objectEdits?.changedValuesByRecordId.forEach((changedValues, recordId) => {
            if ( !objectEdits.markedRecordIds.has(recordId) ) {
                hasUnmarkedChanges = true;
                return;
            }
            updatableRecordCount++;
            changedValues.forEach((_value, fieldApiName) => changedFieldApiNames.add(fieldApiName));
        });

        return {
            markedRecordCount: objectEdits?.markedRecordIds.size ?? 0,
            updatableRecordCount: updatableRecordCount,
            // IN COLUMN ORDER, SO THE SAME EDITS ALWAYS READ THE SAME
            changedFieldApiNames: columnFieldApiNames.filter(fieldApiName => changedFieldApiNames.has(fieldApiName)),
            hasUnmarkedChanges: hasUnmarkedChanges
        };

    }

    // HOW MANY RECORDS AN UPDATE OF THE LOAD HELD NOW WOULD WRITE, OVER EVERY OBJECT
    static countUpdatableRecords(): number {

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        if ( !heldRecords ) {
            return 0;
        }

        return [...heldRecords.columnFieldApiNamesByObjectApiName.keys()]
            .reduce((total, objectApiName) => total + this.summarizeObjectEdits(heldRecords, objectApiName).updatableRecordCount, 0);

    }

    /*
        One page of an object's table as it reads now: the loaded records with each changed cell's
        new value over its loaded one, which rows are marked and which cells changed. undefined
        for an object the load did not read.
    */
    static buildEditedPage(heldRecords: HeldUpdaterRecords, objectApiName: string, pageIndex: number): IRecipeCockpitUpdaterEditedPage | undefined {

        const records = heldRecords.recordsByObjectApiName.get(objectApiName);
        const columnFieldApiNames = heldRecords.columnFieldApiNamesByObjectApiName.get(objectApiName);

        if ( !records || !columnFieldApiNames ) {
            return undefined;
        }

        const objectEdits = this.findObjectEdits(heldRecords, objectApiName);
        const pageRecords = records.slice(pageIndex * RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE, ( pageIndex + 1 ) * RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE);
        const markedRowIndexes: number[] = [];
        const changedCells: Array<[number, number]> = [];

        const shownRecords = pageRecords.map((record, rowIndex) => {
            const recordId = this.readRecordId(record);
            if ( recordId === undefined || !objectEdits ) {
                return record;
            }
            if ( objectEdits.markedRecordIds.has(recordId) ) {
                markedRowIndexes.push(rowIndex);
            }
            const changedValues = objectEdits.changedValuesByRecordId.get(recordId);
            if ( !changedValues ) {
                return record;
            }
            const shownRecord: Record<string, unknown> = { ...record };
            changedValues.forEach((changedValue, fieldApiName) => {
                changedCells.push([rowIndex, columnFieldApiNames.indexOf(fieldApiName)]);
                shownRecord[this.findRecordKey(record, fieldApiName) ?? fieldApiName] = changedValue;
            });
            return shownRecord;
        });

        const tablePage = RecipeCockpitQuery.buildTablePage(shownRecords, columnFieldApiNames, heldRecords.lookupFieldApiNamesByObjectApiName.get(objectApiName) ?? [], 0, RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE);

        return {
            ...tablePage,
            cutCells: this.listCutCells(shownRecords, columnFieldApiNames, tablePage.rows),
            markedRowIndexes: markedRowIndexes,
            changedCells: changedCells.sort(([firstRowIndex, firstColumnIndex], [secondRowIndex, secondColumnIndex]) => firstRowIndex - secondRowIndex || firstColumnIndex - secondColumnIndex),
            editSummary: this.summarizeObjectEdits(heldRecords, objectApiName)
        };

    }

    // THE ORG ANSWERS A DATE AND TIME WITH A +0000 ZONE, WHICH IS WHAT A CELL SHOWS AND ITS EDITOR STARTS FROM; THE FIXED VALUE RULE WANTS +00:00
    static normalizeTypedText(typedValue: string): string {
        return typedValue.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?[+-]\d{2})(\d{2})$/, '$1:$2');
    }

    // A CELL'S TEXT IS CUT TO A LENGTH AND AN INPUT DROPS LINE BREAKS, SO NEITHER IS A VALUE TO START TYPING FROM: [rowIndex, columnIndex] OF EACH
    static listCutCells(pageRecords: readonly Record<string, unknown>[], columnFieldApiNames: readonly string[], shownRows: readonly string[][]): Array<[number, number]> {
        const cutCells: Array<[number, number]> = [];
        pageRecords.forEach((pageRecord, rowIndex) => columnFieldApiNames.forEach((fieldApiName, columnIndex) => {
            const recordKey = this.findRecordKey(pageRecord, fieldApiName);
            const cellValue = recordKey === undefined ? undefined : pageRecord[recordKey];
            if ( typeof cellValue === 'string' && ( cellValue !== shownRows[rowIndex]?.[columnIndex] || /[\r\n]/.test(cellValue) ) ) {
                cutCells.push([rowIndex, columnIndex]);
            }
        }));
        return cutCells;
    }

    /*
        The page answered to the panel, and the object's page 0 in the records message a reopened
        panel is replayed, so what a reader sees after a reload is what the host holds.
    */
    static postEditedPage(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState,
                          position: { treeKey: string; renderSequence: number; objectApiName: string; pageIndex: number }) {

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const editedPage = heldRecords ? this.buildEditedPage(heldRecords, position.objectApiName, position.pageIndex) : undefined;

        if ( !heldRecords || !editedPage ) {
            return;
        }

        const replayedObject = panelState.updaterRecordsMessage?.objects.find(objectRecords => objectRecords.objectApiName === position.objectApiName);
        const firstPage = position.pageIndex === 0 ? editedPage : this.buildEditedPage(heldRecords, position.objectApiName, 0);
        if ( replayedObject && firstPage ) {
            const { columns, ...firstPageView } = firstPage;
            ['recordLinks', 'lookupLinks'].forEach(linkKey => { delete ( replayedObject as unknown as Record<string, unknown> )[linkKey]; });
            Object.assign(replayedObject, firstPageView, { columns: columns });
        }

        heldRecords.postedPageIndexesByObjectApiName.get(position.objectApiName)?.add(position.pageIndex);
        const { columns: _columns, ...pageView } = editedPage;
        const pageMessage: IRecipeCockpitUpdaterRecordsPageMessage = { command: 'updaterRecordsPage', ...position, ...pageView };
        hub.postToPanel(cockpitPanel, pageMessage);

    }

    /*
        One edit, at the position the router matched against the table on screen. A mark, an unmark
        and a reset change only what the host holds. A 🎲 takes values from the field's pool, and
        runs the recipe's backend under the Adapter's one run per window only when the pool is short.
        The answer is the page as it now reads; a value that could not be made is one warning.
    */
    static async applyEditFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                    panelState: IRecipeCockpitPanelState,
                                    editAction: Extract<RecipeCockpitAdapterPanelAction, { kind: 'editUpdaterRecords' }>,
                                    generateValues: RecipeCockpitUpdaterValueGenerator) {

        const { treeKey, renderSequence, objectApiName, pageIndex, editKind, rowIndex, columnIndex, value: typedValue } = editAction;
        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const records = heldRecords?.recordsByObjectApiName.get(objectApiName);
        const columnPlans = heldRecords?.columnPlansByObjectApiName.get(objectApiName);

        if ( !heldRecords || !records || !columnPlans || heldRecords.renderSequence !== renderSequence || RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            return;
        }

        const objectEdits = this.readObjectEdits(heldRecords, objectApiName);
        const rowRecord = rowIndex === undefined ? undefined : records[pageIndex * RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE + rowIndex];
        const rowRecordId = rowRecord ? this.readRecordId(rowRecord) : undefined;
        const columnPlan = columnIndex === undefined ? undefined : columnPlans[columnIndex];
        const recordsById = () => new Map(records.flatMap(record => {
            const recordId = this.readRecordId(record);
            return recordId === undefined ? [] : [[recordId, record] as const];
        }));

        switch ( editKind ) {

            case 'markRow':
                if ( rowRecordId !== undefined ) { objectEdits.markedRecordIds.add(rowRecordId); }
                break;

            // ITS CHANGES STAY ON SCREEN UNTIL THEY ARE RESET; AN UPDATE LEAVES THEM OUT
            case 'unmarkRow':
                if ( rowRecordId !== undefined ) { objectEdits.markedRecordIds.delete(rowRecordId); }
                break;

            // TYPED INTO A MARKED ROW ONLY, AS 🎲 IS, AND HELD TO THE RULES THE TREECIPE TAB HOLDS A FIXED VALUE TO
            case 'typeCell': {

                const typing = columnPlan?.typing;
                if ( !columnPlan || !typing || typedValue === undefined || rowRecordId === undefined || !objectEdits.markedRecordIds.has(rowRecordId) ) {
                    break;
                }

                const typedText = this.normalizeTypedText(typedValue);
                const valueKind = hub.resolveFixedValueKind(typedText, typing.fieldViewModel);
                const valueRefusal = valueKind === 'expression' ? RECIPE_COCKPIT_UPDATER_TYPED_EXPRESSION_REFUSAL
                    : typing.recipeNicknames.includes(typedText) ? `"${typedText}" ${RECIPE_COCKPIT_UPDATER_TYPED_NICKNAME_REFUSAL}`
                    : hub.validateFixedValueInput(typedText, typing.fieldViewModel, typing.declaredPicklistValues);

                if ( valueRefusal !== undefined ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${objectApiName}.${columnPlan.fieldApiName} was not changed: ${valueRefusal}`));
                    break;
                }

                this.setCellValue(objectEdits, rowRecord as Record<string, unknown>, rowRecordId, columnPlan.fieldApiName,
                                  { value: RecipeCockpitAdapterState.toUpdaterFixedValue(typedText, valueKind), typedScalar: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: typedText, kind: valueKind }) });
                break;

            }

            case 'resetCell':
                if ( rowRecordId !== undefined && columnPlan ) { this.setCellValue(objectEdits, rowRecord as Record<string, unknown>, rowRecordId, columnPlan.fieldApiName, undefined); }
                break;

            case 'resetColumn':
                if ( columnPlan ) {
                    const loadedRecordsById = recordsById();
                    [...objectEdits.changedValuesByRecordId.keys()].forEach(recordId => this.setCellValue(objectEdits, loadedRecordsById.get(recordId) ?? {}, recordId, columnPlan.fieldApiName, undefined));
                }
                break;

            // THE MARKS STAY: THEY SAY WHICH RECORDS THE READER MEANS TO CHANGE, NOT WHAT TO
            case 'resetObject':
                objectEdits.changedValuesByRecordId.clear();
                objectEdits.typedScalarsByRecordId.clear();
                break;

            case 'generateCell':
            case 'generateColumn': {

                // A VALUE IS MADE ONLY FOR A MARKED ROW: ONE CELL'S, OR EVERY MARKED ROW'S IN THE COLUMN
                const targetRecordIds = editKind === 'generateColumn'
                    ? records.flatMap(record => { const recordId = this.readRecordId(record); return recordId !== undefined && objectEdits.markedRecordIds.has(recordId) ? [recordId] : []; })
                    : ( rowRecordId !== undefined && objectEdits.markedRecordIds.has(rowRecordId) ? [rowRecordId] : [] );

                if ( !columnPlan?.generation || targetRecordIds.length === 0 ) {
                    break;
                }

                const generatedValues = await this.takeGeneratedValues(hub, panelState, treeKey, objectApiName, columnPlan, objectEdits, targetRecordIds.length, generateValues);

                // THE RUN YIELDED: A LOAD LET GO OR REPLACED MEANWHILE TAKES NO VALUE MADE FOR THE ONE BEFORE IT
                if ( !generatedValues || RecipeCockpitAdapterState.heldUpdaterRecords !== heldRecords || hub.recipeCockpitPanel !== cockpitPanel || hub.recipeCockpitPanelState !== panelState ) {
                    return;
                }

                // ONE CELL'S RECORD IS ALREADY IN HAND; ONLY A COLUMN NEEDS EVERY RECORD BY ITS Id
                const loadedRecordsById = editKind === 'generateCell' && rowRecord && rowRecordId !== undefined ? new Map([[rowRecordId, rowRecord]]) : recordsById();
                targetRecordIds.forEach((recordId, valueIndex) => this.setCellValue(objectEdits, loadedRecordsById.get(recordId) ?? {}, recordId, columnPlan.fieldApiName, { value: generatedValues[valueIndex] }));
                break;

            }

        }

        this.postEditedPage(hub, cockpitPanel, panelState, { treeKey: treeKey, renderSequence: renderSequence, objectApiName: objectApiName, pageIndex: pageIndex });

    }

    // A CELL'S NEW VALUE, OR NONE: A VALUE EQUAL TO THE ONE LOADED IS NO CHANGE, SO AN UPDATE NEVER WRITES A RECORD ITS OWN VALUE
    private static setCellValue(objectEdits: IRecipeCockpitUpdaterObjectEdits, loadedRecord: Record<string, unknown>, recordId: string, fieldApiName: string,
                                newValue: { value: unknown; typedScalar?: string } | undefined) {

        const changedValues = objectEdits.changedValuesByRecordId.get(recordId) ?? new Map<string, unknown>();
        const typedScalars = objectEdits.typedScalarsByRecordId.get(recordId) ?? new Map<string, string>();
        const recordKey = this.findRecordKey(loadedRecord, fieldApiName);
        const loadedValue = recordKey === undefined ? null : loadedRecord[recordKey] ?? null;

        // A CELL IS TYPED ONLY WHILE IT HOLDS THE VALUE TYPED: 🎲 AND ↺ TAKE THAT AWAY
        typedScalars.delete(fieldApiName);
        if ( newValue === undefined || ( newValue.value ?? null ) === loadedValue ) {
            changedValues.delete(fieldApiName);
        } else {
            changedValues.set(fieldApiName, newValue.value ?? null);
            if ( newValue.typedScalar !== undefined ) { typedScalars.set(fieldApiName, newValue.typedScalar); }
        }

        if ( typedScalars.size === 0 ) {
            objectEdits.typedScalarsByRecordId.delete(recordId);
        } else {
            objectEdits.typedScalarsByRecordId.set(recordId, typedScalars);
        }

        if ( changedValues.size === 0 ) {
            objectEdits.changedValuesByRecordId.delete(recordId);
        } else {
            objectEdits.changedValuesByRecordId.set(recordId, changedValues);
        }

    }

    /*
        valueCount values for one field. A fixed value from the Treecipe tab is that value every
        time. Anything else comes from the field's pool, filled by one run of the recipe's backend
        whenever it is short: at least a pool's worth, so a cell's 🎲 costs a run once in fifty
        clicks, and a column's 🎲 one run for all its rows. undefined, after ONE warning, when no
        value could be made.
    */
    private static async takeGeneratedValues(hub: IRecipeCockpitHubForAdapterTab, panelState: IRecipeCockpitPanelState, treeKey: string, objectApiName: string,
                                             columnPlan: IRecipeCockpitUpdaterColumnPlan,
                                             objectEdits: IRecipeCockpitUpdaterObjectEdits,
                                             valueCount: number,
                                             generateValues: RecipeCockpitUpdaterValueGenerator): Promise<unknown[] | undefined> {

        const generation = columnPlan.generation as NonNullable<IRecipeCockpitUpdaterColumnPlan['generation']>;
        const fieldLabel = `${objectApiName}.${columnPlan.fieldApiName}`;

        if ( generation.source === 'recipeFixed' ) {
            return Array.from({ length: valueCount }, () => generation.fixedValue);
        }

        const valuePool = objectEdits.valuePoolsByFieldApiName.get(columnPlan.fieldApiName) ?? [];
        objectEdits.valuePoolsByFieldApiName.set(columnPlan.fieldApiName, valuePool);

        if ( valuePool.length < valueCount ) {

            const fakerService = hub.readTreeFakerService(panelState, treeKey);
            if ( !fakerService ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`No value was generated for ${fieldLabel}: this card has no single recipe file whose faker backend can be told.`));
                return undefined;
            }

            const runValueCount = Math.max(RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE, valueCount - valuePool.length);
            const runState: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: treeKey, runKind: 'generate' };
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, runState);

            let generationResult: Awaited<ReturnType<RecipeCockpitUpdaterValueGenerator>>;
            try {
                const runBackend = (isCancelled: () => boolean) => generateValues(fakerService, objectApiName, runValueCount, [{ fieldApiName: columnPlan.fieldApiName, valueText: generation.valueText }], isCancelled);
                // A COLUMN OF MANY ROWS SHOWS ITS PROGRESS AND CAN BE CANCELLED; A CELL'S RUN IS OVER BEFORE A NOTIFICATION WOULD DRAW
                generationResult = valueCount > RECIPE_COCKPIT_UPDATER_VALUE_POOL_SIZE
                    ? await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: generating ${runValueCount} values for ${fieldLabel} with ${fakerService}`),
                        cancellable: true
                    }, async (_progress, cancellationToken) => await runBackend(() => cancellationToken.isCancellationRequested))
                    : await runBackend(() => false);
            } catch (generationError) {
                generationResult = { refusal: RecipeCockpitUntrustedValue.describeThrown(generationError) };
            } finally {
                RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
                RecipeCockpitAdapterState.setUpdaterLoadState(hub, { ...runState, isRunning: false });
            }

            if ( 'isCancelled' in generationResult ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Generating values for ${fieldLabel} was cancelled, so no cell was changed.`));
                return undefined;
            }

            if ( 'refusal' in generationResult ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`No value was generated for ${fieldLabel}: ${generationResult.refusal}`));
                return undefined;
            }

            // A BACKEND THAT WROTE NO VALUE FOR THE FIELD (A null EXPRESSION) GIVES null, NEVER ANOTHER RECORD'S VALUE
            generationResult.records.forEach(generatedRecord => valuePool.push(generatedRecord[columnPlan.fieldApiName] ?? null));

        }

        return valuePool.length >= valueCount ? valuePool.splice(0, valueCount) : undefined;

    }

    /*
        The update the edits ask for: per object, in the order given (parents first), the marked
        records that hold a change, each with only its own changed fields. What the adapted data
        set and recipe (#448) record is the same: only the fields an update writes.
    */
    static planUpdate(heldRecords: HeldUpdaterRecords, objectApiNames: readonly string[]): IRecipeCockpitUpdaterUpdatePlan {

        const plannedObjects: IRecipeCockpitUpdaterPlannedObject[] = [];
        const orgOnlyFieldApiNamesByObjectApiName = new Map<string, string[]>();
        const adaptedRecipeFields: IAdaptedRecipeField[] = [];

        objectApiNames.forEach(objectApiName => {

            const objectEdits = this.findObjectEdits(heldRecords, objectApiName);
            const editSummary = this.summarizeObjectEdits(heldRecords, objectApiName);
            if ( !objectEdits || editSummary.updatableRecordCount === 0 ) {
                return;
            }

            const fieldApiNames = editSummary.changedFieldApiNames;
            const loadedRecords: Record<string, unknown>[] = [];
            const recordValues: IRecipeCockpitUpdaterRecordValues[] = [];

            // IN THE ORDER LOADED, SO THE SAME EDITS ALWAYS SEND THE SAME REQUESTS
            ( heldRecords.recordsByObjectApiName.get(objectApiName) ?? [] ).forEach(loadedRecord => {
                const recordId = this.readRecordId(loadedRecord);
                const changedValues = recordId === undefined ? undefined : objectEdits.changedValuesByRecordId.get(recordId);
                if ( recordId === undefined || !changedValues || !objectEdits.markedRecordIds.has(recordId) ) {
                    return;
                }
                loadedRecords.push(loadedRecord);
                recordValues.push({ recordId: recordId, fieldValues: Object.fromEntries(fieldApiNames.filter(fieldApiName => changedValues.has(fieldApiName)).map(fieldApiName => [fieldApiName, changedValues.get(fieldApiName)])) });
            });

            plannedObjects.push({ objectApiName: objectApiName, fieldApiNames: fieldApiNames, recordValues: recordValues, loadedRecords: loadedRecords, markedRecordCount: editSummary.markedRecordCount });

            ( heldRecords.columnPlansByObjectApiName.get(objectApiName) ?? [] ).filter(columnPlan => fieldApiNames.includes(columnPlan.fieldApiName)).forEach(columnPlan => {

                const generation = columnPlan.generation;
                const isOrgOnly = generation?.isOrgOnly === true || columnPlan.typing?.isOrgOnly === true;
                if ( isOrgOnly ) {
                    orgOnlyFieldApiNamesByObjectApiName.set(objectApiName, [...( orgOnlyFieldApiNamesByObjectApiName.get(objectApiName) ?? [] ), columnPlan.fieldApiName]);
                }

                /*
                    The one line the adapted recipe (#448) writes for the field. Every record given the
                    SAME typed value: that value. Otherwise the expression its 🎲 generates from -- the
                    recipe already holds a value that came from it, so its lines are only marked, and an
                    org-only field is written as the line it was generated from. A field with no
                    expression, typed differently per record, has no one line: the first record's value
                    stands for it, so the field is still named as updated.
                */
                const writtenValues = recordValues.filter(recordValue => Object.prototype.hasOwnProperty.call(recordValue.fieldValues, columnPlan.fieldApiName));
                const typedScalars = writtenValues.map(recordValue => objectEdits.typedScalarsByRecordId.get(recordValue.recordId)?.get(columnPlan.fieldApiName));
                const [firstTypedScalar] = typedScalars.filter(typedScalar => typedScalar !== undefined);
                const isOneTypedValue = typedScalars.length > 0 && typedScalars.every(typedScalar => typedScalar !== undefined && typedScalar === typedScalars[0]);

                if ( generation && !isOneTypedValue ) {
                    adaptedRecipeFields.push({
                        objectApiName: objectApiName,
                        fieldApiName: columnPlan.fieldApiName,
                        valueText: generation.recipeValueText ?? generation.valueText,
                        ...( generation.source === 'orgExpression' ? {} : { isRecipeValue: true as const } ),
                        ...( isOrgOnly ? { isOrgOnly: true as const } : {} )
                    });
                } else if ( firstTypedScalar !== undefined ) {
                    adaptedRecipeFields.push({ objectApiName: objectApiName, fieldApiName: columnPlan.fieldApiName, valueText: firstTypedScalar, ...( isOrgOnly ? { isOrgOnly: true as const } : {} ) });
                }

            });

        });

        return {
            plannedObjects: plannedObjects,
            valuesByObjectApiName: new Map(plannedObjects.map(plannedObject => [plannedObject.objectApiName, plannedObject.recordValues] as const)),
            orgOnlyFieldApiNamesByObjectApiName: orgOnlyFieldApiNamesByObjectApiName,
            adaptedRecipeFields: adaptedRecipeFields
        };

    }

    // A RECORD IS MARKED AND CHANGED BY ITS Id; ONE THE ORG ANSWERED WITHOUT A WHOLE Id CANNOT BE
    private static readRecordId(record: Record<string, unknown>): string | undefined {
        return RecipeCockpitQuery.readLinkedRecordId(record, 'Id');
    }

    // SOQL NAMES ARE CASE-INSENSITIVE, AND THE ORG ANSWERS WITH ITS OWN CASING
    private static findRecordKey(record: Record<string, unknown>, fieldApiName: string): string | undefined {
        if ( Object.prototype.hasOwnProperty.call(record, fieldApiName) ) {
            return fieldApiName;
        }
        const lowerCaseName = fieldApiName.toLowerCase();
        return Object.keys(record).find(recordKey => recordKey.toLowerCase() === lowerCaseName);
    }

}
