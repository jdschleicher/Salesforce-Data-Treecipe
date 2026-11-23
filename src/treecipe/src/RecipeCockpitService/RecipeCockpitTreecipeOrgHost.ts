import * as vscode from 'vscode';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeOrgTab
import type { RecipeCockpitService } from './RecipeCockpitService';
import type {
    IRecipeCockpitDataOrgListingRefusedMessage,
    IRecipeCockpitInsertStateMessage,
    IRecipeCockpitOrgOpenStateMessage,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitScratchOrgStateMessage,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import type { IRecipeCockpitHubForDatasetsTab } from './RecipeCockpitDatasetsHost';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import { RecipeCockpitTreecipeInsert } from './RecipeCockpitTreecipeInsert';

/*
    Target Org Manager and a tree's insert, the Treecipe tab's org half (moved out of the hub by #669
    part a, after #665's pattern): the messages it answers and the actions they route to. What they
    run is RecipeCockpitTreecipeInsert (a tree's "Generate fake data and insert") and
    RecipeCockpitTreecipeDataOrgs (the org list, a selection and its check, "+ New scratch org",
    "Authorize org", opening the org, a card's create readiness, and the insert notification a data
    set row's insert shows too). They load one way: this file, then Insert, then DataOrgs, which loads
    no other host, so the Data Sets, Adapter, Troubleshooting and record link hosts read the picker
    from it. The hub owns the panel, its state and every allow-list, the insert lock both inserts
    hold, and promotes the lists on the panel's acks.
*/

/*
    What the Treecipe tab's org files read and call on the hub, and nothing else: the hub class
    itself, narrowed to these names and read-only, so a read after an await sees the panel and state
    open now. It is also the Data Sets tab's hub type, since a tree insert that lands posts its new
    data set through RecipeCockpitDatasetsHost.postAddedDataset.
*/
export type IRecipeCockpitHubForTreecipeOrgTab = Readonly<Pick<typeof RecipeCockpitService,
    'buildConfirmOrg' |
    'buildObjectsByApiName' |
    'buildRunFakerFilteredRecipe' |
    'buildSelectableRecordTypeKey' |
    'confirmInPanel' |
    'confirmInPanelWithCheckbox' |
    'confirmInPanelWithRecordTypeSetModes' |
    'describeOccurrence' |
    'describeSelectionHoldingRun' |
    'findOrgRecordLookup' |
    'isPlainRecord' |
    'isSelectionHeldByPromptOrUpdater' |
    'isUsableWorkspacePath' |
    'listExcludedFieldApiNamesByObject' |
    'listExcludedObjectApiNames' |
    'listObjectCountsByObject' |
    'listUnconstrainedValuesByObject' |
    'loadRecipeIntoPanel' |
    'postToPanel' |
    'readOccurrenceNickname' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'recipeCockpitWorkspaceState' |
    'resolveRunFakerFilteredRecipe' |
    'resolveTroubleshootingFocus' |
    'routePanelMessage' |
    'saveRecordTypeSelection' |
    'toSingleLine'>> & IRecipeCockpitHubForDatasetsTab;

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_TREECIPE_ORG_COMMANDS = [
    'loadDataOrgs',
    'selectDataOrg',
    'refreshDataOrgs',
    'createScratchOrg',
    'authorizeOrg',
    'insertTree',
    'openDataOrg'
] as const;

export const RECIPE_COCKPIT_TREECIPE_ORG_ACTION_KINDS = [
    'loadDataOrgs',
    'selectDataOrg',
    'refreshDataOrgs',
    'refuseDataOrgListing',
    'insertTree',
    'promptInsertOrg',
    'createScratchOrg',
    'authorizeOrg',
    'postScratchOrgState',
    'openDataOrg',
    'postOrgOpenState'
] as const;

// THE TAB'S ACTIONS WHOSE CONFIRMATION OFFERS "Change org…" (#480): A TREE'S INSERT, WITH OR WITHOUT AN ORG CHOSEN FIRST
export const RECIPE_COCKPIT_TREECIPE_ORG_CHANGE_ACTION_KINDS = [
    'insertTree',
    'promptInsertOrg'
] as const;

export type RecipeCockpitTreecipeOrgPanelAction =
    | { kind: 'loadDataOrgs' }
    | { kind: 'selectDataOrg'; orgIndex: number }
    | { kind: 'refreshDataOrgs' }
    | { kind: 'refuseDataOrgListing'; hostMessage: IRecipeCockpitDataOrgListingRefusedMessage }
    // recordTypeSelection: THE RECORD TYPES TICKED AT THE CLICK (#623), EVERY NAME ONE THE DRAWN MODEL OFFERED
    | { kind: 'insertTree'; treeKey: string; recipeFilePath: string; recordTypeSelection?: Record<string, string[]>; isRemembered?: true }
    | { kind: 'promptInsertOrg'; treeKey: string; recipeFilePath: string; recordTypeSelection?: Record<string, string[]>; isRemembered?: true }
    | { kind: 'createScratchOrg' }
    | { kind: 'authorizeOrg' }
    | { kind: 'postScratchOrgState'; hostMessage: IRecipeCockpitScratchOrgStateMessage }
    // A REFUSAL IS A WARNING NOTIFICATION, AND THE STATE GIVES THE CLICKED BUTTON BACK
    | { kind: 'openDataOrg'; orgDetail: IAuthenticatedOrgDetail }
    | { kind: 'postOrgOpenState'; hostMessage: IRecipeCockpitOrgOpenStateMessage };

export const RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX = ', so the orgs were not checked again. Use ⟳ once it ends.';

export class RecipeCockpitTreecipeOrgHost {

    static isTreecipeOrgCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_TREECIPE_ORG_COMMANDS.some(treecipeOrgCommand => treecipeOrgCommand === command);
    }

    static isTreecipeOrgPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitTreecipeOrgPanelAction {
        return RECIPE_COCKPIT_TREECIPE_ORG_ACTION_KINDS.some(treecipeOrgActionKind => treecipeOrgActionKind === panelAction.kind);
    }

    /*
        PURE, LIKE THE HUB'S ROUTER IT IS PART OF: the hub's checks it reads are functions of the state
        passed. An insert asked for while another insert runs answers the hub's postInsertState, since
        the tree insert and a data set row's insert hold the one insert lock.
    */
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForTreecipeOrgTab): RecipeCockpitTreecipeOrgPanelAction | { kind: 'postInsertState'; hostMessage: IRecipeCockpitInsertStateMessage } | undefined {

        switch ( panelMessage.command ) {

            /*
                Data-by-Org reads org names from the CLI, and the panel only ever names one by its
                INDEX into the list the host posted -- never a username or an alias. Which objects
                are checked is read from the confirmed-drawn model, never from the message.
            */
            case 'loadDataOrgs':

                // A RUN ENDS BY LISTING THE ORGS ITSELF; A SECOND LISTING MEANWHILE WOULD DISCARD ITS ANSWER AND FORGET ITS ORG
                // AN INSERT IN FLIGHT HOLDS THE SELECTION IT CONFIRMED; ITS RELOAD ASKS AGAIN ONCE IT HAS ENDED
                // A PERMISSION SET ASSIGNMENT HOLDS THE SELECTION IT ASSIGNS IN, AND CHECKS IT AGAIN WHEN IT ENDS
                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return this.refuseDataOrgListingWhileHeld(hub, panelState) ?? { kind: 'loadDataOrgs' };

            case 'selectDataOrg': {

                const { orgIndex } = panelMessage;

                if ( typeof orgIndex !== 'number'
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning
                        || ( panelState.insertStateMessage || hub.isSelectionHeldByPromptOrUpdater(panelState) )
                        || !Number.isInteger(orgIndex)
                        || orgIndex < 0
                        || orgIndex >= panelState.dataOrgDetails.length
                        || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return { kind: 'selectDataOrg', orgIndex: orgIndex };

            }

            /*
                ⟳ asks the CLI again which orgs are connected, re-lists them and re-selects the org
                chosen last by USERNAME, which checks it afresh. It needs no selection: with every
                org left out, it is how a reader who just re-authorized one sees it listed.
            */
            case 'refreshDataOrgs':

                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return this.refuseDataOrgListingWhileHeld(hub, panelState) ?? { kind: 'refreshDataOrgs' };

            /*
                "+ New scratch org" carries NOTHING: the Dev Hub, the definition file and the alias are
                all the host's, and nothing is deployed (#358). It is honoured only beside a confirmed-drawn
                Data-by-Org picker, and never while a run or a Create is in flight -- whatever the panel
                sends. A refusal while nothing runs still answers, since the panel disabled the button.
            */
            // "Authorize org" (#630) CARRIES NOTHING EITHER, AND IS HELD TO THE SAME GUARDS: IT RE-LISTS THE PICKER AND MAY CHANGE THE SELECTION
            case 'createScratchOrg':
            case 'authorizeOrg':

                if ( panelState.scratchOrgStateMessage?.isRunning ) {
                    return undefined;
                }

                // A METADATA DEPLOY (#346) DEPLOYS TO THE ORG SELECTED, WHICH THE RUN WOULD CHANGE; A RETRIEVE DOES NOT HOLD IT, SINCE THE RUN DEPLOYS NOTHING (#358)
                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || ( panelState.insertStateMessage || hub.isSelectionHeldByPromptOrUpdater(panelState) ) || panelState.permissionSetAssignStateMessage?.isRunning || panelState.metadataDeployStateMessage?.isRunning ) {
                    return {
                        kind: 'postScratchOrgState',
                        hostMessage: panelState.scratchOrgStateMessage ?? { command: 'scratchOrgState', isRunning: false }
                    };
                }

                return { kind: panelMessage.command };

            /*
                "Generate fake data and insert" (#255) posts the tree's KEY and nothing else, and it is
                not taken on the panel's word: the tree must be one the confirmed-drawn model drew the
                button on, an org must be selected now, and that org must have answered that it is a
                sandbox. A forged message for a production org stops here, before any connection.
                Which org, which recipe file and which counts are the host's own.
            */
            case 'insertTree': {

                const { treeKey } = panelMessage;

                // AN INSERT IN FLIGHT HOLDS ITS OWN TREE'S BUTTON; A CLICK ON ANOTHER IS ANSWERED WITH IT, SO THAT CARD GIVES ITS BUTTON BACK
                if ( panelState.insertStateMessage ) {
                    return panelState.insertStateMessage.treeKey === treeKey
                        ? undefined
                        : { kind: 'postInsertState', hostMessage: panelState.insertStateMessage };
                }

                const recipeFilePath = typeof treeKey === 'string' ? panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey) : undefined;

                /*
                    The record types ticked under Manage record types ride with the click (#623): NAMES
                    only, each pair matched against what the confirmed-drawn model offered. One name
                    it did not offer refuses the whole insert, rather than generating something
                    other than what was ticked.
                */
                const postedRecordTypeSelection = panelMessage.recordTypeSelection;
                const recordTypeSelection = postedRecordTypeSelection === undefined
                    ? undefined
                    : this.readPostedRecordTypeSelection(hub, postedRecordTypeSelection, panelState.treeHistoryAllowLists.selectableRecordTypeKeys);
                const recordTypeTicks = recordTypeSelection
                    ? { recordTypeSelection: recordTypeSelection, ...( panelMessage.isRemembered === true ? { isRemembered: true as const } : {} ) }
                    : {};

                // A SCRATCH ORG RUN IS ABOUT TO CHANGE THE SELECTION, SO NOTHING IS INSERTED WHILE IT IS IN FLIGHT
                const isTreeRoutable = ( postedRecordTypeSelection === undefined || !!recordTypeSelection )
                                        && !panelState.scratchOrgStateMessage?.isRunning
                                        && !hub.isSelectionHeldByPromptOrUpdater(panelState)
                                        && !panelState.permissionSetAssignStateMessage?.isRunning
                                        && !panelState.metadataDeployStateMessage?.isRunning
                                        && typeof treeKey === 'string'
                                        && !!panelState.recipeDataMessage
                                        && panelState.insertableTreeKeys.has(treeKey)
                                        && !!recipeFilePath;

                if ( isTreeRoutable && panelState.dataOrgSelection?.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'insertTree', treeKey: treeKey as string, recipeFilePath: recipeFilePath, ...recordTypeTicks };
                }

                // NO ORG CHOSEN YET (#375): THE ORG IS ASKED FOR IN THE COMMAND PALETTE, CHECKED AS A PICK IN THE DROPDOWN IS, AND ONLY THEN INSERTED INTO
                // THE OBJECTS A SELECTION CHECKS ARE THE CONFIRMED-DRAWN MODEL'S, AS FOR A PICK IN THE DROPDOWN
                if ( isTreeRoutable && !panelState.dataOrgSelection && panelState.dataOrgObjectApiNames.size > 0 ) {
                    return { kind: 'promptInsertOrg', treeKey: treeKey as string, recipeFilePath: recipeFilePath, ...recordTypeTicks };
                }

                // THE PANEL DISABLED THE CARD'S BUTTON ON THE CLICK, SO EVEN A REFUSAL ANSWERS THAT NOTHING RUNS
                return {
                    kind: 'postInsertState',
                    hostMessage: { command: 'insertState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' }
                };

            }

            /*
                "Open in browser" (#279) names the org by INDEX, and only the org SELECTED now is
                opened: an index the panel could have kept from an older listing, or any other org
                the list holds, is refused. Which username is the host's. A refusal still answers,
                since the panel disabled the button on the click; a second click while one open is
                in flight starts nothing and is told the open is running, and the first one's answer
                re-enables the button.
            */
            case 'openDataOrg': {

                const { orgIndex } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                // A RELOADED DOCUMENT MAY NOT KNOW AN OPEN IS RUNNING: IT IS TOLD, AND THE FIRST OPEN'S ANSWER RE-ENABLES IT
                if ( panelState.isOrgOpenInFlight ) {
                    return { kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: true } };
                }

                if ( typeof orgIndex !== 'number'
                        || !Number.isInteger(orgIndex)
                        || !panelState.recipeDataMessage
                        || panelState.dataOrgObjectApiNames.size === 0
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning
                        || !dataOrgSelection
                        || dataOrgSelection.orgIndex !== orgIndex
                        || panelState.dataOrgDetails[orgIndex]?.username !== dataOrgSelection.orgDetail.username ) {
                    return { kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: false } };
                }

                return { kind: 'openDataOrg', orgDetail: dataOrgSelection.orgDetail };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForTreecipeOrgTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitTreecipeOrgPanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'loadDataOrgs':

                await RecipeCockpitTreecipeDataOrgs.loadDataOrgs(hub, cockpitPanel, panelState);
                return;

            case 'selectDataOrg':

                await RecipeCockpitTreecipeDataOrgs.selectDataOrg(hub, cockpitPanel, panelState, panelAction.orgIndex);
                return;

            case 'refreshDataOrgs':

                await RecipeCockpitTreecipeDataOrgs.loadDataOrgs(hub, cockpitPanel, panelState, true);
                return;

            case 'refuseDataOrgListing':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'insertTree':

                await RecipeCockpitTreecipeInsert.insertTreeIntoOrg(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'promptInsertOrg':

                await RecipeCockpitTreecipeInsert.insertTreeIntoPromptedOrg(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'createScratchOrg':

                await RecipeCockpitTreecipeDataOrgs.createScratchOrgFromPanel(hub, cockpitPanel);
                return;

            case 'authorizeOrg':

                await RecipeCockpitTreecipeDataOrgs.authorizeOrgFromPanel(hub, cockpitPanel);
                return;

            case 'postScratchOrgState':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'openDataOrg':

                await RecipeCockpitTreecipeDataOrgs.openDataOrgInBrowser(hub, panelState, panelAction.orgDetail);
                return;

            case 'postOrgOpenState':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

        }

    }

    private static refuseDataOrgListingWhileHeld(hub: IRecipeCockpitHubForTreecipeOrgTab, panelState: IRecipeCockpitPanelState): Extract<RecipeCockpitTreecipeOrgPanelAction, { kind: 'refuseDataOrgListing' }> | undefined {

        const holdingRun = hub.describeSelectionHoldingRun(panelState);

        if ( !holdingRun || !panelState.recipeDataMessage ) {
            return undefined;
        }

        return {
            kind: 'refuseDataOrgListing',
            hostMessage: {
                command: 'dataOrgListingRefused',
                renderSequence: panelState.recipeDataMessage.renderSequence,
                message: `${holdingRun}${RECIPE_COCKPIT_DATA_ORG_LISTING_HELD_REFUSAL_SUFFIX}`
            }
        };

    }

    /*
        A posted record type selection (#195): a plain object of object api name -> developer names,
        every pair one the confirmed-drawn model offered, each object's list non-empty and without
        repeats. Anything else is undefined -- the request is refused, never trimmed to what passed.
        The map it answers has no prototype, so an object named "__proto__" stays a key.
    */
    static readPostedRecordTypeSelection(hub: IRecipeCockpitHubForTreecipeOrgTab, postedSelection: unknown, selectableRecordTypeKeys: Set<string>): Record<string, string[]> | undefined {

        if ( !hub.isPlainRecord(postedSelection) ) {
            return undefined;
        }

        const recordTypeSelection: Record<string, string[]> = Object.create(null);

        for ( const objectApiName of Object.keys(postedSelection) ) {

            const developerNames: unknown = postedSelection[objectApiName];

            if ( !Array.isArray(developerNames)
                    || developerNames.length === 0
                    || new Set(developerNames).size !== developerNames.length
                    || !developerNames.every(developerName => typeof developerName === 'string'
                                                                && selectableRecordTypeKeys.has(hub.buildSelectableRecordTypeKey(objectApiName, developerName))) ) {
                return undefined;
            }

            recordTypeSelection[objectApiName] = [...developerNames as string[]];

        }

        return recordTypeSelection;

    }

}
