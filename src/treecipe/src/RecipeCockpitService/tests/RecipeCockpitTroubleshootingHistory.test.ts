import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTroubleshootingHistoryMessage,
    IRecipeCockpitTroubleshootingHistoryRowViewModel,
    RECIPE_COCKPIT_HISTORY_EMPTY_NOTE,
    RECIPE_COCKPIT_HISTORY_FILE_GONE_TEXT,
    RECIPE_COCKPIT_HISTORY_LOADING_NOTE,
    RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY,
    RECIPE_COCKPIT_HISTORY_UNRECORDED_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RecipeCockpitService
} from '../RecipeCockpitService';
import { RecipeCockpitRunHistory } from '../RecipeCockpitRunHistory';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The Troubleshooting tab's History sub-tab (#485): the host lists a tree's steps from every run's
    RunArtifacts and posts rows with no path; the panel draws one table, sorted by any column but
    Files, searched by its own box, and opens a file only by its index in rows it acknowledged.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const QA_USERNAME = 'qa@example.com';

const loadRecipe = (workspaceRoot: string = TREE_WORKSPACE_ROOT): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')),
    workspaceRoot,
    RUN_FOLDER_NAME
).recipeViewModel;

const buildRow = (overrides: Partial<IRecipeCockpitTroubleshootingHistoryRowViewModel>): IRecipeCockpitTroubleshootingHistoryRowViewModel => ({
    step: 'field-deploy',
    stepLabel: 'Deploy fields & dependencies',
    status: 'succeeded',
    timeMs: new Date(2026, 9, 28, 10, 0, 0).getTime(),
    timeLabel: '2026-10-28 10:00:00',
    runFolderName: RUN_FOLDER_NAME,
    files: [],
    ...overrides
});

const HISTORY_ROWS: IRecipeCockpitTroubleshootingHistoryRowViewModel[] = [
    buildRow({
        step: 'permission-set-assign', stepLabel: 'Assign permission sets', status: 'partial',
        timeMs: new Date(2026, 9, 28, 12, 0, 0).getTime(), timeLabel: '2026-10-28 12:00:00', finishedAtLabel: '2026-10-28 12:00:09',
        orgLabel: 'qa', orgUsername: QA_USERNAME, succeededCount: 1, failedCount: 1, detail: 'Contact_Reader could not be assigned',
        files: [{ fileIndex: 0, fileName: '20261028-120000-permission-set-assign.json' }]
    }),
    buildRow({
        orgLabel: 'beta', orgUsername: 'beta@example.com', succeededCount: 7,
        files: [{ fileIndex: 1, fileName: '20261028-100000-field-deploy-package.xml' }, { fileIndex: 2, fileName: '20261028-100005-field-deploy.json' }]
    }),
    buildRow({
        step: 'validation-rule-retrieve', stepLabel: 'Retrieve validation rules', status: 'unrecorded',
        timeMs: new Date(2026, 9, 27, 9, 0, 0).getTime(), timeLabel: '2026-10-27 09:00:00', runFolderName: 'recipe-2026-09-01T00-00-00',
        orgUsername: 'alpha@example.com', orgLabel: 'alpha@example.com',
        files: [{ fileIndex: 3, fileName: '20261027-090000-validation-rule-retrieve.json' }]
    })
];

const historyMessage = (overrides: Partial<IRecipeCockpitTroubleshootingHistoryMessage> = {}): IRecipeCockpitTroubleshootingHistoryMessage => ({
    command: 'troubleshootingHistory',
    renderSequence: 3,
    treeKey: ACCOUNT_TREE_KEY,
    historySequence: 11,
    rows: HISTORY_ROWS,
    hiddenRowCount: 0,
    ...overrides
});

type Panel = ReturnType<typeof runPanelScript>;

const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
    version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    runFolderName: RUN_FOLDER_NAME,
    isOrgPickerInUse: false,
    isFavoritesOnly: false,
    scrollY: 0,
    trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'troubleshooting', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
});

describe('RecipeCockpitService, the Troubleshooting tab\'s History (#485)', () => {

    describe('the panel script', () => {

        const drawRecipe = (savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };
        const accountCardOf = (panel: Panel) => panel.treeCards()[0];
        const historyPanelOf = (panel: Panel) => panel.findAll(accountCardOf(panel), 'troubleshootingSubPanel-history')[0];
        const openHistory = (panel: Panel) => {
            panel.openTab(accountCardOf(panel), 'Troubleshooting');
            panel.findAll(accountCardOf(panel), 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'History').dispatch('click');
        };
        const postedNamed = (panel: Panel, command: string) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === command);
        const rowsOf = (panel: Panel) => panel.findAll(historyPanelOf(panel), 'historyRow');
        const shownStepsOf = (panel: Panel) => rowsOf(panel)
            .filter((rowElement: any) => !panel.isHidden(rowElement))
            .map((rowElement: any) => panel.findAll(rowElement, 'historyStep')[0].textContent);
        const sortButtonOf = (panel: Panel, column: string) => panel.findAll(historyPanelOf(panel), `historySort-${column}`)[0];
        const headerOf = (panel: Panel, column: string) => panel.findAll(historyPanelOf(panel), `historyHeader-${column}`)[0];
        const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);

        it('is the last sub-tab, asks the host once per model when first opened, and says it is reading meanwhile', () => {

            const panel = drawRecipe();
            panel.openTab(accountCardOf(panel), 'Troubleshooting');

            expect(panel.findAll(accountCardOf(panel), 'troubleshootingSubTab').map((tabElement: any) => tabElement.textContent).at(-1)).toBe('History');
            expect(postedNamed(panel, 'loadTroubleshootingHistory')).toEqual([]);

            openHistory(panel);
            panel.findAll(accountCardOf(panel), 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'Fields').dispatch('click');
            panel.findAll(accountCardOf(panel), 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'History').dispatch('click');

            expect(postedNamed(panel, 'loadTroubleshootingHistory')).toEqual([{ command: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 }]);
            expect(panel.findAll(historyPanelOf(panel), 'treeEmpty')[0].textContent).toBe(RECIPE_COCKPIT_HISTORY_LOADING_NOTE);

        });

        it('draws one row per step, newest first, with its time, step, org, outcome, run and files, and acknowledges the rows', () => {

            const panel = drawRecipe();
            openHistory(panel);
            panel.postToPanel(historyMessage());

            expect(panel.findAll(historyPanelOf(panel), 'historyHeader').map((headerElement: any) => headerElement.attributes.scope)).toEqual(['col', 'col', 'col', 'col', 'col', 'col']);
            expect(shownStepsOf(panel)).toEqual(['Assign permission sets', 'Deploy fields & dependencies', 'Retrieve validation rules']);

            const [assignRow, , legacyRow] = rowsOf(panel);
            expect(panel.findAll(assignRow, 'historyTime')[0].textContent).toBe('2026-10-28 12:00:00');
            expect(panel.findAll(assignRow, 'historyTime')[0].attributes.title).toBe('Ended 2026-10-28 12:00:09');
            expect(panel.findAll(assignRow, 'historyOrg')[0].textContent).toBe('qa');
            expect(panel.findAll(assignRow, 'historyOrg')[0].attributes.title).toBe(QA_USERNAME);
            expect(panel.findAll(assignRow, 'historyStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY.partial.label);
            expect(panel.findAll(assignRow, 'historyStatusEmoji')[0].attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(assignRow, 'historyDetail')[0].textContent).toBe('1 succeeded · 1 failed · Contact_Reader could not be assigned');
            expect(panel.findAll(assignRow, 'historyRun')[0].textContent).toBe('current version');
            expect(panel.findAll(assignRow, 'historyFile').map((fileButton: any) => fileButton.textContent)).toEqual(['20261028-120000-permission-set-assign.json']);
            expect(panel.findAll(legacyRow, 'historyDetail')[0].textContent).toBe(RECIPE_COCKPIT_HISTORY_UNRECORDED_NOTE);
            expect(panel.findAll(legacyRow, 'historyRun')[0].textContent).not.toBe('current version');

            expect(postedNamed(panel, 'troubleshootingHistoryRendered')).toEqual([{ command: 'troubleshootingHistoryRendered', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 11 }]);

        });

        it('draws on a card with no history of its own, naming every run "version unknown"', () => {

            const recipe = loadRecipe();
            recipe.trees.forEach(tree => { delete tree.history; });
            const panel = runPanelScript({});
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            openHistory(panel);

            panel.postToPanel(historyMessage());
            sortButtonOf(panel, 'run').dispatch('click');

            expect(rowsOf(panel)).toHaveLength(3);
            expect(rowsOf(panel).map((rowElement: any) => panel.findAll(rowElement, 'historyRun')[0].textContent)).toEqual(['version unknown', 'version unknown', 'version unknown']);
            expect(postedNamed(panel, 'troubleshootingHistoryRendered')).toHaveLength(1);
            expect(postedNamed(panel, 'renderFailed')).toEqual([]);

        });

        it('opens a file by its index in the rows it acknowledged, never by a path', () => {

            const panel = drawRecipe();
            openHistory(panel);
            panel.postToPanel(historyMessage());

            panel.findAll(rowsOf(panel)[1], 'historyFile')[1].dispatch('click');

            expect(postedNamed(panel, 'openTroubleshootingHistoryFile')).toEqual([{
                command: 'openTroubleshootingHistoryFile', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 11, fileIndex: 2
            }]);

        });

        it('drops rows read for another model, and says when a tree has no step yet or more than it shows', () => {

            const panel = drawRecipe();
            openHistory(panel);

            panel.postToPanel(historyMessage({ renderSequence: 2 }));
            expect(rowsOf(panel)).toEqual([]);
            expect(postedNamed(panel, 'troubleshootingHistoryRendered')).toEqual([]);

            panel.postToPanel(historyMessage({ rows: [] }));
            expect(panel.findAll(historyPanelOf(panel), 'treeEmpty')[0].textContent).toBe(RECIPE_COCKPIT_HISTORY_EMPTY_NOTE);

            panel.postToPanel(historyMessage({ historySequence: 12, hiddenRowCount: 4 }));
            expect(rowsOf(panel)).toHaveLength(3);
            expect(panel.findAll(historyPanelOf(panel), 'historyHiddenNote')[0].textContent).toBe('4 older steps are not shown.');

        });

        it('sorts by the column clicked, the same column again turning the order, says so in aria-sort, and keeps the sort in the place', () => {

            const panel = drawRecipe();
            openHistory(panel);
            panel.postToPanel(historyMessage());

            expect(headerOf(panel, 'time').attributes['aria-sort']).toBe('descending');
            expect(headerOf(panel, 'files').attributes['aria-sort']).toBeUndefined();
            expect(panel.findAll(headerOf(panel, 'files'), 'historySort')).toEqual([]);

            sortButtonOf(panel, 'org').dispatch('click');
            expect(panel.findAll(rowsOf(panel)[0], 'historyOrg')[0].textContent).toBe('alpha@example.com');
            expect(rowsOf(panel).map((rowElement: any) => panel.findAll(rowElement, 'historyOrg')[0].textContent)).toEqual(['alpha@example.com', 'beta', 'qa']);
            expect(headerOf(panel, 'org').attributes['aria-sort']).toBe('ascending');
            expect(headerOf(panel, 'time').attributes['aria-sort']).toBe('none');
            expect(sortButtonOf(panel, 'org').textContent).toBe('Org ↑');
            expect(panel.activeElement()).toBe(sortButtonOf(panel, 'org'));
            expect(savedTreeOf(panel).troubleshootingHistorySort).toEqual({ column: 'org', isDescending: false });

            sortButtonOf(panel, 'org').dispatch('click');
            expect(rowsOf(panel).map((rowElement: any) => panel.findAll(rowElement, 'historyOrg')[0].textContent)).toEqual(['qa', 'beta', 'alpha@example.com']);

            sortButtonOf(panel, 'outcome').dispatch('click');
            expect(rowsOf(panel).map((rowElement: any) => panel.findAll(rowElement, 'historyStatusLabel')[0].textContent)).toEqual(['Not recorded', 'Partly succeeded', 'Succeeded']);

            sortButtonOf(panel, 'time').dispatch('click');
            expect(shownStepsOf(panel)).toEqual(['Assign permission sets', 'Deploy fields & dependencies', 'Retrieve validation rules']);
            // THE DEFAULT SORT IS NOT KEPT
            expect(savedTreeOf(panel).troubleshootingHistorySort).toBeUndefined();

        });

        it('narrows the rows to what its own search matches, file names and org usernames included, and counts them', () => {

            const panel = drawRecipe();
            openHistory(panel);
            panel.postToPanel(historyMessage());
            const matchCount = () => panel.findAll(historyPanelOf(panel), 'tabMatchCount')[0].textContent;

            expect(matchCount()).toBe('3 steps');

            panel.typeIntoTabSearch(accountCardOf(panel), 'troubleshootingSubPanel-history', 'package.xml');
            expect(shownStepsOf(panel)).toEqual(['Deploy fields & dependencies']);
            expect(matchCount()).toBe('1 of 3 steps');

            panel.typeIntoTabSearch(accountCardOf(panel), 'troubleshootingSubPanel-history', QA_USERNAME);
            expect(shownStepsOf(panel)).toEqual(['Assign permission sets']);

            panel.typeIntoTabSearch(accountCardOf(panel), 'troubleshootingSubPanel-history', 'not recorded');
            expect(shownStepsOf(panel)).toEqual(['Retrieve validation rules']);

        });

        it('restores the sub-tab and its sort in the next document, asking once the model is drawn, and ignores a sort out of shape', () => {

            const panel = runPanelScript({ savedState: savedPlaceWith({ troubleshootingSubTab: 'history', troubleshootingHistorySort: { column: 'step', isDescending: true } }) });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });

            expect(postedNamed(panel, 'loadTroubleshootingHistory')).toEqual([{ command: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 }]);
            panel.postToPanel(historyMessage());
            expect(shownStepsOf(panel)).toEqual(['Retrieve validation rules', 'Deploy fields & dependencies', 'Assign permission sets']);

            const forgedPanel = runPanelScript({ savedState: savedPlaceWith({ troubleshootingSubTab: 'history', troubleshootingHistorySort: { column: '__proto__', isDescending: 'yes' } }) });
            forgedPanel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            forgedPanel.postToPanel({ command: 'rendered' });
            forgedPanel.postToPanel(historyMessage());
            expect(shownStepsOf(forgedPanel)).toEqual(['Assign permission sets', 'Deploy fields & dependencies', 'Retrieve validation rules']);

        });

    });

    describe('normalizePanelPlace', () => {

        const normalizedTreeOf = (treePlace: Record<string, unknown>) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith(treePlace))?.trees[0];

        it('keeps a sort of its own shape that is not the default, and drops anything else', () => {

            expect(normalizedTreeOf({ troubleshootingHistorySort: { column: 'org', isDescending: false } })?.troubleshootingHistorySort).toEqual({ column: 'org', isDescending: false });
            expect(normalizedTreeOf({ troubleshootingHistorySort: { column: 'time', isDescending: false } })?.troubleshootingHistorySort).toEqual({ column: 'time', isDescending: false });
            [
                { column: 'time', isDescending: true },
                { column: 'files', isDescending: false },
                { column: 'org', isDescending: 'no' },
                { column: 'org' },
                'org',
                null
            ].forEach(troubleshootingHistorySort => expect(normalizedTreeOf({ troubleshootingHistorySort })).not.toHaveProperty('troubleshootingHistorySort'));
            expect(normalizedTreeOf({ troubleshootingSubTab: 'history' })?.troubleshootingSubTab).toBe('history');

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        it('routes a history request by the tree key alone, only for the model on screen and a card with a folder', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, filePath: '/etc/passwd' } as any, panelState))
                .toEqual({ kind: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY, renderSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingHistory', treeKey: 'Lead-ONLY', renderSequence: 3 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadTroubleshootingHistory', treeKey: 7, renderSequence: 3 } as any, panelState)).toBeUndefined();

        });

        it('opens a file only by an index of the rows the panel acknowledged, for that list and model', () => {

            const panelState = buildPanelState();
            panelState.pendingHistoryFiles.set(ACCOUNT_TREE_KEY, { historySequence: 11, filePaths: ['/workspace/a.json', '/workspace/b.xml'] });
            const openMessage = (overrides: Record<string, unknown> = {}) => ({ command: 'openTroubleshootingHistoryFile', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 11, fileIndex: 1, ...overrides });

            // PENDING ONLY: NOTHING OPENS BEFORE THE ACK
            expect(RecipeCockpitService.routePanelMessage(openMessage(), panelState)).toBeUndefined();

            expect(RecipeCockpitService.routePanelMessage({ command: 'troubleshootingHistoryRendered', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 10 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'troubleshootingHistoryRendered', renderSequence: 2, treeKey: ACCOUNT_TREE_KEY, historySequence: 11 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'troubleshootingHistoryRendered', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 11 }, panelState))
                .toEqual({ kind: 'activateTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY });
            panelState.historyFiles.set(ACCOUNT_TREE_KEY, panelState.pendingHistoryFiles.get(ACCOUNT_TREE_KEY) as { historySequence: number; filePaths: string[] });

            expect(RecipeCockpitService.routePanelMessage(openMessage({ filePath: '/etc/passwd' }), panelState)).toEqual({ kind: 'openTroubleshootingHistoryFile', filePath: '/workspace/b.xml' });
            [
                { fileIndex: 2 },
                { fileIndex: -1 },
                { fileIndex: 0.5 },
                { fileIndex: '1' },
                { historySequence: 10 },
                { renderSequence: 2 },
                { treeKey: 'Lead-ONLY' }
            ].forEach(overrides => expect(RecipeCockpitService.routePanelMessage(openMessage(overrides), panelState)).toBeUndefined());

            expect(RecipeCockpitService.routePanelMessage({ command: 'troubleshootingHistoryRendered', renderSequence: 3, treeKey: 7, historySequence: 11 } as any, panelState)).toBeUndefined();

            // AN ACK BEFORE THE MODEL'S OWN "rendered" ACTIVATES NOTHING
            panelState.acknowledgedRenderSequence = null;
            expect(RecipeCockpitService.routePanelMessage({ command: 'troubleshootingHistoryRendered', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, historySequence: 11 }, panelState)).toBeUndefined();

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let postedMessages: any[];
        let cockpitPanel: any;
        let panelState: IRecipeCockpitPanelState;

        const accountRunArtifactsFolder = (runFolderName: string = RUN_FOLDER_NAME) => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', runFolderName, ACCOUNT_TREE_KEY, 'RunArtifacts');
        const historyMessages = () => postedMessages.filter(hostMessage => hostMessage.command === 'troubleshootingHistory');

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-history-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            postedMessages = [];
            cockpitPanel = { webview: { postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedMessages.push(hostMessage); return Promise.resolve(true); }) } };
            panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            panelState.isPanelReady = true;
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadRecipe(workspaceRoot), renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            (RecipeCockpitService as any).recipeCockpitPanel = cockpitPanel;
            (RecipeCockpitService as any).recipeCockpitPanelState = panelState;

        });

        afterEach(() => {
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('posts the tree\'s steps with labels and file names, never a path, and keeps the paths host-only and pending', () => {

            const location = RecipeCockpitService.resolveTreeRunArtifactsLocation(workspaceRoot, panelState.recipeDataMessage!.recipe, { folderName: ACCOUNT_TREE_KEY })!;
            const resultFilePath = path.join(accountRunArtifactsFolder(), 'OrgOperations', QA_USERNAME, '20261028-100005-field-deploy.json');
            fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
            fs.writeFileSync(resultFilePath, '{}');
            RecipeCockpitRunHistory.writeSummary(location, {
                step: 'field-deploy', outcome: 'succeeded', orgUsername: QA_USERNAME, orgAlias: 'qa',
                startedAt: new Date(2026, 9, 28, 10, 0, 0), finishedAt: new Date(2026, 9, 28, 10, 0, 9), succeededCount: 7, filePaths: [resultFilePath]
            });

            (RecipeCockpitService as any).postTroubleshootingHistory(cockpitPanel, panelState, ACCOUNT_TREE_KEY);

            const [message] = historyMessages();
            expect(message).toEqual({
                command: 'troubleshootingHistory',
                renderSequence: 3,
                treeKey: ACCOUNT_TREE_KEY,
                historySequence: expect.any(Number),
                rows: [{
                    step: 'field-deploy',
                    stepLabel: 'Deploy fields & dependencies',
                    status: 'succeeded',
                    timeMs: new Date(2026, 9, 28, 10, 0, 0).getTime(),
                    timeLabel: '2026-10-28 10:00:00',
                    finishedAtMs: new Date(2026, 9, 28, 10, 0, 9).getTime(),
                    finishedAtLabel: '2026-10-28 10:00:09',
                    runFolderName: RUN_FOLDER_NAME,
                    orgLabel: 'qa',
                    orgUsername: QA_USERNAME,
                    succeededCount: 7,
                    files: [{ fileIndex: 0, fileName: '20261028-100005-field-deploy.json' }]
                }],
                hiddenRowCount: 0
            });
            expect(JSON.stringify(message)).not.toContain(workspaceRoot);
            expect(panelState.pendingHistoryFiles.get(ACCOUNT_TREE_KEY)).toEqual({ historySequence: message.historySequence, filePaths: [resultFilePath] });
            expect(panelState.historyFiles.has(ACCOUNT_TREE_KEY)).toBe(false);

        });

        it('redacts a token or auth URL the CLI echoed into a step\'s detail before the summary is written', () => {

            const location = RecipeCockpitService.resolveTreeRunArtifactsLocation(workspaceRoot, panelState.recipeDataMessage!.recipe, { folderName: ACCOUNT_TREE_KEY })!;

            (RecipeCockpitService as any).recordTroubleshootingStep(location, {
                step: 'field-deploy', outcome: 'failed', orgUsername: QA_USERNAME,
                startedAt: new Date(2026, 9, 28, 10, 0, 0), finishedAt: new Date(2026, 9, 28, 10, 0, 1),
                detail: 'auth failed for force://PlatformCLI::secret@example.my.salesforce.com with 00D000000000077!AQ.abc_def (exit code 1)',
                filePaths: []
            });

            const summaryFolderPath = path.join(accountRunArtifactsFolder(), 'OrgOperations', QA_USERNAME);
            const summaryText = fs.readFileSync(path.join(summaryFolderPath, fs.readdirSync(summaryFolderPath)[0]), 'utf-8');
            expect(summaryText).not.toContain('force://');
            expect(summaryText).not.toContain('00D000000000077!');
            expect(JSON.parse(summaryText).detail).toContain('(exit code 1)');

        });

        it('lists another run\'s steps of the same tree too, and posts nothing for a card with no folder or a model gone', () => {

            fs.mkdirSync(path.join(accountRunArtifactsFolder('recipe-2026-09-01T00-00-00'), 'OrgOperations', QA_USERNAME), { recursive: true });
            fs.mkdirSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-01T00-00-00', ACCOUNT_TREE_KEY), { recursive: true });
            fs.writeFileSync(path.join(accountRunArtifactsFolder('recipe-2026-09-01T00-00-00'), 'OrgOperations', QA_USERNAME, '20260901-100000-field-retrieve.json'), '{}');
            panelState.recipeDataMessage!.recipe.runs = [...panelState.recipeDataMessage!.recipe.runs, { runFolderName: 'recipe-2026-09-01T00-00-00' } as any];

            (RecipeCockpitService as any).postTroubleshootingHistory(cockpitPanel, panelState, ACCOUNT_TREE_KEY);
            expect(historyMessages()[0].rows.map((row: any) => [row.step, row.status, row.runFolderName])).toEqual([['field-retrieve', 'unrecorded', 'recipe-2026-09-01T00-00-00']]);

            (RecipeCockpitService as any).postTroubleshootingHistory(cockpitPanel, panelState, 'Not-A-Card');
            panelState.recipeDataMessage = undefined;
            (RecipeCockpitService as any).postTroubleshootingHistory(cockpitPanel, panelState, ACCOUNT_TREE_KEY);
            expect(historyMessages()).toHaveLength(1);

        });

        it('answers a routed history request through the executor', async () => {

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY });

            expect(historyMessages()).toEqual([expect.objectContaining({ treeKey: ACCOUNT_TREE_KEY, rows: [], hiddenRowCount: 0 })]);

        });

        it('lists a tree again after a step only when this model already drew its History', () => {

            (RecipeCockpitService as any).refreshTroubleshootingHistory(ACCOUNT_TREE_KEY);
            expect(historyMessages()).toEqual([]);

            (RecipeCockpitService as any).postTroubleshootingHistory(cockpitPanel, panelState, ACCOUNT_TREE_KEY);
            (RecipeCockpitService as any).refreshTroubleshootingHistory(ACCOUNT_TREE_KEY);

            expect(historyMessages()).toHaveLength(2);
            expect(historyMessages()[1].historySequence).toBeGreaterThan(historyMessages()[0].historySequence);

        });

        it('activates the acknowledged rows\' files and opens one through the checked opener', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            panelState.pendingHistoryFiles.set(ACCOUNT_TREE_KEY, { historySequence: 4, filePaths: [path.join(workspaceRoot, 'a.json')] });

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'activateTroubleshootingHistory', treeKey: ACCOUNT_TREE_KEY });
            expect(panelState.historyFiles.get(ACCOUNT_TREE_KEY)).toEqual({ historySequence: 4, filePaths: [path.join(workspaceRoot, 'a.json')] });

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'openTroubleshootingHistoryFile', filePath: path.join(workspaceRoot, 'a.json') });
            expect(openSpy).toHaveBeenCalledWith(path.join(workspaceRoot, 'a.json'), workspaceRoot, RECIPE_COCKPIT_HISTORY_FILE_GONE_TEXT);

        });

        it('empties both file lists on a ready, so a reloaded document opens nothing until it draws the rows again', async () => {

            panelState.pendingHistoryFiles.set(ACCOUNT_TREE_KEY, { historySequence: 4, filePaths: ['x'] });
            panelState.historyFiles.set(ACCOUNT_TREE_KEY, { historySequence: 4, filePaths: ['x'] });

            const readyAction = RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState);
            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, readyAction);

            expect(panelState.pendingHistoryFiles.size).toBe(0);
            expect(panelState.historyFiles.size).toBe(0);

        });

    });

});
