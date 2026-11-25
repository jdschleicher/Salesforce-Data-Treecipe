import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import { SalesforceOrgService } from '../SalesforceOrgService/SalesforceOrgService';
import {
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { CollectionsApiService } from '../CollectionsApiService/CollectionsApiService';
import { IFakerRecipeProcessor } from '../FakerRecipeProcessor/IFakerRecipeProcessor';
import { RecipeCockpitFakerValueGeneration } from './RecipeCockpitFakerValueGeneration';
import {
    IAdaptedObjectRecords,
    RecipeCockpitAdaptedDataset,
    RecipeCockpitAdaptedRunWrite
} from './RecipeCockpitAdaptedDataset';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import {
    INotificationCommandAction,
    VSCodeWorkspaceService
} from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    RECIPE_COCKPIT_PREVIEW_RECORD_ID_COLUMN,
    RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE,
    RECIPE_COCKPIT_QUERY_RECORD_CAP,
    RECIPE_COCKPIT_QUERY_VALUE_BUDGET,
    RecipeCockpitQuery
} from './RecipeCockpitQuery';
import { RecipeCockpitDatasetsHost } from './RecipeCockpitDatasetsHost';
import {
    IRecipeCockpitRunArtifactsLocation,
    RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE,
    RecipeCockpitRunArtifacts
} from '../RunArtifacts/RecipeCockpitRunArtifacts';
import {
    IUpdateRecordResult,
    IUpdateRequestRecord,
    IUpdateSnapshotObject,
    RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME,
    RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT,
    RecipeCockpitRecordUpdate
} from './RecipeCockpitRecordUpdate';
import {
    IRecipeCockpitUpdaterObjectRequest,
    IRecipeCockpitUpdaterTreeObject,
    RecipeCockpitTreeUpdaterQuery
} from './RecipeCockpitTreeUpdaterQuery';
import { RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL } from './RecipeCockpitAdapterConstants';
import type {
    IRecipeCockpitHubForAdapterTab,
    IRecipeCockpitUpdaterLoadStateMessage,
    IRecipeCockpitUpdaterObjectRecordsViewModel,
    IRecipeCockpitUpdaterRecordsMessage,
    IRecipeCockpitUpdaterRecordValues,
    IRecipeCockpitUpdaterRestoreTarget,
    IRecipeCockpitUpdaterSendResult,
    IRecipeCockpitUpdaterSnapshotsMessage
} from './RecipeCockpitAdapterHost';
import {
    RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE,
    RecipeCockpitAdapterEdits
} from './RecipeCockpitAdapterEdits';
import type {
    IRecipeCockpitUpdaterColumnPlan,
    IRecipeCockpitUpdaterUpdatePlan
} from './RecipeCockpitAdapterEdits';
import { RecipeCockpitAdapterNewRecords } from './RecipeCockpitAdapterNewRecords';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
import { RecipeCockpitRecordLinks } from './RecipeCockpitRecordLinks';
import {
    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL
} from './RecipeCockpitDataOrgConstants';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type {
    IRecipeCockpitPanelState,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';

/*
    The Treecipe Adapter's record runs (#416, #418, #419; moved out of the hub by #668): load records
    from the selected org, generate values, update the records in a sandbox, and the snapshots a
    restore writes back.
*/

// THE ADAPT RUN'S TWO BUTTONS ON THE UPDATE'S NOTIFICATION (#448)
export const RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL = 'Open data set';
export const RECIPE_COCKPIT_ADAPTER_OPEN_ADAPTED_RECIPE_LABEL = 'Open adapted recipe';
export const RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIXED_VALUE_NOTE = 'Fixed value only: this recipe\'s faker backend writes no expression for its type in the org. Type a value in its editor.';
export const RECIPE_COCKPIT_ADAPTER_ORG_ONLY_EXPRESSION_REFUSAL = 'it takes a fixed value only, since this recipe\'s faker backend writes no expression for its type in the org';
// THE UPDATER'S LOAD (#416): THE TREE'S EXISTING RECORDS, READ FROM THE SANDBOX TARGET ORG MANAGER HAS SELECTED
export const RECIPE_COCKPIT_UPDATER_ORG_PLACEHOLDER = 'Select the sandbox or scratch org to load this tree\'s records from';
export const RECIPE_COCKPIT_UPDATER_LIMIT_SKIPPED_REASON = `Not read: the load reached its limit of ${RECIPE_COCKPIT_QUERY_RECORD_CAP} records or ${RECIPE_COCKPIT_QUERY_VALUE_BUDGET} values on the objects before this one. Add a WHERE to those to read this one.`;
// AN OBJECT UNDER THE PARENT IS READ ONLY UNDER RECORDS LOADED A LEVEL ABOVE (#444); WHEN THERE ARE NONE, IT SENDS NO QUERY
export const RECIPE_COCKPIT_UPDATER_PARENT_NOT_READ_REASON_PREFIX = 'Not read: ';
export const RECIPE_COCKPIT_UPDATER_NOT_LOADED_REFUSAL = 'No values were generated: load this tree\'s records first. Values are generated for the records the last Load records read.';
// HOW MANY RECORDS ONE GENERATION RUN MAKES (#417): A LOAD CAN HOLD 50,000, AND ONE RUN OF THAT SIZE FROZE THE EXTENSION HOST FOR
// SECONDS (faker-js) OR OVERFLOWED SNOWFAKERY'S 10 MB OUTPUT BUFFER, SO VALUES ARE MADE IN RUNS OF THIS SIZE, YIELDING BETWEEN THEM
export const RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE = 2000;
// THE UPDATE (#418): THE GENERATED VALUES WRITTEN TO THE LOADED RECORDS BY Id, IN THE SANDBOX THEY WERE LOADED FROM
export const RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL = 'Update records';
export const RECIPE_COCKPIT_UPDATER_NOT_LOADED_FOR_UPDATE_REFUSAL = 'Nothing was updated: load this tree\'s records first, then mark the rows to change.';
export const RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL = 'Nothing was updated: no marked row holds a changed value. Mark a row with its pencil, then change a cell in it.';
export const RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE = 'A picklist value is the field\'s default list, not its record type\'s: a record whose record type does not allow the value is rejected by the org, and its error is in the results file.';
export const RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE = RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE;
export const RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL = 'Nothing was updated: the old values could not be saved to RunArtifacts in the tree folder, and an update never runs without them.';
// THE RESTORE (#419): A SNAPSHOT AN UPDATE SAVED, WRITTEN BACK TO ITS RECORDS BY Id, IN THE SANDBOX IT WAS TAKEN IN
export const RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL = 'Restore values';
export const RECIPE_COCKPIT_UPDATER_RESTORE_SNAPSHOT_FAILED_REFUSAL = 'Nothing was restored: the values the records hold now could not be saved to RunArtifacts in the tree folder, and a restore never runs without them.';

export class RecipeCockpitAdapterRecords {

    /*
        "Load records" (#416): one per window. The org is the Target Org Manager selection, only
        once it answered it is a sandbox; with none, it is asked for as the insert asks (#375). One
        SELECT per tree object, built from the tree, every page read up to the Query tab's record cap
        and a value budget the whole load shares, cancellable between pages and objects. The records
        stay on the host; counts and the first page of each object's table are posted (#720), and how it went is ONE notification.
    */
    static async loadUpdaterRecordsFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                     panelState: IRecipeCockpitPanelState,
                                                     loadAction: Extract<RecipeCockpitPanelAction, { kind: 'loadUpdaterRecords' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: loadAction.treeKey };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        // A LOAD REPLACES THE LAST ONE FROM ITS START, ON THE HOST AND (ON THE RUNNING STATE) IN THE PANEL, SO THE SCREEN NEVER SHOWS RECORDS THE HOST LET GO
        RecipeCockpitAdapterState.clearHeldUpdaterRecords();
        panelState.updaterRecordsMessage = undefined;
        panelState.adapterChildBlockMessage = undefined;
        panelState.updaterNewRecordsMessages = undefined;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: loadAction.treeKey });

        try {
            await this.performUpdaterLoad(hub, cockpitPanel, panelState, loadAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, notRunning);
        }

    }

    private static async performUpdaterLoad(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            loadAction: Extract<RecipeCockpitPanelAction, { kind: 'loadUpdaterRecords' }>) {

        const { treeKey, renderSequence, requests } = loadAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !clickedRecipeDataMessage || clickedRecipeDataMessage.renderSequence !== renderSequence || !tree?.folderName ) {
            return;
        }

        if ( loadAction.isOrgPrompted ) {
            let isSandboxSelected = false;
            panelState.isUpdaterOrgPromptOpen = true;
            try {
                isSandboxSelected = await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(hub, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                    RECIPE_COCKPIT_UPDATER_ORG_PLACEHOLDER, 'Records were not loaded', 'the Treecipe Adapter reads only from a sandbox or scratch org');
            } finally {
                panelState.isUpdaterOrgPromptOpen = false;
            }
            if ( !isSandboxSelected ) {
                return;
            }
        }

        const dataOrgSelection = panelState.dataOrgSelection;

        // THE ROUTER CHECKED THE SELECTION AT THE CLICK; A PROMPT OR A NEW PICK SINCE IS CHECKED AGAIN HERE
        if ( !isClickStillCurrent() || dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
            return;
        }

        const orgUsername = dataOrgSelection.orgDetail.username;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = dataOrgSelection.orgDetail.alias ? `${dataOrgSelection.orgDetail.alias} · ${orgUsername}` : orgUsername;
        const treeTitle = tree.customName ?? tree.title;
        const treeObjectsByApiName = new Map(RecipeCockpitAdapterState.listUpdaterTreeObjects(clickedRecipeDataMessage.recipe, tree, RecipeCockpitAdapterState.readAdapterOrgOnlyFieldApiNames(panelState, treeKey)).map(treeObject => [treeObject.objectApiName, treeObject] as const));

        // EACH OBJECT AND ITS WHERE ARE CHECKED BEFORE A CONNECTION IS OPENED; ITS FIELDS ONCE THE ORG'S DESCRIBES LEFT OUT THOSE IT WOULD REFUSE (#720)
        for ( const request of requests ) {
            const treeObject = treeObjectsByApiName.get(request.objectApiName);
            const queryRefusal = treeObject
                ? RecipeCockpitTreeUpdaterQuery.checkRequestQuery({ ...treeObject, lookupFieldApiNames: [] }, { ...request, fieldApiNames: [] })
                : { refusal: `${request.objectApiName} is no longer in this treecipe.` };
            if ( queryRefusal ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Records were not loaded: ${queryRefusal.refusal}`));
                return;
            }
        }

        const recordsByObjectApiName = new Map<string, Record<string, unknown>[]>();
        const objectViewModels: IRecipeCockpitUpdaterObjectRecordsViewModel[] = [];
        const recordIdsByObjectApiName = new Map<string, (string | undefined)[]>();
        const columnFieldApiNamesByObjectApiName = new Map<string, string[]>();
        const lookupFieldApiNamesByObjectApiName = new Map<string, string[]>();
        const columnPlansByObjectApiName = new Map<string, IRecipeCockpitUpdaterColumnPlan[]>();
        // WHAT IS READ ONCE THE ORG'S DESCRIBES LEFT OUT THE FIELDS IT WOULD REFUSE (#720)
        const readRequests: IRecipeCockpitUpdaterObjectRequest[] = [];
        let queryRefusal: string | undefined;
        let isConnectionFailed = false;
        let isCancelled = false;
        let isTruncated = false;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: loading the records of ${treeTitle} from ${orgLabel}`),
            cancellable: true
        }, async (progress, cancellationToken) => {

            let connection: Connection;
            try {
                connection = await SalesforceOrgService.getConnection(orgUsername);
            } catch {
                isConnectionFailed = true;
                return;
            }

            const describedFieldApiNamesByObjectApiName = await this.describeLoadedObjects(orgUsername, connection, requests.map(request => request.objectApiName), () => cancellationToken.isCancellationRequested);

            if ( cancellationToken.isCancellationRequested ) {
                isCancelled = true;
                return;
            }

            const unreadFieldApiNamesByObjectApiName = new Map<string, string[]>();

            // EVERY QUERY IS CHECKED WHOLE BEFORE ANY RECORD IS READ; A CHILD'S WITH A PLACEHOLDER Id, SINCE ITS PARENT Ids COME FROM THE LOAD
            for ( const request of requests ) {
                const treeObject = treeObjectsByApiName.get(request.objectApiName) as IRecipeCockpitUpdaterTreeObject;
                const describedFieldApiNames = describedFieldApiNamesByObjectApiName.get(request.objectApiName);
                // AN OBJECT THE ORG DID NOT DESCRIBE IS ASKED FOR WHOLE: ITS QUERY'S OWN ANSWER SAYS WHY IT COULD NOT BE READ
                const readable = describedFieldApiNames
                    ? RecipeCockpitTreeUpdaterQuery.leaveOutUnreadFields(treeObject, request, describedFieldApiNames)
                    : { treeObject: treeObject, request: request, unreadFieldApiNames: [] };
                queryRefusal = RecipeCockpitTreeUpdaterQuery.checkRequestQuery(readable.treeObject, readable.request)?.refusal;
                if ( queryRefusal !== undefined ) {
                    return;
                }
                treeObjectsByApiName.set(request.objectApiName, readable.treeObject);
                readRequests.push(readable.request);
                unreadFieldApiNamesByObjectApiName.set(request.objectApiName, readable.unreadFieldApiNames);
            }

            // ONE RECORD CAP AND ONE VALUE BUDGET FOR THE WHOLE LOAD, SO A TREE OF MANY OBJECTS IS HELD TO WHAT ONE QUERY RUN IS
            let valueBudgetLeft = RECIPE_COCKPIT_QUERY_VALUE_BUDGET;
            let recordCapLeft = RECIPE_COCKPIT_QUERY_RECORD_CAP;

            // THE Ids EACH OBJECT LOADED, WHICH THE LEVEL BELOW IS NARROWED TO; AN OBJECT NOT READ HAS NONE, AND NOTHING UNDER IT IS READ
            const loadedRecordIdsByObjectApiName = new Map<string, string[]>();

            for ( const request of readRequests ) {

                if ( cancellationToken.isCancellationRequested ) {
                    isCancelled = true;
                    return;
                }

                const treeObject = treeObjectsByApiName.get(request.objectApiName) as IRecipeCockpitUpdaterTreeObject;
                const skipped = (skippedReason: string) => objectViewModels.push({
                    objectApiName: request.objectApiName,
                    totalSize: 0,
                    recordCount: 0,
                    isTruncated: false,
                    columns: [],
                    rows: [],
                    hiddenColumnCount: 0,
                    pageCount: 0,
                    skippedReason: skippedReason
                });

                // A SPENT LIMIT SENDS NO MORE QUERIES: EACH WOULD DOWNLOAD A FIRST PAGE ONLY TO DROP IT
                if ( valueBudgetLeft <= 0 || recordCapLeft <= 0 ) {
                    isTruncated = true;
                    objectViewModels.push({
                        objectApiName: request.objectApiName,
                        totalSize: 0,
                        recordCount: 0,
                        isTruncated: true,
                        columns: [],
                        rows: [],
                        hiddenColumnCount: 0,
                        pageCount: 0,
                        skippedReason: RECIPE_COCKPIT_UPDATER_LIMIT_SKIPPED_REASON
                    });
                    continue;
                }

                let queries: string[];

                if ( request.narrowingLookup ) {
                    const parentRecordIds = loadedRecordIdsByObjectApiName.get(request.narrowingLookup.parentObjectApiName);
                    if ( !parentRecordIds ) {
                        skipped(`${RECIPE_COCKPIT_UPDATER_PARENT_NOT_READ_REASON_PREFIX}${request.narrowingLookup.parentObjectApiName} records were not read, so none under them were.`);
                        continue;
                    }
                    if ( parentRecordIds.length === 0 ) {
                        skipped(`${RECIPE_COCKPIT_UPDATER_PARENT_NOT_READ_REASON_PREFIX}no ${request.narrowingLookup.parentObjectApiName} records were loaded, so none under them were read.`);
                        continue;
                    }
                    const queriesBuild = RecipeCockpitTreeUpdaterQuery.buildNarrowedQueries(treeObject, request, parentRecordIds);
                    if ( 'refusal' in queriesBuild ) {
                        objectViewModels.push({
                            objectApiName: request.objectApiName, totalSize: 0, recordCount: 0, isTruncated: false, columns: [], rows: [], hiddenColumnCount: 0, pageCount: 0,
                            failureMessage: queriesBuild.refusal
                        });
                        continue;
                    }
                    queries = queriesBuild.queries;
                } else {
                    const queryBuild = RecipeCockpitTreeUpdaterQuery.buildObjectQuery(treeObject, request);
                    queries = 'refusal' in queryBuild ? [] : [queryBuild.objectQuery.query];
                }

                const tooLongReason = RecipeCockpitTreeUpdaterQuery.findTooLongQueryReason(treeObject, request, queries);
                if ( tooLongReason !== undefined ) {
                    objectViewModels.push({
                        objectApiName: request.objectApiName, totalSize: 0, recordCount: 0, isTruncated: false, columns: [], rows: [], hiddenColumnCount: 0, pageCount: 0,
                        failureMessage: tooLongReason
                    });
                    continue;
                }

                progress.report({ message: request.objectApiName });

                try {

                    // A RECORD IS KEPT ONCE BY Id, HOWEVER MANY OF A CHILD'S QUERIES ANSWERED WITH IT
                    const records: Record<string, unknown>[] = [];
                    const recordIds = new Set<string>();
                    let totalSize = 0;
                    let isObjectTruncated = false;

                    for ( const query of queries ) {

                        if ( valueBudgetLeft <= 0 || recordCapLeft <= 0 ) {
                            isObjectTruncated = true;
                            break;
                        }

                        const queryResult = await RecipeCockpitQuery.fetchQueryRecords({
                            query: async (soql: string) => await connection.query(soql),
                            queryMore: async (nextRecordsUrl: string) => await connection.queryMore(nextRecordsUrl)
                        }, query, recordCapLeft, () => cancellationToken.isCancellationRequested, valueBudgetLeft);

                        if ( queryResult.isCancelled ) {
                            isCancelled = true;
                            return;
                        }

                        const newRecords = queryResult.records.filter(record => {
                            const recordId = RecipeCockpitDrawnModel.readRecordFieldValue(record, 'Id');
                            if ( typeof recordId !== 'string' ) { return true; }
                            if ( recordIds.has(recordId) ) { return false; }
                            recordIds.add(recordId);
                            return true;
                        });

                        valueBudgetLeft -= RecipeCockpitQuery.countValues(newRecords);
                        recordCapLeft -= newRecords.length;
                        totalSize += queryResult.totalSize;
                        isObjectTruncated = isObjectTruncated || queryResult.isTruncated;
                        newRecords.forEach(record => records.push(record));

                        if ( queryResult.isTruncated ) {
                            break;
                        }

                    }

                    isTruncated = isTruncated || isObjectTruncated;
                    recordsByObjectApiName.set(request.objectApiName, records);
                    loadedRecordIdsByObjectApiName.set(request.objectApiName, [...recordIds]);

                    const columnFieldApiNames = RecipeCockpitTreeUpdaterQuery.listSelectedFieldApiNames(treeObject, request.fieldApiNames);
                    const unreadFieldApiNames = unreadFieldApiNamesByObjectApiName.get(request.objectApiName) ?? [];
                    const firstPage = RecipeCockpitQuery.buildTablePage(records, columnFieldApiNames, treeObject.lookupFieldApiNames, 0, RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE);
                    const columnPlans = RecipeCockpitAdapterEdits.planColumns(panelState, clickedRecipeDataMessage.recipe, tree, request.objectApiName, columnFieldApiNames);
                    columnPlansByObjectApiName.set(request.objectApiName, columnPlans);
                    columnFieldApiNamesByObjectApiName.set(request.objectApiName, columnFieldApiNames);
                    lookupFieldApiNamesByObjectApiName.set(request.objectApiName, [...treeObject.lookupFieldApiNames]);
                    // PAGE 0'S OWN Ids ONLY SAY WHETHER ANY ROW LINKS A RECORD: A CLICK'S Id IS READ FROM THE HELD RECORD (tablePages BELOW)
                    recordIdsByObjectApiName.set(request.objectApiName, records.slice(0, RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE).map(record => RecipeCockpitQuery.readLinkedRecordId(record, RECIPE_COCKPIT_PREVIEW_RECORD_ID_COLUMN)));
                    objectViewModels.push({
                        objectApiName: request.objectApiName,
                        totalSize: totalSize,
                        recordCount: records.length,
                        isTruncated: isObjectTruncated,
                        columns: firstPage.columns,
                        rows: firstPage.rows,
                        hiddenColumnCount: 0,
                        pageCount: Math.ceil(records.length / RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE),
                        ...( firstPage.recordLinks ? { recordLinks: firstPage.recordLinks } : {} ),
                        ...( firstPage.lookupLinks ? { lookupLinks: firstPage.lookupLinks } : {} ),
                        ...( unreadFieldApiNames.length > 0 ? { unreadFieldApiNames: unreadFieldApiNames } : {} ),
                        // A NEW LOAD STARTS WITH NO ROW MARKED AND NO CELL CHANGED (#721)
                        columnEdits: RecipeCockpitAdapterEdits.toColumnEditViews(columnPlans),
                        markedRowIndexes: [],
                        changedCells: [],
                        cutCells: RecipeCockpitAdapterEdits.listCutCells(records.slice(0, RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE), columnFieldApiNames, firstPage.rows),
                        editSummary: { markedRecordCount: 0, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false }
                    });
                } catch (queryError) {
                    // ONE OBJECT THE ORG REFUSES (A FIELD IT LACKS, A WHERE IT CANNOT READ) IS THAT OBJECT'S, NOT THE LOAD'S
                    objectViewModels.push({
                        objectApiName: request.objectApiName,
                        totalSize: 0,
                        recordCount: 0,
                        isTruncated: false,
                        columns: [],
                        rows: [],
                        hiddenColumnCount: 0,
                        pageCount: 0,
                        failureMessage: RecipeCockpitUntrustedValue.describeThrown(queryError)
                    });
                }

            }

        });

        // A CONNECTION THAT COULD NOT BE OPENED IS ONE FIXED WARNING: ITS ERROR CAN CARRY AN AUTH URL OR TOKEN TEXT
        if ( isConnectionFailed ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Records were not loaded: ${orgLabel} could not be connected to. ${RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE}`));
            return;
        }

        if ( queryRefusal !== undefined ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Records were not loaded: ${queryRefusal}`));
            return;
        }

        if ( isCancelled ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Loading the records of ${treeTitle} from ${orgLabel} was cancelled, so none were kept.`));
            return;
        }

        // A MODEL OR A SELECTION CHANGED MEANWHILE: THE RECORDS ARE OF ANOTHER CARD OR ANOTHER ORG, SO NONE ARE KEPT OR DRAWN
        if ( !isClickStillCurrent() || panelState.dataOrgSelection?.orgDetail.username !== orgUsername ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The records of ${treeTitle} were not kept: the run or the org on screen changed while they were read. Load them again.`));
            return;
        }

        const heldUpdaterRecords: NonNullable<typeof RecipeCockpitAdapterState.heldUpdaterRecords> = {
            resultKey: JSON.stringify([panelState.workspaceRoot, renderSequence, tree.folderName, orgUsername]),
            workspaceRoot: panelState.workspaceRoot,
            renderSequence: renderSequence,
            folderName: tree.folderName,
            orgUsername: orgUsername,
            recordsByObjectApiName: recordsByObjectApiName,
            loadedFieldApiNamesByObjectApiName: new Map(readRequests.map(request => [request.objectApiName, [...request.fieldApiNames]] as const)),
            // THE LOAD'S PLAN STARTS AT THE PARENT (#444), AND THE ROUTER HOLDS EVERY LOAD TO ITS PLAN
            parentObjectApiName: requests[0].objectApiName,
            whereClausesByObjectApiName: new Map(requests.map(request => [request.objectApiName, request.whereClause] as const)),
            columnFieldApiNamesByObjectApiName: columnFieldApiNamesByObjectApiName,
            lookupFieldApiNamesByObjectApiName: lookupFieldApiNamesByObjectApiName,
            // PAGE 0 OF EVERY OBJECT READ GOES WITH THE MESSAGE BELOW
            postedPageIndexesByObjectApiName: new Map([...columnFieldApiNamesByObjectApiName.keys()].map(objectApiName => [objectApiName, new Set([0])] as const)),
            columnPlansByObjectApiName: columnPlansByObjectApiName,
            narrowingLookupsByObjectApiName: new Map(requests.flatMap(request => request.narrowingLookup
                ? [[request.objectApiName, { fieldApiName: request.narrowingLookup.fieldApiName, parentObjectApiName: request.narrowingLookup.parentObjectApiName }] as const]
                : []))
        };
        RecipeCockpitAdapterState.heldUpdaterRecords = heldUpdaterRecords;

        // "Generate new records" (#722) IS OFFERED FOR AN OBJECT THE LOAD READ BELOW THE PARENT: WHICH OBJECT ITS NEW RECORDS GO UNDER, BY WHICH LOOKUP, AND HOW MANY OF THAT OBJECT WERE LOADED
        objectViewModels.forEach(objectViewModel => {
            const narrowingLookup = heldUpdaterRecords.narrowingLookupsByObjectApiName.get(objectViewModel.objectApiName);
            if ( narrowingLookup && columnPlansByObjectApiName.has(objectViewModel.objectApiName) ) {
                objectViewModel.newRecordsParent = {
                    parentObjectApiName: narrowingLookup.parentObjectApiName,
                    lookupFieldApiName: narrowingLookup.fieldApiName,
                    parentRecordCount: RecipeCockpitAdapterNewRecords.listParentRecordIds(objectViewModel.objectApiName)?.length ?? 0
                };
            }
        });

        const recordsMessage: IRecipeCockpitUpdaterRecordsMessage = {
            command: 'updaterRecords',
            renderSequence: renderSequence,
            treeKey: treeKey,
            orgLabel: orgLabel,
            objects: objectViewModels
        };
        const heldResultKey = heldUpdaterRecords.resultKey;
        const recordLinkSequence = RecipeCockpitRecordLinks.registerRecordLinkPreview(panelState, {
            previewKind: 'updaterRecords',
            renderSequence: renderSequence,
            treeKey: treeKey,
            orgUsername: orgUsername,
            heldSource: heldUpdaterRecords,
            recordIdsByObjectApiName: recordIdsByObjectApiName,
            tablePages: {
                pageSize: RECIPE_COCKPIT_UPDATER_RECORDS_PAGE_SIZE,
                postedPageIndexesByObjectApiName: heldUpdaterRecords.postedPageIndexesByObjectApiName,
                // READ FROM THE LOAD THE HOST HOLDS WHEN THE CLICK ARRIVES, NEVER FROM RECORDS KEPT HERE: A PREVIEW MUST NOT KEEP A RELEASED LOAD IN MEMORY
                readCellRecordId: (objectApiName, recordIndex, columnIndex) => this.readHeldTableCellRecordId(heldResultKey, objectApiName, recordIndex, columnIndex)
            }
        });
        if ( recordLinkSequence !== undefined ) {
            recordsMessage.recordLinkSequence = recordLinkSequence;
        }
        panelState.updaterRecordsMessage = recordsMessage;
        hub.postToPanel(cockpitPanel, recordsMessage);

        const recordCount = objectViewModels.reduce((total, objectViewModel) => total + objectViewModel.recordCount, 0);
        const failedObjectApiNames = objectViewModels.filter(objectViewModel => objectViewModel.failureMessage !== undefined).map(objectViewModel => objectViewModel.objectApiName);
        const loadedText = `Loaded ${recordCount} ${recordCount === 1 ? 'record' : 'records'} of ${treeTitle} from ${orgLabel}`;

        if ( failedObjectApiNames.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${loadedText}. ${failedObjectApiNames.join(', ')} could not be read; the Treecipe Adapter tab says why.`));
            return;
        }

        if ( isTruncated ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${loadedText}, and stopped there: a load reads at most ${RECIPE_COCKPIT_QUERY_RECORD_CAP} records and ${RECIPE_COCKPIT_QUERY_VALUE_BUDGET} values in all. Add a WHERE to read them all.`));
            return;
        }

        VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(`${loadedText}.`));

    }

    /*
        Each object's fields as the org describes them to this user, read afresh since a load follows
        a change in the org as often as not (#720). An object missing from the answer was not
        described -- the org lacks it, or the describe failed -- and its query says why.
    */
    private static async describeLoadedObjects(orgUsername: string, connection: Connection, objectApiNames: string[],
                                               isCancellationRequested: () => boolean): Promise<Map<string, string[]>> {

        const describedFieldApiNamesByObjectApiName = new Map<string, string[]>();
        objectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(orgUsername, objectApiName));

        try {
            const describeResult = await SalesforceOrgService.describeObjects(orgUsername, objectApiNames, async () => connection, { isCancellationRequested: isCancellationRequested });
            describeResult.outcomes.forEach(describeOutcome => {
                if ( describeOutcome.describe ) {
                    describedFieldApiNamesByObjectApiName.set(describeOutcome.objectApiName, describeOutcome.describe.fields.map(describedField => describedField.fieldApiName));
                }
            });
        } catch {
            return new Map();
        }

        return describedFieldApiNamesByObjectApiName;

    }

    // A TABLE CELL'S RECORD Id (#720), ONLY FROM THE LOAD NAMED AND ONLY WHILE IT IS HELD: ITS Id COLUMN, OR A LOOKUP COLUMN HOLDING A WHOLE Id
    private static readHeldTableCellRecordId(resultKey: string, objectApiName: string, recordIndex: number, columnIndex: number): string | undefined {

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;

        if ( heldRecords?.resultKey !== resultKey ) {
            return undefined;
        }

        const record = heldRecords.recordsByObjectApiName.get(objectApiName)?.[recordIndex];
        const columnFieldApiName = heldRecords.columnFieldApiNamesByObjectApiName.get(objectApiName)?.[columnIndex];
        const isOpenableColumn = columnFieldApiName === RECIPE_COCKPIT_PREVIEW_RECORD_ID_COLUMN
            || ( columnFieldApiName !== undefined && heldRecords.lookupFieldApiNamesByObjectApiName.get(objectApiName)?.includes(columnFieldApiName) );

        return record && columnFieldApiName !== undefined && isOpenableColumn ? RecipeCockpitQuery.readLinkedRecordId(record, columnFieldApiName) : undefined;

    }

    // ONE MORE PAGE OF AN OBJECT'S HELD RECORDS (#720), AS IT READS NOW (#721): THE ROUTER MATCHED THE OBJECT AND THE PAGE AGAINST THE RECORDS ON SCREEN
    static postUpdaterRecordsPage(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState,
                                  pageAction: Extract<RecipeCockpitPanelAction, { kind: 'postUpdaterRecordsPage' }>) {

        RecipeCockpitAdapterEdits.postEditedPage(hub, cockpitPanel, panelState, { treeKey: pageAction.treeKey, renderSequence: pageAction.renderSequence, objectApiName: pageAction.objectApiName, pageIndex: pageAction.pageIndex });

    }

    /*
        "Change parent object" (#720) with records loaded: they, and any values generated for them,
        belong to the parent they were loaded under, so the reader is asked once and they are let go
        on the host before the panel goes back to step 1. Nothing in the org changes.
    */
    static async changeUpdaterParentFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                              panelState: IRecipeCockpitPanelState,
                                              changeAction: Extract<RecipeCockpitPanelAction, { kind: 'changeUpdaterParent' }>) {

        const { treeKey, renderSequence } = changeAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const isHeldForThisTree = heldRecords !== undefined
            && heldRecords.workspaceRoot === panelState.workspaceRoot
            && heldRecords.renderSequence === renderSequence
            && heldRecords.folderName === tree?.folderName;

        // RECORDS HELD FOR ANOTHER CARD ARE NOT THIS CARD'S TO LET GO, AND THE PANEL'S ANSWER WOULD CLEAR THEM FROM THE SCREEN
        if ( !clickedRecipeDataMessage || !tree || ( heldRecords !== undefined && !isHeldForThisTree ) ) {
            return;
        }

        if ( isHeldForThisTree ) {

            const recordCount = RecipeCockpitAdapterState.readHeldUpdaterRecordCount();
            const hasUnwrittenChanges = [...( RecipeCockpitAdapterState.heldUpdaterEdits?.editsByObjectApiName.values() ?? [] )].some(objectEdits => objectEdits.changedValuesByRecordId.size > 0);
            const newRecordCount = RecipeCockpitAdapterState.readHeldUpdaterNewRecordCount();
            const heldText = `${recordCount} loaded ${recordCount === 1 ? 'record' : 'records'}${hasUnwrittenChanges ? ' and the changes made to them, which were not written to the org' : ''}`
                + ( newRecordCount > 0 ? `, and the ${newRecordCount} new ${newRecordCount === 1 ? 'record' : 'records'} generated under them` : '' );
            const answer = recordCount === 0
                ? RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL
                : await hub.confirmInPanel(
                    `Change the parent object of ${tree.customName ?? tree.title}?`,
                    { summary: [`The ${heldText} ${recordCount === 1 && !hasUnwrittenChanges && newRecordCount === 0 ? 'is' : 'are'} let go, and step 1 opens with the parent object and WHERE as they are. Nothing in the org changes.`] },
                    RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL
                );

            if ( answer !== RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL
                    || hub.recipeCockpitPanel !== cockpitPanel
                    || hub.recipeCockpitPanelState !== panelState
                    || panelState.recipeDataMessage !== clickedRecipeDataMessage
                    || RecipeCockpitAdapterState.heldUpdaterRecords !== heldRecords
                    || RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
                return;
            }

            RecipeCockpitAdapterState.clearHeldUpdaterRecords();
            panelState.updaterRecordsMessage = undefined;
            panelState.adapterChildBlockMessage = undefined;
            panelState.updaterNewRecordsMessages = undefined;
    
        }

        hub.postToPanel(cockpitPanel, { command: 'updaterParentChange', renderSequence: renderSequence, treeKey: treeKey });

    }

    // THE ONE PROCESSOR PER BACKEND THE UPDATER GENERATES WITH, SO A TEST CAN STAND ONE IN
    static createUpdaterRecipeProcessor(fakerService: 'faker-js' | 'snowfakery'): IFakerRecipeProcessor {
        return RecipeCockpitFakerValueGeneration.createRecipeProcessor(fakerService);
    }

    /*
        "Update records" (#418): the changed cells of the rows the reader marked (#721), written to the
        records the last Load records read, by Id, in the sandbox they were read from. It shares the load's one
        run per window (runKind 'update'), and holds the org selection while it runs. Once a request
        has been sent the loaded records and their values are spent -- their "current" values are no
        longer current -- so they are let go and the panel is told so.
    */
    static async updateUpdaterRecordsFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        updateAction: Extract<RecipeCockpitPanelAction, { kind: 'updateUpdaterRecords' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: updateAction.treeKey, runKind: 'update' };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: updateAction.treeKey, runKind: 'update' });
        let isRecordsSpent = false;

        try {
            isRecordsSpent = await this.performUpdaterUpdate(hub, cockpitPanel, panelState, updateAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            if ( isRecordsSpent ) {
                RecipeCockpitAdapterState.clearHeldUpdaterRecords();
                panelState.updaterRecordsMessage = undefined;
                panelState.adapterChildBlockMessage = undefined;
                panelState.updaterNewRecordsMessages = undefined;
                    }
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, isRecordsSpent ? { ...notRunning, isRecordsSpent: true } : notRunning);
            // AN UPDATE THAT SAVED A SNAPSHOT LISTS IT FOR RESTORE (#419)
            this.refreshUpdaterSnapshots(hub, cockpitPanel, panelState, updateAction.treeKey);
        }

    }

    // TRUE ONCE A REQUEST WAS SENT, WHICH SPENDS THE LOADED RECORDS AND THEIR VALUES
    private static async performUpdaterUpdate(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                updateAction: Extract<RecipeCockpitPanelAction, { kind: 'updateUpdaterRecords' }>): Promise<boolean> {

        const { treeKey } = updateAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const refuse = (refusalText: string) => { VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(refusalText)); return false; };

        if ( !clickedRecipeDataMessage || !tree?.folderName ) {
            return false;
        }

        const heldRecords = RecipeCockpitAdapterState.heldUpdaterRecords;
        const heldEdits = RecipeCockpitAdapterState.heldUpdaterEdits;

        if ( !heldRecords
                || heldRecords.workspaceRoot !== panelState.workspaceRoot
                || heldRecords.renderSequence !== clickedRecipeDataMessage.renderSequence
                || heldRecords.folderName !== tree.folderName ) {
            return refuse(RECIPE_COCKPIT_UPDATER_NOT_LOADED_FOR_UPDATE_REFUSAL);
        }

        const dataOrgSelection = panelState.dataOrgSelection;
        if ( dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
            return refuse('Nothing was updated: the org selected in Target Org Manager has not answered that it is a sandbox or scratch org.');
        }

        const orgDetail = dataOrgSelection.orgDetail;
        const orgUsername = orgDetail.username;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgUsername}` : orgUsername;
        const treeTitle = tree.customName ?? tree.title;
        const describeRecords = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;

        // THE ORG WRITTEN TO IS THE ORG READ FROM: ANOTHER ORG'S Ids WOULD NAME NOTHING THERE, OR SOMETHING ELSE
        if ( orgUsername !== heldRecords.orgUsername ) {
            return refuse(`Nothing was updated: the records of ${treeTitle} were loaded from ${heldRecords.orgUsername}, not ${orgLabel}. Load them again from the org selected now.`);
        }

        // PARENTS FIRST: THE CARD'S OBJECTS ARE IN INSERT ORDER, WHICH IS RELATIONSHIP LEVEL ORDER. ONLY MARKED ROWS, AND OF THOSE ONLY THE CELLS CHANGED (#721)
        const updatePlan = RecipeCockpitAdapterEdits.planUpdate(heldRecords, RecipeCockpitAdapterState.listUpdaterTreeObjects(clickedRecipeDataMessage.recipe, tree).map(treeObject => treeObject.objectApiName));
        const plannedObjects = updatePlan.plannedObjects;

        if ( plannedObjects.length === 0 ) {
            return refuse(RECIPE_COCKPIT_UPDATER_NOTHING_MARKED_REFUSAL);
        }

        const recordTotal = plannedObjects.reduce((total, plannedObject) => total + plannedObject.recordValues.length, 0);

        let connection: Connection;
        try {
            connection = await SalesforceOrgService.getConnection(orgUsername);
        } catch {
            // ITS ERROR CAN CARRY AN AUTH URL OR TOKEN TEXT, SO IT IS NOT QUOTED
            return refuse(`Nothing was updated: ${orgLabel} could not be connected to. ${RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE}`);
        }

        // READINESS: EVERY FIELD WRITTEN IS IN THE ORG'S DESCRIBE AND UPDATEABLE THERE; A DESCRIBE THAT FAILED IS A REASON, NEVER A DEFAULT
        const describeResult = await SalesforceOrgService.describeObjects(orgUsername, plannedObjects.map(plannedObject => plannedObject.objectApiName), async () => connection);
        const describeOutcomes = new Map(describeResult.outcomes.map(describeOutcome => [describeOutcome.objectApiName, describeOutcome] as const));

        for ( const plannedObject of plannedObjects ) {
            const describeOutcome = describeOutcomes.get(plannedObject.objectApiName);
            const updateReason = RecipeCockpitRecordUpdate.findUpdateReason(plannedObject.objectApiName, plannedObject.fieldApiNames, describeOutcome?.describe, describeOutcome?.failureMessage);
            if ( updateReason ) {
                return refuse(`Nothing was updated in ${orgLabel}: ${updateReason}`);
            }
        }

        // A PICKLIST ON AN OBJECT WITH RECORD TYPES GETS THE FIELD'S OWN VALUES, WHICH A RECORD TYPE CAN NARROW: THE ORG DECIDES, AND SAYS SO PER RECORD
        const hasRecordTypePicklist = RecipeCockpitDrawnModel.hasRecordTypePicklist(clickedRecipeDataMessage.recipe, plannedObjects, describeOutcomes);

        const answer = await hub.confirmInPanel(
            `Update ${describeRecords(recordTotal)} of ${treeTitle} in ${orgLabel}?`,
            {
                // AN UPDATE THAT IS SENT SPENDS THE LOADED RECORDS, AND THE NEW RECORDS GENERATED UNDER THEM (#722) GO WITH THEM
                summary: RecipeCockpitAdapterState.readHeldUpdaterNewRecordCount() > 0
                    ? [`The ${RecipeCockpitAdapterState.readHeldUpdaterNewRecordCount()} new records generated under the loaded records are let go when this update is sent: they are a preview and were not inserted.`]
                    : [],
                org: hub.buildConfirmOrg(dataOrgSelection.orgDetail),
                badge: SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail, dataOrgSelection.scratchOrgDetail),
                warnings: hasRecordTypePicklist ? [RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE] : [],
                sections: [
                    {
                        title: 'Records and fields',
                        count: plannedObjects.length,
                        // A MARKED ROW WITH NO CHANGED CELL IS COUNTED AND NOT WRITTEN
                        lines: plannedObjects.map(plannedObject => `${plannedObject.objectApiName}: ${plannedObject.markedRecordCount} marked, ${describeRecords(plannedObject.recordValues.length)} to update -- ${plannedObject.fieldApiNames.join(', ')}`)
                    },
                    { title: 'How it can be undone', lines: ['Each record is updated by its Id.', `The old values are saved first to treecipe/${RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME}/${tree.folderName}/, and nothing is updated if they cannot be.`] }
                ],
                isDestructive: true
            },
            RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL
        );

        if ( answer !== RECIPE_COCKPIT_UPDATER_UPDATE_CONFIRM_LABEL ) {
            return false;
        }

        // THE SAME QUESTION INSERT DATA SET BY DIRECTORY AND THE TREE INSERT ASK
        const allOrNoneSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
        if ( allOrNoneSelection === undefined ) {
            return false;
        }

        const isStillCurrent = hub.recipeCockpitPanel === cockpitPanel
                                && hub.recipeCockpitPanelState === panelState
                                && panelState.recipeDataMessage === clickedRecipeDataMessage
                                && panelState.dataOrgSelection === dataOrgSelection
                                && RecipeCockpitAdapterState.heldUpdaterRecords === heldRecords
                                && RecipeCockpitAdapterState.heldUpdaterEdits === heldEdits;

        if ( !isStillCurrent ) {
            return refuse(`Nothing was updated: the run, the org selection or the loaded records changed after ${orgLabel} was confirmed. Load the records and make the changes again.`);
        }

        // ASKED AGAIN, NOT READ FROM THE SELECTION: THIS IS THE ANSWER THE UPDATE RELIES ON, ON THE CONNECTION IT UPDATES WITH
        const orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(connection));
        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was updated in ${orgLabel}: it answered ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}, and the Treecipe Adapter updates only a sandbox or scratch org.`);
        }

        const startedAt = new Date();
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(panelState.workspaceRoot, clickedRecipeDataMessage.recipe, tree);
        // EACH RECORD'S OLD VALUES OF THE FIELDS CHANGED ON IT, AND OF NO OTHER (#721)
        const snapshotObjects = plannedObjects.map(plannedObject => RecipeCockpitRecordUpdate.buildSnapshotObject(plannedObject.objectApiName, plannedObject.fieldApiNames, plannedObject.loadedRecords,
                                                                                                                  updatePlan.orgOnlyFieldApiNamesByObjectApiName.get(plannedObject.objectApiName),
                                                                                                                  new Map(plannedObject.recordValues.map(recordValue => [recordValue.recordId, Object.keys(recordValue.fieldValues)] as const))));
        // NOTHING IS UPDATED UNLESS ITS OLD VALUES ARE SAVED: A SNAPSHOT SHORT OF A RECORD THE UPDATE WRITES IS NO SNAPSHOT
        const isEveryRecordSaved = plannedObjects.every((plannedObject, objectIndex) => snapshotObjects[objectIndex].records.length === plannedObject.recordValues.length);
        const attemptFiles = isEveryRecordSaved && runArtifactsLocation && RecipeCockpitRecordUpdate.writeSnapshot(runArtifactsLocation, {
            orgUsername: orgUsername,
            treeFolderName: tree.folderName,
            takenAt: startedAt.toISOString(),
            objects: snapshotObjects
        }, startedAt);

        if ( !attemptFiles ) {
            return refuse(RECIPE_COCKPIT_UPDATER_SNAPSHOT_FAILED_REFUSAL);
        }

        const sendResult = await this.sendUpdaterRequests(connection, plannedObjects, snapshotObjects, allOrNoneSelection, treeTitle, orgLabel);

        const isResultsWritten = RecipeCockpitRecordUpdate.writeResults(attemptFiles.resultsFilePath, panelState.workspaceRoot, {
            orgUsername: orgUsername,
            treeFolderName: tree.folderName,
            snapshotFile: path.basename(attemptFiles.snapshotFilePath),
            startedAt: startedAt.toISOString(),
            allOrNone: allOrNoneSelection,
            outcome: sendResult.outcome,
            updatedRecordCount: sendResult.updatedRecordCount,
            failedRecordCount: sendResult.failedRecordCount,
            ...( sendResult.putBack ? { putBack: sendResult.putBack } : {} ),
            ...RecipeCockpitDrawnModel.buildOrgOnlyFieldsResult(snapshotObjects),
            objects: sendResult.objectResults
        });

        const adaptedRun = await this.writeAdaptedRunAfterUpdate(panelState, treeKey, tree.folderName, heldRecords, updatePlan, sendResult, orgDetail, startedAt);

        this.showUpdaterUpdateNotification(sendResult, treeTitle, orgLabel, path.basename(attemptFiles.snapshotFilePath), isResultsWritten ? attemptFiles.resultsFilePath : undefined, panelState.workspaceRoot, 'update', adaptedRun, runArtifactsLocation);

        // IN PLACE (#226), ONLY ON THE PANEL AND MODEL THE UPDATE WAS CLICKED ON; THE NEXT RELOAD LISTS IT EITHER WAY
        if ( adaptedRun && 'datasetFolderPath' in adaptedRun
                && hub.recipeCockpitPanel === cockpitPanel
                && hub.recipeCockpitPanelState === panelState
                && panelState.recipeDataMessage === clickedRecipeDataMessage ) {
            RecipeCockpitDatasetsHost.postAddedDataset(hub, cockpitPanel, panelState, clickedRecipeDataMessage, adaptedRun.datasetFolderPath);
        }

        return sendResult.isAnyRequestSent;

    }

    /*
        After an update lands (#448): a copy of the data set as the org holds it now -- every record the
        load read, each one the org saved carrying its new values -- and the recipe that reproduces it,
        marked "# ADAPTED". Nothing is written when no record was updated, or when all-or-none set the
        updated records back. A card with no single recipe file, or a backend that cannot be told,
        gets no copy; that is said in the notification rather than refused, since the update landed.
    */
    static async writeAdaptedRunAfterUpdate(panelState: IRecipeCockpitPanelState,
                                      treeKey: string,
                                      treeFolderName: string,
                                      heldRecords: NonNullable<typeof RecipeCockpitAdapterState.heldUpdaterRecords>,
                                      heldValues: Pick<IRecipeCockpitUpdaterUpdatePlan, 'valuesByObjectApiName' | 'orgOnlyFieldApiNamesByObjectApiName' | 'adaptedRecipeFields'>,
                                      sendResult: IRecipeCockpitUpdaterSendResult,
                                      orgDetail: IAuthenticatedOrgDetail,
                                      adaptedAt: Date): Promise<RecipeCockpitAdaptedRunWrite | undefined> {

        if ( sendResult.updatedRecordCount === 0 || sendResult.putBack ) {
            return undefined;
        }

        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);
        const generatedRecipesFolderPath = path.join(panelState.workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const fakerService = recipeFilePath ? VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath) : undefined;

        if ( !recipeFilePath || !fakerService ) {
            return { isWritten: false, refusal: 'this card has no single recipe file whose backend can be told.' };
        }

        const savedRecordIdsByObjectApiName = new Map(sendResult.objectResults.map(objectResult => [
            objectResult.objectApiName,
            new Set(objectResult.results.filter(recordResult => recordResult.isSuccess).map(recordResult => recordResult.recordId))
        ] as const));

        // THE LOADED RECORDS ARE PASSED AS THEY ARE, WITH THE NEW VALUES OF THE SAVED ONES BESIDE THEM: THE WRITE MERGES THEM, SO NOTHING IS COPIED HERE
        const objects: IAdaptedObjectRecords[] = [...heldRecords.recordsByObjectApiName.entries()].map(([objectApiName, loadedRecords]) => {
            const savedRecordIds = savedRecordIdsByObjectApiName.get(objectApiName);
            const newValuesByRecordId = new Map(( heldValues.valuesByObjectApiName.get(objectApiName) ?? [] )
                .filter(recordValues => savedRecordIds?.has(recordValues.recordId))
                .map(recordValues => [recordValues.recordId, recordValues.fieldValues] as const));
            return { objectApiName: objectApiName, records: loadedRecords, newValuesByRecordId: newValuesByRecordId };
        });

        const orgOnlyFieldsByObjectApiName = heldValues.orgOnlyFieldApiNamesByObjectApiName;
        const updatedObjectApiNames = new Set([...savedRecordIdsByObjectApiName.entries()].filter(([, savedRecordIds]) => savedRecordIds.size > 0).map(([objectApiName]) => objectApiName));
        const adaptedRecipeFields = heldValues.adaptedRecipeFields.filter(adaptedField => updatedObjectApiNames.has(adaptedField.objectApiName));
        const updatedFieldsByObject = Object.fromEntries([...updatedObjectApiNames].map(objectApiName => [
            objectApiName,
            adaptedRecipeFields.filter(adaptedField => adaptedField.objectApiName === objectApiName).map(adaptedField => ({
                fieldApiName: adaptedField.fieldApiName,
                ...( ( orgOnlyFieldsByObjectApiName.get(objectApiName) ?? [] ).includes(adaptedField.fieldApiName) ? { isOrgOnly: true as const } : {} )
            }))
        ]));

        return RecipeCockpitAdaptedDataset.writeAdaptedRun({
            workspaceRoot: panelState.workspaceRoot,
            fakeDataSetsFolderPath: path.join(panelState.workspaceRoot, ConfigurationService.getFakeDataSetsFolderPath()),
            generatedRecipesFolderPath: generatedRecipesFolderPath,
            recipeFilePath: recipeFilePath,
            treeFolderName: treeFolderName,
            fakerService: fakerService,
            date: adaptedAt,
            objects: objects,
            adaptedFields: adaptedRecipeFields,
            adaptation: {
                parentObjectApiName: heldRecords.parentObjectApiName,
                whereText: heldRecords.whereClausesByObjectApiName.get(heldRecords.parentObjectApiName) ?? '',
                orgUsername: orgDetail.username,
                updatedFieldsByObject: updatedFieldsByObject,
                // A NEW CHILD OBJECT'S INSERT (#447, E2) IS NOT BUILT YET, SO AN UPDATE ADDS NONE
                addedObjectApiNames: [],
                insertedRecordIdsByObject: {}
            },
            orgLabel: orgDetail.alias || orgDetail.username
        });

    }

    /*
        A card's snapshots (#419), listed by FILE NAME and posted, the paths kept host-only as the
        PENDING list; only the panel's ack of this list makes Restore routable on it. A card with no
        folder, or a model no longer on screen, gets nothing.
    */
    private static updaterSnapshotsSequence = 0;

    static postUpdaterSnapshots(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, treeKey: string) {

        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeDataMessage || !tree?.folderName ) {
            return;
        }

        const snapshotLocations = hub.resolveTreeSnapshotLocations(panelState.workspaceRoot, recipeDataMessage.recipe, tree);
        const snapshotList = RecipeCockpitRecordUpdate.listSnapshots(panelState.workspaceRoot, tree.folderName, snapshotLocations);
        const snapshotPathsByName = new Map<string, string>();
        snapshotList.snapshotFileNames.forEach(snapshotFileName => {
            const snapshotFilePath = RecipeCockpitRecordUpdate.resolveSnapshotFilePath(panelState.workspaceRoot, tree.folderName as string, snapshotFileName, snapshotLocations);
            if ( snapshotFilePath ) {
                snapshotPathsByName.set(snapshotFileName, snapshotFilePath);
            }
        });

        const snapshotsMessage: IRecipeCockpitUpdaterSnapshotsMessage = {
            command: 'updaterSnapshots',
            renderSequence: recipeDataMessage.renderSequence,
            treeKey: treeKey,
            snapshotNames: [...snapshotPathsByName.keys()],
            hiddenSnapshotCount: snapshotList.hiddenSnapshotCount,
            snapshotsSequence: ++this.updaterSnapshotsSequence
        };

        panelState.pendingRestorableSnapshots.set(treeKey, { snapshotsSequence: snapshotsMessage.snapshotsSequence, snapshotPathsByName: snapshotPathsByName });
        hub.postToPanel(cockpitPanel, snapshotsMessage);

    }

    // AFTER AN UPDATE OR A RESTORE, ONLY ON THE PANEL AND MODEL STILL ON SCREEN
    private static refreshUpdaterSnapshots(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, treeKey: string) {

        if ( hub.recipeCockpitPanel === cockpitPanel
                && hub.recipeCockpitPanelState === panelState
                && panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
            this.postUpdaterSnapshots(hub, cockpitPanel, panelState, treeKey);
        }

    }

    /*
        "Restore previous values…" (#419): a snapshot an update saved, written back to its records by
        Id, in the sandbox it was taken in. It shares the load's one run per window (runKind
        'restore'), holds the org selection while it runs, and -- since what it writes over is the
        org's data now -- once a request was sent the loaded records and their values are spent.
    */
    static async restoreUpdaterSnapshotFromPanel(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                                         panelState: IRecipeCockpitPanelState,
                                                         restoreAction: Extract<RecipeCockpitPanelAction, { kind: 'restoreUpdaterSnapshot' }>) {

        const notRunning: IRecipeCockpitUpdaterLoadStateMessage = { command: 'updaterLoadState', isRunning: false, treeKey: restoreAction.treeKey, runKind: 'restore' };

        if ( RecipeCockpitAdapterState.isUpdaterLoadInFlight ) {
            hub.postToPanel(cockpitPanel, RecipeCockpitAdapterState.updaterLoadRunStateMessage ?? notRunning);
            return;
        }

        RecipeCockpitAdapterState.isUpdaterLoadInFlight = true;
        RecipeCockpitAdapterState.setUpdaterLoadState(hub, { command: 'updaterLoadState', isRunning: true, treeKey: restoreAction.treeKey, runKind: 'restore' });
        let isRecordsSpent = false;

        try {
            isRecordsSpent = await this.performUpdaterRestore(hub, cockpitPanel, panelState, restoreAction);
        } finally {
            RecipeCockpitAdapterState.isUpdaterLoadInFlight = false;
            if ( isRecordsSpent ) {
                RecipeCockpitAdapterState.clearHeldUpdaterRecords();
                panelState.updaterRecordsMessage = undefined;
                panelState.adapterChildBlockMessage = undefined;
                panelState.updaterNewRecordsMessages = undefined;
                    }
            RecipeCockpitAdapterState.setUpdaterLoadState(hub, isRecordsSpent ? { ...notRunning, isRecordsSpent: true } : notRunning);
            // THE RESTORE SAVED A SNAPSHOT OF ITS OWN, WHICH IS LISTED TOO: A RESTORE CAN BE UNDONE THE SAME WAY
            this.refreshUpdaterSnapshots(hub, cockpitPanel, panelState, restoreAction.treeKey);
        }

    }

    /*
        Every guard the update applies (#418), on a snapshot read from the workspace as UNTRUSTED
        (RecipeCockpitRecordUpdate.parseSnapshot, the whole file refused on any part it cannot
        read): the snapshot must be this card's, taken in the org selected now, and name only the
        card's objects and fields the Updater offers; the org must answer it is a sandbox, before
        and after the confirmation, and its describe must let each field be updated. The values the
        records hold NOW are read and saved first, as the update saves its old values, so a restore
        is itself restorable, and a record the org no longer returns is left out and said so.
    */
    private static async performUpdaterRestore(hub: IRecipeCockpitHubForAdapterTab, cockpitPanel: vscode.WebviewPanel,
                                               panelState: IRecipeCockpitPanelState,
                                               restoreAction: Extract<RecipeCockpitPanelAction, { kind: 'restoreUpdaterSnapshot' }>): Promise<boolean> {

        const { treeKey, snapshotName } = restoreAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const tree = clickedRecipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const refuse = (refusalText: string) => { VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(refusalText)); return false; };

        if ( !clickedRecipeDataMessage || !tree?.folderName ) {
            return false;
        }

        const dataOrgSelection = panelState.dataOrgSelection;
        if ( dataOrgSelection?.orgTypeDetail?.isSandbox !== true ) {
            return refuse('Nothing was restored: the org selected in Target Org Manager has not answered that it is a sandbox or scratch org.');
        }

        // RESOLVED AGAIN, NOT TAKEN FROM THE LIST: IT MAY HAVE GONE, OR BECOME A LINK, SINCE IT WAS LISTED
        const listedSnapshotPath = panelState.restorableSnapshots.get(treeKey)?.get(snapshotName);
        const snapshotFilePath = RecipeCockpitRecordUpdate.resolveSnapshotFilePath(panelState.workspaceRoot, tree.folderName, snapshotName,
                                                                                    hub.resolveTreeSnapshotLocations(panelState.workspaceRoot, clickedRecipeDataMessage.recipe, tree));
        if ( !listedSnapshotPath || snapshotFilePath !== listedSnapshotPath ) {
            return refuse(`Nothing was restored: ${snapshotName} is no longer where it was listed from.`);
        }

        const snapshot = RecipeCockpitRecordUpdate.readSnapshotFile(snapshotFilePath);
        if ( 'refusal' in snapshot ) {
            return refuse(`Nothing was restored: ${snapshotName} was refused, because ${snapshot.refusal}.`);
        }

        const orgDetail = dataOrgSelection.orgDetail;
        const orgUsername = orgDetail.username;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgUsername}` : orgUsername;
        const treeTitle = tree.customName ?? tree.title;
        const describeRecords = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;

        if ( snapshot.treeFolderName !== tree.folderName ) {
            return refuse(`Nothing was restored: ${snapshotName} names the tree ${snapshot.treeFolderName}, not ${tree.folderName}.`);
        }

        // AN Id NAMES A RECORD IN ONE ORG: THE VALUES GO BACK ONLY WHERE THEY WERE TAKEN
        if ( snapshot.orgUsername !== orgUsername ) {
            return refuse(`Nothing was restored: ${snapshotName} was taken in ${snapshot.orgUsername}, not ${orgLabel}. Select that org in Target Org Manager.`);
        }

        // ONLY WHAT AN UPDATE OF THIS CARD COULD HAVE WRITTEN: ITS OBJECTS, AND FIELDS THE UPDATER DOES NOT LOCK
        const objectViewModelsByApiName = new Map(clickedRecipeDataMessage.recipe.objects.map(object => [object.objectApiName, object] as const));
        const treeObjects = RecipeCockpitAdapterState.listUpdaterTreeObjects(clickedRecipeDataMessage.recipe, tree);

        for ( const snapshotObject of snapshot.objects ) {
            const treeObject = treeObjects.find(candidateObject => candidateObject.objectApiName === snapshotObject.objectApiName);
            if ( !treeObject ) {
                return refuse(`Nothing was restored: ${snapshotName} names ${snapshotObject.objectApiName}, which is not an object of ${treeTitle}.`);
            }
            for ( const fieldApiName of snapshotObject.fieldApiNames ) {
                const fieldViewModel = objectViewModelsByApiName.get(snapshotObject.objectApiName)?.fields.find(field => field.fieldApiName === fieldApiName);
                // A FIELD ONLY THE ORG HELD WHEN THE UPDATE RAN (#446) IS CHECKED AGAINST THE ORG'S DESCRIBE BELOW, SINCE THE RECIPE HAS NO MODEL OF IT
                if ( !fieldViewModel && ( snapshotObject.orgOnlyFieldApiNames ?? [] ).includes(fieldApiName) ) {
                    continue;
                }
                const lockReason = fieldViewModel ? RecipeCockpitAdapterState.findUpdaterFieldLockReason(tree, snapshotObject.objectApiName, fieldViewModel) : 'it is not a field of the object in this run';
                if ( lockReason ) {
                    return refuse(`Nothing was restored: ${snapshotName} names ${snapshotObject.objectApiName}.${fieldApiName}, which the Treecipe Adapter does not write: ${lockReason}.`);
                }
            }
        }

        // PARENTS FIRST, AS THE UPDATE SENDS THEM
        const snapshotObjects = treeObjects.flatMap(treeObject => snapshot.objects.filter(snapshotObject => snapshotObject.objectApiName === treeObject.objectApiName && snapshotObject.records.length > 0));

        if ( snapshotObjects.length === 0 ) {
            return refuse(`Nothing was restored: ${snapshotName} holds no records.`);
        }

        let connection: Connection;
        try {
            connection = await SalesforceOrgService.getConnection(orgUsername);
        } catch {
            // ITS ERROR CAN CARRY AN AUTH URL OR TOKEN TEXT, SO IT IS NOT QUOTED
            return refuse(`Nothing was restored: ${orgLabel} could not be connected to. ${RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE}`);
        }

        const describeResult = await SalesforceOrgService.describeObjects(orgUsername, snapshotObjects.map(snapshotObject => snapshotObject.objectApiName), async () => connection);
        const describeOutcomes = new Map(describeResult.outcomes.map(describeOutcome => [describeOutcome.objectApiName, describeOutcome] as const));

        for ( const snapshotObject of snapshotObjects ) {
            const describeOutcome = describeOutcomes.get(snapshotObject.objectApiName);
            const updateReason = RecipeCockpitRecordUpdate.findUpdateReason(snapshotObject.objectApiName, snapshotObject.fieldApiNames, describeOutcome?.describe, describeOutcome?.failureMessage);
            if ( updateReason ) {
                return refuse(`Nothing was restored in ${orgLabel}: ${updateReason}`);
            }
            for ( const orgOnlyFieldApiName of snapshotObject.orgOnlyFieldApiNames ?? [] ) {
                if ( objectViewModelsByApiName.get(snapshotObject.objectApiName)?.fields.some(field => field.fieldApiName === orgOnlyFieldApiName) ) {
                    continue;
                }
                const describedField = describeOutcome?.describe?.fields.find(field => field.fieldApiName.toLowerCase() === orgOnlyFieldApiName.toLowerCase());
                const lockReason = RecipeCockpitDrawnModel.findDescribedOrgOnlyFieldLockReason(orgOnlyFieldApiName, describedField);
                if ( lockReason ) {
                    return refuse(`Nothing was restored: ${snapshotName} names ${snapshotObject.objectApiName}.${orgOnlyFieldApiName}, which the Treecipe Adapter does not write: ${lockReason}.`);
                }
            }
        }

        // WHAT THE RECORDS HOLD NOW, SAVED BEFORE ANYTHING IS WRITTEN; A RECORD THE ORG DOES NOT RETURN IS NOT RESTORED
        // A LARGE SNAPSHOT IS HUNDREDS OF QUERIES, SO IT IS READ BEHIND A CANCELLABLE PROGRESS, AS A LOAD IS
        let plannedObjects: IRecipeCockpitUpdaterRestoreTarget[] | undefined;
        try {
            const recordTotal = snapshotObjects.reduce((total, snapshotObject) => total + snapshotObject.records.length, 0);
            plannedObjects = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: reading the current values of ${treeTitle} in ${orgLabel}`),
                cancellable: true
            }, async (progress, cancellationToken) => this.readUpdaterRestoreTargets(
                connection,
                snapshotObjects,
                () => cancellationToken.isCancellationRequested,
                readCount => progress.report({ message: `${readCount} of ${recordTotal} records` })
            ));
        } catch {
            return refuse(`Nothing was restored: the current values of the records could not be read from ${orgLabel}.`);
        }

        if ( !plannedObjects ) {
            return false;
        }

        const restoredObjects = plannedObjects.filter(plannedObject => plannedObject.recordValues.length > 0);
        const missingRecordTotal = plannedObjects.reduce((total, plannedObject) => total + plannedObject.missingRecordCount, 0);

        if ( restoredObjects.length === 0 ) {
            return refuse(`Nothing was restored: none of the records in ${snapshotName} are in ${orgLabel} any more.`);
        }

        const recordTotal = restoredObjects.reduce((total, plannedObject) => total + plannedObject.recordValues.length, 0);

        const restoreWarnings = [
            ...( missingRecordTotal > 0 ? [`${describeRecords(missingRecordTotal)} of the snapshot ${missingRecordTotal === 1 ? 'is' : 'are'} no longer in the org, or not visible to this user, and will not be restored.`] : [] ),
            // AS THE UPDATE SAYS (#418): A RECORD WHOSE RECORD TYPE NO LONGER ALLOWS ITS OLD PICKLIST VALUE IS REJECTED BY THE ORG
            ...( RecipeCockpitDrawnModel.hasRecordTypePicklist(clickedRecipeDataMessage.recipe, restoredObjects, describeOutcomes) ? [RECIPE_COCKPIT_UPDATER_RECORD_TYPE_PICKLIST_NOTE] : [] )
        ];

        const answer = await hub.confirmInPanel(
            `Restore ${describeRecords(recordTotal)} of ${treeTitle} in ${orgLabel}?`,
            {
                summary: [`Back to the values ${snapshotName} saved on ${snapshot.takenAt}.`],
                org: hub.buildConfirmOrg(dataOrgSelection.orgDetail),
                badge: SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail, dataOrgSelection.scratchOrgDetail),
                warnings: restoreWarnings,
                sections: [
                    {
                        title: 'Records and fields',
                        count: restoredObjects.length,
                        lines: restoredObjects.map(plannedObject => `${plannedObject.objectApiName}: ${describeRecords(plannedObject.recordValues.length)} -- ${plannedObject.fieldApiNames.join(', ')}`)
                    },
                    { title: 'How it can be undone', lines: [`Each record is set back by its Id to the value it held when ${snapshotName} was saved, on ${snapshot.takenAt}.`, `The values it holds now are saved first to treecipe/${RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME}/${tree.folderName}/, and nothing is restored if they cannot be.`] }
                ],
                isDestructive: true
            },
            RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL
        );

        if ( answer !== RECIPE_COCKPIT_UPDATER_RESTORE_CONFIRM_LABEL ) {
            return false;
        }

        const allOrNoneSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
        if ( allOrNoneSelection === undefined ) {
            return false;
        }

        const isStillCurrent = hub.recipeCockpitPanel === cockpitPanel
                                && hub.recipeCockpitPanelState === panelState
                                && panelState.recipeDataMessage === clickedRecipeDataMessage
                                && panelState.dataOrgSelection === dataOrgSelection;

        if ( !isStillCurrent ) {
            return refuse(`Nothing was restored: the run or the org selection changed after ${orgLabel} was confirmed.`);
        }

        const orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(connection));
        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was restored in ${orgLabel}: it answered ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}, and the Treecipe Adapter restores only a sandbox or scratch org.`);
        }

        const startedAt = new Date();
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(panelState.workspaceRoot, clickedRecipeDataMessage.recipe, tree);
        // WHAT EACH RECORD HOLDS NOW IN THE FIELDS THIS RESTORE WRITES ON IT, AND IN NO OTHER (#721)
        const currentSnapshotObjects = restoredObjects.map(plannedObject => RecipeCockpitRecordUpdate.buildSnapshotObject(plannedObject.objectApiName, plannedObject.fieldApiNames, plannedObject.currentRecords,
                                                                                                                            snapshotObjects.find(snapshotObject => snapshotObject.objectApiName === plannedObject.objectApiName)?.orgOnlyFieldApiNames,
                                                                                                                            new Map(plannedObject.recordValues.map(recordValue => [recordValue.recordId, Object.keys(recordValue.fieldValues)] as const))));
        const isEveryRecordSaved = restoredObjects.every((plannedObject, objectIndex) => currentSnapshotObjects[objectIndex].records.length === plannedObject.recordValues.length);
        const attemptFiles = isEveryRecordSaved && runArtifactsLocation && RecipeCockpitRecordUpdate.writeSnapshot(runArtifactsLocation, {
            orgUsername: orgUsername,
            treeFolderName: tree.folderName,
            takenAt: startedAt.toISOString(),
            objects: currentSnapshotObjects
        }, startedAt);

        if ( !attemptFiles ) {
            return refuse(RECIPE_COCKPIT_UPDATER_RESTORE_SNAPSHOT_FAILED_REFUSAL);
        }

        const sendResult = await this.sendUpdaterRequests(connection, restoredObjects, currentSnapshotObjects, allOrNoneSelection, treeTitle, orgLabel, 'restoring');

        const isResultsWritten = RecipeCockpitRecordUpdate.writeResults(attemptFiles.resultsFilePath, panelState.workspaceRoot, {
            operation: 'restore',
            restoredFromSnapshotFile: snapshotName,
            orgUsername: orgUsername,
            treeFolderName: tree.folderName,
            snapshotFile: path.basename(attemptFiles.snapshotFilePath),
            startedAt: startedAt.toISOString(),
            allOrNone: allOrNoneSelection,
            outcome: sendResult.outcome,
            updatedRecordCount: sendResult.updatedRecordCount,
            failedRecordCount: sendResult.failedRecordCount,
            missingRecordCount: missingRecordTotal,
            ...( sendResult.putBack ? { putBack: sendResult.putBack } : {} ),
            ...RecipeCockpitDrawnModel.buildOrgOnlyFieldsResult(currentSnapshotObjects),
            objects: sendResult.objectResults
        });

        this.showUpdaterUpdateNotification(sendResult, treeTitle, orgLabel, path.basename(attemptFiles.snapshotFilePath), isResultsWritten ? attemptFiles.resultsFilePath : undefined, panelState.workspaceRoot, 'restore', undefined, runArtifactsLocation);

        return sendResult.isAnyRequestSent;

    }

    /*
        Per snapshot object, the records the org returns now -- one SELECT of the snapshot's fields
        per RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT Ids, every Id a Salesforce Id the parse held
        to its shape -- and the snapshot's values for exactly those, in the snapshot's order. An
        answer with no records list, or one not done in one page, THROWS rather than reading as none;
        a cancel between queries answers undefined.
    */
    static async readUpdaterRestoreTargets(connection: Connection,
                                           snapshotObjects: readonly IUpdateSnapshotObject[],
                                           isCancelled: () => boolean,
                                           reportProgress: (readCount: number) => void): Promise<IRecipeCockpitUpdaterRestoreTarget[] | undefined> {

        const querySource = SalesforceOrgService.toQuerySource(connection);
        const plannedObjects: IRecipeCockpitUpdaterRestoreTarget[] = [];
        let readCount = 0;

        for ( const snapshotObject of snapshotObjects ) {

            const currentRecordsByIdHead = new Map<string, Record<string, unknown>>();

            for ( const requestRecords of RecipeCockpitRecordUpdate.splitIntoRequests(snapshotObject.records) ) {
                if ( isCancelled() ) {
                    return undefined;
                }
                const quotedIds = requestRecords.map(snapshotRecord => `'${snapshotRecord.recordId}'`).join(', ');
                const queryAnswer = await querySource.query(`SELECT Id, ${snapshotObject.fieldApiNames.join(', ')} FROM ${snapshotObject.objectApiName} WHERE Id IN (${quotedIds})`) as { done?: unknown; records?: unknown };
                if ( !queryAnswer || !Array.isArray(queryAnswer.records) || queryAnswer.done === false ) {
                    throw new Error(`The org's answer about its ${snapshotObject.objectApiName} records could not be read.`);
                }
                queryAnswer.records.forEach((currentRecord: unknown) => {
                    const recordId = ( currentRecord as Record<string, unknown> | null )?.Id;
                    if ( typeof recordId === 'string' && recordId.length >= 15 ) {
                        currentRecordsByIdHead.set(recordId.slice(0, 15), currentRecord as Record<string, unknown>);
                    }
                });
                readCount += requestRecords.length;
                reportProgress(readCount);
            }

            const restoredRecords = snapshotObject.records.filter(snapshotRecord => currentRecordsByIdHead.has(snapshotRecord.recordId.slice(0, 15)));
            const currentRecords = restoredRecords.map(snapshotRecord => currentRecordsByIdHead.get(snapshotRecord.recordId.slice(0, 15)) as Record<string, unknown>);

            plannedObjects.push({
                objectApiName: snapshotObject.objectApiName,
                fieldApiNames: [...snapshotObject.fieldApiNames],
                // BY THE ORG'S Id, SO A SET-BACK MATCHES EACH RESULT TO THE SNAPSHOT OF NOW WHATEVER FORM THE FILE HELD
                recordValues: restoredRecords.map((snapshotRecord, recordIndex) => ({ recordId: String(currentRecords[recordIndex].Id), fieldValues: snapshotRecord.fieldValues })),
                currentRecords: currentRecords,
                missingRecordCount: snapshotObject.records.length - restoredRecords.length
            });

        }

        return plannedObjects;

    }

    /*
        Every object's records, parents first, at most RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT per
        PATCH composite/sobjects request, each request built just before it is sent, all-or-none as
        chosen, cancellable between requests. With all-or-none, the first request that fails stops the
        update, and so does a cancel: every record an earlier request updated -- and every record of
        a request that threw or whose answer could not be read, which the org may have saved -- is
        then set back to its snapshot value, each record on its own, behind its own progress. That is
        what all-or-none means across requests, as the tree insert deletes what it inserted.
    */
    static async sendUpdaterRequests(connection: Connection,
                                        plannedObjects: ReadonlyArray<{ objectApiName: string; fieldApiNames: string[]; recordValues: IRecipeCockpitUpdaterRecordValues[] }>,
                                        snapshotObjects: readonly IUpdateSnapshotObject[],
                                        allOrNoneSelection: boolean,
                                        treeTitle: string,
                                        orgLabel: string,
                                        progressVerb: 'updating' | 'restoring' = 'updating'): Promise<IRecipeCockpitUpdaterSendResult> {

        const objectResults: Array<{ objectApiName: string; results: IUpdateRecordResult[] }> = [];
        let outcome: IRecipeCockpitUpdaterSendResult['outcome'] = 'completed';
        let isAnyRequestSent = false;
        const requestTotal = plannedObjects.reduce((total, plannedObject) => total + Math.ceil(plannedObject.recordValues.length / RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT), 0);
        let requestNumber = 0;

        // THE FIRST REQUEST THAT THREW, NAMED WITH ITS ERROR; THE UPDATE'S AND THE SET-BACK'S ARE KEPT APART
        const sendRequest = async (objectApiName: string, requestRecords: IUpdateRequestRecord[], isAllOrNone: boolean, onRequestFailed: (failureDetail: string) => void): Promise<IUpdateRecordResult[]> => {
            try {
                return RecipeCockpitRecordUpdate.readRequestResults(requestRecords, await CollectionsApiService.updateCollectionsApiCallout(requestRecords, connection, isAllOrNone, objectApiName));
            } catch (requestError) {
                const failureMessage = String(( requestError as Error )?.message ?? requestError);
                onRequestFailed(`${objectApiName} failed: ${failureMessage}`);
                return RecipeCockpitRecordUpdate.failRequestRecords(requestRecords, failureMessage);
            }
        };

        let requestFailureDetail: string | undefined;
        const noteRequestFailure = (failureDetail: string) => { requestFailureDetail = requestFailureDetail ?? failureDetail; };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: ${progressVerb} ${treeTitle} in ${orgLabel}`),
            cancellable: true
        }, async (progress, cancellationToken) => {

            for ( const plannedObject of plannedObjects ) {

                const objectResult = { objectApiName: plannedObject.objectApiName, results: [] as IUpdateRecordResult[] };
                objectResults.push(objectResult);

                for ( const requestValues of RecipeCockpitRecordUpdate.splitIntoRequests(plannedObject.recordValues) ) {

                    if ( cancellationToken.isCancellationRequested ) {
                        outcome = 'cancelled';
                        return;
                    }

                    requestNumber++;
                    progress.report({ message: `${plannedObject.objectApiName}: request ${requestNumber} of ${requestTotal}` });
                    isAnyRequestSent = true;
                    const request = RecipeCockpitRecordUpdate.buildRequestRecords(plannedObject.objectApiName, plannedObject.fieldApiNames, requestValues);
                    const results = await sendRequest(plannedObject.objectApiName, request, allOrNoneSelection, noteRequestFailure);
                    objectResult.results.push(...results);

                    if ( allOrNoneSelection && results.some(result => !result.isSuccess) ) {
                        outcome = 'stopped';
                        return;
                    }

                }

            }

        });

        let putBack: IRecipeCockpitUpdaterSendResult['putBack'];

        if ( allOrNoneSelection && outcome !== 'completed' ) {

            const putBackResult: NonNullable<IRecipeCockpitUpdaterSendResult['putBack']> = { putBackRecordCount: 0, failedRecordCount: 0, uncertainRecordCount: 0, objects: [] };
            putBack = putBackResult;
            const noteSetBackFailure = (failureDetail: string) => { putBackResult.requestFailureDetail = putBackResult.requestFailureDetail ?? failureDetail; };

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: setting ${treeTitle} back to its old values in ${orgLabel}`),
                cancellable: false
            }, async () => {

                for ( const objectResult of objectResults ) {

                    // A RECORD THE ORG MAY HAVE SAVED IS SET BACK TOO: WRITING ITS OLD VALUE AGAIN CHANGES NOTHING IF IT WAS NOT
                    const setBackResults = objectResult.results.filter(result => result.isSuccess || result.isUncertain === true);
                    const snapshotObject = snapshotObjects.find(candidateObject => candidateObject.objectApiName === objectResult.objectApiName);
                    if ( setBackResults.length === 0 || !snapshotObject ) {
                        continue;
                    }

                    putBackResult.uncertainRecordCount += setBackResults.filter(result => result.isUncertain === true).length;
                    const snapshotRecords = RecipeCockpitRecordUpdate.selectSnapshotRecords(snapshotObject, new Set(setBackResults.map(result => result.recordId)));
                    const putBackResults: IUpdateRecordResult[] = [];
                    for ( const requestValues of RecipeCockpitRecordUpdate.splitIntoRequests(snapshotRecords) ) {
                        // EACH RECORD ON ITS OWN: ONE THAT CANNOT BE PUT BACK MUST NOT KEEP THE OTHERS FROM IT
                        const request = RecipeCockpitRecordUpdate.buildRequestRecords(snapshotObject.objectApiName, snapshotObject.fieldApiNames, requestValues);
                        putBackResults.push(...await sendRequest(snapshotObject.objectApiName, request, false, noteSetBackFailure));
                    }
                    putBackResult.objects.push({ objectApiName: snapshotObject.objectApiName, results: putBackResults });
                    putBackResult.putBackRecordCount += putBackResults.filter(result => result.isSuccess).length;
                    putBackResult.failedRecordCount += putBackResults.filter(result => !result.isSuccess).length;

                }

            });

        }

        const allResults = objectResults.flatMap(objectResult => objectResult.results);

        return {
            outcome: outcome,
            isAnyRequestSent: isAnyRequestSent,
            updatedRecordCount: allResults.filter(result => result.isSuccess).length,
            failedRecordCount: allResults.filter(result => !result.isSuccess).length,
            objectResults: objectResults,
            ...( putBack ? { putBack: putBack } : {} ),
            ...( requestFailureDetail ? { requestFailureDetail: requestFailureDetail } : {} )
        };

    }

    /*
        How the update ended, as ONE notification (#301): information when every record was updated,
        an ERROR when it stopped, otherwise a warning. "View errors" when a record failed or it
        stopped, "View results" otherwise, opened through showNotificationWithWorkspaceFile; a
        results file that could not be written offers no button. A set-back that included records
        the org may not have saved says so, and an UpdateAttempts folder git does not ignore wholly
        turns it into at least a warning. NOT AWAITED. Escaped whole.
    */
    static showUpdaterUpdateNotification(sendResult: IRecipeCockpitUpdaterSendResult,
                                            treeTitle: string,
                                            orgLabel: string,
                                            snapshotFileName: string,
                                            resultsFilePath: string | undefined,
                                            workspaceRoot: string,
                                            operation: 'update' | 'restore' = 'update',
                                            adaptedRun?: RecipeCockpitAdaptedRunWrite,
                                            runArtifactsLocation?: IRecipeCockpitRunArtifactsLocation) {

        const updatedWord = operation === 'restore' ? 'restored' : 'updated';
        const describeRecords = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;
        const wasOrWere = (recordCount: number) => recordCount === 1 ? 'was' : 'were';
        const putBack = sendResult.putBack;
        const hasErrors = sendResult.failedRecordCount > 0 || sendResult.outcome === 'stopped' || ( putBack?.failedRecordCount ?? 0 ) > 0;
        const updatedText = putBack && putBack.uncertainRecordCount > 0 ? `it had ${updatedWord} or may have ${updatedWord}` : `it had ${updatedWord}`;
        const putBackText = putBack
            ? putBack.failedRecordCount > 0
                ? ` ${describeRecords(putBack.putBackRecordCount)} ${updatedText} ${wasOrWere(putBack.putBackRecordCount)} set back to their old values, and ${describeRecords(putBack.failedRecordCount)} could not be: their old values are in ${snapshotFileName}.`
                : putBack.putBackRecordCount > 0
                    ? ` The ${describeRecords(putBack.putBackRecordCount)} ${updatedText} ${wasOrWere(putBack.putBackRecordCount)} set back to their old values, because all-or-none was chosen.`
                    : ''
            : '';
        let severity: 'information' | 'warning' | 'error' = 'warning';
        let notificationText: string;

        if ( sendResult.outcome === 'cancelled' ) {
            notificationText = `The ${operation} of ${treeTitle} in ${orgLabel} was cancelled after ${describeRecords(sendResult.updatedRecordCount)}.${putBackText}`;
        } else if ( sendResult.outcome === 'stopped' ) {
            severity = 'error';
            notificationText = `The ${operation} of ${treeTitle} in ${orgLabel} stopped at a request that failed: ${describeRecords(sendResult.failedRecordCount)} failed.${putBackText}`;
        } else if ( sendResult.failedRecordCount > 0 ) {
            notificationText = `${describeRecords(sendResult.updatedRecordCount)} of ${treeTitle} ${wasOrWere(sendResult.updatedRecordCount)} ${updatedWord} in ${orgLabel} and ${sendResult.failedRecordCount} failed. Their old values are in ${snapshotFileName}.`;
        } else {
            severity = 'information';
            notificationText = `${describeRecords(sendResult.updatedRecordCount)} of ${treeTitle} ${wasOrWere(sendResult.updatedRecordCount)} ${updatedWord} in ${orgLabel}. Their old values are in ${snapshotFileName}.`;
        }

        if ( sendResult.requestFailureDetail ) {
            notificationText += ` The request for ${sendResult.requestFailureDetail}`;
        }

        if ( putBack?.requestFailureDetail ) {
            notificationText += ` Setting back ${putBack.requestFailureDetail}`;
        }

        if ( !runArtifactsLocation || !RecipeCockpitRunArtifacts.isGitIgnored(runArtifactsLocation) ) {
            notificationText += ` ${RECIPE_COCKPIT_UPDATER_NOT_GIT_IGNORED_NOTE}`;
            severity = severity === 'information' ? 'warning' : severity;
        }

        // THE ADAPTED COPY (#448) IS SAID IN THE SAME NOTIFICATION, WITH ITS TWO BUTTONS; A COPY THAT COULD NOT BE WRITTEN SAYS WHY
        const otherActions: INotificationCommandAction[] = [];
        let adaptedRecipeFilePath: string | undefined;

        if ( adaptedRun && 'refusal' in adaptedRun ) {
            notificationText += ` No adapted data set was written: ${adaptedRun.refusal}`;
            severity = severity === 'information' ? 'warning' : severity;
        }

        if ( adaptedRun && 'datasetFolderPath' in adaptedRun ) {
            const datasetFolderPath = adaptedRun.datasetFolderPath;
            adaptedRecipeFilePath = adaptedRun.adaptedRecipeFilePath;
            notificationText += ` The adapted data set is ${path.basename(datasetFolderPath)}${adaptedRecipeFilePath ? `, and the adapted recipe ${path.basename(adaptedRecipeFilePath)}` : ''}.`;
            if ( adaptedRun.recipeRefusal ) {
                notificationText += ` No adapted recipe was written: ${adaptedRun.recipeRefusal}`;
            }
            // A REQUEST THAT THREW OR ANSWERED UNREADABLY MAY HAVE BEEN SAVED: THE COPY KEEPS THOSE RECORDS' OLD VALUES, WHICH THE ORG MAY NOT HOLD
            const uncertainRecordCount = sendResult.objectResults.reduce((total, objectResult) => total + objectResult.results.filter(recordResult => recordResult.isUncertain).length, 0);
            if ( uncertainRecordCount > 0 ) {
                notificationText += ` ${describeRecords(uncertainRecordCount)} the org may have saved ${uncertainRecordCount === 1 ? 'keeps its' : 'keep their'} old values in the adapted data set, so ${uncertainRecordCount === 1 ? 'it' : 'they'} may not match the org.`;
            }
            otherActions.push({
                label: RECIPE_COCKPIT_ADAPTER_OPEN_DATASET_LABEL,
                run: async () => {
                    if ( SfdxProjectService.isExistingDirectory(datasetFolderPath) && SfdxProjectService.isPathContainedInWorkspace(path.resolve(datasetFolderPath), path.resolve(workspaceRoot)) ) {
                        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(datasetFolderPath));
                    } else {
                        VSCodeWorkspaceService.showWarningMessage('The adapted data set no longer exists in this workspace.');
                    }
                }
            });
        }

        VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(
            severity,
            RecipeYamlScalar.escapeForNotification(notificationText),
            [
                {
                    label: hasErrors ? RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL : RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
                    filePath: resultsFilePath && fs.existsSync(resultsFilePath) ? resultsFilePath : undefined,
                    missingFileText: `The ${operation} results file no longer exists in this workspace.`
                },
                {
                    label: RECIPE_COCKPIT_ADAPTER_OPEN_ADAPTED_RECIPE_LABEL,
                    filePath: adaptedRecipeFilePath,
                    missingFileText: 'The adapted recipe no longer exists in this workspace.'
                }
            ],
            workspaceRoot,
            otherActions
        );

    }

    /*
        One object's generated values (#417), RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE records at a
        time: per run, the one-object recipe the writer builds is written to a temporary folder outside
        the workspace -- never beside the recipe -- run by the recipe's own backend through the same
        processor Run Faker uses, and read back as one record per record asked for. A count that
        differs refuses, so values are never paired with the wrong records. Between runs it yields to
        the extension host and checks for a cancel, so a 50,000-record load neither freezes the host
        nor sends snowfakery past its output buffer in one run.
    */
    static async generateUpdaterObjectValues(hub: IRecipeCockpitHubForAdapterTab, fakerService: 'faker-js' | 'snowfakery',
                                             objectApiName: string,
                                             recordCount: number,
                                             fields: readonly { fieldApiName: string; valueText: string }[],
                                             isCancelled: () => boolean = () => false,
                                             reportProgress: (generatedCount: number) => void = () => undefined,
                                             recipeKind: 'updaterValues' | 'adapterChild' = 'updaterValues'): Promise<{ records: Record<string, unknown>[] } | { refusal: string } | { isCancelled: true }> {

        const records: Record<string, unknown>[] = [];

        while ( records.length < recordCount ) {

            if ( records.length > 0 ) {
                await new Promise(resolve => setImmediate(resolve));
                if ( isCancelled() ) {
                    return { isCancelled: true };
                }
            }

            const chunkCount = Math.min(RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE, recordCount - records.length);
            const chunk = await this.generateUpdaterChunk(hub, fakerService, objectApiName, chunkCount, fields, recipeKind);
            if ( 'refusal' in chunk ) {
                return chunk;
            }
            records.push(...chunk.records);
            reportProgress(records.length);

        }

        return { records: records };

    }

    private static async generateUpdaterChunk(hub: IRecipeCockpitHubForAdapterTab, fakerService: 'faker-js' | 'snowfakery',
                                              objectApiName: string,
                                              recordCount: number,
                                              fields: readonly { fieldApiName: string; valueText: string }[],
                                              recipeKind: 'updaterValues' | 'adapterChild'): Promise<{ records: Record<string, unknown>[] } | { refusal: string }> {

        const recipeBuild = recipeKind === 'adapterChild'
            ? RecipeCockpitRecipeWriter.buildAdapterChildRecipe(objectApiName, recordCount, fields)
            : RecipeCockpitRecipeWriter.buildUpdaterValueRecipe(objectApiName, recordCount, fields);
        if ( recipeBuild.isBuilt === false ) {
            return { refusal: recipeBuild.refusal };
        }

        return RecipeCockpitFakerValueGeneration.generateObjectRecords(this.createUpdaterRecipeProcessor(fakerService), fakerService, objectApiName, recordCount,
                                                                       recipeBuild.recipeText, `${recipeKind}-${objectApiName}.yml`);

    }

}
