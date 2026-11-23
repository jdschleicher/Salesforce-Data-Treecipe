import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    COCKPIT_CONFIRM_CHANGE_ORG_LABEL,
    COCKPIT_CONFIRM_WARNINGS_LABEL,
    CockpitConfirmDialog
} from '../CockpitKit/CockpitConfirmDialog';
import { RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH } from './RecipeCockpitShellConstants';
import type { RecipeCockpitDatasetInsertStatus } from './RecipeCockpitDatasetsTabConstants';
import type { RecipeCockpitCreateParentRefusalReason } from './RecipeCockpitTreecipeFieldEditorConstants';
import {
    RECIPE_COCKPIT_EXPRESSION_OPENER,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX
} from './RecipeCockpitFieldRowsConstants';
import {
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON
} from './RecipeCockpitAdapterConstants';
import {
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS,
    RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL
} from './RecipeCockpitTroubleshootingConstants';
import type {
    RecipeCockpitTodoRemoveLock,
    RecipeCockpitTroubleshootingSubTab
} from './RecipeCockpitTroubleshootingConstants';

// THE PANEL'S INSERT STATUS UNION IS SPELLED OUT (#642); A STATUS ADDED TO DatasetInsertAttemptService WITHOUT IT FAILS HERE
type DatasetInsertStatusesMatch<Expected extends InsertAttemptStatus & RecipeCockpitDatasetInsertStatus> = Expected;
export type RecipeCockpitDatasetInsertStatusMatchesAttempts = DatasetInsertStatusesMatch<InsertAttemptStatus | RecipeCockpitDatasetInsertStatus>;

// THE PANEL'S CREATE-PARENT REFUSAL UNION IS SPELLED OUT (#653); A WRITER CODE ADDED OR RENAMED WITHOUT IT FAILS HERE
type CreateParentRefusalReasonsMatch<Expected extends CreateParentRefusalReason & RecipeCockpitCreateParentRefusalReason> = Expected;
export type RecipeCockpitCreateParentRefusalReasonMatchesWriter = CreateParentRefusalReasonsMatch<CreateParentRefusalReason | RecipeCockpitCreateParentRefusalReason>;

// THE PANEL'S LOCK UNION IS SPELLED OUT (#639); A WRITER LOCK ADDED OR RENAMED WITHOUT IT FAILS HERE
type WriterTodoRemoveLock = RecipeTodoRemoveLock | 'indistinct-occurrence';
type TodoRemoveLocksMatch<Expected extends WriterTodoRemoveLock & RecipeCockpitTodoRemoveLock> = Expected;
export type RecipeCockpitTodoRemoveLockMatchesWriter = TodoRemoveLocksMatch<WriterTodoRemoveLock | RecipeCockpitTodoRemoveLock>;
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { RecordTypeSelectionConfiguration } from '../RecordTypeSelectionService/RecordTypeSelectionConfiguration';
import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import {
    IAuthenticatedOrgDetail,
    ISalesforceCliInvocationResult
} from '../SalesforceCli/SalesforceCli';
import {
    IRecipeCockpitConfirmContent,
    IRecipeCockpitConfirmOrg,
    IRecipeCockpitConfirmRequestParts,
    RecipeCockpitConfirmContent
} from './RecipeCockpitConfirmContent';
import { RecipeCockpitValidationRuleList } from './RecipeCockpitValidationRuleList';
import {
    IMetadataDeployComponent,
    IMetadataDeployObject
} from './RecipeCockpitMetadataDeploy';
import { MetadataRetrieveDestination } from './RecipeCockpitMetadataRetrievePackage';
import {
    INormalizedOrgField,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import {
    CreateParentRefusalReason,
    ILookupWiringContext,
    IPinnedFieldRestoreRequest,
    IRecipeFilterLookup,
    IRecipeFixedValue,
    IRecipeUnconstrainedValue,
    IRemovedTodoComment,
    RecipeCockpitRecipeWriter,
    RecipeFixedValueKind,
    RecipeTodoRemoveLock
} from '../RecipeWriter/RecipeCockpitRecipeWriter';
import {
    IFixedValueEntry,
    IFixedValueFileRead
} from './RecipeCockpitFixedValueStore';
import { IRemovedTodoFileRead } from './RecipeCockpitRemovedTodoStore';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import {
    IRecordTypeSetModeOffer,
    OccurrenceSettingPlacer,
    RECORD_TYPE_SET_MODE_LABELS,
    RECORD_TYPE_SET_MODE_LEGEND,
    RecordTypeSetMode
} from './RecipeCockpitRecordTypeRecipe';
import { InsertAttemptStatus } from '../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import {
    IRecipeCockpitPanelPlace,
    RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES,
    RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY,
    RecipeCockpitPanelPlace
} from './RecipeCockpitPanelPlace';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { IRecipeFakerService } from '../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import {
    IRecipeCockpitTreeDatasetViewModel,
    RecipeCockpitTreeHistory
} from './RecipeCockpitTreeHistory';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeCockpitQueryHost } from './RecipeCockpitQueryHost';
import {
    IRecipeCockpitMetadataDeployStateMessage,
    IRecipeCockpitMetadataRetrieveStateMessage,
    RECIPE_COCKPIT_TROUBLESHOOTING_ORG_CHANGE_ACTION_KINDS,
    RecipeCockpitTroubleshootingHost
} from './RecipeCockpitTroubleshootingHost';
import { RecipeCockpitTroubleshootingRuns } from './RecipeCockpitTroubleshootingRuns';
import {
    RECIPE_COCKPIT_DATASETS_ORG_CHANGE_ACTION_KINDS,
    RecipeCockpitDatasetsHost
} from './RecipeCockpitDatasetsHost';
import { RecipeCockpitAdapterHost } from './RecipeCockpitAdapterHost';
import { RecipeCockpitAdapterState } from './RecipeCockpitAdapterState';
import { RecipeCockpitRecordLinksHost } from './RecipeCockpitRecordLinksHost';
import { RecipeCockpitCustomTreecipeHost } from './RecipeCockpitCustomTreecipeHost';
import {
    IRecipeCockpitRunArtifactsLocation,
    RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE,
    RecipeCockpitRunArtifacts
} from '../RunArtifacts/RecipeCockpitRunArtifacts';
import { IUpdateSnapshotObject } from './RecipeCockpitRecordUpdate';
import { IOrgNewFieldDetail, RecipeCockpitOrgChangeDetection } from './RecipeCockpitOrgChangeDetection';
import { RecipeService } from '../RecipeService/RecipeService';
// A RUN LOADS ITS custom- TREES IN RecipeCockpitModelBuild (#677, #671); THE HUB'S DELEGATE NAMES A DEFINITION, AND SAVING ONE IS RecipeCockpitCustomTreecipeHost's
import { ICustomTreecipeDefinition } from './RecipeCockpitCustomTreecipe';
import {
    RECIPE_COCKPIT_TREECIPE_ORG_CHANGE_ACTION_KINDS,
    RecipeCockpitTreecipeOrgHost
} from './RecipeCockpitTreecipeOrgHost';
import { RecipeCockpitTreecipeDataOrgs } from './RecipeCockpitTreecipeDataOrgs';
import { RecipeCockpitTreecipeHost } from './RecipeCockpitTreecipeHost';
import type {
    IRecipeCockpitAddableParentTarget,
    IRecipeCockpitConfirmAnswer,
    IRecipeCockpitConfirmChangeOrg,
    IRecipeCockpitConfirmOptions,
    IRecipeCockpitConfirmWithCheckboxOptions,
    IRecipeCockpitConfirmWithRecordTypeSetModesOptions,
    IRecipeCockpitCreateReadinessByTarget,
    IRecipeCockpitEmptyLookupViewModel,
    IRecipeCockpitFieldReferenceViewModel,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitLoadFailedMessage,
    IRecipeCockpitLoadedRecipe,
    IRecipeCockpitLookupWiringTarget,
    IRecipeCockpitNameEditResultMessage,
    IRecipeCockpitObjectFieldSelectionViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitOrgRecordLookupTarget,
    IRecipeCockpitOrgRecordLookupViewModel,
    IRecipeCockpitPanelCancellation,
    IRecipeCockpitPanelMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeDataMessage,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitRecordTypesFocusRequest,
    IRecipeCockpitRunFakerFilteredRecipe,
    IRecipeCockpitTodoViewModel,
    IRecipeCockpitTreeFocus,
    IRecipeCockpitTreeHistoryAllowLists,
    IRecipeCockpitTreeOccurrence,
    IRecipeCockpitTreePreferences,
    IRecipeCockpitTreeSelections,
    IRecipeCockpitTreeViewModel,
    IRecipeCockpitTroubleshootingFocusRequest,
    IRecipeCockpitWorkspaceState,
    RecipeCockpitHostMessage,
    RecipeCockpitOpenFocusRequest,
    RecipeCockpitPanelAction
} from './RecipeCockpitViewModel';
import {
    RECIPE_COCKPIT_UPDATER_FORMULA_REASON,
    RecipeCockpitModelBuild
} from './RecipeCockpitModelBuild';
import { RecipeCockpitOrgRuns } from './RecipeCockpitOrgRuns';
import { RecipeCockpitTreeSelectionStore } from './RecipeCockpitTreeSelectionStore';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';
import {
    RECIPE_COCKPIT_PANEL_TITLE,
    RecipeCockpitShell
} from './RecipeCockpitShell';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const RECIPE_COCKPIT_VIEW_TYPE = 'treecipe.recipeCockpit';

export const RECIPE_COCKPIT_LOAD_PHASES = {
    findingRuns: 'Finding generated recipe runs…',
    readingRun: 'Reading the generated recipe run…'
};

export const RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND = 'treecipe.generateTreecipe';
// THE COCKPIT RELOADS THE RUN GENERATION WROTE, SO ITS COMPLETION TOAST WOULD ONLY PULL THE READER OUT OF THE PANEL (#206)
export const RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS = { isCompletionNotificationSuppressed: true };

// ONE workspaceState WRITE OF THE PLACE (#230) PER THIS MANY ms: A RELOAD OR A CRASH MAY NEVER RUN onDidDispose, SO IT IS WRITTEN AS IT CHANGES
export const RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY = 500;

/*
    A tree card's own name and favorite (#235), kept in workspaceState by the tree's FOLDER NAME --
    the one identity a tree keeps across runs, and the one a regeneration of the same objects writes
    again -- so neither renumbers when another tree is added, and both survive a reload.
*/
export const RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY = 'treecipe.recipeCockpit.treePreferences';
// WHAT A RUN SWITCH ASKS WHEN A TREE ON SCREEN HAS A STORED SELECTION (#399)
export const RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL = 'Reset selections';
export const RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL = 'Apply same selections';
export const RECIPE_COCKPIT_TREE_PREFERENCES_VERSION = 1;

export const RECIPE_COCKPIT_INSERT_DATASET_COMMAND = 'treecipe.insertDataSetBySelectedDirectory';

export const RECIPE_COCKPIT_RECORD_TYPE_SELECTION_NOT_SAVED_MESSAGE = 'The record type selection could not be saved in treecipe.config.json, so it was used for this run only.';
/*
    Where the cockpit's tracked work lives, as a label query rather than a list of issue numbers.

    The epic and its slices are numbered, but a link to any one of them goes stale the moment a
    slice is split or a defect is filed against the panel. The label is what stays true: whatever
    carries it is what the cockpit is, has, and is missing on the day the reader clicks.
*/
export const RECIPE_COCKPIT_ISSUES_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues?q=is%3Aissue+label%3Arecipe-cockpit';

export const RECIPE_COCKPIT_HELP_GUIDE_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/docs/RECIPE-COCKPIT-GUIDE.md';

export const ENABLE_RECIPE_COCKPIT_ACTION_LABEL = 'Enable Recipe Cockpit';

export const VIEW_RECIPE_COCKPIT_ISSUES_ACTION_LABEL = 'View Known Issues';

export const RECIPE_COCKPIT_PREVIEW_WARNING_MESSAGE = 'The Recipe Cockpit is an in-development preview.';

/*
    The detail the reader accepts before the flag is written.

    It names the four things that decide whether enabling is a mistake for them: that the panel is
    deliberately incomplete rather than broken, that it can insert records into a sandbox it is
    pointed at (#180), that the switch is scoped to THIS workspace and
    reversible from settings, and where the open work is listed. The url is repeated in the text as
    well as offered as a button because a VS Code dialog renders its detail as plain text -- there
    is no clickable link in a modal, so the button is the link and this line is what a reader can
    copy if they would rather not hand the dialog a browser.
*/
export const RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL = `Every Recipe Cockpit slice ships behind this flag while the panel is being built, so what you are turning on is unfinished on purpose: it traverses a generated recipe, writes back into a recipe only when you add a friend to a nested self-lookup iteration (and asks first), and its layout, its messages and the shape of what it shows will change between releases.

It CAN WRITE TO AN ORG: the Treecipe tab's "Generate fake data and insert" generates a whole relationship tree and inserts it into the org you choose there. That picker never lists or connects to production: it offers only orgs the Salesforce CLI knows as a sandbox or a scratch org that answer when checked (Treecipe pings each authorized org once per session or per ⟳, which may renew its access token, and otherwise connects only to the org you select), and the insert is offered only for an org that reports itself as a sandbox and asks you to confirm each time. It inserts the way Insert Data Set by Directory does: you choose all-or-none, and Cancel deletes what that insert saved. The Treecipe tab's "+ New scratch org" creates a scratch org through the Dev Hub you pick from the connected Dev Hubs (every time, even when there is only one) and selects it, after you confirm; it deploys nothing to it, and the cockpit never deletes an org. "Assign permission sets to me…", on every tree's Troubleshooting tab, assigns the permission sets you pick from this workspace's source that grant access to that tree's objects to the user the org selected there is authorized as, or the user of a sandbox or scratch org you pick when none is, after a confirmation, and only once the org answers again that it is a sandbox. It deploys nothing: a permission set the org does not hold yet is named in a warning for you to deploy. "Generate permission set…" writes a permission set granting Create and Read on a tree's objects into this project's permissionsets/SDT_Treecipe folder, after a confirmation, and deploys nothing either. "Retrieve validation rules…", "Retrieve fields…", "Retrieve record types…" and "Retrieve global value sets…", on every tree, ask every time in the command palette for any connected org, production included, and retrieve that tree's validation rules, custom fields, record types or the global value sets its fields name from it into this project after a confirmation: they only read from that org and deploy nothing. The Query tab, on every tree, runs a query you can edit against the org chosen in Target Org Manager, or asks once for one when none is chosen; that is any org the picker lists, the CLI's default org included even when it is production, and no other production org: a query only reads, and what it returns is written only when you export it, under RunArtifacts in the tree folder. The Troubleshooting tab's deploy buttons ARE the cockpit's only metadata deploys: "Deploy permission set…", "Deploy fields & dependencies…" (the tree's custom fields, the custom objects that hold them and the record pages and compact layouts this project holds that those objects open, plus, only if you tick its confirmation's box, every tree object's validation rules, record types and global value sets; never a standard field, a standard object or a page layout, and any other page, component or compact layout an object names is set back to the standard one in the copy that is sent, never in your project), "Deploy global value sets…" and "Deploy record types…" each deploy just those components, through a package.xml the cockpit writes under RunArtifacts in the tree folder, to the sandbox or scratch org selected in the Org section or one you pick, after a confirmation that lists every component, and only once that org answers again that it is a sandbox. They never reach production.

Enabling applies to THIS WORKSPACE only, and nothing else in Treecipe changes. Turn it off at any time in Settings under "salesforce-data-treecipe.recipeCockpitEnabled".

What is built, what is next, and what is known to be missing are tracked under the recipe-cockpit label:
${RECIPE_COCKPIT_ISSUES_URL}`;

/*
    The version and the CHANGELOG link at the top right (#333). The URL is the HOST's: the shell's
    default-src 'none' would make a link in the panel dead, and a URL interpolated into the shell is
    an external reference the shell has none of. The panel posts "openChangelog" with nothing else,
    and this constant is the only address that message can open.
*/
export const RECIPE_COCKPIT_CHANGELOG_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/CHANGELOG.md';

// FIXED TEXT: AN ERROR'S OWN MESSAGE IS NEVER QUOTED
export const RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE = 'The Treecipe CHANGELOG was not opened: the browser did not accept the address.';

// A RELEASE VERSION, OR ONE WITH A PRE-RELEASE SUFFIX; ANYTHING ELSE IS NOT POSTED
export const RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL = 'Generate Treecipe';

export const RECIPE_COCKPIT_ADAPTER_APPLY_RUNNING_REFUSAL = 'Nothing was started: the Treecipe Adapter is applying retrieved files to this project. Try again when it ends.';
export const RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_RUNNING_REFUSAL = 'Nothing was started: Get latest detail is applying retrieved files to this project. Try again when it ends.';

// THE HEADING OF A CONFIRMATION'S CALLOUT (#457), ALWAYS ON SCREEN ABOVE ITS FOLDED SECTIONS
export const RECIPE_COCKPIT_CONFIRM_WARNINGS_LABEL = COCKPIT_CONFIRM_WARNINGS_LABEL;

// A CONFIRMATION ASKED WHILE THE COCKPIT IS HIDDEN (#349): ITS DOCUMENT IS GONE, SO NOTHING COULD SHOW IT
export const RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL = 'The Recipe Cockpit was in the background, so it could not ask you to confirm, and nothing was done. It is shown now: start the action again.';

// THE ACTIONS WHOSE CONFIRMATION OFFERS "Change org…" (#480): THE RETRIEVES, THE DEPLOYS, THE ASSIGNMENT AND THE TREE INSERT
const RECIPE_COCKPIT_ORG_CHANGE_ACTION_KINDS: ReadonlySet<string> = new Set([...RECIPE_COCKPIT_TROUBLESHOOTING_ORG_CHANGE_ACTION_KINDS, ...RECIPE_COCKPIT_DATASETS_ORG_CHANGE_ACTION_KINDS, ...RECIPE_COCKPIT_TREECIPE_ORG_CHANGE_ACTION_KINDS]);

// THE BUTTON BESIDE A CONFIRMATION'S ORG (#480), AND WHAT IT SAYS WHEN THE ACTION IS NOT STARTED AGAIN
export const RECIPE_COCKPIT_CONFIRM_CHANGE_ORG_LABEL = COCKPIT_CONFIRM_CHANGE_ORG_LABEL;
export const RECIPE_COCKPIT_CHANGE_ORG_PLACEHOLDER = 'Choose the org to run this on: it becomes the Target Org Manager selection';
export const RECIPE_COCKPIT_CHANGE_ORG_REFUSAL_PREFIX = 'The action was not started again';
export const RECIPE_COCKPIT_CHANGE_ORG_SANDBOX_ONLY_REASON = 'this action writes to the org, so it runs only in a sandbox or scratch org';
export const RECIPE_COCKPIT_CHANGE_ORG_BUSY_REFUSAL = 'The org was not changed: another run is holding the Target Org Manager selection. Try again once it has finished.';

/*
    One panel action as it runs (#480), carried by AsyncLocalStorage through every await of its
    executor. A confirmation it asks records where "Change org…" was chosen, and the action's own
    listener reads it only once the action has ENDED, its run locks released, so the action routed
    again is never refused as still running.
*/
interface IRecipeCockpitPanelActionContext {
    orgChange?: IRecipeCockpitConfirmChangeOrg;
}

interface IRecipeCockpitPendingConfirmation {
    confirmationId: string;
    buttonLabels: string[];
    hasCheckbox: boolean;
    // A CONFIRMATION THAT DREW MODES IS ANSWERED ONLY WITH ONE OF ITS ENABLED ONES
    isAskingRecordTypeSetMode: boolean;
    recordTypeSetModes: RecordTypeSetMode[];
    resolve: (answer: IRecipeCockpitConfirmAnswer) => void;
    // SET ONLY WHEN "Change org…" WAS DRAWN: WHAT IT STARTS AGAIN, AND THE ACTION THAT ASKED
    changeOrg?: IRecipeCockpitConfirmChangeOrg;
    actionContext?: IRecipeCockpitPanelActionContext;
}

export class RecipeCockpitService {

    /*
        One cockpit for the whole window, reused across invocations.

        Creating a panel per run stacks a duplicate tab each time, and every one of them holds its
        own document alive. The reference is cleared in onDidDispose so a closed panel is not
        revealed after the fact.
    */
    static recipeCockpitPanel: vscode.WebviewPanel | undefined;

    /*
        The message listener registered for the panel, disposed before it is replaced and again
        when the panel closes, so a reopened cockpit never has two listeners answering one "ready".
    */
    private static recipeCockpitMessageSubscription: vscode.Disposable | undefined;

    static recipeCockpitPanelState: IRecipeCockpitPanelState = RecipeCockpitService.buildInitialPanelState('');

    /*
        The one confirmation the panel is showing (#349). Held by the HOST only, outside the panel
        state, because answering it Cancel is what replacing that state means.
    */
    private static pendingConfirmation: IRecipeCockpitPendingConfirmation | undefined;

    private static readonly panelActionContextStorage = new AsyncLocalStorage<IRecipeCockpitPanelActionContext>();

    /*
        Which load is the current one. A run chosen while another is still loading supersedes it,
        and the superseded load must not render over the one the reader asked for last.
    */
    private static recipeCockpitLoadSequence = 0;

    private static recipeCockpitRenderSequence = 0;

    /*
        Where Data-by-Org remembers the org it last used, per workspace. Set by the command
        that opens the panel; a cockpit opened without one simply remembers nothing.
    */
    static recipeCockpitWorkspaceState: IRecipeCockpitWorkspaceState | undefined;

    /*
        The reader's place waiting to be written to workspaceState, and the timer that writes it.
        One write per RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY however often the panel saves: the
        first save starts the timer, later ones only replace what it will write.
    */
    private static pendingPersistedPanelPlace: IRecipeCockpitPanelPlace | undefined;
    private static panelPlacePersistTimer: ReturnType<typeof setTimeout> | undefined;

    // WHAT A HOST READS OF THE TREE SELECTIONS AND FIXED VALUES THROUGH ITS HUB TYPE: RecipeCockpitTreeSelectionStore OWNS IT (#671)

    static readTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitTreeSelections {
        return RecipeCockpitTreeSelectionStore.readTreeSelections(workspaceState);
    }

    static async writeTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, treeSelections: IRecipeCockpitTreeSelections): Promise<boolean> {
        return RecipeCockpitTreeSelectionStore.writeTreeSelections(workspaceState, treeSelections);
    }

    static buildObjectsByApiName(recipeViewModel: IRecipeCockpitRecipeViewModel): Map<string, IRecipeCockpitObjectViewModel> {
        return RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel);
    }

    static applyTreeObjectAndFieldSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, directlyExcludedObjectApiNames: ReadonlySet<string> | undefined, storedFieldsByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): void {
        return RecipeCockpitTreeSelectionStore.applyTreeObjectAndFieldSelection(objectsByApiName, tree, directlyExcludedObjectApiNames, storedFieldsByObject);
    }

    static applyObjectSelections(recipeViewModel: IRecipeCockpitRecipeViewModel, excludedObjectApiNamesByFolderName: Map<string, Set<string>>, excludedFieldApiNamesByFolderName?: Map<string, Map<string, Set<string>>>, onlyFolderName?: string, objectCountsByFolderName?: Map<string, Map<string, number>>, fixedValuesByFolderName?: Map<string, Map<string, Map<string, string>>>, validationRulesOffByFolderName?: Map<string, Map<string, Set<string>>>): IRecipeCockpitTreeViewModel[] {
        return RecipeCockpitTreeSelectionStore.applyObjectSelections(recipeViewModel, excludedObjectApiNamesByFolderName, excludedFieldApiNamesByFolderName, onlyFolderName, objectCountsByFolderName, fixedValuesByFolderName, validationRulesOffByFolderName);
    }

    static readFixedValueFile(fixedValueFilePath: string, workspaceRoot: string): IFixedValueFileRead {
        return RecipeCockpitTreeSelectionStore.readFixedValueFile(fixedValueFilePath, workspaceRoot);
    }

    static buildPinnedFieldRestoreRequests(entry: IFixedValueEntry, fallbackValueText: string | undefined): IPinnedFieldRestoreRequest[] {
        return RecipeCockpitTreeSelectionStore.buildPinnedFieldRestoreRequests(entry, fallbackValueText);
    }

    static resolveFixedValueKind(value: string, fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        return RecipeCockpitTreeSelectionStore.resolveFixedValueKind(value, fieldViewModel);
    }

    static findFixedValueLockReason(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {
        return RecipeCockpitTreeSelectionStore.findFixedValueLockReason(tree, objectViewModel, fieldViewModel);
    }

    static findLookupValueRefusal(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel, value: string): string | undefined {
        return RecipeCockpitTreeSelectionStore.findLookupValueRefusal(tree, objectApiName, fieldViewModel, value);
    }

    static listTreeOccurrences(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, onlyObjectApiName?: string): IRecipeCockpitTreeOccurrence[] {
        return RecipeCockpitTreeSelectionStore.listTreeOccurrences(objectsByApiName, tree, onlyObjectApiName);
    }

    static readOccurrenceNickname(objectViewModel: IRecipeCockpitObjectViewModel): string | undefined {
        return RecipeCockpitTreeSelectionStore.readOccurrenceNickname(objectViewModel);
    }

    static findObjectFieldSelection(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel): IRecipeCockpitObjectFieldSelectionViewModel | undefined {
        return RecipeCockpitTreeSelectionStore.findObjectFieldSelection(tree, objectViewModel);
    }

    static findOrgRecordLookup(tree: IRecipeCockpitTreeViewModel, objectApiName: string, fieldApiName: string, value: string | undefined): IRecipeCockpitOrgRecordLookupViewModel | undefined {
        return RecipeCockpitTreeSelectionStore.findOrgRecordLookup(tree, objectApiName, fieldApiName, value);
    }

    static findValidationRuleLockReason(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {
        return RecipeCockpitTreeSelectionStore.findValidationRuleLockReason(tree, objectViewModel, fieldViewModel);
    }

    static describeOccurrence(objectApiName: string, nickname: string | undefined): string {
        return RecipeCockpitTreeSelectionStore.describeOccurrence(objectApiName, nickname);
    }

    static validateFixedValueInput(value: string, fieldViewModel: IRecipeCockpitFieldViewModel, declaredPicklistValues: readonly string[] | undefined): string | undefined {
        return RecipeCockpitTreeSelectionStore.validateFixedValueInput(value, fieldViewModel, declaredPicklistValues);
    }

    static listSelectableFieldApiNames(objectViewModel: IRecipeCockpitObjectViewModel): string[] {
        return RecipeCockpitTreeSelectionStore.listSelectableFieldApiNames(objectViewModel);
    }

    static listExcludedObjectApiNames(tree: IRecipeCockpitTreeViewModel | undefined): string[] {
        return RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree);
    }

    static isUsableWorkspacePath(candidatePath: string, workspaceRoot: string): boolean {
        return RecipeCockpitTreeSelectionStore.isUsableWorkspacePath(candidatePath, workspaceRoot);
    }

    // WHAT workspaceState KEPT, OR NOTHING -- A PLACE THAT CANNOT BE USED IS DROPPED SO IT IS NOT READ AGAIN ON EVERY OPEN
    static readPersistedPanelPlace(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitPanelPlace | undefined {

        if ( !workspaceState ) {
            return undefined;
        }

        let storedPlace: unknown;

        try {
            storedPlace = workspaceState.get<unknown>(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY);
        } catch {
            return undefined;
        }

        if ( storedPlace === undefined ) {
            return undefined;
        }

        const persistedPlace = RecipeCockpitPanelPlace.normalize(storedPlace);

        if ( !persistedPlace ) {
            this.forgetPersistedPanelPlace(workspaceState);
        }

        return persistedPlace;

    }

    private static forgetPersistedPanelPlace(workspaceState: IRecipeCockpitWorkspaceState | undefined) {

        this.writePersistedPanelPlace(workspaceState, undefined);

    }

    private static writePersistedPanelPlace(workspaceState: IRecipeCockpitWorkspaceState | undefined, panelPlace: IRecipeCockpitPanelPlace | undefined) {

        // A PLACE THAT COULD NOT BE KEPT COSTS THE READER A RE-OPEN, NEVER THE COMMAND
        try {
            Promise.resolve(workspaceState?.update(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY, panelPlace)).catch(() => undefined);
        } catch {
            return;
        }

    }

    static schedulePanelPlacePersist(panelPlace: IRecipeCockpitPanelPlace) {

        this.pendingPersistedPanelPlace = panelPlace;

        if ( this.panelPlacePersistTimer !== undefined ) {
            return;
        }

        this.panelPlacePersistTimer = setTimeout(() => this.flushPanelPlacePersist(), RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY);

    }

    static flushPanelPlacePersist() {

        if ( this.panelPlacePersistTimer !== undefined ) {
            clearTimeout(this.panelPlacePersistTimer);
            this.panelPlacePersistTimer = undefined;
        }

        const panelPlace = this.pendingPersistedPanelPlace;
        this.pendingPersistedPanelPlace = undefined;

        if ( panelPlace ) {
            this.writePersistedPanelPlace(this.recipeCockpitWorkspaceState, panelPlace);
        }

    }

    static buildEmptyTreePreferences(): IRecipeCockpitTreePreferences {

        return { customNamesByFolderName: new Map(), favoriteFolderNames: new Set() };

    }

    /*
        The cards' names and favorites as workspaceState kept them, each entry checked on its own:
        the store is the reader's, but a name is drawn in the panel and compared with every other,
        so one that could not have been saved through the input box is dropped rather than drawn.
    */
    static readTreePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitTreePreferences {

        return this.readNamePreferences(workspaceState, RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_TREE_PREFERENCES_VERSION,
            trimmedName => this.describeTreeNameProblem(trimmedName));

    }

    // A FAILED WRITE IS SAID ONCE, AND THE CARDS ARE LEFT AS THEY WERE: A NAME THE NEXT OPEN WOULD NOT SHOW IS NOT ONE TO DRAW NOW
    static async writeTreePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined, treePreferences: IRecipeCockpitTreePreferences): Promise<boolean> {

        return this.writeNamePreferences(workspaceState, RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_TREE_PREFERENCES_VERSION, treePreferences, 'tree');

    }

    static readNamePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined,
                                        stateKey: string,
                                        stateVersion: number,
                                        describeNameProblem: (trimmedName: string) => string | undefined): IRecipeCockpitTreePreferences {

        const namePreferences = this.buildEmptyTreePreferences();
        let storedPreferences: unknown;

        try {
            storedPreferences = workspaceState?.get<unknown>(stateKey);
        } catch {
            return namePreferences;
        }

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(storedPreferences) || storedPreferences.version !== stateVersion ) {
            return namePreferences;
        }

        const storedCustomNames = RecipeCockpitUntrustedValue.isPlainRecord(storedPreferences.customNames) ? storedPreferences.customNames : {};

        Object.keys(storedCustomNames).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const customName = storedCustomNames[folderName];
            if ( RecipeCockpitPanelPlace.isBoundedText(folderName) && folderName !== '' && typeof customName === 'string'
                    && customName !== '' && customName === customName.trim() && describeNameProblem(customName) === undefined ) {
                namePreferences.customNamesByFolderName.set(folderName, customName);
            }
        });

        RecipeCockpitPanelPlace.normalizePlaceNames(storedPreferences.favoriteFolderNames).forEach(folderName => namePreferences.favoriteFolderNames.add(folderName));

        return namePreferences;

    }

    static async writeNamePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined,
                                                stateKey: string,
                                                stateVersion: number,
                                                namePreferences: IRecipeCockpitTreePreferences,
                                                namedThing: string): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage(`The Recipe Cockpit has no workspace to keep ${namedThing} names and favorites in. Open a folder and re-open the cockpit.`);
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const customNames: Record<string, string> = Object.fromEntries(namePreferences.customNamesByFolderName);

        try {
            await workspaceState.update(stateKey, {
                version: stateVersion,
                customNames: customNames,
                favoriteFolderNames: [...namePreferences.favoriteFolderNames]
            });
            return true;
        } catch (writeError) {
            VSCodeWorkspaceService.showWarningMessage(`The ${namedThing} name or favorite could not be saved: ${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}`);
            return false;
        }

    }

    // WHY A NAME CANNOT BE ANY CARD'S, WHOEVER ELSE HAS IT -- ONE LINE OF TEXT, WITHIN THE LENGTH THE HEADER IS DRAWN FOR
    static describeTreeNameProblem(trimmedName: string): string | undefined {

        return this.describeCustomNameProblem(trimmedName, 'A tree name', RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH);

    }

    static describeCustomNameProblem(trimmedName: string, nameLabel: string, maxLength: number): string | undefined {

        if ( /[\p{Cc}\u2028\u2029]/u.test(trimmedName) ) {
            return `${nameLabel} must be one line, with no control characters.`;
        }

        if ( trimmedName.length > maxLength ) {
            return `${nameLabel} can be at most ${maxLength} characters.`;
        }

        return undefined;

    }

    // THE NAMES AND FAVORITES ONTO THE CARDS, IN PLACE: EVERY CARD OF A FOLDER, AND NEVER THE UNGROUPED ONE, WHICH HAS NO FOLDER
    static applyTreePreferences(trees: IRecipeCockpitTreeViewModel[], treePreferences: IRecipeCockpitTreePreferences): IRecipeCockpitTreeViewModel[] {

        trees.forEach(tree => {

            delete tree.customName;
            delete tree.isFavorite;

            if ( tree.folderName === '' ) {
                return;
            }

            const customName = treePreferences.customNamesByFolderName.get(tree.folderName);

            if ( customName !== undefined ) {
                tree.customName = customName;
            }

            if ( treePreferences.favoriteFolderNames.has(tree.folderName) ) {
                tree.isFavorite = true;
            }

        });

        return trees;

    }

    static readObjectSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): Map<string, Set<string>> {
        return RecipeCockpitTreeSelectionStore.readTreeSelections(workspaceState).excludedObjectApiNamesByFolderName;
    }

    // THE OBJECTS ALONE, KEEPING WHATEVER FIELDS ARE STORED
    static async writeObjectSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, excludedObjectApiNamesByFolderName: Map<string, Set<string>>): Promise<boolean> {

        const storedSelections = RecipeCockpitTreeSelectionStore.readTreeSelections(workspaceState);

        return RecipeCockpitTreeSelectionStore.writeTreeSelections(workspaceState, {
            excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
            excludedFieldApiNamesByFolderName: storedSelections.excludedFieldApiNamesByFolderName,
            objectCountsByFolderName: storedSelections.objectCountsByFolderName,
            fixedValuesByFolderName: storedSelections.fixedValuesByFolderName,
            validationRulesOffByFolderName: storedSelections.validationRulesOffByFolderName
        });

    }

    static buildSelectableObjectKey(treeKey: string, objectApiName: string): string {
        return `${treeKey}\n${objectApiName}`;
    }

    // workspaceState'S SELECTIONS WITH THE PINS THE FIXED-VALUES FILES HOLD (#342) IN PLACE OF ANY IT KEPT
    static withPinnedFixedValues(treeSelections: IRecipeCockpitTreeSelections, pinnedFixedValuesByFolderName: Map<string, Map<string, Map<string, string>>> | undefined): IRecipeCockpitTreeSelections {
        return { ...treeSelections, fixedValuesByFolderName: pinnedFixedValuesByFolderName ?? new Map() };
    }

    // WHAT A HOST READS OF THE MODEL BUILD THROUGH ITS HUB TYPE: RecipeCockpitModelBuild OWNS IT (#671)
    static listRemovedTodosStillOut(recipeText: string, entries: IRemovedTodoComment[]): IRemovedTodoComment[] {
        return RecipeCockpitModelBuild.listRemovedTodosStillOut(recipeText, entries);
    }

    static readRemovedTodoFile(removedTodoFilePath: string, workspaceRoot: string): IRemovedTodoFileRead {
        return RecipeCockpitModelBuild.readRemovedTodoFile(removedTodoFilePath, workspaceRoot);
    }

    static offerStagedField(newField: IOrgNewFieldDetail, fieldApiName: string, findLockReason: (fieldViewModel: IRecipeCockpitFieldViewModel) => string | undefined, recipeService: RecipeService | undefined): { fieldViewModel: IRecipeCockpitFieldViewModel; lockReason?: string; expression?: string } {
        return RecipeCockpitModelBuild.offerStagedField(newField, fieldApiName, findLockReason, recipeService);
    }

    static getParentObjectTemplates(fakerService: 'faker-js' | 'snowfakery'): Record<string, Record<string, string>> {
        return RecipeCockpitModelBuild.getParentObjectTemplates(fakerService);
    }

    static listTreeEmptyLookups(recipeFilePath: string, tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined, alreadyReadRecipeText?: string): IRecipeCockpitEmptyLookupViewModel[] {
        return RecipeCockpitModelBuild.listTreeEmptyLookups(recipeFilePath, tree, objectLevelsByApiName, alreadyReadRecipeText);
    }

    static buildLookupWiringContext(tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined): ILookupWiringContext {
        return RecipeCockpitModelBuild.buildLookupWiringContext(tree, objectLevelsByApiName);
    }

    static readCustomTreecipeDefinition(treeFolderPath: string): ICustomTreecipeDefinition | undefined {
        return RecipeCockpitModelBuild.readCustomTreecipeDefinition(treeFolderPath);
    }

    static applyTreeSelections(recipeViewModel: IRecipeCockpitRecipeViewModel, treeSelections: IRecipeCockpitTreeSelections): IRecipeCockpitTreeViewModel[] {
        return RecipeCockpitTreeSelectionStore.applyObjectSelections(recipeViewModel, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, undefined, treeSelections.objectCountsByFolderName, treeSelections.fixedValuesByFolderName, treeSelections.validationRulesOffByFolderName);
    }

    // THE OCCURRENCE OF THE CARD'S OBJECT A MESSAGE NAMES: ITS FIRST WITHOUT A NICKNAME, ELSE THE ONE WITH THAT NICKNAME THE CARD LISTS (#467)
    static findTreeOccurrence(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                tree: IRecipeCockpitTreeViewModel,
                                objectApiName: string,
                                nickname: string | undefined): IRecipeCockpitTreeOccurrence | undefined {

        const occurrences = RecipeCockpitTreeSelectionStore.listTreeOccurrences(objectsByApiName, tree, objectApiName);
        if ( nickname === undefined ) {
            return occurrences[0];
        }
        // AN OBJECT WRITTEN ONCE KEEPS NO NICKNAME FOR ITS SETTINGS, BUT A MESSAGE MAY STILL NAME THE ONE IT IS DRAWN WITH
        return occurrences.find(occurrence => occurrence.nickname === nickname)
            ?? ( occurrences.length === 1 && occurrences[0].nickname === undefined && occurrences[0].objectViewModel.nickname === nickname ? occurrences[0] : undefined );

    }

    // WHAT A CARD GENERATES WITH, BY OBJECT -- OR OCCURRENCE KEY, FOR AN OBJECT WITH iterations (#467) -- THEN FIELD
    static listFixedValuesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, Map<string, IRecipeFixedValue>> {

        const fixedValuesByObject = new Map<string, Map<string, IRecipeFixedValue>>();
        ( tree?.fixedValues ?? [] ).forEach(fixedValue => {
            const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(fixedValue.objectApiName, fixedValue.nickname);
            const fixedValuesByField = fixedValuesByObject.get(occurrenceKey) ?? new Map<string, IRecipeFixedValue>();
            fixedValuesByField.set(fixedValue.fieldApiName, { value: fixedValue.value, kind: fixedValue.kind });
            fixedValuesByObject.set(occurrenceKey, fixedValuesByField);
        });
        return fixedValuesByObject;

    }

    // A FIELD OF A CARD AS THE MODEL ON SCREEN DRAWS IT -- WITH A LINE IN THE RECIPE -- OR undefined
    static findDrawnField(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, fieldApiName: string):
        { tree: IRecipeCockpitTreeViewModel; objectViewModel: IRecipeCockpitObjectViewModel; fieldViewModel: IRecipeCockpitFieldViewModel } | undefined {

        const tree = recipeViewModel?.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const objectViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === objectApiName);
        const fieldViewModel = objectViewModel?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);

        return tree && objectViewModel && fieldViewModel ? { tree: tree, objectViewModel: objectViewModel, fieldViewModel: fieldViewModel } : undefined;

    }

    /*
        The occurrence of a card's object a panel message names (#467), as the model on screen draws
        it: no nickname is the object's first occurrence; a nickname must be one of its occurrences the
        card lists. nickname in the answer is the one its settings are kept by -- undefined for an
        object written once.
    */
    static resolvePostedOccurrence(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, postedNickname: unknown):
        { tree: IRecipeCockpitTreeViewModel; occurrence: IRecipeCockpitTreeOccurrence } | undefined {

        if ( !recipeViewModel || ( postedNickname !== undefined && typeof postedNickname !== 'string' ) ) {
            return undefined;
        }

        const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const occurrence = tree ? this.findTreeOccurrence(RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel), tree, objectApiName, postedNickname as string | undefined) : undefined;

        return tree && occurrence ? { tree: tree, occurrence: occurrence } : undefined;

    }

    // A FIELD OF ONE OCCURRENCE AS THE MODEL ON SCREEN DRAWS IT -- WITH A LINE IN THAT OCCURRENCE -- AND THE OBJECT'S OWN FIELD, WHICH HOLDS WHAT GENERATE TREECIPE WROTE
    static findDrawnOccurrenceField(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, postedNickname: unknown, fieldApiName: string):
        { tree: IRecipeCockpitTreeViewModel; occurrence: IRecipeCockpitTreeOccurrence; objectViewModel: IRecipeCockpitObjectViewModel; fieldViewModel: IRecipeCockpitFieldViewModel; generatedFieldViewModel: IRecipeCockpitFieldViewModel } | undefined {

        const resolved = this.resolvePostedOccurrence(recipeViewModel, treeKey, objectApiName, postedNickname);
        const fieldViewModel = resolved?.occurrence.objectViewModel.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);
        const generatedFieldViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === objectApiName)?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName);

        return resolved && fieldViewModel
            ? { tree: resolved.tree, occurrence: resolved.occurrence, objectViewModel: resolved.occurrence.objectViewModel, fieldViewModel: fieldViewModel, generatedFieldViewModel: generatedFieldViewModel ?? fieldViewModel }
            : undefined;

    }

    /*
        What the copy writes for each field whose rules are off: both values as the wrapper recorded
        them, so the writer swaps only lines that still hold what the rules wrote. A field the rules
        did not change (an ISBLANK rule) has nothing to swap and is left out.
    */
    static listUnconstrainedValuesByObject(recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): Map<string, Map<string, IRecipeUnconstrainedValue>> {

        const unconstrainedValuesByObject = new Map<string, Map<string, IRecipeUnconstrainedValue>>();
        ( tree.validationRulesOff ?? [] ).forEach(fieldReference => {
            const validationRules = this.findDrawnField(recipeViewModel, tree.treeKey, fieldReference.objectApiName, fieldReference.fieldApiName)?.fieldViewModel.validationRules;
            if ( validationRules?.recipeValue === undefined || validationRules.unconstrainedRecipeValue === undefined
                    || validationRules.recipeValue === validationRules.unconstrainedRecipeValue ) {
                return;
            }
            const occurrenceKey = RecipeCockpitRecipeWriter.buildOccurrenceKey(fieldReference.objectApiName, fieldReference.nickname);
            const valuesByField = unconstrainedValuesByObject.get(occurrenceKey) ?? new Map<string, IRecipeUnconstrainedValue>();
            valuesByField.set(fieldReference.fieldApiName, { constrainedValue: validationRules.recipeValue, unconstrainedValue: validationRules.unconstrainedRecipeValue });
            unconstrainedValuesByObject.set(occurrenceKey, valuesByField);
        });

        return unconstrainedValuesByObject;

    }

    // WHAT A CARD GENERATES WITH: ITS CHANGED COUNTS, BY OBJECT OR OCCURRENCE KEY (#467), NEVER AN EXCLUDED OBJECT'S, WHICH IS NOT GENERATED AT ALL
    static listObjectCountsByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, number> {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));

        return new Map(( tree?.objectCounts ?? [] )
            .filter(objectCount => !excludedObjectApiNames.has(objectCount.objectApiName))
            .map(objectCount => [RecipeCockpitRecipeWriter.buildOccurrenceKey(objectCount.objectApiName, objectCount.nickname), objectCount.count]));

    }

    /*
        Every field a card leaves out of generation by object, never an excluded object's, which goes
        whole. An object with iterations lists every field ANY of its occurrences leaves out (#467):
        what the insert's readiness reads, which refuses an unticked field the org requires wherever
        it is unticked.
    */
    static listExcludedFieldApiNamesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, string[]> {

        const excludedFieldApiNamesByObject = new Map<string, string[]>();
        this.listExcludedFieldApiNamesByOccurrence(tree).forEach((fieldApiNames, occurrenceKey) => {
            const objectApiName = RecipeCockpitRecipeWriter.parseOccurrenceKey(occurrenceKey).objectApiName;
            excludedFieldApiNamesByObject.set(objectApiName, [...new Set([...( excludedFieldApiNamesByObject.get(objectApiName) ?? [] ), ...fieldApiNames])]);
        });
        return excludedFieldApiNamesByObject;

    }

    // WHAT THE FILTERED COPY LEAVES OUT, BY OBJECT OR, FOR AN OBJECT WITH iterations, BY OCCURRENCE KEY (#467)
    static listExcludedFieldApiNamesByOccurrence(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, string[]> {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));

        return new Map(( tree?.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => objectFieldSelection.excludedFieldApiNames.length > 0 && !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => [RecipeCockpitRecipeWriter.buildOccurrenceKey(objectFieldSelection.objectApiName, objectFieldSelection.nickname), [...objectFieldSelection.excludedFieldApiNames]]));

    }

    static buildSelectableFieldKey(treeKey: string, objectApiName: string, fieldApiName: string): string {
        return `${treeKey}\n${objectApiName}\n${fieldApiName}`;
    }

    // AN ITERATION IS NO PART OF THE OBJECT CASCADE (#467), SO ONE WITH NO FIELD TICKED IS LEFT OUT ON ITS OWN, BY ITS OCCURRENCE KEY (#611)
    static listNoFieldsSelectedIterationKeys(tree: IRecipeCockpitTreeViewModel | undefined): string[] {

        const excludedObjectApiNames = new Set(RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree));
        const iterationKeys = new Set(( tree?.objects ?? [] )
            .filter(treeObject => treeObject.iterationNickname !== undefined)
            .map(treeObject => RecipeCockpitRecipeWriter.buildOccurrenceKey(treeObject.objectApiName, treeObject.iterationNickname)));

        return ( tree?.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => objectFieldSelection.isEveryFieldExcluded && !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => RecipeCockpitRecipeWriter.buildOccurrenceKey(objectFieldSelection.objectApiName, objectFieldSelection.nickname))
            .filter(occurrenceKey => iterationKeys.has(occurrenceKey));

    }

    static buildPicklistChoiceExpression(fakerService: 'faker-js' | 'snowfakery', picklistValues: string[], fieldViewModel: IRecipeCockpitFieldViewModel): string {

        const recipeFakerService: IRecipeFakerService = fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService();
        return recipeFakerService.buildPicklistChoiceExpression(picklistValues, fieldViewModel.fieldType === 'MultiselectPicklist');

    }

    /*
        The choice the field's GENERATED line makes (#465): its first "${{ ... }}" line, unquoted
        when a validation rule wrote it double-quoted, read back as a choice. undefined when that
        line is not one (a TODO, a hand edit), so nothing is claimed about what it generates.
    */
    static readGeneratedPicklistChoice(fieldViewModel: IRecipeCockpitFieldViewModel, declaredPicklistValues: readonly string[]): string[] | undefined {

        const expressionLine = String(fieldViewModel.recipeValue ?? '').split(/\r?\n/)
            .map(valueLine => this.unquoteExpressionLine(valueLine.trim()))
            .find(valueLine => valueLine.startsWith(RECIPE_COCKPIT_EXPRESSION_OPENER));

        return expressionLine === undefined ? undefined : this.recoverPicklistValueChoice(expressionLine, declaredPicklistValues, fieldViewModel);

    }

    private static unquoteExpressionLine(valueLine: string): string {

        if ( valueLine.length < 2 || !valueLine.startsWith('"') || !valueLine.endsWith('"') ) {
            return valueLine;
        }
        // A LINE OPENING AND CLOSING ON A DOUBLE QUOTE PARSES ONLY AS A STRING, OR NOT AT ALL
        try {
            return String(JSON.parse(valueLine));
        } catch {
            return valueLine;
        }

    }

    /*
        Which values an edit ticks (#465), or undefined when the edit is not a choice of them. Read
        back by BUILDING: the values whose literal the expression holds, in declared order, must build
        the expression exactly with one backend, so a hand-written expression is never read as a
        choice it only resembles.
    */
    static recoverPicklistValueChoice(expression: string, declaredPicklistValues: readonly string[], fieldViewModel: IRecipeCockpitFieldViewModel): string[] | undefined {

        const literalBuilders: { fakerService: 'faker-js' | 'snowfakery'; buildLiteral: (picklistValue: string) => string }[] = [
            { fakerService: 'faker-js', buildLiteral: picklistValue => `\`${FakerJSRecipeFakerService.escapePicklistValueForJavaScriptString(picklistValue, '`')}\`` },
            { fakerService: 'snowfakery', buildLiteral: picklistValue => `'${SnowfakeryRecipeFakerService.escapePicklistValueForJinjaStringLiteral(picklistValue)}'` }
        ];

        for ( const literalBuilder of literalBuilders ) {
            const chosenValues = declaredPicklistValues.filter(declaredValue => expression.includes(literalBuilder.buildLiteral(declaredValue)));
            if ( chosenValues.length > 0 && this.buildPicklistChoiceExpression(literalBuilder.fakerService, chosenValues, fieldViewModel) === expression ) {
                return chosenValues;
            }
        }

        return undefined;

    }

    // WHAT A CARD'S EDIT OF A PICKLIST TICKS (#465), FOR THE TILES THAT ASKED; NOTHING FOR A CARD OR FIELD NOT ON SCREEN, OR NO EDIT
    static readPicklistValueChoice(recipeViewModel: IRecipeCockpitRecipeViewModel,
                                    treeKey: string,
                                    objectApiName: string,
                                    fieldApiName: string,
                                    declaredPicklistValues: readonly string[],
                                    nickname?: string): { treeKey?: string; chosenPicklistValues?: string[]; isOtherEdit?: true; isEdited?: true } {

        const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        if ( !tree ) {
            return {};
        }

        // THE OCCURRENCE THE TILES WERE OPENED ON (#467): ITS OWN EDIT AND ITS OWN GENERATED LINE
        const drawnField = this.findDrawnOccurrenceField(recipeViewModel, treeKey, objectApiName, nickname, fieldApiName);
        if ( !drawnField ) {
            return { treeKey: treeKey };
        }
        const fieldViewModel = drawnField.fieldViewModel;
        const occurrenceNickname = drawnField.occurrence.nickname;
        const fixedValue = ( tree.fixedValues ?? [] ).find(candidate => candidate.objectApiName === objectApiName && candidate.nickname === occurrenceNickname && candidate.fieldApiName === fieldApiName);
        if ( !fixedValue ) {
            const generatedChoice = this.readGeneratedPicklistChoice(fieldViewModel, declaredPicklistValues);
            return generatedChoice ? { treeKey: treeKey, chosenPicklistValues: generatedChoice } : { treeKey: treeKey };
        }

        const chosenPicklistValues = fixedValue.kind === 'expression' ? this.recoverPicklistValueChoice(fixedValue.value, declaredPicklistValues, fieldViewModel) : undefined;
        return chosenPicklistValues ? { treeKey: treeKey, chosenPicklistValues: chosenPicklistValues, isEdited: true } : { treeKey: treeKey, isOtherEdit: true, isEdited: true };

    }

    // A PICKLIST'S ACTIVE VALUES AND EVERY RECORD TYPE'S, FROM THE HOST-ONLY DISPLAY COPY; undefined FOR A FIELD THAT IS NOT A PICKLIST
    static listDeclaredPicklistValues(panelState: IRecipeCockpitPanelState, objectApiName: string, fieldApiName: string): string[] | undefined {

        const picklistDisplayValues = panelState.picklistDisplayValuesByObjectApiName.get(objectApiName)?.get(fieldApiName);

        return picklistDisplayValues
            ? [...picklistDisplayValues.picklistValues, ...picklistDisplayValues.recordTypePicklistValues.flatMap(recordTypeValues => recordTypeValues.picklistValues)]
            : undefined;

    }

    // THE FOLDERS OF THE TREES ON SCREEN THAT HOLD AN EXCLUDED OBJECT, AN UNTICKED FIELD, A COUNT OR A RULE SWITCHED OFF
    static listFolderNamesWithStoredSelections(recipeViewModel: IRecipeCockpitRecipeViewModel, treeSelections: IRecipeCockpitTreeSelections): string[] {

        const folderNames = new Set(recipeViewModel.trees.map(tree => tree.folderName).filter(folderName => !!folderName));

        return [...folderNames].filter(folderName => (
            treeSelections.excludedObjectApiNamesByFolderName.has(folderName)
                || treeSelections.excludedFieldApiNamesByFolderName.has(folderName)
                || treeSelections.objectCountsByFolderName.has(folderName)
                || treeSelections.validationRulesOffByFolderName.has(folderName)
        ));

    }

    /*
        A run switch (#399): selections are kept by tree FOLDER, so a tree of the next run with the same
        folder would take them over unseen. When a tree on screen holds one, the reader chooses: Reset
        clears every such folder of the run on screen, Apply (offered only when a tree of the next run
        has one of those folders) keeps them, and Cancel keeps the run on screen. Pins and edited
        expressions are in the recipe files (#342), so neither choice touches them.
    */
    static async confirmRunSwitchSelections(panelState: IRecipeCockpitPanelState, loadedRecipe: IRecipeCockpitLoadedRecipe): Promise<boolean> {

        const currentRecipe = panelState.recipeDataMessage?.recipe;
        const nextRecipe = loadedRecipe.recipeViewModel;

        if ( !currentRecipe || currentRecipe.selectedRunFolderName === nextRecipe.selectedRunFolderName ) {
            return true;
        }

        const storedFolderNames = this.listFolderNamesWithStoredSelections(currentRecipe, RecipeCockpitTreeSelectionStore.readTreeSelections(this.recipeCockpitWorkspaceState));

        if ( storedFolderNames.length === 0 ) {
            return true;
        }

        const storedFolderNameSet = new Set(storedFolderNames);
        const matchingTreeCount = nextRecipe.trees.filter(tree => !!tree.folderName && storedFolderNameSet.has(tree.folderName)).length;
        const nextRunLabel = nextRecipe.runs.find(run => run.runFolderName === nextRecipe.selectedRunFolderName)?.label ?? nextRecipe.selectedRunFolderName;
        const storedTreeText = storedFolderNames.length === 1 ? '1 tree on screen has' : `${storedFolderNames.length} trees on screen have`;
        const matchingText = matchingTreeCount === 0
            ? 'No tree of that run has the same folder name, so the selections cannot be applied to it.'
            : `${matchingTreeCount === 1 ? '1 tree' : `${matchingTreeCount} trees`} of that run ${matchingTreeCount === 1 ? 'has' : 'have'} the same folder name. Apply same selections keeps them for ${matchingTreeCount === 1 ? 'it' : 'those trees'}; a selection naming an object or field that run does not have is ignored.`;
        const buttonLabels = matchingTreeCount > 0
            ? [RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL, RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL]
            : [RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL];

        // THE STATUS LINE WOULD OTHERWISE SAY "READING" FOR AS LONG AS THE QUESTION IS OPEN
        panelState.loadPhaseMessage = '';
        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, { command: 'loadPhase', message: '' });
        }

        const confirmation = await this.confirmInPanel(
            `Switch to ${nextRunLabel}?`,
            {
                summary: [`${storedTreeText} excluded objects, unticked fields, record counts or validation rules switched off.`, '', matchingText],
                sections: [
                    { title: 'Trees with selections', count: storedFolderNames.length, lines: storedFolderNames },
                    { title: 'What each choice does', lines: ['Reset selections clears them for every tree on screen.', 'Fixed values and edited expressions are written in each recipe file, so neither choice changes them.'] }
                ]
            },
            ...buttonLabels
        );

        if ( confirmation === RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL && matchingTreeCount > 0 ) {
            return true;
        }

        if ( confirmation !== RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL ) {
            return false;
        }

        // READ AGAIN AFTER THE DIALOG: A CHOICE MADE ELSEWHERE WHILE IT WAS OPEN IS NOT WRITTEN BACK
        const currentSelections = RecipeCockpitTreeSelectionStore.readTreeSelections(this.recipeCockpitWorkspaceState);
        storedFolderNames.forEach(folderName => {
            currentSelections.excludedObjectApiNamesByFolderName.delete(folderName);
            currentSelections.excludedFieldApiNamesByFolderName.delete(folderName);
            currentSelections.objectCountsByFolderName.delete(folderName);
            currentSelections.validationRulesOffByFolderName.delete(folderName);
        });

        // A RESET THAT COULD NOT BE SAVED WOULD LET THE NEXT RUN TAKE THE SELECTIONS OVER, SO THE RUN ON SCREEN STAYS
        return RecipeCockpitTreeSelectionStore.writeTreeSelections(this.recipeCockpitWorkspaceState, currentSelections);

    }

    // THE CUSTOM TREE A RUN SHOWS INSTEAD OF ITS OWN TREES (#677), KEPT WHILE THE SAME RUN RELOADS; A RUN WITH NONE SHOWS ITS TREES
    static readonly selectedCustomTreeFolderNameByRunFolderName = new Map<string, string>();

    // ONE RUN PICKER ENTRY: THE RUN, OR "<run>/<custom tree>" -- A FOLDER NAME NEVER HOLDS A "/"
    static buildRunPickerKey(runFolderName: string, customTreeFolderName?: string): string {
        return customTreeFolderName === undefined ? runFolderName : `${runFolderName}/${customTreeFolderName}`;
    }

    // THE SAME FOR THE CARDS ONE PREDICATE PICKS
    static async refreshDataOrgReadinessForTrees(cockpitPanel: vscode.WebviewPanel,
                                                            panelState: IRecipeCockpitPanelState,
                                                            isTreeRefreshed: (tree: IRecipeCockpitTreeViewModel) => boolean) {

        const dataOrgSelection = panelState.dataOrgSelection;
        const recipeDataMessage = panelState.recipeDataMessage;

        if ( !dataOrgSelection || dataOrgSelection.orgTypeDetail?.isSandbox !== true || !recipeDataMessage ) {
            return;
        }

        const requestSequence = dataOrgSelection.requestSequence;
        const isRefreshCurrent = () => this.recipeCockpitPanel === cockpitPanel
                                        && this.recipeCockpitPanelState === panelState
                                        && panelState.dataOrgSelection === dataOrgSelection
                                        && panelState.dataOrgRequestSequence === requestSequence
                                        && panelState.recipeDataMessage === recipeDataMessage;

        const folderRecipeDataMessage: IRecipeCockpitRecipeDataMessage = {
            ...recipeDataMessage,
            recipe: { ...recipeDataMessage.recipe, trees: recipeDataMessage.recipe.trees.filter(isTreeRefreshed) }
        };
        const createTargets = ( await RecipeCockpitTreecipeDataOrgs.collectCreateTargets(this, panelState, folderRecipeDataMessage) )
            .filter(createTarget => panelState.dataOrgObjectApiNames.has(createTarget.objectApiName));

        if ( !isRefreshCurrent() || createTargets.length === 0 ) {
            return;
        }

        let readinessByTarget: IRecipeCockpitCreateReadinessByTarget;
        try {
            readinessByTarget = await RecipeCockpitTreecipeDataOrgs.computeCreateReadinessByTarget(
                dataOrgSelection.orgDetail.username,
                () => SalesforceOrgService.getConnection(dataOrgSelection.orgDetail.username),
                [...new Set(createTargets.map(createTarget => createTarget.objectApiName))],
                dataOrgSelection.orgTypeDetail,
                createTargets,
                () => !isRefreshCurrent()
            );
        } catch {
            // THE NEXT SELECTION OR ⟳ CHECKS AGAIN; A PERFORM-TIME CREATE RE-CHECKS WHATEVER THIS LEFT ON SCREEN
            return;
        }

        if ( !isRefreshCurrent() ) {
            return;
        }

        this.postToPanel(cockpitPanel, {
            command: 'dataOrgReadiness',
            objects: [...readinessByTarget.byObjectApiName.values()],
            createTargets: [...readinessByTarget.byCreateKey.values()],
            requestSequence: requestSequence,
            renderSequence: recipeDataMessage.renderSequence
        });

    }

    /*
        What the generate button runs for a card with exclusions (#219): the filtered copy of its recipe, or
        why there is none. Read at the click from the stored model, which is what the card shows.
    */
    static buildRunFakerFilteredRecipe(recipeText: string,
                                        tree: IRecipeCockpitTreeViewModel,
                                        objectLevelsByApiName: Map<string, number> | undefined,
                                        recipeViewModel: IRecipeCockpitRecipeViewModel,
                                        settingPlacer?: OccurrenceSettingPlacer): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } {

        // A RECIPE BUILT FOR THE TICKED RECORD TYPES (#623) NAMES ITS BLOCKS ANEW, SO EACH SETTING IS PLACED ON THE BLOCK IT NOW BELONGS TO
        const placeKeys = <T>(settingsByKey: Map<string, T>) => settingPlacer ? settingPlacer.placeKeys(settingsByKey) : settingsByKey;
        const excludedObjectApiNames = RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree);
        const placedExcludedFieldApiNames = placeKeys(this.listExcludedFieldApiNamesByOccurrence(tree));
        const excludedFieldApiNamesByObject = settingPlacer ? settingPlacer.keepRecordTypeIdOfChoiceObjects(placedExcludedFieldApiNames) : placedExcludedFieldApiNames;
        const objectCountsByObject = settingPlacer ? settingPlacer.placeCounts(this.listObjectCountsByObject(tree)) : this.listObjectCountsByObject(tree);
        const fixedValuesByObject = placeKeys(this.listFixedValuesByObject(tree));
        const unconstrainedValuesByObject = placeKeys(this.listUnconstrainedValuesByObject(recipeViewModel, tree));
        const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => parentLookupsByObjectApiName.set(treeObject.objectApiName, treeObject.parentLookups.map(parentLookup => ({ ...parentLookup }))));

        const noFieldsSelectedIterationKeys = [...placeKeys(new Map(this.listNoFieldsSelectedIterationKeys(tree).map(iterationKey => [iterationKey, true]))).keys()];
        const filterResult = RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: excludedObjectApiNames,
            ...( noFieldsSelectedIterationKeys.length > 0 ? { excludedOccurrenceKeys: noFieldsSelectedIterationKeys } : {} ),
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            levelsByObjectApiName: objectLevelsByApiName,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject,
            objectCountsByObject: objectCountsByObject,
            fixedValuesByObject: fixedValuesByObject,
            unconstrainedValuesByObject: unconstrainedValuesByObject
        });

        if ( 'refusal' in filterResult ) {
            return { refusalMessage: filterResult.refusal.message };
        }

        return {
            recipeText: filterResult.recipeText,
            excludedObjectApiNames: excludedObjectApiNames,
            ...( excludedFieldApiNamesByObject.size > 0 ? { excludedFieldApiNamesByObject: Object.fromEntries(excludedFieldApiNamesByObject) } : {} ),
            ...( filterResult.appliedCounts.length > 0 ? { objectCountsByObject: Object.fromEntries(filterResult.appliedCounts.map(appliedCount => [appliedCount.objectApiName, appliedCount.count])) } : {} ),
            ...( filterResult.appliedFixedValues.length > 0 ? { fixedValuesByObject: this.groupAppliedFixedValues(filterResult.appliedFixedValues) } : {} ),
            ...( filterResult.appliedUnconstrainedValues.length > 0 ? { validationRulesOffByObject: this.groupFieldReferences(filterResult.appliedUnconstrainedValues) } : {} )
        };

    }

    // fromEntries, SO AN OBJECT NAMED __proto__ IS RECORDED RATHER THAN SET AS A PROTOTYPE
    static groupFieldReferences(fieldReferences: IRecipeCockpitFieldReferenceViewModel[]): Record<string, string[]> {

        const objectApiNames = [...new Set(fieldReferences.map(fieldReference => fieldReference.objectApiName))];

        return Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, fieldReferences
            .filter(fieldReference => fieldReference.objectApiName === objectApiName)
            .map(fieldReference => fieldReference.fieldApiName)]));

    }

    // fromEntries DEFINES EACH KEY, SO AN OBJECT OR FIELD NAMED __proto__ IS RECORDED RATHER THAN SET AS A PROTOTYPE
    static groupAppliedFixedValues(appliedFixedValues: Array<{ objectApiName: string; fieldApiName: string; value: string }>): Record<string, Record<string, string>> {

        const objectApiNames = [...new Set(appliedFixedValues.map(appliedFixedValue => appliedFixedValue.objectApiName))];

        return Object.fromEntries(objectApiNames.map(objectApiName => [objectApiName, Object.fromEntries(appliedFixedValues
            .filter(appliedFixedValue => appliedFixedValue.objectApiName === objectApiName)
            .map(appliedFixedValue => [appliedFixedValue.fieldApiName, appliedFixedValue.value]))]));

    }

    static buildEmptyTreeHistoryAllowLists(): IRecipeCockpitTreeHistoryAllowLists {

        return {
            openableDatasetFolderNames: new Set(),
            insertableDatasetFolderNames: new Set(),
            countableDatasetFolderNames: new Set(),
            viewableInsertResultsDatasetFolderNames: new Set(),
            nameableTreeKeys: new Set(),
            nameableDatasetFolderNames: new Set(),
            selectableObjectKeys: new Set(),
            selectableFieldKeys: new Set(),
            selectableRecordTypeKeys: new Set(),
            removableTodoKeys: new Set(),
            restorableTodoKeys: new Set()
        };

    }

    static isTreeFocus(focusRequest: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest): focusRequest is IRecipeCockpitTreeFocus {

        return typeof (focusRequest as IRecipeCockpitTreeFocus).treeKey === 'string';

    }

    static isTroubleshootingFocusRequest(focusRequest: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest): focusRequest is IRecipeCockpitTroubleshootingFocusRequest {

        return typeof (focusRequest as IRecipeCockpitTroubleshootingFocusRequest).treeFolderName === 'string';

    }

    /*
        The options "treecipe.openRecipeCockpit" was run with. The command is callable by id, so only
        { focusRecordTypes: true } asks for the Record types section, and an object name is kept only
        if it is an api name -- it is matched against the loaded model and scrolled to, never opened.
    */
    static readRecordTypesFocusRequest(openOptions: unknown): IRecipeCockpitRecordTypesFocusRequest | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(openOptions) || openOptions.focusRecordTypes !== true ) {
            return undefined;
        }

        return SalesforceApiName.isApiName(openOptions.objectApiName) ? { objectApiName: openOptions.objectApiName } : {};

    }

    /*
        The first card whose Record types section lists the object, opened there and scrolled to it;
        with no object, or one no card lists, the first card that draws the section at all.
        Undefined when no card does.
    */
    static resolveRecordTypesFocus(recipeViewModel: IRecipeCockpitRecipeViewModel, focusRequest: IRecipeCockpitRecordTypesFocusRequest): IRecipeCockpitTreeFocus | undefined {

        const objectsByApiName = RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel);
        const listsRecordTypeObject = (tree: IRecipeCockpitTreeViewModel, objectApiName?: string) => tree.objects.some(treeObject =>
            ( objectApiName === undefined || treeObject.objectApiName === objectApiName )
            && !!objectsByApiName.get(treeObject.objectApiName)?.recordTypes);

        const objectTree = focusRequest.objectApiName !== undefined
            ? recipeViewModel.trees.find(tree => listsRecordTypeObject(tree, focusRequest.objectApiName))
            : undefined;
        if ( objectTree ) {
            return { treeKey: objectTree.treeKey, tab: 'treecipe', recordTypes: { objectApiName: focusRequest.objectApiName } };
        }

        const anyTree = recipeViewModel.trees.find(tree => listsRecordTypeObject(tree));
        return anyTree ? { treeKey: anyTree.treeKey, tab: 'treecipe', recordTypes: {} } : undefined;

    }

    // EVERY HISTORY ACTION THE RENDERED MODEL OFFERS, BY NAME, AND NOTHING ELSE
    static collectTreeHistoryAllowLists(recipeViewModel: IRecipeCockpitRecipeViewModel, runFakerRecipeFilePathsByTreeKey: ReadonlyMap<string, string> = new Map()): IRecipeCockpitTreeHistoryAllowLists {

        const treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        const objectsByApiName = RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            tree.objects
                .map(treeObject => objectsByApiName.get(treeObject.objectApiName))
                .filter((objectViewModel): objectViewModel is IRecipeCockpitObjectViewModel => !!objectViewModel?.recordTypes)
                .forEach(objectViewModel => {
                    objectViewModel.recordTypes.forEach(recordType => treeHistoryAllowLists.selectableRecordTypeKeys.add(this.buildSelectableRecordTypeKey(objectViewModel.objectApiName, recordType.developerName)));
                });

            this.collectRemovableTodoLineNumbers(objectsByApiName, tree, runFakerRecipeFilePathsByTreeKey.get(tree.treeKey))
                .forEach(lineNumber => treeHistoryAllowLists.removableTodoKeys.add(this.buildTodoActionKey(tree.treeKey, lineNumber)));
            ( tree.removedTodos ?? [] ).forEach(removedTodo => treeHistoryAllowLists.restorableTodoKeys.add(this.buildTodoActionKey(tree.treeKey, removedTodo.removalKey)));

            if ( tree.folderName !== '' ) {
                treeHistoryAllowLists.nameableTreeKeys.add(tree.treeKey);
                // EVERY OCCURRENCE'S FIELDS (#467): A FIELD ONLY AN ITERATION WRITES HAS A CHECKBOX ON THAT ROW
                RecipeCockpitTreeSelectionStore.listTreeOccurrences(objectsByApiName, tree).forEach(({ objectApiName, objectViewModel }) => {
                    treeHistoryAllowLists.selectableObjectKeys.add(this.buildSelectableObjectKey(tree.treeKey, objectApiName));
                    RecipeCockpitTreeSelectionStore.listSelectableFieldApiNames(objectViewModel)
                        .forEach(fieldApiName => treeHistoryAllowLists.selectableFieldKeys.add(this.buildSelectableFieldKey(tree.treeKey, objectApiName, fieldApiName)));
                });
            }

            if ( !tree.history ) {
                return;
            }

            tree.history.datasets.forEach(dataset => this.addDatasetToAllowLists(treeHistoryAllowLists, dataset));

        });

        return treeHistoryAllowLists;

    }

    static buildTodoActionKey(treeKey: string, todoName: string | number): string {

        return `${treeKey}\n${todoName}`;

    }

    /*
        Every TODO of the card's own recipe file a reader may remove (#391): on an object the card
        draws whose recipe is that file, an iteration's and a field's included, and held by no lock.
        A card with no single recipe file offers none, since there is no one file to write.
    */
    static collectRemovableTodoLineNumbers(objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, recipeFilePath: string | undefined): number[] {

        if ( !recipeFilePath ) {
            return [];
        }

        return this.listTreeTodos(objectsByApiName, tree, recipeFilePath)
            .filter(treeTodo => treeTodo.todo.removeLock === undefined)
            .map(treeTodo => treeTodo.todo.lineNumber);

    }

    // EVERY TODO OF THE CARD'S OBJECTS WHOSE RECIPE IS recipeFilePath, WITH THE TEXT THE PANEL DRAWS FOR IT
    static listTreeTodos(objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel, recipeFilePath: string): { todo: IRecipeCockpitTodoViewModel; text: string; objectApiName: string; fieldApiName?: string }[] {

        const treeTodos: { todo: IRecipeCockpitTodoViewModel; text: string; objectApiName: string; fieldApiName?: string }[] = [];
        const seenObjectApiNames = new Set<string>();

        tree.objects.forEach(treeObject => {

            const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
            if ( !objectViewModel || objectViewModel.recipeFilePath !== recipeFilePath || seenObjectApiNames.has(objectViewModel.objectApiName) ) {
                return;
            }
            seenObjectApiNames.add(objectViewModel.objectApiName);

            const addTodos = (todos: IRecipeCockpitTodoViewModel[] | undefined, recipeValue: string | undefined, fieldApiName?: string) => ( todos ?? [] ).forEach(todo => {
                treeTodos.push({ todo: todo, text: this.readTodoText(todo, recipeValue), objectApiName: objectViewModel.objectApiName, ...( fieldApiName !== undefined ? { fieldApiName: fieldApiName } : {} ) });
            });

            addTodos(objectViewModel.todos, undefined);
            objectViewModel.fields.forEach(fieldViewModel => addTodos(fieldViewModel.todos, fieldViewModel.recipeValue, fieldViewModel.fieldApiName));
            ( objectViewModel.iterations ?? [] ).forEach(iteration => {
                addTodos(iteration.todos, undefined);
                iteration.fields.forEach(iterationField => addTodos(iterationField.todos, iterationField.recipeValue, iterationField.fieldApiName));
            });

        });

        return treeTodos;

    }

    // A TODO'S TEXT AS THE PANEL'S readFieldTodoText DRAWS IT: ITS OWN, OR THE SPAN OF THE FIELD'S VALUE THAT HOLDS IT
    static readTodoText(todo: IRecipeCockpitTodoViewModel, recipeValue: string | undefined): string {

        if ( typeof todo.text === 'string' ) {
            return todo.text;
        }

        const value = typeof recipeValue === 'string' ? recipeValue : '';
        const isUsableSpan = Number.isInteger(todo.valueStart) && Number.isInteger(todo.valueLength)
            && todo.valueStart >= 0 && todo.valueLength > 0 && todo.valueStart + todo.valueLength <= value.length;

        return isUsableSpan ? value.substr(todo.valueStart, todo.valueLength) : '';

    }

    static buildSelectableRecordTypeKey(objectApiName: string, developerName: string): string {

        return `${objectApiName}\n${developerName}`;

    }

    // WHAT ONE DATA SET ROW OFFERS: THE ONE RULE A WHOLE MODEL AND A datasetAdded (#226) BOTH USE
    static addDatasetToAllowLists(treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists, dataset: IRecipeCockpitTreeDatasetViewModel) {

        treeHistoryAllowLists.openableDatasetFolderNames.add(dataset.datasetFolderName);
        treeHistoryAllowLists.insertableDatasetFolderNames.add(dataset.datasetFolderName);
        treeHistoryAllowLists.nameableDatasetFolderNames.add(dataset.datasetFolderName);

        if ( dataset.recordCounts === null ) {
            treeHistoryAllowLists.countableDatasetFolderNames.add(dataset.datasetFolderName);
        }

        if ( dataset.lastInsert?.hasResultsFile === true ) {
            treeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.add(dataset.datasetFolderName);
        }

    }

    /*
        A COPY, never the same sets: once a model is acknowledged its pending and active lists ARE
        the same objects, so adding a new row's names to "pending" in place would make them usable
        before the panel has drawn the row.
    */
    static cloneTreeHistoryAllowLists(treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists): IRecipeCockpitTreeHistoryAllowLists {

        const clonedAllowLists = this.buildEmptyTreeHistoryAllowLists();

        (Object.keys(clonedAllowLists) as Array<keyof IRecipeCockpitTreeHistoryAllowLists>).forEach(allowListName => {
            clonedAllowLists[allowListName] = new Set(treeHistoryAllowLists[allowListName]);
        });

        return clonedAllowLists;

    }

    static buildInitialPanelState(workspaceRoot: string): IRecipeCockpitPanelState {

        return {
            workspaceRoot: workspaceRoot,
            isPanelReady: false,
            loadPhaseMessage: '',
            picklistDisplayValuesByObjectApiName: new Map(),
            pendingOpenableSourceKeys: new Set(),
            pendingOpenableValidationRuleKeys: new Set(),
            pendingValidationRuleListKeys: new Map(),
            validationRuleListSequence: 0,
            openableValidationRuleKeys: new Set(),
            pendingSelectableRunFolderNames: new Set(),
            pendingLoadablePicklistKeys: new Set(),
            openableSourceKeys: new Set(),
            selectableRunFolderNames: new Set(),
            loadablePicklistKeys: new Set(),
            treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets(),
            pendingTreeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
            treeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
            pendingUpdatableTreeKeys: new Set(),
            updatableTreeKeys: new Set(),
            pendingOpenableRecordPreviews: new Map(),
            openableRecordPreviews: new Map(),
            pendingRestorableSnapshots: new Map(),
            restorableSnapshots: new Map(),
            pendingHistoryFiles: new Map(),
            historyFiles: new Map(),
            pendingJourneyFiles: new Map(),
            journeyFiles: new Map(),
            isGenerateTreecipeInFlight: false,
            pendingIsGenerateTreecipeOffered: false,
            isGenerateTreecipeOffered: false,
            reportedFailureDescriptions: new Set(),
            pendingDataOrgObjectApiNames: new Set(),
            dataOrgObjectApiNames: new Set(),
            dataOrgDetails: [],
            dataOrgRequestSequence: 0,
            pendingInsertableTreeKeys: new Set(),
            insertableTreeKeys: new Set(),
            pendingInsertableFriendTargets: new Map(),
            insertableFriendTargets: new Map(),
            pendingWireableLookupTargets: new Map(),
            wireableLookupTargets: new Map(),
            pendingAddableParentTargets: new Map(),
            addableParentTargets: new Map(),
            pendingOrgRecordLookupTargets: new Map(),
            orgRecordLookupTargets: new Map(),
            datasetUpdateSequence: 0,
            acknowledgedRenderSequence: null,
            pendingAssignableTreeKeys: new Set(),
            assignableTreeKeys: new Set(),
            ...( this.extensionVersion ? { extensionVersion: this.extensionVersion } : {} )
        };

    }

    // THE INSTALLED VERSION (#333): READ ONCE AT ACTIVATION, AND EVERY PANEL STATE BUILT AFTER CARRIES IT
    private static extensionVersion: string | undefined;

    static setExtensionVersion(candidateVersion: unknown) {

        this.extensionVersion = this.readExtensionVersion(candidateVersion);

    }

    // package.json SHIPS IN THE .vsix, BUT WHAT IS POSTED IS STILL HELD TO A VERSION'S SHAPE RATHER THAN TRUSTED
    static readExtensionVersion(candidateVersion: unknown): string | undefined {

        return typeof candidateVersion === 'string' && RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN.test(candidateVersion)
            ? candidateVersion
            : undefined;

    }

    /*
        The CHANGELOG link (#333): one constant address, handed to the reader's browser by VS Code.
        A browser that refuses it, or a throw, is one fixed warning that quotes nothing.
    */
    static async openChangelogInBrowser() {

        try {

            const isOpened = await vscode.env.openExternal(vscode.Uri.parse(RECIPE_COCKPIT_CHANGELOG_URL, true));

            if ( !isOpened ) {
                VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE);
            }

        } catch {

            VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE);

        }

    }

    /*
        Opens the cockpit (or reveals the one this window already has) and loads the latest run.

        The shell is shown BEFORE any of the load, so the load has somewhere to report its phases.
        Re-running the command resets the panel: the previous model is no longer necessarily what
        the workspace holds, and leaving it on screen under a fresh load's status line would show
        one run while reporting another's progress.
    */
    static async openRecipeCockpitPanel(workspaceRoot: string,
                                        workspaceState?: IRecipeCockpitWorkspaceState,
                                        openFocusRequest?: RecipeCockpitOpenFocusRequest): Promise<vscode.WebviewPanel> {

        const existingCockpitPanel = this.recipeCockpitPanel;
        // A PLACE STILL WAITING TO BE WRITTEN BELONGS TO THE WORKSPACE STATE IT WAS SAVED UNDER
        this.flushPanelPlacePersist();
        this.recipeCockpitWorkspaceState = workspaceState;

        /*
            Re-running the command on an open panel reloads what it SHOWS (#222): the run the reader
            picked, rather than the newest.
        */
        const previousPanelState = existingCockpitPanel && this.recipeCockpitPanelState.workspaceRoot === workspaceRoot
            ? this.recipeCockpitPanelState
            : undefined;
        /*
            A panel with nothing to carry -- the first open after a close or a window reload (#230)
            -- starts from the place workspaceState kept, if any: its run is looked up among the
            runs on disk like any other requested run, and the place itself is handed to the panel
            with the model only if that run is the one loaded.
        */
        // A PANEL WHOSE FIRST LOAD HAS NOT DRAWN YET (THE COMMAND RUN TWICE) HAS NOTHING OF ITS OWN TO CARRY EITHER
        /*
            "Change record types" (#196) is about the run Generate Treecipe just wrote, which is the
            newest: neither the run on screen nor a remembered place is carried to it.
        */
        const persistedPanelPlace = previousPanelState?.recipeDataMessage || openFocusRequest ? undefined : this.readPersistedPanelPlace(workspaceState);
        // "Open Troubleshooting" (#375) IS ABOUT THE RUN THE INSERT WAS GENERATED FROM, WHICH IT NAMES
        const carriedRunFolderName = openFocusRequest
            ? ( this.isTroubleshootingFocusRequest(openFocusRequest) ? openFocusRequest.runFolderName : undefined )
            : previousPanelState?.recipeDataMessage?.recipe.selectedRunFolderName || persistedPanelPlace?.runFolderName || undefined;

        const cockpitPanel = existingCockpitPanel
            ?? vscode.window.createWebviewPanel(
                RECIPE_COCKPIT_VIEW_TYPE,
                RECIPE_COCKPIT_PANEL_TITLE,
                vscode.ViewColumn.One,
                /*
                    localResourceRoots is set EMPTY rather than omitted. Omitting it does not deny
                    the grant -- VS Code then defaults to the extension directory plus every open
                    workspace folder. The cockpit loads no file of any kind: its shell is inline and
                    everything it renders arrives over postMessage.

                    retainContextWhenHidden is deliberately NOT set: the host holds the model and
                    replays it on the reload a reveal triggers, so a hidden tab costs no DOM.
                */
                { enableScripts: true, localResourceRoots: [] }
            );

        this.recipeCockpitPanel = cockpitPanel;
        this.cancelPendingConfirmation();
        this.recipeCockpitPanelState = this.buildInitialPanelState(workspaceRoot);

        RecipeCockpitTreecipeDataOrgs.adoptScratchOrgRunState(this.recipeCockpitPanelState);
        RecipeCockpitTroubleshootingRuns.adoptPermissionSetAssignRunState(this.recipeCockpitPanelState);
        this.adoptMetadataRetrieveRunState(this.recipeCockpitPanelState);
        this.adoptMetadataDeployRunState(this.recipeCockpitPanelState);
        RecipeCockpitQueryHost.adoptTreeQueryRunState(this.recipeCockpitPanelState);
        RecipeCockpitAdapterState.adoptUpdaterLoadRunState(this.recipeCockpitPanelState);
        this.recipeCockpitPanelState.isOrgOpenInFlight = RecipeCockpitTreecipeDataOrgs.isOrgOpenInFlightForWindow;

        if ( previousPanelState ) {
            // THE SEQUENCE A NEW SELECTION MUST STAY ABOVE
            this.recipeCockpitPanelState.dataOrgRequestSequence = previousPanelState.dataOrgRequestSequence;
            // A SCRATCH ORG RUN OUTLIVES THE RELOAD, AND WHAT IT HOLDS DISABLED GOES WITH IT
            this.recipeCockpitPanelState.scratchOrgStateMessage = previousPanelState.scratchOrgStateMessage;
            // SO DOES A PERMISSION SET ASSIGNMENT'S (#274)
            this.recipeCockpitPanelState.permissionSetAssignStateMessage = previousPanelState.permissionSetAssignStateMessage;
            // AND A RETRIEVE'S (#326, #382)
            this.recipeCockpitPanelState.metadataRetrieveStateMessage = previousPanelState.metadataRetrieveStateMessage;
            // AND A METADATA DEPLOY'S (#346)
            this.recipeCockpitPanelState.metadataDeployStateMessage = previousPanelState.metadataDeployStateMessage;
            // AND A QUERY RUN'S (#367)
            this.recipeCockpitPanelState.treeQueryStateMessage = previousPanelState.treeQueryStateMessage;
            // AND AN UPDATER LOAD'S (#416)
            this.recipeCockpitPanelState.updaterLoadStateMessage = previousPanelState.updaterLoadStateMessage;
        }

        if ( !existingCockpitPanel ) {

            // HIDDEN, THE DOCUMENT IS THROWN AWAY (retainContextWhenHidden IS OFF), SO AN OPEN CONFIRMATION IS CANCEL AT ONCE, NOT ON THE NEXT REVEAL (#349)
            cockpitPanel.onDidChangeViewState?.(viewStateEvent => {
                if ( !viewStateEvent.webviewPanel.visible ) { this.cancelPendingConfirmation(); }
            });

            cockpitPanel.onDidDispose(() => {
                // THE LAST PLACE SAVED IS WRITTEN NOW RATHER THAN DROPPED WITH THE TIMER -- THE NEXT OPEN READS IT
                this.flushPanelPlacePersist();
                this.cancelPendingConfirmation();
                // A DIALOG LEFT OPEN STAGED FILES NO ONE WILL APPLY; ONE STILL RETRIEVING OR APPLYING ENDS ITSELF (#612)
                const objectRefreshStep = this.recipeCockpitPanelState.objectRefreshSession?.stateMessage.step;
                if ( objectRefreshStep === 'choose' || objectRefreshStep === 'review' || objectRefreshStep === 'confirming' ) {
                    this.discardObjectRefreshStaging(this.recipeCockpitPanelState);
                }
                this.recipeCockpitMessageSubscription?.dispose();
                this.recipeCockpitMessageSubscription = undefined;
                this.recipeCockpitPanel = undefined;
                this.recipeCockpitPanelState = this.buildInitialPanelState('');
                RecipeCockpitQueryHost.clearHeldTreeQueryResult();
                RecipeCockpitAdapterState.clearHeldUpdaterRecords();
            });

        }

        // A FRESH NONCE PER LOAD -- ONE REUSED ACROSS LOADS WOULD OUTLIVE THE ONE DOCUMENT IT AUTHORIZES
        cockpitPanel.webview.html = RecipeCockpitShell.buildWebviewShellHtml(RecipeCockpitShell.buildNonce());

        this.registerPanelMessageSubscription(cockpitPanel);

        cockpitPanel.reveal(vscode.ViewColumn.One);

        // A RUN THAT IS GONE FALLS BACK TO THE NEWEST, AS loadRecipeRunByRuns DOES FOR ANY RUN IT CANNOT FIND
        await this.loadRecipeIntoPanel(
            cockpitPanel,
            workspaceRoot,
            carriedRunFolderName,
            openFocusRequest,
            persistedPanelPlace
        );

        return cockpitPanel;

    }

    /*
        Walks the phases of one load and renders its result.

        Rethrows after putting the failure in the panel: the command that opened the panel owns the
        error report for the first load, and the run selector's handler owns it for the rest.
    */
    static async loadRecipeIntoPanel(cockpitPanel: vscode.WebviewPanel,
                                                workspaceRoot: string,
                                                requestedRunFolderName?: string,
                                                focusTree?: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest,
                                                persistedPanelPlace?: IRecipeCockpitPanelPlace,
                                                confirmBeforeRender?: (loadedRecipe: IRecipeCockpitLoadedRecipe) => Promise<boolean>): Promise<void> {

        const loadSequence = ++this.recipeCockpitLoadSequence;

        const isCurrentLoad = () => (
            this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitLoadSequence === loadSequence
        );

        const loadStatusItem = VSCodeWorkspaceService.createStatusBarPhaseItem(
            this.buildStatusBarText(RECIPE_COCKPIT_LOAD_PHASES.findingRuns)
        );

        try {

            await this.reportLoadPhase(cockpitPanel, loadStatusItem, RECIPE_COCKPIT_LOAD_PHASES.findingRuns);

            const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
            const recipeRuns = RecipeCockpitModelBuild.findGeneratedRecipeRuns(generatedRecipesFolderPath);

            if ( !isCurrentLoad() ) {
                return;
            }

            await this.reportLoadPhase(cockpitPanel, loadStatusItem, RECIPE_COCKPIT_LOAD_PHASES.readingRun);

            const loadedRecipe = RecipeCockpitModelBuild.loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName, this.selectedCustomTreeFolderNameByRunFolderName);

            if ( !isCurrentLoad() ) {
                return;
            }

            if ( confirmBeforeRender ) {

                // THE RUN IS READ: A SPINNER LEFT UP WOULD SAY "READING" FOR AS LONG AS A QUESTION STAYS OPEN
                loadStatusItem.dispose();

                const isConfirmed = await confirmBeforeRender(loadedRecipe);

                // A NEWER LOAD ANSWERED THIS ONE'S QUESTION CANCEL, AND OWNS THE PANEL NOW
                if ( !isCurrentLoad() ) {
                    return;
                }

                if ( !isConfirmed ) {
                    this.postToPanel(cockpitPanel, { command: 'runSwitchCancelled' });
                    return;
                }

            }

            this.renderRecipeModel(cockpitPanel, loadedRecipe, focusTree, persistedPanelPlace);

        } catch (loadError) {

            // A LOAD THE READER ALREADY REPLACED, OR WHOSE PANEL THEY CLOSED, IS NOT THEIRS TO BE TOLD ABOUT
            if ( !isCurrentLoad() ) {
                return;
            }

            this.failLoad(cockpitPanel, `The Recipe Cockpit could not finish loading: ${loadError?.message ?? loadError}`);

            throw loadError;

        } finally {
            loadStatusItem.dispose();
        }

    }

    private static buildStatusBarText(phaseMessage: string): string {

        return `$(sync~spin) Recipe Cockpit: ${phaseMessage}`;

    }

    /*
        VS Code batches webview posts and status bar writes and flushes them when the event-loop
        turn ends, so a load that never yields narrates nothing however many phases it reports.
    */
    private static async yieldToExtensionHost(): Promise<void> {

        return new Promise<void>(resolveYield => setImmediate(resolveYield));

    }

    private static async reportLoadPhase(cockpitPanel: vscode.WebviewPanel,
                                            loadStatusItem: vscode.StatusBarItem,
                                            phaseMessage: string) {

        this.recipeCockpitPanelState.loadPhaseMessage = phaseMessage;
        loadStatusItem.text = this.buildStatusBarText(phaseMessage);

        this.postToPanel(cockpitPanel, { command: 'loadPhase', message: phaseMessage });

        await this.yieldToExtensionHost();

    }

    /*
        Asks the reader inside the panel (#349), answering as showWarningMessage's modal did: the
        label of the button chosen, or undefined for Cancel. Only over a model the panel confirmed
        drawing; with none on screen, or no panel, it is Cancel at once. A newer request answers the
        open one Cancel first, so the reader sees what they asked for last. Every caller re-plans and
        re-checks its guards after the answer, as it did after the modal.
    */
    static confirmInPanel(message: string, confirmOptions: IRecipeCockpitConfirmOptions, ...buttonLabels: string[]): Promise<string | undefined> {

        return this.askInPanel(message, confirmOptions, undefined, buttonLabels)
            .then(answer => answer.chosenLabel);

    }

    /*
        The same confirmation with the record type set modes as radios under its lines (#623). The
        answer names a mode only when it is one this confirmation offered; a chosen button with any
        other mode is Cancel.
    */
    static confirmInPanelWithRecordTypeSetModes(message: string, confirmOptions: IRecipeCockpitConfirmWithRecordTypeSetModesOptions, ...buttonLabels: string[]): Promise<IRecipeCockpitConfirmAnswer> {

        return this.askInPanel(message, confirmOptions, undefined, buttonLabels, confirmOptions.recordTypeSetModes);

    }

    /*
        The same confirmation with ONE checkbox under its lines (#402), unticked every time it is
        drawn and never remembered. The box says only what the reader asked for: the caller still
        decides, from its own read, what a ticked box adds, and re-checks its guards after the answer.
    */
    static confirmInPanelWithCheckbox(message: string, confirmOptions: IRecipeCockpitConfirmWithCheckboxOptions, ...buttonLabels: string[]): Promise<IRecipeCockpitConfirmAnswer> {

        return this.askInPanel(message, confirmOptions, confirmOptions.checkboxLabel, buttonLabels);

    }

    private static askInPanel(message: string, confirmOptions: IRecipeCockpitConfirmOptions, checkboxLabel: string | undefined, buttonLabels: string[], recordTypeSetModes: IRecordTypeSetModeOffer[] = []): Promise<IRecipeCockpitConfirmAnswer> {

        const cancelled: IRecipeCockpitConfirmAnswer = { chosenLabel: undefined, isChecked: false };

        this.cancelPendingConfirmation();

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;
        const drawnRenderSequence = panelState.recipeDataMessage?.renderSequence;

        if ( !cockpitPanel || !panelState.isPanelReady || drawnRenderSequence === undefined || panelState.acknowledgedRenderSequence !== drawnRenderSequence ) {
            return Promise.resolve(cancelled);
        }

        // A HIDDEN WEBVIEW HAS NO DOCUMENT (retainContextWhenHidden IS OFF), SO A POST TO IT IS DROPPED AND THE ACTION WOULD WAIT ON NOTHING
        if ( cockpitPanel.visible === false ) {
            cockpitPanel.reveal();
            VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL);
            return Promise.resolve(cancelled);
        }

        const confirmationId = CockpitConfirmDialog.buildConfirmationId();
        // "Change org…" ONLY INSIDE A PANEL ACTION, WHICH IS WHAT CAN START THE ACTION AGAIN ONCE IT HAS ENDED
        const actionContext = this.panelActionContextStorage.getStore();
        const changeOrg = actionContext && confirmOptions.changeOrg && confirmOptions.org ? confirmOptions.changeOrg : undefined;

        return new Promise(resolve => {

            this.pendingConfirmation = {
                confirmationId: confirmationId,
                buttonLabels: [...buttonLabels],
                hasCheckbox: checkboxLabel !== undefined,
                isAskingRecordTypeSetMode: recordTypeSetModes.length > 0,
                recordTypeSetModes: recordTypeSetModes.filter(modeOffer => modeOffer.disabledReason === undefined).map(modeOffer => modeOffer.mode),
                resolve: resolve,
                ...( changeOrg ? { changeOrg: changeOrg, actionContext: actionContext } : {} )
            };

            this.postToPanel(cockpitPanel, {
                command: 'confirmRequest',
                confirmationId: confirmationId,
                renderSequence: drawnRenderSequence,
                title: message,
                ...this.buildConfirmRequestContent(confirmOptions),
                buttons: [...buttonLabels],
                isDestructive: confirmOptions.isDestructive === true,
                ...( checkboxLabel !== undefined ? { checkboxLabel: checkboxLabel } : {} ),
                ...( recordTypeSetModes.length > 0
                    ? {
                        recordTypeSetModeLegend: RECORD_TYPE_SET_MODE_LEGEND,
                        recordTypeSetModes: recordTypeSetModes.map(modeOffer => ({
                            name: modeOffer.mode,
                            label: RECORD_TYPE_SET_MODE_LABELS[modeOffer.mode],
                            ...( modeOffer.disabledReason !== undefined ? { disabledReason: modeOffer.disabledReason } : {} )
                        }))
                    }
                    : {} ),
                ...( changeOrg ? { canChangeOrg: true } : {} )
            });

        });

    }

    // THE PARTS A CONFIRMATION POSTS (#457): SEE RecipeCockpitConfirmContent
    static buildConfirmRequestContent(confirmContent: IRecipeCockpitConfirmContent): IRecipeCockpitConfirmRequestParts {
        return RecipeCockpitConfirmContent.buildRequestParts(confirmContent);
    }

    static flattenConfirmContent(confirmContent: IRecipeCockpitConfirmContent): string {
        return RecipeCockpitConfirmContent.flatten(confirmContent);
    }

    private static cancelPendingConfirmation() {

        const pendingConfirmation = this.pendingConfirmation;
        this.pendingConfirmation = undefined;
        pendingConfirmation?.resolve({ chosenLabel: undefined, isChecked: false });

    }

    /*
        SPENT ONCE; AN INDEX THE HOST DID NOT OFFER IS CANCEL, AND SO IS AN isChecked THAT IS NEITHER
        ABSENT NOR A BOOLEAN. "Change org…" (#480) is Cancel to the action that asked, and is kept on
        that action's context only when the host drew the button; the action is started again once
        it has ended (runPanelAction).
    */
    private static settlePendingConfirmation(confirmationId: string, choice: unknown, isChecked?: unknown, isChangeOrg = false, postedRecordTypeSetMode?: unknown) {

        const pendingConfirmation = this.pendingConfirmation;

        if ( !pendingConfirmation || pendingConfirmation.confirmationId !== confirmationId ) {
            return;
        }

        this.pendingConfirmation = undefined;

        if ( isChangeOrg ) {
            if ( pendingConfirmation.changeOrg && pendingConfirmation.actionContext ) {
                pendingConfirmation.actionContext.orgChange = pendingConfirmation.changeOrg;
            }
            pendingConfirmation.resolve({ chosenLabel: undefined, isChecked: false });
            return;
        }

        const answer = CockpitConfirmDialog.readAnswer(pendingConfirmation.buttonLabels, pendingConfirmation.hasCheckbox, choice, isChecked);

        if ( !pendingConfirmation.isAskingRecordTypeSetMode || answer.chosenLabel === undefined ) {
            pendingConfirmation.resolve(answer);
            return;
        }

        // A CONFIRMATION THAT OFFERED MODES IS ANSWERED ONLY WITH ONE OF THEM (#623)
        const recordTypeSetMode = CockpitConfirmDialog.readRecordTypeSetMode(pendingConfirmation.recordTypeSetModes, postedRecordTypeSetMode);
        pendingConfirmation.resolve(recordTypeSetMode === undefined ? { chosenLabel: undefined, isChecked: false } : { ...answer, recordTypeSetMode: recordTypeSetMode });

    }

    /*
        Every host message is STORED and posted only once the panel has said it is listening. A
        webview that has not finished loading drops what is posted to it, and posting eagerly AND
        replaying on the handshake would render the whole model twice.
    */
    static postToPanel(cockpitPanel: vscode.WebviewPanel, hostMessage: RecipeCockpitHostMessage) {

        if ( this.recipeCockpitPanel !== cockpitPanel ) {
            return;
        }

        if ( !this.recipeCockpitPanelState.isPanelReady ) {
            return;
        }

        cockpitPanel.webview.postMessage(hostMessage);

    }

    private static renderRecipeModel(cockpitPanel: vscode.WebviewPanel,
                                        loadedRecipe: IRecipeCockpitLoadedRecipe,
                                        focusRequest?: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest,
                                        persistedPanelPlace?: IRecipeCockpitPanelPlace) {

        const panelState = this.recipeCockpitPanelState;
        const recipeViewModel = loadedRecipe.recipeViewModel;
        let focusTree: IRecipeCockpitTreeFocus | undefined;
        if ( focusRequest !== undefined ) {
            focusTree = this.isTreeFocus(focusRequest)
                ? focusRequest
                : this.isTroubleshootingFocusRequest(focusRequest)
                    ? this.resolveTroubleshootingFocus(recipeViewModel, focusRequest)
                    : this.resolveRecordTypesFocus(recipeViewModel, focusRequest);
        }
        this.applyTreePreferences(recipeViewModel.trees, this.readTreePreferences(this.recipeCockpitWorkspaceState));
        RecipeCockpitDatasetsHost.applyDatasetPreferences(recipeViewModel.trees, RecipeCockpitDatasetsHost.readDatasetPreferences(this, this.recipeCockpitWorkspaceState));
        this.applyTreeSelections(recipeViewModel, this.withPinnedFixedValues(RecipeCockpitTreeSelectionStore.readTreeSelections(this.recipeCockpitWorkspaceState), loadedRecipe.pinnedFixedValuesByFolderName));
        const recipeDataMessage: IRecipeCockpitRecipeDataMessage = {
            command: 'recipeData',
            recipe: recipeViewModel,
            renderSequence: ++this.recipeCockpitRenderSequence
        };
        const isFocusOnScreen = !!focusTree && recipeViewModel.trees.some(tree => tree.treeKey === focusTree.treeKey);

        panelState.recipeDataMessage = recipeDataMessage;
        // A CONFIRMATION ASKED OVER THE MODEL ON SCREEN IS NOT AN ANSWER ABOUT THIS ONE
        this.cancelPendingConfirmation();
        /*
            A saved place whose run is gone is dropped (#230): the newest run was loaded in its
            place, and a place is only ever about the run it names.
        */
        panelState.openFocusTree = focusRequest !== undefined && !this.isTreeFocus(focusRequest) ? focusTree : undefined;
        panelState.restorePlace = persistedPanelPlace && persistedPanelPlace.runFolderName === recipeViewModel.selectedRunFolderName
            ? persistedPanelPlace
            : undefined;
        if ( persistedPanelPlace && !panelState.restorePlace ) {
            this.forgetPersistedPanelPlace(this.recipeCockpitWorkspaceState);
        }
        panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
        panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
        panelState.objectLevelsByApiName = loadedRecipe.objectLevelsByApiName;
        panelState.pinnedFixedValuesByFolderName = loadedRecipe.pinnedFixedValuesByFolderName;
        panelState.removedTodosByTreeKey = loadedRecipe.removedTodosByTreeKey;
        panelState.objectsWrapperFilePath = loadedRecipe.objectsWrapperFilePath;
        panelState.treeQueryResultMessage = undefined;
        // A RESULT IS EXPORTED ONLY FROM THE MODEL IT WAS RUN ON, SO A NEW ONE LETS IT GO
        RecipeCockpitQueryHost.clearHeldTreeQueryResult();
        // SO ARE AN UPDATER LOAD'S RECORDS (#416), AND WHAT A METADATA RETRIEVE FOUND (#445)
        panelState.updaterRecordsMessage = undefined;
        panelState.adapterChildBlockMessage = undefined;
        panelState.adapterChildPreviewMessage = undefined;
        panelState.adapterMetadataChangesMessage = undefined;
        panelState.adapterRetrieveStagingFolderPath = undefined;
        panelState.adapterOrgOnlyFields = undefined;
        // AN OPEN "Get latest object detail" DIALOG (#612) WAS FOR THE OLD MODEL; ONE STILL RETRIEVING OR APPLYING ENDS ITSELF
        const objectRefreshStep = panelState.objectRefreshSession?.stateMessage.step;
        if ( objectRefreshStep === 'choose' || objectRefreshStep === 'review' || objectRefreshStep === 'confirming' ) {
            this.discardObjectRefreshStaging(panelState);
            panelState.objectRefreshSession = undefined;
        }
        RecipeCockpitAdapterState.setUpdaterValuesMessage(panelState, undefined);
        RecipeCockpitAdapterState.clearHeldUpdaterRecords();
        // AND EVERY PREVIEW'S RECORD LINKS (#556), WHOSE RECORDS WENT WITH THEM
        panelState.pendingOpenableRecordPreviews = new Map();
        panelState.openableRecordPreviews = new Map();
        // AND A SNAPSHOT LIST (#419): THE NEW MODEL'S CARDS ASK FOR THEIR OWN
        panelState.pendingRestorableSnapshots = new Map();
        panelState.restorableSnapshots = new Map();
        panelState.pendingHistoryFiles = new Map();
        panelState.historyFiles = new Map();
        panelState.pendingJourneyFiles = new Map();
        panelState.journeyFiles = new Map();
        panelState.loadFailedMessage = undefined;
        panelState.loadPhaseMessage = '';
        panelState.reportedFailureDescriptions = new Set();
        panelState.pendingOpenableSourceKeys = new Set(this.collectOpenableSourceKeys(recipeViewModel));
        panelState.pendingOpenableValidationRuleKeys = new Set(this.collectOpenableValidationRuleKeys(recipeViewModel));
        panelState.pendingValidationRuleListKeys = new Map();
        panelState.openableValidationRuleKeys = new Set();
        panelState.pendingSelectableRunFolderNames = new Set(recipeViewModel.runs.map(run => this.buildRunPickerKey(run.runFolderName, run.customTreeFolderName)));
        panelState.pendingLoadablePicklistKeys = new Set(this.collectLoadablePicklistKeys(recipeViewModel));
        panelState.pendingTreeHistoryAllowLists = this.collectTreeHistoryAllowLists(recipeViewModel, loadedRecipe.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        // THE PANEL DRAWS THE BUTTON ONLY FOR A MODEL WITH NO RUN, AND ONLY ITS "rendered" SAYS THAT MODEL IS THE ONE ON SCREEN
        panelState.pendingIsGenerateTreecipeOffered = recipeViewModel.runs.length === 0;
        panelState.isGenerateTreecipeOffered = false;
        /*
            Emptied rather than left on the previous model until the new one's "rendered": an answer
            is tagged with the CURRENT model's renderSequence, so the old model's keys must not
            answer for it.
        */
        panelState.loadablePicklistKeys = new Set();
        /*
            The same for the Treecipe tab's org selection: its answers are tagged with the model they
            describe, so a new model ends whatever selection was being checked for the old one. The org list and the org
            chosen survive it -- the panel asks again once the new model is drawn.
        */
        panelState.pendingDataOrgObjectApiNames = new Set(RecipeCockpitTreecipeDataOrgs.collectDataOrgObjectApiNames(recipeViewModel));
        panelState.dataOrgObjectApiNames = new Set();
        panelState.pendingInsertableTreeKeys = new Set(RecipeCockpitTreecipeDataOrgs.collectInsertableTreeKeys(recipeViewModel));
        panelState.insertableTreeKeys = new Set();
        panelState.pendingAssignableTreeKeys = new Set(RecipeCockpitTreecipeDataOrgs.collectAssignableTreeKeys(recipeViewModel));
        panelState.assignableTreeKeys = new Set();
        // A "+" OF THE OLD MODEL NAMES AN ITERATION THE NEW ONE'S ROWS MAY NOT DRAW WHERE IT WAS
        panelState.pendingInsertableFriendTargets = this.collectInsertableFriendTargets(recipeViewModel);
        panelState.insertableFriendTargets = new Map();
        panelState.pendingWireableLookupTargets = this.collectWireableLookupTargets(recipeViewModel, panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.wireableLookupTargets = new Map();
        panelState.pendingAddableParentTargets = this.collectAddableParentTargets(recipeViewModel, panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.addableParentTargets = new Map();
        panelState.pendingOrgRecordLookupTargets = this.collectOrgRecordLookupTargets(recipeViewModel, panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.orgRecordLookupTargets = new Map();
        panelState.acknowledgedRenderSequence = null;
        panelState.dataOrgSelection = undefined;
        panelState.dataOrgRequestSequence++;

        /*
            The focus rides on the POSTED copy only. The stored message is what every reveal replays,
            and a focus replayed on each one would re-open a card the reader has since closed.
        */
        this.postToPanel(cockpitPanel, {
            ...this.withRestorePlace(recipeDataMessage, panelState),
            ...( isFocusOnScreen ? { focusTree: focusTree } : {} )
        });

    }

    /*
        The place rides on a POSTED copy, like a focus, and on every replay until the model's
        "rendered": a fresh panel usually says "ready" after its model was stored, so the replay is
        the post that carries it. The panel prefers its own getState, which is newer whenever it has one.
    */
    private static withRestorePlace(recipeDataMessage: IRecipeCockpitRecipeDataMessage, panelState: IRecipeCockpitPanelState): IRecipeCockpitRecipeDataMessage {

        return {
            ...recipeDataMessage,
            ...( panelState.restorePlace ? { restorePlace: panelState.restorePlace } : {} ),
            ...( panelState.openFocusTree ? { focusTree: panelState.openFocusTree } : {} )
        };

    }

    // A LOAD THAT ENDED HAS TO STOP LOOKING LIKE ONE STILL RUNNING, AND A REVEAL AFTERWARDS HAS TO SAY SO TOO
    private static failLoad(cockpitPanel: vscode.WebviewPanel, failureMessage: string) {

        const loadFailedMessage: IRecipeCockpitLoadFailedMessage = { command: 'loadFailed', message: failureMessage };

        this.recipeCockpitPanelState.loadFailedMessage = loadFailedMessage;
        this.recipeCockpitPanelState.loadPhaseMessage = '';

        this.postToPanel(cockpitPanel, loadFailedMessage);

    }

    private static registerPanelMessageSubscription(cockpitPanel: vscode.WebviewPanel) {

        this.recipeCockpitMessageSubscription?.dispose();

        this.recipeCockpitMessageSubscription = cockpitPanel.webview.onDidReceiveMessage(async (panelMessage: IRecipeCockpitPanelMessage) => {

            /*
                Whether the panel this message came from is still the panel the window has. Posting
                to a disposed webview throws, and that throw would reach the user as an extension
                error for the ordinary act of closing a tab.
            */
            if ( this.recipeCockpitPanel !== cockpitPanel ) {
                return;
            }

            const panelAction = this.routePanelMessage(panelMessage, this.recipeCockpitPanelState);

            if ( !panelAction ) {
                return;
            }

            await this.runPanelAction(cockpitPanel, panelAction);

        });

    }

    /*
        One routed action, run inside its own context (#480). Once it has ENDED -- every run lock
        released in its own finally -- a "Change org…" chosen on one of its confirmations asks for
        the org, makes the pick the Target Org Manager selection, and routes the action's message
        again, so the action starts over against the new org through every guard a click meets.
    */
    static async runPanelAction(cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitPanelAction) {

        const actionContext: IRecipeCockpitPanelActionContext = {};

        /*
            Only an action whose confirmation can offer "Change org…" gets a context: the first run()
            turns on Node's async context tracking for the whole extension host, so every other
            action runs outside one (exit() never turns it on) and asks nothing that offers it.
        */
        try {
            await ( RECIPE_COCKPIT_ORG_CHANGE_ACTION_KINDS.has(panelAction.kind)
                ? this.panelActionContextStorage.run(actionContext, () => this.executePanelAction(cockpitPanel, panelAction))
                : this.panelActionContextStorage.exit(() => this.executePanelAction(cockpitPanel, panelAction)) );
        } catch (actionError) {
            ErrorHandlingService.handleCapturedError(actionError, 'openRecipeCockpit');
        }

        if ( !actionContext.orgChange ) {
            return;
        }

        try {
            await this.changeOrgAndRestart(cockpitPanel, actionContext.orgChange);
        } catch (changeError) {
            ErrorHandlingService.handleCapturedError(changeError, 'openRecipeCockpit');
        }

    }

    /*
        "Change org…" (#480): the org is asked for over the Target Org Manager's own listing and made
        the selection, checked and remembered as a pick in the dropdown is. An action that writes is
        started again only on an org that answered it is a sandbox; one that reads, on any org that
        could be connected to. A dismissed pick, a new model, a selection made meanwhile or a run
        that holds the selection starts nothing. An action that posts the org's index (a deploy, an
        assignment) is sent the new selection's.
    */
    private static async changeOrgAndRestart(cockpitPanel: vscode.WebviewPanel, orgChange: IRecipeCockpitConfirmChangeOrg) {

        const panelState = this.recipeCockpitPanelState;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;

        if ( this.recipeCockpitPanel !== cockpitPanel || !clickedRecipeDataMessage ) {
            return;
        }

        if ( panelState.insertStateMessage
                || this.isSelectionHeldByPromptOrUpdater(panelState)
                || panelState.scratchOrgStateMessage?.isRunning
                || panelState.permissionSetAssignStateMessage?.isRunning
                || panelState.metadataDeployStateMessage?.isRunning ) {
            VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_CHANGE_ORG_BUSY_REFUSAL);
            return;
        }

        const isClickStillCurrent = () => this.recipeCockpitPanel === cockpitPanel
                                            && this.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;

        let isOrgSelected = false;
        panelState.isOrgPromptOpen = true;
        try {
            isOrgSelected = await RecipeCockpitTreecipeDataOrgs.promptAndSelectDataOrg(this, cockpitPanel, panelState, clickedRecipeDataMessage, isClickStillCurrent,
                RECIPE_COCKPIT_CHANGE_ORG_PLACEHOLDER,
                RECIPE_COCKPIT_CHANGE_ORG_REFUSAL_PREFIX,
                orgChange.isSandboxOnly ? RECIPE_COCKPIT_CHANGE_ORG_SANDBOX_ONLY_REASON : undefined,
                panelState.dataOrgSelection);
        } finally {
            panelState.isOrgPromptOpen = false;
        }

        const dataOrgSelection = panelState.dataOrgSelection;

        if ( !isOrgSelected || !dataOrgSelection || !isClickStillCurrent() ) {
            return;
        }

        const restartMessage: IRecipeCockpitPanelMessage = 'orgIndex' in orgChange.restartMessage
            ? { ...orgChange.restartMessage, orgIndex: dataOrgSelection.orgIndex }
            : orgChange.restartMessage;
        const restartAction = this.routePanelMessage(restartMessage, panelState);

        if ( restartAction ) {
            await this.runPanelAction(cockpitPanel, restartAction);
        }

    }

    // A CONFIRMATION'S ORG PART (#480): ITS ALIAS AND USERNAME, DRAWN APART FROM THE SUMMARY
    static buildConfirmOrg(orgDetail: { alias?: string; username: string }): IRecipeCockpitConfirmOrg {
        return { ...( orgDetail.alias ? { alias: orgDetail.alias } : {} ), username: orgDetail.username };
    }

    private static async executePanelAction(cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitPanelAction) {

        if ( RecipeCockpitQueryHost.isQueryPanelAction(panelAction) ) {
            await RecipeCockpitQueryHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitTroubleshootingHost.isTroubleshootingPanelAction(panelAction) ) {
            await RecipeCockpitTroubleshootingHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitDatasetsHost.isDatasetsPanelAction(panelAction) ) {
            await RecipeCockpitDatasetsHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitAdapterHost.isAdapterPanelAction(panelAction) ) {
            await RecipeCockpitAdapterHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitCustomTreecipeHost.isCustomTreecipePanelAction(panelAction) ) {
            await RecipeCockpitCustomTreecipeHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitRecordLinksHost.isRecordLinksPanelAction(panelAction) ) {
            await RecipeCockpitRecordLinksHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitTreecipeOrgHost.isTreecipeOrgPanelAction(panelAction) ) {
            await RecipeCockpitTreecipeOrgHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        if ( RecipeCockpitTreecipeHost.isTreecipePanelAction(panelAction) ) {
            await RecipeCockpitTreecipeHost.executePanelAction(this, cockpitPanel, panelAction);
            return;
        }

        const panelState = this.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'replay':

                /*
                    The document was (re)loaded, so nothing is on screen until the replayed model is
                    drawn again -- which is also why the active allow-lists empty here.
                */
                panelState.isPanelReady = true;
                // A RELOADED DOCUMENT DREW NO DIALOG, AND ONE IS NEVER REPLAYED: THE ACTION IS CANCELLED
                this.cancelPendingConfirmation();
                panelState.openableSourceKeys = new Set();
                panelState.openableValidationRuleKeys = new Set();
                panelState.pendingValidationRuleListKeys = new Map();
                panelState.selectableRunFolderNames = new Set();
                panelState.loadablePicklistKeys = new Set();
                panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                panelState.isGenerateTreecipeOffered = false;
                // A RELOADED DOCUMENT HAS NO DROPDOWN TO DRAW A SELECTION IN, SO ONE STILL BEING CHECKED IS ENDED
                panelState.dataOrgObjectApiNames = new Set();
                panelState.insertableTreeKeys = new Set();
                panelState.assignableTreeKeys = new Set();
                panelState.insertableFriendTargets = new Map();
                panelState.wireableLookupTargets = new Map();
                panelState.addableParentTargets = new Map();
                panelState.orgRecordLookupTargets = new Map();
                panelState.acknowledgedRenderSequence = null;
                panelState.updatableTreeKeys = new Set();
                panelState.openableRecordPreviews = new Map();
                panelState.pendingRestorableSnapshots = new Map();
                panelState.restorableSnapshots = new Map();
                panelState.pendingHistoryFiles = new Map();
                panelState.historyFiles = new Map();
                panelState.pendingJourneyFiles = new Map();
                panelState.journeyFiles = new Map();
                panelState.dataOrgSelection = undefined;
                panelState.dataOrgRequestSequence++;
                panelAction.hostMessages.forEach(hostMessage => cockpitPanel.webview.postMessage(hostMessage));
                return;

            case 'activateActions':

                // DRAWN: THE PANEL'S OWN getState HOLDS THE PLACE FROM HERE ON, AND A REVEAL MUST NOT RE-OPEN THE FOCUSED TAB
                panelState.restorePlace = undefined;
                panelState.openFocusTree = undefined;
                panelState.openableSourceKeys = panelState.pendingOpenableSourceKeys;
                panelState.openableValidationRuleKeys = new Set(panelState.pendingOpenableValidationRuleKeys);
                panelState.selectableRunFolderNames = panelState.pendingSelectableRunFolderNames;
                panelState.loadablePicklistKeys = panelState.pendingLoadablePicklistKeys;
                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                panelState.isGenerateTreecipeOffered = panelState.pendingIsGenerateTreecipeOffered;
                panelState.dataOrgObjectApiNames = panelState.pendingDataOrgObjectApiNames;
                panelState.insertableTreeKeys = panelState.pendingInsertableTreeKeys;
                panelState.assignableTreeKeys = panelState.pendingAssignableTreeKeys;
                panelState.insertableFriendTargets = panelState.pendingInsertableFriendTargets;
                panelState.wireableLookupTargets = panelState.pendingWireableLookupTargets;
                panelState.addableParentTargets = panelState.pendingAddableParentTargets;
                panelState.orgRecordLookupTargets = panelState.pendingOrgRecordLookupTargets;
                panelState.acknowledgedRenderSequence = panelState.recipeDataMessage.renderSequence;
                return;

            case 'activateDatasetActions':

                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                return;

            case 'answerConfirmation':
                this.settlePendingConfirmation(panelAction.confirmationId, panelAction.choice, panelAction.isChecked, panelAction.isChangeOrg, panelAction.recordTypeSetMode);
                return;

            case 'reportRenderFailure': {

                panelState.reportedFailureDescriptions.add(panelAction.failureDescription);

                // ONLY A FAILURE TO DRAW EMPTIES THE ALLOW-LISTS -- A THROW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN
                if ( panelAction.invalidatesPanel ) {
                    this.cancelPendingConfirmation();
                    panelState.openableSourceKeys = new Set();
                    panelState.openableValidationRuleKeys = new Set();
                    panelState.pendingValidationRuleListKeys = new Map();
                    panelState.selectableRunFolderNames = new Set();
                    panelState.loadablePicklistKeys = new Set();
                    panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                    panelState.isGenerateTreecipeOffered = false;
                    panelState.dataOrgObjectApiNames = new Set();
                    panelState.insertableTreeKeys = new Set();
                    panelState.assignableTreeKeys = new Set();
                    panelState.insertableFriendTargets = new Map();
                    panelState.wireableLookupTargets = new Map();
                    panelState.addableParentTargets = new Map();
                    panelState.orgRecordLookupTargets = new Map();
                    panelState.acknowledgedRenderSequence = null;
                    panelState.updatableTreeKeys = new Set();
                    panelState.pendingOpenableRecordPreviews = new Map();
                    panelState.openableRecordPreviews = new Map();
                    panelState.pendingRestorableSnapshots = new Map();
                    panelState.restorableSnapshots = new Map();
                    panelState.pendingHistoryFiles = new Map();
                    panelState.historyFiles = new Map();
                    panelState.pendingJourneyFiles = new Map();
                    panelState.journeyFiles = new Map();
                    // A REVEAL OF A PANEL THAT FAILED TO DRAW MUST NOT KEEP RE-OPENING THE TAB AN OPEN ASKED FOR
                    panelState.openFocusTree = undefined;
                    // NOTHING IS ON SCREEN TO DRAW AN ANSWER IN, SO A SELECTION STILL BEING CHECKED STOPS ASKING THE ORG
                    panelState.dataOrgSelection = undefined;
                    panelState.dataOrgRequestSequence++;
                }

                const renderFailureError = new Error(`The Recipe Cockpit panel could not render the recipe: ${panelAction.failureDescription}`);
                renderFailureError.stack = panelAction.failureStack || renderFailureError.stack;
                ErrorHandlingService.handleCapturedError(renderFailureError, 'openRecipeCockpit');
                return;

            }

            case 'openSource':

                /*
                    Containment was checked when the model was built, and is checked AGAIN here: the
                    file can have been replaced by a symlink out of the workspace since, and the
                    allow-list only says the model named this path, not where it resolves now.
                */
                if ( !SfdxProjectService.isPathContainedInWorkspace(path.resolve(panelAction.filePath), path.resolve(panelState.workspaceRoot)) ) {
                    VSCodeWorkspaceService.showWarningMessage(`The recipe file "${RecipeYamlScalar.escapeForNotification(panelAction.filePath)}" now resolves outside this workspace, so it was not opened. Re-open the Recipe Cockpit to load the runs currently on disk.`);
                    return;
                }

                if ( !fs.existsSync(panelAction.filePath) ) {
                    VSCodeWorkspaceService.showWarningMessage(`The recipe file "${RecipeYamlScalar.escapeForNotification(panelAction.filePath)}" no longer exists. Re-open the Recipe Cockpit to load the runs currently on disk.`);
                    return;
                }

                await VSCodeWorkspaceService.openFileInEditor(panelAction.filePath, panelAction.lineNumber);
                return;

            case 'activateValidationRuleList': {

                const pendingList = panelState.pendingValidationRuleListKeys.get(panelAction.treeKey);
                pendingList?.ruleKeys.forEach(ruleKey => panelState.openableValidationRuleKeys.add(ruleKey));
                panelState.pendingValidationRuleListKeys.delete(panelAction.treeKey);
                return;

            }

            case 'selectRun':

                if ( panelAction.customTreeFolderName ) {
                    this.selectedCustomTreeFolderNameByRunFolderName.set(panelAction.runFolderName, panelAction.customTreeFolderName);
                } else {
                    this.selectedCustomTreeFolderNameByRunFolderName.delete(panelAction.runFolderName);
                }
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelAction.runFolderName, undefined, undefined,
                    loadedRecipe => this.confirmRunSwitchSelections(panelState, loadedRecipe));
                return;

            case 'generateTreecipe':

                await this.generateTreecipeAndReload(cockpitPanel, panelState);
                return;

            case 'openHelpGuide':

                await vscode.env.openExternal(vscode.Uri.parse(RECIPE_COCKPIT_HELP_GUIDE_URL, true));
                return;

            case 'postPicklistValues':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'postInsertState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'persistPlace':

                this.schedulePanelPlacePersist(panelAction.place);
                return;

            case 'activateTroubleshootingHistory': {

                const pendingFiles = panelState.pendingHistoryFiles.get(panelAction.treeKey);
                if ( pendingFiles ) {
                    panelState.historyFiles.set(panelAction.treeKey, pendingFiles);
                }
                return;

            }

            case 'activateDatasetJourney': {

                const pendingFiles = panelState.pendingJourneyFiles.get(panelAction.datasetFolderName);
                if ( pendingFiles ) {
                    panelState.journeyFiles.set(panelAction.datasetFolderName, pendingFiles);
                }
                return;

            }

            case 'activateUpdaterValues':

                panelState.updatableTreeKeys = panelState.pendingUpdatableTreeKeys;
                return;

            case 'activateRecordLinks': {

                const drawnPreview = panelState.pendingOpenableRecordPreviews.get(panelAction.recordLinkSequence);
                if ( drawnPreview ) {
                    panelState.openableRecordPreviews.set(panelAction.recordLinkSequence, drawnPreview);
                }
                return;

            }

            case 'activateUpdaterSnapshots': {

                const pendingSnapshots = panelState.pendingRestorableSnapshots.get(panelAction.treeKey);
                if ( pendingSnapshots ) {
                    panelState.restorableSnapshots.set(panelAction.treeKey, pendingSnapshots.snapshotPathsByName);
                }
                return;

            }

            case 'openChangelog':

                await this.openChangelogInBrowser();
                return;

        }

    }

    /*
        Tagged with the model the rename was typed over, never the one on screen when the write
        ends: a model posted during the write would otherwise take an answer meant for a box it never drew.
    */
    static postNameEditResult(cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        answered: Omit<IRecipeCockpitNameEditResultMessage, 'command' | 'refusal'>,
                                        refusal: string | undefined) {

        if ( this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        const resultMessage: IRecipeCockpitNameEditResultMessage = { command: 'nameEditResult', ...answered };
        if ( refusal !== undefined ) {
            resultMessage.refusal = refusal;
        }

        this.postToPanel(cockpitPanel, resultMessage);

    }

    /*
        undefined when the card excludes nothing and unticks nothing; otherwise the filtered copy, or a
        refusal naming the tree. A recipe that cannot be read, scanned or cut refuses rather than generating the whole
        tree the reader narrowed (#219).
    */
    static resolveRunFakerFilteredRecipe(panelState: IRecipeCockpitPanelState,
                                                    treeKey: string,
                                                    recipeFilePath: string,
                                                    refusalPrefix: string): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } | undefined {

        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(candidateTree => candidateTree.treeKey === treeKey);

        if ( !recipeViewModel || !tree
                || ( RecipeCockpitTreeSelectionStore.listExcludedObjectApiNames(tree).length === 0 && this.listExcludedFieldApiNamesByObject(tree).size === 0
                    && this.listObjectCountsByObject(tree).size === 0 && !tree.fixedValues?.length
                    && this.listUnconstrainedValuesByObject(recipeViewModel, tree).size === 0 ) ) {
            return undefined;
        }

        const treeLabel = RecipeYamlScalar.escapeForNotification(tree.customName ?? tree.title);
        const refuse = (reason: string) => ({
            refusalMessage: `${refusalPrefix} ${treeLabel}: ${RecipeYamlScalar.escapeForNotification(reason)} Nothing was generated, rather than the whole tree with what the Treecipe tab leaves out, recounts, fixes, constrains or switches off put back in.`
        });

        let recipeText: string;
        try {
            recipeText = fs.readFileSync(recipeFilePath, 'utf8');
        } catch (readError) {
            return refuse(`its recipe could not be read (${String(readError?.code ?? readError)}).`);
        }

        const filteredRecipe = this.buildRunFakerFilteredRecipe(recipeText, tree, panelState.objectLevelsByApiName, recipeViewModel);

        return 'refusalMessage' in filteredRecipe ? refuse(filteredRecipe.refusalMessage) : filteredRecipe;

    }

    /*
        "Remember this selection" (#196): the selection goes into treecipe.config.json beside every
        record type each of its objects had in the model on screen, which is how a record type added
        later is noticed. A selection the router already matched against what the model offered, so
        every name is one the panel drew. An empty selection (every object at its default) removes a
        saved one. A failed save is a warning and the generate still runs: the reader asked for that
        data whether or not the ticks could be remembered.
    */
    static saveRecordTypeSelection(panelState: IRecipeCockpitPanelState, recordTypeSelection: Record<string, string[]>): boolean {

        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const objectsByApiName = recipeViewModel ? RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel) : new Map<string, IRecipeCockpitObjectViewModel>();
        const recordTypesWhenSelectionSaved: Record<string, string[]> = Object.create(null);

        Object.keys(recordTypeSelection).forEach((objectApiName) => {
            const recordTypes = objectsByApiName.get(objectApiName)?.recordTypes;
            if ( recordTypes ) {
                recordTypesWhenSelectionSaved[objectApiName] = recordTypes.map(recordType => recordType.developerName);
            }
        });

        try {
            RecordTypeSelectionConfiguration.saveRecordTypeSelections(recordTypeSelection, recordTypesWhenSelectionSaved);
            return true;
        } catch (saveError) {
            const failureReason = saveError instanceof Error ? saveError.message : String(saveError);
            void vscode.window.showWarningMessage(`${RECIPE_COCKPIT_RECORD_TYPE_SELECTION_NOT_SAVED_MESSAGE} ${RecipeYamlScalar.escapeForNotification(failureReason)}`);
            return false;
        }

    }

    /*
        The no-run empty state's Generate Treecipe button (#214): hands off to Generate Treecipe, then
        loads the run it wrote. The command is the unflagged one a reader can already run from the
        palette. The latest run is loaded afterwards whether or not generation wrote one: Generate
        Treecipe reports its own failures, and reloading shows the reader exactly what is on disk.
    */
    private static async generateTreecipeAndReload(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState) {

        /*
            In flight until the RELOAD has finished, not only the command, so a second click before
            the new model renders starts no second generation.

            The run is reloaded even when generation FAILED. The panel disabled its button on the
            click and only a render gives one back, so a failure that skipped the reload would leave
            the reader a button that can never be pressed again. The failure is still rethrown for
            ErrorHandlingService once the panel is usable.
        */
        panelState.isGenerateTreecipeInFlight = true;

        let hasGenerationFailed = false;
        let generationError: unknown;

        try {

            try {
                await vscode.commands.executeCommand(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND, RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS);
            } catch (commandError) {
                hasGenerationFailed = true;
                generationError = commandError;
            }

            if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot);
            }

        } finally {
            panelState.isGenerateTreecipeInFlight = false;
        }

        if ( hasGenerationFailed ) {
            throw generationError;
        }

    }

    // A MODAL DETAIL IS PLAIN TEXT, BUT A VALUE CARRYING A LINE BREAK -- OF EITHER PARSER'S KIND -- COULD STILL ADD A LINE THAT LOOKS LIKE OURS
    static toSingleLine(text: string): string {

        return String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

    }

    static isMetadataDeployInFlight = false;

    static metadataDeployRunStateMessage: IRecipeCockpitMetadataDeployStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    static setMetadataDeployState(deployStateMessage: IRecipeCockpitMetadataDeployStateMessage) {

        this.metadataDeployRunStateMessage = deployStateMessage.isRunning ? deployStateMessage : undefined;
        this.recipeCockpitPanelState.metadataDeployStateMessage = deployStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, deployStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE A DEPLOY RUNS (A REOPEN) HOLDS WHAT THE RUN HOLDS
    private static adoptMetadataDeployRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isMetadataDeployInFlight && this.metadataDeployRunStateMessage ) {
            panelState.metadataDeployStateMessage = this.metadataDeployRunStateMessage;
        }

    }

    // WHAT A HOST READS OF THE SHARED ORG RUNS THROUGH ITS HUB TYPE: RecipeCockpitOrgRuns OWNS IT (#671)
    static async resolveSelectedReadOrg(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, refusalPrefix: string, placeholder: string, busyRefusal: string, connectionFailedAdvice: string, promptFlag: 'isQueryOrgPromptOpen' | 'isOrgPromptOpen'): Promise<IAuthenticatedOrgDetail | undefined> {
        return RecipeCockpitOrgRuns.resolveSelectedReadOrg(this, cockpitPanel, panelState, refusalPrefix, placeholder, busyRefusal, connectionFailedAdvice, promptFlag);
    }

    static readSourceApiVersion(workspaceRoot: string): string | undefined {
        return RecipeCockpitOrgRuns.readSourceApiVersion(workspaceRoot);
    }

    static async runCancellableRetrieve(progressTitle: string, cliArguments: string[], workspaceRoot: string, jsforceRetrieve: { orgUsername: string; components: IMetadataDeployComponent[]; destination: MetadataRetrieveDestination }, panelCancellation?: IRecipeCockpitPanelCancellation): Promise<{ invocation: ISalesforceCliInvocationResult; isCancelled: boolean; isNothingWritten?: boolean; payload: Record<string, unknown> | undefined }> {
        return RecipeCockpitOrgRuns.runCancellableRetrieve(progressTitle, cliArguments, workspaceRoot, jsforceRetrieve, panelCancellation);
    }

    static async runCancellableCli(progressTitle: string, cliArguments: string[], timeoutMilliseconds: number, workspaceRoot: string, maxBufferBytes?: number, panelCancellation?: IRecipeCockpitPanelCancellation): Promise<{ invocation: ISalesforceCliInvocationResult; isCancelled: boolean }> {
        return RecipeCockpitOrgRuns.runCancellableCli(progressTitle, cliArguments, timeoutMilliseconds, workspaceRoot, maxBufferBytes, panelCancellation);
    }

    // WHAT A TREE'S DEPLOYS ARE READ FOR: THE OBJECTS ITS INSERT SENDS, EACH WITH ITS RECIPE FIELDS LESS THE UNTICKED ONES
    static listTreeDeployObjects(recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): IMetadataDeployObject[] {

        const insertObjectApiNames = new Set(RecipeCockpitTreecipeDataOrgs.listTreeInsertObjectApiNames(this, recipeViewModel, tree));
        const objectsByApiName = RecipeCockpitTreeSelectionStore.buildObjectsByApiName(recipeViewModel);
        /*
            A field is left out of a deploy only when EVERY occurrence of its object leaves it out
            (#467): one occurrence still sending it needs it in the org. Occurrences and selections are
            each indexed once, so the list stays linear in the tree.
        */
        const occurrenceCountsByObject = new Map<string, number>();
        tree.objects.forEach(treeObject => {
            const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
            const isOwnOccurrence = treeObject.iterationNickname === undefined || ( !!objectViewModel && RecipeCockpitTreeSelectionStore.readOccurrenceNickname(objectViewModel) !== undefined );
            if ( isOwnOccurrence ) {
                occurrenceCountsByObject.set(treeObject.objectApiName, ( occurrenceCountsByObject.get(treeObject.objectApiName) ?? 0 ) + 1);
            }
        });
        const exclusionsByObject = new Map<string, string[][]>();
        ( tree.fieldSelection?.objects ?? [] ).forEach(objectFieldSelection => {
            const exclusions = exclusionsByObject.get(objectFieldSelection.objectApiName) ?? [];
            exclusions.push(objectFieldSelection.excludedFieldApiNames);
            exclusionsByObject.set(objectFieldSelection.objectApiName, exclusions);
        });
        const listExcludedEverywhere = (objectApiName: string): string[] => {
            const exclusions = exclusionsByObject.get(objectApiName) ?? [];
            if ( exclusions.length === 0 || exclusions.length < ( occurrenceCountsByObject.get(objectApiName) ?? 1 ) ) {
                return [];
            }
            return exclusions.reduce((excludedEverywhere, excludedHere) => {
                const excludedHereSet = new Set(excludedHere);
                return excludedEverywhere.filter(fieldApiName => excludedHereSet.has(fieldApiName));
            });
        };

        return recipeViewModel.objects
            .filter(objectViewModel => insertObjectApiNames.has(objectViewModel.objectApiName))
            .map(objectViewModel => {
                const excludedFieldApiNames = new Set(listExcludedEverywhere(objectViewModel.objectApiName));
                return {
                    objectApiName: objectViewModel.objectApiName,
                    fieldApiNames: objectViewModel.fields
                        .map(fieldViewModel => fieldViewModel.fieldApiName)
                        .filter(fieldApiName => !excludedFieldApiNames.has(fieldApiName))
                };
            });

    }

    // APPLY WRITES FIELD FILES INTO THE PROJECT (#445): A RETRIEVE, A DEPLOY OR A GENERATION READING OR WRITING THEM WAITS FOR IT
    static isApplyingAdapterFiles(panelState: IRecipeCockpitPanelState): boolean {
        return panelState.updaterLoadStateMessage?.isRunning === true && panelState.updaterLoadStateMessage.runKind === 'apply';
    }

    /*
        Whether a prompt or the Treecipe Adapter holds the org selection: the Adapter's load (#416), a
        query (#439), a retrieve or a confirmation's "Change org…" (#480) asking for an org, or an update (#418) or a restore (#419) writing to the org selected. Every route that would change the selection, or
        write to it, refuses while it does.
    */
    static isSelectionHeldByPromptOrUpdater(panelState: IRecipeCockpitPanelState): boolean {
        return panelState.isUpdaterOrgPromptOpen === true
            || panelState.isQueryOrgPromptOpen === true
            || panelState.isOrgPromptOpen === true
            || ( panelState.updaterLoadStateMessage?.isRunning === true
                    && ( panelState.updaterLoadStateMessage.runKind === 'update' || panelState.updaterLoadStateMessage.runKind === 'restore' ) );
    }

    /*
        What holds the selection, said for the reader, or undefined when nothing does (#537).
        Each is a run the listing must not change the selection under: it ends by checking or
        listing the org itself.
    */
    static describeSelectionHoldingRun(panelState: IRecipeCockpitPanelState): string | undefined {

        if ( panelState.scratchOrgStateMessage?.isRunning ) {
            return 'A new scratch org run is using the selected org';
        }
        if ( panelState.insertStateMessage ) {
            return 'An insert is using the selected org';
        }
        if ( panelState.permissionSetAssignStateMessage?.isRunning ) {
            return 'A permission set assignment is using the selected org';
        }
        if ( panelState.metadataDeployStateMessage?.isRunning ) {
            return 'A metadata deploy is using the selected org';
        }
        if ( panelState.isUpdaterOrgPromptOpen === true || panelState.isQueryOrgPromptOpen === true || panelState.isOrgPromptOpen === true ) {
            return 'A prompt asking for an org is open';
        }
        if ( panelState.updaterLoadStateMessage?.isRunning === true && panelState.updaterLoadStateMessage.runKind === 'restore' ) {
            return 'A Treecipe Adapter restore is using the selected org';
        }
        if ( this.isSelectionHeldByPromptOrUpdater(panelState) ) {
            return 'A Treecipe Adapter update is using the selected org';
        }

        return undefined;

    }

    /*
        Where a tree's run files go (#470): GeneratedRecipes/<run on screen>/<tree folder>/RunArtifacts.
        Undefined for a card with no folder, or one whose folder is not a real folder inside the
        workspace, and then a writer writes nothing.
    */
    static resolveTreeRunArtifactsLocation(workspaceRoot: string,
                                            recipeViewModel: Pick<IRecipeCockpitRecipeViewModel, 'selectedRunFolderName'>,
                                            tree: Pick<IRecipeCockpitTreeViewModel, 'folderName'>): IRecipeCockpitRunArtifactsLocation | undefined {

        return RecipeCockpitRunArtifacts.resolveTreeLocation(
            workspaceRoot,
            path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath()),
            recipeViewModel.selectedRunFolderName,
            tree.folderName
        );

    }

    /*
        Where a tree's update snapshots are listed from (#470): its RunArtifacts in the run on
        screen first, then in every other run that has the tree's folder, newest first, so an
        update made before a regeneration can still be restored from the run drawn now.
    */
    static resolveTreeSnapshotLocations(workspaceRoot: string,
                                        recipeViewModel: Pick<IRecipeCockpitRecipeViewModel, 'selectedRunFolderName' | 'runs'>,
                                        tree: Pick<IRecipeCockpitTreeViewModel, 'folderName'>): IRecipeCockpitRunArtifactsLocation[] {

        const runFolderNames = [...new Set([recipeViewModel.selectedRunFolderName, ...recipeViewModel.runs.map(run => run.runFolderName)])];

        return runFolderNames
            .map(runFolderName => this.resolveTreeRunArtifactsLocation(workspaceRoot, { selectedRunFolderName: runFolderName }, tree))
            .filter((location): location is IRecipeCockpitRunArtifactsLocation => location !== undefined);

    }

    // THE BACKEND A CARD'S RECIPE WAS WRITTEN FOR, FROM ITS PATH, OR UNDEFINED WHEN IT HAS NO SINGLE RECIPE OR THE PATH DOES NOT SAY
    static readTreeFakerService(panelState: IRecipeCockpitPanelState, treeKey: string): 'faker-js' | 'snowfakery' | undefined {

        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);
        if ( !recipeFilePath || !RecipeCockpitTreeSelectionStore.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
            return undefined;
        }

        return VSCodeWorkspaceService.readRecipeFakerService(path.join(panelState.workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath()), recipeFilePath);

    }

    // WHAT HOLDS AN APPLY BACK: ANYTHING ELSE THAT READS OR WRITES THE PROJECT'S METADATA OR RECIPE
    static isApplyHeldByAnotherRun(panelState: IRecipeCockpitPanelState): boolean {
        return this.isMetadataDeployInFlight
            || this.isMetadataRetrieveInFlight
            || !!panelState.wireLookupStateMessage
            || panelState.isGenerateTreecipeInFlight
            || this.isApplyingObjectRefresh(panelState);
    }

    // GET LATEST OBJECT DETAIL'S APPLY WRITES METADATA FILES AND THE RECIPE (#612), SO WHAT READS OR WRITES THEM WAITS, AS FOR THE ADAPTER'S (#445)
    static isApplyingObjectRefresh(panelState: IRecipeCockpitPanelState): boolean {
        return panelState.objectRefreshSession?.stateMessage.step === 'applying';
    }

    // WHY A RUN WAITS FOR AN APPLY OF RETRIEVED FILES, THE ADAPTER'S OR GET LATEST OBJECT DETAIL'S; UNDEFINED WHEN NONE RUNS
    static findRetrievedFilesApplyRefusal(panelState: IRecipeCockpitPanelState): string | undefined {
        return this.isApplyingAdapterFiles(panelState) ? RECIPE_COCKPIT_ADAPTER_APPLY_RUNNING_REFUSAL
            : this.isApplyingObjectRefresh(panelState) ? RECIPE_COCKPIT_OBJECT_REFRESH_APPLY_RUNNING_REFUSAL
            : undefined;
    }

    // A CANCELLED OR ABANDONED RETRIEVE LEAVES NOTHING BEHIND; A FOLDER THAT IS NOT A PLAIN ONE UNDER treecipe/ IN THIS WORKSPACE IS LEFT ALONE
    static discardObjectRefreshStaging(panelState: IRecipeCockpitPanelState) {

        const session = panelState.objectRefreshSession;
        const stagingFolderPath = session?.stagingFolderPath;
        if ( !stagingFolderPath ) {
            return;
        }
        const packageXmlFilePath = session.packageXmlFilePath;
        session.stagingFolderPath = undefined;
        session.packageXmlFilePath = undefined;

        try {
            RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument(panelState.workspaceRoot, stagingFolderPath);
            if ( fs.lstatSync(stagingFolderPath).isDirectory() && SfdxProjectService.isPathContainedInWorkspace(stagingFolderPath, panelState.workspaceRoot) ) {
                fs.rmSync(stagingFolderPath, { recursive: true, force: true });
            }
            if ( packageXmlFilePath && fs.lstatSync(packageXmlFilePath).isFile() && SfdxProjectService.isPathContainedInWorkspace(packageXmlFilePath, panelState.workspaceRoot) ) {
                fs.rmSync(packageXmlFilePath, { force: true });
            }
        } catch {
            // NOTHING TO REMOVE, OR NOTHING THIS MAY REMOVE
        }

    }

    /*
        The expression a field's new values are generated from (#417): the FIRST "\${{ ... }}" line of
        its recipe value, as the Updater's editor starts from it -- a double-quoted one unquoted. The
        model's value is the display form (continuation lines moved to column 0, a block indicator
        dropped), so a record type's commented variants and a "### Driven by ValidationRule" note are
        left out rather than written as lines no recipe layout reads. Undefined when there is none
        (a TODO comment loads as null).
    */
    static findRecipeExpression(recipeValue: string | undefined): string | undefined {

        return RecipeCockpitRecipeWriter.findFirstExpressionLine(recipeValue);

    }

    // A FIELD'S VALUE AS THE ORG'S ANSWER CASES IT: SOQL NAMES ARE CASE-INSENSITIVE, AND THE ORG ANSWERS WITH ITS OWN CASING
    static readRecordFieldValue(record: Record<string, unknown>, fieldApiName: string): unknown {
        if ( Object.prototype.hasOwnProperty.call(record, fieldApiName) ) {
            return record[fieldApiName];
        }
        const lowerCaseName = fieldApiName.toLowerCase();
        const matchingKey = Object.keys(record).find(recordKey => recordKey.toLowerCase() === lowerCaseName);
        return matchingKey === undefined ? null : record[matchingKey];
    }

    // WHICH FIELDS AN UPDATE OR A RESTORE WROTE THAT ONLY THE ORG HELD (#446), FOR THE RESULTS FILE; NOTHING WHEN THERE WERE NONE
    static buildOrgOnlyFieldsResult(snapshotObjects: readonly IUpdateSnapshotObject[]): { orgOnlyFields?: Record<string, string[]> } {

        const orgOnlyEntries = snapshotObjects
            .filter(snapshotObject => ( snapshotObject.orgOnlyFieldApiNames ?? [] ).length > 0)
            .map((snapshotObject): [string, string[]] => [snapshotObject.objectApiName, [...snapshotObject.orgOnlyFieldApiNames as string[]]]);

        return orgOnlyEntries.length > 0 ? { orgOnlyFields: Object.fromEntries(orgOnlyEntries) } : {};

    }

    /*
        Why a field a snapshot says only the org held (#446) is not one the Treecipe Adapter writes
        back, from the org's describe: the Updater's lock rule read off what the org says the field is,
        since the recipe has no model of it. Not updateable or calculated is findUpdateReason's.
    */
    static findDescribedOrgOnlyFieldLockReason(fieldApiName: string, describedField: INormalizedOrgField | undefined): string | undefined {

        if ( !describedField ) {
            return undefined;
        }
        if ( fieldApiName.toLowerCase() === 'recordtypeid' ) {
            return RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON;
        }
        if ( describedField.fieldType === 'reference' || describedField.referenceTo.length > 0 ) {
            return RECIPE_COCKPIT_UPDATER_LOOKUP_REASON;
        }
        if ( describedField.controllingField ) {
            return `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}${describedField.controllingField}`;
        }
        if ( describedField.isCalculated ) {
            return RECIPE_COCKPIT_UPDATER_FORMULA_REASON;
        }

        return undefined;

    }

    // A FOLDER NAME CAN CARRY A BIDI OR CONTROL CHARACTER THAT MAKES A PATH READ AS ANOTHER; THE FILE OPENED IS CHOSEN BY INDEX, SO ONLY THE TEXT IS CLEANED
    static toDisplayedRelativePath(workspaceRoot: string, filePath: string): string {

        return path.relative(workspaceRoot, filePath)
            .split(path.sep)
            .join('/')
            .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '');

    }

    // WHETHER A PICKLIST IS WRITTEN ON AN OBJECT WITH RECORD TYPES, WHICH CAN NARROW IT: THE ORG DECIDES, PER RECORD (#418)
    static hasRecordTypePicklist(recipe: IRecipeCockpitRecipeViewModel,
                                         plannedObjects: ReadonlyArray<{ objectApiName: string; fieldApiNames: readonly string[] }>,
                                         describeOutcomes: ReadonlyMap<string, { describe?: { fields: ReadonlyArray<{ fieldApiName: string; fieldType: string }> } }>): boolean {

        return plannedObjects.some(plannedObject => {
            const describedFields = describeOutcomes.get(plannedObject.objectApiName)?.describe?.fields ?? [];
            return recipe.objects.some(object => object.objectApiName === plannedObject.objectApiName && ( object.recordTypes ?? [] ).length > 1)
                && plannedObject.fieldApiNames.some(fieldApiName => {
                    const fieldType = describedFields.find(describedField => describedField.fieldApiName.toLowerCase() === fieldApiName.toLowerCase())?.fieldType;
                    return fieldType === 'picklist' || fieldType === 'multipicklist';
                });
        });

    }

    static isMetadataRetrieveInFlight = false;

    static metadataRetrieveRunStateMessage: IRecipeCockpitMetadataRetrieveStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    static setMetadataRetrieveState(retrieveStateMessage: IRecipeCockpitMetadataRetrieveStateMessage) {

        this.metadataRetrieveRunStateMessage = retrieveStateMessage.isRunning ? retrieveStateMessage : undefined;
        this.recipeCockpitPanelState.metadataRetrieveStateMessage = retrieveStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, retrieveStateMessage);
        }

    }

    private static adoptMetadataRetrieveRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isMetadataRetrieveInFlight && this.metadataRetrieveRunStateMessage ) {
            panelState.metadataRetrieveStateMessage = this.metadataRetrieveRunStateMessage;
        }

    }

    /*
        A retrieve's ONE notification: information on a success, a warning otherwise. "Generate
        Treecipe" is offered whenever files may have been written, since generation reads them (#324
        applies validation rules); "View output" whenever a warning has a result file. NOT AWAITED: the run ends,
        and gives the panel its button back, without waiting for the reader.
    */
    static showMetadataRetrieveNotification(severity: 'information' | 'warning',
                                                            notificationText: string,
                                                            outputFilePath: string | undefined,
                                                            workspaceRoot: string,
                                                            isGenerateOffered: boolean) {

        const actions = [
            ...( isGenerateOffered ? [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL] : [] ),
            ...( outputFilePath ? [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL] : [] )
        ];
        ({ severity, notificationText } = this.withRunArtifactsGitIgnoreNote(severity, notificationText, outputFilePath));
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);
        const shown = severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions);

        Promise.resolve(shown)
            .then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL ) {
                    await this.generateTreecipeAfterMetadataRetrieve();
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The retrieve result file no longer exists in this workspace.');
                }
            })
            .catch(retrieveFollowUpError => ErrorHandlingService.handleCapturedError(retrieveFollowUpError, 'openRecipeCockpit'));

    }

    /*
        The notification's "Generate Treecipe": through the open cockpit when there is one, so the
        panel reloads the run it writes, and refused while an insert holds the selection or a
        generation is already running. With no cockpit open it runs the command itself.
    */
    private static async generateTreecipeAfterMetadataRetrieve() {

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;

        if ( !cockpitPanel ) {
            await vscode.commands.executeCommand(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND);
            return;
        }

        if ( panelState.isGenerateTreecipeInFlight || panelState.insertStateMessage || this.isApplyingAdapterFiles(panelState) || this.isApplyingObjectRefresh(panelState) ) {
            VSCodeWorkspaceService.showWarningMessage('Generate Treecipe was not started: a generation, an insert or an Apply of retrieved files is running. Run it once that has finished.');
            return;
        }

        await this.generateTreecipeAndReload(cockpitPanel, panelState);

    }

    /*
        A run file written into a tree's RunArtifacts folder whose .gitignore no longer ignores
        everything (#470) is said in the notification, which is then at least a warning, as the
        Query and Adapter flows say it.
    */
    static withRunArtifactsGitIgnoreNote<Severity extends 'information' | 'warning'>(severity: Severity,
                                                                                            notificationText: string,
                                                                                            outputFilePath: string | undefined): { severity: Severity | 'warning'; notificationText: string } {

        return outputFilePath && RecipeCockpitRunArtifacts.isRunFileExposedToGit(outputFilePath)
            ? { severity: 'warning', notificationText: `${notificationText} ${RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE}` }
            : { severity: severity, notificationText: notificationText };

    }

    // THE CARD OF THE NAMED TREE, ON THE TROUBLESHOOTING TAB AND SUB-TAB; undefined WHEN NO CARD HAS THAT FOLDER
    static resolveTroubleshootingFocus(recipeViewModel: IRecipeCockpitRecipeViewModel, focusRequest: IRecipeCockpitTroubleshootingFocusRequest): IRecipeCockpitTreeFocus | undefined {

        const tree = recipeViewModel.trees.find(candidateTree => candidateTree.folderName !== '' && candidateTree.folderName === focusRequest.treeFolderName);

        return tree ? { treeKey: tree.treeKey, tab: 'troubleshooting', troubleshootingSubTab: focusRequest.troubleshootingSubTab } : undefined;

    }

    /*
        The options "treecipe.openRecipeCockpit" was run with, for "Open Troubleshooting" (#375). The
        command is callable by id, so the run and tree are kept only as plain folder NAMES and the
        sub-tab only when it is one the tab draws; they are matched against the loaded run, never opened.
    */
    static readTroubleshootingFocusRequest(openOptions: unknown): IRecipeCockpitTroubleshootingFocusRequest | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(openOptions) || openOptions.focusTroubleshooting !== true ) {
            return undefined;
        }

        const { runFolderName, treeFolderName, troubleshootingSubTab } = openOptions;
        const isFolderName = (candidate: unknown): candidate is string => RecipeCockpitPanelPlace.isBoundedText(candidate) && candidate !== '' && DatasetSourceService.isSafeFolderOrFileName(candidate);

        if ( !isFolderName(runFolderName) || !isFolderName(treeFolderName) || !( RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS as readonly unknown[] ).includes(troubleshootingSubTab) ) {
            return undefined;
        }

        return { runFolderName: runFolderName, treeFolderName: treeFolderName, troubleshootingSubTab: troubleshootingSubTab as RecipeCockpitTroubleshootingSubTab };

    }

    /*
        The whole host side of the protocol, as a pure function of the message and the host's state.

        Separated from the subscription so every decision -- above all, every allow-list check -- is
        asserted without a live webview. An unrecognized command, or a recognized one whose payload
        is not the type it should be or names something the rendered model did not, is answered
        with nothing: the panel and the host ship in one .vsix, so such a message did not come from
        the panel, and replying to it would tell it something.
    */
    static routePanelMessage(panelMessage: IRecipeCockpitPanelMessage | undefined,
                                panelState: IRecipeCockpitPanelState): RecipeCockpitPanelAction | undefined {

        if ( panelMessage && RecipeCockpitQueryHost.isQueryCommand(panelMessage.command) ) {
            return RecipeCockpitQueryHost.routePanelMessage(panelMessage, panelState);
        }

        if ( panelMessage && RecipeCockpitTroubleshootingHost.isTroubleshootingCommand(panelMessage.command) ) {
            return RecipeCockpitTroubleshootingHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitDatasetsHost.isDatasetsCommand(panelMessage.command) ) {
            return RecipeCockpitDatasetsHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitAdapterHost.isAdapterCommand(panelMessage.command) ) {
            return RecipeCockpitAdapterHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitTreecipeOrgHost.isTreecipeOrgCommand(panelMessage.command) ) {
            return RecipeCockpitTreecipeOrgHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitTreecipeHost.isTreecipeCommand(panelMessage.command) ) {
            return RecipeCockpitTreecipeHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitRecordLinksHost.isRecordLinksCommand(panelMessage.command) ) {
            return RecipeCockpitRecordLinksHost.routePanelMessage(panelMessage, panelState, this);
        }

        if ( panelMessage && RecipeCockpitCustomTreecipeHost.isCustomTreecipeCommand(panelMessage.command) ) {
            return RecipeCockpitCustomTreecipeHost.routePanelMessage(panelMessage, panelState, this);
        }

        switch ( panelMessage?.command ) {

            case 'ready':
                return { kind: 'replay', hostMessages: this.buildReplayMessages(panelState) };

            // ONLY AN ANSWER UNDER THE ID THE HOST IS WAITING ON; A FORGED, LATE OR REPEATED ONE ROUTES TO NOTHING
            case 'confirmResponse':

                if ( !this.pendingConfirmation || panelMessage.confirmationId !== this.pendingConfirmation.confirmationId ) {
                    return undefined;
                }

                return { kind: 'answerConfirmation', confirmationId: this.pendingConfirmation.confirmationId, choice: panelMessage.choice, isChecked: panelMessage.isChecked, recordTypeSetMode: panelMessage.recordTypeSetMode, isChangeOrg: panelMessage.changeOrg === true };

            /*
                The panel's place, kept in workspaceState too (#230). Only for the model the panel
                confirmed drawing, and only naming that model's run: a place is the reader's, and
                the reader cannot have one in a run that is not on screen.
            */
            case 'savePlace': {

                const drawnRunFolderName = panelState.recipeDataMessage?.recipe.selectedRunFolderName;
                const postedRunFolderName = RecipeCockpitUntrustedValue.isPlainRecord(panelMessage.place) ? panelMessage.place.runFolderName : undefined;

                // THE CHEAP CHECKS FIRST: A PLACE OF ANOTHER RUN IS REFUSED WITHOUT BEING NORMALIZED
                if ( !drawnRunFolderName || postedRunFolderName !== drawnRunFolderName || !panelState.selectableRunFolderNames.has(drawnRunFolderName) ) {
                    return undefined;
                }

                const savedPlace = RecipeCockpitPanelPlace.normalize(panelMessage.place);

                if ( !savedPlace ) {
                    return undefined;
                }

                return { kind: 'persistPlace', place: savedPlace };

            }

            case 'rendered':

                // AN ACKNOWLEDGEMENT CANNOT PRECEDE A MODEL, AND ONLY ACTIVATES THE ONE IT WAS DRAWN FROM
                if ( !panelState.recipeDataMessage || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return undefined;
                }

                return { kind: 'activateActions' };

            /*
                A datasetAdded drawn (#226): only the LAST one posted, and only over the model it was
                added to, once that model's own "rendered" has arrived since the last ready, post or
                failure to draw. Its row's names are already in the pending lists; this makes them active.
            */
            case 'partialRendered':

                if ( !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelMessage.updateSequence !== panelState.datasetUpdateSequence
                        || panelState.datasetUpdateSequence === 0 ) {
                    return undefined;
                }

                return { kind: 'activateDatasetActions' };

            // THE PANEL DREW THE LAST GENERATED VALUES (#418), ON THE MODEL IT ACKNOWLEDGED: "Update records" IS OFFERED ON THEM FROM HERE
            case 'updaterValuesRendered':

                if ( !panelState.recipeDataMessage
                        || !panelState.updaterValuesMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.updaterValuesMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelMessage.valuesSequence !== panelState.updaterValuesMessage.valuesSequence ) {
                    return undefined;
                }

                return { kind: 'activateUpdaterValues' };

            // THE PANEL DREW A CARD'S SNAPSHOT LIST (#419), ON THE MODEL IT ACKNOWLEDGED: RESTORE IS OFFERED ON THOSE NAMES FROM HERE
            case 'updaterSnapshotsRendered': {

                const { treeKey, snapshotsSequence } = panelMessage;
                const pendingSnapshots = typeof treeKey === 'string' ? panelState.pendingRestorableSnapshots.get(treeKey) : undefined;

                if ( typeof treeKey !== 'string'
                        || !pendingSnapshots
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || snapshotsSequence !== pendingSnapshots.snapshotsSequence ) {
                    return undefined;
                }

                return { kind: 'activateUpdaterSnapshots', treeKey: treeKey };

            }

            case 'renderFailed': {

                // ONLY FROM A PANEL THAT WAS ACTUALLY GIVEN SOMETHING TO DRAW
                if ( !panelState.recipeDataMessage ) {
                    return undefined;
                }

                const failureDescription = typeof panelMessage.message === 'string' && panelMessage.message
                    ? panelMessage.message
                    : 'unknown error';

                // ONCE PER DISTINCT FAILURE -- A THROW IN THE FILTER'S HANDLER WOULD OTHERWISE REPORT PER KEYSTROKE
                if ( panelState.reportedFailureDescriptions.has(failureDescription) ) {
                    return undefined;
                }

                return {
                    kind: 'reportRenderFailure',
                    failureDescription: failureDescription,
                    failureStack: typeof panelMessage.stack === 'string' ? panelMessage.stack : '',
                    invalidatesPanel: panelMessage.phase !== 'runtime'
                };

            }

            case 'openSource': {

                const { filePath, lineNumber } = panelMessage;

                if ( typeof filePath !== 'string' || typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) ) {
                    return undefined;
                }

                if ( !panelState.openableSourceKeys.has(this.buildOpenSourceKey(filePath, lineNumber)) ) {
                    return undefined;
                }

                return { kind: 'openSource', filePath: filePath, lineNumber: lineNumber };

            }

            // A VALIDATION RULES LIST WAS DRAWN (#560): ITS LINKS ARE HONOURED FROM HERE, AND ONLY FOR THE MODEL THEY WERE READ FOR
            case 'validationRulesRendered': {

                const { treeKey, renderSequence, listSequence } = panelMessage;
                const pendingList = typeof treeKey === 'string' ? panelState.pendingValidationRuleListKeys.get(treeKey) : undefined;

                if ( !pendingList
                        || panelState.acknowledgedRenderSequence === null
                        || renderSequence !== panelState.acknowledgedRenderSequence
                        || pendingList.renderSequence !== renderSequence
                        || listSequence !== pendingList.listSequence ) {
                    return undefined;
                }

                return { kind: 'activateValidationRuleList', treeKey: treeKey as string };

            }

            /*
                No payload to check: the button is drawn only in the empty state of a model with no
                run, so it is honoured only once THAT model's "rendered" has arrived, and never while
                a generation started from either button is still running or reloading.
            */
            case 'generateTreecipe':

                if ( !panelState.isGenerateTreecipeOffered || panelState.isGenerateTreecipeInFlight ) {
                    return undefined;
                }

                return { kind: 'generateTreecipe' };

            /*
                The help section's "Open the full guide" (#332) carries nothing: the url is the host's,
                so nothing the panel sends can name another address. Routed once any model is posted,
                the empty state's included, since the help is drawn there too.
            */
            case 'openHelpGuide':

                return panelState.recipeDataMessage ? { kind: 'openHelpGuide' } : undefined;

            /*
                Names, not a path, and answered only for a row the CONFIRMED-drawn model marked as a
                picklist: the key has to be in the active set, which the panel's "rendered" fills
                and every reload empties.
            */
            case 'loadPicklistValues': {

                const { objectApiName, fieldApiName, treeKey, nickname } = panelMessage;

                if ( typeof objectApiName !== 'string' || typeof fieldApiName !== 'string' || !panelState.recipeDataMessage
                        || ( treeKey !== undefined && typeof treeKey !== 'string' )
                        || ( nickname !== undefined && typeof nickname !== 'string' ) ) {
                    return undefined;
                }

                if ( !panelState.loadablePicklistKeys.has(this.buildPicklistKey(objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const picklistDisplayValues = panelState.picklistDisplayValuesByObjectApiName.get(objectApiName)?.get(fieldApiName)
                    ?? { picklistValues: [], recordTypePicklistValues: [] };

                return {
                    kind: 'postPicklistValues',
                    hostMessage: {
                        command: 'picklistValues',
                        objectApiName: objectApiName,
                        fieldApiName: fieldApiName,
                        picklistValues: picklistDisplayValues.picklistValues,
                        recordTypePicklistValues: picklistDisplayValues.recordTypePicklistValues,
                        renderSequence: panelState.recipeDataMessage.renderSequence,
                        ...( typeof nickname === 'string' ? { nickname: nickname } : {} ),
                        ...( typeof treeKey === 'string' ? this.readPicklistValueChoice(panelState.recipeDataMessage.recipe, treeKey, objectApiName, fieldApiName, picklistDisplayValues.picklistValues, typeof nickname === 'string' ? nickname : undefined) : {} )
                    }
                };

            }

            // A RUN, OR ONE OF ITS CUSTOM TREES (#677): THE PAIR MUST BE AN ENTRY THE DRAWN PICKER LISTED
            case 'selectRun': {

                const { runFolderName } = panelMessage;
                const customTreeFolderName = typeof panelMessage.customTreeFolderName === 'string' ? panelMessage.customTreeFolderName : undefined;

                if ( typeof runFolderName !== 'string' || ( panelMessage.customTreeFolderName !== undefined && customTreeFolderName === undefined )
                        || !panelState.selectableRunFolderNames.has(this.buildRunPickerKey(runFolderName, customTreeFolderName)) ) {
                    return undefined;
                }

                return { kind: 'selectRun', runFolderName: runFolderName, ...( customTreeFolderName !== undefined ? { customTreeFolderName: customTreeFolderName } : {} ) };

            }

            // THE CARD NEVER GENERATES ONLY (#375): A POSTED generateTree IS ANSWERED BY NOTHING, AND Run Faker by Recipe IS HOW A TREE IS GENERATED WITHOUT AN INSERT
            case 'generateTree':

                return undefined;

            // THE PANEL DREW A CARD'S HISTORY ROWS, ON THE MODEL IT ACKNOWLEDGED: THEIR FILES OPEN FROM HERE
            case 'troubleshootingHistoryRendered': {

                const { treeKey, historySequence } = panelMessage;
                const pendingFiles = typeof treeKey === 'string' ? panelState.pendingHistoryFiles.get(treeKey) : undefined;

                if ( typeof treeKey !== 'string'
                        || !pendingFiles
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || historySequence !== pendingFiles.historySequence ) {
                    return undefined;
                }

                return { kind: 'activateTroubleshootingHistory', treeKey: treeKey };

            }

            case 'datasetJourneyRendered': {

                const { datasetFolderName, journeySequence } = panelMessage;
                const pendingFiles = typeof datasetFolderName === 'string' ? panelState.pendingJourneyFiles.get(datasetFolderName) : undefined;

                if ( typeof datasetFolderName !== 'string'
                        || !pendingFiles
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || journeySequence !== pendingFiles.journeySequence ) {
                    return undefined;
                }

                return { kind: 'activateDatasetJourney', datasetFolderName: datasetFolderName };

            }

            // THE PANEL DREW A PREVIEW'S RECORD LINKS (#556), ON THE MODEL IT ACKNOWLEDGED: ITS ROWS OPEN FROM HERE
            case 'recordLinksRendered': {

                const { recordLinkSequence } = panelMessage;
                const pendingPreview = typeof recordLinkSequence === 'number' ? panelState.pendingOpenableRecordPreviews.get(recordLinkSequence) : undefined;

                if ( typeof recordLinkSequence !== 'number'
                        || !pendingPreview
                        || !panelState.recipeDataMessage
                        || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence
                        || panelState.acknowledgedRenderSequence !== panelState.recipeDataMessage.renderSequence
                        || pendingPreview.renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return undefined;
                }

                return { kind: 'activateRecordLinks', recordLinkSequence: recordLinkSequence };

            }

            /*
                The CHANGELOG link (#333) is routed whatever is on screen, even before a model: it
                opens one constant address, so nothing the message carries is read and there is no
                rendered value for it to have to come from.
            */
            case 'openChangelog':
                return { kind: 'openChangelog' };

        }

        return undefined;

    }

    /*
        What a (re)loaded document is brought back to: the model if there is one, then a failure if
        the load died -- the structure on screen is still worth showing, and the reader still has to
        be told the load behind it did not finish -- and otherwise the phase a load is still in.
    */
    static buildReplayMessages(panelState: IRecipeCockpitPanelState): RecipeCockpitHostMessage[] {

        const replayMessages: RecipeCockpitHostMessage[] = [];

        if ( panelState.extensionVersion ) {
            replayMessages.push({ command: 'extensionInfo', version: panelState.extensionVersion });
        }

        if ( panelState.recipeDataMessage ) {
            replayMessages.push(this.withRestorePlace(panelState.recipeDataMessage, panelState));
        }

        if ( panelState.insertStateMessage ) {
            replayMessages.push(panelState.insertStateMessage);
        }

        if ( panelState.addFriendStateMessage ) {
            replayMessages.push(panelState.addFriendStateMessage);
        }

        if ( panelState.isOrgOpenInFlight ) {
            replayMessages.push({ command: 'orgOpenState', isRunning: true });
        }

        if ( panelState.wireLookupStateMessage ) {
            replayMessages.push(panelState.wireLookupStateMessage);
        }

        if ( panelState.scratchOrgStateMessage ) {
            replayMessages.push(panelState.scratchOrgStateMessage);
        }

        if ( panelState.metadataRetrieveStateMessage ) {
            replayMessages.push(panelState.metadataRetrieveStateMessage);
        }

        if ( panelState.metadataDeployStateMessage ) {
            replayMessages.push(panelState.metadataDeployStateMessage);
        }

        replayMessages.push(...RecipeCockpitQueryHost.buildReplayMessages(panelState));

        if ( panelState.updaterLoadStateMessage ) {
            replayMessages.push(panelState.updaterLoadStateMessage);
        }

        // A RELOADED DOCUMENT HAS NO DIALOG: ONLY A RUN STILL GOING IS DRAWN AGAIN, SO ITS CANCEL STAYS IN REACH
        const objectRefreshState = panelState.objectRefreshSession?.stateMessage;
        if ( objectRefreshState && ( objectRefreshState.step === 'retrieving' || objectRefreshState.step === 'applying' ) ) {
            replayMessages.push(objectRefreshState);
        }

        if ( panelState.updaterRecordsMessage && panelState.updaterRecordsMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.updaterRecordsMessage);
        }

        if ( panelState.adapterMetadataChangesMessage && panelState.adapterMetadataChangesMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.adapterMetadataChangesMessage);
        }

        if ( panelState.adapterChildBlockMessage && panelState.adapterChildBlockMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.adapterChildBlockMessage);
        }

        if ( panelState.adapterChildPreviewMessage && panelState.adapterChildPreviewMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.adapterChildPreviewMessage);
        }

        if ( panelState.updaterValuesMessage && panelState.updaterValuesMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.updaterValuesMessage);
        }

        if ( panelState.permissionSetAssignStateMessage ) {
            replayMessages.push(panelState.permissionSetAssignStateMessage);
        }

        if ( panelState.loadFailedMessage ) {
            replayMessages.push(panelState.loadFailedMessage);
        } else if ( panelState.loadPhaseMessage ) {
            replayMessages.push({ command: 'loadPhase', message: panelState.loadPhaseMessage });
        }

        return replayMessages;

    }

    static buildOpenSourceKey(filePath: string, lineNumber: number): string {

        return `${filePath}\n${lineNumber}`;

    }

    static buildInsertableFriendKey(treeKey: string, objectApiName: string, iterationNickname: string, friendObjectApiName: string): string {

        return `${treeKey}\n${objectApiName}\n${iterationNickname}\n${friendObjectApiName}`;

    }

    /*
        Every friend a "+" the rendered model draws can add, by card, object, iteration and friend,
        each mapped to the recipe file the iteration is in -- host-only, so the panel never names it.
        Only a card that LISTS the iteration offers it, so a key names a "+" that is on screen.
    */
    static collectInsertableFriendTargets(recipeViewModel: IRecipeCockpitRecipeViewModel): Map<string, string> {

        const insertableFriendTargets = new Map<string, string>();
        const objectsByApiName = new Map(recipeViewModel.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));

        recipeViewModel.trees.forEach(tree => tree.objects
            .filter(treeObject => treeObject.iterationNickname !== undefined)
            .forEach(treeObject => {

                const objectViewModel = objectsByApiName.get(treeObject.objectApiName);
                const iteration = objectViewModel?.iterations?.find(candidateIteration => candidateIteration.nickname === treeObject.iterationNickname);

                if ( !objectViewModel?.recipeFilePath || !iteration ) {
                    return;
                }

                ( iteration.insertableFriendObjectApiNames ?? [] ).forEach(friendObjectApiName => insertableFriendTargets.set(
                    this.buildInsertableFriendKey(tree.treeKey, objectViewModel.objectApiName, iteration.nickname, friendObjectApiName),
                    objectViewModel.recipeFilePath
                ));

            }));

        return insertableFriendTargets;

    }

    static buildWireableLookupKey(treeKey: string, objectApiName: string, objectNickname: string | undefined, fieldApiName: string): string {

        return `${treeKey}\n${RecipeCockpitRecipeWriter.buildLookupWiringKey(objectApiName, objectNickname, fieldApiName)}`;

    }

    // EVERY "Wire to…" THE RENDERED MODEL DRAWS, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY, SO THE PANEL NEVER NAMES IT
    static collectWireableLookupTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitLookupWiringTarget> {

        const wireableLookupTargets = new Map<string, IRecipeCockpitLookupWiringTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.lookupWirings ?? [] ).forEach(wiring => wireableLookupTargets.set(
                this.buildWireableLookupKey(tree.treeKey, wiring.objectApiName, wiring.objectNickname, wiring.fieldApiName),
                { recipeFilePath: recipeFilePath, wiring: wiring }
            ));

        });

        return wireableLookupTargets;

    }

    // EVERY "Add <Parent> to recipe" THE RENDERED MODEL DRAWS, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY, SO THE PANEL NEVER NAMES IT
    static collectAddableParentTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitAddableParentTarget> {

        const addableParentTargets = new Map<string, IRecipeCockpitAddableParentTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.addableParents ?? [] ).forEach(addition => addableParentTargets.set(
                this.buildWireableLookupKey(tree.treeKey, addition.objectApiName, addition.objectNickname, addition.fieldApiName),
                { recipeFilePath: recipeFilePath, addition: addition }
            ));

        });

        return addableParentTargets;

    }

    // EVERY "Use existing <Parent> from org…" THE RENDERED MODEL DRAWS ENABLED, MAPPED TO ITS CARD'S RECIPE FILE -- HOST-ONLY
    static collectOrgRecordLookupTargets(recipeViewModel: IRecipeCockpitRecipeViewModel, recipeFilePathsByTreeKey: ReadonlyMap<string, string>): Map<string, IRecipeCockpitOrgRecordLookupTarget> {

        const orgRecordLookupTargets = new Map<string, IRecipeCockpitOrgRecordLookupTarget>();

        recipeViewModel.trees.forEach(tree => {

            const recipeFilePath = recipeFilePathsByTreeKey.get(tree.treeKey);
            if ( !recipeFilePath ) {
                return;
            }

            ( tree.emptyLookups ?? [] )
                .filter(emptyLookup => emptyLookup.orgRecordRefusal === undefined)
                .forEach(emptyLookup => orgRecordLookupTargets.set(
                    this.buildWireableLookupKey(tree.treeKey, emptyLookup.objectApiName, emptyLookup.objectNickname, emptyLookup.fieldApiName),
                    { recipeFilePath: recipeFilePath, emptyLookup: emptyLookup }
                ));

        });

        return orgRecordLookupTargets;

    }

    static buildPicklistKey(objectApiName: string, fieldApiName: string): string {

        return `${objectApiName}\n${fieldApiName}`;

    }

    // EVERY ROW THE RENDERED MODEL MARKS AS A PICKLIST, AND NOTHING ELSE
    static collectLoadablePicklistKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.objects.flatMap(objectViewModel => objectViewModel.fields
            .filter(fieldViewModel => fieldViewModel.isPicklist)
            .map(fieldViewModel => this.buildPicklistKey(objectViewModel.objectApiName, fieldViewModel.fieldApiName)));

    }

    static collectOpenableValidationRuleKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        const ruleKeys = new Set<string>();
        const collect = (objectApiName: string, fieldViewModels: IRecipeCockpitFieldViewModel[]) => fieldViewModels.forEach(fieldViewModel =>
            ( fieldViewModel.validationRules?.sourceRuleNames ?? [] ).forEach(ruleName => ruleKeys.add(RecipeCockpitValidationRuleList.buildRuleSourceKey(objectApiName, ruleName))));

        recipeViewModel.objects.forEach(objectViewModel => collect(objectViewModel.objectApiName, objectViewModel.fields));

        return [...ruleKeys];

    }

    // EVERY FILE AND LINE THE RENDERED MODEL OFFERS TO OPEN, AND NOTHING ELSE
    static collectOpenableSourceKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        const openableSourceKeys: string[] = [];

        recipeViewModel.objects.forEach(objectViewModel => {

            if ( !objectViewModel.recipeFilePath ) {
                return;
            }

            // EVERY TODO COMMENT THE PANEL LISTS IS ITS OWN LINK (#354); ONE ON ITS OWNER'S LINE IS THAT LINE'S KEY ALREADY
            const pushTodoKeys = (todos: IRecipeCockpitTodoViewModel[] | undefined, ownerLineNumber: number | undefined) => ( todos ?? [] )
                .filter(todo => todo.lineNumber !== ownerLineNumber)
                .forEach(todo => openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, todo.lineNumber)));

            if ( objectViewModel.lineNumber ) {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, objectViewModel.lineNumber));
            }
            pushTodoKeys(objectViewModel.todos, objectViewModel.lineNumber);

            objectViewModel.fields.forEach(fieldViewModel => {
                if ( fieldViewModel.lineNumber ) {
                    openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, fieldViewModel.lineNumber));
                }
                pushTodoKeys(fieldViewModel.todos, fieldViewModel.lineNumber);
            });

            ( objectViewModel.iterations ?? [] ).forEach(iteration => {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iteration.lineNumber));
                pushTodoKeys(iteration.todos, iteration.lineNumber);
                iteration.fields.forEach(iterationField => {
                    openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iterationField.lineNumber));
                    pushTodoKeys(iterationField.todos, iterationField.lineNumber);
                });
            });

        });

        return openableSourceKeys;

    }

}
