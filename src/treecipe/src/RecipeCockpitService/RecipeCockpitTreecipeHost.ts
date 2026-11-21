import * as vscode from 'vscode';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeTab
import type {
    IRecipeCockpitAddFriendStateMessage,
    IRecipeCockpitAddableParentViewModel,
    IRecipeCockpitEmptyLookupViewModel,
    IRecipeCockpitLookupWiringViewModel,
    IRecipeCockpitObjectRefreshStateMessage,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitTreePreferences,
    IRecipeCockpitTreePreferencesMessage,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitWireLookupStateMessage,
    RecipeCockpitPanelAction,
    RecipeCockpitService
} from './RecipeCockpitService';
import {
    IRemovedTodoComment,
    RecipeCockpitRecipeWriter
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import { RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE } from './RecipeCockpitFieldRowsConstants';
import {
    OBJECT_REFRESH_KINDS,
    ObjectRefreshKind,
    RecipeCockpitObjectRefresh
} from './RecipeCockpitObjectRefresh';
import { RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH } from './RecipeCockpitShellConstants';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { RecipeCockpitTreecipeSelection } from './RecipeCockpitTreecipeSelection';
import { RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH } from './RecipeCockpitTreecipeFieldEditorConstants';
import {
    RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL,
    RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL,
    RecipeCockpitTreecipeObjectRefresh
} from './RecipeCockpitTreecipeObjectRefresh';
import { RecipeCockpitTreecipeRecipeEdits } from './RecipeCockpitTreecipeRecipeEdits';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL } from './RecipeCockpitNavigationConstants';

/*
    The Treecipe tab's recipe edits, its host half (moved out of the hub by #688, after #665's
    pattern and #687's Treecipe org row): the messages a tree card's Treecipe tab posts to change
    its recipe or what a run takes from it, and the actions they route to. The host holds the
    router, the executor and the card's name and favourite. What the actions run is
    RecipeCockpitTreecipeSelection (objects, fields, counts, fixed values, picklist choices, rule
    toggles, reset), RecipeCockpitTreecipeObjectRefresh ("Get latest object detail") and
    RecipeCockpitTreecipeRecipeEdits (friends, lookups, parents, TODOs, and the recipe and sidecar
    writes the others share). They load one way: this file, Selection, ObjectRefresh, RecipeEdits.
    The hub owns the panel, its state, the model and every allow-list, and promotes the lists on the
    panel's acks.
*/

/*
    What the Treecipe tab's files read and call on the hub, and nothing else: the hub class itself,
    narrowed to these names and read-only, so a read after an await sees the panel and state open
    now.
*/
export type IRecipeCockpitHubForTreecipeTab = Readonly<Pick<typeof RecipeCockpitService,
    'applyObjectSelections' |
    'applyTreePreferences' |
    'buildConfirmOrg' |
    'buildInsertableFriendKey' |
    'buildLookupWiringContext' |
    'buildObjectsByApiName' |
    'buildPicklistChoiceExpression' |
    'buildPinnedFieldRestoreRequests' |
    'buildSelectableFieldKey' |
    'buildSelectableObjectKey' |
    'buildTodoActionKey' |
    'buildWireableLookupKey' |
    'confirmInPanel' |
    'describeOccurrence' |
    'describeThrown' |
    'describeTreeNameProblem' |
    'discardObjectRefreshStaging' |
    'findDrawnField' |
    'findDrawnOccurrenceField' |
    'findFixedValueLockReason' |
    'findLookupValueRefusal' |
    'findObjectFieldSelection' |
    'findValidationRuleLockReason' |
    'getParentObjectTemplates' |
    'isApplyHeldByAnotherRun' |
    'isSelectionHeldByPromptOrUpdater' |
    'isUsableWorkspacePath' |
    'listDeclaredPicklistValues' |
    'listExcludedObjectApiNames' |
    'listRemovedTodosStillOut' |
    'listSelectableFieldApiNames' |
    'listTreeEmptyLookups' |
    'listTreeOccurrences' |
    'listTreeTodos' |
    'loadRecipeIntoPanel' |
    'postNameEditResult' |
    'postToPanel' |
    'readFixedValueFile' |
    'readGeneratedPicklistChoice' |
    'readRemovedTodoFile' |
    'readSourceApiVersion' |
    'readTreeFakerService' |
    'readTreePreferences' |
    'readTreeSelections' |
    'recipeCockpitPanel' |
    'recipeCockpitPanelState' |
    'recipeCockpitWorkspaceState' |
    'refreshDataOrgReadinessForTrees' |
    'resolveFixedValueKind' |
    'resolvePostedOccurrence' |
    'resolveSelectedReadOrg' |
    'resolveTreeRunArtifactsLocation' |
    'runCancellableRetrieve' |
    'validateFixedValueInput' |
    'writeTreePreferences' |
    'writeTreeSelections'>>;

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE NAMES IT
export const RECIPE_COCKPIT_TREECIPE_COMMANDS = [
    'addIterationFriend',
    'removeTodo',
    'restoreTodo',
    'wireLookup',
    'wireAllLookups',
    'addParentObject',
    'useOrgRecordForLookup',
    'renameTree',
    'toggleFavoriteTree',
    'setObjectIncluded',
    'setFieldIncluded',
    'setAllFieldsIncluded',
    'setObjectCount',
    'setFieldFixedValue',
    'setPicklistValueChoice',
    'resetPicklistValueChoice',
    'setFieldValidationRuleApplied',
    'resetTreeSelection',
    'openObjectRefresh',
    'startObjectRefresh',
    'cancelObjectRefresh',
    'applyObjectRefresh'
] as const;

export const RECIPE_COCKPIT_TREECIPE_ACTION_KINDS = [
    'addIterationFriend',
    'postAddFriendState',
    'wireLookups',
    'postWireLookupState',
    'addParentObject',
    'useOrgRecordForLookup',
    'removeTodo',
    'restoreTodo',
    'renameTree',
    'toggleFavoriteTree',
    'setObjectIncluded',
    'setFieldIncluded',
    'setAllFieldsIncluded',
    'setObjectCount',
    'setFieldFixedValue',
    'setPicklistValueChoice',
    'resetPicklistValueChoice',
    'setFieldValidationRuleApplied',
    'resetTreeSelection',
    'openObjectRefresh',
    'startObjectRefresh',
    'cancelObjectRefresh',
    'applyObjectRefresh',
    'refuseObjectRefresh'
] as const;

export type RecipeCockpitTreecipePanelAction =
    | { kind: 'addIterationFriend'; treeKey: string; objectApiName: string; iterationNickname: string; friendObjectApiName: string; recipeFilePath: string }
    | { kind: 'postAddFriendState'; hostMessage: IRecipeCockpitAddFriendStateMessage }
    | { kind: 'wireLookups'; treeKey: string; recipeFilePath: string; wirings: IRecipeCockpitLookupWiringViewModel[]; isWireAll: boolean }
    | { kind: 'postWireLookupState'; hostMessage: IRecipeCockpitWireLookupStateMessage }
    | { kind: 'addParentObject'; treeKey: string; recipeFilePath: string; addition: IRecipeCockpitAddableParentViewModel }
    | { kind: 'useOrgRecordForLookup'; treeKey: string; recipeFilePath: string; emptyLookup: IRecipeCockpitEmptyLookupViewModel }
    | { kind: 'removeTodo'; treeKey: string; recipeFilePath: string; lineNumber: number; todoText: string }
    | { kind: 'restoreTodo'; treeKey: string; recipeFilePath: string; removed: IRemovedTodoComment }
    | { kind: 'renameTree'; treeKey: string; folderName: string; name: string; renderSequence: number }
    | { kind: 'toggleFavoriteTree'; folderName: string }
    | { kind: 'setObjectIncluded'; treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }
    | { kind: 'setFieldIncluded'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; fieldApiName: string; isIncluded: boolean }
    | { kind: 'setAllFieldsIncluded'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; isIncluded: boolean; fieldScope?: typeof RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE }
    | { kind: 'resetTreeSelection'; folderName: string }
    | { kind: 'setObjectCount'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; count: number }
    | { kind: 'setFieldFixedValue'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; fieldApiName: string; value: string }
    | { kind: 'setPicklistValueChoice'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; fieldApiName: string; picklistValues: string[] }
    | { kind: 'resetPicklistValueChoice'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; fieldApiName: string }
    | { kind: 'setFieldValidationRuleApplied'; treeKey: string; folderName: string; objectApiName: string; nickname?: string; fieldApiName: string; isApplied: boolean }
    // "Get latest object detail from target org" (#612): THE ROW ON SCREEN, THEN ONLY THE OPEN DIALOG'S ID, KINDS AND ITEM INDEXES
    | { kind: 'openObjectRefresh'; treeKey: string; renderSequence: number; objectApiName: string; nickname?: string }
    | { kind: 'startObjectRefresh'; refreshId: string; kinds: ObjectRefreshKind[] }
    | { kind: 'cancelObjectRefresh'; refreshId: string }
    | { kind: 'applyObjectRefresh'; refreshId: string; itemIndexes: number[] }
    | { kind: 'refuseObjectRefresh'; refusalText: string; hostMessage?: IRecipeCockpitObjectRefreshStateMessage };

export class RecipeCockpitTreecipeHost {

    static isTreecipeCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_TREECIPE_COMMANDS.some(treecipeCommand => treecipeCommand === command);
    }

    static isTreecipePanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitTreecipePanelAction {
        return RECIPE_COCKPIT_TREECIPE_ACTION_KINDS.some(treecipeActionKind => treecipeActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: THE HUB'S CHECKS IT READS ARE FUNCTIONS OF THE STATE PASSED
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState,
                                hub: IRecipeCockpitHubForTreecipeTab): RecipeCockpitTreecipePanelAction | undefined {

        switch ( panelMessage.command ) {

            /*
                "+" on a self-lookup iteration posts four NAMES -- the card, the object, the
                iteration's nickname and the friend -- and the four together must be a target the
                confirmed-drawn model offered. The recipe file is the host's own, looked up by that
                key; nothing posted is read as a path or as recipe text.
            */
            case 'addIterationFriend': {

                const { treeKey, objectApiName, objectNickname, friendObjectApiName } = panelMessage;

                // ONE AT A TIME -- THE ONE IN FLIGHT ALREADY HOLDS EVERY "+" DISABLED, AND ITS OWN END RE-ENABLES THEM
                if ( panelState.addFriendStateMessage ) {
                    return undefined;
                }

                // A WIRING WRITES THE SAME FILE AND RELOADS IT, SO A "+" WAITS FOR IT
                if ( panelState.wireLookupStateMessage ) {
                    return { kind: 'postAddFriendState', hostMessage: { command: 'addFriendState', isRunning: false } };
                }

                const recipeFilePath = typeof treeKey === 'string'
                                        && typeof objectApiName === 'string'
                                        && typeof objectNickname === 'string'
                                        && typeof friendObjectApiName === 'string'
                                        && !!panelState.recipeDataMessage
                    ? panelState.insertableFriendTargets.get(hub.buildInsertableFriendKey(treeKey, objectApiName, objectNickname, friendObjectApiName))
                    : undefined;

                if ( recipeFilePath ) {
                    return {
                        kind: 'addIterationFriend',
                        treeKey: treeKey as string,
                        objectApiName: objectApiName as string,
                        iterationNickname: objectNickname as string,
                        friendObjectApiName: friendObjectApiName as string,
                        recipeFilePath: recipeFilePath
                    };
                }

                // THE PANEL DISABLED EVERY "+" ON THE CLICK, SO EVEN A REFUSAL ANSWERS THAT NOTHING RUNS
                return { kind: 'postAddFriendState', hostMessage: { command: 'addFriendState', isRunning: false } };

            }

            /*
                "Remove TODO" (#391) posts the card and the TODO's line: matched against the TODOs the
                confirmed-drawn model offered, its text and the recipe file the host's. "Restore" posts
                the card and the row's removalKey, which names an entry of the host's own list. Neither
                is read as a path or as recipe text. They share the one recipe write with a wiring.
            */
            case 'removeTodo':
            case 'restoreTodo': {

                const closeWireLookupState: RecipeCockpitPanelAction = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };

                if ( panelState.wireLookupStateMessage ) {
                    return undefined;
                }

                const treeKey = typeof panelMessage.treeKey === 'string' ? panelMessage.treeKey : '';
                const recipeDataMessage = panelState.recipeDataMessage;
                const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);
                const tree = recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === treeKey);

                if ( panelState.addFriendStateMessage || !recipeFilePath || !tree ) {
                    return closeWireLookupState;
                }

                if ( panelMessage.command === 'removeTodo' ) {
                    const lineNumber = panelMessage.lineNumber as number;
                    if ( !Number.isSafeInteger(lineNumber) || !panelState.treeHistoryAllowLists.removableTodoKeys.has(hub.buildTodoActionKey(treeKey, lineNumber)) ) {
                        return closeWireLookupState;
                    }
                    const treeTodo = hub.listTreeTodos(hub.buildObjectsByApiName(recipeDataMessage.recipe), tree, recipeFilePath)
                        .find(candidateTodo => candidateTodo.todo.lineNumber === lineNumber && candidateTodo.todo.removeLock === undefined);
                    return treeTodo && treeTodo.text !== ''
                        ? { kind: 'removeTodo', treeKey: treeKey, recipeFilePath: recipeFilePath, lineNumber: lineNumber, todoText: treeTodo.text }
                        : closeWireLookupState;
                }

                const { removalKey } = panelMessage;
                const removed = typeof removalKey === 'string' && /^(0|[1-9][0-9]*)$/.test(removalKey)
                                && panelState.treeHistoryAllowLists.restorableTodoKeys.has(hub.buildTodoActionKey(treeKey, removalKey))
                    ? panelState.removedTodosByTreeKey?.get(treeKey)?.[Number(removalKey)]
                    : undefined;

                return removed
                    ? { kind: 'restoreTodo', treeKey: treeKey, recipeFilePath: recipeFilePath, removed: removed }
                    : closeWireLookupState;

            }

            /*
                "Wire to…" posts four NAMES -- the card, the object, the occurrence's nickname when the
                row draws one, and the field -- matched against the lookups the confirmed-drawn model
                offered (#151). "Wire TODO lookups" posts the card alone, and wires every lookup of it
                with exactly ONE nickname to choose from. The nicknames, the recipe file and what is
                written are all the host's: nothing posted is read as a path, a nickname or recipe text.
            */
            case 'wireLookup':
            case 'wireAllLookups': {

                const closeWireLookupState: RecipeCockpitPanelAction = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };

                // ONE WRITE AT A TIME -- THE ONE IN FLIGHT HOLDS EVERY WIRE BUTTON DISABLED AND ITS OWN END GIVES THEM BACK
                if ( panelState.wireLookupStateMessage ) {
                    return undefined;
                }

                if ( panelState.addFriendStateMessage || !panelState.recipeDataMessage || typeof panelMessage.treeKey !== 'string' ) {
                    return closeWireLookupState;
                }

                const treeKey = panelMessage.treeKey;

                if ( panelMessage.command === 'wireAllLookups' ) {

                    const singleCandidateTargets = [...panelState.wireableLookupTargets.entries()]
                        .filter(([targetKey, target]) => targetKey.startsWith(`${treeKey}\n`) && target.wiring.candidateNicknames.length === 1)
                        .map(([, target]) => target);

                    // ONE CARD IS ONE RECIPE FILE, SO EVERY TARGET OF IT NAMES THE SAME ONE
                    return singleCandidateTargets.length > 0
                        ? { kind: 'wireLookups', treeKey: treeKey, recipeFilePath: singleCandidateTargets[0].recipeFilePath, wirings: singleCandidateTargets.map(target => target.wiring), isWireAll: true }
                        : closeWireLookupState;

                }

                const { objectApiName, objectNickname, fieldApiName } = panelMessage;
                const target = typeof objectApiName === 'string'
                                && ( objectNickname === undefined || typeof objectNickname === 'string' )
                                && typeof fieldApiName === 'string'
                    ? panelState.wireableLookupTargets.get(hub.buildWireableLookupKey(treeKey, objectApiName, objectNickname as string | undefined, fieldApiName))
                    : undefined;

                return target
                    ? { kind: 'wireLookups', treeKey: treeKey, recipeFilePath: target.recipeFilePath, wirings: [target.wiring], isWireAll: false }
                    : closeWireLookupState;

            }

            /*
                "Add <Parent> to recipe" (#294) posts the same four NAMES "Wire to…" does, matched
                against the additions the confirmed-drawn model offered. It writes the same file as a
                wiring and reloads it, so it shares that one-write lock and its wireLookupState. The
                parent, its template, the nickname and the recipe file are all the host's.
            */
            case 'addParentObject': {

                const closeWireLookupState: RecipeCockpitPanelAction = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };

                if ( panelState.wireLookupStateMessage ) {
                    return undefined;
                }

                const { treeKey, objectApiName, objectNickname, fieldApiName } = panelMessage;
                const target = !panelState.addFriendStateMessage
                                && !!panelState.recipeDataMessage
                                && typeof treeKey === 'string'
                                && typeof objectApiName === 'string'
                                && ( objectNickname === undefined || typeof objectNickname === 'string' )
                                && typeof fieldApiName === 'string'
                    ? panelState.addableParentTargets.get(hub.buildWireableLookupKey(treeKey, objectApiName, objectNickname as string | undefined, fieldApiName))
                    : undefined;

                return target
                    ? { kind: 'addParentObject', treeKey: treeKey as string, recipeFilePath: target.recipeFilePath, addition: target.addition }
                    : closeWireLookupState;

            }

            /*
                "Use existing <Parent> from org…" (#421) posts the same four NAMES, matched against the
                empty lookups the confirmed-drawn model draws it enabled on. The org, the record, the
                Id and the recipe file are all the host's; it writes the same file, so it shares the
                one-write lock and its wireLookupState.
            */
            case 'useOrgRecordForLookup': {

                const closeWireLookupState: RecipeCockpitPanelAction = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };

                if ( panelState.wireLookupStateMessage ) {
                    return undefined;
                }

                const { treeKey, objectApiName, objectNickname, fieldApiName } = panelMessage;
                const target = !panelState.addFriendStateMessage
                                && !!panelState.recipeDataMessage
                                && typeof treeKey === 'string'
                                && typeof objectApiName === 'string'
                                && ( objectNickname === undefined || typeof objectNickname === 'string' )
                                && typeof fieldApiName === 'string'
                    ? panelState.orgRecordLookupTargets.get(hub.buildWireableLookupKey(treeKey, objectApiName, objectNickname as string | undefined, fieldApiName))
                    : undefined;

                return target
                    ? { kind: 'useOrgRecordForLookup', treeKey: treeKey as string, recipeFilePath: target.recipeFilePath, emptyLookup: target.emptyLookup }
                    : closeWireLookupState;

            }

            /*
                ☆ posts the card's KEY, matched against the cards the confirmed-drawn model drew it
                on. A rename (#551) also posts the name typed in the card's inline box and the model
                it was typed over: the text is only bounded here, and checked by validateTreeName
                in the executor against the names stored when it runs.
            */
            case 'renameTree':
            case 'toggleFavoriteTree': {

                const { treeKey } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                const folderName = panelState.recipeDataMessage.recipe.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                if ( !folderName ) {
                    return undefined;
                }

                if ( panelMessage.command === 'toggleFavoriteTree' ) {
                    return { kind: 'toggleFavoriteTree', folderName: folderName };
                }

                const { name, renderSequence } = panelMessage;

                if ( typeof name !== 'string' || name.length > RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH
                        || renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return undefined;
                }

                return { kind: 'renameTree', treeKey: treeKey, folderName: folderName, name: name, renderSequence: renderSequence as number };

            }

            /*
                A tree icon (#219) posts NAMES only: the card, the object, and whether it should now
                be included. The pair must be one the confirmed-drawn model drew clickable; a nickname,
                when sent, must be the one that object is drawn with. What that excludes is computed
                by the host, never read from the message.
            */
            case 'setObjectIncluded': {

                const { treeKey, objectApiName, nickname, included } = panelMessage;

                if ( typeof treeKey !== 'string' || typeof objectApiName !== 'string' || typeof included !== 'boolean'
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(hub.buildSelectableObjectKey(treeKey, objectApiName)) ) {
                    return undefined;
                }

                const recipeViewModel = panelState.recipeDataMessage.recipe;
                const drawnNickname = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName)?.nickname;
                if ( nickname !== undefined && nickname !== drawnNickname ) {
                    return undefined;
                }

                const folderName = recipeViewModel.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                return folderName ? { kind: 'setObjectIncluded', treeKey: treeKey, folderName: folderName, objectApiName: objectApiName, isIncluded: included } : undefined;

            }

            /*
                A field checkbox (#220), the same shape plus the FIELD: the three names must be a key
                the confirmed-drawn model drew a checkbox for, so a field name is only ever matched,
                never written raw. Whether a lock refuses it is the host's to say, not the message's.
            */
            case 'setFieldIncluded': {

                const { treeKey, objectApiName, nickname, fieldApiName, included } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName) || typeof included !== 'boolean'
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                // THE OCCURRENCE THE ROW DRAWS (#467): ITS FIELD MUST HAVE A LINE THERE
                const drawnField = hub.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname, fieldApiName);
                const folderName = drawnField?.tree.folderName;

                return folderName
                    ? { kind: 'setFieldIncluded', treeKey: treeKey, folderName: folderName, objectApiName: objectApiName, ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(drawnField.occurrence), fieldApiName: fieldApiName, isIncluded: included }
                    : undefined;

            }

            // "All fields" OF ONE OBJECT (#410): THE OBJECT'S KEY, AS FOR ITS TREE ICON; WHICH FIELDS THAT TOUCHES IS THE HOST'S
            case 'setAllFieldsIncluded': {

                const { treeKey, objectApiName, nickname, included, fieldScope } = panelMessage;

                // "Standard fields" (#477) IS THE SAME BOX OVER THE STANDARD FIELDS ONLY; ANY OTHER SCOPE IS REFUSED
                if ( typeof treeKey !== 'string' || typeof objectApiName !== 'string' || typeof included !== 'boolean'
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || ( fieldScope !== undefined && fieldScope !== RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(hub.buildSelectableObjectKey(treeKey, objectApiName)) ) {
                    return undefined;
                }

                const resolved = hub.resolvePostedOccurrence(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname);
                const folderName = resolved?.tree.folderName;

                return folderName
                    ? {
                        kind: 'setAllFieldsIncluded', treeKey: treeKey, folderName: folderName, objectApiName: objectApiName, ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(resolved.occurrence), isIncluded: included,
                        ...( fieldScope === RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE ? { fieldScope: RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE } : {} )
                    }
                    : undefined;

            }

            /*
                A count box (#255): the object's key, as for its tree icon, and the count as a NUMBER
                -- the panel parsed what was typed, and the host holds it to the same rule again, so a
                forged string, fraction or count past what a number holds exactly writes nothing. An
                object drawn with no box (no readable "count:") or excluded is refused too.
            */
            case 'setObjectCount': {

                const { treeKey, objectApiName, nickname, count } = panelMessage;

                if ( typeof treeKey !== 'string' || typeof objectApiName !== 'string' || !RecipeCockpitRecipeWriter.isRecordCount(count)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(hub.buildSelectableObjectKey(treeKey, objectApiName)) ) {
                    return undefined;
                }

                // THE OCCURRENCE'S OWN "count:" (#467): A LATER ONE'S IS ITS OWN, NEVER THE FIRST'S
                const resolved = hub.resolvePostedOccurrence(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname);
                const tree = resolved?.tree;
                if ( !resolved || resolved.occurrence.objectViewModel.recordCount === undefined
                        || !tree?.folderName || hub.listExcludedObjectApiNames(tree).includes(objectApiName) ) {
                    return undefined;
                }

                return { kind: 'setObjectCount', treeKey: treeKey, folderName: tree.folderName, objectApiName: objectApiName, ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(resolved.occurrence), count: count };

            }

            /*
                A field's pin (#262), saved from its inline editor (#337): the same three names as its
                checkbox, matched against the same allow-list, and the value AS TYPED -- a string no
                longer than any fixed value can be, '' clearing it. Only its shape is checked here; the
                host checks the value itself against the field before anything is written. A field a
                lock holds back (#220's, RecordTypeId, a dependent picklist, an unticked field or an
                excluded object's) is refused here and again before anything is written. A lookup is
                routed (#627): the executor's findLookupValueRefusal holds its value to a record Id.
            */
            case 'setFieldFixedValue': {

                const { treeKey, objectApiName, nickname, fieldApiName, value } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || typeof value !== 'string' || value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const drawnField = hub.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname, fieldApiName);

                if ( !drawnField || !drawnField.tree.folderName
                        || hub.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return { kind: 'setFieldFixedValue', treeKey: treeKey, folderName: drawnField.tree.folderName, objectApiName: objectApiName, ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(drawnField.occurrence), fieldApiName: fieldApiName, value: value };

            }

            /*
                A picklist's value tiles (#465): the edit button's names and the values ticked. Each
                value must be one the host holds for the field's default choice, once, and the field
                must take an edit -- the same lock as the one-box editor's. The values come back in
                the field's own order, so a choice builds one expression whatever order it was ticked in.
            */
            case 'setPicklistValueChoice': {

                const { treeKey, objectApiName, nickname, fieldApiName, picklistValues } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !Array.isArray(picklistValues) || picklistValues.length === 0
                        || !picklistValues.every(picklistValue => typeof picklistValue === 'string')
                        || new Set(picklistValues).size !== picklistValues.length
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const declaredPicklistValues = panelState.picklistDisplayValuesByObjectApiName.get(objectApiName)?.get(fieldApiName)?.picklistValues;
                const drawnField = hub.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname, fieldApiName);

                if ( !declaredPicklistValues || !picklistValues.every(picklistValue => declaredPicklistValues.includes(picklistValue))
                        || !drawnField || !drawnField.fieldViewModel.isPicklist || !drawnField.tree.folderName
                        || hub.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return {
                    kind: 'setPicklistValueChoice',
                    treeKey: treeKey,
                    folderName: drawnField.tree.folderName,
                    objectApiName: objectApiName,
                    ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(drawnField.occurrence),
                    fieldApiName: fieldApiName,
                    picklistValues: declaredPicklistValues.filter(declaredValue => picklistValues.includes(declaredValue))
                };

            }

            /*
                A picklist's Reset to generated (#479): the value tiles' names only, held to the same
                drawn, free picklist a choice is. What it clears is the host's to find.
            */
            case 'resetPicklistValueChoice': {

                const { treeKey, objectApiName, nickname, fieldApiName } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const drawnField = hub.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname, fieldApiName);
                if ( !drawnField || !drawnField.fieldViewModel.isPicklist || !drawnField.tree.folderName
                        || hub.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return {
                    kind: 'resetPicklistValueChoice',
                    treeKey: treeKey,
                    folderName: drawnField.tree.folderName,
                    objectApiName: objectApiName,
                    ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(drawnField.occurrence),
                    fieldApiName: fieldApiName
                };

            }

            /*
                A field's validation-rule checkbox (#325): the same three names as its other controls,
                matched against the same allow-list, and whether the rules should apply. A field with
                no applied rule, or one a lock holds back, writes nothing.
            */
            case 'setFieldValidationRuleApplied': {

                const { treeKey, objectApiName, nickname, fieldApiName, applied } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || typeof applied !== 'boolean'
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(hub.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const drawnField = hub.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, nickname, fieldApiName);

                if ( !drawnField || !drawnField.tree.folderName
                        || hub.findValidationRuleLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return { kind: 'setFieldValidationRuleApplied', treeKey: treeKey, folderName: drawnField.tree.folderName, objectApiName: objectApiName, ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(drawnField.occurrence), fieldApiName: fieldApiName, isApplied: applied };

            }

            // A CARD'S Reset selection POSTS ITS KEY ALONE, FROM A CARD WITH A FOLDER -- THE SAME CARDS ✎ AND ☆ ARE DRAWN ON
            case 'resetTreeSelection': {

                const { treeKey } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                const folderName = panelState.recipeDataMessage.recipe.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                return folderName ? { kind: 'resetTreeSelection', folderName: folderName } : undefined;

            }

            /*
                "Get latest object detail from target org" (#612). Open: a row the model on screen
                draws on a card with a folder, never an iteration. Every later message names only
                the open dialog's id -- with the kinds from the fixed list, or the indexes of the
                items it was shown -- never an object, a path, an org or a value.
            */
            case 'openObjectRefresh': {

                const { treeKey, renderSequence, objectApiName, nickname } = panelMessage;
                const runningState = panelState.objectRefreshSession?.stateMessage;

                if ( runningState && ( runningState.step === 'retrieving' || runningState.step === 'applying' || runningState.step === 'confirming' ) ) {
                    return { kind: 'refuseObjectRefresh', refusalText: RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL, hostMessage: runningState };
                }

                const recipeDataMessage = panelState.recipeDataMessage;
                const resolved = typeof treeKey === 'string' && typeof objectApiName === 'string'
                    ? hub.resolvePostedOccurrence(recipeDataMessage?.recipe, treeKey, objectApiName, nickname)
                    : undefined;

                if ( !resolved
                        || !recipeDataMessage
                        || renderSequence !== recipeDataMessage.renderSequence
                        || !resolved.tree.folderName
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(resolved.tree.treeKey)
                        || resolved.occurrence.objectViewModel.isIterationOccurrence
                        || !SalesforceApiName.isApiName(resolved.occurrence.objectApiName) ) {
                    return undefined;
                }

                return {
                    kind: 'openObjectRefresh',
                    treeKey: resolved.tree.treeKey,
                    renderSequence: recipeDataMessage.renderSequence,
                    objectApiName: resolved.occurrence.objectApiName,
                    ...RecipeCockpitTreecipeSelection.withOccurrenceNickname(resolved.occurrence)
                };

            }

            case 'startObjectRefresh': {

                const session = RecipeCockpitTreecipeObjectRefresh.findOpenObjectRefreshSession(panelState, panelMessage.refreshId, 'choose');
                const postedKinds: unknown = panelMessage.kinds;

                if ( !session || !Array.isArray(postedKinds) || postedKinds.length === 0 || !postedKinds.every(postedKind => RecipeCockpitObjectRefresh.isKind(postedKind)) ) {
                    return undefined;
                }

                const busyRefusal = RecipeCockpitTreecipeObjectRefresh.findObjectRefreshBusyRefusal(hub, panelState, RECIPE_COCKPIT_OBJECT_REFRESH_BUSY_REFUSAL);
                if ( busyRefusal ) {
                    return { kind: 'refuseObjectRefresh', refusalText: busyRefusal, hostMessage: session.stateMessage };
                }

                return { kind: 'startObjectRefresh', refreshId: session.stateMessage.refreshId, kinds: OBJECT_REFRESH_KINDS.filter(kind => ( postedKinds as unknown[] ).includes(kind)) };

            }

            case 'cancelObjectRefresh': {

                const session = panelState.objectRefreshSession;

                return session && panelMessage.refreshId === session.stateMessage.refreshId && session.stateMessage.step !== 'applying'
                    ? { kind: 'cancelObjectRefresh', refreshId: session.stateMessage.refreshId }
                    : undefined;

            }

            case 'applyObjectRefresh': {

                const session = RecipeCockpitTreecipeObjectRefresh.findOpenObjectRefreshSession(panelState, panelMessage.refreshId, 'review');
                const postedIndexes: unknown = panelMessage.itemIndexes;
                const itemCount = session?.plannedItems?.length ?? 0;

                if ( !session
                        || !Array.isArray(postedIndexes)
                        || postedIndexes.length === 0
                        || !postedIndexes.every(itemIndex => Number.isSafeInteger(itemIndex) && itemIndex >= 0 && itemIndex < itemCount)
                        || new Set(postedIndexes).size !== postedIndexes.length ) {
                    return undefined;
                }

                const busyRefusal = RecipeCockpitTreecipeObjectRefresh.findObjectRefreshBusyRefusal(hub, panelState, RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_BUSY_REFUSAL);
                if ( busyRefusal ) {
                    return { kind: 'refuseObjectRefresh', refusalText: busyRefusal, hostMessage: { ...session.stateMessage, tickedItemIndexes: [...postedIndexes as number[]] } };
                }

                return { kind: 'applyObjectRefresh', refreshId: session.stateMessage.refreshId, itemIndexes: [...postedIndexes as number[]].sort((first, second) => first - second) };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitTreecipePanelAction) {

        const panelState = hub.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'addIterationFriend':

                await RecipeCockpitTreecipeRecipeEdits.addFriendToIteration(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'postAddFriendState':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'wireLookups':

                await RecipeCockpitTreecipeRecipeEdits.wireLookupsFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'postWireLookupState':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'addParentObject':

                await RecipeCockpitTreecipeRecipeEdits.addParentObjectFromPanel(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'useOrgRecordForLookup':

                await RecipeCockpitTreecipeRecipeEdits.runRecipeLookupWrite(hub, cockpitPanel, panelState, panelAction.treeKey,
                    (tree, objectLevelsByApiName) => RecipeCockpitTreecipeRecipeEdits.writeOrgRecordLookup(hub, panelAction, tree, objectLevelsByApiName, panelState));
                return;

            case 'removeTodo':

                await RecipeCockpitTreecipeRecipeEdits.runRecipeLookupWrite(hub, cockpitPanel, panelState, panelAction.treeKey,
                    () => RecipeCockpitTreecipeRecipeEdits.writeTodoRemoval(hub, panelAction, panelState.workspaceRoot),
                    { tab: 'troubleshooting', troubleshootingSubTab: 'todos', todosView: 'open' });
                return;

            case 'restoreTodo':

                await RecipeCockpitTreecipeRecipeEdits.runRecipeLookupWrite(hub, cockpitPanel, panelState, panelAction.treeKey,
                    () => RecipeCockpitTreecipeRecipeEdits.writeTodoRestore(hub, panelAction, panelState.workspaceRoot),
                    { tab: 'troubleshooting', troubleshootingSubTab: 'todos', todosView: 'removed' });
                return;

            case 'renameTree':

                await this.renameTree(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setObjectIncluded':

                await RecipeCockpitTreecipeSelection.setObjectIncluded(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setFieldIncluded':

                await RecipeCockpitTreecipeSelection.setFieldIncluded(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setAllFieldsIncluded':

                await RecipeCockpitTreecipeSelection.setAllFieldsIncluded(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'resetTreeSelection':

                await RecipeCockpitTreecipeSelection.resetTreeSelection(hub, cockpitPanel, panelState, panelAction.folderName);
                return;

            case 'setObjectCount':

                await RecipeCockpitTreecipeSelection.setObjectCount(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setFieldFixedValue':

                await RecipeCockpitTreecipeSelection.setFieldFixedValue(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setPicklistValueChoice':

                await RecipeCockpitTreecipeSelection.setPicklistValueChoice(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'resetPicklistValueChoice':

                await RecipeCockpitTreecipeSelection.resetPicklistValueChoice(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'setFieldValidationRuleApplied':

                await RecipeCockpitTreecipeSelection.setFieldValidationRuleApplied(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'toggleFavoriteTree': {

                const treePreferences = hub.readTreePreferences(hub.recipeCockpitWorkspaceState);

                if ( treePreferences.favoriteFolderNames.has(panelAction.folderName) ) {
                    treePreferences.favoriteFolderNames.delete(panelAction.folderName);
                } else {
                    treePreferences.favoriteFolderNames.add(panelAction.folderName);
                }

                await this.saveAndPostTreePreferences(hub, cockpitPanel, panelState, panelAction.folderName, treePreferences);
                return;

            }

            case 'openObjectRefresh':

                RecipeCockpitTreecipeObjectRefresh.openObjectRefresh(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'startObjectRefresh':

                await RecipeCockpitTreecipeObjectRefresh.startObjectRefresh(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'cancelObjectRefresh':

                RecipeCockpitTreecipeObjectRefresh.cancelObjectRefresh(hub, cockpitPanel, panelState);
                return;

            case 'applyObjectRefresh':

                await RecipeCockpitTreecipeObjectRefresh.applyObjectRefresh(hub, cockpitPanel, panelState, panelAction);
                return;

            case 'refuseObjectRefresh':

                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                if ( panelAction.hostMessage ) {
                    hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                }
                return;

        }

    }

    /*
        What the input box says is wrong with a name, or undefined when it can be saved. An empty
        name is valid: it clears the card's own name. A name is unique against every OTHER folder's
        name in the workspace and every other card's title on screen, compared trimmed and without
        case, because two cards a reader cannot tell apart are what a name exists to prevent.
    */
    static validateTreeName(hub: IRecipeCockpitHubForTreecipeTab, candidateName: string,
                                folderName: string,
                                treePreferences: IRecipeCockpitTreePreferences,
                                trees: IRecipeCockpitTreeViewModel[]): string | undefined {

        const trimmedName = candidateName.trim();

        if ( trimmedName === '' ) {
            return undefined;
        }

        const namingProblem = hub.describeTreeNameProblem(trimmedName);

        if ( namingProblem ) {
            return namingProblem;
        }

        const comparableName = trimmedName.toLowerCase();
        const otherNames: string[] = [];

        treePreferences.customNamesByFolderName.forEach((customName, namedFolderName) => {
            if ( namedFolderName !== folderName ) { otherNames.push(customName); }
        });

        trees
            .filter(tree => tree.folderName !== folderName)
            .forEach(tree => otherNames.push(tree.title, tree.customName ?? ''));

        return otherNames.some(otherName => otherName.trim().toLowerCase() === comparableName)
            ? 'Another tree already has that name.'
            : undefined;

    }

    static buildTreePreferencesMessage(trees: IRecipeCockpitTreeViewModel[], folderName: string, renderSequence: number): IRecipeCockpitTreePreferencesMessage {

        return {
            command: 'treePreferences',
            renderSequence: renderSequence,
            trees: trees
                .filter(tree => tree.folderName === folderName)
                .map(tree => ({
                    treeKey: tree.treeKey,
                    ...( tree.customName !== undefined ? { customName: tree.customName } : {} ),
                    isFavorite: tree.isFavorite === true
                }))
        };

    }

    /*
        The name is typed in the card's own inline box (#551) and checked here on the preferences as
        they are NOW, because another window of the same workspace can have named a tree since the
        panel drew its names. Every ending answers nameEditResult, so the box closes or says why not.
    */
    private static async renameTree(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                    panelState: IRecipeCockpitPanelState,
                                    renameAction: Extract<RecipeCockpitPanelAction, { kind: 'renameTree' }>) {

        const { treeKey, folderName, name, renderSequence } = renameAction;
        const treePreferences = hub.readTreePreferences(hub.recipeCockpitWorkspaceState);
        const namingProblem = this.validateTreeName(hub, name, folderName, treePreferences, panelState.recipeDataMessage?.recipe.trees ?? []);

        if ( namingProblem ) {
            hub.postNameEditResult(cockpitPanel, panelState, { nameTarget: 'tree', nameKey: treeKey, name: name, renderSequence: renderSequence }, namingProblem);
            return;
        }

        const trimmedName = name.trim();

        // THE FOLDER NAME IS ALREADY THE DEFAULT TITLE (#389), SO NAMING A TREE AFTER ITS OWN FOLDER CLEARS ITS NAME
        if ( trimmedName === '' || trimmedName === folderName ) {
            treePreferences.customNamesByFolderName.delete(folderName);
        } else {
            treePreferences.customNamesByFolderName.set(folderName, trimmedName);
        }

        const isWritten = await this.saveAndPostTreePreferences(hub, cockpitPanel, panelState, folderName, treePreferences);

        hub.postNameEditResult(cockpitPanel, panelState, { nameTarget: 'tree', nameKey: treeKey, name: name, renderSequence: renderSequence }, isWritten ? undefined : RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL);

    }

    /*
        Written, then put on the stored model -- which every reveal replays -- and posted for the
        cards of that folder only. The update carries the model's renderSequence: a panel that has
        since drawn another model drops it, and that model was built from what was just written.
    */
    private static async saveAndPostTreePreferences(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        folderName: string,
                                                        treePreferences: IRecipeCockpitTreePreferences): Promise<boolean> {

        const isWritten = await hub.writeTreePreferences(hub.recipeCockpitWorkspaceState, treePreferences);

        if ( !isWritten || hub.recipeCockpitPanel !== cockpitPanel || hub.recipeCockpitPanelState !== panelState || !panelState.recipeDataMessage ) {
            return isWritten;
        }

        const recipeDataMessage = panelState.recipeDataMessage;
        hub.applyTreePreferences(recipeDataMessage.recipe.trees, treePreferences);

        hub.postToPanel(cockpitPanel, this.buildTreePreferencesMessage(recipeDataMessage.recipe.trees, folderName, recipeDataMessage.renderSequence));

        return true;

    }

}
