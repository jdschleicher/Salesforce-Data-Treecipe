import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { ORG_OPERATION_RESULT_FILE_ATTEMPTS, ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { IRecipeCockpitRunArtifactsLocation, RecipeCockpitRunArtifacts } from './RecipeCockpitRunArtifacts';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { IRecipeCockpitConfirmContent, IRecipeCockpitConfirmOrg } from './RecipeCockpitConfirmContent';

/*
    The Troubleshooting tab's deploys (#346): what one relationship tree would deploy -- its custom
    fields and the custom objects that hold them, the global value sets those fields name, its
    objects' record types and validation rules, or permission sets -- found in the project's STRICT
    package directories, the package.xml that names exactly those members, the argv that deploys it,
    and the CLI's answer read back. It imports no vscode: the cockpit owns the org, the confirmation,
    the progress and the notification.

    Only the six types below are ever written into a package.xml, only custom fields (__c), and only
    custom objects (__c and platform events __e, #402: a field cannot land on an object the org
    lacks): never a standard
    object, a layout, a list view or anything else in an object folder, so an unrelated broken file
    cannot fail the deploy. Every member is an api name before it is written.

    A custom object's file can name what the org must already hold (#547): a FlexiPage or a component
    an <actionOverrides> opens, a custom <compactLayoutAssignment>. A fields deploy also ships the
    FlexiPages and compact layouts the project holds; every other such reference is set back to the
    standard page (resolveObjectReferences) in the copy that is deployed, never in the project.
*/

export type MetadataDeployKind = 'permissionSet' | 'fields' | 'globalValueSets' | 'recordTypes';

export type MetadataDeployType = 'PermissionSet' | 'CustomField' | 'CustomObject' | 'GlobalValueSet' | 'RecordType' | 'ValidationRule';

export const METADATA_DEPLOY_TYPES: readonly MetadataDeployType[] = Object.freeze(['CustomField', 'CustomObject', 'GlobalValueSet', 'PermissionSet', 'RecordType', 'ValidationRule'] as MetadataDeployType[]);

// A RETRIEVE'S PACKAGE.XML (#401) NAMES ONLY THESE; A DEPLOY'S ALSO NAMES VALIDATION RULES SINCE #402, WHEN THE FIELDS CONFIRMATION'S BOX IS TICKED
export type MetadataPackageXmlType = MetadataDeployType | 'CompactLayout' | 'FlexiPage';

// WHAT A FIELDS DEPLOY'S PACKAGE.XML MAY NAME (#547): THE OBJECTS' FLEXIPAGES AND COMPACT LAYOUTS THE PROJECT HOLDS AS WELL
export const METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES: readonly MetadataPackageXmlType[] = Object.freeze([...METADATA_DEPLOY_TYPES, 'CompactLayout', 'FlexiPage'] as MetadataPackageXmlType[]);

export const METADATA_RETRIEVE_PACKAGE_XML_TYPES: readonly MetadataPackageXmlType[] = Object.freeze(['CustomField', 'GlobalValueSet', 'RecordType', 'ValidationRule'] as MetadataPackageXmlType[]);

export const METADATA_DEPLOY_TYPE_BY_KIND: Readonly<Record<MetadataDeployKind, MetadataDeployType>> = Object.freeze({
    permissionSet: 'PermissionSet',
    fields: 'CustomField',
    globalValueSets: 'GlobalValueSet',
    recordTypes: 'RecordType'
});

export const METADATA_DEPLOY_OPERATION_BY_KIND = Object.freeze({
    permissionSet: 'permission-set-deploy',
    fields: 'field-deploy',
    globalValueSets: 'global-value-set-deploy',
    recordTypes: 'record-type-deploy'
} as const);

export type MetadataDeployOperationName = typeof METADATA_DEPLOY_OPERATION_BY_KIND[MetadataDeployKind];

// THE RETRIEVES THAT NAME THEIR COMPONENTS IN A PACKAGE.XML (#382); SPELLED HERE SO THIS MODULE IMPORTS NOTHING OF THE RETRIEVE'S
export type MetadataPackageXmlRetrieveOperationName = 'validation-rule-retrieve' | 'field-retrieve' | 'record-type-retrieve' | 'global-value-set-retrieve';

// HOW DEEP UNDER A PACKAGE DIRECTORY AN objects OR globalValueSets FOLDER IS LOOKED FOR: force-app/main/default/objects IS THREE
export const METADATA_DEPLOY_SEARCH_DEPTH = 6;

// HOW MANY COMPONENTS THE CONFIRMATION NAMES BEFORE IT COUNTS THE REST
export const METADATA_DEPLOY_CONFIRMATION_SHOWN = 20;

// HOW MANY COMPONENT FAILURES A NOTIFICATION NAMES BEFORE IT COUNTS THE REST
export const METADATA_DEPLOY_FAILURES_SHOWN = 5;

export const METADATA_DEPLOY_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

// HOW MANY FIELD FILES ARE READ BEFORE THE SUMMARY HANDS THE EXTENSION HOST BACK TO ITS EVENT LOOP
export const METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES = 200;

export const METADATA_DEPLOY_PACKAGE_XML_SUFFIX = '-package.xml';

// THE METADATA API ZIP THE CLI SENDS WITH --metadata-dir WHEN AN OBJECT'S COPY IS EDITED (#547), SAVED BESIDE ITS PACKAGE.XML
export const METADATA_DEPLOY_ZIP_SUFFIX = '-metadata.zip';

const FIELD_FILE_SUFFIX = '.field-meta.xml';
const RECORD_TYPE_FILE_SUFFIX = '.recordType-meta.xml';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';
const VALIDATION_RULE_FILE_SUFFIX = '.validationRule-meta.xml';
const OBJECT_FILE_SUFFIX = '.object-meta.xml';
const FLEXIPAGE_FILE_SUFFIX = '.flexipage-meta.xml';
const COMPACT_LAYOUT_FILE_SUFFIX = '.compactLayout-meta.xml';

// THE <compactLayoutAssignment> THAT NAMES NO CUSTOM LAYOUT
const SYSTEM_COMPACT_LAYOUT = 'SYSTEM';

// AN OVERRIDE OPENING ANYTHING BUT A FLEXIPAGE OR THE STANDARD PAGE (#547): A BUNDLE OR PAGE THAT CAN PULL IN APEX, SO NEVER SHIPPED WITH THE FIELDS
const COMPONENT_OVERRIDE_TYPES: readonly string[] = Object.freeze(['LightningComponent', 'Scontrol', 'Visualforce']);

// ONLY A CUSTOM FIELD OF THE OBJECT ITSELF IS DEPLOYED; __pc, __Latitude__s AND STANDARD FIELDS ARE NOT
const CUSTOM_FIELD_NAME_PATTERN = /__c$/;

// ONLY A CUSTOM OBJECT OR PLATFORM EVENT IS DEPLOYED (#402), BOTH A <CustomObject>; A STANDARD OBJECT IS THE ORG'S, AND __mdt, __x AND __b ARE NOT A TREE'S
const CUSTOM_OBJECT_NAME_PATTERN = /__[ce]$/;

const API_VERSION_PATTERN = /^[1-9][0-9]{1,2}\.0$/;

export interface IMetadataDeployComponent {
    type: MetadataPackageXmlType;
    member: string;
}

// ONE <actionOverrides> OR THE <compactLayoutAssignment> OF A DEPLOYED OBJECT THAT IS SET BACK TO THE STANDARD ONE IN THE DEPLOYED COPY (#547)
export interface IObjectReferenceReset {
    objectApiName: string;
    // WHAT WAS SET BACK, e.g. "View override, Large form factor, FlexiPage Order_Record_Page"
    reference: string;
    // WHY, e.g. "not in this project"
    reason: string;
}

export interface IResolvedObjectReferences {
    // THE OBJECT'S ELEMENTS WITH EVERY RESET APPLIED; THE SAME OBJECT WHEN NOTHING WAS RESET
    objectContent: Record<string, unknown>;
    resets: IObjectReferenceReset[];
}

export interface IMetadataDeployObject {
    objectApiName: string;
    fieldApiNames: string[];
}

/*
    What a tree holds in the project, per section. Every list is sorted with "<" and names a member
    the way package.xml does ("<Object>.<Field>", "<Object>.<DeveloperName>", "<Name>").
*/
export interface IMetadataDeploySummary {
    // CUSTOM FIELDS WHOSE SOURCE XML WAS FOUND AND READ AS A <CustomField>
    customFields: string[];
    // STANDARD FIELDS: NEVER DEPLOYED, LISTED SO THE READER KNOWS THEY WERE LEFT OUT ON PURPOSE
    standardFields: string[];
    // CUSTOM FIELDS WHOSE SOURCE XML IS MISSING OR CANNOT BE READ: LEFT OUT, NEVER GUESSED AT
    unreadableFields: string[];
    // GLOBAL VALUE SETS A FIELD NAMES THAT THE PROJECT HOLDS
    globalValueSets: string[];
    // GLOBAL VALUE SETS A FIELD NAMES THAT THE PROJECT DOES NOT HOLD
    missingGlobalValueSets: string[];
    recordTypes: string[];
    // CUSTOM (__c) AND PLATFORM EVENT (__e) TREE OBJECTS WHOSE <Object>.object-meta.xml WAS FOUND AND READ AS A <CustomObject> (#402)
    customObjects: string[];
    // CUSTOM TREE OBJECTS NO PACKAGE DIRECTORY HOLDS AN .object-meta.xml FOR: LEFT OUT, SO THEIR FIELDS NEED THE ORG TO HAVE THEM
    missingCustomObjects: string[];
    // CUSTOM TREE OBJECTS WHOSE .object-meta.xml COULD NOT BE READ AS A <CustomObject>: LEFT OUT, NEVER GUESSED AT
    unreadableCustomObjects: string[];
    // EVERY *.validationRule-meta.xml IN EACH TREE OBJECT'S validationRules FOLDER, "<Object>.<Rule>"
    validationRules: string[];
    // FLEXIPAGES A DEPLOYED CUSTOM OBJECT'S <actionOverrides> OPEN THAT THE PROJECT HOLDS, AS THEIR FILES SPELL THEM (#547)
    flexiPages: string[];
    // "<Object>.<Layout>": A DEPLOYED CUSTOM OBJECT'S <compactLayoutAssignment> THAT ITS compactLayouts FOLDER HOLDS (#547)
    compactLayouts: string[];
    // WHAT A DEPLOYED CUSTOM OBJECT NAMES THAT IS SET BACK TO THE STANDARD ONE IN THE DEPLOYED COPY (#547)
    objectReferenceResets: IObjectReferenceReset[];
    // "<Object>.<Field> → <Object>": A DEPLOYED LOOKUP OR MASTER-DETAIL TO A CUSTOM OBJECT THIS TREE DOES NOT DEPLOY (#547)
    outOfTreeLookups: string[];
    // OBJECT, FIELD, VALUE SET OR RECORD TYPE NAMES THAT ARE NOT API NAMES, SO NOTHING WAS OFFERED FOR THEM
    skippedNameCount: number;
}

export type MetadataDeployOutcome =
    | { kind: 'deployed'; deployedComponentCount: number }
    | { kind: 'cliNotInstalled'; failureMessage: string }
    | { kind: 'unconfirmed'; failureMessage: string }
    | { kind: 'failed'; failureMessage: string; componentFailureCount: number; componentFailureMessages: string[] };

export class RecipeCockpitMetadataDeploy {

    static isCustomFieldName(fieldApiName: unknown): fieldApiName is string {
        return SalesforceApiName.isApiName(fieldApiName) && CUSTOM_FIELD_NAME_PATTERN.test(fieldApiName);
    }

    // A MEMBER IS WRITTEN ONLY IF EVERY PART OF IT IS AN API NAME, IN THE SHAPE ITS TYPE NAMES ONE
    static isDeployableMember(type: MetadataPackageXmlType, member: unknown): member is string {

        if ( typeof member !== 'string' ) {
            return false;
        }

        if ( type === 'PermissionSet' || type === 'GlobalValueSet' || type === 'FlexiPage' ) {
            return SalesforceApiName.isApiName(member);
        }

        if ( type === 'CustomObject' ) {
            return this.isCustomObjectName(member);
        }

        const parts = member.split('.');
        if ( parts.length !== 2 || !SalesforceApiName.isApiName(parts[0]) ) {
            return false;
        }

        return type === 'CustomField' ? this.isCustomFieldName(parts[1]) : SalesforceApiName.isApiName(parts[1]);

    }

    static isCustomObjectName(objectApiName: unknown): objectApiName is string {
        return SalesforceApiName.isApiName(objectApiName) && CUSTOM_OBJECT_NAME_PATTERN.test(objectApiName);
    }

    // EVERY FOLDER NAMED folderName UNDER THE PACKAGE DIRECTORIES, NO LINK FOLLOWED, EACH INSIDE THE WORKSPACE
    static findMetadataFolderPaths(workspaceRoot: string, packageDirectoryPaths: readonly string[], folderName: string): string[] {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const foundFolderPaths: string[] = [];
        const visitedFolderPaths = new Set<string>();

        const walk = (folderPath: string, depth: number) => {

            if ( visitedFolderPaths.has(folderPath) ) {
                return;
            }
            visitedFolderPaths.add(folderPath);

            this.listEntries(folderPath)
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
                .map(entry => entry.name)
                // sort() WITH NO COMPARATOR ORDERS BY UTF-16 CODE UNIT, AS "<" DOES -- NEVER localeCompare
                .sort()
                .forEach(childName => {
                    const childPath = path.join(folderPath, childName);
                    if ( childName === folderName ) {
                        foundFolderPaths.push(childPath);
                    } else if ( depth < METADATA_DEPLOY_SEARCH_DEPTH ) {
                        walk(childPath, depth + 1);
                    }
                });

        };

        new Set(packageDirectoryPaths.map(packageDirectoryPath => path.resolve(resolvedWorkspaceRoot, packageDirectoryPath))).forEach(packageDirectoryPath => {
            if ( SfdxProjectService.isPathContainedInWorkspace(packageDirectoryPath, resolvedWorkspaceRoot) ) {
                walk(packageDirectoryPath, 1);
            }
        });

        return foundFolderPaths.filter(folderPath => SfdxProjectService.isPathContainedInWorkspace(folderPath, resolvedWorkspaceRoot));

    }

    /*
        Every folder of each tree object under an objects folder of a package directory, matched
        case-insensitively as Salesforce reads names, in package directory order: an unlocked-package
        project can keep one object's fields in several package directories, and the CLI deploys a
        member from whichever holds it.
    */
    static findObjectFolderPaths(workspaceRoot: string, packageDirectoryPaths: readonly string[], objectApiNames: readonly string[]): Map<string, string[]> {

        const objectApiNameByLowerName = new Map(objectApiNames.map(objectApiName => [objectApiName.toLowerCase(), objectApiName]));
        const objectFolderPathsByObject = new Map<string, string[]>();

        this.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'objects').forEach(objectsFolderPath => {
            this.listEntries(objectsFolderPath)
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .sort()
                .forEach(objectFolderName => {
                    const objectApiName = objectApiNameByLowerName.get(objectFolderName.toLowerCase());
                    if ( objectApiName ) {
                        objectFolderPathsByObject.set(objectApiName, [...( objectFolderPathsByObject.get(objectApiName) ?? [] ), path.join(objectsFolderPath, objectFolderName)]);
                    }
                });
        });

        return objectFolderPathsByObject;

    }

    // EVERY GLOBAL VALUE SET THE PROJECT HOLDS, BY LOWER-CASED NAME, AS ITS FILE SPELLS IT; THE FIRST PACKAGE DIRECTORY WINS
    static findGlobalValueSetNames(workspaceRoot: string, packageDirectoryPaths: readonly string[]): Map<string, string> {

        const globalValueSetNamesByLowerName = new Map<string, string>();

        this.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'globalValueSets').forEach(folderPath => {
            this.listEntries(folderPath)
                .filter(entry => entry.isFile() && entry.name.endsWith(GLOBAL_VALUE_SET_FILE_SUFFIX))
                .map(entry => entry.name.slice(0, -GLOBAL_VALUE_SET_FILE_SUFFIX.length))
                .sort()
                .forEach(globalValueSetName => {
                    if ( !globalValueSetNamesByLowerName.has(globalValueSetName.toLowerCase()) ) {
                        globalValueSetNamesByLowerName.set(globalValueSetName.toLowerCase(), globalValueSetName);
                    }
                });
        });

        return globalValueSetNamesByLowerName;

    }

    // A FIELD'S <valueSet><valueSetName>; undefined FOR A FILE THAT IS NOT A <CustomField>, '' FOR ONE NAMING NONE
    static async readValueSetName(fieldXml: string): Promise<string | undefined> {
        return ( await this.readFieldReferences(fieldXml) )?.valueSetName;
    }

    // A FIELD'S VALUE SET AND, FOR A LOOKUP OR MASTER-DETAIL, ITS <referenceTo> ('' FOR NONE); undefined FOR A FILE THAT IS NOT A <CustomField>
    static async readFieldReferences(fieldXml: string): Promise<{ valueSetName: string; referenceTo: string } | undefined> {

        const customField = await this.readRootContent(fieldXml, 'CustomField');
        if ( !customField ) {
            return undefined;
        }

        const valueSet = Array.isArray(customField.valueSet) ? customField.valueSet[0] : undefined;
        const valueSetName = valueSet !== null && typeof valueSet === 'object' ? this.readText(( valueSet as Record<string, unknown> ).valueSetName) : '';
        const fieldType = this.readText(customField.type);

        return {
            valueSetName: valueSetName,
            referenceTo: fieldType === 'Lookup' || fieldType === 'MasterDetail' ? this.readText(customField.referenceTo) : ''
        };

    }

    // WHETHER AN .object-meta.xml READS AS A <CustomObject>; AN EMPTY <CustomObject/> IS ONE
    static async isCustomObjectXml(objectXml: string): Promise<boolean> {
        return ( await this.readRootContent(objectXml, 'CustomObject') ) !== undefined;
    }

    // A ROOT ELEMENT'S CONTENT AS xml2js READS IT ({} FOR AN EMPTY ONE); undefined FOR TEXT THAT IS NOT XML OR HAS ANOTHER ROOT
    static async readRootContent(xmlText: string, rootElementName: string): Promise<Record<string, unknown> | undefined> {

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(xmlText);
        } catch {
            return undefined;
        }

        const rootContent = ( parsedXml as Record<string, unknown> | null )?.[rootElementName];
        if ( typeof rootContent === 'string' ) {
            return {};
        }

        return rootContent !== null && typeof rootContent === 'object' && !Array.isArray(rootContent) ? rootContent as Record<string, unknown> : undefined;

    }

    // THE TRIMMED TEXT OF AN ELEMENT xml2js READ AS AN ARRAY OF ONE; '' FOR ANYTHING ELSE
    static readText(element: unknown): string {

        const value = Array.isArray(element) ? element[0] : element;
        if ( typeof value === 'string' ) {
            return value.trim();
        }
        const text = value !== null && typeof value === 'object' ? ( value as Record<string, unknown> )._ : undefined;

        return typeof text === 'string' ? text.trim() : '';

    }

    /*
        The one rule for what a deployed custom object's file may still name (#547), shared by the
        summary the confirmation is built from and the copy the zip carries, so the two agree:
        - an <actionOverrides> of type Flexipage keeps its page only when findShippedFlexiPage names the
          page going in the same deploy; one naming no page, or a name that is not an api name, is reset
        - an override of type LightningComponent, Visualforce or Scontrol is always reset
        - a <compactLayoutAssignment> other than SYSTEM is kept only when findShippedCompactLayout
          names the layout going in the same deploy, else it is set to SYSTEM
        A kept reference takes the shipped file's spelling, since the two are matched ignoring case. A
        reset override keeps its action, form factor and the rest, and becomes <type>Default</type>
        with no <content>. The object passed in is never changed.
    */
    static resolveObjectReferences(objectApiName: string,
                                    objectContent: Readonly<Record<string, unknown>>,
                                    findShippedFlexiPage: (flexiPageName: string) => string | undefined,
                                    findShippedCompactLayout: (compactLayoutName: string) => string | undefined,
                                    describeNotShipped: (kind: 'FlexiPage' | 'CompactLayout', name: string) => string = () => 'not in this project'): IResolvedObjectReferences {

        const resets: IObjectReferenceReset[] = [];
        const resolved: Record<string, unknown> = { ...objectContent };
        const toSingleLine = (text: string) => text.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
        let isChanged = false;

        if ( Array.isArray(objectContent.actionOverrides) ) {

            resolved.actionOverrides = objectContent.actionOverrides.map(actionOverride => {

                if ( actionOverride === null || typeof actionOverride !== 'object' || Array.isArray(actionOverride) ) {
                    return actionOverride;
                }

                const overrideElements = actionOverride as Record<string, unknown>;
                const overrideType = this.readText(overrideElements.type);
                const target = this.readText(overrideElements.content);
                let reason: string | undefined;
                let shippedName: string | undefined;

                if ( overrideType === 'Flexipage' ) {
                    shippedName = target !== '' && SalesforceApiName.isApiName(target) ? findShippedFlexiPage(target) : undefined;
                    reason = target === '' ? 'it names no page'
                        : !SalesforceApiName.isApiName(target) ? 'its page name is not a Salesforce api name'
                        : shippedName !== undefined ? undefined
                        : describeNotShipped('FlexiPage', target);
                } else if ( COMPONENT_OVERRIDE_TYPES.includes(overrideType) ) {
                    reason = `a ${overrideType} override is never deployed with the fields`;
                }

                if ( reason === undefined && shippedName !== undefined && shippedName !== target ) {
                    isChanged = true;
                    return { ...overrideElements, content: [shippedName] };
                }

                if ( reason === undefined ) {
                    return actionOverride;
                }

                const actionName = this.readText(overrideElements.actionName) || 'an action';
                const formFactor = this.readText(overrideElements.formFactor);
                resets.push({
                    objectApiName: objectApiName,
                    reference: toSingleLine(`${actionName} override${formFactor ? `, ${formFactor} form factor` : ''}, ${overrideType === 'Flexipage' ? 'FlexiPage' : overrideType}${target ? ` ${target}` : ''}`),
                    reason: toSingleLine(reason)
                });

                isChanged = true;
                const { content, ...keptElements } = overrideElements;
                return { ...keptElements, type: ['Default'] };

            });

        }

        const compactLayoutName = this.readText(objectContent.compactLayoutAssignment);
        if ( compactLayoutName !== '' && compactLayoutName !== SYSTEM_COMPACT_LAYOUT ) {

            const shippedName = SalesforceApiName.isApiName(compactLayoutName) ? findShippedCompactLayout(compactLayoutName) : undefined;
            const reason = !SalesforceApiName.isApiName(compactLayoutName) ? 'its name is not a Salesforce api name'
                : shippedName !== undefined ? undefined
                : describeNotShipped('CompactLayout', compactLayoutName);

            if ( reason !== undefined ) {
                resets.push({ objectApiName: objectApiName, reference: toSingleLine(`compact layout ${compactLayoutName}`), reason: toSingleLine(reason) });
                resolved.compactLayoutAssignment = [SYSTEM_COMPACT_LAYOUT];
                isChanged = true;
            } else if ( shippedName !== undefined && shippedName !== compactLayoutName ) {
                resolved.compactLayoutAssignment = [shippedName];
                isChanged = true;
            }

        }

        return { objectContent: isChanged ? resolved : objectContent as Record<string, unknown>, resets: resets };

    }

    // EVERY FLEXIPAGE THE PROJECT HOLDS, BY LOWER-CASED NAME -> FILE PATH; THE FIRST PACKAGE DIRECTORY WINS
    static findFlexiPageFilePaths(workspaceRoot: string, packageDirectoryPaths: readonly string[]): Map<string, string> {

        const filePathsByLowerName = new Map<string, string>();

        this.findMetadataFolderPaths(workspaceRoot, packageDirectoryPaths, 'flexipages').forEach(folderPath => {
            this.listEntries(folderPath)
                .filter(entry => entry.isFile() && entry.name.endsWith(FLEXIPAGE_FILE_SUFFIX))
                .map(entry => entry.name)
                .sort()
                .forEach(fileName => {
                    const lowerName = fileName.slice(0, -FLEXIPAGE_FILE_SUFFIX.length).toLowerCase();
                    if ( !filePathsByLowerName.has(lowerName) ) {
                        filePathsByLowerName.set(lowerName, path.join(folderPath, fileName));
                    }
                });
        });

        return filePathsByLowerName;

    }

    // THE FIRST OF THE OBJECT'S FOLDERS WHOSE compactLayouts FOLDER HOLDS <Layout>.compactLayout-meta.xml AS A FILE, MATCHED CASE-INSENSITIVELY
    static findCompactLayoutFilePath(objectFolderPaths: readonly string[], compactLayoutName: string): string | undefined {

        const compactLayoutFileName = `${compactLayoutName}${COMPACT_LAYOUT_FILE_SUFFIX}`.toLowerCase();

        for ( const objectFolderPath of objectFolderPaths ) {
            const compactLayoutEntry = this.listSubfolderEntries(objectFolderPath, 'compactLayouts').find(entry => entry.isFile() && entry.name.toLowerCase() === compactLayoutFileName);
            if ( compactLayoutEntry ) {
                return path.join(objectFolderPath, 'compactLayouts', compactLayoutEntry.name);
            }
        }

        return undefined;

    }

    // THE FIRST OF THE OBJECT'S FOLDERS HOLDING <Object>.object-meta.xml AS A FILE, NOT A LINK, MATCHED CASE-INSENSITIVELY
    static findObjectFilePath(objectFolderPaths: readonly string[], objectApiName: string): string | undefined {

        const objectFileName = `${objectApiName}${OBJECT_FILE_SUFFIX}`.toLowerCase();

        for ( const objectFolderPath of objectFolderPaths ) {
            const objectFileEntry = this.listEntries(objectFolderPath).find(entry => entry.isFile() && entry.name.toLowerCase() === objectFileName);
            if ( objectFileEntry ) {
                return path.join(objectFolderPath, objectFileEntry.name);
            }
        }

        return undefined;

    }

    /*
        What the tree holds per section. Fields are the tree's recipe fields (the caller leaves out
        excluded objects and unticked fields); a custom field counts only when its source XML is
        found under its object's folder and reads as a <CustomField>. Every field file found is read
        once, for the global value set it names. Record types are every *.recordType-meta.xml in each
        tree object's recordTypes folder.
    */
    static async summarizeTreeMetadata(workspaceRoot: string, packageDirectoryPaths: readonly string[], deployObjects: readonly IMetadataDeployObject[]): Promise<IMetadataDeploySummary> {

        const summary: IMetadataDeploySummary = {
            customFields: [], standardFields: [], unreadableFields: [], globalValueSets: [], missingGlobalValueSets: [], recordTypes: [],
            customObjects: [], missingCustomObjects: [], unreadableCustomObjects: [], validationRules: [],
            flexiPages: [], compactLayouts: [], objectReferenceResets: [], outOfTreeLookups: [], skippedNameCount: 0
        };
        const fieldApiNamesByObject = new Map<string, Set<string>>();

        deployObjects.forEach(deployObject => {

            if ( !SalesforceApiName.isApiName(deployObject.objectApiName) ) {
                summary.skippedNameCount++;
                return;
            }

            const fieldApiNames = fieldApiNamesByObject.get(deployObject.objectApiName) ?? new Set<string>();
            fieldApiNamesByObject.set(deployObject.objectApiName, fieldApiNames);
            deployObject.fieldApiNames.forEach(fieldApiName => {
                if ( SalesforceApiName.isApiName(fieldApiName) ) {
                    fieldApiNames.add(fieldApiName);
                } else {
                    summary.skippedNameCount++;
                }
            });

        });

        const objectApiNames = [...fieldApiNamesByObject.keys()].sort();
        const objectFolderPathsByObject = this.findObjectFolderPaths(workspaceRoot, packageDirectoryPaths, objectApiNames);
        const namedValueSetNames = new Set<string>();
        const recordTypes = new Set<string>();
        const validationRules = new Set<string>();
        const treeObjectLowerNames = new Set(objectApiNames.map(objectApiName => objectApiName.toLowerCase()));
        const flexiPages = new Set<string>();
        const compactLayouts = new Set<string>();
        let readFileCount = 0;
        const yieldEveryFiles = async () => {
            readFileCount++;
            if ( readFileCount % METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES === 0 ) {
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        };

        // A REFERENCED FLEXIPAGE OR COMPACT LAYOUT IS HELD ONLY WHEN ITS FILE READS AS ITS ROOT ELEMENT; EACH FILE IS READ ONCE (#547)
        let flexiPageFilePathsByLowerName: Map<string, string> | undefined;
        const heldFileStatuses = new Map<string, { heldName?: string; isUnreadable: boolean }>();
        const readHeldFile = async (statusKey: string, filePath: string | undefined, rootElementName: string): Promise<{ heldName?: string; isUnreadable: boolean }> => {
            const knownStatus = heldFileStatuses.get(statusKey);
            if ( knownStatus ) {
                return knownStatus;
            }
            let status: { heldName?: string; isUnreadable: boolean } = { isUnreadable: false };
            if ( filePath ) {
                await yieldEveryFiles();
                let isReadable = false;
                try {
                    isReadable = ( await this.readRootContent(fs.readFileSync(filePath, 'utf-8'), rootElementName) ) !== undefined;
                } catch {
                    isReadable = false;
                }
                const heldName = path.basename(filePath).slice(0, -( rootElementName === 'FlexiPage' ? FLEXIPAGE_FILE_SUFFIX : COMPACT_LAYOUT_FILE_SUFFIX ).length);
                status = isReadable && SalesforceApiName.isApiName(heldName) ? { heldName: heldName, isUnreadable: false } : { isUnreadable: isReadable === false };
            }
            heldFileStatuses.set(statusKey, status);
            return status;
        };

        for ( const objectApiName of objectApiNames ) {

            const objectFolderPaths = objectFolderPathsByObject.get(objectApiName) ?? [];

            if ( this.isCustomObjectName(objectApiName) ) {
                const objectFilePath = this.findObjectFilePath(objectFolderPaths, objectApiName);
                let objectContent: Record<string, unknown> | undefined;
                if ( objectFilePath ) {
                    await yieldEveryFiles();
                    try {
                        objectContent = await this.readRootContent(fs.readFileSync(objectFilePath, 'utf-8'), 'CustomObject');
                    } catch {
                        objectContent = undefined;
                    }
                }
                ( !objectFilePath ? summary.missingCustomObjects : objectContent ? summary.customObjects : summary.unreadableCustomObjects ).push(objectApiName);

                if ( objectContent ) {
                    const heldStatuses = new Map<string, { heldName?: string; isUnreadable: boolean }>();
                    for ( const actionOverride of Array.isArray(objectContent.actionOverrides) ? objectContent.actionOverrides : [] ) {
                        const target = actionOverride !== null && typeof actionOverride === 'object' && this.readText(( actionOverride as Record<string, unknown> ).type) === 'Flexipage'
                            ? this.readText(( actionOverride as Record<string, unknown> ).content)
                            : '';
                        if ( SalesforceApiName.isApiName(target) ) {
                            flexiPageFilePathsByLowerName = flexiPageFilePathsByLowerName ?? this.findFlexiPageFilePaths(workspaceRoot, packageDirectoryPaths);
                            heldStatuses.set(`FlexiPage\n${target.toLowerCase()}`, await readHeldFile(`FlexiPage\n${target.toLowerCase()}`, flexiPageFilePathsByLowerName.get(target.toLowerCase()), 'FlexiPage'));
                        }
                    }
                    const compactLayoutName = this.readText(objectContent.compactLayoutAssignment);
                    if ( compactLayoutName !== SYSTEM_COMPACT_LAYOUT && SalesforceApiName.isApiName(compactLayoutName) ) {
                        const statusKey = `CompactLayout\n${objectApiName.toLowerCase()}.${compactLayoutName.toLowerCase()}`;
                        heldStatuses.set(`CompactLayout\n${compactLayoutName.toLowerCase()}`, await readHeldFile(statusKey, this.findCompactLayoutFilePath(objectFolderPaths, compactLayoutName), 'CompactLayout'));
                    }

                    const heldStatusOf = (kind: 'FlexiPage' | 'CompactLayout', name: string) => heldStatuses.get(`${kind}\n${name.toLowerCase()}`);
                    const resolved = this.resolveObjectReferences(
                        objectApiName,
                        objectContent,
                        flexiPageName => heldStatusOf('FlexiPage', flexiPageName)?.heldName,
                        compactLayoutName => heldStatusOf('CompactLayout', compactLayoutName)?.heldName,
                        (kind, name) => heldStatusOf(kind, name)?.isUnreadable ? `its ${kind} file could not be read` : `${kind} ${name} is not in this project`
                    );
                    summary.objectReferenceResets.push(...resolved.resets);
                    heldStatuses.forEach((status, statusKey) => {
                        if ( status.heldName !== undefined ) {
                            ( statusKey.startsWith('FlexiPage\n') ? flexiPages : compactLayouts ).add(statusKey.startsWith('FlexiPage\n') ? status.heldName : `${objectApiName}.${status.heldName}`);
                        }
                    });
                }
            }

            // THE FIRST FOLDER HOLDING A FIELD'S FILE WINS
            const fieldFilePathsByLowerName = new Map<string, string>();
            objectFolderPaths.forEach(objectFolderPath => {
                this.listSubfolderEntries(objectFolderPath, 'fields')
                    .filter(entry => entry.isFile() && entry.name.endsWith(FIELD_FILE_SUFFIX))
                    .filter(entry => !fieldFilePathsByLowerName.has(entry.name.toLowerCase()))
                    .forEach(entry => fieldFilePathsByLowerName.set(entry.name.toLowerCase(), path.join(objectFolderPath, 'fields', entry.name)));
            });

            for ( const fieldApiName of [...( fieldApiNamesByObject.get(objectApiName) as Set<string> )].sort() ) {

                const member = `${objectApiName}.${fieldApiName}`;
                const isCustomField = this.isCustomFieldName(fieldApiName);
                const fieldFilePath = fieldFilePathsByLowerName.get(`${fieldApiName}${FIELD_FILE_SUFFIX}`.toLowerCase());

                let valueSetName: string | undefined;
                let referenceTo = '';
                if ( fieldFilePath ) {
                    await yieldEveryFiles();
                    try {
                        const fieldReferences = await this.readFieldReferences(fs.readFileSync(fieldFilePath, 'utf-8'));
                        valueSetName = fieldReferences?.valueSetName;
                        referenceTo = fieldReferences?.referenceTo ?? '';
                    } catch {
                        valueSetName = undefined;
                    }
                }

                // A LOOKUP TO A CUSTOM OBJECT THIS DEPLOY DOES NOT CARRY NEEDS THE ORG TO HAVE IT (#547); A STANDARD ONE IS THE ORG'S
                if ( isCustomField && valueSetName !== undefined && this.isCustomObjectName(referenceTo) && !treeObjectLowerNames.has(referenceTo.toLowerCase()) ) {
                    summary.outOfTreeLookups.push(`${member} → ${referenceTo}`);
                }

                if ( valueSetName ) {
                    if ( SalesforceApiName.isApiName(valueSetName) ) {
                        namedValueSetNames.add(valueSetName);
                    } else {
                        summary.skippedNameCount++;
                    }
                }

                if ( !isCustomField ) {
                    summary.standardFields.push(member);
                } else if ( valueSetName === undefined ) {
                    summary.unreadableFields.push(member);
                } else {
                    summary.customFields.push(member);
                }

            }

            for ( const objectFolderPath of objectFolderPaths ) {
                this.listSubfolderEntries(objectFolderPath, 'recordTypes')
                    .filter(entry => entry.isFile() && entry.name.endsWith(RECORD_TYPE_FILE_SUFFIX))
                    .map(entry => entry.name.slice(0, -RECORD_TYPE_FILE_SUFFIX.length))
                    .forEach(developerName => {
                        if ( SalesforceApiName.isApiName(developerName) ) {
                            recordTypes.add(`${objectApiName}.${developerName}`);
                        } else {
                            summary.skippedNameCount++;
                        }
                    });
                this.listSubfolderEntries(objectFolderPath, 'validationRules')
                    .filter(entry => entry.isFile() && entry.name.endsWith(VALIDATION_RULE_FILE_SUFFIX))
                    .map(entry => entry.name.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length))
                    .forEach(ruleName => {
                        if ( SalesforceApiName.isApiName(ruleName) ) {
                            validationRules.add(`${objectApiName}.${ruleName}`);
                        } else {
                            summary.skippedNameCount++;
                        }
                    });
            }

        }

        const projectValueSetNamesByLowerName = namedValueSetNames.size > 0 ? this.findGlobalValueSetNames(workspaceRoot, packageDirectoryPaths) : new Map<string, string>();
        const heldValueSetNames = new Set<string>();
        const missingValueSetNames = new Set<string>();
        namedValueSetNames.forEach(valueSetName => {
            const projectName = projectValueSetNamesByLowerName.get(valueSetName.toLowerCase());
            if ( projectName && SalesforceApiName.isApiName(projectName) ) {
                heldValueSetNames.add(projectName);
            } else {
                missingValueSetNames.add(valueSetName);
            }
        });

        summary.globalValueSets = [...heldValueSetNames].sort();
        summary.missingGlobalValueSets = [...missingValueSetNames].sort();
        summary.recordTypes = [...recordTypes].sort();
        summary.validationRules = [...validationRules].sort();
        summary.flexiPages = [...flexiPages].sort();
        summary.compactLayouts = [...compactLayouts].sort();

        return summary;

    }

    // A FIELDS DEPLOY ALSO NAMES THE CUSTOM OBJECTS IT READ (#402): A FIELD CANNOT LAND ON AN OBJECT THE ORG LACKS, AND THE FLEXIPAGES AND COMPACT LAYOUTS THEY OPEN (#547)
    static listSummaryComponents(summary: IMetadataDeploySummary, deployKind: Exclude<MetadataDeployKind, 'permissionSet'>): IMetadataDeployComponent[] {

        const members = deployKind === 'fields' ? summary.customFields
            : deployKind === 'globalValueSets' ? summary.globalValueSets
            : summary.recordTypes;

        return [
            ...members.map(member => ({ type: METADATA_DEPLOY_TYPE_BY_KIND[deployKind], member: member })),
            ...( deployKind === 'fields' ? [
                ...summary.customObjects.map(member => ({ type: 'CustomObject' as const, member: member })),
                // WHAT THOSE OBJECTS OPEN THAT THE PROJECT HOLDS GOES WITH THEM (#547)
                ...summary.flexiPages.map(member => ({ type: 'FlexiPage' as const, member: member })),
                ...summary.compactLayouts.map(member => ({ type: 'CompactLayout' as const, member: member }))
            ] : [] )
        ];

    }

    // WHAT A FIELDS DEPLOY ADDS WHEN ITS CONFIRMATION'S BOX IS TICKED (#402): THE TREE OBJECTS' VALIDATION RULES AND RECORD TYPES, AND THE VALUE SETS THE PROJECT HOLDS
    static listFullSetComponents(summary: IMetadataDeploySummary): IMetadataDeployComponent[] {

        return [
            ...summary.validationRules.map(member => ({ type: 'ValidationRule' as const, member: member })),
            ...summary.recordTypes.map(member => ({ type: 'RecordType' as const, member: member })),
            ...summary.globalValueSets.map(member => ({ type: 'GlobalValueSet' as const, member: member }))
        ];

    }

    // "<n> <Type>: <members>" PER TYPE, TYPES SORTED WITH "<"
    static describeComponentsByType(components: readonly IMetadataDeployComponent[]): string[] {

        const membersByType = new Map<MetadataPackageXmlType, Set<string>>();
        components.forEach(component => {
            const members = membersByType.get(component.type) ?? new Set<string>();
            membersByType.set(component.type, members);
            members.add(component.member);
        });

        return [...membersByType.keys()].sort().map(type => {
            const members = [...( membersByType.get(type) as Set<string> )].sort();
            return `${members.length} ${type}: ${this.describeCappedList(members)}`;
        });

    }

    static escapeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

    }

    // A VERSION ONLY IN THE SHAPE sfdx-project.json's sourceApiVersion TAKES; ANYTHING ELSE IS LEFT OUT AND THE CLI CHOOSES
    static readApiVersion(sourceApiVersion: unknown): string | undefined {
        return typeof sourceApiVersion === 'string' && API_VERSION_PATTERN.test(sourceApiVersion) ? sourceApiVersion : undefined;
    }

    /*
        The package.xml naming exactly these components, built the same way on every machine: types
        and members sorted with "<", duplicates once. Throws, writing nothing, for a type outside the
        four this tab deploys (or, for a retrieve, the types it passes), a member that is not an api
        name in its type's shape, or no component.
    */
    static buildPackageXml(components: readonly IMetadataDeployComponent[],
                            apiVersion?: string,
                            failureClause: string = 'nothing was deployed',
                            allowedTypes: readonly MetadataPackageXmlType[] = METADATA_DEPLOY_TYPES): string {

        if ( components.length === 0 ) {
            throw new Error(`No component was named, so ${failureClause}.`);
        }

        const membersByType = new Map<MetadataPackageXmlType, Set<string>>();

        components.forEach(component => {

            if ( !allowedTypes.includes(component.type) ) {
                throw new Error(`"${String(component.type).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a type the Troubleshooting tab ${allowedTypes === METADATA_RETRIEVE_PACKAGE_XML_TYPES ? 'retrieves' : 'deploys'}, so ${failureClause}.`);
            }

            if ( !this.isDeployableMember(component.type, component.member) ) {
                throw new Error(`"${String(component.member).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')}" is not a ${component.type} api name, so ${failureClause}.`);
            }

            const members = membersByType.get(component.type) ?? new Set<string>();
            membersByType.set(component.type, members);
            members.add(component.member);

        });

        const version = this.readApiVersion(apiVersion);

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
            ...[...membersByType.keys()].sort().flatMap(type => [
                '    <types>',
                ...[...( membersByType.get(type) as Set<string> )].sort().map(member => `        <members>${this.escapeXmlText(member)}</members>`),
                `        <name>${type}</name>`,
                '    </types>'
            ]),
            ...( version ? [`    <version>${version}</version>`] : [] ),
            '</Package>',
            ''
        ].join('\n');

    }

    /*
        <tree folder>/RunArtifacts/OrgOperations/<username>/<yyyyMMdd-HHmmss>-<operation>-package.xml
        (#470), beside the CLI results the cockpit saves for that tree. Built here, never from a
        panel message; undefined when the folder name could name another folder or the path would
        land outside the workspace.
    */
    static buildPackageXmlFilePath(runArtifactsLocation: IRecipeCockpitRunArtifactsLocation, orgUsername: string, operationName: MetadataDeployOperationName | MetadataPackageXmlRetrieveOperationName, date: Date): string | undefined {

        if ( !ScratchOrgService.isUsableOrgOperationFolderName(orgUsername) ) {
            return undefined;
        }

        const packageXmlFilePath = path.join(RecipeCockpitRunArtifacts.buildKindFolderPath(runArtifactsLocation, 'OrgOperations'), orgUsername, `${ScratchOrgService.buildCompactTimestamp(date)}-${operationName}${METADATA_DEPLOY_PACKAGE_XML_SUFFIX}`);

        return SfdxProjectService.isPathContainedInWorkspace(packageXmlFilePath, runArtifactsLocation.workspaceRoot) ? packageXmlFilePath : undefined;

    }

    /*
        Writes the package.xml and answers where, or undefined when it could not. Its folders are
        made by RecipeCockpitRunArtifacts.makeFolder, which follows no link and checks the path
        again once they exist; the file is written with "wx", so a link planted at its name is never
        followed, and two deploys in one second take the first free of <name>, <name>-2, ...
    */
    static writePackageXml(runArtifactsLocation: IRecipeCockpitRunArtifactsLocation, packageXmlFilePath: string, packageXml: string): string | undefined {

        if ( !SfdxProjectService.isPathContainedInWorkspace(packageXmlFilePath, runArtifactsLocation.workspaceRoot)
                || !RecipeCockpitRunArtifacts.makeFolder(runArtifactsLocation, path.dirname(packageXmlFilePath)) ) {
            return undefined;
        }

        return RecipeCockpitRunArtifacts.writeNewFile(packageXmlFilePath, packageXml, METADATA_DEPLOY_PACKAGE_XML_SUFFIX, ORG_OPERATION_RESULT_FILE_ATTEMPTS);

    }

    // THE MANIFEST RELATIVE TO THE WORKSPACE, "/"-SEPARATED: THE CLI RUNS WITH THE WORKSPACE AS ITS cwd
    static toManifestRelativePath(workspaceRoot: string, packageXmlFilePath: string): string {
        return path.relative(path.resolve(workspaceRoot), packageXmlFilePath).split(path.sep).join('/');
    }

    // A --manifest VALUE IS A PLAIN, RELATIVE, "/"-SEPARATED PATH TO A PACKAGE.XML THIS CLASS NAMED; SHARED BY THE RETRIEVES (#382)
    static assertPlainManifestPath(manifestRelativePath: string, failureClause: string = 'nothing was deployed'): void {

        const manifestSegments = String(manifestRelativePath).split('/');

        if ( manifestRelativePath === ''
                || path.isAbsolute(manifestRelativePath)
                || /^[A-Za-z]:/.test(manifestRelativePath)
                || /[\\\0\r\n]/.test(manifestRelativePath)
                || manifestRelativePath.startsWith('-')
                || manifestSegments.some(segment => segment === '' || segment === '.' || segment === '..')
                || !manifestRelativePath.endsWith(METADATA_DEPLOY_PACKAGE_XML_SUFFIX) ) {
            throw new Error(`The package.xml path is not a plain path inside the workspace, so ${failureClause}.`);
        }

    }

    // WHERE THE ZIP GOES: ITS PACKAGE.XML'S NAME WITH THE ZIP'S SUFFIX, IN THE SAME FOLDER
    static buildMetadataZipFilePath(packageXmlFilePath: string): string {
        return `${packageXmlFilePath.slice(0, -METADATA_DEPLOY_PACKAGE_XML_SUFFIX.length)}${METADATA_DEPLOY_ZIP_SUFFIX}`;
    }

    // WRITTEN AS THE PACKAGE.XML IS: "wx", THE FIRST FREE NAME, ONLY INSIDE THE WORKSPACE; ITS FOLDER WAS MADE FOR THE PACKAGE.XML
    static writeMetadataZip(runArtifactsLocation: IRecipeCockpitRunArtifactsLocation, zipFilePath: string, zipContent: Uint8Array): string | undefined {

        if ( !SfdxProjectService.isPathContainedInWorkspace(zipFilePath, runArtifactsLocation.workspaceRoot)
                || !RecipeCockpitRunArtifacts.makeFolder(runArtifactsLocation, path.dirname(zipFilePath)) ) {
            return undefined;
        }

        return RecipeCockpitRunArtifacts.writeNewFile(zipFilePath, zipContent, METADATA_DEPLOY_ZIP_SUFFIX, ORG_OPERATION_RESULT_FILE_ATTEMPTS);

    }

    // A --metadata-dir VALUE: THE SAME PLAIN-PATH RULE AS A MANIFEST'S, ENDING IN THE ZIP'S SUFFIX
    static buildMetadataZipDeployArguments(zipRelativePath: string, orgUsername: string): string[] {

        const zipSegments = String(zipRelativePath).split('/');
        if ( zipRelativePath === ''
                || path.isAbsolute(zipRelativePath)
                || /^[A-Za-z]:/.test(zipRelativePath)
                || /[\\\0\r\n]/.test(zipRelativePath)
                || zipRelativePath.startsWith('-')
                || zipSegments.some(segment => segment === '' || segment === '.' || segment === '..')
                || !zipRelativePath.endsWith(METADATA_DEPLOY_ZIP_SUFFIX) ) {
            throw new Error('The metadata zip path is not a plain path inside the workspace, so nothing was deployed.');
        }
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'deploy', 'start',
            '--json',
            '--target-org', orgUsername,
            '--metadata-dir', zipRelativePath,
            '--single-package'
        ];

    }

    // ERRORS ARE NEVER IGNORED: A DEPLOY THAT CANNOT LAND WHOLE LANDS NOTHING
    static buildMetadataDeployArguments(manifestRelativePath: string, orgUsername: string): string[] {

        this.assertPlainManifestPath(manifestRelativePath);
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(orgUsername);

        return [
            'project', 'deploy', 'start',
            '--json',
            '--target-org', orgUsername,
            '--manifest', manifestRelativePath
        ];

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI is required to deploy metadata, and "${PicklistDependencyCheckService.getSalesforceCliExecutable()}" is not installed or not on PATH. Install it and try again.`;

    }

    /*
        The deploy's answer, type-checked: it landed only on status 0, result.success exactly true
        and no component failure (readDeployComponentCounts). Each component failure is named by
        what the CLI said, so the notification can say which component and why.
    */
    static parseMetadataDeployOutput(invocationResult: ISalesforceCliInvocationResult,
                                        payload: Record<string, unknown> | undefined = ScratchOrgService.readCliJsonPayload(invocationResult)): MetadataDeployOutcome {

        if ( invocationResult.spawnError ) {
            return invocationResult.spawnError.code === 'ENOENT'
                ? { kind: 'cliNotInstalled', failureMessage: this.buildCliRequiredMessage() }
                : { kind: 'failed', failureMessage: `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}`, componentFailureCount: 0, componentFailureMessages: [] };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { kind: 'unconfirmed', failureMessage: 'The Salesforce CLI\'s answer was too large to read, so whether the deploy landed is unknown.' };
        }

        if ( invocationResult.timedOut ) {
            return { kind: 'unconfirmed', failureMessage: 'The deploy did not finish in time and was stopped, so whether it landed is unknown.' };
        }

        return this.parseMetadataDeployPayload(payload, ScratchOrgService.buildCliFailureDetail(payload, invocationResult));

    }

    // A DEPLOY'S ANSWER IN THE CLI'S --json SHAPE, FROM THE CLI OR FROM THE ORG ITSELF (#505)
    static parseMetadataDeployPayload(payload: Record<string, unknown> | undefined, failureMessage: string): MetadataDeployOutcome {

        const deployComponentCounts = ScratchOrgService.readDeployComponentCounts(payload);

        if ( deployComponentCounts.isSucceeded ) {
            return { kind: 'deployed', deployedComponentCount: deployComponentCounts.numberComponentsDeployed ?? deployComponentCounts.componentSuccessCount };
        }

        return {
            kind: 'failed',
            failureMessage: failureMessage,
            componentFailureCount: deployComponentCounts.componentFailureCount,
            componentFailureMessages: this.readComponentFailureMessages(payload)
        };

    }

    static readComponentFailureMessages(payload: Record<string, unknown> | undefined): string[] {

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result) ? payload.result as Record<string, unknown> : undefined;
        const details = result?.details !== null && typeof result?.details === 'object' ? result.details as Record<string, unknown> : undefined;
        const failures = Array.isArray(details?.componentFailures) ? details.componentFailures
            : details?.componentFailures !== null && typeof details?.componentFailures === 'object' ? [details.componentFailures] : [];
        const toSingleLine = (text: string) => text.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim();

        return [...new Set(failures
            .filter((failure): failure is Record<string, unknown> => failure !== null && typeof failure === 'object' && !Array.isArray(failure))
            .map(failure => {
                const fullName = typeof failure.fullName === 'string' ? toSingleLine(failure.fullName) : 'a component';
                const problem = typeof failure.problem === 'string' && failure.problem.trim() !== '' ? toSingleLine(failure.problem) : 'it could not be deployed';
                return `${fullName}: ${ScratchOrgService.redactSecretText(problem)}`;
            }))];

    }

    // A CAPPED LIST, THE REST COUNTED
    static describeCappedList(items: readonly string[], shownCount: number = METADATA_DEPLOY_CONFIRMATION_SHOWN): string {

        const shownItems = items.slice(0, shownCount);
        const hiddenCount = items.length - shownItems.length;

        return `${shownItems.join(', ')}${hiddenCount > 0 ? ` and ${hiddenCount} more` : ''}`;

    }

    // WHAT THE IN-PANEL CONFIRMATION SAYS (#457): EACH VALUE ON ONE LINE, AND WHAT CANNOT BE UNDONE OR IS LEFT OUT AMONG THE WARNINGS, ON SCREEN
    static buildConfirmationContent(deployKind: MetadataDeployKind,
                                    treeLabel: string,
                                    org: IRecipeCockpitConfirmOrg,
                                    packageDirectoryRelativePath: string,
                                    components: readonly IMetadataDeployComponent[],
                                    summary?: IMetadataDeploySummary,
                                    hasFileOrEnvironmentReplacements = false,
                                    fullSetComponents: readonly IMetadataDeployComponent[] = [],
                                    howItDeploysLines: readonly string[] = ['Only these components are deployed, through a generated package.xml.', 'Nothing else in the object folders is.'],
                                    resetNotAppliedReason?: string): IRecipeCockpitConfirmContent {

        const toSingleLine = (text: string) => String(text).replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');
        const warnings: string[] = [];
        const notes: string[] = [];
        const resetLines: string[] = [];

        if ( summary && deployKind === 'fields' ) {
            if ( summary.customObjects.length > 0 ) {
                warnings.push('Deploying a custom object overwrites the org\'s settings for it — its label, sharing model, name field and the rest — with this project\'s version.');
            }
            if ( summary.missingCustomObjects.length > 0 ) {
                warnings.push(`Not deployed: ${summary.missingCustomObjects.length} custom ${summary.missingCustomObjects.length === 1 ? 'object' : 'objects'} not in this project — the org must already have ${summary.missingCustomObjects.length === 1 ? 'it' : 'them'}, or ${summary.missingCustomObjects.length === 1 ? 'its' : 'their'} fields fail: ${this.describeCappedList(summary.missingCustomObjects)}`);
            }
            if ( summary.unreadableCustomObjects.length > 0 ) {
                warnings.push(`Not deployed: ${summary.unreadableCustomObjects.length} custom ${summary.unreadableCustomObjects.length === 1 ? 'object' : 'objects'} whose .object-meta.xml could not be read: ${this.describeCappedList(summary.unreadableCustomObjects)}`);
            }
            if ( summary.customObjects.length + summary.missingCustomObjects.length + summary.unreadableCustomObjects.length === 0 ) {
                notes.push('Every object of this tree is a standard object, so no CustomObject is deployed.');
            }
            if ( summary.standardFields.length > 0 ) {
                notes.push(`Not deployed: standard fields — the org enables these through a feature or setting: ${this.describeCappedList(summary.standardFields)}`);
            }
            if ( summary.unreadableFields.length > 0 ) {
                notes.push(`Not deployed: ${summary.unreadableFields.length} custom ${summary.unreadableFields.length === 1 ? 'field' : 'fields'} whose source file is missing or could not be read: ${this.describeCappedList(summary.unreadableFields)}`);
            }
            // WHAT A DEPLOYED OBJECT NAMES THAT THE ORG MAY LACK (#547)
            const resetCount = summary.objectReferenceResets.length;
            if ( resetCount > 0 && resetNotAppliedReason === undefined ) {
                warnings.push(`${resetCount} ${resetCount === 1 ? 'reference' : 'references'} a custom object makes to a page or compact layout this deploy does not carry ${resetCount === 1 ? 'is' : 'are'} set back to the standard one in the deployed copy; this project's files are not changed.`);
            }
            if ( resetCount > 0 && resetNotAppliedReason !== undefined ) {
                warnings.push(`${resetCount} ${resetCount === 1 ? 'reference' : 'references'} a custom object makes to a page or compact layout this deploy does not carry could not be set back, because ${toSingleLine(resetNotAppliedReason)}: the org must already have ${resetCount === 1 ? 'it' : 'them'}, or the object fails.`);
            }
            resetLines.push(...summary.objectReferenceResets.map(reset => toSingleLine(`${reset.objectApiName}: ${reset.reference} — ${reset.reason}`)));
            if ( summary.outOfTreeLookups.length > 0 ) {
                warnings.push(`${summary.outOfTreeLookups.length} ${summary.outOfTreeLookups.length === 1 ? 'lookup points' : 'lookups point'} to a custom object this deploy does not carry — the org must already have it, or the field fails: ${this.describeCappedList(summary.outOfTreeLookups)}`);
            }
        }

        if ( summary && deployKind === 'globalValueSets' && summary.missingGlobalValueSets.length > 0 ) {
            notes.push(`Not deployed: ${summary.missingGlobalValueSets.length} global value ${summary.missingGlobalValueSets.length === 1 ? 'set' : 'sets'} a field names that this project does not hold: ${this.describeCappedList(summary.missingGlobalValueSets)}`);
        }

        if ( summary && summary.skippedNameCount > 0 ) {
            notes.push(`Skipped: ${summary.skippedNameCount} ${summary.skippedNameCount === 1 ? 'name that is' : 'names that are'} not a Salesforce api name.`);
        }

        if ( hasFileOrEnvironmentReplacements ) {
            warnings.push('sfdx-project.json has "replacements" that copy local files or environment variables into the deployed metadata.');
        }

        return {
            summary: [
                `Tree: ${toSingleLine(treeLabel)}`,
                `From: ${toSingleLine(packageDirectoryRelativePath)}`
            ],
            org: org,
            warnings: warnings,
            sections: [
                { title: 'Components', count: components.length, lines: this.describeComponentsByType(components) },
                { title: 'Not deployed', lines: notes },
                { title: resetNotAppliedReason === undefined ? 'Set back to the standard one in the deployed copy' : 'Could not be set back', count: resetLines.length, lines: resetLines },
                { title: 'Ticking the box below also deploys, in the same package.xml', count: fullSetComponents.length, lines: this.describeComponentsByType(fullSetComponents) },
                { title: 'How it deploys', lines: [...howItDeploysLines] }
            ]
        };

    }

    // A fields OR recordTypes FOLDER THAT IS A LINK IS NEVER LISTED: ITS FILES COULD BE ANYWHERE
    static listSubfolderEntries(objectFolderPath: string, subfolderName: string): fs.Dirent[] {

        const subfolderPath = path.join(objectFolderPath, subfolderName);

        try {
            if ( !fs.lstatSync(subfolderPath).isDirectory() ) {
                return [];
            }
        } catch {
            return [];
        }

        return this.listEntries(subfolderPath);

    }

    static listEntries(folderPath: string): fs.Dirent[] {
        try {
            return fs.readdirSync(folderPath, { withFileTypes: true });
        } catch {
            return [];
        }
    }

}
