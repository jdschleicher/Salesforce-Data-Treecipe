---
name: jidoka
description: Jidoka countermeasure — when a bug or regression is found, writes a targeted test that catches it before fixing the code. Invoke when something breaks to build a permanent safety net.
user_invocable: true
---

# Jidoka — Stop, Fix, Prevent

**Jidoka** (autonomation) is the Toyota principle: when a defect is detected, stop the line, fix the root cause, and install a countermeasure so it never recurs. In code: write a test that catches the bug *before* fixing it.

## When to Use

Invoke `/jidoka` when:
- A bug is found in the extension or reported by a user
- A test is failing unexpectedly
- A regression appears after a code change
- A code review catches a defect
- Any "this should never happen" scenario actually happens

---

## Step 1 — Identify the Defect

Read the conversation context to understand:
1. **What broke?** — the observed behavior
2. **What was expected?** — the correct behavior
3. **Where?** — which service, command, or field type handler is affected

If the user already described the issue, extract these from context — don't re-ask.

---

## Step 2 — Root Cause Analysis

Read the relevant source files and trace the defect to its root cause. Document:

- **Root cause:** Why did it break?
- **Blast radius:** What else could be affected? If a field type handler is wrong in `FakerJSRecipeFakerService`, is the same handler also wrong in `SnowfakeryRecipeFakerService`?
- **Why tests didn't catch it:** Was there a gap in the test coverage?

---

## Step 3 — Write the Countermeasure Test FIRST

Before fixing the code, write a test that:
1. **Reproduces the defect** — must fail with the current broken code (or would fail if the fix were reverted)
2. **Is specific** — tests exactly the condition that caused the failure
3. **Uses a `jidoka:` prefix** in the describe block

```typescript
// Jidoka: <short description of what broke>
// Countermeasure for <root cause description>.
// <What the test ensures going forward.>

describe('jidoka: <ServiceName>', () => {
  it('<specific condition that must hold>', () => {
    // ...
  });
});
```

**Test placement:** Co-locate with the existing test file for the affected service:
- `src/treecipe/src/<ServiceName>/tests/<ServiceName>.test.ts`
- If the bug is in both faker backends, add countermeasure tests in both:
  - `src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/tests/`
  - `src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/tests/`

---

## Step 4 — Fix the Root Cause

Apply the minimal fix. Do not refactor surrounding code — just fix the defect.

If the bug is a missing or incorrect field type handler in one faker backend, check and fix the same handler in the other backend (CLAUDE.md requires both stay in sync).

---

## Step 5 — Verify

```bash
npm run jest-test 2>&1
npm run compile 2>&1
```

All tests must pass, including the new countermeasure test. Zero TypeScript errors.

---

## Step 6 — Report

```
## Jidoka Report

### Defect
<What broke and how it was observed>

### Root Cause
<Why it broke — the specific service, method, or field type condition>

### Countermeasure Test
- **File:** `<path to test file>`
- **Test:** `<describe/it block name>`
- **Verifies:** <What the test ensures going forward>

### Fix Applied
- **File:** `<path to changed file>`
- **Change:** <What was changed and why>

### Blast Radius Check
Both faker backends checked: <Yes/No>
<Were any similar patterns found in other services? If yes, were they also fixed?>
```

---

## Principles

1. **Test before fix** — the countermeasure test must fail (or provably cover) the broken state before the fix is applied.
2. **One test per defect** — each jidoka test targets exactly one root cause.
3. **Labeled clearly** — anyone reading the test should understand what incident it prevents and why it exists.
4. **Minimal fix** — the countermeasure test is the lasting value; the fix should be as small as possible.
5. **Both backends** — if a field type handler is the root cause, always check the equivalent in the other faker service.
