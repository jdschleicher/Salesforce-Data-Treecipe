---
name: cockpit-help-sync
description: Keeps the Recipe Cockpit's ? help section and docs/RECIPE-COCKPIT-GUIDE.md in step with what the cockpit does. Reads the cockpit changes since the guide last changed, rewrites the affected notes in plain words in both places, re-takes the screenshots, and reports what changed and why. Run after any change to the Recipe Cockpit.
---

# /cockpit-help-sync

The Recipe Cockpit's **?** button (#332) opens a short help section. **Open the full guide** opens `docs/RECIPE-COCKPIT-GUIDE.md`, which says the same thing with a screenshot under each heading. This skill keeps the two true and in step whenever the cockpit changes.

**The two places that must say the same thing:**

| Place | What it holds |
|---|---|
| `RECIPE_COCKPIT_HELP_SECTIONS` (and `RECIPE_COCKPIT_HELP_BACKEND_NOTE`) in `src/treecipe/src/RecipeCockpitService/RecipeCockpitService.ts` | The panel's text: four sections, each with paragraphs, optional list items and closing paragraphs |
| `docs/RECIPE-COCKPIT-GUIDE.md` | The same four `##` headings in the same order, the same notes, one screenshot per heading from `docs/images/recipe-cockpit/` |

`RecipeCockpitService/tests/RecipeCockpitHelp.test.ts` fails if a help heading is missing from the guide or out of order, if a heading has no picture, or if a picture is missing or over 200 KB.

---

## Step 1: Find what changed

```bash
GUIDE_COMMIT=$(git log -1 --format=%H -- docs/RECIPE-COCKPIT-GUIDE.md)
git log --oneline "$GUIDE_COMMIT"..HEAD -- src/treecipe/src/RecipeCockpitService CHANGELOG.md
git diff "$GUIDE_COMMIT"..HEAD --stat -- src/treecipe/src/RecipeCockpitService
```

If the working tree has uncommitted cockpit changes, include them too (`git diff -- src/treecipe/src/RecipeCockpitService`).

Read every `CHANGELOG.md` entry added since `$GUIDE_COMMIT`. Each entry says what the reader sees, which is what the help describes.

## Step 2: Sort each change into a section

For each change, decide which section it affects, or put it under "doesn't affect the help". A section is affected only when the change adds, removes or renames:

| Section | Affected when a change… |
|---|---|
| **Where recipes come from** | changes where the cockpit reads recipes from: the run folder, the run list, what a card is |
| **What the cockpit changes without editing the YAML** | adds or removes a setting stored outside the recipe file that changes what is generated (today: excluded objects, unticked fields, record counts, fixed values, faker bounds, the rules box) |
| **What does edit the YAML** | adds or removes a button that writes the `.yml` file (today: Wire to… / Wire TODO lookups, Add &lt;parent&gt; to recipe, +), or one that writes another project file (Remember this selection, Generate permission set) |
| **Where your changes are stored** | changes where those settings are kept (`workspaceState`, by tree folder), what the data set records (`filteredRecipe-…`, `originalRecipe-…`, `datasetSource.json`), or how they are cleared (Reset selection) |

Also check whether a change adds a kind of difference the **per-tree summary** should count. The summary is `describeTreeDifferences` in the panel script, and it reads the tree fields `objectSelection`, `fieldSelection`, `objectCounts`, `fixedValues`, `constraints` and `validationRulesOff`. A new tree field set by `applyObjectSelections` belongs in it, with a test in `RecipeCockpitHelp.test.ts`.

A visual-only change (spacing, colours, a moved button) affects only the screenshots, not the text.

**Never invent behaviour.** Every note must come from code you read or a CHANGELOG entry. Use the exact button labels the panel draws: grep the `*_LABEL` constants and the panel script's `createElement('button', …)` calls. If you can't confirm something, leave it out and say so in the report.

## Step 3: Update both places together

Write in plain words for someone who has never opened the cockpit:

- At most three sentences per note, and one short line per list item.
- Name things by what the reader sees (the button label, the glyph: chain link, pin, ✎), not by code names.
- No issue numbers, class names or message names in either place.
- Explain any term a first-time reader wouldn't know where it's first used (the guide's word list at the top covers "run", "tree" and "recipe file").

Edit `RECIPE_COCKPIT_HELP_SECTIONS` and the matching section of `docs/RECIPE-COCKPIT-GUIDE.md` in the same change, so the two say the same thing. The guide may use Markdown emphasis and code formatting; the panel text is plain. If you add, remove or rename a section, change its heading in both places and keep the order the same. Each guide section keeps exactly one screenshot, and its alt text describes what the picture shows.

## Step 4: Re-take the screenshots

```bash
node developmentSupportScripts/recipe-cockpit-screenshots/captureRecipeCockpitScreenshots.js
```

The script renders the real cockpit shell, fed a model built from `RecipeCockpitService/tests/mocks/historyWorkspace`, in headless Chromium at a fixed 900×640 viewport. It writes a picture only when its bytes changed, and prints `written` or `unchanged` for each.

- It needs Playwright installed outside the project (`playwright-core` or `playwright`, global or local). It never downloads a browser: Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`, or from `CHROMIUM_EXECUTABLE_PATH` when set. If neither is available, say so in the report and leave the pictures as they are. Don't add Playwright to `package.json`.
- If a section now needs a different picture (a new button to show), change the steps for that shot in the script's `run()`. Use fixture names only: no real org, username, alias or local path ever appears in a picture.
- Open each written picture and check it shows what its section and alt text say.
- A picture over 200 KB makes the script fail: shoot a smaller element rather than compressing.

## Step 5: Verify

```bash
npx jest src/treecipe/src/RecipeCockpitService/tests/RecipeCockpitHelp.test.ts
npm run compile
npm run lint
npm run jest-test
```

All must pass. If the help text changed, add a line to the current version's `CHANGELOG.md` entry, or to a new patch entry if nothing else is being released.

## Step 6: Report

Output one short table, then the verification result:

```
## Cockpit help sync

| Section | What changed | Why (source) |
|---------|--------------|--------------|
| What does edit the YAML | Added "Copy recipe" | CHANGELOG 3.92.0; `RECIPE_COCKPIT_COPY_RECIPE_ACTION_LABEL` |
| (screenshots) | what-edits-the-yaml.png re-taken | The card's header gained a button |
| — | No change: the run list's colours | Visual only, already in the screenshot |

Verification: help test ✅ · compile ✅ · lint ✅ · jest ✅
```

If nothing needed to change, say so in one line ("The help and the guide already match the cockpit as of <commit>") and change no files.
