
import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { IMetadataDeployComponent, IMetadataDeployObject, IMetadataDeploySummary, METADATA_RETRIEVE_PACKAGE_XML_TYPES, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';

/*
    The Troubleshooting tab's retrieves (#326, #382): the argv that brings one relationship tree's
    validation rules, custom fields, record types or global value sets from an org into the project,
    how many local files of those components the project already holds, and the CLI's answer read
    back. It RETRIEVES and nothing else: no argv here deploys. It imports no vscode: the cockpit owns
    the org prompt, the confirmation, the progress and the notification.

    Every kind is named one by one in a package.xml (--manifest): a tree can hold hundreds, and one
    --metadata each would pass the 8,191 characters cmd.exe allows on Windows. Validation rules and
    record types are LISTED in the org first ("sf org list metadata", #401), since the point is to
    bring what the project does not hold yet and so cannot name: a "<Type>:<Object>.*" wildcard is no
    answer, because the Metadata API expands "*" only as a whole member name and these are child
    types of CustomObject. Every name comes from the HOST's model of the tree, the project or the
    org's listing, never from a panel message, and reaches an argv or a manifest only as an api name.
*/

export type MetadataRetrieveKind = 'validationRules' | 'fields' | 'recordTypes' | 'globalValueSets';

// THE KINDS WHOSE COMPONENTS ARE LISTED IN THE ORG BEFORE THEY ARE RETRIEVED (#401)
export type MetadataRetrieveListedKind = Extract<MetadataRetrieveKind, 'validationRules' | 'recordTypes'>;

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
const RECORD_TYPE_FOLDER_NAME = 'recordTypes';
const RECORD_TYPE_FILE_SUFFIX = '.recordType-meta.xml';

// WHERE A LISTED KIND'S FILES LIVE UNDER AN OBJECT FOLDER, FOR COUNTING WHAT A RETRIEVE OVERWRITES
const LISTED_KIND_FILES: Readonly<Record<MetadataRetrieveListedKind, { folderName: string; fileSuffix: string }>> = Object.freeze({
    validationRules: { folderName: VALIDATION_RULE_FOLDER_NAME, fileSuffix: VALIDATION_RULE_FILE_SUFFIX },
    recordTypes: { folderName: RECORD_TYPE_FOLDER_NAME, fileSuffix: RECORD_TYPE_FILE_SUFFIX }
});

export const METADATA_RETRIEVE_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;

export const METADATA_LIST_TIMEOUT_MILLISECONDS = 5 * 60 * 1000;

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

export type MetadataListOutcome =
    | {
        kind: 'listed';
        // THE ORG'S COMPONENTS OF THE TREE'S OBJECTS, ONCE EACH, SORTED WITH "<", SPELLED AS THE ORG SPELLS THEM
        components: IMetadataDeployComponent[];
        // ENTRIES OF THE KIND'S TYPE THAT WERE LEFT OUT: NOT A STRING, OR NOT AN API NAME IN THE TYPE'S SHAPE
        skippedCount: number;
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

    static isListedKind(retrieveKind: MetadataRetrieveKind): retrieveKind is MetadataRetrieveListedKind {
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

    // THE ORG'S COMPONENTS OF ONE TYPE, EVERY OBJECT'S: THE LISTING HAS NO PER-OBJECT FILTER, SO parseListMetadataOutput KEEPS THE TREE'S
    static buildListMetadataArguments(retrieveKind: MetadataRetrieveListedKind, orgUsername: string): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'org', 'list', 'metadata',
            '--json',
            '--target-org', orgUsername,
            '--metadata-type', METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind]
        ];

    }

    /*
        The listing's answer, type-checked: listed only on status 0 with a result array (one entry
        not wrapped in an array is read as one entry, as the Metadata API answers a single
        component). An entry of the kind's type is kept when its full name is "<Object>.<Name>", both
        api names, and its object is one of the tree's, case-insensitively; an entry of the type that
        is not a string or not in that shape is left out and counted. The listing is never read as
        "none" unless the org said so.
    */
    static parseListMetadataOutput(retrieveKind: MetadataRetrieveListedKind,
                                    invocationResult: ISalesforceCliInvocationResult,
                                    objectApiNames: readonly string[],
                                    payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataListOutcome {

        const invocationFailure = this.readInvocationFailure(retrieveKind, invocationResult, `which ${RETRIEVE_WORDS[retrieveKind].many} the org holds is unknown`);
        if ( invocationFailure ) {
            return invocationFailure;
        }

        const rawResult = payload?.result;
        const entries = Array.isArray(rawResult) ? rawResult
            : rawResult !== null && typeof rawResult === 'object' ? [rawResult]
            : undefined;

        if ( !entries || payload?.status !== 0 ) {
            return { kind: 'failed', failureMessage: ScratchOrgService.buildCliFailureDetail(payload, invocationResult) };
        }

        const metadataType = METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind];
        const lowerObjectApiNames = new Set(objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
        const membersByLowerName = new Map<string, string>();
        let skippedCount = 0;

        entries
            .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
            .filter(entry => entry.type === undefined || entry.type === metadataType)
            .forEach(entry => {

                if ( !RecipeCockpitMetadataDeploy.isDeployableMember(metadataType, entry.fullName) ) {
                    skippedCount++;
                    return;
                }

                const member = entry.fullName;
                if ( lowerObjectApiNames.has(member.split('.')[0].toLowerCase()) && !membersByLowerName.has(member.toLowerCase()) ) {
                    membersByLowerName.set(member.toLowerCase(), member);
                }

            });

        return {
            kind: 'listed',
            components: [...membersByLowerName.values()].sort().map(member => ({ type: metadataType, member: member })),
            skippedCount: skippedCount
        };

    }

    // THE PACKAGE.XML A RETRIEVE NAMES ITS COMPONENTS IN: THE DEPLOY'S BUILDER, ADMITTING THE TYPES THE RETRIEVES ASK FOR
    static buildRetrievePackageXml(components: readonly IMetadataDeployComponent[], apiVersion?: string): string {
        return RecipeCockpitMetadataDeploy.buildPackageXml(components, apiVersion, 'nothing was retrieved', METADATA_RETRIEVE_PACKAGE_XML_TYPES);
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

    // THE SAME FIELDS listManifestComponents NAMES FROM A SUMMARY, WITHOUT READING A FILE: A FIELD RETRIEVE NEEDS NO <valueSetName>
    static listCustomFieldComponents(deployObjects: readonly IMetadataDeployObject[]): IMetadataDeployComponent[] {

        const members = deployObjects
            .filter(deployObject => SalesforceApiName.isApiName(deployObject.objectApiName))
            .flatMap(deployObject => deployObject.fieldApiNames
                .filter(fieldApiName => SalesforceApiName.isApiName(fieldApiName) && RecipeCockpitMetadataDeploy.isCustomFieldName(fieldApiName))
                .map(fieldApiName => `${deployObject.objectApiName}.${fieldApiName}`));

        return [...new Set(members)]
            .filter(member => RecipeCockpitMetadataDeploy.isDeployableMember('CustomField', member))
            .sort()
            .map(member => ({ type: 'CustomField', member: member }));

    }

    static buildCliRequiredMessage(retrieveKind: MetadataRetrieveKind = 'validationRules'): string {

        return `The Salesforce CLI is required to retrieve ${RETRIEVE_WORDS[retrieveKind].many}, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    /*
        How many of these listed "<Object>.<Name>" members already have a file in the project: the
        org's version is written over each one. A validation rule's file is
        <Object>/validationRules/<Name>.validationRule-meta.xml, a record type's
        <Object>/recordTypes/<Name>.recordType-meta.xml, under any package directory's objects folder.
    */
    static countLocalListedFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], retrieveKind: MetadataRetrieveListedKind, members: readonly string[]): number {
        const { folderName, fileSuffix } = LISTED_KIND_FILES[retrieveKind];
        return this.countLocalObjectChildFiles(workspaceRoot, packageDirectoryPaths, members, folderName, fileSuffix);
    }

    /*
        How many of these "<Object>.<Field>" members already have a file in the project: the org's
        version is written over each one it also holds. A field is counted once, wherever its object's
        folders are, and its file name is matched case-insensitively, as the Troubleshooting summary
        matches it. No link is followed: a linked fields/ folder is not listed and a linked file is
        not a file, so this counts what the summary counts.
    */
    static countLocalFieldFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], fieldMembers: readonly string[]): number {
        return this.countLocalObjectChildFiles(workspaceRoot, packageDirectoryPaths, fieldMembers, FIELD_FOLDER_NAME, FIELD_FILE_SUFFIX);
    }

    private static countLocalObjectChildFiles(workspaceRoot: string,
                                                packageDirectoryPaths: readonly string[],
                                                members: readonly string[],
                                                folderName: string,
                                                fileSuffix: string): number {

        // KEYED BY THE LOWER-CASED OBJECT NAME, SO "Account.X" AND "account.Y" READ ONE OBJECT FOLDER
        const lowerChildNamesByObject = new Map<string, Set<string>>();
        members.forEach(member => {
            const [objectApiName, childName] = member.split('.');
            if ( objectApiName && childName ) {
                const lowerObjectApiName = objectApiName.toLowerCase();
                lowerChildNamesByObject.set(lowerObjectApiName, ( lowerChildNamesByObject.get(lowerObjectApiName) ?? new Set<string>() ).add(childName.toLowerCase()));
            }
        });

        const objectFolderPathsByObject = RecipeCockpitMetadataDeploy.findObjectFolderPaths(workspaceRoot, packageDirectoryPaths, [...lowerChildNamesByObject.keys()]);
        const lowerFileSuffix = fileSuffix.toLowerCase();
        let fileCount = 0;

        lowerChildNamesByObject.forEach((lowerChildNames, objectApiName) => {
            const heldLowerChildNames = new Set<string>();
            ( objectFolderPathsByObject.get(objectApiName) ?? [] ).forEach(objectFolderPath => {
                RecipeCockpitMetadataDeploy.listSubfolderEntries(objectFolderPath, folderName)
                    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(lowerFileSuffix))
                    .forEach(entry => heldLowerChildNames.add(entry.name.toLowerCase().slice(0, -lowerFileSuffix.length)));
            });
            lowerChildNames.forEach(lowerChildName => {
                if ( heldLowerChildNames.has(lowerChildName) ) {
                    fileCount++;
                }
            });
        });

        return fileCount;

    }

    /*
        The retrieve's answer, type-checked: it came back only on status 0 with result.success exactly
        true. Each file of the kind's type is counted under the member it was asked for,
        case-insensitively. A file whose
        state is Failed or whose problemType is Error is a failure, named by what the CLI said. A file
        for a name that was not asked for is not counted.
    */
    static parseRetrieveOutput(retrieveKind: MetadataRetrieveKind,
                                invocationResult: ISalesforceCliInvocationResult,
                                askedNames: readonly string[],
                                payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataRetrieveOutcome {

        const invocationFailure = this.readInvocationFailure(retrieveKind, invocationResult, `which ${RETRIEVE_WORDS[retrieveKind].many} were retrieved is unknown`, 'The retrieve');
        if ( invocationFailure ) {
            return invocationFailure;
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

            const askedName = askedNameByLowerName.get(fullName.toLowerCase());
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

    // A CLI THAT DID NOT START, OUTGREW ITS BUFFER OR TIMED OUT: undefined WHEN IT RAN AND ANSWERED
    private static readInvocationFailure(retrieveKind: MetadataRetrieveKind,
                                            invocationResult: ISalesforceCliInvocationResult,
                                            unknownClause: string,
                                            runNoun: string = 'The listing'): Exclude<MetadataListOutcome, { kind: 'listed' }> | undefined {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage(retrieveKind) }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: `The Salesforce CLI's answer was too large to read, so ${unknownClause}.` };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: `${runNoun} did not finish in time and was stopped, so ${unknownClause}.` };
        }

        return undefined;

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
        const askedLine = `${this.describeComponents(retrieveKind, askedNames.length)}: ${RecipeCockpitMetadataDeploy.describeCappedList(askedNames)}`;

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
