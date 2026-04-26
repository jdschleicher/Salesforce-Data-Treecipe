---
name: debug-tour
description: Generates a CodeTour JSON file for the current feature branch diff — a step-by-step walkthrough of every meaningful change point for reviewers and future contributors.
---

You are the Debug Tour generator for Salesforce Data Treecipe (VS Code Extension). Analyze the current feature branch diff and generate a `.tours/<slug>.tour` JSON file that walks through every meaningful change point.

Tours are for **navigation and review** — they help a reviewer or future contributor understand the change narrative by clicking through steps in VS Code.

---

## Step 1 — Get the Diff

```bash
git diff main...HEAD --name-only | grep "\.ts$" | grep -v "\.test\.ts"
```

Also check for test file changes:
```bash
git diff main...HEAD --name-only | grep "\.test\.ts"
```

Get the branch slug:
```bash
git branch --show-current | sed 's/feature\///'
```

---

## Step 2 — Read Changed Files

For each changed service file, read both the file and its corresponding test file. Understand:
- What method/handler was added, changed, or removed?
- What is the logical flow of the change?
- What is the "story" a reviewer needs to follow?

---

## Step 3 — Identify Tour Steps

A good tour has **5–10 steps** that tell the complete story of the change in logical order:

1. **Start at the entry point** — usually the VS Code command registration or service method signature
2. **Follow the data flow** — XML field → field type detection → faker service → recipe output
3. **Show the key logic** — the actual changed case handler, precision/scale math, or picklist escaping
4. **Show both backends** — if both FakerJS and Snowfakery were changed, include a step in each
5. **Show the tests** — what the countermeasure or new test verifies

For each step, identify:
- **File path** (relative to project root)
- **Line number** (the most relevant line)
- **Description** — 1–3 sentences explaining what this step shows and why it matters

---

## Step 4 — Generate the Tour File

Create `.tours/<slug>.tour` with this structure:

```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "<feature title from branch or PR title>",
  "steps": [
    {
      "file": "src/extension.ts",
      "line": 42,
      "description": "The VS Code command is registered here. When the user invokes `treecipe.generateTreecipe`, execution flows into `ExtensionCommandService.generateTreecipe()`."
    },
    {
      "file": "src/treecipe/src/ExtensionCommandService/ExtensionCommandService.ts",
      "line": 87,
      "description": "The command handler calls `RecipeService.generateRecipe()` after reading configuration. Note the `withProgress` wrapper — this keeps VS Code responsive while processing large org metadata directories."
    },
    {
      "file": "src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts",
      "line": 123,
      "description": "The new `Currency` field type handler. The precision/scale math: `left_digits = precision - scale`, `max = 10^left_digits - 1`. This matches what Salesforce stores in the XML `<precision>` and `<scale>` elements."
    },
    {
      "file": "src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts",
      "line": 98,
      "description": "The equivalent Snowfakery handler. Both backends must produce semantically equivalent faker expressions for the same field type — this is enforced by `IRecipeFakerService`."
    },
    {
      "file": "src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/tests/FakerJSRecipeFakerService.test.ts",
      "line": 201,
      "description": "The countermeasure test verifies that `precision=5, scale=2` produces an amount with at most 3 digits before the decimal and exactly 2 after. This is the regression guard — if the math ever breaks, this test catches it."
    }
  ]
}
```

**Write the file:**
```bash
mkdir -p .tours
```
Then write `.tours/<slug>.tour` with the generated JSON.

---

## Step 5 — Verify Tour Steps

For each step, verify the file path and line number are valid:

```bash
for step_file in <each file referenced in tour steps>; do
  [ -f "$step_file" ] && echo "✅ $step_file" || echo "❌ MISSING: $step_file"
done
```

Adjust line numbers if they drift due to file changes.

---

## Step 6 — Report

```
## Debug Tour Generated

### Tour file
`.tours/<slug>.tour`

### Steps
| Step | File | Line | Topic |
|------|------|------|-------|
| 1 | src/extension.ts | 42 | Command registration |
| 2 | ExtensionCommandService.ts | 87 | Command handler |
| ... | ... | ... | ... |

### How to use
Open VS Code, install the CodeTour extension, and click "Start Tour" in the Explorer panel. Each step walks through the change narrative.

### Cleanup
The tour file can be committed with the PR for reviewer context, or deleted after review. It does NOT insert debugger; statements — safe to commit.
```

---

## Notes

- Tours should tell a **story**, not just list every changed line. Focus on the logical flow.
- For field type handler changes: always include a step showing both the FakerJS and Snowfakery handlers side by side.
- For new VS Code commands: start at `extension.ts` → `ExtensionCommandService` → the service being called.
- Keep step descriptions focused on **why** this code exists and **what constraint** it enforces, not just what it does.
