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
    it is. A child (field, record type, validation rule) is in the zip only when the package.xml
    names it; a custom object's own .object-meta.xml goes whole, as the CLI sends it.

    The CLI is still used whenever its answer could differ: sfdx-project.json "replacements" (which
    the CLI applies to what it sends) and a .forceignore that covers a file being deployed (which the
    CLI leaves out). It imports no vscode: the cockpit owns the progress, the cancel and the
    notification.

    A fields deploy also carries the FlexiPages (sent as they are) and compact layouts (into their
    object's .object) its objects open (#547), and the object's copy in the zip has every other
    such reference set back by RecipeCockpitMetadataDeploy.resolveObjectReferences. That edited copy
    is why a deploy needing a reset goes as this zip even with the CLI: `--metadata-dir` sends it
    (method 'cliMetadataDir'), since `--manifest` can only send the project's own files.
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

// HOW LONG ONE REQUEST (THE DEPLOY, A STATUS CHECK, A CANCEL) IS WAITED ON: jsforce SETS NO TIMEOUT OF ITS OWN
export const METADATA_DEPLOY_REQUEST_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;

// HOW OFTEN A WAIT ON ONE REQUEST LOOKS AT THE CANCEL AND THE CLOCK
export const METADATA_DEPLOY_REQUEST_WATCH_MILLISECONDS = 500;

// THE LARGEST SOURCE FILE THE ZIP TAKES: A FILE PAST IT IS REFUSED, NEVER READ INTO THE EXTENSION HOST
export const METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES = 64 * 1024 * 1024;

// HOW MANY SOURCE FILES ARE READ INTO THE ZIP BEFORE THE EXTENSION HOST GETS ITS EVENT LOOP BACK
export const METADATA_DEPLOY_ZIP_YIELD_EVERY_FILES = 200;

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

type ObjectChildType = 'CompactLayout' | 'CustomField' | 'RecordType' | 'ValidationRule';

interface IObjectChildLayout {
    folderName: string;
    fileSuffix: string;
    elementName: string;
}

const OBJECT_CHILD_LAYOUTS: Readonly<Record<ObjectChildType, IObjectChildLayout>> = Object.freeze({
    CompactLayout: { folderName: 'compactLayouts', fileSuffix: '.compactLayout-meta.xml', elementName: 'compactLayouts' },
    CustomField: { folderName: 'fields', fileSuffix: '.field-meta.xml', elementName: 'fields' },
    RecordType: { folderName: 'recordTypes', fileSuffix: '.recordType-meta.xml', elementName: 'recordTypes' },
    ValidationRule: { folderName: 'validationRules', fileSuffix: '.validationRule-meta.xml', elementName: 'validationRules' }
});

const OBJECT_FILE_SUFFIX = '.object-meta.xml';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';
const PERMISSION_SET_FILE_SUFFIX = '.permissionset-meta.xml';

// A TYPE WHOSE FILE IS SENT AS IT IS, UNDER ITS OWN FOLDER OF THE ZIP; EVERY OTHER TYPE IS A CustomObject OR GOES INTO ONE
const WHOLE_FILE_TYPES: Readonly<Partial<Record<IMetadataDeployComponent['type'], { zipFolderName: string; zipSuffix: string }>>> = Object.freeze({
    FlexiPage: { zipFolderName: 'flexipages', zipSuffix: '.flexipage' },
    GlobalValueSet: { zipFolderName: 'globalValueSets', zipSuffix: '.globalValueSet' },
    PermissionSet: { zipFolderName: 'permissionsets', zipSuffix: '.permissionset' }
});

export interface IMetadataDeploySourceFile {
    component: IMetadataDeployComponent;
    filePath: string;
}

export interface IMetadataDeploySourceFiles {
    sourceFiles: IMetadataDeploySourceFile[];
    missingComponents: IMetadataDeployComponent[];
}

export type MetadataDeployMethodPlan =
    | { method: 'jsforce'; sourceFiles: IMetadataDeploySourceFile[] }
    // THE CLI SENDS THE SAME ZIP WITH --metadata-dir, BECAUSE AN OBJECT'S COPY IN IT IS EDITED (#547)
    | { method: 'cliMetadataDir'; sourceFiles: IMetadataDeploySourceFile[] }
    | { method: 'cli'; reason: 'setting' | 'replacements' | 'forceIgnore' | 'missingSource'; ignoredFilePaths?: string[] };

export interface IMetadataZipEntry {
    name: string;
    content: Buffer;
}

export type MetadataDeployRequestOptions = typeof METADATA_DEPLOY_JSFORCE_OPTIONS;

// THE CALLS A DEPLOY MAKES ON A jsforce CONNECTION'S metadata API
export interface IMetadataDeployConnection {
    metadata: {
        deploy(zipInput: Buffer, options: MetadataDeployRequestOptions): PromiseLike<unknown>;
        checkDeployStatus(asyncProcessId: string, includeDetails: boolean): PromiseLike<unknown>;
        cancelDeploy(asyncProcessId: string): PromiseLike<unknown>;
    };
}

export interface IMetadataDeployRunControl {
    isCancellationRequested(): boolean;
    timeoutMilliseconds: number;
    pollIntervalMilliseconds?: number;
    cancelWaitMilliseconds?: number;
    requestTimeoutMilliseconds?: number;
    requestWatchMilliseconds?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}

export type MetadataDeployRun =
    // THE ORG FINISHED THE DEPLOY, A CANCEL THAT CAME TOO LATE INCLUDED: payload IS IN THE CLI's --json SHAPE
    | { kind: 'finished'; deployId: string; payload: Record<string, unknown> }
    // THE ORG ANSWERED THE CANCEL: NOTHING WAS DEPLOYED
    | { kind: 'cancelled'; deployId: string; payload: Record<string, unknown>; isTimedOut: boolean }
    // isSent: THE DEPLOY REQUEST WAS SENT, SO THE ORG MAY HAVE IT; false ONLY FOR A CANCEL BEFORE ANYTHING WAS SENT
    | { kind: 'unconfirmed'; deployId?: string; failureMessage: string; isCancelled: boolean; isSent: boolean; payload?: Record<string, unknown> };

type WatchedRequest<T> = { isAnswered: true; answer: T } | { isAnswered: false };

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
            .filter(component => !WHOLE_FILE_TYPES[component.type])
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
        const flexiPageFilePathsByLowerName = components.some(component => component.type === 'FlexiPage')
            ? RecipeCockpitMetadataDeploy.findFlexiPageFilePaths(resolvedWorkspaceRoot, packageDirectoryPaths)
            : new Map<string, string>();
        const permissionSetFilePaths = components.some(component => component.type === 'PermissionSet')
            ? RecipeCockpitPermissionSetAssign.findPermissionSetFilePaths(resolvedWorkspaceRoot, [...packageDirectoryPaths])
            : [];

        // EACH FOLDER IS LISTED ONCE, INTO LOWER-CASED FILE NAME -> PATH; THE FIRST FOLDER HOLDING A NAME WINS
        const fileIndexOf = (folderPaths: readonly string[], listFolder: (folderPath: string) => fs.Dirent[], toFilePath: (folderPath: string, fileName: string) => string) => {
            const filePathsByLowerName = new Map<string, string>();
            folderPaths.forEach(folderPath => listFolder(folderPath)
                .filter(entry => entry.isFile() && !filePathsByLowerName.has(entry.name.toLowerCase()))
                .forEach(entry => filePathsByLowerName.set(entry.name.toLowerCase(), toFilePath(folderPath, entry.name))));
            return filePathsByLowerName;
        };
        const globalValueSetFileIndex = fileIndexOf(globalValueSetFolderPaths, folderPath => RecipeCockpitMetadataDeploy.listEntries(folderPath), path.join);
        const permissionSetFileIndex = new Map<string, string>();
        permissionSetFilePaths.forEach(permissionSetFilePath => {
            if ( !permissionSetFileIndex.has(path.basename(permissionSetFilePath).toLowerCase()) ) {
                permissionSetFileIndex.set(path.basename(permissionSetFilePath).toLowerCase(), permissionSetFilePath);
            }
        });
        const childFileIndexes = new Map<string, Map<string, string>>();
        const findChildFile = (objectApiName: string, layout: IObjectChildLayout, childName: string): string | undefined => {
            const indexKey = `${objectApiName.toLowerCase()}\n${layout.folderName}`;
            const childFileIndex = childFileIndexes.get(indexKey) ?? fileIndexOf(
                objectFolderPathsOf(objectApiName),
                objectFolderPath => RecipeCockpitMetadataDeploy.listSubfolderEntries(objectFolderPath, layout.folderName),
                (objectFolderPath, fileName) => path.join(objectFolderPath, layout.folderName, fileName)
            );
            childFileIndexes.set(indexKey, childFileIndex);
            return childFileIndex.get(`${childName}${layout.fileSuffix}`.toLowerCase());
        };

        const sourceFiles: IMetadataDeploySourceFile[] = [];
        const missingComponents: IMetadataDeployComponent[] = [];

        components.forEach(component => {

            let filePath: string | undefined;

            if ( component.type === 'CustomObject' ) {
                filePath = RecipeCockpitMetadataDeploy.findObjectFilePath(objectFolderPathsOf(component.member), component.member);
            } else if ( component.type === 'GlobalValueSet' ) {
                filePath = globalValueSetFileIndex.get(`${component.member}${GLOBAL_VALUE_SET_FILE_SUFFIX}`.toLowerCase());
            } else if ( component.type === 'PermissionSet' ) {
                filePath = permissionSetFileIndex.get(`${component.member}${PERMISSION_SET_FILE_SUFFIX}`.toLowerCase());
            } else if ( component.type === 'FlexiPage' ) {
                filePath = flexiPageFilePathsByLowerName.get(component.member.toLowerCase());
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

    /*
        Which way a deploy goes: the setting's, unless only the CLI would send what it sends today.
        hasObjectEdits (#547): an object's copy must be edited, which only this module's zip can
        carry, so the CLI setting sends that zip ('cliMetadataDir') whenever jsforce could; when it
        could not, the plan is 'cli' and the edits are not made.
    */
    static planDeployMethod(requestedMethod: MetadataDeployMethod,
                            workspaceRoot: string,
                            packageDirectoryPaths: readonly string[],
                            components: readonly IMetadataDeployComponent[],
                            hasObjectEdits = false): MetadataDeployMethodPlan {

        if ( requestedMethod === 'cli' && !hasObjectEdits ) {
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

        return { method: requestedMethod === 'cli' ? 'cliMetadataDir' : 'jsforce', sourceFiles: resolved.sourceFiles };

    }

    // WHY A DEPLOY CANNOT SEND AN EDITED OBJECT COPY (#547); undefined WHEN IT CAN
    static describeEditsNotApplied(plan: MetadataDeployMethodPlan): string | undefined {

        if ( plan.method !== 'cli' ) {
            return undefined;
        }

        return plan.reason === 'replacements' ? 'sfdx-project.json has "replacements", which only the CLI applies to the project\'s own files'
            : plan.reason === 'forceIgnore' ? '.forceignore covers a file being deployed, which only the CLI leaves out of the project\'s own files'
            : plan.reason === 'missingSource' ? 'a component\'s source file was not found where the edited copy is built from'
            : 'the deploy sends the project\'s own files';

    }

    // WHY A DEPLOY PLANNED FOR jsforce BEFORE THE CONFIRMATION CANNOT GO THAT WAY NOW
    static describeChangedPlan(plan: MetadataDeployMethodPlan): string {

        if ( plan.method !== 'cli' ) {
            return '';
        }

        return plan.reason === 'replacements' ? 'sfdx-project.json gained "replacements" while the confirmation was open'
            : plan.reason === 'forceIgnore' ? '.forceignore now covers a file being deployed'
            : plan.reason === 'missingSource' ? 'a component\'s source file is gone'
            : 'the metadata deploy method setting changed';

    }

    // WHAT THE CONFIRMATION'S "How it deploys" SECTION SAYS
    static describeDeployMethod(plan: MetadataDeployMethodPlan): string[] {

        if ( plan.method === 'jsforce' ) {
            return [
                'These components are deployed, in a Metadata API zip built from a generated package.xml.',
                'It is sent on the connection checked above, not through the Salesforce CLI.',
                'A custom object\'s own file goes whole, as the CLI sends it, apart from what is set back above; nothing else in the object folders goes.'
            ];
        }

        if ( plan.method === 'cliMetadataDir' ) {
            return [
                'These components are deployed, in a Metadata API zip built from a generated package.xml and saved beside it.',
                'The Salesforce CLI sends that zip with --metadata-dir, because a custom object\'s copy in it has a reference set back; this project\'s files are not changed.',
                'Nothing else in the object folders goes.'
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
    static async buildDeployZip(packageXml: string,
                                sourceFiles: readonly IMetadataDeploySourceFile[],
                                isCancellationRequested: () => boolean = () => false): Promise<Buffer | undefined> {

        const entries: IMetadataZipEntry[] = [{ name: 'package.xml', content: Buffer.from(packageXml, 'utf-8') }];
        const objectEntriesByLowerName = new Map<string, { objectApiName: string; objectContent?: Record<string, unknown>; children: Map<string, Record<string, unknown>[]>; namespaceAttributes: Map<string, string> }>();

        const objectEntryOf = (objectApiName: string) => {
            const lowerName = objectApiName.toLowerCase();
            const objectEntry = objectEntriesByLowerName.get(lowerName) ?? { objectApiName: objectApiName, children: new Map<string, Record<string, unknown>[]>(), namespaceAttributes: new Map<string, string>() };
            objectEntriesByLowerName.set(lowerName, objectEntry);
            return objectEntry;
        };

        for ( const [fileIndex, sourceFile] of sourceFiles.entries() ) {

            if ( fileIndex > 0 && fileIndex % METADATA_DEPLOY_ZIP_YIELD_EVERY_FILES === 0 ) {
                await new Promise<void>(resolve => setImmediate(resolve));
            }
            if ( isCancellationRequested() ) {
                return undefined;
            }

            const { component } = sourceFile;
            const sourceText = this.readSourceFile(sourceFile.filePath, `${component.type} ${component.member}`);

            const wholeFileLayout = WHOLE_FILE_TYPES[component.type];
            if ( wholeFileLayout ) {
                await this.readRootElement(sourceText, component.type, component.member);
                entries.push({
                    name: `${wholeFileLayout.zipFolderName}/${component.member}${wholeFileLayout.zipSuffix}`,
                    content: Buffer.from(sourceText, 'utf-8')
                });
                continue;
            }

            if ( component.type === 'CustomObject' ) {
                const objectRoot = await this.readRootElement(sourceText, 'CustomObject', component.member);
                const objectEntry = objectEntryOf(component.member);
                objectEntry.objectContent = objectRoot.content;
                this.addNamespaceAttributes(objectEntry.namespaceAttributes, objectRoot.namespaceAttributes, component.member);
                continue;
            }

            const [objectApiName, childName] = component.member.split('.');
            const childRoot = await this.readRootElement(sourceText, component.type, component.member);
            const { fullName, ...childFields } = childRoot.content;
            const elementName = OBJECT_CHILD_LAYOUTS[component.type as ObjectChildType].elementName;
            const objectEntry = objectEntryOf(objectApiName);
            this.addNamespaceAttributes(objectEntry.namespaceAttributes, childRoot.namespaceAttributes, component.member);
            const childContents = objectEntry.children.get(elementName) ?? [];
            objectEntry.children.set(elementName, childContents);
            childContents.push({ fullName: fullName ?? [childName], ...childFields });

        }

        // AN OBJECT'S OWN XML KEEPS ONLY THE PAGES AND COMPACT LAYOUTS THIS ZIP CARRIES (#547); THE REST ARE SET BACK, BY THE RULE THE CONFIRMATION LISTED THEM BY
        const shippedFlexiPageLowerNames = new Set(sourceFiles.filter(sourceFile => sourceFile.component.type === 'FlexiPage').map(sourceFile => sourceFile.component.member.toLowerCase()));
        const shippedCompactLayoutLowerNames = new Set(sourceFiles.filter(sourceFile => sourceFile.component.type === 'CompactLayout').map(sourceFile => sourceFile.component.member.toLowerCase()));

        [...objectEntriesByLowerName.values()].forEach(objectEntry => {
            const objectContent = objectEntry.objectContent && RecipeCockpitMetadataDeploy.resolveObjectReferences(
                objectEntry.objectApiName,
                objectEntry.objectContent,
                flexiPageName => shippedFlexiPageLowerNames.has(flexiPageName.toLowerCase()),
                compactLayoutName => shippedCompactLayoutLowerNames.has(`${objectEntry.objectApiName}.${compactLayoutName}`.toLowerCase())
            ).objectContent;
            entries.push({ name: `objects/${objectEntry.objectApiName}.object`, content: Buffer.from(this.buildObjectXml(objectContent, objectEntry.children, objectEntry.namespaceAttributes), 'utf-8') });
        });

        return this.buildZip(entries);

    }

    /*
        One source file, through ONE handle opened without following a link, its kind and size read
        from that handle: a link planted after the file was found is never read, and a file past
        METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES is refused before it is read into the extension host.
    */
    static readSourceFile(filePath: string, componentLabel: string): string {

        let fileDescriptor: number | undefined;
        try {
            fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | ( fs.constants.O_NOFOLLOW ?? 0 ));
            const fileStats = fs.fstatSync(fileDescriptor);
            if ( !fileStats.isFile() ) {
                throw new Error('not a file');
            }
            if ( fileStats.size > METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES ) {
                throw new Error(`The source file of ${componentLabel} is larger than ${METADATA_DEPLOY_SOURCE_FILE_MAX_BYTES / ( 1024 * 1024 )} MB, so nothing was deployed.`);
            }
            return fs.readFileSync(fileDescriptor, 'utf-8');
        } catch (readError) {
            if ( readError instanceof Error && readError.message.startsWith('The source file of') ) {
                throw readError;
            }
            throw new Error(`The source file of ${componentLabel} could not be read, so nothing was deployed.`);
        } finally {
            if ( fileDescriptor !== undefined ) {
                fs.closeSync(fileDescriptor);
            }
        }

    }

    // A SOURCE FILE'S PREFIXED NAMESPACES (xmlns:xsi …) GO ON THE MERGED .object's ROOT; ONE PREFIX BOUND TO TWO URIs IS REFUSED
    static addNamespaceAttributes(target: Map<string, string>, namespaceAttributes: ReadonlyMap<string, string>, member: string): void {

        namespaceAttributes.forEach((namespaceUri, attributeName) => {
            const existing = target.get(attributeName);
            if ( existing !== undefined && existing !== namespaceUri ) {
                throw new Error(`The source file of ${member} binds ${attributeName} to another namespace than a file deployed with it, so nothing was deployed.`);
            }
            target.set(attributeName, namespaceUri);
        });

    }

    // A FILE'S ROOT ELEMENT'S CONTENT AND ITS PREFIXED xmlns:* ATTRIBUTES (THE DEFAULT xmlns AND ANY OTHER ATTRIBUTE LEFT OUT); AN EMPTY ROOT IS {}. ANY OTHER ROOT THROWS
    static async readRootElement(sourceText: string, rootElementName: string, member: string): Promise<{ content: Record<string, unknown>; namespaceAttributes: Map<string, string> }> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(sourceText);
        } catch {
            throw new Error(`The source file of ${rootElementName} ${member} could not be read as XML, so nothing was deployed.`);
        }

        const rootContent = ( parsedXml as Record<string, unknown> | null )?.[rootElementName];
        if ( typeof rootContent === 'string' ) {
            return { content: {}, namespaceAttributes: new Map<string, string>() };
        }
        if ( rootContent === null || typeof rootContent !== 'object' || Array.isArray(rootContent) ) {
            throw new Error(`The source file of ${rootElementName} ${member} is not a <${rootElementName}>, so nothing was deployed.`);
        }

        const content: Record<string, unknown> = {};
        const namespaceAttributes = new Map<string, string>();
        Object.entries(rootContent as Record<string, unknown>).forEach(([key, value]) => {
            if ( key !== '$' ) {
                content[key] = value;
            } else if ( value !== null && typeof value === 'object' ) {
                Object.entries(value as Record<string, unknown>).forEach(([attributeName, attributeValue]) => {
                    if ( /^xmlns:[A-Za-z_][A-Za-z0-9_.-]*$/.test(attributeName) && typeof attributeValue === 'string' ) {
                        namespaceAttributes.set(attributeName, attributeValue);
                    }
                });
            }
        });

        return { content: content, namespaceAttributes: namespaceAttributes };

    }

    // THE OBJECT'S OWN ELEMENTS AND ITS CHILDREN, IN ELEMENT-NAME ORDER AS THE METADATA API'S SCHEMA LISTS THEM
    static buildObjectXml(objectContent: Record<string, unknown> | undefined,
                            children: ReadonlyMap<string, Record<string, unknown>[]>,
                            namespaceAttributes: ReadonlyMap<string, string> = new Map<string, string>()): string {

        const merged: Record<string, unknown> = { ...( objectContent ?? {} ) };
        children.forEach((childContents, elementName) => {
            const existing = merged[elementName];
            merged[elementName] = [...( Array.isArray(existing) ? existing : existing === undefined ? [] : [existing] ), ...childContents];
        });

        const ordered: Record<string, unknown> = { $: { xmlns: METADATA_DEPLOY_NAMESPACE, ...Object.fromEntries([...namespaceAttributes].sort(([first], [second]) => first < second ? -1 : 1)) } };
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
        const requestTimeout = control.requestTimeoutMilliseconds ?? METADATA_DEPLOY_REQUEST_TIMEOUT_MILLISECONDS;
        const watchInterval = control.requestWatchMilliseconds ?? METADATA_DEPLOY_REQUEST_WATCH_MILLISECONDS;

        /*
            One request, given up on when it has not answered by its own timeout, by the deploy's
            deadline plus the cancel wait, or by the cancel wait once a cancel is asked for: a request
            that never answers would otherwise hold the window's deploy lock until a reload.
        */
        const watch = async <T>(request: PromiseLike<T>): Promise<WatchedRequest<T>> => {
            let isSettled = false;
            const startedAt = now();
            let cancelSeenAt: number | undefined;
            const answered = Promise.resolve(request).then(
                (answer): WatchedRequest<T> => { isSettled = true; return { isAnswered: true, answer: answer }; },
                (requestError: unknown) => { isSettled = true; throw requestError; }
            );
            const givenUp = (async (): Promise<WatchedRequest<T>> => {
                while ( !isSettled ) {
                    if ( cancelSeenAt === undefined && control.isCancellationRequested() ) {
                        cancelSeenAt = now();
                    }
                    const limit = Math.min(startedAt + requestTimeout, deadline + cancelWait, cancelSeenAt === undefined ? Number.POSITIVE_INFINITY : cancelSeenAt + cancelWait);
                    if ( now() >= limit ) {
                        return { isAnswered: false };
                    }
                    await sleep(watchInterval);
                }
                return await new Promise<WatchedRequest<T>>(() => undefined);
            })();
            return await Promise.race([answered, givenUp]);
        };

        if ( control.isCancellationRequested() ) {
            return { kind: 'unconfirmed', failureMessage: 'The deploy was cancelled before it was sent, so nothing was deployed.', isCancelled: true, isSent: false };
        }

        let deployId: string;
        try {
            const watched = await watch(connection.metadata.deploy(zipInput, { ...METADATA_DEPLOY_JSFORCE_OPTIONS }));
            if ( !watched.isAnswered ) {
                return { kind: 'unconfirmed', failureMessage: 'The org did not answer the deploy request in time, so whether it landed is unknown.', isCancelled: control.isCancellationRequested(), isSent: true };
            }
            const asyncResult = watched.answer;
            const id = asyncResult !== null && typeof asyncResult === 'object' ? ( asyncResult as Record<string, unknown> ).id : undefined;
            if ( typeof id !== 'string' || !SALESFORCE_ID_PATTERN.test(id) ) {
                return { kind: 'unconfirmed', failureMessage: 'The org did not answer the deploy request with a deploy Id, so whether it landed is unknown.', isCancelled: false, isSent: true };
            }
            deployId = id;
        } catch (deployError) {
            return { kind: 'unconfirmed', failureMessage: `The deploy request failed, so whether it landed is unknown: ${this.describeError(deployError)}`, isCancelled: false, isSent: true };
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
                    await watch(connection.metadata.cancelDeploy(deployId));
                } catch {
                    // THE STATUS CHECK BELOW SAYS WHAT THE ORG DID
                }
            }

            let deployResult: unknown;
            try {
                const watched = await watch(connection.metadata.checkDeployStatus(deployId, true));
                if ( !watched.isAnswered ) {
                    throw new Error('the org did not answer in time');
                }
                deployResult = watched.answer;
                failedChecks = 0;
            } catch (checkError) {
                failedChecks++;
                const isOutOfTime = now() >= deadline + cancelWait || ( cancelReason !== undefined && now() >= cancelDeadline );
                if ( failedChecks >= METADATA_DEPLOY_STATUS_CHECK_ATTEMPTS || isOutOfTime ) {
                    return { kind: 'unconfirmed', deployId: deployId, failureMessage: `The deploy's status could not be read, so whether it landed is unknown: ${this.describeError(checkError)}`, isCancelled: cancelReason === 'cancelled', isSent: true, payload: lastPayload };
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
                    isSent: true,
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
