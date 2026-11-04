#!/usr/bin/env node
/*
    Holds Claude Code sessions in this repository to its flows (/next-task, /pr-flow).
    Wired in .claude/settings.json; each hook event calls one mode:

      record-prompt          UserPromptSubmit  "/next-task N" starts issue N; a message that is exactly
                                               "approve plan #N" approves its plan
      guard-edit             PreToolUse        no Write/Edit of a guarded path until the plan is approved
      guard-bash             PreToolUse        the same for shell writes; no push or PR creation until
                                               prFlowPhase1.js passed on HEAD (see findPushRefusal)
      guard-github           PreToolUse        the GitHub tools' writes to the remote, on the same terms
      check-guarded-changes  PostToolUse       reports any uncommitted change to a guarded path made
                                               with no approved plan, whatever made it

    It stops a well-meaning session skipping a flow by accident. It cannot stop one set on evading it
    (a shell can always build a path these checks do not see); the push guard is the hard gate, and
    the limits are listed in CHANGELOG 3.192.4.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDirectory = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const flowStateDirectory = path.join(projectDirectory, '.claude', 'flow-state');
const currentTaskFile = path.join(flowStateDirectory, 'current-task.json');
const phaseOnePassFile = path.join(flowStateDirectory, 'pr-flow-phase1.json');

// PATHS AN ISSUE'S WORK CHANGES, AND THE FILES THAT DECIDE WHAT THE GUARD AND PHASE 1 CHECK: NONE CHANGES WITHOUT AN APPROVED PLAN
const PLAN_GUARDED_PATHS = ['src', '.claude/hooks', '.claude/settings.json', '.claude/settings.local.json', 'package.json', 'package-lock.json'];

const NEXT_TASK_PROMPT = /^\s*\/next-task\s+#?(\d+)\b/i;
const PLAN_APPROVAL_PROMPT = /^\s*approve\s+plan\s+#(\d+)\s*[.!]?\s*$/i;

// SHELL COMMANDS THAT SEND WORK TO THE REMOTE: EACH IS REFUSED UNTIL PHASE 1 PASSED ON HEAD
const REMOTE_WRITE_COMMANDS = [
    ['git push', /\bgit\b(?:\s+-[^\s]+(?:\s+\S+)?)*\s+push\b/],
    ['a git alias set inline', /\bgit\b[^|;&]*\s-c\s+["']?alias\./],
    ['git send-pack', /\bgit\s+send-pack\b/],
    ['git push (quoted)', /["']git["']\s+push\b/],
    ['gh pr create', /\bgh\s+pr\s+(?:create|new)\b/],
    ['gh pr merge', /\bgh\s+pr\s+merge\b/],
    ['gh api POST', /\bgh\s+api\b[^|;&]*(?:-X\s*POST|--method\s+POST|\s-f\s|\s-F\s|--field|--raw-field)/i]
];

// SHELL COMMANDS THAT CAN WRITE A FILE NAMED IN THEM
const SHELL_WRITE_COMMANDS = [
    ['sed -i', /\bsed\s+(?:-[a-zA-Z]*i|--in-place)/],
    ['perl -i', /\bperl\s+-[a-zA-Z]*i/],
    ['a redirect', />>?/],
    ['tee, cp, mv, rm, touch, mkdir, ln, install, dd, patch, truncate', /\b(?:tee|cp|mv|rm|touch|mkdir|ln|install|dd|patch|truncate)\b/],
    ['a git command that rewrites files', /\bgit\s+(?:apply|checkout|restore|reset|stash|cherry-pick|am|merge|rebase|revert|clean)\b/],
    ['a script writing files', /writeFile|appendFile|write_text|open\([^)]*['"][wa]|copyFile|rename/]
];

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readHookInput() {
    try {
        return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function deny(reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Flow guard: ${reason}` } }));
    process.exit(0);
}

function runGit(gitArguments) {
    return execFileSync('git', gitArguments, { cwd: projectDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// A WORKTREE UNDER .claude/worktrees/<name>/ IS THE SAME PROJECT, SO ITS src/ IS GUARDED AS src/
function toProjectRelativePath(filePath) {
    const relativePath = path.relative(projectDirectory, path.resolve(projectDirectory, filePath)).split(path.sep).join('/');
    return relativePath.replace(/^\.claude\/worktrees\/[^/]+\//, '');
}

function isInsidePath(relativePath, guardedPath) {
    return relativePath === guardedPath || relativePath.startsWith(`${guardedPath}/`);
}

function isPlanGuardedPath(filePath) {
    const relativePath = toProjectRelativePath(filePath);
    return PLAN_GUARDED_PATHS.some(guardedPath => isInsidePath(relativePath, guardedPath));
}

function isFlowStatePath(filePath) {
    return toProjectRelativePath(filePath).split('/').includes('flow-state');
}

function readApprovedTask() {
    const currentTask = readJsonFile(currentTaskFile);
    return currentTask?.approvedAt !== undefined ? currentTask : undefined;
}

// WHY CHANGING A GUARDED PATH IS REFUSED RIGHT NOW, OR undefined WHEN THE CURRENT PLAN IS APPROVED
function findPlanApprovalRefusal() {
    const currentTask = readJsonFile(currentTaskFile);
    if ( !currentTask ) {
        return 'no issue is in progress. Start one with `/next-task <N>`, post its plan, and wait for the person to reply with exactly `approve plan #<N>`.';
    }
    if ( currentTask.approvedAt === undefined ) {
        return `issue #${currentTask.issueNumber}'s /next-task plan is not approved yet. Post the plan and wait for the person to reply with exactly \`approve plan #${currentTask.issueNumber}\`.`;
    }
    return undefined;
}

// WHY A PUSH OR PR IS REFUSED RIGHT NOW, OR undefined: PHASE 1 PASSED ON THIS EXACT COMMIT, NOTHING IS UNCOMMITTED, AND src/ WORK HAS AN APPROVED PLAN
function findPushRefusal() {
    const headCommit = runGit(['rev-parse', 'HEAD']);
    if ( runGit(['status', '--porcelain', '--untracked-files=no']) !== '' ) {
        return 'there are uncommitted changes. Commit them, run `node .claude/hooks/prFlowPhase1.js` (/pr-flow Phase 1), then push.';
    }
    const phaseOnePass = readJsonFile(phaseOnePassFile);
    if ( !phaseOnePass || phaseOnePass.commit !== headCommit ) {
        return `/pr-flow Phase 1 has not passed on HEAD (${headCommit.slice(0, 7)}). Run \`node .claude/hooks/prFlowPhase1.js\` with the Bash timeout at 1200000; it records a pass only when every check passes.`;
    }
    const changedGuardedFiles = listBranchChangesToGuardedPaths();
    if ( changedGuardedFiles.length > 0 && !readApprovedTask() ) {
        return `this branch changes ${changedGuardedFiles.slice(0, 3).join(', ')}${changedGuardedFiles.length > 3 ? ' and more' : ''} with no approved /next-task plan. ${findPlanApprovalRefusal()}`;
    }
    return undefined;
}

function listBranchChangesToGuardedPaths() {
    try {
        return runGit(['diff', '--name-only', 'origin/main...HEAD', '--', 'src']).split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function listUncommittedGuardedChanges() {
    return runGit(['status', '--porcelain', '--', ...PLAN_GUARDED_PATHS]).split('\n').filter(Boolean).map(statusLine => statusLine.replace(/^\S{1,2}\s+/, ''));
}

function recordPrompt() {
    const promptText = String(readHookInput().prompt ?? '');
    const nextTaskMatch = NEXT_TASK_PROMPT.exec(promptText);
    const approvalMatch = PLAN_APPROVAL_PROMPT.exec(promptText);
    const currentTask = readJsonFile(currentTaskFile);

    if ( nextTaskMatch && Number(nextTaskMatch[1]) !== currentTask?.issueNumber ) {
        writeJsonFile(currentTaskFile, { issueNumber: Number(nextTaskMatch[1]), startedAt: new Date().toISOString() });
        process.stdout.write(JSON.stringify({ systemMessage: `Flow guard: issue #${nextTaskMatch[1]} started. src/ stays read-only until you reply with exactly "approve plan #${nextTaskMatch[1]}".` }));
        return;
    }

    if ( approvalMatch ) {
        const approvedIssueNumber = Number(approvalMatch[1]);
        if ( currentTask?.issueNumber !== approvedIssueNumber ) {
            process.stdout.write(JSON.stringify({ systemMessage: `Flow guard: nothing approved. The issue in progress is ${currentTask ? `#${currentTask.issueNumber}` : 'none'}, not #${approvedIssueNumber}; start it with /next-task ${approvedIssueNumber} first.` }));
            return;
        }
        writeJsonFile(currentTaskFile, { ...currentTask, approvedAt: new Date().toISOString() });
        process.stdout.write(JSON.stringify({ systemMessage: `Flow guard: plan for #${approvedIssueNumber} approved; src/ can be changed.` }));
    }
}

function guardEdit() {
    const toolInput = readHookInput().tool_input ?? {};
    const filePath = toolInput.file_path ?? toolInput.notebook_path;
    if ( typeof filePath !== 'string' ) {
        return;
    }
    if ( isFlowStatePath(filePath) ) {
        deny('.claude/flow-state/ holds the guard\'s records; only the person\'s own message and prFlowPhase1.js write there.');
    }
    if ( isPlanGuardedPath(filePath) ) {
        const refusal = findPlanApprovalRefusal();
        if ( refusal ) {
            deny(`${toProjectRelativePath(filePath)} is guarded: ${refusal}`);
        }
    }
}

function guardBash() {
    const shellCommand = String(readHookInput().tool_input?.command ?? '');

    if ( /flow-state/.test(shellCommand) ) {
        deny('.claude/flow-state/ holds the guard\'s records; only the person\'s own message and prFlowPhase1.js write there. Read them with the Read tool.');
    }
    const remoteWrite = REMOTE_WRITE_COMMANDS.find(([, commandPattern]) => commandPattern.test(shellCommand));
    if ( remoteWrite ) {
        const refusal = findPushRefusal();
        if ( refusal ) {
            deny(`${remoteWrite[0]} is refused: ${refusal}`);
        }
    }
    const namedGuardedPath = PLAN_GUARDED_PATHS.find(guardedPath => new RegExp(`(?:^|[\\s'"=./])${guardedPath.replace(/\./g, '\\.')}(?:/|\\b)`).test(shellCommand));
    const shellWrite = SHELL_WRITE_COMMANDS.find(([, commandPattern]) => commandPattern.test(shellCommand.replace(/\d?>&\d|2>\/dev\/null/g, '')));
    if ( namedGuardedPath && shellWrite ) {
        const refusal = findPlanApprovalRefusal();
        if ( refusal ) {
            deny(`this command names ${namedGuardedPath} and uses ${shellWrite[0]}: ${refusal} (A read-only command is not refused; rephrase it if it was misread.)`);
        }
    }
}

function guardGithub() {
    const toolName = String(readHookInput().tool_name ?? '');
    if ( /merge_pull_request|enable_pr_auto_merge/.test(toolName) ) {
        deny('merging a pull request is the person\'s decision; ask them to merge it.');
    }
    const refusal = findPushRefusal();
    if ( refusal ) {
        deny(`${toolName.replace('mcp__github__', '')} writes to GitHub and is refused: ${refusal}`);
    }
}

// AFTER ANY TOOL: A GUARDED CHANGE MADE WITHOUT AN APPROVED PLAN IS REPORTED BACK, HOWEVER IT WAS MADE (cd src && …, eslint --fix, git checkout -- .)
function checkGuardedChanges() {
    readHookInput();
    const refusal = findPlanApprovalRefusal();
    if ( !refusal ) {
        return;
    }
    const uncommittedGuardedChanges = listUncommittedGuardedChanges();
    if ( uncommittedGuardedChanges.length > 0 ) {
        process.stdout.write(JSON.stringify({
            decision: 'block',
            reason: `Flow guard: ${uncommittedGuardedChanges.slice(0, 5).join(', ')}${uncommittedGuardedChanges.length > 5 ? ' and more' : ''} changed with no approved plan. Put them back (git diff shows what changed; git checkout -- <file> reverts a file) or stop and ask the person: ${refusal}`
        }));
    }
}

const HOOK_MODES = { 'record-prompt': recordPrompt, 'guard-edit': guardEdit, 'guard-bash': guardBash, 'guard-github': guardGithub, 'guard-pr': guardGithub, 'check-guarded-changes': checkGuardedChanges };
const GUARD_MODES = new Set(['guard-edit', 'guard-bash', 'guard-github', 'guard-pr']);

const hookModeName = process.argv[2];
const hookMode = HOOK_MODES[hookModeName];
if ( !hookMode ) {
    process.stderr.write(`flowGuard.js: unknown mode "${hookModeName}"; expected one of ${Object.keys(HOOK_MODES).join(', ')}\n`);
    process.exit(2);
}
try {
    hookMode();
} catch (guardError) {
    // A GUARD THAT CANNOT DECIDE REFUSES: AN ERROR MUST NEVER LET A PUSH OR A GUARDED WRITE THROUGH
    if ( GUARD_MODES.has(hookModeName) ) {
        deny(`the check could not run (${guardError instanceof Error ? guardError.message.split('\n')[0] : String(guardError)}). Run it from inside the repository with git available.`);
    }
    process.stderr.write(`flowGuard.js ${hookModeName}: ${guardError instanceof Error ? guardError.message : String(guardError)}\n`);
}
