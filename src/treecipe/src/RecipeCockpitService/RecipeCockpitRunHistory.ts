import * as fs from 'fs';
import * as path from 'path';

import { DatasetInsertAttemptService } from '../DatasetInsertAttemptService/DatasetInsertAttemptService';
import { IRecipeCockpitRunArtifactsLocation, RecipeCockpitRunArtifacts } from './RecipeCockpitRunArtifacts';

/*
    The Troubleshooting tab's History (#485): every Troubleshooting step taken for a tree, read from
    the files #470 keeps in each run's RunArtifacts folder. A step that ran writes one summary,
    <yyyyMMdd-HHmmss>-<step>-summary.json, beside its other files, saying how it ended; a step from
    before summaries is listed from its own files with its outcome "not recorded". Every file is
    the workspace's, so a summary is parsed as untrusted and no link is followed. Imports no vscode.
*/

export const RUN_HISTORY_SUMMARY_SCHEMA_VERSION = 1;

// THE TROUBLESHOOTING STEPS, BY THE OPERATION NAME EACH ONE'S FILES CARRY (ScratchOrgService.OrgOperationName, AND GENERATE PERMISSION SET'S RECORD)
export const RUN_HISTORY_STEPS = [
    'field-deploy',
    'record-type-deploy',
    'global-value-set-deploy',
    'permission-set-deploy',
    'field-retrieve',
    'validation-rule-retrieve',
    'record-type-retrieve',
    'global-value-set-retrieve',
    'permission-set-assign',
    'permission-set-generate'
] as const;

export type RunHistoryStep = typeof RUN_HISTORY_STEPS[number];

export const RUN_HISTORY_STEP_LABELS: Readonly<Record<RunHistoryStep, string>> = Object.freeze({
    'field-deploy': 'Deploy fields',
    'record-type-deploy': 'Deploy record types',
    'global-value-set-deploy': 'Deploy global value sets',
    'permission-set-deploy': 'Deploy permission set',
    'field-retrieve': 'Retrieve fields',
    'validation-rule-retrieve': 'Retrieve validation rules',
    'record-type-retrieve': 'Retrieve record types',
    'global-value-set-retrieve': 'Retrieve global value sets',
    'permission-set-assign': 'Assign permission sets',
    'permission-set-generate': 'Generate permission set'
});

// unknown: THE CLI RAN AND ITS ANSWER COULD NOT SAY WHETHER THE STEP LANDED
export type RunHistoryOutcome = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unknown';

const RUN_HISTORY_OUTCOMES: readonly RunHistoryOutcome[] = ['succeeded', 'partial', 'failed', 'cancelled', 'unknown'];

// A ROW'S STATUS: HOW THE STEP ENDED, OR WHY THAT IS NOT KNOWN
export type RunHistoryRowStatus = RunHistoryOutcome | 'unreadable' | 'unrecorded';

export const RUN_HISTORY_ROW_LIMIT = 500;

export const RUN_HISTORY_DETAIL_MAX_LENGTH = 300;

// A SUMMARY IS A FEW HUNDRED BYTES; ANYTHING FAR LARGER IS NOT ONE THIS EXTENSION WROTE
const MAXIMUM_SUMMARY_FILE_BYTES = 64 * 1024;

const MAXIMUM_SUMMARY_FILE_NAMES = 20;

const SUMMARY_FILE_ATTEMPTS = 10;

const STEP_PATTERN_SOURCE = RUN_HISTORY_STEPS.map(step => step.replace(/-/g, '\\-')).join('|');

const DUPLICATE_SUFFIX_SOURCE = '(?:-(?:[2-9]|[1-9]\\d+))';

/*
    <ts>-<step>[-<n>].json            a CLI's result, or Generate permission set's record
    <ts>-<step>[-<n>]-package.xml     a deploy's or retrieve's manifest
    <ts>-<step>-summary[-<n>].json    the step's summary
*/
const RUN_FILE_NAME_PATTERN = new RegExp(`^(\\d{8}-\\d{6})-(${STEP_PATTERN_SOURCE})${DUPLICATE_SUFFIX_SOURCE}?(?:(-summary${DUPLICATE_SUFFIX_SOURCE}?\\.json)|(-package\\.xml)|(\\.json))$`);

const COMPACT_TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/*
    What one step did, written when it ends. The file names are the step's own files in the same
    folder, so its row claims them; counts are what the step reports in its own unit (components,
    files, permission sets).
*/
export interface IRunHistorySummary {
    schemaVersion: 1;
    step: RunHistoryStep;
    outcome: RunHistoryOutcome;
    orgUsername: string | null;
    orgAlias?: string;
    startedAt: string;
    finishedAt: string;
    succeededCount?: number;
    failedCount?: number;
    detail?: string;
    fileNames: string[];
}

export interface IRunHistoryStepRecord {
    step: RunHistoryStep;
    outcome: RunHistoryOutcome;
    orgUsername?: string;
    orgAlias?: string;
    startedAt: Date;
    finishedAt: Date;
    succeededCount?: number;
    failedCount?: number;
    detail?: string;
    filePaths: Array<string | undefined>;
}

/*
    One row of a tree's History. timeMs is when the step started, from its file name, so a row sorts
    without its summary read; the file paths are HOST-ONLY. runFolderName names the run whose
    RunArtifacts held it.
*/
export interface IRunHistoryRow {
    step: RunHistoryStep;
    status: RunHistoryRowStatus;
    timeMs: number;
    runFolderName: string;
    orgUsername?: string;
    orgAlias?: string;
    finishedAtMs?: number;
    succeededCount?: number;
    failedCount?: number;
    detail?: string;
    filePaths: string[];
}

export interface IRunHistoryListing {
    rows: IRunHistoryRow[];
    hiddenRowCount: number;
}

interface IRunFileName {
    timestamp: string;
    step: RunHistoryStep;
    kind: 'summary' | 'package' | 'result';
}

interface IRowCandidate {
    step: RunHistoryStep;
    timestamp: string;
    timeMs: number;
    runFolderName: string;
    folderPath: string;
    folderOrgUsername?: string;
    summaryFileName?: string;
    fileNames: string[];
}

export class RecipeCockpitRunHistory {

    static isRunHistoryStep(candidate: unknown): candidate is RunHistoryStep {

        return typeof candidate === 'string' && ( RUN_HISTORY_STEPS as readonly string[] ).includes(candidate);

    }

    // THE FOLDER A STEP'S FILES ARE IN: OrgOperations/<username> FOR A STEP AGAINST AN ORG, PermissionSets FOR GENERATE
    static buildStepFolderPath(location: IRecipeCockpitRunArtifactsLocation, step: RunHistoryStep, orgUsername: string | undefined): string | undefined {

        if ( step === 'permission-set-generate' ) {
            return RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'PermissionSets');
        }

        return RecipeCockpitRunArtifacts.isPlainFolderName(orgUsername)
            ? path.join(RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'OrgOperations'), orgUsername)
            : undefined;

    }

    static buildSummary(record: IRunHistoryStepRecord, folderPath: string): IRunHistorySummary {

        const fileNames = record.filePaths
            .filter((filePath): filePath is string => typeof filePath === 'string' && path.dirname(filePath) === folderPath)
            .map(filePath => path.basename(filePath));
        const detail = record.detail ? this.toDetail(record.detail) : '';

        return {
            schemaVersion: RUN_HISTORY_SUMMARY_SCHEMA_VERSION,
            step: record.step,
            outcome: record.outcome,
            orgUsername: DatasetInsertAttemptService.isOrgName(record.orgUsername) ? record.orgUsername : null,
            ...( DatasetInsertAttemptService.isOrgName(record.orgAlias) ? { orgAlias: record.orgAlias } : {} ),
            startedAt: record.startedAt.toISOString(),
            finishedAt: record.finishedAt.toISOString(),
            ...( DatasetInsertAttemptService.isRecordCount(record.succeededCount) ? { succeededCount: record.succeededCount } : {} ),
            ...( DatasetInsertAttemptService.isRecordCount(record.failedCount) ? { failedCount: record.failedCount } : {} ),
            ...( detail ? { detail: detail } : {} ),
            fileNames: [...new Set(fileNames)].slice(0, MAXIMUM_SUMMARY_FILE_NAMES)
        };

    }

    /*
        Writes the step's summary beside its files and answers where, or undefined. Never throws and
        never replaces a file ("wx"): the step has already happened, and a summary that cannot be
        written only leaves its row "not recorded".
    */
    static writeSummary(location: IRecipeCockpitRunArtifactsLocation, record: IRunHistoryStepRecord): string | undefined {

        try {

            const folderPath = this.buildStepFolderPath(location, record.step, record.orgUsername);

            if ( !folderPath || !RecipeCockpitRunArtifacts.makeFolder(location, folderPath) ) {
                return undefined;
            }

            const summary = this.buildSummary(record, folderPath);

            return RecipeCockpitRunArtifacts.writeNewFile(
                path.join(folderPath, `${this.buildCompactTimestamp(record.startedAt)}-${record.step}-summary.json`),
                `${JSON.stringify(summary, null, 2)}\n`,
                '.json',
                SUMMARY_FILE_ATTEMPTS
            );

        } catch {
            return undefined;
        }

    }

    // THE FILE IS IN THE USER'S WORKSPACE: EVERY FIELD IS CHECKED, AND ANYTHING OUT OF SHAPE IS NOT A SUMMARY
    static parseSummary(summaryText: string): IRunHistorySummary | undefined {

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
        const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(candidate, key);
        const isOptionalCount = (key: string) => !hasOwn(key) || DatasetInsertAttemptService.isRecordCount(candidate[key]);
        const fileNames = candidate.fileNames;

        if ( candidate.schemaVersion !== RUN_HISTORY_SUMMARY_SCHEMA_VERSION
                || !this.isRunHistoryStep(candidate.step)
                || !( RUN_HISTORY_OUTCOMES as readonly unknown[] ).includes(candidate.outcome)
                || !( candidate.orgUsername === null || DatasetInsertAttemptService.isOrgName(candidate.orgUsername) )
                || ( hasOwn('orgAlias') && !DatasetInsertAttemptService.isOrgName(candidate.orgAlias) )
                || !DatasetInsertAttemptService.isIsoInstant(candidate.startedAt)
                || !DatasetInsertAttemptService.isIsoInstant(candidate.finishedAt)
                || !isOptionalCount('succeededCount')
                || !isOptionalCount('failedCount')
                || ( hasOwn('detail') && !this.isDetail(candidate.detail) )
                || !Array.isArray(fileNames)
                || fileNames.length > MAXIMUM_SUMMARY_FILE_NAMES
                || !fileNames.every(fileName => this.isOwnFileName(fileName)) ) {
            return undefined;
        }

        return {
            schemaVersion: RUN_HISTORY_SUMMARY_SCHEMA_VERSION,
            step: candidate.step as RunHistoryStep,
            outcome: candidate.outcome as RunHistoryOutcome,
            orgUsername: candidate.orgUsername as string | null,
            ...( typeof candidate.orgAlias === 'string' ? { orgAlias: candidate.orgAlias } : {} ),
            startedAt: candidate.startedAt as string,
            finishedAt: candidate.finishedAt as string,
            ...( typeof candidate.succeededCount === 'number' ? { succeededCount: candidate.succeededCount } : {} ),
            ...( typeof candidate.failedCount === 'number' ? { failedCount: candidate.failedCount } : {} ),
            ...( typeof candidate.detail === 'string' ? { detail: candidate.detail } : {} ),
            fileNames: [...fileNames as string[]]
        };

    }

    static parseRunFileName(fileName: string): IRunFileName | undefined {

        const fileNameMatch = RUN_FILE_NAME_PATTERN.exec(fileName);

        if ( !fileNameMatch || this.readCompactTimestamp(fileNameMatch[1]) === undefined ) {
            return undefined;
        }

        return {
            timestamp: fileNameMatch[1],
            step: fileNameMatch[2] as RunHistoryStep,
            kind: fileNameMatch[3] ? 'summary' : fileNameMatch[4] ? 'package' : 'result'
        };

    }

    /*
        Every step of a tree, newest first, from each location's RunArtifacts in the order given (the
        run on screen first), at most rowLimit with the rest counted. Rows are placed by their file
        names; only the summaries of the rows kept are read.
    */
    static listTreeHistory(locations: readonly IRecipeCockpitRunArtifactsLocation[], rowLimit: number = RUN_HISTORY_ROW_LIMIT): IRunHistoryListing {

        const candidates: IRowCandidate[] = [];
        const seenFolderPaths = new Set<string>();

        locations.forEach(location => {

            if ( seenFolderPaths.has(location.folderPath) || !DatasetInsertAttemptService.isRealDirectory(location.folderPath) ) {
                return;
            }
            seenFolderPaths.add(location.folderPath);

            const runFolderName = path.basename(path.dirname(location.treeFolderPath));
            const orgOperationsFolderPath = RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'OrgOperations');

            this.listRealEntries(orgOperationsFolderPath)
                .filter(entry => entry.isDirectory())
                .forEach(entry => candidates.push(...this.collectFolderCandidates(path.join(orgOperationsFolderPath, entry.name), runFolderName, entry.name)));

            candidates.push(...this.collectFolderCandidates(RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'PermissionSets'), runFolderName, undefined));

        });

        candidates.sort((first, second) => second.timeMs - first.timeMs);

        return {
            rows: candidates.slice(0, Math.max(0, rowLimit)).map(candidate => this.readRow(candidate)),
            hiddenRowCount: Math.max(0, candidates.length - Math.max(0, rowLimit))
        };

    }

    static buildCompactTimestamp(date: Date): string {

        const twoDigits = (value: number) => String(value).padStart(2, '0');

        return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`;

    }

    // "2026-10-28 10:15:30", IN LOCAL TIME AS THE FILE NAMES ARE WRITTEN
    static formatTimeLabel(timeMs: number): string {

        const date = new Date(timeMs);
        const twoDigits = (value: number) => String(value).padStart(2, '0');

        return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;

    }

    // THE LOCAL TIME A COMPACT TIMESTAMP NAMES, OR undefined FOR ONE THAT IS NOT A REAL DATE
    static readCompactTimestamp(timestamp: string): number | undefined {

        const timestampMatch = COMPACT_TIMESTAMP_PATTERN.exec(timestamp);

        if ( !timestampMatch ) {
            return undefined;
        }

        const [year, month, day, hours, minutes, seconds] = timestampMatch.slice(1).map(Number);
        const date = new Date(year, month - 1, day, hours, minutes, seconds);

        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
                && date.getHours() === hours && date.getMinutes() === minutes && date.getSeconds() === seconds
            ? date.getTime()
            : undefined;

    }

    /*
        One folder's rows. A summary claims the files it names. Of the rest, each result file is a
        row "not recorded", and a manifest joins the first unclaimed result of its step at or after
        it (a deploy writes its package.xml just before the CLI runs), else is a row of its own.
    */
    private static collectFolderCandidates(folderPath: string, runFolderName: string, folderOrgUsername: string | undefined): IRowCandidate[] {

        const parsedFiles = this.listRealEntries(folderPath)
            .filter(entry => entry.isFile())
            .map(entry => ({ fileName: entry.name, parsed: this.parseRunFileName(entry.name) }))
            .filter((file): file is { fileName: string; parsed: IRunFileName } => file.parsed !== undefined)
            .sort((first, second) => first.fileName < second.fileName ? -1 : first.fileName > second.fileName ? 1 : 0);

        const candidates: IRowCandidate[] = [];
        const claimedFileNames = new Set<string>();
        const buildCandidate = (file: { fileName: string; parsed: IRunFileName }): IRowCandidate => ({
            step: file.parsed.step,
            timestamp: file.parsed.timestamp,
            timeMs: this.readCompactTimestamp(file.parsed.timestamp) as number,
            runFolderName: runFolderName,
            folderPath: folderPath,
            ...( folderOrgUsername !== undefined ? { folderOrgUsername: folderOrgUsername } : {} ),
            fileNames: []
        });

        parsedFiles.filter(file => file.parsed.kind === 'summary').forEach(file => {
            const candidate = buildCandidate(file);
            candidate.summaryFileName = file.fileName;
            claimedFileNames.add(file.fileName);
            candidates.push(candidate);
        });

        // A SUMMARY NAMES ITS OWN FILES, READ HERE ONLY FOR THE NAMES IT CLAIMS; THE ROW READS IT AGAIN, CHECKED, IF IT IS KEPT
        candidates.forEach(candidate => {
            const summary = this.readSummaryFile(path.join(folderPath, candidate.summaryFileName as string));
            ( summary?.fileNames ?? [] ).forEach(fileName => {
                if ( !claimedFileNames.has(fileName) && parsedFiles.some(file => file.fileName === fileName) ) {
                    claimedFileNames.add(fileName);
                }
            });
        });

        const unclaimedResults = parsedFiles.filter(file => file.parsed.kind === 'result' && !claimedFileNames.has(file.fileName));
        const resultCandidates = unclaimedResults.map(file => {
            const candidate = buildCandidate(file);
            candidate.fileNames.push(file.fileName);
            return { file: file, candidate: candidate, hasManifest: false };
        });

        parsedFiles.filter(file => file.parsed.kind === 'package' && !claimedFileNames.has(file.fileName)).forEach(file => {
            const joined = resultCandidates.find(resultCandidate => !resultCandidate.hasManifest
                && resultCandidate.file.parsed.step === file.parsed.step
                && resultCandidate.file.parsed.timestamp >= file.parsed.timestamp);
            if ( joined ) {
                joined.hasManifest = true;
                joined.candidate.fileNames.unshift(file.fileName);
            } else {
                const candidate = buildCandidate(file);
                candidate.fileNames.push(file.fileName);
                candidates.push(candidate);
            }
        });

        candidates.push(...resultCandidates.map(resultCandidate => resultCandidate.candidate));

        return candidates;

    }

    private static readRow(candidate: IRowCandidate): IRunHistoryRow {

        const toPaths = (fileNames: string[]) => fileNames
            .map(fileName => path.join(candidate.folderPath, fileName))
            .filter(filePath => DatasetInsertAttemptService.isRealFile(filePath));

        const folderOrg = candidate.folderOrgUsername !== undefined && DatasetInsertAttemptService.isOrgName(candidate.folderOrgUsername)
            ? { orgUsername: candidate.folderOrgUsername }
            : {};

        if ( !candidate.summaryFileName ) {
            return {
                step: candidate.step,
                status: 'unrecorded',
                timeMs: candidate.timeMs,
                runFolderName: candidate.runFolderName,
                ...folderOrg,
                filePaths: toPaths(candidate.fileNames)
            };
        }

        const summaryFilePath = path.join(candidate.folderPath, candidate.summaryFileName);
        const summary = this.readSummaryFile(summaryFilePath);

        // A SUMMARY OUT OF SHAPE, OR ONE FOR ANOTHER STEP THAN ITS NAME SAYS, IS A ROW -- NEVER LEFT OUT, NEVER BELIEVED
        if ( !summary || summary.step !== candidate.step ) {
            return {
                step: candidate.step,
                status: 'unreadable',
                timeMs: candidate.timeMs,
                runFolderName: candidate.runFolderName,
                ...folderOrg,
                filePaths: toPaths([candidate.summaryFileName])
            };
        }

        return {
            step: candidate.step,
            status: summary.outcome,
            timeMs: candidate.timeMs,
            runFolderName: candidate.runFolderName,
            ...( summary.orgUsername !== null ? { orgUsername: summary.orgUsername } : folderOrg ),
            ...( summary.orgAlias !== undefined ? { orgAlias: summary.orgAlias } : {} ),
            finishedAtMs: Date.parse(summary.finishedAt),
            ...( summary.succeededCount !== undefined ? { succeededCount: summary.succeededCount } : {} ),
            ...( summary.failedCount !== undefined ? { failedCount: summary.failedCount } : {} ),
            ...( summary.detail !== undefined ? { detail: summary.detail } : {} ),
            filePaths: toPaths(summary.fileNames)
        };

    }

    private static readSummaryFile(summaryFilePath: string): IRunHistorySummary | undefined {

        const summaryText = DatasetInsertAttemptService.readSmallFile(summaryFilePath, MAXIMUM_SUMMARY_FILE_BYTES);
        return summaryText === undefined ? undefined : this.parseSummary(summaryText);

    }

    // A FOLDER'S ENTRIES, NONE IF IT IS NOT A REAL FOLDER; A LINK IS NEITHER A FILE NOR A FOLDER TO A Dirent
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

    // A FILE NAME THE SUMMARY'S OWN FOLDER HOLDS: ONE OF THE STEP FILE NAMES, NEVER A PATH
    private static isOwnFileName(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && RecipeCockpitRunArtifacts.isPlainFolderName(candidate) && this.parseRunFileName(candidate) !== undefined;

    }

    // ONE LINE, NO CONTROL OR BIDI CHARACTER, CUT TO A FIXED LENGTH
    private static isDetail(candidate: unknown): candidate is string {

        return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= RUN_HISTORY_DETAIL_MAX_LENGTH && this.toDetail(candidate) === candidate;

    }

    private static toDetail(text: string): string {

        const singleLine = String(text)
            .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
            .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
            .replace(/ {2,}/g, ' ')
            .trim();

        return singleLine.length > RUN_HISTORY_DETAIL_MAX_LENGTH
            ? `${singleLine.slice(0, RUN_HISTORY_DETAIL_MAX_LENGTH - 1)}…`
            : singleLine;

    }

}
