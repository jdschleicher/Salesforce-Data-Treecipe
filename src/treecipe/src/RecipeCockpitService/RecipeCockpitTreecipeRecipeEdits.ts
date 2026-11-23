import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IRecipeCockpitHubForTreecipeTab } from './RecipeCockpitTreecipeHost';
import {
    ILookupWiringContext,
    ILookupWiringRequest,
    IParentObjectAdditionRequest,
    IParentObjectAdditionWiring,
    IRecipeFixedValue,
    IRemovedTodoComment,
    RecipeCockpitRecipeWriter,
    RecipeParentObjectAdditionResult
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    IFixedValueEntry,
    IFixedValueOrgRecord,
    RecipeCockpitFixedValueStore
} from './RecipeCockpitFixedValueStore';
// TYPES ONLY: THE HUB IMPORTS THIS HOST, AND A HOST NEVER LOADS THE HUB'S CODE; IT CALLS IT THROUGH IRecipeCockpitHubForTreecipeTab
import type {
    IRecipeCockpitEmptyLookupViewModel,
    IRecipeCockpitLookupWiringViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitTreeFocus,
    IRecipeCockpitTreeViewModel,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    IOrgDescribeSource,
    IOrgQuerySource,
    ORG_PARENT_SEARCH_RESULT_LIMIT,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import { RecipeCockpitRecordCreation } from './RecipeCockpitRecordCreation';
import { RecipeCockpitRemovedTodoStore } from './RecipeCockpitRemovedTodoStore';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';

/*
    The Treecipe tab's recipe edits (moved out of the hub by #688): a friend on a self-lookup
    iteration, lookup wiring, a parent object added from a template, "Use existing … from org", and
    a TODO removed or restored. It also holds the line patches and sidecar file writes a fixed value
    and Get latest object detail make, so the Treecipe tab's files load one way and this one loads
    no other host.
*/

export const RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL = 'Enter a record Id';
export const RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL = 'Use this record';
export const RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL = 'Add';
export const RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL = 'Wire';
// HOW MANY LOOKUPS THE WIRE-ALL CONFIRMATION NAMES BEFORE IT COUNTS THE REST
export const RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_SHOWN = 12;
// A TODO LOOKUP WHOSE STANDARD PARENT THE RECIPE DOES NOT WRITE ADDS THAT PARENT FROM A TEMPLATE (#294)
export const RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL = 'Add to recipe';
// A faker-js RECIPE CHOOSES BETWEEN THE TOP-LEVEL BLOCK AND NESTING THE TREE UNDER THE PARENT (#405); A snowfakery TREE STAYS FLAT
export const RECIPE_COCKPIT_ADD_PARENT_OBJECT_TOP_LEVEL_LABEL = 'Add as a top-level block';
export const RECIPE_COCKPIT_ADD_PARENT_OBJECT_NEST_LABEL = 'Add as the parent, nest the tree under it';

// THE TODO RecipeService WRITES UNDER A DEFAULT RecordTypeId (AND EVERY RECORD-TYPE VARIANT) WHEN AN OBJECT HAS SEVERAL RECORD TYPES
export const RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL = 'Remove TODO';
export const RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL = 'Restore TODO';
export const RECIPE_COCKPIT_TODO_REMOVE_REFUSAL_PREFIX = 'The TODO was not removed';
export const RECIPE_COCKPIT_TODO_RESTORE_REFUSAL_PREFIX = 'The TODO was not put back';

export class RecipeCockpitTreecipeRecipeEdits {

    static planFixedValueWrite(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                        workspaceRoot: string,
                                        objectApiName: string,
                                        fieldApiName: string,
                                        fixedValue: IRecipeFixedValue,
                                        orgRecord?: IFixedValueOrgRecord,
                                        scopeNickname?: string): { recipeText: string; entries: IFixedValueEntry[] } | { refusal: string } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const located = this.readFixedValueTarget(hub, recipeFilePath, fixedValueFilePath, workspaceRoot);
        if ( 'refusal' in located ) {
            return located;
        }

        const pinResult = RecipeCockpitRecipeWriter.pinField(located.recipeText, objectApiName, fieldApiName, fixedValue, scopeNickname);
        if ( 'refusal' in pinResult ) {
            return { refusal: `Not saved: ${pinResult.refusal.message}` };
        }

        return {
            recipeText: pinResult.recipeText,
            entries: RecipeCockpitFixedValueStore.upsertEntry(located.entries, {
                objectApiName: objectApiName,
                ...( scopeNickname !== undefined ? { scopeNickname: scopeNickname } : {} ),
                fieldApiName: fieldApiName,
                value: fixedValue.value,
                ...( orgRecord ? { orgRecord: orgRecord } : {} ),
                occurrences: pinResult.occurrences
            })
        };

    }

    /*
        "Use existing <Parent> from org…" (#421): the org is asked for in the palette every time, as a
        retrieve's is (it only reads), then a record is chosen by searching the parent's name field or
        by its Id, which is checked in that org -- its key prefix against the parent's describe, and
        its existence by a query -- before anything is written. The Id is pinned like a fixed value
        (#342), with the org it came from kept in the fixed-values file, so the row can say whose
        record it is and Clear puts the TODO back exactly. Runs inside the one recipe write lock;
        answers whether the file was written, every other ending having been said already.
    */
    static async writeOrgRecordLookup(hub: IRecipeCockpitHubForTreecipeTab, useAction: Extract<RecipeCockpitPanelAction, { kind: 'useOrgRecordForLookup' }>,
                                                tree: IRecipeCockpitTreeViewModel,
                                                objectLevelsByApiName: Map<string, number> | undefined,
                                                panelState: IRecipeCockpitPanelState): Promise<boolean> {

        const { recipeFilePath, emptyLookup } = useAction;
        const { objectApiName, fieldApiName, parentObjectApiName } = emptyLookup;
        const workspaceRoot = panelState.workspaceRoot;
        // THE NAMES COME FROM WORKSPACE FILES, AND A NOTIFICATION RENDERS [label](command:…) AS A LINK THAT RUNS THE COMMAND
        const parentLabel = RecipeYamlScalar.escapeForNotification(parentObjectApiName);
        const fieldLabel = `${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(fieldApiName)}`;
        const refusalPrefix = `${fieldLabel} was not set to an existing ${parentLabel} record:`;
        const refuse = (refusalText: string) => { VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} ${refusalText}`); return false; };

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            return refuse('its recipe file no longer exists in this workspace. Re-open the Recipe Cockpit to load the runs currently on disk.');
        }

        const drawnField = hub.findDrawnField(panelState.recipeDataMessage?.recipe, tree.treeKey, objectApiName, fieldApiName);
        const lockReason = drawnField
            ? hub.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel)
            : 'the field is no longer drawn';
        if ( lockReason !== undefined ) {
            return refuse(`${RecipeYamlScalar.escapeForNotification(lockReason)}.`);
        }

        const orgDetail = await SalesforceOrgService.promptForAuthorizedOrg(`Choose the org that holds the ${parentObjectApiName} record ${objectApiName}.${fieldApiName} points at`);
        if ( !orgDetail ) {
            return false;
        }

        const orgText = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        // A QUICK PICK PLACEHOLDER AND AN INPUT BOX PROMPT RENDER [label](command:…) LIKE A NOTIFICATION
        const orgLabel = RecipeYamlScalar.escapeForNotification(orgText);
        let querySource: IOrgQuerySource;
        let parentOutcome: Awaited<ReturnType<typeof SalesforceOrgService.describeObjects>>['outcomes'][number] | undefined;
        try {
            const connection = await SalesforceOrgService.getConnection(orgDetail.username);
            querySource = SalesforceOrgService.toQuerySource(connection);
            parentOutcome = ( await SalesforceOrgService.describeObjects(orgDetail.username, [parentObjectApiName], async () => connection as unknown as IOrgDescribeSource) ).outcomes[0];
        } catch {
            return refuse(`${orgLabel} could not be connected to. Check its authorization with "sf org list", then try again.`);
        }

        if ( !parentOutcome?.describe ) {
            return refuse(`${parentLabel} could not be described in ${orgLabel} (${RecipeYamlScalar.escapeForNotification(parentOutcome?.failureMessage ?? 'no answer')}).`);
        }

        const searchLabel = `Search ${parentObjectApiName}`;
        const nameFieldApiName = SalesforceOrgService.findNameFieldApiName(parentOutcome.describe);
        const howChosen = await vscode.window.showQuickPick([
            {
                label: VSCodeWorkspaceService.toQuickPickLabelText(searchLabel),
                description: nameFieldApiName ? `by ${nameFieldApiName}, and pick one record` : `${parentObjectApiName} has no name field to search`
            },
            { label: RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL, description: `a 15- or 18-character ${parentObjectApiName} Id, checked in the org` }
        ], { placeHolder: `How to choose the ${parentObjectApiName} record in ${orgLabel}`, ignoreFocusOut: true });

        if ( !howChosen ) {
            return false;
        }

        let chosenRecord: { recordId: string; recordName: string } | undefined;

        if ( howChosen.label === RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL ) {

            const enteredId = await vscode.window.showInputBox({
                prompt: `The Id of the ${parentObjectApiName} record in ${orgLabel} that ${objectApiName}.${fieldApiName} points at`,
                placeHolder: '15- or 18-character Salesforce Id',
                ignoreFocusOut: true,
                validateInput: typedId => RecipeCockpitFixedValueStore.isSalesforceRecordId(typedId.trim()) ? undefined : 'Type a 15- or 18-character Salesforce Id: letters and digits only.'
            });

            if ( enteredId === undefined ) {
                return false;
            }

            const recordId = enteredId.trim();
            if ( !RecipeCockpitFixedValueStore.isSalesforceRecordId(recordId) ) {
                return refuse('that is not a 15- or 18-character Salesforce Id.');
            }

            const keyPrefix = parentOutcome.describe.keyPrefix;
            if ( keyPrefix !== undefined && recordId.slice(0, 3) !== keyPrefix ) {
                return refuse(`${RecipeYamlScalar.escapeForNotification(recordId)} does not start with ${RecipeYamlScalar.escapeForNotification(keyPrefix)}, the key prefix of ${parentLabel} records.`);
            }

            let existingRecordIds: string[];
            try {
                existingRecordIds = await SalesforceOrgService.queryExistingRecordIds(querySource, parentObjectApiName, [recordId]);
            } catch (queryError) {
                return refuse(`${orgLabel} could not be asked whether it holds that record (${RecipeYamlScalar.escapeForNotification(String(( queryError as Error )?.message ?? queryError))}).`);
            }

            const existingRecordId = existingRecordIds.find(candidateId => SalesforceOrgService.isSameRecordId(candidateId, recordId));
            if ( !existingRecordId ) {
                return refuse(`${orgLabel} has no ${parentLabel} record with the Id ${RecipeYamlScalar.escapeForNotification(recordId)}.`);
            }

            chosenRecord = { recordId: existingRecordId, recordName: '' };

        } else {

            if ( !nameFieldApiName ) {
                return refuse(`${parentLabel} has no name field in its describe, so it cannot be searched. Choose "${RECIPE_COCKPIT_ORG_RECORD_ENTER_ID_LABEL}" instead.`);
            }

            const searchReturnedRecordIds = new Set<string>();
            chosenRecord = await VSCodeWorkspaceService.promptForParentRecord({
                fieldApiName: fieldApiName,
                parentObjectApiName: parentObjectApiName,
                nameFieldApiName: nameFieldApiName,
                resultLimit: ORG_PARENT_SEARCH_RESULT_LIMIT,
                search: async searchText => {
                    const searchResult = await SalesforceOrgService.searchParentRecords(querySource, parentObjectApiName, nameFieldApiName, searchText);
                    searchResult.matches.forEach(parentMatch => searchReturnedRecordIds.add(parentMatch.recordId));
                    return searchResult;
                }
            });

            if ( !chosenRecord ) {
                return false;
            }
            // THE PICKER LISTS ONLY WHAT ITS SEARCH ANSWERED: HELD AGAIN AT THE POINT THE Id BECOMES THE RECIPE'S VALUE
            if ( !RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch([chosenRecord.recordId], searchReturnedRecordIds) ) {
                return refuse('the record chosen is not one its search returned.');
            }

        }

        const fixedValue: IRecipeFixedValue = { value: chosenRecord.recordId, kind: 'text' };
        const orgRecord: IFixedValueOrgRecord = {
            orgUsername: orgDetail.username,
            ...( orgDetail.alias ? { orgAlias: orgDetail.alias } : {} ),
            parentObjectApiName: parentObjectApiName
        };
        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);

        const planOrgRecordWrite = () => {
            const emptyLookupRefusal = this.findEmptyLookupRefusal(hub, recipeFilePath, tree, objectLevelsByApiName, emptyLookup);
            return emptyLookupRefusal !== undefined
                ? { refusal: emptyLookupRefusal }
                : this.planFixedValueWrite(hub, recipeFilePath, workspaceRoot, objectApiName, fieldApiName, fixedValue, orgRecord);
        };

        const planned = planOrgRecordWrite();
        if ( 'refusal' in planned ) {
            return refuse(RecipeYamlScalar.escapeForNotification(planned.refusal.replace(/^Not saved: /, '')));
        }

        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const confirmation = await hub.confirmInPanel(
            `Point ${objectApiName}.${fieldApiName} at an existing ${parentObjectApiName} record?`,
            {
                summary: [
                    `Record: ${chosenRecord.recordName ? `${chosenRecord.recordName} · ` : ''}${chosenRecord.recordId}`
                ],
                org: hub.buildConfirmOrg(orgDetail),
                warnings: [`The Id exists only in ${orgText}. The tree insert checks it exists in the org it inserts into, and inserts nothing when it does not.`],
                sections: [
                    {
                        title: 'What is written',
                        lines: [
                            `This writes to "${path.basename(recipeFilePath)}": ${objectApiName}.${fieldApiName} becomes "${chosenRecord.recordId}" on every ${objectApiName} in it, so every record generated points at that one ${parentObjectApiName}. Every other line of the file is left as it is.`,
                            '',
                            `The TODO line it replaces is kept in "${path.basename(fixedValueFilePath)}" beside the recipe, so Clear can put it back exactly.`
                        ]
                    }
                ]
            },
            RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_ORG_RECORD_CONFIRM_LABEL ) {
            return false;
        }

        // PLANNED AGAIN AFTER THE DIALOG: EITHER FILE CAN HAVE CHANGED WHILE IT WAS OPEN
        const confirmed = planOrgRecordWrite();
        if ( 'refusal' in confirmed ) {
            return refuse(RecipeYamlScalar.escapeForNotification(confirmed.refusal.replace(/^Not saved: /, '')));
        }

        const writeRefusal = this.writeRecipeWithFixedValueFile(recipeFilePath, confirmed.recipeText, fixedValueFilePath, confirmed.entries);
        if ( writeRefusal !== undefined ) {
            return refuse(writeRefusal.replace(/^Not saved: /, ''));
        }

        VSCodeWorkspaceService.showInformationMessage(`${fieldLabel} now points at the ${parentLabel} record ${RecipeYamlScalar.escapeForNotification(chosenRecord.recordId)} from ${orgLabel}, in "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}".`);
        return true;

    }

    /*
        Why the lookup can no longer be set to an org record, read from the recipe file as it is NOW
        (#421): it must still be an empty lookup to the same parent on every occurrence, by the same
        rule that drew the button. A lookup wired or filled by hand since the load is refused rather
        than overwritten.
    */
    private static findEmptyLookupRefusal(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                    tree: IRecipeCockpitTreeViewModel,
                                    objectLevelsByApiName: Map<string, number> | undefined,
                                    emptyLookup: IRecipeCockpitEmptyLookupViewModel): string | undefined {

        let recipeText: string;
        try {
            recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
        } catch {
            return `"${path.basename(recipeFilePath)}" could not be read.`;
        }

        const currentLookup = hub.listTreeEmptyLookups(recipeFilePath, tree, objectLevelsByApiName, recipeText).find(candidate => candidate.objectApiName === emptyLookup.objectApiName
                                                                                                                        && candidate.objectNickname === emptyLookup.objectNickname
                                                                                                                        && candidate.fieldApiName === emptyLookup.fieldApiName
                                                                                                                        && candidate.parentObjectApiName === emptyLookup.parentObjectApiName);

        if ( !currentLookup ) {
            return `${emptyLookup.objectApiName}.${emptyLookup.fieldApiName} is no longer a "### TODO -- REFERENCE ID REQUIRED" lookup in "${path.basename(recipeFilePath)}". Re-open the Recipe Cockpit to load it as it is now.`;
        }

        return currentLookup.orgRecordRefusal;

    }

    // THE RECIPE'S TEXT AND THE FIXED-VALUES FILE'S ENTRIES, OR WHY NEITHER IS TO BE WRITTEN
    static readFixedValueTarget(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string, fixedValueFilePath: string, workspaceRoot: string): { recipeText: string; entries: IFixedValueEntry[] } | { refusal: string } {

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            return { refusal: `Not saved: "${path.basename(recipeFilePath)}" no longer exists in this workspace. Re-open the Recipe Cockpit to load the runs currently on disk.` };
        }
        if ( this.isLinkPath(fixedValueFilePath) || ( fs.existsSync(fixedValueFilePath) && !hub.isUsableWorkspacePath(fixedValueFilePath, workspaceRoot) ) ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" is a link or is outside this workspace, so it is not written.` };
        }

        const fixedValueRead = hub.readFixedValueFile(fixedValueFilePath, workspaceRoot);
        if ( fixedValueRead.isUnreadable ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" is not a fixed-values file the Recipe Cockpit can read. Fix it, or delete it to start again.` };
        }

        try {
            return { recipeText: fs.readFileSync(recipeFilePath, 'utf-8'), entries: fixedValueRead.entries };
        } catch {
            return { refusal: `Not saved: "${path.basename(recipeFilePath)}" could not be read.` };
        }

    }

    private static isLinkPath(candidatePath: string): boolean {
        try {
            return fs.lstatSync(candidatePath).isSymbolicLink();
        } catch {
            return false;
        }
    }

    /*
        The fixed-values file first, then the recipe; when the recipe cannot be written the
        fixed-values file goes back to what it was, or away when there was none. A file left with no
        entry is removed rather than kept empty.
    */
    /*
        Written beside the target and renamed over it, so a write that stops part way (a full disk, a
        killed host) leaves the recipe as it was rather than cut short. A rename replaces a link at the
        target rather than writing through it.
    */
    private static writeFileReplacing(filePath: string, fileText: string): void {

        const temporaryFilePath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);

        try {
            fs.writeFileSync(temporaryFilePath, fileText, { flag: 'wx' });
            fs.renameSync(temporaryFilePath, filePath);
        } catch (writeError) {
            fs.rmSync(temporaryFilePath, { force: true });
            throw writeError;
        }

    }

    static writeRecipeWithFixedValueFile(recipeFilePath: string, recipeText: string, fixedValueFilePath: string, entries: IFixedValueEntry[]): string | undefined {
        return this.writeRecipeWithSidecarFile(recipeFilePath, recipeText, fixedValueFilePath, entries.length > 0 ? RecipeCockpitFixedValueStore.serialize(entries) : undefined, 'Not saved');
    }

    // THE SIDECAR FIRST, THEN THE RECIPE; sidecarText UNDEFINED REMOVES THE SIDECAR RATHER THAN KEEPING IT EMPTY
    private static writeRecipeWithSidecarFile(recipeFilePath: string, recipeText: string, sidecarFilePath: string, sidecarText: string | undefined, refusalPrefix: string): string | undefined {

        const fixedValueFilePath = sidecarFilePath;
        let previousFixedValueText: string | undefined;

        try {
            previousFixedValueText = fs.existsSync(fixedValueFilePath) ? fs.readFileSync(fixedValueFilePath, 'utf-8') : undefined;
            if ( sidecarText !== undefined ) {
                this.writeFileReplacing(fixedValueFilePath, sidecarText);
            } else if ( previousFixedValueText !== undefined ) {
                fs.unlinkSync(fixedValueFilePath);
            }
        } catch (writeError) {
            return `${refusalPrefix}: "${RecipeYamlScalar.escapeForNotification(path.basename(fixedValueFilePath))}" could not be written (${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}).`;
        }

        try {
            this.writeFileReplacing(recipeFilePath, recipeText);
            return undefined;
        } catch (writeError) {
            try {
                if ( previousFixedValueText !== undefined ) {
                    this.writeFileReplacing(fixedValueFilePath, previousFixedValueText);
                } else if ( fs.existsSync(fixedValueFilePath) ) {
                    fs.unlinkSync(fixedValueFilePath);
                }
            } catch {
                // THE RECIPE IS UNCHANGED, SO A SIDECAR LEFT AHEAD OF IT SAYS WHAT THE RECIPE NO LONGER HOLDS: A PIN READS AS CHANGED, A REMOVED TODO AS BACK
            }
            return `${refusalPrefix}: "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}" could not be written (${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}).`;
        }

    }

    /*
        "Remove TODO" (#391): the TODO's comment comes out of the card's recipe file and what puts it
        back goes into the removed-TODOs file beside it, written FIRST and put back as it was when the
        recipe cannot be. Asked in the panel first and planned again after, against the file as it is
        then; a TODO no longer what the panel drew writes nothing. Every refusal is a warning.
    */
    static async writeTodoRemoval(hub: IRecipeCockpitHubForTreecipeTab, removeAction: Extract<RecipeCockpitPanelAction, { kind: 'removeTodo' }>, workspaceRoot: string): Promise<boolean> {

        const { recipeFilePath } = removeAction;
        const removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);

        const planned = this.planTodoRemoval(hub, removeAction, workspaceRoot);
        if ( 'refusal' in planned ) {
            VSCodeWorkspaceService.showWarningMessage(planned.refusal);
            return false;
        }

        const confirmation = await hub.confirmInPanel(
            'Remove this TODO from the recipe?',
            {
                summary: [
                    planned.removed.todoText,
                    '',
                    `This writes to "${path.basename(recipeFilePath)}": ${planned.removed.kind === 'line' ? `line ${removeAction.lineNumber} is deleted` : `the comment is cut off the end of line ${removeAction.lineNumber}, and its value is kept`}. Every other line of the file is left as it is.`
                ],
                sections: [
                    { title: 'How Restore puts it back', lines: [`The line is kept in "${path.basename(removedTodoFilePath)}" beside the recipe, so Restore in the Removed list can put it back exactly.`] }
                ]
            },
            RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL ) {
            return false;
        }

        // PLANNED AGAIN AFTER THE DIALOG: EITHER FILE CAN HAVE CHANGED WHILE IT WAS OPEN
        const confirmed = this.planTodoRemoval(hub, removeAction, workspaceRoot);
        if ( 'refusal' in confirmed ) {
            VSCodeWorkspaceService.showWarningMessage(confirmed.refusal);
            return false;
        }

        const writeRefusal = this.writeRecipeWithSidecarFile(recipeFilePath, confirmed.recipeText, removedTodoFilePath, this.serializeRemovedTodos(confirmed.entries), RECIPE_COCKPIT_TODO_REMOVE_REFUSAL_PREFIX);
        if ( writeRefusal !== undefined ) {
            VSCodeWorkspaceService.showWarningMessage(writeRefusal);
            return false;
        }

        VSCodeWorkspaceService.showInformationMessage(`Removed a TODO from "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}". It is listed under Removed in the Troubleshooting tab's TODO's.`);
        return true;

    }

    private static planTodoRemoval(hub: IRecipeCockpitHubForTreecipeTab, removeAction: Extract<RecipeCockpitPanelAction, { kind: 'removeTodo' }>, workspaceRoot: string):
        { recipeText: string; removed: IRemovedTodoComment; entries: IRemovedTodoComment[] } | { refusal: string } {

        const located = this.readRemovedTodoTarget(hub, removeAction.recipeFilePath, workspaceRoot, RECIPE_COCKPIT_TODO_REMOVE_REFUSAL_PREFIX);
        if ( 'refusal' in located ) {
            return located;
        }

        const removeResult = RecipeCockpitRecipeWriter.removeTodoComment(located.recipeText, { lineNumber: removeAction.lineNumber, todoText: removeAction.todoText });
        if ( 'refusal' in removeResult ) {
            return { refusal: `${RECIPE_COCKPIT_TODO_REMOVE_REFUSAL_PREFIX}: ${RecipeYamlScalar.escapeForNotification(removeResult.refusal.message)}` };
        }

        return {
            recipeText: removeResult.recipeText,
            removed: removeResult.removed,
            entries: hub.listRemovedTodosStillOut(removeResult.recipeText, RecipeCockpitRemovedTodoStore.addEntry(located.entries, removeResult.removed))
        };

    }

    /*
        "Restore" (#391): the removed TODO goes back where it was taken from, and leaves the
        removed-TODOs file. The entry must still be in that file as the panel drew it; the writer
        finds its place in the recipe as it is NOW, and refuses when that place is gone.
    */
    static async writeTodoRestore(hub: IRecipeCockpitHubForTreecipeTab, restoreAction: Extract<RecipeCockpitPanelAction, { kind: 'restoreTodo' }>, workspaceRoot: string): Promise<boolean> {

        const { recipeFilePath, removed } = restoreAction;
        const removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);

        const planned = this.planTodoRestore(hub, restoreAction, workspaceRoot);
        if ( 'refusal' in planned ) {
            VSCodeWorkspaceService.showWarningMessage(planned.refusal);
            return false;
        }

        const confirmation = await hub.confirmInPanel(
            'Put this TODO back in the recipe?',
            {
                summary: [
                    removed.todoText,
                    '',
                    `This writes to "${path.basename(recipeFilePath)}": ${removed.kind === 'line' ? `the line goes back as line ${planned.lineNumber}` : `the comment goes back on the end of line ${planned.lineNumber}`}, and "${path.basename(removedTodoFilePath)}" no longer lists it. Every other line of the file is left as it is.`
                ]
            },
            RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL ) {
            return false;
        }

        const confirmed = this.planTodoRestore(hub, restoreAction, workspaceRoot);
        if ( 'refusal' in confirmed ) {
            VSCodeWorkspaceService.showWarningMessage(confirmed.refusal);
            return false;
        }

        const writeRefusal = this.writeRecipeWithSidecarFile(recipeFilePath, confirmed.recipeText, removedTodoFilePath, this.serializeRemovedTodos(confirmed.entries), RECIPE_COCKPIT_TODO_RESTORE_REFUSAL_PREFIX);
        if ( writeRefusal !== undefined ) {
            VSCodeWorkspaceService.showWarningMessage(writeRefusal);
            return false;
        }

        VSCodeWorkspaceService.showInformationMessage(`Put a TODO back in "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}".`);
        return true;

    }

    private static planTodoRestore(hub: IRecipeCockpitHubForTreecipeTab, restoreAction: Extract<RecipeCockpitPanelAction, { kind: 'restoreTodo' }>, workspaceRoot: string):
        { recipeText: string; lineNumber: number; entries: IRemovedTodoComment[] } | { refusal: string } {

        const located = this.readRemovedTodoTarget(hub, restoreAction.recipeFilePath, workspaceRoot, RECIPE_COCKPIT_TODO_RESTORE_REFUSAL_PREFIX);
        if ( 'refusal' in located ) {
            return located;
        }

        const entry = located.entries.find(candidate => RecipeCockpitRemovedTodoStore.isSameEntry(candidate, restoreAction.removed));
        if ( !entry ) {
            return { refusal: `${RECIPE_COCKPIT_TODO_RESTORE_REFUSAL_PREFIX}: "${RecipeYamlScalar.escapeForNotification(path.basename(RecipeCockpitRemovedTodoStore.buildFilePath(restoreAction.recipeFilePath)))}" no longer lists this TODO. Re-open the Recipe Cockpit to load it as it is now.` };
        }

        const restoreResult = RecipeCockpitRecipeWriter.restoreTodoComment(located.recipeText, entry, located.entries);
        if ( 'refusal' in restoreResult ) {
            return { refusal: `${RECIPE_COCKPIT_TODO_RESTORE_REFUSAL_PREFIX}: ${RecipeYamlScalar.escapeForNotification(restoreResult.refusal.message)}` };
        }

        return {
            recipeText: restoreResult.recipeText,
            lineNumber: restoreResult.lineNumber,
            entries: hub.listRemovedTodosStillOut(restoreResult.recipeText, RecipeCockpitRemovedTodoStore.removeEntry(located.entries, entry))
        };

    }

    private static serializeRemovedTodos(entries: IRemovedTodoComment[]): string | undefined {
        return entries.length > 0 ? RecipeCockpitRemovedTodoStore.serialize(entries) : undefined;
    }

    // THE RECIPE'S TEXT AND THE REMOVED-TODOS FILE'S ENTRIES, OR WHY NEITHER IS TO BE WRITTEN
    private static readRemovedTodoTarget(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string, workspaceRoot: string, refusalPrefix: string): { recipeText: string; entries: IRemovedTodoComment[] } | { refusal: string } {

        const removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const removedTodoFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(removedTodoFilePath));

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            return { refusal: `${refusalPrefix}: "${recipeFileLabel}" no longer exists in this workspace. Re-open the Recipe Cockpit to load the runs currently on disk.` };
        }
        if ( this.isLinkPath(removedTodoFilePath) || ( fs.existsSync(removedTodoFilePath) && !hub.isUsableWorkspacePath(removedTodoFilePath, workspaceRoot) ) ) {
            return { refusal: `${refusalPrefix}: "${removedTodoFileLabel}" is a link or is outside this workspace, so it is not written.` };
        }

        const removedTodoRead = hub.readRemovedTodoFile(removedTodoFilePath, workspaceRoot);
        if ( removedTodoRead.isUnreadable ) {
            return { refusal: `${refusalPrefix}: "${removedTodoFileLabel}" is not a removed-TODOs file the Recipe Cockpit can read. Fix it, or delete it to start again.` };
        }

        try {
            return { recipeText: fs.readFileSync(recipeFilePath, 'utf-8'), entries: removedTodoRead.entries };
        } catch {
            return { refusal: `${refusalPrefix}: "${recipeFileLabel}" could not be read.` };
        }

    }

    /*
        Adds one friend beneath a self-lookup iteration (#197): a host-side confirmation naming the
        file, the friend and the iteration, then RecipeCockpitRecipeWriter.insertFriend on the file as
        it is NOW -- the writer re-checks everything against the current text, so an edit made since
        the model was drawn is refused or built on rather than overwritten -- and the run reloaded
        with the card open on its Structure tab, where the new friend is drawn under the iteration.

        Only a write reloads. Whatever else it ended in -- cancelled, refused, the file gone -- the
        rows on screen are still the file's, and the closing addFriendState gives back the "+"
        buttons the panel disabled on the click.
    */
    static async addFriendToIteration(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                addFriendAction: Extract<RecipeCockpitPanelAction, { kind: 'addIterationFriend' }>) {

        const { treeKey, objectApiName, iterationNickname, friendObjectApiName, recipeFilePath } = addFriendAction;
        const isPanelStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState;
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        // THE RUN THE FILE BELONGS TO, READ AT THE CLICK -- THE READER CAN SWITCH RUNS WHILE THE MODAL IS OPEN, AND THE RELOAD SHOWS WHAT WAS WRITTEN
        const writtenRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;

        panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };
        hub.postToPanel(cockpitPanel, panelState.addFriendStateMessage);

        try {

            const isAdded = await this.writeFriendToIteration(hub, recipeFilePath, recipeFileLabel, panelState.workspaceRoot, objectApiName, iterationNickname, friendObjectApiName);

            if ( isAdded && isPanelStillCurrent() ) {
                await hub.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, writtenRunFolderName, { treeKey: treeKey, tab: 'treecipe' });
            }

        } finally {

            panelState.addFriendStateMessage = undefined;

            if ( isPanelStillCurrent() ) {
                hub.postToPanel(cockpitPanel, { command: 'addFriendState', isRunning: false });
            }

        }

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeFriendToIteration(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                                recipeFileLabel: string,
                                                workspaceRoot: string,
                                                objectApiName: string,
                                                iterationNickname: string,
                                                friendObjectApiName: string): Promise<boolean> {

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so ${friendObjectApiName} was not added. Re-open the Recipe Cockpit to load the runs currently on disk.`);
            return false;
        }

        const confirmation = await hub.confirmInPanel(
            `Add ${friendObjectApiName} under ${iterationNickname}?`,
            {
                summary: [`This writes to "${path.basename(recipeFilePath)}": a copy of the ${friendObjectApiName} block under the ${objectApiName} above ${iterationNickname}, nested under ${iterationNickname} with a nickname of its own, its lookups to that ${objectApiName} pointed at ${iterationNickname}. Every other line of the file is left as it is.`]
            },
            RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL ) {
            return false;
        }

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so ${friendObjectApiName} was not added.`);
            return false;
        }

        const insertResult = RecipeCockpitRecipeWriter.insertFriend(fs.readFileSync(recipeFilePath, 'utf-8'), objectApiName, iterationNickname, friendObjectApiName);

        if ( 'refusal' in insertResult ) {
            VSCodeWorkspaceService.showWarningMessage(`${friendObjectApiName} was not added to "${recipeFileLabel}": ${RecipeYamlScalar.escapeForNotification(insertResult.refusal.message)}`);
            return false;
        }

        fs.writeFileSync(recipeFilePath, insertResult.recipeText);

        VSCodeWorkspaceService.showInformationMessage(`Added ${friendObjectApiName} as ${insertResult.edit.friendNickname} under ${iterationNickname} in "${recipeFileLabel}".`);

        return true;

    }

    /*
        Wires a card's TODO lookups to nicknames in its recipe FILE (#151) -- the one Recipe Cockpit
        write besides Add friend, and shaped like it: the host picks the nickname (a quick pick when
        the lookup has more than one, none for "Wire TODO lookups", which only takes lookups with
        one), a modal names the file and every change, and RecipeCockpitRecipeWriter.wireLookups
        writes against the file as it is NOW, refusing the whole batch if any lookup is no longer
        what the model showed. Only a write reloads, onto the card's Treecipe tab; every other ending
        gives the wire buttons back through the closing wireLookupState.
    */
    static async wireLookupsFromPanel(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                wireAction: Extract<RecipeCockpitPanelAction, { kind: 'wireLookups' }>) {

        await this.runRecipeLookupWrite(hub, cockpitPanel, panelState, wireAction.treeKey,
            (tree, objectLevelsByApiName) => this.writeLookupWirings(hub, wireAction, tree, objectLevelsByApiName, panelState.workspaceRoot));

    }

    /*
        "Add <Parent> to recipe" (#294): the parent's block from the minimum required fields template
        of the recipe's OWN backend, and the lookup wired to it, in one write after a modal that shows
        both. Shaped like a wiring and sharing its lock, its state message and its reload.
    */
    static async addParentObjectFromPanel(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    addAction: Extract<RecipeCockpitPanelAction, { kind: 'addParentObject' }>) {

        await this.runRecipeLookupWrite(hub, cockpitPanel, panelState, addAction.treeKey,
            (tree, objectLevelsByApiName) => this.writeParentObjectAddition(hub, addAction, tree, objectLevelsByApiName, panelState.workspaceRoot));

    }

    /*
        One write to a card's recipe file at a time, for a wiring and an added parent alike. Only a
        write reloads, onto the card's Treecipe tab; every other ending gives the buttons back through
        the closing wireLookupState.
    */
    static async runRecipeLookupWrite(hub: IRecipeCockpitHubForTreecipeTab, cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                treeKey: string,
                                                write: (tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined) => Promise<boolean>,
                                                reloadFocus: Omit<IRecipeCockpitTreeFocus, 'treeKey'> = { tab: 'treecipe' }) {

        const isPanelStillCurrent = () => hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState === panelState;
        const writtenRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;
        // THE CARD AS THE CLICK SAW IT: ITS LOOKUPS DECIDE WHAT THE WRITER ACCEPTS, AND A RELOAD WHILE THE MODAL IS OPEN DOES NOT CHANGE WHAT WAS CONFIRMED
        const tree = panelState.recipeDataMessage.recipe.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const objectLevelsByApiName = panelState.objectLevelsByApiName;

        panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };
        hub.postToPanel(cockpitPanel, panelState.wireLookupStateMessage);

        try {

            const isWritten = !!tree && await write(tree, objectLevelsByApiName);

            if ( isWritten && isPanelStillCurrent() ) {
                await hub.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, writtenRunFolderName, { ...reloadFocus, treeKey: treeKey });
            }

        } finally {

            panelState.wireLookupStateMessage = undefined;

            if ( isPanelStillCurrent() ) {
                hub.postToPanel(cockpitPanel, { command: 'wireLookupState', isRunning: false });
            }

        }

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeParentObjectAddition(hub: IRecipeCockpitHubForTreecipeTab, addAction: Extract<RecipeCockpitPanelAction, { kind: 'addParentObject' }>,
                                                    tree: IRecipeCockpitTreeViewModel,
                                                    objectLevelsByApiName: Map<string, number> | undefined,
                                                    workspaceRoot: string): Promise<boolean> {

        const { recipeFilePath, addition } = addAction;
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        // THE NAMES COME FROM WORKSPACE FILES, AND A MODAL RENDERS [label](command:…) AS A LINK THAT RUNS THE COMMAND
        const parentLabel = RecipeYamlScalar.escapeForNotification(addition.parentObjectApiName);
        const objectLabel = RecipeYamlScalar.escapeForNotification(addition.objectApiName);
        const fieldLabel = `${objectLabel}${addition.objectNickname !== undefined ? ` (${RecipeYamlScalar.escapeForNotification(addition.objectNickname)})` : ''}.${RecipeYamlScalar.escapeForNotification(addition.fieldApiName)}`;
        const refusalPrefix = `${parentLabel} was not added to "${recipeFileLabel}":`;

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was added. Re-open the Recipe Cockpit to load the runs currently on disk.`);
            return false;
        }

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const fakerService = VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath);

        if ( !fakerService ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} which faker backend wrote it cannot be told from its folder and file name, so which template to use cannot be either.`);
            return false;
        }

        const parentTemplates = hub.getParentObjectTemplates(fakerService);
        const parentTemplate = Object.prototype.hasOwnProperty.call(parentTemplates, addition.parentObjectApiName) ? parentTemplates[addition.parentObjectApiName] : undefined;

        if ( !parentTemplate ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} there is no minimum required fields template for it.`);
            return false;
        }

        const templateFieldApiNames = Object.keys(parentTemplate);
        const wiringContext = hub.buildLookupWiringContext(tree, objectLevelsByApiName);
        const additionRequest = {
            objectApiName: addition.objectApiName,
            ...( addition.objectNickname !== undefined ? { objectNickname: addition.objectNickname } : {} ),
            fieldApiName: addition.fieldApiName,
            parentTemplatesByObjectApiName: { [addition.parentObjectApiName]: parentTemplate }
        };
        // ONLY A faker-js TREE NESTS (#46), SO ONLY ITS CONFIRMATION OFFERS TO NEST THE TREE UNDER THE PARENT (#405)
        const nestPlan = fakerService === 'faker-js'
            ? this.planNestedParentObjectAddition(hub, recipeFilePath, workspaceRoot, fs.readFileSync(recipeFilePath, 'utf-8'), additionRequest, wiringContext)
            : undefined;
        const describeWiredLookup = (wiredLookup: IParentObjectAdditionWiring) => `${wiredLookup.objectApiName}${wiredLookup.objectNickname !== undefined ? ` (${wiredLookup.objectNickname})` : ''}.${wiredLookup.fieldApiName}`;

        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const dialogFieldLabel = `${addition.objectApiName}${addition.objectNickname !== undefined ? ` (${addition.objectNickname})` : ''}.${addition.fieldApiName}`;
        const nestDetail = !nestPlan
            ? []
            : 'refusal' in nestPlan
                ? [`Nesting the tree under ${addition.parentObjectApiName} is not offered: ${nestPlan.refusal}`]
                : [
                    `${RECIPE_COCKPIT_ADD_PARENT_OBJECT_NEST_LABEL} instead writes ${addition.parentObjectApiName} in place of the top-level block holding ${addition.objectApiName} and moves that block (${nestPlan.nestedObjectApiNames.join(', ')}) under ${addition.parentObjectApiName}'s friends:, four spaces deeper. It wires ${nestPlan.wiredLookups.map(describeWiredLookup).join(', ')} to ${addition.parentObjectApiName}.`,
                    `Under friends:, count is records PER ${addition.parentObjectApiName} record: with ${addition.parentObjectApiName} at count 1 the totals do not change, and raising its count multiplies every nested object's records.`
                ];
        const buttonLabels = !nestPlan
            ? [RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL]
            : [RECIPE_COCKPIT_ADD_PARENT_OBJECT_TOP_LEVEL_LABEL, ...( 'refusal' in nestPlan ? [] : [RECIPE_COCKPIT_ADD_PARENT_OBJECT_NEST_LABEL] )];
        const confirmation = await hub.confirmInPanel(
            `Add ${addition.parentObjectApiName} to the recipe and wire ${dialogFieldLabel} to it?`,
            {
                // WHAT EACH OFFERED BUTTON DOES IS ON SCREEN, AND SO IS WHY NESTING IS NOT OFFERED
                summary: [
                    `${nestPlan ? `${RECIPE_COCKPIT_ADD_PARENT_OBJECT_TOP_LEVEL_LABEL} writes` : 'This writes'} to "${path.basename(recipeFilePath)}": a new top-level ${addition.parentObjectApiName} block, ahead of the block holding ${addition.objectApiName}, with one record and a nickname of its own, and ${dialogFieldLabel}'s "### TODO -- REFERENCE ID REQUIRED" line becomes that nickname. Every other line of the file is left as it is.`,
                    ...nestDetail.flatMap(nestLine => ['', nestLine])
                ],
                sections: [
                    {
                        title: `Fields of ${addition.parentObjectApiName}`,
                        ...( templateFieldApiNames.length > 0 ? { count: templateFieldApiNames.length } : {} ),
                        lines: [templateFieldApiNames.length > 0
                            ? `Fields, from the ${fakerService} minimum required fields template: ${templateFieldApiNames.join(', ')}.`
                            : `The ${fakerService} template has no required field for ${addition.parentObjectApiName}, so its block has a count only.`]
                    },
                    { title: 'What happens at insert', lines: [`Generate fake data and insert then inserts ${addition.parentObjectApiName} before ${addition.objectApiName} and points the lookup at its Id.`, `A required field your org adds to ${addition.parentObjectApiName} is not in the template: add it to the block if the insert reports it.`] }
                ]
            },
            ...buttonLabels
        );

        if ( confirmation === undefined || !buttonLabels.includes(confirmation) ) {
            return false;
        }
        const isNested = confirmation === RECIPE_COCKPIT_ADD_PARENT_OBJECT_NEST_LABEL;

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was added.`);
            return false;
        }

        const recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
        const additionResult = isNested
            ? this.planNestedParentObjectAddition(hub, recipeFilePath, workspaceRoot, recipeText, additionRequest, wiringContext)
            : RecipeCockpitRecipeWriter.addParentObject(recipeText, additionRequest, wiringContext);

        if ( 'refusal' in additionResult ) {
            const refusalMessage = typeof additionResult.refusal === 'string' ? additionResult.refusal : additionResult.refusal.message;
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} ${RecipeYamlScalar.escapeForNotification(refusalMessage)}`);
            return false;
        }

        // THE WRITER NAMES THE PARENT FROM THE FILE'S LOOKUPS AT THE CLICK; ONE THAT IS NOT THE PARENT THE READER CONFIRMED WRITES NOTHING
        if ( additionResult.parentObjectApiName !== addition.parentObjectApiName ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} ${fieldLabel} no longer points at it.`);
            return false;
        }

        // A NESTED WRITE MUST WIRE AND MOVE WHAT THE CONFIRMATION LISTED, NOT WHAT THE FILE SAYS SINCE
        if ( isNested && nestPlan && !( 'refusal' in nestPlan ) && 'wiredLookups' in additionResult
                && ( JSON.stringify(additionResult.wiredLookups) !== JSON.stringify(nestPlan.wiredLookups)
                    || JSON.stringify(additionResult.nestedObjectApiNames) !== JSON.stringify(nestPlan.nestedObjectApiNames) ) ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} the recipe changed while the confirmation was open, so what it listed to move and wire is no longer what would be written.`);
            return false;
        }

        fs.writeFileSync(recipeFilePath, additionResult.recipeText);

        VSCodeWorkspaceService.showInformationMessage(isNested
            ? `Added ${parentLabel} as ${RecipeYamlScalar.escapeForNotification(additionResult.parentNickname)} to "${recipeFileLabel}", nested ${RecipeYamlScalar.escapeForNotification(( additionResult.nestedObjectApiNames ?? [] ).join(', '))} under it and wired ${( additionResult.wiredLookups ?? [] ).length} ${( additionResult.wiredLookups ?? [] ).length === 1 ? 'lookup' : 'lookups'} to it.`
            : `Added ${parentLabel} as ${RecipeYamlScalar.escapeForNotification(additionResult.parentNickname)} to "${recipeFileLabel}" and wired ${fieldLabel} to it.`);

        return true;

    }

    /*
        The nested addition (#405) as it would be written now, or why it is not offered. Beyond the
        writer's own refusals, a moved object that the fixed-values file (#342) pins or the
        removed-TODOs file (#391) lists is refused: both record an occurrence by its place and depth,
        which the move changes, so Clear and Restore would no longer find what they wrote. A file
        beside the recipe that cannot be read is refused too, since what it holds cannot be told.
    */
    private static planNestedParentObjectAddition(hub: IRecipeCockpitHubForTreecipeTab, recipeFilePath: string,
                                            workspaceRoot: string,
                                            recipeText: string,
                                            additionRequest: IParentObjectAdditionRequest,
                                            wiringContext: ILookupWiringContext):
        Extract<RecipeParentObjectAdditionResult, { isApplied: true }> | { refusal: string } {

        const nestResult = RecipeCockpitRecipeWriter.addParentObject(recipeText, { ...additionRequest, nestTreeUnderParent: true }, wiringContext);
        if ( 'refusal' in nestResult ) {
            return { refusal: nestResult.refusal.message };
        }

        const nestedObjectApiNames = new Set(nestResult.nestedObjectApiNames);
        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const fixedValueRead = hub.readFixedValueFile(fixedValueFilePath, workspaceRoot);
        const removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);
        const removedTodoRead = hub.readRemovedTodoFile(removedTodoFilePath, workspaceRoot);

        if ( fixedValueRead.isUnreadable || removedTodoRead.isUnreadable ) {
            return { refusal: `"${path.basename(fixedValueRead.isUnreadable ? fixedValueFilePath : removedTodoFilePath)}" beside the recipe cannot be read, so whether the moved block holds what it records cannot be told.` };
        }

        const pinnedFieldLabels = fixedValueRead.entries.filter(entry => nestedObjectApiNames.has(entry.objectApiName)).map(entry => `${entry.objectApiName}.${entry.fieldApiName}`);
        if ( pinnedFieldLabels.length > 0 ) {
            return { refusal: `${pinnedFieldLabels.join(', ')} ${pinnedFieldLabels.length === 1 ? 'has a value' : 'have values'} set in the Recipe Cockpit, which Clear finds by its place in the recipe. Clear ${pinnedFieldLabels.length === 1 ? 'it' : 'them'} first to nest the tree.` };
        }

        const removedTodoLabels = hub.listRemovedTodosStillOut(recipeText, removedTodoRead.entries)
            .filter(entry => nestedObjectApiNames.has(entry.objectApiName))
            .map(entry => `${entry.objectApiName}${entry.fieldApiName !== undefined ? `.${entry.fieldApiName}` : ''}`);
        if ( removedTodoLabels.length > 0 ) {
            return { refusal: `TODO comments of ${[...new Set(removedTodoLabels)].join(', ')} were removed in the Recipe Cockpit, which Restore puts back by their place in the recipe. Restore them first to nest the tree.` };
        }

        return nestResult;

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeLookupWirings(hub: IRecipeCockpitHubForTreecipeTab, wireAction: Extract<RecipeCockpitPanelAction, { kind: 'wireLookups' }>,
                                            tree: IRecipeCockpitTreeViewModel,
                                            objectLevelsByApiName: Map<string, number> | undefined,
                                            workspaceRoot: string): Promise<boolean> {

        const { recipeFilePath, wirings, isWireAll } = wireAction;
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const describeWiring = (wiring: Pick<IRecipeCockpitLookupWiringViewModel, 'objectApiName' | 'objectNickname' | 'fieldApiName'>) => (
            `${wiring.objectApiName}${wiring.objectNickname !== undefined ? ` (${wiring.objectNickname})` : ''}.${wiring.fieldApiName}`
        );

        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was wired. Re-open the Recipe Cockpit to load the runs currently on disk.`);
            return false;
        }

        let wiringRequests: ILookupWiringRequest[];

        if ( isWireAll ) {

            wiringRequests = wirings.map(wiring => ({
                objectApiName: wiring.objectApiName,
                ...( wiring.objectNickname !== undefined ? { objectNickname: wiring.objectNickname } : {} ),
                fieldApiName: wiring.fieldApiName,
                parentNickname: wiring.candidateNicknames[0]
            }));

        } else {

            const wiring = wirings[0];
            const parentNickname = wiring.candidateNicknames.length === 1
                ? wiring.candidateNicknames[0]
                : await vscode.window.showQuickPick(wiring.candidateNicknames, {
                    title: `Wire ${describeWiring(wiring)}`,
                    placeHolder: 'The record whose nickname this lookup points at',
                    ignoreFocusOut: true
                });

            if ( parentNickname === undefined || !wiring.candidateNicknames.includes(parentNickname) ) {
                return false;
            }

            wiringRequests = [{
                objectApiName: wiring.objectApiName,
                ...( wiring.objectNickname !== undefined ? { objectNickname: wiring.objectNickname } : {} ),
                fieldApiName: wiring.fieldApiName,
                parentNickname: parentNickname
            }];

        }

        const wiringLines = wiringRequests.map(wiringRequest => `${describeWiring(wiringRequest)} → ${wiringRequest.parentNickname}`);
        const shownWiringLines = wiringLines.slice(0, RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_SHOWN);
        const unshownWiringCount = wiringLines.length - shownWiringLines.length;

        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const dialogRecipeFileLabel = path.basename(recipeFilePath);
        const confirmation = await hub.confirmInPanel(
            wiringRequests.length === 1
                ? `Wire ${describeWiring(wiringRequests[0])} to ${wiringRequests[0].parentNickname}?`
                : `Wire ${wiringRequests.length} TODO lookups?`,
            {
                summary: [
                    `This writes to "${dialogRecipeFileLabel}": each lookup's "### TODO -- REFERENCE ID REQUIRED" line becomes the nickname below, which the insert replaces with the Id of the record holding it. Every other line of the file is left as it is.`,
                    ...( isWireAll ? ['', 'A lookup with more than one record to choose from is left as it is: use its "Wire to…".'] : [] )
                ],
                sections: [
                    {
                        title: 'Lookups to wire',
                        count: wiringLines.length,
                        lines: [...shownWiringLines, ...( unshownWiringCount > 0 ? [`…and ${unshownWiringCount} more`] : [] )]
                    }
                ]
            },
            RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL ) {
            return false;
        }

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !hub.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was wired.`);
            return false;
        }

        const wiringResult = RecipeCockpitRecipeWriter.wireLookups(fs.readFileSync(recipeFilePath, 'utf-8'), wiringRequests, hub.buildLookupWiringContext(tree, objectLevelsByApiName));

        if ( 'refusal' in wiringResult ) {
            VSCodeWorkspaceService.showWarningMessage(`Nothing was wired in "${recipeFileLabel}": ${RecipeYamlScalar.escapeForNotification(wiringResult.refusal.message)}`);
            return false;
        }

        fs.writeFileSync(recipeFilePath, wiringResult.recipeText);

        VSCodeWorkspaceService.showInformationMessage(wiringResult.edits.length === 1
            ? `Wired ${describeWiring(wiringRequests[0])} to ${wiringRequests[0].parentNickname} in "${recipeFileLabel}".`
            : `Wired ${wiringResult.edits.length} lookups in "${recipeFileLabel}".`);

        return true;

    }

}
