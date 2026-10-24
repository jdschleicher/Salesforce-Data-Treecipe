import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ORG_OPERATIONS_FOLDER_NAME, ORG_OPERATION_RESULT_FILE_ATTEMPTS, ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { METADATA_DEPLOY_PACKAGE_XML_SUFFIX, METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';

export const ORG_CHANGE_RETRIEVE_OPERATION_NAME = 'adapter-retrieve';

const FIELD_FILE_SUFFIX = '.field-meta.xml';

const CUSTOM_FIELD_NAME_PATTERN = /__c$/i;

// HOW LONG ONE COMPARED VALUE MAY BE IN A DIFFERENCE; A LONGER ONE IS CUT, SINCE IT IS SHOWN AND THE XML IS THE ORG'S
const DIFFERENCE_VALUE_MAX_LENGTH = 120;

// HOW MANY PICKLIST VALUES A DIFFERENCE NAMES BEFORE IT COUNTS THE REST
const DIFFERENCE_PICKLIST_VALUES_SHOWN = 5;

// HOW LARGE A FIELD FILE IS READ; A LARGER ONE IS COUNTED UNREADABLE RATHER THAN PARSED
const FIELD_FILE_MAX_BYTES = 1024 * 1024;

export type OrgFieldChangeStatus = 'new' | 'changed';

export interface IOrgFieldChange {
    fieldApiName: string;
    status: OrgFieldChangeStatus;
    fieldType: string;
    fieldLabel: string;
    // WHAT DIFFERS, ONE LINE EACH ("length: 80 → 255"); EMPTY FOR A NEW FIELD
    differences: string[];
}

export interface IOrgObjectChanges {
    objectApiName: string;
    // WHETHER THE RETRIEVE BROUGHT THE OBJECT AT ALL; ONE IT DID NOT IS NOT IN THE ORG, OR THE USER CANNOT SEE IT
    isRetrieved: boolean;
    fieldChanges: IOrgFieldChange[];
    unchangedFieldCount: number;
    // FIELD FILES ON EITHER SIDE THAT COULD NOT BE READ, SO COULD NOT BE COMPARED
    unreadableFieldCount: number;
    // CUSTOM CHILD OBJECTS THE ORG'S DESCRIBE NAMES AND THE TREE DOES NOT HOLD; SET ONLY WHEN THERE ARE ANY
    newChildObjects?: IOrgNewChildObject[];
    moreNewChildObjectCount?: number;
}

/*
    The two hints read beside the file diff (#445): source tracking's SourceMember (Tooling API) and
    the last 180 days of SetupAuditTrail. Each is context, never the marks: a failed or unavailable
    one is a note, and an empty one says nothing about the files.
*/
export const ORG_CHANGE_SOURCE_MEMBER_QUERY = "SELECT MemberType, MemberName, RevisionCounter, LastModifiedDate FROM SourceMember WHERE MemberType IN ('CustomObject', 'CustomField', 'RecordType', 'ValidationRule') ORDER BY RevisionCounter DESC LIMIT 2000";
export const ORG_CHANGE_SETUP_AUDIT_TRAIL_QUERY = 'SELECT Action, Section, Display, CreatedDate, CreatedBy.Name FROM SetupAuditTrail WHERE CreatedDate = LAST_N_DAYS:180 ORDER BY CreatedDate DESC LIMIT 2000';
export const ORG_CHANGE_HINT_ROW_LIMIT = 50;
// HOW MANY NEW CHILD OBJECTS ONE OBJECT LISTS; A LARGER ORG'S REST ARE COUNTED
export const ORG_CHANGE_CHILD_OBJECT_LIMIT = 100;

const SOURCE_MEMBER_TYPES = new Set(['CustomObject', 'CustomField', 'RecordType', 'ValidationRule']);
const HINT_TEXT_MAX_LENGTH = 200;
const ORG_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/;
const ORG_ERROR_CODE_PATTERN = /^[A-Z][A-Z_]{1,63}$/;

export interface IOrgChangeHintRow {
    objectApiName: string;
    text: string;
    // THE ORG'S DATE-TIME AS IT SENT IT, OR '' WHEN IT SENT NONE THAT READS AS ONE
    changedAt: string;
}

export interface IOrgChangeHintList {
    rows: IOrgChangeHintRow[];
    // ROWS NAMING A TREE OBJECT PAST ORG_CHANGE_HINT_ROW_LIMIT
    moreCount: number;
    // ROWS THAT COULD NOT BE READ AS ONE
    skippedCount: number;
    // SET WHEN THE HINT COULD NOT BE READ AT ALL; rows IS THEN EMPTY
    note?: string;
}

export interface IOrgChangeHints {
    sourceTracking: IOrgChangeHintList;
    auditTrail: IOrgChangeHintList;
}

// THE TWO QUERIES THE HINTS NEED, SO A TEST CAN HAND IN ANYTHING THAT ANSWERS THEM
export interface IOrgChangeHintQuerySource {
    query(soql: string): Promise<unknown>;
    toolingQuery(soql: string): Promise<unknown>;
}

// AN OBJECT AN AUDIT TRAIL LINE IS MATCHED BY: ITS API NAME, AND ITS LABEL WHEN THE ORG'S DESCRIBE GAVE ONE
export interface IOrgChangeObjectName {
    objectApiName: string;
    objectLabel?: string;
}

export interface IOrgNewChildObject {
    childObjectApiName: string;
    fieldApiName: string;
}

// ONE OBJECT'S CHILD RELATIONSHIPS AS THE DESCRIBE NORMALIZED THEM
export interface IOrgDescribedChildRelationships {
    objectApiName: string;
    childRelationships?: readonly IOrgNewChildObject[];
}

// ONE FILE "Apply retrieved files to project" WRITES; HOST-ONLY, NEVER POSTED
export interface IOrgFieldFileCopy {
    objectApiName: string;
    fieldApiName: string;
    status: OrgFieldChangeStatus;
    stagedFilePath: string;
    targetFilePath: string;
}

interface IFieldFileComparison {
    objectApiName: string;
    fieldApiName: string;
    status: OrgFieldChangeStatus;
    stagedFilePath: string;
    localFilePath?: string;
}

// THE PARTS OF A FIELD'S XML A CHANGE IS JUDGED BY; EVERY VALUE ONE LINE, AS THE XML SPELLS IT
export interface IComparedField {
    fieldType: string;
    fieldLabel: string;
    length: string;
    precision: string;
    scale: string;
    required: string;
    referenceTo: string;
    valueSetName: string;
    picklistValues: string[];
}

/*
    "Retrieve latest metadata" for the Treecipe Adapter (#445): the tree's objects retrieved from
    the target org into a STAGING folder under treecipe/OrgOperations, never into a package
    directory, and each retrieved field file compared with the project's own. The file diff is the
    source of truth: a field is NEW when it is a custom field the project holds no file for, and
    CHANGED when its type, length, precision, scale, required, referenceTo, value set or picklist
    values differ. Every file is the org's or the repository's, so each is read without following a
    link, held to a size, parsed as untrusted, and every name held to SalesforceApiName. Imports no
    vscode.
*/
export class RecipeCockpitOrgChangeDetection {

    /*
        The package.xml the retrieve names its objects in: one CustomObject member per object, which
        brings the object with its fields, record types and validation rules. Unlike a deploy, a
        STANDARD object is asked for too, since its fields are what the reader added.
    */
    static buildObjectRetrievePackageXml(objectApiNames: readonly string[], apiVersion?: string): string {

        const members = [...new Set(objectApiNames)];

        if ( members.length === 0 ) {
            throw new Error('No object was named, so nothing was retrieved.');
        }

        members.forEach(member => {
            if ( !SalesforceApiName.isApiName(member) ) {
                throw new Error(`"${String(member).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not an object api name, so nothing was retrieved.`);
            }
        });

        const version = RecipeCockpitMetadataDeploy.readApiVersion(apiVersion);

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
            '    <types>',
            ...members.sort().map(member => `        <members>${RecipeCockpitMetadataDeploy.escapeXmlText(member)}</members>`),
            '        <name>CustomObject</name>',
            '    </types>',
            ...( version ? [`    <version>${version}</version>`] : [] ),
            '</Package>',
            ''
        ].join('\n');

    }

    /*
        treecipe/OrgOperations/<username>/<yyyyMMdd-HHmmss>-adapter-retrieve: where a staging folder
        is made. Undefined when the folder name could name another folder or the path would land
        outside the workspace.
    */
    static buildStagingFolderPath(workspaceRoot: string, orgUsername: string, date: Date): string | undefined {

        if ( !ScratchOrgService.isUsableOrgOperationFolderName(orgUsername) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const stagingFolderPath = path.join(resolvedWorkspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, orgUsername, `${ScratchOrgService.buildCompactTimestamp(date)}-${ORG_CHANGE_RETRIEVE_OPERATION_NAME}`);

        return SfdxProjectService.isPathContainedInWorkspace(stagingFolderPath, resolvedWorkspaceRoot) ? stagingFolderPath : undefined;

    }

    /*
        Makes a NEW staging folder and answers where: the first free of <path>, <path>-2, ... (two
        retrieves in one second), since a folder already there could be a link or hold another
        retrieve's files. Undefined when none could be made inside the workspace.
    */
    static makeStagingFolder(workspaceRoot: string, stagingFolderPath: string): string | undefined {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

        try {
            fs.mkdirSync(path.dirname(stagingFolderPath), { recursive: true });
            ScratchOrgService.writeOrgOperationsGitignore(resolvedWorkspaceRoot);
        } catch {
            return undefined;
        }

        for ( let attempt = 1; attempt <= ORG_OPERATION_RESULT_FILE_ATTEMPTS; attempt++ ) {
            const attemptFolderPath = attempt === 1 ? stagingFolderPath : `${stagingFolderPath}-${attempt}`;
            try {
                fs.mkdirSync(attemptFolderPath);
            } catch (makeError) {
                if ( ( makeError as NodeJS.ErrnoException )?.code === 'EEXIST' ) {
                    continue;
                }
                return undefined;
            }
            return SfdxProjectService.isPathContainedInWorkspace(attemptFolderPath, resolvedWorkspaceRoot) ? attemptFolderPath : undefined;
        }

        return undefined;

    }

    // THE package.xml BESIDE A STAGING FOLDER, NAMED AFTER IT
    static buildPackageXmlFilePath(stagingFolderPath: string): string {
        return `${stagingFolderPath}${METADATA_DEPLOY_PACKAGE_XML_SUFFIX}`;
    }

    // THE STAGING FOLDER RELATIVE TO THE WORKSPACE, "/"-SEPARATED, AS THE CLI'S --output-dir; ITS cwd IS THE WORKSPACE
    static toOutputDirectoryArgument(workspaceRoot: string, stagingFolderPath: string): string {

        const relativePath = path.relative(path.resolve(workspaceRoot), stagingFolderPath).split(path.sep).join('/');
        const segments = relativePath.split('/');

        if ( relativePath === ''
                || path.isAbsolute(relativePath)
                || /[\\\0\r\n]/.test(relativePath)
                || relativePath.startsWith('-')
                || segments.some(segment => segment === '' || segment === '.' || segment === '..')
                || segments[0] !== 'treecipe' ) {
            throw new Error('The staging folder is not a plain path under treecipe/ in this workspace, so nothing was retrieved.');
        }

        return relativePath;

    }

    // THE RETRIEVE ITSELF: THE MANIFEST'S OBJECTS, WRITTEN UNDER THE STAGING FOLDER AND NOWHERE ELSE
    static buildRetrieveArguments(manifestRelativePath: string, outputDirectoryRelativePath: string, orgUsername: string): string[] {

        RecipeCockpitMetadataDeploy.assertPlainManifestPath(manifestRelativePath, 'nothing was retrieved');
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        if ( outputDirectoryRelativePath.startsWith('-') || !outputDirectoryRelativePath.startsWith('treecipe/') ) {
            throw new Error('The staging folder is not under treecipe/, so nothing was retrieved.');
        }

        return [
            'project', 'retrieve', 'start',
            '--json',
            '--target-org', orgUsername,
            '--manifest', manifestRelativePath,
            '--output-dir', outputDirectoryRelativePath
        ];

    }

    // A RETRIEVE THAT RAN AND SAYS IT SUCCEEDED; ANYTHING ELSE IS ITS MESSAGE, OR A FIXED ONE
    static readRetrieveSucceeded(invocationResult: ISalesforceCliInvocationResult, payload: Record<string, unknown> | undefined): { isSucceeded: true } | { isSucceeded: false; failureMessage: string } {

        if ( invocationResult.spawnError ) {
            return { isSucceeded: false, failureMessage: 'The Salesforce CLI, sf, could not be run. Install it, or check that it is on the PATH.' };
        }

        if ( invocationResult.timedOut ) {
            return { isSucceeded: false, failureMessage: 'The retrieve did not finish in time.' };
        }

        const result = payload?.result;
        const isSucceeded = payload?.status === 0
            && !!result && typeof result === 'object' && !Array.isArray(result)
            && ( result as Record<string, unknown> ).success === true;

        if ( isSucceeded ) {
            return { isSucceeded: true };
        }

        const message = typeof payload?.message === 'string' ? payload.message : '';
        return { isSucceeded: false, failureMessage: this.toSingleLine(message) || 'The org did not confirm the retrieve.' };

    }

    /*
        Each object, in the order given, with its fields that are new or changed in the org against
        the project. An object's local fields are read from every package directory (the first file
        of a name winning, as a deploy reads them), its staged fields from the staging folder only.
    */
    static async detectFieldChanges(workspaceRoot: string,
                                    packageDirectoryPaths: readonly string[],
                                    stagingFolderPath: string,
                                    objectApiNames: readonly string[]): Promise<IOrgObjectChanges[]> {

        return ( await this.compareStagedObjects(workspaceRoot, packageDirectoryPaths, stagingFolderPath, objectApiNames) ).objectChanges;

    }

    /*
        What "Apply retrieved files to project" copies, drawn again from the files as they are NOW:
        each changed field's staged file over the project file it was compared with, wherever that
        is, and each new field's into the default package directory -- under the object's folder
        there when it has one, else main/default/objects/<Object>/fields. Paths stay on the host.
    */
    static async planFieldFileCopies(workspaceRoot: string,
                                     packageDirectoryPaths: readonly string[],
                                     defaultPackageDirectoryPath: string,
                                     stagingFolderPath: string,
                                     objectApiNames: readonly string[]): Promise<IOrgFieldFileCopy[]> {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const defaultRelativePath = path.relative(resolvedWorkspaceRoot, path.resolve(resolvedWorkspaceRoot, defaultPackageDirectoryPath));
        const defaultObjectFolderPathsByObject = RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, [defaultRelativePath], objectApiNames);
        const { fileComparisons } = await this.compareStagedObjects(workspaceRoot, packageDirectoryPaths, stagingFolderPath, objectApiNames);

        return fileComparisons.map(fileComparison => {
            const newFieldFolderPath = path.join(
                defaultObjectFolderPathsByObject.get(fileComparison.objectApiName)?.[0]
                    ?? path.join(resolvedWorkspaceRoot, defaultRelativePath, 'main', 'default', 'objects', fileComparison.objectApiName),
                'fields'
            );
            return {
                objectApiName: fileComparison.objectApiName,
                fieldApiName: fileComparison.fieldApiName,
                status: fileComparison.status,
                stagedFilePath: fileComparison.stagedFilePath,
                targetFilePath: fileComparison.localFilePath ?? path.join(newFieldFolderPath, `${fileComparison.fieldApiName}${FIELD_FILE_SUFFIX}`)
            };
        });

    }

    /*
        Copies each planned file, in order, and answers what was written. A staged file is read
        again without following a link; a target is written only inside the workspace -- its
        deepest existing folder checked before any is made, and its folder again once made -- never
        over a link or anything but a file, through a temporary file renamed over it. A copy that
        cannot be made is named in failures and the rest carry on.
    */
    static copyFieldFiles(workspaceRoot: string, fieldFileCopies: readonly IOrgFieldFileCopy[]): { copiedCount: number; failures: string[] } {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const failures: string[] = [];
        let copiedCount = 0;

        fieldFileCopies.forEach(fieldFileCopy => {

            const fieldName = `${fieldFileCopy.objectApiName}.${fieldFileCopy.fieldApiName}`;
            const fieldText = this.readFieldFileText(fieldFileCopy.stagedFilePath);

            if ( fieldText === undefined ) {
                failures.push(`${fieldName}: the retrieved file could not be read`);
                return;
            }

            const targetFolderPath = path.dirname(fieldFileCopy.targetFilePath);
            let existingAncestorPath = targetFolderPath;
            while ( !fs.existsSync(existingAncestorPath) && path.dirname(existingAncestorPath) !== existingAncestorPath ) {
                existingAncestorPath = path.dirname(existingAncestorPath);
            }

            if ( !SfdxProjectService.isPathContainedInWorkspace(existingAncestorPath, resolvedWorkspaceRoot) ) {
                failures.push(`${fieldName}: its folder is not inside this workspace`);
                return;
            }

            const temporaryFilePath = `${fieldFileCopy.targetFilePath}.${process.pid}-${Date.now()}.tmp`;
            try {
                fs.mkdirSync(targetFolderPath, { recursive: true });
                if ( !SfdxProjectService.isPathContainedInWorkspace(targetFolderPath, resolvedWorkspaceRoot) ) {
                    failures.push(`${fieldName}: its folder is not inside this workspace`);
                    return;
                }
                // lstat, NOT existsSync: A LINK THAT POINTS NOWHERE "DOES NOT EXIST" YET IS STILL NOT A PLAIN FILE
                const targetStat = fs.lstatSync(fieldFileCopy.targetFilePath, { throwIfNoEntry: false });
                if ( targetStat && !targetStat.isFile() ) {
                    failures.push(`${fieldName}: the project file is not a plain file, so it was left as it is`);
                    return;
                }
                fs.writeFileSync(temporaryFilePath, fieldText, { encoding: 'utf-8', flag: 'wx' });
                fs.renameSync(temporaryFilePath, fieldFileCopy.targetFilePath);
                copiedCount++;
            } catch (copyError) {
                fs.rmSync(temporaryFilePath, { force: true });
                failures.push(`${fieldName}: ${this.toSingleLine(copyError instanceof Error ? copyError.message : String(copyError)).slice(0, DIFFERENCE_VALUE_MAX_LENGTH)}`);
            }

        });

        return { copiedCount: copiedCount, failures: failures };

    }

    private static async compareStagedObjects(workspaceRoot: string,
                                              packageDirectoryPaths: readonly string[],
                                              stagingFolderPath: string,
                                              objectApiNames: readonly string[]): Promise<{ objectChanges: IOrgObjectChanges[]; fileComparisons: IFieldFileComparison[] }> {

        const fileComparisons: IFieldFileComparison[] = [];
        // xml2js SETTLES SYNCHRONOUSLY, SO A LARGE TREE'S FILES WOULD HOLD THE EXTENSION HOST WITHOUT A YIELD NOW AND THEN
        let readFileCount = 0;
        const yieldEveryFewFiles = async () => {
            readFileCount++;
            if ( readFileCount % METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES === 0 ) {
                await new Promise(resolve => setImmediate(resolve));
            }
        };
        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const stagingRelativePath = path.relative(resolvedWorkspaceRoot, stagingFolderPath);
        const stagedFolderPathsByObject = RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, [stagingRelativePath], objectApiNames);
        const localFolderPathsByObject = RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, packageDirectoryPaths, objectApiNames);
        const objectChanges: IOrgObjectChanges[] = [];

        for ( const objectApiName of objectApiNames ) {

            const stagedFolderPaths = stagedFolderPathsByObject.get(objectApiName) ?? [];
            const stagedFieldFiles = this.listFieldFiles(stagedFolderPaths);
            const localFieldFiles = this.listFieldFiles(localFolderPathsByObject.get(objectApiName) ?? []);
            const fieldChanges: IOrgFieldChange[] = [];
            let unchangedFieldCount = 0;
            let unreadableFieldCount = 0;

            for ( const [lowerFieldName, stagedFile] of stagedFieldFiles ) {

                await yieldEveryFewFiles();
                const stagedField = await this.readComparedField(stagedFile.filePath);

                if ( !stagedField ) {
                    unreadableFieldCount++;
                    continue;
                }

                const localFile = localFieldFiles.get(lowerFieldName);

                if ( !localFile ) {
                    if ( CUSTOM_FIELD_NAME_PATTERN.test(stagedFile.fieldApiName) ) {
                        fieldChanges.push({ fieldApiName: stagedFile.fieldApiName, status: 'new', fieldType: stagedField.fieldType, fieldLabel: stagedField.fieldLabel, differences: [] });
                        fileComparisons.push({ objectApiName: objectApiName, fieldApiName: stagedFile.fieldApiName, status: 'new', stagedFilePath: stagedFile.filePath });
                    }
                    continue;
                }

                const localField = await this.readComparedField(localFile.filePath);

                if ( !localField ) {
                    unreadableFieldCount++;
                    continue;
                }

                const differences = this.compareFields(localField, stagedField);

                if ( differences.length === 0 ) {
                    unchangedFieldCount++;
                } else {
                    fieldChanges.push({ fieldApiName: localFile.fieldApiName, status: 'changed', fieldType: stagedField.fieldType, fieldLabel: stagedField.fieldLabel, differences: differences });
                    fileComparisons.push({ objectApiName: objectApiName, fieldApiName: localFile.fieldApiName, status: 'changed', stagedFilePath: stagedFile.filePath, localFilePath: localFile.filePath });
                }

            }

            objectChanges.push({
                objectApiName: objectApiName,
                isRetrieved: stagedFolderPaths.length > 0,
                // NEW FIELDS FIRST, THEN CHANGED, EACH BY NAME WITH "<"
                fieldChanges: fieldChanges.sort((first, second) => first.status !== second.status
                    ? ( first.status === 'new' ? -1 : 1 )
                    : ( first.fieldApiName < second.fieldApiName ? -1 : first.fieldApiName > second.fieldApiName ? 1 : 0 )),
                unchangedFieldCount: unchangedFieldCount,
                unreadableFieldCount: unreadableFieldCount
            });

        }

        return { objectChanges: objectChanges, fileComparisons: fileComparisons };

    }

    /*
        Both hints, each on its own: a query that throws or answers with no records list is that
        hint's note, never "no change", and the other is still read.
    */
    static async readChangeHints(querySource: IOrgChangeHintQuerySource, objectNames: readonly IOrgChangeObjectName[]): Promise<IOrgChangeHints> {

        const readHint = async (runQuery: () => Promise<unknown>, parse: (queryResult: unknown) => IOrgChangeHintList, describeFailure: (queryError: unknown) => string): Promise<IOrgChangeHintList> => {
            try {
                return parse(await runQuery());
            } catch (queryError) {
                return { rows: [], moreCount: 0, skippedCount: 0, note: describeFailure(queryError) };
            }
        };

        const [sourceTracking, auditTrail] = await Promise.all([
            readHint(() => querySource.toolingQuery(ORG_CHANGE_SOURCE_MEMBER_QUERY), queryResult => this.parseSourceMembers(queryResult, objectNames),
                queryError => this.readErrorCode(queryError) === 'INVALID_TYPE'
                    ? 'This org does not track source, so source tracking lists nothing. The marks come from the files alone.'
                    : `Source tracking could not be read${this.describeErrorCode(queryError)}. The marks come from the files alone.`),
            readHint(() => querySource.query(ORG_CHANGE_SETUP_AUDIT_TRAIL_QUERY), queryResult => this.parseSetupAuditTrail(queryResult, objectNames),
                queryError => `The setup audit trail could not be read${this.describeErrorCode(queryError)}. The user may lack View Setup and Configuration.`)
        ]);

        return { sourceTracking: sourceTracking, auditTrail: auditTrail };

    }

    /*
        SourceMember rows naming a tree object, untrusted: a member type of the four asked for, a
        member name whose object half and member half are api names, the object half a tree object
        as Salesforce reads names. An answer with no records list throws.
    */
    static parseSourceMembers(queryResult: unknown, objectNames: readonly IOrgChangeObjectName[]): IOrgChangeHintList {

        const treeObjectApiNameByLowerName = new Map(objectNames.map(objectName => [objectName.objectApiName.toLowerCase(), objectName.objectApiName] as const));
        const matchedRows: IOrgChangeHintRow[] = [];
        let skippedCount = 0;

        this.readQueryRecords(queryResult, 'source tracking').forEach(queryRecord => {

            const sourceMember = this.asRecord(queryRecord);
            const memberType = sourceMember?.MemberType;
            const memberName = sourceMember?.MemberName;

            if ( typeof memberType !== 'string' || !SOURCE_MEMBER_TYPES.has(memberType) || typeof memberName !== 'string' ) {
                skippedCount++;
                return;
            }

            const dotIndex = memberName.indexOf('.');
            const objectHalf = dotIndex < 0 ? memberName : memberName.slice(0, dotIndex);
            const memberHalf = dotIndex < 0 ? undefined : memberName.slice(dotIndex + 1);

            if ( !SalesforceApiName.isApiName(objectHalf) || ( memberHalf !== undefined && !SalesforceApiName.isApiName(memberHalf) ) ) {
                skippedCount++;
                return;
            }

            const treeObjectApiName = treeObjectApiNameByLowerName.get(objectHalf.toLowerCase());
            if ( treeObjectApiName ) {
                matchedRows.push({ objectApiName: treeObjectApiName, text: `${memberType} ${memberName}`, changedAt: this.readDateTime(sourceMember.LastModifiedDate) });
            }

        });

        return this.toHintList(matchedRows, skippedCount);

    }

    /*
        SetupAuditTrail rows whose Display names a tree object, by api name or by the label the
        org's describe gave it, as a whole word whatever its case. Display is the org's text, so it
        is cut to one short line; a row with none is skipped. An answer with no records list throws.
    */
    static parseSetupAuditTrail(queryResult: unknown, objectNames: readonly IOrgChangeObjectName[]): IOrgChangeHintList {

        const objectMatchers = objectNames.map(objectName => ({
            objectApiName: objectName.objectApiName,
            patterns: [objectName.objectApiName, ...( objectName.objectLabel?.trim() ? [objectName.objectLabel.trim()] : [] )]
                .map(name => new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9_])`, 'i'))
        }));
        const matchedRows: IOrgChangeHintRow[] = [];
        let skippedCount = 0;

        this.readQueryRecords(queryResult, 'the setup audit trail').forEach(queryRecord => {

            const auditRow = this.asRecord(queryRecord);
            const display = typeof auditRow?.Display === 'string' ? this.toSingleLine(auditRow.Display) : '';

            if ( !display ) {
                skippedCount++;
                return;
            }

            const objectMatcher = objectMatchers.find(candidate => candidate.patterns.some(pattern => pattern.test(display)));
            if ( !objectMatcher ) {
                return;
            }

            const changedBy = this.asRecord(auditRow.CreatedBy)?.Name;
            const changedByText = typeof changedBy === 'string' && this.toSingleLine(changedBy) ? ` · ${this.toSingleLine(changedBy)}` : '';
            matchedRows.push({
                objectApiName: objectMatcher.objectApiName,
                text: `${display}${changedByText}`.slice(0, HINT_TEXT_MAX_LENGTH),
                changedAt: this.readDateTime(auditRow.CreatedDate)
            });

        });

        return this.toHintList(matchedRows, skippedCount);

    }

    /*
        Each object's CUSTOM child objects the tree does not hold, from the describe's child
        relationships: by object, sorted with "<", each child and field once, at most
        ORG_CHANGE_CHILD_OBJECT_LIMIT, and an object with none left out.
    */
    static listNewChildObjects(describedObjects: readonly IOrgDescribedChildRelationships[], treeObjectApiNames: readonly string[]): Map<string, { childObjects: IOrgNewChildObject[]; moreCount: number }> {

        const treeLowerNames = new Set(treeObjectApiNames.map(objectApiName => objectApiName.toLowerCase()));
        const newChildObjectsByObject = new Map<string, { childObjects: IOrgNewChildObject[]; moreCount: number }>();

        describedObjects.forEach(describedObject => {

            const seenKeys = new Set<string>();
            const childObjects = ( describedObject.childRelationships ?? [] )
                .filter(childRelationship => CUSTOM_FIELD_NAME_PATTERN.test(childRelationship.childObjectApiName)
                    && SalesforceApiName.isApiName(childRelationship.childObjectApiName)
                    && SalesforceApiName.isApiName(childRelationship.fieldApiName)
                    && !treeLowerNames.has(childRelationship.childObjectApiName.toLowerCase()))
                .filter(childRelationship => {
                    const key = `${childRelationship.childObjectApiName.toLowerCase()}\n${childRelationship.fieldApiName.toLowerCase()}`;
                    return seenKeys.has(key) ? false : ( seenKeys.add(key), true );
                })
                .map(childRelationship => ({ childObjectApiName: childRelationship.childObjectApiName, fieldApiName: childRelationship.fieldApiName }))
                .sort((first, second) => first.childObjectApiName !== second.childObjectApiName
                    ? ( first.childObjectApiName < second.childObjectApiName ? -1 : 1 )
                    : ( first.fieldApiName < second.fieldApiName ? -1 : first.fieldApiName > second.fieldApiName ? 1 : 0 ));

            if ( childObjects.length > 0 ) {
                newChildObjectsByObject.set(describedObject.objectApiName, {
                    childObjects: childObjects.slice(0, ORG_CHANGE_CHILD_OBJECT_LIMIT),
                    moreCount: Math.max(childObjects.length - ORG_CHANGE_CHILD_OBJECT_LIMIT, 0)
                });
            }

        });

        return newChildObjectsByObject;

    }

    private static readQueryRecords(queryResult: unknown, hintName: string): unknown[] {

        const queryRecords = this.asRecord(queryResult)?.records;

        if ( !Array.isArray(queryRecords) ) {
            throw new Error(`The org answered ${hintName} with no records list.`);
        }

        return queryRecords;

    }

    private static toHintList(matchedRows: IOrgChangeHintRow[], skippedCount: number): IOrgChangeHintList {
        return {
            rows: matchedRows.slice(0, ORG_CHANGE_HINT_ROW_LIMIT),
            moreCount: Math.max(matchedRows.length - ORG_CHANGE_HINT_ROW_LIMIT, 0),
            skippedCount: skippedCount
        };
    }

    private static readDateTime(candidate: unknown): string {
        return typeof candidate === 'string' && ORG_DATE_TIME_PATTERN.test(candidate) ? candidate : '';
    }

    // ONLY A PLAIN ERROR CODE IS SHOWN: AN ERROR'S MESSAGE IS THE ORG'S OR THE CONNECTION'S TEXT
    private static readErrorCode(queryError: unknown): string | undefined {
        const errorCode = this.asRecord(queryError)?.errorCode;
        return typeof errorCode === 'string' && ORG_ERROR_CODE_PATTERN.test(errorCode) ? errorCode : undefined;
    }

    private static describeErrorCode(queryError: unknown): string {
        const errorCode = this.readErrorCode(queryError);
        return errorCode ? ` (${errorCode})` : '';
    }

    // WHAT DIFFERS BETWEEN THE PROJECT'S FIELD AND THE ORG'S, ONE LINE EACH, IN A FIXED ORDER
    static compareFields(localField: IComparedField, stagedField: IComparedField): string[] {

        const differences: string[] = [];
        const scalarKeys: (keyof Omit<IComparedField, 'picklistValues' | 'fieldLabel'>)[] = ['fieldType', 'length', 'precision', 'scale', 'required', 'referenceTo', 'valueSetName'];
        const keyLabels: Record<string, string> = { fieldType: 'type', valueSetName: 'value set', referenceTo: 'lookup to' };

        scalarKeys.forEach(key => {
            if ( localField[key] !== stagedField[key] ) {
                differences.push(`${keyLabels[key] ?? key}: ${this.showValue(localField[key])} → ${this.showValue(stagedField[key])}`);
            }
        });

        const localValues = new Set(localField.picklistValues);
        const stagedValues = new Set(stagedField.picklistValues);
        const addedValues = stagedField.picklistValues.filter(value => !localValues.has(value));
        const removedValues = localField.picklistValues.filter(value => !stagedValues.has(value));

        if ( addedValues.length > 0 ) {
            differences.push(`picklist values added: ${this.showList(addedValues)}`);
        }
        if ( removedValues.length > 0 ) {
            differences.push(`picklist values removed: ${this.showList(removedValues)}`);
        }

        return differences;

    }

    private static showValue(value: string): string {
        return value === '' ? 'none' : value;
    }

    private static showList(values: readonly string[]): string {
        const shown = values.slice(0, DIFFERENCE_PICKLIST_VALUES_SHOWN).join(', ');
        return values.length > DIFFERENCE_PICKLIST_VALUES_SHOWN ? `${shown} and ${values.length - DIFFERENCE_PICKLIST_VALUES_SHOWN} more` : shown;
    }

    /*
        An object's field files, by lower-cased field name (Salesforce reads names case-insensitively),
        the first folder holding a name winning. A fields folder that is a link is not listed, a link
        or anything not a plain file is skipped, and a file name that is not an api name is not read.
    */
    private static listFieldFiles(objectFolderPaths: readonly string[]): Map<string, { fieldApiName: string; filePath: string }> {

        const fieldFiles = new Map<string, { fieldApiName: string; filePath: string }>();

        objectFolderPaths.forEach(objectFolderPath => {
            RecipeCockpitMetadataDeploy.listSubfolderEntries(objectFolderPath, 'fields')
                .filter(entry => entry.isFile() && entry.name.endsWith(FIELD_FILE_SUFFIX))
                .map(entry => entry.name)
                .sort()
                .forEach(fileName => {
                    const fieldApiName = fileName.slice(0, -FIELD_FILE_SUFFIX.length);
                    if ( SalesforceApiName.isApiName(fieldApiName) && !fieldFiles.has(fieldApiName.toLowerCase()) ) {
                        fieldFiles.set(fieldApiName.toLowerCase(), { fieldApiName: fieldApiName, filePath: path.join(objectFolderPath, 'fields', fileName) });
                    }
                });
        });

        return fieldFiles;

    }

    // ONE FIELD FILE, READ THROUGH ONE HANDLE THAT REFUSES A LINK, HELD TO A SIZE AND PARSED; UNDEFINED WHEN IT CANNOT BE
    private static async readComparedField(filePath: string): Promise<IComparedField | undefined> {

        const fieldXml = this.readFieldFileText(filePath);

        if ( fieldXml === undefined ) {
            return undefined;
        }

        let parsed: unknown;
        try {
            parsed = await xml2js.parseStringPromise(fieldXml);
        } catch {
            return undefined;
        }

        const customField = this.asRecord(this.asRecord(parsed)?.CustomField);

        if ( !customField ) {
            return undefined;
        }

        const valueSet = this.asRecord(this.firstOf(customField.valueSet));
        const valueSetDefinition = this.asRecord(this.firstOf(valueSet?.valueSetDefinition));
        const picklistValues = ( Array.isArray(valueSetDefinition?.value) ? valueSetDefinition.value as unknown[] : [] )
            .map(value => this.readText(this.asRecord(value)?.fullName))
            .filter(value => value !== '');

        return {
            fieldType: this.readText(customField.type),
            fieldLabel: this.readText(customField.label),
            length: this.readText(customField.length),
            precision: this.readText(customField.precision),
            scale: this.readText(customField.scale),
            // A FIELD WITH NO <required> IS NOT REQUIRED, AS SALESFORCE READS IT
            required: this.readText(customField.required) || 'false',
            referenceTo: this.readText(customField.referenceTo),
            valueSetName: this.readText(valueSet?.valueSetName),
            picklistValues: picklistValues
        };

    }

    // A FIELD FILE'S TEXT, READ THROUGH ONE HANDLE THAT REFUSES A LINK AND HELD TO A SIZE; UNDEFINED WHEN IT CANNOT BE
    private static readFieldFileText(filePath: string): string | undefined {

        try {
            const fileHandle = fs.openSync(filePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            try {
                const fileStat = fs.fstatSync(fileHandle);
                if ( !fileStat.isFile() || fileStat.size > FIELD_FILE_MAX_BYTES ) {
                    return undefined;
                }
                return fs.readFileSync(fileHandle, 'utf-8');
            } finally {
                fs.closeSync(fileHandle);
            }
        } catch {
            return undefined;
        }

    }

    private static firstOf(candidate: unknown): unknown {
        return Array.isArray(candidate) ? candidate[0] : candidate;
    }

    // ONE XML TEXT VALUE AS ONE SHORT LINE; A NON-TEXT VALUE (AN ELEMENT WITH CHILDREN) READS AS NONE
    private static readText(candidate: unknown): string {
        const first = this.firstOf(candidate);
        return typeof first === 'string' ? this.toSingleLine(first).slice(0, DIFFERENCE_VALUE_MAX_LENGTH) : '';
    }

    private static toSingleLine(text: string): string {
        return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
    }

    private static asRecord(candidate: unknown): Record<string, unknown> | undefined {
        return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : undefined;
    }

}
