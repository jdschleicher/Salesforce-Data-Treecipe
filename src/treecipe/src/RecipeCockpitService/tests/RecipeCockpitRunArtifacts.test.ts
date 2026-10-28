import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import { RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME, RecipeCockpitRunArtifacts } from '../RecipeCockpitRunArtifacts';
import { ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { FIXTURE_RUN_FOLDER_NAME, FIXTURE_TREE_FOLDER_NAME, buildTreeRunArtifactsLocation, makeTreeRunArtifactsLocation } from './RecipeCockpitRunArtifactsFixture';

describe('RecipeCockpitRunArtifacts (#470)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    const generatedRecipesFolderPath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes');

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-run-artifacts-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.mkdirSync(workspaceRoot);
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('imports no vscode', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRunArtifacts.ts'), 'utf-8');
        expect(sourceText).not.toMatch(/from 'vscode'|require\('vscode'\)/);

    });

    describe('resolveTreeLocation', () => {

        it('answers the tree folder and its RunArtifacts folder under GeneratedRecipes/<run>/<tree>, making nothing', () => {

            const expected = makeTreeRunArtifactsLocation(workspaceRoot);

            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, generatedRecipesFolderPath(), FIXTURE_RUN_FOLDER_NAME, FIXTURE_TREE_FOLDER_NAME)).toEqual(expected);
            expect(expected.folderPath).toBe(path.join(path.resolve(workspaceRoot), 'treecipe', 'GeneratedRecipes', FIXTURE_RUN_FOLDER_NAME, FIXTURE_TREE_FOLDER_NAME, RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME));
            expect(fs.existsSync(expected.folderPath)).toBe(false);

        });

        it.each([
            ['an empty run', '', FIXTURE_TREE_FOLDER_NAME],
            ['a ".." run', '..', FIXTURE_TREE_FOLDER_NAME],
            ['a "." tree', FIXTURE_RUN_FOLDER_NAME, '.'],
            ['a tree with a separator', FIXTURE_RUN_FOLDER_NAME, '../outside'],
            ['a tree with a backslash', FIXTURE_RUN_FOLDER_NAME, 'a\\b'],
            ['a tree that is not a string', FIXTURE_RUN_FOLDER_NAME, undefined],
            ['a tree that is not there', FIXTURE_RUN_FOLDER_NAME, 'Missing-Tree']
        ])('answers undefined for %s', (_description, runFolderName, treeFolderName) => {

            makeTreeRunArtifactsLocation(workspaceRoot);
            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, generatedRecipesFolderPath(), runFolderName, treeFolderName)).toBeUndefined();

        });

        it('answers undefined for a tree or run folder that is a link, even to a folder inside the workspace, and a tree that is a file', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const linkedTreePath = path.join(path.dirname(location.treeFolderPath), 'Linked-Tree');
            fs.symlinkSync(location.treeFolderPath, linkedTreePath);
            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, generatedRecipesFolderPath(), FIXTURE_RUN_FOLDER_NAME, 'Linked-Tree')).toBeUndefined();

            fs.symlinkSync(path.dirname(location.treeFolderPath), path.join(generatedRecipesFolderPath(), 'linked-run'));
            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, generatedRecipesFolderPath(), 'linked-run', FIXTURE_TREE_FOLDER_NAME)).toBeUndefined();

            fs.writeFileSync(path.join(path.dirname(location.treeFolderPath), 'File-Tree'), '');
            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, generatedRecipesFolderPath(), FIXTURE_RUN_FOLDER_NAME, 'File-Tree')).toBeUndefined();

        });

        it('answers undefined for a GeneratedRecipes folder outside the workspace', () => {

            const outsideRecipesPath = path.join(temporaryRoot, 'outside', 'GeneratedRecipes');
            fs.mkdirSync(path.join(outsideRecipesPath, FIXTURE_RUN_FOLDER_NAME, FIXTURE_TREE_FOLDER_NAME), { recursive: true });
            expect(RecipeCockpitRunArtifacts.resolveTreeLocation(workspaceRoot, outsideRecipesPath, FIXTURE_RUN_FOLDER_NAME, FIXTURE_TREE_FOLDER_NAME)).toBeUndefined();

        });

    });

    describe('makeFolder', () => {

        it('makes each folder under RunArtifacts with a .gitignore of everything, written once and never over a file there', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const folderPath = path.join(RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'OrgOperations'), 'qa@example.com');

            expect(RecipeCockpitRunArtifacts.makeFolder(location, folderPath)).toBe(true);
            expect(fs.statSync(folderPath).isDirectory()).toBe(true);
            expect(fs.readFileSync(path.join(location.folderPath, '.gitignore'), 'utf-8')).toBe('*\n');
            expect(RecipeCockpitRunArtifacts.isGitIgnored(location)).toBe(true);

            fs.writeFileSync(path.join(location.folderPath, '.gitignore'), '# kept\n*\n');
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(true);
            expect(fs.readFileSync(path.join(location.folderPath, '.gitignore'), 'utf-8')).toBe('# kept\n*\n');

        });

        it('refuses a path that is not under RunArtifacts', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);

            expect(RecipeCockpitRunArtifacts.makeFolder(location, location.treeFolderPath)).toBe(false);
            expect(RecipeCockpitRunArtifacts.makeFolder(location, path.join(location.treeFolderPath, 'Other'))).toBe(false);
            expect(RecipeCockpitRunArtifacts.makeFolder(location, path.join(temporaryRoot, 'outside'))).toBe(false);
            expect(fs.readdirSync(location.treeFolderPath)).toEqual([]);
            expect(fs.existsSync(path.join(temporaryRoot, 'outside'))).toBe(false);

        });

        it('follows no link on the way, even one to a folder inside the workspace, and makes nothing past it', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const insideFolderPath = path.join(workspaceRoot, 'elsewhere');
            fs.mkdirSync(insideFolderPath);
            fs.symlinkSync(insideFolderPath, location.folderPath);

            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'UpdateAttempts'))).toBe(false);
            expect(fs.readdirSync(insideFolderPath)).toEqual([]);

            fs.rmSync(location.folderPath);
            fs.mkdirSync(location.folderPath);
            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.symlinkSync(outsideFolderPath, path.join(location.folderPath, 'OrgOperations'));
            expect(RecipeCockpitRunArtifacts.makeFolder(location, path.join(RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'OrgOperations'), 'qa'))).toBe(false);
            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);

        });

        it('refuses a tree folder that is gone or has become a link, a folder it cannot make, and a path the workspace check refuses once made', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);

            fs.writeFileSync(location.folderPath, 'a file where the folder goes');
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(false);
            fs.rmSync(location.folderPath);

            const realMkdirSync = fs.mkdirSync;
            const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(((folderPath: fs.PathLike, options?: any) => {
                if ( String(folderPath).endsWith('QueryResults') ) {
                    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
                }
                return (realMkdirSync as any)(folderPath, options);
            }) as any);
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(false);
            mkdirSpy.mockRestore();

            const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValueOnce(true).mockReturnValueOnce(false);
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(false);
            containmentSpy.mockRestore();

            fs.rmSync(location.treeFolderPath, { recursive: true });
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(false);
            fs.mkdirSync(path.join(workspaceRoot, 'elsewhere'));
            fs.symlinkSync(path.join(workspaceRoot, 'elsewhere'), location.treeFolderPath);
            expect(RecipeCockpitRunArtifacts.makeFolder(location, RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'QueryResults'))).toBe(false);
            expect(fs.readdirSync(path.join(workspaceRoot, 'elsewhere'))).toEqual([]);

        });

    });

    describe('the .gitignore, read back', () => {

        const withGitignore = (gitignoreText: string) => {
            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            fs.mkdirSync(location.folderPath, { recursive: true });
            fs.writeFileSync(path.join(location.folderPath, '.gitignore'), gitignoreText);
            return RecipeCockpitRunArtifacts.isGitIgnored(location);
        };

        it('answers true only for a file whose lines ignore everything and un-ignore nothing', () => {

            expect(withGitignore('*\n')).toBe(true);
            expect(withGitignore('# org data\r\n  *  \r\n')).toBe(true);
            expect(withGitignore('*\n!*.csv\n')).toBe(false);
            expect(withGitignore('*.json\n')).toBe(false);
            expect(withGitignore('')).toBe(false);

        });

        it('answers false with no file, or with a folder or a link where the file goes', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            expect(RecipeCockpitRunArtifacts.isGitIgnored(location)).toBe(false);
            fs.mkdirSync(path.join(location.folderPath, '.gitignore'), { recursive: true });
            expect(RecipeCockpitRunArtifacts.isGitIgnored(location)).toBe(false);
            fs.rmSync(path.join(location.folderPath, '.gitignore'), { recursive: true });
            fs.writeFileSync(path.join(temporaryRoot, 'ignore-all'), '*\n');
            fs.symlinkSync(path.join(temporaryRoot, 'ignore-all'), path.join(location.folderPath, '.gitignore'));
            expect(RecipeCockpitRunArtifacts.isGitIgnored(location)).toBe(false);

        });

        it('says a run file is exposed to git only when it is under a RunArtifacts folder that does not ignore everything', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const runFilePath = path.join(location.folderPath, 'OrgOperations', 'qa', 'x.json');
            fs.mkdirSync(path.dirname(runFilePath), { recursive: true });

            expect(RecipeCockpitRunArtifacts.isRunFileExposedToGit(runFilePath)).toBe(true);
            fs.writeFileSync(path.join(location.folderPath, '.gitignore'), '*\n');
            expect(RecipeCockpitRunArtifacts.isRunFileExposedToGit(runFilePath)).toBe(false);
            fs.writeFileSync(path.join(location.folderPath, '.gitignore'), '*\n!*.json\n');
            expect(RecipeCockpitRunArtifacts.isRunFileExposedToGit(runFilePath)).toBe(true);
            // A FILE OUTSIDE ANY RunArtifacts FOLDER (A SCRATCH ORG'S RESULT) IS NOT ONE OF A TREE'S RUN FILES
            expect(RecipeCockpitRunArtifacts.isRunFileExposedToGit(path.join(workspaceRoot, 'treecipe', 'OrgOperations', 'qa', 'x.json'))).toBe(false);

        });

    });

    describe('writeNewFile', () => {

        it('writes the first free of <name>, <name>-2, ..., never through a file or link already there, and stops after its attempts', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const folderPath = RecipeCockpitRunArtifacts.buildKindFolderPath(location, 'PermissionSets');
            RecipeCockpitRunArtifacts.makeFolder(location, folderPath);
            const filePath = path.join(folderPath, 'a.json');

            fs.writeFileSync(path.join(temporaryRoot, 'outside.json'), 'outside');
            fs.symlinkSync(path.join(temporaryRoot, 'outside.json'), filePath);
            expect(RecipeCockpitRunArtifacts.writeNewFile(filePath, '{}', '.json', 3)).toBe(path.join(folderPath, 'a-2.json'));
            expect(fs.readFileSync(path.join(temporaryRoot, 'outside.json'), 'utf-8')).toBe('outside');
            expect(RecipeCockpitRunArtifacts.writeNewFile(filePath, '{}', '.json', 3)).toBe(path.join(folderPath, 'a-3.json'));
            expect(RecipeCockpitRunArtifacts.writeNewFile(filePath, '{}', '.json', 3)).toBeUndefined();

            jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); });
            expect(RecipeCockpitRunArtifacts.writeNewFile(path.join(folderPath, 'b.json'), '{}', '.json', 3)).toBeUndefined();

        });

    });

    describe('ScratchOrgService.writeOrgOperationResult', () => {

        const invocation = { stdout: '{"status":0,"result":{"accessToken":"00D!secret"}}', stderr: '', exitCode: 0 };

        it('writes a tree\'s CLI result into its RunArtifacts/OrgOperations/<username>, redacted, and nothing into treecipe/OrgOperations', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const date = new Date(2026, 9, 27, 10, 0, 0);

            const resultFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'field-deploy', invocation as any, date, undefined, location);

            expect(resultFilePath).toBe(path.join(location.folderPath, 'OrgOperations', 'qa@example.com', '20261027-100000-field-deploy.json'));
            expect(fs.readFileSync(resultFilePath!, 'utf-8')).not.toContain('00D!secret');
            expect(fs.readFileSync(path.join(location.folderPath, '.gitignore'), 'utf-8')).toBe('*\n');
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', 'OrgOperations'))).toBe(false);
            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'field-deploy', invocation as any, date, undefined, location))
                .toBe(path.join(location.folderPath, 'OrgOperations', 'qa@example.com', '20261027-100000-field-deploy-2.json'));

        });

        it('writes nothing for a tree whose RunArtifacts cannot be made, or through a link', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            fs.mkdirSync(path.join(location.folderPath, 'OrgOperations'), { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'outside'));
            fs.symlinkSync(path.join(temporaryRoot, 'outside'), path.join(location.folderPath, 'OrgOperations', 'qa@example.com'));

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'field-deploy', invocation as any, new Date(), undefined, location)).toBeUndefined();
            expect(fs.readdirSync(path.join(temporaryRoot, 'outside'))).toEqual([]);
            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, '..', 'field-deploy', invocation as any, new Date(), undefined, location)).toBeUndefined();

            fs.rmSync(location.folderPath, { recursive: true });
            fs.writeFileSync(location.folderPath, 'a file where the folder goes');
            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'field-deploy', invocation as any, new Date(), undefined, location)).toBeUndefined();

        });

        it('still writes a run tied to no tree, a scratch org\'s creation, into treecipe/OrgOperations', () => {

            const resultFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'my-scratch', 'scratch-create', invocation as any, new Date(2026, 9, 27, 10, 0, 0));

            expect(resultFilePath).toBe(path.join(path.resolve(workspaceRoot), 'treecipe', 'OrgOperations', 'my-scratch', '20261027-100000-scratch-create.json'));
            expect(fs.existsSync(buildTreeRunArtifactsLocation(workspaceRoot).folderPath)).toBe(false);

        });

    });

});
