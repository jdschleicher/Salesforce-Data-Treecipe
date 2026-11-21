jest.mock('vscode', () => ({
    window: {
        createWebviewPanel: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn().mockResolvedValue(undefined)
    },
    commands: { executeCommand: jest.fn() },
    workspace: { workspaceFolders: undefined },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    ThemeIcon: class { constructor(public id: string) {} },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RecipeCockpitService, RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE } from '../RecipeCockpitService';
import { IRecordTypeSetOutcome } from '../RecipeCockpitRecordTypeRecipe';
import { IDataSetInsertResult } from '../../CollectionsApiService/CollectionsApiService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    "A data set for each record type" (#624): the run of sets, with each step a stub, so every way a
    later set ends the run is reached without an org or a workspace. The journeys
    (GenerateAndInsertJourneys) run it end to end on real object metadata.
*/

const RECORD_TYPE_SETS = [{ Account: ['Business'] }, { Account: ['Partner'] }, { Account: ['Other'] }];
const FILTERED_RECIPE = { recipeText: '- object: Account\n', treeFolderName: 'Account', sourceRecipeFileName: 'recipe.yaml' } as any;
const landed = (overrides: Partial<IDataSetInsertResult> = {}): IDataSetInsertResult => ({ outcome: 'completed', isRolledBack: false, resultsFilePath: '', savedRecordCount: 1, failedRecordCount: 0, ...overrides });

type InsertRecordTypeSets = (recipeFilePath: string, recordTypeSets: Record<string, string[]>[], firstSetFilteredRecipe: unknown, setSteps: Record<string, unknown>) => Promise<IRecordTypeSetOutcome[]>;
const insertRecordTypeSets: InsertRecordTypeSets = (...insertArguments) => (RecipeCockpitService as any).insertRecordTypeSets(...insertArguments);

describe('RecipeCockpitService "A data set for each record type" (#624)', () => {

    let generatedFolders: string[];
    let workspaceRoot: string;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'record-type-sets-'));
        generatedFolders = [];
        jest.spyOn(RecipeCockpitService as any, 'generateConfirmedDataset').mockImplementation(async () => {
            const datasetFolderPath = path.join(workspaceRoot, `dataset-${generatedFolders.length + 1}`);
            generatedFolders.push(datasetFolderPath);
            return datasetFolderPath;
        });
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const buildSteps = (overrides: Record<string, unknown> = {}) => ({
        deriveRecipe: jest.fn(async () => ({ filteredRecipe: FILTERED_RECIPE })),
        isSameSelection: () => true,
        insertDataset: jest.fn(async () => landed()),
        isUsableDatasetFolder: () => true,
        onDatasetFolderMade: jest.fn(),
        ...overrides
    });

    describe('insertRecordTypeSets', () => {

        it('inserts every set in turn, builds each later set\'s recipe just before it, and reports each folder made', async () => {

            const setSteps = buildSteps();

            const setOutcomes = await insertRecordTypeSets('recipe.yaml', RECORD_TYPE_SETS, FILTERED_RECIPE, setSteps);

            expect(setOutcomes.map(setOutcome => [setOutcome.setLabel, setOutcome.status])).toEqual([
                ['Set 1 · Account · Business', 'inserted'],
                ['Set 2 · Account · Partner', 'inserted'],
                ['Set 3 · Account · Other', 'inserted']
            ]);
            expect(setSteps.deriveRecipe.mock.calls).toEqual([[RECORD_TYPE_SETS[1]], [RECORD_TYPE_SETS[2]]]);
            expect(setSteps.onDatasetFolderMade.mock.calls).toEqual(generatedFolders.map(datasetFolderPath => [datasetFolderPath]));
            expect(setSteps.insertDataset).toHaveBeenCalledTimes(3);

        });

        it.each([
            ['set 2 stopped under all-or-none', landed({ outcome: 'stopped', isRolledBack: true, failedRecordCount: 1, savedRecordCount: 0 })],
            ['set 2 had a record fail without all-or-none', landed({ failedRecordCount: 1 })],
            ['set 2 was cancelled, and rolled back', landed({ outcome: 'cancelled', isRolledBack: true })]
        ])('when %s, set 1 stays and set 3 is not started', async (_description, secondSetResult) => {

            const setSteps = buildSteps({ insertDataset: jest.fn().mockResolvedValueOnce(landed()).mockResolvedValueOnce(secondSetResult) });

            const setOutcomes = await insertRecordTypeSets('recipe.yaml', RECORD_TYPE_SETS, FILTERED_RECIPE, setSteps);

            expect(setOutcomes.map(setOutcome => setOutcome.status)).toEqual(['inserted', 'inserted', 'notStarted']);
            expect(setOutcomes[1].insertResult).toBe(secondSetResult);
            expect(generatedFolders).toHaveLength(2);

        });

        it.each([
            ['the org selection changed', { isSameSelection: () => false }, 'the org selection changed after the insert was confirmed'],
            ['building its recipe was cancelled', { deriveRecipe: async () => 'cancelled' }, 'building its recipe was cancelled'],
            ['its recipe could not be built', { deriveRecipe: async () => ({ refusalReason: 'the object metadata no longer builds this tree.' }) }, 'the object metadata no longer builds this tree.'],
            ['its data set folder is not one the workspace holds', { isUsableDatasetFolder: (datasetFolderPath: string) => !datasetFolderPath.endsWith('dataset-2') }, 'it was not generated']
        ])('when %s before set 2 is generated, set 2 is not generated and set 3 is not started', async (_description, stepOverrides, notGeneratedReason) => {

            const setSteps = buildSteps(stepOverrides);

            const setOutcomes = await insertRecordTypeSets('recipe.yaml', RECORD_TYPE_SETS, FILTERED_RECIPE, setSteps);

            expect(setOutcomes.map(setOutcome => setOutcome.status)).toEqual(['inserted', 'notGenerated', 'notStarted']);
            expect(setOutcomes[1].notGeneratedReason).toBe(notGeneratedReason);
            expect(setSteps.insertDataset).toHaveBeenCalledTimes(1);

        });

    });

    describe('showRecordTypeSetsNotification', () => {

        const INSERTED_TREE = { runFolderName: 'treecipe-run', treeFolderName: 'Account' };

        it('offers no button when every set landed, and View errors alone when the failed set has no failed file', () => {

            const showNotification = jest.spyOn(VSCodeWorkspaceService, 'showNotificationWithWorkspaceFiles').mockImplementation(() => undefined);
            const resultsFilePath = path.join(workspaceRoot, 'insertResults.json');
            fs.writeFileSync(resultsFilePath, '{}');

            RecipeCockpitService.showRecordTypeSetsNotification([{ setLabel: 'Set 1 · Account · Business', status: 'inserted', insertResult: landed() }], 'T', 'qa', workspaceRoot, INSERTED_TREE);
            RecipeCockpitService.showRecordTypeSetsNotification([
                { setLabel: 'Set 1 · Account · Business', status: 'inserted', insertResult: landed({ outcome: 'stopped', failedRecordCount: 1, resultsFilePath: resultsFilePath }) },
                { setLabel: 'Set 2 · Account · Partner', status: 'notStarted' }
            ], 'T', 'qa', workspaceRoot, INSERTED_TREE);

            expect(showNotification.mock.calls.map(([severity, , fileActions]) => [severity, fileActions.map(fileAction => [fileAction.label, fileAction.filePath])])).toEqual([
                ['information', []],
                ['error', [['View errors', resultsFilePath]]]
            ]);

        });

        it('offers no View errors for a cancelled set: a cancel is not a failure', () => {

            const showNotification = jest.spyOn(VSCodeWorkspaceService, 'showNotificationWithWorkspaceFiles').mockImplementation(() => undefined);

            RecipeCockpitService.showRecordTypeSetsNotification([{ setLabel: 'Set 1 · Account · Business', status: 'inserted', insertResult: landed({ outcome: 'cancelled', resultsFilePath: 'x' }) }], 'T', 'qa', workspaceRoot, INSERTED_TREE);

            expect(showNotification.mock.calls.map(([severity, , fileActions]) => [severity, fileActions])).toEqual([['warning', []]]);

        });

    });

    describe('addRecordTypeSetsToInsertConfirmation', () => {

        it('lists each set with the totals of the objects the tree inserts, after the records section, and says how the sets are inserted', () => {

            const confirmationContent = RecipeCockpitService.addRecordTypeSetsToInsertConfirmation(
                { summary: ['Generate 6 records'], warnings: ['Existing warning.'], sections: [{ title: 'Records', lines: ['Account: 2'] }, { title: 'Left out', lines: ['x'] }] },
                RECORD_TYPE_SETS.slice(0, 2),
                new Map([['Account', 1], ['Contact', 2], ['Note__c', 4]]),
                ['Account', 'Contact', 'Visit__c']
            );

            expect(confirmationContent.sections).toEqual([
                { title: 'Records', lines: ['Account: 2'] },
                { title: RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE, count: 2, lines: ['Set 1 · Account · Business: Account 1, Contact 2', 'Set 2 · Account · Partner: Account 1, Contact 2'] },
                { title: 'Left out', lines: ['x'] }
            ]);
            expect(confirmationContent.warnings).toEqual(['Existing warning.', expect.stringMatching(/^A data set for each record type makes 2 data sets, inserted one after another\./)]);

        });

    });

});
