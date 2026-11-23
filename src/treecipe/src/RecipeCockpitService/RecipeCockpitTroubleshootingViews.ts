import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecipeCockpitPermissionSetAssign } from './RecipeCockpitPermissionSetAssign';
import {
    IValidationRuleListRunRecord,
    RecipeCockpitValidationRuleList
} from './RecipeCockpitValidationRuleList';
import {
    IMetadataDeployObject,
    RecipeCockpitMetadataDeploy
} from './RecipeCockpitMetadataDeploy';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { IRecipeCockpitRunArtifactsLocation } from '../RunArtifacts/RecipeCockpitRunArtifacts';
import {
    IRunHistoryStepRecord,
    RecipeCockpitRunHistory,
    RUN_HISTORY_STEP_LABELS
} from './RecipeCockpitRunHistory';
import type {
    IRecipeCockpitHubForTroubleshootingTab,
    IRecipeCockpitTreeValidationRulesMessage,
    IRecipeCockpitTroubleshootingHistoryMessage,
    IRecipeCockpitTroubleshootingSummaryMessage,
    IRecipeCockpitValidationRuleSourceViewModel
} from './RecipeCockpitTroubleshootingHost';
import type { IRecipeCockpitPanelState } from './RecipeCockpitViewModel';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';

/*
    What the Troubleshooting tab reads and shows (#326, #327, #485; moved out of the hub by #666):
    a tree's summary, its Validation Rules list and its History, each kept per model and tree, and
    the History step a run records. The deploys, retrieves and permission set runs that refresh them
    are RecipeCockpitTroubleshootingRuns; the hub reaches all of it through
    RecipeCockpitTroubleshootingHost.
*/

// HOW MANY TREE SUMMARIES THE HOST KEEPS BEFORE IT STARTS AGAIN
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUMMARY_CACHE_LIMIT = 50;
export const RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_PREFIX = 'The validation rule file was not found for';
export const RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_ADVICE = 'It may have been moved, renamed, replaced by a link, claimed by a second file or left the workspace. Re-open the Recipe Cockpit to load the project as it is now.';

export class RecipeCockpitTroubleshootingViews {

    /*
        The Troubleshooting tab's counts (#346), read from the project's STRICT package directories
        when the tab is opened. Posted only while the model it was read for is still on screen.
        Reading every field file of a large tree takes seconds, so an answer is kept per model, tree
        and selection, a request already being read joins it, and every action that writes what it
        counts (a deploy, a retrieve, a generated permission set) clears it and posts it again.
    */
    private static troubleshootingSummaries = new Map<string, Promise<IRecipeCockpitTroubleshootingSummaryMessage>>();

    static clearTroubleshootingSummaries() {
        this.troubleshootingSummaries.clear();
    }

    static async postTroubleshootingSummary(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const panelState = hub.recipeCockpitPanelState;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeViewModel || !tree ) {
            return;
        }

        const deployObjects = hub.listTreeDeployObjects(recipeViewModel, tree);
        const summaryKey = JSON.stringify([panelState.workspaceRoot, renderSequence, treeKey, deployObjects]);
        let summaryRead = this.troubleshootingSummaries.get(summaryKey);

        if ( !summaryRead ) {
            if ( this.troubleshootingSummaries.size >= RECIPE_COCKPIT_TROUBLESHOOTING_SUMMARY_CACHE_LIMIT ) {
                this.troubleshootingSummaries.clear();
            }
            summaryRead = this.readTroubleshootingSummary(hub, panelState.workspaceRoot, treeKey, renderSequence, deployObjects);
            this.troubleshootingSummaries.set(summaryKey, summaryRead);
        }

        const summaryMessage = await summaryRead;

        // A PROJECT THAT COULD NOT BE READ IS ASKED AGAIN NEXT TIME: THE READER IS LIKELY FIXING IT
        if ( summaryMessage.failureMessage && this.troubleshootingSummaries.get(summaryKey) === summaryRead ) {
            this.troubleshootingSummaries.delete(summaryKey);
        }

        if ( hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
            hub.postToPanel(cockpitPanel, summaryMessage);
        }

    }

    private static async readTroubleshootingSummary(hub: IRecipeCockpitHubForTroubleshootingTab, workspaceRoot: string, treeKey: string, renderSequence: number, deployObjects: IMetadataDeployObject[]): Promise<IRecipeCockpitTroubleshootingSummaryMessage> {

        const summaryMessage: IRecipeCockpitTroubleshootingSummaryMessage = {
            command: 'troubleshootingSummary',
            renderSequence: renderSequence,
            treeKey: treeKey,
            permissionSetCount: 0,
            customFieldCount: 0,
            standardFieldCount: 0,
            unreadableFieldCount: 0,
            globalValueSetCount: 0,
            missingGlobalValueSetCount: 0,
            recordTypeCount: 0,
            customObjectCount: 0,
            missingCustomObjectCount: 0,
            unreadableCustomObjectCount: 0,
            validationRuleCount: 0
        };

        try {

            const packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            const summary = await RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, packageDirectoryPaths, deployObjects);
            const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(deployObjects.map(deployObject => deployObject.objectApiName), workspaceRoot, packageDirectoryPaths);

            summaryMessage.permissionSetCount = discovery.permissionSets.length;
            summaryMessage.customFieldCount = summary.customFields.length;
            summaryMessage.standardFieldCount = summary.standardFields.length;
            summaryMessage.unreadableFieldCount = summary.unreadableFields.length;
            summaryMessage.globalValueSetCount = summary.globalValueSets.length;
            summaryMessage.missingGlobalValueSetCount = summary.missingGlobalValueSets.length;
            summaryMessage.recordTypeCount = summary.recordTypes.length;
            summaryMessage.customObjectCount = summary.customObjects.length;
            summaryMessage.missingCustomObjectCount = summary.missingCustomObjects.length;
            summaryMessage.unreadableCustomObjectCount = summary.unreadableCustomObjects.length;
            summaryMessage.validationRuleCount = summary.validationRules.length;

        } catch (projectError) {

            summaryMessage.failureMessage = `Nothing can be deployed: ${RecipeCockpitUntrustedValue.describeThrown(projectError)}`;

        }

        return summaryMessage;

    }

    // AN ACTION THAT WROTE INTO THE PROJECT OR THE ORG: WHAT ITS CARD COUNTS IS READ AGAIN AND POSTED, ON WHATEVER IS ON SCREEN NOW
    static async refreshTroubleshootingSummary(hub: IRecipeCockpitHubForTroubleshootingTab, treeKey: string) {

        this.clearTroubleshootingSummaries();

        const cockpitPanel = hub.recipeCockpitPanel;
        const renderSequence = hub.recipeCockpitPanelState.recipeDataMessage?.renderSequence;

        if ( cockpitPanel && renderSequence !== undefined && hub.recipeCockpitPanelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
            await this.postTroubleshootingSummary(hub, cockpitPanel, treeKey, renderSequence);
        }

    }

    /*
        The Validation Rules list (#327): read when the sub-tab asks, from the rule files under the
        configured objects path and the run's objects wrapper, and kept per model and tree, so
        switching sub-tabs reads nothing again. A retrieve writes rule files, so it clears the list
        and posts it again; a list that could not be read is asked again next time.
    */
    private static treeValidationRuleLists = new Map<string, Promise<IRecipeCockpitTreeValidationRulesMessage>>();

    // THE RUN'S RULE RECORDS, PARSED ONCE PER MODEL RATHER THAN ONCE PER TREE, AS THE QUERY TAB SHARES ITS WRAPPER READ
    private static validationRuleRunRecordsRead: { modelKey: string; runRulesByObject: Map<string, Map<string, IValidationRuleListRunRecord>> } | undefined;

    static clearTreeValidationRuleLists() {
        this.treeValidationRuleLists.clear();
        this.validationRuleRunRecordsRead = undefined;
    }

    static async postTreeValidationRules(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const panelState = hub.recipeCockpitPanelState;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !tree ) {
            return;
        }

        const listKey = JSON.stringify([panelState.workspaceRoot, renderSequence, treeKey]);
        let listRead = this.treeValidationRuleLists.get(listKey);

        if ( !listRead ) {
            if ( this.treeValidationRuleLists.size >= RECIPE_COCKPIT_TROUBLESHOOTING_SUMMARY_CACHE_LIMIT ) {
                this.treeValidationRuleLists.clear();
            }
            listRead = this.readTreeValidationRules(hub, panelState.workspaceRoot, panelState.objectsWrapperFilePath ?? '', treeKey, renderSequence, tree.objects.map(treeObject => treeObject.objectApiName));
            // A READ THAT THREW IS NOT KEPT EITHER: EVERY STEP CATCHES, BUT A CACHED REJECTION WOULD ANSWER NOTHING FOR THE MODEL'S LIFE
            listRead.catch(() => this.treeValidationRuleLists.delete(listKey));
            this.treeValidationRuleLists.set(listKey, listRead);
        }

        const rulesMessage = await listRead;

        if ( rulesMessage.failureMessage && this.treeValidationRuleLists.get(listKey) === listRead ) {
            this.treeValidationRuleLists.delete(listKey);
        }

        if ( hub.recipeCockpitPanel === cockpitPanel && hub.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
            // A SEQUENCE PER POSTED LIST, SO THE ACK OF A LIST A RETRIEVE HAS SINCE REPLACED ACTIVATES NOTHING
            const listSequence = ++hub.recipeCockpitPanelState.validationRuleListSequence;
            hub.recipeCockpitPanelState.pendingValidationRuleListKeys.set(treeKey, {
                renderSequence: renderSequence,
                listSequence: listSequence,
                ruleKeys: ( rulesMessage.openableRules ?? [] ).map(openableRule => RecipeCockpitValidationRuleList.buildRuleSourceKey(openableRule.objectApiName, openableRule.ruleName))
            });
            hub.postToPanel(cockpitPanel, rulesMessage.openableRules ? { ...rulesMessage, listSequence: listSequence } : rulesMessage);
        }

    }

    private static async readTreeValidationRules(hub: IRecipeCockpitHubForTroubleshootingTab, workspaceRoot: string, objectsWrapperFilePath: string, treeKey: string, renderSequence: number, objectApiNames: string[]): Promise<IRecipeCockpitTreeValidationRulesMessage> {

        const rulesMessage: IRecipeCockpitTreeValidationRulesMessage = { command: 'treeValidationRules', renderSequence: renderSequence, treeKey: treeKey, objects: [] };

        let objectsDirectoryPath: string;
        try {
            objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        } catch (configurationError) {
            rulesMessage.failureMessage = `The project's validation rules could not be read: ${RecipeCockpitUntrustedValue.describeThrown(configurationError)}`;
            return rulesMessage;
        }

        const modelKey = JSON.stringify([workspaceRoot, renderSequence, objectsWrapperFilePath]);
        if ( this.validationRuleRunRecordsRead?.modelKey !== modelKey ) {
            try {
                this.validationRuleRunRecordsRead = {
                    modelKey: modelKey,
                    runRulesByObject: RecipeCockpitValidationRuleList.readRunValidationRulesByObject(JSON.parse(fs.readFileSync(objectsWrapperFilePath, 'utf-8')))
                };
            } catch (readError) {
                rulesMessage.failureMessage = `The objects wrapper "${path.basename(objectsWrapperFilePath)}" could not be read again: ${RecipeCockpitUntrustedValue.describeThrown(readError)} Run "Generate Treecipe" again.`;
                return rulesMessage;
            }
        }

        const filePathsByRuleKey = new Map<string, string>();
        rulesMessage.objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsDirectoryPath, objectApiNames, this.validationRuleRunRecordsRead.runRulesByObject, {
            workspaceRoot: workspaceRoot,
            filePathsByRuleKey: filePathsByRuleKey
        });

        // THE LINKS COME FROM WHAT THIS READ ALREADY LISTED AND RECORDED, SO NO FILE IS READ A SECOND TIME (#560)
        const openableRules: IRecipeCockpitValidationRuleSourceViewModel[] = [];
        rulesMessage.objects.forEach(listObject => new Set(listObject.rules.filter(rule => !rule.isFileMissing).map(rule => rule.ruleName)).forEach(ruleName => {
            if ( filePathsByRuleKey.has(RecipeCockpitValidationRuleList.buildRuleSourceKey(listObject.objectApiName, ruleName)) ) {
                openableRules.push({ objectApiName: listObject.objectApiName, ruleName: ruleName });
            }
        }));
        if ( openableRules.length > 0 ) {
            rulesMessage.openableRules = openableRules;
        }

        return rulesMessage;

    }

    /*
        A retrieve wrote rule files: the list is read again and posted, on whatever is on screen now,
        for the retrieving tree and every other tree whose list this model already drew -- a card
        listing the same objects would otherwise keep the old list. The run's records did not change.
    */
    static async refreshTreeValidationRules(hub: IRecipeCockpitHubForTroubleshootingTab, treeKey: string) {

        const panelState = hub.recipeCockpitPanelState;
        const cockpitPanel = hub.recipeCockpitPanel;
        const renderSequence = panelState.recipeDataMessage?.renderSequence;
        const drawnTreeKeys = new Set<string>([treeKey]);

        [...this.treeValidationRuleLists.keys()].forEach(listKey => {
            const [listWorkspaceRoot, listRenderSequence, listTreeKey] = JSON.parse(listKey) as [string, number, string];
            if ( listWorkspaceRoot === panelState.workspaceRoot && listRenderSequence === renderSequence ) {
                drawnTreeKeys.add(listTreeKey);
            }
        });

        this.treeValidationRuleLists.clear();

        if ( !cockpitPanel || renderSequence === undefined ) {
            return;
        }

        for ( const drawnTreeKey of drawnTreeKeys ) {
            if ( panelState.treeHistoryAllowLists.nameableTreeKeys.has(drawnTreeKey) ) {
                await this.postTreeValidationRules(hub, cockpitPanel, drawnTreeKey, renderSequence);
            }
        }

    }

    private static troubleshootingHistorySequence = 0;

    /*
        The Troubleshooting tab's History (#485): every Troubleshooting step of the card, from its
        tree folder's RunArtifacts in every run (the run on screen first, as the snapshots are
        listed), newest first and capped. The file paths stay on the host as a PENDING list; only
        the panel's ack of these rows opens one. A card with no folder gets nothing.
    */
    static postTroubleshootingHistory(hub: IRecipeCockpitHubForTroubleshootingTab, cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, treeKey: string) {

        const recipeDataMessage = panelState.recipeDataMessage;
        const tree = recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeDataMessage || !tree?.folderName ) {
            return;
        }

        const listing = RecipeCockpitRunHistory.listTreeHistory(hub.resolveTreeSnapshotLocations(panelState.workspaceRoot, recipeDataMessage.recipe, tree));
        const filePaths: string[] = [];
        const historyMessage: IRecipeCockpitTroubleshootingHistoryMessage = {
            command: 'troubleshootingHistory',
            renderSequence: recipeDataMessage.renderSequence,
            treeKey: treeKey,
            historySequence: ++this.troubleshootingHistorySequence,
            rows: listing.rows.map(row => {
                const orgLabel = row.orgAlias ?? row.orgUsername;
                return {
                    step: row.step,
                    stepLabel: RUN_HISTORY_STEP_LABELS[row.step],
                    status: row.status,
                    timeMs: row.timeMs,
                    timeLabel: RecipeCockpitRunHistory.formatTimeLabel(row.timeMs),
                    ...( row.finishedAtMs !== undefined ? { finishedAtMs: row.finishedAtMs, finishedAtLabel: RecipeCockpitRunHistory.formatTimeLabel(row.finishedAtMs) } : {} ),
                    runFolderName: row.runFolderName,
                    ...( orgLabel !== undefined ? { orgLabel: orgLabel } : {} ),
                    ...( row.orgUsername !== undefined ? { orgUsername: row.orgUsername } : {} ),
                    ...( row.succeededCount !== undefined ? { succeededCount: row.succeededCount } : {} ),
                    ...( row.failedCount !== undefined ? { failedCount: row.failedCount } : {} ),
                    ...( row.detail !== undefined ? { detail: row.detail } : {} ),
                    files: row.filePaths.map(filePath => ({ fileIndex: filePaths.push(filePath) - 1, fileName: path.basename(filePath) }))
                };
            }),
            hiddenRowCount: listing.hiddenRowCount
        };

        panelState.pendingHistoryFiles.set(treeKey, { historySequence: historyMessage.historySequence, filePaths: filePaths });
        hub.postToPanel(cockpitPanel, historyMessage);

    }

    // A STEP ENDED: ITS CARD'S HISTORY IS LISTED AGAIN, ONLY WHEN THIS MODEL ALREADY DREW IT
    static refreshTroubleshootingHistory(hub: IRecipeCockpitHubForTroubleshootingTab, treeKey: string) {

        const cockpitPanel = hub.recipeCockpitPanel;
        const panelState = hub.recipeCockpitPanelState;

        if ( cockpitPanel && panelState.pendingHistoryFiles.has(treeKey) ) {
            this.postTroubleshootingHistory(hub, cockpitPanel, panelState, treeKey);
        }

    }

    /*
        A step the History lists (#485): its summary, beside its files in the tree's RunArtifacts; a
        card with no folder records nothing. A detail can be the CLI's own stderr, which can echo an
        auth URL or a token, so it is redacted as the step's result file is.
    */
    static recordTroubleshootingStep(runArtifactsLocation: IRecipeCockpitRunArtifactsLocation | undefined, record: IRunHistoryStepRecord) {

        if ( runArtifactsLocation ) {
            RecipeCockpitRunHistory.writeSummary(runArtifactsLocation, record.detail === undefined ? record : { ...record, detail: ScratchOrgService.redactSecretText(record.detail) });
        }

    }

    /*
        A rule's file is found AGAIN at the click (#560): the allow-list says a drawn row named the
        rule, not where its file is now, and a file replaced by a link, moved out of the workspace or
        claimed by a second file since is not opened. It opens at the rule's formula.
    */
    static async openValidationRuleSource(workspaceRoot: string, objectApiName: string, ruleName: string) {

        const ruleLabel = RecipeYamlScalar.escapeForNotification(`${objectApiName}.${ruleName}`);
        let ruleFilePath: string | undefined;

        try {
            ruleFilePath = RecipeCockpitValidationRuleList.resolveRuleSourceFilePaths(
                ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot),
                workspaceRoot,
                new Map([[objectApiName, [ruleName]]])
            ).get(RecipeCockpitValidationRuleList.buildRuleSourceKey(objectApiName, ruleName));
        } catch {
            ruleFilePath = undefined;
        }

        const ruleXml = ruleFilePath ? RecipeCockpitValidationRuleList.readRuleFileText(ruleFilePath) : undefined;

        if ( !ruleFilePath || ruleXml === undefined ) {
            VSCodeWorkspaceService.showWarningMessage(`${RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_PREFIX} ${ruleLabel}. ${RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_ADVICE}`);
            return;
        }

        await VSCodeWorkspaceService.openFileInEditor(ruleFilePath, RecipeCockpitValidationRuleList.findFormulaLineNumber(ruleXml));

    }
}
