#!/usr/bin/env node
/*
    /pr-flow Phase 1, run as one script so a pass cannot be claimed without the checks running.
    Every check runs on the committed HEAD with nothing uncommitted; only when all pass is the
    commit written to .claude/flow-state/pr-flow-phase1.json, which flowGuard.js reads before any
    git push or PR. Supply chain (1g) stays the /supply-chain-check skill's call: its findings
    need judgement, so the skill reports them and the person decides.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const projectDirectory = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const phaseOnePassFile = path.join(projectDirectory, '.claude', 'flow-state', 'pr-flow-phase1.json');

function runGit(gitArguments) {
    return execFileSync('git', gitArguments, { cwd: projectDirectory, encoding: 'utf8' }).trim();
}

// THE FULL JEST RUN TAKES ABOUT FOUR MINUTES; A SCRIPT STILL RUNNING AFTER THIS IS TREATED AS A FAILURE, NEVER A PASS
const NPM_SCRIPT_TIMEOUT_MILLISECONDS = 15 * 60 * 1000;

function runNpmScript(scriptName) {
    const npmRun = spawnSync('npm', ['run', scriptName], { cwd: projectDirectory, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: NPM_SCRIPT_TIMEOUT_MILLISECONDS });
    const timeoutNote = npmRun.error ? `\nnpm run ${scriptName} did not finish: ${npmRun.error.message}` : '';
    return { isPassed: npmRun.status === 0, output: `${npmRun.stdout ?? ''}${npmRun.stderr ?? ''}${timeoutNote}` };
}

function listDebugArtifacts() {
    const sourceRoot = path.join(projectDirectory, 'src');
    const findings = [];
    const visit = (directoryPath) => fs.readdirSync(directoryPath, { withFileTypes: true }).forEach(entry => {
        const entryPath = path.join(directoryPath, entry.name);
        if ( entry.isDirectory() ) {
            visit(entryPath);
            return;
        }
        if ( !entry.name.endsWith('.ts') ) {
            return;
        }
        const relativePath = path.relative(projectDirectory, entryPath);
        const isTreecipeSource = relativePath.startsWith(path.join('src', 'treecipe') + path.sep) && !entry.name.endsWith('.test.ts');
        fs.readFileSync(entryPath, 'utf8').split('\n').forEach((sourceLine, lineIndex) => {
            if ( /\bdebugger\b/.test(sourceLine) || /console\.debug/.test(sourceLine) || ( isTreecipeSource && /console\.log/.test(sourceLine) ) ) {
                findings.push(`${relativePath}:${lineIndex + 1}: ${sourceLine.trim()}`);
            }
        });
    });
    visit(sourceRoot);
    return findings;
}

function readChangelogVersionMismatch() {
    const packageVersion = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8')).version;
    const changelogMatch = /^## \[?(\d+\.\d+\.\d+)/m.exec(fs.readFileSync(path.join(projectDirectory, 'CHANGELOG.md'), 'utf8'));
    const changelogVersion = changelogMatch ? changelogMatch[1] : 'not found';
    return changelogVersion === packageVersion ? undefined : `package.json is ${packageVersion}, the top CHANGELOG.md entry is ${changelogVersion}`;
}

// THE PHASE 1 CHECKS OF .claude/commands/pr-flow.md, CHEAPEST FIRST SO A FAILURE STOPS BEFORE THE FOUR-MINUTE TEST RUN: EACH RETURNS undefined ON A PASS, ELSE WHAT FAILED
const PHASE_ONE_CHECKS = [
    ['1a compile', () => { const result = runNpmScript('compile'); return result.isPassed ? undefined : result.output.slice(-3000); }],
    ['1c lint (zero errors)', () => { const result = runNpmScript('lint'); return result.isPassed ? undefined : result.output.slice(-3000); }],
    ['1d debug artifacts', () => { const findings = listDebugArtifacts(); return findings.length === 0 ? undefined : findings.join('\n'); }],
    ['1e CHANGELOG version sync', readChangelogVersionMismatch],
    ['1b tests', () => { const result = runNpmScript('jest-test'); return result.isPassed ? undefined : result.output.split('\n').filter(outputLine => /^(FAIL|Tests:|Test Suites:)|●/.test(outputLine)).slice(0, 60).join('\n'); }]
];

const headCommit = runGit(['rev-parse', 'HEAD']);
if ( runGit(['status', '--porcelain', '--untracked-files=no']) !== '' ) {
    console.error('Phase 1 checks the committed HEAD: commit or stash the uncommitted changes first.');
    process.exit(1);
}

fs.rmSync(phaseOnePassFile, { force: true });
const failedChecks = [];
for ( const [checkName, runCheck] of PHASE_ONE_CHECKS ) {
    console.log(`… ${checkName}`);
    const failure = runCheck();
    console.log(failure === undefined ? `✅ ${checkName}` : `❌ ${checkName}\n${failure}`);
    if ( failure !== undefined ) {
        failedChecks.push(checkName);
        break;
    }
}

if ( runGit(['rev-parse', 'HEAD']) !== headCommit || runGit(['status', '--porcelain', '--untracked-files=no']) !== '' ) {
    console.error('HEAD or the working tree changed while the checks ran; nothing recorded. Run Phase 1 again.');
    process.exit(1);
}
if ( failedChecks.length > 0 ) {
    console.error(`Phase 1 failed: ${failedChecks.join(', ')}. Nothing recorded, so push and PR creation stay blocked.`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(phaseOnePassFile), { recursive: true });
fs.writeFileSync(phaseOnePassFile, JSON.stringify({ commit: headCommit, passedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Phase 1 passed on ${headCommit.slice(0, 7)}; push and PR creation are allowed for this commit.`);
