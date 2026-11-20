import * as vscode from 'vscode';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeCockpitQueryHost } from './RecipeCockpitQueryHost';
import { RecipeCockpitRecordLinks } from './RecipeCockpitRecordLinks';
import type { IRecipeCockpitOpenableRecordPreview } from './RecipeCockpitRecordLinks';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type {
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    RecipeCockpitService
} from './RecipeCockpitService';

/*
    Opening a preview row's record (#556; moved out of the hub by #668): the router case and the two
    actions, shared by the Query and Treecipe Adapter tabs. Only the row's own Id is opened, in the
    org the preview was read from, and only while the data it was drawn from is still held.
*/

// WHAT OPENING A PREVIEW ROW'S RECORD READS AND CALLS ON THE HUB, AND NOTHING ELSE
export type IRecipeCockpitHubForRecordLinks = Readonly<Pick<typeof RecipeCockpitService,
    'isSelectionHeldByPromptOrUpdater' |
    'openDataOrgInBrowser' |
    'recipeCockpitPanelState'>>;

/*
    A record Id opened from a preview (#556): every refusal is one of these FIXED texts, worded with no
    parentheses since a notification escapes them, and none names the org's address. The link's
    title is RECIPE_COCKPIT_RECORD_LINK_TITLE, in RecipeCockpitAdapterConstants.ts.
*/

export const RECIPE_COCKPIT_RECORD_LINK_BUSY_REFUSAL = 'The record was not opened: another run is using the org selection. Try again when it ends.';

export const RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL = 'The record was not opened: that preview is no longer the one on screen. Run the query or load the records again.';

export const RECIPE_COCKPIT_RECORD_LINK_ORG_GONE_REFUSAL = 'The record was not opened: the org it was read from is no longer in the org list. Choose it in Target Org Manager, then run the query or load the records again.';

export const RECIPE_COCKPIT_RECORD_LINK_OPEN_RUNNING_REFUSAL = 'The record was not opened: an org is already being opened in the browser. Try again when it has opened.';

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_RECORD_LINKS_COMMANDS = [
    'openPreviewRecord'
] as const;

export const RECIPE_COCKPIT_RECORD_LINKS_ACTION_KINDS = [
    'openPreviewRecord',
    'refuseOpenPreviewRecord'
] as const;

export type RecipeCockpitRecordLinksPanelAction =
    | { kind: 'openPreviewRecord'; preview: IRecipeCockpitOpenableRecordPreview; recordId: string; orgDetail: IAuthenticatedOrgDetail }
    | { kind: 'refuseOpenPreviewRecord'; refusalText: string };

export class RecipeCockpitRecordLinksHost {

    static isRecordLinksCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_RECORD_LINKS_COMMANDS.some(ownedCommand => ownedCommand === command);
    }

    static isRecordLinksPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitRecordLinksPanelAction {
        return RECIPE_COCKPIT_RECORD_LINKS_ACTION_KINDS.some(ownedActionKind => ownedActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: THE HUB'S CHECKS IT READS ARE FUNCTIONS OF THE STATE PASSED
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForRecordLinks): RecipeCockpitRecordLinksPanelAction | undefined {

        switch ( panelMessage.command ) {

            /*
                A record Id clicked in a preview (#556) names its PREVIEW and ROW, never an Id, a URL or
                an org: the Id is the one the host keeps for that row, and the org the one it was read
                from. A message out of shape is dropped without a word; a preview no longer on screen,
                a run holding the selection, or an org gone from the list is a fixed warning.
            */
            case 'openPreviewRecord': {

                const { recordLinkSequence, objectApiName, rowIndex } = panelMessage;

                if ( typeof recordLinkSequence !== 'number'
                        || !Number.isInteger(recordLinkSequence)
                        || typeof rowIndex !== 'number'
                        || !Number.isInteger(rowIndex)
                        || rowIndex < 0
                        || ( objectApiName !== undefined && typeof objectApiName !== 'string' ) ) {
                    return undefined;
                }

                const preview = panelState.openableRecordPreviews.get(recordLinkSequence);

                if ( !preview
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || preview.renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return { kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL };
                }

                const recordIds = preview.recordIdsByObjectApiName.get(typeof objectApiName === 'string' ? objectApiName : '');
                const recordId = recordIds && rowIndex < recordIds.length ? recordIds[rowIndex] : undefined;

                if ( recordId === undefined ) {
                    return undefined;
                }

                if ( panelState.insertStateMessage
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning
                        || hub.isSelectionHeldByPromptOrUpdater(panelState) ) {
                    return { kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_BUSY_REFUSAL };
                }

                if ( panelState.isOrgOpenInFlight ) {
                    return { kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_OPEN_RUNNING_REFUSAL };
                }

                const orgDetail = panelState.dataOrgDetails.find(candidateOrgDetail => candidateOrgDetail.username === preview.orgUsername);

                if ( !orgDetail ) {
                    return { kind: 'refuseOpenPreviewRecord', refusalText: RECIPE_COCKPIT_RECORD_LINK_ORG_GONE_REFUSAL };
                }

                return { kind: 'openPreviewRecord', preview: preview, recordId: recordId, orgDetail: orgDetail };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForRecordLinks, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitRecordLinksPanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'openPreviewRecord':

                await this.openPreviewRecordInBrowser(hub, panelState, panelAction.preview, panelAction.recordId, panelAction.orgDetail);
                return;

            case 'refuseOpenPreviewRecord':

                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                return;

        }

    }

    /*
        A record Id opened from a preview (#556): only while the data its preview was drawn from is
        still held, so a record the host let go -- a newer query, records an update spent, values a
        new generation replaced -- is never opened from an older row.
    */
    private static async openPreviewRecordInBrowser(hub: IRecipeCockpitHubForRecordLinks, panelState: IRecipeCockpitPanelState,
                                                    preview: IRecipeCockpitOpenableRecordPreview,
                                                    recordId: string,
                                                    orgDetail: IAuthenticatedOrgDetail) {

        const heldSource = preview.previewKind === 'query' ? RecipeCockpitQueryHost.heldResultForRecordLinks()
            : preview.previewKind === 'updaterRecords' ? RecipeCockpitAdapterState.heldUpdaterRecords
            : RecipeCockpitAdapterState.heldUpdaterValues;

        if ( heldSource === undefined || RecipeCockpitRecordLinks.readHeldSourceToken(heldSource) !== preview.heldSourceToken ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(RECIPE_COCKPIT_RECORD_LINK_STALE_REFUSAL));
            return;
        }

        await hub.openDataOrgInBrowser(panelState, orgDetail, recordId);

    }

}
