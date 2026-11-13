import type { RecipeCockpitTroubleshootingAction } from './RecipeCockpitPanelConstants';

/*
    What the Troubleshooting tab's panel modules draw with (#639): its sub-tabs, deploy and retrieve
    actions, TODO lists, validation rules and History. Its imports are type-only and from files that
    import nothing, so a panel module can import it and the bundle pulls in no host code.
    RecipeCockpitService.ts re-exports every name; the deploy, retrieve and run history modules
    import their kind and status unions from here.
*/

// THE KINDS A TREE'S DEPLOYS AND RETRIEVES COME IN (#346, #382), AND HOW A HISTORY ROW ENDED (#485)
export type MetadataDeployKind = 'permissionSet' | 'fields' | 'globalValueSets' | 'recordTypes';
export type MetadataRetrieveKind = 'validationRules' | 'fields' | 'recordTypes' | 'globalValueSets';
export type RunHistoryOutcome = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unknown';
export type RunHistoryRowStatus = RunHistoryOutcome | 'unreadable' | 'unrecorded';

/*
    Why a TODO cannot be removed (#391): RecipeCockpitRecipeWriter's RecipeTodoRemoveLock, and an
    occurrence no nickname tells apart, which a restore could not find again. Spelled out rather than
    imported, since the panel's stricter checks would reach into the writer (#639);
    RecipeCockpitService.ts fails to compile if the two drift apart.
*/
export type RecipeCockpitTodoRemoveLock = 'field-value' | 'record-type-options' | 'commented-out-marker' | 'scalar-content' | 'indistinct-occurrence';

// THE TODO'S SUB-TAB'S TWO LISTS (#391): THE TODOS IN THE RECIPE, AND THE ONES THE READER REMOVED
export type RecipeCockpitTodosView = 'open' | 'removed';

export const RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL = 'Assign permission sets to me…';

export const RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL = 'Generate permission set…';

export const RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL = 'Retrieve validation rules…';

/*
    The Troubleshooting tab's other retrieves (#382): each section's own 📥 card, posting its tree's
    KEY and nothing else. Every one asks for the org in the command palette, as #326's does.
*/
export const RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS: Readonly<Record<MetadataRetrieveKind, string>> = Object.freeze({
    validationRules: RECIPE_COCKPIT_VALIDATION_RULE_RETRIEVE_ACTION_LABEL,
    fields: 'Retrieve fields…',
    recordTypes: 'Retrieve record types…',
    globalValueSets: 'Retrieve global value sets…'
});

export const RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND: Readonly<Record<MetadataRetrieveKind, string>> = Object.freeze({
    validationRules: 'retrieveTreeValidationRules',
    fields: 'retrieveTreeFields',
    recordTypes: 'retrieveTreeRecordTypes',
    globalValueSets: 'retrieveTreeGlobalValueSets'
});

/*
    The Troubleshooting tab's deploys (#346): each section's own button, its confirmation, and what a
    deploy says when another run holds the window. The org is the Treecipe tab's selection or one
    picked from the same non-production list, and must answer that it is a sandbox.
*/
export const RECIPE_COCKPIT_DEPLOY_ACTION_LABELS: Readonly<Record<MetadataDeployKind, string>> = Object.freeze({
    permissionSet: 'Deploy permission set…',
    fields: 'Deploy fields & dependencies…',
    globalValueSets: 'Deploy global value sets…',
    recordTypes: 'Deploy record types…'
});

export const RECIPE_COCKPIT_RETRIEVE_ACTION_BY_KIND: Readonly<Record<MetadataRetrieveKind, RecipeCockpitTroubleshootingAction>> = Object.freeze({
    validationRules: 'retrieveValidationRules',
    fields: 'retrieveFields',
    recordTypes: 'retrieveRecordTypes',
    globalValueSets: 'retrieveGlobalValueSets'
});

export const RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND: Readonly<Record<MetadataDeployKind, RecipeCockpitTroubleshootingAction>> = Object.freeze({
    permissionSet: 'deployPermissionSet',
    fields: 'deployFields',
    globalValueSets: 'deployGlobalValueSets',
    recordTypes: 'deployRecordTypes'
});

export const RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND: Readonly<Record<MetadataDeployKind, string>> = Object.freeze({
    permissionSet: 'deployTreePermissionSet',
    fields: 'deployTreeFields',
    globalValueSets: 'deployTreeGlobalValueSets',
    recordTypes: 'deployTreeRecordTypes'
});

export const RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL = 'Troubleshooting';

/*
    The Troubleshooting tab's sub-tabs (#365), left to right; the first is selected until the reader
    picks another, which the place keeps. Each has its own search box. Only the selected one is
    shown, so the tab draws one area at a time.
*/
export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS = ['todos', 'fields', 'permissions', 'validationRules', 'recordTypes', 'globalValueSets', 'history'] as const;

export type RecipeCockpitTroubleshootingSubTab = typeof RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS[number];

export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS: Readonly<Record<RecipeCockpitTroubleshootingSubTab, string>> = Object.freeze({
    todos: 'TODO\'s',
    fields: 'Fields',
    permissions: 'Permissions',
    validationRules: 'Validation Rules',
    recordTypes: 'Record Types',
    globalValueSets: 'Global Value Sets',
    history: 'History'
});

export const RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS: Readonly<Record<RecipeCockpitTroubleshootingSubTab, string>> = Object.freeze({
    todos: 'Search TODOs by object, field or text',
    fields: 'Search field actions',
    permissions: 'Search permission set actions',
    validationRules: 'Search validation rules by object, rule, field or message',
    recordTypes: 'Search record type actions',
    globalValueSets: 'Search global value set actions',
    history: 'Search history by step, org, outcome, run or file'
});

export const RECIPE_COCKPIT_NO_TREE_TODOS_NOTE = 'No TODO comments in this tree\'s recipe.';

/*
    The History sub-tab (#485): one table of the tree's Troubleshooting steps, its columns, what each
    row's outcome says, and its notes. The panel imports them (#639) and writes
    each with textContent. Every column but Files sorts.
*/
export const RECIPE_COCKPIT_HISTORY_COLUMNS = [
    { key: 'time', label: 'Time' },
    { key: 'step', label: 'Step' },
    { key: 'org', label: 'Org' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'run', label: 'Run' },
    { key: 'files', label: 'Files' }
] as const;

export const RECIPE_COCKPIT_HISTORY_SORT_COLUMNS = ['time', 'step', 'org', 'outcome', 'run'] as const;

export type RecipeCockpitHistorySortColumn = typeof RECIPE_COCKPIT_HISTORY_SORT_COLUMNS[number];

export const RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY: Readonly<Record<RunHistoryRowStatus, { emoji: string; label: string }>> = {
    succeeded: { emoji: '✅', label: 'Succeeded' },
    partial: { emoji: '⚠️', label: 'Partly succeeded' },
    failed: { emoji: '❌', label: 'Failed' },
    cancelled: { emoji: '🚫', label: 'Cancelled' },
    unknown: { emoji: '❔', label: 'Outcome unknown' },
    unreadable: { emoji: '❗', label: 'Summary unreadable' },
    unrecorded: { emoji: '➖', label: 'Not recorded' }
};

export const RECIPE_COCKPIT_HISTORY_LOADING_NOTE = 'Reading this tree\'s history…';

export const RECIPE_COCKPIT_HISTORY_EMPTY_NOTE = 'No Troubleshooting step has been run for this tree yet. Each deploy, retrieve, permission set assignment and Generate permission set is listed here once it has run.';

export const RECIPE_COCKPIT_HISTORY_UNRECORDED_NOTE = 'This step ran before Treecipe recorded how a step ended, so only its time and files are known.';

export const RECIPE_COCKPIT_HISTORY_UNREADABLE_NOTE = 'This step\'s summary file could not be read, so how it ended is not shown.';

/*
    The TODO's sub-tab's Open and Removed lists (#391), and why a TODO's Remove TODO is disabled.
    The panel imports them (#639) and writes each with textContent.
*/
export const RECIPE_COCKPIT_TODOS_VIEWS: readonly RecipeCockpitTodosView[] = Object.freeze(['open', 'removed'] as RecipeCockpitTodosView[]);

export const RECIPE_COCKPIT_TODOS_VIEW_LABELS: Readonly<Record<RecipeCockpitTodosView, string>> = Object.freeze({ open: 'Open', removed: 'Removed' });

export const RECIPE_COCKPIT_REMOVED_TODOS_PLACEHOLDER = 'Search removed TODOs by object, field or text';

export const RECIPE_COCKPIT_NO_REMOVED_TODOS_NOTE = 'No TODO has been removed from this tree\'s recipe. Remove TODO on an open TODO moves it here, and Restore puts it back.';

export const RECIPE_COCKPIT_TODO_REMOVE_LABEL = 'Remove TODO';

export const RECIPE_COCKPIT_TODO_RESTORE_LABEL = 'Restore';

export const RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS: Readonly<Record<RecipeCockpitTodoRemoveLock, string>> = Object.freeze({
    'field-value': 'This TODO is the field\'s whole value: removing it would leave the field empty. Edit or untick the field in the Treecipe tab instead.',
    'record-type-options': 'The Recipe Cockpit and Run Faker read this line to find the field\'s record type sections, so it stays.',
    'commented-out-marker': 'This line is the Recipe Cockpit\'s marker for a commented-out field, which restoring the field needs.',
    'scalar-content': 'This line is inside the field\'s multi-line value, where YAML reads it as part of the value rather than a comment, so it stays.',
    'indistinct-occurrence': 'This object is written more than once without a nickname that tells this one apart, so the TODO could not be put back in the same place.'
});

export const RECIPE_COCKPIT_TODO_REFERENCE_LOOKUP_REASON = 'This TODO is the lookup\'s whole value: removing it would leave the lookup empty. In the Treecipe tab, give it a record Id with its pencil or wire it to a parent instead.';

export const RECIPE_COCKPIT_TODO_OTHER_RECIPE_REASON = 'This TODO is in another recipe file than this tree\'s, so it can be removed only from that tree\'s card.';

export const RECIPE_COCKPIT_TODO_NO_RECIPE_REASON = 'This tree has no single recipe file to write, so its TODOs cannot be removed here.';

/*
    The Validation Rules sub-tab's list (#327): what each rule's status reads as, and the notes the
    list draws. The panel imports them (#639) and writes each with textContent.
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

export const RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LIST_LINK_LABEL = '↗ xml';

export const RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX = 'Open the validation rule file of';

export const RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE = 'This run recorded the rule, and its file is no longer in this project.';

export const RECIPE_COCKPIT_VALIDATION_RULE_NO_FIELDS_NOTE = 'Constrains no field this run read.';

// WHAT A TODO's ENTRY SAYS FOR A FIELD TODO WHOSE TEXT THE PANEL COULD NOT FIND IN THE FIELD'S VALUE
export const RECIPE_COCKPIT_TODO_IN_FIELD_VALUE_LABEL = 'TODO in this field\'s value';

export const RECIPE_COCKPIT_DATASET_INSERT_RUNNING_REASON = 'A data set is being inserted.';

// THE ASSIGN PERMISSION SETS CARD'S TITLE (#274): WHAT IT ASKS FOR, AND WHERE IT ASSIGNS THEM
export const RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE = "Choose the permission sets in this workspace's source that grant access to this tree's objects and assign the ones the org selected above, or a sandbox you choose, already holds to the user that org is authorized as, after a confirmation. Nothing is deployed.";
