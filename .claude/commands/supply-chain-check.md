---
name: supply-chain-check
description: Supply chain attack detector — scans for axios-style postinstall hooks, unexpected transitive deps, floating version pins, and RAT dropper artifacts. Run before adding any package or after any npm install.
---

# /supply-chain-check

You are a **supply chain security specialist** for Salesforce Data Treecipe (VS Code Extension). Detect the patterns that real-world npm supply chain attacks use — specifically the class of attack demonstrated by the March 2026 axios incident.

**The attack model:** A legitimate, widely-trusted npm package has its npm account hijacked. The attacker publishes a new patch version that injects a previously unknown transitive dependency containing a `postinstall` hook that downloads and executes a Remote Access Trojan on every developer machine that runs `npm install`. `npm audit` shows zero vulnerabilities because the compromised package has no CVEs yet.

**The axios incident (March 2026):**
- Affected versions: `1.14.1` and `0.30.4`
- Injected package: `plain-crypto-js` (did not exist before the attack)
- Attack vector: `postinstall` hook executed a RAT downloader
- Exposure window: ~3 hours, 100M+ weekly downloads
- `npm audit` during attack: **zero findings** — CVE databases had no entry yet
- C2 infrastructure: `sfrclak.com` / `142.11.206.73`

---

## Step 1 — Floating Version Pins

Read `package.json` and check every entry in `dependencies` and `devDependencies`.

**Flag as [CRITICAL] any entry using `^`, `~`, `*`, or ranges:**

```bash
node -e "
const pkg = require('./package.json');
const all = {...pkg.dependencies, ...pkg.devDependencies};
const floating = Object.entries(all).filter(([,v]) => /[\^~*]/.test(v) || v.includes('>') || v.includes('<'));
if (floating.length === 0) {
  console.log('PASS — all packages exactly pinned');
} else {
  console.log('FLOATING PINS:');
  floating.forEach(([n,v]) => console.log(' ', n + ': ' + v));
}
" 2>&1
```

---

## Step 2 — Unexpected Transitive Dependencies

Compare current lockfile against HEAD to detect packages that appeared without a direct dependency addition:

```bash
git show HEAD:package-lock.json 2>/dev/null | python3 -c "
import json, sys
lock = json.load(sys.stdin)
pkgs = set(lock.get('packages', {}).keys())
pkgs.discard('')
for p in sorted(pkgs): print(p.replace('node_modules/', ''))
" 2>/dev/null | sort > /tmp/lockfile_before.txt

python3 -c "
import json, sys
with open('package-lock.json') as f:
    lock = json.load(f)
pkgs = set(lock.get('packages', {}).keys())
pkgs.discard('')
for p in sorted(pkgs): print(p.replace('node_modules/', ''))
" | sort > /tmp/lockfile_after.txt

diff /tmp/lockfile_before.txt /tmp/lockfile_after.txt
```

**Flag as [CRITICAL]** any package that appeared without a corresponding direct dependency addition, or has a synthetic-sounding name not widely recognized.

---

## Step 3 — Postinstall/Preinstall Hook Audit

```bash
node -e "
const fs = require('fs'), path = require('path');
const nm = 'node_modules';
if (!fs.existsSync(nm)) { console.log('node_modules not present — skipping'); process.exit(0); }
const hooks = [];
for (const p of fs.readdirSync(nm).filter(p => !p.startsWith('.'))) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(nm, p, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    if (s.postinstall || s.preinstall || s.install)
      hooks.push({ name: p, version: pkg.version, scripts: { postinstall: s.postinstall, preinstall: s.preinstall, install: s.install } });
  } catch(e) {}
}
if (hooks.length === 0) {
  console.log('PASS — no postinstall/preinstall/install hooks found');
} else {
  console.log('HOOKS FOUND — review each:');
  hooks.forEach(h => console.log(JSON.stringify(h, null, 2)));
}
" 2>&1
```

For each hook, classify:
- **[INFO] Known-safe** — well-known packages with legitimate build hooks (e.g. `esbuild`, native addon compilers).
- **[HIGH] Unknown/suspicious** — package name not widely recognized, hook does network activity, or appeared unexpectedly.
- **[CRITICAL] Malicious indicators** — downloads executables, references unknown domains, base64-decodes payloads.

---

## Step 4 — RAT Dropper Artifacts

```bash
ls -la /Library/Caches/com.apple.act.mond 2>/dev/null && echo "CRITICAL: RAT artifact found on macOS" || echo "macOS artifact: not present"
crontab -l 2>/dev/null | grep -i "ld.py\|wt.exe\|act.mond" || echo "crontab: clean"
```

**If any artifact is found:** Report [CRITICAL] immediately. Do NOT run any more npm commands. Instruct the user to isolate the machine, rotate all credentials (npm token, GitHub PAT), and rebuild from a clean snapshot. C2 blocklist: `sfrclak.com` / `142.11.206.73`.

---

## Step 5 — CI Uses npm ci --ignore-scripts

Read `.github/workflows/` files. Check that CI never uses bare `npm install`:

```bash
grep -rn "npm install" .github/workflows/ || echo "No bare npm install found"
grep -rn "npm ci" .github/workflows/ || echo "No npm ci found"
```

**Pass:** All CI steps use `npm ci --ignore-scripts`.
**Fail [HIGH]:** Any step using bare `npm install` instead.

---

## Step 6 — Lockfile Committed

```bash
git ls-files package-lock.json
```

**Pass:** `package-lock.json` is tracked.
**Fail [HIGH]:** Not committed — the lockfile is the integrity record.

---

## Step 7 — New Package Pre-Import Checklist

If invoked because the user is about to add a new package, run this checklist before allowing install:

1. Does the package exist on npmjs.com with a credible publish history?
2. When was the last publish? Has ownership changed recently?
3. How many transitive dependencies does it pull in? (More than 5 is a yellow flag; more than 20 needs justification)
4. Does its `package.json` have a `scripts.postinstall`? If yes, read it and explain exactly what it does.
5. Will the version be pinned exactly (no `^` or `~`)?

---

## Output Format

```
SUPPLY CHAIN AUDIT REPORT
==========================
Date: <date>
Trigger: <pre-install check / routine audit / post npm install>

## Step 1 — Version Pin Audit
PASS — all N packages exactly pinned
  OR
[CRITICAL] N floating pins: <list>

## Step 2 — Unexpected Transitive Dependencies
PASS — lockfile matches HEAD, no unexpected packages
  OR
[CRITICAL] N unexpected packages appeared: <list>

## Step 3 — Postinstall Hook Audit
PASS — no hooks found
  OR
[INFO] Known-safe: <package> (reason)
[HIGH] Unknown hook: <package> — postinstall: "<script>"

## Step 4 — RAT Dropper Artifacts
PASS — no known RAT artifacts found
  OR
[CRITICAL] ARTIFACT FOUND — isolate machine, rotate all credentials immediately

## Step 5 — CI npm Usage
PASS — all workflows use npm ci --ignore-scripts
  OR
[HIGH] <workflow file>:<line> — bare npm install found

## Step 6 — Lockfile Committed
PASS — package-lock.json is tracked by git
  OR
[HIGH] package-lock.json is NOT committed

---

## Verdict
CLEAN — no supply chain attack indicators found.
  OR
ACTION REQUIRED — fix the issues above before installing or committing.
  OR
CRITICAL THREAT — possible active compromise. Do not proceed. See Step 4 output.
```

---

## When to Invoke

- **Before adding any new npm package** — mandatory, run before `npm install <package>`
- **After any `npm install` not fully controlled** — e.g. after pulling a branch someone else updated
- **After any dependency update**
- **As part of `/pre-commit`** if `package.json` or `package-lock.json` changed
