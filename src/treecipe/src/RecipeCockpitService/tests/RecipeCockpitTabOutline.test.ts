import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_SEARCH_GLYPH_PATH,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The selected tab and its content as one outline, and a magnifier in every search box (#373).
    The outline is CSS keyed on the selected class the panel already sets, so the panel's part is a
    class on every tab panel; the icon is inline SVG built node by node, hidden from a screen reader,
    and a click on it focuses its input.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
    TREE_WORKSPACE_ROOT,
    RUN_FOLDER_NAME
).recipeViewModel;

const loadHistoryRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
    HISTORY_WORKSPACE_ROOT
).recipeViewModel;

type Panel = ReturnType<typeof runPanelScript>;

const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel): Panel => {
    const panel = runPanelScript({});
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const styleSheet = (() => {
    const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
    return shellHtml.substring(shellHtml.indexOf('<style'), shellHtml.indexOf('</style>'));
})();

const tabPanelsOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'treeTabPanel');

// EVERY SEARCH BOX THE CARDS DRAW ONCE EVERY TAB AND SUB-TAB IS OPEN
const openEverySearch = (panel: Panel) => {
    panel.treeCards().forEach((treeCard: any) => {
        panel.findAll(treeCard, 'treeTab').forEach((tabElement: any) => tabElement.dispatch('click'));
        panel.findAll(treeCard, 'troubleshootingSubTab').forEach((tabElement: any) => tabElement.dispatch('click'));
    });
    return panel.treeCards().flatMap((treeCard: any) => panel.findAll(treeCard, 'tabSearch'));
};

const iconOf = (panel: Panel, searchElement: any) => panel.findAll(searchElement, 'tabSearchField')[0].children[0];

describe('RecipeCockpitService, the selected tab\'s outline and the search icon (#373)', () => {

    describe('the outline', () => {

        it('gives every tab panel the class the outline is drawn on, beside its own', () => {

            const panel = drawRecipe(loadHistoryRecipe());

            panel.treeCards().forEach((treeCard: any) => {
                const tabCount = panel.findAll(treeCard, 'treeTab').length;
                const tabPanels = tabPanelsOf(panel, treeCard);
                expect(tabPanels).toHaveLength(tabCount);
                tabPanels.forEach((panelElement: any) => expect(panelElement.attributes.role).toBe('tabpanel'));
            });
            const [firstCard] = panel.treeCards();
            expect(tabPanelsOf(panel, firstCard).map((panelElement: any) => panelElement.className.split(' ')[0]))
                .toEqual(['treeStructure', 'treeDatasets', 'treeTroubleshooting', 'treeQueries']);

        });

        it('outlines a card with one tab too', () => {

            const recipe = loadRecipe();
            recipe.trees.forEach((tree: any) => { delete tree.folderName; delete tree.history; });
            const panel = drawRecipe(recipe);

            panel.treeCards().forEach((treeCard: any) => {
                expect(panel.findAll(treeCard, 'treeTab')).toHaveLength(1);
                expect(tabPanelsOf(panel, treeCard)).toHaveLength(1);
                expect(panel.isHidden(tabPanelsOf(panel, treeCard)[0])).toBe(false);
            });

        });

        it('draws the selected tab and its panel in the accent, with no line between them and no rule under the strip', () => {

            expect(styleSheet).toMatch(/\.treeTabs \.treeTab\.selected\.sdtButton, \.troubleshootingSubTabs \.troubleshootingSubTab\.selected\.sdtButton \{[^}]*margin-bottom: -1px;[^}]*border-color: var\(--sdt-accent\);[^}]*border-bottom-color: var\(--sdt-surface\);[^}]*background-color: var\(--sdt-surface\);/);
            expect(styleSheet).toMatch(/\.treeTabPanel, \.troubleshootingSubPanel \{[^}]*border: 1px solid var\(--sdt-accent\);[^}]*background-color: var\(--sdt-surface\);/);
            expect(styleSheet.match(/\.treeTabs \{[^}]*\}/)![0]).not.toContain('border-bottom');
            expect(styleSheet.match(/\.troubleshootingSubTabs \{[^}]*\}/)![0]).not.toContain('border-bottom');
            // THE MOVING BAR IS ON THE TOP EDGE, SO NOTHING IS DRAWN BETWEEN A TAB AND ITS PANEL
            [/\.treeTab::after \{[^}]*\}/, /\.troubleshootingSubTab::after \{[^}]*\}/].forEach(rulePattern => {
                const afterRule = styleSheet.match(rulePattern)![0];
                expect(afterRule).toContain('top: -1px;');
                expect(afterRule).not.toContain('bottom:');
            });

        });

        // A HOVER MUST NOT DRAW THE BOTTOM EDGE BACK, WHEREVER THE BUTTON-KIND RULES SIT IN THE SHEET
        it('outranks the secondary kind\'s hover rule by specificity, and draws no bottom edge on an unselected tab\'s hover', () => {

            const classAndPseudoClassCount = (selector: string) => (selector.match(/\.[\w-]+|:(?!not\()[\w-]+/g) || []).length;
            expect(styleSheet).toContain('.sdtButton-secondary:hover:not(:disabled) {');
            const hoverSpecificity = classAndPseudoClassCount('.sdtButton-secondary:hover:not(:disabled)');
            expect(hoverSpecificity).toBe(3);
            ['.treeTabs .treeTab.selected.sdtButton', '.troubleshootingSubTabs .troubleshootingSubTab.selected.sdtButton']
                .forEach(selector => expect(classAndPseudoClassCount(selector)).toBeGreaterThan(hoverSpecificity));
            [/\.treeTab:hover:not\(:disabled\):not\(\.selected\) \{[^}]*\}/, /\.troubleshootingSubTab:hover:not\(:disabled\):not\(\.selected\) \{[^}]*\}/]
                .forEach(rulePattern => expect(styleSheet.match(rulePattern)![0]).not.toContain('border-bottom'));

        });

        it('outlines the Troubleshooting sub-panel inside the outer outline, inset from it', () => {

            const panel = drawRecipe(loadRecipe());
            const [accountCard] = panel.treeCards();
            panel.openTab(accountCard, 'Troubleshooting');

            const troubleshootingPanel = panel.tabPanelOf(accountCard, 'treeTroubleshooting');
            expect(troubleshootingPanel.classList.contains('treeTabPanel')).toBe(true);
            expect(panel.findAll(troubleshootingPanel, 'troubleshootingSubPanel')).toHaveLength(RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.length);
            expect(styleSheet).toContain('.troubleshootingSubPanel { margin: 0 0.6rem 0.6rem; }');

        });

    });

    describe('the search icon', () => {

        it('puts one hidden magnifier, built as SVG, at the left of every search box, and leaves the input\'s name alone', () => {

            const panel = drawRecipe(loadHistoryRecipe());
            const searchElements = openEverySearch(panel);
            // TREECIPE, DATA SETS, QUERY AND SIX TROUBLESHOOTING SUB-TABS ON THE FIRST CARD ALONE
            expect(searchElements.length).toBeGreaterThanOrEqual(9);

            searchElements.forEach((searchElement: any) => {
                const fieldElement = panel.findAll(searchElement, 'tabSearchField')[0];
                const [iconElement, inputElement] = fieldElement.children;
                expect(fieldElement.children).toHaveLength(2);
                expect(iconElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
                expect(iconElement.attributes).toMatchObject({ class: 'tabSearchIcon', 'aria-hidden': 'true', focusable: 'false' });
                expect(iconElement.children[0].attributes.d).toBe(RECIPE_COCKPIT_SEARCH_GLYPH_PATH);
                expect(inputElement.classList.contains('tabSearchInput')).toBe(true);
                // STILL THE PLACEHOLDER AND THE CARD'S TITLE, AS BEFORE THE ICON
                expect(inputElement.attributes['aria-label'].startsWith(inputElement.attributes.placeholder + ' (')).toBe(true);
            });

        });

        it('focuses the input when the icon is clicked', () => {

            const panel = drawRecipe(loadRecipe());
            const [searchElement] = openEverySearch(panel);
            const inputElement = panel.findAll(searchElement, 'tabSearchInput')[0];
            inputElement.focus = jest.fn();

            iconOf(panel, searchElement).dispatch('click');

            expect(inputElement.focus).toHaveBeenCalledTimes(1);

        });

        it('pads the text past the icon and strokes the icon from the palette', () => {

            expect(styleSheet).toMatch(/\.tabSearchInput \{[^}]*padding: 0\.3rem 0\.5rem 0\.3rem 2rem;/);
            expect(styleSheet).toMatch(/\.tabSearchIcon \{[^}]*position: absolute;[^}]*left: 0\.5rem;/);
            expect(styleSheet).toContain('.tabSearchIcon path { fill: none; stroke: var(--sdt-muted);');

        });

    });

});
