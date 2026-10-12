import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import { IAuthenticatedOrgDetail, ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { ITreeMetadataDeployPlan, METADATA_DEPLOY_MANIFEST_FILE_NAME, METADATA_DEPLOY_MAX_BUFFER_BYTES, METADATA_DEPLOY_TIMEOUT_MILLISECONDS, MetadataDeployOutcome, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import {
    DevHubConfigSource,
    IOrgDescribeSource,
    IOrgQuerySource,
    IOrgTypeDetail,
    IHiddenAuthorizedOrg,
    IHiddenOrgReasonCounts,
    NO_AUTHORIZED_ORGS_MESSAGE,
    OrgConnectionStatusUnavailableError,
    ORG_PARENT_SEARCH_RESULT_LIMIT,
    SalesforceOrgService
} from '../SalesforceOrgService/SalesforceOrgService';
import { IRecipeFilterLookup, IRecipeFixedValue, IScannedObject, RecipeBlockFieldListResult, RecipeCockpitRecipeWriter, RecipeFixedValueKind } from './RecipeCockpitRecipeWriter';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { RecipeCockpitObjectSelection, IObjectSelectionExclusion, IObjectSelectionDisabledLookup } from './RecipeCockpitObjectSelection';
import {
    ICreateReadinessInput,
    IRecipeCockpitCreateReadinessViewModel,
    IOutsideLookupParents,
    IPickableLookup,
    LookupParentChoice,
    RecipeCockpitRecordCreation,
    RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD
} from './RecipeCockpitRecordCreation';
import { CollectionsApiService, DataSetInsertOutcome, DataSetRecordPreparer, IDataSetInsertResult } from '../CollectionsApiService/CollectionsApiService';
import { IFieldSize } from '../ObjectInfoWrapper/FieldInfo';
import { RelationshipService } from '../RelationshipService/RelationshipService';
import { DATASET_COLLECTIONS_API_FOLDER_NAME, DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import {
    IRecipeCockpitDatasetRecordCountViewModel,
    IRecipeCockpitTreeDatasetViewModel,
    IRecipeCockpitTreeHistoryTargets,
    IRecipeCockpitTreeHistoryViewModel,
    RecipeCockpitTreeHistory
} from './RecipeCockpitTreeHistory';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RunFakerConfirmation } from '../ExtensionCommandService/RunFakerConfirmation';
import { IScratchOrgPlan, ScratchOrgService, ScratchOrgSetupOutcome, ScratchOrgSetupPhase } from '../ScratchOrgService/ScratchOrgService';
import { PARENT_PICKER_RANDOM_LABEL, VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';

// SHARED WITH THE TESTS SO THE PANEL'S VIEW TYPE CANNOT DRIFT FROM WHAT IS ASSERTED
export const RECIPE_COCKPIT_VIEW_TYPE = 'treecipe.recipeCockpit';

export const RECIPE_COCKPIT_PANEL_TITLE = 'Recipe Cockpit';

// WHAT THE PANEL SHOWS BEFORE THE HOST HAS ANSWERED, SO A HANDSHAKE THAT NEVER COMPLETES IS VISIBLE RATHER THAN BLANK
export const RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT = 'Connecting to the Treecipe extension host…';

export type RecipeCockpitPaletteToken =
    | 'page' | 'surface' | 'border' | 'header'
    | 'text' | 'muted' | 'accent' | 'onAccent'
    | 'rowHover' | 'chipBg' | 'chipText'
    | 'added' | 'removed' | 'changed'
    | 'disabledBg' | 'disabledText'
    | 'excludedOverlay';

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
    changed: '#B45309',
    disabledBg: '#E5E7EB',
    disabledText: '#4B5563',
    // SLATE GRAY AT 40%, LAID OVER AN OBJECT THE STRUCTURE TAB EXCLUDES (#219); --sdt-text UNDER IT HOLDS 4.5:1, A TEST COMPOSITES IT
    excludedOverlay: 'rgba(148, 163, 184, 0.40)'
});

export const RECIPE_COCKPIT_LOAD_PHASES = {
    findingRuns: 'Finding generated recipe runs…',
    readingRun: 'Reading the generated recipe run…'
};




export const RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND = 'treecipe.generateTreecipe';
// THE COCKPIT RELOADS THE RUN GENERATION WROTE, SO ITS COMPLETION TOAST WOULD ONLY PULL THE READER OUT OF THE PANEL (#206)
export const RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS = { isCompletionNotificationSuppressed: true };

export const RECIPE_COCKPIT_NO_RUN_MESSAGE = 'No generated recipe run was found under treecipe/GeneratedRecipes. Generate Treecipe writes one from the object metadata in this workspace, and the cockpit opens it when it finishes.';

// OFFERED ONLY IN THE NO-RUN EMPTY STATE (#214)
export const RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL = 'Generate Treecipe';
export const RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL = 'Generating…';

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

/*
    The reader's place the panel keeps through vscodeApi.setState (#222). The version is the shape:
    a place saved in any other shape is not read, rather than read as something it was not.
*/
export const RECIPE_COCKPIT_PANEL_PLACE_VERSION = 2;
// A PLACE SAVED BEFORE #255 NAMES THE Structure AND Data-by-Org TABS; IT IS READ THROUGH RECIPE_COCKPIT_TREE_TAB_RENAMES RATHER THAN DROPPED
export const RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB = 1;
export const RECIPE_COCKPIT_TREE_TAB_RENAMES: Readonly<Record<string, string>> = Object.freeze({ structure: 'treecipe', dataByOrg: 'compare' });
/*
    Tabs a card no longer has, read from a place of EITHER version after the renames (Previous Versions
    #265, Compare #266, which a version 1 place calls dataByOrg and renames to compare first): a card
    saved on one opens on Treecipe, and that tab's search text and opened rows are dropped -- never
    moved onto another tab's search. Removing another tab is adding its name here.
*/
export const RECIPE_COCKPIT_REMOVED_TREE_TABS: readonly string[] = Object.freeze(['versions', 'compare', 'dataByOrg']);
export const RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY = 200;

/*
    The same place, kept in workspaceState as well (#230) so it outlives the panel: a close or a
    window reload throws the webview's own state away. Written as it changes, at most once per
    RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY, because a reload or a crash may never run onDidDispose.
*/
export const RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY = 'treecipe.recipeCockpit.panelPlace';
export const RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY = 500;
// WHAT A PLACE READ BACK FROM workspaceState MAY HOLD -- AN ENTRY PAST EITHER BOUND IS DROPPED, NEVER CUT TO FIT
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES = 10000;
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH = 1000;
// THE WHOLE PLACE, SERIALIZED: THE BOUNDS ABOVE ARE PER LIST AND MULTIPLY. A REAL ONE IS A FEW KB, 1,000 OBJECTS OPENED IN 10 CARDS ABOUT 1.5 MB
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH = 4000000;

// THE FIELD TYPES WHOSE ROWS EXPAND TO THEIR VALUES IN THE STRUCTURE TAB
export const RECIPE_COCKPIT_PICKLIST_FIELD_TYPES: readonly string[] = ['Picklist', 'MultiselectPicklist'];

export const RECIPE_COCKPIT_TREE_TITLE_PREFIX = 'Relationship Tree';

export const RECIPE_COCKPIT_UNGROUPED_TREE_TITLE = 'Not in a relationship tree';

/*
    A tree card's own name and favorite (#235), kept in workspaceState by the tree's FOLDER NAME --
    the one identity a tree keeps across runs, and the one a regeneration of the same objects writes
    again -- so neither renumbers when another tree is added, and both survive a reload.
*/
export const RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY = 'treecipe.recipeCockpit.treePreferences';

/*
    What each tree folder's Structure tab excluded directly (#219) and the fields it unticked (#220);
    the cascade and the locks are recomputed, never stored. Version 2 added the fields; a version 1
    entry still reads, as objects with nothing unticked.
*/
export const RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY = 'treecipe.recipeCockpit.objectSelection';
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION = 4;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES = 3;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS = 2;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS = 1;

export const RECIPE_COCKPIT_REFRESH_ORGS_LABEL = 'Refresh orgs';

// WHY A FIELD'S CHECKBOX IS DISABLED (#220); EACH IS THE HOST'S ANSWER, WHICH THE PANEL DRAWS
export const RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON = 'parent excluded';
export const RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON = 'record-type sections depend on it';
export const RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX = 'controls ';
export const RECIPE_COCKPIT_EVERY_FIELD_UNTICKED_WARNING = 'every field unticked — records are generated with no fields set';
export const RECIPE_COCKPIT_RESET_SELECTION_LABEL = 'Reset selection';

/*
    Why a field's fixed-value pin is disabled (#262). The panel draws the same rule from what the
    model already carries, and the host re-derives it before it writes, so the reasons are shared.
    A lock of #220 (RecordTypeId, a controlling field, a parent-excluded lookup) gives its own reason.
*/
export const RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON = 'object excluded';
export const RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON = 'unticked';
export const RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON = 'the record type is chosen by name';
export const RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON = 'a lookup is wired by the tree or filled by the insert';
export const RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX = 'depends on ';
export const RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES = ['Lookup', 'MasterDetail', 'Hierarchy'];
export const RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES = ['Number', 'Currency', 'Percent'];
export const RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH = 32768;
export const RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL = 'Reset';
export const RECIPE_COCKPIT_TREE_PREFERENCES_VERSION = 1;
export const RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH = 80;
export const RECIPE_COCKPIT_RENAME_TREE_ACTION_LABEL = '✎';

/*
    The cockpit's first SVG glyphs (#219, #257): a chain link, one path per state, drawn by the panel
    script with createElementNS and coloured only from the --sdt-* palette by CSS. Joined is included;
    broken -- the links pulled apart, a spark either side of the gap -- is excluded, and a dashed broken
    link is excluded because a parent is. The SHAPE says the state, never the colour alone. Both are
    stroked in a 24x24 box and turned to the familiar diagonal. They fetch nothing, so the CSP, the
    nonce-only shell builder and localResourceRoots: [] are unchanged.
*/
export const RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX = '0 0 24 24';
export const RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM = 'rotate(-45 12 12)';
export const RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH = 'M6 8 H10 A4 4 0 0 1 10 16 H6 A4 4 0 0 1 6 8 Z M14 8 H18 A4 4 0 0 1 18 16 H14 A4 4 0 0 1 14 8 Z';
export const RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH = 'M4.5 8 H6.5 A4 4 0 0 1 6.5 16 H4.5 A4 4 0 0 1 4.5 8 Z M17.5 8 H19.5 A4 4 0 0 1 19.5 16 H17.5 A4 4 0 0 1 17.5 8 Z M12 3.5 V6 M12 18 V20.5';
/*
    A field's fixed-value pin (#262), built the same way as the chain link: one path, stroked from the
    palette by CSS, and filled while the field has a fixed value -- so the shape, aria-pressed, the
    title and the row's "fixed" badge all say it, never the colour alone.
*/
export const RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH = 'M9 3 H15 L14 9 L17 12 V14 H7 V12 L10 9 Z M12 14 V21';
export const RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL = 'fixed';
/*
    The ▸/▾ of a tree card, a Treecipe object and a picklist field (#277), drawn like the chain link: a
    font's triangle sits on the text baseline, so no button rule could centre it. Each path's box is
    centred on (12, 12) in the same 24x24 view box, and filled from the palette by CSS.
*/
export const RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH = 'M7.5 5 L16.5 12 L7.5 19 Z';
export const RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH = 'M5 7.5 L19 7.5 L12 16.5 Z';
export const RECIPE_COCKPIT_FAVORITE_TREE_LABEL = '★';
export const RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL = '☆';
export const RECIPE_COCKPIT_FAVORITES_ONLY_LABEL = 'Favorites only';
export const RECIPE_COCKPIT_NO_FAVORITES_MESSAGE = 'No favorite trees in this run. Turn off Favorites only to see all trees.';

export const RECIPE_COCKPIT_INSERT_DATASET_COMMAND = 'treecipe.insertDataSetBySelectedDirectory';

// A TREE CARD'S ▶ Run Faker HANDS ITS RECIPE FILE TO THIS COMMAND, WHICH KEEPS ITS CONFIRMATION AND BACKEND CHECK
export const RECIPE_COCKPIT_RUN_FAKER_COMMAND = 'treecipe.runFakerByRecipe';
export const RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL = '▶ Run Faker';
export const RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL = 'Running Faker…';

// A SELF-LOOKUP ITERATION'S "+" ADDS ONE OF ITS OBJECT'S FRIENDS BENEATH IT (#197)
export const RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL = '+';
export const RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL = 'Add';

// IN THE ORDER A CARD DRAWS THEM; TREECIPE IS SELECTED BY DEFAULT, AND THE DATA SETS TAB IS DRAWN ONLY FOR A CARD WITH A HISTORY
export const RECIPE_COCKPIT_TREE_TABS = ['treecipe', 'datasets'] as const;

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

    It names the four things that decide whether enabling is a mistake for them: that the panel is
    deliberately incomplete rather than broken, that it can insert records into a sandbox it is
    pointed at (#180), that the switch is scoped to THIS workspace and
    reversible from settings, and where the open work is listed. The url is repeated in the text as
    well as offered as a button because a VS Code dialog renders its detail as plain text -- there
    is no clickable link in a modal, so the button is the link and this line is what a reader can
    copy if they would rather not hand the dialog a browser.
*/
export const RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL = `Every Recipe Cockpit slice ships behind this flag while the panel is being built, so what you are turning on is unfinished on purpose: it traverses a generated recipe, compares its fields with an org you choose, writes back into a recipe only when you add a friend to a nested self-lookup iteration (and asks first), and its layout, its messages and the shape of what it shows will change between releases.

It CAN WRITE TO AN ORG: the Treecipe tab's "Generate fake data and insert" generates a whole relationship tree and inserts it into the org you choose there. That picker never lists or connects to production: it offers only orgs the Salesforce CLI knows as a sandbox or a scratch org and reports as connected (to answer that, the CLI pings each authorized org's token, once per session or per ⟳; Treecipe itself connects only to the org you select), and the insert is offered only for an org that reports itself as a sandbox and asks you to confirm each time. It inserts the way Insert Data Set by Directory does: you choose all-or-none, and Cancel deletes what that insert saved. The Treecipe tab's "+ New scratch org" creates a scratch org through the Dev Hub you pick from the connected Dev Hubs (every time, even when there is only one) and deploys this project's source to it, after you confirm; the cockpit never deletes an org. "Deploy this metadata…", on every tree's Treecipe tab, deploys that tree's custom objects (each with everything in its source folder) and the custom fields of its standard objects from this workspace's source to the org selected there, or to a sandbox or scratch org you pick when none is, after a confirmation that lists the files, and only once the org answers again that it is a sandbox.

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
    the bare type, which is what the diff compares and what an org-only row is typed by.

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
    lineNumber?: number;
    fields: IRecipeCockpitFieldViewModel[];
    // SET ONLY ON AN OBJECT WITH iterations, WHERE THE NICKNAME IS WHAT TELLS ITS OCCURRENCES APART
    nickname?: string;
    iterations?: IRecipeCockpitObjectIterationViewModel[];
    // WRITTEN MORE THAN ONCE WITH NO NICKNAME TO TELL THE OCCURRENCES APART, SO ITS TREE ICON IS REFUSED (#219)
    hasIndistinctOccurrences?: true;
    // A FIELD OTHER THAN RecordTypeId CARRIES A RECORD-TYPE SECTION, SO RecordTypeId STAYS TICKED (#220)
    hasRecordTypeSections?: true;
    /*
        The first occurrence's own "count:" (#255), set only when it has exactly one that is a plain
        whole number -- which is the line a count the reader sets replaces. countParentObjectApiName
        is the object whose friends: block holds it, so its count is records PER that parent record.
    */
    recordCount?: number;
    countParentObjectApiName?: string;
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
/*
    insertableFriendObjectApiNames is set only on a SELF-LOOKUP iteration -- nested under another
    occurrence of its own object -- with at least one friend to offer: the friends the occurrence
    above it carries that it does not, which is what its "+" lists (#197). It is the writer's own
    answer (RecipeCockpitRecipeWriter.listInsertableFriendObjectApiNames), so the panel never offers
    a friend the writer would refuse for a reason the file already shows.
*/
export interface IRecipeCockpitObjectIterationViewModel {
    nickname: string;
    lineNumber: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fields: IRecipeCockpitObjectIterationFieldViewModel[];
    insertableFriendObjectApiNames?: string[];
}

// ONE LOOKUP TYING AN OBJECT TO A PARENT IN ITS OWN TREE; A SELF-LOOKUP NAMES ITS OWN OBJECT AS THE PARENT
export interface IRecipeCockpitParentLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    An object as a tree lists it. Its fields are not repeated here: the panel finds them by name in
    the recipe's objects, so every card that lists an object draws the one posted field model.
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
    the panel draws no Previously Used Data Sets tab for them.
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
    // THE READER'S OWN NAME AND FAVORITE (#235), SET ONLY WHEN THEY HAVE ONE; title STAYS THE DEFAULT THE NAME REPLACES
    customName?: string;
    isFavorite?: boolean;
    // SET ONLY WHEN SOMETHING IN THE CARD IS EXCLUDED (#219), SO A CARD WITH EVERYTHING INCLUDED POSTS AS IT ALWAYS DID
    objectSelection?: IRecipeCockpitTreeObjectSelectionViewModel;
    // SET ONLY WHEN A FIELD OF THE CARD IS UNTICKED OR CANNOT BE (#220)
    fieldSelection?: IRecipeCockpitTreeFieldSelectionViewModel;
    // SET ONLY WHEN THE READER CHANGED A COUNT (#255), AND LISTING ONLY THE OBJECTS WHOSE COUNT DIFFERS FROM THE RECIPE'S
    objectCounts?: IRecipeCockpitObjectCountViewModel[];
    // SET ONLY WHEN A FIELD OF THE CARD HAS A FIXED VALUE (#262) A LOCK DOES NOT HOLD BACK
    fixedValues?: IRecipeCockpitFixedValueViewModel[];
}

// THE VALUE THE READER TYPED FOR A FIELD (#262); kind IS THE HOST'S, FROM THE FIELD'S TYPE, AND DECIDES HOW THE COPY WRITES IT
export interface IRecipeCockpitFixedValueViewModel {
    objectApiName: string;
    fieldApiName: string;
    value: string;
    kind: RecipeFixedValueKind;
}

export interface IRecipeCockpitObjectCountViewModel {
    objectApiName: string;
    count: number;
}

// A FIELD WHOSE CHECKBOX THE HOST REFUSES, AND THE REASON THE ROW SHOWS
export interface IRecipeCockpitLockedFieldViewModel {
    fieldApiName: string;
    reason: string;
}

/*
    One object's fields as the host decided them (#220). excludedFieldApiNames is what generation
    leaves out: the reader's unticked fields, less any field a lock now holds ticked. A field a lock
    holds is drawn ticked and disabled, except a parent-excluded lookup, which is left out by the
    object cascade and drawn unticked and disabled.
*/
export interface IRecipeCockpitObjectFieldSelectionViewModel {
    objectApiName: string;
    excludedFieldApiNames: string[];
    lockedFields: IRecipeCockpitLockedFieldViewModel[];
    isEveryFieldExcluded?: true;
}

// ONLY THE OBJECTS WITH SOMETHING TO SAY, SO THE PAYLOAD GROWS WITH THE SELECTION RATHER THAN THE RECIPE
export interface IRecipeCockpitTreeFieldSelectionViewModel {
    objects: IRecipeCockpitObjectFieldSelectionViewModel[];
}

// WHAT ▶ Run Faker HANDS treecipe.runFakerByRecipe FOR A CARD THAT LEAVES SOMETHING OUT -- THE SHAPE ITS HANDLER TYPE-CHECKS
export interface IRecipeCockpitRunFakerFilteredRecipe {
    recipeText: string;
    excludedObjectApiNames: string[];
    excludedFieldApiNamesByObject?: Record<string, string[]>;
    objectCountsByObject?: Record<string, number>;
    fixedValuesByObject?: Record<string, Record<string, string>>;
}

// WHAT workspaceState HOLDS FOR THE STRUCTURE TAB, BY TREE FOLDER NAME
export interface IRecipeCockpitTreeSelections {
    excludedObjectApiNamesByFolderName: Map<string, Set<string>>;
    excludedFieldApiNamesByFolderName: Map<string, Map<string, Set<string>>>;
    // THE RECORD COUNTS THE READER SET (#255), BY TREE FOLDER THEN OBJECT; A COUNT EQUAL TO THE RECIPE'S OWN IS NEVER STORED
    objectCountsByFolderName: Map<string, Map<string, number>>;
    // THE VALUES THE READER FIXED (#262), BY TREE FOLDER, OBJECT THEN FIELD
    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>>;
}

/*
    The HOST's answer for one card (#219): what is left out of generation and why, and which lookups
    of an included object point at an excluded parent. The panel draws it and decides nothing. The
    counts are over the objects the card DRAWS (those with a recipe), which is what its header counts.
*/
export interface IRecipeCockpitTreeObjectSelectionViewModel {
    exclusions: IObjectSelectionExclusion[];
    disabledLookups: IObjectSelectionDisabledLookup[];
    includedObjectCount: number;
    objectCount: number;
}

// A CARD'S EXCLUSIONS OR UNTICKED FIELDS CHANGED: REDRAWN IN PLACE, TAGGED WITH THE MODEL IT IS ABOUT
export interface IRecipeCockpitObjectSelectionMessage {
    command: 'objectSelection';
    renderSequence: number;
    treeKey: string;
    objectSelection?: IRecipeCockpitTreeObjectSelectionViewModel;
    fieldSelection?: IRecipeCockpitTreeFieldSelectionViewModel;
    objectCounts?: IRecipeCockpitObjectCountViewModel[];
    fixedValues?: IRecipeCockpitFixedValueViewModel[];
}

// WHAT workspaceState HOLDS FOR THE CARDS, BY TREE FOLDER NAME; BOTH KEYED BY NAMES FROM DISK, SO NEITHER IS A PLAIN {}
export interface IRecipeCockpitTreePreferences {
    customNamesByFolderName: Map<string, string>;
    favoriteFolderNames: Set<string>;
}

// A CARD'S NAME OR FAVORITE CHANGED: EVERY CARD OF THAT FOLDER, REDRAWN IN PLACE RATHER THAN BY A RELOAD
export interface IRecipeCockpitTreePreferencesMessage {
    command: 'treePreferences';
    renderSequence: number;
    trees: Array<{ treeKey: string; customName?: string; isFavorite: boolean }>;
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
    What normalizeObjectsWrapper reads from the wrapper. picklistDisplayValuesByObjectApiName is
    kept off the field view model so the model posted to the panel does not grow by every picklist's
    values: the panel asks for one row's values when it is opened.
*/
export interface IRecipeCockpitNormalizedObjectsWrapper {
    objects: IRecipeCockpitObjectViewModel[];
    notices: string[];
    isObjectsWrapper: boolean;
    fieldlessObjectApiNames: Set<string>;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    recipeTrees: IRecipeCockpitWrapperTree[];
    parentLookupsByObjectApiName: Map<string, IRecipeCockpitParentLookupViewModel[]>;
    // RelationshipService's LEVEL PER OBJECT, HOST-ONLY: WHAT A FILTERED COPY NESTS A KEPT FRIEND BY (#219)
    objectLevelsByApiName?: Map<string, number>;
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
    recordCount?: number;
    countParentObjectApiName?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    iterations?: IRecipeSourceObjectIterationEntry[];
    // A LATER OCCURRENCE WAS LEFT TO THE FIRST: NO NICKNAME TELLS THEM APART, SO THE OBJECT CANNOT BE EXCLUDED (#219)
    hasIndistinctOccurrences?: true;
    hasRecordTypeSections?: true;
}

export interface IRecipeSourceObjectIterationEntry {
    nickname: string;
    lineNumber: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    insertableFriendObjectApiNames?: string[];
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
    count?: unknown;
    datasetFolderName?: unknown;
    tab?: unknown;
    chooseOrg?: unknown;
    objectNickname?: unknown;
    friendObjectApiName?: unknown;
    message?: unknown;
    stack?: unknown;
    place?: unknown;
    nickname?: unknown;
    included?: unknown;
    updateSequence?: unknown;
    requestSequence?: unknown;
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
    // A PLACE KEPT IN workspaceState (#230), FOR A DOCUMENT WHOSE OWN getState HAS NONE: A PANEL OPENED AFTER A CLOSE OR A WINDOW RELOAD
    restorePlace?: IRecipeCockpitPanelPlace;
}

/*
    The reader's place as the panel saves it (#222) and as workspaceState keeps it (#230): names,
    each tab's search as typed, whether the toolbar's org picker was in use and a scroll offset.
    No path, picklist value, org label or username -- normalizePanelPlace keeps nothing else.
*/
export interface IRecipeCockpitPanelTreePlace {
    treeKey: string;
    isExpanded: boolean;
    selectedTab: RecipeCockpitTreeTab;
    searchQueries: Partial<Record<RecipeCockpitTreeTab, string>>;
    expandedObjectKeys: string[];
    openPicklistKeys: string[];
}

export interface IRecipeCockpitPanelPlace {
    version: number;
    runFolderName: string;
    isOrgPickerInUse: boolean;
    // A PLACE SAVED BEFORE #235 HAS NONE, AND READS AS THE FILTER OFF -- WHICH IS WHAT IT WAS
    isFavoritesOnly: boolean;
    scrollY: number;
    trees: IRecipeCockpitPanelTreePlace[];
}

export interface IRecipeCockpitTreeFocus {
    treeKey: string;
    tab: RecipeCockpitTreeTab;
}

export interface IRecipeCockpitLoadFailedMessage {
    command: 'loadFailed';
    message: string;
}

// ONE PICKLIST ROW'S VALUES, ANSWERING THE PANEL'S loadPicklistValues FOR THE MODEL renderSequence NAMES
export interface IRecipeCockpitPicklistValuesMessage extends IRecipeCockpitPicklistDisplayValues {
    command: 'picklistValues';
    objectApiName: string;
    fieldApiName: string;
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
/*
    hiddenOrgCount is how many authorized orgs were left out -- because the CLI does not know them to
    be a sandbox or a scratch org (Data-by-Org never lists, and so never connects to, production), or
    because it does not report them connected -- and hiddenOrgNote says so, counting each reason.
    forgottenOrgNotice names the org chosen last when it was forgotten for no longer being connected.
*/
export interface IRecipeCockpitDataOrgListMessage {
    command: 'dataOrgList';
    orgLabels: string[];
    selectedOrgIndex: number | null;
    noOrgsMessage: string;
    hiddenOrgCount: number;
    hiddenOrgNote: string;
    forgottenOrgNotice: string;
    renderSequence: number;
}

export const RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE = 'No sandbox or scratch org is authorized. The Treecipe tab connects only to sandboxes and scratch orgs: authorize one with "sf org login web --instance-url https://test.salesforce.com" and try again.';

// WHAT DATA-BY-ORG SHOWS IN PLACE OF THE DROPDOWN WHILE THE CLI IS ASKED WHICH ORGS ARE CONNECTED
export const RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT = 'Checking org connections…';

export const RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE = 'No connected sandbox or scratch org is authorized. The Treecipe tab lists only orgs the Salesforce CLI reports as connected: re-authorize one with "sf org login web --instance-url https://test.salesforce.com", then press ⟳.';

/*
    The org Data-by-Org has selected. orgTypeLabel is '' while the Organization query is still
    out; isSandbox is null until it answers, and stays null when it failed. failureMessage is set
    when the org could not be connected to, or did not answer that it is a sandbox, and is then
    the whole answer about it. requestSequence names the selection, so an answer for an org the
    reader has since replaced is dropped.
*/
export interface IRecipeCockpitDataOrgSelectionMessage {
    command: 'dataOrgSelection';
    orgIndex: number;
    orgLabel: string;
    orgTypeLabel: string;
    isSandbox: boolean | null;
    failureMessage: string;
    requestSequence: number;
    renderSequence: number;
}

/*
    What the last tree insert (#255) of one tree did, as its Treecipe tab shows it. Kept on the host
    per org USERNAME and tree, and posted with the readiness of the org it was made in, so it
    survives the reload an insert ends with. outcome is the shared insert's: "cancelled" and
    "stopped" (an all-or-none failure) were rolled back.
*/
export interface IRecipeCockpitInsertResultViewModel {
    treeKey: string;
    savedCount: number;
    failedCount: number;
    outcome: DataSetInsertOutcome;
    isRolledBack: boolean;
}

// ONE OBJECT OF ONE TREE AS THE TREE INSERT SENDS IT: THE FIELDS OF ITS BLOCK, OR WHY THE BLOCK COULD NOT BE READ
export interface IRecipeCockpitCreateTarget {
    treeKey: string;
    objectApiName: string;
    recipeFieldApiNames?: string[];
    recipeFieldRefusalReason?: string;
    // UNTICKED IN THAT TREE'S STRUCTURE TAB (#220): LEFT OUT OF THE CUT, AND A REASON WHEN THE ORG REQUIRES ONE
    excludedFieldApiNames?: string[];
}

export interface IRecipeCockpitCreateReadinessByTarget {
    byObjectApiName: Map<string, IRecipeCockpitCreateReadinessViewModel>;
    // KEYED BY buildTreeObjectKey
    byCreateKey: Map<string, IRecipeCockpitCreateReadinessViewModel>;
}

/*
    Whether each object the trees list is ready to be inserted into the org the selection names --
    a tree's "Generate fake data and insert" is offered only while every object it inserts is --
    and the last insert of each tree made there.
*/
export interface IRecipeCockpitDataOrgReadinessMessage {
    command: 'dataOrgReadiness';
    objects: IRecipeCockpitCreateReadinessViewModel[];
    // ONE PER TREE AND OBJECT, FOR THAT TREE'S BLOCK (#210); A ROW READS ITS OWN BEFORE ITS OBJECT'S
    createTargets: IRecipeCockpitCreateReadinessViewModel[];
    insertResults: IRecipeCockpitInsertResultViewModel[];
    requestSequence: number;
    renderSequence: number;
}

// AN INSERT IN FLIGHT DISABLES EVERY TREE'S INSERT; REPLAYED ON A RELOAD SO A RELOADED DOCUMENT DOES NOT OFFER A SECOND
export interface IRecipeCockpitInsertStateMessage {
    command: 'insertState';
    isRunning: boolean;
    treeKey: string;
}

/*
    Whether a friend is being added to a self-lookup iteration from this panel. Every "+" is
    disabled while one is, since the host writes one at a time, and the message is replayed on a
    reveal so a reloaded document does not offer a second.
*/
export interface IRecipeCockpitAddFriendStateMessage {
    command: 'addFriendState';
    isRunning: boolean;
}

/*
    The "+ New scratch org" run (#200): while isRunning, the button, every "+ Create" and the org
    dropdown are disabled, and statusText is the phase. Once it ends, statusText is how it ended,
    and hasOutput says whether "View output" has a result file to open -- the path stays on the host.
    Stored and replayed, so a reloaded document shows where the run is.
*/
export interface IRecipeCockpitScratchOrgStateMessage {
    command: 'scratchOrgState';
    isRunning: boolean;
    statusText: string;
    isFailure: boolean;
    hasOutput: boolean;
}

/*
    "Deploy this metadata…" (#211, #273): while isRunning, every tree's insert, every deploy button
    and the org picker are disabled, and statusText is the phase. Once it ends, statusText is how it
    ended, and hasOutput says whether "View output" has a result file -- the path stays on the host.
    treeKey names the card the line is drawn on. Stored and replayed.
*/
export interface IRecipeCockpitMetadataDeployStateMessage {
    command: 'metadataDeployState';
    isRunning: boolean;
    treeKey: string;
    statusText: string;
    isFailure: boolean;
    hasOutput: boolean;
}

export const RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL = 'Deploy this metadata…';

export const RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL = 'Deploy';

export const RECIPE_COCKPIT_METADATA_DEPLOY_ORG_PLACEHOLDER = 'Choose the sandbox or scratch org to deploy this tree\'s metadata to';

export const RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL = 'Create scratch org';

export const RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER = 'Choose the Dev Hub to create the scratch org through';

export const RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT: Record<ScratchOrgSetupPhase | 'listing', string> = {
    creating: 'Creating scratch org…',
    deploying: 'Deploying source…',
    listing: 'Listing the new scratch org…'
};

export type RecipeCockpitHostMessage = IRecipeCockpitLoadPhaseMessage
                                        | IRecipeCockpitRecipeDataMessage
                                        | IRecipeCockpitLoadFailedMessage
                                        | IRecipeCockpitPicklistValuesMessage
                                        | IRecipeCockpitDatasetRecordCountsMessage
                                        | IRecipeCockpitRunFakerStateMessage
                                        | IRecipeCockpitDataOrgListMessage
                                        | IRecipeCockpitDataOrgSelectionMessage
                                        | IRecipeCockpitDataOrgReadinessMessage
                                        | IRecipeCockpitInsertStateMessage
                                        | IRecipeCockpitAddFriendStateMessage
                                        | IRecipeCockpitTreePreferencesMessage
                                        | IRecipeCockpitObjectSelectionMessage
                                        | IRecipeCockpitScratchOrgStateMessage
                                        | IRecipeCockpitMetadataDeployStateMessage
                                        | IRecipeCockpitDatasetAddedMessage;

/*
    One data set an action just wrote, posted IN PLACE of a reload (#226): the cards it joins, its
    history row, and -- when the tree insert wrote it -- the card's new insert result. renderSequence
    names the model it was added to, and the panel drops it for any other. updateSequence is this
    post's own number, echoed back in "partialRendered" once the row is drawn: only that
    acknowledgement makes the new row's Open and Insert… usable, as "rendered" does for a model.
*/
export interface IRecipeCockpitDatasetAddedMessage {
    command: 'datasetAdded';
    treeKeys: string[];
    dataset: IRecipeCockpitTreeDatasetViewModel;
    insertResult?: IRecipeCockpitInsertResultViewModel;
    renderSequence: number;
    updateSequence: number;
}

export const RECIPE_COCKPIT_INSERT_CONFIRM_LABEL = 'Generate and insert';

export const RECIPE_COCKPIT_INSERT_ACTION_LABEL = 'Generate fake data and insert';

export const RECIPE_COCKPIT_INSERT_RUNNING_LABEL = 'Inserting…';

// A STORED INSERT RESULT, WITH THE HOST-ONLY RESULTS FILE "View errors" OPENS
export interface IRecipeCockpitStoredInsertResult {
    viewModel: IRecipeCockpitInsertResultViewModel;
    resultsFilePath: string;
}

// THE SLICE OF vscode.Memento THE COCKPIT USES, SO A TEST CAN HAND IN A MAP
export interface IRecipeCockpitWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export const RECIPE_COCKPIT_DATA_ORG_STATE_KEY = 'treecipe.recipeCockpit.dataByOrgUsername';

/*
    Host-only: the org Data-by-Org has selected. orgDetail carries the USERNAME, which the panel is
    never told and never posts.
*/
export interface IRecipeCockpitDataOrgSelection {
    orgIndex: number;
    orgDetail: IAuthenticatedOrgDetail;
    requestSequence: number;
    orgTypeDetail?: IOrgTypeDetail;
    /*
        Set once this selection's describes have answered and its readiness was posted (#273). A
        deploy to the selection waits for it: a readiness built from describes taken BEFORE a
        deploy, posted after it, would put back the reasons the deploy just removed.
    */
    isReadinessPosted?: boolean;
}

// THE LOADER'S WHOLE ANSWER: WHAT IS POSTED, AND THE PICKLIST VALUES THE PANEL ASKS FOR ONE ROW AT A TIME
export interface IRecipeCockpitLoadedRecipe {
    recipeViewModel: IRecipeCockpitRecipeViewModel;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    objectLevelsByApiName?: Map<string, number>;
}

/*
    The allow-lists of the tree cards' actions, one per action, each a set of NAMES drawn from the
    rendered model's trees. The three data set actions are keyed by data set folder name.
*/
export interface IRecipeCockpitTreeHistoryAllowLists {
    openableDatasetFolderNames: Set<string>;
    insertableDatasetFolderNames: Set<string>;
    countableDatasetFolderNames: Set<string>;
    runnableTreeKeys: Set<string>;
    // THE CARDS ✎ AND ☆ ARE DRAWN ON: EVERY CARD WITH A FOLDER, WHICH LEAVES OUT ONLY THE UNGROUPED ONE
    nameableTreeKeys: Set<string>;
    // "<treeKey>\n<object>" FOR EVERY TREE ICON THE PANEL DRAWS CLICKABLE (#219): A CARD WITH A FOLDER, AN OBJECT IT DRAWS, TOLD APART FROM ANY OTHER OCCURRENCE
    selectableObjectKeys: Set<string>;
    // "<treeKey>\n<object>\n<field>" FOR EVERY FIELD CHECKBOX (#220): A SELECTABLE OBJECT'S FIELDS THAT HAVE A LINE IN THE RECIPE
    selectableFieldKeys: Set<string>;
}

/*
    What the host should DO about a panel message -- the router's answer, kept as data so the
    decision is asserted without a live webview and the side effects live in one executor.
*/
export type RecipeCockpitPanelAction =
    { kind: 'replay'; hostMessages: RecipeCockpitHostMessage[] }
    | { kind: 'activateActions' }
    | { kind: 'activateDatasetActions' }
    | { kind: 'reportRenderFailure'; failureDescription: string; failureStack: string; invalidatesPanel: boolean }
    | { kind: 'openSource'; filePath: string; lineNumber: number }
    | { kind: 'selectRun'; runFolderName: string }
    | { kind: 'generateTreecipe' }
    | { kind: 'postPicklistValues'; hostMessage: IRecipeCockpitPicklistValuesMessage }
    | { kind: 'loadDatasetRecordCounts'; datasetFolderName: string; datasetFolderPath: string; renderSequence: number }
    | { kind: 'openDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'insertDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'runFaker'; treeKey: string; recipeFilePath: string }
    | { kind: 'postRunFakerState'; hostMessage: IRecipeCockpitRunFakerStateMessage }
    | { kind: 'loadDataOrgs' }
    | { kind: 'selectDataOrg'; orgIndex: number }
    | { kind: 'refreshDataOrgs' }
    | { kind: 'insertTree'; treeKey: string; recipeFilePath: string }
    | { kind: 'postInsertState'; hostMessage: IRecipeCockpitInsertStateMessage }
    | { kind: 'viewInsertErrors'; resultsFilePath: string }
    | { kind: 'addIterationFriend'; treeKey: string; objectApiName: string; iterationNickname: string; friendObjectApiName: string; recipeFilePath: string }
    | { kind: 'postAddFriendState'; hostMessage: IRecipeCockpitAddFriendStateMessage }
    | { kind: 'renameTree'; folderName: string }
    | { kind: 'toggleFavoriteTree'; folderName: string }
    | { kind: 'setObjectIncluded'; treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }
    | { kind: 'setFieldIncluded'; treeKey: string; folderName: string; objectApiName: string; fieldApiName: string; isIncluded: boolean }
    | { kind: 'setAllFieldsIncluded'; treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }
    | { kind: 'resetTreeSelection'; folderName: string }
    | { kind: 'setObjectCount'; treeKey: string; folderName: string; objectApiName: string; count: number }
    | { kind: 'setFieldFixedValue'; treeKey: string; folderName: string; objectApiName: string; fieldApiName: string }
    | { kind: 'persistPlace'; place: IRecipeCockpitPanelPlace }
    | { kind: 'createScratchOrg' }
    | { kind: 'postScratchOrgState'; hostMessage: IRecipeCockpitScratchOrgStateMessage }
    | { kind: 'viewScratchOrgOutput'; outputFilePath: string }
    | { kind: 'deployTreeMetadata'; treeKey: string; isSelectedOrg: boolean }
    | { kind: 'postMetadataDeployState'; hostMessage: IRecipeCockpitMetadataDeployStateMessage }
    | { kind: 'viewMetadataDeployOutput'; outputFilePath: string };

/*
    Everything the host holds for the one panel, replaced wholesale when the panel is (re)opened --
    a reopen keeps only the run on screen, and the insert results and request sequence of the
    Treecipe tab's org selection.

    Two generations of allow-list: the PENDING pair is built when a model is posted, and only the
    panel's "rendered" acknowledgement promotes it to ACTIVE. A post succeeding says the message
    left the host, not that anything is on screen -- and every reload of the document (each reveal
    of a hidden tab) empties the active pair until the replayed model is drawn again. An action is
    honoured only when the panel has confirmed the row it came from is actually drawn.

    picklistDisplayValuesByObjectApiName belongs to recipeDataMessage and is replaced with it. It is
    posted one row at a time, only for a row the rendered model marked as a picklist (the loadable
    picklist keys, another pending/active pair).
*/
export interface IRecipeCockpitPanelState {
    workspaceRoot: string;
    isPanelReady: boolean;
    loadPhaseMessage: string;
    recipeDataMessage?: IRecipeCockpitRecipeDataMessage;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    loadFailedMessage?: IRecipeCockpitLoadFailedMessage;
    pendingOpenableSourceKeys: Set<string>;
    pendingSelectableRunFolderNames: Set<string>;
    pendingLoadablePicklistKeys: Set<string>;
    openableSourceKeys: Set<string>;
    selectableRunFolderNames: Set<string>;
    loadablePicklistKeys: Set<string>;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    pendingTreeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists;
    isGenerateTreecipeInFlight: boolean;
    pendingIsGenerateTreecipeOffered: boolean;
    isGenerateTreecipeOffered: boolean;
    runFakerStateMessage?: IRecipeCockpitRunFakerStateMessage;
    reportedFailureDescriptions: Set<string>;
    pendingDataOrgObjectApiNames: Set<string>;
    dataOrgObjectApiNames: Set<string>;
    dataOrgDetails: IAuthenticatedOrgDetail[];
    dataOrgUsername?: string;
    dataOrgSelection?: IRecipeCockpitDataOrgSelection;
    dataOrgRequestSequence: number;
    // THE CARDS "Generate fake data and insert" IS DRAWN ON: EVERY CARD ▶ Run Faker CAN RUN (#255)
    pendingInsertableTreeKeys: Set<string>;
    insertableTreeKeys: Set<string>;
    insertStateMessage?: IRecipeCockpitInsertStateMessage;
    dataOrgInsertResults: Map<string, IRecipeCockpitStoredInsertResult>;
    pendingInsertableFriendTargets: Map<string, string>;
    insertableFriendTargets: Map<string, string>;
    addFriendStateMessage?: IRecipeCockpitAddFriendStateMessage;
    // THE "+ New scratch org" RUN, AND THE HOST-ONLY RESULT FILE ITS "View output" OPENS
    scratchOrgStateMessage?: IRecipeCockpitScratchOrgStateMessage;
    scratchOrgOutputFilePath?: string;
    /*
        "Deploy this metadata…" (#273): the cards it is drawn on, every card with a folder and an
        object, a pending/active pair like the insert's. WHAT is deployed is read from the stored
        model's tree on the host, never from the message.
    */
    pendingDeployableTreeKeys: Set<string>;
    deployableTreeKeys: Set<string>;
    metadataDeployStateMessage?: IRecipeCockpitMetadataDeployStateMessage;
    metadataDeployOutputFilePath?: string;
    // THE PLACE workspaceState KEPT FOR THIS MODEL (#230), REPLAYED UNTIL THE MODEL'S "rendered" SAYS IT WAS DRAWN
    restorePlace?: IRecipeCockpitPanelPlace;
    // HOST-ONLY, REPLACED WITH THE MODEL: WHAT A FILTERED COPY NESTS A KEPT FRIEND BY (#219)
    objectLevelsByApiName?: Map<string, number>;
    // THE LAST datasetAdded POSTED (#226): ONLY ITS "partialRendered" PROMOTES THE PENDING HISTORY ALLOW-LISTS
    datasetUpdateSequence: number;
    /*
        The model whose "rendered" arrived since the last ready, post or failure to draw -- null until
        then. A "partialRendered" is honoured only over that model: promoting the pending lists of one
        no document has acknowledged would activate its every history action, not just the new row's.
    */
    acknowledgedRenderSequence: number | null;
}

/*
    How a metadata deploy ended (#211, #273): its line, the org it was for and the objects it
    planned, whether the reader confirmed it, whether the CLI ran (so those describes are stale),
    and the result file "View output" opens.
*/
interface IRecipeCockpitMetadataDeployClosingState {
    statusText: string;
    isFailure: boolean;
    isDeployRun: boolean;
    orgDetail?: IAuthenticatedOrgDetail;
    deployedObjectApiNames?: string[];
    isConfirmed?: boolean;
    // THE CLI ANSWERED THAT THE DEPLOY SUCCEEDED: THE ONE ANSWER THE READINESS IS UPDATED FROM (#270)
    isDeployed?: boolean;
    outputFilePath?: string;
}

// ONE LOOKUP'S ANSWER, WITH EVERY Id ITS OWN SEARCHES RETURNED: ONLY THOSE MAY BE WRITTEN (#254)
interface ILookupParentChoiceWithSearch {
    choice: LookupParentChoice;
    searchReturnedRecordIds: ReadonlySet<string>;
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
        Where Data-by-Org remembers the org it last used, per workspace. Set by the command
        that opens the panel; a cockpit opened without one simply remembers nothing.
    */
    private static recipeCockpitWorkspaceState: IRecipeCockpitWorkspaceState | undefined;

    /*
        The reader's place waiting to be written to workspaceState, and the timer that writes it.
        One write per RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY however often the panel saves: the
        first save starts the timer, later ones only replace what it will write.
    */
    private static pendingPersistedPanelPlace: IRecipeCockpitPanelPlace | undefined;
    private static panelPlacePersistTimer: ReturnType<typeof setTimeout> | undefined;

    /*
        A place read back from workspaceState, or posted by the panel, checked field by field: both
        are text this extension does not control. A place in another shape, or naming no usable run,
        is no place at all; inside one, an entry of the wrong type or past a bound is dropped on its
        own. The run is a folder NAME the caller looks up among the runs on disk, never a path.
    */
    static normalizePanelPlace(candidatePlace: unknown): IRecipeCockpitPanelPlace | undefined {

        if ( !this.isPlainRecord(candidatePlace)
                || ( candidatePlace.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION && candidatePlace.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB ) ) {
            return undefined;
        }

        // AN OLDER PLACE'S TAB NAMES ARE READ AS THE TABS THEY BECAME, AND A TAB SINCE REMOVED AS NONE AT ALL
        const isOlderPlace = candidatePlace.version === RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB;
        const readTabName = (candidateTabName: unknown): unknown => {
            const renamedTabName = isOlderPlace && typeof candidateTabName === 'string' && Object.prototype.hasOwnProperty.call(RECIPE_COCKPIT_TREE_TAB_RENAMES, candidateTabName)
                ? RECIPE_COCKPIT_TREE_TAB_RENAMES[candidateTabName]
                : candidateTabName;
            return typeof renamedTabName === 'string' && RECIPE_COCKPIT_REMOVED_TREE_TABS.includes(renamedTabName) ? undefined : renamedTabName;
        };

        const { runFolderName } = candidatePlace;

        if ( !this.isBoundedText(runFolderName) || runFolderName === '' || !DatasetSourceService.isSafeFolderOrFileName(runFolderName) ) {
            return undefined;
        }

        const scrollY = candidatePlace.scrollY;
        const candidateTrees = Array.isArray(candidatePlace.trees) ? candidatePlace.trees.slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES) : [];
        const trees = candidateTrees.flatMap((candidateTree: unknown): IRecipeCockpitPanelTreePlace[] => {

            if ( !this.isPlainRecord(candidateTree) || !this.isBoundedText(candidateTree.treeKey) || candidateTree.treeKey === '' ) {
                return [];
            }

            const storedQueries = this.isPlainRecord(candidateTree.searchQueries) ? candidateTree.searchQueries : {};
            const candidateQueries: Record<string, unknown> = Object.create(null);
            Object.keys(storedQueries).forEach(storedTabName => {
                const tabName = readTabName(storedTabName);
                if ( typeof tabName === 'string' ) {
                    candidateQueries[tabName] = storedQueries[storedTabName];
                }
            });
            const searchQueries: Partial<Record<RecipeCockpitTreeTab, string>> = {};

            RECIPE_COCKPIT_TREE_TABS.forEach(tabName => {
                const candidateQuery = Object.prototype.hasOwnProperty.call(candidateQueries, tabName) ? candidateQueries[tabName] : undefined;
                searchQueries[tabName] = this.isBoundedText(candidateQuery) ? candidateQuery : '';
            });

            const candidateSelectedTab = readTabName(candidateTree.selectedTab);
            const selectedTab = RECIPE_COCKPIT_TREE_TABS.find(tabName => tabName === candidateSelectedTab) ?? 'treecipe';

            return [{
                treeKey: candidateTree.treeKey,
                isExpanded: candidateTree.isExpanded === true,
                selectedTab: selectedTab,
                searchQueries: searchQueries,
                expandedObjectKeys: this.normalizePlaceNames(candidateTree.expandedObjectKeys),
                openPicklistKeys: this.normalizePlaceNames(candidateTree.openPicklistKeys)
            }];

        });

        const normalizedPlace: IRecipeCockpitPanelPlace = {
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: runFolderName,
            isOrgPickerInUse: candidatePlace.isOrgPickerInUse === true,
            isFavoritesOnly: candidatePlace.isFavoritesOnly === true,
            scrollY: typeof scrollY === 'number' && Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0,
            trees: trees
        };

        // TOO LARGE TO BE A PLACE A READER MADE BY HAND, SO NOT ONE TO KEEP OR RESTORE
        return JSON.stringify(normalizedPlace).length <= RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH ? normalizedPlace : undefined;

    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {

        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);

    }

    private static isBoundedText(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && candidate.length <= RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH;

    }

    private static normalizePlaceNames(candidateNames: unknown): string[] {

        if ( !Array.isArray(candidateNames) ) {
            return [];
        }

        return candidateNames
            .slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES)
            .filter((candidateName: unknown): candidateName is string => this.isBoundedText(candidateName) && candidateName !== '');

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

        const persistedPlace = this.normalizePanelPlace(storedPlace);

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

        const treePreferences = this.buildEmptyTreePreferences();
        let storedPreferences: unknown;

        try {
            storedPreferences = workspaceState?.get<unknown>(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY);
        } catch {
            return treePreferences;
        }

        if ( !this.isPlainRecord(storedPreferences) || storedPreferences.version !== RECIPE_COCKPIT_TREE_PREFERENCES_VERSION ) {
            return treePreferences;
        }

        const storedCustomNames = this.isPlainRecord(storedPreferences.customNames) ? storedPreferences.customNames : {};

        Object.keys(storedCustomNames).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const customName = storedCustomNames[folderName];
            if ( this.isBoundedText(folderName) && folderName !== '' && typeof customName === 'string'
                    && customName !== '' && customName === customName.trim() && this.describeTreeNameProblem(customName) === undefined ) {
                treePreferences.customNamesByFolderName.set(folderName, customName);
            }
        });

        this.normalizePlaceNames(storedPreferences.favoriteFolderNames).forEach(folderName => treePreferences.favoriteFolderNames.add(folderName));

        return treePreferences;

    }

    // A FAILED WRITE IS SAID ONCE, AND THE CARDS ARE LEFT AS THEY WERE: A NAME THE NEXT OPEN WOULD NOT SHOW IS NOT ONE TO DRAW NOW
    static async writeTreePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined, treePreferences: IRecipeCockpitTreePreferences): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage('The Recipe Cockpit has no workspace to keep tree names and favorites in. Open a folder and re-open the cockpit.');
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const customNames: Record<string, string> = Object.fromEntries(treePreferences.customNamesByFolderName);

        try {
            await workspaceState.update(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, {
                version: RECIPE_COCKPIT_TREE_PREFERENCES_VERSION,
                customNames: customNames,
                favoriteFolderNames: [...treePreferences.favoriteFolderNames]
            });
            return true;
        } catch (writeError) {
            VSCodeWorkspaceService.showWarningMessage(`The tree name or favorite could not be saved: ${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}`);
            return false;
        }

    }

    // WHY A NAME CANNOT BE ANY CARD'S, WHOEVER ELSE HAS IT -- ONE LINE OF TEXT, WITHIN THE LENGTH THE HEADER IS DRAWN FOR
    private static describeTreeNameProblem(trimmedName: string): string | undefined {

        if ( /[\p{Cc}\u2028\u2029]/u.test(trimmedName) ) {
            return 'A tree name must be one line, with no control characters.';
        }

        if ( trimmedName.length > RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH ) {
            return `A tree name can be at most ${RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH} characters.`;
        }

        return undefined;

    }

    /*
        What the input box says is wrong with a name, or undefined when it can be saved. An empty
        name is valid: it clears the card's own name. A name is unique against every OTHER folder's
        name in the workspace and every other card's title on screen, compared trimmed and without
        case, because two cards a reader cannot tell apart are what a name exists to prevent.
    */
    static validateTreeName(candidateName: string,
                                folderName: string,
                                treePreferences: IRecipeCockpitTreePreferences,
                                trees: IRecipeCockpitTreeViewModel[]): string | undefined {

        const trimmedName = candidateName.trim();

        if ( trimmedName === '' ) {
            return undefined;
        }

        const namingProblem = this.describeTreeNameProblem(trimmedName);

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
        Each tree folder's DIRECT exclusions (#219) and unticked fields (#220), as workspaceState kept
        them, each name checked on its own. Which of them still name an object or field is decided
        against the model they are applied to, so a stale name is dropped silently there rather than
        here. A version 1 entry has no fields and reads as nothing unticked; a version 1 or 2 entry
        has no counts (#255) and reads as no count changed.
    */
    static readTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitTreeSelections {

        const treeSelections: IRecipeCockpitTreeSelections = {
            excludedObjectApiNamesByFolderName: new Map(),
            excludedFieldApiNamesByFolderName: new Map(),
            objectCountsByFolderName: new Map(),
            fixedValuesByFolderName: new Map()
        };
        let storedSelections: unknown;

        try {
            storedSelections = workspaceState?.get<unknown>(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        } catch {
            return treeSelections;
        }

        const readableVersions: unknown[] = [RECIPE_COCKPIT_OBJECT_SELECTION_VERSION, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS];
        if ( !this.isPlainRecord(storedSelections)
                || !readableVersions.includes(storedSelections.version)
                || !this.isPlainRecord(storedSelections.excludedObjectApiNamesByFolderName) ) {
            return treeSelections;
        }

        const storedByFolderName = storedSelections.excludedObjectApiNamesByFolderName;
        const isUsableFolderName = (folderName: string) => this.isBoundedText(folderName) && folderName !== '';

        Object.keys(storedByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const excludedObjectApiNames = this.normalizePlaceNames(storedByFolderName[folderName]).filter(objectApiName => SalesforceApiName.isApiName(objectApiName));
            if ( isUsableFolderName(folderName) && excludedObjectApiNames.length > 0 ) {
                treeSelections.excludedObjectApiNamesByFolderName.set(folderName, new Set(excludedObjectApiNames));
            }
        });

        const hasCounts = storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION || storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES;
        const storedCountsByFolderName = hasCounts ? storedSelections.objectCountsByFolderName : undefined;
        const storedFixedValuesByFolderName = storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION ? storedSelections.fixedValuesByFolderName : undefined;

        if ( this.isPlainRecord(storedFixedValuesByFolderName) ) {
            Object.keys(storedFixedValuesByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
                const storedByObject = storedFixedValuesByFolderName[folderName];
                if ( !isUsableFolderName(folderName) || !this.isPlainRecord(storedByObject) ) {
                    return;
                }
                const fixedValuesByObject = new Map<string, Map<string, string>>();
                Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                    const storedByField = storedByObject[objectApiName];
                    if ( !SalesforceApiName.isApiName(objectApiName) || !this.isPlainRecord(storedByField) ) {
                        return;
                    }
                    const fixedValuesByField = new Map<string, string>();
                    Object.keys(storedByField).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(fieldApiName => {
                        const fixedValue = storedByField[fieldApiName];
                        // THE KIND IS CHECKED AGAINST THE FIELD WHEN IT IS APPLIED; HERE ONLY WHAT NO KIND COULD WRITE IS DROPPED
                        if ( SalesforceApiName.isApiName(fieldApiName) && typeof fixedValue === 'string'
                                && fixedValue.length <= RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH
                                && RecipeCockpitRecipeWriter.checkFixedValue({ value: fixedValue, kind: 'text' }) === undefined ) {
                            fixedValuesByField.set(fieldApiName, fixedValue);
                        }
                    });
                    if ( fixedValuesByField.size > 0 ) {
                        fixedValuesByObject.set(objectApiName, fixedValuesByField);
                    }
                });
                if ( fixedValuesByObject.size > 0 ) {
                    treeSelections.fixedValuesByFolderName.set(folderName, fixedValuesByObject);
                }
            });
        }

        if ( this.isPlainRecord(storedCountsByFolderName) ) {
            Object.keys(storedCountsByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
                const storedByObject = storedCountsByFolderName[folderName];
                if ( !isUsableFolderName(folderName) || !this.isPlainRecord(storedByObject) ) {
                    return;
                }
                const countsByObject = new Map<string, number>();
                Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                    const recordCount = storedByObject[objectApiName];
                    if ( SalesforceApiName.isApiName(objectApiName) && RecipeCockpitRecipeWriter.isRecordCount(recordCount) ) {
                        countsByObject.set(objectApiName, recordCount);
                    }
                });
                if ( countsByObject.size > 0 ) {
                    treeSelections.objectCountsByFolderName.set(folderName, countsByObject);
                }
            });
        }

        const storedFieldsByFolderName = storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS ? storedSelections.excludedFieldApiNamesByFolderName : undefined;

        if ( !this.isPlainRecord(storedFieldsByFolderName) ) {
            return treeSelections;
        }

        Object.keys(storedFieldsByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {

            const storedByObject = storedFieldsByFolderName[folderName];
            if ( !isUsableFolderName(folderName) || !this.isPlainRecord(storedByObject) ) {
                return;
            }

            const excludedFieldsByObject = new Map<string, Set<string>>();
            Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                const excludedFieldApiNames = this.normalizePlaceNames(storedByObject[objectApiName]).filter(fieldApiName => SalesforceApiName.isApiName(fieldApiName));
                if ( SalesforceApiName.isApiName(objectApiName) && excludedFieldApiNames.length > 0 ) {
                    excludedFieldsByObject.set(objectApiName, new Set(excludedFieldApiNames));
                }
            });

            if ( excludedFieldsByObject.size > 0 ) {
                treeSelections.excludedFieldApiNamesByFolderName.set(folderName, excludedFieldsByObject);
            }

        });

        return treeSelections;

    }

    static readObjectSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): Map<string, Set<string>> {
        return this.readTreeSelections(workspaceState).excludedObjectApiNamesByFolderName;
    }

    static async writeTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, treeSelections: IRecipeCockpitTreeSelections): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage('The Recipe Cockpit has no workspace to keep excluded objects, unticked fields, record counts and fixed values in. Open a folder and re-open the cockpit.');
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER OR OBJECT NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const storedByFolderName: Record<string, string[]> = Object.fromEntries(
            [...treeSelections.excludedObjectApiNamesByFolderName]
                .filter(([, excludedObjectApiNames]) => excludedObjectApiNames.size > 0)
                .map(([folderName, excludedObjectApiNames]) => [folderName, [...excludedObjectApiNames]])
        );
        const storedFieldsByFolderName: Record<string, Record<string, string[]>> = Object.fromEntries(
            [...treeSelections.excludedFieldApiNamesByFolderName]
                .map(([folderName, excludedFieldsByObject]) => [folderName, Object.fromEntries(
                    [...excludedFieldsByObject]
                        .filter(([, excludedFieldApiNames]) => excludedFieldApiNames.size > 0)
                        .map(([objectApiName, excludedFieldApiNames]) => [objectApiName, [...excludedFieldApiNames]])
                )] as [string, Record<string, string[]>])
                .filter(([, storedByObject]) => Object.keys(storedByObject).length > 0)
        );
        const storedCountsByFolderName: Record<string, Record<string, number>> = Object.fromEntries(
            [...treeSelections.objectCountsByFolderName]
                .filter(([, countsByObject]) => countsByObject.size > 0)
                .map(([folderName, countsByObject]) => [folderName, Object.fromEntries(countsByObject)])
        );
        const storedFixedValuesByFolderName: Record<string, Record<string, Record<string, string>>> = Object.fromEntries(
            [...treeSelections.fixedValuesByFolderName]
                .map(([folderName, fixedValuesByObject]) => [folderName, Object.fromEntries(
                    [...fixedValuesByObject]
                        .filter(([, fixedValuesByField]) => fixedValuesByField.size > 0)
                        .map(([objectApiName, fixedValuesByField]) => [objectApiName, Object.fromEntries(fixedValuesByField)])
                )] as [string, Record<string, Record<string, string>>])
                .filter(([, storedByObject]) => Object.keys(storedByObject).length > 0)
        );

        try {
            await workspaceState.update(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY, {
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
                excludedObjectApiNamesByFolderName: storedByFolderName,
                excludedFieldApiNamesByFolderName: storedFieldsByFolderName,
                objectCountsByFolderName: storedCountsByFolderName,
                fixedValuesByFolderName: storedFixedValuesByFolderName
            });
            return true;
        } catch (writeError) {
            VSCodeWorkspaceService.showWarningMessage(`The excluded objects, unticked fields, record counts and fixed values could not be saved: ${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}`);
            return false;
        }

    }

    // THE OBJECTS ALONE, KEEPING WHATEVER FIELDS ARE STORED
    static async writeObjectSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, excludedObjectApiNamesByFolderName: Map<string, Set<string>>): Promise<boolean> {

        const storedSelections = this.readTreeSelections(workspaceState);

        return this.writeTreeSelections(workspaceState, {
            excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
            excludedFieldApiNamesByFolderName: storedSelections.excludedFieldApiNamesByFolderName,
            objectCountsByFolderName: storedSelections.objectCountsByFolderName,
            fixedValuesByFolderName: storedSelections.fixedValuesByFolderName
        });

    }

    static buildSelectableObjectKey(treeKey: string, objectApiName: string): string {
        return `${treeKey}\n${objectApiName}`;
    }

    /*
        The objects a card draws a clickable tree icon for: once each, those with a recipe -- what the
        panel resolves a card's objects to -- and never one written twice with no nickname to tell the
        occurrences apart, which the recipe writer refuses as well. A self-lookup's iteration has no
        icon of its own; it follows its object. The caller builds the name map ONCE per model: rebuilt
        per tree it made a load O(trees x objects), seconds at the scale the cockpit is measured at.
    */
    static collectSelectableObjectApiNames(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>, tree: IRecipeCockpitTreeViewModel): string[] {

        return [...new Set(tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .map(treeObject => treeObject.objectApiName))]
            .filter(objectApiName => objectsByApiName.has(objectApiName) && !objectsByApiName.get(objectApiName)?.hasIndistinctOccurrences);

    }

    // THE CASCADE OF ONE CARD, OR undefined WHEN NOTHING IN IT IS EXCLUDED -- WHICH LEAVES THE CARD'S MODEL AS IT ALWAYS WAS
    static buildObjectsByApiName(recipeViewModel: IRecipeCockpitRecipeViewModel): Map<string, IRecipeCockpitObjectViewModel> {
        return new Map(recipeViewModel.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel]));
    }

    /*
        Only objects WITH A RECIPE take part in the cascade: a lookup target with none (User) is never
        generated, so counting it as an "included parent" kept a child included that then moved to
        the top level with no parent at all.
    */
    static buildTreeObjectSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    directlyExcludedObjectApiNames: ReadonlySet<string> | undefined): IRecipeCockpitTreeObjectSelectionViewModel | undefined {

        const selectableObjectApiNames = this.collectSelectableObjectApiNames(objectsByApiName, tree);
        const directlyExcluded = selectableObjectApiNames.filter(objectApiName => directlyExcludedObjectApiNames?.has(objectApiName));

        if ( directlyExcluded.length === 0 ) {
            return undefined;
        }

        const drawnTreeObjects = tree.objects.filter(treeObject => treeObject.iterationNickname === undefined && objectsByApiName.has(treeObject.objectApiName));
        const objectSelection = RecipeCockpitObjectSelection.computeObjectSelection(drawnTreeObjects, directlyExcluded);
        const drawnObjectApiNames = new Set(drawnTreeObjects.map(treeObject => treeObject.objectApiName));
        const excludedObjectApiNames = new Set(objectSelection.exclusions.map(exclusion => exclusion.objectApiName));

        return {
            exclusions: objectSelection.exclusions,
            disabledLookups: objectSelection.disabledLookups,
            includedObjectCount: [...drawnObjectApiNames].filter(objectApiName => !excludedObjectApiNames.has(objectApiName)).length,
            objectCount: drawnObjectApiNames.size
        };

    }

    /*
        ONTO THE CARDS, IN PLACE: a card with nothing excluded carries no objectSelection at all, and
        one with no field unticked or locked carries no fieldSelection.
    */
    static applyObjectSelections(recipeViewModel: IRecipeCockpitRecipeViewModel,
                                    excludedObjectApiNamesByFolderName: Map<string, Set<string>>,
                                    excludedFieldApiNamesByFolderName: Map<string, Map<string, Set<string>>> = new Map(),
                                    onlyFolderName?: string,
                                    objectCountsByFolderName: Map<string, Map<string, number>> = new Map(),
                                    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>> = new Map()): IRecipeCockpitTreeViewModel[] {

        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            if ( onlyFolderName !== undefined && tree.folderName !== onlyFolderName ) {
                return;
            }

            delete tree.objectSelection;
            delete tree.fieldSelection;
            delete tree.objectCounts;
            delete tree.fixedValues;

            if ( tree.folderName === '' ) {
                return;
            }

            const objectSelection = this.buildTreeObjectSelection(objectsByApiName, tree, excludedObjectApiNamesByFolderName.get(tree.folderName));

            if ( objectSelection ) {
                tree.objectSelection = objectSelection;
            }

            const fieldSelection = this.buildTreeFieldSelection(objectsByApiName, tree, excludedFieldApiNamesByFolderName.get(tree.folderName));

            if ( fieldSelection ) {
                tree.fieldSelection = fieldSelection;
            }

            const objectCounts = this.buildTreeObjectCounts(objectsByApiName, tree, objectCountsByFolderName.get(tree.folderName));

            if ( objectCounts.length > 0 ) {
                tree.objectCounts = objectCounts;
            }

            // AFTER THE SELECTIONS, WHICH DECIDE WHAT A LOCK HOLDS BACK
            const fixedValues = this.buildTreeFixedValues(objectsByApiName, tree, fixedValuesByFolderName.get(tree.folderName));

            if ( fixedValues.length > 0 ) {
                tree.fixedValues = fixedValues;
            }

        });

        return recipeViewModel.trees;

    }

    static applyTreeSelections(recipeViewModel: IRecipeCockpitRecipeViewModel, treeSelections: IRecipeCockpitTreeSelections): IRecipeCockpitTreeViewModel[] {
        return this.applyObjectSelections(recipeViewModel, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, undefined, treeSelections.objectCountsByFolderName, treeSelections.fixedValuesByFolderName);
    }

    // THE KIND A FIELD'S FIXED VALUE IS WRITTEN AS (#262), FROM ITS METADATA TYPE; A FIELD OF NO KNOWN TYPE IS TEXT
    static getFixedValueKind(fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        if ( fieldViewModel.fieldType === 'Checkbox' ) {
            return 'boolean';
        }
        return RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES.includes(fieldViewModel.fieldType) ? 'number' : 'text';
    }

    /*
        Why a field cannot be given a fixed value (#262), or undefined when it can. A field the tree or
        the insert decides -- a lookup, RecordTypeId, a dependent picklist whose value a controlling
        value chooses -- keeps its expression, and so does any field a #220 lock holds or the reader
        unticked: a fixed value on a field generation leaves out would never be written. The panel
        draws the same rule from the same model.
    */
    static findFixedValueLockReason(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( this.listExcludedObjectApiNames(tree).includes(objectViewModel.objectApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON;
        }

        const objectFieldSelection = ( tree.fieldSelection?.objects ?? [] ).find(candidate => candidate.objectApiName === objectViewModel.objectApiName);
        const lockedField = objectFieldSelection?.lockedFields.find(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName);

        if ( lockedField ) {
            return lockedField.reason;
        }
        if ( objectFieldSelection?.excludedFieldApiNames.includes(fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON;
        }
        if ( fieldViewModel.fieldApiName === 'RecordTypeId' ) {
            return RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON;
        }

        const isTreeLookup = tree.objects.some(treeObject => treeObject.objectApiName === objectViewModel.objectApiName
                                                            && treeObject.parentLookups.some(parentLookup => parentLookup.fieldApiName === fieldViewModel.fieldApiName));
        if ( isTreeLookup || RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES.includes(fieldViewModel.fieldType) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON;
        }
        if ( fieldViewModel.controllingField ) {
            return `${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}${fieldViewModel.controllingField}`;
        }

        return undefined;

    }

    /*
        The fixed values a card generates with (#262): only for a field a pin is drawn for -- a
        selectable object's field with a line in the recipe -- and that no lock holds back now. A
        held-back value stays stored, as an excluded object's count does, and comes back with its
        field. A value its field's kind could not write (a field whose type changed since) is dropped
        here rather than refused at Run Faker.
    */
    static buildTreeFixedValues(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                tree: IRecipeCockpitTreeViewModel,
                                storedFixedValuesByObject: ReadonlyMap<string, ReadonlyMap<string, string>> | undefined): IRecipeCockpitFixedValueViewModel[] {

        if ( !storedFixedValuesByObject || storedFixedValuesByObject.size === 0 ) {
            return [];
        }

        return this.collectSelectableObjectApiNames(objectsByApiName, tree).flatMap(objectApiName => {

            const storedByField = storedFixedValuesByObject.get(objectApiName);
            const objectViewModel = objectsByApiName.get(objectApiName) as IRecipeCockpitObjectViewModel;

            if ( !storedByField ) {
                return [];
            }

            const selectableFieldApiNames = new Set(this.listSelectableFieldApiNames(objectViewModel));
            return objectViewModel.fields
                .filter((fieldViewModel, fieldIndex) => selectableFieldApiNames.has(fieldViewModel.fieldApiName)
                                                        && storedByField.has(fieldViewModel.fieldApiName)
                                                        && objectViewModel.fields.findIndex(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName) === fieldIndex
                                                        && this.findFixedValueLockReason(tree, objectViewModel, fieldViewModel) === undefined)
                .map(fieldViewModel => ({
                    objectApiName: objectApiName,
                    fieldApiName: fieldViewModel.fieldApiName,
                    value: storedByField.get(fieldViewModel.fieldApiName) as string,
                    kind: this.getFixedValueKind(fieldViewModel)
                }))
                .filter(fixedValue => RecipeCockpitRecipeWriter.checkFixedValue(fixedValue) === undefined);

        });

    }

    // WHAT A CARD GENERATES WITH, BY OBJECT THEN FIELD
    static listFixedValuesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, Map<string, IRecipeFixedValue>> {

        const fixedValuesByObject = new Map<string, Map<string, IRecipeFixedValue>>();
        ( tree?.fixedValues ?? [] ).forEach(fixedValue => {
            const fixedValuesByField = fixedValuesByObject.get(fixedValue.objectApiName) ?? new Map<string, IRecipeFixedValue>();
            fixedValuesByField.set(fixedValue.fieldApiName, { value: fixedValue.value, kind: fixedValue.kind });
            fixedValuesByObject.set(fixedValue.objectApiName, fixedValuesByField);
        });
        return fixedValuesByObject;

    }

    /*
        Why a value typed for a field cannot be its fixed value (#262), or undefined. Checked while it
        is typed and again once the box closes, against the field as the model holds it: the writer's
        own refusals first (a line break, a template opener), then the field's type -- a number that
        fits its precision and scale, true or false for a checkbox, an ISO date or date-time, text no
        longer than its length, and a picklist value its metadata declares (each, for a multi-select).
        A picklist with no declared values to hold it to takes any value.
    */
    static validateFixedValueInput(value: string, fieldViewModel: IRecipeCockpitFieldViewModel, declaredPicklistValues: readonly string[] | undefined): string | undefined {

        if ( value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH ) {
            return `A fixed value can be at most ${RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH} characters.`;
        }

        const kind = this.getFixedValueKind(fieldViewModel);
        const writerRefusal = RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: kind });

        if ( writerRefusal !== undefined ) {
            if ( kind === 'number' ) {
                return 'Type a plain number, such as 42, -7 or 3.25.';
            }
            if ( kind === 'boolean' ) {
                return 'Type true or false.';
            }
            return `This value ${writerRefusal}`;
        }

        const sizeMatch = /\((\d+)(?:,(\d+))?\)$/.exec(fieldViewModel.fieldTypeWithSize);
        // AN INPUT BOX DRAWS ITS VALIDATION MESSAGE LIKE A NOTIFICATION, SO THE TYPE -- WORKSPACE TEXT -- IS ESCAPED UNLESS IT IS PLAINLY A TYPE
        const typeLabel = this.buildFieldTypeLabel(fieldViewModel);

        if ( kind === 'number' && sizeMatch?.[2] !== undefined ) {
            const precision = Number(sizeMatch[1]);
            const scale = Number(sizeMatch[2]);
            const [wholeDigits, decimalDigits = ''] = value.replace(/^-/, '').split('.');
            if ( decimalDigits.length > scale ) {
                return `${typeLabel} takes at most ${scale} decimal place${scale === 1 ? '' : 's'}.`;
            }
            // A LONE 0 BEFORE THE POINT IS NO DIGIT: Number(2,2) TAKES 0.5
            if ( wholeDigits.replace(/^0+/, '').length > precision - scale ) {
                return `${typeLabel} takes at most ${precision - scale} digit${precision - scale === 1 ? '' : 's'} before the decimal point.`;
            }
        }

        if ( kind === 'text' && sizeMatch && sizeMatch[2] === undefined && value.length > Number(sizeMatch[1]) ) {
            return `${typeLabel} takes at most ${sizeMatch[1]} characters.`;
        }

        if ( fieldViewModel.fieldType === 'Date' && !this.isIsoDate(value) ) {
            return 'Type a date as YYYY-MM-DD, such as 2026-01-31.';
        }

        if ( fieldViewModel.fieldType === 'DateTime' && !this.isIsoDateTime(value) ) {
            return 'Type a date and time as ISO 8601 with a zone, such as 2026-01-31T09:30:00Z.';
        }

        if ( fieldViewModel.isPicklist && declaredPicklistValues && declaredPicklistValues.length > 0 ) {
            const declaredValues = new Set(declaredPicklistValues);
            const typedValues = fieldViewModel.fieldType === 'MultiselectPicklist' ? value.split(';') : [value];
            const undeclaredValue = typedValues.find(typedValue => !declaredValues.has(typedValue));
            if ( undeclaredValue !== undefined ) {
                return `"${RecipeYamlScalar.escapeForNotification(undeclaredValue)}" is not a value this picklist declares.`;
            }
            if ( new Set(typedValues).size !== typedValues.length ) {
                return 'A multi-select picklist value names each value once.';
            }
        }

        return undefined;

    }

    // "Text(50)" AS IT IS -- NO LINK CAN BE MADE OF IT -- AND ANYTHING ELSE THE WRAPPER SAYS THROUGH escapeForNotification
    static buildFieldTypeLabel(fieldViewModel: IRecipeCockpitFieldViewModel): string {
        return /^[A-Za-z]+(?:\(\d+(?:,\d+)?\))?$/.test(fieldViewModel.fieldTypeWithSize)
            ? fieldViewModel.fieldTypeWithSize
            : RecipeYamlScalar.escapeForNotification(fieldViewModel.fieldTypeWithSize);
    }

    static isIsoDate(value: string): boolean {
        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if ( !dateMatch ) {
            return false;
        }
        const parsedDate = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
        return parsedDate.getUTCFullYear() === Number(dateMatch[1])
                && parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1
                && parsedDate.getUTCDate() === Number(dateMatch[3]);
    }

    static isIsoDateTime(value: string): boolean {
        const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
        return !!dateTimeMatch && this.isIsoDate(dateTimeMatch[1]) && !Number.isNaN(Date.parse(value));
    }

    /*
        The counts a card generates with that are not the recipe's own (#255): only an object the card
        draws a count box for -- selectable, with a readable "count:" -- and only where the stored
        count differs, so a stale or no-longer-different count is dropped silently. An excluded
        object keeps its count here: it is not generated, and re-including it brings the count back.
    */
    static buildTreeObjectCounts(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    storedCountsByObject: ReadonlyMap<string, number> | undefined): IRecipeCockpitObjectCountViewModel[] {

        if ( !storedCountsByObject || storedCountsByObject.size === 0 ) {
            return [];
        }

        return this.collectSelectableObjectApiNames(objectsByApiName, tree)
            .filter(objectApiName => {
                const recordCount = objectsByApiName.get(objectApiName)?.recordCount;
                const storedCount = storedCountsByObject.get(objectApiName);
                return recordCount !== undefined && storedCount !== undefined && storedCount !== recordCount;
            })
            .map(objectApiName => ({ objectApiName: objectApiName, count: storedCountsByObject.get(objectApiName) as number }));

    }

    // WHAT A CARD GENERATES WITH: ITS CHANGED COUNTS, NEVER AN EXCLUDED OBJECT'S, WHICH IS NOT GENERATED AT ALL
    static listObjectCountsByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, number> {

        const excludedObjectApiNames = new Set(this.listExcludedObjectApiNames(tree));

        return new Map(( tree?.objectCounts ?? [] )
            .filter(objectCount => !excludedObjectApiNames.has(objectCount.objectApiName))
            .map(objectCount => [objectCount.objectApiName, objectCount.count]));

    }

    // THE FIELDS A CHECKBOX IS DRAWN FOR: THOSE WITH A LINE IN THE RECIPE, WHICH IS WHAT THE FILTER CAN LEAVE OUT
    static listSelectableFieldApiNames(objectViewModel: IRecipeCockpitObjectViewModel): string[] {
        return [...new Set(objectViewModel.fields.filter(fieldViewModel => fieldViewModel.lineNumber !== undefined).map(fieldViewModel => fieldViewModel.fieldApiName))];
    }

    /*
        One object's fields as generation will see them (#220). A lock holds a field ticked whatever
        the reader stored: RecordTypeId while a record-type section depends on it, and a controlling
        field while any of its dependents is ticked -- a "when:" naming a field the record does not
        have chooses nothing. A dependent can control another, so the locks are found to a fixed
        point. A lookup the object cascade disabled is left out by that cascade, never here.
    */
    static buildObjectFieldSelection(objectViewModel: IRecipeCockpitObjectViewModel,
                                        storedExcludedFieldApiNames: ReadonlySet<string> | undefined,
                                        parentExcludedFieldApiNames: ReadonlySet<string>): IRecipeCockpitObjectFieldSelectionViewModel | undefined {

        const selectableFieldApiNames = this.listSelectableFieldApiNames(objectViewModel);
        const selectableFieldSet = new Set(selectableFieldApiNames);
        const lockReasonsByFieldApiName = new Map<string, string>();

        selectableFieldApiNames
            .filter(fieldApiName => parentExcludedFieldApiNames.has(fieldApiName))
            .forEach(fieldApiName => lockReasonsByFieldApiName.set(fieldApiName, RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON));

        if ( objectViewModel.hasRecordTypeSections && selectableFieldSet.has('RecordTypeId') && !lockReasonsByFieldApiName.has('RecordTypeId') ) {
            lockReasonsByFieldApiName.set('RecordTypeId', RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON);
        }

        const excludedFieldSet = new Set(selectableFieldApiNames.filter(fieldApiName => storedExcludedFieldApiNames?.has(fieldApiName) && !lockReasonsByFieldApiName.has(fieldApiName)));
        const dependentsByControllingField = new Map<string, string[]>();
        objectViewModel.fields
            .filter(fieldViewModel => fieldViewModel.controllingField && selectableFieldSet.has(fieldViewModel.fieldApiName) && selectableFieldSet.has(fieldViewModel.controllingField))
            .forEach(fieldViewModel => {
                const dependentFieldApiNames = dependentsByControllingField.get(fieldViewModel.controllingField) ?? [];
                dependentFieldApiNames.push(fieldViewModel.fieldApiName);
                dependentsByControllingField.set(fieldViewModel.controllingField, dependentFieldApiNames);
            });

        const isTickedForGeneration = (fieldApiName: string) => !excludedFieldSet.has(fieldApiName) && !parentExcludedFieldApiNames.has(fieldApiName);
        for ( let isChanged = true; isChanged; ) {
            isChanged = false;
            dependentsByControllingField.forEach((dependentFieldApiNames, controllingFieldApiName) => {
                const tickedDependents = dependentFieldApiNames.filter(isTickedForGeneration);
                if ( tickedDependents.length > 0 && !lockReasonsByFieldApiName.has(controllingFieldApiName) ) {
                    lockReasonsByFieldApiName.set(controllingFieldApiName, `${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}${tickedDependents.join(', ')}`);
                    isChanged = excludedFieldSet.delete(controllingFieldApiName) || isChanged;
                }
            });
        }

        const excludedFieldApiNames = selectableFieldApiNames.filter(fieldApiName => excludedFieldSet.has(fieldApiName));
        const lockedFields = selectableFieldApiNames
            .filter(fieldApiName => lockReasonsByFieldApiName.has(fieldApiName))
            .map(fieldApiName => ({ fieldApiName: fieldApiName, reason: lockReasonsByFieldApiName.get(fieldApiName) as string }));

        if ( excludedFieldApiNames.length === 0 && lockedFields.length === 0 ) {
            return undefined;
        }

        const isEveryFieldExcluded = excludedFieldApiNames.length > 0 && selectableFieldApiNames.every(fieldApiName => !isTickedForGeneration(fieldApiName));

        return {
            objectApiName: objectViewModel.objectApiName,
            excludedFieldApiNames: excludedFieldApiNames,
            lockedFields: lockedFields,
            ...( isEveryFieldExcluded ? { isEveryFieldExcluded: true as const } : {} )
        };

    }

    static buildTreeFieldSelection(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                    tree: IRecipeCockpitTreeViewModel,
                                    storedFieldsByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): IRecipeCockpitTreeFieldSelectionViewModel | undefined {

        const parentExcludedFieldsByObject = new Map<string, Set<string>>();
        ( tree.objectSelection?.disabledLookups ?? [] ).forEach(disabledLookup => {
            const parentExcludedFieldApiNames = parentExcludedFieldsByObject.get(disabledLookup.objectApiName) ?? new Set<string>();
            parentExcludedFieldApiNames.add(disabledLookup.fieldApiName);
            parentExcludedFieldsByObject.set(disabledLookup.objectApiName, parentExcludedFieldApiNames);
        });

        const objectFieldSelections = this.collectSelectableObjectApiNames(objectsByApiName, tree)
            .map(objectApiName => this.buildObjectFieldSelection(
                objectsByApiName.get(objectApiName) as IRecipeCockpitObjectViewModel,
                storedFieldsByObject?.get(objectApiName),
                parentExcludedFieldsByObject.get(objectApiName) ?? new Set()
            ))
            .filter((objectFieldSelection): objectFieldSelection is IRecipeCockpitObjectFieldSelectionViewModel => !!objectFieldSelection);

        return objectFieldSelections.length > 0 ? { objects: objectFieldSelections } : undefined;

    }

    // EVERY FIELD A CARD LEAVES OUT OF GENERATION BY OBJECT, NEVER AN EXCLUDED OBJECT'S, WHICH GOES WHOLE
    static listExcludedFieldApiNamesByObject(tree: IRecipeCockpitTreeViewModel | undefined): Map<string, string[]> {

        const excludedObjectApiNames = new Set(this.listExcludedObjectApiNames(tree));

        return new Map(( tree?.fieldSelection?.objects ?? [] )
            .filter(objectFieldSelection => objectFieldSelection.excludedFieldApiNames.length > 0 && !excludedObjectApiNames.has(objectFieldSelection.objectApiName))
            .map(objectFieldSelection => [objectFieldSelection.objectApiName, [...objectFieldSelection.excludedFieldApiNames]]));

    }

    static buildSelectableFieldKey(treeKey: string, objectApiName: string, fieldApiName: string): string {
        return `${treeKey}\n${objectApiName}\n${fieldApiName}`;
    }

    // EVERY OBJECT A CARD LEAVES OUT OF GENERATION, THE ONES FOLLOWING A PARENT INCLUDED
    static listExcludedObjectApiNames(tree: IRecipeCockpitTreeViewModel | undefined): string[] {
        return ( tree?.objectSelection?.exclusions ?? [] ).map(exclusion => exclusion.objectApiName);
    }

    private static async setObjectIncluded(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: { treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }) {

        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        const excludedObjectApiNames = treeSelections.excludedObjectApiNamesByFolderName.get(panelAction.folderName) ?? new Set<string>();

        if ( panelAction.isIncluded ) {
            excludedObjectApiNames.delete(panelAction.objectApiName);
        } else {
            excludedObjectApiNames.add(panelAction.objectApiName);
        }
        treeSelections.excludedObjectApiNamesByFolderName.set(panelAction.folderName, excludedObjectApiNames);

        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        A field checkbox (#220). The host re-derives the card's state before it writes anything: a
        field of an excluded object is read-only, and a field a lock holds ticked cannot be unticked,
        so a message the panel should never have sent changes nothing.
    */
    private static async setFieldIncluded(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldIncluded' }>) {

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);

        if ( !tree || this.listExcludedObjectApiNames(tree).includes(panelAction.objectApiName) ) {
            return;
        }

        const isLocked = ( tree.fieldSelection?.objects ?? [] )
            .find(objectFieldSelection => objectFieldSelection.objectApiName === panelAction.objectApiName)
            ?.lockedFields.some(lockedField => lockedField.fieldApiName === panelAction.fieldApiName);

        if ( !panelAction.isIncluded && isLocked ) {
            return;
        }

        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        const excludedFieldsByObject = treeSelections.excludedFieldApiNamesByFolderName.get(panelAction.folderName) ?? new Map<string, Set<string>>();
        const excludedFieldApiNames = excludedFieldsByObject.get(panelAction.objectApiName) ?? new Set<string>();

        if ( panelAction.isIncluded ) {
            excludedFieldApiNames.delete(panelAction.fieldApiName);
        } else {
            excludedFieldApiNames.add(panelAction.fieldApiName);
        }
        excludedFieldsByObject.set(panelAction.objectApiName, excludedFieldApiNames);
        treeSelections.excludedFieldApiNamesByFolderName.set(panelAction.folderName, excludedFieldsByObject);

        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        All / None (#220). None stores every field with a line in the recipe except those a lock
        holds for a reason of its own (RecordTypeId, a parent-excluded lookup); a controlling field is
        stored too, because unticking every dependent with it is what frees it.
    */
    private static async setAllFieldsIncluded(cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setAllFieldsIncluded' }>) {

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);
        const objectViewModel = panelState.recipeDataMessage?.recipe.objects.find(candidateObject => candidateObject.objectApiName === panelAction.objectApiName);

        if ( !tree || !objectViewModel || this.listExcludedObjectApiNames(tree).includes(panelAction.objectApiName) ) {
            return;
        }

        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        const excludedFieldsByObject = treeSelections.excludedFieldApiNamesByFolderName.get(panelAction.folderName) ?? new Map<string, Set<string>>();

        if ( panelAction.isIncluded ) {
            excludedFieldsByObject.delete(panelAction.objectApiName);
        } else {
            const heldFieldApiNames = new Set(( tree.fieldSelection?.objects ?? [] )
                .find(objectFieldSelection => objectFieldSelection.objectApiName === panelAction.objectApiName)
                ?.lockedFields
                .filter(lockedField => !lockedField.reason.startsWith(RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX))
                .map(lockedField => lockedField.fieldApiName) ?? []);
            excludedFieldsByObject.set(panelAction.objectApiName, new Set(this.listSelectableFieldApiNames(objectViewModel).filter(fieldApiName => !heldFieldApiNames.has(fieldApiName))));
        }
        treeSelections.excludedFieldApiNamesByFolderName.set(panelAction.folderName, excludedFieldsByObject);

        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections);

    }

    /*
        A count box (#255). A count equal to the recipe's own is not stored, so setting a box back to
        what the recipe says clears it. The recipe file is never written.
    */
    private static async setObjectCount(cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setObjectCount' }>) {

        const recordCount = panelState.recipeDataMessage?.recipe.objects.find(candidateObject => candidateObject.objectApiName === panelAction.objectApiName)?.recordCount;
        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        const countsByObject = treeSelections.objectCountsByFolderName.get(panelAction.folderName) ?? new Map<string, number>();

        if ( panelAction.count === recordCount ) {
            countsByObject.delete(panelAction.objectApiName);
        } else {
            countsByObject.set(panelAction.objectApiName, panelAction.count);
        }
        treeSelections.objectCountsByFolderName.set(panelAction.folderName, countsByObject);

        // A COUNT CHANGES NO FIELD AND NO OBJECT THE INSERT SENDS, SO THE ORG'S READINESS NEED NOT BE CHECKED AGAIN
        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections, false);

    }

    /*
        A field's pin (#262). The VALUE never comes from the panel: the host asks for it in its own
        input box, checks it while it is typed and again once the box closes -- against the model on
        screen THEN, since a reload may have come in meanwhile -- and an empty answer clears it. A
        field a lock holds back, or no longer drawn, writes nothing. The recipe file is never written.
    */
    private static async setFieldFixedValue(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldFixedValue' }>) {

        const findField = () => {
            const recipeViewModel = panelState.recipeDataMessage?.recipe;
            const tree = recipeViewModel?.trees.find(candidateTree => candidateTree.treeKey === panelAction.treeKey);
            const objectViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === panelAction.objectApiName);
            const fieldViewModel = objectViewModel?.fields.find(candidateField => candidateField.fieldApiName === panelAction.fieldApiName && candidateField.lineNumber !== undefined);
            return tree && objectViewModel && fieldViewModel && tree.folderName === panelAction.folderName
                    && this.findFixedValueLockReason(tree, objectViewModel, fieldViewModel) === undefined
                ? { fieldViewModel: fieldViewModel }
                : undefined;
        };

        const fieldBeforePrompt = findField();
        if ( !fieldBeforePrompt ) {
            return;
        }

        const { fieldViewModel } = fieldBeforePrompt;
        const declaredPicklistValues = this.listDeclaredPicklistValues(panelState, panelAction.objectApiName, panelAction.fieldApiName);
        const storedValue = this.readTreeSelections(this.recipeCockpitWorkspaceState).fixedValuesByFolderName.get(panelAction.folderName)?.get(panelAction.objectApiName)?.get(panelAction.fieldApiName);
        const fieldLabel = RecipeYamlScalar.escapeForNotification(`${panelAction.objectApiName}.${panelAction.fieldApiName}`);
        const typeLabel = fieldViewModel.fieldTypeWithSize ? ` (${this.buildFieldTypeLabel(fieldViewModel)})` : '';

        const typedValue = await vscode.window.showInputBox({
            title: `Fixed value for ${fieldLabel}`,
            prompt: `Every record ▶ Run Faker and the tree insert generate gets this value for ${fieldLabel}${typeLabel} instead of its faker expression. Leave it empty to go back to the faker expression. The recipe file is not changed.`,
            value: storedValue ?? '',
            ignoreFocusOut: true,
            validateInput: (candidateValue: string) => candidateValue === '' ? undefined : this.validateFixedValueInput(candidateValue, fieldViewModel, declaredPicklistValues)
        });

        if ( typedValue === undefined || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        const fieldAfterPrompt = findField();
        if ( !fieldAfterPrompt ) {
            return;
        }

        const refusal = typedValue === '' ? undefined : this.validateFixedValueInput(typedValue, fieldAfterPrompt.fieldViewModel, declaredPicklistValues);
        if ( refusal !== undefined ) {
            VSCodeWorkspaceService.showWarningMessage(`The fixed value for ${fieldLabel} was not set: ${RecipeYamlScalar.escapeForNotification(refusal)}`);
            return;
        }

        // READ AGAIN AFTER THE BOX: A CHOICE MADE ELSEWHERE WHILE IT WAS OPEN IS NOT WRITTEN BACK
        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        const fixedValuesByObject = treeSelections.fixedValuesByFolderName.get(panelAction.folderName) ?? new Map<string, Map<string, string>>();
        const fixedValuesByField = fixedValuesByObject.get(panelAction.objectApiName) ?? new Map<string, string>();

        if ( typedValue === '' ) {
            fixedValuesByField.delete(panelAction.fieldApiName);
        } else {
            fixedValuesByField.set(panelAction.fieldApiName, typedValue);
        }
        fixedValuesByObject.set(panelAction.objectApiName, fixedValuesByField);
        treeSelections.fixedValuesByFolderName.set(panelAction.folderName, fixedValuesByObject);

        // A FIXED VALUE CHANGES NO FIELD THE INSERT SENDS, SO THE ORG'S READINESS NEED NOT BE CHECKED AGAIN
        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections, false);

    }

    // A PICKLIST'S ACTIVE VALUES AND EVERY RECORD TYPE'S, FROM THE HOST-ONLY DISPLAY COPY; undefined FOR A FIELD THAT IS NOT A PICKLIST
    private static listDeclaredPicklistValues(panelState: IRecipeCockpitPanelState, objectApiName: string, fieldApiName: string): string[] | undefined {

        const picklistDisplayValues = panelState.picklistDisplayValuesByObjectApiName.get(objectApiName)?.get(fieldApiName);

        return picklistDisplayValues
            ? [...picklistDisplayValues.picklistValues, ...picklistDisplayValues.recordTypePicklistValues.flatMap(recordTypeValues => recordTypeValues.picklistValues)]
            : undefined;

    }

    // A CARD'S Reset selection: EVERY OBJECT INCLUDED, EVERY FIELD TICKED AND EVERY COUNT THE RECIPE'S AGAIN, AFTER THE READER CONFIRMS IN THE HOST'S OWN DIALOG
    private static async resetTreeSelection(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, folderName: string) {

        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);

        if ( !treeSelections.excludedObjectApiNamesByFolderName.has(folderName)
                && !treeSelections.excludedFieldApiNamesByFolderName.has(folderName)
                && !treeSelections.objectCountsByFolderName.has(folderName)
                && !treeSelections.fixedValuesByFolderName.has(folderName) ) {
            return;
        }

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.folderName === folderName);
        const treeLabel = RecipeYamlScalar.escapeForNotification(tree?.customName ?? tree?.title ?? folderName);
        const confirmation = await vscode.window.showWarningMessage(
            `Reset the selection of ${treeLabel}?`,
            { modal: true, detail: 'Every object is included, every field is ticked, every record count goes back to the recipe\'s own again and every fixed value is cleared. The recipe file is not changed.' },
            RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL ) {
            return;
        }

        // READ AGAIN AFTER THE DIALOG: A CHOICE MADE ELSEWHERE WHILE IT WAS OPEN IS NOT WRITTEN BACK
        const currentSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        currentSelections.excludedObjectApiNamesByFolderName.delete(folderName);
        currentSelections.excludedFieldApiNamesByFolderName.delete(folderName);
        currentSelections.objectCountsByFolderName.delete(folderName);
        currentSelections.fixedValuesByFolderName.delete(folderName);

        await this.saveAndPostTreeSelections(cockpitPanel, panelState, folderName, currentSelections);

    }

    /*
        A failed write is said once and leaves the card as it was: a selection the next open would not
        show is not one to generate by. Otherwise every card of the folder is redrawn in place, and an
        org Data-by-Org already checked is checked again, since what Create would send has changed.
    */
    private static async saveAndPostTreeSelections(cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    folderName: string,
                                                    treeSelections: IRecipeCockpitTreeSelections,
                                                    isReadinessAffected = true) {

        const isWritten = await this.writeTreeSelections(this.recipeCockpitWorkspaceState, treeSelections);
        const recipeDataMessage = panelState.recipeDataMessage;

        if ( !isWritten || !recipeDataMessage || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        // ONLY THIS FOLDER'S CARDS CHANGED, SO ONLY THEY ARE RECOMPUTED
        this.applyObjectSelections(recipeDataMessage.recipe, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, folderName, treeSelections.objectCountsByFolderName, treeSelections.fixedValuesByFolderName);

        recipeDataMessage.recipe.trees
            .filter(tree => tree.folderName === folderName)
            .forEach(tree => this.postToPanel(cockpitPanel, {
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: tree.treeKey,
                ...( tree.objectSelection ? { objectSelection: tree.objectSelection } : {} ),
                ...( tree.fieldSelection ? { fieldSelection: tree.fieldSelection } : {} ),
                ...( tree.objectCounts ? { objectCounts: tree.objectCounts } : {} ),
                ...( tree.fixedValues ? { fixedValues: tree.fixedValues } : {} )
            }));

        const isOrgCheckIdle = !panelState.scratchOrgStateMessage?.isRunning && !panelState.insertStateMessage?.isRunning;
        if ( isOrgCheckIdle && isReadinessAffected ) {
            await this.refreshDataOrgReadinessForFolder(cockpitPanel, panelState, folderName);
        }

    }

    /*
        What Create would send for ONE folder's cards changed, so only their targets are checked
        again -- against the org type the selection already answered and the session's describe
        cache, connecting only for an object the cache does not hold. A selection that has not
        answered it is a sandbox has nothing to refresh, and an answer for a selection, model or
        request the reader has moved on from is dropped. The panel merges it by key.
    */
    private static async refreshDataOrgReadinessForFolder(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, folderName: string) {

        await this.refreshDataOrgReadinessForTrees(cockpitPanel, panelState, tree => tree.folderName === folderName);

    }

    // THE SAME FOR THE CARDS ONE PREDICATE PICKS
    private static async refreshDataOrgReadinessForTrees(cockpitPanel: vscode.WebviewPanel,
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
        const createTargets = ( await this.collectCreateTargets(panelState, folderRecipeDataMessage) )
            .filter(createTarget => panelState.dataOrgObjectApiNames.has(createTarget.objectApiName));

        if ( !isRefreshCurrent() || createTargets.length === 0 ) {
            return;
        }

        let readinessByTarget: IRecipeCockpitCreateReadinessByTarget;
        try {
            readinessByTarget = await this.computeCreateReadinessByTarget(
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
            insertResults: [],
            requestSequence: requestSequence,
            renderSequence: recipeDataMessage.renderSequence
        });

    }

    /*
        A deploy the CLI answered succeeded for (#270, #273): its objects are in the org now, so
        every card that lists one is told so from that answer -- no describe and no connection. Only
        each tree's recipe block is read, from the workspace, since a block that cannot be read stays
        a reason. An answer for a selection, model or request the reader has moved on from is dropped.
    */
    private static async postDeployedObjectReadiness(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, deployedObjectApiNames: readonly string[]) {

        const dataOrgSelection = panelState.dataOrgSelection;
        const recipeDataMessage = panelState.recipeDataMessage;
        const objectApiNames = new Set(deployedObjectApiNames.filter(objectApiName => panelState.dataOrgObjectApiNames.has(objectApiName)));

        if ( !dataOrgSelection || dataOrgSelection.orgTypeDetail?.isSandbox !== true || !recipeDataMessage || objectApiNames.size === 0 ) {
            return;
        }

        const requestSequence = dataOrgSelection.requestSequence;
        const objectRecipeDataMessage: IRecipeCockpitRecipeDataMessage = {
            ...recipeDataMessage,
            recipe: { ...recipeDataMessage.recipe, trees: recipeDataMessage.recipe.trees.filter(tree => tree.objects.some(treeObject => objectApiNames.has(treeObject.objectApiName))) }
        };
        const createTargets = ( await this.collectCreateTargets(panelState, objectRecipeDataMessage) )
            .filter(createTarget => objectApiNames.has(createTarget.objectApiName));

        const isStillCurrent = this.recipeCockpitPanel === cockpitPanel
                                && this.recipeCockpitPanelState === panelState
                                && panelState.dataOrgSelection === dataOrgSelection
                                && panelState.dataOrgRequestSequence === requestSequence
                                && panelState.recipeDataMessage === recipeDataMessage;

        if ( !isStillCurrent ) {
            return;
        }

        this.postToPanel(cockpitPanel, {
            command: 'dataOrgReadiness',
            objects: [...objectApiNames].map(objectApiName => RecipeCockpitRecordCreation.buildDeployedObjectReadiness(objectApiName)),
            createTargets: createTargets.map(createTarget => ({
                ...RecipeCockpitRecordCreation.buildDeployedObjectReadiness(createTarget.objectApiName, createTarget.recipeFieldRefusalReason),
                treeKey: createTarget.treeKey
            })),
            insertResults: [],
            requestSequence: requestSequence,
            renderSequence: recipeDataMessage.renderSequence
        });

    }

    /*
        What ▶ Run Faker runs for a card with exclusions (#219): the filtered copy of its recipe, or
        why there is none. Read at the click from the stored model, which is what the card shows.
    */
    static buildRunFakerFilteredRecipe(recipeText: string,
                                        tree: IRecipeCockpitTreeViewModel,
                                        objectLevelsByApiName: Map<string, number> | undefined): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } {

        const excludedObjectApiNames = this.listExcludedObjectApiNames(tree);
        const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);
        const objectCountsByObject = this.listObjectCountsByObject(tree);
        const fixedValuesByObject = this.listFixedValuesByObject(tree);
        const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => parentLookupsByObjectApiName.set(treeObject.objectApiName, treeObject.parentLookups.map(parentLookup => ({ ...parentLookup }))));

        const filterResult = RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            excludedObjectApiNames: excludedObjectApiNames,
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            levelsByObjectApiName: objectLevelsByApiName,
            excludedFieldApiNamesByObject: excludedFieldApiNamesByObject,
            objectCountsByObject: objectCountsByObject,
            fixedValuesByObject: fixedValuesByObject
        });

        if ( 'refusal' in filterResult ) {
            return { refusalMessage: filterResult.refusal.message };
        }

        return {
            recipeText: filterResult.recipeText,
            excludedObjectApiNames: excludedObjectApiNames,
            ...( excludedFieldApiNamesByObject.size > 0 ? { excludedFieldApiNamesByObject: Object.fromEntries(excludedFieldApiNamesByObject) } : {} ),
            ...( filterResult.appliedCounts.length > 0 ? { objectCountsByObject: Object.fromEntries(filterResult.appliedCounts.map(appliedCount => [appliedCount.objectApiName, appliedCount.count])) } : {} ),
            ...( filterResult.appliedFixedValues.length > 0 ? { fixedValuesByObject: this.groupAppliedFixedValues(filterResult.appliedFixedValues) } : {} )
        };

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
            runnableTreeKeys: new Set(),
            nameableTreeKeys: new Set(),
            selectableObjectKeys: new Set(),
            selectableFieldKeys: new Set()
        };

    }

    // EVERY HISTORY ACTION THE RENDERED MODEL OFFERS, BY NAME, AND NOTHING ELSE
    static collectTreeHistoryAllowLists(recipeViewModel: IRecipeCockpitRecipeViewModel): IRecipeCockpitTreeHistoryAllowLists {

        const treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            if ( tree.runFakerRecipeFileName ) {
                treeHistoryAllowLists.runnableTreeKeys.add(tree.treeKey);
            }

            if ( tree.folderName !== '' ) {
                treeHistoryAllowLists.nameableTreeKeys.add(tree.treeKey);
                this.collectSelectableObjectApiNames(objectsByApiName, tree).forEach(objectApiName => {
                    treeHistoryAllowLists.selectableObjectKeys.add(this.buildSelectableObjectKey(tree.treeKey, objectApiName));
                    this.listSelectableFieldApiNames(objectsByApiName.get(objectApiName) as IRecipeCockpitObjectViewModel)
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

    // WHAT ONE DATA SET ROW OFFERS: THE ONE RULE A WHOLE MODEL AND A datasetAdded (#226) BOTH USE
    static addDatasetToAllowLists(treeHistoryAllowLists: IRecipeCockpitTreeHistoryAllowLists, dataset: IRecipeCockpitTreeDatasetViewModel) {

        treeHistoryAllowLists.openableDatasetFolderNames.add(dataset.datasetFolderName);
        treeHistoryAllowLists.insertableDatasetFolderNames.add(dataset.datasetFolderName);

        if ( dataset.recordCounts === null ) {
            treeHistoryAllowLists.countableDatasetFolderNames.add(dataset.datasetFolderName);
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
            pendingSelectableRunFolderNames: new Set(),
            pendingLoadablePicklistKeys: new Set(),
            openableSourceKeys: new Set(),
            selectableRunFolderNames: new Set(),
            loadablePicklistKeys: new Set(),
            treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets(),
            pendingTreeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
            treeHistoryAllowLists: this.buildEmptyTreeHistoryAllowLists(),
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
            dataOrgInsertResults: new Map(),
            pendingInsertableFriendTargets: new Map(),
            insertableFriendTargets: new Map(),
            datasetUpdateSequence: 0,
            acknowledgedRenderSequence: null,
            pendingDeployableTreeKeys: new Set(),
            deployableTreeKeys: new Set()
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
        const persistedPanelPlace = previousPanelState?.recipeDataMessage ? undefined : this.readPersistedPanelPlace(workspaceState);
        const carriedRunFolderName = previousPanelState?.recipeDataMessage?.recipe.selectedRunFolderName
            || persistedPanelPlace?.runFolderName
            || undefined;

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

        this.adoptScratchOrgRunState(this.recipeCockpitPanelState);
        this.adoptMetadataDeployRunState(this.recipeCockpitPanelState);

        if ( previousPanelState ) {
            // WHAT A "View errors" LINK OPENS, AND THE SEQUENCE A NEW SELECTION MUST STAY ABOVE
            this.recipeCockpitPanelState.dataOrgInsertResults = previousPanelState.dataOrgInsertResults;
            this.recipeCockpitPanelState.dataOrgRequestSequence = previousPanelState.dataOrgRequestSequence;
            // A SCRATCH ORG RUN OUTLIVES THE RELOAD, AND ITS LINE AND OUTPUT GO WITH IT
            this.recipeCockpitPanelState.scratchOrgStateMessage = previousPanelState.scratchOrgStateMessage;
            this.recipeCockpitPanelState.scratchOrgOutputFilePath = previousPanelState.scratchOrgOutputFilePath;
            // SO DOES A METADATA DEPLOY'S (#211)
            this.recipeCockpitPanelState.metadataDeployStateMessage = previousPanelState.metadataDeployStateMessage;
            this.recipeCockpitPanelState.metadataDeployOutputFilePath = previousPanelState.metadataDeployOutputFilePath;
        }

        if ( !existingCockpitPanel ) {

            cockpitPanel.onDidDispose(() => {
                // THE LAST PLACE SAVED IS WRITTEN NOW RATHER THAN DROPPED WITH THE TIMER -- THE NEXT OPEN READS IT
                this.flushPanelPlacePersist();
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

        // A RUN THAT IS GONE FALLS BACK TO THE NEWEST, AS loadRecipeRunByRuns DOES FOR ANY RUN IT CANNOT FIND
        await this.loadRecipeIntoPanel(
            cockpitPanel,
            workspaceRoot,
            carriedRunFolderName,
            undefined,
            persistedPanelPlace
        );

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
                                                focusTree?: IRecipeCockpitTreeFocus,
                                                persistedPanelPlace?: IRecipeCockpitPanelPlace): Promise<void> {

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

    private static renderRecipeModel(cockpitPanel: vscode.WebviewPanel,
                                        loadedRecipe: IRecipeCockpitLoadedRecipe,
                                        focusTree?: IRecipeCockpitTreeFocus,
                                        persistedPanelPlace?: IRecipeCockpitPanelPlace) {

        const panelState = this.recipeCockpitPanelState;
        const recipeViewModel = loadedRecipe.recipeViewModel;
        this.applyTreePreferences(recipeViewModel.trees, this.readTreePreferences(this.recipeCockpitWorkspaceState));
        this.applyTreeSelections(recipeViewModel, this.readTreeSelections(this.recipeCockpitWorkspaceState));
        const recipeDataMessage: IRecipeCockpitRecipeDataMessage = {
            command: 'recipeData',
            recipe: recipeViewModel,
            renderSequence: ++this.recipeCockpitRenderSequence
        };
        const isFocusOnScreen = !!focusTree && recipeViewModel.trees.some(tree => tree.treeKey === focusTree.treeKey);

        panelState.recipeDataMessage = recipeDataMessage;
        /*
            A saved place whose run is gone is dropped (#230): the newest run was loaded in its
            place, and a place is only ever about the run it names.
        */
        panelState.restorePlace = persistedPanelPlace && persistedPanelPlace.runFolderName === recipeViewModel.selectedRunFolderName
            ? persistedPanelPlace
            : undefined;
        if ( persistedPanelPlace && !panelState.restorePlace ) {
            this.forgetPersistedPanelPlace(this.recipeCockpitWorkspaceState);
        }
        panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
        panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
        panelState.objectLevelsByApiName = loadedRecipe.objectLevelsByApiName;
        panelState.loadFailedMessage = undefined;
        panelState.loadPhaseMessage = '';
        panelState.reportedFailureDescriptions = new Set();
        panelState.pendingOpenableSourceKeys = new Set(this.collectOpenableSourceKeys(recipeViewModel));
        panelState.pendingSelectableRunFolderNames = new Set(recipeViewModel.runs.map(run => run.runFolderName));
        panelState.pendingLoadablePicklistKeys = new Set(this.collectLoadablePicklistKeys(recipeViewModel));
        panelState.pendingTreeHistoryAllowLists = this.collectTreeHistoryAllowLists(recipeViewModel);
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
        panelState.pendingDataOrgObjectApiNames = new Set(this.collectDataOrgObjectApiNames(recipeViewModel));
        panelState.dataOrgObjectApiNames = new Set();
        panelState.pendingInsertableTreeKeys = new Set(this.collectInsertableTreeKeys(recipeViewModel));
        panelState.insertableTreeKeys = new Set();
        panelState.pendingDeployableTreeKeys = new Set(this.collectDeployableTreeKeys(recipeViewModel));
        panelState.deployableTreeKeys = new Set();
        // A "+" OF THE OLD MODEL NAMES AN ITERATION THE NEW ONE'S ROWS MAY NOT DRAW WHERE IT WAS
        panelState.pendingInsertableFriendTargets = this.collectInsertableFriendTargets(recipeViewModel);
        panelState.insertableFriendTargets = new Map();
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

        return panelState.restorePlace ? { ...recipeDataMessage, restorePlace: panelState.restorePlace } : recipeDataMessage;

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
                panelState.loadablePicklistKeys = new Set();
                panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                panelState.isGenerateTreecipeOffered = false;
                // A RELOADED DOCUMENT HAS NO DROPDOWN TO DRAW A SELECTION IN, SO ONE STILL BEING CHECKED IS ENDED
                panelState.dataOrgObjectApiNames = new Set();
                panelState.insertableTreeKeys = new Set();
                panelState.deployableTreeKeys = new Set();
                panelState.insertableFriendTargets = new Map();
                panelState.acknowledgedRenderSequence = null;
                panelState.dataOrgSelection = undefined;
                panelState.dataOrgRequestSequence++;
                panelAction.hostMessages.forEach(hostMessage => cockpitPanel.webview.postMessage(hostMessage));
                return;

            case 'activateActions':

                // DRAWN: THE PANEL'S OWN getState HOLDS THE PLACE FROM HERE ON
                panelState.restorePlace = undefined;
                panelState.openableSourceKeys = panelState.pendingOpenableSourceKeys;
                panelState.selectableRunFolderNames = panelState.pendingSelectableRunFolderNames;
                panelState.loadablePicklistKeys = panelState.pendingLoadablePicklistKeys;
                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                panelState.isGenerateTreecipeOffered = panelState.pendingIsGenerateTreecipeOffered;
                panelState.dataOrgObjectApiNames = panelState.pendingDataOrgObjectApiNames;
                panelState.insertableTreeKeys = panelState.pendingInsertableTreeKeys;
                panelState.deployableTreeKeys = panelState.pendingDeployableTreeKeys;
                panelState.insertableFriendTargets = panelState.pendingInsertableFriendTargets;
                panelState.acknowledgedRenderSequence = panelState.recipeDataMessage.renderSequence;
                return;

            case 'activateDatasetActions':

                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                return;

            case 'reportRenderFailure': {

                panelState.reportedFailureDescriptions.add(panelAction.failureDescription);

                // ONLY A FAILURE TO DRAW EMPTIES THE ALLOW-LISTS -- A THROW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN
                if ( panelAction.invalidatesPanel ) {
                    panelState.openableSourceKeys = new Set();
                    panelState.selectableRunFolderNames = new Set();
                        panelState.loadablePicklistKeys = new Set();
                    panelState.treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
                    panelState.isGenerateTreecipeOffered = false;
                    panelState.dataOrgObjectApiNames = new Set();
                    panelState.insertableTreeKeys = new Set();
                    panelState.deployableTreeKeys = new Set();
                    panelState.insertableFriendTargets = new Map();
                    panelState.acknowledgedRenderSequence = null;
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

            case 'selectRun':

                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelAction.runFolderName);
                return;

            case 'generateTreecipe':

                await this.generateTreecipeAndReload(cockpitPanel, panelState);
                return;

            case 'postPicklistValues':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'loadDatasetRecordCounts':

                this.postDatasetRecordCounts(cockpitPanel, panelState, panelAction.datasetFolderName, panelAction.datasetFolderPath, panelAction.renderSequence);
                return;

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

            case 'refreshDataOrgs':

                await this.loadDataOrgs(cockpitPanel, panelState, true);
                return;

            case 'insertTree':

                await this.insertTreeIntoOrg(cockpitPanel, panelState, panelAction);
                return;

            case 'postInsertState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'viewInsertErrors':

                if ( !this.isUsableWorkspacePath(panelAction.resultsFilePath, panelState.workspaceRoot) ) {
                    VSCodeWorkspaceService.showWarningMessage('The results file of that insert no longer exists in this workspace.');
                    return;
                }

                await VSCodeWorkspaceService.openFileInEditor(panelAction.resultsFilePath);
                return;

            case 'addIterationFriend':

                await this.addFriendToIteration(cockpitPanel, panelState, panelAction);
                return;

            case 'postAddFriendState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'persistPlace':

                this.schedulePanelPlacePersist(panelAction.place);
                return;

            case 'renameTree':

                await this.renameTree(cockpitPanel, panelState, panelAction.folderName);
                return;

            case 'setObjectIncluded':

                await this.setObjectIncluded(cockpitPanel, panelState, panelAction);
                return;

            case 'setFieldIncluded':

                await this.setFieldIncluded(cockpitPanel, panelState, panelAction);
                return;

            case 'setAllFieldsIncluded':

                await this.setAllFieldsIncluded(cockpitPanel, panelState, panelAction);
                return;

            case 'resetTreeSelection':

                await this.resetTreeSelection(cockpitPanel, panelState, panelAction.folderName);
                return;

            case 'setObjectCount':

                await this.setObjectCount(cockpitPanel, panelState, panelAction);
                return;

            case 'setFieldFixedValue':

                await this.setFieldFixedValue(cockpitPanel, panelState, panelAction);
                return;

            case 'toggleFavoriteTree': {

                const treePreferences = this.readTreePreferences(this.recipeCockpitWorkspaceState);

                if ( treePreferences.favoriteFolderNames.has(panelAction.folderName) ) {
                    treePreferences.favoriteFolderNames.delete(panelAction.folderName);
                } else {
                    treePreferences.favoriteFolderNames.add(panelAction.folderName);
                }

                await this.saveAndPostTreePreferences(cockpitPanel, panelState, panelAction.folderName, treePreferences);
                return;

            }

            case 'createScratchOrg':

                await this.createScratchOrgFromPanel(cockpitPanel);
                return;

            case 'postScratchOrgState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'viewScratchOrgOutput':

                await this.openScratchOrgOutput(panelAction.outputFilePath, panelState.workspaceRoot);
                return;

            case 'deployTreeMetadata':

                await this.deployTreeMetadataFromPanel(cockpitPanel, panelAction.treeKey, panelAction.isSelectedOrg);
                return;

            case 'postMetadataDeployState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'viewMetadataDeployOutput':

                await this.openMetadataDeployOutput(panelAction.outputFilePath, panelState.workspaceRoot);
                return;

        }

    }

    /*
        The name is asked for HOST-side, so the panel never posts text to be stored, and checked
        twice: by the box as it is typed, and again on the preferences as they are when it closes,
        because another window of the same workspace can have named a tree while it was open.
    */
    private static async renameTree(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, folderName: string) {

        const shownTrees = panelState.recipeDataMessage?.recipe.trees ?? [];
        const shownTree = shownTrees.find(tree => tree.folderName === folderName);
        const treePreferences = this.readTreePreferences(this.recipeCockpitWorkspaceState);
        // THE INPUT BOX DRAWS [label](command:...) IN ITS PROMPT AS A LINK THAT RUNS THE COMMAND, AND THE FOLDER NAME COMES FROM DISK
        const folderLabel = RecipeYamlScalar.escapeForNotification(folderName);
        const defaultTitleLabel = RecipeYamlScalar.escapeForNotification(shownTree?.title ?? folderName);

        const enteredName = await vscode.window.showInputBox({
            title: 'Rename relationship tree',
            prompt: `A name for the tree in "${folderLabel}", unique in this workspace. Leave it empty to go back to "${defaultTitleLabel}".`,
            placeHolder: shownTree?.title ?? '',
            value: treePreferences.customNamesByFolderName.get(folderName) ?? '',
            validateInput: candidateName => this.validateTreeName(candidateName, folderName, treePreferences, shownTrees)
        });

        if ( enteredName === undefined || this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        const latestTreePreferences = this.readTreePreferences(this.recipeCockpitWorkspaceState);
        const namingProblem = this.validateTreeName(enteredName, folderName, latestTreePreferences, panelState.recipeDataMessage?.recipe.trees ?? []);

        if ( namingProblem ) {
            VSCodeWorkspaceService.showWarningMessage(`The tree was not renamed. ${namingProblem}`);
            return;
        }

        const trimmedName = enteredName.trim();

        if ( trimmedName === '' ) {
            latestTreePreferences.customNamesByFolderName.delete(folderName);
        } else {
            latestTreePreferences.customNamesByFolderName.set(folderName, trimmedName);
        }

        await this.saveAndPostTreePreferences(cockpitPanel, panelState, folderName, latestTreePreferences);

    }

    /*
        Written, then put on the stored model -- which every reveal replays -- and posted for the
        cards of that folder only. The update carries the model's renderSequence: a panel that has
        since drawn another model drops it, and that model was built from what was just written.
    */
    private static async saveAndPostTreePreferences(cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        folderName: string,
                                                        treePreferences: IRecipeCockpitTreePreferences) {

        const isWritten = await this.writeTreePreferences(this.recipeCockpitWorkspaceState, treePreferences);

        if ( !isWritten || this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState || !panelState.recipeDataMessage ) {
            return;
        }

        const recipeDataMessage = panelState.recipeDataMessage;
        this.applyTreePreferences(recipeDataMessage.recipe.trees, treePreferences);

        this.postToPanel(cockpitPanel, this.buildTreePreferencesMessage(recipeDataMessage.recipe.trees, folderName, recipeDataMessage.renderSequence));

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
    private static async addFriendToIteration(cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                addFriendAction: Extract<RecipeCockpitPanelAction, { kind: 'addIterationFriend' }>) {

        const { treeKey, objectApiName, iterationNickname, friendObjectApiName, recipeFilePath } = addFriendAction;
        const isPanelStillCurrent = () => this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState;
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        // THE RUN THE FILE BELONGS TO, READ AT THE CLICK -- THE READER CAN SWITCH RUNS WHILE THE MODAL IS OPEN, AND THE RELOAD SHOWS WHAT WAS WRITTEN
        const writtenRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;

        panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };
        this.postToPanel(cockpitPanel, panelState.addFriendStateMessage);

        try {

            const isAdded = await this.writeFriendToIteration(recipeFilePath, recipeFileLabel, panelState.workspaceRoot, objectApiName, iterationNickname, friendObjectApiName);

            if ( isAdded && isPanelStillCurrent() ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, writtenRunFolderName, { treeKey: treeKey, tab: 'treecipe' });
            }

        } finally {

            panelState.addFriendStateMessage = undefined;

            if ( isPanelStillCurrent() ) {
                this.postToPanel(cockpitPanel, { command: 'addFriendState', isRunning: false });
            }

        }

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeFriendToIteration(recipeFilePath: string,
                                                recipeFileLabel: string,
                                                workspaceRoot: string,
                                                objectApiName: string,
                                                iterationNickname: string,
                                                friendObjectApiName: string): Promise<boolean> {

        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so ${friendObjectApiName} was not added. Re-open the Recipe Cockpit to load the runs currently on disk.`);
            return false;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Add ${friendObjectApiName} under ${iterationNickname}?`,
            {
                modal: true,
                detail: `This writes to "${recipeFileLabel}": a copy of the ${friendObjectApiName} block under the ${objectApiName} above ${iterationNickname}, nested under ${iterationNickname} with a nickname of its own, its lookups to that ${objectApiName} pointed at ${iterationNickname}. Every other line of the file is left as it is.`
            },
            RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL ) {
            return false;
        }

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
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
        undefined when the card excludes nothing and unticks nothing; otherwise the filtered copy, or a
        refusal naming the tree. A recipe that cannot be read, scanned or cut refuses rather than generating the whole
        tree the reader narrowed (#219).
    */
    private static resolveRunFakerFilteredRecipe(panelState: IRecipeCockpitPanelState,
                                                    treeKey: string,
                                                    recipeFilePath: string,
                                                    refusalPrefix = 'Run Faker did not run on'): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } | undefined {

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.treeKey === treeKey);

        if ( this.listExcludedObjectApiNames(tree).length === 0 && this.listExcludedFieldApiNamesByObject(tree).size === 0
                && this.listObjectCountsByObject(tree).size === 0 && !tree?.fixedValues?.length ) {
            return undefined;
        }

        const treeLabel = RecipeYamlScalar.escapeForNotification(tree.customName ?? tree.title);
        const refuse = (reason: string) => ({
            refusalMessage: `${refusalPrefix} ${treeLabel}: ${RecipeYamlScalar.escapeForNotification(reason)} Nothing was generated, rather than the whole tree with what the Treecipe tab leaves out, recounts or fixes put back in.`
        });

        let recipeText: string;
        try {
            recipeText = fs.readFileSync(recipeFilePath, 'utf8');
        } catch (readError) {
            return refuse(`its recipe could not be read (${String(readError?.code ?? readError)}).`);
        }

        const filteredRecipe = this.buildRunFakerFilteredRecipe(recipeText, tree, panelState.objectLevelsByApiName);

        return 'refusalMessage' in filteredRecipe ? refuse(filteredRecipe.refusalMessage) : filteredRecipe;

    }

    /*
        Runs one tree's recipe through Run Faker by Recipe, then adds the data set it wrote to the
        card's Previously Used Data Sets in place (#226). A run that wrote none -- failed, refused or
        cancelled at its modal -- or switched runs meanwhile, or wrote one the host cannot place,
        reloads the run on that tab, as every run used to. Either way the state message is posted
        last, because the panel disabled every Run Faker button on the click, and a run that left
        them disabled would leave a card that can never be run again.

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

        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        let writtenDatasetFolderPath: unknown;
        let hasRunFailed = false;
        let runError: unknown;

        try {

            const filteredRecipe = this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot)
                ? this.resolveRunFakerFilteredRecipe(panelState, treeKey, recipeFilePath)
                : undefined;

            if ( filteredRecipe && 'refusalMessage' in filteredRecipe ) {
                VSCodeWorkspaceService.showWarningMessage(filteredRecipe.refusalMessage);
            } else if ( this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
                try {
                    // A CARD WITH NOTHING EXCLUDED RUNS ITS RECIPE EXACTLY AS IT ALWAYS DID
                    writtenDatasetFolderPath = await vscode.commands.executeCommand(RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath, ...( filteredRecipe ? [filteredRecipe] : [] ));
                } catch (commandError) {
                    hasRunFailed = true;
                    runError = commandError;
                }
            } else {
                VSCodeWorkspaceService.showWarningMessage(`The recipe file "${RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath))}" no longer exists in this workspace, so Run Faker did not run. The Recipe Cockpit has reloaded the run.`);
            }

            // A RELOAD IS OF THE RUN ON SCREEN NOW, NOT AT THE CLICK -- THE READER CAN SWITCH RUNS WHILE GENERATION RUNS
            if ( isPanelStillCurrent() ) {
                const isAddedInPlace = typeof writtenDatasetFolderPath === 'string'
                                        && panelState.recipeDataMessage === clickedRecipeDataMessage
                                        && this.postAddedDataset(cockpitPanel, panelState, clickedRecipeDataMessage, writtenDatasetFolderPath);
                if ( !isAddedInPlace ) {
                    await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelState.recipeDataMessage.recipe.selectedRunFolderName, { treeKey: treeKey, tab: 'datasets' });
                }
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
        Lists the orgs and, when the org chosen last is still among them, selects it. Listing asks
        the Salesforce CLI which authorized orgs are connected, which pings each one's token -- once
        per session, or per ⟳ (isRefresh), since the answer is cached in SalesforceOrgService. The
        extension itself contacts only the org selected.

        The list in hand is dropped BEFORE the check, so no org can be selected until it answers; a
        new model, a ready or a later listing bumps dataOrgRequestSequence meanwhile, and the answer
        is then discarded rather than drawn over whatever replaced it. A remembered org that the CLI
        now reports expired, deleted or not connected is forgotten, and the view says so once.
    */
    // keepUnlistedUsername: A SCRATCH ORG JUST CREATED THE CLI DOES NOT LIST YET IS STILL THE ONE TO SELECT ONCE IT DOES
    private static async loadDataOrgs(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, isRefresh = false, keepUnlistedUsername = false) {

        const listedRecipeDataMessage = panelState.recipeDataMessage;
        panelState.dataOrgDetails = [];
        panelState.dataOrgSelection = undefined;
        const listingRequestSequence = ++panelState.dataOrgRequestSequence;

        let orgDetails: IAuthenticatedOrgDetail[] = [];
        let hiddenOrgs: IHiddenAuthorizedOrg[] = [];
        let hiddenOrgNote = '';
        let noOrgsMessage = NO_AUTHORIZED_ORGS_MESSAGE;

        try {

            if ( isRefresh ) {
                await SalesforceOrgService.refreshConnectedOrgAuthorizations();
            }

            const dataOrgListing = await SalesforceOrgService.listDataOrgDetails();
            orgDetails = dataOrgListing.orgDetails;
            hiddenOrgs = dataOrgListing.hiddenOrgs;
            hiddenOrgNote = this.buildDataOrgHiddenNote(dataOrgListing.hiddenOrgReasonCounts);
            noOrgsMessage = this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts);

        } catch (listError) {

            noOrgsMessage = listError instanceof OrgConnectionStatusUnavailableError
                ? listError.message
                : `The authorized Salesforce orgs could not be listed: ${listError?.message ?? listError}`;

        }

        if ( this.recipeCockpitPanel !== cockpitPanel
                || this.recipeCockpitPanelState !== panelState
                || panelState.recipeDataMessage !== listedRecipeDataMessage
                || panelState.dataOrgRequestSequence !== listingRequestSequence ) {
            return;
        }

        panelState.dataOrgDetails = orgDetails;

        const rememberedUsername = panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername();
        const selectedOrgIndex = rememberedUsername ? orgDetails.findIndex(orgDetail => orgDetail.username === rememberedUsername) : -1;
        let forgottenOrgNotice = '';

        if ( rememberedUsername && selectedOrgIndex === -1 && !keepUnlistedUsername ) {

            const disconnectedRememberedOrg = hiddenOrgs.find(hiddenOrg => hiddenOrg.username === rememberedUsername && hiddenOrg.reason !== 'production');

            if ( disconnectedRememberedOrg ) {
                forgottenOrgNotice = `The last org used, ${disconnectedRememberedOrg.label}, is no longer connected.`;
            }

            panelState.dataOrgUsername = undefined;
            this.rememberDataOrgUsername(undefined);

        }

        this.postToPanel(cockpitPanel, {
            command: 'dataOrgList',
            orgLabels: orgDetails.map(orgDetail => this.buildDataOrgLabel(orgDetail)),
            selectedOrgIndex: selectedOrgIndex >= 0 ? selectedOrgIndex : null,
            noOrgsMessage: orgDetails.length === 0 ? noOrgsMessage : '',
            hiddenOrgCount: SalesforceOrgService.countHiddenOrgs(SalesforceOrgService.countHiddenOrgReasons(hiddenOrgs)),
            hiddenOrgNote: hiddenOrgNote,
            forgottenOrgNotice: forgottenOrgNotice,
            renderSequence: listedRecipeDataMessage.renderSequence
        });

        if ( selectedOrgIndex >= 0 ) {
            await this.selectDataOrg(cockpitPanel, panelState, selectedOrgIndex);
        }

    }

    /*
        "+ New scratch org" (#200). The plan is resolved on the host and refused before any process
        when an input is missing; the modal names what was resolved, and Cancel runs nothing. Then
        create and deploy run under one cancellable notification, their phase mirrored in the
        panel's status line. Once a username exists the org is kept whatever followed, and the
        connected-org cache is dropped BEFORE re-listing -- the session's cached "sf org list"
        predates the org -- so it is selected by username from a fresh answer, or reported not
        listed yet with nothing selected in its place.

        One run per WINDOW, and its state is the window's too: a panel closed and reopened mid-run
        gets a fresh panel state, and without the static copy its router would let a second run, a
        Create or an org selection through while the first is still going. Every state the run
        posts goes to whichever panel the window has NOW. The closing state is posted last, because
        the panel disabled the button, every "+ Create" and the dropdown on the click.
    */
    private static isScratchOrgSetupInFlight = false;

    private static scratchOrgRunStateMessage: IRecipeCockpitScratchOrgStateMessage | undefined;

    private static async createScratchOrgFromPanel(cockpitPanel: vscode.WebviewPanel) {

        // A PANEL THAT DID NOT KNOW A RUN WAS GOING HAS ALREADY DISABLED ITS BUTTON, SO IT IS TOLD WHERE THE RUN IS
        if ( this.isScratchOrgSetupInFlight ) {
            if ( this.scratchOrgRunStateMessage ) {
                this.recipeCockpitPanelState.scratchOrgStateMessage = this.scratchOrgRunStateMessage;
                this.postToPanel(cockpitPanel, this.scratchOrgRunStateMessage);
            }
            return;
        }

        this.isScratchOrgSetupInFlight = true;
        let closingState: { statusText: string; isFailure: boolean; outputFilePath?: string } = { statusText: '', isFailure: false };

        this.setScratchOrgState({ command: 'scratchOrgState', isRunning: true, statusText: '', isFailure: false, hasOutput: false });

        try {

            closingState = await this.performScratchOrgSetup(this.recipeCockpitPanelState.workspaceRoot);

        } catch (setupError) {

            closingState = { statusText: `The scratch org setup stopped: ${setupError?.message ?? setupError}`, isFailure: true };
            throw setupError;

        } finally {

            this.isScratchOrgSetupInFlight = false;
            this.recipeCockpitPanelState.scratchOrgOutputFilePath = closingState.outputFilePath;

            this.setScratchOrgState({
                command: 'scratchOrgState',
                isRunning: false,
                statusText: closingState.statusText,
                isFailure: closingState.isFailure,
                hasOutput: !!closingState.outputFilePath
            });

        }

    }

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setScratchOrgState(scratchOrgStateMessage: IRecipeCockpitScratchOrgStateMessage) {

        this.scratchOrgRunStateMessage = scratchOrgStateMessage.isRunning ? scratchOrgStateMessage : undefined;
        this.recipeCockpitPanelState.scratchOrgStateMessage = scratchOrgStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, scratchOrgStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE A RUN IS GOING STARTS FROM THE RUN'S STATE, SO ITS ROUTER REFUSES WHAT THE RUN HOLDS
    private static adoptScratchOrgRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isScratchOrgSetupInFlight && this.scratchOrgRunStateMessage ) {
            panelState.scratchOrgStateMessage = this.scratchOrgRunStateMessage;
        }

    }

    private static async performScratchOrgSetup(workspaceRoot: string): Promise<{ statusText: string; isFailure: boolean; outputFilePath?: string }> {

        let scratchOrgPlan: IScratchOrgPlan | undefined;

        try {
            scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, () => VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
                SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot),
                RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER
            ));
        } catch (planError) {
            const refusalMessage = String(planError?.message ?? planError);
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(refusalMessage));
            return { statusText: refusalMessage, isFailure: true };
        }

        // NO DEV HUB PICKED -- DISMISSED, OR NONE TO OFFER, WHICH THE PICKER HAS ALREADY SAID -- IS A CANCEL
        if ( !scratchOrgPlan ) {
            return { statusText: '', isFailure: false };
        }

        const devHubLabel = this.toSingleLine(this.buildDevHubLabel(scratchOrgPlan));

        const confirmation = await vscode.window.showWarningMessage(
            `Create a scratch org through the Dev Hub ${devHubLabel} and deploy this project's source to it?`,
            { modal: true, detail: this.buildScratchOrgConfirmationDetail(scratchOrgPlan) },
            RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL ) {
            return { statusText: '', isFailure: false };
        }

        const reportPhase = (phaseText: string) => this.setScratchOrgState({ command: 'scratchOrgState', isRunning: true, statusText: phaseText, isFailure: false, hasOutput: false });

        const setupOutcome: ScratchOrgSetupOutcome = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Recipe Cockpit: scratch org ${scratchOrgPlan.alias}`,
            cancellable: true
        }, async (progress, cancellationToken) => {

            let killCurrentProcess: (() => void) | undefined;
            cancellationToken.onCancellationRequested(() => killCurrentProcess?.());

            return await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, {
                onPhase: (setupPhase: ScratchOrgSetupPhase) => {
                    progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT[setupPhase] });
                    reportPhase(RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT[setupPhase]);
                },
                registerCancellation: (killChildProcess: () => void) => {
                    killCurrentProcess = killChildProcess;
                    if ( cancellationToken.isCancellationRequested ) {
                        killChildProcess();
                    }
                },
                isCancellationRequested: () => cancellationToken.isCancellationRequested
            });

        });

        const alias = scratchOrgPlan.alias;

        if ( setupOutcome.kind === 'createFailed' ) {
            const failureText = `The scratch org ${alias} was not created: ${setupOutcome.failureMessage}`;
            this.showScratchOrgError(failureText, setupOutcome.outputFilePath, workspaceRoot);
            return { statusText: `${failureText} No deploy was attempted.`, isFailure: true, outputFilePath: setupOutcome.outputFilePath };
        }

        if ( setupOutcome.kind === 'createCancelled' ) {
            const cancelledText = `Cancelled while the scratch org ${alias} was being created. A scratch org may still have been created: check with "sf org list".`;
            VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(cancelledText));
            return { statusText: cancelledText, isFailure: true };
        }

        reportPhase(RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT.listing);
        const isListed = await this.listAndSelectNewScratchOrg(setupOutcome.username);
        const orgText = `${alias} (${setupOutcome.username})`;
        const selectionText = isListed
            ? 'It is selected in the Treecipe tab.'
            : `The Salesforce CLI does not list ${orgText} as connected yet, so no org was selected in its place: press ⟳ to check again.`;

        if ( setupOutcome.kind === 'deployFailed' ) {
            const failureHeadline = setupOutcome.componentFailureCount > 0
                ? `Deploy to ${alias} failed — ${setupOutcome.componentFailureCount} component ${setupOutcome.componentFailureCount === 1 ? 'failure' : 'failures'}`
                : `Deploy to ${alias} failed — ${setupOutcome.failureMessage}`;
            this.showScratchOrgError(failureHeadline, setupOutcome.outputFilePath, workspaceRoot);
            return {
                statusText: `${failureHeadline}. The scratch org is kept, but it has none of the project's metadata until a deploy succeeds. ${selectionText}`,
                isFailure: true,
                outputFilePath: setupOutcome.outputFilePath
            };
        }

        if ( setupOutcome.kind === 'deployUnconfirmed' ) {
            const unconfirmedText = `The deploy to ${alias} ran, but its answer was too large to read, so whether it succeeded is unknown. Check it with "sf project deploy report --target-org ${alias}". The scratch org ${orgText} is kept.`;
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(unconfirmedText));
            return { statusText: `${unconfirmedText} ${selectionText}`, isFailure: true };
        }

        if ( setupOutcome.kind === 'deployCancelled' ) {
            const cancelledText = setupOutcome.isDeployStarted
                ? `The deploy to ${alias} was stopped partway, so some components may be missing. The scratch org ${orgText} is kept.`
                : `Cancelled after the scratch org ${orgText} was created, before anything was deployed to it: it has none of the project's metadata. It is kept.`;
            VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(cancelledText));
            return { statusText: `${cancelledText} ${selectionText}`, isFailure: true };
        }

        const deployedText = `Scratch org ${orgText} is ready: ${setupOutcome.deployedComponentCount} ${setupOutcome.deployedComponentCount === 1 ? 'component' : 'components'} deployed.`;
        VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(deployedText));

        return {
            statusText: `${deployedText} ${selectionText}`,
            isFailure: !isListed,
            outputFilePath: setupOutcome.outputFilePath
        };

    }

    // THE ALIAS AND THE USERNAME BOTH: THE ALIAS IS WHAT THE CONFIG NAMES, THE USERNAME IS WHICH ORG THAT IS
    static buildDevHubLabel(scratchOrgPlan: IScratchOrgPlan): string {

        const devHub = scratchOrgPlan.devHub;

        return devHub.alias ? `${devHub.alias} (${devHub.username})` : devHub.username;

    }

    // A MODAL DETAIL IS PLAIN TEXT, BUT A VALUE CARRYING A LINE BREAK -- OF EITHER PARSER'S KIND -- COULD STILL ADD A LINE THAT LOOKS LIKE OURS
    static toSingleLine(text: string): string {

        return String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

    }

    /*
        Names what was resolved AND what the repository's own files decide, since the reader is
        confirming both: where the Dev Hub setting came from (a cloned project's .sf/config.json can
        choose among the reader's Dev Hubs), what the definition sets for the admin, whether the
        deploy copies local files or environment variables in, and that the metadata deployed is
        the repository's.
    */
    static buildScratchOrgConfirmationDetail(scratchOrgPlan: IScratchOrgPlan): string {

        const devHubSourceText: Record<DevHubConfigSource, string> = {
            environment: 'set by an environment variable',
            project: 'set by this project\'s .sf or .sfdx config',
            global: 'your global Salesforce CLI setting'
        };
        const definitionSummary = scratchOrgPlan.definitionSummary;
        const definitionLines = [
            definitionSummary.edition ? `  Edition: ${definitionSummary.edition}` : '',
            definitionSummary.adminEmail ? `  Admin email: ${definitionSummary.adminEmail}` : '',
            definitionSummary.username ? `  Username: ${definitionSummary.username}` : ''
        ].filter(Boolean).map(definitionLine => this.toSingleLine(definitionLine));

        return [
            // WHERE THE SETTING CAME FROM IS SAID ONLY OF THE DEFAULT: ANY OTHER DEV HUB WAS NAMED BY THE READER ALONE
            scratchOrgPlan.devHub.configSource
                ? `Dev Hub: ${this.toSingleLine(this.buildDevHubLabel(scratchOrgPlan))} — the Salesforce CLI's default, ${devHubSourceText[scratchOrgPlan.devHub.configSource]}`
                : `Dev Hub: ${this.toSingleLine(this.buildDevHubLabel(scratchOrgPlan))}`,
            `Definition file: ${scratchOrgPlan.definitionFileRelativePath}`,
            ...definitionLines,
            `Package directories to deploy: ${scratchOrgPlan.packageDirectoryPaths.map(packageDirectoryPath => this.toSingleLine(packageDirectoryPath)).join(', ')}`,
            `Alias: ${scratchOrgPlan.alias}`,
            `Duration: ${scratchOrgPlan.durationDays} days`,
            '',
            'This deploys metadata authored in this repository, and the definition file decides who administers the new org.',
            ...( scratchOrgPlan.hasFileOrEnvironmentReplacements
                ? ['sfdx-project.json has "replacements" that copy local files or environment variables into the deployed metadata.']
                : [] ),
            'The deploy is all or nothing: if any component fails, none is deployed. The scratch org is kept whatever happens, and nothing here deletes an org.'
        ].join('\n');

    }

    // NOT AWAITED: THE RUN ENDS, AND RE-ENABLES THE PANEL, WITHOUT WAITING FOR THE READER TO DISMISS THE NOTIFICATION
    private static showScratchOrgError(errorText: string, outputFilePath: string | undefined, workspaceRoot: string) {

        const actions = outputFilePath ? [RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL] : [];

        Promise.resolve(vscode.window.showErrorMessage(RecipeYamlScalar.escapeForNotification(errorText), ...actions))
            .then(chosenAction => chosenAction === RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL && outputFilePath
                ? this.openScratchOrgOutput(outputFilePath, workspaceRoot)
                : undefined)
            .catch(() => undefined);

    }

    // THE PATH IS THE HOST'S OWN, AND STILL RE-CHECKED: THE FILE CAN HAVE BEEN REPLACED BY A LINK OUT OF THE WORKSPACE SINCE
    private static async openScratchOrgOutput(outputFilePath: string, workspaceRoot: string) {

        if ( !this.isUsableWorkspacePath(outputFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage('The scratch org result file no longer exists in this workspace.');
            return;
        }

        await VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }

    private static isMetadataDeployInFlight = false;

    private static metadataDeployRunStateMessage: IRecipeCockpitMetadataDeployStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setMetadataDeployState(metadataDeployStateMessage: IRecipeCockpitMetadataDeployStateMessage) {

        this.metadataDeployRunStateMessage = metadataDeployStateMessage.isRunning ? metadataDeployStateMessage : undefined;
        this.recipeCockpitPanelState.metadataDeployStateMessage = metadataDeployStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, metadataDeployStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE A DEPLOY IS GOING STARTS FROM ITS STATE, SO ITS ROUTER REFUSES WHAT THE DEPLOY HOLDS
    private static adoptMetadataDeployRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isMetadataDeployInFlight && this.metadataDeployRunStateMessage ) {
            panelState.metadataDeployStateMessage = this.metadataDeployRunStateMessage;
        }

    }

    /*
        "Deploy this metadata…" (#211, #273), for one tree of the model on screen: to the org the
        Treecipe tab has selected (isSelectedOrg, which the router checked answered that it is a
        sandbox), or else to one the reader picks from the same non-production list, which then
        becomes the Treecipe tab's selection once the deploy was confirmed. One at a time per
        window. The CLI's own answer is the result (#270): nothing is described again once it
        returns. A success makes the deployed objects ready on every card that lists them, for the
        selection the deploy started under; a failure leaves the readiness as it was. Once the CLI
        has run, that org's describes of the planned objects are dropped from the session cache
        either way, so no describe from before the deploy outlives it; the insert's own check on the
        click describes them afresh.
    */
    private static async deployTreeMetadataFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string, isSelectedOrg: boolean) {

        const panelState = this.recipeCockpitPanelState;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const deploySelection = isSelectedOrg ? panelState.dataOrgSelection : undefined;

        if ( this.isMetadataDeployInFlight || !tree || ( isSelectedOrg && !deploySelection ) ) {
            this.postToPanel(cockpitPanel, this.metadataDeployRunStateMessage
                ?? panelState.metadataDeployStateMessage
                ?? { command: 'metadataDeployState', isRunning: false, treeKey: '', statusText: '', isFailure: false, hasOutput: false });
            return;
        }

        this.isMetadataDeployInFlight = true;
        const treeLabel = tree.customName || tree.title;
        const objectApiNames = [...new Set(tree.objects.map(treeObject => treeObject.objectApiName))];
        const buildState = (isRunning: boolean, statusText: string, isFailure = false, hasOutput = false): IRecipeCockpitMetadataDeployStateMessage => ({
            command: 'metadataDeployState', isRunning, treeKey, statusText, isFailure, hasOutput
        });
        const reportStatus = (statusText: string) => this.setMetadataDeployState(buildState(true, statusText));
        let closingState: IRecipeCockpitMetadataDeployClosingState = { statusText: '', isFailure: false, isDeployRun: false };
        // SET THE MOMENT THE CLI IS STARTED, SO A THROW AFTER IT STILL DROPS THE CACHED DESCRIBES
        let cliStartedFor: { orgDetail: IAuthenticatedOrgDetail; objectApiNames: string[] } | undefined;

        reportStatus(`Preparing the deploy of ${treeLabel}…`);

        try {

            closingState = await this.performMetadataDeploy(
                panelState.workspaceRoot,
                treeLabel,
                objectApiNames,
                deploySelection ? async () => deploySelection.orgDetail : async () => this.promptForMetadataDeployOrg(reportStatus),
                reportStatus,
                (orgDetail, plannedObjectApiNames) => { cliStartedFor = { orgDetail: orgDetail, objectApiNames: plannedObjectApiNames }; }
            );

        } catch (deployError) {

            closingState = { statusText: `The deploy of ${treeLabel} stopped: ${this.describeThrown(deployError)}`, isFailure: true, isDeployRun: !!cliStartedFor };
            throw deployError;

        } finally {

            /*
                The deploy stays IN FLIGHT -- every deploy, every insert and the picker held -- until
                the readiness its answer changed, and a picked org's selection, have been posted.
            */
            try {

                if ( cliStartedFor ) {
                    const { orgDetail, objectApiNames: plannedObjectApiNames } = cliStartedFor;
                    plannedObjectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(orgDetail.username, objectApiName));
                }

                const currentPanel = this.recipeCockpitPanel;
                const currentPanelState = this.recipeCockpitPanelState;

                if ( closingState.isDeployed === true && deploySelection && currentPanel && currentPanelState.dataOrgSelection === deploySelection ) {
                    await this.postDeployedObjectReadiness(currentPanel, currentPanelState, closingState.deployedObjectApiNames ?? []);
                }

                // AN ORG PICKED HERE IS ONE THE PICKER LISTS, SO IT IS SELECTED FROM THE SESSION'S LISTING, AND DESCRIBED AFRESH
                if ( !deploySelection && closingState.isConfirmed === true && closingState.orgDetail && currentPanel && currentPanelState.recipeDataMessage ) {
                    this.rememberDataOrgUsername(closingState.orgDetail.username);
                    currentPanelState.dataOrgUsername = closingState.orgDetail.username;
                    await this.loadDataOrgs(currentPanel, currentPanelState);
                }

            } finally {

                this.isMetadataDeployInFlight = false;
                this.recipeCockpitPanelState.metadataDeployOutputFilePath = closingState.outputFilePath;
                this.setMetadataDeployState(buildState(false, closingState.statusText, closingState.isFailure, !!closingState.outputFilePath));

            }

        }

    }

    // THE TREECIPE TAB'S OWN LIST: SANDBOXES AND SCRATCH ORGS THE CLI REPORTS CONNECTED, NEVER PRODUCTION
    private static async promptForMetadataDeployOrg(reportStatus: (statusText: string) => void): Promise<IAuthenticatedOrgDetail | undefined> {

        reportStatus('Choose the sandbox or scratch org to deploy to…');

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
            SalesforceOrgService.listDataOrgDetails().then(dataOrgListing => ({
                orgDetails: dataOrgListing.orgDetails,
                emptyListMessage: this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts)
            })),
            RECIPE_COCKPIT_METADATA_DEPLOY_ORG_PLACEHOLDER
        );

    }

    /*
        The plan is made BEFORE an org is asked for, so a project that cannot be deployed opens no
        picker; resolveOrgDetail answering undefined (a dismissed picker) is a quiet cancel.
    */
    private static async performMetadataDeploy(workspaceRoot: string,
                                                treeLabel: string,
                                                objectApiNames: string[],
                                                resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>,
                                                reportStatus: (statusText: string) => void,
                                                onCliStarted: (orgDetail: IAuthenticatedOrgDetail, plannedObjectApiNames: string[]) => void): Promise<IRecipeCockpitMetadataDeployClosingState> {

        const refuse = (refusalText: string, orgDetail?: IAuthenticatedOrgDetail): IRecipeCockpitMetadataDeployClosingState => {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(refusalText));
            return { statusText: refusalText, isFailure: true, isDeployRun: false, orgDetail: orgDetail };
        };

        let packageDirectoryPaths: string[];
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        } catch (projectError) {
            return refuse(`Nothing was deployed: ${this.describeThrown(projectError)}`);
        }

        const deployPlan: ITreeMetadataDeployPlan = RecipeCockpitMetadataDeploy.planTreeMetadataDeploy(treeLabel, objectApiNames, workspaceRoot, packageDirectoryPaths);

        if ( deployPlan.members.length === 0 ) {
            return refuse(RecipeCockpitMetadataDeploy.buildNothingToDeployMessage(deployPlan));
        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`Nothing was deployed: ${this.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return { statusText: '', isFailure: false, isDeployRun: false };
        }

        const plannedObjectApiNames = deployPlan.objectPlans.map(objectPlan => objectPlan.objectApiName);
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THE DEPLOY SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const componentText = `${deployPlan.members.length} ${deployPlan.members.length === 1 ? 'component' : 'components'}`;

        const confirmation = await vscode.window.showWarningMessage(
            `Deploy ${componentText} of ${this.toSingleLine(treeLabel)} to ${this.toSingleLine(orgLabel)}?`,
            { modal: true, detail: RecipeCockpitMetadataDeploy.buildConfirmationDetail(deployPlan, orgLabel) },
            RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL ) {
            return { statusText: '', isFailure: false, isDeployRun: false };
        }

        const confirmed = { orgDetail: orgDetail, isConfirmed: true, deployedObjectApiNames: plannedObjectApiNames };

        /*
            The org was checked when it was selected or listed; it is asked AGAIN, by username, after
            the reader confirmed and before any process -- an org that does not answer that it is a
            sandbox gets no deploy, whatever the selection or the listing said.
        */
        reportStatus(`Checking that ${orgLabel} is a sandbox…`);

        let orgTypeDetail: IOrgTypeDetail | undefined;
        try {
            orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(await SalesforceOrgService.getConnection(orgDetail.username)));
        } catch (connectionError) {
            return { ...refuse(`Nothing was deployed: could not connect to ${orgLabel}: ${this.describeThrown(connectionError)}`, orgDetail), isConfirmed: false };
        }

        if ( orgTypeDetail?.isSandbox !== true ) {
            return { ...refuse(`Nothing was deployed: ${orgLabel} ${orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}` : 'could not say whether it is a sandbox'}. Metadata is deployed only to a sandbox or scratch org.`, orgDetail), isConfirmed: false };
        }

        /*
            The members go in a package.xml OUTSIDE the workspace, so the command line stays short
            whatever the tree holds (cmd.exe refuses one past 8,191 characters) and nothing is left
            in the repository. The folder is removed however the deploy ends.
        */
        const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(deployPlan.members, RecipeCockpitMetadataDeploy.readSourceApiVersion(workspaceRoot));
        const manifestFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-metadata-deploy-'));
        const manifestFilePath = path.join(manifestFolderPath, METADATA_DEPLOY_MANIFEST_FILE_NAME);
        let isCancelled = false;
        let deployInvocation: ISalesforceCliInvocationResult;

        try {

            fs.writeFileSync(manifestFilePath, packageXml, 'utf-8');
            const deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(manifestFilePath, orgDetail.username);

            reportStatus(`Deploying ${componentText} of ${treeLabel}…`);
            onCliStarted(orgDetail, plannedObjectApiNames);

            deployInvocation = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Recipe Cockpit: deploying ${componentText} of ${treeLabel} to ${orgLabel}`,
                cancellable: true
            }, async (_progress, cancellationToken) => {

                let killCurrentProcess: (() => void) | undefined;
                cancellationToken.onCancellationRequested(() => {
                    isCancelled = true;
                    killCurrentProcess?.();
                });

                return await PicklistDependencyCheckService.runSalesforceCli(
                    deployArguments,
                    (killChildProcess: () => void) => {
                        killCurrentProcess = killChildProcess;
                        if ( cancellationToken.isCancellationRequested ) {
                            isCancelled = true;
                            killChildProcess();
                        }
                    },
                    METADATA_DEPLOY_TIMEOUT_MILLISECONDS,
                    { workingDirectoryPath: path.resolve(workspaceRoot), maxBufferBytes: METADATA_DEPLOY_MAX_BUFFER_BYTES }
                );

            });

        } finally {

            fs.rmSync(manifestFolderPath, { recursive: true, force: true });

        }

        if ( isCancelled ) {
            const cancelledText = `The deploy of ${treeLabel} to ${orgLabel} was cancelled, so whether it applied is unknown.`;
            VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(cancelledText));
            return { ...confirmed, statusText: cancelledText, isFailure: true, isDeployRun: true };
        }

        const deployPayload = ScratchOrgService.readCliJsonPayload(deployInvocation);
        const deployOutcome: MetadataDeployOutcome = RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployInvocation, deployPayload);
        const outputFilePath = deployInvocation.spawnError || deployInvocation.isOutputTooLarge
            ? undefined
            : ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, 'metadata-deploy', deployInvocation, new Date(), deployPayload);

        switch ( deployOutcome.kind ) {

            case 'deployed': {
                const deployedText = `Deployed ${deployOutcome.deployedComponentCount} ${deployOutcome.deployedComponentCount === 1 ? 'component' : 'components'} of ${treeLabel} to ${orgLabel}.`;
                VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(deployedText));
                return { ...confirmed, statusText: deployedText, isFailure: false, isDeployRun: true, isDeployed: true, outputFilePath: outputFilePath };
            }

            case 'cliNotInstalled':
                this.showMetadataDeployNotification('error', deployOutcome.failureMessage, undefined, workspaceRoot);
                return { ...confirmed, statusText: deployOutcome.failureMessage, isFailure: true, isDeployRun: false };

            case 'unconfirmed': {
                const unconfirmedText = `${deployOutcome.failureMessage} Check it with "sf project deploy report --target-org ${orgDetail.username}".`;
                this.showMetadataDeployNotification('warning', unconfirmedText, outputFilePath, workspaceRoot);
                return { ...confirmed, statusText: unconfirmedText, isFailure: true, isDeployRun: true, outputFilePath: outputFilePath };
            }

            case 'failed': {
                const failedText = `The deploy of ${treeLabel} to ${orgLabel} failed: ${deployOutcome.failureMessage}`;
                this.showMetadataDeployNotification('error', failedText, outputFilePath, workspaceRoot);
                return { ...confirmed, statusText: failedText, isFailure: true, isDeployRun: true, outputFilePath: outputFilePath };
            }

        }

    }

    private static describeThrown(thrownValue: unknown): string {

        return String(( thrownValue as Error | undefined )?.message ?? thrownValue);

    }

    // NOT AWAITED: THE DEPLOY ENDS, AND RE-ENABLES THE PANEL, WITHOUT WAITING FOR THE READER TO DISMISS THE NOTIFICATION
    private static showMetadataDeployNotification(severity: 'warning' | 'error', notificationText: string, outputFilePath: string | undefined, workspaceRoot: string) {

        const actions = outputFilePath ? [RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL] : [];
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);
        const shownNotification = severity === 'warning'
            ? vscode.window.showWarningMessage(escapedText, ...actions)
            : vscode.window.showErrorMessage(escapedText, ...actions);

        Promise.resolve(shownNotification)
            .then(chosenAction => chosenAction === RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL && outputFilePath
                ? this.openMetadataDeployOutput(outputFilePath, workspaceRoot)
                : undefined)
            .catch(() => undefined);

    }

    // THE PATH IS THE HOST'S OWN, AND STILL RE-CHECKED: THE FILE CAN HAVE BEEN REPLACED BY A LINK OUT OF THE WORKSPACE SINCE
    private static async openMetadataDeployOutput(outputFilePath: string, workspaceRoot: string) {

        if ( !this.isUsableWorkspacePath(outputFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage('The deploy result file no longer exists in this workspace.');
            return;
        }

        await VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }

    /*
        Remembered by USERNAME first, so the listing selects it, and kept even when it is not listed
        yet -- the next ⟳ selects it then. A window with no drawn picker only remembers it.
    */
    private static async listAndSelectNewScratchOrg(orgUsername: string): Promise<boolean> {

        SalesforceOrgService.clearConnectedOrgStatusCache();
        this.rememberDataOrgUsername(orgUsername);

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;

        if ( cockpitPanel && panelState.recipeDataMessage ) {
            panelState.dataOrgUsername = orgUsername;
            await this.loadDataOrgs(cockpitPanel, panelState, false, true);
            return panelState.dataOrgDetails.some(orgDetail => orgDetail.username === orgUsername);
        }

        try {
            return ( await SalesforceOrgService.listDataOrgDetails() ).orgDetails.some(orgDetail => orgDetail.username === orgUsername);
        } catch {
            return false;
        }

    }

    // "3 authorized orgs are not listed: 1 production, 1 expired, 1 not connected." AND WHY THOSE ARE NEVER LISTED
    static buildDataOrgHiddenNote(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        const hiddenOrgCount = SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts);

        if ( hiddenOrgCount === 0 ) {
            return '';
        }

        return `${hiddenOrgCount} authorized ${hiddenOrgCount === 1 ? 'org is' : 'orgs are'} not listed: ${SalesforceOrgService.formatHiddenOrgReasons(hiddenOrgReasonCounts)}. `
                + 'The Treecipe tab lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, never production.';

    }

    // WITH NOTHING LISTED: NONE AUTHORIZED, ONLY PRODUCTION AUTHORIZED, OR NONE STILL CONNECTED
    static buildDataOrgNoOrgsMessage(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        if ( SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts) === 0 ) {
            return NO_AUTHORIZED_ORGS_MESSAGE;
        }

        return hiddenOrgReasonCounts.expired + hiddenOrgReasonCounts.deleted + hiddenOrgReasonCounts.notConnected > 0
            ? RECIPE_COCKPIT_NO_CONNECTED_SANDBOX_ORGS_MESSAGE
            : RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE;

    }

    /*
        Connects to the chosen org by USERNAME, asks the Organization row whether it is a sandbox,
        then describes every object the rendered trees list to say whether "+ Create" is offered.
        It counts no records (#238).

        Every post first checks that this selection is still the current one -- same panel, same
        model, and no later selection or refresh -- and the describes stop as soon as it is not,
        so choosing another org mid-check discards this one's answers rather than drawing them over
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

        const postSelection = (failureMessage = '') => isSelectionCurrent() && this.postToPanel(cockpitPanel, {
            command: 'dataOrgSelection',
            orgIndex: orgIndex,
            orgLabel: orgLabel,
            orgTypeLabel: isOrgTypeAnswered ? SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail) : '',
            isSandbox: dataOrgSelection.orgTypeDetail?.isSandbox ?? null,
            failureMessage: failureMessage,
            requestSequence: requestSequence,
            renderSequence: renderSequence
        });

        postSelection();

        let connection: Connection;
        let querySource: IOrgQuerySource;

        try {
            connection = await SalesforceOrgService.getConnection(orgDetail.username);
            querySource = SalesforceOrgService.toQuerySource(connection);
        } catch (connectionError) {
            isOrgTypeAnswered = true;
            postSelection(`Could not connect to ${orgLabel}: ${connectionError?.message ?? connectionError}. Re-authorize the org with "sf org login web" and try again.`);
            return;
        }

        if ( !isSelectionCurrent() ) {
            return;
        }

        dataOrgSelection.orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        isOrgTypeAnswered = true;

        /*
            Listed only because the CLI knew it as a sandbox or scratch org -- but the org's own
            answer is the one that counts. An org that answers it is not a sandbox, or cannot say,
            is asked NOTHING more: no describe, no Create.
        */
        if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {

            postSelection(`${orgLabel} ${dataOrgSelection.orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail)}` : 'could not say whether it is a sandbox'}, so the Treecipe tab asked it nothing more. It inserts records only into a sandbox or scratch org.`);

            if ( isSelectionCurrent() ) {
                this.postToPanel(cockpitPanel, {
                    command: 'dataOrgReadiness',
                    objects: [...( await this.computeCreateReadiness(orgDetail.username, connection, objectApiNames, dataOrgSelection.orgTypeDetail) ).values()],
                    createTargets: [],
                    insertResults: [],
                    requestSequence: requestSequence,
                    renderSequence: renderSequence
                });
            }

            return;

        }

        postSelection();

        // WHETHER A TREE'S INSERT IS OFFERED NEEDS EACH OBJECT'S DESCRIBE, NONE OF WHICH IS ASKED OF AN ORG THAT HAS NOT ANSWERED IT IS A SANDBOX
        let readinessByObjectApiName: Map<string, IRecipeCockpitCreateReadinessViewModel>;
        let readinessByCreateKey = new Map<string, IRecipeCockpitCreateReadinessViewModel>();

        try {
            const createTargets = await this.collectCreateTargets(panelState, selectedRecipeDataMessage);
            const readinessByTarget = await this.computeCreateReadinessByTarget(orgDetail.username, connection, objectApiNames, dataOrgSelection.orgTypeDetail, createTargets, () => !isSelectionCurrent());
            readinessByObjectApiName = readinessByTarget.byObjectApiName;
            readinessByCreateKey = readinessByTarget.byCreateKey;
        } catch (describeError) {
            const describeFailureMessage = String(describeError?.message ?? describeError);
            readinessByObjectApiName = new Map(objectApiNames.map(objectApiName => [objectApiName, {
                objectApiName: objectApiName,
                disabledReason: `The objects could not be described in this org (${describeFailureMessage}), so nothing is inserted into it.`,
                requiredLookups: []
            }]));
        }

        if ( !isSelectionCurrent() ) {
            return;
        }

        const usernamePrefix = `${orgDetail.username}\n`;

        dataOrgSelection.isReadinessPosted = true;
        this.postToPanel(cockpitPanel, {
            command: 'dataOrgReadiness',
            objects: objectApiNames.map(objectApiName => readinessByObjectApiName.get(objectApiName)).filter(readiness => !!readiness),
            createTargets: [...readinessByCreateKey.values()],
            insertResults: [...panelState.dataOrgInsertResults.entries()]
                .filter(([insertResultKey]) => insertResultKey.startsWith(usernamePrefix))
                .map(([, storedInsertResult]) => storedInsertResult.viewModel),
            requestSequence: requestSequence,
            renderSequence: renderSequence
        });

    }

    /*
        "+ Create" for each object, in one org: fail-closed guards (RecipeCockpitRecordCreation) fed
        with what the org says. An org that has not answered that it is a sandbox is asked nothing
        more -- its answer is the same for every object. Otherwise each object is described (from
        the session cache where it can be). No parent is counted: Create asks for parent Ids only
        after the reader confirms.
    */
    static async computeCreateReadiness(orgUsername: string,
                                        describeSource: IOrgDescribeSource,
                                        objectApiNames: string[],
                                        orgTypeDetail: IOrgTypeDetail | undefined,
                                        isCancellationRequested?: () => boolean): Promise<Map<string, IRecipeCockpitCreateReadinessViewModel>> {

        return ( await this.computeCreateReadinessByTarget(orgUsername, describeSource, objectApiNames, orgTypeDetail, [], isCancellationRequested) ).byObjectApiName;

    }

    /*
        The same, plus one readiness per tree and object (#210): the object's guards, then whether
        that tree's block could be cut and whether it leaves out a field the org requires, against
        the describe the guards already loaded -- so no target costs a request of its own. A block
        field the org lacks is not a reason (#264). A target whose object was not asked about gets
        no readiness.
    */
    static async computeCreateReadinessByTarget(orgUsername: string,
                                                describeSource: IOrgDescribeSource | (() => Promise<IOrgDescribeSource>),
                                                objectApiNames: string[],
                                                orgTypeDetail: IOrgTypeDetail | undefined,
                                                createTargets: IRecipeCockpitCreateTarget[],
                                                isCancellationRequested?: () => boolean): Promise<IRecipeCockpitCreateReadinessByTarget> {

        const readinessByObjectApiName = new Map<string, IRecipeCockpitCreateReadinessViewModel>();
        const readinessByCreateKey = new Map<string, IRecipeCockpitCreateReadinessViewModel>();
        const createTargetsByObjectApiName = new Map<string, IRecipeCockpitCreateTarget[]>();
        createTargets.forEach(createTarget => createTargetsByObjectApiName.set(createTarget.objectApiName, [...( createTargetsByObjectApiName.get(createTarget.objectApiName) ?? [] ), createTarget]));

        const setReadiness = (readinessInput: ICreateReadinessInput) => {
            readinessByObjectApiName.set(readinessInput.objectApiName, RecipeCockpitRecordCreation.buildCreateReadiness(readinessInput));
            ( createTargetsByObjectApiName.get(readinessInput.objectApiName) ?? [] )
                .forEach(createTarget => {
                    const createKey = this.buildTreeObjectKey(createTarget.treeKey, createTarget.objectApiName);
                    const targetReadiness: IRecipeCockpitCreateReadinessViewModel = {
                        ...RecipeCockpitRecordCreation.buildCreateReadiness({
                            ...readinessInput,
                            recipeFieldRefusalReason: createTarget.recipeFieldRefusalReason,
                            excludedFieldApiNames: createTarget.excludedFieldApiNames
                        }),
                        treeKey: createTarget.treeKey
                    };
                    readinessByCreateKey.set(createKey, targetReadiness);
                });
        };

        if ( orgTypeDetail?.isSandbox !== true ) {
            objectApiNames.forEach(objectApiName => setReadiness({ objectApiName: objectApiName, orgTypeDetail: orgTypeDetail }));
            return { byObjectApiName: readinessByObjectApiName, byCreateKey: readinessByCreateKey };
        }

        const describeSourceFactory = typeof describeSource === 'function' ? describeSource : async () => describeSource;
        const describeResult = await SalesforceOrgService.describeObjects(orgUsername, objectApiNames, describeSourceFactory, { isCancellationRequested });

        describeResult.outcomes.forEach(describeOutcome => setReadiness({
            objectApiName: describeOutcome.objectApiName,
            orgTypeDetail: orgTypeDetail,
            describe: describeOutcome.describe,
            describeFailureMessage: describeOutcome.failureMessage
        }));

        return { byObjectApiName: readinessByObjectApiName, byCreateKey: readinessByCreateKey };

    }

    private static buildUnreadableRecipeCreateTarget(treeKey: string, objectApiName: string): IRecipeCockpitCreateTarget {

        return { treeKey: treeKey, objectApiName: objectApiName, recipeFieldRefusalReason: `The recipe file for this tree could not be read, so its ${objectApiName} records could not be prepared.` };

    }

    private static buildCreateTargetFromListing(treeKey: string, objectApiName: string, listed: RecipeBlockFieldListResult, excludedFieldApiNames: string[] = []): IRecipeCockpitCreateTarget {

        return 'refusal' in listed
            ? { treeKey: treeKey, objectApiName: objectApiName, recipeFieldRefusalReason: `The ${objectApiName} block could not be cut from this tree's recipe: ${listed.refusal.message}` }
            : {
                treeKey: treeKey,
                objectApiName: objectApiName,
                recipeFieldApiNames: listed.fieldApiNames,
                ...( excludedFieldApiNames.length > 0 ? { excludedFieldApiNames: [...excludedFieldApiNames] } : {} )
            };

    }

    private static readCreateObjectNickname(recipeObject: IRecipeCockpitObjectViewModel | undefined): string | undefined {

        return recipeObject?.iterations?.length ? recipeObject.nickname : undefined;

    }

    /*
        Every object of every tree the insert is offered on in the model on screen (or of one tree),
        as a target with the fields its block in the tree's recipe sends. Each recipe is read once,
        off the event loop, only from inside the workspace, and SCANNED once for all of its objects
        (listCreateBlockFieldApiNamesForObjects); a recipe that cannot be read is every one of its
        objects' refusal.
    */
    static async collectCreateTargets(panelState: IRecipeCockpitPanelState, recipeDataMessage: IRecipeCockpitRecipeDataMessage, onlyTreeKey?: string): Promise<IRecipeCockpitCreateTarget[]> {

        const recipeObjectsByApiName = new Map<string, IRecipeCockpitObjectViewModel>();
        recipeDataMessage.recipe.objects.forEach(recipeObject => {
            if ( !recipeObjectsByApiName.has(recipeObject.objectApiName) ) {
                recipeObjectsByApiName.set(recipeObject.objectApiName, recipeObject);
            }
        });

        const createTargets: IRecipeCockpitCreateTarget[] = [];

        for ( const tree of recipeDataMessage.recipe.trees.filter(candidateTree => !!candidateTree.runFakerRecipeFileName && ( onlyTreeKey === undefined || candidateTree.treeKey === onlyTreeKey )) ) {

            const objectApiNames = tree.objects
                .filter(treeObject => treeObject.iterationNickname === undefined)
                .map(treeObject => treeObject.objectApiName);

            const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
            const recipeText = recipeFilePath && this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot)
                ? await fs.promises.readFile(recipeFilePath, 'utf-8').catch((): undefined => undefined)
                : undefined;

            if ( recipeText === undefined ) {
                objectApiNames.forEach(objectApiName => createTargets.push(this.buildUnreadableRecipeCreateTarget(tree.treeKey, objectApiName)));
                continue;
            }

            const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);
            const listings = RecipeCockpitRecipeWriter.listCreateBlockFieldApiNamesForObjects(recipeText, objectApiNames.map(objectApiName => ({
                objectApiName: objectApiName,
                objectNickname: this.readCreateObjectNickname(recipeObjectsByApiName.get(objectApiName)),
                excludedFieldApiNames: excludedFieldApiNamesByObject.get(objectApiName) ?? []
            })));

            objectApiNames.forEach((objectApiName, objectIndex) => createTargets.push(
                this.buildCreateTargetFromListing(tree.treeKey, objectApiName, listings[objectIndex], excludedFieldApiNamesByObject.get(objectApiName) ?? [])
            ));

        }

        return createTargets;

    }

    static buildTreeObjectKey(treeKey: string, objectApiName: string): string {

        return `${treeKey}\n${objectApiName}`;

    }

    static buildInsertResultKey(orgUsername: string, treeKey: string): string {

        return `${orgUsername}\n${treeKey}`;

    }

    // EVERY CARD ▶ Run Faker CAN RUN: "Generate fake data and insert" GENERATES THE SAME WAY, SO IT IS OFFERED ON THE SAME CARDS
    static collectInsertableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.trees
            .filter(tree => !!tree.runFakerRecipeFileName)
            .map(tree => tree.treeKey);

    }

    // EVERY CARD WITH A FOLDER AND AN OBJECT: "Deploy this metadata…" IS OFFERED WHATEVER THE ORG ANSWERED (#273)
    static collectDeployableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.trees
            .filter(tree => tree.folderName !== '' && tree.objects.length > 0)
            .map(tree => tree.treeKey);

    }

    /*
        Adds one data set an action just wrote to the model on screen, IN PLACE of a reload (#226):
        to the STORED model, so a reveal's replay draws it, and to the panel through datasetAdded.
        Its row's names go into a COPY of the pending history allow-lists, never the active ones,
        so Open and Insert… stay refused until the panel's "partialRendered" says the row is drawn.
        recipeDataMessage is the model on screen, which the caller has checked is still the one the
        action was clicked on. False when the data set cannot be placed on a card of it: the caller
        reloads.
    */
    static postAddedDataset(cockpitPanel: vscode.WebviewPanel,
                            panelState: IRecipeCockpitPanelState,
                            recipeDataMessage: IRecipeCockpitRecipeDataMessage,
                            datasetFolderPath: string,
                            insertResult?: IRecipeCockpitInsertResultViewModel): boolean {

        const recipeViewModel = recipeDataMessage.recipe;
        const historyTrees = recipeViewModel.trees.filter(tree => tree.folderName !== '' && !!tree.history);
        const addedDataset = RecipeCockpitTreeHistory.buildAddedDataset(
            datasetFolderPath,
            path.join(panelState.workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath()),
            panelState.workspaceRoot,
            recipeViewModel.selectedRunFolderName,
            historyTrees.map(tree => ({ treeKey: tree.treeKey, folderName: tree.folderName }))
        );

        const datasetFolderName = addedDataset?.dataset.datasetFolderName;

        // A NAME THE MODEL ALREADY LISTS IS NOT A NEW ROW -- A RELOAD SAYS WHAT IS ON DISK
        if ( !addedDataset || historyTrees.some(tree => tree.history.datasets.some(dataset => dataset.datasetFolderName === datasetFolderName)) ) {
            return false;
        }

        // NEWEST FIRST, AS A RELOAD ORDERS THEM: THE FOLDER WAS NAMED FROM THE TIME IT WAS WRITTEN
        historyTrees
            .filter(tree => addedDataset.treeKeys.includes(tree.treeKey))
            .forEach(tree => tree.history.datasets.unshift(addedDataset.dataset));

        panelState.treeHistoryTargets.datasetFolderPathsByName.set(datasetFolderName, addedDataset.datasetFolderPath);
        panelState.pendingTreeHistoryAllowLists = this.cloneTreeHistoryAllowLists(panelState.pendingTreeHistoryAllowLists);
        this.addDatasetToAllowLists(panelState.pendingTreeHistoryAllowLists, addedDataset.dataset);

        const datasetAddedMessage: IRecipeCockpitDatasetAddedMessage = {
            command: 'datasetAdded',
            treeKeys: addedDataset.treeKeys,
            dataset: addedDataset.dataset,
            renderSequence: recipeDataMessage.renderSequence,
            updateSequence: ++panelState.datasetUpdateSequence
        };

        if ( insertResult ) {
            datasetAddedMessage.insertResult = insertResult;
        }

        this.postToPanel(cockpitPanel, datasetAddedMessage);

        return true;

    }

    // THE OBJECTS A TREE'S INSERT SENDS: ONCE EACH, WITH A RECIPE, NOT EXCLUDED -- A SELF-LOOKUP'S ITERATION IS THE SAME OBJECT
    static listTreeInsertObjectApiNames(recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): string[] {

        const recipeObjectApiNames = new Set(recipeViewModel.objects.map(objectViewModel => objectViewModel.objectApiName));
        const excludedObjectApiNames = new Set(this.listExcludedObjectApiNames(tree));

        return [...new Set(tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .map(treeObject => treeObject.objectApiName))]
            .filter(objectApiName => recipeObjectApiNames.has(objectApiName) && !excludedObjectApiNames.has(objectApiName));

    }

    /*
        "Generate fake data and insert into <org>" (#255): the tree generated exactly as ▶ Run Faker
        generates it -- the card's selection and counts, the same data set folder, datasetSource.json
        and filtered copy -- then inserted, parents first, through the one insert every command uses
        (CollectionsApiService.insertDataSetFolderIntoOrg): the same all-or-none choice, the same
        InsertAttempts results file, and the same rollback on Cancel or an all-or-none failure.

        Once a data set folder was made, an insert that finished on the model it was clicked on posts
        only its card's result and the new data set (#226), so the org selection and every other card
        stay on screen. One that threw, or whose run changed meanwhile, or whose data
        set the host cannot place, reloads the run onto the card's Treecipe tab, as before. The state
        message is posted last, because the panel disabled every insert on the click.
    */
    private static async insertTreeIntoOrg(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            insertAction: Extract<RecipeCockpitPanelAction, { kind: 'insertTree' }>) {

        const { treeKey } = insertAction;
        const isPanelStillCurrent = () => this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState;

        panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: treeKey };
        this.postToPanel(cockpitPanel, panelState.insertStateMessage);

        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        let isDatasetWritten = false;
        let insertedDatasetFolderPath = '';
        let insertResult: IRecipeCockpitInsertResultViewModel | undefined;
        let hasInsertFailed = false;
        let insertError: unknown;

        try {

            isDatasetWritten = await this.performTreeInsert(cockpitPanel, panelState, insertAction, datasetFolderPath => {
                isDatasetWritten = true;
                insertedDatasetFolderPath = datasetFolderPath;
            }, storedInsertResult => { insertResult = storedInsertResult; });

        } catch (thrownError) {

            hasInsertFailed = true;
            insertError = thrownError;

        } finally {

            panelState.insertStateMessage = undefined;

            if ( isDatasetWritten && isPanelStillCurrent() && panelState.recipeDataMessage ) {

                // A RESULT IS REPORTED ONLY BY AN INSERT THAT REACHED THE END, SO ONE THAT THREW HAS NONE
                const isAddedInPlace = !!insertResult
                                        && panelState.recipeDataMessage === clickedRecipeDataMessage
                                        && this.postAddedDataset(cockpitPanel, panelState, clickedRecipeDataMessage, insertedDatasetFolderPath, insertResult);

                if ( !isAddedInPlace ) {
                    await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelState.recipeDataMessage.recipe.selectedRunFolderName, { treeKey: treeKey, tab: 'treecipe' });
                }

            }

            if ( isPanelStillCurrent() ) {
                this.postToPanel(cockpitPanel, { command: 'insertState', isRunning: false, treeKey: treeKey });
            }

        }

        if ( hasInsertFailed ) {
            throw insertError;
        }

    }

    // TRUE WHEN A DATA SET FOLDER WAS MADE; onDatasetFolderMade SAYS SO EVEN WHEN A LATER STEP THROWS
    private static async performTreeInsert(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            insertAction: Extract<RecipeCockpitPanelAction, { kind: 'insertTree' }>,
                                            onDatasetFolderMade: (datasetFolderPath: string) => void,
                                            onInsertResult: (insertResult: IRecipeCockpitInsertResultViewModel) => void): Promise<boolean> {

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

        if ( !this.isUsableWorkspacePath(recipeFilePath, panelState.workspaceRoot) ) {
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

        // READ AT THE CLICK FROM THE MODEL ON SCREEN, WHICH IS WHAT THE CARD SHOWS; A COPY THAT DOES NOT READ BACK IS NEVER REPLACED BY THE WHOLE TREE
        const filteredRecipeResult = this.resolveRunFakerFilteredRecipe(panelState, treeKey, recipeFilePath, 'Nothing was generated or inserted for');
        if ( filteredRecipeResult && 'refusalMessage' in filteredRecipeResult ) {
            return refuse(filteredRecipeResult.refusalMessage);
        }

        const filteredRecipe = filteredRecipeResult as IRecipeCockpitRunFakerFilteredRecipe | undefined;
        const generationRecipeText = filteredRecipe ? filteredRecipe.recipeText : fs.readFileSync(recipeFilePath, 'utf-8');
        const insertObjectApiNames = this.listTreeInsertObjectApiNames(recipeDataMessage.recipe, tree);
        const insertObjectApiNameSet = new Set(insertObjectApiNames);

        const connection = await SalesforceOrgService.getConnection(orgDetail.username);
        const querySource = SalesforceOrgService.toQuerySource(connection);

        // EVERY OBJECT THE TREE SENDS, AGAINST THE FIELDS OF ITS OWN BLOCK, BEFORE THE READER IS ASKED ANYTHING
        const treeTargets = ( await this.collectCreateTargets(panelState, recipeDataMessage, treeKey) )
            .filter(createTarget => insertObjectApiNameSet.has(createTarget.objectApiName));
        const readinessByTarget = await this.computeCreateReadinessByTarget(orgDetail.username, connection, insertObjectApiNames, dataOrgSelection.orgTypeDetail, treeTargets);
        const readinessByObjectApiName = new Map(insertObjectApiNames.map(objectApiName => [
            objectApiName,
            readinessByTarget.byCreateKey.get(this.buildTreeObjectKey(treeKey, objectApiName)) ?? readinessByTarget.byObjectApiName.get(objectApiName)
        ]));

        const unreadyEntry = [...readinessByObjectApiName].find(([, readiness]) => !readiness || readiness.disabledReason);
        if ( unreadyEntry ) {
            return refuse(`Nothing was inserted into ${orgLabel}: ${RecipeYamlScalar.escapeForNotification(unreadyEntry[1]?.disabledReason ?? `${unreadyEntry[0]} could not be checked.`)}`);
        }

        /*
            A lookup of an object's block to a parent the tree does not insert is asked about in its own
            parent picker (#254), as the per-object Create asked; a required lookup the block does not
            carry still gets a random existing parent, from the org's records.
        */
        const outsidePickableLookups = this.listOutsidePickableLookups(orgDetail.username, treeTargets, insertObjectApiNameSet);
        const pickedLookupKeys = new Set(outsidePickableLookups.map(outsideLookup => `${outsideLookup.objectApiName}\n${outsideLookup.lookup.fieldApiName}`));
        const outsideParentObjectApiNames = [...new Set([...readinessByObjectApiName.values()]
            .flatMap(readiness => readiness.requiredLookups.map(requiredLookup => ({ objectApiName: readiness.objectApiName, requiredLookup: requiredLookup })))
            .filter(({ objectApiName, requiredLookup }) => !insertObjectApiNameSet.has(requiredLookup.parentObjectApiName) && !pickedLookupKeys.has(`${objectApiName}\n${requiredLookup.fieldApiName}`))
            .map(({ requiredLookup }) => requiredLookup.parentObjectApiName))];

        const recordTotalsByObject = new Map([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(generationRecipeText)]
            .filter(([objectApiName]) => insertObjectApiNameSet.has(objectApiName)));

        const confirmation = await vscode.window.showWarningMessage(
            `Generate ${treeLabel} and insert it into ${orgLabel}?`,
            { modal: true, detail: this.buildInsertConfirmationDetail(orgLabel, dataOrgSelection.orgTypeDetail, tree, recipeDataMessage.recipe, recordTotalsByObject, outsideParentObjectApiNames, selectedFakerService, recipeFileLabel, outsidePickableLookups) },
            RECIPE_COCKPIT_INSERT_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_INSERT_CONFIRM_LABEL ) {
            return false;
        }

        // ONE PICKER PER OUTSIDE LOOKUP, BEFORE ANYTHING IS GENERATED; A CANCEL OF ANY ONE ENDS THE INSERT HERE
        const outsideChoicesByObject = new Map<string, Map<string, ILookupParentChoiceWithSearch>>();
        for ( const objectApiName of [...new Set(outsidePickableLookups.map(outsideLookup => outsideLookup.objectApiName))] ) {
            const objectLookups = outsidePickableLookups.filter(outsideLookup => outsideLookup.objectApiName === objectApiName).map(outsideLookup => outsideLookup.lookup);
            const lookupParentPrompt = await this.promptForLookupParentChoices(orgDetail.username, connection, querySource, objectLookups);
            if ( 'cancelledLookup' in lookupParentPrompt ) {
                const { fieldApiName, parentObjectApiName } = lookupParentPrompt.cancelledLookup;
                return refuse(`Nothing was generated or inserted for ${treeLabel}: no ${RecipeYamlScalar.escapeForNotification(parentObjectApiName)} parent was chosen for ${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(fieldApiName)}. Check ${PARENT_PICKER_RANDOM_LABEL} or the records to use, then accept.`);
            }
            outsideChoicesByObject.set(objectApiName, lookupParentPrompt.choices);
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
        const isSameSelection = this.recipeCockpitPanel === cockpitPanel
                                    && this.recipeCockpitPanelState === panelState
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

        // WHAT EACH PICKER ANSWERED, AS THE INSERT GIVES IT OUT; ONLY Ids A LOOKUP'S OWN SEARCH RETURNED MAY BE WRITTEN
        const outsideParentsByObject = new Map<string, Map<string, IOutsideLookupParents>>();
        for ( const { objectApiName, lookup } of outsidePickableLookups ) {
            const { choice, searchReturnedRecordIds } = outsideChoicesByObject.get(objectApiName)?.get(lookup.fieldApiName) as ILookupParentChoiceWithSearch;
            const objectParents = outsideParentsByObject.get(objectApiName) ?? new Map<string, IOutsideLookupParents>();
            if ( choice.kind === 'blank' ) {
                objectParents.set(lookup.fieldApiName, { assignment: 'blank' });
            } else if ( choice.kind === 'chosen' ) {
                if ( !RecipeCockpitRecordCreation.areChosenParentIdsReturnedBySearch(choice.parentRecordIds, searchReturnedRecordIds) ) {
                    return refuse(`The ${RecipeYamlScalar.escapeForNotification(lookup.parentObjectApiName)} records chosen for ${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(lookup.fieldApiName)} are not ones its search returned, so nothing was generated or inserted.`);
                }
                objectParents.set(lookup.fieldApiName, { assignment: 'roundRobin', parentRecordIds: [...choice.parentRecordIds] });
            } else {
                const parentRecordIds = await queryOrgRecordIds(lookup.parentObjectApiName);
                if ( parentRecordIds.length === 0 ) {
                    return refuse(`${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(lookup.fieldApiName)} needs a ${RecipeYamlScalar.escapeForNotification(lookup.parentObjectApiName)} record, and ${orgLabel} returned none, so nothing was generated or inserted.`);
                }
                objectParents.set(lookup.fieldApiName, { assignment: 'random', parentRecordIds: parentRecordIds });
            }
            outsideParentsByObject.set(objectApiName, objectParents);
        }

        // THE SAME COMMAND ▶ Run Faker RUNS, WITH ITS MODAL ALREADY ANSWERED BY THIS ONE
        const confirmationToken = RunFakerConfirmation.issue();
        let datasetFolderPath: unknown;
        try {
            datasetFolderPath = await vscode.commands.executeCommand(RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath, filteredRecipe, { confirmationToken: confirmationToken });
        } finally {
            RunFakerConfirmation.revoke(confirmationToken);
        }

        if ( typeof datasetFolderPath !== 'string' || !SfdxProjectService.isExistingDirectory(datasetFolderPath) || !this.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot) ) {
            return refuse(`${treeLabel} was not generated, so nothing was inserted into ${orgLabel}.`);
        }
        onDatasetFolderMade(datasetFolderPath);

        const insertResult = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection, allOrNoneSelection, {
            prepareRecords: this.buildTreeInsertRecordPreparer(orgDetail.username, insertObjectApiNameSet, orgRecordIdsByObject, choiceCount => Math.floor(Math.random() * choiceCount), outsideParentsByObject)
        });

        onInsertResult(this.storeInsertResult(panelState, orgDetail.username, treeKey, insertResult));

        if ( insertResult.outcome === 'stopped' && !insertResult.isRolledBack ) {
            VSCodeWorkspaceService.showWarningMessage(`The insert of ${treeLabel} into ${orgLabel} stopped at a file that could not be inserted. ${insertResult.savedRecordCount} ${insertResult.savedRecordCount === 1 ? 'record was' : 'records were'} kept, because all-or-none was not chosen; "View errors" in the Treecipe tab opens the results.`);
        } else if ( insertResult.outcome === 'completed' && insertResult.failedRecordCount > 0 ) {
            VSCodeWorkspaceService.showWarningMessage(`${insertResult.savedRecordCount} ${insertResult.savedRecordCount === 1 ? 'record was' : 'records were'} inserted into ${orgLabel} from ${treeLabel} and ${insertResult.failedRecordCount} failed. Nothing was rolled back; "View errors" in the Treecipe tab opens the results.`);
        }

        return true;

    }

    /*
        Every lookup of an inserted object's block (#210's field list, so unticked fields are left out)
        that points at exactly one parent the tree does NOT insert, in the tree's order: what the
        insert asks about in a parent picker (#254). A lookup to a parent the tree inserts is wired to
        this run's records instead, and an object the describe cache does not hold asks nothing.
    */
    static listOutsidePickableLookups(orgUsername: string,
                                        treeTargets: IRecipeCockpitCreateTarget[],
                                        insertObjectApiNames: ReadonlySet<string>): Array<{ objectApiName: string; lookup: IPickableLookup }> {

        return treeTargets.flatMap(treeTarget => {
            const describe = SalesforceOrgService.getCachedDescribe(orgUsername, treeTarget.objectApiName);
            return describe && treeTarget.recipeFieldApiNames
                ? RecipeCockpitRecordCreation.findPickableLookups(describe, treeTarget.recipeFieldApiNames)
                    .filter(pickableLookup => !insertObjectApiNames.has(pickableLookup.parentObjectApiName))
                    .map(pickableLookup => ({ objectApiName: treeTarget.objectApiName, lookup: pickableLookup }))
                : [];
        });

    }

    private static storeInsertResult(panelState: IRecipeCockpitPanelState, orgUsername: string, treeKey: string, insertResult: IDataSetInsertResult): IRecipeCockpitInsertResultViewModel {

        const insertResultViewModel: IRecipeCockpitInsertResultViewModel = {
            treeKey: treeKey,
            savedCount: insertResult.savedRecordCount,
            failedCount: insertResult.failedRecordCount,
            outcome: insertResult.outcome,
            isRolledBack: insertResult.isRolledBack
        };

        panelState.dataOrgInsertResults.set(this.buildInsertResultKey(orgUsername, treeKey), {
            viewModel: insertResultViewModel,
            resultsFilePath: insertResult.resultsFilePath
        });

        return insertResultViewModel;

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
                                            outsideParentsByObject: ReadonlyMap<string, ReadonlyMap<string, IOutsideLookupParents>> = new Map()): DataSetRecordPreparer {

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
                outsideParentsByFieldApiName: outsideParentsByObject.get(objectApiName) ?? new Map()
            }, pickIndex);

        };

    }

    /*
        One picker per lookup of the cut block (#254), in the block's order, each answered before the
        next opens. The search runs on the host against the parent's name field from its describe,
        and every Id a search returns is remembered PER LOOKUP, so the Ids written can be checked
        against what that lookup's own searches answered. A cancel of any one picker names that lookup
        and opens no later picker.
    */
    private static async promptForLookupParentChoices(orgUsername: string,
                                                        connection: Connection,
                                                        querySource: IOrgQuerySource,
                                                        pickableLookups: IPickableLookup[]): Promise<{ choices: Map<string, ILookupParentChoiceWithSearch> } | { cancelledLookup: IPickableLookup }> {

        const choicesByFieldApiName = new Map<string, ILookupParentChoiceWithSearch>();

        for ( const pickableLookup of pickableLookups ) {

            const parentDescribeResult = await SalesforceOrgService.describeObjects(orgUsername, [pickableLookup.parentObjectApiName], async () => connection as unknown as IOrgDescribeSource);
            const parentOutcome = parentDescribeResult.outcomes[0];
            const nameFieldApiName = parentOutcome?.describe ? SalesforceOrgService.findNameFieldApiName(parentOutcome.describe) : undefined;
            const searchUnavailableReason = !parentOutcome?.describe
                ? `${pickableLookup.parentObjectApiName} could not be described (${parentOutcome?.failureMessage ?? 'no answer'}), so it cannot be searched`
                : nameFieldApiName ? undefined : `${pickableLookup.parentObjectApiName} has no name field in its describe, so it cannot be searched`;
            const searchReturnedRecordIds = new Set<string>();

            const pickerAnswer = await VSCodeWorkspaceService.promptForParentRecords({
                fieldApiName: pickableLookup.fieldApiName,
                parentObjectApiName: pickableLookup.parentObjectApiName,
                isRequired: pickableLookup.isRequired,
                nameFieldApiName: nameFieldApiName,
                searchUnavailableReason: searchUnavailableReason,
                resultLimit: ORG_PARENT_SEARCH_RESULT_LIMIT,
                search: async searchText => {
                    const searchResult = await SalesforceOrgService.searchParentRecords(querySource, pickableLookup.parentObjectApiName, nameFieldApiName as string, searchText);
                    searchResult.matches.forEach(parentMatch => searchReturnedRecordIds.add(parentMatch.recordId));
                    return searchResult;
                }
            });

            if ( !pickerAnswer || ( pickerAnswer.kind === 'blank' && pickableLookup.isRequired ) ) {
                return { cancelledLookup: pickableLookup };
            }

            const choice: LookupParentChoice = pickerAnswer.kind === 'chosen'
                ? { kind: 'chosen', parentRecordIds: pickerAnswer.records.map(parentRecord => parentRecord.recordId) }
                : { kind: pickerAnswer.kind };

            choicesByFieldApiName.set(pickableLookup.fieldApiName, { choice: choice, searchReturnedRecordIds: searchReturnedRecordIds });

        }

        return { choices: choicesByFieldApiName };

    }

    static buildInsertConfirmationDetail(orgLabel: string,
                                            orgTypeDetail: IOrgTypeDetail | undefined,
                                            tree: IRecipeCockpitTreeViewModel,
                                            recipeViewModel: IRecipeCockpitRecipeViewModel,
                                            recordTotalsByObject: ReadonlyMap<string, number>,
                                            outsideParentObjectApiNames: string[],
                                            fakerService: string,
                                            recipeFileLabel: string,
                                            outsidePickableLookups: Array<{ objectApiName: string; lookup: IPickableLookup }> = []): string {

        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);
        const objectCountsByObject = this.listObjectCountsByObject(tree);
        const totalRecordCount = [...recordTotalsByObject.values()].reduce((recordCount, objectTotal) => recordCount + objectTotal, 0);
        const requestCount = RecipeCockpitRecordCreation.countInsertRequests(recordTotalsByObject);

        const objectLines = [...recordTotalsByObject].map(([objectApiName, objectTotal]) => {
            const objectViewModel = objectsByApiName.get(objectApiName);
            const perParentCount = objectCountsByObject.get(objectApiName) ?? objectViewModel?.recordCount;
            const perParentText = objectViewModel?.countParentObjectApiName && perParentCount !== undefined
                ? ` (${perParentCount} per ${RecipeYamlScalar.escapeForNotification(objectViewModel.countParentObjectApiName)})`
                : '';
            return `  ${RecipeYamlScalar.escapeForNotification(objectApiName)}: ${objectTotal}${perParentText}`;
        });
        const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);
        const fixedValues = tree.fixedValues ?? [];

        return [
            `Org: ${orgLabel}`,
            `Type: ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}`,
            `Recipe tree: ${RecipeYamlScalar.escapeForNotification(tree.customName ?? tree.title)} (${recipeFileLabel})`,
            `Backend: ${fakerService}`,
            'Records, inserted parents first:',
            ...objectLines,
            ...( excludedFieldApiNamesByObject.size > 0
                ? [`Unticked, not sent: ${[...excludedFieldApiNamesByObject].map(([objectApiName, fieldApiNames]) => fieldApiNames.map(fieldApiName => `${objectApiName}.${fieldApiName}`).join(', ')).map(fieldText => RecipeYamlScalar.escapeForNotification(fieldText)).join(', ')}`]
                : [] ),
            ...( fixedValues.length > 0
                ? [`Fixed values, the same on every record: ${fixedValues.map(fixedValue => RecipeYamlScalar.escapeForNotification(`${fixedValue.objectApiName}.${fixedValue.fieldApiName} = ${fixedValue.value}`)).join(', ')}`]
                : [] ),
            ...( outsidePickableLookups.length > 0
                ? [
                    'Lookups to objects this tree does not insert, each chosen next (Random parent, or parent records you search for; cancelling inserts nothing):',
                    ...outsidePickableLookups.map(({ objectApiName, lookup }) => `  ${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(lookup.fieldApiName)} → ${RecipeYamlScalar.escapeForNotification(lookup.parentObjectApiName)} (${lookup.isRequired ? 'required' : 'optional, or leave blank'})`)
                ]
                : [] ),
            ...( outsideParentObjectApiNames.length > 0
                ? [`Required lookups to objects this tree does not insert get a random existing record of: ${outsideParentObjectApiNames.map(parentObjectApiName => RecipeYamlScalar.escapeForNotification(parentObjectApiName)).join(', ')} (none means nothing is inserted).`]
                : [] ),
            ...( totalRecordCount > RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD
                ? ['', `This run will take time: ${totalRecordCount} records in at least ${requestCount} Collections API requests.`]
                : [] ),
            '',
            'The data set is written to FakeDataSets as Run Faker writes it, then inserted the way Insert Data Set by Directory inserts: you choose all-or-none next, and Cancel on the progress notification deletes every record this insert saved.'
        ].join('\n');

    }

    // THE ALIAS A READER CHOSE BY, WITH THE USERNAME THAT SAYS WHICH ORG IT CURRENTLY POINTS AT
    static buildOrgLabel(orgDetail: IAuthenticatedOrgDetail): string {

        return orgDetail.alias ? `${orgDetail.alias} (${orgDetail.username})` : orgDetail.username;

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

            /*
                The panel's place, kept in workspaceState too (#230). Only for the model the panel
                confirmed drawing, and only naming that model's run: a place is the reader's, and
                the reader cannot have one in a run that is not on screen.
            */
            case 'savePlace': {

                const drawnRunFolderName = panelState.recipeDataMessage?.recipe.selectedRunFolderName;
                const postedRunFolderName = this.isPlainRecord(panelMessage.place) ? panelMessage.place.runFolderName : undefined;

                // THE CHEAP CHECKS FIRST: A PLACE OF ANOTHER RUN IS REFUSED WITHOUT BEING NORMALIZED
                if ( !drawnRunFolderName || postedRunFolderName !== drawnRunFolderName || !panelState.selectableRunFolderNames.has(drawnRunFolderName) ) {
                    return undefined;
                }

                const savedPlace = this.normalizePanelPlace(panelMessage.place);

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
                The data sets tab posts NAMES -- a data set folder -- and each is matched against its
                own allow-list drawn from the confirmed-drawn model, then resolved through a map the
                HOST built. No path the panel could post is ever read.
            */
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

                // A RUN IN FLIGHT ALREADY HOLDS THE BUTTONS DISABLED, AND ITS OWN END RE-ENABLES THEM; AN INSERT GENERATES THROUGH THE SAME COMMAND
                if ( panelState.runFakerStateMessage || panelState.insertStateMessage ) {
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
                are checked is read from the confirmed-drawn model, never from the message.
            */
            case 'loadDataOrgs':

                // A RUN ENDS BY LISTING THE ORGS ITSELF; A SECOND LISTING MEANWHILE WOULD DISCARD ITS ANSWER AND FORGET ITS ORG
                // AN INSERT IN FLIGHT HOLDS THE SELECTION IT CONFIRMED; ITS RELOAD ASKS AGAIN ONCE IT HAS ENDED
                // A METADATA DEPLOY HOLDS THE SELECTION IT DEPLOYS TO, AND CHECKS IT AGAIN WHEN IT ENDS
                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.scratchOrgStateMessage?.isRunning || panelState.insertStateMessage || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                return { kind: 'loadDataOrgs' };

            case 'selectDataOrg': {

                const { orgIndex } = panelMessage;

                if ( typeof orgIndex !== 'number'
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning
                        || panelState.insertStateMessage
                        || !Number.isInteger(orgIndex)
                        || orgIndex < 0
                        || orgIndex >= panelState.dataOrgDetails.length
                        || panelState.dataOrgObjectApiNames.size === 0 ) {
                    return undefined;
                }

                return { kind: 'selectDataOrg', orgIndex: orgIndex };

            }

            /*
                ⟳ asks the CLI again which orgs are connected, re-lists them and re-selects the org
                chosen last by USERNAME, which checks it afresh. It needs no selection: with every
                org left out, it is how a reader who just re-authorized one sees it listed.
            */
            case 'refreshDataOrgs':

                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.scratchOrgStateMessage?.isRunning || panelState.insertStateMessage || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                return { kind: 'refreshDataOrgs' };

            /*
                "+ New scratch org" carries NOTHING: the Dev Hub, the definition file, what is deployed
                and the alias are all the host's. It is honoured only beside a confirmed-drawn
                Data-by-Org picker, and never while a run or a Create is in flight -- whatever the panel
                sends. A refusal while nothing runs still answers, since the panel disabled the button.
            */
            case 'createScratchOrg':

                if ( panelState.scratchOrgStateMessage?.isRunning ) {
                    return undefined;
                }

                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.insertStateMessage || panelState.metadataDeployStateMessage?.isRunning ) {
                    return {
                        kind: 'postScratchOrgState',
                        hostMessage: panelState.scratchOrgStateMessage ?? { command: 'scratchOrgState', isRunning: false, statusText: '', isFailure: false, hasOutput: false }
                    };
                }

                return { kind: 'createScratchOrg' };

            // NO PAYLOAD: THE FILE IS THE ONE THIS PANEL'S LAST RUN WROTE, HELD ON THE HOST
            case 'viewScratchOrgOutput':

                if ( panelState.scratchOrgStateMessage?.isRunning || !panelState.scratchOrgOutputFilePath ) {
                    return undefined;
                }

                return { kind: 'viewScratchOrgOutput', outputFilePath: panelState.scratchOrgOutputFilePath };

            /*
                "Generate fake data and insert" (#255) posts the tree's KEY and nothing else, and it is
                not taken on the panel's word: the tree must be one the confirmed-drawn model drew the
                button on, an org must be selected now, and that org must have answered that it is a
                sandbox. A forged message for a production org stops here, before any connection.
                Which org, which recipe file and which counts are the host's own.
            */
            case 'insertTree': {

                const { treeKey } = panelMessage;

                // AN INSERT IN FLIGHT ALREADY HOLDS EVERY BUTTON DISABLED, AND ITS OWN END RE-ENABLES THEM
                if ( panelState.insertStateMessage ) {
                    return undefined;
                }

                const recipeFilePath = typeof treeKey === 'string' ? panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey) : undefined;
                // A SCRATCH ORG RUN IS ABOUT TO CHANGE THE SELECTION, SO NOTHING IS INSERTED WHILE IT IS IN FLIGHT
                const isRoutable = !panelState.scratchOrgStateMessage?.isRunning
                                    && !panelState.metadataDeployStateMessage?.isRunning
                                    && !panelState.runFakerStateMessage
                                    && typeof treeKey === 'string'
                                    && !!panelState.recipeDataMessage
                                    && !!panelState.dataOrgSelection
                                    && panelState.dataOrgSelection.orgTypeDetail?.isSandbox === true
                                    && panelState.insertableTreeKeys.has(treeKey)
                                    && !!recipeFilePath;

                if ( isRoutable ) {
                    return { kind: 'insertTree', treeKey: treeKey as string, recipeFilePath: recipeFilePath };
                }

                // THE PANEL DISABLED EVERY INSERT ON THE CLICK, SO EVEN A REFUSAL ANSWERS THAT NOTHING RUNS
                return {
                    kind: 'postInsertState',
                    hostMessage: { command: 'insertState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' }
                };

            }

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

                const recipeFilePath = typeof treeKey === 'string'
                                        && typeof objectApiName === 'string'
                                        && typeof objectNickname === 'string'
                                        && typeof friendObjectApiName === 'string'
                                        && !!panelState.recipeDataMessage
                    ? panelState.insertableFriendTargets.get(this.buildInsertableFriendKey(treeKey, objectApiName, objectNickname, friendObjectApiName))
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
                ✎ and ☆ post the card's KEY, matched against the cards the confirmed-drawn model
                drew them on. The name itself is never posted: the host asks for it in its own
                input box, so no text from the panel is ever stored.
            */
            case 'renameTree':
            case 'toggleFavoriteTree': {

                const { treeKey } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.recipeDataMessage || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                const folderName = panelState.recipeDataMessage.recipe.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                return folderName ? { kind: panelMessage.command, folderName: folderName } : undefined;

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
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(this.buildSelectableObjectKey(treeKey, objectApiName)) ) {
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
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(this.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const recipeViewModel = panelState.recipeDataMessage.recipe;
                const drawnNickname = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName)?.nickname;
                if ( nickname !== undefined && nickname !== drawnNickname ) {
                    return undefined;
                }

                const folderName = recipeViewModel.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                return folderName
                    ? { kind: 'setFieldIncluded', treeKey: treeKey, folderName: folderName, objectApiName: objectApiName, fieldApiName: fieldApiName, isIncluded: included }
                    : undefined;

            }

            // All / None OF ONE OBJECT (#220): THE OBJECT'S KEY, AS FOR ITS TREE ICON; WHICH FIELDS THAT TOUCHES IS THE HOST'S
            case 'setAllFieldsIncluded': {

                const { treeKey, objectApiName, nickname, included } = panelMessage;

                if ( typeof treeKey !== 'string' || typeof objectApiName !== 'string' || typeof included !== 'boolean'
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(this.buildSelectableObjectKey(treeKey, objectApiName)) ) {
                    return undefined;
                }

                const recipeViewModel = panelState.recipeDataMessage.recipe;
                const drawnNickname = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName)?.nickname;
                if ( nickname !== undefined && nickname !== drawnNickname ) {
                    return undefined;
                }

                const folderName = recipeViewModel.trees.find(tree => tree.treeKey === treeKey)?.folderName;

                return folderName ? { kind: 'setAllFieldsIncluded', treeKey: treeKey, folderName: folderName, objectApiName: objectApiName, isIncluded: included } : undefined;

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
                        || !panelState.treeHistoryAllowLists.selectableObjectKeys.has(this.buildSelectableObjectKey(treeKey, objectApiName)) ) {
                    return undefined;
                }

                const recipeViewModel = panelState.recipeDataMessage.recipe;
                const objectViewModel = recipeViewModel.objects.find(candidateObject => candidateObject.objectApiName === objectApiName);
                const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);
                if ( !objectViewModel || objectViewModel.recordCount === undefined || ( nickname !== undefined && nickname !== objectViewModel.nickname )
                        || !tree?.folderName || this.listExcludedObjectApiNames(tree).includes(objectApiName) ) {
                    return undefined;
                }

                return { kind: 'setObjectCount', treeKey: treeKey, folderName: tree.folderName, objectApiName: objectApiName, count: count };

            }

            /*
                A field's pin (#262): the same three names as its checkbox, matched against the same
                allow-list, and NO value -- the host asks for it in its own box. A field a lock holds
                back (#220's, a lookup, RecordTypeId, a dependent picklist, an unticked field or an
                excluded object's) is refused here and again before anything is written.
            */
            case 'setFieldFixedValue': {

                const { treeKey, objectApiName, nickname, fieldApiName } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(this.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const recipeViewModel = panelState.recipeDataMessage.recipe;
                const objectViewModel = recipeViewModel.objects.find(candidateObject => candidateObject.objectApiName === objectApiName);
                const fieldViewModel = objectViewModel?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);
                const tree = recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === treeKey);

                if ( !objectViewModel || !fieldViewModel || !tree?.folderName || ( nickname !== undefined && nickname !== objectViewModel.nickname )
                        || this.findFixedValueLockReason(tree, objectViewModel, fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return { kind: 'setFieldFixedValue', treeKey: treeKey, folderName: tree.folderName, objectApiName: objectApiName, fieldApiName: fieldApiName };

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
                "Deploy this metadata…" (#273) posts the tree's KEY, and the INDEX of the org the
                Treecipe tab has selected when it has one; neither decides what is deployed. The key
                must be a card the panel confirmed drawing, and the deploy reads that tree's objects
                from the stored model. An index must BE the selection, and that org must have
                answered that it is a sandbox; with no index the host asks for an org itself, from
                the same non-production list the picker draws. A forged message for production stops
                here, before any connection or process. One deploy at a time, and none while an
                insert or a scratch org run holds the selection.
            */
            case 'deployTreeMetadata': {

                const { orgIndex, treeKey } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                if ( panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                // THE PANEL DISABLED EVERY DEPLOY ON THE CLICK, SO EVEN A REFUSAL ANSWERS THAT NOTHING RUNS
                const refuse = (refusalText = ''): RecipeCockpitPanelAction => ({
                    kind: 'postMetadataDeployState',
                    hostMessage: refusalText && typeof treeKey === 'string'
                        ? { command: 'metadataDeployState', isRunning: false, treeKey: treeKey, statusText: refusalText, isFailure: true, hasOutput: false }
                        : panelState.metadataDeployStateMessage
                            ?? { command: 'metadataDeployState', isRunning: false, treeKey: '', statusText: '', isFailure: false, hasOutput: false }
                });

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.deployableTreeKeys.has(treeKey)
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.insertStateMessage ) {
                    return refuse();
                }

                if ( orgIndex === undefined || orgIndex === null ) {
                    return { kind: 'deployTreeMetadata', treeKey: treeKey, isSelectedOrg: false };
                }

                if ( typeof orgIndex === 'number'
                        && !!dataOrgSelection
                        && dataOrgSelection.orgIndex === orgIndex
                        && dataOrgSelection.orgTypeDetail?.isSandbox === true ) {
                    return dataOrgSelection.isReadinessPosted === true
                        ? { kind: 'deployTreeMetadata', treeKey: treeKey, isSelectedOrg: true }
                        : refuse('Nothing was deployed: the org selected above is still being checked. Deploy once that check has finished.');
                }

                return refuse('Nothing was deployed: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.');

            }

            // NO PAYLOAD: THE FILE IS THE ONE THE LAST DEPLOY WROTE, HELD ON THE HOST
            case 'viewMetadataDeployOutput':

                if ( panelState.metadataDeployStateMessage?.isRunning || !panelState.metadataDeployOutputFilePath ) {
                    return undefined;
                }

                return { kind: 'viewMetadataDeployOutput', outputFilePath: panelState.metadataDeployOutputFilePath };

            // THE TREE'S KEY ALONE: THE RESULTS FILE IS THE HOST'S, STORED FOR THE ORG SELECTED NOW
            case 'viewInsertErrors': {

                const { treeKey } = panelMessage;

                if ( typeof treeKey !== 'string' || !panelState.dataOrgSelection ) {
                    return undefined;
                }

                const storedInsertResult = panelState.dataOrgInsertResults.get(this.buildInsertResultKey(panelState.dataOrgSelection.orgDetail.username, treeKey));

                // A STOP WITH NOTHING COUNTED AS FAILED (A REQUEST THAT THREW) STILL HAS A RESULTS FILE WORTH OPENING
                return storedInsertResult && ( storedInsertResult.viewModel.failedCount > 0 || storedInsertResult.viewModel.outcome === 'stopped' )
                    ? { kind: 'viewInsertErrors', resultsFilePath: storedInsertResult.resultsFilePath }
                    : undefined;

            }

        }

        return undefined;

    }

    // WHERE THE READER ACTED FROM, KEPT ONLY IF IT NAMES A CARD OF THE MODEL ON SCREEN AND ITS DATA SETS TAB
    static readTreeFocus(panelMessage: IRecipeCockpitPanelMessage, panelState: IRecipeCockpitPanelState): IRecipeCockpitTreeFocus | undefined {

        const { treeKey, tab } = panelMessage;
        const isDatasetsTab = tab === 'datasets';
        const isRenderedTree = typeof treeKey === 'string'
                                && !!panelState.recipeDataMessage?.recipe.trees.some(tree => tree.treeKey === treeKey);

        return isDatasetsTab && isRenderedTree ? { treeKey: treeKey as string, tab: tab } : undefined;

    }

    /*
        What a (re)loaded document is brought back to: the model if there is one, then a failure if
        the load died -- the structure on screen is still worth showing, and the reader still has to
        be told the load behind it did not finish -- and otherwise the phase a load is still in.
    */
    static buildReplayMessages(panelState: IRecipeCockpitPanelState): RecipeCockpitHostMessage[] {

        const replayMessages: RecipeCockpitHostMessage[] = [];

        if ( panelState.recipeDataMessage ) {
            replayMessages.push(this.withRestorePlace(panelState.recipeDataMessage, panelState));
        }

        if ( panelState.runFakerStateMessage ) {
            replayMessages.push(panelState.runFakerStateMessage);
        }

        if ( panelState.insertStateMessage ) {
            replayMessages.push(panelState.insertStateMessage);
        }

        if ( panelState.addFriendStateMessage ) {
            replayMessages.push(panelState.addFriendStateMessage);
        }

        if ( panelState.scratchOrgStateMessage ) {
            replayMessages.push(panelState.scratchOrgStateMessage);
        }

        if ( panelState.metadataDeployStateMessage ) {
            replayMessages.push(panelState.metadataDeployStateMessage);
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
                picklistDisplayValuesByObjectApiName: new Map(),
                treeHistoryTargets: RecipeCockpitTreeHistory.buildEmptyTargets()
            };
        }

        const normalizedObjectsWrapper = this.normalizeObjectsWrapper(parsedObjectsWrapper);
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
            recipeViewModel.trees
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
            picklistDisplayValuesByObjectApiName: normalizedObjectsWrapper.picklistDisplayValuesByObjectApiName,
            treeHistoryTargets: treeHistoryBuild.targets,
            ...( normalizedObjectsWrapper.objectLevelsByApiName ? { objectLevelsByApiName: normalizedObjectsWrapper.objectLevelsByApiName } : {} )
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
        const picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName = new Map();
        const parentLookupsByObjectApiName = new Map<string, IRecipeCockpitParentLookupViewModel[]>();
        const objectLevelsByApiName = new Map<string, number>();
        let unreadableFieldCount = 0;

        orderedObjectApiNames.forEach(objectApiName => {

            const wrapperObjectRecord = this.asRecord(objectToObjectInfoMap[objectApiName]);
            const wrapperFields = wrapperObjectRecord?.Fields;
            const recordTypePicklistSections = this.readRecordTypePicklistSections(wrapperObjectRecord?.RecordTypesMap);

            parentLookupsByObjectApiName.set(objectApiName, this.readParentLookups(wrapperObjectRecord?.RelationshipDetail));
            const objectLevel = this.asRecord(wrapperObjectRecord?.RelationshipDetail)?.level;
            if ( typeof objectLevel === 'number' && Number.isInteger(objectLevel) && objectLevel >= 0 ) {
                objectLevelsByApiName.set(objectApiName, objectLevel);
            }

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

                const activePicklistValues = Array.isArray(wrapperFieldRecord.picklistValues)
                    ? this.readActivePicklistValues(wrapperFieldRecord.picklistValues)
                    : undefined;

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

            objects.push({ objectApiName: objectApiName, recipeFilePath: '', fields: fields });

        });

        const notices = unreadableFieldCount > 0
            ? [`${unreadableFieldCount} field ${unreadableFieldCount === 1 ? 'entry' : 'entries'} in the objects wrapper had no field api name and ${unreadableFieldCount === 1 ? 'is' : 'are'} not shown.`]
            : [];

        return {
            objects: objects,
            notices: notices,
            isObjectsWrapper: true,
            fieldlessObjectApiNames: fieldlessObjectApiNames,
            picklistDisplayValuesByObjectApiName: picklistDisplayValuesByObjectApiName,
            recipeTrees: recipeTrees,
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            objectLevelsByApiName: objectLevelsByApiName
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
        const scannedFriendIndex = RecipeCockpitRecipeWriter.buildScannedFriendIndex(scannedObjects);
        const scannedObjectsByHeaderIndex = scannedFriendIndex.objectsByHeaderIndex;

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
                const recordCount = RecipeCockpitRecipeWriter.readObjectCount(lines, scannedObject);
                const countParentObjectApiName = scannedObject.parentHeaderIndex !== undefined ? scannedObjectsByHeaderIndex.get(scannedObject.parentHeaderIndex)?.objectApiName : undefined;
                objectEntries.set(scannedObject.objectApiName, {
                    lineNumber: scannedObject.headerIndex + 1,
                    ...( nickname !== undefined ? { nickname: nickname } : {} ),
                    ...( recordCount !== undefined ? { recordCount: recordCount } : {} ),
                    ...( countParentObjectApiName !== undefined ? { countParentObjectApiName: countParentObjectApiName } : {} ),
                    fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines),
                    ...( RecipeCockpitRecipeWriter.hasRecordTypeSections(lines, scannedObject) ? { hasRecordTypeSections: true } : {} )
                });
                return;
            }

            // A LATER OCCURRENCE IS KEPT ONLY WHEN IT AND THE FIRST EACH CARRY A NICKNAME NO OTHER OCCURRENCE DOES; ANY OTHER IS LEFT TO THE FIRST, AS BEFORE (#188)
            const nickname = readDistinctNickname(scannedObject);
            const firstScannedObject = scannedObjectsByHeaderIndex.get(firstObjectEntry.lineNumber - 1);
            if ( nickname === undefined || readDistinctNickname(firstScannedObject) === undefined ) {
                firstObjectEntry.hasIndistinctOccurrences = true;
                return;
            }

            const parentScannedObject = scannedObjectsByHeaderIndex.get(scannedObject.parentHeaderIndex);
            const insertableFriendObjectApiNames = RecipeCockpitRecipeWriter.listInsertableFriendObjectApiNames(scannedObjects, scannedObject, scannedFriendIndex);
            firstObjectEntry.iterations = [...(firstObjectEntry.iterations ?? []), {
                nickname: nickname,
                lineNumber: scannedObject.headerIndex + 1,
                ...( parentScannedObject ? { parentObjectApiName: parentScannedObject.objectApiName } : {} ),
                ...( parentScannedObject?.nicknames.length === 1 ? { parentNickname: parentScannedObject.nicknames[0] } : {} ),
                fieldEntries: this.readRecipeSourceFieldEntries(scannedObject, lines),
                ...( insertableFriendObjectApiNames.length > 0 ? { insertableFriendObjectApiNames: insertableFriendObjectApiNames } : {} )
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
                lineNumber: objectEntry.lineNumber,
                fields: [...locatedFields, ...unlocatedFields],
                ...( objectEntry.hasIndistinctOccurrences ? { hasIndistinctOccurrences: true } : {} ),
                ...( objectEntry.hasRecordTypeSections ? { hasRecordTypeSections: true } : {} ),
                ...( objectEntry.recordCount !== undefined ? { recordCount: objectEntry.recordCount } : {} ),
                ...( objectEntry.countParentObjectApiName !== undefined ? { countParentObjectApiName: objectEntry.countParentObjectApiName } : {} ),
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
                        })),
                        ...( iteration.insertableFriendObjectApiNames ? { insertableFriendObjectApiNames: iteration.insertableFriendObjectApiNames.slice() } : {} )
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
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.75rem 0 0.25rem 0; }
    .toolbar select, .tabSearchInput {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .toolbar select { padding: 0.3rem; }
    .tabSearch { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.4rem 0.6rem; }
    .tabSearchInput {
        flex: 1 1 16rem;
        min-width: 0;
        padding: 0.3rem 0.5rem;
    }
    .tabSearchInput::placeholder { color: var(--sdt-muted); opacity: 1; }
    .emptyStateActions { margin-top: 0.5rem; }
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
    .sourceLink {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--sdt-accent);
        text-align: left;
        cursor: pointer;
    }
    .sourceLink:focus-visible { outline-offset: -1px; }
    .sourceLink:hover { text-decoration: underline; }
    .treeCard {
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08);
        margin: 0.6rem 0;
        overflow: hidden;
    }
    .treeObjectHeader, .treeFieldHeader { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .treeHeader {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.6rem;
        min-height: 4rem;
        box-sizing: border-box;
        padding: 0.8rem 1rem;
        background-color: var(--sdt-header);
        cursor: pointer;
    }
    .treeHeader:hover { box-shadow: inset 4px 0 0 var(--sdt-accent); }
    .treeTitle { font-weight: 600; font-size: 1.1em; }
    .treeHeaderActions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; cursor: default; }
    .treeToggle, .treeObjectToggle, .picklistToggle, .treeRunFaker, .treeFavorite, .treeRename, .treeTab, .historyAction, .treeAddFriend, .treeAddFriendChoice, .toolbar button, .emptyStateActions button, .dataOrgRefresh, .treeInsert, .treeInsertErrors, .scratchOrgViewOutput, .dataOrgLoad, .dataOrgNewScratch, .treeDeploy, .metadataDeployViewOutput {
        min-height: 2.25rem;
        min-width: 2.25rem;
        padding: 0.4rem 0.8rem;
        font: inherit;
        font-size: 1.1em;
        color: var(--sdt-accent);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 6px;
        cursor: pointer;
    }
    .treeToggle:hover:not(:disabled), .treeObjectToggle:hover:not(:disabled), .picklistToggle:hover:not(:disabled), .treeRunFaker:hover:not(:disabled), .treeFavorite:hover:not(:disabled), .treeRename:hover:not(:disabled), .treeTab:hover:not(:disabled), .historyAction:hover:not(:disabled), .treeAddFriend:hover:not(:disabled), .treeAddFriendChoice:hover:not(:disabled), .dataOrgRefresh:hover:not(:disabled), .treeInsertErrors:hover:not(:disabled), .scratchOrgViewOutput:hover:not(:disabled), .treeDeploy:hover:not(:disabled), .metadataDeployViewOutput:hover:not(:disabled) {
        border-color: var(--sdt-accent);
    }
    .dataOrgRefresh { display: inline-flex; align-items: center; gap: 0.35rem; line-height: 1; }
    .dataOrgRefreshIcon { font-size: 1.5em; line-height: 1; }
    .treeToggle, .treeObjectToggle, .picklistToggle, .picklistToggleSpacer {
        box-sizing: border-box;
        flex: none;
        width: 2.6rem;
        height: 2.6rem;
    }
    .treeToggle, .treeObjectToggle, .picklistToggle { display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }
    .picklistToggleSpacer { display: inline-block; height: 1px; }
    .toggleGlyph { display: block; width: 2.1rem; height: 2.1rem; }
    .toggleGlyph path { fill: var(--sdt-accent); stroke: none; }
    .treeRunFaker, .toolbar button, .emptyStateActions button, .treeInsert, .dataOrgLoad, .dataOrgNewScratch {
        color: var(--sdt-on-accent);
        background-color: var(--sdt-accent);
        border-color: var(--sdt-accent);
        font-weight: 600;
    }
    .treeAddFriend { font-weight: 600; }
    .treeFavorite, .treeRename { padding: 0.4rem 0.6rem; font-size: 1.1em; line-height: 1; }
    .favoritesControls { display: inline-flex; align-items: center; gap: 0.5rem; }
    .treeAddFriendChoice, .historyAction, .treeInsertErrors, .scratchOrgViewOutput, .metadataDeployViewOutput { text-decoration: underline; }
    .treeRunFaker:disabled, .treeAddFriend:disabled, .treeAddFriendChoice:disabled, .toolbar button:disabled, .emptyStateActions button:disabled, .treeInsert:disabled, .dataOrgRefresh:disabled, .treeTab:disabled, .historyAction:disabled, .dataOrgLoad:disabled, .dataOrgNewScratch:disabled, .treeRecordCountInput:disabled, .treeDeploy:disabled {
        color: var(--sdt-disabled-text);
        background-color: var(--sdt-disabled-bg);
        border-color: var(--sdt-border);
        cursor: not-allowed;
        opacity: 1;
    }
    .treeAddFriends { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding-left: 1.5rem; }
    .treeBody { border-top: 1px solid var(--sdt-border); }
    .treeTabs { display: flex; gap: 0.5rem; padding: 0.4rem 0.6rem 0 0.6rem; border-bottom: 1px solid var(--sdt-border); }
    .treeTab { color: var(--sdt-muted); border-color: transparent; border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0; }
    .treeTab:hover:not(:disabled):not(.selected) { background-color: var(--sdt-row-hover); border-color: transparent; border-bottom-color: var(--sdt-border); }
    .treeTab.selected { color: var(--sdt-text); border-bottom-color: var(--sdt-accent); font-weight: 600; }
    .treeObjectHeader { padding: 0.35rem 0.6rem; align-items: center; }
    .treeObject { position: relative; }
    .treeObject.excluded::after {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--sdt-excluded-overlay);
        pointer-events: none;
        z-index: 1;
    }
    .treeObjectInclude, .treeObjectIncludeSpacer {
        box-sizing: border-box;
        flex: none;
        width: 2.6rem;
        height: 2.6rem;
    }
    .treeObjectInclude {
        position: relative;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.15rem;
        color: var(--sdt-text);
        background-color: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
    }
    .treeObjectIncludeSpacer { display: inline-block; }
    .treeObjectInclude:hover:not(:disabled) { background-color: var(--sdt-row-hover); border-color: var(--sdt-border); }
    .treeObjectInclude:disabled { cursor: not-allowed; }
    .treeGlyph { display: block; width: 2.1rem; height: 2.1rem; }
    .treeGlyph path { fill: none; stroke: var(--sdt-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .treeGlyph.excluded path, .treeGlyph.autoExcluded path { stroke: var(--sdt-muted); }
    .treeGlyph.autoExcluded path { stroke-dasharray: 2 2.5; }
    .treeExclusion { font-size: 0.85em; }
    .treeField { position: relative; }
    .treeField.fieldExcluded::after {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--sdt-excluded-overlay);
        pointer-events: none;
        z-index: 1;
    }
    .treeObject.excluded .treeField.fieldExcluded::after { display: none; }
    .treeFieldInclude {
        position: relative;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25em;
        height: 1.25em;
        padding: 0;
        font: inherit;
        font-weight: 700;
        line-height: 1;
        color: var(--sdt-on-accent);
        background-color: var(--sdt-accent);
        border: 1px solid var(--sdt-accent);
        border-radius: 3px;
        cursor: pointer;
    }
    .treeFieldInclude[aria-checked="false"] { background-color: var(--sdt-surface); border-color: var(--sdt-muted); }
    .treeFieldInclude:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); border-color: var(--sdt-border); cursor: not-allowed; }
    .treeFieldFixedValue {
        position: relative;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5em;
        height: 1.5em;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        cursor: pointer;
    }
    .treeFieldFixedValue:hover:not(:disabled) { background-color: var(--sdt-row-hover); border-color: var(--sdt-border); }
    .treeFieldFixedValue:disabled { cursor: not-allowed; }
    .fixedValueGlyph { display: block; width: 1.2em; height: 1.2em; }
    .fixedValueGlyph path { fill: none; stroke: var(--sdt-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .treeFieldFixedValue[aria-pressed="true"] .fixedValueGlyph path { fill: var(--sdt-accent); }
    .treeFieldFixedValue:disabled .fixedValueGlyph path { stroke: var(--sdt-muted); stroke-dasharray: 2 2.5; }
    .fixedValueBadge {
        position: relative;
        z-index: 2;
        padding: 0 0.35em;
        font-size: 0.85em;
        font-weight: 600;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border-radius: 3px;
    }
    .fixedValue {
        margin: 0.15rem 0 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-text);
    }
    .treeFieldNote, .treeFieldWarning { position: relative; z-index: 2; font-size: 0.85em; }
    .treeFieldWarning { color: var(--sdt-changed); }
    .treeFieldBulk { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0.2rem 0.6rem 0.2rem 2.1rem; position: relative; z-index: 2; }
    .treeFieldBulk button, .treeResetSelection {
        min-height: 1.9rem;
        padding: 0.2rem 0.6rem;
        font: inherit;
        font-size: 1.1em;
        color: var(--sdt-accent);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 6px;
        cursor: pointer;
    }
    .treeFieldBulk button:hover:not(:disabled), .treeResetSelection:hover:not(:disabled) { border-color: var(--sdt-accent); }
    .treeFieldBulk button:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); cursor: not-allowed; }
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
    .treeDatasetHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .treeDataset { padding: 0.3rem 0.6rem; }
    .treeDataset:hover { background-color: var(--sdt-row-hover); }
    .treeDatasetDate { font-weight: 600; }
    .treeDatasetCounts { margin: 0.1rem 0 0 0; word-break: break-word; }
    .dataOrgControls { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
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
    .dataOrgStatus { margin: 0.4rem 0; }
    .dataOrgStatus.failed { color: var(--sdt-removed); }
    .scratchOrgStatus { margin: 0.4rem 0; }
    .scratchOrgStatus.failed { color: var(--sdt-removed); }
    .metadataDeployStatus { flex-basis: 100%; }
    .metadataDeployStatus.failed { color: var(--sdt-removed); }
    .scratchOrgViewOutput { margin-left: 0.5rem; }
    .treecipeHeader { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--sdt-border); }
    .treecipeActions, .treeInsertControls, .treeDeployControls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
    .treeRecordCount { display: inline-flex; align-items: baseline; gap: 0.3rem; }
    .treeRecordCountInput {
        width: 5.5rem;
        padding: 0.15rem 0.3rem;
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .treeRecordCountError { color: var(--sdt-removed); }
    .treeInsertResult.succeeded { color: var(--sdt-added); }
    .treeInsertResult.partial { color: var(--sdt-changed); }
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
    const GENERATE_TREECIPE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL)};
    const GENERATE_TREECIPE_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL)};
    const RUN_FAKER_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL)};
    const RUN_FAKER_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL)};
    const ADD_FRIEND_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL)};
    const INSERT_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_INSERT_ACTION_LABEL)};
    const INSERT_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_INSERT_RUNNING_LABEL)};
    const METADATA_DEPLOY_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL)};
    const DATA_ORG_CONNECTION_CHECK_TEXT = ${JSON.stringify(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT)};
    const PANEL_PLACE_VERSION = ${RECIPE_COCKPIT_PANEL_PLACE_VERSION};
    const PANEL_PLACE_SCROLL_SAVE_DELAY = ${RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY};
    const PANEL_PLACE_TABS = ${JSON.stringify(RECIPE_COCKPIT_TREE_TABS)};
    const PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB = ${RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB};
    const TREE_TAB_RENAMES = ${JSON.stringify(RECIPE_COCKPIT_TREE_TAB_RENAMES)};
    const REMOVED_TREE_TABS = ${JSON.stringify(RECIPE_COCKPIT_REMOVED_TREE_TABS)};
    const RENAME_TREE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RENAME_TREE_ACTION_LABEL)};
    const FAVORITE_TREE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FAVORITE_TREE_LABEL)};
    const NOT_FAVORITE_TREE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL)};
    const FAVORITES_ONLY_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FAVORITES_ONLY_LABEL)};
    const NO_FAVORITES_MESSAGE = ${JSON.stringify(RECIPE_COCKPIT_NO_FAVORITES_MESSAGE)};
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const TREE_GLYPH_VIEW_BOX = ${JSON.stringify(RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX)};
    const TREE_GLYPH_TRANSFORM = ${JSON.stringify(RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM)};
    const TREE_LINKED_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH)};
    const TREE_BROKEN_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH)};
    const FIELD_PARENT_EXCLUDED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON)};
    const FIXED_VALUE_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH)};
    const TOGGLE_COLLAPSED_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH)};
    const TOGGLE_EXPANDED_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH)};
    const toggleGlyphPathElements = new WeakMap();
    const FIXED_VALUE_BADGE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL)};
    const FIXED_VALUE_OBJECT_EXCLUDED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON)};
    const FIXED_VALUE_UNTICKED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON)};
    const FIXED_VALUE_RECORD_TYPE_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON)};
    const FIXED_VALUE_LOOKUP_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON)};
    const FIXED_VALUE_DEPENDENT_REASON_PREFIX = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX)};
    const FIXED_VALUE_LOOKUP_FIELD_TYPES = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES)};
    const EVERY_FIELD_UNTICKED_WARNING = ${JSON.stringify(RECIPE_COCKPIT_EVERY_FIELD_UNTICKED_WARNING)};
    const RESET_SELECTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RESET_SELECTION_LABEL)};
    const REFRESH_ORGS_LABEL = ${JSON.stringify(RECIPE_COCKPIT_REFRESH_ORGS_LABEL)};

    let treeStates = [];
    let treesViewElement = null;
    let runSelectElement = null;
    let renderedRunFolderName = '';
    let renderedSequence = null;
    // THE TREE WHOSE RUN FAKER IS RUNNING; IT OUTLIVES A MODEL, BECAUSE THE HOST RELOADS THE RUN BEFORE IT SAYS THE RUN ENDED
    let runFakerRunningTreeKey = null;
    // WHETHER A FRIEND IS BEING ADDED; IT OUTLIVES A MODEL FOR THE SAME REASON
    let isAddFriendRunning = false;
    // EVERY "+" AND FRIEND CHOICE DRAWN FOR THIS MODEL, SO ONE CLICK CAN DISABLE THEM ALL
    let addFriendButtonElements = [];
    // WHETHER THE READER HAS USED THE ORG PICKER; IT OUTLIVES A MODEL, SO A RELOAD CHECKS THE SAME ORG AGAIN
    let isDataOrgPickerInUse = false;
    /*
        The org picker is ONE panel-wide selection (#255) drawn at the top of every card's Treecipe
        tab: each built tab holds a view of it, and every change is drawn into all of them from the
        state below, so a tab built later draws the picker as it stands.
    */
    let dataOrgViews = [];
    let dataOrgLabels = null;
    let isDataOrgLoadShown = true;
    let isDataOrgSelectShown = false;
    let isDataOrgRefreshShown = false;
    let isDataOrgRefreshDisabled = false;
    let dataOrgTypeLabel = null;
    let dataOrgStatusText = '';
    let isDataOrgStatusFailure = false;
    let dataOrgHiddenNoteText = '';
    // "+ New scratch org" (#200): THE HOST'S LAST scratchOrgState, AND WHETHER A RUN HOLDS THE PICKER AND EVERY INSERT DISABLED
    let scratchOrgState = null;
    let isScratchOrgRunning = false;
    // "Deploy this metadata…" (#211, #273): THE HOST'S LAST metadataDeployState, AND WHETHER A DEPLOY HOLDS THE PICKER, EVERY INSERT AND EVERY DEPLOY DISABLED
    let metadataDeployState = null;
    let isMetadataDeployRunning = false;
    // THE renderSequence THE PICKER ASKED FOR ITS ORGS UNDER -- ONE ASK PER MODEL, MADE THE FIRST TIME A TREECIPE TAB OPENS OR THE PICKER IS USED
    let dataOrgRequestedSequence = null;
    // THE LATEST SELECTION THE HOST NAMED; COUNTS FOR ANY OTHER ARE A DIFFERENT ORG'S, OR AN OLDER ASK OF THIS ONE
    let dataOrgRequestSequence = null;
    // THE LAST SELECTION CLEARED BY A RE-LISTING: NOTHING AT OR BELOW IT IS DRAWN AGAIN
    let dataOrgClearedRequestSequence = null;
    let dataOrgSelectedIndex = null;
    // SET WHEN THE SELECTION COULD NOT BE CONNECTED TO, SO NO TREE WAITS ON A READINESS THAT IS NEVER POSTED
    let dataOrgSelectionFailureMessage = '';
    // KEYED BY OBJECT NAMES, AND BY TREE KEY AND OBJECT NAME -- NAMES FROM FILES, SO NO PROTOTYPE
    let dataOrgReadinessByObject = Object.create(null);
    // AN OBJECT'S READINESS IN ONE TREE, FOR ITS BLOCK (#210); THE OBJECT'S ANSWERS WHEN THERE IS NONE
    let dataOrgReadinessByTreeObjectKey = Object.create(null);
    let dataOrgInsertResultsByTreeKey = Object.create(null);
    // THE TREE WHOSE INSERT IS RUNNING; IT OUTLIVES A MODEL, BECAUSE THE HOST RELOADS THE RUN BEFORE IT SAYS THE INSERT ENDED
    let insertRunningTreeKey = null;
    /*
        Where the reader was when this document was last on screen (#222). A hidden tab's document
        is thrown away, so the place is read ONCE, here, and spent on the first model drawn -- and
        only if that model is the run it was saved for. Nothing is saved until it is spent, or the
        default view drawn first would overwrite the place before it is read.
    */
    let restorablePlace = readSavedPanelPlace();
    let isPlaceRestoreSettled = false;
    // EACH TAB A RESTORE SELECTS WOULD SAVE A HALF-RESTORED PLACE, WALKING EVERY CARD; THE RENDER SAVES ONCE AFTER IT
    let isRestoringPlace = false;
    let scrollSaveTimer = null;
    // WHETHER ONLY FAVORITE CARDS ARE SHOWN (#235); IT OUTLIVES A MODEL, SO A RELOAD AFTER RUN FAKER KEEPS THE READER'S VIEW
    let isFavoritesOnly = false;
    let favoritesToggleElement = null;
    let favoritesCountElement = null;
    let noFavoritesElement = null;

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

    /*
        The run selector and the favorites filter. The org picker is no longer here (#255): it is
        drawn at the top of every card's Treecipe tab, and asks the host for its orgs only when it is
        first used or a Treecipe tab is first opened: listing orgs runs the CLI's connection check,
        which no panel open should pay for.
    */
    function renderToolbar(recipe, hasObjects) {

        const toolbarElement = createElement('div', 'toolbar');

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

        cockpitBodyElement.appendChild(toolbarElement);

        if (hasObjects && (recipe.trees || []).some(function (tree) { return !!tree.folderName; })) {
            renderFavoritesToggle(toolbarElement);
        }

    }

    // A PANEL-ONLY FILTER (#235): IT HIDES CARDS, ASKS THE HOST NOTHING, AND IS KEPT WITH THE READER'S PLACE
    function renderFavoritesToggle(toolbarElement) {

        const favoritesElement = createElement('span', 'favoritesControls');

        favoritesToggleElement = createElement('button', 'favoritesToggle');
        favoritesToggleElement.setAttribute('title', 'Show only the trees marked as favorites');
        favoritesToggleElement.addEventListener('click', function () {
            isFavoritesOnly = !isFavoritesOnly;
            applyFavoritesFilter();
            savePanelPlace();
        });

        favoritesCountElement = createElement('span', 'favoritesCount muted hidden');

        favoritesElement.appendChild(favoritesToggleElement);
        favoritesElement.appendChild(favoritesCountElement);
        toolbarElement.appendChild(favoritesElement);

    }

    function displayTitleOf(tree) {
        return tree.customName || tree.title;
    }

    // ONLY WHILE ITS TOGGLE IS DRAWN: A MODEL WITH NO CARD TO MARK WOULD OTHERWISE HIDE EVERY CARD WITH NO WAY TO TURN IT OFF
    function isHiddenByFavorites(treeState) {
        return isFavoritesOnly && favoritesToggleElement !== null && treeState.tree.isFavorite !== true;
    }

    function applyFavoritesFilter() {

        let shownCount = 0;

        treeStates.forEach(function (treeState) {
            if (isHiddenByFavorites(treeState)) {
                treeState.element.classList.add('hidden');
            } else {
                treeState.element.classList.remove('hidden');
                shownCount++;
            }
        });

        if (favoritesToggleElement) {
            favoritesToggleElement.textContent = (isFavoritesOnly ? FAVORITE_TREE_LABEL : NOT_FAVORITE_TREE_LABEL) + ' ' + FAVORITES_ONLY_LABEL;
            favoritesToggleElement.setAttribute('aria-pressed', isFavoritesOnly ? 'true' : 'false');
        }

        if (favoritesCountElement) {
            favoritesCountElement.textContent = shownCount + ' of ' + pluralize(treeStates.length, 'tree', 'trees');
            if (isFavoritesOnly) { favoritesCountElement.classList.remove('hidden'); } else { favoritesCountElement.classList.add('hidden'); }
        }

        if (noFavoritesElement) {
            if (isFavoritesOnly && favoritesToggleElement !== null && shownCount === 0) { noFavoritesElement.classList.remove('hidden'); } else { noFavoritesElement.classList.add('hidden'); }
        }

    }

    /*
        One view of the panel-wide org picker, at the top of a card's Treecipe tab (#255). The
        dropdown is a native select of the LABELS the host posted, and the panel posts back only the
        chosen option's index -- the host holds the usernames.
    */
    function buildDataOrgView() {

        const viewElement = createElement('div', 'dataOrgView');
        const pickerElement = createElement('span', 'dataOrgControls');

        const dataOrgView = {
            element: viewElement,
            loadElement: createElement('button', 'dataOrgLoad', 'Choose org…'),
            selectElement: createElement('select', 'dataOrgSelect hidden'),
            typeElement: createElement('span', 'dataOrgType hidden'),
            refreshElement: createElement('button', 'dataOrgRefresh hidden'),
            newScratchElement: createElement('button', 'dataOrgNewScratch', '+ New scratch org'),
            hiddenNoteElement: createElement('div', 'dataOrgHiddenNote muted hidden'),
            statusElement: createElement('div', 'dataOrgStatus muted hidden'),
            scratchStatusElement: createElement('div', 'scratchOrgStatus muted hidden'),
            scratchStatusTextElement: createElement('span', 'scratchOrgStatusText'),
            scratchViewOutputElement: createElement('button', 'scratchOrgViewOutput hidden', 'View output'),
            drawnLabels: null
        };

        dataOrgView.loadElement.setAttribute('title', 'List the connected sandbox and scratch orgs the generated data can go to');
        dataOrgView.loadElement.addEventListener('click', function () { requestDataOrgs(); });

        dataOrgView.selectElement.setAttribute('aria-label', 'Salesforce org the generated data goes to');
        dataOrgView.selectElement.addEventListener('change', function () {
            const selectedValue = String(dataOrgView.selectElement.value || '');
            if (!selectedValue) { return; }
            vscodeApi.postMessage({ command: 'selectDataOrg', orgIndex: Number(selectedValue) });
        });

        // THE ⟳ GLYPH DRAWS SMALLER THAN THE TEXT AROUND IT, SO IT IS SIZED ON ITS OWN AND THE BUTTON SAYS WHAT IT DOES
        const refreshIconElement = createElement('span', 'dataOrgRefreshIcon', '⟳');
        refreshIconElement.setAttribute('aria-hidden', 'true');
        dataOrgView.refreshElement.appendChild(refreshIconElement);
        dataOrgView.refreshElement.appendChild(createElement('span', 'dataOrgRefreshLabel', REFRESH_ORGS_LABEL));
        dataOrgView.refreshElement.setAttribute('title', 'Check the org connections again');
        // THE ACCESSIBLE NAME STARTS WITH THE VISIBLE LABEL, SO "CLICK REFRESH ORGS" BY VOICE FINDS IT (WCAG 2.5.3)
        dataOrgView.refreshElement.setAttribute('aria-label', REFRESH_ORGS_LABEL + ': check the org connections again');
        dataOrgView.refreshElement.addEventListener('click', function () {
            showDataOrgConnectionCheck();
            vscodeApi.postMessage({ command: 'refreshDataOrgs' });
        });

        // THE MESSAGE CARRIES NOTHING: THE DEV HUB, THE DEFINITION FILE, WHAT IS DEPLOYED AND THE ALIAS ARE ALL THE HOST'S
        dataOrgView.newScratchElement.setAttribute('title', 'Choose a Dev Hub, create a scratch org through it, deploy the source of this project to it and select it');
        dataOrgView.newScratchElement.addEventListener('click', function () {
            if (isScratchOrgRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || renderedSequence === null) { return; }
            isDataOrgPickerInUse = true;
            isScratchOrgRunning = true;
            drawDataOrgViews();
            drawTreeInserts();
            vscodeApi.postMessage({ command: 'createScratchOrg' });
        });

        dataOrgView.scratchViewOutputElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'viewScratchOrgOutput' });
        });

        pickerElement.appendChild(dataOrgView.loadElement);
        pickerElement.appendChild(dataOrgView.selectElement);
        pickerElement.appendChild(dataOrgView.typeElement);
        pickerElement.appendChild(dataOrgView.refreshElement);
        pickerElement.appendChild(dataOrgView.newScratchElement);
        viewElement.appendChild(pickerElement);
        viewElement.appendChild(dataOrgView.hiddenNoteElement);
        viewElement.appendChild(dataOrgView.statusElement);
        dataOrgView.scratchStatusElement.appendChild(dataOrgView.scratchStatusTextElement);
        dataOrgView.scratchStatusElement.appendChild(dataOrgView.scratchViewOutputElement);
        viewElement.appendChild(dataOrgView.scratchStatusElement);

        dataOrgViews.push(dataOrgView);
        drawDataOrgView(dataOrgView);

        return dataOrgView;

    }

    function setShown(element, isShown) {
        if (isShown) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
    }

    /*
        The picker state drawn into one view. While a scratch org run is in flight the picker is
        held: the button, the dropdown, ⟳ and "Choose org…" are disabled, whatever a listing posted
        meanwhile draws -- the run ends by selecting the org it made. Every text is the host's,
        through textContent.
    */
    function drawDataOrgView(dataOrgView) {

        if (dataOrgView.drawnLabels !== dataOrgLabels) {
            dataOrgView.selectElement.textContent = '';
            if (dataOrgLabels && dataOrgLabels.length > 0) {
                const placeholderElement = createElement('option', '', 'Choose org…');
                placeholderElement.value = '';
                dataOrgView.selectElement.appendChild(placeholderElement);
                dataOrgLabels.forEach(function (orgLabel, orgIndex) {
                    const optionElement = createElement('option', '', orgLabel);
                    optionElement.value = String(orgIndex);
                    dataOrgView.selectElement.appendChild(optionElement);
                });
            }
            dataOrgView.drawnLabels = dataOrgLabels;
        }

        dataOrgView.selectElement.value = dataOrgSelectedIndex === null ? '' : String(dataOrgSelectedIndex);
        setShown(dataOrgView.loadElement, isDataOrgLoadShown);
        setShown(dataOrgView.selectElement, isDataOrgSelectShown);
        setShown(dataOrgView.refreshElement, isDataOrgRefreshShown);
        dataOrgView.typeElement.textContent = dataOrgTypeLabel || '';
        setShown(dataOrgView.typeElement, dataOrgTypeLabel !== null);

        dataOrgView.hiddenNoteElement.textContent = dataOrgHiddenNoteText;
        setShown(dataOrgView.hiddenNoteElement, !!dataOrgHiddenNoteText);

        dataOrgView.statusElement.textContent = dataOrgStatusText;
        setShown(dataOrgView.statusElement, !!dataOrgStatusText);
        if (isDataOrgStatusFailure) { dataOrgView.statusElement.classList.add('failed'); } else { dataOrgView.statusElement.classList.remove('failed'); }

        // AN INSERT IN FLIGHT HOLDS IT TOO: THE HOST WOULD REFUSE A RUN THAT CHANGES THE SELECTION UNDER IT
        dataOrgView.newScratchElement.disabled = isScratchOrgRunning || isMetadataDeployRunning || insertRunningTreeKey !== null;
        dataOrgView.newScratchElement.textContent = isScratchOrgRunning ? 'Setting up scratch org…' : '+ New scratch org';
        // A METADATA DEPLOY HOLDS THE PICKER TOO: IT DEPLOYS TO THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
        dataOrgView.selectElement.disabled = isScratchOrgRunning || isMetadataDeployRunning;
        dataOrgView.loadElement.disabled = isScratchOrgRunning || isMetadataDeployRunning;
        dataOrgView.refreshElement.disabled = isScratchOrgRunning || isMetadataDeployRunning || isDataOrgRefreshDisabled;

        const scratchStatusText = scratchOrgState ? scratchOrgState.statusText : '';
        dataOrgView.scratchStatusTextElement.textContent = scratchStatusText;
        setShown(dataOrgView.scratchStatusElement, !!scratchStatusText);
        if (scratchOrgState && scratchOrgState.isFailure) { dataOrgView.scratchStatusElement.classList.add('failed'); } else { dataOrgView.scratchStatusElement.classList.remove('failed'); }
        setShown(dataOrgView.scratchViewOutputElement, !!scratchOrgState && !scratchOrgState.isRunning && !!scratchOrgState.hasOutput);

    }

    function drawDataOrgViews() {
        dataOrgViews.forEach(drawDataOrgView);
    }

    /*
        One lowercased haystack per FIELD, shared by every occurrence of its object a card draws, so
        the faker expression that dominates it is lowercased and held once. The type is matched
        separately, as the type with its size the row draws, because a match has to be on screen.
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

    function isFieldTextMatch(fieldState, searchQuery) {
        return searchTextOf(fieldState.field).indexOf(searchQuery) !== -1 || fieldState.typeSearchText.indexOf(searchQuery) !== -1;
    }

    /*
        Every tab of every card has its own search box (#217). Its text lives in the card's state
        and its element stays in the tab's panel, so switching tabs or collapsing the card keeps
        it; a new model draws new cards, which starts every box empty.
    */
    function buildTabSearch(treeState, tabName, placeholderText, applySearch) {

        const searchElement = createElement('div', 'tabSearch');
        const inputElement = createElement('input', 'tabSearchInput');
        const matchCountElement = createElement('span', 'tabMatchCount muted');

        inputElement.setAttribute('type', 'search');
        inputElement.setAttribute('placeholder', placeholderText);
        inputElement.setAttribute('aria-label', placeholderText + ' (' + displayTitleOf(treeState.tree) + ')');
        inputElement.value = treeState.searchTexts[tabName];
        inputElement.addEventListener('input', function () {
            treeState.searchTexts[tabName] = String(inputElement.value || '');
            treeState.searchQueries[tabName] = treeState.searchTexts[tabName].trim().toLowerCase();
            applySearch(treeState);
            savePanelPlace();
        });

        searchElement.appendChild(inputElement);
        searchElement.appendChild(matchCountElement);

        return { element: searchElement, inputElement: inputElement, matchCountElement: matchCountElement };

    }

    // ROWS WHOSE VALUES WERE ASKED FOR AND NOT YET ANSWERED, BY OBJECT AND FIELD -- KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
    let pendingPicklistValueElements = Object.create(null);

    // DATA SET COUNT ROWS WAITING ON THE HOST, AND THE ANSWERS ALREADY HAD -- KEYED BY FOLDER NAMES FROM DISK, SO NO PROTOTYPE
    let pendingDatasetCountElements = Object.create(null);
    let answeredDatasetCounts = Object.create(null);

    // A SELF-LOOKUP NAMES ONLY ITS FIELD: "(ParentId)" SAYS WHAT "(ParentId → Account)" SAYS ON Account, WITHOUT THE REPEAT
    // A LOOKUP TO AN EXCLUDED PARENT IS SAID SO, AND IS LEFT OUT OF WHAT IS GENERATED (#219)
    function formatParentLookups(treeObject, disabledFieldApiNames) {

        if (!treeObject.parentLookups || treeObject.parentLookups.length === 0) { return ''; }

        return '(' + treeObject.parentLookups.map(function (parentLookup) {
            if (parentLookup.parentObjectApiName === treeObject.objectApiName) { return parentLookup.fieldApiName; }
            const lookupText = parentLookup.fieldApiName + ' → ' + parentLookup.parentObjectApiName;
            return disabledFieldApiNames && disabledFieldApiNames.indexOf(parentLookup.fieldApiName) !== -1 ? lookupText + ' · parent excluded' : lookupText;
        }).join(', ') + ')';

    }

    /*
        The tree icon (#219): a real button, keyboard operable, that never expands its row. Its SVG
        is built node by node -- no markup string -- and coloured by CSS from the palette alone.
        A click posts what the reader asked for; what that excludes comes back from the host.
    */
    function buildToggleElement(className) {

        const toggleElement = createElement('button', className);
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        glyphElement.setAttribute('class', 'toggleGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', TOGGLE_COLLAPSED_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        toggleElement.appendChild(glyphElement);
        toggleGlyphPathElements.set(toggleElement, pathElement);

        return toggleElement;

    }

    function drawToggle(toggleElement, isExpanded) {
        toggleGlyphPathElements.get(toggleElement).setAttribute('d', isExpanded ? TOGGLE_EXPANDED_GLYPH_PATH : TOGGLE_COLLAPSED_GLYPH_PATH);
        toggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function buildTreeGlyph(treeObjectState) {

        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        glyphElement.setAttribute('class', 'treeGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', TREE_LINKED_GLYPH_PATH);
        pathElement.setAttribute('transform', TREE_GLYPH_TRANSFORM);
        glyphElement.appendChild(pathElement);
        treeObjectState.glyphPathElement = pathElement;

        return glyphElement;

    }

    function buildIncludeElement(treeObjectState, treeKey) {

        const includeElement = createElement('button', 'treeObjectInclude');
        const object = treeObjectState.object;

        treeObjectState.glyphElement = buildTreeGlyph(treeObjectState);
        treeObjectState.includeElement = includeElement;
        includeElement.appendChild(treeObjectState.glyphElement);
        includeElement.addEventListener('click', function () {
            if (includeElement.disabled) { return; }
            const message = { command: 'setObjectIncluded', treeKey: treeKey, objectApiName: object.objectApiName, included: !treeObjectState.isIncluded };
            if (object.nickname) { message.nickname = object.nickname; }
            vscodeApi.postMessage(message);
        });

    }

    // KEYED BY OBJECT NAMES FROM DISK, SO NO PROTOTYPE: AN OBJECT NAMED __proto__ IS A KEY LIKE ANY OTHER
    // ONE INDEX PER SELECTION THE HOST POSTED, SO EVERY CREATE ROW OF A CARD READS THE SAME ONE
    const exclusionIndexesBySelection = new WeakMap();

    function indexObjectExclusions(tree) {

        const objectSelection = tree.objectSelection;
        if (!objectSelection || typeof objectSelection !== 'object') { return Object.create(null); }
        if (exclusionIndexesBySelection.has(objectSelection)) { return exclusionIndexesBySelection.get(objectSelection); }

        const exclusionsByObjectApiName = Object.create(null);
        const exclusions = Array.isArray(objectSelection.exclusions) ? objectSelection.exclusions : [];

        exclusions.forEach(function (exclusion) { exclusionsByObjectApiName[exclusion.objectApiName] = exclusion; });
        exclusionIndexesBySelection.set(objectSelection, exclusionsByObjectApiName);

        return exclusionsByObjectApiName;

    }

    function findObjectExclusion(tree, objectApiName) {

        const exclusionsByObjectApiName = indexObjectExclusions(tree);

        return Object.prototype.hasOwnProperty.call(exclusionsByObjectApiName, objectApiName) ? exclusionsByObjectApiName[objectApiName] : null;

    }

    function formatTreeCount(treeState) {

        const objectSelection = treeState.tree.objectSelection;
        const objectText = objectSelection
            ? objectSelection.includedObjectCount + ' of ' + pluralize(objectSelection.objectCount, 'object', 'objects')
            : pluralize(treeState.countedObjectCount, 'object', 'objects');

        return objectText + ' · ' + pluralize(treeState.countedFieldCount, 'field', 'fields');

    }

    /*
        The host's cascade drawn onto one card: each row's icon, overlay and label, the lookups of
        an included object that point at an excluded parent, and the header's count. The state is
        never colour alone -- the icon's SHAPE, aria-pressed, the title and the label all say it.
    */
    function drawObjectSelection(treeState) {

        const tree = treeState.tree;
        const disabledLookups = tree.objectSelection && Array.isArray(tree.objectSelection.disabledLookups) ? tree.objectSelection.disabledLookups : [];
        const exclusionsByObjectApiName = indexObjectExclusions(tree);
        // INDEXED ONCE PER DRAW: A PER-ROW SCAN OF THE LISTS WAS OVER A SECOND AT 11,000 ROWS
        const disabledFieldApiNamesByObjectApiName = Object.create(null);
        disabledLookups.forEach(function (disabledLookup) {
            if (!Object.prototype.hasOwnProperty.call(disabledFieldApiNamesByObjectApiName, disabledLookup.objectApiName)) {
                disabledFieldApiNamesByObjectApiName[disabledLookup.objectApiName] = [];
            }
            disabledFieldApiNamesByObjectApiName[disabledLookup.objectApiName].push(disabledLookup.fieldApiName);
        });

        treeState.objectStates.forEach(function (treeObjectState) {

            const objectApiName = treeObjectState.object.objectApiName;
            const exclusion = Object.prototype.hasOwnProperty.call(exclusionsByObjectApiName, objectApiName) ? exclusionsByObjectApiName[objectApiName] : null;
            const isAutoExcluded = !!exclusion && exclusion.kind === 'autoExcluded';

            if (exclusion) { treeObjectState.element.classList.add('excluded'); } else { treeObjectState.element.classList.remove('excluded'); }

            treeObjectState.exclusionElement.textContent = !exclusion ? ''
                : isAutoExcluded ? 'auto-excluded — parent ' + exclusion.excludedParentObjectApiName + ' excluded'
                : 'excluded';
            if (exclusion) { treeObjectState.exclusionElement.classList.remove('hidden'); } else { treeObjectState.exclusionElement.classList.add('hidden'); }

            const disabledFieldApiNames = Object.prototype.hasOwnProperty.call(disabledFieldApiNamesByObjectApiName, objectApiName)
                ? disabledFieldApiNamesByObjectApiName[objectApiName]
                : [];
            treeObjectState.lookupsElement.textContent = formatParentLookups(treeObjectState.treeObject, disabledFieldApiNames);
            if (treeObjectState.lookupsElement.textContent) { treeObjectState.lookupsElement.classList.remove('hidden'); } else { treeObjectState.lookupsElement.classList.add('hidden'); }

            // AN EXCLUDED OBJECT IS NOT GENERATED, SO ITS COUNT CANNOT BE CHANGED; RE-INCLUDED, ITS STORED COUNT COMES BACK
            if (treeObjectState.countInputElement) {
                treeObjectState.countInputElement.disabled = !!exclusion;
                treeObjectState.countInputElement.value = String(currentRecordCountOf(treeObjectState));
                treeObjectState.countErrorElement.textContent = '';
                treeObjectState.countErrorElement.classList.add('hidden');
            }

            if (!treeObjectState.includeElement) { return; }

            const includeElement = treeObjectState.includeElement;
            const glyphKind = !exclusion ? 'included' : exclusion.kind;
            const isRefused = !!treeObjectState.object.hasIndistinctOccurrences;

            treeObjectState.isIncluded = !exclusion;
            treeObjectState.glyphElement.setAttribute('class', 'treeGlyph ' + glyphKind);
            treeObjectState.glyphPathElement.setAttribute('d', exclusion ? TREE_BROKEN_GLYPH_PATH : TREE_LINKED_GLYPH_PATH);
            includeElement.setAttribute('aria-pressed', exclusion ? 'false' : 'true');
            includeElement.disabled = isAutoExcluded || isRefused;

            const title = isRefused ? objectApiName + ' is written more than once in its recipe with no nickname to tell them apart, so it cannot be excluded'
                : isAutoExcluded ? 'Excluded because parent ' + exclusion.excludedParentObjectApiName + ' is excluded'
                : exclusion ? 'Excluded — click to include'
                : 'Included — click to exclude';
            includeElement.setAttribute('title', title);
            includeElement.setAttribute('aria-label', objectApiName + ': ' + title);

        });

        if (treeState.countElement) { treeState.countElement.textContent = formatTreeCount(treeState); }

        drawFieldSelection(treeState);
        drawResetSelection(treeState);

    }

    // ONE INDEX PER FIELD SELECTION THE HOST POSTED; EVERY MAP IS KEYED BY NAMES FROM DISK, SO NONE HAS A PROTOTYPE
    const fieldSelectionIndexesBySelection = new WeakMap();

    function indexFieldSelection(tree) {

        const fieldSelection = tree.fieldSelection;
        if (!fieldSelection || typeof fieldSelection !== 'object' || !Array.isArray(fieldSelection.objects)) { return Object.create(null); }
        if (fieldSelectionIndexesBySelection.has(fieldSelection)) { return fieldSelectionIndexesBySelection.get(fieldSelection); }

        const selectionsByObjectApiName = Object.create(null);

        fieldSelection.objects.forEach(function (objectFieldSelection) {
            const excludedFieldApiNames = Object.create(null);
            const lockReasonsByFieldApiName = Object.create(null);
            ( Array.isArray(objectFieldSelection.excludedFieldApiNames) ? objectFieldSelection.excludedFieldApiNames : [] )
                .forEach(function (fieldApiName) { excludedFieldApiNames[fieldApiName] = true; });
            ( Array.isArray(objectFieldSelection.lockedFields) ? objectFieldSelection.lockedFields : [] )
                .forEach(function (lockedField) { lockReasonsByFieldApiName[lockedField.fieldApiName] = String(lockedField.reason); });
            selectionsByObjectApiName[objectFieldSelection.objectApiName] = {
                excludedFieldApiNames: excludedFieldApiNames,
                lockReasonsByFieldApiName: lockReasonsByFieldApiName,
                excludedFieldCount: Object.keys(excludedFieldApiNames).length,
                isEveryFieldExcluded: objectFieldSelection.isEveryFieldExcluded === true
            };
        });

        fieldSelectionIndexesBySelection.set(fieldSelection, selectionsByObjectApiName);

        return selectionsByObjectApiName;

    }

    function findObjectFieldSelection(tree, objectApiName) {

        const selectionsByObjectApiName = indexFieldSelection(tree);

        return Object.prototype.hasOwnProperty.call(selectionsByObjectApiName, objectApiName) ? selectionsByObjectApiName[objectApiName] : null;

    }

    function hasOwnKey(record, key) {
        return !!record && Object.prototype.hasOwnProperty.call(record, key);
    }

    /*
        One field row's checkbox, dimming and note (#220), all drawn from the host's answer. The
        state is never colour alone: the box's mark, aria-checked, the title and the note all say it.
    */
    function drawFieldRowSelection(treeObjectState, fieldState) {

        if (!fieldState.rowElement) { return; }

        const tree = treeObjectState.tree;
        const objectApiName = treeObjectState.object.objectApiName;
        const fieldApiName = fieldState.field.fieldApiName;
        const objectFieldSelection = findObjectFieldSelection(tree, objectApiName);
        const isObjectExcluded = !!findObjectExclusion(tree, objectApiName);
        const lockReason = objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) ? objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] : '';
        const isExcluded = lockReason === FIELD_PARENT_EXCLUDED_REASON || ( !!objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName) );

        if (isExcluded) { fieldState.rowElement.classList.add('fieldExcluded'); } else { fieldState.rowElement.classList.remove('fieldExcluded'); }

        if (fieldState.noteElement) {
            fieldState.noteElement.textContent = lockReason;
            if (fieldState.noteElement.textContent) { fieldState.noteElement.classList.remove('hidden'); } else { fieldState.noteElement.classList.add('hidden'); }
        }

        drawFieldRowFixedValue(treeObjectState, fieldState);

        const includeElement = fieldState.includeElement;
        if (!includeElement) { return; }

        fieldState.isIncluded = !isExcluded;
        includeElement.textContent = isExcluded ? '' : '✓';
        includeElement.setAttribute('aria-checked', isExcluded ? 'false' : 'true');
        includeElement.disabled = isObjectExcluded || treeObjectState.isIteration || !!lockReason;

        const title = isObjectExcluded ? objectApiName + ' is excluded, so its fields are read-only'
            : treeObjectState.isIteration ? 'Follows ' + objectApiName + ' above'
            : lockReason ? 'Cannot be unticked: ' + lockReason
            : isExcluded ? 'Unticked — click to generate this field'
            : 'Ticked — click to leave this field out';
        includeElement.setAttribute('title', title);
        includeElement.setAttribute('aria-label', fieldApiName + ': ' + title);

    }

    // THE VALUE THE HOST SAYS THIS CARD GENERATES THE FIELD WITH (#262), OR null
    function findFixedValue(tree, objectApiName, fieldApiName) {

        const fixedValues = Array.isArray(tree.fixedValues) ? tree.fixedValues : [];
        const fixedValue = fixedValues.find(function (candidate) { return candidate.objectApiName === objectApiName && candidate.fieldApiName === fieldApiName; });

        return fixedValue ? String(fixedValue.value) : null;

    }

    // EVERY LOOKUP OF A CARD, ONCE PER CARD: A ROW ASKS ON EVERY REDRAW, AND SCANNING THE TREE PER ROW WAS O(ROWS x OBJECTS)
    const lookupFieldIndexesByTree = new WeakMap();

    function indexTreeLookupFields(tree) {

        if (lookupFieldIndexesByTree.has(tree)) { return lookupFieldIndexesByTree.get(tree); }

        const lookupFieldKeys = Object.create(null);
        tree.objects.forEach(function (treeObject) {
            treeObject.parentLookups.forEach(function (parentLookup) { lookupFieldKeys[treeObject.objectApiName + '\\n' + parentLookup.fieldApiName] = true; });
        });
        lookupFieldIndexesByTree.set(tree, lookupFieldKeys);

        return lookupFieldKeys;

    }

    /*
        Why a field's pin is disabled (#262): the host's own rule (findFixedValueLockReason), drawn
        from the model the panel already holds. The host re-derives it before it writes anything.
    */
    function findFixedValueLockReason(treeObjectState, fieldState) {

        const tree = treeObjectState.tree;
        const objectApiName = treeObjectState.object.objectApiName;
        const field = fieldState.field;
        const objectFieldSelection = findObjectFieldSelection(tree, objectApiName);

        if (findObjectExclusion(tree, objectApiName)) { return FIXED_VALUE_OBJECT_EXCLUDED_REASON; }
        if (objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, field.fieldApiName)) { return objectFieldSelection.lockReasonsByFieldApiName[field.fieldApiName]; }
        if (objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, field.fieldApiName)) { return FIXED_VALUE_UNTICKED_REASON; }
        if (field.fieldApiName === 'RecordTypeId') { return FIXED_VALUE_RECORD_TYPE_REASON; }

        const isTreeLookup = hasOwnKey(indexTreeLookupFields(tree), objectApiName + '\\n' + field.fieldApiName);
        if (isTreeLookup || FIXED_VALUE_LOOKUP_FIELD_TYPES.indexOf(field.fieldType) !== -1) { return FIXED_VALUE_LOOKUP_REASON; }
        if (field.controllingField) { return FIXED_VALUE_DEPENDENT_REASON_PREFIX + field.controllingField; }

        return '';

    }

    // A FIXED VALUE TAKES THE EXPRESSION'S PLACE ON THE ROW, WRITTEN WITH textContent, AND THE PIN SAYS SO BY SHAPE, aria-pressed AND TITLE
    function drawFieldRowFixedValue(treeObjectState, fieldState) {

        const objectApiName = treeObjectState.object.objectApiName;
        const fieldApiName = fieldState.field.fieldApiName;
        const fixedValue = findFixedValue(treeObjectState.tree, objectApiName, fieldApiName);
        const isFixed = fixedValue !== null;

        if (fieldState.fixedValueElement) {
            fieldState.fixedValueElement.textContent = isFixed ? fixedValue : '';
            if (isFixed) { fieldState.fixedValueElement.classList.remove('hidden'); } else { fieldState.fixedValueElement.classList.add('hidden'); }
        }
        if (fieldState.fixedValueBadgeElement) {
            if (isFixed) { fieldState.fixedValueBadgeElement.classList.remove('hidden'); } else { fieldState.fixedValueBadgeElement.classList.add('hidden'); }
        }
        if (fieldState.expressionElement) {
            if (isFixed) { fieldState.expressionElement.classList.add('hidden'); } else { fieldState.expressionElement.classList.remove('hidden'); }
        }

        const buttonElement = fieldState.fixedValueButtonElement;
        if (!buttonElement) { return; }

        const lockReason = treeObjectState.isIteration ? '' : findFixedValueLockReason(treeObjectState, fieldState);
        buttonElement.disabled = treeObjectState.isIteration || !!lockReason;
        buttonElement.setAttribute('aria-pressed', isFixed ? 'true' : 'false');

        const title = treeObjectState.isIteration ? 'Follows ' + objectApiName + ' above'
            : lockReason ? 'Cannot have a fixed value: ' + lockReason
            : isFixed ? 'Fixed value — click to change or clear it'
            : 'Give this field a fixed value instead of its faker expression';
        buttonElement.setAttribute('title', title);
        buttonElement.setAttribute('aria-label', fieldApiName + ': ' + title);

    }

    /*
        A field's pin (#262): a real button, keyboard operable, its glyph built node by node like the
        chain link. A click posts NAMES only -- the value is asked for in the host's own input box.
    */
    function buildFieldFixedValueElement(treeObjectState, fieldState) {

        const buttonElement = createElement('button', 'treeFieldFixedValue');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
        const object = treeObjectState.object;

        glyphElement.setAttribute('class', 'fixedValueGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', FIXED_VALUE_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        buttonElement.appendChild(glyphElement);

        buttonElement.addEventListener('click', function () {
            if (buttonElement.disabled) { return; }
            const message = {
                command: 'setFieldFixedValue',
                treeKey: treeObjectState.tree.treeKey,
                objectApiName: object.objectApiName,
                fieldApiName: fieldState.field.fieldApiName
            };
            if (object.nickname) { message.nickname = object.nickname; }
            vscodeApi.postMessage(message);
        });
        fieldState.fixedValueButtonElement = buttonElement;

        return buttonElement;

    }

    // ONE OBJECT'S All / None AND ITS WARNING, THEN EVERY ROW IT HAS BUILT
    function drawObjectFieldSelection(treeObjectState) {

        const tree = treeObjectState.tree;
        const objectApiName = treeObjectState.object.objectApiName;
        const objectFieldSelection = findObjectFieldSelection(tree, objectApiName);
        const isObjectExcluded = !!findObjectExclusion(tree, objectApiName);
        const isEveryFieldExcluded = !!objectFieldSelection && objectFieldSelection.isEveryFieldExcluded && !isObjectExcluded;

        treeObjectState.fieldWarningElement.textContent = isEveryFieldExcluded ? EVERY_FIELD_UNTICKED_WARNING : '';
        if (isEveryFieldExcluded) { treeObjectState.fieldWarningElement.classList.remove('hidden'); } else { treeObjectState.fieldWarningElement.classList.add('hidden'); }

        treeObjectState.bulkButtonElements.forEach(function (bulkButtonElement) { bulkButtonElement.disabled = isObjectExcluded; });

        if (!treeObjectState.isBodyBuilt) { return; }

        treeObjectState.fieldStates.forEach(function (fieldState) { drawFieldRowSelection(treeObjectState, fieldState); });

    }

    function drawFieldSelection(treeState) {
        treeState.objectStates.forEach(drawObjectFieldSelection);
    }

    function hasTreeSelection(tree) {
        return !!tree.objectSelection
            || ( Array.isArray(tree.objectCounts) && tree.objectCounts.length > 0 )
            || ( Array.isArray(tree.fixedValues) && tree.fixedValues.length > 0 )
            || ( !!tree.fieldSelection && Array.isArray(tree.fieldSelection.objects) && tree.fieldSelection.objects.some(function (objectFieldSelection) {
                return Array.isArray(objectFieldSelection.excludedFieldApiNames) && objectFieldSelection.excludedFieldApiNames.length > 0;
            }) );
    }

    // SHOWN ONLY WHILE THE CARD LEAVES SOMETHING OUT; THE HOST ASKS BEFORE IT CLEARS ANYTHING
    function drawResetSelection(treeState) {

        if (!treeState.resetSelectionElement) { return; }

        if (hasTreeSelection(treeState.tree)) { treeState.resetSelectionElement.classList.remove('hidden'); } else { treeState.resetSelectionElement.classList.add('hidden'); }

    }

    // ONLY FOR THE MODEL ON SCREEN: A NEWER ONE WAS BUILT FROM THE SELECTION THIS UPDATE REPORTS
    function renderObjectSelection(objectSelectionMessage) {

        if (renderedSequence === null || objectSelectionMessage.renderSequence !== renderedSequence) { return; }

        const treeState = findTreeState(objectSelectionMessage.treeKey);
        if (!treeState) { return; }

        treeState.tree.objectSelection = objectSelectionMessage.objectSelection || undefined;
        treeState.tree.fieldSelection = objectSelectionMessage.fieldSelection || undefined;
        treeState.tree.objectCounts = objectSelectionMessage.objectCounts || undefined;
        treeState.tree.fixedValues = objectSelectionMessage.fixedValues || undefined;
        drawObjectSelection(treeState);
        drawTreeInsert(treeState);

    }

    function buildTreeFieldState(field) {

        return {
            field: field,
            typeSearchText: String(field.fieldTypeWithSize || field.fieldType || '').toLowerCase(),
            isMatch: true,
            rowElement: null,
            isPicklistExpanded: false,
            includeElement: null,
            noteElement: null,
            isIncluded: true,
            fixedValueButtonElement: null,
            fixedValueBadgeElement: null,
            fixedValueElement: null,
            expressionElement: null
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

    /*
        A field's checkbox (#220): a real button with role="checkbox", keyboard operable. A click posts
        NAMES only; the host decides whether the field may be unticked and posts the card back.
    */
    function buildFieldIncludeElement(treeObjectState, fieldState) {

        const includeElement = createElement('button', 'treeFieldInclude');
        const object = treeObjectState.object;

        includeElement.setAttribute('role', 'checkbox');
        includeElement.addEventListener('click', function () {
            if (includeElement.disabled) { return; }
            const message = {
                command: 'setFieldIncluded',
                treeKey: treeObjectState.tree.treeKey,
                objectApiName: object.objectApiName,
                fieldApiName: fieldState.field.fieldApiName,
                included: !fieldState.isIncluded
            };
            if (object.nickname) { message.nickname = object.nickname; }
            vscodeApi.postMessage(message);
        });
        fieldState.includeElement = includeElement;

        return includeElement;

    }

    function buildFieldBulkElement(treeObjectState) {

        const bulkElement = createElement('div', 'treeFieldBulk');
        const object = treeObjectState.object;

        [['All', true], ['None', false]].forEach(function (bulkChoice) {
            const bulkButtonElement = createElement('button', bulkChoice[1] ? 'treeFieldAll' : 'treeFieldNone', bulkChoice[0]);
            bulkButtonElement.setAttribute('aria-label', (bulkChoice[1] ? 'Tick every field of ' : 'Untick every field of ') + object.objectApiName);
            bulkButtonElement.addEventListener('click', function () {
                if (bulkButtonElement.disabled) { return; }
                const message = { command: 'setAllFieldsIncluded', treeKey: treeObjectState.tree.treeKey, objectApiName: object.objectApiName, included: bulkChoice[1] };
                if (object.nickname) { message.nickname = object.nickname; }
                vscodeApi.postMessage(message);
            });
            bulkElement.appendChild(bulkButtonElement);
            treeObjectState.bulkButtonElements.push(bulkButtonElement);
        });

        return bulkElement;

    }

    function buildTreeFieldRow(treeObjectState, fieldState) {

        const field = fieldState.field;
        const fieldRowElement = createElement('div', 'treeField');
        const fieldHeaderElement = createElement('div', 'treeFieldHeader');

        // ONLY A FIELD WITH A LINE IN THE RECIPE: THAT LINE IS WHAT THE FILTERED COPY LEAVES OUT
        if (treeObjectState.canSelectFields && field.lineNumber) {
            fieldHeaderElement.appendChild(buildFieldIncludeElement(treeObjectState, fieldState));
            fieldHeaderElement.appendChild(buildFieldFixedValueElement(treeObjectState, fieldState));
        }

        let setPicklistExpanded = null;

        if (field.isPicklist) {

            const picklistToggleElement = buildToggleElement('picklistToggle');
            let picklistValuesElement = null;

            setPicklistExpanded = function (isExpanding) {
                if (isExpanding && !picklistValuesElement) {
                    picklistValuesElement = createElement('div', 'picklistValues');
                    fieldRowElement.appendChild(picklistValuesElement);
                    requestPicklistValues(treeObjectState.object.objectApiName, field.fieldApiName, picklistValuesElement);
                }
                if (picklistValuesElement) {
                    if (isExpanding) { picklistValuesElement.classList.remove('hidden'); } else { picklistValuesElement.classList.add('hidden'); }
                }
                fieldState.isPicklistExpanded = isExpanding;
                drawToggle(picklistToggleElement, isExpanding);
            };

            picklistToggleElement.setAttribute('aria-label', 'Show or hide the values of ' + field.fieldApiName);
            picklistToggleElement.setAttribute('aria-expanded', 'false');
            picklistToggleElement.addEventListener('click', function () {
                setPicklistExpanded(!fieldState.isPicklistExpanded);
                savePanelPlace();
            });

            fieldHeaderElement.appendChild(picklistToggleElement);

        } else {
            // A ROW WITHOUT A ▸ KEEPS ITS SLOT, SO EVERY FIELD NAME OF AN OBJECT LINES UP
            const toggleSpacerElement = createElement('span', 'picklistToggleSpacer');
            toggleSpacerElement.setAttribute('aria-hidden', 'true');
            fieldHeaderElement.appendChild(toggleSpacerElement);
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

        fieldState.fixedValueBadgeElement = createElement('span', 'fixedValueBadge hidden', FIXED_VALUE_BADGE_LABEL);
        fieldHeaderElement.appendChild(fieldState.fixedValueBadgeElement);

        fieldState.noteElement = createElement('span', 'treeFieldNote muted hidden');
        fieldHeaderElement.appendChild(fieldState.noteElement);

        if (treeObjectState.object.recipeFilePath && field.lineNumber) {
            fieldHeaderElement.appendChild(buildSourceLink('treeFieldSource', '↗ yml', treeObjectState.object.recipeFilePath, field.lineNumber));
        }

        fieldRowElement.appendChild(fieldHeaderElement);

        // THE SEARCH BOX MATCHES A FIELD BY ITS FAKER EXPRESSION, SO THE EXPRESSION IS ON SCREEN WITH THE ROW
        if (field.recipeValue) {
            fieldState.expressionElement = createElement('pre', 'expression', field.recipeValue);
            fieldRowElement.appendChild(fieldState.expressionElement);
        }

        fieldState.fixedValueElement = createElement('pre', 'fixedValue hidden');
        fieldRowElement.appendChild(fieldState.fixedValueElement);

        // A ROW BUILT FROM A RESTORED PLACE OPENS ONLY ONCE IT IS WHOLE: OPENED EARLIER, ITS VALUES WERE
        // APPENDED BEFORE ITS HEADER AND DREW ABOVE THE FIELD NAME (#277). IT STILL ASKS THE HOST AGAIN
        if (setPicklistExpanded && fieldState.isPicklistExpanded) { setPicklistExpanded(true); }

        return fieldRowElement;

    }

    /*
        A self-lookup iteration's "+" (#197): the button, and the list of friends it opens on a line
        of its own at the end of the header, so an object is still its header and its rows. Each choice posts NAMES only -- the card, the
        object, the iteration's nickname and the friend -- and the host matches the four against what
        it rendered. One click disables every "+" until the host answers, so only one friend is ever
        being added.
    */
    function appendAddFriendControls(treeKey, object, objectHeaderElement) {

        const friendObjectApiNames = object.iteration.insertableFriendObjectApiNames || [];
        if (friendObjectApiNames.length === 0) { return; }

        const addFriendElement = createElement('button', 'treeAddFriend', ADD_FRIEND_ACTION_LABEL);
        const addFriendsElement = createElement('div', 'treeAddFriends hidden');

        addFriendElement.setAttribute('title', 'Add one of the friends of ' + object.objectApiName + ' under ' + object.nickname);
        addFriendElement.setAttribute('aria-label', 'Add a friend under ' + object.nickname);
        addFriendElement.setAttribute('aria-expanded', 'false');
        addFriendElement.addEventListener('click', function () {
            const isOpening = addFriendsElement.classList.contains('hidden');
            if (isOpening) { addFriendsElement.classList.remove('hidden'); } else { addFriendsElement.classList.add('hidden'); }
            addFriendElement.setAttribute('aria-expanded', isOpening ? 'true' : 'false');
        });

        addFriendsElement.appendChild(createElement('span', 'muted', 'Add under ' + object.nickname + ':'));

        friendObjectApiNames.forEach(function (friendObjectApiName) {
            const choiceElement = createElement('button', 'treeAddFriendChoice', '+ ' + friendObjectApiName);
            choiceElement.setAttribute('aria-label', 'Add ' + friendObjectApiName + ' under ' + object.nickname);
            choiceElement.addEventListener('click', function () {
                if (isAddFriendRunning) { return; }
                setAddFriendRunning(true);
                vscodeApi.postMessage({
                    command: 'addIterationFriend',
                    treeKey: treeKey,
                    objectApiName: object.objectApiName,
                    objectNickname: object.nickname,
                    friendObjectApiName: friendObjectApiName
                });
            });
            choiceElement.disabled = isAddFriendRunning;
            addFriendButtonElements.push(choiceElement);
            addFriendsElement.appendChild(choiceElement);
        });

        addFriendButtonElements.push(addFriendElement);
        objectHeaderElement.appendChild(addFriendElement);
        objectHeaderElement.appendChild(addFriendsElement);
        // ONLY THIS ROW'S BUTTONS -- SETTING EVERY ONE DRAWN SO FAR, PER ROW, IS QUADRATIC IN THE ROWS
        addFriendElement.disabled = isAddFriendRunning;

    }

    function setAddFriendRunning(isRunning) {

        isAddFriendRunning = isRunning;
        addFriendButtonElements.forEach(function (buttonElement) { buttonElement.disabled = isRunning; });

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
            if (treeObjectState.canSelectFields && !treeObjectState.isIteration && treeObjectState.fieldStates.some(function (fieldState) { return !!fieldState.field.lineNumber; })) {
                treeObjectState.bodyElement.appendChild(buildFieldBulkElement(treeObjectState));
            }
            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.rowElement = buildTreeFieldRow(treeObjectState, fieldState);
                applyTreeFieldVisibility(fieldState);
                treeObjectState.bodyElement.appendChild(fieldState.rowElement);
            });
            treeObjectState.isBodyBuilt = true;
            drawObjectFieldSelection(treeObjectState);
        }

        if (isExpanded) { treeObjectState.bodyElement.classList.remove('hidden'); } else { treeObjectState.bodyElement.classList.add('hidden'); }

        treeObjectState.isExpanded = isExpanded;
        drawToggle(treeObjectState.toggleElement, isExpanded);

    }

    /*
        The count box right of an object's name (#255): a root's record count, or a nested faker-js
        friend's records PER parent record, as "count:" means there. It starts at the recipe's own
        count and posts only a whole number of one or more; anything else is refused on the row and
        nothing is posted. The host holds the count to the same rule again, and the recipe file is
        never written.
    */
    function buildRecordCountElement(treeObjectState) {

        const object = treeObjectState.object;
        const countElement = createElement('span', 'treeRecordCount');
        const inputElement = createElement('input', 'treeRecordCountInput');
        const labelText = object.countParentObjectApiName ? 'per ' + object.countParentObjectApiName : 'records';

        inputElement.setAttribute('type', 'text');
        inputElement.setAttribute('inputmode', 'numeric');
        inputElement.setAttribute('aria-label', object.objectApiName + ' records' + (object.countParentObjectApiName ? ' per ' + object.countParentObjectApiName + ' record' : ''));
        inputElement.addEventListener('change', function () {

            const countText = String(inputElement.value);
            const recordCount = Number(countText);

            if (!/^[1-9][0-9]*$/.test(countText) || !Number.isSafeInteger(recordCount)) {
                treeObjectState.countErrorElement.textContent = 'Enter a whole number of 1 or more.';
                treeObjectState.countErrorElement.classList.remove('hidden');
                return;
            }

            treeObjectState.countErrorElement.textContent = '';
            treeObjectState.countErrorElement.classList.add('hidden');
            if (recordCount === currentRecordCountOf(treeObjectState)) { return; }

            const countMessage = { command: 'setObjectCount', treeKey: treeObjectState.tree.treeKey, objectApiName: object.objectApiName, count: recordCount };
            if (object.nickname) { countMessage.nickname = object.nickname; }
            vscodeApi.postMessage(countMessage);

        });

        countElement.appendChild(inputElement);
        countElement.appendChild(createElement('span', 'treeRecordCountLabel muted', labelText));
        treeObjectState.countInputElement = inputElement;
        treeObjectState.countErrorElement = createElement('span', 'treeRecordCountError hidden');
        countElement.appendChild(treeObjectState.countErrorElement);
        inputElement.value = String(currentRecordCountOf(treeObjectState));

        return countElement;

    }

    // THE COUNT THE CARD GENERATES WITH: THE ONE THE READER SET, ELSE THE RECIPE'S OWN
    function currentRecordCountOf(treeObjectState) {

        const objectCounts = Array.isArray(treeObjectState.tree.objectCounts) ? treeObjectState.tree.objectCounts : [];
        const storedCount = objectCounts.find(function (objectCount) { return objectCount.objectApiName === treeObjectState.object.objectApiName; });

        return storedCount ? storedCount.count : treeObjectState.object.recordCount;

    }

    /*
        An object's header is made with its tree; its ROWS wait for the object's own first expand.
    */
    function buildTreeObjectState(treeObject, object, tree) {

        const treeKey = tree.treeKey;
        const objectElement = createElement('div', 'treeObject');
        const objectHeaderElement = createElement('div', 'treeObjectHeader');
        const toggleElement = buildToggleElement('treeObjectToggle');

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
            countElement: createElement('span', 'treeObjectCount muted'),
            lookupsElement: createElement('span', 'treeLookups muted'),
            exclusionElement: createElement('span', 'treeExclusion muted hidden'),
            fieldWarningElement: createElement('span', 'treeFieldWarning hidden'),
            includeElement: null,
            glyphElement: null,
            glyphPathElement: null,
            tree: tree,
            // A CARD WITH A FOLDER KEEPS ITS UNTICKED FIELDS (#220); AN ITERATION'S BOXES FOLLOW ITS OBJECT AND ARE DRAWN DISABLED
            canSelectFields: !!tree.folderName && !object.hasIndistinctOccurrences,
            bulkButtonElements: [],
            countInputElement: null,
            countErrorElement: null
        };

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
        toggleElement.addEventListener('click', function () {
            treeObjectState.isExpandedByReader = !treeObjectState.isExpanded;
            setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader);
            savePanelPlace();
        });

        // A CARD WITH A FOLDER KEEPS ITS EXCLUSIONS; AN ITERATION FOLLOWS ITS OBJECT AND HAS NO ICON OF ITS OWN (#219)
        // THE LINK LEADS THE ROW, AND A ROW WITHOUT ONE KEEPS ITS SLOT, SO EVERY ▸ AND NAME OF A CARD LINES UP (#257)
        if (tree.folderName && !object.iteration) {
            buildIncludeElement(treeObjectState, treeKey);
            objectHeaderElement.appendChild(treeObjectState.includeElement);
        } else {
            const spacerElement = createElement('span', 'treeObjectIncludeSpacer');
            spacerElement.setAttribute('aria-hidden', 'true');
            objectHeaderElement.appendChild(spacerElement);
        }

        objectHeaderElement.appendChild(toggleElement);

        objectHeaderElement.appendChild(buildSourceLink('treeObjectName', object.objectApiName, object.recipeFilePath, object.lineNumber));

        // A COUNT BOX ONLY WHERE THE HOST CAN STORE ONE: A CARD WITH A FOLDER, AN OBJECT TOLD APART, WITH A READABLE "count:" (#255)
        if (tree.folderName && !object.iteration && !object.hasIndistinctOccurrences && typeof object.recordCount === 'number') {
            objectHeaderElement.appendChild(buildRecordCountElement(treeObjectState));
        }

        if (formatParentLookups(treeObject)) {
            objectHeaderElement.appendChild(treeObjectState.lookupsElement);
        }

        if (object.iteration) {
            const parentName = object.iteration.parentNickname || object.iteration.parentObjectApiName;
            objectHeaderElement.appendChild(createElement('span', 'treeIteration muted', object.nickname + (parentName ? ' · nested under ' + parentName : '')));
        } else if (object.nickname) {
            objectHeaderElement.appendChild(createElement('span', 'treeIteration muted', object.nickname));
        }

        objectHeaderElement.appendChild(treeObjectState.exclusionElement);
        objectHeaderElement.appendChild(treeObjectState.fieldWarningElement);
        objectHeaderElement.appendChild(treeObjectState.countElement);

        if (object.iteration) { appendAddFriendControls(treeKey, object, objectHeaderElement); }

        objectElement.appendChild(objectHeaderElement);
        objectElement.appendChild(treeObjectState.bodyElement);

        return treeObjectState;

    }

    /*
        The tab strip and the Treecipe tab -- its header and its objects -- made on the card's first
        expand. Opening the Treecipe tab is when its org picker asks for its orgs. Previously Used
        Data Sets builds its rows on its own first open, and is drawn only for a card whose model
        carries a history.
    */
    function ensureTreeBodyBuilt(treeState) {

        if (treeState.isBodyBuilt) { return; }

        const tabsElement = createElement('div', 'treeTabs');
        const structureElement = createElement('div', 'treeStructure');

        tabsElement.setAttribute('role', 'tablist');

        structureElement.appendChild(buildTreecipeHeader(treeState));

        treeState.structureSearch = buildTabSearch(treeState, 'treecipe', 'Search objects, fields and faker expressions', applyStructureFilter);
        structureElement.appendChild(treeState.structureSearch.element);

        treeState.objectStates.forEach(function (treeObjectState) {
            structureElement.appendChild(treeObjectState.element);
        });

        if (treeState.objectStates.length === 0) {
            structureElement.appendChild(createElement('div', 'treeEmpty muted', 'This tree has no objects with a recipe.'));
        }

        treeState.tabStates = [];
        treeState.selectedTab = 'treecipe';
        addTreeTab(treeState, tabsElement, 'treecipe', 'Treecipe', structureElement);

        if (treeState.tree.history) {
            addTreeTab(treeState, tabsElement, 'datasets', 'Previously Used Data Sets', createElement('div', 'treeDatasets hidden'));
        }

        treeState.bodyElement.appendChild(tabsElement);
        treeState.tabStates.forEach(function (tabState) { treeState.bodyElement.appendChild(tabState.panelElement); });
        treeState.isBodyBuilt = true;
        applyStructureFilter(treeState);

    }

    function addTreeTab(treeState, tabsElement, tabName, tabLabel, panelElement) {

        const isSelected = tabName === treeState.selectedTab;
        const tabElement = createElement('button', isSelected ? 'treeTab selected' : 'treeTab', tabLabel);

        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', tabLabel);
        tabElement.addEventListener('click', function () { selectTreeTab(treeState, tabName); });

        treeState.tabStates.push({ tabName: tabName, tabElement: tabElement, panelElement: panelElement, isBuilt: tabName === 'treecipe' });
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
                if (tabState.tabName === 'datasets') { buildDatasetsTab(treeState, tabState.panelElement); }
            }

        });

        // AFTER THE MODEL'S "rendered" -- A CLICK CAN ONLY COME FROM A DRAWN PANEL -- AND NEVER FOR A RESTORE, WHICH IS THE PANEL'S OWN OPEN
        if (tabName === 'treecipe' && renderedSequence !== null && !isRestoringPlace && treeState.isExpanded) { requestDataOrgs(); }

        savePanelPlace();

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

    // ONE DATA SET: WHEN, WHICH VERSION, ITS RECORD COUNTS, AND OPEN / INSERT BY FOLDER NAME
    function buildDatasetRow(treeState, dataset) {

        const datasetElement = createElement('div', 'treeDataset');
        const datasetHeaderElement = createElement('div', 'treeDatasetHeader');
        const countsElement = createElement('div', 'treeDatasetCounts muted');
        const actionMessage = { datasetFolderName: dataset.datasetFolderName, treeKey: treeState.tree.treeKey, tab: 'datasets' };

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetDate', dataset.generatedAtLabel));
        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetBackend muted', dataset.fakerService));

        datasetHeaderElement.appendChild(createElement('span', dataset.runFolderName === null ? 'treeDatasetVersion unknownVersion' : 'treeDatasetVersion', versionLabelOf(treeState, dataset.runFolderName)));

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetFolder muted', dataset.datasetFolderName));
        datasetHeaderElement.appendChild(buildHistoryAction('treeDatasetOpen', 'Open', 'Reveal the folder of this data set in the Explorer',
            Object.assign({ command: 'openDataset' }, actionMessage)));
        datasetHeaderElement.appendChild(buildHistoryAction('treeDatasetInsert', 'Insert…', 'Insert this data set into an org with Insert Data Set by Directory',
            Object.assign({ command: 'insertDataset' }, actionMessage)));

        datasetElement.appendChild(datasetHeaderElement);
        datasetElement.appendChild(countsElement);

        // A LEGACY DATA SET'S COUNTS ARE READ FROM ITS COLLECTIONS API FILES, WHICH HOLD EVERY RECORD, SO ONLY WHEN THE ROW'S OWN BUTTON ASKS
        if (dataset.recordCounts) {
            countsElement.textContent = formatRecordCounts(dataset.recordCounts);
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

        treeState.datasetsSearch = buildTabSearch(treeState, 'datasets', 'Search data set folders', applyDatasetsFilter);
        panelElement.appendChild(treeState.datasetsSearch.element);

        treeState.datasetRowStates = datasets.map(function (dataset) {
            const rowElement = buildDatasetRow(treeState, dataset);
            panelElement.appendChild(rowElement);
            return { element: rowElement, searchText: dataset.datasetFolderName.toLowerCase() };
        });

        applyDatasetsFilter(treeState);

    }

    /*
        The data sets tab lists rows, not objects, so a search hides the rows it does not match --
        and says how many it left, so an empty tab never reads as a tree with no history.
    */
    function applyRowSearch(rowStates, searchQuery, search, singular, plural) {

        let matchingRowCount = 0;

        rowStates.forEach(function (rowState) {
            const isMatch = !searchQuery || rowState.searchText.indexOf(searchQuery) !== -1;
            if (isMatch) { matchingRowCount++; rowState.element.classList.remove('hidden'); } else { rowState.element.classList.add('hidden'); }
        });

        search.matchCountElement.textContent = !searchQuery
            ? pluralize(rowStates.length, singular, plural)
            : matchingRowCount > 0 ? matchingRowCount + ' of ' + pluralize(rowStates.length, singular, plural) : 'no matches';

    }

    /*
        One data set an action just wrote (#226), added to the card IN PLACE rather than by redrawing
        the panel: to the model the card draws from, so a tab built later lists it, and to its data
        sets tab when that is already built, at the top, as a reload orders it. Only this card's
        data set rows are touched; every other node on the page is the one that was there before.
    */
    function addDatasetToTree(treeState, dataset) {

        const treeHistory = treeState.tree.history;

        if (!treeHistory || treeHistory.datasets.some(function (listedDataset) { return listedDataset.datasetFolderName === dataset.datasetFolderName; })) { return; }

        treeHistory.datasets.unshift(dataset);

        const datasetsTabState = (treeState.tabStates || []).find(function (tabState) { return tabState.tabName === 'datasets'; });

        if (datasetsTabState && datasetsTabState.isBuilt) {
            if (treeState.datasetRowStates && treeState.datasetRowStates.length > 0) {
                const datasetRowElement = buildDatasetRow(treeState, dataset);
                datasetsTabState.panelElement.insertBefore(datasetRowElement, treeState.datasetRowStates[0].element);
                treeState.datasetRowStates.unshift({ element: datasetRowElement, searchText: dataset.datasetFolderName.toLowerCase() });
                applyDatasetsFilter(treeState);
            } else {
                // A TAB BUILT EMPTY HAS NO SEARCH BOX YET: BUILT AGAIN, IT GETS ONE
                datasetsTabState.panelElement.textContent = '';
                buildDatasetsTab(treeState, datasetsTabState.panelElement);
            }
        }

    }

    /*
        datasetAdded (#226): drawn only over the model it was added to, then acknowledged with its
        own updateSequence -- the host offers the new row's Open and Insert… only after that.
    */
    function renderDatasetAdded(datasetAddedMessage) {

        if (renderedSequence === null || datasetAddedMessage.renderSequence !== renderedSequence || !Array.isArray(datasetAddedMessage.treeKeys)) { return; }

        datasetAddedMessage.treeKeys.forEach(function (treeKey) {
            treeStates
                .filter(function (treeState) { return treeState.tree.treeKey === treeKey; })
                .forEach(function (treeState) { addDatasetToTree(treeState, datasetAddedMessage.dataset); });
        });

        const insertResult = datasetAddedMessage.insertResult;

        if (insertResult) {
            dataOrgInsertResultsByTreeKey[insertResult.treeKey] = insertResult;
            treeStates
                .filter(function (treeState) { return treeState.tree.treeKey === insertResult.treeKey; })
                .forEach(drawTreeInsert);
        }

        vscodeApi.postMessage({ command: 'partialRendered', renderSequence: renderedSequence, updateSequence: datasetAddedMessage.updateSequence });

    }

    function applyDatasetsFilter(treeState) {
        applyRowSearch(treeState.datasetRowStates, treeState.searchQueries.datasets, treeState.datasetsSearch, 'data set', 'data sets');
    }

    // A RELOAD THE HOST MADE AFTER A DATA SET WENT MISSING, OR A CREATE, RE-OPENS THE CARD AND TAB THE READER ACTED FROM
    function applyTreeFocus(focusTree) {

        if (!focusTree) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === focusTree.treeKey; });

        if (!treeState) { return; }

        // WHAT THE READER JUST ACTED ON IS SHOWN, EVEN WHEN IT IS NOT A FAVORITE
        if (isHiddenByFavorites(treeState)) {
            isFavoritesOnly = false;
            applyFavoritesFilter();
        }

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
        drawToggle(treeState.toggleElement, isExpanded);

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
        const toggleElement = buildToggleElement('treeToggle');

        const treeState = {
            tree: tree,
            objectStates: tree.objects
                .map(function (treeObject) { return { treeObject: treeObject, object: resolveTreeObject(treeObject, objectsByApiName) }; })
                .filter(function (resolved) { return resolved.object !== null; })
                .map(function (resolved) { return buildTreeObjectState(resolved.treeObject, resolved.object, tree); }),
            isBodyBuilt: false,
            isExpanded: false,
            isExpandedByReader: false,
            element: treeElement,
            toggleElement: toggleElement,
            bodyElement: createElement('div', 'treeBody hidden'),
            searchQueries: { treecipe: '', datasets: '' },
            // WHAT THE READER TYPED IN EACH BOX, AS TYPED -- searchQueries IS ITS TRIMMED, LOWERCASED FORM
            searchTexts: { treecipe: '', datasets: '' },
            // THE TOP OF THE TREECIPE TAB (#255), MADE WITH THE TAB
            runFakerElement: null,
            resetSelectionElement: null,
            insert: null
        };

        // AN OBJECT AND ITS FIELDS ARE COUNTED ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD DRAWS
        const objectStatesCounted = treeState.objectStates.filter(function (treeObjectState) { return !treeObjectState.isIteration; });
        const treeFieldCount = objectStatesCounted.reduce(function (fieldCount, treeObjectState) { return fieldCount + treeObjectState.fieldStates.length; }, 0);

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide ' + displayTitleOf(tree));

        /*
            The whole header row is the toggle (#209). The ▸ button carries no listener of its own:
            its click -- a mouse's, or Enter/Space while it has focus -- bubbles here like a click
            anywhere else on the row, so the card cannot be toggled twice by one click.
        */
        treeHeaderElement.addEventListener('click', function () {
            treeState.isExpandedByReader = !treeState.isExpanded;
            setTreeExpanded(treeState, treeState.isExpandedByReader);
            // OPENING A CARD ON ITS TREECIPE TAB IS OPENING THAT TAB, WHICH LISTS THE ORGS ITS PICKER OFFERS
            if (treeState.isExpanded && treeState.selectedTab === 'treecipe') { requestDataOrgs(); }
            savePanelPlace();
        });

        treeHeaderElement.appendChild(toggleElement);
        treeState.titleElement = createElement('span', 'treeTitle', displayTitleOf(tree));
        treeHeaderElement.appendChild(treeState.titleElement);

        if (tree.folderName) {
            treeHeaderElement.appendChild(createElement('span', 'treeFolder muted', tree.folderName));
        }

        treeState.countedObjectCount = objectStatesCounted.length;
        treeState.countedFieldCount = treeFieldCount;
        treeState.countElement = createElement('span', 'treeCount muted');
        treeHeaderElement.appendChild(treeState.countElement);
        drawObjectSelection(treeState);

        /*
            The actions sit at the END of the row and never toggle it. The click is stopped on the
            GROUP rather than on each button, because a browser may hand a click on a DISABLED
            button -- every Run Faker while one runs -- to its ancestors without running the
            button's own listener.
        */
        const actionsElement = createElement('span', 'treeHeaderActions');
        actionsElement.addEventListener('click', function (event) { event.stopPropagation(); });

        // ONLY A CARD WITH A FOLDER: THE NAME AND THE FAVORITE ARE KEPT BY FOLDER, AND THE UNGROUPED CARD HAS NONE
        if (tree.folderName) {

            treeState.favoriteElement = createElement('button', 'treeFavorite');
            treeState.favoriteElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'toggleFavoriteTree', treeKey: tree.treeKey });
            });
            actionsElement.appendChild(treeState.favoriteElement);

            treeState.renameElement = createElement('button', 'treeRename', RENAME_TREE_ACTION_LABEL);
            treeState.renameElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'renameTree', treeKey: tree.treeKey });
            });
            actionsElement.appendChild(treeState.renameElement);

            drawTreeName(treeState);

        }

        treeHeaderElement.appendChild(actionsElement);

        treeElement.appendChild(treeHeaderElement);
        treeElement.appendChild(treeState.bodyElement);
        treesViewElement.appendChild(treeElement);

        treeStates.push(treeState);

    }

    // THE HEADER'S NAME AND STAR, DRAWN AT FIRST AND AGAIN WHEN THE HOST SAYS EITHER CHANGED
    function drawTreeName(treeState) {

        const tree = treeState.tree;
        const displayTitle = displayTitleOf(tree);

        treeState.titleElement.textContent = displayTitle;
        treeState.toggleElement.setAttribute('aria-label', 'Show or hide ' + displayTitle);

        if (treeState.favoriteElement) {
            treeState.favoriteElement.textContent = tree.isFavorite ? FAVORITE_TREE_LABEL : NOT_FAVORITE_TREE_LABEL;
            treeState.favoriteElement.setAttribute('aria-pressed', tree.isFavorite ? 'true' : 'false');
            treeState.favoriteElement.setAttribute('aria-label', (tree.isFavorite ? 'Remove ' + displayTitle + ' from favorites' : 'Mark ' + displayTitle + ' as a favorite'));
            treeState.favoriteElement.setAttribute('title', tree.isFavorite ? 'Remove from favorites' : 'Mark as a favorite');
        }

        if (treeState.renameElement) {
            treeState.renameElement.setAttribute('aria-label', 'Rename ' + displayTitle);
            treeState.renameElement.setAttribute('title', 'Rename this tree');
        }

        if (treeState.runFakerElement) {
            treeState.runFakerElement.setAttribute('aria-label', 'Run Faker on ' + displayTitle + ' (' + tree.runFakerRecipeFileName + ')');
        }

    }

    // ONLY FOR THE MODEL ON SCREEN: A NEWER ONE WAS BUILT FROM THE PREFERENCES THIS UPDATE REPORTS
    function renderTreePreferences(treePreferencesMessage) {

        if (renderedSequence === null || treePreferencesMessage.renderSequence !== renderedSequence || !Array.isArray(treePreferencesMessage.trees)) { return; }

        treePreferencesMessage.trees.forEach(function (treePreference) {

            const treeState = findTreeState(treePreference.treeKey);
            if (!treeState) { return; }

            treeState.tree.customName = typeof treePreference.customName === 'string' ? treePreference.customName : undefined;
            treeState.tree.isFavorite = treePreference.isFavorite === true;
            drawTreeName(treeState);

        });

        applyFavoritesFilter();

    }

    /*
        The top of a card's Treecipe tab (#255): the panel-wide org picker, then ▶ Run Faker, Reset
        selection, then "Generate fake data and insert into <org>". Each posts
        the tree's KEY alone; which org, which recipe file, which counts and which objects are the
        host's.
    */
    function buildTreecipeHeader(treeState) {

        const tree = treeState.tree;
        const headerElement = createElement('div', 'treecipeHeader');
        const actionsElement = createElement('div', 'treecipeActions');

        if (tree.runFakerRecipeFileName) {
            headerElement.appendChild(buildDataOrgView().element);
        }

        if (tree.runFakerRecipeFileName) {
            treeState.runFakerElement = buildRunFakerElement(tree);
            actionsElement.appendChild(treeState.runFakerElement);
        }

        if (tree.folderName) {
            treeState.resetSelectionElement = createElement('button', 'treeResetSelection hidden', RESET_SELECTION_LABEL);
            treeState.resetSelectionElement.setAttribute('title', 'Include every object, tick every field and set every count back to the recipe\\'s own');
            treeState.resetSelectionElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'resetTreeSelection', treeKey: tree.treeKey });
            });
            actionsElement.appendChild(treeState.resetSelectionElement);
            drawResetSelection(treeState);
        }

        headerElement.appendChild(actionsElement);

        if (tree.runFakerRecipeFileName) {
            headerElement.appendChild(buildTreeInsertElement(treeState));
        }

        if (tree.folderName && tree.objects.length > 0) {
            headerElement.appendChild(buildTreeDeployElement(treeState));
        }

        drawTreeName(treeState);

        return headerElement;

    }

    function buildTreeInsertElement(treeState) {

        const controlsElement = createElement('div', 'treeInsertControls');
        const insert = {
            buttonElement: createElement('button', 'treeInsert', INSERT_ACTION_LABEL),
            reasonElement: createElement('span', 'treeInsertReason muted'),
            resultElement: createElement('span', 'treeInsertResult'),
            errorsElement: createElement('button', 'treeInsertErrors hidden', 'View errors')
        };

        insert.buttonElement.setAttribute('title', 'Generate this tree with its selection and counts, as ▶ Run Faker does, then insert it into the chosen org, parents first');
        insert.buttonElement.addEventListener('click', function () {
            if (insertRunningTreeKey !== null || isMetadataDeployRunning || dataOrgSelectedIndex === null || renderedSequence === null) { return; }
            setInsertRunning(treeState.tree.treeKey);
            vscodeApi.postMessage({ command: 'insertTree', treeKey: treeState.tree.treeKey });
        });

        insert.errorsElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'viewInsertErrors', treeKey: treeState.tree.treeKey });
        });

        controlsElement.appendChild(insert.buttonElement);
        controlsElement.appendChild(insert.reasonElement);
        controlsElement.appendChild(insert.resultElement);
        controlsElement.appendChild(insert.errorsElement);

        treeState.insert = insert;
        drawTreeInsert(treeState);

        return controlsElement;

    }

    /*
        "Deploy this metadata…" (#273), on every card with a folder whatever the org answered. Posts
        the tree's KEY, and the index of the org the Treecipe tab has selected when it has one; with
        none the host asks for an org itself. What is deployed is the host's. Every deploy and insert
        is disabled on the click, and only the host's metadataDeployState gives them back.
    */
    function buildTreeDeployElement(treeState) {

        const controlsElement = createElement('div', 'treeDeployControls');
        const deploy = {
            buttonElement: createElement('button', 'treeDeploy', METADATA_DEPLOY_ACTION_LABEL),
            statusElement: createElement('div', 'metadataDeployStatus muted hidden'),
            statusTextElement: createElement('span', 'metadataDeployStatusText'),
            viewOutputElement: createElement('button', 'metadataDeployViewOutput hidden', 'View output')
        };

        deploy.buttonElement.setAttribute('title', 'Deploy this tree\\'s custom objects, each with everything in its source folder, and the custom fields of its standard objects from the source in this workspace, to the org selected above or a sandbox you choose, after a confirmation that lists the files');
        deploy.buttonElement.addEventListener('click', function () {
            if (isMetadataDeployRunning || insertRunningTreeKey !== null || isScratchOrgRunning || renderedSequence === null) { return; }
            isMetadataDeployRunning = true;
            drawTreeInserts();
            drawDataOrgViews();
            const deployMessage = { command: 'deployTreeMetadata', treeKey: treeState.tree.treeKey };
            if (dataOrgSelectedIndex !== null) { deployMessage.orgIndex = dataOrgSelectedIndex; }
            vscodeApi.postMessage(deployMessage);
        });

        deploy.viewOutputElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'viewMetadataDeployOutput' });
        });

        controlsElement.appendChild(deploy.buttonElement);
        deploy.statusElement.appendChild(deploy.statusTextElement);
        deploy.statusElement.appendChild(deploy.viewOutputElement);
        controlsElement.appendChild(deploy.statusElement);

        treeState.deploy = deploy;
        drawTreeDeploy(treeState);

        return controlsElement;

    }

    function drawTreeDeploy(treeState) {

        const deploy = treeState.deploy;
        if (!deploy) { return; }

        deploy.buttonElement.disabled = isMetadataDeployRunning || insertRunningTreeKey !== null || isScratchOrgRunning;

        const deployStatusText = metadataDeployState && metadataDeployState.treeKey === treeState.tree.treeKey ? metadataDeployState.statusText : '';
        deploy.statusTextElement.textContent = deployStatusText;
        setShown(deploy.statusElement, !!deployStatusText);
        if (deployStatusText && metadataDeployState.isFailure) { deploy.statusElement.classList.add('failed'); } else { deploy.statusElement.classList.remove('failed'); }
        setShown(deploy.viewOutputElement, !!deployStatusText && !metadataDeployState.isRunning && !!metadataDeployState.hasOutput);

    }

    /*
        Posts the tree's KEY; the host looks its recipe file up. Every Run Faker button is disabled
        on the click, before the host answers, so a second click cannot start a second run -- the
        host's runFakerState is what enables them again.
    */
    function buildRunFakerElement(tree) {

        const runFakerElement = createElement('button', 'treeRunFaker', RUN_FAKER_ACTION_LABEL);

        runFakerElement.setAttribute('title', 'Run Faker by Recipe on ' + tree.runFakerRecipeFileName);
        runFakerElement.setAttribute('aria-label', 'Run Faker on ' + displayTitleOf(tree) + ' (' + tree.runFakerRecipeFileName + ')');
        runFakerElement.addEventListener('click', function () {
            if (runFakerRunningTreeKey !== null || insertRunningTreeKey !== null) { return; }
            setRunFakerRunning(tree.treeKey);
            vscodeApi.postMessage({ command: 'runFaker', treeKey: tree.treeKey });
        });

        applyRunFakerStateTo(tree, runFakerElement);

        return runFakerElement;

    }

    function applyRunFakerStateTo(tree, runFakerElement) {

        runFakerElement.disabled = runFakerRunningTreeKey !== null || insertRunningTreeKey !== null;
        runFakerElement.textContent = runFakerRunningTreeKey === tree.treeKey ? RUN_FAKER_RUNNING_LABEL : RUN_FAKER_ACTION_LABEL;

    }

    function setRunFakerRunning(runningTreeKey) {

        runFakerRunningTreeKey = runningTreeKey;

        treeStates.forEach(function (treeState) {
            if (treeState.runFakerElement) { applyRunFakerStateTo(treeState.tree, treeState.runFakerElement); }
        });
        drawTreeInserts();

    }

    function renderTrees(recipe) {

        // KEYED BY NAMES FROM THE WRAPPER ON DISK -- "__proto__" MUST BE A KEY, NOT A NEW PROTOTYPE
        const objectsByApiName = Object.create(null);
        recipe.objects.forEach(function (object) { objectsByApiName[object.objectApiName] = object; });

        const trees = recipe.trees || [];

        if (trees.length === 0) {
            treesViewElement.appendChild(createElement('div', 'emptyState', 'This run has no relationship trees to show. Run "Generate Treecipe" again to draw its objects in relationship trees.'));
            return;
        }

        trees.forEach(function (tree) { renderTree(tree, objectsByApiName); });

        noFavoritesElement = createElement('div', 'emptyState hidden', NO_FAVORITES_MESSAGE);
        treesViewElement.appendChild(noFavoritesElement);
        applyFavoritesFilter();

    }

    /*
        What a search may open, under the RECIPE_COCKPIT_AUTO_EXPAND_* limits. Each search box
        spends its own budget, so a keystroke's cost is bounded by what it expands rather than by
        what it matches. A row with no match is closed.
    */
    function expandMatchesWithinBudget(rowStates, matchCountOf, rowCountOf, setExpanded) {

        let expandedObjectCount = 0;
        let expandedRowCount = 0;
        let isBudgetSpent = false;

        rowStates.forEach(function (rowState) {

            if (matchCountOf(rowState) === 0 || isBudgetSpent) {
                setExpanded(rowState, false);
                return;
            }

            const rowCount = rowCountOf(rowState);
            const fitsRowBudget = expandedObjectCount === 0 || expandedRowCount + rowCount <= AUTO_EXPAND_ROW_BUDGET;

            if (expandedObjectCount >= AUTO_EXPAND_OBJECT_LIMIT || !fitsRowBudget) {
                isBudgetSpent = true;
                setExpanded(rowState, false);
                return;
            }

            expandedObjectCount++;
            expandedRowCount += rowCount;
            setExpanded(rowState, true);

        });

    }

    /*
        The Structure tab's search, over its own card only. It narrows rows and never hides an
        OBJECT: one with no match stays on screen, collapsed and labelled, because hiding it would
        make a search look like a truncation -- the reader could not tell "not in the recipe" from
        "filtered away". A cleared search gives back what the reader had opened.
    */
    function applyStructureFilter(treeState) {

        if (!treeState.structureSearch) { return; }

        const searchQuery = treeState.searchQueries.treecipe;
        let totalFieldCount = 0;
        let matchingFieldCount = 0;

        treeState.objectStates.forEach(function (treeObjectState) {

            const isObjectNameMatch = !searchQuery || treeObjectState.objectSearchText.indexOf(searchQuery) !== -1;
            let objectMatchingFieldCount = 0;

            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.isMatch = isObjectNameMatch || isFieldTextMatch(fieldState, searchQuery);
                if (fieldState.isMatch) { objectMatchingFieldCount++; }
                applyTreeFieldVisibility(fieldState);
            });

            const objectFieldCount = treeObjectState.fieldStates.length;
            treeObjectState.matchingFieldCount = objectMatchingFieldCount;
            totalFieldCount += objectFieldCount;
            matchingFieldCount += objectMatchingFieldCount;

            if (isObjectNameMatch) {
                treeObjectState.countElement.textContent = pluralize(objectFieldCount, 'field', 'fields');
            } else if (objectMatchingFieldCount > 0) {
                treeObjectState.countElement.textContent = objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields');
            } else {
                treeObjectState.countElement.textContent = 'no matching fields';
            }

        });

        treeState.structureSearch.matchCountElement.textContent = !searchQuery
            ? pluralize(totalFieldCount, 'field', 'fields')
            : matchingFieldCount > 0 ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') : 'no matches';

        if (!searchQuery) {
            treeState.objectStates.forEach(function (treeObjectState) { setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader); });
            return;
        }

        expandMatchesWithinBudget(treeState.objectStates,
            function (treeObjectState) { return treeObjectState.matchingFieldCount; },
            function (treeObjectState) { return treeObjectState.fieldStates.length; },
            setTreeObjectExpanded);

    }

    function buildTreeObjectKey(treeKey, objectApiName) {
        return treeKey + '\\n' + objectApiName;
    }

    /*
        The objects a tree's insert sends: once each, not excluded -- the host checks the same list
        before it inserts anything.
    */
    function listTreeInsertObjectApiNames(treeState) {

        const exclusionsByObjectApiName = indexObjectExclusions(treeState.tree);

        return treeState.objectStates
            .filter(function (treeObjectState) { return !treeObjectState.isIteration && !hasOwnKey(exclusionsByObjectApiName, treeObjectState.object.objectApiName); })
            .map(function (treeObjectState) { return treeObjectState.object.objectApiName; });

    }

    /*
        Why a tree's insert is not offered, or '' when it is (#255). The host decides each object's
        readiness and says why not; the button only draws that answer, and the host checks every
        one of them again on the click.
    */
    function findTreeInsertReason(treeState) {

        if (dataOrgRequestSequence === null || dataOrgSelectedIndex === null) { return 'Choose an org above to insert into.'; }
        if (dataOrgSelectionFailureMessage) { return dataOrgSelectionFailureMessage; }

        const insertObjectApiNames = listTreeInsertObjectApiNames(treeState);
        if (insertObjectApiNames.length === 0) { return 'Every object of this tree is excluded.'; }

        for (let objectIndex = 0; objectIndex < insertObjectApiNames.length; objectIndex++) {
            const objectApiName = insertObjectApiNames[objectIndex];
            const treeObjectKey = buildTreeObjectKey(treeState.tree.treeKey, objectApiName);
            const readiness = hasOwnKey(dataOrgReadinessByTreeObjectKey, treeObjectKey) ? dataOrgReadinessByTreeObjectKey[treeObjectKey]
                : hasOwnKey(dataOrgReadinessByObject, objectApiName) ? dataOrgReadinessByObject[objectApiName]
                : null;
            if (!readiness) { return 'checking whether this tree can be inserted…'; }
            if (readiness.disabledReason) { return readiness.disabledReason; }
        }

        return '';

    }

    function drawTreeInsert(treeState) {

        const insert = treeState.insert;
        if (!insert) { return; }

        const disabledReason = findTreeInsertReason(treeState);
        const orgLabel = dataOrgLabels && dataOrgSelectedIndex !== null && dataOrgLabels[dataOrgSelectedIndex] ? dataOrgLabels[dataOrgSelectedIndex] : '';

        insert.buttonElement.disabled = insertRunningTreeKey !== null || isScratchOrgRunning || isMetadataDeployRunning || runFakerRunningTreeKey !== null || !!disabledReason;

        insert.buttonElement.textContent = insertRunningTreeKey === treeState.tree.treeKey ? INSERT_RUNNING_LABEL
            : INSERT_ACTION_LABEL + (orgLabel ? ' into ' + orgLabel : '');
        insert.reasonElement.textContent = disabledReason;

        const insertResult = hasOwnKey(dataOrgInsertResultsByTreeKey, treeState.tree.treeKey) ? dataOrgInsertResultsByTreeKey[treeState.tree.treeKey] : null;

        insert.resultElement.className = 'treeInsertResult';
        insert.errorsElement.classList.add('hidden');

        if (!insertResult) {
            insert.resultElement.textContent = '';
            return;
        }

        if (insertResult.outcome === 'cancelled') {
            insert.resultElement.textContent = 'Last insert cancelled and rolled back';
        } else if (insertResult.outcome === 'stopped') {
            insert.resultElement.textContent = insertResult.isRolledBack
                ? 'Last insert stopped and rolled back · ' + insertResult.failedCount + ' failed'
                : 'Last insert stopped · ' + insertResult.savedCount + ' inserted and kept · ' + insertResult.failedCount + ' failed';
            insert.resultElement.classList.add('partial');
        } else if (insertResult.failedCount === 0) {
            insert.resultElement.textContent = '✓ ' + insertResult.savedCount + ' inserted';
            insert.resultElement.classList.add('succeeded');
        } else {
            insert.resultElement.textContent = insertResult.savedCount + ' inserted · ' + insertResult.failedCount + ' failed';
            insert.resultElement.classList.add('partial');
        }

        if (insertResult.failedCount > 0 || insertResult.outcome === 'stopped') { insert.errorsElement.classList.remove('hidden'); }

    }

    function drawTreeInserts() {
        treeStates.forEach(drawTreeInsert);
        treeStates.forEach(drawTreeDeploy);
    }

    // EVERY TREE'S INSERT IS DISABLED ON THE CLICK, BEFORE THE HOST ANSWERS; ITS insertState ENABLES THEM AGAIN
    function setInsertRunning(runningTreeKey) {

        insertRunningTreeKey = runningTreeKey;
        drawTreeInserts();
        drawDataOrgViews();

    }

    function renderMetadataDeployState(hostMessage) {

        metadataDeployState = hostMessage;
        isMetadataDeployRunning = !!hostMessage.isRunning;

        drawDataOrgViews();
        drawTreeInserts();

    }

    function renderScratchOrgState(hostMessage) {

        const wasRunning = isScratchOrgRunning;

        scratchOrgState = hostMessage;
        isScratchOrgRunning = !!hostMessage.isRunning;

        // THE RUN ENDED: WHAT IT HELD DISABLED COMES BACK, ⟳ INCLUDED -- ITS LISTING HAS ALREADY ANSWERED
        if (wasRunning && !isScratchOrgRunning) { isDataOrgRefreshDisabled = false; }

        drawDataOrgViews();
        drawTreeInserts();

    }

    function renderDataOrgReadiness(dataOrgReadiness) {

        if (renderedSequence === null || dataOrgReadiness.renderSequence !== renderedSequence || dataOrgReadiness.requestSequence !== dataOrgRequestSequence) { return; }

        dataOrgReadiness.objects.forEach(function (readiness) { dataOrgReadinessByObject[readiness.objectApiName] = readiness; });
        (dataOrgReadiness.createTargets || []).forEach(function (readiness) { dataOrgReadinessByTreeObjectKey[buildTreeObjectKey(readiness.treeKey, readiness.objectApiName)] = readiness; });
        (dataOrgReadiness.insertResults || []).forEach(function (insertResult) { dataOrgInsertResultsByTreeKey[insertResult.treeKey] = insertResult; });

        // THE CHECK IS OVER; A FAILURE THE SELECTION REPORTED STAYS ON SCREEN
        if (!isDataOrgStatusFailure) { setDataOrgStatus('', false); }

        drawTreeInserts();

    }

    function setDataOrgStatus(statusText, isFailure) {

        dataOrgStatusText = statusText;
        isDataOrgStatusFailure = !!isFailure;
        drawDataOrgViews();

    }

    // THE FIRST USE OF THE PICKER, OR THE FIRST OPEN OF ANY CARD'S TREECIPE TAB -- NEVER THE PANEL'S OWN OPEN
    function requestDataOrgs() {

        // A SCRATCH ORG RUN ENDS BY LISTING THE ORGS ITSELF
        if (renderedSequence === null || dataOrgRequestedSequence === renderedSequence || isScratchOrgRunning) { return; }

        // SAVED ONLY WHEN IT CHANGES: A NEW MODEL OF A PICKER ALREADY IN USE ASKS BEFORE ITS PLACE IS RESTORED, AND A SAVE THEN WOULD KEEP A HALF-RESTORED PLACE
        if (!isDataOrgPickerInUse) {
            isDataOrgPickerInUse = true;
            savePanelPlace();
        }
        dataOrgRequestedSequence = renderedSequence;
        isDataOrgLoadShown = false;
        isDataOrgSelectShown = false;
        setDataOrgStatus(DATA_ORG_CONNECTION_CHECK_TEXT, false);
        vscodeApi.postMessage({ command: 'loadDataOrgs' });

    }

    function renderDataOrgList(dataOrgList) {

        if (renderedSequence === null || dataOrgList.renderSequence !== renderedSequence) { return; }

        isDataOrgLoadShown = false;
        clearDataOrgSelection();
        // ⟳ IS HOW A READER WHO JUST RE-AUTHORIZED AN ORG SEES IT LISTED, SO IT STAYS EVEN WITH NOTHING LISTED
        isDataOrgRefreshShown = true;
        isDataOrgRefreshDisabled = false;

        // PRODUCTION AND ORGS THE CLI DOES NOT REPORT CONNECTED ARE NEVER LISTED, AND THE READER IS TOLD WHY ONE THEY AUTHORIZED IS MISSING
        dataOrgHiddenNoteText = [dataOrgList.forgottenOrgNotice || '', dataOrgList.hiddenOrgNote || ''].filter(Boolean).join(' ');
        dataOrgLabels = Array.isArray(dataOrgList.orgLabels) ? dataOrgList.orgLabels.slice() : [];

        if (dataOrgLabels.length === 0) {
            isDataOrgSelectShown = false;
            setDataOrgStatus(dataOrgList.noOrgsMessage, true);
            return;
        }

        dataOrgSelectedIndex = dataOrgList.selectedOrgIndex === null ? null : dataOrgList.selectedOrgIndex;
        isDataOrgSelectShown = true;
        setDataOrgStatus(dataOrgList.selectedOrgIndex === null ? 'Choose an org to insert into.' : '', false);
        drawTreeInserts();

    }

    // NO ORG IS SELECTED WHILE THE ORGS ARE BEING LISTED AGAIN, SO NOTHING FROM THE LAST ONE STAYS ON SCREEN
    function clearDataOrgSelection() {

        /*
            With no selection, the insert is disabled: a re-listing that forgot the org posts no
            selection after it. The sequence it cleared is kept, so an answer still on its way for
            that selection is not drawn back in.
        */
        if (dataOrgRequestSequence !== null) {
            dataOrgClearedRequestSequence = Math.max(dataOrgClearedRequestSequence === null ? 0 : dataOrgClearedRequestSequence, dataOrgRequestSequence);
        }
        dataOrgRequestSequence = null;
        dataOrgSelectedIndex = null;
        dataOrgSelectionFailureMessage = '';
        dataOrgReadinessByObject = Object.create(null);
        dataOrgReadinessByTreeObjectKey = Object.create(null);
        dataOrgInsertResultsByTreeKey = Object.create(null);
        dataOrgTypeLabel = null;
        drawDataOrgViews();
        drawTreeInserts();

    }

    // THE DROPDOWN IS TAKEN AWAY UNTIL THE CLI ANSWERS, SO NOTHING CAN BE SELECTED FROM A LIST BEING REPLACED
    function showDataOrgConnectionCheck() {

        isDataOrgSelectShown = false;
        dataOrgHiddenNoteText = '';
        // ONE CHECK AT A TIME: ⟳ COMES BACK WITH THE LIST IT ASKED FOR
        isDataOrgRefreshDisabled = true;
        clearDataOrgSelection();
        setDataOrgStatus(DATA_ORG_CONNECTION_CHECK_TEXT, false);

    }

    function renderDataOrgSelection(dataOrgSelection) {

        if (renderedSequence === null || dataOrgSelection.renderSequence !== renderedSequence) { return; }
        if (dataOrgRequestSequence !== null && dataOrgSelection.requestSequence < dataOrgRequestSequence) { return; }
        if (dataOrgClearedRequestSequence !== null && dataOrgSelection.requestSequence <= dataOrgClearedRequestSequence) { return; }

        // A NEW SELECTION, OR A REFRESH OF THIS ONE, STARTS FROM NO READINESS
        if (dataOrgSelection.requestSequence !== dataOrgRequestSequence) {
            dataOrgRequestSequence = dataOrgSelection.requestSequence;
            dataOrgReadinessByObject = Object.create(null);
            dataOrgReadinessByTreeObjectKey = Object.create(null);
            dataOrgInsertResultsByTreeKey = Object.create(null);
            dataOrgSelectionFailureMessage = '';
            setDataOrgStatus('Checking ' + dataOrgSelection.orgLabel + '…', false);
        }

        // A FAILED CONNECTION, OR AN ORG THAT IS NOT A SANDBOX, IS THE WHOLE ANSWER ABOUT THIS SELECTION
        if (dataOrgSelection.failureMessage) {
            dataOrgSelectionFailureMessage = dataOrgSelection.failureMessage;
            setDataOrgStatus(dataOrgSelection.failureMessage, true);
        }

        dataOrgSelectedIndex = dataOrgSelection.orgIndex;
        dataOrgTypeLabel = dataOrgSelection.orgTypeLabel || 'checking…';
        isDataOrgRefreshShown = true;

        drawDataOrgViews();
        drawTreeInserts();

    }

    /*
        The toolbar is the FIRST thing drawn, and what sits between it and the cards is only what
        the cards cannot say themselves: notices about entries that could not be read. Each card
        carries its own searches (#217), so there is no find box above them.
    */
    /*
        The reader's place (#222), kept with vscodeApi.setState so it outlives the document VS Code
        throws away when the tab is hidden. It holds NAMES only -- tree keys, object api names and
        nicknames, field api names, run folder names, tab names -- each tab's search as the panel
        holds it, whether the toolbar's org picker was in use, and a scroll offset: nothing the host
        keeps to itself, no path, no picklist value, no org label or username.
    */
    function readSavedPanelPlace() {

        // A PLACE THAT CANNOT BE READ IS NO PLACE: THE PANEL DRAWS ITS DEFAULT RATHER THAN NOTHING
        try {

            const savedState = upgradePlace(typeof vscodeApi.getState === 'function' ? vscodeApi.getState() : null);

            if (!isReadablePlace(savedState)) {
                return null;
            }

            return savedState;

        } catch (getStateError) {
            return null;
        }

    }

    function buildObjectPlaceKey(treeObjectState) {
        return treeObjectState.object.objectApiName + '\\n' + (treeObjectState.object.nickname || '');
    }

    function buildFieldPlaceKey(treeObjectState, fieldState) {
        return buildObjectPlaceKey(treeObjectState) + '\\n' + fieldState.field.fieldApiName;
    }

    function buildTreePlace(treeState) {

        const expandedObjectKeys = [];
        const openPicklistKeys = [];
        const searchQueries = {};
        let hasSearch = false;

        treeState.objectStates.forEach(function (treeObjectState) {
            if (treeObjectState.isExpandedByReader) { expandedObjectKeys.push(buildObjectPlaceKey(treeObjectState)); }
            // ONLY A BUILT ROW CAN HAVE BEEN OPENED, SO AN OBJECT NOBODY EXPANDED COSTS NOTHING HERE
            if (!treeObjectState.isBodyBuilt) { return; }
            treeObjectState.fieldStates.forEach(function (fieldState) {
                if (fieldState.isPicklistExpanded) { openPicklistKeys.push(buildFieldPlaceKey(treeObjectState, fieldState)); }
            });
        });

        PANEL_PLACE_TABS.forEach(function (tabName) {
            searchQueries[tabName] = treeState.searchTexts[tabName] || '';
            if (treeState.searchQueries[tabName]) { hasSearch = true; }
        });

        const selectedTab = treeState.selectedTab || 'treecipe';

        if (!treeState.isExpandedByReader && selectedTab === 'treecipe' && !hasSearch
                && expandedObjectKeys.length === 0 && openPicklistKeys.length === 0) {
            return null;
        }

        return {
            treeKey: treeState.tree.treeKey,
            isExpanded: !!treeState.isExpandedByReader,
            selectedTab: selectedTab,
            searchQueries: searchQueries,
            expandedObjectKeys: expandedObjectKeys,
            openPicklistKeys: openPicklistKeys
        };

    }

    function savePanelPlace() {

        // NOTHING IS SAVED UNTIL THE SAVED PLACE IS SPENT, NOR FOR A PANEL WITH NO MODEL DRAWN
        if (!isPlaceRestoreSettled || isRestoringPlace || renderedSequence === null || typeof vscodeApi.setState !== 'function') { return; }

        let panelPlace = null;

        try {
            panelPlace = buildPanelPlace();
            vscodeApi.setState(panelPlace);
        } catch (setStateError) {
            // A PLACE THAT COULD NOT BE KEPT COSTS THE READER A RE-OPEN, NEVER THE PANEL
        }

        // THE HOST KEEPS IT IN workspaceState TOO, SO IT OUTLIVES A CLOSE OR A WINDOW RELOAD (#230); IT THROTTLES THE WRITES
        if (panelPlace) { vscodeApi.postMessage({ command: 'savePlace', place: panelPlace }); }

    }

    function buildPanelPlace() {

        return {
            version: PANEL_PLACE_VERSION,
            runFolderName: renderedRunFolderName,
            isOrgPickerInUse: isDataOrgPickerInUse,
            isFavoritesOnly: isFavoritesOnly,
            scrollY: typeof window.scrollY === 'number' ? window.scrollY : 0,
            trees: treeStates.map(buildTreePlace).filter(Boolean)
        };

    }

    /*
        A reload in the same document (#225) -- Run Faker, Create, Add friend -- redraws every card
        from scratch. When it is the run already on screen, the place on screen is taken BEFORE the
        redraw drops it and restored like a saved one; a run switch, or a reload that landed on
        another run, starts fresh. A model that failed to draw left nothing to take.
    */
    function takeSameRunPlace(recipe) {

        if (!isPlaceRestoreSettled || renderedSequence === null || !recipe || recipe.objects.length === 0
                || renderedRunFolderName !== recipe.selectedRunFolderName) {
            return null;
        }

        // A PLACE THAT CANNOT BE TAKEN COSTS THE READER THEIR PLACE, NEVER THE DRAW
        try {
            return buildPanelPlace();
        } catch (placeError) {
            return null;
        }

    }

    /*
        A place saved before #255 names the Structure and Data-by-Org tabs: it is read as the tabs
        they became rather than dropped. A place of EITHER version can name a tab the card no longer
        has (REMOVED_TREE_TABS: Previous Versions #265, Compare #266): it opens on Treecipe, and that
        tab's search, status filter and opened rows are dropped, never moved onto another tab's.
    */
    function upgradePlace(candidatePlace) {

        if (!candidatePlace || typeof candidatePlace !== 'object'
                || (candidatePlace.version !== PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB && candidatePlace.version !== PANEL_PLACE_VERSION)) { return candidatePlace; }

        const isOlderPlace = candidatePlace.version === PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB;
        const renameTab = function (tabName) { return isOlderPlace && Object.prototype.hasOwnProperty.call(TREE_TAB_RENAMES, tabName) ? TREE_TAB_RENAMES[tabName] : tabName; };
        const isRemovedTab = function (tabName) { return REMOVED_TREE_TABS.indexOf(tabName) !== -1; };

        return Object.assign({}, candidatePlace, {
            version: PANEL_PLACE_VERSION,
            trees: (Array.isArray(candidatePlace.trees) ? candidatePlace.trees : []).map(function (savedTree) {
                if (!savedTree || typeof savedTree !== 'object') { return savedTree; }
                const savedQueries = savedTree.searchQueries && typeof savedTree.searchQueries === 'object' ? savedTree.searchQueries : {};
                const searchQueries = Object.create(null);
                Object.keys(savedQueries).forEach(function (tabName) {
                    const currentTabName = renameTab(tabName);
                    if (!isRemovedTab(currentTabName)) { searchQueries[currentTabName] = savedQueries[tabName]; }
                });
                const selectedTab = typeof savedTree.selectedTab === 'string' ? renameTab(savedTree.selectedTab) : savedTree.selectedTab;
                return Object.assign({}, savedTree, {
                    selectedTab: isRemovedTab(selectedTab) ? 'treecipe' : selectedTab,
                    searchQueries: searchQueries
                });
            })
        });

    }

    function isReadablePlace(candidatePlace) {

        return !!candidatePlace && typeof candidatePlace === 'object' && candidatePlace.version === PANEL_PLACE_VERSION && typeof candidatePlace.runFolderName === 'string';

    }

    /*
        The document's own getState first: it is newer whenever it has one. A document with none
        -- a panel opened after a close or a window reload -- takes the place the host kept (#230).
    */
    function takeRestorablePlace(recipe, hostPlace) {

        if (isPlaceRestoreSettled) { return null; }

        const upgradedHostPlace = upgradePlace(hostPlace);
        const savedPlace = restorablePlace || (isReadablePlace(upgradedHostPlace) ? upgradedHostPlace : null);
        restorablePlace = null;
        isPlaceRestoreSettled = true;

        return savedPlace && recipe && savedPlace.runFolderName === recipe.selectedRunFolderName && recipe.objects.length > 0 ? savedPlace : null;

    }

    // BEFORE THE DRAW: A PICKER THE READER HAD USED ASKS FOR ITS ORGS AGAIN ONCE THE MODEL IS DRAWN, AS IT DOES FOR ANY NEW MODEL
    function applyPlaceBeforeRender(savedPlace) {

        if (savedPlace && savedPlace.isOrgPickerInUse === true) { isDataOrgPickerInUse = true; }
        if (savedPlace) { isFavoritesOnly = savedPlace.isFavoritesOnly === true; }

    }

    function toStringSet(candidateList) {

        // KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
        const stringSet = Object.create(null);
        if (Array.isArray(candidateList)) {
            candidateList.forEach(function (candidate) { if (typeof candidate === 'string') { stringSet[candidate] = true; } });
        }
        return stringSet;

    }

    function hasString(stringSet, candidate) {
        return Object.prototype.hasOwnProperty.call(stringSet, candidate);
    }

    function hasAnyString(stringSet) {
        return Object.keys(stringSet).length > 0;
    }

    /*
        The rest of the place, AFTER "rendered": opening a picklist row asks the host, which answers
        only once the ack has activated this model's allow-lists. An entry naming a card, object or
        tab this model does not have is passed over on its own -- the rest of the place still comes
        back.
    */
    function restorePlaceAfterRender(savedPlace) {

        if (!savedPlace) { return; }

        isRestoringPlace = true;

        try {
            restoreSavedTrees(savedPlace);
        } finally {
            isRestoringPlace = false;
        }

    }

    function restoreSavedTrees(savedPlace) {

        const savedTrees = Array.isArray(savedPlace.trees) ? savedPlace.trees : [];

        savedTrees.forEach(function (savedTree) {

            if (!savedTree || typeof savedTree !== 'object' || typeof savedTree.treeKey !== 'string') { return; }

            const treeState = findTreeState(savedTree.treeKey);
            if (!treeState) { return; }

            const expandedObjectKeys = toStringSet(savedTree.expandedObjectKeys);
            const openPicklistKeys = toStringSet(savedTree.openPicklistKeys);
            const savedSearchQueries = savedTree.searchQueries && typeof savedTree.searchQueries === 'object' ? savedTree.searchQueries : {};

            // BEFORE ANY TAB IS BUILT: A TAB READS ITS SEARCH, AND APPLIES IT, WHEN IT IS BUILT
            PANEL_PLACE_TABS.forEach(function (tabName) {
                const savedQuery = Object.prototype.hasOwnProperty.call(savedSearchQueries, tabName) ? savedSearchQueries[tabName] : '';
                if (typeof savedQuery === 'string') {
                    treeState.searchTexts[tabName] = savedQuery;
                    treeState.searchQueries[tabName] = savedQuery.trim().toLowerCase();
                }
            });

            const hasOpenPicklists = hasAnyString(openPicklistKeys);

            treeState.objectStates.forEach(function (treeObjectState) {
                if (hasString(expandedObjectKeys, buildObjectPlaceKey(treeObjectState))) { treeObjectState.isExpandedByReader = true; }
                // A PICKLIST KEY IS BUILT PER FIELD, SO A PLACE THAT OPENED NONE BUILDS NONE
                if (!hasOpenPicklists) { return; }
                treeObjectState.fieldStates.forEach(function (fieldState) {
                    if (fieldState.field.isPicklist && hasString(openPicklistKeys, buildFieldPlaceKey(treeObjectState, fieldState))) { fieldState.isPicklistExpanded = true; }
                });
            });

            if (typeof savedTree.selectedTab === 'string' && PANEL_PLACE_TABS.indexOf(savedTree.selectedTab) !== -1) {
                selectTreeTab(treeState, savedTree.selectedTab);
            }

            if (savedTree.isExpanded === true) {
                treeState.isExpandedByReader = true;
                setTreeExpanded(treeState, true);
            }

            // A STRUCTURE TAB BUILT BEFORE ITS OBJECTS WERE MARKED OPEN APPLIES THEM NOW; ONE NOT YET BUILT APPLIES THEM WHEN IT IS
            applyStructureFilter(treeState);

        });

    }

    function restoreScroll(savedPlace) {

        if (!savedPlace || typeof savedPlace.scrollY !== 'number' || !isFinite(savedPlace.scrollY) || savedPlace.scrollY <= 0) { return; }
        if (typeof window.scrollTo === 'function') { window.scrollTo(0, savedPlace.scrollY); }

    }

    function renderPanel(recipe) {

        resetPanelState();
        renderedRunFolderName = recipe.selectedRunFolderName;

        const hasObjects = recipe.objects.length > 0;

        treesViewElement = createElement('div', 'treesView');

        renderToolbar(recipe, hasObjects);

        recipe.notices.forEach(function (notice) {
            cockpitBodyElement.appendChild(createElement('div', 'notice', notice));
        });

        if (!hasObjects) {
            cockpitBodyElement.appendChild(createElement('div', 'emptyState', recipe.emptyStateMessage));
            // ONLY WHEN THERE IS NO RUN AT ALL: A RUN THAT COULD NOT BE READ KEEPS ITS RUN SELECTOR INSTEAD
            if (recipe.runs.length === 0) {
                cockpitBodyElement.appendChild(buildGenerateTreecipeElement());
            }
            return;
        }

        cockpitBodyElement.appendChild(treesViewElement);

        renderTrees(recipe);

    }

    // EVERYTHING ONE MODEL'S DRAW HELD, DROPPED BEFORE THE NEXT DRAW OR A FAILURE NOTICE REPLACES IT
    function resetPanelState() {

        cockpitBodyElement.textContent = '';
        treeStates = [];
        treesViewElement = null;
        dataOrgViews = [];
        dataOrgLabels = null;
        isDataOrgLoadShown = true;
        isDataOrgSelectShown = false;
        isDataOrgRefreshShown = false;
        isDataOrgRefreshDisabled = false;
        dataOrgTypeLabel = null;
        dataOrgStatusText = '';
        isDataOrgStatusFailure = false;
        dataOrgHiddenNoteText = '';
        dataOrgRequestedSequence = null;
        dataOrgRequestSequence = null;
        dataOrgClearedRequestSequence = null;
        dataOrgSelectedIndex = null;
        dataOrgSelectionFailureMessage = '';
        dataOrgReadinessByObject = Object.create(null);
        dataOrgReadinessByTreeObjectKey = Object.create(null);
        dataOrgInsertResultsByTreeKey = Object.create(null);
        pendingPicklistValueElements = Object.create(null);
        pendingDatasetCountElements = Object.create(null);
        answeredDatasetCounts = Object.create(null);
        fieldSearchTexts = new Map();
        addFriendButtonElements = [];
        runSelectElement = null;
        favoritesToggleElement = null;
        favoritesCountElement = null;
        noFavoritesElement = null;
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

    function renderPanelGuarded(recipe, renderSequence, focusTree, hostPlace) {

        // THE SAVED PLACE IS SPENT ON THIS DOCUMENT'S FIRST MODEL WHETHER OR NOT IT APPLIES; A LATER MODEL OF THE SAME RUN KEEPS THE PLACE ON SCREEN
        const savedPlace = takeRestorablePlace(recipe, hostPlace) || takeSameRunPlace(recipe);

        try {

            applyPlaceBeforeRender(savedPlace);
            renderPanel(recipe);
            renderedSequence = renderSequence;
            vscodeApi.postMessage({ command: 'rendered', renderSequence: renderSequence });

            // ONCE THE READER HAS USED THE PICKER, A NEW MODEL COUNTS ITS OBJECTS IN THE SAME ORG
            if (isDataOrgPickerInUse) { requestDataOrgs(); }

        } catch (renderError) {

            renderPanelFailure();
            postRenderFailure('render', renderError);

            return false;

        }

        // AFTER "rendered": WHAT A RESTORE OR A FOCUS OPENS MAY ASK THE HOST, WHICH ANSWERS ONLY ONCE THE ACK HAS ACTIVATED ITS ALLOW-LISTS
        try {
            restorePlaceAfterRender(savedPlace);
            // A FOCUS IS WHAT THE READER JUST ASKED FOR, SO IT WINS OVER WHERE THEY LAST WERE
            applyTreeFocus(focusTree);
            restoreScroll(savedPlace);
        } catch (focusError) {
            postRenderFailure('runtime', focusError);
        }

        savePanelPlace();

        return true;

    }

    function findTreeState(treeKey) {

        return treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === treeKey; }) || null;

    }

    // DISABLED UNTIL THE HOST'S RELOAD REDRAWS THE BODY, WHICH IT DOES HOWEVER GENERATION ENDED
    function buildGenerateTreecipeElement() {

        const generateElement = createElement('div', 'emptyStateActions');
        const generateButtonElement = createElement('button', 'generateTreecipe', GENERATE_TREECIPE_ACTION_LABEL);

        generateButtonElement.addEventListener('click', function () {
            generateButtonElement.disabled = true;
            generateButtonElement.textContent = GENERATE_TREECIPE_RUNNING_LABEL;
            vscodeApi.postMessage({ command: 'generateTreecipe' });
        });

        generateElement.appendChild(generateButtonElement);

        return generateElement;

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
            if (renderPanelGuarded(hostMessage.recipe, hostMessage.renderSequence, hostMessage.focusTree, hostMessage.restorePlace)) {
                setLoadStatus('', false);
            }

            return;

        }

        if (hostMessage.command === 'picklistValues') {
            renderPicklistValues(hostMessage);
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

        if (hostMessage.command === 'dataOrgReadiness') {
            renderDataOrgReadiness(hostMessage);
            return;
        }

        if (hostMessage.command === 'insertState') {
            setInsertRunning(hostMessage.isRunning ? hostMessage.treeKey : null);
            return;
        }

        if (hostMessage.command === 'addFriendState') {
            setAddFriendRunning(!!hostMessage.isRunning);
            return;
        }

        if (hostMessage.command === 'treePreferences') {
            renderTreePreferences(hostMessage);
            return;
        }

        if (hostMessage.command === 'objectSelection') {
            renderObjectSelection(hostMessage);
            return;
        }

        if (hostMessage.command === 'scratchOrgState') {
            renderScratchOrgState(hostMessage);
            return;
        }

        if (hostMessage.command === 'metadataDeployState') {
            renderMetadataDeployState(hostMessage);
            return;
        }

        if (hostMessage.command === 'datasetAdded') {
            renderDatasetAdded(hostMessage);
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

    // A SCROLL FIRES PER FRAME, AND A SAVE WALKS EVERY CARD, SO A RUN OF THEM IS SAVED ONCE
    window.addEventListener('scroll', function () {

        if (scrollSaveTimer !== null) { return; }

        scrollSaveTimer = setTimeout(function () {
            scrollSaveTimer = null;
            savePanelPlace();
        }, PANEL_PLACE_SCROLL_SAVE_DELAY);

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
