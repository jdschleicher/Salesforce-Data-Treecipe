/*
    The words the Treecipe Adapter tab draws (#415, #443 … #447, #556), moved out of the service so
    its panel modules can import them (#641). This file imports nothing, so nothing it brings into
    the webview can reach vscode or Node; every importer reads its names here (#671).
*/

export const RECIPE_COCKPIT_UPDATER_INTRO = 'Load records reads the parent records and only the records under them, with every field this treecipe lists, from the sandbox or scratch org chosen in Target Org Manager. Mark the rows to change with ✎, then 🎲 makes a new value for a cell or a whole column from the field\'s faker expression, ⌨ takes a value you type for one cell, and ↺ puts a loaded value back. Update records writes only the changed cells of the marked rows, by Id, after saving their old values to RunArtifacts in the tree folder, and Restore previous values… puts saved ones back.';
export const RECIPE_COCKPIT_UPDATER_SEARCH_PLACEHOLDER = 'Filter by fields & objects to add';

/*
    The Adapter's two steps (#443): step 1 chooses the parent object and the WHERE for the parent
    records expected; step 2 draws the tree rooted at that parent -- it and every object whose
    lookups lead up to it -- under the filter. Moving between the steps posts nothing.
*/
export const RECIPE_COCKPIT_UPDATER_PARENT_STEP_HEADING = '1. Choose the parent object, and query for the parent records you expect';
export const RECIPE_COCKPIT_UPDATER_PARENT_SELECT_LABEL = 'Parent object';
export const RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER = 'WHERE for the parent records (optional), e.g. Name LIKE \'Acme%\'';
export const RECIPE_COCKPIT_UPDATER_NEXT_LABEL = 'Next';
export const RECIPE_COCKPIT_UPDATER_STRUCTURE_STEP_HEADING_PREFIX = '2. The treecipe under ';
export const RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL = 'Change parent object';
// STEP 2'S PARENT CHIP (#720): "Parent: Account · WHERE Name LIKE 'Acme%' · 12 records", THE COUNT ONCE A LOAD READ THE PARENT
export const RECIPE_COCKPIT_UPDATER_PARENT_CHIP_PREFIX = 'Parent: ';
export const RECIPE_COCKPIT_UPDATER_PARENT_CHIP_WHERE_PREFIX = 'WHERE ';
export const RECIPE_COCKPIT_UPDATER_PARENT_CHIP_EVERY_RECORD = 'every record';
export const RECIPE_COCKPIT_UPDATER_PARENT_CHIP_SEPARATOR = ' · ';
export const RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_TITLE = 'Go back to step 1 to choose another parent object or WHERE. Loaded records are let go, after asking.';
export const RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL = 'Retrieve latest metadata';
export const RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL = 'Retrieving…';
export const RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE = 'Retrieve the latest metadata of these objects from the sandbox or scratch org chosen in Target Org Manager, into RunArtifacts in the tree folder, and mark the fields that are new or changed in the org. Nothing in the project changes.';

// "Retrieve latest metadata" (#445), FIELDS ONLY THE ORG HOLDS (#446), "Add to data set" (#447), THE HINTS AND APPLY
export const RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL = 'new in org';
export const RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL = 'changed in org';
export const RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL = 'not retrieved from the org';
// A FIELD ONLY THE ORG HOLDS IS DRAWN, NOT FILLED: FILLING IT IS #446
export const RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE = 'Only in the org: this project has no file for it yet.';
// THE CARD'S RECORD TABLE HAS NO 🎲 FOR SUCH A FIELD (#721), SO ITS ROW SAYS WHY
export const RECIPE_COCKPIT_UPDATER_NO_EXPRESSION_NOTE = 'No 🎲 in the record table: this recipe\'s faker backend writes no expression for its type in the org. Type a value with ⌨.';
// A CHILD OBJECT ONLY THE ORG HOLDS IS DRAWN, NOT ADDED: ADDING IT IS #447
export const RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_LABEL = 'new child object in org';
export const RECIPE_COCKPIT_ADAPTER_NEW_CHILD_OBJECT_NOTE = 'Only in the org: this treecipe has no block for it yet.';
export const RECIPE_COCKPIT_ADAPTER_ADD_CHILD_LABEL = 'Add to data set';
export const RECIPE_COCKPIT_ADAPTER_CHILD_GENERATE_LABEL = 'Generate preview';
export const RECIPE_COCKPIT_ADAPTER_CHILD_COUNT_LABEL = 'per loaded record of';
export const RECIPE_COCKPIT_ADAPTER_CHILD_NOT_LOADED_REASON = 'Load records first: new child records are added under the parent records the last load read.';
export const RECIPE_COCKPIT_ADAPTER_CHILD_NO_PARENTS_REASON = 'The last load read no records of the parent object, so there is nothing to add under.';
export const RECIPE_COCKPIT_ADAPTER_CHILD_PARENT_EXCLUDED_REASON_PREFIX = 'The parent object is excluded on the Treecipe tab: ';
export const RECIPE_COCKPIT_ADAPTER_CHILD_PREVIEW_NOTE = 'A preview only: nothing is written to the org or the recipe file.';
export const RECIPE_COCKPIT_ADAPTER_HINTS_HEADING = 'Recent changes in the org';
export const RECIPE_COCKPIT_ADAPTER_SOURCE_TRACKING_HEADING = 'Source tracking';
export const RECIPE_COCKPIT_ADAPTER_AUDIT_TRAIL_HEADING = 'Setup audit trail, last 180 days';
export const RECIPE_COCKPIT_ADAPTER_APPLY_LABEL = 'Apply retrieved files to project';
export const RECIPE_COCKPIT_ADAPTER_APPLYING_LABEL = 'Applying…';
export const RECIPE_COCKPIT_ADAPTER_APPLY_TITLE = 'Copy the field files the org changed or added into this project: a changed field over its project file, a new field into the default package directory. Asks first.';
export const RECIPE_COCKPIT_ADAPTER_APPLY_NOTHING_REASON = 'No field file is new or changed against this project, so there is nothing to apply.';

// WHY A FIELD'S BOX IS LOCKED, AND WHAT THE SUMMARY SAYS WITH NONE CHOSEN
export const RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN = 'No fields chosen';
// THE CARD'S SUMMARY BEFORE ANY ROW OF ITS RECORD TABLES IS MARKED (#721)
export const RECIPE_COCKPIT_UPDATER_NO_ROWS_MARKED = 'No rows marked to update';
export const RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON = 'read from the recipe file, so its type is not known';
export const RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON = 'the record type is not changed here';
export const RECIPE_COCKPIT_UPDATER_LOOKUP_REASON = 'a lookup points to another record, which the Adapter does not change';
export const RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON = 'Salesforce sets this field\'s value';
// AN AUTO NUMBER OR A ROLL-UP SUMMARY IS COMPUTED BY THE ORG, SO AN UPDATE OF IT FAILS; A FORMULA IS TOO, BUT THE WRAPPER DOES NOT RECORD ONE
export const RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_FIELD_TYPES = ['AutoNumber', 'Summary'];

// THE UPDATER'S LOAD (#416): THE TREE'S EXISTING RECORDS, READ FROM THE SANDBOX TARGET ORG MANAGER HAS SELECTED
export const RECIPE_COCKPIT_UPDATER_LOAD_LABEL = 'Load records';
export const RECIPE_COCKPIT_UPDATER_LOADING_LABEL = 'Loading…';
export const RECIPE_COCKPIT_UPDATER_WHERE_PLACEHOLDER = 'WHERE (optional), e.g. CreatedDate = LAST_N_DAYS:30';
// AN OBJECT'S RECORD TABLE (#720): ITS PAGES, AND THE RECIPE FIELDS THE ORG WOULD NOT ANSWER WITH
export const RECIPE_COCKPIT_UPDATER_PREVIOUS_PAGE_LABEL = 'Previous';
export const RECIPE_COCKPIT_UPDATER_NEXT_PAGE_LABEL = 'Next';
export const RECIPE_COCKPIT_UPDATER_UNREAD_FIELDS_REASON = 'the org does not have it, or does not let this user read it. Check the field and its field-level security in the org, then load again.';
export const RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON = 'The last load read 0 records: change the parent\'s WHERE in step 1, or the WHERE under an object, and load again.';

// "Edit existing records" (#721): THE TABLE'S HEADING, ITS BUTTONS' GLYPHS AND WHY UPDATE HAS NOTHING TO WRITE YET
export const RECIPE_COCKPIT_UPDATER_EDIT_HEADING = 'Edit existing records';
export const RECIPE_COCKPIT_UPDATER_MARK_COLUMN_LABEL = 'Update';
export const RECIPE_COCKPIT_UPDATER_MARK_GLYPH = '✎';
export const RECIPE_COCKPIT_UPDATER_GENERATE_GLYPH = '🎲';
export const RECIPE_COCKPIT_UPDATER_RESET_GLYPH = '↺';
// A VALUE TYPED INTO ONE CELL OF A MARKED ROW (#721 PART 2)
export const RECIPE_COCKPIT_UPDATER_TYPE_GLYPH = '⌨';
// THE CELL SHOWS ONLY PART OF A LONG VALUE, OR ONE WITH LINE BREAKS, SO ITS EDITOR STARTS EMPTY AND SAYS WHAT SAVING DOES
export const RECIPE_COCKPIT_UPDATER_CUT_CELL_PLACEHOLDER = 'Replaces the whole value, which is longer than shown';
export const RECIPE_COCKPIT_UPDATER_LOCKED_GLYPH = '🔒';
export const RECIPE_COCKPIT_UPDATER_RESET_ALL_LABEL = 'Reset all';
export const RECIPE_COCKPIT_UPDATER_NO_ROW_MARKED_REASON = 'Mark a row first: the ✎ at the start of a row marks it to update.';
export const RECIPE_COCKPIT_UPDATER_NO_CELL_CHANGED_REASON = 'Change a cell in a marked row first: 🎲 makes a new value for it.';
export const RECIPE_COCKPIT_UPDATER_GENERATING_LABEL = 'Generating…';
export const RECIPE_COCKPIT_UPDATER_VALUE_EDIT_HINT = 'Keeps this value in the Treecipe Adapter only: nothing is written to the recipe or to the org.';

// THE UPDATE (#418): THE GENERATED VALUES WRITTEN TO THE LOADED RECORDS BY Id, IN THE SANDBOX THEY WERE LOADED FROM
export const RECIPE_COCKPIT_UPDATER_UPDATE_LABEL = 'Update records';
export const RECIPE_COCKPIT_UPDATER_UPDATING_LABEL = 'Updating…';

// THE RESTORE (#419): A SNAPSHOT AN UPDATE SAVED, WRITTEN BACK TO ITS RECORDS BY Id, IN THE SANDBOX IT WAS TAKEN IN
export const RECIPE_COCKPIT_UPDATER_SNAPSHOTS_HEADING = 'Previous updates';
export const RECIPE_COCKPIT_UPDATER_NO_SNAPSHOTS_NOTE = 'No update of this tree has saved old values yet.';
export const RECIPE_COCKPIT_UPDATER_RESTORE_LABEL = 'Restore previous values…';
export const RECIPE_COCKPIT_UPDATER_RESTORING_LABEL = 'Restoring…';

// A PREVIEW ROW'S Id OPENS ITS RECORD (#556); THE HOST'S REFUSALS FOR IT STAY IN THE SERVICE
export const RECIPE_COCKPIT_RECORD_LINK_TITLE = 'Open this record in the org it was read from';

// HOW LONG A WHERE CLAUSE THE READER TYPES FOR ONE OBJECT MAY BE
export const RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH = 4000;
