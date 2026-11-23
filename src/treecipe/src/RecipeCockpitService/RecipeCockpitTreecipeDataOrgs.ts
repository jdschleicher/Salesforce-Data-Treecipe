import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeDataOrgs
import type { RecipeCockpitService } from './RecipeCockpitService';
import type {
    IRecipeCockpitCreateReadinessByTarget,
    IRecipeCockpitCreateTarget,
    IRecipeCockpitDataOrgSelection,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeDataMessage,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitScratchOrgStateMessage,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitTroubleshootingFocusRequest
} from './RecipeCockpitViewModel';
import {
    IScratchOrgAliasChoice,
    IScratchOrgPlan,
    SCRATCH_ORG_DURATION_DAYS,
    SCRATCH_ORG_MAX_DURATION_DAYS,
    SCRATCH_ORG_MIN_DURATION_DAYS,
    ScratchOrgService,
    ScratchOrgSetupOutcome,
    ScratchOrgSetupPhase
} from '../ScratchOrgService/ScratchOrgService';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import {
    DevHubConfigSource,
    IDataOrgDetail,
    IDataOrgListing,
    IHiddenAuthorizedOrg,
    IHiddenOrgReasonCounts,
    IOrgDescribeSource,
    IOrgQuerySource,
    IOrgTypeDetail,
    NO_AUTHORIZED_ORGS_MESSAGE,
    OrgConnectionStatusUnavailableError,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import {
    RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
    RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
    RECIPE_COCKPIT_ORG_INSTANCE_URL_SEPARATOR
} from './RecipeCockpitDataOrgConstants';
import {
    AuthorizedOrgPlacement,
    IOrgAuthorizePlan,
    IOrgAuthorizeResult,
    RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PLACEHOLDER,
    RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PROMPT,
    RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_DEFAULT_CHECKBOX_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PLACEHOLDER,
    RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT,
    RecipeCockpitOrgAuthorize
} from './RecipeCockpitOrgAuthorize';
import {
    IOrgLoginRun,
    OrgLoginMethod,
    OrgLoginOutcome,
    SalesforceOrgLogin
} from '../SalesforceOrgService/SalesforceOrgLogin';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import type { Connection } from '@salesforce/core';
import {
    ICreateReadinessInput,
    IRecipeCockpitCreateReadinessViewModel,
    RecipeCockpitRecordCreation
} from './RecipeCockpitRecordCreation';
import {
    RecipeBlockFieldListResult,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import { IDataSetInsertResult } from '../CollectionsApiService/CollectionsApiService';
import { RecipeCockpitInsertFailureTriage } from '../InsertFailureTriage/RecipeCockpitInsertFailureTriage';
import { RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS } from './RecipeCockpitTroubleshootingConstants';
import {
    IRecordTypeSetOutcome,
    RecipeCockpitRecordTypeSets
} from './RecipeCockpitRecordTypeSets';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';

/*
    Target Org Manager (moved out of the hub by #669 part a): the org list and its refusals, a
    selection and its connection check, the org remembered per workspace, "+ New scratch org" and
    "Authorize org" with the one run per window they share, Open org with its one open per window, a
    card's create readiness and the objects its insert would create, the org asked for when none is
    chosen, and the notification a tree insert or a data set row's insert ends in. It loads no other
    host, so every tab that needs the picker reads it from here.
*/

/*
    What the Target Org Manager's file reads and calls on the hub, and nothing else. The Data Sets,
    Treecipe Adapter, Troubleshooting and record link hosts call this file's picker, org list, open
    and insert notification with their own hub, so their hub types include this one.
*/
export type IRecipeCockpitHubForTreecipeDataOrgs = Readonly<Pick<typeof RecipeCockpitService,
    'confirmInPanel' |
    'confirmInPanelWithCheckbox' |
    'isUsableWorkspacePath' |
    'listExcludedObjectApiNames' |
    'postToPanel' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'recipeCockpitWorkspaceState' |
    'toSingleLine'>>;

// A FAILED INSERT'S "Open Troubleshooting" (#375) OPENS A CLOSED COCKPIT THROUGH ITS OWN COMMAND, SO THE FEATURE FLAG STILL DECIDES
export const RECIPE_COCKPIT_OPEN_COMMAND = 'treecipe.openRecipeCockpit';

export const RECIPE_COCKPIT_HIDDEN_ORGS_NOTE = "The Treecipe tab lists only sandboxes and scratch orgs that answer when checked, plus the CLI's default org, and inserts only into a sandbox or scratch org.";

// THE PALETTE COMMANDS KEEP NO_AUTHORIZED_ORGS_MESSAGE: ONLY THE COCKPIT HAS THE BUTTON TO POINT AT (#630)
export const RECIPE_COCKPIT_NO_AUTHORIZED_ORGS_MESSAGE = 'No authorized Salesforce orgs were found. Press Authorize org, or run "sf org login web --instance-url https://test.salesforce.com", and try again.';

export const RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE = 'No sandbox or scratch org is authorized. The Treecipe tab connects only to sandboxes and scratch orgs: press Authorize org, or run "sf org login web --instance-url https://test.salesforce.com", and try again.';

export const RECIPE_COCKPIT_DEFAULT_ORG_SUFFIX = ' (default)';

export const RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE = 'No connected sandbox or scratch org is authorized. The Treecipe tab lists only orgs that answer when checked: press Authorize org, or run "sf org login web --instance-url https://test.salesforce.com", then press ⟳.';

export const RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL = 'Create with Salesforce CLI';

// #507: THE SAME CREATE THROUGH @salesforce/core, OFFERED ONLY WHEN IT WOULD MAKE THE SAME ORG
export const RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CONFIRM_LABEL = 'Create with @salesforce/core';

// NO CANCEL STOPS IT, SO THE PROGRESS SAYS HOW LONG IT MAY HOLD THE ORG PICKER
export const RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CREATING_TEXT = 'Creating scratch org with @salesforce/core… this can take several minutes and cannot be cancelled.';

export const RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER = 'Choose the Dev Hub to create the scratch org through';

// #279: THE READER NAMES THE ORG; THERE IS NO DEFAULT ALIAS, SO THE PLACEHOLDER IS ONLY AN EXAMPLE
export const RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PROMPT = 'Alias for the new scratch org: the name the Salesforce CLI, the org picker and later commands will know it by.';

export const RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PLACEHOLDER = 'for example qa-accounts';

export const RECIPE_COCKPIT_SCRATCH_ORG_DURATION_PROMPT = `How many days the new scratch org lives: ${SCRATCH_ORG_MIN_DURATION_DAYS} to ${SCRATCH_ORG_MAX_DURATION_DAYS} days (Salesforce's maximum is ${SCRATCH_ORG_MAX_DURATION_DAYS}).`;

export const RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL = 'Copy deploy command';

export const RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT: Record<ScratchOrgSetupPhase | 'listing', string> = {
    creating: 'Creating scratch org…',
    listing: 'Listing the new scratch org…'
};

// A FAILED INSERT'S OTHER TWO BUTTONS (#375): THE FIRST GENERATED FILE THAT FAILED, AND THE CARD'S TROUBLESHOOTING TAB
export const RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL = 'View failed file';

export const RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL = 'Open Troubleshooting';

export const RECIPE_COCKPIT_DATA_ORG_STATE_KEY = 'treecipe.recipeCockpit.dataByOrgUsername';

export class RecipeCockpitTreecipeDataOrgs {

    // EVERY OBJECT A TREE CARD LISTS, ONCE -- A LATER OCCURRENCE OF AN OBJECT IS THE SAME OBJECT IN THE ORG
    static collectDataOrgObjectApiNames(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return [...new Set(recipeViewModel.trees.flatMap(tree => tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .map(treeObject => treeObject.objectApiName)))];

    }

    // BY ALIAS, OR BY USERNAME WHEN THE ORG HAS NONE
    static buildDataOrgLabel(orgDetail: IAuthenticatedOrgDetail): string {

        return orgDetail.alias || orgDetail.username;

    }

    // THE DROPDOWN'S LABEL: THE CLI'S DEFAULT ORG SAYS SO (#305)
    static buildDataOrgListLabel(orgDetail: IDataOrgDetail): string {

        return this.buildDataOrgLabel(orgDetail) + ( orgDetail.isDefault === true ? RECIPE_COCKPIT_DEFAULT_ORG_SUFFIX : '' );

    }

    // THE PICKER'S LABEL (#678): "alias -- instance url", THEN " (default)"; AN ORG WITH NO INSTANCE URL IS ITS ALIAS ALONE
    static buildDataOrgPickerLabel(orgDetail: IDataOrgDetail): string {

        const instanceUrlPart = orgDetail.instanceUrl ? RECIPE_COCKPIT_ORG_INSTANCE_URL_SEPARATOR + orgDetail.instanceUrl : '';
        return this.buildDataOrgLabel(orgDetail) + instanceUrlPart + ( orgDetail.isDefault === true ? RECIPE_COCKPIT_DEFAULT_ORG_SUFFIX : '' );

    }

    /*
        What the dropdown shows while the connections are checked: the org chosen last, else the
        CLI's default. Read locally; a read that fails shows nothing rather than holding the check.
    */
    private static async readProvisionalDataOrgDetail(hub: IRecipeCockpitHubForTreecipeDataOrgs, panelState: IRecipeCockpitPanelState): Promise<IDataOrgDetail | undefined> {

        try {
            return await SalesforceOrgService.readLocalDataOrgDetail(panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername(hub), panelState.workspaceRoot);
        } catch {
            return undefined;
        }

    }

    private static readRememberedDataOrgUsername(hub: IRecipeCockpitHubForTreecipeDataOrgs): string | undefined {

        try {
            const rememberedUsername = hub.recipeCockpitWorkspaceState?.get<unknown>(RECIPE_COCKPIT_DATA_ORG_STATE_KEY);
            return typeof rememberedUsername === 'string' && rememberedUsername ? rememberedUsername : undefined;
        } catch {
            return undefined;
        }

    }

    // A FAILED WRITE ONLY MEANS THE NEXT OPEN DOES NOT PRESELECT -- NOTHING THE READER HAS TO BE TOLD
    static rememberDataOrgUsername(hub: IRecipeCockpitHubForTreecipeDataOrgs, orgUsername: string | undefined) {

        try {
            Promise.resolve(hub.recipeCockpitWorkspaceState?.update(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, orgUsername)).catch(() => undefined);
        } catch {
            return;
        }

    }

    /*
        Lists the orgs and, when the org chosen last is still among them, selects it. Listing asks
        the Salesforce CLI which authorized orgs are connected, which pings each one's token -- once
        per session, or per ⟳ (isRefresh), since the answer is cached in SalesforceOrgService. The
        extension itself contacts only the org selected.

        The list in hand is dropped BEFORE the check, so no org can be selected until it answers; a
        new model, a ready or a later listing bumps dataOrgRequestSequence meanwhile, and the answer
        is then discarded rather than drawn over whatever replaced it. While it runs, the org chosen
        last (else the CLI's default) is posted as dataOrgProvisional, a label read from local files
        (#305). A remembered org that the CLI now reports expired, deleted or not connected is
        forgotten, and the view says so once; with no remembered org listed, the default is selected.
    */
    // keepUnlistedUsername: A SCRATCH ORG JUST CREATED THE CLI DOES NOT LIST YET IS STILL THE ONE TO SELECT ONCE IT DOES
    static async loadDataOrgs(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, isRefresh = false, keepUnlistedUsername = false) {

        const listedRecipeDataMessage = panelState.recipeDataMessage;
        panelState.dataOrgDetails = [];
        panelState.dataOrgSelection = undefined;
        const listingRequestSequence = ++panelState.dataOrgRequestSequence;

        const isListingCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                        && hub.recipeCockpitPanelState === panelState
                                        && panelState.recipeDataMessage === listedRecipeDataMessage
                                        && panelState.dataOrgRequestSequence === listingRequestSequence;

        // THE CHECK STARTS FIRST: THE LOCAL READ OF THE ORG SHOWN MEANWHILE MUST NEVER DELAY IT
        const dataOrgListingRequest = ( async () => {
            if ( isRefresh ) {
                await SalesforceOrgService.refreshConnectedOrgAuthorizations();
            }
            return await SalesforceOrgService.listDataOrgDetails(panelState.workspaceRoot);
        } )();
        dataOrgListingRequest.catch(() => undefined);

        const provisionalOrgDetail = await this.readProvisionalDataOrgDetail(hub, panelState);

        if ( provisionalOrgDetail && isListingCurrent() ) {
            hub.postToPanel(cockpitPanel, {
                command: 'dataOrgProvisional',
                orgLabel: this.buildDataOrgListLabel(provisionalOrgDetail),
                requestSequence: listingRequestSequence,
                renderSequence: listedRecipeDataMessage.renderSequence
            });
        }

        let orgDetails: IDataOrgDetail[] = [];
        let hiddenOrgs: IHiddenAuthorizedOrg[] = [];
        let hiddenOrgNote = '';
        let noOrgsMessage = NO_AUTHORIZED_ORGS_MESSAGE;
        let isListed = false;

        try {

            const dataOrgListing = await dataOrgListingRequest;
            isListed = true;
            orgDetails = dataOrgListing.orgDetails;
            hiddenOrgs = dataOrgListing.hiddenOrgs;
            hiddenOrgNote = this.buildDataOrgHiddenNote(dataOrgListing.hiddenOrgReasonCounts);
            noOrgsMessage = this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts);

        } catch (listError) {

            noOrgsMessage = listError instanceof OrgConnectionStatusUnavailableError
                ? listError.message
                : `The authorized Salesforce orgs could not be listed: ${listError?.message ?? listError}`;

        }

        if ( !isListingCurrent() ) {
            return;
        }

        /*
            ⟳ forgets what was described in each org it listed (#537), once the listing has answered:
            a describe taken before a permission change, a deploy made elsewhere or a re-login would
            otherwise outlive it. A listing that failed lists nothing, so it forgets nothing.
        */
        if ( isRefresh && isListed ) {
            orgDetails.forEach(orgDetail => SalesforceOrgService.clearDescribeCacheForOrg(orgDetail.username));
        }

        panelState.dataOrgDetails = orgDetails;

        const rememberedUsername = panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername(hub);
        const rememberedOrgIndex = rememberedUsername ? orgDetails.findIndex(orgDetail => orgDetail.username === rememberedUsername) : -1;
        // THE ORG CHOSEN LAST WINS; WITH NONE LISTED, THE CLI'S DEFAULT IS SELECTED -- UNLESS A SCRATCH ORG JUST CREATED IS STILL TO BE
        const selectedOrgIndex = rememberedOrgIndex >= 0 || ( rememberedUsername && keepUnlistedUsername )
            ? rememberedOrgIndex
            : orgDetails.findIndex(orgDetail => orgDetail.isDefault === true);
        let forgottenOrgNotice = '';

        // CHECKED AGAINST THE REMEMBERED ORG ITSELF: FALLING BACK TO THE DEFAULT MUST NOT SKIP SAYING WHY THE LAST ONE WENT
        if ( rememberedUsername && rememberedOrgIndex === -1 && !keepUnlistedUsername ) {

            const disconnectedRememberedOrg = hiddenOrgs.find(hiddenOrg => hiddenOrg.username === rememberedUsername && hiddenOrg.reason !== 'production');

            if ( disconnectedRememberedOrg ) {
                forgottenOrgNotice = `The last org used, ${disconnectedRememberedOrg.label}, is no longer connected.`;
            }

            panelState.dataOrgUsername = undefined;
            this.rememberDataOrgUsername(hub, undefined);

        }

        hub.postToPanel(cockpitPanel, {
            command: 'dataOrgList',
            orgLabels: orgDetails.map(orgDetail => this.buildDataOrgListLabel(orgDetail)),
            orgPickerLabels: orgDetails.map(orgDetail => this.buildDataOrgPickerLabel(orgDetail)),
            selectedOrgIndex: selectedOrgIndex >= 0 ? selectedOrgIndex : null,
            noOrgsMessage: orgDetails.length === 0 ? noOrgsMessage : '',
            hiddenOrgNote: hiddenOrgNote,
            forgottenOrgNotice: forgottenOrgNotice,
            renderSequence: listedRecipeDataMessage.renderSequence
        });

        if ( selectedOrgIndex >= 0 ) {
            await this.selectDataOrg(hub, cockpitPanel, panelState, selectedOrgIndex);
        }

    }

    /*
        "+ New scratch org" (#200). The plan is resolved on the host and refused before any process
        when an input is missing; the modal names what was resolved, and Cancel runs nothing. Then
        the create alone runs under one cancellable notification (#358: nothing is deployed) -- or,
        when the reader picks "Create with @salesforce/core" (#507, offered only where it would make
        the same org), in the extension host under a notification with no Cancel -- and how
        the run ended is a notification with a "View output" button (#301). Once a username exists the org is kept whatever followed, and the
        connected-org cache is dropped BEFORE re-listing -- the session's cached connection check
        predates the org -- so it is selected by username from a fresh answer, or reported not
        listed yet with nothing selected in its place.

        One run per WINDOW, and its state is the window's too: a panel closed and reopened mid-run
        gets a fresh panel state, and without the static copy its router would let a second run, a
        Create or an org selection through while the first is still going. Every state the run
        posts goes to whichever panel the window has NOW. The closing state is posted last, because
        the panel disabled the button, every "+ Create" and the dropdown on the click.
    */
    static isScratchOrgSetupInFlight = false;

    private static scratchOrgRunStateMessage: IRecipeCockpitScratchOrgStateMessage | undefined;

    static async createScratchOrgFromPanel(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel) {

        await this.runHoldingOrgPicker(hub, cockpitPanel, { command: 'scratchOrgState', isRunning: true },
            () => this.performScratchOrgSetup(hub, hub.recipeCockpitPanelState.workspaceRoot));

    }

    // "Authorize org" (#630) RUNS UNDER THE SCRATCH ORG RUN'S LOCK: BOTH ADD AN ORG TO THE PICKER, AND ONLY ONE DOES AT A TIME
    static async authorizeOrgFromPanel(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel) {

        await this.runHoldingOrgPicker(hub, cockpitPanel, { command: 'scratchOrgState', isRunning: true, isAuthorizing: true },
            () => this.performOrgAuthorize(hub, hub.recipeCockpitPanelState.workspaceRoot));

    }

    private static async runHoldingOrgPicker(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel,
                                                runningStateMessage: IRecipeCockpitScratchOrgStateMessage,
                                                performRun: () => Promise<void>) {

        // A PANEL THAT DID NOT KNOW A RUN WAS GOING HAS ALREADY DISABLED ITS BUTTON, SO IT IS TOLD WHERE THE RUN IS
        if ( this.isScratchOrgSetupInFlight ) {
            if ( this.scratchOrgRunStateMessage ) {
                hub.recipeCockpitPanelState.scratchOrgStateMessage = this.scratchOrgRunStateMessage;
                hub.postToPanel(cockpitPanel, this.scratchOrgRunStateMessage);
            }
            return;
        }

        this.isScratchOrgSetupInFlight = true;
        this.setScratchOrgState(hub, runningStateMessage);

        try {

            await performRun();

        } finally {

            this.isScratchOrgSetupInFlight = false;
            this.setScratchOrgState(hub, { command: 'scratchOrgState', isRunning: false });

        }

    }

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setScratchOrgState(hub: IRecipeCockpitHubForTreecipeDataOrgs, scratchOrgStateMessage: IRecipeCockpitScratchOrgStateMessage) {

        this.scratchOrgRunStateMessage = scratchOrgStateMessage.isRunning ? scratchOrgStateMessage : undefined;
        hub.recipeCockpitPanelState.scratchOrgStateMessage = scratchOrgStateMessage;

        if ( hub.recipeCockpitPanel ) {
            hub.postToPanel(hub.recipeCockpitPanel, scratchOrgStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE A RUN IS GOING STARTS FROM THE RUN'S STATE, SO ITS ROUTER REFUSES WHAT THE RUN HOLDS
    static adoptScratchOrgRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isScratchOrgSetupInFlight && this.scratchOrgRunStateMessage ) {
            panelState.scratchOrgStateMessage = this.scratchOrgRunStateMessage;
        }

    }

    /*
        "Authorize org" (#630): a browser login to an existing org, run by "sf org login web" or by
        @salesforce/core in VS Code, as the confirmation's button says. The login address and the
        alias are asked by VS Code, as "+ New scratch org" asks its alias; the panel confirms, and its
        one checkbox asks for the org to be selected and made this workspace's default org. Both answers are checked again after the confirmation.
        Only an org the fresh listing shows -- a sandbox or scratch org that answered its ping --
        is selected or made the default. How the login ended is one notification.
    */
    private static async performOrgAuthorize(hub: IRecipeCockpitHubForTreecipeDataOrgs, workspaceRoot: string): Promise<void> {

        const authorizePlan = await this.promptForOrgAuthorizePlan();

        if ( !authorizePlan ) {
            return;
        }

        const confirmation = await hub.confirmInPanelWithCheckbox(
            RecipeCockpitOrgAuthorize.buildConfirmMessage(authorizePlan),
            { ...RecipeCockpitOrgAuthorize.buildConfirmContent(authorizePlan), checkboxLabel: RECIPE_COCKPIT_AUTHORIZE_ORG_DEFAULT_CHECKBOX_LABEL },
            RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL,
            RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL
        );

        const loginMethod: OrgLoginMethod | undefined = confirmation.chosenLabel === RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL
            ? 'salesforceCli'
            : confirmation.chosenLabel === RECIPE_COCKPIT_AUTHORIZE_ORG_LIBRARY_CONFIRM_LABEL ? 'coreLibrary' : undefined;

        if ( loginMethod === undefined ) {
            return;
        }

        const loginUrl = SalesforceOrgLogin.buildSandboxLoginUrl(authorizePlan.loginUrl);
        const alias = authorizePlan.alias;

        if ( loginUrl === undefined || ( alias !== undefined && RecipeCockpitOrgAuthorize.validateAlias(alias) !== undefined ) ) {
            return;
        }

        const isDefaultRequested = confirmation.isChecked === true;

        const loginOutcome: OrgLoginOutcome = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Recipe Cockpit: authorize org at ${RecipeCockpitOrgAuthorize.buildLoginHostName(loginUrl)}`,
            cancellable: true
        }, async (progress, cancellationToken) => {

            progress.report({ message: 'Waiting for you to log in in your browser…' });

            const loginRun: IOrgLoginRun = {
                onCancellationRequested: cancelLogin => {
                    cancellationToken.onCancellationRequested(cancelLogin);
                    if ( cancellationToken.isCancellationRequested ) {
                        cancelLogin();
                    }
                }
            };

            return loginMethod === 'salesforceCli'
                ? await SalesforceOrgLogin.authorizeWithSalesforceCli(loginUrl, loginRun)
                : await SalesforceOrgLogin.authorizeWithCoreLibrary(loginUrl, {
                    ...loginRun,
                    openLoginPage: authorizationUrl => vscode.env.openExternal(vscode.Uri.parse(authorizationUrl, true))
                });

        });

        const showAuthorizeNotification = (listedDetail: Partial<IOrgAuthorizeResult> = {}) => {
            const notification = RecipeCockpitOrgAuthorize.buildNotification({
                loginOutcome: loginOutcome,
                ...( alias !== undefined ? { alias: alias } : {} ),
                isDefaultRequested: isDefaultRequested,
                ...listedDetail
            });
            VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(notification.severity, RecipeYamlScalar.escapeForNotification(notification.text), [], workspaceRoot);
        };

        if ( loginOutcome.kind !== 'authorized' ) {
            showAuthorizeNotification();
            return;
        }

        const username = loginOutcome.username;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Recipe Cockpit: authorize org'
        }, async progress => {

            progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT.listing });

            const placement = await this.findAuthorizedOrgPlacement(username);

            // AN ALIAS IS SET, AND A HELD ONE MOVED, ONLY ONTO A SANDBOX OR SCRATCH ORG: NEVER SILENTLY ONTO PRODUCTION
            if ( placement !== 'listed' ) {
                await this.relistDataOrgs(hub, undefined);
                showAuthorizeNotification({ placement: placement });
                return;
            }

            const aliasFailureMessage = alias === undefined ? undefined : await SalesforceOrgLogin.setAlias(alias, username);
            // THE ALIAS WHEN IT LANDED, AS "sf config set target-org" WOULD STORE IT; ELSE THE USERNAME
            const targetOrgIdentifier = alias !== undefined && aliasFailureMessage === undefined ? alias : username;
            const targetOrgWrite = isDefaultRequested ? SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, targetOrgIdentifier) : undefined;
            // SF_TARGET_ORG IS READ BEFORE THE WORKSPACE CONFIG, SO THE WRITE ALONE MAY NOT CHANGE THE DEFAULT
            const resolvedDefaultOrgIdentifier = targetOrgWrite?.isWritten === true
                ? SalesforceOrgService.readDefaultTargetOrgIdentifier(workspaceRoot)?.identifier
                : undefined;

            await this.relistDataOrgs(hub, isDefaultRequested ? username : undefined);

            showAuthorizeNotification({
                placement: placement,
                ...( aliasFailureMessage !== undefined ? { aliasFailureMessage: aliasFailureMessage } : {} ),
                ...( targetOrgWrite ? { targetOrgWrite: targetOrgWrite } : {} ),
                ...( resolvedDefaultOrgIdentifier !== undefined && resolvedDefaultOrgIdentifier !== targetOrgIdentifier ? { overridingDefaultOrgIdentifier: resolvedDefaultOrgIdentifier } : {} )
            });

        });

    }

    // THE CONNECTION CHECK IN HAND PREDATES THE LOGIN, SO IT IS DROPPED FIRST; THE LISTING HERE IGNORES THE WORKSPACE DEFAULT, WHICH IS LISTED WHATEVER ITS TYPE
    private static async findAuthorizedOrgPlacement(username: string): Promise<AuthorizedOrgPlacement> {

        SalesforceOrgService.clearConnectedOrgStatusCache();

        try {

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();

            if ( dataOrgListing.orgDetails.some(orgDetail => orgDetail.username === username) ) {
                return 'listed';
            }

            return dataOrgListing.hiddenOrgs.some(hiddenOrg => hiddenOrg.username === username && hiddenOrg.reason === 'production')
                ? 'notSandboxOrScratch'
                : 'notConnected';

        } catch {
            return 'notConnected';
        }

    }

    // DRAWS THE FRESH LISTING IN A WINDOW WITH A DRAWN PICKER; A USERNAME GIVEN IS REMEMBERED AND SELECTED, ELSE THE SELECTION IS KEPT
    private static async relistDataOrgs(hub: IRecipeCockpitHubForTreecipeDataOrgs, selectedUsername: string | undefined): Promise<void> {

        if ( selectedUsername !== undefined ) {
            this.rememberDataOrgUsername(hub, selectedUsername);
        }

        const cockpitPanel = hub.recipeCockpitPanel;
        const panelState = hub.recipeCockpitPanelState;

        if ( !cockpitPanel || !panelState.recipeDataMessage ) {
            return;
        }

        if ( selectedUsername !== undefined ) {
            panelState.dataOrgUsername = selectedUsername;
        }

        await this.loadDataOrgs(hub, cockpitPanel, panelState, false, selectedUsername !== undefined);

    }

    // ESCAPE AT EITHER QUESTION IS A CANCEL
    private static async promptForOrgAuthorizePlan(): Promise<IOrgAuthorizePlan | undefined> {

        const typedSubdomain = await vscode.window.showInputBox({
            title: RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
            prompt: RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT,
            placeHolder: RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PLACEHOLDER,
            ignoreFocusOut: true,
            validateInput: (typedText: string) => SalesforceOrgLogin.validateSandboxSubdomain(typedText)
        });
        const loginUrl = SalesforceOrgLogin.buildSandboxLoginUrl(typedSubdomain);

        if ( loginUrl === undefined ) {
            return undefined;
        }

        let aliasHolders = new Map<string, string>();

        try {
            aliasHolders = await SalesforceOrgService.listAliasHolders();
        } catch {
            // NO WARNING TO GIVE: THE LOGIN ITSELF STILL WORKS
        }

        const enteredAlias = await vscode.window.showInputBox({
            title: RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
            prompt: RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PROMPT,
            placeHolder: RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PLACEHOLDER,
            ignoreFocusOut: true,
            validateInput: (typedAlias: string) => this.validateOrgAuthorizeAliasInput(typedAlias, aliasHolders)
        });

        if ( enteredAlias === undefined ) {
            return undefined;
        }

        const alias = enteredAlias.trim();

        if ( alias === '' ) {
            return { loginUrl: loginUrl };
        }

        const aliasHolderUsername = aliasHolders.get(alias);

        return { loginUrl: loginUrl, alias: alias, ...( aliasHolderUsername ? { aliasHolderUsername: aliasHolderUsername } : {} ) };

    }

    // AN INPUT BOX'S MESSAGE RENDERS [label](command:...) AS A NOTIFICATION DOES, SO THE HOLDER'S USERNAME IS ESCAPED
    static validateOrgAuthorizeAliasInput(typedAlias: string, aliasHolders: Map<string, string>): string | vscode.InputBoxValidationMessage | undefined {

        const alias = String(typedAlias ?? '').trim();
        const aliasRefusal = RecipeCockpitOrgAuthorize.validateAlias(alias);

        if ( aliasRefusal ) {
            return aliasRefusal;
        }

        const aliasHolderUsername = aliasHolders.get(alias);

        return aliasHolderUsername
            ? {
                message: RecipeYamlScalar.escapeForNotification(`"${alias}" is currently ${aliasHolderUsername}. Authorizing will move it to the org you log in to.`),
                severity: vscode.InputBoxValidationSeverity.Warning
            }
            : undefined;

    }

    private static async performScratchOrgSetup(hub: IRecipeCockpitHubForTreecipeDataOrgs, workspaceRoot: string): Promise<void> {

        let scratchOrgPlan: IScratchOrgPlan | undefined;

        try {
            scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(
                workspaceRoot,
                () => VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
                    SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot),
                    RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER
                ),
                () => this.promptForScratchOrgAlias(),
                () => this.promptForScratchOrgDurationDays()
            );
        } catch (planError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(String(planError?.message ?? planError)));
            return;
        }

        // NO DEV HUB PICKED -- DISMISSED, OR NONE TO OFFER, WHICH THE PICKER HAS ALREADY SAID -- OR NO ALIAS ENTERED, IS A CANCEL
        if ( !scratchOrgPlan ) {
            return;
        }

        const devHubLabel = hub.toSingleLine(this.buildDevHubLabel(scratchOrgPlan));
        const libraryRefusal = ScratchOrgService.findLibraryCreateRefusal(workspaceRoot);

        const confirmation = await hub.confirmInPanel(
            `Create a scratch org through the Dev Hub ${devHubLabel}? Nothing is deployed to it.`,
            { ...this.buildScratchOrgConfirmationContent(hub, scratchOrgPlan, libraryRefusal), isDestructive: true },
            RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL,
            ...( libraryRefusal ? [] : [RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CONFIRM_LABEL] )
        );

        if ( confirmation !== RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL && ( libraryRefusal || confirmation !== RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CONFIRM_LABEL ) ) {
            return;
        }

        // NOTHING IN scratchOrgCreate STOPS A POLL, SO THAT PROGRESS OFFERS NO CANCEL IT COULD NOT HONOUR
        const setupOutcome: ScratchOrgSetupOutcome = confirmation === RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CONFIRM_LABEL
            ? await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Recipe Cockpit: scratch org ${scratchOrgPlan.alias}`,
                cancellable: false
            }, async progress => await ScratchOrgService.runScratchOrgSetupWithLibrary(scratchOrgPlan, {
                onPhase: () => {
                    progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_LIBRARY_CREATING_TEXT });
                }
            }))
            : await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Recipe Cockpit: scratch org ${scratchOrgPlan.alias}`,
            cancellable: true
        }, async (progress, cancellationToken) => {

            let killCurrentProcess: (() => void) | undefined;
            cancellationToken.onCancellationRequested(() => killCurrentProcess?.());

            return await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, {
                onPhase: (setupPhase: ScratchOrgSetupPhase) => {
                    progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT[setupPhase] });
                },
                registerCancellation: (killChildProcess: () => void) => {
                    killCurrentProcess = killChildProcess;
                    if ( cancellationToken.isCancellationRequested ) {
                        killChildProcess();
                    }
                },
                isCancellationRequested: () => cancellationToken.isCancellationRequested
            });

        });

        const alias = scratchOrgPlan.alias;
        const showScratchOrgNotification = (severity: 'information' | 'warning' | 'error', notificationText: string, outputFilePath?: string) =>
            VSCodeWorkspaceService.showNotificationWithWorkspaceFile(severity, RecipeYamlScalar.escapeForNotification(notificationText), RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL,
                outputFilePath, workspaceRoot, 'The scratch org result file no longer exists in this workspace.');

        if ( setupOutcome.kind === 'createFailed' ) {
            showScratchOrgNotification('error', `The scratch org ${alias} was not created: ${setupOutcome.failureMessage}`, setupOutcome.outputFilePath);
            return;
        }

        if ( setupOutcome.kind === 'createCancelled' ) {
            showScratchOrgNotification('information', `Cancelled while the scratch org ${alias} was being created. A scratch org may still have been created: check with "sf org list".`);
            return;
        }

        const isListed = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Recipe Cockpit: scratch org ${alias}`
        }, async progress => {
            progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT.listing });
            return await this.listAndSelectNewScratchOrg(hub, setupOutcome.username);
        });
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THE NOTIFICATION IS NOW ALL THE READER SEES OF THE RUN (#301)
        const orgText = `${alias} · ${setupOutcome.username}`;
        const selectionText = isListed
            ? 'It is selected in the Treecipe tab.'
            : `${orgText} did not answer the connection check yet, so no org was selected in its place: press ⟳ to check again.`;
        const createdText = setupOutcome.incompleteMessage
            ? `Scratch org ${orgText} was created, but setting it up stopped: ${setupOutcome.incompleteMessage}. It is kept.`
            : `Scratch org ${orgText} is ready.`;

        this.showCreatedScratchOrgNotification(isListed && !setupOutcome.incompleteMessage ? 'information' : 'warning',
            `${createdText} Nothing was deployed to it. ${selectionText}`,
            setupOutcome.username,
            setupOutcome.outputFilePath,
            workspaceRoot);

    }

    /*
        #358: the run deploys nothing, so the notification hands the reader the deploy to run
        themselves -- to the CLIPBOARD only, never run -- beside the create's own output. Not
        awaited: the run ends without waiting for a click.
    */
    private static showCreatedScratchOrgNotification(severity: 'information' | 'warning',
                                                        notificationText: string,
                                                        username: string,
                                                        outputFilePath: string | undefined,
                                                        workspaceRoot: string) {

        const actions = [RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL, ...( outputFilePath ? [RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL] : [] )];
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);

        Promise.resolve(severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions))
            .then(async chosenAction => {

                if ( chosenAction === RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL ) {
                    await vscode.env.clipboard.writeText(ScratchOrgService.buildSourceDeployCommandText(username));
                } else if ( chosenAction === RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The scratch org result file no longer exists in this workspace.');
                }

            })
            .catch(() => undefined);

    }

    /*
        "Open in browser" (#279, #501): a ONE-TIME frontdoor address for the selected org's USERNAME,
        asked of Salesforce over the org's own connection (no CLI), handed to the reader's browser
        by VS Code. The address logs the reader in, so it goes to openExternal and nowhere else:
        never posted, saved, logged or quoted in a notification, and every failure is a fixed text.
        Notifications are not awaited, so the button comes back without a click.

        One open per WINDOW, like the scratch org run: a panel closed and reopened mid-open starts
        from this flag, is told the open is running when its document loads, and is the panel the
        closing state goes to. Anything that throws is answered with a fixed message rather than
        the error's own text, which the generic handler would carry into a Report Issue URL.
    */
    static isOrgOpenInFlightForWindow = false;

    // WITH A RECORD Id (#556) THE SAME ONE-TIME ADDRESS OPENS THAT RECORD, AND SHARES THE ONE OPEN PER WINDOW
    static async openDataOrgInBrowser(hub: IRecipeCockpitHubForTreecipeDataOrgs, panelState: IRecipeCockpitPanelState, orgDetail: IAuthenticatedOrgDetail, recordId?: string) {

        this.isOrgOpenInFlightForWindow = true;
        panelState.isOrgOpenInFlight = true;
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const openedLabel = recordId === undefined ? orgLabel : `Record ${recordId} in ${orgLabel}`;

        try {

            const openOutcome = await SalesforceOrgService.requestOrgFrontDoorUrl(orgDetail.username, recordId);

            if ( 'failureMessage' in openOutcome ) {
                this.showOrgOpenError(`${openedLabel} was not opened: ${openOutcome.failureMessage}`);
                return;
            }

            const isOpened = await vscode.env.openExternal(vscode.Uri.parse(openOutcome.url, true));

            if ( !isOpened ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${openedLabel} was not opened: the browser did not accept the address.`));
            }

        } catch {

            this.showOrgOpenError(`${openedLabel} was not opened: the browser could not be started.`);

        } finally {

            this.isOrgOpenInFlightForWindow = false;
            panelState.isOrgOpenInFlight = false;
            hub.recipeCockpitPanelState.isOrgOpenInFlight = false;

            if ( hub.recipeCockpitPanel ) {
                hub.postToPanel(hub.recipeCockpitPanel, { command: 'orgOpenState', isRunning: false });
            }

        }

    }

    // NOT AWAITED: THE BUTTON COMES BACK WITHOUT WAITING FOR THE READER TO DISMISS THE NOTIFICATION
    private static showOrgOpenError(errorText: string) {

        Promise.resolve(vscode.window.showErrorMessage(RecipeYamlScalar.escapeForNotification(errorText))).catch(() => undefined);

    }

    /*
        The new org's alias, asked after the Dev Hub and before the modal (#279). There is no
        default: the box starts empty and an empty or unusable alias cannot be submitted. An alias
        another authorized org holds is a WARNING, not a refusal -- the CLI moves it to the new org,
        which may be exactly what the reader wants -- and the modal repeats it. Escape is a cancel.
        Which org holds which alias is read from the local authorizations only, and a failure to
        read them costs only the warning.
    */
    private static async promptForScratchOrgAlias(): Promise<IScratchOrgAliasChoice | undefined> {

        let aliasHolders = new Map<string, string>();

        try {
            aliasHolders = await SalesforceOrgService.listAliasHolders();
        } catch {
            // NO WARNING TO GIVE: THE CREATE ITSELF STILL WORKS
        }

        const enteredAlias = await vscode.window.showInputBox({
            title: 'New scratch org',
            prompt: RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PROMPT,
            placeHolder: RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PLACEHOLDER,
            ignoreFocusOut: true,
            validateInput: (typedAlias: string) => this.validateScratchOrgAliasInput(typedAlias, aliasHolders)
        });

        if ( enteredAlias === undefined ) {
            return undefined;
        }

        const alias = enteredAlias.trim();
        const aliasHolderUsername = aliasHolders.get(alias);

        return aliasHolderUsername ? { alias: alias, aliasHolderUsername: aliasHolderUsername } : { alias: alias };

    }

    // AFTER THE ALIAS (#534): STARTS ON TODAY'S 7 SO ENTER KEEPS IT, AND ESCAPE IS A CANCEL. THE TEXT IS PASSED AS TYPED; THE PLAN CHECKS IT AGAIN
    private static async promptForScratchOrgDurationDays(): Promise<string | undefined> {

        return vscode.window.showInputBox({
            title: 'New scratch org',
            prompt: RECIPE_COCKPIT_SCRATCH_ORG_DURATION_PROMPT,
            value: String(SCRATCH_ORG_DURATION_DAYS),
            ignoreFocusOut: true,
            validateInput: (typedDurationDays: string) => ScratchOrgService.validateScratchOrgDurationDays(typedDurationDays)
        });

    }

    // AN INPUT BOX'S MESSAGE RENDERS [label](command:...) AS A NOTIFICATION DOES, SO THE HOLDER'S USERNAME IS ESCAPED
    static validateScratchOrgAliasInput(typedAlias: string, aliasHolders: Map<string, string>): string | vscode.InputBoxValidationMessage | undefined {

        const alias = String(typedAlias ?? '').trim();
        const aliasRefusal = ScratchOrgService.validateScratchOrgAlias(alias);

        if ( aliasRefusal ) {
            return aliasRefusal;
        }

        const aliasHolderUsername = aliasHolders.get(alias);

        return aliasHolderUsername
            ? {
                message: RecipeYamlScalar.escapeForNotification(`"${alias}" is currently ${aliasHolderUsername}. Creating will move it to the new org.`),
                severity: vscode.InputBoxValidationSeverity.Warning
            }
            : undefined;

    }

    // THE ALIAS AND THE USERNAME BOTH: THE ALIAS IS WHAT THE CONFIG NAMES, THE USERNAME IS WHICH ORG THAT IS
    static buildDevHubLabel(scratchOrgPlan: IScratchOrgPlan): string {

        const devHub = scratchOrgPlan.devHub;

        return devHub.alias ? `${devHub.alias} (${devHub.username})` : devHub.username;

    }

    /*
        Names what was resolved AND what the repository's own files decide, since the reader is
        confirming both: where the Dev Hub setting came from (a cloned project's .sf/config.json can
        choose among the reader's Dev Hubs) and what the definition sets for the admin. Nothing is
        deployed (#358), so no package directory or replacement is named.
    */
    static buildScratchOrgConfirmationContent(hub: IRecipeCockpitHubForTreecipeDataOrgs, scratchOrgPlan: IScratchOrgPlan, libraryRefusal?: string): IRecipeCockpitConfirmContent {

        const devHubSourceText: Record<DevHubConfigSource, string> = {
            environment: 'set by an environment variable',
            project: 'set by this project\'s .sf or .sfdx config',
            global: 'your global Salesforce CLI setting'
        };
        const definitionSummary = scratchOrgPlan.definitionSummary;
        const definitionLines = [
            definitionSummary.edition ? `  Edition: ${definitionSummary.edition}` : '',
            definitionSummary.adminEmail ? `  Admin email: ${definitionSummary.adminEmail}` : '',
            definitionSummary.username ? `  Username: ${definitionSummary.username}` : ''
        ].filter(Boolean).map(definitionLine => hub.toSingleLine(definitionLine));

        return {
            summary: [
                // WHERE THE SETTING CAME FROM IS SAID ONLY OF THE DEFAULT: ANY OTHER DEV HUB WAS NAMED BY THE READER ALONE
                scratchOrgPlan.devHub.configSource
                    ? `Dev Hub: ${hub.toSingleLine(this.buildDevHubLabel(scratchOrgPlan))} — the Salesforce CLI's default, ${devHubSourceText[scratchOrgPlan.devHub.configSource]}`
                    : `Dev Hub: ${hub.toSingleLine(this.buildDevHubLabel(scratchOrgPlan))}`,
                scratchOrgPlan.aliasHolderUsername
                    ? hub.toSingleLine(`Alias: ${scratchOrgPlan.alias} — currently ${scratchOrgPlan.aliasHolderUsername}; the Salesforce CLI will move it to the new org`)
                    : hub.toSingleLine(`Alias: ${scratchOrgPlan.alias}`),
                `Duration: ${scratchOrgPlan.durationDays} ${scratchOrgPlan.durationDays === 1 ? 'day' : 'days'}`,
                // WHAT THE REPOSITORY DECIDES STAYS ON SCREEN
                `Definition file: ${scratchOrgPlan.definitionFileRelativePath}`,
                ...definitionLines
            ],
            warnings: ['The definition file, authored in this repository, decides who administers the new org.'],
            sections: [
                { title: 'What happens next', lines: ['Nothing is deployed to the new org: deploy what you need yourself once it is ready.', 'The scratch org is kept whatever happens, and nothing here deletes an org.'] },
                {
                    title: 'Salesforce CLI or @salesforce/core',
                    lines: libraryRefusal
                        ? ['Create with Salesforce CLI runs sf org create scratch from this workspace.', hub.toSingleLine(`Create with @salesforce/core is not offered: ${libraryRefusal}`)]
                        : ['Create with Salesforce CLI runs sf org create scratch from this workspace, and can be cancelled.',
                            'Create with @salesforce/core creates the same org inside VS Code, without starting the CLI, and saves it where the CLI keeps its orgs. It cannot be cancelled once it starts.']
                }
            ]
        };

    }

    /*
        Remembered by USERNAME first, so the listing selects it, and kept even when it is not listed
        yet -- the next ⟳ selects it then. A window with no drawn picker only remembers it.
    */
    private static async listAndSelectNewScratchOrg(hub: IRecipeCockpitHubForTreecipeDataOrgs, orgUsername: string): Promise<boolean> {

        SalesforceOrgService.clearConnectedOrgStatusCache();
        this.rememberDataOrgUsername(hub, orgUsername);

        const cockpitPanel = hub.recipeCockpitPanel;
        const panelState = hub.recipeCockpitPanelState;

        if ( cockpitPanel && panelState.recipeDataMessage ) {
            panelState.dataOrgUsername = orgUsername;
            await this.loadDataOrgs(hub, cockpitPanel, panelState, false, true);
            return panelState.dataOrgDetails.some(orgDetail => orgDetail.username === orgUsername);
        }

        try {
            return ( await SalesforceOrgService.listDataOrgDetails() ).orgDetails.some(orgDetail => orgDetail.username === orgUsername);
        } catch {
            return false;
        }

    }

    // ONLY WHY AN AUTHORIZED ORG MAY BE MISSING, NEVER HOW MANY OR WHICH REASONS (#284)
    static buildDataOrgHiddenNote(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        return SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts) === 0 ? '' : RECIPE_COCKPIT_HIDDEN_ORGS_NOTE;

    }

    // WITH NOTHING LISTED: NONE AUTHORIZED, ONLY PRODUCTION AUTHORIZED, OR NONE STILL CONNECTED
    static buildDataOrgNoOrgsMessage(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        if ( SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts) === 0 ) {
            return RECIPE_COCKPIT_NO_AUTHORIZED_ORGS_MESSAGE;
        }

        return hiddenOrgReasonCounts.expired + hiddenOrgReasonCounts.deleted + hiddenOrgReasonCounts.notConnected > 0
            ? RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE
            : RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE;

    }

    /*
        Connects to the chosen org by USERNAME, asks the Organization row whether it is a sandbox,
        then describes every object the rendered trees list to say whether "+ Create" is offered.
        It counts no records (#238).

        Every post first checks that this selection is still the current one -- same panel, same
        model, and no later selection or refresh -- and the describes stop as soon as it is not,
        so choosing another org mid-check discards this one's answers rather than drawing them over
        the next. Nothing here writes to an org.
    */
    static async selectDataOrg(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, orgIndex: number) {

        const orgDetail = panelState.dataOrgDetails[orgIndex];
        const selectedRecipeDataMessage = panelState.recipeDataMessage;
        const renderSequence = selectedRecipeDataMessage.renderSequence;
        const objectApiNames = [...panelState.dataOrgObjectApiNames];
        const requestSequence = ++panelState.dataOrgRequestSequence;
        const dataOrgSelection: IRecipeCockpitDataOrgSelection = { orgIndex: orgIndex, orgDetail: orgDetail, requestSequence: requestSequence };
        const orgLabel = this.buildDataOrgLabel(orgDetail);
        let isOrgTypeAnswered = false;
        let isScratchOrgDetailAnswered = false;

        panelState.dataOrgSelection = dataOrgSelection;
        panelState.dataOrgUsername = orgDetail.username;
        this.rememberDataOrgUsername(hub, orgDetail.username);

        const isSelectionCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.dataOrgRequestSequence === requestSequence
                                            && panelState.recipeDataMessage === selectedRecipeDataMessage;

        const postSelection = (failureMessage = '') => isSelectionCurrent() && hub.postToPanel(cockpitPanel, {
            command: 'dataOrgSelection',
            orgIndex: orgIndex,
            orgLabel: orgLabel,
            orgTypeLabel: buildSelectionTypeLabel(),
            isSandbox: dataOrgSelection.orgTypeDetail?.isSandbox ?? null,
            failureMessage: failureMessage,
            requestSequence: requestSequence,
            renderSequence: renderSequence
        });

        /*
            A sandbox's label waits for the local authorization to say whether it is a scratch org
            (#458, read in process since #499); nothing else does. It is read only once the org has
            answered that it is a sandbox -- the Organization row decides sandbox or not -- and it
            runs beside the describes, never ahead of them.
        */
        const buildSelectionTypeLabel = () => {
            if ( !isOrgTypeAnswered ) {
                return '';
            }
            if ( dataOrgSelection.orgTypeDetail?.isSandbox === true && !isScratchOrgDetailAnswered ) {
                return '';
            }
            return SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail, dataOrgSelection.scratchOrgDetail);
        };

        postSelection();

        let connection: Connection;
        let querySource: IOrgQuerySource;

        try {
            connection = await SalesforceOrgService.getConnection(orgDetail.username);
            querySource = SalesforceOrgService.toQuerySource(connection);
        } catch (connectionError) {
            isOrgTypeAnswered = true;
            dataOrgSelection.isConnectionFailed = true;
            postSelection(`Could not connect to ${orgLabel}: ${connectionError?.message ?? connectionError}. Re-authorize the org with "sf org login web" and try again.`);
            return;
        }

        if ( !isSelectionCurrent() ) {
            return;
        }

        dataOrgSelection.orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        isOrgTypeAnswered = true;

        /*
            Listed because the CLI knew it as a sandbox or scratch org, or because it is the CLI's
            default org (#305) -- but the org's own answer is the one that counts. An org that
            answers it is not a sandbox, or cannot say, is asked NOTHING more: no describe, no insert.
        */
        if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {

            postSelection(`${orgLabel} ${dataOrgSelection.orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail)}` : 'could not say whether it is a sandbox'}, so the Treecipe tab asked it nothing more. It inserts records only into a sandbox or scratch org.`);

            if ( isSelectionCurrent() ) {
                hub.postToPanel(cockpitPanel, {
                    command: 'dataOrgReadiness',
                    objects: [...( await this.computeCreateReadiness(orgDetail.username, connection, objectApiNames, dataOrgSelection.orgTypeDetail) ).values()],
                    createTargets: [],
                    requestSequence: requestSequence,
                    renderSequence: renderSequence
                });
            }

            return;

        }

        postSelection();

        void SalesforceOrgService.readScratchOrgDetail(orgDetail.username).then(scratchOrgDetail => {
            dataOrgSelection.scratchOrgDetail = scratchOrgDetail;
            isScratchOrgDetailAnswered = true;
            postSelection();
        });

        // WHETHER A TREE'S INSERT IS OFFERED NEEDS EACH OBJECT'S DESCRIBE, NONE OF WHICH IS ASKED OF AN ORG THAT HAS NOT ANSWERED IT IS A SANDBOX
        let readinessByObjectApiName: Map<string, IRecipeCockpitCreateReadinessViewModel>;
        let readinessByCreateKey = new Map<string, IRecipeCockpitCreateReadinessViewModel>();

        try {
            const createTargets = await this.collectCreateTargets(hub, panelState, selectedRecipeDataMessage);
            const readinessByTarget = await this.computeCreateReadinessByTarget(orgDetail.username, connection, objectApiNames, dataOrgSelection.orgTypeDetail, createTargets, () => !isSelectionCurrent());
            readinessByObjectApiName = readinessByTarget.byObjectApiName;
            readinessByCreateKey = readinessByTarget.byCreateKey;
        } catch (describeError) {
            const describeFailureMessage = String(describeError?.message ?? describeError);
            readinessByObjectApiName = new Map(objectApiNames.map(objectApiName => [objectApiName, {
                objectApiName: objectApiName,
                disabledReason: `The objects could not be described in this org (${describeFailureMessage}), so nothing is inserted into it.`,
                requiredLookups: []
            }]));
        }

        if ( !isSelectionCurrent() ) {
            return;
        }

        dataOrgSelection.isReadinessPosted = true;
        hub.postToPanel(cockpitPanel, {
            command: 'dataOrgReadiness',
            objects: objectApiNames.map(objectApiName => readinessByObjectApiName.get(objectApiName)).filter(readiness => !!readiness),
            createTargets: [...readinessByCreateKey.values()],
            requestSequence: requestSequence,
            renderSequence: renderSequence
        });

    }

    /*
        "+ Create" for each object, in one org: fail-closed guards (RecipeCockpitRecordCreation) fed
        with what the org says. An org that has not answered that it is a sandbox is asked nothing
        more -- its answer is the same for every object. Otherwise each object is described (from
        the session cache where it can be). No parent is counted: Create asks for parent Ids only
        after the reader confirms.
    */
    static async computeCreateReadiness(orgUsername: string,
                                        describeSource: IOrgDescribeSource,
                                        objectApiNames: string[],
                                        orgTypeDetail: IOrgTypeDetail | undefined,
                                        isCancellationRequested?: () => boolean): Promise<Map<string, IRecipeCockpitCreateReadinessViewModel>> {

        return ( await this.computeCreateReadinessByTarget(orgUsername, describeSource, objectApiNames, orgTypeDetail, [], isCancellationRequested) ).byObjectApiName;

    }

    /*
        The same, plus one readiness per tree and object (#210): the object's guards, then whether
        that tree's block could be cut and whether it leaves out a field the org requires, against
        the describe the guards already loaded -- so no target costs a request of its own. A block
        field the org lacks is not a reason (#264). A target whose object was not asked about gets
        no readiness.
    */
    static async computeCreateReadinessByTarget(orgUsername: string,
                                                describeSource: IOrgDescribeSource | (() => Promise<IOrgDescribeSource>),
                                                objectApiNames: string[],
                                                orgTypeDetail: IOrgTypeDetail | undefined,
                                                createTargets: IRecipeCockpitCreateTarget[],
                                                isCancellationRequested?: () => boolean): Promise<IRecipeCockpitCreateReadinessByTarget> {

        const readinessByObjectApiName = new Map<string, IRecipeCockpitCreateReadinessViewModel>();
        const readinessByCreateKey = new Map<string, IRecipeCockpitCreateReadinessViewModel>();
        const createTargetsByObjectApiName = new Map<string, IRecipeCockpitCreateTarget[]>();
        createTargets.forEach(createTarget => createTargetsByObjectApiName.set(createTarget.objectApiName, [...( createTargetsByObjectApiName.get(createTarget.objectApiName) ?? [] ), createTarget]));

        const setReadiness = (readinessInput: ICreateReadinessInput) => {
            readinessByObjectApiName.set(readinessInput.objectApiName, RecipeCockpitRecordCreation.buildCreateReadiness(readinessInput));
            ( createTargetsByObjectApiName.get(readinessInput.objectApiName) ?? [] )
                .forEach(createTarget => {
                    const createKey = this.buildTreeObjectKey(createTarget.treeKey, createTarget.objectApiName);
                    const targetReadiness: IRecipeCockpitCreateReadinessViewModel = {
                        ...RecipeCockpitRecordCreation.buildCreateReadiness({
                            ...readinessInput,
                            recipeFieldRefusalReason: createTarget.recipeFieldRefusalReason,
                            excludedFieldApiNames: createTarget.excludedFieldApiNames
                        }),
                        treeKey: createTarget.treeKey
                    };
                    readinessByCreateKey.set(createKey, targetReadiness);
                });
        };

        if ( orgTypeDetail?.isSandbox !== true ) {
            objectApiNames.forEach(objectApiName => setReadiness({ objectApiName: objectApiName, orgTypeDetail: orgTypeDetail }));
            return { byObjectApiName: readinessByObjectApiName, byCreateKey: readinessByCreateKey };
        }

        const describeSourceFactory = typeof describeSource === 'function' ? describeSource : async () => describeSource;
        const describeResult = await SalesforceOrgService.describeObjects(orgUsername, objectApiNames, describeSourceFactory, { isCancellationRequested });

        describeResult.outcomes.forEach(describeOutcome => setReadiness({
            objectApiName: describeOutcome.objectApiName,
            orgTypeDetail: orgTypeDetail,
            describe: describeOutcome.describe,
            describeFailureMessage: describeOutcome.failureMessage
        }));

        return { byObjectApiName: readinessByObjectApiName, byCreateKey: readinessByCreateKey };

    }

    private static buildUnreadableRecipeCreateTarget(treeKey: string, objectApiName: string): IRecipeCockpitCreateTarget {

        return { treeKey: treeKey, objectApiName: objectApiName, recipeFieldRefusalReason: `The recipe file for this tree could not be read, so its ${objectApiName} records could not be prepared.` };

    }

    private static buildCreateTargetFromListing(treeKey: string, objectApiName: string, listed: RecipeBlockFieldListResult, excludedFieldApiNames: string[] = []): IRecipeCockpitCreateTarget {

        return 'refusal' in listed
            ? { treeKey: treeKey, objectApiName: objectApiName, recipeFieldRefusalReason: `The ${objectApiName} block could not be cut from this tree's recipe: ${listed.refusal.message}` }
            : {
                treeKey: treeKey,
                objectApiName: objectApiName,
                recipeFieldApiNames: listed.fieldApiNames,
                ...( excludedFieldApiNames.length > 0 ? { excludedFieldApiNames: [...excludedFieldApiNames] } : {} )
            };

    }

    private static readCreateObjectNickname(recipeObject: IRecipeCockpitObjectViewModel | undefined): string | undefined {

        return recipeObject?.iterations?.length ? recipeObject.nickname : undefined;

    }

    /*
        Every object of every tree the insert is offered on in the model on screen (or of one tree),
        as a target with the fields its block in the tree's recipe sends. Each recipe is read once,
        off the event loop, only from inside the workspace, and SCANNED once for all of its objects
        (listCreateBlockFieldApiNamesForObjects); a recipe that cannot be read is every one of its
        objects' refusal.
    */
    static async collectCreateTargets(hub: IRecipeCockpitHubForTreecipeDataOrgs, panelState: IRecipeCockpitPanelState, recipeDataMessage: IRecipeCockpitRecipeDataMessage, onlyTreeKey?: string): Promise<IRecipeCockpitCreateTarget[]> {

        const recipeObjectsByApiName = new Map<string, IRecipeCockpitObjectViewModel>();
        recipeDataMessage.recipe.objects.forEach(recipeObject => {
            if ( !recipeObjectsByApiName.has(recipeObject.objectApiName) ) {
                recipeObjectsByApiName.set(recipeObject.objectApiName, recipeObject);
            }
        });

        const createTargets: IRecipeCockpitCreateTarget[] = [];

        for ( const tree of recipeDataMessage.recipe.trees.filter(candidateTree => !!candidateTree.runFakerRecipeFileName && ( onlyTreeKey === undefined || candidateTree.treeKey === onlyTreeKey )) ) {

            const objectApiNames = tree.objects
                .filter(treeObject => treeObject.iterationNickname === undefined)
                .map(treeObject => treeObject.objectApiName);

            const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
            const recipeText = recipeFilePath && hub.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot)
                ? await fs.promises.readFile(recipeFilePath, 'utf-8').catch((): undefined => undefined)
                : undefined;

            if ( recipeText === undefined ) {
                objectApiNames.forEach(objectApiName => createTargets.push(this.buildUnreadableRecipeCreateTarget(tree.treeKey, objectApiName)));
                continue;
            }

            const excludedFieldApiNamesByObject = RecipeCockpitDrawnModel.listExcludedFieldApiNamesByObject(tree);
            const listings = RecipeCockpitRecipeWriter.listCreateBlockFieldApiNamesForObjects(recipeText, objectApiNames.map(objectApiName => ({
                objectApiName: objectApiName,
                objectNickname: this.readCreateObjectNickname(recipeObjectsByApiName.get(objectApiName)),
                excludedFieldApiNames: excludedFieldApiNamesByObject.get(objectApiName) ?? []
            })));

            objectApiNames.forEach((objectApiName, objectIndex) => createTargets.push(
                this.buildCreateTargetFromListing(tree.treeKey, objectApiName, listings[objectIndex], excludedFieldApiNamesByObject.get(objectApiName) ?? [])
            ));

        }

        return createTargets;

    }

    static buildTreeObjectKey(treeKey: string, objectApiName: string): string {

        return `${treeKey}\n${objectApiName}`;

    }

    // EVERY CARD THAT CAN GENERATE: "Generate fake data and insert" GENERATES THE SAME WAY, SO IT IS OFFERED ON THE SAME CARDS
    static collectInsertableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.trees
            .filter(tree => !!tree.runFakerRecipeFileName)
            .map(tree => tree.treeKey);

    }

    // EVERY CARD WITH A FOLDER AND AN OBJECT: "Assign permission sets to me…" IS OFFERED WHATEVER THE ORG ANSWERED (#274)
    static collectAssignableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.trees
            .filter(tree => tree.folderName !== '' && tree.objects.length > 0)
            .map(tree => tree.treeKey);

    }

    // THE OBJECTS A TREE'S INSERT SENDS: ONCE EACH, WITH A RECIPE, NOT EXCLUDED -- A SELF-LOOKUP'S ITERATION IS THE SAME OBJECT
    static listTreeInsertObjectApiNames(hub: IRecipeCockpitHubForTreecipeDataOrgs, recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): string[] {

        const recipeObjectApiNames = new Set(recipeViewModel.objects.map(objectViewModel => objectViewModel.objectApiName));
        const excludedObjectApiNames = new Set(hub.listExcludedObjectApiNames(tree));

        return [...new Set(tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .map(treeObject => treeObject.objectApiName))]
            .filter(objectApiName => recipeObjectApiNames.has(objectApiName) && !excludedObjectApiNames.has(objectApiName));

    }

    /*
        The org asked for in the command palette over the listing the Target Org Manager dropdown
        draws (sandbox, scratch and the CLI's default only), put in the dropdown and checked exactly
        as a pick there is -- connection, Organization row, describes -- and remembered (#375). The
        insert (#375) and the Treecipe Adapter's load (#416) both ask through it. True only when the
        pick is now the selection and answered it is a sandbox; a listing the CLI could not answer, a
        dismissed pick, a new model, an org chosen in the dropdown meanwhile and an org that is not a
        sandbox are false, the last two with a warning. Anything else thrown is the caller's. With no
        sandboxOnlyReason (a query, #439, only reads) any org that could be connected to is true.
    */
    static async promptAndSelectDataOrg(hub: IRecipeCockpitHubForTreecipeDataOrgs, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        clickedRecipeDataMessage: IRecipeCockpitRecipeDataMessage,
                                                        isClickStillCurrent: () => boolean,
                                                        placeholder: string,
                                                        refusalPrefix: string,
                                                        sandboxOnlyReason?: string,
                                                        selectionBeforePrompt?: IRecipeCockpitDataOrgSelection): Promise<boolean> {

        let dataOrgListing: IDataOrgListing | undefined;
        let chosenOrgDetail: IDataOrgDetail | undefined;

        try {
            chosenOrgDetail = await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
                SalesforceOrgService.listDataOrgDetails(panelState.workspaceRoot).then(listing => {
                    dataOrgListing = listing;
                    return { orgDetails: listing.orgDetails, emptyListMessage: this.buildDataOrgNoOrgsMessage(listing.hiddenOrgReasonCounts) };
                }),
                placeholder
            );
        } catch (listingError) {
            if ( listingError instanceof OrgConnectionStatusUnavailableError ) {
                VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix}: ${RecipeYamlScalar.escapeForNotification(listingError.message)}`);
                return false;
            }
            throw listingError;
        }

        // A DISMISSED PICK, A NEW MODEL, OR AN ORG CHOSEN IN THE DROPDOWN MEANWHILE: NOTHING MORE IS DONE
        // ("Change org…", #480, REPLACES THE SELECTION IT WAS ASKED OVER, AND ONLY THAT ONE)
        const orgIndex = chosenOrgDetail && dataOrgListing ? dataOrgListing.orgDetails.findIndex(orgDetail => orgDetail.username === chosenOrgDetail.username) : -1;
        if ( orgIndex < 0 || !isClickStillCurrent() || panelState.dataOrgSelection !== selectionBeforePrompt ) {
            return false;
        }

        panelState.dataOrgDetails = dataOrgListing.orgDetails;
        hub.postToPanel(cockpitPanel, {
            command: 'dataOrgList',
            orgLabels: dataOrgListing.orgDetails.map(orgDetail => this.buildDataOrgListLabel(orgDetail)),
            orgPickerLabels: dataOrgListing.orgDetails.map(orgDetail => this.buildDataOrgPickerLabel(orgDetail)),
            selectedOrgIndex: orgIndex,
            noOrgsMessage: '',
            hiddenOrgNote: this.buildDataOrgHiddenNote(dataOrgListing.hiddenOrgReasonCounts),
            forgottenOrgNotice: '',
            renderSequence: clickedRecipeDataMessage.renderSequence
        });

        /*
            A query (#439) only reads and opens its own connection, so it goes on as soon as the pick
            IS the selection -- selectDataOrg sets it before its first await -- and the check, with a
            sandbox's describes of every tree object, finishes behind it rather than in front of it.
        */
        if ( sandboxOnlyReason === undefined ) {
            this.selectDataOrg(hub, cockpitPanel, panelState, orgIndex).catch(selectError => ErrorHandlingService.handleCapturedError(selectError, 'openRecipeCockpit'));
            return isClickStillCurrent() && panelState.dataOrgSelection?.orgDetail.username === chosenOrgDetail.username;
        }

        await this.selectDataOrg(hub, cockpitPanel, panelState, orgIndex);

        const dataOrgSelection = panelState.dataOrgSelection;
        if ( !isClickStillCurrent() || dataOrgSelection?.orgDetail.username !== chosenOrgDetail.username ) {
            return false;
        }

        if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix}: ${RecipeYamlScalar.escapeForNotification(this.buildDataOrgLabel(chosenOrgDetail))} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'could not be checked'}, and ${sandboxOnlyReason}.`);
            return false;
        }

        return true;

    }

    /*
        How the tree insert ended, as ONE notification (#301), with the results file a button opens:
        "View errors" when a record failed or the insert stopped, "View results" otherwise. A stopped
        insert is an ERROR (#310), the one notification for it, since the shared insert was told not
        to show its own. The insert writes that file once it has sent a file, so a cancel before that
        offers no button. One that failed (#375) also names the first generated file that failed,
        opens it with "View failed file", and offers "Open Troubleshooting" on the sub-tab the first
        failure's error points at. The panel draws no line for it. NOT AWAITED, so the insert ends
        without waiting for the reader. treeLabel and orgLabel arrive escaped.
    */
    static showTreeInsertNotification(hub: IRecipeCockpitHubForTreecipeDataOrgs, insertResult: IDataSetInsertResult, treeLabel: string, orgLabel: string, workspaceRoot: string, insertedTree?: { runFolderName: string; treeFolderName: string }) {

        const recordsText = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;
        const hasErrors = insertResult.failedRecordCount > 0 || insertResult.outcome === 'stopped';
        let severity: 'information' | 'warning' | 'error' = 'warning';
        let notificationText: string;

        if ( insertResult.outcome === 'cancelled' ) {
            notificationText = `The insert of ${treeLabel} into ${orgLabel} was cancelled${insertResult.isRolledBack ? ' and every record it had inserted was deleted' : ''}.`;
        } else if ( insertResult.outcome === 'stopped' ) {
            severity = 'error';
            notificationText = insertResult.isRolledBack
                ? `The insert of ${treeLabel} into ${orgLabel} stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen. ${recordsText(insertResult.failedRecordCount)} failed.`
                : `The insert of ${treeLabel} into ${orgLabel} stopped at a file that could not be inserted. ${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} kept, because all-or-none was not chosen, and ${insertResult.failedRecordCount} failed.`;
        } else if ( insertResult.failedRecordCount > 0 ) {
            notificationText = `${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} inserted into ${orgLabel} from ${treeLabel} and ${insertResult.failedRecordCount} failed. Nothing was rolled back.`;
        } else {
            severity = 'information';
            notificationText = `${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} inserted into ${orgLabel} from ${treeLabel}.`;
        }

        if ( insertResult.requestFailureDetail ) {
            notificationText += ` The request for ${RecipeYamlScalar.escapeForNotification(insertResult.requestFailureDetail)}`;
        }

        const resultsFilePath = insertResult.resultsFilePath && fs.existsSync(insertResult.resultsFilePath) ? insertResult.resultsFilePath : undefined;
        const resultsFileAction = {
            label: hasErrors ? RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL : RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
            filePath: resultsFilePath,
            missingFileText: 'The insert results file no longer exists in this workspace.'
        };

        const failedFilePath = insertResult.failedFilePath;
        const hasFailedFile = typeof failedFilePath === 'string' && insertResult.outcome !== 'cancelled';

        if ( !hasFailedFile ) {
            VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [resultsFileAction], workspaceRoot);
            return;
        }

        const troubleshootingSubTab = RecipeCockpitInsertFailureTriage.resolveSubTab(insertResult.firstFailure);
        notificationText += ` The first file that failed is ${RecipeYamlScalar.escapeForNotification(path.basename(failedFilePath))}; its ${RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS[troubleshootingSubTab]} in the Troubleshooting tab may fix it.`;

        VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [
            { label: RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL, filePath: fs.existsSync(failedFilePath) ? failedFilePath : undefined, missingFileText: 'The generated file that failed no longer exists in this workspace.' },
            resultsFileAction
        ], workspaceRoot, insertedTree && insertedTree.treeFolderName !== '' ? [{
            label: RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL,
            run: () => this.openTroubleshootingAfterInsert(hub, workspaceRoot, { ...insertedTree, troubleshootingSubTab: troubleshootingSubTab })
        }] : []);

    }

    /*
        How "A data set for each record type" ended (#624), as ONE notification naming every set's
        outcome. The first set that failed or stopped with an insert result offers "View errors" on
        its results file, and "View failed file" and "Open Troubleshooting" as a single tree insert's
        does; a cancel or a thrown step offers none. NOT AWAITED. treeLabel and orgLabel arrive escaped.
    */
    static showRecordTypeSetsNotification(hub: IRecipeCockpitHubForTreecipeDataOrgs, setOutcomes: readonly IRecordTypeSetOutcome[], treeLabel: string, orgLabel: string, workspaceRoot: string, insertedTree: { runFolderName: string; treeFolderName: string }) {

        const { severity, notificationText } = RecipeCockpitRecordTypeSets.buildRecordTypeSetsNotification(setOutcomes, treeLabel, orgLabel);
        const failedSetResult = setOutcomes
            .map(setOutcome => setOutcome.insertResult)
            .find((insertResult): insertResult is IDataSetInsertResult => !!insertResult && insertResult.outcome !== 'cancelled' && !RecipeCockpitRecordTypeSets.isInsertWhollyLanded(insertResult));

        if ( !failedSetResult ) {
            VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [], workspaceRoot);
            return;
        }

        const resultsFileAction = {
            label: RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL,
            filePath: failedSetResult.resultsFilePath && fs.existsSync(failedSetResult.resultsFilePath) ? failedSetResult.resultsFilePath : undefined,
            missingFileText: 'The insert results file no longer exists in this workspace.'
        };
        const failedFilePath = failedSetResult.failedFilePath;

        if ( typeof failedFilePath !== 'string' ) {
            VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [resultsFileAction], workspaceRoot);
            return;
        }

        const troubleshootingSubTab = RecipeCockpitInsertFailureTriage.resolveSubTab(failedSetResult.firstFailure);
        VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity,
            `${notificationText} The first file that failed is ${RecipeYamlScalar.escapeForNotification(path.basename(failedFilePath))}; its ${RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS[troubleshootingSubTab]} in the Troubleshooting tab may fix it.`, [
            { label: RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL, filePath: fs.existsSync(failedFilePath) ? failedFilePath : undefined, missingFileText: 'The generated file that failed no longer exists in this workspace.' },
            resultsFileAction
        ], workspaceRoot, insertedTree.treeFolderName !== '' ? [{
            label: RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL,
            run: () => this.openTroubleshootingAfterInsert(hub, workspaceRoot, { ...insertedTree, troubleshootingSubTab: troubleshootingSubTab })
        }] : []);

    }

    /*
        "Open Troubleshooting" (#375). On the cockpit open now, on the same run, with a card for the
        tree, the card is focused IN PLACE -- no reload, so the org selection and readiness stay.
        Otherwise the cockpit is opened through its command (the feature flag still applies) on that
        run, focused there once it is drawn. A run or tree folder gone from disk is a warning, and
        nothing is opened.
    */
    static async openTroubleshootingAfterInsert(hub: IRecipeCockpitHubForTreecipeDataOrgs, workspaceRoot: string, focusRequest: IRecipeCockpitTroubleshootingFocusRequest) {

        const cockpitPanel = hub.recipeCockpitPanel;
        const panelState = hub.recipeCockpitPanelState;
        const recipeDataMessage = panelState.recipeDataMessage;
        const focusTree = recipeDataMessage && recipeDataMessage.recipe.selectedRunFolderName === focusRequest.runFolderName
            ? RecipeCockpitDrawnModel.resolveTroubleshootingFocus(recipeDataMessage.recipe, focusRequest)
            : undefined;

        if ( cockpitPanel && panelState.workspaceRoot === workspaceRoot && recipeDataMessage && focusTree ) {
            /*
                A HIDDEN panel's document is gone (retainContextWhenHidden is off) and the reveal
                reloads it, so the focus rides on the model's replay until it is drawn, as an open's does.
            */
            if ( !cockpitPanel.visible ) {
                panelState.openFocusTree = focusTree;
                cockpitPanel.reveal(vscode.ViewColumn.One);
                return;
            }
            cockpitPanel.reveal(vscode.ViewColumn.One);
            hub.postToPanel(cockpitPanel, { command: 'focusTree', focusTree: focusTree, renderSequence: recipeDataMessage.renderSequence });
            return;
        }

        const treeFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath(), focusRequest.runFolderName, focusRequest.treeFolderName);
        if ( !SfdxProjectService.isExistingDirectory(treeFolderPath) || !hub.isUsableWorkspacePath(treeFolderPath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The run ${RecipeYamlScalar.escapeForNotification(focusRequest.runFolderName)} or its tree ${RecipeYamlScalar.escapeForNotification(focusRequest.treeFolderName)} no longer exists, so the Troubleshooting tab was not opened.`);
            return;
        }

        await vscode.commands.executeCommand(RECIPE_COCKPIT_OPEN_COMMAND, { focusTroubleshooting: true, ...focusRequest });

    }

    // THE ALIAS A READER CHOSE BY, WITH THE USERNAME THAT SAYS WHICH ORG IT CURRENTLY POINTS AT
    static buildOrgLabel(orgDetail: IAuthenticatedOrgDetail): string {

        return orgDetail.alias ? `${orgDetail.alias} (${orgDetail.username})` : orgDetail.username;

    }

}
