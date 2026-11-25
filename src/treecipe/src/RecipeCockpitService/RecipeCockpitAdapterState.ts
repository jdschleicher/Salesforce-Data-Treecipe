import type { Connection } from '@salesforce/core';
import { ReadOnlyFields } from '../ObjectInfoWrapper/ReadOnlyFields';
import { StandardDerivedFields } from '../ObjectInfoWrapper/StandardDerivedFields';
import {
    RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX,
    RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX
} from './RecipeCockpitFieldRowsConstants';
import {
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES
} from './RecipeCockpitFieldRowsConstants';
import {
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_FIELD_TYPES,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON
} from './RecipeCockpitAdapterConstants';
import {
    INormalizedOrgObjectDescribe,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import {
    RecipeFixedValueKind
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    IRecipeCockpitUpdaterTreeObject,
    RecipeCockpitTreeUpdaterQuery
} from './RecipeCockpitTreeUpdaterQuery';
// TYPES ONLY: THE EDITS FILE LOADS THIS ONE
import type {
    IRecipeCockpitUpdaterColumnPlan,
    IRecipeCockpitUpdaterObjectEdits
} from './RecipeCockpitAdapterEdits';
import {
    IOrgChangeHints,
    IOrgObjectChanges,
    RecipeCockpitOrgChangeDetection
} from './RecipeCockpitOrgChangeDetection';
import type {
    IRecipeCockpitAdapterOrgOnlyField,
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterLoadStateMessage
} from './RecipeCockpitAdapterHost';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type {
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitViewModel';

/*
    What the Treecipe Adapter holds between clicks (moved out of the hub by #668): the one load per
    window and its replay, the records, values and child block a run left, and the reads the router
    and both run files share. It loads nothing of the tab's, so every Adapter file may import it.
*/

export class RecipeCockpitAdapterState {

    static isUpdaterLoadInFlight = false;

    static updaterLoadRunStateMessage: IRecipeCockpitUpdaterLoadStateMessage | undefined;

    /*
        The last load's records (#416), held for the slices of #414 that update them and posted only
        as counts and previews. One load is kept, so its records are let go before the next is read.
    */
    static heldUpdaterRecords: {
        // THE WORKSPACE, MODEL, TREE FOLDER AND ORG USERNAME IT WAS LOADED FOR, AS ONE KEY
        resultKey: string;
        workspaceRoot: string;
        renderSequence: number;
        folderName: string;
        orgUsername: string;
        recordsByObjectApiName: Map<string, Record<string, unknown>[]>;
        // THE FIELDS EACH OBJECT WAS READ WITH: A VALUE IS GENERATED ONLY FOR A FIELD WHOSE CURRENT VALUE WAS READ (#417)
        loadedFieldApiNamesByObjectApiName: Map<string, string[]>;
        // THE OBJECT THE LOAD STARTED FROM AND EACH OBJECT'S WHERE AS TYPED, WHICH AN ADAPTED DATA SET RECORDS (#448)
        parentObjectApiName: string;
        whereClausesByObjectApiName: Map<string, string>;
        // EACH OBJECT'S TABLE (#720): ITS COLUMNS IN ORDER, WHICH OF THEM ARE LOOKUPS, AND THE PAGES POSTED SO FAR
        columnFieldApiNamesByObjectApiName: Map<string, string[]>;
        lookupFieldApiNamesByObjectApiName: Map<string, string[]>;
        postedPageIndexesByObjectApiName: Map<string, Set<number>>;
        // EACH COLUMN'S LOCK OR THE SOURCE ITS 🎲 GENERATES FROM (#721), PLANNED AT THE LOAD FROM THE MODEL ON SCREEN
        columnPlansByObjectApiName: Map<string, IRecipeCockpitUpdaterColumnPlan[]>;
        // EVERY OBJECT BELOW THE PARENT: THE LOOKUP ITS RECORDS WERE NARROWED BY AND THE OBJECT IT NAMES, WHICH NEW RECORDS OF IT GO UNDER (#722)
        narrowingLookupsByObjectApiName: Map<string, { fieldApiName: string; parentObjectApiName: string }>;
    } | undefined;

    /*
        The new records generated for an object (#722), one set per object: each record already
        holds a loaded parent's Id in its lookup. Held for the preview's pages and for the insert
        of slice D. They belong to the load they were generated under, so they go when it goes.
    */
    static heldUpdaterNewRecords: {
        resultKey: string;
        byObjectApiName: Map<string, { parentObjectApiName: string; lookupFieldApiName: string; countPerParent: number; columnFieldApiNames: string[]; records: Record<string, unknown>[] }>;
    } | undefined;

    /*
        What the reader marked and changed on the held records (#721): per object, the marked record
        Ids, each changed cell's new value and the values a run made that no cell has taken. They
        belong to the records they were made on, so they go whenever those records go.
    */
    static heldUpdaterEdits: {
        // THE HELD RECORDS' resultKey THEY WERE MADE ON
        resultKey: string;
        editsByObjectApiName: Map<string, IRecipeCockpitUpdaterObjectEdits>;
    } | undefined;

    /*
        The new child object being added under the held records (#447): its staged fields as offered,
        the parent Ids it is added under in the order they were read, and the recipe's backend. It
        belongs to the records it was prepared for. Its generated records are held with every other
        object's new records (heldUpdaterNewRecords, #722).
    */
    static heldAdapterChild: {
        // THE HELD RECORDS' resultKey IT WAS PREPARED FOR
        resultKey: string;
        treeKey: string;
        parentObjectApiName: string;
        childObjectApiName: string;
        lookupFieldApiName: string;
        parentRecordIds: string[];
        fields: Map<string, IRecipeCockpitAdapterOrgOnlyField>;
    } | undefined;

    static clearHeldUpdaterRecords() {
        this.heldUpdaterRecords = undefined;
        this.heldUpdaterEdits = undefined;
        this.heldUpdaterNewRecords = undefined;
        this.heldAdapterChild = undefined;
    }

    static readHeldUpdaterRecordCount(): number {
        let recordCount = 0;
        this.heldUpdaterRecords?.recordsByObjectApiName.forEach(records => { recordCount += records.length; });
        return recordCount;
    }

    // THE NEW RECORDS GENERATED UNDER THE LOAD HELD NOW (#722), OVER EVERY OBJECT: THEY GO WHEN IT GOES
    static readHeldUpdaterNewRecordCount(): number {
        let recordCount = 0;
        if ( this.heldUpdaterNewRecords && this.heldUpdaterNewRecords.resultKey === this.heldUpdaterRecords?.resultKey ) {
            this.heldUpdaterNewRecords.byObjectApiName.forEach(objectNewRecords => { recordCount += objectNewRecords.records.length; });
        }
        return recordCount;
    }

    static setUpdaterLoadState(hub: IRecipeCockpitHubForAdapterTab, loadStateMessage: IRecipeCockpitUpdaterLoadStateMessage) {

        this.updaterLoadRunStateMessage = loadStateMessage.isRunning ? loadStateMessage : undefined;
        hub.recipeCockpitPanelState.updaterLoadStateMessage = loadStateMessage;

        if ( hub.recipeCockpitPanel ) {
            hub.postToPanel(hub.recipeCockpitPanel, loadStateMessage);
        }

    }

    static adoptUpdaterLoadRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isUpdaterLoadInFlight && this.updaterLoadRunStateMessage ) {
            panelState.updaterLoadStateMessage = this.updaterLoadRunStateMessage;
        }

    }

    // A CARD'S OBJECTS AS THE UPDATER READS THEM: THE FIELDS THE MODEL LISTS FOR EACH, ITS FIRST ENTRY WINNING
    // AND, ONCE A RETRIEVE OFFERED THEM (#446), THE FIELDS ONLY THE ORG HOLDS THAT NOTHING LOCKS, AFTER THE MODEL'S OWN
    static listUpdaterTreeObjects(recipe: IRecipeCockpitRecipeViewModel,
                                  tree: IRecipeCockpitTreeViewModel,
                                  orgOnlyFieldApiNamesByObjectApiName?: ReadonlyMap<string, readonly string[]>): IRecipeCockpitUpdaterTreeObject[] {

        const fieldApiNamesByObjectApiName = new Map<string, string[]>();
        const otherLookupFieldApiNamesByObjectApiName = new Map<string, string[]>();
        recipe.objects.forEach(object => {
            if ( !fieldApiNamesByObjectApiName.has(object.objectApiName) ) {
                fieldApiNamesByObjectApiName.set(object.objectApiName, [
                    ...object.fields.map(field => field.fieldApiName),
                    ...( orgOnlyFieldApiNamesByObjectApiName?.get(object.objectApiName) ?? [] )
                ]);
                otherLookupFieldApiNamesByObjectApiName.set(object.objectApiName, object.fields
                    .filter(field => RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES.includes(String(field.fieldType)))
                    .map(field => field.fieldApiName));
            }
        });

        return RecipeCockpitTreeUpdaterQuery.listTreeObjects(tree.objects, fieldApiNamesByObjectApiName, otherLookupFieldApiNamesByObjectApiName);

    }

    // THE OFFERED FIELDS ONLY THE ORG HOLDS (#446) THAT NOTHING LOCKS, FOR THE CARD THE LAST RETRIEVE WAS FOR AND ONLY ON ITS MODEL
    static readAdapterOrgOnlyFieldApiNames(panelState: IRecipeCockpitPanelState, treeKey: string): Map<string, string[]> | undefined {

        const changesMessage = panelState.adapterMetadataChangesMessage;

        if ( !panelState.adapterOrgOnlyFields
                || !changesMessage
                || changesMessage.treeKey !== treeKey
                || changesMessage.renderSequence !== panelState.recipeDataMessage?.renderSequence ) {
            return undefined;
        }

        const fieldApiNamesByObjectApiName = new Map<string, string[]>();
        panelState.adapterOrgOnlyFields.forEach(orgOnlyField => {
            if ( orgOnlyField.lockReason === undefined ) {
                fieldApiNamesByObjectApiName.set(orgOnlyField.objectApiName, [...( fieldApiNamesByObjectApiName.get(orgOnlyField.objectApiName) ?? [] ), orgOnlyField.fieldViewModel.fieldApiName]);
            }
        });

        return fieldApiNamesByObjectApiName;

    }

    // ONE OFFERED FIELD ONLY THE ORG HOLDS (#446), ON THE SAME TERMS AS readAdapterOrgOnlyFieldApiNames, LOCKED OR NOT
    static findAdapterOrgOnlyField(panelState: IRecipeCockpitPanelState, treeKey: string, objectApiName: string, fieldApiName: string): IRecipeCockpitAdapterOrgOnlyField | undefined {

        return this.readAdapterOrgOnlyFieldApiNames(panelState, treeKey) === undefined
            ? undefined
            : panelState.adapterOrgOnlyFields?.get(`${objectApiName}\n${fieldApiName}`);

    }

    // AN INSERT OR A RUN THAT IS ABOUT TO CHANGE THE SELECTION HOLDS THE ORG THE ADAPTER WOULD READ FROM
    static isUpdaterSelectionBusy(panelState: IRecipeCockpitPanelState): boolean {

        return Boolean(panelState.insertStateMessage
                        || panelState.isQueryOrgPromptOpen
                        || panelState.isOrgPromptOpen
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning);

    }

    /*
        What the org says beside the files, on ONE connection: each object's describe (its label for
        the audit trail, its custom child objects the tree lacks -- read fresh, since the org just
        changed) and the two hints. Nothing here decides a mark: every failure is a note.
    */
    static async readAdapterOrgContext(orgUsername: string, objectApiNames: readonly string[]): Promise<{
        hints: IOrgChangeHints;
        newChildObjectsByObject: Map<string, { childObjects: IOrgObjectChanges['newChildObjects']; moreCount: number }>;
        childObjectsNote?: string;
    }> {

        let connection: Connection;
        try {
            connection = await SalesforceOrgService.getConnection(orgUsername);
        } catch {
            const unconnectedNote = 'The org could not be connected to after the retrieve, so this was not read. The marks come from the files alone.';
            const unreadHint = { rows: [], moreCount: 0, skippedCount: 0, note: unconnectedNote };
            return { hints: { sourceTracking: unreadHint, auditTrail: unreadHint }, newChildObjectsByObject: new Map(), childObjectsNote: 'The org could not be connected to after the retrieve, so new child objects are not listed.' };
        }

        objectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(orgUsername, objectApiName));
        let describedObjects: INormalizedOrgObjectDescribe[] = [];
        let undescribedCount = objectApiNames.length;
        try {
            const describeResult = await SalesforceOrgService.describeObjects(orgUsername, [...objectApiNames], async () => connection);
            describedObjects = describeResult.outcomes.filter(describeOutcome => describeOutcome.describe).map(describeOutcome => describeOutcome.describe);
            undescribedCount = objectApiNames.length - describedObjects.length;
        } catch {
            describedObjects = [];
        }

        const describedByLowerName = new Map(describedObjects.map(describedObject => [describedObject.objectApiName.toLowerCase(), describedObject] as const));
        const hints = await RecipeCockpitOrgChangeDetection.readChangeHints(
            { query: async (soql: string) => await connection.query(soql), toolingQuery: async (soql: string) => await connection.tooling.query(soql) },
            objectApiNames.map(objectApiName => ({ objectApiName: objectApiName, objectLabel: describedByLowerName.get(objectApiName.toLowerCase())?.objectLabel }))
        );
        const newChildObjectsByObject = RecipeCockpitOrgChangeDetection.listNewChildObjects(
            objectApiNames.map(objectApiName => ({ objectApiName: objectApiName, childRelationships: describedByLowerName.get(objectApiName.toLowerCase())?.childRelationships })),
            objectApiNames
        );

        return {
            hints: hints,
            newChildObjectsByObject: newChildObjectsByObject,
            ...( undescribedCount > 0
                ? { childObjectsNote: `${undescribedCount === 1 ? '1 object' : `${undescribedCount} objects`} could not be described in the org, so ${undescribedCount === 1 ? 'its' : 'their'} new child objects are not listed.` }
                : {} )
        };

    }

    /*
        Why a field cannot be filled by the Treecipe Adapter (#415, #417), or undefined: the panel's
        findUpdaterFieldLockReason, held by the host so a forged request is checked against the same
        rule the box was drawn with. Recipe selections (#219/#220) are no lock here: the Updater is
        about the org's records, not the recipe's generation.
    */
    static findUpdaterFieldLockReason(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( fieldViewModel.isOnlyInRecipeFile ) {
            return RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON;
        }
        if ( fieldViewModel.fieldApiName === 'RecordTypeId' ) {
            return RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON;
        }

        const isTreeLookup = tree.objects.some(treeObject => treeObject.objectApiName === objectApiName
                                                            && treeObject.parentLookups.some(parentLookup => parentLookup.fieldApiName === fieldViewModel.fieldApiName));
        if ( isTreeLookup || RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES.includes(fieldViewModel.fieldType) ) {
            return RECIPE_COCKPIT_UPDATER_LOOKUP_REASON;
        }
        // WHAT SALESFORCE SETS OR CALCULATES ITSELF (#680, #685), AS THE TREECIPE TAB LOCKS IT: AN UPDATE THAT NAMED ONE WOULD BE REFUSED WHOLE
        const derivedField = StandardDerivedFields.resolveDerivedField(objectApiName, fieldViewModel.fieldApiName);
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
        if ( RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_FIELD_TYPES.includes(fieldViewModel.fieldType) ) {
            return RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON;
        }

        return undefined;

    }

    /*
        A fixed value as the org would take it (#417): the value typed, as the kind its field writes --
        a number as a number unless a double would round it (then the digits, as the recipe writes
        them), true or false as a boolean, anything else as the text typed.
    */
    static toUpdaterFixedValue(value: string, kind: RecipeFixedValueKind): unknown {
        if ( kind === 'boolean' ) {
            return value === 'true';
        }
        if ( kind === 'number' && value.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15 ) {
            return Number(value);
        }
        return value;
    }

}
