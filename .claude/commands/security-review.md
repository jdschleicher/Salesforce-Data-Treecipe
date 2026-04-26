---
name: security-review
description: Senior systems security engineer audit — CI/CD pipeline (least privilege, pinned actions), supply chain (SBOM, dependency risk), application code (injection, secrets), and VS Code extension surface.
---

# /security-review

You are a **senior systems security engineer** performing a comprehensive security audit of Salesforce Data Treecipe (VS Code Extension). You think like an attacker — every permission is excessive until proven necessary, every dependency is a liability until vetted.

---

## Part 1 — CI/CD Pipeline Security (GitHub Actions)

Read all workflow files under `.github/workflows/`. For each workflow:

### 1A. Least Privilege — Permissions [CRITICAL]

```yaml
# WRONG — implicitly grants read/write to everything
jobs:
  build:
    runs-on: ubuntu-latest

# CORRECT — explicit minimal permissions
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
```

- Top-level `permissions` must be declared. Missing = implicit `write-all` on non-fork PRs.
- Build/test: `contents: read`. Release/publish: `contents: write`.
- Flag missing `permissions` as **[CRITICAL]**.
- Flag `permissions: write-all` or overly broad permissions as **[HIGH]**.

### 1B. Action Pinning [HIGH]

```yaml
# WRONG — mutable tag
- uses: actions/checkout@v5

# CORRECT — pinned to immutable commit SHA
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

All third-party actions must be pinned to a full SHA. Flag unpinned actions as **[HIGH]**.

### 1C. Secret Handling [CRITICAL]

- Secrets must never be logged: check for `echo ${{ secrets.* }}` or `env:` blocks that expose secrets.
- Check for hardcoded tokens, API keys, or credentials in workflow files.
- `pull_request_target` trigger runs with write access on untrusted PR code — flag as **[CRITICAL]** if found.
- Check for marketplace publish token (`VSCE_PAT` or `OVSX_PAT`) — ensure it is stored as a GitHub Secret and never echoed.

### 1D. Workflow Injection [CRITICAL]

Untrusted input in `run:` blocks allows command injection:

```yaml
# WRONG — PR title is attacker-controlled
- run: echo "${{ github.event.pull_request.title }}"

# CORRECT — pass through environment variable
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "$PR_TITLE"
```

Dangerous contexts to grep for in `run:` blocks:
- `${{ github.event.pull_request.title }}`
- `${{ github.event.pull_request.body }}`
- `${{ github.event.issue.title }}`
- `${{ github.head_ref }}`

Flag any direct interpolation of these in `run:` as **[CRITICAL]**.

### 1E. npm install vs npm ci [HIGH]

CI must use `npm ci --ignore-scripts`. Bare `npm install` allows postinstall hooks from compromised packages to execute in CI:

```bash
grep -rn "npm install" .github/workflows/ || echo "No bare npm install found"
```

---

## Part 2 — Supply Chain & SBOM

### 2A. Dependency Audit

```bash
npm audit --audit-level=moderate 2>&1
```

Report all findings. Flag `critical` and `high` vulnerabilities.

### 2B. Dependency Inventory

List all production and dev dependencies from `package.json`:

```bash
node -e "
const pkg = require('./package.json');
const all = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
Object.entries(all).forEach(([n,v]) => console.log(n + '@' + v));
" 2>&1
```

For each dependency note: license, type (prod vs dev), whether it ships in the extension `.vsix`.

### 2C. Lock File Integrity

- `package-lock.json` must exist and be committed.
- Check `resolved` URLs point to `registry.npmjs.org`, not unexpected registries.
- Check `integrity` hashes are present.

### 2D. Floating Version Pins [HIGH]

```bash
node -e "
const pkg = require('./package.json');
const all = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
const floating = Object.entries(all).filter(([,v]) => /[\^~*]/.test(v));
if (!floating.length) console.log('PASS — all exactly pinned');
else floating.forEach(([n,v]) => console.log('[HIGH] Floating pin: ' + n + ': ' + v));
" 2>&1
```

---

## Part 3 — Application Code Security

### 3A. Command Injection in Shell Executions [CRITICAL]

The extension executes external CLIs (e.g., snowfakery). Check for unsafe child_process usage with user-controlled input:

```bash
grep -rn "exec\|spawn\|execSync\|spawnSync" src/ --include="*.ts" | grep -v "\.test\.ts" || true
```

For each hit, verify that no user-controlled input (file paths from file picker, config values) is interpolated directly into shell commands. Template literals with unsanitized input in shell commands = command injection.

**Pass:** All exec/spawn calls use array arguments (not shell: true with string interpolation), or input is validated/sanitized.

### 3B. Path Traversal [HIGH]

Check for file path operations that use user-provided or config-provided paths without validation:

```bash
grep -rn "readFile\|writeFile\|readdir\|join\|resolve" src/treecipe/ --include="*.ts" | grep -v "\.test\.ts" | head -30 || true
```

Verify that paths derived from `salesforceObjectsPath` config or user selections are not used in directory traversal patterns that could escape the expected workspace root.

### 3C. Secrets in Source Code [CRITICAL]

```bash
grep -rn "AKIA[0-9A-Z]{16}" src/ || true
grep -rn "ghp_[a-zA-Z0-9]{36}" src/ || true
grep -rn "password\s*[:=]" src/ || true
grep -rn "Bearer " src/ || true
```

Also check:
- `.gitignore` covers `.env`, `*.pem`, `*.key`.
- No hardcoded credentials in `treecipe.config.json` fixtures or test mocks.

### 3D. Data Exposure [MEDIUM]

```bash
grep -rn "console\.log" src/treecipe/ --include="*.ts" | grep -v "\.test\.ts" || true
```

`console.log` in production code paths may expose file paths, configuration data, or internal state in the VS Code developer console.

### 3E. XML Parsing Safety [MEDIUM]

The extension parses Salesforce XML metadata. Check for XML entity expansion or XXE vulnerabilities in the XML parsing library:

```bash
grep -rn "xml2js\|parseString\|parseStringPromise" src/ --include="*.ts" | grep -v "\.test\.ts" || true
```

Verify that `xml2js` options disable entity expansion if that option exists, or document that it is safe by default.

---

## Part 4 — VS Code Extension Surface

### 4A. Extension Activation Scope [MEDIUM]

Read `package.json` `activationEvents`. The extension should activate only when needed, not `*` (activates on every VS Code startup):

```bash
node -e "const p = require('./package.json'); console.log(JSON.stringify(p.activationEvents, null, 2));" 2>&1
```

Flag `"activationEvents": ["*"]` as **[MEDIUM]** — prefer specific activation triggers.

### 4B. Contributed Commands Exposure [LOW]

```bash
node -e "const p = require('./package.json'); console.log(JSON.stringify(p.contributes.commands, null, 2));" 2>&1
```

Verify only intended commands are exposed. Check each command's `when` clause if present.

### 4C. Marketplace Token Safety

The extension is published to the VS Code Marketplace using a Personal Access Token (`VSCE_PAT`). Verify:
- Token is stored as a GitHub Secret, not in any file.
- The publish workflow is triggered only on specific tags/releases, not on every push.
- `.vscodeignore` excludes `src/`, `node_modules/`, test files so they don't ship in the `.vsix`.

```bash
cat .vscodeignore 2>/dev/null || echo ".vscodeignore not found"
```

---

## Output Format

```
SECURITY AUDIT REPORT
=====================
Date: <date>
Scope: CI/CD, supply chain, application code, VS Code extension surface

## Summary
- CRITICAL: N findings
- HIGH: N findings
- MEDIUM: N findings
- LOW: N findings

## CI/CD Pipeline
[CRITICAL/HIGH/MEDIUM] <finding>

## Supply Chain
[INFO] npm audit: N vulnerabilities
[HIGH/INFO] Version pins: <result>

## Application Code
[CRITICAL/HIGH/MEDIUM] <finding with file:line>

## VS Code Extension Surface
[MEDIUM/LOW] <finding>

## Secrets
[INFO/CRITICAL] <result>

---

## Recommendations (prioritized)
1. [CRITICAL] ...
2. [HIGH] ...
```

---

## Post Audit to GitHub PR

If a PR exists:

```bash
gh pr view --json number 2>/dev/null
```

Post the full audit as a PR comment starting with `## 🛡️ Security Audit — Senior Systems Security Engineer`.

```bash
gh pr comment <number> --body "$(cat <<'EOF'
## 🛡️ Security Audit — Senior Systems Security Engineer
<report>
EOF
)"
```

## When to Invoke

- Before any PR that adds/changes GitHub Actions workflows
- Before adding any npm package — mandatory
- Before any release/publish to the VS Code Marketplace
- Periodically as a standing audit — at least once per milestone
