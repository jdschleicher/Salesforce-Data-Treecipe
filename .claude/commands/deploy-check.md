---
name: deploy-check
description: Verifies the VS Code extension package can be built and published correctly — runs vsce package, validates package.json manifest, .vscodeignore, CHANGELOG sync, and CI pipeline alignment.
---

You are the **extension publish validator** for Salesforce Data Treecipe. Verify everything needed to ship a `.vsix` to the VS Code Marketplace is correct before a PR merges or a release is cut.

---

## Step 1 — TypeScript Compile

```bash
npm run compile 2>&1
```

**Pass:** Zero errors, `out/` directory is populated.
**Fail:** BLOCKER — fix compile errors before proceeding.

```bash
ls out/ 2>&1
```

---

## Step 2 — All Tests Pass

```bash
npm run jest-test 2>&1 | tail -15
```

**Pass:** All tests pass, coverage does not regress.
**Fail:** BLOCKER.

---

## Step 3 — vsce Package Build

```bash
npx vsce package --no-dependencies 2>&1
```

**Pass:** Exits 0, produces a `.vsix` file.
**Fail:** BLOCKER — the exact package Marketplace users would install cannot be built.

```bash
ls *.vsix 2>/dev/null && echo "VSIX produced" || echo "No VSIX found"
```

List the packaged contents to verify no unexpected files are included:
```bash
npx vsce ls 2>&1 | head -50
```

---

## Step 4 — package.json Manifest Validation

Read `package.json` and verify:

**4a. All 5 commands are declared:**
```bash
node -e "
const pkg = require('./package.json');
const commands = (pkg.contributes && pkg.contributes.commands) || [];
console.log('Commands declared: ' + commands.length);
commands.forEach(c => console.log(' - ' + c.command + ': ' + c.title));
const expected = [
  'treecipe.initiateConfiguration',
  'treecipe.generateTreecipe',
  'treecipe.runFakerByRecipe',
  'treecipe.insertDataSetBySelectedDirectory',
  'treecipe.changeFakerImplementationService'
];
const missing = expected.filter(e => !commands.find(c => c.command === e));
if (missing.length) {
  console.log('MISSING commands: ' + missing.join(', '));
} else {
  console.log('PASS — all 5 commands present');
}
" 2>&1
```

**4b. Version, publisher, engines:**
```bash
node -e "
const pkg = require('./package.json');
console.log('version: ' + pkg.version);
console.log('publisher: ' + pkg.publisher);
console.log('engines.vscode: ' + (pkg.engines && pkg.engines.vscode));
console.log('categories: ' + JSON.stringify(pkg.categories));
const required = ['version', 'publisher', 'engines', 'description', 'repository'];
required.forEach(k => {
  if (!pkg[k]) console.log('MISSING: ' + k);
});
" 2>&1
```

---

## Step 5 — .vscodeignore Validation

```bash
cat .vscodeignore 2>/dev/null || echo ".vscodeignore NOT FOUND"
```

Verify the `.vscodeignore` excludes at minimum:
- `src/` — TypeScript source (only compiled `out/` ships)
- `node_modules/` — dependencies (caller installs from registry)
- `**/*.test.ts` — test files
- `coverage/` — test coverage reports
- `.claude/` — project tooling
- `.github/` — CI workflows

**Flag [HIGH]:** If `src/`, `coverage/`, or `.claude/` are not excluded — these inflate the `.vsix` unnecessarily and expose internal tooling.

---

## Step 6 — CHANGELOG Version Sync

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
**Fail:** BLOCKER — the Marketplace display will show the wrong version. Update `CHANGELOG.md` or `package.json`.

---

## Step 7 — CI Pipeline Alignment

Read `.github/workflows/` and verify:

```bash
ls .github/workflows/ 2>/dev/null || echo "No workflows found"
```

Check that CI runs:
- `npm run compile` (not `npm run build`)
- `npm run jest-test` (not `npm test`)
- `npm ci --ignore-scripts` (not `npm install`)

```bash
grep -rn "npm run\|npm ci\|npm install" .github/workflows/ || true
```

**Flag [HIGH]:** Any workflow using `npm install` instead of `npm ci --ignore-scripts`.
**Flag [MEDIUM]:** Any workflow not running `npm run compile` or `npm run jest-test`.

---

## Step 8 — Clean Up VSIX Artifact

Remove the generated `.vsix` (it's a build artifact, not for committing):

```bash
rm -f *.vsix && echo "VSIX cleaned up"
```

---

## Output Format

```
## Deploy Check Report

### Step 1 — TypeScript Compile
PASS — zero errors, out/ populated
  OR
FAIL — N errors (see above)

### Step 2 — Tests
PASS — N tests passed
  OR
FAIL — N tests failing

### Step 3 — vsce Package
PASS — salesforce-data-treecipe-X.Y.Z.vsix produced
  OR
FAIL — vsce package failed (see above)

### Step 4 — package.json Manifest
PASS — all 5 commands declared, version/publisher/engines present
  OR
FAIL — missing commands: <list>

### Step 5 — .vscodeignore
PASS — src/, node_modules/, coverage/, .claude/ all excluded
  OR
[HIGH] <path> not excluded — will bloat the .vsix

### Step 6 — CHANGELOG Version Sync
PASS — MATCH: vX.Y.Z
  OR
FAIL — MISMATCH: package.json=X.Y.Z, CHANGELOG=A.B.C

### Step 7 — CI Pipeline
PASS — workflows use npm ci --ignore-scripts and correct scripts
  OR
[HIGH] <workflow>:<line> — bare npm install found
  OR
[MEDIUM] <workflow> — missing npm run compile step

---

## Verdict

PASS — extension is ready to package and publish.
  OR
FAIL — fix the blocking issues above before releasing.
```
