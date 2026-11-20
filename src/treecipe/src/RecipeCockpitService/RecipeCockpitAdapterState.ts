import type { Connection } from '@salesforce/core';
import { RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH } from './RecipeCockpitTreecipeFieldEditorConstants';
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
    IAdaptedRecipeField,
    RecipeFixedValueKind
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    IRecipeCockpitUpdaterTreeObject,
    RecipeCockpitTreeUpdaterQuery
} from './RecipeCockpitTreeUpdaterQuery';
import {
    IOrgChangeHints,
    IOrgObjectChanges,
    RecipeCockpitOrgChangeDetection
} from './RecipeCockpitOrgChangeDetection';
import type {
    IRecipeCockpitAdapterOrgOnlyField,
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterFieldValueRequest,
    IRecipeCockpitUpdaterLoadStateMessage,
    IRecipeCockpitUpdaterRecordValues,
    IRecipeCockpitUpdaterValuesMessage
} from './RecipeCockpitAdapterHost';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type {
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitService';

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
    } | undefined;

    /*
        The last generation's new values (#417), per object and in the loaded records' order, for the
        slice that writes them (#418). They belong to the records they were generated for, so they
        go whenever those records go.
    */
    static heldUpdaterValues: {
        // THE HELD RECORDS' resultKey THEY WERE GENERATED FOR
        resultKey: string;
        valuesByObjectApiName: Map<string, IRecipeCockpitUpdaterRecordValues[]>;
        // THE FIELDS ONLY THE ORG HOLDS (#446) AMONG THEM, BY OBJECT, WHICH THE SNAPSHOT AND THE RESULTS RECORD
        orgOnlyFieldApiNamesByObjectApiName: Map<string, string[]>;
        // EACH FIELD AS THE ADAPTED RECIPE WRITES IT (#448): THE SCALAR ITS VALUES CAME FROM, AND WHETHER THE RECIPE ALREADY HOLDS IT
        adaptedRecipeFields: IAdaptedRecipeField[];
    } | undefined;

    /*
        The new child object being added under the held records (#447): its staged fields as offered,
        the parent Ids it is added under in the order they were read, and the recipe's backend. Its
        generated records, once a preview was made. Both belong to the records they were made for.
    */
    static heldAdapterChild: {
        // THE HELD RECORDS' resultKey IT WAS PREPARED FOR
        resultKey: string;
        treeKey: string;
        parentObjectApiName: string;
        childObjectApiName: string;
        lookupFieldApiName: string;
        parentRecordIds: string[];
        fakerService: 'faker-js' | 'snowfakery';
        fields: Map<string, IRecipeCockpitAdapterOrgOnlyField>;
        generatedRecords?: { countPerParent: number; records: Record<string, unknown>[] };
    } | undefined;

    static clearHeldUpdaterRecords() {
        this.heldUpdaterRecords = undefined;
        this.heldUpdaterValues = undefined;
        this.heldAdapterChild = undefined;
    }

    static readHeldAdapterChildRecords(): Record<string, unknown>[] | undefined {
        return this.heldAdapterChild?.generatedRecords?.records;
    }

    static clearHeldUpdaterValues() {
        this.heldUpdaterValues = undefined;
    }

    // THE ONE PLACE THE VALUES ON SCREEN CHANGE (#418): "Update records" IS OFFERED ONLY ON THE ONES POSTED LAST, ONCE THE PANEL SAYS IT DREW THEM
    static setUpdaterValuesMessage(panelState: IRecipeCockpitPanelState, valuesMessage: IRecipeCockpitUpdaterValuesMessage | undefined) {
        panelState.updaterValuesMessage = valuesMessage;
        panelState.pendingUpdatableTreeKeys = valuesMessage ? new Set([valuesMessage.treeKey]) : new Set();
        panelState.updatableTreeKeys = new Set();
    }

    static updaterValuesSequence = 0;

    static readHeldUpdaterValues(objectApiName: string): IRecipeCockpitUpdaterRecordValues[] | undefined {
        return this.heldUpdaterValues?.valuesByObjectApiName.get(objectApiName);
    }

    static readHeldUpdaterRecordCount(): number {
        let recordCount = 0;
        this.heldUpdaterRecords?.recordsByObjectApiName.forEach(records => { recordCount += records.length; });
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
        recipe.objects.forEach(object => {
            if ( !fieldApiNamesByObjectApiName.has(object.objectApiName) ) {
                fieldApiNamesByObjectApiName.set(object.objectApiName, [
                    ...object.fields.map(field => field.fieldApiName),
                    ...( orgOnlyFieldApiNamesByObjectApiName?.get(object.objectApiName) ?? [] )
                ]);
            }
        });

        return RecipeCockpitTreeUpdaterQuery.listTreeObjects(tree.objects, fieldApiNamesByObjectApiName);

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
        The panel's "Generate values" request (#417), untrusted: a list of the card's fields, each at
        most once, each naming an object and a field its model lists, and a value -- typed in the
        Updater's editor -- only as a string the editor could have held. Anything else refuses the
        WHOLE request.
    */
    static readUpdaterFieldValueRequests(candidateFields: unknown, treeObjects: readonly IRecipeCockpitUpdaterTreeObject[]): { requests: IRecipeCockpitUpdaterFieldValueRequest[] } | { refusal: string } {

        const treeObjectsByApiName = new Map(treeObjects.map(treeObject => [treeObject.objectApiName, treeObject] as const));
        const fieldCount = treeObjects.reduce((total, treeObject) => total + treeObject.fieldApiNames.length, 0);

        if ( !Array.isArray(candidateFields) || candidateFields.length === 0 || candidateFields.length > fieldCount ) {
            return { refusal: 'the fields chosen are not fields of this treecipe.' };
        }

        const requestedFieldKeys = new Set<string>();
        const requests: IRecipeCockpitUpdaterFieldValueRequest[] = [];

        for ( const candidateField of candidateFields ) {

            if ( !candidateField || typeof candidateField !== 'object' || Array.isArray(candidateField) ) {
                return { refusal: 'the fields chosen are not fields of this treecipe.' };
            }

            const { objectApiName, fieldApiName, value } = candidateField as Record<string, unknown>;
            const treeObject = typeof objectApiName === 'string' ? treeObjectsByApiName.get(objectApiName) : undefined;
            const fieldKey = `${String(objectApiName)}\n${String(fieldApiName)}`;

            if ( !treeObject || typeof fieldApiName !== 'string' || !treeObject.fieldApiNames.includes(fieldApiName) || requestedFieldKeys.has(fieldKey) ) {
                return { refusal: 'the fields chosen are not fields of this treecipe.' };
            }

            if ( value !== undefined && ( typeof value !== 'string' || value.length === 0 || value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH ) ) {
                return { refusal: `the value typed for ${treeObject.objectApiName}.${fieldApiName} is not one the editor holds.` };
            }

            requestedFieldKeys.add(fieldKey);
            requests.push({ objectApiName: treeObject.objectApiName, fieldApiName: fieldApiName, ...( typeof value === 'string' ? { value: value } : {} ) });

        }

        return { requests: requests };

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
