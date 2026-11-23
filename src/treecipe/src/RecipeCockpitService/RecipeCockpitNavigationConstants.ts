/*
    What the Recipe Cockpit's navigation draws and how far its filters reach (#656): the tree
    picker and its insert order line, the Treecipes search, the nickname and friends menus, and the
    filter's expand budget. It imports nothing, so the panel bundle can import it;
    every importer reads its names here (#671).
*/

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
    A friend chip (#411) and a row's nickname (#380) each start with an emoji (#432), hidden from a
    screen reader: the chip is named by its words, and a nickname is the text beside it.
*/
export const RECIPE_COCKPIT_FRIEND_EMOJI = '👥';
export const RECIPE_COCKPIT_PARENT_NICKNAME_EMOJI = '🌳';
/*
    The first line of a references list (#491): a 🌳 nickname's list leads to the child fields that
    point to it, a field's ↖ back-link list to the parent it points to. Text only, never focused, and
    the list's accessible name.
*/
export const RECIPE_COCKPIT_CHILD_REFERENCE_MENU_HINT = 'Click to go to a child reference';
export const RECIPE_COCKPIT_PARENT_REFERENCE_MENU_HINT = 'Click to go to the parent reference';
// A PARENT ROW'S 👥 N LIST (#492) LEADS TO THE FRIEND ROWS NESTED UNDER OR POINTING TO IT
export const RECIPE_COCKPIT_FRIENDS_MENU_HINT = 'Click to go to a friend';

// THE TREECIPES SECTION DRAWS ONE CARD, CHOSEN IN A DROPDOWN, UNDER ONE SEARCH ACROSS EVERY CARD (#374)
export const RECIPE_COCKPIT_TREECIPE_PICKER_LABEL = 'Treecipe';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER = 'Search treecipes, objects, fields and record types';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH = 'No treecipe, object, field or record type matches this search.';
export const RECIPE_COCKPIT_TREECIPES_SEARCH_NO_MATCH_OPTION_SUFFIX = ' (no match)';
// THE LINE UNDER THE DROPDOWN NAMING THE SHOWN CARD'S OBJECTS IN INSERT ORDER (#385)
export const RECIPE_COCKPIT_TREE_PICKER_OBJECTS_LABEL = 'Insert order:';
export const RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SEPARATOR = ' → ';
export const RECIPE_COCKPIT_TREE_PICKER_NO_OBJECTS = 'No objects';
export const RECIPE_COCKPIT_TREE_PICKER_EXCLUDED_SUFFIX = ' (excluded)';
export const RECIPE_COCKPIT_TREE_PICKER_AUTO_EXCLUDED_SUFFIX = ' (auto-excluded)';
export const RECIPE_COCKPIT_TREE_PICKER_NO_FIELDS_SELECTED_SUFFIX = ' (no fields selected)';
export const RECIPE_COCKPIT_TREE_PICKER_IMPACTED_SUFFIX = ' (impacted)';
// A LIST LONGER THAN ONE LINE IS CUT WITH "…" AND OPENED BY ITS TOGGLE (#464)
export const RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_ALL = 'Show all';
export const RECIPE_COCKPIT_TREE_PICKER_OBJECTS_SHOW_LESS = 'Show less';
// HOW MANY RESULT ROWS THE SECTION SEARCH DRAWS; THE REST IS ONE "N more" LINE
export const RECIPE_COCKPIT_TREECIPES_SEARCH_RESULT_LIMIT = 50;
export const RECIPE_COCKPIT_TREECIPES_SEARCH_MORE_SUFFIX = ' more — type more of the name to narrow the search';

export const RECIPE_COCKPIT_NO_FAVORITES_MESSAGE = 'No favorite trees in this run. Turn off Favorites only to see all trees.';

/*
    A nickname YAML loads as a boolean or null names no record (#151, #380): the insert's whole-string
    swap never matches it. The rule is RecipeCockpitRecipeWriter's YAML_NON_STRING_PLAIN_SCALAR_PATTERN,
    spelled out here because the writer imports nothing and the panel cannot take it whole;
    RecipeCockpitPanelBundle.test.ts fails when the two differ.
*/
export const RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL)$/;

// WHAT THE INLINE NAME EDITOR (#551) SAYS UNDER ITS BOX WHEN workspaceState WOULD NOT TAKE THE NAME; THE WARNING SAYS WHY. A TREE'S AND A DATA SET'S RENAME BOTH SAY IT
export const RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL = 'The name could not be saved, so it was not changed.';
