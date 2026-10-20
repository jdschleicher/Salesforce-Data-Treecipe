import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { ErrorHandlingService } from '../ErrorHandlingService/ErrorHandlingService';
import { IAuthenticatedOrgDetail, ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import {
    IPermissionSetCandidate,
    PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS,
    PERMISSION_SET_MAX_BUFFER_BYTES,
    PERMISSION_SET_MAX_PICKS,
    PERMISSION_SET_NOTIFICATION_SKIPS_SHOWN,
    PermissionSetAssignOutcome,
    RecipeCockpitPermissionSetAssign
} from './RecipeCockpitPermissionSetAssign';
import { RecipeCockpitPermissionSetGenerate } from './RecipeCockpitPermissionSetGenerate';
import { IValidationRuleListObject, IValidationRuleListRunRecord, RecipeCockpitValidationRuleList } from './RecipeCockpitValidationRuleList';
import {
    IMetadataDeployComponent,
    IMetadataDeployObject,
    IMetadataDeploySummary,
    METADATA_DEPLOY_FAILURES_SHOWN,
    METADATA_DEPLOY_OPERATION_BY_KIND,
    METADATA_DEPLOY_TIMEOUT_MILLISECONDS,
    MetadataDeployKind,
    MetadataDeployOutcome,
    RecipeCockpitMetadataDeploy
} from './RecipeCockpitMetadataDeploy';
import {
    RecipeCockpitValidationRuleRetrieve,
    VALIDATION_RULE_RETRIEVE_MAX_OBJECTS,
    VALIDATION_RULE_RETRIEVE_TIMEOUT_MILLISECONDS,
    ValidationRuleRetrieveOutcome
} from './RecipeCockpitValidationRuleRetrieve';
import {
    DevHubConfigSource,
    IDataOrgDetail,
    IDataOrgListing,
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
import { ILookupWiringContext, ILookupWiringRequest, IPinnedFieldRestoreRequest, IRecipeFilterLookup, IRecipeFixedValue, IRecipeUnconstrainedValue, IScannedObject, RecipeBlockFieldListResult, RecipeCockpitRecipeWriter, RecipeFixedValueKind } from './RecipeCockpitRecipeWriter';
import { IFixedValueEntry, IFixedValueFileRead, RecipeCockpitFixedValueStore } from './RecipeCockpitFixedValueStore';
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
import { CollectionsApiService, DataSetRecordPreparer, IDataSetInsertResult } from '../CollectionsApiService/CollectionsApiService';
import { RecipeCockpitInsertFailureTriage } from './RecipeCockpitInsertFailureTriage';
import { IFieldSize } from '../ObjectInfoWrapper/FieldInfo';
import { RelationshipService } from '../RelationshipService/RelationshipService';
import { DATASET_COLLECTIONS_API_FOLDER_NAME, DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import {
    IRecipeCockpitDatasetRecordCountViewModel,
    IRecipeCockpitTreeDatasetViewModel,
    IRecipeCockpitTreeHistoryTargets,
    IRecipeCockpitTreeHistoryViewModel,
    RecipeCockpitTreeHistory
} from './RecipeCockpitTreeHistory';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RunFakerConfirmation } from '../ExtensionCommandService/RunFakerConfirmation';
import { IScratchOrgAliasChoice, IScratchOrgPlan, ORG_OPERATIONS_FOLDER_NAME, SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES, ScratchOrgService, ScratchOrgSetupOutcome, ScratchOrgSetupPhase } from '../ScratchOrgService/ScratchOrgService';
import { PARENT_PICKER_RANDOM_LABEL, VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import {
    RECIPE_COCKPIT_QUERY_EXPORT_FORMATS,
    RECIPE_COCKPIT_QUERY_MAX_LENGTH,
    RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT,
    RECIPE_COCKPIT_QUERY_RECORD_CAP,
    RECIPE_COCKPIT_QUERY_VALUE_BUDGET,
    RecipeCockpitQuery,
    RecipeCockpitQueryExportFormat
} from './RecipeCockpitQuery';
import { ISOQLTreeQuery, SOQL_QUERY_KIND_LABELS, SOQLQueryKind, SOQLTemplateService } from '../SOQLTemplateService/SOQLTemplateService';
import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';

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
    | 'excludedOverlay'
    | 'dialogBackdrop';

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
    excludedOverlay: 'rgba(148, 163, 184, 0.40)',
    // --sdt-text AT 50%, BEHIND AN IN-PANEL CONFIRMATION (#349); A TEST COMPOSITES IT AND HOLDS THE DIALOG'S EDGE TO 3:1 AGAINST IT
    dialogBackdrop: 'rgba(31, 41, 55, 0.50)'
});

/*
    Every button the panel draws is ONE of these kinds (#363), styled by one rule each in the shell,
    so a new button cannot come out as a browser default by missing a selector list. A button's own
    class keeps only its size and layout. compact is a size, not a kind: it can go with any kind.
*/
export type RecipeCockpitButtonKind = 'primary' | 'secondary' | 'icon' | 'check' | 'link';
export const RECIPE_COCKPIT_BUTTON_KINDS: readonly RecipeCockpitButtonKind[] = Object.freeze(['primary', 'secondary', 'icon', 'check', 'link'] as RecipeCockpitButtonKind[]);

export const RECIPE_COCKPIT_LOAD_PHASES = {
    findingRuns: 'Finding generated recipe runs…',
    readingRun: 'Reading the generated recipe run…'
};




export const RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND = 'treecipe.generateTreecipe';
// A FAILED INSERT'S "Open Troubleshooting" (#375) OPENS A CLOSED COCKPIT THROUGH ITS OWN COMMAND, SO THE FEATURE FLAG STILL DECIDES
export const RECIPE_COCKPIT_OPEN_COMMAND = 'treecipe.openRecipeCockpit';
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
    moved onto another tab's search. Removing another tab is adding its name here. Record types
    (#321) became a section of the Treecipe tab: a card saved on it opens with that section expanded.
*/
export const RECIPE_COCKPIT_REMOVED_TREE_TABS: readonly string[] = Object.freeze(['versions', 'compare', 'dataByOrg', 'recordTypes']);
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
    A data set's own name and favorite, kept in workspaceState by its FOLDER NAME under
    FakeDataSets/ -- unique there, since a same-second folder takes a -<n> suffix -- so a data set
    keeps both however many cards list it and across every reload.
*/
export const RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY = 'treecipe.recipeCockpit.datasetPreferences';

/*
    What each tree folder's Structure tab excluded directly (#219) and the fields it unticked (#220);
    the cascade and the locks are recomputed, never stored. Version 2 added the fields; a version 1
    entry still reads, as objects with nothing unticked.
*/
export const RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY = 'treecipe.recipeCockpit.objectSelection';
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION = 7;
// THE LAST VERSION THAT STORED FAKER BOUNDS (#323); #356 EDITS THE EXPRESSION ITSELF, SO THEY ARE NOT READ
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS = 6;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES = 5;
export const RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS = 4;
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
// A VALUE THAT STARTS WITH THIS IS SAVED AS AN EDITED FAKER EXPRESSION (#356), ANYTHING ELSE AS A LITERAL
export const RECIPE_COCKPIT_EXPRESSION_OPENER = '${{';
// WHAT A FIELD'S INLINE EDITOR (#337) SAYS WHEN THE HOST DID NOT STORE WHAT WAS TYPED, FOR A REASON OTHER THAN THE VALUE
// A PIN WRITES THE RECIPE FILE (#342): HOW AN INLINE EDIT ENDS WHEN THAT WRITE DOES NOT HAPPEN
export const RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL = 'Not saved: the recipe file was not changed.';
export const RECIPE_COCKPIT_FIELD_EDIT_WRITE_RUNNING_REFUSAL = 'Not saved: another change to this recipe file is still being written. Try again once it finishes.';
export const RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL = 'Write to recipe';
export const RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL = 'Put back';
export const RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES = 12;
export const RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH = 800;
// A CUSTOM GEOLOCATION FIELD'S COMPONENTS: THE WRAPPER TYPES THEM Text, BUT THE INSERT TAKES ONLY A NUMBER IN RANGE (#342)
export const RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES: Readonly<Record<string, { suffix: string; limit: number }>> = {
    Latitude: { suffix: '__Latitude__s', limit: 90 },
    Longitude: { suffix: '__Longitude__s', limit: 180 }
};
export const RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL = 'Reset';
export const RECIPE_COCKPIT_TREE_PREFERENCES_VERSION = 1;
export const RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH = 80;
export const RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION = 1;
export const RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH = 80;
export const RECIPE_COCKPIT_RENAME_TREE_ACTION_LABEL = '✎';

/*
    The cockpit's first SVG glyphs (#219, #257): a chain link, one path per state, drawn by the panel
    script with createElementNS and coloured only from the --sdt-* palette by CSS. Joined is included;
    broken -- the links pulled apart, a spark either side of the gap -- is excluded, and a dashed broken
    link is excluded because a parent is. The SHAPE says the state, never the colour alone. Both are
    stroked in a 24x24 box and turned 45 degrees clockwise, so the link runs from the bottom right to
    the top left (#295). They fetch nothing, so the CSP, the nonce-only shell builder and
    localResourceRoots: [] are unchanged.
*/
export const RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX = '0 0 24 24';
export const RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM = 'rotate(45 12 12)';
export const RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH = 'M6 8 H10 A4 4 0 0 1 10 16 H6 A4 4 0 0 1 6 8 Z M14 8 H18 A4 4 0 0 1 18 16 H14 A4 4 0 0 1 14 8 Z';
export const RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH = 'M4.5 8 H6.5 A4 4 0 0 1 6.5 16 H4.5 A4 4 0 0 1 4.5 8 Z M17.5 8 H19.5 A4 4 0 0 1 19.5 16 H17.5 A4 4 0 0 1 17.5 8 Z M12 3.5 V6 M12 18 V20.5';
/*
    A field's edit button (#356, the pin of #262 and the ✎ of #323 in one), built the same way as the
    chain link: one path -- a pencil -- stroked from the palette by CSS, and filled while the field
    holds an edit, so the shape, aria-pressed, the title and the row's badge ("edited" for an
    expression, "fixed" for a literal) all say it, never the colour alone.
*/
export const RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH = 'M4 20 L5 15 L15.5 4.5 L19.5 8.5 L9 19 Z M13.5 6.5 L17.5 10.5';
export const RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL = 'fixed';
export const RECIPE_COCKPIT_EDITED_EXPRESSION_BADGE_LABEL = 'edited';
/*
    A field's validation-rule checkbox (#325), at the end of its row: checked while the rules #324
    applied shape the field, unticked to generate the value it had before them. One box covers every
    rule on the field. A field whose rules were all not applied draws a muted note instead.
*/
export const RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON = 'an edit replaces it';
export const RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL = 'rule not applied';
/*
    The ▸/▾ of a tree card, a Treecipe object and a picklist field (#277), drawn like the chain link: a
    font's triangle sits on the text baseline, so no button rule could centre it. An open chevron (#307)
    whose box is centred on (12, 12) in the same 24x24 view box, stroked from the palette by CSS.
*/
export const RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH = 'M8.5 5 L15.5 12 L8.5 19';
// The magnifier inside every search box (#373): a lens and a handle in the same 24x24 view box, stroked from the palette.
export const RECIPE_COCKPIT_SEARCH_GLYPH_PATH = 'M10.5 4 A6.5 6.5 0 1 1 10.5 17 A6.5 6.5 0 1 1 10.5 4 Z M15.2 15.2 L20 20';
/*
    Motion (#227). The ▸ is ONE path that CSS turns a quarter on aria-expanded, so it rotates rather
    than swapping. A body the reader opens fades in once it is built; one the reader closes carries
    "hidden" at once -- aria-hidden and inert while it fades out -- so what is hidden is hidden from
    assistive technology for the whole animation. Only a reader's click animates: a restore, a
    focusTree and a search stay instant. prefers-reduced-motion turns every transition and
    animation off, in the stylesheet and in the script.
*/
export const RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS = 160;
export const RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS = 140;
export const RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS = 120;
export const RECIPE_COCKPIT_FAVORITE_TREE_LABEL = '★';
export const RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL = '☆';
export const RECIPE_COCKPIT_FAVORITES_ONLY_LABEL = 'Favorites only';
// THE TREECIPE TAB'S CHECK (#320), AND WHY IT IS DISABLED ON A CARD WITH NO RECORD TYPES TO CHOOSE FROM
export const RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL = 'Record type fields only';
export const RECIPE_COCKPIT_PICKLIST_SHOW_VALUES_LABEL = 'Show values';
export const RECIPE_COCKPIT_PICKLIST_HIDE_VALUES_LABEL = 'Hide values';
export const RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE = 'No object in this tree has more than one record type, so no field depends on one.';
// THE TREECIPE TAB'S "TODOs only" CHECK (#354), AND WHY IT IS DISABLED ON A CARD WHOSE RECIPE HAS NO TODO COMMENT
export const RECIPE_COCKPIT_TODOS_ONLY_LABEL = 'TODOs only';
// WHAT A FIELD'S TODO ROW SAYS WHEN THE TODO IS IN THE VALUE THE ROW ALREADY DRAWS (#354)
export const RECIPE_COCKPIT_TODO_IN_VALUE_LABEL = 'TODO in the value above';
export const RECIPE_COCKPIT_NO_TODOS_NOTE = 'No object of this tree has a TODO comment in the recipe.';
export const RECIPE_COCKPIT_NO_FAVORITES_MESSAGE = 'No favorite trees in this run. Turn off Favorites only to see all trees.';

export const RECIPE_COCKPIT_INSERT_DATASET_COMMAND = 'treecipe.insertDataSetBySelectedDirectory';

// A TREE CARD'S GENERATE BUTTON HANDS ITS RECIPE FILE TO THIS COMMAND, WHICH KEEPS ITS CONFIRMATION AND BACKEND CHECK
export const RECIPE_COCKPIT_RUN_FAKER_COMMAND = 'treecipe.runFakerByRecipe';

// A SELF-LOOKUP ITERATION'S "+" ADDS ONE OF ITS OBJECT'S FRIENDS BENEATH IT (#197)
export const RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL = '+';
export const RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL = 'Add';
export const RECIPE_COCKPIT_WIRE_LOOKUP_ACTION_LABEL = 'Wire to…';
export const RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL = 'Wire TODO lookups';
export const RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL = 'Wire';
// HOW MANY LOOKUPS THE WIRE-ALL CONFIRMATION NAMES BEFORE IT COUNTS THE REST
export const RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_SHOWN = 12;
// A TODO LOOKUP WHOSE STANDARD PARENT THE RECIPE DOES NOT WRITE ADDS THAT PARENT FROM A TEMPLATE (#294)
export const RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL = 'Add to recipe';

/*
    Every tab a card can draw. Treecipe is selected by default; the data sets tab is drawn only for
    a card with a history. Record types (#195) is a collapsible section of the Treecipe tab (#321),
    drawn only on a card listing an object with two or more record types. Troubleshooting (#346) is
    drawn on every card with a folder.
*/
export const RECIPE_COCKPIT_TREE_TABS = ['treecipe', 'datasets', 'troubleshooting', 'query'] as const;

// THE TODO RecipeService WRITES UNDER A DEFAULT RecordTypeId (AND EVERY RECORD-TYPE VARIANT) WHEN AN OBJECT HAS SEVERAL RECORD TYPES
export const RECIPE_COCKPIT_RECORD_TYPE_OPTIONS_MARKER = '### TODO: -- RecordType Options -- ';
export const RECIPE_COCKPIT_REGENERATE_WITH_RECORD_TYPES_LABEL = 'Regenerate with these record types';
export const RECIPE_COCKPIT_USE_DEFAULT_RECORD_TYPES_LABEL = 'Use defaults';
export const RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL = 'Remember this selection';
export const RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE = 'Save the choice in treecipe/treecipe.config.json, so Generate Treecipe reuses it. With Use defaults, forgets a saved choice.';
export const RECIPE_COCKPIT_RECORD_TYPE_SELECTION_NOT_SAVED_MESSAGE = 'The record type selection could not be saved in treecipe.config.json, so it was used for this run only.';
export const RECIPE_COCKPIT_RECORD_TYPES_SECTION_TITLE = 'Record types';
// THE PANEL'S TWO SECTIONS (#348): THE ONE ORG PICKER, ALWAYS OPEN (#355), THEN EVERY TREE CARD
export const RECIPE_COCKPIT_ORG_SECTION_TITLE = 'Target Org Management';
export const RECIPE_COCKPIT_TREECIPES_SECTION_TITLE = 'Treecipes';
// THE TREECIPES SECTION DRAWS ONE CARD, CHOSEN IN A DROPDOWN, UNDER ONE SEARCH ACROSS EVERY CARD (#374)
export const RECIPE_COCKPIT_TREECIPE_PICKER_LABEL = 'Treecipe';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER = 'Search treecipes, objects, fields and record types';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH = 'No treecipe, object, field or record type matches this search.';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX = ' (no match)';
// HOW MANY RESULT ROWS THE SECTION SEARCH DRAWS; THE REST IS ONE "N more" LINE
export const RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT = 50;
// THE PINNED ORG SECTION (#364) COVERS THE TOP OF THE PANEL, SO A ROW SCROLLED INTO VIEW STOPS BELOW IT
export const RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING = '10rem';
// WHAT A CARD WITH NOTHING TO CHOOSE SAYS IN ITS DISABLED RECORD TYPES HEADER (#338); ONE RECORD TYPE IS NO CHOICE, SO IT READS THE SAME AS NONE
export const RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY = 'No objects in this tree have two or more record types in local metadata';
// WHAT THE SECTION SAYS ABOVE ITS ROWS: A REGENERATE IS A GENERATE TREECIPE, WHICH WRITES A NEW RUN OF EVERY TREE
export const RECIPE_COCKPIT_RECORD_TYPES_INTRO = 'Choose the record types Generate Treecipe writes for each object: one recipe block per ticked record type, each with its own RecordTypeId and picklist values. Regenerating writes a new run of every tree; the run on screen is kept.';

export type RecipeCockpitTreeTab = typeof RECIPE_COCKPIT_TREE_TABS[number];

// A TAB ADDED SINCE THE PLACE VERSION THAT KEEPS ITS SEARCH ONLY WHEN THERE IS ONE (#367), SO AN OLDER PLACE READS AS IT WAS
export const RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS: readonly RecipeCockpitTreeTab[] = Object.freeze(['query'] as RecipeCockpitTreeTab[]);

// TABS WHOSE SEARCH IS NOT THE TAB'S OWN: TROUBLESHOOTING SEARCHES PER SUB-TAB (#365), SO A PLACE'S TAB-WIDE ONE IS DROPPED
export const RECIPE_COCKPIT_TABS_WITHOUT_SEARCH: readonly RecipeCockpitTreeTab[] = Object.freeze(['troubleshooting'] as RecipeCockpitTreeTab[]);

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

/*
    The help section (#332). Its text is the panel's and is written through textContent; the guide's
    url is the HOST's alone, opened by "openHelpGuide", which carries nothing. docs/RECIPE-COCKPIT-GUIDE.md
    has the same headings in the same order, and a test holds the two together, so a change to one
    is a change to both -- the /cockpit-help-sync skill makes it.
*/
export interface IRecipeCockpitHelpSection {
    heading: string;
    paragraphs: string[];
    items?: string[];
    closingParagraphs?: string[];
}

export const RECIPE_COCKPIT_HELP_GUIDE_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/docs/RECIPE-COCKPIT-GUIDE.md';

export const RECIPE_COCKPIT_HELP_TOGGLE_LABEL = '?';

export const RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL = 'About this cockpit';

export const RECIPE_COCKPIT_HELP_TITLE = 'About the Recipe Cockpit';

export const RECIPE_COCKPIT_HELP_RUN_PREFIX = 'On screen now: ';

export const RECIPE_COCKPIT_HELP_GUIDE_LABEL = 'Open the full guide';

export const RECIPE_COCKPIT_HELP_SUMMARY_HEADING = 'What differs from the recipe files right now';

export const RECIPE_COCKPIT_HELP_NO_DIFFERENCE = 'No tree differs from its recipe file.';

export const RECIPE_COCKPIT_HELP_BACKEND_NOTE = 'faker-js recipes nest child objects under friends:, snowfakery recipes keep every object at the top, and snowfakery does not apply a validation rule\'s pattern (REGEX), so those fields have no rules box. Everything else here works the same for both.';

export const RECIPE_COCKPIT_HELP_SECTIONS: readonly IRecipeCockpitHelpSection[] = [
    {
        heading: 'Where recipes come from',
        paragraphs: [
            'Generate Treecipe reads your object metadata and writes a run: a folder under treecipe/GeneratedRecipes holding the recipe files (.yml) and a list of the objects it read.',
            'The cockpit opens the newest run, or the one you pick in the run list. Each card is one tree: related objects written to one recipe file, parents before children.',
            'Under the run list, the Target Org Management section picks the org a card can insert into, opens it in your browser or makes a new scratch org, which it creates and selects without deploying anything to it. It stays at the top of the panel while you scroll. The Treecipes section below it shows one card at a time: pick it in the Treecipe dropdown, which starts on the one you picked last.',
            'The search box above the dropdown finds a treecipe by its name or folder, or by an object, field or record type in it, and lists what it found. Click a result to open that card on its Treecipe tab at that row. Favorites only narrows the dropdown to your starred cards.',
            'Each card\'s Generate fake data and insert button generates the tree and inserts it into that org; with no org chosen, it asks you for one first, and when something else stops the insert it is disabled and says why. If an insert fails, its message opens the generated file that failed and the card\'s Troubleshooting area that may fix it. To generate without inserting, use Run Faker by Recipe from the command palette.',
            'Generate Treecipe marks what still needs a hand edit with a TODO comment, such as a lookup with no parent yet or a validation rule it could not apply. Tick TODOs only on a card\'s Treecipe tab to see just the fields and objects with one, or open its Troubleshooting tab, whose TODO\'s list shows them all with a link to each line.',
            'The Troubleshooting tab shows one area at a time: TODO\'s, Fields, Permissions, Validation Rules, Record Types and Global Value Sets, each with its own search. It opens on the one you chose last.',
            'Validation Rules lists each object\'s validation rules from your project: whether each is active, its error message, the fields it constrains and whether Generate Treecipe applied it, or why not. Show formula opens a rule\'s formula.'
        ]
    },
    {
        heading: 'What the cockpit changes without editing the YAML',
        paragraphs: [
            'These settings change what is generated, but the recipe file stays exactly as Generate Treecipe wrote it, so it always shows what was generated from your metadata:'
        ],
        items: [
            'Excluded objects (the chain link): the object and its children are left out.',
            'Unticked fields: the field is left out.',
            'Record counts: how many records an object gets.',
            'The rules box: a field generated without the limits its validation rules set.'
        ]
    },
    {
        heading: 'What does edit the YAML',
        paragraphs: [
            'These buttons rewrite the recipe file itself, because the change belongs in the recipe:'
        ],
        items: [
            'Wire to… and Wire TODO lookups: fill a lookup\'s TODO with its parent\'s nickname.',
            'Add <parent> to recipe: adds a standard parent object, such as Account, above the child that needs it.',
            '+ beside an object that looks up to itself: adds a child record under it.',
            'Edit (the pencil on a field): opens the field\'s faker expression to change its arguments or call another faker method, or to replace it with one fixed value for every record. It is written into the recipe so Run Faker by Recipe uses it too. The lines it replaced are kept in a .fixedValues.json file beside the recipe, and Clear puts them back exactly.'
        ],
        closingParagraphs: [
            'Three more write other files: Remember this selection saves record types to treecipe.config.json, and on a card\'s Troubleshooting tab, Generate permission set (under Permissions) writes a permission set into your project and Retrieve validation rules (under Validation Rules) writes an org\'s validation rules into your project.',
            'The Troubleshooting tab also deploys to a sandbox or scratch org, never production: Deploy permission set (Permissions), Deploy fields (Fields, custom fields only), Deploy record types (Record Types) and Deploy global value sets (Global Value Sets) each send just those parts of your project, after a confirmation that lists them.',
            'Each of these asks first, in a box over the cockpit. Scroll it to read everything it will do; Cancel or Escape does nothing.',
            'The Query tab writes no recipe either. It lists the SOQL Generate Treecipe wrote for the tree; edit a query, run it against any connected org you pick in the command palette (a query only reads), and export what came back as JSON or CSV under treecipe/QueryResults, which git ignores.'
        ]
    },
    {
        heading: 'Where your changes are stored',
        paragraphs: [
            'The settings that leave the YAML alone are kept by VS Code for this workspace on this machine, per tree. They carry over when you regenerate the same objects, but they are not in your repository, so a teammate or a fresh clone starts without them.',
            'When you generate, the cockpit applies them to a copy of the recipe. The data set keeps that copy as filteredRecipe-… beside originalRecipe-… in its BaseArtifactFiles folder, and datasetSource.json lists what was changed.',
            'Reset selection on a card clears its settings. An edit is in the recipe file, so Reset leaves it: clear it with the field\'s pencil.',
            'Edits on the Query tab are kept the same way, per tree; Reset beside a query puts back the generated text.'
        ]
    }
];

export const RECIPE_COCKPIT_HELP_SECTION_HEADINGS: readonly string[] = RECIPE_COCKPIT_HELP_SECTIONS.map(helpSection => helpSection.heading);

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

It CAN WRITE TO AN ORG: the Treecipe tab's "Generate fake data and insert" generates a whole relationship tree and inserts it into the org you choose there. That picker never lists or connects to production: it offers only orgs the Salesforce CLI knows as a sandbox or a scratch org and reports as connected (to answer that, the CLI pings each authorized org's token, once per session or per ⟳; Treecipe itself connects only to the org you select), and the insert is offered only for an org that reports itself as a sandbox and asks you to confirm each time. It inserts the way Insert Data Set by Directory does: you choose all-or-none, and Cancel deletes what that insert saved. The Treecipe tab's "+ New scratch org" creates a scratch org through the Dev Hub you pick from the connected Dev Hubs (every time, even when there is only one) and selects it, after you confirm; it deploys nothing to it, and the cockpit never deletes an org. "Assign permission sets to me…", on every tree's Troubleshooting tab, assigns the permission sets you pick from this workspace's source that grant access to that tree's objects to the user the org selected there is authorized as, or the user of a sandbox or scratch org you pick when none is, after a confirmation, and only once the org answers again that it is a sandbox. It deploys nothing: a permission set the org does not hold yet is named in a warning for you to deploy. "Generate permission set…" writes a permission set granting Create and Read on a tree's objects into this project's permissionsets/SDT_Treecipe folder, after a confirmation, and deploys nothing either. "Retrieve validation rules…", on every tree, asks every time in the command palette for any connected org, production included, and retrieves that tree's validation rules from it into this project after a confirmation: it only reads from that org and deploys nothing. The Query tab, on every tree, runs a query you can edit against any connected org you pick in the command palette every time, production included: a query only reads, and what it returns is written only when you export it, under treecipe/QueryResults. The Troubleshooting tab's deploy buttons ARE the cockpit's only metadata deploys: "Deploy permission set…", "Deploy fields…" (only the tree's custom fields, never a standard field, an object definition or a layout), "Deploy global value sets…" and "Deploy record types…" each deploy just those components, through a package.xml the cockpit writes under treecipe/OrgOperations, to the sandbox or scratch org selected in the Org section or one you pick, after a confirmation that lists every component, and only once that org answers again that it is a sandbox. They never reach production.

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
    the bare type.

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
    // SET ONLY ON A FIELD A VALIDATION RULE NAMES (#324, #325), SO A WRAPPER WITHOUT RULES POSTS AS IT ALWAYS DID
    validationRules?: IRecipeCockpitFieldValidationRulesViewModel;
    // SET ONLY ON A FIELD WHOSE RECIPE LINES CARRY A TODO COMMENT (#354), SO A RECIPE WITHOUT ONE POSTS AS IT ALWAYS DID
    todos?: IRecipeCockpitTodoViewModel[];
}

/*
    One TODO comment of a recipe file (#354): its line and its text from the first "#". The text
    comes from a file the reader can edit, so the panel only ever writes it as text. On a FIELD the
    text is left out when the field's posted recipeValue already holds it -- the row draws that
    value, and every generated lookup and record type variant would otherwise post its TODO twice.
*/
export interface IRecipeCockpitTodoViewModel {
    lineNumber: number;
    text?: string;
    // WHERE A FIELD TODO WITH NO text SITS IN THE FIELD'S POSTED recipeValue (#365), SO A LIST AWAY FROM THE VALUE SHOWS IT EXACTLY
    valueStart?: number;
    valueLength?: number;
}

/*
    What #324 recorded about a field's validation rules (#325). appliedRuleNames is non-empty only
    when the wrapper also holds both values the box switches between: recipeValue, what the rules
    wrote, and unconstrainedRecipeValue, what the field generated before them, each as the wrapper
    records it (written as for a top-level object). unconstrainedExpression is the latter as the row
    draws it. Rule names and reasons come from workspace files and are only ever written as text.
*/
export interface IRecipeCockpitFieldValidationRulesViewModel {
    appliedRuleNames: string[];
    notAppliedRules: IRecipeCockpitValidationRuleNotAppliedViewModel[];
    recipeValue?: string;
    unconstrainedRecipeValue?: string;
    unconstrainedExpression?: string;
}

export interface IRecipeCockpitValidationRuleNotAppliedViewModel {
    ruleName: string;
    reason: string;
}

// A FIELD OF A CARD, BY NAME
export interface IRecipeCockpitFieldReferenceViewModel {
    objectApiName: string;
    fieldApiName: string;
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
    /*
        Set only on an object with two or more record types under a valid developer name (#195):
        what the Record types section offers. generatedRecordTypeDeveloperNames is what the run's recipe
        writes, in block order, and isRecordTypeSelectionApplied says it was written from a choice
        rather than as the default -- a later regenerate repeats a choice it was not asked to change.
    */
    recordTypes?: IRecipeCockpitRecordTypeViewModel[];
    generatedRecordTypeDeveloperNames?: string[];
    isRecordTypeSelectionApplied?: true;
    // THE TODO COMMENTS OF THE OBJECT'S BLOCK THAT SIT ON NO FIELD (#354): A VALIDATION RULE NOT APPLIED, A COMMENTED-OUT FIELD...
    todos?: IRecipeCockpitTodoViewModel[];
}

export type RecipeCockpitRecordTypeImpactKind = 'picklist' | 'multiselect' | 'dependent';

// A FIELD A RECORD TYPE RESTRICTS: COUNTS ONLY, SO THE MODEL DOES NOT GROW BY EVERY RECORD TYPE'S VALUES
export interface IRecipeCockpitRecordTypeImpactViewModel {
    fieldApiName: string;
    kind: RecipeCockpitRecordTypeImpactKind;
    valueCount: number;
}

export interface IRecipeCockpitRecordTypeViewModel {
    developerName: string;
    isActive: boolean;
    impacts: IRecipeCockpitRecordTypeImpactViewModel[];
}

// ONE FIELD OF A LATER OCCURRENCE: ONLY ITS LINE AND VALUE -- ITS TYPE AND LABEL ARE THE OBJECT'S OWN FIELD'S
export interface IRecipeCockpitObjectIterationFieldViewModel {
    fieldApiName: string;
    lineNumber: number;
    recipeValue: string;
    todos?: IRecipeCockpitTodoViewModel[];
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
    todos?: IRecipeCockpitTodoViewModel[];
}

// ONE LOOKUP TYING AN OBJECT TO A PARENT IN ITS OWN TREE; A SELF-LOOKUP NAMES ITS OWN OBJECT AS THE PARENT
export interface IRecipeCockpitParentLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
}

/*
    A lookup the card's recipe still writes as "### TODO -- REFERENCE ID REQUIRED", and the nicknames
    it can be wired to (#151): RecipeCockpitRecipeWriter.listLookupWirings's own answer, so the panel
    never offers a nickname the writer would refuse. objectNickname is set only on an object written
    more than once, and is the nickname of the occurrence the row draws.
*/
export interface IRecipeCockpitLookupWiringViewModel {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    candidateNicknames: string[];
}

// A TODO LOOKUP WHOSE ONE PARENT THE RECIPE DOES NOT WRITE AND A TEMPLATE CAN ADD (#294)
export interface IRecipeCockpitAddableParentViewModel {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
}

// ONE "Add <Parent> to recipe" THE CONFIRMED-DRAWN MODEL OFFERS, WITH THE HOST-ONLY RECIPE FILE IT WRITES
export interface IRecipeCockpitAddableParentTarget {
    recipeFilePath: string;
    addition: IRecipeCockpitAddableParentViewModel;
}

// ONE "Wire to…" THE CONFIRMED-DRAWN MODEL OFFERS, WITH THE HOST-ONLY RECIPE FILE IT WRITES
export interface IRecipeCockpitLookupWiringTarget {
    recipeFilePath: string;
    wiring: IRecipeCockpitLookupWiringViewModel;
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
    runFakerRecipeFileName is set only on a card that can generate: the recipe FILE NAME, for the
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
    /*
        SET ONLY WHEN A RULE-SHAPED FIELD OF THE CARD GENERATES WITHOUT ITS RULES (#325): the reader
        unticked its box. A field a lock holds back (excluded, unticked, edited) is not listed.
    */
    validationRulesOff?: IRecipeCockpitFieldReferenceViewModel[];
    // SET ONLY ON A CARD THAT CAN GENERATE WHOSE RECIPE HAS A TODO LOOKUP WITH A PARENT INSERTED BEFORE IT (#151)
    lookupWirings?: IRecipeCockpitLookupWiringViewModel[];
    // SET ONLY ON A CARD THAT CAN GENERATE WHOSE RECIPE HAS A TODO LOOKUP TO A STANDARD PARENT IT DOES NOT WRITE (#294)
    addableParents?: IRecipeCockpitAddableParentViewModel[];
}

// THE VALUE THE READER TYPED FOR A FIELD (#262), OR THE "${{ ... }}" THEY EDITED (#356); kind IS THE HOST'S AND DECIDES HOW IT IS WRITTEN
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

// WHAT THE GENERATE BUTTON HANDS treecipe.runFakerByRecipe FOR A CARD THAT LEAVES SOMETHING OUT -- THE SHAPE ITS HANDLER TYPE-CHECKS
export interface IRecipeCockpitRunFakerFilteredRecipe {
    recipeText: string;
    excludedObjectApiNames: string[];
    excludedFieldApiNamesByObject?: Record<string, string[]>;
    objectCountsByObject?: Record<string, number>;
    fixedValuesByObject?: Record<string, Record<string, string>>;
    validationRulesOffByObject?: Record<string, string[]>;
}

// WHAT workspaceState HOLDS FOR THE STRUCTURE TAB, BY TREE FOLDER NAME
export interface IRecipeCockpitTreeSelections {
    excludedObjectApiNamesByFolderName: Map<string, Set<string>>;
    excludedFieldApiNamesByFolderName: Map<string, Map<string, Set<string>>>;
    // THE RECORD COUNTS THE READER SET (#255), BY TREE FOLDER THEN OBJECT; A COUNT EQUAL TO THE RECIPE'S OWN IS NEVER STORED
    objectCountsByFolderName: Map<string, Map<string, number>>;
    // THE VALUES THE READER FIXED (#262), BY TREE FOLDER, OBJECT THEN FIELD
    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>>;
    // THE FIELDS WHOSE VALIDATION RULES THE READER UNTICKED (#325), BY TREE FOLDER THEN OBJECT; ONLY THE UNTICKS ARE KEPT
    validationRulesOffByFolderName: Map<string, Map<string, Set<string>>>;
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
    validationRulesOff?: IRecipeCockpitFieldReferenceViewModel[];
}

/*
    How a field's inline edit (#337) ended: saved (the card's objectSelection follows) or refused,
    with the reason the panel writes under the editor through textContent. Tagged with the model it
    is about, so an answer for a model no longer on screen is dropped.
*/
export interface IRecipeCockpitFieldEditResultMessage {
    command: 'fieldEditResult';
    renderSequence: number;
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    edit: 'fixedValue';
    refusal?: string;
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

// WHAT workspaceState HOLDS FOR THE DATA SET ROWS, BY DATA SET FOLDER NAME; NEITHER IS A PLAIN {}
export interface IRecipeCockpitDatasetPreferences {
    customNamesByFolderName: Map<string, string>;
    favoriteFolderNames: Set<string>;
}

// A DATA SET'S NAME OR FAVORITE CHANGED: ITS ROW ON EVERY CARD THAT LISTS IT, REDRAWN IN PLACE
export interface IRecipeCockpitDatasetPreferencesMessage {
    command: 'datasetPreferences';
    renderSequence: number;
    datasetFolderName: string;
    customName?: string;
    isFavorite: boolean;
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
    todos?: IRecipeCockpitTodoViewModel[];
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
    todos?: IRecipeCockpitTodoViewModel[];
}

export interface IRecipeSourceObjectIterationEntry {
    nickname: string;
    lineNumber: number;
    parentObjectApiName?: string;
    parentNickname?: string;
    fieldEntries: Map<string, IRecipeSourceFieldEntry>;
    insertableFriendObjectApiNames?: string[];
    todos?: IRecipeCockpitTodoViewModel[];
}

export interface IRecipeSourceFile {
    filePath: string;
    objectEntries: Map<string, IRecipeSourceObjectEntry>;
}

// WHAT A RUN'S BLOCKS WRITE AS RecordTypeId, COLLECTED BY THE SAME SCAN parseRecipeSource MAKES (#195)
export interface IRecipeRecordTypeBlocks {
    developerNamesByObjectApiName: Map<string, string[]>;
    defaultWrittenObjectApiNames: Set<string>;
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
    // THE QUERY TAB (#367): WHICH GENERATED QUERY, THE READER'S TEXT FOR IT, AND AN EXPORT'S FORMAT
    queryKey?: unknown;
    queryText?: unknown;
    exportFormat?: unknown;
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
    applied?: unknown;
    updateSequence?: unknown;
    requestSequence?: unknown;
    recordTypeSelection?: unknown;
    // "Remember this selection" (#196): ONLY true SAVES
    isRemembered?: unknown;
    // A FIELD'S INLINE EDITOR (#337, #356): A FIXED VALUE OR AN EDITED EXPRESSION, AS TYPED -- CHECKED AGAIN BY THE HOST
    value?: unknown;
    min?: unknown;
    max?: unknown;
    // AN IN-PANEL CONFIRMATION'S ANSWER (#349): THE ONE-USE ID IT WAS ASKED WITH, AND THE INDEX OF THE BUTTON CHOSEN
    confirmationId?: unknown;
    choice?: unknown;
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
    each tab's search as typed, whether the org picker was in use and a scroll offset.
    No path, picklist value, org label or username -- normalizePanelPlace keeps nothing else.
*/
export interface IRecipeCockpitPanelTreePlace {
    treeKey: string;
    // WHETHER THE CARD WAS THE ONE ON SCREEN; A CARD NO LONGER FOLDS (#374), SO IT IS WRITTEN FOR AN OLDER READER AND IGNORED ON RESTORE
    isExpanded: boolean;
    selectedTab: RecipeCockpitTreeTab;
    searchQueries: Partial<Record<RecipeCockpitTreeTab, string>>;
    expandedObjectKeys: string[];
    openPicklistKeys: string[];
    // THE DATA SETS TAB'S FAVORITES ONLY; A PLACE SAVED BEFORE IT HAS NONE AND READS AS THE FILTER OFF
    isDatasetFavoritesOnly?: true;
    // THE TREECIPE TAB'S RECORD TYPES SECTION (#321); A PLACE SAVED BEFORE IT HAS NONE AND READS AS COLLAPSED
    isRecordTypesExpanded?: true;
    // THE TREECIPE TAB'S "Record type fields only" CHECK (#320); A PLACE SAVED BEFORE IT HAS NONE AND READS AS OFF
    isRecordTypeFieldsOnly?: true;
    // THE TREECIPE TAB'S "TODOs only" CHECK (#354); A PLACE SAVED BEFORE IT HAS NONE AND READS AS OFF
    isTodosOnly?: true;
    // THE TROUBLESHOOTING SUB-TAB (#365), ONLY WHEN IT IS NOT THE FIRST, AND EACH SUB-TAB'S SEARCH, ONLY WHEN THERE IS ONE
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    troubleshootingSearchQueries?: Partial<Record<RecipeCockpitTroubleshootingSubTab, string>>;
}

export interface IRecipeCockpitPanelPlace {
    version: number;
    runFolderName: string;
    isOrgPickerInUse: boolean;
    // A PLACE SAVED BEFORE #235 HAS NONE, AND READS AS THE FILTER OFF -- WHICH IS WHAT IT WAS
    isFavoritesOnly: boolean;
    // THE HELP SECTION (#332); A PLACE SAVED BEFORE IT HAS NONE AND READS AS COLLAPSED
    isHelpExpanded?: true;
    // THE TREECIPE THE SECTION'S DROPDOWN SHOWS AND THE SECTION SEARCH AS TYPED (#374); A PLACE SAVED BEFORE IT HAS NEITHER AND OPENS ON THE FIRST
    selectedTreeKey?: string;
    treecipesSearchText?: string;
    // NEITHER SECTION FOLDS (#355, #364), SO A 3.98.0+ PLACE'S isOrgSectionCollapsed AND isTreecipesSectionCollapsed ARE IGNORED AND DROPPED
    scrollY: number;
    trees: IRecipeCockpitPanelTreePlace[];
}

export interface IRecipeCockpitTreeFocus {
    treeKey: string;
    tab: RecipeCockpitTreeTab;
    // OPENS THE TREECIPE TAB'S RECORD TYPES SECTION (#321), SCROLLED TO THE OBJECT "Change record types" (#196) IS ABOUT
    recordTypes?: { objectApiName?: string };
    // WITH tab 'troubleshooting': THE SUB-TAB A FAILED INSERT'S "Open Troubleshooting" (#375) SELECTS
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
}

// WHAT AN OPEN OF THE COCKPIT CAN BE ASKED TO FOCUS ONCE ITS RUN IS LOADED
export type RecipeCockpitOpenFocusRequest = IRecipeCockpitRecordTypesFocusRequest | IRecipeCockpitTroubleshootingFocusRequest;

/*
    "Open Troubleshooting" (#375) on a cockpit that was closed or shows another run: the run and the
    tree are NAMES, matched against the run once it is loaded, as "Change record types" (#196) names
    an object. A tree no card has gets no focus.
*/
export interface IRecipeCockpitTroubleshootingFocusRequest {
    runFolderName: string;
    treeFolderName: string;
    troubleshootingSubTab: RecipeCockpitTroubleshootingSubTab;
}

/*
    "Change record types" (#196) opens the cockpit on a Record types section before any model exists, so
    it names an OBJECT and the card is chosen once the run is loaded.
*/
export interface IRecipeCockpitRecordTypesFocusRequest {
    objectApiName?: string;
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
    A failed tree insert's "Open Troubleshooting" (#375) on the model already on screen: the card is
    opened on that tab and sub-tab in place, so the org selection and readiness stay. renderSequence
    names the model, and the panel drops it for any other.
*/
export interface IRecipeCockpitFocusTreeMessage {
    command: 'focusTree';
    focusTree: IRecipeCockpitTreeFocus;
    renderSequence: number;
}

/*
    The authorized orgs the Data-by-Org dropdown offers, as LABELS only: the panel posts back the
    index of the one chosen, and the host looks the username up in the list it holds. A name the
    panel posted would be an org of its choosing; an index can only be one the host offered.
*/
/*
    hiddenOrgNote is RECIPE_COCKPIT_HIDDEN_ORGS_NOTE when any authorized org was left out -- because the
    CLI does not know it to be a sandbox or a scratch org (Data-by-Org lists no production org but the
    CLI's default, #305), or because it does not report it connected -- and empty otherwise. A label
    ending " (default)" is the CLI's default org, always listed first.
    forgottenOrgNotice names the org chosen last when it was forgotten for no longer being connected.
*/
export interface IRecipeCockpitDataOrgListMessage {
    command: 'dataOrgList';
    orgLabels: string[];
    selectedOrgIndex: number | null;
    noOrgsMessage: string;
    hiddenOrgNote: string;
    forgottenOrgNotice: string;
    renderSequence: number;
}

export const RECIPE_COCKPIT_HIDDEN_ORGS_NOTE = "The Treecipe tab lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, plus the CLI's default org, and inserts only into a sandbox or scratch org.";

export const RECIPE_COCKPIT_NO_SANDBOX_ORGS_MESSAGE = 'No sandbox or scratch org is authorized. The Treecipe tab connects only to sandboxes and scratch orgs: authorize one with "sf org login web --instance-url https://test.salesforce.com" and try again.';

// WHAT DATA-BY-ORG SHOWS BESIDE THE DROPDOWN, AND ITS SPINNER, WHILE THE CLI IS ASKED WHICH ORGS ARE CONNECTED
export const RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT = 'Checking org connections…';

// WHAT EVERY TREE'S "Can't insert:" SAYS WHILE THAT CHECK RUNS: THE ORG IN THE DROPDOWN IS NOT CONFIRMED YET (#305)
export const RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON = 'checking the org connection…';

// THE DROPDOWN'S ONE OPTION WHILE THE CHECK RUNS AND NO ORG IS REMEMBERED OR SET AS THE CLI'S DEFAULT
export const RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER = 'Loading orgs…';

export const RECIPE_COCKPIT_DEFAULT_ORG_SUFFIX = ' (default)';

// ONE TURN OF THE ORG CHECK'S SPINNER (#305): A LOOP RATHER THAN A TRANSITION, SO IT IS NOT HELD TO THE 120-180 MS OF MOTION (#227)
export const RECIPE_COCKPIT_SPINNER_ROTATION_MILLISECONDS = 800;

// THE DROPDOWN'S ONE OPTION WHEN THE CHECK ANSWERED WITH NO ORG TO OFFER: IT STAYS DRAWN, AND ⟳ BESIDE IT
export const RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER = 'No org listed';

/*
    The org the dropdown shows while "sf org list" checks the connections (#305): the org chosen
    last, else the CLI's default, read from the local authorization files and config alone. It is
    a LABEL and nothing else -- the panel cannot select it, and nothing is inserted until the list
    answers and the selection's own Organization row says sandbox. requestSequence names the check
    it was read for, so one read for a check since replaced is dropped.
*/
export interface IRecipeCockpitDataOrgProvisionalMessage {
    command: 'dataOrgProvisional';
    orgLabel: string;
    requestSequence: number;
    renderSequence: number;
}

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
    requestSequence: number;
    renderSequence: number;
}

// AN INSERT IN FLIGHT DISABLES ITS OWN TREE'S BUTTON AND DISABLES EVERY OTHER (#375); REPLAYED ON A RELOAD SO A RELOADED DOCUMENT DOES NOT OFFER A SECOND
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

// THE SAME FOR "Wire to…" AND "Wire TODO lookups" (#151): ONE WRITE AT A TIME, REPLAYED ON A REVEAL
export interface IRecipeCockpitWireLookupStateMessage {
    command: 'wireLookupState';
    isRunning: boolean;
}

// A REFUSED REGENERATE (#195): THE PANEL DISABLED THE RECORD TYPES TAB ON THE CLICK, AND ONLY THIS OR A NEW MODEL GIVES IT BACK
export interface IRecipeCockpitRecordTypeRegenerateStateMessage {
    command: 'recordTypeRegenerateState';
    isRunning: false;
}

/*
    The "+ New scratch org" run (#200): while isRunning, the button, every "+ Create" and the org
    dropdown are disabled. How the run went is a notification's, with its "View output" button
    (#301): the panel draws no line for it. Stored and replayed, so a reloaded document holds them.
*/
export interface IRecipeCockpitScratchOrgStateMessage {
    command: 'scratchOrgState';
    isRunning: boolean;
}

/*
    "Assign permission sets to me…" (#274, #302): while isRunning, every tree's insert, every
    assign button and the org picker are disabled. treeKey names the card whose button was clicked.
    It carries no text: how a run went is said in a VS Code notification, whose buttons ("View
    output") are its only follow-up actions. Stored and replayed.
*/
export interface IRecipeCockpitPermissionSetAssignStateMessage {
    command: 'permissionSetAssignState';
    isRunning: boolean;
    treeKey: string;
}

/*
    "Retrieve validation rules…" (#326): while isRunning, every card's retrieve button is disabled.
    treeKey names the card whose button was clicked. It carries no text: how the retrieve went is a
    VS Code notification. Stored and replayed.
*/
export interface IRecipeCockpitValidationRuleRetrieveStateMessage {
    command: 'validationRuleRetrieveState';
    isRunning: boolean;
    treeKey: string;
}

/*
    The Troubleshooting tab's deploys (#346): while isRunning, every deploy button, every insert, the
    assignment, the retrieve and the org picker are disabled. treeKey and deployKind name the button
    clicked. It carries no text: how the deploy went is a VS Code notification. Stored and replayed.
*/
export interface IRecipeCockpitMetadataDeployStateMessage {
    command: 'metadataDeployState';
    isRunning: boolean;
    treeKey: string;
    deployKind: MetadataDeployKind;
}

/*
    What each Troubleshooting section would deploy (#346), read from the project when the tab is
    opened: COUNTS only -- the names are the host's, and are named in the deploy's own confirmation.
    renderSequence names the model it was read for, and the panel drops it for any other.
    failureMessage is set, and every count 0, when the project could not be read.
*/
export interface IRecipeCockpitTroubleshootingSummaryMessage {
    command: 'troubleshootingSummary';
    renderSequence: number;
    treeKey: string;
    permissionSetCount: number;
    customFieldCount: number;
    standardFieldCount: number;
    unreadableFieldCount: number;
    globalValueSetCount: number;
    missingGlobalValueSetCount: number;
    recordTypeCount: number;
    failureMessage?: string;
}

/*
    The Troubleshooting tab's Validation Rules list (#327): per tree object, every rule the project
    holds and what Generate Treecipe did with it, read when the sub-tab is opened. renderSequence
    names the model it was read for, and the panel drops it for any other. failureMessage is set,
    and objects empty, when the objects path or the run's wrapper could not be read.
*/
export interface IRecipeCockpitTreeValidationRulesMessage {
    command: 'treeValidationRules';
    renderSequence: number;
    treeKey: string;
    objects: IValidationRuleListObject[];
    failureMessage?: string;
}

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
}

/*
    "Open in browser" (#279): the panel disabled the button on the click, and this says the open has
    finished -- whether it opened, refused or failed is a notification's, since the URL it opened
    carries a session id and nothing about it is ever posted.
*/
export interface IRecipeCockpitOrgOpenStateMessage {
    command: 'orgOpenState';
    isRunning: boolean;
}

export const RECIPE_COCKPIT_OPEN_ORG_LABEL = 'Open in browser';

/*
    The version and the CHANGELOG link at the top right (#333). The URL is the HOST's: the shell's
    default-src 'none' would make a link in the panel dead, and a URL interpolated into the shell is
    an external reference the shell has none of. The panel posts "openChangelog" with nothing else,
    and this constant is the only address that message can open.
*/
export const RECIPE_COCKPIT_CHANGELOG_URL = 'https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/CHANGELOG.md';

export const RECIPE_COCKPIT_CHANGELOG_LINK_LABEL = 'Open CHANGELOG on GitHub';

// FIXED TEXT: AN ERROR'S OWN MESSAGE IS NEVER QUOTED
export const RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE = 'The Treecipe CHANGELOG was not opened: the browser did not accept the address.';

// A RELEASE VERSION, OR ONE WITH A PRE-RELEASE SUFFIX; ANYTHING ELSE IS NOT POSTED
export const RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX = '0 0 16 16';

// THE GITHUB MARK (OCTICONS mark-github, MIT), DRAWN WITH createElementNS AND FILLED FROM THE PALETTE
export const RECIPE_COCKPIT_GITHUB_GLYPH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

export interface IRecipeCockpitExtensionInfoMessage {
    command: 'extensionInfo';
    version: string;
}

export const RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL = 'Assign permission sets to me…';

export const RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL = 'Assign';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL = 'Generate permission set…';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL = 'Write permission set';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL = 'Open file';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL = 'Copy deploy command';

export const RECIPE_COCKPIT_PERMISSION_SET_PICK_PLACEHOLDER = 'Choose the permission sets to assign to you for this tree';

export const RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER = 'Choose the sandbox or scratch org to assign this tree\'s permission sets in';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL = 'Retrieve validation rules…';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL = 'Retrieve';

// #326: ASKED EVERY TIME, IN THE COMMAND PALETTE, OVER EVERY CONNECTED ORG: A RETRIEVE ONLY READS
export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER = 'Choose the org to retrieve this tree\'s validation rules from';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL = 'Generate Treecipe';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL = 'No validation rules were retrieved: an insert, a permission set assignment or a metadata deploy is running. Try again once it has finished.';

/*
    The Troubleshooting tab's deploys (#346): each section's own button, its confirmation, and what a
    deploy says when another run holds the window. The org is the Treecipe tab's selection or one
    picked from the same non-production list, and must answer that it is a sandbox.
*/
export const RECIPE_COCKPIT_DEPLOY_ACTION_LABELS: Readonly<Record<MetadataDeployKind, string>> = Object.freeze({
    permissionSet: 'Deploy permission set…',
    fields: 'Deploy fields…',
    globalValueSets: 'Deploy global value sets…',
    recordTypes: 'Deploy record types…'
});

export const RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND: Readonly<Record<MetadataDeployKind, string>> = Object.freeze({
    permissionSet: 'deployTreePermissionSet',
    fields: 'deployTreeFields',
    globalValueSets: 'deployTreeGlobalValueSets',
    recordTypes: 'deployTreeRecordTypes'
});

export const RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL = 'Deploy';

export const RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_DEPLOY_PERMISSION_SET_PICK_PLACEHOLDER = 'Choose the permission sets to deploy';

export const RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER = 'Choose the sandbox or scratch org to deploy to';

export const RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL = 'Nothing was deployed: an insert, a scratch org run, a permission set assignment, a validation rule retrieve or another deploy is running. Try again once it has finished.';

export const RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL = 'Troubleshooting';

// HOW MANY TREE SUMMARIES THE HOST KEEPS BEFORE IT STARTS AGAIN
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUMMARY_CACHE_LIMIT = 50;

/*
    The Troubleshooting tab's sub-tabs (#365), left to right; the first is selected until the reader
    picks another, which the place keeps. Each has its own search box. Only the selected one is
    shown, so the tab draws one area at a time.
*/
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS = ['todos', 'fields', 'permissions', 'validationRules', 'recordTypes', 'globalValueSets'] as const;
export type RecipeCockpitTroubleshootingSubTab = typeof RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS[number];
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS: Readonly<Record<RecipeCockpitTroubleshootingSubTab, string>> = Object.freeze({
    todos: 'TODO\'s',
    fields: 'Fields',
    permissions: 'Permissions',
    validationRules: 'Validation Rules',
    recordTypes: 'Record Types',
    globalValueSets: 'Global Value Sets'
});
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS: Readonly<Record<RecipeCockpitTroubleshootingSubTab, string>> = Object.freeze({
    todos: 'Search TODOs by object, field or text',
    fields: 'Search field actions',
    permissions: 'Search permission set actions',
    validationRules: 'Search validation rules by object, rule, field or message',
    recordTypes: 'Search record type actions',
    globalValueSets: 'Search global value set actions'
});
export const RECIPE_COCKPIT_NO_TREE_TODOS_NOTE = 'No TODO comments in this tree\'s recipe.';

/*
    The Validation Rules sub-tab's list (#327): what each rule's status reads as, and the notes the
    list draws. Constants injected into the panel script, written with textContent.
*/
export const RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS = Object.freeze({
    applied: 'Applied',
    notApplied: 'Not applied',
    inactive: 'Inactive',
    notInRun: 'Not in this run',
    unreadable: 'Unreadable'
});
export const RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE = 'Reading this project\'s validation rules…';
export const RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE = 'This project holds no validation rule files for this tree\'s objects. Retrieve validation rules… brings them from an org; run Generate Treecipe afterwards so they shape the recipe.';
export const RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE = 'No validation rules.';
export const RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE = 'Added or activated since Generate Treecipe ran. Run Generate Treecipe to apply it.';
export const RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE = 'This run recorded the rule, and its file is no longer in this project.';
export const RECIPE_COCKPIT_VALIDATION_RULE_NO_FIELDS_NOTE = 'Constrains no field this run read.';
// WHAT A TODO's ENTRY SAYS FOR A FIELD TODO WHOSE TEXT THE PANEL COULD NOT FIND IN THE FIELD'S VALUE
export const RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL = 'TODO in this field\'s value';

export const RECIPE_COCKPIT_QUERY_TAB_LABEL = 'Query';

export const RECIPE_COCKPIT_QUERY_INTRO = 'The SOQL Generate Treecipe wrote for this tree. Edit a query, run it against any connected org you choose, then export what it returned as JSON or CSV. A query only reads.';

export const RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER = 'Choose the org to run the query against (it only reads)';

export const RECIPE_COCKPIT_QUERY_OPEN_FILE_LABEL = 'Open file';

export const RECIPE_COCKPIT_QUERY_CONNECTION_FAILED_ADVICE = 'Log in to it again with sf org login web, then run the query again.';

export const RECIPE_COCKPIT_QUERY_NOT_GIT_IGNORED_NOTE = 'treecipe/QueryResults/.gitignore does not ignore everything in that folder, so this file of org data could be committed: check it before you commit.';

// THE READER'S EDITS OF A TREE'S QUERIES (#367), BY TREE FOLDER, THEN QUERY KEY
export const RECIPE_COCKPIT_QUERY_EDITS_STATE_KEY = 'treecipe.recipeCockpit.queryEdits';

export const RECIPE_COCKPIT_QUERY_EDITS_VERSION = 1;

// HOW MANY TREES' QUERY LISTS THE HOST KEEPS BEFORE IT STARTS AGAIN
export const RECIPE_COCKPIT_QUERY_LIST_CACHE_LIMIT = 50;

// THE LONGEST QUERY KEY A MESSAGE MAY CARRY: <object api name, at most 80>:<kind>:<index>
const RECIPE_COCKPIT_QUERY_KEY_MAX_LENGTH = 200;

export const RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL = 'Create scratch org';

export const RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER = 'Choose the Dev Hub to create the scratch org through';

// #279: THE READER NAMES THE ORG; THERE IS NO DEFAULT ALIAS, SO THE PLACEHOLDER IS ONLY AN EXAMPLE
export const RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PROMPT = 'Alias for the new scratch org: the name the Salesforce CLI, the org picker and later commands will know it by.';

export const RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PLACEHOLDER = 'for example qa-accounts';

export const RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL = 'View output';

export const RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL = 'Copy deploy command';

export const RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT: Record<ScratchOrgSetupPhase | 'listing', string> = {
    creating: 'Creating scratch org…',
    listing: 'Listing the new scratch org…'
};

export type RecipeCockpitHostMessage = IRecipeCockpitLoadPhaseMessage
                                        | IRecipeCockpitRecipeDataMessage
                                        | IRecipeCockpitLoadFailedMessage
                                        | IRecipeCockpitPicklistValuesMessage
                                        | IRecipeCockpitDatasetRecordCountsMessage
                                        | IRecipeCockpitFocusTreeMessage
                                        | IRecipeCockpitDataOrgListMessage
                                        | IRecipeCockpitDataOrgProvisionalMessage
                                        | IRecipeCockpitDataOrgSelectionMessage
                                        | IRecipeCockpitDataOrgReadinessMessage
                                        | IRecipeCockpitInsertStateMessage
                                        | IRecipeCockpitAddFriendStateMessage
                                        | IRecipeCockpitWireLookupStateMessage
                                        | IRecipeCockpitRecordTypeRegenerateStateMessage
                                        | IRecipeCockpitTreePreferencesMessage
                                        | IRecipeCockpitDatasetPreferencesMessage
                                        | IRecipeCockpitObjectSelectionMessage
                                        | IRecipeCockpitFieldEditResultMessage
                                        | IRecipeCockpitScratchOrgStateMessage
                                        | IRecipeCockpitPermissionSetAssignStateMessage
                                        | IRecipeCockpitValidationRuleRetrieveStateMessage
                                        | IRecipeCockpitMetadataDeployStateMessage
                                        | IRecipeCockpitTroubleshootingSummaryMessage
                                        | IRecipeCockpitTreeQueriesMessage
                                        | IRecipeCockpitTreeValidationRulesMessage
                                        | IRecipeCockpitTreeQueryStateMessage
                                        | IRecipeCockpitTreeQueryResultMessage
                                        | IRecipeCockpitOrgOpenStateMessage
                                        | IRecipeCockpitDatasetAddedMessage
                                        | IRecipeCockpitExtensionInfoMessage
                                        | IRecipeCockpitConfirmRequestMessage;

/*
    A confirmation the HOST asks for inside the panel (#349), in place of VS Code's modal. The host
    writes every string and decides what each answer means: the panel only draws the lines with
    textContent and answers with the index of a button it was given, under the one-use id. It is
    never stored or replayed: a reload, a new model, a failure to draw or a closed panel answers
    Cancel, and the action asks again only if the reader starts it again.
*/
export interface IRecipeCockpitConfirmRequestMessage {
    command: 'confirmRequest';
    confirmationId: string;
    renderSequence: number;
    title: string;
    lines: string[];
    buttons: string[];
    // role="alertdialog" FOR AN ACTION THAT WRITES TO AN ORG OR OVERWRITES FILES WITH NO UNDO
    isDestructive: boolean;
}

// A CONFIRMATION ASKED WHILE THE COCKPIT IS HIDDEN (#349): ITS DOCUMENT IS GONE, SO NOTHING COULD SHOW IT
export const RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL = 'The Recipe Cockpit was in the background, so it could not ask you to confirm, and nothing was done. It is shown now: start the action again.';

export interface IRecipeCockpitConfirmOptions {
    detail: string;
    isDestructive?: boolean;
}

interface IRecipeCockpitPendingConfirmation {
    confirmationId: string;
    buttonLabels: string[];
    resolve: (chosenLabel: string | undefined) => void;
}

/*
    One data set an action just wrote, posted IN PLACE of a reload (#226): the cards it joins, its
    history row. How an insert went is its notification's (#301), never the panel's. renderSequence
    names the model it was added to, and the panel drops it for any other. updateSequence is this
    post's own number, echoed back in "partialRendered" once the row is drawn: only that
    acknowledgement makes the new row's Open and Insert… usable, as "rendered" does for a model.
*/
export interface IRecipeCockpitDatasetAddedMessage {
    command: 'datasetAdded';
    treeKeys: string[];
    dataset: IRecipeCockpitTreeDatasetViewModel;
    renderSequence: number;
    updateSequence: number;
}

export const RECIPE_COCKPIT_INSERT_CONFIRM_LABEL = 'Generate and insert';

// THE ONE BUTTON ALWAYS GENERATES AND INSERTS (#375); WHAT STOPS AN INSERT DISABLES IT, AND GENERATING ONLY IS Run Faker by Recipe'S
export const RECIPE_COCKPIT_INSERT_ACTION_LABEL = 'Generate fake data and insert';

// THE ONE REASON THAT LEAVES THE BUTTON ENABLED (#375): A CLICK ASKS FOR THE ORG IN THE COMMAND PALETTE
export const RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON = 'No org is chosen yet.';

export const RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE = 'You will be asked which org to insert into.';

export const RECIPE_COCKPIT_CANNOT_INSERT_PREFIX = 'Can\'t insert: ';

export const RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER = 'Select the sandbox or scratch org to generate this tree into';

export const RECIPE_COCKPIT_INSERT_RUNNING_LABEL = 'Inserting…';

// THE TREE INSERT'S NOTIFICATION BUTTONS (#301): BOTH OPEN THE INSERT'S RESULTS FILE
export const RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL = 'View errors';

export const RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL = 'View results';

// A FAILED INSERT'S OTHER TWO BUTTONS (#375): THE FIRST GENERATED FILE THAT FAILED, AND THE CARD'S TROUBLESHOOTING TAB
export const RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL = 'View failed file';

export const RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL = 'Open Troubleshooting';

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
        Set once this selection's describes have answered and its readiness was posted (#274). A
        permission set assignment in the selection waits for it: a readiness built from describes
        taken BEFORE an assignment, posted after it, would put back the reasons it just removed.
    */
    isReadinessPosted?: boolean;
}

// THE LOADER'S WHOLE ANSWER: WHAT IS POSTED, AND THE PICKLIST VALUES THE PANEL ASKS FOR ONE ROW AT A TIME
export interface IRecipeCockpitLoadedRecipe {
    recipeViewModel: IRecipeCockpitRecipeViewModel;
    picklistDisplayValuesByObjectApiName: RecipeCockpitPicklistDisplayValuesByObjectApiName;
    treeHistoryTargets: IRecipeCockpitTreeHistoryTargets;
    objectLevelsByApiName?: Map<string, number>;
    // WHAT EACH CARD'S FIXED-VALUES FILE PINS (#342), BY TREE FOLDER, THEN OBJECT, THEN FIELD
    pinnedFixedValuesByFolderName?: Map<string, Map<string, Map<string, string>>>;
    // THE WRAPPER THE MODEL WAS READ FROM, WHICH THE QUERY TAB READS AGAIN (#367); UNSET WHEN IT COULD NOT BE READ
    objectsWrapperFilePath?: string;
}

/*
    The allow-lists of the tree cards' actions, one per action, each a set of NAMES drawn from the
    rendered model's trees. The three data set actions are keyed by data set folder name.
*/
export interface IRecipeCockpitTreeHistoryAllowLists {
    openableDatasetFolderNames: Set<string>;
    insertableDatasetFolderNames: Set<string>;
    countableDatasetFolderNames: Set<string>;
    // THE CARDS ✎ AND ☆ ARE DRAWN ON: EVERY CARD WITH A FOLDER, WHICH LEAVES OUT ONLY THE UNGROUPED ONE
    nameableTreeKeys: Set<string>;
    // THE DATA SET ROWS ✎ AND ☆ ARE DRAWN ON: EVERY ROW THE RENDERED HISTORIES LIST
    nameableDatasetFolderNames: Set<string>;
    // "<treeKey>\n<object>" FOR EVERY TREE ICON THE PANEL DRAWS CLICKABLE (#219): A CARD WITH A FOLDER, AN OBJECT IT DRAWS, TOLD APART FROM ANY OTHER OCCURRENCE
    selectableObjectKeys: Set<string>;
    // "<treeKey>\n<object>\n<field>" FOR EVERY FIELD CHECKBOX (#220): A SELECTABLE OBJECT'S FIELDS THAT HAVE A LINE IN THE RECIPE
    selectableFieldKeys: Set<string>;
    // "<object>\n<developerName>" FOR EVERY RECORD TYPE A CARD'S RECORD TYPES TAB OFFERS (#195), AND THE CARDS THAT DRAW THAT TAB
    selectableRecordTypeKeys: Set<string>;
    recordTypeTreeKeys: Set<string>;
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
    | { kind: 'openHelpGuide' }
    | { kind: 'regenerateWithRecordTypes'; treeKey: string; recordTypeSelection: Record<string, string[]>; isRemembered?: true }
    | { kind: 'refuseRecordTypeRegenerate' }
    | { kind: 'postPicklistValues'; hostMessage: IRecipeCockpitPicklistValuesMessage }
    | { kind: 'loadDatasetRecordCounts'; datasetFolderName: string; datasetFolderPath: string; renderSequence: number }
    | { kind: 'openDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'insertDataset'; datasetFolderName: string; datasetFolderPath: string; focusTree?: IRecipeCockpitTreeFocus }
    | { kind: 'promptInsertOrg'; treeKey: string; recipeFilePath: string }
    | { kind: 'loadDataOrgs' }
    | { kind: 'selectDataOrg'; orgIndex: number }
    | { kind: 'refreshDataOrgs' }
    | { kind: 'insertTree'; treeKey: string; recipeFilePath: string }
    | { kind: 'postInsertState'; hostMessage: IRecipeCockpitInsertStateMessage }
    | { kind: 'addIterationFriend'; treeKey: string; objectApiName: string; iterationNickname: string; friendObjectApiName: string; recipeFilePath: string }
    | { kind: 'postAddFriendState'; hostMessage: IRecipeCockpitAddFriendStateMessage }
    | { kind: 'wireLookups'; treeKey: string; recipeFilePath: string; wirings: IRecipeCockpitLookupWiringViewModel[]; isWireAll: boolean }
    | { kind: 'postWireLookupState'; hostMessage: IRecipeCockpitWireLookupStateMessage }
    | { kind: 'addParentObject'; treeKey: string; recipeFilePath: string; addition: IRecipeCockpitAddableParentViewModel }
    | { kind: 'renameTree'; folderName: string }
    | { kind: 'toggleFavoriteTree'; folderName: string }
    | { kind: 'renameDataset'; datasetFolderName: string }
    | { kind: 'toggleFavoriteDataset'; datasetFolderName: string }
    | { kind: 'setObjectIncluded'; treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }
    | { kind: 'setFieldIncluded'; treeKey: string; folderName: string; objectApiName: string; fieldApiName: string; isIncluded: boolean }
    | { kind: 'setAllFieldsIncluded'; treeKey: string; folderName: string; objectApiName: string; isIncluded: boolean }
    | { kind: 'resetTreeSelection'; folderName: string }
    | { kind: 'setObjectCount'; treeKey: string; folderName: string; objectApiName: string; count: number }
    | { kind: 'setFieldFixedValue'; treeKey: string; folderName: string; objectApiName: string; fieldApiName: string; value: string }
    | { kind: 'setFieldValidationRuleApplied'; treeKey: string; folderName: string; objectApiName: string; fieldApiName: string; isApplied: boolean }
    | { kind: 'persistPlace'; place: IRecipeCockpitPanelPlace }
    | { kind: 'createScratchOrg' }
    | { kind: 'postScratchOrgState'; hostMessage: IRecipeCockpitScratchOrgStateMessage }
    | { kind: 'assignTreePermissionSets'; treeKey: string; isSelectedOrg: boolean }
    | { kind: 'generateTreePermissionSet'; treeKey: string }
    | { kind: 'retrieveTreeValidationRules'; treeKey: string }
    | { kind: 'deployTreeMetadataComponents'; treeKey: string; deployKind: MetadataDeployKind; isSelectedOrg: boolean }
    // A REFUSAL WITH A REASON IS A WARNING NOTIFICATION; EVERY ONE GIVES THE CLICKED BUTTON BACK
    | { kind: 'refuseMetadataDeploy'; refusalText?: string; hostMessage: IRecipeCockpitMetadataDeployStateMessage }
    | { kind: 'loadTroubleshootingSummary'; treeKey: string; renderSequence: number }
    | { kind: 'loadTreeQueries'; treeKey: string; renderSequence: number }
    | { kind: 'loadValidationRules'; treeKey: string; renderSequence: number }
    | { kind: 'saveTreeQueryEdit'; treeKey: string; queryKey: string; queryText: string }
    | { kind: 'runTreeQuery'; treeKey: string; queryKey: string; queryText: string }
    | { kind: 'postTreeQueryState'; hostMessage: IRecipeCockpitTreeQueryStateMessage }
    | { kind: 'exportTreeQueryResult'; treeKey: string; queryKey: string; exportFormat: RecipeCockpitQueryExportFormat }
    // A REFUSAL WITH A REASON IS A WARNING NOTIFICATION; EVERY ONE GIVES THE CLICKED BUTTON BACK
    | { kind: 'refuseValidationRuleRetrieve'; refusalText?: string; hostMessage: IRecipeCockpitValidationRuleRetrieveStateMessage }
    // A REFUSAL IS A WARNING NOTIFICATION, AND THE STATE GIVES THE CLICKED BUTTON BACK
    | { kind: 'refusePermissionSetAssign'; refusalText?: string; hostMessage: IRecipeCockpitPermissionSetAssignStateMessage }
    | { kind: 'openDataOrg'; orgDetail: IAuthenticatedOrgDetail }
    | { kind: 'postOrgOpenState'; hostMessage: IRecipeCockpitOrgOpenStateMessage }
    | { kind: 'openChangelog' }
    | { kind: 'answerConfirmation'; confirmationId: string; choice: unknown };

/*
    Everything the host holds for the one panel, replaced wholesale when the panel is (re)opened --
    a reopen keeps only the run on screen, and the request sequence of the Treecipe tab's org
    selection.

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
    // "Open in browser" (#279): ONE "sf org open" AT A TIME, SO A DOUBLE CLICK OPENS ONE TAB
    isOrgOpenInFlight?: boolean;
    isGenerateTreecipeInFlight: boolean;
    pendingIsGenerateTreecipeOffered: boolean;
    isGenerateTreecipeOffered: boolean;
    reportedFailureDescriptions: Set<string>;
    pendingDataOrgObjectApiNames: Set<string>;
    dataOrgObjectApiNames: Set<string>;
    dataOrgDetails: IAuthenticatedOrgDetail[];
    dataOrgUsername?: string;
    dataOrgSelection?: IRecipeCockpitDataOrgSelection;
    dataOrgRequestSequence: number;
    // THE CARDS "Generate fake data and insert" IS DRAWN ON: EVERY CARD THAT CAN GENERATE (#255)
    pendingInsertableTreeKeys: Set<string>;
    insertableTreeKeys: Set<string>;
    insertStateMessage?: IRecipeCockpitInsertStateMessage;
    pendingInsertableFriendTargets: Map<string, string>;
    insertableFriendTargets: Map<string, string>;
    addFriendStateMessage?: IRecipeCockpitAddFriendStateMessage;
    // EVERY "Wire to…" THE MODEL DRAWS, BY CARD, OBJECT, OCCURRENCE AND FIELD (#151), A PENDING/ACTIVE PAIR LIKE THE "+"'s
    pendingWireableLookupTargets: Map<string, IRecipeCockpitLookupWiringTarget>;
    wireableLookupTargets: Map<string, IRecipeCockpitLookupWiringTarget>;
    pendingAddableParentTargets: Map<string, IRecipeCockpitAddableParentTarget>;
    addableParentTargets: Map<string, IRecipeCockpitAddableParentTarget>;
    wireLookupStateMessage?: IRecipeCockpitWireLookupStateMessage;
    // THE "+ New scratch org" RUN (#200)
    scratchOrgStateMessage?: IRecipeCockpitScratchOrgStateMessage;
    /*
        "Assign permission sets to me…" (#274, #302): the cards it is drawn on, every card with a
        folder and an object, a pending/active pair like the insert's. WHICH objects are read from
        the stored model's tree on the host, never from the message.
    */
    pendingAssignableTreeKeys: Set<string>;
    assignableTreeKeys: Set<string>;
    permissionSetAssignStateMessage?: IRecipeCockpitPermissionSetAssignStateMessage;
    // "Retrieve validation rules…" (#326): ONE PER WINDOW, STORED AND REPLAYED LIKE THE ASSIGNMENT'S
    validationRuleRetrieveStateMessage?: IRecipeCockpitValidationRuleRetrieveStateMessage;
    // THE TROUBLESHOOTING TAB'S DEPLOYS (#346): ONE PER WINDOW, STORED AND REPLAYED LIKE THE ASSIGNMENT'S
    metadataDeployStateMessage?: IRecipeCockpitMetadataDeployStateMessage;
    // THE QUERY TAB'S RUN (#367): ONE PER WINDOW, STORED AND REPLAYED LIKE THE RETRIEVE'S
    treeQueryStateMessage?: IRecipeCockpitTreeQueryStateMessage;
    // THE LAST PREVIEW POSTED (#367), REPLAYED WHILE ITS MODEL IS THE ONE ON SCREEN
    treeQueryResultMessage?: IRecipeCockpitTreeQueryResultMessage;
    // HOST-ONLY, REPLACED WITH THE MODEL: THE WRAPPER THE QUERY TAB'S QUERIES ARE READ FROM (#367)
    objectsWrapperFilePath?: string;
    // THE PLACE workspaceState KEPT FOR THIS MODEL (#230), REPLAYED UNTIL THE MODEL'S "rendered" SAYS IT WAS DRAWN
    restorePlace?: IRecipeCockpitPanelPlace;
    /*
        The Record types section "Change record types" opened the panel on (#196). An open posts its model
        before the new document is ready, so like restorePlace it rides on every replay until the
        model's "rendered".
    */
    openFocusTree?: IRecipeCockpitTreeFocus;
    // HOST-ONLY, REPLACED WITH THE MODEL: WHAT A FILTERED COPY NESTS A KEPT FRIEND BY (#219)
    objectLevelsByApiName?: Map<string, number>;
    // HOST-ONLY, REPLACED WITH THE MODEL: WHAT THE CARDS' FIXED-VALUES FILES PIN (#342), WHICH workspaceState NO LONGER HOLDS
    pinnedFixedValuesByFolderName?: Map<string, Map<string, Map<string, string>>>;
    // THE LAST datasetAdded POSTED (#226): ONLY ITS "partialRendered" PROMOTES THE PENDING HISTORY ALLOW-LISTS
    datasetUpdateSequence: number;
    /*
        The model whose "rendered" arrived since the last ready, post or failure to draw -- null until
        then. A "partialRendered" is honoured only over that model: promoting the pending lists of one
        no document has acknowledged would activate its every history action, not just the new row's.
    */
    acknowledgedRenderSequence: number | null;
    // THE INSTALLED VERSION (#333), SET ONLY WHEN IT IS ONE RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN ACCEPTS
    extensionVersion?: string;
}

/*
    How "Assign permission sets to me…" ended (#274, #302): the org it was for, whether the reader
    confirmed it, and whether any pick is now held by the user (so the cards are re-checked). What
    it said is a notification's, never the panel's.
*/
interface IRecipeCockpitPermissionSetClosingState {
    orgDetail?: IAuthenticatedOrgDetail;
    isConfirmed?: boolean;
    isAssigned?: boolean;
}

// HOW A TROUBLESHOOTING DEPLOY ENDED (#346): WHICH ORG'S DESCRIBES OF WHICH OBJECTS TO DROP ONCE THE CLI RAN, AND WHETHER IT LANDED
interface IRecipeCockpitMetadataDeployClosingState {
    cliStartedFor?: { orgDetail: IAuthenticatedOrgDetail; objectApiNames: string[] };
    isDeployed?: boolean;
    // A LANDED DEPLOY'S NOTIFICATION, SHOWN ONCE THE RUN HAS ENDED SO ITS "Assign permission sets to me…" IS NOT REFUSED AS BUSY
    showOutcome?: () => void;
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
        The one confirmation the panel is showing (#349). Held by the HOST only, outside the panel
        state, because answering it Cancel is what replacing that state means.
    */
    private static pendingConfirmation: IRecipeCockpitPendingConfirmation | undefined;

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
                // A TAB ADDED SINCE THE PLACE VERSION (#346) HAS NO SEARCH OF ITS OWN SINCE #365, SO A PLACE READS AS IT DID BEFORE THE TAB
                if ( RECIPE_COCKPIT_TABS_WITHOUT_SEARCH.includes(tabName) ) {
                    return;
                }
                if ( RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS.includes(tabName) && !( this.isBoundedText(candidateQuery) && candidateQuery !== '' ) ) {
                    return;
                }
                searchQueries[tabName] = this.isBoundedText(candidateQuery) ? candidateQuery : '';
            });

            const candidateSelectedTab = readTabName(candidateTree.selectedTab);
            const selectedTab = RECIPE_COCKPIT_TREE_TABS.find(tabName => tabName === candidateSelectedTab) ?? 'treecipe';

            // THE FIRST SUB-TAB IS THE DEFAULT, SO IT IS NEVER WRITTEN; AN UNKNOWN ONE READS AS IT
            const troubleshootingSubTab = RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.slice(1).find(subTab => subTab === candidateTree.troubleshootingSubTab);
            const storedSubTabQueries = this.isPlainRecord(candidateTree.troubleshootingSearchQueries) ? candidateTree.troubleshootingSearchQueries : {};
            const troubleshootingSearchQueries: Partial<Record<RecipeCockpitTroubleshootingSubTab, string>> = {};
            RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.forEach(subTab => {
                const candidateQuery = Object.prototype.hasOwnProperty.call(storedSubTabQueries, subTab) ? storedSubTabQueries[subTab] : undefined;
                if ( this.isBoundedText(candidateQuery) && candidateQuery !== '' ) {
                    troubleshootingSearchQueries[subTab] = candidateQuery;
                }
            });

            return [{
                treeKey: candidateTree.treeKey,
                isExpanded: candidateTree.isExpanded === true,
                selectedTab: selectedTab,
                searchQueries: searchQueries,
                expandedObjectKeys: this.normalizePlaceNames(candidateTree.expandedObjectKeys),
                openPicklistKeys: this.normalizePlaceNames(candidateTree.openPicklistKeys),
                ...( candidateTree.isDatasetFavoritesOnly === true ? { isDatasetFavoritesOnly: true as const } : {} ),
                // A CARD SAVED ON THE RECORD TYPES TAB, BEFORE IT BECAME A SECTION (#321), OPENS WITH THE SECTION EXPANDED
                ...( candidateTree.isRecordTypesExpanded === true || candidateTree.selectedTab === 'recordTypes' ? { isRecordTypesExpanded: true as const } : {} ),
                ...( candidateTree.isRecordTypeFieldsOnly === true ? { isRecordTypeFieldsOnly: true as const } : {} ),
                ...( candidateTree.isTodosOnly === true ? { isTodosOnly: true as const } : {} ),
                ...( troubleshootingSubTab !== undefined ? { troubleshootingSubTab: troubleshootingSubTab } : {} ),
                ...( Object.keys(troubleshootingSearchQueries).length > 0 ? { troubleshootingSearchQueries: troubleshootingSearchQueries } : {} )
            }];

        });

        const normalizedPlace: IRecipeCockpitPanelPlace = {
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: runFolderName,
            isOrgPickerInUse: candidatePlace.isOrgPickerInUse === true,
            isFavoritesOnly: candidatePlace.isFavoritesOnly === true,
            ...( candidatePlace.isHelpExpanded === true ? { isHelpExpanded: true as const } : {} ),
            ...( this.isBoundedText(candidatePlace.selectedTreeKey) && candidatePlace.selectedTreeKey !== '' ? { selectedTreeKey: candidatePlace.selectedTreeKey } : {} ),
            ...( this.isBoundedText(candidatePlace.treecipesSearchText) && candidatePlace.treecipesSearchText !== '' ? { treecipesSearchText: candidatePlace.treecipesSearchText } : {} ),
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

        return this.readNamePreferences(workspaceState, RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_TREE_PREFERENCES_VERSION,
            trimmedName => this.describeTreeNameProblem(trimmedName));

    }

    // A FAILED WRITE IS SAID ONCE, AND THE CARDS ARE LEFT AS THEY WERE: A NAME THE NEXT OPEN WOULD NOT SHOW IS NOT ONE TO DRAW NOW
    static async writeTreePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined, treePreferences: IRecipeCockpitTreePreferences): Promise<boolean> {

        return this.writeNamePreferences(workspaceState, RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_TREE_PREFERENCES_VERSION, treePreferences, 'tree');

    }

    // THE DATA SET ROWS' NAMES AND FAVORITES, READ AND CHECKED BY THE SAME RULE AS THE CARDS'
    static readDatasetPreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined): IRecipeCockpitDatasetPreferences {

        return this.readNamePreferences(workspaceState, RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION,
            trimmedName => this.describeDatasetNameProblem(trimmedName));

    }

    static async writeDatasetPreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined, datasetPreferences: IRecipeCockpitDatasetPreferences): Promise<boolean> {

        return this.writeNamePreferences(workspaceState, RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY, RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION, datasetPreferences, 'data set');

    }

    private static readNamePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined,
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

        if ( !this.isPlainRecord(storedPreferences) || storedPreferences.version !== stateVersion ) {
            return namePreferences;
        }

        const storedCustomNames = this.isPlainRecord(storedPreferences.customNames) ? storedPreferences.customNames : {};

        Object.keys(storedCustomNames).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const customName = storedCustomNames[folderName];
            if ( this.isBoundedText(folderName) && folderName !== '' && typeof customName === 'string'
                    && customName !== '' && customName === customName.trim() && describeNameProblem(customName) === undefined ) {
                namePreferences.customNamesByFolderName.set(folderName, customName);
            }
        });

        this.normalizePlaceNames(storedPreferences.favoriteFolderNames).forEach(folderName => namePreferences.favoriteFolderNames.add(folderName));

        return namePreferences;

    }

    private static async writeNamePreferences(workspaceState: IRecipeCockpitWorkspaceState | undefined,
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
    private static describeTreeNameProblem(trimmedName: string): string | undefined {

        return this.describeCustomNameProblem(trimmedName, 'A tree name', RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH);

    }

    private static describeDatasetNameProblem(trimmedName: string): string | undefined {

        return this.describeCustomNameProblem(trimmedName, 'A data set name', RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH);

    }

    private static describeCustomNameProblem(trimmedName: string, nameLabel: string, maxLength: number): string | undefined {

        if ( /[\p{Cc}\u2028\u2029]/u.test(trimmedName) ) {
            return `${nameLabel} must be one line, with no control characters.`;
        }

        if ( trimmedName.length > maxLength ) {
            return `${nameLabel} can be at most ${maxLength} characters.`;
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
        What the input box says is wrong with a data set's name. An empty name clears it. A
        name is unique against every OTHER data set's name in the workspace and every other row's
        folder name on screen, trimmed and without case: two rows a reader cannot tell apart are
        what a name exists to prevent.
    */
    static validateDatasetName(candidateName: string,
                                datasetFolderName: string,
                                datasetPreferences: IRecipeCockpitDatasetPreferences,
                                trees: IRecipeCockpitTreeViewModel[]): string | undefined {

        const trimmedName = candidateName.trim();

        if ( trimmedName === '' ) {
            return undefined;
        }

        const namingProblem = this.describeDatasetNameProblem(trimmedName);

        if ( namingProblem ) {
            return namingProblem;
        }

        const comparableName = trimmedName.toLowerCase();
        const otherNames: string[] = [];

        datasetPreferences.customNamesByFolderName.forEach((customName, namedFolderName) => {
            if ( namedFolderName !== datasetFolderName ) { otherNames.push(customName); }
        });

        trees.forEach(tree => (tree.history?.datasets ?? [])
            .filter(dataset => dataset.datasetFolderName !== datasetFolderName)
            .forEach(dataset => otherNames.push(dataset.datasetFolderName, dataset.customName ?? '')));

        return otherNames.some(otherName => otherName.trim().toLowerCase() === comparableName)
            ? 'Another data set already has that name.'
            : undefined;

    }

    // THE NAMES AND FAVORITES ONTO EVERY DATA SET ROW OF EVERY CARD, IN PLACE
    static applyDatasetPreferences(trees: IRecipeCockpitTreeViewModel[], datasetPreferences: IRecipeCockpitDatasetPreferences): IRecipeCockpitTreeViewModel[] {

        trees.forEach(tree => (tree.history?.datasets ?? []).forEach(dataset => this.applyPreferencesToDataset(dataset, datasetPreferences)));

        return trees;

    }

    static applyPreferencesToDataset(dataset: IRecipeCockpitTreeDatasetViewModel, datasetPreferences: IRecipeCockpitDatasetPreferences) {

        delete dataset.customName;
        delete dataset.isFavorite;

        const customName = datasetPreferences.customNamesByFolderName.get(dataset.datasetFolderName);

        if ( customName !== undefined ) {
            dataset.customName = customName;
        }

        if ( datasetPreferences.favoriteFolderNames.has(dataset.datasetFolderName) ) {
            dataset.isFavorite = true;
        }

    }

    static buildDatasetPreferencesMessage(datasetFolderName: string,
                                            datasetPreferences: IRecipeCockpitDatasetPreferences,
                                            renderSequence: number): IRecipeCockpitDatasetPreferencesMessage {

        const customName = datasetPreferences.customNamesByFolderName.get(datasetFolderName);

        return {
            command: 'datasetPreferences',
            renderSequence: renderSequence,
            datasetFolderName: datasetFolderName,
            ...( customName !== undefined ? { customName: customName } : {} ),
            isFavorite: datasetPreferences.favoriteFolderNames.has(datasetFolderName)
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
            fixedValuesByFolderName: new Map(),
            validationRulesOffByFolderName: new Map()
        };
        let storedSelections: unknown;

        try {
            storedSelections = workspaceState?.get<unknown>(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        } catch {
            return treeSelections;
        }

        const readableVersions: unknown[] = [RECIPE_COCKPIT_OBJECT_SELECTION_VERSION, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS, RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS];
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

        // A FIXED VALUE IS IN THE RECIPE FILE SINCE #342, AND FAKER BOUNDS ARE GONE SINCE #356, SO NEITHER IS READ FROM AN OLDER ENTRY
        const hasCounts = storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS
                            && storedSelections.version !== RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS;
        const hasValidationRules = storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION || storedSelections.version === RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS;
        const storedCountsByFolderName = hasCounts ? storedSelections.objectCountsByFolderName : undefined;
        const storedValidationRulesOffByFolderName = hasValidationRules ? storedSelections.validationRulesOffByFolderName : undefined;

        // THE SAME SHAPE AS THE UNTICKED FIELDS, READ THE SAME WAY (#325)
        const readFieldNamesByFolderName = (storedByFolder: unknown, readInto: Map<string, Map<string, Set<string>>>) => {
            if ( !this.isPlainRecord(storedByFolder) ) {
                return;
            }
            Object.keys(storedByFolder).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
                const storedByObject = storedByFolder[folderName];
                if ( !isUsableFolderName(folderName) || !this.isPlainRecord(storedByObject) ) {
                    return;
                }
                const fieldNamesByObject = new Map<string, Set<string>>();
                Object.keys(storedByObject).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(objectApiName => {
                    const fieldApiNames = this.normalizePlaceNames(storedByObject[objectApiName]).filter(fieldApiName => SalesforceApiName.isApiName(fieldApiName));
                    if ( SalesforceApiName.isApiName(objectApiName) && fieldApiNames.length > 0 ) {
                        fieldNamesByObject.set(objectApiName, new Set(fieldApiNames));
                    }
                });
                if ( fieldNamesByObject.size > 0 ) {
                    readInto.set(folderName, fieldNamesByObject);
                }
            });
        };

        readFieldNamesByFolderName(storedValidationRulesOffByFolderName, treeSelections.validationRulesOffByFolderName);

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

        readFieldNamesByFolderName(storedFieldsByFolderName, treeSelections.excludedFieldApiNamesByFolderName);

        return treeSelections;

    }

    static readObjectSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined): Map<string, Set<string>> {
        return this.readTreeSelections(workspaceState).excludedObjectApiNamesByFolderName;
    }

    static async writeTreeSelections(workspaceState: IRecipeCockpitWorkspaceState | undefined, treeSelections: IRecipeCockpitTreeSelections): Promise<boolean> {

        if ( !workspaceState ) {
            VSCodeWorkspaceService.showWarningMessage('The Recipe Cockpit has no workspace to keep excluded objects, unticked fields, record counts and validation rule choices in. Open a folder and re-open the cockpit.');
            return false;
        }

        // fromEntries DEFINES EACH KEY, SO A FOLDER OR OBJECT NAMED __proto__ IS STORED RATHER THAN SET AS A PROTOTYPE
        const storedByFolderName: Record<string, string[]> = Object.fromEntries(
            [...treeSelections.excludedObjectApiNamesByFolderName]
                .filter(([, excludedObjectApiNames]) => excludedObjectApiNames.size > 0)
                .map(([folderName, excludedObjectApiNames]) => [folderName, [...excludedObjectApiNames]])
        );
        const toStoredFieldNames = (fieldNamesByFolderName: Map<string, Map<string, Set<string>>>): Record<string, Record<string, string[]>> => Object.fromEntries(
            [...fieldNamesByFolderName]
                .map(([folderName, fieldNamesByObject]) => [folderName, Object.fromEntries(
                    [...fieldNamesByObject]
                        .filter(([, fieldApiNames]) => fieldApiNames.size > 0)
                        .map(([objectApiName, fieldApiNames]) => [objectApiName, [...fieldApiNames]])
                )] as [string, Record<string, string[]>])
                .filter(([, storedByObject]) => Object.keys(storedByObject).length > 0)
        );
        const storedFieldsByFolderName = toStoredFieldNames(treeSelections.excludedFieldApiNamesByFolderName);
        const storedCountsByFolderName: Record<string, Record<string, number>> = Object.fromEntries(
            [...treeSelections.objectCountsByFolderName]
                .filter(([, countsByObject]) => countsByObject.size > 0)
                .map(([folderName, countsByObject]) => [folderName, Object.fromEntries(countsByObject)])
        );
        try {
            await workspaceState.update(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY, {
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
                excludedObjectApiNamesByFolderName: storedByFolderName,
                excludedFieldApiNamesByFolderName: storedFieldsByFolderName,
                objectCountsByFolderName: storedCountsByFolderName,
                validationRulesOffByFolderName: toStoredFieldNames(treeSelections.validationRulesOffByFolderName)
            });
            return true;
        } catch (writeError) {
            VSCodeWorkspaceService.showWarningMessage(`The excluded objects, unticked fields, record counts and validation rule choices could not be saved: ${RecipeYamlScalar.escapeForNotification(String(writeError?.message ?? writeError))}`);
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
            fixedValuesByFolderName: storedSelections.fixedValuesByFolderName,
            validationRulesOffByFolderName: storedSelections.validationRulesOffByFolderName
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
                                    fixedValuesByFolderName: Map<string, Map<string, Map<string, string>>> = new Map(),
                                    validationRulesOffByFolderName: Map<string, Map<string, Set<string>>> = new Map()): IRecipeCockpitTreeViewModel[] {

        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            if ( onlyFolderName !== undefined && tree.folderName !== onlyFolderName ) {
                return;
            }

            delete tree.objectSelection;
            delete tree.fieldSelection;
            delete tree.objectCounts;
            delete tree.fixedValues;
            delete tree.validationRulesOff;

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

            // AFTER THE FIXED VALUES, WHICH LOCK A FIELD'S RULES
            const validationRulesOff = this.buildTreeValidationRulesOff(objectsByApiName, tree, validationRulesOffByFolderName.get(tree.folderName));

            if ( validationRulesOff.length > 0 ) {
                tree.validationRulesOff = validationRulesOff;
            }

        });

        return recipeViewModel.trees;

    }

    // workspaceState'S SELECTIONS WITH THE PINS THE FIXED-VALUES FILES HOLD (#342) IN PLACE OF ANY IT KEPT
    static withPinnedFixedValues(treeSelections: IRecipeCockpitTreeSelections, pinnedFixedValuesByFolderName: Map<string, Map<string, Map<string, string>>> | undefined): IRecipeCockpitTreeSelections {
        return { ...treeSelections, fixedValuesByFolderName: pinnedFixedValuesByFolderName ?? new Map() };
    }

    /*
        What a card's fixed-values file (#342) pins, read beside its recipe: only a file inside the
        workspace, and only a field whose every recorded occurrence still holds the line the pin
        wrote -- one edited by hand since is the reader's line now, so it is not drawn as pinned, and
        a notice says so. A file that is there and cannot be read pins nothing, with a notice.
    */
    static readPinnedFixedValues(recipeFilePath: string, workspaceRoot: string, recipeText: string | undefined): { valuesByObject: Map<string, Map<string, string>>; notices: string[] } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const fixedValueFileLabel = path.basename(fixedValueFilePath);
        const fixedValueRead = this.readFixedValueFile(fixedValueFilePath, workspaceRoot);

        if ( fixedValueRead.isUnreadable ) {
            return { valuesByObject: new Map(), notices: [`"${fixedValueFileLabel}" is not a fixed-values file the Recipe Cockpit can read, so no field of its recipe is shown as pinned.`] };
        }
        if ( fixedValueRead.entries.length === 0 || recipeText === undefined ) {
            return { valuesByObject: new Map(), notices: [] };
        }

        // ONE SCAN FOR EVERY PIN OF THE FILE: A CHECK PER PIN OVER THE WHOLE RECIPE WAS ~200 ms EACH AT 11,000 OBJECTS
        const changedFlags = RecipeCockpitRecipeWriter.listChangedPinnedFields(recipeText, fixedValueRead.entries.map(entry => ({
            objectApiName: entry.objectApiName,
            fieldApiName: entry.fieldApiName,
            restoreRequests: this.buildPinnedFieldRestoreRequests(entry, undefined)
        })));
        const changedFieldLabels = fixedValueRead.entries.filter((_entry, entryIndex) => changedFlags[entryIndex]).map(entry => `${entry.objectApiName}.${entry.fieldApiName}`);
        const currentEntries = fixedValueRead.entries.filter((_entry, entryIndex) => !changedFlags[entryIndex]);

        return {
            valuesByObject: RecipeCockpitFixedValueStore.listValuesByObject(currentEntries),
            notices: changedFieldLabels.length > 0
                ? [`${changedFieldLabels.join(', ')} ${changedFieldLabels.length === 1 ? 'was' : 'were'} changed in the recipe since ${changedFieldLabels.length === 1 ? 'it was' : 'they were'} pinned, so ${changedFieldLabels.length === 1 ? 'it is' : 'they are'} not shown as pinned. "${fixedValueFileLabel}" still holds the earlier ${changedFieldLabels.length === 1 ? 'value' : 'values'}.`]
                : []
        };

    }

    // NO FILE IS NO ENTRIES; ONE OUTSIDE THE WORKSPACE IS NEVER READ
    static readFixedValueFile(fixedValueFilePath: string, workspaceRoot: string): IFixedValueFileRead {

        if ( !this.isUsableWorkspacePath(fixedValueFilePath, workspaceRoot) ) {
            return { entries: [], isUnreadable: false };
        }

        try {
            return RecipeCockpitFixedValueStore.parse(fs.readFileSync(fixedValueFilePath, 'utf-8'));
        } catch {
            return { entries: [], isUnreadable: true };
        }

    }

    // EACH RECORDED OCCURRENCE, WITH ITS ORIGINAL LINES WHEN THE FILE KEPT THEM AND THE RE-DERIVED VALUE OTHERWISE
    static buildPinnedFieldRestoreRequests(entry: IFixedValueEntry, fallbackValueText: string | undefined): IPinnedFieldRestoreRequest[] {
        return entry.occurrences.map(occurrence => ({
            occurrenceIndex: occurrence.occurrenceIndex,
            ...( occurrence.nickname !== undefined ? { nickname: occurrence.nickname } : {} ),
            writtenLine: occurrence.writtenLine,
            ...( occurrence.originalText !== undefined ? { originalText: occurrence.originalText } : {} ),
            ...( occurrence.originalText === undefined && fallbackValueText !== undefined ? { valueText: fallbackValueText } : {} )
        }));
    }

    static applyTreeSelections(recipeViewModel: IRecipeCockpitRecipeViewModel, treeSelections: IRecipeCockpitTreeSelections): IRecipeCockpitTreeViewModel[] {
        return this.applyObjectSelections(recipeViewModel, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, undefined, treeSelections.objectCountsByFolderName, treeSelections.fixedValuesByFolderName, treeSelections.validationRulesOffByFolderName);
    }

    // THE KIND A FIELD'S FIXED VALUE IS WRITTEN AS (#262), FROM ITS METADATA TYPE; A FIELD OF NO KNOWN TYPE IS TEXT
    static getFixedValueKind(fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        if ( fieldViewModel.fieldType === 'Checkbox' ) {
            return 'boolean';
        }
        return RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES.includes(fieldViewModel.fieldType) || this.findGeolocationComponent(fieldViewModel) !== undefined ? 'number' : 'text';
    }

    // AN EDITED "${{ ... }}" IS AN EXPRESSION (#356), ANYTHING ELSE A LITERAL OF THE FIELD'S OWN KIND
    static resolveFixedValueKind(value: string, fieldViewModel: IRecipeCockpitFieldViewModel): RecipeFixedValueKind {
        return value.startsWith(RECIPE_COCKPIT_EXPRESSION_OPENER) ? 'expression' : this.getFixedValueKind(fieldViewModel);
    }

    // Latitude OR Longitude FOR A CUSTOM GEOLOCATION FIELD'S COMPONENT, WHICH GENERATE TREECIPE LISTS AS Text
    static findGeolocationComponent(fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {
        return fieldViewModel.fieldType === 'Text'
            ? Object.keys(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES).find(componentKey => fieldViewModel.fieldApiName.endsWith(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[componentKey].suffix))
            : undefined;
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
                    kind: this.resolveFixedValueKind(storedByField.get(fieldViewModel.fieldApiName) as string, fieldViewModel)
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
        Why a field's validation-rule checkbox is disabled (#325), or undefined when it can be clicked:
        a field with no applied rule draws no box at all, and one generation leaves out (its object
        excluded, the field unticked or its parent excluded) or writes a fixed value for has nothing
        the rules would shape. Every other #220 lock keeps the field generated, so it is no reason
        here. The panel draws the same rule from the same model.
    */
    static findValidationRuleLockReason(tree: IRecipeCockpitTreeViewModel, objectViewModel: IRecipeCockpitObjectViewModel, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( !this.hasSwitchableValidationRules(fieldViewModel) ) {
            return RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL;
        }
        if ( this.listExcludedObjectApiNames(tree).includes(objectViewModel.objectApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON;
        }

        const objectFieldSelection = ( tree.fieldSelection?.objects ?? [] ).find(candidate => candidate.objectApiName === objectViewModel.objectApiName);
        const lockedField = objectFieldSelection?.lockedFields.find(candidate => candidate.fieldApiName === fieldViewModel.fieldApiName);

        if ( lockedField?.reason === RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON ) {
            return lockedField.reason;
        }
        if ( objectFieldSelection?.excludedFieldApiNames.includes(fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON;
        }
        if ( ( tree.fixedValues ?? [] ).some(fixedValue => fixedValue.objectApiName === objectViewModel.objectApiName && fixedValue.fieldApiName === fieldViewModel.fieldApiName) ) {
            return RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON;
        }
        return undefined;

    }

    // A FIELD OF A CARD AS THE MODEL ON SCREEN DRAWS IT -- WITH A LINE IN THE RECIPE -- OR undefined
    static findDrawnField(recipeViewModel: IRecipeCockpitRecipeViewModel | undefined, treeKey: string, objectApiName: string, fieldApiName: string):
        { tree: IRecipeCockpitTreeViewModel; objectViewModel: IRecipeCockpitObjectViewModel; fieldViewModel: IRecipeCockpitFieldViewModel } | undefined {

        const tree = recipeViewModel?.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const objectViewModel = recipeViewModel?.objects.find(candidateObject => candidateObject.objectApiName === objectApiName);
        const fieldViewModel = objectViewModel?.fields.find(candidateField => candidateField.fieldApiName === fieldApiName && candidateField.lineNumber !== undefined);

        return tree && objectViewModel && fieldViewModel ? { tree: tree, objectViewModel: objectViewModel, fieldViewModel: fieldViewModel } : undefined;

    }

    static hasSwitchableValidationRules(fieldViewModel: IRecipeCockpitFieldViewModel): boolean {
        return fieldViewModel.lineNumber !== undefined && ( fieldViewModel.validationRules?.appliedRuleNames.length ?? 0 ) > 0;
    }

    /*
        The rule-shaped fields a card generates WITHOUT their rules (#325): those the reader unticked.
        Only fields a box is drawn for and no lock holds back; a held-back untick stays stored and
        comes back.
    */
    static buildTreeValidationRulesOff(objectsByApiName: ReadonlyMap<string, IRecipeCockpitObjectViewModel>,
                                        tree: IRecipeCockpitTreeViewModel,
                                        storedRulesOffByObject: ReadonlyMap<string, ReadonlySet<string>> | undefined): IRecipeCockpitFieldReferenceViewModel[] {

        if ( !storedRulesOffByObject || storedRulesOffByObject.size === 0 ) {
            return [];
        }

        return this.collectSelectableObjectApiNames(objectsByApiName, tree).flatMap(objectApiName => {

            const objectViewModel = objectsByApiName.get(objectApiName) as IRecipeCockpitObjectViewModel;
            const storedFieldApiNames = storedRulesOffByObject.get(objectApiName);
            const listedFieldApiNames = new Set<string>();

            // THE CHEAP "IS IT SWITCHED OFF" TEST FIRST, SO A CARD WITH NOTHING OFF NEVER SCANS ITS FIELDS FOR DUPLICATES
            return objectViewModel.fields
                .filter(fieldViewModel => !!storedFieldApiNames?.has(fieldViewModel.fieldApiName)
                                            && this.hasSwitchableValidationRules(fieldViewModel)
                                            && !listedFieldApiNames.has(fieldViewModel.fieldApiName)
                                            && this.findValidationRuleLockReason(tree, objectViewModel, fieldViewModel) === undefined
                                            && !!listedFieldApiNames.add(fieldViewModel.fieldApiName))
                .map(fieldViewModel => ({ objectApiName: objectApiName, fieldApiName: fieldViewModel.fieldApiName }));

        });

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
            const valuesByField = unconstrainedValuesByObject.get(fieldReference.objectApiName) ?? new Map<string, IRecipeUnconstrainedValue>();
            valuesByField.set(fieldReference.fieldApiName, { constrainedValue: validationRules.recipeValue, unconstrainedValue: validationRules.unconstrainedRecipeValue });
            unconstrainedValuesByObject.set(fieldReference.objectApiName, valuesByField);
        });

        return unconstrainedValuesByObject;

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

        const kind = this.resolveFixedValueKind(value, fieldViewModel);
        const writerRefusal = RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: kind });

        // AN EXPRESSION IS NOT A VALUE OF THE FIELD'S TYPE, SO THE WRITER'S SHAPE IS ALL THERE IS TO HOLD IT TO
        if ( kind === 'expression' ) {
            return writerRefusal === undefined ? undefined : `This expression ${writerRefusal} Type one \${{ ... }} on one line, or a value with no \${{.`;
        }

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

        const geolocationComponent = this.findGeolocationComponent(fieldViewModel);
        if ( geolocationComponent !== undefined ) {
            const limit = RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES[geolocationComponent].limit;
            if ( Math.abs(Number(value)) > limit ) {
                return `A ${geolocationComponent.toLowerCase()} is a number from -${limit} to ${limit}.`;
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
        All / None (#220). The panel no longer draws the buttons (#343); the route stays, held to the
        same allow-list, so they can come back by drawing them again. None stores every field with a line in the recipe except those a lock
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
        A field's pin (#262), saved from its inline editor (#337) and, since #342, written into the
        card's recipe FILE. The panel posts the value as typed, so it is checked here against the
        field the model on screen holds NOW -- the same check the editor's own refusal comes from. A
        value pins the field: its lines become the value on every occurrence of its object, and the
        lines they replaced go into the fixed-values file beside the recipe. '' is Clear, which puts
        those lines back. Either asks in a modal first and shares the one recipe write lock with a
        wiring and an added parent; a write reloads the card, every other ending is answered under the
        editor. A field a lock holds back, or no longer drawn, writes nothing and is answered nothing.
    */
    private static async setFieldFixedValue(cockpitPanel: vscode.WebviewPanel,
                                            panelState: IRecipeCockpitPanelState,
                                            panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldFixedValue' }>) {

        const drawnField = this.recipeCockpitPanelState === panelState
            ? this.findDrawnField(panelState.recipeDataMessage?.recipe, panelAction.treeKey, panelAction.objectApiName, panelAction.fieldApiName)
            : undefined;
        if ( !drawnField || drawnField.tree.folderName !== panelAction.folderName || drawnField.fieldViewModel.lineNumber === undefined
                || this.findFixedValueLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
            return;
        }

        if ( panelState.wireLookupStateMessage ) {
            this.postFieldEditResult(cockpitPanel, panelState, panelAction, 'fixedValue', RECIPE_COCKPIT_FIELD_EDIT_WRITE_RUNNING_REFUSAL);
            return;
        }

        const declaredPicklistValues = this.listDeclaredPicklistValues(panelState, panelAction.objectApiName, panelAction.fieldApiName);
        const valueRefusal = panelAction.value === '' ? undefined : this.validateFixedValueInput(panelAction.value, drawnField.fieldViewModel, declaredPicklistValues);
        if ( valueRefusal !== undefined ) {
            this.postFieldEditResult(cockpitPanel, panelState, panelAction, 'fixedValue', valueRefusal);
            return;
        }

        const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(panelAction.treeKey);
        if ( !recipeFilePath ) {
            this.postFieldEditResult(cockpitPanel, panelState, panelAction, 'fixedValue', 'Not saved: this card has no single recipe file to write the value into.');
            return;
        }

        let writeRefusal: string | undefined;
        await this.runRecipeLookupWrite(cockpitPanel, panelState, panelAction.treeKey, async () => {
            const writeOutcome = panelAction.value === ''
                ? await this.clearFixedValueFromRecipe(recipeFilePath, panelState.workspaceRoot, drawnField.objectViewModel, drawnField.fieldViewModel)
                : await this.writeFixedValueToRecipe(recipeFilePath, panelState.workspaceRoot, panelAction.objectApiName, panelAction.fieldApiName, { value: panelAction.value, kind: this.resolveFixedValueKind(panelAction.value, drawnField.fieldViewModel) });
            writeRefusal = writeOutcome.refusal;
            return writeOutcome.isWritten;
        });

        if ( writeRefusal !== undefined ) {
            this.postFieldEditResult(cockpitPanel, panelState, panelAction, 'fixedValue', writeRefusal);
        }

    }

    /*
        Pins a field in the recipe file (#342). The fixed-values file is written FIRST and put back as
        it was when the recipe cannot be, so a recipe never holds a pin that file cannot clear. A
        fixed-values file that is there and cannot be read is never overwritten -- it may be a pin the
        reader still needs -- and one that is a link is never written through.
    */
    private static async writeFixedValueToRecipe(recipeFilePath: string,
                                                    workspaceRoot: string,
                                                    objectApiName: string,
                                                    fieldApiName: string,
                                                    fixedValue: IRecipeFixedValue): Promise<{ isWritten: boolean; refusal?: string }> {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const fixedValueFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(fixedValueFilePath));
        const fieldLabel = `${RecipeYamlScalar.escapeForNotification(objectApiName)}.${RecipeYamlScalar.escapeForNotification(fieldApiName)}`;

        const planned = this.planFixedValueWrite(recipeFilePath, workspaceRoot, objectApiName, fieldApiName, fixedValue);
        if ( 'refusal' in planned ) {
            return { isWritten: false, refusal: planned.refusal };
        }

        const editLabel = fixedValue.kind === 'expression' ? 'an edited faker expression' : 'a fixed value';
        const confirmation = await this.confirmInPanel(
            `Write ${editLabel} into ${objectApiName}.${fieldApiName}?`,
            {
                detail: [
                    `This writes to "${path.basename(recipeFilePath)}": ${objectApiName}.${fieldApiName} becomes ${RecipeCockpitRecipeWriter.toFixedValueScalar(fixedValue)} on every ${objectApiName} in it, so Run Faker by Recipe generates it from the palette too. Every other line of the file is left as it is.`,
                    '',
                    `The lines it replaces are kept in "${path.basename(fixedValueFilePath)}" beside the recipe, so Clear can put them back exactly.`
                ].join('\n')
            },
            RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_FIXED_VALUE_SAVE_CONFIRM_LABEL ) {
            return { isWritten: false, refusal: RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL };
        }

        // PLANNED AGAIN AFTER THE MODAL: EITHER FILE CAN HAVE CHANGED WHILE IT WAS OPEN
        const confirmed = this.planFixedValueWrite(recipeFilePath, workspaceRoot, objectApiName, fieldApiName, fixedValue);
        if ( 'refusal' in confirmed ) {
            return { isWritten: false, refusal: confirmed.refusal };
        }

        const writeRefusal = this.writeRecipeWithFixedValueFile(recipeFilePath, confirmed.recipeText, fixedValueFilePath, confirmed.entries);
        if ( writeRefusal !== undefined ) {
            return { isWritten: false, refusal: writeRefusal };
        }

        VSCodeWorkspaceService.showInformationMessage(`Wrote the ${fixedValue.kind === 'expression' ? 'edited expression' : 'fixed value'} of ${fieldLabel} into "${recipeFileLabel}".`);
        return { isWritten: true };

    }

    private static planFixedValueWrite(recipeFilePath: string,
                                        workspaceRoot: string,
                                        objectApiName: string,
                                        fieldApiName: string,
                                        fixedValue: IRecipeFixedValue): { recipeText: string; entries: IFixedValueEntry[] } | { refusal: string } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const located = this.readFixedValueTarget(recipeFilePath, fixedValueFilePath, workspaceRoot);
        if ( 'refusal' in located ) {
            return located;
        }

        const pinResult = RecipeCockpitRecipeWriter.pinField(located.recipeText, objectApiName, fieldApiName, fixedValue);
        if ( 'refusal' in pinResult ) {
            return { refusal: `Not saved: ${pinResult.refusal.message}` };
        }

        return {
            recipeText: pinResult.recipeText,
            entries: RecipeCockpitFixedValueStore.upsertEntry(located.entries, { objectApiName: objectApiName, fieldApiName: fieldApiName, value: fixedValue.value, occurrences: pinResult.occurrences })
        };

    }

    /*
        Clear (#342): the lines the fixed-values file recorded go back on every occurrence it pinned.
        An occurrence it holds no usable lines for gets the field's value as Generate Treecipe
        wrote it instead -- the objects wrapper's own, or, for a standard field the wrapper does not
        list, the recipe backend's mapping -- and the modal says it is re-derived rather than put back.
    */
    private static async clearFixedValueFromRecipe(recipeFilePath: string,
                                                    workspaceRoot: string,
                                                    objectViewModel: IRecipeCockpitObjectViewModel,
                                                    fieldViewModel: IRecipeCockpitFieldViewModel): Promise<{ isWritten: boolean; refusal?: string }> {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const fixedValueFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(fixedValueFilePath));
        const fieldLabel = `${RecipeYamlScalar.escapeForNotification(objectViewModel.objectApiName)}.${RecipeYamlScalar.escapeForNotification(fieldViewModel.fieldApiName)}`;
        const fallbackValueText = this.resolveFixedValueFallback(recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel);

        const planned = this.planFixedValueClear(recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel.fieldApiName, fallbackValueText);
        if ( 'refusal' in planned ) {
            return { isWritten: false, refusal: planned.refusal };
        }

        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const dialogFieldLabel = `${objectViewModel.objectApiName}.${fieldViewModel.fieldApiName}`;
        const confirmation = await this.confirmInPanel(
            `Clear the edit of ${dialogFieldLabel}?`,
            {
                detail: [
                    planned.isRederived
                        ? `This writes to "${path.basename(recipeFilePath)}": "${path.basename(fixedValueFilePath)}" has no recorded lines for ${dialogFieldLabel}, so it gets back the value Generate Treecipe wrote for it rather than the exact lines it had. Every other line of the file is left as it is.`
                        : `This writes to "${path.basename(recipeFilePath)}": ${dialogFieldLabel} gets back the lines it had before it was pinned, recorded in "${path.basename(fixedValueFilePath)}". Every other line of the file is left as it is.`,
                    '',
                    'It puts back:',
                    this.buildRestorePreview(planned.previewText)
                ].join('\n')
            },
            RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_FIXED_VALUE_CLEAR_CONFIRM_LABEL ) {
            return { isWritten: false, refusal: RECIPE_COCKPIT_FIELD_EDIT_CANCELLED_REFUSAL };
        }

        const confirmed = this.planFixedValueClear(recipeFilePath, workspaceRoot, objectViewModel.objectApiName, fieldViewModel.fieldApiName, fallbackValueText);
        if ( 'refusal' in confirmed ) {
            return { isWritten: false, refusal: confirmed.refusal };
        }
        if ( confirmed.isRederived !== planned.isRederived || confirmed.previewText !== planned.previewText ) {
            return { isWritten: false, refusal: `Not saved: "${path.basename(fixedValueFilePath)}" changed while the dialog was open.` };
        }

        const writeRefusal = this.writeRecipeWithFixedValueFile(recipeFilePath, confirmed.recipeText, fixedValueFilePath, confirmed.entries);
        if ( writeRefusal !== undefined ) {
            return { isWritten: false, refusal: writeRefusal };
        }

        VSCodeWorkspaceService.showInformationMessage(`Cleared the fixed value of ${fieldLabel} in "${recipeFileLabel}".`);
        return { isWritten: true };

    }

    private static planFixedValueClear(recipeFilePath: string,
                                        workspaceRoot: string,
                                        objectApiName: string,
                                        fieldApiName: string,
                                        fallbackValueText: string | undefined): { recipeText: string; entries: IFixedValueEntry[]; isRederived: boolean; previewText: string } | { refusal: string } {

        const fixedValueFilePath = RecipeCockpitFixedValueStore.buildFilePath(recipeFilePath);
        const located = this.readFixedValueTarget(recipeFilePath, fixedValueFilePath, workspaceRoot);
        if ( 'refusal' in located ) {
            return located;
        }

        const entry = RecipeCockpitFixedValueStore.findEntry(located.entries, objectApiName, fieldApiName);
        if ( !entry ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" holds no fixed value for ${objectApiName}.${fieldApiName}.` };
        }

        const isRederived = entry.occurrences.some(occurrence => occurrence.originalText === undefined);
        if ( isRederived && fallbackValueText === undefined ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" has no recorded lines for ${objectApiName}.${fieldApiName}, and there is no value Generate Treecipe wrote for it to put back instead.` };
        }

        const restoreResult = RecipeCockpitRecipeWriter.restorePinnedField(located.recipeText, objectApiName, fieldApiName, this.buildPinnedFieldRestoreRequests(entry, fallbackValueText));
        if ( 'refusal' in restoreResult ) {
            return { refusal: `Not saved: ${restoreResult.refusal.message}` };
        }

        return {
            recipeText: restoreResult.recipeText,
            entries: RecipeCockpitFixedValueStore.removeEntry(located.entries, objectApiName, fieldApiName),
            isRederived: isRederived,
            // WHAT THE MODAL SHOWS: THE FIRST RECORDED LINES, ELSE THE RE-DERIVED VALUE -- A CHANGE ONLY TO THE FIXED-VALUES FILE IS NOT PUT BACK UNSEEN
            previewText: entry.occurrences.find(occurrence => occurrence.originalText !== undefined)?.originalText ?? `${fieldApiName}: ${fallbackValueText}`
        };

    }

    /*
        The value a field is re-derived to when no lines were recorded for it: the objects wrapper's
        own recipe value, which is what Generate Treecipe wrote for the field by its type, size,
        picklist values and validation rules, or, for a standard field the wrapper never lists, the
        value the recipe's own backend maps it to. undefined when neither has one.
    */
    static resolveFixedValueFallback(recipeFilePath: string, workspaceRoot: string, objectApiName: string, fieldViewModel: IRecipeCockpitFieldViewModel): string | undefined {

        if ( !fieldViewModel.isOnlyInRecipeFile ) {
            return fieldViewModel.recipeValue !== '' ? fieldViewModel.recipeValue : undefined;
        }

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const fakerService = VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath);
        if ( !fakerService ) {
            return undefined;
        }

        const standardFieldValues = ( fakerService === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService() ).getOOTBObjectApiNameToFieldApiNameMap();
        const valuesByField = Object.prototype.hasOwnProperty.call(standardFieldValues, objectApiName) ? standardFieldValues[objectApiName] : undefined;
        return valuesByField && Object.prototype.hasOwnProperty.call(valuesByField, fieldViewModel.fieldApiName) ? valuesByField[fieldViewModel.fieldApiName] : undefined;

    }

    // LINES AS THE IN-PANEL CONFIRMATION SHOWS THEM (#349): ONE PER LINE, LEFT-ALIGNED, CUT SHORT PAST A SCREEN'S WORTH
    static buildRestorePreview(previewText: string): string {

        const previewLines = previewText.split(/\r\n|\n/);
        const commonIndent = Math.min(...previewLines.filter(previewLine => previewLine.trim() !== '').map(previewLine => RecipeCockpitRecipeWriter.countIndent(previewLine)));
        const shownLines = previewLines.slice(0, RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES)
            .map(previewLine => previewLine.slice(Math.min(commonIndent, RecipeCockpitRecipeWriter.countIndent(previewLine))));
        const previewBody = shownLines.join('\n');
        const isCut = previewLines.length > RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LINES || previewBody.length > RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH;

        return isCut ? `${previewBody.slice(0, RECIPE_COCKPIT_RESTORE_PREVIEW_MAX_LENGTH)}\n…` : previewBody;

    }

    // THE RECIPE'S TEXT AND THE FIXED-VALUES FILE'S ENTRIES, OR WHY NEITHER IS TO BE WRITTEN
    private static readFixedValueTarget(recipeFilePath: string, fixedValueFilePath: string, workspaceRoot: string): { recipeText: string; entries: IFixedValueEntry[] } | { refusal: string } {

        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            return { refusal: `Not saved: "${path.basename(recipeFilePath)}" no longer exists in this workspace. Re-open the Recipe Cockpit to load the runs currently on disk.` };
        }
        if ( this.isLinkPath(fixedValueFilePath) || ( fs.existsSync(fixedValueFilePath) && !this.isUsableWorkspacePath(fixedValueFilePath, workspaceRoot) ) ) {
            return { refusal: `Not saved: "${path.basename(fixedValueFilePath)}" is a link or is outside this workspace, so it is not written.` };
        }

        const fixedValueRead = this.readFixedValueFile(fixedValueFilePath, workspaceRoot);
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

    private static writeRecipeWithFixedValueFile(recipeFilePath: string, recipeText: string, fixedValueFilePath: string, entries: IFixedValueEntry[]): string | undefined {

        const previousFixedValueText = fs.existsSync(fixedValueFilePath) ? fs.readFileSync(fixedValueFilePath, 'utf-8') : undefined;

        try {
            if ( entries.length > 0 ) {
                this.writeFileReplacing(fixedValueFilePath, RecipeCockpitFixedValueStore.serialize(entries));
            } else if ( previousFixedValueText !== undefined ) {
                fs.unlinkSync(fixedValueFilePath);
            }
        } catch (writeError) {
            return `Not saved: "${path.basename(fixedValueFilePath)}" could not be written (${String(writeError?.message ?? writeError)}).`;
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
                // THE RECIPE IS UNCHANGED, SO A FIXED-VALUES FILE LEFT AHEAD OF IT SHOWS ITS FIELDS AS CHANGED SINCE THEY WERE PINNED, NOT AS PINNED
            }
            return `Not saved: "${path.basename(recipeFilePath)}" could not be written (${String(writeError?.message ?? writeError)}).`;
        }

    }

    // HOW AN INLINE EDIT (#337) ENDED, FOR THE MODEL STILL ON SCREEN ONLY
    private static postFieldEditResult(cockpitPanel: vscode.WebviewPanel,
                                        panelState: IRecipeCockpitPanelState,
                                        panelAction: { treeKey: string; objectApiName: string; fieldApiName: string },
                                        edit: 'fixedValue',
                                        refusal: string | undefined) {

        const recipeDataMessage = panelState.recipeDataMessage;
        if ( !recipeDataMessage || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        this.postToPanel(cockpitPanel, {
            command: 'fieldEditResult',
            renderSequence: recipeDataMessage.renderSequence,
            treeKey: panelAction.treeKey,
            objectApiName: panelAction.objectApiName,
            fieldApiName: panelAction.fieldApiName,
            edit: edit,
            ...( refusal !== undefined ? { refusal: refusal } : {} )
        });

    }

    /*
        A field's validation-rule checkbox (#325): the untick is stored, a tick removes it. The router
        matched the field and its lock rule against the model on screen, and nothing is awaited
        between that and this write, so there is nothing to re-derive.
    */
    private static async setFieldValidationRuleApplied(cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        panelAction: Extract<RecipeCockpitPanelAction, { kind: 'setFieldValidationRuleApplied' }>) {

        const treeSelections = this.readTreeSelections(this.recipeCockpitWorkspaceState);
        this.setStoredValidationRuleOff(treeSelections, panelAction.folderName, panelAction.objectApiName, panelAction.fieldApiName, !panelAction.isApplied);

        // THE RULES SHAPE A VALUE, NEVER WHICH FIELDS THE INSERT SENDS, SO THE ORG'S READINESS NEED NOT BE CHECKED AGAIN
        await this.saveAndPostTreeSelections(cockpitPanel, panelState, panelAction.folderName, treeSelections, false);

    }

    static setStoredValidationRuleOff(treeSelections: IRecipeCockpitTreeSelections, folderName: string, objectApiName: string, fieldApiName: string, isOff: boolean) {

        const rulesOffByObject = treeSelections.validationRulesOffByFolderName.get(folderName) ?? new Map<string, Set<string>>();
        const rulesOffFieldApiNames = rulesOffByObject.get(objectApiName) ?? new Set<string>();

        if ( isOff ) {
            rulesOffFieldApiNames.add(fieldApiName);
        } else {
            rulesOffFieldApiNames.delete(fieldApiName);
        }
        rulesOffByObject.set(objectApiName, rulesOffFieldApiNames);
        treeSelections.validationRulesOffByFolderName.set(folderName, rulesOffByObject);

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
                && !treeSelections.validationRulesOffByFolderName.has(folderName) ) {
            return;
        }

        const tree = panelState.recipeDataMessage?.recipe.trees.find(candidateTree => candidateTree.folderName === folderName);
        const treeLabel = tree?.customName ?? tree?.title ?? folderName;
        const confirmation = await this.confirmInPanel(
            `Reset the selection of ${treeLabel}?`,
            { detail: 'Every object is included, every field is ticked, every record count goes back to the recipe\'s own again and every validation rule is applied again. The recipe file is not changed, so an edit written into it stays: clear it with its field\'s edit button.' },
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
        currentSelections.validationRulesOffByFolderName.delete(folderName);

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
                                                    isReadinessAffected = true): Promise<boolean> {

        const isWritten = await this.writeTreeSelections(this.recipeCockpitWorkspaceState, treeSelections);
        const recipeDataMessage = panelState.recipeDataMessage;

        if ( !isWritten || !recipeDataMessage || this.recipeCockpitPanelState !== panelState ) {
            return isWritten;
        }

        // ONLY THIS FOLDER'S CARDS CHANGED, SO ONLY THEY ARE RECOMPUTED; THEIR PINS ARE THE ONES THEIR FIXED-VALUES FILES HELD AT LOAD (#342)
        this.applyObjectSelections(recipeDataMessage.recipe, treeSelections.excludedObjectApiNamesByFolderName, treeSelections.excludedFieldApiNamesByFolderName, folderName, treeSelections.objectCountsByFolderName, panelState.pinnedFixedValuesByFolderName ?? new Map(), treeSelections.validationRulesOffByFolderName);

        recipeDataMessage.recipe.trees
            .filter(tree => tree.folderName === folderName)
            .forEach(tree => this.postToPanel(cockpitPanel, {
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: tree.treeKey,
                ...( tree.objectSelection ? { objectSelection: tree.objectSelection } : {} ),
                ...( tree.fieldSelection ? { fieldSelection: tree.fieldSelection } : {} ),
                ...( tree.objectCounts ? { objectCounts: tree.objectCounts } : {} ),
                ...( tree.fixedValues ? { fixedValues: tree.fixedValues } : {} ),
                ...( tree.validationRulesOff ? { validationRulesOff: tree.validationRulesOff } : {} )
            }));

        const isOrgCheckIdle = !panelState.scratchOrgStateMessage?.isRunning && !panelState.insertStateMessage?.isRunning;
        if ( isOrgCheckIdle && isReadinessAffected ) {
            await this.refreshDataOrgReadinessForFolder(cockpitPanel, panelState, folderName);
        }

        return true;

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
                                        recipeViewModel: IRecipeCockpitRecipeViewModel): IRecipeCockpitRunFakerFilteredRecipe | { refusalMessage: string } {

        const excludedObjectApiNames = this.listExcludedObjectApiNames(tree);
        const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);
        const objectCountsByObject = this.listObjectCountsByObject(tree);
        const fixedValuesByObject = this.listFixedValuesByObject(tree);
        const unconstrainedValuesByObject = this.listUnconstrainedValuesByObject(recipeViewModel, tree);
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
            nameableTreeKeys: new Set(),
            nameableDatasetFolderNames: new Set(),
            selectableObjectKeys: new Set(),
            selectableFieldKeys: new Set(),
            selectableRecordTypeKeys: new Set(),
            recordTypeTreeKeys: new Set()
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

        if ( !this.isPlainRecord(openOptions) || openOptions.focusRecordTypes !== true ) {
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

        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);
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
    static collectTreeHistoryAllowLists(recipeViewModel: IRecipeCockpitRecipeViewModel): IRecipeCockpitTreeHistoryAllowLists {

        const treeHistoryAllowLists = this.buildEmptyTreeHistoryAllowLists();
        const objectsByApiName = this.buildObjectsByApiName(recipeViewModel);

        recipeViewModel.trees.forEach(tree => {

            tree.objects
                .map(treeObject => objectsByApiName.get(treeObject.objectApiName))
                .filter((objectViewModel): objectViewModel is IRecipeCockpitObjectViewModel => !!objectViewModel?.recordTypes)
                .forEach(objectViewModel => {
                    treeHistoryAllowLists.recordTypeTreeKeys.add(tree.treeKey);
                    objectViewModel.recordTypes.forEach(recordType => treeHistoryAllowLists.selectableRecordTypeKeys.add(this.buildSelectableRecordTypeKey(objectViewModel.objectApiName, recordType.developerName)));
                });

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
            pendingInsertableFriendTargets: new Map(),
            insertableFriendTargets: new Map(),
            pendingWireableLookupTargets: new Map(),
            wireableLookupTargets: new Map(),
            pendingAddableParentTargets: new Map(),
            addableParentTargets: new Map(),
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

        this.adoptScratchOrgRunState(this.recipeCockpitPanelState);
        this.adoptPermissionSetAssignRunState(this.recipeCockpitPanelState);
        this.adoptValidationRuleRetrieveRunState(this.recipeCockpitPanelState);
        this.adoptMetadataDeployRunState(this.recipeCockpitPanelState);
        this.adoptTreeQueryRunState(this.recipeCockpitPanelState);
        this.recipeCockpitPanelState.isOrgOpenInFlight = this.isOrgOpenInFlightForWindow;

        if ( previousPanelState ) {
            // THE SEQUENCE A NEW SELECTION MUST STAY ABOVE
            this.recipeCockpitPanelState.dataOrgRequestSequence = previousPanelState.dataOrgRequestSequence;
            // A SCRATCH ORG RUN OUTLIVES THE RELOAD, AND WHAT IT HOLDS DISABLED GOES WITH IT
            this.recipeCockpitPanelState.scratchOrgStateMessage = previousPanelState.scratchOrgStateMessage;
            // SO DOES A PERMISSION SET ASSIGNMENT'S (#274)
            this.recipeCockpitPanelState.permissionSetAssignStateMessage = previousPanelState.permissionSetAssignStateMessage;
            // AND A VALIDATION RULE RETRIEVE'S (#326)
            this.recipeCockpitPanelState.validationRuleRetrieveStateMessage = previousPanelState.validationRuleRetrieveStateMessage;
            // AND A METADATA DEPLOY'S (#346)
            this.recipeCockpitPanelState.metadataDeployStateMessage = previousPanelState.metadataDeployStateMessage;
            // AND A QUERY RUN'S (#367)
            this.recipeCockpitPanelState.treeQueryStateMessage = previousPanelState.treeQueryStateMessage;
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
                this.recipeCockpitMessageSubscription?.dispose();
                this.recipeCockpitMessageSubscription = undefined;
                this.recipeCockpitPanel = undefined;
                this.recipeCockpitPanelState = this.buildInitialPanelState('');
                this.clearHeldTreeQueryResult();
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
    private static async loadRecipeIntoPanel(cockpitPanel: vscode.WebviewPanel,
                                                workspaceRoot: string,
                                                requestedRunFolderName?: string,
                                                focusTree?: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest,
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
        Asks the reader inside the panel (#349), answering as showWarningMessage's modal did: the
        label of the button chosen, or undefined for Cancel. Only over a model the panel confirmed
        drawing; with none on screen, or no panel, it is Cancel at once. A newer request answers the
        open one Cancel first, so the reader sees what they asked for last. Every caller re-plans and
        re-checks its guards after the answer, as it did after the modal.
    */
    static confirmInPanel(message: string, confirmOptions: IRecipeCockpitConfirmOptions, ...buttonLabels: string[]): Promise<string | undefined> {

        this.cancelPendingConfirmation();

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;
        const drawnRenderSequence = panelState.recipeDataMessage?.renderSequence;

        if ( !cockpitPanel || !panelState.isPanelReady || drawnRenderSequence === undefined || panelState.acknowledgedRenderSequence !== drawnRenderSequence ) {
            return Promise.resolve(undefined);
        }

        // A HIDDEN WEBVIEW HAS NO DOCUMENT (retainContextWhenHidden IS OFF), SO A POST TO IT IS DROPPED AND THE ACTION WOULD WAIT ON NOTHING
        if ( cockpitPanel.visible === false ) {
            cockpitPanel.reveal();
            VSCodeWorkspaceService.showWarningMessage(RECIPE_COCKPIT_CONFIRM_HIDDEN_REFUSAL);
            return Promise.resolve(undefined);
        }

        const confirmationId = crypto.randomBytes(16).toString('hex');

        return new Promise(resolve => {

            this.pendingConfirmation = { confirmationId: confirmationId, buttonLabels: [...buttonLabels], resolve: resolve };

            this.postToPanel(cockpitPanel, {
                command: 'confirmRequest',
                confirmationId: confirmationId,
                renderSequence: drawnRenderSequence,
                title: message,
                lines: confirmOptions.detail.split(/\r\n|\r|\n/),
                buttons: [...buttonLabels],
                isDestructive: confirmOptions.isDestructive === true
            });

        });

    }

    private static cancelPendingConfirmation() {

        const pendingConfirmation = this.pendingConfirmation;
        this.pendingConfirmation = undefined;
        pendingConfirmation?.resolve(undefined);

    }

    // SPENT ONCE; AN INDEX THE HOST DID NOT OFFER IS CANCEL
    private static settlePendingConfirmation(confirmationId: string, choice: unknown) {

        const pendingConfirmation = this.pendingConfirmation;

        if ( !pendingConfirmation || pendingConfirmation.confirmationId !== confirmationId ) {
            return;
        }

        this.pendingConfirmation = undefined;

        const isOfferedChoice = typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < pendingConfirmation.buttonLabels.length;
        pendingConfirmation.resolve(isOfferedChoice ? pendingConfirmation.buttonLabels[choice] : undefined);

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
        this.applyDatasetPreferences(recipeViewModel.trees, this.readDatasetPreferences(this.recipeCockpitWorkspaceState));
        this.applyTreeSelections(recipeViewModel, this.withPinnedFixedValues(this.readTreeSelections(this.recipeCockpitWorkspaceState), loadedRecipe.pinnedFixedValuesByFolderName));
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
        panelState.objectsWrapperFilePath = loadedRecipe.objectsWrapperFilePath;
        panelState.treeQueryResultMessage = undefined;
        // A RESULT IS EXPORTED ONLY FROM THE MODEL IT WAS RUN ON, SO A NEW ONE LETS IT GO
        this.clearHeldTreeQueryResult();
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
        panelState.pendingAssignableTreeKeys = new Set(this.collectAssignableTreeKeys(recipeViewModel));
        panelState.assignableTreeKeys = new Set();
        // A "+" OF THE OLD MODEL NAMES AN ITERATION THE NEW ONE'S ROWS MAY NOT DRAW WHERE IT WAS
        panelState.pendingInsertableFriendTargets = this.collectInsertableFriendTargets(recipeViewModel);
        panelState.insertableFriendTargets = new Map();
        panelState.pendingWireableLookupTargets = this.collectWireableLookupTargets(recipeViewModel, panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.wireableLookupTargets = new Map();
        panelState.pendingAddableParentTargets = this.collectAddableParentTargets(recipeViewModel, panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey);
        panelState.addableParentTargets = new Map();
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
                // A RELOADED DOCUMENT DREW NO DIALOG, AND ONE IS NEVER REPLAYED: THE ACTION IS CANCELLED
                this.cancelPendingConfirmation();
                panelState.openableSourceKeys = new Set();
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
                panelState.acknowledgedRenderSequence = null;
                panelState.dataOrgSelection = undefined;
                panelState.dataOrgRequestSequence++;
                panelAction.hostMessages.forEach(hostMessage => cockpitPanel.webview.postMessage(hostMessage));
                return;

            case 'activateActions':

                // DRAWN: THE PANEL'S OWN getState HOLDS THE PLACE FROM HERE ON, AND A REVEAL MUST NOT RE-OPEN THE FOCUSED TAB
                panelState.restorePlace = undefined;
                panelState.openFocusTree = undefined;
                panelState.openableSourceKeys = panelState.pendingOpenableSourceKeys;
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
                panelState.acknowledgedRenderSequence = panelState.recipeDataMessage.renderSequence;
                return;

            case 'activateDatasetActions':

                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                return;

            case 'answerConfirmation':
                this.settlePendingConfirmation(panelAction.confirmationId, panelAction.choice);
                return;

            case 'reportRenderFailure': {

                panelState.reportedFailureDescriptions.add(panelAction.failureDescription);

                // ONLY A FAILURE TO DRAW EMPTIES THE ALLOW-LISTS -- A THROW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN
                if ( panelAction.invalidatesPanel ) {
                    this.cancelPendingConfirmation();
                    panelState.openableSourceKeys = new Set();
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
                    panelState.acknowledgedRenderSequence = null;
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

            case 'selectRun':

                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, panelAction.runFolderName);
                return;

            case 'generateTreecipe':

                await this.generateTreecipeAndReload(cockpitPanel, panelState);
                return;

            case 'openHelpGuide':

                await vscode.env.openExternal(vscode.Uri.parse(RECIPE_COCKPIT_HELP_GUIDE_URL, true));
                return;

            case 'regenerateWithRecordTypes':

                if ( panelAction.isRemembered ) {
                    this.saveRecordTypeSelection(panelState, panelAction.recordTypeSelection);
                }

                await this.generateTreecipeAndReload(cockpitPanel, panelState, {
                    generateTreecipeOptions: { ...RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS, recordTypeSelection: panelAction.recordTypeSelection },
                    focusTree: { treeKey: panelAction.treeKey, tab: 'treecipe', recordTypes: {} }
                });
                return;

            case 'refuseRecordTypeRegenerate':

                this.postToPanel(cockpitPanel, { command: 'recordTypeRegenerateState', isRunning: false });
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

            case 'promptInsertOrg':

                await this.insertTreeIntoPromptedOrg(cockpitPanel, panelState, panelAction);
                return;

            case 'postInsertState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'addIterationFriend':

                await this.addFriendToIteration(cockpitPanel, panelState, panelAction);
                return;

            case 'postAddFriendState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'wireLookups':

                await this.wireLookupsFromPanel(cockpitPanel, panelState, panelAction);
                return;

            case 'postWireLookupState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'addParentObject':

                await this.addParentObjectFromPanel(cockpitPanel, panelState, panelAction);
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

            case 'setFieldValidationRuleApplied':

                await this.setFieldValidationRuleApplied(cockpitPanel, panelState, panelAction);
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

            case 'renameDataset':

                await this.renameDataset(cockpitPanel, panelState, panelAction.datasetFolderName);
                return;

            case 'toggleFavoriteDataset': {

                const datasetPreferences = this.readDatasetPreferences(this.recipeCockpitWorkspaceState);

                if ( datasetPreferences.favoriteFolderNames.has(panelAction.datasetFolderName) ) {
                    datasetPreferences.favoriteFolderNames.delete(panelAction.datasetFolderName);
                } else {
                    datasetPreferences.favoriteFolderNames.add(panelAction.datasetFolderName);
                }

                await this.saveAndPostDatasetPreferences(cockpitPanel, panelState, panelAction.datasetFolderName, datasetPreferences);
                return;

            }

            case 'createScratchOrg':

                await this.createScratchOrgFromPanel(cockpitPanel);
                return;

            case 'postScratchOrgState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'assignTreePermissionSets':

                await this.assignTreePermissionSetsFromPanel(cockpitPanel, panelAction.treeKey, panelAction.isSelectedOrg);
                return;

            case 'generateTreePermissionSet':

                await this.generateTreePermissionSetFromPanel(cockpitPanel, panelAction.treeKey);
                return;

            case 'retrieveTreeValidationRules':

                await this.retrieveTreeValidationRulesFromPanel(cockpitPanel, panelAction.treeKey);
                return;

            case 'refuseValidationRuleRetrieve':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'deployTreeMetadataComponents':

                await this.deployTreeMetadataFromPanel(cockpitPanel, panelAction.treeKey, panelAction.deployKind, panelAction.isSelectedOrg);
                return;

            case 'refuseMetadataDeploy':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'loadTroubleshootingSummary':

                await this.postTroubleshootingSummary(cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'loadTreeQueries':

                this.postTreeQueries(cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'loadValidationRules':

                await this.postTreeValidationRules(cockpitPanel, panelAction.treeKey, panelAction.renderSequence);
                return;

            case 'saveTreeQueryEdit':

                await this.saveTreeQueryEdit(panelAction.treeKey, panelAction.queryKey, panelAction.queryText);
                return;

            case 'runTreeQuery':

                await this.runTreeQueryFromPanel(cockpitPanel, panelAction.treeKey, panelAction.queryKey, panelAction.queryText);
                return;

            case 'postTreeQueryState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'exportTreeQueryResult':

                this.exportTreeQueryResult(panelAction.treeKey, panelAction.queryKey, panelAction.exportFormat);
                return;

            case 'refusePermissionSetAssign':

                if ( panelAction.refusalText ) {
                    VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(panelAction.refusalText));
                }
                this.postToPanel(cockpitPanel, panelAction.hostMessage);
                return;

            case 'openDataOrg':

                await this.openDataOrgInBrowser(panelState, panelAction.orgDetail);
                return;

            case 'openChangelog':

                await this.openChangelogInBrowser();
                return;

            case 'postOrgOpenState':

                this.postToPanel(cockpitPanel, panelAction.hostMessage);
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

    // A DATA SET'S NAME, ASKED FOR AND CHECKED AS A CARD'S IS: BY THE BOX AS IT IS TYPED, AND AGAIN WHEN IT CLOSES
    private static async renameDataset(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, datasetFolderName: string) {

        const shownTrees = panelState.recipeDataMessage?.recipe.trees ?? [];
        const datasetPreferences = this.readDatasetPreferences(this.recipeCockpitWorkspaceState);
        // THE INPUT BOX DRAWS [label](command:...) IN ITS PROMPT AS A LINK THAT RUNS THE COMMAND, AND THE FOLDER NAME COMES FROM DISK
        const folderLabel = RecipeYamlScalar.escapeForNotification(datasetFolderName);

        const enteredName = await vscode.window.showInputBox({
            title: 'Rename data set',
            prompt: `A name for the data set in "${folderLabel}", unique in this workspace. Leave it empty to show it by its folder name again. The folder is not renamed.`,
            placeHolder: datasetFolderName,
            value: datasetPreferences.customNamesByFolderName.get(datasetFolderName) ?? '',
            validateInput: candidateName => this.validateDatasetName(candidateName, datasetFolderName, datasetPreferences, shownTrees)
        });

        if ( enteredName === undefined || this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState ) {
            return;
        }

        const latestDatasetPreferences = this.readDatasetPreferences(this.recipeCockpitWorkspaceState);
        const namingProblem = this.validateDatasetName(enteredName, datasetFolderName, latestDatasetPreferences, panelState.recipeDataMessage?.recipe.trees ?? []);

        if ( namingProblem ) {
            VSCodeWorkspaceService.showWarningMessage(`The data set was not renamed. ${namingProblem}`);
            return;
        }

        const trimmedName = enteredName.trim();

        if ( trimmedName === '' ) {
            latestDatasetPreferences.customNamesByFolderName.delete(datasetFolderName);
        } else {
            latestDatasetPreferences.customNamesByFolderName.set(datasetFolderName, trimmedName);
        }

        await this.saveAndPostDatasetPreferences(cockpitPanel, panelState, datasetFolderName, latestDatasetPreferences);

    }

    // WRITTEN, PUT ON THE STORED MODEL A REVEAL REPLAYS, THEN POSTED FOR THE ONE DATA SET, TAGGED WITH THE MODEL IT IS ABOUT
    private static async saveAndPostDatasetPreferences(cockpitPanel: vscode.WebviewPanel,
                                                        panelState: IRecipeCockpitPanelState,
                                                        datasetFolderName: string,
                                                        datasetPreferences: IRecipeCockpitDatasetPreferences) {

        const isWritten = await this.writeDatasetPreferences(this.recipeCockpitWorkspaceState, datasetPreferences);

        if ( !isWritten || this.recipeCockpitPanel !== cockpitPanel || this.recipeCockpitPanelState !== panelState || !panelState.recipeDataMessage ) {
            return;
        }

        const recipeDataMessage = panelState.recipeDataMessage;
        this.applyDatasetPreferences(recipeDataMessage.recipe.trees, datasetPreferences);

        this.postToPanel(cockpitPanel, this.buildDatasetPreferencesMessage(datasetFolderName, datasetPreferences, recipeDataMessage.renderSequence));

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

        const confirmation = await this.confirmInPanel(
            `Add ${friendObjectApiName} under ${iterationNickname}?`,
            {
                detail: `This writes to "${path.basename(recipeFilePath)}": a copy of the ${friendObjectApiName} block under the ${objectApiName} above ${iterationNickname}, nested under ${iterationNickname} with a nickname of its own, its lookups to that ${objectApiName} pointed at ${iterationNickname}. Every other line of the file is left as it is.`
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
        Wires a card's TODO lookups to nicknames in its recipe FILE (#151) -- the one Recipe Cockpit
        write besides Add friend, and shaped like it: the host picks the nickname (a quick pick when
        the lookup has more than one, none for "Wire TODO lookups", which only takes lookups with
        one), a modal names the file and every change, and RecipeCockpitRecipeWriter.wireLookups
        writes against the file as it is NOW, refusing the whole batch if any lookup is no longer
        what the model showed. Only a write reloads, onto the card's Treecipe tab; every other ending
        gives the wire buttons back through the closing wireLookupState.
    */
    private static async wireLookupsFromPanel(cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                wireAction: Extract<RecipeCockpitPanelAction, { kind: 'wireLookups' }>) {

        await this.runRecipeLookupWrite(cockpitPanel, panelState, wireAction.treeKey,
            (tree, objectLevelsByApiName) => this.writeLookupWirings(wireAction, tree, objectLevelsByApiName, panelState.workspaceRoot));

    }

    /*
        "Add <Parent> to recipe" (#294): the parent's block from the minimum required fields template
        of the recipe's OWN backend, and the lookup wired to it, in one write after a modal that shows
        both. Shaped like a wiring and sharing its lock, its state message and its reload.
    */
    private static async addParentObjectFromPanel(cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    addAction: Extract<RecipeCockpitPanelAction, { kind: 'addParentObject' }>) {

        await this.runRecipeLookupWrite(cockpitPanel, panelState, addAction.treeKey,
            (tree, objectLevelsByApiName) => this.writeParentObjectAddition(addAction, tree, objectLevelsByApiName, panelState.workspaceRoot));

    }

    /*
        One write to a card's recipe file at a time, for a wiring and an added parent alike. Only a
        write reloads, onto the card's Treecipe tab; every other ending gives the buttons back through
        the closing wireLookupState.
    */
    private static async runRecipeLookupWrite(cockpitPanel: vscode.WebviewPanel,
                                                panelState: IRecipeCockpitPanelState,
                                                treeKey: string,
                                                write: (tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined) => Promise<boolean>) {

        const isPanelStillCurrent = () => this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState;
        const writtenRunFolderName = panelState.recipeDataMessage.recipe.selectedRunFolderName;
        // THE CARD AS THE CLICK SAW IT: ITS LOOKUPS DECIDE WHAT THE WRITER ACCEPTS, AND A RELOAD WHILE THE MODAL IS OPEN DOES NOT CHANGE WHAT WAS CONFIRMED
        const tree = panelState.recipeDataMessage.recipe.trees.find(candidateTree => candidateTree.treeKey === treeKey);
        const objectLevelsByApiName = panelState.objectLevelsByApiName;

        panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };
        this.postToPanel(cockpitPanel, panelState.wireLookupStateMessage);

        try {

            const isWritten = !!tree && await write(tree, objectLevelsByApiName);

            if ( isWritten && isPanelStillCurrent() ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, writtenRunFolderName, { treeKey: treeKey, tab: 'treecipe' });
            }

        } finally {

            panelState.wireLookupStateMessage = undefined;

            if ( isPanelStillCurrent() ) {
                this.postToPanel(cockpitPanel, { command: 'wireLookupState', isRunning: false });
            }

        }

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeParentObjectAddition(addAction: Extract<RecipeCockpitPanelAction, { kind: 'addParentObject' }>,
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

        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was added. Re-open the Recipe Cockpit to load the runs currently on disk.`);
            return false;
        }

        const generatedRecipesFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath());
        const fakerService = VSCodeWorkspaceService.readRecipeFakerService(generatedRecipesFolderPath, recipeFilePath);

        if ( !fakerService ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} which faker backend wrote it cannot be told from its folder and file name, so which template to use cannot be either.`);
            return false;
        }

        const parentTemplates = this.getParentObjectTemplates(fakerService);
        const parentTemplate = Object.prototype.hasOwnProperty.call(parentTemplates, addition.parentObjectApiName) ? parentTemplates[addition.parentObjectApiName] : undefined;

        if ( !parentTemplate ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} there is no minimum required fields template for it.`);
            return false;
        }

        const templateFieldApiNames = Object.keys(parentTemplate);
        // THE DIALOG WRITES ITS TEXT WITH textContent (#349): NOT ESCAPED THERE, AS THE NOTIFICATIONS STILL ARE
        const dialogFieldLabel = `${addition.objectApiName}${addition.objectNickname !== undefined ? ` (${addition.objectNickname})` : ''}.${addition.fieldApiName}`;
        const confirmation = await this.confirmInPanel(
            `Add ${addition.parentObjectApiName} to the recipe and wire ${dialogFieldLabel} to it?`,
            {
                detail: [
                    `This writes to "${path.basename(recipeFilePath)}": a new top-level ${addition.parentObjectApiName} block, ahead of the block holding ${addition.objectApiName}, with one record and a nickname of its own, and ${dialogFieldLabel}'s "### TODO -- REFERENCE ID REQUIRED" line becomes that nickname. Every other line of the file is left as it is.`,
                    '',
                    templateFieldApiNames.length > 0
                        ? `Fields, from the ${fakerService} minimum required fields template: ${templateFieldApiNames.join(', ')}.`
                        : `The ${fakerService} template has no required field for ${addition.parentObjectApiName}, so its block has a count only.`,
                    '',
                    `Generate fake data and insert then inserts ${addition.parentObjectApiName} before ${addition.objectApiName} and points the lookup at its Id. A required field your org adds to ${addition.parentObjectApiName} is not in the template: add it to the block if the insert reports it.`
                ].join('\n')
            },
            RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL ) {
            return false;
        }

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was added.`);
            return false;
        }

        const additionResult = RecipeCockpitRecipeWriter.addParentObject(fs.readFileSync(recipeFilePath, 'utf-8'), {
            objectApiName: addition.objectApiName,
            ...( addition.objectNickname !== undefined ? { objectNickname: addition.objectNickname } : {} ),
            fieldApiName: addition.fieldApiName,
            parentTemplatesByObjectApiName: { [addition.parentObjectApiName]: parentTemplate }
        }, this.buildLookupWiringContext(tree, objectLevelsByApiName));

        if ( 'refusal' in additionResult ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} ${RecipeYamlScalar.escapeForNotification(additionResult.refusal.message)}`);
            return false;
        }

        // THE WRITER NAMES THE PARENT FROM THE FILE'S LOOKUPS AT THE CLICK; ONE THAT IS NOT THE PARENT THE READER CONFIRMED WRITES NOTHING
        if ( additionResult.parentObjectApiName !== addition.parentObjectApiName ) {
            VSCodeWorkspaceService.showWarningMessage(`${refusalPrefix} ${fieldLabel} no longer points at it.`);
            return false;
        }

        fs.writeFileSync(recipeFilePath, additionResult.recipeText);

        VSCodeWorkspaceService.showInformationMessage(`Added ${parentLabel} as ${RecipeYamlScalar.escapeForNotification(additionResult.parentNickname)} to "${recipeFileLabel}" and wired ${fieldLabel} to it.`);

        return true;

    }

    // WHETHER THE FILE WAS WRITTEN; EVERY OTHER ENDING HAS ALREADY BEEN SAID TO THE READER, OR WAS THEIR OWN CANCEL
    private static async writeLookupWirings(wireAction: Extract<RecipeCockpitPanelAction, { kind: 'wireLookups' }>,
                                            tree: IRecipeCockpitTreeViewModel,
                                            objectLevelsByApiName: Map<string, number> | undefined,
                                            workspaceRoot: string): Promise<boolean> {

        const { recipeFilePath, wirings, isWireAll } = wireAction;
        const recipeFileLabel = RecipeYamlScalar.escapeForNotification(path.basename(recipeFilePath));
        const describeWiring = (wiring: Pick<IRecipeCockpitLookupWiringViewModel, 'objectApiName' | 'objectNickname' | 'fieldApiName'>) => (
            `${wiring.objectApiName}${wiring.objectNickname !== undefined ? ` (${wiring.objectNickname})` : ''}.${wiring.fieldApiName}`
        );

        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
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
        const confirmation = await this.confirmInPanel(
            wiringRequests.length === 1
                ? `Wire ${describeWiring(wiringRequests[0])} to ${wiringRequests[0].parentNickname}?`
                : `Wire ${wiringRequests.length} TODO lookups?`,
            {
                detail: [
                    `This writes to "${dialogRecipeFileLabel}": each lookup's "### TODO -- REFERENCE ID REQUIRED" line becomes the nickname below, which the insert replaces with the Id of the record holding it. Every other line of the file is left as it is.`,
                    '',
                    ...shownWiringLines,
                    ...( unshownWiringCount > 0 ? [`…and ${unshownWiringCount} more`] : [] ),
                    ...( isWireAll ? ['', 'A lookup with more than one record to choose from is left as it is: use its "Wire to…".'] : [] )
                ].join('\n')
            },
            RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL ) {
            return false;
        }

        // CHECKED AGAIN AFTER THE MODAL: THE FILE CAN HAVE BEEN REPLACED WHILE IT WAS OPEN
        if ( !this.isUsableWorkspacePath(recipeFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The recipe file "${recipeFileLabel}" no longer exists in this workspace, so nothing was wired.`);
            return false;
        }

        const wiringResult = RecipeCockpitRecipeWriter.wireLookups(fs.readFileSync(recipeFilePath, 'utf-8'), wiringRequests, this.buildLookupWiringContext(tree, objectLevelsByApiName));

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
                || ( this.listExcludedObjectApiNames(tree).length === 0 && this.listExcludedFieldApiNamesByObject(tree).size === 0
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
        "Remember this selection" (#196): the selection goes into treecipe.config.json beside every
        record type each of its objects had in the model on screen, which is how a record type added
        later is noticed. A selection the router already matched against what the model offered, so
        every name is one the panel drew. A failed save is a warning and the regenerate still runs:
        the reader asked for that run whether or not it could be remembered.
    */
    static saveRecordTypeSelection(panelState: IRecipeCockpitPanelState, recordTypeSelection: Record<string, string[]>): boolean {

        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const objectsByApiName = recipeViewModel ? this.buildObjectsByApiName(recipeViewModel) : new Map<string, IRecipeCockpitObjectViewModel>();
        const recordTypesWhenSelectionSaved: Record<string, string[]> = Object.create(null);

        Object.keys(recordTypeSelection).forEach((objectApiName) => {
            const recordTypes = objectsByApiName.get(objectApiName)?.recordTypes;
            if ( recordTypes ) {
                recordTypesWhenSelectionSaved[objectApiName] = recordTypes.map(recordType => recordType.developerName);
            }
        });

        try {
            ConfigurationService.saveRecordTypeSelections(recordTypeSelection, recordTypesWhenSelectionSaved);
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
    /*
        The Record types section (#195, #321) comes through here too, with its selection in the
        options and the reload focused back on the section it was clicked in.
    */
    private static async generateTreecipeAndReload(cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    regeneration?: { generateTreecipeOptions: object; focusTree: IRecipeCockpitTreeFocus }) {

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
                await vscode.commands.executeCommand(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND, regeneration?.generateTreecipeOptions ?? RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS);
            } catch (commandError) {
                hasGenerationFailed = true;
                generationError = commandError;
            }

            if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState === panelState ) {
                await this.loadRecipeIntoPanel(cockpitPanel, panelState.workspaceRoot, undefined, regeneration?.focusTree);
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

    // THE DROPDOWN'S LABEL: THE CLI'S DEFAULT ORG SAYS SO (#305)
    static buildDataOrgListLabel(orgDetail: IDataOrgDetail): string {

        return this.buildDataOrgLabel(orgDetail) + ( orgDetail.isDefault === true ? RECIPE_COCKPIT_DEFAULT_ORG_SUFFIX : '' );

    }

    /*
        What the dropdown shows while the connections are checked: the org chosen last, else the
        CLI's default. Read locally; a read that fails shows nothing rather than holding the check.
    */
    private static async readProvisionalDataOrgDetail(panelState: IRecipeCockpitPanelState): Promise<IDataOrgDetail | undefined> {

        try {
            return await SalesforceOrgService.readLocalDataOrgDetail(panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername(), panelState.workspaceRoot);
        } catch {
            return undefined;
        }

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
        is then discarded rather than drawn over whatever replaced it. While it runs, the org chosen
        last (else the CLI's default) is posted as dataOrgProvisional, a label read from local files
        (#305). A remembered org that the CLI now reports expired, deleted or not connected is
        forgotten, and the view says so once; with no remembered org listed, the default is selected.
    */
    // keepUnlistedUsername: A SCRATCH ORG JUST CREATED THE CLI DOES NOT LIST YET IS STILL THE ONE TO SELECT ONCE IT DOES
    private static async loadDataOrgs(cockpitPanel: vscode.WebviewPanel, panelState: IRecipeCockpitPanelState, isRefresh = false, keepUnlistedUsername = false) {

        const listedRecipeDataMessage = panelState.recipeDataMessage;
        panelState.dataOrgDetails = [];
        panelState.dataOrgSelection = undefined;
        const listingRequestSequence = ++panelState.dataOrgRequestSequence;

        const isListingCurrent = () => this.recipeCockpitPanel === cockpitPanel
                                        && this.recipeCockpitPanelState === panelState
                                        && panelState.recipeDataMessage === listedRecipeDataMessage
                                        && panelState.dataOrgRequestSequence === listingRequestSequence;

        // THE CHECK STARTS FIRST: THE LOCAL READ OF THE ORG SHOWN MEANWHILE MUST NEVER DELAY IT
        const dataOrgListingRequest = ( async () => {
            if ( isRefresh ) {
                await SalesforceOrgService.refreshConnectedOrgAuthorizations();
            }
            return await SalesforceOrgService.listDataOrgDetails(panelState.workspaceRoot);
        } )();
        dataOrgListingRequest.catch(() => undefined);

        const provisionalOrgDetail = await this.readProvisionalDataOrgDetail(panelState);

        if ( provisionalOrgDetail && isListingCurrent() ) {
            this.postToPanel(cockpitPanel, {
                command: 'dataOrgProvisional',
                orgLabel: this.buildDataOrgListLabel(provisionalOrgDetail),
                requestSequence: listingRequestSequence,
                renderSequence: listedRecipeDataMessage.renderSequence
            });
        }

        let orgDetails: IDataOrgDetail[] = [];
        let hiddenOrgs: IHiddenAuthorizedOrg[] = [];
        let hiddenOrgNote = '';
        let noOrgsMessage = NO_AUTHORIZED_ORGS_MESSAGE;

        try {

            const dataOrgListing = await dataOrgListingRequest;
            orgDetails = dataOrgListing.orgDetails;
            hiddenOrgs = dataOrgListing.hiddenOrgs;
            hiddenOrgNote = this.buildDataOrgHiddenNote(dataOrgListing.hiddenOrgReasonCounts);
            noOrgsMessage = this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts);

        } catch (listError) {

            noOrgsMessage = listError instanceof OrgConnectionStatusUnavailableError
                ? listError.message
                : `The authorized Salesforce orgs could not be listed: ${listError?.message ?? listError}`;

        }

        if ( !isListingCurrent() ) {
            return;
        }

        panelState.dataOrgDetails = orgDetails;

        const rememberedUsername = panelState.dataOrgUsername ?? this.readRememberedDataOrgUsername();
        const rememberedOrgIndex = rememberedUsername ? orgDetails.findIndex(orgDetail => orgDetail.username === rememberedUsername) : -1;
        // THE ORG CHOSEN LAST WINS; WITH NONE LISTED, THE CLI'S DEFAULT IS SELECTED -- UNLESS A SCRATCH ORG JUST CREATED IS STILL TO BE
        const selectedOrgIndex = rememberedOrgIndex >= 0 || ( rememberedUsername && keepUnlistedUsername )
            ? rememberedOrgIndex
            : orgDetails.findIndex(orgDetail => orgDetail.isDefault === true);
        let forgottenOrgNotice = '';

        // CHECKED AGAINST THE REMEMBERED ORG ITSELF: FALLING BACK TO THE DEFAULT MUST NOT SKIP SAYING WHY THE LAST ONE WENT
        if ( rememberedUsername && rememberedOrgIndex === -1 && !keepUnlistedUsername ) {

            const disconnectedRememberedOrg = hiddenOrgs.find(hiddenOrg => hiddenOrg.username === rememberedUsername && hiddenOrg.reason !== 'production');

            if ( disconnectedRememberedOrg ) {
                forgottenOrgNotice = `The last org used, ${disconnectedRememberedOrg.label}, is no longer connected.`;
            }

            panelState.dataOrgUsername = undefined;
            this.rememberDataOrgUsername(undefined);

        }

        this.postToPanel(cockpitPanel, {
            command: 'dataOrgList',
            orgLabels: orgDetails.map(orgDetail => this.buildDataOrgListLabel(orgDetail)),
            selectedOrgIndex: selectedOrgIndex >= 0 ? selectedOrgIndex : null,
            noOrgsMessage: orgDetails.length === 0 ? noOrgsMessage : '',
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
        the create alone runs under one cancellable notification (#358: nothing is deployed), and how
        the run ended is a notification with a "View output" button (#301). Once a username exists the org is kept whatever followed, and the
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
        this.setScratchOrgState({ command: 'scratchOrgState', isRunning: true });

        try {

            await this.performScratchOrgSetup(this.recipeCockpitPanelState.workspaceRoot);

        } finally {

            this.isScratchOrgSetupInFlight = false;
            this.setScratchOrgState({ command: 'scratchOrgState', isRunning: false });

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

    private static async performScratchOrgSetup(workspaceRoot: string): Promise<void> {

        let scratchOrgPlan: IScratchOrgPlan | undefined;

        try {
            scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(
                workspaceRoot,
                () => VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
                    SalesforceOrgService.listDevHubOrgDetailsForPicker(workspaceRoot),
                    RECIPE_COCKPIT_SCRATCH_ORG_DEV_HUB_PLACEHOLDER
                ),
                () => this.promptForScratchOrgAlias()
            );
        } catch (planError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(String(planError?.message ?? planError)));
            return;
        }

        // NO DEV HUB PICKED -- DISMISSED, OR NONE TO OFFER, WHICH THE PICKER HAS ALREADY SAID -- OR NO ALIAS ENTERED, IS A CANCEL
        if ( !scratchOrgPlan ) {
            return;
        }

        const devHubLabel = this.toSingleLine(this.buildDevHubLabel(scratchOrgPlan));

        const confirmation = await this.confirmInPanel(
            `Create a scratch org through the Dev Hub ${devHubLabel}? Nothing is deployed to it.`,
            { detail: this.buildScratchOrgConfirmationDetail(scratchOrgPlan), isDestructive: true },
            RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_SCRATCH_ORG_CONFIRM_LABEL ) {
            return;
        }

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
        const showScratchOrgNotification = (severity: 'information' | 'warning' | 'error', notificationText: string, outputFilePath?: string) =>
            VSCodeWorkspaceService.showNotificationWithWorkspaceFile(severity, RecipeYamlScalar.escapeForNotification(notificationText), RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL,
                outputFilePath, workspaceRoot, 'The scratch org result file no longer exists in this workspace.');

        if ( setupOutcome.kind === 'createFailed' ) {
            showScratchOrgNotification('error', `The scratch org ${alias} was not created: ${setupOutcome.failureMessage}`, setupOutcome.outputFilePath);
            return;
        }

        if ( setupOutcome.kind === 'createCancelled' ) {
            showScratchOrgNotification('information', `Cancelled while the scratch org ${alias} was being created. A scratch org may still have been created: check with "sf org list".`);
            return;
        }

        const isListed = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Recipe Cockpit: scratch org ${alias}`
        }, async progress => {
            progress.report({ message: RECIPE_COCKPIT_SCRATCH_ORG_PHASE_TEXT.listing });
            return await this.listAndSelectNewScratchOrg(setupOutcome.username);
        });
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THE NOTIFICATION IS NOW ALL THE READER SEES OF THE RUN (#301)
        const orgText = `${alias} · ${setupOutcome.username}`;
        const selectionText = isListed
            ? 'It is selected in the Treecipe tab.'
            : `The Salesforce CLI does not list ${orgText} as connected yet, so no org was selected in its place: press ⟳ to check again.`;

        this.showCreatedScratchOrgNotification(isListed ? 'information' : 'warning',
            `Scratch org ${orgText} is ready. Nothing was deployed to it. ${selectionText}`,
            setupOutcome.username,
            setupOutcome.outputFilePath,
            workspaceRoot);

    }

    /*
        #358: the run deploys nothing, so the notification hands the reader the deploy to run
        themselves -- to the CLIPBOARD only, never run -- beside the create's own output. Not
        awaited: the run ends without waiting for a click.
    */
    private static showCreatedScratchOrgNotification(severity: 'information' | 'warning',
                                                        notificationText: string,
                                                        username: string,
                                                        outputFilePath: string | undefined,
                                                        workspaceRoot: string) {

        const actions = [RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL, ...( outputFilePath ? [RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL] : [] )];
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);

        Promise.resolve(severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions))
            .then(async chosenAction => {

                if ( chosenAction === RECIPE_COCKPIT_SCRATCH_ORG_COPY_DEPLOY_LABEL ) {
                    await vscode.env.clipboard.writeText(ScratchOrgService.buildSourceDeployCommandText(username));
                } else if ( chosenAction === RECIPE_COCKPIT_SCRATCH_ORG_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The scratch org result file no longer exists in this workspace.');
                }

            })
            .catch(() => undefined);

    }

    /*
        "Open in browser" (#279): "sf org open --url-only --json" for the selected org's USERNAME,
        and the https: URL it answers handed to the reader's browser by VS Code, which also works
        where the CLI has no browser of its own. The URL logs the reader in -- it carries a session
        id -- so it goes to openExternal and nowhere else: never posted, saved, logged or quoted in
        a notification. Notifications are not awaited, so the button comes back without a click.

        One open per WINDOW, like the scratch org run: a panel closed and reopened mid-open starts
        from this flag, is told the open is running when its document loads, and is the panel the
        closing state goes to. Anything that throws is answered with a fixed message rather than
        the error's own text, which the generic handler would carry into a Report Issue URL.
    */
    private static isOrgOpenInFlightForWindow = false;

    private static async openDataOrgInBrowser(panelState: IRecipeCockpitPanelState, orgDetail: IAuthenticatedOrgDetail) {

        this.isOrgOpenInFlightForWindow = true;
        panelState.isOrgOpenInFlight = true;
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;

        try {

            const openOutcome = await ScratchOrgService.resolveOrgOpenUrl(orgDetail.username);

            if ( 'failureMessage' in openOutcome ) {
                this.showOrgOpenError(`${orgLabel} was not opened: ${openOutcome.failureMessage}`);
                return;
            }

            const isOpened = await vscode.env.openExternal(vscode.Uri.parse(openOutcome.url, true));

            if ( !isOpened ) {
                VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`${orgLabel} was not opened: the browser did not accept the address.`));
            }

        } catch {

            this.showOrgOpenError(`${orgLabel} was not opened: the browser could not be started.`);

        } finally {

            this.isOrgOpenInFlightForWindow = false;
            panelState.isOrgOpenInFlight = false;
            this.recipeCockpitPanelState.isOrgOpenInFlight = false;

            if ( this.recipeCockpitPanel ) {
                this.postToPanel(this.recipeCockpitPanel, { command: 'orgOpenState', isRunning: false });
            }

        }

    }

    // NOT AWAITED: THE BUTTON COMES BACK WITHOUT WAITING FOR THE READER TO DISMISS THE NOTIFICATION
    private static showOrgOpenError(errorText: string) {

        Promise.resolve(vscode.window.showErrorMessage(RecipeYamlScalar.escapeForNotification(errorText))).catch(() => undefined);

    }

    /*
        The new org's alias, asked after the Dev Hub and before the modal (#279). There is no
        default: the box starts empty and an empty or unusable alias cannot be submitted. An alias
        another authorized org holds is a WARNING, not a refusal -- the CLI moves it to the new org,
        which may be exactly what the reader wants -- and the modal repeats it. Escape is a cancel.
        Which org holds which alias is read from the local authorizations only, and a failure to
        read them costs only the warning.
    */
    private static async promptForScratchOrgAlias(): Promise<IScratchOrgAliasChoice | undefined> {

        let aliasHolders = new Map<string, string>();

        try {
            aliasHolders = await SalesforceOrgService.listAliasHolders();
        } catch {
            // NO WARNING TO GIVE: THE CREATE ITSELF STILL WORKS
        }

        const enteredAlias = await vscode.window.showInputBox({
            title: 'New scratch org',
            prompt: RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PROMPT,
            placeHolder: RECIPE_COCKPIT_SCRATCH_ORG_ALIAS_PLACEHOLDER,
            ignoreFocusOut: true,
            validateInput: (typedAlias: string) => this.validateScratchOrgAliasInput(typedAlias, aliasHolders)
        });

        if ( enteredAlias === undefined ) {
            return undefined;
        }

        const alias = enteredAlias.trim();
        const aliasHolderUsername = aliasHolders.get(alias);

        return aliasHolderUsername ? { alias: alias, aliasHolderUsername: aliasHolderUsername } : { alias: alias };

    }

    // AN INPUT BOX'S MESSAGE RENDERS [label](command:...) AS A NOTIFICATION DOES, SO THE HOLDER'S USERNAME IS ESCAPED
    static validateScratchOrgAliasInput(typedAlias: string, aliasHolders: Map<string, string>): string | vscode.InputBoxValidationMessage | undefined {

        const alias = String(typedAlias ?? '').trim();
        const aliasRefusal = ScratchOrgService.validateScratchOrgAlias(alias);

        if ( aliasRefusal ) {
            return aliasRefusal;
        }

        const aliasHolderUsername = aliasHolders.get(alias);

        return aliasHolderUsername
            ? {
                message: RecipeYamlScalar.escapeForNotification(`"${alias}" is currently ${aliasHolderUsername}. Creating will move it to the new org.`),
                severity: vscode.InputBoxValidationSeverity.Warning
            }
            : undefined;

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
        choose among the reader's Dev Hubs) and what the definition sets for the admin. Nothing is
        deployed (#358), so no package directory or replacement is named.
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
            scratchOrgPlan.aliasHolderUsername
                ? this.toSingleLine(`Alias: ${scratchOrgPlan.alias} — currently ${scratchOrgPlan.aliasHolderUsername}; the Salesforce CLI will move it to the new org`)
                : this.toSingleLine(`Alias: ${scratchOrgPlan.alias}`),
            `Duration: ${scratchOrgPlan.durationDays} days`,
            '',
            'The definition file, authored in this repository, decides who administers the new org.',
            'Nothing is deployed to the new org: deploy what you need yourself once it is ready. The scratch org is kept whatever happens, and nothing here deletes an org.'
        ].join('\n');

    }

    private static isPermissionSetAssignInFlight = false;

    private static permissionSetAssignRunStateMessage: IRecipeCockpitPermissionSetAssignStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setPermissionSetAssignState(permissionSetAssignStateMessage: IRecipeCockpitPermissionSetAssignStateMessage) {

        this.permissionSetAssignRunStateMessage = permissionSetAssignStateMessage.isRunning ? permissionSetAssignStateMessage : undefined;
        this.recipeCockpitPanelState.permissionSetAssignStateMessage = permissionSetAssignStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, permissionSetAssignStateMessage);
        }

    }

    // A PANEL STATE BUILT WHILE AN ASSIGNMENT IS GOING STARTS FROM ITS STATE, SO ITS ROUTER REFUSES WHAT THE ASSIGNMENT HOLDS
    private static adoptPermissionSetAssignRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isPermissionSetAssignInFlight && this.permissionSetAssignRunStateMessage ) {
            panelState.permissionSetAssignStateMessage = this.permissionSetAssignRunStateMessage;
        }

    }

    /*
        "Assign permission sets to me…" (#274, #302), for one tree of the model on screen. Nothing is
        deployed: the picks are this workspace's permission sets, and only those the org already
        holds are assigned; the rest are named in a warning for the reader to deploy. One at a time
        per window, and while it runs nothing else may insert, change the selection or create a
        scratch org. The org is the selection (isSelectedOrg, checked by the router to have answered
        that it is a sandbox) or one the reader picks from the same non-production list, which
        becomes the selection once confirmed. Every outcome is a VS Code notification, whose "View
        output" is its only follow-up; the panel only gets its button back. Field-level security
        changes what a describe answers, so once the CLI has run that org's describes of the objects
        the assigned picks cover are dropped either way, and an assignment that landed on the
        selection re-checks the cards listing them.
    */
    private static async assignTreePermissionSetsFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string, isSelectedOrg: boolean) {

        const panelState = this.recipeCockpitPanelState;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const assignSelection = isSelectedOrg ? panelState.dataOrgSelection : undefined;

        if ( this.isPermissionSetAssignInFlight || !tree || ( isSelectedOrg && !assignSelection ) ) {
            this.postToPanel(cockpitPanel, this.permissionSetAssignRunStateMessage
                ?? { command: 'permissionSetAssignState', isRunning: false, treeKey: treeKey });
            return;
        }

        this.isPermissionSetAssignInFlight = true;
        const treeLabel = tree.customName || tree.title;
        const objectApiNames = [...new Set(tree.objects.map(treeObject => treeObject.objectApiName))];
        let closingState: IRecipeCockpitPermissionSetClosingState = {};
        let cliStartedFor: { orgDetail: IAuthenticatedOrgDetail; objectApiNames: string[] } | undefined;

        this.setPermissionSetAssignState({ command: 'permissionSetAssignState', isRunning: true, treeKey: treeKey });

        try {

            closingState = await this.performPermissionSetAssign(
                panelState.workspaceRoot,
                treeLabel,
                objectApiNames,
                assignSelection ? async () => assignSelection.orgDetail : async () => this.promptForPermissionSetOrg(),
                (orgDetail, coveredObjectApiNames) => { cliStartedFor = { orgDetail: orgDetail, objectApiNames: coveredObjectApiNames }; }
            );

        } finally {

            try {

                if ( cliStartedFor ) {
                    const { orgDetail, objectApiNames: coveredObjectApiNames } = cliStartedFor;
                    coveredObjectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(orgDetail.username, objectApiName));
                }

                const currentPanel = this.recipeCockpitPanel;
                const currentPanelState = this.recipeCockpitPanelState;

                if ( closingState.isAssigned === true && cliStartedFor && assignSelection && currentPanel && currentPanelState.dataOrgSelection === assignSelection ) {
                    const lowerCoveredNames = new Set(cliStartedFor.objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
                    await this.refreshDataOrgReadinessForTrees(currentPanel, currentPanelState, recipeTree => recipeTree.objects.some(treeObject => lowerCoveredNames.has(treeObject.objectApiName.toLowerCase())));
                }

                if ( !assignSelection && closingState.isConfirmed === true && closingState.orgDetail && currentPanel && currentPanelState.recipeDataMessage ) {
                    this.rememberDataOrgUsername(closingState.orgDetail.username);
                    currentPanelState.dataOrgUsername = closingState.orgDetail.username;
                    await this.loadDataOrgs(currentPanel, currentPanelState);
                }

            } finally {

                this.isPermissionSetAssignInFlight = false;
                this.setPermissionSetAssignState({ command: 'permissionSetAssignState', isRunning: false, treeKey: treeKey });

            }

        }

    }

    private static isMetadataDeployInFlight = false;

    private static metadataDeployRunStateMessage: IRecipeCockpitMetadataDeployStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setMetadataDeployState(deployStateMessage: IRecipeCockpitMetadataDeployStateMessage) {

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

    // WHAT A TREE'S DEPLOYS ARE READ FOR: THE OBJECTS ITS INSERT SENDS, EACH WITH ITS RECIPE FIELDS LESS THE UNTICKED ONES
    static listTreeDeployObjects(recipeViewModel: IRecipeCockpitRecipeViewModel, tree: IRecipeCockpitTreeViewModel): IMetadataDeployObject[] {

        const insertObjectApiNames = new Set(this.listTreeInsertObjectApiNames(recipeViewModel, tree));
        const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);

        return recipeViewModel.objects
            .filter(objectViewModel => insertObjectApiNames.has(objectViewModel.objectApiName))
            .map(objectViewModel => {
                const excludedFieldApiNames = new Set(excludedFieldApiNamesByObject.get(objectViewModel.objectApiName) ?? []);
                return {
                    objectApiName: objectViewModel.objectApiName,
                    fieldApiNames: objectViewModel.fields
                        .map(fieldViewModel => fieldViewModel.fieldApiName)
                        .filter(fieldApiName => !excludedFieldApiNames.has(fieldApiName))
                };
            });

    }

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

    private static async postTroubleshootingSummary(cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const panelState = this.recipeCockpitPanelState;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeViewModel || !tree ) {
            return;
        }

        const deployObjects = this.listTreeDeployObjects(recipeViewModel, tree);
        const summaryKey = JSON.stringify([panelState.workspaceRoot, renderSequence, treeKey, deployObjects]);
        let summaryRead = this.troubleshootingSummaries.get(summaryKey);

        if ( !summaryRead ) {
            if ( this.troubleshootingSummaries.size >= RECIPE_COCKPIT_TROUBLESHOOTING_SUMMARY_CACHE_LIMIT ) {
                this.troubleshootingSummaries.clear();
            }
            summaryRead = this.readTroubleshootingSummary(panelState.workspaceRoot, treeKey, renderSequence, deployObjects);
            this.troubleshootingSummaries.set(summaryKey, summaryRead);
        }

        const summaryMessage = await summaryRead;

        // A PROJECT THAT COULD NOT BE READ IS ASKED AGAIN NEXT TIME: THE READER IS LIKELY FIXING IT
        if ( summaryMessage.failureMessage && this.troubleshootingSummaries.get(summaryKey) === summaryRead ) {
            this.troubleshootingSummaries.delete(summaryKey);
        }

        if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
            this.postToPanel(cockpitPanel, summaryMessage);
        }

    }

    private static async readTroubleshootingSummary(workspaceRoot: string, treeKey: string, renderSequence: number, deployObjects: IMetadataDeployObject[]): Promise<IRecipeCockpitTroubleshootingSummaryMessage> {

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
            recordTypeCount: 0
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

        } catch (projectError) {

            summaryMessage.failureMessage = `Nothing can be deployed: ${this.describeThrown(projectError)}`;

        }

        return summaryMessage;

    }

    // AN ACTION THAT WROTE INTO THE PROJECT OR THE ORG: WHAT ITS CARD COUNTS IS READ AGAIN AND POSTED, ON WHATEVER IS ON SCREEN NOW
    private static async refreshTroubleshootingSummary(treeKey: string) {

        this.clearTroubleshootingSummaries();

        const cockpitPanel = this.recipeCockpitPanel;
        const renderSequence = this.recipeCockpitPanelState.recipeDataMessage?.renderSequence;

        if ( cockpitPanel && renderSequence !== undefined && this.recipeCockpitPanelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
            await this.postTroubleshootingSummary(cockpitPanel, treeKey, renderSequence);
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

    private static async postTreeValidationRules(cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const panelState = this.recipeCockpitPanelState;
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
            listRead = this.readTreeValidationRules(panelState.workspaceRoot, panelState.objectsWrapperFilePath ?? '', treeKey, renderSequence, tree.objects.map(treeObject => treeObject.objectApiName));
            // A READ THAT THREW IS NOT KEPT EITHER: EVERY STEP CATCHES, BUT A CACHED REJECTION WOULD ANSWER NOTHING FOR THE MODEL'S LIFE
            listRead.catch(() => this.treeValidationRuleLists.delete(listKey));
            this.treeValidationRuleLists.set(listKey, listRead);
        }

        const rulesMessage = await listRead;

        if ( rulesMessage.failureMessage && this.treeValidationRuleLists.get(listKey) === listRead ) {
            this.treeValidationRuleLists.delete(listKey);
        }

        if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
            this.postToPanel(cockpitPanel, rulesMessage);
        }

    }

    private static async readTreeValidationRules(workspaceRoot: string, objectsWrapperFilePath: string, treeKey: string, renderSequence: number, objectApiNames: string[]): Promise<IRecipeCockpitTreeValidationRulesMessage> {

        const rulesMessage: IRecipeCockpitTreeValidationRulesMessage = { command: 'treeValidationRules', renderSequence: renderSequence, treeKey: treeKey, objects: [] };

        let objectsDirectoryPath: string;
        try {
            objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        } catch (configurationError) {
            rulesMessage.failureMessage = `The project's validation rules could not be read: ${this.describeThrown(configurationError)}`;
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
                rulesMessage.failureMessage = `The objects wrapper "${path.basename(objectsWrapperFilePath)}" could not be read again: ${this.describeThrown(readError)} Run "Generate Treecipe" again.`;
                return rulesMessage;
            }
        }

        rulesMessage.objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsDirectoryPath, objectApiNames, this.validationRuleRunRecordsRead.runRulesByObject);
        return rulesMessage;

    }

    /*
        A retrieve wrote rule files: the list is read again and posted, on whatever is on screen now,
        for the retrieving tree and every other tree whose list this model already drew -- a card
        listing the same objects would otherwise keep the old list. The run's records did not change.
    */
    private static async refreshTreeValidationRules(treeKey: string) {

        const panelState = this.recipeCockpitPanelState;
        const cockpitPanel = this.recipeCockpitPanel;
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
                await this.postTreeValidationRules(cockpitPanel, drawnTreeKey, renderSequence);
            }
        }

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

    private static readTreeQueries(treeKey: string): { renderSequence: number; folderName: string; queries?: ISOQLTreeQuery[]; failureMessage?: string } | undefined {

        const panelState = this.recipeCockpitPanelState;
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

    private static postTreeQueries(cockpitPanel: vscode.WebviewPanel, treeKey: string, renderSequence: number) {

        const treeQueryRead = this.readTreeQueries(treeKey);

        if ( !treeQueryRead ) {
            return;
        }

        const queriesMessage: IRecipeCockpitTreeQueriesMessage = { command: 'treeQueries', renderSequence: renderSequence, treeKey: treeKey, queries: [] };

        if ( !treeQueryRead.queries ) {
            queriesMessage.failureMessage = treeQueryRead.failureMessage;
        } else {
            const folderEdits = this.readQueryEdits(this.recipeCockpitWorkspaceState).get(treeQueryRead.folderName);
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

        if ( this.recipeCockpitPanel === cockpitPanel && this.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
            this.postToPanel(cockpitPanel, queriesMessage);
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

        Object.keys(editsByFolderName).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(folderName => {
            const storedFolderEdits = editsByFolderName[folderName];
            if ( !this.isBoundedText(folderName) || folderName === '' || !this.isPlainRecord(storedFolderEdits) ) {
                return;
            }
            const folderEdits = new Map<string, IRecipeCockpitQueryEdit>();
            Object.keys(storedFolderEdits).slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES).forEach(queryKey => {
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
    private static async saveTreeQueryEdit(treeKey: string, queryKey: string, queryText: string) {

        const treeQueryRead = this.readTreeQueries(treeKey);
        const treeQuery = treeQueryRead?.queries?.find(candidateQuery => candidateQuery.queryKey === queryKey);

        if ( !treeQueryRead || !treeQuery ) {
            return;
        }

        const queryEdits = this.readQueryEdits(this.recipeCockpitWorkspaceState);
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

        await this.writeQueryEdits(this.recipeCockpitWorkspaceState, queryEdits);

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

    private static setTreeQueryState(queryStateMessage: IRecipeCockpitTreeQueryStateMessage) {

        this.treeQueryRunStateMessage = queryStateMessage.isRunning ? queryStateMessage : undefined;
        this.recipeCockpitPanelState.treeQueryStateMessage = queryStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, queryStateMessage);
        }

    }

    private static adoptTreeQueryRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isTreeQueryInFlight && this.treeQueryRunStateMessage ) {
            panelState.treeQueryStateMessage = this.treeQueryRunStateMessage;
        }

    }

    /*
        "Run" (#367): the text is held to one SELECT, the org is ALWAYS asked for in the command
        palette over every connected org (a query only reads, as a retrieve does, #326), and the
        query is sent on a connection opened by that org's username, every page read up to the cap
        and cancellable between pages. The whole result is held for an export, a preview is posted,
        and how it went is ONE notification. One run per window.
    */
    private static async runTreeQueryFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string, queryKey: string, queryText: string) {

        const notRunning: IRecipeCockpitTreeQueryStateMessage = { command: 'treeQueryState', isRunning: false, treeKey: treeKey, queryKey: queryKey };

        if ( this.isTreeQueryInFlight ) {
            this.postToPanel(cockpitPanel, this.treeQueryRunStateMessage ?? notRunning);
            return;
        }

        const treeQueryRead = this.readTreeQueries(treeKey);
        const treeQuery = treeQueryRead?.queries?.find(candidateQuery => candidateQuery.queryKey === queryKey);

        if ( !treeQueryRead?.queries || !treeQuery ) {
            this.postToPanel(cockpitPanel, notRunning);
            return;
        }

        const queryCheck = RecipeCockpitQuery.checkQueryText(queryText);

        if ( 'refusal' in queryCheck ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`The query was not run: ${queryCheck.refusal}`));
            this.postToPanel(cockpitPanel, notRunning);
            return;
        }

        this.isTreeQueryInFlight = true;
        this.setTreeQueryState({ command: 'treeQueryState', isRunning: true, treeKey: treeKey, queryKey: queryKey });

        try {
            await this.performTreeQuery(treeKey, treeQueryRead.renderSequence, treeQueryRead.folderName, treeQuery, queryCheck.query);
        } finally {
            this.isTreeQueryInFlight = false;
            this.setTreeQueryState(notRunning);
        }

    }

    private static async performTreeQuery(treeKey: string, renderSequence: number, folderName: string, treeQuery: ISOQLTreeQuery, queryText: string) {

        const workspaceRoot = this.recipeCockpitPanelState.workspaceRoot;

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await SalesforceOrgService.promptForAuthorizedOrg(RECIPE_COCKPIT_QUERY_ORG_PLACEHOLDER);
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

        this.heldTreeQueryResult = {
            resultKey: JSON.stringify([workspaceRoot, renderSequence, folderName, treeQuery.queryKey]),
            folderName: folderName,
            objectApiName: treeQuery.objectApiName,
            kind: treeQuery.kind,
            orgLabel: orgLabel,
            records: queryResult.records
        };

        const preview = RecipeCockpitQuery.buildPreview(queryResult.records, RECIPE_COCKPIT_QUERY_PREVIEW_ROW_LIMIT);
        const recordCount = queryResult.records.length;
        const recordsText = `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;

        // DRAWN ONLY ON THE MODEL IT WAS RUN ON: A RELOAD SINCE IS ANOTHER MODEL, AND KEEPS ITS OWN TAB
        if ( this.recipeCockpitPanelState.recipeDataMessage?.renderSequence === renderSequence ) {
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
            this.recipeCockpitPanelState.treeQueryResultMessage = resultMessage;
            if ( this.recipeCockpitPanel ) {
                this.postToPanel(this.recipeCockpitPanel, resultMessage);
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
        "Export JSON" / "Export CSV" (#367): the result held for the same tree folder and query, and
        nothing else, written under treecipe/QueryResults/<folder>/. The panel posts only names; the
        path is the host's and opened only through the notification's "Open file".
    */
    private static exportTreeQueryResult(treeKey: string, queryKey: string, exportFormat: RecipeCockpitQueryExportFormat) {

        const workspaceRoot = this.recipeCockpitPanelState.workspaceRoot;
        const tree = this.recipeCockpitPanelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const heldResult = this.heldTreeQueryResult;

        const renderSequence = this.recipeCockpitPanelState.recipeDataMessage?.renderSequence;

        if ( !heldResult || heldResult.resultKey !== JSON.stringify([workspaceRoot, renderSequence, tree?.folderName, queryKey]) ) {
            VSCodeWorkspaceService.showWarningMessage('Nothing was exported: run this query first. Only the last query run is kept to export.');
            return;
        }

        let exportFilePath: string | undefined;
        try {
            const exportContent = exportFormat === 'json'
                ? RecipeCockpitQuery.buildJsonExport(heldResult.records)
                : RecipeCockpitQuery.buildCsvExport(heldResult.records);
            exportFilePath = RecipeCockpitQuery.writeQueryExport(workspaceRoot, heldResult.folderName, heldResult.objectApiName, heldResult.kind, exportFormat, exportContent, new Date());
        } catch (exportError) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Nothing was exported: the ${exportFormat.toUpperCase()} file could not be built: ${this.describeThrown(exportError)}`));
            return;
        }

        if ( !exportFilePath ) {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`Nothing was exported: the ${exportFormat.toUpperCase()} file could not be written under treecipe/QueryResults in this workspace.`));
            return;
        }

        const recordCount = heldResult.records.length;
        const relativeFilePath = path.relative(workspaceRoot, exportFilePath).split(path.sep).join('/');
        const exportedText = `Exported ${recordCount} ${recordCount === 1 ? 'record' : 'records'} from ${heldResult.orgLabel} to ${relativeFilePath}.`;
        // ORG DATA, POSSIBLY PRODUCTION'S, IN A FOLDER GIT DOES NOT IGNORE IS SAID, SO IT IS NOT COMMITTED UNSEEN
        const isGitIgnored = RecipeCockpitQuery.isQueryResultsFolderGitIgnored(workspaceRoot);
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

    /*
        A Troubleshooting deploy (#346): one section's components, named in a host modal, deployed
        through a generated package.xml to a sandbox or scratch org. One per window, and while it
        runs nothing else may insert, assign, retrieve, create a scratch org or change the
        selection. The org is the selection (checked by the router to have answered that it is a
        sandbox) or one the reader picks from the same non-production list; either way it is asked
        again on the connection after the modal, and production is never deployed to. Every outcome
        is a VS Code notification. Once the CLI has run, that org's describes of the objects the
        deploy touches are dropped, and a deploy that landed on the selection re-checks the cards
        listing them.
    */
    private static async deployTreeMetadataFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string, deployKind: MetadataDeployKind, isSelectedOrg: boolean) {

        const panelState = this.recipeCockpitPanelState;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);
        const deploySelection = isSelectedOrg ? panelState.dataOrgSelection : undefined;

        if ( this.isMetadataDeployInFlight || !recipeViewModel || !tree || ( isSelectedOrg && !deploySelection ) ) {
            this.postToPanel(cockpitPanel, this.metadataDeployRunStateMessage
                ?? { command: 'metadataDeployState', isRunning: false, treeKey: treeKey, deployKind: deployKind });
            return;
        }

        this.isMetadataDeployInFlight = true;
        let closingState: IRecipeCockpitMetadataDeployClosingState = {};

        this.setMetadataDeployState({ command: 'metadataDeployState', isRunning: true, treeKey: treeKey, deployKind: deployKind });

        try {

            closingState = await this.performMetadataDeploy(
                cockpitPanel,
                panelState.workspaceRoot,
                recipeViewModel,
                tree,
                deployKind,
                deploySelection ? async () => deploySelection.orgDetail : async () => this.promptForDeployOrg()
            );

        } finally {

            try {

                const { cliStartedFor } = closingState;

                if ( cliStartedFor ) {
                    cliStartedFor.objectApiNames.forEach(objectApiName => SalesforceOrgService.clearDescribeCache(cliStartedFor.orgDetail.username, objectApiName));
                }

                const currentPanel = this.recipeCockpitPanel;
                const currentPanelState = this.recipeCockpitPanelState;

                if ( closingState.isDeployed === true && cliStartedFor && deploySelection && currentPanel && currentPanelState.dataOrgSelection === deploySelection ) {
                    const lowerObjectNames = new Set(cliStartedFor.objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
                    await this.refreshDataOrgReadinessForTrees(currentPanel, currentPanelState, recipeTree => recipeTree.objects.some(treeObject => lowerObjectNames.has(treeObject.objectApiName.toLowerCase())));
                }

            } finally {

                this.isMetadataDeployInFlight = false;
                this.setMetadataDeployState({ command: 'metadataDeployState', isRunning: false, treeKey: treeKey, deployKind: deployKind });
                closingState.showOutcome?.();
                await this.refreshTroubleshootingSummary(treeKey);

            }

        }

    }

    private static async promptForDeployOrg(): Promise<IAuthenticatedOrgDetail | undefined> {

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
            SalesforceOrgService.listDataOrgDetails().then(dataOrgListing => ({
                orgDetails: dataOrgListing.orgDetails,
                emptyListMessage: this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts)
            })),
            RECIPE_COCKPIT_DEPLOY_ORG_PLACEHOLDER
        );

    }

    // THE READER'S PICK, THIS TREE'S GENERATED SET FIRST AND PRESELECTED; undefined WHEN THE PICK WAS DISMISSED OR LEFT EMPTY
    private static async promptForDeployPermissionSets(permissionSets: IPermissionSetCandidate[], generatedPermissionSetName: string | undefined, treeObjectCount: number): Promise<IPermissionSetCandidate[] | undefined> {

        const lowerGeneratedName = generatedPermissionSetName?.toLowerCase();
        const orderedPermissionSets = [
            ...permissionSets.filter(permissionSet => permissionSet.name.toLowerCase() === lowerGeneratedName),
            ...permissionSets.filter(permissionSet => permissionSet.name.toLowerCase() !== lowerGeneratedName)
        ];

        const pickedItems = await vscode.window.showQuickPick(
            orderedPermissionSets.map(permissionSet => ({
                label: permissionSet.name,
                description: RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, treeObjectCount),
                detail: permissionSet.relativeFilePath,
                picked: permissionSet.name.toLowerCase() === lowerGeneratedName,
                permissionSet: permissionSet
            })),
            { canPickMany: true, ignoreFocusOut: true, matchOnDescription: true, placeHolder: RECIPE_COCKPIT_DEPLOY_PERMISSION_SET_PICK_PLACEHOLDER }
        );

        return pickedItems && pickedItems.length > 0 ? pickedItems.map(pickedItem => pickedItem.permissionSet) : undefined;

    }

    /*
        Everything that decides WHAT is deployed is read and picked BEFORE an org is asked for, so a
        project with nothing to deploy opens no prompt; a dismissed pick, org prompt or modal is a
        quiet cancel that writes nothing. The package.xml is written only after the org has
        answered, on the connection, that it is a sandbox.
    */
    private static async performMetadataDeploy(cockpitPanel: vscode.WebviewPanel,
                                                workspaceRoot: string,
                                                recipeViewModel: IRecipeCockpitRecipeViewModel,
                                                tree: IRecipeCockpitTreeViewModel,
                                                deployKind: MetadataDeployKind,
                                                resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>): Promise<IRecipeCockpitMetadataDeployClosingState> {

        const treeLabel = tree.customName || tree.title;
        const refuse = (refusalText: string, closingState: IRecipeCockpitMetadataDeployClosingState = {}): IRecipeCockpitMetadataDeployClosingState => {
            this.showMetadataDeployNotification('warning', refusalText, undefined, workspaceRoot);
            return closingState;
        };

        let packageDirectoryPaths: string[];
        let packageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            packageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            return refuse(`Nothing was deployed: ${this.describeThrown(projectError)}`);
        }

        const deployObjects = this.listTreeDeployObjects(recipeViewModel, tree);
        const treeObjectApiNames = deployObjects.map(deployObject => deployObject.objectApiName);
        let components: IMetadataDeployComponent[];
        let summary: IMetadataDeploySummary | undefined;
        let touchedObjectApiNames: string[];

        if ( deployKind === 'permissionSet' ) {

            const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(treeObjectApiNames, workspaceRoot, packageDirectoryPaths);
            if ( discovery.permissionSets.length === 0 ) {
                return refuse(`No permission set in this workspace's source grants access to any object of ${treeLabel}, so nothing was deployed. Generate permission set… writes one.`);
            }

            const pickedPermissionSets = await this.promptForDeployPermissionSets(discovery.permissionSets, RecipeCockpitPermissionSetGenerate.buildPermissionSetName(tree.folderName), treeObjectApiNames.length);
            if ( !pickedPermissionSets ) {
                return {};
            }

            components = pickedPermissionSets.map(permissionSet => ({ type: 'PermissionSet', member: permissionSet.name }));
            touchedObjectApiNames = [...new Set(pickedPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames))].filter(objectApiName => SalesforceApiName.isApiName(objectApiName));

        } else {

            summary = await RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, packageDirectoryPaths, deployObjects);
            components = RecipeCockpitMetadataDeploy.listSummaryComponents(summary, deployKind);

            if ( components.length === 0 ) {
                const missingText = deployKind === 'fields' ? 'custom field whose source file this project holds'
                    : deployKind === 'globalValueSets' ? 'global value set its fields name that this project holds'
                    : 'record type in this project';
                return refuse(`${treeLabel} has no ${missingText}, so nothing was deployed.`);
            }

            touchedObjectApiNames = deployKind === 'globalValueSets'
                ? treeObjectApiNames
                : [...new Set(components.map(component => component.member.split('.')[0]))];

        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`Nothing was deployed: ${this.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return {};
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const packageDirectoryRelativePath = path.relative(workspaceRoot, packageDirectoryPath).split(path.sep).join('/') || '.';
        const componentText = `${components.length} ${components.length === 1 ? 'component' : 'components'}`;

        const confirmation = await this.confirmInPanel(
            `Deploy ${componentText} for ${this.toSingleLine(treeLabel)} to ${this.toSingleLine(orgLabel)}?`,
            {
                detail: RecipeCockpitMetadataDeploy.buildConfirmationDetail(deployKind, treeLabel, orgLabel, packageDirectoryRelativePath, components, summary, SfdxProjectService.hasFileOrEnvironmentReplacements(workspaceRoot)),
                isDestructive: true
            },
            RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_DEPLOY_CONFIRM_LABEL ) {
            return {};
        }

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE PROMPT OR THE MODAL WAS OPEN
        const currentPanelState = this.recipeCockpitPanelState;
        if ( this.isScratchOrgSetupInFlight
                || currentPanelState.insertStateMessage
                || currentPanelState.permissionSetAssignStateMessage?.isRunning
                || this.isValidationRuleRetrieveInFlight ) {
            return refuse(RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL);
        }

        let orgTypeDetail: IOrgTypeDetail | undefined;
        try {
            orgTypeDetail = await SalesforceOrgService.queryOrganizationType(SalesforceOrgService.toQuerySource(await SalesforceOrgService.getConnection(orgDetail.username)));
        } catch (connectionError) {
            return refuse(`Nothing was deployed: could not connect to ${orgLabel}: ${this.describeThrown(connectionError)}`);
        }

        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was deployed: ${orgLabel} ${orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}` : 'could not say whether it is a sandbox'}. Metadata is deployed only to a sandbox or scratch org.`);
        }

        const operationName = METADATA_DEPLOY_OPERATION_BY_KIND[deployKind];
        const operationDate = new Date();
        let deployArguments: string[];
        try {
            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(components, this.readSourceApiVersion(workspaceRoot));
            const packageXmlFilePath = RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(workspaceRoot, orgDetail.username, operationName, operationDate);
            const writtenFilePath = packageXmlFilePath ? RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, packageXmlFilePath, packageXml) : undefined;
            if ( !writtenFilePath ) {
                return refuse(`Nothing was deployed: the package.xml could not be written under treecipe/${ORG_OPERATIONS_FOLDER_NAME} in this workspace.`);
            }
            deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, writtenFilePath), orgDetail.username);
        } catch (argumentError) {
            return refuse(this.describeThrown(argumentError));
        }

        const cliStarted: IRecipeCockpitMetadataDeployClosingState = { cliStartedFor: { orgDetail: orgDetail, objectApiNames: touchedObjectApiNames } };

        const deployRun = await this.runCancellableCli(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: deploying ${componentText} to ${orgDetail.username}`),
            deployArguments,
            METADATA_DEPLOY_TIMEOUT_MILLISECONDS,
            workspaceRoot,
            SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES
        );

        if ( deployRun.isCancelled ) {
            return refuse(`The deploy of ${componentText} for ${treeLabel} to ${orgLabel} was cancelled, so whether it landed is unknown.`, cliStarted);
        }

        const deployPayload = ScratchOrgService.readCliJsonPayload(deployRun.invocation);
        const deployOutcome: MetadataDeployOutcome = RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployRun.invocation, deployPayload);
        const deployOutputFilePath = deployRun.invocation.spawnError || deployRun.invocation.isOutputTooLarge
            ? undefined
            : ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, operationName, deployRun.invocation, operationDate, deployPayload);

        switch ( deployOutcome.kind ) {

            case 'deployed':
                return {
                    ...cliStarted,
                    isDeployed: true,
                    showOutcome: () => this.showMetadataDeployNotification(
                        'information',
                        `Deployed ${componentText} for ${treeLabel} to ${orgLabel}.`,
                        deployOutputFilePath,
                        workspaceRoot,
                        deployKind === 'permissionSet' ? { cockpitPanel: cockpitPanel, treeKey: tree.treeKey, orgUsername: orgDetail.username } : undefined
                    )
                };

            case 'cliNotInstalled':
                return refuse(deployOutcome.failureMessage, cliStarted);

            case 'unconfirmed':
                this.showMetadataDeployNotification('warning', deployOutcome.failureMessage, deployOutputFilePath, workspaceRoot);
                return cliStarted;

            case 'failed': {
                const shownFailures = deployOutcome.componentFailureMessages.slice(0, METADATA_DEPLOY_FAILURES_SHOWN);
                const hiddenFailureCount = deployOutcome.componentFailureMessages.length - shownFailures.length;
                const failureText = shownFailures.length > 0
                    ? `${shownFailures.join('; ')}${hiddenFailureCount > 0 ? `; and ${hiddenFailureCount} more` : ''}`
                    : deployOutcome.failureMessage;
                this.showMetadataDeployNotification('warning', `Nothing was deployed to ${orgLabel}: ${failureText}`, deployOutputFilePath, workspaceRoot);
                return cliStarted;
            }

        }

    }

    // sfdx-project.json's sourceApiVersion, ONLY IN THE SHAPE A package.xml TAKES; THE CLI CHOOSES WHEN THERE IS NONE
    private static readSourceApiVersion(workspaceRoot: string): string | undefined {

        try {
            return RecipeCockpitMetadataDeploy.readApiVersion(SfdxProjectService.readSfdxProjectJson(SfdxProjectService.getSfdxProjectFilePath(workspaceRoot)).sourceApiVersion);
        } catch {
            return undefined;
        }

    }

    /*
        A success is INFORMATION, every other outcome a WARNING. "View output" opens the CLI's result
        file when there is one; a permission set deploy that landed also offers "Assign permission
        sets to me…", routed through routePanelMessage like a click so every assign guard holds. NOT
        AWAITED: the run ends, and gives the panel its buttons back, without waiting for a click.
    */
    private static showMetadataDeployNotification(severity: 'information' | 'warning',
                                                    notificationText: string,
                                                    outputFilePath: string | undefined,
                                                    workspaceRoot: string,
                                                    assignFollowUp?: { cockpitPanel: vscode.WebviewPanel; treeKey: string; orgUsername: string }) {

        const actions = [
            ...( outputFilePath ? [RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL] : [] ),
            ...( assignFollowUp ? [RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL] : [] )
        ];
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);
        const shown = severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions);

        Promise.resolve(shown)
            .then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_DEPLOY_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The deploy result file no longer exists in this workspace.');
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL && assignFollowUp && this.recipeCockpitPanel === assignFollowUp.cockpitPanel ) {
                    const panelState = this.recipeCockpitPanelState;
                    // THE SELECTION ONLY WHEN IT IS THE ORG THE SETS WERE DEPLOYED TO; OTHERWISE THE ASSIGN ASKS FOR AN ORG ITSELF
                    const isDeployedOrgSelected = panelState.dataOrgSelection?.orgDetail.username === assignFollowUp.orgUsername;
                    const assignAction = this.routePanelMessage({
                        command: 'assignTreePermissionSets',
                        treeKey: assignFollowUp.treeKey,
                        ...( isDeployedOrgSelected && panelState.dataOrgSelection ? { orgIndex: panelState.dataOrgSelection.orgIndex } : {} )
                    }, panelState);
                    if ( assignAction ) {
                        await this.executePanelAction(assignFollowUp.cockpitPanel, assignAction);
                    }
                }
            })
            .catch(() => undefined);

    }

    private static isValidationRuleRetrieveInFlight = false;

    private static validationRuleRetrieveRunStateMessage: IRecipeCockpitValidationRuleRetrieveStateMessage | undefined;

    // KEPT FOR THE WINDOW WHILE RUNNING, STORED ON WHICHEVER PANEL STATE IS CURRENT, AND POSTED TO WHICHEVER PANEL IS OPEN
    private static setValidationRuleRetrieveState(retrieveStateMessage: IRecipeCockpitValidationRuleRetrieveStateMessage) {

        this.validationRuleRetrieveRunStateMessage = retrieveStateMessage.isRunning ? retrieveStateMessage : undefined;
        this.recipeCockpitPanelState.validationRuleRetrieveStateMessage = retrieveStateMessage;

        if ( this.recipeCockpitPanel ) {
            this.postToPanel(this.recipeCockpitPanel, retrieveStateMessage);
        }

    }

    private static adoptValidationRuleRetrieveRunState(panelState: IRecipeCockpitPanelState) {

        if ( this.isValidationRuleRetrieveInFlight && this.validationRuleRetrieveRunStateMessage ) {
            panelState.validationRuleRetrieveStateMessage = this.validationRuleRetrieveRunStateMessage;
        }

    }

    /*
        "Retrieve validation rules…" (#326), for one tree of the model on screen: the org is ALWAYS
        asked for in the command palette, over every connected org (a retrieve only reads), even when
        the Treecipe tab has one selected; then a modal names the objects, the org, where new files go
        and how many local rule files the org's version overwrites; then one
        "sf project retrieve start" runs in project mode, cancellable. Nothing is deployed, and the
        recipe is not regenerated: the notification offers Generate Treecipe, which applies the rules
        (#324). One retrieve per window.
    */
    private static async retrieveTreeValidationRulesFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string) {

        const panelState = this.recipeCockpitPanelState;
        const tree = panelState.recipeDataMessage?.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( this.isValidationRuleRetrieveInFlight || !tree ) {
            this.postToPanel(cockpitPanel, this.validationRuleRetrieveRunStateMessage
                ?? { command: 'validationRuleRetrieveState', isRunning: false, treeKey: treeKey });
            return;
        }

        this.isValidationRuleRetrieveInFlight = true;
        this.setValidationRuleRetrieveState({ command: 'validationRuleRetrieveState', isRunning: true, treeKey: treeKey });

        try {
            await this.performValidationRuleRetrieve(panelState.workspaceRoot, tree.customName || tree.title, tree.objects.map(treeObject => treeObject.objectApiName));
        } finally {
            this.isValidationRuleRetrieveInFlight = false;
            this.setValidationRuleRetrieveState({ command: 'validationRuleRetrieveState', isRunning: false, treeKey: treeKey });
            await this.refreshTroubleshootingSummary(treeKey);
            await this.refreshTreeValidationRules(treeKey);
        }

    }

    private static async performValidationRuleRetrieve(workspaceRoot: string, treeLabel: string, treeObjectApiNames: string[]) {

        const refuse = (refusalText: string) => this.showValidationRuleRetrieveNotification('warning', refusalText, undefined, workspaceRoot, false);

        const { retrievable: objectApiNames, refused: refusedObjectApiNames } = RecipeCockpitValidationRuleRetrieve.partitionObjectApiNames(treeObjectApiNames);

        if ( objectApiNames.length === 0 ) {
            return refuse(`No validation rules were retrieved: no object of ${treeLabel} has an api name.`);
        }

        if ( objectApiNames.length > VALIDATION_RULE_RETRIEVE_MAX_OBJECTS ) {
            return refuse(`No validation rules were retrieved: ${treeLabel} has ${objectApiNames.length} objects, and at most ${VALIDATION_RULE_RETRIEVE_MAX_OBJECTS} can be retrieved at once.`);
        }

        let packageDirectoryPaths: string[];
        let defaultPackageDirectoryPath: string;
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
            defaultPackageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
        } catch (projectError) {
            return refuse(`No validation rules were retrieved: ${this.describeThrown(projectError)}`);
        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await SalesforceOrgService.promptForAuthorizedOrg(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ORG_PLACEHOLDER);
        } catch (listError) {
            return refuse(`No validation rules were retrieved: ${this.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return;
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const packageDirectoryRelativePath = path.relative(workspaceRoot, defaultPackageDirectoryPath).split(path.sep).join('/') || '.';
        const localRuleFileCount = RecipeCockpitValidationRuleRetrieve.countLocalValidationRuleFiles(workspaceRoot, packageDirectoryPaths, objectApiNames);

        const confirmation = await this.confirmInPanel(
            `Retrieve the validation rules of ${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'} of ${this.toSingleLine(treeLabel)} from ${this.toSingleLine(orgLabel)}?`,
            {
                detail: RecipeCockpitValidationRuleRetrieve.buildConfirmationDetail(treeLabel, orgLabel, objectApiNames, packageDirectoryRelativePath, localRuleFileCount),
                isDestructive: true
            },
            RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_CONFIRM_LABEL ) {
            return;
        }

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE PROMPT OR THE MODAL WAS OPEN
        const currentPanelState = this.recipeCockpitPanelState;
        if ( currentPanelState.insertStateMessage || currentPanelState.permissionSetAssignStateMessage?.isRunning || this.isMetadataDeployInFlight ) {
            return refuse(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL);
        }

        let retrieveArguments: string[];
        try {
            retrieveArguments = RecipeCockpitValidationRuleRetrieve.buildValidationRuleRetrieveArguments(objectApiNames, orgDetail.username);
        } catch (argumentError) {
            return refuse(`No validation rules were retrieved: ${this.describeThrown(argumentError)}`);
        }

        const retrieveRun = await this.runCancellableCli(
            RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: retrieving validation rules from ${orgDetail.username}`),
            retrieveArguments,
            VALIDATION_RULE_RETRIEVE_TIMEOUT_MILLISECONDS,
            workspaceRoot
        );

        // A CANCEL CAN COME AFTER THE CLI WROTE FILES, SO GENERATE TREECIPE IS OFFERED AS AFTER A TIMEOUT
        if ( retrieveRun.isCancelled ) {
            return this.showValidationRuleRetrieveNotification('warning', `The retrieve of validation rules from ${orgLabel} was cancelled, so which rule files were written is unknown.`, undefined, workspaceRoot, true);
        }

        const retrievePayload = ScratchOrgService.readCliJsonPayload(retrieveRun.invocation);
        const retrieveOutcome: ValidationRuleRetrieveOutcome = RecipeCockpitValidationRuleRetrieve.parseValidationRuleRetrieveOutput(retrieveRun.invocation, objectApiNames, retrievePayload);
        const retrieveOutputFilePath = retrieveRun.invocation.spawnError || retrieveRun.invocation.isOutputTooLarge
            ? undefined
            : ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, 'validation-rule-retrieve', retrieveRun.invocation, new Date(), retrievePayload);
        const refusedText = refusedObjectApiNames.length > 0
            ? ` Skipped ${refusedObjectApiNames.length} ${refusedObjectApiNames.length === 1 ? 'name that is' : 'names that are'} not an api name.`
            : '';

        switch ( retrieveOutcome.kind ) {

            case 'retrieved': {
                const { ruleCount, objectApiNamesWithRules, failureMessages } = retrieveOutcome;
                const retrievedText = ruleCount === 0
                    ? `${orgLabel} holds no validation rule for the ${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'} of ${treeLabel}, so nothing was written.`
                    : `Retrieved ${ruleCount} validation ${ruleCount === 1 ? 'rule' : 'rules'} for ${objectApiNamesWithRules.length} of ${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'} of ${treeLabel} from ${orgLabel}: ${objectApiNamesWithRules.join(', ')}. Generate Treecipe applies them to the recipe.`;
                if ( failureMessages.length > 0 ) {
                    return this.showValidationRuleRetrieveNotification('warning', `${retrievedText} ${failureMessages.length} could not be retrieved: ${failureMessages.join('; ')}.${refusedText}`, retrieveOutputFilePath, workspaceRoot, ruleCount > 0);
                }
                return this.showValidationRuleRetrieveNotification(refusedText ? 'warning' : 'information', `${retrievedText}${refusedText}`, refusedText ? retrieveOutputFilePath : undefined, workspaceRoot, ruleCount > 0);
            }

            case 'cliNotInstalled':
                return refuse(retrieveOutcome.failureMessage);

            case 'unconfirmed':
                return this.showValidationRuleRetrieveNotification('warning', retrieveOutcome.failureMessage, retrieveOutputFilePath, workspaceRoot, true);

            case 'failed':
                return this.showValidationRuleRetrieveNotification('warning', `No validation rules were retrieved from ${orgLabel}: ${retrieveOutcome.failureMessage}`, retrieveOutputFilePath, workspaceRoot, false);

        }

    }

    /*
        A retrieve's ONE notification: information on a success, a warning otherwise. "Generate
        Treecipe" is offered whenever rule files may have been written, since #324 applies the rules
        at generation; "View output" whenever a warning has a result file. NOT AWAITED: the run ends,
        and gives the panel its button back, without waiting for the reader.
    */
    private static showValidationRuleRetrieveNotification(severity: 'information' | 'warning',
                                                            notificationText: string,
                                                            outputFilePath: string | undefined,
                                                            workspaceRoot: string,
                                                            isGenerateOffered: boolean) {

        const actions = [
            ...( isGenerateOffered ? [RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL] : [] ),
            ...( outputFilePath ? [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL] : [] )
        ];
        const escapedText = RecipeYamlScalar.escapeForNotification(notificationText);
        const shown = severity === 'information'
            ? vscode.window.showInformationMessage(escapedText, ...actions)
            : vscode.window.showWarningMessage(escapedText, ...actions);

        Promise.resolve(shown)
            .then(async chosenAction => {
                if ( chosenAction === RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_GENERATE_LABEL ) {
                    await this.generateTreecipeAfterValidationRuleRetrieve();
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL && outputFilePath ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(outputFilePath, workspaceRoot, 'The validation rule retrieve result file no longer exists in this workspace.');
                }
            })
            .catch(retrieveFollowUpError => ErrorHandlingService.handleCapturedError(retrieveFollowUpError, 'openRecipeCockpit'));

    }

    /*
        The notification's "Generate Treecipe": through the open cockpit when there is one, so the
        panel reloads the run it writes, and refused while an insert holds the selection or a
        generation is already running. With no cockpit open it runs the command itself.
    */
    private static async generateTreecipeAfterValidationRuleRetrieve() {

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;

        if ( !cockpitPanel ) {
            await vscode.commands.executeCommand(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND);
            return;
        }

        if ( panelState.isGenerateTreecipeInFlight || panelState.insertStateMessage ) {
            VSCodeWorkspaceService.showWarningMessage('Generate Treecipe was not started: a generation or an insert is running. Run it once that has finished.');
            return;
        }

        await this.generateTreecipeAndReload(cockpitPanel, panelState);

    }

    private static isPermissionSetGenerateInFlight = false;

    /*
        "Generate permission set…" (#306): one permission set granting Create and Read on every
        object the tree inserts and access to its recipe fields, written to
        <default package directory>/main/default/permissionsets/SDT_Treecipe/ after a modal that says
        it will not be deployed. The cockpit deploys no metadata (#302): the notification offers the
        deploy command for the clipboard, and "Assign permission sets to me…", which goes through the
        router like a click so every guard of the assign still holds.
    */
    private static async generateTreePermissionSetFromPanel(cockpitPanel: vscode.WebviewPanel, treeKey: string) {

        if ( this.isPermissionSetGenerateInFlight ) {
            return;
        }

        this.isPermissionSetGenerateInFlight = true;

        try {
            await this.performPermissionSetGenerate(cockpitPanel, treeKey);
        } finally {
            this.isPermissionSetGenerateInFlight = false;
            await this.refreshTroubleshootingSummary(treeKey);
        }

    }

    private static async performPermissionSetGenerate(cockpitPanel: vscode.WebviewPanel, treeKey: string) {

        const panelState = this.recipeCockpitPanelState;
        const workspaceRoot = panelState.workspaceRoot;
        const recipeViewModel = panelState.recipeDataMessage?.recipe;
        const tree = recipeViewModel?.trees.find(recipeTree => recipeTree.treeKey === treeKey);

        if ( !recipeViewModel || !tree ) {
            return;
        }

        const treeLabel = tree.customName || tree.title;
        const refuse = (refusalText: string) => {
            VSCodeWorkspaceService.showWarningMessage(RecipeYamlScalar.escapeForNotification(`No permission set was written for ${this.toSingleLine(treeLabel)}: ${refusalText}`));
        };

        const permissionSetName = RecipeCockpitPermissionSetGenerate.buildPermissionSetName(tree.folderName);
        if ( !permissionSetName ) {
            refuse(`its folder name ${this.toSingleLine(tree.folderName)} does not make a permission set name.`);
            return;
        }

        let packageDirectoryPath: string;
        let objectsDirectoryPath: string;
        try {
            packageDirectoryPath = RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(workspaceRoot);
            objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(workspaceRoot);
        } catch (projectError) {
            refuse(this.describeThrown(projectError));
            return;
        }

        // listTreeInsertObjectApiNames ANSWERS ONLY OBJECTS THE RECIPE HOLDS, SO EACH IS ONE OF recipeViewModel.objects
        const insertObjectApiNames = new Set(this.listTreeInsertObjectApiNames(recipeViewModel, tree));
        const plan = await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, recipeViewModel.objects
            .filter(objectViewModel => insertObjectApiNames.has(objectViewModel.objectApiName))
            .map(objectViewModel => ({
                objectApiName: objectViewModel.objectApiName,
                fieldApiNames: objectViewModel.fields
                    .filter(fieldViewModel => !fieldViewModel.isOnlyInRecipeFile)
                    .map(fieldViewModel => fieldViewModel.fieldApiName)
            })));

        if ( plan.objectApiNames.length === 0 ) {
            refuse('none of its objects has an api name.');
            return;
        }

        const permissionSetFilePath = RecipeCockpitPermissionSetGenerate.getPermissionSetFilePath(packageDirectoryPath, permissionSetName);
        const relativeFilePath = path.relative(workspaceRoot, permissionSetFilePath).split(path.sep).join('/');
        const isOverwrite = fs.existsSync(permissionSetFilePath);
        const describeCount = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
        const objectCountText = describeCount(plan.objectApiNames.length, 'object');
        const fieldCountText = describeCount(plan.fieldPermissions.length, 'field');

        const confirmation = await this.confirmInPanel(
            `${isOverwrite ? 'Overwrite' : 'Write'} the permission set ${permissionSetName} for ${this.toSingleLine(treeLabel)}?`,
            {
                isDestructive: isOverwrite,
                detail: [
                    `File: ${relativeFilePath}`,
                    `Grants Create and Read on ${objectCountText} and access to ${fieldCountText}, read-only where the org computes the value.`,
                    ...( isOverwrite ? ['The file already exists and will be overwritten: Treecipe owns this file.'] : [] ),
                    'It will not be deployed: deploy it with your own flow, then assign it with "Assign permission sets to me…".'
                ].join('\n')
            },
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL ) {
            return;
        }

        // THE ROUTER CHECKED THESE AT THE CLICK; ONE CAN HAVE STARTED WHILE THE MODAL WAS OPEN, AND NOTHING AWAITS BETWEEN HERE AND THE WRITE
        const currentPanelState = this.recipeCockpitPanelState;
        if ( currentPanelState.wireLookupStateMessage || currentPanelState.permissionSetAssignStateMessage?.isRunning || this.isMetadataDeployInFlight ) {
            refuse('a recipe write, a permission set assignment or a metadata deploy started meanwhile. Try again once it has finished.');
            return;
        }

        const permissionSetFolderPath = path.dirname(permissionSetFilePath);
        try {
            // THE DEEPEST FOLDER THAT EXISTS IS CHECKED BEFORE ANY IS MADE: A LINKED ANCESTOR WOULD OTHERWISE GET FOLDERS MADE OUTSIDE THE WORKSPACE
            let existingAncestorPath = permissionSetFolderPath;
            while ( !fs.existsSync(existingAncestorPath) && path.dirname(existingAncestorPath) !== existingAncestorPath ) {
                existingAncestorPath = path.dirname(existingAncestorPath);
            }
            if ( !SfdxProjectService.isPathContainedInWorkspace(existingAncestorPath, workspaceRoot) ) {
                refuse(`${relativeFilePath} is not inside this workspace.`);
                return;
            }
            fs.mkdirSync(permissionSetFolderPath, { recursive: true });
            // CHECKED AGAIN ONCE THE FOLDER EXISTS: writeFileSync FOLLOWS A LINKED FOLDER WHEREVER IT POINTS
            if ( !SfdxProjectService.isPathContainedInWorkspace(permissionSetFolderPath, workspaceRoot) ) {
                refuse(`${relativeFilePath} is not inside this workspace.`);
                return;
            }
            if ( fs.existsSync(permissionSetFilePath) && !fs.lstatSync(permissionSetFilePath).isFile() ) {
                refuse(`${relativeFilePath} exists and is not a file, so it was left as it is.`);
                return;
            }
            fs.writeFileSync(permissionSetFilePath, RecipeCockpitPermissionSetGenerate.buildPermissionSetXml(
                RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel(treeLabel, permissionSetName),
                tree.folderName,
                plan
            ), 'utf8');
        } catch (writeError) {
            refuse(this.describeThrown(writeError));
            return;
        }

        const leftOutTexts = ([
            [plan.notGrantableFieldCount, 'required or master-detail field', ', which Salesforce does not take in a permission set'],
            [plan.requiredUnknownFieldCount, 'standard field', ' without <required>false</required> in its source file'],
            [plan.unreadableFieldCount, 'field', ' whose source file could not be read'],
            [plan.skippedNameCount, 'invalid api name', '']
        ] as Array<[number, string, string]>)
            .filter(([count]) => count > 0)
            .map(([count, noun, reason]) => `${describeCount(count, noun)}${reason}`);

        this.showGeneratedPermissionSetNotification(
            RecipeYamlScalar.escapeForNotification(`Wrote ${permissionSetName} to ${relativeFilePath}: Create and Read on ${objectCountText}, access to ${fieldCountText}.${leftOutTexts.length > 0 ? ` Left out: ${leftOutTexts.join('; ')}.` : ''} Deploy it, then assign it.`),
            permissionSetName,
            permissionSetFilePath,
            workspaceRoot,
            cockpitPanel,
            treeKey
        );

    }

    // NOT AWAITED: THE BUTTONS ACT WHENEVER THE READER CLICKS, ON WHATEVER IS ON SCREEN THEN
    private static showGeneratedPermissionSetNotification(notificationText: string,
                                                            permissionSetName: string,
                                                            permissionSetFilePath: string,
                                                            workspaceRoot: string,
                                                            cockpitPanel: vscode.WebviewPanel,
                                                            treeKey: string) {

        Promise.resolve(vscode.window.showInformationMessage(
            notificationText,
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL,
            RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL,
            RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL
        ))
            .then(async chosenAction => {

                if ( chosenAction === RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL ) {
                    await VSCodeWorkspaceService.openWorkspaceResultFile(permissionSetFilePath, workspaceRoot, 'The generated permission set no longer exists in this workspace.');
                } else if ( chosenAction === RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL ) {
                    await vscode.env.clipboard.writeText(RecipeCockpitPermissionSetGenerate.buildDeployCommand(permissionSetName));
                } else if ( chosenAction === RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL && this.recipeCockpitPanel === cockpitPanel ) {
                    const panelState = this.recipeCockpitPanelState;
                    const assignAction = this.routePanelMessage({
                        command: 'assignTreePermissionSets',
                        treeKey: treeKey,
                        ...( panelState.dataOrgSelection ? { orgIndex: panelState.dataOrgSelection.orgIndex } : {} )
                    }, panelState);
                    if ( assignAction ) {
                        await this.executePanelAction(cockpitPanel, assignAction);
                    }
                }

            })
            .catch(() => undefined);

    }

    private static async promptForPermissionSetOrg(): Promise<IAuthenticatedOrgDetail | undefined> {

        return await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
            SalesforceOrgService.listDataOrgDetails().then(dataOrgListing => ({
                orgDetails: dataOrgListing.orgDetails,
                emptyListMessage: this.buildDataOrgNoOrgsMessage(dataOrgListing.hiddenOrgReasonCounts)
            })),
            RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER
        );

    }

    // THE READER'S PICK, IN THE ORDER OFFERED; undefined WHEN THE PICK WAS DISMISSED OR LEFT EMPTY
    private static async promptForPermissionSets(permissionSets: IPermissionSetCandidate[], treeObjectCount: number): Promise<IPermissionSetCandidate[] | undefined> {

        const pickedItems = await vscode.window.showQuickPick(
            permissionSets.map(permissionSet => ({
                label: permissionSet.name,
                description: RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, treeObjectCount),
                detail: permissionSet.relativeFilePath,
                permissionSet: permissionSet
            })),
            { canPickMany: true, ignoreFocusOut: true, matchOnDescription: true, placeHolder: RECIPE_COCKPIT_PERMISSION_SET_PICK_PLACEHOLDER }
        );

        return pickedItems && pickedItems.length > 0 ? pickedItems.map(pickedItem => pickedItem.permissionSet) : undefined;

    }

    /*
        Everything is found and picked BEFORE an org is asked for, so a project with no permission
        set for the tree opens no picker; a dismissed pick or org prompt is a quiet cancel. After the
        confirmation the org is asked again whether it is a sandbox and, on the same connection,
        which picks it holds. No CLI process starts for a pick the org does not hold.
    */
    private static async performPermissionSetAssign(workspaceRoot: string,
                                                    treeLabel: string,
                                                    objectApiNames: string[],
                                                    resolveOrgDetail: () => Promise<IAuthenticatedOrgDetail | undefined>,
                                                    onCliStarted: (orgDetail: IAuthenticatedOrgDetail, coveredObjectApiNames: string[]) => void): Promise<IRecipeCockpitPermissionSetClosingState> {

        const refuse = (refusalText: string, closingState: IRecipeCockpitPermissionSetClosingState = {}): IRecipeCockpitPermissionSetClosingState => {
            this.showPermissionSetNotification(refusalText, undefined, workspaceRoot);
            return closingState;
        };

        let packageDirectoryPaths: string[];
        try {
            packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        } catch (projectError) {
            return refuse(`Nothing was assigned: ${this.describeThrown(projectError)}`);
        }

        const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(objectApiNames, workspaceRoot, packageDirectoryPaths);
        const skippedFilePaths = [...discovery.unparseableFilePaths, ...discovery.notApiNameFilePaths];

        if ( skippedFilePaths.length > 0 ) {
            const shownFilePaths = skippedFilePaths.slice(0, PERMISSION_SET_NOTIFICATION_SKIPS_SHOWN);
            const hiddenCount = skippedFilePaths.length - shownFilePaths.length;
            this.showPermissionSetNotification(
                `Skipped ${skippedFilePaths.length} permission set ${skippedFilePaths.length === 1 ? 'file' : 'files'} that could not be read as a permission set with an api name: ${shownFilePaths.join(', ')}${hiddenCount > 0 ? ` and ${hiddenCount} more` : ''}.`,
                undefined,
                workspaceRoot
            );
        }

        if ( discovery.permissionSets.length === 0 ) {
            return refuse(`No permission set in this workspace's source grants access to any object of ${treeLabel}, so nothing was assigned.`);
        }

        const pickedPermissionSets = await this.promptForPermissionSets(discovery.permissionSets, objectApiNames.length);
        if ( !pickedPermissionSets ) {
            return {};
        }

        if ( pickedPermissionSets.length > PERMISSION_SET_MAX_PICKS ) {
            return refuse(`Nothing was assigned: ${pickedPermissionSets.length} permission sets were chosen, and at most ${PERMISSION_SET_MAX_PICKS} can be assigned at once.`);
        }

        let orgDetail: IAuthenticatedOrgDetail | undefined;
        try {
            orgDetail = await resolveOrgDetail();
        } catch (listError) {
            return refuse(`Nothing was assigned: ${this.describeThrown(listError)}`);
        }

        if ( !orgDetail ) {
            return {};
        }

        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM, AND THIS LABEL IS IN EVERY ONE THIS RUN SHOWS
        const orgLabel = orgDetail.alias ? `${orgDetail.alias} · ${orgDetail.username}` : orgDetail.username;
        const describePermissionSets = (count: number) => `${count} ${count === 1 ? 'permission set' : 'permission sets'}`;

        const confirmation = await this.confirmInPanel(
            `Assign ${describePermissionSets(pickedPermissionSets.length)} for ${this.toSingleLine(treeLabel)} to ${this.toSingleLine(orgDetail.username)} in ${this.toSingleLine(orgLabel)}?`,
            {
                detail: RecipeCockpitPermissionSetAssign.buildConfirmationDetail(treeLabel, orgLabel, orgDetail.username, pickedPermissionSets, objectApiNames.length),
                isDestructive: true
            },
            RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL
        );

        if ( confirmation !== RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL ) {
            return {};
        }

        let querySource: IOrgQuerySource;
        let orgTypeDetail: IOrgTypeDetail | undefined;
        try {
            querySource = SalesforceOrgService.toQuerySource(await SalesforceOrgService.getConnection(orgDetail.username));
            orgTypeDetail = await SalesforceOrgService.queryOrganizationType(querySource);
        } catch (connectionError) {
            return refuse(`Nothing was assigned: could not connect to ${orgLabel}: ${this.describeThrown(connectionError)}`);
        }

        if ( orgTypeDetail?.isSandbox !== true ) {
            return refuse(`Nothing was assigned: ${orgLabel} ${orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}` : 'could not say whether it is a sandbox'}. Permission sets are assigned only in a sandbox or scratch org.`);
        }

        // ONLY AN ORG THAT ANSWERED IT IS A SANDBOX BECOMES THE SELECTION, WHATEVER FOLLOWS
        const confirmed: IRecipeCockpitPermissionSetClosingState = { orgDetail: orgDetail, isConfirmed: true };

        let orgPermissionSetNames: string[];
        try {
            orgPermissionSetNames = await SalesforceOrgService.queryPermissionSetNames(querySource, pickedPermissionSets.map(permissionSet => permissionSet.name));
        } catch {
            return refuse(`Nothing was assigned: ${orgLabel} could not be asked which of the permission sets it holds. Try again.`, confirmed);
        }

        const { presentPermissionSets, missingPermissionSets } = RecipeCockpitPermissionSetAssign.partitionByOrgPresence(pickedPermissionSets, orgPermissionSetNames);

        if ( missingPermissionSets.length > 0 ) {
            this.showPermissionSetNotification(
                RecipeCockpitPermissionSetAssign.buildMissingPermissionSetsMessage(missingPermissionSets.map(permissionSet => permissionSet.name), orgLabel),
                undefined,
                workspaceRoot
            );
        }

        if ( presentPermissionSets.length === 0 ) {
            return confirmed;
        }

        const permissionSetNames = presentPermissionSets.map(permissionSet => permissionSet.name);
        const permissionSetText = describePermissionSets(permissionSetNames.length);
        // EVERY OBJECT A PICK GRANTS ON, NOT ONLY THIS TREE'S: ANOTHER CARD'S DESCRIBE OF IT CHANGES TOO
        const lowerGrantedNames = new Set(presentPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames).map(objectApiName => objectApiName.toLowerCase()));
        const coveredObjectApiNames = [...new Set([
            ...objectApiNames,
            ...presentPermissionSets.flatMap(permissionSet => permissionSet.grantedObjectApiNames).filter(objectApiName => SalesforceApiName.isApiName(objectApiName))
        ])].filter(objectApiName => lowerGrantedNames.has(objectApiName.toLowerCase()));
        const assignArguments = RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(permissionSetNames, orgDetail.username);

        onCliStarted(orgDetail, coveredObjectApiNames);

        const assignRun = await this.runCancellableCli(RecipeYamlScalar.escapeForNotification(`Recipe Cockpit: assigning ${permissionSetText} to ${orgDetail.username}`), assignArguments, PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS, workspaceRoot);

        if ( assignRun.isCancelled ) {
            return refuse(`The assignment of ${permissionSetText} in ${orgLabel} was cancelled, so which were assigned is unknown.`, confirmed);
        }

        const assignPayload = ScratchOrgService.readCliJsonPayload(assignRun.invocation);
        const assignOutcome: PermissionSetAssignOutcome = RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(assignRun.invocation, permissionSetNames, assignPayload);
        const assignOutputFilePath = assignRun.invocation.spawnError || assignRun.invocation.isOutputTooLarge
            ? undefined
            : ScratchOrgService.writeOrgOperationResult(workspaceRoot, orgDetail.username, 'permission-set-assign', assignRun.invocation, new Date(), assignPayload);

        switch ( assignOutcome.kind ) {

            case 'assigned': {
                const alreadyText = assignOutcome.alreadyAssignedNames.length > 0
                    ? ` ${assignOutcome.alreadyAssignedNames.join(', ')} ${assignOutcome.alreadyAssignedNames.length === 1 ? 'was' : 'were'} already assigned.`
                    : '';
                VSCodeWorkspaceService.showInformationMessage(RecipeYamlScalar.escapeForNotification(`Assigned ${permissionSetText} for ${treeLabel} to ${orgDetail.username} in ${orgLabel}.${alreadyText}`));
                return { ...confirmed, isAssigned: true };
            }

            case 'cliNotInstalled':
                return refuse(assignOutcome.failureMessage, confirmed);

            case 'unconfirmed':
                this.showPermissionSetNotification(assignOutcome.failureMessage, assignOutputFilePath, workspaceRoot);
                return confirmed;

            case 'notAllAssigned': {
                const landedNames = [...assignOutcome.assignedNames, ...assignOutcome.alreadyAssignedNames];
                this.showPermissionSetNotification([
                    `${assignOutcome.failedNames.join(', ')} could not be assigned to ${orgDetail.username} in ${orgLabel}: ${assignOutcome.failureMessages.join('; ')}`,
                    ...( landedNames.length > 0 ? [`Assigned: ${landedNames.join(', ')}.`] : [] )
                ].join(' '), assignOutputFilePath, workspaceRoot);
                return { ...confirmed, isAssigned: landedNames.length > 0 };
            }

        }

    }

    private static describeThrown(thrownValue: unknown): string {

        return String(( thrownValue as Error | undefined )?.message ?? thrownValue);

    }

    /*
        Every outcome but a success is a WARNING, and its only follow-up is the notification's own
        "View output" button when the CLI left a result file. NOT AWAITED: the run ends, and gives the
        panel its button back, without waiting for the reader to dismiss it.
    */
    private static showPermissionSetNotification(notificationText: string, outputFilePath: string | undefined, workspaceRoot: string) {

        const actions = outputFilePath ? [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL] : [];

        Promise.resolve(vscode.window.showWarningMessage(RecipeYamlScalar.escapeForNotification(notificationText), ...actions))
            .then(chosenAction => chosenAction === RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL && outputFilePath
                ? this.openPermissionSetOutput(outputFilePath, workspaceRoot)
                : undefined)
            .catch(() => undefined);

    }

    // THE PATH IS THE HOST'S OWN, AND STILL RE-CHECKED: THE FILE CAN HAVE BEEN REPLACED BY A LINK OUT OF THE WORKSPACE SINCE
    private static async openPermissionSetOutput(outputFilePath: string, workspaceRoot: string) {

        if ( !this.isUsableWorkspacePath(outputFilePath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage('The permission set result file no longer exists in this workspace.');
            return;
        }

        await VSCodeWorkspaceService.openFileInEditor(outputFilePath);

    }

    // ONE CLI RUN IN PROJECT MODE BEHIND A CANCELLABLE PROGRESS NOTIFICATION; A CANCEL KILLS THE PROCESS TREE
    private static async runCancellableCli(progressTitle: string,
                                            cliArguments: string[],
                                            timeoutMilliseconds: number,
                                            workspaceRoot: string,
                                            maxBufferBytes: number = PERMISSION_SET_MAX_BUFFER_BYTES): Promise<{ invocation: ISalesforceCliInvocationResult; isCancelled: boolean }> {

        let isCancelled = false;

        const invocation = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: true
        }, async (_progress, cancellationToken) => {

            let killCurrentProcess: (() => void) | undefined;
            cancellationToken.onCancellationRequested(() => {
                isCancelled = true;
                killCurrentProcess?.();
            });

            return await PicklistDependencyCheckService.runSalesforceCli(
                cliArguments,
                (killChildProcess: () => void) => {
                    killCurrentProcess = killChildProcess;
                    if ( cancellationToken.isCancellationRequested ) {
                        isCancelled = true;
                        killChildProcess();
                    }
                },
                timeoutMilliseconds,
                { workingDirectoryPath: path.resolve(workspaceRoot), maxBufferBytes: maxBufferBytes }
            );

        });

        return { invocation: invocation, isCancelled: isCancelled };

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

    // ONLY WHY AN AUTHORIZED ORG MAY BE MISSING, NEVER HOW MANY OR WHICH REASONS (#284)
    static buildDataOrgHiddenNote(hiddenOrgReasonCounts: IHiddenOrgReasonCounts): string {

        return SalesforceOrgService.countHiddenOrgs(hiddenOrgReasonCounts) === 0 ? '' : RECIPE_COCKPIT_HIDDEN_ORGS_NOTE;

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
            Listed because the CLI knew it as a sandbox or scratch org, or because it is the CLI's
            default org (#305) -- but the org's own answer is the one that counts. An org that
            answers it is not a sandbox, or cannot say, is asked NOTHING more: no describe, no insert.
        */
        if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {

            postSelection(`${orgLabel} ${dataOrgSelection.orgTypeDetail ? `answered that it is ${SalesforceOrgService.buildOrgTypeLabel(dataOrgSelection.orgTypeDetail)}` : 'could not say whether it is a sandbox'}, so the Treecipe tab asked it nothing more. It inserts records only into a sandbox or scratch org.`);

            if ( isSelectionCurrent() ) {
                this.postToPanel(cockpitPanel, {
                    command: 'dataOrgReadiness',
                    objects: [...( await this.computeCreateReadiness(orgDetail.username, connection, objectApiNames, dataOrgSelection.orgTypeDetail) ).values()],
                    createTargets: [],
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


        dataOrgSelection.isReadinessPosted = true;
        this.postToPanel(cockpitPanel, {
            command: 'dataOrgReadiness',
            objects: objectApiNames.map(objectApiName => readinessByObjectApiName.get(objectApiName)).filter(readiness => !!readiness),
            createTargets: [...readinessByCreateKey.values()],
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

    // EVERY CARD THAT CAN GENERATE: "Generate fake data and insert" GENERATES THE SAME WAY, SO IT IS OFFERED ON THE SAME CARDS
    static collectInsertableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

        return recipeViewModel.trees
            .filter(tree => !!tree.runFakerRecipeFileName)
            .map(tree => tree.treeKey);

    }

    // EVERY CARD WITH A FOLDER AND AN OBJECT: "Assign permission sets to me…" IS OFFERED WHATEVER THE ORG ANSWERED (#274)
    static collectAssignableTreeKeys(recipeViewModel: IRecipeCockpitRecipeViewModel): string[] {

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
                            datasetFolderPath: string): boolean {

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

        this.applyPreferencesToDataset(addedDataset.dataset, this.readDatasetPreferences(this.recipeCockpitWorkspaceState));

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
        let isInsertFinished = false;
        let hasInsertFailed = false;
        let insertError: unknown;

        try {

            isDatasetWritten = await this.performTreeInsert(cockpitPanel, panelState, insertAction, datasetFolderPath => {
                isDatasetWritten = true;
                insertedDatasetFolderPath = datasetFolderPath;
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
                                        && this.postAddedDataset(cockpitPanel, panelState, clickedRecipeDataMessage, insertedDatasetFolderPath);

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

    /*
        "Generate fake data and insert" with no org chosen yet (#375). The org is asked for in the
        command palette over the same listing the Target Org Management dropdown draws (sandbox,
        scratch and the CLI's default only), then put in the dropdown and checked exactly as a pick
        there is -- connection, Organization row, describes -- and remembered. Only an org that
        answered it is a sandbox goes on to the insert, through the router like a click, so every
        guard of a click holds; the insert re-checks readiness and the Organization row as always.
        The insert's state holds the window while the reader chooses, and is given back on every
        way out, because the panel disabled the button on the click.
    */
    private static async insertTreeIntoPromptedOrg(cockpitPanel: vscode.WebviewPanel,
                                                    panelState: IRecipeCockpitPanelState,
                                                    promptAction: Extract<RecipeCockpitPanelAction, { kind: 'promptInsertOrg' }>) {

        const { treeKey } = promptAction;
        const clickedRecipeDataMessage = panelState.recipeDataMessage;
        const isClickStillCurrent = () => this.recipeCockpitPanel === cockpitPanel
                                            && this.recipeCockpitPanelState === panelState
                                            && panelState.recipeDataMessage === clickedRecipeDataMessage;
        const giveButtonBack = () => isClickStillCurrent() && this.postToPanel(cockpitPanel, { command: 'insertState', isRunning: false, treeKey: treeKey });

        panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: treeKey };
        this.postToPanel(cockpitPanel, panelState.insertStateMessage);

        let dataOrgListing: IDataOrgListing | undefined;
        let chosenOrgDetail: IDataOrgDetail | undefined;

        // THE INSERT'S STATE HOLDS THE WINDOW UNTIL THE PICK HAS BEEN CHECKED, SO NO RUN THAT CHANGES THE SELECTION STARTS MEANWHILE AND A REVEAL REPLAYS IT
        try {

            try {
                chosenOrgDetail = await VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed(
                    SalesforceOrgService.listDataOrgDetails(panelState.workspaceRoot).then(listing => {
                        dataOrgListing = listing;
                        return { orgDetails: listing.orgDetails, emptyListMessage: this.buildDataOrgNoOrgsMessage(listing.hiddenOrgReasonCounts) };
                    }),
                    RECIPE_COCKPIT_INSERT_ORG_PLACEHOLDER
                );
            } catch (listingError) {
                // THE PANEL DISABLED THE BUTTON ON THE CLICK, SO A LISTING THAT FAILED STILL GIVES IT BACK
                giveButtonBack();
                if ( listingError instanceof OrgConnectionStatusUnavailableError ) {
                    VSCodeWorkspaceService.showWarningMessage(`Nothing was generated or inserted: ${RecipeYamlScalar.escapeForNotification(listingError.message)}`);
                    return;
                }
                throw listingError;
            }

            // A DISMISSED PICK, A NEW MODEL, OR AN ORG CHOSEN IN THE DROPDOWN MEANWHILE: NOTHING MORE IS DONE
            const orgIndex = chosenOrgDetail && dataOrgListing ? dataOrgListing.orgDetails.findIndex(orgDetail => orgDetail.username === chosenOrgDetail.username) : -1;
            if ( orgIndex < 0 || !isClickStillCurrent() || panelState.dataOrgSelection ) {
                giveButtonBack();
                return;
            }

            panelState.dataOrgDetails = dataOrgListing.orgDetails;
            this.postToPanel(cockpitPanel, {
                command: 'dataOrgList',
                orgLabels: dataOrgListing.orgDetails.map(orgDetail => this.buildDataOrgListLabel(orgDetail)),
                selectedOrgIndex: orgIndex,
                noOrgsMessage: '',
                hiddenOrgNote: this.buildDataOrgHiddenNote(dataOrgListing.hiddenOrgReasonCounts),
                forgottenOrgNotice: '',
                renderSequence: clickedRecipeDataMessage.renderSequence
            });

            try {
                await this.selectDataOrg(cockpitPanel, panelState, orgIndex);
            } catch (selectionError) {
                giveButtonBack();
                throw selectionError;
            }

            const dataOrgSelection = panelState.dataOrgSelection;
            if ( !isClickStillCurrent() || dataOrgSelection?.orgDetail.username !== chosenOrgDetail.username ) {
                giveButtonBack();
                return;
            }

            if ( dataOrgSelection.orgTypeDetail?.isSandbox !== true ) {
                VSCodeWorkspaceService.showWarningMessage(`Nothing was generated or inserted: ${RecipeYamlScalar.escapeForNotification(this.buildDataOrgLabel(chosenOrgDetail))} ${dataOrgSelection.orgTypeDetail ? 'is not a sandbox or scratch org' : 'could not be checked'}, and the Treecipe tab inserts only into a sandbox or scratch org.`);
                giveButtonBack();
                return;
            }

        } finally {
            // RELEASED ONLY HERE: THE ROUTER BELOW ANSWERS ANY INSERT STILL IN FLIGHT WITH ITS STATE INSTEAD OF ROUTING IT
            panelState.insertStateMessage = undefined;
        }

        const routedInsert = this.routePanelMessage({ command: 'insertTree', treeKey: treeKey }, panelState);
        if ( routedInsert?.kind !== 'insertTree' ) {
            giveButtonBack();
            return;
        }

        await this.insertTreeIntoOrg(cockpitPanel, panelState, routedInsert);

    }

    // TRUE WHEN A DATA SET FOLDER WAS MADE; onDatasetFolderMade SAYS SO EVEN WHEN A LATER STEP THROWS
    private static async performTreeInsert(cockpitPanel: vscode.WebviewPanel,
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

        const confirmation = await this.confirmInPanel(
            `Generate ${treeLabel} and insert it into ${orgLabel}?`,
            { detail: this.buildInsertConfirmationDetail(orgLabel, dataOrgSelection.orgTypeDetail, tree, recipeDataMessage.recipe, recordTotalsByObject, outsideParentObjectApiNames, selectedFakerService, recipeFileLabel, outsidePickableLookups), isDestructive: true },
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

        const datasetFolderPath = await this.generateConfirmedDataset(recipeFilePath, filteredRecipe);

        if ( !datasetFolderPath || !this.isUsableWorkspacePath(datasetFolderPath, panelState.workspaceRoot) ) {
            return refuse(`${treeLabel} was not generated, so nothing was inserted into ${orgLabel}.`);
        }
        onDatasetFolderMade(datasetFolderPath);

        const insertResult = await CollectionsApiService.insertDataSetFolderIntoOrg(datasetFolderPath, connection, allOrNoneSelection, {
            prepareRecords: this.buildTreeInsertRecordPreparer(orgDetail.username, insertObjectApiNameSet, orgRecordIdsByObject, choiceCount => Math.floor(Math.random() * choiceCount), outsideParentsByObject),
            isFailureReportedByCaller: true
        });

        onInsertFinished();
        this.showTreeInsertNotification(insertResult, treeLabel, orgLabel, panelState.workspaceRoot, {
            runFolderName: recipeDataMessage.recipe.selectedRunFolderName,
            treeFolderName: tree.folderName
        });

        return true;

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

    /*
        How the tree insert ended, as ONE notification (#301), with the results file a button opens:
        "View errors" when a record failed or the insert stopped, "View results" otherwise. A stopped
        insert is an ERROR (#310), the one notification for it, since the shared insert was told not
        to show its own. The insert writes that file once it has sent a file, so a cancel before that
        offers no button. One that failed (#375) also names the first generated file that failed,
        opens it with "View failed file", and offers "Open Troubleshooting" on the sub-tab the first
        failure's error points at. The panel draws no line for it. NOT AWAITED, so the insert ends
        without waiting for the reader. treeLabel and orgLabel arrive escaped.
    */
    static showTreeInsertNotification(insertResult: IDataSetInsertResult, treeLabel: string, orgLabel: string, workspaceRoot: string, insertedTree?: { runFolderName: string; treeFolderName: string }) {

        const recordsText = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;
        const hasErrors = insertResult.failedRecordCount > 0 || insertResult.outcome === 'stopped';
        let severity: 'information' | 'warning' | 'error' = 'warning';
        let notificationText: string;

        if ( insertResult.outcome === 'cancelled' ) {
            notificationText = `The insert of ${treeLabel} into ${orgLabel} was cancelled${insertResult.isRolledBack ? ' and every record it had inserted was deleted' : ''}.`;
        } else if ( insertResult.outcome === 'stopped' ) {
            severity = 'error';
            notificationText = insertResult.isRolledBack
                ? `The insert of ${treeLabel} into ${orgLabel} stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen. ${recordsText(insertResult.failedRecordCount)} failed.`
                : `The insert of ${treeLabel} into ${orgLabel} stopped at a file that could not be inserted. ${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} kept, because all-or-none was not chosen, and ${insertResult.failedRecordCount} failed.`;
        } else if ( insertResult.failedRecordCount > 0 ) {
            notificationText = `${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} inserted into ${orgLabel} from ${treeLabel} and ${insertResult.failedRecordCount} failed. Nothing was rolled back.`;
        } else {
            severity = 'information';
            notificationText = `${recordsText(insertResult.savedRecordCount)} ${insertResult.savedRecordCount === 1 ? 'was' : 'were'} inserted into ${orgLabel} from ${treeLabel}.`;
        }

        if ( insertResult.requestFailureDetail ) {
            notificationText += ` The request for ${RecipeYamlScalar.escapeForNotification(insertResult.requestFailureDetail)}`;
        }

        const resultsFilePath = insertResult.resultsFilePath && fs.existsSync(insertResult.resultsFilePath) ? insertResult.resultsFilePath : undefined;
        const resultsFileAction = {
            label: hasErrors ? RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL : RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL,
            filePath: resultsFilePath,
            missingFileText: 'The insert results file no longer exists in this workspace.'
        };

        const failedFilePath = insertResult.failedFilePath;
        const hasFailedFile = typeof failedFilePath === 'string' && insertResult.outcome !== 'cancelled';

        if ( !hasFailedFile ) {
            VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [resultsFileAction], workspaceRoot);
            return;
        }

        const troubleshootingSubTab = RecipeCockpitInsertFailureTriage.resolveSubTab(insertResult.firstFailure);
        notificationText += ` The first file that failed is ${RecipeYamlScalar.escapeForNotification(path.basename(failedFilePath))}; its ${RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS[troubleshootingSubTab]} in the Troubleshooting tab may fix it.`;

        VSCodeWorkspaceService.showNotificationWithWorkspaceFiles(severity, notificationText, [
            { label: RECIPE_COCKPIT_INSERT_VIEW_FAILED_FILE_LABEL, filePath: fs.existsSync(failedFilePath) ? failedFilePath : undefined, missingFileText: 'The generated file that failed no longer exists in this workspace.' },
            resultsFileAction
        ], workspaceRoot, insertedTree && insertedTree.treeFolderName !== '' ? [{
            label: RECIPE_COCKPIT_INSERT_OPEN_TROUBLESHOOTING_LABEL,
            run: () => this.openTroubleshootingAfterInsert(workspaceRoot, { ...insertedTree, troubleshootingSubTab: troubleshootingSubTab })
        }] : []);

    }

    /*
        "Open Troubleshooting" (#375). On the cockpit open now, on the same run, with a card for the
        tree, the card is focused IN PLACE -- no reload, so the org selection and readiness stay.
        Otherwise the cockpit is opened through its command (the feature flag still applies) on that
        run, focused there once it is drawn. A run or tree folder gone from disk is a warning, and
        nothing is opened.
    */
    static async openTroubleshootingAfterInsert(workspaceRoot: string, focusRequest: IRecipeCockpitTroubleshootingFocusRequest) {

        const cockpitPanel = this.recipeCockpitPanel;
        const panelState = this.recipeCockpitPanelState;
        const recipeDataMessage = panelState.recipeDataMessage;
        const focusTree = recipeDataMessage && recipeDataMessage.recipe.selectedRunFolderName === focusRequest.runFolderName
            ? this.resolveTroubleshootingFocus(recipeDataMessage.recipe, focusRequest)
            : undefined;

        if ( cockpitPanel && panelState.workspaceRoot === workspaceRoot && recipeDataMessage && focusTree ) {
            /*
                A HIDDEN panel's document is gone (retainContextWhenHidden is off) and the reveal
                reloads it, so the focus rides on the model's replay until it is drawn, as an open's does.
            */
            if ( !cockpitPanel.visible ) {
                panelState.openFocusTree = focusTree;
                cockpitPanel.reveal(vscode.ViewColumn.One);
                return;
            }
            cockpitPanel.reveal(vscode.ViewColumn.One);
            this.postToPanel(cockpitPanel, { command: 'focusTree', focusTree: focusTree, renderSequence: recipeDataMessage.renderSequence });
            return;
        }

        const treeFolderPath = path.join(workspaceRoot, ConfigurationService.getGeneratedRecipesFolderPath(), focusRequest.runFolderName, focusRequest.treeFolderName);
        if ( !SfdxProjectService.isExistingDirectory(treeFolderPath) || !this.isUsableWorkspacePath(treeFolderPath, workspaceRoot) ) {
            VSCodeWorkspaceService.showWarningMessage(`The run ${RecipeYamlScalar.escapeForNotification(focusRequest.runFolderName)} or its tree ${RecipeYamlScalar.escapeForNotification(focusRequest.treeFolderName)} no longer exists, so the Troubleshooting tab was not opened.`);
            return;
        }

        await vscode.commands.executeCommand(RECIPE_COCKPIT_OPEN_COMMAND, { focusTroubleshooting: true, ...focusRequest });

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

        if ( !this.isPlainRecord(openOptions) || openOptions.focusTroubleshooting !== true ) {
            return undefined;
        }

        const { runFolderName, treeFolderName, troubleshootingSubTab } = openOptions;
        const isFolderName = (candidate: unknown): candidate is string => this.isBoundedText(candidate) && candidate !== '' && DatasetSourceService.isSafeFolderOrFileName(candidate);

        if ( !isFolderName(runFolderName) || !isFolderName(treeFolderName) || !( RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS as readonly unknown[] ).includes(troubleshootingSubTab) ) {
            return undefined;
        }

        return { runFolderName: runFolderName, treeFolderName: treeFolderName, troubleshootingSubTab: troubleshootingSubTab as RecipeCockpitTroubleshootingSubTab };

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
                ? ` (${perParentCount} per ${objectViewModel.countParentObjectApiName})`
                : '';
            return `  ${objectApiName}: ${objectTotal}${perParentText}`;
        });
        const excludedFieldApiNamesByObject = this.listExcludedFieldApiNamesByObject(tree);
        const fixedValues = tree.fixedValues ?? [];
        const validationRulesOff = [...this.listUnconstrainedValuesByObject(recipeViewModel, tree)]
            .flatMap(([objectApiName, valuesByField]) => [...valuesByField.keys()].map(fieldApiName => `${objectApiName}.${fieldApiName}`));

        return [
            `Org: ${orgLabel}`,
            `Type: ${SalesforceOrgService.buildOrgTypeLabel(orgTypeDetail)}`,
            `Recipe tree: ${tree.customName ?? tree.title} (${recipeFileLabel})`,
            `Backend: ${fakerService}`,
            'Records, inserted parents first:',
            ...objectLines,
            ...( excludedFieldApiNamesByObject.size > 0
                ? [`Unticked, not sent: ${[...excludedFieldApiNamesByObject].map(([objectApiName, fieldApiNames]) => fieldApiNames.map(fieldApiName => `${objectApiName}.${fieldApiName}`).join(', ')).join(', ')}`]
                : [] ),
            ...( fixedValues.length > 0
                ? [`Edited fields: ${fixedValues.map(fixedValue => `${fixedValue.objectApiName}.${fixedValue.fieldApiName} = ${fixedValue.value}`).join(', ')}`]
                : [] ),
            ...( validationRulesOff.length > 0
                ? [`Validation rules switched off, so the org may reject these values: ${validationRulesOff.join(', ')}`]
                : [] ),
            ...( outsidePickableLookups.length > 0
                ? [
                    'Lookups to objects this tree does not insert, each chosen next (Random parent, or parent records you search for; cancelling inserts nothing):',
                    ...outsidePickableLookups.map(({ objectApiName, lookup }) => `  ${objectApiName}.${lookup.fieldApiName} → ${lookup.parentObjectApiName} (${lookup.isRequired ? 'required' : 'optional, or leave blank'})`)
                ]
                : [] ),
            ...( outsideParentObjectApiNames.length > 0
                ? [`Required lookups to objects this tree does not insert get a random existing record of: ${outsideParentObjectApiNames.join(', ')} (none means nothing is inserted).`]
                : [] ),
            ...( totalRecordCount > RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD
                ? ['', `This run will take time: ${totalRecordCount} records in at least ${requestCount} Collections API requests.`]
                : [] ),
            '',
            'The data set is written to FakeDataSets as Run Faker by Recipe writes it, then inserted the way Insert Data Set by Directory inserts: you choose all-or-none next, and Cancel on the progress notification deletes every record this insert saved.'
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

            // ONLY AN ANSWER UNDER THE ID THE HOST IS WAITING ON; A FORGED, LATE OR REPEATED ONE ROUTES TO NOTHING
            case 'confirmResponse':

                if ( !this.pendingConfirmation || panelMessage.confirmationId !== this.pendingConfirmation.confirmationId ) {
                    return undefined;
                }

                return { kind: 'answerConfirmation', confirmationId: this.pendingConfirmation.confirmationId, choice: panelMessage.choice };

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
                The help section's "Open the full guide" (#332) carries nothing: the url is the host's,
                so nothing the panel sends can name another address. Routed once any model is posted,
                the empty state's included, since the help is drawn there too.
            */
            case 'openHelpGuide':

                return panelState.recipeDataMessage ? { kind: 'openHelpGuide' } : undefined;

            /*
                The Record types section's two buttons (#195, #321). The selection is NAMES only, each pair
                MATCHED against what the confirmed-drawn model offered; one name it did not offer
                refuses the whole request rather than generating something other than what was
                asked. An empty selection is "Use defaults". It shares Generate Treecipe's
                in-flight flag, so neither starts while the other runs or reloads.
            */
            case 'regenerateWithRecordTypes': {

                const treeKey = panelMessage.treeKey;
                const recordTypeSelection = this.readPostedRecordTypeSelection(panelMessage.recordTypeSelection, panelState.treeHistoryAllowLists.selectableRecordTypeKeys);

                // A RELOAD CLEARS THE ORG SELECTION, WHICH WOULD CANCEL AN INSERT THE READER CONFIRMED; THE PANEL DISABLED ITS BUTTONS ON THE CLICK, SO A REFUSAL GIVES THEM BACK
                if ( panelState.isGenerateTreecipeInFlight
                        || panelState.insertStateMessage
                        || typeof treeKey !== 'string'
                        || !panelState.treeHistoryAllowLists.recordTypeTreeKeys.has(treeKey)
                        || !recordTypeSelection ) {
                    return { kind: 'refuseRecordTypeRegenerate' };
                }

                return {
                    kind: 'regenerateWithRecordTypes',
                    treeKey: treeKey,
                    recordTypeSelection: recordTypeSelection,
                    ...( panelMessage.isRemembered === true ? { isRemembered: true as const } : {} )
                };

            }

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

            // THE CARD NEVER GENERATES ONLY (#375): A POSTED generateTree IS ANSWERED BY NOTHING, AND Run Faker by Recipe IS HOW A TREE IS GENERATED WITHOUT AN INSERT
            case 'generateTree':

                return undefined;

            /*
                Data-by-Org reads org names from the CLI, and the panel only ever names one by its
                INDEX into the list the host posted -- never a username or an alias. Which objects
                are checked is read from the confirmed-drawn model, never from the message.
            */
            case 'loadDataOrgs':

                // A RUN ENDS BY LISTING THE ORGS ITSELF; A SECOND LISTING MEANWHILE WOULD DISCARD ITS ANSWER AND FORGET ITS ORG
                // AN INSERT IN FLIGHT HOLDS THE SELECTION IT CONFIRMED; ITS RELOAD ASKS AGAIN ONCE IT HAS ENDED
                // A PERMISSION SET ASSIGNMENT HOLDS THE SELECTION IT ASSIGNS IN, AND CHECKS IT AGAIN WHEN IT ENDS
                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.scratchOrgStateMessage?.isRunning || panelState.insertStateMessage || panelState.permissionSetAssignStateMessage?.isRunning || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                return { kind: 'loadDataOrgs' };

            case 'selectDataOrg': {

                const { orgIndex } = panelMessage;

                if ( typeof orgIndex !== 'number'
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
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

                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.scratchOrgStateMessage?.isRunning || panelState.insertStateMessage || panelState.permissionSetAssignStateMessage?.isRunning || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                return { kind: 'refreshDataOrgs' };

            /*
                "+ New scratch org" carries NOTHING: the Dev Hub, the definition file and the alias are
                all the host's, and nothing is deployed (#358). It is honoured only beside a confirmed-drawn
                Data-by-Org picker, and never while a run or a Create is in flight -- whatever the panel
                sends. A refusal while nothing runs still answers, since the panel disabled the button.
            */
            case 'createScratchOrg':

                if ( panelState.scratchOrgStateMessage?.isRunning ) {
                    return undefined;
                }

                // A METADATA DEPLOY (#346) DEPLOYS TO THE ORG SELECTED, WHICH THE RUN WOULD CHANGE; A RETRIEVE DOES NOT HOLD IT, SINCE THE RUN DEPLOYS NOTHING (#358)
                if ( !panelState.recipeDataMessage || panelState.dataOrgObjectApiNames.size === 0 || panelState.insertStateMessage || panelState.permissionSetAssignStateMessage?.isRunning || panelState.metadataDeployStateMessage?.isRunning ) {
                    return {
                        kind: 'postScratchOrgState',
                        hostMessage: panelState.scratchOrgStateMessage ?? { command: 'scratchOrgState', isRunning: false }
                    };
                }

                return { kind: 'createScratchOrg' };

            /*
                "Generate fake data and insert" (#255) posts the tree's KEY and nothing else, and it is
                not taken on the panel's word: the tree must be one the confirmed-drawn model drew the
                button on, an org must be selected now, and that org must have answered that it is a
                sandbox. A forged message for a production org stops here, before any connection.
                Which org, which recipe file and which counts are the host's own.
            */
            case 'insertTree': {

                const { treeKey } = panelMessage;

                // AN INSERT IN FLIGHT HOLDS ITS OWN TREE'S BUTTON; A CLICK ON ANOTHER IS ANSWERED WITH IT, SO THAT CARD GIVES ITS BUTTON BACK
                if ( panelState.insertStateMessage ) {
                    return panelState.insertStateMessage.treeKey === treeKey
                        ? undefined
                        : { kind: 'postInsertState', hostMessage: panelState.insertStateMessage };
                }

                const recipeFilePath = typeof treeKey === 'string' ? panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey) : undefined;
                // A SCRATCH ORG RUN IS ABOUT TO CHANGE THE SELECTION, SO NOTHING IS INSERTED WHILE IT IS IN FLIGHT
                const isTreeRoutable = !panelState.scratchOrgStateMessage?.isRunning
                                        && !panelState.permissionSetAssignStateMessage?.isRunning
                                        && !panelState.metadataDeployStateMessage?.isRunning
                                        && typeof treeKey === 'string'
                                        && !!panelState.recipeDataMessage
                                        && panelState.insertableTreeKeys.has(treeKey)
                                        && !!recipeFilePath;

                if ( isTreeRoutable && panelState.dataOrgSelection?.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'insertTree', treeKey: treeKey as string, recipeFilePath: recipeFilePath };
                }

                // NO ORG CHOSEN YET (#375): THE ORG IS ASKED FOR IN THE COMMAND PALETTE, CHECKED AS A PICK IN THE DROPDOWN IS, AND ONLY THEN INSERTED INTO
                // THE OBJECTS A SELECTION CHECKS ARE THE CONFIRMED-DRAWN MODEL'S, AS FOR A PICK IN THE DROPDOWN
                if ( isTreeRoutable && !panelState.dataOrgSelection && panelState.dataOrgObjectApiNames.size > 0 ) {
                    return { kind: 'promptInsertOrg', treeKey: treeKey as string, recipeFilePath: recipeFilePath };
                }

                // THE PANEL DISABLED THE CARD'S BUTTON ON THE CLICK, SO EVEN A REFUSAL ANSWERS THAT NOTHING RUNS
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

                // A WIRING WRITES THE SAME FILE AND RELOADS IT, SO A "+" WAITS FOR IT
                if ( panelState.wireLookupStateMessage ) {
                    return { kind: 'postAddFriendState', hostMessage: { command: 'addFriendState', isRunning: false } };
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
                    ? panelState.wireableLookupTargets.get(this.buildWireableLookupKey(treeKey, objectApiName, objectNickname as string | undefined, fieldApiName))
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
                    ? panelState.addableParentTargets.get(this.buildWireableLookupKey(treeKey, objectApiName, objectNickname as string | undefined, fieldApiName))
                    : undefined;

                return target
                    ? { kind: 'addParentObject', treeKey: treeKey as string, recipeFilePath: target.recipeFilePath, addition: target.addition }
                    : closeWireLookupState;

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
                A data set row's ✎ and ☆ post its FOLDER NAME, matched against the rows the
                confirmed-drawn model listed. As for a card, the name is asked for by the host.
            */
            case 'renameDataset':
            case 'toggleFavoriteDataset': {

                const { datasetFolderName } = panelMessage;

                if ( typeof datasetFolderName !== 'string' || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableDatasetFolderNames.has(datasetFolderName) ) {
                    return undefined;
                }

                return { kind: panelMessage.command, datasetFolderName: datasetFolderName };

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
                A field's pin (#262), saved from its inline editor (#337): the same three names as its
                checkbox, matched against the same allow-list, and the value AS TYPED -- a string no
                longer than any fixed value can be, '' clearing it. Only its shape is checked here; the
                host checks the value itself against the field before anything is written. A field a
                lock holds back (#220's, a lookup, RecordTypeId, a dependent picklist, an unticked field
                or an excluded object's) is refused here and again before anything is written.
            */
            case 'setFieldFixedValue': {

                const { treeKey, objectApiName, nickname, fieldApiName, value } = panelMessage;

                if ( typeof treeKey !== 'string' || !SalesforceApiName.isApiName(objectApiName) || !SalesforceApiName.isApiName(fieldApiName)
                        || ( nickname !== undefined && typeof nickname !== 'string' )
                        || typeof value !== 'string' || value.length > RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH
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

                return { kind: 'setFieldFixedValue', treeKey: treeKey, folderName: tree.folderName, objectApiName: objectApiName, fieldApiName: fieldApiName, value: value };

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
                        || !panelState.treeHistoryAllowLists.selectableFieldKeys.has(this.buildSelectableFieldKey(treeKey, objectApiName, fieldApiName)) ) {
                    return undefined;
                }

                const drawnField = this.findDrawnField(panelState.recipeDataMessage.recipe, treeKey, objectApiName, fieldApiName);

                if ( !drawnField || !drawnField.tree.folderName || ( nickname !== undefined && nickname !== drawnField.objectViewModel.nickname )
                        || this.findValidationRuleLockReason(drawnField.tree, drawnField.objectViewModel, drawnField.fieldViewModel) !== undefined ) {
                    return undefined;
                }

                return { kind: 'setFieldValidationRuleApplied', treeKey: treeKey, folderName: drawnField.tree.folderName, objectApiName: objectApiName, fieldApiName: fieldApiName, isApplied: applied };

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
                "Assign permission sets to me…" (#274, #302) posts the tree's KEY, and the INDEX of
                the org the Treecipe tab has selected when it has one; neither decides what is
                assigned. The key must be a card the panel confirmed drawing, and the host reads that
                tree's objects from the stored model; which permission sets are offered is the
                host's, from local source. One assignment at a time, none while an insert or a
                scratch org run holds the selection, and none of those while it runs. An index must
                BE the selection, that org must have answered that it is a sandbox, and its readiness
                must have been posted: an assignment changes what a describe answers, so a describe
                the selection's own check took before it, cached or posted after it, would put back
                the reasons the assignment removed. With no index the host asks for an org itself,
                from the same non-production list the picker draws. A forged message for production
                stops here, before any connection or process. A refusal with a reason is a warning
                notification; every refusal gives the clicked button back.
            */
            case 'assignTreePermissionSets': {

                const { orgIndex, treeKey } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                if ( panelState.permissionSetAssignStateMessage?.isRunning ) {
                    return undefined;
                }

                const refuse = (refusalText?: string): RecipeCockpitPanelAction => ({
                    kind: 'refusePermissionSetAssign',
                    ...( refusalText ? { refusalText: refusalText } : {} ),
                    hostMessage: { command: 'permissionSetAssignState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' }
                });

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.assignableTreeKeys.has(treeKey)
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.insertStateMessage ) {
                    return refuse();
                }

                if ( panelState.metadataDeployStateMessage?.isRunning ) {
                    return refuse('Nothing was assigned: a metadata deploy is running. Try again once it has finished.');
                }

                if ( orgIndex === undefined || orgIndex === null ) {
                    return { kind: 'assignTreePermissionSets', treeKey: treeKey, isSelectedOrg: false };
                }

                if ( typeof orgIndex === 'number'
                        && !!dataOrgSelection
                        && dataOrgSelection.orgIndex === orgIndex
                        && dataOrgSelection.orgTypeDetail?.isSandbox === true ) {
                    return dataOrgSelection.isReadinessPosted === true
                        ? { kind: 'assignTreePermissionSets', treeKey: treeKey, isSelectedOrg: true }
                        : refuse('Nothing was assigned: the org selected above is still being checked. Try again once that check has finished.');
                }

                return refuse('Nothing was assigned: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.');

            }

            /*
                "Generate permission set…" (#306) posts the tree's KEY and nothing else: which objects
                and fields, the name, the folder and the file are all the host's. It writes into the
                project, so it waits for a recipe write and a permission set assignment (which reads
                the project's permission sets) to end; a scratch org run deploys nothing (#358).
                A tree whose every object is excluded has nothing to grant. A refusal is silent: the
                panel disables nothing on the click, so there is no button to give back.
            */
            case 'generateTreePermissionSet': {

                const { treeKey } = panelMessage;
                const recipeDataMessage = panelState.recipeDataMessage;

                if ( typeof treeKey !== 'string'
                        || !recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey)
                        || panelState.wireLookupStateMessage
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return undefined;
                }

                const tree = recipeDataMessage.recipe.trees.find(recipeTree => recipeTree.treeKey === treeKey);

                return tree && this.listTreeInsertObjectApiNames(recipeDataMessage.recipe, tree).length > 0
                    ? { kind: 'generateTreePermissionSet', treeKey: treeKey }
                    : undefined;

            }

            /*
                "Retrieve validation rules…" (#326) posts the tree's KEY and nothing else: the objects
                are the host's, and the org is ALWAYS asked for in the command palette, so an org
                index the message carries is never read. One retrieve per window; it waits for an
                insert and a permission set assignment to end, and a scratch org run, which deploys
                nothing (#358), does not hold it. Every refusal gives the clicked button back, and a busy one says why.
            */
            case 'retrieveTreeValidationRules': {

                const { treeKey } = panelMessage;

                // A RELOADED DOCUMENT MAY NOT KNOW A RETRIEVE IS RUNNING: IT IS TOLD, AND THE RETRIEVE'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.validationRuleRetrieveStateMessage?.isRunning ) {
                    return { kind: 'refuseValidationRuleRetrieve', hostMessage: panelState.validationRuleRetrieveStateMessage };
                }

                const notRunning: IRecipeCockpitValidationRuleRetrieveStateMessage = { command: 'validationRuleRetrieveState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '' };

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return { kind: 'refuseValidationRuleRetrieve', hostMessage: notRunning };
                }

                if ( panelState.insertStateMessage
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseValidationRuleRetrieve', refusalText: RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_BUSY_REFUSAL, hostMessage: notRunning };
                }

                return { kind: 'retrieveTreeValidationRules', treeKey: treeKey };

            }

            /*
                The Troubleshooting tab's deploys (#346) post the tree's KEY, and the INDEX of the org
                the Treecipe tab has selected when it has one; neither decides what is deployed, which
                the host reads from the project for the tree it holds. The key must be a card with a
                folder the panel confirmed drawing. An index must BE the selection, still name the same
                username, and that org must have answered that it is a sandbox: a forged message for
                production stops here, before any connection or process. With no index the host asks
                for an org from the same non-production list the picker draws. One deploy per window,
                none while an insert, a scratch org run, an assignment or a retrieve runs, and none of
                those while it runs. Every refusal gives the clicked button back.
            */
            case 'deployTreePermissionSet':
            case 'deployTreeFields':
            case 'deployTreeGlobalValueSets':
            case 'deployTreeRecordTypes': {

                const { orgIndex, treeKey } = panelMessage;
                const deployKind = ( Object.keys(RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND) as MetadataDeployKind[])
                    .find(candidateKind => RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND[candidateKind] === panelMessage.command) as MetadataDeployKind;
                const dataOrgSelection = panelState.dataOrgSelection;

                // A RELOADED DOCUMENT MAY NOT KNOW A DEPLOY IS RUNNING: IT IS TOLD, AND THE DEPLOY'S OWN END GIVES THE BUTTONS BACK
                if ( panelState.metadataDeployStateMessage?.isRunning ) {
                    return { kind: 'refuseMetadataDeploy', hostMessage: panelState.metadataDeployStateMessage };
                }

                const refuse = (refusalText?: string): RecipeCockpitPanelAction => ({
                    kind: 'refuseMetadataDeploy',
                    ...( refusalText ? { refusalText: refusalText } : {} ),
                    hostMessage: { command: 'metadataDeployState', isRunning: false, treeKey: typeof treeKey === 'string' ? treeKey : '', deployKind: deployKind }
                });

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return refuse();
                }

                if ( panelState.insertStateMessage
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.validationRuleRetrieveStateMessage?.isRunning ) {
                    return refuse(RECIPE_COCKPIT_DEPLOY_BUSY_REFUSAL);
                }

                if ( orgIndex === undefined || orgIndex === null ) {
                    return { kind: 'deployTreeMetadataComponents', treeKey: treeKey, deployKind: deployKind, isSelectedOrg: false };
                }

                if ( typeof orgIndex === 'number'
                        && Number.isInteger(orgIndex)
                        && !!dataOrgSelection
                        && dataOrgSelection.orgIndex === orgIndex
                        && panelState.dataOrgDetails[orgIndex]?.username === dataOrgSelection.orgDetail.username
                        && dataOrgSelection.orgTypeDetail?.isSandbox === true ) {
                    return { kind: 'deployTreeMetadataComponents', treeKey: treeKey, deployKind: deployKind, isSelectedOrg: true };
                }

                return refuse('Nothing was deployed: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.');

            }

            /*
                What each Troubleshooting section would deploy (#346), read from local files when the
                tab is opened, for a card with a folder the panel confirmed drawing. It reads the
                project and nothing else, so it is answered whatever else runs.
            */
            case 'loadTroubleshootingSummary': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadTroubleshootingSummary', treeKey: treeKey, renderSequence: renderSequence as number };

            }

            /*
                The Query tab (#367) posts the tree's KEY, a query KEY and, to save or run, the
                reader's text: never an org, a path or an object. The key must be a card with a
                folder the panel confirmed drawing; the host matches the query key against the
                queries it read for that tree, and holds the text to one SELECT before it is sent.
                A query only reads, and its org is asked for in the command palette every time, so
                nothing else running holds it.
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

            /*
                The Validation Rules sub-tab's list (#327) posts the tree's KEY and the model it was
                drawn on, nothing else: the objects are the host's model of the tree. It reads local
                files and nothing else, so it is answered whatever else runs.
            */
            case 'loadValidationRules': {

                const { treeKey, renderSequence } = panelMessage;

                if ( typeof treeKey !== 'string'
                        || !panelState.recipeDataMessage
                        || renderSequence !== panelState.recipeDataMessage.renderSequence
                        || !panelState.treeHistoryAllowLists.nameableTreeKeys.has(treeKey) ) {
                    return undefined;
                }

                return { kind: 'loadValidationRules', treeKey: treeKey, renderSequence: renderSequence as number };

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

            /*
                "Open in browser" (#279) names the org by INDEX, and only the org SELECTED now is
                opened: an index the panel could have kept from an older listing, or any other org
                the list holds, is refused. Which username is the host's. A refusal still answers,
                since the panel disabled the button on the click; a second click while one open is
                in flight starts nothing and is told the open is running, and the first one's answer
                re-enables the button.
            */
            case 'openDataOrg': {

                const { orgIndex } = panelMessage;
                const dataOrgSelection = panelState.dataOrgSelection;

                // A RELOADED DOCUMENT MAY NOT KNOW AN OPEN IS RUNNING: IT IS TOLD, AND THE FIRST OPEN'S ANSWER RE-ENABLES IT
                if ( panelState.isOrgOpenInFlight ) {
                    return { kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: true } };
                }

                if ( typeof orgIndex !== 'number'
                        || !Number.isInteger(orgIndex)
                        || !panelState.recipeDataMessage
                        || panelState.dataOrgObjectApiNames.size === 0
                        || panelState.scratchOrgStateMessage?.isRunning
                        || panelState.permissionSetAssignStateMessage?.isRunning
                        || panelState.metadataDeployStateMessage?.isRunning
                        || !dataOrgSelection
                        || dataOrgSelection.orgIndex !== orgIndex
                        || panelState.dataOrgDetails[orgIndex]?.username !== dataOrgSelection.orgDetail.username ) {
                    return { kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: false } };
                }

                return { kind: 'openDataOrg', orgDetail: dataOrgSelection.orgDetail };

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

    // WHERE THE READER ACTED FROM, KEPT ONLY IF IT NAMES A CARD OF THE MODEL ON SCREEN AND ITS DATA SETS TAB
    /*
        A posted record type selection (#195): a plain object of object api name -> developer names,
        every pair one the confirmed-drawn model offered, each object's list non-empty and without
        repeats. Anything else is undefined -- the request is refused, never trimmed to what passed.
        The map it answers has no prototype, so an object named "__proto__" stays a key.
    */
    static readPostedRecordTypeSelection(postedSelection: unknown, selectableRecordTypeKeys: Set<string>): Record<string, string[]> | undefined {

        if ( !this.isPlainRecord(postedSelection) ) {
            return undefined;
        }

        const recordTypeSelection: Record<string, string[]> = Object.create(null);

        for ( const objectApiName of Object.keys(postedSelection) ) {

            const developerNames: unknown = postedSelection[objectApiName];

            if ( !Array.isArray(developerNames)
                    || developerNames.length === 0
                    || new Set(developerNames).size !== developerNames.length
                    || !developerNames.every(developerName => typeof developerName === 'string'
                                                                && selectableRecordTypeKeys.has(this.buildSelectableRecordTypeKey(objectApiName, developerName))) ) {
                return undefined;
            }

            recordTypeSelection[objectApiName] = [...developerNames as string[]];

        }

        return recordTypeSelection;

    }

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

        if ( panelState.validationRuleRetrieveStateMessage ) {
            replayMessages.push(panelState.validationRuleRetrieveStateMessage);
        }

        if ( panelState.metadataDeployStateMessage ) {
            replayMessages.push(panelState.metadataDeployStateMessage);
        }

        if ( panelState.treeQueryStateMessage ) {
            replayMessages.push(panelState.treeQueryStateMessage);
        }

        if ( panelState.treeQueryResultMessage && panelState.treeQueryResultMessage.renderSequence === panelState.recipeDataMessage?.renderSequence ) {
            replayMessages.push(panelState.treeQueryResultMessage);
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

    // THE PARENTS A CARD CAN ADD ARE THE TEMPLATE'S OBJECTS, WHICH BOTH BACKENDS SHARE; THE VALUES COME FROM THE RECIPE'S OWN BACKEND AT THE WRITE
    static getParentObjectTemplates(fakerService: 'faker-js' | 'snowfakery'): Record<string, Record<string, string>> {

        return fakerService === 'faker-js'
            ? new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate()
            : new SnowfakeryRecipeFakerService().getMinimumRequiredFieldsTemplate();

    }

    /*
        The card's TODO lookups whose one standard parent the recipe does not write (#294), from the
        text the load already read when it has it; a file that cannot be read offers none.
    */
    static listTreeAddableParents(recipeFilePath: string,
                                    tree: IRecipeCockpitTreeViewModel,
                                    objectLevelsByApiName: Map<string, number> | undefined,
                                    alreadyReadRecipeText?: string): IRecipeCockpitAddableParentViewModel[] {

        let recipeText = alreadyReadRecipeText;
        if ( recipeText === undefined ) {
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            } catch {
                return [];
            }
        }

        const templateObjectApiNames = new Set(Object.keys(this.getParentObjectTemplates('faker-js')));

        return RecipeCockpitRecipeWriter.listAddableParentObjects(recipeText, this.buildLookupWiringContext(tree, objectLevelsByApiName), templateObjectApiNames)
            .map(addition => ({ ...addition }));

    }

    // WHAT THE WRITER DECIDES A WIRING BY: THE CARD'S OWN LOOKUPS AND RelationshipService's LEVELS, AS THE GENERATE BUTTON'S FILTERED COPY USES THEM
    static buildLookupWiringContext(tree: IRecipeCockpitTreeViewModel, objectLevelsByApiName: Map<string, number> | undefined): ILookupWiringContext {

        const parentLookupsByObjectApiName = new Map<string, IRecipeFilterLookup[]>();
        tree.objects
            .filter(treeObject => treeObject.iterationNickname === undefined)
            .forEach(treeObject => parentLookupsByObjectApiName.set(treeObject.objectApiName, treeObject.parentLookups.map(parentLookup => ({ ...parentLookup }))));

        return {
            parentLookupsByObjectApiName: parentLookupsByObjectApiName,
            ...( objectLevelsByApiName ? { levelsByObjectApiName: objectLevelsByApiName } : {} )
        };

    }

    /*
        The card's TODO lookups, from the text the load already read for the file (readRecipeSourceFiles)
        when it has it, else read from disk; a file that cannot be read offers none.
    */
    static listTreeLookupWirings(recipeFilePath: string,
                                    tree: IRecipeCockpitTreeViewModel,
                                    objectLevelsByApiName: Map<string, number> | undefined,
                                    alreadyReadRecipeText?: string): IRecipeCockpitLookupWiringViewModel[] {

        let recipeText = alreadyReadRecipeText;
        if ( recipeText === undefined ) {
            try {
                recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            } catch {
                return [];
            }
        }

        return RecipeCockpitRecipeWriter.listLookupWirings(recipeText, this.buildLookupWiringContext(tree, objectLevelsByApiName))
            .map(wiring => ({
                objectApiName: wiring.objectApiName,
                ...( wiring.objectNickname !== undefined ? { objectNickname: wiring.objectNickname } : {} ),
                fieldApiName: wiring.fieldApiName,
                candidateNicknames: wiring.candidateNicknames
            }));

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
        this.applyGeneratedRecordTypes(recipeViewModel.objects, recipeSourceRead.recordTypeBlocks);

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

        const pinnedFixedValuesByFolderName = new Map<string, Map<string, Map<string, string>>>();
        const fixedValueNotices: string[] = [];

        recipeViewModel.trees.forEach(tree => {
            const treeHistory = treeHistoryBuild.historiesByTreeKey.get(tree.treeKey);
            if ( treeHistory ) {
                tree.history = treeHistory;
            }
            const runFakerRecipeFilePath = treeHistoryBuild.targets.runFakerRecipeFilePathsByTreeKey.get(tree.treeKey);
            if ( runFakerRecipeFilePath ) {
                tree.runFakerRecipeFileName = path.basename(runFakerRecipeFilePath);
                const lookupWirings = this.listTreeLookupWirings(runFakerRecipeFilePath, tree, normalizedObjectsWrapper.objectLevelsByApiName, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                if ( lookupWirings.length > 0 ) {
                    tree.lookupWirings = lookupWirings;
                }
                const addableParents = this.listTreeAddableParents(runFakerRecipeFilePath, tree, normalizedObjectsWrapper.objectLevelsByApiName, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                if ( addableParents.length > 0 ) {
                    tree.addableParents = addableParents;
                }
                const pinnedFixedValues = this.readPinnedFixedValues(runFakerRecipeFilePath, workspaceRoot, recipeSourceRead.recipeTextsByFilePath.get(runFakerRecipeFilePath));
                fixedValueNotices.push(...pinnedFixedValues.notices);
                if ( tree.folderName && pinnedFixedValues.valuesByObject.size > 0 ) {
                    pinnedFixedValuesByFolderName.set(tree.folderName, pinnedFixedValues.valuesByObject);
                }
            }
        });

        const unmatchedDatasetNotices = treeHistoryBuild.unmatchedDatasetCount > 0
            ? [RecipeCockpitTreeHistory.buildUnmatchedDatasetsNotice(treeHistoryBuild.unmatchedDatasetCount)]
            : [];

        const missingRunNotices = requestedRunFolderName && !requestedRun
            ? [`The run "${requestedRunFolderName}" is no longer on disk, so the latest run is shown instead.`]
            : [];

        recipeViewModel.notices = [...missingRunNotices, ...normalizedObjectsWrapper.notices, ...recipeSourceRead.notices, ...recipeTreeBuild.notices, ...fixedValueNotices, ...unmatchedDatasetNotices];

        if ( recipeViewModel.objects.length === 0 ) {
            recipeViewModel.emptyStateMessage = normalizedObjectsWrapper.isObjectsWrapper
                ? `The objects wrapper "${path.basename(selectedRun.objectsWrapperFilePath)}" lists no objects. Choose another run, or run "Generate Treecipe" again.`
                : `"${path.basename(selectedRun.objectsWrapperFilePath)}" is not a Treecipe objects wrapper. Choose another run, or run "Generate Treecipe" again.`;
        }

        return {
            recipeViewModel: recipeViewModel,
            picklistDisplayValuesByObjectApiName: normalizedObjectsWrapper.picklistDisplayValuesByObjectApiName,
            treeHistoryTargets: treeHistoryBuild.targets,
            ...( normalizedObjectsWrapper.objectLevelsByApiName ? { objectLevelsByApiName: normalizedObjectsWrapper.objectLevelsByApiName } : {} ),
            ...( pinnedFixedValuesByFolderName.size > 0 ? { pinnedFixedValuesByFolderName: pinnedFixedValuesByFolderName } : {} ),
            objectsWrapperFilePath: selectedRun.objectsWrapperFilePath
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

                const validationRules = this.readFieldValidationRules(wrapperFieldRecord);
                if ( validationRules ) {
                    fieldViewModel.validationRules = validationRules;
                }

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

            const recordTypes = this.readRecordTypeOptions(wrapperObjectRecord?.RecordTypesMap, fields);
            objects.push({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: fields,
                ...( recordTypes.length >= 2 ? { recordTypes: recordTypes } : {} )
            });

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
        The record types the Record types section offers for one object (#195), in the map's own order
        (RecordTypeService sorted it once, #166). Only a developer name that IS an api name is
        offered: generation refuses any other (#120), so offering it would offer nothing. Each
        carries what it restricts -- every picklist field of the object its section lists, and how
        many values it allows there -- as counts, never the values.
    */
    static readRecordTypeOptions(recordTypesMap: unknown, fields: IRecipeCockpitFieldViewModel[]): IRecipeCockpitRecordTypeViewModel[] {

        const recordTypesRecord = this.asRecord(recordTypesMap);

        if ( !recordTypesRecord ) {
            return [];
        }

        const picklistFields = fields.filter(field => RECIPE_COCKPIT_PICKLIST_FIELD_TYPES.includes(field.fieldType));
        const picklistSectionsByDeveloperName = new Map(this.readRecordTypePicklistSections(recordTypesRecord)
            .map(recordTypeSection => [recordTypeSection.recordTypeDeveloperName, recordTypeSection.picklistValuesByFieldApiName]));

        return Object.keys(recordTypesRecord)
            .filter(developerName => SalesforceApiName.isApiName(developerName))
            .map(developerName => {

                // readRecordTypePicklistSections READS EVERY KEY OF THE SAME MAP, SO EVERY OFFERED NAME HAS AN ENTRY
                const picklistValuesByFieldApiName = picklistSectionsByDeveloperName.get(developerName) as Record<string, string[]>;
                const impacts: IRecipeCockpitRecordTypeImpactViewModel[] = picklistFields
                    .filter(field => Object.prototype.hasOwnProperty.call(picklistValuesByFieldApiName, field.fieldApiName))
                    .map(field => ({
                        fieldApiName: field.fieldApiName,
                        kind: field.controllingField ? 'dependent' : ( field.fieldType.toLowerCase() === 'multiselectpicklist' ? 'multiselect' : 'picklist' ),
                        valueCount: picklistValuesByFieldApiName[field.fieldApiName].length
                    }));

                return {
                    developerName: developerName,
                    isActive: this.asRecord(recordTypesRecord[developerName])?.Active !== false,
                    impacts: impacts
                };

            });

    }

    /*
        Which record types the run's recipes write per object (#195), read from every block's
        RecordTypeId line ("Object.DeveloperName"), in block order -- a self-lookup iteration repeats
        its object's first block and adds nothing. A block written as the DEFAULT carries the
        RecordType Options TODO under that line (two or more record types always do), so its absence
        on every block says the run was generated from a choice. An object whose recipe names none of
        its record types is drawn with the default ticked: the first active one, as generation picks.
    */
    static buildEmptyRecordTypeBlocks(): IRecipeRecordTypeBlocks {

        return { developerNamesByObjectApiName: new Map(), defaultWrittenObjectApiNames: new Set() };

    }

    static collectRecordTypeBlocks(lines: string[], scannedObjects: IScannedObject[], recordTypeBlocks: IRecipeRecordTypeBlocks): void {

        scannedObjects.forEach(scannedObject => {

            const recordTypeIdField = scannedObject.fields.find(scannedField => scannedField.fieldApiName === 'RecordTypeId');
            if ( !recordTypeIdField ) {
                return;
            }

            const recordTypeIdMatch = /^\s*RecordTypeId:[ \t]*([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)[ \t]*$/.exec(lines[recordTypeIdField.startIndex]);
            if ( recordTypeIdMatch && recordTypeIdMatch[1] === scannedObject.objectApiName ) {
                const developerNames = recordTypeBlocks.developerNamesByObjectApiName.get(scannedObject.objectApiName) ?? [];
                if ( !developerNames.includes(recordTypeIdMatch[2]) ) {
                    developerNames.push(recordTypeIdMatch[2]);
                }
                recordTypeBlocks.developerNamesByObjectApiName.set(scannedObject.objectApiName, developerNames);
            }

            for ( let continuationIndex = recordTypeIdField.startIndex + 1; continuationIndex < recordTypeIdField.endIndex; continuationIndex++ ) {
                if ( lines[continuationIndex].trimStart().startsWith(RECIPE_COCKPIT_RECORD_TYPE_OPTIONS_MARKER) ) {
                    recordTypeBlocks.defaultWrittenObjectApiNames.add(scannedObject.objectApiName);
                    break;
                }
            }

        });

    }

    static applyGeneratedRecordTypes(objects: IRecipeCockpitObjectViewModel[], recordTypeBlocks: IRecipeRecordTypeBlocks): void {

        const { developerNamesByObjectApiName, defaultWrittenObjectApiNames } = recordTypeBlocks;

        objects
            .filter(objectViewModel => !!objectViewModel.recordTypes)
            .forEach(objectViewModel => {

                const offeredDeveloperNames = objectViewModel.recordTypes.map(recordType => recordType.developerName);
                const generatedDeveloperNames = (developerNamesByObjectApiName.get(objectViewModel.objectApiName) ?? [])
                    .filter(developerName => offeredDeveloperNames.includes(developerName));

                if ( generatedDeveloperNames.length === 0 ) {
                    const defaultRecordType = objectViewModel.recordTypes.find(recordType => recordType.isActive) ?? objectViewModel.recordTypes[0];
                    objectViewModel.generatedRecordTypeDeveloperNames = [defaultRecordType.developerName];
                    return;
                }

                objectViewModel.generatedRecordTypeDeveloperNames = generatedDeveloperNames;
                if ( !defaultWrittenObjectApiNames.has(objectViewModel.objectApiName) ) {
                    objectViewModel.isRecordTypeSelectionApplied = true;
                }

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
    /*
        A field's validation rules as #324 recorded them (#325), or undefined for a field none names.
        The wrapper is a workspace file, so every record is type-checked and one that is not is
        skipped. An applied rule counts only when both values the box switches between are strings:
        without them nothing could be switched, and the field is drawn as it was before #325.
    */
    static readFieldValidationRules(wrapperFieldRecord: Record<string, unknown>): IRecipeCockpitFieldValidationRulesViewModel | undefined {

        const ruleRecords = wrapperFieldRecord.validationRuleConstraints;
        if ( !Array.isArray(ruleRecords) ) {
            return undefined;
        }

        const readableRules = ruleRecords
            .map(ruleRecord => this.asRecord(ruleRecord))
            .filter((ruleRecord): ruleRecord is Record<string, unknown> => !!ruleRecord
                                                                            && typeof ruleRecord.ruleName === 'string'
                                                                            && ruleRecord.ruleName !== ''
                                                                            && typeof ruleRecord.applied === 'boolean');
        const recipeValue = wrapperFieldRecord.recipeValue;
        const unconstrainedRecipeValue = wrapperFieldRecord.unconstrainedRecipeValue;
        const canSwitch = typeof recipeValue === 'string' && typeof unconstrainedRecipeValue === 'string';
        const appliedRuleNames = canSwitch
            ? [...new Set(readableRules.filter(ruleRecord => ruleRecord.applied).map(ruleRecord => ruleRecord.ruleName as string))]
            : [];
        const notAppliedRules = readableRules
            .filter(ruleRecord => !ruleRecord.applied)
            .map(ruleRecord => ({ ruleName: ruleRecord.ruleName as string, reason: typeof ruleRecord.reason === 'string' ? ruleRecord.reason : '' }));

        if ( appliedRuleNames.length === 0 && notAppliedRules.length === 0 ) {
            return undefined;
        }

        return {
            appliedRuleNames: appliedRuleNames,
            notAppliedRules: notAppliedRules,
            ...( appliedRuleNames.length > 0 ? {
                recipeValue: recipeValue as string,
                unconstrainedRecipeValue: unconstrainedRecipeValue as string,
                unconstrainedExpression: this.buildDisplayExpression(( unconstrainedRecipeValue as string ).split('\n'))
            } : {} )
        };

    }

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
    // recipeTextsByFilePath IS EACH FILE'S TEXT AS IT WAS READ HERE, SO THE TREE CARDS' TODO LOOKUPS ARE LISTED WITHOUT READING IT AGAIN (#151)
    static readRecipeSourceFiles(runFolderPath: string, workspaceRoot: string): { recipeSourceFiles: IRecipeSourceFile[]; notices: string[]; recipeTextsByFilePath: Map<string, string>; recordTypeBlocks: IRecipeRecordTypeBlocks } {

        const recipeSourceFiles: IRecipeSourceFile[] = [];
        const notices: string[] = [];
        const recipeTextsByFilePath = new Map<string, string>();
        const recordTypeBlocks = this.buildEmptyRecordTypeBlocks();

        this.collectRecipeFilePaths(runFolderPath)
            .filter(recipeFilePath => SfdxProjectService.isPathContainedInWorkspace(path.resolve(recipeFilePath), path.resolve(workspaceRoot)))
            .forEach(recipeFilePath => {

                try {
                    const recipeText = fs.readFileSync(recipeFilePath, 'utf-8');
                    recipeSourceFiles.push({
                        filePath: recipeFilePath,
                        objectEntries: this.parseRecipeSource(recipeText, recordTypeBlocks)
                    });
                    recipeTextsByFilePath.set(recipeFilePath, recipeText);
                } catch (readError) {
                    notices.push(`The recipe file "${path.basename(recipeFilePath)}" could not be read (${readError?.message ?? readError}), so its objects and fields cannot be opened from here.`);
                }

            });

        return { recipeSourceFiles: recipeSourceFiles, notices: notices, recipeTextsByFilePath: recipeTextsByFilePath, recordTypeBlocks: recordTypeBlocks };

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
    static parseRecipeSource(recipeContent: string, recordTypeBlocks?: IRecipeRecordTypeBlocks): Map<string, IRecipeSourceObjectEntry> {

        const objectEntries = new Map<string, IRecipeSourceObjectEntry>();
        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeContent);
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
        if ( recordTypeBlocks ) {
            this.collectRecordTypeBlocks(lines, scannedObjects, recordTypeBlocks);
        }
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
                this.attachRecipeSourceTodos(objectEntries.get(scannedObject.objectApiName), scannedObject, lines);
                return;
            }

            // A LATER OCCURRENCE IS KEPT ONLY WHEN IT AND THE FIRST EACH CARRY A NICKNAME NO OTHER OCCURRENCE DOES; ANY OTHER IS LEFT TO THE FIRST, AS BEFORE (#188)
            const nickname = readDistinctNickname(scannedObject);
            const firstScannedObject = scannedObjectsByHeaderIndex.get(firstObjectEntry.lineNumber - 1);
            if ( nickname === undefined || readDistinctNickname(firstScannedObject) === undefined ) {
                firstObjectEntry.hasIndistinctOccurrences = true;
                // THE FIRST OCCURRENCE IS THE ONE ROW DRAWN FOR THEM ALL, SO IT LISTS THEIR TODOS TOO (#354)
                this.attachRecipeSourceTodos(firstObjectEntry, scannedObject, lines);
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
            this.attachRecipeSourceTodos(firstObjectEntry.iterations[firstObjectEntry.iterations.length - 1], scannedObject, lines);

        });

        return objectEntries;

    }

    /*
        Puts each TODO comment of one occurrence's block on the field whose lines hold it, or on the
        entry itself when it sits on no field (#354). A field the entry does not list -- a later
        indistinct occurrence's own field -- puts its TODO on the entry, so none is lost. todos is
        set only when there is one, so a recipe without a TODO is read as it always was.
    */
    private static attachRecipeSourceTodos(
        sourceEntry: { fieldEntries: Map<string, IRecipeSourceFieldEntry>; todos?: IRecipeCockpitTodoViewModel[] },
        scannedObject: IScannedObject,
        lines: string[]
    ): void {

        let fieldIndex = 0;

        scannedObject.todoLineIndexes.forEach(todoLineIndex => {

            const todo: IRecipeCockpitTodoViewModel = {
                lineNumber: todoLineIndex + 1,
                text: RecipeCockpitRecipeWriter.readTodoCommentText(lines[todoLineIndex]) ?? ''
            };

            while ( fieldIndex < scannedObject.fields.length && scannedObject.fields[fieldIndex].endIndex <= todoLineIndex ) {
                fieldIndex++;
            }

            const scannedField = scannedObject.fields[fieldIndex];
            const fieldEntry = scannedField && scannedField.startIndex <= todoLineIndex
                ? sourceEntry.fieldEntries.get(scannedField.fieldApiName)
                : undefined;
            const todoOwner = fieldEntry ?? sourceEntry;

            // PUSHED, NEVER SPREAD: ONE OWNER CAN HOLD THOUSANDS, AND A COPY PER TODO WAS 14 s FOR 50,000
            ( todoOwner.todos ??= [] ).push(todo);

        });

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

            /*
                The wrapper records every lookup as the generated "### TODO -- REFERENCE ID REQUIRED", and
                keeps saying so after Generate Treecipe wired it to an ancestor (#46) or the reader wired
                it in the cockpit (#151). Such a row shows what the recipe FILE says instead, which is
                what Run Faker reads.
            */
            const locatedWrapperFields = objectViewModel.fields.map(fieldViewModel => {
                const fieldEntry = objectEntry.fieldEntries.get(fieldViewModel.fieldApiName);
                return {
                    ...fieldViewModel,
                    ...( fieldEntry && fieldViewModel.recipeValue.startsWith(RelationshipService.referenceIdRequiredTodo) ? { recipeValue: fieldEntry.valueText } : {} ),
                    lineNumber: fieldEntry?.lineNumber
                };
            });

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
                    lineNumber: fieldEntry.lineNumber,
                    ...( fieldEntry.todos ? { todos: this.buildFieldTodoViewModels(fieldEntry.todos, fieldEntry.valueText) } : {} )
                });

            });

            locatedWrapperFields.forEach(fieldViewModel => {
                const fieldTodos = objectEntry.fieldEntries.get(fieldViewModel.fieldApiName)?.todos;
                if ( fieldTodos ) {
                    fieldViewModel.todos = this.buildFieldTodoViewModels(fieldTodos, fieldViewModel.recipeValue);
                }
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
                ...( objectEntry.todos ? { todos: objectEntry.todos.slice() } : {} ),
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
                            recipeValue: fieldEntry.valueText,
                            ...( fieldEntry.todos ? { todos: this.buildFieldTodoViewModels(fieldEntry.todos, fieldEntry.valueText) } : {} )
                        })),
                        ...( iteration.insertableFriendObjectApiNames ? { insertableFriendObjectApiNames: iteration.insertableFriendObjectApiNames.slice() } : {} ),
                        ...( iteration.todos ? { todos: iteration.todos.slice() } : {} )
                    }))
                } : {} )
            };

        });

    }

    // A FIELD'S TODOS AS POSTED (#354): A TODO ITS DRAWN VALUE ALREADY HOLDS CARRIES ITS LINE AND WHERE IT SITS IN THAT VALUE (#365), NOT ITS TEXT
    static buildFieldTodoViewModels(todos: IRecipeCockpitTodoViewModel[], recipeValue: string): IRecipeCockpitTodoViewModel[] {

        return todos.map(todo => {
            const valueStart = todo.text ? recipeValue.indexOf(todo.text) : -1;
            if ( valueStart === -1 ) {
                return todo.text !== undefined ? { lineNumber: todo.lineNumber, text: todo.text } : { lineNumber: todo.lineNumber };
            }
            return { lineNumber: todo.lineNumber, valueStart: valueStart, valueLength: todo.text.length };
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
    button, select, input {
        transition: color ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, background-color ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, border-color ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, box-shadow ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, filter ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, transform 80ms ease;
    }
    button:active:not(:disabled) { transform: translateY(1px); }
    @keyframes sdtReveal {
        from { opacity: 0; transform: translateY(-0.25rem); }
        to { opacity: 1; transform: none; }
    }
    @keyframes sdtConceal {
        from { opacity: 1; transform: none; visibility: visible; }
        to { opacity: 0; transform: translateY(-0.25rem); visibility: hidden; }
    }
    .motionReveal { animation: sdtReveal ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS}ms ease-out; }
    /* EVERY BODY THAT CONCEALS IS A BLOCK div; A FLEX OR GRID ONE WOULD NEED ITS OWN display HERE */
    .hidden.motionConceal {
        display: block !important;
        animation: sdtConceal ${RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS}ms ease-in forwards;
        pointer-events: none;
    }
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
    .toolbar select, .tabSearchInput, .treecipesSearchInput {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .toolbar select { padding: 0.3rem; }
    .tabSearch, .treecipesSearch { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.4rem 0.6rem; }
    /* THE MAGNIFIER INSIDE EVERY SEARCH BOX (#373), DRAWN LIKE THE CHAIN LINK; THE TEXT STARTS PAST IT */
    .tabSearchField { position: relative; display: flex; align-items: center; flex: 1 1 16rem; min-width: 0; }
    .tabSearchInput {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        padding: 0.3rem 0.5rem 0.3rem 2rem;
    }
    .tabSearchIcon { position: absolute; left: 0.5rem; width: 1.1rem; height: 1.1rem; cursor: text; }
    .tabSearchIcon path { fill: none; stroke: var(--sdt-muted); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .tabSearchInput::placeholder, .treecipesSearchInput::placeholder { color: var(--sdt-muted); opacity: 1; }
    .emptyStateActions { margin-top: 0.5rem; }
    /* THE TREECIPES SECTION'S SEARCH, ITS RESULTS AND THE DROPDOWN (#374) */
    .treecipesSearch { padding-left: 0; padding-right: 0; }
    .treecipesSearchInput { flex: 1 1 auto; width: 100%; min-width: 0; box-sizing: border-box; padding: 0.3rem 0.5rem 0.3rem 2rem; }
    .treecipesSearchResults { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.2rem 0 0.4rem 0; }
    .treecipesResultGroup { display: flex; flex-direction: column; gap: 0.15rem; }
    .treecipesResultTree { font-weight: 600; }
    .treecipesResult { display: flex; gap: 0.5rem; align-items: baseline; padding-left: 0.75rem; }
    .treecipesResultKind { flex: none; min-width: 6rem; }
    .treePicker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.2rem 0; }
    .treePickerLabel { font-weight: 600; }
    .treePickerSelect {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
        padding: 0.3rem;
        max-width: 100%;
    }
    .treePickerSelect:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); cursor: not-allowed; }
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
    .cockpitMeta .helpToggle { border-radius: 999px; padding: 0.4rem 0.75rem; }
    .helpSection {
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        padding: 0.6rem 0.9rem;
        margin: 0.25rem 0 0.75rem 0;
    }
    .helpTitle { font-weight: 600; font-size: 1.1em; }
    .helpRun { margin-top: 0.2rem; }
    .helpPart { margin-top: 0.6rem; }
    .helpHeading { font-weight: 600; }
    .helpParagraph { margin: 0.3rem 0; }
    .helpList { margin: 0.3rem 0; padding-left: 1.2rem; }
    .helpActions { margin-top: 0.6rem; }
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
    }
    .treeObjectHeader, .treeField, .treeDataset { transition: background-color ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease, box-shadow ${RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS}ms ease; }
    .treeTitle { font-weight: 600; font-size: 1.1em; }
    .treeHeaderActions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; cursor: default; }
    /*
        THE BUTTON KINDS (#363): every button the panel makes carries sdtButton and exactly one
        sdtButton-<kind>, and these rules are the only place a button's colours, border and states
        are set. A button's own class adds size and layout only, so a new button is styled by its
        kind or fails the button-kind test; it is never a browser default.
    */
    .sdtButton-primary, .sdtButton-secondary {
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
    .sdtButton-secondary:hover:not(:disabled) {
        border-color: var(--sdt-accent);
    }
    .dataOrgRefresh { display: inline-flex; align-items: center; gap: 0.35rem; line-height: 1; }
    .dataOrgRefreshIcon { font-size: 1.5em; line-height: 1; }
    .treeObjectToggle {
        box-sizing: border-box;
        flex: none;
        width: 2.6rem;
        height: 2.6rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
    }
    .picklistToggle, .picklistToggleSpacer { box-sizing: border-box; flex: none; width: 7.5rem; }
    .picklistToggle { display: inline-flex; align-items: center; justify-content: center; padding: 0.4rem 0.6rem; line-height: 1; white-space: nowrap; }
    .picklistToggleSpacer { display: inline-block; height: 1px; }
    .toggleGlyph { display: block; width: 2.1rem; height: 2.1rem; transition: transform ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS}ms ease; }
    [aria-expanded="true"] > .toggleGlyph { transform: rotate(90deg); }
    .noMotion > .toggleGlyph { transition: none; }
    .toggleGlyph path { fill: none; stroke: var(--sdt-accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .sdtButton-primary {
        color: var(--sdt-on-accent);
        background-color: var(--sdt-accent);
        border-color: var(--sdt-accent);
        font-weight: 600;
    }
    .sdtButton-primary:hover:not(:disabled) { filter: brightness(0.92); }
    .sdtButton-primary:active:not(:disabled) { filter: brightness(0.84); }
    .treeAddFriend { font-weight: 600; }
    .treeFavorite, .treeRename { padding: 0.4rem 0.6rem; font-size: 1.1em; line-height: 1; }
    .favoritesControls { display: inline-flex; align-items: center; gap: 0.5rem; }
    .treeAddFriendChoice, .historyAction { text-decoration: underline; }
    .sdtButton-primary:disabled, .sdtButton-secondary:disabled, .treeRecordCountInput:disabled {
        color: var(--sdt-disabled-text);
        background-color: var(--sdt-disabled-bg);
        border-color: var(--sdt-border);
        cursor: not-allowed;
        opacity: 1;
    }
    .sdtButton-compact { min-height: 0; min-width: 0; padding: 0.15rem 0.6rem; font-size: inherit; }
    .sdtButton-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: var(--sdt-text);
        background-color: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
    }
    .sdtButton-icon:hover:not(:disabled) { background-color: var(--sdt-row-hover); border-color: var(--sdt-border); }
    .sdtButton-icon:disabled { cursor: not-allowed; }
    .sdtButton-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--sdt-accent);
        text-align: left;
        cursor: pointer;
    }
    .sdtButton-link:focus-visible { outline-offset: -1px; }
    .sdtButton-link:hover { text-decoration: underline; }
    .treeAddFriends { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding-left: 1.5rem; }
    .treeBody { border-top: 1px solid var(--sdt-border); }
    .treeTabs { display: flex; gap: 0.5rem; padding: 0.4rem 0.6rem 0 0.6rem; }
    .treeTab { color: var(--sdt-muted); border-color: transparent; border-radius: 6px 6px 0 0; }
    .treeTab:hover:not(:disabled):not(.selected) { background-color: var(--sdt-row-hover); border-color: transparent; }
    .treeTab.selected { color: var(--sdt-text); font-weight: 600; }
    .treeTab:active:not(:disabled) { background-color: var(--sdt-row-hover); }
    /*
        The selected tab and its panel are ONE outline (#373): the tab's sides and top, then the
        panel's sides and bottom. The tab sits 1px over the panel's top edge with its own bottom edge
        in the panel's colour, so no line is drawn between them. Only the selected panel is shown,
        so every panel carries the outline and the selected class alone moves it. The selector is
        (0,4,0) against the secondary kind's (0,3,0) hover rule, so a hover cannot draw the bottom
        edge back wherever either rule sits. A hovered tab that is not selected draws no bottom edge,
        which would lie on the panel's accent top. The sub-tab strip wraps on a narrow panel, and a
        selected sub-tab on any row but the last then sits above the next row rather than its panel:
        scrolling the strip instead would clip the 1px overlap that joins every tab to its panel.
    */
    .treeTabs .treeTab.selected.sdtButton, .troubleshootingSubTabs .troubleshootingSubTab.selected.sdtButton {
        z-index: 1;
        margin-bottom: -1px;
        border-color: var(--sdt-accent);
        border-bottom-color: var(--sdt-surface);
        background-color: var(--sdt-surface);
    }
    .treeTabPanel, .troubleshootingSubPanel {
        border: 1px solid var(--sdt-accent);
        border-radius: 0 6px 6px 6px;
        background-color: var(--sdt-surface);
    }
    .treeTabPanel { margin: 0 0.6rem 0.6rem; }
    /*
        The bar moves to the selected tab (#227), along its TOP edge since #373 so nothing is drawn
        between the tab and its panel: the outgoing tab's shrinks TOWARD the incoming one while the
        incoming tab's grows FROM the outgoing side. The panel names the direction;
        a tab chosen by anything but a click carries noMotion, so it is not animated.
    */
    .treeTab { position: relative; }
    .treeTab::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: -1px;
        height: 2px;
        border-radius: 6px 6px 0 0;
        background-color: var(--sdt-accent);
        transform: scaleX(0);
        transition: transform ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS}ms ease;
        pointer-events: none;
    }
    .treeTab.selected::after { transform: scaleX(1); }
    .treeTabs.movingRight .treeTab::after, .treeTabs.movingLeft .treeTab.selected::after { transform-origin: right; }
    .treeTabs.movingLeft .treeTab::after, .treeTabs.movingRight .treeTab.selected::after { transform-origin: left; }
    .treeTabs.noMotion .treeTab::after { transition: none; }
    /* THE TROUBLESHOOTING SUB-TABS (#365) LOOK AND MOVE LIKE A CARD'S TABS */
    .troubleshootingSubTabs { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0.6rem; padding: 0.4rem 0 0 0; }
    .troubleshootingSubTab { color: var(--sdt-muted); border-color: transparent; border-radius: 6px 6px 0 0; }
    .troubleshootingSubTab:hover:not(:disabled):not(.selected) { background-color: var(--sdt-row-hover); border-color: transparent; }
    .troubleshootingSubTab.selected { color: var(--sdt-text); font-weight: 600; }
    .troubleshootingSubTab:active:not(:disabled) { background-color: var(--sdt-row-hover); }
    .troubleshootingSubTab { position: relative; }
    .troubleshootingSubTab::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: -1px;
        height: 2px;
        border-radius: 6px 6px 0 0;
        background-color: var(--sdt-accent);
        transform: scaleX(0);
        transition: transform ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS}ms ease;
        pointer-events: none;
    }
    .troubleshootingSubTab.selected::after { transform: scaleX(1); }
    .troubleshootingSubTabs.movingRight .troubleshootingSubTab::after, .troubleshootingSubTabs.movingLeft .troubleshootingSubTab.selected::after { transform-origin: right; }
    .troubleshootingSubTabs.movingLeft .troubleshootingSubTab::after, .troubleshootingSubTabs.movingRight .troubleshootingSubTab.selected::after { transform-origin: left; }
    .troubleshootingSubTabs.noMotion .troubleshootingSubTab::after { transition: none; }
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
    .treeObjectInclude { position: relative; z-index: 2; padding: 0.15rem; }
    .treeObjectIncludeSpacer { display: inline-block; }
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
    /* AN ANIMATING BODY IS ITS OWN STACKING CONTEXT, WHICH WOULD DRAW ITS CONTROLS UNDER THE OVERLAY MID-FADE */
    .treeObject.excluded .motionReveal { animation: none; }
    .treeObject.excluded .hidden.motionConceal { display: none !important; }
    .sdtButton-check {
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
    .sdtButton-check[aria-checked="false"] { background-color: var(--sdt-surface); border-color: var(--sdt-muted); }
    .sdtButton-check:disabled { color: var(--sdt-disabled-text); background-color: var(--sdt-disabled-bg); border-color: var(--sdt-border); cursor: not-allowed; }
    .recordTypesSection { margin: 0.25rem 0.6rem 0.5rem; border: 1px solid var(--sdt-border); border-radius: 6px; }
    .recordTypesSectionHeader { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem; cursor: pointer; }
    .recordTypesSectionTitle { font-weight: 600; }
    .recordTypesSection.disabled .recordTypesSectionHeader { cursor: default; }
    .recordTypesSection.disabled .recordTypesSectionTitle { color: var(--sdt-muted); }
    .recordTypesSection.disabled .recordTypesSectionToggle { cursor: default; }
    .recordTypesSection.disabled .toggleGlyph path { stroke: var(--sdt-muted); }
    .recordTypesSectionBody { padding: 0 0.75rem 0.75rem; border-top: 1px solid var(--sdt-border); }
    .recordTypesIntro { margin: 0.5rem 0; }
    .recordTypeObject { margin: 0.6rem 0; }
    .recordTypeObjectHeading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; font-weight: 600; }
    .recordTypeObjectStatus { font-weight: 400; }
    .recordTypeRow { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.25rem 0 0.25rem 1rem; }
    .recordTypeImpact { flex-basis: 100%; margin-left: 1.65em; }
    .recordTypesRememberRow { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.75rem; }
    .recordTypesRememberLabel { cursor: pointer; }
    .recordTypeActions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 0.75rem; }
    .treeFieldFixedValue { position: relative; z-index: 2; width: 1.5em; height: 1.5em; border-radius: 3px; }
    .fixedValueGlyph { display: block; width: 1.1em; height: 1.1em; }
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
    .recordTypeChip {
        position: relative;
        z-index: 2;
        padding: 0 0.35em;
        font-size: 0.85em;
        color: var(--sdt-chip-text);
        background-color: var(--sdt-chip-bg);
        border: 1px dashed var(--sdt-chip-text);
        border-radius: 3px;
    }
    .treeRecordTypeFieldsNote { font-size: 0.9em; }
    .treeRecordTypeFieldsCheck { display: inline-flex; align-items: center; gap: 0.4rem; }
    .treeRecordTypeFieldsLabel { cursor: pointer; }
    .treeRecordTypeFieldsCheck.disabled .treeRecordTypeFieldsLabel { color: var(--sdt-muted); cursor: not-allowed; }
    .treeTodosCheck { display: inline-flex; align-items: center; gap: 0.4rem; }
    .treeTodosLabel { cursor: pointer; }
    .treeTodosCheck.disabled .treeTodosLabel { color: var(--sdt-muted); cursor: not-allowed; }
    .treeTodosNote { font-size: 0.9em; }
    .treeTodos { position: relative; z-index: 2; margin: 0.15rem 0 0.25rem 0; }
    .treeTodo { display: flex; align-items: baseline; gap: 0.4rem; font-size: 0.85em; }
    .treeTodoText { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); }
    .validationRuleControl { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; }
    .expressionRow { display: flex; align-items: flex-start; gap: 0.3rem; }
    .expressionRow > pre { flex: 1 1 auto; min-width: 0; }
    .constrainedExpression {
        margin: 0.15rem 0 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-text);
    }
    .fixedValue {
        margin: 0.15rem 0 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-text);
    }
    .fieldEditor {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin: 0.3rem 0 0.2rem 0;
        padding: 0.4rem 0.5rem;
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 6px;
    }
    .fieldEditorInputs, .fieldEditorActions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
    .fieldEditorBound { display: inline-flex; align-items: baseline; gap: 0.3rem; }
    .fieldEditorInput {
        flex: 1 1 12rem;
        min-width: 0;
        padding: 0.15rem 0.3rem;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
    }
    .fieldEditorBound .fieldEditorInput { flex: 0 1 12rem; }
    .fieldEditorInput:focus { outline: 1px solid var(--sdt-accent); border-color: var(--sdt-accent); }
    .fieldEditorHint { font-size: 0.85em; }
    .fieldEditorRefusal { color: var(--sdt-removed); font-size: 0.9em; }
    .treeFieldNote, .treeFieldWarning { position: relative; z-index: 2; font-size: 0.85em; }
    .treeFieldWarning { color: var(--sdt-changed); }
    .treeResetSelection, .treeWireLookup, .treeWireAllLookups, .treeAddParentObject { min-height: 1.9rem; padding: 0.2rem 0.6rem; }
    .treeObjectHeader:hover, .treeField:hover { background-color: var(--sdt-row-hover); }
    .treeObjectHeader:focus-within, .treeField:focus-within { background-color: var(--sdt-row-hover); }
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
    .treeDatasetName { font-weight: 600; }
    .treeDatasetFavorite, .treeDatasetRename { font-size: 1.1em; line-height: 1; }
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
    @keyframes sdtSpin { to { transform: rotate(360deg); } }
    /* A RING, NOT A GLYPH: ITS COLOURS ARE THE PALETTE'S, AND REDUCED MOTION LEAVES IT DRAWN BUT STILL */
    .dataOrgSpinner {
        display: inline-block;
        width: 0.9rem;
        height: 0.9rem;
        border: 2px solid var(--sdt-border);
        border-top-color: var(--sdt-accent);
        border-radius: 50%;
        animation: sdtSpin ${RECIPE_COCKPIT_SPINNER_ROTATION_MILLISECONDS}ms linear infinite;
    }
    .dataOrgStatus { margin: 0.4rem 0; }
    .dataOrgStatus.failed { color: var(--sdt-removed); }
    .treecipeHeader { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--sdt-border); }
    .cockpitSection { margin: 0.6rem 0; }
    .cockpitSectionHeader { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; cursor: default; border-bottom: 1px solid var(--sdt-border); }
    #cockpitOrgSection { position: sticky; top: 0; z-index: 10; margin: 0; padding: 0.6rem 0; background-color: var(--sdt-page); border-bottom: 1px solid var(--sdt-border); }
    html:has(#cockpitOrgSection) { scroll-padding-top: ${RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING}; }
    .cockpitSectionTitle { font-weight: 600; font-size: 1.1em; }
    #cockpitOrgSectionBody { padding: 0.5rem 0.6rem; margin-top: 0.4rem; background-color: var(--sdt-surface); border: 1px solid var(--sdt-border); border-radius: 8px; }
    .treecipeActions, .treeInsertControls, .troubleshootingControls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
    .troubleshootingSubPanel { margin: 0 0.6rem 0.6rem; }
    .troubleshootingAction { margin-top: 0.4rem; }
    .troubleshootingSummary { margin-top: 0.2rem; }
    .treeQueryIntro { margin: 0.25rem 0.6rem 0.5rem; }
    .treeQuery { margin: 0.25rem 0.6rem 0.5rem; padding: 0.4rem 0.6rem; border: 1px solid var(--sdt-border); border-radius: 6px; }
    .treeQueryTitle { font-weight: 600; }
    .treeQueryControls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
    .treeQueryNote { font-size: 0.9em; }
    .treeQueryEdited { margin-left: 0.4rem; font-weight: normal; font-size: 0.85em; }
    .treeQueryText {
        display: block;
        box-sizing: border-box;
        width: 100%;
        margin-top: 0.3rem;
        padding: 0.3rem 0.4rem;
        font-family: var(--vscode-editor-font-family);
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 4px;
        resize: vertical;
    }
    .treeQueryText:focus { outline: 1px solid var(--sdt-accent); border-color: var(--sdt-accent); }
    .treeQueryResult { margin-top: 0.4rem; }
    .treeQueryTableWrap { overflow: auto; max-height: 24rem; margin-top: 0.2rem; }
    .treeQueryTable { border-collapse: collapse; font-size: 0.9em; }
    .treeQueryTable th, .treeQueryTable td { border: 1px solid var(--sdt-border); padding: 0.15rem 0.4rem; text-align: left; vertical-align: top; white-space: pre-wrap; }
    .validationRuleList { margin-top: 0.4rem; }
    .validationRuleObject { margin-top: 0.5rem; }
    .validationRuleObjectHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem; }
    .validationRuleObjectName { font-weight: 600; }
    .validationRuleCount { font-size: 0.9em; }
    .validationRule { margin: 0.3rem 0 0 0.8rem; padding: 0.3rem 0.5rem; border: 1px solid var(--sdt-border); border-radius: 6px; font-size: 0.9em; }
    .validationRuleHeader { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
    .validationRuleName { font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .validationRuleStatus { font-weight: 600; }
    .validationRuleMessage, .validationRuleReason, .validationRuleFormula { white-space: pre-wrap; word-break: break-word; margin-top: 0.15rem; }
    .validationRuleFormula { font-family: var(--vscode-editor-font-family); }
    .validationRuleFormulaToggle { margin-top: 0.25rem; }
    .troubleshootingTodoHeader { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.4rem; }
    .troubleshootingTodoObject { font-weight: 600; }
    .troubleshootingTodoCount { font-size: 0.9em; }
    .troubleshootingTodo { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem; margin: 0.15rem 0 0 0.8rem; font-size: 0.9em; }
    .troubleshootingTodoField { font-family: var(--vscode-editor-font-family); }
    .troubleshootingTodoText { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); }
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
    .cockpitHeader { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .cockpitMeta { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.4rem; margin-left: auto; color: var(--sdt-muted); }
    .cockpitChangelog { padding: 0.25rem; }
    .cockpitChangelog:hover:not(:disabled) { background-color: var(--sdt-surface); }
    .githubGlyph { display: block; width: 18px; height: 18px; }
    .githubGlyph path { fill: var(--sdt-muted); }
    .cockpitChangelog:hover .githubGlyph path, .cockpitChangelog:focus-visible .githubGlyph path { fill: var(--sdt-accent); }
    .confirmOverlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background-color: var(--sdt-dialog-backdrop);
    }
    .confirmDialog {
        display: flex;
        flex-direction: column;
        width: min(42rem, 100%);
        max-height: calc(100vh - 32px);
        color: var(--sdt-text);
        background-color: var(--sdt-surface);
        border: 1px solid var(--sdt-border);
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    .confirmTitle { margin: 0; padding: 0.9rem 1rem 0.5rem 1rem; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
    .confirmBody {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 60vh;
        overflow-y: auto;
        padding: 0.25rem 1rem 0.75rem 1rem;
        border-top: 1px solid var(--sdt-border);
        border-bottom: 1px solid var(--sdt-border);
    }
    .confirmLine { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.15rem 0; }
    .confirmListItem { padding-left: 1rem; }
    .confirmGap { height: 0.6rem; }
    .confirmActions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; }
    @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
            transition: none !important;
            animation: none !important;
        }
    }
</style>
</head>
<body>
<div class="cockpitHeader">
<h1>${RECIPE_COCKPIT_PANEL_TITLE}</h1>
<div id="cockpitMeta" class="cockpitMeta"></div>
</div>
<div id="loadStatus" class="loadStatus">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>
<div id="cockpitBody"></div>
<div id="cockpitDialogHost"></div>
<script nonce="${nonce}">
(function () {

    const vscodeApi = acquireVsCodeApi();
    const loadStatusElement = document.getElementById('loadStatus');
    const cockpitBodyElement = document.getElementById('cockpitBody');
    const cockpitMetaElement = document.getElementById('cockpitMeta');
    const cockpitDialogHostElement = document.getElementById('cockpitDialogHost');
    // THE ONE IN-PANEL CONFIRMATION ON SCREEN (#349), OR null
    let confirmDialog = null;
    const CHANGELOG_LINK_LABEL = ${JSON.stringify(RECIPE_COCKPIT_CHANGELOG_LINK_LABEL)};
    const GITHUB_GLYPH_VIEW_BOX = ${JSON.stringify(RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX)};
    const GITHUB_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_GITHUB_GLYPH_PATH)};
    let cockpitVersionElement = null;
    const AUTO_EXPAND_OBJECT_LIMIT = ${RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT};
    const AUTO_EXPAND_ROW_BUDGET = ${RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET};
    const GENERATE_TREECIPE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL)};
    const GENERATE_TREECIPE_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL)};
    const NO_DATA_ORG_INSERT_REASON = ${JSON.stringify(RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON)};
    const CHOOSE_INSERT_ORG_NOTE = ${JSON.stringify(RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE)};
    const CANNOT_INSERT_PREFIX = ${JSON.stringify(RECIPE_COCKPIT_CANNOT_INSERT_PREFIX)};
    const ADD_FRIEND_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL)};
    const WIRE_LOOKUP_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_WIRE_LOOKUP_ACTION_LABEL)};
    const WIRE_ALL_LOOKUPS_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL)};
    const INSERT_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_INSERT_ACTION_LABEL)};
    const INSERT_RUNNING_LABEL = ${JSON.stringify(RECIPE_COCKPIT_INSERT_RUNNING_LABEL)};
    const PERMISSION_SET_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL)};
    const GENERATE_PERMISSION_SET_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL)};
    const VALIDATION_RULE_RETRIEVE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL)};
    const DEPLOY_ACTION_LABELS = ${JSON.stringify(RECIPE_COCKPIT_DEPLOY_ACTION_LABELS)};
    const BUTTON_KINDS = ${JSON.stringify(RECIPE_COCKPIT_BUTTON_KINDS)};
    const DEPLOY_COMMANDS = ${JSON.stringify(RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND)};
    const TROUBLESHOOTING_TAB_LABEL = ${JSON.stringify(RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL)};
    const TROUBLESHOOTING_SUB_TABS = ${JSON.stringify(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS)};
    const TROUBLESHOOTING_SUB_TAB_LABELS = ${JSON.stringify(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS)};
    const TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS = ${JSON.stringify(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS)};
    const NO_TREE_TODOS_NOTE = ${JSON.stringify(RECIPE_COCKPIT_NO_TREE_TODOS_NOTE)};
    const VALIDATION_RULE_STATUS_LABELS = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_STATUS_LABELS)};
    const VALIDATION_RULES_LOADING_NOTE = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE)};
    const NO_LOCAL_VALIDATION_RULES_NOTE = ${JSON.stringify(RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE)};
    const OBJECT_NO_VALIDATION_RULES_NOTE = ${JSON.stringify(RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE)};
    const VALIDATION_RULE_NOT_IN_RUN_NOTE = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE)};
    const VALIDATION_RULE_FILE_MISSING_NOTE = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE)};
    const VALIDATION_RULE_NO_FIELDS_NOTE = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_NO_FIELDS_NOTE)};
    const TODO_IN_FIELD_VALUE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL)};
    const QUERY_TAB_LABEL = ${JSON.stringify(RECIPE_COCKPIT_QUERY_TAB_LABEL)};
    const QUERY_INTRO = ${JSON.stringify(RECIPE_COCKPIT_QUERY_INTRO)};
    const QUERY_MAX_LENGTH = ${RECIPE_COCKPIT_QUERY_MAX_LENGTH};
    const DATA_ORG_CONNECTION_CHECK_TEXT = ${JSON.stringify(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT)};
    const DATA_ORG_CONNECTION_CHECK_INSERT_REASON = ${JSON.stringify(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON)};
    const DATA_ORG_LOADING_PLACEHOLDER = ${JSON.stringify(RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER)};
    const DATA_ORG_NONE_LISTED_PLACEHOLDER = ${JSON.stringify(RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER)};
    const PANEL_PLACE_VERSION = ${RECIPE_COCKPIT_PANEL_PLACE_VERSION};
    const PANEL_PLACE_SCROLL_SAVE_DELAY = ${RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY};
    const PANEL_PLACE_TABS = ${JSON.stringify(RECIPE_COCKPIT_TREE_TABS)};
    const TABS_WITHOUT_SEARCH = ${JSON.stringify(RECIPE_COCKPIT_TABS_WITHOUT_SEARCH)};
    const OPTIONAL_SEARCH_TABS = ${JSON.stringify(RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS)};
    const PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB = ${RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB};
    const TREE_TAB_RENAMES = ${JSON.stringify(RECIPE_COCKPIT_TREE_TAB_RENAMES)};
    const REMOVED_TREE_TABS = ${JSON.stringify(RECIPE_COCKPIT_REMOVED_TREE_TABS)};
    const RECORD_TYPES_SECTION_TITLE = ${JSON.stringify(RECIPE_COCKPIT_RECORD_TYPES_SECTION_TITLE)};
    const ORG_SECTION_TITLE = ${JSON.stringify(RECIPE_COCKPIT_ORG_SECTION_TITLE)};
    const TREECIPES_SECTION_TITLE = ${JSON.stringify(RECIPE_COCKPIT_TREECIPES_SECTION_TITLE)};
    const TREECIPE_PICKER_LABEL = ${JSON.stringify(RECIPE_COCKPIT_TREECIPE_PICKER_LABEL)};
    const TREECIPES_SEARCH_PLACEHOLDER = ${JSON.stringify(RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER)};
    const TREECIPES_SEARCH_NO_MATCH = ${JSON.stringify(RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH)};
    const TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX = ${JSON.stringify(RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX)};
    const TREECIPES_SEARCH_RESULT_LIMIT = ${RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT};
    const REGENERATE_WITH_RECORD_TYPES_LABEL = ${JSON.stringify(RECIPE_COCKPIT_REGENERATE_WITH_RECORD_TYPES_LABEL)};
    const USE_DEFAULT_RECORD_TYPES_LABEL = ${JSON.stringify(RECIPE_COCKPIT_USE_DEFAULT_RECORD_TYPES_LABEL)};
    const REMEMBER_RECORD_TYPES_LABEL = ${JSON.stringify(RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL)};
    const REMEMBER_RECORD_TYPES_TITLE = ${JSON.stringify(RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE)};
    const RECORD_TYPES_INTRO = ${JSON.stringify(RECIPE_COCKPIT_RECORD_TYPES_INTRO)};
    const RECORD_TYPES_UNAVAILABLE_SUMMARY = ${JSON.stringify(RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY)};
    const RENAME_TREE_ACTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RENAME_TREE_ACTION_LABEL)};
    const FAVORITE_TREE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FAVORITE_TREE_LABEL)};
    const NOT_FAVORITE_TREE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL)};
    const FAVORITES_ONLY_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FAVORITES_ONLY_LABEL)};
    const RECORD_TYPE_FIELDS_ONLY_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL)};
    const PICKLIST_SHOW_VALUES_LABEL = ${JSON.stringify(RECIPE_COCKPIT_PICKLIST_SHOW_VALUES_LABEL)};
    const PICKLIST_HIDE_VALUES_LABEL = ${JSON.stringify(RECIPE_COCKPIT_PICKLIST_HIDE_VALUES_LABEL)};
    const NO_RECORD_TYPE_FIELDS_NOTE = ${JSON.stringify(RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE)};
    const TODOS_ONLY_LABEL = ${JSON.stringify(RECIPE_COCKPIT_TODOS_ONLY_LABEL)};
    const TODO_IN_VALUE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_TODO_IN_VALUE_LABEL)};
    const NO_TODOS_NOTE = ${JSON.stringify(RECIPE_COCKPIT_NO_TODOS_NOTE)};
    const NO_FAVORITES_MESSAGE = ${JSON.stringify(RECIPE_COCKPIT_NO_FAVORITES_MESSAGE)};
    const HELP_TOGGLE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_HELP_TOGGLE_LABEL)};
    const HELP_TOGGLE_ARIA_LABEL = ${JSON.stringify(RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL)};
    const HELP_TITLE = ${JSON.stringify(RECIPE_COCKPIT_HELP_TITLE)};
    const HELP_RUN_PREFIX = ${JSON.stringify(RECIPE_COCKPIT_HELP_RUN_PREFIX)};
    const HELP_GUIDE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_HELP_GUIDE_LABEL)};
    const HELP_SUMMARY_HEADING = ${JSON.stringify(RECIPE_COCKPIT_HELP_SUMMARY_HEADING)};
    const HELP_NO_DIFFERENCE = ${JSON.stringify(RECIPE_COCKPIT_HELP_NO_DIFFERENCE)};
    const HELP_BACKEND_NOTE = ${JSON.stringify(RECIPE_COCKPIT_HELP_BACKEND_NOTE)};
    const HELP_SECTIONS = ${JSON.stringify(RECIPE_COCKPIT_HELP_SECTIONS)};
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const TREE_GLYPH_VIEW_BOX = ${JSON.stringify(RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX)};
    const TREE_GLYPH_TRANSFORM = ${JSON.stringify(RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM)};
    const TREE_LINKED_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH)};
    const TREE_BROKEN_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH)};
    const FIELD_PARENT_EXCLUDED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON)};
    const FIXED_VALUE_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH)};
    const TOGGLE_COLLAPSED_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH)};
    const SEARCH_GLYPH_PATH = ${JSON.stringify(RECIPE_COCKPIT_SEARCH_GLYPH_PATH)};
    const MOTION_REVEAL_MILLISECONDS = ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS};
    const MOTION_CONCEAL_MILLISECONDS = ${RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS};
    const motionTimers = new WeakMap();
    const FIXED_VALUE_BADGE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL)};
    const EDITED_EXPRESSION_BADGE_LABEL = ${JSON.stringify(RECIPE_COCKPIT_EDITED_EXPRESSION_BADGE_LABEL)};
    const EXPRESSION_OPENER = ${JSON.stringify(RECIPE_COCKPIT_EXPRESSION_OPENER)};
    const FIXED_VALUE_OBJECT_EXCLUDED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON)};
    const FIXED_VALUE_UNTICKED_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON)};
    const FIXED_VALUE_RECORD_TYPE_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON)};
    const FIXED_VALUE_LOOKUP_REASON = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON)};
    const FIXED_VALUE_DEPENDENT_REASON_PREFIX = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX)};
    const FIXED_VALUE_LOOKUP_FIELD_TYPES = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES)};
    const VALIDATION_RULE_FIXED_VALUE_REASON = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON)};
    const VALIDATION_RULE_NOT_APPLIED_LABEL = ${JSON.stringify(RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL)};
    const EVERY_FIELD_UNTICKED_WARNING = ${JSON.stringify(RECIPE_COCKPIT_EVERY_FIELD_UNTICKED_WARNING)};
    const RESET_SELECTION_LABEL = ${JSON.stringify(RECIPE_COCKPIT_RESET_SELECTION_LABEL)};
    const REFRESH_ORGS_LABEL = ${JSON.stringify(RECIPE_COCKPIT_REFRESH_ORGS_LABEL)};
    const OPEN_ORG_LABEL = ${JSON.stringify(RECIPE_COCKPIT_OPEN_ORG_LABEL)};
    const FIXED_VALUE_MAX_LENGTH = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH)};
    const FIXED_VALUE_NUMBER_FIELD_TYPES = ${JSON.stringify(RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES)};
    const GEOLOCATION_COMPONENT_RANGES = ${JSON.stringify(RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES)};

    let treeStates = [];
    let treesViewElement = null;
    let runSelectElement = null;
    let renderedRunFolderName = '';
    let renderedSequence = null;
    // WHETHER A FRIEND IS BEING ADDED; IT OUTLIVES A MODEL FOR THE SAME REASON
    let isAddFriendRunning = false;
    // EVERY "+" AND FRIEND CHOICE DRAWN FOR THIS MODEL, SO ONE CLICK CAN DISABLE THEM ALL
    let addFriendButtonElements = [];
    // THE SAME FOR "Wire to…" AND "Wire TODO lookups" (#151)
    let isWireLookupRunning = false;
    let wireLookupButtonElements = [];
    // EACH CARD'S lookupWirings BY OBJECT, OCCURRENCE AND FIELD, BUILT ONCE PER CARD RATHER THAN SCANNED PER ROW
    let lookupWiringIndexByTree = new WeakMap();
    let addableParentIndexByTree = new WeakMap();
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
    /*
        WHILE "sf org list" CHECKS THE CONNECTIONS (#305) THE PICKER STAYS DRAWN: THE DROPDOWN HOLDS ONE
        OPTION -- THE HOST'S PROVISIONAL LABEL, ELSE "Loading orgs…" -- THAT NOTHING CAN SELECT, AND A
        SPINNER SITS TO ITS RIGHT. A NEW ARRAY PER CHANGE, SO EACH VIEW REDRAWS ITS OPTIONS ONCE
    */
    let isDataOrgChecking = false;
    let dataOrgCheckingOptionLabels = [];
    let dataOrgProvisionalRequestSequence = null;
    let dataOrgTypeLabel = null;
    let dataOrgStatusText = '';
    let isDataOrgStatusFailure = false;
    let dataOrgHiddenNoteText = '';
    // "+ New scratch org" (#200): WHETHER A RUN HOLDS THE PICKER AND EVERY INSERT DISABLED; HOW IT ENDED IS A NOTIFICATION'S (#301)
    let isScratchOrgRunning = false;
    // "Assign permission sets to me…" (#274, #302): WHETHER AN ASSIGNMENT HOLDS THE PICKER, EVERY INSERT AND EVERY ASSIGN BUTTON DISABLED
    let isPermissionSetAssignRunning = false;
    // "Retrieve validation rules…" (#326): SET ON THE CLICK, CLEARED BY THE HOST'S validationRuleRetrieveState
    let isValidationRuleRetrieveRunning = false;
    // THE QUERY TAB'S RUN (#367): SET ON THE CLICK, CLEARED BY THE HOST'S treeQueryState; ONE PER WINDOW
    let isTreeQueryRunning = false;
    // THE TROUBLESHOOTING TAB'S DEPLOYS (#346): SET ON THE CLICK, CLEARED BY THE HOST'S metadataDeployState; THE KEY NAMES THE BUTTON CLICKED
    let isMetadataDeployRunning = false;
    let metadataDeployRunningKey = null;
    // "Open in browser" (#279): SET ON THE CLICK, CLEARED BY THE HOST'S orgOpenState
    let isOrgOpenRunning = false;
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
    /*
        The Treecipes section draws ONE card, chosen in its dropdown (#374). Every card stays in the
        document, hidden, so switching back finds its tab, searches and opened objects as they were,
        and an in-place update reaches a card whether or not it is on screen. The section search
        matches what the model carries; its index is lowercased once per model, on the first query.
    */
    let selectedTreeKey = null;
    let treecipesControlsElement = null;
    let treePickerElement = null;
    let treePickerTreeStates = [];
    let treecipesSearch = null;
    let treecipesSearchText = '';
    let treecipesSearchIndex = null;
    // TREE KEY -> true FOR A CARD THE SECTION SEARCH MATCHED, OR null WHILE THERE IS NO SEARCH; KEYED BY FOLDER NAMES, SO NO PROTOTYPE
    let treecipesMatchedTreeKeys = null;
    // THE HELP SECTION (#332) OUTLIVES A MODEL IN THIS DOCUMENT; ITS SUMMARY IS DRAWN FROM THE TREES OF THE MODEL ON SCREEN
    let isHelpExpanded = false;
    let helpToggleElement = null;
    let helpSectionElement = null;
    let helpSummaryElement = null;
    let helpTrees = [];
    // NEITHER THE ORG SECTION (#355) NOR THE TREECIPES SECTION (#364) FOLDS
    let orgSection = null;
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

    // THE ONLY WAY THE PANEL MAKES A BUTTON (#363): ITS KIND STYLES IT, ITS OWN CLASS ONLY SIZES AND PLACES IT
    function createButton(kind, className, textContent, size) {

        if (BUTTON_KINDS.indexOf(kind) === -1) { throw new Error('Unknown button kind: ' + kind); }
        const buttonClassName = 'sdtButton sdtButton-' + kind + (size === 'compact' ? ' sdtButton-compact' : '') + (className ? ' ' + className : '');
        return createElement('button', buttonClassName, textContent);

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

        const sourceLinkElement = createButton('link', className + ' sourceLink', labelText);
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

        renderHelp(recipe, hasObjects);

    }

    /*
        The help section (#332): where the recipes come from, what the cockpit changes without
        editing them, what does edit them and where the changes are kept, then one line per card
        that differs from its recipe file now. Everything is this file's own text or a name from the
        model, written through textContent; the guide's url is the host's, and the button posts
        nothing but the command.
    */
    function renderHelp(recipe, hasObjects) {

        helpTrees = hasObjects ? (recipe.trees || []) : [];

        helpSectionElement = createElement('section', 'helpSection hidden');
        helpSectionElement.setAttribute('id', 'cockpitHelp');
        helpSectionElement.setAttribute('aria-label', HELP_TITLE);
        helpSectionElement.appendChild(createElement('div', 'helpTitle', HELP_TITLE));

        if (hasObjects && recipe.selectedRunFolderName) {
            helpSectionElement.appendChild(createElement('div', 'helpRun muted', HELP_RUN_PREFIX + recipe.selectedRunFolderName));
        }

        HELP_SECTIONS.forEach(function (helpSection) {
            const helpPartElement = createElement('div', 'helpPart');
            helpPartElement.appendChild(createElement('div', 'helpHeading', helpSection.heading));
            appendHelpParagraphs(helpPartElement, helpSection.paragraphs);
            if (Array.isArray(helpSection.items) && helpSection.items.length > 0) {
                const helpListElement = createElement('ul', 'helpList');
                helpSection.items.forEach(function (helpItem) { helpListElement.appendChild(createElement('li', '', helpItem)); });
                helpPartElement.appendChild(helpListElement);
            }
            appendHelpParagraphs(helpPartElement, helpSection.closingParagraphs);
            helpSectionElement.appendChild(helpPartElement);
        });

        helpSectionElement.appendChild(createElement('p', 'helpParagraph muted', HELP_BACKEND_NOTE));

        if (hasObjects) {
            const helpSummaryPartElement = createElement('div', 'helpPart');
            helpSummaryPartElement.appendChild(createElement('div', 'helpHeading', HELP_SUMMARY_HEADING));
            helpSummaryElement = createElement('ul', 'helpList helpSummary');
            helpSummaryPartElement.appendChild(helpSummaryElement);
            helpSectionElement.appendChild(helpSummaryPartElement);
            drawHelpSummary();
        }

        // A PRIMARY BUTTON: THE ONE MAIN ACTION OF THE HELP SECTION (#363)
        const helpActionsElement = createElement('div', 'emptyStateActions helpActions');
        const helpGuideElement = createButton('primary', 'helpGuideOpen', HELP_GUIDE_LABEL);
        helpGuideElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'openHelpGuide' });
        });
        helpActionsElement.appendChild(helpGuideElement);
        helpSectionElement.appendChild(helpActionsElement);

        cockpitBodyElement.appendChild(helpSectionElement);

        if (helpToggleElement) {
            helpToggleElement.disabled = false;
            helpToggleElement.setAttribute('aria-controls', 'cockpitHelp');
        }
        setHelpExpanded(isHelpExpanded, false);

    }

    function appendHelpParagraphs(containerElement, paragraphs) {
        (paragraphs || []).forEach(function (paragraph) {
            containerElement.appendChild(createElement('p', 'helpParagraph', paragraph));
        });
    }

    function setHelpExpanded(isExpanded, isAnimated) {

        isHelpExpanded = isExpanded;
        if (!helpToggleElement || !helpSectionElement) { return; }

        helpToggleElement.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        setShownWithMotion(helpSectionElement, isExpanded, isAnimated);

    }

    /*
        One line per card with a folder that generates something other than its recipe file, from
        the same fields the card draws its selection from. A card with no folder (the ungrouped one)
        can hold no selection, so it is never listed.
    */
    function drawHelpSummary() {

        if (!helpSummaryElement) { return; }

        helpSummaryElement.textContent = '';

        const summaryLines = [];
        helpTrees.forEach(function (tree) {
            if (!tree.folderName) { return; }
            const differences = describeTreeDifferences(tree);
            if (differences.length > 0) { summaryLines.push(displayTitleOf(tree) + ': ' + differences.join(' · ')); }
        });

        if (summaryLines.length === 0) {
            helpSummaryElement.appendChild(createElement('li', 'muted', HELP_NO_DIFFERENCE));
            return;
        }

        summaryLines.forEach(function (summaryLine) {
            helpSummaryElement.appendChild(createElement('li', '', summaryLine));
        });

    }

    function describeTreeDifferences(tree) {

        const countOf = function (candidateList) { return Array.isArray(candidateList) ? candidateList.length : 0; };
        const describe = function (count, singular, plural) { return count + ' ' + (count === 1 ? singular : plural); };

        const exclusions = tree.objectSelection && Array.isArray(tree.objectSelection.exclusions) ? tree.objectSelection.exclusions : [];
        // AN EXCLUDED OBJECT KEEPS ITS UNTICKED FIELDS AND STORED COUNT FOR WHEN IT COMES BACK, BUT GENERATION APPLIES NEITHER
        const excludedObjectApiNames = toStringSet(exclusions.map(function (exclusion) { return exclusion.objectApiName; }));
        const isGenerated = function (entry) { return !!entry && !hasString(excludedObjectApiNames, entry.objectApiName); };
        const generatedEntries = function (candidateList) { return Array.isArray(candidateList) ? candidateList.filter(isGenerated) : []; };

        const untickedFieldCount = generatedEntries(tree.fieldSelection && tree.fieldSelection.objects)
            .reduce(function (total, objectFieldSelection) { return total + countOf(objectFieldSelection.excludedFieldApiNames); }, 0);

        const rulesOffCount = generatedEntries(tree.validationRulesOff).length;

        return [
            [exclusions.length, 'object excluded', 'objects excluded'],
            [untickedFieldCount, 'field unticked', 'fields unticked'],
            [generatedEntries(tree.objectCounts).length, 'count changed', 'counts changed'],
            [rulesOffCount, 'field without its rules', 'fields without their rules']
        ].filter(function (difference) { return difference[0] > 0; })
            .map(function (difference) { return describe(difference[0], difference[1], difference[2]); });

    }

    // A PANEL-ONLY FILTER (#235): IT HIDES CARDS, ASKS THE HOST NOTHING, AND IS KEPT WITH THE READER'S PLACE
    function renderFavoritesToggle(toolbarElement) {

        const favoritesElement = createElement('span', 'favoritesControls');

        favoritesToggleElement = createButton('primary', 'favoritesToggle');
        favoritesToggleElement.setAttribute('title', 'Show only the trees marked as favorites');
        favoritesToggleElement.addEventListener('click', function () {
            isFavoritesOnly = !isFavoritesOnly;
            applyTreecipesSearch();
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

    /*
        Favorites only narrows the DROPDOWN (#374): the card on screen moves to the first favorite
        when it is not one, and the choice moves with it; with no favorite nothing is drawn but the
        notice, and turning the filter off draws the card chosen before.
    */
    function applyFavoritesFilter(isAnimated) {

        const shownCount = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); }).length;

        applyTreePicker(isAnimated);

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

    function treePickerLabelOf(treeState) {
        return (treeState.tree.isFavorite === true ? FAVORITE_TREE_LABEL + ' ' : '') + displayTitleOf(treeState.tree);
    }

    /*
        What the dropdown lists and which card is drawn (#374): the cards Favorites only leaves, in
        RecipeFiles order, narrowed to the ones the section search matched. The card on screen stays
        on screen while a search does not match it -- listed first, marked -- and a search matching
        nothing disables the dropdown rather than taking the card away.
    */
    function applyTreePicker(isAnimated) {

        if (!treePickerElement) { return; }

        const pickableTreeStates = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); });
        const chosenTreeState = findTreeState(selectedTreeKey);
        const shownTreeState = chosenTreeState && !isHiddenByFavorites(chosenTreeState) ? chosenTreeState : (pickableTreeStates[0] || null);

        if (shownTreeState) { selectedTreeKey = shownTreeState.tree.treeKey; }

        const listedTreeStates = treecipesMatchedTreeKeys === null
            ? pickableTreeStates
            : pickableTreeStates.filter(function (treeState) { return hasString(treecipesMatchedTreeKeys, treeState.tree.treeKey); });
        const isShownUnlisted = !!shownTreeState && listedTreeStates.indexOf(shownTreeState) === -1;

        treePickerTreeStates = isShownUnlisted ? [shownTreeState].concat(listedTreeStates) : listedTreeStates;
        treePickerElement.textContent = '';
        treePickerTreeStates.forEach(function (treeState, optionIndex) {
            const label = treePickerLabelOf(treeState) + (isShownUnlisted && optionIndex === 0 ? TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX : '');
            const optionElement = createElement('option', '', label);
            optionElement.value = String(optionIndex);
            optionElement.selected = treeState === shownTreeState;
            treePickerElement.appendChild(optionElement);
        });
        treePickerElement.value = shownTreeState ? String(treePickerTreeStates.indexOf(shownTreeState)) : '';
        treePickerElement.disabled = listedTreeStates.length === 0;

        // ONLY THE INCOMING CARD FADES, AND ONLY ON THE READER'S PICK; THE OUTGOING ONE IS GONE AT ONCE
        treeStates.forEach(function (treeState) {
            if (treeState === shownTreeState) {
                if (treeState.element.classList.contains('hidden')) { setShownWithMotion(treeState.element, true, isAnimated); }
            } else {
                setShownWithMotion(treeState.element, false, false);
            }
        });

        if (shownTreeState) { setTreeExpanded(shownTreeState, true); }

    }

    // THE READER'S PICK, OR A RESULT THEY CLICKED: OPENING A CARD ON ITS TREECIPE TAB LISTS THE ORGS ITS INSERT OFFERS, AS IT ALWAYS HAS
    function chooseTree(treeState, isByReader) {

        if (isHiddenByFavorites(treeState)) { isFavoritesOnly = false; }
        selectedTreeKey = treeState.tree.treeKey;
        applyFavoritesFilter(isByReader);

        if (isByReader && treeState.selectedTab === 'treecipe' && renderedSequence !== null && !isRestoringPlace) { requestDataOrgs(); }

    }

    function buildTreePicker() {

        const pickerElement = createElement('div', 'treePicker');
        const labelElement = createElement('label', 'treePickerLabel', TREECIPE_PICKER_LABEL);

        treePickerElement = createElement('select', 'treePickerSelect');
        treePickerElement.setAttribute('id', 'treePickerSelect');
        treePickerElement.setAttribute('aria-label', TREECIPE_PICKER_LABEL);
        labelElement.setAttribute('for', 'treePickerSelect');
        treePickerElement.addEventListener('change', function () {
            const optionIndex = /^[0-9]+$/.test(String(treePickerElement.value)) ? Number(treePickerElement.value) : -1;
            const treeState = treePickerTreeStates[optionIndex];
            if (!treeState) { return; }
            chooseTree(treeState, true);
            savePanelPlace();
        });

        pickerElement.appendChild(labelElement);
        pickerElement.appendChild(treePickerElement);

        return pickerElement;

    }

    /*
        One entry per thing the section search can find, lowercased ONCE per model: a card's title
        and folder, and per object it lists (once, iterations being the same object) its api name,
        its fields' api names and labels and its record types' developer names -- all of it already
        in the model, so the host is asked nothing.
    */
    function buildTreecipesSearchIndex() {

        return treeStates.map(function (treeState) {

            const tree = treeState.tree;
            const entries = [{ kind: 'treecipe', text: displayTitleOf(tree) + (tree.folderName ? ' · ' + tree.folderName : ''), haystack: (displayTitleOf(tree) + '\\n' + (tree.folderName || '')).toLowerCase() }];
            const indexedObjectApiNames = Object.create(null);

            treeState.objectStates.forEach(function (treeObjectState) {

                const object = treeObjectState.object;
                if (treeObjectState.isIteration || indexedObjectApiNames[object.objectApiName] === true) { return; }
                indexedObjectApiNames[object.objectApiName] = true;

                entries.push({ kind: 'object', objectApiName: object.objectApiName, text: object.objectApiName, haystack: object.objectApiName.toLowerCase() });

                object.fields.forEach(function (field) {
                    const fieldLabel = typeof field.fieldLabel === 'string' ? field.fieldLabel : '';
                    entries.push({
                        kind: 'field',
                        objectApiName: object.objectApiName,
                        fieldApiName: field.fieldApiName,
                        text: object.objectApiName + '.' + field.fieldApiName + (fieldLabel ? ' · ' + fieldLabel : ''),
                        haystack: (field.fieldApiName + '\\n' + fieldLabel).toLowerCase()
                    });
                });

                (Array.isArray(object.recordTypes) ? object.recordTypes : []).forEach(function (recordType) {
                    if (!recordType || typeof recordType.developerName !== 'string') { return; }
                    entries.push({ kind: 'recordType', objectApiName: object.objectApiName, text: object.objectApiName + ' · ' + recordType.developerName, haystack: recordType.developerName.toLowerCase() });
                });

            });

            return { treeState: treeState, entries: entries };

        });

    }

    function buildTreecipesSearch() {

        // ITS OWN CLASSES, STYLED LIKE A TAB'S SEARCH, SO NOTHING THAT LOOKS FOR A TAB'S BOX FINDS THIS ONE
        const searchElement = createElement('div', 'treecipesSearch');
        const fieldElement = createElement('div', 'tabSearchField');
        const inputElement = createElement('input', 'treecipesSearchInput');
        const iconElement = buildSearchIconElement();

        iconElement.addEventListener('click', function () {
            if (typeof inputElement.focus === 'function') { inputElement.focus(); }
        });

        inputElement.setAttribute('type', 'search');
        inputElement.setAttribute('placeholder', TREECIPES_SEARCH_PLACEHOLDER);
        inputElement.setAttribute('aria-label', TREECIPES_SEARCH_PLACEHOLDER);
        inputElement.value = treecipesSearchText;
        inputElement.addEventListener('input', function () {
            treecipesSearchText = String(inputElement.value || '');
            applyTreecipesSearch();
            savePanelPlace();
        });

        fieldElement.appendChild(iconElement);
        fieldElement.appendChild(inputElement);
        searchElement.appendChild(fieldElement);

        treecipesSearch = {
            element: searchElement,
            inputElement: inputElement,
            matchCountElement: createElement('span', 'treecipesSearchCount muted'),
            resultsElement: createElement('div', 'treecipesSearchResults hidden')
        };
        treecipesSearch.resultsElement.setAttribute('role', 'list');
        treecipesSearch.resultsElement.setAttribute('aria-label', 'Search results');
        searchElement.appendChild(treecipesSearch.matchCountElement);

        return treecipesSearch;

    }

    const TREECIPES_SEARCH_KINDS = [
        { kind: 'treecipe', label: 'treecipe' },
        { kind: 'object', label: 'object' },
        { kind: 'field', label: 'field' },
        { kind: 'recordType', label: 'record type' }
    ];

    /*
        Each keystroke scans the index built once per model; what it draws is bounded by
        TREECIPES_SEARCH_RESULT_LIMIT rows, grouped by treecipe and kind, and one "N more" line.
    */
    function applyTreecipesSearch() {

        if (!treecipesSearch) {
            applyFavoritesFilter();
            return;
        }

        const searchQuery = treecipesSearchText.trim().toLowerCase();
        const resultsElement = treecipesSearch.resultsElement;

        resultsElement.textContent = '';

        if (!searchQuery) {
            treecipesMatchedTreeKeys = null;
            treecipesSearch.matchCountElement.textContent = '';
            resultsElement.classList.add('hidden');
            applyFavoritesFilter();
            return;
        }

        if (treecipesSearchIndex === null) { treecipesSearchIndex = buildTreecipesSearchIndex(); }

        treecipesMatchedTreeKeys = Object.create(null);
        let matchedTreeCount = 0;
        let drawnResultCount = 0;
        let hiddenResultCount = 0;

        treecipesSearchIndex.forEach(function (indexedTree) {

            if (isHiddenByFavorites(indexedTree.treeState)) { return; }

            const hitsByKind = Object.create(null);
            let treeHitCount = 0;

            indexedTree.entries.forEach(function (entry) {
                if (entry.haystack.indexOf(searchQuery) === -1) { return; }
                (hitsByKind[entry.kind] = hitsByKind[entry.kind] || []).push(entry);
                treeHitCount++;
            });

            if (treeHitCount === 0) { return; }

            treecipesMatchedTreeKeys[indexedTree.treeState.tree.treeKey] = true;
            matchedTreeCount++;

            if (drawnResultCount >= TREECIPES_SEARCH_RESULT_LIMIT) {
                hiddenResultCount += treeHitCount;
                return;
            }

            const groupElement = createElement('div', 'treecipesResultGroup');
            groupElement.setAttribute('role', 'listitem');
            groupElement.appendChild(createElement('div', 'treecipesResultTree', displayTitleOf(indexedTree.treeState.tree)));

            TREECIPES_SEARCH_KINDS.forEach(function (searchKind) {
                (hitsByKind[searchKind.kind] || []).forEach(function (entry) {
                    if (drawnResultCount >= TREECIPES_SEARCH_RESULT_LIMIT) {
                        hiddenResultCount++;
                        return;
                    }
                    groupElement.appendChild(buildTreecipesResult(indexedTree.treeState, entry, searchKind.label));
                    drawnResultCount++;
                });
            });

            resultsElement.appendChild(groupElement);

        });

        if (hiddenResultCount > 0) {
            resultsElement.appendChild(createElement('div', 'treecipesResultMore muted', hiddenResultCount + ' more — type more of the name to narrow the search'));
        }

        if (matchedTreeCount === 0) {
            resultsElement.appendChild(createElement('div', 'treecipesResultNone muted', TREECIPES_SEARCH_NO_MATCH));
        }

        const pickableCount = treeStates.filter(function (treeState) { return !isHiddenByFavorites(treeState); }).length;
        treecipesSearch.matchCountElement.textContent = matchedTreeCount > 0 ? matchedTreeCount + ' of ' + pluralize(pickableCount, 'treecipe', 'treecipes') : 'no matches';
        resultsElement.classList.remove('hidden');

        applyFavoritesFilter();

    }

    function buildTreecipesResult(treeState, entry, kindLabel) {

        const resultElement = createButton('link', 'treecipesResult');
        resultElement.appendChild(createElement('span', 'treecipesResultKind muted', kindLabel));
        resultElement.appendChild(createElement('span', 'treecipesResultText', entry.text));
        resultElement.setAttribute('aria-label', kindLabel + ' ' + entry.text + ' in ' + displayTitleOf(treeState.tree));
        resultElement.addEventListener('click', function () { openTreecipesResult(treeState, entry); });

        return resultElement;

    }

    /*
        A result opens its treecipe on the Treecipe tab and shows what it named: the card, the
        object opened, the field's row (a tab search hiding it is cleared), or the Record types
        section scrolled to the object. One object is opened, inside the AUTO_EXPAND limits.
    */
    function openTreecipesResult(treeState, entry) {

        chooseTree(treeState, true);
        selectTreeTab(treeState, 'treecipe', false);

        if (entry.kind === 'recordType') {
            applyTreeFocus({ treeKey: treeState.tree.treeKey, tab: 'treecipe', recordTypes: { objectApiName: entry.objectApiName } });
            savePanelPlace();
            return;
        }

        let scrollTarget = treeState.element;

        if (entry.kind === 'object' || entry.kind === 'field') {

            const treeObjectState = treeState.objectStates.find(function (candidateState) { return !candidateState.isIteration && candidateState.object.objectApiName === entry.objectApiName; });

            if (treeObjectState) {

                treeObjectState.isExpandedByReader = true;
                setTreeObjectExpanded(treeObjectState, true, false);
                scrollTarget = treeObjectState.element;

                const fieldState = entry.kind === 'field'
                    ? treeObjectState.fieldStates.find(function (candidateState) { return candidateState.field.fieldApiName === entry.fieldApiName; })
                    : null;

                if (fieldState && fieldState.rowElement && fieldState.rowElement.classList.contains('hidden')) {
                    clearStructureFilters(treeState);
                    setTreeObjectExpanded(treeObjectState, true, false);
                }

                if (fieldState && fieldState.rowElement) { scrollTarget = fieldState.rowElement; }

            }

        }

        savePanelPlace();
        if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') { scrollTarget.scrollIntoView({ block: 'nearest' }); }

    }

    // THE TREECIPE TAB'S OWN SEARCH AND ITS TWO CHECKS, CLEARED SO A ROW THE READER ASKED TO SEE IS NOT HIDDEN BY THEM
    function clearStructureFilters(treeState) {

        treeState.searchTexts.treecipe = '';
        treeState.searchQueries.treecipe = '';
        treeState.isRecordTypeFieldsOnly = false;
        treeState.isTodosOnly = false;
        if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = ''; }
        applyStructureFilter(treeState);

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
            loadElement: createButton('primary', 'dataOrgLoad', 'Choose org…'),
            selectElement: createElement('select', 'dataOrgSelect hidden'),
            spinnerElement: createElement('span', 'dataOrgSpinner hidden'),
            typeElement: createElement('span', 'dataOrgType hidden'),
            openOrgElement: createButton('secondary', 'dataOrgOpen hidden', OPEN_ORG_LABEL),
            refreshElement: createButton('secondary', 'dataOrgRefresh hidden'),
            newScratchElement: createButton('primary', 'dataOrgNewScratch', '+ New scratch org'),
            hiddenNoteElement: createElement('div', 'dataOrgHiddenNote muted hidden'),
            statusElement: createElement('div', 'dataOrgStatus muted hidden'),
            drawnLabels: null
        };

        dataOrgView.loadElement.setAttribute('title', 'List the connected sandbox and scratch orgs the generated data can go to');
        dataOrgView.loadElement.addEventListener('click', function () { requestDataOrgs(); });

        dataOrgView.selectElement.setAttribute('aria-label', 'Salesforce org the generated data goes to');
        dataOrgView.selectElement.addEventListener('change', function () {
            const selectedValue = String(dataOrgView.selectElement.value || '');
            // ONLY AN INDEX THE HOST LISTED: THE CHECK'S OWN OPTION, AND EVERY PLACEHOLDER, CARRY NONE
            if (isDataOrgChecking || !/^[0-9]+$/.test(selectedValue)) { return; }
            vscodeApi.postMessage({ command: 'selectDataOrg', orgIndex: Number(selectedValue) });
        });

        dataOrgView.spinnerElement.setAttribute('aria-hidden', 'true');

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

        // THE SELECTION'S INDEX ONLY: THE HOST OPENS THE ORG IT HAS SELECTED, AND NOTHING COMES BACK BUT "DONE"
        dataOrgView.openOrgElement.setAttribute('title', 'Log in to the selected org in your browser');
        dataOrgView.openOrgElement.addEventListener('click', function () {
            if (isOrgOpenRunning || isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || dataOrgSelectedIndex === null) { return; }
            isOrgOpenRunning = true;
            drawDataOrgViews();
            vscodeApi.postMessage({ command: 'openDataOrg', orgIndex: dataOrgSelectedIndex });
        });

        // THE MESSAGE CARRIES NOTHING: THE DEV HUB, THE DEFINITION FILE AND THE ALIAS ARE ALL THE HOST'S, AND NOTHING IS DEPLOYED (#358)
        dataOrgView.newScratchElement.setAttribute('title', 'Choose a Dev Hub, name the new scratch org, create it through the Dev Hub and select it. Nothing is deployed to it.');
        dataOrgView.newScratchElement.addEventListener('click', function () {
            if (isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || renderedSequence === null) { return; }
            isDataOrgPickerInUse = true;
            isScratchOrgRunning = true;
            drawDataOrgViews();
            drawTreeInserts();
            vscodeApi.postMessage({ command: 'createScratchOrg' });
        });

        pickerElement.appendChild(dataOrgView.loadElement);
        pickerElement.appendChild(dataOrgView.selectElement);
        pickerElement.appendChild(dataOrgView.spinnerElement);
        pickerElement.appendChild(dataOrgView.typeElement);
        pickerElement.appendChild(dataOrgView.openOrgElement);
        pickerElement.appendChild(dataOrgView.refreshElement);
        pickerElement.appendChild(dataOrgView.newScratchElement);
        viewElement.appendChild(pickerElement);
        viewElement.appendChild(dataOrgView.hiddenNoteElement);
        viewElement.appendChild(dataOrgView.statusElement);

        dataOrgViews.push(dataOrgView);
        drawDataOrgView(dataOrgView);

        return dataOrgView;

    }

    function setShown(element, isShown) {
        if (isShown) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
    }

    function isMotionReduced() {
        return typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function endMotion(element) {
        if (!motionTimers.has(element)) { return; }
        clearTimeout(motionTimers.get(element));
        motionTimers.delete(element);
        element.classList.remove('motionReveal');
        element.classList.remove('motionConceal');
        element.removeAttribute('aria-hidden');
        element.removeAttribute('inert');
    }

    /*
        "hidden" is set or cleared FIRST, so it -- and every test of it -- is accurate for the whole
        animation. A closing body stays drawn only while it fades, aria-hidden and inert meanwhile.
        A body is revealed after it is built, so an animation never builds a row.
    */
    function setShownWithMotion(element, isShown, isAnimated) {

        const wasShown = !element.classList.contains('hidden');

        endMotion(element);
        setShown(element, isShown);

        if (!isAnimated || wasShown === isShown || isMotionReduced()) { return; }

        if (isShown) {
            element.classList.add('motionReveal');
        } else {
            element.classList.add('motionConceal');
            element.setAttribute('aria-hidden', 'true');
            element.setAttribute('inert', '');
        }
        motionTimers.set(element, setTimeout(function () { endMotion(element); }, isShown ? MOTION_REVEAL_MILLISECONDS : MOTION_CONCEAL_MILLISECONDS));

    }

    /*
        The picker state drawn into one view. While a scratch org run is in flight the picker is
        held: the button, the dropdown, ⟳ and "Choose org…" are disabled, whatever a listing posted
        meanwhile draws -- the run ends by selecting the org it made. Every text is the host's,
        through textContent.
    */
    function drawDataOrgView(dataOrgView) {

        const optionLabels = isDataOrgChecking ? dataOrgCheckingOptionLabels : dataOrgLabels;

        if (dataOrgView.drawnLabels !== optionLabels) {
            dataOrgView.selectElement.textContent = '';
            if (isDataOrgChecking || (dataOrgLabels && dataOrgLabels.length === 0)) {
                const onlyOptionElement = createElement('option', '', isDataOrgChecking ? optionLabels[0] : DATA_ORG_NONE_LISTED_PLACEHOLDER);
                onlyOptionElement.value = '';
                dataOrgView.selectElement.appendChild(onlyOptionElement);
            } else if (dataOrgLabels && dataOrgLabels.length > 0) {
                const placeholderElement = createElement('option', '', 'Choose org…');
                placeholderElement.value = '';
                dataOrgView.selectElement.appendChild(placeholderElement);
                dataOrgLabels.forEach(function (orgLabel, orgIndex) {
                    const optionElement = createElement('option', '', orgLabel);
                    optionElement.value = String(orgIndex);
                    dataOrgView.selectElement.appendChild(optionElement);
                });
            }
            dataOrgView.drawnLabels = optionLabels;
        }

        dataOrgView.selectElement.value = isDataOrgChecking || dataOrgSelectedIndex === null ? '' : String(dataOrgSelectedIndex);
        setShown(dataOrgView.loadElement, isDataOrgLoadShown);
        setShown(dataOrgView.selectElement, isDataOrgSelectShown || isDataOrgChecking);
        setShown(dataOrgView.spinnerElement, isDataOrgChecking);
        setShown(dataOrgView.refreshElement, isDataOrgRefreshShown);
        dataOrgView.typeElement.textContent = dataOrgTypeLabel || '';
        setShown(dataOrgView.typeElement, dataOrgTypeLabel !== null);

        dataOrgView.hiddenNoteElement.textContent = dataOrgHiddenNoteText;
        setShown(dataOrgView.hiddenNoteElement, !!dataOrgHiddenNoteText);

        dataOrgView.statusElement.textContent = dataOrgStatusText;
        setShown(dataOrgView.statusElement, !!dataOrgStatusText);
        if (isDataOrgStatusFailure) { dataOrgView.statusElement.classList.add('failed'); } else { dataOrgView.statusElement.classList.remove('failed'); }

        // AN INSERT IN FLIGHT HOLDS IT TOO: THE HOST WOULD REFUSE A RUN THAT CHANGES THE SELECTION UNDER IT
        // SO DOES A METADATA DEPLOY (#346), TO THE ORG SELECTED; A RETRIEVE DOES NOT, SINCE THE RUN DEPLOYS NOTHING (#358)
        dataOrgView.newScratchElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null;
        dataOrgView.newScratchElement.textContent = isScratchOrgRunning ? 'Setting up scratch org…' : '+ New scratch org';
        // A PERMISSION SET ASSIGNMENT HOLDS THE PICKER TOO: IT ASSIGNS IN THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
        // AND A METADATA DEPLOY (#346): IT DEPLOYS TO THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
        dataOrgView.selectElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
        dataOrgView.loadElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
        dataOrgView.refreshElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;

        setShown(dataOrgView.openOrgElement, isDataOrgSelectShown && dataOrgSelectedIndex !== null);
        dataOrgView.openOrgElement.disabled = isOrgOpenRunning || isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
        dataOrgView.openOrgElement.textContent = isOrgOpenRunning ? 'Opening…' : OPEN_ORG_LABEL;

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
        const fieldElement = createElement('div', 'tabSearchField');
        const inputElement = createElement('input', 'tabSearchInput');
        const matchCountElement = createElement('span', 'tabMatchCount muted');
        const iconElement = buildSearchIconElement();

        iconElement.addEventListener('click', function () {
            if (typeof inputElement.focus === 'function') { inputElement.focus(); }
        });

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

        fieldElement.appendChild(iconElement);
        fieldElement.appendChild(inputElement);
        searchElement.appendChild(fieldElement);
        searchElement.appendChild(matchCountElement);

        return { element: searchElement, inputElement: inputElement, matchCountElement: matchCountElement };

    }

    // DECORATIVE: THE INPUT'S OWN aria-label NAMES THE BOX, SO THE ICON IS HIDDEN FROM A SCREEN READER
    function buildSearchIconElement() {

        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        glyphElement.setAttribute('class', 'tabSearchIcon');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', SEARCH_GLYPH_PATH);
        glyphElement.appendChild(pathElement);

        return glyphElement;

    }

    /*
        The fields each object's record types restrict (#320): object api name -> field api name ->
        the developer names restricting it, in the order the Record types section lists them. Drawn
        from objects[].recordTypes[].impacts the model already carries, so the host sends nothing new.
        Keyed by names from files, so no prototype; an impact naming a field the object does not
        list, one that is not an object, and anything named __proto__ add nothing.
    */
    let recordTypeFieldsByObjectApiName = Object.create(null);

    function isRecordLike(candidate) {
        return !!candidate && typeof candidate === 'object' && !Array.isArray(candidate);
    }

    function indexRecordTypeFields(objects) {

        const recordTypeFieldsIndex = Object.create(null);

        objects.forEach(function (object) {

            if (!isRecordLike(object) || typeof object.objectApiName !== 'string' || object.objectApiName === '__proto__') { return; }
            if (!Array.isArray(object.recordTypes) || object.recordTypes.length < 2) { return; }

            const listedFieldApiNames = Object.create(null);
            (Array.isArray(object.fields) ? object.fields : []).forEach(function (field) {
                if (isRecordLike(field) && typeof field.fieldApiName === 'string') { listedFieldApiNames[field.fieldApiName] = true; }
            });

            const developerNamesByFieldApiName = Object.create(null);

            object.recordTypes.forEach(function (recordType) {
                if (!isRecordLike(recordType) || typeof recordType.developerName !== 'string' || !Array.isArray(recordType.impacts)) { return; }
                recordType.impacts.forEach(function (impact) {
                    if (!isRecordLike(impact)) { return; }
                    const fieldApiName = impact.fieldApiName;
                    if (typeof fieldApiName !== 'string' || fieldApiName === '__proto__' || listedFieldApiNames[fieldApiName] !== true) { return; }
                    const developerNames = developerNamesByFieldApiName[fieldApiName] || (developerNamesByFieldApiName[fieldApiName] = []);
                    if (developerNames.indexOf(recordType.developerName) === -1) { developerNames.push(recordType.developerName); }
                });
            });

            recordTypeFieldsIndex[object.objectApiName] = developerNamesByFieldApiName;

        });

        return recordTypeFieldsIndex;

    }

    // ROWS WHOSE VALUES WERE ASKED FOR AND NOT YET ANSWERED, BY OBJECT AND FIELD -- KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
    let pendingPicklistValueElements = Object.create(null);

    /*
        The Record types section's choice (#195) is the PANEL's, per object and shared by every card
        that lists the object: object api name -> developer names, in the order ticked, starting
        from what the run on screen generates. Keyed by names from files, so no prototype.
    */
    let recordTypeChoices = Object.create(null);
    let recordTypeObjects = [];
    let recordTypeRowStates = [];
    let recordTypeButtonElements = [];
    let isRecordTypeRegenerating = false;
    // "Remember this selection" (#196): PANEL-WIDE LIKE THE CHOICE, UNTICKED BY DEFAULT AND AGAIN WITH EVERY MODEL
    let isRecordTypeSelectionRemembered = false;
    let recordTypeRememberElements = [];

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

        const toggleElement = createButton('secondary', className);
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        glyphElement.setAttribute('class', 'toggleGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', TOGGLE_COLLAPSED_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        toggleElement.appendChild(glyphElement);

        return toggleElement;

    }

    // THE STYLESHEET TURNS THE ONE ▸ PATH ON aria-expanded, SO IT ROTATES RATHER THAN SWAPPING (#227)
    function drawToggle(toggleElement, isExpanded, isAnimated) {
        if (isAnimated) { toggleElement.classList.remove('noMotion'); } else { toggleElement.classList.add('noMotion'); }
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

        const includeElement = createButton('icon', 'treeObjectInclude');
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
        drawFieldRowValidationRule(treeObjectState, fieldState);

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

    function isExpressionValue(value) {
        return typeof value === 'string' && value.indexOf(EXPRESSION_OPENER) === 0;
    }

    // A DOUBLE-QUOTED "\${{ ... }}" (A VALIDATION RULE'S, OR AN EARLIER EDIT'S) STARTS THE EDITOR AS THE EXPRESSION IT HOLDS
    function unquoteExpressionLine(valueLine) {
        if (valueLine.length < 2 || valueLine.charAt(0) !== '"' || valueLine.charAt(valueLine.length - 1) !== '"') { return valueLine; }
        try {
            const unquoted = JSON.parse(valueLine);
            return isExpressionValue(unquoted) ? unquoted : valueLine;
        } catch (parseError) {
            return valueLine;
        }
    }

    /*
        The value the editor starts from (#356): what the field holds now -- an edit the host says the
        card generates with, else the first "\${{ ... }}" line of its recipe value (a picklist's
        record type variants follow it as comments), else that value's first line.
    */
    function findEditorStartValue(tree, objectApiName, field) {

        const fixedValue = findFixedValue(tree, objectApiName, field.fieldApiName);
        if (fixedValue !== null) { return fixedValue; }

        const valueLines = String(field.recipeValue || '').split('\\n').map(function (valueLine) { return unquoteExpressionLine(valueLine.trim()); });
        const expressionLine = valueLines.find(function (valueLine) { return isExpressionValue(valueLine); });
        if (expressionLine !== undefined) { return expressionLine; }

        return valueLines.find(function (valueLine) { return valueLine !== '' && valueLine !== '|'; }) || '';

    }

    // AN EDIT TAKES THE EXPRESSION'S PLACE ON THE ROW, WRITTEN WITH textContent, AND THE PENCIL SAYS SO BY SHAPE, aria-pressed AND TITLE
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
            fieldState.fixedValueBadgeElement.textContent = isFixed && isExpressionValue(fixedValue) ? EDITED_EXPRESSION_BADGE_LABEL : FIXED_VALUE_BADGE_LABEL;
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
        buttonElement.setAttribute('aria-expanded', fieldState.editorEdit === 'fixedValue' ? 'true' : 'false');
        if (buttonElement.disabled && fieldState.editorEdit === 'fixedValue') { closeFieldEditor(fieldState); }

        const title = treeObjectState.isIteration ? 'Follows ' + objectApiName + ' above'
            : lockReason ? 'Cannot be edited: ' + lockReason
            : isFixed ? ( isExpressionValue(fixedValue) ? 'Edited expression' : 'Fixed value' ) + ' — click to change or clear it'
            : 'Edit the faker expression, or give the field a fixed value';
        buttonElement.setAttribute('title', title);
        buttonElement.setAttribute('aria-label', fieldApiName + ': ' + title);

    }

    function hasSwitchableValidationRules(field) {
        return !!field.lineNumber && !!field.validationRules && Array.isArray(field.validationRules.appliedRuleNames) && field.validationRules.appliedRuleNames.length > 0;
    }

    // WHETHER THE HOST SAYS THIS CARD GENERATES THE FIELD WITHOUT ITS VALIDATION RULES (#325)
    function isValidationRuleOff(tree, objectApiName, fieldApiName) {
        const validationRulesOff = Array.isArray(tree.validationRulesOff) ? tree.validationRulesOff : [];
        return validationRulesOff.some(function (candidate) { return candidate.objectApiName === objectApiName && candidate.fieldApiName === fieldApiName; });
    }

    /*
        Why a field's validation-rule box is disabled (#325): the host's own rule
        (findValidationRuleLockReason) drawn from the model the panel holds -- a field generation
        leaves out, or writes a fixed value for, has nothing the rules would shape.
    */
    function findValidationRuleLockReason(treeObjectState, fieldState) {

        const tree = treeObjectState.tree;
        const objectApiName = treeObjectState.object.objectApiName;
        const fieldApiName = fieldState.field.fieldApiName;
        const objectFieldSelection = findObjectFieldSelection(tree, objectApiName);

        if (findObjectExclusion(tree, objectApiName)) { return FIXED_VALUE_OBJECT_EXCLUDED_REASON; }
        if (objectFieldSelection && hasOwnKey(objectFieldSelection.lockReasonsByFieldApiName, fieldApiName) && objectFieldSelection.lockReasonsByFieldApiName[fieldApiName] === FIELD_PARENT_EXCLUDED_REASON) { return FIELD_PARENT_EXCLUDED_REASON; }
        if (objectFieldSelection && hasOwnKey(objectFieldSelection.excludedFieldApiNames, fieldApiName)) { return FIXED_VALUE_UNTICKED_REASON; }
        if (findFixedValue(tree, objectApiName, fieldApiName) !== null) { return VALIDATION_RULE_FIXED_VALUE_REASON; }

        return '';

    }

    /*
        A field's validation-rule box (#325), drawn from the host's answer: ticked while the rules
        shape the field, and the row's expression is what the rules wrote; unticked, it is what the
        field generated before them. The state is never colour alone: the mark, aria-checked and the
        title all say it, and the title names the rules.
    */
    function drawFieldRowValidationRule(treeObjectState, fieldState) {

        const field = fieldState.field;
        const buttonElement = fieldState.validationRuleElement;
        if (!buttonElement) { return; }

        const objectApiName = treeObjectState.object.objectApiName;
        const lockReason = treeObjectState.isIteration ? '' : findValidationRuleLockReason(treeObjectState, fieldState);
        const isApplied = !lockReason && !isValidationRuleOff(treeObjectState.tree, objectApiName, field.fieldApiName);
        const ruleNames = field.validationRules.appliedRuleNames.join(', ');

        fieldState.isValidationRuleApplied = isApplied;
        buttonElement.textContent = isApplied ? '✓' : '';
        buttonElement.setAttribute('aria-checked', isApplied ? 'true' : 'false');
        buttonElement.disabled = treeObjectState.isIteration || !!lockReason;

        const title = treeObjectState.isIteration ? 'Follows ' + objectApiName + ' above'
            : lockReason ? 'Validation rules ' + ruleNames + ' cannot be switched: ' + lockReason
            : isApplied ? 'Validation rules applied: ' + ruleNames + ' — untick to generate without them'
            : 'Validation rules not applied: ' + ruleNames + ' — tick to apply them';
        buttonElement.setAttribute('title', title);
        buttonElement.setAttribute('aria-label', field.fieldApiName + ': ' + title);

        if (fieldState.expressionElement && typeof field.validationRules.unconstrainedExpression === 'string') {
            fieldState.expressionElement.textContent = isApplied || lockReason ? field.recipeValue : field.validationRules.unconstrainedExpression;
        }

    }

    // A FIELD'S VALIDATION-RULE BOX (#325): A click posts NAMES and the state asked for; the host decides, and may ask first
    function buildFieldValidationRuleElement(treeObjectState, fieldState) {

        const controlElement = createElement('span', 'validationRuleControl');
        const buttonElement = createButton('check', 'treeFieldInclude treeFieldValidationRule');
        const object = treeObjectState.object;

        controlElement.appendChild(createElement('span', 'muted', 'rules'));
        buttonElement.setAttribute('role', 'checkbox');
        buttonElement.addEventListener('click', function () {
            if (buttonElement.disabled) { return; }
            const message = {
                command: 'setFieldValidationRuleApplied',
                treeKey: treeObjectState.tree.treeKey,
                objectApiName: object.objectApiName,
                fieldApiName: fieldState.field.fieldApiName,
                applied: !fieldState.isValidationRuleApplied
            };
            if (object.nickname) { message.nickname = object.nickname; }
            vscodeApi.postMessage(message);
        });
        controlElement.appendChild(buttonElement);
        fieldState.validationRuleElement = buttonElement;

        return controlElement;

    }

    // A FIELD WHOSE RULES WERE ALL NOT APPLIED (#325) NAMES THEM, AND WHY IN ITS TITLE, IN TEXT ONLY
    function buildValidationRuleNotAppliedElement(field) {

        const notAppliedRules = field.validationRules.notAppliedRules;
        const noteElement = createElement('span', 'validationRuleNotApplied muted', VALIDATION_RULE_NOT_APPLIED_LABEL + ': ' + notAppliedRules.map(function (notAppliedRule) { return notAppliedRule.ruleName; }).join(', '));
        noteElement.setAttribute('title', notAppliedRules.map(function (notAppliedRule) { return notAppliedRule.ruleName + (notAppliedRule.reason ? ' — ' + notAppliedRule.reason : ''); }).join('\\n'));

        return noteElement;

    }

    /*
        A field's edit button (#356): a real button, keyboard operable, its glyph built node by node
        like the chain link. A click opens its inline editor (#337) under the row.
    */
    function buildFieldFixedValueElement(treeObjectState, fieldState) {

        const buttonElement = createButton('icon', 'treeFieldFixedValue');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        glyphElement.setAttribute('class', 'fixedValueGlyph');
        glyphElement.setAttribute('viewBox', TREE_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', FIXED_VALUE_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        buttonElement.appendChild(glyphElement);

        buttonElement.addEventListener('click', function () {
            if (buttonElement.disabled) { return; }
            toggleFieldEditor(treeObjectState, fieldState, 'fixedValue');
        });
        fieldState.fixedValueButtonElement = buttonElement;

        return buttonElement;

    }

    // ONE OBJECT'S WARNING, THEN EVERY ROW IT HAS BUILT
    function drawObjectFieldSelection(treeObjectState) {

        const tree = treeObjectState.tree;
        const objectApiName = treeObjectState.object.objectApiName;
        const objectFieldSelection = findObjectFieldSelection(tree, objectApiName);
        const isObjectExcluded = !!findObjectExclusion(tree, objectApiName);
        const isEveryFieldExcluded = !!objectFieldSelection && objectFieldSelection.isEveryFieldExcluded && !isObjectExcluded;

        treeObjectState.fieldWarningElement.textContent = isEveryFieldExcluded ? EVERY_FIELD_UNTICKED_WARNING : '';
        if (isEveryFieldExcluded) { treeObjectState.fieldWarningElement.classList.remove('hidden'); } else { treeObjectState.fieldWarningElement.classList.add('hidden'); }

        if (!treeObjectState.isBodyBuilt) { return; }

        treeObjectState.fieldStates.forEach(function (fieldState) { drawFieldRowSelection(treeObjectState, fieldState); });

    }

    function drawFieldSelection(treeState) {
        treeState.objectStates.forEach(drawObjectFieldSelection);
    }

    function hasTreeSelection(tree) {
        return !!tree.objectSelection
            || ( Array.isArray(tree.objectCounts) && tree.objectCounts.length > 0 )
            || ( Array.isArray(tree.validationRulesOff) && tree.validationRulesOff.length > 0 )
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
        treeState.tree.validationRulesOff = objectSelectionMessage.validationRulesOff || undefined;
        drawObjectSelection(treeState);
        drawTreeInsert(treeState);
        drawTreePermissionSet(treeState);
        drawHelpSummary();

        // WHAT THE TROUBLESHOOTING TAB COUNTS LEAVES OUT EXCLUDED OBJECTS AND UNTICKED FIELDS (#346)
        if (treeState.selectedTab === 'troubleshooting') { requestTroubleshootingSummary(treeState); }

    }

    /*
        A field's inline editor (#337, one box since #356) under the row, with Save, Clear and
        Cancel. Enter saves and Escape cancels. Save posts the NAMES the edit button always posted
        plus what was typed; the host checks it against the field again and answers with
        fieldEditResult -- a refusal is written under the box with textContent and the editor stays
        open, a save closes it once the card has been redrawn. Clicking the button again closes it.
    */
    function toggleFieldEditor(treeObjectState, fieldState, edit) {

        const isSameEditOpen = fieldState.editorEdit === edit;
        closeFieldEditor(fieldState);
        if (!isSameEditOpen) { openFieldEditor(treeObjectState, fieldState, edit); }
        drawFieldRowFixedValue(treeObjectState, fieldState);

    }

    function closeFieldEditor(fieldState) {

        if (!fieldState.editorElement || !fieldState.editorEdit) { return; }

        const openerElement = fieldState.fixedValueButtonElement;
        fieldState.editorElement.textContent = '';
        fieldState.editorElement.classList.add('hidden');
        fieldState.editorEdit = '';
        fieldState.editorRefusalElement = null;
        if (openerElement) {
            openerElement.setAttribute('aria-expanded', 'false');
            if (!openerElement.disabled && typeof openerElement.focus === 'function') { openerElement.focus(); }
        }

    }

    function describeFixedValueForm(field) {

        if (field.fieldType === 'Checkbox') { return 'Type true or false.'; }
        if (field.fieldType === 'Date') { return 'Type a date as YYYY-MM-DD, such as 2026-01-31.'; }
        if (field.fieldType === 'DateTime') { return 'Type a date and time as ISO 8601 with a zone, such as 2026-01-31T09:30:00Z.'; }
        if (FIXED_VALUE_NUMBER_FIELD_TYPES.indexOf(field.fieldType) !== -1) { return 'Type a plain number, such as 42, -7 or 3.25.'; }
        const geolocationComponent = field.fieldType === 'Text'
            ? Object.keys(GEOLOCATION_COMPONENT_RANGES).find(function (componentKey) { return field.fieldApiName.endsWith(GEOLOCATION_COMPONENT_RANGES[componentKey].suffix); })
            : undefined;
        if (geolocationComponent !== undefined) {
            const limit = GEOLOCATION_COMPONENT_RANGES[geolocationComponent].limit;
            return 'Type a ' + geolocationComponent.toLowerCase() + ' from -' + limit + ' to ' + limit + '.';
        }
        if (field.fieldType === 'MultiselectPicklist') { return 'Type values this picklist declares, separated by ;.'; }
        if (field.isPicklist) { return 'Type a value this picklist declares.'; }
        return 'Type the text every record gets.';

    }

    function buildFieldEditorInput(maxLength, value, ariaLabel, placeholder) {

        const inputElement = createElement('input', 'fieldEditorInput');
        inputElement.setAttribute('type', 'text');
        inputElement.setAttribute('maxlength', String(maxLength));
        inputElement.setAttribute('aria-label', ariaLabel);
        if (placeholder) { inputElement.setAttribute('placeholder', placeholder); }
        inputElement.value = value;

        return inputElement;

    }

    function openFieldEditor(treeObjectState, fieldState, edit) {

        if (!fieldState.rowElement) { return; }

        const field = fieldState.field;
        const tree = treeObjectState.tree;
        const object = treeObjectState.object;
        const fieldLabel = object.objectApiName + '.' + field.fieldApiName;

        if (!fieldState.editorElement) {
            fieldState.editorElement = createElement('div', 'fieldEditor hidden');
            fieldState.editorElement.setAttribute('role', 'group');
            fieldState.rowElement.appendChild(fieldState.editorElement);
        }

        const editorElement = fieldState.editorElement;
        const inputsElement = createElement('div', 'fieldEditorInputs');
        const inputElements = [];
        let collectTyped = null;

        editorElement.setAttribute('aria-label', 'Edit ' + fieldLabel);
        const valueElement = buildFieldEditorInput(FIXED_VALUE_MAX_LENGTH, findEditorStartValue(tree, object.objectApiName, field), 'Value or faker expression for ' + fieldLabel, '');
        inputElements.push(valueElement);
        inputsElement.appendChild(valueElement);
        collectTyped = function (isClearing) {
            const typedValue = String(valueElement.value);
            return { value: isClearing ? '' : isExpressionValue(typedValue.trim()) ? typedValue.trim() : typedValue };
        };

        // THE HINT SAYS WHICH OF THE TWO SAVE WRITES, AS THE READER TYPES
        const describeEdit = function () {
            return ( isExpressionValue(String(valueElement.value).trim())
                ? 'Saved as a faker expression: one \${{ ... }} on one line. Change its arguments, or call another faker method.'
                : 'Saved as a fixed value. ' + describeFixedValueForm(field) + ' Start with \${{ to save a faker expression instead.' )
                + ' Save writes it into the recipe file; Clear puts back the lines the field had.';
        };
        const hintText = describeEdit();
        const hintElement = createElement('div', 'fieldEditorHint muted', hintText);
        valueElement.addEventListener('input', function () { hintElement.textContent = describeEdit(); });
        const refusalElement = createElement('div', 'fieldEditorRefusal hidden');
        refusalElement.setAttribute('role', 'alert');

        const post = function (isClearing) {
            const message = {
                command: 'setFieldFixedValue',
                treeKey: tree.treeKey,
                objectApiName: object.objectApiName,
                fieldApiName: field.fieldApiName
            };
            if (object.nickname) { message.nickname = object.nickname; }
            const typed = collectTyped(isClearing);
            Object.keys(typed).forEach(function (typedKey) { message[typedKey] = typed[typedKey]; });
            refusalElement.textContent = '';
            refusalElement.classList.add('hidden');
            vscodeApi.postMessage(message);
        };

        const actionsElement = createElement('div', 'fieldEditorActions');
        const saveElement = createButton('primary', 'fieldEditorSave', 'Save', 'compact');
        const clearElement = createButton('secondary', 'fieldEditorClear', 'Clear', 'compact');
        const cancelElement = createButton('secondary', 'fieldEditorCancel', 'Cancel', 'compact');
        saveElement.addEventListener('click', function (event) { event.stopPropagation(); post(false); });
        clearElement.addEventListener('click', function (event) { event.stopPropagation(); post(true); });
        cancelElement.addEventListener('click', function (event) { event.stopPropagation(); toggleFieldEditor(treeObjectState, fieldState, edit); });
        actionsElement.appendChild(saveElement);
        actionsElement.appendChild(clearElement);
        actionsElement.appendChild(cancelElement);

        inputElements.forEach(function (inputElement) {
            inputElement.addEventListener('keydown', function (event) {
                // AN IME COMPOSING CJK TEXT CONFIRMS A CANDIDATE WITH ENTER, WHICH IS NOT A SAVE
                if (event.isComposing) { return; }
                if (event.key === 'Enter') { event.stopPropagation(); post(false); }
                if (event.key === 'Escape') { event.stopPropagation(); toggleFieldEditor(treeObjectState, fieldState, edit); }
            });
        });

        editorElement.textContent = '';
        editorElement.appendChild(inputsElement);
        editorElement.appendChild(hintElement);
        editorElement.appendChild(refusalElement);
        editorElement.appendChild(actionsElement);
        editorElement.classList.remove('hidden');
        fieldState.editorEdit = edit;
        fieldState.editorRefusalElement = refusalElement;

        if (typeof inputElements[0].focus === 'function') { inputElements[0].focus(); }

    }

    // HOW AN INLINE EDIT ENDED (#337), FOR THE MODEL ON SCREEN: A REFUSAL UNDER THE BOXES, OR THE EDITOR CLOSED
    function renderFieldEditResult(fieldEditResultMessage) {

        if (renderedSequence === null || fieldEditResultMessage.renderSequence !== renderedSequence) { return; }

        const treeState = findTreeState(fieldEditResultMessage.treeKey);
        if (!treeState) { return; }

        treeState.objectStates.forEach(function (treeObjectState) {
            if (treeObjectState.object.objectApiName !== fieldEditResultMessage.objectApiName) { return; }
            treeObjectState.fieldStates.forEach(function (fieldState) {
                if (fieldState.field.fieldApiName !== fieldEditResultMessage.fieldApiName || fieldState.editorEdit !== fieldEditResultMessage.edit) { return; }
                if (typeof fieldEditResultMessage.refusal === 'string' && fieldState.editorRefusalElement) {
                    fieldState.editorRefusalElement.textContent = fieldEditResultMessage.refusal;
                    fieldState.editorRefusalElement.classList.remove('hidden');
                    return;
                }
                toggleFieldEditor(treeObjectState, fieldState, fieldState.editorEdit);
            });
        });

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
            expressionElement: null,
            validationRuleElement: null,
            isValidationRuleApplied: true,
            recordTypeDeveloperNames: null,
            todos: Array.isArray(field.todos) ? field.todos : [],
            editorElement: null,
            editorEdit: '',
            editorRefusalElement: null
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

        const includeElement = createButton('check', 'treeFieldInclude');
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

            const picklistToggleElement = createButton('secondary', 'picklistToggle', PICKLIST_SHOW_VALUES_LABEL);
            let picklistValuesElement = null;

            setPicklistExpanded = function (isExpanding, isAnimated) {
                if (isExpanding && !picklistValuesElement) {
                    picklistValuesElement = createElement('div', 'picklistValues hidden');
                    fieldRowElement.appendChild(picklistValuesElement);
                    requestPicklistValues(treeObjectState.object.objectApiName, field.fieldApiName, picklistValuesElement);
                }
                if (picklistValuesElement) {
                    setShownWithMotion(picklistValuesElement, isExpanding, isAnimated);
                }
                fieldState.isPicklistExpanded = isExpanding;
                picklistToggleElement.textContent = isExpanding ? PICKLIST_HIDE_VALUES_LABEL : PICKLIST_SHOW_VALUES_LABEL;
                picklistToggleElement.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
                picklistToggleElement.setAttribute('aria-label', (isExpanding ? PICKLIST_HIDE_VALUES_LABEL : PICKLIST_SHOW_VALUES_LABEL) + ' of ' + field.fieldApiName);
            };

            // THE NAME STARTS WITH THE TEXT ON THE BUTTON, SO A VOICE COMMAND OF WHAT IS ON SCREEN REACHES IT
            picklistToggleElement.setAttribute('aria-label', PICKLIST_SHOW_VALUES_LABEL + ' of ' + field.fieldApiName);
            picklistToggleElement.setAttribute('aria-expanded', 'false');
            picklistToggleElement.addEventListener('click', function () {
                setPicklistExpanded(!fieldState.isPicklistExpanded, true);
                savePanelPlace();
            });

            fieldHeaderElement.appendChild(picklistToggleElement);

        } else {
            // A ROW WITHOUT THE BUTTON KEEPS ITS SLOT, SO EVERY FIELD NAME OF AN OBJECT LINES UP
            const toggleSpacerElement = createElement('span', 'picklistToggleSpacer');
            toggleSpacerElement.setAttribute('aria-hidden', 'true');
            fieldHeaderElement.appendChild(toggleSpacerElement);
        }

        fieldHeaderElement.appendChild(createElement('span', 'treeFieldName', field.fieldApiName));

        if (field.fieldTypeWithSize || field.fieldType) {
            fieldHeaderElement.appendChild(createElement('span', 'fieldType', field.fieldTypeWithSize || field.fieldType));
        }

        // THE RECORD TYPES THAT RESTRICT THIS FIELD (#320), AS TEXT, WHETHER OR NOT THE CHECK IS ON
        if (fieldState.recordTypeDeveloperNames) {
            const recordTypeNamesText = fieldState.recordTypeDeveloperNames.join(', ');
            const recordTypeChipElement = createElement('span', 'recordTypeChip', recordTypeNamesText);
            recordTypeChipElement.setAttribute('title', 'Restricted by ' + (fieldState.recordTypeDeveloperNames.length === 1 ? 'record type ' : 'record types ') + recordTypeNamesText);
            fieldHeaderElement.appendChild(recordTypeChipElement);
        }

        const lookupWiring = field.lineNumber ? findLookupWiring(treeObjectState.tree, treeObjectState.object, field.fieldApiName) : null;
        if (lookupWiring) {
            fieldHeaderElement.appendChild(buildWireLookupElement(treeObjectState.tree, lookupWiring));
        }

        const addableParent = field.lineNumber ? findAddableParent(treeObjectState.tree, treeObjectState.object, field.fieldApiName) : null;
        if (addableParent) {
            fieldHeaderElement.appendChild(buildAddParentObjectElement(treeObjectState.tree, addableParent));
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

        // AT THE END OF THE ROW (#325): A BOX FOR A FIELD ITS RULES SHAPE, OR A NOTE NAMING RULES THAT COULD NOT BE APPLIED
        if (treeObjectState.canSelectFields && hasSwitchableValidationRules(field)) {
            fieldHeaderElement.appendChild(buildFieldValidationRuleElement(treeObjectState, fieldState));
        } else if (field.validationRules && Array.isArray(field.validationRules.notAppliedRules) && field.validationRules.notAppliedRules.length > 0
                    && !( Array.isArray(field.validationRules.appliedRuleNames) && field.validationRules.appliedRuleNames.length > 0 )) {
            fieldHeaderElement.appendChild(buildValidationRuleNotAppliedElement(field));
        }

        fieldRowElement.appendChild(fieldHeaderElement);

        if (fieldState.todos.length > 0) {
            fieldRowElement.appendChild(buildTodoListElement(treeObjectState.object.recipeFilePath, fieldState.todos));
        }

        // THE SEARCH BOX MATCHES A FIELD BY ITS FAKER EXPRESSION, SO THE EXPRESSION IS ON SCREEN WITH THE ROW
        if (field.recipeValue) {
            const expressionRowElement = createElement('div', 'expressionRow');
            fieldState.expressionElement = createElement('pre', 'expression', field.recipeValue);
            expressionRowElement.appendChild(fieldState.expressionElement);
            fieldRowElement.appendChild(expressionRowElement);
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

        const addFriendElement = createButton('secondary', 'treeAddFriend', ADD_FRIEND_ACTION_LABEL);
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
            const choiceElement = createButton('secondary', 'treeAddFriendChoice', '+ ' + friendObjectApiName);
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

    function lookupWiringKeyOf(objectApiName, objectNickname, fieldApiName) {
        return objectApiName + '\\n' + (objectNickname || '') + '\\n' + fieldApiName;
    }

    // THE WIRING A ROW DRAWS "Wire to…" FOR: THE CARD'S OWN, FOR THIS OCCURRENCE OF THE OBJECT -- null FOR EVERY OTHER ROW
    function findLookupWiring(tree, object, fieldApiName) {

        if (!tree.lookupWirings || tree.lookupWirings.length === 0) { return null; }

        let lookupWiringIndex = lookupWiringIndexByTree.get(tree);
        if (!lookupWiringIndex) {
            lookupWiringIndex = Object.create(null);
            tree.lookupWirings.forEach(function (wiring) {
                lookupWiringIndex[lookupWiringKeyOf(wiring.objectApiName, wiring.objectNickname, wiring.fieldApiName)] = wiring;
            });
            lookupWiringIndexByTree.set(tree, lookupWiringIndex);
        }

        const key = lookupWiringKeyOf(object.objectApiName, object.nickname, fieldApiName);
        return Object.prototype.hasOwnProperty.call(lookupWiringIndex, key) ? lookupWiringIndex[key] : null;

    }

    /*
        "Wire to…" (#151) on a lookup the recipe still writes as a TODO, posting NAMES only -- the card,
        the object, the occurrence's nickname and the field. The nickname it is wired to is chosen on
        the host. One click disables every wire button until the host's wireLookupState gives them back.
    */
    function buildWireLookupElement(tree, wiring) {

        const wireElement = createButton('secondary', 'treeWireLookup', WIRE_LOOKUP_ACTION_LABEL);
        const fieldLabel = wiring.objectApiName + (wiring.objectNickname ? ' (' + wiring.objectNickname + ')' : '') + '.' + wiring.fieldApiName;

        wireElement.setAttribute('title', wiring.candidateNicknames.length === 1
            ? 'Point this lookup at ' + wiring.candidateNicknames[0] + ' in the recipe file, after a confirmation'
            : 'Choose which of ' + wiring.candidateNicknames.join(', ') + ' this lookup points at in the recipe file');
        wireElement.setAttribute('aria-label', 'Wire ' + fieldLabel);
        wireElement.addEventListener('click', function () {
            if (isWireLookupRunning) { return; }
            setWireLookupRunning(true);
            const wireMessage = { command: 'wireLookup', treeKey: tree.treeKey, objectApiName: wiring.objectApiName, fieldApiName: wiring.fieldApiName };
            if (wiring.objectNickname) { wireMessage.objectNickname = wiring.objectNickname; }
            vscodeApi.postMessage(wireMessage);
        });
        wireElement.disabled = isWireLookupRunning;
        wireLookupButtonElements.push(wireElement);

        return wireElement;

    }

    // THE ADDITION A ROW DRAWS "Add <Parent> to recipe" FOR (#294) -- null FOR EVERY OTHER ROW
    function findAddableParent(tree, object, fieldApiName) {

        if (!tree.addableParents || tree.addableParents.length === 0) { return null; }

        let addableParentIndex = addableParentIndexByTree.get(tree);
        if (!addableParentIndex) {
            addableParentIndex = Object.create(null);
            tree.addableParents.forEach(function (addition) {
                addableParentIndex[lookupWiringKeyOf(addition.objectApiName, addition.objectNickname, addition.fieldApiName)] = addition;
            });
            addableParentIndexByTree.set(tree, addableParentIndex);
        }

        const key = lookupWiringKeyOf(object.objectApiName, object.nickname, fieldApiName);
        return Object.prototype.hasOwnProperty.call(addableParentIndex, key) ? addableParentIndex[key] : null;

    }

    /*
        "Add <Parent> to recipe" (#294) on a TODO lookup whose standard parent the recipe does not
        write, posting the same NAMES "Wire to…" does. It writes the same file, so it is held by the
        same one-write lock and given back by the same wireLookupState.
    */
    function buildAddParentObjectElement(tree, addition) {

        const addElement = createButton('secondary', 'treeAddParentObject', 'Add ' + addition.parentObjectApiName + ' to recipe');
        const fieldLabel = addition.objectApiName + (addition.objectNickname ? ' (' + addition.objectNickname + ')' : '') + '.' + addition.fieldApiName;

        addElement.setAttribute('title', 'Add a ' + addition.parentObjectApiName + ' block with its minimum required fields to the recipe file and point this lookup at it, after a confirmation');
        addElement.setAttribute('aria-label', 'Add ' + addition.parentObjectApiName + ' to the recipe for ' + fieldLabel);
        addElement.addEventListener('click', function () {
            if (isWireLookupRunning) { return; }
            setWireLookupRunning(true);
            const addMessage = { command: 'addParentObject', treeKey: tree.treeKey, objectApiName: addition.objectApiName, fieldApiName: addition.fieldApiName };
            if (addition.objectNickname) { addMessage.objectNickname = addition.objectNickname; }
            vscodeApi.postMessage(addMessage);
        });
        addElement.disabled = isWireLookupRunning;
        wireLookupButtonElements.push(addElement);

        return addElement;

    }

    // "Wire TODO lookups" ON A CARD WITH AT LEAST ONE LOOKUP THAT HAS EXACTLY ONE RECORD TO CHOOSE FROM; null OTHERWISE
    function buildWireAllLookupsElement(tree) {

        const singleCandidateCount = (tree.lookupWirings || []).filter(function (wiring) { return wiring.candidateNicknames.length === 1; }).length;
        if (singleCandidateCount === 0) { return null; }

        const wireAllElement = createButton('secondary', 'treeWireAllLookups', WIRE_ALL_LOOKUPS_ACTION_LABEL + ' (' + singleCandidateCount + ')');
        wireAllElement.setAttribute('title', 'Point every TODO lookup of this tree that has exactly one record to choose from at that record\\'s nickname, in the recipe file, after a confirmation that lists them');
        wireAllElement.addEventListener('click', function () {
            if (isWireLookupRunning) { return; }
            setWireLookupRunning(true);
            vscodeApi.postMessage({ command: 'wireAllLookups', treeKey: tree.treeKey });
        });
        wireAllElement.disabled = isWireLookupRunning;
        wireLookupButtonElements.push(wireAllElement);

        return wireAllElement;

    }

    function setWireLookupRunning(isRunning) {

        isWireLookupRunning = isRunning;
        wireLookupButtonElements.forEach(function (buttonElement) { buttonElement.disabled = isRunning; });

    }

    function applyTreeFieldVisibility(fieldState) {

        if (!fieldState.rowElement) { return; }

        if (fieldState.isMatch) {
            fieldState.rowElement.classList.remove('hidden');
        } else {
            fieldState.rowElement.classList.add('hidden');
        }

    }

    function setTreeObjectExpanded(treeObjectState, isExpanded, isAnimated) {

        if (isExpanded && !treeObjectState.isBodyBuilt) {
            if (treeObjectState.objectTodos.length > 0) {
                treeObjectState.bodyElement.appendChild(buildTodoListElement(treeObjectState.object.recipeFilePath, treeObjectState.objectTodos));
            }
            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.rowElement = buildTreeFieldRow(treeObjectState, fieldState);
                applyTreeFieldVisibility(fieldState);
                treeObjectState.bodyElement.appendChild(fieldState.rowElement);
            });
            treeObjectState.isBodyBuilt = true;
            drawObjectFieldSelection(treeObjectState);
        }

        setShownWithMotion(treeObjectState.bodyElement, isExpanded, isAnimated);

        treeObjectState.isExpanded = isExpanded;
        drawToggle(treeObjectState.toggleElement, isExpanded, isAnimated);

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
            countInputElement: null,
            countErrorElement: null,
            hasRecordTypes: hasOwnKey(recordTypeFieldsByObjectApiName, object.objectApiName),
            recordTypeFieldCount: 0,
            // THE TODO COMMENTS OF THE BLOCK THAT SIT ON NO FIELD, AND EVERY TODO OF THE OCCURRENCE (#354)
            objectTodos: Array.isArray(object.todos) ? object.todos : [],
            todoCount: 0
        };

        treeObjectState.todoCount = treeObjectState.fieldStates.reduce(function (todoCount, fieldState) { return todoCount + fieldState.todos.length; }, treeObjectState.objectTodos.length);

        // AN ITERATION IS THE SAME OBJECT, SO ITS ROWS CARRY THE SAME CHIPS
        if (treeObjectState.hasRecordTypes) {
            const developerNamesByFieldApiName = recordTypeFieldsByObjectApiName[object.objectApiName];
            treeObjectState.fieldStates.forEach(function (fieldState) {
                if (!hasOwnKey(developerNamesByFieldApiName, fieldState.field.fieldApiName)) { return; }
                fieldState.recordTypeDeveloperNames = developerNamesByFieldApiName[fieldState.field.fieldApiName];
                treeObjectState.recordTypeFieldCount++;
            });
        }

        toggleElement.setAttribute('aria-expanded', 'false');
        toggleElement.setAttribute('aria-label', 'Show or hide the fields of ' + object.objectApiName);
        toggleElement.addEventListener('click', function () {
            treeObjectState.isExpandedByReader = !treeObjectState.isExpanded;
            setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader, true);
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
        appendRecordTypeFieldsToggle(treeState, treeState.structureSearch.element);
        appendTodosToggle(treeState, treeState.structureSearch.element);
        structureElement.appendChild(treeState.structureSearch.element);

        structureElement.appendChild(listRecordTypeObjects(treeState).length > 0
            ? buildRecordTypesSection(treeState)
            : buildUnavailableRecordTypesSection(treeState));

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

        if (treeState.tree.folderName) {
            addTreeTab(treeState, tabsElement, 'troubleshooting', TROUBLESHOOTING_TAB_LABEL, createElement('div', 'treeTroubleshooting hidden'));
            addTreeTab(treeState, tabsElement, 'query', QUERY_TAB_LABEL, createElement('div', 'treeQueries hidden'));
        }

        treeState.tabsElement = tabsElement;

        treeState.bodyElement.appendChild(tabsElement);
        treeState.tabStates.forEach(function (tabState) { treeState.bodyElement.appendChild(tabState.panelElement); });
        treeState.isBodyBuilt = true;
        applyStructureFilter(treeState);

    }

    function addTreeTab(treeState, tabsElement, tabName, tabLabel, panelElement) {

        const isSelected = tabName === treeState.selectedTab;
        const tabElement = createButton('secondary', isSelected ? 'treeTab selected' : 'treeTab', tabLabel);

        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        panelElement.classList.add('treeTabPanel');
        panelElement.setAttribute('role', 'tabpanel');
        panelElement.setAttribute('aria-label', tabLabel);
        tabElement.addEventListener('click', function () { selectTreeTab(treeState, tabName, true); });

        treeState.tabStates.push({ tabName: tabName, tabElement: tabElement, panelElement: panelElement, isBuilt: tabName === 'treecipe' });
        tabsElement.appendChild(tabElement);

    }

    function selectTreeTab(treeState, tabName, isAnimated) {

        ensureTreeBodyBuilt(treeState);

        if (!treeState.tabStates.some(function (tabState) { return tabState.tabName === tabName; })) { return; }

        drawTabMotion(treeState, tabName, isAnimated);
        treeState.selectedTab = tabName;

        treeState.tabStates.forEach(function (tabState) {

            const isSelected = tabState.tabName === tabName;

            if (isSelected) {
                tabState.tabElement.classList.add('selected');
            } else {
                tabState.tabElement.classList.remove('selected');
            }
            // ONLY THE INCOMING PANEL FADES; THE OUTGOING ONE IS GONE AT ONCE
            setShownWithMotion(tabState.panelElement, isSelected, isSelected && isAnimated);

            tabState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            if (isSelected && !tabState.isBuilt) {
                tabState.isBuilt = true;
                if (tabState.tabName === 'datasets') { buildDatasetsTab(treeState, tabState.panelElement); }
                if (tabState.tabName === 'troubleshooting') { buildTroubleshootingTab(treeState, tabState.panelElement); }
                if (tabState.tabName === 'query') { buildQueryTab(treeState, tabState.panelElement); }
            }

            if (isSelected && tabState.tabName === 'troubleshooting') { requestTroubleshootingSummary(treeState); }
            if (isSelected && tabState.tabName === 'query') { requestTreeQueries(treeState); }

        });

        // AFTER THE MODEL'S "rendered" -- A CLICK CAN ONLY COME FROM A DRAWN PANEL -- AND NEVER FOR A RESTORE, WHICH IS THE PANEL'S OWN OPEN
        if (tabName === 'treecipe' && renderedSequence !== null && !isRestoringPlace && treeState.isExpanded) { requestDataOrgs(); }

        savePanelPlace();

    }

    function drawTabMotion(treeState, tabName, isAnimated) {

        const tabNames = treeState.tabStates.map(function (tabState) { return tabState.tabName; });
        const fromIndex = tabNames.indexOf(treeState.selectedTab);
        const toIndex = tabNames.indexOf(tabName);

        ['movingLeft', 'movingRight', 'noMotion'].forEach(function (className) { treeState.tabsElement.classList.remove(className); });
        if (!isAnimated) {
            treeState.tabsElement.classList.add('noMotion');
        } else if (fromIndex !== toIndex) {
            treeState.tabsElement.classList.add(toIndex > fromIndex ? 'movingRight' : 'movingLeft');
        }

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

        const actionElement = createButton('secondary', 'historyAction ' + className, labelText);
        actionElement.setAttribute('title', titleText);
        actionElement.addEventListener('click', function () { vscodeApi.postMessage(hostMessage); });
        return actionElement;

    }

    /*
        ONE DATA SET: ITS OWN NAME AND STAR, WHEN, WHICH VERSION, ITS RECORD COUNTS, AND OPEN /
        INSERT BY FOLDER NAME. ✎ AND ☆ POST THE FOLDER NAME ONLY; THE HOST ASKS FOR THE NAME ITSELF.
    */
    function buildDatasetRowState(treeState, dataset) {

        const datasetElement = createElement('div', 'treeDataset');
        const datasetHeaderElement = createElement('div', 'treeDatasetHeader');
        const countsElement = createElement('div', 'treeDatasetCounts muted');
        const actionMessage = { datasetFolderName: dataset.datasetFolderName, treeKey: treeState.tree.treeKey, tab: 'datasets' };
        const rowState = { element: datasetElement, dataset: dataset, searchText: '', nameElement: null, favoriteElement: null, renameElement: null };

        rowState.favoriteElement = createButton('secondary', 'historyAction treeDatasetFavorite');
        rowState.favoriteElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'toggleFavoriteDataset', datasetFolderName: dataset.datasetFolderName });
        });
        datasetHeaderElement.appendChild(rowState.favoriteElement);

        rowState.nameElement = createElement('span', 'treeDatasetName');
        datasetHeaderElement.appendChild(rowState.nameElement);

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetDate', dataset.generatedAtLabel));
        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetBackend muted', dataset.fakerService));

        datasetHeaderElement.appendChild(createElement('span', dataset.runFolderName === null ? 'treeDatasetVersion unknownVersion' : 'treeDatasetVersion', versionLabelOf(treeState, dataset.runFolderName)));

        datasetHeaderElement.appendChild(createElement('span', 'treeDatasetFolder muted', dataset.datasetFolderName));

        rowState.renameElement = createButton('secondary', 'historyAction treeDatasetRename', RENAME_TREE_ACTION_LABEL);
        rowState.renameElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'renameDataset', datasetFolderName: dataset.datasetFolderName });
        });
        datasetHeaderElement.appendChild(rowState.renameElement);

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
            const loadCountsElement = createButton('secondary', 'historyAction treeDatasetCountsLoad', 'Show record counts');
            loadCountsElement.setAttribute('title', 'Count the records in the Collections API files of this data set');
            loadCountsElement.addEventListener('click', function () { requestDatasetRecordCounts(dataset.datasetFolderName, countsElement); });
            countsElement.appendChild(loadCountsElement);
        }

        drawDatasetName(rowState);

        return rowState;

    }

    // THE ROW'S NAME AND STAR, DRAWN AT FIRST AND AGAIN WHEN THE HOST SAYS EITHER CHANGED; THE SEARCH MATCHES THE NAME TOO
    function drawDatasetName(rowState) {

        const dataset = rowState.dataset;
        const displayName = dataset.customName || dataset.datasetFolderName;

        rowState.nameElement.textContent = dataset.customName || '';
        if (dataset.customName) { rowState.nameElement.classList.remove('hidden'); } else { rowState.nameElement.classList.add('hidden'); }

        rowState.favoriteElement.textContent = dataset.isFavorite ? FAVORITE_TREE_LABEL : NOT_FAVORITE_TREE_LABEL;
        rowState.favoriteElement.setAttribute('aria-pressed', dataset.isFavorite ? 'true' : 'false');
        rowState.favoriteElement.setAttribute('aria-label', dataset.isFavorite ? 'Remove ' + displayName + ' from favorites' : 'Mark ' + displayName + ' as a favorite');
        rowState.favoriteElement.setAttribute('title', dataset.isFavorite ? 'Remove from favorites' : 'Mark as a favorite');

        rowState.renameElement.setAttribute('aria-label', 'Rename ' + displayName);
        rowState.renameElement.setAttribute('title', 'Rename this data set');

        rowState.searchText = (dataset.datasetFolderName + '\\n' + (dataset.customName || '')).toLowerCase();

    }

    /*
        "Record type fields only" (#320): the Treecipe tab's own check, per card and panel-only, kept
        in the reader's place. A card whose objects have no record types to choose from draws it
        disabled with a note saying why, so turning it on can never empty the tab silently.
    */
    // A CARD'S OBJECTS ARE FIXED FOR ITS MODEL, SO THE ANSWER IS KEPT ON THE CARD
    function hasRecordTypeObjects(treeState) {
        if (typeof treeState.hasRecordTypeObjects !== 'boolean') {
            treeState.hasRecordTypeObjects = treeState.objectStates.some(function (treeObjectState) { return treeObjectState.hasRecordTypes; });
        }
        return treeState.hasRecordTypeObjects;
    }

    function isRecordTypeFieldsOnlyIn(treeState) {
        return treeState.isRecordTypeFieldsOnly === true && hasRecordTypeObjects(treeState);
    }

    function appendRecordTypeFieldsToggle(treeState, searchElement) {

        // THE SAME BOX EVERY OTHER CHECKBOX DRAWS (#343), WITH ITS LABEL BESIDE IT AS "Remember this selection" HAS
        const checkElement = createElement('span', 'treeRecordTypeFieldsCheck');
        const toggleElement = createButton('check', 'treeFieldInclude treeRecordTypeFieldsToggle');
        const labelElement = createElement('span', 'treeRecordTypeFieldsLabel', RECORD_TYPE_FIELDS_ONLY_LABEL);
        toggleElement.setAttribute('role', 'checkbox');
        toggleElement.setAttribute('aria-label', RECORD_TYPE_FIELDS_ONLY_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');

        if (hasRecordTypeObjects(treeState)) {
            const title = 'Show only the picklist fields a record type restricts';
            const toggleRecordTypeFieldsOnly = function () {
                if (toggleElement.disabled) { return; }
                treeState.isRecordTypeFieldsOnly = !treeState.isRecordTypeFieldsOnly;
                applyStructureFilter(treeState);
                savePanelPlace();
            };
            toggleElement.setAttribute('title', title);
            labelElement.setAttribute('title', title);
            toggleElement.addEventListener('click', toggleRecordTypeFieldsOnly);
            labelElement.addEventListener('click', toggleRecordTypeFieldsOnly);
        } else {
            toggleElement.disabled = true;
            toggleElement.setAttribute('title', NO_RECORD_TYPE_FIELDS_NOTE);
            checkElement.classList.add('disabled');
        }

        treeState.recordTypeFieldsToggleElement = toggleElement;
        checkElement.appendChild(toggleElement);
        checkElement.appendChild(labelElement);
        searchElement.appendChild(checkElement);

        if (!hasRecordTypeObjects(treeState)) {
            searchElement.appendChild(createElement('span', 'treeRecordTypeFieldsNote muted', NO_RECORD_TYPE_FIELDS_NOTE));
        }

        drawRecordTypeFieldsToggle(treeState);

    }

    /*
        "TODOs only" (#354): the Treecipe tab's own check, per card and panel-only, kept in the
        reader's place. It narrows the rows to the fields whose recipe lines carry a TODO comment,
        with the search, and never hides an object. A card with no TODO draws it disabled.
    */
    function todoCountOf(treeState) {
        if (typeof treeState.todoCount !== 'number') {
            treeState.todoCount = treeState.objectStates.reduce(function (todoCount, treeObjectState) { return todoCount + treeObjectState.todoCount; }, 0);
        }
        return treeState.todoCount;
    }

    function isTodosOnlyIn(treeState) {
        return treeState.isTodosOnly === true && todoCountOf(treeState) > 0;
    }

    function appendTodosToggle(treeState, searchElement) {

        const todoCount = todoCountOf(treeState);
        const checkElement = createElement('span', 'treeTodosCheck');
        const toggleElement = createButton('check', 'treeFieldInclude treeTodosToggle');
        const labelElement = createElement('span', 'treeTodosLabel', todoCount > 0 ? TODOS_ONLY_LABEL + ' (' + todoCount + ')' : TODOS_ONLY_LABEL);
        toggleElement.setAttribute('role', 'checkbox');
        toggleElement.setAttribute('aria-label', TODOS_ONLY_LABEL + ' (' + displayTitleOf(treeState.tree) + ')');

        if (todoCount > 0) {
            const title = 'Show only the fields and objects with a TODO comment in the recipe (' + pluralize(todoCount, 'TODO', 'TODOs') + ')';
            const toggleTodosOnly = function () {
                if (toggleElement.disabled) { return; }
                treeState.isTodosOnly = !treeState.isTodosOnly;
                applyStructureFilter(treeState);
                savePanelPlace();
            };
            toggleElement.setAttribute('title', title);
            labelElement.setAttribute('title', title);
            toggleElement.addEventListener('click', toggleTodosOnly);
            labelElement.addEventListener('click', toggleTodosOnly);
        } else {
            toggleElement.disabled = true;
            toggleElement.setAttribute('title', NO_TODOS_NOTE);
            checkElement.classList.add('disabled');
        }

        treeState.todosToggleElement = toggleElement;
        checkElement.appendChild(toggleElement);
        checkElement.appendChild(labelElement);
        searchElement.appendChild(checkElement);

        if (todoCount === 0) {
            searchElement.appendChild(createElement('span', 'treeTodosNote muted', NO_TODOS_NOTE));
        }

        drawTodosToggle(treeState);

    }

    function drawTodosToggle(treeState) {

        const toggleElement = treeState.todosToggleElement;
        if (!toggleElement) { return; }

        const isChecked = isTodosOnlyIn(treeState);
        toggleElement.textContent = isChecked ? '✓' : '';
        toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');

    }

    // A FIELD'S OR AN OBJECT'S TODO COMMENTS (#354): THE TEXT, AS TEXT, AND A LINK TO ITS LINE
    function buildTodoListElement(recipeFilePath, todos) {

        const listElement = createElement('div', 'treeTodos');

        todos.forEach(function (todo) {
            const todoElement = createElement('div', 'treeTodo');
            // A TODO WITH NO TEXT IS ONE THE FIELD'S DRAWN VALUE ALREADY SHOWS: THE ROW POINTS AT IT RATHER THAN POSTING IT TWICE
            todoElement.appendChild(typeof todo.text === 'string'
                ? createElement('span', 'treeTodoText', todo.text)
                : createElement('span', 'treeTodoText muted', TODO_IN_VALUE_LABEL + ' (line ' + todo.lineNumber + ')'));
            if (recipeFilePath && todo.lineNumber) {
                todoElement.appendChild(buildSourceLink('treeTodoSource', '↗ yml', recipeFilePath, todo.lineNumber));
            }
            listElement.appendChild(todoElement);
        });

        return listElement;

    }

    function drawRecordTypeFieldsToggle(treeState) {

        const toggleElement = treeState.recordTypeFieldsToggleElement;
        if (!toggleElement) { return; }

        const isChecked = isRecordTypeFieldsOnlyIn(treeState);
        toggleElement.textContent = isChecked ? '✓' : '';
        toggleElement.setAttribute('aria-checked', isChecked ? 'true' : 'false');

    }

    // THE DATA SETS TAB'S OWN FAVORITES ONLY: PANEL-ONLY, KEPT IN THE READER'S PLACE PER CARD
    function buildDatasetFavoritesToggle(treeState) {

        const toggleElement = createButton('secondary', 'historyAction treeDatasetFavoritesToggle');
        toggleElement.setAttribute('title', 'Show only the data sets marked as favorites');
        toggleElement.addEventListener('click', function () {
            treeState.isDatasetFavoritesOnly = !treeState.isDatasetFavoritesOnly;
            applyDatasetsFilter(treeState);
            savePanelPlace();
        });

        return toggleElement;

    }

    function buildDatasetsTab(treeState, panelElement) {

        const datasets = treeState.tree.history.datasets;

        if (datasets.length === 0) {
            panelElement.appendChild(createElement('div', 'treeEmpty muted', 'No data sets were made from this tree.'));
            return;
        }

        treeState.datasetsSearch = buildTabSearch(treeState, 'datasets', 'Search data sets', applyDatasetsFilter);
        treeState.datasetFavoritesToggleElement = buildDatasetFavoritesToggle(treeState);
        treeState.datasetsSearch.element.appendChild(treeState.datasetFavoritesToggleElement);
        panelElement.appendChild(treeState.datasetsSearch.element);

        treeState.datasetRowStates = datasets.map(function (dataset) {
            const rowState = buildDatasetRowState(treeState, dataset);
            panelElement.appendChild(rowState.element);
            return rowState;
        });

        applyDatasetsFilter(treeState);

    }

    // EVERY OBJECT THE CARD DRAWS THAT HAS RECORD TYPES TO CHOOSE FROM, ONCE, IN THE CARD'S ORDER
    // A CARD'S OBJECTS ARE FIXED FOR ITS MODEL, AND THE SEARCH AND EVERY TICK ASK FOR THIS LIST (#321), SO IT IS BUILT ONCE PER CARD
    function listRecordTypeObjects(treeState) {

        if (treeState.listedRecordTypeObjects) { return treeState.listedRecordTypeObjects; }

        const listedObjectApiNames = Object.create(null);

        treeState.listedRecordTypeObjects = treeState.objectStates
            .filter(function (treeObjectState) { return !treeObjectState.isIteration && Array.isArray(treeObjectState.object.recordTypes); })
            .map(function (treeObjectState) { return treeObjectState.object; })
            .filter(function (object) {
                if (listedObjectApiNames[object.objectApiName] === true) { return false; }
                listedObjectApiNames[object.objectApiName] = true;
                return true;
            });

        return treeState.listedRecordTypeObjects;

    }

    function describeRecordTypeImpacts(recordType) {

        if (recordType.impacts.length === 0) { return 'Restricts no picklist values'; }

        const kindLabels = { picklist: 'Picklist', multiselect: 'Multi-select', dependent: 'Dependent picklist' };
        return recordType.impacts.map(function (impact) {
            return kindLabels[impact.kind] + ' ' + impact.fieldApiName + ': ' + pluralize(impact.valueCount, 'value', 'values');
        }).join(' · ');

    }

    /*
        The Record types section of the Treecipe tab (#321, the #195 tab before it): one header line
        under the search box, collapsed until the reader opens it, saying how many objects it lists
        and whether the choice still matches the run. Like a tree card, the HEADER is the toggle and
        the ▸ carries no listener of its own. Its rows are built on first expand.
    */
    // EACH SECTION'S TOGGLE NAMES ITS BODY AND ITS SUMMARY BY ID, SO A SCREEN READER ANNOUNCES "changed" ON THE TOGGLE (#321)
    let recordTypesSectionCount = 0;

    function buildRecordTypesSection(treeState) {

        const sectionElement = createElement('div', 'recordTypesSection');
        const headerElement = createElement('div', 'recordTypesSectionHeader');
        const toggleElement = buildToggleElement('treeObjectToggle recordTypesSectionToggle');
        const bodyElement = createElement('div', 'recordTypesSectionBody hidden');
        const summaryElement = createElement('span', 'recordTypesSectionSummary muted');

        recordTypesSectionCount++;
        bodyElement.setAttribute('id', 'recordTypesSectionBody' + recordTypesSectionCount);
        summaryElement.setAttribute('id', 'recordTypesSectionSummary' + recordTypesSectionCount);
        toggleElement.setAttribute('aria-label', RECORD_TYPES_SECTION_TITLE + ' (' + displayTitleOf(treeState.tree) + ')');
        toggleElement.setAttribute('aria-controls', 'recordTypesSectionBody' + recordTypesSectionCount);
        toggleElement.setAttribute('aria-describedby', 'recordTypesSectionSummary' + recordTypesSectionCount);
        drawToggle(toggleElement, false, false);
        headerElement.appendChild(toggleElement);
        headerElement.appendChild(createElement('span', 'recordTypesSectionTitle', RECORD_TYPES_SECTION_TITLE));
        headerElement.appendChild(summaryElement);
        headerElement.addEventListener('click', function () {
            setRecordTypesExpanded(treeState, !treeState.isRecordTypesExpanded, true);
            savePanelPlace();
        });

        sectionElement.appendChild(headerElement);
        sectionElement.appendChild(bodyElement);

        treeState.recordTypesSection = { toggleElement: toggleElement, bodyElement: bodyElement, summaryElement: summaryElement, isBuilt: false };
        drawRecordTypesSummary(treeState);

        return sectionElement;

    }

    /*
        A card with no object offering two or more record types still draws the header (#338), so
        the reader learns the section exists and why this tree has nothing in it. It has no body and
        no listener, and treeState.recordTypesSection stays unset, so a click, a search, a restored
        place and a focus all stop at the guards every other path already has.
    */
    function buildUnavailableRecordTypesSection(treeState) {

        const sectionElement = createElement('div', 'recordTypesSection disabled');
        const headerElement = createElement('div', 'recordTypesSectionHeader');
        const toggleElement = buildToggleElement('treeObjectToggle recordTypesSectionToggle');

        toggleElement.disabled = true;
        toggleElement.setAttribute('aria-label', RECORD_TYPES_SECTION_TITLE + ' (' + displayTitleOf(treeState.tree) + ')');
        toggleElement.classList.add('noMotion');
        const summaryElement = createElement('span', 'recordTypesSectionSummary muted', RECORD_TYPES_UNAVAILABLE_SUMMARY);

        recordTypesSectionCount++;
        summaryElement.setAttribute('id', 'recordTypesSectionSummary' + recordTypesSectionCount);
        toggleElement.setAttribute('aria-describedby', 'recordTypesSectionSummary' + recordTypesSectionCount);
        // A GROUP, SO aria-disabled IS READ FROM THE SECTION RATHER THAN IGNORED ON A ROLELESS div
        sectionElement.setAttribute('role', 'group');
        sectionElement.setAttribute('aria-label', RECORD_TYPES_SECTION_TITLE);
        sectionElement.setAttribute('aria-disabled', 'true');
        headerElement.setAttribute('aria-disabled', 'true');
        headerElement.appendChild(toggleElement);
        headerElement.appendChild(createElement('span', 'recordTypesSectionTitle', RECORD_TYPES_SECTION_TITLE));
        headerElement.appendChild(summaryElement);
        sectionElement.appendChild(headerElement);

        return sectionElement;

    }

    function setRecordTypesExpanded(treeState, isExpanded, isAnimated) {

        const section = treeState.recordTypesSection;
        if (!section) { return; }

        if (isExpanded && !section.isBuilt) {
            section.isBuilt = true;
            buildRecordTypesRows(treeState, section.bodyElement);
        }

        setShownWithMotion(section.bodyElement, isExpanded, isAnimated);
        drawToggle(section.toggleElement, isExpanded, isAnimated);
        treeState.isRecordTypesExpanded = isExpanded;

    }

    // WHAT THE TREECIPE SEARCH MATCHES IN A ROW: THE OBJECT, ITS RECORD TYPES AND THE FIELDS THEY RESTRICT; BUILT ONCE PER OBJECT, NOT PER KEYSTROKE
    const recordTypeSearchTextByObject = new WeakMap();

    function recordTypeObjectSearchText(object) {

        const knownSearchText = recordTypeSearchTextByObject.get(object);
        if (knownSearchText !== undefined) { return knownSearchText; }

        const searchTextParts = [object.objectApiName];
        object.recordTypes.forEach(function (recordType) {
            searchTextParts.push(recordType.developerName);
            recordType.impacts.forEach(function (impact) { searchTextParts.push(impact.fieldApiName); });
        });
        const searchText = searchTextParts.join('\\n').toLowerCase();
        recordTypeSearchTextByObject.set(object, searchText);
        return searchText;

    }

    function drawRecordTypesSummary(treeState) {

        const section = treeState.recordTypesSection;
        if (!section) { return; }

        const objects = listRecordTypeObjects(treeState);
        const searchQuery = treeState.searchQueries.treecipe;
        const matchingCount = objects.filter(function (object) { return !searchQuery || recordTypeObjectSearchText(object).indexOf(searchQuery) !== -1; }).length;
        const isChanged = objects.some(function (object) { return !isSameChoice(recordTypeChoices[object.objectApiName] || [], object.generatedRecordTypeDeveloperNames || []); });
        const isApplied = objects.some(function (object) { return object.isRecordTypeSelectionApplied === true; });
        const countText = !searchQuery
            ? pluralize(objects.length, 'object', 'objects')
            : matchingCount > 0 ? matchingCount + ' of ' + pluralize(objects.length, 'object', 'objects') : 'no matching objects';

        section.summaryElement.textContent = countText + ' · ' + (isChanged ? 'changed' : isApplied ? 'generated from a choice' : 'generated by default');

    }

    /*
        The section's rows: every object of the card with two or more record types, each record
        type a checkbox with what it restricts, and the two buttons that regenerate the run. The
        choice they draw is panel-wide, so a tick here is drawn on every card listing the object.
    */
    function buildRecordTypesRows(treeState, panelElement) {

        panelElement.appendChild(createElement('div', 'recordTypesIntro muted', RECORD_TYPES_INTRO));

        treeState.recordTypeObjectStates = listRecordTypeObjects(treeState).map(function (object) {

            const objectElement = createElement('div', 'recordTypeObject');
            const headingElement = createElement('div', 'recordTypeObjectHeading');
            const statusElement = createElement('span', 'recordTypeObjectStatus muted');

            headingElement.appendChild(createElement('span', 'recordTypeObjectName', object.objectApiName));
            headingElement.appendChild(statusElement);
            objectElement.appendChild(headingElement);

            object.recordTypes.forEach(function (recordType) {

                const rowElement = createElement('div', 'recordTypeRow');
                const checkboxElement = createButton('check', 'treeFieldInclude recordTypeInclude');
                const labelElement = createElement('span', 'recordTypeName', recordType.developerName);

                checkboxElement.setAttribute('role', 'checkbox');
                checkboxElement.setAttribute('aria-label', recordType.developerName + ' (' + object.objectApiName + ')');
                checkboxElement.addEventListener('click', function () {
                    if (checkboxElement.disabled) { return; }
                    toggleRecordTypeChoice(object.objectApiName, recordType.developerName);
                });

                rowElement.appendChild(checkboxElement);
                rowElement.appendChild(labelElement);
                if (!recordType.isActive) { rowElement.appendChild(createElement('span', 'recordTypeInactive muted', 'inactive')); }
                rowElement.appendChild(createElement('div', 'recordTypeImpact muted', describeRecordTypeImpacts(recordType)));
                objectElement.appendChild(rowElement);

                recordTypeRowStates.push({ objectApiName: object.objectApiName, developerName: recordType.developerName, checkboxElement: checkboxElement });

            });

            panelElement.appendChild(objectElement);

            return { object: object, element: objectElement, statusElement: statusElement, searchText: recordTypeObjectSearchText(object) };

        });

        const actionsElement = createElement('div', 'recordTypeActions');
        const regenerateElement = createButton('primary', 'recordTypesRegenerate', REGENERATE_WITH_RECORD_TYPES_LABEL);
        const defaultsElement = createButton('secondary', 'historyAction recordTypesDefaults', USE_DEFAULT_RECORD_TYPES_LABEL);

        const rememberRowElement = createElement('div', 'recordTypesRememberRow');
        const rememberElement = createButton('check', 'treeFieldInclude recordTypesRemember');
        const rememberLabelElement = createElement('span', 'recordTypesRememberLabel', REMEMBER_RECORD_TYPES_LABEL);

        rememberElement.setAttribute('role', 'checkbox');
        rememberElement.setAttribute('aria-label', REMEMBER_RECORD_TYPES_LABEL);
        rememberElement.setAttribute('title', REMEMBER_RECORD_TYPES_TITLE);
        rememberLabelElement.setAttribute('title', REMEMBER_RECORD_TYPES_TITLE);
        rememberElement.addEventListener('click', function () {
            if (rememberElement.disabled) { return; }
            toggleRecordTypeSelectionRemembered();
        });
        rememberLabelElement.addEventListener('click', function () {
            if (rememberElement.disabled) { return; }
            toggleRecordTypeSelectionRemembered();
        });

        rememberRowElement.appendChild(rememberElement);
        rememberRowElement.appendChild(rememberLabelElement);
        panelElement.appendChild(rememberRowElement);
        recordTypeRememberElements.push(rememberElement);

        regenerateElement.addEventListener('click', function () { postRecordTypeRegenerate(treeState, buildRecordTypeSelection()); });
        defaultsElement.addEventListener('click', function () { postRecordTypeRegenerate(treeState, {}); });
        defaultsElement.setAttribute('title', 'Regenerate the run with every object\\'s default record type, as Generate Treecipe writes it');

        actionsElement.appendChild(regenerateElement);
        actionsElement.appendChild(defaultsElement);
        panelElement.appendChild(actionsElement);
        recordTypeButtonElements.push(regenerateElement, defaultsElement);

        drawRecordTypeChoices();
        applyRecordTypesFilter(treeState);

    }

    // THE TREECIPE TAB'S ONE SEARCH ALSO NARROWS THE SECTION'S ROWS; THE COUNT IS IN ITS HEADER
    function applyRecordTypesFilter(treeState) {

        const searchQuery = treeState.searchQueries.treecipe;

        (treeState.recordTypeObjectStates || []).forEach(function (objectState) {
            setShown(objectState.element, !searchQuery || objectState.searchText.indexOf(searchQuery) !== -1);
        });
        drawRecordTypesSummary(treeState);

    }

    // A CHOICE KEEPS AT LEAST ONE RECORD TYPE: "NONE" IS NOT A RECORD TYPE, AND "Use defaults" IS HOW TO GO BACK
    function toggleRecordTypeChoice(objectApiName, developerName) {

        const choice = recordTypeChoices[objectApiName] || [];
        const choiceIndex = choice.indexOf(developerName);

        if (choiceIndex === -1) {
            choice.push(developerName);
        } else if (choice.length > 1) {
            choice.splice(choiceIndex, 1);
        }

        recordTypeChoices[objectApiName] = choice;
        drawRecordTypeChoices();

    }

    function toggleRecordTypeSelectionRemembered() {

        isRecordTypeSelectionRemembered = !isRecordTypeSelectionRemembered;
        drawRecordTypeChoices();

    }

    function isSameChoice(firstNames, secondNames) {

        return firstNames.length === secondNames.length && firstNames.every(function (name, nameIndex) { return name === secondNames[nameIndex]; });

    }

    /*
        What a regenerate sends: every object the reader changed, and every object the run on
        screen was already generated from a choice for -- so regenerating for one object does not
        put another back to its default. An object left at its default is left out, which
        generates it exactly as Generate Treecipe always has.
    */
    function buildRecordTypeSelection() {

        const recordTypeSelection = Object.create(null);

        recordTypeObjects.forEach(function (object) {
            const choice = recordTypeChoices[object.objectApiName] || [];
            const isChanged = !isSameChoice(choice, object.generatedRecordTypeDeveloperNames || []);
            if (choice.length > 0 && (isChanged || object.isRecordTypeSelectionApplied === true)) {
                recordTypeSelection[object.objectApiName] = choice.slice();
            }
        });

        return recordTypeSelection;

    }

    function postRecordTypeRegenerate(treeState, recordTypeSelection) {

        if (isRecordTypeRegenerating || insertRunningTreeKey !== null) { return; }

        isRecordTypeRegenerating = true;
        drawRecordTypeChoices();
        const regenerateMessage = { command: 'regenerateWithRecordTypes', treeKey: treeState.tree.treeKey, recordTypeSelection: recordTypeSelection };
        if (isRecordTypeSelectionRemembered) { regenerateMessage.isRemembered = true; }
        vscodeApi.postMessage(regenerateMessage);

    }

    function drawRecordTypeChoices() {

        recordTypeRowStates.forEach(function (rowState) {
            const choice = recordTypeChoices[rowState.objectApiName] || [];
            const isTicked = choice.indexOf(rowState.developerName) !== -1;
            const isLastTicked = isTicked && choice.length === 1;
            rowState.checkboxElement.textContent = isTicked ? '✓' : '';
            rowState.checkboxElement.setAttribute('aria-checked', isTicked ? 'true' : 'false');
            rowState.checkboxElement.disabled = isRecordTypeRegenerating || insertRunningTreeKey !== null || isLastTicked;
            if (isLastTicked) {
                rowState.checkboxElement.setAttribute('title', 'Each object keeps at least one record type');
            } else {
                rowState.checkboxElement.removeAttribute('title');
            }
        });

        treeStates.forEach(function (treeState) {
            (treeState.recordTypeObjectStates || []).forEach(function (objectState) {
                const object = objectState.object;
                const choice = recordTypeChoices[object.objectApiName] || [];
                const isChanged = !isSameChoice(choice, object.generatedRecordTypeDeveloperNames || []);
                objectState.statusElement.textContent = isChanged
                    ? 'changed: regenerate to write ' + choice.join(', ')
                    : (object.isRecordTypeSelectionApplied === true ? 'generated: ' : 'generated by default: ') + choice.join(', ');
            });
        });

        treeStates.forEach(drawRecordTypesSummary);

        recordTypeRememberElements.forEach(function (rememberElement) {
            rememberElement.textContent = isRecordTypeSelectionRemembered ? '✓' : '';
            rememberElement.setAttribute('aria-checked', isRecordTypeSelectionRemembered ? 'true' : 'false');
            rememberElement.disabled = isRecordTypeRegenerating || insertRunningTreeKey !== null;
        });

        recordTypeButtonElements.forEach(function (buttonElement) {
            buttonElement.disabled = isRecordTypeRegenerating || insertRunningTreeKey !== null;
            if (insertRunningTreeKey !== null) {
                buttonElement.setAttribute('title', 'Wait for the insert to finish');
            } else {
                buttonElement.removeAttribute('title');
            }
        });

    }

    /*
        The data sets tab lists rows, not objects, so a search hides the rows it does not match --
        and says how many it left, so an empty tab never reads as a tree with no history.
    */
    function applyRowSearch(rowStates, searchQuery, search, singular, plural, isFavoritesOnly) {

        let matchingRowCount = 0;
        const isFiltered = !!searchQuery || !!isFavoritesOnly;

        rowStates.forEach(function (rowState) {
            const isMatch = (!searchQuery || rowState.searchText.indexOf(searchQuery) !== -1)
                && (!isFavoritesOnly || rowState.dataset.isFavorite === true);
            if (isMatch) { matchingRowCount++; rowState.element.classList.remove('hidden'); } else { rowState.element.classList.add('hidden'); }
        });

        search.matchCountElement.textContent = !isFiltered
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
                const datasetRowState = buildDatasetRowState(treeState, dataset);
                datasetsTabState.panelElement.insertBefore(datasetRowState.element, treeState.datasetRowStates[0].element);
                treeState.datasetRowStates.unshift(datasetRowState);
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

        vscodeApi.postMessage({ command: 'partialRendered', renderSequence: renderedSequence, updateSequence: datasetAddedMessage.updateSequence });

    }

    function applyDatasetsFilter(treeState) {

        applyRowSearch(treeState.datasetRowStates, treeState.searchQueries.datasets, treeState.datasetsSearch, 'data set', 'data sets', treeState.isDatasetFavoritesOnly);

        if (treeState.datasetFavoritesToggleElement) {
            treeState.datasetFavoritesToggleElement.textContent = (treeState.isDatasetFavoritesOnly ? FAVORITE_TREE_LABEL : NOT_FAVORITE_TREE_LABEL) + ' ' + FAVORITES_ONLY_LABEL;
            treeState.datasetFavoritesToggleElement.setAttribute('aria-pressed', treeState.isDatasetFavoritesOnly ? 'true' : 'false');
        }

    }

    /*
        A data set's name or star changed: every card that lists it -- the model each draws
        from, so a tab built later draws it too, and the row itself where that tab is built. Only
        for the model on screen: a newer one was built from the preferences this update reports.
    */
    function renderDatasetPreferences(datasetPreferencesMessage) {

        if (renderedSequence === null || datasetPreferencesMessage.renderSequence !== renderedSequence
                || typeof datasetPreferencesMessage.datasetFolderName !== 'string') { return; }

        const datasetFolderName = datasetPreferencesMessage.datasetFolderName;
        const customName = typeof datasetPreferencesMessage.customName === 'string' ? datasetPreferencesMessage.customName : undefined;
        const isFavorite = datasetPreferencesMessage.isFavorite === true;

        treeStates.forEach(function (treeState) {

            const treeHistory = treeState.tree.history;
            if (!treeHistory) { return; }

            treeHistory.datasets
                .filter(function (dataset) { return dataset.datasetFolderName === datasetFolderName; })
                .forEach(function (dataset) { dataset.customName = customName; dataset.isFavorite = isFavorite; });

            const changedRowStates = (treeState.datasetRowStates || []).filter(function (rowState) { return rowState.dataset.datasetFolderName === datasetFolderName; });

            if (changedRowStates.length === 0) { return; }

            changedRowStates.forEach(function (rowState) {
                rowState.dataset.customName = customName;
                rowState.dataset.isFavorite = isFavorite;
                drawDatasetName(rowState);
            });
            applyDatasetsFilter(treeState);

        });

    }

    // A RELOAD THE HOST MADE AFTER A DATA SET WENT MISSING, OR A CREATE, RE-OPENS THE CARD AND TAB THE READER ACTED FROM
    function applyTreeFocus(focusTree) {

        if (!focusTree) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === focusTree.treeKey; });

        if (!treeState) { return; }

        // WHAT THE READER JUST ACTED ON IS CHOSEN IN THE DROPDOWN (#374), AND SHOWN EVEN WHEN IT IS NOT A FAVORITE
        if (isHiddenByFavorites(treeState)) {
            isFavoritesOnly = false;
            applyTreecipesSearch();
        }
        chooseTree(treeState, false);

        selectTreeTab(treeState, focusTree.tab);

        // A FAILED INSERT'S "Open Troubleshooting" (#375) OPENS THE SUB-TAB ITS ERROR POINTS AT
        if (focusTree.tab === 'troubleshooting' && typeof focusTree.troubleshootingSubTab === 'string') {
            selectTroubleshootingSubTab(treeState, focusTree.troubleshootingSubTab, false);
        }

        // A REGENERATE, AND "Change record types" (#196), RE-OPEN THE RECORD TYPES SECTION, SCROLLED TO THE OBJECT IT IS ABOUT
        if (!focusTree.recordTypes || typeof focusTree.recordTypes !== 'object') { return false; }

        setRecordTypesExpanded(treeState, true, false);
        savePanelPlace();

        const objectApiName = focusTree.recordTypes.objectApiName;
        const objectState = (treeState.recordTypeObjectStates || []).find(function (candidateState) { return candidateState.object.objectApiName === objectApiName; });
        if (!objectState || typeof objectState.element.scrollIntoView !== 'function') { return false; }

        // A SEARCH RESTORED FROM THE PLACE WOULD HIDE THE ROW THE READER ASKED TO SEE, SO IT IS CLEARED
        if (objectState.element.classList.contains('hidden') && treeState.searchQueries.treecipe) {
            treeState.searchTexts.treecipe = '';
            treeState.searchQueries.treecipe = '';
            if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = ''; }
            applyStructureFilter(treeState);
            savePanelPlace();
        }

        objectState.element.scrollIntoView({ block: 'nearest' });
        return true;

    }

    // THE SAME FOCUS ON THE MODEL ALREADY DRAWN, SCROLLED TO THE CARD, SO NOTHING RELOADS
    function focusTreeInPlace(focusTree) {

        if (!focusTree || typeof focusTree !== 'object' || typeof focusTree.treeKey !== 'string') { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === focusTree.treeKey; });
        if (!treeState) { return; }

        applyTreeFocus(focusTree);
        savePanelPlace();
        if (typeof treeState.element.scrollIntoView === 'function') { treeState.element.scrollIntoView({ block: 'start' }); }

    }

    function setTreeExpanded(treeState, isExpanded, isAnimated) {

        if (isExpanded) { ensureTreeBodyBuilt(treeState); }
        setShownWithMotion(treeState.bodyElement, isExpanded, isAnimated);

        treeState.isExpanded = isExpanded;

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
                recipeValue: iterationField ? iterationField.recipeValue : field.recipeValue,
                // THE OCCURRENCE'S OWN TODOS (#354): THE OBJECT'S ARE THE FIRST OCCURRENCE'S
                todos: iterationField && Array.isArray(iterationField.todos) ? iterationField.todos : undefined
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
                lineNumber: iterationField.lineNumber,
                todos: Array.isArray(iterationField.todos) ? iterationField.todos : undefined
            });
        });

        return {
            objectApiName: object.objectApiName,
            recipeFilePath: object.recipeFilePath,
            lineNumber: iteration.lineNumber,
            nickname: iteration.nickname,
            iteration: iteration,
            fields: fields,
            todos: Array.isArray(iteration.todos) ? iteration.todos : undefined
        };

    }

    function resolveTreeObject(treeObject, objectsByApiName) {

        if (!Object.prototype.hasOwnProperty.call(objectsByApiName, treeObject.objectApiName)) { return null; }

        const object = objectsByApiName[treeObject.objectApiName];
        return treeObject.iterationNickname === undefined ? object : buildIterationObject(object, treeObject.iterationNickname);

    }

    function renderTree(tree, objectsByApiName) {

        // HIDDEN UNTIL THE DROPDOWN CHOOSES IT (#374); ITS HEADER NO LONGER FOLDS IT
        const treeElement = createElement('div', 'treeCard hidden');
        const treeHeaderElement = createElement('div', 'treeHeader');

        const treeState = {
            tree: tree,
            objectStates: tree.objects
                .map(function (treeObject) { return { treeObject: treeObject, object: resolveTreeObject(treeObject, objectsByApiName) }; })
                .filter(function (resolved) { return resolved.object !== null; })
                .map(function (resolved) { return buildTreeObjectState(resolved.treeObject, resolved.object, tree); }),
            isBodyBuilt: false,
            isExpanded: false,
            element: treeElement,
            bodyElement: createElement('div', 'treeBody hidden'),
            searchQueries: { treecipe: '', datasets: '', troubleshooting: '', query: '' },
            // WHAT THE READER TYPED IN EACH BOX, AS TYPED -- searchQueries IS ITS TRIMMED, LOWERCASED FORM
            searchTexts: { treecipe: '', datasets: '', troubleshooting: '', query: '' },
            isDatasetFavoritesOnly: false,
            datasetFavoritesToggleElement: null,
            isRecordTypeFieldsOnly: false,
            recordTypeFieldsToggleElement: null,
            isTodosOnly: false,
            todosToggleElement: null,
            // THE TOP OF THE TREECIPE TAB (#255), MADE WITH THE TAB
            resetSelectionElement: null,
            insert: null
        };

        // AN OBJECT AND ITS FIELDS ARE COUNTED ONCE, HOWEVER MANY OCCURRENCES OF IT THE CARD DRAWS
        const objectStatesCounted = treeState.objectStates.filter(function (treeObjectState) { return !treeObjectState.isIteration; });
        const treeFieldCount = objectStatesCounted.reduce(function (fieldCount, treeObjectState) { return fieldCount + treeObjectState.fieldStates.length; }, 0);

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
            The actions sit at the END of the row. The click is stopped on the GROUP rather than on
            each button, because a browser may hand a click on a DISABLED button -- a rename while a
            write runs -- to its ancestors without running the button's own listener.
        */
        const actionsElement = createElement('span', 'treeHeaderActions');
        actionsElement.addEventListener('click', function (event) { event.stopPropagation(); });

        // ONLY A CARD WITH A FOLDER: THE NAME AND THE FAVORITE ARE KEPT BY FOLDER, AND THE UNGROUPED CARD HAS NONE
        if (tree.folderName) {

            treeState.favoriteElement = createButton('secondary', 'treeFavorite');
            treeState.favoriteElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'toggleFavoriteTree', treeKey: tree.treeKey });
            });
            actionsElement.appendChild(treeState.favoriteElement);

            treeState.renameElement = createButton('secondary', 'treeRename', RENAME_TREE_ACTION_LABEL);
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
        treeState.element.setAttribute('aria-label', displayTitle);

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

        if (treeState.insert) {
            drawTreeInsert(treeState);
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

        drawHelpSummary();
        // A NEW NAME OR STAR IS WHAT THE SECTION SEARCH AND THE DROPDOWN MATCH AND LIST, SO THE INDEX IS BUILT AGAIN
        treecipesSearchIndex = null;
        applyTreecipesSearch();

    }

    /*
        The top of a card's Treecipe tab: Reset selection, then "Generate fake data and insert into
        <org>". The org picker is the panel's Target Org Management section since #348, not a view per card. Each posts
        the tree's KEY alone; which org, which recipe file, which counts and which objects are the
        host's.
    */
    function buildTreecipeHeader(treeState) {

        const tree = treeState.tree;
        const headerElement = createElement('div', 'treecipeHeader');
        const actionsElement = createElement('div', 'treecipeActions');

        if (tree.folderName) {
            treeState.resetSelectionElement = createButton('secondary', 'treeResetSelection hidden', RESET_SELECTION_LABEL);
            treeState.resetSelectionElement.setAttribute('title', 'Include every object, tick every field and set every count back to the recipe\\'s own');
            treeState.resetSelectionElement.addEventListener('click', function () {
                vscodeApi.postMessage({ command: 'resetTreeSelection', treeKey: tree.treeKey });
            });
            actionsElement.appendChild(treeState.resetSelectionElement);
            drawResetSelection(treeState);
        }

        const wireAllLookupsElement = buildWireAllLookupsElement(tree);
        if (wireAllLookupsElement) {
            actionsElement.appendChild(wireAllLookupsElement);
        }

        headerElement.appendChild(actionsElement);

        if (tree.runFakerRecipeFileName) {
            headerElement.appendChild(buildTreeInsertElement(treeState));
        }

        drawTreeName(treeState);

        return headerElement;

    }

    function buildTreeInsertElement(treeState) {

        const controlsElement = createElement('div', 'treeInsertControls');
        const insert = {
            buttonElement: createButton('primary', 'treeInsert', INSERT_ACTION_LABEL),
            reasonElement: createElement('span', 'treeInsertReason muted')
        };

        /*
            The ONE button always generates AND inserts (#375): with no org chosen the host asks for
            one first; any other reason the insert cannot run disables it. It never generates only.
        */
        insert.buttonElement.addEventListener('click', function () {
            const treeKey = treeState.tree.treeKey;
            if (isTreeRunning(treeKey) || renderedSequence === null) { return; }
            const insertReason = findTreeInsertReason(treeState);
            if (insertReason !== '' && insertReason !== NO_DATA_ORG_INSERT_REASON) { return; }
            setInsertRunning(treeKey);
            vscodeApi.postMessage({ command: 'insertTree', treeKey: treeKey });
        });

        controlsElement.appendChild(insert.buttonElement);
        controlsElement.appendChild(insert.reasonElement);

        treeState.insert = insert;
        drawTreeInsert(treeState);

        return controlsElement;

    }

    /*
        The Troubleshooting tab (#346), on every card with a folder: what to do when an insert
        failed. Since #365 it is a row of sub-tabs, one area at a time: TODO's, Fields,
        Permissions, Validation Rules, Record Types, Global Value Sets. Every sub-tab is built with
        the tab, so every button and its run lock is where it always was, and only the selected one
        is shown. Each has its own search box, which hides the entries that do not match. What each
        deploy would deploy is read by the host from the project each time the tab is selected;
        only COUNTS come back, and a deploy with nothing to deploy draws its button disabled with the
        reason.
    */
    function buildTroubleshootingTab(treeState, panelElement) {

        const tree = treeState.tree;
        const stripElement = createElement('div', 'troubleshootingSubTabs');
        stripElement.setAttribute('role', 'tablist');
        stripElement.setAttribute('aria-label', TROUBLESHOOTING_TAB_LABEL);
        panelElement.appendChild(stripElement);

        treeState.troubleshootingStripElement = stripElement;
        treeState.troubleshootingSubTabStates = [];
        treeState.deployButtons = Object.create(null);
        treeState.deploySummaryElements = Object.create(null);

        if (TROUBLESHOOTING_SUB_TABS.indexOf(treeState.troubleshootingSubTab) === -1) {
            treeState.troubleshootingSubTab = TROUBLESHOOTING_SUB_TABS[0];
        }

        const addActionItem = function (subTabState, buttonElement, summaryElement) {
            const actionElement = createElement('div', 'troubleshootingAction');
            const controlsElement = createElement('div', 'troubleshootingControls');
            controlsElement.appendChild(buttonElement);
            actionElement.appendChild(controlsElement);
            if (summaryElement) { actionElement.appendChild(summaryElement); }
            subTabState.listElement.appendChild(actionElement);
            subTabState.items.push({ element: actionElement });
        };

        const addDeployItem = function (subTabState, deployKind) {
            const deployAction = buildDeployAction(treeState, deployKind);
            addActionItem(subTabState, deployAction.buttonElement, deployAction.summaryElement);
        };

        TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {

            const subTabState = addTroubleshootingSubTab(treeState, subTab, panelElement);

            if (subTab === 'todos') {
                buildTroubleshootingTodos(treeState, subTabState);
            } else if (subTab === 'fields') {
                addDeployItem(subTabState, 'fields');
            } else if (subTab === 'permissions') {
                if (tree.objects.length > 0) { addActionItem(subTabState, buildAssignPermissionSetButton(treeState)); }
                addActionItem(subTabState, buildGeneratePermissionSetButton(treeState));
                addDeployItem(subTabState, 'permissionSet');
            } else if (subTab === 'validationRules') {
                addActionItem(subTabState, buildRetrieveValidationRulesButton(treeState));
                buildTroubleshootingValidationRules(treeState, subTabState);
            } else if (subTab === 'recordTypes') {
                addDeployItem(subTabState, 'recordTypes');
            } else if (subTab === 'globalValueSets') {
                addDeployItem(subTabState, 'globalValueSets');
            }

        });

        selectTroubleshootingSubTab(treeState, treeState.troubleshootingSubTab, false);
        drawTreePermissionSet(treeState);
        applyTroubleshootingFilter(treeState);

    }

    function troubleshootingSearchKey(subTab) {
        return 'troubleshooting.' + subTab;
    }

    function addTroubleshootingSubTab(treeState, subTab, panelElement) {

        const label = TROUBLESHOOTING_SUB_TAB_LABELS[subTab];
        const tabElement = createButton('secondary', 'troubleshootingSubTab troubleshootingSubTab-' + subTab, label);
        const subPanelElement = createElement('div', 'troubleshootingSubPanel troubleshootingSubPanel-' + subTab + ' hidden');
        const searchKey = troubleshootingSearchKey(subTab);

        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', 'false');
        subPanelElement.setAttribute('role', 'tabpanel');
        subPanelElement.setAttribute('aria-label', label);
        tabElement.addEventListener('click', function () { selectTroubleshootingSubTab(treeState, subTab, true); });

        if (typeof treeState.searchTexts[searchKey] !== 'string') {
            treeState.searchTexts[searchKey] = '';
            treeState.searchQueries[searchKey] = '';
        }

        const search = buildTabSearch(treeState, searchKey, TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS[subTab], function () { applyTroubleshootingFilter(treeState, subTab); });
        const listElement = createElement('div', 'troubleshootingList');
        subPanelElement.appendChild(search.element);
        subPanelElement.appendChild(listElement);

        treeState.troubleshootingStripElement.appendChild(tabElement);
        panelElement.appendChild(subPanelElement);

        const subTabState = { subTab: subTab, tabElement: tabElement, panelElement: subPanelElement, search: search, listElement: listElement, items: [], noun: ['action', 'actions'] };
        treeState.troubleshootingSubTabStates.push(subTabState);

        return subTabState;

    }

    function selectTroubleshootingSubTab(treeState, subTab, isAnimated) {

        const subTabStates = treeState.troubleshootingSubTabStates || [];
        if (!subTabStates.some(function (subTabState) { return subTabState.subTab === subTab; })) { return; }

        const subTabNames = subTabStates.map(function (subTabState) { return subTabState.subTab; });
        const fromIndex = subTabNames.indexOf(treeState.troubleshootingSubTab);
        const toIndex = subTabNames.indexOf(subTab);
        const stripElement = treeState.troubleshootingStripElement;

        ['movingLeft', 'movingRight', 'noMotion'].forEach(function (className) { stripElement.classList.remove(className); });
        if (!isAnimated) {
            stripElement.classList.add('noMotion');
        } else if (fromIndex !== toIndex) {
            stripElement.classList.add(toIndex > fromIndex ? 'movingRight' : 'movingLeft');
        }

        treeState.troubleshootingSubTab = subTab;
        if (isAnimated && subTab === 'validationRules') { requestTreeValidationRules(treeState); }

        subTabStates.forEach(function (subTabState) {
            const isSelected = subTabState.subTab === subTab;
            if (isSelected) { subTabState.tabElement.classList.add('selected'); } else { subTabState.tabElement.classList.remove('selected'); }
            subTabState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            setShownWithMotion(subTabState.panelElement, isSelected, isSelected && isAnimated);
        });

        savePanelPlace();

    }

    /*
        Every TODO comment of the card's recipe (#365, from #354's todos), one group per object
        occurrence: a header with its count, and rows -- the field (or "on the object"), the text
        and a link to the TODO's own line -- built only when the group opens, like a Treecipe
        object's rows. A field TODO posted without its text is one its value holds, so the text is
        read back from that value. Search matches what each entry saved at build, so it needs no
        rows; groups open within the auto-expand budgets, so a tree of thousands of TODOs costs its
        headers and the rows the budget allows.
    */
    function buildTroubleshootingTodos(treeState, subTabState) {

        subTabState.noun = ['TODO', 'TODOs'];
        subTabState.todoGroups = [];

        treeState.objectStates.forEach(function (treeObjectState) {

            if (treeObjectState.todoCount === 0) { return; }

            const object = treeObjectState.object;
            // AN OBJECT WRITTEN MORE THAN ONCE IS TOLD APART BY THE NICKNAME OF THE OCCURRENCE
            const hasNickname = !!object.nickname && (!!object.iteration || Array.isArray(object.iterations));
            const objectLabel = object.objectApiName + (hasNickname ? ' · ' + object.nickname : '');
            const groupState = {
                object: object,
                element: createElement('div', 'troubleshootingTodoGroup'),
                toggleElement: buildToggleElement('troubleshootingTodoToggle'),
                countElement: createElement('span', 'troubleshootingTodoCount muted'),
                bodyElement: createElement('div', 'troubleshootingTodoRows hidden'),
                entries: [],
                matchingCount: 0,
                isBuilt: false,
                isExpanded: false,
                isShown: true
            };

            const addEntry = function (fieldLabel, todo, todoText, isFieldTodo) {
                groupState.entries.push({
                    fieldLabel: fieldLabel,
                    todo: todo,
                    todoText: todoText,
                    isFieldTodo: isFieldTodo,
                    searchText: [object.objectApiName, object.nickname || '', fieldLabel, todoText].join('\\n').toLowerCase(),
                    isMatch: true,
                    element: null
                });
            };

            treeObjectState.objectTodos.forEach(function (todo) {
                addEntry('on the object', todo, typeof todo.text === 'string' ? todo.text : '', false);
            });

            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.todos.forEach(function (todo) {
                    addEntry(fieldState.field.fieldApiName, todo, readFieldTodoText(todo, fieldState.field.recipeValue), true);
                });
            });

            const headerElement = createElement('div', 'troubleshootingTodoHeader');
            groupState.toggleElement.setAttribute('aria-label', 'Show or hide the TODOs of ' + objectLabel);
            groupState.toggleElement.setAttribute('aria-expanded', 'false');
            groupState.toggleElement.addEventListener('click', function () {
                setTodoGroupExpanded(groupState, !groupState.isExpanded, true);
            });
            headerElement.appendChild(groupState.toggleElement);
            headerElement.appendChild(createElement('span', 'troubleshootingTodoObject', objectLabel));
            headerElement.appendChild(groupState.countElement);
            groupState.element.appendChild(headerElement);
            groupState.element.appendChild(groupState.bodyElement);

            subTabState.listElement.appendChild(groupState.element);
            subTabState.todoGroups.push(groupState);

        });

        const todoCount = subTabState.todoGroups.reduce(function (count, groupState) { return count + groupState.entries.length; }, 0);
        subTabState.tabElement.textContent = todoCount > 0 ? TROUBLESHOOTING_SUB_TAB_LABELS.todos + ' (' + todoCount + ')' : TROUBLESHOOTING_SUB_TAB_LABELS.todos;

        if (todoCount === 0) {
            subTabState.listElement.appendChild(createElement('div', 'treeEmpty muted', NO_TREE_TODOS_NOTE));
        }

    }

    function setTodoGroupExpanded(groupState, isExpanded, isAnimated) {

        if (isExpanded && !groupState.isBuilt) {
            groupState.entries.forEach(function (entry) {
                const object = groupState.object;
                const todoElement = createElement('div', entry.isMatch ? 'troubleshootingTodo' : 'troubleshootingTodo hidden');
                todoElement.appendChild(createElement('span', entry.isFieldTodo ? 'troubleshootingTodoField' : 'troubleshootingTodoField muted', entry.fieldLabel));
                todoElement.appendChild(createElement('span', entry.todoText ? 'troubleshootingTodoText' : 'troubleshootingTodoText muted', entry.todoText || TODO_IN_FIELD_VALUE_LABEL));
                if (object.recipeFilePath && entry.todo.lineNumber) {
                    todoElement.appendChild(buildSourceLink('treeTodoSource', '↗ yml', object.recipeFilePath, entry.todo.lineNumber));
                }
                entry.element = todoElement;
                groupState.bodyElement.appendChild(todoElement);
            });
            groupState.isBuilt = true;
        }

        groupState.isExpanded = isExpanded;
        setShownWithMotion(groupState.bodyElement, isExpanded, isAnimated);
        drawToggle(groupState.toggleElement, isExpanded, isAnimated);

    }

    // A ROW OR GROUP IS WRITTEN ONLY WHEN ITS VISIBILITY CHANGES, SO A KEYSTROKE OVER THOUSANDS OF TODOS TOUCHES ONLY WHAT IT CHANGED
    function setShownIfChanged(state, element, isShown) {
        if (state.isShown === isShown) { return; }
        state.isShown = isShown;
        if (isShown) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
    }

    // A FIELD TODO'S TEXT: ITS OWN, OR THE SPAN OF THE FIELD'S VALUE THE HOST SAID HOLDS IT; '' WHEN NEITHER IS USABLE
    function readFieldTodoText(todo, recipeValue) {

        if (typeof todo.text === 'string') { return todo.text; }

        const value = typeof recipeValue === 'string' ? recipeValue : '';
        const isUsableSpan = Number.isInteger(todo.valueStart) && Number.isInteger(todo.valueLength)
            && todo.valueStart >= 0 && todo.valueLength > 0 && todo.valueStart + todo.valueLength <= value.length;

        return isUsableSpan ? value.substr(todo.valueStart, todo.valueLength) : '';

    }

    function buildDeployAction(treeState, deployKind) {

        const summaryElement = createElement('div', 'troubleshootingSummary muted', 'Reading this project…');
        const buttonElement = createButton('secondary', 'troubleshootingDeploy troubleshootingDeploy-' + deployKind, DEPLOY_ACTION_LABELS[deployKind]);

        buttonElement.addEventListener('click', function () {
            if (buttonElement.disabled || renderedSequence === null) { return; }
            isMetadataDeployRunning = true;
            metadataDeployRunningKey = treeState.tree.treeKey + '\\n' + deployKind;
            drawTreeInserts();
            drawDataOrgViews();
            const deployMessage = { command: DEPLOY_COMMANDS[deployKind], treeKey: treeState.tree.treeKey };
            if (dataOrgSelectedIndex !== null) { deployMessage.orgIndex = dataOrgSelectedIndex; }
            vscodeApi.postMessage(deployMessage);
        });

        treeState.deployButtons[deployKind] = buttonElement;
        treeState.deploySummaryElements[deployKind] = summaryElement;

        return { buttonElement: buttonElement, summaryElement: summaryElement };

    }

    // EVERY TEXT AN ELEMENT DRAWS, ITS DESCENDANTS' INCLUDED -- WHAT IS SEARCHABLE IS WHAT IS ON SCREEN, SO NOT A TOOLTIP
    function collectElementText(element) {

        const texts = [String(element.textContent || '')];
        Array.prototype.forEach.call(element.children || [], function (childElement) { texts.push.apply(texts, collectElementText(childElement)); });
        return texts;

    }

    /*
        Each sub-tab's own search (#365): it hides the entries that do not match and counts what is
        left. A keystroke filters only its own sub-tab (onlySubTab); a deploy summary refreshes only
        the action sub-tabs ('actions'); a build or restore filters them all.
    */
    function applyTroubleshootingFilter(treeState, onlySubTab) {

        (treeState.troubleshootingSubTabStates || []).forEach(function (subTabState) {

            if (onlySubTab === 'actions' ? subTabState.subTab === 'todos' : (onlySubTab && onlySubTab !== subTabState.subTab)) { return; }

            const searchQuery = treeState.searchQueries[troubleshootingSearchKey(subTabState.subTab)] || '';
            let matchingCount = 0;
            let total = 0;

            if (subTabState.todoGroups) {

                subTabState.todoGroups.forEach(function (groupState) {
                    groupState.matchingCount = 0;
                    groupState.entries.forEach(function (entry) {
                        entry.isMatch = !searchQuery || entry.searchText.indexOf(searchQuery) !== -1;
                        if (entry.isMatch) { groupState.matchingCount++; }
                        if (entry.element) { setShownIfChanged(entry, entry.element, entry.isMatch); }
                    });
                    total += groupState.entries.length;
                    matchingCount += groupState.matchingCount;
                    setShownIfChanged(groupState, groupState.element, !searchQuery || groupState.matchingCount > 0);
                    groupState.countElement.textContent = searchQuery
                        ? groupState.matchingCount + ' of ' + pluralize(groupState.entries.length, 'TODO', 'TODOs')
                        : pluralize(groupState.entries.length, 'TODO', 'TODOs');
                });

                expandMatchesWithinBudget(subTabState.todoGroups,
                    function (groupState) { return groupState.matchingCount; },
                    function (groupState) { return groupState.entries.length; },
                    function (groupState, isExpanded) { setTodoGroupExpanded(groupState, isExpanded, false); });

            } else {

                subTabState.items.forEach(function (item) {
                    // AN ACTION IS MATCHED BY WHAT IT DRAWS NOW: ITS BUTTON, ITS REASON AND WHAT IT WOULD DEPLOY
                    const isMatch = !searchQuery || collectElementText(item.element).join('\\n').toLowerCase().indexOf(searchQuery) !== -1;
                    if (isMatch) { matchingCount++; }
                    if (item.isShown === undefined) { item.isShown = true; }
                    setShownIfChanged(item, item.element, isMatch);
                });
                total = subTabState.items.length;

                // THE VALIDATION RULES SUB-TAB COUNTS ITS RULES, NOT ITS ONE ACTION (#327); A ROW IS MATCHED BY ITS SAVED TEXT, BUILT OR NOT
                if (subTabState.ruleGroups) {
                    matchingCount = 0;
                    total = 0;
                    subTabState.ruleGroups.forEach(function (groupState) {
                        groupState.matchingCount = 0;
                        groupState.entries.forEach(function (entry) {
                            entry.isMatch = !searchQuery || entry.searchText.indexOf(searchQuery) !== -1;
                            if (entry.isMatch) { groupState.matchingCount++; }
                            if (entry.element) { setShownIfChanged(entry, entry.element, entry.isMatch); }
                        });
                        total += groupState.entries.length;
                        matchingCount += groupState.matchingCount;
                        const isObjectNamed = groupState.objectApiName.toLowerCase().indexOf(searchQuery) !== -1;
                        setShownIfChanged(groupState, groupState.element, !searchQuery || groupState.matchingCount > 0 || isObjectNamed);
                        groupState.countElement.textContent = groupState.entries.length === 0 ? ''
                            : searchQuery ? groupState.matchingCount + ' of ' + pluralize(groupState.entries.length, 'rule', 'rules')
                            : pluralize(groupState.entries.length, 'rule', 'rules');
                    });
                    expandMatchesWithinBudget(subTabState.ruleGroups.filter(function (groupState) { return groupState.entries.length > 0; }),
                        function (groupState) { return groupState.matchingCount; },
                        function (groupState) { return groupState.entries.length; },
                        function (groupState, isExpanded) { setValidationRuleGroupExpanded(treeState, groupState, isExpanded, false); });
                }

            }

            subTabState.search.matchCountElement.textContent = !searchQuery
                ? pluralize(total, subTabState.noun[0], subTabState.noun[1])
                : matchingCount > 0 ? matchingCount + ' of ' + pluralize(total, subTabState.noun[0], subTabState.noun[1]) : 'no matches';

        });

    }

    // ASKED EACH TIME THE TAB IS SELECTED; ONE SELECTED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE) ASKS ONCE IT IS
    function requestTroubleshootingSummary(treeState) {

        if (renderedSequence === null) {
            treeState.isTroubleshootingSummaryWanted = true;
            return;
        }

        treeState.isTroubleshootingSummaryWanted = false;
        vscodeApi.postMessage({ command: 'loadTroubleshootingSummary', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });
        if (treeState.troubleshootingSubTab === 'validationRules') { requestTreeValidationRules(treeState); }

    }

    function renderTroubleshootingSummary(summaryMessage) {

        if (renderedSequence === null || summaryMessage.renderSequence !== renderedSequence) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === summaryMessage.treeKey; });
        if (!treeState) { return; }

        treeState.troubleshootingSummary = summaryMessage;
        drawTreePermissionSet(treeState);
        applyTroubleshootingFilter(treeState, 'actions');

    }

    /*
        The Query tab (#367), on every card with a folder: the SOQL Generate Treecipe wrote for the
        tree, read by the host from the run's objects wrapper each time the tab is selected. Each
        query is a text box the reader edits; an edit is saved when the box loses focus and before
        a run, and Reset puts back the generated text. Run posts the KEY and the text, never an org:
        the host asks for the org in the command palette. Only a PREVIEW comes back, written with
        textContent; Export asks the host to write the whole result it holds.
    */
    function buildQueryTab(treeState, panelElement) {

        treeState.querySearch = buildTabSearch(treeState, 'query', 'Search queries', applyQueryFilter);
        panelElement.appendChild(treeState.querySearch.element);
        panelElement.appendChild(createElement('div', 'treeQueryIntro muted', QUERY_INTRO));

        treeState.queryListElement = createElement('div', 'treeQueryList');
        treeState.queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', 'Reading this run’s queries…'));
        panelElement.appendChild(treeState.queryListElement);
        treeState.queryStates = [];

        applyQueryFilter(treeState);

    }

    // ASKED EACH TIME THE TAB IS SELECTED; ONE SELECTED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE) ASKS ONCE IT IS
    function requestTreeQueries(treeState) {

        if (renderedSequence === null) {
            treeState.isTreeQueriesWanted = true;
            return;
        }

        treeState.isTreeQueriesWanted = false;
        vscodeApi.postMessage({ command: 'loadTreeQueries', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

    }

    // AN EDIT ALREADY ON SCREEN IS KEPT: THE TAB ASKS AGAIN ON EVERY SELECT, AND THE READER MAY BE MID-EDIT
    function renderTreeQueries(queriesMessage) {

        if (renderedSequence === null || queriesMessage.renderSequence !== renderedSequence) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === queriesMessage.treeKey; });
        if (!treeState || !treeState.queryListElement) { return; }

        if (treeState.queryStates.length > 0 && !queriesMessage.failureMessage) { return; }

        treeState.queryListElement.textContent = '';
        treeState.queryStates = [];

        if (queriesMessage.failureMessage) {
            treeState.queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', String(queriesMessage.failureMessage)));
        } else if (!Array.isArray(queriesMessage.queries) || queriesMessage.queries.length === 0) {
            treeState.queryListElement.appendChild(createElement('div', 'treeQueryIntro muted', 'This tree has no generated queries.'));
        } else {
            queriesMessage.queries.forEach(function (treeQuery) { buildTreeQuery(treeState, treeQuery); });
        }

        if (treeState.pendingQueryResult) {
            const pendingQueryResult = treeState.pendingQueryResult;
            treeState.pendingQueryResult = null;
            renderTreeQueryResult(pendingQueryResult);
        }

        drawTreeQueryButtons();
        applyQueryFilter(treeState);

    }

    function buildTreeQuery(treeState, treeQuery) {

        const generatedText = String(treeQuery.generatedText || '');
        const queryTitle = String(treeQuery.objectApiName) + ' · ' + String(treeQuery.kindLabel);
        const queryElement = createElement('div', 'treeQuery');
        const textElement = createElement('textarea', 'treeQueryText');
        const editedElement = createElement('span', 'treeQueryEdited muted hidden', 'edited');
        const refusalElement = createElement('div', 'fieldEditorRefusal hidden');
        const controlsElement = createElement('div', 'treeQueryControls');
        const runButtonElement = createButton('primary', 'treeQueryRun', 'Run…');
        const resetButtonElement = createButton('secondary', 'treeQueryReset', 'Reset');
        const exportJsonButtonElement = createButton('secondary', 'treeQueryExport treeQueryExport-json', 'Export JSON');
        const exportCsvButtonElement = createButton('secondary', 'treeQueryExport treeQueryExport-csv', 'Export CSV');
        const resultElement = createElement('div', 'treeQueryResult hidden');
        const titleElement = createElement('div', 'treeQueryTitle', queryTitle);

        queryElement.setAttribute('role', 'group');
        queryElement.setAttribute('aria-label', queryTitle);
        titleElement.appendChild(editedElement);
        queryElement.appendChild(titleElement);
        (Array.isArray(treeQuery.notes) ? treeQuery.notes : []).forEach(function (note) {
            queryElement.appendChild(createElement('div', 'treeQueryNote muted', String(note)));
        });

        textElement.value = typeof treeQuery.editedText === 'string' ? treeQuery.editedText : generatedText;
        textElement.setAttribute('aria-label', 'SOQL for ' + queryTitle);
        textElement.setAttribute('spellcheck', 'false');
        textElement.setAttribute('maxlength', String(QUERY_MAX_LENGTH));
        textElement.setAttribute('rows', String(Math.min(12, Math.max(3, generatedText.split('\\n').length))));
        queryElement.appendChild(textElement);
        queryElement.appendChild(refusalElement);

        const queryState = {
            queryKey: String(treeQuery.queryKey),
            objectApiName: String(treeQuery.objectApiName),
            kindLabel: String(treeQuery.kindLabel),
            notes: Array.isArray(treeQuery.notes) ? treeQuery.notes.map(String) : [],
            generatedText: generatedText,
            savedText: textElement.value,
            element: queryElement,
            textElement: textElement,
            editedElement: editedElement,
            refusalElement: refusalElement,
            runButtonElement: runButtonElement,
            exportButtonElements: [exportJsonButtonElement, exportCsvButtonElement],
            resultElement: resultElement,
            hasResult: false
        };

        const drawEdited = function () {
            if (textElement.value !== generatedText) { editedElement.classList.remove('hidden'); } else { editedElement.classList.add('hidden'); }
        };

        const saveEdit = function () {
            if (renderedSequence === null || textElement.value === queryState.savedText) { return; }
            queryState.savedText = textElement.value;
            vscodeApi.postMessage({ command: 'saveTreeQueryEdit', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, queryText: textElement.value === generatedText ? '' : textElement.value });
        };

        textElement.addEventListener('input', function () {
            drawEdited();
            refusalElement.classList.add('hidden');
            // ONLY A SEARCH CAN HIDE A QUERY FOR ITS TEXT, SO A KEYSTROKE WITH NONE RE-FILTERS NOTHING
            if (treeState.searchQueries.query) { applyQueryFilter(treeState); }
        });
        textElement.addEventListener('change', saveEdit);

        runButtonElement.addEventListener('click', function () {
            if (runButtonElement.disabled || renderedSequence === null) { return; }
            const refusal = describeQueryRefusal(textElement.value);
            if (refusal) {
                refusalElement.textContent = refusal;
                refusalElement.setAttribute('role', 'alert');
                refusalElement.classList.remove('hidden');
                return;
            }
            saveEdit();
            isTreeQueryRunning = true;
            drawTreeQueryButtons();
            vscodeApi.postMessage({ command: 'runTreeQuery', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, queryText: textElement.value });
        });

        resetButtonElement.addEventListener('click', function () {
            if (resetButtonElement.disabled) { return; }
            textElement.value = generatedText;
            drawEdited();
            refusalElement.classList.add('hidden');
            saveEdit();
            applyQueryFilter(treeState);
        });

        [['json', exportJsonButtonElement], ['csv', exportCsvButtonElement]].forEach(function (exportEntry) {
            const exportButtonElement = exportEntry[1];
            exportButtonElement.addEventListener('click', function () {
                if (exportButtonElement.disabled || renderedSequence === null) { return; }
                vscodeApi.postMessage({ command: 'exportTreeQueryResult', treeKey: treeState.tree.treeKey, queryKey: queryState.queryKey, exportFormat: exportEntry[0] });
            });
        });

        controlsElement.appendChild(runButtonElement);
        controlsElement.appendChild(resetButtonElement);
        controlsElement.appendChild(exportJsonButtonElement);
        controlsElement.appendChild(exportCsvButtonElement);
        queryElement.appendChild(controlsElement);
        queryElement.appendChild(resultElement);

        drawEdited();
        treeState.queryStates.push(queryState);
        treeState.queryListElement.appendChild(queryElement);

    }

    // THE HOST HOLDS THE TEXT TO THE SAME RULE; THIS ONLY SAYS SO BEFORE AN ORG IS ASKED FOR
    function describeQueryRefusal(queryText) {

        const trimmedText = String(queryText || '').trim();

        if (!trimmedText) { return 'The query is empty.'; }
        if (trimmedText.length > QUERY_MAX_LENGTH) { return 'The query is longer than ' + QUERY_MAX_LENGTH + ' characters.'; }
        if (!/^select\\s/i.test(trimmedText)) { return 'The query must be one SOQL SELECT statement.'; }

        return '';

    }

    function drawTreeQueryButtons() {

        treeStates.forEach(function (treeState) {
            (treeState.queryStates || []).forEach(function (queryState) {
                queryState.runButtonElement.disabled = isTreeQueryRunning;
                queryState.exportButtonElements.forEach(function (exportButtonElement) {
                    exportButtonElement.disabled = isTreeQueryRunning || !queryState.hasResult;
                    exportButtonElement.setAttribute('title', queryState.hasResult ? 'Write what this query returned to treecipe/QueryResults' : 'Run this query first');
                });
            });
        });

    }

    /*
        One preview at a time, as the host keeps one result: every other query's preview and Export
        buttons go. A preview for a tab whose queries have not arrived yet waits for them.
    */
    function renderTreeQueryResult(resultMessage) {

        if (renderedSequence === null || resultMessage.renderSequence !== renderedSequence) { return; }

        const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === resultMessage.treeKey; });
        if (!treeState) { return; }

        const queryState = (treeState.queryStates || []).find(function (candidateQueryState) { return candidateQueryState.queryKey === resultMessage.queryKey; });
        if (!queryState) {
            treeState.pendingQueryResult = resultMessage;
            return;
        }

        treeStates.forEach(function (eachTreeState) {
            (eachTreeState.queryStates || []).forEach(function (eachQueryState) {
                eachQueryState.hasResult = false;
                eachQueryState.resultElement.textContent = '';
                eachQueryState.resultElement.classList.add('hidden');
            });
        });

        const columns = Array.isArray(resultMessage.columns) ? resultMessage.columns.map(String) : [];
        const rows = Array.isArray(resultMessage.rows) ? resultMessage.rows : [];
        const recordCount = Number(resultMessage.recordCount) || 0;
        let summaryText = pluralize(recordCount, 'record', 'records') + ' from ' + String(resultMessage.orgLabel || 'the org');
        if (resultMessage.isTruncated) { summaryText += ', the first of ' + String(resultMessage.totalSize) + ' it matched'; }
        const hiddenColumnCount = Number(resultMessage.hiddenColumnCount) || 0;
        if (rows.length < recordCount) { summaryText += '. Showing the first ' + rows.length + ' rows'; }
        if (hiddenColumnCount > 0) { summaryText += (rows.length < recordCount ? ' and ' : '. Showing ') + pluralize(columns.length, 'column', 'columns') + ', ' + hiddenColumnCount + ' more not shown'; }
        if (rows.length < recordCount || hiddenColumnCount > 0) { summaryText += '; Export writes them all.'; }

        queryState.resultElement.appendChild(createElement('div', 'treeQueryResultSummary muted', summaryText));

        if (columns.length > 0) {
            const tableWrapElement = createElement('div', 'treeQueryTableWrap');
            const tableElement = createElement('table', 'treeQueryTable');
            const headElement = createElement('thead', '');
            const headRowElement = createElement('tr', '');
            columns.forEach(function (column) { headRowElement.appendChild(createElement('th', '', column)); });
            headElement.appendChild(headRowElement);
            tableElement.appendChild(headElement);
            const bodyElement = createElement('tbody', '');
            rows.forEach(function (row) {
                const rowElement = createElement('tr', 'treeQueryRow');
                columns.forEach(function (_column, columnIndex) {
                    rowElement.appendChild(createElement('td', '', Array.isArray(row) && row[columnIndex] !== undefined ? String(row[columnIndex]) : ''));
                });
                bodyElement.appendChild(rowElement);
            });
            tableElement.appendChild(bodyElement);
            tableWrapElement.appendChild(tableElement);
            queryState.resultElement.appendChild(tableWrapElement);
        }

        queryState.hasResult = true;
        queryState.resultElement.classList.remove('hidden');
        drawTreeQueryButtons();

    }

    function applyQueryFilter(treeState) {

        const searchQuery = treeState.searchQueries.query;
        const queryStates = treeState.queryStates || [];
        let matchingCount = 0;

        queryStates.forEach(function (queryState) {
            // WHAT THE QUERY DRAWS: ITS OBJECT, KIND, NOTES AND THE TEXT IN ITS BOX NOW
            const searchText = [queryState.objectApiName, queryState.kindLabel].concat(queryState.notes).concat([String(queryState.textElement.value || '')]).join('\\n').toLowerCase();
            const isMatch = !searchQuery || searchText.indexOf(searchQuery) !== -1;
            if (isMatch) { matchingCount++; queryState.element.classList.remove('hidden'); } else { queryState.element.classList.add('hidden'); }
        });

        if (treeState.querySearch) {
            treeState.querySearch.matchCountElement.textContent = !searchQuery
                ? pluralize(queryStates.length, 'query', 'queries')
                : matchingCount > 0 ? matchingCount + ' of ' + pluralize(queryStates.length, 'query', 'queries') : 'no matches';
        }

    }

    // WHAT A SECTION SAYS IT WOULD DEPLOY, AND WHY ITS BUTTON IS DISABLED WHEN THERE IS NOTHING
    function describeDeploySummary(summary, deployKind) {

        if (!summary) { return { text: 'Reading this project…', emptyReason: 'Reading this project…' }; }
        if (summary.failureMessage) { return { text: summary.failureMessage, emptyReason: summary.failureMessage }; }

        if (deployKind === 'permissionSet') {
            return {
                text: pluralize(summary.permissionSetCount, 'permission set', 'permission sets') + ' in this project grant access to this tree.',
                emptyReason: summary.permissionSetCount === 0 ? 'No permission set in this project grants access to this tree. Generate permission set… writes one.' : ''
            };
        }

        if (deployKind === 'fields') {
            const notes = [];
            if (summary.standardFieldCount > 0) { notes.push(pluralize(summary.standardFieldCount, 'standard field', 'standard fields') + ' never deployed'); }
            if (summary.unreadableFieldCount > 0) { notes.push(pluralize(summary.unreadableFieldCount, 'custom field', 'custom fields') + ' with no readable source file'); }
            return {
                text: pluralize(summary.customFieldCount, 'CustomField', 'CustomField') + (notes.length > 0 ? '; ' + notes.join('; ') : '') + '.',
                emptyReason: summary.customFieldCount === 0 ? 'This tree has no custom field whose source file this project holds.' : ''
            };
        }

        if (deployKind === 'globalValueSets') {
            return {
                text: pluralize(summary.globalValueSetCount, 'GlobalValueSet', 'GlobalValueSet')
                    + (summary.missingGlobalValueSetCount > 0 ? '; ' + pluralize(summary.missingGlobalValueSetCount, 'named value set', 'named value sets') + ' this project does not hold' : '') + '.',
                emptyReason: summary.globalValueSetCount === 0 ? 'No field of this tree names a global value set this project holds.' : ''
            };
        }

        return {
            text: pluralize(summary.recordTypeCount, 'RecordType', 'RecordType') + '.',
            emptyReason: summary.recordTypeCount === 0 ? 'No object of this tree has a record type in this project.' : ''
        };

    }

    /*
        "Assign permission sets to me…" (#274, #302), in the Troubleshooting tab (#346). Posts the
        tree's KEY, and the index of the org the Treecipe tab has selected when it has one; with
        none the host asks for an org itself. Which permission sets are offered is the host's.
        Every assign button and insert is disabled on the click, and only the host's
        permissionSetAssignState gives them back. How it went is a VS Code notification, never a
        line here.
    */
    function buildAssignPermissionSetButton(treeState) {

        const buttonElement = createButton('secondary', 'treePermissionSets', PERMISSION_SET_ACTION_LABEL);

        buttonElement.setAttribute('title', 'Choose the permission sets in this workspace\\'s source that grant access to this tree\\'s objects and assign the ones the org selected above, or a sandbox you choose, already holds to the user that org is authorized as, after a confirmation. Nothing is deployed.');
        buttonElement.addEventListener('click', function () {
            if (isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || isScratchOrgRunning || renderedSequence === null) { return; }
            isPermissionSetAssignRunning = true;
            drawTreeInserts();
            drawDataOrgViews();
            const permissionSetMessage = { command: 'assignTreePermissionSets', treeKey: treeState.tree.treeKey };
            if (dataOrgSelectedIndex !== null) { permissionSetMessage.orgIndex = dataOrgSelectedIndex; }
            vscodeApi.postMessage(permissionSetMessage);
        });

        treeState.permissionSetButtonElement = buttonElement;

        return buttonElement;

    }

    /*
        "Generate permission set…" (#306) posts the tree's KEY alone; what is written, where, and
        the confirmation are the host's. It deploys nothing, so it needs no org and holds no
        other button.
    */
    function buildGeneratePermissionSetButton(treeState) {

        const generateButtonElement = createButton('secondary', 'treeGeneratePermissionSet', GENERATE_PERMISSION_SET_ACTION_LABEL);
        generateButtonElement.addEventListener('click', function () {
            if (generateButtonElement.disabled || renderedSequence === null) { return; }
            vscodeApi.postMessage({ command: 'generateTreePermissionSet', treeKey: treeState.tree.treeKey });
        });
        treeState.generatePermissionSetButtonElement = generateButtonElement;

        return generateButtonElement;

    }

    /*
        The Validation Rules list (#327), under "Retrieve validation rules…": per tree object, each
        rule the project holds -- its name, active or not, its error message, the fields it
        constrains and what generation did with it -- read by the host when the sub-tab first opens
        (loadValidationRules), so the posted model does not carry it. Every value is written with
        textContent, and a formula is built only when its button opens it.
    */
    function buildTroubleshootingValidationRules(treeState, subTabState) {

        subTabState.noun = ['rule', 'rules'];
        subTabState.ruleGroups = [];
        treeState.validationRuleSubTabState = subTabState;
        treeState.validationRuleListElement = createElement('div', 'validationRuleList');
        treeState.validationRuleListElement.appendChild(createElement('div', 'treeEmpty muted', VALIDATION_RULES_LOADING_NOTE));
        subTabState.listElement.appendChild(treeState.validationRuleListElement);

    }

    // ASKED ONCE PER MODEL WHEN THE SUB-TAB IS SHOWN; ONE SHOWN BEFORE THE ACK ASKS WITH THE TAB'S COUNTS ONCE IT IS
    function requestTreeValidationRules(treeState) {

        if (renderedSequence === null || treeState.isValidationRulesRequested || !treeState.validationRuleListElement) { return; }

        treeState.isValidationRulesRequested = true;
        vscodeApi.postMessage({ command: 'loadValidationRules', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });

    }

    // WHAT A RULE IS FOUND BY: ITS OBJECT AND WHAT ITS ROW DRAWS, ITS FORMULA ONLY WHILE OPEN -- NEVER A TOOLTIP
    function buildValidationRuleSearchText(objectApiName, entry) {

        const texts = [objectApiName, entry.ruleName, entry.statusLabel, entry.activeLabel, entry.messageText, entry.fieldsText]
            .concat(entry.reasonTexts);
        if (entry.isFormulaExpanded) { texts.push(entry.rule.formula); }
        return texts.join('\\n').toLowerCase();

    }

    /*
        One group per object, its rows built when it opens, and groups opened within the
        auto-expand budgets, like the TODO's sub-tab: a tree with thousands of rules costs its
        headers and the rows the budget allows. Each rule's search text is taken once from the
        posted values, so a keystroke reads no DOM.
    */
    function renderTreeValidationRules(rulesMessage) {

        if (renderedSequence === null || rulesMessage.renderSequence !== renderedSequence) { return; }

        const treeState = findTreeState(rulesMessage.treeKey);
        if (!treeState || !treeState.validationRuleListElement) { return; }

        const listElement = treeState.validationRuleListElement;
        const subTabState = treeState.validationRuleSubTabState;
        listElement.textContent = '';
        subTabState.ruleGroups = [];

        if (rulesMessage.failureMessage) {
            // ASKED AGAIN THE NEXT TIME THE SUB-TAB IS OPENED: THE READER IS LIKELY FIXING IT
            treeState.isValidationRulesRequested = false;
            listElement.appendChild(createElement('div', 'treeEmpty muted', String(rulesMessage.failureMessage)));
            applyTroubleshootingFilter(treeState, 'validationRules');
            return;
        }

        const objects = Array.isArray(rulesMessage.objects) ? rulesMessage.objects : [];
        const hasLocalRules = objects.some(function (object) {
            return (Array.isArray(object.rules) && object.rules.some(function (rule) { return !rule.isFileMissing; })) || object.unreadRuleCount > 0;
        });

        if (!hasLocalRules) {
            listElement.appendChild(createElement('div', 'validationRuleNoLocalRules muted', NO_LOCAL_VALIDATION_RULES_NOTE));
        }

        objects.forEach(function (object) {

            const rules = Array.isArray(object.rules) ? object.rules : [];
            const objectApiName = String(object.objectApiName);
            const groupState = {
                objectApiName: objectApiName,
                element: createElement('div', 'validationRuleObject'),
                toggleElement: null,
                countElement: createElement('span', 'validationRuleCount muted'),
                bodyElement: createElement('div', 'validationRuleRows hidden'),
                entries: rules.map(function (rule) { return buildValidationRuleEntryState(objectApiName, rule); }),
                matchingCount: 0,
                isBuilt: false,
                isExpanded: false,
                isShown: true
            };

            const headerElement = createElement('div', 'validationRuleObjectHeader');
            if (groupState.entries.length > 0) {
                groupState.toggleElement = buildToggleElement('validationRuleToggle');
                groupState.toggleElement.setAttribute('aria-label', 'Show or hide the validation rules of ' + objectApiName);
                groupState.toggleElement.setAttribute('aria-expanded', 'false');
                groupState.toggleElement.addEventListener('click', function () {
                    setValidationRuleGroupExpanded(treeState, groupState, !groupState.isExpanded, true);
                });
                headerElement.appendChild(groupState.toggleElement);
            }
            headerElement.appendChild(createElement('span', 'validationRuleObjectName', objectApiName));
            headerElement.appendChild(groupState.countElement);
            groupState.element.appendChild(headerElement);

            if (groupState.entries.length === 0 && !(object.unreadRuleCount > 0)) {
                groupState.element.appendChild(createElement('div', 'validationRuleEmpty muted', OBJECT_NO_VALIDATION_RULES_NOTE));
            }

            groupState.element.appendChild(groupState.bodyElement);

            if (object.unreadRuleCount > 0) {
                groupState.element.appendChild(createElement('div', 'validationRuleUnread muted', pluralize(object.unreadRuleCount, 'more rule file was', 'more rule files were') + ' not read.'));
            }

            listElement.appendChild(groupState.element);
            subTabState.ruleGroups.push(groupState);

        });

        applyTroubleshootingFilter(treeState, 'validationRules');

    }

    // WHAT ONE RULE'S ROW WILL DRAW, TAKEN FROM THE POSTED VALUES BEFORE ANY ROW IS BUILT
    function buildValidationRuleEntryState(objectApiName, rule) {

        const fieldApiNames = Array.isArray(rule.fieldApiNames) ? rule.fieldApiNames : [];
        const reasonTexts = (Array.isArray(rule.reasons) ? rule.reasons : []).map(function (reason) { return 'Why not applied: ' + String(reason); });
        if (rule.status === 'notInRun') { reasonTexts.push(VALIDATION_RULE_NOT_IN_RUN_NOTE); }
        if (rule.isFileMissing) { reasonTexts.push(VALIDATION_RULE_FILE_MISSING_NOTE); }

        const entry = {
            rule: rule,
            ruleName: String(rule.ruleName),
            statusLabel: VALIDATION_RULE_STATUS_LABELS[rule.status] || String(rule.status),
            activeLabel: rule.isActive === true ? 'active' : rule.isActive === false ? 'inactive' : '',
            messageText: typeof rule.errorMessage === 'string' && rule.errorMessage !== '' ? 'Error message: ' + rule.errorMessage : '',
            fieldsText: fieldApiNames.length > 0 ? 'Constrains: ' + fieldApiNames.map(String).join(', ') : VALIDATION_RULE_NO_FIELDS_NOTE,
            reasonTexts: reasonTexts,
            hasFormula: typeof rule.formula === 'string' && rule.formula !== '',
            isFormulaExpanded: false,
            formulaElement: null,
            searchText: '',
            isMatch: true,
            isShown: true,
            element: null
        };
        entry.searchText = buildValidationRuleSearchText(objectApiName, entry);

        return entry;

    }

    function setValidationRuleGroupExpanded(treeState, groupState, isExpanded, isAnimated) {

        if (!groupState.toggleElement) { return; }

        if (isExpanded && !groupState.isBuilt) {
            groupState.entries.forEach(function (entry) {
                entry.element = buildValidationRuleRow(treeState, groupState, entry);
                if (!entry.isMatch) { entry.element.classList.add('hidden'); }
                entry.isShown = entry.isMatch;
                groupState.bodyElement.appendChild(entry.element);
            });
            groupState.isBuilt = true;
        }

        groupState.isExpanded = isExpanded;
        setShownWithMotion(groupState.bodyElement, isExpanded, isAnimated);
        drawToggle(groupState.toggleElement, isExpanded, isAnimated);

    }

    function buildValidationRuleRow(treeState, groupState, entry) {

        const rule = entry.rule;
        const ruleElement = createElement('div', 'validationRule validationRule-' + String(rule.status));
        const headerElement = createElement('div', 'validationRuleHeader');

        headerElement.appendChild(createElement('span', 'validationRuleName', entry.ruleName));
        headerElement.appendChild(createElement('span', 'validationRuleStatus', entry.statusLabel));
        if (entry.activeLabel) { headerElement.appendChild(createElement('span', 'validationRuleActive muted', entry.activeLabel)); }
        ruleElement.appendChild(headerElement);

        if (entry.messageText) { ruleElement.appendChild(createElement('div', 'validationRuleMessage', entry.messageText)); }
        ruleElement.appendChild(createElement('div', 'validationRuleFields muted', entry.fieldsText));
        entry.reasonTexts.forEach(function (reasonText) { ruleElement.appendChild(createElement('div', 'validationRuleReason muted', reasonText)); });

        if (entry.hasFormula) {

            const toggleElement = createButton('secondary', 'validationRuleFormulaToggle', 'Show formula', 'compact');
            toggleElement.setAttribute('aria-expanded', 'false');
            toggleElement.addEventListener('click', function () {
                if (!entry.formulaElement) {
                    entry.formulaElement = createElement('div', 'validationRuleFormula hidden', rule.formula);
                    ruleElement.appendChild(entry.formulaElement);
                }
                entry.isFormulaExpanded = !entry.isFormulaExpanded;
                entry.searchText = buildValidationRuleSearchText(groupState.objectApiName, entry);
                toggleElement.textContent = entry.isFormulaExpanded ? 'Hide formula' : 'Show formula';
                toggleElement.setAttribute('aria-expanded', entry.isFormulaExpanded ? 'true' : 'false');
                setShownWithMotion(entry.formulaElement, entry.isFormulaExpanded, true);
                // A SEARCH TYPED BEFORE THE FORMULA OPENED OR CLOSED NOW MATCHES WHAT IS ON SCREEN
                applyTroubleshootingFilter(treeState, 'validationRules');
            });
            ruleElement.appendChild(toggleElement);

        }

        return ruleElement;

    }

    /*
        "Retrieve validation rules…" (#326) posts the tree's KEY alone, never an org: the host
        asks for the org in the command palette every time. One retrieve per window, so every
        card's button is disabled on the click until the host's validationRuleRetrieveState.
    */
    function buildRetrieveValidationRulesButton(treeState) {

        const retrieveButtonElement = createButton('secondary', 'treeRetrieveValidationRules', VALIDATION_RULE_RETRIEVE_ACTION_LABEL);
        retrieveButtonElement.addEventListener('click', function () {
            if (retrieveButtonElement.disabled || renderedSequence === null) { return; }
            isValidationRuleRetrieveRunning = true;
            drawTreeInserts();
            drawDataOrgViews();
            vscodeApi.postMessage({ command: 'retrieveTreeValidationRules', treeKey: treeState.tree.treeKey });
        });
        treeState.retrieveValidationRulesButtonElement = retrieveButtonElement;

        return retrieveButtonElement;

    }

    function drawTreePermissionSet(treeState) {

        if (treeState.permissionSetButtonElement) {
            treeState.permissionSetButtonElement.disabled = isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || isScratchOrgRunning;
        }

        const generateButtonElement = treeState.generatePermissionSetButtonElement;
        if (generateButtonElement) {
            const generateReason = listTreeInsertObjectApiNames(treeState).length === 0 ? 'Every object of this tree is excluded, so there is nothing to grant.'
                : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
                : isMetadataDeployRunning ? 'Metadata is being deployed.'
                : '';
            generateButtonElement.disabled = generateReason !== '';
            generateButtonElement.setAttribute('title', generateReason || 'Write a permission set granting Create and Read on this tree\\'s objects and access to its fields into this project\\'s permissionsets/SDT_Treecipe folder, after a confirmation. Nothing is deployed.');
        }

        const retrieveButtonElement = treeState.retrieveValidationRulesButtonElement;
        if (retrieveButtonElement) {
            const retrieveReason = isValidationRuleRetrieveRunning ? 'Validation rules are being retrieved.'
                : insertRunningTreeKey !== null ? 'A tree is being inserted.'
                : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
                : isMetadataDeployRunning ? 'Metadata is being deployed.'
                : '';
            retrieveButtonElement.disabled = retrieveReason !== '';
            retrieveButtonElement.setAttribute('title', retrieveReason || 'Retrieve the validation rules of this tree\\'s objects from an org you choose in the command palette into this project, after a confirmation. Nothing is deployed; Generate Treecipe then applies them.');
        }

        const deployButtons = treeState.deployButtons || {};
        Object.keys(deployButtons).forEach(function (deployKind) {

            const buttonElement = deployButtons[deployKind];
            const described = describeDeploySummary(treeState.troubleshootingSummary, deployKind);
            const busyReason = isMetadataDeployRunning ? 'Metadata is being deployed.'
                : insertRunningTreeKey !== null ? 'A tree is being inserted.'
                : isScratchOrgRunning ? 'A scratch org is being set up.'
                : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
                : isValidationRuleRetrieveRunning ? 'Validation rules are being retrieved.'
                : '';
            const deployReason = described.emptyReason || busyReason;

            treeState.deploySummaryElements[deployKind].textContent = described.text;
            buttonElement.disabled = deployReason !== '';
            buttonElement.textContent = metadataDeployRunningKey === treeState.tree.treeKey + '\\n' + deployKind ? 'Deploying…' : DEPLOY_ACTION_LABELS[deployKind];
            buttonElement.setAttribute('title', deployReason || 'Deploy these components of this tree, through a generated package.xml, to the sandbox or scratch org selected above, or one you choose, after a confirmation.');

        });

        // A RUN CHANGES WHAT AN ACTION DRAWS ("Deploying…"), SO AN OPEN SEARCH MATCHES WHAT IS ON SCREEN NOW
        if (treeState.troubleshootingSubTabStates) { applyTroubleshootingFilter(treeState, 'actions'); }

    }

    function isTreeRunning(treeKey) {
        return insertRunningTreeKey === treeKey;
    }

    function renderTrees(recipe) {

        // KEYED BY NAMES FROM THE WRAPPER ON DISK -- "__proto__" MUST BE A KEY, NOT A NEW PROTOTYPE
        const objectsByApiName = Object.create(null);
        recipe.objects.forEach(function (object) { objectsByApiName[object.objectApiName] = object; });
        recordTypeFieldsByObjectApiName = indexRecordTypeFields(recipe.objects);

        const trees = recipe.trees || [];

        if (trees.length === 0) {
            treesViewElement.appendChild(createElement('div', 'emptyState', 'This run has no relationship trees to show. Run "Generate Treecipe" again to draw its objects in relationship trees.'));
            return;
        }

        recordTypeObjects = recipe.objects.filter(function (object) { return Array.isArray(object.recordTypes) && object.recordTypes.length > 0; });
        recordTypeObjects.forEach(function (object) {
            recordTypeChoices[object.objectApiName] = (object.generatedRecordTypeDeveloperNames || []).slice();
        });

        trees.forEach(function (tree) { renderTree(tree, objectsByApiName); });

        // THE SECTION SEARCH, ITS RESULTS AND THE DROPDOWN, ABOVE THE ONE CARD DRAWN (#374)
        if (treecipesControlsElement) {
            const search = buildTreecipesSearch();
            treecipesControlsElement.appendChild(search.element);
            treecipesControlsElement.appendChild(search.resultsElement);
            treecipesControlsElement.appendChild(buildTreePicker());
        }

        noFavoritesElement = createElement('div', 'emptyState hidden', NO_FAVORITES_MESSAGE);
        treesViewElement.appendChild(noFavoritesElement);
        applyTreecipesSearch();

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
        // "Record type fields only" (#320) NARROWS WHAT THE SEARCH MATCHES: A FIELD SHOWS ONLY IF IT PASSES BOTH
        const isRecordTypeFieldsOnly = isRecordTypeFieldsOnlyIn(treeState);
        // "TODOs only" (#354) NARROWS THE SAME WAY, AND AN OBJECT'S OWN TODOS COUNT AS A MATCH SO IT STILL OPENS
        const isTodosOnly = isTodosOnlyIn(treeState);
        const isFiltered = !!searchQuery || isRecordTypeFieldsOnly || isTodosOnly;
        let totalFieldCount = 0;
        let matchingFieldCount = 0;

        drawRecordTypeFieldsToggle(treeState);
        drawTodosToggle(treeState);

        treeState.objectStates.forEach(function (treeObjectState) {

            const isObjectNameMatch = !searchQuery || treeObjectState.objectSearchText.indexOf(searchQuery) !== -1;
            let objectMatchingFieldCount = 0;

            treeObjectState.fieldStates.forEach(function (fieldState) {
                fieldState.isMatch = (!isRecordTypeFieldsOnly || fieldState.recordTypeDeveloperNames !== null)
                    && (!isTodosOnly || fieldState.todos.length > 0)
                    && (isObjectNameMatch || isFieldTextMatch(fieldState, searchQuery));
                if (fieldState.isMatch) { objectMatchingFieldCount++; }
                applyTreeFieldVisibility(fieldState);
            });

            const objectFieldCount = treeObjectState.fieldStates.length;
            const hasMatchingObjectTodos = isTodosOnly && !isRecordTypeFieldsOnly && isObjectNameMatch && treeObjectState.objectTodos.length > 0;
            treeObjectState.matchingFieldCount = objectMatchingFieldCount;
            treeObjectState.hasMatchingObjectTodos = hasMatchingObjectTodos;
            totalFieldCount += objectFieldCount;
            matchingFieldCount += objectMatchingFieldCount;

            if (!isFiltered || (isObjectNameMatch && !isRecordTypeFieldsOnly && !isTodosOnly)) {
                treeObjectState.countElement.textContent = pluralize(objectFieldCount, 'field', 'fields');
            } else if (isTodosOnly && treeObjectState.todoCount === 0) {
                treeObjectState.countElement.textContent = 'no TODOs';
            } else if (isTodosOnly && !searchQuery && !isRecordTypeFieldsOnly) {
                treeObjectState.countElement.textContent = pluralize(treeObjectState.todoCount, 'TODO', 'TODOs');
            } else if (objectMatchingFieldCount > 0) {
                treeObjectState.countElement.textContent = objectMatchingFieldCount + ' of ' + pluralize(objectFieldCount, 'field', 'fields');
            } else if (isRecordTypeFieldsOnly && treeObjectState.recordTypeFieldCount === 0) {
                treeObjectState.countElement.textContent = 'no record type fields';
            } else if (hasMatchingObjectTodos) {
                treeObjectState.countElement.textContent = pluralize(treeObjectState.objectTodos.length, 'TODO', 'TODOs') + ' on the object';
            } else {
                treeObjectState.countElement.textContent = 'no matching fields';
            }

        });

        treeState.structureSearch.matchCountElement.textContent = !isFiltered
            ? pluralize(totalFieldCount, 'field', 'fields')
            : matchingFieldCount > 0 ? matchingFieldCount + ' of ' + pluralize(totalFieldCount, 'field', 'fields') : 'no matches';

        applyRecordTypesFilter(treeState);

        if (!isFiltered) {
            treeState.objectStates.forEach(function (treeObjectState) { setTreeObjectExpanded(treeObjectState, treeObjectState.isExpandedByReader); });
            return;
        }

        expandMatchesWithinBudget(treeState.objectStates,
            function (treeObjectState) { return treeObjectState.matchingFieldCount + (treeObjectState.hasMatchingObjectTodos ? 1 : 0); },
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

        if (isDataOrgChecking) { return DATA_ORG_CONNECTION_CHECK_INSERT_REASON; }
        if (insertRunningTreeKey !== null && insertRunningTreeKey !== treeState.tree.treeKey) { return 'Another tree is being inserted.'; }
        if (isScratchOrgRunning) { return 'A scratch org is being set up.'; }
        if (isPermissionSetAssignRunning) { return 'Permission sets are being assigned.'; }
        if (isMetadataDeployRunning) { return 'Metadata is being deployed.'; }

        const insertObjectApiNames = listTreeInsertObjectApiNames(treeState);
        if (insertObjectApiNames.length === 0) { return 'Every object of this tree is excluded.'; }

        // THE ONE REASON THAT LEAVES THE BUTTON ENABLED (#375): THE CLICK ASKS FOR THE ORG
        if (dataOrgRequestSequence === null || dataOrgSelectedIndex === null) { return NO_DATA_ORG_INSERT_REASON; }
        if (dataOrgSelectionFailureMessage) { return dataOrgSelectionFailureMessage; }

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

        const tree = treeState.tree;
        const insertReason = findTreeInsertReason(treeState);
        const isOrgToChoose = insertReason === NO_DATA_ORG_INSERT_REASON;
        const orgLabel = dataOrgLabels && dataOrgSelectedIndex !== null && dataOrgLabels[dataOrgSelectedIndex] ? dataOrgLabels[dataOrgSelectedIndex] : '';
        const actionLabel = INSERT_ACTION_LABEL + (insertReason === '' && orgLabel ? ' into ' + orgLabel : '');

        insert.buttonElement.disabled = isTreeRunning(tree.treeKey) || (insertReason !== '' && !isOrgToChoose);

        insert.buttonElement.textContent = insertRunningTreeKey === tree.treeKey ? INSERT_RUNNING_LABEL : actionLabel;
        insert.buttonElement.setAttribute('aria-label', actionLabel + ' for ' + displayTitleOf(tree) + ' (' + tree.runFakerRecipeFileName + ')');
        insert.buttonElement.setAttribute('title', isOrgToChoose
            ? 'Choose the org to insert into, then generate this tree with its selection and counts from ' + tree.runFakerRecipeFileName + ' and insert it, parents first'
            : 'Generate this tree with its selection and counts from ' + tree.runFakerRecipeFileName + ', then insert it into the chosen org, parents first');
        insert.reasonElement.textContent = insertReason === '' ? '' : isOrgToChoose ? CHOOSE_INSERT_ORG_NOTE : CANNOT_INSERT_PREFIX + insertReason;

    }

    function drawTreeInserts() {
        treeStates.forEach(drawTreeInsert);
        treeStates.forEach(drawTreePermissionSet);
    }

    // THE CLICKED TREE'S BUTTON IS DISABLED ON THE CLICK AND EVERY OTHER IS DISABLED; ITS insertState GIVES THEM BACK
    function setInsertRunning(runningTreeKey) {

        insertRunningTreeKey = runningTreeKey;
        drawTreeInserts();
        drawDataOrgViews();
        drawRecordTypeChoices();

    }

    function renderPermissionSetAssignState(hostMessage) {

        isPermissionSetAssignRunning = !!hostMessage.isRunning;

        drawDataOrgViews();
        drawTreeInserts();

    }

    function renderScratchOrgState(hostMessage) {

        isScratchOrgRunning = !!hostMessage.isRunning;

        drawDataOrgViews();
        drawTreeInserts();

    }

    function renderDataOrgReadiness(dataOrgReadiness) {

        if (renderedSequence === null || dataOrgReadiness.renderSequence !== renderedSequence || dataOrgReadiness.requestSequence !== dataOrgRequestSequence) { return; }

        dataOrgReadiness.objects.forEach(function (readiness) { dataOrgReadinessByObject[readiness.objectApiName] = readiness; });
        (dataOrgReadiness.createTargets || []).forEach(function (readiness) { dataOrgReadinessByTreeObjectKey[buildTreeObjectKey(readiness.treeKey, readiness.objectApiName)] = readiness; });

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
        startDataOrgCheck();
        setDataOrgStatus(DATA_ORG_CONNECTION_CHECK_TEXT, false);
        drawTreeInserts();
        vscodeApi.postMessage({ command: 'loadDataOrgs' });

    }

    function renderDataOrgList(dataOrgList) {

        if (renderedSequence === null || dataOrgList.renderSequence !== renderedSequence) { return; }

        isDataOrgLoadShown = false;
        isDataOrgChecking = false;
        // A LIST THE HOST POSTED AFTER ASKING FOR THE ORG (#375) MAKES THE PICKER IN USE, SO A LATER MODEL LISTS AGAIN
        isDataOrgPickerInUse = true;
        clearDataOrgSelection();
        // ⟳ IS HOW A READER WHO JUST RE-AUTHORIZED AN ORG SEES IT LISTED, SO IT STAYS EVEN WITH NOTHING LISTED
        isDataOrgRefreshShown = true;

        // PRODUCTION AND ORGS THE CLI DOES NOT REPORT CONNECTED ARE NEVER LISTED, AND THE READER IS TOLD WHY ONE THEY AUTHORIZED IS MISSING
        dataOrgHiddenNoteText = [dataOrgList.forgottenOrgNotice || '', dataOrgList.hiddenOrgNote || ''].filter(Boolean).join(' ');
        dataOrgLabels = Array.isArray(dataOrgList.orgLabels) ? dataOrgList.orgLabels.slice() : [];

        // THE DROPDOWN STAYS DRAWN WITH NOTHING TO CHOOSE, SO THE PICKER DOES NOT VANISH WHEN THE CHECK FOUND NO ORG (#305)
        isDataOrgSelectShown = true;

        if (dataOrgLabels.length === 0) {
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
        dataOrgTypeLabel = null;
        drawDataOrgViews();
        drawTreeInserts();

    }

    /*
        The dropdown STAYS until the CLI answers (#305), holding only the check's own option, so
        nothing can be selected from a list being replaced. ⟳ stays usable: the host joins a check
        already in flight rather than starting a second "sf org list".
    */
    function showDataOrgConnectionCheck() {

        isDataOrgSelectShown = false;
        dataOrgHiddenNoteText = '';
        startDataOrgCheck();
        clearDataOrgSelection();
        setDataOrgStatus(DATA_ORG_CONNECTION_CHECK_TEXT, false);

    }

    function startDataOrgCheck() {

        isDataOrgChecking = true;
        isDataOrgRefreshShown = true;
        dataOrgCheckingOptionLabels = [DATA_ORG_LOADING_PLACEHOLDER];

    }

    // THE ORG CHOSEN LAST, ELSE THE CLI'S DEFAULT, SHOWN WHILE THE CHECK RUNS -- A LABEL ONLY, NEVER A SELECTION
    function renderDataOrgProvisional(dataOrgProvisional) {

        if (renderedSequence === null || dataOrgProvisional.renderSequence !== renderedSequence || !isDataOrgChecking) { return; }
        if (typeof dataOrgProvisional.orgLabel !== 'string' || !dataOrgProvisional.orgLabel) { return; }
        if (dataOrgProvisionalRequestSequence !== null && dataOrgProvisional.requestSequence < dataOrgProvisionalRequestSequence) { return; }

        dataOrgProvisionalRequestSequence = dataOrgProvisional.requestSequence;
        dataOrgCheckingOptionLabels = [dataOrgProvisional.orgLabel];
        drawDataOrgViews();

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
        holds it, whether the org picker was in use, and a scroll offset: nothing the host
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
            if (TABS_WITHOUT_SEARCH.indexOf(tabName) !== -1) { return; }
            const searchText = treeState.searchTexts[tabName] || '';
            if (OPTIONAL_SEARCH_TABS.indexOf(tabName) !== -1 && !searchText) { return; }
            searchQueries[tabName] = searchText;
            if (treeState.searchQueries[tabName]) { hasSearch = true; }
        });

        // THE TROUBLESHOOTING SUB-TAB AND ITS SEARCHES (#365): EACH ONLY WHEN IT IS NOT THE DEFAULT
        const troubleshootingSearchQueries = {};
        let hasTroubleshootingSearch = false;
        TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {
            const searchText = treeState.searchTexts[troubleshootingSearchKey(subTab)] || '';
            if (!searchText) { return; }
            troubleshootingSearchQueries[subTab] = searchText;
            hasTroubleshootingSearch = true;
        });
        const troubleshootingSubTab = TROUBLESHOOTING_SUB_TABS.indexOf(treeState.troubleshootingSubTab) > 0 ? treeState.troubleshootingSubTab : null;
        if (hasTroubleshootingSearch || troubleshootingSubTab) { hasSearch = true; }

        const selectedTab = treeState.selectedTab || 'treecipe';

        if (selectedTab === 'treecipe' && !hasSearch && !treeState.isDatasetFavoritesOnly && !treeState.isRecordTypesExpanded
                && !isRecordTypeFieldsOnlyIn(treeState) && !isTodosOnlyIn(treeState) && expandedObjectKeys.length === 0 && openPicklistKeys.length === 0) {
            return null;
        }

        const treePlace = {
            treeKey: treeState.tree.treeKey,
            isExpanded: treeState.tree.treeKey === selectedTreeKey,
            selectedTab: selectedTab,
            searchQueries: searchQueries,
            expandedObjectKeys: expandedObjectKeys,
            openPicklistKeys: openPicklistKeys
        };

        if (treeState.isDatasetFavoritesOnly) { treePlace.isDatasetFavoritesOnly = true; }
        if (treeState.isRecordTypesExpanded) { treePlace.isRecordTypesExpanded = true; }
        if (isRecordTypeFieldsOnlyIn(treeState)) { treePlace.isRecordTypeFieldsOnly = true; }
        if (isTodosOnlyIn(treeState)) { treePlace.isTodosOnly = true; }
        if (troubleshootingSubTab) { treePlace.troubleshootingSubTab = troubleshootingSubTab; }
        if (hasTroubleshootingSearch) { treePlace.troubleshootingSearchQueries = troubleshootingSearchQueries; }

        return treePlace;

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

        const panelPlace = {
            version: PANEL_PLACE_VERSION,
            runFolderName: renderedRunFolderName,
            isOrgPickerInUse: isDataOrgPickerInUse,
            isFavoritesOnly: isFavoritesOnly,
            scrollY: typeof window.scrollY === 'number' ? window.scrollY : 0,
            trees: treeStates.map(buildTreePlace).filter(Boolean)
        };
        if (isHelpExpanded) { panelPlace.isHelpExpanded = true; }
        // THE FIRST CARD IS WHERE A PLACE WITHOUT ONE OPENS, SO ONLY ANOTHER CARD IS WRITTEN
        if (typeof selectedTreeKey === 'string' && treeStates.length > 0 && treeStates[0].tree.treeKey !== selectedTreeKey) { panelPlace.selectedTreeKey = selectedTreeKey; }
        if (treecipesSearchText) { panelPlace.treecipesSearchText = treecipesSearchText; }

        return panelPlace;

    }

    /*
        A reload in the same document (#225) -- Generate, Create, Add friend -- redraws every card
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
                const upgradedTree = Object.assign({}, savedTree, {
                    selectedTab: isRemovedTab(selectedTab) ? 'treecipe' : selectedTab,
                    searchQueries: searchQueries
                });
                // A CARD SAVED ON THE RECORD TYPES TAB, BEFORE IT BECAME A SECTION (#321), OPENS WITH THE SECTION EXPANDED
                if (selectedTab === 'recordTypes') { upgradedTree.isRecordTypesExpanded = true; }
                return upgradedTree;
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
        if (savedPlace) { isHelpExpanded = savedPlace.isHelpExpanded === true; }
        // THE CARD AND THE SECTION SEARCH (#374) ARE THE PLACE'S: ANOTHER RUN, OR NO PLACE, OPENS ON THE FIRST CARD WITH NO SEARCH
        selectedTreeKey = savedPlace && typeof savedPlace.selectedTreeKey === 'string' ? savedPlace.selectedTreeKey : null;
        treecipesSearchText = savedPlace && typeof savedPlace.treecipesSearchText === 'string' ? savedPlace.treecipesSearchText : '';

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
                if (TABS_WITHOUT_SEARCH.indexOf(tabName) !== -1) { return; }
                const savedQuery = Object.prototype.hasOwnProperty.call(savedSearchQueries, tabName) ? savedSearchQueries[tabName] : '';
                if (typeof savedQuery === 'string') {
                    treeState.searchTexts[tabName] = savedQuery;
                    treeState.searchQueries[tabName] = savedQuery.trim().toLowerCase();
                }
            });

            // THE TROUBLESHOOTING SUB-TAB AND ITS SEARCHES (#365), READ BEFORE THE TAB IS BUILT; AN UNKNOWN SUB-TAB READS AS THE FIRST
            const savedSubTabQueries = savedTree.troubleshootingSearchQueries && typeof savedTree.troubleshootingSearchQueries === 'object' ? savedTree.troubleshootingSearchQueries : {};
            TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {
                const savedQuery = Object.prototype.hasOwnProperty.call(savedSubTabQueries, subTab) ? savedSubTabQueries[subTab] : '';
                const searchKey = troubleshootingSearchKey(subTab);
                treeState.searchTexts[searchKey] = typeof savedQuery === 'string' ? savedQuery : '';
                treeState.searchQueries[searchKey] = treeState.searchTexts[searchKey].trim().toLowerCase();
            });
            treeState.troubleshootingSubTab = TROUBLESHOOTING_SUB_TABS.indexOf(savedTree.troubleshootingSubTab) !== -1 ? savedTree.troubleshootingSubTab : TROUBLESHOOTING_SUB_TABS[0];

            // BEFORE THE DATA SETS TAB IS BUILT, WHICH APPLIES IT; A TAB ALREADY BUILT APPLIES IT NOW
            treeState.isDatasetFavoritesOnly = savedTree.isDatasetFavoritesOnly === true;
            if (treeState.datasetRowStates) { applyDatasetsFilter(treeState); }

            // APPLIED BY THE applyStructureFilter BELOW, OR BY THE TREECIPE TAB WHEN IT IS BUILT
            treeState.isRecordTypeFieldsOnly = savedTree.isRecordTypeFieldsOnly === true;
            treeState.isTodosOnly = savedTree.isTodosOnly === true;

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

            if (savedTree.isRecordTypesExpanded === true) {
                ensureTreeBodyBuilt(treeState);
                setRecordTypesExpanded(treeState, true, false);
            }

            // A CARD NO LONGER FOLDS (#374): THE ONE ON SCREEN IS THE DROPDOWN'S, SO A SAVED isExpanded IS IGNORED
            // THE CARD ON SCREEN WAS BUILT WITH AN EMPTY BOX, SO IT SHOWS THE RESTORED SEARCH NOW
            if (treeState.structureSearch) { treeState.structureSearch.inputElement.value = treeState.searchTexts.treecipe; }

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

        const trees = recipe.trees || [];

        // A RUN WITH NO TREES SAYS SO, WITH NO SECTION AROUND THE NOTICE AND NO ORG TO PICK FOR NOTHING
        if (trees.length === 0) {
            cockpitBodyElement.appendChild(treesViewElement);
            renderTrees(recipe);
            return;
        }

        // ONLY WHEN SOME CARD CAN GENERATE: WITH NOTHING TO GENERATE THERE IS NOTHING TO PICK AN ORG FOR
        if (trees.some(function (tree) { return !!tree.runFakerRecipeFileName; })) {
            orgSection = buildStaticCockpitSection('cockpitOrgSection', ORG_SECTION_TITLE);
            orgSection.bodyElement.appendChild(buildDataOrgView().element);
            cockpitBodyElement.appendChild(orgSection.element);
        }

        const treecipesSection = buildStaticCockpitSection('cockpitTreecipesSection', TREECIPES_SECTION_TITLE);
        treecipesControlsElement = createElement('div', 'treecipesControls');
        treecipesSection.bodyElement.appendChild(treecipesControlsElement);
        treecipesSection.bodyElement.appendChild(treesViewElement);
        cockpitBodyElement.appendChild(treecipesSection.element);

        renderTrees(recipe);

    }

    // THE TARGET ORG MANAGEMENT (#355) AND TREECIPES (#364) SECTIONS: A HEADER AND A BODY, WITH NO TOGGLE AND NO LISTENER
    function buildStaticCockpitSection(sectionId, title) {

        const sectionElement = createElement('section', 'cockpitSection');
        const headerElement = createElement('div', 'cockpitSectionHeader cockpitSectionStatic');
        const bodyElement = createElement('div', 'cockpitSectionBody');

        sectionElement.setAttribute('id', sectionId);
        sectionElement.setAttribute('aria-label', title);
        bodyElement.setAttribute('id', sectionId + 'Body');
        headerElement.appendChild(createElement('span', 'cockpitSectionTitle', title));
        sectionElement.appendChild(headerElement);
        sectionElement.appendChild(bodyElement);

        return { element: sectionElement, bodyElement: bodyElement };

    }

    // EVERYTHING ONE MODEL'S DRAW HELD, DROPPED BEFORE THE NEXT DRAW OR A FAILURE NOTICE REPLACES IT
    function resetPanelState() {

        cockpitBodyElement.textContent = '';
        // THE HOST ANSWERS AN OPEN CONFIRMATION CANCEL WHEN IT POSTS A NEW MODEL, AND A FAILURE TO DRAW ENDS IT TOO
        closeConfirmDialog(false);
        disableHelpToggle();
        helpSectionElement = null;
        helpSummaryElement = null;
        helpTrees = [];
        treeStates = [];
        treesViewElement = null;
        orgSection = null;
        dataOrgViews = [];
        dataOrgLabels = null;
        isDataOrgLoadShown = true;
        isDataOrgSelectShown = false;
        isDataOrgRefreshShown = false;
        isDataOrgChecking = false;
        dataOrgCheckingOptionLabels = [];
        dataOrgProvisionalRequestSequence = null;
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
        pendingPicklistValueElements = Object.create(null);
        recordTypeChoices = Object.create(null);
        recordTypeObjects = [];
        recordTypeFieldsByObjectApiName = Object.create(null);
        recordTypeRowStates = [];
        recordTypeButtonElements = [];
        isRecordTypeRegenerating = false;
        isRecordTypeSelectionRemembered = false;
        recordTypeRememberElements = [];
        pendingDatasetCountElements = Object.create(null);
        answeredDatasetCounts = Object.create(null);
        fieldSearchTexts = new Map();
        addFriendButtonElements = [];
        wireLookupButtonElements = [];
        runSelectElement = null;
        treecipesControlsElement = null;
        treePickerElement = null;
        treePickerTreeStates = [];
        treecipesSearch = null;
        treecipesSearchIndex = null;
        treecipesMatchedTreeKeys = null;
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
            // AND A FOCUS THAT SCROLLED TO A ROW IS NOT SCROLLED BACK TO THE OFFSET THE PLACE SAVED
            const hasFocusScrolled = applyTreeFocus(focusTree) === true;
            if (!hasFocusScrolled) { restoreScroll(savedPlace); }
            // A TROUBLESHOOTING TAB SELECTED BEFORE THE ACK (#346) ASKS FOR ITS COUNTS NOW
            treeStates.forEach(function (treeState) { if (treeState.isTroubleshootingSummaryWanted) { requestTroubleshootingSummary(treeState); } });
            // AND A QUERY TAB'S QUERIES (#367)
            treeStates.forEach(function (treeState) { if (treeState.isTreeQueriesWanted) { requestTreeQueries(treeState); } });
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
        const generateButtonElement = createButton('primary', 'generateTreecipe', GENERATE_TREECIPE_ACTION_LABEL);

        generateButtonElement.addEventListener('click', function () {
            generateButtonElement.disabled = true;
            generateButtonElement.textContent = GENERATE_TREECIPE_RUNNING_LABEL;
            vscodeApi.postMessage({ command: 'generateTreecipe' });
        });

        generateElement.appendChild(generateButtonElement);

        return generateElement;

    }

    /*
        A confirmation the HOST asked for (#349), drawn over the cockpit in place of VS Code's modal.
        Every string is the host's and goes through textContent; the panel answers only with the
        index of a button it was given (null is Cancel), under the id it was asked with. A request
        for a model that is not the one on screen is answered Cancel without being drawn. Focus moves
        into the dialog and stays there, Escape is Cancel, and focus goes back to what opened it.
    */
    function renderConfirmRequest(hostMessage) {

        const confirmationId = hostMessage.confirmationId;
        if (typeof confirmationId !== 'string' || !confirmationId) { return; }

        const lines = Array.isArray(hostMessage.lines) ? hostMessage.lines.filter(function (line) { return typeof line === 'string'; }) : null;
        const buttonLabels = Array.isArray(hostMessage.buttons) ? hostMessage.buttons.filter(function (label) { return typeof label === 'string' && !!label; }) : null;

        if (hostMessage.renderSequence !== renderedSequence || typeof hostMessage.title !== 'string' || !lines || !buttonLabels || buttonLabels.length === 0) {
            vscodeApi.postMessage({ command: 'confirmResponse', confirmationId: confirmationId, choice: null });
            return;
        }

        // THE HOST ANSWERED AN OPEN ONE CANCEL BEFORE ASKING AGAIN; THE NEW ONE TAKES ITS PLACE
        const openerElement = confirmDialog ? confirmDialog.openerElement : document.activeElement;
        closeConfirmDialog(false);

        const isDestructive = hostMessage.isDestructive === true;
        const overlayElement = createElement('div', 'confirmOverlay');
        const dialogElement = createElement('div', 'confirmDialog');
        const titleElement = createElement('h2', 'confirmTitle', hostMessage.title);
        const bodyElement = createElement('div', 'confirmBody');
        const actionsElement = createElement('div', 'confirmActions');

        titleElement.setAttribute('id', 'confirmTitle');
        bodyElement.setAttribute('id', 'confirmBody');
        // THE BODY SCROLLS, SO A KEYBOARD READER CAN REACH IT TO SCROLL IT
        bodyElement.setAttribute('tabindex', '0');
        dialogElement.setAttribute('role', isDestructive ? 'alertdialog' : 'dialog');
        dialogElement.setAttribute('aria-modal', 'true');
        dialogElement.setAttribute('aria-labelledby', 'confirmTitle');
        dialogElement.setAttribute('aria-describedby', 'confirmBody');

        lines.forEach(function (line) {
            if (line.trim() === '') {
                bodyElement.appendChild(createElement('div', 'confirmGap'));
                return;
            }
            const isListItem = /^\\s*([-•]|\\u2026and )/.test(line);
            bodyElement.appendChild(createElement('div', isListItem ? 'confirmLine confirmListItem' : 'confirmLine', line));
        });

        const buttonElements = buttonLabels.map(function (label, labelIndex) {
            const buttonElement = createButton(labelIndex === 0 ? 'primary' : 'secondary', 'confirmChoice', label);
            buttonElement.addEventListener('click', function () { answerConfirm(labelIndex); });
            return buttonElement;
        });
        const cancelElement = createButton('secondary', 'confirmCancel', 'Cancel');
        cancelElement.addEventListener('click', function () { answerConfirm(null); });

        buttonElements.forEach(function (buttonElement) { actionsElement.appendChild(buttonElement); });
        actionsElement.appendChild(cancelElement);

        dialogElement.appendChild(titleElement);
        dialogElement.appendChild(bodyElement);
        dialogElement.appendChild(actionsElement);
        overlayElement.appendChild(dialogElement);

        const focusableElements = [bodyElement].concat(buttonElements, [cancelElement]);

        dialogElement.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (typeof event.preventDefault === 'function') { event.preventDefault(); }
                answerConfirm(null);
                return;
            }
            if (event.key !== 'Tab') { return; }
            const currentIndex = focusableElements.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
                : (currentIndex === -1 || currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            focusElement(focusableElements[nextIndex]);
        });

        // A PRESS ON THE BACKDROP WOULD MOVE FOCUS OUT OF THE DIALOG, WHERE TAB IS NO LONGER KEPT INSIDE IT
        overlayElement.addEventListener('mousedown', function (event) {
            if (event.target === overlayElement && typeof event.preventDefault === 'function') { event.preventDefault(); }
        });

        // THE REST OF THE COCKPIT IS OUT OF REACH WHILE THE DIALOG IS OPEN
        [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
            if (backgroundElement) { backgroundElement.setAttribute('inert', ''); }
        });

        if (!isMotionReduced()) { dialogElement.classList.add('motionReveal'); }
        cockpitDialogHostElement.appendChild(overlayElement);

        confirmDialog = { confirmationId: confirmationId, overlayElement: overlayElement, openerElement: openerElement };

        // AN ACTION WITH NO UNDO STARTS ON CANCEL
        focusElement(isDestructive ? cancelElement : buttonElements[0]);

    }

    function answerConfirm(choice) {

        if (!confirmDialog) { return; }
        vscodeApi.postMessage({ command: 'confirmResponse', confirmationId: confirmDialog.confirmationId, choice: choice });
        closeConfirmDialog(true);

    }

    // A DIALOG CLOSED WITHOUT AN ANSWER IS ONE THE HOST ALREADY ANSWERED CANCEL: A NEW MODEL, A FAILURE TO DRAW OR A NEWER REQUEST
    function closeConfirmDialog(isFocusReturned) {

        if (!confirmDialog) { return; }

        const openerElement = confirmDialog.openerElement;
        cockpitDialogHostElement.textContent = '';
        confirmDialog = null;

        [cockpitBodyElement, cockpitMetaElement, loadStatusElement].forEach(function (backgroundElement) {
            if (backgroundElement) { backgroundElement.removeAttribute('inert'); }
        });

        if (isFocusReturned && openerElement && !openerElement.disabled) { focusElement(openerElement); }

    }

    function focusElement(element) {
        if (element && typeof element.focus === 'function') { element.focus(); }
    }

    /*
        The version, the CHANGELOG link and ? at the top right (#333, #350), drawn once beside the
        title and outside the body, so every load, empty state and failure to draw keeps them. The
        version arrives from the host and is written as text; the link posts no address -- the host
        owns it. ? toggles the help section a render draws in the body, and is disabled while there
        is none: before the first model, and after a failure to draw.
    */
    function renderCockpitMeta() {

        if (!cockpitMetaElement) { return; }

        cockpitVersionElement = createElement('span', 'cockpitVersion', '');

        const changelogElement = createButton('icon', 'cockpitChangelog');
        const glyphElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');

        changelogElement.setAttribute('type', 'button');
        changelogElement.setAttribute('aria-label', CHANGELOG_LINK_LABEL);
        changelogElement.setAttribute('title', CHANGELOG_LINK_LABEL);
        glyphElement.setAttribute('class', 'githubGlyph');
        glyphElement.setAttribute('viewBox', GITHUB_GLYPH_VIEW_BOX);
        glyphElement.setAttribute('aria-hidden', 'true');
        glyphElement.setAttribute('focusable', 'false');
        pathElement.setAttribute('d', GITHUB_GLYPH_PATH);
        glyphElement.appendChild(pathElement);
        changelogElement.appendChild(glyphElement);

        changelogElement.addEventListener('click', function () {
            vscodeApi.postMessage({ command: 'openChangelog' });
        });

        // STILL A PRIMARY BUTTON, AS IT WAS IN THE TOOLBAR (#363)
        helpToggleElement = createButton('primary', 'helpToggle', HELP_TOGGLE_LABEL);
        helpToggleElement.setAttribute('aria-label', HELP_TOGGLE_ARIA_LABEL);
        helpToggleElement.setAttribute('title', HELP_TOGGLE_ARIA_LABEL);
        helpToggleElement.addEventListener('click', function () {
            if (!helpSectionElement) { return; }
            setHelpExpanded(!isHelpExpanded, true);
            savePanelPlace();
        });
        disableHelpToggle();

        cockpitMetaElement.appendChild(cockpitVersionElement);
        cockpitMetaElement.appendChild(changelogElement);
        cockpitMetaElement.appendChild(helpToggleElement);

    }

    function disableHelpToggle() {

        if (!helpToggleElement) { return; }
        helpToggleElement.disabled = true;
        helpToggleElement.removeAttribute('aria-expanded');
        helpToggleElement.removeAttribute('aria-controls');

    }

    function renderExtensionInfo(hostMessage) {

        if (!cockpitVersionElement) { return; }
        cockpitVersionElement.textContent = typeof hostMessage.version === 'string' && hostMessage.version ? 'v' + hostMessage.version : '';

    }

    renderCockpitMeta();

    window.addEventListener('message', function (hostMessageEvent) {

        const hostMessage = hostMessageEvent && hostMessageEvent.data;
        if (!hostMessage) { return; }

        if (hostMessage.command === 'extensionInfo') {
            renderExtensionInfo(hostMessage);
            return;
        }

        if (hostMessage.command === 'confirmRequest') {
            renderConfirmRequest(hostMessage);
            return;
        }

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

        if (hostMessage.command === 'dataOrgProvisional') {
            renderDataOrgProvisional(hostMessage);
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

        if (hostMessage.command === 'recordTypeRegenerateState') {
            isRecordTypeRegenerating = !!hostMessage.isRunning;
            drawRecordTypeChoices();
            return;
        }

        if (hostMessage.command === 'addFriendState') {
            setAddFriendRunning(!!hostMessage.isRunning);
            return;
        }

        if (hostMessage.command === 'wireLookupState') {
            setWireLookupRunning(!!hostMessage.isRunning);
            return;
        }

        if (hostMessage.command === 'treePreferences') {
            renderTreePreferences(hostMessage);
            return;
        }

        if (hostMessage.command === 'datasetPreferences') {
            renderDatasetPreferences(hostMessage);
            return;
        }

        if (hostMessage.command === 'objectSelection') {
            renderObjectSelection(hostMessage);
            return;
        }

        if (hostMessage.command === 'fieldEditResult') {
            renderFieldEditResult(hostMessage);
            return;
        }

        if (hostMessage.command === 'scratchOrgState') {
            renderScratchOrgState(hostMessage);
            return;
        }

        if (hostMessage.command === 'permissionSetAssignState') {
            renderPermissionSetAssignState(hostMessage);
            return;
        }

        if (hostMessage.command === 'metadataDeployState') {
            isMetadataDeployRunning = !!hostMessage.isRunning;
            metadataDeployRunningKey = isMetadataDeployRunning ? hostMessage.treeKey + '\\n' + hostMessage.deployKind : null;
            drawTreeInserts();
            drawDataOrgViews();
            return;
        }

        if (hostMessage.command === 'troubleshootingSummary') {
            renderTroubleshootingSummary(hostMessage);
            return;
        }

        if (hostMessage.command === 'treeQueries') {
            renderTreeQueries(hostMessage);
            return;
        }

        if (hostMessage.command === 'treeValidationRules') {
            renderTreeValidationRules(hostMessage);
            return;
        }

        if (hostMessage.command === 'treeQueryState') {
            isTreeQueryRunning = !!hostMessage.isRunning;
            drawTreeQueryButtons();
            return;
        }

        if (hostMessage.command === 'treeQueryResult') {
            renderTreeQueryResult(hostMessage);
            return;
        }

        if (hostMessage.command === 'validationRuleRetrieveState') {
            isValidationRuleRetrieveRunning = !!hostMessage.isRunning;
            drawTreeInserts();
            drawDataOrgViews();
            return;
        }

        if (hostMessage.command === 'orgOpenState') {
            isOrgOpenRunning = !!hostMessage.isRunning;
            drawDataOrgViews();
            return;
        }

        if (hostMessage.command === 'datasetAdded') {
            renderDatasetAdded(hostMessage);
            return;
        }

        if (hostMessage.command === 'focusTree') {
            // A FAILED INSERT'S "Open Troubleshooting" (#375), ON THE MODEL ON SCREEN ONLY
            if (renderedSequence !== null && hostMessage.renderSequence === renderedSequence) { focusTreeInPlace(hostMessage.focusTree); }
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
