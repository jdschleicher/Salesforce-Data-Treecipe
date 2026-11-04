#!/usr/bin/env node
/*
    Holds Claude Code sessions in this repository to its flows (/next-task, /pr-flow).
    Wired in .claude/settings.json; each hook event calls one mode:

      record-prompt  UserPromptSubmit  "/next-task N" starts issue N; "approve plan #N" approves its plan
      guard-edit     PreToolUse        no Write/Edit under src/ until the current issue's plan is approved
      guard-bash     PreToolUse        the same for shell writes into src/; no git push or `gh pr create`
                                       until prFlowPhase1.js passed on HEAD with nothing uncommitted
      guard-pr       PreToolUse        no PR created through the GitHub tools on the same terms

    Approval comes only from the person's own message, through record-prompt, and the Phase 1 record
    only from prFlowPhase1.js, which runs the checks itself. Claude cannot write either record:
    every guard refuses a write into .claude/flow-state/.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDirectory = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const flowStateDirectory = path.join(projectDirectory, '.claude', 'flow-state');
const currentTaskFile = path.join(flowStateDirectory, 'current-task.json');
const phaseOnePassFile = path.join(flowStateDirectory, 'pr-flow-phase1.json');

// FOLDERS WHOSE FILES ARE THE ISSUE'S WORK: CHANGING THEM NEEDS AN APPROVED /next-task PLAN
const PLAN_GUARDED_FOLDERS = ['src'];

const NEXT_TASK_PROMPT = /^\s*\/next-task\s+#?(\d+)\b/i;
const PLAN_APPROVAL_PROMPT = /\bapprove\s+plan\s+#(\d+)\b/i;

const GIT_PUSH_COMMAND = /\bgit\b(?:\s+-[^\s]+(?:\s+\S+)?)*\s+push\b/;
const GH_PR_CREATE_COMMAND = /\bgh\s+pr\s+create\b/;
const SHELL_WRITE_COMMAND = /(?:\bsed\s+(?:-[a-zA-Z]*i|--in-place)|>>?|\btee\b|\bcp\b|\bmv\b|\brm\b|\btouch\b|\bmkdir\b|\bgit\s+(?:apply|checkout|restore|stash\s+pop|cherry-pick|am)\b|writeFile|write_text|open\([^)]*['"]w)/;

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
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    process.exit(0);
}

function runGit(gitArguments) {
    return execFileSync('git', gitArguments, { cwd: projectDirectory, encoding: 'utf8' }).trim();
}

function toProjectRelativePath(filePath) {
    return path.relative(projectDirectory, path.resolve(projectDirectory, filePath)).split(path.sep).join('/');
}

function isInsideFolder(relativePath, folderName) {
    return relativePath === folderName || relativePath.startsWith(`${folderName}/`);
}

function isPlanGuardedPath(filePath) {
    const relativePath = toProjectRelativePath(filePath);
    return PLAN_GUARDED_FOLDERS.some(folderName => isInsideFolder(relativePath, folderName));
}

function isFlowStatePath(filePath) {
    return isInsideFolder(toProjectRelativePath(filePath), '.claude/flow-state');
}

// WHY CHANGING THE ISSUE'S FILES IS REFUSED RIGHT NOW, OR undefined WHEN THE CURRENT PLAN IS APPROVED
function findPlanApprovalRefusal() {
    const currentTask = readJsonFile(currentTaskFile);
    if ( !currentTask ) {
        return 'No issue is in progress. Start one with `/next-task <N>`, post its plan, and wait for the person to reply `approve plan #<N>`.';
    }
    if ( currentTask.approvedAt === undefined ) {
        return `Issue #${currentTask.issueNumber}'s /next-task plan is not approved yet. Post the plan (Step 4) and wait for the person to reply \`approve plan #${currentTask.issueNumber}\`.`;
    }
    return undefined;
}

// WHY A PUSH OR A PR IS REFUSED RIGHT NOW, OR undefined WHEN /pr-flow PHASE 1 PASSED ON THIS EXACT COMMIT
function findPhaseOneRefusal() {
    const headCommit = runGit(['rev-parse', 'HEAD']);
    const uncommittedChanges = runGit(['status', '--porcelain', '--untracked-files=no']);
    const phaseOnePass = readJsonFile(phaseOnePassFile);
    if ( uncommittedChanges !== '' ) {
        return 'There are uncommitted changes. Commit them, run `node .claude/hooks/prFlowPhase1.js` (/pr-flow Phase 1), then push.';
    }
    if ( !phaseOnePass || phaseOnePass.commit !== headCommit ) {
        return `/pr-flow Phase 1 has not passed on HEAD (${headCommit.slice(0, 7)}). Run \`node .claude/hooks/prFlowPhase1.js\`; it records a pass only when every check passes.`;
    }
    return undefined;
}

function recordPrompt() {
    const promptText = String(readHookInput().prompt ?? '');
    const nextTaskMatch = NEXT_TASK_PROMPT.exec(promptText);
    const approvalMatch = PLAN_APPROVAL_PROMPT.exec(promptText);
    const currentTask = readJsonFile(currentTaskFile);

    if ( nextTaskMatch && Number(nextTaskMatch[1]) !== currentTask?.issueNumber ) {
        writeJsonFile(currentTaskFile, { issueNumber: Number(nextTaskMatch[1]), startedAt: new Date().toISOString() });
        process.stdout.write(JSON.stringify({ systemMessage: `Flow guard: issue #${nextTaskMatch[1]} started. src/ stays read-only until you reply "approve plan #${nextTaskMatch[1]}".` }));
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
        deny('.claude/flow-state/ holds the flow guard\'s records; only the person\'s own message and prFlowPhase1.js write there.');
    }
    if ( isPlanGuardedPath(filePath) ) {
        const refusal = findPlanApprovalRefusal();
        if ( refusal ) {
            deny(`${toProjectRelativePath(filePath)} is under src/. ${refusal}`);
        }
    }
}

function guardBash() {
    const shellCommand = String(readHookInput().tool_input?.command ?? '');
    const isPhaseOneScript = /\.claude\/hooks\/prFlowPhase1\.js\b/.test(shellCommand) && !/[;&|]/.test(shellCommand.replace(/2>&1/g, ''));

    if ( /\.claude\/flow-state\b/.test(shellCommand) && !isPhaseOneScript ) {
        deny('.claude/flow-state/ holds the flow guard\'s records; only the person\'s own message and prFlowPhase1.js write there.');
    }
    if ( GIT_PUSH_COMMAND.test(shellCommand) || GH_PR_CREATE_COMMAND.test(shellCommand) ) {
        const refusal = findPhaseOneRefusal();
        if ( refusal ) {
            deny(refusal);
        }
    }
    const mentionsGuardedFolder = PLAN_GUARDED_FOLDERS.some(folderName => new RegExp(`(?:^|[\\s'"=./])${folderName}/`).test(shellCommand));
    if ( mentionsGuardedFolder && SHELL_WRITE_COMMAND.test(shellCommand) ) {
        const refusal = findPlanApprovalRefusal();
        if ( refusal ) {
            deny(`This command looks like it writes under src/. ${refusal} (A read-only command is not refused; rephrase it if it was misread.)`);
        }
    }
}

function guardPullRequest() {
    readHookInput();
    const refusal = findPhaseOneRefusal();
    if ( refusal ) {
        deny(refusal);
    }
}

const HOOK_MODES = { 'record-prompt': recordPrompt, 'guard-edit': guardEdit, 'guard-bash': guardBash, 'guard-pr': guardPullRequest };

const hookMode = HOOK_MODES[process.argv[2]];
if ( !hookMode ) {
    process.stderr.write(`flowGuard.js: unknown mode "${process.argv[2]}"; expected one of ${Object.keys(HOOK_MODES).join(', ')}\n`);
    process.exit(2);
}
hookMode();
