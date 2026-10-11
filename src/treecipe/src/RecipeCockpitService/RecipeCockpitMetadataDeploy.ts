import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    "Deploy missing metadata…" (#211): what one object of one tree is missing from the selected
    sandbox, turned into the --metadata members of one "sf project deploy start", and the CLI's
    answer read back. It imports no vscode: the cockpit owns the confirmation, the progress and the
    panel, and this file owns the member list, the local-source lookup, the argv and the parse.

    Every member comes from the HOST -- the readiness it computed and the files on disk -- never
    from a panel message, and every name in one is held to SalesforceApiName twice: as the recipe
    or the describe named it, and as the source file on disk spells it, since that spelling is what
    reaches the argv.
*/

// A DEPLOY CAN RUN FOR MINUTES ON A BUSY SANDBOX; PAST THIS THE PROCESS TREE IS KILLED AND THE RUN REPORTED AS UNFINISHED
export const METADATA_DEPLOY_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

export const METADATA_DEPLOY_MAX_BUFFER_BYTES = 1024 * 1024 * 64;

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const METADATA_DEPLOY_OBJECTS_FOLDER_SEARCH_DEPTH = 5;

const CUSTOM_COMPONENT_SUFFIX_PATTERN = /__c$/i;

/*
    What the host's readiness said one object of one tree is missing: the object itself (and then
    the recipe's fields of it), or the recipe fields the describe does not have.
*/
export interface IMetadataDeployTarget {
    treeKey: string;
    objectApiName: string;
    isObjectMissing: boolean;
    fieldApiNames: string[];
}

export type MetadataDeploySkipReason = 'notAnApiName' | 'standardObject' | 'standardField' | 'objectNotDeployable' | 'notInLocalSource' | 'outsideWorkspace';

export const METADATA_DEPLOY_SKIP_REASON_TEXT: Readonly<Record<MetadataDeploySkipReason, string>> = {
    notAnApiName: 'not a Salesforce api name',
    standardObject: 'a standard object, which cannot be deployed',
    standardField: 'a standard field, which cannot be deployed',
    objectNotDeployable: 'its object cannot be deployed',
    notInLocalSource: 'not in local source',
    outsideWorkspace: 'its source file resolves outside this workspace'
};

export interface IMetadataDeploySkippedItem {
    name: string;
    reason: MetadataDeploySkipReason;
}

export interface IMetadataDeployPlan {
    objectApiName: string;
    members: string[];
    skippedItems: IMetadataDeploySkippedItem[];
}

export type MetadataDeployOutcome =
    { kind: 'deployed'; deployedComponentCount: number }
    // SOME COMPONENTS FAILED AND SOME DID NOT: A WARNING, NEVER AN ERROR
    | { kind: 'partiallyFailed'; failedComponentCount: number; componentCount: number; failureDetail: string }
    | { kind: 'failed'; failureMessage: string }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    // THE DEPLOY RAN BUT ITS ANSWER COULD NOT BE READ, OR IT WAS CUT SHORT: WHETHER IT APPLIED IS UNKNOWN
    | { kind: 'unconfirmed'; failureMessage: string };

export class RecipeCockpitMetadataDeploy {

    static isCustomComponentName(apiName: string): boolean {

        return CUSTOM_COMPONENT_SUFFIX_PATTERN.test(apiName);

    }

    /*
        Every "objects" folder under the package directories, in the order sfdx-project.json lists
        them, each one inside the workspace. Hidden folders and node_modules are not walked, and the
        walk stops at METADATA_DEPLOY_OBJECTS_FOLDER_SEARCH_DEPTH.
    */
    static findObjectsFolderPaths(workspaceRoot: string, packageDirectoryPaths: string[]): string[] {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const objectsFolderPaths: string[] = [];

        const walk = (folderPath: string, depth: number) => {

            let folderEntries: fs.Dirent[];
            try {
                folderEntries = fs.readdirSync(folderPath, { withFileTypes: true });
            } catch {
                return;
            }

            folderEntries
                .filter(folderEntry => folderEntry.isDirectory() && !folderEntry.name.startsWith('.') && folderEntry.name !== 'node_modules')
                .forEach(folderEntry => {

                    const childPath = path.join(folderPath, folderEntry.name);

                    if ( folderEntry.name === 'objects' ) {
                        if ( SfdxProjectService.isPathContainedInWorkspace(childPath, resolvedWorkspaceRoot) ) {
                            objectsFolderPaths.push(childPath);
                        }
                        return;
                    }

                    if ( depth < METADATA_DEPLOY_OBJECTS_FOLDER_SEARCH_DEPTH ) {
                        walk(childPath, depth + 1);
                    }

                });

        };

        packageDirectoryPaths.forEach(packageDirectoryPath => {
            const resolvedPackageDirectoryPath = path.resolve(resolvedWorkspaceRoot, packageDirectoryPath);
            if ( SfdxProjectService.isPathContainedInWorkspace(resolvedPackageDirectoryPath, resolvedWorkspaceRoot) ) {
                walk(resolvedPackageDirectoryPath, 0);
            }
        });

        return objectsFolderPaths;

    }

    // THE ENTRY OF A FOLDER NAMED LIKE apiName, MATCHED CASE-INSENSITIVELY AS SALESFORCE READS NAMES, SPELT AS IT IS ON DISK
    static findEntryName(folderPath: string, entryName: string): string | undefined {

        try {
            const lowerEntryName = entryName.toLowerCase();
            return fs.readdirSync(folderPath).find(candidateName => candidateName.toLowerCase() === lowerEntryName);
        } catch {
            return undefined;
        }

    }

    /*
        A source file found under one of the objects folders, or why not: absent, or present only
        through a path that resolves outside the workspace (a symlink), which never reaches the CLI.
    */
    private static findSourceFile(objectsFolderPaths: string[],
                                    workspaceRoot: string,
                                    objectApiName: string,
                                    subFolderName: string | undefined,
                                    fileSuffix: string,
                                    apiName: string): { fileName: string } | { reason: 'notInLocalSource' | 'outsideWorkspace' } {

        let isOutsideWorkspace = false;

        for ( const objectsFolderPath of objectsFolderPaths ) {

            const objectFolderName = this.findEntryName(objectsFolderPath, objectApiName);
            if ( !objectFolderName ) {
                continue;
            }

            const containingFolderPath = subFolderName
                ? path.join(objectsFolderPath, objectFolderName, subFolderName)
                : path.join(objectsFolderPath, objectFolderName);
            const fileName = this.findEntryName(containingFolderPath, `${apiName}${fileSuffix}`);
            if ( !fileName ) {
                continue;
            }

            const filePath = path.join(containingFolderPath, fileName);
            if ( !SfdxProjectService.isPathContainedInWorkspace(filePath, path.resolve(workspaceRoot)) ) {
                isOutsideWorkspace = true;
                continue;
            }

            if ( SfdxProjectService.isExistingFile(filePath) ) {
                return { fileName: fileName };
            }

        }

        return { reason: isOutsideWorkspace ? 'outsideWorkspace' : 'notInLocalSource' };

    }

    /*
        The members to deploy and everything left out, with why. A missing object deploys
        CustomObject:<Object> and its recipe fields; missing fields deploy CustomField:<Object>.<Field>.
        A standard object or field cannot be deployed, and one not found in local source is not
        guessed at. Names reach a member only as the source file on disk spells them, and only if
        that spelling is an api name too.
    */
    static planMetadataDeploy(deployTarget: IMetadataDeployTarget, workspaceRoot: string, packageDirectoryPaths: string[]): IMetadataDeployPlan {

        const { objectApiName, isObjectMissing } = deployTarget;
        const plan: IMetadataDeployPlan = { objectApiName: objectApiName, members: [], skippedItems: [] };
        const fieldApiNames = [...new Set(deployTarget.fieldApiNames)];
        const skip = (name: string, reason: MetadataDeploySkipReason) => plan.skippedItems.push({ name: name, reason: reason });

        if ( !SalesforceApiName.isApiName(objectApiName) ) {
            skip(String(objectApiName), 'notAnApiName');
            return plan;
        }

        const objectsFolderPaths = this.findObjectsFolderPaths(workspaceRoot, packageDirectoryPaths);
        let deployedObjectName = objectApiName;

        if ( isObjectMissing ) {

            if ( !this.isCustomComponentName(objectApiName) ) {
                skip(objectApiName, 'standardObject');
                fieldApiNames.forEach(fieldApiName => skip(`${objectApiName}.${fieldApiName}`, 'objectNotDeployable'));
                return plan;
            }

            const objectSource = this.findSourceFile(objectsFolderPaths, workspaceRoot, objectApiName, undefined, '.object-meta.xml', objectApiName);
            const objectSourceName = 'fileName' in objectSource ? objectSource.fileName.slice(0, -'.object-meta.xml'.length) : undefined;

            if ( !objectSourceName || !SalesforceApiName.isApiName(objectSourceName) ) {
                skip(objectApiName, 'reason' in objectSource ? objectSource.reason : 'notAnApiName');
                fieldApiNames.forEach(fieldApiName => skip(`${objectApiName}.${fieldApiName}`, 'objectNotDeployable'));
                return plan;
            }

            deployedObjectName = objectSourceName;
            plan.members.push(`CustomObject:${deployedObjectName}`);

        }

        fieldApiNames.forEach(fieldApiName => {

            const fieldLabel = `${objectApiName}.${fieldApiName}`;

            if ( !SalesforceApiName.isApiName(fieldApiName) ) {
                skip(fieldLabel, 'notAnApiName');
                return;
            }

            if ( !this.isCustomComponentName(fieldApiName) ) {
                skip(fieldLabel, 'standardField');
                return;
            }

            const fieldSource = this.findSourceFile(objectsFolderPaths, workspaceRoot, objectApiName, 'fields', '.field-meta.xml', fieldApiName);

            if ( 'reason' in fieldSource ) {
                skip(fieldLabel, fieldSource.reason);
                return;
            }

            const fieldSourceName = fieldSource.fileName.slice(0, -'.field-meta.xml'.length);

            if ( !SalesforceApiName.isApiName(fieldSourceName) ) {
                skip(fieldLabel, 'notAnApiName');
                return;
            }

            plan.members.push(`CustomField:${deployedObjectName}.${fieldSourceName}`);

        });

        return plan;

    }

    /*
        One --metadata per member and --target-org the USERNAME, never an alias, which can be
        re-pointed between the confirmation and the run. No --source-dir: only the named members
        are deployed, and the CLI resolves them from sfdx-project.json in the workspace it runs in.
        Every member is checked again here, so a plan built any other way still cannot add an argument.
    */
    static buildMetadataDeployArguments(members: string[], orgUsername: string): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        members.forEach(member => {
            if ( !this.isDeployableMember(member) ) {
                throw new Error(`"${member}" is not a CustomObject or CustomField member of api names, so nothing was deployed.`);
            }
        });

        return [
            'project', 'deploy', 'start',
            ...members.flatMap(member => ['--metadata', member]),
            '--target-org', orgUsername,
            '--json'
        ];

    }

    static isDeployableMember(member: unknown): boolean {

        if ( typeof member !== 'string' ) {
            return false;
        }

        const objectMember = /^CustomObject:([^.:]+)$/.exec(member);
        if ( objectMember ) {
            return SalesforceApiName.isApiName(objectMember[1]) && this.isCustomComponentName(objectMember[1]);
        }

        const fieldMember = /^CustomField:([^.:]+)\.([^.:]+)$/.exec(member);
        return !!fieldMember
                && SalesforceApiName.isApiName(fieldMember[1])
                && SalesforceApiName.isApiName(fieldMember[2])
                && this.isCustomComponentName(fieldMember[2]);

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI is required to deploy metadata, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    /*
        The CLI's answer, type-checked: only status, the component successes and failures and the
        error text are read. Deployed only on status 0, success and no component failure; output
        that is not JSON is a failure, never a success.
    */
    static parseMetadataDeployOutput(invocationResult: ISalesforceCliInvocationResult,
                                        requestedMemberCount: number,
                                        payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataDeployOutcome {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: 'The Salesforce CLI\'s answer was too large to read, so whether the deploy applied is unknown.' };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: 'The deploy did not finish in time and was stopped, so it may have partly applied.' };
        }

        if ( !payload ) {
            return { kind: 'failed', failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };
        }

        const deployComponentCounts = ScratchOrgService.readDeployComponentCounts(payload);

        if ( deployComponentCounts.isSucceeded ) {
            return { kind: 'deployed', deployedComponentCount: deployComponentCounts.numberComponentsDeployed ?? deployComponentCounts.componentSuccessCount };
        }

        const failedComponentCount = deployComponentCounts.componentFailureCount;
        const componentCount = Math.max(requestedMemberCount, failedComponentCount + deployComponentCounts.componentSuccessCount);
        const failureDetail = deployComponentCounts.componentFailureProblems.join('; ') || ScratchOrgService.buildCliFailureDetail(payload, invocationResult);

        if ( failedComponentCount > 0 && failedComponentCount < componentCount ) {
            return { kind: 'partiallyFailed', failedComponentCount: failedComponentCount, componentCount: componentCount, failureDetail: failureDetail };
        }

        return { kind: 'failed', failureMessage: failureDetail };

    }

    // THE CONFIRMATION'S DETAIL: EVERY MEMBER TO BE DEPLOYED, EVERY ITEM LEFT OUT AND WHY, EACH ON ONE LINE
    static buildConfirmationDetail(plan: IMetadataDeployPlan, orgLabel: string): string {

        const toSingleLine = (text: string) => String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        return [
            `Org: ${toSingleLine(orgLabel)}`,
            '',
            `To deploy (${plan.members.length}):`,
            ...plan.members.map(member => `  ${toSingleLine(member)}`),
            ...( plan.skippedItems.length > 0
                ? ['', `Skipped (${plan.skippedItems.length}):`, ...plan.skippedItems.map(skippedItem => `  ${toSingleLine(skippedItem.name)} — ${METADATA_DEPLOY_SKIP_REASON_TEXT[skippedItem.reason]}`)]
                : [] ),
            '',
            'Only these members are deployed, from this workspace\'s source. Anything they depend on (a global value set, a record type, a permission) is not deployed with them, and field-level security is not granted.'
        ].join('\n');

    }

    // WHY NOTHING WAS DEPLOYED WHEN THE PLAN LEFT NOTHING
    static buildNothingToDeployMessage(plan: IMetadataDeployPlan): string {

        const skippedText = plan.skippedItems
            .map(skippedItem => `${skippedItem.name} is ${METADATA_DEPLOY_SKIP_REASON_TEXT[skippedItem.reason]}`)
            .join('; ');

        return `Nothing of ${plan.objectApiName} can be deployed${skippedText ? `: ${skippedText}` : ''}.`;

    }

}
