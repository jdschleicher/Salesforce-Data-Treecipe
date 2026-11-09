import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { IRecipeCockpitRecipeViewModel, RecipeCockpitService, RECIPE_COCKPIT_DATASET_RECORD_TYPES_LABEL_PREFIX } from '../RecipeCockpitService';
import { IRecipeCockpitTreeDatasetViewModel } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const TAGGED_DATASET_FOLDER_NAME = 'dataset-2026-09-21T00-00-00';

const loadRecipe = (workspaceRoot: string): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')),
    workspaceRoot,
    TREE_RUN_FOLDER_NAME
).recipeViewModel;

const listDatasets = (recipe: IRecipeCockpitRecipeViewModel): IRecipeCockpitTreeDatasetViewModel[] => recipe.trees.flatMap(tree => tree.history?.datasets ?? []);

describe('A data set row names the record types its records carry (#621)', () => {

    describe('the host', () => {

        let workspaceRoot: string;

        beforeEach(() => {
            workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-dataset-record-types-'));
            fs.cpSync(HISTORY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        });

        const writeRecordTypes = (recordTypesByObject: unknown) => {
            const datasetSourcePath = path.join(workspaceRoot, 'treecipe', 'FakeDataSets', TAGGED_DATASET_FOLDER_NAME, 'BaseArtifactFiles', 'datasetSource.json');
            const datasetSource = JSON.parse(fs.readFileSync(datasetSourcePath, 'utf8'));
            fs.writeFileSync(datasetSourcePath, JSON.stringify({ ...datasetSource, recordTypesByObject }));
        };

        it('posts the record types on that data set only, in the order its datasetSource.json names them', () => {

            writeRecordTypes({ Account: ['Partner', 'Business'], Contact: ['Customer'] });

            const datasets = listDatasets(loadRecipe(workspaceRoot));
            const taggedDatasets = datasets.filter(dataset => dataset.datasetFolderName === TAGGED_DATASET_FOLDER_NAME);

            expect(taggedDatasets).not.toBeEmpty();
            taggedDatasets.forEach(dataset => expect(dataset.recordTypes).toEqual([
                { objectApiName: 'Account', developerNames: ['Partner', 'Business'] },
                { objectApiName: 'Contact', developerNames: ['Customer'] }
            ]));
            datasets.filter(dataset => dataset.datasetFolderName !== TAGGED_DATASET_FOLDER_NAME)
                .forEach(dataset => expect(dataset).not.toHaveProperty('recordTypes'));

        });

        it('posts exactly what it posted before for a workspace with no record types recorded', () => {

            const untaggedDatasets = listDatasets(loadRecipe(HISTORY_WORKSPACE_ROOT));

            expect(untaggedDatasets).not.toBeEmpty();
            untaggedDatasets.forEach(dataset => expect(dataset).not.toHaveProperty('recordTypes'));

        });

        it('lists a data set whose record types are out of shape, with no tag', () => {

            writeRecordTypes({ Account: ['Business Account'] });

            const taggedDatasets = listDatasets(loadRecipe(workspaceRoot)).filter(dataset => dataset.datasetFolderName === TAGGED_DATASET_FOLDER_NAME);

            expect(taggedDatasets).not.toBeEmpty();
            taggedDatasets.forEach(dataset => expect(dataset).not.toHaveProperty('recordTypes'));

        });

    });

    describe('the panel script', () => {

        const openDatasetRows = (recipe: IRecipeCockpitRecipeViewModel) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            const leadCard = panel.treeCards()[1];
            panel.chooseTreeCard(leadCard);
            panel.openTab(leadCard, 'Previously Used Data Sets');
            return { panel: panel, rows: panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset') };
        };

        it('draws the record types as text on the first line of that row only, every name escaped by textContent', () => {

            const recipe = loadRecipe(HISTORY_WORKSPACE_ROOT);
            recipe.trees[1].history!.datasets[0].recordTypes = [
                { objectApiName: 'Account', developerNames: ['Business', 'Partner'] },
                { objectApiName: 'Contact', developerNames: ['<b>Customer</b>'] }
            ];

            const { panel, rows } = openDatasetRows(recipe);
            const expectedText = `${RECIPE_COCKPIT_DATASET_RECORD_TYPES_LABEL_PREFIX}Account · Business, Partner; Contact · <b>Customer</b>`;
            const [primaryLineElement] = panel.findAll(rows[0], 'sdtRowHeaderPrimary');

            expect(panel.findAll(primaryLineElement, 'treeDatasetRecordTypes').map((chipElement: any) => chipElement.textContent)).toEqual([expectedText]);
            expect(panel.findAll(rows[0], 'treeDatasetRecordTypes')[0].attributes.title).toBe(`Generated with ${expectedText}`);
            rows.slice(1).forEach((rowElement: any) => expect(panel.findAll(rowElement, 'treeDatasetRecordTypes')).toEqual([]));

        });

        it('draws no chip on any row of a model with no record types', () => {

            const { panel, rows } = openDatasetRows(loadRecipe(HISTORY_WORKSPACE_ROOT));

            expect(rows).not.toBeEmpty();
            rows.forEach((rowElement: any) => expect(panel.findAll(rowElement, 'treeDatasetRecordTypes')).toEqual([]));

        });

    });

});
