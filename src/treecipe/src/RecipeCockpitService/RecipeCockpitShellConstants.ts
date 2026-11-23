/*
    What the Recipe Cockpit's frame draws and keeps (#657): its sections, the run picker, a card's
    tabs and name, the reader's place, and the CHANGELOG button. Imports nothing, so the panel
    modules import it; every importer reads its names here (#671).
*/

// OFFERED ONLY IN THE NO-RUN EMPTY STATE (#214)
export const RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL = 'Generate Treecipe';

export const RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL = 'Generating…';

/*
    The reader's place the panel keeps through vscodeApi.setState (#222). The version is the shape:
    a place saved in any other shape is not read, rather than read as something it was not.
*/
export const RECIPE_COCKPIT_PANEL_PLACE_VERSION = 2;

// A PLACE SAVED BEFORE #255 NAMES THE Structure AND Data-by-Org TABS; IT IS READ THROUGH RECIPE_COCKPIT_TREE_TAB_RENAMES RATHER THAN DROPPED
export const RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB = 1;

export const RECIPE_COCKPIT_TREE_TAB_RENAMES: Readonly<Record<string, string>> = Object.freeze({ structure: 'treecipe', dataByOrg: 'compare' });

/*
    Tabs a card no longer has, read from a place of EITHER version after the renames (Previous Versions
    #265, Compare #266, which a version 1 place calls dataByOrg and renames to compare first): a card
    saved on one opens on Treecipe, and that tab's search text and opened rows are dropped -- never
    moved onto another tab's search. Removing another tab is adding its name here. Record types
    (#321) became a section of the Treecipe tab: a card saved on it opens with that section expanded.
*/
export const RECIPE_COCKPIT_REMOVED_TREE_TABS: readonly string[] = Object.freeze(['versions', 'compare', 'dataByOrg', 'recordTypes']);

export const RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY = 200;

export const RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH = 80;

// THE DEEPEST friends: LEVEL A NESTED ROW IS INDENTED FOR (#467); A DEEPER ONE IS DRAWN AT THIS INDENT, SO A CARD NEVER RUNS OFF A NARROW PANEL
export const RECIPE_COCKPIT_MAX_DRAWN_NESTING_DEPTH = 8;

/*
    Every tab a card can draw. Treecipe is selected by default; the data sets tab is drawn only for
    a card with a history. Record types (#195) is a collapsible section of the Treecipe tab (#321),
    drawn only on a card listing an object with two or more record types. Troubleshooting (#346) is
    drawn on every card with a folder, and so are Query (#367) and Treecipe Adapter (#415).
*/
export const RECIPE_COCKPIT_TREE_TABS = ['treecipe', 'datasets', 'troubleshooting', 'query', 'updater'] as const;

export const RECIPE_COCKPIT_TREECIPE_FILTER_TILE_LABEL = 'Treecipe filters and record types';

// THE PANEL'S TWO SECTIONS (#348): THE ONE ORG PICKER, ALWAYS OPEN (#355), THEN EVERY TREE CARD
export const RECIPE_COCKPIT_ORG_SECTION_TITLE = 'Target Org Manager';

export const RECIPE_COCKPIT_TREECIPES_SECTION_TITLE = 'Treecipes';

export const RECIPE_COCKPIT_RUN_PICKER_LABEL = 'Select Generated Treecipe runs by date:';

export type RecipeCockpitTreeTab = typeof RECIPE_COCKPIT_TREE_TABS[number];

// A TAB ADDED SINCE THE PLACE VERSION THAT KEEPS ITS SEARCH ONLY WHEN THERE IS ONE (#367), SO AN OLDER PLACE READS AS IT WAS
export const RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS: readonly RecipeCockpitTreeTab[] = Object.freeze(['query', 'updater'] as RecipeCockpitTreeTab[]);

// TABS WHOSE SEARCH IS NOT THE TAB'S OWN: TROUBLESHOOTING SEARCHES PER SUB-TAB (#365), SO A PLACE'S TAB-WIDE ONE IS DROPPED
export const RECIPE_COCKPIT_TABS_WITHOUT_SEARCH: readonly RecipeCockpitTreeTab[] = Object.freeze(['troubleshooting'] as RecipeCockpitTreeTab[]);

export const RECIPE_COCKPIT_CHANGELOG_LINK_LABEL = 'Open CHANGELOG on GitHub';

export const RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX = '0 0 16 16';

// THE GITHUB MARK (OCTICONS mark-github, MIT), DRAWN WITH createElementNS AND FILLED FROM THE PALETTE
export const RECIPE_COCKPIT_GITHUB_GLYPH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

export const RECIPE_COCKPIT_QUERY_TAB_LABEL = 'Query';

/*
    The Treecipe Adapter tab (#415, renamed by #443; its internal id stays 'updater' so a saved
    place still opens on it): the tree drawn read-only, one box per field to choose what is filled
    on records an org already holds. Choosing reads and writes nothing, and the box of a field the
    Adapter cannot change is disabled with the reason.
*/
export const RECIPE_COCKPIT_UPDATER_TAB_LABEL = 'Treecipe Adapter';
