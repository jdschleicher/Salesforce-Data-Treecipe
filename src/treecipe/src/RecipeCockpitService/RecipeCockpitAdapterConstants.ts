/*
    The words the Treecipe Adapter tab draws (#415, #443 … #447, #556), moved out of the service so
    its panel modules can import them (#641). This file imports nothing, so nothing it brings into
    the webview can reach vscode or Node; RecipeCockpitService re-exports every name.
*/

export const RECIPE_COCKPIT_UPDATER_INTRO = 'Choose the fields to fill on records an org already holds, then Load records reads the parent records and only the records under them, with those fields, from the sandbox or scratch org chosen in Target Org Manager. Generate values makes a new value for each of them, from the field\'s faker expression or a value you type with the pencil. Update records writes those values to the records by Id, after saving their old values to RunArtifacts in the tree folder, and Restore previous values… puts saved ones back.';
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
export const RECIPE_COCKPIT_UPDATER_CHANGE_PARENT_LABEL = 'Change parent';
export const RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NOTE_PREFIX = 'Parent records: WHERE ';
export const RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NONE_NOTE = 'Parent records: every record (no WHERE in step 1)';
export const RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL = 'Retrieve latest metadata';
export const RECIPE_COCKPIT_UPDATER_RETRIEVING_METADATA_LABEL = 'Retrieving…';
export const RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_TITLE = 'Retrieve the latest metadata of these objects from the sandbox or scratch org chosen in Target Org Manager, into RunArtifacts in the tree folder, and mark the fields that are new or changed in the org. Nothing in the project changes.';

// "Retrieve latest metadata" (#445), FIELDS ONLY THE ORG HOLDS (#446), "Add to data set" (#447), THE HINTS AND APPLY
export const RECIPE_COCKPIT_ADAPTER_NEW_IN_ORG_LABEL = 'new in org';
export const RECIPE_COCKPIT_ADAPTER_CHANGED_IN_ORG_LABEL = 'changed in org';
export const RECIPE_COCKPIT_ADAPTER_NOT_RETRIEVED_LABEL = 'not retrieved from the org';
// A FIELD ONLY THE ORG HOLDS IS DRAWN, NOT FILLED: FILLING IT IS #446
export const RECIPE_COCKPIT_ADAPTER_ORG_ONLY_FIELD_NOTE = 'Only in the org: this project has no file for it yet.';
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
export const RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON = 'The last load read 0 records: change the parent\'s WHERE in step 1, or the WHERE under an object, and load again.';

// GENERATE VALUES (#417) AND THE PENCIL'S HINT
export const RECIPE_COCKPIT_UPDATER_GENERATE_LABEL = 'Generate values';
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
