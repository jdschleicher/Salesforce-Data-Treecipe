import type { RunHistoryRowStatus } from './RecipeCockpitTroubleshootingConstants';

/*
    What the Previously Used Data Sets tab's panel modules draw with (#642): a data set row's name,
    star, record types, newest insert and insert journey. It imports only a type from a host-free
    file, so the panel bundle can import it; RecipeCockpitService.ts re-exports every name. The
    favourite, insert-running and connection-check words are also drawn by code still in the panel
    script, which the shell passes them to.
*/

/*
    How an insert ended (#469): DatasetInsertAttemptService's InsertAttemptStatus, spelled out rather
    than imported because that file reads the disk. RecipeCockpitService.ts fails to compile if the
    two drift apart.
*/
export type RecipeCockpitDatasetInsertStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unknown';

export const RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH = 80;

export const RECIPE_COCKPIT_FAVORITE_TREE_LABEL = '★';

export const RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL = '☆';

export const RECIPE_COCKPIT_FAVORITES_ONLY_LABEL = 'Favorites only';

// WHAT EVERY TREE'S "Can't insert:" SAYS WHILE THAT CHECK RUNS: THE ORG IN THE DROPDOWN IS NOT CONFIRMED YET (#305)
export const RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON = 'checking the org connection…';

export const RECIPE_COCKPIT_DATASET_ADAPTED_LABEL = 'adapted';

// WHAT A DATA SET ROW'S RECORD TYPES CHIP STARTS WITH (#621)
export const RECIPE_COCKPIT_DATASET_RECORD_TYPES_LABEL_PREFIX = 'Record types: ';

/*
    How a data set row draws its newest insert (#469): an emoji the label always repeats in words, so
    the state is never the symbol or its colour alone. Keyed by DatasetInsertAttemptService's status.
*/
export const RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY: Readonly<Record<RecipeCockpitDatasetInsertStatus, { emoji: string; label: string }>> = {
    succeeded: { emoji: '✅', label: 'Inserted' },
    partial: { emoji: '⚠️', label: 'Partly inserted' },
    failed: { emoji: '❌', label: 'Insert failed' },
    cancelled: { emoji: '🚫', label: 'Insert cancelled' },
    unknown: { emoji: '❔', label: 'Insert outcome unknown' }
};

export const RECIPE_COCKPIT_DATASET_INSERT_RESULTS_LABEL = 'View results';

export const RECIPE_COCKPIT_DATASET_INSERT_UNRECORDED_NOTE = 'No outcome was saved for this insert: it ran before Treecipe recorded how an insert ended, or it stopped before it could.';

export const RECIPE_COCKPIT_DATASET_INSERT_INTERRUPTED_NOTE = 'The insert stopped on an error before it ended, so records it saved may still be in the org.';

/*
    A data set's insert journey (#471): ✅ for what succeeded, ❌ for what failed and ⚠️ for everything
    between or not known, each always with its label in words.
*/
export const RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY: Readonly<Record<RunHistoryRowStatus, { emoji: string; label: string }>> = {
    succeeded: { emoji: '✅', label: 'Succeeded' },
    partial: { emoji: '⚠️', label: 'Partly succeeded' },
    failed: { emoji: '❌', label: 'Failed' },
    cancelled: { emoji: '⚠️', label: 'Cancelled' },
    unknown: { emoji: '⚠️', label: 'Outcome unknown' },
    unreadable: { emoji: '⚠️', label: 'Unreadable' },
    unrecorded: { emoji: '⚠️', label: 'Not recorded' }
};

/*
    The journey's table (#558), drawn by the History table's builder. The host posts entries oldest
    first and no time value, so Time sorts by that place; every column but Files sorts.
*/
export const RECIPE_COCKPIT_DATASET_JOURNEY_COLUMNS = [
    { key: 'time', label: 'Time' },
    { key: 'step', label: 'Step' },
    { key: 'org', label: 'Org' },
    { key: 'status', label: 'Status' },
    { key: 'detail', label: 'Detail' },
    { key: 'files', label: 'Files' }
] as const;

export const RECIPE_COCKPIT_DATASET_JOURNEY_SORT_COLUMNS = ['time', 'step', 'org', 'status'] as const;

export const RECIPE_COCKPIT_DATASET_JOURNEY_TOGGLE_LABEL = 'Insert journey';

export const RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE = 'Reading this data set\'s inserts…';

export const RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE = 'No inserts yet.';

export const RECIPE_COCKPIT_DATASET_JOURNEY_FIRST_TIME_NOTE = 'Inserted first time, with nothing else needed.';

export const RECIPE_COCKPIT_DATASET_JOURNEY_VIEW_FILE_LABEL = 'View file';

export const RECIPE_COCKPIT_INSERT_RUNNING_LABEL = 'Inserting…';
