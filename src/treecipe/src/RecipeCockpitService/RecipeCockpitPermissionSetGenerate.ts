import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { PERMISSION_SET_FILE_SUFFIX } from './RecipeCockpitPermissionSetAssign';

/*
    "Generate permission set…" (#306): one permission set per relationship tree, granting Create and
    Read on every object the tree inserts and field-level access to the recipe's fields, written into
    the project for the reader to deploy with their own flow. Nothing here deploys: the cockpit
    deploys no metadata (#302). It imports no vscode -- the cockpit owns the confirmation, the write
    and the notification.

    Salesforce refuses a deploy that names a required or master-detail field in fieldPermissions,
    and a formula field is never editable -- and the objects wrapper records none of that, a formula
    keeping its result type. So each field's access is read from its SOURCE XML when the permission
    set is generated, which also keeps an older run usable.
*/

export const PERMISSION_SET_GENERATED_NAME_PREFIX = 'SDT_';

// A SUBFOLDER OF permissionsets/, NEVER ITS FIRST LEVEL: THE CLI FINDS A PERMISSION SET BY ITS SUFFIX IN ANY FOLDER UNDER A PACKAGE DIRECTORY
export const PERMISSION_SET_GENERATED_FOLDER_NAME = 'SDT_Treecipe';

export const PERMISSION_SET_NAME_MAX_LENGTH = 80;

export const PERMISSION_SET_LABEL_MAX_LENGTH = 80;

// HOW DEEP UNDER THE CONFIGURED OBJECTS PATH AN OBJECT'S FOLDER IS LOOKED FOR
export const PERMISSION_SET_OBJECT_SEARCH_DEPTH = 8;

const FIELD_FILE_SUFFIX = '.field-meta.xml';

// TYPES WHOSE VALUE THE ORG COMPUTES: READABLE, NEVER EDITABLE
const READ_ONLY_FIELD_TYPES = new Set(['AutoNumber', 'Summary']);

// FIELDS SALESFORCE REFUSES IN fieldPermissions: ACCESS FOLLOWS THE PARENT, OR THE FIELD IS ALWAYS VISIBLE
const NO_FIELD_PERMISSION_TYPES = new Set(['MasterDetail']);

/*
    A STANDARD field's source XML, as a retrieve writes it, leaves <required> out even where the org
    requires it (Contact.LastName, Opportunity.StageName), so silence there says nothing. A standard
    field is granted only when its XML says <required>false</required>; otherwise it is
    'requiredUnknown', left out and counted, because a required field fails the reader's deploy.
*/
export type GeneratedFieldAccess = 'editable' | 'readOnly' | 'notGrantable' | 'requiredUnknown' | 'unreadable';

// CUSTOM FIELDS, NAMESPACED OR NOT, AND A PERSON ACCOUNT'S CUSTOM CONTACT FIELDS
const CUSTOM_FIELD_NAME_PATTERN = /__(c|pc)$/i;

export interface IPermissionSetGenerateObject {
    objectApiName: string;
    fieldApiNames: string[];
}

export interface IGeneratedFieldPermission {
    // "<Object>.<Field>", AS fieldPermissions NAMES IT
    field: string;
    isEditable: boolean;
}

export interface IPermissionSetGeneratePlan {
    objectApiNames: string[];
    fieldPermissions: IGeneratedFieldPermission[];
    // OBJECT OR FIELD NAMES THAT ARE NOT API NAMES, SO NOTHING WAS GRANTED FOR THEM
    skippedNameCount: number;
    // FIELDS WHOSE SOURCE XML WAS NOT FOUND OR NOT A <CustomField>
    unreadableFieldCount: number;
    // REQUIRED AND MASTER-DETAIL FIELDS, WHICH SALESFORCE REFUSES IN fieldPermissions
    notGrantableFieldCount: number;
    // STANDARD FIELDS WHOSE SOURCE XML DOES NOT SAY THEY ARE NOT REQUIRED
    requiredUnknownFieldCount: number;
}

export class RecipeCockpitPermissionSetGenerate {

    /*
        SDT_ and the tree's folder name with every character outside [A-Za-z0-9] made "_", runs of
        "_" collapsed and the ends trimmed, cut to 80. Undefined when what is left is not a name
        Salesforce takes: an api name with no "__" and no trailing "_".
    */
    static buildPermissionSetName(treeFolderName: string): string | undefined {

        const cleanedFolderName = String(treeFolderName)
            .replace(/[^A-Za-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');

        if ( cleanedFolderName === '' ) {
            return undefined;
        }

        const permissionSetName = `${PERMISSION_SET_GENERATED_NAME_PREFIX}${cleanedFolderName}`
            .slice(0, PERMISSION_SET_NAME_MAX_LENGTH)
            .replace(/_+$/, '');

        return this.isPermissionSetName(permissionSetName) ? permissionSetName : undefined;

    }

    static isPermissionSetName(name: unknown): name is string {

        return SalesforceApiName.isApiName(name)
            && name.length <= PERMISSION_SET_NAME_MAX_LENGTH
            && !name.includes('__')
            && !name.endsWith('_');

    }

    // ONE LINE, NO CONTROL CHARACTER XML 1.0 REFUSES, CUT TO 80 -- ESCAPED WHEN THE XML IS BUILT
    static buildPermissionSetLabel(treeLabel: string, permissionSetName: string): string {

        return ( this.toSingleLine(treeLabel) || permissionSetName ).slice(0, PERMISSION_SET_LABEL_MAX_LENGTH).trim();

    }

    static toSingleLine(text: string): string {

        return String(text)
            .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

    }

    /*
        The package directory sfdx-project.json marks default (else its first), through the STRICT
        read the assign flow uses, so a project the assign button cannot read is refused here too
        and a generated file is always one that button can find. Throws with the reason.
    */
    static resolveDefaultPackageDirectoryPath(workspaceRoot: string): string {

        const packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);
        const packageDirectories: unknown = SfdxProjectService.readSfdxProjectJson(SfdxProjectService.getSfdxProjectFilePath(workspaceRoot))?.packageDirectories;
        const defaultIndex = Array.isArray(packageDirectories)
            ? packageDirectories.findIndex(packageDirectory => packageDirectory?.default === true)
            : -1;

        return path.resolve(workspaceRoot, packageDirectoryPaths[defaultIndex >= 0 ? defaultIndex : 0]);

    }

    static getPermissionSetFilePath(packageDirectoryPath: string, permissionSetName: string): string {
        return path.join(packageDirectoryPath, 'main', 'default', 'permissionsets', PERMISSION_SET_GENERATED_FOLDER_NAME, `${permissionSetName}${PERMISSION_SET_FILE_SUFFIX}`);
    }

    // PUT ON THE CLIPBOARD FOR THE READER, NEVER RUN BY THE EXTENSION
    static buildDeployCommand(permissionSetName: string): string {
        return `sf project deploy start --metadata PermissionSet:${permissionSetName}`;
    }

    /*
        Each object's "fields" folder under the configured objects path: a folder named exactly as
        the object that holds a "fields" folder, as Generate Treecipe's walk recognises one. Folders
        are visited in name order, so the first match is the same on every machine.
    */
    static findObjectFieldsDirectoryPaths(objectsDirectoryPath: string, objectApiNames: readonly string[]): Map<string, string> {

        const wantedObjectApiNames = new Set(objectApiNames);
        const fieldsDirectoryPathsByObject = new Map<string, string>();
        const visitedFolderPaths = new Set<string>();

        const walk = (folderPath: string, depth: number) => {

            if ( visitedFolderPaths.has(folderPath) || fieldsDirectoryPathsByObject.size === wantedObjectApiNames.size ) {
                return;
            }
            visitedFolderPaths.add(folderPath);

            let folderEntries: fs.Dirent[];
            try {
                folderEntries = fs.readdirSync(folderPath, { withFileTypes: true });
            } catch {
                return;
            }

            const folderName = path.basename(folderPath);
            // AN OBJECT FOLDER HOLDS NO OTHER OBJECT, SO ITS CHILDREN ARE NEVER WALKED, WANTED OR NOT
            if ( folderEntries.some(folderEntry => folderEntry.isDirectory() && folderEntry.name === 'fields') ) {
                if ( wantedObjectApiNames.has(folderName) && !fieldsDirectoryPathsByObject.has(folderName) ) {
                    fieldsDirectoryPathsByObject.set(folderName, path.join(folderPath, 'fields'));
                }
                return;
            }

            if ( depth >= PERMISSION_SET_OBJECT_SEARCH_DEPTH ) {
                return;
            }

            folderEntries
                .filter(folderEntry => folderEntry.isDirectory() && !folderEntry.name.startsWith('.') && folderEntry.name !== 'node_modules')
                .map(folderEntry => folderEntry.name)
                .sort((first, second) => first < second ? -1 : 1)
                .forEach(childName => walk(path.join(folderPath, childName), depth + 1));

        };

        walk(path.resolve(objectsDirectoryPath), 0);

        return fieldsDirectoryPathsByObject;

    }

    static async readFieldAccess(fieldXml: string, fieldApiName: string): Promise<GeneratedFieldAccess> {

        const isStandardField = !CUSTOM_FIELD_NAME_PATTERN.test(fieldApiName);

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(fieldXml);
        } catch {
            return 'unreadable';
        }

        const customField = ( parsedXml as Record<string, unknown> | null )?.CustomField;
        if ( typeof customField === 'string' ) {
            return isStandardField ? 'requiredUnknown' : 'editable';
        }
        if ( !customField || typeof customField !== 'object' ) {
            return 'unreadable';
        }

        const readText = (elementName: string): string | undefined => {
            const values = ( customField as Record<string, unknown> )[elementName];
            const firstValue = Array.isArray(values) ? values[0] : undefined;
            return typeof firstValue === 'string' ? firstValue.trim() : undefined;
        };

        const fieldType = readText('type');

        if ( readText('required')?.toLowerCase() === 'true' || ( fieldType !== undefined && NO_FIELD_PERMISSION_TYPES.has(fieldType) ) ) {
            return 'notGrantable';
        }

        if ( isStandardField && readText('required')?.toLowerCase() !== 'false' ) {
            return 'requiredUnknown';
        }

        if ( ( fieldType !== undefined && READ_ONLY_FIELD_TYPES.has(fieldType) ) || readText('formula') !== undefined ) {
            return 'readOnly';
        }

        return 'editable';

    }

    /*
        What the permission set grants: every object, and each field whose source XML says it can be
        granted -- editable unless the org computes its value. A field with no readable XML is left
        out and counted rather than guessed at, since a wrong guess fails the reader's deploy.
        Sorted with "<", never localeCompare, so a regeneration is byte for byte the same anywhere.
    */
    static async buildPermissionSetPlan(objectsDirectoryPath: string, generateObjects: readonly IPermissionSetGenerateObject[]): Promise<IPermissionSetGeneratePlan> {

        const plan: IPermissionSetGeneratePlan = { objectApiNames: [], fieldPermissions: [], skippedNameCount: 0, unreadableFieldCount: 0, notGrantableFieldCount: 0, requiredUnknownFieldCount: 0 };
        const fieldApiNamesByObject = new Map<string, Set<string>>();

        generateObjects.forEach(generateObject => {

            if ( !SalesforceApiName.isApiName(generateObject.objectApiName) ) {
                plan.skippedNameCount++;
                return;
            }

            const fieldApiNames = fieldApiNamesByObject.get(generateObject.objectApiName) ?? new Set<string>();
            fieldApiNamesByObject.set(generateObject.objectApiName, fieldApiNames);

            generateObject.fieldApiNames.forEach(fieldApiName => {
                if ( SalesforceApiName.isApiName(fieldApiName) ) {
                    fieldApiNames.add(fieldApiName);
                } else {
                    plan.skippedNameCount++;
                }
            });

        });

        const byName = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
        plan.objectApiNames = [...fieldApiNamesByObject.keys()].sort(byName);
        const fieldsDirectoryPathsByObject = this.findObjectFieldsDirectoryPaths(objectsDirectoryPath, plan.objectApiNames);

        for ( const objectApiName of plan.objectApiNames ) {

            const fieldsDirectoryPath = fieldsDirectoryPathsByObject.get(objectApiName);

            for ( const fieldApiName of [...( fieldApiNamesByObject.get(objectApiName) ?? [] )].sort(byName) ) {

                let fieldAccess: GeneratedFieldAccess = 'unreadable';
                if ( fieldsDirectoryPath ) {
                    try {
                        fieldAccess = await this.readFieldAccess(fs.readFileSync(path.join(fieldsDirectoryPath, `${fieldApiName}${FIELD_FILE_SUFFIX}`), 'utf8'), fieldApiName);
                    } catch {
                        fieldAccess = 'unreadable';
                    }
                }

                if ( fieldAccess === 'unreadable' ) {
                    plan.unreadableFieldCount++;
                } else if ( fieldAccess === 'notGrantable' ) {
                    plan.notGrantableFieldCount++;
                } else if ( fieldAccess === 'requiredUnknown' ) {
                    plan.requiredUnknownFieldCount++;
                } else {
                    plan.fieldPermissions.push({ field: `${objectApiName}.${fieldApiName}`, isEditable: fieldAccess === 'editable' });
                }

            }

        }

        return plan;

    }

    static escapeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

    }

    // ELEMENTS IN THE ORDER retrieve WRITES THEM, SO A RETRIEVE OF THE DEPLOYED SET SHOWS NO DIFFERENCE
    static buildPermissionSetXml(permissionSetLabel: string, treeFolderName: string, plan: IPermissionSetGeneratePlan): string {

        const description = this.toSingleLine(`Generated by Salesforce Data Treecipe for the tree ${treeFolderName}: Create and Read on its objects.`).slice(0, 255);

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">',
            `    <description>${this.escapeXmlText(description)}</description>`,
            ...plan.fieldPermissions.flatMap(fieldPermission => [
                '    <fieldPermissions>',
                `        <editable>${fieldPermission.isEditable}</editable>`,
                `        <field>${fieldPermission.field}</field>`,
                '        <readable>true</readable>',
                '    </fieldPermissions>'
            ]),
            '    <hasActivationRequired>false</hasActivationRequired>',
            `    <label>${this.escapeXmlText(permissionSetLabel)}</label>`,
            ...plan.objectApiNames.flatMap(objectApiName => [
                '    <objectPermissions>',
                '        <allowCreate>true</allowCreate>',
                '        <allowDelete>false</allowDelete>',
                '        <allowEdit>false</allowEdit>',
                '        <allowRead>true</allowRead>',
                '        <modifyAllRecords>false</modifyAllRecords>',
                `        <object>${objectApiName}</object>`,
                '        <viewAllRecords>false</viewAllRecords>',
                '    </objectPermissions>'
            ]),
            '</PermissionSet>',
            ''
        ].join('\n');

    }

}
