import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
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
    RECIPE_COCKPIT_DATASET_INSERT_INTERRUPTED_NOTE,
    RECIPE_COCKPIT_DATASET_INSERT_UNRECORDED_NOTE,
    RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY,
    RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitTreeHistory } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { DatasetInsertAttemptService, IInsertAttemptSummary, INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION } from '../../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { CollectionsApiService, INSERT_RESULTS_FILE_MISSING_TEXT } from '../../CollectionsApiService/CollectionsApiService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';

/*
    #469: a data set row says how its newest insert ended -- succeeded, partly, failed, cancelled or
    unknown -- from the summary the insert writes beside its results file, and offers that results
    file through "View results". The panel posts only the data set's folder name; the host resolves
    it through a map it built and checks the file again on the click.
*/

const HISTORY_FIXTURE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_DATASET = 'dataset-2026-09-21T00-00-00-2';
const LEAD_DATASETS = ['dataset-2026-09-21T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-02T00-00-00'];
const DATASETS_TAB_LABEL = 'Previously Used Data Sets';

const summaryOf = (overrides: Partial<IInsertAttemptSummary> = {}): IInsertAttemptSummary => ({
    schemaVersion: INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION,
    outcome: 'completed',
    isRolledBack: false,
    isAllOrNone: true,
    savedRecordCount: 4,
    failedRecordCount: 0,
    orgUsername: 'qa@example.com.sandbox',
    orgAlias: 'qaSandbox',
    startedAt: '2026-10-26T10:00:00.000Z',
    finishedAt: '2026-10-26T10:00:05.000Z',
    ...overrides
});

describe('RecipeCockpitService, a data set\'s last insert (#469)', () => {

    let workspaceRoot: string;

    const fakeDataSetsPath = () => path.join(workspaceRoot, 'treecipe', 'FakeDataSets');
    const generatedRecipesPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes');

    const writeAttempt = (datasetFolderName: string, attemptTimestamp: string, summary: IInsertAttemptSummary | string | undefined, resultsText = '{"SuccessResults":{},"FailureResults":{}}'): string => {
        const attemptFolderPath = path.join(fakeDataSetsPath(), datasetFolderName, 'InsertAttempts', `insertAttempt-${attemptTimestamp}`);
        fs.mkdirSync(attemptFolderPath, { recursive: true });
        const resultsFilePath = path.join(attemptFolderPath, DatasetInsertAttemptService.buildResultsFileName(attemptTimestamp));
        fs.writeFileSync(resultsFilePath, resultsText);
        if ( summary !== undefined ) {
            fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildSummaryFileName(attemptTimestamp)), typeof summary === 'string' ? summary : JSON.stringify(summary));
        }
        return resultsFilePath;
    };

    const loadRecipe = () => RecipeCockpitService.loadRecipeRunByRuns(
        RecipeCockpitService.findGeneratedRecipeRuns(generatedRecipesPath()),
        workspaceRoot,
        CURRENT_RUN_FOLDER_NAME
    );

    const leadDatasetsOf = (recipeViewModel: IRecipeCockpitRecipeViewModel) => recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY).history.datasets;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-insert-status-'));
        fs.cpSync(HISTORY_FIXTURE_ROOT, workspaceRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    describe('the model', () => {

        it('carries the newest attempt of each data set, and nothing for one never inserted', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-25T09-00-00', summaryOf({ outcome: 'stopped', savedRecordCount: 0, failedRecordCount: 2, isAllOrNone: false }));
            const resultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf());
            writeAttempt(LEAD_DATASETS[1], '2026-10-26T11-00-00', summaryOf({ outcome: 'completed', savedRecordCount: 3, failedRecordCount: 1, isAllOrNone: false }));

            const { recipeViewModel, treeHistoryTargets } = loadRecipe();
            const leadDatasets = leadDatasetsOf(recipeViewModel);

            expect(leadDatasets[0].lastInsert).toEqual({
                status: 'succeeded',
                attemptedAtLabel: '2026-10-26 10:00:00 UTC',
                orgLabel: 'qaSandbox',
                savedRecordCount: 4,
                failedRecordCount: 0,
                hasResultsFile: true
            });
            expect(leadDatasets[1].lastInsert.status).toBe('partial');
            expect(leadDatasets[2]).not.toHaveProperty('lastInsert');
            expect(treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.get(LEAD_DATASETS[0])).toBe(resultsFilePath);
            expect(treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.has(LEAD_DATASETS[2])).toBe(false);

        });

        it('reads an attempt with no summary as unknown and unrecorded, with no counts, and keeps its results file', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', undefined, JSON.stringify({ SuccessResults: { Lead: [{ id: '00Q1' }, { id: '00Q2' }] }, FailureResults: {} }));

            expect(leadDatasetsOf(loadRecipe().recipeViewModel)[0].lastInsert).toEqual({
                status: 'unknown',
                attemptedAtLabel: '2026-10-26 10:00:00 UTC',
                isOutcomeUnrecorded: true,
                hasResultsFile: true
            });

        });

        it('carries an insert that threw as interrupted', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf({ outcome: 'stopped', savedRecordCount: 2, failedRecordCount: 1, isInterrupted: true }));

            expect(leadDatasetsOf(loadRecipe().recipeViewModel)[0].lastInsert).toMatchObject({ status: 'partial', isInterrupted: true });

        });

        it('reads a summary out of shape as unknown, never as a success', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', JSON.stringify({ ...summaryOf(), outcome: 'succeeded' }));

            expect(leadDatasetsOf(loadRecipe().recipeViewModel)[0].lastInsert).toEqual({ status: 'unknown', attemptedAtLabel: '2026-10-26 10:00:00 UTC', hasResultsFile: true });

        });

        it('offers no results file outside the workspace', () => {

            const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-insert-status-outside-'));
            try {
                const datasetFolderPath = path.join(fakeDataSetsPath(), LEAD_DATASETS[0]);
                fs.mkdirSync(path.join(outsideFolderPath, 'insertAttempt-2026-10-26T10-00-00'), { recursive: true });
                fs.writeFileSync(path.join(outsideFolderPath, 'insertAttempt-2026-10-26T10-00-00', DatasetInsertAttemptService.buildResultsFileName('2026-10-26T10-00-00')), '{}');
                jest.spyOn(DatasetInsertAttemptService, 'readLatestAttempt').mockImplementation(candidateFolderPath => candidateFolderPath === datasetFolderPath
                    ? { lastInsert: { status: 'succeeded', attemptTimestamp: '2026-10-26T10-00-00' }, resultsFilePath: path.join(outsideFolderPath, 'insertAttempt-2026-10-26T10-00-00', DatasetInsertAttemptService.buildResultsFileName('2026-10-26T10-00-00')) }
                    : undefined);

                const { recipeViewModel, treeHistoryTargets } = loadRecipe();

                expect(leadDatasetsOf(recipeViewModel)[0].lastInsert).toEqual({ status: 'succeeded', attemptedAtLabel: '2026-10-26 10:00:00 UTC' });
                expect(treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.size).toBe(0);
            } finally {
                fs.rmSync(outsideFolderPath, { recursive: true, force: true });
            }

        });

        it('allow-lists View results only for rows that draw it', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf());

            const allowLists = RecipeCockpitService.collectTreeHistoryAllowLists(loadRecipe().recipeViewModel);

            expect([...allowLists.viewableInsertResultsDatasetFolderNames]).toEqual([LEAD_DATASETS[0]]);

        });

        it('a data set added in place carries its insert and its results file, offered only once acknowledged', () => {

            const { recipeViewModel } = loadRecipe();
            const resultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf({ outcome: 'cancelled', isRolledBack: true, savedRecordCount: 0 }));

            const addedDataset = RecipeCockpitTreeHistory.buildAddedDataset(
                path.join(fakeDataSetsPath(), LEAD_DATASETS[0]),
                generatedRecipesPath(),
                workspaceRoot,
                CURRENT_RUN_FOLDER_NAME,
                recipeViewModel.trees.filter(tree => tree.history).map(tree => ({ treeKey: tree.treeKey, folderName: tree.folderName }))
            );

            expect(addedDataset.dataset.lastInsert.status).toBe('cancelled');
            expect(addedDataset.insertResultsFilePath).toBe(resultsFilePath);

        });

        it('postAddedDataset keeps the results file host-side and offers it only on the pending allow-list', () => {

            // THE MODEL IS DRAWN FIRST; THE INSERT THEN WRITES A DATA SET IT DOES NOT LIST
            const { recipeViewModel, treeHistoryTargets } = loadRecipe();
            const addedFolderName = 'dataset-2026-10-26T10-00-00';
            fs.cpSync(path.join(fakeDataSetsPath(), LEAD_DATASETS[0]), path.join(fakeDataSetsPath(), addedFolderName), { recursive: true });
            const resultsFilePath = writeAttempt(addedFolderName, '2026-10-26T10-00-00', summaryOf());
            const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            const recipeDataMessage = { command: 'recipeData' as const, recipe: recipeViewModel, renderSequence: 7 };
            panelState.recipeDataMessage = recipeDataMessage;
            panelState.treeHistoryTargets = treeHistoryTargets;
            panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel);
            panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
            const cockpitPanel = { webview: { postMessage: jest.fn() } };

            const isPosted = RecipeCockpitService.postAddedDataset(cockpitPanel as any, panelState, recipeDataMessage, path.join(fakeDataSetsPath(), addedFolderName));

            expect(isPosted).toBe(true);
            // THE STORED MODEL A REVEAL REPLAYS CARRIES THE ROW'S STATUS, AND NO PATH
            expect(leadDatasetsOf(recipeViewModel)[0]).toMatchObject({ datasetFolderName: addedFolderName, lastInsert: { status: 'succeeded', hasResultsFile: true } });
            expect(JSON.stringify(recipeViewModel)).not.toContain(resultsFilePath);
            expect(panelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.get(addedFolderName)).toBe(resultsFilePath);
            expect(panelState.pendingTreeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.has(addedFolderName)).toBe(true);
            expect(panelState.treeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.has(addedFolderName)).toBe(false);

        });

    });

    describe('routePanelMessage, viewDatasetInsertResults', () => {

        const buildPanelState = (isActivated = true): IRecipeCockpitPanelState => {
            const loadedRecipe = loadRecipe();
            const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 7 };
            panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
            panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(loadedRecipe.recipeViewModel);
            if ( isActivated ) {
                panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
            }
            return panelState;
        };

        it('resolves a drawn row\'s name through the host\'s own map, never a posted path', () => {

            const resultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf());

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0], filePath: '/etc/passwd' } as any, buildPanelState()))
                .toEqual({ kind: 'viewDatasetInsertResults', resultsFilePath: resultsFilePath });

        });

        it('routes nothing before the model is confirmed drawn, for a row with no results file, a forged name, a wrong type or no target', () => {

            writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf());

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] }, buildPanelState(false))).toBeUndefined();

            const panelState = buildPanelState();
            [
                { command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[1] },
                { command: 'viewDatasetInsertResults', datasetFolderName: ACCOUNT_DATASET },
                { command: 'viewDatasetInsertResults', datasetFolderName: '../../../etc' },
                { command: 'viewDatasetInsertResults', datasetFolderName: '__proto__' },
                { command: 'viewDatasetInsertResults', datasetFolderName: 42 },
                { command: 'viewDatasetInsertResults' }
            ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

            panelState.treeHistoryTargets = RecipeCockpitTreeHistory.buildEmptyTargets();
            expect(RecipeCockpitService.routePanelMessage({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] }, panelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);

        beforeEach(() => {
            postedPanelMessages = [];
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

        it('opens the results file once the row is drawn, checking it again on the click', async () => {

            const resultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf());
            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            const workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState as any);
            await receivedMessageHandler({ command: 'ready' });

            // NOT YET DRAWN: NOTHING OPENS
            await receivedMessageHandler({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] });
            expect(openSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            await receivedMessageHandler({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] });

            expect(openSpy).toHaveBeenCalledWith(resultsFilePath, workspaceRoot, INSERT_RESULTS_FILE_MISSING_TEXT);

        });

        it('after a row\'s Insert… that recorded no attempt, posts the data set with no last insert and offers no results file', async () => {

            jest.spyOn(RecipeCockpitService, 'confirmInPanel').mockResolvedValue(RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL);
            jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockResolvedValue(false);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue({} as any);
            jest.spyOn(SalesforceOrgService, 'queryOrganizationType').mockResolvedValue({ isSandbox: true, organizationType: 'Developer Edition' });
            jest.spyOn(RecipeCockpitService, 'showTreeInsertNotification').mockImplementation(() => undefined);
            jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg').mockResolvedValue({ outcome: 'cancelled', savedRecordCount: 0, failedRecordCount: 0, isRolledBack: false } as any);
            const workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState as any);
            await receivedMessageHandler({ command: 'ready' });
            const renderSequence = lastPosted('recipeData').renderSequence;
            await receivedMessageHandler({ command: 'rendered', renderSequence });
            const selectedOrg = { targetOrgIdentifier: 'qaSandbox', alias: 'qaSandbox', username: 'qa@example.com.sandbox' };
            const selectedPanelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
            selectedPanelState.dataOrgDetails = [selectedOrg];
            selectedPanelState.dataOrgSelection = { orgIndex: 0, orgDetail: selectedOrg, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            selectedPanelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.set(LEAD_DATASETS[0], path.join(workspaceRoot, 'stale.json'));
            leadDatasetsOf(selectedPanelState.recipeDataMessage.recipe)[0].lastInsert = { status: 'succeeded', attemptedAtLabel: 'earlier' };

            await receivedMessageHandler({ command: 'insertDataset', datasetFolderName: LEAD_DATASETS[0], orgIndex: 0 });

            expect(lastPosted('datasetLastInsert')).toEqual({ command: 'datasetLastInsert', renderSequence, updateSequence: expect.any(Number), datasetFolderName: LEAD_DATASETS[0] });
            expect(leadDatasetsOf(selectedPanelState.recipeDataMessage.recipe)[0]).not.toHaveProperty('lastInsert');
            expect(selectedPanelState.treeHistoryTargets.insertResultsFilePathsByDatasetFolderName.has(LEAD_DATASETS[0])).toBe(false);
            expect(selectedPanelState.pendingTreeHistoryAllowLists.viewableInsertResultsDatasetFolderNames.has(LEAD_DATASETS[0])).toBe(false);

        });

        it('after a row\'s Insert…, posts that data set\'s newest insert in place and offers its new results file only once the row is redrawn', async () => {

            const oldResultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-25T09-00-00', summaryOf());
            const openSpy = jest.spyOn(VSCodeWorkspaceService, 'openWorkspaceResultFile').mockResolvedValue(undefined);
            let newResultsFilePath = '';
            // THE ROW INSERTS INTO THE TARGET ORG MANAGER'S SELECTION ITSELF (#541): ITS CONFIRMATION, CONNECTION AND INSERT ARE ANSWERED HERE
            jest.spyOn(RecipeCockpitService, 'confirmInPanel').mockResolvedValue(RECIPE_COCKPIT_DATASET_INSERT_CONFIRM_LABEL);
            jest.spyOn(CollectionsApiService, 'promptForAllOrNoneInsertDecision').mockResolvedValue(false);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue({} as any);
            jest.spyOn(SalesforceOrgService, 'queryOrganizationType').mockResolvedValue({ isSandbox: true, organizationType: 'Developer Edition' });
            jest.spyOn(RecipeCockpitService, 'showTreeInsertNotification').mockImplementation(() => undefined);
            const insertSpy = jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg').mockImplementation(async () => {
                newResultsFilePath = writeAttempt(LEAD_DATASETS[0], '2026-10-26T10-00-00', summaryOf({ outcome: 'stopped', savedRecordCount: 0, failedRecordCount: 3 }));
                return { outcome: 'stopped', savedRecordCount: 0, failedRecordCount: 3, isRolledBack: false } as any;
            });
            const workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState as any);
            await receivedMessageHandler({ command: 'ready' });
            const renderSequence = lastPosted('recipeData').renderSequence;
            await receivedMessageHandler({ command: 'rendered', renderSequence });
            const recipeDataPostsBefore = postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData').length;
            const selectedOrg = { targetOrgIdentifier: 'qaSandbox', alias: 'qaSandbox', username: 'qa@example.com.sandbox' };
            const selectedPanelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
            selectedPanelState.dataOrgDetails = [selectedOrg];
            selectedPanelState.dataOrgSelection = { orgIndex: 0, orgDetail: selectedOrg, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };

            await receivedMessageHandler({ command: 'insertDataset', datasetFolderName: LEAD_DATASETS[0], orgIndex: 0 });

            expect(insertSpy).toHaveBeenCalledTimes(1);

            // NO RELOAD: ONE MESSAGE NAMING THE DATA SET, ITS NEW STATUS, AND NO PATH
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData')).toHaveLength(recipeDataPostsBefore);
            const lastInsertMessage = lastPosted('datasetLastInsert');
            expect(lastInsertMessage).toMatchObject({ renderSequence, datasetFolderName: LEAD_DATASETS[0], lastInsert: { status: 'failed', attemptedAtLabel: '2026-10-26 10:00:00 UTC', hasResultsFile: true } });
            expect(JSON.stringify(lastInsertMessage)).not.toContain(newResultsFilePath);

            // A REVEAL REPLAYS THE STORED MODEL, WHICH CARRIES IT TOO
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState as IRecipeCockpitPanelState;
            expect(leadDatasetsOf(panelState.recipeDataMessage.recipe)[0].lastInsert.status).toBe('failed');

            // UNTIL THE PANEL SAYS THE ROW IS REDRAWN, View results OPENS NOTHING -- NOT EVEN THE OLD FILE
            await receivedMessageHandler({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] });
            expect(openSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'partialRendered', renderSequence, updateSequence: lastInsertMessage.updateSequence });
            await receivedMessageHandler({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] });

            expect(openSpy).toHaveBeenCalledWith(newResultsFilePath, workspaceRoot, INSERT_RESULTS_FILE_MISSING_TEXT);
            expect(openSpy).not.toHaveBeenCalledWith(oldResultsFilePath, expect.anything(), expect.anything());

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void) => {
            const panel = runPanelScript();
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_FIXTURE_ROOT, 'treecipe', 'GeneratedRecipes')),
                HISTORY_FIXTURE_ROOT,
                CURRENT_RUN_FOLDER_NAME
            ).recipeViewModel;
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            return panel;
        };

        const openLeadDatasets = (panel: ReturnType<typeof runPanelScript>) => {
            const leadCard = panel.treeCards()[1];
            panel.chooseTreeCard(leadCard);
            panel.openTab(leadCard, DATASETS_TAB_LABEL);
            return panel.tabPanelOf(leadCard, 'treeDatasets');
        };

        it('draws each status with its label in words, a tooltip of when, where and how many, and nothing on a row never inserted', () => {

            const statuses = ['succeeded', 'partial', 'failed'] as const;
            const panel = drawRecipe(recipe => {
                const leadDatasets = leadDatasetsOf(recipe);
                statuses.forEach((status, datasetIndex) => {
                    leadDatasets[datasetIndex].lastInsert = { status, attemptedAtLabel: '2026-10-26 10:00:00 UTC', orgLabel: 'qaSandbox', savedRecordCount: 1, failedRecordCount: 2 };
                });
                delete leadDatasets[2].lastInsert;
            });
            const rows = panel.findAll(openLeadDatasets(panel), 'treeDataset');

            [0, 1].forEach(rowIndex => {
                const statusElement = panel.findAll(rows[rowIndex], 'treeDatasetInsertStatus')[0];
                const statusDisplay = RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY[statuses[rowIndex]];
                expect(panel.findAll(statusElement, 'treeDatasetInsertStatusEmoji')[0].textContent).toBe(statusDisplay.emoji);
                expect(panel.findAll(statusElement, 'treeDatasetInsertStatusEmoji')[0].attributes['aria-hidden']).toBe('true');
                expect(panel.findAll(statusElement, 'treeDatasetInsertStatusLabel')[0].textContent).toBe(statusDisplay.label);
                expect(statusElement.attributes.title).toBe('Last insert: 2026-10-26 10:00:00 UTC into qaSandbox · 1 record saved · 2 records failed');
                expect(statusElement.attributes['aria-label']).toBe(`${statusDisplay.label}. Last insert: 2026-10-26 10:00:00 UTC into qaSandbox · 1 record saved · 2 records failed`);
                expect(statusElement.attributes.role).toBe('img');
            });
            expect(panel.findAll(rows[2], 'treeDatasetInsertStatus')).toEqual([]);
            expect(panel.findAll(rows[2], 'treeDatasetInsertResults')).toEqual([]);

        });

        it('says why an attempt is unknown or may have left records, and draws one it cannot label as nothing', () => {

            const panel = drawRecipe(recipe => {
                const leadDatasets = leadDatasetsOf(recipe);
                leadDatasets[0].lastInsert = { status: 'unknown', attemptedAtLabel: '2026-10-26 10:00:00 UTC', isOutcomeUnrecorded: true };
                leadDatasets[1].lastInsert = { status: 'constructor' as any, attemptedAtLabel: '2026-10-26 10:00:00 UTC' };
                leadDatasets[2].lastInsert = { status: 'partial', attemptedAtLabel: '2026-10-26 10:00:00 UTC', savedRecordCount: 2, failedRecordCount: 0, isInterrupted: true };
            });
            const rows = panel.findAll(openLeadDatasets(panel), 'treeDataset');
            const statusElement = panel.findAll(rows[0], 'treeDatasetInsertStatus')[0];

            expect(panel.findAll(statusElement, 'treeDatasetInsertStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY.unknown.label);
            expect(statusElement.attributes.title).toBe(`Last insert: 2026-10-26 10:00:00 UTC. ${RECIPE_COCKPIT_DATASET_INSERT_UNRECORDED_NOTE}`);
            expect(panel.findAll(rows[1], 'treeDatasetInsertStatus')).toEqual([]);
            expect(panel.findAll(rows[2], 'treeDatasetInsertStatus')[0].attributes.title)
                .toBe(`Last insert: 2026-10-26 10:00:00 UTC · 2 records saved · 0 records failed. ${RECIPE_COCKPIT_DATASET_INSERT_INTERRUPTED_NOTE}`);

        });

        it('posts only the data set\'s folder name for View results, and draws it only when the host found the file', () => {

            const panel = drawRecipe(recipe => {
                const leadDatasets = leadDatasetsOf(recipe);
                leadDatasets[0].lastInsert = { status: 'failed', attemptedAtLabel: '2026-10-26 10:00:00 UTC', hasResultsFile: true };
                leadDatasets[1].lastInsert = { status: 'cancelled', attemptedAtLabel: '2026-10-26 10:00:00 UTC' };
            });
            const rows = panel.findAll(openLeadDatasets(panel), 'treeDataset');

            expect(panel.findAll(rows[1], 'treeDatasetInsertResults')).toEqual([]);
            panel.findAll(rows[0], 'treeDatasetInsertResults')[0].dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'viewDatasetInsertResults', datasetFolderName: LEAD_DATASETS[0] });

        });

        it('redraws a row\'s status in place for its model only, every other node kept, and acknowledges it', () => {

            const panel = drawRecipe(recipe => {
                leadDatasetsOf(recipe)[0].lastInsert = { status: 'succeeded', attemptedAtLabel: '2026-10-25 09:00:00 UTC', hasResultsFile: true };
            });
            const tabPanel = openLeadDatasets(panel);
            const [firstRow] = panel.findAll(tabPanel, 'treeDataset');
            const folderElementBefore = panel.findAll(firstRow, 'treeDatasetFolder')[0];
            panel.postedHostMessages.length = 0;

            panel.postToPanel({ command: 'datasetLastInsert', renderSequence: 2, updateSequence: 5, datasetFolderName: LEAD_DATASETS[0], lastInsert: { status: 'failed', attemptedAtLabel: '2026-10-26 10:00:00 UTC' } });
            expect(panel.findAll(firstRow, 'treeDatasetInsertStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY.succeeded.label);
            expect(panel.postedHostMessages).toEqual([]);

            panel.postToPanel({ command: 'datasetLastInsert', renderSequence: 3, updateSequence: 5, datasetFolderName: LEAD_DATASETS[0], lastInsert: { status: 'failed', attemptedAtLabel: '2026-10-26 10:00:00 UTC' } });

            expect(panel.findAll(tabPanel, 'treeDataset')[0]).toBe(firstRow);
            expect(panel.findAll(firstRow, 'treeDatasetFolder')[0]).toBe(folderElementBefore);
            expect(panel.findAll(firstRow, 'treeDatasetInsertStatus')).toHaveLength(1);
            expect(panel.findAll(firstRow, 'treeDatasetInsertStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY.failed.label);
            expect(panel.findAll(firstRow, 'treeDatasetInsertResults')).toEqual([]);
            expect(panel.postedHostMessages).toEqual([{ command: 'partialRendered', renderSequence: 3, updateSequence: 5 }]);

            // THE SEARCH READS THE NEW STATUS
            panel.typeIntoTabSearch(panel.treeCards()[1], 'treeDatasets', 'insert failed');
            expect(panel.isHidden(firstRow)).toBe(false);

        });

        it('draws the status of a row whose tab is built after the update', () => {

            const panel = drawRecipe(() => undefined);
            panel.postToPanel({ command: 'datasetLastInsert', renderSequence: 3, updateSequence: 1, datasetFolderName: LEAD_DATASETS[1], lastInsert: { status: 'cancelled', attemptedAtLabel: '2026-10-26 10:00:00 UTC' } });

            const rows = panel.findAll(openLeadDatasets(panel), 'treeDataset');

            expect(panel.findAll(rows[1], 'treeDatasetInsertStatusLabel')[0].textContent).toBe(RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY.cancelled.label);

        });

        it('the data sets search finds a row by its status', () => {

            const panel = drawRecipe(recipe => {
                leadDatasetsOf(recipe)[1].lastInsert = { status: 'partial', attemptedAtLabel: '2026-10-26 10:00:00 UTC' };
            });
            const tabPanel = openLeadDatasets(panel);

            panel.typeIntoTabSearch(panel.treeCards()[1], 'treeDatasets', 'partly');

            expect(panel.findAll(tabPanel, 'treeDataset')
                .filter((rowElement: any) => !panel.isHidden(rowElement))
                .map((rowElement: any) => panel.findAll(rowElement, 'treeDatasetFolder')[0].textContent)).toEqual([LEAD_DATASETS[1]]);

        });

    });

});
