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
import { RecipeCockpitService } from '../RecipeCockpitService';
import { IRecordTypeSet, IRecordTypeSetInsertSteps, IRecordTypeSetOutcome, RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE, RecipeCockpitRecordTypeSets } from '../RecipeCockpitRecordTypeSets';
import { IDataSetInsertResult } from '../../CollectionsApiService/CollectionsApiService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeYamlScalar/RecipeYamlScalar';

/*
    "A data set for each record type" (#624): the run of sets with each step a stub, so every way a set
    ends the run is reached without an org or a workspace; the confirmation's list of sets; and the one
    notification. The journeys (GenerateAndInsertJourneys) run it end to end on real object metadata.
*/

const SET_LABELS = ['Set 1 · Account · Business', 'Set 2 · Account · Partner', 'Set 3 · Account · Other'];
const landed = (overrides: Partial<IDataSetInsertResult> = {}): IDataSetInsertResult => ({ outcome: 'completed', isRolledBack: false, resultsFilePath: '', savedRecordCount: 3, failedRecordCount: 0, ...overrides });
const buildSets = (setCount = 3): IRecordTypeSet<string>[] => SET_LABELS.slice(0, setCount).map((setLabel, setIndex) => ({
    setLabel: setLabel,
    recipe: `recipe ${setIndex + 1}`,
    recordTotalsByObject: new Map([['Account', 1], ['Contact', setIndex + 1]]),
    warnings: []
}));

describe('RecipeCockpitRecordTypeSets (#624)', () => {

    describe('insertRecordTypeSets', () => {

        const buildSteps = (overrides: Partial<IRecordTypeSetInsertSteps<string>> = {}) => {
            const generatedRecipes: string[] = [];
            const setSteps = {
                generateDataset: jest.fn(async (recipe: string) => { generatedRecipes.push(recipe); return `/workspace/dataset-${generatedRecipes.length}`; }),
                onDatasetFolderMade: jest.fn(),
                isSameSelection: jest.fn(() => true),
                insertDataset: jest.fn(async () => landed()),
                ...overrides
            };
            return { setSteps, generatedRecipes };
        };

        it('generates and inserts every set in turn, from the recipe built for it, and reports each folder made', async () => {

            const { setSteps, generatedRecipes } = buildSteps();

            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(buildSets(), setSteps);

            expect(setOutcomes.map(setOutcome => [setOutcome.setLabel, setOutcome.status, setOutcome.datasetFolderPath])).toEqual([
                [SET_LABELS[0], 'inserted', '/workspace/dataset-1'],
                [SET_LABELS[1], 'inserted', '/workspace/dataset-2'],
                [SET_LABELS[2], 'inserted', '/workspace/dataset-3']
            ]);
            expect(generatedRecipes).toEqual(['recipe 1', 'recipe 2', 'recipe 3']);
            expect((setSteps.onDatasetFolderMade as jest.Mock).mock.calls).toEqual([['/workspace/dataset-1'], ['/workspace/dataset-2'], ['/workspace/dataset-3']]);
            expect(setSteps.isSameSelection).toHaveBeenCalledTimes(3);

        });

        it.each([
            ['set 2 stopped under all-or-none', landed({ outcome: 'stopped', isRolledBack: true, failedRecordCount: 1, savedRecordCount: 0 })],
            ['set 2 had a record fail without all-or-none', landed({ failedRecordCount: 1 })],
            ['set 2 was cancelled, and rolled back', landed({ outcome: 'cancelled', isRolledBack: true })]
        ])('when %s, set 1 stays and set 3 is not started', async (_description, secondSetResult) => {

            const { setSteps, generatedRecipes } = buildSteps({ insertDataset: jest.fn().mockResolvedValueOnce(landed()).mockResolvedValueOnce(secondSetResult) });

            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(buildSets(), setSteps);

            expect(setOutcomes.map(setOutcome => setOutcome.status)).toEqual(['inserted', 'inserted', 'notStarted']);
            expect(setOutcomes[1].insertResult).toBe(secondSetResult);
            expect(generatedRecipes).toHaveLength(2);

        });

        it('does not insert set 2 when it was not generated', async () => {

            const { setSteps } = buildSteps({ generateDataset: jest.fn().mockResolvedValueOnce('/workspace/dataset-1').mockResolvedValueOnce(undefined) });

            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(buildSets(), setSteps);

            expect(setOutcomes.map(setOutcome => [setOutcome.status, setOutcome.reason])).toEqual([['inserted', undefined], ['notInserted', 'it was not generated'], ['notStarted', undefined]]);
            expect(setSteps.insertDataset).toHaveBeenCalledTimes(1);

        });

        it('asks for the confirmed selection right before each insert: one changed while set 2 generated keeps its data set and inserts nothing', async () => {

            const { setSteps } = buildSteps({ isSameSelection: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false) });

            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(buildSets(), setSteps);

            expect(setOutcomes.map(setOutcome => setOutcome.status)).toEqual(['inserted', 'notInserted', 'notStarted']);
            expect(setOutcomes[1].reason).toMatch(/^the org selection changed after the insert was confirmed/);
            expect(setOutcomes[1].datasetFolderPath).toBe('/workspace/dataset-2');
            expect(setSteps.onDatasetFolderMade).toHaveBeenCalledTimes(2);
            expect(setSteps.insertDataset).toHaveBeenCalledTimes(1);

        });

        it.each([
            ['generating', { generateDataset: jest.fn().mockResolvedValueOnce('/workspace/dataset-1').mockRejectedValueOnce(new Error('Run Faker failed')) }],
            ['inserting', { insertDataset: jest.fn().mockResolvedValueOnce(landed()).mockRejectedValueOnce(new Error('Run Faker failed')) }]
        ])('reports set 2 as failed when %s it throws, so the sets already in the org are still named', async (_step, stepOverrides) => {

            const { setSteps } = buildSteps(stepOverrides as Partial<IRecordTypeSetInsertSteps<string>>);

            const setOutcomes = await RecipeCockpitRecordTypeSets.insertRecordTypeSets(buildSets(), setSteps);

            expect(setOutcomes.map(setOutcome => [setOutcome.status, setOutcome.reason])).toEqual([['inserted', undefined], ['failed', 'Run Faker failed'], ['notStarted', undefined]]);

        });

    });

    describe('addRecordTypeSetsToConfirmation', () => {

        it('lists each set with its own totals of the objects the tree inserts, after the records section, and names each set\'s own warnings', () => {

            const recordTypeSets = buildSets(2);
            recordTypeSets[1] = { ...recordTypeSets[1], warnings: ['Shown already.', 'Settings made on a copy this recipe does not write are not applied: Account · Account_Business_NickName.'] };

            const confirmationContent = RecipeCockpitRecordTypeSets.addRecordTypeSetsToConfirmation(
                { summary: ['Generate 6 records'], warnings: ['Shown already.'], sections: [{ title: 'Records', lines: ['Account: 2'] }, { title: 'Left out', lines: ['x'] }] },
                recordTypeSets,
                ['Account', 'Contact', 'Visit__c']
            );

            expect(confirmationContent.sections).toEqual([
                { title: 'Records', lines: ['Account: 2'] },
                { title: RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE, count: 2, lines: [`${SET_LABELS[0]}: Account 1, Contact 1`, `${SET_LABELS[1]}: Account 1, Contact 2`] },
                { title: 'Left out', lines: ['x'] }
            ]);
            expect(confirmationContent.warnings).toEqual([
                'Shown already.',
                expect.stringMatching(/^A data set for each record type makes 2 data sets, inserted one after another\./),
                `${SET_LABELS[1]}: Settings made on a copy this recipe does not write are not applied: Account · Account_Business_NickName.`
            ]);

        });

    });

    describe('buildRecordTypeSetsNotification', () => {

        it('is information naming every set when each landed', () => {

            expect(RecipeCockpitRecordTypeSets.buildRecordTypeSetsNotification([
                { setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed() },
                { setLabel: SET_LABELS[1], status: 'inserted', insertResult: landed({ savedRecordCount: 1 }) }
            ], 'Account tree', 'qa')).toEqual({
                severity: 'information',
                notificationText: 'A data set for each record type of Account tree into qa: 2 of 2 data sets inserted. Set 1 · Account · Business: 3 records inserted. Set 2 · Account · Partner: 1 record inserted.'
            });

        });

        it('is an error when set 2 of 3 stopped under all-or-none: set 1 kept, set 2 rolled back, set 3 not started', () => {

            expect(RecipeCockpitRecordTypeSets.buildRecordTypeSetsNotification([
                { setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed() },
                { setLabel: SET_LABELS[1], status: 'inserted', insertResult: landed({ outcome: 'stopped', isRolledBack: true, savedRecordCount: 0, failedRecordCount: 1 }) },
                { setLabel: SET_LABELS[2], status: 'notStarted' }
            ], 'Account tree', 'qa')).toEqual({
                severity: 'error',
                notificationText: 'A data set for each record type of Account tree into qa: 1 of 3 data sets inserted. Set 1 · Account · Business: 3 records inserted. '
                    + 'Set 2 · Account · Partner: stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen (1 record failed). '
                    + 'Set 3 · Account · Other: not started.'
            });

        });

        it.each([
            ['a cancel that rolled back', { status: 'inserted', insertResult: landed({ outcome: 'cancelled', isRolledBack: true }) }, 'warning', 'cancelled, and every record it had inserted was deleted'],
            ['a cancel before anything was sent', { status: 'inserted', insertResult: landed({ outcome: 'cancelled' }) }, 'warning', 'cancelled'],
            ['a failed record without all-or-none', { status: 'inserted', insertResult: landed({ savedRecordCount: 2, failedRecordCount: 1 }) }, 'error', '2 records inserted and 1 failed; nothing was rolled back'],
            ['a stop without all-or-none', { status: 'inserted', insertResult: landed({ outcome: 'stopped', savedRecordCount: 1, failedRecordCount: 2 }) }, 'error', 'stopped at a file that could not be inserted; 1 record was kept, because all-or-none was not chosen, and 2 failed'],
            ['a guard that stopped it', { status: 'notInserted', reason: 'it was not generated' }, 'warning', 'not inserted: it was not generated'],
            ['a step that threw', { status: 'failed', reason: 'boom [x](command:evil)' }, 'error', `failed: ${RecipeYamlScalar.escapeForNotification('boom [x](command:evil)')}`]
        ] as Array<[string, Omit<IRecordTypeSetOutcome, 'setLabel'>, string, string]>)('names %s on set 2', (_description, secondSet, severity, secondSetText) => {

            const { severity: shownSeverity, notificationText } = RecipeCockpitRecordTypeSets.buildRecordTypeSetsNotification([
                { setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed() },
                { setLabel: SET_LABELS[1], ...secondSet },
                { setLabel: SET_LABELS[2], status: 'notStarted' }
            ], 'T', 'qa');

            expect(shownSeverity).toBe(severity);
            expect(notificationText).toContain(`Set 2 · Account · Partner: ${secondSetText}. Set 3 · Account · Other: not started.`);

        });

        it('escapes a set\'s label, so a record type name cannot write a command link', () => {

            const { notificationText } = RecipeCockpitRecordTypeSets.buildRecordTypeSetsNotification([{ setLabel: 'Set 1 · Account · [x](command:evil)', status: 'notStarted' }], 'T', 'qa');

            expect(notificationText).not.toContain('[x](command:evil)');

        });

        it('lands a set only when every file was sent and every record saved', () => {

            expect(RecipeCockpitRecordTypeSets.isInsertWhollyLanded(landed())).toBe(true);
            expect(RecipeCockpitRecordTypeSets.isInsertWhollyLanded(landed({ failedRecordCount: 1 }))).toBe(false);
            expect(RecipeCockpitRecordTypeSets.isInsertWhollyLanded(landed({ outcome: 'cancelled' }))).toBe(false);
            expect(RecipeCockpitRecordTypeSets.isInsertWhollyLanded(landed({ outcome: 'stopped' }))).toBe(false);

        });

    });

    describe('RecipeCockpitService.showRecordTypeSetsNotification', () => {

        const INSERTED_TREE = { runFolderName: 'treecipe-run', treeFolderName: 'Account' };
        let workspaceRoot: string;

        beforeEach(() => { workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'record-type-sets-')); });
        afterEach(() => { fs.rmSync(workspaceRoot, { recursive: true, force: true }); });

        it('offers no button when every set landed, and View errors alone when the failed set has no failed file', () => {

            const showNotification = jest.spyOn(VSCodeWorkspaceService, 'showNotificationWithWorkspaceFiles').mockImplementation(() => undefined);
            const resultsFilePath = path.join(workspaceRoot, 'insertResults.json');
            fs.writeFileSync(resultsFilePath, '{}');

            RecipeCockpitService.showRecordTypeSetsNotification([{ setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed() }], 'T', 'qa', workspaceRoot, INSERTED_TREE);
            RecipeCockpitService.showRecordTypeSetsNotification([
                { setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed({ outcome: 'stopped', failedRecordCount: 1, resultsFilePath: resultsFilePath }) },
                { setLabel: SET_LABELS[1], status: 'notStarted' }
            ], 'T', 'qa', workspaceRoot, INSERTED_TREE);

            expect(showNotification.mock.calls.map(([severity, , fileActions]) => [severity, fileActions.map(fileAction => [fileAction.label, fileAction.filePath])])).toEqual([
                ['information', []],
                ['error', [['View errors', resultsFilePath]]]
            ]);

        });

        it('offers no file for a cancelled set or one that threw before its insert answered', () => {

            const showNotification = jest.spyOn(VSCodeWorkspaceService, 'showNotificationWithWorkspaceFiles').mockImplementation(() => undefined);

            RecipeCockpitService.showRecordTypeSetsNotification([{ setLabel: SET_LABELS[0], status: 'inserted', insertResult: landed({ outcome: 'cancelled', resultsFilePath: 'x' }) }], 'T', 'qa', workspaceRoot, INSERTED_TREE);
            RecipeCockpitService.showRecordTypeSetsNotification([{ setLabel: SET_LABELS[0], status: 'failed', reason: 'boom' }], 'T', 'qa', workspaceRoot, INSERTED_TREE);

            expect(showNotification.mock.calls.map(([severity, , fileActions]) => [severity, fileActions])).toEqual([['warning', []], ['error', []]]);

        });

    });

});
