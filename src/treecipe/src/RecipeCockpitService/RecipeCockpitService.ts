import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import { IAuthenticatedOrgDetail } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import {
    IOrgDescribeRequestResult,
    IOrgQuerySource,
    IOrgRecordCountOutcome,
    IOrgTypeDetail,
    NO_AUTHORIZED_ORGS_MESSAGE,
    OrgRecordCountStatus,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import {
    IMetadataDiffFieldResult,
    METADATA_DIFF_FIELD_STATUSES,
    MetadataDiffFieldStatus,
    RecipeCockpitMetadataDiff,
    RecipePicklistValuesByObjectApiName
} from './RecipeCockpitMetadataDiff';
import { IScannedObject, RecipeCockpitRecipeWriter } from './RecipeCockpitRecipeWriter';
import { IFieldSize } from '../ObjectInfoWrapper/FieldInfo';
import { RelationshipService } from '../RelationshipService/RelationshipService';
import { DATASET_COLLECTIONS_API_FOLDER_NAME, DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import {
    IRecipeCockpitDatasetRecordCountViewModel,
    IRecipeCockpitTreeHistoryTargets,
    IRecipeCockpitTreeHistoryViewModel,
    IRecipeCockpitTreeSummarySource,
    IRecipeCockpitTreeVersionSummary,
    RecipeCockpitTreeHistory
} from './RecipeCockpitTreeHistory';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const RECIPE_COCKPIT_VIEW_TYPE = 'treecipe.recipeCockpit';

export const RECIPE_COCKPIT_PANEL_TITLE = 'Recipe Cockpit';

// WHAT THE PANEL SHOWS BEFORE THE HOST HAS ANSWERED, SO A HANDSHAKE THAT NEVER COMPLETES IS VISIBLE RATHER THAN BLANK
export const RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT = 'Connecting to the Treecipe extension host…';

export type RecipeCockpitPaletteToken =
    | 'page' | 'surface' | 'border' | 'header'
    | 'text' | 'muted' | 'accent' | 'onAccent'
    | 'rowHover' | 'chipBg' | 'chipText'
    | 'added' | 'removed' | 'changed';

/*
    The cockpit's ONE palette, and the only source of a colour in its stylesheet. The cockpit used
    to read every colour from the VS Code theme, which under a dark theme drew a flat black page
    with no hierarchy; it now looks the same whatever theme the editor uses. Every text/background
    pair the stylesheet draws is held to WCAG 4.5:1 by a test, so a value changed here is measured
    rather than eyeballed.
*/
export const RECIPE_COCKPIT_PALETTE: Readonly<Record<RecipeCockpitPaletteToken, string>> = Object.freeze({
    page: '#F4F6F9',
    surface: '#FFFFFF',
    border: '#DDE3EA',
    header: '#EEF3FB',
    text: '#1F2937',
    muted: '#5B6472',
    accent: '#2563EB',
    onAccent: '#FFFFFF',
    rowHover: '#F1F5FF',
    chipBg: '#EEF2FF',
    chipText: '#3730A3',
    added: '#15803D',
    removed: '#B91C1C',
    changed: '#B45309'
});

export const RECIPE_COCKPIT_LOAD_PHASES = {
    findingRuns: 'Finding generated recipe runs…',
    readingRun: 'Reading the generated recipe run…'
};

export const RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL = 'Compare with an org…';

export const RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER = 'Select the Salesforce org to compare the objects of this recipe with';

export const RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND = 'treecipe.generateTreecipe';

export const RECIPE_COCKPIT_REGENERATE_ACTION_LABEL = 'Regenerate recipe';

/*
    Said beside the button rather than left for the reader to discover: Generate Treecipe reads the
    object metadata in THIS WORKSPACE, never the org. A field the comparison reports as new in the
    org reaches the regenerated recipe only once its metadata has been retrieved into the project,
    so a button that implied otherwise would promise a fix it cannot make.
*/
export const RECIPE_COCKPIT_REGENERATE_NOTE = 'Regenerate recipe re-runs Generate Treecipe from the object metadata in this workspace, not from the org, then opens the latest run. Retrieve the org\'s changes first (for example with "sf project retrieve start") for them to reach the regenerated recipe.';

// WHAT THE PANEL CALLS EACH STATUS, ON A ROW'S BADGE AND IN THE STATUS FILTER
export const RECIPE_COCKPIT_DIFF_STATUS_LABELS: Readonly<Record<MetadataDiffFieldStatus, string>> = {
    'new-in-org': 'new in org',
    'removed-from-org': 'removed from org',
    'type-changed': 'type changed',
    'picklist-changed': 'picklist changed',
    'unchanged': 'unchanged'
};

/*
    How many added or removed picklist values a row NAMES before it says how many more there are.
    The whole list is posted -- it is bounded by the size of one picklist -- but a row naming a
    thousand values is not one a reader can scan, and the count is what they act on.
*/
export const RECIPE_COCKPIT_DIFF_PICKLIST_VALUES_SHOWN = 20;

export const RECIPE_COCKPIT_NO_RUN_MESSAGE = 'No generated recipe run was found under treecipe/GeneratedRecipes. Run "Generate Treecipe" first, then open the Recipe Cockpit again.';

/*
    How many objects a filter opens by itself.

    Rows are built on first expand, so what a keystroke costs is bounded by how many objects it
    EXPANDS rather than by how many match. A one-letter query matches nearly every field in an org;
    opening every object for it would build the whole recipe at once, which is exactly the cost
    building on expand exists to avoid. Past this many, a matching object stays collapsed with its
    match count on its header -- still on screen and still one click away, never hidden.
*/
export const RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT = 25;

/*
    The same bound on the axis the object limit does not reach: an expand builds EVERY row of the
    object, and Salesforce allows 800 fields on one, so 25 objects is up to 20,000 rows. A filter
    stops opening objects once the next would take it past this many rows -- the first matching
    object always opens, however wide, so a query never answers with nothing expanded.
*/
export const RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET = 2000;

// THE FIELD TYPES WHOSE ROWS EXPAND TO THEIR VALUES IN THE STRUCTURE TAB
export const RECIPE_COCKPIT_PICKLIST_FIELD_TYPES: readonly string[] = ['Picklist', 'MultiselectPicklist'];

export const RECIPE_COCKPIT_TREE_TITLE_PREFIX = 'Relationship Tree';

export const RECIPE_COCKPIT_UNGROUPED_TREE_TITLE = 'Not in a relationship tree';

export const RECIPE_COCKPIT_INSERT_DATASET_COMMAND = 'treecipe.insertDataSetBySelectedDirectory';

// A TREE CARD'S ▶ Run Faker HANDS ITS RECIPE FILE TO THIS COMMAND, WHICH KEEPS ITS CONFIRMATION AND BACKEND CHECK
export const RECIPE_COCKPIT_RUN_FAKER_COMMAND = 'treecipe.runFakerByRecipe';
export const RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL = '▶ Run Faker';
export const RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL = 'Running Faker…';

export const RECIPE_COCKPIT_TREE_TABS = ['structure', 'versions', 'datasets'] as const;

export type RecipeCockpitTreeTab = typeof RECIPE_COCKPIT_TREE_TABS[number];

export const RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE = 'This run\'s objects wrapper has no relationship tree data, so each recipe file is shown as its own card, with its objects in file order and no lookups. Run "Generate Treecipe" again to see the run\'s relationship trees.';

const RUN_FOLDER_TIMESTAMP_PATTERN = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/;

const FAKER_JS_RUN_FOLDER_PREFIX = 'recipe-fakerjs-';

const RECIPE_FILE_EXTENSIONS = ['.yml', '.yaml'];

/*
    Where the cockpit's tracked work lives, as a label query rather than a list of issue numbers.

    The epic and its slices are numbered, but a link to any one of them goes stale the moment a
    slice is split or a defect is filed against the panel. The label is what stays true: whatever
    carries it is what the cockpit is, has, and is missing on the day the reader clicks.
*/
export const RECIPE_COCKPIT_ISSUES_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues?q=is%3Aissue+label%3Arecipe-cockpit';

export const ENABLE_RECIPE_COCKPIT_ACTION_LABEL = 'Enable Recipe Cockpit';

export const VIEW_RECIPE_COCKPIT_ISSUES_ACTION_LABEL = 'View Known Issues';

export const RECIPE_COCKPIT_PREVIEW_WARNING_MESSAGE = 'The Recipe Cockpit is an in-development preview.';

/*
    The detail the reader accepts before the flag is written.

    It names the three things that decide whether enabling is a mistake for them: that the panel is
    deliberately incomplete rather than broken, that the switch is scoped to THIS workspace and
    reversible from settings, and where the open work is listed. The url is repeated in the text as
    well as offered as a button because a VS Code dialog renders its detail as plain text -- there
    is no clickable link in a modal, so the button is the link and this line is what a reader can
    copy if they would rather not hand the dialog a browser.
*/
export const RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL = `Every Recipe Cockpit slice ships behind this flag while the panel is being built, so what you are turning on is unfinished on purpose: it traverses a generated recipe and compares its fields with an org you choose, but does not yet write a change back into a recipe, and its layout, its messages and the shape of what it shows will change between releases.

Enabling applies to THIS WORKSPACE only, and nothing else in Treecipe changes. Turn it off at any time in Settings under "salesforce-data-treecipe.recipeCockpitEnabled".

What is built, what is next, and what is known to be missing are tracked under the recipe-cockpit label:
${RECIPE_COCKPIT_ISSUES_URL}`;

// ONE GENERATE TREECIPE RUN ON DISK: ITS FOLDER, WHEN IT RAN, AND THE OBJECTS WRAPPER IT WROTE
export interface IRecipeCockpitRun {
    runFolderName: string;
    runFolderPath: string;
    generatedAtTimestamp: string;
    objectsWrapperFilePath: string;
}

export interface IRecipeCockpitRunViewModel {
    runFolderName: string;
    label: string;
}

/*
    One field row. Every text value is a string rather than optional, so the panel never has to
    tell "absent" from "empty" for something it only displays.

    isOnlyInRecipeFile marks a field the recipe file carries and the objects wrapper does not. The
    standard-field mappings and the record type line are written straight into the recipe and never
    become a FieldInfo, so a view built from the wrapper alone would answer "Account has no Name"
    to a reader who can see Name in the file.
*/
/*
    fieldTypeWithSize is what the Structure tab draws ("Text(50)", "Number(16,2)"); fieldType stays
    the bare type, which is what the Classic list draws and what the diff compares.

    isPicklist is set ONLY on a picklist or multi-select picklist row, and is all the model says
    about its values: the values are posted when the reader expands the row (loadPicklistValues).
    Posting them with the model measured 96.17 MB at 120,000 fields with 50 values per picklist,
    past the 60 MB the issue set as the line for loading them on expand instead.
*/
export interface IRecipeCockpitFieldViewModel {
    fieldApiName: string;
    fieldLabel: string;
    fieldType: string;
    fieldTypeWithSize: string;
    recipeValue: string;
    controllingField: string;
    isOnlyInRecipeFile: boolean;
    lineNumber?: number;
    isPicklist?: boolean;
}

export interface IRecipeCockpitRecordTypePicklistValuesViewModel {
    recordTypeDeveloperName: string;
    picklistValues: string[];
}

// WHAT ONE PICKLIST ROW SHOWS WHEN EXPANDED: ITS ACTIVE VALUES, THEN ONE GROUP PER RECORD TYPE THAT ASSIGNS IT VALUES
export interface IRecipeCockpitPicklistDisplayValues {
    picklistValues: string[];
    recordTypePicklistValues: IRecipeCockpitRecordTypePicklistValuesViewModel[];
}

export type RecipeCockpitPicklistDisplayValuesByObjectApiName = Map<string, Map<string, IRecipeCockpitPicklistDisplayValues>>;


/*
    recipeFilePath is the one path the panel is handed, and it is carried once per OBJECT rather
    than per field: a field only needs its line number to be opened, and a path repeated on every
    row would grow the payload with the field count for no information.
*/
export interface IRecipeCockpitObjectViewModel {
    objectApiName: string;
    recipeFilePath: string;
    recipeFileName: string;
    lineNumber?: number;
    fields: IRecipeCockpitFieldViewModel[];
    // SET ONLY ON AN OBJECT WITH iterations, WHERE THE NICKNAME IS WHAT TELLS ITS OCCURRENCES APART
    nickname?: string;
    iterations?: IRecipeCockpitObjectIterationViewModel[];
}

// ONE FIELD OF A LATER OCCURRENCE: ONLY ITS LINE AND VALUE -- ITS TYPE AND LABEL ARE THE OBJECT'S OWN FIELD'S
export interface IRecipeCockpitObjectIterationFieldViewModel {
    fieldApiName: string;
    lineNumber: number;
    recipeValue: string;
}

/*
    A later occurrence of an object in its recipe file, such as the nested child iteration a
    self-lookup adds (#188). It is told apart by its NICKNAME, never its api name, so its header and
    every field link open the occurrence the reader chose. parentObjectApiName and parentNickname
    name the object whose friends: block holds it.
*/
export interface IRecipeCockpitObjectIterationViewModel {
    nickname: string;
    lineNumber: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fields: IRecipeCockpitObjectIterationFieldViewModel[];
}

// ONE LOOKUP TYING AN OBJECT TO A PARENT IN ITS OWN TREE; A SELF-LOOKUP NAMES ITS OWN OBJECT AS THE PARENT
export interface IRecipeCockpitParentLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    An object as a tree lists it. Its fields are not repeated here: the panel finds them by name in
    the recipe's objects, so the Structure tab and the Classic list draw one posted field model.
*/
export interface IRecipeCockpitTreeObjectViewModel {
    objectApiName: string;
    parentLookups: IRecipeCockpitParentLookupViewModel[];
    // SET ON THE ENTRY FOR ONE OF THE OBJECT'S iterations, WHICH THE PANEL FINDS BY THIS NICKNAME
    iterationNickname?: string;
}

/*
    One relationship tree card. treeKey is the FOLDER the tree's recipe was written to, not its
    position: a position renumbers when another tree is added, and a key that moved would expand,
    scope or search a different card than the reader chose.
*/
/*
    history is set only on a card whose folder is in the run on screen -- the one identity a tree
    keeps across runs. The ungrouped card, and a recipe file with no tree folder, have none, and
    the panel draws no history tabs for them.
*/
/*
    runFakerRecipeFileName is set only on a card ▶ Run Faker can run: the recipe FILE NAME, for the
    button's tooltip. The path stays on the host; the panel posts the treeKey.
*/
export interface IRecipeCockpitTreeViewModel {
    treeKey: string;
    title: string;
    folderName: string;
    objects: IRecipeCockpitTreeObjectViewModel[];
    fieldCount: number;
    history?: IRecipeCockpitTreeHistoryViewModel;
    runFakerRecipeFileName?: string;
}

export interface IRecipeCockpitRecipeViewModel {
    runs: IRecipeCockpitRunViewModel[];
    selectedRunFolderName: string;
    objects: IRecipeCockpitObjectViewModel[];
    trees: IRecipeCockpitTreeViewModel[];
    notices: string[];
    emptyStateMessage: string;
}

/*
    What normalizeObjectsWrapper reads from the wrapper. picklistValuesByObjectApiName is HOST-ONLY:
    the metadata diff compares it with the org's describe, and it is kept off the field view model
    so the model posted to the panel does not grow by every picklist's values. Only a field whose
    wrapper entry carries a picklistValues array and no controllingField has an entry -- no entry
    means the recipe makes no claim about the field's values, which is different from an empty list.
*/
export interface IRecipeCockpitNormalizedObjectsWrapper {
    objects: IRecipeCockpitObjectViewModel[];
    notices: string[];
    isObjectsWrapper: boolean;
    fieldlessObjectApiNames: Set<string>;
    picklistValuesByObjectApiName: Map<string, Map<string, string[]>>;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    recipeTrees: IRecipeCockpitWrapperTree[];
    parentLookupsByObjectApiName: Map<string, IRecipeCockpitParentLookupViewModel[]>;
}

// ONE RecipeFiles ENTRY, AS IT WAS WRITTEN: EVERY OBJECT IT LISTS, IN INSERT ORDER, LOOKUP TARGETS INCLUDED
export interface IRecipeCockpitWrapperTree {
    objectApiNames: string[];
}

export interface IRecipeSourceFieldEntry {
    lineNumber: number;
    valueText: string;
}

export interface IRecipeSourceObjectEntry {
    lineNumber: number;
    nickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    iterations?: IRecipeSourceObjectIterationEntry[];
}

export interface IRecipeSourceObjectIterationEntry {
    nickname: string;
    lineNumber: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
}

export interface IRecipeSourceFile {
    filePath: string;
    objectEntries: Map<string, IRecipeSourceObjectEntry>;
}

/*
    Everything the cockpit webview can post back.

    One shape with every field optional, matching the explorer: nothing arriving here is trusted,
    and routePanelMessage checks the TYPE of every field it reads before matching it against an
    allow-list built from the model the host itself rendered. A posted path is never validated as a
    path and never resolved on the panel's say-so -- it opens only if the rendered model named it.
*/
export interface IRecipeCockpitPanelMessage {
    command?: string;
    filePath?: unknown;
    lineNumber?: unknown;
    runFolderName?: unknown;
    phase?: unknown;
    renderSequence?: unknown;
    objectApiName?: unknown;
    fieldApiName?: unknown;
    treeKey?: unknown;
    orgIndex?: unknown;
    datasetFolderName?: unknown;
    tab?: unknown;
    message?: unknown;
    stack?: unknown;
}

export interface IRecipeCockpitLoadPhaseMessage {
    command: 'loadPhase';
    message: string;
}

/*
    renderSequence is echoed back by the panel's "rendered", so an acknowledgement can only promote
    the allow-lists of the model it was actually drawn from. Without it, a replayed model's ack
    arriving after a newer load had posted would activate the NEWER model's targets while the older
    one's rows were on screen.
*/
/*
    focusTree is set only on a reload the host made because a data set the reader acted on was gone:
    it re-opens the card and tab the reader was on, so "refreshed" does not mean "thrown back to a
    collapsed list".
*/
export interface IRecipeCockpitRecipeDataMessage {
    command: 'recipeData';
    recipe: IRecipeCockpitRecipeViewModel;
    renderSequence: number;
    focusTree?: IRecipeCockpitTreeFocus;
}

export interface IRecipeCockpitTreeFocus {
    treeKey: string;
    tab: RecipeCockpitTreeTab;
}

export interface IRecipeCockpitLoadFailedMessage {
    command: 'loadFailed';
    message: string;
}

/*
    One field the comparison found DIFFERENT, as the panel draws it. An unchanged field is not sent:
    every recipe row of a compared object that has no entry here is unchanged, so posting one entry
    per unchanged field would grow the payload with the recipe for no information. A new-in-org
    field has no recipe row at all, and is drawn as a row of its own from this entry.
*/
export interface IRecipeCockpitFieldDiffViewModel {
    fieldApiName: string;
    status: MetadataDiffFieldStatus;
    recipeFieldType: string;
    orgFieldType: string;
    addedPicklistValues: string[];
    removedPicklistValues: string[];
}

/*
    One COMPARED object. An object whose describe failed or was cancelled is absent -- the diff
    engine reads the org side as what the org HAS, so passing it would report every one of its
    fields removed -- and the panel draws the absence as "not compared", never as a status.
*/
export interface IRecipeCockpitObjectDiffViewModel {
    objectApiName: string;
    changedFields: IRecipeCockpitFieldDiffViewModel[];
    statusCounts: Record<MetadataDiffFieldStatus, number>;
    uncreateableOrgOnlyFieldCount: number;
}

export interface IRecipeCockpitDiffViewModel {
    objects: IRecipeCockpitObjectDiffViewModel[];
    statusCounts: Record<MetadataDiffFieldStatus, number>;
}

export interface IRecipeCockpitOrgDescribeObjectSummary {
    objectApiName: string;
    isDescribed: boolean;
    describedFieldCount: number;
    failureMessage: string;
}

/*
    What one org comparison said about the recipe on screen: a per-object describe SUMMARY and the
    diff computed host side. The normalized describe stays in the host's cache -- the panel draws
    statuses, not describes. renderSequence ties it to the model it compared -- a comparison of an
    earlier run's objects must not be drawn over a later run's rows.
*/
export interface IRecipeCockpitOrgDescribeMessage {
    command: 'orgDescribe';
    orgLabel: string;
    summary: string;
    isFailure: boolean;
    isCancelled: boolean;
    objects: IRecipeCockpitOrgDescribeObjectSummary[];
    diff: IRecipeCockpitDiffViewModel;
    renderSequence: number;
}

// WHERE A COMPARISON IS WHILE IT RUNS, DRAWN IN THE PANEL AS WELL AS IN THE NOTIFICATION
export interface IRecipeCockpitOrgProgressMessage {
    command: 'orgProgress';
    message: string;
    renderSequence: number;
}

// ONE PICKLIST ROW'S VALUES, ANSWERING THE PANEL'S loadPicklistValues FOR THE MODEL renderSequence NAMES
export interface IRecipeCockpitPicklistValuesMessage extends IRecipeCockpitPicklistDisplayValues {
    command: 'picklistValues';
    objectApiName: string;
    fieldApiName: string;
    renderSequence: number;
}

// ONE TREE'S PREVIOUS VERSIONS, SUMMARIZED FROM EACH RUN'S WRAPPER WHEN THE TAB WAS FIRST OPENED
export interface IRecipeCockpitVersionSummariesMessage {
    command: 'versionSummaries';
    treeKey: string;
    summaries: IRecipeCockpitTreeVersionSummary[];
    renderSequence: number;
}

// A LEGACY DATA SET'S RECORD COUNTS, READ FROM ITS COLLECTIONS API FILES WHEN IT WAS EXPANDED
export interface IRecipeCockpitDatasetRecordCountsMessage {
    command: 'datasetRecordCounts';
    datasetFolderName: string;
    recordCounts: IRecipeCockpitDatasetRecordCountViewModel[];
    failureMessage: string;
    renderSequence: number;
}

/*
    Whether a Run Faker started from this panel is still running. Every Run Faker button is disabled
    while it is, and the message is replayed on a reveal so a reloaded document does not offer a
    second run the host would refuse.
*/
export interface IRecipeCockpitRunFakerStateMessage {
    command: 'runFakerState';
    isRunning: boolean;
    treeKey: string;
}

/*
    The authorized orgs the Data-by-Org dropdown offers, as LABELS only: the panel posts back the
    index of the one chosen, and the host looks the username up in the list it holds. A name the
    panel posted would be an org of its choosing; an index can only be one the host offered.
*/
export interface IRecipeCockpitDataOrgListMessage {
    command: 'dataOrgList';
    orgLabels: string[];
    selectedOrgIndex: number | null;
    noOrgsMessage: string;
    renderSequence: number;
}

/*
    The org Data-by-Org is counting in. orgTypeLabel is '' while the Organization query is still
    out; isSandbox is null until it answers, and stays null when it failed. requestSequence names
    the selection, so an answer for an org the reader has since replaced is dropped.
*/
export interface IRecipeCockpitDataOrgSelectionMessage {
    command: 'dataOrgSelection';
    orgIndex: number;
    orgLabel: string;
    orgTypeLabel: string;
    isSandbox: boolean | null;
    requestSequence: number;
    renderSequence: number;
}

export interface IRecipeCockpitDataOrgCountViewModel {
    objectApiName: string;
    status: OrgRecordCountStatus;
    recordCount: number;
    failureMessage: string;
}

/*
    Counts as they arrive, CUMULATIVE per selection: each message carries only the objects counted
    since the last, and the panel merges them. A failed connection is one connectionFailureMessage
    for the whole org, never one failure per object.
*/
export interface IRecipeCockpitDataOrgCountsMessage {
    command: 'dataOrgCounts';
    counts: IRecipeCockpitDataOrgCountViewModel[];
    completedCount: number;
    requestedCount: number;
    isComplete: boolean;
    connectionFailureMessage: string;
    requestSequence: number;
    renderSequence: number;
}

export type RecipeCockpitHostMessage = IRecipeCockpitLoadPhaseMessage
                                        | IRecipeCockpitRecipeDataMessage
                                        | IRecipeCockpitLoadFailedMessage
                                        | IRecipeCockpitOrgDescribeMessage
                                        | IRecipeCockpitOrgProgressMessage
                                        | IRecipeCockpitPicklistValuesMessage
                                        | IRecipeCockpitVersionSummariesMessage
                                        | IRecipeCockpitDatasetRecordCountsMessage
                                        | IRecipeCockpitRunFakerStateMessage
                                        | IRecipeCockpitDataOrgListMessage
                                        | IRecipeCockpitDataOrgSelectionMessage
                                        | IRecipeCockpitDataOrgCountsMessage;

// THE SLICE OF vscode.Memento THE COCKPIT USES, SO A TEST CAN HAND IN A MAP
export interface IRecipeCockpitWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export const RECIPE_COCKPIT_DATA_ORG_STATE_KEY = 'treecipe.recipeCockpit.dataByOrgUsername';

// HOW MANY COUNTS ARE POSTED TOGETHER WHILE A SELECTION IS COUNTING -- ONE POST PER OBJECT WOULD BE ONE RENDER PER OBJECT
export const RECIPE_COCKPIT_DATA_ORG_COUNT_POST_BATCH = 10;

/*
    Host-only: the org Data-by-Org has selected. orgDetail carries the USERNAME, which the panel is
    never told and never posts.
*/
export interface IRecipeCockpitDataOrgSelection {
    orgIndex: number;
    orgDetail: IAuthenticatedOrgDetail;
    requestSequence: number;
    orgTypeDetail?: IOrgTypeDetail;
}

/*
    The loader's whole answer: what is posted, the picklist values that stay on the host for the
    diff, and the picklist values the panel asks for one row at a time.
*/
export interface IRecipeCockpitLoadedRecipe {
    recipeViewModel: IRecipeCockpitRecipeViewModel;
    recipePicklistValuesByObjectApiName: Map<string, Map<string, string[]>>;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
}

/*
    The allow-lists of the history tabs, one per action, each a set of NAMES drawn from the
    rendered model's tree histories. Summaries are keyed by tree, diffs by tree and run, and the
    three data set actions by data set folder name.
*/
export interface IRecipeCockpitTreeHistoryAllowLists {
    summaryTreeKeys: Set<string>;
    diffKeys: Set<string>;
    openableDatasetFolderNames: Set<string>;
    insertableDatasetFolderNames: Set<string>;
    countableDatasetFolderNames: Set<string>;
    runnableTreeKeys: Set<string>;
}

/*
    What the host should DO about a panel message -- the router's answer, kept as data so the
    decision is asserted without a live webview and the side effects live in one executor.
*/
export type RecipeCockpitPanelAction =
    { kind: 'replay'; hostMessages: RecipeCockpitHostMessage[] }
    | { kind: 'activateActions' }
    | { kind: 'reportRenderFailure'; failureDescription: string; failureStack: string; invalidatesPanel: boolean }
    | { kind: 'openSource'; filePath: string; lineNumber: number }
    | { kind: 'selectRun'; runFolderName: string }
    | { kind: 'selectOrg' }
    | { kind: 'regenerateRecipe' }
    | { kind: 'postPicklistValues'; hostMessage: IRecipeCockpitPicklistValuesMessage }
    | { kind: 'loadVersionSummaries'; treeKey: string; summarySource: IRecipeCockpitTreeSummarySource; renderSequence: number }
    | { kind: 'loadDatasetRecordCounts'; datasetFolderName: string; datasetFolderPath: string; renderSequence: number }
    | { kind: 'diffTreeVersion'; versionRecipeFilePath: string; currentRecipeFilePath: string; diffTitle: string }
    | { kind: 'openDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'insertDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'runFaker'; treeKey: string; recipeFilePath: string }
    | { kind: 'postRunFakerState'; hostMessage: IRecipeCockpitRunFakerStateMessage }
    | { kind: 'loadDataOrgs' }
    | { kind: 'selectDataOrg'; orgIndex: number }
    | { kind: 'refreshDataOrgCounts' };

/*
    Everything the host holds for the one panel, replaced wholesale when the panel is (re)opened.

    Two generations of allow-list: the PENDING pair is built when a model is posted, and only the
    panel's "rendered" acknowledgement promotes it to ACTIVE. A post succeeding says the message
    left the host, not that anything is on screen -- and every reload of the document (each reveal
    of a hidden tab) empties the active pair until the replayed model is drawn again. An action is
    honoured only when the panel has confirmed the row it came from is actually drawn.

    The describable objects are an allow-list of the same kind with no payload to match: the panel
    only asks for "an org describe", and WHICH objects are described is read from here, never from
    the message. isOrgDescribeInFlight refuses a second request while the first is still picking
    or describing, so two quick picks cannot race to post two answers.

    recipePicklistValuesByObjectApiName belongs to recipeDataMessage and is replaced with it: it is
    the diff's recipe side for picklists, and it is never posted. picklistDisplayValuesByObjectApiName
    is replaced with it too, and is posted one row at a time, only for a row the rendered model
    marked as a picklist (the loadable picklist keys, another pending/active pair).
*/
export interface IRecipeCockpitPanelState {
    workspaceRoot: string;
    isPanelReady: boolean;
    loadPhaseMessage: string;
    recipeDataMessage?: IRecipeCockpitRecipeDataMessage;
    recipePicklistValuesByObjectApiName: Map<string, Map<string, string[]>>;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    loadFailedMessage?: IRecipeCockpitLoadFailedMessage;
    orgDescribeMessage?: IRecipeCockpitOrgDescribeMessage;
    orgProgressMessage?: IRecipeCockpitOrgProgressMessage;
    pendingOpenableSourceKeys: Set<string>;
    pendingSelectableRunFolderNames: Set<string>;
    pendingDescribableObjectApiNames: Set<string>;
    pendingLoadablePicklistKeys: Set<string>;
    openableSourceKeys: Set<string>;
    selectableRunFolderNames: Set<string>;
    describableObjectApiNames: Set<string>;
    loadablePicklistKeys: Set<string>;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    pendingTreeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    isOrgDescribeInFlight: boolean;
    isRegenerateInFlight: boolean;
    runFakerStateMessage?: IRecipeCockpitRunFakerStateMessage;
    reportedFailureDescriptions: Set<string>;
    pendingDataOrgObjectApiNames: Set<string>;
    dataOrgObjectApiNames: Set<string>;
    dataOrgDetails: IAuthenticatedOrgDetail[];
    dataOrgUsername?: string;
    dataOrgSelection?: IRecipeCockpitDataOrgSelection;
    dataOrgRequestSequence: number;
}

/*
    One run's wrapper, reduced to what a Previous Versions row needs: the fields per object, and
    per tree folder when the wrapper lists its trees. Cached per run for the panel's model, since
    every tree of a run is summarized from the same wrapper.
*/
export interface IRecipeCockpitRunFieldCounts {
    fieldCountsByObjectApiName: Map<string, number>;
    fieldCountsByTreeFolderName: Map<string, number>;
    hasTreeData: boolean;
}

export class RecipeCockpitService {

    /*
        One cockpit for the whole window, reused across invocations.

        Creating a panel per run stacks a duplicate tab each time, and every one of them holds its
        own document alive. The reference is cleared in onDidDispose so a closed panel is not
        revealed after the fact.
    */
    private static recipeCockpitPanel: vscode.WebviewPanel | undefined;

    /*
        The message listener registered for the panel, disposed before it is replaced and again
        when the panel closes, so a reopened cockpit never has two listeners answering one "ready".
    */
    private static recipeCockpitMessageSubscription: vscode.Disposable | undefined;

    private static recipeCockpitPanelState: IRecipeCockpitPanelState = RecipeCockpitService.buildInitialPanelState('');

    /*
        Which load is the current one. A run chosen while another is still loading supersedes it,
        and the superseded load must not render over the one the reader asked for last.
    */
    private static recipeCockpitLoadSequence = 0;

    private static recipeCockpitRenderSequence = 0;

    /*
        Where Data-by-Org remembers the org it last counted in, per workspace. Set by the command
        that opens the panel; a cockpit opened without one simply remembers nothing.
    */
    private static recipeCockpitWorkspaceState: IRecipeCockpitWorkspaceState | undefined;

    static buildEmptyTreeHistoryAllowLists(): IRecipeCockpitTreeHistoryAllowLists {

        return {
            summaryTreeKeys: new Set(),
            diffKeys: new Set(),
            openableDatasetFolderNames: new Set(),
            insertableDatasetFolderNames: new Set(),
            countableDatasetFolderNames: new Set(),
            runnableTreeKeys: new Set()
        };

    }

    // EVERY HISTORY ACTION THE RENDERED MODEL OFFERS, BY NAME, AND NOTHING ELSE
    static collectTreeHistoryAllowLists(recipeViewModel: IRecipeCockpitRecipeViewModel): IRecipeCockpitTreeHistoryAllowLists {

        const treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();

        recipeViewModel.trees.forEach(tree => {

            if ( tree.runFakerRecipeFileName ) {
                treeHistoryAllowLists.runnableTreeKeys.add(tree.treeKey);
            }

            if ( !tree.history ) {
                return;
            }

            treeHistoryAllowLists.summaryTreeKeys.add(tree.treeKey);

            tree.history.versions
                .filter(version => version.isDiffable)
                .forEach(version => treeHistoryAllowLists.diffKeys.add(RecipeCockpitTreeHistory.buildDiffKey(tree.treeKey, version.runFolderName)));

            tree.history.datasets.forEach(dataset => {
                treeHistoryAllowLists.openableDatasetFolderNames.add(dataset.datasetFolderName);
                treeHistoryAllowLists.insertableDatasetFolderNames.add(dataset.datasetFolderName);
                if ( dataset.recordCounts === null ) {
                    treeHistoryAllowLists.countableDatasetFolderNames.add(dataset.datasetFolderName);
                }
            });

        });

        return treeHistoryAllowLists;

    }

    static buildInitialPanelState(workspaceRoot: string): IRecipeCockpitPanelState {

        return {
            workspaceRoot: workspaceRoot,
            isPanelReady: false,
            loadPhaseMessage: '',
            recipePicklistValuesByObjectApiName: new Map(),
            picklistDisplayValuesByObjectApiName: new Map(),
            pendingOpenableSourceKeys: new Set(),
            pendingSelectableRunFolderNames: new Set(),
            pendingDescribableObjectApiNames: new Set(),
            pendingLoadablePicklistKeys: new Set(),
            openableSourceKeys: new Set(),
            selectableRunFolderNames: new Set(),
            describableObjectApiNames: new Set(),
            loadablePicklistKeys: new Set(),
            treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets(),
            pendingTreeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
            treeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
            isOrgDescribeInFlight: false,
            isRegenerateInFlight: false,
            reportedFailureDescriptions: new Set(),
            pendingDataOrgObjectApiNames: new Set(),
            dataOrgObjectApiNames: new Set(),
            dataOrgDetails: [],
            dataOrgRequestSequence: 0
        };

    }

    /*
        Opens the cockpit (or reveals the one this window already has) and loads the latest run.

        The shell is shown BEFORE any of the load, so the load has somewhere to report its phases.
        Re-running the command resets the panel: the previous model is no longer necessarily what
        the workspace holds, and leaving it on screen under a fresh load's status line would show
        one run while reporting another's progress.
    */
    static async openRecipeCockpitPanel(workspaceRoot: string, workspaceState?: IRecipeCockpitWorkspaceState): Promise<vscode.WebviewPanel> {

        const existingCockpitPanel = this.recipeCockpitPanel;
        this.recipeCockpitWorkspaceState = workspaceState;

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
        this.recipeCockpitPanelState = this.buildInitialPanelState(workspaceRoot);

        if ( !existingCockpitPanel ) {

            cockpitPanel.onDidDispose(() => {
                this.recipeCockpitMessageSubscription?.dispose();
                this.recipeCockpitMessageSubscription = undefined;
                this.recipeCockpitPanel = undefined;
                this.recipeCockpitPanelState = this.buildInitialPanelState('');
            });

        }

        // A FRESH NONCE PER LOAD -- ONE REUSED ACROSS LOADS WOULD OUTLIVE THE ONE DOCUMENT IT AUTHORIZES
        cockpitPanel.webview.html = this.buildWebviewShellHtml(this.buildNonce());

        this.registerPanelMessageSubscription(cockpitPanel);

        cockpitPanel.reveal(vscode.ViewColumn.One);

        await this.loadRecipeIntoPanel(cockpitPanel, workspaceRoot);

        return cockpitPanel;

    }

    /*
        Walks the phases of one load and renders its result.

        Rethrows after putting the failure in the panel: the command that opened the panel owns the
        error report for the first load, and the run selector's handler owns it for the rest.
    */
    private static async loadRecipeIntoPanel(cockpitPanel: vscode.WebviewPanel,
                                                workspaceRoot: string,
                                                requestedRunFolderName?: string,
                                                focusTree?: IRecipeCockpitTreeFocus): Promise<void> {

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
            const recipeRuns = this.findGeneratedRecipeRuns(generatedRecipesFolderPath);

            if ( !isCurrentLoad() ) {
                return;
            }

            await this.reportLoadPhase(cockpitPanel, loadStatusItem, RECIPE_COCKPIT_LOAD_PHASES.readingRun);

            const loadedRecipe = this.loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName);

            if ( !isCurrentLoad() ) {
                return;
            }

            this.renderRecipeModel(cockpitPanel, loadedRecipe, focusTree);

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
        Every host message is STORED and posted only once the panel has said it is listening. A
        webview that has not finished loading drops what is posted to it, and posting eagerly AND
        replaying on the handshake would render the whole model twice.
    */
    private static postToPanel(cockpitPanel: vscode.WebviewPanel, hostMessage: RecipeCockpitHostMessage) {

        if ( this.recipeCockpitPanel !== cockpitPanel ) {
            return;
        }

        if ( !this.recipeCockpitPanelState.isPanelReady ) {
            return;
        }

        cockpitPanel.webview.postMessage(hostMessage);

    }

    private static renderRecipeModel(cockpitPanel: vscode.WebviewPanel, loadedRecipe: IRecipeCockpitLoadedRecipe, focusTree?: IRecipeCockpitTreeFocus) {

        const panelState = this.recipeCockpitPanelState;
        const recipeViewModel = loadedRecipe.recipeViewModel;
        const recipeDataMessage: IRecipeCockpitRecipeDataMessage = {
            command: 'recipeData',
            recipe: recipeViewModel,
            renderSequence: ++this.recipeCockpitRenderSequence
        };
        const isFocusOnScreen = !!focusTree && recipeViewModel.trees.some(tree => tree.treeKey === focusTree.treeKey);

        panelState.recipeDataMessage = recipeDataMessage;
        panelState.recipePicklistValuesByObjectApiName = loadedRecipe.recipePicklistValuesByObjectApiName;
        panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
        panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
        panelState.loadFailedMessage = undefined;
        // A COMPARISON ANSWERED FOR THE PREVIOUS MODEL'S OBJECTS, WHICH ARE NOT NECESSARILY THIS ONE'S
        panelState.orgDescribeMessage = undefined;
        panelState.orgProgressMessage = undefined;
        panelState.loadPhaseMessage = '';
        panelState.reportedFailureDescriptions = new Set();
        panelState.pendingOpenableSourceKeys = new Set(this.collectOpenableSourceKeys(recipeViewModel));
        panelState.pendingSelectableRunFolderNames = new Set(recipeViewModel.runs.map(run => run.runFolderName));
        panelState.pendingDescribableObjectApiNames = new Set(recipeViewModel.objects.map(objectViewModel => objectViewModel.objectApiName));
        panelState.pendingLoadablePicklistKeys = new Set(this.collectLoadablePicklistKeys(recipeViewModel));
        panelState.pendingTreeHistoryAllowLists = this.collectTreeHistoryAllowLists(recipeViewModel);
        panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        // THE SAME REASON AS THE DESCRIBABLE SET: AN ANSWER IS TAGGED WITH THE CURRENT renderSequence, SO THE OLD MODEL'S KEYS MUST NOT ANSWER FOR IT
        panelState.loadablePicklistKeys = new Set();
        /*
            Emptied rather than left on the previous model until the new one's "rendered": a describe
            reads its objects from here but tags its answer with the CURRENT model's renderSequence,
            so a click landing between this post and the ack would describe the old run's objects
            and draw the answer over the new run's rows.
        */
        panelState.describableObjectApiNames = new Set();
        /*
            The same for Data-by-Org: its counts are tagged with the model they count, so a new
            model ends whatever selection was counting for the old one. The org list and the org
            chosen survive it -- the panel asks again once the new model is drawn.
        */
        panelState.pendingDataOrgObjectApiNames = new Set(this.collectDataOrgObjectApiNames(recipeViewModel));
        panelState.dataOrgObjectApiNames = new Set();
        panelState.dataOrgSelection = undefined;
        panelState.dataOrgRequestSequence++;

        /*
            The focus rides on the POSTED copy only. The stored message is what every reveal replays,
            and a focus replayed on each one would re-open a card the reader has since closed.
        */
        this.postToPanel(cockpitPanel, isFocusOnScreen ? { ...recipeDataMessage, focusTree: focusTree } : recipeDataMessage);

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

            try {
                await this.executePanelAction(cockpitPanel, panelAction);
            } catch (actionError) {
                ErrorHandlingService.handleCapturedError(actionError, 'openRecipeCockpit');
            }

        });

    }

    private static async executePanelAction(cockpitPanel: vscode.WebviewPanel, panelAction: RecipeCockpitPanelAction) {

        const panelState = this.recipeCockpitPanelState;

        switch ( panelAction.kind ) {

            case 'replay':

                /*
                    The document was (re)loaded, so nothing is on screen until the replayed model is
                    drawn again -- which is also why the active allow-lists empty here.
                */
                panelState.isPanelReady = true;
                panelState.openableSourceKeys = new Set();
                panelState.selectableRunFolderNames = new Set();
                panelState.describableObjectApiNames = new Set();
                panelState.loadablePicklistKeys = new Set();
                panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                // A RELOADED DOCUMENT HAS NO DROPDOWN TO DRAW A SELECTION IN, SO ONE STILL COUNTING IS ENDED
                panelState.dataOrgObjectApiNames = new Set();
                panelState.dataOrgSelection = undefined;
                panelState.dataOrgRequestSequence++;
                panelAction.hostMessages.forEach(hostMessage => cockpitPanel.webview.postMessage(hostMessage));
                return;

            case 'activateActions':

                panelState.openableSourceKeys = panelState.pendingOpenableSourceKeys;
                panelState.selectableRunFolderNames = panelState.pendingSelectableRunFolderNames;
                panelState.describableObjectApiNames = panelState.pendingDescribableObjectApiNames;
                panelState.loadablePicklistKeys = panelState.pendingLoadablePicklistKeys;
                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                panelState.dataOrgObjectApiNames = panelState.pendingDataOrgObjectApiNames;
                return;

            case 'reportRenderFailure': {

                panelState.reportedFailureDescriptions.add(panelAction.failureDescription);

                // ONLY A FAILURE TO DRAW EMPTIES THE ALLOW-LISTS -- A THROW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN
                if ( panelAction.invalidatesPanel ) {
                    panelState.openableSourceKeys = new Set();
                    panelState.selectableRunFolderNames = new Set();
                    panelState.describableObjectApiNames = new Set();
                    panelState.loadablePicklistKeys = new Set();
                    panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                    panelState.dataOrgObjectApiNames = new Set();
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

            case 'selectRun':

                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelAction.runFolderName);
                return;

            case 'selectOrg':

                await this.describeRecipeObjectsInSelectedOrg(cockpitPanel, panelState);
                return;

            case 'regenerateRecipe':

                await this.regenerateRecipe(cockpitPanel, panelState);
                return;

            case 'postPicklistValues':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'loadVersionSummaries':

                await this.postVersionSummaries(cockpitPanel, panelState, panelAction.treeKey, panelAction.summarySource, panelAction.renderSequence);
                return;

            case 'loadDatasetRecordCounts':

                this.postDatasetRecordCounts(cockpitPanel, panelState, panelAction.datasetFolderName, panelAction.datasetFolderPath, panelAction.renderSequence);
                return;

            case 'diffTreeVersion': {

                const unusableRecipeFilePath = [panelAction.versionRecipeFilePath, panelAction.currentRecipeFilePath]
                    .find(recipeFilePath => !this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot));

                if ( unusableRecipeFilePath !== undefined ) {
                    VSCodeWorkspaceService.showWarningMessage(`The recipe file "${RecipeYamlScalar.escapeForNotification(path.basename(unusableRecipeFilePath))}" no longer exists in this workspace, so the versions were not compared. Re-open the Recipe Cockpit to load the runs currently on disk.`);
                    return;
                }

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    vscode.Uri.file(panelAction.versionRecipeFilePath),
                    vscode.Uri.file(panelAction.currentRecipeFilePath),
                    panelAction.diffTitle
                );
                return;

            }

            case 'openDataset':
            case 'insertDataset': {

                if ( !this.isUsableWorkspacePath(panelAction.datasetFolderPath, panelState.workspaceRoot) ) {
                    await this.refreshAfterMissingDataset(cockpitPanel, panelState, panelAction.datasetFolderName, panelAction.focusTree);
                    return;
                }

                if ( panelAction.kind === 'openDataset' ) {
                    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(panelAction.datasetFolderPath));
                    return;
                }

                await vscode.commands.executeCommand(RECIPE_COCKPIT_INSERT_DATASET_COMMAND, panelAction.datasetFolderPath);
                return;

            }

            case 'runFaker':

                await this.runFakerForTree(cockpitPanel, panelState, panelAction.treeKey, panelAction.recipeFilePath);
                return;

            case 'postRunFakerState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'loadDataOrgs':

                await this.loadDataOrgs(cockpitPanel, panelState);
                return;

            case 'selectDataOrg':

                await this.selectDataOrg(cockpitPanel, panelState, panelAction.orgIndex);
                return;

            case 'refreshDataOrgCounts':

                SalesforceOrgService.clearRecordCountCache(panelState.dataOrgSelection.orgDetail.username);
                await this.selectDataOrg(cockpitPanel, panelState, panelState.dataOrgSelection.orgIndex);
                return;

        }

    }

    /*
        Runs one tree's recipe through Run Faker by Recipe, then reloads the run on screen with the
        card on its Previous Fake Sets tab, so the data set it wrote is listed there.

        The reload happens however the command ends -- written, failed, refused or cancelled at its
        modal -- because the panel disabled every Run Faker button on the click, and a run that left
        them disabled would leave a card that can never be run again. The state message is posted
        once more after the reload, for a reload that could not render a model to re-enable them.

        A recipe file gone since the model was drawn is said so here and nothing runs; the command
        checks again on its own, since it is callable by id.
    */
    private static async runFakerForTree(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            treeKey: string,
                                            recipeFilePath: string) {

        const isPanelStillCurrent = () => this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState;

        panelState.runFakerStateMessage = { command: 'runFakerState', isRunning: true, treeKey: treeKey };
        this.postToPanel(cockpitPanel, panelState.runFakerStateMessage);

        let hasRunFailed = false;
        let runError: unknown;

        try {

            if ( this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
                try {
                    await vscode.commands.executeCommand(RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath);
                } catch (commandError) {
                    hasRunFailed = true;
                    runError = commandError;
                }
            } else {
                VSCodeWorkspaceService.showWarningMessage(`The recipe file "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}" no longer exists in this workspace, so Run Faker did not run. The Recipe Cockpit has reloaded the run.`);
            }

            // THE RUN ON SCREEN NOW, NOT AT THE CLICK -- THE READER CAN SWITCH RUNS WHILE GENERATION RUNS
            if ( isPanelStillCurrent() ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelState.recipeDataMessage.recipe.selectedRunFolderName, { treeKey: treeKey, tab: 'datasets' });
            }

        } finally {

            panelState.runFakerStateMessage = undefined;

            if ( isPanelStillCurrent() ) {
                this.postToPanel(cockpitPanel, { command: 'runFakerState', isRunning: false, treeKey: treeKey });
            }

        }

        if ( hasRunFailed ) {
            throw runError;
        }

    }

    /*
        Whether a path the model named can still be used: inside the workspace once symlinks are
        resolved -- the allow-list says the model named it, not where it resolves NOW -- and still
        on disk.
    */
    private static isUsableWorkspacePath(candidatePath: string, workspaceRoot: string): boolean {

        return fs.existsSync(candidatePath)
                && SfdxProjectService.isPathContainedInWorkspace(path.resolve(candidatePath), path.resolve(workspaceRoot));

    }

    /*
        A data set deleted (or moved out of the workspace) after the model was drawn. The reader is
        told, and the run on screen is reloaded, so the history it shows is what is on disk -- with
        the card and tab they acted from re-opened.
    */
    private static async refreshAfterMissingDataset(cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        datasetFolderName: string,
                                                        focusTree?: IRecipeCockpitTreeFocus) {

        VSCodeWorkspaceService.showWarningMessage(`The data set "${RecipeYamlScalar.escapeForNotification(datasetFolderName)}" no longer exists in this workspace. The Recipe Cockpit has reloaded its data sets.`);

        // ONLY A RENDERED MODEL'S HISTORY OFFERS A DATA SET, SO THERE IS ALWAYS A RUN ON SCREEN TO RELOAD
        const selectedRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;

        if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState ) {
            await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, selectedRunFolderName, focusTree);
        }

    }

    /*
        Each run's summary, posted as it is known. A wrapper can be hundreds of megabytes and a tree
        can have many runs, so the runs already in the field-count cache (the current one always is
        -- the load put it there) are posted at once, and every other wrapper is read after a yield
        and posted on its own: the extension host is never held for more than one wrapper, and the
        rows fill in as they are read. Each post is cumulative and names only the runs it knows, so
        a row still loading is never drawn as "unavailable". A reader who moved to another model
        stops the walk, since its answer would be drawn over nothing.
    */
    private static async postVersionSummaries(cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                treeKey: string,
                                                summarySource: IRecipeCockpitTreeSummarySource,
                                                renderSequence: number) {

        const fieldCountsByRunFolderName = new Map<string, number | undefined>();
        const isModelStillOnScreen = () => this.recipeCockpitPanel === cockpitPanel
                                            && this.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage.renderSequence === renderSequence;

        const readTreeFieldCountOfRun = (summaryRun: IRecipeCockpitTreeSummarySource['runs'][number]) => fieldCountsByRunFolderName.set(
            summaryRun.runFolderName,
            this.readTreeFieldCount(this.readRunFieldCounts(summaryRun.objectsWrapperFilePath, panelState.workspaceRoot), summarySource.treeFolderName, summaryRun.treeFolderPath, panelState.workspaceRoot)
        );

        const postKnownSummaries = () => this.postToPanel(cockpitPanel, {
            command: 'versionSummaries',
            treeKey: treeKey,
            summaries: RecipeCockpitTreeHistory.buildVersionSummaries(summarySource, fieldCountsByRunFolderName)
                .filter(versionSummary => fieldCountsByRunFolderName.has(versionSummary.runFolderName)),
            renderSequence: renderSequence
        });

        const uncachedRuns = summarySource.runs.filter(summaryRun => !this.isRunFieldCountCached(summaryRun.objectsWrapperFilePath));

        summarySource.runs.filter(summaryRun => !uncachedRuns.includes(summaryRun)).forEach(readTreeFieldCountOfRun);

        if ( fieldCountsByRunFolderName.size > 0 ) {
            postKnownSummaries();
        }

        for ( const summaryRun of uncachedRuns ) {

            await this.yieldToExtensionHost();

            if ( !isModelStillOnScreen() ) {
                return;
            }

            readTreeFieldCountOfRun(summaryRun);
            postKnownSummaries();

        }

    }

    private static postDatasetRecordCounts(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            datasetFolderName: string,
                                            datasetFolderPath: string,
                                            renderSequence: number) {

        const isUsable = this.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot);
        // THE SUBFOLDER IS READ TOO, AND A SYMLINK THERE WOULD READ FILES OUTSIDE THE WORKSPACE THE FOLDER'S OWN CHECK APPROVED
        const collectionsApiFolderPath = path.join(datasetFolderPath, DATASET_COLLECTIONS_API_FOLDER_NAME);
        const isCollectionsApiFolderContained = !fs.existsSync(collectionsApiFolderPath)
                                                || this.isUsableWorkspacePath(collectionsApiFolderPath, panelState.workspaceRoot);
        const legacyRecordCounts = isUsable && isCollectionsApiFolderContained
            ? DatasetSourceService.countLegacyRecordsByObject(datasetFolderPath)
            : { recordCountsByObject: Object.create(null), unreadableFileNames: [] };

        const failureMessage = !isUsable
            ? 'This data set is no longer in the workspace.'
            : !isCollectionsApiFolderContained
                ? 'This data set\'s Collections API folder resolves outside the workspace, so its records were not counted.'
            : legacyRecordCounts.unreadableFileNames.length > 0
                ? `Could not count the records in ${legacyRecordCounts.unreadableFileNames.join(', ')}.`
                : '';

        this.postToPanel(cockpitPanel, {
            command: 'datasetRecordCounts',
            datasetFolderName: datasetFolderName,
            recordCounts: RecipeCockpitTreeHistory.toRecordCountViewModels(legacyRecordCounts.recordCountsByObject),
            failureMessage: failureMessage,
            renderSequence: renderSequence
        });

    }

    /*
        What each wrapper's field counts were, keyed by the wrapper's resolved path and valid only
        while its size and modification time are unchanged. It outlives a model on purpose: a run
        is never rewritten once Generate Treecipe has moved on, so a reload, a run switch or a
        regeneration re-reads only the wrapper that actually changed. An entry is a few numbers per
        object, not the wrapper. An unreadable wrapper is cached as undefined for the same reason a
        readable one is cached -- re-parsing a 370 MB file to fail again is the cost being avoided.
    */
    private static runFieldCountCache = new Map<string, { modifiedAtMs: number; sizeInBytes: number; runFieldCounts: IRecipeCockpitRunFieldCounts | undefined }>();

    private static readWrapperFileStamp(objectsWrapperFilePath: string): { modifiedAtMs: number; sizeInBytes: number } | undefined {

        try {
            const wrapperFileStat = fs.statSync(objectsWrapperFilePath);
            return { modifiedAtMs: wrapperFileStat.mtimeMs, sizeInBytes: wrapperFileStat.size };
        } catch {
            return undefined;
        }

    }

    static isRunFieldCountCached(objectsWrapperFilePath: string): boolean {

        const cachedEntry = objectsWrapperFilePath ? this.runFieldCountCache.get(path.resolve(objectsWrapperFilePath)) : undefined;
        const wrapperFileStamp = cachedEntry ? this.readWrapperFileStamp(objectsWrapperFilePath) : undefined;

        return !!wrapperFileStamp
                && wrapperFileStamp.modifiedAtMs === cachedEntry.modifiedAtMs
                && wrapperFileStamp.sizeInBytes === cachedEntry.sizeInBytes;

    }

    // THE LOAD HAS ALREADY PARSED THE RUN ON SCREEN, SO ITS COUNTS ARE KEPT RATHER THAN READ AGAIN WHEN A VERSIONS TAB OPENS
    static cacheRunFieldCounts(objectsWrapperFilePath: string, normalizedObjectsWrapper: IRecipeCockpitNormalizedObjectsWrapper) {

        const wrapperFileStamp = this.readWrapperFileStamp(objectsWrapperFilePath);

        if ( wrapperFileStamp ) {
            this.runFieldCountCache.set(path.resolve(objectsWrapperFilePath), { ...wrapperFileStamp, runFieldCounts: this.buildRunFieldCounts(normalizedObjectsWrapper) });
        }

    }

    /*
        One run's wrapper as field counts, or undefined when it cannot be read -- which the row
        draws as "summary unavailable", still diffable. The path was contained when the model was
        built and is checked again here, since a wrapper is only opened now.
    */
    static readRunFieldCounts(objectsWrapperFilePath: string, workspaceRoot: string): IRecipeCockpitRunFieldCounts | undefined {

        if ( !objectsWrapperFilePath || !this.isUsableWorkspacePath(objectsWrapperFilePath, workspaceRoot) ) {
            return undefined;
        }

        if ( this.isRunFieldCountCached(objectsWrapperFilePath) ) {
            return this.runFieldCountCache.get(path.resolve(objectsWrapperFilePath)).runFieldCounts;
        }

        const wrapperFileStamp = this.readWrapperFileStamp(objectsWrapperFilePath);
        let runFieldCounts: IRecipeCockpitRunFieldCounts | undefined;

        try {
            const normalizedObjectsWrapper = this.normalizeObjectsWrapper(JSON.parse(fs.readFileSync(objectsWrapperFilePath, 'utf-8')));
            runFieldCounts = normalizedObjectsWrapper.isObjectsWrapper ? this.buildRunFieldCounts(normalizedObjectsWrapper) : undefined;
        } catch {
            runFieldCounts = undefined;
        }

        if ( wrapperFileStamp ) {
            this.runFieldCountCache.set(path.resolve(objectsWrapperFilePath), { ...wrapperFileStamp, runFieldCounts: runFieldCounts });
        }

        return runFieldCounts;

    }

    static buildRunFieldCounts(normalizedObjectsWrapper: IRecipeCockpitNormalizedObjectsWrapper): IRecipeCockpitRunFieldCounts {

        const fieldCountsByObjectApiName = new Map(normalizedObjectsWrapper.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel.fields.length]));
        const fieldCountsByTreeFolderName = new Map<string, number>();

        normalizedObjectsWrapper.recipeTrees.forEach(recipeTree => {
            const treeFolderName = RelationshipService.buildRecipeTreeFolderName(recipeTree.objectApiNames);
            if ( !fieldCountsByTreeFolderName.has(treeFolderName) ) {
                fieldCountsByTreeFolderName.set(treeFolderName, this.sumFieldCounts(recipeTree.objectApiNames, fieldCountsByObjectApiName));
            }
        });

        return {
            fieldCountsByObjectApiName: fieldCountsByObjectApiName,
            fieldCountsByTreeFolderName: fieldCountsByTreeFolderName,
            hasTreeData: normalizedObjectsWrapper.recipeTrees.length > 0
        };

    }

    /*
        The fields the wrapper gives one tree. A wrapper with no tree data is matched through the
        tree folder's recipe file instead -- the objects it carries -- the same fallback the cards
        use. A wrapper that lists trees and not this one makes no claim about it.
    */
    static readTreeFieldCount(runFieldCounts: IRecipeCockpitRunFieldCounts | undefined,
                                treeFolderName: string,
                                treeFolderPath: string,
                                workspaceRoot: string): number | undefined {

        if ( !runFieldCounts ) {
            return undefined;
        }

        if ( runFieldCounts.hasTreeData ) {
            return runFieldCounts.fieldCountsByTreeFolderName.get(treeFolderName);
        }

        const treeRecipeFilePath = RecipeCockpitTreeHistory.findTreeRecipeFilePath(treeFolderPath);

        if ( !treeRecipeFilePath || !this.isUsableWorkspacePath(treeRecipeFilePath, workspaceRoot) ) {
            return undefined;
        }

        try {
            const recipeObjectApiNames = [...this.parseRecipeSource(fs.readFileSync(treeRecipeFilePath, 'utf-8')).keys()];
            return this.sumFieldCounts(recipeObjectApiNames, runFieldCounts.fieldCountsByObjectApiName);
        } catch {
            return undefined;
        }

    }

    private static sumFieldCounts(objectApiNames: string[], fieldCountsByObjectApiName: Map<string, number>): number {

        return [...new Set(objectApiNames)].reduce((fieldCount, objectApiName) => fieldCount + (fieldCountsByObjectApiName.get(objectApiName) ?? 0), 0);

    }

    /*
        Asks which authorized org to describe in, describes every object of the model on screen
        there, and posts what came back.

        The objects are the ones the rendered model named, captured BEFORE the quick pick: the
        reader can switch runs while the picker is open, and the describe answers for the recipe
        they asked about. Its answer is posted only if that model is still the one on screen.
        Nothing here is fatal to the panel -- no authorized org, a connection that fails and an
        object the org does not have are all told to the reader and leave the rows as they were.
    */
    private static async describeRecipeObjectsInSelectedOrg(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState) {

        const describedRecipeDataMessage = panelState.recipeDataMessage;
        const describedRecipePicklistValues = panelState.recipePicklistValuesByObjectApiName;
        const objectApiNames = [...panelState.describableObjectApiNames];

        if ( !describedRecipeDataMessage || objectApiNames.length === 0 ) {
            return;
        }

        panelState.isOrgDescribeInFlight = true;

        try {

            const selectedOrgDetail = await SalesforceOrgService.promptForAuthorizedOrg(RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER);

            if ( !selectedOrgDetail ) {
                return;
            }

            const orgLabel = this.buildOrgLabel(selectedOrgDetail);
            const objectCountText = `${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'}`;
            const reportProgress = (progressText: string) => this.reportOrgProgress(
                cockpitPanel, panelState, describedRecipeDataMessage, `Comparing with ${orgLabel}: ${progressText}`
            );
            let describeResult: IOrgDescribeRequestResult | undefined;
            let connectionFailureMessage: IRecipeCockpitOrgDescribeMessage | undefined;

            reportProgress(`describing ${objectCountText}…`);

            try {

                describeResult = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Recipe Cockpit: describing ${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'} in ${orgLabel}`,
                    cancellable: true
                }, async (progress, cancellationToken) => (
                    await SalesforceOrgService.describeObjects(
                        selectedOrgDetail.username,
                        objectApiNames,
                        // BY THE USERNAME THE CACHE IS KEYED BY -- AN ALIAS RE-POINTED SINCE THE PICK WOULD CACHE ONE ORG'S ANSWER UNDER ANOTHER
                        () => SalesforceOrgService.getConnection(selectedOrgDetail.username),
                        {
                            onObjectDescribed: (completedCount, requestedCount) => {
                                progress.report({ increment: 100 / requestedCount, message: `${completedCount} of ${requestedCount}` });
                                reportProgress(`described ${completedCount} of ${requestedCount} ${requestedCount === 1 ? 'object' : 'objects'}…`);
                            },
                            isCancellationRequested: () => cancellationToken.isCancellationRequested
                        }
                    )
                ));

            } catch (connectionError) {

                connectionFailureMessage = this.buildOrgConnectionFailureMessage(orgLabel, connectionError, describedRecipeDataMessage.renderSequence);

            }

            /*
                Compared OUTSIDE the connection's try: only a describe that failed is the org's
                failure. A throw in the comparison is this extension's, and reporting it as "could
                not connect" would send the reader to re-authorize an org that answered.
            */
            const orgDescribeMessage = connectionFailureMessage ?? this.buildOrgDescribeMessage(
                orgLabel,
                describeResult,
                describedRecipeDataMessage.renderSequence,
                this.buildRecipeDiffViewModel(describedRecipeDataMessage.recipe.objects, describeResult, describedRecipePicklistValues)
            );

            const isDescribedModelStillOnScreen = this.recipeCockpitPanel === cockpitPanel
                                                    && this.recipeCockpitPanelState === panelState
                                                    && panelState.recipeDataMessage === describedRecipeDataMessage;

            // AN ANSWER THE READER MOVED AWAY FROM IS NOT THEIRS TO BE TOLD ABOUT, AND A CANCEL IS ONE THEY CHOSE
            if ( !isDescribedModelStillOnScreen ) {
                return;
            }

            const hasUnexpectedFailure = orgDescribeMessage.isFailure
                                            || ( !orgDescribeMessage.isCancelled && orgDescribeMessage.objects.some(objectSummary => !objectSummary.isDescribed) );

            if ( hasUnexpectedFailure ) {
                VSCodeWorkspaceService.showWarningMessage(orgDescribeMessage.summary);
            }

            panelState.orgProgressMessage = undefined;
            panelState.orgDescribeMessage = orgDescribeMessage;
            this.postToPanel(cockpitPanel, orgDescribeMessage);

        } finally {

            panelState.isOrgDescribeInFlight = false;

            /*
                Still set only when the comparison ended WITHOUT posting an answer -- an answer
                clears it first. The host must stop replaying it, and the panel has to be told too:
                it hides the line when an answer arrives, and none is coming.
            */
            const unansweredProgressMessage = panelState.orgProgressMessage;
            panelState.orgProgressMessage = undefined;

            if ( unansweredProgressMessage && this.recipeCockpitPanelState === panelState ) {
                this.postToPanel(cockpitPanel, { command: 'orgProgress', message: '', renderSequence: unansweredProgressMessage.renderSequence });
            }

        }

    }

    /*
        Stored as well as posted, so a reveal in the middle of a comparison replays where it is, and
        only for the model the comparison is OF: a reader who switched runs mid-describe has a panel
        about another recipe, and a progress line over it would describe work it is not waiting on.
    */
    private static reportOrgProgress(cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        describedRecipeDataMessage: IRecipeCockpitRecipeDataMessage,
                                        progressText: string) {

        if ( this.recipeCockpitPanelState !== panelState || panelState.recipeDataMessage !== describedRecipeDataMessage ) {
            return;
        }

        const orgProgressMessage: IRecipeCockpitOrgProgressMessage = {
            command: 'orgProgress',
            message: progressText,
            renderSequence: describedRecipeDataMessage.renderSequence
        };

        panelState.orgProgressMessage = orgProgressMessage;
        this.postToPanel(cockpitPanel, orgProgressMessage);

    }

    /*
        The v1 "apply": hands off to Generate Treecipe, then loads the run it wrote.

        The command is the unflagged one a reader can already run from the palette -- the cockpit's
        flag gates this BUTTON by gating the panel it is drawn in, not the command it hands off to.
        It regenerates from the workspace's metadata, which is why the panel says so beside the
        button (RECIPE_COCKPIT_REGENERATE_NOTE). The latest run is loaded afterwards whether or not
        generation wrote one: Generate Treecipe reports its own failures, and reloading an
        unchanged latest run shows the reader exactly what is on disk.
    */
    private static async regenerateRecipe(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState) {

        /*
            In flight until the RELOAD has finished, not only the command: the comparison that routes
            this action is replaced only when the reloaded model renders, so clearing the flag in
            between would route a second regeneration off the first one's comparison.

            The run is reloaded even when generation FAILED. The panel disabled its button on the
            click and only a render gives one back, so a failure that skipped the reload would leave
            the reader a button that can never be pressed again. The failure is still rethrown for
            ErrorHandlingService once the panel is usable.
        */
        panelState.isRegenerateInFlight = true;

        let hasGenerationFailed = false;
        let generationError: unknown;

        try {

            try {
                await vscode.commands.executeCommand(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND);
            } catch (commandError) {
                hasGenerationFailed = true;
                generationError = commandError;
            }

            if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot);
            }

        } finally {
            panelState.isRegenerateInFlight = false;
        }

        if ( hasGenerationFailed ) {
            throw generationError;
        }

    }

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

    static buildDataOrgCountViewModel(countOutcome: IOrgRecordCountOutcome): IRecipeCockpitDataOrgCountViewModel {

        return {
            objectApiName: countOutcome.objectApiName,
            status: countOutcome.status,
            recordCount: countOutcome.recordCount ?? 0,
            failureMessage: countOutcome.failureMessage ?? ''
        };

    }

    private static readRememberedDataOrgUsername(): string | undefined {

        try {
            const rememberedUsername = this.recipeCockpitWorkspaceState?.get<unknown>(RECIPE_COCKPIT_DATA_ORG_STATE_KEY);
            return typeof rememberedUsername === 'string' && rememberedUsername ? rememberedUsername : undefined;
        } catch {
            return undefined;
        }

    }

    // A FAILED WRITE ONLY MEANS THE NEXT OPEN DOES NOT PRESELECT -- NOTHING THE READER HAS TO BE TOLD
    private static rememberDataOrgUsername(orgUsername: string | undefined) {

        try {
            Promise.resolve(this.recipeCockpitWorkspaceState?.update(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, orgUsername)).catch(() => undefined);
        } catch {
            return;
        }

    }

    /*
        Lists the authorized orgs and, when the org chosen last is still among them, selects it --
        which is the first time this view contacts an org: listing reads only the CLI's local
        authorizations. An org no longer authorized is dropped without a word, as the issue asks.
    */
    private static async loadDataOrgs(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState) {

        const listedRecipeDataMessage = panelState.recipeDataMessage;
        let orgDetails: IAuthenticatedOrgDetail[] = [];
        let noOrgsMessage = NO_AUTHORIZED_ORGS_MESSAGE;

        try {
            orgDetails = await SalesforceOrgService.listAuthorizedOrgDetails();
        } catch (listError) {
            noOrgsMessage = `The authorized Salesforce orgs could not be listed: ${listError?.message ?? listError}`;
        }

        if ( this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState || panelState.recipeDataMessage !== listedRecipeDataMessage ) {
            return;
        }

        panelState.dataOrgDetails = orgDetails;

        const rememberedUsername = panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername();
        const selectedOrgIndex = rememberedUsername ? orgDetails.findIndex(orgDetail => orgDetail.username === rememberedUsername) : -1;

        if ( rememberedUsername && selectedOrgIndex === -1 ) {
            panelState.dataOrgUsername = undefined;
            this.rememberDataOrgUsername(undefined);
        }

        this.postToPanel(cockpitPanel, {
            command: 'dataOrgList',
            orgLabels: orgDetails.map(orgDetail => this.buildDataOrgLabel(orgDetail)),
            selectedOrgIndex: selectedOrgIndex >= 0 ? selectedOrgIndex : null,
            noOrgsMessage: orgDetails.length === 0 ? noOrgsMessage : '',
            renderSequence: listedRecipeDataMessage.renderSequence
        });

        if ( selectedOrgIndex >= 0 ) {
            await this.selectDataOrg(cockpitPanel, panelState, selectedOrgIndex);
        }

    }

    /*
        Connects to the chosen org by USERNAME, asks the Organization row whether it is a sandbox,
        then counts every object the rendered trees list, posting counts as they arrive.

        Every post first checks that this selection is still the current one -- same panel, same
        model, and no later selection or refresh -- and the count itself stops as soon as it is not,
        so choosing another org mid-count discards this one's answers rather than drawing them over
        the next. Nothing here writes to an org.
    */
    private static async selectDataOrg(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, orgIndex: number) {

        const orgDetail = panelState.dataOrgDetails[orgIndex];
        const selectedRecipeDataMessage = panelState.recipeDataMessage;
        const renderSequence = selectedRecipeDataMessage.renderSequence;
        const objectApiNames = [...panelState.dataOrgObjectApiNames];
        const requestSequence = ++panelState.dataOrgRequestSequence;
        const dataOrgSelection: IRecipeCockpitDataOrgSelection = { orgIndex: orgIndex, orgDetail: orgDetail, requestSequence: requestSequence };
        const orgLabel = this.buildDataOrgLabel(orgDetail);
        let isOrgTypeAnswered = false;

        panelState.dataOrgSelection = dataOrgSelection;
        panelState.dataOrgUsername = orgDetail.username;
        this.rememberDataOrgUsername(orgDetail.username);

        const isSelectionCurrent = () => this.recipeCockpitPanel === cockpitPanel
                                            && this.recipeCockpitPanelState === panelState
                                            && panelState.dataOrgRequestSequence === requestSequence
                                            && panelState.recipeDataMessage === selectedRecipeDataMessage;

        const postSelection = () => isSelectionCurrent() && this.postToPanel(cockpitPanel, {
            command: 'dataOrgSelection',
            orgIndex: orgIndex,
            orgLabel: orgLabel,
            orgTypeLabel: isOrgTypeAnswered ? SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail) : '',
            isSandbox: dataOrgSelection.orgTypeDetail?.isSandbox ?? null,
            requestSequence: requestSequence,
            renderSequence: renderSequence
        });

        let pendingCounts: IRecipeCockpitDataOrgCountViewModel[] = [];

        const postCounts = (completedCount: number, isComplete: boolean, connectionFailureMessage = '') => {

            if ( !isSelectionCurrent() ) {
                return;
            }

            this.postToPanel(cockpitPanel, {
                command: 'dataOrgCounts',
                counts: pendingCounts,
                completedCount: completedCount,
                requestedCount: objectApiNames.length,
                isComplete: isComplete,
                connectionFailureMessage: connectionFailureMessage,
                requestSequence: requestSequence,
                renderSequence: renderSequence
            });

            pendingCounts = [];

        };

        postSelection();

        let querySource: IOrgQuerySource;

        try {
            querySource = SalesforceOrgService.toQuerySource(await SalesforceOrgService.getConnection(orgDetail.username));
        } catch (connectionError) {
            isOrgTypeAnswered = true;
            postSelection();
            postCounts(0, true, `Could not connect to ${orgLabel}: ${connectionError?.message ?? connectionError}. Re-authorize the org with "sf org login web" and try again.`);
            return;
        }

        if ( !isSelectionCurrent() ) {
            return;
        }

        dataOrgSelection.orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        isOrgTypeAnswered = true;
        postSelection();

        const countResult = await SalesforceOrgService.countRecords(orgDetail.username, objectApiNames, async () => querySource, {
            onObjectCounted: (countOutcome, completedCount) => {
                pendingCounts.push(this.buildDataOrgCountViewModel(countOutcome));
                if ( pendingCounts.length >= RECIPE_COCKPIT_DATA_ORG_COUNT_POST_BATCH ) {
                    postCounts(completedCount, false);
                }
            },
            isCancellationRequested: () => !isSelectionCurrent()
        });

        if ( !countResult.wasCancelled ) {
            postCounts(objectApiNames.length, true);
        }

    }

    /*
        The recipe on screen against what the org described, as the panel draws it.

        Only DESCRIBED objects are compared: RecipeCockpitMetadataDiff reads its org side as what the
        org has, so an object whose describe failed or was cancelled would come back with every field
        removed-from-org. Leaving it out of BOTH sides is what lets the panel say "not compared"
        instead. Outcomes are keyed by the names the host requested, which are the model's own.
    */
    static buildRecipeDiffViewModel(recipeObjects: IRecipeCockpitObjectViewModel[],
                                    describeResult: IOrgDescribeRequestResult,
                                    recipePicklistValuesByObjectApiName: RecipePicklistValuesByObjectApiName): IRecipeCockpitDiffViewModel {

        const describedOutcomes = describeResult.outcomes.filter(describeOutcome => !!describeOutcome.describe);
        const describedObjectApiNames = new Set(describedOutcomes.map(describeOutcome => describeOutcome.objectApiName));

        const metadataDiff = RecipeCockpitMetadataDiff.computeMetadataDiff(
            recipeObjects.filter(recipeObject => describedObjectApiNames.has(recipeObject.objectApiName)),
            describedOutcomes.map(describeOutcome => describeOutcome.describe),
            recipePicklistValuesByObjectApiName
        );

        return {
            objects: metadataDiff.objects.map(objectResult => ({
                objectApiName: objectResult.objectApiName,
                changedFields: objectResult.fields
                    .filter(fieldResult => fieldResult.status !== 'unchanged')
                    .map(fieldResult => this.buildFieldDiffViewModel(fieldResult)),
                statusCounts: objectResult.statusCounts,
                uncreateableOrgOnlyFieldCount: objectResult.uncreateableOrgOnlyFieldCount
            })),
            statusCounts: metadataDiff.statusCounts
        };

    }

    private static buildFieldDiffViewModel(fieldResult: IMetadataDiffFieldResult): IRecipeCockpitFieldDiffViewModel {

        return {
            fieldApiName: fieldResult.fieldApiName,
            status: fieldResult.status,
            recipeFieldType: fieldResult.recipeFieldType,
            orgFieldType: fieldResult.orgFieldType,
            addedPicklistValues: fieldResult.addedPicklistValues,
            removedPicklistValues: fieldResult.removedPicklistValues
        };

    }

    static buildEmptyDiffViewModel(): IRecipeCockpitDiffViewModel {

        return { objects: [], statusCounts: RecipeCockpitMetadataDiff.buildEmptyStatusCounts() };

    }

    // THE ALIAS A READER CHOSE BY, WITH THE USERNAME THAT SAYS WHICH ORG IT CURRENTLY POINTS AT
    static buildOrgLabel(orgDetail: IAuthenticatedOrgDetail): string {

        return orgDetail.alias ? `${orgDetail.alias} (${orgDetail.username})` : orgDetail.username;

    }

    static buildOrgDescribeMessage(orgLabel: string,
                                    describeResult: IOrgDescribeRequestResult,
                                    renderSequence: number,
                                    recipeDiff: IRecipeCockpitDiffViewModel = RecipeCockpitService.buildEmptyDiffViewModel()): IRecipeCockpitOrgDescribeMessage {

        const objectSummaries: IRecipeCockpitOrgDescribeObjectSummary[] = describeResult.outcomes.map(describeOutcome => ({
            objectApiName: describeOutcome.objectApiName,
            isDescribed: !!describeOutcome.describe,
            describedFieldCount: describeOutcome.describe?.fields.length ?? 0,
            failureMessage: describeOutcome.describe ? '' : ( describeOutcome.failureMessage || 'unknown error' )
        }));

        const requestedCount = objectSummaries.length;
        const describedCount = objectSummaries.filter(objectSummary => objectSummary.isDescribed).length;
        const cachedCount = describeResult.outcomes.filter(describeOutcome => describeOutcome.wasCached).length;
        const failedCount = requestedCount - describedCount;

        const describedText = `${describedCount} of ${requestedCount} ${requestedCount === 1 ? 'object' : 'objects'} described`;
        const cachedText = cachedCount > 0 ? ` (${cachedCount} from this session's cache)` : '';

        let summary = `Described in ${orgLabel}: ${describedText}${cachedText}.`;

        if ( describeResult.wasCancelled ) {
            summary = `The describe in ${orgLabel} was cancelled: ${describedText}${cachedText}.`;
        } else if ( failedCount > 0 ) {
            summary = `${summary} ${failedCount} could not be described.`;
        }

        return {
            command: 'orgDescribe',
            orgLabel: orgLabel,
            summary: summary,
            isFailure: false,
            isCancelled: describeResult.wasCancelled,
            objects: objectSummaries,
            diff: recipeDiff,
            renderSequence: renderSequence
        };

    }

    static buildOrgConnectionFailureMessage(orgLabel: string, connectionError: unknown, renderSequence: number): IRecipeCockpitOrgDescribeMessage {

        const failureText = ( connectionError as { message?: unknown } )?.message;

        return {
            command: 'orgDescribe',
            orgLabel: orgLabel,
            summary: `Could not connect to ${orgLabel}: ${typeof failureText === 'string' && failureText ? failureText : String(connectionError)}. Re-authorize the org with "sf org login web" and try again.`,
            isFailure: true,
            isCancelled: false,
            objects: [],
            diff: this.buildEmptyDiffViewModel(),
            renderSequence: renderSequence
        };

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

        switch ( panelMessage?.command ) {

            case 'ready':
                return { kind: 'replay', hostMessages: this.buildReplayMessages(panelState) };

            case 'rendered':

                // AN ACKNOWLEDGEMENT CANNOT PRECEDE A MODEL, AND ONLY ACTIVATES THE ONE IT WAS DRAWN FROM
                if ( !panelState.recipeDataMessage || panelMessage.renderSequence !== panelState.recipeDataMessage.renderSequence ) {
                    return undefined;
                }

                return { kind: 'activateActions' };

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

            case 'selectOrg':

                // ONLY ONCE A MODEL WITH OBJECTS IS CONFIRMED ON SCREEN, AND ONE REQUEST AT A TIME
                if ( panelState.describableObjectApiNames.size === 0 || panelState.isOrgDescribeInFlight ) {
                    return undefined;
                }

                return { kind: 'selectOrg' };

            case 'regenerateRecipe':

                /*
                    Offered only beside a comparison of the model the panel confirmed drawing: the
                    active describable set is non-empty only after that model's "rendered", and a
                    comparison is stored only while its model is the one on screen.
                */
                if ( panelState.describableObjectApiNames.size === 0
                        || !panelState.orgDescribeMessage
                        || panelState.orgDescribeMessage.diff.objects.length === 0
                        || panelState.isRegenerateInFlight ) {
                    return undefined;
                }

                return { kind: 'regenerateRecipe' };

            /*
                Names, not a path, and answered only for a row the CONFIRMED-drawn model marked as a
                picklist: the key has to be in the active set, which the panel's "rendered" fills
                and every reload empties.
            */
            case 'loadPicklistValues': {

                const { objectApiName, fieldApiName } = panelMessage;

                if ( typeof objectApiName !== 'string' || typeof fieldApiName !== 'string' || !panelState.recipeDataMessage ) {
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
                        renderSequence: panelState.recipeDataMessage.renderSequence
                    }
                };

            }

            case 'selectRun': {

                const { runFolderName } = panelMessage;

                if ( typeof runFolderName !== 'string' || !panelState.selectableRunFolderNames.has(runFolderName) ) {
                    return undefined;
                }

                return { kind: 'selectRun', runFolderName: runFolderName };

            }

            /*
                The history tabs post NAMES -- a tree key, a run folder, a data set folder -- and each
                is matched against its own allow-list drawn from the confirmed-drawn model, then
                resolved through a map the HOST built. No path the panel could post is ever read.
            */
            case 'loadVersionSummaries': {

                const { treeKey } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.summaryTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                const summarySource = panelState.treeHistoryTargets.summarySourcesByTreeKey.get(treeKey);

                return summarySource
                    ? { kind: 'loadVersionSummaries', treeKey: treeKey, summarySource: summarySource, renderSequence: panelState.recipeDataMessage.renderSequence }
                    : undefined;

            }

            case 'loadDatasetRecordCounts': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.countableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

                return datasetFolderPath
                    ? { kind: 'loadDatasetRecordCounts', datasetFolderName: datasetFolderName, datasetFolderPath: datasetFolderPath, renderSequence: panelState.recipeDataMessage.renderSequence }
                    : undefined;

            }

            case 'diffTreeVersion': {

                const { treeKey, runFolderName } = panelMessage;

                if ( typeof treeKey !== 'string' || typeof runFolderName !== 'string' ) {
                    return undefined;
                }

                const diffKey = RecipeCockpitTreeHistory.buildDiffKey(treeKey, runFolderName);
                const diffTarget = panelState.treeHistoryAllowLists.diffKeys.has(diffKey) ? panelState.treeHistoryTargets.diffTargetsByKey.get(diffKey) : undefined;

                return diffTarget ? { kind: 'diffTreeVersion', ...diffTarget } : undefined;

            }

            case 'openDataset':
            case 'insertDataset': {

                const { datasetFolderName } = panelMessage;
                const allowedDatasetFolderNames = panelMessage.command === 'openDataset'
                    ? panelState.treeHistoryAllowLists.openableDatasetFolderNames
                    : panelState.treeHistoryAllowLists.insertableDatasetFolderNames;

                if ( typeof datasetFolderName !== 'string' || !allowedDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                const datasetFolderPath = panelState.treeHistoryTargets.datasetFolderPathsByName.get(datasetFolderName);

                if ( !datasetFolderPath ) {
                    return undefined;
                }

                const focusTree = this.readTreeFocus(panelMessage, panelState);

                return {
                    kind: panelMessage.command,
                    datasetFolderName: datasetFolderName,
                    datasetFolderPath: datasetFolderPath,
                    ...( focusTree ? { focusTree: focusTree } : {} )
                };

            }

            /*
                The tree's KEY -- its folder name -- never a path: the recipe file is looked up in
                the host-only targets of the confirmed-drawn model, and one run at a time.
            */
            case 'runFaker': {

                const { treeKey } = panelMessage;

                // A RUN IN FLIGHT ALREADY HOLDS THE BUTTONS DISABLED, AND ITS OWN END RE-ENABLES THEM
                if ( panelState.runFakerStateMessage ) {
                    return undefined;
                }

                const recipeFilePath = typeof treeKey === 'string'
                                        && !!panelState.recipeDataMessage
                                        && panelState.treeHistoryAllowLists.runnableTreeKeys.has(treeKey)
                    ? panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey)
                    : undefined;

                if ( recipeFilePath ) {
                    return { kind: 'runFaker', treeKey: treeKey as string, recipeFilePath: recipeFilePath };
                }

                /*
                    The panel disabled every Run Faker on the click, before asking. A click on cards
                    a new model has replaced but not yet confirmed drawing is refused here, and only
                    a runFakerState gives the buttons back -- so a refusal still says nothing runs.
                */
                return {
                    kind: 'postRunFakerState',
                    hostMessage: { command: 'runFakerState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' }
                };

            }

            /*
                Data-by-Org reads org names from the CLI, and the panel only ever names one by its
                INDEX into the list the host posted -- never a username or an alias. Which objects
                are counted is read from the confirmed-drawn model, never from the message.
            */
            case 'loadDataOrgs':

                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return { kind: 'loadDataOrgs' };

            case 'selectDataOrg': {

                const { orgIndex } = panelMessage;

                if ( typeof orgIndex !== 'number'
                        || !Number.isInteger(orgIndex)
                        || orgIndex < 0
                        || orgIndex >= panelState.dataOrgDetails.length
                        || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return { kind: 'selectDataOrg', orgIndex: orgIndex };

            }

            case 'refreshDataOrgCounts':

                if ( !panelState.dataOrgSelection || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return { kind: 'refreshDataOrgCounts' };

        }

        return undefined;

    }

    // WHERE THE READER ACTED FROM, KEPT ONLY IF IT NAMES A CARD OF THE MODEL ON SCREEN AND A HISTORY TAB
    static readTreeFocus(panelMessage: IRecipeCockpitPanelMessage, panelState: IRecipeCockpitPanelState): IRecipeCockpitTreeFocus | undefined {

        const { treeKey, tab } = panelMessage;
        const isHistoryTab = tab === 'versions' || tab === 'datasets';
        const isRenderedTree = typeof treeKey === 'string'
                                && !!panelState.recipeDataMessage?.recipe.trees.some(tree => tree.treeKey === treeKey);

        return isHistoryTab && isRenderedTree ? { treeKey: treeKey as string, tab: tab } : undefined;

    }

    /*
        What a (re)loaded document is brought back to: the model if there is one, then a failure if
        the load died -- the structure on screen is still worth showing, and the reader still has to
        be told the load behind it did not finish -- and otherwise the phase a load is still in.
    */
    static buildReplayMessages(panelState: IRecipeCockpitPanelState): RecipeCockpitHostMessage[] {

        const replayMessages: RecipeCockpitHostMessage[] = [];

        if ( panelState.recipeDataMessage ) {
            replayMessages.push(panelState.recipeDataMessage);
        }

        if ( panelState.recipeDataMessage && panelState.orgDescribeMessage ) {
            replayMessages.push(panelState.orgDescribeMessage);
        }

        if ( panelState.recipeDataMessage && panelState.orgProgressMessage ) {
            replayMessages.push(panelState.orgProgressMessage);
        }

        if ( panelState.runFakerStateMessage ) {
            replayMessages.push(panelState.runFakerStateMessage);
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

    static buildPicklistKey(objectApiName: string, fieldApiName: string): string {

        return `${objectApiName}\n${fieldApiName}`;

    }

    // EVERY ROW THE RENDERED MODEL MARKS AS A PICKLIST, AND NOTHING ELSE
    static collectLoadablePicklistKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.objects.flatMap(objectViewModel => objectViewModel.fields
            .filter(fieldViewModel => fieldViewModel.isPicklist)
            .map(fieldViewModel => this.buildPicklistKey(objectViewModel.objectApiName, fieldViewModel.fieldApiName)));

    }

    // EVERY FILE AND LINE THE RENDERED MODEL OFFERS TO OPEN, AND NOTHING ELSE
    static collectOpenableSourceKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        const openableSourceKeys: string[] = [];

        recipeViewModel.objects.forEach(objectViewModel => {

            if ( !objectViewModel.recipeFilePath ) {
                return;
            }

            if ( objectViewModel.lineNumber ) {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, objectViewModel.lineNumber));
            }

            objectViewModel.fields.forEach(fieldViewModel => {
                if ( fieldViewModel.lineNumber ) {
                    openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, fieldViewModel.lineNumber));
                }
            });

            ( objectViewModel.iterations ?? [] ).forEach(iteration => {
                openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iteration.lineNumber));
                iteration.fields.forEach(iterationField => openableSourceKeys.push(this.buildOpenSourceKey(objectViewModel.recipeFilePath, iterationField.lineNumber)));
            });

        });

        return openableSourceKeys;

    }

    /*
        Every Generate Treecipe run under GeneratedRecipes that carries an objects wrapper, newest
        first.

        Ordered by the timestamp SUFFIX rather than the folder name: a faker-js run is prefixed
        "recipe-fakerjs-" and a snowfakery run "recipe-", so sorting the names would rank every run
        of one backend above every run of the other regardless of when either ran. A folder that
        does not end in a run timestamp, or holds no wrapper, is not a run this panel can read.
    */
    static findGeneratedRecipeRuns(generatedRecipesFolderPath: string): IRecipeCockpitRun[] {

        if ( !SfdxProjectService.isExistingDirectory(generatedRecipesFolderPath) ) {
            return [];
        }

        const recipeRuns: IRecipeCockpitRun[] = [];

        fs.readdirSync(generatedRecipesFolderPath, { withFileTypes: true }).forEach(runFolderEntry => {

            if ( !runFolderEntry.isDirectory() ) {
                return;
            }

            const timestampMatch = RUN_FOLDER_TIMESTAMP_PATTERN.exec(runFolderEntry.name);

            if ( !timestampMatch ) {
                return;
            }

            const runFolderPath = path.join(generatedRecipesFolderPath, runFolderEntry.name);
            const objectsWrapperFilePath = this.findObjectsWrapperFilePath(runFolderPath, timestampMatch);

            if ( !objectsWrapperFilePath ) {
                return;
            }

            const [, runDate, runHours, runMinutes, runSeconds] = timestampMatch;

            recipeRuns.push({
                runFolderName: runFolderEntry.name,
                runFolderPath: runFolderPath,
                generatedAtTimestamp: `${runDate}T${runHours}:${runMinutes}:${runSeconds}Z`,
                objectsWrapperFilePath: objectsWrapperFilePath
            });

        });

        return recipeRuns.sort((firstRun, secondRun) => (
            secondRun.generatedAtTimestamp.localeCompare(firstRun.generatedAtTimestamp)
            || firstRun.runFolderName.localeCompare(secondRun.runFolderName)
        ));

    }

    // THE WRAPPER NAMED FOR THE RUN'S OWN TIMESTAMP IF IT IS THERE, OTHERWISE THE FIRST WRAPPER IN THE FOLDER
    private static findObjectsWrapperFilePath(runFolderPath: string, timestampMatch: RegExpExecArray): string | undefined {

        const objectsWrapperPrefix = ConfigurationService.getTreecipeObjectsWrapperName();
        const runTimestamp = timestampMatch[0].substring(1);

        const objectsWrapperFileNames = fs.readdirSync(runFolderPath, { withFileTypes: true })
            .filter(runFileEntry => runFileEntry.isFile()
                                    && runFileEntry.name.startsWith(objectsWrapperPrefix)
                                    && runFileEntry.name.endsWith('.json'))
            .map(runFileEntry => runFileEntry.name)
            .sort();

        const objectsWrapperFileName = objectsWrapperFileNames.find(fileName => fileName === `${objectsWrapperPrefix}-${runTimestamp}.json`)
            ?? objectsWrapperFileNames[0];

        return objectsWrapperFileName ? path.join(runFolderPath, objectsWrapperFileName) : undefined;

    }

    static buildRunLabel(recipeRun: IRecipeCockpitRun, isLatestRun: boolean): string {

        const generatedAt = recipeRun.generatedAtTimestamp.replace('T', ' ').replace('Z', ' UTC');
        const fakerService = recipeRun.runFolderName.startsWith(FAKER_JS_RUN_FOLDER_PREFIX) ? 'faker-js' : 'snowfakery';

        return `${generatedAt} · ${fakerService}${isLatestRun ? ' · latest' : ''}`;

    }

    // THE LOADER, END TO END: THE LATEST RUN, OR THE ONE REQUESTED WHEN IT IS STILL ON DISK
    static buildRecipeViewModel(workspaceRoot: string, requestedRunFolderName?: string): IRecipeCockpitRecipeViewModel {

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());

        return this.buildRecipeViewModelByRuns(this.findGeneratedRecipeRuns(generatedRecipesFolderPath), workspaceRoot, requestedRunFolderName);

    }

    static buildRecipeViewModelByRuns(recipeRuns: IRecipeCockpitRun[],
                                        workspaceRoot: string,
                                        requestedRunFolderName?: string): IRecipeCockpitRecipeViewModel {

        return this.loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName).recipeViewModel;

    }

    static loadRecipeRunByRuns(recipeRuns: IRecipeCockpitRun[],
                                workspaceRoot: string,
                                requestedRunFolderName?: string): IRecipeCockpitLoadedRecipe {

        const runViewModels = recipeRuns.map((recipeRun, runIndex) => ({
            runFolderName: recipeRun.runFolderName,
            label: this.buildRunLabel(recipeRun, runIndex === 0)
        }));

        if ( recipeRuns.length === 0 ) {
            return {
                recipeViewModel: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE },
                recipePicklistValuesByObjectApiName: new Map(),
                picklistDisplayValuesByObjectApiName: new Map(),
                treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets()
            };
        }

        const requestedRun = recipeRuns.find(recipeRun => recipeRun.runFolderName === requestedRunFolderName);
        const selectedRun = requestedRun ?? recipeRuns[0];

        const recipeViewModel: IRecipeCockpitRecipeViewModel = {
            runs: runViewModels,
            selectedRunFolderName: selectedRun.runFolderName,
            objects: [],
            trees: [],
            notices: [],
            emptyStateMessage: ''
        };

        let parsedObjectsWrapper: unknown;

        try {
            parsedObjectsWrapper = JSON.parse(fs.readFileSync(selectedRun.objectsWrapperFilePath, 'utf-8'));
        } catch (readError) {
            recipeViewModel.emptyStateMessage = `The objects wrapper "${path.basename(selectedRun.objectsWrapperFilePath)}" for this run could not be read: ${readError?.message ?? readError}. Choose another run, or run "Generate Treecipe" again.`;
            return {
                recipeViewModel: recipeViewModel,
                recipePicklistValuesByObjectApiName: new Map(),
                picklistDisplayValuesByObjectApiName: new Map(),
                treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets()
            };
        }

        const normalizedObjectsWrapper = this.normalizeObjectsWrapper(parsedObjectsWrapper);
        if ( normalizedObjectsWrapper.isObjectsWrapper ) {
            this.cacheRunFieldCounts(selectedRun.objectsWrapperFilePath, normalizedObjectsWrapper);
        }
        const recipeSourceRead = this.readRecipeSourceFiles(selectedRun.runFolderPath, workspaceRoot);

        /*
            An object the wrapper holds with no Fields is one a lookup points at. RelationshipService
            still lists it in its tree's RecipeFiles objects, but no recipe is written for it -- so it
            is kept only if a recipe file actually carries it.
        */
        recipeViewModel.objects = this.attachRecipeSources(normalizedObjectsWrapper.objects, recipeSourceRead.recipeSourceFiles)
            .filter(objectViewModel => !normalizedObjectsWrapper.fieldlessObjectApiNames.has(objectViewModel.objectApiName)
                                        || !!objectViewModel.recipeFilePath);

        const recipeTreeBuild = this.buildRecipeTreeViewModels(
            normalizedObjectsWrapper,
            recipeViewModel.objects,
            recipeSourceRead.recipeSourceFiles,
            selectedRun.runFolderPath
        );

        recipeViewModel.trees = recipeTreeBuild.trees;

        const treeHistoryBuild = RecipeCockpitTreeHistory.buildTreeHistories(
            path.dirname(selectedRun.runFolderPath),
            path.join(workspaceRoot, ConfigurationService.getFakeDataSetsFolderPath()),
            workspaceRoot,
            selectedRun.runFolderName,
            recipeViewModel.trees,
            new Map(recipeRuns.map(recipeRun => [recipeRun.runFolderName, recipeRun.objectsWrapperFilePath]))
        );

        recipeViewModel.trees.forEach(tree => {
            const treeHistory = treeHistoryBuild.historiesByTreeKey.get(tree.treeKey);
            if ( treeHistory ) {
                tree.history = treeHistory;
            }
            const runFakerRecipeFilePath = treeHistoryBuild.targets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
            if ( runFakerRecipeFilePath ) {
                tree.runFakerRecipeFileName = path.basename(runFakerRecipeFilePath);
            }
        });

        const unmatchedDatasetNotices = treeHistoryBuild.unmatchedDatasetCount > 0
            ? [RecipeCockpitTreeHistory.buildUnmatchedDatasetsNotice(treeHistoryBuild.unmatchedDatasetCount)]
            : [];

        const missingRunNotices = requestedRunFolderName && !requestedRun
            ? [`The run "${requestedRunFolderName}" is no longer on disk, so the latest run is shown instead.`]
            : [];

        recipeViewModel.notices = [...missingRunNotices, ...normalizedObjectsWrapper.notices, ...recipeSourceRead.notices, ...recipeTreeBuild.notices, ...unmatchedDatasetNotices];

        if ( recipeViewModel.objects.length === 0 ) {
            recipeViewModel.emptyStateMessage = normalizedObjectsWrapper.isObjectsWrapper
                ? `The objects wrapper "${path.basename(selectedRun.objectsWrapperFilePath)}" lists no objects. Choose another run, or run "Generate Treecipe" again.`
                : `"${path.basename(selectedRun.objectsWrapperFilePath)}" is not a Treecipe objects wrapper. Choose another run, or run "Generate Treecipe" again.`;
        }

        return {
            recipeViewModel: recipeViewModel,
            recipePicklistValuesByObjectApiName: normalizedObjectsWrapper.picklistValuesByObjectApiName,
            picklistDisplayValuesByObjectApiName: normalizedObjectsWrapper.picklistDisplayValuesByObjectApiName,
            treeHistoryTargets: treeHistoryBuild.targets
        };

    }

    /*
        The ObjectInfoWrapper JSON, reduced to what the panel renders and checked on the way.

        The file is on disk, so nothing in it is assumed: every value read is type checked, a field
        entry with no api name is dropped and COUNTED rather than rendered as a row with nothing to
        name it by, and an object only referenced by a lookup -- a key the wrapper holds for the
        relationship but no recipe was written for -- is not listed as though it were in the recipe.

        Objects come in RECIPE order, the order RecipeFiles says they are inserted in, because that
        is the order the reader meets them in the files the panel opens.
    */
    static normalizeObjectsWrapper(parsedObjectsWrapper: unknown): IRecipeCockpitNormalizedObjectsWrapper {

        const objectsWrapperRecord = this.asRecord(parsedObjectsWrapper);
        const objectToObjectInfoMap = this.asRecord(objectsWrapperRecord?.ObjectToObjectInfoMap);

        if ( !objectToObjectInfoMap ) {
            return {
                objects: [],
                notices: [],
                isObjectsWrapper: false,
                fieldlessObjectApiNames: new Set(),
                picklistValuesByObjectApiName: new Map(),
                picklistDisplayValuesByObjectApiName: new Map(),
                recipeTrees: [],
                parentLookupsByObjectApiName: new Map()
            };
        }

        const recipeObjectApiNames: string[] = [];
        const recipeTrees: IRecipeCockpitWrapperTree[] = [];
        const recipeFiles = objectsWrapperRecord.RecipeFiles;

        if ( Array.isArray(recipeFiles) ) {
            recipeFiles.forEach(recipeFile => {
                const recipeFileObjects = this.asRecord(recipeFile)?.objects;
                if ( Array.isArray(recipeFileObjects) ) {
                    const treeObjectApiNames = recipeFileObjects.filter((objectApiName): objectApiName is string => typeof objectApiName === 'string' && !!objectApiName);
                    treeObjectApiNames.forEach(objectApiName => recipeObjectApiNames.push(objectApiName));
                    if ( treeObjectApiNames.length > 0 ) {
                        recipeTrees.push({ objectApiNames: treeObjectApiNames });
                    }
                }
            });
        }

        const wrapperObjectApiNames = Object.keys(objectToObjectInfoMap);
        const recipeObjectApiNameSet = new Set(recipeObjectApiNames);

        const orderedObjectApiNames = new Set([
            ...recipeObjectApiNames.filter(objectApiName => Object.prototype.hasOwnProperty.call(objectToObjectInfoMap, objectApiName)),
            ...wrapperObjectApiNames.filter(objectApiName => !recipeObjectApiNameSet.has(objectApiName))
        ]);

        const objects: IRecipeCockpitObjectViewModel[] = [];
        const fieldlessObjectApiNames = new Set<string>();
        const picklistValuesByObjectApiName = new Map<string, Map<string, string[]>>();
        const picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName = new Map();
        const parentLookupsByObjectApiName = new Map<string, IRecipeCockpitParentLookupViewModel[]>();
        let unreadableFieldCount = 0;

        orderedObjectApiNames.forEach(objectApiName => {

            const wrapperObjectRecord = this.asRecord(objectToObjectInfoMap[objectApiName]);
            const wrapperFields = wrapperObjectRecord?.Fields;
            const recordTypePicklistSections = this.readRecordTypePicklistSections(wrapperObjectRecord?.RecordTypesMap);

            parentLookupsByObjectApiName.set(objectApiName, this.readParentLookups(wrapperObjectRecord?.RelationshipDetail));

            if ( !Array.isArray(wrapperFields) ) {

                if ( !recipeObjectApiNameSet.has(objectApiName) ) {
                    return;
                }

                fieldlessObjectApiNames.add(objectApiName);

            }

            const fields: IRecipeCockpitFieldViewModel[] = [];

            ( Array.isArray(wrapperFields) ? wrapperFields : [] ).forEach(wrapperField => {

                const wrapperFieldRecord = this.asRecord(wrapperField) ?? {};
                const fieldApiName = wrapperFieldRecord.fieldName;

                if ( typeof fieldApiName !== 'string' || !fieldApiName ) {
                    unreadableFieldCount++;
                    return;
                }

                /*
                    A DEPENDENT picklist backed by a global value set records only the values its
                    valueSettings name (XmlFileProcessor.extractPicklistDetailsFromValueSettings), not
                    the set -- and the wrapper does not say which value set a field used, so a local
                    dependent picklist cannot be told apart from it. Recording either as the field's
                    values would report every unlisted org value as added, so neither makes a claim.
                */
                const isDependentPicklist = !!this.asString(wrapperFieldRecord.controllingField);
                // READ ONCE AND SHARED BY THE DIFF'S COPY AND THE DISPLAY COPY -- NEITHER IS EVER MUTATED
                const activePicklistValues = Array.isArray(wrapperFieldRecord.picklistValues)
                    ? this.readActivePicklistValues(wrapperFieldRecord.picklistValues)
                    : undefined;

                if ( activePicklistValues && !isDependentPicklist ) {
                    const picklistValuesByFieldApiName = picklistValuesByObjectApiName.get(objectApiName) ?? new Map<string, string[]>();
                    picklistValuesByFieldApiName.set(fieldApiName, activePicklistValues);
                    picklistValuesByObjectApiName.set(objectApiName, picklistValuesByFieldApiName);
                }

                const fieldType = this.asString(wrapperFieldRecord.type);
                const fieldViewModel: IRecipeCockpitFieldViewModel = {
                    fieldApiName: fieldApiName,
                    fieldLabel: this.asString(wrapperFieldRecord.fieldLabel),
                    fieldType: fieldType,
                    fieldTypeWithSize: this.formatFieldTypeWithSize(fieldType, {
                        length: this.asFieldSize(wrapperFieldRecord.length),
                        precision: this.asFieldSize(wrapperFieldRecord.precision),
                        scale: this.asFieldSize(wrapperFieldRecord.scale)
                    }),
                    recipeValue: this.buildDisplayExpression(this.asString(wrapperFieldRecord.recipeValue).split('\n')),
                    controllingField: this.asString(wrapperFieldRecord.controllingField),
                    isOnlyInRecipeFile: false
                };

                if ( RECIPE_COCKPIT_PICKLIST_FIELD_TYPES.includes(fieldType) ) {

                    fieldViewModel.isPicklist = true;

                    const picklistDisplayValuesByFieldApiName = picklistDisplayValuesByObjectApiName.get(objectApiName) ?? new Map<string, IRecipeCockpitPicklistDisplayValues>();
                    picklistDisplayValuesByFieldApiName.set(fieldApiName, {
                        picklistValues: activePicklistValues ?? [],
                        recordTypePicklistValues: recordTypePicklistSections
                            .filter(recordTypeSection => Object.prototype.hasOwnProperty.call(recordTypeSection.picklistValuesByFieldApiName, fieldApiName))
                            .map(recordTypeSection => ({
                                recordTypeDeveloperName: recordTypeSection.recordTypeDeveloperName,
                                picklistValues: recordTypeSection.picklistValuesByFieldApiName[fieldApiName]
                            }))
                    });
                    picklistDisplayValuesByObjectApiName.set(objectApiName, picklistDisplayValuesByFieldApiName);

                }

                fields.push(fieldViewModel);

            });

            objects.push({ objectApiName: objectApiName, recipeFilePath: '', recipeFileName: '', fields: fields });

        });

        const notices = unreadableFieldCount > 0
            ? [`${unreadableFieldCount} field ${unreadableFieldCount === 1 ? 'entry' : 'entries'} in the objects wrapper had no field api name and ${unreadableFieldCount === 1 ? 'is' : 'are'} not shown.`]
            : [];

        return {
            objects: objects,
            notices: notices,
            isObjectsWrapper: true,
            fieldlessObjectApiNames: fieldlessObjectApiNames,
            picklistValuesByObjectApiName: picklistValuesByObjectApiName,
            picklistDisplayValuesByObjectApiName: picklistDisplayValuesByObjectApiName,
            recipeTrees: recipeTrees,
            parentLookupsByObjectApiName: parentLookupsByObjectApiName
        };

    }

    /*
        A field's type as the Structure tab draws it: "Number(16,2)" from precision and scale,
        "Text(50)" from length, the bare type otherwise. A precision with no scale is a scale of 0,
        which is what Salesforce gives such a field. A run from before sizes were recorded has
        neither, so it draws the bare type.
    */
    static formatFieldTypeWithSize(fieldType: string, fieldSize: IFieldSize): string {

        if ( !fieldType ) {
            return '';
        }

        if ( fieldSize.precision !== undefined ) {
            return `${fieldType}(${fieldSize.precision},${fieldSize.scale ?? 0})`;
        }

        if ( fieldSize.length !== undefined ) {
            return `${fieldType}(${fieldSize.length})`;
        }

        return fieldType;

    }

    private static asFieldSize(candidateValue: unknown): number | undefined {

        return typeof candidateValue === 'number' && Number.isInteger(candidateValue) && candidateValue >= 0
            ? candidateValue
            : undefined;

    }

    /*
        RelationshipDetail.parentObjectToFieldReferences as one entry per lookup field, in the
        order the wrapper lists them. Anything not a string is dropped: the file is on disk.
    */
    static readParentLookups(relationshipDetail: unknown): IRecipeCockpitParentLookupViewModel[] {

        const parentObjectToFieldReferences = this.asRecord(this.asRecord(relationshipDetail)?.parentObjectToFieldReferences);
        const parentLookups: IRecipeCockpitParentLookupViewModel[] = [];

        if ( !parentObjectToFieldReferences ) {
            return parentLookups;
        }

        Object.keys(parentObjectToFieldReferences).forEach(parentObjectApiName => {

            const fieldApiNames = parentObjectToFieldReferences[parentObjectApiName];

            if ( !Array.isArray(fieldApiNames) ) {
                return;
            }

            fieldApiNames
                .filter((fieldApiName): fieldApiName is string => typeof fieldApiName === 'string' && !!fieldApiName)
                .forEach(fieldApiName => parentLookups.push({ fieldApiName: fieldApiName, parentObjectApiName: parentObjectApiName }));

        });

        return parentLookups;

    }

    /*
        RecordTypesMap as the per-field values each record type assigns, in the map's own order --
        RecordTypeService sorts it by developer name once where it is loaded (#166), so re-sorting
        here would be a second order to keep in step.
    */
    static readRecordTypePicklistSections(recordTypesMap: unknown): Array<{ recordTypeDeveloperName: string; picklistValuesByFieldApiName: Record<string, string[]> }> {

        const recordTypesRecord = this.asRecord(recordTypesMap);

        if ( !recordTypesRecord ) {
            return [];
        }

        return Object.keys(recordTypesRecord).map(recordTypeDeveloperName => {

            const picklistSections = this.asRecord(this.asRecord(recordTypesRecord[recordTypeDeveloperName])?.PicklistFieldSectionsToPicklistDetail) ?? {};
            // KEYED BY FIELD API NAME FROM A FILE ON DISK, SO NO PROTOTYPE A NAME LIKE "constructor" COULD READ BACK
            const picklistValuesByFieldApiName: Record<string, string[]> = Object.create(null);

            Object.keys(picklistSections).forEach(fieldApiName => {
                const sectionValues = picklistSections[fieldApiName];
                if ( Array.isArray(sectionValues) ) {
                    picklistValuesByFieldApiName[fieldApiName] = sectionValues.filter((sectionValue): sectionValue is string => typeof sectionValue === 'string');
                }
            });

            return { recordTypeDeveloperName: recordTypeDeveloperName, picklistValuesByFieldApiName: picklistValuesByFieldApiName };

        });

    }

    /*
        One card per relationship tree, in RecipeFiles order, each listing the objects the recipe
        carries in insert order with the lookups tying each to a parent in the SAME tree.

        A card is keyed by the folder Generate Treecipe wrote the tree to, which it names by the
        tree's first and last object -- lookup targets with no recipe of their own included, so the
        name is taken from the tree's whole object list, before the objects the panel does not list
        are dropped. A wrapper with no RecipeFiles (a run from before they were written, or one
        edited by hand) falls back to one card per recipe file, its objects in file order, with no
        lookups and a notice saying why. An object no card claimed still gets one, because a view
        that left it out would say it is not in the recipe.
    */
    static buildRecipeTreeViewModels(normalizedObjectsWrapper: Pick<IRecipeCockpitNormalizedObjectsWrapper, 'recipeTrees' | 'parentLookupsByObjectApiName'>,
                                        objects: IRecipeCockpitObjectViewModel[],
                                        recipeSourceFiles: IRecipeSourceFile[],
                                        runFolderPath: string): { trees: IRecipeCockpitTreeViewModel[]; notices: string[] } {

        const objectsByApiName = new Map(objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));
        const claimedObjectApiNames = new Set<string>();
        const usedTreeKeys = new Set<string>();
        const trees: IRecipeCockpitTreeViewModel[] = [];
        const notices: string[] = [];

        const hasTreeData = normalizedObjectsWrapper.recipeTrees.length > 0;

        const treeSources: Array<{ folderName: string; objectApiNames: string[]; hasLookups: boolean }> = hasTreeData
            ? normalizedObjectsWrapper.recipeTrees.map(recipeTree => ({
                folderName: RelationshipService.buildRecipeTreeFolderName(recipeTree.objectApiNames),
                objectApiNames: recipeTree.objectApiNames,
                hasLookups: true
            }))
            : recipeSourceFiles.map(recipeSourceFile => ({
                folderName: path.resolve(path.dirname(recipeSourceFile.filePath)) === path.resolve(runFolderPath)
                    ? path.basename(recipeSourceFile.filePath)
                    : path.basename(path.dirname(recipeSourceFile.filePath)),
                objectApiNames: [...recipeSourceFile.objectEntries.keys()],
                hasLookups: false
            }));

        if ( !hasTreeData && objects.length > 0 ) {
            notices.push(RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE);
        }

        treeSources.forEach((treeSource, treeIndex) => {

            const treeObjectApiNameSet = new Set(treeSource.objectApiNames);
            const treeObjects: IRecipeCockpitTreeObjectViewModel[] = [];

            treeSource.objectApiNames.forEach(objectApiName => {

                if ( !objectsByApiName.has(objectApiName) || claimedObjectApiNames.has(objectApiName) ) {
                    return;
                }

                claimedObjectApiNames.add(objectApiName);

                const parentLookups = treeSource.hasLookups
                    ? ( normalizedObjectsWrapper.parentLookupsByObjectApiName.get(objectApiName) ?? [] )
                        .filter(parentLookup => treeObjectApiNameSet.has(parentLookup.parentObjectApiName))
                    : [];

                treeObjects.push({ objectApiName: objectApiName, parentLookups: parentLookups });

                // EACH LATER OCCURRENCE IS LISTED RIGHT AFTER ITS OBJECT, SO THE CARD READS "Account, then the Account nested under it" (#188)
                ( objectsByApiName.get(objectApiName).iterations ?? [] ).forEach(iteration => {
                    treeObjects.push({ objectApiName: objectApiName, parentLookups: parentLookups, iterationNickname: iteration.nickname });
                });

            });

            trees.push(this.buildTreeViewModel(
                this.claimTreeKey(treeSource.folderName, treeIndex, usedTreeKeys),
                `${RECIPE_COCKPIT_TREE_TITLE_PREFIX} ${treeIndex + 1}`,
                treeSource.folderName,
                treeObjects,
                objectsByApiName
            ));

        });

        const unclaimedObjects = objects.filter(objectViewModel => !claimedObjectApiNames.has(objectViewModel.objectApiName));

        if ( unclaimedObjects.length > 0 ) {
            trees.push(this.buildTreeViewModel(
                this.claimTreeKey('', trees.length, usedTreeKeys),
                RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
                '',
                unclaimedObjects.map(objectViewModel => ({ objectApiName: objectViewModel.objectApiName, parentLookups: [] })),
                objectsByApiName
            ));
        }

        return { trees: trees, notices: notices };

    }

    // THE FOLDER NAME, UNLESS A HAND-EDITED WRAPPER REPEATS ONE -- TWO CARDS SHARING A KEY WOULD SCOPE A SEARCH TO BOTH
    private static claimTreeKey(folderName: string, treeIndex: number, usedTreeKeys: Set<string>): string {

        const treeKey = usedTreeKeys.has(folderName) ? `${folderName}#${treeIndex + 1}` : folderName;
        usedTreeKeys.add(treeKey);
        return treeKey;

    }

    private static buildTreeViewModel(treeKey: string,
                                        title: string,
                                        folderName: string,
                                        treeObjects: IRecipeCockpitTreeObjectViewModel[],
                                        objectsByApiName: Map<string, IRecipeCockpitObjectViewModel>): IRecipeCockpitTreeViewModel {

        return {
            treeKey: treeKey,
            title: title,
            folderName: folderName,
            objects: treeObjects,
            // AN OBJECT'S FIELDS ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD LISTS
            fieldCount: treeObjects
                .filter(treeObject => treeObject.iterationNickname === undefined)
                .reduce((fieldCount, treeObject) => fieldCount + objectsByApiName.get(treeObject.objectApiName).fields.length, 0)
        };

    }

    /*
        A FieldInfo's picklistValues as the values a record can be given: an entry with no
        picklistOptionApiName names nothing and is skipped, and one marked isActive: false is not
        a value a record can take. An absent isActive is active, as XmlFileProcessor defaults it.
    */
    static readActivePicklistValues(wrapperPicklistValues: unknown[]): string[] {

        return wrapperPicklistValues.reduce<string[]>((activePicklistValues, wrapperPicklistValue) => {

            const picklistValueRecord = this.asRecord(wrapperPicklistValue);
            const picklistOptionApiName = picklistValueRecord?.picklistOptionApiName;

            if ( typeof picklistOptionApiName === 'string' && picklistValueRecord.isActive !== false ) {
                activePicklistValues.push(picklistOptionApiName);
            }

            return activePicklistValues;

        }, []);

    }

    private static asRecord(candidateValue: unknown): Record<string, unknown> | undefined {

        return candidateValue !== null && typeof candidateValue === 'object' && !Array.isArray(candidateValue)
            ? candidateValue as Record<string, unknown>
            : undefined;

    }

    private static asString(candidateValue: unknown): string {

        return typeof candidateValue === 'string' ? candidateValue : '';

    }

    /*
        A faker expression as a reader would read it in the file, without the file's placement.

        The first line is whatever followed "Field:" and is trimmed on its own; a YAML block
        indicator ("|", ">", with or without a chomping sign) or nothing at all there is dropped.
        The lines after it are DEDENTED rather than trimmed: they are indented to line up in the
        recipe file, which is noise in a row, but their indentation RELATIVE to each other is the
        structure of a choice-if block, and trimming each line flattened it into a list that no
        longer said which "pick" belonged to which "when".
    */
    static buildDisplayExpression(expressionLines: string[]): string {

        const [firstLine = '', ...continuationLines] = expressionLines;

        const leadingText = firstLine.trim();
        const bodyLines = continuationLines.filter(continuationLine => !!continuationLine.trim());
        // A LOOP RATHER THAN Math.min(...spread), WHICH THROWS PAST THE ENGINE'S ARGUMENT LIMIT ON A LONG ENOUGH VALUE
        const indentWidth = bodyLines.reduce(
            (narrowestIndent, bodyLine) => Math.min(narrowestIndent, bodyLine.length - bodyLine.trimStart().length),
            Number.POSITIVE_INFINITY
        );
        const dedentedLines = bodyLines.map(bodyLine => bodyLine.slice(indentWidth).trimEnd());

        const isBlockIndicatorOnly = !leadingText || /^[|>][-+]?$/.test(leadingText);

        return ( isBlockIndicatorOnly ? dedentedLines : [leadingText, ...dedentedLines] ).join('\n');

    }

    /*
        Every recipe file the run wrote, read for where each object and field sits in it.

        Only regular files inside the WORKSPACE are read: each path found here can become something
        the host opens, so it passes the same containment check the Apex-writing commands apply --
        symlinks resolved -- before it is trusted. One unreadable file costs that file's source
        links and a notice, not the panel.
    */
    static readRecipeSourceFiles(runFolderPath: string, workspaceRoot: string): { recipeSourceFiles: IRecipeSourceFile[]; notices: string[] } {

        const recipeSourceFiles: IRecipeSourceFile[] = [];
        const notices: string[] = [];

        this.collectRecipeFilePaths(runFolderPath)
            .filter(recipeFilePath => SfdxProjectService.isPathContainedInWorkspace(path.resolve(recipeFilePath), path.resolve(workspaceRoot)))
            .forEach(recipeFilePath => {

                try {
                    recipeSourceFiles.push({
                        filePath: recipeFilePath,
                        objectEntries: this.parseRecipeSource(fs.readFileSync(recipeFilePath, 'utf-8'))
                    });
                } catch (readError) {
                    notices.push(`The recipe file "${path.basename(recipeFilePath)}" could not be read (${readError?.message ?? readError}), so its objects and fields cannot be opened from here.`);
                }

            });

        return { recipeSourceFiles: recipeSourceFiles, notices: notices };

    }

    // THE RUN FOLDER AND ITS RELATIONSHIP-TREE SUBFOLDERS, WHICH IS WHERE DirectoryProcessor WRITES EACH RECIPE
    static collectRecipeFilePaths(runFolderPath: string): string[] {

        const isRecipeFile = (fileEntry: fs.Dirent) => (
            fileEntry.isFile() && RECIPE_FILE_EXTENSIONS.includes(path.extname(fileEntry.name).toLowerCase())
        );

        const recipeFilePaths: string[] = [];

        fs.readdirSync(runFolderPath, { withFileTypes: true }).forEach(runFolderEntry => {

            const runFolderEntryPath = path.join(runFolderPath, runFolderEntry.name);

            if ( isRecipeFile(runFolderEntry) ) {
                recipeFilePaths.push(runFolderEntryPath);
                return;
            }

            if ( !runFolderEntry.isDirectory() ) {
                return;
            }

            fs.readdirSync(runFolderEntryPath, { withFileTypes: true })
                .filter(isRecipeFile)
                .forEach(treeFolderEntry => recipeFilePaths.push(path.join(runFolderEntryPath, treeFolderEntry.name)));

        });

        return recipeFilePaths.sort();

    }

    /*
        Where each object and field sits in one recipe file, by line, with the text of each field's
        value.

        This reads the layout both faker backends emit rather than parsing YAML, through the SAME
        scan RecipeCockpitRecipeWriter edits by, so the line the panel jumps to and the line an edit
        changes cannot disagree: "- object: X" at column zero, "  fields:" under it, one field per
        line at exactly four spaces, and every column four spaces deeper for each "friends:" level a
        faker-js recipe nests a child object under (#46). Anything deeper than a field is its
        continuation (a block scalar, a choice-if, a commented TODO). The first occurrence wins, for
        an object and for a field, which is the line a reader jumping to it expects. An object
        written again -- the nested child iteration a self-lookup adds (#188) -- is a second entry
        only when NICKNAMES tell the two apart: then it is kept on the first as an iteration, with
        its own lines, and the map stays keyed by api name for everything that asks about an object.
    */
    static parseRecipeSource(recipeContent: string): Map<string, IRecipeSourceObjectEntry> {

        const objectEntries = new Map<string, IRecipeSourceObjectEntry>();
        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeContent);
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
        const scannedObjectsByHeaderIndex = new Map(scannedObjects.map(scannedObject => [scannedObject.headerIndex, scannedObject]));

        // "<object>\n<nickname>" -> HOW MANY OCCURRENCES OF THAT OBJECT CARRY THAT NICKNAME
        const occurrenceCountsByNicknameKey = new Map<string, number>();
        scannedObjects.forEach(scannedObject => scannedObject.nicknames.forEach(nickname => {
            const nicknameKey = `${scannedObject.objectApiName}\n${nickname}`;
            occurrenceCountsByNicknameKey.set(nicknameKey, (occurrenceCountsByNicknameKey.get(nicknameKey) ?? 0) + 1);
        }));
        const readDistinctNickname = (scannedObject: IScannedObject): string | undefined => (
            scannedObject.nicknames.length === 1 && occurrenceCountsByNicknameKey.get(`${scannedObject.objectApiName}\n${scannedObject.nicknames[0]}`) === 1
                ? scannedObject.nicknames[0]
                : undefined
        );

        scannedObjects.forEach(scannedObject => {

            const firstObjectEntry = objectEntries.get(scannedObject.objectApiName);

            if ( !firstObjectEntry ) {
                const nickname = scannedObject.nicknames.length === 1 ? scannedObject.nicknames[0] : undefined;
                objectEntries.set(scannedObject.objectApiName, {
                    lineNumber: scannedObject.headerIndex + 1,
                    ...( nickname !== undefined ? { nickname: nickname } : {} ),
                    fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines)
                });
                return;
            }

            // A LATER OCCURRENCE IS KEPT ONLY WHEN IT AND THE FIRST EACH CARRY A NICKNAME NO OTHER OCCURRENCE DOES; ANY OTHER IS LEFT TO THE FIRST, AS BEFORE (#188)
            const nickname = readDistinctNickname(scannedObject);
            const firstScannedObject = scannedObjectsByHeaderIndex.get(firstObjectEntry.lineNumber - 1);
            if ( nickname === undefined || readDistinctNickname(firstScannedObject) === undefined ) {
                return;
            }

            const parentScannedObject = scannedObjectsByHeaderIndex.get(scannedObject.parentHeaderIndex);
            firstObjectEntry.iterations = [...(firstObjectEntry.iterations ?? []), {
                nickname: nickname,
                lineNumber: scannedObject.headerIndex + 1,
                ...( parentScannedObject ? { parentObjectApiName: parentScannedObject.objectApiName } : {} ),
                ...( parentScannedObject?.nicknames.length === 1 ? { parentNickname: parentScannedObject.nicknames[0] } : {} ),
                fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines)
            }];

        });

        return objectEntries;

    }

    // THE FIRST OCCURRENCE OF EACH FIELD WINS, WHICH IS THE LINE A READER JUMPING TO IT EXPECTS
    private static readRecipeSourceFieldEntries(scannedObject: IScannedObject, lines: string[]): Map<string, IRecipeSourceFieldEntry> {

        const { fieldIndent } = RecipeCockpitRecipeWriter.getObjectLayout(scannedObject.objectIndent);
        const fieldEntries = new Map<string, IRecipeSourceFieldEntry>();

        scannedObject.fields.forEach(scannedField => {

            if ( fieldEntries.has(scannedField.fieldApiName) ) {
                return;
            }

            const firstLineValue = lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 1);
            const continuationLines = lines.slice(scannedField.startIndex + 1, scannedField.endIndex);

            fieldEntries.set(scannedField.fieldApiName, {
                lineNumber: scannedField.startIndex + 1,
                valueText: this.buildDisplayExpression([firstLineValue, ...continuationLines])
            });

        });

        return fieldEntries;

    }

    /*
        Gives each object the file and line it is written at, each field its line, and adds the
        fields the recipe file carries that the wrapper does not (see isOnlyInRecipeFile).

        Fields are ordered by line so the panel reads in the same order as the file it opens; a
        field the file does not carry keeps its wrapper order after them.
    */
    static attachRecipeSources(objects: IRecipeCockpitObjectViewModel[], recipeSourceFiles: IRecipeSourceFile[]): IRecipeCockpitObjectViewModel[] {

        return objects.map(objectViewModel => {

            const recipeSourceFile = recipeSourceFiles.find(sourceFile => sourceFile.objectEntries.has(objectViewModel.objectApiName));

            if ( !recipeSourceFile ) {
                return objectViewModel;
            }

            const objectEntry = recipeSourceFile.objectEntries.get(objectViewModel.objectApiName);
            const wrapperFieldApiNames = new Set(objectViewModel.fields.map(fieldViewModel => fieldViewModel.fieldApiName));

            const locatedWrapperFields = objectViewModel.fields.map(fieldViewModel => ({
                ...fieldViewModel,
                lineNumber: objectEntry.fieldEntries.get(fieldViewModel.fieldApiName)?.lineNumber
            }));

            const recipeFileOnlyFields: IRecipeCockpitFieldViewModel[] = [];

            objectEntry.fieldEntries.forEach((fieldEntry, fieldApiName) => {

                if ( wrapperFieldApiNames.has(fieldApiName) ) {
                    return;
                }

                recipeFileOnlyFields.push({
                    fieldApiName: fieldApiName,
                    fieldLabel: '',
                    fieldType: '',
                    fieldTypeWithSize: '',
                    recipeValue: fieldEntry.valueText,
                    controllingField: '',
                    isOnlyInRecipeFile: true,
                    lineNumber: fieldEntry.lineNumber
                });

            });

            const locatedFields = [...locatedWrapperFields, ...recipeFileOnlyFields]
                .filter(fieldViewModel => fieldViewModel.lineNumber !== undefined)
                .sort((firstField, secondField) => firstField.lineNumber - secondField.lineNumber);

            const unlocatedFields = locatedWrapperFields.filter(fieldViewModel => fieldViewModel.lineNumber === undefined);

            return {
                ...objectViewModel,
                recipeFilePath: recipeSourceFile.filePath,
                recipeFileName: path.basename(recipeSourceFile.filePath),
                lineNumber: objectEntry.lineNumber,
                fields: [...locatedFields, ...unlocatedFields],
                ...( objectEntry.iterations ? {
                    nickname: objectEntry.nickname,
                    iterations: objectEntry.iterations.map(iteration => ({
                        nickname: iteration.nickname,
                        lineNumber: iteration.lineNumber,
                        ...( iteration.parentObjectApiName !== undefined ? { parentObjectApiName: iteration.parentObjectApiName } : {} ),
                        ...( iteration.parentNickname !== undefined ? { parentNickname: iteration.parentNickname } : {} ),
                        fields: Array.from(iteration.fieldEntries, ([fieldApiName, fieldEntry]) => ({
                            fieldApiName: fieldApiName,
                            lineNumber: fieldEntry.lineNumber,
                            recipeValue: fieldEntry.valueText
                        }))
                    }))
                } : {} )
            };

        });

    }

    static buildContentSecurityPolicy(nonce: string): string {

        return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none';`;

    }

    /*
        From the crypto RNG rather than Math.random. The nonce is what lets the CSP deny every
        script but this extension's own, so it should not depend on there being no injection
        primitive to spend a predicted value on -- that is the property the CSP exists to provide
        independently.
    */
    static buildNonce(): string {

        /*
            48 bytes rather than 24: base64 yields "+", "/" and "=" which are stripped so the value
            is safe unquoted in the CSP header, and 24 bytes can fall short of 32 characters once
            they are removed.
        */
        return crypto.randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

    }

    static buildPaletteCustomPropertyName(paletteToken: RecipeCockpitPaletteToken): string {

        return '--sdt-' + paletteToken.replace(/[A-Z]/g, upperCaseLetter => '-' + upperCaseLetter.toLowerCase());

    }

    static buildPaletteCustomProperties(): string {

        return (Object.keys(RECIPE_COCKPIT_PALETTE) as RecipeCockpitPaletteToken[])
            .map(paletteToken => `        ${this.buildPaletteCustomPropertyName(paletteToken)}: ${RECIPE_COCKPIT_PALETTE[paletteToken]};`)
            .join('\n');

    }

    /*
        The cockpit's document, as a string carrying NO value this extension does not author.

        The template interpolates the nonce and compile-time constants in this file, and nothing
        else. Recipes -- object and field names, faker expressions, file paths -- come from files
        this extension does not control, so none of it is interpolated into html: it arrives over
        postMessage and is written through textContent, which is why this builder needs no escaping
        rather than having escaping that could be forgotten.

        Keeping the SIGNATURE to the nonce is what holds that line in place, because a value from
        outside this file can only reach the template through a parameter. Widening it to take a
        model would quietly re-open the markup context the guarantee rests on.
    */
    static buildWebviewShellHtml(nonce: string): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${this.buildContentSecurityPolicy(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>
<style nonce="${nonce}">
    :root {
${this.buildPaletteCustomProperties()}
        color-scheme: light;
    }
    html, body {
        color: var(--sdt-text);
        background-color: var(--sdt-page);
        scrollbar-color: var(--sdt-border) var(--sdt-page);
    }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background-color: var(--sdt-page); }
    ::-webkit-scrollbar-thumb {
        background-color: var(--sdt-border);
        border: 2px solid var(--sdt-page);
        border-radius: 5px;
    }
    ::-webkit-scrollbar-thumb:hover { background-color: var(--sdt-muted); }
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        padding: 0 1rem 2rem 1rem;
    }
    h1 { font-size: 1.3rem; margin-bottom: 0.25rem; }
    .hidden { display: none !important; }
    .muted { color: var(--sdt-muted); }
    :focus-visible { outline: 2px solid var(--sdt-accent); outline-offset: 1px; }
    .loadStatus {
        border-left: 3px solid var(--sdt-accent);
        padding: 0.4rem 0.6rem;
        margin: 0.75rem 0;
        color: var(--sdt-muted);
        background-color: var(--sdt-surface);
        border-radius: 4px;
    }
    .loadStatus.failed { border-left-color: var(--sdt-removed); color: var(--sdt-removed); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0 0.25rem 0; }
    .toolbar input, .toolbar select {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .toolbar input {
        flex: 1 1 16rem;
        min-width: 0;
        padding: 0.3rem 0.5rem;
    }
    .toolbar input::placeholder { color: var(--sdt-muted); opacity: 1; }
    .toolbar select { padding: 0.3rem; }
    .toolbar button, .regenerate button {
        padding: 0.3rem 0.6rem;
        color: var(--sdt-on-accent);
        background-color: var(--sdt-accent);
        border: 1px solid var(--sdt-accent);
        border-radius: 4px;
        cursor: pointer;
    }
    .toolbar button:disabled, .regenerate button:disabled { opacity: 0.6; cursor: default; }
    .matchCount { margin-bottom: 0.75rem; }
    .orgStatus {
        border-left: 3px solid var(--sdt-accent);
        padding: 0.3rem 0.6rem;
        margin: 0.4rem 0 0.75rem 0;
        background-color: var(--sdt-surface);
        border-radius: 4px;
    }
    .orgStatus.failed { border-left-color: var(--sdt-removed); }
    .orgDescribeFailure { color: var(--sdt-muted); }
    .notice {
        border-left: 3px solid var(--sdt-changed);
        padding: 0.3rem 0.6rem;
        margin: 0.4rem 0;
        background-color: var(--sdt-surface);
        border-radius: 4px;
    }
    .emptyState {
        border: 1px dashed var(--sdt-border);
        background-color: var(--sdt-surface);
        border-radius: 8px;
        padding: 0.6rem 0.8rem;
        margin-top: 0.75rem;
    }
    .object {
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08);
        margin: 0.5rem 0;
        overflow: hidden;
    }
    .objectHeader, .fieldHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .objectHeader { padding: 0.4rem 0.6rem; background-color: var(--sdt-header); }
    .objectHeader:hover, .field:hover { background-color: var(--sdt-row-hover); }
    .objectName { font-weight: 600; }
    .toggle, .sourceLink {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
    }
    .toggle { color: var(--sdt-accent); border-radius: 4px; }
    .toggle:focus-visible, .sourceLink:focus-visible { outline-offset: -1px; }
    .sourceLink { color: var(--sdt-accent); text-align: left; }
    .sourceLink:hover { text-decoration: underline; }
    .objectBody { padding: 0.25rem 0 0.25rem 0; border-top: 1px solid var(--sdt-border); }
    .field { padding: 0.3rem 0.6rem 0.3rem 2.1rem; }
    .fieldHeader .fieldType {
        font-size: 0.85em;
        padding: 0 0.4rem;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 0.6rem;
    }
    .orgProgress { margin: 0.4rem 0; }
    .diffSummary { margin-top: 0.2rem; }
    .regenerate { margin-top: 0.4rem; }
    .regenerateNote { margin-top: 0.25rem; }
    .diffBadge {
        font-size: 0.85em;
        padding: 0 0.35rem;
        border: 1px solid currentColor;
        border-radius: 0.6rem;
    }
    .diff-new-in-org { color: var(--sdt-added); }
    .diff-removed-from-org { color: var(--sdt-removed); }
    .diff-type-changed { color: var(--sdt-changed); }
    .diff-picklist-changed { color: var(--sdt-changed); }
    .diff-unchanged { color: var(--sdt-muted); }
    .diffDetail { margin: 0.15rem 0 0 0; color: var(--sdt-muted); word-break: break-word; }
    .toolbar .viewButton {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border-color: var(--sdt-border);
    }
    .toolbar .viewButton.selected {
        color: var(--sdt-on-accent);
        background-color: var(--sdt-accent);
        border-color: var(--sdt-accent);
    }
    .classicControls { display: contents; }
    .treeScopeStatus {
        border-left: 3px solid var(--sdt-accent);
        padding: 0.3rem 0.6rem;
        margin: 0.4rem 0;
        background-color: var(--sdt-surface);
        border-radius: 4px;
    }
    .treeCard {
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08);
        margin: 0.6rem 0;
        overflow: hidden;
    }
    .treeHeader, .treeObjectHeader, .treeFieldHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .treeHeader { padding: 0.5rem 0.6rem; background-color: var(--sdt-header); }
    .treeTitle { font-weight: 600; }
    .treeToggle, .treeObjectToggle, .picklistToggle, .treeScope, .treeRunFaker, .treeScopeClear, .treeTab, .treeVersionToggle, .historyAction {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--sdt-accent);
        cursor: pointer;
        border-radius: 4px;
    }
    .treeScope { margin-left: auto; padding: 0 0.3rem; }
    .treeRunFaker { padding: 0 0.3rem; }
    .treeRunFaker:disabled { opacity: 0.6; cursor: default; }
    .treeScope.selected { outline: 1px solid var(--sdt-accent); }
    .treeBody { border-top: 1px solid var(--sdt-border); }
    .treeTabs { display: flex; gap: 0.75rem; padding: 0.3rem 0.6rem 0 0.6rem; border-bottom: 1px solid var(--sdt-border); }
    .treeTab { color: var(--sdt-muted); padding: 0.2rem 0; border-bottom: 2px solid transparent; }
    .treeTab.selected { color: var(--sdt-text); border-bottom-color: var(--sdt-accent); font-weight: 600; }
    .treeObjectHeader { padding: 0.35rem 0.6rem; }
    .treeObjectHeader:hover, .treeField:hover { background-color: var(--sdt-row-hover); }
    .treeObjectName { font-weight: 600; }
    .treeObjectBody { padding-bottom: 0.25rem; }
    .treeField { padding: 0.25rem 0.6rem 0.25rem 2.1rem; }
    .treeFieldHeader .fieldType {
        font-size: 0.85em;
        padding: 0 0.4rem;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 0.6rem;
    }
    .treeVersionHeader, .treeDatasetHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .treeVersion, .treeDataset { padding: 0.3rem 0.6rem; }
    .treeVersion:hover, .treeDataset:hover { background-color: var(--sdt-row-hover); }
    .treeVersionDate, .treeDatasetDate { font-weight: 600; }
    .treeVersionCurrent {
        font-size: 0.85em;
        padding: 0 0.4rem;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 0.6rem;
    }
    .treeVersionBody { padding-left: 1.4rem; }
    .treeDatasetCounts { margin: 0.1rem 0 0 0; word-break: break-word; }
    .historyAction { text-decoration: underline; }
    .dataOrgControls { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; margin: 0.5rem 0; }
    .dataOrgSelect {
        padding: 0.3rem;
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .dataOrgType {
        font-size: 0.85em;
        padding: 0 0.4rem;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 0.6rem;
    }
    .dataOrgRefresh, .dataTreeToggle {
        background: none;
        border: none;
        padding: 0 0.3rem;
        font: inherit;
        color: var(--sdt-accent);
        cursor: pointer;
        border-radius: 4px;
    }
    .dataOrgStatus { margin: 0.4rem 0; }
    .dataOrgStatus.failed { color: var(--sdt-removed); }
    .dataTreeCard {
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08);
        margin: 0.6rem 0;
        overflow: hidden;
    }
    .dataTreeHeader, .dataObjectHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .dataTreeHeader { padding: 0.5rem 0.6rem; background-color: var(--sdt-header); }
    .dataTreeTitle, .dataObjectName { font-weight: 600; }
    .dataTreeBody { border-top: 1px solid var(--sdt-border); }
    .dataObject { padding: 0.3rem 0.6rem 0.3rem 2.1rem; }
    .dataObject:hover { background-color: var(--sdt-row-hover); }
    .picklistValues { margin: 0.2rem 0 0 1.4rem; }
    .recordTypeHeading { margin-top: 0.3rem; font-weight: 600; }
    .picklistValue { padding-left: 0.6rem; word-break: break-word; }
    .expression {
        margin: 0.15rem 0 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-muted);
    }
</style>
</head>
<body>
<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>
<div id="loadStatus" class="loadStatus">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>
<div id="cockpitBody"></div>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const loadStatusElement = document.getElementById('loadStatus');
    const cockpitBodyElement = document.getElementById('cockpitBody');
    const AUTO_EXPAND_OBJECT_LIMIT = ${RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT};
    const AUTO_EXPAND_ROW_BUDGET = ${RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET};
    const DIFF_STATUSES = ${JSON.stringify(METADATA_DIFF_FIELD_STATUSES)};
    const DIFF_STATUS_LABELS = ${JSON.stringify(RECIPE_COCKPIT_DIFF_STATUS_LABELS)};
    const DIFF_PICKLIST_VALUES_SHOWN = ${RECIPE_COCKPIT_DIFF_PICKLIST_VALUES_SHOWN};
    const REGENERATE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_REGENERATE_ACTION_LABEL)};
    const REGENERATE_NOTE = ${JSON.stringify(RECIPE_COCKPIT_REGENERATE_NOTE)};
    const RUN_FAKER_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL)};
    const RUN_FAKER_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL)};

    let objectStates = [];
    // WHICH VIEW IS ON SCREEN OUTLIVES A MODEL, SO SWITCHING RUNS DOES NOT THROW THE READER BACK TO THE DEFAULT
    let viewMode = 'trees';
    let treeStates = [];
    let treeScopeKey = null;
    let treesViewElement = null;
    let classicViewElement = null;
    let classicControlsElement = null;
    let treeMatchCountElement = null;
    let treeScopeStatusElement = null;
    let viewButtonStates = [];
    let filterQuery = '';
    let statusFilter = 'all';
    let matchCountElement = null;
    let runSelectElement = null;
    let statusFilterElement = null;
    let orgStatusElement = null;
    let orgProgressElement = null;
    let renderedRunFolderName = '';
    let renderedSequence = null;
    // THE TREE WHOSE RUN FAKER IS RUNNING; IT OUTLIVES A MODEL, BECAUSE THE HOST RELOADS THE RUN BEFORE IT SAYS THE RUN ENDED
    let runFakerRunningTreeKey = null;
    let filterInputElement = null;
    let dataOrgViewElement = null;
    let dataOrgSelectElement = null;
    let dataOrgTypeElement = null;
    let dataOrgRefreshElement = null;
    let dataOrgStatusElement = null;
    let dataTreeStates = [];
    // THE renderSequence DATA-BY-ORG ASKED FOR ITS ORGS UNDER -- ONE ASK PER MODEL, MADE WHEN THE VIEW IS FIRST SHOWN
    let dataOrgRequestedSequence = null;
    // THE LATEST SELECTION THE HOST NAMED; COUNTS FOR ANY OTHER ARE A DIFFERENT ORG'S, OR AN OLDER ASK OF THIS ONE
    let dataOrgRequestSequence = null;
    // KEYED BY OBJECT NAMES FROM FILES, SO NO PROTOTYPE
    let dataOrgCountsByObject = Object.create(null);

    /*
        Every node the panel draws is made here and filled through textContent, so nothing from the
        model is ever parsed as markup: object names, field names and faker expressions all come
        from files this extension does not control.
    */
    function createElement(tagName, className, textContent) {

        const element = document.createElement(tagName);
        if (className) { element.className = className; }
        if (textContent !== undefined) { element.textContent = textContent; }
        return element;

    }

    function setLoadStatus(statusMessage, isFailure) {

        if (!statusMessage) {
            loadStatusElement.classList.add('hidden');
            return;
        }

        loadStatusElement.textContent = statusMessage;
        loadStatusElement.classList.remove('hidden');

        if (isFailure) {
            loadStatusElement.classList.add('failed');
        } else {
            loadStatusElement.classList.remove('failed');
        }

    }

    function pluralize(count, singular, plural) {
        return count + ' ' + (count === 1 ? singular : plural);
    }

    function buildSourceLink(className, labelText, filePath, lineNumber) {

        if (!filePath || !lineNumber) {
            return createElement('span', className, labelText);
        }

        const sourceLinkElement = createElement('button', className + ' sourceLink', labelText);
        sourceLinkElement.setAttribute('title', 'Open in the recipe file');
        sourceLinkElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'openSource', filePath: filePath, lineNumber: lineNumber });
        });

        return sourceLinkElement;

    }

    function buildFieldRow(objectState, fieldState) {

        const field = fieldState.field;
        const fieldRowElement = createElement('div', 'field');
        const fieldHeaderElement = createElement('div', 'fieldHeader');

        fieldHeaderElement.appendChild(buildSourceLink('fieldName', field.fieldApiName, objectState.object.recipeFilePath, field.lineNumber));

        if (field.fieldType) {
            fieldHeaderElement.appendChild(createElement('span', 'fieldType muted', field.fieldType));
        }

        if (field.controllingField) {
            fieldHeaderElement.appendChild(createElement('span', 'controllingField muted', '← controlled by ' + field.controllingField));
        }

        if (field.isOnlyInRecipeFile) {
            fieldHeaderElement.appendChild(createElement('span', 'recipeFileOnly muted', 'read from the recipe file'));
        }

        if (fieldState.diffStatus) {
            fieldHeaderElement.appendChild(createElement('span', 'diffBadge diff-' + fieldState.diffStatus, DIFF_STATUS_LABELS[fieldState.diffStatus]));
        }

        fieldRowElement.appendChild(fieldHeaderElement);

        appendDiffDetail(fieldRowElement, fieldState.diff);

        if (field.recipeValue) {
            fieldRowElement.appendChild(createElement('pre', 'expression', field.recipeValue));
        }

        return fieldRowElement;

    }

    function listValues(values) {

        const shownValues = values.slice(0, DIFF_PICKLIST_VALUES_SHOWN);
        const hiddenCount = values.length - shownValues.length;

        return shownValues.join(', ') + (hiddenCount > 0 ? ' and ' + hiddenCount + ' more' : '');

    }

    // WHAT A BADGE CANNOT SAY ON ITS OWN: WHICH TYPES, AND WHICH VALUES
    function appendDiffDetail(fieldRowElement, fieldDiff) {

        if (!fieldDiff) { return; }

        if (fieldDiff.status === 'type-changed') {
            fieldRowElement.appendChild(createElement('div', 'diffDetail', 'recipe: ' + fieldDiff.recipeFieldType + ' · org: ' + fieldDiff.orgFieldType));
        }

        if (fieldDiff.addedPicklistValues.length > 0) {
            fieldRowElement.appendChild(createElement('div', 'diffDetail',
                pluralize(fieldDiff.addedPicklistValues.length, 'value', 'values') + ' active in the org and not in the recipe: ' + listValues(fieldDiff.addedPicklistValues)));
        }

        if (fieldDiff.removedPicklistValues.length > 0) {
            fieldRowElement.appendChild(createElement('div', 'diffDetail',
                pluralize(fieldDiff.removedPicklistValues.length, 'value', 'values') + ' in the recipe and not active in the org: ' + listValues(fieldDiff.removedPicklistValues)));
        }

    }

    // ROWS ARE BUILT ON FIRST EXPAND, SO A COLLAPSED OBJECT COSTS ITS HEADER AND NOTHING ELSE
    function ensureObjectBodyBuilt(objectState) {

        if (objectState.isBodyBuilt) { return; }

        objectState.fieldStates.forEach(function (fieldState) {
            fieldState.rowElement = buildFieldRow(objectState, fieldState);
            applyFieldVisibility(fieldState);
            objectState.bodyElement.appendChild(fieldState.rowElement);
        });

        objectState.isBodyBuilt = true;

    }

    function applyFieldVisibility(fieldState) {

        if (!fieldState.rowElement) { return; }

        if (fieldState.isMatch) {
            fieldState.rowElement.classList.remove('hidden');
        } else {
            fieldState.rowElement.classList.add('hidden');
        }

    }

    function setObjectExpanded(objectState, isExpanded) {

        if (isExpanded) {
            ensureObjectBodyBuilt(objectState);
            objectState.bodyElement.classList.remove('hidden');
        } else {
            objectState.bodyElement.classList.add('hidden');
        }

        objectState.isExpanded = isExpanded;
        objectState.toggleElement.textContent = isExpanded ? '▾' : '▸';
        objectState.toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

    }

    /*
        A row of an object that was not compared has no status, so it matches no status filter:
        a row that says nothing about the org is not one the reader asked to see by its status.
    */
    function isStatusMatch(fieldState) {

        if (statusFilter === 'all') { return true; }
        if (statusFilter === 'changed') { return !!fieldState.diffStatus && fieldState.diffStatus !== 'unchanged'; }

        return fieldState.diffStatus === statusFilter;

    }

    /*
        Narrows fields live, and never hides an OBJECT.

        An object whose name matches keeps all its fields; otherwise only the fields whose name,
        label, type, controlling field or faker expression match are shown. The status filter
        narrows either way. An object with no match stays on screen, collapsed and labelled,
        because hiding it would make a filter look like a truncation -- the reader could not tell
        "not in the recipe" from "filtered away".
    */
    function applyFilter() {

        const isFiltering = !!filterQuery || statusFilter !== 'all';

        let totalFieldCount = 0;
        let matchingFieldCount = 0;
        let matchingObjectCount = 0;
        let autoExpandedObjectCount = 0;
        let autoExpandedRowCount = 0;
        let isAutoExpandBudgetSpent = false;

        objectStates.forEach(function (objectState) {

            const isObjectNameMatch = !filterQuery || objectState.objectSearchText.indexOf(filterQuery) !== -1;
            let objectMatchingFieldCount = 0;

            objectState.fieldStates.forEach(function (fieldState) {
                fieldState.isMatch = (isObjectNameMatch || isFieldTextMatch(fieldState)) && isStatusMatch(fieldState);
                if (fieldState.isMatch) { objectMatchingFieldCount++; }
                applyFieldVisibility(fieldState);
            });

            const objectFieldCount = objectState.fieldStates.length;
            totalFieldCount += objectFieldCount;
            matchingFieldCount += objectMatchingFieldCount;

            // AN EMPTY FIND BOX "MATCHES" EVERY NAME, SO UNDER A STATUS FILTER ONLY A MATCHING ROW MAKES A MATCHING OBJECT
            const isObjectMatch = (isObjectNameMatch && statusFilter === 'all') || objectMatchingFieldCount > 0;
            if (isObjectMatch) { matchingObjectCount++; }

            if (!isFiltering || (isObjectNameMatch && statusFilter === 'all')) {
                objectState.countElement.textContent = pluralize(objectFieldCount, 'field', 'fields');
            } else if (objectMatchingFieldCount > 0) {
                objectState.countElement.textContent = objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields');
            } else {
                objectState.countElement.textContent = 'no matching fields';
            }

            // A CLEARED FILTER GIVES BACK WHAT THE READER HAD OPENED, RATHER THAN CLOSING IT ON THEM
            if (!isFiltering) {
                setObjectExpanded(objectState, objectState.isExpandedByReader);
                return;
            }

            if (objectMatchingFieldCount === 0 || isAutoExpandBudgetSpent) {
                setObjectExpanded(objectState, false);
                return;
            }

            const fitsRowBudget = autoExpandedObjectCount === 0 || autoExpandedRowCount + objectFieldCount <= AUTO_EXPAND_ROW_BUDGET;

            if (autoExpandedObjectCount >= AUTO_EXPAND_OBJECT_LIMIT || !fitsRowBudget) {
                isAutoExpandBudgetSpent = true;
                setObjectExpanded(objectState, false);
                return;
            }

            autoExpandedObjectCount++;
            autoExpandedRowCount += objectFieldCount;
            setObjectExpanded(objectState, true);

        });

        if (!matchCountElement) { return; }

        matchCountElement.textContent = isFiltering
            ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') + ' · ' + matchingObjectCount + ' of ' + pluralize(objectStates.length, 'object', 'objects')
            : pluralize(totalFieldCount, 'field', 'fields') + ' · ' + pluralize(objectStates.length, 'object', 'objects');

    }

    function renderToolbar(recipe, hasObjects) {

        const toolbarElement = createElement('div', 'toolbar');

        if (hasObjects) {

            [['trees', 'Recipe Trees'], ['org', 'Data-by-Org'], ['classic', 'Classic list']].forEach(function (viewOption) {
                const viewButtonElement = createElement('button', 'viewButton', viewOption[1]);
                viewButtonElement.addEventListener('click', function () { setViewMode(viewOption[0]); });
                viewButtonStates.push({ viewMode: viewOption[0], element: viewButtonElement });
                toolbarElement.appendChild(viewButtonElement);
            });

            filterInputElement = createElement('input', 'filterInput');
            filterInputElement.setAttribute('type', 'search');
            filterInputElement.setAttribute('placeholder', 'Filter objects, fields and faker expressions');
            filterInputElement.setAttribute('aria-label', 'Filter objects, fields and faker expressions');
            filterInputElement.value = filterQuery;
            filterInputElement.addEventListener('input', function () {
                filterQuery = String(filterInputElement.value || '').trim().toLowerCase();
                applyFiltersForView();
            });
            toolbarElement.appendChild(filterInputElement);

        }

        if (recipe.runs.length > 0) {

            runSelectElement = createElement('select', 'runSelect');
            runSelectElement.setAttribute('aria-label', 'Generated recipe run');

            recipe.runs.forEach(function (run) {
                const runOptionElement = createElement('option', '', run.label);
                runOptionElement.value = run.runFolderName;
                runOptionElement.selected = run.runFolderName === recipe.selectedRunFolderName;
                runSelectElement.appendChild(runOptionElement);
            });

            runSelectElement.value = recipe.selectedRunFolderName;
            runSelectElement.addEventListener('change', function () {
                vscodeApi.postMessage({ command: 'selectRun', runFolderName: runSelectElement.value });
            });
            toolbarElement.appendChild(runSelectElement);

        }

        // THE COMPARISON'S CONTROLS BELONG TO THE CLASSIC LIST, AND ARE ON SCREEN ONLY WITH IT
        classicControlsElement = createElement('span', 'classicControls');
        toolbarElement.appendChild(classicControlsElement);

        // SHOWN ONCE A COMPARISON IS DRAWN -- BEFORE THAT NO ROW HAS A STATUS TO FILTER BY
        if (hasObjects) {

            statusFilterElement = createElement('select', 'statusFilter hidden');
            statusFilterElement.setAttribute('aria-label', 'Show fields by their comparison with the org');

            [['all', 'All fields'], ['changed', 'Changed fields only']].concat(DIFF_STATUSES.map(function (diffStatus) {
                return [diffStatus, 'Only ' + DIFF_STATUS_LABELS[diffStatus]];
            })).forEach(function (statusOption) {
                const statusOptionElement = createElement('option', '', statusOption[1]);
                statusOptionElement.value = statusOption[0];
                statusFilterElement.appendChild(statusOptionElement);
            });

            statusFilterElement.value = statusFilter;
            statusFilterElement.addEventListener('change', function () {
                statusFilter = String(statusFilterElement.value || 'all');
                applyFilter();
            });
            classicControlsElement.appendChild(statusFilterElement);

        }

        // THE PANEL ASKS ONLY FOR "A DESCRIBE" -- WHICH OBJECTS, AND IN WHICH ORG, THE HOST DECIDES
        if (hasObjects) {
            const describeButtonElement = createElement('button', 'describeInOrg', '${RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL}');
            describeButtonElement.setAttribute('title', 'Choose an authorized org, describe the objects of this recipe in it, and mark each field with how it compares');
            describeButtonElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'selectOrg' });
            });
            classicControlsElement.appendChild(describeButtonElement);
        }

        cockpitBodyElement.appendChild(toolbarElement);

        if (hasObjects) {
            matchCountElement = createElement('div', 'matchCount muted');
            classicViewElement.appendChild(matchCountElement);
            orgProgressElement = createElement('div', 'orgProgress muted hidden');
            classicViewElement.appendChild(orgProgressElement);
            orgStatusElement = createElement('div', 'orgStatus hidden');
            classicViewElement.appendChild(orgStatusElement);
        }

    }

    /*
        One lowercased haystack per FIELD, shared by the Classic list and the Structure tab: both
        draw the same posted field, and the faker expression that dominates it would otherwise be
        held in the webview twice. The type is matched separately, because each view draws its own
        (the bare type, or the type with its size), and a match has to be on screen.
    */
    let fieldSearchTexts = new Map();

    function searchTextOf(field) {

        let fieldSearchText = fieldSearchTexts.get(field);

        if (fieldSearchText === undefined) {
            fieldSearchText = [field.fieldApiName, field.fieldLabel, field.controllingField, field.recipeValue].join('\\n').toLowerCase();
            fieldSearchTexts.set(field, fieldSearchText);
        }

        return fieldSearchText;

    }

    function isFieldTextMatch(fieldState) {
        return searchTextOf(fieldState.field).indexOf(filterQuery) !== -1 || fieldState.typeSearchText.indexOf(filterQuery) !== -1;
    }

    function buildFieldState(field, fieldDiff, diffStatus) {

        return {
            field: field,
            typeSearchText: String(field.fieldType || '').toLowerCase(),
            isMatch: true,
            rowElement: null,
            diff: fieldDiff,
            diffStatus: diffStatus
        };

    }

    function renderObject(object) {

        const objectElement = createElement('div', 'object');
        const objectHeaderElement = createElement('div', 'objectHeader');
        const toggleElement = createElement('button', 'toggle', '▸');
        const bodyElement = createElement('div', 'objectBody hidden');

        const objectState = {
            object: object,
            objectSearchText: object.objectApiName.toLowerCase(),
            fieldStates: object.fields.map(function (field) { return buildFieldState(field, null, null); }),
            isBodyBuilt: false,
            isExpanded: false,
            isExpandedByReader: false,
            toggleElement: toggleElement,
            bodyElement: bodyElement,
            countElement: createElement('span', 'objectCount muted'),
            orgDescribeElement: createElement('span', 'orgDescribeStatus muted hidden'),
            diffElement: createElement('span', 'objectDiff hidden')
        };

        toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
        toggleElement.addEventListener('click', function () {
            objectState.isExpandedByReader = !objectState.isExpanded;
            setObjectExpanded(objectState, objectState.isExpandedByReader);
        });

        objectHeaderElement.appendChild(toggleElement);
        objectHeaderElement.appendChild(buildSourceLink('objectName', object.objectApiName, object.recipeFilePath, object.lineNumber));

        if (object.recipeFileName) {
            objectHeaderElement.appendChild(createElement('span', 'recipeFileName muted', object.recipeFileName));
        }

        objectHeaderElement.appendChild(objectState.countElement);
        objectHeaderElement.appendChild(objectState.orgDescribeElement);
        objectHeaderElement.appendChild(objectState.diffElement);

        objectElement.appendChild(objectHeaderElement);
        objectElement.appendChild(bodyElement);
        classicViewElement.appendChild(objectElement);

        objectStates.push(objectState);

    }

    /*
        A keystroke filters the view on SCREEN. Each view's auto-expand builds rows, and building
        them into the hidden view would double what a keystroke costs for rows nobody sees; the
        hidden view is filtered when it is switched to. With an empty find box nothing is
        auto-expanded, so both are brought back to what the reader had open, and their counts filled.
    */
    function applyFiltersForView() {

        if (viewMode === 'classic' || !filterQuery) { applyFilter(); }
        if (viewMode === 'trees' || !filterQuery) { applyTreeFilter(); }

    }

    function setViewMode(nextViewMode) {

        const isSwitching = nextViewMode !== viewMode;
        viewMode = nextViewMode === 'classic' || nextViewMode === 'org' ? nextViewMode : 'trees';

        if (isSwitching && filterQuery) {
            if (viewMode === 'classic') { applyFilter(); }
            if (viewMode === 'trees') { applyTreeFilter(); }
        }

        // THE FIND BOX SEARCHES RECIPES, AND DATA-BY-ORG LISTS NO FIELDS FOR IT TO FIND
        if (treesViewElement && classicViewElement && classicControlsElement && dataOrgViewElement) {
            [[treesViewElement, viewMode === 'trees'], [classicViewElement, viewMode === 'classic'], [classicControlsElement, viewMode === 'classic'], [dataOrgViewElement, viewMode === 'org'], [filterInputElement, viewMode !== 'org']].forEach(function (viewPart) {
                if (!viewPart[0]) { return; }
                if (viewPart[1]) { viewPart[0].classList.remove('hidden'); } else { viewPart[0].classList.add('hidden'); }
            });
        }

        // AFTER THE MODEL'S "rendered" -- A CLICK CAN ONLY COME FROM A DRAWN PANEL, AND renderPanelGuarded ASKS FOR A FRESH DRAW ITSELF
        if (viewMode === 'org' && renderedSequence !== null) { requestDataOrgs(); }

        viewButtonStates.forEach(function (viewButtonState) {
            const isSelected = viewButtonState.viewMode === viewMode;
            viewButtonState.element.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
            if (isSelected) { viewButtonState.element.classList.add('selected'); } else { viewButtonState.element.classList.remove('selected'); }
        });

    }

    // ROWS WHOSE VALUES WERE ASKED FOR AND NOT YET ANSWERED, BY OBJECT AND FIELD -- KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
    let pendingPicklistValueElements = Object.create(null);

    // DATA SET COUNT ROWS WAITING ON THE HOST, AND THE ANSWERS ALREADY HAD -- KEYED BY FOLDER NAMES FROM DISK, SO NO PROTOTYPE
    let pendingDatasetCountElements = Object.create(null);
    let answeredDatasetCounts = Object.create(null);

    // A SELF-LOOKUP NAMES ONLY ITS FIELD: "(ParentId)" SAYS WHAT "(ParentId → Account)" SAYS ON Account, WITHOUT THE REPEAT
    function formatParentLookups(treeObject) {

        if (!treeObject.parentLookups || treeObject.parentLookups.length === 0) { return ''; }

        return '(' + treeObject.parentLookups.map(function (parentLookup) {
            return parentLookup.parentObjectApiName === treeObject.objectApiName
                ? parentLookup.fieldApiName
                : parentLookup.fieldApiName + ' → ' + parentLookup.parentObjectApiName;
        }).join(', ') + ')';

    }

    function buildTreeFieldState(field) {

        return {
            field: field,
            typeSearchText: String(field.fieldTypeWithSize || field.fieldType || '').toLowerCase(),
            isMatch: true,
            rowElement: null
        };

    }

    function appendPicklistValueList(containerElement, picklistValues) {

        if (picklistValues.length === 0) {
            containerElement.appendChild(createElement('div', 'picklistEmpty muted', 'no values'));
            return;
        }

        picklistValues.forEach(function (picklistValue) {
            containerElement.appendChild(createElement('div', 'picklistValue', picklistValue));
        });

    }

    function buildPicklistKey(objectApiName, fieldApiName) {
        return objectApiName + '\\n' + fieldApiName;
    }

    // ASKED FOR ON FIRST EXPAND, AND SAYS SO UNTIL THE HOST ANSWERS
    function requestPicklistValues(objectApiName, fieldApiName, picklistValuesElement) {

        picklistValuesElement.appendChild(createElement('div', 'picklistLoading muted', 'Loading values…'));
        const picklistKey = buildPicklistKey(objectApiName, fieldApiName);

        // A HAND-EDITED WRAPPER CAN REPEAT A FIELD, AND EVERY ROW THAT ASKED IS ANSWERED, NOT ONLY THE LAST
        if (!Object.prototype.hasOwnProperty.call(pendingPicklistValueElements, picklistKey)) {
            pendingPicklistValueElements[picklistKey] = [];
        }
        pendingPicklistValueElements[picklistKey].push(picklistValuesElement);
        vscodeApi.postMessage({ command: 'loadPicklistValues', objectApiName: objectApiName, fieldApiName: fieldApiName });

    }

    // DRAWN ONLY INTO A ROW OF THE MODEL ON SCREEN THAT ASKED FOR IT
    function renderPicklistValues(picklistValuesMessage) {

        if (picklistValuesMessage.renderSequence !== renderedSequence) { return; }

        const picklistKey = buildPicklistKey(picklistValuesMessage.objectApiName, picklistValuesMessage.fieldApiName);

        if (!Object.prototype.hasOwnProperty.call(pendingPicklistValueElements, picklistKey)) { return; }

        const picklistValuesElements = pendingPicklistValueElements[picklistKey];
        delete pendingPicklistValueElements[picklistKey];

        picklistValuesElements.forEach(function (picklistValuesElement) {

            picklistValuesElement.textContent = '';
            appendPicklistValueList(picklistValuesElement, picklistValuesMessage.picklistValues);

            picklistValuesMessage.recordTypePicklistValues.forEach(function (recordTypeSection) {
                picklistValuesElement.appendChild(createElement('div', 'recordTypeHeading', 'Record type: ' + recordTypeSection.recordTypeDeveloperName));
                appendPicklistValueList(picklistValuesElement, recordTypeSection.picklistValues);
            });

        });

    }

    function buildTreeFieldRow(treeObjectState, fieldState) {

        const field = fieldState.field;
        const fieldRowElement = createElement('div', 'treeField');
        const fieldHeaderElement = createElement('div', 'treeFieldHeader');

        if (field.isPicklist) {

            const picklistToggleElement = createElement('button', 'picklistToggle', '▸');
            let picklistValuesElement = null;

            picklistToggleElement.setAttribute('aria-expanded', 'false');
            picklistToggleElement.setAttribute('aria-label', 'Show or hide the values of ' + field.fieldApiName);
            picklistToggleElement.addEventListener('click', function () {
                const isExpanding = !picklistValuesElement || picklistValuesElement.classList.contains('hidden');
                if (!picklistValuesElement) {
                    picklistValuesElement = createElement('div', 'picklistValues');
                    fieldRowElement.appendChild(picklistValuesElement);
                    requestPicklistValues(treeObjectState.object.objectApiName, field.fieldApiName, picklistValuesElement);
                }
                if (isExpanding) { picklistValuesElement.classList.remove('hidden'); } else { picklistValuesElement.classList.add('hidden'); }
                picklistToggleElement.textContent = isExpanding ? '▾' : '▸';
                picklistToggleElement.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
            });

            fieldHeaderElement.appendChild(picklistToggleElement);

        }

        fieldHeaderElement.appendChild(createElement('span', 'treeFieldName', field.fieldApiName));

        if (field.fieldTypeWithSize || field.fieldType) {
            fieldHeaderElement.appendChild(createElement('span', 'fieldType', field.fieldTypeWithSize || field.fieldType));
        }

        if (field.controllingField) {
            fieldHeaderElement.appendChild(createElement('span', 'controllingField muted', 'controlled by ' + field.controllingField));
        }

        if (field.isOnlyInRecipeFile) {
            fieldHeaderElement.appendChild(createElement('span', 'recipeFileOnly muted', 'read from the recipe file'));
        }

        if (treeObjectState.object.recipeFilePath && field.lineNumber) {
            fieldHeaderElement.appendChild(buildSourceLink('treeFieldSource', '↗ yml', treeObjectState.object.recipeFilePath, field.lineNumber));
        }

        fieldRowElement.appendChild(fieldHeaderElement);

        return fieldRowElement;

    }

    function applyTreeFieldVisibility(fieldState) {

        if (!fieldState.rowElement) { return; }

        if (fieldState.isMatch) {
            fieldState.rowElement.classList.remove('hidden');
        } else {
            fieldState.rowElement.classList.add('hidden');
        }

    }

    function setTreeObjectExpanded(treeObjectState, isExpanded) {

        if (isExpanded && !treeObjectState.isBodyBuilt) {
            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.rowElement = buildTreeFieldRow(treeObjectState, fieldState);
                applyTreeFieldVisibility(fieldState);
                treeObjectState.bodyElement.appendChild(fieldState.rowElement);
            });
            treeObjectState.isBodyBuilt = true;
        }

        if (isExpanded) { treeObjectState.bodyElement.classList.remove('hidden'); } else { treeObjectState.bodyElement.classList.add('hidden'); }

        treeObjectState.isExpanded = isExpanded;
        treeObjectState.toggleElement.textContent = isExpanded ? '▾' : '▸';
        treeObjectState.toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

    }

    /*
        An object's header is made with its tree, because the filter writes its count whether or
        not the card is open; its ROWS wait for the object's own first expand.
    */
    function buildTreeObjectState(treeObject, object) {

        const objectElement = createElement('div', 'treeObject');
        const objectHeaderElement = createElement('div', 'treeObjectHeader');
        const toggleElement = createElement('button', 'treeObjectToggle', '▸');

        const treeObjectState = {
            treeObject: treeObject,
            object: object,
            isIteration: !!object.iteration,
            objectSearchText: [object.objectApiName, object.nickname || ''].join(' ').toLowerCase(),
            fieldStates: object.fields.map(buildTreeFieldState),
            matchingFieldCount: object.fields.length,
            isBodyBuilt: false,
            isExpanded: false,
            isExpandedByReader: false,
            element: objectElement,
            toggleElement: toggleElement,
            bodyElement: createElement('div', 'treeObjectBody hidden'),
            countElement: createElement('span', 'treeObjectCount muted')
        };

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
        toggleElement.addEventListener('click', function () {
            treeObjectState.isExpandedByReader = !treeObjectState.isExpanded;
            setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader);
        });

        objectHeaderElement.appendChild(toggleElement);
        objectHeaderElement.appendChild(buildSourceLink('treeObjectName', object.objectApiName, object.recipeFilePath, object.lineNumber));

        const parentLookupText = formatParentLookups(treeObject);
        if (parentLookupText) {
            objectHeaderElement.appendChild(createElement('span', 'treeLookups muted', parentLookupText));
        }

        if (object.iteration) {
            const parentName = object.iteration.parentNickname || object.iteration.parentObjectApiName;
            objectHeaderElement.appendChild(createElement('span', 'treeIteration muted', object.nickname + (parentName ? ' · nested under ' + parentName : '')));
        } else if (object.nickname) {
            objectHeaderElement.appendChild(createElement('span', 'treeIteration muted', object.nickname));
        }

        objectHeaderElement.appendChild(treeObjectState.countElement);

        objectElement.appendChild(objectHeaderElement);
        objectElement.appendChild(treeObjectState.bodyElement);

        return treeObjectState;

    }

    /*
        The tab strip and the Structure tab's objects, made on the card's first expand. The history
        tabs are drawn only for a card whose model carries a history, and their rows wait for the
        tab's own first open -- that is also when Previous Versions asks for its summaries, which
        the host reads from each run's wrapper.
    */
    function ensureTreeBodyBuilt(treeState) {

        if (treeState.isBodyBuilt) { return; }

        const tabsElement = createElement('div', 'treeTabs');
        const structureElement = createElement('div', 'treeStructure');

        tabsElement.setAttribute('role', 'tablist');

        treeState.objectStates.forEach(function (treeObjectState) {
            structureElement.appendChild(treeObjectState.element);
        });

        if (treeState.objectStates.length === 0) {
            structureElement.appendChild(createElement('div', 'treeEmpty muted', 'This tree has no objects with a recipe.'));
        }

        treeState.tabStates = [];
        treeState.selectedTab = 'structure';
        addTreeTab(treeState, tabsElement, 'structure', 'Structure', structureElement);

        if (treeState.tree.history) {
            addTreeTab(treeState, tabsElement, 'versions', 'Previous Versions', createElement('div', 'treeVersions hidden'));
            addTreeTab(treeState, tabsElement, 'datasets', 'Previous Fake Sets', createElement('div', 'treeDatasets hidden'));
        }

        treeState.bodyElement.appendChild(tabsElement);
        treeState.tabStates.forEach(function (tabState) { treeState.bodyElement.appendChild(tabState.panelElement); });
        treeState.isBodyBuilt = true;

    }

    function addTreeTab(treeState, tabsElement, tabName, tabLabel, panelElement) {

        const isSelected = tabName === treeState.selectedTab;
        const tabElement = createElement('button', isSelected ? 'treeTab selected' : 'treeTab', tabLabel);

        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', tabLabel);
        tabElement.addEventListener('click', function () { selectTreeTab(treeState, tabName); });

        treeState.tabStates.push({ tabName: tabName, tabElement: tabElement, panelElement: panelElement, isBuilt: tabName === 'structure' });
        tabsElement.appendChild(tabElement);

    }

    function selectTreeTab(treeState, tabName) {

        ensureTreeBodyBuilt(treeState);

        if (!treeState.tabStates.some(function (tabState) { return tabState.tabName === tabName; })) { return; }

        treeState.selectedTab = tabName;

        treeState.tabStates.forEach(function (tabState) {

            const isSelected = tabState.tabName === tabName;

            if (isSelected) {
                tabState.tabElement.classList.add('selected');
                tabState.panelElement.classList.remove('hidden');
            } else {
                tabState.tabElement.classList.remove('selected');
                tabState.panelElement.classList.add('hidden');
            }

            tabState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            if (isSelected && !tabState.isBuilt) {
                tabState.isBuilt = true;
                if (tabState.tabName === 'versions') { buildVersionsTab(treeState, tabState.panelElement); }
                if (tabState.tabName === 'datasets') { buildDatasetsTab(treeState, tabState.panelElement); }
            }

        });

    }

    function versionLabelOf(treeState, runFolderName) {

        const version = runFolderName === null ? null : treeState.tree.history.versions.find(function (candidateVersion) {
            return candidateVersion.runFolderName === runFolderName;
        });

        if (!version) { return 'version unknown'; }

        return version.isCurrent ? 'current version' : 'version of ' + version.generatedAtLabel;

    }

    function formatRecordCounts(recordCounts) {

        if (recordCounts.length === 0) { return 'no records'; }

        return recordCounts.map(function (recordCount) {
            return recordCount.objectApiName + ': ' + pluralize(recordCount.recordCount, 'record', 'records');
        }).join(' · ');

    }

    function drawDatasetRecordCounts(countsElement, recordCountsMessage) {

        const countsText = recordCountsMessage.recordCounts.length > 0 || !recordCountsMessage.failureMessage
            ? formatRecordCounts(recordCountsMessage.recordCounts)
            : '';

        countsElement.textContent = [countsText, recordCountsMessage.failureMessage].filter(function (countsPart) { return !!countsPart; }).join(' · ');

    }

    // A DATA SET FROM BEFORE datasetSource.json HAS ITS COUNTS READ WHEN IT IS EXPANDED, ONCE PER MODEL
    function requestDatasetRecordCounts(datasetFolderName, countsElement) {

        if (Object.prototype.hasOwnProperty.call(answeredDatasetCounts, datasetFolderName)) {
            drawDatasetRecordCounts(countsElement, answeredDatasetCounts[datasetFolderName]);
            return;
        }

        countsElement.textContent = 'Loading record counts…';

        if (Object.prototype.hasOwnProperty.call(pendingDatasetCountElements, datasetFolderName)) {
            pendingDatasetCountElements[datasetFolderName].push(countsElement);
            return;
        }

        pendingDatasetCountElements[datasetFolderName] = [countsElement];
        vscodeApi.postMessage({ command: 'loadDatasetRecordCounts', datasetFolderName: datasetFolderName });

    }

    function renderDatasetRecordCounts(recordCountsMessage) {

        if (recordCountsMessage.renderSequence !== renderedSequence) { return; }

        const datasetFolderName = recordCountsMessage.datasetFolderName;
        answeredDatasetCounts[datasetFolderName] = recordCountsMessage;

        if (!Object.prototype.hasOwnProperty.call(pendingDatasetCountElements, datasetFolderName)) { return; }

        const countsElements = pendingDatasetCountElements[datasetFolderName];
        delete pendingDatasetCountElements[datasetFolderName];

        countsElements.forEach(function (countsElement) { drawDatasetRecordCounts(countsElement, recordCountsMessage); });

    }

    function buildHistoryAction(className, labelText, titleText, hostMessage) {

        const actionElement = createElement('button', 'historyAction ' + className, labelText);
        actionElement.setAttribute('title', titleText);
        actionElement.addEventListener('click', function () { vscodeApi.postMessage(hostMessage); });
        return actionElement;

    }

    // ONE DATA SET: WHEN, WHICH VERSION (ON THE FAKE SETS TAB), ITS RECORD COUNTS, AND OPEN / INSERT BY FOLDER NAME
    function buildDatasetRow(treeState, dataset, tabName) {

        const datasetElement = createElement('div', 'treeDataset');
        const datasetHeaderElement = createElement('div', 'treeDatasetHeader');
        const countsElement = createElement('div', 'treeDatasetCounts muted');
        const actionMessage = { datasetFolderName: dataset.datasetFolderName, treeKey: treeState.tree.treeKey, tab: tabName };

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetDate', dataset.generatedAtLabel));
        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetBackend muted', dataset.fakerService));

        if (tabName === 'datasets') {
            datasetHeaderElement.appendChild(createElement('span', dataset.runFolderName === null ? 'treeDatasetVersion unknownVersion' : 'treeDatasetVersion', versionLabelOf(treeState, dataset.runFolderName)));
        }

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetFolder muted', dataset.datasetFolderName));
        datasetHeaderElement.appendChild(buildHistoryAction('treeDatasetOpen', 'Open', 'Reveal the folder of this data set in the Explorer',
            Object.assign({ command: 'openDataset' }, actionMessage)));
        datasetHeaderElement.appendChild(buildHistoryAction('treeDatasetInsert', 'Insert…', 'Insert this data set into an org with Insert Data Set by Directory',
            Object.assign({ command: 'insertDataset' }, actionMessage)));

        datasetElement.appendChild(datasetHeaderElement);
        datasetElement.appendChild(countsElement);

        /*
            A legacy data set's counts are read from its Collections API files, which hold every
            record, so they are read when the reader asks: expanding a version is that ask, and on
            the Fake Sets tab -- which lists every data set at once -- the row's own button is.
        */
        if (dataset.recordCounts) {
            countsElement.textContent = formatRecordCounts(dataset.recordCounts);
        } else if (tabName === 'versions') {
            requestDatasetRecordCounts(dataset.datasetFolderName, countsElement);
        } else {
            const loadCountsElement = createElement('button', 'historyAction treeDatasetCountsLoad', 'Show record counts');
            loadCountsElement.setAttribute('title', 'Count the records in the Collections API files of this data set');
            loadCountsElement.addEventListener('click', function () { requestDatasetRecordCounts(dataset.datasetFolderName, countsElement); });
            countsElement.appendChild(loadCountsElement);
        }

        return datasetElement;

    }

    function buildDatasetsTab(treeState, panelElement) {

        const datasets = treeState.tree.history.datasets;

        if (datasets.length === 0) {
            panelElement.appendChild(createElement('div', 'treeEmpty muted', 'No data sets were made from this tree.'));
            return;
        }

        datasets.forEach(function (dataset) { panelElement.appendChild(buildDatasetRow(treeState, dataset, 'datasets')); });

    }

    function setVersionExpanded(treeState, versionState, isExpanded) {

        if (isExpanded && !versionState.isBodyBuilt) {

            const versionDatasets = treeState.tree.history.datasets.filter(function (dataset) { return dataset.runFolderName === versionState.version.runFolderName; });

            if (versionDatasets.length === 0) {
                versionState.bodyElement.appendChild(createElement('div', 'treeEmpty muted', 'No data sets were made from this version.'));
            }

            versionDatasets.forEach(function (dataset) { versionState.bodyElement.appendChild(buildDatasetRow(treeState, dataset, 'versions')); });
            versionState.isBodyBuilt = true;

        }

        if (isExpanded) { versionState.bodyElement.classList.remove('hidden'); } else { versionState.bodyElement.classList.add('hidden'); }

        versionState.toggleElement.textContent = isExpanded ? '▾' : '▸';
        versionState.toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        versionState.isExpanded = isExpanded;

    }

    function buildVersionRow(treeState, version) {

        const versionElement = createElement('div', 'treeVersion');
        const versionHeaderElement = createElement('div', 'treeVersionHeader');
        const toggleElement = createElement('button', 'treeVersionToggle', '▸');

        const versionState = {
            version: version,
            element: versionElement,
            toggleElement: toggleElement,
            bodyElement: createElement('div', 'treeVersionBody hidden'),
            fieldsElement: createElement('span', 'treeVersionFields muted', 'Loading summary…'),
            changeElement: createElement('span', 'treeVersionChange'),
            isBodyBuilt: false,
            isExpanded: false
        };

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide the data sets made from the version of ' + version.generatedAtLabel);
        toggleElement.addEventListener('click', function () { setVersionExpanded(treeState, versionState, !versionState.isExpanded); });

        versionHeaderElement.appendChild(toggleElement);
        versionHeaderElement.appendChild(createElement('span', 'treeVersionDate', version.generatedAtLabel));
        versionHeaderElement.appendChild(createElement('span', 'treeVersionBackend muted', version.fakerService));
        versionHeaderElement.appendChild(versionState.fieldsElement);
        versionHeaderElement.appendChild(versionState.changeElement);

        if (version.isBackendDifferent) {
            versionHeaderElement.appendChild(createElement('span', 'treeVersionBackendChange', 'backend ≠'));
        }

        if (version.isCurrent) {
            versionHeaderElement.appendChild(createElement('span', 'treeVersionCurrent', 'current'));
        }

        if (version.isDiffable) {
            versionHeaderElement.appendChild(buildHistoryAction('treeVersionDiff', 'Diff', 'Compare the recipe of this version with the current one',
                { command: 'diffTreeVersion', treeKey: treeState.tree.treeKey, runFolderName: version.runFolderName }));
        }

        versionElement.appendChild(versionHeaderElement);
        versionElement.appendChild(versionState.bodyElement);

        return versionState;

    }

    function buildVersionsTab(treeState, panelElement) {

        // KEYED BY RUN FOLDER NAMES FROM DISK, SO NO PROTOTYPE
        treeState.versionStatesByRunFolderName = Object.create(null);

        treeState.tree.history.versions.forEach(function (version) {
            const versionState = buildVersionRow(treeState, version);
            treeState.versionStatesByRunFolderName[version.runFolderName] = versionState;
            panelElement.appendChild(versionState.element);
        });

        vscodeApi.postMessage({ command: 'loadVersionSummaries', treeKey: treeState.tree.treeKey });

    }

    function renderVersionSummaries(versionSummariesMessage) {

        if (versionSummariesMessage.renderSequence !== renderedSequence) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === versionSummariesMessage.treeKey; });

        if (!treeState || !treeState.versionStatesByRunFolderName) { return; }

        versionSummariesMessage.summaries.forEach(function (versionSummary) {

            if (!Object.prototype.hasOwnProperty.call(treeState.versionStatesByRunFolderName, versionSummary.runFolderName)) { return; }

            const versionState = treeState.versionStatesByRunFolderName[versionSummary.runFolderName];
            versionState.fieldsElement.textContent = versionSummary.isSummaryAvailable ? pluralize(versionSummary.fieldCount, 'field', 'fields') : 'summary unavailable';
            versionState.changeElement.textContent = versionSummary.changeText;

        });

    }

    // A RELOAD THE HOST MADE AFTER A DATA SET WENT MISSING RE-OPENS THE CARD AND TAB THE READER ACTED FROM
    function applyTreeFocus(focusTree) {

        if (!focusTree || viewMode !== 'trees') { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === focusTree.treeKey; });

        if (!treeState) { return; }

        treeState.isExpandedByReader = true;
        setTreeExpanded(treeState, true);
        selectTreeTab(treeState, focusTree.tab);

    }

    function setTreeExpanded(treeState, isExpanded) {

        if (isExpanded) {
            ensureTreeBodyBuilt(treeState);
            treeState.bodyElement.classList.remove('hidden');
        } else {
            treeState.bodyElement.classList.add('hidden');
        }

        treeState.isExpanded = isExpanded;
        treeState.toggleElement.textContent = isExpanded ? '▾' : '▸';
        treeState.toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

    }

    function setTreeScope(nextTreeScopeKey) {

        treeScopeKey = nextTreeScopeKey;

        let scopedTreeState = null;

        treeStates.forEach(function (treeState) {
            const isScoped = treeState.tree.treeKey === treeScopeKey;
            if (isScoped) { scopedTreeState = treeState; }
            treeState.scopeElement.setAttribute('aria-pressed', isScoped ? 'true' : 'false');
            if (isScoped) { treeState.scopeElement.classList.add('selected'); } else { treeState.scopeElement.classList.remove('selected'); }
        });

        treeScopeStatusElement.textContent = '';

        if (!scopedTreeState) {
            treeScopeKey = null;
            treeScopeStatusElement.classList.add('hidden');
        } else {
            const scopedTree = scopedTreeState.tree;
            treeScopeStatusElement.appendChild(createElement('span', 'treeScopeText', 'Searching only ' + scopedTree.title + (scopedTree.folderName ? ' (' + scopedTree.folderName + ')' : '') + ' '));
            const clearScopeElement = createElement('button', 'treeScopeClear', 'Search every tree');
            clearScopeElement.addEventListener('click', function () { setTreeScope(null); });
            treeScopeStatusElement.appendChild(clearScopeElement);
            treeScopeStatusElement.classList.remove('hidden');
        }

        applyTreeFilter();

    }

    /*
        One later occurrence of an object, drawn as an object of its own (#188): the object's field
        rows, each at the occurrence's line and with its value, and the occurrence's own header line.
        A field only the occurrence writes is listed after them, as read from the recipe file.
    */
    function buildIterationObject(object, iterationNickname) {

        const iteration = (object.iterations || []).find(function (candidate) { return candidate.nickname === iterationNickname; });
        if (!iteration) { return null; }

        const iterationFieldsByApiName = Object.create(null);
        iteration.fields.forEach(function (iterationField) { iterationFieldsByApiName[iterationField.fieldApiName] = iterationField; });

        const objectFieldApiNames = Object.create(null);
        const fields = object.fields.map(function (field) {
            objectFieldApiNames[field.fieldApiName] = true;
            const iterationField = iterationFieldsByApiName[field.fieldApiName];
            return Object.assign({}, field, {
                lineNumber: iterationField ? iterationField.lineNumber : undefined,
                recipeValue: iterationField ? iterationField.recipeValue : field.recipeValue
            });
        });

        iteration.fields.forEach(function (iterationField) {
            if (objectFieldApiNames[iterationField.fieldApiName]) { return; }
            fields.push({
                fieldApiName: iterationField.fieldApiName,
                fieldLabel: '',
                fieldType: '',
                fieldTypeWithSize: '',
                recipeValue: iterationField.recipeValue,
                controllingField: '',
                isOnlyInRecipeFile: true,
                lineNumber: iterationField.lineNumber
            });
        });

        return {
            objectApiName: object.objectApiName,
            recipeFilePath: object.recipeFilePath,
            recipeFileName: object.recipeFileName,
            lineNumber: iteration.lineNumber,
            nickname: iteration.nickname,
            iteration: iteration,
            fields: fields
        };

    }

    function resolveTreeObject(treeObject, objectsByApiName) {

        if (!Object.prototype.hasOwnProperty.call(objectsByApiName, treeObject.objectApiName)) { return null; }

        const object = objectsByApiName[treeObject.objectApiName];
        return treeObject.iterationNickname === undefined ? object : buildIterationObject(object, treeObject.iterationNickname);

    }

    function renderTree(tree, objectsByApiName) {

        const treeElement = createElement('div', 'treeCard');
        const treeHeaderElement = createElement('div', 'treeHeader');
        const toggleElement = createElement('button', 'treeToggle', '▸');
        const scopeElement = createElement('button', 'treeScope', '🔍');

        const treeState = {
            tree: tree,
            objectStates: tree.objects
                .map(function (treeObject) { return { treeObject: treeObject, object: resolveTreeObject(treeObject, objectsByApiName) }; })
                .filter(function (resolved) { return resolved.object !== null; })
                .map(function (resolved) { return buildTreeObjectState(resolved.treeObject, resolved.object); }),
            isBodyBuilt: false,
            isExpanded: false,
            isExpandedByReader: false,
            element: treeElement,
            toggleElement: toggleElement,
            scopeElement: scopeElement,
            bodyElement: createElement('div', 'treeBody hidden'),
            matchElement: createElement('span', 'treeMatch muted hidden')
        };

        // AN OBJECT AND ITS FIELDS ARE COUNTED ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD DRAWS
        const objectStatesCounted = treeState.objectStates.filter(function (treeObjectState) { return !treeObjectState.isIteration; });
        const treeFieldCount = objectStatesCounted.reduce(function (fieldCount, treeObjectState) { return fieldCount + treeObjectState.fieldStates.length; }, 0);

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide ' + tree.title);
        toggleElement.addEventListener('click', function () {
            treeState.isExpandedByReader = !treeState.isExpanded;
            setTreeExpanded(treeState, treeState.isExpandedByReader);
        });

        scopeElement.setAttribute('title', 'Search only this tree');
        scopeElement.setAttribute('aria-label', 'Search only ' + tree.title);
        scopeElement.setAttribute('aria-pressed', 'false');
        scopeElement.addEventListener('click', function () {
            setTreeScope(treeScopeKey === tree.treeKey ? null : tree.treeKey);
        });

        treeHeaderElement.appendChild(toggleElement);
        treeHeaderElement.appendChild(createElement('span', 'treeTitle', tree.title));

        if (tree.folderName) {
            treeHeaderElement.appendChild(createElement('span', 'treeFolder muted', tree.folderName));
        }

        treeHeaderElement.appendChild(createElement('span', 'treeCount muted',
            pluralize(objectStatesCounted.length, 'object', 'objects') + ' · ' + pluralize(treeFieldCount, 'field', 'fields')));
        treeHeaderElement.appendChild(treeState.matchElement);
        treeHeaderElement.appendChild(scopeElement);

        if (tree.runFakerRecipeFileName) {
            treeState.runFakerElement = buildRunFakerElement(tree);
            treeHeaderElement.appendChild(treeState.runFakerElement);
        }

        treeElement.appendChild(treeHeaderElement);
        treeElement.appendChild(treeState.bodyElement);
        treesViewElement.appendChild(treeElement);

        treeStates.push(treeState);

    }

    /*
        Posts the tree's KEY; the host looks its recipe file up. Every Run Faker button is disabled
        on the click, before the host answers, so a second click cannot start a second run -- the
        host's runFakerState is what enables them again.
    */
    function buildRunFakerElement(tree) {

        const runFakerElement = createElement('button', 'treeRunFaker', RUN_FAKER_ACTION_LABEL);

        runFakerElement.setAttribute('title', 'Run Faker by Recipe on ' + tree.runFakerRecipeFileName);
        runFakerElement.setAttribute('aria-label', 'Run Faker on ' + tree.title + ' (' + tree.runFakerRecipeFileName + ')');
        runFakerElement.addEventListener('click', function () {
            if (runFakerRunningTreeKey !== null) { return; }
            setRunFakerRunning(tree.treeKey);
            vscodeApi.postMessage({ command: 'runFaker', treeKey: tree.treeKey });
        });

        applyRunFakerStateTo(tree, runFakerElement);

        return runFakerElement;

    }

    function applyRunFakerStateTo(tree, runFakerElement) {

        runFakerElement.disabled = runFakerRunningTreeKey !== null;
        runFakerElement.textContent = runFakerRunningTreeKey === tree.treeKey ? RUN_FAKER_RUNNING_LABEL : RUN_FAKER_ACTION_LABEL;

    }

    function setRunFakerRunning(runningTreeKey) {

        runFakerRunningTreeKey = runningTreeKey;

        treeStates.forEach(function (treeState) {
            if (treeState.runFakerElement) { applyRunFakerStateTo(treeState.tree, treeState.runFakerElement); }
        });

    }

    function renderTrees(recipe) {

        // KEYED BY NAMES FROM THE WRAPPER ON DISK -- "__proto__" MUST BE A KEY, NOT A NEW PROTOTYPE
        const objectsByApiName = Object.create(null);
        recipe.objects.forEach(function (object) { objectsByApiName[object.objectApiName] = object; });

        treeMatchCountElement = createElement('div', 'treeMatchCount muted');
        treeScopeStatusElement = createElement('div', 'treeScopeStatus hidden');
        treesViewElement.appendChild(treeMatchCountElement);
        treesViewElement.appendChild(treeScopeStatusElement);

        const trees = recipe.trees || [];

        if (trees.length === 0) {
            treesViewElement.appendChild(createElement('div', 'emptyState', 'This run has no relationship trees to show. Its objects are listed in the Classic list.'));
            return;
        }

        trees.forEach(function (tree) { renderTree(tree, objectsByApiName); });

    }

    /*
        The find box across every tree, or across the one the reader scoped it to with 🔍.

        It narrows rows and never hides a CARD: a tree with no match stays on screen, collapsed and
        labelled "no matches", for the same reason the Classic list keeps an object with none. A
        card opens only for an object the filter opens, and objects open under the same
        RECIPE_COCKPIT_AUTO_EXPAND_* limits as the Classic list, so a keystroke's cost is bounded by
        what it expands, across every tree together.
    */
    function applyTreeFilter() {

        if (!treeMatchCountElement) { return; }

        const isFiltering = !!filterQuery;

        let totalFieldCount = 0;
        let matchingFieldCount = 0;
        let searchedTreeCount = 0;
        let matchingTreeCount = 0;
        let autoExpandedObjectCount = 0;
        let autoExpandedRowCount = 0;
        let isAutoExpandBudgetSpent = false;

        treeStates.forEach(function (treeState) {

            const isSearched = treeScopeKey === null || treeState.tree.treeKey === treeScopeKey;
            let treeMatchingFieldCount = 0;

            treeState.objectStates.forEach(function (treeObjectState) {

                const isObjectNameMatch = !isFiltering || !isSearched || treeObjectState.objectSearchText.indexOf(filterQuery) !== -1;
                let objectMatchingFieldCount = 0;

                treeObjectState.fieldStates.forEach(function (fieldState) {
                    fieldState.isMatch = isObjectNameMatch || isFieldTextMatch(fieldState);
                    if (fieldState.isMatch) { objectMatchingFieldCount++; }
                    applyTreeFieldVisibility(fieldState);
                });

                const objectFieldCount = treeObjectState.fieldStates.length;
                treeObjectState.matchingFieldCount = objectMatchingFieldCount;

                if (isSearched) {
                    totalFieldCount += objectFieldCount;
                    matchingFieldCount += objectMatchingFieldCount;
                    treeMatchingFieldCount += objectMatchingFieldCount;
                }

                if (!isFiltering || !isSearched || isObjectNameMatch) {
                    treeObjectState.countElement.textContent = pluralize(objectFieldCount, 'field', 'fields');
                } else if (objectMatchingFieldCount > 0) {
                    treeObjectState.countElement.textContent = objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields');
                } else {
                    treeObjectState.countElement.textContent = 'no matching fields';
                }

            });

            if (isSearched) { searchedTreeCount++; }
            if (isSearched && treeMatchingFieldCount > 0) { matchingTreeCount++; }

            // A CLEARED FILTER, OR A TREE OUTSIDE THE SCOPE, GIVES BACK WHAT THE READER HAD OPENED
            if (!isFiltering || !isSearched) {
                treeState.matchElement.textContent = isFiltering ? 'not searched' : '';
                if (isFiltering) { treeState.matchElement.classList.remove('hidden'); } else { treeState.matchElement.classList.add('hidden'); }
                setTreeExpanded(treeState, treeState.isExpandedByReader);
                treeState.objectStates.forEach(function (treeObjectState) { setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader); });
                return;
            }

            treeState.matchElement.textContent = treeMatchingFieldCount > 0 ? pluralize(treeMatchingFieldCount, 'matching field', 'matching fields') : 'no matches';
            treeState.matchElement.classList.remove('hidden');

            let isAnyObjectOpened = false;

            treeState.objectStates.forEach(function (treeObjectState) {

                if (treeObjectState.matchingFieldCount === 0 || isAutoExpandBudgetSpent) {
                    setTreeObjectExpanded(treeObjectState, false);
                    return;
                }

                const objectFieldCount = treeObjectState.fieldStates.length;
                const fitsRowBudget = autoExpandedObjectCount === 0 || autoExpandedRowCount + objectFieldCount <= AUTO_EXPAND_ROW_BUDGET;

                if (autoExpandedObjectCount >= AUTO_EXPAND_OBJECT_LIMIT || !fitsRowBudget) {
                    isAutoExpandBudgetSpent = true;
                    setTreeObjectExpanded(treeObjectState, false);
                    return;
                }

                autoExpandedObjectCount++;
                autoExpandedRowCount += objectFieldCount;
                isAnyObjectOpened = true;
                setTreeObjectExpanded(treeObjectState, true);

            });

            setTreeExpanded(treeState, isAnyObjectOpened);

            // THE ROWS A FILTER OPENED ARE ON THE STRUCTURE TAB, SO A CARD SHOWING A HISTORY TAB SWITCHES TO IT
            if (isAnyObjectOpened && treeState.selectedTab && treeState.selectedTab !== 'structure') {
                selectTreeTab(treeState, 'structure');
            }

        });

        treeMatchCountElement.textContent = isFiltering
            ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') + ' · ' + matchingTreeCount + ' of ' + pluralize(searchedTreeCount, 'tree', 'trees')
            : pluralize(totalFieldCount, 'field', 'fields') + ' · ' + pluralize(searchedTreeCount, 'tree', 'trees');

    }

    /*
        Data-by-Org: every tree in Recipe Trees order, and each object's record count in the org the
        reader chose. The dropdown is a native select of the LABELS the host posted, and the panel
        posts back only the chosen option's index -- the host holds the usernames.
    */
    function renderDataOrgView(recipe) {

        const controlsElement = createElement('div', 'dataOrgControls');

        dataOrgSelectElement = createElement('select', 'dataOrgSelect hidden');
        dataOrgSelectElement.setAttribute('aria-label', 'Salesforce org to count records in');
        dataOrgSelectElement.addEventListener('change', function () {
            const selectedValue = String(dataOrgSelectElement.value || '');
            if (!selectedValue) { return; }
            vscodeApi.postMessage({ command: 'selectDataOrg', orgIndex: Number(selectedValue) });
        });

        dataOrgTypeElement = createElement('span', 'dataOrgType hidden');

        dataOrgRefreshElement = createElement('button', 'dataOrgRefresh hidden', '⟳');
        dataOrgRefreshElement.setAttribute('title', 'Count the records in this org again');
        dataOrgRefreshElement.setAttribute('aria-label', 'Count the records in this org again');
        dataOrgRefreshElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'refreshDataOrgCounts' });
        });

        controlsElement.appendChild(dataOrgSelectElement);
        controlsElement.appendChild(dataOrgTypeElement);
        controlsElement.appendChild(dataOrgRefreshElement);
        dataOrgViewElement.appendChild(controlsElement);

        dataOrgStatusElement = createElement('div', 'dataOrgStatus muted', 'Loading the authorized orgs…');
        dataOrgViewElement.appendChild(dataOrgStatusElement);

        const trees = recipe.trees || [];

        if (trees.length === 0) {
            dataOrgViewElement.appendChild(createElement('div', 'emptyState', 'This run has no relationship trees to count records for.'));
            return;
        }

        trees.forEach(renderDataTree);

    }

    function renderDataTree(tree) {

        const treeElement = createElement('div', 'dataTreeCard');
        const headerElement = createElement('div', 'dataTreeHeader');
        const toggleElement = createElement('button', 'dataTreeToggle', '▸');
        const bodyElement = createElement('div', 'dataTreeBody hidden');

        const dataTreeState = {
            tree: tree,
            objectApiNames: tree.objects
                .filter(function (treeObject) { return treeObject.iterationNickname === undefined; })
                .map(function (treeObject) { return treeObject.objectApiName; }),
            element: treeElement,
            toggleElement: toggleElement,
            bodyElement: bodyElement,
            countElement: createElement('span', 'dataTreeCount muted'),
            objectCountElements: Object.create(null),
            isExpanded: false
        };

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide the objects of ' + tree.title);
        toggleElement.addEventListener('click', function () {
            dataTreeState.isExpanded = !dataTreeState.isExpanded;
            if (dataTreeState.isExpanded) { bodyElement.classList.remove('hidden'); } else { bodyElement.classList.add('hidden'); }
            toggleElement.textContent = dataTreeState.isExpanded ? '▾' : '▸';
            toggleElement.setAttribute('aria-expanded', dataTreeState.isExpanded ? 'true' : 'false');
        });

        headerElement.appendChild(toggleElement);
        headerElement.appendChild(createElement('span', 'dataTreeTitle', tree.title));
        if (tree.folderName) {
            headerElement.appendChild(createElement('span', 'dataTreeFolder muted', tree.folderName));
        }
        headerElement.appendChild(dataTreeState.countElement);

        // IN INSERT ORDER, AS THE TREE LISTS THEM -- ROWS ARE A NAME AND A NUMBER, SO THEY ARE BUILT WITH THE CARD
        dataTreeState.objectApiNames.forEach(function (objectApiName) {
            const objectElement = createElement('div', 'dataObject');
            const objectHeaderElement = createElement('div', 'dataObjectHeader');
            const countElement = createElement('span', 'dataObjectCount muted');
            objectHeaderElement.appendChild(createElement('span', 'dataObjectName', objectApiName));
            objectHeaderElement.appendChild(countElement);
            objectElement.appendChild(objectHeaderElement);
            bodyElement.appendChild(objectElement);
            if (!Object.prototype.hasOwnProperty.call(dataTreeState.objectCountElements, objectApiName)) {
                dataTreeState.objectCountElements[objectApiName] = [];
            }
            dataTreeState.objectCountElements[objectApiName].push(countElement);
        });

        if (dataTreeState.objectApiNames.length === 0) {
            bodyElement.appendChild(createElement('div', 'treeEmpty muted', 'This tree has no objects with a recipe.'));
        }

        treeElement.appendChild(headerElement);
        treeElement.appendChild(bodyElement);
        dataOrgViewElement.appendChild(treeElement);

        dataTreeStates.push(dataTreeState);
        drawDataTreeCounts(dataTreeState);

    }

    function formatRecordCount(recordCount) {
        return Number(recordCount).toLocaleString('en-US') + ' ' + (recordCount === 1 ? 'record' : 'records');
    }

    function describeDataOrgCount(countViewModel) {

        if (!countViewModel) { return dataOrgRequestSequence === null ? '—' : 'counting…'; }
        if (countViewModel.status === 'count') { return formatRecordCount(countViewModel.recordCount); }
        if (countViewModel.status === 'notInOrg') { return 'not in org'; }
        if (countViewModel.status === 'noAccess') { return 'no access'; }

        return 'could not count';

    }

    function drawDataTreeCounts(dataTreeState) {

        let totalRecordCount = 0;
        let pendingCount = 0;
        let uncountedCount = 0;

        dataTreeState.objectApiNames.forEach(function (objectApiName) {

            const countViewModel = Object.prototype.hasOwnProperty.call(dataOrgCountsByObject, objectApiName) ? dataOrgCountsByObject[objectApiName] : null;

            dataTreeState.objectCountElements[objectApiName].forEach(function (countElement) {
                countElement.textContent = describeDataOrgCount(countViewModel);
                countElement.setAttribute('title', countViewModel && countViewModel.failureMessage ? countViewModel.failureMessage : '');
            });

            if (!countViewModel) { pendingCount++; return; }
            if (countViewModel.status === 'count') { totalRecordCount += countViewModel.recordCount; } else { uncountedCount++; }

        });

        const objectCountText = pluralize(dataTreeState.objectApiNames.length, 'object', 'objects');

        if (dataOrgRequestSequence === null) {
            dataTreeState.countElement.textContent = objectCountText;
            return;
        }

        dataTreeState.countElement.textContent = objectCountText + ' · '
            + (pendingCount > 0 ? 'counting…' : formatRecordCount(totalRecordCount) + ' in the org')
            + (uncountedCount > 0 ? ' · ' + uncountedCount + ' not counted' : '');

    }

    function setDataOrgStatus(statusText, isFailure) {

        dataOrgStatusElement.textContent = statusText;
        if (statusText) { dataOrgStatusElement.classList.remove('hidden'); } else { dataOrgStatusElement.classList.add('hidden'); }
        if (isFailure) { dataOrgStatusElement.classList.add('failed'); } else { dataOrgStatusElement.classList.remove('failed'); }

    }

    function requestDataOrgs() {

        if (!dataOrgViewElement || dataOrgRequestedSequence === renderedSequence) { return; }

        dataOrgRequestedSequence = renderedSequence;
        vscodeApi.postMessage({ command: 'loadDataOrgs' });

    }

    function renderDataOrgList(dataOrgList) {

        if (!dataOrgSelectElement || dataOrgList.renderSequence !== renderedSequence) { return; }

        dataOrgSelectElement.textContent = '';

        if (dataOrgList.orgLabels.length === 0) {
            dataOrgSelectElement.classList.add('hidden');
            setDataOrgStatus(dataOrgList.noOrgsMessage, true);
            return;
        }

        const placeholderElement = createElement('option', '', 'Choose an org…');
        placeholderElement.value = '';
        dataOrgSelectElement.appendChild(placeholderElement);

        dataOrgList.orgLabels.forEach(function (orgLabel, orgIndex) {
            const optionElement = createElement('option', '', orgLabel);
            optionElement.value = String(orgIndex);
            dataOrgSelectElement.appendChild(optionElement);
        });

        dataOrgSelectElement.value = dataOrgList.selectedOrgIndex === null ? '' : String(dataOrgList.selectedOrgIndex);
        dataOrgSelectElement.classList.remove('hidden');
        setDataOrgStatus(dataOrgList.selectedOrgIndex === null ? 'Choose an org to count the records of each tree in it.' : '', false);

    }

    function renderDataOrgSelection(dataOrgSelection) {

        if (!dataOrgSelectElement || dataOrgSelection.renderSequence !== renderedSequence) { return; }
        if (dataOrgRequestSequence !== null && dataOrgSelection.requestSequence < dataOrgRequestSequence) { return; }

        // A NEW SELECTION, OR A REFRESH OF THIS ONE, STARTS FROM NO COUNTS
        if (dataOrgSelection.requestSequence !== dataOrgRequestSequence) {
            dataOrgRequestSequence = dataOrgSelection.requestSequence;
            dataOrgCountsByObject = Object.create(null);
            setDataOrgStatus('Counting records in ' + dataOrgSelection.orgLabel + '…', false);
        }

        dataOrgSelectElement.value = String(dataOrgSelection.orgIndex);
        dataOrgTypeElement.textContent = dataOrgSelection.orgTypeLabel || 'checking…';
        dataOrgTypeElement.classList.remove('hidden');
        dataOrgRefreshElement.classList.remove('hidden');

        dataTreeStates.forEach(drawDataTreeCounts);

    }

    function renderDataOrgCounts(dataOrgCounts) {

        if (!dataOrgStatusElement || dataOrgCounts.renderSequence !== renderedSequence || dataOrgCounts.requestSequence !== dataOrgRequestSequence) { return; }

        dataOrgCounts.counts.forEach(function (countViewModel) {
            dataOrgCountsByObject[countViewModel.objectApiName] = countViewModel;
        });

        if (dataOrgCounts.connectionFailureMessage) {
            setDataOrgStatus(dataOrgCounts.connectionFailureMessage, true);
            // A FAILED CONNECTION COUNTED NOTHING, SO NO ROW IS LEFT SAYING "counting…"
            dataOrgRequestSequence = dataOrgCounts.requestSequence;
            dataTreeStates.forEach(function (dataTreeState) {
                dataTreeState.objectApiNames.forEach(function (objectApiName) {
                    if (!Object.prototype.hasOwnProperty.call(dataOrgCountsByObject, objectApiName)) {
                        dataOrgCountsByObject[objectApiName] = { objectApiName: objectApiName, status: 'failed', recordCount: 0, failureMessage: dataOrgCounts.connectionFailureMessage };
                    }
                });
            });
        } else {
            setDataOrgStatus(dataOrgCounts.isComplete ? '' : 'Counted ' + dataOrgCounts.completedCount + ' of ' + pluralize(dataOrgCounts.requestedCount, 'object', 'objects') + '…', false);
        }

        dataTreeStates.forEach(drawDataTreeCounts);

    }

    /*
        The find box is the FIRST thing drawn, and what sits between it and the rows is only what
        the rows cannot say themselves: notices about entries that could not be read.
    */
    function renderPanel(recipe) {

        resetPanelState();
        renderedRunFolderName = recipe.selectedRunFolderName;
        // A NEW MODEL HAS NO COMPARISON, SO A STATUS FILTER LEFT ON WOULD HIDE EVERY ROW OF IT
        statusFilter = 'all';

        const hasObjects = recipe.objects.length > 0;

        classicViewElement = createElement('div', 'classicView');
        treesViewElement = createElement('div', 'treesView');
        dataOrgViewElement = createElement('div', 'dataOrgView');

        renderToolbar(recipe, hasObjects);

        recipe.notices.forEach(function (notice) {
            cockpitBodyElement.appendChild(createElement('div', 'notice', notice));
        });

        if (!hasObjects) {
            cockpitBodyElement.appendChild(createElement('div', 'emptyState', recipe.emptyStateMessage));
            return;
        }

        cockpitBodyElement.appendChild(treesViewElement);
        cockpitBodyElement.appendChild(dataOrgViewElement);
        cockpitBodyElement.appendChild(classicViewElement);

        recipe.objects.forEach(renderObject);
        renderTrees(recipe);
        renderDataOrgView(recipe);

        setViewMode(viewMode);
        applyFiltersForView();

    }

    // EVERYTHING ONE MODEL'S DRAW HELD, DROPPED BEFORE THE NEXT DRAW OR A FAILURE NOTICE REPLACES IT
    function resetPanelState() {

        cockpitBodyElement.textContent = '';
        objectStates = [];
        treeStates = [];
        treeScopeKey = null;
        treesViewElement = null;
        classicViewElement = null;
        classicControlsElement = null;
        treeMatchCountElement = null;
        treeScopeStatusElement = null;
        viewButtonStates = [];
        filterInputElement = null;
        dataOrgViewElement = null;
        dataOrgSelectElement = null;
        dataOrgTypeElement = null;
        dataOrgRefreshElement = null;
        dataOrgStatusElement = null;
        dataTreeStates = [];
        dataOrgRequestedSequence = null;
        dataOrgRequestSequence = null;
        dataOrgCountsByObject = Object.create(null);
        pendingPicklistValueElements = Object.create(null);
        pendingDatasetCountElements = Object.create(null);
        answeredDatasetCounts = Object.create(null);
        fieldSearchTexts = new Map();
        matchCountElement = null;
        runSelectElement = null;
        statusFilterElement = null;
        orgStatusElement = null;
        orgProgressElement = null;
        renderedSequence = null;

    }

    /*
        A partial page is an arbitrary prefix of the model, not a smaller correct answer, so a
        render that threw replaces the body with a failure notice.
    */
    function renderPanelFailure() {

        resetPanelState();
        cockpitBodyElement.appendChild(createElement('div', 'emptyState', 'The Recipe Cockpit could not draw this recipe. The error has been reported; re-open the cockpit to try again.'));

    }

    function describeFailure(failureCause) {

        if (!failureCause) { return 'unknown error'; }
        if (typeof failureCause === 'string') { return failureCause; }
        if (failureCause.message) { return String(failureCause.message); }
        if (failureCause.type) { return 'a ' + String(failureCause.type) + ' event with no message'; }

        return String(failureCause);

    }

    function postRenderFailure(failurePhase, failureCause) {

        vscodeApi.postMessage({
            command: 'renderFailed',
            phase: failurePhase,
            message: describeFailure(failureCause),
            stack: String(failureCause && failureCause.stack ? failureCause.stack : '')
        });

    }

    function renderPanelGuarded(recipe, renderSequence, focusTree) {

        try {

            renderPanel(recipe);
            renderedSequence = renderSequence;
            vscodeApi.postMessage({ command: 'rendered', renderSequence: renderSequence });

            // A NEW MODEL DRAWN WHILE DATA-BY-ORG IS ON SCREEN COUNTS ITS OBJECTS IN THE SAME ORG
            if (viewMode === 'org') { requestDataOrgs(); }

        } catch (renderError) {

            renderPanelFailure();
            postRenderFailure('render', renderError);

            return false;

        }

        // AFTER "rendered": A FOCUSED VERSIONS TAB ASKS FOR ITS SUMMARIES, WHICH THE HOST ANSWERS ONLY ONCE THE ACK HAS ACTIVATED THEM
        try {
            applyTreeFocus(focusTree);
        } catch (focusError) {
            postRenderFailure('runtime', focusError);
        }

        return true;

    }

    /*
        What an org describe said, on the summary line and on each object's header. Drawn only over
        the model it described: a describe of an earlier run's objects says nothing about these rows.
    */
    function renderOrgDescribe(orgDescribe) {

        if (!orgStatusElement || orgDescribe.renderSequence !== renderedSequence) { return; }

        orgProgressElement.classList.add('hidden');

        orgStatusElement.textContent = '';
        orgStatusElement.appendChild(createElement('div', 'orgDescribeSummary', orgDescribe.summary));
        orgStatusElement.classList.remove('hidden');

        if (orgDescribe.isFailure) {
            orgStatusElement.classList.add('failed');
        } else {
            orgStatusElement.classList.remove('failed');
        }

        const summariesByObjectApiName = {};
        orgDescribe.objects.forEach(function (objectSummary) {
            summariesByObjectApiName[objectSummary.objectApiName] = objectSummary;
            if (!objectSummary.isDescribed) {
                orgStatusElement.appendChild(createElement('div', 'orgDescribeFailure', objectSummary.objectApiName + ': ' + objectSummary.failureMessage));
            }
        });

        objectStates.forEach(function (objectState) {

            const objectSummary = Object.prototype.hasOwnProperty.call(summariesByObjectApiName, objectState.object.objectApiName)
                ? summariesByObjectApiName[objectState.object.objectApiName]
                : null;

            if (!objectSummary) {
                objectState.orgDescribeElement.classList.add('hidden');
                return;
            }

            objectState.orgDescribeElement.textContent = objectSummary.isDescribed
                ? 'org: ' + pluralize(objectSummary.describedFieldCount, 'field', 'fields')
                : 'not described in the org';
            objectState.orgDescribeElement.classList.remove('hidden');

        });

        // A FAILED CONNECTION COMPARED NOTHING, AND REPLACES WHATEVER AN EARLIER COMPARISON SAID
        applyDiff(orgDescribe.diff, !orgDescribe.isFailure, summariesByObjectApiName);

        if (orgDescribe.diff.objects.length > 0) {
            orgStatusElement.appendChild(createElement('div', 'diffSummary', 'Compared ' + pluralize(orgDescribe.diff.objects.length, 'object', 'objects') + ': ' + describeStatusCounts(orgDescribe.diff.statusCounts, true)));
            orgStatusElement.appendChild(buildRegenerateElement());
        }

    }

    function describeStatusCounts(statusCounts, includesUnchanged) {

        const countTexts = DIFF_STATUSES
            .filter(function (diffStatus) { return (includesUnchanged || diffStatus !== 'unchanged') && statusCounts[diffStatus] > 0; })
            .map(function (diffStatus) { return statusCounts[diffStatus] + ' ' + DIFF_STATUS_LABELS[diffStatus]; });

        return countTexts.length > 0 ? countTexts.join(' · ') : 'no changes';

    }

    function buildRegenerateElement() {

        const regenerateElement = createElement('div', 'regenerate');
        const regenerateButtonElement = createElement('button', 'regenerateRecipe', REGENERATE_ACTION_LABEL);

        regenerateButtonElement.setAttribute('title', REGENERATE_NOTE);
        regenerateButtonElement.addEventListener('click', function () {
            regenerateButtonElement.disabled = true;
            regenerateButtonElement.textContent = 'Regenerating…';
            vscodeApi.postMessage({ command: 'regenerateRecipe' });
        });

        regenerateElement.appendChild(regenerateButtonElement);
        regenerateElement.appendChild(createElement('div', 'regenerateNote muted', REGENERATE_NOTE));

        return regenerateElement;

    }

    /*
        Lays a comparison over the rows already drawn. Every row of a compared object gets a status
        -- one with no entry in the diff is unchanged, which the host does not post -- a field only
        the org has becomes a row of its own, and an object that was not compared says so rather
        than showing statuses it has none of. Rows built from an earlier comparison are rebuilt from
        this one, so a field only an OLDER org had does not survive into a newer answer.
    */
    function applyDiff(diff, isComparisonShown, summariesByObjectApiName) {

        const objectDiffsByApiName = {};
        diff.objects.forEach(function (objectDiff) { objectDiffsByApiName[objectDiff.objectApiName] = objectDiff; });

        objectStates.forEach(function (objectState) {

            const objectDiff = isComparisonShown && Object.prototype.hasOwnProperty.call(objectDiffsByApiName, objectState.object.objectApiName)
                ? objectDiffsByApiName[objectState.object.objectApiName]
                : null;

            const changedFieldsByApiName = {};
            (objectDiff ? objectDiff.changedFields : []).forEach(function (fieldDiff) { changedFieldsByApiName[fieldDiff.fieldApiName] = fieldDiff; });

            objectState.fieldStates = objectState.fieldStates.filter(function (fieldState) { return !fieldState.field.isOnlyInOrg; });

            objectState.fieldStates.forEach(function (fieldState) {
                const fieldDiff = Object.prototype.hasOwnProperty.call(changedFieldsByApiName, fieldState.field.fieldApiName)
                    ? changedFieldsByApiName[fieldState.field.fieldApiName]
                    : null;
                fieldState.diff = fieldDiff;
                fieldState.diffStatus = objectDiff ? (fieldDiff ? fieldDiff.status : 'unchanged') : null;
            });

            (objectDiff ? objectDiff.changedFields : []).filter(function (fieldDiff) { return fieldDiff.status === 'new-in-org'; }).forEach(function (fieldDiff) {
                objectState.fieldStates.push(buildFieldState({
                    fieldApiName: fieldDiff.fieldApiName,
                    fieldLabel: '',
                    fieldType: fieldDiff.orgFieldType,
                    recipeValue: '',
                    controllingField: '',
                    isOnlyInRecipeFile: false,
                    isOnlyInOrg: true
                }, fieldDiff, fieldDiff.status));
            });

            if (!isComparisonShown) {
                objectState.diffElement.classList.add('hidden');
            } else {
                objectState.diffElement.textContent = objectDiff ? describeStatusCounts(objectDiff.statusCounts, false) : 'not compared';
                const objectSummary = Object.prototype.hasOwnProperty.call(summariesByObjectApiName, objectState.object.objectApiName)
                    ? summariesByObjectApiName[objectState.object.objectApiName]
                    : null;
                // THE DESCRIBE'S OWN REASON -- A CANCELLED DESCRIBE IS NOT ONE THE ORG COULD NOT ANSWER
                objectState.diffElement.setAttribute('title', objectDiff
                    ? pluralize(objectDiff.uncreateableOrgOnlyFieldCount, 'org field', 'org fields') + ' a recipe cannot write (system and formula fields) are not listed'
                    : 'Not compared: ' + (objectSummary && objectSummary.failureMessage ? objectSummary.failureMessage : 'this object was not described in the org'));
                objectState.diffElement.classList.remove('hidden');
            }

            objectState.bodyElement.textContent = '';
            objectState.isBodyBuilt = false;

            if (objectState.isExpanded) {
                ensureObjectBodyBuilt(objectState);
            }

        });

        if (statusFilterElement) {

            if (diff.objects.length > 0 && isComparisonShown) {
                statusFilterElement.classList.remove('hidden');
            } else {
                statusFilterElement.classList.add('hidden');
                statusFilter = 'all';
                statusFilterElement.value = 'all';
            }

        }

        applyFilter();

    }

    function renderOrgProgress(orgProgress) {

        if (!orgProgressElement || orgProgress.renderSequence !== renderedSequence) { return; }

        // AN EMPTY MESSAGE IS A COMPARISON THAT ENDED WITH NO ANSWER TO REPLACE THE LINE
        if (!orgProgress.message) {
            orgProgressElement.classList.add('hidden');
            return;
        }

        orgProgressElement.textContent = orgProgress.message;
        orgProgressElement.classList.remove('hidden');

    }

    window.addEventListener('message', function (hostMessageEvent) {

        const hostMessage = hostMessageEvent && hostMessageEvent.data;
        if (!hostMessage) { return; }

        if (hostMessage.command === 'loadPhase') {
            setLoadStatus(hostMessage.message, false);
            return;
        }

        if (hostMessage.command === 'recipeData') {

            // THE STATUS LINE IS LEFT ALONE WHEN THE RENDER FAILED -- CLEARING IT WOULD READ AS FINISHED
            if (renderPanelGuarded(hostMessage.recipe, hostMessage.renderSequence, hostMessage.focusTree)) {
                setLoadStatus('', false);
            }

            return;

        }

        if (hostMessage.command === 'orgDescribe') {
            renderOrgDescribe(hostMessage);
            return;
        }

        if (hostMessage.command === 'orgProgress') {
            renderOrgProgress(hostMessage);
            return;
        }

        if (hostMessage.command === 'picklistValues') {
            renderPicklistValues(hostMessage);
            return;
        }

        if (hostMessage.command === 'versionSummaries') {
            renderVersionSummaries(hostMessage);
            return;
        }

        if (hostMessage.command === 'datasetRecordCounts') {
            renderDatasetRecordCounts(hostMessage);
            return;
        }

        if (hostMessage.command === 'dataOrgList') {
            renderDataOrgList(hostMessage);
            return;
        }

        if (hostMessage.command === 'dataOrgSelection') {
            renderDataOrgSelection(hostMessage);
            return;
        }

        if (hostMessage.command === 'dataOrgCounts') {
            renderDataOrgCounts(hostMessage);
            return;
        }

        if (hostMessage.command === 'runFakerState') {
            setRunFakerRunning(hostMessage.isRunning ? hostMessage.treeKey : null);
            return;
        }

        if (hostMessage.command === 'loadFailed') {

            setLoadStatus(hostMessage.message, true);

            // A RUN THAT FAILED TO LOAD LEAVES THE PREVIOUS ONE'S ROWS ON SCREEN, SO THE SELECTOR NAMES THAT ONE AGAIN
            if (runSelectElement) {
                runSelectElement.value = renderedRunFolderName;
            }

        }

    });

    // A THROW OUTSIDE THE RENDER -- A LAZY EXPAND, A KEYSTROKE -- WOULD OTHERWISE BE SILENT
    window.addEventListener('error', function (errorEvent) {

        const thrownError = errorEvent && errorEvent.error;

        postRenderFailure('runtime', {
            message: (errorEvent && errorEvent.message) || (thrownError && thrownError.message),
            type: errorEvent && errorEvent.type,
            stack: thrownError && thrownError.stack
        });

    });

    window.addEventListener('unhandledrejection', function (rejectionEvent) {
        postRenderFailure('runtime', rejectionEvent && rejectionEvent.reason);
    });

    /*
        Posted on every load of this document, not only the first. A reveal after the panel was
        hidden reloads it from scratch, and the host answers with whatever it currently holds.
    */
    vscodeApi.postMessage({ command: 'ready' });

}());
</script>
</body>
</html>
`;

    }

}
