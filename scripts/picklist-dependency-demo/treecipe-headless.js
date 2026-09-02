#!/usr/bin/env node
'use strict';

/**
 * Headless driver for the picklist dependency services.
 *
 * The two VS Code commands cannot be invoked outside an extension host, so this calls the SAME
 * compiled services they call. That keeps the demo honest: it exercises the shipped code paths
 * rather than a reimplementation that could drift from them.
 *
 * The services import 'vscode', which does not exist outside the extension host, so the module
 * resolver is patched to hand back a stub for that one specifier. Only the surface the services
 * actually touch is stubbed.
 *
 *   node treecipe-headless.js generate <objectsDir> <classesDir> <apiVersion>
 *   node treecipe-headless.js check <targetOrg> <workspaceRoot>
 *
 * Exit codes for "check":
 *   0  every expected combination still valid
 *   1  drift detected
 *   2  the check could not run
 */

const path = require('path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'out', 'treecipe', 'src');

const fs = require('fs');

const FILE_TYPE = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

/*
    workspace.fs is backed by real node fs rather than left empty: the directory walk in
    collectSpecDetailsByObjectsDirectory genuinely reads metadata off disk, and stubbing it out
    would mean the demo exercised nothing. readDirectory returns the [name, FileType] tuples the
    VS Code API returns, and readFile returns a Uint8Array as the API does.
*/
const VSCODE_STUB = {
    window: {
        showWarningMessage() {},
        showInformationMessage() {},
        createOutputChannel() { return { clear() {}, appendLine() {}, show() {} }; }
    },
    workspace: {
        workspaceFolders: undefined,
        fs: {
            async readDirectory(directoryUri) {
                return fs.readdirSync(directoryUri.fsPath, { withFileTypes: true }).map(entry => {
                    let entryType = FILE_TYPE.Unknown;
                    if (entry.isDirectory()) { entryType = FILE_TYPE.Directory; }
                    else if (entry.isSymbolicLink()) { entryType = FILE_TYPE.SymbolicLink; }
                    else if (entry.isFile()) { entryType = FILE_TYPE.File; }
                    return [entry.name, entryType];
                });
            },
            async readFile(fileUri) {
                return new Uint8Array(fs.readFileSync(fileUri.fsPath));
            }
        }
    },
    Uri: {
        file: (filePath) => ({ fsPath: filePath }),
        joinPath: (baseUri, ...pathSegments) => ({ fsPath: path.join(baseUri.fsPath, ...pathSegments) })
    },
    FileType: FILE_TYPE
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') { return 'treecipe-vscode-stub'; }
    return originalResolveFilename.call(this, request, ...rest);
};
require.cache['treecipe-vscode-stub'] = new Module('treecipe-vscode-stub', null);
require.cache['treecipe-vscode-stub'].exports = VSCODE_STUB;
require.cache['treecipe-vscode-stub'].loaded = true;

function requireCompiledService(relativeServicePath) {
    const compiledPath = path.join(OUT_DIR, relativeServicePath);
    try {
        return require(compiledPath);
    } catch (requireError) {
        console.error(`[treecipe-headless] could not load ${compiledPath}`);
        console.error('[treecipe-headless] run "npm run compile" from the repository root first.');
        process.exit(2);
    }
}

async function generate(objectsDirectory, classesDirectory, apiVersion) {

    const { PicklistDependencyTestService } = requireCompiledService(
        'PicklistDependencyTestService/PicklistDependencyTestService'
    );

    const { GlobalValueSetSingleton } = requireCompiledService(
        'GlobalValueSetSingleton/GlobalValueSetSingleton'
    );

    /*
        A dependent picklist can take its values from a GLOBAL value set, whose values live beside
        the objects directory rather than in the field file. Spec generation reads them from this
        singleton, so the demo has to populate it for the same reason the command does -- without
        this every global-value-set-backed field is skipped as "set not found", and the demo's own
        tier 3 Planet__c field silently never gets a spec.

        The second argument gates whether initialize does ANY work: it returns immediately when
        false. The name reads like an "am I at startup" hint, so false looks like the value a caller
        should pass -- it is the opposite, and passing it makes this call a silent no-op.
    */
    const shouldReadGlobalValueSetsNow = true;
    const isMissingGlobalValueSetsDirectoryWarningShown = false;
    /*
        path.dirname rather than the service's getParentPath, which splits on '/' only: this driver
        is invoked from PowerShell on Windows too, where Join-Path hands over backslashes.
    */
    await GlobalValueSetSingleton.getInstance().initialize(
        path.dirname(objectsDirectory),
        shouldReadGlobalValueSetsNow,
        isMissingGlobalValueSetsDirectoryWarningShown
    );

    const collectionResult = await PicklistDependencyTestService.collectSpecDetailsByObjectsDirectory(
        VSCODE_STUB.Uri.file(objectsDirectory)
    );

    collectionResult.skippedFieldWarnings.forEach(warning => console.warn(`[treecipe-headless] skipped: ${warning}`));

    if (collectionResult.specDetails.length === 0) {
        console.error(`[treecipe-headless] no dependent picklists found under ${objectsDirectory}`);
        process.exit(2);
    }

    // writeSpecsClassFiles owns the per-object split, the aggregator and stale-class removal
    const specsClassWriteResult = PicklistDependencyTestService.writeSpecsClassFiles(
        classesDirectory,
        collectionResult.specDetails,
        apiVersion
    );

    PicklistDependencyTestService.writeSpecsTestClassFiles(
        classesDirectory,
        PicklistDependencyTestService.buildSpecsTestApexClassBody(collectionResult.specDetails),
        apiVersion
    );

    const objectApiNames = Object.keys(specsClassWriteResult.perObjectClassFilePathsByObjectApiName);
    console.log(`[treecipe-headless] generated ${collectionResult.specDetails.length} spec(s) across ${objectApiNames.length} object(s): ${objectApiNames.join(', ')}`);
    objectApiNames.forEach(objectApiName => {
        console.log(`[treecipe-headless]   ${objectApiName} -> ${path.basename(specsClassWriteResult.perObjectClassFilePathsByObjectApiName[objectApiName])}`);
    });
    console.log(`[treecipe-headless] aggregator: ${path.basename(specsClassWriteResult.aggregatorClassFilePath)}`);

    if (specsClassWriteResult.removedStaleClassFilePaths.length > 0) {
        console.log(`[treecipe-headless] removed ${specsClassWriteResult.removedStaleClassFilePaths.length} stale class(es): ${specsClassWriteResult.removedStaleClassFilePaths.map(stalePath => path.basename(stalePath)).join(', ')}`);
    }

    const legacyArtifactPaths = PicklistDependencyTestService.detectLegacyGeneratedArtifacts(classesDirectory);
    if (legacyArtifactPaths.length > 0) {
        console.warn(`[treecipe-headless] ${PicklistDependencyTestService.buildLegacyArtifactWarning(legacyArtifactPaths)}`);
    }

    console.log(`[treecipe-headless] written to ${classesDirectory}`);
}

async function check(targetOrg, workspaceRoot) {

    const { PicklistDependencyCheckService } = requireCompiledService(
        'PicklistDependencyCheckService/PicklistDependencyCheckService'
    );

    let checkOutcome;
    try {
        checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests(targetOrg);
    } catch (checkError) {
        console.error(`[treecipe-headless] ${checkError.message}`);
        process.exit(2);
    }

    console.log(PicklistDependencyCheckService.buildOutputChannelReport(targetOrg, checkOutcome));

    const isoDateTimestamp = new Date().toISOString().split('.')[0].replace(/:/g, '-');
    const resultsFolderPath = path.join(workspaceRoot, 'treecipe', 'PicklistDependencyResults');

    const writtenFolder = PicklistDependencyCheckService.writeCheckResultArtifacts(
        resultsFolderPath, targetOrg, isoDateTimestamp, checkOutcome
    );

    console.log(`[treecipe-headless] artifacts: ${writtenFolder}`);

    process.exit(checkOutcome.passed ? 0 : 1);
}

async function main() {

    const [command, ...commandArguments] = process.argv.slice(2);

    switch (command) {
        case 'generate':
            if (commandArguments.length < 3) {
                console.error('[treecipe-headless] usage: generate <objectsDir> <classesDir> <apiVersion>');
                process.exit(2);
            }
            return generate(commandArguments[0], commandArguments[1], commandArguments[2]);

        case 'check':
            if (commandArguments.length < 2) {
                console.error('[treecipe-headless] usage: check <targetOrg> <workspaceRoot>');
                process.exit(2);
            }
            return check(commandArguments[0], commandArguments[1]);

        default:
            console.error(`[treecipe-headless] unknown command "${command || ''}". Expected "generate" or "check".`);
            process.exit(2);
    }
}

main().catch(unexpectedError => {
    console.error(`[treecipe-headless] ${unexpectedError.stack || unexpectedError.message}`);
    process.exit(2);
});
