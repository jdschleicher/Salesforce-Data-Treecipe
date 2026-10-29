import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as xml2js from 'xml2js';

import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { IMetadataDeployComponent, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import { METADATA_DEPLOY_NAMESPACE, METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES, RecipeCockpitMetadataDeployPackage } from './RecipeCockpitMetadataDeployPackage';

/*
    The Recipe Cockpit's retrieves without the Salesforce CLI (#506), chosen by the
    salesforce-data-treecipe.metadataRetrieveMethod setting. The CLI converts the Metadata API's zip
    to source format through @salesforce/source-deploy-retrieve; that library is not added (#504
    decides it), so this module converts only what the cockpit's package.xml files name: a field,
    record type or validation rule is cut OUT of its object's .object file into its own file, a
    custom object's own XML (what is left of the .object) goes to <Object>.object-meta.xml, and a
    global value set file is written as it is.

    Only the members the package.xml names are written. A file the project already holds is written
    over where it is, in whichever package directory holds it; a new one goes under the default
    package directory's main/default, as the CLI writes it. The Adapter's retrieves write into their
    staging folder only. No link is followed on the way to a file, every file is written to a
    temporary file beside it and renamed over it, and a destination .forceignore covers is not
    written, as the CLI leaves it. It imports no vscode: the cockpit owns the progress, the cancel
    and the notification.
*/

export type MetadataRetrieveMethod = 'cli' | 'jsforce';

export const METADATA_RETRIEVE_METHODS: readonly MetadataRetrieveMethod[] = Object.freeze(['cli', 'jsforce'] as MetadataRetrieveMethod[]);

export const METADATA_RETRIEVE_METHOD_SETTING = 'metadataRetrieveMethod';

export const METADATA_RETRIEVE_DEFAULT_METHOD: MetadataRetrieveMethod = 'cli';

export const METADATA_RETRIEVE_POLL_INTERVAL_MILLISECONDS = 2000;

// HOW MANY STATUS CHECKS IN A ROW MAY FAIL BEFORE THE RETRIEVE IS REPORTED AS UNKNOWN
export const METADATA_RETRIEVE_STATUS_CHECK_ATTEMPTS = 3;

// HOW LONG ONE REQUEST (THE RETRIEVE, A STATUS CHECK) IS WAITED ON: jsforce SETS NO TIMEOUT OF ITS OWN
export const METADATA_RETRIEVE_REQUEST_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;

// HOW OFTEN A WAIT ON ONE REQUEST LOOKS AT THE CANCEL AND THE CLOCK
export const METADATA_RETRIEVE_REQUEST_WATCH_MILLISECONDS = 500;

// THE ZIP THE ORG ANSWERS IS READ WITHIN THESE: AN ENTRY PAST THE FILE CAP, OR A ZIP THAT EXPANDS PAST THE TOTAL, IS REFUSED UNREAD
export const METADATA_RETRIEVE_ZIP_MAX_ENTRIES = 20000;
export const METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES = METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES;
export const METADATA_RETRIEVE_ZIP_TOTAL_MAX_BYTES = 512 * 1024 * 1024;

// HOW MANY FILES ARE CONVERTED OR WRITTEN BEFORE THE EXTENSION HOST GETS ITS EVENT LOOP BACK
export const METADATA_RETRIEVE_YIELD_EVERY_FILES = 200;

const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

const ENTITY_NOT_FOUND_PATTERN = /^Entity of type '([A-Za-z]+)' named '([^']+)' cannot be found/;

// THE CHILDREN OF A CUSTOM OBJECT THE CLI WRITES AS FILES OF THEIR OWN; ANY OTHER ELEMENT STAYS IN <Object>.object-meta.xml
interface IObjectChildLayout {
    metadataType: string;
    folderName: string;
    fileSuffix: string;
}

const OBJECT_CHILD_LAYOUTS: Readonly<Record<string, IObjectChildLayout>> = Object.freeze({
    fields: { metadataType: 'CustomField', folderName: 'fields', fileSuffix: '.field-meta.xml' },
    recordTypes: { metadataType: 'RecordType', folderName: 'recordTypes', fileSuffix: '.recordType-meta.xml' },
    validationRules: { metadataType: 'ValidationRule', folderName: 'validationRules', fileSuffix: '.validationRule-meta.xml' },
    listViews: { metadataType: 'ListView', folderName: 'listViews', fileSuffix: '.listView-meta.xml' },
    compactLayouts: { metadataType: 'CompactLayout', folderName: 'compactLayouts', fileSuffix: '.compactLayout-meta.xml' },
    webLinks: { metadataType: 'WebLink', folderName: 'webLinks', fileSuffix: '.webLink-meta.xml' },
    businessProcesses: { metadataType: 'BusinessProcess', folderName: 'businessProcesses', fileSuffix: '.businessProcess-meta.xml' },
    fieldSets: { metadataType: 'FieldSet', folderName: 'fieldSets', fileSuffix: '.fieldSet-meta.xml' },
    sharingReasons: { metadataType: 'SharingReason', folderName: 'sharingReasons', fileSuffix: '.sharingReason-meta.xml' },
    indexes: { metadataType: 'Index', folderName: 'indexes', fileSuffix: '.index-meta.xml' }
});

const OBJECT_FILE_SUFFIX = '.object-meta.xml';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';
const SOURCE_DEFAULT_SUBFOLDERS = ['main', 'default'];

export interface IMetadataRetrieveZipEntry {
    name: string;
    content: Buffer;
}

// ONE SOURCE-FORMAT FILE THE ZIP HOLDS, RELATIVE TO A PACKAGE DIRECTORY'S main/default ("objects/Account/fields/X__c.field-meta.xml")
export interface IRetrievedSourceFile {
    type: string;
    fullName: string;
    relativeSegments: string[];
    content: string;
}

export type MetadataRetrieveDestination =
    // THE TROUBLESHOOTING TAB'S RETRIEVES: OVER A FILE THE PROJECT HOLDS, OR UNDER THE DEFAULT PACKAGE DIRECTORY'S main/default
    | { kind: 'project'; packageDirectoryPaths: readonly string[]; defaultPackageDirectoryPath: string }
    // THE ADAPTER'S RETRIEVES: UNDER THE STAGING FOLDER'S main/default AND NOWHERE ELSE
    | { kind: 'staging'; stagingFolderPath: string };

export interface IMetadataRetrieveFileResponse {
    fullName: string;
    type: string;
    state: 'Created' | 'Changed' | 'Failed';
    filePath?: string;
    problemType?: 'Error';
    error?: string;
}

// THE CALLS A RETRIEVE MAKES ON A jsforce CONNECTION'S metadata API
export interface IMetadataRetrieveConnection {
    metadata: {
        retrieve(request: Record<string, unknown>): PromiseLike<unknown>;
        checkRetrieveStatus(asyncProcessId: string): PromiseLike<unknown>;
    };
}

export interface IMetadataRetrieveRunControl {
    isCancellationRequested(): boolean;
    timeoutMilliseconds: number;
    pollIntervalMilliseconds?: number;
    requestTimeoutMilliseconds?: number;
    requestWatchMilliseconds?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}

export type MetadataRetrieveRun =
    // THE ORG FINISHED THE RETRIEVE: result IS ITS RetrieveResult, UNTRUSTED
    | { kind: 'finished'; retrieveId: string; result: Record<string, unknown> }
    // A CANCEL STOPPED THE WAIT: THE METADATA API HAS NO CANCEL FOR A RETRIEVE, SO THE ORG'S JOB RUNS OUT AND NOTHING IS WRITTEN
    | { kind: 'cancelled'; retrieveId?: string }
    | { kind: 'timedOut'; retrieveId?: string }
    | { kind: 'failed'; retrieveId?: string; failureMessage: string };

type WatchedRequest<T> = { isAnswered: true; answer: T } | { isAnswered: false };

export class RecipeCockpitMetadataRetrievePackage {

    static readRetrieveMethod(settingValue: unknown): MetadataRetrieveMethod {
        return METADATA_RETRIEVE_METHODS.includes(settingValue as MetadataRetrieveMethod) ? settingValue as MetadataRetrieveMethod : METADATA_RETRIEVE_DEFAULT_METHOD;
    }

    // THE Metadata API RetrieveRequest FOR EXACTLY THE package.xml's COMPONENTS: ONE TYPE ENTRY PER TYPE, MEMBERS SORTED WITH "<"
    static buildRetrieveRequest(components: readonly IMetadataDeployComponent[], apiVersion: string): Record<string, unknown> {

        if ( !/^\d{2,3}\.0$/.test(apiVersion) ) {
            throw new Error(`"${apiVersion}" is not an API version, so nothing was retrieved.`);
        }

        const membersByType = new Map<string, Set<string>>();
        components.forEach(component => {
            // THE ADAPTER RETRIEVES A STANDARD OBJECT TOO, WHICH A DEPLOY NEVER NAMES
            const isNameable = component.type === 'CustomObject'
                ? SalesforceApiName.isApiName(component.member)
                : RecipeCockpitMetadataDeploy.isDeployableMember(component.type, component.member);
            if ( !isNameable ) {
                throw new Error(`${component.type} ${component.member} is not a member one retrieve can name, so nothing was retrieved.`);
            }
            membersByType.set(component.type, ( membersByType.get(component.type) ?? new Set<string>() ).add(component.member));
        });

        if ( membersByType.size === 0 ) {
            throw new Error('A retrieve must name at least one component, so nothing was retrieved.');
        }

        return {
            apiVersion: Number(apiVersion),
            singlePackage: true,
            // jsforce WRITES SOAP ELEMENTS IN KEY ORDER, AND THE SCHEMA'S SEQUENCE IS types BEFORE version, members BEFORE name
            unpackaged: {
                // sort() WITH NO COMPARATOR ORDERS BY UTF-16 CODE UNIT, AS "<" DOES -- NEVER localeCompare
                types: [...membersByType.keys()].sort().map(type => ({ members: [...( membersByType.get(type) as Set<string> )].sort(), name: type })),
                version: apiVersion
            }
        };

    }

    /*
        Sends the retrieve on the connection, then checks it until the org says it is done. The
        Metadata API cannot cancel a retrieve, so a cancel or the timeout stops the WAIT: the org's job
        runs out on its own and its zip is never read, so nothing is written.
    */
    static async runRetrieve(connection: IMetadataRetrieveConnection, request: Record<string, unknown>, control: IMetadataRetrieveRunControl): Promise<MetadataRetrieveRun> {

        const sleep = control.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
        const now = control.now ?? (() => Date.now());
        const pollInterval = control.pollIntervalMilliseconds ?? METADATA_RETRIEVE_POLL_INTERVAL_MILLISECONDS;
        const deadline = now() + control.timeoutMilliseconds;
        const requestTimeout = control.requestTimeoutMilliseconds ?? METADATA_RETRIEVE_REQUEST_TIMEOUT_MILLISECONDS;
        const watchInterval = control.requestWatchMilliseconds ?? METADATA_RETRIEVE_REQUEST_WATCH_MILLISECONDS;

        // ONE REQUEST, GIVEN UP ON AT ITS OWN TIMEOUT, THE RETRIEVE'S DEADLINE, OR A CANCEL: A REQUEST THAT NEVER ANSWERS MUST NOT HOLD THE LOCK
        const watch = async <T>(pending: PromiseLike<T>): Promise<WatchedRequest<T>> => {
            let isSettled = false;
            const startedAt = now();
            const answered = Promise.resolve(pending).then(
                (answer): WatchedRequest<T> => { isSettled = true; return { isAnswered: true, answer: answer }; },
                (requestError: unknown) => { isSettled = true; throw requestError; }
            );
            const givenUp = (async (): Promise<WatchedRequest<T>> => {
                while ( !isSettled ) {
                    if ( control.isCancellationRequested() || now() >= Math.min(startedAt + requestTimeout, deadline) ) {
                        return { isAnswered: false };
                    }
                    await sleep(watchInterval);
                }
                return await new Promise<WatchedRequest<T>>(() => undefined);
            })();
            return await Promise.race([answered, givenUp]);
        };

        const stopped = (retrieveId?: string): MetadataRetrieveRun => control.isCancellationRequested()
            ? { kind: 'cancelled', retrieveId: retrieveId }
            : { kind: 'timedOut', retrieveId: retrieveId };

        if ( control.isCancellationRequested() ) {
            return { kind: 'cancelled' };
        }

        let retrieveId: string;
        try {
            const watched = await watch(connection.metadata.retrieve(request));
            if ( !watched.isAnswered ) {
                return control.isCancellationRequested() || now() >= deadline
                    ? stopped()
                    : { kind: 'failed', failureMessage: 'The org did not answer the retrieve request in time.' };
            }
            const id = watched.answer !== null && typeof watched.answer === 'object' ? ( watched.answer as Record<string, unknown> ).id : undefined;
            if ( typeof id !== 'string' || !SALESFORCE_ID_PATTERN.test(id) ) {
                return { kind: 'failed', failureMessage: 'The org did not answer the retrieve request with a retrieve Id.' };
            }
            retrieveId = id;
        } catch (retrieveError) {
            return { kind: 'failed', failureMessage: `The retrieve request failed: ${RecipeCockpitMetadataDeployPackage.describeError(retrieveError)}` };
        }

        let failedChecks = 0;

        while ( true ) {

            if ( control.isCancellationRequested() || now() >= deadline ) {
                return stopped(retrieveId);
            }

            let retrieveResult: unknown;
            try {
                const watched = await watch(connection.metadata.checkRetrieveStatus(retrieveId));
                if ( !watched.isAnswered ) {
                    if ( control.isCancellationRequested() || now() >= deadline ) {
                        return stopped(retrieveId);
                    }
                    throw new Error('the org did not answer in time');
                }
                retrieveResult = watched.answer;
                failedChecks = 0;
            } catch (checkError) {
                failedChecks++;
                if ( failedChecks >= METADATA_RETRIEVE_STATUS_CHECK_ATTEMPTS ) {
                    return { kind: 'failed', retrieveId: retrieveId, failureMessage: `The retrieve's status could not be read: ${RecipeCockpitMetadataDeployPackage.describeError(checkError)}` };
                }
                await sleep(pollInterval);
                continue;
            }

            const result = retrieveResult !== null && typeof retrieveResult === 'object' && !Array.isArray(retrieveResult) ? retrieveResult as Record<string, unknown> : {};
            if ( result.done === true || result.done === 'true' ) {
                return { kind: 'finished', retrieveId: retrieveId, result: result };
            }

            await sleep(pollInterval);

        }

    }

    /*
        The zip's entries, read from its central directory: stored or DEFLATEd only, no zip64, every
        name a plain relative path, every entry's size held to METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES and
        the whole to METADATA_RETRIEVE_ZIP_TOTAL_MAX_BYTES BEFORE it is inflated, and every CRC checked.
        Anything else throws: the zip is the org's answer, and untrusted.
    */
    static readZip(zipBuffer: Buffer): IMetadataRetrieveZipEntry[] {

        const fail = (reason: string): never => { throw new Error(`The org's retrieve zip could not be read: ${reason}. Nothing was written.`); };

        let endOffset = -1;
        for ( let offset = zipBuffer.length - 22; offset >= Math.max(0, zipBuffer.length - 22 - 0xffff); offset-- ) {
            if ( zipBuffer.readUInt32LE(offset) === 0x06054b50 ) {
                endOffset = offset;
                break;
            }
        }
        if ( endOffset < 0 ) {
            fail('no end of central directory');
        }

        const entryCount = zipBuffer.readUInt16LE(endOffset + 10);
        const centralDirectorySize = zipBuffer.readUInt32LE(endOffset + 12);
        const centralDirectoryOffset = zipBuffer.readUInt32LE(endOffset + 16);
        if ( entryCount === 0xffff || centralDirectoryOffset === 0xffffffff ) {
            fail('zip64 is not read');
        }
        if ( entryCount > METADATA_RETRIEVE_ZIP_MAX_ENTRIES ) {
            fail(`more than ${METADATA_RETRIEVE_ZIP_MAX_ENTRIES} entries`);
        }
        if ( centralDirectoryOffset + centralDirectorySize > endOffset ) {
            fail('a central directory out of bounds');
        }

        const entries: IMetadataRetrieveZipEntry[] = [];
        let totalBytes = 0;
        let offset = centralDirectoryOffset;

        for ( let entryIndex = 0; entryIndex < entryCount; entryIndex++ ) {

            if ( offset + 46 > endOffset || zipBuffer.readUInt32LE(offset) !== 0x02014b50 ) {
                fail('a central directory entry out of bounds');
            }

            const flags = zipBuffer.readUInt16LE(offset + 8);
            const method = zipBuffer.readUInt16LE(offset + 10);
            const crc = zipBuffer.readUInt32LE(offset + 16);
            const compressedSize = zipBuffer.readUInt32LE(offset + 20);
            const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
            const nameLength = zipBuffer.readUInt16LE(offset + 28);
            const extraLength = zipBuffer.readUInt16LE(offset + 30);
            const commentLength = zipBuffer.readUInt16LE(offset + 32);
            const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
            const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');
            offset += 46 + nameLength + extraLength + commentLength;

            if ( ( flags & 0x0001 ) !== 0 ) {
                fail('an encrypted entry');
            }
            if ( method !== 0 && method !== 8 ) {
                fail(`compression method ${method}`);
            }

            if ( name.endsWith('/') ) {
                continue;
            }
            if ( !this.isPlainZipEntryName(name) ) {
                fail('an entry name that is not a plain relative path');
            }
            if ( uncompressedSize > METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES ) {
                fail(`an entry larger than ${METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES / ( 1024 * 1024 )} MB`);
            }
            totalBytes += uncompressedSize;
            if ( totalBytes > METADATA_RETRIEVE_ZIP_TOTAL_MAX_BYTES ) {
                fail(`more than ${METADATA_RETRIEVE_ZIP_TOTAL_MAX_BYTES / ( 1024 * 1024 )} MB in all`);
            }

            if ( localHeaderOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50 ) {
                fail('a local header out of bounds');
            }
            const dataOffset = localHeaderOffset + 30 + zipBuffer.readUInt16LE(localHeaderOffset + 26) + zipBuffer.readUInt16LE(localHeaderOffset + 28);
            if ( dataOffset + compressedSize > zipBuffer.length ) {
                fail('entry data out of bounds');
            }
            const compressed = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);

            let content: Buffer;
            try {
                content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) });
            } catch {
                return fail('an entry that does not inflate to its size');
            }
            if ( content.length !== uncompressedSize || RecipeCockpitMetadataDeployPackage.computeCrc32(content) !== crc ) {
                fail('an entry whose size or CRC does not match');
            }

            entries.push({ name: name, content: content });

        }

        return entries;

    }

    // A NAME WITH NO DRIVE, NO LEADING "/", NO BACKSLASH, NO CONTROL CHARACTER AND NO "." OR ".." SEGMENT
    static isPlainZipEntryName(name: string): boolean {
        const segments = name.split('/');
        return name !== ''
            && !/[\\\u0000-\u001f]/.test(name)
            && !/^[A-Za-z]:/.test(name)
            && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
    }

    /*
        The source-format files of what was asked for. objects/<Object>.object is split: each child
        element of a decomposed kind becomes its own file under the object's folder (with the .object's
        namespaces on its root), and, when the object itself was asked for, what is left becomes
        <Object>.object-meta.xml. A child is written only when its type was asked for and, for a field,
        record type or validation rule, its "<Object>.<Name>" was; an object asked for brings every
        decomposed child, as the CLI writes it. globalValueSets/<Name>.globalValueSet is written as it is.
        A name that is not an api name never becomes a path.
    */
    static async convertToSourceFiles(entries: readonly IMetadataRetrieveZipEntry[],
                                        components: readonly IMetadataDeployComponent[],
                                        isCancellationRequested: () => boolean = () => false): Promise<IRetrievedSourceFile[] | undefined> {

        const askedMembers = new Set(components.map(component => `${component.type}\n${component.member.toLowerCase()}`));
        const isAsked = (type: string, member: string) => askedMembers.has(`${type}\n${member.toLowerCase()}`);
        const askedObjectTypes = new Set(components.filter(component => component.type === 'CustomObject').map(component => component.member.toLowerCase()));
        const sourceFiles: IRetrievedSourceFile[] = [];
        // A RETRIEVE ZIP HOLDS ONE .object PER OBJECT, SO THE HOST GETS ITS EVENT LOOP BACK PER FILE BUILT, NOT PER ENTRY
        let builtSinceYield = 0;
        const yieldEveryFiles = async () => {
            builtSinceYield++;
            if ( builtSinceYield >= METADATA_RETRIEVE_YIELD_EVERY_FILES ) {
                builtSinceYield = 0;
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        };

        for ( const entry of entries ) {

            await yieldEveryFiles();
            if ( isCancellationRequested() ) {
                return undefined;
            }

            // A RETRIEVE WITHOUT singlePackage PUTS EVERYTHING UNDER unpackaged/
            const segments = entry.name.split('/');
            const [folderName, fileName] = segments[0] === 'unpackaged' ? segments.slice(1) : segments;
            if ( segments.length > ( segments[0] === 'unpackaged' ? 3 : 2 ) || !folderName || !fileName ) {
                continue;
            }

            if ( folderName === 'globalValueSets' && fileName.endsWith('.globalValueSet') ) {
                const valueSetName = fileName.slice(0, -'.globalValueSet'.length);
                if ( SalesforceApiName.isApiName(valueSetName) && isAsked('GlobalValueSet', valueSetName) ) {
                    const content = entry.content.toString('utf-8');
                    await RecipeCockpitMetadataDeployPackage.readRootElement(content, 'GlobalValueSet', valueSetName);
                    sourceFiles.push({ type: 'GlobalValueSet', fullName: valueSetName, relativeSegments: ['globalValueSets', `${valueSetName}${GLOBAL_VALUE_SET_FILE_SUFFIX}`], content: content });
                }
                continue;
            }

            if ( folderName !== 'objects' || !fileName.endsWith('.object') ) {
                continue;
            }

            const objectApiName = fileName.slice(0, -'.object'.length);
            if ( !SalesforceApiName.isApiName(objectApiName) ) {
                continue;
            }

            const isObjectAsked = askedObjectTypes.has(objectApiName.toLowerCase());
            const objectRoot = await this.readObjectRoot(entry.content.toString('utf-8'), objectApiName);
            const remaining: Record<string, unknown> = {};

            for ( const [elementName, value] of Object.entries(objectRoot.content) ) {

                const layout = Object.prototype.hasOwnProperty.call(OBJECT_CHILD_LAYOUTS, elementName) ? OBJECT_CHILD_LAYOUTS[elementName] : undefined;
                if ( !layout ) {
                    remaining[elementName] = value;
                    continue;
                }

                for ( const childContent of Array.isArray(value) ? value : [value] ) {
                    const childName = this.readChildFullName(childContent);
                    const member = `${objectApiName}.${childName}`;
                    if ( !childName || !SalesforceApiName.isApiName(childName) || !( isObjectAsked || isAsked(layout.metadataType, member) ) ) {
                        continue;
                    }
                    sourceFiles.push({
                        type: layout.metadataType,
                        fullName: member,
                        relativeSegments: ['objects', objectApiName, layout.folderName, `${childName}${layout.fileSuffix}`],
                        content: this.buildSourceXml(layout.metadataType, childContent as Record<string, unknown>, objectRoot.rootAttributes)
                    });
                    await yieldEveryFiles();
                    if ( isCancellationRequested() ) {
                        return undefined;
                    }
                }

            }

            if ( isObjectAsked ) {
                sourceFiles.push({
                    type: 'CustomObject',
                    fullName: objectApiName,
                    relativeSegments: ['objects', objectApiName, `${objectApiName}${OBJECT_FILE_SUFFIX}`],
                    content: this.buildSourceXml('CustomObject', remaining, objectRoot.rootAttributes)
                });
            }

        }

        return sourceFiles;

    }

    // A .object's ROOT CONTENT AND ITS ROOT'S xmlns ATTRIBUTES; AN EMPTY <CustomObject/> IS {}. ANY OTHER ROOT THROWS
    private static async readObjectRoot(objectXml: string, objectApiName: string): Promise<{ content: Record<string, unknown>; rootAttributes: Record<string, string> }> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(objectXml);
        } catch {
            throw new Error(`The org's ${objectApiName}.object could not be read as XML, so nothing was written.`);
        }

        const rootContent = ( parsedXml as Record<string, unknown> | null )?.CustomObject;
        if ( typeof rootContent === 'string' ) {
            return { content: {}, rootAttributes: { xmlns: METADATA_DEPLOY_NAMESPACE } };
        }
        if ( rootContent === null || typeof rootContent !== 'object' || Array.isArray(rootContent) ) {
            throw new Error(`The org's ${objectApiName}.object is not a <CustomObject>, so nothing was written.`);
        }

        const rootAttributes: Record<string, string> = { xmlns: METADATA_DEPLOY_NAMESPACE };
        const content: Record<string, unknown> = {};
        Object.entries(rootContent as Record<string, unknown>).forEach(([key, value]) => {
            if ( key !== '$' ) {
                content[key] = value;
            } else if ( value !== null && typeof value === 'object' ) {
                Object.entries(value as Record<string, unknown>).forEach(([attributeName, attributeValue]) => {
                    if ( /^xmlns:[A-Za-z_][A-Za-z0-9_.-]*$/.test(attributeName) && typeof attributeValue === 'string' ) {
                        rootAttributes[attributeName] = attributeValue;
                    }
                });
            }
        });

        return { content: content, rootAttributes: rootAttributes };

    }

    private static readChildFullName(childContent: unknown): string | undefined {
        const fullNames = childContent !== null && typeof childContent === 'object' && !Array.isArray(childContent) ? ( childContent as Record<string, unknown> ).fullName : undefined;
        const fullName = Array.isArray(fullNames) ? fullNames[0] : undefined;
        return typeof fullName === 'string' ? fullName.trim() : undefined;
    }

    private static sourceXmlBuilder: xml2js.Builder | undefined;

    static buildSourceXml(rootElementName: string, content: Record<string, unknown>, rootAttributes: Record<string, string>): string {

        this.sourceXmlBuilder ??= new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '    ', newline: '\n' }
        });

        return this.sourceXmlBuilder.buildObject({ [rootElementName]: { $: rootAttributes, ...content } }) + '\n';

    }

    /*
        Writes each file where the CLI writes it, and answers what it did per file in the CLI's
        files[] shape. A destination .forceignore covers is left unwritten and unlisted, as the CLI
        leaves it. A destination reached through a link, outside the workspace, or that cannot be
        written is a Failed file; the rest are still written.
    */
    static async writeSourceFiles(workspaceRoot: string,
                                    destination: MetadataRetrieveDestination,
                                    sourceFiles: readonly IRetrievedSourceFile[]): Promise<IMetadataRetrieveFileResponse[]> {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const existingFiles = destination.kind === 'project' ? this.indexExistingFiles(resolvedWorkspaceRoot, destination.packageDirectoryPaths, sourceFiles) : new Map<string, string>();
        const newFileRoot = destination.kind === 'project'
            ? path.join(path.resolve(resolvedWorkspaceRoot, destination.defaultPackageDirectoryPath), ...SOURCE_DEFAULT_SUBFOLDERS)
            : path.join(destination.stagingFolderPath, ...SOURCE_DEFAULT_SUBFOLDERS);

        const targets = sourceFiles.map(sourceFile => ({
            sourceFile: sourceFile,
            filePath: existingFiles.get(this.buildFileKey(sourceFile)) ?? path.join(newFileRoot, ...sourceFile.relativeSegments)
        }));
        const ignoredFilePaths = new Set(destination.kind === 'project'
            ? RecipeCockpitMetadataDeployPackage.findForceIgnoredFilePaths(resolvedWorkspaceRoot, targets.map(target => target.filePath))
            : []);

        const fileResponses: IMetadataRetrieveFileResponse[] = [];

        for ( const [targetIndex, target] of targets.entries() ) {

            if ( targetIndex > 0 && targetIndex % METADATA_RETRIEVE_YIELD_EVERY_FILES === 0 ) {
                await new Promise<void>(resolve => setImmediate(resolve));
            }

            if ( ignoredFilePaths.has(target.filePath) ) {
                continue;
            }

            const { type, fullName } = target.sourceFile;
            try {
                const isCreated = this.writeFileWithoutFollowingLinks(resolvedWorkspaceRoot, target.filePath, target.sourceFile.content);
                fileResponses.push({ fullName: fullName, type: type, state: isCreated ? 'Created' : 'Changed', filePath: target.filePath });
            } catch (writeError) {
                fileResponses.push({ fullName: fullName, type: type, state: 'Failed', problemType: 'Error', error: `it was not written: ${writeError instanceof Error ? writeError.message : String(writeError)}` });
            }

        }

        return fileResponses;

    }

    private static buildFileKey(sourceFile: IRetrievedSourceFile): string {
        return sourceFile.relativeSegments.join('/').toLowerCase();
    }

    /*
        The project's own file for each retrieved one, found as a deploy finds it: under the strict
        package directories, an object's folders in every package directory with the first file of a
        name winning, matched case-insensitively, never through a link, each inside the workspace.
    */
    private static indexExistingFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], sourceFiles: readonly IRetrievedSourceFile[]): Map<string, string> {

        const existingFiles = new Map<string, string>();
        // ONLY A FILE THE RETRIEVE WRITES IS CHECKED FOR CONTAINMENT: AN OBJECT'S fields FOLDER CAN HOLD THOUSANDS IT DOES NOT TOUCH
        const wantedKeys = new Set(sourceFiles.map(sourceFile => this.buildFileKey(sourceFile)));
        const addFile = (key: string, filePath: string) => {
            if ( wantedKeys.has(key) && !existingFiles.has(key) && SfdxProjectService.isPathContainedInWorkspace(filePath, workspaceRoot) ) {
                existingFiles.set(key, filePath);
            }
        };

        const objectApiNames = [...new Set(sourceFiles.filter(sourceFile => sourceFile.relativeSegments[0] === 'objects').map(sourceFile => sourceFile.relativeSegments[1]))];
        if ( objectApiNames.length > 0 ) {
            const folderNames = [...new Set(sourceFiles.filter(sourceFile => sourceFile.relativeSegments.length === 4).map(sourceFile => sourceFile.relativeSegments[2]))];
            RecipeCockpitMetadataDeploy.findObjectFolderPaths(workspaceRoot, packageDirectoryPaths, objectApiNames).forEach((objectFolderPaths, objectApiName) => {
                objectFolderPaths.forEach(objectFolderPath => {
                    RecipeCockpitMetadataDeploy.listEntries(objectFolderPath)
                        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(OBJECT_FILE_SUFFIX.toLowerCase()))
                        .forEach(entry => addFile(['objects', objectApiName, entry.name].join('/').toLowerCase(), path.join(objectFolderPath, entry.name)));
                    folderNames.forEach(folderName => {
                        RecipeCockpitMetadataDeploy.listSubfolderEntries(objectFolderPath, folderName)
                            .filter(entry => entry.isFile())
                            .forEach(entry => addFile(['objects', objectApiName, folderName, entry.name].join('/').toLowerCase(), path.join(objectFolderPath, folderName, entry.name)));
                    });
                });
            });
        }

        if ( sourceFiles.some(sourceFile => sourceFile.relativeSegments[0] === 'globalValueSets') ) {
            RecipeCockpitMetadataDeploy.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'globalValueSets').forEach(folderPath => {
                RecipeCockpitMetadataDeploy.listEntries(folderPath)
                    .filter(entry => entry.isFile())
                    .forEach(entry => addFile(['globalValueSets', entry.name].join('/').toLowerCase(), path.join(folderPath, entry.name)));
            });
        }

        return existingFiles;

    }

    /*
        One file, never through a link: every folder from the workspace root down is a real folder
        (one that is missing is made, one segment at a time), the file itself is a real file or
        absent, and the content goes to a temporary file beside it that is renamed over it, which
        replaces a link planted since rather than writing through it. Answers whether it was created.
    */
    static writeFileWithoutFollowingLinks(workspaceRoot: string, filePath: string, content: string): boolean {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resolvedFilePath = path.resolve(filePath);
        const relativeFolderPath = path.relative(resolvedWorkspaceRoot, path.dirname(resolvedFilePath));

        if ( relativeFolderPath === '..' || relativeFolderPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFolderPath) ) {
            throw new Error('it is outside the workspace');
        }

        let folderPath = resolvedWorkspaceRoot;
        for ( const segment of relativeFolderPath === '' ? [] : relativeFolderPath.split(path.sep) ) {
            folderPath = path.join(folderPath, segment);
            let folderStats: fs.Stats | undefined;
            try {
                folderStats = fs.lstatSync(folderPath);
            } catch {
                folderStats = undefined;
            }
            if ( !folderStats ) {
                fs.mkdirSync(folderPath);
            } else if ( !folderStats.isDirectory() ) {
                throw new Error(`${path.relative(resolvedWorkspaceRoot, folderPath).split(path.sep).join('/')} is a link or not a folder`);
            }
        }

        let isCreated = true;
        try {
            const fileStats = fs.lstatSync(resolvedFilePath);
            if ( !fileStats.isFile() ) {
                throw new Error('it is a link or not a file');
            }
            isCreated = false;
        } catch (statError) {
            if ( ( statError as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
                throw statError;
            }
        }

        if ( !SfdxProjectService.isPathContainedInWorkspace(path.dirname(resolvedFilePath), resolvedWorkspaceRoot) ) {
            throw new Error('it is outside the workspace');
        }

        const temporaryFilePath = path.join(path.dirname(resolvedFilePath), `.${path.basename(resolvedFilePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
        try {
            fs.writeFileSync(temporaryFilePath, content, { encoding: 'utf-8', flag: 'wx' });
            fs.renameSync(temporaryFilePath, resolvedFilePath);
        } catch (writeError) {
            try {
                fs.rmSync(temporaryFilePath, { force: true });
            } catch {
                // NOTHING TO PUT BACK
            }
            throw writeError;
        }

        return isCreated;

    }

    /*
        What the org answered and what was written, in the CLI's --json shape ({ status, result }), so
        what reads a CLI retrieve (parseRetrieveOutput, readRetrieveSucceeded, the result file) reads
        this one too. A message the org sent about a component ("Entity of type … cannot be found", a
        file it could not bring) is a Failed file named by the type and name it carries, else by the
        retrieve's only type.
    */
    static toCliShapedPayload(retrieveId: string,
                                retrieveResult: Record<string, unknown>,
                                fileResponses: readonly IMetadataRetrieveFileResponse[],
                                components: readonly IMetadataDeployComponent[]): Record<string, unknown> {

        const isTrue = (value: unknown) => value === true || value === 'true';
        const isSucceeded = isTrue(retrieveResult.success) && isTrue(retrieveResult.done);
        const askedTypes = [...new Set(components.map(component => component.type))];
        const rawMessages = Array.isArray(retrieveResult.messages) ? retrieveResult.messages : retrieveResult.messages !== undefined && retrieveResult.messages !== null ? [retrieveResult.messages] : [];

        const messageResponses: IMetadataRetrieveFileResponse[] = rawMessages
            .filter((message): message is Record<string, unknown> => message !== null && typeof message === 'object' && !Array.isArray(message))
            .filter(message => typeof message.problem === 'string')
            .map(message => {
                const problem = this.toSingleLine(message.problem as string);
                const notFound = ENTITY_NOT_FOUND_PATTERN.exec(problem);
                const fileName = typeof message.fileName === 'string' ? this.toSingleLine(message.fileName) : '';
                return {
                    fullName: notFound ? notFound[2] : fileName || 'unknown',
                    type: notFound ? notFound[1] : askedTypes.length === 1 ? askedTypes[0] : 'unknown',
                    state: 'Failed' as const,
                    problemType: 'Error' as const,
                    error: problem
                };
            });

        const errorMessage = typeof retrieveResult.errorMessage === 'string' ? this.toSingleLine(retrieveResult.errorMessage) : '';

        return {
            status: isSucceeded ? 0 : 1,
            result: {
                done: isTrue(retrieveResult.done),
                success: isSucceeded,
                status: typeof retrieveResult.status === 'string' ? retrieveResult.status : isSucceeded ? 'Succeeded' : 'Failed',
                id: retrieveId,
                files: [...fileResponses, ...messageResponses]
            },
            retrieveId: retrieveId,
            retrievedWith: 'jsforce',
            ...( !isSucceeded ? { message: errorMessage || `The retrieve ended with status ${typeof retrieveResult.status === 'string' ? retrieveResult.status : 'unknown'}.` } : {} )
        };

    }

    // THE RetrieveResult's ZIP, DECODED; undefined WHEN IT CARRIES NONE THAT DECODES
    static readZipFile(retrieveResult: Record<string, unknown>): Buffer | undefined {

        const zipFile = retrieveResult.zipFile;
        if ( typeof zipFile !== 'string' || zipFile === '' || !/^[A-Za-z0-9+/\r\n]+={0,2}[\r\n]*$/.test(zipFile) ) {
            return undefined;
        }

        return Buffer.from(zipFile, 'base64');

    }

    private static toSingleLine(text: string): string {
        return text.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim();
    }

}
