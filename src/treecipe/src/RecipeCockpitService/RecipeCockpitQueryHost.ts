import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';

import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import {
    IRecipeCockpitRunArtifactsLocation,
    RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME,
    RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE,
    RecipeCockpitRunArtifacts
} from '../RunArtifacts/RecipeCockpitRunArtifacts';
import { IAuthenticatedOrgDetail } from '../SalesforceCli/SalesforceCli';
import { SalesforceOrgService } from '../SalesforceOrgService/SalesforceOrgService';
import {
    ISOQLTreeQuery,
    SOQL_QUERY_KIND_LABELS,
    SOQLQueryKind,
    SOQLTemplateService
} from '../SOQLTemplateService/SOQLTemplateService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    IRecipeCockpitPreviewRecordLinks,
    RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE,
    RECIPE_COCKPIT_QUERY_EXPORT_FORMATS,
    RECIPE_COCKPIT_QUERY_MAX_LENGTH,
    RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT,
    RECIPE_COCKPIT_QUERY_RECORD_CAP,
    RECIPE_COCKPIT_QUERY_VALUE_BUDGET,
    RecipeCockpitQuery,
    RecipeCockpitQueryExportFormat
} from './RecipeCockpitQuery';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER RUNS THE HUB'S CODE BUT THROUGH IRecipeCockpitHubForQueryTab
import type {
    IRecipeCockpitOpenableRecordPreview,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitWorkspaceState,
    RecipeCockpitHostMessage
} from './RecipeCockpitService';

/*
    The Query tab's host half (#367, moved out of the hub by #665): the messages it answers, the
    actions they route to, and everything a run, an edit and an export read and hold. The hub owns
    the panel, its state and every allow-list; it hands this host each Query command and action
    kind, and the few things the tab needs from it through IRecipeCockpitHubForQueryTab.
*/

/*
    The Query tab (#367): one tree's generated queries, read from the run's objects wrapper when the
    tab is opened, each with the reader's saved edit when there is one. renderSequence names the
    model they were read for, and the panel drops them for any other. failureMessage is set, and
    queries empty, when the wrapper could not be read.
*/
export interface IRecipeCockpitTreeQueryViewModel {
    queryKey: string;
    objectApiName: string;
    kindLabel: string;
    notes: string[];
    generatedText: string;
    editedText?: string;
}

/*
    One saved edit (#367), with the text Generate Treecipe wrote for that query when it was saved.
    A query key is a position (<object>:<kind>:<index>), so a regeneration that adds or drops a
    lookup or a record type can give the key to another query; an edit is drawn only while its
    query still generates the text it was made from.
*/
export interface IRecipeCockpitQueryEdit {
    generatedText: string;
    editedText: string;
}

export interface IRecipeCockpitTreeQueriesMessage {
    command: 'treeQueries';
    renderSequence: number;
    treeKey: string;
    queries: IRecipeCockpitTreeQueryViewModel[];
    failureMessage?: string;
}

/*
    One query run per window (#367): while isRunning, every Run button is disabled. treeKey and
    queryKey name the button clicked. How the run went is a VS Code notification. Stored and replayed.
*/
export interface IRecipeCockpitTreeQueryStateMessage {
    command: 'treeQueryState';
    isRunning: boolean;
    treeKey: string;
    queryKey: string;
}

/*
    A run's PREVIEW (#367): the first rows as text, never the whole result, which the host holds for
    the export. renderSequence names the model it was run on; the panel draws it only on that model.
*/
export interface IRecipeCockpitTreeQueryResultMessage {
    command: 'treeQueryResult';
    renderSequence: number;
    treeKey: string;
    queryKey: string;
    orgLabel: string;
    totalSize: number;
    recordCount: number;
    isTruncated: boolean;
    columns: string[];
    rows: string[][];
    hiddenColumnCount: number;
    // THE ROWS WHOSE Id OPENS THE RECORD (#556), AND THE SEQUENCE A CLICK AND THE PANEL'S ACK NAME THEM BY; ABSENT WHEN NO ROW HAS ONE
    recordLinkSequence?: number;
    recordLinks?: IRecipeCockpitPreviewRecordLinks;
}

export const RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER = 'Select the org to run the query against; it becomes the Target Org Manager selection';

export const RECIPE_COCKPIT_QUERY_BUSY_REFUSAL = 'The query was not run: another run is using the org selection. Choose an org in Target Org Manager, or try again when it ends.';

export const RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL = 'Open file';

export const RECIPE_COCKPIT_QUERY_NOT_GIT_IGNORED_NOTE = RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE;

// THE READER'S EDITS OF A TREE'S QUERIES (#367), BY TREE FOLDER, THEN QUERY KEY
export const RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY = 'treecipe.recipeCockpit.queryEdits';

export const RECIPE_COCKPIT_QUERY_EDITS_VERSION = 1;

// HOW MANY TREES' QUERY LISTS THE HOST KEEPS BEFORE IT STARTS AGAIN
export const RECIPE_COCKPIT_QUERY_LIST_CACHE_LIMIT = 50;

// THE LONGEST QUERY KEY A MESSAGE MAY CARRY: <object api name, at most 80>:<kind>:<index>
const RECIPE_COCKPIT_QUERY_KEY_MAX_LENGTH = 200;

// THE MOST FOLDERS, AND QUERIES PER FOLDER, AN EDIT STORE IS READ FOR, AND THE LONGEST FOLDER NAME IT KEEPS
const RECIPE_COCKPIT_QUERY_EDITS_MAX_ENTRIES = 10000;
const RECIPE_COCKPIT_QUERY_EDITS_FOLDER_NAME_MAX_LENGTH = 1000;

// WHAT THE QUERY TAB READS AND CALLS ON THE HUB, AND NOTHING ELSE; THE HUB BUILDS IT AND PASSES IT WITH EACH ACTION
export interface IRecipeCockpitHubForQueryTab {
    // THE PANEL AND STATE OPEN NOW: A RUN THAT AWAITED ASKS AGAIN, SINCE A RELOAD OR CLOSE REPLACES THEM
    currentPanel(): vscode.WebviewPanel | undefined;
    currentPanelState(): IRecipeCockpitPanelState;
    workspaceState(): IRecipeCockpitWorkspaceState | undefined;
    postToPanel(cockpitPanel: vscode.WebviewPanel, hostMessage: RecipeCockpitHostMessage): void;
    registerRecordLinkPreview(panelState: IRecipeCockpitPanelState,
                              previewDetail: Omit<IRecipeCockpitOpenableRecordPreview, 'recordLinkSequence' | 'heldSourceToken'> & { heldSource: object }): number | undefined;
    resolveSelectedReadOrg(cockpitPanel: vscode.WebviewPanel,
                           panelState: IRecipeCockpitPanelState,
                           refusalPrefix: string,
                           placeholder: string,
                           busyRefusal: string,
                           connectionFailedAdvice: string,
                           promptFlag: 'isQueryOrgPromptOpen'): Promise<IAuthenticatedOrgDetail | undefined>;
    resolveTreeRunArtifactsLocation(workspaceRoot: string,
                                    recipeViewModel: Pick<IRecipeCockpitRecipeViewModel, 'selectedRunFolderName'>,
                                    tree: Pick<IRecipeCockpitTreeViewModel, 'folderName'>): IRecipeCockpitRunArtifactsLocation | undefined;
}

// THE PANEL COMMANDS AND ACTION KINDS THIS HOST OWNS: THE HUB HANDS EACH ONE HERE, AND NO OTHER FILE HAS A case FOR IT
export const RECIPE_COCKPIT_QUERY_COMMANDS = ['loadTreeQueries', 'saveTreeQueryEdit', 'runTreeQuery', 'exportTreeQueryResult'] as const;

export const RECIPE_COCKPIT_QUERY_ACTION_KINDS = ['loadTreeQueries', 'saveTreeQueryEdit', 'runTreeQuery', 'postTreeQueryState', 'exportTreeQueryResult'] as const;

export type RecipeCockpitQueryPanelAction =
    | { kind: 'loadTreeQueries'; treeKey: string; renderSequence: number }
    | { kind: 'saveTreeQueryEdit'; treeKey: string; queryKey: string; queryText: string }
    | { kind: 'runTreeQuery'; treeKey: string; queryKey: string; queryText: string }
    | { kind: 'postTreeQueryState'; hostMessage: IRecipeCockpitTreeQueryStateMessage }
    | { kind: 'exportTreeQueryResult'; treeKey: string; queryKey: string; exportFormat: RecipeCockpitQueryExportFormat };

export class RecipeCockpitQueryHost {

    static isQueryCommand(command: unknown): boolean {
        return RECIPE_COCKPIT_QUERY_COMMANDS.some(queryCommand => queryCommand === command);
    }

    static isQueryPanelAction(panelAction: { kind: string }): panelAction is RecipeCockpitQueryPanelAction {
        return RECIPE_COCKPIT_QUERY_ACTION_KINDS.some(queryActionKind => queryActionKind === panelAction.kind);
    }

    // PURE, LIKE THE HUB'S ROUTER IT IS PART OF: A MESSAGE THAT NAMES NOTHING THE RENDERED MODEL DID IS ANSWERED WITH NOTHING
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage,
                                panelState: IRecipeCockpitPanelState): RecipeCockpitQueryPanelAction | undefined {

        switch ( panelMessage.command ) {

            /*
                The Query tab (#367) posts the tree's KEY, a query KEY and, to save or run, the
                reader's text: never an org, a path or an object. The key must be a card with a
                folder the panel confirmed drawing; the host matches the query key against the
                queries it read for that tree, and holds the text to one SELECT before it is sent.
                A query only reads, and its org is the Target Org Manager selection the host reads
                at the run (#439), so nothing else running holds it at the router.
            */
            case 'loadTreeQueries': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadTreeQueries', treeKey: treeKey, renderSequence: renderSequence as number };

            }

            case 'saveTreeQueryEdit': {

                const { treeKey, queryKey, queryText } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !this.isQueryKeyShaped(queryKey)
                        || typeof queryText !== 'string'
                        || queryText.length > RECIPE_COCKPIT_QUERY_MAX_LENGTH
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'saveTreeQueryEdit', treeKey: treeKey, queryKey: queryKey, queryText: queryText };

            }

            case 'runTreeQuery': {

                const { treeKey, queryKey, queryText } = panelMessage;

                // A RELOADED DOCUMENT MAY NOT KNOW A QUERY IS RUNNING: IT IS TOLD, AND THE RUN'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.treeQueryStateMessage?.isRunning ) {
                    return { kind: 'postTreeQueryState', hostMessage: panelState.treeQueryStateMessage };
                }

                if ( typeof treeKey !== 'string'
                        || !this.isQueryKeyShaped(queryKey)
                        || typeof queryText !== 'string'
                        || queryText.length > RECIPE_COCKPIT_QUERY_MAX_LENGTH
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return {
                        kind: 'postTreeQueryState',
                        hostMessage: { command: 'treeQueryState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', queryKey: typeof queryKey === 'string' ? queryKey : '' }
                    };
                }

                return { kind: 'runTreeQuery', treeKey: treeKey, queryKey: queryKey, queryText: queryText };

            }

            case 'exportTreeQueryResult': {

                const { treeKey, queryKey, exportFormat } = panelMessage;
                const matchedFormat = RECIPE_COCKPIT_QUERY_EXPORT_FORMATS.find(candidateFormat => candidateFormat === exportFormat);

                if ( typeof treeKey !== 'string'
                        || !this.isQueryKeyShaped(queryKey)
                        || !matchedFormat
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'exportTreeQueryResult', treeKey: treeKey, queryKey: queryKey, exportFormat: matchedFormat };

            }

        }

        return undefined;

    }

    static async executePanelAction(hub: IRecipeCockpitHubForQueryTab, cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitQueryPanelAction) {

        switch ( panelAction.kind ) {

            case 'loadTreeQueries':

                this.postTreeQueries(hub, cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'saveTreeQueryEdit':

                await this.saveTreeQueryEdit(hub, panelAction.treeKey, panelAction.queryKey, panelAction.queryText);
                return;

            case 'runTreeQuery':

                await this.runTreeQueryFromPanel(hub, cockpitPanel, panelAction.treeKey, panelAction.queryKey, panelAction.queryText);
                return;

            case 'postTreeQueryState':

                hub.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'exportTreeQueryResult':

                this.exportTreeQueryResult(hub, panelAction.treeKey, panelAction.queryKey, panelAction.exportFormat);
                return;

        }

    }

    // THE RUN STATE AND LAST PREVIEW A RELOADED DOCUMENT IS SENT AGAIN, IN THE ORDER THE HUB REPLAYS THEM
    static buildReplayMessages(panelState: IRecipeCockpitPanelState): RecipeCockpitHostMessage[] {

        const replayMessages: RecipeCockpitHostMessage[] = [];

        if ( panelState.treeQueryStateMessage ) {
            replayMessages.push(panelState.treeQueryStateMessage);
        }

        if ( panelState.treeQueryResultMessage && panelState.treeQueryResultMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.treeQueryResultMessage);
        }

        return replayMessages;

    }

    // THE RESULT AN OPEN RECORD LINK FROM A QUERY PREVIEW STILL NEEDS HELD (#556)
    static heldResultForRecordLinks(): object | undefined {
        return this.heldTreeQueryResult;
    }

    static isQueryKeyShaped(queryKey: unknown): queryKey is string {

        return typeof queryKey === 'string' && queryKey !== '' && queryKey.length <= RECIPE_COCKPIT_QUERY_KEY_MAX_LENGTH;

    }

    /*
        A tree's queries (#367), read from the objects wrapper of the run on screen and kept per
        model and tree: the tab asks each time it is selected, and a run, an edit or an export
        matches its query key against this list, never a list the panel sent. A wrapper that cannot
        be read is the tab's message, never a failure of the cockpit.
    */
    private static treeQueryLists = new Map<string, ISOQLTreeQuery[]>();

    // THE WRAPPER READ AGAIN FOR THE QUERY TAB, ONCE PER MODEL RATHER THAN ONCE PER TREE: 120,000 FIELDS TOOK ~650 MS TO READ
    private static queryObjectsWrapperRead: { modelKey: string; objectsWrapper: ObjectInfoWrapper } | undefined;

    static clearTreeQueryLists() {
        this.treeQueryLists.clear();
        this.queryObjectsWrapperRead = undefined;
    }

    private static readTreeQueries(hub: IRecipeCockpitHubForQueryTab, treeKey: string): { renderSequence: number; folderName: string; queries?: ISOQLTreeQuery[]; failureMessage?: string } | undefined {

        const panelState = hub.currentPanelState();
        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeDataMessage || !tree?.folderName ) {
            return undefined;
        }

        const listKey = JSON.stringify([panelState.workspaceRoot, recipeDataMessage.renderSequence, treeKey]);
        const listedQueries = this.treeQueryLists.get(listKey);

        const treeRead = { renderSequence: recipeDataMessage.renderSequence, folderName: tree.folderName };

        if ( listedQueries ) {
            return { ...treeRead, queries: listedQueries };
        }

        // A MODEL IS ONLY EVER BUILT FROM A WRAPPER IT READ, SO A PATH IS THERE; WHAT CAN FAIL IS READING IT AGAIN
        const objectsWrapperFilePath = panelState.objectsWrapperFilePath ?? '';
        const modelKey = JSON.stringify([panelState.workspaceRoot, recipeDataMessage.renderSequence, objectsWrapperFilePath]);

        if ( this.queryObjectsWrapperRead?.modelKey !== modelKey ) {
            try {
                this.queryObjectsWrapperRead = {
                    modelKey: modelKey,
                    objectsWrapper: RecipeCockpitQuery.toQueryObjectsWrapper(JSON.parse(fs.readFileSync(objectsWrapperFilePath, 'utf-8')))
                };
            } catch (readError) {
                return { ...treeRead, failureMessage: `The objects wrapper "${path.basename(objectsWrapperFilePath)}" could not be read again: ${this.describeThrown(readError)} Run "Generate Treecipe" again.` };
            }
        }

        const treeQueries = SOQLTemplateService.listTreeQueries(this.queryObjectsWrapperRead.objectsWrapper, tree.objects.map(treeObject => treeObject.objectApiName));

        if ( this.treeQueryLists.size >= RECIPE_COCKPIT_QUERY_LIST_CACHE_LIMIT ) {
            this.treeQueryLists.clear();
        }
        this.treeQueryLists.set(listKey, treeQueries);

        return { ...treeRead, queries: treeQueries };

    }

    private static postTreeQueries(hub: IRecipeCockpitHubForQueryTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const treeQueryRead = this.readTreeQueries(hub, treeKey);

        if ( !treeQueryRead ) {
            return;
        }

        const queriesMessage: IRecipeCockpitTreeQueriesMessage = { command: 'treeQueries', renderSequence: renderSequence, treeKey: treeKey, queries: [] };

        if ( !treeQueryRead.queries ) {
            queriesMessage.failureMessage = treeQueryRead.failureMessage;
        } else {
            const folderEdits = this.readQueryEdits(hub.workspaceState()).get(treeQueryRead.folderName);
            queriesMessage.queries = treeQueryRead.queries.map(treeQuery => {
                const queryEdit = folderEdits?.get(treeQuery.queryKey);
                const editedText = queryEdit?.generatedText === treeQuery.text ? queryEdit.editedText : undefined;
                return {
                    queryKey: treeQuery.queryKey,
                    objectApiName: treeQuery.objectApiName,
                    kindLabel: SOQL_QUERY_KIND_LABELS[treeQuery.kind],
                    notes: treeQuery.notes,
                    generatedText: treeQuery.text,
                    ...( editedText !== undefined && editedText !== treeQuery.text ? { editedText: editedText } : {} )
                };
            });
        }

        if ( hub.currentPanel() === cockpitPanel && hub.currentPanelState().recipeDataMessage?.renderSequence === renderSequence ) {
            hub.postToPanel(cockpitPanel, queriesMessage);
        }

    }

    /*
        The reader's edits (#367), as workspaceState kept them, each checked on its own: folder and
        query key bounded names, both texts strings no longer than a query may be. Maps, so a folder
        or key named __proto__ is a key like any other.
    */
    static readQueryEdits(workspaceState: IRecipeCockpitWorkspaceState | undefined): Map<string, Map<string, IRecipeCockpitQueryEdit>> {

        const queryEdits = new Map<string, Map<string, IRecipeCockpitQueryEdit>>();
        let storedEdits: unknown;

        try {
            storedEdits = workspaceState?.get<unknown>(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY);
        } catch {
            return queryEdits;
        }

        if ( !this.isPlainRecord(storedEdits) || storedEdits.version !== RECIPE_COCKPIT_QUERY_EDITS_VERSION || !this.isPlainRecord(storedEdits.editsByFolderName) ) {
            return queryEdits;
        }

        const editsByFolderName = storedEdits.editsByFolderName;

        Object.keys(editsByFolderName).slice(0, RECIPE_COCKPIT_QUERY_EDITS_MAX_ENTRIES).forEach(folderName => {
            const storedFolderEdits = editsByFolderName[folderName];
            if ( folderName.length > RECIPE_COCKPIT_QUERY_EDITS_FOLDER_NAME_MAX_LENGTH || folderName === '' || !this.isPlainRecord(storedFolderEdits) ) {
                return;
            }
            const folderEdits = new Map<string, IRecipeCockpitQueryEdit>();
            Object.keys(storedFolderEdits).slice(0, RECIPE_COCKPIT_QUERY_EDITS_MAX_ENTRIES).forEach(queryKey => {
                const storedEdit = storedFolderEdits[queryKey];
                const isQueryText = (candidateText: unknown): candidateText is string => typeof candidateText === 'string' && candidateText !== '' && candidateText.length <= RECIPE_COCKPIT_QUERY_MAX_LENGTH;
                if ( this.isQueryKeyShaped(queryKey) && this.isPlainRecord(storedEdit) && isQueryText(storedEdit.generatedText) && isQueryText(storedEdit.editedText) ) {
                    folderEdits.set(queryKey, { generatedText: storedEdit.generatedText, editedText: storedEdit.editedText });
                }
            });
            if ( folderEdits.size > 0 ) {
                queryEdits.set(folderName, folderEdits);
            }
        });

        return queryEdits;

    }

    static async writeQueryEdits(workspaceState: IRecipeCockpitWorkspaceState | undefined, queryEdits: Map<string, Map<string, IRecipeCockpitQueryEdit>>): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage('The Recipe Cockpit has no workspace to keep query edits in. Open a folder and re-open the cockpit.');
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER OR QUERY KEY NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const editsByFolderName = Object.fromEntries([...queryEdits].map(([folderName, folderEdits]) => [folderName, Object.fromEntries(folderEdits)]));

        try {
            await workspaceState.update(RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY, { version: RECIPE_COCKPIT_QUERY_EDITS_VERSION, editsByFolderName: editsByFolderName });
            return true;
        } catch (updateError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The query edit could not be saved: ${this.describeThrown(updateError)}`));
            return false;
        }

    }

    // AN EMPTY TEXT, OR THE GENERATED ONE, IS RESET: THE EDIT IS REMOVED RATHER THAN KEPT EQUAL TO WHAT IS GENERATED
    private static async saveTreeQueryEdit(hub: IRecipeCockpitHubForQueryTab, treeKey: string, queryKey: string, queryText: string) {

        const treeQueryRead = this.readTreeQueries(hub, treeKey);
        const treeQuery = treeQueryRead?.queries?.find(candidateQuery => candidateQuery.queryKey === queryKey);

        if ( !treeQueryRead || !treeQuery ) {
            return;
        }

        const queryEdits = this.readQueryEdits(hub.workspaceState());
        const folderEdits = queryEdits.get(treeQueryRead.folderName) ?? new Map<string, IRecipeCockpitQueryEdit>();

        if ( queryText === '' || queryText === treeQuery.text ) {
            folderEdits.delete(queryKey);
        } else {
            folderEdits.set(queryKey, { generatedText: treeQuery.text, editedText: queryText });
        }

        if ( folderEdits.size > 0 ) {
            queryEdits.set(treeQueryRead.folderName, folderEdits);
        } else {
            queryEdits.delete(treeQueryRead.folderName);
        }

        await this.writeQueryEdits(hub.workspaceState(), queryEdits);

    }

    private static isTreeQueryInFlight = false;

    private static treeQueryRunStateMessage: IRecipeCockpitTreeQueryStateMessage | undefined;

    /*
        The last run's whole result (#367), which only an export of the SAME tree folder and query
        reads. One is kept, so a large result is held only until the next run.
    */
    private static heldTreeQueryResult: {
        // THE WORKSPACE, MODEL, TREE FOLDER AND QUERY KEY IT WAS RUN FOR, AS ONE KEY
        resultKey: string;
        folderName: string;
        objectApiName: string;
        kind: SOQLQueryKind;
        orgLabel: string;
        records: Record<string, unknown>[];
    } | undefined;

    static clearHeldTreeQueryResult() {
        this.heldTreeQueryResult = undefined;
    }

    private static setTreeQueryState(hub: IRecipeCockpitHubForQueryTab, queryStateMessage: IRecipeCockpitTreeQueryStateMessage) {

        this.treeQueryRunStateMessage = queryStateMessage.isRunning ? queryStateMessage : undefined;
        hub.currentPanelState().treeQueryStateMessage = queryStateMessage;

        const currentPanel = hub.currentPanel();
        if ( currentPanel ) {
            hub.postToPanel(currentPanel, queryStateMessage);
        }

    }

    static adoptTreeQueryRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isTreeQueryInFlight && this.treeQueryRunStateMessage ) {
            panelState.treeQueryStateMessage = this.treeQueryRunStateMessage;
        }

    }

    /*
        "Run" (#367): the text is held to one SELECT, the org is the Target Org Manager selection
        (#439) -- any org it lists, the CLI's default production org included, since a query only
        reads -- asked for once over that listing when none is chosen, and the query is sent on a connection opened by that org's username, every page read up to the cap
        and cancellable between pages. The whole result is held for an export, a preview is posted,
        and how it went is ONE notification. One run per window.
    */
    private static async runTreeQueryFromPanel(hub: IRecipeCockpitHubForQueryTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, queryKey: string, queryText: string) {

        const notRunning: IRecipeCockpitTreeQueryStateMessage = { command: 'treeQueryState', isRunning: false, treeKey: treeKey, queryKey: queryKey };

        if ( this.isTreeQueryInFlight ) {
            hub.postToPanel(cockpitPanel, this.treeQueryRunStateMessage ?? notRunning);
            return;
        }

        const treeQueryRead = this.readTreeQueries(hub, treeKey);
        const treeQuery = treeQueryRead?.queries?.find(candidateQuery => candidateQuery.queryKey === queryKey);

        if ( !treeQueryRead?.queries || !treeQuery ) {
            hub.postToPanel(cockpitPanel, notRunning);
            return;
        }

        const queryCheck = RecipeCockpitQuery.checkQueryText(queryText);

        if ( 'refusal' in queryCheck ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The query was not run: ${queryCheck.refusal}`));
            hub.postToPanel(cockpitPanel, notRunning);
            return;
        }

        this.isTreeQueryInFlight = true;
        this.setTreeQueryState(hub, { command: 'treeQueryState', isRunning: true, treeKey: treeKey, queryKey: queryKey });

        try {
            await this.performTreeQuery(hub, cockpitPanel, treeKey, treeQueryRead.renderSequence, treeQueryRead.folderName, treeQuery, queryCheck.query);
        } finally {
            this.isTreeQueryInFlight = false;
            this.setTreeQueryState(hub, notRunning);
        }

    }

    private static async performTreeQuery(hub: IRecipeCockpitHubForQueryTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number, folderName: string, treeQuery: ISOQLTreeQuery, queryText: string) {

        const workspaceRoot = hub.currentPanelState().workspaceRoot;

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await this.resolveTreeQueryOrg(hub, cockpitPanel, hub.currentPanelState());
        } catch (listError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The query was not run: ${this.describeThrown(listError)}`));
            return;
        }

        if ( !orgDetail ) {
            return;
        }

        const orgUsername = orgDetail.username;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgUsername}` : orgUsername;
        const queryLabel = `${treeQuery.objectApiName} ${SOQL_QUERY_KIND_LABELS[treeQuery.kind]}`;

        // THE LAST RESULT IS LET GO BEFORE THE NEXT IS READ, SO TWO LARGE RESULTS ARE NEVER HELD AT ONCE
        this.clearHeldTreeQueryResult();

        let queryResult: Awaited<ReturnType<typeof RecipeCockpitQuery.fetchQueryRecords>> | undefined;
        try {
            queryResult = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: running the ${queryLabel} in ${orgLabel}`),
                cancellable: true
            }, async (_progress, cancellationToken) => {
                let connection: Connection;
                try {
                    connection = await SalesforceOrgService.getConnection(orgUsername);
                } catch {
                    return undefined;
                }
                return await RecipeCockpitQuery.fetchQueryRecords({
                    query: async (soql: string) => await connection.query(soql),
                    queryMore: async (nextRecordsUrl: string) => await connection.queryMore(nextRecordsUrl)
                }, queryText, RECIPE_COCKPIT_QUERY_RECORD_CAP, () => cancellationToken.isCancellationRequested);
            });
        } catch (queryError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The ${queryLabel} failed in ${orgLabel}: ${this.describeThrown(queryError)}`));
            return;
        }

        // A CONNECTION THAT COULD NOT BE OPENED IS ONE FIXED WARNING: ITS ERROR CAN CARRY AN AUTH URL OR TOKEN TEXT
        if ( !queryResult ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The ${queryLabel} was not run: ${orgLabel} could not be connected to. ${RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE}`));
            return;
        }

        if ( queryResult.isCancelled ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The ${queryLabel} in ${orgLabel} was cancelled, so nothing was kept to export.`));
            return;
        }

        const heldTreeQueryResult = {
            resultKey: JSON.stringify([workspaceRoot, renderSequence, folderName, treeQuery.queryKey]),
            folderName: folderName,
            objectApiName: treeQuery.objectApiName,
            kind: treeQuery.kind,
            orgLabel: orgLabel,
            records: queryResult.records
        };
        this.heldTreeQueryResult = heldTreeQueryResult;

        const preview = RecipeCockpitQuery.buildPreview(queryResult.records, RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT);
        const recordCount = queryResult.records.length;
        const recordsText = `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;

        // DRAWN ONLY ON THE MODEL IT WAS RUN ON: A RELOAD SINCE IS ANOTHER MODEL, AND KEEPS ITS OWN TAB
        if ( hub.currentPanelState().recipeDataMessage?.renderSequence === renderSequence ) {
            const resultMessage: IRecipeCockpitTreeQueryResultMessage = {
                command: 'treeQueryResult',
                renderSequence: renderSequence,
                treeKey: treeKey,
                queryKey: treeQuery.queryKey,
                orgLabel: orgLabel,
                totalSize: queryResult.totalSize,
                recordCount: recordCount,
                isTruncated: queryResult.isTruncated,
                columns: preview.columns,
                rows: preview.rows,
                hiddenColumnCount: preview.hiddenColumnCount
            };
            const recordLinkSequence = hub.registerRecordLinkPreview(hub.currentPanelState(), {
                previewKind: 'query',
                renderSequence: renderSequence,
                treeKey: treeKey,
                orgUsername: orgUsername,
                heldSource: heldTreeQueryResult,
                recordIdsByObjectApiName: new Map([['', preview.recordIds ?? []]])
            });
            if ( recordLinkSequence !== undefined && preview.recordLinks ) {
                resultMessage.recordLinkSequence = recordLinkSequence;
                resultMessage.recordLinks = preview.recordLinks;
            }
            hub.currentPanelState().treeQueryResultMessage = resultMessage;
            const currentPanel = hub.currentPanel();
            if ( currentPanel ) {
                hub.postToPanel(currentPanel, resultMessage);
            }
        }

        if ( queryResult.isTruncated ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(
                `The ${queryLabel} matched ${queryResult.totalSize} records in ${orgLabel}, and only the first ${recordsText} were read: a run reads at most ${RECIPE_COCKPIT_QUERY_RECORD_CAP} records or ${RECIPE_COCKPIT_QUERY_VALUE_BUDGET} values. Select fewer fields or add a WHERE clause to export them all.`));
            return;
        }

        VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(`The ${queryLabel} returned ${recordsText} from ${orgLabel}.`));

    }

    /*
        The org a query runs against is the Target Org Manager selection as it is at the click
        (#439), whatever it answered about being a sandbox, unless no connection could be opened
        to it. With none, it asks once over the dropdown's own listing and the pick becomes the
        selection, checked and remembered as one made in the dropdown -- unless another run holds
        the selection, which a prompt would change under it.
    */
    private static async resolveTreeQueryOrg(hub: IRecipeCockpitHubForQueryTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState): Promise<IAuthenticatedOrgDetail | undefined> {

        return hub.resolveSelectedReadOrg(cockpitPanel, panelState, 'The query was not run', RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER, RECIPE_COCKPIT_QUERY_BUSY_REFUSAL, RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE, 'isQueryOrgPromptOpen');

    }

    /*
        "Export JSON" / "Export CSV" (#367): the result held for the same tree folder and query, and
        nothing else, written under <tree folder>/RunArtifacts/QueryResults/. The panel posts only names; the
        path is the host's and opened only through the notification's "Open file".
    */
    private static exportTreeQueryResult(hub: IRecipeCockpitHubForQueryTab, treeKey: string, queryKey: string, exportFormat: RecipeCockpitQueryExportFormat) {

        const workspaceRoot = hub.currentPanelState().workspaceRoot;
        const tree = hub.currentPanelState().recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const heldResult = this.heldTreeQueryResult;

        const renderSequence = hub.currentPanelState().recipeDataMessage?.renderSequence;

        if ( !heldResult || heldResult.resultKey !== JSON.stringify([workspaceRoot, renderSequence, tree?.folderName, queryKey]) ) {
            VSCodeWorkspaceService.showWarningMessage('Nothing was exported: run this query first. Only the last query run is kept to export.');
            return;
        }

        const recipeViewModel = hub.currentPanelState().recipeDataMessage?.recipe;
        const runArtifactsLocation = recipeViewModel && tree ? hub.resolveTreeRunArtifactsLocation(workspaceRoot, recipeViewModel, tree) : undefined;
        let exportFilePath: string | undefined;
        try {
            const exportContent = exportFormat === 'json'
                ? RecipeCockpitQuery.buildJsonExport(heldResult.records)
                : RecipeCockpitQuery.buildCsvExport(heldResult.records);
            exportFilePath = runArtifactsLocation && RecipeCockpitQuery.writeQueryExport(runArtifactsLocation, heldResult.objectApiName, heldResult.kind, exportFormat, exportContent, new Date());
        } catch (exportError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Nothing was exported: the ${exportFormat.toUpperCase()} file could not be built: ${this.describeThrown(exportError)}`));
            return;
        }

        if ( !exportFilePath ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Nothing was exported: the ${exportFormat.toUpperCase()} file could not be written under the tree's ${RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME}/QueryResults folder in this workspace.`));
            return;
        }

        const recordCount = heldResult.records.length;
        const relativeFilePath = path.relative(workspaceRoot, exportFilePath).split(path.sep).join('/');
        const exportedText = `Exported ${recordCount} ${recordCount === 1 ? 'record' : 'records'} from ${heldResult.orgLabel} to ${relativeFilePath}.`;
        // ORG DATA, POSSIBLY PRODUCTION'S, IN A FOLDER GIT DOES NOT IGNORE IS SAID, SO IT IS NOT COMMITTED UNSEEN
        const isGitIgnored = runArtifactsLocation !== undefined && RecipeCockpitRunArtifacts.isGitIgnored(runArtifactsLocation);
        const shown = isGitIgnored
            ? vscode.window.showInformationMessage(RecipeYamlScalar.escapeForNotification(exportedText), RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL)
            : vscode.window.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${exportedText} ${RECIPE_COCKPIT_QUERY_NOT_GIT_IGNORED_NOTE}`), RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL);

        Promise.resolve(shown)
            .then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(exportFilePath, workspaceRoot, 'The exported file no longer exists in this workspace.');
                }
            })
            .catch(exportFollowUpError => ErrorHandlingService.handleCapturedError(exportFollowUpError, 'openRecipeCockpit'));

    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {

        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);

    }

    private static describeThrown(thrownValue: unknown): string {

        return String(( thrownValue as Error | undefined )?.message ?? thrownValue);

    }

}
