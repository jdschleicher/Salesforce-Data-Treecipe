import { DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH } from './RecipeCockpitAdapterConstants';
import {
    RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB,
    RECIPE_COCKPIT_REMOVED_TREE_TABS,
    RECIPE_COCKPIT_TABS_WITHOUT_SEARCH,
    RECIPE_COCKPIT_TREE_TAB_RENAMES,
    RECIPE_COCKPIT_TREE_TABS
} from './RecipeCockpitShellConstants';
import type { RecipeCockpitTreeTab } from './RecipeCockpitShellConstants';
import { RECIPE_COCKPIT_HISTORY_SORT_COLUMNS, RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS } from './RecipeCockpitTroubleshootingConstants';
import type { RecipeCockpitHistorySortColumn, RecipeCockpitTroubleshootingSubTab } from './RecipeCockpitTroubleshootingConstants';
import { RecipeCockpitUntrustedValue } from './RecipeCockpitUntrustedValue';
import type {
    IRecipeCockpitRecordTypesFocusRequest,
    IRecipeCockpitTreeFocus,
    IRecipeCockpitTroubleshootingFocusRequest,
    RecipeCockpitOpenFocusRequest
} from './RecipeCockpitViewModel';

/*
    The host half of the reader's place (#670): its shape, its bounds and the check every place read
    back from workspaceState (#230) or posted by the panel (#222) goes through. No vscode, so it is
    tested without one; keeping the place in workspaceState is the hub's lifecycle work.
*/

/*
    The same place, kept in workspaceState as well (#230) so it outlives the panel: a close or a
    window reload throws the webview's own state away.
*/
export const RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY = 'treecipe.recipeCockpit.panelPlace';
// WHAT A PLACE READ BACK FROM workspaceState MAY HOLD -- AN ENTRY PAST EITHER BOUND IS DROPPED, NEVER CUT TO FIT
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES = 10000;
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH = 1000;
// THE WHOLE PLACE, SERIALIZED: THE BOUNDS ABOVE ARE PER LIST AND MULTIPLY. A REAL ONE IS A FEW KB, 1,000 OBJECTS OPENED IN 10 CARDS ABOUT 1.5 MB
export const RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH = 4000000;

/*
    The reader's place as the panel saves it (#222) and as workspaceState keeps it (#230): names,
    each tab's search as typed, whether the org picker was in use and a scroll offset.
    No path, picklist value, org label or username -- normalize keeps nothing else.
*/
export interface IRecipeCockpitPanelTreePlace {
    treeKey: string;
    // WHETHER THE CARD WAS THE ONE ON SCREEN; A CARD NO LONGER FOLDS (#374), SO IT IS WRITTEN FOR AN OLDER READER AND IGNORED ON RESTORE
    isExpanded: boolean;
    selectedTab: RecipeCockpitTreeTab;
    searchQueries: Partial<Record<RecipeCockpitTreeTab, string>>;
    expandedObjectKeys: string[];
    openPicklistKeys: string[];
    // THE DATA SETS TAB'S FAVORITES ONLY; A PLACE SAVED BEFORE IT HAS NONE AND READS AS THE FILTER OFF
    isDatasetFavoritesOnly?: true;
    // THE DATA SET ROWS WHOSE INSERT JOURNEY IS OPEN (#471), BY DATA SET FOLDER NAME; A PLACE SAVED BEFORE IT HAS NONE
    expandedJourneyDatasetFolderNames?: string[];
    // THE TREECIPE TAB'S RECORD TYPES SECTION (#321); A PLACE SAVED BEFORE IT HAS NONE AND READS AS COLLAPSED
    isRecordTypesExpanded?: true;
    // THE TREECIPE TAB'S "Record type fields only" CHECK (#320); A PLACE SAVED BEFORE IT HAS NONE AND READS AS OFF
    isRecordTypeFieldsOnly?: true;
    // THE TREECIPE TAB'S "TODOs only" CHECK (#354); A PLACE SAVED BEFORE IT HAS NONE AND READS AS OFF
    isTodosOnly?: true;
    // EACH OBJECT'S OWN "TODOs only" (#477), BY OBJECT PLACE KEY, ONLY WHEN ONE IS ON
    todosOnlyObjectKeys?: string[];
    // EACH OBJECT'S OWN "Hide unselected" (#483), BY OBJECT PLACE KEY, ONLY WHEN ONE IS ON
    hideUnselectedObjectKeys?: string[];
    // THE TROUBLESHOOTING SUB-TAB (#365), ONLY WHEN IT IS NOT THE FIRST, AND EACH SUB-TAB'S SEARCH, ONLY WHEN THERE IS ONE
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    troubleshootingSearchQueries?: Partial<Record<RecipeCockpitTroubleshootingSubTab, string>>;
    // THE TODO'S SUB-TAB'S REMOVED LIST (#391), ONLY WHEN IT IS THE ONE OPEN, AND ITS SEARCH, ONLY WHEN THERE IS ONE
    todosView?: 'removed';
    removedTodosSearchText?: string;
    // THE HISTORY SUB-TAB'S SORT (#485), ONLY WHEN IT IS NOT TIME, NEWEST FIRST
    troubleshootingHistorySort?: { column: RecipeCockpitHistorySortColumn; isDescending: boolean };
    // THE TREECIPE UPDATER TAB'S CHOSEN FIELDS ("<object>\n<field>") AND OPENED OBJECTS (#415), EACH ONLY WHEN THERE IS ONE
    updaterExpandedObjectKeys?: string[];
    // THE TREECIPE ADAPTER'S STEP 2 (#443), ITS PARENT OBJECT AND THE PARENT'S WHERE, EACH ONLY WHEN THERE IS ONE; A PLACE WITH NONE OPENS ON STEP 1
    updaterStep?: 'structure';
    updaterParentObjectApiName?: string;
    updaterParentWhereText?: string;
}

export interface IRecipeCockpitPanelPlace {
    version: number;
    runFolderName: string;
    isOrgPickerInUse: boolean;
    // A PLACE SAVED BEFORE #235 HAS NONE, AND READS AS THE FILTER OFF -- WHICH IS WHAT IT WAS
    isFavoritesOnly: boolean;
    // THE HELP SECTION (#332); A PLACE SAVED BEFORE IT HAS NONE AND READS AS COLLAPSED
    isHelpExpanded?: true;
    // THE TREECIPE THE SECTION'S DROPDOWN SHOWS AND THE SECTION SEARCH AS TYPED (#374); A PLACE SAVED BEFORE IT HAS NEITHER AND OPENS ON THE FIRST
    selectedTreeKey?: string;
    treecipesSearchText?: string;
    // NEITHER SECTION FOLDS (#355, #364), SO A 3.98.0+ PLACE'S isOrgSectionCollapsed AND isTreecipesSectionCollapsed ARE IGNORED AND DROPPED
    scrollY: number;
    trees: IRecipeCockpitPanelTreePlace[];
}

type RequiredTreePlaceField = 'treeKey' | 'isExpanded' | 'selectedTab' | 'searchQueries' | 'expandedObjectKeys' | 'openPicklistKeys';
export type OptionalTreePlaceField = Exclude<keyof IRecipeCockpitPanelTreePlace, RequiredTreePlaceField>;

/*
    One optional field of a tree's place: the value its check finds in what was stored, or undefined
    when it is absent, malformed or the default, which is never written. The reason is why a place
    has it, and when an older place reads as having it.
*/
interface IOptionalTreePlaceRule<Field extends OptionalTreePlaceField> {
    field: Field;
    check: (candidateTree: Record<string, unknown>) => IRecipeCockpitPanelTreePlace[Field] | undefined;
    reason: string;
}

type OptionalTreePlaceRule = { [Field in OptionalTreePlaceField]: IOptionalTreePlaceRule<Field> }[OptionalTreePlaceField];

export class RecipeCockpitPanelPlace {


    static isBoundedText(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && candidate.length <= RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH;

    }

    private static isNonEmptyBoundedText(candidate: unknown): candidate is string {

        return RecipeCockpitPanelPlace.isBoundedText(candidate) && candidate !== '';

    }

    static normalizePlaceNames(candidateNames: unknown): string[] {

        if ( !Array.isArray(candidateNames) ) {
            return [];
        }

        return candidateNames
            .slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES)
            .filter((candidateName: unknown): candidateName is string => RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidateName));

    }

    // A LIST OF NAMES IS WRITTEN ONLY WHEN IT HOLDS ONE
    private static namesWhenAny(candidateNames: unknown, isKept: (name: string) => boolean = () => true): string[] | undefined {

        const names = RecipeCockpitPanelPlace.normalizePlaceNames(candidateNames).filter(isKept);
        return names.length > 0 ? names : undefined;

    }

    private static readUpdaterParentObjectApiName(candidateTree: Record<string, unknown>): string | undefined {

        return SalesforceApiName.isApiName(candidateTree.updaterParentObjectApiName) ? candidateTree.updaterParentObjectApiName as string : undefined;

    }

    private static readTroubleshootingSearchQueries(candidateTree: Record<string, unknown>): Partial<Record<RecipeCockpitTroubleshootingSubTab, string>> | undefined {

        const storedSubTabQueries = RecipeCockpitUntrustedValue.isPlainRecord(candidateTree.troubleshootingSearchQueries) ? candidateTree.troubleshootingSearchQueries : {};
        const troubleshootingSearchQueries: Partial<Record<RecipeCockpitTroubleshootingSubTab, string>> = {};
        RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.forEach(subTab => {
            const candidateQuery = Object.prototype.hasOwnProperty.call(storedSubTabQueries, subTab) ? storedSubTabQueries[subTab] : undefined;
            if ( RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidateQuery) ) {
                troubleshootingSearchQueries[subTab] = candidateQuery;
            }
        });
        return Object.keys(troubleshootingSearchQueries).length > 0 ? troubleshootingSearchQueries : undefined;

    }

    private static readTroubleshootingHistorySort(candidateTree: Record<string, unknown>): IRecipeCockpitPanelTreePlace['troubleshootingHistorySort'] {

        const candidateSort = candidateTree.troubleshootingHistorySort;
        if ( !RecipeCockpitUntrustedValue.isPlainRecord(candidateSort)
                || !( RECIPE_COCKPIT_HISTORY_SORT_COLUMNS as readonly unknown[] ).includes(candidateSort.column)
                || typeof candidateSort.isDescending !== 'boolean'
                || ( candidateSort.column === 'time' && candidateSort.isDescending ) ) {
            return undefined;
        }
        return { column: candidateSort.column as RecipeCockpitHistorySortColumn, isDescending: candidateSort.isDescending };

    }

    /*
        Every optional field a tree's place can hold, in the order it is written: the place is kept as
        JSON, so this order is its key order. A field is written only when its check finds a value.
    */
    static readonly OPTIONAL_TREE_PLACE_FIELDS: readonly OptionalTreePlaceRule[] = Object.freeze<OptionalTreePlaceRule[]>([
        {
            field: 'isDatasetFavoritesOnly',
            check: candidateTree => candidateTree.isDatasetFavoritesOnly === true ? true : undefined,
            reason: 'the Data Sets tab shows its favourites only'
        },
        {
            field: 'expandedJourneyDatasetFolderNames',
            check: candidateTree => RecipeCockpitPanelPlace.namesWhenAny(candidateTree.expandedJourneyDatasetFolderNames, datasetFolderName => DatasetSourceService.isSafeFolderOrFileName(datasetFolderName)),
            reason: 'the data set rows whose insert journey is open (#471), each a safe folder name'
        },
        {
            field: 'isRecordTypesExpanded',
            check: candidateTree => candidateTree.isRecordTypesExpanded === true || candidateTree.selectedTab === 'recordTypes' ? true : undefined,
            reason: 'the Record types section is open; a card saved on the Record types tab, before it became a section (#321), opens with it open'
        },
        {
            field: 'isRecordTypeFieldsOnly',
            check: candidateTree => candidateTree.isRecordTypeFieldsOnly === true ? true : undefined,
            reason: '"Record type fields only" is on (#320)'
        },
        {
            field: 'isTodosOnly',
            check: candidateTree => candidateTree.isTodosOnly === true ? true : undefined,
            reason: '"TODOs only" is on (#354)'
        },
        {
            field: 'todosOnlyObjectKeys',
            check: candidateTree => RecipeCockpitPanelPlace.namesWhenAny(candidateTree.todosOnlyObjectKeys),
            reason: 'the objects whose own "TODOs only" is on (#477)'
        },
        {
            field: 'hideUnselectedObjectKeys',
            check: candidateTree => RecipeCockpitPanelPlace.namesWhenAny(candidateTree.hideUnselectedObjectKeys),
            reason: 'the objects whose own "Hide unselected" is on (#483)'
        },
        {
            field: 'troubleshootingSubTab',
            // THE FIRST SUB-TAB IS THE DEFAULT, SO IT IS NEVER WRITTEN; AN UNKNOWN ONE READS AS IT
            check: candidateTree => RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.slice(1).find(subTab => subTab === candidateTree.troubleshootingSubTab),
            reason: 'the Troubleshooting sub-tab open, when it is not the first (#365)'
        },
        {
            field: 'troubleshootingSearchQueries',
            check: candidateTree => RecipeCockpitPanelPlace.readTroubleshootingSearchQueries(candidateTree),
            reason: 'each Troubleshooting sub-tab\'s search, when it has one (#365)'
        },
        {
            field: 'todosView',
            check: candidateTree => candidateTree.todosView === 'removed' ? 'removed' : undefined,
            reason: 'the TODO\'s sub-tab shows its removed list (#391)'
        },
        {
            field: 'removedTodosSearchText',
            check: candidateTree => RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidateTree.removedTodosSearchText) ? candidateTree.removedTodosSearchText : undefined,
            reason: 'the removed list\'s search, when it has one (#391)'
        },
        {
            field: 'troubleshootingHistorySort',
            check: candidateTree => RecipeCockpitPanelPlace.readTroubleshootingHistorySort(candidateTree),
            reason: 'the History sub-tab\'s sort, when it is not time, newest first (#485)'
        },
        {
            field: 'updaterExpandedObjectKeys',
            check: candidateTree => RecipeCockpitPanelPlace.namesWhenAny(candidateTree.updaterExpandedObjectKeys),
            reason: 'the Treecipe Adapter\'s opened objects (#415)'
        },
        {
            field: 'updaterStep',
            check: candidateTree => candidateTree.updaterStep === 'structure' && RecipeCockpitPanelPlace.readUpdaterParentObjectApiName(candidateTree) !== undefined ? 'structure' : undefined,
            reason: 'the Treecipe Adapter is on step 2 (#443), which needs a parent object; with none it opens on step 1'
        },
        {
            field: 'updaterParentObjectApiName',
            check: candidateTree => RecipeCockpitPanelPlace.readUpdaterParentObjectApiName(candidateTree),
            reason: 'the Treecipe Adapter\'s parent object (#443), an api name'
        },
        {
            field: 'updaterParentWhereText',
            check: candidateTree => typeof candidateTree.updaterParentWhereText === 'string'
                && candidateTree.updaterParentWhereText !== ''
                && candidateTree.updaterParentWhereText.length <= RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH ? candidateTree.updaterParentWhereText : undefined,
            reason: 'the Treecipe Adapter parent\'s WHERE (#443), within the query bound'
        }
    ]);

    /*
        A place read back from workspaceState, or posted by the panel, checked field by field: both
        are text this extension does not control. A place in another shape, or naming no usable run,
        is no place at all; inside one, an entry of the wrong type or past a bound is dropped on its
        own. The run is a folder NAME the caller looks up among the runs on disk, never a path.
    */
    static normalize(candidatePlace: unknown): IRecipeCockpitPanelPlace | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(candidatePlace)
                || ( candidatePlace.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION && candidatePlace.version !== RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB ) ) {
            return undefined;
        }

        const { runFolderName } = candidatePlace;

        if ( !RecipeCockpitPanelPlace.isBoundedText(runFolderName) || runFolderName === '' || !DatasetSourceService.isSafeFolderOrFileName(runFolderName) ) {
            return undefined;
        }

        const isOlderPlace = candidatePlace.version === RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB;
        const scrollY = candidatePlace.scrollY;
        const candidateTrees = Array.isArray(candidatePlace.trees) ? candidatePlace.trees.slice(0, RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES) : [];
        const trees = candidateTrees.flatMap((candidateTree: unknown): IRecipeCockpitPanelTreePlace[] => {
            const treePlace = RecipeCockpitPanelPlace.normalizeTreePlace(candidateTree, isOlderPlace);
            return treePlace ? [treePlace] : [];
        });

        const normalizedPlace: IRecipeCockpitPanelPlace = {
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: runFolderName,
            isOrgPickerInUse: candidatePlace.isOrgPickerInUse === true,
            isFavoritesOnly: candidatePlace.isFavoritesOnly === true,
            ...( candidatePlace.isHelpExpanded === true ? { isHelpExpanded: true as const } : {} ),
            ...( RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidatePlace.selectedTreeKey) ? { selectedTreeKey: candidatePlace.selectedTreeKey } : {} ),
            ...( RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidatePlace.treecipesSearchText) ? { treecipesSearchText: candidatePlace.treecipesSearchText } : {} ),
            scrollY: typeof scrollY === 'number' && Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0,
            trees: trees
        };

        // TOO LARGE TO BE A PLACE A READER MADE BY HAND, SO NOT ONE TO KEEP OR RESTORE
        return JSON.stringify(normalizedPlace).length <= RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH ? normalizedPlace : undefined;

    }

    // AN OLDER PLACE'S TAB NAMES ARE READ AS THE TABS THEY BECAME, AND A TAB SINCE REMOVED AS NONE AT ALL
    private static readTabName(candidateTabName: unknown, isOlderPlace: boolean): unknown {

        const renamedTabName = isOlderPlace && typeof candidateTabName === 'string' && Object.prototype.hasOwnProperty.call(RECIPE_COCKPIT_TREE_TAB_RENAMES, candidateTabName)
            ? RECIPE_COCKPIT_TREE_TAB_RENAMES[candidateTabName]
            : candidateTabName;
        return typeof renamedTabName === 'string' && RECIPE_COCKPIT_REMOVED_TREE_TABS.includes(renamedTabName) ? undefined : renamedTabName;

    }

    private static readSearchQueries(candidateTree: Record<string, unknown>, isOlderPlace: boolean): Partial<Record<RecipeCockpitTreeTab, string>> {

        const storedQueries = RecipeCockpitUntrustedValue.isPlainRecord(candidateTree.searchQueries) ? candidateTree.searchQueries : {};
        const candidateQueries: Record<string, unknown> = Object.create(null);
        Object.keys(storedQueries).forEach(storedTabName => {
            const tabName = RecipeCockpitPanelPlace.readTabName(storedTabName, isOlderPlace);
            if ( typeof tabName === 'string' ) {
                candidateQueries[tabName] = storedQueries[storedTabName];
            }
        });

        const searchQueries: Partial<Record<RecipeCockpitTreeTab, string>> = {};
        RECIPE_COCKPIT_TREE_TABS.forEach(tabName => {
            const candidateQuery = Object.prototype.hasOwnProperty.call(candidateQueries, tabName) ? candidateQueries[tabName] : undefined;
            // A TAB ADDED SINCE THE PLACE VERSION (#346) HAS NO SEARCH OF ITS OWN SINCE #365, SO A PLACE READS AS IT DID BEFORE THE TAB
            if ( RECIPE_COCKPIT_TABS_WITHOUT_SEARCH.includes(tabName) ) {
                return;
            }
            if ( RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS.includes(tabName) && !RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidateQuery) ) {
                return;
            }
            searchQueries[tabName] = RecipeCockpitPanelPlace.isBoundedText(candidateQuery) ? candidateQuery : '';
        });
        return searchQueries;

    }

    // ONE CARD'S PLACE, OR NONE WHEN IT NAMES NO TREE; ITS OPTIONAL FIELDS ARE OPTIONAL_TREE_PLACE_FIELDS, RUN IN ORDER
    static normalizeTreePlace(candidateTree: unknown, isOlderPlace: boolean = false): IRecipeCockpitPanelTreePlace | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(candidateTree) || !RecipeCockpitPanelPlace.isNonEmptyBoundedText(candidateTree.treeKey) ) {
            return undefined;
        }

        const candidateSelectedTab = RecipeCockpitPanelPlace.readTabName(candidateTree.selectedTab, isOlderPlace);
        const treePlace: IRecipeCockpitPanelTreePlace = {
            treeKey: candidateTree.treeKey,
            isExpanded: candidateTree.isExpanded === true,
            selectedTab: RECIPE_COCKPIT_TREE_TABS.find(tabName => tabName === candidateSelectedTab) ?? 'treecipe',
            searchQueries: RecipeCockpitPanelPlace.readSearchQueries(candidateTree, isOlderPlace),
            expandedObjectKeys: RecipeCockpitPanelPlace.normalizePlaceNames(candidateTree.expandedObjectKeys),
            openPicklistKeys: RecipeCockpitPanelPlace.normalizePlaceNames(candidateTree.openPicklistKeys)
        };

        const optionalFields = treePlace as unknown as Record<OptionalTreePlaceField, unknown>;
        RecipeCockpitPanelPlace.OPTIONAL_TREE_PLACE_FIELDS.forEach(optionalTreePlaceRule => {
            const fieldValue = optionalTreePlaceRule.check(candidateTree);
            if ( fieldValue !== undefined ) {
                optionalFields[optionalTreePlaceRule.field] = fieldValue;
            }
        });

        return treePlace;

    }

    static isTreeFocus(focusRequest: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest): focusRequest is IRecipeCockpitTreeFocus {

        return typeof (focusRequest as IRecipeCockpitTreeFocus).treeKey === 'string';

    }

    static isTroubleshootingFocusRequest(focusRequest: IRecipeCockpitTreeFocus | RecipeCockpitOpenFocusRequest): focusRequest is IRecipeCockpitTroubleshootingFocusRequest {

        return typeof (focusRequest as IRecipeCockpitTroubleshootingFocusRequest).treeFolderName === 'string';

    }

    /*
        The options "treecipe.openRecipeCockpit" was run with. The command is callable by id, so only
        { focusRecordTypes: true } asks for the Record types section, and an object name is kept only
        if it is an api name -- it is matched against the loaded model and scrolled to, never opened.
    */
    static readRecordTypesFocusRequest(openOptions: unknown): IRecipeCockpitRecordTypesFocusRequest | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(openOptions) || openOptions.focusRecordTypes !== true ) {
            return undefined;
        }

        return SalesforceApiName.isApiName(openOptions.objectApiName) ? { objectApiName: openOptions.objectApiName } : {};

    }

    /*
        The options "treecipe.openRecipeCockpit" was run with, for "Open Troubleshooting" (#375). The
        command is callable by id, so the run and tree are kept only as plain folder NAMES and the
        sub-tab only when it is one the tab draws; they are matched against the loaded run, never opened.
    */
    static readTroubleshootingFocusRequest(openOptions: unknown): IRecipeCockpitTroubleshootingFocusRequest | undefined {

        if ( !RecipeCockpitUntrustedValue.isPlainRecord(openOptions) || openOptions.focusTroubleshooting !== true ) {
            return undefined;
        }

        const { runFolderName, treeFolderName, troubleshootingSubTab } = openOptions;
        const isFolderName = (candidate: unknown): candidate is string => RecipeCockpitPanelPlace.isBoundedText(candidate) && candidate !== '' && DatasetSourceService.isSafeFolderOrFileName(candidate);

        if ( !isFolderName(runFolderName) || !isFolderName(treeFolderName) || !( RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS as readonly unknown[] ).includes(troubleshootingSubTab) ) {
            return undefined;
        }

        return { runFolderName: runFolderName, treeFolderName: treeFolderName, troubleshootingSubTab: troubleshootingSubTab as RecipeCockpitTroubleshootingSubTab };

    }

}
