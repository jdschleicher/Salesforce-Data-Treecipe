import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL,
    RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #399: tree selections are kept by tree FOLDER, so switching runs used to carry them onto any tree of
    the next run with the same folder, unseen. When a tree on screen holds one, the host now asks:
    Reset selections, Apply same selections (only when a folder matches) or Cancel.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const OLDER_RUN_FOLDER_NAME = 'recipe-2026-09-01T00-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const OLDER_ACCOUNT_TREE_KEY = 'Account-thru-Contact';

answerInPanelConfirmationsThroughWarningMock();

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

const storedSelections = (objectCountsByFolderName: Record<string, unknown>, excludedObjectApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: {},
    objectCountsByFolderName: objectCountsByFolderName,
    validationRulesOffByFolderName: {}
});

const treeOf = (recipe: { trees: IRecipeCockpitTreeViewModel[] }, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey);

describe('RecipeCockpitService run switch (#399)', () => {

    let receivedMessageHandler: (panelMessage: any) => Promise<void>;
    let disposeHandler: (() => void) | undefined;
    let postedPanelMessages: any[];

    const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
    const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;

    const buildWebviewPanel = () => ({
        reveal: jest.fn(),
        dispose: jest.fn(),
        visible: true,
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
        expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);
        postedPanelMessages = [];
        return recipeDataMessage;
    };

    const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);

    beforeEach(() => {
        postedPanelMessages = [];
        showWarningMessage.mockReset();
        (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
        jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
    });

    afterEach(() => {
        disposeHandler?.();
        disposeHandler = undefined;
    });

    it('given nothing stored, loads the chosen run with no question, as before', async () => {

        const workspaceState = buildWorkspaceState();
        await openAndDraw(workspaceState);

        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(showWarningMessage).not.toHaveBeenCalled();
        // NO QUESTION, SO NOTHING EXTRA IS POSTED: THE SAME PHASES AND MODEL AS BEFORE #399
        expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['loadPhase', 'loadPhase', 'recipeData']);
        expect(lastPosted('recipeData').recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
        expect(workspaceState.update).not.toHaveBeenCalled();

    });

    it('given a selection only on a folder not on screen, asks nothing', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [OLDER_ACCOUNT_TREE_KEY]: { Contact: 3 } }) });
        await openAndDraw(workspaceState);

        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(lastPosted('recipeData').recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);

    });

    it('asks with Reset and Apply when a folder matches, naming how many trees match and that missing names are ignored', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 }, [LEAD_TREE_KEY]: { Lead: 3 } }) });
        await openAndDraw(workspaceState);

        showWarningMessage.mockResolvedValueOnce(undefined);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(showWarningMessage).toHaveBeenCalledTimes(1);
        const [message, confirmOptions, ...buttonLabels] = showWarningMessage.mock.calls[0];
        expect(message).toStartWith('Switch to ');
        expect(confirmOptions).toMatchObject({ inPanel: true });
        expect(confirmOptions.detail).toContain(`2 trees on screen have excluded objects, unticked fields, record counts or validation rules switched off: ${ACCOUNT_TREE_KEY}, ${LEAD_TREE_KEY}.`);
        expect(confirmOptions.detail).toContain('1 tree of that run has the same folder name.');
        expect(confirmOptions.detail).toContain('a selection naming an object or field that run does not have is ignored');
        expect(confirmOptions.detail).toContain('Fixed values and edited expressions are written in each recipe file');
        expect(buttonLabels).toEqual([RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL, RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL]);

    });

    it('Apply same selections loads the run with the matching folder\'s selection and writes nothing', async () => {

        const initialSelections = storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 }, [LEAD_TREE_KEY]: { Lead: 3 } });
        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: initialSelections });
        await openAndDraw(workspaceState);

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        const recipe = lastPosted('recipeData').recipe;
        expect(recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
        expect(treeOf(recipe, LEAD_TREE_KEY)?.objectCounts).toEqual([{ objectApiName: 'Lead', count: 3 }]);
        expect(treeOf(recipe, OLDER_ACCOUNT_TREE_KEY)).not.toHaveProperty('objectCounts');
        expect(workspaceState.update).not.toHaveBeenCalled();
        expect(storedOf(workspaceState)).toEqual(initialSelections);

    });

    it('Reset selections clears every folder on screen, keeps a folder not on screen, then loads the run clean', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections(
            { [ACCOUNT_TREE_KEY]: { Contact: 4 }, [LEAD_TREE_KEY]: { Lead: 3 }, [OLDER_ACCOUNT_TREE_KEY]: { Contact: 2 } },
            { [ACCOUNT_TREE_KEY]: ['OtherChildObject__c'] }
        ) });
        await openAndDraw(workspaceState);

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(storedOf(workspaceState)).toEqual(storedSelections({ [OLDER_ACCOUNT_TREE_KEY]: { Contact: 2 } }));
        const recipe = lastPosted('recipeData').recipe;
        expect(recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
        expect(treeOf(recipe, LEAD_TREE_KEY)).not.toHaveProperty('objectCounts');

    });

    it('Cancel keeps the run on screen, writes nothing and tells the panel to put the dropdown back', async () => {

        const initialSelections = storedSelections({ [LEAD_TREE_KEY]: { Lead: 3 } });
        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: initialSelections });
        const recipeDataMessage = await openAndDraw(workspaceState);

        showWarningMessage.mockResolvedValueOnce(undefined);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(lastPosted('recipeData')).toBeUndefined();
        expect(lastPosted('runSwitchCancelled')).toEqual({ command: 'runSwitchCancelled' });
        expect(lastPosted('loadPhase')).toEqual({ command: 'loadPhase', message: '' });
        expect(storedOf(workspaceState)).toEqual(initialSelections);

        // THE MODEL ON SCREEN IS STILL THE ONE ITS ACTIONS ARE MATCHED AGAINST
        postedPanelMessages = [];
        await receivedMessageHandler({ command: 'ready' });
        expect(lastPosted('recipeData').renderSequence).toBe(recipeDataMessage.renderSequence);
        expect(lastPosted('recipeData').recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);

    });

    it('offers only Reset when no tree of the chosen run has a matching folder', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: 4 } }) });
        await openAndDraw(workspaceState);

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RUN_SWITCH_APPLY_LABEL);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        const [, confirmOptions, ...buttonLabels] = showWarningMessage.mock.calls[0];
        expect(buttonLabels).toEqual([RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL]);
        expect(confirmOptions.detail).toContain('No tree of that run has the same folder name');

        // AN ANSWER NAMING A BUTTON NOT OFFERED IS CANCEL
        expect(lastPosted('recipeData')).toBeUndefined();
        expect(lastPosted('runSwitchCancelled')).toBeDefined();

    });

    it('a failed reset keeps the run on screen, so the selections never reach the next run', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [LEAD_TREE_KEY]: { Lead: 3 } }) });
        await openAndDraw(workspaceState);
        workspaceState.update.mockRejectedValueOnce(new Error('disk full'));

        showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RUN_SWITCH_RESET_LABEL);
        await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

        expect(lastPosted('recipeData')).toBeUndefined();
        expect(lastPosted('runSwitchCancelled')).toBeDefined();
        expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('could not be saved: disk full'));

    });

    it('asks nothing when the run chosen is the run on screen', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [LEAD_TREE_KEY]: { Lead: 3 } }) });
        await openAndDraw(workspaceState);

        await receivedMessageHandler({ command: 'selectRun', runFolderName: CURRENT_RUN_FOLDER_NAME });

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(treeOf(lastPosted('recipeData').recipe, LEAD_TREE_KEY)?.objectCounts).toEqual([{ objectApiName: 'Lead', count: 3 }]);

    });

    it('the router still refuses a run it did not offer', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [LEAD_TREE_KEY]: { Lead: 3 } }) });
        await openAndDraw(workspaceState);

        await receivedMessageHandler({ command: 'selectRun', runFolderName: 'recipe-2099-01-01T00-00-00' });
        await receivedMessageHandler({ command: 'selectRun', runFolderName: '../recipe-2026-09-01T00-00-00' });

        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(postedPanelMessages).toEqual([]);

    });

    describe('the panel script', () => {

        it('puts the dropdown back on the run on screen when the host says the switch was cancelled', () => {

            const panel = runPanelScript();
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
                HISTORY_WORKSPACE_ROOT,
                CURRENT_RUN_FOLDER_NAME
            ).recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            const runSelectElement = panel.findAll(panel.cockpitBodyElement, 'runSelect')[0];

            runSelectElement.value = OLDER_RUN_FOLDER_NAME;
            runSelectElement.dispatch('change');
            expect(panel.postedHostMessages).toContainEqual({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });

            panel.postToPanel({ command: 'runSwitchCancelled' });

            expect(runSelectElement.value).toBe(CURRENT_RUN_FOLDER_NAME);

        });

    });

});
