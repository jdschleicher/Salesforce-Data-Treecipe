
import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { IMetadataDeployComponent, IMetadataDeployObject, IMetadataDeploySummary, METADATA_RETRIEVE_PACKAGE_XML_TYPES, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import { IRecipeCockpitConfirmContent, IRecipeCockpitConfirmOrg } from './RecipeCockpitConfirmContent';

/*
    The Troubleshooting tab's retrieves (#326, #382): the argv that brings one relationship tree's
    validation rules, custom fields, record types or global value sets from an org into the project,
    how many local files of those components the project already holds, and the CLI's answer read
    back. It RETRIEVES and nothing else: no argv here deploys. It imports no vscode: the cockpit owns
    the org prompt, the confirmation, the progress and the notification.

    Every kind is named one by one in a package.xml (--manifest): a tree can hold hundreds, and one
    --metadata each would pass the 8,191 characters cmd.exe allows on Windows. Validation rules and
    record types are LISTED in the org first (the Metadata API's listMetadata on a jsforce
    connection, #401, #498), since the point is to bring what the project does not hold yet and so
    cannot name: a "<Type>:<Object>.*" wildcard is no answer, because the Metadata API expands "*"
    only as a whole member name and these are child types of CustomObject. Every name comes from the HOST's model of the tree, the project or the
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

// THE METADATA API REFUSES A RETRIEVE OF MORE FILES THAN THIS, SO A LONGER LISTING IS REFUSED BEFORE THE CONFIRMATION
export const METADATA_RETRIEVE_MAX_COMPONENTS = 10000;

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
        // ENTRIES OF THE KIND'S TYPE LEFT OUT: A FULL NAME THAT IS NOT A STRING, OR ONE OF A TREE OBJECT THAT IS NOT AN API NAME IN THE TYPE'S SHAPE
        skippedCount: number;
    }
    | { kind: 'cancelled' }
    | { kind: 'unconfirmed'; failureMessage: string }
    | { kind: 'failed'; failureMessage: string };

// WHAT THE LISTING NEEDS OF A jsforce CONNECTION: ITS METADATA API'S listMetadata
export interface IMetadataListSource {
    list(query: { type: string }): Promise<unknown>;
}

// A vscode CancellationToken'S SHAPE, SO THIS FILE STAYS FREE OF vscode
export interface IMetadataListCancellation {
    readonly isCancellationRequested: boolean;
    // A vscode TOKEN ANSWERS A Disposable, WHICH IS DISPOSED WHEN THE LISTING ENDS
    onCancellationRequested(listener: () => void): unknown;
}

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

    /*
        The org's components of one type, every object's, from the Metadata API's listMetadata on a
        connection opened by username (#498, replacing "sf org list metadata"): the listing has no
        per-object filter, so readListedEntries keeps the tree's. Opening the connection and the call
        are both raced against the cancellation and the timeout, and the one that loses is abandoned:
        a listing reads nothing it is not answered, so there is nothing to stop. A connection that
        could not be opened is one fixed message, since its error can carry an auth url or token text.
    */
    static async listOrgMetadata(openListSource: () => Promise<IMetadataListSource>,
                                    retrieveKind: MetadataRetrieveListedKind,
                                    objectApiNames: readonly string[],
                                    timeoutMilliseconds: number,
                                    cancellation: IMetadataListCancellation): Promise<MetadataListOutcome> {

        if ( cancellation.isCancellationRequested ) {
            return { kind: 'cancelled' };
        }

        const unknownClause = `which ${RETRIEVE_WORDS[retrieveKind].many} the org holds is unknown`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelListener: unknown;

        const listing = (async (): Promise<MetadataListOutcome> => {

            let listSource: IMetadataListSource;
            try {
                listSource = await openListSource();
            } catch {
                return { kind: 'failed', failureMessage: `The org could not be connected to, so ${unknownClause}.` };
            }

            let listedResult: unknown;
            try {
                listedResult = await listSource.list({ type: METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind] });
            } catch (listError) {
                return { kind: 'failed', failureMessage: this.describeListError(listError) };
            }

            return this.readListedEntries(retrieveKind, listedResult, objectApiNames);

        })();

        const cancelled = new Promise<MetadataListOutcome>(resolve => {
            cancelListener = cancellation.onCancellationRequested(() => resolve({ kind: 'cancelled' }));
        });

        const timedOut = new Promise<MetadataListOutcome>(resolve => {
            timer = setTimeout(() => resolve({ kind: 'unconfirmed', failureMessage: `The listing did not finish in time and was stopped, so ${unknownClause}.` }), timeoutMilliseconds);
        });

        try {
            const outcome = await Promise.race([listing, cancelled, timedOut]);
            // A CANCEL REQUESTED WHILE THE ANSWER WAS ON ITS WAY STILL WINS: THE READER WAS TOLD NOTHING WOULD BE RETRIEVED
            return cancellation.isCancellationRequested ? { kind: 'cancelled' } : outcome;
        } finally {
            clearTimeout(timer);
            if ( cancelListener !== null && typeof cancelListener === 'object' && typeof (cancelListener as { dispose?: unknown }).dispose === 'function' ) {
                (cancelListener as { dispose(): unknown }).dispose();
            }
        }

    }

    /*
        The listing's answer, type-checked: an array of entries (one entry not wrapped in an array is
        read as one entry, as the Metadata API answers a single component). An entry of the kind's
        type is kept when its full name is "<Object>.<Name>", both api names, and its object is one of
        the tree's, case-insensitively. An entry of a tree object that is not in that shape, or whose
        full name is not a string, is left out and counted; another object's is ignored, so the count
        is about this tree. Anything else is a failure: the listing is never read as "none" unless the
        org said so.
    */
    static readListedEntries(retrieveKind: MetadataRetrieveListedKind, listedResult: unknown, objectApiNames: readonly string[]): MetadataListOutcome {

        const entries = Array.isArray(listedResult) ? listedResult
            : listedResult !== null && typeof listedResult === 'object' ? [listedResult]
            : undefined;

        if ( !entries ) {
            return { kind: 'failed', failureMessage: 'The org\'s answer was not a listing.' };
        }

        const metadataType = METADATA_RETRIEVE_TYPE_BY_KIND[retrieveKind];
        const lowerObjectApiNames = new Set(objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
        const membersByLowerName = new Map<string, string>();
        let skippedCount = 0;

        entries
            .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
            .filter(entry => entry.type === undefined || entry.type === metadataType)
            .forEach(entry => {

                if ( typeof entry.fullName === 'string' && !lowerObjectApiNames.has(entry.fullName.split('.')[0].toLowerCase()) ) {
                    return;
                }

                if ( !RecipeCockpitMetadataDeploy.isDeployableMember(metadataType, entry.fullName) ) {
                    skippedCount++;
                    return;
                }

                const member = entry.fullName;
                if ( !membersByLowerName.has(member.toLowerCase()) ) {
                    membersByLowerName.set(member.toLowerCase(), member);
                }

            });

        return {
            kind: 'listed',
            components: [...membersByLowerName.values()].sort().map(member => ({ type: metadataType, member: member })),
            skippedCount: skippedCount
        };

    }

    // WHAT THE ORG SAID: ITS ERROR CODE AND MESSAGE, ON ONE LINE, WITH ANYTHING SHAPED LIKE A TOKEN OR AN AUTH URL TAKEN OUT
    private static describeListError(listError: unknown): string {

        const errorRecord = listError !== null && typeof listError === 'object' ? listError as Record<string, unknown> : {};
        const errorCode = [errorRecord.errorCode, errorRecord.name].find((value): value is string => typeof value === 'string' && value.length > 0 && value !== 'Error');
        const message = typeof errorRecord.message === 'string' ? errorRecord.message : String(listError);
        const detail = errorCode && !message.startsWith(errorCode) ? `${errorCode}: ${message}` : message;

        return ScratchOrgService.redactSecretText(detail.replace(/\s+/g, ' ').trim()) || 'The org did not say why.';

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
                                            runNoun: string): Exclude<MetadataRetrieveOutcome, { kind: 'retrieved' }> | undefined {

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

    // WHAT THE IN-PANEL CONFIRMATION SAYS (#457): EACH VALUE ON ONE LINE, AND WHAT CANNOT BE UNDONE OR IS LEFT OUT AMONG THE WARNINGS, ON SCREEN
    static buildConfirmationContent(retrieveKind: MetadataRetrieveKind,
                                    treeLabel: string,
                                    org: IRecipeCockpitConfirmOrg,
                                    askedNames: readonly string[],
                                    packageDirectoryRelativePath: string,
                                    localFileCount: number): IRecipeCockpitConfirmContent {

        const words = RETRIEVE_WORDS[retrieveKind];
        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
        const overwriteLine = `${localFileCount} existing local ${words.fileNoun} ${localFileCount === 1 ? 'file' : 'files'} for these ${words.scope} will be overwritten with the org's version wherever the org holds the same ${words.sameNoun}.`;

        return {
            summary: [
                `Tree: ${toSingleLine(treeLabel)}`,
                ...( localFileCount === 0 ? [`This project holds no ${words.fileNoun} file for these ${words.scope} yet.`] : [] )
            ],
            org: org,
            warnings: localFileCount === 0 ? [] : [overwriteLine],
            sections: [
                { title: this.describeComponents(retrieveKind, askedNames.length), lines: [RecipeCockpitMetadataDeploy.describeCappedList(askedNames)] },
                {
                    title: 'What happens next',
                    lines: [
                        `New ${words.newFileNoun} files are written under: ${toSingleLine(packageDirectoryRelativePath)}`,
                        `Nothing is deployed. Run Generate Treecipe afterwards ${words.afterwards}.`
                    ]
                }
            ]
        };

    }

}
