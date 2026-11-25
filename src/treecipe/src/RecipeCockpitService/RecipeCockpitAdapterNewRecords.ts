import * as vscode from 'vscode';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeCockpitRecipeWriter } from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_PREVIEW_NOTE
} from './RecipeCockpitAdapterConstants';
import { RecipeCockpitQuery } from './RecipeCockpitQuery';
import { RecipeCockpitRecordCreation } from './RecipeCockpitRecordCreation';
import {
    RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE,
    RECIPE_COCKPIT_UPDATER_TYPED_NICKNAME_REFUSAL
} from './RecipeCockpitAdapterEdits';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
// TYPES ONLY: THE HOST LOADS THIS FILE, NEVER THE OTHER WAY
import type {
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterLoadStateMessage,
    IRecipeCockpitUpdaterNewRecordsMessage,
    IRecipeCockpitUpdaterNewRecordsPageMessage,
    RecipeCockpitAdapterPanelAction
} from './RecipeCockpitAdapterHost';
import type {
    IRecipeCockpitUpdaterColumnPlan,
    RecipeCockpitUpdaterValueGenerator
} from './RecipeCockpitAdapterEdits';
import type { IRecipeCockpitPanelState } from './RecipeCockpitViewModel';

/*
    "Generate new records" (#722, slice C of #719): new records of an object the tree already
    has, under the records a load read of the object above it. The reader ticks the fields, may
    type a fixed value or an expression for one, and sets a count per loaded parent record; the
    recipe's own backend then generates count x parents records, each given a loaded parent's Id.

    Everything is held on the HOST, one set per object, beside the loaded records it was made
    under and let go with them. Nothing is written to the org or to the recipe: slice D inserts.
    A field is generated from the column plan the load made for it (#721), so its lock, its
    expression and what a typed value is held to are the record table's own.
*/

export const RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL = 'Generate records';
export const RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOTE = RECIPE_COCKPIT_UPDATER_NEW_RECORDS_PREVIEW_NOTE;
export const RECIPE_COCKPIT_UPDATER_NEW_RECORDS_FIXED_ONLY_REFUSAL = 'it takes a fixed value only, since this recipe\'s faker backend writes no expression for its type in the org.';
export const RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_EXPRESSION_REASON = 'its recipe has no faker expression for it. Type a value for it, or untick it.';

type GenerateNewRecordsAction = Extract<RecipeCockpitAdapterPanelAction, { kind: 'generateUpdaterNewRecords' }>;
type NewRecordsPageAction = Extract<RecipeCockpitAdapterPanelAction, { kind: 'postUpdaterNewRecordsPage' }>;
type PlannedFieldSource = 'recipe' | 'recipeEdit' | 'recipeFixed' | 'orgExpression' | 'expression' | 'fixed';

interface IPlannedNewRecordField {
    fieldApiName: string;
    source: PlannedFieldSource;
    // WHAT THE CONFIRMATION SHOWS
    shownValue: string;
    // THE SCALAR A ONE-OBJECT RECIPE GENERATES FROM; ABSENT FOR A FIXED VALUE, WHICH NO BACKEND RUNS FOR
    valueText?: string;
    fixedValue?: unknown;
}

// WHAT NEW RECORDS OF ONE OBJECT GO UNDER AND WHAT EACH FIELD IS HELD TO
export interface IRecipeCockpitNewRecordsTarget {
    parentObjectApiName: string;
    lookupFieldApiName: string;
    parentRecordIds: string[];
    columnPlans: IRecipeCockpitUpdaterColumnPlan[];
}

const SOURCE_LABELS: Record<PlannedFieldSource, string> = {
    recipe: 'recipe expression',
    recipeEdit: 'expression edited on the Treecipe tab',
    recipeFixed: 'fixed value from the Treecipe tab',
    orgExpression: 'expression the recipe\'s backend writes for its type in the org',
    expression: 'expression typed here',
    fixed: 'fixed value typed here'
};

export class RecipeCockpitAdapterNewRecords {

    // THE LOADED PARENT RECORDS' Ids, IN LOAD ORDER: THE ONES NEW RECORDS OF THE OBJECT ARE SPREAD UNDER
    static listParentRecordIds(objectApiName: string): string[] | undefined {
        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const narrowingLookup = heldRecords?.narrowingLookupsByObjectApiName.get(objectApiName);
        const parentRecords = narrowingLookup ? heldRecords?.recordsByObjectApiName.get(narrowingLookup.parentObjectApiName) : undefined;
        return parentRecords?.flatMap(parentRecord => {
            const parentRecordId = RecipeCockpitQuery.readLinkedRecordId(parentRecord, 'Id');
            return parentRecordId === undefined ? [] : [parentRecordId];
        });
    }

    /*
        What new records of an object go under and are generated from, or undefined when none can
        be: a TREE object the load read below the parent (the lookup it was narrowed by, the loaded
        records above it and the column plans of #721), or the ORG-ONLY child Add to data set
        prepared for this card and this load (#447: its lookup, the parents it was prepared under,
        and its retrieved fields as plans). One answer for the router and the run.
    */
    static resolveTarget(objectApiName: string, treeKey: string): IRecipeCockpitNewRecordsTarget | undefined {

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        if ( !heldRecords ) {
            return undefined;
        }

        const narrowingLookup = heldRecords.narrowingLookupsByObjectApiName.get(objectApiName);
        const columnPlans = heldRecords.columnPlansByObjectApiName.get(objectApiName);
        if ( narrowingLookup && columnPlans ) {
            return { parentObjectApiName: narrowingLookup.parentObjectApiName, lookupFieldApiName: narrowingLookup.fieldApiName, parentRecordIds: this.listParentRecordIds(objectApiName) ?? [], columnPlans: columnPlans };
        }

        const heldChild = RecipeCockpitAdapterState.heldAdapterChild;
        if ( !heldChild || heldChild.resultKey !== heldRecords.resultKey || heldChild.treeKey !== treeKey || heldChild.childObjectApiName !== objectApiName ) {
            return undefined;
        }

        // A WHOLE-STRING NICKNAME IS A REFERENCE TO faker-js AND THE INSERT'S Id SWAP, NEVER TEXT: THE CHILD'S BLOCK HAS ONE OF ITS OWN
        const recipeNicknames = [`${objectApiName}_Adapter_NickName`];
        return {
            parentObjectApiName: heldChild.parentObjectApiName,
            lookupFieldApiName: heldChild.lookupFieldApiName,
            parentRecordIds: heldChild.parentRecordIds,
            columnPlans: [...heldChild.fields.values()].map((offeredField): IRecipeCockpitUpdaterColumnPlan => offeredField.lockReason !== undefined
                ? { fieldApiName: offeredField.fieldViewModel.fieldApiName, lockReason: offeredField.lockReason }
                : {
                    fieldApiName: offeredField.fieldViewModel.fieldApiName,
                    typing: { fieldViewModel: offeredField.fieldViewModel, declaredPicklistValues: offeredField.picklistValues.length > 0 ? offeredField.picklistValues : undefined, recipeNicknames: recipeNicknames, isOrgOnly: true },
                    ...( offeredField.expression !== undefined
                        ? { generation: { source: 'orgExpression' as const, valueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: offeredField.expression, kind: 'expression' }), isOrgOnly: true as const } }
                        : {} )
                })
        };

    }

    static async generateFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                   panelState: IRecipeCockpitPanelState,
                                   generateAction: GenerateNewRecordsAction,
                                   generateValues: RecipeCockpitUpdaterValueGenerator) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: generateAction.treeKey, runKind: 'generateNew', objectApiName: generateAction.objectApiName };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { ...notRunning, isRunning: true });

        try {
            await this.performGenerate(hub, cockpitPanel, panelState, generateAction, generateValues);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, notRunning);
        }

    }

    private static async performGenerate(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                         panelState: IRecipeCockpitPanelState,
                                         generateAction: GenerateNewRecordsAction,
                                         generateValues: RecipeCockpitUpdaterValueGenerator) {

        const { treeKey, renderSequence, objectApiName, countPerParent, fieldRequests } = generateAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const target = this.resolveTarget(objectApiName, treeKey);
        const refuse = (reason: string) => VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`No new ${objectApiName} records were generated: ${reason}`));

        if ( !clickedRecipeDataMessage || clickedRecipeDataMessage.renderSequence !== renderSequence || !heldRecords || heldRecords.renderSequence !== renderSequence || !target ) {
            return;
        }

        const { columnPlans, parentObjectApiName, lookupFieldApiName, parentRecordIds } = target;

        const fakerService = hub.readTreeFakerService(panelState, treeKey);
        if ( !fakerService ) {
            refuse('this card has no single recipe file whose faker backend can be told.');
            return;
        }

        const plannedFields: IPlannedNewRecordField[] = [];

        for ( const fieldRequest of fieldRequests ) {

            const fieldLabel = `${objectApiName}.${fieldRequest.fieldApiName}`;
            const columnPlan = columnPlans.find(candidatePlan => candidatePlan.fieldApiName === fieldRequest.fieldApiName);

            if ( !columnPlan || columnPlan.lockReason !== undefined || !columnPlan.typing ) {
                refuse(`${fieldLabel} cannot be filled${columnPlan?.lockReason ? `: ${columnPlan.lockReason}` : ''}.`);
                return;
            }

            if ( fieldRequest.value === undefined ) {
                const generation = columnPlan.generation;
                if ( !generation ) {
                    refuse(`${fieldLabel}: ${RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_EXPRESSION_REASON}`);
                    return;
                }
                plannedFields.push(generation.source === 'recipeFixed'
                    ? { fieldApiName: columnPlan.fieldApiName, source: 'recipeFixed', shownValue: generation.valueText, fixedValue: generation.fixedValue }
                    : { fieldApiName: columnPlan.fieldApiName, source: generation.source, shownValue: this.readScalarText(generation.valueText), valueText: generation.valueText });
                continue;
            }

            const valueRefusal = columnPlan.typing.recipeNicknames.includes(fieldRequest.value)
                ? `"${fieldRequest.value}" ${RECIPE_COCKPIT_UPDATER_TYPED_NICKNAME_REFUSAL}`
                : hub.validateFixedValueInput(fieldRequest.value, columnPlan.typing.fieldViewModel, columnPlan.typing.declaredPicklistValues);
            if ( valueRefusal !== undefined ) {
                refuse(`${fieldLabel}: ${valueRefusal}`);
                return;
            }

            const valueKind = hub.resolveFixedValueKind(fieldRequest.value, columnPlan.typing.fieldViewModel);
            // AS Add to data set REFUSES IT (#447): A TYPE THE BACKEND WRITES NO EXPRESSION FOR IN THE ORG TAKES A FIXED VALUE ONLY
            if ( valueKind === 'expression' && columnPlan.typing.isOrgOnly && !columnPlan.generation ) {
                refuse(`${fieldLabel}: ${RECIPE_COCKPIT_UPDATER_NEW_RECORDS_FIXED_ONLY_REFUSAL}`);
                return;
            }
            plannedFields.push(valueKind === 'expression'
                ? { fieldApiName: columnPlan.fieldApiName, source: 'expression', shownValue: fieldRequest.value, valueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: fieldRequest.value, kind: valueKind }) }
                : { fieldApiName: columnPlan.fieldApiName, source: 'fixed', shownValue: fieldRequest.value, fixedValue: RecipeCockpitAdapterState.toUpdaterFixedValue(fieldRequest.value, valueKind) });

        }

        const parentRecordIdsByRecord = RecipeCockpitRecordCreation.spreadParentIds(parentRecordIds, countPerParent);
        if ( !parentRecordIdsByRecord ) {
            refuse(RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON);
            return;
        }

        const recordCount = parentRecordIdsByRecord.length;
        const describeRecords = (count: number, describedObjectApiName: string) => `${count} ${describedObjectApiName} ${count === 1 ? 'record' : 'records'}`;
        const answer = await hub.confirmInPanel(
            `Generate ${describeRecords(recordCount, `new ${objectApiName}`)} under the loaded ${parentObjectApiName} records?`,
            {
                summary: [
                    `${countPerParent} per ${parentObjectApiName} record, under ${describeRecords(parentRecordIds.length, parentObjectApiName)}: ${describeRecords(recordCount, objectApiName)}`,
                    '',
                    `Generated by the recipe's own backend, ${fakerService}. ${RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOTE}`
                ],
                // AN EXPRESSION TYPED HERE IS CODE THE BACKEND RUNS, SO IT STAYS ON SCREEN RATHER THAN FOLDED IN THE FIELDS SECTION
                warnings: plannedFields
                    .filter(plannedField => plannedField.source === 'expression')
                    .map(plannedField => `Runs the expression typed for ${objectApiName}.${plannedField.fieldApiName}: ${plannedField.shownValue}`),
                sections: [
                    {
                        title: 'Fields',
                        count: plannedFields.length + 1,
                        lines: [
                            `  ${lookupFieldApiName} -- the Id of a loaded ${parentObjectApiName} record, ${countPerParent} in a row`,
                            ...plannedFields.map(plannedField => `  ${plannedField.fieldApiName} -- ${SOURCE_LABELS[plannedField.source]}: ${plannedField.shownValue}`)
                        ]
                    }
                ]
            },
            RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL
        );

        const isStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                    && hub.recipeCockpitPanelState === panelState
                                    && panelState.recipeDataMessage === clickedRecipeDataMessage
                                    && RecipeCockpitAdapterState.heldUpdaterRecords === heldRecords;

        if ( answer !== RECIPE_COCKPIT_UPDATER_NEW_RECORDS_CONFIRM_LABEL || !isStillCurrent() ) {
            return;
        }

        const generatedFields = plannedFields.flatMap(plannedField => plannedField.valueText === undefined ? [] : [{ fieldApiName: plannedField.fieldApiName, valueText: plannedField.valueText }]);
        // EVERY FIELD FIXED: THERE IS NOTHING FOR A BACKEND TO GENERATE, SO NONE RUNS
        let generation: Awaited<ReturnType<RecipeCockpitUpdaterValueGenerator>> = generatedFields.length === 0
            ? { records: Array.from({ length: recordCount }, () => ({ attributes: { type: objectApiName } })) }
            : { isCancelled: true };

        if ( generatedFields.length > 0 ) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: generating ${describeRecords(recordCount, `new ${objectApiName}`)} with ${fakerService}`),
                cancellable: true
            }, async (progress, cancellationToken) => {
                generation = await generateValues(fakerService, objectApiName, recordCount, generatedFields, () => cancellationToken.isCancellationRequested,
                                                  (generatedCount: number) => progress.report({ message: `${generatedCount} of ${recordCount}` }));
            });
        }

        const finishedGeneration = generation as Awaited<ReturnType<RecipeCockpitUpdaterValueGenerator>>;

        if ( 'refusal' in finishedGeneration ) {
            refuse(finishedGeneration.refusal);
            return;
        }
        if ( 'isCancelled' in finishedGeneration ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Generating the new ${objectApiName} records was cancelled, so none were kept.`));
            return;
        }
        if ( !isStillCurrent() ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The new ${objectApiName} records were not kept: the run on screen or its records changed while they were generated. Generate them again.`));
            return;
        }
        // A RUN THAT ANSWERED ANOTHER NUMBER OF RECORDS WOULD LEAVE A PARENT WITH TOO FEW OR A RECORD WITH NO PARENT
        if ( finishedGeneration.records.length !== recordCount ) {
            refuse(`${fakerService} generated ${finishedGeneration.records.length} records where ${recordCount} were asked for.`);
            return;
        }

        // EACH CHUNK OF A RUN NUMBERS ITS referenceIds FROM 1, SO EVERY RECORD IS GIVEN ONE BY ITS PLACE IN THE WHOLE SET, OR AN INSERT WOULD READ TWO RECORDS AS ONE
        const records = finishedGeneration.records;
        records.forEach((record, recordIndex) => {
            const attributes = record.attributes && typeof record.attributes === 'object' ? record.attributes as Record<string, unknown> : {};
            record.attributes = { ...attributes, referenceId: `${objectApiName}_Adapter_Reference_${recordIndex + 1}` };
            record[lookupFieldApiName] = parentRecordIdsByRecord[recordIndex];
            plannedFields.forEach(plannedField => {
                // A BACKEND THAT WROTE NO VALUE FOR A FIELD (A null EXPRESSION) GIVES IT NONE, NEVER ANOTHER RECORD'S
                record[plannedField.fieldApiName] = plannedField.valueText === undefined ? plannedField.fixedValue : record[plannedField.fieldApiName] ?? null;
            });
        });

        if ( RecipeCockpitAdapterState.heldUpdaterNewRecords?.resultKey !== heldRecords.resultKey ) {
            RecipeCockpitAdapterState.heldUpdaterNewRecords = { resultKey: heldRecords.resultKey, byObjectApiName: new Map() };
        }
        RecipeCockpitAdapterState.heldUpdaterNewRecords.byObjectApiName.set(objectApiName, {
            parentObjectApiName: parentObjectApiName,
            lookupFieldApiName: lookupFieldApiName,
            countPerParent: countPerParent,
            columnFieldApiNames: [lookupFieldApiName, ...plannedFields.map(plannedField => plannedField.fieldApiName)],
            records: records
        });

        const firstPage = this.buildPage(objectApiName, 0);
        if ( !firstPage ) {
            return;
        }

        const newRecordsMessage: IRecipeCockpitUpdaterNewRecordsMessage = {
            command: 'updaterNewRecords',
            renderSequence: renderSequence,
            treeKey: treeKey,
            objectApiName: objectApiName,
            parentObjectApiName: parentObjectApiName,
            countPerParent: countPerParent,
            recordCount: records.length,
            pageCount: Math.ceil(records.length / RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE),
            columns: firstPage.columns,
            rows: firstPage.rows
        };
        panelState.updaterNewRecordsMessages = [...( panelState.updaterNewRecordsMessages ?? [] ).filter(heldMessage => heldMessage.objectApiName !== objectApiName), newRecordsMessage];
        hub.postToPanel(cockpitPanel, newRecordsMessage);

        VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(
            `Generated ${describeRecords(records.length, `new ${objectApiName}`)}, ${countPerParent} per loaded ${parentObjectApiName} record. Nothing was written to the org.`));

    }

    // AN EXPRESSION IS PLANNED AS THE DOUBLE-QUOTED SCALAR A RECIPE HOLDS IT AS; A CONFIRMATION SHOWS THE EXPRESSION ITSELF
    private static readScalarText(valueText: string): string {
        try {
            const scalarValue: unknown = JSON.parse(valueText);
            return typeof scalarValue === 'string' ? scalarValue : valueText;
        } catch {
            return valueText;
        }
    }

    // ONE PAGE OF AN OBJECT'S NEW RECORDS, CUT FROM THE RECORDS THE HOST HOLDS: THE PARENT'S Id FIRST, THEN THE FIELDS FILLED
    static buildPage(objectApiName: string, pageIndex: number): { columns: string[]; rows: string[][] } | undefined {

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const heldNewRecords = RecipeCockpitAdapterState.heldUpdaterNewRecords;
        const objectNewRecords = heldRecords && heldNewRecords?.resultKey === heldRecords.resultKey ? heldNewRecords.byObjectApiName.get(objectApiName) : undefined;

        if ( !objectNewRecords || pageIndex < 0 || pageIndex * RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE >= objectNewRecords.records.length ) {
            return undefined;
        }

        const tablePage = RecipeCockpitQuery.buildTablePage(objectNewRecords.records, objectNewRecords.columnFieldApiNames, [], pageIndex, RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE);

        return { columns: tablePage.columns, rows: tablePage.rows };

    }

    static postPage(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, pageAction: NewRecordsPageAction) {

        const page = this.buildPage(pageAction.objectApiName, pageAction.pageIndex);
        if ( !page ) {
            return;
        }

        const pageMessage: IRecipeCockpitUpdaterNewRecordsPageMessage = {
            command: 'updaterNewRecordsPage',
            renderSequence: pageAction.renderSequence,
            treeKey: pageAction.treeKey,
            objectApiName: pageAction.objectApiName,
            pageIndex: pageAction.pageIndex,
            rows: page.rows
        };
        hub.postToPanel(cockpitPanel, pageMessage);

    }

}
