import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { MetadataDeployOutcome, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';

/*
    "Deploy & assign permission sets…" (#274): the project's permission sets that grant anything on
    one relationship tree's objects, the argv that deploys the ones the reader picked and the argv
    that assigns them to the user the org is authorized as, and both of the CLI's answers read back.
    It imports no vscode: the cockpit owns the pick, the org, the confirmation and the progress.

    Every permission set comes from the HOST -- files on disk under the strict package directories,
    each inside the workspace -- never from a panel message, and its name, taken from the file name,
    reaches an argv only if it is an api name.
*/

export const PERMISSION_SET_FILE_SUFFIX = '.permissionset-meta.xml';

// HOW DEEP UNDER A PACKAGE DIRECTORY A PERMISSION SET FILE IS LOOKED FOR: force-app/main/default/permissionsets/X IS FOUR
export const PERMISSION_SET_SEARCH_DEPTH = 6;

/*
    One --metadata and one --name per pick, so the command line grows with the pick; on Windows the
    CLI runs through cmd.exe, which refuses a line past 8,191 characters. Fifty names of at most 80
    characters stay well under it.
*/
export const PERMISSION_SET_MAX_PICKS = 50;

export const PERMISSION_SET_DEPLOY_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

export const PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS = 5 * 60 * 1000;

export const PERMISSION_SET_MAX_BUFFER_BYTES = 1024 * 1024 * 64;

// WHAT THE CLI SAYS WHEN THE USER ALREADY HOLDS THE PERMISSION SET: THAT IS THE GOAL MET, NOT A FAILURE
const ALREADY_ASSIGNED_PATTERN = /duplicate\s+PermissionSetAssignment|already\s+assigned/i;

export interface IPermissionSetCandidate {
    name: string;
    // RELATIVE TO THE WORKSPACE, "/"-SEPARATED: WHERE THE PICK SAYS IT CAME FROM
    relativeFilePath: string;
    // THE TREE'S OBJECTS IT GRANTS ANYTHING ON, AS THE TREE SPELLS THEM AND IN THE TREE'S ORDER
    coveredObjectApiNames: string[];
    // EVERY OBJECT IT GRANTS ANYTHING ON, THE TREE'S OR NOT, AS ITS XML SPELLS THEM: WHAT AN ASSIGNMENT CAN CHANGE A DESCRIBE OF
    grantedObjectApiNames: string[];
}

export interface IPermissionSetDiscovery {
    permissionSets: IPermissionSetCandidate[];
    // FILES THAT COULD NOT BE READ OR ARE NOT A <PermissionSet>, RELATIVE TO THE WORKSPACE
    unparseableFilePaths: string[];
    // FILE NAMES WHOSE PERMISSION SET NAME IS NOT AN API NAME, SO NOTHING IS OFFERED FOR THEM
    notApiNameFilePaths: string[];
}

export type PermissionSetAssignOutcome =
    { kind: 'assigned'; assignedNames: string[]; alreadyAssignedNames: string[] }
    // NOT EVERY PICK IS ASSIGNED: failedNames SAYS WHICH, failureMessages WHAT THE CLI SAID
    | { kind: 'notAllAssigned'; assignedNames: string[]; alreadyAssignedNames: string[]; failedNames: string[]; failureMessages: string[] }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    | { kind: 'unconfirmed'; failureMessage: string };

export class RecipeCockpitPermissionSetDeploy {

    // EVERY *.permissionset-meta.xml UNDER THE PACKAGE DIRECTORIES, IN THEIR ORDER, EACH INSIDE THE WORKSPACE
    static findPermissionSetFilePaths(workspaceRoot: string, packageDirectoryPaths: string[]): string[] {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const realWorkspaceRoot = SfdxProjectService.getRealDirectoryPath(resolvedWorkspaceRoot);
        const isContained = (candidatePath: string) => SfdxProjectService.isPathContainedInWorkspace(
            candidatePath,
            resolvedWorkspaceRoot,
            resolvablePath => resolvablePath === resolvedWorkspaceRoot ? realWorkspaceRoot : SfdxProjectService.getRealDirectoryPath(resolvablePath)
        );
        const permissionSetFilePaths: string[] = [];
        const visitedFolderPaths = new Set<string>();

        const walk = (folderPath: string, depth: number) => {

            if ( visitedFolderPaths.has(folderPath) ) {
                return;
            }
            visitedFolderPaths.add(folderPath);

            let folderEntries: fs.Dirent[];
            try {
                folderEntries = fs.readdirSync(folderPath, { withFileTypes: true });
            } catch {
                return;
            }

            [...folderEntries]
                // ONE FOLDER NEVER HOLDS TWO ENTRIES OF ONE NAME
                .sort((first, second) => first.name < second.name ? -1 : 1)
                .forEach(folderEntry => {

                    const childPath = path.join(folderPath, folderEntry.name);

                    if ( folderEntry.isFile() && folderEntry.name.endsWith(PERMISSION_SET_FILE_SUFFIX) ) {
                        if ( isContained(childPath) ) {
                            permissionSetFilePaths.push(childPath);
                        }
                        return;
                    }

                    if ( folderEntry.isDirectory() && !folderEntry.name.startsWith('.') && folderEntry.name !== 'node_modules' && depth < PERMISSION_SET_SEARCH_DEPTH ) {
                        walk(childPath, depth + 1);
                    }

                });

        };

        packageDirectoryPaths.forEach(packageDirectoryPath => {
            const resolvedPackageDirectoryPath = path.resolve(resolvedWorkspaceRoot, packageDirectoryPath);
            if ( isContained(resolvedPackageDirectoryPath) ) {
                walk(resolvedPackageDirectoryPath, 0);
            }
        });

        return permissionSetFilePaths;

    }

    /*
        The object names a permission set's XML grants anything on: each objectPermissions' <object>
        and the object half of each fieldPermissions' <field>. Undefined when the text is not a
        <PermissionSet> at all, which is a file the reader is warned about rather than one that
        grants nothing.
    */
    static async readGrantedObjectApiNames(permissionSetXml: string): Promise<string[] | undefined> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(permissionSetXml);
        } catch {
            return undefined;
        }

        const permissionSet = ( parsedXml as Record<string, unknown> | null )?.PermissionSet;
        // AN EMPTY <PermissionSet></PermissionSet> PARSES AS TEXT: IT GRANTS NOTHING, AND IS STILL A PERMISSION SET
        if ( typeof permissionSet === 'string' ) {
            return [];
        }
        if ( !permissionSet || typeof permissionSet !== 'object' ) {
            return undefined;
        }

        const readTexts = (entries: unknown, elementName: string): string[] => ( Array.isArray(entries) ? entries : [] )
            .flatMap(entry => {
                const values = entry !== null && typeof entry === 'object' ? ( entry as Record<string, unknown> )[elementName] : undefined;
                return Array.isArray(values) ? values : [];
            })
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim());

        const permissionSetRecord = permissionSet as Record<string, unknown>;

        return [
            ...readTexts(permissionSetRecord.objectPermissions, 'object'),
            ...readTexts(permissionSetRecord.fieldPermissions, 'field').map(fieldName => fieldName.split('.')[0])
        ].filter(objectApiName => objectApiName !== '');

    }

    /*
        The permission sets that grant anything on at least one of the tree's objects, matched
        case-insensitively as Salesforce reads names. A name two package directories both hold is
        offered once, from the first. A file that cannot be read or parsed is listed for a warning
        and offered nothing.
    */
    static async discoverPermissionSets(objectApiNames: readonly string[], workspaceRoot: string, packageDirectoryPaths: string[]): Promise<IPermissionSetDiscovery> {

        const discovery: IPermissionSetDiscovery = { permissionSets: [], unparseableFilePaths: [], notApiNameFilePaths: [] };
        const treeObjectNamesByLowerName = new Map<string, string>();
        objectApiNames.forEach(objectApiName => {
            const lowerName = String(objectApiName).toLowerCase();
            if ( !treeObjectNamesByLowerName.has(lowerName) ) {
                treeObjectNamesByLowerName.set(lowerName, String(objectApiName));
            }
        });
        const treeObjectOrder = [...treeObjectNamesByLowerName.values()];
        const offeredNames = new Set<string>();
        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

        for ( const filePath of this.findPermissionSetFilePaths(workspaceRoot, packageDirectoryPaths) ) {

            const relativeFilePath = path.relative(resolvedWorkspaceRoot, filePath).split(path.sep).join('/');
            const permissionSetName = path.basename(filePath).slice(0, -PERMISSION_SET_FILE_SUFFIX.length);

            if ( !SalesforceApiName.isApiName(permissionSetName) ) {
                discovery.notApiNameFilePaths.push(relativeFilePath);
                continue;
            }

            if ( offeredNames.has(permissionSetName.toLowerCase()) ) {
                continue;
            }

            let permissionSetXml: string;
            try {
                permissionSetXml = fs.readFileSync(filePath, 'utf-8');
            } catch {
                discovery.unparseableFilePaths.push(relativeFilePath);
                continue;
            }

            const grantedObjectApiNames = await this.readGrantedObjectApiNames(permissionSetXml);
            if ( !grantedObjectApiNames ) {
                discovery.unparseableFilePaths.push(relativeFilePath);
                continue;
            }

            const coveredLowerNames = new Set(grantedObjectApiNames
                .map(objectApiName => objectApiName.toLowerCase())
                .filter(lowerName => treeObjectNamesByLowerName.has(lowerName)));

            if ( coveredLowerNames.size === 0 ) {
                continue;
            }

            offeredNames.add(permissionSetName.toLowerCase());
            discovery.permissionSets.push({
                name: permissionSetName,
                relativeFilePath: relativeFilePath,
                coveredObjectApiNames: treeObjectOrder.filter(objectApiName => coveredLowerNames.has(objectApiName.toLowerCase())),
                grantedObjectApiNames: [...new Set(grantedObjectApiNames)]
            });

        }

        return discovery;

    }

    // WHAT THE PICK SAYS A PERMISSION SET COVERS, MARKED PARTIAL WHEN IT LEAVES SOME OF THE TREE OUT
    static describeCoverage(permissionSet: IPermissionSetCandidate, treeObjectCount: number): string {

        const coveredCount = permissionSet.coveredObjectApiNames.length;
        const coveredNames = permissionSet.coveredObjectApiNames.join(', ');

        return coveredCount >= treeObjectCount
            ? `covers all ${coveredCount} of the tree's objects: ${coveredNames}`
            : `partial, ${coveredCount} of ${treeObjectCount}: ${coveredNames}`;

    }

    private static assertPermissionSetNames(permissionSetNames: readonly string[]) {

        if ( permissionSetNames.length === 0 ) {
            throw new Error('No permission set was named, so nothing was deployed or assigned.');
        }

        permissionSetNames.forEach(permissionSetName => {
            if ( !SalesforceApiName.isApiName(permissionSetName) ) {
                throw new Error(`"${permissionSetName}" is not a Salesforce api name, so nothing was deployed or assigned.`);
            }
        });

    }

    // --target-org IS THE USERNAME, NEVER AN ALIAS, WHICH CAN BE RE-POINTED BETWEEN THE CONFIRMATION AND THE RUN
    static buildPermissionSetDeployArguments(permissionSetNames: readonly string[], orgUsername: string): string[] {

        this.assertPermissionSetNames(permissionSetNames);
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'deploy', 'start',
            '--json',
            '--target-org', orgUsername,
            ...permissionSetNames.flatMap(permissionSetName => ['--metadata', `PermissionSet:${permissionSetName}`])
        ];

    }

    // NO --on-behalf-of: THE ASSIGNEE IS THE USER THE ORG IS AUTHORIZED AS, AND NO ONE ELSE
    static buildPermissionSetAssignArguments(permissionSetNames: readonly string[], orgUsername: string): string[] {

        this.assertPermissionSetNames(permissionSetNames);
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'org', 'assign', 'permset',
            '--json',
            '--target-org', orgUsername,
            ...permissionSetNames.flatMap(permissionSetName => ['--name', permissionSetName])
        ];

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI is required to deploy and assign permission sets, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    // THE DEPLOY'S ANSWER IS READ EXACTLY AS "Deploy this metadata…" READS ITS OWN: ALL OR NOTHING
    static parsePermissionSetDeployOutput(invocationResult: ISalesforceCliInvocationResult,
                                            payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataDeployOutcome {

        const deployOutcome = RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocationResult, payload);

        return deployOutcome.kind === 'cliNotInstalled'
            ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
            : deployOutcome;

    }

    /*
        The assign's answer, type-checked: result.successes name each assigned permission set as
        "value", and result.failures carry a "message" that need not name the set. A pick is
        assigned when a success names it, already assigned when a failure naming it says so, and
        failed when a failure naming it says anything else. A failure that names none of the picks
        is matched to the picks nothing accounted for: when every such failure says "already
        assigned" they all are, and otherwise they are counted failed -- a pick the answer never
        accounts for is never reported assigned.
    */
    static parsePermissionSetAssignOutput(invocationResult: ISalesforceCliInvocationResult,
                                            permissionSetNames: readonly string[],
                                            payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): PermissionSetAssignOutcome {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
                : this.failEvery(permissionSetNames, `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}`);
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: 'The Salesforce CLI\'s answer was too large to read, so which permission sets were assigned is unknown.' };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: 'The assignment did not finish in time and was stopped, so which permission sets were assigned is unknown.' };
        }

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result)
            ? payload.result as Record<string, unknown>
            : undefined;

        if ( !result ) {
            return this.failEvery(permissionSetNames, ScratchOrgService.buildCliFailureDetail(payload, invocationResult));
        }

        const toRecords = (entries: unknown): Record<string, unknown>[] => ( Array.isArray(entries) ? entries : [] )
            .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry));

        const successValues = new Set(toRecords(result.successes)
            .map(success => success.value)
            .filter((value): value is string => typeof value === 'string'));
        const failures = toRecords(result.failures).map(failure => ({
            name: typeof failure.name === 'string' ? failure.name : '',
            message: typeof failure.message === 'string' ? failure.message : ''
        }));

        const namesFailure = (failure: { name: string; message: string }, permissionSetName: string) => failure.name === permissionSetName
            || new RegExp(`(^|[^A-Za-z0-9_])${permissionSetName}($|[^A-Za-z0-9_])`).test(failure.message);

        const assignedNames: string[] = [];
        const alreadyAssignedNames: string[] = [];
        const failedNames: string[] = [];
        const unaccountedNames: string[] = [];
        const attributedFailures = new Set<number>();

        permissionSetNames.forEach(permissionSetName => {

            if ( successValues.has(permissionSetName) ) {
                assignedNames.push(permissionSetName);
                return;
            }

            const failureIndex = failures.findIndex(failure => namesFailure(failure, permissionSetName));
            if ( failureIndex === -1 ) {
                unaccountedNames.push(permissionSetName);
                return;
            }

            attributedFailures.add(failureIndex);
            ( ALREADY_ASSIGNED_PATTERN.test(failures[failureIndex].message) ? alreadyAssignedNames : failedNames ).push(permissionSetName);

        });

        const unattributedFailures = failures.filter((_failure, failureIndex) => !attributedFailures.has(failureIndex));

        if ( unaccountedNames.length > 0 ) {
            const isEveryUnattributedAlreadyAssigned = unattributedFailures.length > 0
                && unattributedFailures.every(failure => ALREADY_ASSIGNED_PATTERN.test(failure.message));
            ( isEveryUnattributedAlreadyAssigned ? alreadyAssignedNames : failedNames ).push(...unaccountedNames);
        }

        if ( failedNames.length === 0 ) {
            return { kind: 'assigned', assignedNames: assignedNames, alreadyAssignedNames: alreadyAssignedNames };
        }

        const failureMessages = [...new Set(failures
            .filter(failure => !ALREADY_ASSIGNED_PATTERN.test(failure.message))
            .map(failure => failure.message.trim())
            .filter(message => message !== ''))];

        return {
            kind: 'notAllAssigned',
            assignedNames: assignedNames,
            alreadyAssignedNames: alreadyAssignedNames,
            failedNames: failedNames,
            failureMessages: failureMessages.length > 0 ? failureMessages : [ScratchOrgService.buildCliFailureDetail(payload, invocationResult)]
        };

    }

    private static failEvery(permissionSetNames: readonly string[], failureMessage: string): PermissionSetAssignOutcome {

        return { kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: [...permissionSetNames], failureMessages: [failureMessage] };

    }

    // THE CONFIRMATION'S DETAIL: THE TREE, THE ORG, THE USER, AND EVERY PICK WITH WHAT IT COVERS, EACH ON ONE LINE AND WITH NO
    // PARENTHESES OF ITS OWN, SINCE THE CALLER ESCAPES IT FOR A NOTIFICATION
    static buildConfirmationDetail(treeLabel: string, orgLabel: string, orgUsername: string, permissionSets: readonly IPermissionSetCandidate[], treeObjectCount: number): string {

        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        return [
            `Tree: ${toSingleLine(treeLabel)}`,
            `Org: ${toSingleLine(orgLabel)}`,
            `Assigned to: ${toSingleLine(orgUsername)}, the user this org is authorized as`,
            '',
            `${permissionSets.length} ${permissionSets.length === 1 ? 'permission set' : 'permission sets'}:`,
            ...permissionSets.map(permissionSet => `  ${permissionSet.name} — ${toSingleLine(this.describeCoverage(permissionSet, treeObjectCount))}`),
            '',
            'Each is deployed from this workspace\'s source first, all or nothing; only if the deploy succeeds are they assigned. A permission set the user already holds counts as assigned.'
        ].join('\n');

    }

}
