#!/usr/bin/env node
'use strict';

/**
 * CI runner for the picklist dependency check.
 *
 * Executes scripts/apex/runPicklistDependencyChecks.apex against a target org with the
 * Salesforce CLI and translates the result into an exit code a pipeline can gate on:
 *
 *   0  all expected picklist dependency combinations still valid
 *   1  at least one expectation failed (drift detected)
 *   2  the check could not run: CLI missing, Apex failed to compile, or unparseable output
 *
 * Target org resolution (first match wins):
 *   --target-org <alias>  CLI flag passed to this script
 *   $SF_TARGET_ORG        environment variable
 *   otherwise             the CLI's default org
 */

const path = require('path');
const { spawnSync } = require('child_process');

const EXIT_PASS = 0;
const EXIT_EXPECTATION_FAILURE = 1;
const EXIT_CANNOT_RUN = 2;

const RESULT_MARKER = 'PICKLIST_DEPENDENCY_CHECK_RESULT=';

function resolveTargetOrg(argv) {
    const flagIndex = argv.indexOf('--target-org');
    if (flagIndex !== -1 && argv[flagIndex + 1]) {
        return argv[flagIndex + 1];
    }
    return process.env.SF_TARGET_ORG || null;
}

function fail(message) {
    console.error(`[picklist-dependency-check] ${message}`);
    process.exit(EXIT_CANNOT_RUN);
}

function main() {
    const apexFile = path.join(__dirname, 'runPicklistDependencyChecks.apex');
    const targetOrg = resolveTargetOrg(process.argv.slice(2));

    const sfArgs = ['apex', 'run', '--file', apexFile, '--json'];
    if (targetOrg) {
        sfArgs.push('--target-org', targetOrg);
    }

    const result = spawnSync('sf', sfArgs, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });

    if (result.error) {
        if (result.error.code === 'ENOENT') {
            fail('the Salesforce CLI ("sf") is not installed or not on PATH. Install it and authorize a target org.');
        }
        fail(`failed to spawn the Salesforce CLI: ${result.error.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (parseError) {
        console.error(result.stdout || '');
        console.error(result.stderr || '');
        fail(`could not parse Salesforce CLI JSON output: ${parseError.message}`);
    }

    const runResult = parsed && parsed.result ? parsed.result : null;
    if (!runResult) {
        fail('Salesforce CLI returned no result payload.');
    }

    if (runResult.compiled === false) {
        fail(`anonymous Apex failed to compile: ${runResult.compileProblem || 'unknown compile error'}`);
    }

    if (runResult.success === false) {
        fail(`anonymous Apex failed at runtime: ${runResult.exceptionMessage || 'unknown runtime error'}`);
    }

    const logs = typeof runResult.logs === 'string' ? runResult.logs : '';
    console.log(logs);

    if (logs.includes(`${RESULT_MARKER}FAIL`)) {
        console.error('[picklist-dependency-check] picklist dependency drift detected — see report above.');
        process.exit(EXIT_EXPECTATION_FAILURE);
    }

    if (logs.includes(`${RESULT_MARKER}EMPTY`)) {
        fail('no picklist dependency specs are registered — this run verified nothing. Add specs to PicklistDependencySpecs.all().');
    }

    if (logs.includes(`${RESULT_MARKER}PASS`)) {
        console.log('[picklist-dependency-check] all expected picklist dependency combinations still valid.');
        process.exit(EXIT_PASS);
    }

    fail('the Apex run produced no result marker; cannot determine pass or fail.');
}

main();
