import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
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
    RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH,
    RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    A tree card's own name and favorite, and the Favorites only filter (#235). The host keeps both
    by tree FOLDER NAME in workspaceState. The name is typed in the card's own inline box (#551) and
    checked again by the host, which answers nameEditResult; the panel redraws the header in place
    when the host says what changed.
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

        it('given renameTree for a drawn card, carries the typed name as it was typed, to be checked by the executor', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: '  Sales leads ', renderSequence: 4 }, buildDrawnPanelState()))
                .toEqual({ kind: 'renameTree', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, name: '  Sales leads ', renderSequence: 4 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'x'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH), renderSequence: 4 }, buildDrawnPanelState()))
                .toMatchObject({ kind: 'renameTree' });

        });

        it('given renameTree with no name, a name that is not text or too long, or for another model, does nothing', () => {

            const route = (renameMessage: Record<string, unknown>) => RecipeCockpitService.routePanelMessage({ command: 'renameTree', treeKey: LEAD_TREE_KEY, ...renameMessage }, buildDrawnPanelState());

            expect(route({ renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 7, renderSequence: 4 })).toBeUndefined();
            expect(route({ name: ['Leads'], renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 'x'.repeat(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH + 1), renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 'Leads' })).toBeUndefined();
            expect(route({ name: 'Leads', renderSequence: 3 })).toBeUndefined();
            expect(route({ name: 'Leads', renderSequence: '4' })).toBeUndefined();

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

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const renameTo = (recipeDataMessage: any, name: string) => receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: name, renderSequence: recipeDataMessage.renderSequence });

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

        it('renames a card from the name typed in the panel, keeps it trimmed, redraws the card in place, then closes the box', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            postedPanelMessages = [];

            await renameTo(recipeDataMessage, '  Sales leads ');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_TREE_KEY]: 'Sales leads' }));
            // THE NAME IS REDRAWN FIRST, SO THE BOX CLOSES ONTO IT
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['treePreferences', 'nameEditResult']);
            expect(lastPosted('treePreferences')).toEqual({
                command: 'treePreferences',
                renderSequence: recipeDataMessage.renderSequence,
                trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Sales leads', isFavorite: false }]
            });
            expect(lastPosted('nameEditResult')).toEqual({ command: 'nameEditResult', renderSequence: recipeDataMessage.renderSequence, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: '  Sales leads ' });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH HAS TO CARRY THE NAME TOO
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData'), LEAD_TREE_KEY).customName).toBe('Sales leads');

        });

        it('clears a card\'s name given an empty box, and given the card\'s own folder name (#389)', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_TREE_KEY]: 'Leads' }, [LEAD_TREE_KEY]) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            await renameTo(recipeDataMessage, '  ');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_TREE_KEY]));
            expect(lastPosted('treePreferences').trees).toEqual([{ treeKey: LEAD_TREE_KEY, isFavorite: true }]);

            await renameTo(recipeDataMessage, 'Leads');
            await renameTo(recipeDataMessage, ` ${LEAD_TREE_KEY} `);

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_TREE_KEY]));
            expect(lastPosted('nameEditResult').refusal).toBeUndefined();

        });

        it.each([
            ['another card\'s name, without case', 'account-thru-otherchildobject__c', 'already has that name'],
            ['more than one line', 'Sales\nleads', 'one line'],
            ['a line separator', 'Sales\u2028leads', 'one line']
        ])('refuses %s under the box, writes nothing and redraws nothing', async (_description, typedName, refusalText) => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await renameTo(recipeDataMessage, typedName);

            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, expect.anything());
            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(lastPosted('nameEditResult')).toMatchObject({ nameTarget: 'tree', nameKey: LEAD_TREE_KEY, renderSequence: recipeDataMessage.renderSequence });
            expect(lastPosted('nameEditResult').refusal).toContain(refusalText);
            // THE REASON IS UNDER THE BOX, NOT IN A NOTIFICATION
            expect(warningSpy).not.toHaveBeenCalled();

        });

        it('checks the name against the names stored when it runs, which another window can have changed', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            workspaceState.storedValues.set(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));

            await renameTo(recipeDataMessage, 'pipeline');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ 'Opportunity-ONLY': 'Pipeline' }));
            expect(lastPosted('nameEditResult').refusal).toContain('already has that name');

        });

        it('given a write that fails, keeps the old name on screen, warns, and says so under the box', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await renameTo(recipeDataMessage, 'Sales leads');

            expect(lastPosted('treePreferences')).toBeUndefined();
            expect(lastPosted('nameEditResult').refusal).toBe(RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL);
            expect(warningSpy.mock.calls[0][0]).toContain('read-only');
            expect(treeOf((RecipeCockpitService as any).recipeCockpitPanelState.recipeDataMessage, LEAD_TREE_KEY).customName).toBeUndefined();

        });

        it('answers with the model the name was typed over, even when a new model is drawn while the name is written', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            let finishWrite: () => void = () => undefined;
            workspaceState.update.mockImplementation((key: string, value: unknown) => new Promise<void>(resolve => {
                finishWrite = () => { workspaceState.storedValues.set(key, JSON.parse(JSON.stringify(value))); resolve(); };
            }));

            const renaming = renameTo(recipeDataMessage, 'Sales leads');
            await receivedMessageHandler({ command: 'selectRun', runFolderName: CURRENT_RUN_FOLDER_NAME });
            const newRecipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: newRecipeDataMessage.renderSequence });
            finishWrite();
            await renaming;

            expect(newRecipeDataMessage.renderSequence).not.toBe(recipeDataMessage.renderSequence);
            expect(lastPosted('nameEditResult')).toMatchObject({ renderSequence: recipeDataMessage.renderSequence, name: 'Sales leads' });

        });

        it('given a rename typed over a model no longer on screen, writes nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'Sales leads', renderSequence: recipeDataMessage.renderSequence - 1 });

            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY, expect.anything());
            expect(lastPosted('nameEditResult')).toBeUndefined();

        });

        it('asks for no name in a VS Code input box: the box is the panel\'s (#551)', () => {

            const serviceSource = require('fs').readFileSync(path.join(__dirname, '..', 'RecipeCockpitService.ts'), 'utf8') as string;
            const methodSourceOf = (methodName: string) => {
                const methodStart = serviceSource.indexOf(`private static async ${methodName}(`);
                return serviceSource.slice(methodStart, serviceSource.indexOf('\n    }\n', methodStart));
            };

            ['renameTree', 'renameDataset'].forEach(methodName => {
                expect(methodSourceOf(methodName)).toContain('validate');
                expect(methodSourceOf(methodName)).not.toContain('showInputBox');
            });

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

        it('posts only the card\'s key for ☆, and ✎ posts nothing and changes no card on screen', () => {

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

        describe('the inline rename box (#551)', () => {

            const drawAndAcknowledge = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
                return drawRecipe(recipeChanges);
            };
            const renameOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeRename')[0];
            const editorOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeNameEditor')[0];
            const inputOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'nameEditorInput')[0];
            const refusalOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'nameEditorRefusal')[0];
            const leadTitleElementOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeTitle')[0];
            const renamesPosted = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'renameTree');
            const openBox = (panel: ReturnType<typeof runPanelScript>) => renameOf(panel).dispatch('click');
            const type = (panel: ReturnType<typeof runPanelScript>, typedName: string) => { inputOf(panel).value = typedName; };

            it('builds no box until ✎ is clicked, then puts a box with the card\'s own name, selected, where the name was', () => {

                const panel = drawAndAcknowledge(recipe => { recipe.trees[1].customName = 'Leads'; });

                expect(editorOf(panel)).toBeUndefined();
                expect(renameOf(panel).attributes['aria-expanded']).toBe('false');

                openBox(panel);

                const header = cardOf(panel, LEAD_TREE_KEY).children[0];
                expect(header.children.map((childElement: any) => childElement.className.split(' ')[0])).toEqual(['treeHeaderActions', 'nameEditor', 'treeTitle', 'treeFolder', 'treeCount']);
                expect(panel.isHidden(editorOf(panel))).toBe(false);
                expect(panel.isHidden(leadTitleElementOf(panel))).toBe(true);
                expect(editorOf(panel).attributes.role).toBe('group');
                expect(editorOf(panel).attributes['aria-label']).toBe('Rename Leads');
                expect(inputOf(panel).value).toBe('Leads');
                expect(inputOf(panel).attributes.placeholder).toBe(LEAD_TREE_KEY);
                expect(inputOf(panel).attributes.maxlength).toBe(String(RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH));
                expect(inputOf(panel).attributes['aria-label']).toBe(`New name for Leads. Leave it empty to show ${LEAD_TREE_KEY}.`);
                expect(inputOf(panel).selectedCount).toBe(1);
                expect(panel.activeElement()).toBe(inputOf(panel));
                expect(renameOf(panel).attributes['aria-expanded']).toBe('true');
                expect(refusalOf(panel).attributes.role).toBe('alert');
                expect(panel.isHidden(refusalOf(panel))).toBe(true);

            });

            it('starts empty for a card with no name of its own', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);

                expect(inputOf(panel).value).toBe('');

            });

            it('posts the typed name, the card and the model on Enter, and the blur that follows posts nothing more', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, ' Sales leads ');

                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
                inputOf(panel).dispatch('blur');

                expect(renamesPosted(panel)).toEqual([{ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: ' Sales leads ', renderSequence: 3 }]);
                // THE BOX WAITS FOR THE HOST
                expect(panel.isHidden(editorOf(panel))).toBe(false);

            });

            it('posts the typed name when the box is left', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'Sales leads');

                inputOf(panel).dispatch('blur');

                expect(renamesPosted(panel)).toEqual([{ command: 'renameTree', treeKey: LEAD_TREE_KEY, name: 'Sales leads', renderSequence: 3 }]);

            });

            it('given Escape, posts nothing, puts the name back and gives focus to ✎, and the blur that follows posts nothing', () => {

                const panel = drawAndAcknowledge(recipe => { recipe.trees[1].customName = 'Leads'; });
                openBox(panel);
                type(panel, 'Sales leads');

                inputOf(panel).dispatch('keydown', { key: 'Escape', preventDefault: () => undefined });
                inputOf(panel).dispatch('blur');

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(editorOf(panel))).toBe(true);
                expect(panel.isHidden(leadTitleElementOf(panel))).toBe(false);
                expect(leadTitleElementOf(panel).textContent).toBe('Leads');
                expect(renameOf(panel).attributes['aria-expanded']).toBe('false');
                expect(panel.activeElement()).toBe(renameOf(panel));

            });

            it('given ✎ again while the box is open, closes it with nothing posted, as a cancel', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'Sales leads');

                let isDefaultPrevented = false;
                renameOf(panel).dispatch('mousedown', { preventDefault: () => { isDefaultPrevented = true; } });
                openBox(panel);

                // A BROWSER WOULD NOT MOVE FOCUS ON A PREVENTED mousedown, SO THE BOX'S blur NEVER SAVES
                expect(isDefaultPrevented).toBe(true);
                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(editorOf(panel))).toBe(true);

            });

            it('closes with nothing posted when the name is the one the card already has', () => {

                const panel = drawAndAcknowledge(recipe => { recipe.trees[1].customName = 'Leads'; });
                openBox(panel);
                type(panel, ' Leads ');

                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(editorOf(panel))).toBe(true);

            });

            it('writes the host\'s refusal under the box and keeps it open with what was typed, and posts the same name only once', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'account-thru-otherchildobject__c');
                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'account-thru-otherchildobject__c', refusal: '<b>Another tree</b> already has that name.' });

                expect(refusalOf(panel).textContent).toBe('<b>Another tree</b> already has that name.');
                expect(refusalOf(panel).children).toEqual([]);
                expect(inputOf(panel).attributes['aria-invalid']).toBe('true');
                expect(inputOf(panel).attributes['aria-describedby']).toBe(refusalOf(panel).attributes.id);
                expect(panel.isHidden(refusalOf(panel))).toBe(false);
                expect(panel.isHidden(editorOf(panel))).toBe(false);
                expect(inputOf(panel).value).toBe('account-thru-otherchildobject__c');

                inputOf(panel).dispatch('blur');
                expect(renamesPosted(panel)).toHaveLength(1);

                type(panel, 'Sales leads');
                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
                expect(renamesPosted(panel)).toHaveLength(2);

            });

            it('settles only the answer to the name posted last, whatever order the answers arrive in', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'Foo');
                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
                type(panel, 'Bar');
                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'Foo' });
                expect(panel.isHidden(editorOf(panel))).toBe(false);

                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'Bar', refusal: 'Another tree already has that name.' });
                expect(refusalOf(panel).textContent).toBe('Another tree already has that name.');
                expect(inputOf(panel).value).toBe('Bar');

            });

            it('does not save on the Enter that ends an input method\'s composition', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, '名前');

                inputOf(panel).dispatch('keydown', { key: 'Enter', isComposing: true, preventDefault: () => undefined });

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(editorOf(panel))).toBe(false);

            });

            it('closes once the host has saved and redrawn the name', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'Sales leads');
                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

                panel.postToPanel({ command: 'treePreferences', renderSequence: 3, trees: [{ treeKey: LEAD_TREE_KEY, customName: 'Sales leads', isFavorite: false }] });
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'Sales leads' });

                expect(panel.isHidden(editorOf(panel))).toBe(true);
                expect(panel.isHidden(leadTitleElementOf(panel))).toBe(false);
                expect(leadTitleElementOf(panel).textContent).toBe('Sales leads');
                expect(panel.isHidden(panel.findAll(cardOf(panel, LEAD_TREE_KEY), 'treeFolder')[0])).toBe(false);
                expect(renameOf(panel).attributes['aria-expanded']).toBe('false');

            });

            it('ignores an answer for another model, another card or a box that posted nothing', () => {

                const panel = drawAndAcknowledge();
                openBox(panel);
                type(panel, 'Sales leads');

                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'Sales leads', refusal: 'Not posted yet.' });
                expect(panel.isHidden(refusalOf(panel))).toBe(true);

                inputOf(panel).dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 2, nameTarget: 'tree', nameKey: LEAD_TREE_KEY, name: 'Sales leads' });
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: ACCOUNT_TREE_KEY, name: 'Sales leads' });
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'dataset', nameKey: LEAD_TREE_KEY, name: 'Sales leads' });
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'tree', nameKey: LEAD_TREE_KEY });

                expect(panel.isHidden(editorOf(panel))).toBe(false);

            });

            it('draws the box in the panel\'s own colours, its reason in the header\'s light text', () => {

                const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

                expect(shellHtml).toMatch(/\.nameEditorInput \{[^}]*color: var\(--sdt-text\);[^}]*background-color: var\(--sdt-surface\);/);
                expect(shellHtml).toContain('.treeNameEditor .nameEditorRefusal { font-weight: 600; color: var(--sdt-on-header); }');
                // A NAVY RING VANISHES ON THE NAVY HEADER, SO THE BOX RINGS IN TEAL THERE, AS EVERY HEADER CONTROL DOES
                expect(shellHtml).toContain('.treeHeader .nameEditorInput:focus { outline-color: var(--sdt-action); }');
                expect(shellHtml).toContain('.nameEditorRefusal { font-size: 0.9em; color: var(--sdt-removed); }');

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
