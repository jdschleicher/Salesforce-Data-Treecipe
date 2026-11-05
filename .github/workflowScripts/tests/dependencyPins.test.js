const fs = require('fs');
const path = require('path');

/*
    CI's "npm ci" installs only what package-lock.json locks, but a developer's "npm install" or
    "npm update" moves a "^" range to whatever was published last -- a hijacked release included --
    and writes it into the lockfile unreviewed (#588). So every direct dependency is one exact
    version, equal to the locked one, and changes only in a PR that names it.
*/
const REPOSITORY_ROOT_PATH = path.join(__dirname, '..', '..', '..');
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies'];
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function readRepositoryJson(fileName) {
    return JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT_PATH, fileName), 'utf8'));
}

function listDependencyEntries(manifest) {
    return DEPENDENCY_SECTIONS.flatMap(sectionName =>
        Object.entries(manifest[sectionName] || {}).map(([packageName, versionSpec]) =>
            ({ sectionName, packageName, versionSpec })));
}

function findUnpinnedDependencies(manifest) {
    return listDependencyEntries(manifest)
        .filter(({ versionSpec }) => !EXACT_VERSION_PATTERN.test(versionSpec));
}

function describeUnpinnedDependency({ sectionName, packageName, versionSpec }, lockedVersion) {
    return `${packageName} in ${sectionName} is "${versionSpec}", not an exact version. `
        + `Pin it to the locked version${lockedVersion ? ` "${lockedVersion}"` : ''} `
        + '(package-lock.json packages["node_modules/' + packageName + '"].version).';
}

const manifest = readRepositoryJson('package.json');
const lockfile = readRepositoryJson('package-lock.json');
const dependencyEntries = listDependencyEntries(manifest);

function lockedVersionOf(packageName) {
    return lockfile.packages[`node_modules/${packageName}`]?.version;
}

describe('every package.json dependency is pinned to its locked version', () => {

    test('there are dependencies to check, so this cannot pass by finding none', () => {
        expect(dependencyEntries).not.toHaveLength(0);
    });

    test.each(dependencyEntries)('$packageName ($sectionName)', (dependencyEntry) => {
        const lockedVersion = lockedVersionOf(dependencyEntry.packageName);
        const [unpinnedDependency] = findUnpinnedDependencies({ [dependencyEntry.sectionName]: { [dependencyEntry.packageName]: dependencyEntry.versionSpec } });

        if (unpinnedDependency) {
            throw new Error(describeUnpinnedDependency(unpinnedDependency, lockedVersion));
        }
        if (dependencyEntry.versionSpec !== lockedVersion) {
            throw new Error(`${dependencyEntry.packageName} in ${dependencyEntry.sectionName} is "${dependencyEntry.versionSpec}" `
                + `but package-lock.json locks "${lockedVersion}". Run "npm install --ignore-scripts" so the lockfile `
                + 'matches, in a PR that names this package and runs /supply-chain-check.');
        }
    });

    test('the lockfile root entry carries the same exact specs as package.json', () => {
        for (const sectionName of DEPENDENCY_SECTIONS) {
            expect(lockfile.packages[''][sectionName]).toEqual(manifest[sectionName]);
        }
    });

    // vsce refuses to package when @types/vscode is newer than the oldest VS Code the extension
    // claims to support; a "^" range hid that, since vsce compares the range's floor (#588).
    test('@types/vscode is the engines.vscode floor, so the types cannot offer an API the oldest supported VS Code lacks', () => {
        const engineFloorMatch = /^\^(\d+\.\d+\.\d+)$/.exec(manifest.engines.vscode);
        if (!engineFloorMatch) {
            throw new Error(`engines.vscode is "${manifest.engines.vscode}"; this check reads its floor from a "^x.y.z" range. `
                + 'Update the check if the engines range form changed.');
        }
        if (manifest.devDependencies['@types/vscode'] !== engineFloorMatch[1]) {
            throw new Error(`@types/vscode is "${manifest.devDependencies['@types/vscode']}" but engines.vscode is "${manifest.engines.vscode}". `
                + `vsce refuses to package newer types; pin @types/vscode to "${engineFloorMatch[1]}" or raise engines.vscode in the same PR.`);
        }
    });

    test('.npmrc makes npm install --save write exact versions', () => {
        const npmrcLines = fs.readFileSync(path.join(REPOSITORY_ROOT_PATH, '.npmrc'), 'utf8')
            .split(/\r?\n/).map(line => line.trim());
        expect(npmrcLines).toContain('save-exact=true');
    });

});

describe('findUnpinnedDependencies', () => {

    test('accepts an exact version', () => {
        expect(findUnpinnedDependencies({ devDependencies: { jest: '29.7.0' } })).toEqual([]);
    });

    test('refuses a caret range and names the package', () => {
        const unpinned = findUnpinnedDependencies({ devDependencies: { jest: '^29.7.0' } });

        expect(unpinned).toEqual([{ sectionName: 'devDependencies', packageName: 'jest', versionSpec: '^29.7.0' }]);
        expect(describeUnpinnedDependency(unpinned[0], '29.7.0'))
            .toBe('jest in devDependencies is "^29.7.0", not an exact version. Pin it to the locked version "29.7.0" '
                + '(package-lock.json packages["node_modules/jest"].version).');
    });

    test.each([
        '~1.2.3', '*', '1.x', '1.2.x', '>=1.0.0', '1.2.3 - 2.0.0', 'latest', '',
        '1.2.3-beta.1', 'github:owner/repo', 'git+https://github.com/owner/repo.git',
        'https://example.com/pkg.tgz', 'file:../pkg', 'npm:other@1.2.3'
    ])('refuses "%s"', (versionSpec) => {
        expect(findUnpinnedDependencies({ dependencies: { somePackage: versionSpec } }))
            .toEqual([{ sectionName: 'dependencies', packageName: 'somePackage', versionSpec }]);
    });

});
