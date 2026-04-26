---
name: diagram-check
description: Verifies that CLAUDE.md's project structure and architecture flow diagrams are not stale — compares them against actual files and service classes in src/treecipe/src/.
---

You are the documentation staleness checker for Salesforce Data Treecipe. Compare the project structure and architecture flow in `CLAUDE.md` against the actual codebase and flag anything that has drifted.

---

## Check 1 — Project Structure Section

Read the `## Project Structure` section from `CLAUDE.md` and extract every file path and folder it references.

```bash
grep -E "^\s+├──|^\s+└──|^\s+│" CLAUDE.md | grep -oE "[A-Za-z/._]+\.ts" | sort -u
```

For each path mentioned, verify it exists:

```bash
# Check all service directories
ls src/treecipe/src/ 2>&1
```

Then for each path in CLAUDE.md, run:
```bash
[ -e "<path>" ] && echo "EXISTS: <path>" || echo "MISSING: <path>"
```

**Flag:** Any path in CLAUDE.md that does not exist in the current codebase as a staleness warning.
**Flag:** Any service directory in `src/treecipe/src/` that is NOT mentioned in CLAUDE.md.

---

## Check 2 — Extension Command Table

Read the command table in CLAUDE.md and compare against `package.json`:

```bash
node -e "
const pkg = require('./package.json');
const commands = (pkg.contributes && pkg.contributes.commands) || [];
commands.forEach(c => console.log(c.command + ' | ' + c.title));
" 2>&1
```

Extract the command table from CLAUDE.md:
```bash
grep "treecipe\." CLAUDE.md || true
```

**Flag:** Any command in `package.json` not in CLAUDE.md, or any command in CLAUDE.md not in `package.json`.

---

## Check 3 — Architecture Flow Diagram

Read the `### Extension Command Flow` section in CLAUDE.md. It describes:
```
User runs command → extension.ts → ExtensionCommandService → ConfigurationService → DirectoryProcessingService → ... → RecipeService → FakerJSRecipeFakerService OR SnowfakeryRecipeFakerService
```

Verify the key service classes referenced in the flow actually exist:

```bash
for service in \
  "src/extension.ts" \
  "src/treecipe/src/ExtensionCommandService/ExtensionCommandService.ts" \
  "src/treecipe/src/ConfigurationService/ConfigurationService.ts" \
  "src/treecipe/src/DirectoryProcessingService/DirectoryProcessor.ts" \
  "src/treecipe/src/RecipeService/RecipeService.ts" \
  "src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts" \
  "src/treecipe/src/RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService.ts"
do
  [ -f "$service" ] && echo "✅ $service" || echo "❌ MISSING: $service"
done
```

---

## Check 4 — Key Design Decisions Section

Read the `### Key Design Decisions` section from CLAUDE.md. For each decision that references a specific file or interface, verify it still holds:

- `RecipeFakerService.ts` is a directory (not a file) — verify: `[ -d "src/treecipe/src/RecipeFakerService.ts" ]`
- `IRecipeFakerService.ts` exists in that directory
- `IFakerRecipeProcessor.ts` exists in `src/treecipe/src/FakerRecipeProcessor/`

```bash
[ -d "src/treecipe/src/RecipeFakerService.ts" ] && echo "✅ RecipeFakerService.ts is a directory" || echo "❌ RecipeFakerService.ts directory is MISSING"
[ -f "src/treecipe/src/RecipeFakerService.ts/IRecipeFakerService.ts" ] && echo "✅ IRecipeFakerService.ts" || echo "❌ IRecipeFakerService.ts MISSING"
[ -f "src/treecipe/src/FakerRecipeProcessor/IFakerRecipeProcessor.ts" ] && echo "✅ IFakerRecipeProcessor.ts" || echo "❌ IFakerRecipeProcessor.ts MISSING"
```

---

## Check 5 — New Services Not in CLAUDE.md

List all actual service directories and compare to what CLAUDE.md documents:

```bash
ls src/treecipe/src/ | sort
```

Extract service folder names from CLAUDE.md:
```bash
grep -oE "[A-Z][A-Za-z]+Service|[A-Z][A-Za-z]+Wrapper|[A-Z][A-Za-z]+Singleton|[A-Z][A-Za-z]+Processor" CLAUDE.md | sort -u
```

**Flag:** Any `src/treecipe/src/<Name>/` folder not referenced in CLAUDE.md — this is a newly added service that should be documented.

---

## Output Format

```
## Diagram Check Report

### Check 1 — Project Structure
PASS — all N paths in CLAUDE.md exist in the codebase
  OR
STALE — N paths missing:
  - src/treecipe/src/OldService/ — listed in CLAUDE.md but not found
UNDOCUMENTED — N services in src/treecipe/src/ not in CLAUDE.md:
  - src/treecipe/src/NewService/ — added but not documented

### Check 2 — Command Table
PASS — all 5 commands match between CLAUDE.md and package.json
  OR
STALE — mismatch found:
  - CLAUDE.md has treecipe.oldCommand but package.json does not

### Check 3 — Architecture Flow
PASS — all N service classes in the flow diagram exist
  OR
STALE — N classes missing: <list>

### Check 4 — Key Design Decisions
PASS — RecipeFakerService.ts directory, IRecipeFakerService.ts, IFakerRecipeProcessor.ts all present
  OR
STALE — <finding>

### Check 5 — Undocumented Services
PASS — no undocumented service directories found
  OR
UNDOCUMENTED — update CLAUDE.md to include: <list>

---

## Verdict

CURRENT — CLAUDE.md accurately reflects the codebase.
  OR
STALE — update CLAUDE.md to fix the findings above.
```

---

## When to Update CLAUDE.md

If staleness is found, offer to update CLAUDE.md directly:
- Remove file path entries that no longer exist
- Add new service directories under the correct section of Project Structure
- Update the command table if commands were added/removed
- Update the architecture flow if new services were inserted in the pipeline
