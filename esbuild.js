// Bundles the extension into a single CommonJS file for packaging (#137).
//
// The extension used to ship unbundled: "vscode:prepublish" ran tsc and vsce then resolved the
// whole production dependency tree into the .vsix. 90% of the published bytes were node_modules
// rather than this project -- a 3.2 MB xml2js BROWSER bundle whose Node entry point is a
// different 1 KB file, faker's ESM half beside the .cjs half tsc output actually required, and
// ~70 locales nothing selects.
//
// tsc no longer emits anything. It runs with --noEmit purely as a typechecker, because esbuild
// strips types without checking them. That split is not a stylistic choice: output from BOTH
// tools landing in out/ would ship the entire tsc tree alongside the bundle, and the
// packaged-contents guard could not catch it -- tsc output legitimately requires faker, xml2js
// and js-yaml, so every assertion would pass while the package silently grew.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// "vscode" is injected by the extension host and is never installed, so it can never be bundled.
//
// "@salesforce/core" is external for an entirely different reason: it resolves files by path at
// runtime -- pino's thread-stream transports spawn workers from a file path -- which a bundler
// cannot rewrite. It therefore stays a real "dependency" and still ships from node_modules,
// while everything that IS inlined belongs in devDependencies. checkPackagedPaths.js asserts
// exactly that split, so this list and the manifest cannot drift apart unnoticed.
const EXTERNAL_MODULES = ['vscode', '@salesforce/core'];

const ENTRY_POINT = 'src/extension.ts';
const OUTPUT_DIRECTORY = 'out';
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'extension.js');

// VS Code 1.94 (the engines floor in package.json) runs on Node 20, which is also the version CI
// installs. Naming it here keeps esbuild from down-levelling syntax the host supports natively.
const NODE_TARGET = 'node20';

class ExtensionBundler {

    static buildOptions(isProductionBuild) {

        return {
            entryPoints: [ENTRY_POINT],
            outfile: OUTPUT_FILE,
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: NODE_TARGET,
            external: [...EXTERNAL_MODULES],
            minify: isProductionBuild,
            sourcemap: !isProductionBuild,
            logLevel: 'info'
        };

    }

    static parseArguments(commandLineArguments) {

        const flags = commandLineArguments.slice(2);

        return {
            isWatchRequested: flags.includes('--watch'),
            isProductionBuild: flags.includes('--production')
        };

    }

    // A developer upgrading across this change has a full tsc tree sitting in out/ from before it,
    // and vsce packages the WORKING DIRECTORY rather than the git index -- so that stale output
    // would ship. Clearing the directory makes each build's contents a function of this script
    // alone rather than of what the checkout happened to have run previously.
    static clearOutputDirectory() {

        fs.rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });

    }

    static async run(commandLineArguments, consoleOutput = console) {

        const { isWatchRequested, isProductionBuild } = this.parseArguments(commandLineArguments);
        const options = this.buildOptions(isProductionBuild);

        try {

            this.clearOutputDirectory();

            if (isWatchRequested) {
                const buildContext = await esbuild.context(options);
                await buildContext.watch();
                consoleOutput.log(`Watching ${ENTRY_POINT} -- rebuilding ${OUTPUT_FILE} on change.`);
                return 0;
            }

            await esbuild.build(options);
            consoleOutput.log(`Bundled ${ENTRY_POINT} to ${OUTPUT_FILE}.`);
            return 0;

        } catch (error) {
            consoleOutput.error(`Bundling failed: ${error.message}`);
            return 1;
        }

    }

}

module.exports = { ExtensionBundler, EXTERNAL_MODULES, ENTRY_POINT, OUTPUT_FILE, NODE_TARGET };

if (require.main === module) {
    ExtensionBundler.run(process.argv).then(exitCode => {
        // A watch build keeps the process alive through esbuild's own handles; exiting on 0 here
        // would kill it the moment it started.
        if (exitCode !== 0) {
            process.exit(exitCode);
        }
    });
}
