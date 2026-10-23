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

// A FOLDER NAME IS ONE PLAIN SEGMENT: NO SEPARATOR, NO CONTROL CHARACTER, AND NO TRAILING "." OR SPACE, WHICH WINDOWS STRIPS (SO NEITHER "." NOR "..")
const FOLDER_NAME_PATTERN = /^[^\\/\u0000-\u001F\u007F]*[^\\/\u0000-\u001F\u007F. ]$/;

// A WINDOWS DEVICE NAME, WITH OR WITHOUT AN EXTENSION: ScratchOrgService's RULE FOR AN OrgOperations FOLDER, NOT IMPORTED SO THIS STAYS FREE OF THE CLI SERVICES
const WINDOWS_RESERVED_FOLDER_NAME_PATTERN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// A SNAPSHOT'S FILE NAME AS writeSnapshot WRITES IT: <yyyyMMdd-HHmmss>[-<n>]-before.json
const SNAPSHOT_FILE_NAME_PATTERN = /^(\d{8}-\d{6})(?:-([2-9]|1\d|20))?-before\.json$/;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

// A USERNAME IS ONE LINE WITH NO SPACE, AS THE CLI RECORDS IT
const ORG_USERNAME_PATTERN = /^[^\s\u0000-\u001F\u007F\u0085\u2028\u2029]{1,255}$/;

// THE NEWEST SNAPSHOTS THE UPDATER TAB LISTS (#419); THE REST ARE COUNTED
export const RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT = 50;

// A SNAPSHOT HOLDS AT MOST A LOAD'S VALUE BUDGET, WHICH MEASURED WELL UNDER THIS; ANYTHING LARGER WAS NOT WRITTEN BY AN UPDATE
export const RECIPE_COCKPIT_UPDATE_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

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
    // THE ORG GAVE NO READABLE ANSWER FOR IT (A REQUEST THAT THREW, AN ANSWER THAT DID NOT PARSE): IT MAY HAVE BEEN SAVED
    isUncertain?: true;
}

export interface IUpdateSnapshotList {
    // NEWEST FIRST, AT MOST RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT
    snapshotFileNames: string[];
    hiddenSnapshotCount: number;
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

    // WHETHER EVERY RECORD HOLDS A VALUE FOR EVERY FIELD: A FIELD MISSING FROM ONE WOULD BE SENT AS null, WHICH CLEARS IT IN THE ORG
    static hasEveryField(recordValues: readonly IUpdateRecordValues[], fieldApiNames: readonly string[]): boolean {

        return recordValues.every(recordValue => fieldApiNames.every(fieldApiName => Object.prototype.hasOwnProperty.call(recordValue.fieldValues, fieldApiName)));

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
                    errors: [{ statusCode: 'UNREADABLE_RESULT', message: 'The org returned no readable result for this record.', fields: [] }],
                    isUncertain: true
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
            errors: [{ statusCode: 'REQUEST_FAILED', message: failureMessage, fields: [] }],
            isUncertain: true as const
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
                || WINDOWS_RESERVED_FOLDER_NAME_PATTERN.test(snapshot.treeFolderName)
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

        const snapshotText = `${JSON.stringify(snapshot)}\n`;
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

    /*
        Whether treecipe/UpdateAttempts/.gitignore still ignores everything under it, read back as
        the Query tab reads its own: the snapshots and results hold the org's data, and a file the
        repository already carried is not trusted for having been there.
    */
    static isUpdateAttemptsFolderGitIgnored(workspaceRoot: string): boolean {

        return RecipeCockpitQuery.isFolderWhollyGitIgnored(path.join(path.resolve(workspaceRoot), 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME));

    }

    // THE RESULTS BESIDE THE SNAPSHOT; A FAILED WRITE ANSWERS false, AND THE NOTIFICATION THEN OFFERS NO BUTTON
    static writeResults(resultsFilePath: string, workspaceRoot: string, results: unknown): boolean {

        if ( !SfdxProjectService.isPathContainedInWorkspace(resultsFilePath, path.resolve(workspaceRoot)) ) {
            return false;
        }

        try {
            fs.writeFileSync(resultsFilePath, `${JSON.stringify(results)}\n`, { encoding: 'utf-8', flag: 'wx' });
            return true;
        } catch {
            return false;
        }

    }


    /*
        The tree's snapshots (#419), newest first: the files under treecipe/UpdateAttempts/<tree
        folder>/ whose names writeSnapshot writes, each a file and never a link. A tree with no such
        folder has none; a folder name that is not plain, or a folder outside the workspace, lists
        nothing.
    */
    static listSnapshots(workspaceRoot: string, treeFolderName: string): IUpdateSnapshotList {

        const emptyList: IUpdateSnapshotList = { snapshotFileNames: [], hiddenSnapshotCount: 0 };
        const treeFolderPath = this.resolveTreeAttemptsFolderPath(workspaceRoot, treeFolderName);

        if ( !treeFolderPath ) {
            return emptyList;
        }

        let directoryEntries: fs.Dirent[];
        try {
            directoryEntries = fs.readdirSync(treeFolderPath, { withFileTypes: true });
        } catch {
            return emptyList;
        }

        const snapshots = directoryEntries.flatMap(directoryEntry => {
            const nameMatch = directoryEntry.isFile() ? SNAPSHOT_FILE_NAME_PATTERN.exec(directoryEntry.name) : null;
            return nameMatch ? [{ fileName: directoryEntry.name, timestamp: nameMatch[1], attempt: nameMatch[2] ? Number(nameMatch[2]) : 1 }] : [];
        });

        snapshots.sort((left, right) => left.timestamp !== right.timestamp
            ? ( left.timestamp < right.timestamp ? 1 : -1 )
            : right.attempt - left.attempt);

        return {
            snapshotFileNames: snapshots.slice(0, RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT).map(snapshot => snapshot.fileName),
            hiddenSnapshotCount: Math.max(0, snapshots.length - RECIPE_COCKPIT_UPDATE_SNAPSHOT_LIST_LIMIT)
        };

    }

    // WHERE A LISTED SNAPSHOT IS, CHECKED AGAIN WHEN IT IS READ: A NAME writeSnapshot WRITES, A FILE AND NOT A LINK, INSIDE THE WORKSPACE
    static resolveSnapshotFilePath(workspaceRoot: string, treeFolderName: string, snapshotFileName: string): string | undefined {

        const treeFolderPath = SNAPSHOT_FILE_NAME_PATTERN.test(snapshotFileName) ? this.resolveTreeAttemptsFolderPath(workspaceRoot, treeFolderName) : undefined;
        if ( !treeFolderPath ) {
            return undefined;
        }

        const snapshotFilePath = path.join(treeFolderPath, snapshotFileName);

        try {
            if ( !fs.lstatSync(snapshotFilePath).isFile() ) {
                return undefined;
            }
        } catch {
            return undefined;
        }

        return SfdxProjectService.isPathContainedInWorkspace(snapshotFilePath, path.resolve(workspaceRoot)) ? snapshotFilePath : undefined;

    }

    private static resolveTreeAttemptsFolderPath(workspaceRoot: string, treeFolderName: string): string | undefined {

        if ( !FOLDER_NAME_PATTERN.test(treeFolderName) || WINDOWS_RESERVED_FOLDER_NAME_PATTERN.test(treeFolderName) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const treeFolderPath = path.join(resolvedWorkspaceRoot, 'treecipe', RECIPE_COCKPIT_UPDATE_ATTEMPTS_FOLDER_NAME, treeFolderName);

        return fs.existsSync(treeFolderPath) && SfdxProjectService.isPathContainedInWorkspace(treeFolderPath, resolvedWorkspaceRoot) ? treeFolderPath : undefined;

    }

    /*
        A snapshot file read and parsed, or why it was refused. It is opened ONCE, without following a
        link where the platform can refuse one (O_NOFOLLOW; Windows has none, and a link there was
        already refused by resolveSnapshotFilePath), and the size and kind are read from that same
        handle, so a link swapped in after the path was checked is never read. A file past
        RECIPE_COCKPIT_UPDATE_SNAPSHOT_MAX_BYTES is not read at all.
    */
    static readSnapshotFile(snapshotFilePath: string): IUpdateSnapshot | { refusal: string } {

        let fileDescriptor: number | undefined;
        let snapshotText: string;
        try {
            fileDescriptor = fs.openSync(snapshotFilePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            const fileStats = fs.fstatSync(fileDescriptor);
            if ( !fileStats.isFile() ) {
                return { refusal: 'it could not be read' };
            }
            if ( fileStats.size > RECIPE_COCKPIT_UPDATE_SNAPSHOT_MAX_BYTES ) {
                return { refusal: 'it is larger than any update writes' };
            }
            snapshotText = fs.readFileSync(fileDescriptor, 'utf-8');
        } catch {
            return { refusal: 'it could not be read' };
        } finally {
            if ( fileDescriptor !== undefined ) {
                fs.closeSync(fileDescriptor);
            }
        }

        return this.parseSnapshot(snapshotText);

    }

    /*
        A snapshot is a file in the workspace, so it is UNTRUSTED (#419): anyone can edit it, and what
        it holds is written to an org. Every part is type-checked -- the org username one line, the
        tree folder a plain name, each object and field an api name (never Id, never twice), each
        record a Salesforce Id (never twice in an object) whose values name exactly the object's
        fields, each null, a string, a finite number or a boolean -- and anything else refuses the
        WHOLE file, never the part that is wrong. The answer is built afresh, so nothing the file
        held beyond that shape reaches a request.
    */
    static parseSnapshot(snapshotText: string): IUpdateSnapshot | { refusal: string } {

        let parsedSnapshot: unknown;
        try {
            parsedSnapshot = JSON.parse(snapshotText);
        } catch {
            return { refusal: 'it is not JSON' };
        }

        const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate);

        if ( !isPlainObject(parsedSnapshot) ) {
            return { refusal: 'it is not a snapshot' };
        }

        const { orgUsername, treeFolderName, takenAt, objects } = parsedSnapshot;

        if ( typeof orgUsername !== 'string' || !ORG_USERNAME_PATTERN.test(orgUsername) ) {
            return { refusal: 'it names no usable org username' };
        }
        if ( typeof treeFolderName !== 'string' || !FOLDER_NAME_PATTERN.test(treeFolderName) ) {
            return { refusal: 'it names no usable tree folder' };
        }
        if ( typeof takenAt !== 'string' || !Number.isFinite(Date.parse(takenAt)) ) {
            return { refusal: 'it says no usable time it was taken' };
        }
        if ( !Array.isArray(objects) || objects.length === 0 ) {
            return { refusal: 'it holds no objects' };
        }

        const snapshotObjects: IUpdateSnapshotObject[] = [];
        const seenObjectApiNames = new Set<string>();

        for ( const candidateObject of objects ) {

            if ( !isPlainObject(candidateObject) || !SalesforceApiName.isApiName(candidateObject.objectApiName) ) {
                return { refusal: 'an object in it is not an api name' };
            }

            const objectApiName = candidateObject.objectApiName;
            if ( seenObjectApiNames.has(objectApiName.toLowerCase()) ) {
                return { refusal: `it lists ${objectApiName} twice` };
            }
            seenObjectApiNames.add(objectApiName.toLowerCase());

            const { fieldApiNames, records } = candidateObject;
            if ( !Array.isArray(fieldApiNames) || fieldApiNames.length === 0 || !fieldApiNames.every(fieldApiName => SalesforceApiName.isApiName(fieldApiName)) ) {
                return { refusal: `a field of ${objectApiName} in it is not an api name` };
            }

            const lowerCaseFieldApiNames = fieldApiNames.map(fieldApiName => ( fieldApiName as string ).toLowerCase());
            if ( new Set(lowerCaseFieldApiNames).size !== fieldApiNames.length || lowerCaseFieldApiNames.includes('id') ) {
                return { refusal: `it lists a field of ${objectApiName} twice, or its Id as a field` };
            }

            if ( !Array.isArray(records) ) {
                return { refusal: `it holds no records of ${objectApiName}` };
            }

            const snapshotRecords: IUpdateRecordValues[] = [];
            const seenRecordIds = new Set<string>();

            for ( const candidateRecord of records ) {

                if ( !isPlainObject(candidateRecord)
                        || typeof candidateRecord.recordId !== 'string'
                        || !SALESFORCE_RECORD_ID_PATTERN.test(candidateRecord.recordId)
                        || !isPlainObject(candidateRecord.fieldValues) ) {
                    return { refusal: `a record of ${objectApiName} in it has no Salesforce Id or no values` };
                }

                // A 15-CHARACTER Id IS THE HEAD OF ITS 18-CHARACTER FORM, SO THE TWO NAME ONE RECORD
                const recordKey = candidateRecord.recordId.slice(0, 15);
                if ( seenRecordIds.has(recordKey) ) {
                    return { refusal: `it lists the ${objectApiName} record ${candidateRecord.recordId} twice` };
                }
                seenRecordIds.add(recordKey);

                const candidateValues = candidateRecord.fieldValues;
                if ( Object.keys(candidateValues).length !== fieldApiNames.length ) {
                    return { refusal: `the ${objectApiName} record ${candidateRecord.recordId} holds other values than its fields` };
                }

                const fieldValues: Record<string, unknown> = {};
                for ( const fieldApiName of fieldApiNames as string[] ) {
                    const fieldValue = Object.prototype.hasOwnProperty.call(candidateValues, fieldApiName) ? candidateValues[fieldApiName] : undefined;
                    const isUsableValue = fieldValue === null
                        || typeof fieldValue === 'string'
                        || typeof fieldValue === 'boolean'
                        || ( typeof fieldValue === 'number' && Number.isFinite(fieldValue) );
                    if ( !isUsableValue ) {
                        return { refusal: `the ${objectApiName} record ${candidateRecord.recordId} has no usable value for ${fieldApiName}` };
                    }
                    fieldValues[fieldApiName] = fieldValue;
                }

                snapshotRecords.push({ recordId: candidateRecord.recordId, fieldValues: fieldValues });

            }

            snapshotObjects.push({ objectApiName: objectApiName, fieldApiNames: [...fieldApiNames as string[]], records: snapshotRecords });

        }

        return { orgUsername: orgUsername, treeFolderName: treeFolderName, takenAt: takenAt, objects: snapshotObjects };

    }

}
