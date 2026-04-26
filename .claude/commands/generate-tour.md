---
name: generate-tour
description: Generates a focused CodeTour JSON file for a specific topic, system, or feature — e.g. "recipe generation pipeline", "currency field handler", "relationship service". Great for onboarding to a subsystem.
---

You are the CodeTour generator for Salesforce Data Treecipe (VS Code Extension). Create a focused, immersive CodeTour file for a specific topic provided by the user.

## Input

The user will provide a topic, such as:
- "recipe generation pipeline" — the full flow from command to YAML output
- "field type handling" — how a Salesforce XML field type becomes a faker expression
- "currency precision/scale math" — the numeric constraint logic
- "picklist handling" — how picklist values and special characters are handled
- "relationship service" — how objects are grouped into Treecipe files
- "validation rule analyzer" — the ValidationRuleAnalyzerService pipeline
- a specific new feature they just built

If the user doesn't specify a topic, ask:
> What topic or subsystem should I generate a tour for?

---

## Process

### 1 — Explore the Topic

Use Bash and Read tools to find relevant files:

```bash
# Find all service directories
ls src/treecipe/src/

# Search for topic-specific code
grep -rn "<topic keyword>" src/treecipe/ --include="*.ts" -l | grep -v "\.test\.ts" | head -20

# Find interface files
find src/ -name "I*.ts" | grep -v "test"

# Find test files for the topic
grep -rn "<topic keyword>" src/treecipe/ --include="*.test.ts" -l | head -10
```

Aim to identify **6–10 key files** that tell the complete story.

---

### 2 — Map the Code Flow

For the recipe generation pipeline, the canonical flow is:

```
src/extension.ts
  → src/treecipe/src/ExtensionCommandService/ExtensionCommandService.ts
    → src/treecipe/src/ConfigurationService/ConfigurationService.ts
    → src/treecipe/src/DirectoryProcessingService/DirectoryProcessor.ts
      → src/treecipe/src/XMLProcessingService/XmlFileProcessor.ts
        → src/treecipe/src/ObjectInfoWrapper/ObjectInfoWrapper.ts
          → src/treecipe/src/RecordTypeService/RecordTypeService.ts
          → src/treecipe/src/ValueSetService/ValueSetService.ts
          → src/treecipe/src/RelationshipService/RelationshipService.ts
    → src/treecipe/src/RecipeService/RecipeService.ts
      → src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts
      → src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts
```

For the specific topic, identify which slice of this flow is relevant and trace through the actual code.

---

### 3 — Write Tour Steps

For each key file, identify the most informative line(s) and write a step that explains:
- **What this code does** in the context of the topic
- **Why it works this way** — what constraint, design decision, or Salesforce behavior it handles
- **How it connects** to the next step in the flow

Keep descriptions to **2–4 sentences** per step. Focus on insights a new contributor wouldn't get from just reading the code.

---

### 4 — Generate the Tour File

Create `.tours/<topic-slug>.tour`:

```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "<topic title>",
  "description": "<1 sentence: what this tour covers and who it's for>",
  "steps": [
    {
      "file": "<relative file path from project root>",
      "line": <line number>,
      "description": "<2-4 sentence explanation>"
    }
  ]
}
```

**Write the file:**
```bash
mkdir -p .tours
```

Then write `.tours/<topic-slug>.tour`.

---

### 5 — Verify Step Validity

For each step, confirm the file and line exist:

```bash
# Check files
for f in <each file in steps>; do
  [ -f "$f" ] && echo "✅ $f" || echo "❌ NOT FOUND: $f"
done
```

Adjust line numbers if needed.

---

## Example Tours by Topic

### "recipe generation pipeline"
Steps: extension.ts command registration → ExtensionCommandService handler → ConfigurationService reads config → DirectoryProcessor walks metadata → XmlFileProcessor parses field XML → ObjectInfoWrapper wraps parsed data → RelationshipService groups objects → RecipeService orchestrates output → FakerJSRecipeFakerService generates one faker expression → final YAML write

### "field type handling"
Steps: XmlFileProcessor extracts `<type>` value → ObjectInfoWrapper stores it in FieldInfo → RecipeService dispatches to faker service → FakerJSRecipeFakerService switch/case for each type → corresponding Snowfakery case → test fixture XML showing the input → test assertion on the output expression

### "currency precision/scale math"
Steps: Salesforce XML with `<precision>` and `<scale>` elements → XmlFileProcessor extracts both values → FieldInfo stores them → FakerJSRecipeFakerService currency handler computes left_digits = precision - scale → max = 10^left_digits - 1 → faker.finance.amount call with computed args → Snowfakery equivalent → test cases verifying boundary values

### "picklist handling"
Steps: GlobalValueSetSingleton explained → ValueSetService parses global value sets → RecordTypeService finds picklist options for each record type → special character escaping for `&`, `'`, `"` in values → FakerJSRecipeFakerService builds the `random_element` expression → Snowfakery equivalent

---

## Output

```
## CodeTour Generated

### Topic
<topic name>

### Tour file
`.tours/<slug>.tour`

### Steps (<N> total)
| Step | File | Line | Topic |
|------|------|------|-------|
| 1 | src/extension.ts | 42 | Entry point — command registration |
| 2 | ExtensionCommandService.ts | 87 | Command dispatch |
| ... | ... | ... | ... |

### How to use
Open VS Code → Explorer panel → CodeTour → Start Tour "<topic title>".

Requires the CodeTour VS Code extension (`vsls-contrib.codetour`).
```
