const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    PackagedContentsChecker,
    TOP_LEVEL_PATH_ALLOW_LIST
} = require('../checkPackagedPaths.js');

const packagedPathsWithoutTsNode = [
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'images/datatreecipe.webp',
    'apexPicklistDependencyFramework/SDTPicklistDependencyFramework/SDTPicklistDependencyValidator.cls',
    'out/extension.js',
    'out/treecipe/src/RecipeService/RecipeService.js',
    'node_modules/js-yaml/package.json'
];

const sourcesByPackagedPath = {
    'out/extension.js': 'const vscode = require("vscode");\nconst path = require("path");',
    'out/treecipe/src/RecipeService/RecipeService.js':
        'const yaml = require("js-yaml");\n'
        + 'const { faker } = require("@faker-js/faker");\n'
        + 'const core = require("@salesforce/core");\n'
        + 'const xml2js = require("xml2js");\n'
        + 'const local = require("./ObjectInfo");'
};

const readFakeSource = packagedPath => sourcesByPackagedPath[packagedPath] || '';

describe('PackagedContentsChecker.parsePackagedPaths', () => {

    it('drops blank lines and normalizes windows separators', () => {

        const parsed = PackagedContentsChecker.parsePackagedPaths(
            'package.json\r\nout\\extension.js\n\n   \nimages/icon.webp\n'
        );

        expect(parsed).toEqual(['package.json', 'out/extension.js', 'images/icon.webp']);

    });

});

describe('PackagedContentsChecker.collectTopLevelPathViolations', () => {

    it('accepts the paths the extension is meant to ship', () => {

        const violations = PackagedContentsChecker.collectTopLevelPathViolations(packagedPathsWithoutTsNode);

        expect(violations).toBeEmpty();

    });

    it('reports the #67 class of leak -- salesforce cli state and repo documentation', () => {

        const violations = PackagedContentsChecker.collectTopLevelPathViolations([
            ...packagedPathsWithoutTsNode,
            '.sfdx/tools/apex.db',
            '.sf/orgs/00D000000000000EAA/alias.json',
            'docs/DESIGN-RECORD.md',
            'coverage/lcov.info',
            'treecipe/PicklistDependencySpecs/manifest.json'
        ]);

        expect(violations).toHaveLength(5);
        expect(violations.join('\n')).toIncludeMultiple(['.sfdx', '.sf', 'docs', 'coverage', 'treecipe']);

    });

    it('reports each unexpected top-level path once no matter how many files it carries', () => {

        const violations = PackagedContentsChecker.collectTopLevelPathViolations([
            'package.json',
            'src/extension.ts',
            'src/treecipe/src/RecipeService/RecipeService.ts',
            'src/treecipe/src/ValueSetService/ValueSetService.ts'
        ]);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('"src"');

    });

    it('honors an injected allow list instead of the checked-in one', () => {

        expect(PackagedContentsChecker.collectTopLevelPathViolations(
            ['scratch/report.txt'],
            ['scratch']
        )).toBeEmpty();

        expect(PackagedContentsChecker.collectTopLevelPathViolations(
            ['out/extension.js'],
            ['scratch']
        )).toHaveLength(1);

    });

    it('names the first offending path, because the segment alone can be degenerate', () => {

        const [absoluteViolation] = PackagedContentsChecker.collectTopLevelPathViolations(
            ['/home/runner/out/extension.js']
        );
        expect(absoluteViolation).toInclude('/home/runner/out/extension.js');

        const [relativeViolation] = PackagedContentsChecker.collectTopLevelPathViolations(
            ['./out/extension.js']
        );
        expect(relativeViolation).toInclude('./out/extension.js');

    });

    it('does not silently accept a nested path whose leading segment is disallowed', () => {

        const violations = PackagedContentsChecker.collectTopLevelPathViolations(['scripts/tests/tooling.js']);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('"scripts"');

    });

});

describe('PackagedContentsChecker.collectScannablePackagedSourcePaths', () => {

    it('scans only shipped javascript outside node_modules', () => {

        const scannable = PackagedContentsChecker.collectScannablePackagedSourcePaths([
            'out/extension.js',
            'out/treecipe/src/RecipeService/RecipeService.js',
            'node_modules/js-yaml/index.js',
            'apexPicklistDependencyFramework/SDTPicklistDependencyFramework/SDTValidator.cls',
            'package.json'
        ]);

        expect(scannable).toEqual(['out/extension.js', 'out/treecipe/src/RecipeService/RecipeService.js']);

    });

    // .vscodeignore removes out/**/tests/**, so the jest-extended requires under it never ship.
    // Reading requires off disk instead of off the packaged list would report a leak that is not one.
    it('never sees a test file, because a test file is not in the packaged list', () => {

        const scannable = PackagedContentsChecker.collectScannablePackagedSourcePaths(packagedPathsWithoutTsNode);

        expect(scannable).not.toIncludeAnyMembers([
            'out/treecipe/src/RecipeService/tests/RecipeService.test.js'
        ]);

    });

});

describe('PackagedContentsChecker.collectBareModuleSpecifiers', () => {

    it('collects bare specifiers and ignores relative and absolute ones', () => {

        const specifiers = PackagedContentsChecker.collectBareModuleSpecifiers(
            'require("js-yaml"); require("./local"); require("../sibling"); require("/etc/thing");'
        );

        expect(specifiers).toEqual(['js-yaml']);

    });

    it('tolerates the whitespace and quote styles tsc emits', () => {

        const specifiers = PackagedContentsChecker.collectBareModuleSpecifiers(
            "require( 'xml2js' );\nrequire(\"@salesforce/core\")"
        );

        expect(specifiers).toEqual(['@salesforce/core', 'xml2js']);

    });

    it('reports each specifier once per file', () => {

        const specifiers = PackagedContentsChecker.collectBareModuleSpecifiers(
            'require("vscode"); require("vscode"); require("vscode");'
        );

        expect(specifiers).toEqual(['vscode']);

    });

});

describe('PackagedContentsChecker.toPackageName', () => {

    it('keeps both segments of a scoped package', () => {

        expect(PackagedContentsChecker.toPackageName('@salesforce/core')).toBe('@salesforce/core');

    });

    it('resolves a deep import back to the dependency that satisfies it', () => {

        expect(PackagedContentsChecker.toPackageName('@salesforce/core/lib/org')).toBe('@salesforce/core');
        expect(PackagedContentsChecker.toPackageName('js-yaml/dist/js-yaml.mjs')).toBe('js-yaml');

    });

    it('strips the node: prefix', () => {

        expect(PackagedContentsChecker.toPackageName('node:path')).toBe('path');

    });

});

describe('PackagedContentsChecker.isNodeBuiltinModule', () => {

    it('recognizes builtins with and without the node: prefix', () => {

        expect(PackagedContentsChecker.isNodeBuiltinModule('fs')).toBeTrue();
        expect(PackagedContentsChecker.isNodeBuiltinModule('node:child_process')).toBeTrue();

    });

    it('does not treat an installed package as a builtin', () => {

        expect(PackagedContentsChecker.isNodeBuiltinModule('js-yaml')).toBeFalse();

    });

});

describe('PackagedContentsChecker.collectUnusedRuntimeDependencyViolations', () => {

    // The assertion #121 exists for.
    it('reports a dependency nothing in the packaged output requires', () => {

        const violations = PackagedContentsChecker.collectUnusedRuntimeDependencyViolations(
            ['@faker-js/faker', '@salesforce/core', 'js-yaml', 'ts-node', 'xml2js'],
            new Set(['@faker-js/faker', '@salesforce/core', 'js-yaml', 'xml2js'])
        );

        expect(violations).toHaveLength(1);
        expect(violations[0]).toIncludeMultiple(['ts-node', 'devDependencies']);

    });

    it('passes when every declared dependency is required', () => {

        const violations = PackagedContentsChecker.collectUnusedRuntimeDependencyViolations(
            ['@faker-js/faker', 'js-yaml'],
            new Set(['@faker-js/faker', 'js-yaml'])
        );

        expect(violations).toBeEmpty();

    });

    it('counts a deep import as use of its dependency', () => {

        const requiredPackageNames = PackagedContentsChecker.collectRequiredPackageNames(
            ['out/deep.js'],
            () => 'require("@salesforce/core/lib/org/authInfo");'
        );

        const violations = PackagedContentsChecker.collectUnusedRuntimeDependencyViolations(
            ['@salesforce/core'],
            requiredPackageNames
        );

        expect(violations).toBeEmpty();

    });

});

describe('PackagedContentsChecker.collectUndeclaredRuntimeRequireViolations', () => {

    it('reports shipped code reaching for a devDependency', () => {

        const violations = PackagedContentsChecker.collectUndeclaredRuntimeRequireViolations(
            new Set(['js-yaml', 'jsforce']),
            ['js-yaml']
        );

        expect(violations).toHaveLength(1);
        expect(violations[0]).toIncludeMultiple(['jsforce', 'not declared in dependencies']);

    });

    it('accepts vscode, which the host provides and no manifest declares', () => {

        const violations = PackagedContentsChecker.collectUndeclaredRuntimeRequireViolations(
            new Set(['vscode']),
            []
        );

        expect(violations).toBeEmpty();

    });

});

describe('PackagedContentsChecker.collectRequiredPackageNames', () => {

    it('excludes builtins and relative imports from what it collects', () => {

        const requiredPackageNames = PackagedContentsChecker.collectRequiredPackageNames(
            Object.keys(sourcesByPackagedPath),
            readFakeSource
        );

        expect([...requiredPackageNames].sort()).toEqual([
            '@faker-js/faker',
            '@salesforce/core',
            'js-yaml',
            'vscode',
            'xml2js'
        ]);

    });

});

describe('PackagedContentsChecker.checkPackagedContents', () => {

    it('passes for a package carrying only what it runs', () => {

        const violations = PackagedContentsChecker.checkPackagedContents({
            packagedPaths: packagedPathsWithoutTsNode,
            declaredDependencyNames: ['@faker-js/faker', '@salesforce/core', 'js-yaml', 'xml2js'],
            readPackagedSource: readFakeSource
        });

        expect(violations).toBeEmpty();

    });

    // Reconstructs the state of this repository before #121: ts-node declared, packaged, unused.
    it('fails on the ts-node placement #121 fixed', () => {

        const violations = PackagedContentsChecker.checkPackagedContents({
            packagedPaths: [...packagedPathsWithoutTsNode, 'node_modules/ts-node/dist/index.js'],
            declaredDependencyNames: ['@faker-js/faker', '@salesforce/core', 'js-yaml', 'ts-node', 'xml2js'],
            readPackagedSource: readFakeSource
        });

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('ts-node');

    });

    it('reports every failing assertion together rather than stopping at the first', () => {

        const violations = PackagedContentsChecker.checkPackagedContents({
            packagedPaths: [...packagedPathsWithoutTsNode, 'docs/DESIGN-RECORD.md', 'out/leak.js'],
            declaredDependencyNames: ['js-yaml', 'ts-node'],
            readPackagedSource: packagedPath =>
                packagedPath === 'out/leak.js' ? 'require("jsforce");' : readFakeSource(packagedPath)
        });

        expect(violations.join('\n')).toIncludeMultiple(['docs', 'ts-node', 'jsforce']);

    });

});

describe('PackagedContentsChecker.runAgainstWorkspace', () => {

    let workspaceDirectoryPath;
    let vsceListFilePath;

    const writeWorkspaceFile = (relativePath, contents) => {
        const absolutePath = path.join(workspaceDirectoryPath, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, contents, 'utf8');
    };

    beforeEach(() => {
        workspaceDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-contents-'));
        vsceListFilePath = path.join(workspaceDirectoryPath, 'vsce-ls.txt');
    });

    afterEach(() => {
        fs.rmSync(workspaceDirectoryPath, { recursive: true, force: true });
    });

    it('passes for a workspace whose declared dependencies are all required', () => {

        writeWorkspaceFile('package.json', JSON.stringify({
            dependencies: { 'js-yaml': '^4.1.0', 'xml2js': '^0.6.2' }
        }));
        writeWorkspaceFile('out/extension.js', 'require("vscode"); require("js-yaml"); require("xml2js");');
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/extension.js\nnode_modules/js-yaml/index.js\n');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations).toBeEmpty();

    });

    it('reads dependencies off the workspace manifest and reports an unused one', () => {

        writeWorkspaceFile('package.json', JSON.stringify({
            dependencies: { 'js-yaml': '^4.1.0', 'ts-node': '^10.9.2' }
        }));
        writeWorkspaceFile('out/extension.js', 'require("js-yaml");');
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/extension.js\n');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('ts-node');

    });

    it('treats a manifest with no dependencies block as declaring none', () => {

        writeWorkspaceFile('package.json', JSON.stringify({ name: 'no-dependencies' }));
        writeWorkspaceFile('out/extension.js', 'require("vscode");');
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/extension.js\n');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations).toBeEmpty();

    });

    it('reports a traversal path as unread instead of opening it', () => {

        fs.writeFileSync(
            path.join(workspaceDirectoryPath, 'package.json'),
            JSON.stringify({ dependencies: {} }),
            'utf8'
        );
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/../../../../../../etc/hosts.js\n', 'utf8');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations[0]).toIncludeMultiple(['resolves outside the workspace', 'was not read']);

    });

    it('reports a listed file that is not on disk instead of throwing a stack trace', () => {

        fs.writeFileSync(
            path.join(workspaceDirectoryPath, 'package.json'),
            JSON.stringify({ dependencies: {} }),
            'utf8'
        );
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/neverWritten.js\n', 'utf8');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations[0]).toInclude('could not be read');

    });

    it('reports a missing listing file instead of throwing', () => {

        const violations = PackagedContentsChecker.runAgainstWorkspace(
            path.join(workspaceDirectoryPath, 'no-such-listing.txt'),
            workspaceDirectoryPath
        );

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('Could not read the packaged listing');

    });

    it('reports an unparseable manifest instead of throwing', () => {

        fs.writeFileSync(path.join(workspaceDirectoryPath, 'package.json'), '{ not json', 'utf8');
        fs.writeFileSync(vsceListFilePath, 'package.json\n', 'utf8');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('Could not read');

    });

    // An empty listing means vsce did not run, and every assertion over an empty list passes.
    // Reporting "no violations" there is a green check that verified nothing.
    it('reports an empty listing rather than passing over it', () => {

        writeWorkspaceFile('package.json', JSON.stringify({ dependencies: { 'ts-node': '^10.9.2' } }));
        fs.writeFileSync(vsceListFilePath, '\n   \n');

        const violations = PackagedContentsChecker.runAgainstWorkspace(vsceListFilePath, workspaceDirectoryPath);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toInclude('vsce ls');

    });

});

describe('PackagedContentsChecker.main', () => {

    let workspaceDirectoryPath;
    let vsceListFilePath;
    let consoleOutput;

    beforeEach(() => {
        workspaceDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-contents-main-'));
        vsceListFilePath = path.join(workspaceDirectoryPath, 'vsce-ls.txt');
        consoleOutput = { log: jest.fn(), error: jest.fn() };
    });

    afterEach(() => {
        fs.rmSync(workspaceDirectoryPath, { recursive: true, force: true });
    });

    const writeCleanWorkspace = () => {
        fs.writeFileSync(
            path.join(workspaceDirectoryPath, 'package.json'),
            JSON.stringify({ dependencies: { 'js-yaml': '^4.1.0' } }),
            'utf8'
        );
        fs.mkdirSync(path.join(workspaceDirectoryPath, 'out'));
        fs.writeFileSync(path.join(workspaceDirectoryPath, 'out', 'extension.js'), 'require("js-yaml");', 'utf8');
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/extension.js\n', 'utf8');
    };

    it('exits 0 and says so when the package carries only what it runs', () => {

        writeCleanWorkspace();

        const exitCode = PackagedContentsChecker.main(
            ['node', 'checkPackagedPaths.js', vsceListFilePath],
            workspaceDirectoryPath,
            consoleOutput
        );

        expect(exitCode).toBe(0);
        expect(consoleOutput.log).toHaveBeenCalledWith('Package contents check passed.');
        expect(consoleOutput.error).not.toHaveBeenCalled();

    });

    it('exits 1 and prints every violation when the package carries something it does not run', () => {

        fs.writeFileSync(
            path.join(workspaceDirectoryPath, 'package.json'),
            JSON.stringify({ dependencies: { 'js-yaml': '^4.1.0', 'ts-node': '^10.9.2' } }),
            'utf8'
        );
        fs.mkdirSync(path.join(workspaceDirectoryPath, 'out'));
        fs.writeFileSync(path.join(workspaceDirectoryPath, 'out', 'extension.js'), 'require("js-yaml");', 'utf8');
        fs.writeFileSync(vsceListFilePath, 'package.json\nout/extension.js\ndocs/DESIGN-RECORD.md\n', 'utf8');

        const exitCode = PackagedContentsChecker.main(
            ['node', 'checkPackagedPaths.js', vsceListFilePath],
            workspaceDirectoryPath,
            consoleOutput
        );

        expect(exitCode).toBe(1);
        expect(consoleOutput.log).not.toHaveBeenCalled();
        expect(consoleOutput.error.mock.calls.flat().join('\n')).toIncludeMultiple([
            'Package contents check FAILED:',
            'docs',
            'ts-node'
        ]);

    });

    it('exits 1 with usage when no listing file is given', () => {

        const exitCode = PackagedContentsChecker.main(
            ['node', 'checkPackagedPaths.js'],
            workspaceDirectoryPath,
            consoleOutput
        );

        expect(exitCode).toBe(1);
        expect(consoleOutput.error).toHaveBeenCalledWith(
            'Usage: node checkPackagedPaths.js <vsce-ls-output-file>'
        );

    });

});

describe('PackagedContentsChecker.resolveContainedWorkspacePath', () => {

    let workspaceDirectoryPath;

    beforeEach(() => {
        workspaceDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-contents-containment-'));
        fs.mkdirSync(path.join(workspaceDirectoryPath, 'out'));
        fs.writeFileSync(path.join(workspaceDirectoryPath, 'out', 'extension.js'), '', 'utf8');
    });

    afterEach(() => {
        fs.rmSync(workspaceDirectoryPath, { recursive: true, force: true });
    });

    it('resolves a path inside the workspace', () => {

        const resolved = PackagedContentsChecker.resolveContainedWorkspacePath(
            workspaceDirectoryPath,
            'out/extension.js'
        );

        expect(resolved).toBe(fs.realpathSync(path.join(workspaceDirectoryPath, 'out', 'extension.js')));

    });

    it('refuses a traversal that climbs out of the workspace', () => {

        const resolved = PackagedContentsChecker.resolveContainedWorkspacePath(
            workspaceDirectoryPath,
            'out/../../../../../../etc/hosts.js'
        );

        expect(resolved).toBeNull();

    });

    it('refuses an absolute path outright', () => {

        expect(PackagedContentsChecker.resolveContainedWorkspacePath(
            workspaceDirectoryPath,
            '/etc/hosts.js'
        )).toBeNull();

    });

    // readFileSync follows symlinks; "vsce ls" lists one as a plain file. Checking the lexical
    // path only would let a link inside the workspace read a target outside it.
    it('refuses a symlink whose target is outside the workspace', () => {

        const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-contents-outside-'));
        const outsideFile = path.join(outsideDirectory, 'secret.js');
        fs.writeFileSync(outsideFile, 'require("exfiltrated");', 'utf8');
        fs.symlinkSync(outsideFile, path.join(workspaceDirectoryPath, 'out', 'linked.js'));

        try {
            expect(PackagedContentsChecker.resolveContainedWorkspacePath(
                workspaceDirectoryPath,
                'out/linked.js'
            )).toBeNull();
        } finally {
            fs.rmSync(outsideDirectory, { recursive: true, force: true });
        }

    });

    it('still resolves a listed file that does not exist, so it is reported as missing not as an escape', () => {

        const resolved = PackagedContentsChecker.resolveContainedWorkspacePath(
            workspaceDirectoryPath,
            'out/neverWritten.js'
        );

        expect(resolved).toBe(path.join(fs.realpathSync(workspaceDirectoryPath), 'out', 'neverWritten.js'));

    });

    it('accepts a traversal that stays inside the workspace', () => {

        const resolved = PackagedContentsChecker.resolveContainedWorkspacePath(
            workspaceDirectoryPath,
            'out/../out/extension.js'
        );

        expect(resolved).toBe(fs.realpathSync(path.join(workspaceDirectoryPath, 'out', 'extension.js')));

    });

});

describe('PackagedContentsChecker.stripComments', () => {

    // The direction that matters: a dependency named only in a comment would keep assertion 2
    // green for something nothing loads -- exactly how #121 stayed hidden.
    it('does not count a require named in a whole-line comment', () => {

        expect(PackagedContentsChecker.collectBareModuleSpecifiers(
            '// legacy: require("jsforce")\nrequire("js-yaml");'
        )).toEqual(['js-yaml']);

    });

    it('does not count a require named in a block comment', () => {

        expect(PackagedContentsChecker.collectBareModuleSpecifiers(
            '/* require("jsforce")\n   require("ts-node") */\nrequire("js-yaml");'
        )).toEqual(['js-yaml']);

    });

    // A trailing "//" is deliberately not stripped: a "//" inside a string would truncate the
    // rest of a real line, turning a false positive into a false negative -- the worse direction.
    it('does not truncate a line carrying a url before a real require', () => {

        expect(PackagedContentsChecker.collectBareModuleSpecifiers(
            'const docs = "https://example.dev/x"; require("js-yaml");'
        )).toEqual(['js-yaml']);

    });

    // Known limitation, pinned so it is a decision rather than a surprise.
    it('still counts a require written inside a string literal', () => {

        expect(PackagedContentsChecker.collectBareModuleSpecifiers(
            'const help = \'run require("ts-node/register") first\';'
        )).toEqual(['ts-node/register']);

    });

});

describe('PackagedContentsChecker.isNodeBuiltinModule -- subpaths', () => {

    it('recognizes a builtin subpath, so it is never mistaken for a package', () => {

        expect(PackagedContentsChecker.isNodeBuiltinModule('fs/promises')).toBeTrue();
        expect(PackagedContentsChecker.isNodeBuiltinModule('stream/promises')).toBeTrue();

    });

    it('leaves a builtin subpath out of the required package names', () => {

        const requiredPackageNames = PackagedContentsChecker.collectRequiredPackageNames(
            ['out/builtins.js'],
            () => 'require("fs/promises"); require("node:path"); require("js-yaml");'
        );

        expect([...requiredPackageNames]).toEqual(['js-yaml']);

    });

});

describe('the checked-in allow list', () => {

    it('names only the eight paths the extension ships', () => {

        expect(TOP_LEVEL_PATH_ALLOW_LIST).toEqual([
            'CHANGELOG.md',
            'LICENSE',
            'README.md',
            'apexPicklistDependencyFramework',
            'images',
            'node_modules',
            'out',
            'package.json'
        ]);

    });

});

describe('this repository', () => {

    // Asserted as the PROPERTY rather than as a checked-in list of the four current dependencies.
    // A hand-maintained snapshot here would have to be edited whenever a real runtime dependency
    // is added -- the exact maintenance burden this guard exists to avoid.
    it('declares no runtime dependency the guard would reject', () => {

        const workspaceDirectoryPath = path.resolve(__dirname, '..', '..', '..');
        const extensionManifest = require(path.join(workspaceDirectoryPath, 'package.json'));

        expect(extensionManifest.devDependencies).toContainKey('ts-node');
        expect(extensionManifest.dependencies).not.toContainKey('ts-node');

        const declaredDependencyNames = Object.keys(extensionManifest.dependencies);
        const packagedSourcePaths = fs.readdirSync(path.join(workspaceDirectoryPath, 'out'))
            .filter(entry => entry.endsWith('.js'))
            .map(entry => `out/${entry}`);

        const requiredPackageNames = PackagedContentsChecker.collectRequiredPackageNames(
            packagedSourcePaths,
            packagedPath => fs.readFileSync(path.join(workspaceDirectoryPath, packagedPath), 'utf8')
        );

        // out/extension.js alone reaches the whole graph, so anything it never pulls in is not a
        // runtime dependency of the entry point.
        expect(requiredPackageNames).not.toContain('ts-node');
        expect(declaredDependencyNames).not.toContain('ts-node');

    });

});
