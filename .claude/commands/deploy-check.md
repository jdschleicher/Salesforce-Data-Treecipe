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

Package the way `release.yaml` publishes: **no `--no-dependencies`**, and vsce **pinned to the version CI uses**.

```bash
npx --yes @vscode/vsce@3.9.2 package 2>&1 | tail -3
ls *.vsix 2>/dev/null && echo "VSIX produced" || echo "No VSIX found"
```

**Pass:** Exits 0, produces a `.vsix` of roughly **5 MB across ~2,261 files**.
**Fail:** BLOCKER — the exact package Marketplace users would install cannot be built.

**Both of those details are load-bearing, and getting either wrong reports a green check on an artifact nobody ships:**

- **`--no-dependencies` builds a BROKEN package, not a smaller one.** `@salesforce/core` is deliberately `external` in `esbuild.js` — pino's `thread-stream` transports spawn workers from a file path, which a bundler cannot rewrite (see CHANGELOG 3.23.0). The bundle therefore emits a literal `require("@salesforce/core")`, so a `.vsix` without that tree throws at the first org-touching command: **Insert Data Set by Directory**, **Run Picklist Dependency Check**, and the Recipe Cockpit's org describe. That flag reports ~770 KB / 20 files, which is not this extension.
- **Unpinned `npx vsce` resolves a newer version that runs the prepublish script during `ls`** and writes its stdout into the listing. The guard below then reports phantom top-level paths such as `> tsc --noEmit -p .` and `Bundled src`. Pin to `3.9.2`, as `build.yaml` does.

Now run the repo's own packaged-contents guard against a real listing — the same two commands CI runs, and the thing that actually catches a regression in what ships:

```bash
VSCE_LS_OUTPUT="$(mktemp -t vsce-ls-XXXXXX.txt)"
npm run bundle >/dev/null 2>&1
npx --yes @vscode/vsce@3.9.2 ls > "$VSCE_LS_OUTPUT"
node .github/workflowScripts/checkPackagedPaths.js "$VSCE_LS_OUTPUT"
head -20 "$VSCE_LS_OUTPUT"
rm -f "$VSCE_LS_OUTPUT"
```

**Pass:** `Package contents check passed.`

The listing goes to a temp path rather than the working directory on purpose: `vsce` packages the **working directory**, not the git index, so a listing file left in the repo is itself an unexpected top-level path in the next run.

`node_modules` appearing in that listing is **correct** — see Step 5.

---

## Step 4 — package.json Manifest Validation

Read `package.json` and verify:

**4a. Every declared command is registered, and every registered command is declared:**

A hardcoded list of expected commands goes stale the moment one is added — it grew from 5 to 10 without the check noticing, and it could only ever report the 5 it knew about. The manifest cannot validate itself, so check it against the **other** half of the contract: `contributes.commands` in `package.json` against `registerCommand` in `src/extension.ts`. A command declared but never registered fails at invocation; a command registered but never declared is unreachable from the palette.

```bash
node -e "
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const declared = ((pkg.contributes && pkg.contributes.commands) || []).map(c => c.command);

// \\x27 \\x22 \\x60 are ' \" and a backtick -- written as escapes so the regex survives the shell quoting
const registered = [...fs.readFileSync('src/extension.ts', 'utf8')
    .matchAll(/registerCommand\(\s*[\x27\x22\x60]([^\x27\x22\x60]+)[\x27\x22\x60]/g)].map(m => m[1]);

console.log('declared in package.json  : ' + declared.length);
console.log('registered in extension.ts: ' + registered.length);
declared.forEach(c => console.log(' - ' + c));

const notRegistered = declared.filter(c => !registered.includes(c));
const notDeclared = registered.filter(c => !declared.includes(c));

if (notRegistered.length) { console.log('DECLARED BUT NOT REGISTERED: ' + notRegistered.join(', ')); }
if (notDeclared.length) { console.log('REGISTERED BUT NOT DECLARED: ' + notDeclared.join(', ')); }
if (!notRegistered.length && !notDeclared.length) {
  console.log('PASS -- all ' + declared.length + ' commands declared and registered');
}
"
```

**Fail:** BLOCKER either way. A declared command with no handler throws *\"command not found\"* for a user who picked it out of the palette.

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
- `src/` — TypeScript source (only the bundled `out/` ships)
- `**/*.test.ts` — test files
- `coverage/` — test coverage reports
- `.claude/` — project tooling
- `.github/` — CI workflows
- `docs/`, `CLAUDE.md`, `jestSetup/` — repo-side documentation and harness
- `.sfdx/`, `.sf/`, `treecipe/` — machine-local CLI state and command output, which `vsce` would otherwise package because it reads the **working directory** rather than the git index

**Flag [HIGH]:** If `src/`, `coverage/`, or `.claude/` are not excluded — these inflate the `.vsix` and ship internal tooling.

**`node_modules` is NOT on that list, and must not be added to it.** A VS Code extension normally ships no dependencies, but this one has `@salesforce/core` as a deliberate `external` (Step 3), so its tree has to be in the package for the extension to run at all. Excluding it here is the same defect as packaging with `--no-dependencies`: a much smaller `.vsix` that throws on the first org-touching command. `node_modules` is in `checkPackagedPaths.js`'s `TOP_LEVEL_PATH_ALLOW_LIST` for exactly this reason, and that guard — not this file listing — is what catches something unexpected entering the package.

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
git status --short
```

`git status` is the check that matters here rather than the `rm`: `vsce` packages the working directory, so anything this run left behind ships in the next one.

**Always report the real package size in the Step 3 verdict.** Two figures circulate for this extension and only one of them is real — ~5 MB / ~2,261 files is what publishes; ~770 KB / 20 files is a `--no-dependencies` build that cannot run. Quoting the smaller one into release notes or a PR body is how the wrong number spreads.

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
PASS — salesforce-data-treecipe-X.Y.Z.vsix produced (N files, N MB) — packaged contents check passed
  OR
FAIL — vsce package failed (see above)
  OR
FAIL — packaged contents check reported unexpected top-level paths: <list>

### Step 4 — package.json Manifest
PASS — all N commands declared and registered, version/publisher/engines present
  OR
FAIL — declared but not registered: <list> / registered but not declared: <list>

### Step 5 — .vscodeignore
PASS — src/, coverage/, .claude/, .github/ excluded; node_modules correctly NOT excluded
  OR
[HIGH] <path> not excluded — will bloat the .vsix
  OR
[HIGH] node_modules excluded — the externalized @salesforce/core would not ship

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
