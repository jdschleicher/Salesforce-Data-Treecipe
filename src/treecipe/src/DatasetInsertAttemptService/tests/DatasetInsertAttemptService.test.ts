import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DatasetInsertAttemptService, IInsertAttemptSummary, INSERT_ATTEMPTS_FOLDER_NAME } from '../DatasetInsertAttemptService';

const STARTED_AT = new Date('2026-10-26T10:00:00.000Z');
const FINISHED_AT = new Date('2026-10-26T10:00:05.000Z');

function buildSummary(overrides: Partial<IInsertAttemptSummary> = {}): IInsertAttemptSummary {
    return {
        ...DatasetInsertAttemptService.buildSummary('completed', false, true, 3, 0, 'admin@example.com.sandbox', 'mySandbox', STARTED_AT, FINISHED_AT),
        ...overrides
    };
}

describe('DatasetInsertAttemptService', () => {

    let datasetFolderPath: string;

    beforeEach(() => {
        datasetFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'insertAttempt-'));
    });

    afterEach(() => {
        fs.rmSync(datasetFolderPath, { recursive: true, force: true });
    });

    function makeAttemptFolder(attemptTimestamp: string): string {
        const attemptFolderPath = path.join(datasetFolderPath, INSERT_ATTEMPTS_FOLDER_NAME, `insertAttempt-${attemptTimestamp}`);
        fs.mkdirSync(attemptFolderPath, { recursive: true });
        return attemptFolderPath;
    }

    function writeAttempt(attemptTimestamp: string, summaryText: string | undefined, resultsText = '{"SuccessResults":{},"FailureResults":{}}'): string {
        const attemptFolderPath = makeAttemptFolder(attemptTimestamp);
        const resultsFilePath = path.join(attemptFolderPath, DatasetInsertAttemptService.buildResultsFileName(attemptTimestamp));
        fs.writeFileSync(resultsFilePath, resultsText);
        if ( summaryText !== undefined ) {
            fs.writeFileSync(path.join(attemptFolderPath, DatasetInsertAttemptService.buildSummaryFileName(attemptTimestamp)), summaryText);
        }
        return resultsFilePath;
    }

    describe('readStatus', () => {

        test.each([
            ['a completed insert with no failure', { outcome: 'completed', failedRecordCount: 0, savedRecordCount: 3 }, 'succeeded'],
            ['a completed insert of no records', { outcome: 'completed', failedRecordCount: 0, savedRecordCount: 0 }, 'succeeded'],
            ['a completed insert some records of failed without all-or-none', { outcome: 'completed', failedRecordCount: 1, savedRecordCount: 3, isAllOrNone: false }, 'partial'],
            ['a completed insert whose every record failed', { outcome: 'completed', failedRecordCount: 2, savedRecordCount: 0, isAllOrNone: false }, 'failed'],
            ['a stop that kept the earlier files\' records', { outcome: 'stopped', failedRecordCount: 1, savedRecordCount: 4, isAllOrNone: false }, 'partial'],
            ['a stop at the first file', { outcome: 'stopped', failedRecordCount: 1, savedRecordCount: 0, isAllOrNone: false }, 'failed'],
            ['an all-or-none stop that was rolled back', { outcome: 'stopped', isRolledBack: true, failedRecordCount: 1, savedRecordCount: 0 }, 'failed'],
            ['a cancel', { outcome: 'cancelled', isRolledBack: true, failedRecordCount: 0, savedRecordCount: 0 }, 'cancelled']
        ] as Array<[string, Partial<IInsertAttemptSummary>, string]>)('%s is %s', (_label, overrides, expectedStatus) => {
            expect(DatasetInsertAttemptService.readStatus(buildSummary(overrides))).toBe(expectedStatus);
        });

        test('a rollback is a failure even when the summary still counts saved records', () => {
            expect(DatasetInsertAttemptService.readStatus(buildSummary({ outcome: 'stopped', isRolledBack: true, savedRecordCount: 5, failedRecordCount: 1 }))).toBe('failed');
        });

        test('an insert that threw is never read as finished: partial while records may remain, else failed', () => {
            expect(DatasetInsertAttemptService.readStatus(buildSummary({ outcome: 'stopped', savedRecordCount: 2, isInterrupted: true }))).toBe('partial');
            expect(DatasetInsertAttemptService.readStatus(buildSummary({ outcome: 'cancelled', savedRecordCount: 2, isInterrupted: true }))).toBe('partial');
            expect(DatasetInsertAttemptService.readStatus(buildSummary({ outcome: 'stopped', savedRecordCount: 0, isInterrupted: true }))).toBe('failed');
        });

    });

    describe('buildSummary', () => {

        test('keeps the username and alias, and the instants as ISO text', () => {
            expect(buildSummary()).toEqual({
                schemaVersion: 1,
                outcome: 'completed',
                isRolledBack: false,
                isAllOrNone: true,
                savedRecordCount: 3,
                failedRecordCount: 0,
                orgUsername: 'admin@example.com.sandbox',
                orgAlias: 'mySandbox',
                startedAt: '2026-10-26T10:00:00.000Z',
                finishedAt: '2026-10-26T10:00:05.000Z'
            });
        });

        test('records no org name that is not one line, or that carries a bidi control', () => {
            const summary = DatasetInsertAttemptService.buildSummary('completed', false, false, 0, 0, 'a\nb', 'x\u2028y', STARTED_AT, FINISHED_AT);
            expect(summary.orgUsername).toBeNull();
            expect(summary).not.toHaveProperty('orgAlias');
            ['prod\u202Exobdnas', 'a\u2066b', 'a\u200Fb', 'a\u061Cb'].forEach(orgName => expect(DatasetInsertAttemptService.isOrgName(orgName)).toBe(false));
        });

        test('marks an insert that threw, and only that one', () => {
            expect(buildSummary()).not.toHaveProperty('isInterrupted');
            expect(DatasetInsertAttemptService.buildSummary('stopped', false, true, 1, 0, undefined, undefined, STARTED_AT, FINISHED_AT, true).isInterrupted).toBe(true);
        });

    });

    describe('parseSummary', () => {

        test('reads back what buildSummary writes', () => {
            expect(DatasetInsertAttemptService.parseSummary(JSON.stringify(buildSummary()))).toEqual(buildSummary());
        });

        test('reads back an interrupted insert', () => {
            const summary = buildSummary({ outcome: 'stopped', isInterrupted: true });
            expect(DatasetInsertAttemptService.parseSummary(JSON.stringify(summary))).toEqual(summary);
        });

        test('reads a summary with no org', () => {
            const summary = buildSummary({ orgUsername: null });
            delete summary.orgAlias;
            expect(DatasetInsertAttemptService.parseSummary(JSON.stringify(summary))).toEqual(summary);
        });

        test.each([
            ['not JSON', 'nope'],
            ['an array', '[]'],
            ['null', 'null'],
            ['another schema version', JSON.stringify({ ...buildSummary(), schemaVersion: 2 })],
            ['an unknown outcome', JSON.stringify({ ...buildSummary(), outcome: 'succeeded' })],
            ['a negative count', JSON.stringify({ ...buildSummary(), savedRecordCount: -1 })],
            ['a fractional count', JSON.stringify({ ...buildSummary(), failedRecordCount: 1.5 })],
            ['a count as text', JSON.stringify({ ...buildSummary(), savedRecordCount: '3' })],
            ['a rollback flag as text', JSON.stringify({ ...buildSummary(), isRolledBack: 'false' })],
            ['a username across two lines', JSON.stringify({ ...buildSummary(), orgUsername: 'a\nb' })],
            ['an empty alias', JSON.stringify({ ...buildSummary(), orgAlias: '' })],
            ['a date that is not an instant', JSON.stringify({ ...buildSummary(), finishedAt: 'yesterday' })],
            ['a missing start', JSON.stringify({ ...buildSummary(), startedAt: undefined })],
            ['an interrupted flag that is not true', JSON.stringify({ ...buildSummary(), isInterrupted: false })],
            ['an alias with a bidi override', JSON.stringify({ ...buildSummary(), orgAlias: 'prod\u202Exobdnas' })]
        ])('refuses %s', (_label, summaryText) => {
            expect(DatasetInsertAttemptService.parseSummary(summaryText)).toBeUndefined();
        });

        test('keeps no inherited or extra member', () => {
            const parsedSummary = DatasetInsertAttemptService.parseSummary(JSON.stringify({ ...buildSummary(), __proto__: { polluted: true }, extra: 'x' }));
            expect(parsedSummary).toEqual(buildSummary());
            expect(parsedSummary).not.toHaveProperty('extra');
        });

    });

    describe('readLatestAttempt', () => {

        test('is undefined for a data set that was never inserted', () => {
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toBeUndefined();
        });

        test('is undefined for an InsertAttempts folder with no attempt in it', () => {
            fs.mkdirSync(path.join(datasetFolderPath, INSERT_ATTEMPTS_FOLDER_NAME, 'notAnAttempt'), { recursive: true });
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toBeUndefined();
        });

        test('reads the newest attempt, labelled by alias, with its results file', () => {
            writeAttempt('2026-10-25T09-00-00', JSON.stringify(buildSummary({ outcome: 'stopped', savedRecordCount: 0, failedRecordCount: 1 })));
            const resultsFilePath = writeAttempt('2026-10-26T10-00-00', JSON.stringify(buildSummary()));

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toEqual({
                lastInsert: { status: 'succeeded', attemptTimestamp: '2026-10-26T10-00-00', orgLabel: 'mySandbox', savedRecordCount: 3, failedRecordCount: 0 },
                resultsFilePath: resultsFilePath
            });
        });

        test('labels an attempt with no alias by its username, and one with neither by nothing', () => {
            const noAliasSummary = buildSummary();
            delete noAliasSummary.orgAlias;
            writeAttempt('2026-10-26T10-00-00', JSON.stringify(noAliasSummary));
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert.orgLabel).toBe('admin@example.com.sandbox');

            writeAttempt('2026-10-26T11-00-00', JSON.stringify({ ...noAliasSummary, orgUsername: null }));
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert).not.toHaveProperty('orgLabel');
        });

        test('an attempt with no summary is unknown and unrecorded, and its results file is never counted in its place', () => {
            const resultsFilePath = writeAttempt('2026-10-26T10-00-00', undefined, JSON.stringify({ SuccessResults: { Account: [{ id: '001' }] }, FailureResults: {} }));
            const openSpy = jest.spyOn(fs, 'openSync');
            const readFileSpy = jest.spyOn(fs, 'readFileSync');

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toEqual({
                lastInsert: { status: 'unknown', attemptTimestamp: '2026-10-26T10-00-00', isOutcomeUnrecorded: true },
                resultsFilePath: resultsFilePath
            });
            expect(openSpy.mock.calls.map(openCall => openCall[0])).not.toContain(resultsFilePath);
            expect(readFileSpy).not.toHaveBeenCalled();
        });

        test('an interrupted attempt says so', () => {
            writeAttempt('2026-10-26T10-00-00', JSON.stringify(buildSummary({ outcome: 'stopped', savedRecordCount: 2, failedRecordCount: 0, isInterrupted: true })));

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert).toEqual({
                status: 'partial', attemptTimestamp: '2026-10-26T10-00-00', orgLabel: 'mySandbox', savedRecordCount: 2, failedRecordCount: 0, isInterrupted: true
            });
        });

        test('a summary larger than any insert writes is unknown, not unrecorded', () => {
            writeAttempt('2026-10-26T10-00-00', JSON.stringify(buildSummary()) + ' '.repeat(70 * 1024));

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert).toEqual({ status: 'unknown', attemptTimestamp: '2026-10-26T10-00-00' });
        });

        test('an attempt whose summary is out of shape is unknown, never a success, and counts nothing', () => {
            writeAttempt('2026-10-26T10-00-00', JSON.stringify({ ...buildSummary(), outcome: 'succeeded' }), JSON.stringify({ SuccessResults: { Account: [{ id: '001' }] } }));

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert).toEqual({ status: 'unknown', attemptTimestamp: '2026-10-26T10-00-00' });
        });

        test('an attempt with no results file names no results file', () => {
            makeAttemptFolder('2026-10-26T10-00-00');

            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toEqual({
                lastInsert: { status: 'unknown', attemptTimestamp: '2026-10-26T10-00-00', isOutcomeUnrecorded: true }
            });
        });

        test('follows no link to a summary or a results file', () => {
            const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'insertAttemptOutside-'));
            try {
                const outsideSummaryPath = path.join(outsideFolderPath, 'summary.json');
                const outsideResultsPath = path.join(outsideFolderPath, 'results.json');
                fs.writeFileSync(outsideSummaryPath, JSON.stringify(buildSummary()));
                fs.writeFileSync(outsideResultsPath, '{}');
                const attemptFolderPath = makeAttemptFolder('2026-10-26T10-00-00');
                fs.symlinkSync(outsideSummaryPath, path.join(attemptFolderPath, DatasetInsertAttemptService.buildSummaryFileName('2026-10-26T10-00-00')));
                fs.symlinkSync(outsideResultsPath, path.join(attemptFolderPath, DatasetInsertAttemptService.buildResultsFileName('2026-10-26T10-00-00')));

                expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toEqual({
                    lastInsert: { status: 'unknown', attemptTimestamp: '2026-10-26T10-00-00' }
                });
            } finally {
                fs.rmSync(outsideFolderPath, { recursive: true, force: true });
            }
        });

        test('follows no linked InsertAttempts folder', () => {
            const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'insertAttemptOutside-'));
            try {
                fs.mkdirSync(path.join(outsideFolderPath, 'insertAttempt-2026-10-26T10-00-00'));
                fs.symlinkSync(outsideFolderPath, path.join(datasetFolderPath, INSERT_ATTEMPTS_FOLDER_NAME));
                expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath)).toBeUndefined();
            } finally {
                fs.rmSync(outsideFolderPath, { recursive: true, force: true });
            }
        });

    });

    describe('listAttemptTimestamps and readAttempt', () => {

        test('lists every attempt oldest first and reads each one\'s summary state and files', () => {

            const resultsFilePath = writeAttempt('2026-10-26T10-00-00', JSON.stringify(buildSummary()));
            writeAttempt('2026-10-25T09-00-00', undefined);
            writeAttempt('2026-10-27T09-00-00', '{"schemaVersion":1}');
            makeAttemptFolder('not-an-attempt');

            expect(DatasetInsertAttemptService.listAttemptTimestamps(datasetFolderPath)).toEqual(['2026-10-25T09-00-00', '2026-10-26T10-00-00', '2026-10-27T09-00-00']);

            const readAttempt = DatasetInsertAttemptService.readAttempt(datasetFolderPath, '2026-10-26T10-00-00');
            expect(readAttempt).toEqual({
                attemptTimestamp: '2026-10-26T10-00-00',
                summaryState: 'read',
                summary: buildSummary(),
                resultsFilePath: resultsFilePath,
                summaryFilePath: path.join(path.dirname(resultsFilePath), 'insertAttemptSummary-2026-10-26T10-00-00.json')
            });
            expect(DatasetInsertAttemptService.readAttempt(datasetFolderPath, '2026-10-25T09-00-00')).not.toHaveProperty('summaryFilePath');
            expect(DatasetInsertAttemptService.readAttempt(datasetFolderPath, '2026-10-25T09-00-00').summaryState).toBe('missing');
            expect(DatasetInsertAttemptService.readAttempt(datasetFolderPath, '2026-10-27T09-00-00').summaryState).toBe('unreadable');

        });

        test('lists nothing for a data set never inserted, or one whose InsertAttempts is a link', () => {

            expect(DatasetInsertAttemptService.listAttemptTimestamps(datasetFolderPath)).toEqual([]);

            const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'insertAttemptElsewhere-'));
            fs.mkdirSync(path.join(elsewhere, 'insertAttempt-2026-10-26T10-00-00'));
            fs.symlinkSync(elsewhere, path.join(datasetFolderPath, INSERT_ATTEMPTS_FOLDER_NAME));
            expect(DatasetInsertAttemptService.listAttemptTimestamps(datasetFolderPath)).toEqual([]);
            fs.rmSync(elsewhere, { recursive: true, force: true });

        });

        test('reads an attempt folder\'s UTC timestamp, and refuses one that is not a real time', () => {

            expect(DatasetInsertAttemptService.readAttemptTimestamp('2026-10-26T10-00-00')).toBe(Date.parse('2026-10-26T10:00:00Z'));
            expect(DatasetInsertAttemptService.readAttemptTimestamp('2026-02-30T10-00-00')).toBeUndefined();
            expect(DatasetInsertAttemptService.readAttemptTimestamp('2026-10-26T25-00-00')).toBeUndefined();
            expect(DatasetInsertAttemptService.readAttemptTimestamp('2026-10-26 10:00:00')).toBeUndefined();

        });

        test('readSmallFile reads a file up to the limit, and nothing past it or through a link', () => {

            const filePath = path.join(datasetFolderPath, 'small.json');
            fs.writeFileSync(filePath, '{"a":1}');
            fs.symlinkSync(filePath, path.join(datasetFolderPath, 'link.json'));

            expect(DatasetInsertAttemptService.readSmallFile(filePath, 7)).toBe('{"a":1}');
            expect(DatasetInsertAttemptService.readSmallFile(filePath, 6)).toBeUndefined();
            expect(DatasetInsertAttemptService.readSmallFile(path.join(datasetFolderPath, 'link.json'), 64)).toBeUndefined();
            expect(DatasetInsertAttemptService.readSmallFile(datasetFolderPath, 64)).toBeUndefined();

        });

    });

    describe('writeSummary', () => {

        test('writes the summary beside the results file, and readLatestAttempt reads it', () => {
            const resultsFilePath = writeAttempt('2026-10-26T10-00-00', undefined);

            expect(DatasetInsertAttemptService.writeSummary(resultsFilePath, buildSummary({ outcome: 'cancelled', isRolledBack: true }))).toBe(true);
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert.status).toBe('cancelled');
        });

        test('never replaces a summary already there', () => {
            const resultsFilePath = writeAttempt('2026-10-26T10-00-00', JSON.stringify(buildSummary()));

            expect(DatasetInsertAttemptService.writeSummary(resultsFilePath, buildSummary({ outcome: 'cancelled' }))).toBe(false);
            expect(DatasetInsertAttemptService.readLatestAttempt(datasetFolderPath).lastInsert.status).toBe('succeeded');
        });

        test('writes nothing beside a results file outside an attempt folder', () => {
            expect(DatasetInsertAttemptService.writeSummary(path.join(datasetFolderPath, 'results.json'), buildSummary())).toBe(false);
            expect(fs.readdirSync(datasetFolderPath)).toEqual([]);
        });

    });

});
