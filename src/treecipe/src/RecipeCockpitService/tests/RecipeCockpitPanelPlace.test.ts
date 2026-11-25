import * as fs from 'fs';
import * as path from 'path';
import { IRecipeCockpitPanelTreePlace, RecipeCockpitPanelPlace } from '../RecipeCockpitPanelPlace';
import { RECIPE_COCKPIT_PANEL_PLACE_VERSION, RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB } from '../RecipeCockpitShellConstants';

// NO jest.mock('vscode') IN THIS FILE: THE MODULE LOADING HERE AT ALL IS THE PROOF IT NEEDS NONE (#670)
describe('RecipeCockpitPanelPlace (#670)', () => {

    const everyOptionalTreeField: Required<Omit<IRecipeCockpitPanelTreePlace, 'treeKey' | 'isExpanded' | 'selectedTab' | 'searchQueries' | 'expandedObjectKeys' | 'openPicklistKeys'>> = {
        isDatasetFavoritesOnly: true,
        expandedJourneyDatasetFolderNames: ['dataset-1'],
        isRecordTypesExpanded: true,
        isRecordTypeFieldsOnly: true,
        isTodosOnly: true,
        todosOnlyObjectKeys: ['Account'],
        hideUnselectedObjectKeys: ['Contact'],
        troubleshootingSubTab: 'history',
        troubleshootingSearchQueries: { todos: 'phone' },
        todosView: 'removed',
        removedTodosSearchText: 'email',
        troubleshootingHistorySort: { column: 'step', isDescending: false },
        updaterExpandedObjectKeys: ['Account'],
        updaterStep: 'structure',
        updaterParentObjectApiName: 'Account',
        updaterParentWhereText: "Name LIKE 'A%'"
    };

    const buildTreePlace = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        treeKey: 'Account-thru-Contact',
        isExpanded: true,
        selectedTab: 'treecipe',
        searchQueries: { treecipe: '', datasets: '' },
        expandedObjectKeys: ['Account'],
        openPicklistKeys: [],
        ...overrides
    });

    test('the named list holds every optional field of a tree place, once, in the order the place is written', () => {

        expect(RecipeCockpitPanelPlace.OPTIONAL_TREE_PLACE_FIELDS.map(optionalField => optionalField.field)).toEqual(Object.keys(everyOptionalTreeField));

    });

    test('every entry says why the field is kept', () => {

        RecipeCockpitPanelPlace.OPTIONAL_TREE_PLACE_FIELDS.forEach(optionalField => {
            expect(optionalField.reason.trim()).not.toBe('');
        });

    });

    test('a tree place with every field round-trips, key order included, since the place is kept as JSON', () => {

        const treePlace = buildTreePlace(everyOptionalTreeField);

        expect(JSON.stringify(RecipeCockpitPanelPlace.normalizeTreePlace(treePlace))).toBe(JSON.stringify(treePlace));

    });

    test('a tree place with no optional field gets none, and never a default', () => {

        expect(RecipeCockpitPanelPlace.normalizeTreePlace(buildTreePlace())).toEqual(buildTreePlace());

    });

    test.each([
        ['no tree key', buildTreePlace({ treeKey: '' })],
        ['a tree key that is not text', buildTreePlace({ treeKey: 7 })],
        ['a list', []],
        ['nothing', null]
    ])('%s is no tree place', (unusedCase, candidateTree) => {

        expect(RecipeCockpitPanelPlace.normalizeTreePlace(candidateTree)).toBeUndefined();

    });

    test('an older place\'s tab names read as the tabs they became, only for an older place', () => {

        const olderTree = buildTreePlace({ selectedTab: 'structure', searchQueries: { structure: 'acc' } });

        expect(RecipeCockpitPanelPlace.normalizeTreePlace(olderTree, true)).toMatchObject({ selectedTab: 'treecipe', searchQueries: { treecipe: 'acc' } });
        expect(RecipeCockpitPanelPlace.normalizeTreePlace(olderTree, false)).toMatchObject({ selectedTab: 'treecipe', searchQueries: { treecipe: '' } });

    });

    test('normalize reads each tree through normalizeTreePlace, as the place\'s version says', () => {

        const place = (version: number) => ({ version, runFolderName: 'recipe-1', isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0, trees: [buildTreePlace({ selectedTab: 'structure' }), buildTreePlace({ treeKey: '' })] });

        expect(RecipeCockpitPanelPlace.normalize(place(RECIPE_COCKPIT_PANEL_PLACE_VERSION_BEFORE_TREECIPE_TAB))?.trees).toEqual([RecipeCockpitPanelPlace.normalizeTreePlace(buildTreePlace({ selectedTab: 'structure' }), true)]);
        expect(RecipeCockpitPanelPlace.normalize(place(RECIPE_COCKPIT_PANEL_PLACE_VERSION))?.version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);

    });

    test('the module imports no vscode, and nothing from the hub', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitPanelPlace.ts'), 'utf8');

        expect(sourceText).not.toMatch(/from 'vscode'/);
        expect(sourceText).not.toMatch(/from '\.\/RecipeCockpitService'/);

    });

});
