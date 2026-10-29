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
    RECIPE_COCKPIT_NO_FAVORITES_MESSAGE,
    RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    A tree card's own name and favorite, and the Favorites only filter (#235). The host keeps both
    by tree FOLDER NAME in workspaceState. Since #551 ✎ opens the name inline: the panel posts the
    card's key and the name as typed, the host checks it again, and the panel redraws the header in
    place when the host says what changed, or writes the host's refusal under the box.
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
            ['the card\'s own default title', 'Lead-ONLY'],
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
            ['another card\'s default title', 'account-thru-otherchildobject__c', 'already has that name'],
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
            expect(recipeTrees[1].title).toBe('Lead-ONLY');

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

        it('given toggleFavoriteTree for a drawn card, names its folder', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'toggleFavoriteTree', treeKey: LEAD_TREE_KEY }, buildDrawnPanelState()))
                .toEqual({ kind: 'toggleFavoriteTree', folderName: LEAD_TREE_KEY });

        });

        it('given renameTree for a drawn card and the model on screen, names its folder and carries the name as typed', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: '  Leads ', renderSequence: 4 }, buildDrawnPanelState()))
                .toEqual({ kind: 'renameTree', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, name: '  Leads ', renderSequence: 4 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'x'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH), renderSequence: 4 }, buildDrawnPanelState()))
                .toMatchObject({ kind: 'renameTree' });

        });

        it('allows every card with a folder, and not the ungrouped card', () => {

            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(buildDrawnPanelState().recipeDataMessage!.recipe).nameableTreeKeys])
                .toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

        });

        it.each(['renameTree', 'toggleFavoriteTree'])('given %s for anything else, does nothing', (command) => {

            const route = (treeKey: unknown, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: command, treeKey: treeKey, name: 'Leads', renderSequence: 4 }, panelState);

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

        it('given renameTree with a name that is not a string, is over 80 characters, or was typed over another model, does nothing', () => {

            const route = (name: unknown, renderSequence: unknown) => RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: name, renderSequence: renderSequence }, buildDrawnPanelState());

            expect(route(undefined, 4)).toBeUndefined();
            expect(route(7, 4)).toBeUndefined();
            expect(route(['Leads'], 4)).toBeUndefined();
            expect(route('x'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH + 1), 4)).toBeUndefined();
            expect(route('Leads', 3)).toBeUndefined();
            expect(route('Leads', undefined)).toBeUndefined();
            expect(route('Leads', '4')).toBeUndefined();

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

            expect(treeOf(recipeDataMessage, LEAD_TREE_KEY)).toMatchObject({ title: 'Lead-ONLY', customName: 'Leads' });
            expect(treeOf(recipeDataMessage, LEAD_TREE_KEY).isFavorite).toBeUndefined();
            expect(treeOf(recipeDataMessage, ACCOUNT_TREE_KEY).isFavorite).toBe(true);

        });

        const renameLead = (recipeDataMessage: any, name: unknown) => receivedMessageHandler({
            command: 'renameTree', treeKey: LEAD_TREE_KEY, name: name, renderSequence: recipeDataMessage.renderSequence
        });

        it('renames a card from the name the panel posts, keeps it, redraws the card in place and closes the box', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await renameLead(recipeDataMessage, '  Sales leads ');

            expect(showInputBox).not.toHaveBeenCalled();
            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Sales leads' }));
            expect(lastPosted('treePreferences')).toEqual({
                command: 'treePreferences',
                renderSequence: recipeDataMessage.renderSequence,
                trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Sales leads', isFavorite: false }]
            });
            expect(lastPosted('treeRenameResult')).toEqual({ command: 'treeRenameResult', renderSequence: recipeDataMessage.renderSequence, treeKey: LEAD_TREE_KEY });
            // THE REDRAW COMES FIRST, SO THE BOX CLOSES ONTO THE NEW NAME
            expect(postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'treePreferences'))
                .toBeLessThan(postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'treeRenameResult'));

            // A REVEAL REPLAYS THE STORED MODEL, WHICH HAS TO CARRY THE NAME TOO
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData'), LEAD_TREE_KEY).customName).toBe('Sales leads');

        });

        it('refuses another card\'s name and a line break with a result naming why, and writes nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const refusalFor = async (name: string) => {
                postedPanelMessages = [];
                await renameLead(recipeDataMessage, name);
                expect(lastPosted('treePreferences')).toBeUndefined();
                return lastPosted('treeRenameResult');
            };

            expect(await refusalFor('account-thru-otherchildobject__c')).toEqual({
                command: 'treeRenameResult', renderSequence: recipeDataMessage.renderSequence, treeKey: LEAD_TREE_KEY, refusal: 'Another tree already has that name.'
            });
            expect((await refusalFor('Sales\nleads')).refusal).toContain('one line');
            expect((await refusalFor('Sales\u2028leads')).refusal).toContain('one line');
            expect((await refusalFor('Sales\u0007leads')).refusal).toContain('control characters');

            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, expect.anything());

        });

        it('clears the card\'s own name for an empty name, or one equal to its folder', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [LEAD_TREE_KEY]) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            await renameLead(recipeDataMessage, '');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_TREE_KEY]));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: LEAD_TREE_KEY, isFavorite: true }]);

            await renameLead(recipeDataMessage, 'Leads again');
            // #389: THE DEFAULT TITLE IS THE FOLDER, SO A NAME EQUAL TO IT IS NO NAME
            await renameLead(recipeDataMessage, ` ${LEAD_TREE_KEY} `);

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_TREE_KEY]));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: LEAD_TREE_KEY, isFavorite: true }]);

        });

        it('checks the name against what is stored NOW, so a name another window took since is refused', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            workspaceState.storedValues.set(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));

            await renameLead(recipeDataMessage, 'pipeline');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));
            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(lastPosted('treeRenameResult').refusal).toContain('already has that name');

        });

        it('given a forged card, a bad name, or a name typed over an older model, writes nothing and answers nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'renameTree', treeKey: 'Opportunity-ONLY', name: 'Pipeline', renderSequence: recipeDataMessage.renderSequence });
            await renameLead(recipeDataMessage, 7);
            await renameLead(recipeDataMessage, 'x'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH + 1));
            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'Leads', renderSequence: recipeDataMessage.renderSequence - 1 });

            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, expect.anything());
            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(lastPosted('treeRenameResult')).toBeUndefined();

        });

        it('given a write that fails, warns, redraws nothing and closes the box onto the old title', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await renameLead(recipeDataMessage, 'Leads');

            expect(warningSpy).toHaveBeenCalledTimes(1);
            expect(warningSpy.mock.calls[0][0]).toContain('could not be saved');
            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(lastPosted('treeRenameResult')).toEqual({ command: 'treeRenameResult', renderSequence: recipeDataMessage.renderSequence, treeKey: LEAD_TREE_KEY });
            expect(treeOf((RecipeCockpitService as any).recipeCockpitPanelState.recipeDataMessage, LEAD_TREE_KEY).customName).toBeUndefined();

        });

        it('never opens a VS Code input box to rename a card or a data set', () => {

            const source = require('fs').readFileSync(path.join(__dirname, '..', 'RecipeCockpitService.ts'), 'utf8') as string;
            const methodBody = (methodName: string) => {
                const start = source.indexOf(`private static async ${methodName}(`);
                expect(start).toBeGreaterThan(-1);
                return source.substring(start, source.indexOf('\n    }\n', start));
            };

            ['renameTree', 'renameDataset'].forEach(methodName => expect(methodBody(methodName)).not.toContain('showInputBox'));

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
        // FAVORITES ONLY NARROWS THE TREECIPES DROPDOWN (#374): THE CARDS IT LISTS, BY THE TITLE EACH OPTION DRAWS
        const shownTreeKeys = (panel: ReturnType<typeof runPanelScript>) => {
            const optionLabels = panel.treePickerLabels();
            return panel.findAll(panel.cockpitBodyElement, 'treePickerSelect')[0].disabled && panel.shownTreeCards().length === 0
                ? []
                : treeKeys.filter(treeKey => optionLabels.includes(titleOf(panel, treeKey)) || optionLabels.includes('★ ' + titleOf(panel, treeKey)));
        };
        const drawnTreeKeys = (panel: ReturnType<typeof runPanelScript>) => treeKeys.filter(treeKey => !panel.isHidden(cardOf(panel, treeKey)));
        const noFavoritesOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitBodyElement, 'emptyState')
            .find((element: any) => element.textContent === RECIPE_COCKPIT_NO_FAVORITES_MESSAGE);

        it('draws a card\'s own name in place of its default, its folder still beneath, and the star of a favorite', () => {

            const panel = drawRecipe(recipe => {
                recipe.trees[1].customName = 'Leads';
                recipe.trees[0].isFavorite = true;
            });

            expect(treeKeys.map(treeKey => titleOf(panel, treeKey))).toEqual(['Account-thru-OtherChildObject__c', 'Leads', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);
            expect(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0].textContent).toBe(LEAD_TREE_KEY);
            expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0])).toBe(false);
            // #389: A CARD WITH NO NAME OF ITS OWN IS TITLED BY ITS FOLDER, SO THE FOLDER IS NOT SAID TWICE
            expect(panel.isHidden(panel.findAll(cardOf(panel, ACCOUNT_TREE_KEY), 'treeFolder')[0])).toBe(true);
            expect(starOf(panel, ACCOUNT_TREE_KEY).textContent).toBe('★');
            expect(starOf(panel, ACCOUNT_TREE_KEY).attributes['aria-pressed']).toBe('true');
            expect(starOf(panel, LEAD_TREE_KEY).textContent).toBe('☆');
            expect(cardOf(panel, LEAD_TREE_KEY).attributes['aria-label']).toBe('Leads');
            // THE DROPDOWN NAMES EACH CARD BY ITS OWN NAME, A FAVORITE STARRED (#374)
            expect(panel.treePickerLabels()).toEqual(['★ Account-thru-OtherChildObject__c', 'Leads', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE]);

        });

        it('draws neither ✎ nor ☆ on the ungrouped card, which has no folder to keep them by', () => {

            const panel = drawRecipe();

            expect(panel.findAll(cardOf(panel, ''), 'treeFavorite')).toEqual([]);
            expect(panel.findAll(cardOf(panel, ''), 'treeRename')).toEqual([]);

        });

        // #540: ☆ AND ✎ COME FIRST, BEFORE THE NAME THEY ACT ON, AND ✎ IS THE ONE DRAWN PENCIL, LARGE
        it('draws ☆ then ✎ before the name, ✎ as the large drawn pencil with no text', () => {

            const panel = drawRecipe(recipe => { recipe.trees.find(tree => tree.treeKey === LEAD_TREE_KEY)!.customName = 'Leads'; });
            const header = cardOf(panel, LEAD_TREE_KEY).children[0];
            const actionGroup = header.children[0];
            const rename = panel.findAll(actionGroup, 'treeRename')[0];
            const glyph = rename.children[0];

            expect(actionGroup.className).toBe('treeHeaderActions');
            expect(actionGroup.children.map((actionElement: any) => actionElement.className.split(' ').pop())).toEqual(['treeFavorite', 'treeRename']);
            expect(header.children.map((childElement: any) => childElement.className.split(' ')[0])).toEqual(['treeHeaderActions', 'treeTitle', 'treeFolder', 'treeCount']);
            expect(rename.children).toHaveLength(1);
            expect(glyph.tagName.toLowerCase()).toBe('svg');
            expect(glyph.attributes.class).toBe('fixedValueGlyph fixedValueGlyph-large');
            expect(glyph.attributes['aria-hidden']).toBe('true');
            expect(glyph.children[0].attributes.d).toBe(RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH);
            expect(rename.textContent).not.toContain('✎');
            expect(rename.attributes['aria-label']).toBe('Rename Leads');
            expect(rename.attributes.title).toBe('Rename this tree');

        });

        it('builds the pencil in ONE place, and no button is labelled with a ✎ character', () => {

            const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(shellHtml.match(/setAttribute\('d', FIXED_VALUE_GLYPH_PATH\)/g)).toHaveLength(1);
            expect(shellHtml.match(/buildPencilGlyph\('large'\)/g)).toHaveLength(1);
            expect(shellHtml).not.toMatch(/createButton\([^)]*'✎'/);
            expect(shellHtml).toMatch(/\.fixedValueGlyph-large \{ width: 1\.4em; height: 1\.4em; \}/);

        });

        it('starts the ungrouped card\'s header with its name, since it has no ☆ or ✎', () => {

            const panel = drawRecipe();
            const header = cardOf(panel, '').children[0];

            expect(header.children[0].className).toBe('treeTitle');
            expect(panel.findAll(header, 'treeHeaderActions')).toEqual([]);

        });

        it('posts only the card\'s key for ☆, and neither ☆ nor ✎ changes the card on screen', () => {

            const panel = drawRecipe();
            const leadCard = cardOf(panel, LEAD_TREE_KEY);

            starOf(panel, LEAD_TREE_KEY).dispatch('click');
            panel.findAll(leadCard, 'treeRename')[0].dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => ['toggleFavoriteTree', 'renameTree'].includes(hostMessage.command))).toEqual([
                { command: 'toggleFavoriteTree', treeKey: LEAD_TREE_KEY }
            ]);
            // THE CARD ON SCREEN IS STILL THE FIRST
            expect(drawnTreeKeys(panel)).toEqual([ACCOUNT_TREE_KEY]);

        });

        describe('the inline name box (#551)', () => {

            const renameOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'treeRename')[0];
            const boxOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'nameEditor')[0];
            const inputOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'nameEditorInput')[0];
            const refusalOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'nameEditorRefusal')[0];
            const titleElementOf = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => panel.findAll(cardOf(panel, treeKey), 'treeTitle')[0];
            const renamesPosted = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'renameTree');
            const openBox = (panel: ReturnType<typeof runPanelScript>) => {
                panel.chooseTreeCard(cardOf(panel, LEAD_TREE_KEY));
                renameOf(panel, LEAD_TREE_KEY).dispatch('click');
                return inputOf(panel, LEAD_TREE_KEY);
            };
            const type = (inputElement: any, typedName: string) => { inputElement.value = typedName; inputElement.dispatch('input'); };

            it('opens in place of the title, empty with the folder as placeholder, selected and focused, and ✎ says it is open', () => {

                const panel = drawRecipe();
                expect(renameOf(panel, LEAD_TREE_KEY).attributes['aria-expanded']).toBe('false');
                expect(boxOf(panel, LEAD_TREE_KEY)).toBeUndefined();

                const inputElement = openBox(panel);

                expect(inputElement.tagName).toBe('input');
                expect(inputElement.value).toBe('');
                expect(inputElement.attributes.placeholder).toBe(LEAD_TREE_KEY);
                expect(inputElement.attributes.maxlength).toBe(String(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH));
                expect(inputElement.attributes.tabindex).toBeUndefined();
                expect(inputElement.selectedCount).toBe(1);
                expect(panel.activeElement()).toBe(inputElement);
                expect(panel.isHidden(titleElementOf(panel, LEAD_TREE_KEY))).toBe(true);
                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(false);
                expect(renameOf(panel, LEAD_TREE_KEY).attributes['aria-expanded']).toBe('true');
                expect(refusalOf(panel, LEAD_TREE_KEY).attributes.role).toBe('alert');
                expect(panel.isHidden(refusalOf(panel, LEAD_TREE_KEY))).toBe(true);

            });

            it('starts from the card\'s own name', () => {

                const panel = drawRecipe(recipe => { recipe.trees[1].customName = 'Leads'; });

                expect(openBox(panel).value).toBe('Leads');

            });

            it('posts the key, the name as typed and the model on Enter, and the blur after it posts nothing more', () => {

                const panel = drawRecipe();
                const inputElement = openBox(panel);

                type(inputElement, ' Sales leads ');
                inputElement.dispatch('keydown', { key: 'Enter' });
                inputElement.dispatch('blur');

                expect(renamesPosted(panel)).toEqual([{ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: ' Sales leads ', renderSequence: 3 }]);
                // STILL OPEN UNTIL THE HOST ANSWERS
                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(false);

                panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Sales leads', isFavorite: false }] });
                panel.postToPanel({ command: 'treeRenameResult', renderSequence: 3, treeKey: LEAD_TREE_KEY });

                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(true);
                expect(panel.isHidden(titleElementOf(panel, LEAD_TREE_KEY))).toBe(false);
                expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Sales leads');
                expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0])).toBe(false);
                expect(renameOf(panel, LEAD_TREE_KEY).attributes['aria-expanded']).toBe('false');
                expect(panel.activeElement()).toBe(renameOf(panel, LEAD_TREE_KEY));
                // THE DROPDOWN LISTS THE NEW NAME
                expect(panel.treePickerLabels()[1]).toBe('Sales leads');

            });

            it('saves on blur too', () => {

                const panel = drawRecipe();
                const inputElement = openBox(panel);

                type(inputElement, 'Leads');
                inputElement.dispatch('blur');

                expect(renamesPosted(panel)).toEqual([{ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'Leads', renderSequence: 3 }]);

            });

            it('Escape puts the title back unchanged, gives focus to ✎, and the blur after it saves nothing', () => {

                const panel = drawRecipe();
                const inputElement = openBox(panel);

                type(inputElement, 'Not this');
                inputElement.dispatch('keydown', { key: 'Escape' });
                inputElement.dispatch('blur');

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(true);
                expect(titleOf(panel, LEAD_TREE_KEY)).toBe(LEAD_TREE_KEY);
                expect(panel.isHidden(titleElementOf(panel, LEAD_TREE_KEY))).toBe(false);
                expect(panel.activeElement()).toBe(renameOf(panel, LEAD_TREE_KEY));
                expect(renameOf(panel, LEAD_TREE_KEY).attributes['aria-expanded']).toBe('false');

            });

            it('closes without posting when the name is the one the card already has', () => {

                const panel = drawRecipe(recipe => { recipe.trees[1].customName = 'Leads'; });
                const inputElement = openBox(panel);

                type(inputElement, ' Leads ');
                inputElement.dispatch('keydown', { key: 'Enter' });

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(true);

            });

            it('writes a refusal under the box with textContent, keeps what was typed, and sends a changed name again', () => {

                const panel = drawRecipe();
                const inputElement = openBox(panel);

                type(inputElement, 'Account-thru-OtherChildObject__c');
                inputElement.dispatch('keydown', { key: 'Enter' });
                panel.postToPanel({ command: 'treeRenameResult', renderSequence: 3, treeKey: LEAD_TREE_KEY, refusal: '<b>Another tree already has that name.</b>' });

                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(false);
                expect(inputElement.value).toBe('Account-thru-OtherChildObject__c');
                expect(refusalOf(panel, LEAD_TREE_KEY).textContent).toBe('<b>Another tree already has that name.</b>');
                expect(refusalOf(panel, LEAD_TREE_KEY).children).toEqual([]);
                expect(panel.isHidden(refusalOf(panel, LEAD_TREE_KEY))).toBe(false);

                // THE SAME REFUSED NAME IS NOT SENT AGAIN ON THE BLUR THAT FOLLOWS
                inputElement.dispatch('blur');
                expect(renamesPosted(panel)).toHaveLength(1);

                type(inputElement, 'Leads');
                inputElement.dispatch('keydown', { key: 'Enter' });
                expect(renamesPosted(panel)).toHaveLength(2);

            });

            it('ignores a result for another model, and a new model draws the card with no box open', () => {

                const panel = drawRecipe();
                const inputElement = openBox(panel);

                type(inputElement, 'Leads');
                inputElement.dispatch('keydown', { key: 'Enter' });
                panel.postToPanel({ command: 'treeRenameResult', renderSequence: 2, treeKey: LEAD_TREE_KEY, refusal: 'Stale' });

                expect(panel.isHidden(refusalOf(panel, LEAD_TREE_KEY))).toBe(true);
                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(false);

                panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 4 });

                expect(boxOf(panel, LEAD_TREE_KEY)).toBeUndefined();
                expect(panel.isHidden(titleElementOf(panel, LEAD_TREE_KEY))).toBe(false);

            });

            it('✎ again closes the box unchanged', () => {

                const panel = drawRecipe();
                openBox(panel);

                renameOf(panel, LEAD_TREE_KEY).dispatch('click');

                expect(panel.isHidden(boxOf(panel, LEAD_TREE_KEY))).toBe(true);
                expect(renamesPosted(panel)).toEqual([]);

            });

            it('styles the box with the field editor\'s existing colours, so the contrast pairs do not grow', () => {

                const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
                const nameEditorRules = shellHtml.split('\n').filter(line => line.includes('.nameEditor'));

                expect(nameEditorRules.length).toBeGreaterThan(0);
                nameEditorRules.forEach(rule => expect(rule).not.toMatch(/color|background|border/));

            });

        });

        it('redraws the cards the host names, and only for the model on screen', () => {

            const panel = drawRecipe();
            panel.chooseTreeCard(cardOf(panel, LEAD_TREE_KEY));

            panel.postToPanel({ command: 'treePreferences', renderSequence: 2, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Stale', isFavorite: true }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Lead-ONLY');

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Leads', isFavorite: true }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Leads');
            expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0])).toBe(false);
            expect(starOf(panel, LEAD_TREE_KEY).textContent).toBe('★');
            // REDRAWN IN PLACE: THE CARD THE READER OPENED IS STILL OPEN
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
            expect(panel.treePickerLabels()[1]).toBe('★ Leads');

            panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, isFavorite: false }] });
            expect(titleOf(panel, LEAD_TREE_KEY)).toBe('Lead-ONLY');
            // A CLEARED NAME FALLS BACK TO THE FOLDER (#389), AND THE SUBTITLE HIDES AGAIN
            expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0])).toBe(true);
            expect(panel.treePickerLabels()[1]).toBe('Lead-ONLY');
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
            expect(drawnTreeKeys(panel)).toEqual([LEAD_TREE_KEY]);
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
