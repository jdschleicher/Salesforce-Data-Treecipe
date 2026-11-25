/*
    The words of "Customize and create new recipe" (#677): the card's button, the modal, its save
    step and the notification a save ends in. Imports nothing, so the panel bundles it; re-exported
    by the service.
*/

export const RECIPE_COCKPIT_CUSTOMIZE_TREE_LABEL = 'Customize and create new recipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_TITLE = 'Customize and create new recipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_SOURCE_NOTE = 'The source recipe is not changed.';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_SAVE_LABEL = 'Save as new Treecipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_CONFIRM_SAVE_LABEL = 'Save';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_BACK_LABEL = 'Back to editing';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_CANCEL_LABEL = 'Cancel';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_CLOSE_LABEL = 'Close without saving';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_LABEL = 'Name (optional)';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_NAME_PLACEHOLDER = 'For example "Accounts with contacts only"';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_REMOVED_NOTE = 'Remove an object or a field with ✕ to make a new Treecipe.';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_NOTHING_LEFT_NOTE = 'Nothing is left to save. Restore the root object to keep the tree.';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_OPEN_RECIPE_LABEL = 'Open recipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_COPY_LABEL_PREFIX = 'custom copy of ';

// AN OBJECT ROW'S STATE AFTER ITS NAME, WHEN THE MODAL'S CASCADE TOOK IT OUT OF THE NEW RECIPE OR OUT OF A RUN
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_TEXT = 'Removed from the new recipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_EVERY_FIELD_REMOVED_TEXT = 'Removed: every field removed';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_WITH_PREFIX = 'Removed with ';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_TEXT = 'Left out of a run, kept in the recipe';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_OUT_OF_RUN_WITH_PREFIX = 'Left out of a run with ';

// THE FLOOR OF HOW MANY NAMES ONE MODAL CAN POST: THE HOST ALSO ACCEPTS AS MANY AS THE PANEL HAS DRAWN KEYS FOR (#711)
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_MAX_POSTED_NAMES = 5000;

// THE MODAL'S TOOLBAR (#711): A SEARCH OVER OBJECT AND FIELD API NAMES, AND BULK ✕ AND ↺ OVER WHAT IT SHOWS
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_LABEL = 'Search objects and fields';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_SEARCH_PLACEHOLDER = 'Search objects and fields by API name';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_NO_MATCH_PREFIX = 'No object or field matches ';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_OBJECTS_LABEL = 'Deselect all objects';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_OBJECTS_LABEL = 'Deselect shown objects';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_LABEL = 'Deselect all fields';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_FIELDS_LABEL = 'Deselect shown fields';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_RESTORE_ALL_LABEL = 'Restore all';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_EVERY_FIELD_PREFIX = 'Remove every field of ';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVE_SHOWN_FIELDS_PREFIX = 'Remove shown fields of ';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_TITLE = 'Remove every field you can?';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_SHOWN_FIELDS_ASK_TITLE = 'Remove every shown field you can?';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_EMPTIES_ROOT_SUFFIX = ', the root of this tree, is left with no field, so it goes with every object under it and nothing is left to save.';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_ASK_NOTE = 'An object with no locked field is removed with its fields, since an object with every field removed is left out. ↺ brings each back.';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_KEEP_LABEL = 'Keep fields';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_DESELECT_FIELDS_CONFIRM_LABEL = 'Remove fields';

// A REMOVED OBJECT'S FIELD LIST (#715): EACH FIELD ITS OBJECT TOOK, AND WHAT ITS ↺ BRINGS BACK WITH IT
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_REMOVED_WITH_OBJECT_TEXT = 'Removed with the object';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_RESTORE_WITH_PATH_SUFFIX = ', and what links it to the tree';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_RESTORED_ALONG_PREFIX = 'Also restored, to link it to the tree: ';
