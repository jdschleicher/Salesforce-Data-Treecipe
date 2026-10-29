import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DATASET_JOURNEY_ENTRY_LIMIT, RecipeCockpitDatasetJourney } from '../RecipeCockpitDatasetJourney';
import { DatasetInsertAttemptService, IInsertAttemptSummary, INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION } from '../../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { IRecipeCockpitRunArtifactsLocation } from '../RecipeCockpitRunArtifacts';
import { RecipeCockpitRunHistory, RunHistoryOutcome, RunHistoryStep } from '../RecipeCockpitRunHistory';
import { makeTreeRunArtifactsLocation } from './RecipeCockpitRunArtifactsFixture';

/*
    #471: a data set's insert journey -- every insert attempt and every Troubleshooting step of its
    tree from the data set being made to the end of its last attempt, oldest first, for the orgs its
    attempts went to. Untrusted files are entries said to be unreadable, never left out.
*/

const QA_USERNAME = 'qa@example.com.sandbox';
const DATASET_FOLDER_NAME = 'dataset-2026-10-26T08-00-00';

const summaryOf = (startedAt: string, overrides: Partial<IInsertAttemptSummary> = {}): IInsertAttemptSummary => ({
    schemaVersion: INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION,
    outcome: 'completed',
    isRolledBack: false,
    isAllOrNone: true,
    savedRecordCount: 4,
    failedRecordCount: 0,
    orgUsername: QA_USERNAME,
    orgAlias: 'qa',
    startedAt: startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 5000).toISOString(),
    ...overrides
});

const failedResults = (objectApiName: string, errors: unknown[]) => JSON.stringify({ SuccessResults: {}, FailureResults: { [objectApiName]: [{ success: false, errors: errors }] } });

describe('RecipeCockpitDatasetJourney (#471)', () => {

    let workspaceRoot: string;
    let datasetFolderPath: string;
    let location: IRecipeCockpitRunArtifactsLocation;

    // AN ATTEMPT FOLDER IS NAMED IN UTC, AS CollectionsApiService NAMES IT
    const writeAttempt = (isoStartedAt: string, summary: IInsertAttemptSummary | string | undefined, resultsText = '{"SuccessResults":{},"FailureResults":{}}') => {
        const attemptTimestamp = isoStartedAt.slice(0, 19).replace(/:/g, '-');
        const attemptFolderPath = path.join(datasetFolderPath, 'InsertAttempts', `insertAttempt-${attemptTimestamp}`);
        fs.mkdirSync(attemptFolderPath, { recursive: true });
        fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildResultsFileName(attemptTimestamp)), resultsText);
        if ( summary !== undefined ) {
            fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildSummaryFileName(attemptTimestamp)), typeof summary === 'string' ? summary : JSON.stringify(summary));
        }
        return attemptFolderPath;
    };

    const writeStep = (step: RunHistoryStep, outcome: RunHistoryOutcome, isoStartedAt: string, extra: { orgUsername?: string; detail?: string; failedCount?: number; succeededCount?: number } = {}) => {
        const startedAt = new Date(isoStartedAt);
        const orgUsername = extra.orgUsername ?? QA_USERNAME;
        const folderPath = RecipeCockpitRunHistory.buildStepFolderPath(location, step, orgUsername) as string;
        fs.mkdirSync(folderPath, { recursive: true });
        const resultFilePath = path.join(folderPath, `${RecipeCockpitRunHistory.buildCompactTimestamp(startedAt)}-${step}.json`);
        fs.writeFileSync(resultFilePath, '{}');
        RecipeCockpitRunHistory.writeSummary(location, {
            step, outcome, orgUsername, startedAt, finishedAt: new Date(startedAt.getTime() + 3000),
            ...( extra.detail !== undefined ? { detail: extra.detail } : {} ),
            ...( extra.failedCount !== undefined ? { failedCount: extra.failedCount } : {} ),
            ...( extra.succeededCount !== undefined ? { succeededCount: extra.succeededCount } : {} ),
            filePaths: [resultFilePath]
        });
        return resultFilePath;
    };

    const legacyFolderPath = () => path.join(workspaceRoot, 'treecipe', 'OrgOperations');
    const buildJourney = (entryLimit?: number) => RecipeCockpitDatasetJourney.buildJourney(datasetFolderPath, [location], legacyFolderPath(), entryLimit);
    const kindsAndStatuses = (journey: ReturnType<typeof buildJourney>) => journey.entries.map(entry => `${entry.kind}:${entry.status}`);

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-journey-'));
        datasetFolderPath = path.join(workspaceRoot, 'treecipe', 'FakeDataSets', DATASET_FOLDER_NAME);
        fs.mkdirSync(datasetFolderPath, { recursive: true });
        location = makeTreeRunArtifactsLocation(workspaceRoot);
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    it('has no journey for a data set never inserted, and lists no step for it', () => {

        writeStep('field-deploy', 'succeeded', '2026-10-26T09:00:00Z');

        expect(buildJourney()).toEqual({ attemptCount: 0, entries: [], hiddenEntryCount: 0, otherOrgStepCount: 0, untrackedStepCount: 0 });

    });

    it('a data set inserted once with nothing else is one succeeded insert entry, with its files', () => {

        const attemptFolderPath = writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));

        const journey = buildJourney();

        expect(journey.attemptCount).toBe(1);
        expect(journey.entries).toEqual([{
            kind: 'insert',
            status: 'succeeded',
            timeMs: Date.parse('2026-10-26T10:00:00Z'),
            orgUsername: QA_USERNAME,
            orgAlias: 'qa',
            summaryText: '4 records saved · 0 records failed · all-or-none',
            filePaths: [
                path.join(attemptFolderPath, 'insertAttemptResults-2026-10-26T10-00-00.json'),
                path.join(attemptFolderPath, 'insertAttemptSummary-2026-10-26T10-00-00.json')
            ]
        }]);

    });

    it('fail → deploy → assign → success: oldest first, each failure with its error excerpt', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { savedRecordCount: 0, failedRecordCount: 4, outcome: 'stopped', isRolledBack: true }),
            failedResults('Account', [
                { statusCode: 'ALL_OR_NONE_OPERATION_ROLLED_BACK', message: 'rolled back', fields: [] },
                { statusCode: 'INVALID_FIELD', message: 'No such column Rating__c', fields: ['Rating__c'] }
            ]));
        writeStep('field-deploy', 'failed', '2026-10-26T10:05:00Z', { failedCount: 1, detail: 'Account.Rating__c: picklist value set not found' });
        writeStep('field-deploy', 'succeeded', '2026-10-26T10:10:00Z', { succeededCount: 3 });
        writeStep('permission-set-assign', 'partial', '2026-10-26T10:15:00Z', { succeededCount: 1, failedCount: 1, detail: 'Contact_Reader could not be assigned: duplicate' });
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z'));

        const journey = buildJourney();

        expect(kindsAndStatuses(journey)).toEqual([
            'insert:failed',
            'field-deploy:failed',
            'field-deploy:succeeded',
            'permission-set-assign:partial',
            'insert:succeeded'
        ]);
        expect(journey.entries[0].summaryText).toBe('0 records saved · 4 records failed · all-or-none · rolled back · stopped');
        expect(journey.entries[0].errorExcerpt).toBe('Account: INVALID_FIELD [Rating__c] — No such column Rating__c');
        expect(journey.entries[1].errorExcerpt).toBe('Account.Rating__c: picklist value set not found');
        expect(journey.entries[2]).not.toHaveProperty('errorExcerpt');
        expect(journey.entries[2].summaryText).toBe('3 succeeded');
        expect(journey.entries[3].errorExcerpt).toBe('Contact_Reader could not be assigned: duplicate');
        expect(journey.entries[3].filePaths).toHaveLength(1);
        expect(journey.entries[4]).not.toHaveProperty('errorExcerpt');

    });

    it('takes steps from the data set being made to the end of its last attempt, and none outside', () => {

        writeStep('field-retrieve', 'succeeded', '2026-10-26T07:00:00Z');
        writeStep('field-deploy', 'succeeded', '2026-10-26T09:00:00Z');
        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        // DURING THE INSERT, BEFORE ITS finishedAt, AND AFTER IT
        writeStep('record-type-deploy', 'succeeded', '2026-10-26T10:00:03Z');
        writeStep('global-value-set-deploy', 'succeeded', '2026-10-26T11:00:00Z');

        expect(kindsAndStatuses(buildJourney())).toEqual(['field-deploy:succeeded', 'insert:succeeded', 'record-type-deploy:succeeded']);

    });

    it('leaves off a step against another org and counts it, and keeps every step when no attempt names an org', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { savedRecordCount: 3, failedRecordCount: 1 }));
        writeStep('field-deploy', 'succeeded', '2026-10-26T10:05:00Z', { orgUsername: 'other@example.com' });
        writeStep('field-deploy', 'succeeded', '2026-10-26T10:06:00Z', { orgUsername: QA_USERNAME.toUpperCase() });
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z'));

        const journey = buildJourney();
        expect(kindsAndStatuses(journey)).toEqual(['insert:partial', 'field-deploy:succeeded', 'insert:succeeded']);
        expect(journey.otherOrgStepCount).toBe(1);

        fs.rmSync(path.join(datasetFolderPath, 'InsertAttempts'), { recursive: true });
        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { orgUsername: null, orgAlias: undefined }));
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z', { orgUsername: null, orgAlias: undefined }));
        expect(buildJourney().otherOrgStepCount).toBe(0);
        expect(buildJourney().entries).toHaveLength(4);

    });

    it('counts step files in the old treecipe/OrgOperations folder in the window, for the attempts\' org, and never lists them', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z'));
        const legacyOrgFolder = path.join(legacyFolderPath(), QA_USERNAME);
        fs.mkdirSync(legacyOrgFolder, { recursive: true });
        const inWindow = RecipeCockpitRunHistory.buildCompactTimestamp(new Date('2026-10-26T10:05:00Z'));
        const outOfWindow = RecipeCockpitRunHistory.buildCompactTimestamp(new Date('2026-10-26T12:00:00Z'));
        fs.writeFileSync(path.join(legacyOrgFolder, `${inWindow}-field-deploy.json`), '{}');
        fs.writeFileSync(path.join(legacyOrgFolder, `${inWindow}-field-deploy-package.xml`), '<x/>');
        fs.writeFileSync(path.join(legacyOrgFolder, `${inWindow}-scratch-org-create.json`), '{}');
        fs.writeFileSync(path.join(legacyOrgFolder, `${outOfWindow}-field-deploy.json`), '{}');
        fs.mkdirSync(path.join(legacyFolderPath(), 'other@example.com'));
        fs.writeFileSync(path.join(legacyFolderPath(), 'other@example.com', `${inWindow}-field-deploy.json`), '{}');

        const journey = buildJourney();

        expect(journey.untrackedStepCount).toBe(1);
        expect(kindsAndStatuses(journey)).toEqual(['insert:succeeded', 'insert:succeeded']);

    });

    it('shows a summary or results file out of shape as unreadable, and an attempt with no summary as not recorded', () => {

        writeAttempt('2026-10-26T10:00:00Z', '{"schemaVersion":1,"outcome":"completed"}');
        writeAttempt('2026-10-26T10:05:00Z', undefined, failedResults('Contact', [{ statusCode: 'REQUIRED_FIELD_MISSING', fields: ['LastName'] }]));
        writeAttempt('2026-10-26T10:10:00Z', summaryOf('2026-10-26T10:10:00.000Z', { failedRecordCount: 2 }), '{"FailureResults": []}');
        writeAttempt('2026-10-26T10:15:00Z', summaryOf('2026-10-26T10:15:00.000Z', { failedRecordCount: 1 }), 'not json');
        const location2Folder = path.join(location.folderPath, 'OrgOperations', QA_USERNAME);
        fs.mkdirSync(location2Folder, { recursive: true });
        fs.writeFileSync(path.join(location2Folder, `${RecipeCockpitRunHistory.buildCompactTimestamp(new Date('2026-10-26T10:12:00Z'))}-field-deploy-summary.json`), '{"broken":true}');

        const journey = buildJourney();

        expect(kindsAndStatuses(journey)).toEqual(['insert:unreadable', 'insert:unrecorded', 'insert:partial', 'field-deploy:unreadable', 'insert:partial']);
        expect(journey.entries[1].errorExcerpt).toBe('Contact: REQUIRED_FIELD_MISSING [LastName]');
        expect(journey.entries[2].errorExcerpt).toBe('The results file insertAttemptResults-2026-10-26T10-10-00.json is unreadable, so no error is shown.');
        expect(journey.entries[3].filePaths).toHaveLength(1);
        expect(journey.entries[4].errorExcerpt).toContain('is unreadable');

    });

    it('reads every shape of a failed answer: a rollback alone, errors not a list, no results file, and a cancel', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { savedRecordCount: 0, failedRecordCount: 1 }),
            JSON.stringify({ FailureResults: { Account: [{ errors: 'not a list' }, 'not a record', { errors: [{ statusCode: '' }, { statusCode: 'ALL_OR_NONE_OPERATION_ROLLED_BACK', fields: 'Name' }] }] } }));
        const noResultsAttempt = writeAttempt('2026-10-26T10:05:00Z', summaryOf('2026-10-26T10:05:00.000Z', { savedRecordCount: 0, failedRecordCount: 1, orgAlias: undefined }));
        fs.rmSync(path.join(noResultsAttempt, 'insertAttemptResults-2026-10-26T10-05-00.json'));
        writeAttempt('2026-10-26T10:10:00Z', summaryOf('2026-10-26T10:10:00.000Z', { outcome: 'cancelled', savedRecordCount: 0 }));
        writeAttempt('2026-10-26T10:15:00Z', summaryOf('2026-10-26T10:15:00.000Z', { isInterrupted: true, savedRecordCount: 1, failedRecordCount: 1 }),
            failedResults('Lead', []));

        const journey = RecipeCockpitDatasetJourney.buildJourney(datasetFolderPath, [location], undefined);

        expect(kindsAndStatuses(journey)).toEqual(['insert:failed', 'insert:failed', 'insert:cancelled', 'insert:partial']);
        expect(journey.entries[0].errorExcerpt).toBe('Account: ALL_OR_NONE_OPERATION_ROLLED_BACK');
        expect(journey.entries[1]).not.toHaveProperty('errorExcerpt');
        expect(journey.entries[1]).not.toHaveProperty('orgAlias');
        expect(journey.entries[1].filePaths).toHaveLength(1);
        expect(journey.entries[2].summaryText).toBe('0 records saved · 0 records failed · all-or-none · cancelled');
        expect(journey.entries[3].summaryText).toBe('1 record saved · 1 record failed · all-or-none · stopped on an error before it ended');
        expect(journey.entries[3]).not.toHaveProperty('errorExcerpt');
        expect(journey.untrackedStepCount).toBe(0);

    });

    it('says a step from before summaries was not recorded, and names its org from its folder', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z'));
        const stepFolder = path.join(location.folderPath, 'OrgOperations', QA_USERNAME);
        fs.mkdirSync(stepFolder, { recursive: true });
        fs.writeFileSync(path.join(stepFolder, `${RecipeCockpitRunHistory.buildCompactTimestamp(new Date('2026-10-26T10:05:00Z'))}-permission-set-assign.json`), '{}');

        const [, stepEntry] = buildJourney().entries;

        expect(stepEntry).toEqual(expect.objectContaining({ kind: 'permission-set-assign', status: 'unrecorded', orgUsername: QA_USERNAME, summaryText: 'Ran before Treecipe recorded how a step ended.' }));
        expect(stepEntry).not.toHaveProperty('errorExcerpt');

    });

    it('ends the window at a last attempt with no summary, starts it at the first attempt for a folder name with no time, and orders ties', () => {

        datasetFolderPath = path.join(workspaceRoot, 'treecipe', 'FakeDataSets', 'hand-named');
        fs.mkdirSync(datasetFolderPath, { recursive: true });
        writeStep('field-retrieve', 'succeeded', '2026-10-26T09:59:00Z');
        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        writeStep('record-type-deploy', 'succeeded', '2026-10-26T10:05:00Z', { detail: 'Account.Business' });
        writeStep('field-deploy', 'succeeded', '2026-10-26T10:05:00Z');
        writeStep('permission-set-deploy', 'succeeded', '2026-10-26T10:10:00Z');
        writeAttempt('2026-10-26T10:10:00Z', undefined);
        writeStep('global-value-set-deploy', 'succeeded', '2026-10-26T10:10:01Z');

        const journey = buildJourney();

        expect(kindsAndStatuses(journey)).toEqual(['insert:succeeded', 'field-deploy:succeeded', 'record-type-deploy:succeeded', 'permission-set-deploy:succeeded', 'insert:unrecorded']);
        expect(journey.entries[2].summaryText).toBe('Account.Business');

    });

    it('carries a step\'s org alias, and reads a results file that is not an object, or cannot be read, as unreadable', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { failedRecordCount: 1 }), 'null');
        const startedAt = new Date('2026-10-26T10:05:00Z');
        RecipeCockpitRunHistory.writeSummary(location, { step: 'field-deploy', outcome: 'succeeded', orgUsername: QA_USERNAME, orgAlias: 'qa', startedAt, finishedAt: startedAt, filePaths: [] });
        writeAttempt('2026-10-26T10:20:00Z', summaryOf('2026-10-26T10:20:00.000Z'));

        const journey = buildJourney();

        expect(journey.entries[0].errorExcerpt).toContain('is unreadable');
        expect(journey.entries[1]).toEqual(expect.objectContaining({ kind: 'field-deploy', orgUsername: QA_USERNAME, orgAlias: 'qa', summaryText: '' }));
        expect(RecipeCockpitDatasetJourney.readResultsExcerpt(datasetFolderPath).errorExcerpt).toContain('is unreadable');

    });

    it('counts no folder inside an old OrgOperations org folder as a step', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        const inWindow = RecipeCockpitRunHistory.buildCompactTimestamp(new Date('2026-10-26T10:00:01Z'));
        fs.mkdirSync(path.join(legacyFolderPath(), QA_USERNAME, `${inWindow}-field-deploy.json`), { recursive: true });

        expect(buildJourney().untrackedStepCount).toBe(0);

    });

    it('cuts an error excerpt to one line of a fixed length', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z', { savedRecordCount: 0, failedRecordCount: 1 }),
            failedResults('Account', [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: `line one\nline two ${'x'.repeat(600)}`, fields: [] }]));

        const errorExcerpt = buildJourney().entries[0].errorExcerpt as string;

        expect(errorExcerpt.length).toBeLessThanOrEqual(300);
        expect(errorExcerpt).toMatch(/^Account: FIELD_CUSTOM_VALIDATION_EXCEPTION — line one line two x+…$/);

    });

    it('caps the entries, keeping the newest and counting the rest', () => {

        for ( let attemptIndex = 0; attemptIndex < 5; attemptIndex++ ) {
            const isoStartedAt = `2026-10-26T10:0${attemptIndex}:00Z`;
            writeAttempt(isoStartedAt, summaryOf(`2026-10-26T10:0${attemptIndex}:00.000Z`, { savedRecordCount: attemptIndex }));
        }

        const journey = buildJourney(3);

        expect(journey.attemptCount).toBe(5);
        expect(journey.hiddenEntryCount).toBe(2);
        expect(journey.entries.map(entry => entry.summaryText.split(' ')[0])).toEqual(['2', '3', '4']);
        expect(DATASET_JOURNEY_ENTRY_LIMIT).toBeGreaterThan(0);

    });

    it('reads a folder that cannot be listed as empty', () => {

        writeAttempt('2026-10-26T10:00:00Z', summaryOf('2026-10-26T10:00:00.000Z'));
        fs.mkdirSync(path.join(legacyFolderPath(), QA_USERNAME), { recursive: true });
        const readdirSync = fs.readdirSync;
        const readdirSpy = jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, options?: any) => {
            if ( String(folderPath) === legacyFolderPath() ) {
                throw new Error('EACCES');
            }
            return readdirSync(folderPath, options);
        }) as typeof fs.readdirSync);

        expect(buildJourney().untrackedStepCount).toBe(0);

        readdirSpy.mockImplementation(() => { throw new Error('EACCES'); });
        expect(buildJourney().attemptCount).toBe(0);

    });

    it('follows no linked InsertAttempts folder', () => {

        const elsewhere = path.join(workspaceRoot, 'elsewhere');
        fs.mkdirSync(path.join(elsewhere, 'insertAttempt-2026-10-26T10-00-00'), { recursive: true });
        fs.symlinkSync(elsewhere, path.join(datasetFolderPath, 'InsertAttempts'));

        expect(buildJourney().attemptCount).toBe(0);

    });

    it('reads when a data set was made from its folder name, in UTC', () => {

        expect(RecipeCockpitDatasetJourney.readDatasetCreatedAt('dataset-fakerjs-2026-10-26T08-00-00-2')).toBe(Date.parse('2026-10-26T08:00:00Z'));
        expect(RecipeCockpitDatasetJourney.readDatasetCreatedAt('not-a-data-set')).toBeUndefined();
        expect(DatasetInsertAttemptService.readAttemptTimestamp('2026-02-30T10-00-00')).toBeUndefined();
        expect(DatasetInsertAttemptService.readAttemptTimestamp('garbage')).toBeUndefined();

    });

});
