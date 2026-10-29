import * as fs from 'fs';
import * as path from 'path';

import { DatasetInsertAttemptService, IInsertAttemptRead } from '../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { DatasetSourceService } from '../DatasetSourceService/DatasetSourceService';
import { ALL_OR_NONE_ROLLED_BACK_STATUS_CODE } from './RecipeCockpitInsertFailureTriage';
import { IRecipeCockpitRunArtifactsLocation } from './RecipeCockpitRunArtifacts';
import { IRunHistoryRow, RecipeCockpitRunHistory, RunHistoryRowStatus, RunHistoryStep } from './RecipeCockpitRunHistory';

/*
    A data set's insert journey (#471): every insert attempt of the data set and every Troubleshooting
    step of its tree that falls between the data set being made and the end of its last attempt, oldest
    first. A step against another org than the attempts' is left off and counted, and a step file in the
    pre-#470 treecipe/OrgOperations folder, which records no tree, is only counted -- never guessed onto
    the timeline. Every file is the workspace's: summaries and results are parsed as untrusted, and one
    that does not read is an "unreadable" entry rather than a missing one. Imports no vscode.
*/

export const DATASET_JOURNEY_ENTRY_LIMIT = 200;

/*
    A results file holds every record's answer, and an excerpt parses the whole file on the extension
    host (a 20 MB file measured ~350 ms): past the per-file size it is not read, and one journey reads
    at most the budget in all, newest attempt first.
*/
export const DATASET_JOURNEY_RESULTS_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const DATASET_JOURNEY_RESULTS_READ_BUDGET_BYTES = 16 * 1024 * 1024;

// A STEP FILE NAMED IN LOCAL TIME IS LISTED THIS FAR EITHER SIDE OF THE WINDOW, SO A DAYLIGHT-SAVING HOUR CANNOT HIDE ONE; THE WINDOW ITSELF DECIDES
const STEP_LISTING_MARGIN_MILLISECONDS = 2 * 60 * 60 * 1000;

export const DATASET_JOURNEY_RESULTS_TOO_LARGE_NOTE = 'Its results file is too large to read for an error here; open it with View file.';
export const DATASET_JOURNEY_RESULTS_BUDGET_SPENT_NOTE = 'Its results file was not read for an error here, as later inserts used up what one journey reads; open it with View file.';

export type DatasetJourneyEntryKind = 'insert' | RunHistoryStep;

export interface IDatasetJourneyEntry {
    kind: DatasetJourneyEntryKind;
    status: RunHistoryRowStatus;
    timeMs: number;
    orgUsername?: string;
    orgAlias?: string;
    summaryText: string;
    errorExcerpt?: string;
    // HOST-ONLY
    filePaths: string[];
}

export interface IDatasetJourney {
    attemptCount: number;
    entries: IDatasetJourneyEntry[];
    // EARLIER ENTRIES PAST THE CAP; THE NEWEST ARE KEPT
    hiddenEntryCount: number;
    // TREE STEPS IN THE WINDOW AGAINST AN ORG NO ATTEMPT WENT TO
    otherOrgStepCount: number;
    // STEP FILES IN THE WINDOW UNDER treecipe/OrgOperations, WHICH NAME NO TREE
    untrackedStepCount: number;
}


export class RecipeCockpitDatasetJourney {

    /*
        The journey of the data set at datasetFolderPath. treeLocations are its tree folder's
        RunArtifacts in every run; legacyOrgOperationsFolderPath is <workspace>/treecipe/OrgOperations.
        A data set never inserted has no journey: no steps are listed for it.
    */
    static buildJourney(datasetFolderPath: string,
                        treeLocations: readonly IRecipeCockpitRunArtifactsLocation[],
                        legacyOrgOperationsFolderPath: string | undefined,
                        entryLimit: number = DATASET_JOURNEY_ENTRY_LIMIT): IDatasetJourney {

        const attempts = DatasetInsertAttemptService.listAttemptTimestamps(datasetFolderPath)
            .map(attemptTimestamp => ({ read: DatasetInsertAttemptService.readAttempt(datasetFolderPath, attemptTimestamp), timeMs: DatasetInsertAttemptService.readAttemptTimestamp(attemptTimestamp) }))
            .filter((attempt): attempt is { read: IInsertAttemptRead; timeMs: number } => attempt.timeMs !== undefined);

        if ( attempts.length === 0 ) {
            return { attemptCount: 0, entries: [], hiddenEntryCount: 0, otherOrgStepCount: 0, untrackedStepCount: 0 };
        }

        // AN EXCERPT IS READ ONLY FOR AN ENTRY THE CAP KEEPS, SO THE RESULTS FILE IS REMEMBERED BESIDE IT
        const excerptResultsFilePaths = new Map<IDatasetJourneyEntry, string>();
        const insertEntries = attempts.map(attempt => {
            const insertEntry = this.buildInsertEntry(attempt.read, attempt.timeMs);
            if ( insertEntry.status !== 'succeeded' && attempt.read.resultsFilePath !== undefined ) {
                excerptResultsFilePaths.set(insertEntry, attempt.read.resultsFilePath);
            }
            return insertEntry;
        });
        const lastAttempt = attempts[attempts.length - 1];
        const lastAttemptFinishedAt = lastAttempt.read.summary ? Date.parse(lastAttempt.read.summary.finishedAt) : lastAttempt.timeMs;
        const windowEndMs = Math.max(lastAttempt.timeMs, lastAttemptFinishedAt);
        const windowStartMs = Math.min(this.readDatasetCreatedAt(path.basename(datasetFolderPath)) ?? attempts[0].timeMs, attempts[0].timeMs);
        const isInWindow = (timeMs: number) => timeMs >= windowStartMs && timeMs <= windowEndMs;

        const attemptUsernames = new Set(attempts
            .map(attempt => attempt.read.summary?.orgUsername)
            .filter((orgUsername): orgUsername is string => typeof orgUsername === 'string')
            .map(orgUsername => orgUsername.toLowerCase()));
        // A STEP WITH NO ORG ON RECORD IS KEPT; WITH NO ATTEMPT NAMING AN ORG, NO STEP CAN BE TOLD APART
        const isAttemptOrg = (orgUsername: string | undefined) => attemptUsernames.size === 0 || orgUsername === undefined || attemptUsernames.has(orgUsername.toLowerCase());

        const stepRows = RecipeCockpitRunHistory.listTreeHistory(treeLocations, Number.MAX_SAFE_INTEGER, {
            startMs: windowStartMs - STEP_LISTING_MARGIN_MILLISECONDS,
            endMs: windowEndMs + STEP_LISTING_MARGIN_MILLISECONDS
        }).rows.filter(row => isInWindow(row.timeMs));
        const stepEntries = stepRows.filter(row => isAttemptOrg(row.orgUsername)).map(row => this.buildStepEntry(row));
        const otherOrgStepCount = stepRows.length - stepEntries.length;
        const untrackedStepCount = this.countUntrackedSteps(legacyOrgOperationsFolderPath, isInWindow, isAttemptOrg);

        // OLDEST FIRST; A STEP AND AN INSERT IN THE SAME SECOND READ STEP FIRST, AS A FIX IS MADE BEFORE THE INSERT IT IS FOR
        const entries = [...stepEntries, ...insertEntries]
            .map((entry, entryIndex) => ({ entry, entryIndex }))
            .sort((first, second) => first.entry.timeMs - second.entry.timeMs
                || ( first.entry.kind === 'insert' ? 1 : 0 ) - ( second.entry.kind === 'insert' ? 1 : 0 )
                || first.entryIndex - second.entryIndex)
            .map(sortedEntry => sortedEntry.entry);
        const keptCount = Math.max(0, Math.min(entries.length, entryLimit));
        const keptEntries = entries.slice(entries.length - keptCount);

        this.attachResultsExcerpts([...keptEntries].reverse(), excerptResultsFilePaths);

        return {
            attemptCount: attempts.length,
            entries: keptEntries,
            hiddenEntryCount: entries.length - keptCount,
            otherOrgStepCount: otherOrgStepCount,
            untrackedStepCount: untrackedStepCount
        };

    }

    // WHEN THE DATA SET WAS MADE, FROM ITS FOLDER NAME'S UTC TIMESTAMP; undefined FOR A NAME THAT CARRIES NONE
    static readDatasetCreatedAt(datasetFolderName: string): number | undefined {

        const folderNameDetail = DatasetSourceService.parseDatasetFolderName(datasetFolderName);
        return folderNameDetail ? DatasetInsertAttemptService.readAttemptTimestamp(folderNameDetail.timestamp) : undefined;

    }

    static buildInsertEntry(attempt: IInsertAttemptRead, timeMs: number): IDatasetJourneyEntry {

        const filePaths = [attempt.resultsFilePath, attempt.summaryFilePath].filter((filePath): filePath is string => filePath !== undefined);
        const summary = attempt.summary;

        if ( !summary ) {
            return {
                kind: 'insert',
                status: attempt.summaryState === 'missing' ? 'unrecorded' : 'unreadable',
                timeMs: timeMs,
                summaryText: attempt.summaryState === 'missing'
                    ? 'No outcome was saved for this insert.'
                    : 'Its summary file could not be read, so how it ended is not shown.',
                filePaths: filePaths
            };
        }

        const status = DatasetInsertAttemptService.readStatus(summary);
        const summaryParts = [
            this.pluralize(summary.savedRecordCount, 'record saved', 'records saved'),
            this.pluralize(summary.failedRecordCount, 'record failed', 'records failed'),
            ...( summary.isAllOrNone ? ['all-or-none'] : [] ),
            ...( summary.isRolledBack ? ['rolled back'] : [] ),
            ...( summary.outcome === 'cancelled' ? ['cancelled'] : summary.outcome === 'stopped' ? ['stopped'] : [] ),
            ...( summary.isInterrupted === true ? ['stopped on an error before it ended'] : [] )
        ];

        return {
            kind: 'insert',
            status: status,
            timeMs: timeMs,
            ...( summary.orgUsername !== null ? { orgUsername: summary.orgUsername } : {} ),
            ...( summary.orgAlias !== undefined ? { orgAlias: summary.orgAlias } : {} ),
            summaryText: summaryParts.join(' · '),
            filePaths: filePaths
        };

    }

    // A STEP'S DETAIL IS ITS ERROR WHEN IT DID NOT SUCCEED (THE FAILED COMPONENTS OF A DEPLOY, THE FAILED PICKS OF AN ASSIGN), ELSE PART OF ITS SUMMARY
    static buildStepEntry(row: IRunHistoryRow): IDatasetJourneyEntry {

        const countParts = [
            ...( row.succeededCount !== undefined ? [`${row.succeededCount} succeeded`] : [] ),
            ...( row.failedCount !== undefined ? [`${row.failedCount} failed`] : [] )
        ];
        const statusText = row.status === 'unrecorded'
            ? 'Ran before Treecipe recorded how a step ended.'
            : row.status === 'unreadable' ? 'Its summary file could not be read, so how it ended is not shown.' : '';
        const summaryText = [
            ...countParts,
            ...( row.status === 'succeeded' && row.detail ? [row.detail] : [] ),
            ...( statusText ? [statusText] : [] )
        ].join(' · ');

        return {
            kind: row.step,
            status: row.status,
            timeMs: row.timeMs,
            ...( row.orgUsername !== undefined ? { orgUsername: row.orgUsername } : {} ),
            ...( row.orgAlias !== undefined ? { orgAlias: row.orgAlias } : {} ),
            summaryText: RecipeCockpitRunHistory.toDetail(summaryText),
            ...( row.status !== 'succeeded' && row.detail ? { errorExcerpt: RecipeCockpitRunHistory.toDetail(row.detail) } : {} ),
            filePaths: [...row.filePaths]
        };

    }

    /*
        The first error of a results file's failed records, across its objects in order, that is not
        an all-or-none rollback answer; else the first error. Every part is type-checked: a file out
        of shape says it is unreadable, and one with no failed record has no excerpt.
    */
    static readResultsExcerpt(resultsFilePath: string): { errorExcerpt?: string } {

        const unreadable = { errorExcerpt: `The results file ${path.basename(resultsFilePath)} is unreadable, so no error is shown.` };
        const resultsText = DatasetInsertAttemptService.readSmallFile(resultsFilePath, DATASET_JOURNEY_RESULTS_FILE_MAX_BYTES);
        let parsedResults: unknown;

        if ( resultsText === undefined ) {
            return unreadable;
        }

        try {
            parsedResults = JSON.parse(resultsText);
        } catch {
            return unreadable;
        }

        const failureResults = ( parsedResults as Record<string, unknown> | null )?.FailureResults;

        if ( !this.isPlainRecord(failureResults) || !Object.values(failureResults).every(recordResults => Array.isArray(recordResults)) ) {
            return unreadable;
        }

        const firstErrors = Object.entries(failureResults).flatMap(([objectApiName, recordResults]) => ( recordResults as unknown[] )
            .map(recordResult => this.readFirstRecordError(recordResult))
            .filter((recordError): recordError is { statusCode: string; message?: string; fields: string[] } => recordError !== undefined)
            .map(recordError => ({ objectApiName, ...recordError })));
        const firstError = firstErrors.find(recordError => recordError.statusCode !== ALL_OR_NONE_ROLLED_BACK_STATUS_CODE) ?? firstErrors[0];

        if ( !firstError ) {
            return {};
        }

        const fieldsText = firstError.fields.length > 0 ? ` [${firstError.fields.join(', ')}]` : '';
        const messageText = firstError.message ? ` — ${firstError.message}` : '';

        return { errorExcerpt: RecipeCockpitRunHistory.toDetail(`${firstError.objectApiName}: ${firstError.statusCode}${fieldsText}${messageText}`) };

    }

    /*
        Each kept insert entry that did not succeed gets its results file's excerpt, newest first,
        while the journey's read budget lasts; a file past the per-file size, or past what is left of
        the budget, is not read and says so.
    */
    private static attachResultsExcerpts(entriesNewestFirst: readonly IDatasetJourneyEntry[], excerptResultsFilePaths: ReadonlyMap<IDatasetJourneyEntry, string>) {

        let remainingBytes = DATASET_JOURNEY_RESULTS_READ_BUDGET_BYTES;

        entriesNewestFirst.forEach(entry => {

            const resultsFilePath = excerptResultsFilePaths.get(entry);
            if ( resultsFilePath === undefined ) {
                return;
            }

            const fileSize = this.readFileSize(resultsFilePath);
            if ( fileSize !== undefined && fileSize > DATASET_JOURNEY_RESULTS_FILE_MAX_BYTES ) {
                entry.errorExcerpt = DATASET_JOURNEY_RESULTS_TOO_LARGE_NOTE;
                return;
            }
            if ( fileSize !== undefined && fileSize > remainingBytes ) {
                entry.errorExcerpt = DATASET_JOURNEY_RESULTS_BUDGET_SPENT_NOTE;
                return;
            }

            remainingBytes -= fileSize ?? 0;
            const results = this.readResultsExcerpt(resultsFilePath);
            if ( results.errorExcerpt !== undefined ) {
                entry.errorExcerpt = results.errorExcerpt;
            }

        });

    }

    private static readFileSize(filePath: string): number | undefined {

        try {
            return fs.lstatSync(filePath).size;
        } catch {
            return undefined;
        }

    }

    private static readFirstRecordError(recordResult: unknown): { statusCode: string; message?: string; fields: string[] } | undefined {

        const resultErrors = this.isPlainRecord(recordResult) ? recordResult.errors : undefined;

        if ( !Array.isArray(resultErrors) ) {
            return undefined;
        }

        const recordErrors = resultErrors
            .filter((resultError): resultError is Record<string, unknown> => this.isPlainRecord(resultError) && typeof resultError.statusCode === 'string' && resultError.statusCode !== '')
            .map(resultError => ({
                statusCode: resultError.statusCode as string,
                ...( typeof resultError.message === 'string' && resultError.message !== '' ? { message: resultError.message } : {} ),
                fields: Array.isArray(resultError.fields) ? resultError.fields.filter((fieldApiName): fieldApiName is string => typeof fieldApiName === 'string') : []
            }));

        return recordErrors.find(recordError => recordError.statusCode !== ALL_OR_NONE_ROLLED_BACK_STATUS_CODE) ?? recordErrors[0];

    }

    /*
        Step result files in the pre-#470 treecipe/OrgOperations/<username>/ folders that fall in the
        window and went to an org of the attempts. They name no tree, so another tree's steps look the
        same: they are counted, never listed. A link is followed at no level.
    */
    private static countUntrackedSteps(legacyOrgOperationsFolderPath: string | undefined,
                                        isInWindow: (timeMs: number) => boolean,
                                        isAttemptOrg: (orgUsername: string | undefined) => boolean): number {

        if ( legacyOrgOperationsFolderPath === undefined ) {
            return 0;
        }

        return this.listRealEntries(legacyOrgOperationsFolderPath)
            .filter(entry => entry.isDirectory() && isAttemptOrg(entry.name))
            .reduce((stepCount, entry) => stepCount + this.listRealEntries(path.join(legacyOrgOperationsFolderPath, entry.name))
                .filter(fileEntry => {
                    const runFileName = fileEntry.isFile() ? RecipeCockpitRunHistory.parseRunFileName(fileEntry.name) : undefined;
                    const timeMs = runFileName?.kind === 'result' ? RecipeCockpitRunHistory.readCompactTimestamp(runFileName.timestamp) : undefined;
                    return timeMs !== undefined && isInWindow(timeMs);
                }).length, 0);

    }

    private static listRealEntries(folderPath: string): fs.Dirent[] {

        if ( !DatasetInsertAttemptService.isRealDirectory(folderPath) ) {
            return [];
        }

        try {
            return fs.readdirSync(folderPath, { withFileTypes: true });
        } catch {
            return [];
        }

    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {

        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);

    }

    private static pluralize(count: number, singular: string, plural: string): string {

        return `${count} ${count === 1 ? singular : plural}`;

    }

}
