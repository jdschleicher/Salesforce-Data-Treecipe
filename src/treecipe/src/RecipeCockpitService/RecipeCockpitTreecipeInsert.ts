import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IRecipeCockpitHubForTreecipeOrgTab } from './RecipeCockpitTreecipeOrgHost';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeOrgTab
import type {
    ICheckedRecordIdLookup,
    IRecipeCockpitConfirmOptions,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitOrgRecordLookupViewModel,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitRunFakerFilteredRecipe,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitTypedLookupId,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import { RecipeCockpitDatasetsHost } from './RecipeCockpitDatasetsHost';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import {
    DerivedTreeRecipeBuild,
    IDroppedRecordTypeTick,
    IRecordTypeGenerationPlan,
    IRecordTypeTickObject,
    RECORD_TYPE_RECIPE_FOLDED_PROGRESS_MESSAGE,
    RecipeCockpitRecordTypeRecipe,
    RecordTypeSetMode
} from './RecipeCockpitRecordTypeRecipe';
import {
    IRecordTypeSet,
    RecipeCockpitRecordTypeSets
} from './RecipeCockpitRecordTypeSets';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import {
    IOrgQuerySource,
    IOrgTypeDetail,
    IScratchOrgDetail,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import { RecipeCockpitRecipeWriter } from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    CollectionsApiService,
    DataSetRecordPreparer
} from '../CollectionsApiService/CollectionsApiService';
import { RECIPE_COCKPIT_INSERT_ACTION_LABEL } from './RecipeCockpitDataOrgConstants';
import { RunFakerConfirmation } from '../RunFakerConfirmation/RunFakerConfirmation';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import {
    ICreateObjectDescribe,
    RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD,
    RecipeCockpitRecordCreation
} from './RecipeCockpitRecordCreation';
import { RecipeCockpitFixedValueStore } from './RecipeCockpitFixedValueStore';
import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import { RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON } from './RecipeCockpitFieldRowsConstants';
import { RecipeCockpitDrawnModel } from './RecipeCockpitDrawnModel';

/*
    A tree card's "Generate fake data and insert" (moved out of the hub by #669 part a): the insert
    into the selected org or the one asked for, its confirmation and what it leaves out, the
    generate, the record preparer, and the org-record lookups checked before anything is inserted.
    It loads RecipeCockpitTreecipeDataOrgs for the org and the notification, and
    RecipeCockpitDatasetsHost to add a landed insert's data set in place (#226).
*/

// THE INSERT CONFIRMATION'S SECTION OF WHAT THE CARD LEAVES OUT, ONE OBJECT AT A TIME (#483)
export const RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE = 'Left out, per object';

// A TREE CARD'S GENERATE BUTTON HANDS ITS RECIPE FILE TO THIS COMMAND, WHICH KEEPS ITS CONFIRMATION AND BACKEND CHECK
export const RECIPE_COCKPIT_RUN_FAKER_COMMAND = 'treecipe.runFakerByRecipe';
export const RECIPE_COCKPIT_INSERT_RECORD_TYPES_SECTION_TITLE = 'Record types, one block each';

export const RECIPE_COCKPIT_INSERT_CONFIRM_LABEL = 'Generate and insert';

export const RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER = 'Select the sandbox or scratch org to generate this tree into';


const TREE_NOT_BUILT_REFUSAL_REASON = 'the object metadata no longer builds this tree, so its recipe could not be built for the ticked record types. Run "Generate Treecipe" again, then tick the record types.';

export class RecipeCockpitTreecipeInsert {

    /*
        "Generate fake data and insert into <org>" (#255): the tree generated exactly as Run Faker by Recipe
        generates it -- the card's selection and counts, the same data set folder, datasetSource.json
        and filtered copy -- then inserted, parents first, through the one insert every command uses
        (CollectionsApiService.insertDataSetFolderIntoOrg): the same all-or-none choice, the same
        InsertAttempts results file, and the same rollback on Cancel or an all-or-none failure.

        Once a data set folder was made, an insert that finished on the model it was clicked on posts
        only its card's result and the new data set (#226), so the org selection and every other card
        stay on screen. One that threw, or whose run changed meanwhile, or whose data
        set the host cannot place, reloads the run onto the card's Treecipe tab, as before. The state
        message is posted last, because the panel disabled the card's button on the click.
    */
    static async insertTreeIntoOrg(hub: IRecipeCockpitHubForTreecipeOrgTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            insertAction: Extract<RecipeCockpitPanelAction, { kind: 'insertTree' }>) {

        const { treeKey } = insertAction;
        const isPanelStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState;

        panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: treeKey };
        hub.postToPanel(cockpitPanel, panelState.insertStateMessage);

        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        let isDatasetWritten = false;
        // ONE PER DATA SET WRITTEN, IN ORDER: "A data set for each record type" (#624) WRITES SEVERAL
        const insertedDatasetFolderPaths: string[] = [];
        let isInsertFinished = false;
        let hasInsertFailed = false;
        let insertError: unknown;

        try {

            isDatasetWritten = await this.performTreeInsert(hub, cockpitPanel, panelState, insertAction, datasetFolderPath => {
                isDatasetWritten = true;
                insertedDatasetFolderPaths.push(datasetFolderPath);
            }, () => { isInsertFinished = true; });

        } catch (thrownError) {

            hasInsertFailed = true;
            insertError = thrownError;

        } finally {

            panelState.insertStateMessage = undefined;

            if ( isDatasetWritten && isPanelStillCurrent() && panelState.recipeDataMessage ) {

                // ONLY AN INSERT THAT REACHED THE END ADDS ITS DATA SET IN PLACE; ONE THAT THREW RELOADS
                const isAddedInPlace = isInsertFinished
                                        && panelState.recipeDataMessage === clickedRecipeDataMessage
                                        && insertedDatasetFolderPaths.every(datasetFolderPath =>
                                            RecipeCockpitDatasetsHost.postAddedDataset(hub, cockpitPanel, panelState, clickedRecipeDataMessage, datasetFolderPath));

                if ( !isAddedInPlace ) {
                    await hub.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelState.recipeDataMessage.recipe.selectedRunFolderName, { treeKey: treeKey, tab: 'treecipe' });
                }

            }

            if ( isPanelStillCurrent() ) {
                hub.postToPanel(cockpitPanel, { command: 'insertState', isRunning: false, treeKey: treeKey });
            }

        }

        if ( hasInsertFailed ) {
            throw insertError;
        }

    }

    /*
        "Generate fake data and insert" with no org chosen yet (#375). The org is asked for in the
        command palette over the same listing the Target Org Manager dropdown draws (sandbox,
        scratch and the CLI's default only), then put in the dropdown and checked exactly as a pick
        there is -- connection, Organization row, describes -- and remembered. Only an org that
        answered it is a sandbox goes on to the insert, through the router like a click, so every
        guard of a click holds; the insert re-checks readiness and the Organization row as always.
        The insert's state holds the window while the reader chooses, and is given back on every
        way out, because the panel disabled the button on the click.
    */
    static async insertTreeIntoPromptedOrg(hub: IRecipeCockpitHubForTreecipeOrgTab, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    promptAction: Extract<RecipeCockpitPanelAction, { kind: 'promptInsertOrg' }>) {

        const { treeKey } = promptAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const isClickStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel
                                            && hub.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;
        const giveButtonBack = () => isClickStillCurrent() && hub.postToPanel(cockpitPanel, { command: 'insertState', isRunning: false, treeKey: treeKey });

        panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: treeKey };
        hub.postToPanel(cockpitPanel, panelState.insertStateMessage);

        // THE INSERT'S STATE HOLDS THE WINDOW UNTIL THE PICK HAS BEEN CHECKED, SO NO RUN THAT CHANGES THE SELECTION STARTS MEANWHILE AND A REVEAL REPLAYS IT
        try {

            let isSandboxSelected = false;

            try {
                isSandboxSelected = await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(hub, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                    RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER, 'Nothing was generated or inserted', 'the Treecipe tab inserts only into a sandbox or scratch org');
            } catch (promptError) {
                // THE PANEL DISABLED THE BUTTON ON THE CLICK, SO A LISTING OR A CHECK THAT THREW STILL GIVES IT BACK
                giveButtonBack();
                throw promptError;
            }

            if ( !isSandboxSelected ) {
                giveButtonBack();
                return;
            }

        } finally {
            // RELEASED ONLY HERE: THE ROUTER BELOW ANSWERS ANY INSERT STILL IN FLIGHT WITH ITS STATE INSTEAD OF ROUTING IT
            panelState.insertStateMessage = undefined;
        }

        const routedInsert = hub.routePanelMessage(this.buildInsertTreeMessage(promptAction), panelState);
        if ( routedInsert?.kind !== 'insertTree' ) {
            giveButtonBack();
            return;
        }

        await this.insertTreeIntoOrg(hub, cockpitPanel, panelState, routedInsert);

    }

    // THE MESSAGE THAT STARTS THIS INSERT AGAIN -- AFTER THE ORG WAS ASKED FOR, OR "Change org…" -- WITH THE RECORD TYPES TICKED AT THE CLICK (#623), ROUTED AND MATCHED AGAIN
    private static buildInsertTreeMessage(insertAction: { treeKey: string; recordTypeSelection?: Record<string, string[]>; isRemembered?: true }): IRecipeCockpitPanelMessage {

        return {
            command: 'insertTree',
            treeKey: insertAction.treeKey,
            ...( insertAction.recordTypeSelection ? { recordTypeSelection: insertAction.recordTypeSelection } : {} ),
            ...( insertAction.isRemembered ? { isRemembered: true } : {} )
        };

    }

    // WHAT THE RECORD TYPE PLAN (#623) READS OF EACH LISTED OBJECT WITH RECORD TYPES: ITS DEFAULT, AND WHAT THE RUN'S RECIPE WRITES
    static listRecordTypeTickObjects(hub: IRecipeCockpitHubForTreecipeOrgTab, recipeViewModel: IRecipeCockpitRecipeViewModel, objectApiNames: readonly string[]): IRecordTypeTickObject[] {

        const objectsByApiName = hub.buildObjectsByApiName(recipeViewModel);

        return [...new Set(objectApiNames)]
            .map(objectApiName => objectsByApiName.get(objectApiName))
            .filter((objectViewModel): objectViewModel is IRecipeCockpitObjectViewModel => !!objectViewModel?.recordTypes?.length)
            .map(objectViewModel => {
                const generatedDeveloperNames = objectViewModel.generatedRecordTypeDeveloperNames ?? [];
                const firstActiveRecordType = objectViewModel.recordTypes.find(recordType => recordType.isActive) ?? objectViewModel.recordTypes[0];
                return {
                    objectApiName: objectViewModel.objectApiName,
                    // A RUN GENERATED WITH NO CHOICE WRITES THE DEFAULT ITSELF
                    defaultDeveloperName: objectViewModel.isRecordTypeSelectionApplied !== true && generatedDeveloperNames.length === 1
                        ? generatedDeveloperNames[0]
                        : firstActiveRecordType.developerName,
                    generatedDeveloperNames: generatedDeveloperNames
                };
            });

    }

    // THE NICKNAME OF THE FIRST BLOCK OF EACH OBJECT THE RUN'S RECIPE WRITES MORE THAN ONCE (#467): WHAT ITS FIRST BLOCK'S SETTINGS ARE STORED UNDER
    static listRunFirstNicknamesByObject(hub: IRecipeCockpitHubForTreecipeOrgTab, recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): Map<string, string> {

        const objectsByApiName = hub.buildObjectsByApiName(recipeViewModel);
        const runFirstNicknameByObject = new Map<string, string>();

        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => {
                const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
                const firstNickname = objectViewModel ? hub.readOccurrenceNickname(objectViewModel) : undefined;
                if ( firstNickname !== undefined ) {
                    runFirstNicknameByObject.set(treeObject.objectApiName, firstNickname);
                }
            });

        return runFirstNicknameByObject;

    }

    // TRUE WHEN A DATA SET FOLDER WAS MADE; onDatasetFolderMade SAYS SO EVEN WHEN A LATER STEP THROWS
    private static async performTreeInsert(hub: IRecipeCockpitHubForTreecipeOrgTab, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            insertAction: Extract<RecipeCockpitPanelAction, { kind: 'insertTree' }>,
                                            onDatasetFolderMade: (datasetFolderPath: string) => void,
                                            onInsertFinished: () => void): Promise<boolean> {

        const { treeKey, recipeFilePath } = insertAction;
        const dataOrgSelection = panelState.dataOrgSelection;
        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const orgDetail = dataOrgSelection?.orgDetail;
        const refuse = (refusalMessage: string) => { VSCodeWorkspaceService.showWarningMessage(refusalMessage); return false; };

        if ( !dataOrgSelection || !orgDetail || !recipeDataMessage || !tree ) {
            return refuse('Choose an org in the Treecipe tab before inserting a tree.');
        }

        // EACH NAME ESCAPED ON ITS OWN, SO THE PARENTHESES AROUND THE USERNAME STAY READABLE
        const orgLabel = orgDetail.alias
            ? `${RecipeYamlScalar.escapeForNotification(orgDetail.alias)} (${RecipeYamlScalar.escapeForNotification(orgDetail.username)})`
            : RecipeYamlScalar.escapeForNotification(orgDetail.username);
        const treeLabel = RecipeYamlScalar.escapeForNotification(tree.customName ?? tree.title);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));

        if ( !hub.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
            return refuse(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so ${treeLabel} was not inserted.`);
        }

        const generatedRecipesFolderPath = path.join(panelState.workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const recipeFakerService = VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath);
        const selectedFakerService = ConfigurationService.getSelectedDataFakerServiceConfig() === 'faker-js' ? 'faker-js' : 'snowfakery';

        if ( recipeFakerService !== selectedFakerService ) {
            return refuse(recipeFakerService
                ? `This recipe was generated for ${recipeFakerService} — switch with "Select Faker Implementation".`
                : `"${recipeFileLabel}" has a file name and folder that disagree on which faker implementation generated it, so nothing was inserted.`);
        }

        /*
            The record types ticked at the click (#623). When they ask for anything the run's recipe
            does not already write, the tree's recipe is built again in memory for them and the
            card's settings are applied to that; no Generate Treecipe run is written. Otherwise the
            run's recipe is generated from, exactly as before.
        */
        let recordTypePlan = RecipeCockpitRecordTypeRecipe.planGeneration(
            this.listRecordTypeTickObjects(hub, recipeDataMessage.recipe, tree.objects.map(treeObject => treeObject.objectApiName)),
            insertAction.recordTypeSelection
        );
        let recordTypeWarnings: string[] = [];
        let filteredRecipe: IRecipeCockpitRunFakerFilteredRecipe | undefined;

        if ( !recordTypePlan.isRecipeDerived ) {
            // READ AT THE CLICK FROM THE MODEL ON SCREEN, WHICH IS WHAT THE CARD SHOWS; A COPY THAT DOES NOT READ BACK IS NEVER REPLACED BY THE WHOLE TREE
            const filteredRecipeResult = hub.resolveRunFakerFilteredRecipe(panelState, treeKey, recipeFilePath, 'Nothing was generated or inserted for');
            if ( filteredRecipeResult && 'refusalMessage' in filteredRecipeResult ) {
                return refuse(filteredRecipeResult.refusalMessage);
            }
            filteredRecipe = filteredRecipeResult as IRecipeCockpitRunFakerFilteredRecipe | undefined;
        }

        const insertObjectApiNames = RecipeCockpitTreecipeDataOrgs.listTreeInsertObjectApiNames(hub, recipeDataMessage.recipe, tree);
        const insertObjectApiNameSet = new Set(insertObjectApiNames);

        const connection = await SalesforceOrgService.getConnection(orgDetail.username);
        const querySource = SalesforceOrgService.toQuerySource(connection);

        // EVERY OBJECT THE TREE SENDS, AGAINST THE FIELDS OF ITS OWN BLOCK, BEFORE THE READER IS ASKED ANYTHING
        const treeTargets = ( await RecipeCockpitTreecipeDataOrgs.collectCreateTargets(hub, panelState, recipeDataMessage, treeKey) )
            .filter(createTarget => insertObjectApiNameSet.has(createTarget.objectApiName));
        const readinessByTarget = await RecipeCockpitTreecipeDataOrgs.computeCreateReadinessByTarget(orgDetail.username, connection, insertObjectApiNames, dataOrgSelection.orgTypeDetail, treeTargets);
        const readinessByObjectApiName = new Map(insertObjectApiNames.map(objectApiName => [
            objectApiName,
            readinessByTarget.byCreateKey.get(RecipeCockpitTreecipeDataOrgs.buildTreeObjectKey(treeKey, objectApiName)) ?? readinessByTarget.byObjectApiName.get(objectApiName)
        ]));

        const unreadyEntry = [...readinessByObjectApiName].find(([, readiness]) => !readiness || readiness.disabledReason);
        if ( unreadyEntry ) {
            return refuse(`Nothing was inserted into ${orgLabel}: ${RecipeYamlScalar.escapeForNotification(unreadyEntry[1]?.disabledReason ?? `${unreadyEntry[0]} could not be checked.`)}`);
        }

        // BUILT ONLY NOW, ONCE THE ORG CAN TAKE THE TREE: THE BUILD WALKS EVERY OBJECT'S METADATA
        // "A data set for each record type" (#624): EVERY SET'S RECIPE IS BUILT NOW, SO THE CONFIRMATION LISTS ITS OWN TOTALS AND WARNINGS, AND NO WALK RUNS AFTER THE ANSWER
        const recordTypeSets: IRecordTypeSet<IRecipeCockpitRunFakerFilteredRecipe>[] = [];

        if ( recordTypePlan.isRecipeDerived ) {

            const recordTypeRecipes = await this.buildRecordTypeRecipes(hub, panelState, recipeDataMessage.recipe, tree, recordTypePlan);
            if ( recordTypeRecipes === 'cancelled' ) {
                VSCodeWorkspaceService.showInformationMessage(`Nothing was generated or inserted for ${treeLabel}: building its recipe for the ticked record types was cancelled.`);
                return false;
            }
            if ( 'refusalReason' in recordTypeRecipes ) {
                return refuse(`Nothing was generated or inserted for ${treeLabel}: ${recordTypeRecipes.refusalReason}`);
            }

            filteredRecipe = recordTypeRecipes.foldedRecipe.filteredRecipe;
            recordTypeWarnings = recordTypeRecipes.foldedRecipe.confirmationWarnings;
            recordTypePlan = recordTypeRecipes.recordTypePlan;
            recordTypeSets.push(...recordTypeRecipes.recordTypeSets);

        }

        const generationRecipeText = filteredRecipe ? filteredRecipe.recipeText : fs.readFileSync(recipeFilePath, 'utf-8');

        // "Remember this selection" (#196): EVERY OBJECT WITH A CHOICE, IN ANY TREE. THE CONFIRMATION SAYS WHAT THE FILE WILL HOLD, AND IT IS SAVED ONLY WHEN THE GENERATE RUNS
        const rememberedRecordTypeSelection = insertAction.isRemembered && insertAction.recordTypeSelection
            ? RecipeCockpitRecordTypeRecipe.planGeneration(
                this.listRecordTypeTickObjects(hub, recipeDataMessage.recipe, recipeDataMessage.recipe.objects.map(objectViewModel => objectViewModel.objectApiName)),
                insertAction.recordTypeSelection
            ).recordTypeSelection
            : undefined;
        if ( rememberedRecordTypeSelection ) {
            recordTypeWarnings = [...recordTypeWarnings, RecipeCockpitRecordTypeRecipe.buildRememberWarning(rememberedRecordTypeSelection)];
        }

        /*
            A lookup the reader set to an existing org record (#421) keeps that Id. Every other lookup
            to a parent the tree does not insert asks nothing (#254's picker is gone): an optional one
            is left blank, and a required one gets a random existing record of its parent.
        */
        const orgRecordLookups = this.listTreeInsertOrgRecordLookups(hub, tree, insertObjectApiNameSet);
        const typedLookupIds = this.listTreeInsertTypedLookupIds(tree, insertObjectApiNameSet, objectApiName => SalesforceOrgService.getCachedDescribe(orgDetail.username, objectApiName));
        const orgRecordLookupKeys = new Set([...orgRecordLookups, ...typedLookupIds].map(keptLookup => `${keptLookup.objectApiName}\n${keptLookup.fieldApiName}`));
        const outsideParentObjectApiNames = [...new Set([...readinessByObjectApiName.values()]
            .flatMap(readiness => readiness.requiredLookups.map(requiredLookup => ({ objectApiName: readiness.objectApiName, requiredLookup: requiredLookup })))
            .filter(({ objectApiName, requiredLookup }) => !insertObjectApiNameSet.has(requiredLookup.parentObjectApiName) && !orgRecordLookupKeys.has(`${objectApiName}\n${requiredLookup.fieldApiName}`))
            .map(({ requiredLookup }) => requiredLookup.parentObjectApiName))];

        const recordTotalsByObject = new Map([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(generationRecipeText)]
            .filter(([objectApiName]) => insertObjectApiNameSet.has(objectApiName)));

        const insertConfirmationContent = this.buildInsertConfirmationContent(hub, orgLabel, dataOrgSelection.orgTypeDetail, tree, recipeDataMessage.recipe, recordTotalsByObject, outsideParentObjectApiNames, selectedFakerService, recipeFileLabel, orgRecordLookups, dataOrgSelection.scratchOrgDetail, typedLookupIds);
        const confirmTitle = `Generate ${treeLabel} and insert it into ${orgLabel}?`;
        const recordTypeConfirmationContent = recordTypePlan.isRecipeDerived
            ? this.addRecordTypesToInsertConfirmation(insertConfirmationContent, generationRecipeText, recordTypeWarnings)
            : { ...insertConfirmationContent, warnings: [...( insertConfirmationContent.warnings ?? [] ), ...recordTypeWarnings] };
        const confirmOptions: IRecipeCockpitConfirmOptions = {
            ...( recordTypeSets.length > 0
                ? RecipeCockpitRecordTypeSets.addRecordTypeSetsToConfirmation(recordTypeConfirmationContent, recordTypeSets, insertObjectApiNames)
                : recordTypeConfirmationContent ),
            org: hub.buildConfirmOrg(dataOrgSelection.orgDetail),
            isDestructive: true,
            changeOrg: { restartMessage: this.buildInsertTreeMessage(insertAction), isSandboxOnly: true }
        };

        // THE FOLDED QUESTION ONLY WHEN SOME OBJECT HAS A CHOICE (#623); AN ANSWER NAMING NO MODE THE DIALOG OFFERED IS CANCEL
        let confirmation: string | undefined;
        let recordTypeSetMode: RecordTypeSetMode | undefined;
        if ( recordTypePlan.offeredModes.length > 0 ) {
            const modeAnswer = await hub.confirmInPanelWithRecordTypeSetModes(confirmTitle, { ...confirmOptions, recordTypeSetModes: recordTypePlan.offeredModes }, RECIPE_COCKPIT_INSERT_CONFIRM_LABEL);
            confirmation = modeAnswer.recordTypeSetMode !== undefined ? modeAnswer.chosenLabel : undefined;
            recordTypeSetMode = modeAnswer.recordTypeSetMode;
        } else {
            confirmation = await hub.confirmInPanel(confirmTitle, confirmOptions, RECIPE_COCKPIT_INSERT_CONFIRM_LABEL);
        }

        if ( confirmation !== RECIPE_COCKPIT_INSERT_CONFIRM_LABEL ) {
            return false;
        }

        // THE SAME QUESTION INSERT DATA SET BY DIRECTORY ASKS: EVERY INSERT CHOOSES ALL-OR-NONE THE SAME WAY
        const allOrNoneSelection = await CollectionsApiService.promptForAllOrNoneInsertDecision();
        if ( allOrNoneSelection === undefined ) {
            return false;
        }

        /*
            The SAME selection, not merely the same org: another org chosen, ⟳, or a reload of the
            run each start a new one, and the readiness checked before the dialog belongs to the one
            the reader confirmed.
        */
        const isSameSelection = hub.recipeCockpitPanel === cockpitPanel
                                    && hub.recipeCockpitPanelState === panelState
                                    && panelState.dataOrgSelection === dataOrgSelection;

        if ( !isSameSelection ) {
            return refuse(`The org selection changed after ${orgLabel} was confirmed (another org was chosen, the orgs were checked again, or the run was reloaded), so nothing was inserted. Choose "${RECIPE_COCKPIT_INSERT_ACTION_LABEL}" again.`);
        }

        // ASKED AGAIN, NOT READ FROM THE SELECTION: THIS IS THE ANSWER THE INSERT RELIES ON, ON THE CONNECTION IT INSERTS WITH
        const orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was inserted into ${orgLabel} (${RecipeYamlScalar.escapeForNotification(SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail))}): the Recipe Cockpit inserts only into a sandbox or scratch org.`);
        }

        const orgRecordIdsByObject = new Map<string, string[]>();
        const queryOrgRecordIds = async (parentObjectApiName: string) => {
            if ( !orgRecordIdsByObject.has(parentObjectApiName) ) {
                orgRecordIdsByObject.set(parentObjectApiName, await SalesforceOrgService.queryRecordIds(querySource, parentObjectApiName));
            }
            return orgRecordIdsByObject.get(parentObjectApiName) as string[];
        };

        for ( const parentObjectApiName of outsideParentObjectApiNames ) {
            if ( ( await queryOrgRecordIds(parentObjectApiName) ).length === 0 ) {
                return refuse(`${treeLabel} needs an existing ${RecipeYamlScalar.escapeForNotification(parentObjectApiName)} record for a required lookup, and ${orgLabel} returned none, so nothing was generated or inserted.`);
            }
        }

        /*
            EVERY Id A LOOKUP WAS SET TO -- CHOSEN IN AN ORG (#421) OR TYPED WITH THE PENCIL (#627) -- MUST BE A
            RECORD OF ITS PARENT IN THE ORG INSERTED INTO, OR NOTHING IS WRITTEN. A POLYMORPHIC LOOKUP'S TYPED Id
            HAS NO ONE PARENT TO ASK, SO ITS RECORD'S INSERT ANSWERS FOR IT.
        */
        const checkedTypedLookupIds = typedLookupIds.filter((typedLookupId): typedLookupId is IRecipeCockpitTypedLookupId & { parentObjectApiName: string } => typedLookupId.parentObjectApiName !== undefined);
        const missingLookup = await this.findMissingOrgRecordLookup<ICheckedRecordIdLookup>(querySource, [...orgRecordLookups, ...checkedTypedLookupIds]);
        if ( missingLookup ) {
            const { objectApiName, fieldApiName, parentObjectApiName, recordId, failureMessage } = missingLookup;
            const lookupLabel = `${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(fieldApiName)}`;
            const parentLabel = RecipeYamlScalar.escapeForNotification(parentObjectApiName);
            const recordIdLabel = RecipeYamlScalar.escapeForNotification(recordId);
            return refuse(failureMessage !== undefined
                ? `Nothing was generated or inserted for ${treeLabel}: ${orgLabel} could not be asked whether it holds the ${parentLabel} records ${lookupLabel} points at (${RecipeYamlScalar.escapeForNotification(failureMessage)}).`
                : 'orgLabel' in missingLookup
                    ? `Nothing was generated or inserted for ${treeLabel}: ${lookupLabel} points at the ${parentLabel} record ${recordIdLabel}, chosen in ${RecipeYamlScalar.escapeForNotification(String(missingLookup.orgLabel))}, and ${orgLabel} has no such record. Clear it, or choose a record of this org with "Use existing ${parentLabel} from org…".`
                    : `Nothing was generated or inserted for ${treeLabel}: ${lookupLabel} holds the ${parentLabel} Id ${recordIdLabel}, typed with its pencil, and ${orgLabel} has no such record. Change it with the pencil, or Clear it.`);
        }
        const orgRecordIdsByObjectField = new Map<string, Map<string, Set<string>>>();
        [...orgRecordLookups, ...typedLookupIds].forEach(orgRecordLookup => {
            const recordIdsByField = orgRecordIdsByObjectField.get(orgRecordLookup.objectApiName) ?? new Map<string, Set<string>>();
            recordIdsByField.set(orgRecordLookup.fieldApiName, new Set([...( recordIdsByField.get(orgRecordLookup.fieldApiName) ?? [] ), orgRecordLookup.recordId]));
            orgRecordIdsByObjectField.set(orgRecordLookup.objectApiName, recordIdsByField);
        });

        if ( rememberedRecordTypeSelection ) {
            hub.saveRecordTypeSelection(panelState, rememberedRecordTypeSelection);
        }

        const insertOptions = () => ({
            prepareRecords: this.buildTreeInsertRecordPreparer(orgDetail.username, insertObjectApiNameSet, orgRecordIdsByObject, choiceCount => Math.floor(Math.random() * choiceCount), orgRecordIdsByObjectField),
            isFailureReportedByCaller: true,
            orgUsername: orgDetail.username,
            orgAlias: orgDetail.alias
        });
        const insertedTree = { runFolderName: recipeDataMessage.recipe.selectedRunFolderName, treeFolderName: tree.folderName };

        if ( recordTypeSetMode === 'separate' && recordTypeSets.length > 0 ) {
            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(recordTypeSets, {
                generateDataset: async setRecipe => {
                    const setDatasetFolderPath = await this.generateConfirmedDataset(recipeFilePath, setRecipe);
                    return setDatasetFolderPath && hub.isUsableWorkspacePath(setDatasetFolderPath, panelState.workspaceRoot) ? setDatasetFolderPath : undefined;
                },
                onDatasetFolderMade: onDatasetFolderMade,
                isSameSelection: () => hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState && panelState.dataOrgSelection === dataOrgSelection,
                insertDataset: setDatasetFolderPath => CollectionsApiService.insertDataSetFolderIntoOrg(setDatasetFolderPath, connection, allOrNoneSelection, insertOptions())
            });
            onInsertFinished();
            RecipeCockpitTreecipeDataOrgs.showRecordTypeSetsNotification(hub, setOutcomes, treeLabel, orgLabel, panelState.workspaceRoot, insertedTree);
            return setOutcomes.some(setOutcome => setOutcome.datasetFolderPath !== undefined);
        }

        const datasetFolderPath = await this.generateConfirmedDataset(recipeFilePath, filteredRecipe);

        if ( !datasetFolderPath || !hub.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot) ) {
            return refuse(`${treeLabel} was not generated, so nothing was inserted into ${orgLabel}.`);
        }
        onDatasetFolderMade(datasetFolderPath);

        const insertResult = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection, allOrNoneSelection, insertOptions());

        onInsertFinished();
        RecipeCockpitTreecipeDataOrgs.showTreeInsertNotification(hub, insertResult, treeLabel, orgLabel, panelState.workspaceRoot, insertedTree);

        return true;

    }

    /*
        The folded recipe and every set's (#624), from one read of the metadata (#702). The folded
        build comes first: it drops stale ticks, so no set is built for a record type the metadata
        no longer has, and a tree the metadata no longer builds is refused before any set is built.
        Every build reads the same metadata, so a set cannot drop a tick the folded build kept.
    */
    private static async buildRecordTypeRecipes(hub: IRecipeCockpitHubForTreecipeOrgTab,
                                                panelState: IRecipeCockpitPanelState,
                                                recipeViewModel: IRecipeCockpitRecipeViewModel,
                                                tree: IRecipeCockpitTreeViewModel,
                                                recordTypePlan: IRecordTypeGenerationPlan):
        Promise<{ foldedRecipe: { filteredRecipe: IRecipeCockpitRunFakerFilteredRecipe; confirmationWarnings: string[] }; recordTypePlan: IRecordTypeGenerationPlan; recordTypeSets: IRecordTypeSet<IRecipeCockpitRunFakerFilteredRecipe>[] } | { refusalReason: string } | 'cancelled'> {

        if ( !tree.folderName ) {
            return { refusalReason: TREE_NOT_BUILT_REFUSAL_REASON };
        }

        return RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(panelState.workspaceRoot, tree.folderName, async buildTreeRecipe => {

            const deriveRecipe = (recordTypeSelection: Readonly<Record<string, string[]>>, progressMessage?: string) =>
                this.buildRecordTypeFilteredRecipe(hub, panelState, recipeViewModel, tree, buildTreeRecipe, recordTypeSelection, progressMessage);

            // A LONE BUILD SAYS ONLY WHAT THE WALK DOES; WITH SETS TO FOLLOW, EACH BUILD SAYS WHICH IT IS (#695)
            const foldedRecipe = await deriveRecipe(recordTypePlan.recordTypeSelection,
                recordTypePlan.recordTypeSets.length > 0 ? RECORD_TYPE_RECIPE_FOLDED_PROGRESS_MESSAGE : undefined);
            if ( 'refusalReason' in foldedRecipe ) {
                return foldedRecipe;
            }

            // A SET IS NEVER BUILT FOR A RECORD TYPE THE METADATA NO LONGER HAS: IT WOULD BE THE DEFAULT, UNDER A NAME THAT SAYS OTHERWISE
            const setPlan = RecipeCockpitRecordTypeRecipe.withoutDroppedTicks(recordTypePlan, foldedRecipe.droppedTicks);
            const recordTypeSets: IRecordTypeSet<IRecipeCockpitRunFakerFilteredRecipe>[] = [];

            for ( const [setIndex, recordTypeSet] of setPlan.recordTypeSets.entries() ) {
                const setLabel = RecipeCockpitRecordTypeRecipe.buildRecordTypeSetLabel(recordTypeSet, setIndex);
                const setRecipe = await deriveRecipe(recordTypeSet,
                    RecipeCockpitRecordTypeRecipe.buildRecordTypeSetProgressMessage(recordTypeSet, setIndex, setPlan.recordTypeSets.length));
                if ( 'refusalReason' in setRecipe ) {
                    return { refusalReason: `${RecipeYamlScalar.escapeForNotification(setLabel)}: ${setRecipe.refusalReason}` };
                }
                recordTypeSets.push({
                    setLabel: setLabel,
                    recipe: setRecipe.filteredRecipe,
                    recordTotalsByObject: RecipeCockpitRecipeWriter.countRecipeRecordsByObject(setRecipe.filteredRecipe.recipeText),
                    warnings: setRecipe.confirmationWarnings
                });
            }

            return { foldedRecipe: foldedRecipe, recordTypePlan: setPlan, recordTypeSets: recordTypeSets };

        });

    }

    /*
        The tree's recipe for some record types (#623), built in memory with the card's settings
        applied: the confirmation's warnings and the ticks the build dropped with it, or why it
        cannot be built -- the part of a notification after the tree's name, escaped -- or 'cancelled'.
    */
    private static async buildRecordTypeFilteredRecipe(hub: IRecipeCockpitHubForTreecipeOrgTab,
                                                        panelState: IRecipeCockpitPanelState,
                                                        recipeViewModel: IRecipeCockpitRecipeViewModel,
                                                        tree: IRecipeCockpitTreeViewModel,
                                                        buildTreeRecipe: DerivedTreeRecipeBuild,
                                                        recordTypeSelection: Readonly<Record<string, string[]>>,
                                                        progressMessage?: string):
        Promise<{ filteredRecipe: IRecipeCockpitRunFakerFilteredRecipe; confirmationWarnings: string[]; droppedTicks: IDroppedRecordTypeTick[] } | { refusalReason: string }> {

        const derivedRecipe = await buildTreeRecipe(recordTypeSelection, progressMessage);
        if ( derivedRecipe === 'treeNotBuilt' ) {
            return { refusalReason: TREE_NOT_BUILT_REFUSAL_REASON };
        }

        const settingPlacer = RecipeCockpitRecordTypeRecipe.buildOccurrenceSettingPlacer(
            derivedRecipe.recipeText,
            this.listRunFirstNicknamesByObject(hub, recipeViewModel, tree),
            recordTypeSelection
        );

        // THE CARD, ITS READINESS AND THE CONFIRMATION'S TOTALS ARE THE RUN'S OBJECTS, SO A RECIPE WITH AN OBJECT THE RUN LACKS IS NOT GENERATED
        const treeObjectApiNames = new Set(tree.objects.map(treeObject => treeObject.objectApiName));
        const objectsNewToTree = settingPlacer.derivedObjectApiNames.filter(objectApiName => !treeObjectApiNames.has(objectApiName));
        if ( objectsNewToTree.length > 0 ) {
            return { refusalReason: `the object metadata now puts ${objectsNewToTree.map(objectApiName => RecipeYamlScalar.escapeForNotification(objectApiName)).join(', ')} in this tree, which this run does not have. Run "Generate Treecipe" again, then tick the record types.` };
        }

        const derivedFilteredRecipe = RecipeCockpitDrawnModel.buildRunFakerFilteredRecipe(derivedRecipe.recipeText, tree, panelState.objectLevelsByApiName, recipeViewModel, settingPlacer);
        if ( 'refusalMessage' in derivedFilteredRecipe ) {
            return { refusalReason: `${RecipeYamlScalar.escapeForNotification(derivedFilteredRecipe.refusalMessage)} The recipe built for the ticked record types could not take this card's settings.` };
        }

        return {
            // fromEntries DEFINES EACH KEY, SO AN OBJECT NAMED __proto__ IS RECORDED RATHER THAN SET AS A PROTOTYPE
            filteredRecipe: { ...derivedFilteredRecipe, recordTypeSelection: Object.fromEntries(Object.entries(recordTypeSelection)) },
            confirmationWarnings: RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings(derivedRecipe.droppedTicks, settingPlacer),
            droppedTicks: derivedRecipe.droppedTicks
        };

    }

    // Run Faker by Recipe WITH ITS MODAL ALREADY ANSWERED BY THE INSERT'S: THE DATA SET FOLDER IT WROTE, OR undefined
    private static async generateConfirmedDataset(recipeFilePath: string, filteredRecipe: IRecipeCockpitRunFakerFilteredRecipe | undefined): Promise<string | undefined> {

        const confirmationToken = RunFakerConfirmation.issue();
        let datasetFolderPath: unknown;
        try {
            datasetFolderPath = await vscode.commands.executeCommand(RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath, filteredRecipe, { confirmationToken: confirmationToken });
        } finally {
            RunFakerConfirmation.revoke(confirmationToken);
        }

        return typeof datasetFolderPath === 'string' && SfdxProjectService.isExistingDirectory(datasetFolderPath) ? datasetFolderPath : undefined;

    }

    // THE LOOKUPS SET TO AN EXISTING ORG RECORD (#421) THAT THE INSERT SENDS: ONLY AN OBJECT IT INSERTS, AND ONLY WHAT NO LOCK HOLDS BACK
    static listTreeInsertOrgRecordLookups(hub: IRecipeCockpitHubForTreecipeOrgTab, tree: IRecipeCockpitTreeViewModel, insertObjectApiNames: ReadonlySet<string>): IRecipeCockpitOrgRecordLookupViewModel[] {

        // AN ORG RECORD'S PIN HOLDS EVERY OCCURRENCE, SO AN OBJECT WITH iterations LISTS IT PER OCCURRENCE (#467); IT IS ONE LOOKUP
        const listedFieldKeys = new Set<string>();
        return ( tree.fixedValues ?? [] ).flatMap(fixedValue => {
            const fieldKey = `${fixedValue.objectApiName}\n${fixedValue.fieldApiName}`;
            const orgRecordLookup = fixedValue.orgRecord && insertObjectApiNames.has(fixedValue.objectApiName) && !listedFieldKeys.has(fieldKey)
                ? hub.findOrgRecordLookup(tree, fixedValue.objectApiName, fixedValue.fieldApiName, fixedValue.value)
                : undefined;
            if ( orgRecordLookup ) {
                listedFieldKeys.add(fieldKey);
            }
            return orgRecordLookup ? [orgRecordLookup] : [];
        });

    }

    /*
        The record Ids typed into a lookup's pencil (#627) that the insert sends and keeps: a pinned
        value that is a Salesforce Id, on a field the org inserted into describes as a lookup. Any
        other pinned value is left to prepareTreeInsertRecords, which replaces a lookup's as before.
    */
    static listTreeInsertTypedLookupIds(tree: IRecipeCockpitTreeViewModel,
                                        insertObjectApiNames: ReadonlySet<string>,
                                        findDescribe: (objectApiName: string) => ICreateObjectDescribe | undefined): IRecipeCockpitTypedLookupId[] {

        const listedKeys = new Set<string>();
        return ( tree.fixedValues ?? [] ).flatMap(fixedValue => {
            if ( fixedValue.orgRecord || !insertObjectApiNames.has(fixedValue.objectApiName) || !RecipeCockpitFixedValueStore.isSalesforceRecordId(fixedValue.value) ) {
                return [];
            }
            const describe = findDescribe(fixedValue.objectApiName);
            const insertLookup = describe
                ? RecipeCockpitRecordCreation.findTreeInsertLookups(describe).find(candidate => candidate.fieldApiName.toLowerCase() === fixedValue.fieldApiName.toLowerCase())
                : undefined;
            // AN OBJECT WITH iterations PINS EACH OCCURRENCE (#467): ONE Id ON ONE FIELD IS ONE LOOKUP
            const typedKey = `${fixedValue.objectApiName}\n${fixedValue.fieldApiName}\n${fixedValue.value}`;
            if ( !insertLookup || listedKeys.has(typedKey) ) {
                return [];
            }
            listedKeys.add(typedKey);
            return [{
                objectApiName: fixedValue.objectApiName,
                fieldApiName: fixedValue.fieldApiName,
                recordId: fixedValue.value,
                ...( insertLookup.parentObjectApiName !== undefined ? { parentObjectApiName: insertLookup.parentObjectApiName } : {} )
            }];
        });

    }

    /*
        The first lookup whose Id the org does not hold as a record of its parent, one query per
        parent; a query that fails is that lookup's failureMessage, never "it exists".
    */
    static async findMissingOrgRecordLookup<TLookup extends ICheckedRecordIdLookup>(querySource: IOrgQuerySource, orgRecordLookups: readonly TLookup[]):
        Promise<( TLookup & { failureMessage?: string } ) | undefined> {

        const parentObjectApiNames = [...new Set(orgRecordLookups.map(orgRecordLookup => orgRecordLookup.parentObjectApiName))];

        for ( const parentObjectApiName of parentObjectApiNames ) {
            const parentLookups = orgRecordLookups.filter(orgRecordLookup => orgRecordLookup.parentObjectApiName === parentObjectApiName);
            let existingRecordIds: string[];
            try {
                existingRecordIds = await SalesforceOrgService.queryExistingRecordIds(querySource, parentObjectApiName, parentLookups.map(orgRecordLookup => orgRecordLookup.recordId));
            } catch (queryError) {
                return { ...parentLookups[0], failureMessage: String(( queryError as Error )?.message ?? queryError) };
            }
            const missingLookup = parentLookups.find(orgRecordLookup => !existingRecordIds.some(existingRecordId => SalesforceOrgService.isSameRecordId(existingRecordId, orgRecordLookup.recordId)));
            if ( missingLookup ) {
                return missingLookup;
            }
        }

        return undefined;

    }

    /*
        What the insert does with a file's lookups, decided per object from the describe the
        readiness check just cached: a lookup already naming a record of this insert is kept, and any
        other is filled or cleared by RecipeCockpitRecordCreation.prepareTreeInsertRecords. An object
        the cache does not hold is sent as generated.
    */
    static buildTreeInsertRecordPreparer(orgUsername: string,
                                            insertObjectApiNames: ReadonlySet<string>,
                                            orgRecordIdsByObject: ReadonlyMap<string, readonly string[]>,
                                            pickIndex: (choiceCount: number) => number,
                                            orgRecordIdsByObjectField: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> = new Map()): DataSetRecordPreparer {

        // BUILT AS THE INSERT GOES: THE CREATED-Id MAP ONLY GROWS, SO EACH FILE ADDS ONLY WHAT THE FILES BEFORE IT CREATED
        const runRecordIds = new Set<string>();
        const runRecordIdsByObject = new Map<string, string[]>();
        const indexedReferenceIds = new Set<string>();

        return (objectApiName, records, createdRecordIdsByReferenceId) => {

            Object.entries(createdRecordIdsByReferenceId).forEach(([referenceId, recordId]) => {
                if ( indexedReferenceIds.has(referenceId) || typeof recordId !== 'string' ) {
                    return;
                }
                indexedReferenceIds.add(referenceId);
                runRecordIds.add(recordId);
                // "<Object>_Reference_<n>", WITH "__<nickname>" ONLY WHEN THE RECORD HAD ONE
                const referencedObjectApiName = /^(.+?)_Reference_\d+(?:__|$)/.exec(referenceId)?.[1];
                if ( referencedObjectApiName ) {
                    const objectRecordIds = runRecordIdsByObject.get(referencedObjectApiName);
                    if ( objectRecordIds ) {
                        objectRecordIds.push(recordId);
                    } else {
                        runRecordIdsByObject.set(referencedObjectApiName, [recordId]);
                    }
                }
            });

            const describe = SalesforceOrgService.getCachedDescribe(orgUsername, objectApiName);
            if ( !describe ) {
                return records;
            }

            // A NICKNAME OF A RECORD OF THIS SAME FILE IS RESOLVED BY A LATER INSERT ROUND
            const sameFileNicknames = new Set(records
                .map(record => ( record as { attributes?: { referenceId?: unknown } } | null )?.attributes?.referenceId)
                .filter((referenceId): referenceId is string => typeof referenceId === 'string')
                .map(referenceId => CollectionsApiService.readNicknameFromReferenceId(referenceId))
                .filter((nickname): nickname is string => !!nickname));

            return RecipeCockpitRecordCreation.prepareTreeInsertRecords(records, RecipeCockpitRecordCreation.findTreeInsertLookups(describe), {
                isRunReference: value => runRecordIds.has(value) || sameFileNicknames.has(value),
                runRecordIdsByObject: runRecordIdsByObject,
                orgRecordIdsByObject: orgRecordIdsByObject,
                inTreeObjectApiNames: insertObjectApiNames,
                orgRecordIdsByFieldApiName: orgRecordIdsByObjectField.get(objectApiName) ?? new Map()
            }, pickIndex);

        };

    }

    static buildInsertConfirmationContent(hub: IRecipeCockpitHubForTreecipeOrgTab, orgLabel: string,
                                            orgTypeDetail: IOrgTypeDetail | undefined,
                                            tree: IRecipeCockpitTreeViewModel,
                                            recipeViewModel: IRecipeCockpitRecipeViewModel,
                                            recordTotalsByObject: ReadonlyMap<string, number>,
                                            outsideParentObjectApiNames: string[],
                                            fakerService: string,
                                            recipeFileLabel: string,
                                            orgRecordLookups: readonly IRecipeCockpitOrgRecordLookupViewModel[] = [],
                                            scratchOrgDetail?: IScratchOrgDetail,
                                            typedLookupIds: readonly IRecipeCockpitTypedLookupId[] = []): IRecipeCockpitConfirmContent {

        const objectsByApiName = hub.buildObjectsByApiName(recipeViewModel);
        const objectCountsByObject = RecipeCockpitDrawnModel.listObjectCountsByObject(tree);
        const totalRecordCount = [...recordTotalsByObject.values()].reduce((recordCount, objectTotal) => recordCount + objectTotal, 0);
        const requestCount = RecipeCockpitRecordCreation.countInsertRequests(recordTotalsByObject);

        const objectLines = [...recordTotalsByObject].map(([objectApiName, objectTotal]) => {
            const objectViewModel = objectsByApiName.get(objectApiName);
            // THE FIRST OCCURRENCE'S COUNT: ITS OWN KEY'S FOR AN OBJECT WITH iterations (#467)
            const firstNickname = objectViewModel ? hub.readOccurrenceNickname(objectViewModel) : undefined;
            const perParentCount = objectCountsByObject.get(RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, firstNickname)) ?? objectViewModel?.recordCount;
            const perParentText = objectViewModel?.countParentObjectApiName && perParentCount !== undefined
                ? ` (${perParentCount} per ${objectViewModel.countParentObjectApiName})`
                : '';
            return `  ${objectApiName}: ${objectTotal}${perParentText}`;
        });
        // AN OCCURRENCE'S OWN CHANGE NAMES IT (#467)
        const describeKey = (occurrenceKey: string) => {
            const { objectApiName, nickname } = RecipeCockpitRecipeWriter.parseOccurrenceKey(occurrenceKey);
            return hub.describeOccurrence(objectApiName, nickname);
        };
        const leftOutLines = this.buildInsertLeftOutLines(hub, tree);
        // AN ORG RECORD'S Id IS LISTED ON ITS OWN LINE, WITH THE ORG IT CAME FROM, AND SO IS AN Id TYPED INTO A LOOKUP (#627)
        const fixedValues = ( tree.fixedValues ?? [] ).filter(fixedValue => !fixedValue.orgRecord
                                                                            && !typedLookupIds.some(typedLookupId => typedLookupId.objectApiName === fixedValue.objectApiName
                                                                                                                    && typedLookupId.fieldApiName === fixedValue.fieldApiName
                                                                                                                    && typedLookupId.recordId === fixedValue.value));
        const validationRulesOff = [...RecipeCockpitDrawnModel.listUnconstrainedValuesByObject(recipeViewModel, tree)]
            .flatMap(([occurrenceKey, valuesByField]) => [...valuesByField.keys()].map(fieldApiName => `${describeKey(occurrenceKey)}.${fieldApiName}`));

        const orgTypeLabel = SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail, scratchOrgDetail);

        return {
            summary: [`Generate ${totalRecordCount} ${totalRecordCount === 1 ? 'record' : 'records'} and insert ${totalRecordCount === 1 ? 'it' : 'them'} into ${orgLabel}.`],
            badge: orgTypeLabel,
            warnings: [
                'Cancel on the progress notification deletes every record this insert saved.',
                ...( validationRulesOff.length > 0
                    ? [`Validation rules switched off, so the org may reject these values: ${validationRulesOff.join(', ')}`]
                    : [] ),
                ...( totalRecordCount > RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD
                    ? [`This run will take time: ${totalRecordCount} records in at least ${requestCount} Collections API requests.`]
                    : [] ),
                // RECORDS POINTED AT EXISTING ORG RECORDS, AT RANDOM OR BY AN Id FROM ANOTHER ORG, ARE NOT GENERATED DATA, SO THEY ARE NEVER ONLY FOLDED
                ...( outsideParentObjectApiNames.length > 0
                    ? [`Required lookups to objects this tree does not insert get a random existing record of: ${outsideParentObjectApiNames.join(', ')} (none means nothing is inserted).`]
                    : [] ),
                ...( orgRecordLookups.length > 0
                    ? [
                        'Lookups set to existing org records, each checked in this org before anything is written:',
                        ...orgRecordLookups.map(orgRecordLookup => `  ${orgRecordLookup.objectApiName}.${orgRecordLookup.fieldApiName} → ${orgRecordLookup.parentObjectApiName} ${orgRecordLookup.recordId} (from ${orgRecordLookup.orgLabel})`)
                    ]
                    : [] ),
                ...( typedLookupIds.length > 0
                    ? [
                        'Lookups set to a record Id typed with the pencil, each checked in this org before anything is written:',
                        ...typedLookupIds.map(typedLookupId => typedLookupId.parentObjectApiName !== undefined
                            ? `  ${typedLookupId.objectApiName}.${typedLookupId.fieldApiName} → ${typedLookupId.parentObjectApiName} ${typedLookupId.recordId}`
                            : `  ${typedLookupId.objectApiName}.${typedLookupId.fieldApiName} → ${typedLookupId.recordId} (can point at more than one object, so it is not checked)`)
                    ]
                    : [] )
            ],
            sections: [
                { title: 'Records, inserted parents first', count: objectLines.length, lines: objectLines },
                { title: 'Lookups', lines: ['Any other lookup to an object this tree does not insert is left blank.'] },
                { title: RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE, count: leftOutLines.objectCount, lines: leftOutLines.lines },
                {
                    title: 'Fields changed on this card',
                    lines: [
                        ...( fixedValues.length > 0
                            ? [`Edited fields: ${fixedValues.map(fixedValue => `${hub.describeOccurrence(fixedValue.objectApiName, fixedValue.nickname)}.${fixedValue.fieldApiName} = ${fixedValue.value}`).join(', ')}`]
                            : [] )
                    ]
                },
                {
                    title: 'Org and recipe',
                    lines: [
                        `Org: ${orgLabel}`,
                        `Type: ${orgTypeLabel}`,
                        `Recipe tree: ${tree.customName ?? tree.title} (${recipeFileLabel})`,
                        `Backend: ${fakerService}`
                    ]
                },
                { title: 'What happens next', lines: ['The data set is written to FakeDataSets as Run Faker by Recipe writes it.', 'It is then inserted the way Insert Data Set by Directory inserts.', 'You choose all-or-none next.'] }
            ]
        };

    }

    // THE CONFIRMATION OF A RECIPE BUILT FOR THE TICKED RECORD TYPES (#623): WHAT IT WARNS OF, AND THE RECORD TYPES EACH OBJECT IS GENERATED WITH
    static addRecordTypesToInsertConfirmation(insertConfirmationContent: IRecipeCockpitConfirmContent, generationRecipeText: string, recordTypeWarnings: readonly string[]): IRecipeCockpitConfirmContent {

        const recordTypeLines = [...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(generationRecipeText)]
            .map(([objectApiName, developerNames]) => `  ${objectApiName}: ${developerNames.join(', ')}`);
        const [recordsSection, ...otherSections] = insertConfirmationContent.sections ?? [];

        return {
            ...insertConfirmationContent,
            warnings: [...( insertConfirmationContent.warnings ?? [] ), ...recordTypeWarnings],
            sections: [
                ...( recordsSection ? [recordsSection] : [] ),
                { title: RECIPE_COCKPIT_INSERT_RECORD_TYPES_SECTION_TITLE, count: recordTypeLines.length, lines: recordTypeLines },
                ...otherSections
            ]
        };

    }

    /*
        What the card leaves out of the insert, one object at a time (#483): each excluded object on
        its own line, then each occurrence with a field left out as a lead-in with one field per line
        under it, in the card's insert order. A field left out is one the reader unticked or a lookup
        an excluded parent cut, the same rows "Hide unselected" hides. Nothing left out is no lines,
        so the section is dropped.
    */
    static buildInsertLeftOutLines(hub: IRecipeCockpitHubForTreecipeOrgTab, tree: IRecipeCockpitTreeViewModel): { objectCount: number; lines: string[] } {

        const objectOrder = new Map(tree.objects.map((treeObject, objectIndex) => [treeObject.objectApiName, objectIndex]));
        const orderOf = (objectApiName: string) => objectOrder.get(objectApiName) ?? objectOrder.size;
        const byInsertOrder = <T>(entries: T[], objectApiNameOf: (entry: T) => string) => entries
            .map((entry, entryIndex) => ({ entry, entryIndex }))
            .sort((first, second) => ( orderOf(objectApiNameOf(first.entry)) - orderOf(objectApiNameOf(second.entry)) ) || ( first.entryIndex - second.entryIndex ))
            .map(({ entry }) => entry);

        const exclusionLines = byInsertOrder(tree.objectSelection?.exclusions ?? [], exclusion => exclusion.objectApiName)
            .map(exclusion => exclusion.removedLookupFieldApiName !== undefined
                ? `${exclusion.objectApiName}: not generated, cut off by removing ${exclusion.objectApiName}.${exclusion.removedLookupFieldApiName}`
                : exclusion.kind === 'autoExcluded'
                ? `${exclusion.objectApiName}: not generated, ${exclusion.excludedParentObjectApiName ? `auto-excluded with its parent ${exclusion.excludedParentObjectApiName}` : 'auto-excluded with its parent'}`
                : exclusion.kind === 'noFieldsSelected' ? `${exclusion.objectApiName}: not generated, no fields selected`
                : `${exclusion.objectApiName}: not generated, excluded`);

        const excludedObjectApiNames = new Set(hub.listExcludedObjectApiNames(tree));
        const cutParentByLookupKey = new Map(( tree.objectSelection?.disabledLookups ?? [] )
            .map(disabledLookup => [`${disabledLookup.objectApiName}\n${disabledLookup.fieldApiName}`, disabledLookup.parentObjectApiName]));
        const fieldEntries = byInsertOrder(( tree.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => {
                const untickedFieldApiNames = new Set(objectFieldSelection.excludedFieldApiNames);
                const fieldLines = [
                    ...objectFieldSelection.excludedFieldApiNames.map(fieldApiName => `  ${fieldApiName}`),
                    ...objectFieldSelection.lockedFields
                        .filter(lockedField => lockedField.reason === RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON && !untickedFieldApiNames.has(lockedField.fieldApiName))
                        .map(lockedField => {
                            const parentObjectApiName = cutParentByLookupKey.get(`${objectFieldSelection.objectApiName}\n${lockedField.fieldApiName}`);
                            return `  ${lockedField.fieldApiName}, cut: parent ${parentObjectApiName ?? 'object'} excluded`;
                        })
                ];
                return { objectApiName: objectFieldSelection.objectApiName, nickname: objectFieldSelection.nickname, fieldLines };
            })
            .filter(fieldEntry => fieldEntry.fieldLines.length > 0), fieldEntry => fieldEntry.objectApiName);
        const fieldLines = fieldEntries.flatMap(fieldEntry => [
            `${hub.describeOccurrence(fieldEntry.objectApiName, fieldEntry.nickname)}, ${fieldEntry.fieldLines.length === 1 ? '1 field' : `${fieldEntry.fieldLines.length} fields`} left out, not sent:`,
            ...fieldEntry.fieldLines
        ]);

        return { objectCount: exclusionLines.length + fieldEntries.length, lines: [...exclusionLines, ...fieldLines] };

    }

}
