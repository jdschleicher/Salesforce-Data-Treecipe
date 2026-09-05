import * as fs from 'fs';
import * as path from 'path';

/*
    packageDirectories entries come from a file in the user's repository, so every field is typed as
    the JSON allows rather than as a well formed project would have it -- path is narrowed at the
    point of use instead of being trusted to be a string here.
*/
export interface ISfdxPackageDirectory {
    path?: unknown;
    default?: unknown;
}

export interface ISfdxProjectJson {
    packageDirectories?: unknown;
    sourceApiVersion?: unknown;
    [additionalProjectKey: string]: unknown;
}

/*
    The result of a TOLERANT read of sfdx-project.json.

    Deliberately separate from PicklistDependencyTestService.resolveDefaultPackageDirectoryPath,
    which throws on every one of these cases because the commands that write Apex cannot proceed
    without a package directory. Config initiation can: a user who is not in a DX project still
    gets the full workspace walk, so every failure here degrades to an empty list rather than an
    error. unreadableProjectFileMessage is the one case worth telling the user about -- a project
    file that IS there and cannot be parsed is a typo they want to know about, not an absence.
*/
export interface IResolvedPackageDirectories {
    packageDirectoryPaths: string[];
    unreadableProjectFileMessage?: string;
}

/*
    A leaf node on purpose: fs and path only, no vscode and no other service.

    VSCodeWorkspaceService needs the containment logic that already lived in
    PicklistDependencyTestService, but importing that service would close the cycle
    VSCodeWorkspaceService -> PicklistDependencyTestService -> RecipeService ->
    ErrorHandlingService -> VSCodeWorkspaceService.

    What that buys is the cycle and this module graph's weight, NOT a startup saving: extension.ts
    imports ExtensionCommandService, which imports @salesforce/core at the top level, so that
    dependency loads on the first command whatever this service does.
*/
export class SfdxProjectService {

    static getSfdxProjectFilePath(workspaceRoot: string): string {
        return path.join(workspaceRoot, 'sfdx-project.json');
    }

    static readSfdxProjectJson(sfdxProjectFilePath: string): ISfdxProjectJson {

        const sfdxProjectFileContent = fs.readFileSync(sfdxProjectFilePath, 'utf-8');

        try {
            return JSON.parse(sfdxProjectFileContent);
        } catch (error) {
            throw new Error(`Could not parse "${sfdxProjectFilePath}" as JSON: ${error.message}. Fix the file and run the command again.`);
        }

    }

    /*
        A package directory of "." is legal in sfdx-project.json and resolves to the workspace root
        itself, so the root is treated as contained. Symlinks are resolved on both sides where they
        exist, otherwise a link inside the workspace pointing outside it would satisfy a plain
        string comparison. The trailing separator stops "/work-evil" matching a "/work" root.
    */
    static isPathContainedInWorkspace(resolvedPath: string,
                                        resolvedWorkspaceRoot: string,
                                        resolveRealDirectoryPath?: (directoryPath: string) => string): boolean {

        /*
            The resolver is injectable so a caller that owns its own getRealDirectoryPath stays the
            one source of truth for how paths resolve, rather than this service silently replacing
            it. Pass ONLY a real realpath resolver: an identity function would defeat the symlink
            half of this check. The lexical half never passes through it, so an injected resolver
            can never make a "../" or absolute path pass -- but it can hide a symlink escape.
        */
        const resolveRealPath = resolveRealDirectoryPath ?? ((directoryPath: string) => this.getRealDirectoryPath(directoryPath));

        const realPath = resolveRealPath(resolvedPath);
        const realWorkspaceRoot = resolveRealPath(resolvedWorkspaceRoot);

        const isContained = (candidatePath: string, rootPath: string) => (
            candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep)
        );

        return isContained(resolvedPath, resolvedWorkspaceRoot) && isContained(realPath, realWorkspaceRoot);

    }

    static getRealDirectoryPath(directoryPath: string): string {

        const resolvedDirectoryPath = path.resolve(directoryPath);

        try {
            return fs.realpathSync(resolvedDirectoryPath);
        } catch {
            // FALLS THROUGH TO THE ANCESTOR WALK BELOW
        }

        const parentDirectoryPath = path.dirname(resolvedDirectoryPath);

        if ( parentDirectoryPath === resolvedDirectoryPath ) {
            return resolvedDirectoryPath;
        }

        return path.join(this.getRealDirectoryPath(parentDirectoryPath), path.basename(resolvedDirectoryPath));

    }

    /*
        EVERY usable packageDirectories entry, not just the one marked default -- a multi package
        repository can keep objects under several of them, and seeding the picker from only the
        default would hide the rest behind the full workspace walk.

        Order follows the file so the default entry does not jump the queue: the caller scans these
        in order, and a team that lists force-app first means it.
    */
    static resolvePackageDirectoryPaths(workspaceRoot: string): IResolvedPackageDirectories {

        if ( !workspaceRoot ) {
            return { packageDirectoryPaths: [] };
        }

        const sfdxProjectFilePath = this.getSfdxProjectFilePath(workspaceRoot);

        /*
            isFile rather than existsSync: a repository can check sfdx-project.json in as a symlink
            to a character device such as /dev/zero, and reading that would hang the extension host
            on the first command a new user runs.
        */
        if ( !this.isExistingFile(sfdxProjectFilePath) ) {
            return { packageDirectoryPaths: [] };
        }

        let sfdxProjectJson: ISfdxProjectJson;

        try {
            sfdxProjectJson = this.readSfdxProjectJson(sfdxProjectFilePath);
        } catch (error) {
            return {
                packageDirectoryPaths: [],
                unreadableProjectFileMessage: error instanceof Error ? error.message : String(error)
            };
        }

        const packageDirectories: unknown = sfdxProjectJson?.packageDirectories;

        if ( !Array.isArray(packageDirectories) ) {
            return { packageDirectoryPaths: [] };
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const usablePackageDirectoryPaths: string[] = [];

        for ( const packageDirectory of packageDirectories as ISfdxPackageDirectory[] ) {

            const declaredPath = packageDirectory?.path;

            if ( typeof declaredPath !== 'string' || declaredPath.trim() === '' ) {
                continue;
            }

            // AN ABSOLUTE PATH IS NOT LEGAL IN sfdx-project.json AND WOULD ESCAPE THE WORKSPACE
            if ( path.isAbsolute(declaredPath) ) {
                continue;
            }

            const resolvedPackageDirectoryPath = path.resolve(resolvedWorkspaceRoot, declaredPath);

            if ( !this.isPathContainedInWorkspace(resolvedPackageDirectoryPath, resolvedWorkspaceRoot) ) {
                continue;
            }

            if ( !this.isExistingDirectory(resolvedPackageDirectoryPath) ) {
                continue;
            }

            if ( usablePackageDirectoryPaths.includes(resolvedPackageDirectoryPath) ) {
                continue;
            }

            usablePackageDirectoryPaths.push(resolvedPackageDirectoryPath);

        }

        return { packageDirectoryPaths: usablePackageDirectoryPaths };

    }

    static isExistingFile(filePath: string): boolean {

        try {
            return fs.statSync(filePath).isFile();
        } catch {
            return false;
        }

    }

    static isExistingDirectory(directoryPath: string): boolean {

        try {
            return fs.statSync(directoryPath).isDirectory();
        } catch {
            return false;
        }

    }

}
