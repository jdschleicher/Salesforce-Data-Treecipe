import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    "Retrieve validation rules…" (#326): the argv that retrieves one relationship tree's validation
    rules from an org, how many local rule files for those objects the project already holds, and the
    CLI's answer read back. It RETRIEVES and nothing else: no argv here deploys. It imports no vscode:
    the cockpit owns the org prompt, the confirmation, the progress and the notification.

    Every object name comes from the HOST's model of the tree, never from a panel message, and reaches
    an argv only if it is an api name.
*/

export const VALIDATION_RULE_FILE_SUFFIX = '.validationRule-meta.xml';

export const VALIDATION_RULE_FOLDER_NAME = 'validationRules';

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const VALIDATION_RULE_OBJECTS_SEARCH_DEPTH = 6;

/*
    One --metadata per object, so the command line grows with the tree; on Windows the CLI runs
    through cmd.exe, which refuses a line past 8,191 characters. Eighty entries of at most
    "--metadata ValidationRule:<80 characters>.*" stay under it.
*/
export const VALIDATION_RULE_RETRIEVE_MAX_OBJECTS = 80;

export const VALIDATION_RULE_RETRIEVE_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;

const VALIDATION_RULE_METADATA_TYPE = 'ValidationRule';

export type ValidationRuleRetrieveOutcome =
    | {
        kind: 'retrieved';
        ruleCount: number;
        // THE TREE'S OBJECTS, AS THE TREE SPELLS THEM AND IN ITS ORDER, THAT CAME BACK WITH AT LEAST ONE RULE
        objectApiNamesWithRules: string[];
        // EMPTY WHEN EVERY FILE CAME BACK; OTHERWISE WHAT THE CLI SAID ABOUT THE ONES THAT DID NOT
        failureMessages: string[];
    }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    | { kind: 'unconfirmed'; failureMessage: string }
    | { kind: 'failed'; failureMessage: string };

export class RecipeCockpitValidationRuleRetrieve {

    // THE TREE'S OBJECTS ONCE EACH, IN ITS ORDER, SPLIT BY WHETHER THE NAME CAN REACH AN ARGV
    static partitionObjectApiNames(objectApiNames: readonly string[]): { retrievable: string[]; refused: string[] } {

        const partition = { retrievable: [] as string[], refused: [] as string[] };

        [...new Set(objectApiNames)].forEach(objectApiName => {
            ( SalesforceApiName.isApiName(objectApiName) ? partition.retrievable : partition.refused ).push(objectApiName);
        });

        return partition;

    }

    static buildValidationRuleRetrieveArguments(objectApiNames: readonly string[], orgUsername: string): string[] {

        if ( objectApiNames.length === 0 ) {
            throw new Error('No object was named, so no validation rule was retrieved.');
        }

        if ( objectApiNames.length > VALIDATION_RULE_RETRIEVE_MAX_OBJECTS ) {
            throw new Error(`${objectApiNames.length} objects were named, and at most ${VALIDATION_RULE_RETRIEVE_MAX_OBJECTS} can be retrieved at once.`);
        }

        objectApiNames.forEach(objectApiName => {
            if ( !SalesforceApiName.isApiName(objectApiName) ) {
                throw new Error(`"${String(objectApiName).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a Salesforce api name, so no validation rule was retrieved.`);
            }
        });
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'retrieve', 'start',
            '--json',
            '--target-org', orgUsername,
            ...objectApiNames.flatMap(objectApiName => ['--metadata', `${VALIDATION_RULE_METADATA_TYPE}:${objectApiName}.*`])
        ];

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI is required to retrieve validation rules, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

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
        The retrieve's answer, type-checked: it came back only on status 0 with result.success exactly
        true. Each ValidationRule file is counted under the tree object its "<Object>.<Rule>" full name
        names, case-insensitively; a file whose state is Failed or whose problemType is Error is a
        failure, named by what the CLI said. A rule for an object the tree does not hold is not counted.
    */
    static parseValidationRuleRetrieveOutput(invocationResult: ISalesforceCliInvocationResult,
                                                objectApiNames: readonly string[],
                                                payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): ValidationRuleRetrieveOutcome {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: 'The Salesforce CLI\'s answer was too large to read, so which validation rules were retrieved is unknown.' };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: 'The retrieve did not finish in time and was stopped, so which validation rules were retrieved is unknown.' };
        }

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result)
            ? payload.result as Record<string, unknown>
            : undefined;

        if ( !result || payload?.status !== 0 || result.success !== true ) {
            return { kind: 'failed', failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };
        }

        const objectApiNameByLowerName = new Map(objectApiNames.map(objectApiName => [objectApiName.toLowerCase(), objectApiName]));
        const fileRecords = ( Array.isArray(result.files) ? result.files : [] )
            .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
            .filter(fileRecord => fileRecord.type === VALIDATION_RULE_METADATA_TYPE && typeof fileRecord.fullName === 'string');

        const retrievedFullNames = new Set<string>();
        const objectNamesWithRules = new Set<string>();
        const failureMessages: string[] = [];

        fileRecords.forEach(fileRecord => {

            const fullName = fileRecord.fullName as string;
            const isFailure = fileRecord.state === 'Failed' || fileRecord.problemType === 'Error';

            if ( isFailure ) {
                const errorText = typeof fileRecord.error === 'string' && fileRecord.error.trim() !== '' ? fileRecord.error.trim() : 'it could not be retrieved';
                failureMessages.push(`${fullName}: ${errorText}`);
                return;
            }

            const objectApiName = objectApiNameByLowerName.get(fullName.split('.')[0].toLowerCase());
            if ( !objectApiName ) {
                return;
            }

            retrievedFullNames.add(fullName.toLowerCase());
            objectNamesWithRules.add(objectApiName);

        });

        return {
            kind: 'retrieved',
            ruleCount: retrievedFullNames.size,
            objectApiNamesWithRules: objectApiNames.filter(objectApiName => objectNamesWithRules.has(objectApiName)),
            failureMessages: [...new Set(failureMessages)]
        };

    }

    // THE CONFIRMATION'S DETAIL, EACH VALUE ON ONE LINE AND WITH NO PARENTHESES OF ITS OWN, SINCE THE CALLER ESCAPES IT FOR A NOTIFICATION
    static buildConfirmationDetail(treeLabel: string,
                                    orgLabel: string,
                                    objectApiNames: readonly string[],
                                    packageDirectoryRelativePath: string,
                                    localRuleFileCount: number): string {

        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

        return [
            `Tree: ${toSingleLine(treeLabel)}`,
            `Org: ${toSingleLine(orgLabel)}`,
            `${objectApiNames.length} ${objectApiNames.length === 1 ? 'object' : 'objects'}: ${objectApiNames.join(', ')}`,
            `New rule files are written under: ${toSingleLine(packageDirectoryRelativePath)}`,
            localRuleFileCount === 0
                ? 'This project holds no validation rule file for these objects yet.'
                : `${localRuleFileCount} existing local validation rule ${localRuleFileCount === 1 ? 'file' : 'files'} for these objects will be overwritten with the org's version wherever the org holds the same rule.`,
            '',
            'Nothing is deployed. Run Generate Treecipe afterwards to apply the rules to the recipe.'
        ].join('\n');

    }

}
