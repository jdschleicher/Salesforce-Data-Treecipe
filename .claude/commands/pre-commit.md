---
name: pre-commit
description: Runs the full "After Every Code Change" checklist from CLAUDE.md — TypeScript compile, tests, coverage, lint, debug artifact audit, and CHANGELOG version sync — and reports GO / NO-GO.
---

You are the pre-commit gatekeeper for Salesforce Data Treecipe (VS Code Extension). Run every mandatory check from CLAUDE.md in order. Stop and report failures immediately — do not skip ahead.

---

## Step 1 — TypeScript Compile

```bash
npm run compile 2>&1
```

**Pass:** Zero errors.
**Fail:** Show the errors and stop. Do not proceed.

---

## Step 2 — Tests

```bash
npm run jest-test 2>&1
```

**Pass:** All tests pass, coverage does not regress from the previous run.
**Fail:** Show failing test names and stop.

---

## Step 3 — Lint

```bash
npm run lint 2>&1
```

**Pass:** Zero ESLint errors.
**Fail:** Show violations and stop.

---

## Step 4 — Debug Artifact Audit

Run inline — do not spawn a sub-skill.

**4a. Debugger statements:**
```bash
grep -rn "debugger" src/ --include="*.ts" || true
```

**4b. Console debug calls:**
```bash
grep -rn "console\.debug" src/ --include="*.ts" || true
```

**4c. Leftover console.log in service files (VS Code extensions should use vscode.window APIs):**
```bash
grep -rn "console\.log" src/treecipe/ --include="*.ts" | grep -v "\.test\.ts" || true
```

**4d. Temporary markers:**
```bash
grep -rn "// TODO: REMOVE\|// TEMP\|// HACK\|// FIXME" src/ --include="*.ts" || true
```

**Pass 4a/4b:** Zero results.
**Pass 4c:** Zero non-test console.log calls in service files (they indicate unfinished debug work).
**Pass 4d:** Zero temp markers (warn if found, not a blocker).

---

## Step 5 — CHANGELOG Version Sync

Verify the top entry in `CHANGELOG.md` matches the version in `package.json`:

```bash
node -e "
const pkg = require('./package.json');
const fs = require('fs');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const match = changelog.match(/^## \[?(\d+\.\d+\.\d+)/m);
const topVersion = match ? match[1] : 'NOT FOUND';
const matches = topVersion === pkg.version;
console.log(matches ? 'MATCH: ' + pkg.version : 'MISMATCH: package.json=' + pkg.version + ' CHANGELOG top=' + topVersion);
" 2>&1
```

**Pass:** Output is `MATCH: X.Y.Z`.
**Fail:** MISMATCH — add or update the CHANGELOG.md top entry before committing. This is a hard blocker.

---

## Step 6 — Dual Backend Sync Check (if faker service files changed)

Check if any `FakerJSRecipeFakerService` or `SnowfakeryRecipeFakerService` files changed:

```bash
git diff --name-only HEAD 2>/dev/null | grep -E "FakerJS|Snowfakery" || true
```

If any files match, verify both backends have the same set of field type handlers:

```bash
grep -n "case\|getRecipe\|getFaker" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts | grep -v "\.test\." | head -40
grep -n "case\|getRecipe\|getFaker" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts | grep -v "\.test\." | head -40
```

**Pass:** Same field type handlers appear in both files.
**Fail:** One backend has a handler the other doesn't — this is a hard blocker per CLAUDE.md.

---

## Step 7 — Supply Chain Check (if package files changed)

```bash
git diff --name-only HEAD 2>/dev/null | grep -E "package\.json|package-lock\.json" || true
```

If either file changed, run `/supply-chain-check` before proceeding. Gate on the result — ACTION REQUIRED or CRITICAL THREAT stops the pipeline.

If neither changed: skip and note "Skipped (no package changes)".

---

## Step 8 — PR Diagram Reminder (on feature branches with open PRs)

```bash
git branch --show-current | grep -q "^feature/" && gh pr view --json number 2>/dev/null || true
```

If on a feature branch with an open PR, check whether the PR body or comments already contain a mermaid diagram. If not, remind the user to run `/pr-diagram` before merging. This is a reminder, not a blocker.

---

## Output Format

```
## Pre-Commit Report

### Step 1 — TypeScript Compile
PASS — zero errors
  OR
FAIL — N errors (see above)

### Step 2 — Tests
PASS — N tests passed, coverage held
  OR
FAIL — N tests failing (see above)

### Step 3 — Lint
PASS — zero ESLint errors
  OR
FAIL — N violations (see above)

### Step 4 — Debug Artifacts
PASS — zero debugger; statements, console.debug calls, console.log in services
  OR
FAIL — non-test console.log / debugger found (list file:line)

### Step 5 — CHANGELOG Version Sync
PASS — CHANGELOG top entry matches package.json (vX.Y.Z)
  OR
FAIL — MISMATCH: package.json=X.Y.Z, CHANGELOG top=A.B.C

### Step 6 — Dual Backend Sync
PASS — no faker service files changed
  OR
PASS — both FakerJS and Snowfakery have matching handlers
  OR
FAIL — FakerJSRecipeFakerService has X but SnowfakeryRecipeFakerService does not

### Step 7 — Supply Chain
SKIPPED — no package changes
  OR
CLEAN — supply chain check passed
  OR
FAIL — see /supply-chain-check output

### Step 8 — PR Diagrams
REMINDER — run /pr-diagram before merging (PR #N has no diagrams yet)
  OR
OK — PR #N already has mermaid diagrams
  OR
SKIP — not on a feature branch or no open PR

---

## Verdict

GO — all checks passed. Safe to commit.
  OR
NO-GO — fix the issues above before committing.
```
