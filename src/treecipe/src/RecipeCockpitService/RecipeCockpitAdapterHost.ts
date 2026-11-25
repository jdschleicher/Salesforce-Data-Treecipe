import * as vscode from 'vscode';
import { RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH } from './RecipeCockpitTreecipeFieldEditorConstants';
import {
    RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON,
    RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX
} from './RecipeCockpitAdapterConstants';
import { RecipeCockpitRecipeWriter } from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { IRecipeCockpitPreviewRecordLinks } from './RecipeCockpitQuery';
import {
    IUpdateRecordResult,
    IUpdateRecordValues
} from './RecipeCockpitRecordUpdate';
import {
    IRecipeCockpitUpdaterObjectRequest,
    RecipeCockpitTreeUpdaterQuery
} from './RecipeCockpitTreeUpdaterQuery';
import {
    IOrgChangeHints,
    IOrgObjectChanges
} from './RecipeCockpitOrgChangeDetection';
import {
    RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL,
    RecipeCockpitAdapterMetadata
} from './RecipeCockpitAdapterMetadata';
import { RecipeCockpitAdapterRecords } from './RecipeCockpitAdapterRecords';
import {
    RECIPE_COCKPIT_UPDATER_EDIT_RULES,
    RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE,
    RecipeCockpitAdapterEdits
} from './RecipeCockpitAdapterEdits';
import type {
    IRecipeCockpitUpdaterColumnEditView,
    IRecipeCockpitUpdaterEditSummary,
    RecipeCockpitUpdaterEditKind
} from './RecipeCockpitAdapterEdits';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
import type { IRecipeCockpitHubForDatasetsTab } from './RecipeCockpitDatasetsHost';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type { IRecipeCockpitHubForTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import type { RecipeCockpitService } from './RecipeCockpitService';
import type {
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState
} from './RecipeCockpitViewModel';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';

/*
    The Treecipe Adapter tab's host half (moved out of the hub by #668, after #665's pattern): the
    messages it answers and the actions they route to. What a run does is
    RecipeCockpitAdapterMetadata (retrieve, apply, add child), RecipeCockpitAdapterRecords (load,
    update, restore) and RecipeCockpitAdapterEdits (marked rows and changed cells, #721); what they
    hold between clicks is RecipeCockpitAdapterState. They load one way: this file, then Metadata,
    then Records, then Edits, then State. The hub owns the panel, its state and
    every allow-list, and promotes the lists on the panel's acks.
*/

/*
    What the Treecipe Adapter's files read and call on the hub, and nothing else: the hub class itself,
    narrowed to these names and read-only, so a read after an await sees the panel and state open now.
    It is also the Data Sets tab's hub type, since an update that lands posts its adapted data set
    through RecipeCockpitDatasetsHost.postAddedDataset.
*/
export type IRecipeCockpitHubForAdapterTab = Readonly<Pick<typeof RecipeCockpitService,
    'buildConfirmOrg' |
    'confirmInPanel' |
    'isApplyHeldByAnotherRun' |
    'offerStagedField' |
    'postToPanel' |
    'readSourceApiVersion' |
    'readTreeFakerService' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'resolveFixedValueKind' |
    'resolveTreeRunArtifactsLocation' |
    'resolveTreeSnapshotLocations' |
    'runCancellableRetrieve' |
    'showMetadataRetrieveNotification' |
    'validateFixedValueInput'>> & IRecipeCockpitHubForDatasetsTab & IRecipeCockpitHubForTreecipeDataOrgs;

export interface IRecipeCockpitUpdaterLoadStateMessage {
    command: 'updaterLoadState';
    isRunning: boolean;
    treeKey: string;
    // A VALUE GENERATION (#417), AN UPDATE (#418), A RESTORE (#419) AND A METADATA RETRIEVE (#445) SHARE THE LOAD'S ONE RUN PER WINDOW; ABSENT IS A LOAD
    // A NEW CHILD OBJECT'S RETRIEVE AND ITS GENERATION (#447) SHARE IT TOO
    runKind?: 'generate' | 'update' | 'restore' | 'retrieve' | 'apply' | 'prepareChild' | 'generateChild';
    // AN UPDATE OR A RESTORE THAT SENT A REQUEST ENDS WITH THIS: THE LOADED RECORDS AND THEIR VALUES ARE SPENT, SO THE PANEL LETS THEM GO
    isRecordsSpent?: true;
}

/*
    "Retrieve latest metadata" (#445): per object step 2 drew, whether the org's retrieve brought it
    and its fields that are new or changed against this project. Names, types, labels and one-line
    differences only; the staged files stay on the host.
*/
export interface IRecipeCockpitAdapterMetadataChangesMessage {
    command: 'adapterMetadataChanges';
    renderSequence: number;
    treeKey: string;
    orgLabel: string;
    objects: IOrgObjectChanges[];
    // SOURCE TRACKING AND THE SETUP AUDIT TRAIL, READ BESIDE THE FILES; ABSENT ONLY WHEN THE ORG COULD NOT BE ASKED
    hints?: IOrgChangeHints;
    // WHY NEW CHILD OBJECTS ARE NOT LISTED FOR SOME OR ALL OBJECTS
    childObjectsNote?: string;
}

// ONE OBJECT'S RECORDS AS THE PANEL IS SENT THEM: COUNTS AND A PREVIEW AS TEXT, OR WHY THEY COULD NOT BE READ
export interface IRecipeCockpitUpdaterObjectRecordsViewModel {
    objectApiName: string;
    totalSize: number;
    recordCount: number;
    isTruncated: boolean;
    columns: string[];
    rows: string[][];
    hiddenColumnCount: number;
    failureMessage?: string;
    // NOT QUERIED: THE LOAD HAD SPENT ITS RECORD CAP OR VALUE BUDGET ON THE OBJECTS BEFORE IT
    skippedReason?: string;
    // THE ROWS WHOSE Id OPENS THE RECORD (#556)
    recordLinks?: IRecipeCockpitPreviewRecordLinks;
    // HOW MANY PAGES ITS TABLE HAS (#720); rows IS PAGE 0, AND THE REST ARE ASKED FOR WITH loadUpdaterRecordsPage
    pageCount: number;
    // PER LOOKUP COLUMN, THE ROWS WHOSE CELL HOLDS A WHOLE RECORD Id (#720)
    lookupLinks?: IRecipeCockpitPreviewRecordLinks[];
    // RECIPE FIELDS THE ORG DOES NOT DESCRIBE TO THIS USER, LEFT OUT OF THE QUERY (#720)
    unreadFieldApiNames?: string[];
    // "Edit existing records" (#721): PER COLUMN, WHY IT IS LOCKED OR WHETHER IT HAS A 🎲; THEN PAGE 0'S MARKED ROWS AND CHANGED CELLS, AND THE OBJECT'S TOTALS
    columnEdits?: IRecipeCockpitUpdaterColumnEditView[];
    markedRowIndexes?: number[];
    changedCells?: Array<[number, number]>;
    editSummary?: IRecipeCockpitUpdaterEditSummary;
}

// ONE MORE PAGE OF ONE OBJECT'S TABLE (#720): ITS ROWS AND LINKS ONLY, SINCE THE COLUMNS ARE THE LOAD'S
export interface IRecipeCockpitUpdaterRecordsPageMessage {
    command: 'updaterRecordsPage';
    renderSequence: number;
    treeKey: string;
    objectApiName: string;
    pageIndex: number;
    rows: string[][];
    recordLinks?: IRecipeCockpitPreviewRecordLinks;
    lookupLinks?: IRecipeCockpitPreviewRecordLinks[];
    // THE PAGE AS IT READS NOW (#721): ITS MARKED ROWS, ITS CHANGED CELLS AND THE OBJECT'S TOTALS
    markedRowIndexes: number[];
    changedCells: Array<[number, number]>;
    editSummary: IRecipeCockpitUpdaterEditSummary;
}

// THE HOST LET THE LOADED RECORDS GO, OR HELD NONE: THE PANEL GOES BACK TO STEP 1 (#720)
export interface IRecipeCockpitUpdaterParentChangeMessage {
    command: 'updaterParentChange';
    renderSequence: number;
    treeKey: string;
}

/*
    The records a load read (#416), as counts and previews only: the records themselves stay on the
    host for the slices that update them. Drawn only on the model it was loaded on.
*/
export interface IRecipeCockpitUpdaterRecordsMessage {
    command: 'updaterRecords';
    renderSequence: number;
    treeKey: string;
    orgLabel: string;
    objects: IRecipeCockpitUpdaterObjectRecordsViewModel[];
    // SET ONLY WHEN AN OBJECT'S PREVIEW LINKS A RECORD (#556)
    recordLinkSequence?: number;
}

/*
    A field only the org holds (#446), as the host holds it once a retrieve offered it: a field
    model drawn from its staged file, so the Updater's own rules (lock, fixed value kind) read it as
    they read a recipe field, its picklist values for a typed value's check, why it is locked, and
    the expression the recipe's backend writes for it. Never posted whole.
*/
export interface IRecipeCockpitAdapterOrgOnlyField {
    objectApiName: string;
    fieldViewModel: IRecipeCockpitFieldViewModel;
    picklistValues: string[];
    lockReason?: string;
    expression?: string;
}

/*
    A child object only the org holds, under the loaded parents (#447): every field its staged
    files hold, as the Treecipe Adapter offers it -- the expression the recipe's backend writes, why
    it is locked, or a fixed value only -- and whether the file says it is required. The lookup to
    the parent is locked: each record's is a loaded parent's Id. Names and one-line text only.
*/
export interface IRecipeCockpitAdapterChildFieldViewModel {
    fieldApiName: string;
    fieldLabel: string;
    fieldTypeWithSize: string;
    isRequired: boolean;
    lockReason?: string;
    expression?: string;
    note?: string;
}

export interface IRecipeCockpitAdapterChildBlockMessage {
    command: 'adapterChildBlock';
    renderSequence: number;
    treeKey: string;
    parentObjectApiName: string;
    childObjectApiName: string;
    lookupFieldApiName: string;
    parentRecordCount: number;
    orgLabel: string;
    fakerService: 'faker-js' | 'snowfakery';
    fields: IRecipeCockpitAdapterChildFieldViewModel[];
    unreadableFieldCount: number;
}

// THE NEW CHILD RECORDS GENERATED (#447), AS THE PANEL IS SENT THEM: THE COUNT AND A PREVIEW AS TEXT, THE LOOKUP TO THE PARENT FIRST
export interface IRecipeCockpitAdapterChildPreviewMessage {
    command: 'adapterChildPreview';
    renderSequence: number;
    treeKey: string;
    childObjectApiName: string;
    countPerParent: number;
    recordCount: number;
    columns: string[];
    rows: string[][];
    hiddenColumnCount: number;
}

// ONE FIELD OF A NEW CHILD'S BLOCK AS THE PANEL POSTED IT: value ABSENT IS THE EXPRESSION THE RECIPE'S BACKEND WRITES FOR ITS TYPE
export interface IRecipeCockpitAdapterChildFieldRequest {
    fieldApiName: string;
    value?: string;
}

// ONE RECORD'S NEW VALUES, BY FIELD: ONLY THE FIELDS CHANGED ON IT (#721), HELD ON THE HOST FOR THE UPDATE (#418)
export interface IRecipeCockpitUpdaterRecordValues {
    recordId: string;
    fieldValues: Record<string, unknown>;
}

// HOW AN UPDATE'S REQUESTS ENDED (#418), WRITTEN TO THE RESULTS FILE AND SAID IN THE NOTIFICATION
// ONE OBJECT OF A RESTORE (#419): THE SNAPSHOT'S VALUES FOR THE RECORDS THE ORG STILL RETURNS, AND WHAT THOSE RECORDS HOLD NOW
export interface IRecipeCockpitUpdaterRestoreTarget {
    objectApiName: string;
    fieldApiNames: string[];
    recordValues: IUpdateRecordValues[];
    currentRecords: Record<string, unknown>[];
    missingRecordCount: number;
}

export interface IRecipeCockpitUpdaterSendResult {
    outcome: 'completed' | 'stopped' | 'cancelled';
    isAnyRequestSent: boolean;
    updatedRecordCount: number;
    failedRecordCount: number;
    objectResults: Array<{ objectApiName: string; results: IUpdateRecordResult[] }>;
    /*
        An all-or-none update that stopped or was cancelled: what setting the updated records back to
        their old values did. uncertainRecordCount is how many of them the org may not have saved (a
        request that threw or answered unreadably), set back all the same; requestFailureDetail is the
        first SET-BACK request that threw.
    */
    putBack?: {
        putBackRecordCount: number;
        failedRecordCount: number;
        uncertainRecordCount: number;
        objects: Array<{ objectApiName: string; results: IUpdateRecordResult[] }>;
        requestFailureDetail?: string;
    };
    // THE FIRST REQUEST THAT THREW, NAMED WITH ITS ERROR
    requestFailureDetail?: string;
}

/*
    The tree's snapshots (#419), by FILE NAME only: the paths stay on the host. snapshotsSequence is
    echoed by the panel's "updaterSnapshotsRendered", and only that ack offers Restore on them.
*/
export interface IRecipeCockpitUpdaterSnapshotsMessage {
    command: 'updaterSnapshots';
    renderSequence: number;
    treeKey: string;
    snapshotNames: string[];
    hiddenSnapshotCount: number;
    snapshotsSequence: number;
}

// THE ADAPTER'S WORDS THE PANEL DRAWS ARE RecipeCockpitAdapterConstants.ts (#641); THESE ARE THE HOST'S
export const RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL = 'Nothing was retrieved: another run is using the org selection. Try again when it ends.';
// HOW MANY NEW CHILD RECORDS ONE BLOCK GENERATES AT MOST: AS MANY AS A LOAD READS
export const RECIPE_COCKPIT_ADAPTER_CHILD_RECORD_LIMIT = 50000;
export const RECIPE_COCKPIT_UPDATER_BUSY_REFUSAL = 'Records were not loaded: another run is changing the org selection. Try again when it ends.';
export const RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL = 'Nothing was updated: another run is using the org selection. Try again when it ends.';
export const RECIPE_COCKPIT_UPDATER_RESTORE_BUSY_REFUSAL = 'Nothing was restored: another run is using the org selection. Try again when it ends.';

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_ADAPTER_COMMANDS = [
    'loadUpdaterRecords',
    'loadUpdaterRecordsPage',
    'changeUpdaterParent',
    'retrieveAdapterMetadata',
    'applyAdapterRetrievedFiles',
    'prepareAdapterChild',
    'generateAdapterChild',
    'editUpdaterRecords',
    'updateUpdaterRecords',
    'loadUpdaterSnapshots',
    'restoreUpdaterSnapshot'
] as const;

export const RECIPE_COCKPIT_ADAPTER_ACTION_KINDS = [
    'loadUpdaterRecords',
    'postUpdaterRecordsPage',
    'changeUpdaterParent',
    'retrieveAdapterMetadata',
    'applyAdapterRetrievedFiles',
    'prepareAdapterChild',
    'generateAdapterChild',
    'editUpdaterRecords',
    'updateUpdaterRecords',
    'loadUpdaterSnapshots',
    'restoreUpdaterSnapshot',
    'refuseUpdaterLoad'
] as const;

export type RecipeCockpitAdapterPanelAction =
    | { kind: 'loadUpdaterRecords'; treeKey: string; renderSequence: number; requests: IRecipeCockpitUpdaterObjectRequest[]; isOrgPrompted: boolean }
    | { kind: 'postUpdaterRecordsPage'; treeKey: string; renderSequence: number; objectApiName: string; pageIndex: number }
    | { kind: 'changeUpdaterParent'; treeKey: string; renderSequence: number }
    | { kind: 'refuseUpdaterLoad'; refusalText?: string; hostMessage: IRecipeCockpitUpdaterLoadStateMessage }
    | { kind: 'retrieveAdapterMetadata'; treeKey: string; renderSequence: number; objectApiNames: string[]; isOrgPrompted: boolean }
    | { kind: 'applyAdapterRetrievedFiles'; treeKey: string; renderSequence: number }
    | { kind: 'prepareAdapterChild'; treeKey: string; renderSequence: number; parentObjectApiName: string; childObjectApiName: string; lookupFieldApiName: string }
    | { kind: 'generateAdapterChild'; treeKey: string; renderSequence: number; childObjectApiName: string; countPerParent: number; fieldRequests: IRecipeCockpitAdapterChildFieldRequest[] }
    | { kind: 'updateUpdaterRecords'; treeKey: string }
    | { kind: 'loadUpdaterSnapshots'; treeKey: string }
    | { kind: 'restoreUpdaterSnapshot'; treeKey: string; snapshotName: string }
    | { kind: 'editUpdaterRecords'; treeKey: string; renderSequence: number; objectApiName: string; pageIndex: number; editKind: RecipeCockpitUpdaterEditKind; rowIndex?: number; columnIndex?: number; value?: string };

export class RecipeCockpitAdapterHost {

    static isAdapterCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_ADAPTER_COMMANDS.some(ownedCommand => ownedCommand === command);
    }

    static isAdapterPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitAdapterPanelAction {
        return RECIPE_COCKPIT_ADAPTER_ACTION_KINDS.some(ownedActionKind => ownedActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: THE HUB'S CHECKS IT READS ARE FUNCTIONS OF THE STATE PASSED
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForAdapterTab): RecipeCockpitAdapterPanelAction | undefined {

        switch ( panelMessage.command ) {

            case 'loadUpdaterRecords': {

                const { treeKey, renderSequence, objects, parentObjectApiName } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' };

                // A RELOADED DOCUMENT MAY NOT KNOW A LOAD IS RUNNING: IT IS TOLD, AND THE LOAD'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                const recipeDataMessage = panelState.recipeDataMessage;
                const tree = typeof treeKey === 'string' ? recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey) : undefined;

                if ( typeof treeKey !== 'string'
                        || !recipeDataMessage
                        || !tree
                        || renderSequence !== recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                // AN INSERT OR A RUN THAT IS ABOUT TO CHANGE THE SELECTION HOLDS THE ORG THE LOAD WOULD READ FROM, AS A QUERY'S OPEN PROMPT DOES (#439)
                if ( panelState.insertStateMessage
                        || panelState.isQueryOrgPromptOpen
                        || panelState.isOrgPromptOpen
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_UPDATER_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const requestRead = RecipeCockpitTreeUpdaterQuery.readRequest(objects, RecipeCockpitAdapterState.listUpdaterTreeObjects(recipeDataMessage.recipe, tree, RecipeCockpitAdapterState.readAdapterOrgOnlyFieldApiNames(panelState, treeKey)), parentObjectApiName);

                if ( 'refusal' in requestRead ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: `Records were not loaded: ${requestRead.refusal}`, hostMessage: notRunning };
                }

                const dataOrgSelection = panelState.dataOrgSelection;

                if ( dataOrgSelection?.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'loadUpdaterRecords', treeKey: treeKey, renderSequence: renderSequence, requests: requestRead.requests, isOrgPrompted: false };
                }

                if ( dataOrgSelection ) {
                    return {
                        kind: 'refuseUpdaterLoad',
                        refusalText: `Records were not loaded: ${RecipeCockpitTreecipeDataOrgs.buildDataOrgLabel(dataOrgSelection.orgDetail)} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'has not been checked yet'}, and the Treecipe Adapter reads only from a sandbox or scratch org.`,
                        hostMessage: notRunning
                    };
                }

                // NO ORG CHOSEN YET: ASKED FOR AS THE INSERT ASKS (#375), OVER THE OBJECTS THE CONFIRMED-DRAWN MODEL CHECKS
                if ( panelState.dataOrgObjectApiNames.size > 0 ) {
                    return { kind: 'loadUpdaterRecords', treeKey: treeKey, renderSequence: renderSequence, requests: requestRead.requests, isOrgPrompted: true };
                }

                return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };

            }

            /*
                "Retrieve latest metadata" (#445): the card on screen and the parent step 1 chose,
                nothing else. What is retrieved is the host's -- the parent and the objects under it,
                planned as the load plans them -- and so is the org: the Target Org Manager
                selection once it answered it is a sandbox, or, with none, the load's own prompt.
            */
            /*
                Another page of an object's table (#720): only an object and a page of the records
                on screen, which the host still holds for this card and model. The panel names the
                object and the page, never a record.
            */
            case 'loadUpdaterRecordsPage': {

                const { treeKey, renderSequence, objectApiName, pageIndex } = panelMessage;
                const recordsMessage = panelState.updaterRecordsMessage;
                const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
                const loadedObject = recordsMessage?.objects.find(objectRecords => objectRecords.objectApiName === objectApiName);

                if ( typeof treeKey !== 'string'
                        || !recordsMessage
                        || !loadedObject
                        || !heldRecords
                        || recordsMessage.treeKey !== treeKey
                        || recordsMessage.renderSequence !== renderSequence
                        || renderSequence !== panelState.recipeDataMessage?.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || heldRecords.workspaceRoot !== panelState.workspaceRoot
                        || heldRecords.renderSequence !== renderSequence
                        || typeof pageIndex !== 'number'
                        || !Number.isInteger(pageIndex)
                        || pageIndex < 0
                        || pageIndex >= loadedObject.pageCount ) {
                    return undefined;
                }

                return { kind: 'postUpdaterRecordsPage', treeKey: treeKey, renderSequence: renderSequence, objectApiName: loadedObject.objectApiName, pageIndex: pageIndex };

            }

            // "Change parent object" WITH RECORDS ON SCREEN (#720): THE CARD'S KEY ONLY, AND NEVER WHILE A RUN HOLDS THOSE RECORDS
            case 'changeUpdaterParent': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || typeof renderSequence !== 'number'
                        || renderSequence !== panelState.recipeDataMessage?.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || panelState.updaterLoadStateMessage?.isRunning ) {
                    return undefined;
                }

                return { kind: 'changeUpdaterParent', treeKey: treeKey, renderSequence: renderSequence };

            }

            case 'retrieveAdapterMetadata': {

                const { treeKey, renderSequence, parentObjectApiName } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                const recipeDataMessage = panelState.recipeDataMessage;
                const tree = typeof treeKey === 'string' ? recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey) : undefined;

                if ( typeof treeKey !== 'string'
                        || !recipeDataMessage
                        || !tree
                        || renderSequence !== recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                if ( panelState.insertStateMessage
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const loadPlan = typeof parentObjectApiName === 'string'
                    ? RecipeCockpitTreeUpdaterQuery.planLoad(RecipeCockpitAdapterState.listUpdaterTreeObjects(recipeDataMessage.recipe, tree), parentObjectApiName)
                    : undefined;

                if ( !loadPlan ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: 'Nothing was retrieved: the parent object is not an object of this treecipe.', hostMessage: notRunning };
                }

                const objectApiNames = loadPlan.map(loadStep => loadStep.objectApiName);
                const dataOrgSelection = panelState.dataOrgSelection;

                if ( dataOrgSelection?.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'retrieveAdapterMetadata', treeKey: treeKey, renderSequence: renderSequence, objectApiNames: objectApiNames, isOrgPrompted: false };
                }

                if ( dataOrgSelection ) {
                    return {
                        kind: 'refuseUpdaterLoad',
                        refusalText: `Nothing was retrieved: ${RecipeCockpitTreecipeDataOrgs.buildDataOrgLabel(dataOrgSelection.orgDetail)} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'has not been checked yet'}, and the Treecipe Adapter reads only from a sandbox or scratch org.`,
                        hostMessage: notRunning
                    };
                }

                if ( panelState.dataOrgObjectApiNames.size > 0 ) {
                    return { kind: 'retrieveAdapterMetadata', treeKey: treeKey, renderSequence: renderSequence, objectApiNames: objectApiNames, isOrgPrompted: true };
                }

                return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };

            }

            /*
                "Apply retrieved files to project" (#445): only for the changes on screen, from the
                retrieve whose staged files the host still holds, and never while another run could
                read or write the project's metadata. The executor plans the copies again.
            */
            case 'applyAdapterRetrievedFiles': {

                const { treeKey, renderSequence } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                const changesMessage = panelState.adapterMetadataChangesMessage;

                if ( typeof treeKey !== 'string'
                        || !changesMessage
                        || changesMessage.treeKey !== treeKey
                        || renderSequence !== changesMessage.renderSequence
                        || renderSequence !== panelState.recipeDataMessage?.renderSequence
                        || !panelState.adapterRetrieveStagingFolderPath
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                if ( hub.isApplyHeldByAnotherRun(panelState) ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_ADAPTER_APPLY_BUSY_REFUSAL, hostMessage: notRunning };
                }

                return { kind: 'applyAdapterRetrievedFiles', treeKey: treeKey, renderSequence: renderSequence };

            }

            /*
                "Add to data set" (#447): a child object only the org holds that the last retrieve
                listed under this parent, on the card and model on screen, under records the last
                load read from the sandbox still selected, and a parent the Treecipe tab does not
                exclude. The executor retrieves the child's metadata from that org.
            */
            case 'prepareAdapterChild': {

                const { treeKey, renderSequence, parentObjectApiName, childObjectApiName, lookupFieldApiName } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', runKind: 'prepareChild' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                const recipeDataMessage = panelState.recipeDataMessage;
                const tree = typeof treeKey === 'string' ? recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey) : undefined;
                const changesMessage = panelState.adapterMetadataChangesMessage;
                const isListedChild = changesMessage?.treeKey === treeKey
                                        && changesMessage.renderSequence === renderSequence
                                        && changesMessage.objects.some(objectChanges => objectChanges.objectApiName === parentObjectApiName
                                            && ( objectChanges.newChildObjects ?? [] ).some(childObject => childObject.childObjectApiName === childObjectApiName && childObject.fieldApiName === lookupFieldApiName));

                if ( typeof treeKey !== 'string'
                        || !recipeDataMessage
                        || !tree?.folderName
                        || renderSequence !== recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || typeof parentObjectApiName !== 'string'
                        || typeof childObjectApiName !== 'string'
                        || typeof lookupFieldApiName !== 'string'
                        || !isListedChild ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                if ( RecipeCockpitAdapterState.isUpdaterSelectionBusy(panelState) ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_ADAPTER_RETRIEVE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const refuse = (reason: string) => ({ kind: 'refuseUpdaterLoad' as const, refusalText: `${childObjectApiName} was not added: ${reason}`, hostMessage: notRunning });
                const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
                const exclusion = tree.objectSelection?.exclusions.find(objectExclusion => objectExclusion.objectApiName === parentObjectApiName);

                if ( exclusion ) {
                    return refuse(`${RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX}${parentObjectApiName}.`);
                }
                if ( !heldRecords || heldRecords.workspaceRoot !== panelState.workspaceRoot || heldRecords.renderSequence !== renderSequence || heldRecords.folderName !== tree.folderName ) {
                    return refuse(RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON);
                }
                if ( ( heldRecords.recordsByObjectApiName.get(parentObjectApiName) ?? [] ).length === 0 ) {
                    return refuse(RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON);
                }

                // THE CHILD IS READ FROM THE SANDBOX ITS PARENTS CAME FROM, AND NO OTHER
                const dataOrgSelection = panelState.dataOrgSelection;
                if ( dataOrgSelection?.orgTypeDetail?.isSandbox !== true || dataOrgSelection.orgDetail.username !== heldRecords.orgUsername ) {
                    return refuse('the org selected is not the sandbox or scratch org the parent records were loaded from. Load records again.');
                }

                return { kind: 'prepareAdapterChild', treeKey: treeKey, renderSequence: renderSequence, parentObjectApiName: parentObjectApiName, childObjectApiName: childObjectApiName, lookupFieldApiName: lookupFieldApiName };

            }

            /*
                "Generate preview" (#447): only for the child prepared on the model and records on
                screen, a count per parent the Treecipe tab would take, and fields it offered and
                did not lock, each once, a value only as a string its editor holds. The executor
                checks every value again.
            */
            case 'generateAdapterChild': {

                const { treeKey, renderSequence, childObjectApiName, countPerParent, fields } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', runKind: 'generateChild' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                const heldChild = RecipeCockpitAdapterState.heldAdapterChild;
                const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;

                if ( typeof treeKey !== 'string'
                        || !heldChild
                        || !heldRecords
                        || heldChild.treeKey !== treeKey
                        || heldChild.childObjectApiName !== childObjectApiName
                        || heldChild.resultKey !== heldRecords.resultKey
                        || renderSequence !== panelState.recipeDataMessage?.renderSequence
                        || heldRecords.renderSequence !== renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                const refuse = (reason: string) => ({ kind: 'refuseUpdaterLoad' as const, refusalText: `No ${heldChild.childObjectApiName} records were generated: ${reason}`, hostMessage: notRunning });

                if ( !RecipeCockpitRecipeWriter.isRecordCount(countPerParent) ) {
                    return refuse('the count per parent record must be a whole number of one or more.');
                }
                if ( countPerParent * heldChild.parentRecordIds.length > RECIPE_COCKPIT_ADAPTER_CHILD_RECORD_LIMIT ) {
                    return refuse(`${countPerParent} per record under ${heldChild.parentRecordIds.length} ${heldChild.parentObjectApiName} records is more than the ${RECIPE_COCKPIT_ADAPTER_CHILD_RECORD_LIMIT} one block generates.`);
                }
                if ( !Array.isArray(fields) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                const fieldRequests: IRecipeCockpitAdapterChildFieldRequest[] = [];
                for ( const candidateField of fields as unknown[] ) {
                    const fieldRecord = candidateField && typeof candidateField === 'object' ? candidateField as Record<string, unknown> : undefined;
                    const fieldApiName = fieldRecord?.fieldApiName;
                    const value = fieldRecord?.value;
                    const offeredField = typeof fieldApiName === 'string' ? heldChild.fields.get(fieldApiName) : undefined;
                    if ( typeof fieldApiName !== 'string'
                            || !offeredField
                            || offeredField.lockReason !== undefined
                            || fieldRequests.some(fieldRequest => fieldRequest.fieldApiName === fieldApiName)
                            || ( value !== undefined && ( typeof value !== 'string' || value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH ) ) ) {
                        return refuse(`${typeof fieldApiName === 'string' ? `${heldChild.childObjectApiName}.${fieldApiName}` : 'a field'} is not one this block offers to fill.`);
                    }
                    fieldRequests.push(value === undefined ? { fieldApiName: fieldApiName } : { fieldApiName: fieldApiName, value: value as string });
                }

                return { kind: 'generateAdapterChild', treeKey: treeKey, renderSequence: renderSequence, childObjectApiName: heldChild.childObjectApiName, countPerParent: countPerParent, fieldRequests: fieldRequests };

            }

            /*
                One edit of the records on screen (#721): a row marked or unmarked, a value made for a
                cell or a column, or a reset. The panel names a position -- object, page, row, column --
                and never a value. The edit must be one of RECIPE_COCKPIT_UPDATER_EDIT_RULES and carry
                what its rule needs, the page must be one the host posted, the row a row of it, and the
                column one that can be changed (and, for a 🎲, one with a value to make). Anything else is
                dropped without a word, as is every edit while a run holds the records.
            */
            case 'editUpdaterRecords': {

                const { treeKey, renderSequence, objectApiName, pageIndex, editKind, rowIndex, columnIndex, value } = panelMessage;
                const recordsMessage = panelState.updaterRecordsMessage;
                const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
                const loadedObject = recordsMessage?.objects.find(objectRecords => objectRecords.objectApiName === objectApiName);
                const editRule = typeof editKind === 'string' && Object.prototype.hasOwnProperty.call(RECIPE_COCKPIT_UPDATER_EDIT_RULES, editKind)
                    ? RECIPE_COCKPIT_UPDATER_EDIT_RULES[editKind as RecipeCockpitUpdaterEditKind]
                    : undefined;
                const isIndex = (candidateIndex: unknown): candidateIndex is number => typeof candidateIndex === 'number' && Number.isInteger(candidateIndex) && candidateIndex >= 0;

                if ( typeof treeKey !== 'string'
                        || !editRule
                        || !recordsMessage
                        || !loadedObject
                        || !heldRecords
                        || recordsMessage.treeKey !== treeKey
                        || recordsMessage.renderSequence !== renderSequence
                        || renderSequence !== panelState.recipeDataMessage?.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || heldRecords.workspaceRoot !== panelState.workspaceRoot
                        || heldRecords.renderSequence !== renderSequence
                        || panelState.updaterLoadStateMessage?.isRunning
                        || !isIndex(pageIndex)
                        || !heldRecords.postedPageIndexesByObjectApiName.get(loadedObject.objectApiName)?.has(pageIndex) ) {
                    return undefined;
                }

                const columnEdit = isIndex(columnIndex) ? loadedObject.columnEdits?.[columnIndex] : undefined;
                const isRowOfPage = isIndex(rowIndex)
                    && rowIndex < RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE
                    && pageIndex * RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE + rowIndex < loadedObject.recordCount;

                if ( ( editRule.needsRow ? !isRowOfPage : rowIndex !== undefined )
                        || ( editRule.needsColumn ? ( !columnEdit || columnEdit.lockReason !== undefined ) : columnIndex !== undefined )
                        || ( editRule.needsGeneration && !columnEdit?.canGenerate )
                        // THE ONE VALUE THE PANEL POSTS: TEXT THE EDITOR CAN HOLD, AND ONLY WITH THE EDIT THAT TAKES ONE
                        || ( editRule.needsValue ? ( typeof value !== 'string' || value.length === 0 || value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH ) : value !== undefined ) ) {
                    return undefined;
                }

                return {
                    kind: 'editUpdaterRecords',
                    treeKey: treeKey,
                    renderSequence: renderSequence,
                    objectApiName: loadedObject.objectApiName,
                    pageIndex: pageIndex,
                    editKind: editKind as RecipeCockpitUpdaterEditKind,
                    ...( editRule.needsRow ? { rowIndex: rowIndex as number } : {} ),
                    ...( editRule.needsColumn ? { columnIndex: columnIndex as number } : {} ),
                    ...( editRule.needsValue ? { value: value as string } : {} )
                };

            }

            /*
                "Update records" (#418) posts the card's KEY and nothing else: what is written, to which
                records and in which org are the host's -- the values it holds for the records it
                loaded. The key must be the card whose values the panel confirmed drawing, the org
                selected now must have answered that it is a sandbox, and no run that holds the
                selection may be in flight. The panel disabled the button on the click, so every
                refusal gives it back.
            */
            case 'updateUpdaterRecords': {

                const { treeKey } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', runKind: 'update' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                // ONLY THE CARD WHOSE RECORDS ARE ON SCREEN, AND ONLY ONCE A MARKED ROW HOLDS A CHANGE (#721)
                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || panelState.updaterRecordsMessage?.treeKey !== treeKey
                        || panelState.updaterRecordsMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || RecipeCockpitAdapterEdits.countUpdatableRecords() === 0 ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                if ( panelState.insertStateMessage
                        || panelState.isUpdaterOrgPromptOpen
                        || panelState.isQueryOrgPromptOpen
                        || panelState.isOrgPromptOpen
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_UPDATER_UPDATE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const dataOrgSelection = panelState.dataOrgSelection;

                if ( dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
                    return {
                        kind: 'refuseUpdaterLoad',
                        refusalText: dataOrgSelection
                            ? `Nothing was updated: ${RecipeCockpitTreecipeDataOrgs.buildDataOrgLabel(dataOrgSelection.orgDetail)} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'has not been checked yet'}, and the Treecipe Adapter updates only a sandbox or scratch org.`
                            : 'Nothing was updated: choose the sandbox or scratch org the records were loaded from in Target Org Manager.',
                        hostMessage: notRunning
                    };
                }

                return { kind: 'updateUpdaterRecords', treeKey: treeKey };

            }

            // THE UPDATER TAB ASKS FOR ITS CARD'S SNAPSHOTS (#419) EACH TIME IT IS SELECTED: A CARD WITH A FOLDER, ON THE MODEL ON SCREEN
            case 'loadUpdaterSnapshots': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadUpdaterSnapshots', treeKey: treeKey };

            }

            /*
                "Restore previous values…" (#419) posts the card's key and a snapshot's FILE NAME, and
                nothing else: the name must be one the host listed for that card and the panel
                confirmed drawing, and it resolves through a host-only map, so no path is ever
                posted. The rest is the update's own routing: one run per window, no run that holds
                the selection, and a selection that answered it is a sandbox.
            */
            case 'restoreUpdaterSnapshot': {

                const { treeKey, snapshotName } = panelMessage;
                const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', runKind: 'restore' };

                if ( panelState.updaterLoadStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage };
                }

                if ( typeof treeKey !== 'string'
                        || typeof snapshotName !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.restorableSnapshots.get(treeKey)?.has(snapshotName) ) {
                    return { kind: 'refuseUpdaterLoad', hostMessage: notRunning };
                }

                if ( panelState.insertStateMessage
                        || panelState.isUpdaterOrgPromptOpen
                        || panelState.isQueryOrgPromptOpen
                        || panelState.isOrgPromptOpen
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseUpdaterLoad', refusalText: RECIPE_COCKPIT_UPDATER_RESTORE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const dataOrgSelection = panelState.dataOrgSelection;

                if ( dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
                    return {
                        kind: 'refuseUpdaterLoad',
                        refusalText: dataOrgSelection
                            ? `Nothing was restored: ${RecipeCockpitTreecipeDataOrgs.buildDataOrgLabel(dataOrgSelection.orgDetail)} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'has not been checked yet'}, and the Treecipe Adapter restores only a sandbox or scratch org.`
                            : 'Nothing was restored: choose the sandbox or scratch org the update was made in, in Target Org Manager.',
                        hostMessage: notRunning
                    };
                }

                return { kind: 'restoreUpdaterSnapshot', treeKey: treeKey, snapshotName: snapshotName };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitAdapterPanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'loadUpdaterRecords':

                await RecipeCockpitAdapterRecords.loadUpdaterRecordsFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'postUpdaterRecordsPage':

                RecipeCockpitAdapterRecords.postUpdaterRecordsPage(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'changeUpdaterParent':

                await RecipeCockpitAdapterRecords.changeUpdaterParentFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'retrieveAdapterMetadata':

                await RecipeCockpitAdapterMetadata.retrieveAdapterMetadataFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'applyAdapterRetrievedFiles':

                await RecipeCockpitAdapterMetadata.applyAdapterRetrievedFilesFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'prepareAdapterChild':

                await RecipeCockpitAdapterMetadata.prepareAdapterChildFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'generateAdapterChild':

                await RecipeCockpitAdapterMetadata.generateAdapterChildFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'editUpdaterRecords':

                // THE BACKEND RUN IS THE RECORDS FILE'S, HANDED IN: THE EDITS FILE LOADS BELOW IT
                await RecipeCockpitAdapterEdits.applyEditFromPanel(hub, cockpitPanel, panelState, panelAction,
                    (fakerService, objectApiName, valueCount, fields, isCancelled) => RecipeCockpitAdapterRecords.generateUpdaterObjectValues(hub, fakerService, objectApiName, valueCount, fields, isCancelled));
                return;

            case 'updateUpdaterRecords':

                await RecipeCockpitAdapterRecords.updateUpdaterRecordsFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'loadUpdaterSnapshots':

                RecipeCockpitAdapterRecords.postUpdaterSnapshots(hub, cockpitPanel, panelState, panelAction.treeKey);
                return;

            case 'restoreUpdaterSnapshot':

                await RecipeCockpitAdapterRecords.restoreUpdaterSnapshotFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'refuseUpdaterLoad':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

        }

    }

}
