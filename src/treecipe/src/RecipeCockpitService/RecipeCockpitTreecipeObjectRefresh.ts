import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { IRecipeCockpitHubForTreecipeTab } from './RecipeCockpitTreecipeHost';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeTab
import type {
    IRecipeCockpitObjectRefreshSession,
    IRecipeCockpitObjectRefreshStateMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitTreeViewModel,
    RecipeCockpitObjectRefreshStep,
    RecipeCockpitPanelAction
} from './RecipeCockpitService';
import {
    IObjectRefreshComparisonRequest,
    IObjectRefreshItem,
    IObjectRefreshPlannedItem,
    OBJECT_REFRESH_KINDS,
    OBJECT_REFRESH_KIND_LABELS,
    OBJECT_REFRESH_OPERATION_NAME,
    RecipeCockpitObjectRefresh
} from './RecipeCockpitObjectRefresh';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RecipeCockpitPermissionSetGenerate } from './RecipeCockpitPermissionSetGenerate';
import { RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE } from './RecipeCockpitTroubleshootingConstants';
import {
    IMetadataDeployComponent,
    RecipeCockpitMetadataDeploy
} from './RecipeCockpitMetadataDeploy';
import { RecipeCockpitOrgChangeDetection } from './RecipeCockpitOrgChangeDetection';
import { RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME } from '../RunArtifacts/RecipeCockpitRunArtifacts';
import { RecipeService } from '../RecipeService/RecipeService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RecipeCockpitTreecipeRecipeEdits } from './RecipeCockpitTreecipeRecipeEdits';

/*
    "Get latest object detail from target org" (#612, moved out of the hub by #688): one object
    retrieved from the org, compared kind by kind, then the ticked items applied to the project and
    the recipe. The open dialog's session stays on the hub's panel state, which a reload discards;
    the retrieve runner and the staged-field reads it shares with the Treecipe Adapter stay in the
    hub too.
*/

export const RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL = 'Apply to project and recipe';
export const RECIPE_COCKPIT_OBJECT_REFRESH_ORG_PLACEHOLDER = 'Choose the org to get the latest object detail from';
export const RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL = 'Nothing was retrieved: an insert, a Treecipe Adapter run, a metadata deploy, a retrieve, a recipe write or a generation is running. Try again when it ends.';
export const RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL = 'Nothing was applied: an insert, a Treecipe Adapter run, a metadata deploy, a retrieve, a recipe write or a generation is running. Try again when it ends.';
export const RECIPE_COCKPIT_OBJECT_REFRESH_CHANGED_REFUSAL = 'Nothing was applied: the retrieved files, the project or the recipe changed since the review, so what it listed is no longer what would be written. Get the latest object detail again.';

export class RecipeCockpitTreecipeObjectRefresh {

    /*
        "Get latest object detail from target org" (#612). The dialog is the host's: each step is a
        state it posts, and the panel answers only under the dialog's id. Step 1 starts on the
        Target Org Manager selection, which the dialog's own org picker changes.
    */
    static openObjectRefresh(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                     panelState: IRecipeCockpitPanelState,
                                     openAction: Extract<RecipeCockpitPanelAction, { kind: 'openObjectRefresh' }>) {

        hub.discardObjectRefreshStaging(panelState);

        const stateMessage: IRecipeCockpitObjectRefreshStateMessage = {
            command: 'objectRefreshState',
            refreshId: crypto.randomUUID(),
            renderSequence: openAction.renderSequence,
            treeKey: openAction.treeKey,
            objectApiName: openAction.objectApiName,
            ...( openAction.nickname !== undefined ? { nickname: openAction.nickname } : {} ),
            step: 'choose',
            kinds: [...OBJECT_REFRESH_KINDS]
        };

        panelState.objectRefreshSession = { stateMessage: stateMessage, cancellation: { isRequested: false } };
        hub.postToPanel(cockpitPanel, stateMessage);

    }

    // THE OPEN DIALOG AT THE STEP GIVEN, FOR THE MODEL ON SCREEN, WHEN THE PANEL NAMED IT BY ITS ID
    static findOpenObjectRefreshSession(panelState: IRecipeCockpitPanelState, refreshId: unknown, step: RecipeCockpitObjectRefreshStep): IRecipeCockpitObjectRefreshSession | undefined {

        const session = panelState.objectRefreshSession;

        return session
                && typeof refreshId === 'string'
                && refreshId === session.stateMessage.refreshId
                && session.stateMessage.step === step
                && session.stateMessage.renderSequence === panelState.recipeDataMessage?.renderSequence
            ? session
            : undefined;

    }

    // WHAT HOLDS A RETRIEVE OR AN APPLY BACK: ANYTHING ELSE THAT HOLDS THE ORG SELECTION, OR READS OR WRITES THE PROJECT'S METADATA OR RECIPE
    static findObjectRefreshBusyRefusal(hub: IRecipeCockpitHubForTreecipeTab, panelState: IRecipeCockpitPanelState, refusalText: string): string | undefined {

        const isBusy = !!panelState.insertStateMessage
            || panelState.updaterLoadStateMessage?.isRunning === true
            || panelState.scratchOrgStateMessage?.isRunning === true
            || panelState.permissionSetAssignStateMessage?.isRunning === true
            || hub.isSelectionHeldByPromptOrUpdater(panelState)
            || hub.isApplyHeldByAnotherRun(panelState);

        return isBusy ? refusalText : undefined;

    }

    private static postObjectRefreshState(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, session: IRecipeCockpitObjectRefreshSession, stateChange: Partial<IRecipeCockpitObjectRefreshStateMessage>) {

        const { tickedItemIndexes: _previousTicks, ...previousState } = session.stateMessage;
        session.stateMessage = { ...previousState, ...stateChange };
        hub.postToPanel(cockpitPanel, session.stateMessage);

    }

    private static closeObjectRefresh(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, session: IRecipeCockpitObjectRefreshSession, isStagingKept: boolean) {

        if ( !isStagingKept ) {
            hub.discardObjectRefreshStaging(panelState);
        }
        this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'closed' });
        if ( panelState.objectRefreshSession === session ) {
            panelState.objectRefreshSession = undefined;
        }

    }

    static cancelObjectRefresh(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState) {

        const session = panelState.objectRefreshSession;
        if ( !session ) {
            return;
        }

        // A RETRIEVE ENDS ITSELF ONCE CANCELLED, AND CLOSES THE DIALOG ONCE IT HAS
        if ( session.stateMessage.step === 'retrieving' ) {
            session.cancellation.isRequested = true;
            session.cancellation.onRequested?.();
            return;
        }

        this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);

    }

    static async startObjectRefresh(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            startAction: Extract<RecipeCockpitPanelAction, { kind: 'startObjectRefresh' }>) {

        const session = panelState.objectRefreshSession as IRecipeCockpitObjectRefreshSession;
        const { treeKey, objectApiName, nickname } = session.stateMessage;
        const workspaceRoot = panelState.workspaceRoot;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const tree = clickedRecipeDataMessage.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage
                                            && panelState.objectRefreshSession === session;
        const warn = (warningText: string) => VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(warningText));
        const objectLabel = hub.describeOccurrence(objectApiName, nickname);

        this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'retrieving', kinds: startAction.kinds });

        let packageDirectoryPaths: string[];
        let defaultPackageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            defaultPackageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            warn(`Nothing was retrieved for ${objectLabel}: ${hub.describeThrown(projectError)}`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        const orgDetail = await hub.resolveSelectedReadOrg(cockpitPanel, panelState, 'Nothing was retrieved', RECIPE_COCKPIT_OBJECT_REFRESH_ORG_PLACEHOLDER,
            RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL, RECIPE_COCKPIT_RETRIEVE_CONNECTION_FAILED_ADVICE, 'isOrgPromptOpen');

        if ( !orgDetail || !isClickStillCurrent() || session.cancellation.isRequested || !tree ) {
            if ( isClickStillCurrent() && !session.cancellation.isRequested ) {
                this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'choose' });
            } else {
                this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            }
            return;
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        this.postObjectRefreshState(hub, cockpitPanel, session, { orgLabel: orgLabel });

        const valueSetNames = await RecipeCockpitObjectRefresh.listObjectValueSetNames(workspaceRoot, packageDirectoryPaths, objectApiName);
        const runArtifactsLocation = hub.resolveTreeRunArtifactsLocation(workspaceRoot, clickedRecipeDataMessage.recipe, tree);
        let components: IMetadataDeployComponent[];
        let retrieveArguments: string[];
        try {
            components = RecipeCockpitObjectRefresh.buildRetrieveComponents(objectApiName, startAction.kinds, valueSetNames);
            const plannedStagingFolderPath = runArtifactsLocation ? RecipeCockpitOrgChangeDetection.buildStagingFolderPath(runArtifactsLocation, orgDetail.username, new Date(), OBJECT_REFRESH_OPERATION_NAME) : undefined;
            session.stagingFolderPath = runArtifactsLocation && plannedStagingFolderPath ? RecipeCockpitOrgChangeDetection.makeStagingFolder(runArtifactsLocation, plannedStagingFolderPath) : undefined;
            const writtenPackageXmlFilePath = runArtifactsLocation && session.stagingFolderPath
                ? RecipeCockpitMetadataDeploy.writePackageXml(runArtifactsLocation, RecipeCockpitOrgChangeDetection.buildPackageXmlFilePath(session.stagingFolderPath), RecipeCockpitObjectRefresh.buildPackageXml(components, hub.readSourceApiVersion(workspaceRoot)))
                : undefined;
            session.packageXmlFilePath = writtenPackageXmlFilePath;
            if ( !session.stagingFolderPath || !writtenPackageXmlFilePath ) {
                warn(`Nothing was retrieved for ${objectLabel}: the staging folder could not be made under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME} folder in this workspace.`);
                this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
                return;
            }
            retrieveArguments = RecipeCockpitOrgChangeDetection.buildRetrieveArguments(
                RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, writtenPackageXmlFilePath),
                RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument(workspaceRoot, session.stagingFolderPath),
                orgDetail.username
            );
        } catch (argumentError) {
            warn(`Nothing was retrieved for ${objectLabel}: ${hub.describeThrown(argumentError)}`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        const retrieveRun = await hub.runCancellableRetrieve(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: getting the latest detail of ${objectLabel} from ${orgLabel}`),
            retrieveArguments,
            workspaceRoot,
            { orgUsername: orgDetail.username, components: components, destination: { kind: 'staging', stagingFolderPath: session.stagingFolderPath } },
            session.cancellation
        );

        if ( retrieveRun.isCancelled || session.cancellation.isRequested ) {
            warn(`Getting the latest detail of ${objectLabel} from ${orgLabel} was cancelled. Nothing in the project or the recipe changed.`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        const retrieveRead = RecipeCockpitOrgChangeDetection.readRetrieveSucceeded(retrieveRun.invocation, retrieveRun.payload);
        if ( 'failureMessage' in retrieveRead ) {
            warn(`The latest detail of ${objectLabel} could not be retrieved from ${orgLabel}: ${retrieveRead.failureMessage}`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        if ( !isClickStillCurrent() ) {
            warn(`The latest detail of ${objectLabel} was retrieved, but the run on screen changed meanwhile, so nothing was listed. Get it again.`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        session.comparisonRequest = {
            workspaceRoot: workspaceRoot,
            packageDirectoryPaths: packageDirectoryPaths,
            defaultPackageDirectoryPath: defaultPackageDirectoryPath,
            stagingFolderPath: session.stagingFolderPath,
            objectApiName: objectApiName,
            kinds: startAction.kinds,
            valueSetNames: valueSetNames,
            recipeContext: this.readObjectRefreshRecipeContext(hub, panelState, tree, objectApiName, nickname)
        };
        const comparison = await RecipeCockpitObjectRefresh.compareStagedObject(session.comparisonRequest);

        // A CANCEL CAN ARRIVE WHILE THE FILES ARE COMPARED, AFTER THE RETRIEVE HAS ENDED
        if ( session.cancellation.isRequested ) {
            warn(`Getting the latest detail of ${objectLabel} from ${orgLabel} was cancelled. Nothing in the project or the recipe changed.`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        if ( !isClickStillCurrent() ) {
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        if ( !comparison.isRetrieved ) {
            warn(`${orgLabel} returned nothing for ${objectLabel}, so nothing was listed. Check that the object exists in that org.`);
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, false);
            return;
        }

        session.plannedItems = comparison.items;
        this.postObjectRefreshState(hub, cockpitPanel, session, {
            step: 'review',
            groups: startAction.kinds.map(kind => ({
                kind: kind,
                label: OBJECT_REFRESH_KIND_LABELS[kind],
                unchangedCount: comparison.unchangedCountByKind[kind],
                unreadableCount: comparison.unreadableCountByKind[kind],
                items: comparison.items.filter(item => item.kind === kind).map(item => this.toPostedObjectRefreshItem(item))
            }))
        });

    }

    // AN ITEM AS THE PANEL SEES IT: NEVER ITS FILES OR THE LINES IT WRITES
    private static toPostedObjectRefreshItem(item: IObjectRefreshPlannedItem): IObjectRefreshItem {
        return { kind: item.kind, name: item.name, status: item.status, detail: item.detail, differences: [...item.differences], recipeNote: item.recipeNote };
    }

    // THE CARD'S RECIPE FILE AS IT IS NOW, ITS BACKEND, AND WHAT THE OCCURRENCE PINS OR SWITCHES OFF
    private static readObjectRefreshRecipeContext(hub: IRecipeCockpitHubForTreecipeTab, panelState: IRecipeCockpitPanelState, tree: IRecipeCockpitTreeViewModel, objectApiName: string, nickname: string | undefined): IObjectRefreshComparisonRequest['recipeContext'] {

        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
        const recipeText = recipeFilePath && hub.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ? fs.readFileSync(recipeFilePath, 'utf-8') : undefined;
        const fakerService = recipeText === undefined ? undefined : hub.readTreeFakerService(panelState, tree.treeKey);
        const isOccurrence = (reference: { objectApiName: string; nickname?: string }) => reference.objectApiName === objectApiName && reference.nickname === nickname;

        return {
            recipeText: recipeText,
            expressionSource: fakerService === undefined ? undefined : new RecipeService(fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService()),
            // SET ONLY FOR AN OCCURRENCE OF AN OBJECT WITH iterations; AN OBJECT WRITTEN ONCE IS ITS FIRST OCCURRENCE
            ...( nickname !== undefined ? { objectNickname: nickname } : {} ),
            pinnedFieldApiNames: new Set(( tree.fixedValues ?? [] ).filter(isOccurrence).map(fixedValue => fixedValue.fieldApiName)),
            validationRulesOffFieldApiNames: new Set(( tree.validationRulesOff ?? [] ).filter(isOccurrence).map(fieldReference => fieldReference.fieldApiName))
        };

    }

    /*
        Apply: the ticked items asked once in the panel (the dialog steps aside), then planned again
        from the files and the recipe as they are NOW and refused if any ticked item would write
        anything but what the review showed. The project's files are copied first, then only those
        items' recipe lines are written; one notification says what landed.
    */
    static async applyObjectRefresh(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            applyAction: Extract<RecipeCockpitPanelAction, { kind: 'applyObjectRefresh' }>) {

        const session = panelState.objectRefreshSession as IRecipeCockpitObjectRefreshSession;
        const { treeKey, objectApiName, nickname, orgLabel } = session.stateMessage;
        const reviewedItems = applyAction.itemIndexes.map(itemIndex => ( session.plannedItems as IObjectRefreshPlannedItem[] )[itemIndex]);
        const objectLabel = hub.describeOccurrence(objectApiName, nickname);
        const backToReview = () => this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'review', tickedItemIndexes: [...applyAction.itemIndexes] });
        const recipeLineCount = reviewedItems.reduce((lineCount, item) => lineCount + item.recipeChanges.length, 0);

        this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'confirming' });

        const confirmation = await hub.confirmInPanel(
            `Apply ${reviewedItems.length} ${reviewedItems.length === 1 ? 'item' : 'items'} from ${orgLabel ?? 'the org'} to ${objectLabel}?`,
            {
                summary: [`This copies ${reviewedItems.length} retrieved ${reviewedItems.length === 1 ? 'file' : 'files'} into the project, then writes ${recipeLineCount} ${recipeLineCount === 1 ? 'line' : 'lines'} of the recipe. Every other file, and every other line of the recipe, is left as it is.`],
                sections: OBJECT_REFRESH_KINDS
                    .map(kind => ({ kind: kind, items: reviewedItems.filter(item => item.kind === kind) }))
                    .filter(kindItems => kindItems.items.length > 0)
                    .map(kindItems => ({
                        title: OBJECT_REFRESH_KIND_LABELS[kindItems.kind],
                        count: kindItems.items.length,
                        lines: kindItems.items.map(item => `${item.name} (${item.status}): ${item.recipeNote}`)
                    }))
            },
            RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL
        );

        if ( panelState.objectRefreshSession !== session ) {
            return;
        }

        if ( confirmation !== RECIPE_COCKPIT_OBJECT_REFRESH_CONFIRM_LABEL ) {
            backToReview();
            return;
        }

        const busyRefusal = this.findObjectRefreshBusyRefusal(hub, panelState, RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL);
        const comparisonRequest = session.comparisonRequest as IObjectRefreshComparisonRequest;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        if ( busyRefusal || !tree ) {
            VSCodeWorkspaceService.showWarningMessage(busyRefusal ?? RECIPE_COCKPIT_OBJECT_REFRESH_CHANGED_REFUSAL);
            backToReview();
            return;
        }

        // PLANNED AGAIN AFTER THE CONFIRMATION: EVERY FILE AND THE RECIPE CAN HAVE CHANGED WHILE IT WAS OPEN
        const replanned = await RecipeCockpitObjectRefresh.compareStagedObject({ ...comparisonRequest, recipeContext: this.readObjectRefreshRecipeContext(hub, panelState, tree, objectApiName, nickname) });
        const describeItem = (item: IObjectRefreshPlannedItem) => JSON.stringify([item.kind, item.name, item.status, item.differences, item.recipeChanges, item.fileCopy]);
        const replannedByDescription = new Map(replanned.items.map(item => [describeItem(item), item] as const));
        const confirmedItems = reviewedItems.map(item => replannedByDescription.get(describeItem(item)));
        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);

        if ( confirmedItems.some(item => item === undefined) || panelState.objectRefreshSession !== session ) {
            VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_OBJECT_REFRESH_CHANGED_REFUSAL);
            backToReview();
            return;
        }

        this.postObjectRefreshState(hub, cockpitPanel, session, { step: 'applying' });

        let copyOutcome = { copiedCount: 0, failures: [] as string[] };
        let recipeOutcome: { writtenLineCount: number; refusals: string[] } = { writtenLineCount: 0, refusals: [] };
        try {
            await RecipeCockpitTreecipeRecipeEdits.runRecipeLookupWrite(hub, cockpitPanel, panelState, treeKey, async () => {
                // AN ITEM WHOSE FILE DID NOT LAND WRITES NO RECIPE LINE, SO THE RECIPE NEVER NAMES WHAT THE PROJECT LACKS
                const copiedItems = ( confirmedItems as IObjectRefreshPlannedItem[] ).filter(item => {
                    const itemCopy = RecipeCockpitOrgChangeDetection.copyMetadataFiles(panelState.workspaceRoot, [item.fileCopy]);
                    copyOutcome = { copiedCount: copyOutcome.copiedCount + itemCopy.copiedCount, failures: [...copyOutcome.failures, ...itemCopy.failures] };
                    return itemCopy.copiedCount === 1;
                });
                const recipeItems = copiedItems.filter(item => item.recipeChanges.length > 0);
                if ( recipeItems.length > 0 && recipeFilePath && hub.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
                    const recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
                    const applied = RecipeCockpitObjectRefresh.applyRecipeChanges(recipeText, objectApiName, comparisonRequest.recipeContext.objectNickname, recipeItems);
                    recipeOutcome = applied;
                    if ( applied.recipeText !== recipeText ) {
                        fs.writeFileSync(recipeFilePath, applied.recipeText);
                    }
                }
                return copyOutcome.copiedCount > 0 || recipeOutcome.writtenLineCount > 0;
            });
        } finally {
            this.closeObjectRefresh(hub, cockpitPanel, panelState, session, true);
        }

        const needsNewRunForRecordType = ( confirmedItems as IObjectRefreshPlannedItem[] ).some(item => item.needsNewRunForRecordType);
        const failures = [...copyOutcome.failures, ...recipeOutcome.refusals];
        const outcomeText = [
            `${objectLabel}: copied ${copyOutcome.copiedCount} ${copyOutcome.copiedCount === 1 ? 'file' : 'files'} from ${orgLabel ?? 'the org'} into the project and wrote ${recipeOutcome.writtenLineCount} recipe ${recipeOutcome.writtenLineCount === 1 ? 'line' : 'lines'}.`,
            ...( failures.length > 0 ? [`Not written: ${failures.join('; ')}.`] : [] ),
            ...( needsNewRunForRecordType ? ['A record type changed: run Generate Treecipe to write a new run with its section.'] : [] )
        ].join(' ');
        const escapedOutcomeText = RecipeYamlScalar.escapeForNotification(outcomeText);

        if ( failures.length > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(escapedOutcomeText);
        } else {
            VSCodeWorkspaceService.showInformationMessage(escapedOutcomeText);
        }

    }

}
