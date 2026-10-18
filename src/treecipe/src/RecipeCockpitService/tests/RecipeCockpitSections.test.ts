import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_NO_RUN_MESSAGE,
    RECIPE_COCKPIT_ORG_SECTION_TITLE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING,
    RECIPE_COCKPIT_TREECIPES_SECTION_TITLE
} from '../RecipeCockpitService';
import { IPanelScriptOptions, runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #348: the org controls are one section under the toolbar, and every tree card is in a
    Treecipes section under it. The org picker is drawn once, never inside a card.
    #355: the org section is titled Target Org Management and never folds.
    #364: the Treecipes section never folds either, and the org section is pinned to the top of
    the panel while the cards scroll under it; neither fold is kept with the reader's place.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEAD_TREE_KEY = 'Lead-ONLY';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

type Panel = ReturnType<typeof runPanelScript>;

const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel, panelScriptOptions: IPanelScriptOptions = {}, focusTree?: any) => {
    const panel = runPanelScript(panelScriptOptions);
    panel.postToPanel({ command: 'recipeData', recipe, renderSequence: 1, ...( focusTree ? { focusTree } : {} ) });
    return panel;
};

const sectionOf = (panel: Panel, sectionId: string) => panel.findAll(panel.cockpitBodyElement, 'cockpitSection')
    .find((sectionElement: any) => sectionElement.attributes.id === sectionId);
const orgSectionOf = (panel: Panel) => sectionOf(panel, 'cockpitOrgSection');
const treecipesSectionOf = (panel: Panel) => sectionOf(panel, 'cockpitTreecipesSection');
const headerOf = (sectionElement: any) => sectionElement.children[0];
const bodyOf = (sectionElement: any) => sectionElement.children[1];
const expectSectionAlwaysOpen = (panel: Panel, sectionElement: any) => {
    expect(sectionElement).toBeDefined();
    expect(panel.isHidden(bodyOf(sectionElement))).toBeFalse();
    expect(headerOf(sectionElement).children.map((element: any) => element.tagName)).toEqual(['span']);
    expect(headerOf(sectionElement).classList.contains('cockpitSectionStatic')).toBeTrue();
    expect(headerOf(sectionElement).attributes).not.toHaveProperty('aria-expanded');
    expect(headerOf(sectionElement).attributes).not.toHaveProperty('aria-controls');
};
const expectOrgSectionAlwaysOpen = (panel: Panel) => expectSectionAlwaysOpen(panel, orgSectionOf(panel));
const expectTreecipesSectionAlwaysOpen = (panel: Panel) => {
    expectSectionAlwaysOpen(panel, treecipesSectionOf(panel));
    panel.treeCards().forEach((treeCard: any) => expect(panel.isHidden(treeCard)).toBeFalse());
};
const commandsPosted = (panel: Panel) => panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);

const savedPlace = (extra: Record<string, unknown>) => ({
    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    runFolderName: CURRENT_RUN_FOLDER_NAME,
    isOrgPickerInUse: false,
    isFavoritesOnly: false,
    scrollY: 0,
    trees: [],
    ...extra
});

describe('RecipeCockpitService, the Target Org Management and Treecipes sections (#348, #355)', () => {

    describe('the layout', () => {

        it('titles the org section Target Org Management, on its header and its aria-label', () => {

            const panel = drawRecipe(loadRecipe());

            expect(RECIPE_COCKPIT_ORG_SECTION_TITLE).toBe('Target Org Management');
            expect(orgSectionOf(panel).attributes['aria-label']).toBe('Target Org Management');

        });

        it('draws the toolbar, then the Org section, then the Treecipes section holding every card', () => {

            const panel = drawRecipe(loadRecipe());
            const bodyChildren = panel.cockpitBodyElement.children;
            const orgIndex = bodyChildren.indexOf(orgSectionOf(panel));
            const treecipesIndex = bodyChildren.indexOf(treecipesSectionOf(panel));

            expect(bodyChildren[0].classList.contains('toolbar')).toBeTrue();
            expect(orgIndex).toBeGreaterThan(0);
            expect(treecipesIndex).toBe(orgIndex + 1);
            expect(panel.findAll(headerOf(orgSectionOf(panel)), 'cockpitSectionTitle').map((element: any) => element.textContent)).toEqual([RECIPE_COCKPIT_ORG_SECTION_TITLE]);
            expect(panel.findAll(headerOf(treecipesSectionOf(panel)), 'cockpitSectionTitle').map((element: any) => element.textContent)).toEqual([RECIPE_COCKPIT_TREECIPES_SECTION_TITLE]);
            expect(panel.findAll(bodyOf(treecipesSectionOf(panel)), 'treeCard')).toEqual(panel.treeCards());
            expect(panel.treeCards().length).toBeGreaterThan(1);

        });

        it('draws the org picker exactly once, in the Org section, however many cards are opened, and none inside a card', () => {

            const panel = drawRecipe(loadRecipe());
            panel.expandAllTrees();

            const viewElements = panel.findAll(panel.cockpitBodyElement, 'dataOrgView');
            expect(viewElements).toHaveLength(1);
            expect(panel.findAll(orgSectionOf(panel), 'dataOrgView')).toEqual(viewElements);
            ['dataOrgLoad', 'dataOrgSelect', 'dataOrgOpen', 'dataOrgRefresh', 'dataOrgNewScratch', 'dataOrgStatus', 'dataOrgHiddenNote'].forEach(className => {
                expect(panel.findAll(viewElements[0], className)).toHaveLength(1);
            });
            panel.treeCards().forEach((treeCard: any) => {
                expect(panel.findAll(treeCard, 'dataOrgView')).toEqual([]);
                expect(panel.findAll(panel.findAll(treeCard, 'treecipeHeader')[0], 'treeInsert')).toHaveLength(1);
            });

        });

        it('draws both sections with no toggle and their bodies always shown (#355, #364)', () => {

            const panel = drawRecipe(loadRecipe());

            expectOrgSectionAlwaysOpen(panel);
            expectTreecipesSectionAlwaysOpen(panel);
            expect(bodyOf(orgSectionOf(panel)).attributes.id).toBe('cockpitOrgSectionBody');
            expect(bodyOf(treecipesSectionOf(panel)).attributes.id).toBe('cockpitTreecipesSectionBody');
            expect(panel.findAll(panel.cockpitBodyElement, 'cockpitSectionToggle')).toEqual([]);

        });

        it('leaves the org section open on a click on its header or title, and saves nothing for it', () => {

            const panel = drawRecipe(loadRecipe());

            headerOf(orgSectionOf(panel)).dispatch('click');
            panel.findAll(headerOf(orgSectionOf(panel)), 'cockpitSectionTitle')[0].dispatch('click');

            expectOrgSectionAlwaysOpen(panel);
            expectTreecipesSectionAlwaysOpen(panel);
            expect(panel.savedState() ?? {}).not.toHaveProperty('isOrgSectionCollapsed');

        });

        it('leaves the Treecipes section open on a click on its header or title, and saves nothing for it (#364)', () => {

            const panel = drawRecipe(loadRecipe());

            headerOf(treecipesSectionOf(panel)).dispatch('click');
            panel.findAll(headerOf(treecipesSectionOf(panel)), 'cockpitSectionTitle')[0].dispatch('click');

            expectTreecipesSectionAlwaysOpen(panel);
            expectOrgSectionAlwaysOpen(panel);
            expect(panel.savedState() ?? {}).not.toHaveProperty('isTreecipesSectionCollapsed');

        });

        it('draws no Org section when no card can generate, and still draws the Treecipes section', () => {

            const recipe = loadRecipe();
            const panel = drawRecipe({ ...recipe, trees: recipe.trees.map(tree => ({ ...tree, runFakerRecipeFileName: undefined })) });

            expect(orgSectionOf(panel)).toBeUndefined();
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgView')).toEqual([]);
            expectTreecipesSectionAlwaysOpen(panel);

        });

        it('draws neither section for a run with no trees, nor for the empty state with no run', () => {

            const recipe = loadRecipe();
            const noTreesPanel = drawRecipe({ ...recipe, trees: [] });

            expect(sectionsOf(noTreesPanel)).toEqual([]);
            expect(noTreesPanel.findAll(noTreesPanel.cockpitBodyElement, 'emptyState').map((element: any) => element.textContent).join(' ')).toContain('no relationship trees');

            const noRunPanel = drawRecipe({ runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE });

            expect(sectionsOf(noRunPanel)).toEqual([]);
            expect(noRunPanel.findAll(noRunPanel.cockpitBodyElement, 'dataOrgView')).toEqual([]);
            expect(noRunPanel.findAll(noRunPanel.cockpitBodyElement, 'generateTreecipe')).toHaveLength(1);

        });

        it('asks the host for no orgs when the panel opens, nor when a section is opened or closed', () => {

            const panel = drawRecipe(loadRecipe());

            headerOf(orgSectionOf(panel)).dispatch('click');
            headerOf(treecipesSectionOf(panel)).dispatch('click');
            headerOf(treecipesSectionOf(panel)).dispatch('click');

            expect(commandsPosted(panel)).not.toContain('loadDataOrgs');

        });

        it('pins the org section to the top of the panel over the cards, on the page colour, and pads a scrolled-to row below it (#364)', () => {

            const shellHtml = RecipeCockpitService.buildWebviewShellHtml('nonce');
            const pinnedRule = shellHtml.split('\n').find(line => line.trim().startsWith('#cockpitOrgSection {'));

            expect(pinnedRule).toBeDefined();
            expect(pinnedRule).toContain('position: sticky;');
            expect(pinnedRule).toContain('top: 0;');
            expect(pinnedRule).toContain('background-color: var(--sdt-page);');
            const zIndex = Number(/z-index: (\d+);/.exec(pinnedRule ?? '')?.[1]);
            const otherZIndexes = (shellHtml.match(/z-index: \d+;/g) ?? []).map(rule => Number(/\d+/.exec(rule)?.[0])).filter(value => value !== zIndex);
            expect(zIndex).toBeGreaterThan(Math.max(...otherZIndexes));
            expect(shellHtml).toContain(`html:has(#cockpitOrgSection) { scroll-padding-top: ${RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING}; }`);
            expect(shellHtml).not.toMatch(/\.(toolbar|helpSection|cockpitHeader)[^{]*\{[^}]*position: sticky/);

        });

        it('styles the sections only from the palette', () => {

            const shellHtml = RecipeCockpitService.buildWebviewShellHtml('nonce');
            const sectionRules = shellHtml.split('\n').filter(line => /cockpitSection|cockpitOrgSectionBody/.test(line) && line.includes('{'));

            expect(sectionRules.length).toBeGreaterThan(0);
            sectionRules.forEach(rule => {
                expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
                expect(rule).not.toContain('--vscode-');
            });

        });

    });

    describe('the place', () => {

        it('saves neither fold with the place, whatever the reader clicked (#364)', () => {

            jest.useFakeTimers();
            try {

                const panel = drawRecipe(loadRecipe());
                headerOf(treecipesSectionOf(panel)).dispatch('click');
                headerOf(orgSectionOf(panel)).dispatch('click');
                panel.expandAllTrees();

                expect(panel.savedState()).not.toHaveProperty('isTreecipesSectionCollapsed');
                expect(panel.savedState()).not.toHaveProperty('isOrgSectionCollapsed');
                panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace').forEach((hostMessage: any) => {
                    expect(hostMessage.place).not.toHaveProperty('isTreecipesSectionCollapsed');
                    expect(hostMessage.place).not.toHaveProperty('isOrgSectionCollapsed');
                });

            } finally {
                jest.useRealTimers();
            }

        });

        it('reads a place saved before the sections as both open', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({}) });

            expectOrgSectionAlwaysOpen(panel);
            expectTreecipesSectionAlwaysOpen(panel);

        });

        it('opens both sections for a place saved by 3.98.0+ with either folded, whatever the value (#355, #364)', () => {

            [true, 'yes', 1, false].forEach(collapsedValue => {
                const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isOrgSectionCollapsed: collapsedValue, isTreecipesSectionCollapsed: collapsedValue }) });

                expectOrgSectionAlwaysOpen(panel);
                expectTreecipesSectionAlwaysOpen(panel);
                expect(commandsPosted(panel)).not.toContain('renderFailed');
                expect(panel.savedState() ?? {}).not.toHaveProperty('isTreecipesSectionCollapsed');
            });

        });

        it('keeps both sections open across a reload of the same run in the same document', () => {

            const panel = drawRecipe(loadRecipe());
            headerOf(treecipesSectionOf(panel)).dispatch('click');

            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 2 });

            expectTreecipesSectionAlwaysOpen(panel);
            expectOrgSectionAlwaysOpen(panel);

        });

        it('drops isTreecipesSectionCollapsed and isOrgSectionCollapsed on the host, and the place version did not change', () => {

            [true, 'yes', 1].forEach(collapsedValue => {
                const normalized = RecipeCockpitService.normalizePanelPlace(savedPlace({ isOrgSectionCollapsed: collapsedValue, isTreecipesSectionCollapsed: collapsedValue }));
                expect(normalized).not.toBeUndefined();
                expect(normalized).not.toHaveProperty('isOrgSectionCollapsed');
                expect(normalized).not.toHaveProperty('isTreecipesSectionCollapsed');
            });
            expect(RECIPE_COCKPIT_PANEL_PLACE_VERSION).toBe(2);

        });

        it('opens a focused card for a place saved with the Treecipes section folded', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isTreecipesSectionCollapsed: true, isOrgSectionCollapsed: true }) }, { treeKey: LEAD_TREE_KEY, tab: 'treecipe' });
            const leadCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === LEAD_TREE_KEY);

            expectTreecipesSectionAlwaysOpen(panel);
            expectOrgSectionAlwaysOpen(panel);
            expect(panel.isHidden(panel.findAll(leadCard, 'treeBody')[0])).toBeFalse();
            expect(panel.savedState()).not.toHaveProperty('isTreecipesSectionCollapsed');

        });

    });

});

function sectionsOf(panel: Panel) {
    return panel.findAll(panel.cockpitBodyElement, 'cockpitSection');
}
