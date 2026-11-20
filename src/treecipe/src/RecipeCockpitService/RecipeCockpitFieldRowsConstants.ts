/*
    What the Treecipe tab's field rows and the object/field selection cascade draw (#655): a field
    box's reasons, the object's "All fields", "Standard fields" and "Hide unselected" boxes, a
    field's fixed-value badge and pencil reasons, and its validation-rule box. It imports nothing,
    so the panel bundle can import it; RecipeCockpitService.ts re-exports every name, and the host
    gives the same reasons when it re-derives a lock before it writes.
*/

// WHY A FIELD'S CHECKBOX IS DISABLED (#220); THE HOST'S ANSWER, WHICH THE PANEL DRAWS
export const RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON = 'parent excluded';

export const RECIPE_COCKPIT_SELECT_ALL_FIELDS_LABEL = 'All fields';
// THE OBJECT'S "Standard fields" BOX (#477): EVERY FIELD WHOSE API NAME DOES NOT END IN THE CUSTOM SUFFIX
export const RECIPE_COCKPIT_STANDARD_FIELDS_LABEL = 'Standard fields';
export const RECIPE_COCKPIT_CUSTOM_FIELD_SUFFIX = '__c';
export const RECIPE_COCKPIT_STANDARD_FIELDS_SCOPE = 'standard';
// THE OBJECT'S OWN "Hide unselected" FILTER (#483), BESIDE ITS "All fields" BOX
export const RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL = 'Hide unselected';
export const RECIPE_COCKPIT_NO_UNSELECTED_FIELDS_NOTE = 'Every field of this object is ticked, so there is nothing to hide.';

/*
    Why a field's fixed-value pin is disabled (#262). The panel draws the same rule from what the
    model already carries, and the host re-derives it before it writes, so the reasons are shared.
    A lock of #220 (RecordTypeId, a controlling field, a parent-excluded lookup) gives its own reason.
*/
export const RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON = 'object excluded';
export const RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON = 'unticked';
export const RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON = 'the record type is chosen by name';
export const RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX = 'depends on ';
// A FIELD SALESFORCE SETS FROM ANOTHER LOOKUP (Quote.AccountId FROM OpportunityId, #680): READ ONLY, AND NEVER INSERTED
export const RECIPE_COCKPIT_DERIVED_FIELD_REASON_PREFIX = 'set by Salesforce from ';
export const RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL = 'read only';
export const RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES = ['Lookup', 'MasterDetail', 'Hierarchy'];
// A VALUE THAT STARTS WITH THIS IS SAVED AS AN EDITED FAKER EXPRESSION (#356), ANYTHING ELSE AS A LITERAL
export const RECIPE_COCKPIT_EXPRESSION_OPENER = '${{';

export const RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL = 'fixed';
export const RECIPE_COCKPIT_EDITED_EXPRESSION_BADGE_LABEL = 'edited';
export const RECIPE_COCKPIT_ORG_RECORD_BADGE_PREFIX = 'org record · ';
export const RECIPE_COCKPIT_PICKLIST_EDIT_VALUES_LABEL = 'Edit values';

/*
    A field's validation-rule checkbox (#325), at the end of its row: checked while the rules #324
    applied shape the field, unticked to generate the value it had before them. One box covers every
    rule on the field. A field whose rules were all not applied draws a muted note instead.
*/
export const RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON = 'an edit replaces it';
export const RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL = 'rule not applied';
// A RULE'S FILE LINK (#560): ON A FIELD ROW IT NAMES THE RULE, SINCE A FIELD CAN HAVE SEVERAL; A LIST ROW ALREADY DOES
export const RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LINK_PREFIX = '↗ ';

// AN OBJECT WITH NO FIELD TICKED IS NOT GENERATED (#611, REVERSING #220'S RECORDS WITH NO FIELDS SET): THE ROW SAYS THIS IN PLACE OF ITS CONTROLS
export const RECIPE_COCKPIT_NO_FIELDS_SELECTED_MESSAGE = 'NO FIELDS SELECTED SO NO RECORDS WILL BE GENERATED';

export const RECIPE_COCKPIT_RESET_SELECTION_LABEL = 'Reset Selections';
