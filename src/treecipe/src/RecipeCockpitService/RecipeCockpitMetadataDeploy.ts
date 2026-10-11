import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    "Deploy this metadata…" (#211): what one object of one tree is missing from the selected
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
    the recipe's fields of it), or the recipe fields the describe does not have -- which no
    readiness produces since #264; #266 removes this path with the rest of the deploy.
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
    standardObject: 'not a custom object (__c), which this does not deploy',
    standardField: 'not a custom field (__c), which this does not deploy',
    objectNotDeployable: 'its object cannot be deployed',
    notInLocalSource: 'not in local source',
    outsideWorkspace: 'its source file resolves outside this workspace'
};

export interface IMetadataDeploySkippedItem {
    name: string;
    reason: MetadataDeploySkipReason;
}

/*
    objectFolderContents is set only for a missing object: in source format a CustomObject member
    deploys EVERYTHING under the object's folder -- fields the recipe never names, validation rules,
    record types, list views -- so the confirmation lists those files rather than only the members.
*/
export interface IMetadataDeployPlan {
    objectApiName: string;
    members: string[];
    skippedItems: IMetadataDeploySkippedItem[];
    objectFolderContents?: string[];
}

// HOW MANY OF A MISSING OBJECT'S SOURCE FILES THE CONFIRMATION SPELLS OUT; THE REST ARE COUNTED
export const METADATA_DEPLOY_OBJECT_FOLDER_CONTENTS_SHOWN = 40;

/*
    One plan's reads, made once: a folder's entries, and the workspace root's real path. A plan
    looks the same folders up once per field, so without this a 500-field object re-read its
    objects folder 500 times.
*/
interface IPlanReadCache {
    entryNamesByFolderPath: Map<string, string[] | undefined>;
    resolvedWorkspaceRoot: string;
    realWorkspaceRoot: string;
}

export type MetadataDeployOutcome =
    { kind: 'deployed'; deployedComponentCount: number }
    // ALL OR NOTHING, AS THE CLI REPORTS IT: ANY COMPONENT FAILURE IS THE WHOLE DEPLOY'S
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
    static findEntryName(folderPath: string, entryName: string, readCache?: IPlanReadCache): string | undefined {

        const lowerEntryName = entryName.toLowerCase();

        return this.readEntryNames(folderPath, readCache)?.find(candidateName => candidateName.toLowerCase() === lowerEntryName);

    }

    private static readEntryNames(folderPath: string, readCache?: IPlanReadCache): string[] | undefined {

        if ( readCache?.entryNamesByFolderPath.has(folderPath) ) {
            return readCache.entryNamesByFolderPath.get(folderPath);
        }

        let entryNames: string[] | undefined;
        try {
            entryNames = fs.readdirSync(folderPath);
        } catch {
            entryNames = undefined;
        }

        readCache?.entryNamesByFolderPath.set(folderPath, entryNames);

        return entryNames;

    }

    private static buildPlanReadCache(workspaceRoot: string): IPlanReadCache {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

        return {
            entryNamesByFolderPath: new Map(),
            resolvedWorkspaceRoot: resolvedWorkspaceRoot,
            realWorkspaceRoot: SfdxProjectService.getRealDirectoryPath(resolvedWorkspaceRoot)
        };

    }

    // STILL A REAL RESOLVER FOR EVERY PATH BUT THE ROOT, WHOSE REAL PATH THE PLAN RESOLVED ONCE
    private static isContainedInWorkspace(filePath: string, readCache: IPlanReadCache): boolean {

        return SfdxProjectService.isPathContainedInWorkspace(
            filePath,
            readCache.resolvedWorkspaceRoot,
            candidatePath => candidatePath === readCache.resolvedWorkspaceRoot ? readCache.realWorkspaceRoot : SfdxProjectService.getRealDirectoryPath(candidatePath)
        );

    }

    /*
        A source file found under one of the objects folders, or why not: absent, or present only
        through a path that resolves outside the workspace (a symlink), which never reaches the CLI.
    */
    private static findSourceFile(objectsFolderPaths: string[],
                                    readCache: IPlanReadCache,
                                    objectApiName: string,
                                    subFolderName: string | undefined,
                                    fileSuffix: string,
                                    apiName: string): { fileName: string } | { reason: 'notInLocalSource' | 'outsideWorkspace' } {

        let isOutsideWorkspace = false;

        for ( const objectsFolderPath of objectsFolderPaths ) {

            const objectFolderName = this.findEntryName(objectsFolderPath, objectApiName, readCache);
            if ( !objectFolderName ) {
                continue;
            }

            const containingFolderPath = subFolderName
                ? path.join(objectsFolderPath, objectFolderName, subFolderName)
                : path.join(objectsFolderPath, objectFolderName);
            const fileName = this.findEntryName(containingFolderPath, `${apiName}${fileSuffix}`, readCache);
            if ( !fileName ) {
                continue;
            }

            const filePath = path.join(containingFolderPath, fileName);
            if ( !this.isContainedInWorkspace(filePath, readCache) ) {
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
        const readCache = this.buildPlanReadCache(workspaceRoot);
        let deployedObjectName = objectApiName;

        if ( isObjectMissing ) {

            if ( !this.isCustomComponentName(objectApiName) ) {
                skip(objectApiName, 'standardObject');
                fieldApiNames.forEach(fieldApiName => skip(`${objectApiName}.${fieldApiName}`, 'objectNotDeployable'));
                return plan;
            }

            const objectSource = this.findSourceFile(objectsFolderPaths, readCache, objectApiName, undefined, '.object-meta.xml', objectApiName);
            const objectSourceName = 'fileName' in objectSource ? objectSource.fileName.slice(0, -'.object-meta.xml'.length) : undefined;

            if ( !objectSourceName || !SalesforceApiName.isApiName(objectSourceName) ) {
                skip(objectApiName, 'reason' in objectSource ? objectSource.reason : 'notAnApiName');
                fieldApiNames.forEach(fieldApiName => skip(`${objectApiName}.${fieldApiName}`, 'objectNotDeployable'));
                return plan;
            }

            deployedObjectName = objectSourceName;
            plan.members.push(`CustomObject:${deployedObjectName}`);
            plan.objectFolderContents = this.listObjectFolderContents(objectsFolderPaths, readCache, objectApiName);

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

            const fieldSource = this.findSourceFile(objectsFolderPaths, readCache, objectApiName, 'fields', '.field-meta.xml', fieldApiName);

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
        Every source file under the object's folder in every objects folder, as "<folder>/<file>" --
        what a CustomObject member sends along with the object. Names come from the repository, so
        the confirmation writes each on one line.
    */
    static listObjectFolderContents(objectsFolderPaths: string[], readCache: IPlanReadCache, objectApiName: string): string[] {

        const contents: string[] = [];

        objectsFolderPaths.forEach(objectsFolderPath => {

            const objectFolderName = this.findEntryName(objectsFolderPath, objectApiName, readCache);
            if ( !objectFolderName ) {
                return;
            }

            const objectFolderPath = path.join(objectsFolderPath, objectFolderName);

            ( this.readEntryNames(objectFolderPath, readCache) ?? [] ).forEach(entryName => {

                const childNames = this.readEntryNames(path.join(objectFolderPath, entryName), readCache);
                if ( childNames ) {
                    childNames.forEach(childName => contents.push(`${entryName}/${childName}`));
                } else if ( !entryName.endsWith('.object-meta.xml') ) {
                    contents.push(entryName);
                }

            });

        });

        return [...new Set(contents)].sort();

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
            return { kind: 'unconfirmed', failureMessage: 'The deploy did not finish in time and was stopped, so whether it applied is unknown.' };
        }

        if ( !payload ) {
            return { kind: 'failed', failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };
        }

        const deployComponentCounts = ScratchOrgService.readDeployComponentCounts(payload);

        if ( deployComponentCounts.isSucceeded ) {
            return { kind: 'deployed', deployedComponentCount: deployComponentCounts.numberComponentsDeployed ?? deployComponentCounts.componentSuccessCount };
        }

        return { kind: 'failed', failureMessage: deployComponentCounts.componentFailureProblems.join('; ') || ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };

    }

    // THE CONFIRMATION'S DETAIL: EVERY MEMBER TO BE DEPLOYED, EVERY ITEM LEFT OUT AND WHY, EACH ON ONE LINE
    static buildConfirmationDetail(plan: IMetadataDeployPlan, orgLabel: string): string {

        const toSingleLine = (text: string) => String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        const objectFolderContents = plan.objectFolderContents ?? [];
        const hiddenContentCount = objectFolderContents.length - METADATA_DEPLOY_OBJECT_FOLDER_CONTENTS_SHOWN;

        return [
            `Org: ${toSingleLine(orgLabel)}`,
            '',
            `To deploy (${plan.members.length}):`,
            ...plan.members.map(member => `  ${toSingleLine(member)}`),
            ...( plan.objectFolderContents
                ? [
                    '',
                    `${plan.members[0]} deploys the object with everything in its source folder (${objectFolderContents.length} ${objectFolderContents.length === 1 ? 'file' : 'files'}), not only the fields above:`,
                    ...objectFolderContents.slice(0, METADATA_DEPLOY_OBJECT_FOLDER_CONTENTS_SHOWN).map(content => `  ${toSingleLine(content)}`),
                    ...( hiddenContentCount > 0 ? [`  and ${hiddenContentCount} more`] : [] )
                ]
                : [] ),
            ...( plan.skippedItems.length > 0
                ? ['', `Skipped (${plan.skippedItems.length}):`, ...plan.skippedItems.map(skippedItem => `  ${toSingleLine(skippedItem.name)} — ${METADATA_DEPLOY_SKIP_REASON_TEXT[skippedItem.reason]}`)]
                : [] ),
            '',
            `${plan.objectFolderContents ? 'Only these members, and the object\'s folder,' : 'Only these members'} are deployed, from this workspace\'s source. The deploy is all or nothing: if any component fails, none is applied. Anything they depend on (a global value set, a permission) is not deployed with them, and field-level security is not granted.`
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
