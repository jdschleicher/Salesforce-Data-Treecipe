/*
    "Get latest object detail" (#612): the row's button and the kinds its dialog offers, as words the
    panel draws (#657). Imports nothing; RecipeCockpitObjectRefresh and RecipeCockpitService re-export them.
*/

// "Get latest detail" (#612): THE ROW'S BUTTON, THE DIALOG'S STEPS AND WHAT EACH REFUSES WITH
export const RECIPE_COCKPIT_OBJECT_REFRESH_LABEL = 'Get latest detail';

// THE BUTTON'S CIRCULAR REFRESH ARROW: A 315-DEGREE ARC ROUND (12, 12) ENDING IN AN ARROWHEAD AT THE TOP RIGHT, STROKED IN --sdt-removed
export const RECIPE_COCKPIT_OBJECT_REFRESH_GLYPH_PATH = 'M19 12 A7 7 0 1 1 16.95 7.05 M16.95 3.55 V7.05 H13.45';

export type ObjectRefreshKind = 'fields' | 'validationRules' | 'recordTypes' | 'globalValueSets';

export const OBJECT_REFRESH_KINDS: readonly ObjectRefreshKind[] = Object.freeze(['fields', 'validationRules', 'recordTypes', 'globalValueSets'] as ObjectRefreshKind[]);

// THE SAME LABELS AS THE TROUBLESHOOTING TAB'S RETRIEVES, SO A KIND READS THE SAME IN BOTH PLACES
export const OBJECT_REFRESH_KIND_LABELS: Readonly<Record<ObjectRefreshKind, string>> = Object.freeze({
    fields: 'Fields',
    validationRules: 'Validation rules',
    recordTypes: 'Record types',
    globalValueSets: 'Global value sets'
});
