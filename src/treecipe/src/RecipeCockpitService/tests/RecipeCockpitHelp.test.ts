import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    env: { openExternal: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriText: string) => ({ parsedFrom: uriText }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_HELP_BACKEND_NOTE,
    RECIPE_COCKPIT_HELP_GUIDE_LABEL,
    RECIPE_COCKPIT_HELP_GUIDE_URL,
    RECIPE_COCKPIT_HELP_NO_DIFFERENCE,
    RECIPE_COCKPIT_HELP_RUN_PREFIX,
    RECIPE_COCKPIT_HELP_SECTION_HEADINGS,
    RECIPE_COCKPIT_HELP_SECTIONS,
    RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL,
    RECIPE_COCKPIT_NO_RUN_MESSAGE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    #332: a "?" in the toolbar opens a section that says where the recipes come from, what the
    cockpit changes without editing them, what does edit them and where the changes are kept, then
    which cards differ from their recipe file now. "Open the full guide" posts the command alone and
    the host opens docs/RECIPE-COCKPIT-GUIDE.md, whose headings and images the last block holds to
    the panel's.
*/

const REPOSITORY_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const GUIDE_FILE_PATH = path.join(REPOSITORY_ROOT, 'docs', 'RECIPE-COCKPIT-GUIDE.md');
const MAXIMUM_GUIDE_IMAGE_BYTES = 200 * 1024;

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string): IRecipeCockpitTreeViewModel => recipe.trees.find(tree => tree.treeKey === treeKey)!;

const emptyRecipe = (): IRecipeCockpitRecipeViewModel => ({ runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE });

// ONE OF EVERY KIND OF DIFFERENCE A CARD CAN CARRY, AS THE HOST POSTS THEM
const applyEveryDifference = (tree: IRecipeCockpitTreeViewModel) => {
    tree.objectSelection = { exclusions: [{ objectApiName: 'Contact', kind: 'direct' } as any], disabledLookups: [], includedObjectCount: 2, objectCount: 3 };
    tree.fieldSelection = { objects: [
        { objectApiName: 'Account', excludedFieldApiNames: ['Phone', 'Website'], lockedFields: [] },
        { objectApiName: 'OtherChildObject__c', excludedFieldApiNames: ['Note__c'], lockedFields: [] }
    ] };
    tree.objectCounts = [{ objectApiName: 'Account', count: 5 }];
    tree.fixedValues = [{ objectApiName: 'Account', fieldApiName: 'Name', value: 'Acme', kind: 'text' }, { objectApiName: 'Account', fieldApiName: 'Industry', value: 'Energy', kind: 'text' }];
    tree.constraints = [{ objectApiName: 'Account', fieldApiName: 'NumberOfEmployees', min: '1', max: '9', expression: '${{ faker.number.int({ min: 1, max: 9 }) }}' }];
    tree.validationRulesOff = [{ objectApiName: 'Account', fieldApiName: 'Rating__c' }];
};

describe('RecipeCockpitService help section (#332)', () => {

    type Panel = ReturnType<typeof runPanelScript>;

    const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel, panelScriptOptions: Parameters<typeof runPanelScript>[0] = {}) => {
        const panel = runPanelScript(panelScriptOptions);
        panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
        panel.postToPanel({ command: 'loadPhase', message: '' });
        return panel;
    };

    const toggleOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'helpToggle')[0];
    const sectionOf = (panel: Panel) => panel.findAll(panel.cockpitBodyElement, 'helpSection')[0];
    const textsOf = (panel: Panel, rootElement: any, className: string) => panel.findAll(rootElement, className).map((element: any) => element.textContent);
    const summaryLinesOf = (panel: Panel) => panel.findAll(sectionOf(panel), 'helpSummary')[0].children.map((element: any) => element.textContent);

    describe('the toggle and the section', () => {

        it('draws "?" at the end of the toolbar, collapsed, naming the section it controls', () => {

            const panel = drawRecipe(loadRecipe());
            const toolbar = panel.findAll(panel.cockpitBodyElement, 'toolbar')[0];
            const toggle = toggleOf(panel);

            expect(toolbar.children[toolbar.children.length - 1]).toBe(toggle);
            expect(toggle.tagName).toBe('button');
            expect(toggle.textContent).toBe('?');
            expect(toggle.attributes['aria-label']).toBe(RECIPE_COCKPIT_HELP_TOGGLE_ARIA_LABEL);
            expect(toggle.attributes['aria-expanded']).toBe('false');
            expect(toggle.attributes['aria-controls']).toBe(sectionOf(panel).attributes.id);
            expect(panel.isHidden(sectionOf(panel))).toBeTrue();
            // RIGHT UNDER THE TOOLBAR, ABOVE THE CARDS
            expect(panel.cockpitBodyElement.children.indexOf(sectionOf(panel))).toBe(panel.cockpitBodyElement.children.indexOf(toolbar) + 1);

        });

        it('opens and closes on a click, and saves whether it is open in the place', () => {

            const panel = drawRecipe(loadRecipe());
            panel.postedHostMessages.length = 0;

            toggleOf(panel).dispatch('click');

            expect(toggleOf(panel).attributes['aria-expanded']).toBe('true');
            expect(panel.isHidden(sectionOf(panel))).toBeFalse();
            expect(panel.savedState().isHelpExpanded).toBeTrue();
            expect(panel.postedHostMessages.find(hostMessage => hostMessage.command === 'savePlace').place.isHelpExpanded).toBeTrue();

            toggleOf(panel).dispatch('click');

            expect(toggleOf(panel).attributes['aria-expanded']).toBe('false');
            expect(panel.isHidden(sectionOf(panel))).toBeTrue();
            expect(panel.savedState()).not.toHaveProperty('isHelpExpanded');

        });

        it('draws the four parts in order, the run on screen and the backend note, all as text', () => {

            const panel = drawRecipe(loadRecipe());
            const section = sectionOf(panel);

            expect(textsOf(panel, section, 'helpHeading').slice(0, 4)).toEqual([...RECIPE_COCKPIT_HELP_SECTION_HEADINGS]);
            expect(textsOf(panel, section, 'helpRun')).toEqual([RECIPE_COCKPIT_HELP_RUN_PREFIX + CURRENT_RUN_FOLDER_NAME]);
            expect(textsOf(panel, section, 'helpParagraph')).toContain(RECIPE_COCKPIT_HELP_BACKEND_NOTE);

            const everyItem = RECIPE_COCKPIT_HELP_SECTIONS.flatMap(helpSection => helpSection.items ?? []);
            const drawnItems = panel.findAll(section, 'helpList').filter((listElement: any) => !listElement.classList.contains('helpSummary'))
                .flatMap((listElement: any) => listElement.children.map((itemElement: any) => itemElement.textContent));
            expect(drawnItems).toEqual(everyItem);

        });

        it('keeps the section open across a later model in the same document', () => {

            const panel = drawRecipe(loadRecipe());
            toggleOf(panel).dispatch('click');

            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 4 });

            expect(toggleOf(panel).attributes['aria-expanded']).toBe('true');
            expect(panel.isHidden(sectionOf(panel))).toBeFalse();

        });

        it('is drawn in the empty state too, without a run line or a summary', () => {

            const panel = drawRecipe(emptyRecipe());

            expect(toggleOf(panel)).toBeDefined();
            expect(textsOf(panel, sectionOf(panel), 'helpHeading')).toEqual([...RECIPE_COCKPIT_HELP_SECTION_HEADINGS]);
            expect(panel.findAll(sectionOf(panel), 'helpRun')).toHaveLength(0);
            expect(panel.findAll(sectionOf(panel), 'helpSummary')).toHaveLength(0);
            expect(panel.findAll(panel.cockpitBodyElement, 'generateTreecipe')).toHaveLength(1);

        });

        it('draws no run line or summary for a run that could not be read', () => {

            const recipe = loadRecipe();
            const unreadableRecipe = { ...recipe, objects: [], trees: [], emptyStateMessage: 'The objects wrapper could not be read.' };
            const panel = drawRecipe(unreadableRecipe);

            expect(panel.findAll(sectionOf(panel), 'helpRun')).toHaveLength(0);
            expect(panel.findAll(sectionOf(panel), 'helpSummary')).toHaveLength(0);

        });

        it('posts "openHelpGuide" and nothing else from "Open the full guide"', () => {

            const panel = drawRecipe(emptyRecipe());
            const guideButton = panel.findAll(sectionOf(panel), 'helpGuideOpen')[0];
            panel.postedHostMessages.length = 0;

            expect(guideButton.textContent).toBe(RECIPE_COCKPIT_HELP_GUIDE_LABEL);
            guideButton.dispatch('click');

            expect(panel.postedHostMessages).toEqual([{ command: 'openHelpGuide' }]);

        });

    });

    describe('the summary', () => {

        it('says no tree differs when none does', () => {

            const panel = drawRecipe(loadRecipe());

            expect(summaryLinesOf(panel)).toEqual([RECIPE_COCKPIT_HELP_NO_DIFFERENCE]);

        });

        it('counts every kind of difference on the card, by its name', () => {

            const recipe = loadRecipe();
            applyEveryDifference(treeOf(recipe, ACCOUNT_TREE_KEY));
            treeOf(recipe, LEAD_TREE_KEY).objectCounts = [{ objectApiName: 'Lead', count: 2 }];
            treeOf(recipe, LEAD_TREE_KEY).customName = 'Leads only';
            const panel = drawRecipe(recipe);

            expect(summaryLinesOf(panel)).toEqual([
                `${treeOf(recipe, ACCOUNT_TREE_KEY).title}: 1 object excluded · 3 fields unticked · 1 count changed · 1 faker bound · 1 field without its rules`,
                'Leads only: 1 count changed'
            ]);

        });

        it('leaves out what an excluded object keeps for later, since generation applies none of it', () => {

            const recipe = loadRecipe();
            const accountTree = treeOf(recipe, ACCOUNT_TREE_KEY);
            accountTree.objectSelection = { exclusions: [{ objectApiName: 'OtherChildObject__c', kind: 'excluded' }], disabledLookups: [], includedObjectCount: 2, objectCount: 3 };
            accountTree.fieldSelection = { objects: [
                { objectApiName: 'OtherChildObject__c', excludedFieldApiNames: ['Score__c', 'Ratio__c'], lockedFields: [] },
                { objectApiName: 'Account', excludedFieldApiNames: ['Legacy_Code__c'], lockedFields: [] }
            ] };
            accountTree.objectCounts = [{ objectApiName: 'OtherChildObject__c', count: 9 }];
            const panel = drawRecipe(recipe);

            expect(summaryLinesOf(panel)).toEqual([`${accountTree.title}: 1 object excluded · 1 field unticked`]);

        });

        it('counts a faker bound once, though it also switches the field\'s rules off', () => {

            const recipe = loadRecipe();
            const accountTree = treeOf(recipe, ACCOUNT_TREE_KEY);
            accountTree.constraints = [{ objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', min: '1', max: '9', expression: '${{ faker.number.int({ min: 1, max: 9 }) }}' }];
            accountTree.validationRulesOff = [{ objectApiName: 'Account', fieldApiName: 'Annual_Budget__c' }, { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }];
            const panel = drawRecipe(recipe);

            expect(summaryLinesOf(panel)).toEqual([`${accountTree.title}: 1 faker bound · 1 field without its rules`]);

        });

        it('never lists a card with no folder', () => {

            const recipe = loadRecipe();
            const ungroupedTree: IRecipeCockpitTreeViewModel = { treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 };
            applyEveryDifference(ungroupedTree);
            recipe.trees.push(ungroupedTree);
            const panel = drawRecipe(recipe);

            expect(summaryLinesOf(panel)).toEqual([RECIPE_COCKPIT_HELP_NO_DIFFERENCE]);

        });

        it('redraws when the host posts a card\'s selection or its name', () => {

            const recipe = loadRecipe();
            const panel = drawRecipe(recipe);

            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: LEAD_TREE_KEY, objectCounts: [{ objectApiName: 'Lead', count: 7 }] });
            expect(summaryLinesOf(panel)).toEqual([`${treeOf(recipe, LEAD_TREE_KEY).title}: 1 count changed`]);

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Renamed', isFavorite: false }] });
            expect(summaryLinesOf(panel)).toEqual(['Renamed: 1 count changed']);

            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: LEAD_TREE_KEY });
            expect(summaryLinesOf(panel)).toEqual([RECIPE_COCKPIT_HELP_NO_DIFFERENCE]);

        });

        it('writes a name from the model as text, never as markup', () => {

            const recipe = loadRecipe();
            const leadTree = treeOf(recipe, LEAD_TREE_KEY);
            leadTree.customName = '<img src=x onerror=alert(1)>';
            leadTree.objectCounts = [{ objectApiName: 'Lead', count: 2 }];
            const panel = drawRecipe(recipe);

            const summaryItem = panel.findAll(sectionOf(panel), 'helpSummary')[0].children[0];
            expect(summaryItem.textContent).toBe('<img src=x onerror=alert(1)>: 1 count changed');
            expect(summaryItem.children).toHaveLength(0);

        });

    });

    describe('the place', () => {

        const savedPlace = (extra: Record<string, unknown>) => ({
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: CURRENT_RUN_FOLDER_NAME,
            isOrgPickerInUse: false,
            isFavoritesOnly: false,
            scrollY: 0,
            trees: [],
            ...extra
        });

        it('opens the section for a place saved with it open', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({ isHelpExpanded: true }) });

            expect(toggleOf(panel).attributes['aria-expanded']).toBe('true');
            expect(panel.isHidden(sectionOf(panel))).toBeFalse();

        });

        it('reads a place saved before the section as collapsed', () => {

            const panel = drawRecipe(loadRecipe(), { savedState: savedPlace({}) });

            expect(toggleOf(panel).attributes['aria-expanded']).toBe('false');
            expect(panel.isHidden(sectionOf(panel))).toBeTrue();

        });

        it('keeps isHelpExpanded on the host only when it is exactly true, and the place version did not change', () => {

            expect(RecipeCockpitService.normalizePanelPlace(savedPlace({ isHelpExpanded: true }))?.isHelpExpanded).toBeTrue();
            expect(RecipeCockpitService.normalizePanelPlace(savedPlace({ isHelpExpanded: 'yes' }))).not.toHaveProperty('isHelpExpanded');
            expect(RecipeCockpitService.normalizePanelPlace(savedPlace({}))).not.toHaveProperty('isHelpExpanded');
            expect(RECIPE_COCKPIT_PANEL_PLACE_VERSION).toBe(2);

        });

    });

    describe('the guide link', () => {

        const drawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: emptyRecipe(), renderSequence: 1 };
            return panelState;
        };

        it('routes "openHelpGuide" once a model is posted, the empty state included, whatever else it carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'openHelpGuide' }, RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT))).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openHelpGuide' }, drawnPanelState())).toEqual({ kind: 'openHelpGuide' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'openHelpGuide', filePath: 'https://example.com', runFolderName: 'x' } as any, drawnPanelState())).toEqual({ kind: 'openHelpGuide' });

        });

        it('keeps the url out of the shell', () => {

            const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(shellHtml).not.toContain(RECIPE_COCKPIT_HELP_GUIDE_URL);
            expect(shellHtml).not.toContain('RECIPE-COCKPIT-GUIDE');
            expect(RECIPE_COCKPIT_HELP_GUIDE_URL).toBe('https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/docs/RECIPE-COCKPIT-GUIDE.md');

        });

        describe('through the real panel', () => {

            let postedPanelMessages: any[] = [];
            let receivedMessageHandler: (panelMessage: any) => Promise<void>;
            let disposeHandler: (() => void) | undefined;

            beforeEach(() => {
                postedPanelMessages = [];
                (vscode.env.openExternal as jest.Mock).mockReset().mockResolvedValue(true);
                (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                    reveal: jest.fn(),
                    dispose: jest.fn(),
                    onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
                    webview: {
                        html: '',
                        postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                        onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                            receivedMessageHandler = messageHandler;
                            return { dispose: jest.fn() };
                        })
                    }
                }));
                jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
            });

            afterEach(() => {
                disposeHandler?.();
                disposeHandler = undefined;
            });

            it('opens the guide on the host, and posts the url to the panel nowhere', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });
                const recipeDataMessage = [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData');
                await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });

                await receivedMessageHandler({ command: 'openHelpGuide', url: 'https://example.com' });

                expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
                expect(vscode.env.openExternal).toHaveBeenCalledWith({ parsedFrom: RECIPE_COCKPIT_HELP_GUIDE_URL });
                expect(JSON.stringify(postedPanelMessages)).not.toContain('RECIPE-COCKPIT-GUIDE');

            });

        });

    });

    /*
        The guide is the help's long form: the same four headings in the same order, a note and a
        picture under each, and every picture it names on disk and small enough to keep in the
        repository. Changing a heading on one side without the other fails here.
    */
    describe('docs/RECIPE-COCKPIT-GUIDE.md', () => {

        const guideText = fs.readFileSync(GUIDE_FILE_PATH, 'utf8');
        const guideHeadings = guideText.split(/\r?\n/).filter(line => line.startsWith('## ')).map(line => line.substring(3).trim());
        const imagePaths = Array.from(guideText.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)).map(imageMatch => imageMatch[1]);

        it('has the help\'s headings, in the help\'s order', () => {

            expect(guideHeadings.filter(heading => RECIPE_COCKPIT_HELP_SECTION_HEADINGS.includes(heading))).toEqual([...RECIPE_COCKPIT_HELP_SECTION_HEADINGS]);

        });

        it('names only pictures that are in the repository, each at most 200 KB', () => {

            expect(imagePaths.length).toBeGreaterThanOrEqual(RECIPE_COCKPIT_HELP_SECTION_HEADINGS.length);

            imagePaths.forEach(imagePath => {
                expect(imagePath).not.toMatch(/^[a-z]+:/i);
                const imageFilePath = path.resolve(path.dirname(GUIDE_FILE_PATH), imagePath);
                expect(imageFilePath.startsWith(path.join(REPOSITORY_ROOT, 'docs', 'images', 'recipe-cockpit') + path.sep)).toBeTrue();
                expect(fs.existsSync(imageFilePath)).toBeTrue();
                expect(fs.statSync(imageFilePath).size).toBeLessThanOrEqual(MAXIMUM_GUIDE_IMAGE_BYTES);
            });

        });

        it('puts a picture under every help heading', () => {

            const sectionsByHeading = guideText.split(/\r?\n## /).slice(1);
            RECIPE_COCKPIT_HELP_SECTION_HEADINGS.forEach(heading => {
                const sectionText = sectionsByHeading.find(candidateSection => candidateSection.startsWith(heading + '\n') || candidateSection.startsWith(heading + '\r\n'));
                expect(sectionText).toBeDefined();
                expect(sectionText).toMatch(/!\[[^\]]+\]\([^)]+\.png\)/);
            });

        });

    });

});
