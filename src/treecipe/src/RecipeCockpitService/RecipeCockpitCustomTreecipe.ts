import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';

/*
    "Customize and create new recipe" (#677): the names a custom tree is saved under and the
    customTreecipe.json beside its recipe. No vscode and no file system: the host plans with these,
    checks every path, and writes.

    A custom tree is a tree folder named "custom-" plus the ORIGINAL generated tree's folder name, in
    the same run as its source. A second copy takes the first free "-2", "-3", ...; customizing a
    custom tree copies it under its original's name again, never "custom-custom-". A run loads with
    its custom folders left out, because a run keeps one view model per object and a custom recipe
    holds the same objects again; each custom folder is its own entry in the run picker instead.
*/

export const RECIPE_COCKPIT_CUSTOM_TREE_FOLDER_PREFIX = 'custom-';
// DirectoryProcessor'S faker-js RECIPE PREFIX (VSCodeWorkspaceService's FAKER_JS_RECIPE_INDICATOR), KEPT HERE SO THIS FILE STAYS vscode-FREE
const RECIPE_COCKPIT_FAKER_JS_RECIPE_PREFIX = 'recipe-fakerjs';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_FILE_NAME = 'customTreecipe.json';
export const RECIPE_COCKPIT_CUSTOM_TREECIPE_VERSION = 1;
export const RECIPE_COCKPIT_CUSTOM_TREE_NAME_MAX_LENGTH = 80;
// A RUN HOLDS A HANDFUL OF TREES; A FOLDER THIS FULL OF COPIES IS A LOOP OR A HAND-MADE MESS, NOT A READER SAVING
export const RECIPE_COCKPIT_CUSTOM_TREE_MAX_COPIES = 999;

const CUSTOM_TREE_COPY_SUFFIX_PATTERN = /-([2-9]|[1-9]\d+)$/;
const TREE_FOLDER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface ICustomTreecipeRemovedFields {
    objectApiName: string;
    fieldApiNames: string[];
}

// NAMES ONLY, NEVER A PATH: THE FILE ARRIVES WITH A CLONED REPOSITORY AND IS READ BACK AS UNTRUSTED
export interface ICustomTreecipeDefinition {
    version: number;
    sourceRunFolderName: string;
    sourceTreeFolderName: string;
    sourceRecipeFileName: string;
    originalTreeFolderName: string;
    removedObjectApiNames: string[];
    removedFields: ICustomTreecipeRemovedFields[];
    outOfRunObjectApiNames: string[];
    name?: string;
    savedAt: string;
}

export class RecipeCockpitCustomTreecipe {

    static isCustomTreeFolderName(folderName: string): boolean {
        return folderName.startsWith(RECIPE_COCKPIT_CUSTOM_TREE_FOLDER_PREFIX) && folderName.length > RECIPE_COCKPIT_CUSTOM_TREE_FOLDER_PREFIX.length;
    }

    // A TREE FOLDER NAME RelationshipService WRITES: AN API NAME, OR API NAMES JOINED BY "-thru-" / "-ONLY"; NOTHING THAT CAN STEP OUT OF THE RUN FOLDER
    static isTreeFolderName(folderName: string): boolean {
        return TREE_FOLDER_NAME_PATTERN.test(folderName) && !folderName.includes('..');
    }

    /*
        The generated tree a custom tree descends from: what its customTreecipe.json records, or,
        when that file is missing or unreadable, its own folder name with "custom-" and a "-N" copy
        number taken off. A generated tree is its own original.
    */
    static resolveOriginalTreeFolderName(treeFolderName: string, definition?: ICustomTreecipeDefinition): string {

        if ( !this.isCustomTreeFolderName(treeFolderName) ) {
            return treeFolderName;
        }
        if ( definition ) {
            return definition.originalTreeFolderName;
        }

        return treeFolderName.slice(RECIPE_COCKPIT_CUSTOM_TREE_FOLDER_PREFIX.length).replace(CUSTOM_TREE_COPY_SUFFIX_PATTERN, '');

    }

    // THE FIRST FREE "custom-<original>", THEN "-2", "-3", ...; undefined ONLY PAST THE COPY LIMIT
    static planCustomTreeFolderName(originalTreeFolderName: string, takenFolderNames: ReadonlySet<string>): string | undefined {

        const baseFolderName = `${RECIPE_COCKPIT_CUSTOM_TREE_FOLDER_PREFIX}${originalTreeFolderName}`;
        if ( !takenFolderNames.has(baseFolderName) ) {
            return baseFolderName;
        }

        for ( let copyNumber = 2; copyNumber <= RECIPE_COCKPIT_CUSTOM_TREE_MAX_COPIES; copyNumber++ ) {
            const candidateFolderName = `${baseFolderName}-${copyNumber}`;
            if ( !takenFolderNames.has(candidateFolderName) ) {
                return candidateFolderName;
            }
        }

        return undefined;

    }

    // Generate Treecipe's own stamp, "2024-11-25T16-24-15" in UTC, so the file reads like every recipe beside it
    static buildRecipeTimestamp(savedAt: Date): string {
        return savedAt.toISOString().split('.')[0].replace(/:/g, '-');
    }

    /*
        "<prefix>--<custom folder>-<stamp><extension>", the prefix and extension the source recipe's
        own: Generate Treecipe names a faker-js recipe "recipe-fakerjs--" and a snowfakery one
        "recipe--", and Run Faker and the insert tell the two apart by that name.
    */
    static buildRecipeFileName(customTreeFolderName: string, sourceRecipeFileName: string, savedAt: Date): string {
        const sourcePrefix = sourceRecipeFileName.split('--')[0];
        const recipePrefix = sourcePrefix === RECIPE_COCKPIT_FAKER_JS_RECIPE_PREFIX ? RECIPE_COCKPIT_FAKER_JS_RECIPE_PREFIX : 'recipe';
        const extensionMatch = /\.[A-Za-z]+$/.exec(sourceRecipeFileName);
        return `${recipePrefix}--${customTreeFolderName}-${this.buildRecipeTimestamp(savedAt)}${extensionMatch ? extensionMatch[0] : '.yml'}`;
    }

    // ONE LINE, TRIMMED, NO CONTROL CHARACTER, AT MOST 80 CHARACTERS; undefined FOR NO NAME
    static normalizeCustomTreeName(name: string): string | undefined {
        const trimmedName = name.trim();
        if ( trimmedName === '' || trimmedName.length > RECIPE_COCKPIT_CUSTOM_TREE_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(trimmedName) ) {
            return undefined;
        }
        return trimmedName;
    }

    static buildDefinitionText(definition: ICustomTreecipeDefinition): string {
        return `${JSON.stringify(definition, null, 4)}\n`;
    }

    /*
        A customTreecipe.json as read back: every field type-checked, every name an api name or a
        tree folder name, with no prototype on anything built from it. Anything else is undefined, and
        the custom tree loads from its recipe alone.
    */
    static readDefinition(definitionText: string): ICustomTreecipeDefinition | undefined {

        let parsedDefinition: unknown;
        try {
            parsedDefinition = JSON.parse(definitionText);
        } catch {
            return undefined;
        }

        if ( !this.isPlainRecord(parsedDefinition) || parsedDefinition.version !== RECIPE_COCKPIT_CUSTOM_TREECIPE_VERSION ) {
            return undefined;
        }

        const { sourceRunFolderName, sourceTreeFolderName, sourceRecipeFileName, originalTreeFolderName, removedObjectApiNames, removedFields, outOfRunObjectApiNames, name, savedAt } = parsedDefinition;
        const isApiNameList = (candidate: unknown): candidate is string[] => Array.isArray(candidate)
            && candidate.every(entry => typeof entry === 'string' && SalesforceApiName.isApiName(entry));

        if ( typeof sourceRunFolderName !== 'string' || !this.isTreeFolderName(sourceRunFolderName)
                || typeof sourceTreeFolderName !== 'string' || !this.isTreeFolderName(sourceTreeFolderName)
                || typeof sourceRecipeFileName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(sourceRecipeFileName) || sourceRecipeFileName.includes('..')
                || typeof originalTreeFolderName !== 'string' || !this.isTreeFolderName(originalTreeFolderName) || this.isCustomTreeFolderName(originalTreeFolderName)
                || !isApiNameList(removedObjectApiNames)
                || !isApiNameList(outOfRunObjectApiNames)
                || !Array.isArray(removedFields)
                || !removedFields.every(entry => this.isPlainRecord(entry) && typeof entry.objectApiName === 'string' && SalesforceApiName.isApiName(entry.objectApiName) && isApiNameList(entry.fieldApiNames))
                || ( name !== undefined && ( typeof name !== 'string' || this.normalizeCustomTreeName(name) !== name ) )
                || typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt)) ) {
            return undefined;
        }

        return {
            version: RECIPE_COCKPIT_CUSTOM_TREECIPE_VERSION,
            sourceRunFolderName: sourceRunFolderName,
            sourceTreeFolderName: sourceTreeFolderName,
            sourceRecipeFileName: sourceRecipeFileName,
            originalTreeFolderName: originalTreeFolderName,
            removedObjectApiNames: [...removedObjectApiNames],
            removedFields: (removedFields as Array<Record<string, unknown>>).map(entry => ({ objectApiName: entry.objectApiName as string, fieldApiNames: [...(entry.fieldApiNames as string[])] })),
            outOfRunObjectApiNames: [...outOfRunObjectApiNames],
            ...( typeof name === 'string' ? { name: name } : {} ),
            savedAt: savedAt
        };

    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) && Object.getPrototypeOf(candidate) === Object.prototype;
    }

}
