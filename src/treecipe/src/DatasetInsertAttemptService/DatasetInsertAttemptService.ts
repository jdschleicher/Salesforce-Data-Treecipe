import * as fs from 'fs';
import * as path from 'path';

// CollectionsApiService.insertAttemptsDirectoryName, REPEATED SO THIS SERVICE KEEPS IMPORTING ONLY fs AND path
export const INSERT_ATTEMPTS_FOLDER_NAME = 'InsertAttempts';

export const INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION = 1;

const INSERT_ATTEMPT_FOLDER_NAME_PATTERN = /^insertAttempt-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/;

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// A SUMMARY IS A FEW HUNDRED BYTES; ANYTHING FAR LARGER IS NOT ONE THIS EXTENSION WROTE
const MAXIMUM_SUMMARY_FILE_BYTES = 64 * 1024;

// THE ONE-LINE ORG NAME A SUMMARY CAN CARRY: AN ALIAS OR A USERNAME, NEVER A LINE BREAK, A CONTROL OR A BIDI CHARACTER (WHICH WOULD MAKE THE LABEL READ AS ANOTHER NAME)
const MAXIMUM_ORG_NAME_LENGTH = 255;

const DISALLOWED_ORG_NAME_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

export type InsertAttemptOutcome = 'completed' | 'cancelled' | 'stopped';

export type InsertAttemptStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unknown';

/*
    What one insert of a data set did, written beside its results file when the insert ends (#469).
    The results file alone cannot say it: a cancel and an all-or-none rollback leave the deleted
    records under SuccessResults, and it names no org.
*/
export interface IInsertAttemptSummary {
    schemaVersion: 1;
    outcome: InsertAttemptOutcome;
    isRolledBack: boolean;
    isAllOrNone: boolean;
    savedRecordCount: number;
    failedRecordCount: number;
    orgUsername: string | null;
    orgAlias?: string;
    startedAt: string;
    finishedAt: string;
    // THE INSERT THREW BEFORE IT ENDED -- A ROLLBACK THAT FAILED INCLUDED -- SO RECORDS IT SAVED MAY STILL BE IN THE ORG
    isInterrupted?: true;
}

/*
    The latest insert of a data set as its row draws it. orgLabel is the alias, else the username,
    and absent when the attempt names neither. The counts are absent when the summary could not be
    read: the results file is never counted in its place, since it cannot say what a cancel or a
    rollback deleted, and reading it per data set per model cost seconds.
*/
export interface IDatasetLastInsert {
    status: InsertAttemptStatus;
    attemptTimestamp: string;
    orgLabel?: string;
    savedRecordCount?: number;
    failedRecordCount?: number;
    isInterrupted?: true;
    // NO SUMMARY WAS WRITTEN: AN INSERT FROM BEFORE SUMMARIES, OR ONE THE HOST STOPPED BEFORE IT COULD WRITE ONE
    isOutcomeUnrecorded?: true;
}

export interface IDatasetLastInsertRead {
    lastInsert: IDatasetLastInsert;
    // THE RESULTS FILE OF THAT ATTEMPT, WHEN IT IS A FILE (NEVER A LINK); HOST-ONLY
    resultsFilePath?: string;
}

export class DatasetInsertAttemptService {

    static buildSummaryFileName(attemptTimestamp: string): string {

        return `insertAttemptSummary-${attemptTimestamp}.json`;

    }

    static buildResultsFileName(attemptTimestamp: string): string {

        return `insertAttemptResults-${attemptTimestamp}.json`;

    }

    static buildSummary(outcome: InsertAttemptOutcome,
                        isRolledBack: boolean,
                        isAllOrNone: boolean,
                        savedRecordCount: number,
                        failedRecordCount: number,
                        orgUsername: string | undefined,
                        orgAlias: string | undefined,
                        startedAt: Date,
                        finishedAt: Date,
                        isInterrupted = false): IInsertAttemptSummary {

        return {
            schemaVersion: INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION,
            outcome: outcome,
            isRolledBack: isRolledBack,
            isAllOrNone: isAllOrNone,
            savedRecordCount: savedRecordCount,
            failedRecordCount: failedRecordCount,
            orgUsername: this.isOrgName(orgUsername) ? orgUsername : null,
            ...( this.isOrgName(orgAlias) ? { orgAlias: orgAlias } : {} ),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            ...( isInterrupted ? { isInterrupted: true as const } : {} )
        };

    }

    /*
        Writes the summary beside the results file, in the attempt's own folder. Never throws and
        never replaces a file: an insert has already happened by now, and a summary that cannot be
        written only leaves the row "unknown".
    */
    static writeSummary(resultsFilePath: string, summary: IInsertAttemptSummary): boolean {

        const attemptFolderPath = path.dirname(resultsFilePath);
        const attemptMatch = INSERT_ATTEMPT_FOLDER_NAME_PATTERN.exec(path.basename(attemptFolderPath));

        if ( !attemptMatch ) {
            return false;
        }

        try {
            fs.writeFileSync(path.join(attemptFolderPath, this.buildSummaryFileName(attemptMatch[1])), JSON.stringify(summary, null, 2), { flag: 'wx' });
            return true;
        } catch {
            return false;
        }

    }

    /*
        How an attempt ended, from its summary. A rollback is a failure whatever was saved before it,
        and a stop that kept earlier files' records is partial.
    */
    static readStatus(summary: IInsertAttemptSummary): InsertAttemptStatus {

        // A ROLLBACK THAT THREW MAY HAVE LEFT RECORDS BEHIND, SO IT IS NEVER READ AS ONE THAT FINISHED
        if ( summary.isInterrupted === true ) {
            return summary.savedRecordCount > 0 ? 'partial' : 'failed';
        }

        if ( summary.outcome === 'cancelled' ) {
            return 'cancelled';
        }

        if ( summary.isRolledBack ) {
            return 'failed';
        }

        if ( summary.outcome === 'stopped' || summary.failedRecordCount > 0 ) {
            return summary.savedRecordCount > 0 ? 'partial' : 'failed';
        }

        return 'succeeded';

    }

    // THE FILE IS IN THE USER'S WORKSPACE: EVERY FIELD IS CHECKED, AND ANYTHING OUT OF SHAPE IS NOT A SUMMARY
    static parseSummary(summaryText: string): IInsertAttemptSummary | undefined {

        let parsedSummary: unknown;

        try {
            parsedSummary = JSON.parse(summaryText);
        } catch {
            return undefined;
        }

        if ( typeof parsedSummary !== 'object' || parsedSummary === null || Array.isArray(parsedSummary) ) {
            return undefined;
        }

        const candidate = parsedSummary as Record<string, unknown>;
        const isOutcome = candidate.outcome === 'completed' || candidate.outcome === 'cancelled' || candidate.outcome === 'stopped';
        const isUsername = candidate.orgUsername === null || this.isOrgName(candidate.orgUsername);
        const isAlias = !Object.prototype.hasOwnProperty.call(candidate, 'orgAlias') || this.isOrgName(candidate.orgAlias);
        const isInterruptedFlag = !Object.prototype.hasOwnProperty.call(candidate, 'isInterrupted') || candidate.isInterrupted === true;

        if ( candidate.schemaVersion !== INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION
                || !isOutcome
                || typeof candidate.isRolledBack !== 'boolean'
                || typeof candidate.isAllOrNone !== 'boolean'
                || !this.isRecordCount(candidate.savedRecordCount)
                || !this.isRecordCount(candidate.failedRecordCount)
                || !isUsername
                || !isAlias
                || !isInterruptedFlag
                || !this.isIsoInstant(candidate.startedAt)
                || !this.isIsoInstant(candidate.finishedAt) ) {
            return undefined;
        }

        return {
            schemaVersion: INSERT_ATTEMPT_SUMMARY_SCHEMA_VERSION,
            outcome: candidate.outcome as InsertAttemptOutcome,
            isRolledBack: candidate.isRolledBack as boolean,
            isAllOrNone: candidate.isAllOrNone as boolean,
            savedRecordCount: candidate.savedRecordCount as number,
            failedRecordCount: candidate.failedRecordCount as number,
            orgUsername: candidate.orgUsername as string | null,
            ...( typeof candidate.orgAlias === 'string' ? { orgAlias: candidate.orgAlias } : {} ),
            startedAt: candidate.startedAt as string,
            finishedAt: candidate.finishedAt as string,
            ...( candidate.isInterrupted === true ? { isInterrupted: true as const } : {} )
        };

    }

    /*
        The newest insert attempt of a data set folder, or undefined when it was never inserted. An
        attempt folder is newest by its timestamp, which sorts as text. No link is followed: a linked
        InsertAttempts folder, attempt folder or file reads as absent.
    */
    static readLatestAttempt(datasetFolderPath: string): IDatasetLastInsertRead | undefined {

        const insertAttemptsFolderPath = path.join(datasetFolderPath, INSERT_ATTEMPTS_FOLDER_NAME);

        if ( !this.isRealDirectory(insertAttemptsFolderPath) ) {
            return undefined;
        }

        let attemptEntries: fs.Dirent[];

        try {
            attemptEntries = fs.readdirSync(insertAttemptsFolderPath, { withFileTypes: true });
        } catch {
            return undefined;
        }

        const attemptTimestamps = attemptEntries
            .filter(attemptEntry => attemptEntry.isDirectory())
            .map(attemptEntry => INSERT_ATTEMPT_FOLDER_NAME_PATTERN.exec(attemptEntry.name)?.[1])
            .filter((attemptTimestamp): attemptTimestamp is string => attemptTimestamp !== undefined)
            .sort();

        if ( attemptTimestamps.length === 0 ) {
            return undefined;
        }

        const attemptTimestamp = attemptTimestamps[attemptTimestamps.length - 1];
        const attemptFolderPath = path.join(insertAttemptsFolderPath, `insertAttempt-${attemptTimestamp}`);
        const resultsFilePath = path.join(attemptFolderPath, this.buildResultsFileName(attemptTimestamp));
        const summaryFilePath = path.join(attemptFolderPath, this.buildSummaryFileName(attemptTimestamp));
        const summaryText = this.readSmallFile(summaryFilePath, MAXIMUM_SUMMARY_FILE_BYTES);
        const summary = summaryText === undefined ? undefined : this.parseSummary(summaryText);
        const resultsTarget = this.isRealFile(resultsFilePath) ? { resultsFilePath } : {};

        if ( summary ) {
            const orgLabel = summary.orgAlias ?? summary.orgUsername ?? undefined;
            return {
                lastInsert: {
                    status: this.readStatus(summary),
                    attemptTimestamp: attemptTimestamp,
                    ...( orgLabel !== undefined ? { orgLabel } : {} ),
                    savedRecordCount: summary.savedRecordCount,
                    failedRecordCount: summary.failedRecordCount,
                    ...( summary.isInterrupted === true ? { isInterrupted: true as const } : {} )
                },
                ...resultsTarget
            };
        }

        // NO SUMMARY AT ALL IS SAID SO; ONE THAT IS THERE AND UNREADABLE IS ONLY UNKNOWN
        const isOutcomeUnrecorded = summaryText === undefined && !this.pathExists(summaryFilePath);

        return {
            lastInsert: {
                status: 'unknown',
                attemptTimestamp: attemptTimestamp,
                ...( isOutcomeUnrecorded ? { isOutcomeUnrecorded: true as const } : {} )
            },
            ...resultsTarget
        };

    }

    static isOrgName(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAXIMUM_ORG_NAME_LENGTH && !DISALLOWED_ORG_NAME_CHARACTER_PATTERN.test(candidate);

    }

    static isRecordCount(candidate: unknown): candidate is number {

        return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;

    }

    static isIsoInstant(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && ISO_INSTANT_PATTERN.test(candidate) && !Number.isNaN(Date.parse(candidate));

    }

    static isRealDirectory(candidatePath: string): boolean {

        try {
            return fs.lstatSync(candidatePath).isDirectory();
        } catch {
            return false;
        }

    }

    static isRealFile(candidatePath: string): boolean {

        try {
            return fs.lstatSync(candidatePath).isFile();
        } catch {
            return false;
        }

    }

    static pathExists(candidatePath: string): boolean {

        try {
            fs.lstatSync(candidatePath);
            return true;
        } catch {
            return false;
        }

    }

    /*
        A file (never a link) no larger than the limit, else undefined. Opened ONCE with O_NOFOLLOW and
        checked and read through that handle, so a file swapped for a link, or grown past the limit,
        between a check and a read is never followed or read past it.
    */
    static readSmallFile(filePath: string, maximumBytes: number): string | undefined {

        let fileDescriptor: number | undefined;

        try {
            fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            const fileStats = fs.fstatSync(fileDescriptor);
            if ( !fileStats.isFile() || fileStats.size > maximumBytes ) {
                return undefined;
            }
            const fileBuffer = Buffer.alloc(maximumBytes + 1);
            const bytesRead = fs.readSync(fileDescriptor, fileBuffer, 0, maximumBytes + 1, 0);
            return bytesRead > maximumBytes ? undefined : fileBuffer.toString('utf8', 0, bytesRead);
        } catch {
            return undefined;
        } finally {
            if ( fileDescriptor !== undefined ) {
                fs.closeSync(fileDescriptor);
            }
        }

    }

}
