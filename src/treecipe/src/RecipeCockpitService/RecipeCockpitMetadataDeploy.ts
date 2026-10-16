import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ORG_OPERATIONS_FOLDER_NAME, ORG_OPERATION_RESULT_FILE_ATTEMPTS, ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    The Troubleshooting tab's deploys (#346): what one relationship tree would deploy -- its custom
    fields, the global value sets those fields name, its objects' record types, or permission sets --
    found in the project's STRICT package directories, the package.xml that names exactly those
    members, the argv that deploys it, and the CLI's answer read back. It imports no vscode: the
    cockpit owns the org, the confirmation, the progress and the notification.

    Only the four types below are ever written into a package.xml, and only custom fields (__c):
    never a CustomObject, a layout, a list view or anything else in an object folder, so an unrelated
    broken file cannot fail the deploy. Every member is an api name before it is written.
*/

export type MetadataDeployKind = 'permissionSet' | 'fields' | 'globalValueSets' | 'recordTypes';

export type MetadataDeployType = 'PermissionSet' | 'CustomField' | 'GlobalValueSet' | 'RecordType';

export const METADATA_DEPLOY_TYPES: readonly MetadataDeployType[] = Object.freeze(['CustomField', 'GlobalValueSet', 'PermissionSet', 'RecordType'] as MetadataDeployType[]);

export const METADATA_DEPLOY_TYPE_BY_KIND: Readonly<Record<MetadataDeployKind, MetadataDeployType>> = Object.freeze({
    permissionSet: 'PermissionSet',
    fields: 'CustomField',
    globalValueSets: 'GlobalValueSet',
    recordTypes: 'RecordType'
});

export const METADATA_DEPLOY_OPERATION_BY_KIND = Object.freeze({
    permissionSet: 'permission-set-deploy',
    fields: 'field-deploy',
    globalValueSets: 'global-value-set-deploy',
    recordTypes: 'record-type-deploy'
} as const);

export type MetadataDeployOperationName = typeof METADATA_DEPLOY_OPERATION_BY_KIND[MetadataDeployKind];

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects OR globalValueSets FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const METADATA_DEPLOY_SEARCH_DEPTH = 6;

// HOW MANY COMPONENTS THE CONFIRMATION NAMES BEFORE IT COUNTS THE REST
export const METADATA_DEPLOY_CONFIRMATION_SHOWN = 20;

// HOW MANY COMPONENT FAILURES A NOTIFICATION NAMES BEFORE IT COUNTS THE REST
export const METADATA_DEPLOY_FAILURES_SHOWN = 5;

export const METADATA_DEPLOY_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

// HOW MANY FIELD FILES ARE READ BEFORE THE SUMMARY HANDS THE EXTENSION HOST BACK TO ITS EVENT LOOP
export const METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES = 200;

export const METADATA_DEPLOY_PACKAGE_XML_SUFFIX = '-package.xml';

const FIELD_FILE_SUFFIX = '.field-meta.xml';
const RECORD_TYPE_FILE_SUFFIX = '.recordType-meta.xml';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';

// ONLY A CUSTOM FIELD OF THE OBJECT ITSELF IS DEPLOYED; __pc, __Latitude__s AND STANDARD FIELDS ARE NOT
const CUSTOM_FIELD_NAME_PATTERN = /__c$/;

const API_VERSION_PATTERN = /^[1-9][0-9]{1,2}\.0$/;

export interface IMetadataDeployComponent {
    type: MetadataDeployType;
    member: string;
}

export interface IMetadataDeployObject {
    objectApiName: string;
    fieldApiNames: string[];
}

/*
    What a tree holds in the project, per section. Every list is sorted with "<" and names a member
    the way package.xml does ("<Object>.<Field>", "<Object>.<DeveloperName>", "<Name>").
*/
export interface IMetadataDeploySummary {
    // CUSTOM FIELDS WHOSE SOURCE XML WAS FOUND AND READ AS A <CustomField>
    customFields: string[];
    // STANDARD FIELDS: NEVER DEPLOYED, LISTED SO THE READER KNOWS THEY WERE LEFT OUT ON PURPOSE
    standardFields: string[];
    // CUSTOM FIELDS WHOSE SOURCE XML IS MISSING OR CANNOT BE READ: LEFT OUT, NEVER GUESSED AT
    unreadableFields: string[];
    // GLOBAL VALUE SETS A FIELD NAMES THAT THE PROJECT HOLDS
    globalValueSets: string[];
    // GLOBAL VALUE SETS A FIELD NAMES THAT THE PROJECT DOES NOT HOLD
    missingGlobalValueSets: string[];
    recordTypes: string[];
    // OBJECT, FIELD, VALUE SET OR RECORD TYPE NAMES THAT ARE NOT API NAMES, SO NOTHING WAS OFFERED FOR THEM
    skippedNameCount: number;
}

export type MetadataDeployOutcome =
    | { kind: 'deployed'; deployedComponentCount: number }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    | { kind: 'unconfirmed'; failureMessage: string }
    | { kind: 'failed'; failureMessage: string; componentFailureCount: number; componentFailureMessages: string[] };

export class RecipeCockpitMetadataDeploy {

    static isCustomFieldName(fieldApiName: unknown): fieldApiName is string {
        return SalesforceApiName.isApiName(fieldApiName) && CUSTOM_FIELD_NAME_PATTERN.test(fieldApiName);
    }

    // A MEMBER IS WRITTEN ONLY IF EVERY PART OF IT IS AN API NAME, IN THE SHAPE ITS TYPE NAMES ONE
    static isDeployableMember(type: MetadataDeployType, member: unknown): member is string {

        if ( typeof member !== 'string' ) {
            return false;
        }

        if ( type === 'PermissionSet' || type === 'GlobalValueSet' ) {
            return SalesforceApiName.isApiName(member);
        }

        const parts = member.split('.');
        if ( parts.length !== 2 || !SalesforceApiName.isApiName(parts[0]) ) {
            return false;
        }

        return type === 'CustomField' ? this.isCustomFieldName(parts[1]) : SalesforceApiName.isApiName(parts[1]);

    }

    // EVERY FOLDER NAMED folderName UNDER THE PACKAGE DIRECTORIES, NO LINK FOLLOWED, EACH INSIDE THE WORKSPACE
    static findMetadataFolderPaths(workspaceRoot: string, packageDirectoryPaths: readonly string[], folderName: string): string[] {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const foundFolderPaths: string[] = [];
        const visitedFolderPaths = new Set<string>();

        const walk = (folderPath: string, depth: number) => {

            if ( visitedFolderPaths.has(folderPath) ) {
                return;
            }
            visitedFolderPaths.add(folderPath);

            this.listEntries(folderPath)
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
                .map(entry => entry.name)
                // sort() WITH NO COMPARATOR ORDERS BY UTF-16 CODE UNIT, AS "<" DOES -- NEVER localeCompare
                .sort()
                .forEach(childName => {
                    const childPath = path.join(folderPath, childName);
                    if ( childName === folderName ) {
                        foundFolderPaths.push(childPath);
                    } else if ( depth < METADATA_DEPLOY_SEARCH_DEPTH ) {
                        walk(childPath, depth + 1);
                    }
                });

        };

        new Set(packageDirectoryPaths.map(packageDirectoryPath => path.resolve(resolvedWorkspaceRoot, packageDirectoryPath))).forEach(packageDirectoryPath => {
            if ( SfdxProjectService.isPathContainedInWorkspace(packageDirectoryPath, resolvedWorkspaceRoot) ) {
                walk(packageDirectoryPath, 1);
            }
        });

        return foundFolderPaths.filter(folderPath => SfdxProjectService.isPathContainedInWorkspace(folderPath, resolvedWorkspaceRoot));

    }

    /*
        Every folder of each tree object under an objects folder of a package directory, matched
        case-insensitively as Salesforce reads names, in package directory order: an unlocked-package
        project can keep one object's fields in several package directories, and the CLI deploys a
        member from whichever holds it.
    */
    static findObjectFolderPaths(workspaceRoot: string, packageDirectoryPaths: readonly string[], objectApiNames: readonly string[]): Map<string, string[]> {

        const objectApiNameByLowerName = new Map(objectApiNames.map(objectApiName => [objectApiName.toLowerCase(), objectApiName]));
        const objectFolderPathsByObject = new Map<string, string[]>();

        this.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'objects').forEach(objectsFolderPath => {
            this.listEntries(objectsFolderPath)
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .sort()
                .forEach(objectFolderName => {
                    const objectApiName = objectApiNameByLowerName.get(objectFolderName.toLowerCase());
                    if ( objectApiName ) {
                        objectFolderPathsByObject.set(objectApiName, [...( objectFolderPathsByObject.get(objectApiName) ?? [] ), path.join(objectsFolderPath, objectFolderName)]);
                    }
                });
        });

        return objectFolderPathsByObject;

    }

    // EVERY GLOBAL VALUE SET THE PROJECT HOLDS, BY LOWER-CASED NAME, AS ITS FILE SPELLS IT; THE FIRST PACKAGE DIRECTORY WINS
    static findGlobalValueSetNames(workspaceRoot: string, packageDirectoryPaths: readonly string[]): Map<string, string> {

        const globalValueSetNamesByLowerName = new Map<string, string>();

        this.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'globalValueSets').forEach(folderPath => {
            this.listEntries(folderPath)
                .filter(entry => entry.isFile() && entry.name.endsWith(GLOBAL_VALUE_SET_FILE_SUFFIX))
                .map(entry => entry.name.slice(0, -GLOBAL_VALUE_SET_FILE_SUFFIX.length))
                .sort()
                .forEach(globalValueSetName => {
                    if ( !globalValueSetNamesByLowerName.has(globalValueSetName.toLowerCase()) ) {
                        globalValueSetNamesByLowerName.set(globalValueSetName.toLowerCase(), globalValueSetName);
                    }
                });
        });

        return globalValueSetNamesByLowerName;

    }

    // A FIELD'S <valueSet><valueSetName>; undefined FOR A FILE THAT IS NOT A <CustomField>, '' FOR ONE NAMING NONE
    static async readValueSetName(fieldXml: string): Promise<string | undefined> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(fieldXml);
        } catch {
            return undefined;
        }

        const customField = ( parsedXml as Record<string, unknown> | null )?.CustomField;
        if ( typeof customField === 'string' ) {
            return '';
        }
        if ( !customField || typeof customField !== 'object' || Array.isArray(customField) ) {
            return undefined;
        }

        const valueSets = ( customField as Record<string, unknown> ).valueSet;
        const valueSet = Array.isArray(valueSets) ? valueSets[0] : undefined;
        const valueSetNames = valueSet !== null && typeof valueSet === 'object' ? ( valueSet as Record<string, unknown> ).valueSetName : undefined;
        const valueSetName = Array.isArray(valueSetNames) ? valueSetNames[0] : undefined;

        return typeof valueSetName === 'string' ? valueSetName.trim() : '';

    }

    /*
        What the tree holds per section. Fields are the tree's recipe fields (the caller leaves out
        excluded objects and unticked fields); a custom field counts only when its source XML is
        found under its object's folder and reads as a <CustomField>. Every field file found is read
        once, for the global value set it names. Record types are every *.recordType-meta.xml in each
        tree object's recordTypes folder.
    */
    static async summarizeTreeMetadata(workspaceRoot: string, packageDirectoryPaths: readonly string[], deployObjects: readonly IMetadataDeployObject[]): Promise<IMetadataDeploySummary> {

        const summary: IMetadataDeploySummary = { customFields: [], standardFields: [], unreadableFields: [], globalValueSets: [], missingGlobalValueSets: [], recordTypes: [], skippedNameCount: 0 };
        const fieldApiNamesByObject = new Map<string, Set<string>>();

        deployObjects.forEach(deployObject => {

            if ( !SalesforceApiName.isApiName(deployObject.objectApiName) ) {
                summary.skippedNameCount++;
                return;
            }

            const fieldApiNames = fieldApiNamesByObject.get(deployObject.objectApiName) ?? new Set<string>();
            fieldApiNamesByObject.set(deployObject.objectApiName, fieldApiNames);
            deployObject.fieldApiNames.forEach(fieldApiName => {
                if ( SalesforceApiName.isApiName(fieldApiName) ) {
                    fieldApiNames.add(fieldApiName);
                } else {
                    summary.skippedNameCount++;
                }
            });

        });

        const objectApiNames = [...fieldApiNamesByObject.keys()].sort();
        const objectFolderPathsByObject = this.findObjectFolderPaths(workspaceRoot, packageDirectoryPaths, objectApiNames);
        const namedValueSetNames = new Set<string>();
        const recordTypes = new Set<string>();
        let readFileCount = 0;

        for ( const objectApiName of objectApiNames ) {

            const objectFolderPaths = objectFolderPathsByObject.get(objectApiName) ?? [];
            // THE FIRST FOLDER HOLDING A FIELD'S FILE WINS
            const fieldFilePathsByLowerName = new Map<string, string>();
            objectFolderPaths.forEach(objectFolderPath => {
                this.listSubfolderEntries(objectFolderPath, 'fields')
                    .filter(entry => entry.isFile() && entry.name.endsWith(FIELD_FILE_SUFFIX))
                    .filter(entry => !fieldFilePathsByLowerName.has(entry.name.toLowerCase()))
                    .forEach(entry => fieldFilePathsByLowerName.set(entry.name.toLowerCase(), path.join(objectFolderPath, 'fields', entry.name)));
            });

            for ( const fieldApiName of [...( fieldApiNamesByObject.get(objectApiName) as Set<string> )].sort() ) {

                const member = `${objectApiName}.${fieldApiName}`;
                const isCustomField = this.isCustomFieldName(fieldApiName);
                const fieldFilePath = fieldFilePathsByLowerName.get(`${fieldApiName}${FIELD_FILE_SUFFIX}`.toLowerCase());

                let valueSetName: string | undefined;
                if ( fieldFilePath ) {
                    readFileCount++;
                    if ( readFileCount % METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES === 0 ) {
                        await new Promise<void>(resolve => setImmediate(resolve));
                    }
                    try {
                        valueSetName = await this.readValueSetName(fs.readFileSync(fieldFilePath, 'utf-8'));
                    } catch {
                        valueSetName = undefined;
                    }
                }

                if ( valueSetName ) {
                    if ( SalesforceApiName.isApiName(valueSetName) ) {
                        namedValueSetNames.add(valueSetName);
                    } else {
                        summary.skippedNameCount++;
                    }
                }

                if ( !isCustomField ) {
                    summary.standardFields.push(member);
                } else if ( valueSetName === undefined ) {
                    summary.unreadableFields.push(member);
                } else {
                    summary.customFields.push(member);
                }

            }

            for ( const objectFolderPath of objectFolderPaths ) {
                this.listSubfolderEntries(objectFolderPath, 'recordTypes')
                    .filter(entry => entry.isFile() && entry.name.endsWith(RECORD_TYPE_FILE_SUFFIX))
                    .map(entry => entry.name.slice(0, -RECORD_TYPE_FILE_SUFFIX.length))
                    .forEach(developerName => {
                        if ( SalesforceApiName.isApiName(developerName) ) {
                            recordTypes.add(`${objectApiName}.${developerName}`);
                        } else {
                            summary.skippedNameCount++;
                        }
                    });
            }

        }

        const projectValueSetNamesByLowerName = namedValueSetNames.size > 0 ? this.findGlobalValueSetNames(workspaceRoot, packageDirectoryPaths) : new Map<string, string>();
        const heldValueSetNames = new Set<string>();
        const missingValueSetNames = new Set<string>();
        namedValueSetNames.forEach(valueSetName => {
            const projectName = projectValueSetNamesByLowerName.get(valueSetName.toLowerCase());
            if ( projectName && SalesforceApiName.isApiName(projectName) ) {
                heldValueSetNames.add(projectName);
            } else {
                missingValueSetNames.add(valueSetName);
            }
        });

        summary.globalValueSets = [...heldValueSetNames].sort();
        summary.missingGlobalValueSets = [...missingValueSetNames].sort();
        summary.recordTypes = [...recordTypes].sort();

        return summary;

    }

    static listSummaryComponents(summary: IMetadataDeploySummary, deployKind: Exclude<MetadataDeployKind, 'permissionSet'>): IMetadataDeployComponent[] {

        const members = deployKind === 'fields' ? summary.customFields
            : deployKind === 'globalValueSets' ? summary.globalValueSets
            : summary.recordTypes;

        return members.map(member => ({ type: METADATA_DEPLOY_TYPE_BY_KIND[deployKind], member: member }));

    }

    static escapeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

    }

    // A VERSION ONLY IN THE SHAPE sfdx-project.json's sourceApiVersion TAKES; ANYTHING ELSE IS LEFT OUT AND THE CLI CHOOSES
    static readApiVersion(sourceApiVersion: unknown): string | undefined {
        return typeof sourceApiVersion === 'string' && API_VERSION_PATTERN.test(sourceApiVersion) ? sourceApiVersion : undefined;
    }

    /*
        The package.xml naming exactly these components, built the same way on every machine: types
        and members sorted with "<", duplicates once. Throws, writing nothing, for a type outside the
        four this tab deploys, a member that is not an api name in its type's shape, or no component.
    */
    static buildPackageXml(components: readonly IMetadataDeployComponent[], apiVersion?: string): string {

        if ( components.length === 0 ) {
            throw new Error('No component was named, so nothing was deployed.');
        }

        const membersByType = new Map<MetadataDeployType, Set<string>>();

        components.forEach(component => {

            if ( !METADATA_DEPLOY_TYPES.includes(component.type) ) {
                throw new Error(`"${String(component.type).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a type the Troubleshooting tab deploys, so nothing was deployed.`);
            }

            if ( !this.isDeployableMember(component.type, component.member) ) {
                throw new Error(`"${String(component.member).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a ${component.type} api name, so nothing was deployed.`);
            }

            const members = membersByType.get(component.type) ?? new Set<string>();
            membersByType.set(component.type, members);
            members.add(component.member);

        });

        const version = this.readApiVersion(apiVersion);

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
            ...[...membersByType.keys()].sort().flatMap(type => [
                '    <types>',
                ...[...( membersByType.get(type) as Set<string> )].sort().map(member => `        <members>${this.escapeXmlText(member)}</members>`),
                `        <name>${type}</name>`,
                '    </types>'
            ]),
            ...( version ? [`    <version>${version}</version>`] : [] ),
            '</Package>',
            ''
        ].join('\n');

    }

    /*
        treecipe/OrgOperations/<username>/<yyyyMMdd-HHmmss>-<operation>-package.xml, beside the CLI
        results the cockpit saves. Built here, never from a panel message; undefined when the folder
        name could name another folder or the path would land outside the workspace.
    */
    static buildPackageXmlFilePath(workspaceRoot: string, orgUsername: string, operationName: MetadataDeployOperationName, date: Date): string | undefined {

        if ( !ScratchOrgService.isUsableOrgOperationFolderName(orgUsername) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const packageXmlFilePath = path.join(resolvedWorkspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, orgUsername, `${ScratchOrgService.buildCompactTimestamp(date)}-${operationName}${METADATA_DEPLOY_PACKAGE_XML_SUFFIX}`);

        return SfdxProjectService.isPathContainedInWorkspace(packageXmlFilePath, resolvedWorkspaceRoot) ? packageXmlFilePath : undefined;

    }

    /*
        Writes the package.xml and answers where, or undefined when it could not. The folder is made
        and then checked again, since a link in its place would take the write out of the workspace;
        the file is written with "wx", so a link planted at its name is never followed, and two
        deploys in one second take the first free of <name>, <name>-2, ...
    */
    static writePackageXml(workspaceRoot: string, packageXmlFilePath: string, packageXml: string): string | undefined {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

        if ( !SfdxProjectService.isPathContainedInWorkspace(packageXmlFilePath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        try {
            fs.mkdirSync(path.dirname(packageXmlFilePath), { recursive: true });
            ScratchOrgService.writeOrgOperationsGitignore(resolvedWorkspaceRoot);
        } catch {
            return undefined;
        }

        if ( !SfdxProjectService.isPathContainedInWorkspace(path.dirname(packageXmlFilePath), resolvedWorkspaceRoot) ) {
            return undefined;
        }

        for ( let attempt = 1; attempt <= ORG_OPERATION_RESULT_FILE_ATTEMPTS; attempt++ ) {
            const attemptFilePath = attempt === 1
                ? packageXmlFilePath
                : packageXmlFilePath.slice(0, -METADATA_DEPLOY_PACKAGE_XML_SUFFIX.length) + `-${attempt}${METADATA_DEPLOY_PACKAGE_XML_SUFFIX}`;
            try {
                fs.writeFileSync(attemptFilePath, packageXml, { encoding: 'utf-8', flag: 'wx' });
                return attemptFilePath;
            } catch (writeError) {
                if ( ( writeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    // THE MANIFEST RELATIVE TO THE WORKSPACE, "/"-SEPARATED: THE CLI RUNS WITH THE WORKSPACE AS ITS cwd
    static toManifestRelativePath(workspaceRoot: string, packageXmlFilePath: string): string {
        return path.relative(path.resolve(workspaceRoot), packageXmlFilePath).split(path.sep).join('/');
    }

    // ERRORS ARE NEVER IGNORED: A DEPLOY THAT CANNOT LAND WHOLE LANDS NOTHING
    static buildMetadataDeployArguments(manifestRelativePath: string, orgUsername: string): string[] {

        const manifestSegments = String(manifestRelativePath).split('/');

        if ( manifestRelativePath === ''
                || path.isAbsolute(manifestRelativePath)
                || /^[A-Za-z]:/.test(manifestRelativePath)
                || /[\\\0\r\n]/.test(manifestRelativePath)
                || manifestRelativePath.startsWith('-')
                || manifestSegments.some(segment => segment === '' || segment === '.' || segment === '..')
                || !manifestRelativePath.endsWith(METADATA_DEPLOY_PACKAGE_XML_SUFFIX) ) {
            throw new Error('The package.xml path is not a plain path inside the workspace, so nothing was deployed.');
        }

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'deploy', 'start',
            '--json',
            '--target-org', orgUsername,
            '--manifest', manifestRelativePath
        ];

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI is required to deploy metadata, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    /*
        The deploy's answer, type-checked: it landed only on status 0, result.success exactly true
        and no component failure (readDeployComponentCounts). Each component failure is named by
        what the CLI said, so the notification can say which component and why.
    */
    static parseMetadataDeployOutput(invocationResult: ISalesforceCliInvocationResult,
                                        payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataDeployOutcome {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}`, componentFailureCount: 0, componentFailureMessages: [] };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: 'The Salesforce CLI\'s answer was too large to read, so whether the deploy landed is unknown.' };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: 'The deploy did not finish in time and was stopped, so whether it landed is unknown.' };
        }

        const deployComponentCounts = ScratchOrgService.readDeployComponentCounts(payload);

        if ( deployComponentCounts.isSucceeded ) {
            return { kind: 'deployed', deployedComponentCount: deployComponentCounts.numberComponentsDeployed ?? deployComponentCounts.componentSuccessCount };
        }

        return {
            kind: 'failed',
            failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult),
            componentFailureCount: deployComponentCounts.componentFailureCount,
            componentFailureMessages: this.readComponentFailureMessages(payload)
        };

    }

    static readComponentFailureMessages(payload: Record<string, unknown> | undefined): string[] {

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result) ? payload.result as Record<string, unknown> : undefined;
        const details = result?.details !== null && typeof result?.details === 'object' ? result.details as Record<string, unknown> : undefined;
        const failures = Array.isArray(details?.componentFailures) ? details.componentFailures
            : details?.componentFailures !== null && typeof details?.componentFailures === 'object' ? [details.componentFailures] : [];
        const toSingleLine = (text: string) => text.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim();

        return [...new Set(failures
            .filter((failure): failure is Record<string, unknown> => failure !== null && typeof failure === 'object' && !Array.isArray(failure))
            .map(failure => {
                const fullName = typeof failure.fullName === 'string' ? toSingleLine(failure.fullName) : 'a component';
                const problem = typeof failure.problem === 'string' && failure.problem.trim() !== '' ? toSingleLine(failure.problem) : 'it could not be deployed';
                return `${fullName}: ${ScratchOrgService.redactSecretText(problem)}`;
            }))];

    }

    // A CAPPED LIST, THE REST COUNTED
    static describeCappedList(items: readonly string[], shownCount: number = METADATA_DEPLOY_CONFIRMATION_SHOWN): string {

        const shownItems = items.slice(0, shownCount);
        const hiddenCount = items.length - shownItems.length;

        return `${shownItems.join(', ')}${hiddenCount > 0 ? ` and ${hiddenCount} more` : ''}`;

    }

    // THE CONFIRMATION'S DETAIL, EACH VALUE ON ONE LINE AND WITH NO PARENTHESES OF ITS OWN, SINCE THE CALLER ESCAPES IT FOR A NOTIFICATION
    static buildConfirmationDetail(deployKind: MetadataDeployKind,
                                    treeLabel: string,
                                    orgLabel: string,
                                    packageDirectoryRelativePath: string,
                                    components: readonly IMetadataDeployComponent[],
                                    summary?: IMetadataDeploySummary,
                                    hasFileOrEnvironmentReplacements = false): string {

        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
        const type = METADATA_DEPLOY_TYPE_BY_KIND[deployKind];
        const members = [...new Set(components.map(component => component.member))].sort();
        const notes: string[] = [];

        if ( summary && deployKind === 'fields' ) {
            if ( summary.standardFields.length > 0 ) {
                notes.push(`Not deployed: standard fields — the org enables these through a feature or setting: ${this.describeCappedList(summary.standardFields)}`);
            }
            if ( summary.unreadableFields.length > 0 ) {
                notes.push(`Not deployed: ${summary.unreadableFields.length} custom ${summary.unreadableFields.length === 1 ? 'field' : 'fields'} whose source file is missing or could not be read: ${this.describeCappedList(summary.unreadableFields)}`);
            }
        }

        if ( summary && deployKind === 'globalValueSets' && summary.missingGlobalValueSets.length > 0 ) {
            notes.push(`Not deployed: ${summary.missingGlobalValueSets.length} global value ${summary.missingGlobalValueSets.length === 1 ? 'set' : 'sets'} a field names that this project does not hold: ${this.describeCappedList(summary.missingGlobalValueSets)}`);
        }

        if ( summary && summary.skippedNameCount > 0 ) {
            notes.push(`Skipped: ${summary.skippedNameCount} ${summary.skippedNameCount === 1 ? 'name that is' : 'names that are'} not a Salesforce api name.`);
        }

        return [
            `Tree: ${toSingleLine(treeLabel)}`,
            `Org: ${toSingleLine(orgLabel)}`,
            `From: ${toSingleLine(packageDirectoryRelativePath)}`,
            `${members.length} ${type}: ${this.describeCappedList(members)}`,
            ...notes,
            '',
            'Only these components are deployed, through a generated package.xml. Nothing else in the object folders is.',
            ...( hasFileOrEnvironmentReplacements
                ? ['sfdx-project.json has "replacements" that copy local files or environment variables into the deployed metadata.']
                : [] )
        ].join('\n');

    }

    // A fields OR recordTypes FOLDER THAT IS A LINK IS NEVER LISTED: ITS FILES COULD BE ANYWHERE
    private static listSubfolderEntries(objectFolderPath: string, subfolderName: string): fs.Dirent[] {

        const subfolderPath = path.join(objectFolderPath, subfolderName);

        try {
            if ( !fs.lstatSync(subfolderPath).isDirectory() ) {
                return [];
            }
        } catch {
            return [];
        }

        return this.listEntries(subfolderPath);

    }

    private static listEntries(folderPath: string): fs.Dirent[] {
        try {
            return fs.readdirSync(folderPath, { withFileTypes: true });
        } catch {
            return [];
        }
    }

}
