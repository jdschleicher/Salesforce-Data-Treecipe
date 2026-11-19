import * as vscode from 'vscode';
import {
    RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND,
    RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND
} from './RecipeCockpitTroubleshootingConstants';
import {
    IValidationRuleListObject,
    RecipeCockpitValidationRuleList
} from './RecipeCockpitValidationRuleList';
import { MetadataDeployKind } from './RecipeCockpitMetadataDeploy';
import { MetadataRetrieveKind } from './RecipeCockpitMetadataRetrieve';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    RunHistoryRowStatus,
    RunHistoryStep
} from './RecipeCockpitRunHistory';
import { RecipeCockpitTroubleshootingViews } from './RecipeCockpitTroubleshootingViews';
import {
    RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL,
    RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL,
    RecipeCockpitTroubleshootingRuns
} from './RecipeCockpitTroubleshootingRuns';
import type {
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    RecipeCockpitService
} from './RecipeCockpitService';

/*
    The Troubleshooting tab's host half (moved out of the hub by #666, after #665's pattern): the
    messages it answers and the actions they route to. What the tab shows is
    RecipeCockpitTroubleshootingViews, and its runs are RecipeCockpitTroubleshootingRuns. The hub
    owns the panel, its state and every allow-list, including the Validation Rules and History acks
    that promote them; it hands this host each Troubleshooting command and action kind.
*/

/*
    What the tab reads and calls on the hub, and nothing else: the hub class itself, narrowed to these
    names, so a read after an await sees the panel and state open now. Read-only but for the deploy
    and retrieve locks, the two the runs set; the panel state, allow-lists included, is never replaced.
*/
export type IRecipeCockpitHubForTroubleshootingTab = Readonly<Pick<typeof RecipeCockpitService,
    'buildConfirmOrg' |
    'buildDataOrgNoOrgsMessage' |
    'confirmInPanel' |
    'confirmInPanelWithCheckbox' |
    'describeThrown' |
    'findRetrievedFilesApplyRefusal' |
    'isScratchOrgSetupInFlight' |
    'isSelectionHeldByPromptOrUpdater' |
    'isUsableWorkspacePath' |
    'listTreeDeployObjects' |
    'listTreeInsertObjectApiNames' |
    'loadDataOrgs' |
    'metadataDeployRunStateMessage' |
    'metadataRetrieveRunStateMessage' |
    'postToPanel' |
    'readSourceApiVersion' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'refreshDataOrgReadinessForTrees' |
    'rememberDataOrgUsername' |
    'resolveSelectedReadOrg' |
    'resolveTreeRunArtifactsLocation' |
    'resolveTreeSnapshotLocations' |
    'routePanelMessage' |
    'runCancellableCli' |
    'runCancellableRetrieve' |
    'runPanelAction' |
    'setMetadataDeployState' |
    'setMetadataRetrieveState' |
    'showMetadataRetrieveNotification' |
    'toSingleLine' |
    'withRunArtifactsGitIgnoreNote'>> & Pick<typeof RecipeCockpitService,
    'isMetadataDeployInFlight' |
    'isMetadataRetrieveInFlight'>;

/*
    "Assign permission sets to me…" (#274, #302): while isRunning, every tree's insert, every
    assign button and the org picker are disabled. treeKey names the card whose button was clicked.
    It carries no text: how a run went is said in a VS Code notification, whose buttons ("View
    output") are its only follow-up actions. Stored and replayed.
*/
export interface IRecipeCockpitPermissionSetAssignStateMessage {
    command: 'permissionSetAssignState';
    isRunning: boolean;
    treeKey: string;
}

/*
    The Troubleshooting tab's retrieves (#326, #382): ONE per window, whatever its kind, so while
    isRunning every card's retrieve and deploy is disabled. treeKey and retrieveKind name the card
    whose button was clicked, which reads "Retrieving…". It carries no text: how the retrieve went is
    a VS Code notification. Stored and replayed.
*/
export interface IRecipeCockpitMetadataRetrieveStateMessage {
    command: 'metadataRetrieveState';
    isRunning: boolean;
    treeKey: string;
    retrieveKind: MetadataRetrieveKind;
}

/*
    The Troubleshooting tab's deploys (#346): while isRunning, every deploy button, every insert, the
    assignment, the retrieve and the org picker are disabled. treeKey and deployKind name the button
    clicked. It carries no text: how the deploy went is a VS Code notification. Stored and replayed.
*/
export interface IRecipeCockpitMetadataDeployStateMessage {
    command: 'metadataDeployState';
    isRunning: boolean;
    treeKey: string;
    deployKind: MetadataDeployKind;
}

/*
    What each Troubleshooting section would deploy (#346), read from the project when the tab is
    opened: COUNTS only -- the names are the host's, and are named in the deploy's own confirmation.
    renderSequence names the model it was read for, and the panel drops it for any other.
    failureMessage is set, and every count 0, when the project could not be read.
*/
export interface IRecipeCockpitTroubleshootingSummaryMessage {
    command: 'troubleshootingSummary';
    renderSequence: number;
    treeKey: string;
    permissionSetCount: number;
    customFieldCount: number;
    standardFieldCount: number;
    unreadableFieldCount: number;
    globalValueSetCount: number;
    missingGlobalValueSetCount: number;
    recordTypeCount: number;
    // #402: THE CUSTOM OBJECTS A FIELDS DEPLOY ADDS, THE ONES IT CANNOT, AND THE VALIDATION RULES ITS BOX ADDS
    customObjectCount: number;
    missingCustomObjectCount: number;
    unreadableCustomObjectCount: number;
    validationRuleCount: number;
    failureMessage?: string;
}

/*
    The Troubleshooting tab's Validation Rules list (#327): per tree object, every rule the project
    holds and what Generate Treecipe did with it, read when the sub-tab is opened. renderSequence
    names the model it was read for, and the panel drops it for any other. failureMessage is set,
    and objects empty, when the objects path or the run's wrapper could not be read.
*/
export interface IRecipeCockpitTreeValidationRulesMessage {
    command: 'treeValidationRules';
    renderSequence: number;
    treeKey: string;
    objects: IValidationRuleListObject[];
    // THE RULES WHOSE FILE A ROW LINKS TO (#560), SET ONLY WHEN ONE DOES, WITH THE SEQUENCE ITS ACK ECHOES
    openableRules?: IRecipeCockpitValidationRuleSourceViewModel[];
    listSequence?: number;
    failureMessage?: string;
}

export interface IRecipeCockpitValidationRuleSourceViewModel {
    objectApiName: string;
    ruleName: string;
}

/*
    One row of the Troubleshooting tab's History (#485). Times are epoch milliseconds the panel
    formats; files are named by their index in the host-only list kept for this message, never by
    a path. orgLabel is the alias, else the username.
*/
export interface IRecipeCockpitTroubleshootingHistoryRowViewModel {
    step: RunHistoryStep;
    stepLabel: string;
    status: RunHistoryRowStatus;
    timeMs: number;
    timeLabel: string;
    finishedAtMs?: number;
    finishedAtLabel?: string;
    runFolderName: string;
    orgLabel?: string;
    orgUsername?: string;
    succeededCount?: number;
    failedCount?: number;
    detail?: string;
    files: Array<{ fileIndex: number; fileName: string }>;
}

/*
    A tree's History, read when the sub-tab first opens and again after a step ends. renderSequence
    names the model it was read for, and the panel drops it for any other; historySequence is echoed
    by the panel's "troubleshootingHistoryRendered", and only that ack opens these rows' files.
*/
export interface IRecipeCockpitTroubleshootingHistoryMessage {
    command: 'troubleshootingHistory';
    renderSequence: number;
    treeKey: string;
    historySequence: number;
    rows: IRecipeCockpitTroubleshootingHistoryRowViewModel[];
    hiddenRowCount: number;
}

export const RECIPE_COCKPIT_HISTORY_FILE_GONE_TEXT = 'That run file no longer exists in this workspace.';

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_TROUBLESHOOTING_COMMANDS = [
    'assignTreePermissionSets',
    'generateTreePermissionSet',
    'retrieveTreeValidationRules',
    'retrieveTreeFields',
    'retrieveTreeRecordTypes',
    'retrieveTreeGlobalValueSets',
    'deployTreePermissionSet',
    'deployTreeFields',
    'deployTreeGlobalValueSets',
    'deployTreeRecordTypes',
    'loadTroubleshootingSummary',
    'loadValidationRules',
    'loadTroubleshootingHistory',
    'openTroubleshootingHistoryFile',
    'openValidationRuleSource'
] as const;

export const RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_KINDS = [
    'assignTreePermissionSets',
    'generateTreePermissionSet',
    'retrieveTreeMetadata',
    'refuseMetadataRetrieve',
    'deployTreeMetadataComponents',
    'refuseMetadataDeploy',
    'loadTroubleshootingSummary',
    'loadValidationRules',
    'loadTroubleshootingHistory',
    'openTroubleshootingHistoryFile',
    'openValidationRuleSource',
    'refusePermissionSetAssign'
] as const;

// THE TAB'S ACTIONS WHOSE CONFIRMATION OFFERS "Change org…" (#480): THE RETRIEVES, THE DEPLOYS AND THE ASSIGNMENT
export const RECIPE_COCKPIT_TROUBLESHOOTING_ORG_CHANGE_ACTION_KINDS = [
    'retrieveTreeMetadata',
    'deployTreeMetadataComponents',
    'assignTreePermissionSets'
] as const;

export type RecipeCockpitTroubleshootingPanelAction =
    | { kind: 'openValidationRuleSource'; objectApiName: string; ruleName: string }
    | { kind: 'assignTreePermissionSets'; treeKey: string; isSelectedOrg: boolean }
    | { kind: 'generateTreePermissionSet'; treeKey: string }
    | { kind: 'retrieveTreeMetadata'; treeKey: string; retrieveKind: MetadataRetrieveKind }
    | { kind: 'deployTreeMetadataComponents'; treeKey: string; deployKind: MetadataDeployKind; isSelectedOrg: boolean }
    | { kind: 'refuseMetadataDeploy'; refusalText?: string; hostMessage: IRecipeCockpitMetadataDeployStateMessage }
    | { kind: 'loadTroubleshootingSummary'; treeKey: string; renderSequence: number }
    | { kind: 'loadValidationRules'; treeKey: string; renderSequence: number }
    | { kind: 'loadTroubleshootingHistory'; treeKey: string }
    | { kind: 'openTroubleshootingHistoryFile'; filePath: string }
    | { kind: 'refuseMetadataRetrieve'; refusalText?: string; hostMessage: IRecipeCockpitMetadataRetrieveStateMessage }
    | { kind: 'refusePermissionSetAssign'; refusalText?: string; hostMessage: IRecipeCockpitPermissionSetAssignStateMessage };

export class RecipeCockpitTroubleshootingHost {

    static isTroubleshootingCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_TROUBLESHOOTING_COMMANDS.some(troubleshootingCommand => troubleshootingCommand === command);
    }

    static isTroubleshootingPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitTroubleshootingPanelAction {
        return RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_KINDS.some(troubleshootingActionKind => troubleshootingActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: THE HUB'S CHECKS IT READS ARE FUNCTIONS OF THE STATE PASSED
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForTroubleshootingTab): RecipeCockpitTroubleshootingPanelAction | undefined {

        switch ( panelMessage.command ) {

            // A RULE'S FILE (#560): NAMES ONLY, MATCHED AGAINST THE RULES A DRAWN ROW LINKS TO; THE HOST FINDS THE FILE AGAIN
            case 'openValidationRuleSource': {

                const { objectApiName, ruleName } = panelMessage;

                if ( typeof objectApiName !== 'string'
                        || typeof ruleName !== 'string'
                        || !panelState.openableValidationRuleKeys.has(RecipeCockpitValidationRuleList.buildRuleSourceKey(objectApiName, ruleName)) ) {
                    return undefined;
                }

                return { kind: 'openValidationRuleSource', objectApiName: objectApiName, ruleName: ruleName };

            }

            /*
                "Assign permission sets to me…" (#274, #302) posts the tree's KEY, and the INDEX of
                the org the Treecipe tab has selected when it has one; neither decides what is
                assigned. The key must be a card the panel confirmed drawing, and the host reads that
                tree's objects from the stored model; which permission sets are offered is the
                host's, from local source. One assignment at a time, none while an insert or a
                scratch org run holds the selection, and none of those while it runs. An index must
                BE the selection, that org must have answered that it is a sandbox, and its readiness
                must have been posted: an assignment changes what a describe answers, so a describe
                the selection's own check took before it, cached or posted after it, would put back
                the reasons the assignment removed. With no index the host asks for an org itself,
                from the same non-production list the picker draws. A forged message for production
                stops here, before any connection or process. A refusal with a reason is a warning
                notification; every refusal gives the clicked button back.
            */
            case 'assignTreePermissionSets': {

                const { orgIndex, treeKey } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                if ( panelState.permissionSetAssignStateMessage?.isRunning ) {
                    return undefined;
                }

                const refuse = (refusalText?: string): RecipeCockpitTroubleshootingPanelAction => ({
                    kind: 'refusePermissionSetAssign',
                    ...( refusalText ? { refusalText: refusalText } : {} ),
                    hostMessage: { command: 'permissionSetAssignState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' }
                });

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.assignableTreeKeys.has(treeKey)
                        || panelState.scratchOrgStateMessage?.isRunning
                        || ( panelState.insertStateMessage || hub.isSelectionHeldByPromptOrUpdater(panelState) ) ) {
                    return refuse();
                }

                if ( panelState.metadataDeployStateMessage?.isRunning ) {
                    return refuse('Nothing was assigned: a metadata deploy is running. Try again once it has finished.');
                }

                if ( orgIndex === undefined || orgIndex === null ) {
                    return { kind: 'assignTreePermissionSets', treeKey: treeKey, isSelectedOrg: false };
                }

                if ( typeof orgIndex === 'number'
                        && !!dataOrgSelection
                        && dataOrgSelection.orgIndex === orgIndex
                        && dataOrgSelection.orgTypeDetail?.isSandbox === true ) {
                    return dataOrgSelection.isReadinessPosted === true
                        ? { kind: 'assignTreePermissionSets', treeKey: treeKey, isSelectedOrg: true }
                        : refuse('Nothing was assigned: the org selected above is still being checked. Try again once that check has finished.');
                }

                return refuse('Nothing was assigned: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.');

            }

            /*
                "Generate permission set…" (#306) posts the tree's KEY and nothing else: which objects
                and fields, the name, the folder and the file are all the host's. It writes into the
                project, so it waits for a recipe write and a permission set assignment (which reads
                the project's permission sets) to end; a scratch org run deploys nothing (#358).
                A tree whose every object is excluded has nothing to grant. A refusal is silent: the
                panel disables nothing on the click, so there is no button to give back.
            */
            case 'generateTreePermissionSet': {

                const { treeKey } = panelMessage;
                const recipeDataMessage = panelState.recipeDataMessage;

                if ( typeof treeKey !== 'string'
                        || !recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || panelState.wireLookupStateMessage
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                const tree = recipeDataMessage.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

                return tree && hub.listTreeInsertObjectApiNames(recipeDataMessage.recipe, tree).length > 0
                    ? { kind: 'generateTreePermissionSet', treeKey: treeKey }
                    : undefined;

            }

            /*
                The Troubleshooting tab's retrieves (#326, #382) post the tree's KEY and nothing else:
                what is retrieved is the host's, and the org is the Target Org Manager selection the
                host holds (#480), so an org index the message carries is never read. One retrieve per window,
                whatever its kind; it waits for an insert, a permission set assignment and a metadata
                deploy to end, and a scratch org run, which deploys nothing (#358), does not hold it.
                Every refusal gives the clicked button back, and a busy one says why.
            */
            case 'retrieveTreeValidationRules':
            case 'retrieveTreeFields':
            case 'retrieveTreeRecordTypes':
            case 'retrieveTreeGlobalValueSets': {

                const { treeKey } = panelMessage;
                const retrieveKind = ( Object.keys(RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND) as MetadataRetrieveKind[] )
                    .find(kind => RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[kind] === panelMessage.command) as MetadataRetrieveKind;

                // A RELOADED DOCUMENT MAY NOT KNOW A RETRIEVE IS RUNNING: IT IS TOLD, AND THE RETRIEVE'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.metadataRetrieveStateMessage?.isRunning ) {
                    return { kind: 'refuseMetadataRetrieve', hostMessage: panelState.metadataRetrieveStateMessage };
                }

                const notRunning: IRecipeCockpitMetadataRetrieveStateMessage = { command: 'metadataRetrieveState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', retrieveKind: retrieveKind };

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseMetadataRetrieve', hostMessage: notRunning };
                }

                if ( panelState.insertStateMessage
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseMetadataRetrieve', refusalText: RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                const retrievedFilesApplyRefusal = hub.findRetrievedFilesApplyRefusal(panelState);
                if ( retrievedFilesApplyRefusal ) {
                    return { kind: 'refuseMetadataRetrieve', refusalText: retrievedFilesApplyRefusal, hostMessage: notRunning };
                }

                return { kind: 'retrieveTreeMetadata', treeKey: treeKey, retrieveKind: retrieveKind };

            }

            /*
                The Troubleshooting tab's deploys (#346) post the tree's KEY, and the INDEX of the org
                the Treecipe tab has selected when it has one; neither decides what is deployed, which
                the host reads from the project for the tree it holds. The key must be a card with a
                folder the panel confirmed drawing. An index must BE the selection, still name the same
                username, and that org must have answered that it is a sandbox: a forged message for
                production stops here, before any connection or process. With no index the host asks
                for an org from the same non-production list the picker draws. One deploy per window,
                none while an insert, a scratch org run, an assignment or a retrieve runs, and none of
                those while it runs. Every refusal gives the clicked button back.
            */
            case 'deployTreePermissionSet':
            case 'deployTreeFields':
            case 'deployTreeGlobalValueSets':
            case 'deployTreeRecordTypes': {

                const { orgIndex, treeKey } = panelMessage;
                const deployKind = ( Object.keys(RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND) as MetadataDeployKind[])
                    .find(candidateKind => RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND[candidateKind] === panelMessage.command) as MetadataDeployKind;
                const dataOrgSelection = panelState.dataOrgSelection;

                // A RELOADED DOCUMENT MAY NOT KNOW A DEPLOY IS RUNNING: IT IS TOLD, AND THE DEPLOY'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseMetadataDeploy', hostMessage: panelState.metadataDeployStateMessage };
                }

                const refuse = (refusalText?: string): RecipeCockpitTroubleshootingPanelAction => ({
                    kind: 'refuseMetadataDeploy',
                    ...( refusalText ? { refusalText: refusalText } : {} ),
                    hostMessage: { command: 'metadataDeployState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', deployKind: deployKind }
                });

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return refuse();
                }

                if ( ( panelState.insertStateMessage || hub.isSelectionHeldByPromptOrUpdater(panelState) )
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataRetrieveStateMessage?.isRunning ) {
                    return refuse(RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL);
                }

                const retrievedFilesApplyRefusal = hub.findRetrievedFilesApplyRefusal(panelState);
                if ( retrievedFilesApplyRefusal ) {
                    return refuse(retrievedFilesApplyRefusal);
                }

                if ( orgIndex === undefined || orgIndex === null ) {
                    return { kind: 'deployTreeMetadataComponents', treeKey: treeKey, deployKind: deployKind, isSelectedOrg: false };
                }

                if ( typeof orgIndex === 'number'
                        && Number.isInteger(orgIndex)
                        && !!dataOrgSelection
                        && dataOrgSelection.orgIndex === orgIndex
                        && panelState.dataOrgDetails[orgIndex]?.username === dataOrgSelection.orgDetail.username
                        && dataOrgSelection.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'deployTreeMetadataComponents', treeKey: treeKey, deployKind: deployKind, isSelectedOrg: true };
                }

                return refuse('Nothing was deployed: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.');

            }

            /*
                What each Troubleshooting section would deploy (#346), read from local files when the
                tab is opened, for a card with a folder the panel confirmed drawing. It reads the
                project and nothing else, so it is answered whatever else runs.
            */
            case 'loadTroubleshootingSummary': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadTroubleshootingSummary', treeKey: treeKey, renderSequence: renderSequence as number };

            }

            /*
                The Validation Rules sub-tab's list (#327) posts the tree's KEY and the model it was
                drawn on, nothing else: the objects are the host's model of the tree. It reads local
                files and nothing else, so it is answered whatever else runs.
            */
            case 'loadValidationRules': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadValidationRules', treeKey: treeKey, renderSequence: renderSequence as number };

            }

            // THE HISTORY (#485) READS LOCAL FILES AND NOTHING ELSE, SO IT IS ANSWERED WHATEVER ELSE RUNS
            case 'loadTroubleshootingHistory': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadTroubleshootingHistory', treeKey: treeKey };

            }

            // A HISTORY ROW'S FILE BY ITS INDEX IN THE ROWS THE PANEL ACKNOWLEDGED: NEVER A PATH, AND NOTHING FOR AN OLDER LIST
            case 'openTroubleshootingHistoryFile': {

                const { treeKey, historySequence, fileIndex } = panelMessage;
                const activeFiles = typeof treeKey === 'string' ? panelState.historyFiles.get(treeKey) : undefined;

                if ( !activeFiles
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || historySequence !== activeFiles.historySequence
                        || typeof fileIndex !== 'number'
                        || !Number.isInteger(fileIndex)
                        || fileIndex < 0
                        || fileIndex >= activeFiles.filePaths.length ) {
                    return undefined;
                }

                return { kind: 'openTroubleshootingHistoryFile', filePath: activeFiles.filePaths[fileIndex] };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitTroubleshootingPanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'openValidationRuleSource':

                await RecipeCockpitTroubleshootingViews.openValidationRuleSource(panelState.workspaceRoot, panelAction.objectApiName, panelAction.ruleName);
                return;

            case 'assignTreePermissionSets':

                await RecipeCockpitTroubleshootingRuns.assignTreePermissionSetsFromPanel(hub, cockpitPanel, panelAction.treeKey, panelAction.isSelectedOrg);
                return;

            case 'generateTreePermissionSet':

                await RecipeCockpitTroubleshootingRuns.generateTreePermissionSetFromPanel(hub, cockpitPanel, panelAction.treeKey);
                return;

            case 'retrieveTreeMetadata':

                await RecipeCockpitTroubleshootingRuns.retrieveTreeMetadataFromPanel(hub, cockpitPanel, panelAction.treeKey, panelAction.retrieveKind);
                return;

            case 'refuseMetadataRetrieve':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'deployTreeMetadataComponents':

                await RecipeCockpitTroubleshootingRuns.deployTreeMetadataFromPanel(hub, cockpitPanel, panelAction.treeKey, panelAction.deployKind, panelAction.isSelectedOrg);
                return;

            case 'refuseMetadataDeploy':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'loadTroubleshootingSummary':

                await RecipeCockpitTroubleshootingViews.postTroubleshootingSummary(hub, cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'loadValidationRules':

                await RecipeCockpitTroubleshootingViews.postTreeValidationRules(hub, cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'loadTroubleshootingHistory':

                RecipeCockpitTroubleshootingViews.postTroubleshootingHistory(hub, cockpitPanel, panelState, panelAction.treeKey);
                return;

            case 'openTroubleshootingHistoryFile':

                await VSCodeWorkspaceService.openWorkspaceResultFile(panelAction.filePath, panelState.workspaceRoot, RECIPE_COCKPIT_HISTORY_FILE_GONE_TEXT);
                return;

            case 'refusePermissionSetAssign':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

        }

    }

}
