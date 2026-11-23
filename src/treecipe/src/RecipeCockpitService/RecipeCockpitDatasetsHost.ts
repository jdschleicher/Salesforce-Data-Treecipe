import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH } from './RecipeCockpitDatasetsTabConstants';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import {
    IOrgTypeDetail,
    IScratchOrgDetail,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import {
    CollectionsApiService,
    INSERT_RESULTS_FILE_MISSING_TEXT
} from '../CollectionsApiService/CollectionsApiService';
import { DatasetInsertAttemptService } from '../DatasetInsertAttemptService/DatasetInsertAttemptService';
import {
    DATASET_COLLECTIONS_API_FOLDER_NAME,
    DatasetSourceService,
    ILegacyRecordCountResult
} from '../DatasetSourceService/DatasetSourceService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import {
    IRecipeCockpitDatasetLastInsertViewModel,
    IRecipeCockpitDatasetRecordCountViewModel,
    IRecipeCockpitTreeDatasetViewModel,
    RecipeCockpitTreeHistory
} from './RecipeCockpitTreeHistory';
import { ORG_OPERATIONS_FOLDER_NAME } from '../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    RecipeCockpitRunHistory,
    RUN_HISTORY_STEP_LABELS,
    RunHistoryRowStatus
} from './RecipeCockpitRunHistory';
import {
    DATASET_JOURNEY_ENTRY_LIMIT,
    DatasetJourneyEntryKind,
    RecipeCockpitDatasetJourney
} from './RecipeCockpitDatasetJourney';
import { RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL } from './RecipeCockpitNavigationConstants';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForDatasetsTab
import type { IRecipeCockpitHubForTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import type { RecipeCockpitService } from './RecipeCockpitService';
import type {
    IRecipeCockpitInsertStateMessage,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeDataMessage,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeFocus,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitWorkspaceState
} from './RecipeCockpitViewModel';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';
import { RecipeCockpitTreeSelectionStore } from './RecipeCockpitTreeSelectionStore';

/*
    The Previously Used Data Sets tab's host half (moved out of the hub by #667, after #665's pattern):
    the messages it answers and the actions they route to, a data set row's insert, its record counts
    and last insert, its journey, and the names and favourites the reader keeps for it. The host stages
    PENDING allow-list entries for what it posts and narrows the active ones it replaces; only the hub
    promotes pending to active, on the panel's acks. The insert lock lives on the hub's panel state,
    which the hub replays to a reloaded panel: a row's insert takes it and releases it, and a tree
    insert holds the same lock.
*/

/*
    What the tab reads and calls on the hub, and nothing else: the hub class itself, narrowed to these
    names and read-only, so a read after an await sees the panel and state open now.
*/
export type IRecipeCockpitHubForDatasetsTab = Readonly<Pick<typeof RecipeCockpitService,
    'buildConfirmOrg' |
    'confirmInPanel' |
    'isSelectionHeldByPromptOrUpdater' |
    'isUsableWorkspacePath' |
    'loadRecipeIntoPanel' |
    'postNameEditResult' |
    'postToPanel' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'recipeCockpitWorkspaceState' |
    'resolveTreeSnapshotLocations' |
    'toDisplayedRelativePath'>> & IRecipeCockpitHubForTreecipeDataOrgs;

// WHAT workspaceState HOLDS FOR THE DATA SET ROWS, BY DATA SET FOLDER NAME; NEITHER IS A PLAIN {}
export interface IRecipeCockpitDatasetPreferences {
    customNamesByFolderName: Map<string, string>;
    favoriteFolderNames: Set<string>;
}

/*
    A data set's newest insert after a row's own Insert… ran (#469): its chip and View results on every
    card that lists it, redrawn in place. updateSequence is echoed in "partialRendered", which is
    what offers the new View results, as it does for a datasetAdded (#226). No lastInsert: none.
*/
export interface IRecipeCockpitDatasetLastInsertMessage {
    command: 'datasetLastInsert';
    renderSequence: number;
    updateSequence: number;
    datasetFolderName: string;
    lastInsert?: IRecipeCockpitDatasetLastInsertViewModel;
}

// A DATA SET'S NAME OR FAVORITE CHANGED: ITS ROW ON EVERY CARD THAT LISTS IT, REDRAWN IN PLACE
export interface IRecipeCockpitDatasetPreferencesMessage {
    command: 'datasetPreferences';
    renderSequence: number;
    datasetFolderName: string;
    customName?: string;
    isFavorite: boolean;
}

// A LEGACY DATA SET'S RECORD COUNTS, READ FROM ITS COLLECTIONS API FILES WHEN IT WAS EXPANDED
export interface IRecipeCockpitDatasetRecordCountsMessage {
    command: 'datasetRecordCounts';
    datasetFolderName: string;
    recordCounts: IRecipeCockpitDatasetRecordCountViewModel[];
    failureMessage: string;
    renderSequence: number;
}

/*
    One entry of a data set's insert journey (#471): an insert attempt or a Troubleshooting step of
    its tree. relativePath is the file's place in the workspace, shown as text beside "View file";
    a file is opened by its index in the host-only list kept for this message, never by a path.
*/
export interface IRecipeCockpitDatasetJourneyEntryViewModel {
    kind: DatasetJourneyEntryKind;
    kindLabel: string;
    status: RunHistoryRowStatus;
    timeLabel: string;
    orgLabel?: string;
    summaryText: string;
    errorExcerpt?: string;
    files: Array<{ fileIndex: number; relativePath: string }>;
}

/*
    A data set's journey, read when its row is first expanded. renderSequence names the model it was
    read for, and the panel drops it for any other; journeySequence is echoed by the panel's
    "datasetJourneyRendered", and only that ack opens these entries' files.
*/
export interface IRecipeCockpitDatasetJourneyMessage {
    command: 'datasetJourney';
    renderSequence: number;
    datasetFolderName: string;
    journeySequence: number;
    attemptCount: number;
    entries: IRecipeCockpitDatasetJourneyEntryViewModel[];
    hiddenEntryCount: number;
    otherOrgStepCount: number;
    untrackedStepCount: number;
}

/*
    One data set an action just wrote, posted IN PLACE of a reload (#226): the cards it joins, its
    history row. How an insert went is its notification's (#301), never the panel's. renderSequence
    names the model it was added to, and the panel drops it for any other. updateSequence is this
    post's own number, echoed back in "partialRendered" once the row is drawn: only that
    acknowledgement makes the new row's Open and Insert… usable, as "rendered" does for a model.
*/
export interface IRecipeCockpitDatasetAddedMessage {
    command: 'datasetAdded';
    treeKeys: string[];
    dataset: IRecipeCockpitTreeDatasetViewModel;
    renderSequence: number;
    updateSequence: number;
}

/*
    A data set's own name and favorite, kept in workspaceState by its FOLDER NAME under
    FakeDataSets/ -- unique there, since a same-second folder takes a -<n> suffix -- so a data set
    keeps both however many cards list it and across every reload.
*/
export const RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY = 'treecipe.recipeCockpit.datasetPreferences';
export const RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION = 1;
export const RECIPE_COCKPIT_DATASET_JOURNEY_INSERT_LABEL = 'Insert';
export const RECIPE_COCKPIT_DATASET_JOURNEY_FILE_GONE_TEXT = 'That file no longer exists in this workspace.';
// A DATA SET ROW'S Insert… (#541): THE TARGET ORG MANAGER'S SELECTION, CONFIRMED IN THE PANEL
export const RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL = 'Insert';
export const RECIPE_COCKPIT_DATASET_INSERT_ORG_PLACEHOLDER = 'Select the sandbox or scratch org to insert this data set into';
export const RECIPE_COCKPIT_DATASET_INSERT_REFUSAL_PREFIX = 'Nothing was inserted';
export const RECIPE_COCKPIT_DATASET_INSERT_SANDBOX_ONLY_REASON = 'the Recipe Cockpit inserts a data set only into a sandbox or scratch org';
export const RECIPE_COCKPIT_DATASET_INSERT_BUSY_REFUSAL = 'Nothing was inserted: a scratch org run, a permission set assignment, a metadata deploy, an org prompt or a Treecipe Adapter update holds the org selection. Try again when it has finished.';
export const RECIPE_COCKPIT_DATASET_INSERT_NO_ORG_REFUSAL = 'Nothing was inserted: choose a sandbox or scratch org in the Target Org Manager first.';
export const RECIPE_COCKPIT_DATASET_INSERT_SELECTION_CHANGED_REFUSAL = 'Nothing was inserted: the org selected in the Target Org Manager changed. Choose Insert… again.';
export const RECIPE_COCKPIT_DATASET_INSERT_NOT_SANDBOX_REFUSAL = 'Nothing was inserted: the org selected in the Target Org Manager has not answered that it is a sandbox or scratch org. Choose a sandbox or scratch org there.';

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_DATASETS_COMMANDS = [
    'loadDatasetRecordCounts',
    'viewDatasetInsertResults',
    'openDataset',
    'insertDataset',
    'renameDataset',
    'toggleFavoriteDataset',
    'loadDatasetJourney',
    'openDatasetJourneyFile'
] as const;

export const RECIPE_COCKPIT_DATASETS_ACTION_KINDS = [
    'loadDatasetRecordCounts',
    'viewDatasetInsertResults',
    'openDataset',
    'insertDataset',
    'refuseDatasetInsert',
    'renameDataset',
    'toggleFavoriteDataset',
    'loadDatasetJourney',
    'openDatasetJourneyFile'
] as const;

// THE TAB'S ACTION WHOSE CONFIRMATION OFFERS "Change org…" (#480): A DATA SET ROW'S INSERT
export const RECIPE_COCKPIT_DATASETS_ORG_CHANGE_ACTION_KINDS = [
    'insertDataset'
] as const;

export type RecipeCockpitDatasetsPanelAction =
    | { kind: 'loadDatasetRecordCounts'; datasetFolderName: string; datasetFolderPath: string; renderSequence: number }
    | { kind: 'viewDatasetInsertResults'; resultsFilePath: string }
    | { kind: 'openDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'insertDataset'; datasetFolderName: string; datasetFolderPath: string; isOrgToPrompt: boolean; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'refuseDatasetInsert'; refusalText: string }
    | { kind: 'renameDataset'; datasetFolderName: string; name: string; renderSequence: number }
    | { kind: 'toggleFavoriteDataset'; datasetFolderName: string }
    | { kind: 'loadDatasetJourney'; datasetFolderName: string }
    | { kind: 'openDatasetJourneyFile'; filePath: string };

export class RecipeCockpitDatasetsHost {

    static isDatasetsCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_DATASETS_COMMANDS.some(datasetsCommand => datasetsCommand === command);
    }

    static isDatasetsPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitDatasetsPanelAction {
        return RECIPE_COCKPIT_DATASETS_ACTION_KINDS.some(datasetsActionKind => datasetsActionKind === panelAction.kind);
    }

    /*
        PURE, LIKE THE HUB'S ROUTER IT IS PART OF: the hub's checks it reads are functions of the state
        passed. An insert asked for while another insert runs answers the hub's postInsertState, since
        the data set insert and the tree insert hold the one insert lock.
    */
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForDatasetsTab): RecipeCockpitDatasetsPanelAction | { kind: 'postInsertState'; hostMessage: IRecipeCockpitInsertStateMessage } | undefined {

        switch ( panelMessage.command ) {

            /*
                The data sets tab posts NAMES -- a data set folder -- and each is matched against its
                own allow-list drawn from the confirmed-drawn model, then resolved through a map the
                HOST built. No path the panel could post is ever read.
            */
            case 'loadDatasetRecordCounts': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.countableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

                return datasetFolderPath
                    ? { kind: 'loadDatasetRecordCounts', datasetFolderName: datasetFolderName, datasetFolderPath: datasetFolderPath, renderSequence: panelState.recipeDataMessage.renderSequence }
                    : undefined;

            }

            // THE RESULTS FILE OF A DATA SET'S NEWEST INSERT (#469): A NAME THE DRAWN ROW OFFERS, RESOLVED THROUGH THE HOST'S OWN MAP
            case 'viewDatasetInsertResults': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.treeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const resultsFilePath = panelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.get(datasetFolderName);

                return resultsFilePath ? { kind: 'viewDatasetInsertResults', resultsFilePath: resultsFilePath } : undefined;

            }

            case 'openDataset': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.treeHistoryAllowLists.openableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

                if ( !datasetFolderPath ) {
                    return undefined;
                }

                const focusTree = this.readTreeFocus(panelMessage, panelState);

                return {
                    kind: 'openDataset',
                    datasetFolderName: datasetFolderName,
                    datasetFolderPath: datasetFolderPath,
                    ...( focusTree ? { focusTree: focusTree } : {} )
                };

            }

            /*
                A data set row's Insert… (#541) inserts into the Target Org Manager selection, never
                through Insert Data Set by Directory's own picker. The panel posts the selection's
                INDEX, which must still be the selection, name the same username and have answered it
                is a sandbox; with no selection and no index the org is asked for once. Inserts are
                one per window, like the tree insert, and nothing is inserted while another run holds
                the selection.
            */
            case 'insertDataset': {

                const { datasetFolderName, orgIndex } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                if ( typeof datasetFolderName !== 'string' || !panelState.treeHistoryAllowLists.insertableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

                if ( !datasetFolderPath || !panelState.recipeDataMessage ) {
                    return undefined;
                }

                // A RELOADED DOCUMENT MAY NOT KNOW AN INSERT IS RUNNING: IT IS TOLD, AND THE INSERT'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.insertStateMessage ) {
                    return { kind: 'postInsertState', hostMessage: panelState.insertStateMessage };
                }

                if ( panelState.scratchOrgStateMessage?.isRunning
                        || hub.isSelectionHeldByPromptOrUpdater(panelState)
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseDatasetInsert', refusalText: RECIPE_COCKPIT_DATASET_INSERT_BUSY_REFUSAL };
                }

                const focusTree = this.readTreeFocus(panelMessage, panelState);
                const datasetInsert = {
                    kind: 'insertDataset' as const,
                    datasetFolderName: datasetFolderName,
                    datasetFolderPath: datasetFolderPath,
                    ...( focusTree ? { focusTree: focusTree } : {} )
                };

                if ( orgIndex === undefined || orgIndex === null ) {
                    // THE OBJECTS A SELECTION CHECKS ARE THE CONFIRMED-DRAWN MODEL'S, AS FOR A PICK IN THE DROPDOWN
                    if ( dataOrgSelection ) {
                        return { kind: 'refuseDatasetInsert', refusalText: RECIPE_COCKPIT_DATASET_INSERT_SELECTION_CHANGED_REFUSAL };
                    }
                    return panelState.dataOrgObjectApiNames.size > 0
                        ? { ...datasetInsert, isOrgToPrompt: true }
                        : { kind: 'refuseDatasetInsert', refusalText: RECIPE_COCKPIT_DATASET_INSERT_NO_ORG_REFUSAL };
                }

                if ( typeof orgIndex !== 'number'
                        || !Number.isInteger(orgIndex)
                        || !dataOrgSelection
                        || dataOrgSelection.orgIndex !== orgIndex
                        || panelState.dataOrgDetails[orgIndex]?.username !== dataOrgSelection.orgDetail.username ) {
                    return { kind: 'refuseDatasetInsert', refusalText: RECIPE_COCKPIT_DATASET_INSERT_SELECTION_CHANGED_REFUSAL };
                }

                if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {
                    return { kind: 'refuseDatasetInsert', refusalText: RECIPE_COCKPIT_DATASET_INSERT_NOT_SANDBOX_REFUSAL };
                }

                return { ...datasetInsert, isOrgToPrompt: false };

            }

            /*
                A data set row's ☆ posts its FOLDER NAME, matched against the rows the
                confirmed-drawn model listed; its inline rename adds the name and the model, as a card's.
            */
            case 'renameDataset':
            case 'toggleFavoriteDataset': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                if ( panelMessage.command === 'toggleFavoriteDataset' ) {
                    return { kind: 'toggleFavoriteDataset', datasetFolderName: datasetFolderName };
                }

                const { name, renderSequence } = panelMessage;

                if ( typeof name !== 'string' || name.length > RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH
                        || renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return undefined;
                }

                return { kind: 'renameDataset', datasetFolderName: datasetFolderName, name: name, renderSequence: renderSequence as number };

            }

            // A DATA SET'S JOURNEY (#471) READS LOCAL FILES AND NOTHING ELSE, SO IT IS ANSWERED WHATEVER ELSE RUNS
            case 'loadDatasetJourney': {

                const { datasetFolderName, renderSequence } = panelMessage;

                if ( typeof datasetFolderName !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                return { kind: 'loadDatasetJourney', datasetFolderName: datasetFolderName };

            }

            // A JOURNEY ENTRY'S FILE BY ITS INDEX IN THE ENTRIES THE PANEL ACKNOWLEDGED: NEVER A PATH, AND NOTHING FOR AN OLDER LIST
            case 'openDatasetJourneyFile': {

                const { datasetFolderName, journeySequence, fileIndex } = panelMessage;
                const activeFiles = typeof datasetFolderName === 'string' ? panelState.journeyFiles.get(datasetFolderName) : undefined;

                if ( !activeFiles
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || journeySequence !== activeFiles.journeySequence
                        || typeof fileIndex !== 'number'
                        || !Number.isInteger(fileIndex)
                        || fileIndex < 0
                        || fileIndex >= activeFiles.filePaths.length ) {
                    return undefined;
                }

                return { kind: 'openDatasetJourneyFile', filePath: activeFiles.filePaths[fileIndex] };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitDatasetsPanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'loadDatasetRecordCounts':

                this.postDatasetRecordCounts(hub, cockpitPanel, panelState, panelAction.datasetFolderName, panelAction.datasetFolderPath, panelAction.renderSequence);
                return;

            case 'viewDatasetInsertResults':

                // CHECKED AGAIN ON THE CLICK: THE FILE CAN BE MOVED OR DELETED WHILE THE ROW IS ON SCREEN
                await VSCodeWorkspaceService.openWorkspaceResultFile(panelAction.resultsFilePath, panelState.workspaceRoot, INSERT_RESULTS_FILE_MISSING_TEXT);
                return;

            case 'openDataset': {

                if ( !hub.isUsableWorkspacePath(panelAction.datasetFolderPath, panelState.workspaceRoot) ) {
                    await this.refreshAfterMissingDataset(hub, cockpitPanel, panelState, panelAction.datasetFolderName, panelAction.focusTree);
                    return;
                }

                await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(panelAction.datasetFolderPath));
                return;

            }

            case 'insertDataset':

                await this.insertDatasetIntoOrg(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'refuseDatasetInsert':

                VSCodeWorkspaceService.showWarningMessage(panelAction.refusalText);
                return;

            case 'renameDataset':

                await this.renameDataset(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'toggleFavoriteDataset': {

                const datasetPreferences = this.readDatasetPreferences(hub, hub.recipeCockpitWorkspaceState);

                if ( datasetPreferences.favoriteFolderNames.has(panelAction.datasetFolderName) ) {
                    datasetPreferences.favoriteFolderNames.delete(panelAction.datasetFolderName);
                } else {
                    datasetPreferences.favoriteFolderNames.add(panelAction.datasetFolderName);
                }

                await this.saveAndPostDatasetPreferences(hub, cockpitPanel, panelState, panelAction.datasetFolderName, datasetPreferences);
                return;

            }

            case 'loadDatasetJourney':

                this.postDatasetJourney(hub, cockpitPanel, panelState, panelAction.datasetFolderName);
                return;

            case 'openDatasetJourneyFile':

                await VSCodeWorkspaceService.openWorkspaceResultFile(panelAction.filePath, panelState.workspaceRoot, RECIPE_COCKPIT_DATASET_JOURNEY_FILE_GONE_TEXT);
                return;

        }

    }

    // THE DATA SET ROWS' NAMES AND FAVORITES, READ AND CHECKED BY THE SAME RULE AS THE CARDS'
    static readDatasetPreferences(hub: IRecipeCockpitHubForDatasetsTab, workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitDatasetPreferences {

        return RecipeCockpitTreeSelectionStore.readNamePreferences(workspaceState, RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION,
            trimmedName => this.describeDatasetNameProblem(hub, trimmedName));

    }

    static async writeDatasetPreferences(hub: IRecipeCockpitHubForDatasetsTab, workspaceState: IRecipeCockpitWorkspaceState | undefined, datasetPreferences: IRecipeCockpitDatasetPreferences): Promise<boolean> {

        return RecipeCockpitTreeSelectionStore.writeNamePreferences(workspaceState, RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION, datasetPreferences, 'data set');

    }

    private static describeDatasetNameProblem(hub: IRecipeCockpitHubForDatasetsTab, trimmedName: string): string | undefined {

        return RecipeCockpitTreeSelectionStore.describeCustomNameProblem(trimmedName, 'A data set name', RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH);

    }

    /*
        What the input box says is wrong with a data set's name. An empty name clears it. A
        name is unique against every OTHER data set's name in the workspace and every other row's
        folder name on screen, trimmed and without case: two rows a reader cannot tell apart are
        what a name exists to prevent.
    */
    static validateDatasetName(hub: IRecipeCockpitHubForDatasetsTab, candidateName: string,
                                datasetFolderName: string,
                                datasetPreferences: IRecipeCockpitDatasetPreferences,
                                trees: IRecipeCockpitTreeViewModel[]): string | undefined {

        const trimmedName = candidateName.trim();

        if ( trimmedName === '' ) {
            return undefined;
        }

        const namingProblem = this.describeDatasetNameProblem(hub, trimmedName);

        if ( namingProblem ) {
            return namingProblem;
        }

        const comparableName = trimmedName.toLowerCase();
        const otherNames: string[] = [];

        datasetPreferences.customNamesByFolderName.forEach((customName, namedFolderName) => {
            if ( namedFolderName !== datasetFolderName ) { otherNames.push(customName); }
        });

        trees.forEach(tree => (tree.history?.datasets ?? [])
            .filter(dataset => dataset.datasetFolderName !== datasetFolderName)
            .forEach(dataset => otherNames.push(dataset.datasetFolderName, dataset.customName ?? '')));

        return otherNames.some(otherName => otherName.trim().toLowerCase() === comparableName)
            ? 'Another data set already has that name.'
            : undefined;

    }

    // THE NAMES AND FAVORITES ONTO EVERY DATA SET ROW OF EVERY CARD, IN PLACE
    static applyDatasetPreferences(trees: IRecipeCockpitTreeViewModel[], datasetPreferences: IRecipeCockpitDatasetPreferences): IRecipeCockpitTreeViewModel[] {

        trees.forEach(tree => (tree.history?.datasets ?? []).forEach(dataset => this.applyPreferencesToDataset(dataset, datasetPreferences)));

        return trees;

    }

    static applyPreferencesToDataset(dataset: IRecipeCockpitTreeDatasetViewModel, datasetPreferences: IRecipeCockpitDatasetPreferences) {

        delete dataset.customName;
        delete dataset.isFavorite;

        const customName = datasetPreferences.customNamesByFolderName.get(dataset.datasetFolderName);

        if ( customName !== undefined ) {
            dataset.customName = customName;
        }

        if ( datasetPreferences.favoriteFolderNames.has(dataset.datasetFolderName) ) {
            dataset.isFavorite = true;
        }

    }

    static buildDatasetPreferencesMessage(datasetFolderName: string,
                                            datasetPreferences: IRecipeCockpitDatasetPreferences,
                                            renderSequence: number): IRecipeCockpitDatasetPreferencesMessage {

        const customName = datasetPreferences.customNamesByFolderName.get(datasetFolderName);

        return {
            command: 'datasetPreferences',
            renderSequence: renderSequence,
            datasetFolderName: datasetFolderName,
            ...( customName !== undefined ? { customName: customName } : {} ),
            isFavorite: datasetPreferences.favoriteFolderNames.has(datasetFolderName)
        };

    }

    // A DATA SET'S NAME, TYPED IN ITS ROW'S INLINE BOX (#551) AND CHECKED AS A CARD'S IS, ON THE PREFERENCES AS THEY ARE NOW
    private static async renameDataset(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        renameAction: Extract<RecipeCockpitDatasetsPanelAction, { kind: 'renameDataset' }>) {

        const { datasetFolderName, name, renderSequence } = renameAction;
        const datasetPreferences = this.readDatasetPreferences(hub, hub.recipeCockpitWorkspaceState);
        const namingProblem = this.validateDatasetName(hub, name, datasetFolderName, datasetPreferences, panelState.recipeDataMessage?.recipe.trees ?? []);

        if ( namingProblem ) {
            hub.postNameEditResult(cockpitPanel, panelState, { nameTarget: 'dataset', nameKey: datasetFolderName, name: name, renderSequence: renderSequence }, namingProblem);
            return;
        }

        const trimmedName = name.trim();

        if ( trimmedName === '' ) {
            datasetPreferences.customNamesByFolderName.delete(datasetFolderName);
        } else {
            datasetPreferences.customNamesByFolderName.set(datasetFolderName, trimmedName);
        }

        const isWritten = await this.saveAndPostDatasetPreferences(hub, cockpitPanel, panelState, datasetFolderName, datasetPreferences);

        hub.postNameEditResult(cockpitPanel, panelState, { nameTarget: 'dataset', nameKey: datasetFolderName, name: name, renderSequence: renderSequence }, isWritten ? undefined : RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL);

    }

    // WRITTEN, PUT ON THE STORED MODEL A REVEAL REPLAYS, THEN POSTED FOR THE ONE DATA SET, TAGGED WITH THE MODEL IT IS ABOUT
    private static async saveAndPostDatasetPreferences(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        datasetFolderName: string,
                                                        datasetPreferences: IRecipeCockpitDatasetPreferences): Promise<boolean> {

        const isWritten = await this.writeDatasetPreferences(hub, hub.recipeCockpitWorkspaceState, datasetPreferences);

        if ( !isWritten || hub.recipeCockpitPanel !== cockpitPanel || hub.recipeCockpitPanelState !== panelState || !panelState.recipeDataMessage ) {
            return isWritten;
        }

        const recipeDataMessage = panelState.recipeDataMessage;
        this.applyDatasetPreferences(recipeDataMessage.recipe.trees, datasetPreferences);

        hub.postToPanel(cockpitPanel, this.buildDatasetPreferencesMessage(datasetFolderName, datasetPreferences, recipeDataMessage.renderSequence));

        return true;

    }

    /*
        A data set deleted (or moved out of the workspace) after the model was drawn. The reader is
        told, and the run on screen is reloaded, so the history it shows is what is on disk -- with
        the card and tab they acted from re-opened.
    */
    private static async refreshAfterMissingDataset(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        datasetFolderName: string,
                                                        focusTree?: IRecipeCockpitTreeFocus) {

        VSCodeWorkspaceService.showWarningMessage(`The data set "${RecipeYamlScalar.escapeForNotification(datasetFolderName)}" no longer exists in this workspace. The Recipe Cockpit has reloaded its data sets.`);

        // ONLY A RENDERED MODEL'S HISTORY OFFERS A DATA SET, SO THERE IS ALWAYS A RUN ON SCREEN TO RELOAD
        const selectedRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;

        if ( hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState ) {
            await hub.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, selectedRunFolderName, focusTree);
        }

    }

    private static postDatasetRecordCounts(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            datasetFolderName: string,
                                            datasetFolderPath: string,
                                            renderSequence: number) {

        const isUsable = hub.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot);
        // THE SUBFOLDER IS READ TOO, AND A SYMLINK THERE WOULD READ FILES OUTSIDE THE WORKSPACE THE FOLDER'S OWN CHECK APPROVED
        const collectionsApiFolderPath = path.join(datasetFolderPath, DATASET_COLLECTIONS_API_FOLDER_NAME);
        const isCollectionsApiFolderContained = !fs.existsSync(collectionsApiFolderPath)
                                                || hub.isUsableWorkspacePath(collectionsApiFolderPath, panelState.workspaceRoot);
        const legacyRecordCounts = isUsable && isCollectionsApiFolderContained
            ? DatasetSourceService.countLegacyRecordsByObject(datasetFolderPath)
            : { recordCountsByObject: Object.create(null), unreadableFileNames: [] };

        const failureMessage = !isUsable
            ? 'This data set is no longer in the workspace.'
            : !isCollectionsApiFolderContained
                ? 'This data set\'s Collections API folder resolves outside the workspace, so its records were not counted.'
            : legacyRecordCounts.unreadableFileNames.length > 0
                ? `Could not count the records in ${legacyRecordCounts.unreadableFileNames.join(', ')}.`
                : '';

        hub.postToPanel(cockpitPanel, {
            command: 'datasetRecordCounts',
            datasetFolderName: datasetFolderName,
            recordCounts: RecipeCockpitTreeHistory.toRecordCountViewModels(legacyRecordCounts.recordCountsByObject),
            failureMessage: failureMessage,
            renderSequence: renderSequence
        });

    }

    private static datasetJourneySequence = 0;

    /*
        A data set's insert journey (#471), read when its row is first expanded: its attempts and its
        tree's Troubleshooting steps from every run's RunArtifacts (the run on screen first), oldest
        first and capped. The data set folder is resolved from the host-only map built with the model
        and held to the workspace again; the file paths stay on the host as a PENDING list that only
        the panel's ack of these entries opens. A data set on no card with a folder lists no steps.
    */
    private static postDatasetJourney(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, datasetFolderName: string) {

        const recipeDataMessage = panelState.recipeDataMessage;
        const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

        if ( !recipeDataMessage ) {
            return;
        }

        // A DATA SET GONE SINCE THE MODEL WAS DRAWN STILL GETS AN ANSWER, SO ITS ROW DOES NOT STAY ON THE LOADING NOTE
        if ( !datasetFolderPath || !hub.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot) ) {
            const emptyJourneyMessage: IRecipeCockpitDatasetJourneyMessage = {
                command: 'datasetJourney',
                renderSequence: recipeDataMessage.renderSequence,
                datasetFolderName: datasetFolderName,
                journeySequence: ++this.datasetJourneySequence,
                attemptCount: 0,
                entries: [],
                hiddenEntryCount: 0,
                otherOrgStepCount: 0,
                untrackedStepCount: 0
            };
            panelState.pendingJourneyFiles.set(datasetFolderName, { journeySequence: emptyJourneyMessage.journeySequence, filePaths: [] });
            hub.postToPanel(cockpitPanel, emptyJourneyMessage);
            return;
        }

        const legacyOrgOperationsFolderPath = path.join(panelState.workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME);
        const tree = recipeDataMessage.recipe.trees.find(recipeTree => !!recipeTree.folderName
            && !!recipeTree.history?.datasets.some(dataset => dataset.datasetFolderName === datasetFolderName));
        const treeLocations = tree ? hub.resolveTreeSnapshotLocations(panelState.workspaceRoot, recipeDataMessage.recipe, tree) : [];
        const journey = RecipeCockpitDatasetJourney.buildJourney(
            datasetFolderPath,
            treeLocations,
            hub.isUsableWorkspacePath(legacyOrgOperationsFolderPath, panelState.workspaceRoot) ? legacyOrgOperationsFolderPath : undefined,
            DATASET_JOURNEY_ENTRY_LIMIT
        );
        const filePaths: string[] = [];
        const journeyMessage: IRecipeCockpitDatasetJourneyMessage = {
            command: 'datasetJourney',
            renderSequence: recipeDataMessage.renderSequence,
            datasetFolderName: datasetFolderName,
            journeySequence: ++this.datasetJourneySequence,
            attemptCount: journey.attemptCount,
            entries: journey.entries.map(entry => {
                const orgLabel = entry.orgAlias !== undefined && entry.orgUsername !== undefined
                    ? `${entry.orgAlias} · ${entry.orgUsername}`
                    : entry.orgAlias ?? entry.orgUsername;
                return {
                    kind: entry.kind,
                    kindLabel: entry.kind === 'insert' ? RECIPE_COCKPIT_DATASET_JOURNEY_INSERT_LABEL : RUN_HISTORY_STEP_LABELS[entry.kind],
                    status: entry.status,
                    timeLabel: RecipeCockpitRunHistory.formatTimeLabel(entry.timeMs),
                    ...( orgLabel !== undefined ? { orgLabel: orgLabel } : {} ),
                    summaryText: entry.summaryText,
                    ...( entry.errorExcerpt !== undefined ? { errorExcerpt: entry.errorExcerpt } : {} ),
                    files: entry.filePaths
                        .filter(filePath => hub.isUsableWorkspacePath(filePath, panelState.workspaceRoot))
                        .map(filePath => ({ fileIndex: filePaths.push(filePath) - 1, relativePath: hub.toDisplayedRelativePath(panelState.workspaceRoot, filePath) }))
                };
            }),
            hiddenEntryCount: journey.hiddenEntryCount,
            otherOrgStepCount: journey.otherOrgStepCount,
            untrackedStepCount: journey.untrackedStepCount
        };

        panelState.pendingJourneyFiles.set(datasetFolderName, { journeySequence: journeyMessage.journeySequence, filePaths: filePaths });
        hub.postToPanel(cockpitPanel, journeyMessage);

    }

    /*
        A row's Insert… finished (#469): its data set's newest insert, read again, in place of a
        reload that would drop the org selection. Only over the model the click was made on. The
        stored model, every card's copy and the results file target change together; View results
        leaves the ACTIVE list until "partialRendered" says the row is redrawn, so it never opens a
        file the row on screen does not name.
    */
    static postDatasetLastInsert(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                    panelState: IRecipeCockpitPanelState,
                                    recipeDataMessageAtClick: IRecipeCockpitRecipeDataMessage | undefined,
                                    datasetFolderName: string,
                                    datasetFolderPath: string): boolean {

        const recipeDataMessage = panelState.recipeDataMessage;

        if ( !recipeDataMessage || recipeDataMessage !== recipeDataMessageAtClick ) {
            return false;
        }

        const lastInsertRead = DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath);
        const resultsFilePath = lastInsertRead?.resultsFilePath !== undefined && hub.isUsableWorkspacePath(lastInsertRead.resultsFilePath, panelState.workspaceRoot)
            ? lastInsertRead.resultsFilePath
            : undefined;
        const lastInsert = lastInsertRead
            ? RecipeCockpitTreeHistory.toLastInsertViewModel(resultsFilePath !== undefined ? lastInsertRead : { lastInsert: lastInsertRead.lastInsert })
            : undefined;

        recipeDataMessage.recipe.trees.forEach(tree => tree.history?.datasets
            .filter(dataset => dataset.datasetFolderName === datasetFolderName)
            .forEach(dataset => {
                if ( lastInsert ) {
                    dataset.lastInsert = lastInsert;
                } else {
                    delete dataset.lastInsert;
                }
            }));

        if ( resultsFilePath !== undefined ) {
            panelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.set(datasetFolderName, resultsFilePath);
        } else {
            panelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.delete(datasetFolderName);
        }

        panelState.pendingTreeHistoryAllowLists = RecipeCockpitDrawnModel.cloneTreeHistoryAllowLists(panelState.pendingTreeHistoryAllowLists);
        panelState.treeHistoryAllowLists = RecipeCockpitDrawnModel.cloneTreeHistoryAllowLists(panelState.treeHistoryAllowLists);
        panelState.treeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.delete(datasetFolderName);
        if ( resultsFilePath !== undefined ) {
            panelState.pendingTreeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.add(datasetFolderName);
        } else {
            panelState.pendingTreeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.delete(datasetFolderName);
        }

        const lastInsertMessage: IRecipeCockpitDatasetLastInsertMessage = {
            command: 'datasetLastInsert',
            renderSequence: recipeDataMessage.renderSequence,
            updateSequence: ++panelState.datasetUpdateSequence,
            datasetFolderName: datasetFolderName,
            ...( lastInsert ? { lastInsert } : {} )
        };

        hub.postToPanel(cockpitPanel, lastInsertMessage);

        return true;

    }

    /*
        Adds one data set an action just wrote to the model on screen, IN PLACE of a reload (#226):
        to the STORED model, so a reveal's replay draws it, and to the panel through datasetAdded.
        Its row's names go into a COPY of the pending history allow-lists, never the active ones,
        so Open and Insert… stay refused until the panel's "partialRendered" says the row is drawn.
        recipeDataMessage is the model on screen, which the caller has checked is still the one the
        action was clicked on. False when the data set cannot be placed on a card of it: the caller
        reloads.
    */
    static postAddedDataset(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                            panelState: IRecipeCockpitPanelState,
                            recipeDataMessage: IRecipeCockpitRecipeDataMessage,
                            datasetFolderPath: string): boolean {

        const recipeViewModel = recipeDataMessage.recipe;
        const historyTrees = recipeViewModel.trees.filter(tree => tree.folderName !== '' && !!tree.history);
        const addedDataset = RecipeCockpitTreeHistory.buildAddedDataset(
            datasetFolderPath,
            path.join(panelState.workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath()),
            panelState.workspaceRoot,
            recipeViewModel.selectedRunFolderName,
            historyTrees.map(tree => ({ treeKey: tree.treeKey, folderName: tree.folderName }))
        );

        const datasetFolderName = addedDataset?.dataset.datasetFolderName;

        // A NAME THE MODEL ALREADY LISTS IS NOT A NEW ROW -- A RELOAD SAYS WHAT IS ON DISK
        if ( !addedDataset || historyTrees.some(tree => tree.history.datasets.some(dataset => dataset.datasetFolderName === datasetFolderName)) ) {
            return false;
        }

        this.applyPreferencesToDataset(addedDataset.dataset, this.readDatasetPreferences(hub, hub.recipeCockpitWorkspaceState));

        // NEWEST FIRST, AS A RELOAD ORDERS THEM: THE FOLDER WAS NAMED FROM THE TIME IT WAS WRITTEN
        historyTrees
            .filter(tree => addedDataset.treeKeys.includes(tree.treeKey))
            .forEach(tree => tree.history.datasets.unshift(addedDataset.dataset));

        panelState.treeHistoryTargets.datasetFolderPathsByName.set(datasetFolderName, addedDataset.datasetFolderPath);
        if ( addedDataset.insertResultsFilePath !== undefined ) {
            panelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.set(datasetFolderName, addedDataset.insertResultsFilePath);
        }
        panelState.pendingTreeHistoryAllowLists = RecipeCockpitDrawnModel.cloneTreeHistoryAllowLists(panelState.pendingTreeHistoryAllowLists);
        RecipeCockpitDrawnModel.addDatasetToAllowLists(panelState.pendingTreeHistoryAllowLists, addedDataset.dataset);

        const datasetAddedMessage: IRecipeCockpitDatasetAddedMessage = {
            command: 'datasetAdded',
            treeKeys: addedDataset.treeKeys,
            dataset: addedDataset.dataset,
            renderSequence: recipeDataMessage.renderSequence,
            updateSequence: ++panelState.datasetUpdateSequence
        };

        hub.postToPanel(cockpitPanel, datasetAddedMessage);

        return true;

    }

    /*
        A data set row's Insert… (#541). The insert's state holds the window from the click to the
        end, as a tree insert's does, so nothing that changes the selection starts meanwhile and a
        reveal replays it; it is given back on every way out, and the row's last insert is read
        again whenever anything may have been written.
    */
    private static async insertDatasetIntoOrg(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                insertAction: Extract<RecipeCockpitDatasetsPanelAction, { kind: 'insertDataset' }>) {

        const { datasetFolderName, datasetFolderPath } = insertAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;

        panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: '', datasetFolderName: datasetFolderName };
        hub.postToPanel(cockpitPanel, panelState.insertStateMessage);

        let insertOutcome: 'sent' | 'missing' | 'notSent';

        try {
            insertOutcome = await this.runDatasetInsertSteps(hub, cockpitPanel, panelState, insertAction, clickedRecipeDataMessage, isClickStillCurrent);
        } finally {

            panelState.insertStateMessage = undefined;

            if ( hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState ) {
                hub.postToPanel(cockpitPanel, { command: 'insertState', isRunning: false, treeKey: '', datasetFolderName: datasetFolderName });
            }

        }

        if ( insertOutcome === 'missing' && isClickStillCurrent() ) {
            await this.refreshAfterMissingDataset(hub, cockpitPanel, panelState, datasetFolderName, insertAction.focusTree);
        } else if ( insertOutcome === 'sent' ) {
            this.postDatasetLastInsert(hub, cockpitPanel, panelState, clickedRecipeDataMessage, datasetFolderName, datasetFolderPath);
        }

    }

    // A DATA SET GONE SINCE THE DRAW ASKS FOR NO ORG; WITH NO SELECTION THE ORG IS ASKED FOR ONCE, AND ONLY A SANDBOX GOES ON
    private static async runDatasetInsertSteps(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                insertAction: Extract<RecipeCockpitDatasetsPanelAction, { kind: 'insertDataset' }>,
                                                clickedRecipeDataMessage: IRecipeCockpitRecipeDataMessage | undefined,
                                                isClickStillCurrent: () => boolean): Promise<'sent' | 'missing' | 'notSent'> {

        if ( !hub.isUsableWorkspacePath(insertAction.datasetFolderPath, panelState.workspaceRoot) ) {
            return 'missing';
        }

        // THE SUBFOLDER IS READ AND SENT TOO, AND A LINK THERE WOULD REACH FILES OUTSIDE THE WORKSPACE THE FOLDER'S OWN CHECK APPROVED
        const collectionsApiFolderPath = path.join(insertAction.datasetFolderPath, DATASET_COLLECTIONS_API_FOLDER_NAME);
        if ( fs.existsSync(collectionsApiFolderPath) && !hub.isUsableWorkspacePath(collectionsApiFolderPath, panelState.workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`Nothing was inserted: the ${DATASET_COLLECTIONS_API_FOLDER_NAME} folder of "${RecipeYamlScalar.escapeForNotification(insertAction.datasetFolderName)}" is not inside this workspace.`);
            return 'notSent';
        }

        if ( insertAction.isOrgToPrompt ) {
            const isSandboxSelected = !!clickedRecipeDataMessage
                && await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(hub, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                    RECIPE_COCKPIT_DATASET_INSERT_ORG_PLACEHOLDER, RECIPE_COCKPIT_DATASET_INSERT_REFUSAL_PREFIX, RECIPE_COCKPIT_DATASET_INSERT_SANDBOX_ONLY_REASON);
            if ( !isSandboxSelected ) {
                return 'notSent';
            }
        }

        let isDatasetMissing = false;
        const isInsertSent = await this.performDatasetInsert(hub, cockpitPanel, panelState, insertAction, isClickStillCurrent, () => { isDatasetMissing = true; });

        return isDatasetMissing ? 'missing' : isInsertSent ? 'sent' : 'notSent';

    }

    /*
        Confirmed in the panel against the Target Org Manager selection, then checked again: the same
        selection, the folder still there, all-or-none chosen, and the Organization row asked again
        on the connection the insert uses. Nothing is written -- not even InsertAttempts/ -- before
        every check has passed. True once the insert was sent.
    */
    private static async performDatasetInsert(hub: IRecipeCockpitHubForDatasetsTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                insertAction: Extract<RecipeCockpitDatasetsPanelAction, { kind: 'insertDataset' }>,
                                                isClickStillCurrent: () => boolean,
                                                onDatasetMissing: () => void): Promise<boolean> {

        const { datasetFolderName, datasetFolderPath } = insertAction;
        const dataOrgSelection = panelState.dataOrgSelection;
        const recipeDataMessage = panelState.recipeDataMessage;
        const refuse = (refusalMessage: string) => { VSCodeWorkspaceService.showWarningMessage(refusalMessage); return false; };

        if ( !dataOrgSelection || !recipeDataMessage ) {
            return refuse(RECIPE_COCKPIT_DATASET_INSERT_SELECTION_CHANGED_REFUSAL);
        }

        if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {
            return refuse(RECIPE_COCKPIT_DATASET_INSERT_NOT_SANDBOX_REFUSAL);
        }

        const orgDetail = dataOrgSelection.orgDetail;
        const orgLabel = orgDetail.alias
            ? `${RecipeYamlScalar.escapeForNotification(orgDetail.alias)} (${RecipeYamlScalar.escapeForNotification(orgDetail.username)})`
            : RecipeYamlScalar.escapeForNotification(orgDetail.username);
        const datasetEntry = this.findDatasetEntry(recipeDataMessage.recipe, datasetFolderName);
        const datasetLabel = RecipeYamlScalar.escapeForNotification(datasetEntry?.dataset.customName ?? datasetFolderName);
        // THE DIALOG IS WRITTEN WITH textContent, SO IT TAKES THE NAMES AS THEY ARE; ONLY A NOTIFICATION NEEDS THEM ESCAPED
        const dialogOrgLabel = orgDetail.alias ? `${orgDetail.alias} (${orgDetail.username})` : orgDetail.username;

        const confirmation = await hub.confirmInPanel(
            `Insert ${datasetEntry?.dataset.customName ?? datasetFolderName} into ${dialogOrgLabel}?`,
            {
                ...this.buildDatasetInsertConfirmationContent(datasetFolderName, datasetEntry?.dataset.customName, dialogOrgLabel, dataOrgSelection.orgTypeDetail,
                    DatasetSourceService.countLegacyRecordsByObject(datasetFolderPath), dataOrgSelection.scratchOrgDetail),
                org: hub.buildConfirmOrg(orgDetail),
                isDestructive: true,
                changeOrg: {
                    restartMessage: {
                        command: 'insertDataset',
                        datasetFolderName: datasetFolderName,
                        orgIndex: null,
                        ...( insertAction.focusTree ?? {} )
                    },
                    isSandboxOnly: true
                }
            },
            RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL ) {
            return false;
        }

        if ( !hub.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot) ) {
            onDatasetMissing();
            return false;
        }

        // THE SAME QUESTION EVERY INSERT ASKS
        const allOrNoneSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
        if ( allOrNoneSelection === undefined ) {
            return false;
        }

        // THE SAME SELECTION, NOT MERELY THE SAME ORG: ANOTHER ORG CHOSEN, ⟳, OR A RELOAD OF THE RUN EACH START A NEW ONE
        if ( !isClickStillCurrent() || panelState.dataOrgSelection !== dataOrgSelection ) {
            return refuse(`The org selection changed after ${orgLabel} was confirmed (another org was chosen, the orgs were checked again, or the run was reloaded), so nothing was inserted. Choose Insert… again.`);
        }

        const connection = await SalesforceOrgService.getConnection(orgDetail.username);

        // ASKED AGAIN, NOT READ FROM THE SELECTION: THIS IS THE ANSWER THE INSERT RELIES ON, ON THE CONNECTION IT INSERTS WITH
        const orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(connection));
        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was inserted into ${orgLabel} (${RecipeYamlScalar.escapeForNotification(SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail))}): the Recipe Cockpit inserts a data set only into a sandbox or scratch org.`);
        }

        const insertResult = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection, allOrNoneSelection, {
            isFailureReportedByCaller: true,
            orgUsername: orgDetail.username,
            orgAlias: orgDetail.alias
        });

        const runFolderName = datasetEntry?.dataset.runFolderName;
        RecipeCockpitTreecipeDataOrgs.showTreeInsertNotification(hub, insertResult, datasetLabel, orgLabel, panelState.workspaceRoot,
            runFolderName && datasetEntry?.tree.folderName ? { runFolderName: runFolderName, treeFolderName: datasetEntry.tree.folderName } : undefined);

        return true;

    }

    // THE FIRST CARD THAT LISTS THE DATA SET, AND ITS ROW
    private static findDatasetEntry(recipeViewModel: IRecipeCockpitRecipeViewModel, datasetFolderName: string):
        { tree: IRecipeCockpitTreeViewModel; dataset: IRecipeCockpitTreeDatasetViewModel } | undefined {

        for ( const tree of recipeViewModel.trees ) {
            const dataset = tree.history?.datasets.find(candidateDataset => candidateDataset.datasetFolderName === datasetFolderName);
            if ( dataset ) {
                return { tree: tree, dataset: dataset };
            }
        }

        return undefined;

    }

    // WHAT A DATA SET'S INSERT CONFIRMATION SAYS (#541): THE RECORDS PER OBJECT ITS COLLECTIONS API FILES HOLD, AND A FILE THAT COULD NOT BE COUNTED
    static buildDatasetInsertConfirmationContent(datasetFolderName: string,
                                                    customName: string | undefined,
                                                    orgLabel: string,
                                                    orgTypeDetail: IOrgTypeDetail | undefined,
                                                    recordCounts: ILegacyRecordCountResult,
                                                    scratchOrgDetail?: IScratchOrgDetail): IRecipeCockpitConfirmContent {

        const recordEntries = Object.keys(recordCounts.recordCountsByObject).sort()
            .map(objectApiName => [objectApiName, recordCounts.recordCountsByObject[objectApiName]] as const);
        const totalRecordCount = recordEntries.reduce((recordCount, [, objectCount]) => recordCount + objectCount, 0);
        const orgTypeLabel = SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail, scratchOrgDetail);

        return {
            summary: [`Insert ${totalRecordCount} ${totalRecordCount === 1 ? 'record' : 'records'} from this data set into ${orgLabel}, parents first.`],
            badge: orgTypeLabel,
            warnings: [
                'Cancel on the progress notification deletes every record this insert saved.',
                ...( recordCounts.unreadableFileNames.length > 0
                    ? [`These files could not be counted and are inserted as they are: ${recordCounts.unreadableFileNames.join(', ')}`]
                    : [] )
            ],
            sections: [
                { title: 'Records per object', count: recordEntries.length, lines: recordEntries.map(([objectApiName, objectCount]) => `  ${objectApiName}: ${objectCount}`) },
                {
                    title: 'Data set and org',
                    lines: [
                        `Data set: ${customName !== undefined ? `${customName} (${datasetFolderName})` : datasetFolderName}`,
                        `Org: ${orgLabel}`,
                        `Type: ${orgTypeLabel}`
                    ]
                },
                { title: 'What happens next', lines: ['You choose all-or-none next.', 'The data set is inserted the way Insert Data Set by Directory inserts, and the results are written to its InsertAttempts folder.'] }
            ]
        };

    }

    // THE CARD AND TAB A DATA SET ROW'S CLICK CAME FROM, WHEN IT IS A DRAWN CARD'S DATA SETS TAB: WHERE A RELOAD PUTS THE READER BACK
    private static readTreeFocus(panelMessage: IRecipeCockpitPanelMessage, panelState: IRecipeCockpitPanelState): IRecipeCockpitTreeFocus | undefined {

        const { treeKey, tab } = panelMessage;
        const isDatasetsTab = tab === 'datasets';
        const isRenderedTree = typeof treeKey === 'string'
                                && !!panelState.recipeDataMessage?.recipe.trees.some(tree => tree.treeKey === treeKey);

        return isDatasetsTab && isRenderedTree ? { treeKey: treeKey as string, tab: tab } : undefined;

    }

}
