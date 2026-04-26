---
name: code-review
description: Triple code review — senior TS engineer (architecture, type safety, service patterns, dual-backend sync), senior perf engineer (activation time, XML processing), and senior security engineer (injection, CI/CD, supply chain) run in parallel.
---

## Triple Review — Three Reviewers in Parallel

This skill runs **three independent code reviews in parallel** using the Agent tool:

1. **Senior TypeScript Engineer** — architecture, type safety, service class patterns, dual-backend sync, test coverage
2. **Senior Performance Engineer** — extension activation time, XML processing performance, memory use (the review below)
3. **Senior Security Engineer** — invoke `/security-review`

Launch all three as parallel agents. Each independently determines changed files, reads them, and produces its own report. After all complete, present the three reports sequentially — architecture first, then performance, then security.

**PR comments:** If a PR exists, each review posts its own comment to the PR — three separate comments, clearly labeled.

---

## Pre-Review: Commit & Push Gate

Before reviewing, ensure everything is committed and pushed:

```bash
git status
git log --oneline -5
```

If there are uncommitted changes, ask the user whether to commit them before proceeding.

---

## Senior TypeScript Engineer Review

You are a senior TypeScript engineer reviewing code for Salesforce Data Treecipe (VS Code Extension). Review all changed files against CLAUDE.md architecture standards and report issues by severity.

### Determine Changed Files

```bash
git diff main...HEAD --name-only 2>/dev/null || git diff HEAD~1 --name-only
```

Read each changed `.ts` file. For context on unchanged files they interact with, read those too.

---

### Check 1 — TypeScript Strict Mode [CRITICAL if violated]

```bash
npm run compile 2>&1
```

Zero errors required. Also grep for `any` usage:

```bash
git diff main...HEAD -- '*.ts' | grep "^+" | grep -v "^+++" | grep ": any\|as any" || true
```

**Flag:** Any implicit or explicit `any` in non-test files as **[HIGH]** — CLAUDE.md requires strict TypeScript with no implicit `any`.

---

### Check 2 — Service Class Pattern [HIGH if violated]

All services must be classes with `static` methods. No standalone exported functions outside a class.

```bash
git diff main...HEAD -- '*.ts' | grep "^+export function\|^+export const.*=.*=>" | grep -v "^+++" | grep -v "\.test\.ts" || true
```

**Flag:** Exported functions/arrow functions outside a class in service files.

---

### Check 3 — Interface Conformance [CRITICAL if violated]

If any `FakerJSRecipeFakerService` or `SnowfakeryRecipeFakerService` files changed, verify both still implement `IRecipeFakerService` correctly:

```bash
grep -n "implements\|IRecipeFakerService\|IFakerRecipeProcessor" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts || true
grep -n "implements\|IRecipeFakerService\|IFakerRecipeProcessor" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts || true
```

---

### Check 4 — Dual Backend Parity [CRITICAL if violated]

Per CLAUDE.md: every field type handler added to FakerJS must have an equivalent in Snowfakery. Check for parity:

```bash
grep -c "case '" src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts 2>/dev/null || true
grep -c "case '" src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts 2>/dev/null || true
```

If counts differ, read both files and list the missing handlers.

---

### Check 5 — Test Coverage [HIGH if missing]

Every changed service file must have a corresponding updated test file:

```bash
git diff main...HEAD --name-only | grep "\.ts$" | grep -v "\.test\.ts" | grep "src/treecipe/" | while read f; do
  testDir=$(dirname "$f")/tests
  echo "Service: $f — Test dir: $testDir"
  ls "$testDir" 2>/dev/null || echo "  WARNING: No tests directory found"
done
```

**Flag:** Any service file changed without a corresponding test file update as **[HIGH]**.

---

### Check 6 — Precision/Scale Math [HIGH if wrong]

For any changes to numeric or currency field handling, verify the math:
- `left_digits = precision - scale`
- `max = 10^left_digits - 1`
- `dec = scale`

Grep for precision/scale usage:

```bash
git diff main...HEAD -- '*.ts' | grep "^+" | grep -v "^+++" | grep -i "precision\|scale\|leftDigit" || true
```

---

### Check 7 — Picklist Special Character Escaping [HIGH if missing]

Picklist values containing `&`, `'`, `"`, `<`, `>` must be escaped before embedding in faker expressions. Check any picklist-related changes:

```bash
git diff main...HEAD -- '*.ts' | grep "^+" | grep -v "^+++" | grep -i "picklist\|valueSet\|globalValue" || true
```

---

### Check 8 — Tests Pass

```bash
npm run jest-test 2>&1 | tail -15
```

All tests must pass.

---

### Architecture Review Output Format

```
## 🔍 Code Review — Senior TypeScript Engineer

### Summary
<1-2 sentence overview of what changed and overall assessment>

### Findings

| Severity | Location | Issue |
|----------|----------|-------|
| [CRITICAL/HIGH/MEDIUM/LOW] | file.ts:line | description |

### Dual Backend Parity
PASS — FakerJS: N handlers, Snowfakery: N handlers (matching)
  OR
FAIL — FakerJS has X, Snowfakery missing: <list>

### Test Coverage
PASS — all changed services have updated tests
  OR
HIGH — <service> changed but no test update found

### Verdict
APPROVE — no blocking issues
  OR
REQUEST CHANGES — <N> critical/high issues require fixes
```

---

## Senior Performance Engineer Review

You are a senior performance engineer reviewing Salesforce Data Treecipe (VS Code Extension) for runtime performance issues. The key concern: this extension processes potentially large Salesforce org metadata directories (hundreds of object XML files, each with many fields). Performance problems cause the extension to feel slow or unresponsive.

### Determine Changed Files

```bash
git diff main...HEAD --name-only | grep -E "\.ts$" | grep -v "\.test\.ts"
```

Read each changed file.

### Perf Check 1 — Extension Activation Cost

Read `src/extension.ts`. Check that `activate()` does minimal work at startup:
- Should only register commands, not execute them
- Should not parse any files, walk directories, or make network calls
- Any heavy initialization should be deferred until the command is actually invoked

### Perf Check 2 — Synchronous File I/O

```bash
git diff main...HEAD -- '*.ts' | grep "^+" | grep -v "^+++" | grep "readFileSync\|readdirSync\|existsSync\|writeFileSync" || true
```

Synchronous file operations block the VS Code UI thread. In command handlers processing many files, these should be `async`/`await` with their async equivalents.

**Flag:** Any synchronous file I/O in the main command path (not in tests or config reads) as **[HIGH]**.

### Perf Check 3 — Large Directory Processing

Read `src/treecipe/src/DirectoryProcessingService/DirectoryProcessor.ts`. Check:
- Does it stream/chunk results or load everything into memory?
- Is there any short-circuiting for malformed/unexpected files?
- Does it report progress to VS Code's Progress API for long-running operations?

### Perf Check 4 — XML Parsing

Review any changed XML parsing code. `xml2js.parseStringPromise` is async — verify it is awaited and not called synchronously in a tight loop.

### Perf Check 5 — String Concatenation at Scale

Recipe YAML generation loops over hundreds of fields. Check for string concatenation patterns that allocate large numbers of intermediate strings:

```bash
git diff main...HEAD -- '*.ts' | grep "^+" | grep -v "^+++" | grep 'result \+= \|output \+= ' || true
```

Prefer array push + join over repeated string concatenation in loops.

### Perf Review Output Format

```
## ⚡ Performance Review — Senior Performance Engineer

### Summary
<what changed and performance risk level>

### Findings
| Severity | Location | Issue |
|----------|----------|-------|

### Verdict
APPROVE — no performance concerns
  OR
REQUEST CHANGES — <issue>
```

---

## Post Both Reviews to PR

```bash
gh pr view --json number 2>/dev/null --jq '.number'
```

If a PR exists, post each review as a separate comment. Then run `/pr-body` to update the PR table of contents.
