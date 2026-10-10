import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreePreferences,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY,
    RECIPE_COCKPIT_TREE_PREFERENCES_VERSION,
    RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_NO_FAVORITES_MESSAGE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    A tree card's own name and favorite, and the Favorites only filter (#235). The host keeps both
    by tree FOLDER NAME in workspaceState and asks for a name in its own input box; the panel posts
    only a card's key, and redraws the header in place when the host says what changed.
*/

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

const buildUngroupedTree = (): IRecipeCockpitTreeViewModel => ({
    treeKey: '',
    title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    folderName: '',
    objects: [],
    fieldCount: 0
});

const buildPreferences = (customNames: Record<string, string> = {}, favoriteFolderNames: string[] = []): IRecipeCockpitTreePreferences => ({
    customNamesByFolderName: new Map(Object.entries(customNames)),
    favoriteFolderNames: new Set(favoriteFolderNames)
});

const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

const storedPreferences = (customNames: Record<string, unknown> = {}, favoriteFolderNames: unknown[] = []) => ({
    version: RECIPE_COCKPIT_TREE_PREFERENCES_VERSION,
    customNames: customNames,
    favoriteFolderNames: favoriteFolderNames
});

describe('RecipeCockpitService, tree names and favorites (#235)', () => {

    describe('readTreePreferences', () => {

        it('given no workspace state, nothing stored, or another shape, reads none', () => {

            const isEmpty = (treePreferences: IRecipeCockpitTreePreferences) => treePreferences.customNamesByFolderName.size === 0 && treePreferences.favoriteFolderNames.size === 0;

            expect(isEmpty(RecipeCockpitService.readTreePreferences(undefined))).toBe(true);
            expect(isEmpty(RecipeCockpitService.readTreePreferences(buildWorkspaceState()))).toBe(true);
            expect(isEmpty(RecipeCockpitService.readTreePreferences(buildWorkspaceState({
                [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: { ...storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }), version: RECIPE_COCKPIT_TREE_PREFERENCES_VERSION + 1 }
            })))).toBe(true);
            expect(isEmpty(RecipeCockpitService.readTreePreferences(buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: 'Leads' })))).toBe(true);

            const throwingState = { get: () => { throw new Error('no state'); }, update: jest.fn() };
            expect(isEmpty(RecipeCockpitService.readTreePreferences(throwingState as any))).toBe(true);

        });

        it('drops each entry that could not have been saved and keeps the rest, a folder named __proto__ included', () => {

            const treePreferences = RecipeCockpitService.readTreePreferences(buildWorkspaceState({
                [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: JSON.parse(JSON.stringify(storedPreferences({
                    [LEAD_TREE_KEY]: 'Leads',
                    ['__proto__']: 'Prototype tree',
                    notText: 7,
                    empty: '',
                    untrimmed: ' Padded ',
                    twoLines: 'One\nTwo',
                    separated: 'One\u2028Two',
                    tooLong: 'n'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH + 1)
                }, [ACCOUNT_TREE_KEY, 7, '', LEAD_TREE_KEY])))
            }));

            expect([...treePreferences.customNamesByFolderName.entries()]).toEqual([[LEAD_TREE_KEY, 'Leads'], ['__proto__', 'Prototype tree']]);
            expect([...treePreferences.favoriteFolderNames]).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

        });

    });

    describe('writeTreePreferences', () => {

        it('writes what readTreePreferences reads back', async () => {

            const workspaceState = buildWorkspaceState();
            const treePreferences = buildPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [ACCOUNT_TREE_KEY]);

            await expect(RecipeCockpitService.writeTreePreferences(workspaceState, treePreferences)).resolves.toBe(true);

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [ACCOUNT_TREE_KEY]));
            expect(RecipeCockpitService.readTreePreferences(workspaceState)).toEqual(treePreferences);

        });

        it('keeps the name of a folder named __proto__, which a plain object would take as its prototype', async () => {

            const workspaceState = buildWorkspaceState();

            await RecipeCockpitService.writeTreePreferences(workspaceState, buildPreferences({ ['__proto__']: 'Prototype tree', [LEAD_TREE_KEY]: 'Leads' }));

            expect([...RecipeCockpitService.readTreePreferences(workspaceState).customNamesByFolderName.entries()])
                .toEqual([['__proto__', 'Prototype tree'], [LEAD_TREE_KEY, 'Leads']]);
            expect(Object.getPrototypeOf(workspaceState.storedValues.get(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY))).toBe(Object.prototype);

        });

        it('given no workspace state, or a write that fails, says so and answers false', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            const failingState = { get: jest.fn(), update: jest.fn(() => Promise.reject(new Error('[disk](command:x) full'))) };

            await expect(RecipeCockpitService.writeTreePreferences(undefined, buildPreferences())).resolves.toBe(false);
            await expect(RecipeCockpitService.writeTreePreferences(failingState as any, buildPreferences())).resolves.toBe(false);

            expect(warningSpy).toHaveBeenCalledTimes(2);
            // A NOTIFICATION RENDERS [label](command:…) AS A LINK THAT RUNS THE COMMAND
            expect(warningSpy.mock.calls[1][0]).not.toContain('[disk](command:x)');

        });

    });

    describe('validateTreeName', () => {

        const trees = (): IRecipeCockpitTreeViewModel[] => {
            const recipeTrees = loadRecipe().trees;
            recipeTrees[0].customName = 'Accounts';
            return [...recipeTrees, buildUngroupedTree()];
        };

        it.each([
            ['an empty name, which clears the card\'s own', ''],
            ['only whitespace', '   '],
            ['a name no card has', 'Sales hierarchy'],
            ['the card\'s own current name', 'leads'],
            ['the card\'s own default title', 'Relationship Tree 2'],
            ['a name the full length allows', 'n'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH)]
        ])('accepts %s', (_caseName, candidateName) => {

            expect(RecipeCockpitService.validateTreeName(candidateName, LEAD_TREE_KEY, buildPreferences({ [LEAD_TREE_KEY]: 'Leads' }), trees())).toBeUndefined();

        });

        it.each([
            ['a line break', 'Sales\nhierarchy', 'one line'],
            ['a carriage return', 'Sales\rhierarchy', 'one line'],
            ['U+0085', 'Sales\u0085hierarchy', 'one line'],
            ['U+2028', 'Sales\u2028hierarchy', 'one line'],
            ['U+2029', 'Sales\u2029hierarchy', 'one line'],
            ['a tab', 'Sales\thierarchy', 'one line'],
            ['a name past the length bound', 'n'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH + 1), `${RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH} characters`],
            ['another folder\'s stored name, in another case and padded', '  OPPORTUNITIES ', 'already has that name'],
            ['another card\'s custom name on screen', 'accounts', 'already has that name'],
            ['another card\'s default title', 'relationship tree 1', 'already has that name'],
            ['the ungrouped card\'s title', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, 'already has that name']
        ])('refuses %s', (_caseName, candidateName, expectedProblem) => {

            const treePreferences = buildPreferences({ [LEAD_TREE_KEY]: 'Leads', 'Opportunity-ONLY': 'Opportunities' });

            expect(RecipeCockpitService.validateTreeName(candidateName, LEAD_TREE_KEY, treePreferences, trees())).toContain(expectedProblem);

        });

    });

    describe('applyTreePreferences', () => {

        it('names and stars every card of a folder, never the ungrouped card, and takes off what was cleared', () => {

            const recipeTrees = [...loadRecipe().trees, buildUngroupedTree()];

            RecipeCockpitService.applyTreePreferences(recipeTrees, buildPreferences({ [LEAD_TREE_KEY]: 'Leads', '': 'Nothing' }, [ACCOUNT_TREE_KEY, '']));

            expect(recipeTrees.map(tree => [tree.treeKey, tree.customName, tree.isFavorite])).toEqual([
                [ACCOUNT_TREE_KEY, undefined, true],
                [LEAD_TREE_KEY, 'Leads', undefined],
                ['', undefined, undefined]
            ]);
            // THE DEFAULT IS KEPT: IT IS WHAT A CLEARED NAME GOES BACK TO
            expect(recipeTrees[1].title).toBe('Relationship Tree 2');

            RecipeCockpitService.applyTreePreferences(recipeTrees, buildPreferences());

            expect(recipeTrees.every(tree => !('customName' in tree) && !('isFavorite' in tree))).toBe(true);

        });

        it('lists only the cards of the changed folder in the update', () => {

            const recipeTrees = RecipeCockpitService.applyTreePreferences(loadRecipe().trees, buildPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [LEAD_TREE_KEY]));

            expect(RecipeCockpitService.buildTreePreferencesMessage(recipeTrees, LEAD_TREE_KEY, 9)).toEqual({
                command: 'treePreferences',
                renderSequence: 9,
                trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Leads', isFavorite: true }]
            });
            expect(RecipeCockpitService.buildTreePreferencesMessage(recipeTrees, ACCOUNT_TREE_KEY, 9).trees).toEqual([{ treeKey: ACCOUNT_TREE_KEY, isFavorite: false }]);

        });

    });

    describe('routePanelMessage, renameTree and toggleFavoriteTree', () => {

        const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it.each(['renameTree', 'toggleFavoriteTree'])('given %s for a drawn card, names its folder', (command) => {

            expect(RecipeCockpitService.routePanelMessage({ command: command, treeKey: LEAD_TREE_KEY }, buildDrawnPanelState()))
                .toEqual({ kind: command, folderName: LEAD_TREE_KEY });

        });

        it('allows every card with a folder, and not the ungrouped card', () => {

            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(buildDrawnPanelState().recipeDataMessage!.recipe).nameableTreeKeys])
                .toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

        });

        it.each(['renameTree', 'toggleFavoriteTree'])('given %s for anything else, does nothing', (command) => {

            const route = (treeKey: unknown, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: command, treeKey: treeKey }, panelState);

            expect(route('')).toBeUndefined();
            expect(route('Opportunity-ONLY')).toBeUndefined();
            expect(route(7)).toBeUndefined();
            expect(route(undefined)).toBeUndefined();

            // BEFORE "rendered", AFTER "ready" OR A FAILURE TO DRAW: THE ACTIVE LIST IS EMPTY
            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            expect(route(LEAD_TREE_KEY, undrawnPanelState)).toBeUndefined();

            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;
            expect(route(LEAD_TREE_KEY, modelLessPanelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const showInputBox = vscode.window.showInputBox as jest.Mock;

        const buildWebviewPanel = () => ({
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
        });

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        const treeOf = (recipeDataMessage: any, treeKey: string) => recipeDataMessage.recipe.trees.find((tree: any) => tree.treeKey === treeKey);
        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY);

        beforeEach(() => {
            postedPanelMessages = [];
            showInputBox.mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('draws the cards with the names and favorites workspaceState kept', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [ACCOUNT_TREE_KEY]) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(treeOf(recipeDataMessage, LEAD_TREE_KEY)).toMatchObject({ title: 'Relationship Tree 2', customName: 'Leads' });
            expect(treeOf(recipeDataMessage, LEAD_TREE_KEY).isFavorite).toBeUndefined();
            expect(treeOf(recipeDataMessage, ACCOUNT_TREE_KEY).isFavorite).toBe(true);

        });

        it('renames a card through the host\'s input box, keeps the name, and redraws the card in place', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            showInputBox.mockResolvedValue('  Sales leads ');

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY });

            const inputBoxOptions = showInputBox.mock.calls[0][0];
            expect(inputBoxOptions.value).toBe('');
            expect(inputBoxOptions.placeHolder).toBe('Relationship Tree 2');
            expect(inputBoxOptions.validateInput('Relationship Tree 1')).toContain('already has that name');
            expect(inputBoxOptions.validateInput('Anything else')).toBeUndefined();

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Sales leads' }));
            expect(lastPosted('treePreferences')).toEqual({
                command: 'treePreferences',
                renderSequence: recipeDataMessage.renderSequence,
                trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Sales leads', isFavorite: false }]
            });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH HAS TO CARRY THE NAME TOO
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData'), LEAD_TREE_KEY).customName).toBe('Sales leads');

        });

        it('escapes a folder name in the prompt, which the input box would draw as a link that runs a command', async () => {

            await openAndDraw(buildWorkspaceState());
            const forgedFolderName = '[Click](command:workbench.action.terminal.new)';
            const leadTree = treeOf((RecipeCockpitService as any).recipeCockpitPanelState.recipeDataMessage, LEAD_TREE_KEY);
            leadTree.folderName = forgedFolderName;
            showInputBox.mockResolvedValue(undefined);

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY });

            const prompt = showInputBox.mock.calls[0][0].prompt;
            expect(prompt).not.toContain(forgedFolderName);
            expect(prompt).not.toMatch(/[[\]()]/);

        });

        it('pre-fills the card\'s own name, and an emptied box clears it', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [LEAD_TREE_KEY]) });
            await openAndDraw(workspaceState);
            showInputBox.mockResolvedValue('');

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY });

            expect(showInputBox.mock.calls[0][0].value).toBe('Leads');
            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_TREE_KEY]));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: LEAD_TREE_KEY, isFavorite: true }]);

        });

        it('given the box is cancelled, changes nothing', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            showInputBox.mockResolvedValue(undefined);

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY });

            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, expect.anything());
            expect(lastPosted('treePreferences')).toBeUndefined();

        });

        it('given another window took the name while the box was open, refuses it and says why', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showInputBox.mockImplementation(async () => {
                workspaceState.storedValues.set(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));
                return 'pipeline';
            });

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY });

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));
            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(warningSpy.mock.calls[0][0]).toContain('already has that name');

        });

        it('marks a card a favorite and takes it off again, and the next open draws the star', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }) });
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'toggleFavoriteTree', treeKey: ACCOUNT_TREE_KEY });

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [ACCOUNT_TREE_KEY]));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: ACCOUNT_TREE_KEY, isFavorite: true }]);

            // REGENERATING THE SAME OBJECTS WRITES THE SAME FOLDER, SO A RELOAD OF THE RUN KEEPS IT
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'selectRun', runFolderName: CURRENT_RUN_FOLDER_NAME });
            expect(treeOf(lastPosted('recipeData'), ACCOUNT_TREE_KEY).isFavorite).toBe(true);
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });

            await receivedMessageHandler({ command: 'toggleFavoriteTree', treeKey: ACCOUNT_TREE_KEY });

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: ACCOUNT_TREE_KEY, isFavorite: false }]);

        });

        it('given a write that fails, leaves the cards as they were', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await receivedMessageHandler({ command: 'toggleFavoriteTree', treeKey: ACCOUNT_TREE_KEY });

            expect(lastPosted('treePreferences')).toBeUndefined();

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, panelScriptOptions = {}, extraMessage: any = {}) => {
            const panel = runPanelScript(panelScriptOptions);
            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3, ...extraMessage });
            return panel;
        };

        const treeKeys = [ACCOUNT_TREE_KEY, LEAD_TREE_KEY, ''];
        const cardOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.treeCards()[treeKeys.indexOf(treeKey)];
        const titleOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'treeTitle')[0].textContent;
        const starOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'treeFavorite')[0];
        const favoritesToggleOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitBodyElement, 'favoritesToggle')[0];
        const shownTreeKeys = (panel: ReturnType<typeof runPanelScript>) => treeKeys.filter(treeKey => !panel.isHidden(cardOf(panel, treeKey)));
        const noFavoritesOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitBodyElement, 'emptyState')
            .find((element: any) => element.textContent === RECIPE_COCKPIT_NO_FAVORITES_MESSAGE);

        it('draws a card\'s own name in place of its default, its folder still beneath, and the star of a favorite', () => {

            const panel = drawRecipe(recipe => {
                recipe.trees[1].customName = 'Leads';
                recipe.trees[0].isFavorite = true;
            });

            expect(treeKeys.map(treeKey => titleOf(panel, treeKey))).toEqual(['Relationship Tree 1', 'Leads', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            expect(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0].textContent).toBe(LEAD_TREE_KEY);
            expect(starOf(panel, ACCOUNT_TREE_KEY).textContent).toBe('★');
            expect(starOf(panel, ACCOUNT_TREE_KEY).attributes['aria-pressed']).toBe('true');
            expect(starOf(panel, LEAD_TREE_KEY).textContent).toBe('☆');
            expect(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeToggle')[0].attributes['aria-label']).toBe('Show or hide Leads');

        });

        it('draws neither ✎ nor ☆ on the ungrouped card, which has no folder to keep them by', () => {

            const panel = drawRecipe();

            expect(panel.findAll(cardOf(panel, ''), 'treeFavorite')).toEqual([]);
            expect(panel.findAll(cardOf(panel, ''), 'treeRename')).toEqual([]);

        });

        it('posts only the card\'s key, and neither click opens or closes the card', () => {

            const panel = drawRecipe();
            const leadCard = cardOf(panel, LEAD_TREE_KEY);

            starOf(panel, LEAD_TREE_KEY).dispatch('click');
            panel.findAll(leadCard, 'treeRename')[0].dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => ['toggleFavoriteTree', 'renameTree'].includes(hostMessage.command))).toEqual([
                { command: 'toggleFavoriteTree', treeKey: LEAD_TREE_KEY },
                { command: 'renameTree', treeKey: LEAD_TREE_KEY }
            ]);
            expect(panel.isHidden(panel.findAll(leadCard, 'treeBody')[0])).toBe(true);

        });

        it('redraws the cards the host names, and only for the model on screen', () => {

            const panel = drawRecipe();
            panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeToggle')[0].dispatch('click');

            panel.postToPanel({ command: 'treePreferences', renderSequence: 2, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Stale', isFavorite: true }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Relationship Tree 2');

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Leads', isFavorite: true }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Leads');
            expect(starOf(panel, LEAD_TREE_KEY).textContent).toBe('★');
            // REDRAWN IN PLACE: THE CARD THE READER OPENED IS STILL OPEN
            expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeBody')[0])).toBe(false);

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, isFavorite: false }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Relationship Tree 2');
            expect(starOf(panel, LEAD_TREE_KEY).textContent).toBe('☆');

        });

        it('Favorites only shows the favorites and counts them, and a card taken off hides at once', () => {

            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; recipe.trees[1].isFavorite = true; });
            const countElement = panel.findAll(panel.cockpitBodyElement, 'favoritesCount')[0];

            expect(shownTreeKeys(panel)).toEqual(treeKeys);
            expect(favoritesToggleOf(panel).attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(countElement)).toBe(true);

            favoritesToggleOf(panel).dispatch('click');

            expect(shownTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);
            expect(favoritesToggleOf(panel).attributes['aria-pressed']).toBe('true');
            expect(countElement.textContent).toBe('2 of 3 trees');
            expect(panel.isHidden(countElement)).toBe(false);

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, isFavorite: false }] });

            expect(shownTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);
            expect(countElement.textContent).toBe('1 of 3 trees');

            favoritesToggleOf(panel).dispatch('click');

            expect(shownTreeKeys(panel)).toEqual(treeKeys);

        });

        it('given no favorite, says so rather than drawing an empty page', () => {

            const panel = drawRecipe();

            expect(panel.isHidden(noFavoritesOf(panel))).toBe(true);

            favoritesToggleOf(panel).dispatch('click');

            expect(shownTreeKeys(panel)).toEqual([]);
            expect(panel.isHidden(noFavoritesOf(panel))).toBe(false);

        });

        it('keeps the filter in the reader\'s place, and a reopened document restores it', () => {

            const panel = drawRecipe(recipe => { recipe.trees[1].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            expect(panel.savedState().isFavoritesOnly).toBe(true);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace').pop().place.isFavoritesOnly).toBe(true);

            const reopenedPanel = drawRecipe(recipe => { recipe.trees[1].isFavorite = true; }, { savedState: panel.savedState() });

            expect(shownTreeKeys(reopenedPanel)).toEqual([LEAD_TREE_KEY]);

        });

        it('restores the filter from the place the host kept, when the document has none of its own', () => {

            const hostPlace = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: true, scrollY: 0, trees: [] };
            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; }, {}, { restorePlace: hostPlace });

            expect(shownTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

        });

        it('given a place saved before #235, which has no filter, shows every card', () => {

            const oldPlace = { version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, scrollY: 0, trees: [] };
            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; }, { savedState: oldPlace });

            expect(shownTreeKeys(panel)).toEqual(treeKeys);

        });

        it('keeps the filter across a new model in the same document', () => {

            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            recipe.trees[0].isFavorite = true;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 4 });

            expect(shownTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

        });

        it('given a focus on a card the filter hides, turns the filter off and opens the card', () => {

            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            recipe.trees[0].isFavorite = true;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 4, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });

            expect(shownTreeKeys(panel)).toEqual(treeKeys);
            expect(favoritesToggleOf(panel).attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeBody')[0])).toBe(false);
            expect(panel.savedState().isFavoritesOnly).toBe(false);

        });

        it('given the filter on and a new model with no tree to mark, shows its card rather than hiding it with no toggle to undo', () => {

            const panel = drawRecipe(recipe => { recipe.trees[0].isFavorite = true; });
            favoritesToggleOf(panel).dispatch('click');

            const recipe = loadRecipe();
            recipe.trees = [buildUngroupedTree()];
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 4 });

            expect(favoritesToggleOf(panel)).toBeUndefined();
            expect(panel.isHidden(panel.treeCards()[0])).toBe(false);
            expect(panel.isHidden(noFavoritesOf(panel))).toBe(true);

        });

        it('draws no Favorites only toggle for a run with no tree to mark', () => {

            const panel = drawRecipe(recipe => { recipe.trees = [buildUngroupedTree()]; });

            expect(favoritesToggleOf(panel)).toBeUndefined();

        });

    });

});
