import * as matchers from 'jest-extended';
expect.extend(matchers);
import * as path from 'path';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }) },
    env: { openExternal: jest.fn() },
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });
import {
    RecipeCockpitService,
    RECIPE_COCKPIT_ACTION_VERB_EMOJI,
    RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL,
    RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL,
    RECIPE_COCKPIT_NO_RUN_MESSAGE,
    RECIPE_COCKPIT_STANDALONE_ACTION_CARDS,
    RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS,
    RECIPE_COCKPIT_VERB_BUTTON_VERBS
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #384: the standalone actions outside the Troubleshooting tab are #381's cards too, and the two
    primary buttons that keep their place (the tree's insert, + New scratch org in the pinned org
    row) carry their verb's emoji. These tests hold the verb map whole, pin which buttons are cards
    and which stay primary, and keep the pinned Target Org Management section free of cards.
*/
const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

type Panel = ReturnType<typeof runPanelScript>;

const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');
const styleSheetOf = (html: string) => html.substring(html.indexOf('<style nonce="testNonce">'), html.indexOf('</style>'));
const panelScriptOf = (html: string) => html.substring(html.lastIndexOf('<script nonce="testNonce">'), html.lastIndexOf('</script>'));

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
};

const drawTreeRecipe = (): Panel => {
    const panel = runPanelScript();
    panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const orgSectionOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'cockpitSection')
    .find((sectionElement: any) => sectionElement.attributes.id === 'cockpitOrgSection');

const partOf = (panel: Panel, buttonElement: any, className: string) => panel.findAll(buttonElement, className)[0];

describe('RecipeCockpitService, standalone action cards (#384)', () => {

    describe('the verb map', () => {

        it('adds Run, Export, Create, Regenerate and Generate data with the emojis the issue names, and still gives each verb its own', () => {

            expect(RECIPE_COCKPIT_ACTION_VERB_EMOJI).toMatchObject({ run: '▶️', export: '💾', create: '➕', regenerate: '🔄', generateData: '🎲' });

            const verbs = Object.keys(RECIPE_COCKPIT_ACTION_VERB_EMOJI);
            expect(new Set(Object.values(RECIPE_COCKPIT_ACTION_VERB_EMOJI)).size).toBe(verbs.length);

        });

        it('names only verbs the map holds, and leaves no verb in the map unused', () => {

            const usedVerbs = new Set([
                ...Object.values(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS).map(card => card.verb),
                ...Object.values(RECIPE_COCKPIT_STANDALONE_ACTION_CARDS).map(card => card.verb),
                ...Object.values(RECIPE_COCKPIT_VERB_BUTTON_VERBS)
            ]);

            usedVerbs.forEach(verb => expect(Object.keys(RECIPE_COCKPIT_ACTION_VERB_EMOJI)).toContain(verb));
            expect([...usedVerbs].sort()).toEqual(Object.keys(RECIPE_COCKPIT_ACTION_VERB_EMOJI).sort());
            expect(RECIPE_COCKPIT_VERB_BUTTON_VERBS).toEqual({ treeInsert: 'generateData', dataOrgNewScratch: 'create' });

        });

        it('gives every card a why line, and no action is both a Troubleshooting and a standalone card', () => {

            Object.values(RECIPE_COCKPIT_STANDALONE_ACTION_CARDS).forEach(card => expect(card.why.length).toBeGreaterThan(0));
            Object.keys(RECIPE_COCKPIT_STANDALONE_ACTION_CARDS).forEach(action => expect(RECIPE_COCKPIT_TROUBLESHOOTING_ACTION_CARDS).not.toHaveProperty(action));

        });

    });

    describe('the inventory, held in the panel script', () => {

        it('draws every standalone card it declares, and draws no card it does not declare', () => {

            const panelScript = panelScriptOf(shellHtml());
            const drawnActions = Array.from(panelScript.matchAll(/buildActionCard\('([A-Za-z]+)'/g), match => match[1]);

            // THE TROUBLESHOOTING DEPLOYS AND RETRIEVES ARE DRAWN BY KIND, SO ONLY ASSIGN AND GENERATE NAME THEMSELVES
            expect(drawnActions.sort()).toEqual([...Object.keys(RECIPE_COCKPIT_STANDALONE_ACTION_CARDS), 'assignPermissionSets', 'generatePermissionSet'].sort());

        });

        it('keeps the primary kind only for the buttons the inventory kept primary, so a new main action has to be classed', () => {

            const panelScript = panelScriptOf(shellHtml());
            const primaryClassNames = Array.from(panelScript.matchAll(/createButton\('primary', '([A-Za-z ]+)'/g), match => match[1]);

            expect([...new Set(primaryClassNames)].sort()).toEqual(['dataOrgLoad', 'dataOrgNewScratch', 'favoritesToggle', 'fieldEditorSave', 'helpGuideOpen', 'helpToggle', 'treeInsert'].sort());

        });

    });

    describe('the primary buttons that keep their place', () => {

        it('draws each verb\'s emoji before the label from the stylesheet, hidden from a screen reader', () => {

            const styleSheet = styleSheetOf(shellHtml());

            expect(styleSheet).toContain(".sdtButton.treeInsert::before { content: '🎲' / ''; margin-right: 0.35em; }");
            expect(styleSheet).toContain(".sdtButton.dataOrgNewScratch::before { content: '➕' / ''; margin-right: 0.35em; }");

        });

        it('keeps the insert full width and primary, and New scratch org primary in the pinned section, which holds no card', () => {

            const panel = drawTreeRecipe();
            const insertButton = panel.findAll(panel.cockpitBodyElement, 'treeInsert')[0];
            const newScratchButton = panel.findAll(panel.cockpitBodyElement, 'dataOrgNewScratch')[0];

            expect(insertButton.className).toBe('sdtButton sdtButton-primary treeInsert');
            expect(newScratchButton.className).toBe('sdtButton sdtButton-primary dataOrgNewScratch');
            expect(newScratchButton.textContent).toBe(RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL);

            // A CARD IS 10.5rem TALL, SO ONE IN THE PINNED SECTION WOULD GROW IT AT EVERY WIDTH (#364)
            const orgSection = orgSectionOf(panel);
            expect(orgSection).toBeDefined();
            expect(panel.findAll(orgSection, 'sdtButton-card')).toEqual([]);
            expect(panel.findAll(orgSection, 'dataOrgNewScratch')).toEqual([newScratchButton]);

        });

    });

    describe('the cards', () => {

        it('draws Generate Treecipe as a card that names itself, says why and holds itself while it runs', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE }, renderSequence: 1 });
            const generateCard = panel.findAll(panel.cockpitBodyElement, 'generateTreecipe')[0];

            expect(generateCard.parentNode.classList.contains('actionCards')).toBe(true);
            expect(partOf(panel, generateCard, 'actionCardEmoji').attributes['aria-hidden']).toBe('true');
            expect(partOf(panel, generateCard, 'actionCardWhy').textContent).toBe(RECIPE_COCKPIT_STANDALONE_ACTION_CARDS.generateTreecipe.why);
            expect(generateCard.attributes['aria-labelledby']).toBe(partOf(panel, generateCard, 'actionCardTitle').attributes.id);
            expect(panel.cardTitleOf(generateCard)).toBe(RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL);
            expect(generateCard.disabled).toBeFalsy();

            generateCard.dispatch('click');
            generateCard.dispatch('click');

            expect(generateCard.disabled).toBe(true);
            expect(partOf(panel, generateCard, 'actionCardReason').textContent).toBe('Generate Treecipe is running.');
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'generateTreecipe')).toEqual([{ command: 'generateTreecipe' }]);

        });

        it('draws the Treecipe Updater\'s three actions as cards in one grid, each with its verb', () => {

            const panel = drawTreeRecipe();
            const treeCard = panel.shownTreeCards()[0];
            panel.openTab(treeCard, 'Treecipe Updater');

            const cards = ['updaterLoad', 'updaterGenerate', 'updaterUpdate'].map(className => panel.findAll(treeCard, className)[0]);
            const expectedEmojis = ['loadUpdaterRecords', 'generateUpdaterValues', 'updateUpdaterRecords']
                .map(action => RECIPE_COCKPIT_ACTION_VERB_EMOJI[RECIPE_COCKPIT_STANDALONE_ACTION_CARDS[action as keyof typeof RECIPE_COCKPIT_STANDALONE_ACTION_CARDS].verb]);

            cards.forEach((cardElement: any, cardIndex: number) => {
                expect(cardElement.classList.contains('sdtButton-card')).toBe(true);
                expect(cardElement.parentNode).toBe(cards[0].parentNode);
                expect(partOf(panel, cardElement, 'actionCardEmoji').textContent).toBe(expectedEmojis[cardIndex]);
            });
            expect(cards[0].parentNode.classList.contains('updaterCards')).toBe(true);
            // GENERATE AND UPDATE SAY WHY THEY WAIT, ON THE CARD
            expect(partOf(panel, cards[1], 'actionCardReason').textContent).toMatch(/^Load records first/);
            expect(partOf(panel, cards[2], 'actionCardReason').textContent).toMatch(/^Generate values first/);

        });

        it('lays out the new card grids as the Troubleshooting one does', () => {

            expect(styleSheetOf(shellHtml())).toMatch(/\.actionCards \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 18rem\), 1fr\)\);/);

        });

    });

});
