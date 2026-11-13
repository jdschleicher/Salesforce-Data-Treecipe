/*
    What the Treecipe tab's field editor, picklist tiles and lookup wiring draw with (#653). It
    imports nothing, so the panel bundle can import it; RecipeCockpitService.ts re-exports every
    name, and the host's checks read the same values from there.
*/

/*
    Why "Create <Parent> in recipe" is disabled: the writer's CreateParentRefusalReason, spelled out
    rather than imported, because tsconfig.panel.json would then type check the whole writer.
    RecipeCockpitService.ts fails to compile if the two drift apart.
*/
export type RecipeCockpitCreateParentRefusalReason = 'no-parent-template' | 'parent-object-already-exists' | 'parent-not-inserted-first';

export const RECIPE_COCKPIT_FIXED_VALUE_NUMBER_FIELD_TYPES = ['Number', 'Currency', 'Percent'];
export const RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH = 32768;
export const RECIPE_COCKPIT_LOOKUP_ID_PLACEHOLDER = '15- or 18-character Salesforce Id';
export const RECIPE_COCKPIT_LOOKUP_ID_EDIT_HINT = 'Saved as the Id of an existing record: every record generated points at it, and the tree insert checks the org it inserts into holds it, unless the lookup can point at more than one object. Save writes it into the recipe file; Clear puts back the lines the field had.';
// A CUSTOM GEOLOCATION FIELD'S COMPONENTS: THE WRAPPER TYPES THEM Text, BUT THE INSERT TAKES ONLY A NUMBER IN RANGE (#342)
export const RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES: Readonly<Record<string, { suffix: string; limit: number }>> = {
    Latitude: { suffix: '__Latitude__s', limit: 90 },
    Longitude: { suffix: '__Longitude__s', limit: 180 }
};

export const RECIPE_COCKPIT_PICKLIST_RESET_LABEL = 'Reset to generated';
export const RECIPE_COCKPIT_PICKLIST_CHOICE_EMPTY_REASON = 'Tick at least one value to save.';
export const RECIPE_COCKPIT_PICKLIST_OTHER_EDIT_NOTE = 'This field has an edit that is not a choice of its values. Saving a choice replaces it.';

// A SELF-LOOKUP ITERATION'S "+" ADDS ONE OF ITS OBJECT'S FRIENDS BENEATH IT (#197)
export const RECIPE_COCKPIT_ADD_FRIEND_ACTION_LABEL = '+ Add friend';
export const RECIPE_COCKPIT_WIRE_LOOKUP_ACTION_LABEL = 'Wire to…';
// AN EMPTY LOOKUP'S TWO DECISIONS (#421), EACH NAMING THE PARENT BETWEEN ITS PREFIX AND SUFFIX
export const RECIPE_COCKPIT_CREATE_PARENT_ACTION_PREFIX = 'Create ';
export const RECIPE_COCKPIT_CREATE_PARENT_ACTION_SUFFIX = ' in recipe';
export const RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_PREFIX = 'Use existing ';
export const RECIPE_COCKPIT_USE_ORG_RECORD_ACTION_SUFFIX = ' from org…';
// WHY "Create <Parent> in recipe" IS DISABLED, BY THE WRITER'S CODE; {parent} AND {object} ARE FILLED IN BY THE PANEL
export const RECIPE_COCKPIT_CREATE_PARENT_REFUSAL_TEXTS: Readonly<Record<RecipeCockpitCreateParentRefusalReason, string>> = {
    'no-parent-template': 'There is no minimum required fields template for {parent}, so it cannot be added to the recipe.',
    'parent-object-already-exists': 'The recipe already has a "- object: {parent}" block; point this lookup at it with Wire to… or by hand.',
    'parent-not-inserted-first': '{parent} is not at a lower relationship level than {object}, so the insert would not send it first.'
};
export const RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL = 'Wire TODO lookups';
