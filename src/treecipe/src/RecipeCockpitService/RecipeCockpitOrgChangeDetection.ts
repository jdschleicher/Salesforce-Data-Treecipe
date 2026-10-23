import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ORG_OPERATIONS_FOLDER_NAME, ORG_OPERATION_RESULT_FILE_ATTEMPTS, ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { METADATA_DEPLOY_PACKAGE_XML_SUFFIX, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';

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

                const stagedField = await this.readComparedField(stagedFile.filePath);

                if ( !stagedField ) {
                    unreadableFieldCount++;
                    continue;
                }

                const localFile = localFieldFiles.get(lowerFieldName);

                if ( !localFile ) {
                    if ( CUSTOM_FIELD_NAME_PATTERN.test(stagedFile.fieldApiName) ) {
                        fieldChanges.push({ fieldApiName: stagedFile.fieldApiName, status: 'new', fieldType: stagedField.fieldType, fieldLabel: stagedField.fieldLabel, differences: [] });
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

        return objectChanges;

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

        let fieldXml: string;

        try {
            const fileHandle = fs.openSync(filePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            try {
                const fileStat = fs.fstatSync(fileHandle);
                if ( !fileStat.isFile() || fileStat.size > FIELD_FILE_MAX_BYTES ) {
                    return undefined;
                }
                fieldXml = fs.readFileSync(fileHandle, 'utf-8');
            } finally {
                fs.closeSync(fileHandle);
            }
        } catch {
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
