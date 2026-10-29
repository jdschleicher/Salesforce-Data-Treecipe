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
    IRecipeCockpitDatasetPreferences,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY,
    RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION,
    RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH,
    RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH,
    RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    A data set's own name and favorite, and the data sets tab's Favorites only, as #235 does
    for a tree card. The host keeps both by data set FOLDER NAME in workspaceState. The name is
    typed in the row's own inline box (#551) and checked again by the host, which answers
    nameEditResult; the panel redraws that row in place on every card that lists it.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_DATASET = 'dataset-2026-09-21T00-00-00-2';
const LEAD_DATASETS = ['dataset-2026-09-21T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-02T00-00-00'];
const DATASETS_TAB_LABEL = 'Previously Used Data Sets';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const buildPreferences = (customNames: Record<string, string> = {}, favoriteFolderNames: string[] = []): IRecipeCockpitDatasetPreferences => ({
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
    version: RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION,
    customNames: customNames,
    favoriteFolderNames: favoriteFolderNames
});

describe('RecipeCockpitService, data set names and favorites', () => {

    describe('readDatasetPreferences and writeDatasetPreferences', () => {

        it('given no workspace state, nothing stored, or another shape, reads none', () => {

            const isEmpty = (datasetPreferences: IRecipeCockpitDatasetPreferences) => datasetPreferences.customNamesByFolderName.size === 0 && datasetPreferences.favoriteFolderNames.size === 0;

            expect(isEmpty(RecipeCockpitService.readDatasetPreferences(undefined))).toBe(true);
            expect(isEmpty(RecipeCockpitService.readDatasetPreferences(buildWorkspaceState()))).toBe(true);
            expect(isEmpty(RecipeCockpitService.readDatasetPreferences(buildWorkspaceState({
                [RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY]: { ...storedPreferences({ [ACCOUNT_DATASET]: 'Seed' }), version: RECIPE_COCKPIT_DATASET_PREFERENCES_VERSION + 1 }
            })))).toBe(true);

            const throwingState = { get: () => { throw new Error('no state'); }, update: jest.fn() };
            expect(isEmpty(RecipeCockpitService.readDatasetPreferences(throwingState as any))).toBe(true);

        });

        it('drops each entry that could not have been saved and keeps the rest, a folder named __proto__ included', () => {

            const datasetPreferences = RecipeCockpitService.readDatasetPreferences(buildWorkspaceState({
                [RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY]: JSON.parse(JSON.stringify(storedPreferences({
                    [ACCOUNT_DATASET]: 'Seed',
                    ['__proto__']: 'Prototype data set',
                    notText: 7,
                    untrimmed: ' Padded ',
                    twoLines: 'One\nTwo',
                    tooLong: 'n'.repeat(RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH + 1)
                }, [LEAD_DATASETS[0], 7, ''])))
            }));

            expect([...datasetPreferences.customNamesByFolderName.entries()]).toEqual([[ACCOUNT_DATASET, 'Seed'], ['__proto__', 'Prototype data set']]);
            expect([...datasetPreferences.favoriteFolderNames]).toEqual([LEAD_DATASETS[0]]);

        });

        it('writes what it reads back, under its own key and never the trees\'', async () => {

            const workspaceState = buildWorkspaceState();
            const datasetPreferences = buildPreferences({ [ACCOUNT_DATASET]: 'Seed', ['__proto__']: 'Prototype data set' }, [LEAD_DATASETS[1]]);

            await expect(RecipeCockpitService.writeDatasetPreferences(workspaceState, datasetPreferences)).resolves.toBe(true);

            expect(workspaceState.storedValues.has(RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY)).toBe(false);
            expect(RecipeCockpitService.readDatasetPreferences(workspaceState)).toEqual(datasetPreferences);

        });

        it('given no workspace state, or a write that fails, says so and answers false', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            const failingState = buildWorkspaceState();
            failingState.update.mockImplementation(() => Promise.reject(new Error('read-only [x](command:y)')));

            await expect(RecipeCockpitService.writeDatasetPreferences(undefined, buildPreferences())).resolves.toBe(false);
            await expect(RecipeCockpitService.writeDatasetPreferences(failingState, buildPreferences())).resolves.toBe(false);

            expect(warningSpy.mock.calls[0][0]).toContain('data set names and favorites');
            expect(warningSpy.mock.calls[1][0]).toContain('The data set name or favorite could not be saved');
            expect(warningSpy.mock.calls[1][0]).not.toContain('[x](command:y)');

        });

    });

    describe('validateDatasetName', () => {

        const trees = () => loadRecipe().trees;

        it('accepts an empty name, which clears it, and a name no other data set has', () => {

            expect(RecipeCockpitService.validateDatasetName('   ', ACCOUNT_DATASET, buildPreferences(), trees())).toBeUndefined();
            expect(RecipeCockpitService.validateDatasetName(' Seed ', ACCOUNT_DATASET, buildPreferences(), trees())).toBeUndefined();
            // ITS OWN NAME AND ITS OWN FOLDER ARE NOT "ANOTHER" DATA SET'S
            expect(RecipeCockpitService.validateDatasetName('Seed', ACCOUNT_DATASET, buildPreferences({ [ACCOUNT_DATASET]: 'Seed' }), trees())).toBeUndefined();
            expect(RecipeCockpitService.validateDatasetName(ACCOUNT_DATASET, ACCOUNT_DATASET, buildPreferences(), trees())).toBeUndefined();

        });

        it('refuses another data set\'s name or folder name, without case, and one that is not one short line', () => {

            expect(RecipeCockpitService.validateDatasetName('SEED', ACCOUNT_DATASET, buildPreferences({ 'dataset-gone': 'Seed' }), trees())).toContain('already has that name');
            expect(RecipeCockpitService.validateDatasetName(LEAD_DATASETS[0].toUpperCase(), ACCOUNT_DATASET, buildPreferences(), trees())).toContain('already has that name');
            expect(RecipeCockpitService.validateDatasetName('One Two', ACCOUNT_DATASET, buildPreferences(), trees())).toContain('one line');
            expect(RecipeCockpitService.validateDatasetName('n'.repeat(RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH + 1), ACCOUNT_DATASET, buildPreferences(), trees()))
                .toContain(`at most ${RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH}`);

        });

    });

    describe('applyDatasetPreferences', () => {

        it('names and stars every row of a data set, and takes off what was cleared', () => {

            const recipe = loadRecipe();
            RecipeCockpitService.applyDatasetPreferences(recipe.trees, buildPreferences({ [LEAD_DATASETS[1]]: 'Before the fix' }, [ACCOUNT_DATASET]));

            const leadDatasets = recipe.trees[1].history!.datasets;
            expect(recipe.trees[0].history!.datasets[0]).toMatchObject({ datasetFolderName: ACCOUNT_DATASET, isFavorite: true });
            expect(leadDatasets[1].customName).toBe('Before the fix');
            expect(leadDatasets[0].customName).toBeUndefined();
            expect(leadDatasets[0].isFavorite).toBeUndefined();

            RecipeCockpitService.applyDatasetPreferences(recipe.trees, buildPreferences());

            expect(recipe.trees[0].history!.datasets[0].isFavorite).toBeUndefined();
            expect(leadDatasets[1].customName).toBeUndefined();

        });

    });

    describe('routePanelMessage, renameDataset and toggleFavoriteDataset', () => {

        const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it('allows every data set row the model lists', () => {

            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(loadRecipe()).nameableDatasetFolderNames].sort())
                .toEqual([ACCOUNT_DATASET, ...LEAD_DATASETS].sort());

        });

        it('given toggleFavoriteDataset for a drawn row, names its folder', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'toggleFavoriteDataset', datasetFolderName: LEAD_DATASETS[1] }, buildDrawnPanelState()))
                .toEqual({ kind: 'toggleFavoriteDataset', datasetFolderName: LEAD_DATASETS[1] });

        });

        it('given renameDataset for a drawn row, carries the typed name as it was typed, to be checked by the executor', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'renameDataset', datasetFolderName: LEAD_DATASETS[1], name: ' Before the fix ', renderSequence: 4 }, buildDrawnPanelState()))
                .toEqual({ kind: 'renameDataset', datasetFolderName: LEAD_DATASETS[1], name: ' Before the fix ' });

        });

        it('given renameDataset with no name, a name that is not text or too long, or for another model, does nothing', () => {

            const route = (renameMessage: Record<string, unknown>) => RecipeCockpitService.routePanelMessage({ command: 'renameDataset', datasetFolderName: LEAD_DATASETS[1], ...renameMessage }, buildDrawnPanelState());

            expect(route({ renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 7, renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 'x'.repeat(RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH + 1), renderSequence: 4 })).toBeUndefined();
            expect(route({ name: 'Seed' })).toBeUndefined();
            expect(route({ name: 'Seed', renderSequence: 5 })).toBeUndefined();

        });

        it.each(['renameDataset', 'toggleFavoriteDataset'])('given %s for anything else, does nothing', (command) => {

            const route = (datasetFolderName: unknown, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: command, datasetFolderName: datasetFolderName, name: 'Seed', renderSequence: 4 }, panelState);

            expect(route('dataset-2026-09-03T00-00-00')).toBeUndefined();
            expect(route('../outside')).toBeUndefined();
            expect(route(7)).toBeUndefined();
            expect(route(undefined)).toBeUndefined();

            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            expect(route(ACCOUNT_DATASET, undrawnPanelState)).toBeUndefined();

            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;
            expect(route(ACCOUNT_DATASET, modelLessPanelState)).toBeUndefined();

        });

        it('allows a data set added in place only once the panel says its row is drawn', () => {

            const panelState = buildDrawnPanelState();
            const addedDataset = { datasetFolderName: 'dataset-2026-09-22T00-00-00', generatedAtLabel: '', fakerService: 'snowfakery' as const, runFolderName: null, recordCounts: null };

            panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.cloneTreeHistoryAllowLists(panelState.treeHistoryAllowLists);
            RecipeCockpitService.addDatasetToAllowLists(panelState.pendingTreeHistoryAllowLists, addedDataset);

            expect(RecipeCockpitService.routePanelMessage({ command: 'renameDataset', datasetFolderName: addedDataset.datasetFolderName, name: 'Seed', renderSequence: 4 }, panelState)).toBeUndefined();
            expect(panelState.pendingTreeHistoryAllowLists.nameableDatasetFolderNames.has(addedDataset.datasetFolderName)).toBe(true);

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const renameTo = (recipeDataMessage: any, datasetFolderName: string, name: string) =>
            receivedMessageHandler({ command: 'renameDataset', datasetFolderName: datasetFolderName, name: name, renderSequence: recipeDataMessage.renderSequence });

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

        const datasetsOf = (recipeDataMessage: any, treeKey: string) => recipeDataMessage.recipe.trees.find((tree: any) => tree.treeKey === treeKey).history.datasets;
        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY);

        beforeEach(() => {
            postedPanelMessages = [];
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('draws the data sets with the names and favorites workspaceState kept', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY]: storedPreferences({ [LEAD_DATASETS[1]]: 'Before the fix' }, [ACCOUNT_DATASET]) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(datasetsOf(recipeDataMessage, LEAD_TREE_KEY)[1]).toMatchObject({ datasetFolderName: LEAD_DATASETS[1], customName: 'Before the fix' });
            expect(datasetsOf(recipeDataMessage, ACCOUNT_TREE_KEY)[0].isFavorite).toBe(true);

        });

        it('renames a data set from the name typed in its row, keeps it trimmed, posts the change for that row, then closes the box', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            postedPanelMessages = [];

            await renameTo(recipeDataMessage, LEAD_DATASETS[1], '  Before the fix ');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ [LEAD_DATASETS[1]]: 'Before the fix' }));
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['datasetPreferences', 'nameEditResult']);
            expect(lastPosted('datasetPreferences')).toEqual({
                command: 'datasetPreferences',
                renderSequence: recipeDataMessage.renderSequence,
                datasetFolderName: LEAD_DATASETS[1],
                customName: 'Before the fix',
                isFavorite: false
            });
            expect(lastPosted('nameEditResult')).toEqual({ command: 'nameEditResult', renderSequence: recipeDataMessage.renderSequence, nameTarget: 'dataset', nameKey: LEAD_DATASETS[1] });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH HAS TO CARRY THE NAME TOO
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(datasetsOf(lastPosted('recipeData'), LEAD_TREE_KEY)[1].customName).toBe('Before the fix');

        });

        it('clears a data set\'s name given an empty box', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY]: storedPreferences({ [ACCOUNT_DATASET]: 'Seed' }, [ACCOUNT_DATASET]) });
            const recipeDataMessage = await openAndDraw(workspaceState);

            await renameTo(recipeDataMessage, ACCOUNT_DATASET, '');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [ACCOUNT_DATASET]));
            expect(lastPosted('datasetPreferences')).toEqual(expect.objectContaining({ datasetFolderName: ACCOUNT_DATASET, isFavorite: true }));
            expect(lastPosted('datasetPreferences').customName).toBeUndefined();
            expect(lastPosted('nameEditResult').refusal).toBeUndefined();

        });

        it('refuses another data set\'s folder name, or a name another window stored since, under the box, and writes nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await renameTo(recipeDataMessage, LEAD_DATASETS[1], ACCOUNT_DATASET.toUpperCase());

            expect(lastPosted('nameEditResult')).toMatchObject({ nameTarget: 'dataset', nameKey: LEAD_DATASETS[1] });
            expect(lastPosted('nameEditResult').refusal).toContain('already has that name');

            workspaceState.storedValues.set(RECIPE_COCKPIT_DATASET_PREFERENCES_STATE_KEY, storedPreferences({ 'dataset-elsewhere': 'Seed' }));
            await renameTo(recipeDataMessage, ACCOUNT_DATASET, 'seed');

            expect(storedOf(workspaceState)).toEqual(storedPreferences({ 'dataset-elsewhere': 'Seed' }));
            expect(lastPosted('datasetPreferences')).toBeUndefined();
            expect(lastPosted('nameEditResult')).toMatchObject({ nameKey: ACCOUNT_DATASET });
            expect(lastPosted('nameEditResult').refusal).toContain('already has that name');
            expect(warningSpy).not.toHaveBeenCalled();

        });

        it('given a write that fails, keeps the row\'s name, warns, and says so under the box', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await renameTo(recipeDataMessage, ACCOUNT_DATASET, 'Seed');

            expect(lastPosted('datasetPreferences')).toBeUndefined();
            expect(lastPosted('nameEditResult').refusal).toBe(RECIPE_COCKPIT_NAME_NOT_SAVED_REFUSAL);
            expect(warningSpy.mock.calls[0][0]).toContain('read-only');

        });

        it('marks a data set a favorite and takes it off again, and a reload of the run draws the star', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'toggleFavoriteDataset', datasetFolderName: LEAD_DATASETS[2] });

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, [LEAD_DATASETS[2]]));
            expect(lastPosted('datasetPreferences')).toEqual(expect.objectContaining({ datasetFolderName: LEAD_DATASETS[2], isFavorite: true }));

            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'selectRun', runFolderName: CURRENT_RUN_FOLDER_NAME });
            expect(datasetsOf(lastPosted('recipeData'), LEAD_TREE_KEY)[2].isFavorite).toBe(true);
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });

            await receivedMessageHandler({ command: 'toggleFavoriteDataset', datasetFolderName: LEAD_DATASETS[2] });

            expect(storedOf(workspaceState)).toEqual(storedPreferences({}, []));
            expect(lastPosted('datasetPreferences')).toEqual(expect.objectContaining({ datasetFolderName: LEAD_DATASETS[2], isFavorite: false }));

        });

        it('given a write that fails, leaves the rows as they were', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await receivedMessageHandler({ command: 'toggleFavoriteDataset', datasetFolderName: ACCOUNT_DATASET });

            expect(lastPosted('datasetPreferences')).toBeUndefined();

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, panelScriptOptions = {}, extraMessage: any = {}) => {
            const panel = runPanelScript(panelScriptOptions);
            const recipe = loadRecipe();
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3, ...extraMessage });
            return panel;
        };

        const leadCardOf = (panel: ReturnType<typeof runPanelScript>) => panel.treeCards()[1];
        const openLeadDatasets = (panel: ReturnType<typeof runPanelScript>) => {
            const leadCard = leadCardOf(panel);
            panel.chooseTreeCard(leadCard);
            panel.openTab(leadCard, DATASETS_TAB_LABEL);
            return panel.tabPanelOf(leadCard, 'treeDatasets');
        };
        const rowsOf = (panel: ReturnType<typeof runPanelScript>, tabPanel: any) => panel.findAll(tabPanel, 'treeDataset');
        const shownFolderNamesOf = (panel: ReturnType<typeof runPanelScript>, tabPanel: any) => rowsOf(panel, tabPanel)
            .filter((rowElement: any) => !panel.isHidden(rowElement))
            .map((rowElement: any) => panel.findAll(rowElement, 'treeDatasetFolder')[0].textContent);
        const favoritesToggleOf = (panel: ReturnType<typeof runPanelScript>, tabPanel: any) => panel.findAll(tabPanel, 'treeDatasetFavoritesToggle')[0];

        it('draws a data set\'s own name beside its folder, and the star of a favorite', () => {

            const panel = drawRecipe(recipe => {
                recipe.trees[1].history!.datasets[1].customName = 'Before the fix';
                recipe.trees[1].history!.datasets[0].isFavorite = true;
            });
            const rows = rowsOf(panel, openLeadDatasets(panel));

            expect(panel.findAll(rows[1], 'treeDatasetName')[0].textContent).toBe('Before the fix');
            expect(panel.isHidden(panel.findAll(rows[1], 'treeDatasetName')[0])).toBe(false);
            expect(panel.findAll(rows[1], 'treeDatasetFolder')[0].textContent).toBe(LEAD_DATASETS[1]);
            expect(panel.isHidden(panel.findAll(rows[0], 'treeDatasetName')[0])).toBe(true);
            expect(panel.findAll(rows[0], 'treeDatasetFavorite')[0].textContent).toBe('★');
            expect(panel.findAll(rows[0], 'treeDatasetFavorite')[0].attributes['aria-pressed']).toBe('true');
            expect(panel.findAll(rows[1], 'treeDatasetFavorite')[0].textContent).toBe('☆');
            expect(panel.findAll(rows[1], 'treeDatasetRename')[0].attributes['aria-label']).toBe('Rename Before the fix');

        });

        // #540: A DATA SET ROW'S ✎ IS THE ONE DRAWN PENCIL, DEFAULT SIZE, RIGHT AFTER ☆ AND BEFORE THE NAME
        it('draws ✎ as the default drawn pencil, right after ☆ and before the name', () => {

            const panel = drawRecipe(recipe => { recipe.trees[1].history!.datasets[0].customName = 'Before the fix'; });
            const [firstRow] = rowsOf(panel, openLeadDatasets(panel));
            const header = panel.findAll(firstRow, 'treeDatasetHeader')[0];
            const classNames = header.children.map((childElement: any) => childElement.className.split(' ').pop());
            const rename = panel.findAll(header, 'treeDatasetRename')[0];
            const glyph = rename.children[0];

            // THE INSERT JOURNEY'S ▸ (#471) LEADS THE ROW, AS ON EVERY EXPANDABLE ROW; ☆, ✎ AND THE NAME FOLLOW IT
            expect(header.children[0].className.split(' ')).toContain('treeDatasetJourneyToggle');
            expect(classNames.slice(1, 4)).toEqual(['treeDatasetFavorite', 'treeDatasetRename', 'treeDatasetName']);
            expect(rename.children).toHaveLength(1);
            expect(glyph.attributes.class).toBe('fixedValueGlyph');
            expect(glyph.children[0].attributes.d).toBe(RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH);
            expect(rename.textContent).not.toContain('✎');
            expect(rename.attributes['aria-label']).toBe('Rename Before the fix');
            // THE ROW ALIGNS BY BASELINE AND AN SVG HAS NONE, SO THE PENCIL BUTTON IS CENTRED OR IT SITS ABOVE THE ☆
            expect(RecipeCockpitService.buildWebviewShellHtml('testNonce')).toContain('.treeDatasetRename { align-self: center; }');

        });

        it('posts only the data set\'s folder name for ☆, and ✎ posts nothing until a name is typed', () => {

            const panel = drawRecipe();
            const [firstRow] = rowsOf(panel, openLeadDatasets(panel));

            panel.findAll(firstRow, 'treeDatasetFavorite')[0].dispatch('click');
            panel.findAll(firstRow, 'treeDatasetRename')[0].dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => ['toggleFavoriteDataset', 'renameDataset'].includes(hostMessage.command))).toEqual([
                { command: 'toggleFavoriteDataset', datasetFolderName: LEAD_DATASETS[0] }
            ]);

        });

        describe('the inline rename box (#551)', () => {

            const secondRowOf = (panel: ReturnType<typeof runPanelScript>) => rowsOf(panel, openLeadDatasets(panel))[1];
            const partOf = (panel: ReturnType<typeof runPanelScript>, rowElement: any, className: string) => panel.findAll(rowElement, className)[0];
            const renamesPosted = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'renameDataset');
            const enter = (inputElement: any) => inputElement.dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

            it('puts a box with the row\'s own name where the name was, then posts the typed name, the row and the model on Enter', () => {

                const panel = drawRecipe(recipe => { recipe.trees[1].history!.datasets[1].customName = 'Before the fix'; });
                const row = secondRowOf(panel);
                const rename = partOf(panel, row, 'treeDatasetRename');

                expect(partOf(panel, row, 'datasetNameEditor')).toBeUndefined();
                rename.dispatch('click');

                const header = partOf(panel, row, 'treeDatasetHeader');
                const classNames = header.children.map((childElement: any) => childElement.className.split(' ')[0]);
                expect(classNames.indexOf('nameEditor')).toBe(classNames.indexOf('treeDatasetName') - 1);
                const input = partOf(panel, row, 'nameEditorInput');
                expect(input.value).toBe('Before the fix');
                expect(input.attributes.placeholder).toBe(LEAD_DATASETS[1]);
                expect(input.attributes.maxlength).toBe(String(RECIPE_COCKPIT_DATASET_NAME_MAX_LENGTH));
                expect(panel.activeElement()).toBe(input);
                expect(panel.isHidden(partOf(panel, row, 'treeDatasetName'))).toBe(true);
                expect(rename.attributes['aria-expanded']).toBe('true');

                input.value = 'After the fix';
                enter(input);
                input.dispatch('blur');

                expect(renamesPosted(panel)).toEqual([{ command: 'renameDataset', datasetFolderName: LEAD_DATASETS[1], name: 'After the fix', renderSequence: 3 }]);

            });

            it('writes a refusal under the box and keeps it open, and closes it once the host saved and redrew the name', () => {

                const panel = drawRecipe();
                const row = secondRowOf(panel);
                partOf(panel, row, 'treeDatasetRename').dispatch('click');
                const input = partOf(panel, row, 'nameEditorInput');
                const refusal = partOf(panel, row, 'nameEditorRefusal');

                input.value = ACCOUNT_DATASET;
                enter(input);
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'dataset', nameKey: LEAD_DATASETS[1], refusal: 'Another data set already has that name.' });

                expect(refusal.textContent).toBe('Another data set already has that name.');
                expect(panel.isHidden(refusal)).toBe(false);
                expect(panel.isHidden(partOf(panel, row, 'datasetNameEditor'))).toBe(false);

                input.value = 'Before the fix';
                enter(input);
                panel.postToPanel({ command: 'datasetPreferences', renderSequence: 3, datasetFolderName: LEAD_DATASETS[1], customName: 'Before the fix', isFavorite: false });
                // THE BOX STILL STANDS IN THE NAME'S PLACE UNTIL THE ANSWER CLOSES IT
                expect(panel.isHidden(partOf(panel, row, 'treeDatasetName'))).toBe(true);
                panel.postToPanel({ command: 'nameEditResult', renderSequence: 3, nameTarget: 'dataset', nameKey: LEAD_DATASETS[1] });

                expect(panel.isHidden(partOf(panel, row, 'datasetNameEditor'))).toBe(true);
                expect(panel.isHidden(partOf(panel, row, 'treeDatasetName'))).toBe(false);
                expect(partOf(panel, row, 'treeDatasetName').textContent).toBe('Before the fix');

            });

            it('given Escape, posts nothing and gives the row its name and ✎ its focus back', () => {

                const panel = drawRecipe();
                const row = secondRowOf(panel);
                const rename = partOf(panel, row, 'treeDatasetRename');
                rename.dispatch('click');
                const input = partOf(panel, row, 'nameEditorInput');

                input.value = 'Before the fix';
                input.dispatch('keydown', { key: 'Escape', preventDefault: () => undefined });
                input.dispatch('blur');

                expect(renamesPosted(panel)).toEqual([]);
                expect(panel.isHidden(partOf(panel, row, 'datasetNameEditor'))).toBe(true);
                // A ROW WITH NO NAME OF ITS OWN DRAWS NONE
                expect(panel.isHidden(partOf(panel, row, 'treeDatasetName'))).toBe(true);
                expect(panel.activeElement()).toBe(rename);

            });

        });

        it('redraws the row the host names in place, only for the model on screen, and a search finds it by its new name', () => {

            const panel = drawRecipe();
            const tabPanel = openLeadDatasets(panel);
            const rowsBefore = rowsOf(panel, tabPanel);

            panel.postToPanel({ command: 'datasetPreferences', renderSequence: 2, datasetFolderName: LEAD_DATASETS[1], customName: 'Stale', isFavorite: true });
            expect(panel.isHidden(panel.findAll(rowsBefore[1], 'treeDatasetName')[0])).toBe(true);

            panel.postToPanel({ command: 'datasetPreferences', renderSequence: 3, datasetFolderName: LEAD_DATASETS[1], customName: 'Before the fix', isFavorite: true });

            expect(rowsOf(panel, tabPanel)).toEqual(rowsBefore);
            expect(panel.findAll(rowsBefore[1], 'treeDatasetName')[0].textContent).toBe('Before the fix');
            expect(panel.findAll(rowsBefore[1], 'treeDatasetFavorite')[0].textContent).toBe('★');

            panel.typeIntoTabSearch(leadCardOf(panel), 'treeDatasets', 'before the');
            expect(shownFolderNamesOf(panel, tabPanel)).toEqual([LEAD_DATASETS[1]]);

        });

        it('draws a name changed before the data sets tab was built when the tab is opened', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'datasetPreferences', renderSequence: 3, datasetFolderName: LEAD_DATASETS[2], customName: 'Oldest', isFavorite: false });

            const rows = rowsOf(panel, openLeadDatasets(panel));

            expect(panel.findAll(rows[2], 'treeDatasetName')[0].textContent).toBe('Oldest');

        });

        it('Favorites only shows the favorites and counts them, with the search, and a row taken off hides at once', () => {

            const panel = drawRecipe(recipe => {
                recipe.trees[1].history!.datasets[0].isFavorite = true;
                recipe.trees[1].history!.datasets[2].isFavorite = true;
            });
            const tabPanel = openLeadDatasets(panel);
            const matchCountElement = panel.findAll(tabPanel, 'tabMatchCount')[0];

            expect(favoritesToggleOf(panel, tabPanel).attributes['aria-pressed']).toBe('false');
            expect(shownFolderNamesOf(panel, tabPanel)).toEqual(LEAD_DATASETS);

            favoritesToggleOf(panel, tabPanel).dispatch('click');

            expect(favoritesToggleOf(panel, tabPanel).attributes['aria-pressed']).toBe('true');
            expect(shownFolderNamesOf(panel, tabPanel)).toEqual([LEAD_DATASETS[0], LEAD_DATASETS[2]]);
            expect(matchCountElement.textContent).toBe('2 of 3 data sets');

            panel.typeIntoTabSearch(leadCardOf(panel), 'treeDatasets', '09-02');
            expect(shownFolderNamesOf(panel, tabPanel)).toEqual([LEAD_DATASETS[2]]);

            panel.postToPanel({ command: 'datasetPreferences', renderSequence: 3, datasetFolderName: LEAD_DATASETS[2], isFavorite: false });
            expect(shownFolderNamesOf(panel, tabPanel)).toEqual([]);
            expect(matchCountElement.textContent).toBe('no matches');

        });

        it('keeps the filter in the reader\'s place per card, and a reopened document restores it', () => {

            const panel = drawRecipe(recipe => { recipe.trees[1].history!.datasets[1].isFavorite = true; });
            const tabPanel = openLeadDatasets(panel);
            favoritesToggleOf(panel, tabPanel).dispatch('click');

            const leadPlace = panel.savedState().trees.find((treePlace: any) => treePlace.treeKey === LEAD_TREE_KEY);
            expect(leadPlace.isDatasetFavoritesOnly).toBe(true);

            const reopenedPanel = drawRecipe(recipe => { recipe.trees[1].history!.datasets[1].isFavorite = true; }, { savedState: panel.savedState() });
            const reopenedTabPanel = reopenedPanel.tabPanelOf(reopenedPanel.treeCards()[1], 'treeDatasets');

            expect(shownFolderNamesOf(reopenedPanel, reopenedTabPanel)).toEqual([LEAD_DATASETS[1]]);
            expect(favoritesToggleOf(reopenedPanel, reopenedTabPanel).attributes['aria-pressed']).toBe('true');

        });

        it('given a place saved before data set favorites, which has no filter, shows every data set', () => {

            const oldPlace = {
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0,
                trees: [{ treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'datasets', searchQueries: {}, expandedObjectKeys: [], openPicklistKeys: [] }]
            };
            const panel = drawRecipe(recipe => { recipe.trees[1].history!.datasets[1].isFavorite = true; }, { savedState: oldPlace });

            expect(shownFolderNamesOf(panel, panel.tabPanelOf(leadCardOf(panel), 'treeDatasets'))).toEqual(LEAD_DATASETS);

        });

    });

    describe('normalizePanelPlace', () => {

        it('keeps a card\'s data sets filter only when it is exactly true', () => {

            const place = (isDatasetFavoritesOnly: unknown) => RecipeCockpitService.normalizePanelPlace({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 0,
                trees: [{ treeKey: LEAD_TREE_KEY, isDatasetFavoritesOnly: isDatasetFavoritesOnly }]
            })!.trees[0];

            expect(place(true).isDatasetFavoritesOnly).toBe(true);
            expect(place('true')).not.toHaveProperty('isDatasetFavoritesOnly');
            expect(place(undefined)).not.toHaveProperty('isDatasetFavoritesOnly');

        });

    });

});
