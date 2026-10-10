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
    IRecipeCockpitPanelPlace,
    IRecipeCockpitWorkspaceState,
    RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY,
    RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH,
    RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES,
    RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    The reader's place kept in workspaceState (#230), so it survives closing the panel and
    reloading the window -- both of which throw the webview's own getState away. The host half is
    driven through openRecipeCockpitPanel with a fake webview panel; the place itself comes from,
    and goes back into, the REAL panel script.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const FAKER_JS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-09-10T00-00-00';
// NOT THE NEWEST, SO A RESTORE THAT LOADED THE NEWEST INSTEAD FAILS; ITS ACCOUNT TREE ENDS AT Contact
const OLDER_RUN_FOLDER_NAME = 'recipe-2026-09-01T00-00-00';
const OLDER_ACCOUNT_TREE_KEY = 'Account-thru-Contact';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';

const buildPlace = (overrides: Partial<IRecipeCockpitPanelPlace> = {}): IRecipeCockpitPanelPlace => ({
    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    runFolderName: FAKER_JS_RUN_FOLDER_NAME,
    isOrgPickerInUse: false,
    scrollY: 120,
    trees: [{
        treeKey: ACCOUNT_TREE_KEY,
        isExpanded: true,
        selectedTab: 'structure',
        searchQueries: { structure: '', dataByOrg: '', versions: '', datasets: '' },
        statusFilter: 'all',
        expandedObjectKeys: ['Account\n'],
        openPicklistKeys: [],
        expandedDataObjectApiNames: [],
        expandedVersionRunFolderNames: []
    }],
    ...overrides
});

// A vscode.Memento AS FAR AS THE COCKPIT USES ONE, OVER A MAP THAT OUTLIVES ANY ONE PANEL -- AS workspaceState OUTLIVES A WINDOW RELOAD
const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    const workspaceState = {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
    return workspaceState;
};

describe('RecipeCockpitService, the reader\'s place kept in workspaceState', () => {

    describe('normalizePanelPlace', () => {

        it('keeps a well-formed place as it was', () => {

            expect(RecipeCockpitService.normalizePanelPlace(buildPlace())).toEqual(buildPlace());

        });

        it.each([
            ['nothing', undefined],
            ['null', null],
            ['an array', [buildPlace()]],
            ['a string', JSON.stringify(buildPlace())],
            ['another shape', { ...buildPlace(), version: RECIPE_COCKPIT_PANEL_PLACE_VERSION + 1 }],
            ['no run', { ...buildPlace(), runFolderName: undefined }],
            ['an empty run', { ...buildPlace(), runFolderName: '' }],
            ['a run that is not text', { ...buildPlace(), runFolderName: 7 }],
            ['a run that is a path', { ...buildPlace(), runFolderName: path.join('..', 'elsewhere') }],
            ['a run that is an absolute path', { ...buildPlace(), runFolderName: path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME) }],
            ['a run that climbs', { ...buildPlace(), runFolderName: '..' }],
            ['a run past the length bound', { ...buildPlace(), runFolderName: 'r'.repeat(RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH + 1) }]
        ])('given %s, reads no place', (_caseName, candidatePlace) => {

            expect(RecipeCockpitService.normalizePanelPlace(candidatePlace)).toBeUndefined();

        });

        // #185: ".." INSIDE A NAME IS A NAME; ONLY A WHOLE ".." SEGMENT CLIMBS
        it('given a run whose name only contains "..", keeps it as a name', () => {

            expect(RecipeCockpitService.normalizePanelPlace(buildPlace({ runFolderName: 'recipe-2026..v2' }))?.runFolderName).toBe('recipe-2026..v2');

        });

        it('drops each malformed entry on its own and keeps the rest', () => {

            const normalizedPlace = RecipeCockpitService.normalizePanelPlace({
                ...buildPlace(),
                isOrgPickerInUse: 'yes',
                scrollY: -40,
                trees: [
                    null,
                    'Lead-ONLY',
                    { treeKey: 7 },
                    { treeKey: '' },
                    {
                        treeKey: LEAD_TREE_KEY,
                        isExpanded: 'true',
                        selectedTab: 'constructor',
                        searchQueries: { structure: 42, versions: 'FakerJS', toString: 'x' },
                        statusFilter: 'unchanged',
                        expandedObjectKeys: ['Lead\n', 3, '', null, 'x'.repeat(RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH + 1)],
                        openPicklistKeys: 'Lead\n\nStatus',
                        expandedDataObjectApiNames: [{}],
                        filePath: path.join(HISTORY_WORKSPACE_ROOT, 'secret.yml')
                    }
                ]
            });

            expect(normalizedPlace).toEqual({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: FAKER_JS_RUN_FOLDER_NAME,
                isOrgPickerInUse: false,
                scrollY: 0,
                trees: [{
                    treeKey: LEAD_TREE_KEY,
                    isExpanded: false,
                    selectedTab: 'structure',
                    searchQueries: { structure: '', dataByOrg: '', versions: 'FakerJS', datasets: '' },
                    statusFilter: 'all',
                    expandedObjectKeys: ['Lead\n'],
                    openPicklistKeys: [],
                    expandedDataObjectApiNames: [],
                    expandedVersionRunFolderNames: []
                }]
            });

        });

        // ONLY WHAT THE SHAPE NAMES IS KEPT, SO A HAND-EDITED OR FORGED PLACE CANNOT CARRY A PATH OR AN ORG INTO workspaceState
        it('keeps no field the place\'s shape does not name', () => {

            const normalizedPlace = RecipeCockpitService.normalizePanelPlace({
                ...buildPlace(),
                orgUsername: 'jd@example.com',
                recipeFilePath: path.join(HISTORY_WORKSPACE_ROOT, 'recipe.yml'),
                trees: [{ ...buildPlace().trees[0], picklistValues: ['Hot'], orgLabel: 'devhub' }]
            });

            expect(Object.keys(normalizedPlace!).sort()).toEqual(['isOrgPickerInUse', 'runFolderName', 'scrollY', 'trees', 'version']);
            expect(JSON.stringify(normalizedPlace)).not.toMatch(/jd@example\.com|recipe\.yml|devhub|Hot/);

        });

        // EVERY LIST WITHIN ITS OWN BOUND, AND THE WHOLE STILL TOO LARGE: THE PER-LIST BOUNDS MULTIPLY
        it('given a place past the total size bound, reads no place', () => {

            const longName = 'n'.repeat(RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH);
            const fullList = Array.from({ length: RECIPE_COCKPIT_PANEL_PLACE_MAX_ENTRIES }, () => longName);
            const treeCount = Math.ceil(RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH / (fullList.length * longName.length)) + 1;
            const oversizedPlace = buildPlace({
                trees: Array.from({ length: treeCount }, (_unused, treeIndex) => ({ ...buildPlace().trees[0], treeKey: `Tree-${treeIndex}`, expandedObjectKeys: fullList }))
            });

            expect(RecipeCockpitService.normalizePanelPlace(oversizedPlace)).toBeUndefined();
            expect(RecipeCockpitService.normalizePanelPlace(buildPlace({ trees: [{ ...buildPlace().trees[0], expandedObjectKeys: fullList.slice(0, 100) }] }))).toBeDefined();

        });

        it('accepts each status the status filter offers and each tab', () => {

            ['all', 'new-in-org', 'removed-from-org', 'type-changed', 'picklist-changed'].forEach(statusFilter => {
                expect(RecipeCockpitService.normalizePanelPlace(buildPlace({ trees: [{ ...buildPlace().trees[0], statusFilter }] }))!.trees[0].statusFilter).toBe(statusFilter);
            });
            (['structure', 'dataByOrg', 'versions', 'datasets'] as const).forEach(selectedTab => {
                expect(RecipeCockpitService.normalizePanelPlace(buildPlace({ trees: [{ ...buildPlace().trees[0], selectedTab }] }))!.trees[0].selectedTab).toBe(selectedTab);
            });

        });

    });

    describe('routePanelMessage, savePlace', () => {

        const buildDrawnPanelState = () => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH), HISTORY_WORKSPACE_ROOT, FAKER_JS_RUN_FOLDER_NAME).recipeViewModel;
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.selectableRunFolderNames = new Set(recipe.runs.map(run => run.runFolderName));
            return panelState;
        };

        it('given a place of the drawn run, persists it as normalized', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: { ...buildPlace(), extra: 'dropped' } }, buildDrawnPanelState()))
                .toEqual({ kind: 'persistPlace', place: buildPlace() });

        });

        it('given no model drawn yet, persists nothing', () => {

            const panelState = buildDrawnPanelState();
            panelState.selectableRunFolderNames = new Set();

            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: buildPlace() }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: buildPlace() }, RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT))).toBeUndefined();

        });

        it('given a place of a run that is not on screen, or no readable place, persists nothing', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME }) }, buildDrawnPanelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: 'not a place' }, buildDrawnPanelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace' }, buildDrawnPanelState())).toBeUndefined();
            // THE DRAWN RUN, IN ANOTHER SHAPE: PAST THE CHEAP CHECKS, REFUSED BY NORMALIZATION
            expect(RecipeCockpitService.routePanelMessage({ command: 'savePlace', place: { ...buildPlace(), version: RECIPE_COCKPIT_PANEL_PLACE_VERSION + 1 } }, buildDrawnPanelState())).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let createdWebviewPanels: any[];
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => {
                disposeHandler = handler;
                return { dispose: jest.fn() };
            }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                    postedPanelMessages.push(hostMessage);
                    return Promise.resolve(true);
                }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        });

        const openAndDraw = async (workspaceState: IRecipeCockpitWorkspaceState) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage?.renderSequence });
            return recipeDataMessage;
        };

        // WHAT VS CODE DOES ON A WINDOW RELOAD: THE EXTENSION HOST AND EVERYTHING IN IT ARE GONE, AND onDidDispose NEVER RAN
        const simulateWindowReload = () => {
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (RecipeCockpitService as any).recipeCockpitPanelState = RecipeCockpitService.buildInitialPanelState('');
            (RecipeCockpitService as any).recipeCockpitWorkspaceState = undefined;
            if ( (RecipeCockpitService as any).panelPlacePersistTimer !== undefined ) {
                clearTimeout((RecipeCockpitService as any).panelPlacePersistTimer);
            }
            (RecipeCockpitService as any).panelPlacePersistTimer = undefined;
            (RecipeCockpitService as any).pendingPersistedPanelPlace = undefined;
        };

        // THE READER'S SESSION IN THE REAL PANEL SCRIPT, ON A RUN THAT IS NOT THE NEWEST: THE ACCOUNT CARD AND OBJECT OPEN, THE LEAD CARD ON A SEARCHED HISTORY TAB
        const buildSavedPlaceFromPanel = (recipeDataMessage: any, accountTreeKey = OLDER_ACCOUNT_TREE_KEY) => {
            const panel = runPanelScript();
            panel.postToPanel(recipeDataMessage);
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === accountTreeKey);
            panel.findAll(accountCard, 'treeToggle')[0].dispatch('click');
            const accountObject = panel.findAll(accountCard, 'treeObject').find((objectElement: any) => panel.objectNameOf(objectElement) === 'Account');
            panel.expandObject(accountObject);
            const leadCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === LEAD_TREE_KEY);
            panel.findAll(leadCard, 'treeToggle')[0].dispatch('click');
            panel.openTab(leadCard, 'Previous Versions');
            panel.typeIntoTabSearch(leadCard, 'treeVersions', 'FakerJS');
            return panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace').pop().place;
        };

        const isCardOpenIn = (panel: ReturnType<typeof runPanelScript>, treeKey: string) => {
            const treeCard = panel.treeCards().find((candidateCard: any) => panel.findAll(candidateCard, 'treeFolder')[0]?.textContent === treeKey);
            return !panel.isHidden(panel.findAll(treeCard, 'treeBody')[0]);
        };

        beforeEach(() => {

            postedPanelMessages = [];
            createdWebviewPanels = [];
            disposeHandler = undefined;

            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => {
                const webviewPanel = buildWebviewPanel();
                createdWebviewPanels.push(webviewPanel);
                return webviewPanel;
            });
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);

            simulateWindowReload();

        });

        afterEach(() => {
            simulateWindowReload();
            jest.useRealTimers();
        });

        // A SAVE SENT THROUGH THE HOST'S OWN MESSAGE HANDLER, AS THE PANEL SENDS IT
        const saveThroughHost = async (place: unknown) => receivedMessageHandler({ command: 'savePlace', place: place });

        it('given the panel is closed and opened again, loads the saved run and hands the panel its place, which the panel restores', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });
            const olderRecipeData = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: olderRecipeData.renderSequence });

            const savedPlace = buildSavedPlaceFromPanel(olderRecipeData);
            await saveThroughHost(savedPlace);

            // CLOSED BEFORE THE DEBOUNCE FIRED: THE CLOSE WRITES IT
            disposeHandler!();
            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY)).toEqual(savedPlace);

            postedPanelMessages = [];
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
            const reopenedRecipeData = lastPosted('recipeData');
            expect(reopenedRecipeData.recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
            expect(reopenedRecipeData.restorePlace).toEqual(savedPlace);

            // A FRESH DOCUMENT HAS NO getState OF ITS OWN, SO IT TAKES THE HOST'S
            const reopenedPanel = runPanelScript();
            reopenedPanel.postToPanel(reopenedRecipeData);

            expect(isCardOpenIn(reopenedPanel, OLDER_ACCOUNT_TREE_KEY)).toBe(true);
            expect(isCardOpenIn(reopenedPanel, LEAD_TREE_KEY)).toBe(true);
            const leadCard = reopenedPanel.treeCards().find((treeCard: any) => reopenedPanel.findAll(treeCard, 'treeFolder')[0]?.textContent === LEAD_TREE_KEY);
            expect(reopenedPanel.findAll(reopenedPanel.tabPanelOf(leadCard, 'treeVersions'), 'tabSearchInput')[0].value).toBe('FakerJS');

        });

        it('given the window is reloaded without the panel ever being disposed, restores the place saved as it changed', async () => {

            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            await receivedMessageHandler({ command: 'selectRun', runFolderName: OLDER_RUN_FOLDER_NAME });
            const olderRecipeData = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: olderRecipeData.renderSequence });

            const savedPlace = buildSavedPlaceFromPanel(olderRecipeData);
            await saveThroughHost(savedPlace);
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY);

            simulateWindowReload();
            postedPanelMessages = [];

            const reloadedRecipeData = await openAndDraw(workspaceState);

            expect(reloadedRecipeData.recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
            expect(reloadedRecipeData.restorePlace).toEqual(savedPlace);

        });

        it('writes the place as it changes, at most once per persist delay, with the latest place', async () => {

            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await saveThroughHost(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 1 }));
            await saveThroughHost(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 2 }));
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY - 1);
            await saveThroughHost(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 3 }));

            expect(workspaceState.update).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1);

            expect(workspaceState.update).toHaveBeenCalledTimes(1);
            expect(workspaceState.update).toHaveBeenLastCalledWith(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY, buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 3 }));

            await saveThroughHost(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 4 }));
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY);

            expect(workspaceState.update).toHaveBeenCalledTimes(2);
            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY)).toEqual(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, scrollY: 4 }));

        });

        it('replays the place until the model is drawn, then stops: the panel\'s own getState holds it from there', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY]: buildPlace() });

            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'ready' });
            const replayedRecipeData = lastPosted('recipeData');

            expect(replayedRecipeData.restorePlace).toEqual(buildPlace());

            await receivedMessageHandler({ command: 'rendered', renderSequence: replayedRecipeData.renderSequence });
            await receivedMessageHandler({ command: 'ready' });

            expect(lastPosted('recipeData').restorePlace).toBeUndefined();
            // THE STORED MESSAGE ITSELF NEVER CARRIES IT
            expect((RecipeCockpitService as any).recipeCockpitPanelState.recipeDataMessage.restorePlace).toBeUndefined();

        });

        it('given the saved run was deleted, opens on the newest run with no place and drops the saved one', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY]: buildPlace({ runFolderName: 'recipe-2026-01-01T00-00-00' }) });

            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);
            expect(recipeDataMessage.restorePlace).toBeUndefined();
            expect(workspaceState.storedValues.has(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY)).toBe(false);

        });

        it.each([
            ['a string', 'recipe-fakerjs-2026-09-10T00-00-00'],
            ['another shape', { ...buildPlace(), version: 99 }],
            ['a run that is a path', buildPlace({ runFolderName: path.join(HISTORY_GENERATED_RECIPES_PATH, FAKER_JS_RUN_FOLDER_NAME) })],
            ['a run that climbs', buildPlace({ runFolderName: path.join('..', '..', FAKER_JS_RUN_FOLDER_NAME) })]
        ])('given a saved place that is %s, opens on the newest run as today and drops it', async (_caseName, storedPlace) => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY]: storedPlace });

            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);
            expect(recipeDataMessage.restorePlace).toBeUndefined();
            expect(workspaceState.storedValues.has(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY)).toBe(false);

        });

        it('given a workspace state that throws on read, opens on the newest run as today', async () => {

            const workspaceState = { get: jest.fn(() => { throw new Error('unreadable'); }) as jest.Mock, update: jest.fn(() => Promise.reject(new Error('unwritable'))) as jest.Mock };

            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);
            expect(recipeDataMessage.restorePlace).toBeUndefined();

        });

        it.each([
            ['throws', () => { throw new Error('unwritable'); }],
            ['rejects', () => Promise.reject(new Error('unwritable'))]
        ])('given a workspace state whose write %s, still opens on the newest run', async (_caseName, failingUpdate) => {

            const workspaceState = { get: jest.fn(() => 'not a place') as jest.Mock, update: jest.fn(failingUpdate) as jest.Mock };

            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY, undefined);
            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);

        });

        // THE SAME MESSAGE SUBSCRIPTION AND ALLOW-LISTS AS A NEW PANEL: NOTHING IS ENABLED UNTIL THE RESTORED MODEL'S "rendered"
        it('given a restored panel, enables no action until its model is drawn', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY]: buildPlace() });

            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;

            expect(createdWebviewPanels[0].webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
            expect(panelState.selectableRunFolderNames.size).toBe(0);
            expect(panelState.openableSourceKeys.size).toBe(0);
            expect(panelState.loadablePicklistKeys.size).toBe(0);
            expect(panelState.describableObjectApiNamesByTreeKey.size).toBe(0);
            expect(panelState.dataOrgObjectApiNames.size).toBe(0);
            // AND A PLACE POSTED BEFORE THE DRAW IS NOT WRITTEN
            workspaceState.update.mockClear();
            await saveThroughHost(buildPlace());
            disposeHandler!();
            expect(workspaceState.update).not.toHaveBeenCalled();

        });

        // THE COMMAND RUN AGAIN BEFORE ITS FIRST LOAD DREW: THE SECOND LOAD IS THE ONE THAT RENDERS, SO IT IS THE ONE THAT NEEDS THE PLACE
        it('given the command is run twice before the first load is drawn, still restores the saved place', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY]: buildPlace({ runFolderName: OLDER_RUN_FOLDER_NAME }) });

            const firstOpen = RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            const secondOpen = RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await Promise.all([firstOpen, secondOpen]);
            await receivedMessageHandler({ command: 'ready' });

            const recipeDataMessage = lastPosted('recipeData');
            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(OLDER_RUN_FOLDER_NAME);
            expect(recipeDataMessage.restorePlace).toEqual(buildPlace({ runFolderName: OLDER_RUN_FOLDER_NAME }));

        });

        it('given a write still waiting when the panel is opened with another workspace state, writes it to the one it was saved under', async () => {

            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
            const firstWorkspaceState = buildWorkspaceState();
            const secondWorkspaceState = buildWorkspaceState();
            await openAndDraw(firstWorkspaceState);
            await saveThroughHost(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME }));

            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, secondWorkspaceState);
            jest.advanceTimersByTime(RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY);

            expect(firstWorkspaceState.storedValues.get(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY)).toEqual(buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME }));
            expect(secondWorkspaceState.update).not.toHaveBeenCalled();

        });

        it('given a panel already open, keeps its own place rather than reading the saved one', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.storedValues.set(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY, buildPlace());
            workspaceState.get.mockClear();

            const recipeDataMessage = await openAndDraw(workspaceState);

            expect(workspaceState.get).not.toHaveBeenCalledWith(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY);
            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(CURRENT_RUN_FOLDER_NAME);
            expect(recipeDataMessage.restorePlace).toBeUndefined();

        });

        it('persists names only: no path, picklist value, org label or username', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            const savedPlace = buildSavedPlaceFromPanel(recipeDataMessage, ACCOUNT_TREE_KEY);

            await saveThroughHost({ ...savedPlace, orgUsername: 'jd@example.com', orgLabel: 'devhub (jd@example.com)' });
            disposeHandler!();

            const persistedText = JSON.stringify(workspaceState.storedValues.get(RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY));
            expect(persistedText).toContain(ACCOUNT_TREE_KEY);
            expect(persistedText).not.toContain(HISTORY_WORKSPACE_ROOT);
            expect(persistedText).not.toMatch(/jd@example\.com|devhub|\.yml|\.json/);

        });

    });

    describe('the panel script', () => {

        it('given a document with its own getState, prefers it over the place the host kept', () => {

            const recipe = RecipeCockpitService.loadRecipeRunByRuns(RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH), HISTORY_WORKSPACE_ROOT).recipeViewModel;
            const ownPlace = buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME, trees: [{ ...buildPlace().trees[0], treeKey: LEAD_TREE_KEY, expandedObjectKeys: [] }] });
            const hostPlace = buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME });

            const panel = runPanelScript({ savedState: ownPlace });
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, restorePlace: hostPlace });

            const isOpen = (treeKey: string) => {
                const treeCard = panel.treeCards().find((candidateCard: any) => panel.findAll(candidateCard, 'treeFolder')[0]?.textContent === treeKey);
                return !panel.isHidden(panel.findAll(treeCard, 'treeBody')[0]);
            };
            expect(isOpen(LEAD_TREE_KEY)).toBe(true);
            expect(isOpen(ACCOUNT_TREE_KEY)).toBe(false);

        });

        it('given a host place in another shape, draws the default view', () => {

            const recipe = RecipeCockpitService.loadRecipeRunByRuns(RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH), HISTORY_WORKSPACE_ROOT).recipeViewModel;

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, restorePlace: { ...buildPlace({ runFolderName: CURRENT_RUN_FOLDER_NAME }), version: 99 } });

            expect(panel.treeCards().every((treeCard: any) => panel.isHidden(panel.findAll(treeCard, 'treeBody')[0]))).toBe(true);

        });

        it('posts every place it saves to the host, so the host can keep it past the panel', () => {

            const recipe = RecipeCockpitService.loadRecipeRunByRuns(RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH), HISTORY_WORKSPACE_ROOT).recipeViewModel;

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });

            const savePlaceMessages = panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'savePlace');
            expect(savePlaceMessages.length).toBe(panel.setStateCalls.length);
            expect(savePlaceMessages.pop().place).toEqual(panel.savedState());

        });

    });

});
