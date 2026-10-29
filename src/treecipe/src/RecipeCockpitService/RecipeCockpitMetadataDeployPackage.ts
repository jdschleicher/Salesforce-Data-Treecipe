import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as xml2js from 'xml2js';
import ignore from 'ignore';

import { IMetadataDeployComponent, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import { RecipeCockpitPermissionSetAssign } from './RecipeCockpitPermissionSetAssign';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';

/*
    The Troubleshooting tab's deploys without the Salesforce CLI (#505), chosen by the
    salesforce-data-treecipe.metadataDeployMethod setting. The CLI converts source format to a
    Metadata API zip through @salesforce/source-deploy-retrieve; that library is not added (#504
    decides it), so this module converts the six types the generated package.xml can name and
    nothing else: a field, record type or validation rule goes INTO its object's .object file, a
    custom object's own XML goes there too, and a global value set or permission set file is sent as
    it is. Only the components the package.xml names are in the zip, so a deploy sends exactly what
    the confirmation listed.

    The CLI is still used whenever its answer could differ: sfdx-project.json "replacements" (which
    the CLI applies to what it sends) and a .forceignore that covers a file being deployed (which the
    CLI leaves out). It imports no vscode: the cockpit owns the progress, the cancel and the
    notification.
*/

export type MetadataDeployMethod = 'cli' | 'jsforce';

export const METADATA_DEPLOY_METHODS: readonly MetadataDeployMethod[] = Object.freeze(['cli', 'jsforce'] as MetadataDeployMethod[]);

export const METADATA_DEPLOY_METHOD_SETTING = 'metadataDeployMethod';

export const METADATA_DEPLOY_DEFAULT_METHOD: MetadataDeployMethod = 'cli';

export const METADATA_DEPLOY_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

export const METADATA_DEPLOY_POLL_INTERVAL_MILLISECONDS = 2000;

// HOW LONG A CANCEL IS WAITED ON BEFORE THE DEPLOY IS REPORTED AS UNKNOWN
export const METADATA_DEPLOY_CANCEL_WAIT_MILLISECONDS = 60 * 1000;

// HOW MANY STATUS CHECKS IN A ROW MAY FAIL BEFORE THE DEPLOY IS REPORTED AS UNKNOWN
export const METADATA_DEPLOY_STATUS_CHECK_ATTEMPTS = 3;

export const METADATA_DEPLOY_FORCE_IGNORE_FILE_NAME = '.forceignore';

// THE PATTERNS source-deploy-retrieve ALWAYS IGNORES, WHATEVER .forceignore SAYS
const DEFAULT_FORCE_IGNORE_PATTERNS = ['**/*.dup', '**/.*', '**/package2-descriptor.json', '**/package2-manifest.json'];

// A DEPLOY REQUEST IS NEVER ALLOWED TO IGNORE AN ERROR: A DEPLOY THAT CANNOT LAND WHOLE LANDS NOTHING
export const METADATA_DEPLOY_JSFORCE_OPTIONS = Object.freeze({
    rollbackOnError: true,
    singlePackage: true,
    ignoreWarnings: false,
    checkOnly: false
});

const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

type ObjectChildType = 'CustomField' | 'RecordType' | 'ValidationRule';

interface IObjectChildLayout {
    folderName: string;
    fileSuffix: string;
    elementName: string;
}

const OBJECT_CHILD_LAYOUTS: Readonly<Record<ObjectChildType, IObjectChildLayout>> = Object.freeze({
    CustomField: { folderName: 'fields', fileSuffix: '.field-meta.xml', elementName: 'fields' },
    RecordType: { folderName: 'recordTypes', fileSuffix: '.recordType-meta.xml', elementName: 'recordTypes' },
    ValidationRule: { folderName: 'validationRules', fileSuffix: '.validationRule-meta.xml', elementName: 'validationRules' }
});

const OBJECT_FILE_SUFFIX = '.object-meta.xml';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';
const PERMISSION_SET_FILE_SUFFIX = '.permissionset-meta.xml';

export interface IMetadataDeploySourceFile {
    component: IMetadataDeployComponent;
    filePath: string;
}

export interface IMetadataDeploySourceFiles {
    sourceFiles: IMetadataDeploySourceFile[];
    missingComponents: IMetadataDeployComponent[];
}

export type MetadataDeployMethodPlan =
    | { method: 'jsforce' }
    | { method: 'cli'; reason: 'setting' | 'replacements' | 'forceIgnore' | 'missingSource'; ignoredFilePaths?: string[] };

export interface IMetadataZipEntry {
    name: string;
    content: Buffer;
}

// THE CALLS A DEPLOY MAKES ON A jsforce CONNECTION'S metadata API
export interface IMetadataDeployConnection {
    metadata: {
        deploy(zipInput: Buffer, options: Record<string, unknown>): PromiseLike<unknown>;
        checkDeployStatus(asyncProcessId: string, includeDetails?: boolean): Promise<unknown>;
        cancelDeploy(asyncProcessId: string): Promise<unknown>;
    };
}

export interface IMetadataDeployRunControl {
    isCancellationRequested(): boolean;
    timeoutMilliseconds: number;
    pollIntervalMilliseconds?: number;
    cancelWaitMilliseconds?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}

export type MetadataDeployRun =
    // THE ORG FINISHED THE DEPLOY, A CANCEL THAT CAME TOO LATE INCLUDED: payload IS IN THE CLI's --json SHAPE
    | { kind: 'finished'; deployId: string; payload: Record<string, unknown> }
    // THE ORG ANSWERED THE CANCEL: NOTHING WAS DEPLOYED
    | { kind: 'cancelled'; deployId: string; payload: Record<string, unknown>; isTimedOut: boolean }
    | { kind: 'unconfirmed'; deployId?: string; failureMessage: string; isCancelled: boolean; payload?: Record<string, unknown> };

export class RecipeCockpitMetadataDeployPackage {

    static readDeployMethod(settingValue: unknown): MetadataDeployMethod {
        return METADATA_DEPLOY_METHODS.includes(settingValue as MetadataDeployMethod) ? settingValue as MetadataDeployMethod : METADATA_DEPLOY_DEFAULT_METHOD;
    }

    // ANY replacements ENTRY: THE CLI APPLIES EVERY KIND TO WHAT IT SENDS, SO ONLY THE CLI SENDS IT
    static hasReplacements(workspaceRoot: string): boolean {

        try {
            const replacements: unknown = SfdxProjectService.readSfdxProjectJson(SfdxProjectService.getSfdxProjectFilePath(workspaceRoot))?.replacements;
            return Array.isArray(replacements) && replacements.length > 0;
        } catch {
            return false;
        }

    }

    /*
        The files .forceignore at the workspace root covers, as source-deploy-retrieve reads it:
        gitignore patterns relative to that folder, plus its default patterns. A .forceignore that
        cannot be read is no reason to send a file the CLI would leave out, so every file counts as
        covered then.
    */
    static findForceIgnoredFilePaths(workspaceRoot: string, filePaths: readonly string[]): string[] {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const forceIgnoreFilePath = path.join(resolvedWorkspaceRoot, METADATA_DEPLOY_FORCE_IGNORE_FILE_NAME);

        let forceIgnoreText = '';
        try {
            if ( fs.existsSync(forceIgnoreFilePath) ) {
                forceIgnoreText = fs.readFileSync(forceIgnoreFilePath, 'utf-8');
            }
        } catch {
            return [...filePaths];
        }

        const matcher = ignore().add(DEFAULT_FORCE_IGNORE_PATTERNS).add(forceIgnoreText);

        return filePaths.filter(filePath => {
            const relativePath = path.relative(resolvedWorkspaceRoot, path.resolve(filePath)).split(path.sep).join('/');
            return relativePath === '' || relativePath.startsWith('../') || path.isAbsolute(relativePath) || matcher.ignores(relativePath);
        });

    }

    /*
        Each component's source file, found as the summary finds it: under the STRICT package
        directories, an object's folders in every package directory merged with the first file of a
        name winning, matched case-insensitively, never through a link, each inside the workspace.
    */
    static resolveSourceFiles(workspaceRoot: string, packageDirectoryPaths: readonly string[], components: readonly IMetadataDeployComponent[]): IMetadataDeploySourceFiles {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const objectApiNameByLowerName = new Map<string, string>();
        components
            .filter(component => component.type !== 'GlobalValueSet' && component.type !== 'PermissionSet')
            .map(component => component.member.split('.')[0])
            .forEach(objectApiName => {
                if ( !objectApiNameByLowerName.has(objectApiName.toLowerCase()) ) {
                    objectApiNameByLowerName.set(objectApiName.toLowerCase(), objectApiName);
                }
            });
        // KEYED BY LOWER-CASED NAME: SALESFORCE READS account AND Account AS ONE OBJECT
        const objectFolderPathsByLowerName = new Map([...( objectApiNameByLowerName.size > 0
            ? RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, packageDirectoryPaths, [...objectApiNameByLowerName.values()])
            : new Map<string, string[]>() )].map(([objectApiName, folderPaths]) => [objectApiName.toLowerCase(), folderPaths]));
        const objectFolderPathsOf = (objectApiName: string) => objectFolderPathsByLowerName.get(objectApiName.toLowerCase()) ?? [];
        const globalValueSetFolderPaths = components.some(component => component.type === 'GlobalValueSet')
            ? RecipeCockpitMetadataDeploy.findMetadataFolderPaths(resolvedWorkspaceRoot, packageDirectoryPaths, 'globalValueSets')
            : [];
        const permissionSetFilePaths = components.some(component => component.type === 'PermissionSet')
            ? RecipeCockpitPermissionSetAssign.findPermissionSetFilePaths(resolvedWorkspaceRoot, [...packageDirectoryPaths])
            : [];

        const findFileInFolders = (folderPaths: readonly string[], fileName: string): string | undefined => {
            const lowerFileName = fileName.toLowerCase();
            for ( const folderPath of folderPaths ) {
                const fileEntry = RecipeCockpitMetadataDeploy.listEntries(folderPath).find(entry => entry.isFile() && entry.name.toLowerCase() === lowerFileName);
                if ( fileEntry ) {
                    return path.join(folderPath, fileEntry.name);
                }
            }
            return undefined;
        };

        const findChildFile = (objectApiName: string, layout: IObjectChildLayout, childName: string): string | undefined => {
            const lowerFileName = `${childName}${layout.fileSuffix}`.toLowerCase();
            for ( const objectFolderPath of objectFolderPathsOf(objectApiName) ) {
                const fileEntry = RecipeCockpitMetadataDeploy.listSubfolderEntries(objectFolderPath, layout.folderName).find(entry => entry.isFile() && entry.name.toLowerCase() === lowerFileName);
                if ( fileEntry ) {
                    return path.join(objectFolderPath, layout.folderName, fileEntry.name);
                }
            }
            return undefined;
        };

        const sourceFiles: IMetadataDeploySourceFile[] = [];
        const missingComponents: IMetadataDeployComponent[] = [];

        components.forEach(component => {

            let filePath: string | undefined;

            if ( component.type === 'CustomObject' ) {
                filePath = RecipeCockpitMetadataDeploy.findObjectFilePath(objectFolderPathsOf(component.member), component.member);
            } else if ( component.type === 'GlobalValueSet' ) {
                filePath = findFileInFolders(globalValueSetFolderPaths, `${component.member}${GLOBAL_VALUE_SET_FILE_SUFFIX}`);
            } else if ( component.type === 'PermissionSet' ) {
                const lowerFileName = `${component.member}${PERMISSION_SET_FILE_SUFFIX}`.toLowerCase();
                filePath = permissionSetFilePaths.find(permissionSetFilePath => path.basename(permissionSetFilePath).toLowerCase() === lowerFileName);
            } else {
                const [objectApiName, childName] = component.member.split('.');
                filePath = findChildFile(objectApiName, OBJECT_CHILD_LAYOUTS[component.type], childName);
            }

            if ( filePath && SfdxProjectService.isPathContainedInWorkspace(filePath, resolvedWorkspaceRoot) ) {
                sourceFiles.push({ component: component, filePath: filePath });
            } else {
                missingComponents.push(component);
            }

        });

        return { sourceFiles: sourceFiles, missingComponents: missingComponents };

    }

    // WHICH WAY A DEPLOY GOES: THE SETTING'S, UNLESS ONLY THE CLI WOULD SEND WHAT IT SENDS TODAY
    static planDeployMethod(requestedMethod: MetadataDeployMethod,
                            workspaceRoot: string,
                            packageDirectoryPaths: readonly string[],
                            components: readonly IMetadataDeployComponent[]): MetadataDeployMethodPlan {

        if ( requestedMethod === 'cli' ) {
            return { method: 'cli', reason: 'setting' };
        }

        if ( this.hasReplacements(workspaceRoot) ) {
            return { method: 'cli', reason: 'replacements' };
        }

        const resolved = this.resolveSourceFiles(workspaceRoot, packageDirectoryPaths, components);
        if ( resolved.missingComponents.length > 0 ) {
            return { method: 'cli', reason: 'missingSource' };
        }

        const ignoredFilePaths = this.findForceIgnoredFilePaths(workspaceRoot, resolved.sourceFiles.map(sourceFile => sourceFile.filePath));
        if ( ignoredFilePaths.length > 0 ) {
            return { method: 'cli', reason: 'forceIgnore', ignoredFilePaths: ignoredFilePaths };
        }

        return { method: 'jsforce' };

    }

    // WHAT THE CONFIRMATION'S "How it deploys" SECTION SAYS
    static describeDeployMethod(plan: MetadataDeployMethodPlan): string[] {

        if ( plan.method === 'jsforce' ) {
            return [
                'Only these components are deployed, in a Metadata API zip built from a generated package.xml.',
                'It is sent on the connection checked above, not through the Salesforce CLI.',
                'Nothing else in the object folders is.'
            ];
        }

        const fallbackLine = plan.reason === 'replacements' ? 'Through the Salesforce CLI: sfdx-project.json has "replacements", which the CLI applies to what it sends.'
            : plan.reason === 'forceIgnore' ? 'Through the Salesforce CLI: .forceignore covers a file being deployed, which the CLI leaves out.'
            : plan.reason === 'missingSource' ? 'Through the Salesforce CLI: a component\'s source file was not found where the jsforce deploy looks for it.'
            : undefined;

        return [
            'Only these components are deployed, through a generated package.xml.',
            'Nothing else in the object folders is.',
            ...( fallbackLine ? [fallbackLine] : [] )
        ];

    }

    /*
        The Metadata API zip: package.xml as written beside the run's files, objects/<Object>.object
        holding the object's own XML when it is a component and every field, record type and
        validation rule the package.xml names for it, and each global value set and permission set
        file as it is. Every source file must read as its type's root element; anything else throws,
        and nothing is sent.
    */
    static async buildDeployZip(packageXml: string, sourceFiles: readonly IMetadataDeploySourceFile[]): Promise<Buffer> {

        const entries: IMetadataZipEntry[] = [{ name: 'package.xml', content: Buffer.from(packageXml, 'utf-8') }];
        const objectEntriesByLowerName = new Map<string, { objectApiName: string; objectContent?: Record<string, unknown>; children: Map<string, Record<string, unknown>[]> }>();

        const objectEntryOf = (objectApiName: string) => {
            const lowerName = objectApiName.toLowerCase();
            const objectEntry = objectEntriesByLowerName.get(lowerName) ?? { objectApiName: objectApiName, children: new Map<string, Record<string, unknown>[]>() };
            objectEntriesByLowerName.set(lowerName, objectEntry);
            return objectEntry;
        };

        for ( const sourceFile of sourceFiles ) {

            const { component } = sourceFile;
            const sourceText = fs.readFileSync(sourceFile.filePath, 'utf-8');

            if ( component.type === 'GlobalValueSet' || component.type === 'PermissionSet' ) {
                await this.readRootContent(sourceText, component.type, component.member);
                entries.push({
                    name: component.type === 'GlobalValueSet' ? `globalValueSets/${component.member}.globalValueSet` : `permissionsets/${component.member}.permissionset`,
                    content: Buffer.from(sourceText, 'utf-8')
                });
                continue;
            }

            if ( component.type === 'CustomObject' ) {
                objectEntryOf(component.member).objectContent = await this.readRootContent(sourceText, 'CustomObject', component.member);
                continue;
            }

            const [objectApiName, childName] = component.member.split('.');
            const childContent = await this.readRootContent(sourceText, component.type, component.member);
            const { fullName, ...childFields } = childContent;
            const elementName = OBJECT_CHILD_LAYOUTS[component.type].elementName;
            const children = objectEntryOf(objectApiName).children;
            children.set(elementName, [...( children.get(elementName) ?? [] ), { fullName: fullName ?? [childName], ...childFields }]);

        }

        [...objectEntriesByLowerName.values()].forEach(objectEntry => {
            entries.push({ name: `objects/${objectEntry.objectApiName}.object`, content: Buffer.from(this.buildObjectXml(objectEntry.objectContent, objectEntry.children), 'utf-8') });
        });

        return this.buildZip(entries);

    }

    // A FILE'S ROOT ELEMENT'S CONTENT, ITS xmlns LEFT OUT; AN EMPTY ROOT IS {}. ANY OTHER ROOT THROWS
    static async readRootContent(sourceText: string, rootElementName: string, member: string): Promise<Record<string, unknown>> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(sourceText);
        } catch {
            throw new Error(`The source file of ${rootElementName} ${member} could not be read as XML, so nothing was deployed.`);
        }

        const rootContent = ( parsedXml as Record<string, unknown> | null )?.[rootElementName];
        if ( typeof rootContent === 'string' ) {
            return {};
        }
        if ( rootContent === null || typeof rootContent !== 'object' || Array.isArray(rootContent) ) {
            throw new Error(`The source file of ${rootElementName} ${member} is not a <${rootElementName}>, so nothing was deployed.`);
        }

        const content: Record<string, unknown> = {};
        Object.entries(rootContent as Record<string, unknown>).forEach(([key, value]) => {
            if ( key !== '$' ) {
                content[key] = value;
            }
        });

        return content;

    }

    // THE OBJECT'S OWN ELEMENTS AND ITS CHILDREN, IN ELEMENT-NAME ORDER AS THE METADATA API'S SCHEMA LISTS THEM
    static buildObjectXml(objectContent: Record<string, unknown> | undefined, children: ReadonlyMap<string, Record<string, unknown>[]>): string {

        const merged: Record<string, unknown> = { ...( objectContent ?? {} ) };
        children.forEach((childContents, elementName) => {
            const existing = merged[elementName];
            merged[elementName] = [...( Array.isArray(existing) ? existing : existing === undefined ? [] : [existing] ), ...childContents];
        });

        const ordered: Record<string, unknown> = { $: { xmlns: METADATA_DEPLOY_NAMESPACE } };
        // sort() WITH NO COMPARATOR ORDERS BY UTF-16 CODE UNIT, AS "<" DOES -- NEVER localeCompare
        Object.keys(merged).sort().forEach(key => { ordered[key] = merged[key]; });

        return new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '    ', newline: '\n' }
        }).buildObject({ CustomObject: ordered }) + '\n';

    }

    /*
        A zip of the entries, each DEFLATEd, every timestamp 1980-01-01 so the same entries make the
        same bytes, names flagged UTF-8. No zip64: a Troubleshooting deploy is far below 4 GB and
        65,535 entries.
    */
    static buildZip(entries: readonly IMetadataZipEntry[]): Buffer {

        const localParts: Buffer[] = [];
        const centralParts: Buffer[] = [];
        let offset = 0;
        const dosTime = 0;
        const dosDate = ( 0 << 9 ) | ( 1 << 5 ) | 1;
        const utf8Flag = 0x0800;

        entries.forEach(entry => {

            const nameBytes = Buffer.from(entry.name, 'utf-8');
            const compressed = zlib.deflateRawSync(entry.content);
            const crc = this.computeCrc32(entry.content);

            const localHeader = Buffer.alloc(30);
            localHeader.writeUInt32LE(0x04034b50, 0);
            localHeader.writeUInt16LE(20, 4);
            localHeader.writeUInt16LE(utf8Flag, 6);
            localHeader.writeUInt16LE(8, 8);
            localHeader.writeUInt16LE(dosTime, 10);
            localHeader.writeUInt16LE(dosDate, 12);
            localHeader.writeUInt32LE(crc, 14);
            localHeader.writeUInt32LE(compressed.length, 18);
            localHeader.writeUInt32LE(entry.content.length, 22);
            localHeader.writeUInt16LE(nameBytes.length, 26);
            localHeader.writeUInt16LE(0, 28);

            const centralHeader = Buffer.alloc(46);
            centralHeader.writeUInt32LE(0x02014b50, 0);
            centralHeader.writeUInt16LE(20, 4);
            centralHeader.writeUInt16LE(20, 6);
            centralHeader.writeUInt16LE(utf8Flag, 8);
            centralHeader.writeUInt16LE(8, 10);
            centralHeader.writeUInt16LE(dosTime, 12);
            centralHeader.writeUInt16LE(dosDate, 14);
            centralHeader.writeUInt32LE(crc, 16);
            centralHeader.writeUInt32LE(compressed.length, 20);
            centralHeader.writeUInt32LE(entry.content.length, 24);
            centralHeader.writeUInt16LE(nameBytes.length, 28);
            centralHeader.writeUInt32LE(offset, 42);

            localParts.push(localHeader, nameBytes, compressed);
            centralParts.push(centralHeader, nameBytes);
            offset += localHeader.length + nameBytes.length + compressed.length;

        });

        const centralDirectory = Buffer.concat(centralParts);
        const endOfCentralDirectory = Buffer.alloc(22);
        endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
        endOfCentralDirectory.writeUInt16LE(entries.length, 8);
        endOfCentralDirectory.writeUInt16LE(entries.length, 10);
        endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
        endOfCentralDirectory.writeUInt32LE(offset, 16);

        return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);

    }

    private static crcTable: Uint32Array | undefined;

    static computeCrc32(content: Buffer): number {

        if ( !this.crcTable ) {
            this.crcTable = new Uint32Array(256);
            for ( let tableIndex = 0; tableIndex < 256; tableIndex++ ) {
                let value = tableIndex;
                for ( let bit = 0; bit < 8; bit++ ) {
                    value = value & 1 ? 0xedb88320 ^ ( value >>> 1 ) : value >>> 1;
                }
                this.crcTable[tableIndex] = value >>> 0;
            }
        }

        let crc = 0xffffffff;
        for ( const byte of content ) {
            crc = this.crcTable[( crc ^ byte ) & 0xff] ^ ( crc >>> 8 );
        }

        return ( crc ^ 0xffffffff ) >>> 0;

    }

    /*
        The org's DeployResult in the CLI's --json shape ({ status, result }), so what reads a CLI
        deploy (readDeployComponentCounts, the failure list, the result file) reads this one too.
        The SOAP answer is untrusted: a boolean can arrive as "true", a count as a string, and a list
        of one as the entry itself.
    */
    static toCliShapedPayload(deployResult: unknown): Record<string, unknown> {

        const result = deployResult !== null && typeof deployResult === 'object' && !Array.isArray(deployResult) ? deployResult as Record<string, unknown> : {};
        const isTrue = (value: unknown) => value === true || value === 'true';
        const toCount = (value: unknown) => {
            const count = typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : undefined;
            return count !== undefined && Number.isSafeInteger(count) ? count : undefined;
        };
        const numberComponentsDeployed = toCount(result.numberComponentsDeployed);
        const isSucceeded = isTrue(result.success) && isTrue(result.done);

        return {
            status: isSucceeded ? 0 : 1,
            result: {
                ...result,
                success: isSucceeded,
                done: isTrue(result.done),
                ...( numberComponentsDeployed !== undefined ? { numberComponentsDeployed: numberComponentsDeployed } : {} )
            },
            ...( !isSucceeded && typeof result.errorMessage === 'string' ? { message: ScratchOrgService.redactSecretText(result.errorMessage) } : {} )
        };

    }

    /*
        Sends the zip on the connection the sandbox check was asked on, then checks the deploy until
        the org says it is done. A cancel, or the timeout, asks the ORG to cancel it, and waits for
        the org's answer: a deploy the org cancelled deployed nothing, one that finished first is
        read like any other, and one the org has not answered about is unknown.
    */
    static async runDeploy(connection: IMetadataDeployConnection, zipInput: Buffer, control: IMetadataDeployRunControl): Promise<MetadataDeployRun> {

        const sleep = control.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
        const now = control.now ?? (() => Date.now());
        const pollInterval = control.pollIntervalMilliseconds ?? METADATA_DEPLOY_POLL_INTERVAL_MILLISECONDS;
        const cancelWait = control.cancelWaitMilliseconds ?? METADATA_DEPLOY_CANCEL_WAIT_MILLISECONDS;
        const deadline = now() + control.timeoutMilliseconds;

        if ( control.isCancellationRequested() ) {
            return { kind: 'unconfirmed', failureMessage: 'The deploy was cancelled before it was sent, so nothing was deployed.', isCancelled: true };
        }

        let deployId: string;
        try {
            const asyncResult = await connection.metadata.deploy(zipInput, { ...METADATA_DEPLOY_JSFORCE_OPTIONS });
            const id = asyncResult !== null && typeof asyncResult === 'object' ? ( asyncResult as Record<string, unknown> ).id : undefined;
            if ( typeof id !== 'string' || !SALESFORCE_ID_PATTERN.test(id) ) {
                return { kind: 'unconfirmed', failureMessage: 'The org did not answer the deploy request with a deploy Id, so whether it landed is unknown.', isCancelled: false };
            }
            deployId = id;
        } catch (deployError) {
            return { kind: 'unconfirmed', failureMessage: `The deploy request failed, so whether it landed is unknown: ${this.describeError(deployError)}`, isCancelled: false };
        }

        let cancelReason: 'cancelled' | 'timedOut' | undefined;
        let cancelDeadline = Number.POSITIVE_INFINITY;
        let failedChecks = 0;
        let lastPayload: Record<string, unknown> | undefined;

        while ( true ) {

            if ( !cancelReason && ( control.isCancellationRequested() || now() >= deadline ) ) {
                cancelReason = control.isCancellationRequested() ? 'cancelled' : 'timedOut';
                cancelDeadline = now() + cancelWait;
                try {
                    await connection.metadata.cancelDeploy(deployId);
                } catch {
                    // THE STATUS CHECK BELOW SAYS WHAT THE ORG DID
                }
            }

            let deployResult: unknown;
            try {
                deployResult = await connection.metadata.checkDeployStatus(deployId, true);
                failedChecks = 0;
            } catch (checkError) {
                failedChecks++;
                if ( failedChecks >= METADATA_DEPLOY_STATUS_CHECK_ATTEMPTS ) {
                    return { kind: 'unconfirmed', deployId: deployId, failureMessage: `The deploy's status could not be read, so whether it landed is unknown: ${this.describeError(checkError)}`, isCancelled: cancelReason === 'cancelled', payload: lastPayload };
                }
                await sleep(pollInterval);
                continue;
            }

            lastPayload = this.toCliShapedPayload(deployResult);
            const result = lastPayload.result as Record<string, unknown>;
            const status = deployResult !== null && typeof deployResult === 'object' ? ( deployResult as Record<string, unknown> ).status : undefined;

            if ( result.done === true ) {
                return status === 'Canceled'
                    ? { kind: 'cancelled', deployId: deployId, payload: lastPayload, isTimedOut: cancelReason === 'timedOut' }
                    : { kind: 'finished', deployId: deployId, payload: lastPayload };
            }

            if ( cancelReason && now() >= cancelDeadline ) {
                return {
                    kind: 'unconfirmed',
                    deployId: deployId,
                    failureMessage: cancelReason === 'timedOut'
                        ? 'The deploy did not finish in time; it was asked to cancel and has not answered, so whether it landed is unknown.'
                        : 'The deploy was asked to cancel and has not answered, so whether it landed is unknown.',
                    isCancelled: cancelReason === 'cancelled',
                    payload: lastPayload
                };
            }

            await sleep(pollInterval);

        }

    }

    // ONE LINE, NO CREDENTIAL: AN ERROR CAN QUOTE A SOAP FAULT, AND AN ACCESS TOKEN READS 00D<org Id>!<secret>
    static describeError(thrown: unknown): string {
        const message = ( thrown instanceof Error ? thrown.message : String(thrown) ).replace(/\b00D[A-Za-z0-9]{0,15}![A-Za-z0-9._\-]+/g, '[redacted]');
        return ScratchOrgService.redactSecretText(message.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim()) || 'no reason was given';
    }

}
