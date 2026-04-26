---
name: pr-flow
description: Full PR pipeline — compile, tests, lint, debug audit, dual backend sync check, commit, push, create PR, code review, criteria check, pr-diagram, pr-body ToC. One command to ship.
---

You are the full PR pipeline orchestrator for Salesforce Data Treecipe (VS Code Extension). Run every check in the correct order, gate on failures, and produce a fully reviewed, documented PR.

## Overview

1. **Phase 1** — Pre-commit checks (compile, tests, lint, debug audit, dual backend sync, supply chain)
2. **Phase 2** — Commit, push, create PR
3. **Phase 3** — Triple code review (`/code-review`)
4. **Phase 4** — PR diagrams (`/pr-diagram`)
5. **Phase 5** — Criteria check (`/criteria-check`)
6. **Phase 6** — Contract test check (`/contract-test`) if faker services changed
7. **Phase 7** — Deploy check (`/deploy-check`)
8. **Phase 8** — PR body ToC (`/pr-body`)

Each phase gates on the previous. If Phase 1 fails, stop.

---

## Phase 1 — Pre-Commit Checks

Run these checks inline with Bash tools. Do NOT invoke `/pre-commit` as a sub-skill — execute each check directly.

**1a. TypeScript compile:**
```bash
npm run compile 2>&1
```
Pass: zero errors.

**1b. Tests:**
```bash
npm run jest-test 2>&1
```
Pass: all tests pass, coverage does not regress.

**1c. Lint:**
```bash
npm run lint 2>&1
```
Pass: zero ESLint errors.

**1d. Debug artifacts:**
```bash
grep -rn "debugger" src/ --include="*.ts" || true
grep -rn "console\.debug" src/ --include="*.ts" || true
grep -rn "console\.log" src/treecipe/ --include="*.ts" | grep -v "\.test\.ts" || true
```
Pass: zero results.

**1e. CHANGELOG version sync:**
```bash
node -e "
const pkg = require('./package.json');
const fs = require('fs');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const match = changelog.match(/^## \[?(\d+\.\d+\.\d+)/m);
const topVersion = match ? match[1] : 'NOT FOUND';
console.log(topVersion === pkg.version ? 'MATCH: ' + pkg.version : 'MISMATCH: package.json=' + pkg.version + ' CHANGELOG=' + topVersion);
" 2>&1
```
Pass: MATCH.

**1f. Dual backend sync (if faker service files changed):**
```bash
git diff --name-only HEAD 2>/dev/null | grep -E "FakerJS|Snowfakery" || true
```
If any matches: verify same field type handlers exist in both backends. BLOCKER if parity is missing.

**1g. Supply chain check (if package files changed):**
```bash
git diff --name-only HEAD 2>/dev/null | grep -E "package\.json|package-lock\.json" || true
```
If matches: invoke `/supply-chain-check`. Gate on result — ACTION REQUIRED or CRITICAL THREAT = stop.

**Gate:** If ANY check fails (not warns), stop. Tell the user what failed. Do not proceed to Phase 2.

---

## Phase 2 — Commit, Push, and PR

```bash
git status
git branch --show-current
```

**2a. Commit (if uncommitted changes):**
Stage changed files by name (not `git add .`). Ask the user for a commit message or draft one. Commit.

**2b. Push:**
```bash
git push -u origin $(git branch --show-current)
```

**2c. Create PR (if none exists):**
```bash
gh pr view --json number,url 2>/dev/null
```
If no PR:
1. Extract issue number from branch name if present
2. Look up issue title: `gh issue view <N> --repo jdschleicher/Salesforce-Data-Treecipe --json title`
3. Create PR:
   ```bash
   gh pr create \
     --repo jdschleicher/Salesforce-Data-Treecipe \
     --title "<title>" \
     --body "$(cat <<'EOF'
   ## Summary
   <brief description>

   ## Issue
   Closes #<N>

   ## Changes
   <list changed services/files>

   ## Test Plan
   - [ ] npm run compile — zero errors
   - [ ] npm run jest-test — all pass
   - [ ] Manual VS Code command testing
   EOF
   )"
   ```

If a PR already exists, note its number and URL and continue.

---

## Phase 3 — Triple Code Review

Invoke `/code-review` as an Agent. Wait for completion.

**Gate:** If the architecture review returns REQUEST CHANGES on a CRITICAL finding, surface it to the user and ask whether to proceed or fix first.

---

## Phase 4 — PR Diagrams

Invoke `/pr-diagram`. Wait for completion.

---

## Phase 5 — Criteria Check

Invoke `/criteria-check`. Wait for completion.

If no Acceptance Criteria section exists in the linked issue, note it and continue.

---

## Phase 6 — Contract Test Check (conditional)

```bash
git diff main...HEAD --name-only | grep -E "FakerJS|Snowfakery|IRecipeFaker|IFakerRecipe" || true
```

If faker service files changed: invoke `/contract-test`. Gate on result — FAIL blocks merge.

If no faker service files changed: skip and note "Skipped (no faker service changes)".

---

## Phase 7 — Deploy Check

Invoke `/deploy-check`. This verifies the extension package can be built correctly.

**Gate:** If FAIL, surface to user — the extension cannot be published in this state.

---

## Phase 8 — PR Body ToC

Invoke `/pr-body` to aggregate all skill report verdicts and update the PR body navigation hub.

---

## Final Summary

```
## PR Flow Complete — PR #<number>

### Phase Results
| Phase | Result |
|-------|--------|
| Compile | ✅ PASS |
| Tests | ✅ PASS |
| Lint | ✅ PASS |
| Debug Audit | ✅ CLEAN |
| CHANGELOG Sync | ✅ MATCH |
| Dual Backend Sync | ✅ PASS / ⏭️ SKIPPED |
| Supply Chain | ✅ CLEAN / ⏭️ SKIPPED |
| Code Review | ✅ APPROVE |
| Performance Review | ✅ APPROVE |
| Security Audit | ✅ PASS |
| PR Diagrams | ✅ Generated |
| Criteria Check | ✅ PASS |
| Contract Test | ✅ PASS / ⏭️ SKIPPED |
| Deploy Check | ✅ PASS |
| PR Body | ✅ Updated |

### PR
**#<number>** — <title>
**URL:** <url>

### Verdict
✅ READY TO MERGE
  OR
⚠️ NEEDS ATTENTION — <list blocking issues>
```
