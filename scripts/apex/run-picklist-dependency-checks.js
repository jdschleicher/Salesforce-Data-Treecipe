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
 *   --target-org <alias>  CLI flag passed to this script (--target-org=<alias> also accepted)
 *   $SF_TARGET_ORG        environment variable
 *   otherwise             the CLI's default org
 */

const path = require('path');
const { spawnSync } = require('child_process');

const EXIT_PASS = 0;
const EXIT_EXPECTATION_FAILURE = 1;
const EXIT_CANNOT_RUN = 2;

const RESULT_MARKER = 'PICKLIST_DEPENDENCY_CHECK_RESULT=';

// On Windows the CLI is a .cmd shim, and a shim cannot be executed the way a real binary can.
// Since the Node fix for CVE-2024-27980, spawning a .cmd or .bat WITH arguments and WITHOUT a
// shell fails outright with EINVAL -- so naming "sf.cmd" directly does not preserve the argv
// form, it breaks every invocation on win32. The shell is therefore enabled on Windows only,
// with every argument quoted below. Other platforms keep the argv form exactly as before.
const IS_WINDOWS = process.platform === 'win32';
const SF_EXECUTABLE = IS_WINDOWS ? 'sf.cmd' : 'sf';

// A Salesforce org alias or username. Enforced because the value can come from argv or the
// environment, and on the Windows shell path an unvalidated value would be interpreted by
// cmd.exe rather than passed through. The leading character excludes "-" so a value can never
// be read as a flag instead of a value.
const TARGET_ORG_PATTERN = /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]*$/;

// Double quotes are the only quoting cmd.exe honours. A value containing one is rejected
// rather than escaped -- no real alias, username or path contains one, so rejecting beats
// guessing at cmd.exe's escaping rules.
function quoteWindowsArgument(argumentValue) {
    if (argumentValue.includes('"')) {
        throw new Error(`the value ${argumentValue} contains a double quote and cannot be passed to the Salesforce CLI on Windows.`);
    }
    return `"${argumentValue}"`;
}

function buildSpawnInvocation(sfArgs) {
    if (IS_WINDOWS) {
        return { args: sfArgs.map(quoteWindowsArgument), options: { shell: true } };
    }
    return { args: sfArgs, options: {} };
}

// Both spellings must be accepted. Silently ignoring --target-org=alias would fall through
// to the default org and check the wrong one -- passing green while verifying nothing,
// which is exactly what the EMPTY marker exists to prevent.
function resolveTargetOrg(argv) {
    const flagIndex = argv.indexOf('--target-org');
    if (flagIndex !== -1 && argv[flagIndex + 1]) {
        return argv[flagIndex + 1];
    }

    const inlineFlag = argv.find((argument) => argument.startsWith('--target-org='));
    if (inlineFlag) {
        const value = inlineFlag.slice('--target-org='.length);
        if (value) {
            return value;
        }
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
        if (!TARGET_ORG_PATTERN.test(targetOrg)) {
            fail(`"${targetOrg}" is not a usable Salesforce org alias or username.`);
        }
        sfArgs.push('--target-org', targetOrg);
    }

    let invocation;
    try {
        invocation = buildSpawnInvocation(sfArgs);
    } catch (invocationError) {
        fail(invocationError.message);
    }

    const result = spawnSync(SF_EXECUTABLE, invocation.args, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
        ...invocation.options
    });

    if (result.error) {
        if (result.error.code === 'ENOENT') {
            fail(`the Salesforce CLI ("${SF_EXECUTABLE}") is not installed or not on PATH. Install it and authorize a target org.`);
        }
        if (result.error.code === 'EINVAL') {
            fail(`the Salesforce CLI ("${SF_EXECUTABLE}") could not be started (EINVAL). Confirm the CLI is installed and on PATH.`);
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
        // A failed `sf` command (auth, unknown org) returns {status, name, message} with no
        // result key. Reporting "no result payload" hides the actual cause.
        const cliError = [parsed && parsed.name, parsed && parsed.message].filter(Boolean).join(': ');
        fail(cliError || 'Salesforce CLI returned no result payload.');
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
        fail('no picklist dependency specs are registered — this run verified nothing. Add specs to SFTreecipePicklistDependencySpecs.all().');
    }

    if (logs.includes(`${RESULT_MARKER}PASS`)) {
        console.log('[picklist-dependency-check] all expected picklist dependency combinations still valid.');
        process.exit(EXIT_PASS);
    }

    fail('the Apex run produced no result marker; cannot determine pass or fail.');
}

main();
