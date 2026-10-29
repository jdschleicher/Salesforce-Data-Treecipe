import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    IRecipeCockpitDatasetJourneyMessage,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_DATASET_JOURNEY_FILE_GONE_TEXT,
    RECIPE_COCKPIT_DATASET_JOURNEY_FIRST_TIME_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE,
    RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RecipeCockpitService
} from '../RecipeCockpitService';
import { DatasetInsertAttemptService, INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION } from '../../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { RecipeCockpitRunHistory } from '../RecipeCockpitRunHistory';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #471: a data set row's ▸ opens its insert journey. The panel asks for it by the data set's
    folder name on first open, drops an answer for another model, writes every value as text, and
    opens a file only by its index in entries it acknowledged.
*/

const HISTORY_FIXTURE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEAD_TREE_KEY = 'Lead-ONLY';
const LEAD_DATASETS = ['dataset-2026-09-21T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-02T00-00-00'];
const DATASETS_TAB_LABEL = 'Previously Used Data Sets';
const QA_USERNAME = 'qa@example.com.sandbox';

const loadRecipe = (workspaceRoot: string) => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')),
    workspaceRoot,
    CURRENT_RUN_FOLDER_NAME
);

const leadDatasetsOf = (recipeViewModel: IRecipeCockpitRecipeViewModel) => recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY)!.history!.datasets;

const journeyMessage = (overrides: Partial<IRecipeCockpitDatasetJourneyMessage> = {}): IRecipeCockpitDatasetJourneyMessage => ({
    command: 'datasetJourney',
    renderSequence: 3,
    datasetFolderName: LEAD_DATASETS[0],
    journeySequence: 7,
    attemptCount: 2,
    entries: [
        {
            kind: 'insert', kindLabel: 'Insert', status: 'failed', timeLabel: '2026-10-26 10:00:00', orgLabel: 'qa · qa@example.com.sandbox',
            summaryText: '0 records saved · 4 records failed', errorExcerpt: 'Lead: INVALID_FIELD [Rating__c] — <b>No</b> such column',
            files: [{ fileIndex: 0, relativePath: 'treecipe/FakeDataSets/x/InsertAttempts/insertAttempt-a/insertAttemptResults-a.json' }]
        },
        {
            kind: 'field-deploy', kindLabel: 'Deploy fields', status: 'succeeded', timeLabel: '2026-10-26 10:05:00', orgLabel: QA_USERNAME,
            summaryText: '3 succeeded', files: [{ fileIndex: 1, relativePath: 'treecipe/GeneratedRecipes/r/Lead-ONLY/RunArtifacts/OrgOperations/q/a.json' }]
        },
        {
            kind: 'insert', kindLabel: 'Insert', status: 'succeeded', timeLabel: '2026-10-26 10:20:00', summaryText: '4 records saved', files: []
        }
    ],
    hiddenEntryCount: 0,
    otherOrgStepCount: 0,
    untrackedStepCount: 0,
    ...overrides
});

describe('RecipeCockpitService, a data set\'s insert journey (#471)', () => {

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            const recipe = loadRecipe(HISTORY_FIXTURE_ROOT).recipeViewModel;
            leadDatasetsOf(recipe)[0].lastInsert = { status: 'succeeded', attemptedAtLabel: '2026-10-26 10:20:00 UTC' };
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            return panel;
        };
        const leadCardOf = (panel: Panel) => panel.treeCards()[1];
        const openLeadDatasets = (panel: Panel) => {
            panel.chooseTreeCard(leadCardOf(panel));
            panel.openTab(leadCardOf(panel), DATASETS_TAB_LABEL);
            return panel.findAll(panel.tabPanelOf(leadCardOf(panel), 'treeDatasets'), 'treeDataset');
        };
        const toggleOf = (panel: Panel, rowElement: any) => panel.findAll(rowElement, 'treeDatasetJourneyToggle')[0];
        const journeyOf = (panel: Panel, rowElement: any) => panel.findAll(rowElement, 'treeDatasetJourney')[0];
        const postedNamed = (panel: Panel, command: string) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === command);
        const notesOf = (panel: Panel, rowElement: any) => panel.findAll(journeyOf(panel, rowElement), 'treeDatasetJourneyNote').map((noteElement: any) => noteElement.textContent);

        it('draws a ▸ on every row, collapsed, and a row never inserted opens to "No inserts yet" without asking the host', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);

            rows.forEach((rowElement: any) => {
                expect(toggleOf(panel, rowElement).attributes['aria-expanded']).toBe('false');
                expect(panel.isHidden(journeyOf(panel, rowElement))).toBe(true);
            });

            toggleOf(panel, rows[1]).dispatch('click');

            expect(toggleOf(panel, rows[1]).attributes['aria-expanded']).toBe('true');
            expect(panel.isHidden(journeyOf(panel, rows[1]))).toBe(false);
            expect(notesOf(panel, rows[1])).toEqual([RECIPE_COCKPIT_DATASET_JOURNEY_NO_INSERTS_NOTE]);
            expect(postedNamed(panel, 'loadDatasetJourney')).toEqual([]);

        });

        it('asks for an inserted row\'s journey once per model, by folder name, and says it is reading meanwhile', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);

            toggleOf(panel, rows[0]).dispatch('click');
            toggleOf(panel, rows[0]).dispatch('click');
            toggleOf(panel, rows[0]).dispatch('click');

            expect(postedNamed(panel, 'loadDatasetJourney')).toEqual([{ command: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0], renderSequence: 3 }]);
            expect(notesOf(panel, rows[0])).toEqual([RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE]);

        });

        it('draws the entries oldest first as text, with status words, errors and file paths, and acknowledges them', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');
            panel.postToPanel(journeyMessage());

            const entries = panel.findAll(journeyOf(panel, rows[0]), 'treeDatasetJourneyEntry');
            expect(entries.map((entryElement: any) => panel.findAll(entryElement, 'treeDatasetJourneyKind')[0].textContent)).toEqual(['Insert', 'Deploy fields', 'Insert']);
            expect(panel.findAll(entries[0], 'treeDatasetJourneyStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_DATASET_JOURNEY_STATUS_DISPLAY.failed.label);
            expect(panel.findAll(entries[0], 'treeDatasetJourneyStatusEmoji')[0].textContent).toBe('❌');
            expect(panel.findAll(entries[0], 'treeDatasetJourneyStatusEmoji')[0].attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(entries[0], 'treeDatasetJourneyOrg')[0].textContent).toBe('qa · qa@example.com.sandbox');
            expect(panel.findAll(entries[0], 'treeDatasetJourneyError')[0].textContent).toBe('Lead: INVALID_FIELD [Rating__c] — <b>No</b> such column');
            expect(panel.findAll(entries[0], 'b')).toEqual([]);
            expect(panel.findAll(entries[0], 'treeDatasetJourneyPath')[0].textContent).toBe('treecipe/FakeDataSets/x/InsertAttempts/insertAttempt-a/insertAttemptResults-a.json');
            expect(panel.findAll(entries[2], 'treeDatasetJourneyView')).toEqual([]);
            expect(notesOf(panel, rows[0])).toEqual([]);
            expect(postedNamed(panel, 'datasetJourneyRendered')).toEqual([{ command: 'datasetJourneyRendered', renderSequence: 3, datasetFolderName: LEAD_DATASETS[0], journeySequence: 7 }]);

            panel.findAll(entries[1], 'treeDatasetJourneyView')[0].dispatch('click');
            expect(postedNamed(panel, 'openDatasetJourneyFile')).toEqual([{ command: 'openDatasetJourneyFile', renderSequence: 3, datasetFolderName: LEAD_DATASETS[0], journeySequence: 7, fileIndex: 1 }]);

        });

        it('draws an answer that arrived while the row was closed when it is opened again, asking nothing more', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');
            toggleOf(panel, rows[0]).dispatch('click');
            panel.postToPanel(journeyMessage());
            toggleOf(panel, rows[0]).dispatch('click');

            expect(panel.findAll(journeyOf(panel, rows[0]), 'treeDatasetJourneyEntry')).toHaveLength(3);
            expect(postedNamed(panel, 'loadDatasetJourney')).toHaveLength(1);

        });

        it('says a single succeeded insert worked first time, and counts the capped, other-org and untracked entries', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');

            panel.postToPanel(journeyMessage({ attemptCount: 1, entries: [journeyMessage().entries[2]] }));
            expect(notesOf(panel, rows[0])).toEqual([RECIPE_COCKPIT_DATASET_JOURNEY_FIRST_TIME_NOTE]);

            panel.postToPanel(journeyMessage({ journeySequence: 8, hiddenEntryCount: 12, otherOrgStepCount: 2, untrackedStepCount: 1 }));
            expect(notesOf(panel, rows[0])).toEqual([
                '12 earlier entries are not shown.',
                '2 Troubleshooting steps of this tree in this time ran against another org, so they are not shown.',
                '1 step in treecipe/OrgOperations, which records no tree, ran in this time and is not placed on this timeline.'
            ]);

        });

        it('drops a journey for another model, and draws an unknown status by its own name', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');

            panel.postToPanel(journeyMessage({ renderSequence: 2 }));
            expect(panel.findAll(journeyOf(panel, rows[0]), 'treeDatasetJourneyEntry')).toEqual([]);
            expect(postedNamed(panel, 'datasetJourneyRendered')).toEqual([]);

            panel.postToPanel(journeyMessage({ entries: [{ ...journeyMessage().entries[0], status: 'constructor' as any }] }));
            expect(panel.findAll(journeyOf(panel, rows[0]), 'treeDatasetJourneyStatusLabel')[0].textContent).toBe('constructor');

        });

        it('saves an open journey in the place as an optional field and opens it again, asking only after the model is drawn', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');

            const savedTree = panel.savedState().trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY);
            expect(savedTree.expandedJourneyDatasetFolderNames).toEqual([LEAD_DATASETS[0]]);
            expect(panel.savedState().version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);

            toggleOf(panel, rows[0]).dispatch('click');
            expect(panel.savedState().trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY)?.expandedJourneyDatasetFolderNames).toBeUndefined();

            const restoredPanel = drawRecipe(undefined, {
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0,
                selectedTreeKey: LEAD_TREE_KEY,
                trees: [{ treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'datasets', searchQueries: {}, expandedObjectKeys: [], openPicklistKeys: [], expandedJourneyDatasetFolderNames: [LEAD_DATASETS[0]] }]
            });
            const restoredRows = restoredPanel.findAll(restoredPanel.tabPanelOf(restoredPanel.treeCards()[1], 'treeDatasets'), 'treeDataset');
            expect(toggleOf(restoredPanel, restoredRows[0]).attributes['aria-expanded']).toBe('true');
            expect(postedNamed(restoredPanel, 'loadDatasetJourney')).toEqual([{ command: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0], renderSequence: 3 }]);

        });

        it('reads an open journey again after the row\'s own insert updates it', () => {

            const panel = drawRecipe();
            const rows = openLeadDatasets(panel);
            toggleOf(panel, rows[0]).dispatch('click');
            panel.postToPanel(journeyMessage());

            panel.postToPanel({ command: 'datasetLastInsert', renderSequence: 3, updateSequence: 5, datasetFolderName: LEAD_DATASETS[0], lastInsert: { status: 'failed', attemptedAtLabel: '2026-10-27 10:00:00 UTC' } });

            expect(postedNamed(panel, 'loadDatasetJourney')).toHaveLength(2);
            expect(notesOf(panel, rows[0])).toEqual([RECIPE_COCKPIT_DATASET_JOURNEY_LOADING_NOTE]);

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.treeHistoryAllowLists.nameableDatasetFolderNames = new Set([LEAD_DATASETS[0]]);
            return panelState;
        };

        it('routes a journey request by a drawn data set\'s folder name alone, only for the model on screen', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0], renderSequence: 3, filePath: '/etc/passwd' } as any, panelState))
                .toEqual({ kind: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0], renderSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[1], renderSequence: 3 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetJourney', datasetFolderName: 7, renderSequence: 3 } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetJourney', datasetFolderName: '../..', renderSequence: 3 }, panelState)).toBeUndefined();

        });

        it('opens a file only by an index of the entries the panel acknowledged, for that list and model', () => {

            const panelState = buildPanelState();
            panelState.pendingJourneyFiles.set(LEAD_DATASETS[0], { journeySequence: 7, filePaths: ['/workspace/a.json', '/workspace/b.json'] });
            const openMessage = (overrides: Record<string, unknown> = {}) => ({ command: 'openDatasetJourneyFile', renderSequence: 3, datasetFolderName: LEAD_DATASETS[0], journeySequence: 7, fileIndex: 1, ...overrides });
            const renderedMessage = (overrides: Record<string, unknown> = {}) => ({ command: 'datasetJourneyRendered', renderSequence: 3, datasetFolderName: LEAD_DATASETS[0], journeySequence: 7, ...overrides });

            expect(RecipeCockpitService.routePanelMessage(openMessage(), panelState)).toBeUndefined();

            expect(RecipeCockpitService.routePanelMessage(renderedMessage({ journeySequence: 6 }), panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage(renderedMessage({ renderSequence: 2 }), panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage(renderedMessage({ datasetFolderName: 7 }), panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage(renderedMessage(), panelState)).toEqual({ kind: 'activateDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });
            panelState.journeyFiles.set(LEAD_DATASETS[0], panelState.pendingJourneyFiles.get(LEAD_DATASETS[0]) as { journeySequence: number; filePaths: string[] });

            expect(RecipeCockpitService.routePanelMessage(openMessage({ filePath: '/etc/passwd' }), panelState)).toEqual({ kind: 'openDatasetJourneyFile', filePath: '/workspace/b.json' });
            [
                { fileIndex: 2 },
                { fileIndex: -1 },
                { fileIndex: 0.5 },
                { fileIndex: '1' },
                { journeySequence: 6 },
                { renderSequence: 2 },
                { datasetFolderName: LEAD_DATASETS[1] }
            ].forEach(overrides => expect(RecipeCockpitService.routePanelMessage(openMessage(overrides), panelState)).toBeUndefined());

            // AN ACK BEFORE THE MODEL'S OWN "rendered" ACTIVATES NOTHING
            panelState.acknowledgedRenderSequence = null;
            expect(RecipeCockpitService.routePanelMessage(renderedMessage(), panelState)).toBeUndefined();

        });

    });

    describe('the host', () => {

        let workspaceRoot: string;
        let postedMessages: any[];
        let cockpitPanel: any;
        let panelState: IRecipeCockpitPanelState;

        const leadDatasetPath = () => path.join(workspaceRoot, 'treecipe', 'FakeDataSets', LEAD_DATASETS[0]);
        const journeyMessages = () => postedMessages.filter(hostMessage => hostMessage.command === 'datasetJourney');

        const writeAttempt = (isoStartedAt: string, savedRecordCount: number, failedRecordCount: number, resultsText = '{"SuccessResults":{},"FailureResults":{}}') => {
            const attemptTimestamp = isoStartedAt.slice(0, 19).replace(/:/g, '-');
            const attemptFolderPath = path.join(leadDatasetPath(), 'InsertAttempts', `insertAttempt-${attemptTimestamp}`);
            fs.mkdirSync(attemptFolderPath, { recursive: true });
            fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildResultsFileName(attemptTimestamp)), resultsText);
            fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildSummaryFileName(attemptTimestamp)), JSON.stringify({
                schemaVersion: INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION, outcome: 'completed', isRolledBack: false, isAllOrNone: false,
                savedRecordCount, failedRecordCount, orgUsername: QA_USERNAME, orgAlias: 'qa',
                startedAt: new Date(isoStartedAt).toISOString(), finishedAt: new Date(Date.parse(isoStartedAt) + 5000).toISOString()
            }));
        };

        beforeEach(() => {

            workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-journey-host-'));
            fs.cpSync(HISTORY_FIXTURE_ROOT, workspaceRoot, { recursive: true });

            writeAttempt('2026-10-26T10:00:00Z', 0, 5, JSON.stringify({ SuccessResults: {}, FailureResults: { Lead: [{ success: false, errors: [{ statusCode: 'INVALID_FIELD', message: 'bad', fields: ['Rating__c'] }] }] } }));
            const location = RecipeCockpitService.resolveTreeRunArtifactsLocation(workspaceRoot, { selectedRunFolderName: CURRENT_RUN_FOLDER_NAME }, { folderName: LEAD_TREE_KEY })!;
            const startedAt = new Date('2026-10-26T10:05:00Z');
            const stepFolderPath = RecipeCockpitRunHistory.buildStepFolderPath(location, 'field-deploy', QA_USERNAME)!;
            fs.mkdirSync(stepFolderPath, { recursive: true });
            const resultFilePath = path.join(stepFolderPath, `${RecipeCockpitRunHistory.buildCompactTimestamp(startedAt)}-field-deploy.json`);
            fs.writeFileSync(resultFilePath, '{}');
            RecipeCockpitRunHistory.writeSummary(location, { step: 'field-deploy', outcome: 'succeeded', orgUsername: QA_USERNAME, startedAt, finishedAt: startedAt, succeededCount: 1, filePaths: [resultFilePath] });
            writeAttempt('2026-10-26T10:20:00Z', 5, 0);

            postedMessages = [];
            cockpitPanel = { webview: { postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedMessages.push(hostMessage); return Promise.resolve(true); }) } };
            panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            panelState.isPanelReady = true;
            const { recipeViewModel, treeHistoryTargets } = loadRecipe(workspaceRoot);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 3 };
            panelState.treeHistoryTargets = treeHistoryTargets;
            panelState.acknowledgedRenderSequence = 3;
            (RecipeCockpitService as any).recipeCockpitPanel = cockpitPanel;
            (RecipeCockpitService as any).recipeCockpitPanelState = panelState;

        });

        afterEach(() => {
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        });

        it('posts the journey with labels and workspace-relative paths, never an absolute one, and keeps the paths host-only and pending', async () => {

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });

            const [message] = journeyMessages();
            expect(message.renderSequence).toBe(3);
            expect(message.attemptCount).toBe(2);
            expect(message.entries.map((entry: any) => [entry.kindLabel, entry.status])).toEqual([['Insert', 'failed'], ['Deploy fields', 'succeeded'], ['Insert', 'succeeded']]);
            expect(message.entries[0].orgLabel).toBe(`qa · ${QA_USERNAME}`);
            expect(message.entries[0].errorExcerpt).toBe('Lead: INVALID_FIELD [Rating__c] — bad');
            expect(message.entries[0].files[0]).toEqual({ fileIndex: 0, relativePath: `treecipe/FakeDataSets/${LEAD_DATASETS[0]}/InsertAttempts/insertAttempt-2026-10-26T10-00-00/insertAttemptResults-2026-10-26T10-00-00.json` });
            expect(message.entries[1].files[0].relativePath).toMatch(/^treecipe\/GeneratedRecipes\/recipe-2026-09-20T10-00-00\/Lead-ONLY\/RunArtifacts\/OrgOperations\//);
            expect(JSON.stringify(message)).not.toContain(workspaceRoot);

            const pendingFiles = panelState.pendingJourneyFiles.get(LEAD_DATASETS[0])!;
            expect(pendingFiles.journeySequence).toBe(message.journeySequence);
            expect(pendingFiles.filePaths[0]).toBe(path.join(leadDatasetPath(), 'InsertAttempts', 'insertAttempt-2026-10-26T10-00-00', 'insertAttemptResults-2026-10-26T10-00-00.json'));
            expect(panelState.journeyFiles.has(LEAD_DATASETS[0])).toBe(false);

        });

        it('lists no entry for a data set the model does not map or one outside the workspace, and posts nothing with no model', async () => {

            panelState.treeHistoryTargets.datasetFolderPathsByName.set('outside', os.tmpdir());
            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadDatasetJourney', datasetFolderName: 'not-drawn' });
            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadDatasetJourney', datasetFolderName: 'outside' });
            expect(journeyMessages().map(message => [message.datasetFolderName, message.entries])).toEqual([['not-drawn', []], ['outside', []]]);

            panelState.recipeDataMessage = undefined;
            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });
            expect(journeyMessages()).toHaveLength(2);

        });

        it('answers a data set gone since the model was drawn with an empty journey, so its row leaves the loading note', async () => {

            fs.rmSync(leadDatasetPath(), { recursive: true, force: true });

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'loadDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });

            expect(journeyMessages()).toEqual([expect.objectContaining({ datasetFolderName: LEAD_DATASETS[0], attemptCount: 0, entries: [] })]);
            expect(panelState.pendingJourneyFiles.get(LEAD_DATASETS[0])?.filePaths).toEqual([]);

        });

        it('activates the acknowledged entries\' files, opens one through the checked opener, and empties both lists on a ready', async () => {

            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            panelState.pendingJourneyFiles.set(LEAD_DATASETS[0], { journeySequence: 4, filePaths: [path.join(workspaceRoot, 'a.json')] });

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'activateDatasetJourney', datasetFolderName: LEAD_DATASETS[0] });
            expect(panelState.journeyFiles.get(LEAD_DATASETS[0])).toEqual({ journeySequence: 4, filePaths: [path.join(workspaceRoot, 'a.json')] });

            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, { kind: 'openDatasetJourneyFile', filePath: path.join(workspaceRoot, 'a.json') });
            expect(openSpy).toHaveBeenCalledWith(path.join(workspaceRoot, 'a.json'), workspaceRoot, RECIPE_COCKPIT_DATASET_JOURNEY_FILE_GONE_TEXT);

            const readyAction = RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState);
            await (RecipeCockpitService as any).executePanelAction(cockpitPanel, readyAction);
            expect(panelState.pendingJourneyFiles.size).toBe(0);
            expect(panelState.journeyFiles.size).toBe(0);

        });

        it('keeps an open journey in the place through normalizePanelPlace, dropping a name that is not a folder name', () => {

            const normalized = RecipeCockpitService.normalizePanelPlace({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: CURRENT_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0,
                trees: [{ treeKey: LEAD_TREE_KEY, isExpanded: true, selectedTab: 'datasets', searchQueries: {}, expandedObjectKeys: [], openPicklistKeys: [], expandedJourneyDatasetFolderNames: [LEAD_DATASETS[0], '../x', 7] }]
            });

            expect(normalized?.trees[0].expandedJourneyDatasetFolderNames).toEqual([LEAD_DATASETS[0]]);

        });

    });

});
