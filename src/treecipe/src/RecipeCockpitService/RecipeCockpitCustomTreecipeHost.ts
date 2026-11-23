import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import type { IObjectSelectionExclusion } from './RecipeCockpitObjectSelection';
import {
    ICustomTreecipeDefinition,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_FILE_NAME,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_VERSION,
    RECIPE_COCKPIT_CUSTOM_TREE_NAME_MAX_LENGTH,
    RecipeCockpitCustomTreecipe
} from './RecipeCockpitCustomTreecipe';
import {
    RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_POSTED_NAMES,
    RECIPE_COCKPIT_CUSTOM_TREECIPE_OPEN_RECIPE_LABEL
} from './RecipeCockpitCustomTreecipeConstants';
// TYPES ONLY: THE HUB IMPORTS THIS FILE, AND A HOST NEVER LOADS THE HUB'S CODE
import type { RecipeCockpitService } from './RecipeCockpitService';
import type {
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeFieldSelectionViewModel,
    IRecipeCockpitTreeObjectSelectionViewModel,
    IRecipeCockpitTreeViewModel
} from './RecipeCockpitViewModel';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';

/*
    "Customize and create new recipe" (#677), the host half: the modal's preview and its Save as new
    Treecipe, out of the hub the way #665–#668 moved each tab. The modal posts its removals by name;
    this file matches them against the drawn card, answers with the card's own cascade, and writes
    the custom tree. How a run then LOADS its custom trees is the hub's, since every run loads there;
    the names and customTreecipe.json rules both halves read are RecipeCockpitCustomTreecipe.ts.
*/

// WHAT THE CUSTOM TREECIPE HOST READS AND CALLS ON THE HUB, AND NOTHING ELSE
export type IRecipeCockpitHubForCustomTreecipe = Readonly<Pick<typeof RecipeCockpitService,
    'applyTreeObjectAndFieldSelection' |
    'buildObjectsByApiName' |
    'buildRunFakerFilteredRecipe' |
    'buildSelectableFieldKey' |
    'buildSelectableObjectKey' |
    'listExcludedObjectApiNames' |
    'loadRecipeIntoPanel' |
    'readCustomTreecipeDefinition' |
    'postToPanel' |
    'readTreePreferences' |
    'readTreeSelections' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'recipeCockpitWorkspaceState' |
    'selectedCustomTreeFolderNameByRunFolderName' |
    'toSingleLine' |
    'writeTreePreferences' |
    'writeTreeSelections'>>;

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_COMMANDS = [
    'previewCustomTreecipe',
    'saveCustomTreecipe'
] as const;

export const RECIPE_COCKPIT_CUSTOM_TREECIPE_ACTION_KINDS = [
    'previewCustomTreecipe',
    'saveCustomTreecipe'
] as const;

/*
    What "Customize and create new recipe" (#677) takes out of the new recipe, and what it leaves
    out of a run only. Every name was matched against the drawn card by the router.
*/
export interface IRecipeCockpitCustomTreecipeRemoval {
    removedObjectApiNames: string[];
    removedFieldApiNamesByObject: Map<string, Set<string>>;
    outOfRunObjectApiNames: string[];
}

/*
    The modal's state as the host computes it, by the card's own rules: objectSelection and
    fieldSelection are what the new recipe leaves out (its cascade, locks included),
    outOfRunExclusions what the chain links also leave out of a run. folderName is where Save would
    write; refusal says why it would not.
*/
export interface IRecipeCockpitCustomTreecipePreviewMessage {
    command: 'customTreecipePreview';
    renderSequence: number;
    previewSequence: number;
    treeKey: string;
    objectSelection?: IRecipeCockpitTreeObjectSelectionViewModel;
    fieldSelection?: IRecipeCockpitTreeFieldSelectionViewModel;
    outOfRunExclusions: IObjectSelectionExclusion[];
    keptObjectCount: number;
    objectCount: number;
    folderName?: string;
    refusal?: string;
}

export type RecipeCockpitCustomTreecipePanelAction =
    | { kind: 'previewCustomTreecipe'; treeKey: string; previewSequence: number; removal: IRecipeCockpitCustomTreecipeRemoval }
    | { kind: 'saveCustomTreecipe'; treeKey: string; removal: IRecipeCockpitCustomTreecipeRemoval; name: string };

export class RecipeCockpitCustomTreecipeHost {

    static isCustomTreecipeCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_CUSTOM_TREECIPE_COMMANDS.some(ownedCommand => ownedCommand === command);
    }

    static isCustomTreecipePanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitCustomTreecipePanelAction {
        return RECIPE_COCKPIT_CUSTOM_TREECIPE_ACTION_KINDS.some(ownedActionKind => ownedActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: THE HUB'S CHECKS IT READS ARE FUNCTIONS OF THE STATE PASSED
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForCustomTreecipe): RecipeCockpitCustomTreecipePanelAction | undefined {

        switch ( panelMessage.command ) {

            /*
                "Customize and create new recipe" (#677) posts NAMES, each one a key the confirmed-drawn
                model drew a chain link or a checkbox for on this card, so nothing it names is ever
                written raw. Only a card with its own recipe file can be copied.
            */
            case 'previewCustomTreecipe':
            case 'saveCustomTreecipe': {

                const { treeKey, renderSequence, previewSequence, name } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.recipeDataMessage || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || !panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.has(treeKey) ) {
                    return undefined;
                }

                const removal = this.readCustomTreecipeRemoval(hub, panelMessage, panelState, treeKey);
                if ( !removal ) {
                    return undefined;
                }

                if ( panelMessage.command === 'previewCustomTreecipe' ) {
                    return typeof previewSequence === 'number' && Number.isSafeInteger(previewSequence) && previewSequence >= 0
                        ? { kind: 'previewCustomTreecipe', treeKey: treeKey, previewSequence: previewSequence, removal: removal }
                        : undefined;
                }

                return typeof name === 'string' && name.length <= RECIPE_COCKPIT_CUSTOM_TREE_NAME_MAX_LENGTH
                    ? { kind: 'saveCustomTreecipe', treeKey: treeKey, removal: removal, name: name }
                    : undefined;

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForCustomTreecipe, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitCustomTreecipePanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'previewCustomTreecipe':

                this.previewCustomTreecipe(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'saveCustomTreecipe':

                await this.saveCustomTreecipe(hub, cockpitPanel, panelState, panelAction);
                return;

        }

    }

    /*
        The modal's removals as the router reads them: three lists of names, each name a key the
        drawn card has a chain link or a checkbox for. Anything else, or more names than any tree
        holds, and the whole message is refused.
    */
    static readCustomTreecipeRemoval(hub: IRecipeCockpitHubForCustomTreecipe, panelMessage: IRecipeCockpitPanelMessage,
                                        panelState: IRecipeCockpitPanelState,
                                        treeKey: string): IRecipeCockpitCustomTreecipeRemoval | undefined {

        const { removedObjectApiNames, removedFields, outOfRunObjectApiNames } = panelMessage;
        const isDrawnObject = (objectApiName: unknown): objectApiName is string => typeof objectApiName === 'string'
            && panelState.treeHistoryAllowLists.selectableObjectKeys.has(hub.buildSelectableObjectKey(treeKey, objectApiName));
        const isDrawnObjectList = (candidate: unknown): candidate is string[] => Array.isArray(candidate)
            && candidate.length <= RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_POSTED_NAMES && candidate.every(isDrawnObject);

        if ( !isDrawnObjectList(removedObjectApiNames) || !isDrawnObjectList(outOfRunObjectApiNames)
                || !Array.isArray(removedFields) || removedFields.length > RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_POSTED_NAMES ) {
            return undefined;
        }

        const removedFieldApiNamesByObject = new Map<string, Set<string>>();
        for ( const removedField of removedFields as unknown[] ) {
            if ( !RecipeCockpitUntrustedValue.isPlainRecord(removedField) ) {
                return undefined;
            }
            const { objectApiName, fieldApiName } = removedField;
            if ( typeof objectApiName !== 'string' || typeof fieldApiName !== 'string'
                    || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                return undefined;
            }
            removedFieldApiNamesByObject.set(objectApiName, ( removedFieldApiNamesByObject.get(objectApiName) ?? new Set<string>() ).add(fieldApiName));
        }

        return {
            removedObjectApiNames: [...new Set(removedObjectApiNames)],
            removedFieldApiNamesByObject: removedFieldApiNamesByObject,
            outOfRunObjectApiNames: [...new Set(outOfRunObjectApiNames)].filter(objectApiName => !removedObjectApiNames.includes(objectApiName))
        };

    }

    /*
        The card as the new recipe will be (#677): a copy of it whose selection is ONLY the modal's
        removals, worked out by the card's own rules -- the object cascade, #679's removed lookups,
        #611's empty objects and the field locks -- and whose counts, fixed values and switched-off
        validation rules stay the card's, so the copy carries them. The card itself is not touched.
    */
    static buildCustomTreecipeTree(hub: IRecipeCockpitHubForCustomTreecipe, recipeViewModel: IRecipeCockpitRecipeViewModel,
                                    tree: IRecipeCockpitTreeViewModel,
                                    removedObjectApiNames: readonly string[],
                                    removedFieldApiNamesByObject: ReadonlyMap<string, ReadonlySet<string>>): IRecipeCockpitTreeViewModel {

        const customTree: IRecipeCockpitTreeViewModel = { ...tree };
        delete customTree.objectSelection;
        delete customTree.fieldSelection;

        hub.applyTreeObjectAndFieldSelection(hub.buildObjectsByApiName(recipeViewModel), customTree, new Set(removedObjectApiNames), removedFieldApiNamesByObject);

        return customTree;

    }

    static buildCustomTreecipePreview(hub: IRecipeCockpitHubForCustomTreecipe, recipeViewModel: IRecipeCockpitRecipeViewModel,
                                        tree: IRecipeCockpitTreeViewModel,
                                        removal: IRecipeCockpitCustomTreecipeRemoval): Omit<IRecipeCockpitCustomTreecipePreviewMessage, 'command' | 'renderSequence' | 'previewSequence' | 'treeKey' | 'folderName' | 'refusal'> {

        const customTree = this.buildCustomTreecipeTree(hub, recipeViewModel, tree, removal.removedObjectApiNames, removal.removedFieldApiNamesByObject);
        const removedObjectApiNameSet = new Set(hub.listExcludedObjectApiNames(customTree));
        const outOfRunTree = this.buildCustomTreecipeTree(hub, recipeViewModel, tree, [...removal.removedObjectApiNames, ...removal.outOfRunObjectApiNames], removal.removedFieldApiNamesByObject);
        const drawnObjectApiNames = new Set(tree.objects.filter(treeObject => treeObject.iterationNickname === undefined).map(treeObject => treeObject.objectApiName));

        return {
            ...( customTree.objectSelection ? { objectSelection: customTree.objectSelection } : {} ),
            ...( customTree.fieldSelection ? { fieldSelection: customTree.fieldSelection } : {} ),
            outOfRunExclusions: ( outOfRunTree.objectSelection?.exclusions ?? [] ).filter(exclusion => !removedObjectApiNameSet.has(exclusion.objectApiName)),
            keptObjectCount: [...drawnObjectApiNames].filter(objectApiName => !removedObjectApiNameSet.has(objectApiName)).length,
            objectCount: drawnObjectApiNames.size
        };

    }

    /*
        Where a card's custom copy goes, read from disk at the moment it is asked: the run folder
        that holds the card's own tree folder, the original generated tree it descends from, and the
        first free "custom-" folder name there. A card whose recipe is not in its own tree folder
        under a run cannot be copied.
    */
    static planCustomTreecipeLocation(hub: IRecipeCockpitHubForCustomTreecipe, recipeFilePath: string,
                                        tree: IRecipeCockpitTreeViewModel): { runFolderPath: string; sourceTreeFolderPath: string; originalTreeFolderName: string; folderName: string } | { refusal: string } {

        const sourceTreeFolderPath = path.dirname(recipeFilePath);
        if ( path.basename(sourceTreeFolderPath) !== tree.folderName || !RecipeCockpitCustomTreecipe.isTreeFolderName(tree.folderName) ) {
            return { refusal: `its recipe ${path.basename(recipeFilePath)} is not in a tree folder of its own.` };
        }

        const runFolderPath = path.dirname(sourceTreeFolderPath);
        const originalTreeFolderName = RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName(tree.folderName, hub.readCustomTreecipeDefinition(sourceTreeFolderPath));

        let takenFolderNames: Set<string>;
        try {
            takenFolderNames = new Set(fs.readdirSync(runFolderPath));
        } catch (readError) {
            return { refusal: `its run folder ${path.basename(runFolderPath)} could not be read: ${String(readError?.code ?? readError)}.` };
        }

        const folderName = RecipeCockpitCustomTreecipe.planCustomTreeFolderName(originalTreeFolderName, takenFolderNames);

        return folderName
            ? { runFolderPath: runFolderPath, sourceTreeFolderPath: sourceTreeFolderPath, originalTreeFolderName: originalTreeFolderName, folderName: folderName }
            : { refusal: `${path.basename(runFolderPath)} already holds every custom copy number of ${originalTreeFolderName}. Remove one you no longer need.` };

    }

    private static previewCustomTreecipe(hub: IRecipeCockpitHubForCustomTreecipe, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitCustomTreecipePanelAction, { kind: 'previewCustomTreecipe' }>) {

        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);
        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(panelAction.treeKey);
        if ( !recipeDataMessage || !tree || !recipeFilePath ) {
            return;
        }

        const location = this.planCustomTreecipeLocation(hub, recipeFilePath, tree);

        hub.postToPanel(cockpitPanel, {
            command: 'customTreecipePreview',
            renderSequence: recipeDataMessage.renderSequence,
            previewSequence: panelAction.previewSequence,
            treeKey: panelAction.treeKey,
            ...this.buildCustomTreecipePreview(hub, recipeDataMessage.recipe, tree, panelAction.removal),
            ...( 'refusal' in location ? { refusal: location.refusal } : { folderName: location.folderName } )
        });

    }

    private static isCustomTreecipeSaveInFlight = false;

    /*
        "Save as new Treecipe" (#677). The modal's save step is the confirmation, so the host plans
        everything again here: the card's copy by its own rules, the filtered recipe Run Faker would
        build from it, and a folder name free NOW. It writes only new things -- one folder, made
        non-recursively, and two files with "wx" -- and takes them back out if either write fails.
        The source recipe and its folder are never opened for writing.
    */
    private static async saveCustomTreecipe(hub: IRecipeCockpitHubForCustomTreecipe, cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitCustomTreecipePanelAction, { kind: 'saveCustomTreecipe' }>) {

        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);
        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(panelAction.treeKey);
        if ( !recipeDataMessage || !tree || !recipeFilePath || this.isCustomTreecipeSaveInFlight ) {
            return;
        }

        const workspaceRoot = panelState.workspaceRoot;
        const treeLabel = RecipeYamlScalar.escapeForNotification(hub.toSingleLine(tree.customName ?? tree.title));
        const refuse = (reason: string) => {
            VSCodeWorkspaceService.showWarningMessage(`No new Treecipe was saved from ${treeLabel}: ${RecipeYamlScalar.escapeForNotification(reason)}`);
        };

        const { removal } = panelAction;
        if ( removal.removedObjectApiNames.length === 0 && removal.removedFieldApiNamesByObject.size === 0 ) {
            refuse('nothing was removed, so the new recipe would be the same as the source. Remove an object or a field with ✕ first.');
            return;
        }

        const customName = panelAction.name.trim() === '' ? undefined : RecipeCockpitCustomTreecipe.normalizeCustomTreeName(panelAction.name);
        if ( panelAction.name.trim() !== '' && !customName ) {
            refuse(`the name must be one line of at most ${RECIPE_COCKPIT_CUSTOM_TREE_NAME_MAX_LENGTH} characters.`);
            return;
        }

        this.isCustomTreecipeSaveInFlight = true;
        try {

            const customTree = this.buildCustomTreecipeTree(hub, recipeDataMessage.recipe, tree, removal.removedObjectApiNames, removal.removedFieldApiNamesByObject);
            const removedObjectApiNames = hub.listExcludedObjectApiNames(customTree);
            const keptObjectApiNames = tree.objects
                .filter(treeObject => treeObject.iterationNickname === undefined && !removedObjectApiNames.includes(treeObject.objectApiName))
                .map(treeObject => treeObject.objectApiName);
            if ( keptObjectApiNames.length === 0 ) {
                refuse('every object was removed, so nothing is left to save.');
                return;
            }

            if ( !SfdxProjectService.isPathContainedInWorkspace(recipeFilePath, workspaceRoot) ) {
                refuse(`its recipe ${path.basename(recipeFilePath)} is not inside this workspace.`);
                return;
            }

            let recipeText: string;
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf8');
            } catch (readError) {
                refuse(`its recipe ${path.basename(recipeFilePath)} could not be read: ${String(readError?.code ?? readError)}.`);
                return;
            }

            const filteredRecipe = hub.buildRunFakerFilteredRecipe(recipeText, customTree, panelState.objectLevelsByApiName, recipeDataMessage.recipe);
            if ( 'refusalMessage' in filteredRecipe ) {
                refuse(filteredRecipe.refusalMessage);
                return;
            }

            const location = this.planCustomTreecipeLocation(hub, recipeFilePath, tree);
            if ( 'refusal' in location ) {
                refuse(location.refusal);
                return;
            }
            if ( !SfdxProjectService.isPathContainedInWorkspace(location.runFolderPath, workspaceRoot) ) {
                refuse(`its run folder ${path.basename(location.runFolderPath)} is not inside this workspace.`);
                return;
            }

            const savedAt = new Date();
            const customTreeFolderPath = path.join(location.runFolderPath, location.folderName);
            const customRecipeFilePath = path.join(customTreeFolderPath, RecipeCockpitCustomTreecipe.buildRecipeFileName(location.folderName, path.basename(recipeFilePath), savedAt));
            const definition: ICustomTreecipeDefinition = {
                version: RECIPE_COCKPIT_CUSTOM_TREECIPE_VERSION,
                sourceRunFolderName: path.basename(location.runFolderPath),
                sourceTreeFolderName: tree.folderName,
                sourceRecipeFileName: path.basename(recipeFilePath),
                originalTreeFolderName: location.originalTreeFolderName,
                removedObjectApiNames: [...removal.removedObjectApiNames],
                removedFields: [...removal.removedFieldApiNamesByObject.entries()].map(([objectApiName, fieldApiNames]) => ({ objectApiName: objectApiName, fieldApiNames: [...fieldApiNames] })),
                outOfRunObjectApiNames: [...removal.outOfRunObjectApiNames],
                ...( customName ? { name: customName } : {} ),
                savedAt: savedAt.toISOString()
            };

            const writtenFilePaths: string[] = [];
            let isFolderMade = false;
            try {
                // NOT recursive: AN EXISTING FOLDER FAILS HERE, SO A COPY NEVER WRITES INTO ONE IT DID NOT MAKE
                fs.mkdirSync(customTreeFolderPath);
                isFolderMade = true;
                if ( !SfdxProjectService.isPathContainedInWorkspace(customTreeFolderPath, workspaceRoot) ) {
                    throw new Error(`${location.folderName} is not inside this workspace`);
                }
                fs.writeFileSync(customRecipeFilePath, filteredRecipe.recipeText, { encoding: 'utf8', flag: 'wx' });
                writtenFilePaths.push(customRecipeFilePath);
                const definitionFilePath = path.join(customTreeFolderPath, RECIPE_COCKPIT_CUSTOM_TREECIPE_FILE_NAME);
                fs.writeFileSync(definitionFilePath, RecipeCockpitCustomTreecipe.buildDefinitionText(definition), { encoding: 'utf8', flag: 'wx' });
                writtenFilePaths.push(definitionFilePath);
            } catch (writeError) {
                writtenFilePaths.forEach(writtenFilePath => fs.rmSync(writtenFilePath, { force: true }));
                // ONLY A FOLDER THIS SAVE MADE: ANOTHER WINDOW'S, MADE A MOMENT EARLIER, IS ITS OWN
                if ( isFolderMade ) {
                    try {
                        fs.rmdirSync(customTreeFolderPath);
                    } catch {
                        // NOT EMPTY: LEFT AS IT IS
                    }
                }
                refuse(`${location.folderName} could not be written in ${path.basename(location.runFolderPath)}: ${RecipeCockpitUntrustedValue.describeThrown(writeError)}. Nothing was left behind.`);
                return;
            }

            /*
                The new tree opens with the modal's chain links and name, keyed by its own folder like
                every card's. A folder name used before (a custom tree deleted by hand, then saved
                again) starts clean, so it never inherits that tree's unticked fields, counts or name.
            */
            const treeSelections = hub.readTreeSelections(hub.recipeCockpitWorkspaceState);
            treeSelections.excludedFieldApiNamesByFolderName.delete(location.folderName);
            treeSelections.objectCountsByFolderName.delete(location.folderName);
            treeSelections.fixedValuesByFolderName.delete(location.folderName);
            treeSelections.validationRulesOffByFolderName.delete(location.folderName);
            if ( removal.outOfRunObjectApiNames.length > 0 ) {
                treeSelections.excludedObjectApiNamesByFolderName.set(location.folderName, new Set(removal.outOfRunObjectApiNames));
            } else {
                treeSelections.excludedObjectApiNamesByFolderName.delete(location.folderName);
            }
            await hub.writeTreeSelections(hub.recipeCockpitWorkspaceState, treeSelections);
            const treePreferences = hub.readTreePreferences(hub.recipeCockpitWorkspaceState);
            if ( customName ) {
                treePreferences.customNamesByFolderName.set(location.folderName, customName);
            } else {
                treePreferences.customNamesByFolderName.delete(location.folderName);
            }
            await hub.writeTreePreferences(hub.recipeCockpitWorkspaceState, treePreferences);

            const relativeRecipeFilePath = path.relative(workspaceRoot, customRecipeFilePath).split(path.sep).join('/');
            Promise.resolve(vscode.window.showInformationMessage(
                RecipeYamlScalar.escapeForNotification(`Saved ${location.folderName}, a custom copy of ${hub.toSingleLine(tree.customName ?? tree.title)} with ${keptObjectApiNames.length} of ${keptObjectApiNames.length + removedObjectApiNames.length} objects: ${relativeRecipeFilePath}. Choose it in the Recipe run list to generate from it.`),
                RECIPE_COCKPIT_CUSTOM_TREECIPE_OPEN_RECIPE_LABEL
            )).then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_CUSTOM_TREECIPE_OPEN_RECIPE_LABEL ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(customRecipeFilePath, workspaceRoot, 'The custom recipe no longer exists in this workspace.');
                }
            }).catch(() => undefined);

            if ( hub.recipeCockpitPanel === cockpitPanel ) {
                hub.selectedCustomTreeFolderNameByRunFolderName.set(path.basename(location.runFolderPath), location.folderName);
                await hub.loadRecipeIntoPanel(cockpitPanel, workspaceRoot, path.basename(location.runFolderPath), { treeKey: location.folderName, tab: 'treecipe' });
            }

        } finally {
            this.isCustomTreecipeSaveInFlight = false;
        }

    }


}
