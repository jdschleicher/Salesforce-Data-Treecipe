import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import {
    RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND,
    RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND,
    RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE
} from './RecipeCockpitTroubleshootingConstants';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import {
    IPermissionSetAssignmentConnection,
    IPermissionSetAssignmentPlan,
    IPermissionSetCandidate,
    PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS,
    PERMISSION_SET_MAX_PICKS,
    PERMISSION_SET_NOTIFICATION_SKIPS_SHOWN,
    PermissionSetAssignOutcome,
    RecipeCockpitPermissionSetAssign
} from './RecipeCockpitPermissionSetAssign';
import { RecipeCockpitPermissionSetGenerate } from './RecipeCockpitPermissionSetGenerate';
import {
    IMetadataDeployComponent,
    IMetadataDeploySummary,
    METADATA_DEPLOY_FAILURES_SHOWN,
    METADATA_DEPLOY_OPERATION_BY_KIND,
    METADATA_DEPLOY_TIMEOUT_MILLISECONDS,
    METADATA_DEPLOY_TYPES,
    METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES,
    MetadataDeployKind,
    MetadataDeployOutcome,
    RecipeCockpitMetadataDeploy
} from './RecipeCockpitMetadataDeploy';
import {
    IMetadataDeployConnection,
    IMetadataDeploySourceFile,
    METADATA_DEPLOY_METHOD_SETTING,
    MetadataDeployRun,
    RecipeCockpitMetadataDeployPackage
} from './RecipeCockpitMetadataDeployPackage';
import {
    METADATA_LIST_TIMEOUT_MILLISECONDS,
    METADATA_RETRIEVE_MAX_COMPONENTS,
    METADATA_RETRIEVE_OPERATION_BY_KIND,
    MetadataRetrieveKind,
    MetadataRetrieveOutcome,
    RecipeCockpitMetadataRetrieve
} from './RecipeCockpitMetadataRetrieve';
import {
    IOrgPermissionSet,
    IOrgQuerySource,
    IOrgTypeDetail,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import {
    SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES,
    ScratchOrgService
} from '../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    IRecipeCockpitRunArtifactsLocation,
    RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME,
    RecipeCockpitRunArtifacts
} from '../RunArtifacts/RecipeCockpitRunArtifacts';
import {
    IRunHistoryStepRecord,
    RunHistoryOutcome
} from './RecipeCockpitRunHistory';
import { RecipeCockpitTroubleshootingViews } from './RecipeCockpitTroubleshootingViews';
import type {
    IRecipeCockpitHubForTroubleshootingTab,
    IRecipeCockpitPermissionSetAssignStateMessage
} from './RecipeCockpitTroubleshootingHost';
import type {
    IRecipeCockpitConfirmChangeOrg,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitViewModel';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';

// #326: ASKED EVERY TIME, IN THE COMMAND PALETTE, OVER EVERY CONNECTED ORG: A RETRIEVE ONLY READS
export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER = 'Choose the org to retrieve this tree\'s validation rules from';

/*
    The Troubleshooting tab's runs (#274, #306, #326, #346, #382; moved out of the hub by #666):
    deploys, retrieves, and permission set assignments and generation. Each asks in the panel,
    checks every guard again after the answer, and ends in one notification. The deploy and retrieve
    locks stay in the hub, since the Treecipe Adapter reads them too; the permission set locks are
    this file's.
*/

export const RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL = 'Assign';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL = 'Write permission set';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL = 'Open file';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL = 'Copy deploy command';

export const RECIPE_COCKPIT_PERMISSION_SET_PICK_PLACEHOLDER = 'Choose the permission sets to assign to you for this tree';

export const RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER = 'Choose the sandbox or scratch org to assign this tree\'s permission sets in';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL = 'Retrieve';

export const RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL = 'Nothing was retrieved: an insert, a permission set assignment or a metadata deploy is running. Try again once it has finished.';

// A RETRIEVE READS FROM THE TARGET ORG MANAGER SELECTION (#480); THESE ARE SAID WHEN IT CANNOT
export const RECIPE_COCKPIT_RETRIEVE_ORG_BUSY_REFUSAL = 'Nothing was retrieved: no org is selected in Target Org Manager, and another run is holding the selection. Try again once it has finished.';
// ASKED ONLY WHEN TARGET ORG MANAGER HAS NO ORG SELECTED (#480); THE PICK BECOMES THE SELECTION
export const RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS: Readonly<Record<MetadataRetrieveKind, string>> = Object.freeze({
    validationRules: RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER,
    fields: 'Choose the org to retrieve this tree\'s custom fields from',
    recordTypes: 'Choose the org to retrieve this tree\'s record types from',
    globalValueSets: 'Choose the org to retrieve the global value sets this tree\'s fields name from'
});

export const RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL = 'Deploy';

// THE BOX A FIELDS DEPLOY'S CONFIRMATION DRAWS (#402): UNTICKED EVERY TIME, AND ONLY WHEN THE PROJECT HOLDS SOMETHING IT WOULD ADD
export const RECIPE_COCKPIT_DEPLOY_FULL_SET_CHECKBOX_LABEL = 'Also deploy every tree object\'s validation rules, record types and global value sets';

export const RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_DEPLOY_PERMISSION_SET_PICK_PLACEHOLDER = 'Choose the permission sets to deploy';

export const RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER = 'Choose the sandbox or scratch org to deploy to';

export const RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL = 'Nothing was deployed: an insert, a scratch org run, a permission set assignment, a validation rule retrieve or another deploy is running. Try again once it has finished.';

/*
    How "Assign permission sets to me…" ended (#274, #302): the org it was for, whether the reader
    confirmed it, and whether any pick is now held by the user (so the cards are re-checked). What
    it said is a notification's, never the panel's.
*/
interface IRecipeCockpitPermissionSetClosingState {
    orgDetail?: IAuthenticatedOrgDetail;
    isConfirmed?: boolean;
    isAssigned?: boolean;
}

// HOW A TROUBLESHOOTING DEPLOY ENDED (#346): WHICH ORG'S DESCRIBES OF WHICH OBJECTS TO DROP ONCE THE CLI RAN, AND WHETHER IT LANDED
interface IRecipeCockpitMetadataDeployClosingState {
    cliStartedFor?: { orgDetail: IAuthenticatedOrgDetail; objectApiNames: string[] };
    isDeployed?: boolean;
    // A LANDED DEPLOY'S NOTIFICATION, SHOWN ONCE THE RUN HAS ENDED SO ITS "Assign permission sets to me…" IS NOT REFUSED AS BUSY
    showOutcome?: () => void;
}

export class RecipeCockpitTroubleshootingRuns {

    private static isPermissionSetAssignInFlight = false;

    private static permissionSetAssignRunStateMessage: IRecipeCockpitPermissionSetAssignStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setPermissionSetAssignState(hub: IRecipeCockpitHubForTroubleshootingTab, permissionSetAssignStateMessage: IRecipeCockpitPermissionSetAssignStateMessage) {

        this.permissionSetAssignRunStateMessage = permissionSetAssignStateMessage.isRunning ? permissionSetAssignStateMessage : undefined;
        hub.recipeCockpitPanelState.permissionSetAssignStateMessage = permissionSetAssignStateMessage;

        if ( hub.recipeCockpitPanel ) {
            hub.postToPanel(hub.recipeCockpitPanel, permissionSetAssignStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE AN ASSIGNMENT IS GOING STARTS FROM ITS STATE, SO ITS ROUTER REFUSES WHAT THE ASSIGNMENT HOLDS
    static adoptPermissionSetAssignRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isPermissionSetAssignInFlight && this.permissionSetAssignRunStateMessage ) {
            panelState.permissionSetAssignStateMessage = this.permissionSetAssignRunStateMessage;
        }

    }

    /*
        "Assign permission sets to me…" (#274, #302), for one tree of the model on screen. Nothing is
        deployed: the picks are this workspace's permission sets, and only those the org already
        holds are assigned; the rest are named in a warning for the reader to deploy. One at a time
        per window, and while it runs nothing else may insert, change the selection or create a
        scratch org. The org is the selection (isSelectedOrg, checked by the router to have answered
        that it is a sandbox) or one the reader picks from the same non-production list, which
        becomes the selection once confirmed. Every outcome is a VS Code notification, whose "View
        output" is its only follow-up; the panel only gets its button back. Field-level security
        changes what a describe answers, so once the CLI has run that org's describes of the objects
        the assigned picks cover are dropped either way, and an assignment that landed on the
        selection re-checks the cards listing them.
    */
    static async assignTreePermissionSetsFromPanel(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, isSelectedOrg: boolean) {

        const panelState = hub.recipeCockpitPanelState;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const assignSelection = isSelectedOrg ? panelState.dataOrgSelection : undefined;

        if ( this.isPermissionSetAssignInFlight || !tree || ( isSelectedOrg && !assignSelection ) ) {
            hub.postToPanel(cockpitPanel, this.permissionSetAssignRunStateMessage
                ?? { command: 'permissionSetAssignState', isRunning: false, treeKey: treeKey });
            return;
        }

        this.isPermissionSetAssignInFlight = true;
        const treeLabel = tree.customName || tree.title;
        const objectApiNames = [...new Set(tree.objects.map(treeObject => treeObject.objectApiName))];
        let closingState: IRecipeCockpitPermissionSetClosingState = {};
        let assignStartedFor: { orgDetail: IAuthenticatedOrgDetail; objectApiNames: string[] } | undefined;

        this.setPermissionSetAssignState(hub, { command: 'permissionSetAssignState', isRunning: true, treeKey: treeKey });

        try {

            closingState = await this.performPermissionSetAssign(hub, 
                panelState.workspaceRoot,
                treeLabel,
                objectApiNames,
                assignSelection ? async () => assignSelection.orgDetail : async () => this.promptForPermissionSetOrg(hub),
                (orgDetail, coveredObjectApiNames) => { assignStartedFor = { orgDetail: orgDetail, objectApiNames: coveredObjectApiNames }; },
                { restartMessage: { command: 'assignTreePermissionSets', treeKey: treeKey, orgIndex: null }, isSandboxOnly: true },
                panelState.recipeDataMessage ? hub.resolveTreeRunArtifactsLocation(panelState.workspaceRoot, panelState.recipeDataMessage.recipe, tree) : undefined
            );

        } finally {

            try {

                if ( assignStartedFor ) {
                    const { orgDetail, objectApiNames: coveredObjectApiNames } = assignStartedFor;
                    coveredObjectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(orgDetail.username, objectApiName));
                }

                const currentPanel = hub.recipeCockpitPanel;
                const currentPanelState = hub.recipeCockpitPanelState;

                if ( closingState.isAssigned === true && assignStartedFor && assignSelection && currentPanel && currentPanelState.dataOrgSelection === assignSelection ) {
                    const lowerCoveredNames = new Set(assignStartedFor.objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
                    await hub.refreshDataOrgReadinessForTrees(currentPanel, currentPanelState, recipeTree => recipeTree.objects.some(treeObject => lowerCoveredNames.has(treeObject.objectApiName.toLowerCase())));
                }

                if ( !assignSelection && closingState.isConfirmed === true && closingState.orgDetail && currentPanel && currentPanelState.recipeDataMessage ) {
                    RecipeCockpitTreecipeDataOrgs.rememberDataOrgUsername(hub, closingState.orgDetail.username);
                    currentPanelState.dataOrgUsername = closingState.orgDetail.username;
                    await RecipeCockpitTreecipeDataOrgs.loadDataOrgs(hub, currentPanel, currentPanelState);
                }

            } finally {

                this.isPermissionSetAssignInFlight = false;
                this.setPermissionSetAssignState(hub, { command: 'permissionSetAssignState', isRunning: false, treeKey: treeKey });
                RecipeCockpitTroubleshootingViews.refreshTroubleshootingHistory(hub, treeKey);

            }

        }

    }

    /*
        A Troubleshooting deploy (#346): one section's components, named in a host modal, deployed
        through a generated package.xml to a sandbox or scratch org. One per window, and while it
        runs nothing else may insert, assign, retrieve, create a scratch org or change the
        selection. The org is the selection (checked by the router to have answered that it is a
        sandbox) or one the reader picks from the same non-production list; either way it is asked
        again on the connection after the modal, and production is never deployed to. Every outcome
        is a VS Code notification. Once the CLI has run, that org's describes of the objects the
        deploy touches are dropped, and a deploy that landed on the selection re-checks the cards
        listing them.
    */
    static async deployTreeMetadataFromPanel(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, deployKind: MetadataDeployKind, isSelectedOrg: boolean) {

        const panelState = hub.recipeCockpitPanelState;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const deploySelection = isSelectedOrg ? panelState.dataOrgSelection : undefined;

        if ( hub.isMetadataDeployInFlight || !recipeViewModel || !tree || ( isSelectedOrg && !deploySelection ) ) {
            hub.postToPanel(cockpitPanel, hub.metadataDeployRunStateMessage
                ?? { command: 'metadataDeployState', isRunning: false, treeKey: treeKey, deployKind: deployKind });
            return;
        }

        hub.isMetadataDeployInFlight = true;
        let closingState: IRecipeCockpitMetadataDeployClosingState = {};

        hub.setMetadataDeployState({ command: 'metadataDeployState', isRunning: true, treeKey: treeKey, deployKind: deployKind });

        try {

            closingState = await this.performMetadataDeploy(hub, 
                cockpitPanel,
                panelState.workspaceRoot,
                recipeViewModel,
                tree,
                deployKind,
                deploySelection ? async () => deploySelection.orgDetail : async () => this.promptForDeployOrg(hub)
            );

        } finally {

            try {

                const { cliStartedFor } = closingState;

                if ( cliStartedFor ) {
                    cliStartedFor.objectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(cliStartedFor.orgDetail.username, objectApiName));
                }

                const currentPanel = hub.recipeCockpitPanel;
                const currentPanelState = hub.recipeCockpitPanelState;

                if ( closingState.isDeployed === true && cliStartedFor && deploySelection && currentPanel && currentPanelState.dataOrgSelection === deploySelection ) {
                    const lowerObjectNames = new Set(cliStartedFor.objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
                    await hub.refreshDataOrgReadinessForTrees(currentPanel, currentPanelState, recipeTree => recipeTree.objects.some(treeObject => lowerObjectNames.has(treeObject.objectApiName.toLowerCase())));
                }

            } finally {

                hub.isMetadataDeployInFlight = false;
                hub.setMetadataDeployState({ command: 'metadataDeployState', isRunning: false, treeKey: treeKey, deployKind: deployKind });
                closingState.showOutcome?.();
                await RecipeCockpitTroubleshootingViews.refreshTroubleshootingSummary(hub, treeKey);
                RecipeCockpitTroubleshootingViews.refreshTroubleshootingHistory(hub, treeKey);

            }

        }

    }

    private static async promptForDeployOrg(hub: IRecipeCockpitHubForTroubleshootingTab): Promise<IAuthenticatedOrgDetail | undefined> {

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
            SalesforceOrgService.listDataOrgDetails().then(dataOrgListing => ({
                orgDetails: dataOrgListing.orgDetails,
                emptyListMessage: RecipeCockpitTreecipeDataOrgs.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts)
            })),
            RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER
        );

    }

    // THE READER'S PICK, THIS TREE'S GENERATED SET FIRST AND PRESELECTED; undefined WHEN THE PICK WAS DISMISSED OR LEFT EMPTY
    private static async promptForDeployPermissionSets(permissionSets: IPermissionSetCandidate[], generatedPermissionSetName: string | undefined, treeObjectCount: number): Promise<IPermissionSetCandidate[] | undefined> {

        const lowerGeneratedName = generatedPermissionSetName?.toLowerCase();
        const orderedPermissionSets = [
            ...permissionSets.filter(permissionSet => permissionSet.name.toLowerCase() === lowerGeneratedName),
            ...permissionSets.filter(permissionSet => permissionSet.name.toLowerCase() !== lowerGeneratedName)
        ];

        const pickedItems = await vscode.window.showQuickPick(
            orderedPermissionSets.map(permissionSet => ({
                label: permissionSet.name,
                description: RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, treeObjectCount),
                detail: permissionSet.relativeFilePath,
                picked: permissionSet.name.toLowerCase() === lowerGeneratedName,
                permissionSet: permissionSet
            })),
            { canPickMany: true, ignoreFocusOut: true, matchOnDescription: true, placeHolder: RECIPE_COCKPIT_DEPLOY_PERMISSION_SET_PICK_PLACEHOLDER }
        );

        return pickedItems && pickedItems.length > 0 ? pickedItems.map(pickedItem => pickedItem.permissionSet) : undefined;

    }

    /*
        Everything that decides WHAT is deployed is read and picked BEFORE an org is asked for, so a
        project with nothing to deploy opens no prompt; a dismissed pick, org prompt or modal is a
        quiet cancel that writes nothing. The package.xml is written only after the org has
        answered, on the connection, that it is a sandbox.
    */
    private static async performMetadataDeploy(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel,
                                                workspaceRoot: string,
                                                recipeViewModel: IRecipeCockpitRecipeViewModel,
                                                tree: IRecipeCockpitTreeViewModel,
                                                deployKind: MetadataDeployKind,
                                                resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>): Promise<IRecipeCockpitMetadataDeployClosingState> {

        const treeLabel = tree.customName || tree.title;
        const refuse = (refusalText: string, closingState: IRecipeCockpitMetadataDeployClosingState = {}): IRecipeCockpitMetadataDeployClosingState => {
            this.showMetadataDeployNotification(hub, 'warning', refusalText, undefined, workspaceRoot);
            return closingState;
        };

        let packageDirectoryPaths: string[];
        let packageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            packageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            return refuse(`Nothing was deployed: ${hub.describeThrown(projectError)}`);
        }

        const deployObjects = hub.listTreeDeployObjects(recipeViewModel, tree);
        const treeObjectApiNames = deployObjects.map(deployObject => deployObject.objectApiName);
        let components: IMetadataDeployComponent[];
        let fullSetComponents: IMetadataDeployComponent[] = [];
        let summary: IMetadataDeploySummary | undefined;
        let touchedObjectApiNames: string[];

        if ( deployKind === 'permissionSet' ) {

            const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(treeObjectApiNames, workspaceRoot, packageDirectoryPaths);
            if ( discovery.permissionSets.length === 0 ) {
                return refuse(`No permission set in this workspace's source grants access to any object of ${treeLabel}, so nothing was deployed. Generate permission set… writes one.`);
            }

            const pickedPermissionSets = await this.promptForDeployPermissionSets(discovery.permissionSets, RecipeCockpitPermissionSetGenerate.buildPermissionSetName(tree.folderName), treeObjectApiNames.length);
            if ( !pickedPermissionSets ) {
                return {};
            }

            components = pickedPermissionSets.map(permissionSet => ({ type: 'PermissionSet', member: permissionSet.name }));
            touchedObjectApiNames = [...new Set(pickedPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames))].filter(objectApiName => SalesforceApiName.isApiName(objectApiName));

        } else {

            summary = await RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, packageDirectoryPaths, deployObjects);
            components = RecipeCockpitMetadataDeploy.listSummaryComponents(summary, deployKind);

            // A FIELDS DEPLOY NEEDS A FIELD: ITS CUSTOM OBJECTS (#402) GO WITH FIELDS, AND THE PANEL DISABLES THE CARD WITH NONE
            if ( components.length === 0 || ( deployKind === 'fields' && summary.customFields.length === 0 ) ) {
                const missingText = deployKind === 'fields' ? 'custom field whose source file this project holds'
                    : deployKind === 'globalValueSets' ? 'global value set its fields name that this project holds'
                    : 'record type in this project';
                return refuse(`${treeLabel} has no ${missingText}, so nothing was deployed.`);
            }

            // WHAT THE CONFIRMATION'S BOX ADDS TO A FIELDS DEPLOY (#402), FROM THE SAME READ THE CONFIRMATION SHOWS
            fullSetComponents = deployKind === 'fields' ? RecipeCockpitMetadataDeploy.listFullSetComponents(summary) : [];

            touchedObjectApiNames = deployKind === 'globalValueSets'
                ? treeObjectApiNames
                // A FLEXIPAGE'S MEMBER IS NO OBJECT'S (#547)
                : [...new Set(components.filter(component => component.type !== 'FlexiPage').map(component => component.member.split('.')[0]))];

        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`Nothing was deployed: ${hub.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return {};
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const packageDirectoryRelativePath = path.relative(workspaceRoot, packageDirectoryPath).split(path.sep).join('/') || '.';
        const describeComponentCount = (componentCount: number) => `${componentCount} ${componentCount === 1 ? 'component' : 'components'}`;
        const confirmTitle = `Deploy ${describeComponentCount(components.length)} for ${hub.toSingleLine(treeLabel)} to ${hub.toSingleLine(orgLabel)}?`;
        // AN OBJECT'S COPY IS EDITED WHEN IT NAMES A PAGE OR COMPACT LAYOUT THIS DEPLOY DOES NOT CARRY (#547), WHICH ONLY THE ZIP CAN SEND
        const hasObjectEdits = deployKind === 'fields' && ( summary?.objectReferenceResets.length ?? 0 ) > 0;
        // WHICH WAY IT GOES (#505), DECIDED FOR EVERYTHING THE CONFIRMATION CAN SEND SO THE CONFIRMATION SAYS IT
        const deployMethodPlan = RecipeCockpitMetadataDeployPackage.planDeployMethod(
            RecipeCockpitMetadataDeployPackage.readDeployMethod(ConfigurationService.getExtensionConfigValue(METADATA_DEPLOY_METHOD_SETTING)),
            workspaceRoot,
            packageDirectoryPaths,
            [...components, ...fullSetComponents],
            hasObjectEdits
        );
        const confirmOptions = {
            ...RecipeCockpitMetadataDeploy.buildConfirmationContent(deployKind, treeLabel, hub.buildConfirmOrg(orgDetail), packageDirectoryRelativePath, components, summary, SfdxProjectService.hasFileOrEnvironmentReplacements(workspaceRoot), fullSetComponents, RecipeCockpitMetadataDeployPackage.describeDeployMethod(deployMethodPlan), hasObjectEdits ? RecipeCockpitMetadataDeployPackage.describeEditsNotApplied(deployMethodPlan) : undefined),
            isDestructive: true,
            changeOrg: { restartMessage: { command: RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND[deployKind], treeKey: tree.treeKey, orgIndex: null }, isSandboxOnly: true }
        };

        const confirmation = fullSetComponents.length > 0
            ? await hub.confirmInPanelWithCheckbox(confirmTitle, { ...confirmOptions, checkboxLabel: RECIPE_COCKPIT_DEPLOY_FULL_SET_CHECKBOX_LABEL }, RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL)
            : { chosenLabel: await hub.confirmInPanel(confirmTitle, confirmOptions, RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL), isChecked: false };

        if ( confirmation.chosenLabel !== RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL ) {
            return {};
        }

        if ( confirmation.isChecked ) {
            components = [...components, ...fullSetComponents];
            touchedObjectApiNames = [...new Set([
                ...touchedObjectApiNames,
                ...fullSetComponents.filter(component => component.type !== 'GlobalValueSet').map(component => component.member.split('.')[0]),
                ...( fullSetComponents.some(component => component.type === 'GlobalValueSet') ? treeObjectApiNames : [] )
            ])];
        }

        const componentText = describeComponentCount(components.length);

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE PROMPT OR THE MODAL WAS OPEN
        const currentPanelState = hub.recipeCockpitPanelState;
        if ( RecipeCockpitTreecipeDataOrgs.isScratchOrgSetupInFlight
                || currentPanelState.insertStateMessage
                || currentPanelState.permissionSetAssignStateMessage?.isRunning
                || hub.isMetadataRetrieveInFlight ) {
            return refuse(RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL);
        }
        const retrievedFilesApplyRefusal = hub.findRetrievedFilesApplyRefusal(currentPanelState);
        if ( retrievedFilesApplyRefusal ) {
            return refuse(retrievedFilesApplyRefusal);
        }

        let orgTypeDetail: IOrgTypeDetail | undefined;
        let deployConnection: Connection;
        try {
            deployConnection = await SalesforceOrgService.getConnection(orgDetail.username);
            orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(deployConnection));
        } catch (connectionError) {
            return refuse(`Nothing was deployed: could not connect to ${orgLabel}: ${hub.describeThrown(connectionError)}`);
        }

        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was deployed: ${orgLabel} ${orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}` : 'could not say whether it is a sandbox'}. Metadata is deployed only to a sandbox or scratch org.`);
        }

        const operationName = METADATA_DEPLOY_OPERATION_BY_KIND[deployKind];
        const operationDate = new Date();
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree);
        let deployArguments: string[] = [];
        let deploySourceFiles: IMetadataDeploySourceFile[] | undefined;
        let packageXml = '';
        let packageXmlWrittenFilePath: string | undefined;
        let metadataZipWrittenFilePath: string | undefined;
        try {
            packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(components, hub.readSourceApiVersion(workspaceRoot), undefined, deployKind === 'fields' ? METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES : METADATA_DEPLOY_TYPES);
            const packageXmlFilePath = runArtifactsLocation ? RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(runArtifactsLocation, orgDetail.username, operationName, operationDate) : undefined;
            packageXmlWrittenFilePath = runArtifactsLocation && packageXmlFilePath ? RecipeCockpitMetadataDeploy.writePackageXml(runArtifactsLocation, packageXmlFilePath, packageXml) : undefined;
            if ( !packageXmlWrittenFilePath ) {
                return refuse(`Nothing was deployed: the package.xml could not be written under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
            }
            if ( deployMethodPlan.method !== 'cli' ) {
                // PLANNED AGAIN NOW, FOR EXACTLY WHAT WAS CONFIRMED: THE PROJECT CAN HAVE CHANGED WHILE THE CONFIRMATION WAS OPEN
                const confirmedPlan = RecipeCockpitMetadataDeployPackage.planDeployMethod(
                    RecipeCockpitMetadataDeployPackage.readDeployMethod(ConfigurationService.getExtensionConfigValue(METADATA_DEPLOY_METHOD_SETTING)),
                    workspaceRoot,
                    packageDirectoryPaths,
                    components,
                    hasObjectEdits
                );
                if ( confirmedPlan.method !== deployMethodPlan.method ) {
                    return refuse(`Nothing was deployed: ${RecipeCockpitMetadataDeployPackage.describeChangedPlan(confirmedPlan) || 'the metadata deploy method setting changed'}. Deploy again to see how it goes now.`);
                }
                deploySourceFiles = confirmedPlan.sourceFiles;
            } else {
                deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, packageXmlWrittenFilePath), orgDetail.username);
            }
        } catch (argumentError) {
            return refuse(hub.describeThrown(argumentError));
        }

        const cliStarted: IRecipeCockpitMetadataDeployClosingState = { cliStartedFor: { orgDetail: orgDetail, objectApiNames: touchedObjectApiNames } };
        let deployOutputFilePath: string | undefined;
        // THE HISTORY'S RECORD OF THIS DEPLOY (#485), WRITTEN ONCE THE CLI HAS RUN, WHATEVER IT ANSWERED
        const recordStep = (outcome: RunHistoryOutcome, counts: Pick<IRunHistoryStepRecord, 'succeededCount' | 'failedCount' | 'detail'> = {}) => RecipeCockpitTroubleshootingViews.recordTroubleshootingStep(runArtifactsLocation, {
            step: operationName,
            outcome: outcome,
            orgUsername: orgDetail.username,
            orgAlias: orgDetail.alias,
            startedAt: operationDate,
            finishedAt: new Date(),
            ...counts,
            // THE ZIP IS NOT ONE OF THE HISTORY'S FILES: A ROW OPENS ITS FILES AS TEXT, AND parseRunFileName NAMES NO ZIP (#547)
            filePaths: [packageXmlWrittenFilePath, deployOutputFilePath]
        });

        const progressTitle = RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: deploying ${componentText} to ${orgDetail.username}`);
        let deployOutcome: MetadataDeployOutcome;

        if ( deploySourceFiles && deployMethodPlan.method === 'jsforce' ) {

            const sourceFiles = deploySourceFiles;
            const metadataConnection: IMetadataDeployConnection = {
                metadata: {
                    deploy: (zipInput, options) => deployConnection.metadata.deploy(zipInput, options),
                    checkDeployStatus: (asyncProcessId, includeDetails) => deployConnection.metadata.checkDeployStatus(asyncProcessId, includeDetails),
                    cancelDeploy: asyncProcessId => deployConnection.metadata.cancelDeploy(asyncProcessId)
                }
            };
            // THE ZIP IS BUILT UNDER THE SAME CANCELLABLE PROGRESS AS THE DEPLOY: A LARGE TREE'S FILES TAKE SECONDS TO READ
            const jsforceAttempt: MetadataDeployRun | { kind: 'notBuilt'; refusalText: string } = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: progressTitle,
                cancellable: true
            }, async (_progress, cancellationToken) => {
                const isCancellationRequested = () => cancellationToken.isCancellationRequested;
                let zipInput: Buffer | undefined;
                try {
                    zipInput = await RecipeCockpitMetadataDeployPackage.buildDeployZip(packageXml, sourceFiles, isCancellationRequested);
                } catch (zipError) {
                    return { kind: 'notBuilt', refusalText: hub.describeThrown(zipError) };
                }
                return zipInput
                    ? await RecipeCockpitMetadataDeployPackage.runDeploy(metadataConnection, zipInput, { isCancellationRequested: isCancellationRequested, timeoutMilliseconds: METADATA_DEPLOY_TIMEOUT_MILLISECONDS })
                    : { kind: 'unconfirmed', failureMessage: 'The deploy was cancelled before it was sent, so nothing was deployed.', isCancelled: true, isSent: false };
            });

            if ( jsforceAttempt.kind === 'notBuilt' ) {
                return refuse(jsforceAttempt.refusalText);
            }
            const jsforceRun = jsforceAttempt;

            const savedPayload = jsforceRun.kind === 'unconfirmed'
                ? { ...( jsforceRun.payload ?? {} ), ...( jsforceRun.deployId ? { deployId: jsforceRun.deployId } : {} ), message: jsforceRun.failureMessage }
                : { ...jsforceRun.payload, deployId: jsforceRun.deployId };
            // A CANCEL BEFORE THE REQUEST WAS SENT LEAVES NOTHING TO RECORD; A REQUEST THAT FAILED MAY STILL HAVE REACHED THE ORG
            const wasSent = jsforceRun.kind !== 'unconfirmed' || jsforceRun.isSent;
            deployOutputFilePath = wasSent && runArtifactsLocation
                ? ScratchOrgService.writeOrgOperationPayload(workspaceRoot, orgDetail.username, operationName, savedPayload, operationDate, runArtifactsLocation)
                : undefined;

            if ( jsforceRun.kind === 'cancelled' ) {
                recordStep('cancelled');
                return refuse(jsforceRun.isTimedOut
                    ? `The deploy of ${componentText} for ${treeLabel} to ${orgLabel} did not finish in time and was cancelled in the org, so nothing was deployed.`
                    : `The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled in the org, so nothing was deployed.`, cliStarted);
            }

            if ( jsforceRun.kind === 'unconfirmed' && !jsforceRun.isSent ) {
                return refuse(`The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled before it was sent, so nothing was deployed.`);
            }

            if ( jsforceRun.kind === 'unconfirmed' && jsforceRun.isCancelled ) {
                recordStep('cancelled');
                return refuse(`The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled, but the org has not said it stopped, so whether it landed is unknown.`, cliStarted);
            }

            deployOutcome = jsforceRun.kind === 'unconfirmed'
                ? { kind: 'unconfirmed', failureMessage: jsforceRun.failureMessage }
                : RecipeCockpitMetadataDeploy.parseMetadataDeployPayload(
                    jsforceRun.payload,
                    typeof jsforceRun.payload.message === 'string' ? jsforceRun.payload.message : `The deploy ended with status ${String(( jsforceRun.payload.result as Record<string, unknown> ).status ?? 'unknown')}.`
                );

        } else {

            // THE CLI SENDS THE ZIP WITH THE OBJECTS' EDITED COPIES (#547), BUILT UNDER ITS OWN CANCELLABLE PROGRESS AND SAVED BESIDE THE PACKAGE.XML
            if ( deploySourceFiles ) {
                const sourceFiles = deploySourceFiles;
                const zipAttempt: { zipInput?: Buffer; refusalText?: string } = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: preparing ${componentText} for ${orgDetail.username}`),
                    cancellable: true
                }, async (_progress, cancellationToken) => {
                    try {
                        return { zipInput: await RecipeCockpitMetadataDeployPackage.buildDeployZip(packageXml, sourceFiles, () => cancellationToken.isCancellationRequested) };
                    } catch (zipError) {
                        return { refusalText: hub.describeThrown(zipError) };
                    }
                });
                if ( zipAttempt.refusalText !== undefined ) {
                    return refuse(zipAttempt.refusalText);
                }
                if ( !zipAttempt.zipInput ) {
                    return refuse(`The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled before it was sent, so nothing was deployed.`);
                }
                metadataZipWrittenFilePath = runArtifactsLocation && packageXmlWrittenFilePath
                    ? RecipeCockpitMetadataDeploy.writeMetadataZip(runArtifactsLocation, RecipeCockpitMetadataDeploy.buildMetadataZipFilePath(packageXmlWrittenFilePath), zipAttempt.zipInput)
                    : undefined;
                if ( !metadataZipWrittenFilePath ) {
                    return refuse(`Nothing was deployed: the metadata zip could not be written under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
                }
                try {
                    deployArguments = RecipeCockpitMetadataDeploy.buildMetadataZipDeployArguments(RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, metadataZipWrittenFilePath), orgDetail.username);
                } catch (argumentError) {
                    return refuse(hub.describeThrown(argumentError));
                }
            }

            const deployRun = await hub.runCancellableCli(
                progressTitle,
                deployArguments,
                METADATA_DEPLOY_TIMEOUT_MILLISECONDS,
                workspaceRoot,
                SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES
            );

            if ( deployRun.isCancelled ) {
                recordStep('cancelled');
                return refuse(`The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled, so whether it landed is unknown.`, cliStarted);
            }

            const deployPayload = ScratchOrgService.readCliJsonPayload(deployRun.invocation);
            deployOutcome = RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployRun.invocation, deployPayload);
            deployOutputFilePath = deployRun.invocation.spawnError || deployRun.invocation.isOutputTooLarge
                ? undefined
                : runArtifactsLocation && ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, operationName, deployRun.invocation, operationDate, deployPayload, runArtifactsLocation);

        }

        switch ( deployOutcome.kind ) {

            case 'deployed':
                recordStep('succeeded', { succeededCount: components.length });
                return {
                    ...cliStarted,
                    isDeployed: true,
                    showOutcome: () => this.showMetadataDeployNotification(hub, 
                        'information',
                        `Deployed ${componentText} for ${treeLabel} to ${orgLabel}.`,
                        deployOutputFilePath,
                        workspaceRoot,
                        deployKind === 'permissionSet' ? { cockpitPanel: cockpitPanel, treeKey: tree.treeKey, orgUsername: orgDetail.username } : undefined
                    )
                };

            case 'cliNotInstalled':
                recordStep('failed', { detail: deployOutcome.failureMessage });
                return refuse(deployOutcome.failureMessage, cliStarted);

            case 'unconfirmed':
                recordStep('unknown', { detail: deployOutcome.failureMessage });
                this.showMetadataDeployNotification(hub, 'warning', deployOutcome.failureMessage, deployOutputFilePath, workspaceRoot);
                return cliStarted;

            case 'failed': {
                const shownFailures = deployOutcome.componentFailureMessages.slice(0, METADATA_DEPLOY_FAILURES_SHOWN);
                const hiddenFailureCount = deployOutcome.componentFailureMessages.length - shownFailures.length;
                const failureText = shownFailures.length > 0
                    ? `${shownFailures.join('; ')}${hiddenFailureCount > 0 ? `; and ${hiddenFailureCount} more` : ''}`
                    : deployOutcome.failureMessage;
                recordStep('failed', { failedCount: deployOutcome.componentFailureMessages.length, detail: failureText });
                this.showMetadataDeployNotification(hub, 'warning', `Nothing was deployed to ${orgLabel}: ${failureText}`, deployOutputFilePath, workspaceRoot);
                return cliStarted;
            }

        }

    }

    /*
        A success is INFORMATION, every other outcome a WARNING. "View output" opens the CLI's result
        file when there is one; a permission set deploy that landed also offers "Assign permission
        sets to me…", routed through routePanelMessage like a click so every assign guard holds. NOT
        AWAITED: the run ends, and gives the panel its buttons back, without waiting for a click.
    */
    private static showMetadataDeployNotification(hub: IRecipeCockpitHubForTroubleshootingTab, severity: 'information' | 'warning',
                                                    notificationText: string,
                                                    outputFilePath: string | undefined,
                                                    workspaceRoot: string,
                                                    assignFollowUp?: { cockpitPanel: vscode.WebviewPanel; treeKey: string; orgUsername: string }) {

        const actions = [
            ...( outputFilePath ? [RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL] : [] ),
            ...( assignFollowUp ? [RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL] : [] )
        ];
        ({ severity, notificationText } = hub.withRunArtifactsGitIgnoreNote(severity, notificationText, outputFilePath));
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);
        const shown = severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions);

        Promise.resolve(shown)
            .then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The deploy result file no longer exists in this workspace.');
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL && assignFollowUp && hub.recipeCockpitPanel === assignFollowUp.cockpitPanel ) {
                    const panelState = hub.recipeCockpitPanelState;
                    // THE SELECTION ONLY WHEN IT IS THE ORG THE SETS WERE DEPLOYED TO; OTHERWISE THE ASSIGN ASKS FOR AN ORG ITSELF
                    const isDeployedOrgSelected = panelState.dataOrgSelection?.orgDetail.username === assignFollowUp.orgUsername;
                    const assignAction = hub.routePanelMessage({
                        command: 'assignTreePermissionSets',
                        treeKey: assignFollowUp.treeKey,
                        ...( isDeployedOrgSelected && panelState.dataOrgSelection ? { orgIndex: panelState.dataOrgSelection.orgIndex } : {} )
                    }, panelState);
                    if ( assignAction ) {
                        // ITS OWN ACTION, NOT THE ENDED DEPLOY'S: ITS "Change org…" (#480) STARTS THE ASSIGNMENT AGAIN
                        await hub.runPanelAction(assignFollowUp.cockpitPanel, assignAction);
                    }
                }
            })
            .catch(() => undefined);

    }

    /*
        The Troubleshooting tab's retrieves (#326, #382), for one tree of the model on screen: the org
        is the Target Org Manager selection, of any type since a retrieve only reads, asked for once
        and made the selection only when there is none (#480); then a confirmation names what is retrieved, the
        org, where new files go and how many local files the org's version overwrites; then one
        "sf project retrieve start --manifest" runs in project mode, cancellable. Validation rules and
        record types are first LISTED in the org (listMetadata on a jsforce connection, #401, #498), after the prompt
        and before the confirmation, so the confirmation and the package.xml name each one. Nothing is deployed, and the
        recipe is not regenerated: the notification offers Generate Treecipe. One retrieve per window,
        whatever its kind.
    */
    static async retrieveTreeMetadataFromPanel(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, retrieveKind: MetadataRetrieveKind) {

        const resolveOrgDetail = () => hub.resolveSelectedReadOrg(
            cockpitPanel,
            hub.recipeCockpitPanelState,
            'Nothing was retrieved',
            RECIPE_COCKPIT_RETRIEVE_ORG_PLACEHOLDERS[retrieveKind],
            RECIPE_COCKPIT_RETRIEVE_ORG_BUSY_REFUSAL,
            RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE,
            'isOrgPromptOpen'
        );

        const panelState = hub.recipeCockpitPanelState;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( hub.isMetadataRetrieveInFlight || !recipeViewModel || !tree ) {
            hub.postToPanel(cockpitPanel, hub.metadataRetrieveRunStateMessage
                ?? { command: 'metadataRetrieveState', isRunning: false, treeKey: treeKey, retrieveKind: retrieveKind });
            return;
        }

        hub.isMetadataRetrieveInFlight = true;
        hub.setMetadataRetrieveState({ command: 'metadataRetrieveState', isRunning: true, treeKey: treeKey, retrieveKind: retrieveKind });

        // ONLY A CLI THAT RAN CAN HAVE WRITTEN FILES, AND ONLY A VALIDATION RULE RETRIEVE WRITES WHAT THE RULE LISTS READ
        let isCliStarted = false;
        try {
            isCliStarted = await this.performMetadataRetrieve(hub, panelState.workspaceRoot, recipeViewModel, tree, retrieveKind, resolveOrgDetail);
        } finally {
            hub.isMetadataRetrieveInFlight = false;
            hub.setMetadataRetrieveState({ command: 'metadataRetrieveState', isRunning: false, treeKey: treeKey, retrieveKind: retrieveKind });
            RecipeCockpitTroubleshootingViews.refreshTroubleshootingHistory(hub, treeKey);
            if ( isCliStarted ) {
                await RecipeCockpitTroubleshootingViews.refreshTroubleshootingSummary(hub, treeKey);
                if ( retrieveKind === 'validationRules' ) {
                    await RecipeCockpitTroubleshootingViews.refreshTreeValidationRules(hub, treeKey);
                }
            }
        }

    }

    private static async performMetadataRetrieve(hub: IRecipeCockpitHubForTroubleshootingTab, workspaceRoot: string,
                                                    recipeViewModel: IRecipeCockpitRecipeViewModel,
                                                    tree: IRecipeCockpitTreeViewModel,
                                                    retrieveKind: MetadataRetrieveKind,
                                                    resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>): Promise<boolean> {

        const treeLabel = tree.customName || tree.title;
        const manyNoun = RecipeCockpitMetadataRetrieve.componentNoun(retrieveKind, 2);
        const isListed = RecipeCockpitMetadataRetrieve.isListedKind(retrieveKind);
        const refuse = (refusalText: string): false => { hub.showMetadataRetrieveNotification('warning', refusalText, undefined, workspaceRoot, false); return false; };

        // A LISTED KIND KEEPS WHAT THE ORG HOLDS FOR EVERY OBJECT THE CARD LISTS, ONCE, AS AN API NAME
        const { retrievable: objectApiNames, refused: refusedObjectApiNames } = RecipeCockpitMetadataRetrieve.partitionObjectApiNames(tree.objects.map(treeObject => treeObject.objectApiName));

        if ( isListed && objectApiNames.length === 0 ) {
            return refuse(`No ${manyNoun} were retrieved: no object of ${treeLabel} has an api name.`);
        }

        let packageDirectoryPaths: string[];
        let defaultPackageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            defaultPackageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            return refuse(`No ${manyNoun} were retrieved: ${hub.describeThrown(projectError)}`);
        }

        // WHAT A FIELD OR VALUE SET RETRIEVE NAMES, AND WHAT A VALUE SET RETRIEVE COUNTS AS ALREADY HERE, IS READ FROM THE PROJECT NOW
        let manifestComponents: IMetadataDeployComponent[] = [];
        let summary: IMetadataDeploySummary | undefined;

        if ( retrieveKind === 'fields' ) {
            manifestComponents = RecipeCockpitMetadataRetrieve.listCustomFieldComponents(hub.listTreeDeployObjects(recipeViewModel, tree));
        } else if ( retrieveKind === 'globalValueSets' ) {
            summary = await RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, packageDirectoryPaths, hub.listTreeDeployObjects(recipeViewModel, tree));
            manifestComponents = RecipeCockpitMetadataRetrieve.listManifestComponents(retrieveKind, summary);
        }

        if ( retrieveKind === 'fields' || retrieveKind === 'globalValueSets' ) {
            if ( manifestComponents.length === 0 ) {
                return refuse(retrieveKind === 'fields'
                    ? `${treeLabel} has no custom field to retrieve, so nothing was retrieved.`
                    : `No field of ${treeLabel} names a global value set, so nothing was retrieved.`);
            }
        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`No ${manyNoun} were retrieved: ${hub.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return false;
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const objectsText = `${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'}`;
        let skippedListedCount = 0;
        const describeSkipped = () => {
            const skippedNameCount = isListed ? refusedObjectApiNames.length + skippedListedCount : 0;
            return skippedNameCount > 0
                ? ` Skipped ${skippedNameCount} ${skippedNameCount === 1 ? 'name that is' : 'names that are'} not an api name.`
                : '';
        };

        // THE HISTORY'S RECORD OF THIS RETRIEVE (#485), FROM THE FIRST STEP THAT RAN -- THE LISTING, FOR A LISTED KIND
        let stepStartedAt = new Date();
        let retrievePackageXmlFilePath: string | undefined;
        let retrieveOutputFilePath: string | undefined;
        const retrievingOrgDetail = orgDetail;
        const recordStep = (outcome: RunHistoryOutcome, counts: Pick<IRunHistoryStepRecord, 'succeededCount' | 'failedCount' | 'detail'>) => RecipeCockpitTroubleshootingViews.recordTroubleshootingStep(hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree), {
            step: METADATA_RETRIEVE_OPERATION_BY_KIND[retrieveKind],
            outcome: outcome,
            orgUsername: retrievingOrgDetail.username,
            orgAlias: retrievingOrgDetail.alias,
            startedAt: stepStartedAt,
            finishedAt: new Date(),
            ...counts,
            filePaths: [retrievePackageXmlFilePath, retrieveOutputFilePath]
        });

        if ( isListed ) {

            stepStartedAt = new Date();
            const listingUsername = orgDetail.username;
            const listOutcome = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: listing ${manyNoun} in ${listingUsername}`),
                cancellable: true
            }, async (_progress, cancellationToken) => await RecipeCockpitMetadataRetrieve.listOrgMetadata(
                async () => ( await SalesforceOrgService.getConnection(listingUsername) ).metadata,
                retrieveKind,
                objectApiNames,
                METADATA_LIST_TIMEOUT_MILLISECONDS,
                cancellationToken
            ));

            // A LISTING WRITES NOTHING, SO A CANCEL OR A FAILURE HERE OFFERS NO GENERATE TREECIPE
            if ( listOutcome.kind === 'cancelled' ) {
                recordStep('cancelled', { detail: 'The listing was cancelled, so nothing was retrieved.' });
                return refuse(`The listing of ${manyNoun} in ${orgLabel} was cancelled, so nothing was retrieved.`);
            }

            if ( listOutcome.kind !== 'listed' ) {
                recordStep('failed', { detail: `The ${manyNoun} could not be listed. ${listOutcome.failureMessage}` });
                return refuse(`No ${manyNoun} were retrieved: the ${manyNoun} ${orgLabel} holds could not be listed. ${listOutcome.failureMessage}`);
            }

            skippedListedCount = listOutcome.skippedCount;

            if ( listOutcome.components.length === 0 ) {
                recordStep('succeeded', { succeededCount: 0, detail: `The org holds no ${RecipeCockpitMetadataRetrieve.componentNoun(retrieveKind, 1)} for these objects, so nothing was retrieved.` });
                const skippedText = describeSkipped();
                hub.showMetadataRetrieveNotification(skippedText ? 'warning' : 'information', `${orgLabel} holds no ${RecipeCockpitMetadataRetrieve.componentNoun(retrieveKind, 1)} for the ${objectsText} of ${treeLabel}, so nothing was retrieved.${skippedText}`, undefined, workspaceRoot, false);
                return false;
            }

            if ( listOutcome.components.length > METADATA_RETRIEVE_MAX_COMPONENTS ) {
                recordStep('failed', { detail: `The org holds ${listOutcome.components.length}, and one retrieve can bring at most ${METADATA_RETRIEVE_MAX_COMPONENTS}.` });
                return refuse(`No ${manyNoun} were retrieved: ${orgLabel} holds ${listOutcome.components.length} for the ${objectsText} of ${treeLabel}, and one retrieve can bring at most ${METADATA_RETRIEVE_MAX_COMPONENTS}.`);
            }

            manifestComponents = listOutcome.components;

        }

        const askedNames = manifestComponents.map(component => component.member);
        const packageDirectoryRelativePath = path.relative(workspaceRoot, defaultPackageDirectoryPath).split(path.sep).join('/') || '.';
        const localFileCount = RecipeCockpitMetadataRetrieve.isListedKind(retrieveKind) ? RecipeCockpitMetadataRetrieve.countLocalListedFiles(workspaceRoot, packageDirectoryPaths, retrieveKind, askedNames)
            : retrieveKind === 'fields' ? RecipeCockpitMetadataRetrieve.countLocalFieldFiles(workspaceRoot, packageDirectoryPaths, askedNames)
            : summary?.globalValueSets.length ?? 0;
        const confirmationTitle = isListed
            ? `Retrieve ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, askedNames.length)} of ${objectsText} of ${hub.toSingleLine(treeLabel)} from ${hub.toSingleLine(orgLabel)}?`
            : `Retrieve ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, askedNames.length)} of ${hub.toSingleLine(treeLabel)} from ${hub.toSingleLine(orgLabel)}?`;

        const confirmation = await hub.confirmInPanel(
            confirmationTitle,
            {
                ...RecipeCockpitMetadataRetrieve.buildConfirmationContent(retrieveKind, treeLabel, hub.buildConfirmOrg(orgDetail), askedNames, packageDirectoryRelativePath, localFileCount),
                isDestructive: true,
                changeOrg: { restartMessage: { command: RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind], treeKey: tree.treeKey }, isSandboxOnly: false }
            },
            RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL ) {
            return false;
        }

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE PROMPT OR THE MODAL WAS OPEN
        const currentPanelState = hub.recipeCockpitPanelState;
        if ( currentPanelState.insertStateMessage || currentPanelState.permissionSetAssignStateMessage?.isRunning || hub.isMetadataDeployInFlight ) {
            return refuse(RECIPE_COCKPIT_METADATA_RETRIEVE_BUSY_REFUSAL);
        }
        const retrievedFilesApplyRefusal = hub.findRetrievedFilesApplyRefusal(currentPanelState);
        if ( retrievedFilesApplyRefusal ) {
            return refuse(retrievedFilesApplyRefusal);
        }

        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree);
        let retrieveArguments: string[];
        try {
            const packageXml = RecipeCockpitMetadataRetrieve.buildRetrievePackageXml(manifestComponents, hub.readSourceApiVersion(workspaceRoot));
            const packageXmlFilePath = runArtifactsLocation ? RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(runArtifactsLocation, orgDetail.username, METADATA_RETRIEVE_OPERATION_BY_KIND[retrieveKind], new Date()) : undefined;
            retrievePackageXmlFilePath = runArtifactsLocation && packageXmlFilePath ? RecipeCockpitMetadataDeploy.writePackageXml(runArtifactsLocation, packageXmlFilePath, packageXml) : undefined;
            if ( !retrievePackageXmlFilePath ) {
                return refuse(`No ${manyNoun} were retrieved: the package.xml could not be written under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
            }
            retrieveArguments = RecipeCockpitMetadataRetrieve.buildManifestRetrieveArguments(RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, retrievePackageXmlFilePath), orgDetail.username);
        } catch (argumentError) {
            return refuse(`No ${manyNoun} were retrieved: ${hub.describeThrown(argumentError)}`);
        }

        if ( !isListed ) {
            stepStartedAt = new Date();
        }
        const retrieveRun = await hub.runCancellableRetrieve(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: retrieving ${manyNoun} from ${orgDetail.username}`),
            retrieveArguments,
            workspaceRoot,
            { orgUsername: orgDetail.username, components: manifestComponents, destination: { kind: 'project', packageDirectoryPaths: packageDirectoryPaths, defaultPackageDirectoryPath: defaultPackageDirectoryPath } }
        );

        // THE jsforce RETRIEVE WRITES ONLY ONCE THE ORG'S ZIP IS READ, SO ITS CANCEL WROTE NOTHING (#506)
        if ( retrieveRun.isCancelled && retrieveRun.isNothingWritten ) {
            recordStep('cancelled', { detail: 'Nothing was written.' });
            return refuse(`The retrieve of ${manyNoun} from ${orgLabel} was cancelled before anything was written.`);
        }

        if ( retrieveRun.invocation.timedOut && retrieveRun.isNothingWritten ) {
            recordStep('failed', { detail: 'It did not finish in time. Nothing was written.' });
            return refuse(`The retrieve of ${manyNoun} from ${orgLabel} did not finish in time, so nothing was written.`);
        }

        // A CANCEL CAN COME AFTER THE CLI WROTE FILES, SO GENERATE TREECIPE IS OFFERED AS AFTER A TIMEOUT
        if ( retrieveRun.isCancelled ) {
            recordStep('cancelled', { detail: 'Which files were written is unknown.' });
            hub.showMetadataRetrieveNotification('warning', `The retrieve of ${manyNoun} from ${orgLabel} was cancelled, so which files were written is unknown.`, undefined, workspaceRoot, true);
            return true;
        }

        const retrievePayload = retrieveRun.payload;
        const retrieveOutcome: MetadataRetrieveOutcome = RecipeCockpitMetadataRetrieve.parseRetrieveOutput(retrieveKind, retrieveRun.invocation, askedNames, retrievePayload);
        retrieveOutputFilePath = retrieveRun.invocation.spawnError || retrieveRun.invocation.isOutputTooLarge
            ? undefined
            : runArtifactsLocation && ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, METADATA_RETRIEVE_OPERATION_BY_KIND[retrieveKind], retrieveRun.invocation, new Date(), retrievePayload, runArtifactsLocation);
        const refusedText = describeSkipped();

        switch ( retrieveOutcome.kind ) {

            case 'retrieved': {
                const { componentCount, namesWithComponents, failureMessages } = retrieveOutcome;
                const retrievedText = this.describeRetrieved(retrieveKind, componentCount, namesWithComponents, askedNames, objectApiNames, treeLabel, orgLabel);
                recordStep(failureMessages.length === 0 ? 'succeeded' : componentCount > 0 ? 'partial' : 'failed', {
                    succeededCount: componentCount,
                    ...( failureMessages.length > 0 ? { failedCount: failureMessages.length, detail: RecipeCockpitMetadataDeploy.describeCappedList(failureMessages) } : {} )
                });
                if ( failureMessages.length > 0 ) {
                    hub.showMetadataRetrieveNotification('warning', `${retrievedText} ${failureMessages.length} could not be retrieved: ${RecipeCockpitMetadataDeploy.describeCappedList(failureMessages)}.${refusedText}`, retrieveOutputFilePath, workspaceRoot, componentCount > 0);
                    return true;
                }
                hub.showMetadataRetrieveNotification(refusedText ? 'warning' : 'information', `${retrievedText}${refusedText}`, refusedText ? retrieveOutputFilePath : undefined, workspaceRoot, componentCount > 0);
                return true;
            }

            case 'cliNotInstalled':
                recordStep('failed', { detail: retrieveOutcome.failureMessage });
                return refuse(retrieveOutcome.failureMessage);

            case 'unconfirmed':
                recordStep('unknown', { detail: retrieveOutcome.failureMessage });
                hub.showMetadataRetrieveNotification('warning', retrieveOutcome.failureMessage, retrieveOutputFilePath, workspaceRoot, true);
                return true;

            case 'failed':
                recordStep('failed', { detail: retrieveOutcome.failureMessage });
                hub.showMetadataRetrieveNotification('warning', `No ${manyNoun} were retrieved from ${orgLabel}: ${retrieveOutcome.failureMessage}`, retrieveOutputFilePath, workspaceRoot, false);
                return true;

        }

    }

    // WHAT A RETRIEVE THAT CAME BACK SAYS: WHAT THE ORG HELD OF WHAT WAS ASKED FOR, AND WHAT GENERATE TREECIPE DOES WITH IT
    private static describeRetrieved(retrieveKind: MetadataRetrieveKind,
                                        componentCount: number,
                                        namesWithComponents: string[],
                                        askedNames: string[],
                                        objectApiNames: string[],
                                        treeLabel: string,
                                        orgLabel: string): string {

        // A LISTED KIND IS REPORTED PER OBJECT: THE TREE'S OBJECTS, IN ITS ORDER, THAT A RETRIEVED "<Object>.<Name>" NAMES
        if ( RecipeCockpitMetadataRetrieve.isListedKind(retrieveKind) ) {
            const objectsText = `${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'}`;
            const lowerObjectNamesWithComponents = new Set(namesWithComponents.map(member => member.split('.')[0].toLowerCase()));
            const objectsWithComponents = objectApiNames.filter(objectApiName => lowerObjectNamesWithComponents.has(objectApiName.toLowerCase()));
            return componentCount === 0
                ? `${orgLabel} returned none of the ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, askedNames.length)} it listed for the ${objectsText} of ${treeLabel}, so nothing was written.`
                : `Retrieved ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, componentCount)} for ${objectsWithComponents.length} of ${objectsText} of ${treeLabel} from ${orgLabel}: ${objectsWithComponents.join(', ')}. ${retrieveKind === 'validationRules' ? 'Generate Treecipe applies them to the recipe.' : 'Generate Treecipe can then use them in the recipe.'}`;
        }

        return componentCount === 0
            ? `${orgLabel} holds none of the ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, askedNames.length)} of ${treeLabel}, so nothing was written.`
            : `Retrieved ${componentCount} of the ${RecipeCockpitMetadataRetrieve.describeComponents(retrieveKind, askedNames.length)} of ${treeLabel} from ${orgLabel}${retrieveKind === 'globalValueSets' ? `: ${namesWithComponents.join(', ')}` : ''}. Generate Treecipe writes them into the recipe.`;

    }

    private static isPermissionSetGenerateInFlight = false;

    /*
        "Generate permission set…" (#306): one permission set granting Create and Read on every
        object the tree inserts and access to its recipe fields, written to
        <default package directory>/main/default/permissionsets/SDT_Treecipe/ after a modal that says
        it will not be deployed. The cockpit deploys no metadata (#302): the notification offers the
        deploy command for the clipboard, and "Assign permission sets to me…", which goes through the
        router like a click so every guard of the assign still holds.
    */
    static async generateTreePermissionSetFromPanel(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string) {

        if ( this.isPermissionSetGenerateInFlight ) {
            return;
        }

        this.isPermissionSetGenerateInFlight = true;

        try {
            await this.performPermissionSetGenerate(hub, cockpitPanel, treeKey);
        } finally {
            this.isPermissionSetGenerateInFlight = false;
            await RecipeCockpitTroubleshootingViews.refreshTroubleshootingSummary(hub, treeKey);
            RecipeCockpitTroubleshootingViews.refreshTroubleshootingHistory(hub, treeKey);
        }

    }

    private static async performPermissionSetGenerate(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string) {

        const panelState = hub.recipeCockpitPanelState;
        const workspaceRoot = panelState.workspaceRoot;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeViewModel || !tree ) {
            return;
        }

        const treeLabel = tree.customName || tree.title;
        const refuse = (refusalText: string) => {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`No permission set was written for ${hub.toSingleLine(treeLabel)}: ${refusalText}`));
        };

        const permissionSetName = RecipeCockpitPermissionSetGenerate.buildPermissionSetName(tree.folderName);
        if ( !permissionSetName ) {
            refuse(`its folder name ${hub.toSingleLine(tree.folderName)} does not make a permission set name.`);
            return;
        }

        let packageDirectoryPath: string;
        let objectsDirectoryPath: string;
        try {
            packageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
            objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        } catch (projectError) {
            refuse(hub.describeThrown(projectError));
            return;
        }

        // listTreeInsertObjectApiNames ANSWERS ONLY OBJECTS THE RECIPE HOLDS, SO EACH IS ONE OF recipeViewModel.objects
        const insertObjectApiNames = new Set(RecipeCockpitTreecipeDataOrgs.listTreeInsertObjectApiNames(hub, recipeViewModel, tree));
        const plan = await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, recipeViewModel.objects
            .filter(objectViewModel => insertObjectApiNames.has(objectViewModel.objectApiName))
            .map(objectViewModel => ({
                objectApiName: objectViewModel.objectApiName,
                fieldApiNames: objectViewModel.fields
                    .filter(fieldViewModel => !fieldViewModel.isOnlyInRecipeFile)
                    .map(fieldViewModel => fieldViewModel.fieldApiName)
            })));

        if ( plan.objectApiNames.length === 0 ) {
            refuse('none of its objects has an api name.');
            return;
        }

        const permissionSetFilePath = RecipeCockpitPermissionSetGenerate.getPermissionSetFilePath(packageDirectoryPath, permissionSetName);
        const relativeFilePath = path.relative(workspaceRoot, permissionSetFilePath).split(path.sep).join('/');
        const isOverwrite = fs.existsSync(permissionSetFilePath);
        const describeCount = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
        const objectCountText = describeCount(plan.objectApiNames.length, 'object');
        const fieldCountText = describeCount(plan.fieldPermissions.length, 'field');

        const confirmation = await hub.confirmInPanel(
            `${isOverwrite ? 'Overwrite' : 'Write'} the permission set ${permissionSetName} for ${hub.toSingleLine(treeLabel)}?`,
            {
                isDestructive: isOverwrite,
                summary: [
                    `File: ${relativeFilePath}`,
                    `Grants Create and Read on ${objectCountText} and access to ${fieldCountText}, read-only where the org computes the value.`
                ],
                warnings: isOverwrite ? ['The file already exists and will be overwritten: Treecipe owns this file.'] : [],
                sections: [
                    { title: 'What happens next', lines: ['It will not be deployed: deploy it with your own flow.', 'Then assign it with "Assign permission sets to me…".'] }
                ]
            },
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL ) {
            return;
        }

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE MODAL WAS OPEN, AND NOTHING AWAITS BETWEEN HERE AND THE WRITE
        const currentPanelState = hub.recipeCockpitPanelState;
        if ( currentPanelState.wireLookupStateMessage || currentPanelState.permissionSetAssignStateMessage?.isRunning || hub.isMetadataDeployInFlight ) {
            refuse('a recipe write, a permission set assignment or a metadata deploy started meanwhile. Try again once it has finished.');
            return;
        }

        const permissionSetFolderPath = path.dirname(permissionSetFilePath);
        const stepStartedAt = new Date();
        try {
            // THE DEEPEST FOLDER THAT EXISTS IS CHECKED BEFORE ANY IS MADE: A LINKED ANCESTOR WOULD OTHERWISE GET FOLDERS MADE OUTSIDE THE WORKSPACE
            let existingAncestorPath = permissionSetFolderPath;
            while ( !fs.existsSync(existingAncestorPath) && path.dirname(existingAncestorPath) !== existingAncestorPath ) {
                existingAncestorPath = path.dirname(existingAncestorPath);
            }
            if ( !SfdxProjectService.isPathContainedInWorkspace(existingAncestorPath, workspaceRoot) ) {
                refuse(`${relativeFilePath} is not inside this workspace.`);
                return;
            }
            fs.mkdirSync(permissionSetFolderPath, { recursive: true });
            // CHECKED AGAIN ONCE THE FOLDER EXISTS: writeFileSync FOLLOWS A LINKED FOLDER WHEREVER IT POINTS
            if ( !SfdxProjectService.isPathContainedInWorkspace(permissionSetFolderPath, workspaceRoot) ) {
                refuse(`${relativeFilePath} is not inside this workspace.`);
                return;
            }
            if ( fs.existsSync(permissionSetFilePath) && !fs.lstatSync(permissionSetFilePath).isFile() ) {
                refuse(`${relativeFilePath} exists and is not a file, so it was left as it is.`);
                return;
            }
            fs.writeFileSync(permissionSetFilePath, RecipeCockpitPermissionSetGenerate.buildPermissionSetXml(
                RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel(treeLabel, permissionSetName),
                tree.folderName,
                plan
            ), 'utf8');
        } catch (writeError) {
            RecipeCockpitTroubleshootingViews.recordTroubleshootingStep(hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree), {
                step: 'permission-set-generate',
                outcome: 'failed',
                startedAt: stepStartedAt,
                finishedAt: new Date(),
                detail: `${relativeFilePath} could not be written: ${hub.describeThrown(writeError)}`,
                filePaths: []
            });
            refuse(hub.describeThrown(writeError));
            return;
        }

        const leftOutTexts = ([
            [plan.notGrantableFieldCount, 'required or master-detail field', ', which Salesforce does not take in a permission set'],
            [plan.requiredUnknownFieldCount, 'standard field', ' without <required>false</required> in its source file'],
            [plan.unreadableFieldCount, 'field', ' whose source file could not be read'],
            [plan.skippedNameCount, 'invalid api name', '']
        ] as Array<[number, string, string]>)
            .filter(([count]) => count > 0)
            .map(([count, noun, reason]) => `${describeCount(count, noun)}${reason}`);

        const writtenAt = new Date();
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree);
        const resultFilePath = runArtifactsLocation && RecipeCockpitPermissionSetGenerate.writeGenerateResult(runArtifactsLocation, {
            operation: 'permission-set-generate',
            writtenAt: writtenAt.toISOString(),
            treeFolderName: tree.folderName,
            permissionSetName: permissionSetName,
            permissionSetFile: relativeFilePath,
            isOverwrite: isOverwrite,
            objectApiNames: plan.objectApiNames,
            fieldPermissionCount: plan.fieldPermissions.length,
            skippedNameCount: plan.skippedNameCount,
            unreadableFieldCount: plan.unreadableFieldCount,
            notGrantableFieldCount: plan.notGrantableFieldCount,
            requiredUnknownFieldCount: plan.requiredUnknownFieldCount
        }, writtenAt);
        RecipeCockpitTroubleshootingViews.recordTroubleshootingStep(runArtifactsLocation, {
            step: 'permission-set-generate',
            outcome: 'succeeded',
            startedAt: stepStartedAt,
            finishedAt: new Date(),
            succeededCount: plan.fieldPermissions.length,
            detail: `${permissionSetName} at ${relativeFilePath}${isOverwrite ? ', overwritten' : ''}: Create and Read on ${objectCountText}, access to ${fieldCountText}.`,
            filePaths: [resultFilePath]
        });
        const generatedNotice = hub.withRunArtifactsGitIgnoreNote('information', `Wrote ${permissionSetName} to ${relativeFilePath}: Create and Read on ${objectCountText}, access to ${fieldCountText}.${leftOutTexts.length > 0 ? ` Left out: ${leftOutTexts.join('; ')}.` : ''} Deploy it, then assign it.`, resultFilePath);

        this.showGeneratedPermissionSetNotification(hub, 
            RecipeYamlScalar.escapeForNotification(generatedNotice.notificationText),
            permissionSetName,
            permissionSetFilePath,
            workspaceRoot,
            cockpitPanel,
            treeKey,
            generatedNotice.severity
        );

    }

    // NOT AWAITED: THE BUTTONS ACT WHENEVER THE READER CLICKS, ON WHATEVER IS ON SCREEN THEN
    private static showGeneratedPermissionSetNotification(hub: IRecipeCockpitHubForTroubleshootingTab, notificationText: string,
                                                            permissionSetName: string,
                                                            permissionSetFilePath: string,
                                                            workspaceRoot: string,
                                                            cockpitPanel: vscode.WebviewPanel,
                                                            treeKey: string,
                                                            severity: 'information' | 'warning' = 'information') {

        Promise.resolve(( severity === 'information' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage )(
            notificationText,
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL,
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL,
            RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL
        ))
            .then(async chosenAction => {

                if ( chosenAction === RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(permissionSetFilePath, workspaceRoot, 'The generated permission set no longer exists in this workspace.');
                } else if ( chosenAction === RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL ) {
                    await vscode.env.clipboard.writeText(RecipeCockpitPermissionSetGenerate.buildDeployCommand(permissionSetName));
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL && hub.recipeCockpitPanel === cockpitPanel ) {
                    const panelState = hub.recipeCockpitPanelState;
                    const assignAction = hub.routePanelMessage({
                        command: 'assignTreePermissionSets',
                        treeKey: treeKey,
                        ...( panelState.dataOrgSelection ? { orgIndex: panelState.dataOrgSelection.orgIndex } : {} )
                    }, panelState);
                    if ( assignAction ) {
                        // ITS OWN ACTION, NOT THE ENDED GENERATE'S: ITS "Change org…" (#480) STARTS THE ASSIGNMENT AGAIN
                        await hub.runPanelAction(cockpitPanel, assignAction);
                    }
                }

            })
            .catch(() => undefined);

    }

    private static async promptForPermissionSetOrg(hub: IRecipeCockpitHubForTroubleshootingTab): Promise<IAuthenticatedOrgDetail | undefined> {

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
            SalesforceOrgService.listDataOrgDetails().then(dataOrgListing => ({
                orgDetails: dataOrgListing.orgDetails,
                emptyListMessage: RecipeCockpitTreecipeDataOrgs.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts)
            })),
            RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER
        );

    }

    // THE READER'S PICK, IN THE ORDER OFFERED; undefined WHEN THE PICK WAS DISMISSED OR LEFT EMPTY
    private static async promptForPermissionSets(permissionSets: IPermissionSetCandidate[], treeObjectCount: number): Promise<IPermissionSetCandidate[] | undefined> {

        const pickedItems = await vscode.window.showQuickPick(
            permissionSets.map(permissionSet => ({
                label: permissionSet.name,
                description: RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, treeObjectCount),
                detail: permissionSet.relativeFilePath,
                permissionSet: permissionSet
            })),
            { canPickMany: true, ignoreFocusOut: true, matchOnDescription: true, placeHolder: RECIPE_COCKPIT_PERMISSION_SET_PICK_PLACEHOLDER }
        );

        return pickedItems && pickedItems.length > 0 ? pickedItems.map(pickedItem => pickedItem.permissionSet) : undefined;

    }

    /*
        Everything is found and picked BEFORE an org is asked for, so a project with no permission
        set for the tree opens no picker; a dismissed pick or org prompt is a quiet cancel. After the
        confirmation the org is asked again whether it is a sandbox and, on the same connection,
        which picks it holds and which user it is authorized as; the picks it holds are assigned to
        that user by ONE PermissionSetAssignment insert on that connection (#500), and nothing is
        sent for a pick the org does not hold. The insert has no Cancel: one request cannot be
        taken back once sent, and a timeout reports which landed as unknown.
    */
    private static async performPermissionSetAssign(hub: IRecipeCockpitHubForTroubleshootingTab, workspaceRoot: string,
                                                    treeLabel: string,
                                                    objectApiNames: string[],
                                                    resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>,
                                                    onAssignStarted: (orgDetail: IAuthenticatedOrgDetail, coveredObjectApiNames: string[]) => void,
                                                    changeOrg?: IRecipeCockpitConfirmChangeOrg,
                                                    runArtifactsLocation?: IRecipeCockpitRunArtifactsLocation): Promise<IRecipeCockpitPermissionSetClosingState> {

        const refuse = (refusalText: string, closingState: IRecipeCockpitPermissionSetClosingState = {}): IRecipeCockpitPermissionSetClosingState => {
            this.showPermissionSetNotification(hub, refusalText, undefined, workspaceRoot);
            return closingState;
        };

        let packageDirectoryPaths: string[];
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        } catch (projectError) {
            return refuse(`Nothing was assigned: ${hub.describeThrown(projectError)}`);
        }

        const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(objectApiNames, workspaceRoot, packageDirectoryPaths);
        const skippedFilePaths = [...discovery.unparseableFilePaths, ...discovery.notApiNameFilePaths];

        if ( skippedFilePaths.length > 0 ) {
            const shownFilePaths = skippedFilePaths.slice(0, PERMISSION_SET_NOTIFICATION_SKIPS_SHOWN);
            const hiddenCount = skippedFilePaths.length - shownFilePaths.length;
            this.showPermissionSetNotification(hub, 
                `Skipped ${skippedFilePaths.length} permission set ${skippedFilePaths.length === 1 ? 'file' : 'files'} that could not be read as a permission set with an api name: ${shownFilePaths.join(', ')}${hiddenCount > 0 ? ` and ${hiddenCount} more` : ''}.`,
                undefined,
                workspaceRoot
            );
        }

        if ( discovery.permissionSets.length === 0 ) {
            return refuse(`No permission set in this workspace's source grants access to any object of ${treeLabel}, so nothing was assigned.`);
        }

        const pickedPermissionSets = await this.promptForPermissionSets(discovery.permissionSets, objectApiNames.length);
        if ( !pickedPermissionSets ) {
            return {};
        }

        if ( pickedPermissionSets.length > PERMISSION_SET_MAX_PICKS ) {
            return refuse(`Nothing was assigned: ${pickedPermissionSets.length} permission sets were chosen, and at most ${PERMISSION_SET_MAX_PICKS} can be assigned at once.`);
        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`Nothing was assigned: ${hub.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return {};
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const describePermissionSets = (count: number) => `${count} ${count === 1 ? 'permission set' : 'permission sets'}`;

        const confirmation = await hub.confirmInPanel(
            `Assign ${describePermissionSets(pickedPermissionSets.length)} for ${hub.toSingleLine(treeLabel)} to ${hub.toSingleLine(orgDetail.username)} in ${hub.toSingleLine(orgLabel)}?`,
            {
                ...RecipeCockpitPermissionSetAssign.buildConfirmationContent(treeLabel, hub.buildConfirmOrg(orgDetail), pickedPermissionSets, objectApiNames.length),
                isDestructive: true,
                ...( changeOrg ? { changeOrg: changeOrg } : {} )
            },
            RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL ) {
            return {};
        }

        let connection: Connection;
        let querySource: IOrgQuerySource;
        let orgTypeDetail: IOrgTypeDetail | undefined;
        try {
            connection = await SalesforceOrgService.getConnection(orgDetail.username);
            querySource = SalesforceOrgService.toQuerySource(connection);
            orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        } catch (connectionError) {
            return refuse(`Nothing was assigned: could not connect to ${orgLabel}: ${hub.describeThrown(connectionError)}`);
        }

        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was assigned: ${orgLabel} ${orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}` : 'could not say whether it is a sandbox'}. Permission sets are assigned only in a sandbox or scratch org.`);
        }

        // ONLY AN ORG THAT ANSWERED IT IS A SANDBOX BECOMES THE SELECTION, WHATEVER FOLLOWS
        const confirmed: IRecipeCockpitPermissionSetClosingState = { orgDetail: orgDetail, isConfirmed: true };

        let orgPermissionSets: IOrgPermissionSet[];
        try {
            orgPermissionSets = await SalesforceOrgService.queryPermissionSets(querySource, pickedPermissionSets.map(permissionSet => permissionSet.name));
        } catch {
            return refuse(`Nothing was assigned: ${orgLabel} could not be asked which of the permission sets it holds. Try again.`, confirmed);
        }

        const { presentPermissionSets, missingPermissionSets } = RecipeCockpitPermissionSetAssign.partitionByOrgPresence(pickedPermissionSets, orgPermissionSets.map(orgPermissionSet => orgPermissionSet.name));

        if ( missingPermissionSets.length > 0 ) {
            this.showPermissionSetNotification(hub, 
                RecipeCockpitPermissionSetAssign.buildMissingPermissionSetsMessage(missingPermissionSets.map(permissionSet => permissionSet.name), orgLabel),
                undefined,
                workspaceRoot
            );
        }

        if ( presentPermissionSets.length === 0 ) {
            return confirmed;
        }

        // THE ASSIGNEE IS THE USER THE ORG IS AUTHORIZED AS, ASKED ON THE SAME CONNECTION, AND NO ONE ELSE
        let assigneeId: string;
        try {
            assigneeId = await SalesforceOrgService.queryUserId(querySource, orgDetail.username);
        } catch {
            return refuse(`Nothing was assigned: ${orgLabel} could not be asked which user it is authorized as. Try again.`, confirmed);
        }

        const permissionSetNames = presentPermissionSets.map(permissionSet => permissionSet.name);
        const permissionSetText = describePermissionSets(permissionSetNames.length);
        // EVERY OBJECT A PICK GRANTS ON, NOT ONLY THIS TREE'S: ANOTHER CARD'S DESCRIBE OF IT CHANGES TOO
        const lowerGrantedNames = new Set(presentPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames).map(objectApiName => objectApiName.toLowerCase()));
        const coveredObjectApiNames = [...new Set([
            ...objectApiNames,
            ...presentPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames).filter(objectApiName => SalesforceApiName.isApiName(objectApiName))
        ])].filter(objectApiName => lowerGrantedNames.has(objectApiName.toLowerCase()));
        const assignmentPlan = RecipeCockpitPermissionSetAssign.planAssignments(assigneeId, permissionSetNames, orgPermissionSets);

        onAssignStarted(orgDetail, coveredObjectApiNames);

        // THE HISTORY'S RECORD OF THIS ASSIGNMENT (#485), WRITTEN ONCE THE INSERT WAS SENT, WHATEVER IT ANSWERED
        const stepStartedAt = new Date();
        const assigningOrgDetail = orgDetail;
        let assignOutputFilePath: string | undefined;
        const recordStep = (outcome: RunHistoryOutcome, counts: Pick<IRunHistoryStepRecord, 'succeededCount' | 'failedCount' | 'detail'>) => RecipeCockpitTroubleshootingViews.recordTroubleshootingStep(runArtifactsLocation, {
            step: 'permission-set-assign',
            outcome: outcome,
            orgUsername: assigningOrgDetail.username,
            orgAlias: assigningOrgDetail.alias,
            startedAt: stepStartedAt,
            finishedAt: new Date(),
            ...counts,
            filePaths: [assignOutputFilePath]
        });

        const assignRun = await this.insertPermissionSetAssignments(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: assigning ${permissionSetText} to ${orgDetail.username}`),
            { sobject: objectApiName => ({ create: async (records, options) => await connection.sobject(objectApiName).create(records, options) }) },
            assignmentPlan
        );

        const assignOutcome: PermissionSetAssignOutcome = assignRun.failureMessage !== undefined
            ? { kind: 'unconfirmed', failureMessage: assignRun.failureMessage }
            : RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(assignmentPlan, assignRun.saveResults);

        assignOutputFilePath = runArtifactsLocation && ScratchOrgService.writeOrgOperationPayload(workspaceRoot, orgDetail.username, 'permission-set-assign', {
            assigneeUsername: orgDetail.username,
            assigneeId: assigneeId,
            permissionSets: assignmentPlan.sentNames.map((permissionSetName, recordIndex) => ({ name: permissionSetName, id: assignmentPlan.records[recordIndex].PermissionSetId })),
            ...( assignmentPlan.unresolvedNames.length > 0 ? { notSent: assignmentPlan.unresolvedNames.map((permissionSetName, nameIndex) => ({ name: permissionSetName, reason: assignmentPlan.unresolvedMessages[nameIndex] })) } : {} ),
            ...( assignRun.failureMessage !== undefined ? { failure: assignRun.failureMessage } : { saveResults: assignRun.saveResults } ),
            outcome: assignOutcome
        }, new Date(), runArtifactsLocation);

        switch ( assignOutcome.kind ) {

            case 'assigned': {
                const alreadyText = assignOutcome.alreadyAssignedNames.length > 0
                    ? ` ${assignOutcome.alreadyAssignedNames.join(', ')} ${assignOutcome.alreadyAssignedNames.length === 1 ? 'was' : 'were'} already assigned.`
                    : '';
                const assignedText = `Assigned ${permissionSetText} for ${treeLabel} to ${orgDetail.username} in ${orgLabel}.${alreadyText}`;
                recordStep('succeeded', { succeededCount: permissionSetNames.length, detail: `${permissionSetNames.join(', ')}.${alreadyText}` });
                if ( assignOutputFilePath && RecipeCockpitRunArtifacts.isRunFileExposedToGit(assignOutputFilePath) ) {
                    this.showPermissionSetNotification(hub, assignedText, assignOutputFilePath, workspaceRoot);
                } else {
                    VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(assignedText));
                }
                return { ...confirmed, isAssigned: true };
            }

            case 'unconfirmed':
                recordStep('unknown', { detail: assignOutcome.failureMessage });
                this.showPermissionSetNotification(hub, assignOutcome.failureMessage, assignOutputFilePath, workspaceRoot);
                return confirmed;

            case 'notAllAssigned': {
                const landedNames = [...assignOutcome.assignedNames, ...assignOutcome.alreadyAssignedNames];
                recordStep(landedNames.length > 0 ? 'partial' : 'failed', {
                    succeededCount: landedNames.length,
                    failedCount: assignOutcome.failedNames.length,
                    detail: `${assignOutcome.failedNames.join(', ')} could not be assigned: ${assignOutcome.failureMessages.join('; ')}`
                });
                this.showPermissionSetNotification(hub, [
                    `${assignOutcome.failedNames.join(', ')} could not be assigned to ${orgDetail.username} in ${orgLabel}: ${assignOutcome.failureMessages.join('; ')}`,
                    ...( landedNames.length > 0 ? [`Assigned: ${landedNames.join(', ')}.`] : [] )
                ].join(' '), assignOutputFilePath, workspaceRoot);
                return { ...confirmed, isAssigned: landedNames.length > 0 };
            }

        }

    }

    /*
        The one assignment insert (#500) behind a progress notification with no Cancel, raced with
        PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS. A request that throws or is not answered in time
        may still have been saved, so it is a failureMessage saying which landed is unknown, never
        "none assigned". The error's own text is not quoted: it can carry a session id.
    */
    private static async insertPermissionSetAssignments(progressTitle: string,
                                                        connection: IPermissionSetAssignmentConnection,
                                                        assignmentPlan: IPermissionSetAssignmentPlan): Promise<{ saveResults?: unknown; failureMessage?: string }> {

        if ( assignmentPlan.records.length === 0 ) {
            return { saveResults: [] };
        }

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: false
        }, async () => {

            let timeoutHandle: NodeJS.Timeout | undefined;
            const timedOut = new Promise<'timedOut'>(resolve => {
                timeoutHandle = setTimeout(() => resolve('timedOut'), PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS);
            });

            try {
                const answer = await Promise.race([RecipeCockpitPermissionSetAssign.insertAssignments(connection, assignmentPlan.records), timedOut]);
                return answer === 'timedOut'
                    ? { failureMessage: 'The assignment did not finish in time, so which permission sets were assigned is unknown.' }
                    : { saveResults: answer };
            } catch {
                return { failureMessage: 'The org did not answer the assignment, so which permission sets were assigned is unknown.' };
            } finally {
                clearTimeout(timeoutHandle);
            }

        });

    }

    /*
        Every outcome but a success is a WARNING, and its only follow-up is the notification's own
        "View output" button when the CLI left a result file. NOT AWAITED: the run ends, and gives the
        panel its button back, without waiting for the reader to dismiss it.
    */
    private static showPermissionSetNotification(hub: IRecipeCockpitHubForTroubleshootingTab, notificationText: string, outputFilePath: string | undefined, workspaceRoot: string) {

        const actions = outputFilePath ? [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL] : [];
        const notedText = hub.withRunArtifactsGitIgnoreNote('warning', notificationText, outputFilePath).notificationText;

        Promise.resolve(vscode.window.showWarningMessage(RecipeYamlScalar.escapeForNotification(notedText), ...actions))
            .then(chosenAction => chosenAction === RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL && outputFilePath
                ? this.openPermissionSetOutput(hub, outputFilePath, workspaceRoot)
                : undefined)
            .catch(() => undefined);

    }

    // THE PATH IS THE HOST'S OWN, AND STILL RE-CHECKED: THE FILE CAN HAVE BEEN REPLACED BY A LINK OUT OF THE WORKSPACE SINCE
    private static async openPermissionSetOutput(hub: IRecipeCockpitHubForTroubleshootingTab, outputFilePath: string, workspaceRoot: string) {

        if ( !hub.isUsableWorkspacePath(outputFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage('The permission set result file no longer exists in this workspace.');
            return;
        }

        await VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }
}
