import * as fs from 'fs';
import * as path from 'path';

import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

/*
    Where a tree's run files live (#470): GeneratedRecipes/<run>/<tree folder>/RunArtifacts/<kind>/,
    beside the recipe they were made for, so the recipe and everything done to get its data into an
    org are in one place. A regeneration writes a new run folder, so the files of one run stay with
    the recipe they were made with. Runs not tied to a tree (scratch org creation) stay in
    treecipe/OrgOperations, and so do the files written there before this change.

    Every file here can hold org data or a CLI answer, so the folder gets a .gitignore of "*",
    written "wx" and read back rather than trusted. Every folder on the way from the tree folder is
    made one segment at a time and checked not to be a link, and the whole path is held to the
    workspace before and after it is made. Imports no vscode.
*/

export const RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME = 'RunArtifacts';

export type RecipeCockpitRunArtifactKind = 'OrgOperations' | 'UpdateAttempts' | 'QueryResults' | 'PermissionSets';

export const RECIPE_COCKPIT_RUN_ARTIFACTS_NOT_GIT_IGNORED_NOTE = 'The tree\'s RunArtifacts/.gitignore does not ignore everything in that folder, so these files of org data could be committed: check them before you commit.';

// WHERE ONE TREE'S RUN FILES GO: THE TREE FOLDER, AND RunArtifacts INSIDE IT
export interface IRecipeCockpitRunArtifactsLocation {
    workspaceRoot: string;
    treeFolderPath: string;
    folderPath: string;
}

export class RecipeCockpitRunArtifacts {

    // ONE PLAIN SEGMENT: NOT EMPTY, NOT "." OR "..", NO SEPARATOR OF EITHER PLATFORM AND NO NUL
    static isPlainFolderName(folderName: unknown): folderName is string {

        return typeof folderName === 'string'
                && folderName !== ''
                && folderName !== '.'
                && folderName !== '..'
                && !/[\\/\0]/.test(folderName);

    }

    // A FOLDER EVERY RECIPE WALKER SKIPS: IT HOLDS RUN FILES, NEVER A RECIPE OR A TREE
    static isRunArtifactsFolderName(folderName: string): boolean {

        return folderName === RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME;

    }

    /*
        The tree's location, or undefined when a name is not plain, the tree folder is not a folder
        (a link included) or anything would land outside the workspace. Nothing is made here.
    */
    static resolveTreeLocation(workspaceRoot: string,
                                generatedRecipesFolderPath: string,
                                runFolderName: unknown,
                                treeFolderName: unknown): IRecipeCockpitRunArtifactsLocation | undefined {

        if ( !this.isPlainFolderName(runFolderName) || !this.isPlainFolderName(treeFolderName) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const runFolderPath = path.join(path.resolve(generatedRecipesFolderPath), runFolderName);
        const treeFolderPath = path.join(runFolderPath, treeFolderName);

        if ( !this.isRealFolder(runFolderPath) || !this.isRealFolder(treeFolderPath) ) {
            return undefined;
        }

        if ( !SfdxProjectService.isPathContainedInWorkspace(treeFolderPath, resolvedWorkspaceRoot) ) {
            return undefined;
        }

        return {
            workspaceRoot: resolvedWorkspaceRoot,
            treeFolderPath: treeFolderPath,
            folderPath: path.join(treeFolderPath, RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME)
        };

    }

    // <RunArtifacts>/<kind>: A CALLER JOINS ONLY NAMES IT HAS HELD TO A PLAIN FOLDER NAME, AND makeFolder REFUSES ANY OTHER
    static buildKindFolderPath(location: IRecipeCockpitRunArtifactsLocation, kind: RecipeCockpitRunArtifactKind): string {

        return path.join(location.folderPath, kind);

    }

    /*
        Makes every folder from the tree folder down to folderPath, one segment at a time, refusing a
        segment that is there and is not a real folder (a link to a folder included), writes the
        .gitignore, and answers whether folderPath is now a folder inside the workspace. A path that
        is not under the location's RunArtifacts folder makes nothing.
    */
    static makeFolder(location: IRecipeCockpitRunArtifactsLocation, folderPath: string): boolean {

        const relativePath = path.relative(location.treeFolderPath, folderPath);
        const segments = relativePath === '' ? [] : relativePath.split(path.sep);

        if ( segments.length === 0
                || segments[0] !== RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME
                || path.isAbsolute(relativePath)
                || !segments.every(segment => this.isPlainFolderName(segment)) ) {
            return false;
        }

        if ( !this.isRealFolder(location.treeFolderPath)
                || !SfdxProjectService.isPathContainedInWorkspace(location.treeFolderPath, location.workspaceRoot) ) {
            return false;
        }

        let currentFolderPath = location.treeFolderPath;

        for ( const segment of segments ) {
            currentFolderPath = path.join(currentFolderPath, segment);
            try {
                fs.mkdirSync(currentFolderPath);
            } catch (makeError) {
                if ( ( makeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return false;
                }
            }
            if ( !this.isRealFolder(currentFolderPath) ) {
                return false;
            }
            if ( currentFolderPath === location.folderPath ) {
                this.writeGitignore(location);
            }
        }

        // AGAIN ONCE THE FOLDERS EXIST: A LINK SWAPPED IN BETWEEN THE CHECKS STILL CANNOT TAKE A WRITE OUTSIDE
        return SfdxProjectService.isPathContainedInWorkspace(folderPath, location.workspaceRoot);

    }

    // ORG DATA AND CLI ANSWERS ARE NOT FOR A COMMIT: WRITTEN ONCE, NEVER OVER A FILE ALREADY THERE
    static writeGitignore(location: IRecipeCockpitRunArtifactsLocation) {

        try {
            fs.writeFileSync(path.join(location.folderPath, '.gitignore'), '*\n', { encoding: 'utf-8', flag: 'wx' });
        } catch {
            // ALREADY THERE -- OR NOT WRITABLE, WHICH THE RUN FILE'S OWN WRITE WILL SAY
        }

    }

    // WHETHER THE TREE'S RunArtifacts/.gitignore STILL IGNORES EVERYTHING, READ BACK RATHER THAN TRUSTED
    static isGitIgnored(location: IRecipeCockpitRunArtifactsLocation): boolean {

        return this.isFolderWhollyGitIgnored(location.folderPath);

    }

    // WHETHER THE .gitignore IN A FOLDER IS A PLAIN FILE WHOSE LINES IGNORE EVERYTHING ("*") AND UN-IGNORE NOTHING ("!")
    static isFolderWhollyGitIgnored(folderPath: string): boolean {

        const gitignoreFilePath = path.join(folderPath, '.gitignore');

        try {
            if ( !fs.lstatSync(gitignoreFilePath).isFile() ) {
                return false;
            }
            const ignoreLines = fs.readFileSync(gitignoreFilePath, 'utf-8').split(/\r?\n/).map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'));
            return ignoreLines.includes('*') && !ignoreLines.some(line => line.startsWith('!'));
        } catch {
            return false;
        }

    }

    /*
        Whether a run file is in a RunArtifacts folder git does not wholly ignore: the nearest
        folder named RunArtifacts above it, read back. A file under no such folder is not one of a
        tree's run files and answers false.
    */
    static isRunFileExposedToGit(filePath: string): boolean {

        let folderPath = path.dirname(path.resolve(filePath));

        while ( path.dirname(folderPath) !== folderPath ) {
            if ( this.isRunArtifactsFolderName(path.basename(folderPath)) ) {
                return !this.isFolderWhollyGitIgnored(folderPath);
            }
            folderPath = path.dirname(folderPath);
        }

        return false;

    }

    /*
        Writes text to the first free of <filePath>, <name>-2<extension>, ... ("wx", so a file or a
        link already at a name is never written through) and answers the path written, or
        undefined. The folder must already be made by makeFolder.
    */
    static writeNewFile(filePath: string, content: string | Uint8Array, extension: string, attempts: number): string | undefined {

        for ( let attempt = 1; attempt <= attempts; attempt++ ) {
            const attemptFilePath = attempt === 1 ? filePath : `${filePath.slice(0, -extension.length)}-${attempt}${extension}`;
            try {
                fs.writeFileSync(attemptFilePath, content, { encoding: 'utf-8', flag: 'wx' });
                return attemptFilePath;
            } catch (writeError) {
                if ( ( writeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    private static isRealFolder(folderPath: string): boolean {

        try {
            return fs.lstatSync(folderPath).isDirectory();
        } catch {
            return false;
        }

    }

}
