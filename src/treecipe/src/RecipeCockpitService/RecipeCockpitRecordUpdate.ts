import * as fs from 'fs';
import * as path from 'path';

import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RecipeCockpitQuery } from './RecipeCockpitQuery';

/*
    The Treecipe Updater's update (#418): which chosen field an org lets the reader change, the
    snapshot of the old values written before anything is sent, the records one PATCH
    composite/sobjects request carries, and the org's answer read back. It imports no vscode: the
    cockpit owns the org, the confirmation, the progress and the notification.

    The org's describe and its save results come over the network, so every value read from them is
    type-checked here, and anything this module cannot read is a reason to refuse or a failure,
    never a default.
*/

// THE MOST RECORDS ONE COLLECTIONS API REQUEST CARRIES
export const RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT = 200;

export const RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME = 'UpdateAttempts';

// TWO UPDATES OF ONE TREE IN ONE SECOND TAKE <ts>-2, <ts>-3, ... RATHER THAN SHARE A SNAPSHOT
const UPDATE_ATTEMPT_FILE_ATTEMPTS = 20;

// A FOLDER NAME IS ONE PLAIN SEGMENT: NO SEPARATOR, NO "." OR "..", NO CONTROL CHARACTER
const FOLDER_NAME_PATTERN = /^(?!\.{1,2}$)[^\\/\u0000-\u001F\u007F]+$/;

// WHAT A FIELD OR OBJECT DESCRIBE MUST SAY FOR AN UPDATE; SalesforceOrgService's NORMALIZED DESCRIBE CARRIES IT
export interface IUpdateFieldDescribe {
    fieldApiName: string;
    isUpdateable: boolean;
    isCalculated: boolean;
}

export interface IUpdateObjectDescribe {
    objectApiName: string;
    isUpdateable: boolean;
    fields: readonly IUpdateFieldDescribe[];
}

export interface IUpdateRecordValues {
    recordId: string;
    fieldValues: Record<string, unknown>;
}

export interface IUpdateSnapshotObject {
    objectApiName: string;
    fieldApiNames: string[];
    // EACH LOADED RECORD'S Id AND THE VALUE EACH UPDATED FIELD HELD BEFORE THE UPDATE
    records: IUpdateRecordValues[];
}

export interface IUpdateSnapshot {
    orgUsername: string;
    treeFolderName: string;
    takenAt: string;
    objects: IUpdateSnapshotObject[];
}

export interface IUpdateRequestRecord {
    attributes: { type: string };
    Id: string;
    [fieldApiName: string]: unknown;
}

export interface IUpdateRecordError {
    statusCode: string;
    message: string;
    fields: string[];
}

export interface IUpdateRecordResult {
    recordId: string;
    isSuccess: boolean;
    errors: IUpdateRecordError[];
}

export interface IUpdateAttemptFiles {
    snapshotFilePath: string;
    resultsFilePath: string;
}

export class RecipeCockpitRecordUpdate {

    /*
        Why one object's chosen fields cannot be updated in the org, or undefined when every one can.
        An object the org could not describe, an object the user cannot update, and a field the
        describe does not list, does not let the user update, or calculates are each a reason --
        never a default, so a field this cannot vouch for is never sent.
    */
    static findUpdateReason(objectApiName: string,
                            fieldApiNames: readonly string[],
                            describe: IUpdateObjectDescribe | undefined,
                            describeFailureMessage?: string): string | undefined {

        if ( !describe ) {
            return `${objectApiName} could not be described in the org${describeFailureMessage ? `: ${describeFailureMessage}` : ''}.`;
        }

        if ( describe.isUpdateable !== true ) {
            return `${objectApiName} records cannot be updated by this user in the org.`;
        }

        // A FIELD NAME IS CASE-INSENSITIVE IN SALESFORCE, SO THE DESCRIBE IS MATCHED THAT WAY
        const describedFields = new Map(describe.fields.map(describedField => [describedField.fieldApiName.toLowerCase(), describedField] as const));

        for ( const fieldApiName of fieldApiNames ) {
            const describedField = describedFields.get(fieldApiName.toLowerCase());
            if ( !describedField ) {
                return `${objectApiName}.${fieldApiName} is not in the org. Deploy it first from Troubleshooting → Fields.`;
            }
            if ( describedField.isCalculated === true ) {
                return `${objectApiName}.${fieldApiName} is calculated in the org, so it cannot be updated.`;
            }
            if ( describedField.isUpdateable !== true ) {
                return `${objectApiName}.${fieldApiName} cannot be updated by this user in the org.`;
            }
        }

        return undefined;

    }

    // THE RECORDS ONE OBJECT'S REQUESTS CARRY: ITS TYPE, THE Id AND ONLY THE FIELDS BEING UPDATED
    static buildRequestRecords(objectApiName: string, fieldApiNames: readonly string[], recordValues: readonly IUpdateRecordValues[]): IUpdateRequestRecord[] {

        return recordValues.map(recordValue => {
            const requestRecord: IUpdateRequestRecord = { attributes: { type: objectApiName }, Id: recordValue.recordId };
            fieldApiNames.forEach(fieldApiName => {
                requestRecord[fieldApiName] = Object.prototype.hasOwnProperty.call(recordValue.fieldValues, fieldApiName)
                    ? recordValue.fieldValues[fieldApiName]
                    : null;
            });
            return requestRecord;
        });

    }

    static splitIntoRequests<T>(records: readonly T[], requestRecordLimit: number = RECIPE_COCKPIT_UPDATE_REQUEST_RECORD_LIMIT): T[][] {

        const requests: T[][] = [];
        for ( let recordIndex = 0; recordIndex < records.length; recordIndex += requestRecordLimit ) {
            requests.push(records.slice(recordIndex, recordIndex + requestRecordLimit));
        }
        return requests;

    }

    /*
        The org's answer to one request, one result per record sent and in the order sent. Anything
        that is not a list of that length, and any entry that does not say success: true, is a
        failure of that record: an answer this cannot read never counts as an update.
    */
    static readRequestResults(requestRecords: readonly IUpdateRequestRecord[], saveResults: unknown): IUpdateRecordResult[] {

        const resultEntries = Array.isArray(saveResults) && saveResults.length === requestRecords.length ? saveResults : undefined;

        return requestRecords.map((requestRecord, recordIndex) => {

            const resultEntry = resultEntries?.[recordIndex] as { success?: unknown; errors?: unknown } | undefined;

            if ( !resultEntry || typeof resultEntry !== 'object' ) {
                return {
                    recordId: requestRecord.Id,
                    isSuccess: false,
                    errors: [{ statusCode: 'UNREADABLE_RESULT', message: 'The org returned no readable result for this record.', fields: [] }]
                };
            }

            const errors = Array.isArray(resultEntry.errors) ? resultEntry.errors.map(errorEntry => this.readRecordError(errorEntry)) : [];

            return { recordId: requestRecord.Id, isSuccess: resultEntry.success === true, errors: errors };

        });

    }

    // A REQUEST THAT THREW FAILS EVERY RECORD IT CARRIED, WITH THE ERROR AS ITS REASON
    static failRequestRecords(requestRecords: readonly IUpdateRequestRecord[], failureMessage: string): IUpdateRecordResult[] {

        return requestRecords.map(requestRecord => ({
            recordId: requestRecord.Id,
            isSuccess: false,
            errors: [{ statusCode: 'REQUEST_FAILED', message: failureMessage, fields: [] }]
        }));

    }

    private static readRecordError(errorEntry: unknown): IUpdateRecordError {

        const errorRecord = ( errorEntry && typeof errorEntry === 'object' ? errorEntry : {} ) as { statusCode?: unknown; message?: unknown; fields?: unknown };

        return {
            statusCode: typeof errorRecord.statusCode === 'string' ? errorRecord.statusCode : 'UNKNOWN',
            message: typeof errorRecord.message === 'string' ? errorRecord.message : '',
            fields: Array.isArray(errorRecord.fields) ? errorRecord.fields.filter((field): field is string => typeof field === 'string') : []
        };

    }

    // THE OLD VALUES OF EVERY FIELD BEING UPDATED, READ FROM THE LOADED RECORDS (A FIELD NAME MATCHED CASE-INSENSITIVELY)
    static buildSnapshotObject(objectApiName: string, fieldApiNames: readonly string[], loadedRecords: readonly Record<string, unknown>[]): IUpdateSnapshotObject {

        return {
            objectApiName: objectApiName,
            fieldApiNames: [...fieldApiNames],
            records: loadedRecords.map(loadedRecord => {
                const keysByLowerCase = new Map(Object.keys(loadedRecord).map(key => [key.toLowerCase(), key] as const));
                const fieldValues: Record<string, unknown> = {};
                fieldApiNames.forEach(fieldApiName => {
                    const key = keysByLowerCase.get(fieldApiName.toLowerCase());
                    fieldValues[fieldApiName] = key === undefined ? null : loadedRecord[key] ?? null;
                });
                return { recordId: String(loadedRecord.Id), fieldValues: fieldValues };
            })
        };

    }

    // THE SNAPSHOT'S RECORDS FOR THE Ids GIVEN, TO PUT BACK WHAT AN ALL-OR-NONE UPDATE HAD ALREADY CHANGED
    static selectSnapshotRecords(snapshotObject: IUpdateSnapshotObject, recordIds: ReadonlySet<string>): IUpdateRecordValues[] {

        return snapshotObject.records.filter(snapshotRecord => recordIds.has(snapshotRecord.recordId));

    }

    /*
        Writes the snapshot to treecipe/UpdateAttempts/<tree folder>/<yyyyMMdd-HHmmss>-before.json,
        "wx" so an earlier snapshot is never overwritten, and answers where it and the results file
        beside it go -- or undefined when the folder name is not plain, a path leaves the workspace
        or the write fails, in which case NOTHING may be updated.
    */
    static writeSnapshot(workspaceRoot: string, snapshot: IUpdateSnapshot, date: Date): IUpdateAttemptFiles | undefined {

        if ( !FOLDER_NAME_PATTERN.test(snapshot.treeFolderName)
                || snapshot.objects.some(snapshotObject => !SalesforceApiName.isApiName(snapshotObject.objectApiName)) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const attemptsFolderPath = path.join(resolvedWorkspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME);
        const treeFolderPath = path.join(attemptsFolderPath, snapshot.treeFolderName);

        if ( !SfdxProjectService.isPathContainedInWorkspace(treeFolderPath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        try {
            fs.mkdirSync(treeFolderPath, { recursive: true });
        } catch {
            return undefined;
        }

        // AGAIN ONCE THE FOLDERS EXIST: ONE OF THEM COULD HAVE BEEN A LINK MADE IN BETWEEN
        if ( !SfdxProjectService.isPathContainedInWorkspace(treeFolderPath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        try {
            // THE SNAPSHOTS HOLD THE ORG'S DATA: NOT FOR A COMMIT
            fs.writeFileSync(path.join(attemptsFolderPath, '.gitignore'), '*\n', { encoding: 'utf-8', flag: 'wx' });
        } catch {
            // ALREADY THERE -- OR NOT WRITABLE, WHICH THE SNAPSHOT'S OWN WRITE WILL SAY
        }

        const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
        const timestamp = RecipeCockpitQuery.buildCompactTimestamp(date);

        for ( let attempt = 1; attempt <= UPDATE_ATTEMPT_FILE_ATTEMPTS; attempt++ ) {
            const attemptPrefix = attempt === 1 ? timestamp : `${timestamp}-${attempt}`;
            const snapshotFilePath = path.join(treeFolderPath, `${attemptPrefix}-before.json`);
            try {
                fs.writeFileSync(snapshotFilePath, snapshotText, { encoding: 'utf-8', flag: 'wx' });
                return { snapshotFilePath: snapshotFilePath, resultsFilePath: path.join(treeFolderPath, `${attemptPrefix}-results.json`) };
            } catch (writeError) {
                if ( ( writeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    // THE RESULTS BESIDE THE SNAPSHOT; A FAILED WRITE ANSWERS false, AND THE NOTIFICATION THEN OFFERS NO BUTTON
    static writeResults(resultsFilePath: string, workspaceRoot: string, results: unknown): boolean {

        if ( !SfdxProjectService.isPathContainedInWorkspace(resultsFilePath, path.resolve(workspaceRoot)) ) {
            return false;
        }

        try {
            fs.writeFileSync(resultsFilePath, `${JSON.stringify(results, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
            return true;
        } catch {
            return false;
        }

    }

}
