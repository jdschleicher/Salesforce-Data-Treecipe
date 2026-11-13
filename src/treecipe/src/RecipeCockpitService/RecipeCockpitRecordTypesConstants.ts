/*
    What the Treecipe tab's Record types section and its "Record type fields only" and "TODOs only"
    checks draw with (#652). It imports nothing, so the panel bundle can import it;
    RecipeCockpitService.ts re-exports every name.
*/

// THE TREECIPE TAB'S CHECK (#320), AND WHY IT IS DISABLED ON A CARD WITH NO RECORD TYPES TO CHOOSE FROM
export const RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL = 'Click to show record type impacted fields only';
export const RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE = 'No object in this tree has more than one record type, so no field depends on one.';

// THE TREECIPE TAB'S "TODOs only" CHECK (#354), AND WHY IT IS DISABLED ON A CARD WHOSE RECIPE HAS NO TODO COMMENT
export const RECIPE_COCKPIT_TODOS_ONLY_LABEL = 'Click to show fields with open TODOs';
export const RECIPE_COCKPIT_NO_TODOS_NOTE = 'No object of this tree has a TODO comment in the recipe.';
// WHAT A FIELD'S TODO ROW SAYS WHEN THE TODO IS IN THE VALUE THE ROW ALREADY DRAWS (#354)
export const RECIPE_COCKPIT_TODO_IN_VALUE_LABEL = 'TODO in the value above';

// THE OBJECT'S OWN "TODOs only" FILTER (#477), BESIDE ITS "All fields" BOX
export const RECIPE_COCKPIT_OBJECT_TODOS_ONLY_LABEL = 'TODOs only';
export const RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE = 'This object has no TODO comment in the recipe.';

export const RECIPE_COCKPIT_RECORD_TYPES_SECTION_TITLE = 'Record types';
// THE BUTTON IN THE TREECIPE TAB'S FILTER TILE THAT OPENS THE RECORD TYPES SECTION (#490)
export const RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL = 'Manage record types';
// WHAT A CARD WITH NOTHING TO CHOOSE SAYS IN ITS DISABLED RECORD TYPES HEADER (#338); ONE RECORD TYPE IS NO CHOICE, SO IT READS THE SAME AS NONE
export const RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY = 'No objects in this tree have two or more record types in local metadata';
// WHAT THE SECTION SAYS ABOVE ITS ROWS: THE TICKS ARE USED BY THE NEXT GENERATE, AND NO RUN IS WRITTEN (#623)
export const RECIPE_COCKPIT_RECORD_TYPES_INTRO = 'Tick the record types "Generate fake data and insert" generates for each object: one recipe block per ticked record type, each with its own RecordTypeId and picklist values. The run on screen is not rewritten.';
export const RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_LABEL = 'Remember this selection';
export const RECIPE_COCKPIT_REMEMBER_RECORD_TYPES_TITLE = 'Save the ticked record types in treecipe/treecipe.config.json when the data is generated, so Generate Treecipe reuses them. With every object at its default record type, forgets a saved choice.';
