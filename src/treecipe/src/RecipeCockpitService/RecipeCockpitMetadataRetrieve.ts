import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { IMetadataDeployComponent, IMetadataDeploySummary, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';

/*
    The Troubleshooting tab's retrieves (#326, #382): the argv that brings one relationship tree's
    validation rules, custom fields, record types or global value sets from an org into the project,
    how many local files of those components the project already holds, and the CLI's answer read
    back. It RETRIEVES and nothing else: no argv here deploys. It imports no vscode: the cockpit owns
    the org prompt, the confirmation, the progress and the notification.

    Validation rules and record types are fetched per OBJECT with a wildcard, since the point is to
    bring what the project does not hold yet and so cannot name. Fields and value sets are named one
    by one in a package.xml (--manifest): a tree can hold hundreds, and one --metadata each would pass
    the 8,191 characters cmd.exe allows on Windows. Every name comes from the HOST's model of the tree
    or the project, never from a panel message, and reaches an argv or a manifest only as an api name.
*/

export type MetadataRetrieveKind = 'validationRules' | 'fields' | 'recordTypes' | 'globalValueSets';

export type MetadataRetrieveWildcardKind = Extract<MetadataRetrieveKind, 'validationRules' | 'recordTypes'>;

export type MetadataRetrieveManifestKind = Extract<MetadataRetrieveKind, 'fields' | 'globalValueSets'>;

export type MetadataRetrieveType = 'ValidationRule' | 'CustomField' | 'RecordType' | 'GlobalValueSet';

export const METADATA_RETRIEVE_KINDS: readonly MetadataRetrieveKind[] = Object.freeze(['validationRules', 'fields', 'recordTypes', 'globalValueSets'] as MetadataRetrieveKind[]);

export const METADATA_RETRIEVE_TYPE_BY_KIND: Readonly<Record<MetadataRetrieveKind, MetadataRetrieveType>> = Object.freeze({
    validationRules: 'ValidationRule',
    fields: 'CustomField',
    recordTypes: 'RecordType',
    globalValueSets: 'GlobalValueSet'
});

export const METADATA_RETRIEVE_OPERATION_BY_KIND = Object.freeze({
    validationRules: 'validation-rule-retrieve',
    fields: 'field-retrieve',
    recordTypes: 'record-type-retrieve',
    globalValueSets: 'global-value-set-retrieve'
} as const);

export type MetadataRetrieveOperationName = typeof METADATA_RETRIEVE_OPERATION_BY_KIND[MetadataRetrieveKind];

export const VALIDATION_RULE_FILE_SUFFIX = '.validationRule-meta.xml';

export const VALIDATION_RULE_FOLDER_NAME = 'validationRules';

const FIELD_FOLDER_NAME = 'fields';
const FIELD_FILE_SUFFIX = '.field-meta.xml';

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const VALIDATION_RULE_OBJECTS_SEARCH_DEPTH = 6;

/*
    One --metadata per object for a wildcard retrieve, so the command line grows with the tree; on
    Windows the CLI runs through cmd.exe, which refuses a line past 8,191 characters. Eighty entries of
    at most "--metadata ValidationRule:<80 characters>.*" stay under it.
*/
export const METADATA_RETRIEVE_MAX_OBJECTS = 80;

export const METADATA_RETRIEVE_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;

// WHAT EACH KIND IS CALLED IN WHAT THE READER SEES: ONE, MANY, ITS FILES, WHAT "THE SAME" ONE IS, AND WHAT GENERATE TREECIPE DOES WITH THEM
const RETRIEVE_WORDS: Readonly<Record<MetadataRetrieveKind, { one: string; many: string; fileNoun: string; newFileNoun: string; scope: string; sameNoun: string; afterwards: string }>> = Object.freeze({
    validationRules: { one: 'validation rule', many: 'validation rules', fileNoun: 'validation rule', newFileNoun: 'rule', scope: 'objects', sameNoun: 'rule', afterwards: 'to apply the rules to the recipe' },
    fields: { one: 'custom field', many: 'custom fields', fileNoun: 'field', newFileNoun: 'field', scope: 'fields', sameNoun: 'field', afterwards: 'so the recipe follows the org\'s fields' },
    recordTypes: { one: 'record type', many: 'record types', fileNoun: 'record type', newFileNoun: 'record type', scope: 'objects', sameNoun: 'record type', afterwards: 'so the recipe can use them' },
    globalValueSets: { one: 'global value set', many: 'global value sets', fileNoun: 'global value set', newFileNoun: 'global value set', scope: 'value sets', sameNoun: 'value set', afterwards: 'so picklists generate the org\'s values' }
});

export type MetadataRetrieveOutcome =
    | {
        kind: 'retrieved';
        componentCount: number;
        // THE NAMES ASKED FOR (OBJECTS, OR VALUE SETS), AS SPELLED AND IN THEIR ORDER, THAT CAME BACK WITH AT LEAST ONE COMPONENT
        namesWithComponents: string[];
        // EMPTY WHEN EVERY FILE CAME BACK; OTHERWISE WHAT THE CLI SAID ABOUT THE ONES THAT DID NOT
        failureMessages: string[];
    }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    | { kind: 'unconfirmed'; failureMessage: string }
    | { kind: 'failed'; failureMessage: string };

export class RecipeCockpitMetadataRetrieve {

    static componentNoun(retrieveKind: MetadataRetrieveKind, count: number): string {
        return count === 1 ? RETRIEVE_WORDS[retrieveKind].one : RETRIEVE_WORDS[retrieveKind].many;
    }

    static describeComponents(retrieveKind: MetadataRetrieveKind, count: number): string {
        return `${count} ${this.componentNoun(retrieveKind, count)}`;
    }

    static isWildcardKind(retrieveKind: MetadataRetrieveKind): retrieveKind is MetadataRetrieveWildcardKind {
        return retrieveKind === 'validationRules' || retrieveKind === 'recordTypes';
    }

    // THE TREE'S OBJECTS ONCE EACH, IN ITS ORDER, SPLIT BY WHETHER THE NAME CAN REACH AN ARGV
    static partitionObjectApiNames(objectApiNames: readonly string[]): { retrievable: string[]; refused: string[] } {

        const partition = { retrievable: [] as string[], refused: [] as string[] };

        [...new Set(objectApiNames)].forEach(objectApiName => {
            ( SalesforceApiName.isApiName(objectApiName) ? partition.retrievable : partition.refused ).push(objectApiName);
        });

        return partition;

    }

    static buildWildcardRetrieveArguments(retrieveKind: MetadataRetrieveWildcardKind, objectApiNames: readonly string[], orgUsername: string): string[] {

        const nothingRetrieved = `so no ${RETRIEVE_WORDS[retrieveKind].one} was retrieved`;

        if ( objectApiNames.length === 0 ) {
            throw new Error(`No object was named, ${nothingRetrieved}.`);
        }

        if ( objectApiNames.length > METADATA_RETRIEVE_MAX_OBJECTS ) {
            throw new Error(`${objectApiNames.length} objects were named, and at most ${METADATA_RETRIEVE_MAX_OBJECTS} can be retrieved at once.`);
        }

        objectApiNames.forEach(objectApiName => {
            if ( !SalesforceApiName.isApiName(objectApiName) ) {
                throw new Error(`"${String(objectApiName).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a Salesforce api name, ${nothingRetrieved}.`);
            }
        });
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'retrieve', 'start',
            '--json',
            '--target-org', orgUsername,
            ...objectApiNames.flatMap(objectApiName => ['--metadata', `${METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind]}:${objectApiName}.*`])
        ];

    }

    static buildManifestRetrieveArguments(manifestRelativePath: string, orgUsername: string): string[] {

        RecipeCockpitMetadataDeploy.assertPlainManifestPath(manifestRelativePath, 'nothing was retrieved');
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'retrieve', 'start',
            '--json',
            '--target-org', orgUsername,
            '--manifest', manifestRelativePath
        ];

    }

    /*
        What a field or value set retrieve names, from the tree's project summary: every custom field
        the tree's recipe writes, whether or not its source file is here (the org may hold the one the
        project lacks), and every global value set those fields name, held here or not. Only api names
        in each type's shape are kept, once each, sorted with "<".
    */
    static listManifestComponents(retrieveKind: MetadataRetrieveManifestKind, summary: IMetadataDeploySummary): IMetadataDeployComponent[] {

        const type = METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind] as 'CustomField' | 'GlobalValueSet';
        const members = retrieveKind === 'fields'
            ? [...summary.customFields, ...summary.unreadableFields]
            : [...summary.globalValueSets, ...summary.missingGlobalValueSets];

        return [...new Set(members)]
            .filter(member => RecipeCockpitMetadataDeploy.isDeployableMember(type, member))
            .sort()
            .map(member => ({ type: type, member: member }));

    }

    static buildCliRequiredMessage(retrieveKind: MetadataRetrieveKind = 'validationRules'): string {

        return `The Salesforce CLI is required to retrieve ${RETRIEVE_WORDS[retrieveKind].many}, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    /*
        How many validation rule files the project already holds for these objects: every
        <Object>/validationRules/*.validationRule-meta.xml under an objects folder of a package
        directory, the object matched case-insensitively. A retrieve writes the org's version over
        each one the org also holds. Links are not followed and nothing outside the workspace is read.
    */
    static countLocalValidationRuleFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], objectApiNames: readonly string[]): number {

        const lowerObjectNames = new Set(objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
        const countedFolderPaths = new Set<string>();
        let fileCount = 0;

        const listDirectories = (folderPath: string): string[] => {
            try {
                return fs.readdirSync(folderPath, { withFileTypes: true })
                    .filter(entry => entry.isDirectory())
                    .map(entry => entry.name);
            } catch {
                return [];
            }
        };

        const countRuleFiles = (ruleFolderPath: string) => {
            if ( countedFolderPaths.has(ruleFolderPath) ) {
                return;
            }
            countedFolderPaths.add(ruleFolderPath);
            try {
                fileCount += fs.readdirSync(ruleFolderPath, { withFileTypes: true })
                    .filter(entry => entry.isFile() && entry.name.endsWith(VALIDATION_RULE_FILE_SUFFIX))
                    .length;
            } catch {
                // A FOLDER THAT CANNOT BE LISTED HOLDS NOTHING THE RETRIEVE WOULD BE SAID TO OVERWRITE
            }
        };

        const walk = (folderPath: string, depth: number) => {

            listDirectories(folderPath).forEach(folderName => {

                const childPath = path.join(folderPath, folderName);

                if ( folderName === 'objects' ) {
                    listDirectories(childPath)
                        .filter(objectFolderName => lowerObjectNames.has(objectFolderName.toLowerCase()))
                        .forEach(objectFolderName => countRuleFiles(path.join(childPath, objectFolderName, VALIDATION_RULE_FOLDER_NAME)));
                    return;
                }

                if ( depth < VALIDATION_RULE_OBJECTS_SEARCH_DEPTH ) {
                    walk(childPath, depth + 1);
                }

            });

        };

        new Set(packageDirectoryPaths.map(packageDirectoryPath => path.resolve(workspaceRoot, packageDirectoryPath))).forEach(packageDirectoryPath => {
            if ( SfdxProjectService.isPathContainedInWorkspace(packageDirectoryPath, workspaceRoot) ) {
                walk(packageDirectoryPath, 1);
            }
        });

        return fileCount;

    }

    /*
        How many of these "<Object>.<Field>" members already have a file in the project: the org's
        version is written over each one it also holds. A field is counted once, wherever its object's
        folders are; a link is not followed (lstat), so a planted link is not counted as a file.
    */
    static countLocalFieldFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], fieldMembers: readonly string[]): number {

        const fieldApiNamesByObject = new Map<string, Set<string>>();
        fieldMembers.forEach(member => {
            const [objectApiName, fieldApiName] = member.split('.');
            if ( objectApiName && fieldApiName ) {
                fieldApiNamesByObject.set(objectApiName, ( fieldApiNamesByObject.get(objectApiName) ?? new Set<string>() ).add(fieldApiName));
            }
        });

        const objectFolderPathsByObject = RecipeCockpitMetadataDeploy.findObjectFolderPaths(workspaceRoot, packageDirectoryPaths, [...fieldApiNamesByObject.keys()]);
        let fileCount = 0;

        fieldApiNamesByObject.forEach((fieldApiNames, objectApiName) => {
            const objectFolderPaths = objectFolderPathsByObject.get(objectApiName) ?? [];
            fieldApiNames.forEach(fieldApiName => {
                const isHeld = objectFolderPaths.some(objectFolderPath => {
                    try {
                        return fs.lstatSync(path.join(objectFolderPath, FIELD_FOLDER_NAME, `${fieldApiName}${FIELD_FILE_SUFFIX}`)).isFile();
                    } catch {
                        return false;
                    }
                });
                if ( isHeld ) {
                    fileCount++;
                }
            });
        });

        return fileCount;

    }

    /*
        The retrieve's answer, type-checked: it came back only on status 0 with result.success exactly
        true. Each file of the kind's type is counted under the name it was asked for,
        case-insensitively: for a wildcard retrieve the object its "<Object>.<Name>" full name names,
        for a manifest retrieve the field or value set it is. A file whose
        state is Failed or whose problemType is Error is a failure, named by what the CLI said. A file
        for a name that was not asked for is not counted.
    */
    static parseRetrieveOutput(retrieveKind: MetadataRetrieveKind,
                                invocationResult: ISalesforceCliInvocationResult,
                                askedNames: readonly string[],
                                payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataRetrieveOutcome {

        const words = RETRIEVE_WORDS[retrieveKind];

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage(retrieveKind) }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: `The Salesforce CLI's answer was too large to read, so which ${words.many} were retrieved is unknown.` };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: `The retrieve did not finish in time and was stopped, so which ${words.many} were retrieved is unknown.` };
        }

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result)
            ? payload.result as Record<string, unknown>
            : undefined;

        if ( !result || payload?.status !== 0 || result.success !== true ) {
            return { kind: 'failed', failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };
        }

        const metadataType = METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind];
        const askedNameByLowerName = new Map(askedNames.map(askedName => [askedName.toLowerCase(), askedName]));
        const fileRecords = ( Array.isArray(result.files) ? result.files : [] )
            .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
            .filter(fileRecord => fileRecord.type === metadataType && typeof fileRecord.fullName === 'string');

        const retrievedFullNames = new Set<string>();
        const namesWithComponents = new Set<string>();
        const failureMessages: string[] = [];

        fileRecords.forEach(fileRecord => {

            const fullName = fileRecord.fullName as string;
            const isFailure = fileRecord.state === 'Failed' || fileRecord.problemType === 'Error';

            if ( isFailure ) {
                const errorText = typeof fileRecord.error === 'string' && fileRecord.error.trim() !== '' ? fileRecord.error.trim() : 'it could not be retrieved';
                failureMessages.push(`${fullName}: ${errorText}`);
                return;
            }

            const askedName = askedNameByLowerName.get(( this.isWildcardKind(retrieveKind) ? fullName.split('.')[0] : fullName ).toLowerCase());
            if ( !askedName ) {
                return;
            }

            retrievedFullNames.add(fullName.toLowerCase());
            namesWithComponents.add(askedName);

        });

        return {
            kind: 'retrieved',
            componentCount: retrievedFullNames.size,
            namesWithComponents: askedNames.filter(askedName => namesWithComponents.has(askedName)),
            failureMessages: [...new Set(failureMessages)]
        };

    }

    // THE CONFIRMATION'S DETAIL, EACH VALUE ON ONE LINE AND WITH NO PARENTHESES OF ITS OWN, SINCE THE CALLER ESCAPES IT FOR A NOTIFICATION
    static buildConfirmationDetail(retrieveKind: MetadataRetrieveKind,
                                    treeLabel: string,
                                    orgLabel: string,
                                    askedNames: readonly string[],
                                    packageDirectoryRelativePath: string,
                                    localFileCount: number): string {

        const words = RETRIEVE_WORDS[retrieveKind];
        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
        const askedLine = this.isWildcardKind(retrieveKind)
            ? `${askedNames.length} ${askedNames.length === 1 ? 'object' : 'objects'}: ${askedNames.join(', ')}`
            : `${this.describeComponents(retrieveKind, askedNames.length)}: ${RecipeCockpitMetadataDeploy.describeCappedList(askedNames)}`;

        return [
            `Tree: ${toSingleLine(treeLabel)}`,
            `Org: ${toSingleLine(orgLabel)}`,
            askedLine,
            `New ${words.newFileNoun} files are written under: ${toSingleLine(packageDirectoryRelativePath)}`,
            localFileCount === 0
                ? `This project holds no ${words.fileNoun} file for these ${words.scope} yet.`
                : `${localFileCount} existing local ${words.fileNoun} ${localFileCount === 1 ? 'file' : 'files'} for these ${words.scope} will be overwritten with the org's version wherever the org holds the same ${words.sameNoun}.`,
            '',
            `Nothing is deployed. Run Generate Treecipe afterwards ${words.afterwards}.`
        ].join('\n');

    }

}
