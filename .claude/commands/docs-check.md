---
name: docs-check
description: Audits CHANGELOG.md, README.md, and CLAUDE.md against the current codebase — verifies version sync, command list currency, and project structure accuracy. Update stale sections automatically.
---

You are the documentation auditor for Salesforce Data Treecipe (VS Code Extension). Verify that the three key documentation files accurately reflect the current state of the codebase and fix staleness automatically where possible.

---

## Check 1 — CHANGELOG.md Version Sync

Verify the top entry in `CHANGELOG.md` matches `package.json` version:

```bash
node -e "
const pkg = require('./package.json');
const fs = require('fs');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const match = changelog.match(/^## \[?(\d+\.\d+\.\d+)/m);
const topVersion = match ? match[1] : 'NOT FOUND';
console.log(topVersion === pkg.version
  ? 'MATCH: ' + pkg.version
  : 'MISMATCH: package.json=' + pkg.version + ' CHANGELOG top=' + topVersion);
" 2>&1
```

**Pass:** MATCH.
**Fail:** MISMATCH — the Marketplace shows the wrong version. Offer to add a new CHANGELOG entry for the current version, or update the existing top entry.

---

## Check 2 — README.md Command List Currency

Read the README and extract any documented VS Code commands. Compare against `package.json` `contributes.commands`:

```bash
grep -n "treecipe\." README.md || echo "No treecipe commands found in README"
node -e "
const pkg = require('./package.json');
(pkg.contributes && pkg.contributes.commands || []).forEach(c => console.log(c.command + ': ' + c.title));
" 2>&1
```

**Expected commands in README (all 5):**
- `treecipe.initiateConfiguration` — Initiate Configuration File
- `treecipe.generateTreecipe` — Generate Treecipe
- `treecipe.runFakerByRecipe` — Run Faker by Recipe
- `treecipe.insertDataSetBySelectedDirectory` — Insert Data Set by Directory
- `treecipe.changeFakerImplementationService` — Select Faker Implementation

**Flag:** Any command in `package.json` not documented in README (new command added without docs update).
**Flag:** Any command documented in README not in `package.json` (stale — command was removed).

Offer to update README if staleness is found.

---

## Check 3 — CLAUDE.md Project Structure Accuracy

Read the `## Project Structure` section from `CLAUDE.md` and verify each path mentioned exists:

```bash
# List actual service directories
ls src/treecipe/src/ | sort
```

Extract paths from CLAUDE.md structure section and cross-reference. Flag:
- Paths in CLAUDE.md that no longer exist (renamed/removed service)
- Service directories in `src/treecipe/src/` not mentioned in CLAUDE.md (newly added service)

---

## Check 4 — CLAUDE.md Command Table

Extract the command table from CLAUDE.md:
```bash
grep -A 20 "### VS Code Commands" CLAUDE.md || true
```

Compare against `package.json`. Same check as README — flag any mismatch.

---

## Check 5 — CLAUDE.md Quick Command Reference

Verify the commands in CLAUDE.md's `## Quick Command Reference` still work:

```bash
grep -A 20 "## Quick Command Reference" CLAUDE.md | grep "npm run\|npx"
```

For each command found, verify it exists in `package.json` scripts:
```bash
node -e "const p = require('./package.json'); console.log(JSON.stringify(Object.keys(p.scripts || {}), null, 2));" 2>&1
```

**Flag:** Any `npm run <script>` in CLAUDE.md that is not in `package.json` scripts.

---

## Check 6 — CHANGELOG Entry Quality (recent entries)

Read the top 3 CHANGELOG entries and verify each has:
- A version number and date
- At least one bullet point describing the change
- No placeholder text ("TBD", "TODO", etc.)

```bash
head -50 CHANGELOG.md
```

---

## Auto-Fix Offer

For each staleness finding, offer to fix it automatically:

1. **CHANGELOG version mismatch** — prepend a new `## [X.Y.Z] — <date>` entry
2. **README command table** — update the command list section
3. **CLAUDE.md project structure** — add missing service folders, remove deleted ones
4. **CLAUDE.md command table** — sync to match `package.json`

Always show the proposed change and ask for confirmation before writing.

---

## Output Format

```
## Docs Check Report

### Check 1 — CHANGELOG Version Sync
PASS — MATCH: vX.Y.Z
  OR
FAIL — MISMATCH: package.json=X.Y.Z, CHANGELOG top=A.B.C

### Check 2 — README Command List
PASS — all 5 commands documented in README
  OR
STALE — commands in README not matching package.json:
  - Missing from README: treecipe.newCommand (added in vX.Y.Z)
  - In README but not in package.json: treecipe.oldCommand (removed)

### Check 3 — CLAUDE.md Project Structure
PASS — all paths accurate
  OR
STALE — paths in CLAUDE.md missing from disk: <list>
UNDOCUMENTED — new service directories not in CLAUDE.md: <list>

### Check 4 — CLAUDE.md Command Table
PASS — command table matches package.json
  OR
STALE — <mismatch>

### Check 5 — CLAUDE.md Script Reference
PASS — all npm run commands exist in package.json scripts
  OR
STALE — npm run <script> referenced in CLAUDE.md but not in package.json

### Check 6 — CHANGELOG Entry Quality
PASS — top 3 entries have complete version, date, and content
  OR
WARN — entry for vX.Y.Z is missing date or has placeholder content

---

## Verdict

CURRENT — all documentation is accurate.
  OR
STALE — update the documents flagged above (offers to auto-fix each).
```
