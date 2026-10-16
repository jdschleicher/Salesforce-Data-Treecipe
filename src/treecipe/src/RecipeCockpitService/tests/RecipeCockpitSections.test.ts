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
    RECIPE_COCKPIT_TREECIPES_SECTION_TITLE
} from '../RecipeCockpitService';
import { IPanelScriptOptions, runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #348: the org controls are one section under the toolbar, and every tree card is in a
    Treecipes section under it. The org picker is drawn once, never inside a card.
    #355: the org section is titled Target Org Management and never folds; only the Treecipes
    header is a toggle, and only whether IT was closed is kept with the reader's place.
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
const toggleOf = (sectionElement: any) => headerOf(sectionElement).children[0];
const bodyOf = (sectionElement: any) => sectionElement.children[1];
const isOpen = (panel: Panel, sectionElement: any) => toggleOf(sectionElement).attributes['aria-expanded'] === 'true' && !panel.isHidden(bodyOf(sectionElement));
const expectOrgSectionAlwaysOpen = (panel: Panel) => {
    const sectionElement = orgSectionOf(panel);
    expect(panel.isHidden(bodyOf(sectionElement))).toBeFalse();
    expect(panel.findAll(headerOf(sectionElement), 'cockpitSectionToggle')).toEqual([]);
    expect(headerOf(sectionElement).children.map((element: any) => element.tagName)).toEqual(['span']);
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

        it('draws the org section with no toggle and its body always shown, and the Treecipes section open with a toggle that names its body', () => {

            const panel = drawRecipe(loadRecipe());

            expectOrgSectionAlwaysOpen(panel);
            expect(bodyOf(orgSectionOf(panel)).attributes.id).toBe('cockpitOrgSectionBody');
            expect(headerOf(orgSectionOf(panel)).classList.contains('cockpitSectionStatic')).toBeTrue();
            panel.findAll(orgSectionOf(panel), 'cockpitSectionHeader').forEach((element: any) => {
                expect(element.attributes).not.toHaveProperty('aria-expanded');
                expect(element.attributes).not.toHaveProperty('aria-controls');
            });

            const treecipesSection = treecipesSectionOf(panel);
            expect(isOpen(panel, treecipesSection)).toBeTrue();
            expect(bodyOf(treecipesSection).attributes.id).toBe('cockpitTreecipesSectionBody');
            expect(toggleOf(treecipesSection).attributes['aria-controls']).toBe('cockpitTreecipesSectionBody');
            expect(toggleOf(treecipesSection).tagName).toBe('button');

        });

        it('leaves the org section open on a click on its header or title, and saves nothing for it', () => {

            const panel = drawRecipe(loadRecipe());

            headerOf(orgSectionOf(panel)).dispatch('click');
            panel.findAll(headerOf(orgSectionOf(panel)), 'cockpitSectionTitle')[0].dispatch('click');

            expectOrgSectionAlwaysOpen(panel);
            expect(isOpen(panel, treecipesSectionOf(panel))).toBeTrue();
            expect(panel.savedState() ?? {}).not.toHaveProperty('isOrgSectionCollapsed');

        });

        it('closes and reopens the Treecipes section from a click anywhere on its header, without touching the org section', () => {

            const panel = drawRecipe(loadRecipe());

            panel.findAll(headerOf(treecipesSectionOf(panel)), 'cockpitSectionTitle')[0].dispatch('click');

            expect(isOpen(panel, treecipesSectionOf(panel))).toBeFalse();
            expect(toggleOf(treecipesSectionOf(panel)).attributes['aria-expanded']).toBe('false');
            expectOrgSectionAlwaysOpen(panel);

            toggleOf(treecipesSectionOf(panel)).dispatch('click');

            expect(isOpen(panel, treecipesSectionOf(panel))).toBeTrue();

        });

        it('draws no Org section when no card can generate, and still draws the Treecipes section', () => {

            const recipe = loadRecipe();
            const panel = drawRecipe({ ...recipe, trees: recipe.trees.map(tree => ({ ...tree, runFakerRecipeFileName: undefined })) });

            expect(orgSectionOf(panel)).toBeUndefined();
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgView')).toEqual([]);
            expect(isOpen(panel, treecipesSectionOf(panel))).toBeTrue();

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

        it('saves a closed Treecipes section with the place, and restores it closed in a rebuilt document', () => {

            jest.useFakeTimers();
            try {

                const hiddenPanel = drawRecipe(loadRecipe());
                headerOf(treecipesSectionOf(hiddenPanel)).dispatch('click');

                expect(hiddenPanel.savedState()).toMatchObject({ isTreecipesSectionCollapsed: true });
                expect(hiddenPanel.savedState()).not.toHaveProperty('isOrgSectionCollapsed');
                const savePlaceMessages = hiddenPanel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace');
                expect(savePlaceMessages.at(-1).place).toMatchObject({ isTreecipesSectionCollapsed: true });
                expect(savePlaceMessages.at(-1).place).not.toHaveProperty('isOrgSectionCollapsed');

                const panel = drawRecipe(loadRecipe(), { savedState: hiddenPanel.savedState() });

                expectOrgSectionAlwaysOpen(panel);
                expect(isOpen(panel, treecipesSectionOf(panel))).toBeFalse();
                expect(toggleOf(treecipesSectionOf(panel)).classList.contains('noMotion')).toBeTrue();
                expect(bodyOf(treecipesSectionOf(panel)).classList.contains('motionConceal')).toBeFalse();

            } finally {
                jest.useRealTimers();
            }

        });

        it('saves neither field while the Treecipes section is open', () => {

            const panel = drawRecipe(loadRecipe());
            headerOf(treecipesSectionOf(panel)).dispatch('click');
            headerOf(treecipesSectionOf(panel)).dispatch('click');

            expect(panel.savedState()).not.toHaveProperty('isOrgSectionCollapsed');
            expect(panel.savedState()).not.toHaveProperty('isTreecipesSectionCollapsed');

        });

        it('reads a place saved before the sections as both open', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({}) });

            expectOrgSectionAlwaysOpen(panel);
            expect(isOpen(panel, treecipesSectionOf(panel))).toBeTrue();

        });

        it('opens the org section for a place saved by 3.98.0 with it folded, whatever the value (#355)', () => {

            [true, 'yes', 1, false].forEach(isOrgSectionCollapsed => {
                const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isOrgSectionCollapsed, isTreecipesSectionCollapsed: true }) });

                expectOrgSectionAlwaysOpen(panel);
                expect(isOpen(panel, treecipesSectionOf(panel))).toBeFalse();
                expect(commandsPosted(panel)).not.toContain('renderFailed');
            });

        });

        it('keeps a closed section across a reload of the same run in the same document', () => {

            const panel = drawRecipe(loadRecipe());
            headerOf(treecipesSectionOf(panel)).dispatch('click');

            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 2 });

            expect(isOpen(panel, treecipesSectionOf(panel))).toBeFalse();
            expectOrgSectionAlwaysOpen(panel);

        });

        it('keeps isTreecipesSectionCollapsed on the host only when it is exactly true, drops isOrgSectionCollapsed, and the place version did not change', () => {

            const normalized = RecipeCockpitService.normalizePanelPlace(savedPlace({ isOrgSectionCollapsed: true, isTreecipesSectionCollapsed: true }));
            expect(normalized).not.toBeUndefined();
            expect(normalized).not.toHaveProperty('isOrgSectionCollapsed');
            expect(normalized?.isTreecipesSectionCollapsed).toBeTrue();

            const notTrue = RecipeCockpitService.normalizePanelPlace(savedPlace({ isOrgSectionCollapsed: 'yes', isTreecipesSectionCollapsed: 1 }));
            expect(notTrue).not.toHaveProperty('isOrgSectionCollapsed');
            expect(notTrue).not.toHaveProperty('isTreecipesSectionCollapsed');
            expect(RecipeCockpitService.normalizePanelPlace(savedPlace({}))).not.toHaveProperty('isOrgSectionCollapsed');
            expect(RECIPE_COCKPIT_PANEL_PLACE_VERSION).toBe(2);

        });

        it('opens a closed Treecipes section for a focus onto one of its cards', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isTreecipesSectionCollapsed: true }) }, { treeKey: LEAD_TREE_KEY, tab: 'treecipe' });
            const leadCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === LEAD_TREE_KEY);

            expect(isOpen(panel, treecipesSectionOf(panel))).toBeTrue();
            expect(panel.isHidden(panel.findAll(leadCard, 'treeBody')[0])).toBeFalse();
            expect(panel.savedState()).not.toHaveProperty('isTreecipesSectionCollapsed');

        });

        it('draws the org section open for a focus onto a card', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isOrgSectionCollapsed: true }) }, { treeKey: LEAD_TREE_KEY, tab: 'treecipe' });

            expectOrgSectionAlwaysOpen(panel);

        });

    });

});

function sectionsOf(panel: Panel) {
    return panel.findAll(panel.cockpitBodyElement, 'cockpitSection');
}
