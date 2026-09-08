const fs = require('fs');

// esbuild's exports are non-configurable, so jest.spyOn cannot redefine them. A module factory is
// substituted before esbuild.js requires it instead, which also keeps the suite from shelling out
// to a real bundle just to assert which call the flags select.
jest.mock('esbuild', () => ({ build: jest.fn(), context: jest.fn() }));

const esbuild = require('esbuild');

const { ExtensionBundler, EXTERNAL_MODULES, OUTPUT_FILE } = require('./esbuild.js');

describe('ExtensionBundler.buildOptions', () => {

    // The two externals are load-bearing for entirely different reasons and both fail at RUNTIME
    // rather than at build time if dropped, which is the worst place to discover them: bundling
    // "vscode" produces an extension the host cannot activate, and bundling "@salesforce/core"
    // breaks org auth only once a user runs a command that touches an org.
    it('keeps vscode and @salesforce/core external', () => {

        const options = ExtensionBundler.buildOptions(true);

        expect(options.external).toIncludeSameMembers(['vscode', '@salesforce/core']);

    });

    it('does not let a caller mutate the shared external list', () => {

        ExtensionBundler.buildOptions(true).external.push('xml2js');

        expect(EXTERNAL_MODULES).toIncludeSameMembers(['vscode', '@salesforce/core']);

    });

    // The extension host loads a CommonJS module from "main". An ESM or browser build resolves
    // node builtins differently and fails on require, so these are not cosmetic defaults.
    it('emits a commonjs node bundle at the path package.json main points to', () => {

        const options = ExtensionBundler.buildOptions(true);

        expect(options.platform).toBe('node');
        expect(options.format).toBe('cjs');
        expect(options.bundle).toBeTrue();
        expect(options.outfile).toBe(OUTPUT_FILE);

        const packagedMainPath = require('./package.json').main.replace(/^\.\//, '');
        expect(packagedMainPath.replace(/\\/g, '/')).toBe(OUTPUT_FILE.replace(/\\/g, '/'));

    });

    it('minifies without a source map for a production build, and inverts both for a dev build', () => {

        expect(ExtensionBundler.buildOptions(true).minify).toBeTrue();
        expect(ExtensionBundler.buildOptions(true).sourcemap).toBeFalse();

        expect(ExtensionBundler.buildOptions(false).minify).toBeFalse();
        expect(ExtensionBundler.buildOptions(false).sourcemap).toBeTrue();

    });

});

describe('ExtensionBundler.parseArguments', () => {

    it('reads the flags the npm scripts pass', () => {

        expect(ExtensionBundler.parseArguments(['node', 'esbuild.js', '--production']))
            .toEqual({ isWatchRequested: false, isProductionBuild: true });

        expect(ExtensionBundler.parseArguments(['node', 'esbuild.js', '--watch']))
            .toEqual({ isWatchRequested: true, isProductionBuild: false });

    });

    it('treats a bare invocation as an unminified one-shot build', () => {

        expect(ExtensionBundler.parseArguments(['node', 'esbuild.js']))
            .toEqual({ isWatchRequested: false, isProductionBuild: false });

    });

});

describe('ExtensionBundler.clearOutputDirectory', () => {

    // vsce packages the WORKING DIRECTORY rather than the git index, so a tsc tree left in out/ by
    // a checkout from before #137 would ship alongside the bundle. Asserted through a spy rather
    // than by deleting the real directory, which the suite is running inside.
    it('removes the output directory recursively and tolerates its absence', () => {

        const removeSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined);

        ExtensionBundler.clearOutputDirectory();

        expect(removeSpy).toHaveBeenCalledWith('out', { recursive: true, force: true });

    });

});

describe('ExtensionBundler.run', () => {

    let consoleOutput;

    beforeEach(() => {
        jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
        esbuild.build.mockReset();
        esbuild.context.mockReset();
        consoleOutput = { log: jest.fn(), error: jest.fn() };
    });

    it('builds once for a production run and reports success', async () => {

        esbuild.build.mockResolvedValue({});

        const exitCode = await ExtensionBundler.run(['node', 'esbuild.js', '--production'], consoleOutput);

        expect(exitCode).toBe(0);
        expect(esbuild.build).toHaveBeenCalledWith(expect.objectContaining({ minify: true, bundle: true }));
        expect(consoleOutput.error).not.toHaveBeenCalled();

    });

    it('starts a watcher instead of a one-shot build when asked to watch', async () => {

        const watch = jest.fn().mockResolvedValue(undefined);
        esbuild.context.mockResolvedValue({ watch });
        esbuild.build.mockResolvedValue({});

        const exitCode = await ExtensionBundler.run(['node', 'esbuild.js', '--watch'], consoleOutput);

        expect(exitCode).toBe(0);
        expect(esbuild.context).toHaveBeenCalled();
        expect(watch).toHaveBeenCalled();
        expect(esbuild.build).not.toHaveBeenCalled();

    });

    // A bundling failure has to reach the shell as a non-zero exit, or "vscode:prepublish" would
    // hand vsce whatever stale out/ happened to be there and publish it.
    it('reports a non-zero exit code when bundling throws', async () => {

        esbuild.build.mockRejectedValue(new Error('Unresolved import'));

        const exitCode = await ExtensionBundler.run(['node', 'esbuild.js', '--production'], consoleOutput);

        expect(exitCode).toBe(1);
        expect(consoleOutput.error).toHaveBeenCalledWith(expect.stringContaining('Unresolved import'));

    });

});
