import type { RecipeCockpitCreateReasonCode } from './RecipeCockpitRecordCreation';
import type { RecipeCockpitTroubleshootingSubTab } from './RecipeCockpitTroubleshootingConstants';

/*
    What Target Org Manager and a tree's insert button draw (#654): the org picker's buttons and
    placeholders, the insert's label and its reasons. It imports only types from host-free files, so
    the panel bundle can import it; RecipeCockpitService.ts re-exports every name, and
    RecipeCockpitOrgAuthorize.ts the Authorize org words, which its notifications quote.
*/

export const RECIPE_COCKPIT_REFRESH_ORGS_LABEL = 'Refresh orgs';

export const RECIPE_COCKPIT_OPEN_ORG_LABEL = 'Open in browser';

// ➕ IS DRAWN BEFORE IT (#384), SO THE LABEL NO LONGER STARTS WITH +
export const RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL = 'New scratch org';

export const RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL = 'Authorize org';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL = 'Authorizing org…';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP = 'Log in to an existing sandbox in your browser so Target Org Manager can list it.';

// WHAT DATA-BY-ORG SHOWS BESIDE THE DROPDOWN, AND ITS SPINNER, WHILE THE CLI IS ASKED WHICH ORGS ARE CONNECTED
export const RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT = 'Checking org connections…';

// THE DROPDOWN'S ONE OPTION WHILE THE CHECK RUNS AND NO ORG IS REMEMBERED OR SET AS THE CLI'S DEFAULT
export const RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER = 'Loading orgs…';

// THE DROPDOWN'S ONE OPTION WHEN THE CHECK ANSWERED WITH NO ORG TO OFFER: IT STAYS DRAWN, AND ⟳ BESIDE IT
export const RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER = 'No org listed';

// THE PICKER IS SEARCHED OR CHOSEN FROM (#678): ITS SEARCH BOX, THE LINE ABOVE THE LIST, AND WHAT IT SAYS WHEN NOTHING MATCHES
export const RECIPE_COCKPIT_ORG_PICKER_NAME = 'Salesforce org the generated data goes to';
export const RECIPE_COCKPIT_ORG_SEARCH_PLACEHOLDER = 'Search for org';
export const RECIPE_COCKPIT_ORG_CHOOSE_LABEL = 'or choose org';
export const RECIPE_COCKPIT_ORG_UNSELECTED_LABEL = 'Choose org…';
// THE TEXT TYPED GOES BETWEEN THEM: No org matches "zzz"
export const RECIPE_COCKPIT_ORG_NO_MATCH_PREFIX = 'No org matches "';
export const RECIPE_COCKPIT_ORG_NO_MATCH_SUFFIX = '"';

// "alias -- instance url" IN THE PICKER ONLY (#678); EVERY OTHER TEXT NAMING AN ORG KEEPS THE ALIAS ALONE
export const RECIPE_COCKPIT_ORG_INSTANCE_URL_SEPARATOR = ' -- ';

// THE ONE BUTTON ALWAYS GENERATES AND INSERTS (#375); WHAT STOPS AN INSERT DISABLES IT, AND GENERATING ONLY IS Run Faker by Recipe'S
export const RECIPE_COCKPIT_INSERT_ACTION_LABEL = 'Generate fake data and insert';

// THE ONE REASON THAT LEAVES THE BUTTON ENABLED (#375): A CLICK ASKS FOR THE ORG IN THE COMMAND PALETTE
export const RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON = 'No org is chosen yet.';

export const RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE = 'You will be asked which org to insert into.';

export const RECIPE_COCKPIT_CANNOT_INSERT_PREFIX = 'Can\'t insert: ';

/*
    Where a disabled insert's reason links to (#539): the Troubleshooting sub-tab whose card fixes
    it. An unticked required field links to its own row instead, labelled with this prefix and the
    field. Any other reason, and a reason code not listed here, draws no link.
*/
export const RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS: Readonly<Record<Exclude<RecipeCockpitCreateReasonCode, 'requiredFieldUnticked'>, { subTab: RecipeCockpitTroubleshootingSubTab; label: string }>> = Object.freeze({
    objectNotInOrg: { subTab: 'fields', label: 'Troubleshooting › Fields' },
    objectNotCreateable: { subTab: 'permissions', label: 'Troubleshooting › Permissions' }
});

export const RECIPE_COCKPIT_INSERT_REASON_TREECIPE_LINK_PREFIX = 'Treecipe › ';

// THE TREE INSERT'S NOTIFICATION BUTTONS (#301): BOTH OPEN THE INSERT'S RESULTS FILE. THE ADAPTER'S UPDATE NOTIFICATION SAYS THEM TOO
export const RECIPE_COCKPIT_INSERT_VIEW_ERRORS_LABEL = 'View errors';

export const RECIPE_COCKPIT_INSERT_VIEW_RESULTS_LABEL = 'View results';
