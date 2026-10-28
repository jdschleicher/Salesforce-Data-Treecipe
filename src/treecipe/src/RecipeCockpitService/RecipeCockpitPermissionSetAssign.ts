import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import type { IOrgPermissionSet } from '../SalesforceOrgService/SalesforceOrgService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { IRecipeCockpitConfirmContent, IRecipeCockpitConfirmOrg } from './RecipeCockpitConfirmContent';

/*
    "Assign permission sets to me…" (#274, #302): the project's permission sets that grant anything
    on one relationship tree's objects, which of the reader's picks the org already holds, the
    PermissionSetAssignment rows that assign those to the user the org is authorized as (#500: one
    insert on the cockpit's own connection, no CLI), and the org's save results read back. Nothing
    is deployed: a pick the org does not hold is named for the reader to deploy themselves. It
    imports no vscode: the cockpit owns the pick, the org, the confirmation and the progress.

    Every permission set comes from the HOST -- files on disk under the strict package directories,
    each inside the workspace -- never from a panel message, and its name, taken from the file name,
    reaches a query only if it is an api name.
*/

export const PERMISSION_SET_FILE_SUFFIX = '.permissionset-meta.xml';

// HOW DEEP UNDER A PACKAGE DIRECTORY A PERMISSION SET FILE IS LOOKED FOR: force-app/main/default/permissionsets/X IS FOUR
export const PERMISSION_SET_SEARCH_DEPTH = 6;

/*
    One assignment row per pick, and every row goes in ONE sObject Collections request, which carries
    at most 200 records (#500). One request is also why the insert has no Cancel: once it is sent it
    cannot be taken back, so a cancel could only stop waiting for an answer that still lands.
*/
export const PERMISSION_SET_MAX_PICKS = 200;

export const PERMISSION_SET_ASSIGNMENT_OBJECT_API_NAME = 'PermissionSetAssignment';

// HOW MANY SKIPPED FILES A WARNING NAMES BEFORE IT COUNTS THE REST
export const PERMISSION_SET_NOTIFICATION_SKIPS_SHOWN = 10;

// HOW LONG THE INSERT IS WAITED FOR BEFORE WHICH PERMISSION SETS WERE ASSIGNED IS REPORTED UNKNOWN
export const PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS = 5 * 60 * 1000;

// THE DEFAULT OUTPUT BUFFER OF THE COCKPIT'S OTHER CLI RUNS (DEPLOYS, RETRIEVES)
export const PERMISSION_SET_MAX_BUFFER_BYTES = 1024 * 1024 * 64;

// WHAT THE ORG SAYS WHEN THE USER ALREADY HOLDS THE PERMISSION SET: THAT IS THE GOAL MET, NOT A FAILURE
const ALREADY_ASSIGNED_STATUS_CODE = 'DUPLICATE_VALUE';
const ALREADY_ASSIGNED_PATTERN = /duplicate\s+PermissionSetAssignment|already\s+assigned/i;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

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
    // NOT EVERY PICK IS ASSIGNED: failedNames SAYS WHICH, failureMessages WHAT THE ORG SAID
    | { kind: 'notAllAssigned'; assignedNames: string[]; alreadyAssignedNames: string[]; failedNames: string[]; failureMessages: string[] }
    // THE INSERT THREW OR WAS NOT ANSWERED IN TIME: THE ORG MAY HAVE SAVED ANY OF IT
    | { kind: 'unconfirmed'; failureMessage: string };

export interface IPermissionSetAssignmentRecord {
    AssigneeId: string;
    PermissionSetId: string;
}

// WHAT ONE INSERT SENDS: A ROW PER PICK THE ORG HOLDS ONE UNAMBIGUOUS PERMISSION SET FOR, IN THE ORDER PICKED
export interface IPermissionSetAssignmentPlan {
    sentNames: string[];
    records: IPermissionSetAssignmentRecord[];
    // PICKS NO ROW IS SENT FOR, AND WHY: THEY ARE FAILED, NEVER ASSIGNED
    unresolvedNames: string[];
    unresolvedMessages: string[];
}

// THE ONE CALL THE INSERT MAKES ON A jsforce CONNECTION
export interface IPermissionSetAssignmentConnection {
    sobject(objectApiName: string): { create(records: IPermissionSetAssignmentRecord[], options: { allowRecursive: boolean; allOrNone: boolean }): Promise<unknown> };
}

// THE PICKS THE ORG HOLDS, WHICH ARE ASSIGNED, AND THE ONES IT DOES NOT, WHICH THE READER IS TOLD TO DEPLOY
export interface IPermissionSetOrgPresence {
    presentPermissionSets: IPermissionSetCandidate[];
    missingPermissionSets: IPermissionSetCandidate[];
}

export class RecipeCockpitPermissionSetAssign {

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

    /*
        The rows that assign the picks the org holds to one user, and nothing else: the assignee is
        the user the org is authorized as, never anyone else. A pick is matched to the org's
        permission sets case-insensitively; when the org holds more than one of that name (a
        packaged one beside the project's), the one with no namespace is the project's, and with no
        such one the pick is not sent rather than guessed at.
    */
    static planAssignments(assigneeId: string, permissionSetNames: readonly string[], orgPermissionSets: readonly IOrgPermissionSet[]): IPermissionSetAssignmentPlan {

        if ( !SALESFORCE_RECORD_ID_PATTERN.test(String(assigneeId)) ) {
            throw new Error('The user to assign to has no Salesforce Id, so nothing was assigned.');
        }
        if ( permissionSetNames.length === 0 ) {
            throw new Error('No permission set was named, so nothing was assigned.');
        }
        if ( permissionSetNames.length > PERMISSION_SET_MAX_PICKS ) {
            throw new Error(`At most ${PERMISSION_SET_MAX_PICKS} permission sets are assigned at once, so nothing was assigned.`);
        }

        const plan: IPermissionSetAssignmentPlan = { sentNames: [], records: [], unresolvedNames: [], unresolvedMessages: [] };

        permissionSetNames.forEach(permissionSetName => {

            if ( !SalesforceApiName.isApiName(permissionSetName) ) {
                throw new Error(`"${permissionSetName}" is not a Salesforce api name, so nothing was assigned.`);
            }

            const namedSets = orgPermissionSets.filter(orgPermissionSet => orgPermissionSet.name.toLowerCase() === permissionSetName.toLowerCase()
                && SALESFORCE_RECORD_ID_PATTERN.test(orgPermissionSet.id));
            const unmanagedSets = namedSets.filter(orgPermissionSet => orgPermissionSet.namespacePrefix === undefined);
            const chosenSet = unmanagedSets.length === 1 ? unmanagedSets[0]
                : unmanagedSets.length === 0 && namedSets.length === 1 ? namedSets[0]
                    : undefined;

            if ( !chosenSet ) {
                plan.unresolvedNames.push(permissionSetName);
                plan.unresolvedMessages.push(namedSets.length === 0
                    ? `the org did not name an Id for ${permissionSetName}`
                    : `the org holds more than one permission set named ${permissionSetName}`);
                return;
            }

            plan.sentNames.push(permissionSetName);
            plan.records.push({ AssigneeId: assigneeId, PermissionSetId: chosenSet.id });

        });

        return plan;

    }

    // ONE REQUEST, allOrNone OFF SO EACH PICK LANDS OR FAILS ON ITS OWN, AND allowRecursive OFF SO jsforce NEVER SPLITS IT
    static async insertAssignments(connection: IPermissionSetAssignmentConnection, records: readonly IPermissionSetAssignmentRecord[]): Promise<unknown> {

        if ( records.length > PERMISSION_SET_MAX_PICKS ) {
            throw new Error(`One assignment request carries at most ${PERMISSION_SET_MAX_PICKS} rows, and ${records.length} were given.`);
        }

        return connection.sobject(PERMISSION_SET_ASSIGNMENT_OBJECT_API_NAME).create([...records], { allowRecursive: false, allOrNone: false });

    }

    /*
        The org's save results, type-checked: one per row sent, in the order sent. A pick is assigned
        when its result says success with an Id, already assigned when an error says the assignment
        is a duplicate, and failed otherwise -- a pick with no readable result, or an answer whose
        length is not the rows sent, is never reported assigned. The picks no row was sent for are
        failed with the plan's reason.
    */
    static readAssignmentSaveResults(plan: IPermissionSetAssignmentPlan, saveResults: unknown): PermissionSetAssignOutcome {

        const assignedNames: string[] = [];
        const alreadyAssignedNames: string[] = [];
        const failedNames: string[] = [...plan.unresolvedNames];
        const failureMessages: string[] = [...plan.unresolvedMessages];
        const asRecord = (candidateValue: unknown) => candidateValue !== null && typeof candidateValue === 'object' && !Array.isArray(candidateValue)
            ? candidateValue as Record<string, unknown>
            : undefined;
        const resultList = Array.isArray(saveResults) ? saveResults : [saveResults];

        if ( resultList.length !== plan.sentNames.length ) {
            failedNames.push(...plan.sentNames);
            failureMessages.push('The org\'s answer could not be matched to the permission sets sent.');
        } else {
            plan.sentNames.forEach((permissionSetName, resultIndex) => {

                const saveResult = asRecord(resultList[resultIndex]);

                if ( saveResult?.success === true && typeof saveResult.id === 'string' && SALESFORCE_RECORD_ID_PATTERN.test(saveResult.id) ) {
                    assignedNames.push(permissionSetName);
                    return;
                }

                const saveErrors = ( Array.isArray(saveResult?.errors) ? saveResult.errors as unknown[] : [] )
                    .map(saveError => asRecord(saveError))
                    .filter((saveError): saveError is Record<string, unknown> => saveError !== undefined)
                    .map(saveError => ({
                        statusCode: typeof saveError.statusCode === 'string' ? saveError.statusCode : '',
                        message: typeof saveError.message === 'string' ? saveError.message.trim() : ''
                    }));

                if ( saveResult?.success === false && saveErrors.some(saveError => saveError.statusCode === ALREADY_ASSIGNED_STATUS_CODE || ALREADY_ASSIGNED_PATTERN.test(saveError.message)) ) {
                    alreadyAssignedNames.push(permissionSetName);
                    return;
                }

                failedNames.push(permissionSetName);
                const errorTexts = saveErrors.map(saveError => saveError.message || saveError.statusCode).filter(errorText => errorText !== '');
                failureMessages.push(...( errorTexts.length > 0 ? errorTexts : [`the org gave no reason for ${permissionSetName}`] ));

            });
        }

        if ( failedNames.length === 0 ) {
            return { kind: 'assigned', assignedNames: assignedNames, alreadyAssignedNames: alreadyAssignedNames };
        }

        return {
            kind: 'notAllAssigned',
            assignedNames: assignedNames,
            alreadyAssignedNames: alreadyAssignedNames,
            failedNames: failedNames,
            failureMessages: [...new Set(failureMessages)]
        };

    }

    /*
        Splits the picks by whether the org holds them, matched case-insensitively as Salesforce
        reads names, each list in the order picked.
    */
    static partitionByOrgPresence(permissionSets: readonly IPermissionSetCandidate[], orgPermissionSetNames: readonly string[]): IPermissionSetOrgPresence {

        const lowerOrgNames = new Set(orgPermissionSetNames.map(permissionSetName => permissionSetName.toLowerCase()));
        const presence: IPermissionSetOrgPresence = { presentPermissionSets: [], missingPermissionSets: [] };

        permissionSets.forEach(permissionSet => {
            ( lowerOrgNames.has(permissionSet.name.toLowerCase()) ? presence.presentPermissionSets : presence.missingPermissionSets ).push(permissionSet);
        });

        return presence;

    }

    // WHAT THE READER IS TOLD ABOUT THE PICKS THE ORG DOES NOT HOLD: THEIR NAMES, AND THAT DEPLOYING THEM IS THEIRS TO DO
    static buildMissingPermissionSetsMessage(missingPermissionSetNames: readonly string[], orgLabel: string): string {

        const isOne = missingPermissionSetNames.length === 1;

        return `Not in ${orgLabel}: ${missingPermissionSetNames.join(', ')}. Deploy ${isOne ? 'this permission set' : 'these permission sets'} to the org, then assign ${isOne ? 'it' : 'them'}.`;

    }

    // WHAT THE IN-PANEL CONFIRMATION SAYS (#457): THE TREE, THE ORG AND THE USER ON SCREEN, EVERY PICK WITH WHAT IT COVERS IN A
    // FOLDED SECTION, EACH ON ONE LINE
    static buildConfirmationContent(treeLabel: string, org: IRecipeCockpitConfirmOrg, permissionSets: readonly IPermissionSetCandidate[], treeObjectCount: number): IRecipeCockpitConfirmContent {

        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        return {
            summary: [
                `Tree: ${toSingleLine(treeLabel)}`,
                `Assigned to: ${toSingleLine(org.username)}, the user this org is authorized as`
            ],
            org: org,
            sections: [
                {
                    title: permissionSets.length === 1 ? 'Permission set' : 'Permission sets',
                    count: permissionSets.length,
                    lines: permissionSets.map(permissionSet => `  ${permissionSet.name} — ${toSingleLine(this.describeCoverage(permissionSet, treeObjectCount))}`)
                },
                { title: 'What happens next', lines: ['Nothing is deployed.', 'Only the permission sets the org already holds are assigned; any it does not hold are named so you can deploy them.', 'A permission set the user already holds counts as assigned.'] }
            ]
        };

    }

}
