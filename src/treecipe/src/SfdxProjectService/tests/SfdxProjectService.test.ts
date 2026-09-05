import { SfdxProjectService } from "../SfdxProjectService";

import * as fs from 'fs';
import * as path from 'path';

describe('SfdxProjectService', () => {

    const workspaceRoot = path.resolve('/fake/workspace');

    const mockSfdxProjectJson = (sfdxProjectJsonContent: string) => {
        jest.spyOn(SfdxProjectService, 'isExistingFile').mockReturnValue(true);
        jest.spyOn(fs, 'readFileSync').mockReturnValue(sfdxProjectJsonContent);
    };

    const mockEveryPathIsAnExistingDirectory = () => {
        jest.spyOn(SfdxProjectService, 'isExistingDirectory').mockReturnValue(true);
    };

    describe('getSfdxProjectFilePath', () => {

        test('resolves sfdx-project.json against the workspace root', () => {

            expect(SfdxProjectService.getSfdxProjectFilePath(workspaceRoot))
                .toBe(path.join(workspaceRoot, 'sfdx-project.json'));

        });

    });

    describe('readSfdxProjectJson', () => {

        test('given valid json, returns the parsed object', () => {

            jest.spyOn(fs, 'readFileSync').mockReturnValue('{ "packageDirectories": [] }');

            expect(SfdxProjectService.readSfdxProjectJson('/fake/workspace/sfdx-project.json'))
                .toEqual({ packageDirectories: [] });

        });

        test('given unparseable json, throws an actionable error naming the file', () => {

            jest.spyOn(fs, 'readFileSync').mockReturnValue('{ not json');

            expect(() => SfdxProjectService.readSfdxProjectJson('/fake/workspace/sfdx-project.json'))
                .toThrow(/Could not parse "\/fake\/workspace\/sfdx-project.json" as JSON/);

        });

    });

    describe('isPathContainedInWorkspace', () => {

        test('given the workspace root itself, returns true so a "." package directory resolves', () => {

            jest.spyOn(SfdxProjectService, 'getRealDirectoryPath').mockImplementation(givenPath => givenPath);

            expect(SfdxProjectService.isPathContainedInWorkspace(workspaceRoot, workspaceRoot)).toBe(true);

        });

        test('given a descendant directory, returns true', () => {

            jest.spyOn(SfdxProjectService, 'getRealDirectoryPath').mockImplementation(givenPath => givenPath);

            const descendantPath = path.join(workspaceRoot, 'force-app');
            expect(SfdxProjectService.isPathContainedInWorkspace(descendantPath, workspaceRoot)).toBe(true);

        });

        test('given a sibling whose name merely starts with the root, returns false', () => {

            jest.spyOn(SfdxProjectService, 'getRealDirectoryPath').mockImplementation(givenPath => givenPath);

            expect(SfdxProjectService.isPathContainedInWorkspace(`${workspaceRoot}-evil`, workspaceRoot)).toBe(false);

        });

        test('given a path whose realpath escapes the workspace, returns false', () => {

            const symlinkedPath = path.join(workspaceRoot, 'linked');

            jest.spyOn(SfdxProjectService, 'getRealDirectoryPath').mockImplementation(
                givenPath => givenPath === symlinkedPath ? path.resolve('/elsewhere/objects') : givenPath
            );

            expect(SfdxProjectService.isPathContainedInWorkspace(symlinkedPath, workspaceRoot)).toBe(false);

        });

    });

    describe('resolvePackageDirectoryPaths', () => {

        test('given no workspace root, returns no package directories', () => {

            expect(SfdxProjectService.resolvePackageDirectoryPaths(undefined))
                .toEqual({ packageDirectoryPaths: [] });

        });

        test('given no sfdx-project.json, returns no package directories without throwing', () => {

            jest.spyOn(SfdxProjectService, 'isExistingFile').mockReturnValue(false);

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [] });

        });

        test('given unparseable json, returns no package directories and the message to surface', () => {

            mockSfdxProjectJson('{ not json');

            const resolvedPackageDirectories = SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot);

            expect(resolvedPackageDirectories.packageDirectoryPaths).toEqual([]);
            expect(resolvedPackageDirectories.unreadableProjectFileMessage).toContain('Could not parse');

        });

        test('given a non-Error thrown while reading, still returns a message rather than throwing', () => {

            jest.spyOn(SfdxProjectService, 'isExistingFile').mockReturnValue(true);
            jest.spyOn(SfdxProjectService, 'readSfdxProjectJson').mockImplementation(() => { throw 'disk exploded'; });

            const resolvedPackageDirectories = SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot);

            expect(resolvedPackageDirectories.packageDirectoryPaths).toEqual([]);
            expect(resolvedPackageDirectories.unreadableProjectFileMessage).toBe('disk exploded');

        });

        test('given a null entry in packageDirectories, skips it rather than throwing', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ null, { "path": "force-app" } ] }');
            mockEveryPathIsAnExistingDirectory();

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ path.join(workspaceRoot, 'force-app') ] });

        });

        test('given no packageDirectories key, returns no package directories', () => {

            mockSfdxProjectJson('{ "sourceApiVersion": "62.0" }');

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [] });

        });

        test('given an empty packageDirectories array, returns no package directories', () => {

            mockSfdxProjectJson('{ "packageDirectories": [] }');

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [] });

        });

        test('given entries with no usable path, returns no package directories', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "default": true }, { "path": "   " } ] }');

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [] });

        });

        test('returns EVERY usable entry in file order, not just the default one', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "path": "utilities" }, { "path": "force-app", "default": true } ] }');
            mockEveryPathIsAnExistingDirectory();

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({
                    packageDirectoryPaths: [
                        path.join(workspaceRoot, 'utilities'),
                        path.join(workspaceRoot, 'force-app')
                    ]
                });

        });

        test('skips an absolute path but keeps the remaining valid entries', () => {

            const absolutePackageDirectoryPath = JSON.stringify(path.resolve('/tmp/evil'));
            mockSfdxProjectJson(`{ "packageDirectories": [ { "path": ${absolutePackageDirectoryPath} }, { "path": "force-app" } ] }`);
            mockEveryPathIsAnExistingDirectory();

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ path.join(workspaceRoot, 'force-app') ] });

        });

        test('skips a path that resolves outside the workspace but keeps the remaining valid entries', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "path": "../../escape" }, { "path": "force-app" } ] }');
            mockEveryPathIsAnExistingDirectory();
            jest.spyOn(SfdxProjectService, 'getRealDirectoryPath').mockImplementation(givenPath => givenPath);

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ path.join(workspaceRoot, 'force-app') ] });

        });

        test('skips a path that does not exist on disk but keeps the remaining valid entries', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "path": "deleted-package" }, { "path": "force-app" } ] }');
            jest.spyOn(SfdxProjectService, 'isExistingDirectory').mockImplementation(
                givenPath => givenPath === path.join(workspaceRoot, 'force-app')
            );

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ path.join(workspaceRoot, 'force-app') ] });

        });

        test('given the same directory listed twice, returns it once', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "path": "force-app" }, { "path": "./force-app" } ] }');
            mockEveryPathIsAnExistingDirectory();

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ path.join(workspaceRoot, 'force-app') ] });

        });

        test('given a "." package directory, resolves it to the workspace root', () => {

            mockSfdxProjectJson('{ "packageDirectories": [ { "path": "." } ] }');
            mockEveryPathIsAnExistingDirectory();

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [ workspaceRoot ] });

        });

    });

    describe('isExistingFile', () => {

        test('given a regular file, returns true', () => {

            jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as unknown as fs.Stats);

            expect(SfdxProjectService.isExistingFile('/fake/workspace/sfdx-project.json')).toBe(true);

        });

        /*
            A repository can check sfdx-project.json in as a symlink to a character device, and
            reading one would hang the extension host rather than fail.
        */
        test('given a path that is not a regular file, returns false so it is never read', () => {

            jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false } as unknown as fs.Stats);

            expect(SfdxProjectService.isExistingFile('/fake/workspace/sfdx-project.json')).toBe(false);

        });

        test('given a path that cannot be stat-ed, returns false rather than throwing', () => {

            jest.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('ENOENT'); });

            expect(SfdxProjectService.isExistingFile('/fake/workspace/missing')).toBe(false);

        });

    });

    describe('resolvePackageDirectoryPaths device guard', () => {

        test('given a project file that is not a regular file, reads nothing and returns no package directories', () => {

            jest.spyOn(SfdxProjectService, 'isExistingFile').mockReturnValue(false);
            const readSpy = jest.spyOn(fs, 'readFileSync');

            expect(SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot))
                .toEqual({ packageDirectoryPaths: [] });
            expect(readSpy).not.toHaveBeenCalled();

        });

    });

    describe('isExistingDirectory', () => {

        test('given a directory, returns true', () => {

            jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as unknown as fs.Stats);

            expect(SfdxProjectService.isExistingDirectory('/fake/workspace/force-app')).toBe(true);

        });

        test('given a file, returns false', () => {

            jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false } as unknown as fs.Stats);

            expect(SfdxProjectService.isExistingDirectory('/fake/workspace/sfdx-project.json')).toBe(false);

        });

        test('given a path that cannot be stat-ed, returns false rather than throwing', () => {

            jest.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('ENOENT'); });

            expect(SfdxProjectService.isExistingDirectory('/fake/workspace/missing')).toBe(false);

        });

    });

    describe('getRealDirectoryPath', () => {

        test('given a resolvable path, returns the realpath', () => {

            jest.spyOn(fs, 'realpathSync').mockReturnValue(path.resolve('/real/objects'));

            expect(SfdxProjectService.getRealDirectoryPath('/fake/objects')).toBe(path.resolve('/real/objects'));

        });

        test('given a path that does not exist, walks up to the nearest resolvable ancestor', () => {

            const notYetCreatedPath = path.join(workspaceRoot, 'not', 'created');

            jest.spyOn(fs, 'realpathSync').mockImplementation((givenPath) => {
                if ( givenPath === workspaceRoot ) {
                    return workspaceRoot;
                }
                throw new Error('ENOENT');
            });

            expect(SfdxProjectService.getRealDirectoryPath(notYetCreatedPath)).toBe(notYetCreatedPath);

        });

        test('given a path with no resolvable ancestor, returns the resolved path unchanged', () => {

            const unresolvablePath = path.resolve('/nothing/here');

            jest.spyOn(fs, 'realpathSync').mockImplementation(() => { throw new Error('ENOENT'); });

            expect(SfdxProjectService.getRealDirectoryPath(unresolvablePath)).toBe(unresolvablePath);

        });

    });

});
