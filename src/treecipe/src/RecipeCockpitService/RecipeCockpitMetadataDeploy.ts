import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    "Deploy this metadata…" (#211, #273): everything one relationship tree needs in the selected
    sandbox, turned into the --metadata members of one "sf project deploy start", and the CLI's
    answer read back. It imports no vscode: the cockpit owns the org, the confirmation, the progress
    and the panel, and this file owns the member list, the local-source lookup, the argv and the parse.

    Every member comes from the HOST -- the objects of the tree in the model it rendered, and the
    files on disk -- never from a panel message, and every name in one is held to SalesforceApiName
    twice: as the tree named it, and as the source file on disk spells it, since that spelling is
    what reaches the argv.
*/

// A DEPLOY CAN RUN FOR MINUTES ON A BUSY SANDBOX; PAST THIS THE PROCESS TREE IS KILLED AND THE RUN REPORTED AS UNFINISHED
export const METADATA_DEPLOY_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

export const METADATA_DEPLOY_MAX_BUFFER_BYTES = 1024 * 1024 * 64;

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const METADATA_DEPLOY_OBJECTS_FOLDER_SEARCH_DEPTH = 5;

const CUSTOM_COMPONENT_SUFFIX_PATTERN = /__c$/i;

export type MetadataDeploySkipReason = 'notAnApiName' | 'standardField' | 'notInLocalSource' | 'outsideWorkspace' | 'noCustomFieldsInSource';

export const METADATA_DEPLOY_SKIP_REASON_TEXT: Readonly<Record<MetadataDeploySkipReason, string>> = {
    notAnApiName: 'not a Salesforce api name',
    standardField: 'not a custom field (__c), which this does not deploy',
    notInLocalSource: 'not in local source',
    outsideWorkspace: 'its source file resolves outside this workspace',
    noCustomFieldsInSource: 'a standard object with no custom field (__c) in local source'
};

export interface IMetadataDeploySkippedItem {
    name: string;
    reason: MetadataDeploySkipReason;
}

/*
    One object's share of a tree's plan. A custom object is ONE CustomObject member, and in source
    format that member deploys EVERYTHING under the object's folder -- fields the recipe never
    names, validation rules, record types, list views -- so sourceFiles lists those files and the
    confirmation shows them, rather than only the member. A standard object cannot be deployed, so
    it contributes the custom fields its source folder has, one CustomField member each.
*/
export interface IMetadataDeployObjectPlan {
    objectApiName: string;
    members: string[];
    sourceFiles: string[];
}

export interface ITreeMetadataDeployPlan {
    treeLabel: string;
    objectPlans: IMetadataDeployObjectPlan[];
    members: string[];
    skippedItems: IMetadataDeploySkippedItem[];
}

// HOW MANY SOURCE FILES THE CONFIRMATION SPELLS OUT ACROSS THE WHOLE TREE; THE REST ARE COUNTED
export const METADATA_DEPLOY_SOURCE_FILES_SHOWN = 60;

/*
    One plan's reads, made once: a folder's entries, and the workspace root's real path. A plan
    looks the same folders up once per object, so without this a 200-object tree re-read every
    objects folder 200 times.
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
        The members to deploy for every object of one tree, and everything left out, with why. A
        custom object is deployed whole, as its CustomObject member; a standard object only through
        the custom fields its source folder has. One not found in local source is not guessed at.
        Names reach a member only as the source file on disk spells them, and only if that spelling
        is an api name too. An object the tree lists twice, in any case, is planned once.
    */
    static planTreeMetadataDeploy(treeLabel: string, objectApiNames: readonly string[], workspaceRoot: string, packageDirectoryPaths: string[]): ITreeMetadataDeployPlan {

        const plan: ITreeMetadataDeployPlan = { treeLabel: treeLabel, objectPlans: [], members: [], skippedItems: [] };
        const objectsFolderPaths = this.findObjectsFolderPaths(workspaceRoot, packageDirectoryPaths);
        const readCache = this.buildPlanReadCache(workspaceRoot);
        const plannedObjectNames = new Set<string>();

        objectApiNames.forEach(objectApiName => {

            const lowerObjectApiName = String(objectApiName).toLowerCase();
            if ( plannedObjectNames.has(lowerObjectApiName) ) {
                return;
            }
            plannedObjectNames.add(lowerObjectApiName);

            if ( !SalesforceApiName.isApiName(objectApiName) ) {
                plan.skippedItems.push({ name: String(objectApiName), reason: 'notAnApiName' });
                return;
            }

            const objectPlan = this.isCustomComponentName(objectApiName)
                ? this.planCustomObject(objectsFolderPaths, readCache, objectApiName, plan.skippedItems)
                : this.planStandardObjectFields(objectsFolderPaths, readCache, objectApiName, plan.skippedItems);

            if ( objectPlan ) {
                plan.objectPlans.push(objectPlan);
                plan.members.push(...objectPlan.members);
            }

        });

        return plan;

    }

    private static planCustomObject(objectsFolderPaths: string[],
                                    readCache: IPlanReadCache,
                                    objectApiName: string,
                                    skippedItems: IMetadataDeploySkippedItem[]): IMetadataDeployObjectPlan | undefined {

        const objectSource = this.findSourceFile(objectsFolderPaths, readCache, objectApiName, undefined, '.object-meta.xml', objectApiName);

        if ( 'reason' in objectSource ) {
            skippedItems.push({ name: objectApiName, reason: objectSource.reason });
            return undefined;
        }

        const objectSourceName = objectSource.fileName.slice(0, -'.object-meta.xml'.length);

        if ( !SalesforceApiName.isApiName(objectSourceName) ) {
            skippedItems.push({ name: objectApiName, reason: 'notAnApiName' });
            return undefined;
        }

        return {
            objectApiName: objectApiName,
            members: [`CustomObject:${objectSourceName}`],
            sourceFiles: this.listObjectFolderContents(objectsFolderPaths, readCache, objectApiName)
        };

    }

    // EVERY CUSTOM FIELD FILE UNDER THE OBJECT'S fields FOLDER, IN EVERY objects FOLDER, EACH INSIDE THE WORKSPACE
    private static planStandardObjectFields(objectsFolderPaths: string[],
                                            readCache: IPlanReadCache,
                                            objectApiName: string,
                                            skippedItems: IMetadataDeploySkippedItem[]): IMetadataDeployObjectPlan | undefined {

        const fieldFileSuffix = '.field-meta.xml';
        const members = new Set<string>();
        const sourceFiles = new Set<string>();
        const skippedFieldNames = new Set<string>();
        const skipField = (fieldLabel: string, reason: MetadataDeploySkipReason) => {
            if ( !skippedFieldNames.has(fieldLabel) ) {
                skippedFieldNames.add(fieldLabel);
                skippedItems.push({ name: fieldLabel, reason: reason });
            }
        };

        objectsFolderPaths.forEach(objectsFolderPath => {

            const objectFolderName = this.findEntryName(objectsFolderPath, objectApiName, readCache);
            if ( !objectFolderName || !SalesforceApiName.isApiName(objectFolderName) ) {
                return;
            }

            const fieldsFolderPath = path.join(objectsFolderPath, objectFolderName, 'fields');

            ( this.readEntryNames(fieldsFolderPath, readCache) ?? [] )
                .filter(entryName => entryName.endsWith(fieldFileSuffix))
                .forEach(entryName => {

                    const fieldSourceName = entryName.slice(0, -fieldFileSuffix.length);
                    const fieldLabel = `${objectApiName}.${fieldSourceName}`;

                    if ( !SalesforceApiName.isApiName(fieldSourceName) ) {
                        skipField(fieldLabel, 'notAnApiName');
                        return;
                    }

                    if ( !this.isCustomComponentName(fieldSourceName) ) {
                        skipField(fieldLabel, 'standardField');
                        return;
                    }

                    const filePath = path.join(fieldsFolderPath, entryName);

                    if ( !this.isContainedInWorkspace(filePath, readCache) ) {
                        skipField(fieldLabel, 'outsideWorkspace');
                        return;
                    }

                    if ( SfdxProjectService.isExistingFile(filePath) ) {
                        members.add(`CustomField:${objectFolderName}.${fieldSourceName}`);
                        sourceFiles.add(`${objectFolderName}/fields/${entryName}`);
                    }

                });

        });

        if ( members.size === 0 ) {
            if ( skippedFieldNames.size === 0 ) {
                skippedItems.push({ name: objectApiName, reason: 'noCustomFieldsInSource' });
            }
            return undefined;
        }

        return { objectApiName: objectApiName, members: [...members].sort(), sourceFiles: [...sourceFiles].sort() };

    }

    /*
        Every source file under the object's folder in every objects folder, as
        "<object folder>/<file>" -- what a CustomObject member sends along with the object. Names
        come from the repository, so the confirmation writes each on one line.
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
                    childNames.forEach(childName => contents.push(`${objectFolderName}/${entryName}/${childName}`));
                } else {
                    contents.push(`${objectFolderName}/${entryName}`);
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

    // THE CONFIRMATION'S DETAIL: EVERY MEMBER, THE SOURCE FILES THEY SEND, EVERY ITEM LEFT OUT AND WHY, EACH ON ONE LINE
    static buildConfirmationDetail(plan: ITreeMetadataDeployPlan, orgLabel: string): string {

        const toSingleLine = (text: string) => String(text ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        const sourceFiles = plan.objectPlans.flatMap(objectPlan => objectPlan.sourceFiles);
        const hiddenSourceFileCount = sourceFiles.length - METADATA_DEPLOY_SOURCE_FILES_SHOWN;
        const hasCustomObject = plan.members.some(member => member.startsWith('CustomObject:'));

        return [
            `Tree: ${toSingleLine(plan.treeLabel)}`,
            `Org: ${toSingleLine(orgLabel)}`,
            '',
            `To deploy (${plan.members.length}):`,
            ...plan.members.map(member => `  ${toSingleLine(member)}`),
            '',
            `Source files sent (${sourceFiles.length}):`,
            ...sourceFiles.slice(0, METADATA_DEPLOY_SOURCE_FILES_SHOWN).map(sourceFile => `  ${toSingleLine(sourceFile)}`),
            ...( hiddenSourceFileCount > 0 ? [`  and ${hiddenSourceFileCount} more`] : [] ),
            ...( plan.skippedItems.length > 0
                ? ['', `Skipped (${plan.skippedItems.length}):`, ...plan.skippedItems.map(skippedItem => `  ${toSingleLine(skippedItem.name)} — ${METADATA_DEPLOY_SKIP_REASON_TEXT[skippedItem.reason]}`)]
                : [] ),
            '',
            [
                ...( hasCustomObject ? ['A CustomObject member deploys everything in its object\'s source folder, not only the fields the recipe uses.'] : [] ),
                'Everything is deployed from this workspace\'s source, and the deploy is all or nothing: if any component fails, none is applied.',
                'Anything these depend on outside the tree (a global value set, another object) is not deployed with them, and no permission set is deployed or assigned.'
            ].join(' ')
        ].join('\n');

    }

    // WHY NOTHING WAS DEPLOYED WHEN THE PLAN LEFT NOTHING
    static buildNothingToDeployMessage(plan: ITreeMetadataDeployPlan): string {

        const skippedText = plan.skippedItems
            .map(skippedItem => `${skippedItem.name} is ${METADATA_DEPLOY_SKIP_REASON_TEXT[skippedItem.reason]}`)
            .join('; ');

        return `Nothing of the tree ${plan.treeLabel} can be deployed${skippedText ? `: ${skippedText}` : ''}.`;

    }

}
