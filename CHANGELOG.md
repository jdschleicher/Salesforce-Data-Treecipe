# Change Log

## [3.110.0] - Recipe Cockpit: the selected tab and its content share one outline, and every search box shows a search icon

Closes [#373](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/373).

A tree card's tabs, and the Troubleshooting tab's sub-tabs, showed the selected tab only as an underline and bold text. The content under them had no edge, so it ran into the card, the parent tabs and the next card. The search boxes were plain text boxes.

- **One outline per selected tab.** The selected tab and its content are drawn as one accent outline, like a folder tab: the tab's top and sides, then the content's sides and bottom, with no line between them. The grey rule under each tab strip is gone. Tabs that aren't selected look as before.
- **Sub-tabs too.** The Troubleshooting sub-tabs get the same outline, inset inside the Troubleshooting tab's own outline so the two read as separate levels. On a panel too narrow for the six sub-tabs, the strip wraps onto two rows, and only a selected sub-tab on the last row joins its content; one on an earlier row sits above the next row. Scrolling the strip instead would clip the overlap that joins every tab to its content.
- **Hover.** Hovering a tab that isn't selected no longer draws a grey bottom edge, which would now sit on the content's accent outline. The selected tab's outline outranks the button hover rule by specificity, so a hover never draws its bottom edge back.
- **The moving bar is on top.** The accent bar that slides to the selected tab now runs along the tab's top edge, so nothing is drawn between a tab and its content. It moves as it did, and reduced motion still turns it off.
- **A magnifier in every search box.** Every card-tab and sub-tab search box shows a magnifier inside its left edge, and the text starts past it. It's drawn like the chain link: inline SVG built node by node and stroked from the palette, so the CSP and the shell builder are unchanged. A screen reader skips it, the box keeps its name, and clicking the icon puts the cursor in the box.
- **Colours.** The outline is `--sdt-accent` and the icon `--sdt-muted`, both on `--sdt-surface`, pairs the contrast test already holds to 3:1.
- **Guide.** Two screenshots in `docs/RECIPE-COCKPIT-GUIDE.md` were re-taken. The help text didn't change.
- **Tests.** A new harness suite checks that every tab panel carries the outline class (one-tab cards included), that the stylesheet outlines the selected tab and panel with no strip rule and the bar on top, that every search box on every tab and sub-tab holds exactly one hidden SVG magnifier with the input's name unchanged, and that clicking the icon focuses the input. The motion and partial-update suites cover the bar's new edge and the icon in a data sets box rebuilt in place.

## [3.109.0] - Recipe Cockpit: the Validation Rules sub-tab lists each object's rules and what they did

Closes [#327](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/327).

Generate Treecipe applies the validation rules it can (#324) and writes a TODO for each one it cannot, but the cockpit never showed which rules a tree's objects have, which ones shaped a field, or why one was not applied. The issue asked for a **Validation rules** button on the Treecipe tab. Since 3.106.0 (#365) the Troubleshooting tab has a **Validation Rules** sub-tab, so the list is there instead, under **Retrieve validation rules…**.

- **One group per tree object.** Each rule shows its name, its status (**Applied**, **Not applied**, **Inactive**, **Not in this run** or **Unreadable**), whether its file says it is active, its error message, the fields it constrains and, when it was not applied, why. An object with no rules says so.
- **Where each value comes from.** Whether a rule was applied, the fields it constrains and why it was not applied come from #324's records in the run's objects wrapper: each field's `validationRuleConstraints` and the object's `ValidationRulesNotApplied`. The wrapper records nothing for an inactive rule and keeps no error message or formula, so those are read from the rule's file under `salesforceObjectsPath`, the folder Generate Treecipe reads. A rule that is active but the run records nothing for is **Not in this run**: it was added or activated after Generate Treecipe ran. A rule the run recorded whose file is gone is still listed, with a note. A rule deactivated since the run reads as **Inactive**.
- **The formula is collapsed.** **Show formula** builds it the first time it is opened. Every value is written with `textContent`, and no rule text reaches the shell.
- **No rules in the project.** When the project holds no rule file for any of the tree's objects, the sub-tab says so and points at **Retrieve validation rules…** above it (#326). A retrieve reads the list again and posts it.
- **Loaded when opened.** Opening the sub-tab posts `loadValidationRules {treeKey, renderSequence}` and nothing else. The router matches the key against `nameableTreeKeys`, the pending/active allow-list the other Troubleshooting actions use, and the model on screen. The host reads the list then and keeps it per model and tree, and the panel asks once per model, so the posted model did not grow. A list that could not be read (an objects path outside the workspace, an unreadable wrapper) says why, and is asked for again the next time the sub-tab opens.
- **Bounded and link-free.** `RecipeCockpitValidationRuleList` (no vscode) finds each object's folder the way **Generate permission set…** does, in name order and without following a link. A linked `validationRules` folder or rule file is not read. It reads at most 500 rules per object (Salesforce's own limit) and counts the rest. A file over 256 KB is not read. Error messages and formulas are cut at Salesforce's own limits (255 and 3,900 characters) and marked with `…`. Rules are kept in a `Map`, so a rule named `__proto__` is a name like any other.
- **Search.** The sub-tab's search now matches rules by object, rule name, status, error message, field and reason, plus the formula while it is open. It counts rules instead of actions and hides an object with no matching rule.
- **Help and guide.** The ? help and `docs/RECIPE-COCKPIT-GUIDE.md` describe the list. No screenshot shows the Troubleshooting tab, so none changed.
- **From review.**
  - The read gives the extension host back every 200 rule files, as the Troubleshooting counts do. xml2js settles synchronously, so the read never gave it back before.
  - The run's rule records are parsed from the wrapper once per model, not once per tree, as the Query tab shares its wrapper read.
  - Each object group's rows are built when it opens, and groups open within the cockpit's auto-expand budgets (25 objects, 2,000 rows), like the TODO's sub-tab. Each rule's search text is taken once from the posted values, so a keystroke reads no DOM.
  - Opening or closing a formula applies the search again.
  - After a retrieve, every card that had drawn its list gets it again, not only the card that retrieved.
  - A rule is matched to its run record by the name generation recorded it under, as `ValidationRuleAnalyzerService` reads it. An empty `<fullName>`, a name longer than 255 characters, and a file generation could not read now find their record instead of reading as not in this run or as a missing file.
  - A list read that threw is not kept.
- **Tests.** `RecipeCockpitValidationRuleList.test.ts` runs the reader over #324's real pipeline output and the DirectoryProcessor's Gadget__c metadata. It covers applied, not applied, inactive, a rule added since the run, a rule whose file is gone, a rule deactivated since, unreadable files, bounds, links and the 500-rule cap, malformed wrapper records, the router, the host (nothing read until asked, no org contacted, kept per model, read again after a retrieve, failures) and the real panel script: the populated, empty and no-local-rules states, a collapsed formula, hostile text, search, a restored place, and a list for another model.

## [3.108.0] - Recipe Cockpit: the version, the GitHub icon and ? on one line

Closes [#350](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/350).

3.95.0 (#333) put the version and the GitHub icon on the title row, while **?** sat at the right end of the toolbar on the next line, so the cockpit's controls about itself were split across two lines.

- **One line, top right.** The version, the GitHub icon and **?** now sit together at the right of the title row, in that order. The toolbar keeps the run list and **Favorites only**.
- **Wraps as one group.** On a narrow panel the three move under the title together, still right-aligned. They never split from each other, and nothing scrolls sideways.
- **? is outside the body.** Like the version and the icon, **?** is drawn once and is never removed by a load, the empty state or a failure to draw. It toggles the help section each render draws, and works in the empty state as before. Before the first model is drawn, and after a failure to draw, there is no help section, so **?** is disabled. Whether help is open is still kept in your place.
- **Nothing else changed.** The version still arrives in `extensionInfo` and is written as text, the GitHub icon still posts only `openChangelog`, and no URL is in the shell. **?** is still a `primary` button, and the help section and **Open the full guide** are unchanged.
- **Guide.** `docs/RECIPE-COCKPIT-GUIDE.md` says where **?** is, and its first screenshot was re-taken.
- **Tests.** The #332 and #333 suites look for **?** in the top-right container. A harness test checks that it holds the version, the GitHub icon and **?** in that order on the empty state, a drawn run and a failure to draw, with **?** disabled only when there is no help section. Another checks that **?** is the same button across models, keeps its open state, is disabled before the first model, and is disabled again, with its `aria-expanded` and `aria-controls` removed, when a model fails to draw after help was opened.

## [3.107.0] - Recipe Cockpit: a Query tab that runs a tree's generated SOQL and exports the results

Closes [#367](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/367).

Generate Treecipe has always written a `soql-sosl-templates--<tree>-<ts>.md` into each tree folder, but nothing in the cockpit showed those queries or ran them. To see what a tree's insert put in an org, you had to find the file, copy a query into another tool and export from there.

- **A fourth tab.** Every card with a folder now has **Query** after Troubleshooting. Like Troubleshooting, it is built the first time it is selected and has its own search box, which matches each query's object, kind, notes and current text. Its search is saved in a place only when it is not empty, so the place version did not change.
- **The queries are the markdown's.** The host reads them from the run's objects wrapper with `SOQLTemplateService.listTreeQueries`, the same derivation the `.md` file is written from, not by parsing the markdown. Each tree object lists its Base, Child-to-Parent, Parent-to-Child and Record Type Filtered queries. The template's `--` lines become the query's notes, since SOQL has no comments. The SOSL template is not listed. The wrapper is type-checked on the way in (`RecipeCockpitQuery.toQueryObjectsWrapper`): an object is kept only under an api name, in a map with no prototype. The `.md` file Generate Treecipe writes is unchanged.
- **Editing.** Each query is a text box. An edit is saved, per tree folder and query, in VS Code's workspace state (`treecipe.recipeCockpit.queryEdits`) when the box loses focus and before a run. **Reset** puts back the generated text. Neither the recipe nor the `.md` is ever written. A query key is a position (`<object>:<kind>:<index>`), so each edit is stored with the text it was made from. If a later Generate Treecipe gives that key different text (a lookup or record type added or removed), the edit is not shown, rather than appearing on another query.
- **Running.** **Run…** posts only the tree key, the query key and the text. The host matches the query key against the queries it read for that tree, then holds the text to one `SELECT`: trimmed, at most 100,000 characters (SOQL's own limit), no `;` outside a quoted value, no control character but a tab or a line break. The org is asked for in the command palette **every time**, over every connected org, production included, as **Retrieve validation rules…** does (#326), because a query only reads. The Target Org Management selection is never used. The query runs on a connection opened by that org's username and reads every page with `queryMore`, up to 50,000 records or 1,000,000 values, whichever comes first, and can be cancelled between pages. The value budget is what bounds memory, because the generated base query selects every field. Measured at 50,000 records of 300 fields, holding them took ~2 GB and the JSON export threw; 1,000,000 values hold about 176 MB and build either export in under a second. The previous result is let go before a new run reads, when a new model is drawn and when the panel closes. One query runs per window; nothing else running holds it, and it holds nothing else.
- **What comes back.** The panel gets a preview: the record count and the first 50 rows and 50 columns as text, each cell cut at 300 characters, written with `textContent`. It says how many rows and columns it left out. The host keeps the whole result of the last run for an export. How the run went is one notification: information on success, a warning when the result was truncated at the cap, when it was cancelled, or when the org refused the query (its message escaped). An org that cannot be connected to is one fixed warning that says to log in again; its error is not quoted, since it can carry token or auth URL text.
- **Export.** **Export JSON** and **Export CSV** post only the tree key, the query key and the format, and are enabled once that query has a preview. They write the result held for that same tree folder and query to `treecipe/QueryResults/<tree folder>/<yyyyMMdd-HHmmss>-<object>-<kind>.json|csv`. The folder gets a `.gitignore` that ignores everything in it, the file is written with `wx` and takes `-2`, `-3`, … on a clash, and the path is checked to be inside the workspace before and after its folders are made. The notification offers **Open file**. When `QueryResults/.gitignore` does not ignore everything, for example a file the repository already carried with a `!` line, the notification becomes a warning that the file could be committed. Building an export that fails is a warning, never an uncaught error. The objects wrapper is read once per model, not once per tree. JSON is the records without `attributes`, with a subquery as its records. CSV has one column per value, in the order the org first answered each. A parent's fields are dotted columns (`Account.Name`), a subquery is one column holding its records as JSON, quoting follows RFC 4180, and a text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` prefix so a spreadsheet does not run it as a formula.
- **Buttons.** The tab's buttons are made with 3.105.0's `createButton`: **Run…** is `primary`, each query's one main action, and **Reset**, **Export JSON** and **Export CSV** are `secondary`.
- **Help and guide.** The ? help, `docs/RECIPE-COCKPIT-GUIDE.md` and the preview warning describe the tab. The screenshots were re-taken, and their tab strip now shows Query.
- **Tests.** `SOQLTemplateService.test.ts` checks that `listTreeQueries` holds every query the markdown holds. The Query suites also cover the value budget, the preview's column limit, an edit whose query was regenerated, an export after a new model, the `.gitignore` check and an export that fails to build. `RecipeCockpitQuery.test.ts` covers the wrapper check, the single-`SELECT` rule, paging to the cap and cancelling, the JSON, CSV and preview formats, and the export writer's refusals: folder names, a link out of the workspace, a failed write. `RecipeCockpitQueryTab.test.ts` runs the router, the host against a faked org prompt and connection (prompt every time, a dismissed pick, a refused text, an org error, truncation, a cancel, exports, one run per window, a replay) and the real panel script.

## [3.106.0] - Recipe Cockpit: the Troubleshooting tab shows one sub-tab at a time

Closes [#365](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/365).

The Troubleshooting tab (#346) stacked four sections under one search box, so finding one action meant scrolling past the rest. It is now a row of sub-tabs, one area at a time.

- **Six sub-tabs, left to right:** **TODO's**, **Fields**, **Permissions**, **Validation Rules**, **Record Types** and **Global Value Sets**. TODO's is selected until you pick another, and the one you pick is kept with the rest of your place, so it is there after a reopen or a window reload. The underline moves like a card's tabs, and not at all under reduced motion.
- **Where each action went.** Fields holds **Deploy fields…**; Permissions holds **Assign permission sets to me…**, **Generate permission set…** and **Deploy permission set…**; Validation Rules holds **Retrieve validation rules…**; Record Types and Global Value Sets each hold their deploy, which used to share "Dependent metadata". What each button does, its confirmation, its sandbox-only check and its notification are unchanged.
- **TODO's.** Every TODO comment of the card's recipe, one group per object with its count, each entry with its field (or "on the object"), its text and an **↗ yml** link to its line. A group's rows are built when it opens, and groups open within the cockpit's auto-expand budgets (25 objects, 2,000 rows), like a Treecipe object's rows. A field TODO the model sends without its text (the field's own value holds it, #354) now carries where its value holds it (`valueStart`, `valueLength`), so the list shows the exact text. The label counts them ("TODO's (5)"); a card with none says so. **TODOs only** stays on the Treecipe tab.
- **A search per sub-tab.** Each sub-tab has its own box, which hides the TODOs or actions it does not match and counts the rest. It matches what is on screen (not a button's tooltip), searches TODOs whose rows are not built yet, opens the groups that match, and is re-applied when a run changes what an action draws. Its text survives switching sub-tabs and is kept in the place. The tab-wide "Search troubleshooting actions" box and the four section titles are gone, and so is the intro line above them.
- **The place.** A card's place gains the optional `troubleshootingSubTab` (never the first) and `troubleshootingSearchQueries` (only non-empty searches), so the place version did not change. An older place, or one naming a sub-tab that does not exist, opens on TODO's, and a tab-wide Troubleshooting search saved before this is dropped.
- **Help and guide.** "Where recipes come from" and "What does edit the YAML" in the ? help and `docs/RECIPE-COCKPIT-GUIDE.md` name the sub-tabs. No screenshot shows the Troubleshooting tab, so none changed.
- **From review.** The first version built every TODO row when the tab opened: 126k elements and about 1 s at 30,000 TODOs, 462k and 6 s at 110,000 (the panel harness). Lazy groups bring that to 25k elements and 0.21 s, and 89k and 0.8 s. A keystroke now filters only its own sub-tab, and a row's visibility is written only when it changes. The panel's own reader of TODO text was replaced by the span the host sends, because it could pick a quoted ` # TODO` inside a value, or a deleted TODO's text, by position.
- **Tests.** `RecipeCockpitTroubleshootingSubTabs.test.ts` covers the order, the default, switching and its motion, where each action sits, the TODO list (grouping, the value span and one that does not fit, links, search, the empty card, hostile text, the budgets and a closed group built on open, search over unbuilt rows), each sub-tab's own search (tooltips not matched, re-applied on a run), and the place (saved, restored, older, unknown, a focused reload, host normalization). The Troubleshooting and permission set suites now find their buttons in their sub-tabs.

## [3.105.0] - Recipe Cockpit: one button design system, so every button is styled by a named kind

Closes [#363](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/363).

The Troubleshooting tab's four deploy buttons (**Deploy permission set…**, **Deploy fields…**, **Deploy global value sets…**, **Deploy record types…**, from 3.101.0) were drawn as plain browser buttons, unlike **Assign permission sets to me…** and **Retrieve validation rules…** beside them. A button was styled only when its class had been added by hand to each of four selector lists (base, hover, filled, disabled), and nothing checked that.

- **Named button kinds.** Every button the panel draws now carries `sdtButton` and exactly one kind: `primary` (filled accent, for the one main action of an area), `secondary` (outlined accent, for every other action), `icon` (a glyph that shows a border on hover), `check` (the tick boxes) or `link` (a recipe line link). `sdtButton-compact` is a smaller size that goes with any kind. Each kind's look and its hover, pressed and disabled states are defined once. A button's own class now sets only its size and layout, and keeps its name, so nothing that finds a button by class changed.
- **The deploy buttons are `secondary`,** the same as the actions beside them. A deploy that cannot run (nothing to deploy, or a run in progress) uses the shared disabled style.
- **One way to make a button.** The panel script makes every button with `createButton(kind, className, text, size?)`, which refuses an unknown kind. `RecipeCockpitButtonKinds.test.ts` fails if a button is made any other way, if any drawn button lacks exactly one kind (it opens every tab, section and the field editor), or if a hover, pressed or disabled rule lists two button classes again.
- **What looks different.** The deploy buttons; the field editor's **Save**, which is bold and darkens on hover and press like every other filled button; and a few buttons when disabled that had no disabled style before: ▸ toggles (the unavailable Record types section's), ☆ and ✎, **Reset selection**, and the field editor's Save, Clear and Cancel. The four guide screenshots re-take byte for byte. The kinds use colour pairs the contrast test already checks, so the palette is unchanged.

## [3.104.0] - Recipe Cockpit: the Treecipes section no longer folds, and Target Org Management stays pinned while the cards scroll

Closes [#364](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/364).

Folding the **Treecipes** section (#348) hid every tree card, and the **Target Org Management** section scrolled away with them, so a reader far down a card could not see which org an insert would reach.

- **Treecipes no longer folds.** Its header is drawn like Target Org Management's: a title with no ▸, no listener and no `aria-expanded`. A click on it changes nothing, and a `focusTree` no longer has a folded section to open.
- **Target Org Management is pinned.** `#cockpitOrgSection` is `position: sticky; top: 0` on `--sdt-page`, above every other layer of the cards, so the picker, Open in browser, ⟳ and + New scratch org stay on screen while the cards scroll under it. A row scrolled into view (a `focusTree`, the Record types focus) stops below it: the page carries `scroll-padding-top` (`RECIPE_COCKPIT_PINNED_ORG_SECTION_SCROLL_PADDING`) only while the section is drawn. The toolbar, the ? help and the version line still scroll. Only the stylesheet changed, and no colour pair was added.
- **Saved places.** A 3.98.0+ place's `isTreecipesSectionCollapsed` is ignored by the panel and dropped by `normalizePanelPlace`, as #355 did for `isOrgSectionCollapsed`; the place version did not change. `buildCockpitSection` and `setCockpitSectionExpanded` are removed, since nothing else used them.
- **Help and guide.** The ? help and `docs/RECIPE-COCKPIT-GUIDE.md` say the org section stays at the top while you scroll and no longer say the Treecipes section folds. Screenshots re-taken.
- **Tests.** `RecipeCockpitSections.test.ts` checks that both headers have no toggle, that a click on either leaves its cards shown and saves nothing, that a saved fold of either is ignored (and dropped on the host) whatever its value, that a focus still opens its card, and that the pinned rule is sticky at the top, on the page colour, above every other `z-index`, with the scroll padding, while the toolbar and help are not pinned.

## [3.103.0] - Recipe Cockpit: one edit button that starts from the field's faker expression

Closes [#356](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/356).

A field row had two buttons for changing what it generates: a pin that wrote one fixed value into the recipe (#262, #342), and a ✎ that narrowed faker bounds on the generated copy only (#323). Neither showed the expression the field actually had, and neither could change its arguments or call another faker method.

- **One button.** Where the pin was, each editable field now has one pencil. The ✎ in the expression row, its Min/Max editor and the `constrained` badge are gone. Which fields can be edited is the pin's rule, unchanged: lookups, `RecordTypeId`, dependent picklists, #220 locks, unticked fields and fields of excluded objects stay locked. The panel, router and executor each check it again.
- **The editor starts from what the field holds.** The box is pre-filled with the field's saved edit, or else the first `${{ … }}` line of its recipe value. A double-quoted expression (a validation rule's) is unquoted, and a picklist's commented record type variants are skipped. The hint says, as you type, which of the two forms Save will write.
- **An expression or a literal.** A value starting with `${{` is saved as an **edited expression**, a new `'expression'` kind of `RecipeFixedValueKind`. It must be exactly one `${{ … }}` and pass `RecipeCockpitRecipeWriter.checkConstrainedExpression`: one line, at most 1,000 characters, and no `${`, `}}`, `{%`, `%}`, `<<` or `<%` inside. It is written double-quoted, the way the cockpit writes constrained expressions. Anything else is a literal, held to the same checks and quoting as a pin before. A typed expression is trimmed; a literal is not.
- **Written and cleared the #342 way.** Save writes the line into the recipe `.yml` on every occurrence, after a modal that now says "an edited faker expression" or "a fixed value". Clear puts back the exact lines from `<recipe>.fixedValues.json`. The store tells the two forms apart by the value itself (only an expression can start with `${{`) and keeps an entry only while its written line is the line that value writes. Run Faker by Recipe from the palette generates from the edit too.
- **Bounds are gone.** Saved selections are now version 7. Bounds saved by earlier versions (`constraintsByFolderName`) are not read, and the next save drops them, so a field that had bounds generates from its recipe again. The validation-rule unticks saved with them are kept. A Run Faker copy and `datasetSource.json` no longer carry `constraintsByObject`; data sets that already record it still read. A posted `editFieldConstraints` routes to nothing. `RecipeFieldConstraint` and each backend's `buildConstrainedExpression` stay, since #324's validation-rule generation uses them.
- **Validation rules.** Bounds no longer switch a field's rules off, so the two "replace the constraints?" prompts are gone. An edited field locks its rules box, as a pinned one did; Clear brings back the rule-driven lines.
- **Help and guide.** The ? help and `docs/RECIPE-COCKPIT-GUIDE.md` describe the one edit button, and the summary of what differs no longer counts faker bounds.
- **Tests.** `RecipeCockpitFixedValueWrites.test.ts` edits and clears an expression on every field Generate Treecipe's real pipeline writes, with each backend and on the validation rule run. Each recipe must come back byte for byte. It also generates an edited expression through the real faker-js processor, and through PyYAML, Jinja and Faker for snowfakery, and checks the writer's refusals. `RecipeCockpitFixedValues.test.ts` covers the pencil, the prefill, the hint, the trimmed post, the "edited" badge, the host save and Clear of an expression, and an expression's refusals. `RecipeCockpitFieldConstraints.test.ts` keeps the writer's constrained-expression tests, and checks that a version 6 selection reads without its bounds and writes version 7, that `editFieldConstraints` routes to nothing, and that no row draws a ✎.
## [3.102.0] - Recipe Cockpit: "+ New scratch org" creates and selects the org, and deploys nothing

Closes [#358](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/358).

Since #200, **+ New scratch org** created a scratch org and then deployed every package directory in `sfdx-project.json` to it, all or nothing. Every create waited on that deploy, and one component that would not deploy turned a working new org into an error. It now only creates the org, so it starts empty and you deploy what you need.

- **One process.** The run is `sf org create scratch` and nothing else. `ScratchOrgService` no longer builds a `project deploy` argv (`buildSourceDeployArguments`, `parseSourceDeployOutput` and the `deploying` phase are gone), and no `…-scratch-deploy.json` result is written. A test fails if the scratch org service builds a deploy argv, and the cockpit's run is checked to start only the create and the re-list. `readDeployComponentCounts` and the 256 MB deploy buffer stay, since 3.101.0's Troubleshooting deploys read them.
- **One outcome for a created org.** A created org is `created`, a cancel that landed as the create succeeded included, since the org is kept. Its notification says `Scratch org <alias · username> is ready. Nothing was deployed to it.` and whether it is selected. It offers **Copy deploy command**, which puts `sf project deploy start --target-org <username>` on the clipboard and runs nothing, and **View output** for the create's saved result. A failed or cancelled create is reported as before, without "No deploy was attempted."
- **The confirmation.** It asks "Create a scratch org through the Dev Hub …? Nothing is deployed to it." and no longer lists the package directories, the all-or-nothing deploy or sfdx-project.json's `replacements`, which only a deploy applies (the Troubleshooting deploys' confirmation still names them). It still names the Dev Hub and where its setting came from, the definition file's edition, admin email and username, the alias and any alias move, the 7 days, and that nothing deletes an org. The project checks before the Dev Hub picker are unchanged.
- **Fewer locks.** A scratch org run no longer holds **Retrieve validation rules…** or **Generate permission set…**, and a retrieve no longer holds **+ New scratch org**: those locks existed only because the run deployed the project's source. The run still holds the org picker, ⟳, the tree insert, **Assign permission sets to me…** and the Troubleshooting tab's deploys, and they still hold it, since each changes or uses the selection.
- **Help and guide.** The ? help, `docs/RECIPE-COCKPIT-GUIDE.md`, the button's title, the preview warning and the README say the button creates and selects without deploying. The screenshots were re-taken and none changed.
- **Tests.** The scratch org suites now cover the create-only run (one process, one result file), Copy deploy command, the confirmation's wording, and a cancel that lands as the create succeeds. The scratch org's deploy fixtures and deploy tests are removed; `readDeployComponentCounts` keeps its own tests. The retrieve and permission set suites check that a scratch org run no longer holds them.

## [3.101.0] - Recipe Cockpit: a Troubleshooting tab with permission set actions and sandbox-only deploys

Closes [#346](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/346).

When a tree's insert failed because the org lacked a field, a permission, a global value set or a record type, the cockpit had no way to fix it, and the fixes it did have sat among the Treecipe tab's everyday controls. This reverses #302's "the cockpit deploys no metadata" for the deploys below only. It does not bring back the old "Deploy this metadata…", whole object folder deploys or "Open Deployment Status".

- **A Troubleshooting tab.** Every card with a folder gets a third tab after Treecipe and Previously Used Data Sets. It has its own search box, which hides the sections that don't match. A saved place can name it. Its search is saved only when there is one, so the place version did not change and an older place reads as it did.
- **Moved, unchanged.** **Assign permission sets to me…**, **Generate permission set…** and **Retrieve validation rules…** moved from the card into the tab's Permission sets and Validation rules sections. Their messages, allow-lists, guards and notifications are unchanged. The retrieve still asks for any connected org, production included, because it only reads.
- **Four deploy buttons, one per kind.** There is no single "deploy everything" button.
  - **Deploy permission set…** offers the project's permission sets that cover the tree, with this tree's generated `SDT_` set listed first and preselected. After a deploy that lands, the notification offers **Assign permission sets to me…**, which goes through the same guards as a click.
  - **Deploy fields…** deploys only the tree's custom (`__c`) fields, leaving out excluded objects and unticked fields. A field whose source file is missing or unreadable is left out and counted. Standard fields are never deployed: the confirmation lists them as "not deployed: standard fields — the org enables these through a feature or setting".
  - **Deploy global value sets…** deploys the value sets the tree's fields name, when the project holds them. One it doesn't hold is named in the confirmation and left out.
  - **Deploy record types…** deploys the tree objects' record types.
  - Each section shows its counts when the tab opens, read from the project on the host. A section with nothing to deploy draws its button disabled, with the reason.
- **Only through a generated package.xml.** Each deploy writes `treecipe/OrgOperations/<username>/<yyyyMMdd-HHmmss>-<operation>-package.xml` and runs `sf project deploy start --json --target-org <username> --manifest <relative path>`. The manifest names only `CustomField`, `GlobalValueSet`, `RecordType` or `PermissionSet` members. Every member is held to the Salesforce api name rule, sorted with `<` and escaped, so a broken layout or object definition in the folder can't fail the deploy. The command never ignores errors, uses the scratch org deploy's 256 MB buffer, and runs in project mode with a cancellable progress notification; Cancel kills the process tree.
- **Sandbox and scratch orgs only.** The router refuses a selected org unless it is the selection, names the same username and answered `IsSandbox: true`. With none selected, the host asks from the same non-production list as the org picker. After the confirmation, the org is asked again on the connection, and the package.xml is written only once it answers that it is a sandbox. Cancel writes nothing and starts nothing.
- **Untrusted output.** A deploy counts as done only on `status 0`, `result.success true` and no component failure. The outcome is one notification (information on success, otherwise a warning naming each failed component) with **View output** for the result file. Nothing is drawn in the panel.
- **One run per window.** A deploy is stored, replayed and adopted like the permission set assignment. While it runs, the insert, the assignment, the retrieve, generating a permission set, + New scratch org and org selection are refused, and the other way round. Once the CLI has run, the org's cached describes of the deployed objects are dropped, and a deploy that landed on the selected org re-checks the cards listing them.
- **From review.**
  - **Objects split across package directories.** An object's fields and record types are read from every package directory that has a folder for it, not only the first. Before, a field kept in a second package directory was reported as "could not be read" and left out.
  - **Replacements are named.** When `sfdx-project.json` has `replacements` that copy local files or environment variables into the metadata, the deploy confirmation says so, as + New scratch org's does.
  - **No linked subfolder.** A `fields` or `recordTypes` folder that is a link is never read.
  - **The tab's counts are cached.** Reading every field file of a large tree is seconds of work on the extension host, so the counts are kept per model, tree and selection, a second request joins the one being read, and the read yields as it goes. They are read and posted again after a deploy, a retrieve or Generate permission set, so a permission set just written enables Deploy permission set….
  - **The follow-up waits for the run.** A landed deploy's notification is shown once the run has ended, so its **Assign permission sets to me…** is not refused as busy, and it uses the org selected above only when that is the org deployed to.
- **Help and guide.** The ? help, `docs/RECIPE-COCKPIT-GUIDE.md` and the preview warning's "It CAN WRITE TO AN ORG" notice name the tab and the deploys. The screenshots were re-taken.
- **Tests.** `RecipeCockpitMetadataDeploy.test.ts` covers the new vscode-free module against a `metadataDeployWorkspace` fixture: what is found, the package.xml (a test fails on any type but `CustomField` or any member that isn't `__c` for a fields deploy), the file path, the argv and the untrusted output. `RecipeCockpitTroubleshooting.test.ts` covers the router, the locks in both directions, the old messages still routing to nothing, the executor (production refused after the modal, Cancel, an unreadable `sfdx-project.json` opening no prompt, failures, cancel, the assign follow-up) and the panel. The #274, #306 and #326 suites now find their buttons in the new tab.

## [3.100.0] - Recipe Cockpit: the org section is "Target Org Management", and it is always open

Closes [#355](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/355).

#348 put the org picker in its own **Org** section and let it fold. Folded, it hid the org every card's generate button depends on.

- **A clearer name.** The section is titled **Target Org Management** (`RECIPE_COCKPIT_ORG_SECTION_TITLE`), on its header and its `aria-label`.
- **Always open.** The section has no ▸ and its header does nothing on a click (`buildStaticCockpitSection`, no `aria-expanded` or `aria-controls`); its body is always shown.
- **An older place still opens it.** `isOrgSectionCollapsed` is gone from the reader's place: the panel no longer saves or reads it, and `normalizePanelPlace` drops it, so a place saved by 3.98.0 with the section folded opens with it showing. The place version did not change.
- **The Treecipes section is unchanged.** It still folds, is still kept as `isTreecipesSectionCollapsed`, and a focus onto a card still opens it.
- **Help and guide.** "Where recipes come from" in the ? help and `docs/RECIPE-COCKPIT-GUIDE.md` use the new name and say only the Treecipes heading folds; the screenshots were re-taken.
- **A smaller help picture.** With this wording and 3.99.0's TODO paragraph, the whole help section came out at 212 KB, over the guide's 200 KB limit. `where-changes-are-stored.png` now shows the help from "Where your changes are stored" down to **Open the full guide** (64 KB): the live summary its caption describes. The other sections have pictures of their own. The screenshot script crops it with a new `screenshotFrom`.
- **Tests.** `RecipeCockpitSections.test.ts` checks the title, that the section has no toggle and stays open on a click, that nothing is saved for it, that a 3.98.0 place (with any value) opens it, and keeps every Treecipes fold case.
## [3.99.0] - Recipe Cockpit: a "TODOs only" filter shows every TODO comment of a tree's recipe

Closes [#354](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/354).

A generated recipe marks what still needs a hand edit with `### TODO` comments: lookups with no reference yet, record type options, missing value sets, formula fields to remove, validation rules not applied, skipped names, fields the cockpit commented out. The only way to see them was to open the `.yml` and search it.

- **TODOs only.** Each card's Treecipe tab has a **TODOs only** check beside **Record type fields only**, labelled with the card's TODO count. It narrows the rows with the tab's search: only fields whose recipe lines carry a TODO comment stay, objects with one are opened (within the usual auto-expand limits), and an object with none stays on screen as "no TODOs". A card whose recipe has no TODO draws the check disabled and says why. The check is saved in the reader's place as the optional `isTodosOnly`, so the place version did not change.
- **What counts.** Any comment whose text starts with `TODO`: the generated `### TODO …` and `### TODO: …` lines and a hand-written `# TODO …`, on a line of its own or after a field's value. A comment is a `#` at the start of a line or after a space, outside a YAML quoted scalar and outside a `{{ … }}` template and its strings, so a picklist or fixed value holding ` # TODO` is a value, not a TODO. Only lines inside an object's block are read; a comment above every object belongs to none. A commented-out field counts once, by its marker.
- **Where each one shows.** A TODO inside a field's lines (its value, a record type variant, a dependent picklist note) is listed under that field's row. One on no field (a validation rule not applied, a record type selection ignored, a commented-out field's marker) is listed at the top of the object's rows. A self-lookup iteration keeps its own, told apart by nickname; an occurrence the cockpit cannot tell apart from the first lists its TODOs on the first. Each TODO is written as text with an **↗ yml** link to its own line, and that line joins the open-source allow-list.
- **One scan.** `RecipeCockpitRecipeWriter.scanRecipeObjects` records each object's TODO lines (`todoLineIndexes`) in the scan the cockpit already makes, and `parseRecipeSource` places them. A line is read once, character by character, and only when it contains `TODO`. `todos` is set on a field, iteration or object only when it has one, so a recipe with no TODO posts exactly the model it did. No recipe file is written, and generation and insert are unchanged.
- **Measured.** A field's TODO carries only its line when the value the row already draws holds its text (`buildFieldTodoViewModels`), which every generated lookup and record type variant does; the row then reads "TODO in the value above". Over the generated `RelationshipTree_1` recipes (152–184 fields, both backends) that adds 0.13–0.15 MB at 12,000 fields and 1.32–1.46 MB at 120,000, against 0.77–1.00 MB and 7.71–10.04 MB with the text posted. On 3.31.0's 59.94 MB at 120,000 fields that is about 61.4 MB. An object's own TODOs (a validation rule not applied) keep their text, since nothing else on screen shows it.
- **Help and guide.** "Where recipes come from" in the ? help and `docs/RECIPE-COCKPIT-GUIDE.md` now names the check.
- **From review.** The first pattern was a regex that a line cut short by a lone CR or U+2028 made quadratic (13 s for a 240 KB line from a cloned repository); the scanner that replaced it is linear, and a test times such a line. TODOs are pushed onto their owner rather than copied per TODO, which was 14 s for 50,000 on one object.
- **Tests.** `RecipeCockpitTodos.test.ts` covers the scan (generated, hand-written, after a value, inside quotes and templates, friends, commented-out fields, a pathological line), where each TODO is placed (fields, objects, iterations, indistinct occurrences), the real pipeline's output with each backend, the open-source allow-list, the check alone and with the search and with Record type fields only, an object's own TODOs, an iteration's TODOs, hostile TODO text, and the saved place.

## [3.98.0] - Recipe Cockpit: the org controls get their own section, above a Treecipes section

Closes [#348](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/348).

The org picker (Choose org…, the org dropdown, **Open in browser**, **⟳ Refresh orgs** and **+ New scratch org**) was drawn again at the top of every card's Treecipe tab (#255): one panel-wide selection, shown once per opened card, and only after a card was opened.

- **One Org section.** Right under the run list is an **Org** section holding the one org picker, its hidden-orgs note and its status line. A card's Treecipe tab no longer draws it, and starts with Reset selection, Wire TODO lookups and the generate button, which still names the org it inserts into or says why it generates only.
- **A Treecipes section.** Every tree card is in a **Treecipes** section under the Org section.
- **Both fold.** Each section's heading is its toggle, like the Record types section's: the whole header is clickable, the ▸ turns, the body names itself through `aria-controls`, and the motion is the cockpit's own (instant on a restore or a focus, none under reduced motion). Both start open. A folded section is kept with the reader's place as the optional `isOrgSectionCollapsed` / `isTreecipesSectionCollapsed`, so the place version did not change and an older place opens both. A focus onto a card (after an insert, a generate, Add friend, Change record types) opens a folded Treecipes section first.
- **Drawn only when there is something to show.** The Org section is drawn only when some card can generate, as the per-card picker was. A run with no trees, and the empty state with no run, draw neither section.
- **Nothing else changed.** Orgs are still listed only when the reader asks (Choose org…, ⟳, opening a card's Treecipe tab, or a picker already used), never on panel open or a restore. Every message, allow-list, run lock and production guard is unchanged, and folding the Org section keeps the selection.
- **Help and guide.** "Where recipes come from" in the ? help and `docs/RECIPE-COCKPIT-GUIDE.md` names the two sections, and the screenshots were re-taken.
- **Tests.** `RecipeCockpitSections.test.ts` covers the order, one picker and none in a card, the toggles, the place (saved, restored, older, same-run reload, host normalization), a focus into a folded Treecipes section, no sections without trees, and no org listing on open. The org suites were updated where they found the picker inside a card.

## [3.97.0] - Recipe Cockpit: a pinned value is written into the recipe file, and Clear puts the field back

Closes [#342](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/342).

A field's 📌 fixed value (#262, #337) used to live only in VS Code's workspace storage and was applied to a temporary copy at generate time, so the recipe `.yml` never showed it, git never saw it, and Run Faker by Recipe from the palette ignored it. It is now written into the recipe file.

- **Save writes the recipe.** After a modal that names both files, the field's lines (the field line and every continuation: record type variants, a multi-line Geolocation value, a "### Driven by ValidationRule" line under it) become one line holding the value, on every occurrence of the object: nested faker-js friends, a self-lookup's iteration and later record type blocks. Text is double-quoted, a number or boolean is written plain, and the same refusals as before apply: line breaks, control characters, template openers, a value equal to a nickname. Every other line keeps its bytes and line ending, a missing final newline stays missing, and the file is scanned again before it is written. The write holds the one recipe write lock that wiring a lookup and Add parent use, and the card reloads.
- **The fixed-values file.** The lines a pin replaced are kept, per occurrence, in `<recipe>.fixedValues.json` beside the recipe (`RecipeCockpitFixedValueStore`: pure, no vscode). Sorting uses `<`, so the same pins write the same bytes on every machine. Pinning a pinned field again keeps the lines from before the first pin. The file is written first and put back when the recipe cannot be written. It is never written through a link or outside the workspace, and a file the cockpit cannot read is never overwritten.
- **Clear puts the field back.** After a modal, `RecipeCockpitRecipeWriter.restorePinnedField` writes the recorded lines back byte for byte, removes the entry, and deletes the file once it is empty. It refuses, changing nothing, when the pinned line was edited by hand since, or when the recorded lines would read as another field or object or carry a bare CR or U+0085/U+2028/U+2029.
- **Re-derived when nothing was recorded.** An occurrence the file holds no usable lines for gets the value Generate Treecipe wrote for the field, and the modal says so. That value is the objects wrapper's `recipeValue` (by type, size, picklist values and validation rules), or, for a standard field the wrapper never lists, the recipe backend's own `getOOTBObjectApiNameToFieldApiNameMap()` entry.
- **Pinned state comes from the file.** A field is drawn as pinned only when every recorded occurrence still holds the line the pin wrote. A field edited by hand since is not, and a notice says so, as it does for a fixed-values file that cannot be read.
- **Nothing in workspaceState.** Fixed values are no longer read from or written to `workspaceState`. A value an older version stored there is no longer applied, so pin it again to write it into the recipe. **Reset selection** leaves a pin alone, since it is in the recipe file, and the help summary of "what differs from the recipe files" no longer counts pins.
- **Geolocation components.** A custom Geolocation field's `__Latitude__s`/`__Longitude__s` components, which the wrapper types `Text`, are pinned as numbers from -90 to 90 and from -180 to 180.
- **Help and guide.** "Fixed values" moved under "What does edit the YAML" in the ? help and `docs/RECIPE-COCKPIT-GUIDE.md`, and the screenshots were re-taken.
- **From review.**
  - **A copy made by "+" is cleared too.** A block copied by **+** (Add friend) after a pin carries the pinned line. Clear now puts that copy back as well, from the recorded lines moved to its depth, and pinning again keeps the copy's lines from before the first pin. Before this, the copy kept the fixed value while the card showed the field as not pinned.
  - **Occurrences are found by nickname.** A recorded occurrence is found by its nickname first, so an object added above it does not move it.
  - **Every occurrence is checked first.** Clear checks every recorded occurrence before it builds anything, so a hand edit on a later occurrence is always seen.
  - **A recorded line must match its value.** A line the fixed-values file records must be exactly the line its value writes, or that occurrence is dropped and a field left with none is not drawn as pinned. The card can no longer draw a pin the recipe does not hold.
  - **Clear shows what it will write.** The Clear dialog shows the lines it puts back: left-aligned, escaped, and cut short after 12 lines or 800 characters.
  - **Writes are atomic.** Both files are written beside their target and renamed over it, so a write that stops part way leaves the recipe as it was.
  - **Loading checks every pin in one scan.** Checking which pins still hold now scans each recipe once, however many pins it has (`listChangedPinnedFields`), sharing its checks with Clear. Before, each pin cost a full split and two scans: about 200 ms per pin at 11,000 objects, so 500 pins took about 125 s on every load. 500 pins of an 11,000-object recipe now check in about 170 ms.
- **Tests.** `RecipeCockpitFixedValueWrites.test.ts` runs Generate Treecipe's real pipeline with each backend, then pins and clears every field it writes. That covers every type in the mock metadata, record type variants, a configured compound Address, a Geolocation, standard fields, nested friends, CRLF and no final newline, and the validation rule run. Each recipe must come back byte for byte, and every pinned occurrence must load with the value. The suite also covers the writer's refusals and the store's handling of hostile JSON. The executor tests cover Save, re-pin, Clear, a cancelled modal, the write lock, a recipe the disk refuses, a hand-edited pin, an unreadable store, and the re-derived Clear.
## [3.96.1] - Recipe Cockpit: one checkbox size, a "Show values" button, no All / None

Closes [#343](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/343).

- **"Record type fields only" is the cockpit's own checkbox.** It drew a text `☐`/`☑` inside a full button. It is now the same 1.25em `treeFieldInclude` box every field, record type and "Remember this selection" checkbox draws, with its label beside it, as "Remember this selection" has. Clicking the label toggles it too. It keeps `role="checkbox"`, `aria-checked`, its `aria-label` and title, the disabled state with its note, and `isRecordTypeFieldsOnly` in the reader's place.
- **A picklist's values open from a "Show values" button.** The chevron is replaced, in the same slot before the field name, by a text button reading **Show values** while closed and **Hide values** while open (`RECIPE_COCKPIT_PICKLIST_SHOW_VALUES_LABEL`, `RECIPE_COCKPIT_PICKLIST_HIDE_VALUES_LABEL`). `aria-expanded`, loading the values on first open and a restored open row are unchanged. Its accessible name starts with the text on the button (`Show values of <Field>`), so a voice command naming what is on screen reaches it. The button and the spacer on rows that are not picklists share one fixed width, so every field name still lines up.
- **All / None are hidden.** An expanded object no longer draws them, and there is no way to show them for now. The host still routes `setAllFieldsIncluded`, so bringing them back is only drawing them again.
- **The guide's pictures are re-taken.** The help text and `docs/RECIPE-COCKPIT-GUIDE.md` named none of the three, so neither changed.
- **Tests.** The record type check's box, label and disabled label, the picklist button's text in both states, its width rule, and that no All / None or `.treeFieldBulk` rule is drawn.

## [3.96.0] - Recipe Cockpit: retrieve a tree's validation rules from an org

Closes [#326](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/326), under [#322](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/322).

#324 applies only the validation rules that are in the project, and many projects never retrieved them, so their trees generated data the org's rules reject.

- **Retrieve validation rules…** sits beside **Generate permission set…** on every card with a folder. It posts `retrieveTreeValidationRules {treeKey}` and nothing else, matched against `nameableTreeKeys`. The objects are the host's, from the tree on screen.
- **The org is always asked for, in the command palette.** `SalesforceOrgService.promptForAuthorizedOrg` runs over every connected org, through `VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed`. It asks every time, even with one org, and even when the Treecipe tab has an org selected. An org index the panel posts is never read. Production is listed, a decision on #326: a retrieve only reads from the org. Dismissing the pick is a quiet cancel.
- **A host modal** names the tree, the org (`alias · username`), every object, and the default package directory where new rule files go. It also says how many local `*.validationRule-meta.xml` files for those objects the org's version will overwrite, counted under every package directory without following links. Everything shown goes through `escapeForNotification`.
- **The retrieve** is `sf project retrieve start --json --target-org <username> --metadata ValidationRule:<Object>.*`, one `--metadata` per object. It runs in project mode through `runCancellableCli`, and a cancel kills the process tree. Every object name passes `SalesforceApiName` before the argv is built, and an argv over 80 objects is refused. The package directories come from the strict `resolveDeployablePackageDirectoryPaths`, so a project that cannot be deployed opens no prompt.
- **The `--json` is untrusted.** It counts as a retrieve only on `status === 0` with `result.success === true`. Each `ValidationRule` file is counted under the tree object its full name names, and a `Failed` or `Error` file is named with what the CLI said. The outcome is ONE notification: information on success, a warning otherwise. It names the rule and object counts and offers **Generate Treecipe** whenever rule files may have been written. A warning also offers **View output**, which opens the result file under `treecipe/OrgOperations/<username>/` (`…-validation-rule-retrieve.json`). Generate Treecipe runs through the open cockpit so the run reloads, and is refused while an insert or another generation runs.
- **One retrieve per window.** `validationRuleRetrieveState {isRunning, treeKey}` is stored, replayed on `ready` and adopted by a panel built mid-run. While one runs, every card's button is disabled. It is refused, with a warning, while an insert, a scratch-org run or a permission set assignment is running, checked at the click and again after the modal. While a retrieve runs, **+ New scratch org** is disabled and refused, because it would deploy the source the retrieve is writing. A cancelled retrieve still offers **Generate Treecipe**, since the CLI may have written files before it stopped.
- **Nothing is deployed.** A test fails if the retrieve path builds a deploy argv, and the module does not spell a deploy subcommand.
- **The opt-in warning and the ? help** now say what the retrieve reads and writes, and `docs/RECIPE-COCKPIT-GUIDE.md` follows the help.
- **Tests.** `RecipeCockpitValidationRuleRetrieve.test.ts` covers the argv and its refusals, the local file count (links and outside paths), every shape of `--json`, the router, the host against a faked org prompt and CLI (prompt every time, cancel, failure, partial failure, cancel mid-run, one per window, Generate Treecipe, View output), and the panel script's button.

## [3.95.0] - Recipe Cockpit: edit a field's fixed value and faker bounds inline

Closes [#337](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/337), under [#322](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/322).

A field's 📌 (fixed value, #262) and ✎ (faker bounds, #323) used to open VS Code input boxes at the top of the window, two in a row for the bounds. Both now open a small editor right under the field's row.

- **The editor.** 📌 shows one box and ✎ shows two (Minimum/Maximum, Minimum length/Maximum length, or Earliest/Latest, depending on the field's type). Each box is pre-filled with what the card generates with now, and a hint says what to type. Save (or Enter) saves; Clear goes back to the faker expression; Cancel (or Escape, or clicking the same button again) closes the editor without saving. A row has one editor at a time: clicking the other button switches it. The button that opened it shows `aria-expanded`, and an editor closes if a redraw locks its field.
- **Refusals show in place.** A value or bound the field cannot hold, min > max, or a template opener is answered under the boxes, and the editor stays open. Nothing is stored and no notification pops up. A save the workspace storage refused says so the same way.
- **The extension still decides.** The panel now sends the typed value or bounds, which is a change from #262/#323, decided in #337. The router accepts only a string within length limits (`RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH`, `RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH`) for a field in `selectableFieldKeys` that no lock holds back. The extension then checks the value against the model on screen at the moment of the write, with the same `validateFixedValueInput` and `RecipeFieldConstraint.resolve` the input boxes used, and answers with a new `fieldEditResult` message. The panel writes a refusal with `textContent`. The recipe file is never written.
- **Validation rules (#325).** Saving bounds on a field whose rules are ticked still asks the host's Replace question first, but only for bounds that pass the checks. Cancel there keeps the rules and says so under the editor. Saving both bounds empty asks nothing and keeps the rules.
- **Colours.** The editor uses only `--sdt-*` text/background pairs that are already in the contrast test.
- **From review.** Enter no longer saves while an IME is composing text, and a fixed-value save routed for a panel that has since closed writes nothing, as a bounds save already did.
- **Tests.** The fixed-value, constraint and validation-rule suites now drive the editor through the real panel script: open, close, Save, Enter, Clear, Escape, pre-fill, one editor per row, refusals written as text, closing on a lock, and results for another model or another editor being ignored. They cover the router's new payload checks (missing, non-string and oversized values or bounds) and the extension's answers (saved, refused, not saved, and nothing for a forged or locked field), and they check that no input box opens. The panel harness's `dispatch` now takes event fields such as a `keydown` key.

## [3.94.0] - Recipe Cockpit: the Record types section is on every card, disabled when there is nothing to choose

Closes [#338](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/338).

A tree card drew the Record types section only when it listed an object with two or more record types, so on any other tree a reader could not tell the choice existed, or why this tree did not offer it.

- **Every card's Treecipe tab draws the header**, in the same place: under the Treecipe search box, above the first object.
- **Disabled when there is nothing to choose.** A card with no object offering two or more record types (none, or only one each, which is no choice) draws the header as a `group` with `aria-disabled="true"`, its ▸ a disabled button with no `aria-expanded` and described by the summary, the title and ▸ in the muted palette colour, and the summary `No objects in this tree have two or more record types in local metadata` (`RECIPE_COCKPIT_RECORD_TYPES_UNAVAILABLE_SUMMARY`), written with `textContent`. It has no body and no listener: a click, the Treecipe search, a restored place saved expanded (or on the old Record types tab) and a focus asking for the section all leave it closed.
- **Unchanged:** a card that lists such an object draws the section exactly as before, and the model, the host and generation are untouched.
- **Tests.** `RecipeCockpitRecordTypes.test.ts` runs the real panel script over a card with no record types, a run whose objects have one record type each, clicks on the header, title and ▸, a search, a restore both ways and a focus.

## [3.93.0] - Recipe Cockpit: "Record type fields only" and a chip naming the restricting record types

Closes [#320](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/320).

Nothing on the Treecipe tab marked which fields depend on record types. Seeing which picklists a record type limits meant opening the Record types section or expanding each picklist row.

- **The check.** Each card's Treecipe tab has a **Record type fields only** check in its search row, off by default and per card. It is a `role="checkbox"` button with `aria-checked`, drawn `☐`/`☑`, so its state is never colour alone.
- **What counts.** A picklist, multi-select or dependent picklist field that at least one of the object's record types restricts: the Record types section's own `objects[].recordTypes[].impacts`. An object counts only with two or more record types, as the section does.
- **With the check on:**
  - Fields that are not restricted are hidden.
  - Objects with such a field expand, within the existing `RECIPE_COCKPIT_AUTO_EXPAND_*` limits.
  - An object with none stays listed, collapsed, as "no record type fields". The filter never hides an object.
  - The match count says how many fields are left.
- **Works with the search.** A field shows only when it matches the search AND passes the check. Clearing either redraws at once. Turning the check off gives back what the reader had opened.
- **Row chip.** Each restricted field's row names the record types that restrict it, in the Record types section's order (`Business, Partner`), whether or not the check is on. An iteration of the object carries the same chips. The chip is text, using the palette's existing chip pair plus a dashed border, so the contrast test needs no new pair.
- **A card with no record types.** The check is disabled with the note "No object in this tree has more than one record type, so no field depends on one." (`RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE`).
- **The place.** The check is saved as the card's optional `isRecordTypeFieldsOnly`, kept by `normalizePanelPlace` only when `true`, so the place version did not change and an older place loads with the check off.
- **No new host data.** The panel indexes the impacts once per model (`indexRecordTypeFields`). The index is keyed by name with `Object.create(null)` and skips:
  - an impact that is not an object;
  - an impact naming a field the object does not list;
  - any field or object named `__proto__`.

  Using the check posts nothing but the reader's place.
- **Tests.** `RecipeCockpitRecordTypeFields.test.ts` runs the real panel script through the harness and covers:
  - the check on and off;
  - the check together with the search;
  - the per-card state and the auto-expand limit;
  - the disabled card and its note;
  - the chip's text, order and singular form, and the chip on an iteration;
  - every ignored impact;
  - the place: save, restore, a card restored collapsed, an older place, and `normalizePanelPlace`;
  - that the model carries nothing new and the check asks the host for nothing.

## [3.92.0] - Recipe Cockpit: a ? help section and an illustrated guide

Closes [#332](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/332), under [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

The cockpit can show a tree that differs from the `.yml` on disk, and nothing in the panel said which settings leave the file alone, which buttons rewrite it, or where the difference is kept.

- **A ? at the right of the toolbar** opens a collapsible help section under it (collapsed by default, `aria-expanded`, drawn in the no-run empty state too). It has four parts: where recipes come from (naming the run on screen), what the cockpit changes without editing the YAML (excluded objects, unticked fields, record counts, fixed values, faker bounds, the rules box), what does edit the YAML (Wire to… / Wire TODO lookups, Add &lt;parent&gt; to recipe, +, plus Remember this selection and Generate permission set, which write other files), and where the changes are stored (workspace storage per tree folder, the `filteredRecipe-…` copy, `datasetSource.json`, Reset selection). A note says only faker-js nests under `friends:`.
- **A live summary** lists each card with a folder that differs from its recipe file, for example `Relationship Tree 1: 1 object excluded · 1 field unticked · 1 count changed · 1 fixed value`. It is counted in the panel from the tree fields the model already carries and redrawn on `objectSelection` and `treePreferences`, so the model posts nothing new. The ungrouped card is never listed. Names are written through `textContent`.
- **Open the full guide** posts `openHelpGuide` and nothing else. The host opens `RECIPE_COCKPIT_HELP_GUIDE_URL` with `vscode.env.openExternal`; the url never reaches the shell, the model or any panel message. The router accepts it once any model is posted, the empty state included, and ignores anything else the message carries.
- **The guide** is `docs/RECIPE-COCKPIT-GUIDE.md`, with the help's four headings in the same order and one screenshot under each, in `docs/images/recipe-cockpit/`. `docs/` is already left out of the `.vsix`.
- **Screenshots** come from `developmentSupportScripts/recipe-cockpit-screenshots/captureRecipeCockpitScreenshots.js`, which renders the real shell with a model built from the test fixture workspace in headless Chromium at a fixed viewport. A picture is written only when its bytes change, so a second run on unchanged code leaves git clean. It uses a Playwright already installed outside the project, adds no dependency and never downloads a browser.
- **`/cockpit-help-sync`** (`.claude/skills/cockpit-help-sync/SKILL.md`) reads the cockpit changes since the guide last changed, updates the help text and the guide together in plain words, re-takes the screenshots and reports what changed and why.
- **The place.** Whether the section is open is saved as an optional `isHelpExpanded`, so the place version did not change and an older place reads as collapsed.
- **From review:**
  - The summary no longer counts an excluded object's unticked fields or stored count, which generation does not apply.
  - A faker bound on a rule-driven field is counted once, as the bound, not also as a field without its rules.
  - The backend note now says snowfakery does not apply a validation rule's REGEX pattern.
  - The help no longer suggests comparing in the cockpit, whose Compare tab was removed in #266.
- **Tests.** `RecipeCockpitHelp.test.ts` runs the real panel script: the toggle, the four parts, the empty state, the summary for every kind of difference, its redraws, a hostile name, the place both ways, the router and the host opening the url. It also holds the guide to the help: same headings in the same order, a picture under each, every picture in `docs/images/recipe-cockpit/` and at most 200 KB.

## [3.91.0] - The Recipe Cockpit shows its version and links to this CHANGELOG

Closes [#333](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/333).

Nothing in the Recipe Cockpit said which Treecipe version was running, and the panel had no way to reach what changed between releases. The title row now shows `v<version>` at the top right, with a GitHub icon that opens this file on `main`.

- **Always on screen.** The version and the icon sit in the title row, outside the area each load redraws. They stay through a load, the no-run screen (beside **Generate Treecipe**), a drawn run, and a failure to draw. The run selector, Favorites only and each card's search box are where they were.
- **The version is the extension's.** `activate` reads `context.extension.packageJSON.version` once (`RecipeCockpitService.setExtensionVersion`). Only a value matching `RECIPE_COCKPIT_EXTENSION_VERSION_PATTERN` (`3.91.0`, or one with a pre-release suffix) is kept. It reaches the panel in its own `extensionInfo` message, replayed first on every `ready`, so the recipe model is unchanged. The panel writes it with `textContent`. With no valid version, nothing is posted and only the icon shows.
- **The link opens one fixed address.** The icon posts `openChangelog` with nothing else. The router routes it even before a model is drawn and reads nothing from the message, so a forged `url` opens nothing else. The host hands `RECIPE_COCKPIT_CHANGELOG_URL` to `vscode.env.openExternal`. A browser that refuses it, or a throw, is one fixed warning that quotes no error. The URL is never in the shell: its `default-src 'none'` would make a link there dead, and the shell still references no external asset. `buildWebviewShellHtml` still takes only a nonce.
- **The icon** is the GitHub mark drawn as inline SVG with `createElementNS`, filled with `--sdt-muted` and with `--sdt-accent` on hover or keyboard focus, like the cockpit's other glyphs. It is a `<button>` labelled `Open CHANGELOG on GitHub` (`aria-label` and `title`), so it works from the keyboard. Its colours on the page are added to the contrast test.
- **Tests.** A new suite, `RecipeCockpitExtensionVersion.test.ts`, covers the version check, the replay order, the router (before any model, and with a forged payload), the browser call and both warnings, the shell, and the real panel script through the harness: the icon and its attributes, the click's one message, the version on all three screens, and a version carrying markup written as text. `extension.test.ts` checks `activate` hands the manifest version over.

## [3.90.0] - Recipe Cockpit: a validation-rule checkbox at the end of a field row

Closes [#325](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/325), the third sub-issue of [#322](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/322).

#324 writes validation-rule constraints into a recipe, but the cockpit could not show which fields a rule shaped, or switch a rule off for one generation. Each field a rule shaped now has a checkbox at the end of its row.

- **What is drawn.** A field whose objects-wrapper entry has at least one applied `validationRuleConstraints` gets a `role="checkbox"` button with `aria-checked`, labelled "rules". It is checked on a newly generated tree, and its title names the rules. Unticked, the row shows the expression the field generated before the rules. A field whose rules were all not applied gets no checkbox, only a muted "rule not applied: …" note naming them, with each reason in its title. A field no rule names, and every field of a wrapper with no rules, draws exactly as before, and the model posts no new property for it. One box covers every rule on the field. The ungrouped card, which has no folder to keep a choice by, draws no box.
- **What is kept.** Unticking posts `setFieldValidationRuleApplied {treeKey, objectApiName, nickname?, fieldApiName, applied}`. It is matched against `selectableFieldKeys` and refused for a field with no applied rule, or one generation leaves out or fixes: object excluded, field unticked, parent excluded, or a fixed value set. The host stores only the unticks, beside #323's constraints, as `validationRulesOffByFolderName`. The stored selection moves to version 6. A version 1–5 entry reads as every rule applied.
- **A validation rule overwrites a hand edit, with confirmation.** Ticking the box on a field with a #323 constraint opens a host modal, "Replace your constraints with the validation rule's?". **Replace** removes the constraint; Cancel changes nothing. Editing a ticked field with ✎ asks "Replace the validation rule's constraints with your own?" first; confirming opens the bound boxes and unticks the box. A field constrained before this release draws its box unticked, because its constraint already replaces what the rules wrote. Nothing changes for that field until the reader ticks it.
- **What is generated.** Unticked, the filtered copy writes the wrapper's `unconstrainedRecipeValue` in place of the rule-written lines, the `### Driven by ValidationRule` comment included, on every kept occurrence at its depth. A fixed value or a #323 constraint on the same field wins. `RecipeCockpitRecipeWriter.buildFilteredRecipe` takes `unconstrainedValuesByObject`. It swaps only an occurrence that still holds exactly what the rules wrote, and refuses the copy otherwise (for example after a hand edit) rather than guess. A field whose rules did not change its value (an `ISBLANK` rule) has nothing to swap, so a card with only such a field unticked generates its recipe exactly as before. The copy's header and the tree insert's modal name the fields generated without their rules. `datasetSource.json` records them as `validationRulesOffByObject`. The recipe file is never written.
- **Reset selection** ticks every box again.
- **From review:**
  - `buildTreeValidationRulesOff` returns at once when nothing is switched off. It also tests whether a field is switched off before anything else, so a card with no unticks no longer scans each field for duplicates on every model post.
  - Confirming ✎'s replace prompt and then leaving both bounds empty keeps the box ticked: an empty edit keeps the rules.
- **Tests.** A new fixture workspace (`validationRuleWorkspace/`) holds the real pipeline's output over #324's `Gadget__c`, one run per backend. The writer, the wrapper read, the storage versions, the lock rule, the router, the host modals both ways, Reset and the panel are tested. The panel tests run the real panel script: checked by default, untick, the drawn answer and the disabled states. Each state of the box is generated with both backends: faker-js through the real `FakerJSRecipeProcessor`, snowfakery through PyYAML, Jinja and the real Faker. Ticked, every value stays inside the rules. Unticked, a value the rules forbid turns up, while the fields still ticked keep to theirs.

## [3.89.0] - Generate Treecipe applies the constraints validation rules imply

Closes [#324](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/324), the second sub-issue of [#322](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/322), and revives [#41](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/41).

Recipes ignored validation rules, so a generated record could fail its insert on one. #41 read the rules but only wrote comments, and was closed without merging. Generate Treecipe (from the palette and from the cockpit) now writes faker expressions that satisfy the single-field rules it recognizes, and reports every rule it did not apply.

- **A minor version.** `IRecipeFakerService` gained `buildRegexExpression(regexAtoms)`. Both backends implement it. Nothing outside the extension implements that interface. A workspace with no `validationRules/` folder generates exactly what 3.87.0 generated.
- **Read during the walk that already reads each object.** `DirectoryProcessor` reads `<object>/validationRules/*.validationRule-meta.xml` from the object directory's existing listing. It sorts the files by name with `<`, so the recipe does not depend on the order the file system lists them. Only `<active>true</active>` rules are applied. A file that does not parse, is not a `ValidationRule`, or cannot be read is a rule that was not applied, never a failure of the walk.
- **The shapes #41 recognized.** `ValidationRuleAnalyzerService` (ported into its own folder, with #41's rule files as test mocks) reads a formula as TRUE-when-invalid:
  - `NOT(REGEX(f, "…"))`: the value must match the pattern.
  - `f < N`, `f <= N`, `f > N`, `f >= N`: a numeric minimum or maximum.
  - `ISPICKVAL(f, "…")`: the value is dropped from the picklist's choices.
  - `ISBLANK(f)`: the field must have a value.
  - `LEN(f)` against a number: a length minimum or maximum.
  - `f` against `TODAY()` or `DATE(y, m, d)`: an earliest or latest date, for a Date field.
  
  `AND`/`OR`, two fields, a cross-object reference and anything else are not applied, never partly applied. Every field reference must be an api name (`SalesforceApiName`). A rule naming a field the walk did not read from the object's `fields/` folder is not applied, and so is one naming a standard-field mapping.
- **Workspace text is parsed, never copied.** Numbers are written back from their parsed digits. A bound the formula excludes (`<=`, `>=`) moves one step of the field's scale inward, done in whole units with `BigInt`, so `Amount__c >= 50000` on a scale-2 field becomes a maximum of `49999.99`. Dates are checked as calendar dates and shifted by a day for `<=` and `>=`. Formula string literals have their backslash escapes read.
- **Regex.** A pattern is translated into a sequence of atoms: a literal, a character class, `.`, `\d`, `\w` or `\s`, each with an optional quantifier. A value made of one draw per atom always matches, because Salesforce's `REGEX` matches the whole value. Groups, alternation, back-references, lookarounds, nested or intersected classes, possessive quantifiers, non-ASCII characters, and any pattern holding a template opener (`${{`, `${%`, `${`, `{{`, `{%`, `<<`, `<%`) or a line break either YAML parser sees are refused. faker-js writes a class of letters, digits and `_` through `faker.helpers.fromRegExp`, writes literals as JS strings through the picklist escaper, and draws any other set with `faker.string.fromCharacters`, because `fromRegExp` skips most punctuation inside a class. snowfakery has no regex generator, so a regex rule is reported not applied there. A regex applies to Text, TextArea, LongTextArea and Phone fields.
- **Several rules on one field are intersected.** Bounds of the field's kind are reduced to the tightest minimum and the tightest maximum, then resolved by `RecipeFieldConstraint`, the same rule the cockpit's ✎ uses (#323). If the result is empty (minimum above maximum), none of them are applied, and each one says so. A bound the field cannot hold on its own, such as more digits than its precision, is refused for that rule only. Several `ISPICKVAL` rules drop their values together, unless that would leave no value. Several regex rules on one field, or a regex together with a bound, cannot be combined.
- **What is written.** The backend's `buildConstrainedExpression` (#323) or `buildRegexExpression`, checked like a cockpit constraint, is written double-quoted. A line `### Driven by ValidationRule "<name>", …` is written under it, with each rule name escaped through `escapeForComment`. `ISPICKVAL` rebuilds the picklist through the backend's own builder, so every remaining value still goes through its escaper. It also narrows a dependent picklist's choices (a choice left empty is dropped), a selected record type's values, and each record type's commented variant, on a copy of the object's record type wrappers. Every rule not applied is one `### TODO -- VALIDATION RULE NOT APPLIED -- "<name>" -- <reason>` line at the end of the object's first block, escaped the same way.
- **The objects wrapper.** A field a rule names records `validationRuleConstraints`: each rule's name, type, value, whether it was applied, and why not. It also records `unconstrainedRecipeValue`, so the cockpit can switch back. An object records `ValidationRulesNotApplied` for rules that match no shape or name no field the walk read. A field or object with no rules carries none of these, so older runs read unchanged.
- **Tests.** The analyzer, the intersection and rounding rules, and each backend's `buildRegexExpression` (200 values per pattern checked against it) are unit tested. A new fixture (`ValidationRuleSalesforceMetadataDirectory`) goes through the real pipeline with each backend. `generatedRecipeYaml` loads every recipe it writes in js-yaml and PyYAML. A generation test runs 300 records per backend and checks every applied rule holds: faker-js through the real `FakerJSRecipeProcessor`, snowfakery through PyYAML, Jinja and the real Faker. A hostile-input test runs every `HostilePicklistValues` payload through every formula shape, and through the rule name, in both backends. Every file must load alike in both parsers with no undeclared field, faker-js must evaluate nothing a rule carries, and every applied regex must match what it generates.
- **Open question left as it was:** there is no `treecipe.config.json` switch to turn this off yet.
- **From review:**
  - A regex pattern's trailing `$` is now told from an escaped `\$` by counting backslashes backwards. The old check took quadratic time on a long run of backslashes: 32.8 s on a crafted pattern, now 4 ms. A formula longer than Salesforce's 3,900-character limit is reported not applied before any shape is matched.
  - A regex is held to the field's length. A `<length>` is used where the field has one, Phone fields use 40, and other fields use the type's default. Each part's open repeats are cut to fit, in pattern order, so every value still matches the pattern and fits the field. A pattern whose shortest match is too long is not applied.
  - A record type section that `ISPICKVAL` leaves empty is dropped, so no commented variant chooses from an empty list.

## [3.88.0] - Record types become a section of the Treecipe tab

Closes [#321](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/321).

Choosing record types meant leaving the tree for its own tab, then switching back to see the fields they change. The Record types tab is now a collapsible section at the top of the Treecipe tab, right above the tree's first object.

- **Where it sits.** On a card listing an object with two or more record types, the Treecipe tab draws the org picker, its actions, the search box, then the **Record types** section, then the objects. A card with no such object draws no section. A card's tabs are now Treecipe and Previously Used Data Sets.
- **Collapsed by default.** The section is one header line, for example "Record types · 1 object · generated by default". It says "changed" once a choice differs from the run on screen, and "generated from a choice" when the run was written from one. The ▸ names the header's state text with `aria-describedby` and its rows with `aria-controls`, so a screen reader announces it. A click anywhere on the header expands it; like a tree card, the ▸ has no listener of its own and exposes `aria-expanded`. Its rows are built the first time it opens.
- **What it holds is unchanged:** the intro, each object's record types with their checkbox, `inactive` label and the fields they restrict, **Remember this selection**, **Regenerate with these record types** and **Use defaults**. The messages, the allow-lists and what is saved to `treecipe.config.json` are unchanged.
- **One search box.** The section's own search is gone. The Treecipe tab's search also narrows the section's rows by object, record type and restricted field, and the header says how many objects match. The tree's objects are still never hidden by a search.
- **Focus.** A regenerate reload and **Change record types** (#196) open the card on the Treecipe tab with the section expanded, and **Change record types** scrolls to the object it names. That scroll is not undone by the scroll offset a same-run reload restores, and a restored Treecipe search that would hide the object is cleared. A `focusTree` now carries `recordTypes: { objectApiName? }` instead of naming a tab.
- **Saved places.** An expanded section is saved as the optional `isRecordTypesExpanded`, so the place version is unchanged and an older place reads as collapsed. A place saved on the Record types tab opens on Treecipe with the section expanded, and its Record types search is dropped rather than moved into the Treecipe search. `recordTypes` joins `RECIPE_COCKPIT_REMOVED_TREE_TABS`, and `RECIPE_COCKPIT_OPTIONAL_PLACE_SEARCH_TABS` is gone with the tab that needed it.
- **No new colours.** The section uses the existing border, text and muted tokens.
- **Keystroke cost.** Each card builds its list of record-type objects once per model, and each object's search text is computed once, so a Treecipe search keystroke or a tick does not rebuild either.

## [3.87.0] - Edit a field's faker constraints in the Recipe Cockpit

Closes [#323](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/323), the first sub-issue of [#322](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/322).

The cockpit showed each field's faker expression but had no way to narrow it short of editing the recipe by hand, which the next Generate Treecipe overwrites. Each Treecipe field row now has a ✎ on its faker expression that sets the range the field generates in. The recipe file is never written.

- **A minor version, because the Recipe Cockpit is still behind `recipeCockpitEnabled`.** `IRecipeFakerService` gained `buildConstrainedExpression(fieldType, constraint)`, and both backends implement it. Nothing outside the extension implements that interface, so no user-facing behaviour changes without the flag.
- **What can be constrained.** Number, Currency and Percent get a minimum and maximum. Text, TextArea and LongTextArea get a minimum and maximum length. Date and DateTime get an earliest and latest date, as `YYYY-MM-DD` (for a DateTime also a UTC time such as `2026-01-31T09:30:00Z`), as `today`, or as days from the run, such as `-30d` or `+90d`. A relative date is measured when the recipe runs, not when it was set.
- **What cannot.** Everything the #262 pin refuses (lookups, `RecordTypeId`, dependent picklists, #220-locked fields, unticked fields, fields of an excluded object), plus a field with a fixed value, a standard-field mapping (`read from the recipe file`, which has no metadata to check a bound against), and every other type. Email, Phone and Url are refused on purpose: a random string of the chosen length is not a valid email address or URL, and the insert would reject it. A disabled ✎ says why in its title.
- **The host asks; the panel posts names only.** A click posts `editFieldConstraints {treeKey, objectApiName, nickname?, fieldApiName}`, matched against `selectableFieldKeys` like the checkbox and the pin. The host asks for each bound in its own `showInputBox`, lower bound first, with the field's name escaped through `escapeForNotification`. Each box checks what is typed. A bound past the field's precision and scale, a length past its `<length>`, a value that is not a number or not a date, or a lower bound above the upper one is refused, with the reason shown in the box. A decimal range whose two bounds are equal is refused too and points to a fixed value. An empty bound keeps its default, two empty bounds clear the constraint, and Escape in either box changes nothing. The router and the executor both re-derive the lock before anything is written, and the executor checks the bounds again after the second box closes.
- **Defaults never cross a typed bound.** A number's empty minimum is 0 (or the negative ceiling under a negative maximum), and its empty maximum is the precision ceiling. A field with no recorded precision uses the recipe's own 999999. A length's empty minimum is 1, and its empty maximum is the field's length. A date's empty bounds are a year ending today, moved so they stay on the right side of the typed bound.
- **The row.** A constrained field shows the expression its recipe's own backend builds, through `textContent`, in place of its faker expression. A `constrained` badge appears beside the field name, and the ✎ is filled and `aria-pressed`, with a title naming the bounds. The glyph is a pencil built with `createElementNS` and stroked from the palette, like the chain link and the pin. **Reset selection** shows while a card has a constraint, and clears the folder's constraints.
- **Expressions.** faker-js: `faker.number.int({min, max})`, `faker.finance.amount({min, max, dec})`, `faker.string.alpha({ length: { min, max } })`, `faker.date.between({from, to})`. snowfakery: `fake.random_int(min, max)`, `fake.pydecimal(min_value, max_value, right_digits)`, `fake.pystr(min_chars, max_chars)`, `fake.date_between` / `fake.date_time_between` with relative strings or snowfakery's `date()`/`datetime()`. These are the same `fake.` provider calls the generated recipes already use, checked against snowfakery 4.2.1. The faker-js braces are spaced, because the processor ends an expression at the first `}}`.
- **Storage.** Constraints are kept beside the #219/#220/#255/#262 selection as `constraintsByFolderName`, by tree folder, object, then field, with each bound as typed. `RECIPE_COCKPIT_OBJECT_SELECTION_VERSION` is now 5, and a version 1–4 entry reads as no constraints. Names are checked with `SalesforceApiName` and written with `Object.fromEntries`, so a `__proto__` name is a key. A bound that no field type could take is dropped on read. A stored constraint the field no longer takes (its length or precision shrank, or a relative and a fixed date crossed) is held back, still stored, and comes back once valid.
- **Generation.** `RecipeCockpitRecipeWriter.buildFilteredRecipe` takes `constrainedExpressionsByObject` and replaces the field's line, double-quoted, on every kept occurrence at that occurrence's depth, dropping continuation lines. It then reads the result back. The writer holds each expression to one `${{ … }}` with no line break, control character, second template delimiter or inner `}}` (`checkConstrainedExpression`). A fixed value on the same field wins. **Generate fake data** and **Generate fake data and insert** both run the copy. The insert modal lists the constraints, and `datasetSource.json` records `constraintsByObject` (the bounds as typed) only when there are any.
- **Tests.** A new `RecipeFieldConstraint` module (no imports) holds the rule both backends and the host share. A contract test holds both backends to the same constraint types. A generation test runs every constraint kind through the filtered copy 250 times per backend and checks that every value is inside its bounds: faker-js through the real `FakerJSRecipeProcessor`, snowfakery read with PyYAML and rendered with Jinja and the real Faker. CI now installs `Faker==37.1.0` (and `tzdata`) beside PyYAML and Jinja2 for that check, which, like the others, fails in CI rather than skipping.
- **From review:**
  - A maximum of `0` alone now reaches down to the field's negative ceiling instead of being refused as a zero-width range.
  - `today` as the earliest date now defaults the latest to a year later. Before, the default range was zero-width.
  - A Date field compares and generates its bounds by UTC day, so `today` and today's date are the same day. faker-js no longer gets a `from` later than its `to`.
  - A precision, scale or length outside what Salesforce allows (precision 1–18, scale up to the precision, length 1–131072), read from a hand-edited objects wrapper, is refused instead of built from.
- **Unchanged:** every recipe file, and every card with no constraint, which generates exactly as before.

## [3.86.0] - Save a record type selection in treecipe.config.json

Closes [#196](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/196), slice D of [#192](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/192).

3.85.0 let you choose record types in the Recipe Cockpit, but only for the regenerate you clicked. The next Generate Treecipe wrote every object's default record type again. A choice can now be saved, and Generate Treecipe reuses it.

- **Fitted to #195's decision.** The issue was written for a selection panel that Generate Treecipe opened, and for a cockpit **Regenerate recipe** button that #263 has since removed. Choosing still happens only in the cockpit's **Record types** tab, and Generate Treecipe still asks nothing. Where the issue says "reopens the panel", Treecipe shows a notification whose **Change record types** button opens that tab.
- **Remember this selection.** The Record types tab has a checkbox, unticked by default and again with every new model. With it ticked, **Regenerate with these record types** writes `recordTypeSelections` (object api name → developer names, in order) to `treecipe.config.json` before regenerating. It also writes `recordTypesWhenSelectionSaved`, which records every record type each of those objects had then. Other keys in the file are kept. **Use defaults** with the box ticked removes both keys. If the save fails, you get a warning, and the regenerate still runs with the choice for that run only. The panel posts `isRemembered: true` and nothing else. The host takes the record types it records from the model on screen, never from the message.
- **Generate Treecipe uses a saved choice without asking.** That applies to the palette command and to the cockpit's no-run **Generate Treecipe** button. When at least one saved entry was written, the completion notification adds "It used the record types saved in treecipe.config.json." and a **Change record types** button. A run where every saved entry was dropped as stale does not claim that, on its first run or any later run in the session. A selection passed to the command still wins, including the Record types tab's and the empty one from **Use defaults**. With nothing saved, every recipe file and notification is exactly as in 3.85.0.
- **Stale entries are dropped whole.** A saved entry naming a record type its object no longer has is dropped for that object, which is then written as with no selection. That means no `RECORD TYPE SELECTION IGNORED` TODO, since nobody chose that run's names. A saved object the metadata no longer has is dropped too. Both are named in one warning.
- **New record types are named, not guessed at.** If an object has a record type added since the choice was saved, the saved choice is still generated, and the warning names the new record type. Its **Change record types** button opens the cockpit on the newest run, at the Record types tab of the first card that lists that object, with the tab's search set to the object's name.
- **One check, during the walk that already loads record types.** `SavedRecordTypeSelection` (new, in `RecordTypeSelectionService/`) extends `RecordTypeSelection` and overrides the new instance method `resolve`. It drops a stale entry and records what it saw while `DirectoryProcessor` resolves each object, so nothing reads the metadata twice. `DirectoryProcessor` is unchanged.
- **The config file is hand-edited, so every entry is type-checked.** `ConfigurationService.readSavedRecordTypeSelection` keeps an entry only if its object key and every developer name is an api name and its list is non-empty. Any other entry is ignored with a warning and never thrown, and the rest still applies. Every name in a warning goes through `RecipeYamlScalar.escapeForNotification`, and each distinct warning is shown once per session.
- **The open is safe by id.** `treecipe.openRecipeCockpit` now takes `{ focusRecordTypes: true, objectApiName? }`. Any other shape opens as before, and an object name that is not an api name is dropped. Like a saved place, the focus is posted with every replay until the panel says the model is drawn, so the panel's first `ready` does not lose it.
- **Unchanged:** both faker backends, every recipe file with no saved choice, and the Record types tab without the checkbox ticked.

## [3.85.0] - Choose record types in the Recipe Cockpit

Closes [#195](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/195), slice C of [#192](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/192).

3.83.0 and 3.84.0 let Generate Treecipe write recipes for chosen record types, but nothing let a reader choose them. A tree card in the Recipe Cockpit now has a **Record types** tab that does.

- **Decided on #195: the choice lives in the Recipe Cockpit, not in Generate Treecipe.** The issue asked whether the selection panel should be standalone or a mode of the cockpit; it is a cockpit tab, so it is behind `recipeCockpitEnabled` like the rest of the cockpit. Generate Treecipe from the command palette is unchanged: it asks nothing and writes every object's default record type, byte for byte as before. There is no quick-pick fallback.
- **The tab.** A card draws it only when it lists an object with two or more record types (by valid developer name). For each such object it lists every record type, marks an inactive one `inactive` in words, and shows what the record type restricts: each picklist, multi-select picklist and dependent picklist field its section lists, with how many values it allows. Only those counts are posted to the panel, never the values. The tab has its own search over objects, record types and those fields.
- **What is ticked.** The cockpit reads the run's recipe files: each block's `RecordTypeId` line says which record types the run writes, in block order, and a default block's `### TODO: -- RecordType Options` line says the run was written as the default rather than from a choice. An object whose recipe names none of its record types shows the default ticked (the first active one, as generation picks). An object keeps at least one record type ticked, and record types are written in the order they were ticked.
- **Regenerate with these record types** runs `treecipe.generateTreecipe` with `{ recordTypeSelection, isCompletionNotificationSuppressed: true }` and reloads the new run onto the same card's Record types tab. It sends every object the reader changed and every object the run on screen was already generated from a choice for, so regenerating for one object does not put another back to its default; an object left at its default is not sent. **Use defaults** regenerates with no selection at all. Both write a new run of every tree; the run on screen is kept. Both share Generate Treecipe's in-flight flag, so neither starts while a generation runs or reloads, and the run is reloaded even when generation fails, which gives the buttons back. Neither runs while a tree insert runs: a reload clears the org selection, which would cancel an insert the reader already confirmed. The panel holds both buttons while an insert runs, and a regenerate the host refuses for any reason is answered with `recordTypeRegenerateState`, which gives the tab back.
- **Security.** The panel posts names only: `regenerateWithRecordTypes {treeKey, recordTypeSelection}`. The host matches every object and record type pair against `selectableRecordTypeKeys`, and the card against `recordTypeTreeKeys`, both pending until the panel's `rendered` and emptied on `ready`, like every cockpit allow-list. A name the model did not offer, a repeat, an empty list or anything not a list refuses the whole request rather than trimming it. Every value is drawn with `textContent`.
- **Performance.** Which record types each block writes is read in the scan `parseRecipeSource` already makes of every recipe at load (`collectRecordTypeBlocks`), not in a second split and scan.
- **Saved place.** The tab can be the one a card reopens on. Its search is kept in the saved place only when one was typed, so a place saved before this version, or one that never used the tab, keeps its shape and the place version is unchanged.
- **Next:** #196 saves a choice in `treecipe.config.json` so a later generation reuses it without the cockpit.

## [3.84.0] - One recipe block per selected record type

Closes [#194](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/194), slice B of [#192](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/192).

3.83.0 generated an object for the first record type selected and ignored the rest. One Run Faker by Recipe can now produce records for several record types of the same object, for example `Account` Customer *and* Partner.

- **One block per record type, in selection order.** Each selected record type is its own `- object:` block, with its own nickname (`Account_Customer_NickName`, `Account_Partner_NickName`), its own `RecordTypeId` and that record type's picklist expressions (per #193). Every block uses the object's existing `count`. A record type named `child`, whose nickname would collide with the self-lookup iteration's `<Object>_child_NickName`, is nicknamed `<Object>_child_RecordType_NickName`, with `_RecordType` added again if another selected record type already holds that nickname.
- **faker-js nests a child under the parent's first block only.** A child is a friend of the first selected record type's block and is wired to it. The other blocks of the parent carry no friends, so a parent with several record types does not multiply its children's records. A child that is itself several blocks writes all of them under that one parent block, each wired to it. A lookup to a non-ancestor parent with several blocks is wired to the first block, as #189 wires it to the parent's nickname. `FakerJSRecipeProcessor` and the insert's whole-string nickname swap are unchanged.
- **Fixed: two friends of one object type under one parent shared a nickname.** `FakerJSRecipeProcessor` named every friend's records `<Object>_<parent nickname>`, so two record type blocks of a nested child under the same parent record got the same nickname and the same `referenceId`, and a reference to the second block resolved to the first block's record. Friends that share an object type with a sibling now carry their own YAML nickname (`Contact_Seller_NickName_Account_NickName`); a lone friend keeps the name it always had. A hand-written recipe with two friends of one object type is fixed by the same change.
- **snowfakery stays flat, and names the blocks.** A lookup left as `### TODO -- REFERENCE ID REQUIRED` to a parent written as several blocks gets one comment line under it: `### TODO -- RECORD TYPE BLOCKS -- AccountId can reference any record type block of Account: Account_Customer_NickName, Account_Partner_NickName`. The lookup's own line is unchanged, so the Recipe Cockpit's lookup wiring (#151) still recognises it, and a self-lookup never lists the block it is written in. faker-js writes the same line under any lookup it leaves as a TODO.
- **Every record still names exactly one record type.** Each block's `RecordTypeId` is one `Object.DeveloperName`, which the insert swaps for its org Id per record. A test runs generation, Run Faker, the record type swap and the lookup swap end to end.
- **The Recipe Cockpit reads each block.** The blocks' nicknames are distinct, so `parseRecipeSource` keeps a later block as an occurrence of its own, as it does a self-lookup iteration.
- **What the objects wrapper records.** `Fields` and the relationships are still built from the first block. The later blocks are in the new `ObjectInfo.AdditionalRecordTypeRecipes`, which is set only when there are several. An object whose fields are walked twice gets them appended to every block alike.
- **Unchanged:** with no selection, or one record type per object, every recipe file is byte-identical to 3.83.0 in both backends.

## [3.83.0] - Generate recipes for a chosen record type

Closes [#193](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/193), slice A of [#192](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/192).

Generation always used an object's first active record type and wrote every other one, and every picklist value tied to one, as a commented `### TODO`. Getting data for another record type meant editing `RecordTypeId` and every record-type picklist by hand. Generation can now be given a record type per object and writes the object's block for that record type. No UI asks for it yet; the selection panel (#195) and saving the choice (#196) build on this.

- **A typed selection, threaded through generation.** `RecordTypeSelection` (in `RecordTypeService/`) maps an object api name to developer names in the order chosen. `ExtensionCommandService.generateRecipeFromConfigurationDetail` reads it from the command option `{ recordTypeSelection: { <Object>: [<DeveloperName>, …] } }`, type-checking it because the command can be run by id, and passes it through `DirectoryProcessor.processAllObjectsAndRelationships` to `RecipeService`.
- **The selected record type's block.** `RecordTypeId` is `Obj.<Selected>`, with no `### TODO: -- RecordType Options` block and no commented alternatives. A picklist or multi-select picklist the record type lists is one live expression over that record type's values, with no `# ${{ … }}` variants. That includes a picklist backed by a standard or global value set, and a multi-select picklist that used to get the placeholder. A dependent picklist keeps only the controlling values the record type allows, and under each only the dependent values it allows. A choice left empty is dropped, and if none is left the field is one `### TODO` comment, which loads as `null`. A field the record type does not list (a Checkbox controller never is) is not restricted.
- **Both backends, through their own escapers.** `RecipeService` narrows the values and hands the backend no record type map, so faker-js and snowfakery write exactly what they write for a field with no record types, and every value still goes through the backend's escaper. The hostile picklist suites run again with a record type selected: the shared sinks (`buildRecipeWithEveryPicklistSinkForSelectedRecordType`) and the real pipeline over the hostile fixture, each loaded with js-yaml and PyYAML, run through Run Faker with faker-js and rendered with snowfakery's Jinja.
- **A name that cannot be used is named, not guessed at.** A selected developer name the object does not have, or one refused by `partitionRecordTypesByWritableDeveloperName`, is ignored for that object, and the object keeps today's default. One `### TODO -- RECORD TYPE SELECTION IGNORED` line names it, escaped with `RecipeYamlScalar.escapeForComment`. Only the first usable name of an object is generated until #194 writes one block per record type; any later one gets the same kind of TODO.
- **Fixed: a snowfakery multi-select picklist with one value.** `elements=('x')` is a string in Jinja, not a tuple, so `random_sample` picked characters of the value. One value is now written as `('x',)` (`SnowfakeryRecipeFakerService.buildRandomSampleElementsTuple`), and two or more are written as before. Narrowing to a record type makes a single allowed value common, which is how this surfaced.
- **Unchanged:** with no selection, an empty one, or one naming no object in the metadata, every recipe file is byte-identical to before in both backends.

## [3.82.3] - salesforceObjectsPath must stay inside the workspace

Closes [#117](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/117).

`salesforceObjectsPath` in `treecipe/treecipe.config.json` was cut at its first `./` and glued onto the workspace folder, so `"./../../.ssh"` walked out of the workspace, a value with no `./` walked `<workspace>/undefined`, and `"./a/./b"` was cut to `a/`. The config file arrives with a cloned repository.

- **One resolver, every command.** `ConfigurationService.resolveObjectsDirectoryPath` resolves the value with `path.resolve` against the workspace folder and holds it to `SfdxProjectService.isPathContainedInWorkspace` (the lexical and the realpath check, so a link inside the workspace pointing outside it is refused too). Generate Treecipe, Generate Picklist Dependency Tests, Update Picklist Dependency Metadata from Specs, Open Picklist Dependency Explorer and the Recipe Cockpit's "Generate permission set…" all use it.
- **Refused before anything is read.** A path outside the workspace, an absolute path (`/…`, `C:\…`, `\\server\…`, even one that lands inside the workspace, since the config writer only writes relative paths and an absolute one names one machine) or a value that is not a path stops the command with an error naming the configured value, for example *"salesforceObjectsPath" in treecipe.config.json is "./../../.ssh", which is outside this workspace.* No global value set is read, no directory is walked and no recipe is written.
- **Global value sets are read from inside the workspace too.** `globalValueSets/` is looked for beside the objects directory, found by `ConfigurationService.resolveSalesforceMetadataParentPath` with `path.dirname`. The old helper only split on `/`, so with the resolved Windows path it found no parent and read `<drive>:\globalValueSets\` instead. An objects directory that is the workspace folder itself (`"./"`) used to send that read to the folder above the workspace; it now reads `<workspace>/globalValueSets/`. The `/`-only `VSCodeWorkspaceService.getParentPath` is removed.
- **Now works:** a value with no `./` prefix (`"force-app/main/default/objects"`), and backslash paths written by hand.
- **Unchanged:** `"./force-app/main/default/objects/"`, with or without the trailing slash, resolves to the same folder as before.

## [3.82.2] - The extension icon is a PNG, so a release can publish again

The release build failed at `vsce publish` with "The provided icon is not a supported image format": `package.json` named `images/datatreecipe.webp` as the icon, and the Marketplace rejects a WebP icon at publish (`vsce package` still builds with it, so only the release job showed the failure). While it failed, no new version reached the Marketplace, so an installed extension kept showing behavior removed since, such as the Recipe Cockpit's metadata deploy messages (#302).

- **The icon is `images/datatreecipe.png`**, 256 x 256, drawn from the same artwork. The WebP file is removed.
- **Unchanged:** every command and the extension's code.

## [3.82.1] - One implementation of the custom relationship mapping lookup

Closes [#116](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/116).

`RelationshipService` held the custom → OOTB lookup merge twice: `resolveParentReferenceForField`, which `DirectoryProcessor` calls for every lookup it cannot resolve on its own, and `getMergedReferenceLookupMap`, which nothing outside its own eight tests called. The two could drift apart, and those tests guarded code that never ran during recipe generation.

- **Decision: delete the merged map.** Nothing used it, so `resolveParentReferenceForField` stays as the only implementation. Wiring the merged map in would have made one per-field lookup step through every mapping unless the map were built once per walk, and that adds work for a view no feature reads. If a diagnostic view of the effective lookup map is ever wanted, it can be built from the resolver.
- **No coverage lost.** The merged map's cases now run against the resolver: OOTB fallback with no, `undefined` or empty mappings; several custom mappings each resolving to their own parent; a bare `AccountId` custom key that cannot override the OOTB entry; a `CustomObject__c.AccountId` key that wins for that object only; malformed keys (no object, no field, more than one dot) skipped while valid mappings beside them still resolve; and an empty parent value skipped in favor of the OOTB fallback.
- **Unreachable code removed.** The merged map's OOTB-override guard could never fire (a valid custom key always has a dot and an OOTB key never does). `getOotbReferenceLookupMap` looked like it cached but built its map again on every call, and is now one frozen static map. `isValidCustomRelationshipKey`'s empty or non-string key check is gone too, since its only caller always passes `Object.Field`.
- **A field named like an `Object.prototype` member no longer resolves to it.** The OOTB fallback used to read the map with a plain index, so a lookup field named `constructor` resolved to a function. It now checks for an own key and resolves to nothing.
- **A custom mapping whose parent is not a string is skipped.** `treecipe.config.json` is hand-edited and its values were never type-checked, so `"Obj.Field": 42` came back from a method typed `string | undefined`. It now falls back to the OOTB map like an empty value does. The object-name guard downstream already refused such a value, so no recipe changes.
- **Unchanged:** a custom key still resolves, the OOTB fallback still applies, an invalid key is still skipped, a field with no mapping still resolves to `undefined`, and the #113 tests that follow a custom mapping through to the relationship trees and recipe files pass without changes.

## [3.82.0] - Recipe Cockpit: rename and favorite a previously used data set

A tree card could be named and starred (#235), but its **Previously Used Data Sets** rows could only be told apart by a timestamped folder name. Each row now gets the same two controls.

- **☆ marks a data set a favorite, ✎ gives it a name.** The name is drawn in bold beside the date, and the folder name stays on the row. Leave the box empty to go back to the folder name. The folder itself is never renamed.
- **The name is asked for by the host**, in its own input box, as a tree's is. It must be one line, at most 80 characters, and unique (trimmed, ignoring case) against every other data set's name in the workspace and every other row's folder name on screen. It is checked as it is typed and again when the box closes. The folder name in the prompt is escaped like a notification.
- **Kept in `workspaceState` by data set FOLDER NAME** (`treecipe.recipeCockpit.datasetPreferences`), separate from the trees' names. A folder name is unique under `FakeDataSets/`, so a data set keeps its name and star on every card that lists it, across reloads, run switches and window reloads. Each stored entry is checked when read, and a folder named `__proto__` keeps its name.
- **Favorites only, per card.** The data sets tab has a **☆ Favorites only** toggle beside its search. It works together with the search, and the count reads `<n> of <m> data sets`. It is saved in the reader's place for that card (`isDatasetFavoritesOnly`, optional, so an older place reads as the filter off).
- **The search matches a data set's name** as well as its folder name.
- **Messages.** The panel posts `renameDataset {datasetFolderName}` or `toggleFavoriteDataset {datasetFolderName}`, matched against `nameableDatasetFolderNames`, a new pending/active allow-list of every row the drawn model lists. A row added in place (#226) joins it only once the panel says it is drawn. The host posts `datasetPreferences {renderSequence, datasetFolderName, customName?, isFavorite}`, and the panel redraws that row on every card in place.
- **Unchanged:** Open, Insert… and Show record counts, `datasetSource.json`, the data set folders on disk, and both faker backends.

## [3.81.0] - A failed insert is a red error with a View errors button

Closes [#310](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/310).

When a Collections API file could not be inserted, the insert showed a yellow warning, `Failed to process collectionsApi-<Object>.json`, with no reason and no way to see what the org answered. Insert Data Set by Directory showed nothing else, so the results file under `InsertAttempts/` had to be found by hand.

- **A file that stops the insert is an error, not a warning.** It names the file and how many records failed, and says when every saved record was deleted because all-or-none was chosen, for example *Failed to process collectionsApi-Contact.json: 1 record failed, and every record this insert had saved was deleted, because all-or-none was chosen.*
- **A request that throws is an error too,** and still carries the request's error text. Under all-or-none it is shown after the rollback and says every saved record was deleted. The whole message, the file name included, is escaped for the notification.
- **Both have a View errors button** that opens that attempt's `insertAttemptResults-<timestamp>.json`. The path is checked again when it is clicked: a file that has gone, or is no longer in the workspace, opens nothing and says so. With no workspace folder open there is no button.
- **A request that throws is recorded in the results file.** One entry under that object's `FailureResults` names the file and the error (`statusCode: REQUEST_FAILED`), so the button has a file to open even when the first file threw. It is not counted as a failed record. If the file cannot be written, the error still shows, without a button.
- **Recipe Cockpit:** a stopped tree insert is now an **error** with **View errors**, and it is the only notification: the shared insert is told (`isFailureReportedByCaller`) not to show its own. A request that threw is named with its error in that notification (`requestFailureDetail` on the insert's result), so the reason is not only in the file.
- **Recording the error can never skip the rollback.** An object named from its file, such as `collectionsApi-constructor.json`, used to make recording the error throw before an all-or-none rollback; that step now catches its own failure. Records that failed without stopping the insert are still a warning, and a cancel is unchanged.
- **Unchanged:** the cancel warning and its rollback, the "All files processed." message, the results file's shape for records the org answered, and every rule on which orgs an insert may reach.

## [3.80.0] - Recipe Cockpit: "Generate permission set…" writes a create/read permission set for a tree into the project

Closes [#306](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/306).

Finding which object and field access the running user lacked before a tree insert meant inserting, reading the failure, editing a permission set and trying again. **Assign permission sets to me…** could only offer permission sets the project already had. A new button beside it writes one that covers the tree.

- **What it grants.** Create and Read on every object the tree inserts (once each, with a recipe, not excluded), and nothing else on the object: no Edit, Delete, View All or Modify All. Every field the recipe lists for those objects gets `readable`, and `editable` unless the org computes it (a formula, roll-up summary or auto number field).
- **What it leaves out, and counts.** Required and master-detail fields, which Salesforce refuses in `fieldPermissions`; a STANDARD field (any name not ending `__c`/`__pc`) unless its XML says `<required>false</required>`, because a retrieve leaves `<required>` out of standard fields the org requires (`Contact.LastName`, `Opportunity.StageName`); the standard fields only the recipe carries (`Name`, `RecordTypeId`); a field whose source XML is missing or not a `<CustomField>`; and any object or field name that is not an api name. The objects wrapper records neither `<required>` nor `<formula>` (a formula keeps its result type), so each field's XML is read under `salesforceObjectsPath` when the permission set is written, which works for older runs too.
- **Where.** `<default package directory>/main/default/permissionsets/SDT_Treecipe/SDT_<tree>.permissionset-meta.xml`, never at the first level of `permissionsets/`. The package directory is the one `sfdx-project.json` marks `default`, or its first when none is (as the Salesforce CLI resolves it), from the same strict read of `sfdx-project.json` the assign button uses; a missing or unparseable file is refused with a warning, so the assign button always finds the file. Both the objects path and the folder written to must be inside the workspace: the deepest existing folder is checked before any folder is made, and the folder again once it exists, so a linked `permissionsets/` or `SDT_Treecipe/` makes nothing outside the workspace.
- **Name and label.** `SDT_` plus the tree's folder name with every other character made one underscore, ends trimmed, cut to 80 (`Account-thru-OtherChildObject__c` → `SDT_Account_thru_OtherChildObject_c`); a folder name that leaves nothing usable is refused. The label is the tree's own name, or its title, on one line and cut to 80. All text is XML-escaped.
- **Deterministic.** Objects and fields are sorted with `<`, so writing it again for the same tree gives the same bytes on any machine.
- **Confirm, then write.** A modal names the file, what it grants, whether it overwrites an existing file (Treecipe owns it), and that it will not be deployed. Cancel writes nothing.
- **Nothing is deployed** (#302 stands). The information notification offers **Open file**, **Copy deploy command** (`sf project deploy start --metadata PermissionSet:<name>`, put on the clipboard and never run) and **Assign permission sets to me…**, which goes through the same router as a click so every assign guard still applies. A test fails if the generate path builds a deploy argv or runs the CLI.
- **Messages.** The panel posts `generateTreePermissionSet {treeKey}`, matched against `nameableTreeKeys`; it routes to nothing for a card not drawn, a tree whose every object is excluded, or while a recipe write, a scratch org run or a permission set assignment runs, and the host checks those runs again after the modal, right before writing. The object-folder search never walks into an object folder. The button is disabled with its reason in the last three of those cases.
- **Unchanged:** the assign button's discovery and flow, the sandbox-and-scratch-only rule, and both faker backends.

## [3.79.1] - Recipe Cockpit: the expand/collapse toggles are an outlined chevron

Closes [#307](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/307).

- **Every toggle draws an open chevron instead of a filled triangle**: the tree card header, the Treecipe object row and the picklist field row. It points right when collapsed and down when expanded, and is stroked in the accent colour with round caps, like the chain link and the fixed-value pin.
- **Unchanged:** it is still one path that CSS turns a quarter on `aria-expanded`, with the same motion and `prefers-reduced-motion` rule, the same 2.1rem glyph in a 2.6rem button, and the same row alignment.

## [3.79.0] - Recipe Cockpit: the org picker stays on screen while orgs are checked, and the CLI's default org comes first

Closes [#305](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/305).

Opening a Treecipe tab, or pressing **⟳ Refresh orgs**, used to hide **Choose org…** and the dropdown and disable ⟳ until `sf org list --json --verbose` had pinged every org. All that was left was a line of text, so the panel looked broken.

- **The picker stays drawn during the check.** The dropdown, **⟳ Refresh orgs** and **+ New scratch org** stay visible and enabled, with a spinner to the right of the dropdown and *Checking org connections…* below it. While the check runs, the dropdown's one option is the org you picked last, or else the CLI's default org, or else *Loading orgs…*. Nothing can be selected from it until the list arrives.
- **The CLI's default org.** `SalesforceOrgService.readDefaultTargetOrgIdentifier` reads it in process, with no CLI process started, in the CLI's order: `SF_TARGET_ORG`, `SFDX_DEFAULTUSERNAME`, the project's `.sf/config.json` `target-org`, its `.sfdx/sfdx-config.json` `defaultusername`, then the global ones. It shares one reader with the default Dev Hub. A config that is missing, not JSON, empty or names something the CLI could not be handed gives no default.
- **The default org is listed first, labelled `(default)`, even when it is production**, as long as the CLI reports it connected. When the org you picked last is not listed (never picked, or no longer connected), the default is selected, and a remembered org that is no longer connected is still named in the *no longer connected* note. Nothing is inserted into it unless it answers `IsSandbox: true`: selecting it asks its Organization row, and a production org is asked nothing more and generates only, with the reason shown. The router's and the insert's own sandbox checks are unchanged. Other production orgs are still never listed.
- **Every insert waits for the check.** While it runs, each tree's button reads **Generate fake data** with *Generates only: checking the org connection…*.
- **⟳ stays clickable during a check.** A second click joins the check already running instead of starting another `sf org list`.
- **The dropdown stays drawn when no org is listed**, showing *No org listed*, with the reason below it as before.
- **Messages.** The host posts `dataOrgProvisional {orgLabel, requestSequence, renderSequence}`, a label read from the local authorization files, before `dataOrgList`. The panel drops it for another model, an older check, or once the list has arrived. The host starts the listing before it reads that label, so the local read never delays the check.
- **Unchanged:** the quick-pick org pickers (Insert Data Set by Directory, Run Picklist Dependency Check, the permission set org prompt), the scratch org run's own listing, and Insert Data Set by Directory's Developer Edition rule.

## [3.78.0] - Recipe Cockpit: the tree insert and "+ New scratch org" report in notifications, with their files as buttons

Closes [#301](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/301).

When a tree insert or a scratch org run ended, the cockpit added a line to the card or under the org picker. The line pushed every row below it down and repeated a notification VS Code had already shown, and on a success the file it linked to was not in the notification at all. 3.77.0 (#302) did this for the permission set button; this release does it for the other two.

- **Nothing in the panel moves when a run ends.** The tree insert's result line and its **View errors**, and the scratch org line under the picker with its **View output**, are gone. While a run goes, its buttons are disabled exactly as before.
- **Tree insert:** one notification for every outcome. A full success is an information message with **View results**. Failed records or a stop is a warning with **View errors**, and a cancel is a warning with **View results**. Both buttons open the insert's results file, and an insert that wrote no results file, such as one cancelled before its first file, shows no button. The text no longer says to use "View errors" in the Treecipe tab.
- **+ New scratch org:** a success now offers **View output**, as a failure did. Text that was only in the panel line, "It is selected in the Treecipe tab", "press ⟳ to check again" and "No deploy was attempted", is now in the notification. The org is named `alias · username`, so it is not shown with escaped parentheses. The "Listing the new scratch org…" step is shown in a progress notification.
- **A button opens only a file still in the workspace.** The path is checked again when it is clicked, and a file that has gone opens nothing and says so.
- **Messages.** `scratchOrgState` carries only `isRunning`. `dataOrgReadiness` no longer carries `insertResults`, and `datasetAdded` no longer carries `insertResult`. A posted `viewInsertErrors` or `viewScratchOrgOutput` routes to nothing, so the panel has no message that opens a file.
- **Unchanged:** `Generates only: <reason>` beside the generate button and the org picker's own status and hidden-orgs note, which describe the selection rather than a run; the one-run-per-window locks; the sandbox-and-scratch-only rule; text escaped for notifications; and Insert Data Set by Directory's own notifications.

## [3.77.0] - Recipe Cockpit: "Deploy this metadata…" removed; the permission set button only assigns

Closes [#302](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/302). Part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

The Recipe Cockpit no longer deploys metadata. Deploy a tree's objects, fields and permission sets with your usual deploy (for example `sf project deploy start`); the cockpit's job is to make sure the user you are logged in as can see them before the insert.

- **"Deploy this metadata…" is gone**, with its "Open Deployment Status" link (#283). A posted `deployTreeMetadata` or `openMetadataDeployStatus` message does nothing. **+ New scratch org** still deploys the project's source to the scratch org it creates.
- **"Deploy & assign permission sets…" is now "Assign permission sets to me…".** It still offers this workspace's permission sets that grant access to the tree's objects, in the same multi-select pick, and uses the org chosen above (or one you pick: sandboxes and scratch orgs only). After you confirm, it asks the org again whether it is a sandbox and, on the same connection, which of your picks the org already holds (`SELECT Name FROM PermissionSet WHERE Name IN (…)`, case-insensitive). It runs **no** `sf project deploy start`.
- **Picks the org does not hold are not assigned.** They are named in one warning, for example *Not in qa · qa@example.com: Gadget_Access. Deploy this permission set to the org, then assign it.* The picks the org holds are assigned with `sf org assign permset` to the user the org is authorized as. When it holds none of them, no CLI process runs. If the org cannot be asked, nothing is assigned and a fixed warning says to try again.
- **Every outcome is a VS Code notification, and its follow-up is a button on it.** The card no longer draws a status line, **View output** or **Open Deployment Status**: it has the button only, disabled while a run is going. A success is an information message. Everything else (a refusal, a missing permission set, a partial assignment, a timeout, a cancel, a missing Salesforce CLI) is a **warning**, never an error, and when the CLI left a result its **View output** button opens it from `treecipe/OrgOperations/<username>/<timestamp>-permission-set-assign.json`.
- **A prompted org that answers it is not a sandbox no longer becomes the selection.** Only an org that passed the sandbox check is remembered as the one chosen above.
- **Removed code:** `RecipeCockpitMetadataDeploy`, the deployed-object readiness, the deploy-status URL helpers in `ScratchOrgService` (and `sf org open --path`), and `SalesforceOrgService.isUsernameAuthorized`. `RecipeCockpitPermissionSetDeploy` is renamed `RecipeCockpitPermissionSetAssign`.
- **Unchanged:** the sandbox and scratch-org-only rule and its second check, the confirmation, the 50-pick limit, the one-at-a-time lock with the insert, the org picker and **+ New scratch org**, and the describe refresh for the objects an assignment grants on.

## [3.76.0] - Recipe Cockpit: motion for expanding, collapsing, switching tabs and pressing buttons

Closes [#227](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/227). Part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Everything in the cockpit used to change in a single frame. It now moves, briefly, where the reader made it move.

- **Expanding and collapsing.** A tree card, a Treecipe object and a picklist row (its first open included) fade and slide open (160 ms) and fade closed (140 ms). The ▸ is one triangle that turns a quarter on `aria-expanded` (`[aria-expanded="true"] > .toggleGlyph { transform: rotate(90deg) }`) instead of being swapped for a second shape, so `RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH` is gone. (The Previous Versions row the issue names was removed in 3.66.0 (#265); there is nothing left to animate there.)
- **Hidden stays hidden.** The `hidden` class is set or cleared first, so it and `aria-expanded` are accurate for the whole animation. A closing body stays drawn only while it fades, and is `aria-hidden="true"` and `inert` meanwhile; both are removed when the fade ends. Reopening a body mid-fade cancels the fade.
- **Rows are still built on first expand only.** A body is built first and revealed after, so an animation never builds a row the reader did not open.
- **Tabs.** The incoming tab panel fades in; the outgoing one is gone at once. Each tab's underline is a bar that shrinks toward the incoming tab while the incoming one grows from the outgoing side, so the underline moves to the active tab. The panel only names the direction (`movingLeft`/`movingRight`) on the tab strip; nothing is positioned through inline styles.
- **Buttons and rows.** Every button, select and input transitions its colours, border and shadow (120 ms) and nudges down 1px when pressed. The filled accent buttons darken on hover and press. A card header, an object row, a field row and a data set row transition their background, and object and field rows highlight while something in them has keyboard focus.
- **Only the reader's own click animates.** A restored place, a `focusTree` from the host and a search's auto-expand stay instant, the ▸ included: a toggle turned by anything but a click carries `noMotion`.
- **An excluded object's body is not faded.** An animating body is its own stacking context, which would draw its checkboxes and pins under the object's dimming overlay for the length of the fade, so it opens and closes at once.
- **`prefers-reduced-motion: reduce`** turns every transition and animation off (one `*, *::before, *::after` block with `!important`, last in the stylesheet), and the panel script then adds no animation classes at all.
- **Palette and CSP unchanged.** No new colour: the underline is `--sdt-accent`, hover and press use `--sdt-row-hover` or a `brightness()` filter. The filter dims the white text along with the accent, so `--sdt-on-accent` on the accent falls from 5.17:1 to 4.93:1 on hover and 4.65:1 pressed, still above 4.5:1; a test holds both filtered states to it. No `--vscode-*` colour is read. The shell builder still takes only a nonce, and every rule is in its nonced stylesheet.
## [3.75.0] - Recipe Cockpit: a status bar item opens the cockpit in Treecipe workspaces

Closes [#251](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/251). Part of epic [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

- **`$(list-tree) Treecipe` in the status bar.** A workspace that contains `treecipe/treecipe.config.json` now activates the extension at window load (`workspaceContains:treecipe/treecipe.config.json`, the extension's first activation event). The item sits on the left, with the tooltip *Open Recipe Cockpit*. A workspace without that file activates exactly as before, on its first Treecipe command, and the item appears from then on. The item has its own id and name, so the status bar's right-click menu lists it as *Treecipe Recipe Cockpit* and VS Code remembers if you hide it there.
- **The same command as the palette.** Clicking runs `treecipe.openRecipeCockpit`, so the `recipeCockpitEnabled` opt-in warning still appears when the flag is off, and an open panel is revealed rather than duplicated.
- **Showing it does nothing else.** No run is loaded, no org contacted, no `sf` command run, no generated file read and no webview created until it is clicked. There is still no `onWebviewPanel:` activation event and no panel serializer.
- **New setting `salesforce-data-treecipe.showRecipeCockpitStatusBarItem`** (boolean, default `true`). Turning it off hides the item and turning it on shows it, without a reload. With it off from the start, or in a window with no folder, no item is created at all. The item and its settings listener are disposed with the extension.
- **No settings write on every load.** `activate` writes `useSnowfakeryAsDefault: false` to the workspace only when the workspace does not already hold that value, so a Treecipe workspace's `.vscode/settings.json` is not rewritten each time the window loads. That flag is not the faker backend choice (`selectedFakerService`), which activation never touches.

## [3.74.1] - Recipe Cockpit: the tree's chain link tilts from bottom right to top left

Closes [#295](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/295).

- The chain-link include/exclude icon on a Treecipe object row now runs from the bottom right to the top left. It used to run from the bottom left to the top right. `RECIPE_COCKPIT_TREE_GLYPH_TRANSFORM` is now `rotate(45 12 12)` (it was `rotate(-45 12 12)`). The joined, broken and dashed auto-excluded links all share that one transform, so all three states turn together.
- **Unchanged:** the glyph paths, size, colours, the 24×24 viewBox (a ±45° turn of the same path reaches the same corners, so nothing is clipped), `aria-pressed`, titles, labels, the exclusion cascade, the CSP and the nonce-only shell builder.

## [3.74.0] - Recipe Cockpit: add a lookup's standard parent to the recipe from a template

Closes [#294](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/294). Part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

A lookup to a parent the recipe does not write (a Contact's `AccountId` with no Account block) could only point at records already in the org, through the insert's parent picker, or be left blank. The Treecipe tab can now add that parent to the recipe **file**, so the tree generates and inserts its own parent.

- **Add \<Parent\> to recipe** on a lookup row writes a new top-level block for the parent, then wires the lookup to it the way #151's **Wire to…** does. The block has a nickname of its own (`Account_NickName`, or `Account_NickName_2` when that is taken), `count: 1` and only the template's fields. It goes directly above the top-level block holding the lookup, and above the generated comment that names that block's object (`# Contact (Parents: …)`), so the comment stays with its object. Any other comment, such as a `# Level N` banner or a note of your own, stays where it is. A host confirmation names the file, the fields and the wiring; Cancel writes nothing. The cockpit then reloads onto the card's Treecipe tab with the parent in it.
- **Minimum required fields template, in both backends.** `getMinimumRequiredFieldsTemplate()` on `IRecipeFakerService`, beside `getOOTBObjectApiNameToFieldApiNameMap`: Account `Name`; Contact `LastName`; Lead `LastName`, `Company`; Opportunity `Name`, `StageName`, `CloseDate`; Case with no fields (a block with its count only). Each backend takes its values from its own standard-object list. faker-js writes `Name: ${{faker.company.name()}}` and snowfakery `Name: ${{fake.company}}`. The block uses the template of the backend that wrote the recipe, read from its folder and file names.
- **Offered only where the insert can use it.** The lookup's value must still be exactly `### TODO -- REFERENCE ID REQUIRED`. The card's lookups must point it at **one** parent, the parent must have a template, and the recipe must not already write it. Generate Treecipe must also put the parent at a strictly lower relationship level, so the insert sends it first and resolves the lookup to its Id through the existing nickname swap. An object written more than once is offered only when every occurrence has a nickname of its own.
- **Refused with a warning, nothing written:** a parent with no template (custom objects and `User` included), a recipe that already has a block for the parent, a polymorphic lookup, a lookup filled in or a file changed on disk since the panel drew it, and an object written more than once whose occurrences cannot be told apart.
- **A line patch.** `RecipeCockpitRecipeWriter.addParentObject` re-checks everything against the file as it is at the click. It inserts the block and replaces the lookup's one line, and every other line keeps its bytes and line ending. The result is scanned again before it is saved. `listAddableParentObjects` is the same rule, so the panel never offers an addition the writer would refuse for a reason the file already shows.
- **One write at a time.** The button posts names only (`addParentObject {treeKey, objectApiName, objectNickname?, fieldApiName}`), matched against `addableParentTargets`, a pending/active allow-list like #151's. It shares the wiring's lock and `wireLookupState`, so it, **Wire to…** and **Wire TODO lookups** are held together.
- **Template alone.** The template is not checked against an org. A required field your org adds to the parent is reported by the insert, in its result and View errors, as before.
- **Review fixes.** An object whose name is not an api name is never offered, and the writer refuses it, so no workspace text reaches the confirmation unchecked. The confirmation and its notices now escape every name they show. Whether an object's occurrences can be told apart is worked out once per object rather than once per lookup, so a recipe that writes one object thousands of times stays fast.
- **Unchanged:** Generate Treecipe and both backends' generated recipes, the insert's parent picker (custom objects still go through it), and every other lookup.

## [3.73.0] - Recipe Cockpit: one generate button per tree, never disabled except while it runs

Closes [#293](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/293). Part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

- **▶ Run Faker is gone.** Each tree card's Treecipe tab has one button. It generates exactly as **Run Faker by Recipe** does (the card's filtered copy for excluded objects, unticked fields, changed counts and fixed values; `datasetSource.json`; the new data set added in place to Previously Used Data Sets). When it can, it then inserts the way **Insert Data Set by Directory** does, with the cockpit's lookup wiring (nicknames, in-run parents, the parent picker, required lookups filled from the org).
- **The label says what a click does.** With a sandbox or scratch org selected and every object ready, it reads **Generate fake data and insert into \<org\>**. Otherwise it reads **Generate fake data**, generates only (with Run Faker by Recipe's own confirmation), and says why beside it as `Generates only: <reason>`. Reasons include: no org chosen, an org that is not a sandbox, a readiness reason or a check still running, another tree being inserted, and a scratch org or deploy still running.
- **Never disabled except while its own tree runs.** Only the clicked card's button is held, as **Generating…** or **Inserting…**. Other cards stay clickable: generate-only runs are tracked per tree and replayed per tree on a reload, so several trees can generate at once. Inserts stay one at a time; while one runs, every other card generates only.
- **A generate never cancels another tree's insert.** A generate-only run that ends without a data set it can add in place normally reloads the run. While another tree's insert is running, that reload is held until the insert ends, because a reload drops the org selection the insert was confirmed against.
- **Generate only in the insert dialog.** The insert's confirmation now offers **Generate only** beside **Generate and insert**. It writes the same data set, connects to nothing and inserts nothing.
- **Messages.** The panel's `runFaker`/`runFakerState` messages are now `generateTree`/`generateState`; a posted `runFaker` routes to nothing. A refusal that used to start "Run Faker did not run on" now starts "Nothing was generated for".
- **Unchanged:** the palette commands **Run Faker by Recipe** and **Insert Data Set by Directory**, both faker backends, and the insert's sandbox-and-scratch-only rule. Insert Data Set by Directory still also accepts Developer Edition; the two rules were deliberately not merged.

## [3.72.4] - Docs: README and CLAUDE.md describe the cockpit as it ships

Part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173). Documentation only; no code changes.

- **README.** The Recipe Cockpit intro no longer says the cockpit compares a recipe with an org (the Compare tab went in 3.68.0). It now says the cockpit deploys a tree's metadata and permission sets. **Deploy & assign permission sets…** (3.70.0) gets its own bullet beside **Deploy this metadata…**, and both are named in the Treecipe tab's list of buttons. Insert Data Set by Directory now refers to a row of **Previously Used Data Sets** instead of "a Previous Fake Set".
- **CLAUDE.md.** The last references to the retired Structure tab and Data-by-Org Create now name the Treecipe tab and the tree insert. An excluded object is described as left out of the tree insert (`listTreeInsertObjectApiNames`), replacing an `excluded in Structure` label that no longer exists.

## [3.72.3] - Recipe Cockpit: the org picker no longer counts the orgs it leaves out

Closes [#284](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/284).

- When the Treecipe tab's org picker leaves an authorized org out (production, expired, deleted or not connected), its note now reads only `The Treecipe tab lists only sandboxes and scratch orgs the Salesforce CLI reports as connected, never production.` The count and the reasons that came before it ("3 authorized orgs are not listed: 1 production, 1 expired, 1 not connected.") are gone. With nothing left out, there is still no note.
- The note is one constant, `RECIPE_COCKPIT_HIDDEN_ORGS_NOTE`. The `dataOrgList` message no longer carries `hiddenOrgCount`, which the panel never read.
- **Unchanged:** which orgs are listed, the "last org used is no longer connected" notice, the messages shown when no org is listed, and the other org pickers (Insert Data Set by Directory, Run Picklist Dependency Check, the Dev Hub picker and the deploy prompts), which still count what they left out.

## [3.72.2] - Recipe Cockpit: orgs are listed by their alias again

Closes [#286](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/286).

The Treecipe tab's org picker is meant to label an org by its alias, but sandboxes with an alias were listed by username. `@salesforce/core` reads aliases once per process into a `StateAggregator`, and the extension host lives as long as VS Code. So an alias set after the extension loaded never appeared. That includes `sf alias set`, `sf org login … --alias` and a scratch org this extension created.

- **Fresh authorizations.** Every org listing now drops that cached instance (`StateAggregator.clearInstance()`) before it reads the authorizations, so the alias file is read again. This covers the Treecipe tab's picker, Insert Data Set, Run Picklist Dependency Check, the Dev Hub picker, the alias check of **+ New scratch org** and the authorization check before a failed deploy's Deployment Status (#283). An alias set since shows up on the next listing, with no ⟳.
- **The CLI's alias as a fallback.** The `sf org list --json --verbose` answer's `alias` (or the first string of `aliases`) is read as untrusted. It is used only as a label, and only for an org whose authorization carries no alias. An alias that could not be an org identifier is ignored. The CLI answer is cached until ⟳, so a CLI alias is not put back on an org once it is stale: when the fresh authorizations show it on another org, or when this org's authorization carried an alias at the time the CLI ran and no longer does (`sf alias unset`).
- **Same label everywhere.** It is the alias, or the username when there is none, in the picker, the hidden-orgs note and the quick picks.
- **Only a label.** The selection is still by index, the remembered org is still the username, and the cockpit's CLI calls still name the username. `targetOrgIdentifier` is still decided by the authorization alone, so the CLI's alias never reaches `--target-org`. An authorization's aliases are now type-checked: the first non-empty string is used.
- **Unchanged:** which orgs are listed (production stays out of the Treecipe tab, and only orgs the CLI reports as connected are listed), recipe generation and both faker backends.
## [3.72.1] - Recipe Cockpit: the CLI never runs outside the project on a Windows network folder

Closes [#285](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/285).

**+ New scratch org**, **Deploy this metadata…** and **Deploy & assign permission sets…** run the Salesforce CLI in project mode: the workspace folder holding `sfdx-project.json` is its working directory, because `sf project deploy start` finds its project there. Every one of those calls already passed that folder, and the tests asserted it. On Windows, though, the CLI runs through `cmd.exe`, and `cmd.exe` cannot start in a network (UNC) folder (`\\server\share\…`, or a WSL folder opened as `\\wsl.localhost\…`). It prints "UNC paths are not supported. Defaulting to Windows directory." and runs in `C:\Windows`, so the CLI ran outside the project.

- **Refused before anything runs.** On Windows, `PicklistDependencyCheckService.runSalesforceCli` now refuses a project-mode working directory that starts with two slashes of either kind. It starts no process and answers a spawn error (`EUNCWORKINGDIRECTORY`) naming the folder and saying how to open it instead: map the share to a drive letter, or reopen a WSL folder with the WSL extension. Each flow reports that error as it already reports a CLI that could not be started, and writes no result file. Nothing is created, deployed or assigned.
- **A real process proves the working directory.** A new test (skipped on Windows) puts a stand-in `sf` script on PATH, moves the test process to the machine root, and checks that the CLI starts in the workspace. Taking `cwd` out of `runSalesforceCli` fails that test with `/`.
- **Unchanged:** calls outside project mode (`sf org list`, `sf org open`, the picklist dependency check), the CLI found on PATH by absolute path, `NoDefaultCurrentDirectoryInExePath`, all-or-nothing deploys, and targeting by username. A double-slash folder on macOS or Linux is an ordinary path and is not refused.

## [3.72.0] - Recipe Cockpit: wire a TODO lookup to a nickname, writing the recipe file

For [#151](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/151), rescoped to lookup wiring.

A lookup Generate Treecipe could not wire stays `### TODO -- REFERENCE ID REQUIRED`. That is every lookup of a snowfakery recipe, and of a faker-js recipe generated before #46. Run Faker then generates it as nothing, and only the cockpit's own tree insert filled it in, with a random parent. The Treecipe tab now resolves the TODO in the recipe **file**, so Run Faker, Insert Data Set by Directory and every later run see the reference:

- **Wire to…** on a lookup row writes the parent's nickname as the lookup's value (`AccountId: Account_NickName`). The insert replaces a value that is exactly a nickname with the Id of the record holding it, for both backends, and faker-js spreads a nickname with `count > 1` across that parent's records. With more than one record to choose from (a polymorphic lookup, or two parents in the tree), the cockpit asks which. A confirmation names the file and the change; Cancel writes nothing.
- **Wire TODO lookups (N)**, beside Reset selection, wires every lookup of the tree that has exactly one record to choose from in one write, after a confirmation listing each `Object.Field → Nickname` (the first 12, then a count). A lookup with more than one choice is left for its own **Wire to…**.
- **Only a nickname the insert can resolve is offered:** an ancestor of the occurrence (a faker-js friend is generated under it), or an object of the same recipe at a strictly lower relationship level, which is inserted first. A nickname is offered only when exactly one occurrence in the file holds it, and never one YAML would load as a boolean or null (`Yes`, `No`, `On`, `Off`, `true`, `null`…), since the insert could not match it. An object written more than once is offered only when every occurrence has a nickname of its own, the same rule the Treecipe tab draws it by. A self-lookup's top record, a lookup cycle and a parent with no recipe stay TODOs, because no record is inserted before them to name.
- **The write is a line patch.** `RecipeCockpitRecipeWriter.wireLookups` replaces only each TODO field's own line, in one scan, and leaves every other line and line ending as it was. It re-derives what may be wired (`listLookupWirings`) from the file as it is at the click, so a lookup filled in, a nickname renamed or an object moved since the panel was drawn refuses the whole batch and writes nothing. The cockpit then reloads onto the card's Treecipe tab. The read-back checks every edited line against one index of the result, so **Wire TODO lookups** on 11,000 objects (33,000 lookups) takes about 1.4 s rather than 14 s, and a cockpit load lists the TODO lookups from the recipe text it already read.
- **What the panel sends.** `wireLookup {treeKey, objectApiName, objectNickname?, fieldApiName}` and `wireAllLookups {treeKey}` carry names only, matched against `wireableLookupTargets`, a pending/active allow-list built from the rendered model's `lookupWirings` (promoted on `rendered`, emptied on `ready`, a new post and a failure to draw). The nickname and the recipe file are the host's. One write runs at a time (`wireLookupState`, replayed on a reveal), and **+** (Add friend) waits for it, since both write the same file.
- **A lookup row shows what the recipe file says.** The objects wrapper records every lookup as the TODO, even after Generate Treecipe wired it to an ancestor (#46). A lookup row whose wrapper value is that TODO now shows the file's value, so a wired lookup reads as its nickname.
- **Unchanged:** recipe generation and both faker backends, the tree insert's own filling of lookups still TODO, field and object selection, counts and fixed values (which still never write the recipe).

## [3.71.0] - Recipe Cockpit: "Open Deployment Status" when "Deploy this metadata…" fails

Closes [#283](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/283), following [#273](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/273).

When a tree's metadata deploy fails, the CLI's `--json` names the deploy's page in Setup (`result.deployUrl`), but the cockpit used to drop it. A failed deploy now offers **Open Deployment Status**, which opens that page in the deploy org, signed in.

- **Where it shows.** On a `failed` outcome (component failures) with a usable URL, the error notification shows **Open Deployment Status** beside **View output**, and the card's deploy status line shows the same link. Neither appears for a successful deploy, a CLI that is not installed, an `unconfirmed` deploy (timeout, cancel, oversized output), or a URL that fails any check.
- **Which URLs count.** `ScratchOrgService.readDeployComponentCounts` takes the deploy org's instance URL (read from the connection the deploy's Organization re-check already opens) and returns `deployUrl` only when all of these hold:
  - it parses as `https:`;
  - it has no credentials;
  - its host, port included, equals the deploy org's instance host;
  - its path is `/lightning/setup/DeployStatus/page`;
  - its `address` names `/changemgmt/monitorDeploymentsDetails.apexp?asyncId=<0Af… id>`.

  Anything else (another host, `http:`, another page, malformed, not a string) is no URL. The scratch org deploy (#200) shares the parser but passes no instance URL, so it offers nothing.
- **Opening.** The page opens through `sf org open --target-org <username> --path <path> --url-only --json`, the same route as #279's **Open in browser**: `runSalesforceCli` with a timeout and no `cwd`, read by `parseOrgOpenOutput`, and the frontdoor URL handed only to `vscode.env.openExternal`.
  - The `--path` is rebuilt from the deploy id (`ScratchOrgService.buildDeployStatusOpenPath`) with the address unencoded and no `retURL`, rather than copied. On Windows `cmd.exe` expands `%…%` even inside quotes, so the argument carries no `%` or `&`.
  - `buildOrgOpenArguments` refuses any other `--path`.
- **Unhappy paths.** If the deploy org is no longer authorized (`SalesforceOrgService.isUsernameAuthorized`, read locally), a warning appears and nothing opens. If `sf org open` fails, times out or throws, a fixed warning appears that quotes neither the CLI nor any address. One open runs at a time.
- **What the panel sends.** It posts `openMetadataDeployStatus {treeKey}` with no URL in the payload. The router accepts it only for the `treeKey` the last failed deploy's line is drawn on, and only while no deploy runs. The page and the org are held host-side in `metadataDeployStatusTarget`, which the next deploy or permission set run clears and a reopened panel carries. The panel learns only `hasDeployStatus: true` on `metadataDeployState`.
- Notifications go through `escapeForNotification`, name the org as `alias · username`, and are not awaited. No URL or session id is posted, written, logged or quoted.
- **Unchanged:** recipe generation and both faker backends.

## [3.70.0] - Recipe Cockpit: "Deploy & assign permission sets…" for a tree

Closes [#274](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/274), following [#273](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/273).

Once a tree's metadata is deployed, the org's user still cannot see its objects or fields until a permission set grants them, and the tree insert fails on field-level security. Each tree card's Treecipe tab now has **Deploy & assign permission sets…**, next to **Deploy this metadata…**.

- **What is offered.** The host looks for `*.permissionset-meta.xml` files under the package directories of `sfdx-project.json` (read strictly, as the metadata deploy reads it), each inside the workspace. A permission set is offered when its `objectPermissions` or `fieldPermissions` name any of the tree's objects. Names are matched case-insensitively. They are offered in a multi-select pick, each showing what it covers, marked *partial* when it leaves some of the tree's objects out, with the file it came from. A name two package directories both hold is offered once.
- **Skipped files.** A file that cannot be parsed, or is not a `<PermissionSet>`, is skipped with a warning. So is a file whose name is not an api name; no such name reaches a command line. When nothing covers the tree, an information message says so and nothing runs. No pick or org prompt opens.
- **Org.** It works the same way as #273. With an org chosen in the Treecipe tab, it uses that org, which must have answered that it is a sandbox and whose check must have finished: a describe taken before the assignment and posted after it would put back the reasons the assignment removed. With none chosen, it asks for one from the Treecipe tab's own non-production list after the pick, and the org picked becomes the selection once you confirm.
- **Confirmation.** A modal names the tree, the org (`alias · username`), the user the sets are assigned to and every pick with what it covers. All its text is escaped through `escapeForNotification`. After you confirm, the Organization row is queried again on a fresh connection, and an org that does not answer `IsSandbox: true` gets nothing.
- **Deploy, then assign.** The deploy is `sf project deploy start --json --target-org <username>` with one `--metadata PermissionSet:<name>` per pick, in project mode (the workspace as working directory, `sf` from PATH), with no `--ignore-errors`. It is read all or nothing, as #270 reads a deploy. Only after it succeeds does `sf org assign permset --json --target-org <username>` run, with one `--name` per pick; it assigns to the user the org is authorized as and no one else. At most 50 permission sets are taken at once, so the command line stays inside what Windows' `cmd.exe` accepts.
- **Results.** Both answers are read from untrusted `--json`. A permission set the user already holds (`Duplicate PermissionSetAssignment`) counts as assigned. A partial assignment is an error naming which sets failed and which were assigned. A pick the answer does not account for is never reported assigned. `ENOENT` says the CLI is required. A timeout or an answer too large to read says the outcome is unknown, and Cancel kills the process tree. Each answer is saved under `treecipe/OrgOperations/<username>/` (`-permission-set-deploy.json`, `-permission-set-assign.json`), and **View output** opens the last one.
- **After it runs.** Field-level security changes what a describe answers. So once the CLI has started, that org's describes of every object the picks grant anything on, another tree's included, are dropped from the session cache. An assignment that landed on the selected org re-checks the insert readiness of every card listing one of those objects.
- **One run per window.** It shares the metadata deploy's lock and status line. While either runs, the router refuses the other, the tree insert, a scratch org run, org selection, ⟳, listing and **Open in browser**, and the panel holds those buttons. It is likewise refused while an insert or a scratch org run holds the selection.
- **What the panel sends.** It posts `deployTreePermissionSets {treeKey, orgIndex?}`. The key is matched against `deployableTreeKeys`, the same pending/active allow-list as the metadata deploy. The tree's objects come from the host's stored model.
- New file `RecipeCockpitPermissionSetDeploy.ts` (no vscode) holds discovery, both argvs and both parsers. `metadataDeployWorkspace` gains three permission sets.
- **Unchanged:** **Deploy this metadata…**, recipe generation and both faker backends. No permission set is generated. Permission set groups and profiles are not touched.
## [3.69.0] - Recipe Cockpit: you name the scratch org, and the selected org opens in your browser

Closes [#279](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/279), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

- **You choose the scratch org's alias.** After you pick the Dev Hub, **+ New scratch org** asks for an alias in an input box. There is no `treecipe-<timestamp>` default any more: the box starts empty, and the alias is the name `sf org list`, the org picker and later CLI commands use. Escape cancels: nothing runs and nothing is written.
  - The alias must be letters, digits and `. _ + -`, at most 80 characters, and start with a letter or digit. It cannot end with `.` (Windows drops a trailing dot from a folder name), cannot be a Windows device name such as `CON` or `nul.txt`, and cannot contain `@` (that would read as a username). The box refuses anything else while you type, and the host checks again before the alias reaches the CLI (`ScratchOrgService.validateScratchOrgAlias`).
  - If another authorized org already holds the alias, the box warns you ("`uat` is currently `uat@example.com`. Creating will move it to the new org") but lets you go ahead. The confirmation says so again. Which org holds an alias is read from the local authorizations only (`SalesforceOrgService.listAliasHolders`).
  - The source deploy now targets the new org's **username**, which the create returns, never the alias, because an alias you chose can be moved between the create and the deploy.
- **Open in browser.** A button beside the selected org in every Treecipe tab logs you in to that org in your browser.
  - The panel posts `openDataOrg {orgIndex}`. The host acts only when that index is the org selected now.
  - It runs `sf org open --target-org <username> --url-only --json` (not in project mode, with a 60-second timeout) and opens the answer with `vscode.env.openExternal`, which also works in Remote, WSL and Codespaces, where the CLI has no browser of its own. Only an `https:` address is opened.
  - The address carries a session id, so it is never posted to the panel, saved, logged or quoted in a notification. Any error is answered with a fixed message. `ScratchOrgService.redactSecretText` now also removes any address carrying a `sid=` or `otp=` parameter, for CLI text a failure quotes.
  - A failure (CLI missing, timeout, no authorization) is an error naming the org.
  - The button reads **Opening…** and is disabled while it opens, and while a scratch org run or a metadata deploy holds the org picker. One open runs per window: a panel closed and reopened, or a reloaded document, is told an open is running and starts no second one.
- **Unchanged:** the Dev Hub picker, the definition file, the 7-day duration, the all-or-nothing deploy, the result files under `treecipe/OrgOperations/`, recipe generation and both faker backends. The cockpit still never deletes an org.

## [3.68.0] - Recipe Cockpit: the Compare tab and the metadata diff are removed

Closes [#266](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/266), slice D of [#261](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/261).

A tree card's tabs are now **Treecipe · Previously Used Data Sets**. The Compare tab compared a tree's fields with an org's describe. It is gone, along with the recipe-vs-org metadata diff behind it. To see what an org lacks, choose it in the Treecipe tab: the insert's own check names any object the org does not have, and **Deploy this metadata…** deploys it.

- **Removed:**
  - the tab, its **Compare with an org…** and **Choose another org…** buttons, its progress and summary, its per-card status filter, its object and field rows, and their CSS;
  - `RecipeCockpitMetadataDiff`, its suite and its `metadataDiff/` mocks;
  - the panel's `selectOrg` message, the host's `orgDescribe` and `orgProgress` messages, and the `describableObjectApiNamesByTreeKey` allow-list;
  - the stored comparisons (`orgDescribeMessagesByTreeKey`) and the reopen carry that re-posted them (`carryOrgDescribeMessages`, `buildComparedRowsSignature`);
  - the diff's host-only copy of the recipe's picklist values. The display copy the Treecipe tab loads per row is unchanged;
  - the *required in \<org\>* note an unticked field drew from a comparison. The insert's readiness still refuses an unticked field the org requires and says so beside the insert button.
- **Routing.** A posted `selectOrg` routes nothing: no describe, no picker, no message.
- **Saved place.** A place of either version saved on the Compare tab (`compare`, or `dataByOrg` in a place saved before [#255](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/255)) opens that card on Treecipe. Its search, status filter and opened rows are dropped, never moved onto another tab, and `statusFilter` and `expandedDataObjectApiNames` are no longer part of the place. A `focusTree` naming the tab leaves the card on Treecipe. The place version is unchanged.
- **Org pickers.** Three remain: the Treecipe tab's **Choose org…**, Insert Data Set by Directory and Run Picklist Dependency Check. Each still lists only the orgs the CLI reports as connected.
- **Unchanged:** the insert readiness's describes and their session cache, **Deploy this metadata…**, the org picker, Run Faker, the tree insert, recipe generation and both faker backends.

## [3.67.1] - Recipe Cockpit: picklist values open below their row, and every ▸/▾ is the same size and centred

Closes [#277](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/277).

- **Picklist values open downward.** A picklist row rebuilt already open (on a reopened panel, a revealed tab, or the reload after Run Faker, a tree insert or Add friend) appended its values before its own header. They drew above the field name, so with picklists stacked the row seemed to open upward. The row now opens only once it is whole, so its values sit at the bottom of the row, where a click puts them.
- **One toggle size.** The ▸/▾ of a tree card, a Treecipe object and a picklist field is one 2.6rem button, the same box as the chain link. The picklist toggle was 1.1em next to the object toggle's 3.3em.
- **Centred.** The triangle is an inline SVG built with `createElementNS` (`RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH`, `RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH`, each centred in the 24x24 box) and filled with `--sdt-accent`. A font triangle sat on the text baseline, low in its button. Nothing is fetched, so the CSP and the shell builder are unchanged.
- **Aligned rows.** A field with no picklist keeps an `aria-hidden` slot where the ▸ goes, so every field name of an object lines up, and a field row centres its controls rather than aligning them on the baseline.
- **Unchanged:** the Compare tab's ▸ (`.dataObjectToggle`), picklist values still loaded on expand, `aria-expanded` on every toggle, recipe generation and both faker backends.

## [3.67.0] - Recipe Cockpit: "Deploy this metadata…" is always offered and deploys the whole tree

Closes [#273](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/273), following [#211](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/211) and [#270](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/270).

**Behaviour change.** **Deploy this metadata…** used to appear only under an insert stopped by one object the selected sandbox lacked, and deployed only that object. It is now on every tree card's Treecipe tab, whatever the org answered, and deploys everything the tree needs from this workspace's source:

- **every custom object (`__c`) of the tree** as one `CustomObject` member, which in source format sends everything in the object's folder (fields, validation rules, record types, list views);
- **every standard object of the tree** through the custom fields its source folder has, one `CustomField` member each. A standard object with none is listed as skipped.

What changed:

- **Org.** With an org chosen in the Treecipe tab, the deploy goes there, and only once that org has answered that it is a sandbox and its check has finished (otherwise the card says so and nothing runs: a check that finished after the deploy would put back the reasons the deploy removed). With none chosen, the cockpit asks for one from the same list the Treecipe tab's picker draws (sandboxes and scratch orgs the CLI reports connected, never production). An org picked there becomes the Treecipe tab's selection once you confirm the deploy, so its insert readiness is checked afresh after the deploy. Dismissing the picker runs nothing.
- **Confirmation.** It names the tree, the org, the members, the source files they send and the objects skipped with why, each list the first 60 and then a count. A standard object's standard field files (common in retrieved source) are neither deployed nor listed as skipped. A "nothing to deploy" message names the first 10 skipped items.
- **Manifest.** The members go in a temporary `package.xml` outside the workspace, passed with `--manifest` and removed once the deploy ends, with the project's `sourceApiVersion` as its version when that is a plain version number. One `--metadata` per member made the command line grow with the tree, and on Windows, where the CLI runs through `cmd.exe`, a line past 8,191 characters (about 150 members) never starts. `sfdx-project.json` is read and the plan is made before any org is asked for, so an undeployable project or a tree with nothing in local source opens no picker. Cancel runs nothing.
- **What the panel sends.** It posts `deployTreeMetadata {treeKey, orgIndex?}`. The tree key is matched against `deployableTreeKeys`, a pending/active allow-list built from the rendered model (every card with a folder and an object), and the objects are read from the host's stored model. The per-object deploy targets built from readiness are gone: `IMetadataDeployTarget`, `buildDeployTarget`, `deployTargetsByCreateKey`, the pending snapshots, `readinessSequence`, the panel's `readinessRendered` and `activateDeployActions`, and `isMetadataDeployable` on the readiness. `RecipeCockpitMetadataDeploy.planMetadataDeploy` is replaced by `planTreeMetadataDeploy`.
- **After the deploy.** The describes of every planned object are dropped from the session cache once the CLI has run. On success, every deployed object is marked ready on every card that lists it, for the selection the deploy started under, from the CLI's answer alone.
- **Unchanged:** the second Organization check after the confirmation, the rest of the argv (`--target-org <username>`, `--json`, no `--source-dir`, no `--ignore-errors`), project mode with `sf` from PATH, all-or-nothing results, **View output**, one deploy per window and what it holds disabled, recipe generation and both faker backends.
- No permission set is deployed or assigned; that is [#274](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/274).

## [3.66.0] - Recipe Cockpit: the Previous Versions tab is removed

Closes [#265](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/265), slice C of [#261](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/261).

A tree card's tabs are now **Treecipe · Compare · Previously Used Data Sets**. The Previous Versions tab, which listed earlier runs of the tree with field-count summaries and a Diff, is gone.

- **Removed:**
  - the tab, its version rows and their expanded data set lists;
  - the `loadVersionSummaries` / `versionSummaries` and `diffTreeVersion` messages, their `summaryTreeKeys` and `diffKeys` allow-lists and host handlers;
  - the per-run wrapper field-count cache (`runFieldCountCache`, `readRunFieldCounts`, `readTreeFieldCount` and their helpers);
  - `RecipeCockpitTreeHistory.buildVersionSummaries`, `formatFieldCountChange`, `buildDiffKey`, the summary and diff targets, and the `isDiffable` / `isBackendDifferent` version fields.
- **Kept:** run discovery in `RecipeCockpitTreeHistory`. Data sets are still matched to their tree through it, and each data set row still says *current version*, *version of \<date\>* or *version unknown*.
- **Previously Used Data Sets is unchanged.** A row shows, opens, inserts and counts records exactly as before, and a new data set is still added in place (#226). A legacy data set's record counts are read when you click the row's **Show record counts**, which was already the only way on this tab.
- **Saved places.** A card saved on Previous Versions, in a place of either version, opens on **Treecipe**. Its Previous Versions search is dropped, never moved onto another tab, and its expanded versions are ignored. `RECIPE_COCKPIT_REMOVED_TREE_TABS` holds the removed tab names on both the host and the panel, so removing another tab is adding its name there. The place version did not change.
- **Unchanged:** recipe generation and both faker backends, the Compare tab, the Treecipe tab and its insert, `datasetSource.json`, and Insert Data Set by Directory.

## [3.65.0] - Recipe Cockpit: "Deploy this metadata…" takes the CLI's answer as the result

Closes [#270](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/270), following [#211](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/211).

- **Renamed:** the button under an insert stopped by an object the selected sandbox lacks is now **Deploy this metadata…** (was **Deploy missing metadata…**). It still asks for confirmation first.
- **No check after the deploy.** `sf project deploy start --json` answers with the result, so the cockpit no longer shows "Checking the tree again…", describes the object again or re-checks the trees once the CLI returns. On success, **Generate fake data and insert** is offered straight away on every card that lists the object; a card whose recipe block cannot be read keeps that reason. The insert's own check when you click it still describes the object afresh, so a reason only a describe can give (an object the org will not let you create, an unticked field the org requires) still refuses the insert before anything is written.
- **All or nothing, as the CLI reports it.** A deploy with any component failure is one failure: an error naming what failed, with **View output**. The "N of M components failed" warning and the `partiallyFailed` outcome are gone. A failed deploy leaves the card as it was and offers **Deploy this metadata…** again.
- A cancelled or timed-out deploy now says whether it applied is unknown, rather than that it may have partly applied.
- Only a deploy that succeeded under the org selection still on screen changes readiness; choosing another org meanwhile leaves the new selection's readiness alone.
- **Unchanged:** the sandbox-only guards (when the org is selected, and again after the confirmation), the `deployTargets` allow-list, what is deployed, one deploy per window, recipe generation and both faker backends.

## [3.64.0] - Recipe Cockpit: the tree insert no longer refuses a sandbox that lacks recipe fields

Closes [#264](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/264), slice B of [#261](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/261).

**Behaviour change.** With a sandbox selected that lacks some of a recipe's fields, or will not let some be set, **Generate fake data and insert into \<org\>** used to be disabled under a sentence such as "Account is missing 17 recipe fields in this org: … Account has 1 recipe field this org will not let you set: ShippingAddress." ([#210](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/210)). The insert is now offered. A record the org rejects for such a field fails at insert time, per record, like any other rejected record:

- with all-or-none off, the records the org accepted stay, and the insert result beside the button and **View errors** show what failed;
- with all-or-none on, the insert rolls back every record it saved, so nothing is left behind.

What changed:

- **Removed:** `RecipeCockpitRecordCreation.checkRecipeFields`, `buildFieldCheckReason` and `IRecipeFieldCheck`, the `missingFieldApiNames` and `notCreateableFieldApiNames` properties of `IRecipeCockpitCreateReadinessViewModel`, and the `recipeFieldApiNames` input of `buildCreateReadiness`, which only that check read. No "is missing N recipe fields in this org" or "will not let you set" sentence appears anywhere.
- **Kept:** each tree's block field listing (`listCreateBlockFieldApiNamesForObjects`), which the parent picker ([#254](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/254)) and **Deploy missing metadata…** still read.
- **These checks still refuse, as before:**
  - a production org, or an org whose type could not be read;
  - an object with no describe;
  - an object the org will not let you create;
  - a recipe block that could not be read;
  - an unticked field the org requires;
  - a required lookup that can point at more than one kind of object.
- **Deploy missing metadata…** ([#211](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/211)) now shows only for an object the selected sandbox does not have. A recipe field the org lacks no longer stops the insert, so there is no reason for the button to sit under. Slice D of #261 removes the button.
- **Unchanged:** recipe generation and both faker backends, Run Faker, the org picker, field and object selection, counts, fixed values, `datasetSource.json` and Insert Data Set by Directory.

## [3.63.0] - Recipe Cockpit: a field can have a fixed value instead of its faker expression

Closes [#262](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/262), building on [#219](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/219), [#220](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/220) and [#255](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/255).

Some fields need the same value on every generated record: a region, a test marker, a fixed status. Until now the only way to get one was to edit the generated `.yml` by hand, and the next **Generate Treecipe** threw that edit away.

- **A pin beside each field's checkbox.** On a tree card's Treecipe tab, each field with a recipe line gets a pin to the right of its checkbox. Clicking it opens a VS Code input box, not a panel field. Whatever you type becomes the field's value on every record that ▶ Run Faker and **Generate fake data and insert** generate, in both backends. The row then shows the value, in place of the faker expression, with a `fixed` badge. To go back to the faker expression, leave the box empty.
- **The recipe file is never written.** Fixed values are stored in the workspace, per tree folder, next to the excluded objects, unticked fields and record counts. The selection's storage version goes from 3 to 4, and an entry from an older version reads as having no fixed values. They are applied only to the copy Run Faker generates from: `RecipeCockpitRecipeWriter.buildFilteredRecipe` takes `fixedValuesByObject` and:
  - replaces the field's line and drops its continuation lines, on every kept occurrence of the object, nested friends and self-lookup iterations included;
  - reads the copy back to confirm each value landed.

  A card with no fixed values generates exactly as before, byte for byte. **Reset selection** clears them too. `datasetSource.json` records them as `fixedValuesByObject`, only when there are any, and the insert's confirmation lists them.
- **Written as itself in both backends.** Text is always double-quoted, so `Yes`, `007` and `null` stay the strings that were typed. A number (Number, Currency, Percent) or a checkbox value is written plain, so it is generated as its own type. A number with more than 15 significant digits is quoted instead, because js-yaml reads `123456789012345678` as `123456789012345680`. A text value that is exactly a nickname in the recipe is refused, because faker-js and the insert's Id swap would read it as a reference to that record. `RecipeCockpitRecipeWriter.checkFixedValue` refuses a value instead of escaping it when either backend could read it as something other than itself:
  - a line break either YAML parser sees (CR, LF, U+0085, U+2028, U+2029) or any other control character;
  - any template opener: `${`, `{{`, `{%`, `<<`, `<%`. faker-js runs `${{ }}` with `new Function()`, and snowfakery renders both of its template syntaxes even inside quotes.

  Tests load the copy through the faker-js processor and through PyYAML, plus snowfakery's template selection, and check that the value comes back exactly as typed.
- **Checked against the field.** The input box checks the value as it is typed, and the host checks it again once the box closes:
  - a number must fit the field's precision and scale (`Number(2,2)` takes `0.5`);
  - a checkbox takes `true` or `false`;
  - Date and DateTime must be ISO 8601, and a DateTime needs a zone;
  - text must fit the field's length;
  - a picklist value, or each value of a multi-select, must be one the workspace metadata declares.
- **Locked where the tree or the insert decides.** These pins are disabled, with the reason in their title, and a forged message for them writes nothing:
  - a lookup;
  - `RecordTypeId`;
  - a dependent picklist;
  - a controlling field while a dependent is ticked;
  - an unticked field;
  - every field of an excluded object.

  A value stored for a field that is locked is kept and comes back once the field is free again.
- **The type in a validation message is escaped.** The type comes from workspace metadata. The input box draws its validation message the way a notification draws text, so a `[label](command:…)` there would be a link that runs the command. A type that is not plainly `Name(n)` or `Name(p,s)` goes through `escapeForNotification`, and so does a picklist value the reader typed that is echoed back.
- **The panel never sends the value.** It posts names only: `setFieldFixedValue {treeKey, objectApiName, nickname?, fieldApiName}`. The router checks them against the same `selectableFieldKeys` allow-list as the checkbox. The value is shown with `textContent`, and the pin's glyph is built with `createElementNS` and palette CSS, so the CSP and the shell builder are unchanged.
- **Unchanged:** the faker services, `IRecipeFakerService`, the generated recipes, Compare, and Insert Data Set by Directory.
## [3.62.0] - Recipe Cockpit deploys an object's missing metadata to the selected sandbox

Closes [#211](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/211), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

When a tree's **Generate fake data and insert** was stopped because the selected sandbox lacked an object or some of a recipe's fields ([#210](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/210)), fixing it meant leaving VS Code, working out the `--metadata` list, running `sf project deploy start` and re-selecting the org. Now **Deploy missing metadata…** does that from the card.

The issue was written for Data-by-Org's per-object **+ Create**, which [#255](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/255) replaced with the whole-tree insert. The button therefore sits under the insert's reason, for the object that reason names.

- **When it shows.** Only when the reason is that the org has no such object (its describe answered `NOT_FOUND`, now `isNotFound` on the describe outcome) or that the tree's block has fields the describe lacks. `RecipeCockpitRecordCreation.buildCreateReadiness` marks those readinesses `isMetadataDeployable`. It never marks a describe that failed for another reason, a not-createable field, a production org or an org whose type is unknown.
- **What is deployed is the host's.** The panel posts `deployMissingMetadata {orgIndex, treeKey, objectApiName}`. These are matched against `deployableObjectKeys`, an allow-list built from the readiness the host posted for the selection checked now. Each readiness post carries a `readinessSequence` and keeps a snapshot of the targets as that post left them. The panel echoes it in `readinessRendered`, and only that snapshot is promoted, for that selection over a model the panel acknowledged, so a later readiness's targets stay inactive until it is drawn too. The allow-list is emptied on `ready`, a new model, a failure to draw and a new selection. The `orgIndex` must be the selection, and the selection must have answered `IsSandbox: true`.
- **`RecipeCockpitMetadataDeploy`** (new) builds the members:
  - A missing object gives `CustomObject:<Object>` plus the custom fields of the tree's block. In source format a `CustomObject` member deploys everything in the object's folder (validation rules, record types, fields the recipe never names), so the confirmation lists every file there (`objectFolderContents`, the first 40 named). Missing fields give `CustomField:<Object>.<Field>` for each missing custom field.
  - Each folder is read once per plan, and the workspace root's real path is resolved once, rather than once per field.
  - Each member is found in local source: an `objects` folder under a package directory of `sfdx-project.json` (the strict read), matched case-insensitively. Each file must be inside the workspace, and the name is written as the file on disk spells it.
  - Each name is held to `SalesforceApiName` twice: as the recipe names it and as the file spells it. A file that only matches through Unicode case folding (U+212A, the Kelvin sign, lowercases to `k`) is skipped.
  - An object or field that is not custom (`__c`), a file not in local source and one resolving outside the workspace are listed as skipped, with the reason. The argv builder refuses any member that is not a custom `CustomObject`/`CustomField` of api names.
- **Sandbox only, checked three times.** The router refuses unless the selection answered `IsSandbox: true`. After the confirmation, the Organization row is queried again on a connection opened by username, and anything but `IsSandbox: true` refuses with no CLI call. The CLI gets `--target-org <username>`, never an alias.
- **The confirmation** is a modal naming the org (alias and username) and listing every member and every skipped item. Cancel runs nothing. When nothing deployable is left, nothing runs and a warning says why.
- **Running it.** `sf project deploy start --metadata <m1> --metadata <m2> … --target-org <username> --json` runs through `runSalesforceCli` in project mode (the workspace is the `cwd`; `sf` comes from PATH, never from the workspace), with a 30-minute timeout and a cancellable notification. There is no `--source-dir`. Its line on the card (`Deploying 3 components of OtherChildObject__c…`) is stored and replayed to a reloaded document. One deploy runs per window. While it runs, the router refuses a second deploy, an insert, an org selection, ⟳, a listing and a scratch org. The panel holds every insert, every deploy and the picker disabled.
- **The answer is untrusted.** Only `status`, `result.success`, `componentSuccesses`, `componentFailures` and error text are read, through `ScratchOrgService.readDeployComponentCounts`, now shared with the scratch org deploy (#200). It no longer counts the `package.xml` entry as a component. The outcomes are:
  - output that is not JSON, or JSON of the wrong shape: a failure, never a success
  - a CLI that is not installed (`ENOENT`): an error saying the Salesforce CLI is required
  - some components failed and some did not: a **warning**, never an error, naming `N of M components failed`, with **View output**. No `--ignore-errors` is passed, so the deploy rolls back and the message says none was applied
  - every component failed: an error with **View output**
  - a timeout, or an answer too large to read: a warning that it may have partly applied
  - a cancel: the process tree is killed, and a message says the deploy may have partly applied
  
  The result is saved, redacted, to `treecipe/OrgOperations/<username>/<timestamp>-metadata-deploy.json`. Two operations in the same second now take `<name>-2`, `<name>-3`, … rather than losing the later result.
- **Afterwards, however it ended** (once the CLI started, even if something threw after it): the deploy stays in flight, with its button, every insert and the picker held, until the readiness has been checked again, and the deployed target leaves the allow-list until a fresh readiness offers it again. The new per-org, per-object `SalesforceOrgService.clearDescribeCache(username, object)` drops that describe, and every card listing the object is checked again, connecting only for what the cache no longer holds. The insert is offered only when the fresh describe says so.
- **Unchanged:** the shell builder still takes only a nonce, and every new text reaches the panel over `postMessage` and is written with `textContent`. Everything ships behind `recipeCockpitEnabled`, whose warning now names the deploy among the things the cockpit can write to an org. Nothing a field depends on (global value sets, record types, permission sets) is deployed with it, and no field-level security is granted.

## [3.61.0] - Recipe Cockpit: no Regenerate recipe button, a labelled ⟳ Refresh orgs, one button size, and Previously Used Data Sets

Closes [#263](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/263), slice A of [#261](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/261).

- **Regenerate recipe is gone.** The button and its "from this workspace's metadata, not the org" note no longer sit at the top of a card's Treecipe tab. To regenerate, run **Generate Treecipe** from the Command Palette, then choose the new run in the cockpit's run selector. The host refuses a posted `regenerateRecipe`. `carryPlaceAcrossRuns` went with it: only Regenerate's reload set it, so every reload now keeps the reader's place only when it is of the run already on screen. The no-run empty state's **Generate Treecipe** button is unchanged.
- **⟳ Refresh orgs.** The org refresh button now says what it does. The ⟳ sits in its own `aria-hidden` span at 1.5em, because the glyph draws small in most fonts. The tooltip is unchanged. The accessible name now starts with the visible label ("Refresh orgs: check the org connections again"), so a voice-control user can say "click Refresh orgs" (WCAG 2.5.3, Label in Name).
- **One button size.** Every cockpit button, and **All / None / Reset selection**, now defaults to 1.1em, the size of the favorite (☆) button. The tree and object ▸ toggles keep 3.3em ([#244](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/244)). The field checkbox and the chain-link icon keep their own sizes.
- **Previously Used Data Sets.** The tab formerly titled Previous Fake Sets has a new name. Its internal key (`datasets`) is unchanged, so a saved place still restores onto it.
## [3.60.1] - Recipe Cockpit: the tree's include/exclude icon is a chain link, at the front of the row

Closes [#257](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/257), a follow-up to [#219](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/219).

The icon that includes or excludes an object on a tree card's Treecipe tab (Structure before [#255](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/255)) was an upward arrow, drawn just after the enlarged `▸` that shows the fields, so the row read as two arrows side by side.

- **A chain link.** Included is a joined link (`RECIPE_COCKPIT_TREE_LINKED_GLYPH_PATH`) in `--sdt-accent`. Excluded is the same link pulled apart, with a spark either side of the gap (`RECIPE_COCKPIT_TREE_BROKEN_GLYPH_PATH`), in `--sdt-muted`. Auto-excluded is the broken link dashed. The path itself changes when the host redraws the selection, so the state is a shape, not only a colour.
- **At the front of the row.** The button now comes first, then `▸`, then the object's name. A row with no button (a self-lookup's iteration, or the ungrouped card) keeps an empty slot of the same width, so every `▸` and name in a card lines up.
- **Larger.** The glyph is sized to stand beside the 3.3em `▸` from [#244](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/244).
- **Unchanged.** What a click does (`setObjectIncluded`), the cascade, the stored exclusions, the overlay on an excluded row and the field checkboxes from #220. The glyph is still built with `createElementNS` and palette CSS and fetches nothing, so the CSP and the shell builder are untouched.
## [3.60.0] - Recipe Cockpit updates only what ▶ Run Faker or a tree insert changed

Closes [#226](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/226), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

▶ Run Faker and **Generate fake data and insert into \<org\>** each add one data set, yet both reloaded the whole run afterwards. The host re-read the run and posted the whole model again, and the panel rebuilt every card, tab and expanded row. The reload also dropped the org selection, so the panel listed the orgs again, re-selected the org, asked it again whether it is a sandbox and checked every object again. It also dropped every card's comparison. Now these two actions change only the rows they affected.

- **`datasetAdded`, in place of a reload.** When the action wrote a data set folder, the host posts one small message: the cards the new data set belongs to, its Previous Fake Sets row, and, after a tree insert, the insert's result for that card. The panel:
  - shows the insert result beside the card's insert button, as the reload did;
  - puts the data set at the top of the card's Previous Fake Sets, if that tab is built;
  - puts it under its version in Previous Versions, if that version is expanded.
  
  Every other node on the page is the one that was there before, and a test checks this by object identity across every card. The org selection, readiness and comparisons stay as they were.
- **Placed by the reload's own rule.** `RecipeCockpitTreeHistory.buildAddedDataset` reads the one new folder and places it through `groupTreeHistories`, the function a reload uses. A partial update and a reload therefore cannot disagree on which cards list it.
- **Falls back to the reload.** The run is reloaded, onto the same tab as before (Previous Fake Sets after ▶ Run Faker, Treecipe after an insert), when:
  - the action wrote no data set (cancelled, refused, failed);
  - the insert threw after its data set folder was made;
  - the run on screen changed while the action ran;
  - the data set cannot be placed: not a data set folder name, not a folder inside the workspace, an unreadable `datasetSource.json`, or no card on screen.
- **Allow-lists still decide what the panel can act on.** The new row's **Open** and **Insert…** go into a *copy* of the pending history allow-lists (`cloneTreeHistoryAllowLists`). Once a model is acknowledged, its pending and active lists are the same sets, so adding to them in place would make the row usable before it was drawn.
  - The panel answers `partialRendered {renderSequence, updateSequence}` once it has drawn the row. Only that answer promotes the copy.
  - It is accepted only when it names the latest `updateSequence` and a model whose own `rendered` has arrived since the last `ready`, new post or failure to draw (`acknowledgedRenderSequence`). Otherwise a forged or late answer could activate every history action of a model no document had drawn.
  - The host also adds the data set to its stored model, so a hidden tab that is shown again draws it, and that model's `rendered` offers it.
  - The panel drops a `datasetAdded` for any other `renderSequence`. Data set rows still use one rule (`addDatasetToAllowLists`).
- **Unchanged:** Regenerate, Reset selection, Add friend and switching runs still redraw the whole panel. No button was renamed and no action was added. The cockpit still counts no records in an org.

### Measured

The 3.25.0 method: a synthetic run written to disk and pushed through the real `loadRecipeRunByRuns` and the real panel script. The run has 1,000 objects in 100 trees of 10, with 12 fields each and a third of them 15-value picklists, so 12,000 fields, and 500 data sets. Times are medians of 7. Panel times come from the test harness's fake DOM, not a browser, so compare them with each other rather than with a real webview.

| after ▶ Run Faker or a tree insert | before: reload | after: `datasetAdded` |
|---|---|---|
| host work | 235 ms (re-read the run) | 0.24 ms (read one data set) |
| posted to the panel | 3.40 MB | 862 bytes (with an insert result) |
| panel draw | 142 ms | 0.05 ms |

The reload's cost did not stop there: it also re-listed the orgs, re-connected, re-asked the org whether it is a sandbox and re-checked every object's readiness. None of that happens now.

## [3.59.0] - Recipe Cockpit: one Treecipe tab with per-object counts and a whole-tree insert; the comparison becomes a Compare tab

Closes [#255](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/255), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173). Supersedes the count editor of [#151](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/151).

Building a data set for one relationship tree took two tabs: **Structure** decided what was generated, and **Data-by-Org**'s **+ Create** inserted one object at a time, with required lookups filled from random existing Ids. There was no way to say "5 Accounts, 3 Contacts each, into this sandbox" in one place.

- **A card's tabs are now Treecipe · Compare · Previous Versions · Previous Fake Sets**, with Treecipe selected (`RECIPE_COCKPIT_TREE_TABS` is `['treecipe', 'compare', 'versions', 'datasets']`). No `structure` or `dataByOrg` tab is drawn.
- **The top of the Treecipe tab** holds, in order:
  - **Choose org…**, moved out of the toolbar. It is still one panel-wide selection, drawn in every card's Treecipe tab with its type label, ⟳ and **+ New scratch org**. It uses the same `dataOrgList` / `selectDataOrg {orgIndex}` protocol and lists only `listDataOrgDetails` orgs. It asks for its orgs the first time a Treecipe tab is opened or the picker is used, never on panel open and never from a restored place.
  - **▶ Run Faker**, **Reset selection** and **Regenerate recipe**, moved here from the card header and from beside the comparison. The rules for when they are enabled, their in-flight state and their modals are unchanged. Regenerate is now routed for any card on screen with an object, and no longer needs a comparison first. Beside it, a note says it regenerates from this workspace's metadata, not the org.
  - **Generate fake data and insert into \<org\>**.
  - Below that, the Structure tree itself, unchanged.
- **The card header** keeps ▸, the title, ✎, ☆ and its counts, and nothing else.
- **A count box right of each object's name.**
  - **What it means:** a root object's box is its record count. A nested faker-js friend's box is labelled `per <Parent>`, because `count` there is records per parent record. A snowfakery card's boxes are plain counts. Every box starts at the recipe's own `count`, which the object model now carries as `recordCount`, along with `countParentObjectApiName`.
  - **What it accepts:** only safe whole numbers of 1 or more, checked in the panel and again on the host. `0`, `-1`, `2.5`, `1e2`, an empty value, `" 5 "` and a value past `Number.MAX_SAFE_INTEGER` are refused, with the reason on the row, and nothing is stored.
  - **Message:** `setObjectCount {treeKey, objectApiName, nickname?, count}`, matched against `selectableObjectKeys`. A forged key or count writes nothing.
  - **Storage:** beside the #219/#220 selection in `workspaceState`, now version 3, which adds `objectCountsByFolderName` (folder → object → count). It is written with `Object.fromEntries`, and every name is checked with `SalesforceApiName` on read. A version 1 or 2 entry reads as "no count changed". A count equal to the recipe's own is not stored, so a card with no stored count posts and generates exactly as before.
  - **Disabled and hidden boxes:** an excluded object's box is disabled, and re-including the object brings its stored count back. An object marked `hasIndistinctOccurrences` draws no box.
  - **Reset selection** also clears the folder's counts, and its modal says so.
- **Counts never touch the recipe file.**
  - **The filtered copy:** `RecipeCockpitRecipeWriter.buildFilteredRecipe` takes `objectCountsByObject` and writes each count on the `count:` line of the object's first occurrence, at that object's own `friends:` depth. The copy is refused unless it reads back with exactly those counts. The header comment says `with counts: Account 5`. The result lists `appliedCounts`.
  - **Who uses it:** ▶ Run Faker and the insert generate from that copy.
  - **What is recorded:** `datasetSource.json` records `objectCountsByObject`, only when there are any. `treecipe.runFakerByRecipe` accepts a copy whose only change is a count.
- **Generate fake data and insert into \<org\>** generates the tree with the card's selection and counts, exactly as ▶ Run Faker does, through the same command with its own modal already answered. Then it inserts every object **parents first**.
  - **Sandbox and scratch only.** It is offered only while an org whose Organization row answered `IsSandbox: true` is selected and every object the tree inserts is ready for it. It posts only `{treeKey}`, matched against `insertableTreeKeys`, a pending/active allow-list. After the modal, the host asks the Organization row again on the connection it inserts with, and refuses before any folder is written if the answer is not a sandbox.
  - **The modal** lists each object with its total record count, for example `Contact: 6 (3 per Account)`. Past `RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD` (2,000 records, ten requests) it warns that the run will take time, and names the total and the number of Collections API requests. Cancel generates and writes nothing.
  - **One insert for every command.** The insert is the one Insert Data Set by Directory uses, now `CollectionsApiService.insertDataSetFolderIntoOrg`, with the same all-or-none question and the same `InsertAttempts/` results file. Cancel, or an all-or-none failure, rolls back what the insert saved (`deletePreviouslySavedRecords`).
  - **Progress:** the cancellable progress notification now names each file and each insert round (`Inserting Contact: round 1 of 2`), and a cancel stops between rounds too, for Insert Data Set as well.
  - **Lookups:** a child's lookup that already names a record of the same run is kept. Any other lookup to a parent the tree inserts (a snowfakery `### TODO`) is pointed at a random parent record inserted in the same run. A required lookup to an object outside the tree gets a random existing record of that object, and the insert is refused before anything is written when the org has none. Any other lookup is left blank. The rules are `RecipeCockpitRecordCreation.prepareTreeInsertRecords` and `findTreeInsertLookups`.
  - **A request that throws** (a dropped connection, an expired session, a limit) now stops the insert at that file, for Insert Data Set as well, instead of carrying on and reporting success. Under all-or-none what was saved is deleted; otherwise it is kept and the cockpit says so. A cancel arriving with an all-or-none failure is rolled back once, not twice. While an insert runs, the host refuses Run Faker and any org listing or selection, so the org it confirmed cannot change under it.
  - **Results:** a partial failure keeps what was inserted. **View errors** opens the results file. The panel reloads onto the card's Treecipe tab however the insert ended, once a data set folder exists.
- **The parent picker from 3.58.0 (#254) moves into the insert.** After the confirmation, each lookup in an inserted object's block that points at exactly one object the tree does **not** insert (or one it excludes) gets its own searchable picker, as + Create gave it: **Random parent**, the parent records you search for (given out round-robin across the records), or **Leave blank** for an optional lookup. Cancelling any picker generates and inserts nothing. Only Ids that lookup's own search returned are written. A required lookup to an outside parent that the block does not carry still gets a random existing record. A lookup to a parent the tree inserts never asks: it is wired to that run's records. The tree insert writes a `runFaker` data set, so `lookupParentsByField` is not recorded for it.
- **Data-by-Org's per-object + Create is removed**, with its count input, the `createRecords` message, `creatableObjectKeys`, the per-object block cut and `CollectionsApiService.insertRecordsWithoutRollback`. Readiness per tree and object (#210) is unchanged, and is now what decides the tree's insert.
- **The Compare tab holds only the metadata comparison:** Compare with an org…, Choose another org…, the status filter, progress, the summary and the field-diff rows, moved as they were, with the same org resolution, payloads and replay. A comparison answered for a card whose Compare tab never opened is drawn when it opens. It sends only describes and the Organization query.
- **Saved places:** the place shape is now version 2. A version 1 place, from `setState` or `workspaceState`, is read through `RECIPE_COCKPIT_TREE_TAB_RENAMES`: `structure` opens the Treecipe tab, and `dataByOrg` opens Compare with its status filter and opened rows. Every reload that focused `structure` or `dataByOrg` now focuses `treecipe`.
- **Run Faker by Recipe** resolves to the data set folder it wrote, so the insert inserts exactly what was generated. `CollectionsApiService.createCollectionsApiFile` now writes synchronously, so the files are on disk when generation returns.

## [3.58.0] - Recipe Cockpit Create: search for and pick each lookup's parent records, or choose Random

Closes [#254](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/254), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Data-by-Org **+ Create** always gave each new record a random existing parent, so putting new Contacts under the Account you were testing with meant fixing their lookups by hand in the org. You can now search for and pick the parents.

- **One picker per lookup in the cut recipe block.** After the Create confirmation, and before anything is written, the host opens a searchable quick pick for each lookup of the block the describe says points at exactly one object and can be written (`RecipeCockpitRecordCreation.findPickableLookups`), in the block's order. A polymorphic lookup (`WhoId`) gets no picker: a required one still blocks Create and an optional one is still left blank. A required lookup the block does not carry still gets a random parent, as before.
- **Nothing is chosen for you.** A required lookup's picker offers **Random parent** first, and an optional lookup's picker offers **Leave blank** and then **Random parent**. Nothing starts checked. Accepting with nothing checked, or dismissing the picker, cancels the Create: no data set folder, no file, no insert, and no later picker opens. A warning says which lookup had no parent chosen, since pressing Enter on a row that is only highlighted checks nothing.
- **VS Code's own check-all** checks every listed record, never Random or Leave blank. While a search's status lines are drawn as separator rows, they are also shown in the picker's title, because a separator can be hidden while the input filters.
- **Random parent** clears the search and keeps it cleared while it stays checked. It is today's behaviour: a random Id from `SELECT Id FROM <Parent> LIMIT 2000` per record, and the Create is refused when the parent has no records. Random now applies to an optional lookup too, when you check it.
- **Typing searches** the parent's name field, the one its describe marks `nameField` (`Name` for Account, `CaseNumber` for Case), after a short pause. Only the newest search is drawn. Matches are listed by name and Id, at most 200 (`ORG_PARENT_SEARCH_RESULT_LIMIT`; past that the picker says to refine the search). A search with no matches says so. Check one or several, or **Select all matches**. Records checked in an earlier search stay checked.
- **Several parents are assigned round-robin**: record *i* gets parent *i mod K*, in the order checked (`assignLookupIds` with `assignment: 'roundRobin'`).
- **The search is built safely** (`SalesforceOrgService.buildParentSearchQuery`): the object and name field must be api names, `\`, `'`, `"`, `%` and `_` are escaped so they match literally, and text carrying a control character, U+2028 or U+2029 is refused rather than sent. The query asks for records, never a `COUNT()`.
- **Only Ids the picker's own search returned are written.** Each returned Id is type-checked as a Salesforce Id when the search answers, and checked again against that lookup's search results (`areChosenParentIdsReturnedBySearch`) before it goes into a record. Anything else refuses the Create before anything is written.
- **A parent that cannot be searched**, because its describe marks no name field or it could not be described, gets a picker offering Random (and Leave blank) only, saying why.
- **The production guards are unchanged.** Sandbox and scratch orgs only, the org type asked again on the insert connection, and the org selection compared again after the confirmation and again after the last picker closes.
- **What was chosen is recorded.** The Create confirmation lists the lookups you will be asked about. `datasetSource.json` gains `lookupParentsByField` on a `createInOrg` data set: `"random"`, `"blank"` or the chosen Ids for each lookup. It is optional and read back type-checked with no prototype.
- **The search runs on the host.** The panel's `createRecords` message is unchanged, so no record Id or search text ever comes from the panel.
- Chosen parents are not remembered between Creates.

## [3.57.0] - Insert Data Set by Directory refuses a production org

Closes [#204](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/204), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Insert Data Set by Directory offered every connected org, production included, and the only thing in the way was the picker's placeholder, "DO NOT USE A PRODUCTION ORG". The Recipe Cockpit's **Insert…** on a Previous Fake Set runs the same command, so it had the same gap.

- **The org is asked what it is, on the connection the insert uses.** Right after the org is picked, the command connects once and sends `SELECT IsSandbox, OrganizationType FROM Organization` (`SalesforceOrgService.queryOrganizationType`) before anything else: before the AllOrNone question, the record-type query and any Collections API request.
- **What is allowed** (`SalesforceOrgService.isOrgTypeAllowedForDataSetInsert`, pure): `IsSandbox === true` (a sandbox or a scratch org), or `IsSandbox === false` with `OrganizationType` exactly `"Developer Edition"` (`DEVELOPER_EDITION_ORGANIZATION_TYPE`). A case or whitespace variant is refused.
- **Everything else is refused, failing closed:** production of any other edition, an empty `OrganizationType`, and an answer that could not be read (the query threw, returned no rows or two rows, or carried a non-boolean `IsSandbox` or a non-string `OrganizationType`).
- **A refusal** is a warning naming the org (`alias (username)`, or the username alone) and its type (`buildOrgTypeLabel`: `Production · Enterprise Edition`, or `type unknown`), each through `escapeForNotification`. The command then ends: no AllOrNone question, no record-type query, no Collections API request, no `InsertAttempts/` folder. There is no override.
- **An allowed org** goes on exactly as before.
- **The picker** still lists every org the CLI reports connected (#201), because the CLI's local data cannot tell a Developer Edition org from production. Its placeholder (`INSERT_DATA_SET_ORG_PICKER_PLACEHOLDER`) now says production orgs are refused. `CollectionsApiService.getExpectedSalesforceOrgToInsertAgainst` returns the picked org's detail rather than its username, so the warning can name the alias; the connection is still opened by username.
- **The same check runs** whether the folder came from the folder picker or from the cockpit's **Insert…**.
- **Unchanged.** Data-by-Org's Create still requires `IsSandbox: true` and so still refuses a Developer Edition org.

## [3.56.0] - Recipe Cockpit: untick the fields of an object that the faker generates

Closes [#220](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/220), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173). Saving a selection under a name to reuse it is tracked in [#250](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/250).

An object's recipe always generated every field it lists, so leaving fields out of one data set meant commenting out YAML by hand. You can now untick fields on a card's Structure tab. The recipe file is never written.

- **A checkbox on each field row.** It appears on every field that has a line in the recipe, on a card with a folder. It is a real `<button role="checkbox">` with `aria-checked`, a title and a ✓ mark. Every field starts ticked. **All** and **None** sit at the top of the expanded object. A self-lookup's iteration (#188) draws its boxes disabled, because it follows its object. The ungrouped card draws none.
- **An unticked row is greyed** by the same translucent layer #219 uses for an excluded object (`.fieldExcluded`, `--sdt-excluded-overlay`). Picklist values and `↗ yml` still work under it. The checkbox and the row's note sit above the layer, so they are not dimmed. No new colour token or text/background pair was added.
- **Fields that cannot be unticked** are drawn disabled, with the reason in the title and as a note on the row:
  - `parent excluded`: a lookup whose parent #219 excluded. It is left out by the object cascade, so it is drawn unticked.
  - `record-type sections depend on it`: the `RecordTypeId` line, while another field of the object carries a `### TODO: -- RecordType Options --` section. This answers the issue's open question. Unticking it is allowed once no section depends on it.
  - `controls <Dependent>`: a controlling field while any of its dependent picklists is ticked. A `when:` naming a field the record does not have chooses nothing. Untick the dependents (or press **None**) and the controlling field is free. A chain (Country → State → City) is followed to the end.
- **An excluded object's fields are read-only**: every box and All / None is disabled.
- **Unticking every field keeps the object.** It still generates records, with no fields set, and its row says `every field unticked — records are generated with no fields set`. The filtered copy then drops the object's `fields:` line too, because a `fields:` with nothing under it loads as `null`, which snowfakery does not read as "no fields".
- **`required in <org>`**: once a card has been compared with an org, an unticked field that the describe marks required (not nillable, createable, not defaulted on create) says so on its row. Generation is not blocked. A failed connection clears it.
- **Reset selection.** A card with a folder shows a **Reset selection** button in its header while it leaves something out. After a modal confirmation, it includes every object and ticks every field of that card's folder again. This answers the issue's second open question.
- **What generation sees**
  - **▶ Run Faker** builds the filtered copy (#219) whenever the card excludes an object *or* unticks a field. `RecipeCockpitRecipeWriter.buildFilteredRecipe` takes `excludedFieldApiNamesByObject` and drops each unticked field's own line and its continuation lines from every kept occurrence of its object, the self-lookup iteration included. Everything else stays byte-identical, line endings included. This holds for nested faker-js friends at any depth and for flat snowfakery.
  - **The copy's header comment** names what it left out, for example `leaving out: Opportunity; fields Account.Phone`.
  - **Read-back:** the copy is refused unless it reads back with none of the unticked fields.
  - **Names are checked:** a field or object name that is not an api name is refused before anything is written.
  - **An unticked lookup of a moved friend** is dropped rather than re-wired to its new parent.
  - **Tests** run the copy through the faker-js processor (the records lack exactly the unticked fields, and an object with every field unticked still has records) and through the snowfakery processor and PyYAML.
- **Data-by-Org Create sends only the ticked fields.**
  - **The cut:** `extractObjectBlock` leaves the unticked fields out.
  - **Readiness (#210)** checks only the fields the cut keeps. Unticking a field the org lacks clears that reason.
  - **The cut with every field unticked** also drops its `fields:` line, as the filtered copy does.
  - **Required fields:** an unticked field the org requires is a reason of its own: `Contact has 1 unticked field this org requires: LastName. Tick it in Structure to create records.` Without it every record would fail. A required lookup is never this reason, because Create fills every required lookup with a parent Id whether or not it is ticked.
  - **The modal** lists the unticked fields.
  - **A change to a card's selection re-checks only that folder's Create targets**, against the org type the selection already answered and the session's describe cache. It connects only for an object the cache does not hold, and asks the Organization row nothing. An answer for a selection, model or request the reader has moved on from is dropped, and the panel merges the rest by key, so other cards' rows do not flicker.
- **Stored with #219's selection** in `workspaceState` (`treecipe.recipeCockpit.objectSelection`), now version 2, which adds `excludedFieldApiNamesByFolderName` (tree folder → object → fields). A version 1 entry still reads, as nothing unticked. Every name is checked with `SalesforceApiName` on read. The map is written with `Object.fromEntries`, so a folder or object named `__proto__` is a key and never a prototype. A stale name is dropped silently when the selection is applied. #219's `writeObjectSelections` keeps whatever fields are stored.
- **Recorded in `datasetSource.json`** as `excludedFieldApiNamesByObject` (object → fields), absent when nothing was unticked and in every older file. `DatasetSourceService` type-checks it and reads it back with no prototype. `treecipe.runFakerByRecipe` accepts the copy's new `excludedFieldApiNamesByObject` only as an object of api names, and now accepts a copy that excludes no object as long as it unticks a field.
- **The messages are gated like every other panel action.**
  - **One checkbox:** the panel posts `setFieldIncluded {treeKey, objectApiName, nickname?, fieldApiName, included}`, matched against `selectableFieldKeys`. That list is pending/active, built at post, promoted on `rendered`, and emptied on `ready`, a new post and a failure to draw. A field name is only ever matched, never written raw.
  - **All / None:** posts `setAllFieldsIncluded {treeKey, objectApiName, nickname?, included}`, matched against #219's `selectableObjectKeys`.
  - **Reset:** posts `resetTreeSelection {treeKey}`, matched against the cards with a folder.
  - **The host decides:** it re-derives the card's state before it writes anything, so a message for a locked field or an excluded object changes nothing. It posts `objectSelection` with a new `fieldSelection` beside `objectSelection`, and the panel redraws the card in place.
- **What is posted.** A card carries `fieldSelection` only when one of its objects has a field unticked or locked, and only those objects are listed. A card with a dependent picklist therefore now carries its controlling field's lock. `orgDescribe` carries `requiredFields` (only objects with any). The object model carries `hasRecordTypeSections` only where it is true.
- **Re-measured** (synthetic models through the real `applyObjectSelections` and `collectTreeHistoryAllowLists`):

  | Shape | Applying selections | Allow-lists | `fieldSelection` posted |
  |---|---|---|---|
  | 11,000 single-object cards, 121,000 fields, every object with record-type sections and a dependent picklist every fourth field | 144 ms | 175 ms | 3.18 MB, about 5% on the 59.94 MB model measured in 3.31.0 |
  | Same, with no locks | 119 ms | 162 ms | 0.06 MB |

  - **`selectableFieldKeys`** holds 121,000 keys, about 11–14 MB of heap.
  - **A click** recomputes only its folder's cards, which takes under 1 ms.

## [3.55.0] - The Recipe Cockpit asks which Dev Hub a new scratch org comes from

Closes [#243](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/243).

**+ New scratch org** used the Salesforce CLI's default Dev Hub (`target-dev-hub`) without asking. The only place it said which Dev Hub that was, was one line of the confirmation, so a reader could spend a Dev Hub's daily and active scratch org limits without knowing whose they were.

- **A Dev Hub quick pick** now opens after the project is checked and before the confirmation. It opens even when only one Dev Hub qualifies. It is the same busy quick pick as the other org pickers: nothing can be selected until the Salesforce CLI has answered.
- **Which Dev Hubs it lists.** Only authorizations whose `isDevHub` is exactly `true` (a missing, string or `false` value is left out) and that `sf org list` reports as connected. A Dev Hub whose username could not be handed to `--target-dev-hub` is never offered, even if its alias is usable. If a cached answer leaves none, the CLI is asked once more, so a Dev Hub you just re-authorized is listed. If the CLI cannot answer, nothing is listed: it never falls back to listing every authorization unchecked.
- **The CLI's default Dev Hub** is listed first and labelled **(default)**. It is never chosen for you. The confirmation says where that setting came from ("the Salesforce CLI's default, set by …") only when you picked it. Any other Dev Hub is named by its alias and username alone.
- **`--target-dev-hub` is the picked Dev Hub's username**, not its alias, because an alias can be re-pointed between the pick and the run.
- **Dismissing the quick pick** cancels quietly: no confirmation, no CLI process, no result file, and the button is enabled again.
- **With no connected Dev Hub**, the quick pick closes and says why, naming `sf org login web --set-default-dev-hub`. If some Dev Hubs were left out, it says how many and why (expired, deleted, not connected).
- **The project is checked first.** A missing `sfdx-project.json` or `config/project-scratch-def.json` refuses before the quick pick opens.
- **Code changes:**
  - `SalesforceOrgService.resolveDefaultDevHub` and `NO_DEFAULT_DEV_HUB_MESSAGE` are replaced by `listDevHubOrgDetails` and `listDevHubOrgDetailsForPicker`. `readDefaultDevHubIdentifier` is unchanged.
  - `ScratchOrgService.resolveScratchOrgPlan` takes the Dev Hub chooser and answers `undefined` when no Dev Hub is chosen.
  - `VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed` is now generic over the org detail it returns, and a listing may name a `defaultUsername` to label.
- **Unchanged.** The panel's `createScratchOrg` message still carries nothing, the picker is the host's, and the cockpit still never deletes an org. The tooltip, the preview warning and the README now say you pick the Dev Hub.

## [3.54.0] - Recipe Cockpit: a tree icon includes or excludes an object and its children from generation

Closes [#219](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/219), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

To leave a branch of a relationship tree out of ▶ Run Faker, you had to hand-edit nested YAML or delete recipe blocks, and that edit could not be undone cleanly. You can now switch an object off on its card's Structure tab. Its children follow, and the recipe file is never written.

- **A tree icon before each object's name** on the Structure tab. It is a real `<button>` with `aria-pressed` and a title, and it never expands or collapses the row. The icon is one small tree drawn as **inline SVG** by the panel script (`createElementNS`, one `<path>`, `RECIPE_COCKPIT_TREE_GLYPH_PATH`), coloured by CSS from the palette only. It is the cockpit's first SVG glyph. It fetches nothing, so the CSP, the nonce-only shell builder and `localResourceRoots: []` are unchanged. The three states are told apart by shape, `aria-pressed`, title and label, never by colour alone:
  - **Included:** filled in `--sdt-accent`, `aria-pressed="true"`, title `Included — click to exclude`.
  - **Excluded** by the reader: an outline in `--sdt-muted`, `aria-pressed="false"`, title `Excluded — click to include`, labelled `excluded`.
  - **Auto-excluded:** a dashed outline, `disabled`, title `Excluded because parent <Object> is excluded`, labelled `auto-excluded — parent <Object> excluded`.
- **The cascade is computed on the host** (`RecipeCockpitObjectSelection`, a new file that imports nothing) and posted to the panel, so the panel never decides what is generated.
  - Excluding an object also excludes every descendant with no other included parent in the same tree.
  - Including the parent again brings back exactly what it auto-excluded. Objects you excluded yourself stay excluded.
  - Only objects with a recipe take part. A lookup target the tree lists but never generates (such as `User`) does not count as an "included parent" that would keep a child included.
  - A descendant that still has another included parent stays included. Its lookup to the excluded parent is drawn as `AccountId → Opportunity · parent excluded` and left out of what is generated.
  - A self-lookup is never "another parent", and an object's `<Object>_child_NickName` iteration (#188) follows it and gets no icon of its own.
  - Excluding a tree's only root is allowed. ▶ Run Faker then refuses, because nothing is left to generate.
- **Excluded rows are dimmed, not hidden.** An excluded or auto-excluded row, and its field rows when expanded, are covered by a gray translucent layer: the new palette token `--sdt-excluded-overlay` (`rgba(148, 163, 184, 0.40)`), drawn by the `.excluded` class (`::after`, `pointer-events: none`) and never by inline style. The row can still be expanded, read, searched and scrolled. The tree icon sits above the layer, crisp and clickable.
  - **Measured contrast:** `--sdt-text` under the overlay is 10.44:1 on the surface and 9.85:1 on the hover, well above 4.5:1 (the issue's 5.01:1 was a lower estimate). Muted text under it falls to about 4:1. The overlay appears and disappears instantly until #227's motion lands.
- **The header reads `1 of 3 objects`** when anything in the card is excluded. The count is over the objects the card draws (those with a recipe), so a lookup target with no recipe, such as `User`, is not counted.
- **Scale.** The cascade, the allow-list and the panel's redraw are linear in the tree. The object-name map is built once per model rather than once per card, which measured about 30 s of blocking at 11,000 single-object cards. Children are appended in place rather than copied, the panel indexes exclusions once per draw, and tests hold the 11,000-card load and a 30,000-child root to a time budget.
- **The selection is kept per tree folder name** in `workspaceState` (`treecipe.recipeCockpit.objectSelection`, version 1). Only what you excluded directly is stored. It survives closing the panel, a reload and a regeneration that writes the same folder. A tree or object no longer in the run is dropped silently, and the ungrouped card, which has no folder, draws no icon.
- **The toggle is gated like every other panel action.** The panel posts `setObjectIncluded {treeKey, objectApiName, nickname?, included}`, matched against `selectableObjectKeys`: a pending/active list built at post, promoted on `rendered`, and emptied on `ready`, a new post and a failure to draw. A nickname, when sent, must be the one the object is drawn with. An object written twice with no nickname to tell the occurrences apart (`hasIndistinctOccurrences`, from `parseRecipeSource`) gets a disabled icon whose title says why, and the host refuses its toggle. The host writes the selection, updates the stored model, and posts `objectSelection` tagged with its `renderSequence`. The panel redraws that card in place.
- **What generation sees**
  - **▶ Run Faker on a card with exclusions generates from a filtered copy, not the recipe.** `RecipeCockpitRecipeWriter.buildFilteredRecipe` (still pure, still no imports) drops each excluded object's block, header comment included, along with every later occurrence nested under it.
  - **The rest of the copy matches the recipe byte for byte**, line endings included, apart from these changes:
    - A comment line at the top names what was left out.
    - A kept object's lookups that point at an excluded object are left out. They are found through the wrapper's lookups, or by a value that is exactly an excluded occurrence's nickname.
    - A `friends:` block left empty is dropped.
  - **faker-js (nested):** a kept friend whose `friends:` parent was excluded moves, with everything under it, under its closest remaining parent that has a recipe. That is the #46 rule: deepest level by RelationshipService's levels (now read from the wrapper), ties broken by `<`, and only a parent at a strictly lower level, never one of its own friends. Its lookup to that parent is written as the parent's nickname, so `count` still means records per parent record. If no parent qualifies, it moves to the top level and its remaining lookups resolve by nickname (#189).
  - **snowfakery (flat):** excluded blocks and the lookup lines that point at them are dropped.
  - **Read-back:** the copy is read back through `scanRecipeObjects` and refused unless it reads as exactly the kept occurrences, nested where intended.
  - **Refusals:** a recipe that cannot be read, scanned or cut, a move that would close a loop (possible only with a hand-edited wrapper), a line that cannot be re-indented exactly (a lone CR, U+0085, U+2028 or U+2029), or nothing left to generate. Each makes Run Faker refuse with a warning naming the tree (`Run Faker did not run on <tree>: …`) instead of generating the whole tree.
  - **A card with nothing excluded** runs `treecipe.runFakerByRecipe` with only its recipe path, exactly as before.
- **`runFakerGenerationByRecipeFile(recipeFilePath, filteredRecipe?)`** takes the copy as `{ recipeText, excludedObjectApiNames }`.
  - **Type-checked, with a path:** the command is callable by id, so the copy is type-checked and accepted only together with a recipe path. Anything else warns and generates nothing.
  - **Loading:** the recipe itself is still loaded first, so a YAML error still opens the recipe at the line to fix.
  - **Generating:** the copy is written to a temporary folder outside the workspace and run through the configured processor unchanged. The modal summarizes the copy.
  - **What the data set keeps:** the copy is saved as `filteredRecipe-<recipe>.yml` in the data set's `BaseArtifactFiles/`, beside `originalRecipe-*`. The temporary folder is removed whether generation succeeds or fails.
- **`datasetSource.json` records `excludedObjectApiNames`** when anything was left out. `DatasetSourceService` type-checks it (a list of strings, or the file is unreadable), and a file written before this version reads exactly as before. `excludedFieldApiNamesByObject` waits for #220.
- **Data-by-Org Create on an excluded object is disabled** with the reason `excluded in Structure`, and the host refuses a `createRecords` for it whatever the panel posts. Including the object again gives Create back without a new readiness check.
- **Not changed:**
  - The recipe `.yml`, which is never written.
  - Insert Data Set by Directory.
  - The cockpit's text glyphs (▸, ▶).
  - Structure rows carry no generation control yet, so nothing on them takes `aria-disabled`. Count editing (#151) should disable its input for an excluded object when it lands.
- **Tests**
  - **`RecipeCockpitRecipeFilter.test.ts`** covers the filtered copy:
    - byte fidelity and CRLF;
    - moves, wiring, the closest-parent rule, moves to the top level, self-lookup iterations and emptied `friends:`;
    - every refusal;
    - faker-js: the copy runs through the real `FakerJSRecipeProcessor`, with no record of or reference to an excluded object;
    - snowfakery: the copy is handed to `SnowfakeryRecipeProcessor` as the file it runs (with `execFile` stubbed, since the CI image has no snowfakery) and loaded in PyYAML through the `PythonTestHarness` gate.
  - **`RecipeCockpitObjectSelection.test.ts`** covers the cascade, re-including, more than one parent, self-lookups, cycles, and parents outside the tree.
  - **`RecipeCockpitExcludeObjects.test.ts`** covers:
    - the store, the allow-list and the router;
    - Create refusals;
    - Run Faker with and without exclusions, and its refusals;
    - `runPanelScript` drawing the three icon states (`aria-pressed`, `disabled`, title), the overlay class, the icon outside the row body, the header count, disabled lookups, iteration rows and the Create reason.
  - **`RecipeCockpitService.test.ts`** composites the overlay over `--sdt-surface` and `--sdt-row-hover`, holds the icon's colours to 3:1 on both, and pins the CSS. Its external-asset check now allows exactly one URL, the SVG namespace, which `createElementNS` uses as a name and never fetches.
  - **Also:** `ExtensionCommandService.test.ts` and `DatasetSourceService.test.ts` cover the filtered copy and the new field. The panel harness gains `createElementNS`.
## [3.53.1] - Recipe Cockpit: bigger expand/collapse triangles on the relationship tree

Closes [#244](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/244).

At `1.1em` the ▸/▾ on the relationship tree was too small to tell at a glance whether a card or object was open.

- **The tree card header triangle (`.treeToggle`) and each Structure object's triangle (`.treeObjectToggle`) are drawn at `3.3em`**, about three times their old size. They have their own rule after the shared toggle rule, with less vertical padding so the larger glyph doesn't make the row taller than it needs to be.
- **A Structure object's header row centres its items** (`align-items: center`) instead of aligning them on the baseline, so the object name sits beside the larger triangle rather than at its foot. The card header was already centred, so the title, ☆, ✎ and ▶ Run Faker stay on one centred line.
- **Not changed:** the ▸/▾ characters, the click behaviour (the card header is still the toggle and the triangle still has no listener of its own, #209), the colours, which still come only from `RECIPE_COCKPIT_PALETTE`, and the picklist, Previous Versions and Data-by-Org triangles and ⟳, which stay at `1.1em`.
- **Tests.** `RecipeCockpitService.test.ts` asserts the `3.3em` rule for the two triangles, that it comes after the shared `1.1em` toggle rule (so the cascade picks it), that no other rule uses `3.3em`, and that both header rows centre their items.
## [3.53.0] - Recipe Cockpit Data-by-Org no longer counts records

Closes [#238](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/238), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Data-by-Org ran `SELECT COUNT() FROM <Object>` across the whole org for every object in every tree. Those numbers did not describe a tree's data: a Contact count included every Contact in the org, not only the ones under that tree's Accounts. A tree-scoped view of org data will be designed separately, so the org-wide counts are removed rather than refined.

- **No record count is drawn or queried.** Rows no longer show a count, `not in org`, `no access` or `counting…`, and a card's Data-by-Org header shows only its object count (`3 objects`, or `3 objects · choose an org in the toolbar to create records` before an org is picked). The `Counted N of M objects…` progress is gone. The status line reads `Checking <org>…` until the org's Create readiness arrives.
- **Picking an org asks only what Create needs:** the Organization row (is it a sandbox?) and, for a sandbox, each object's describe. A connection failure, or an org that answers it is not a sandbox, now travels on `dataOrgSelection` as `failureMessage`. It stays on screen, and every row's Create reason says nothing is created in that org, instead of waiting on a readiness that never comes.
- **Create no longer counts parents.** Readiness no longer refuses an object whose required parent has 0 records, or could not be counted, and the modal names each required lookup's parent without a number. The check that matters still happens: after you confirm, Create queries the parent Ids, and if a required parent has none it stops before any folder or file is written or any insert is sent, and names the parent to fill first. Every other readiness reason is unchanged: org type, sandbox, describe, createable, polymorphic required lookup, and missing or uncreateable recipe fields. So is the production guard at all three points.
- **⟳ now posts `refreshDataOrgs`** (was `refreshDataOrgCounts`). It still asks the CLI again which orgs are connected and re-selects the remembered org.
- **Removed:** `SalesforceOrgService.countRecords`, `readTotalSize`, `classifyCountFailure`, the record-count session cache and its clear helpers, the `IOrgRecordCount*` / `OrgRecordCountStatus` types, the `dataOrgCounts` host message, `RECIPE_COCKPIT_DATA_ORG_COUNT_POST_BATCH`, `buildDataOrgCountViewModel`, and `parentRecordCount` / `parentRecordCountsByObject` on Create readiness.
- **Not changed:** the record counts in Previous Versions and Previous Fake Sets (read from local data set files) and `datasetSource.json`'s `recordCountsByObject`. The saved panel place has no count in it, so a place saved before this version still restores.
- **Tests.** `RecipeCockpitDataByOrg.test.ts` asserts that selecting, re-selecting and refreshing send only the Organization query and never `COUNT()`, that no `dataOrgCounts` message is posted, that a failure on the selection stays on screen and disables every row's Create, and that no row or header draws a record count. `RecipeCockpitCreateInOrg.test.ts` asserts that no `COUNT()` is sent from select to insert, and that a required parent with no records stops the Create after the confirm, writing nothing. `RecipeCockpitRecordCreation.test.ts` drops the parent-count reasons. `SalesforceOrgService.test.ts` drops the `countRecords` suite. `RecipeCockpitScratchOrg.test.ts` (3.52.0, #200) now asserts that a newly created scratch org is selected and checked for Create with no `COUNT()` and no `dataOrgCounts`.
## [3.52.0] - The Recipe Cockpit creates a scratch org, deploys the project's source to it, and selects it in Data-by-Org

Closes [#200](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/200), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Data-by-Org's **+ Create** needs a non-production org that already has the project's metadata. Getting one meant leaving VS Code for `sf org create scratch` and `sf project deploy start`, then listing the orgs again and picking the new one.

- **+ New scratch org** sits beside the toolbar's org dropdown, which is the one Data-by-Org picker since 3.47.0 (#217). Its message carries nothing. The host decides everything:
  - **Dev Hub:** the Salesforce CLI's default (`target-dev-hub`), read in process from `SF_TARGET_DEV_HUB`, then the project's `.sf/config.json`, then the global `~/.sf/config.json`, and matched to its authorization. None set, or one that is not authorized here, refuses before any process, naming `sf config set target-dev-hub=<alias>`. It is read without the CLI so the confirmation can name it while Cancel still starts no process.
  - **Definition file:** `config/project-scratch-def.json`. A missing file, or one that resolves outside the workspace (`isPathContainedInWorkspace`), refuses before any process.
  - **What is deployed:** every package directory in `sfdx-project.json`, through `sf project deploy start` with no `--source-dir`, run with the workspace as its working directory so the CLI reads that file. A missing or unparseable `sfdx-project.json`, no `packageDirectories`, an entry with no `path`, an absolute path or one outside the workspace refuses before any process (`SfdxProjectService.resolveDeployablePackageDirectoryPaths`).
  - **Alias** `treecipe-<yyyyMMdd-HHmmss>`, **duration** 7 days.
- **A modal confirmation** names the Dev Hub (alias and username), the definition file, the package directories, the alias and the duration. Cancel runs nothing and contacts nothing.
- **Running it.** `sf org create scratch --definition-file <def> --alias <alias> --duration-days 7 --target-dev-hub <hub> --json`, then `sf project deploy start --target-org <alias> --json`, through `execFile` with an argv (the existing `runSalesforceCli`: no shell, except the quoted one Windows' `sf.cmd` needs). No `--ignore-errors`: one failing component rolls the whole deploy back. Progress is a cancellable notification and a status line under the picker (`Creating scratch org…` → `Deploying source…`), replayed to a reloaded document. While it runs, the button, the dropdown, ⟳ and every **+ Create** are disabled, and the host refuses a second run, a Create, an org selection and ⟳ whatever the panel sends. One run at a time per window.
- **The `--json` is untrusted.** A create counts only with `status: 0` and a usable `result.username`; a deploy only with `status: 0`, `result.success: true` and no `componentFailures`. Anything else, malformed output included, is a failure.
- **When a scratch org was created** — the deploy succeeded, failed or was cancelled — the connected-org cache (#201) is dropped before Data-by-Org lists the orgs again, so a second `sf org list` runs after `sf org create scratch` and the new org is selected **by username** from that fresh answer, remembered in `workspaceState`, counted, and offered **+ Create** once it reports `IsSandbox = true`. If the CLI does not list it yet, nothing else is selected in its place and the status line says so; ⟳ selects it once it is listed.
- **A failed create** shows the CLI's message (escaped through `escapeForNotification`), attempts no deploy, and offers **View output**: the CLI's JSON saved as `treecipe/OrgOperations/<alias>/<timestamp>-scratch-create.json`, since no username exists yet. `sf` not installed (`ENOENT`) says the Salesforce CLI is required and writes nothing.
- **A failed deploy** is an error (`showErrorMessage`, never a warning): `Deploy to <alias> failed — N component failures`, with **View output** opening `treecipe/OrgOperations/<username>/<timestamp>-scratch-deploy.json`. The scratch org is kept, listed and selected, and the status line says it has none of the project's metadata until a deploy succeeds.
- **Cancel** kills the CLI process. During the create, the panel says a scratch org may still have been created (`sf org list`); during the deploy, the org is kept, listed and selected, and the panel says the deploy stopped partway.
- **View output opens only the file this run wrote.** The path is built by the host (a username or alias is a folder name only without a separator and not `.` or `..`), checked with `isPathContainedInWorkspace` when built and again when opened, and never read from a panel message.
- **Nothing deletes an org.** No `sf org delete` argv exists anywhere in the source; a test scans for one. Data-by-Org still never lists or connects to production, and **Compare with an org…** and **Insert Data Set by Directory** keep their own pickers.
- The preview warning says Data-by-Org can create a scratch org through the configured Dev Hub. The cockpit still ships behind `recipeCockpitEnabled`, the shell builder still takes only a nonce, and every new line reaches the panel through `postMessage` and `textContent`.
- **`runSalesforceCli` gains a project mode** (`ISalesforceCliProjectOptions`), which the scratch org commands use. Existing callers pass none and are unchanged.
  - It runs with the workspace as the working directory, so the CLI reads `sfdx-project.json`.
  - Because a cloned repository controls that directory, the CLI is run by the **absolute path** of the first `sf` on PATH. Relative and empty PATH entries are skipped, and so is any entry inside the workspace.
  - On Windows, `NoDefaultCurrentDirectoryInExePath=1` stops `cmd.exe` running a `sf.cmd` or `node` committed to the repository.
  - The definition file is passed relative to the workspace, so no absolute path reaches `cmd.exe`'s `%VAR%` expansion.
  - The deploy gets a 256 MB buffer. An answer that still outgrows it is reported as **unconfirmed**, a warning with a `sf project deploy report` hint, never as a CLI that could not start.
- **Saved results are redacted.** A create's answer carries the new org's `authFields` (its access token among them), and `treecipe/` is usually committed. `authFields`, and any key naming a token, password, secret, private key or auth URL, is written as `[redacted by Salesforce Data Treecipe]`. Token-shaped text in output that is not JSON is also redacted. `OrgOperations/` gets a `.gitignore` of `*`. Files are written with `wx`, so a link planted at a result's name is never followed, and an existing `.gitignore` is never overwritten.
- **The confirmation also says what the repository decides:**
  - where the Dev Hub setting came from (environment, this project's config, or the global setting)
  - the definition's edition, admin email and username, since whoever wrote the file may administer the org
  - that `replacements` copy local files or environment variables into the deploy, when they do
  - that the metadata deployed is the repository's
  
  Every value is put on one line, so none can add a line to the modal.
- **The Dev Hub lookup also reads the legacy names:** `SFDX_DEFAULTDEVHUBUSERNAME`, and `defaultdevhubusername` in `.sfdx/sfdx-config.json`, each after its `sf` counterpart. A package directory that does not exist is refused before any org is made.
- **The run is the window's, not the panel's.** A cockpit closed and reopened mid-run starts from the run's state, so its router still refuses another run, Create, org selection, ⟳ and `loadDataOrgs`, and every later state reaches the panel open now. A click the host refuses because a run is going is answered with that run's state. While a run is in flight the panel posts no org listing, and while a Create is in flight the button is disabled.
- **A cancel that lands just as the create succeeds keeps the org.** The create's answer is read before the cancel, so the org is saved, listed and selected. A cancel between the create and the deploy says nothing was deployed.
- **Tests.** `ScratchOrgService.test.ts` covers the alias, the plan and its refusals (no Dev Hub, no definition file, a definition file through a symlink out, a missing or unparseable `sfdx-project.json`), both argv (no `--ignore-errors`, no `--source-dir`), create and deploy parsing (a limit-reached create, a deploy with one component failure among successes, malformed output), the result file paths, a run end to end, `ENOENT`, cancel during each phase, and the source scan for `sf org delete`. `RecipeCockpitScratchOrg.test.ts` covers the router (no payload read, one run at a time, Create, selection and ⟳ refused while running, View output only from the host), the modal and a Cancel that calls no `execFile`, the full run against a faked CLI (argv, the cache refresh and a second `sf org list`, selection by username, `workspaceState`, counts and a ready **+ Create**), a failed deploy as an error with View output, a new org not listed yet, every refusal, `ENOENT`, a failed and a malformed create, cancel in each phase, the replay, and the real panel script (the button and its empty message, the locks, the status line, View output). `SalesforceOrgService.test.ts`, `SfdxProjectService.test.ts` and `PicklistDependencyCheckService.test.ts` cover the Dev Hub lookup, the strict package-directory read and the working directory.
## [3.51.1] - A test that a saved Recipe Cockpit place keeps a run name containing ".."

Follow-up to [#237](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/237) (3.50.1), which closed [#185](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/185), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

3.50.1 relaxed `DatasetSourceService.isSafeFolderOrFileName` to refuse only a name that is exactly `.` or `..` instead of any name containing `..`. The Recipe Cockpit's `normalizePanelPlace` checks a saved place's run name with the same function, so that change applies to it too, but no cockpit test covered it. The code review on #237 [flagged it](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/237#issuecomment-6101369283) as a LOW finding. The fix was pushed after #237 merged, so it never reached `main`.

- **Tests.** `RecipeCockpitPlacePersistence.test.ts` asserts that `normalizePanelPlace` keeps a saved place whose run is `recipe-2026..v2`. A run that is exactly `..` is still refused, as before.
- **Not changed:** no source code changed.

## [3.51.0] - Recipe Cockpit: name a tree card, mark it a favorite, and show only the favorites

Closes [#235](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/235), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Tree cards were titled "Relationship Tree 1, 2, 3…". The number is only the card's position, so it says nothing about the tree and can change between runs.

- **✎ renames a card.** It sits in the card header's action group, before ▶ Run Faker, and does not open or close the card. The panel posts only the card's key (`renameTree {treeKey}`). The host matches it against `nameableTreeKeys`, a new pending/active allow-list in `IRecipeCockpitTreeHistoryAllowLists` that lists every card with a folder. It then asks for the name in its own `showInputBox`, so the panel never posts text to be stored. The box is pre-filled with the card's own name if it has one, and shows the default title as its placeholder.
- **A name is unique and one line.** `validateTreeName` checks the name as it is typed, and again on the stored names when the box closes, because another window of the same workspace may have taken it in the meantime. A name is refused if another folder's stored name or another card's title on screen already has it (compared trimmed and case-insensitively), if it has a line break, control character, U+2028 or U+2029, or if it is longer than `RECIPE_COCKPIT_TREE_NAME_MAX_LENGTH` (80). An empty name clears the card's own name, and the card goes back to "Relationship Tree N". Cancelling the box changes nothing.
- **☆/★ marks a card a favorite** (`toggleFavoriteTree {treeKey}`), gated by the same allow-list.
- **Kept by tree folder name.** Names and favorites are stored in `workspaceState` under `RECIPE_COCKPIT_TREE_PREFERENCES_STATE_KEY` and keyed by the folder Generate Treecipe writes the tree to. Regenerating the same objects writes the same folder, so a name and a star survive a regeneration, a reopen and a window reload. The ungrouped *Not in a relationship tree* card has no folder, so it gets neither button. `readTreePreferences` checks every stored entry on its own, keeps names in a `Map` so a folder named `__proto__` is just another key, and drops a name the input box could not have saved. `applyTreePreferences` puts the name (`customName`) and the star (`isFavorite`) on the posted model, and only on cards that have one. `title` stays the default that a cleared name goes back to. The folder name is still drawn beneath the title.
- **Redrawn in place.** After a write, the host updates the stored model (which every reveal replays) and posts `treePreferences` with the model's `renderSequence`, listing only the cards of the changed folder. The panel redraws their titles and stars without a reload, so open cards, tabs and searches stay as they were. An update for another model is dropped. A write that fails is reported once and the cards are left unchanged.
- **★ Favorites only** in the toolbar shows only favorite cards, along with an "N of M trees" count. The filter runs in the panel only and asks the host nothing. Taking a card off the favorites while the filter is on hides it at once. With no favorites, the panel shows "No favorite trees in this run" rather than an empty page. The filter carries over to a new model in the same document. It is saved in the reader's place (`isFavoritesOnly`), so hiding and showing the tab, reopening the panel and reloading the window all restore it. A place saved before this release has no `isFavoritesOnly` and reads as the filter off, which is what it was, so `RECIPE_COCKPIT_PANEL_PLACE_VERSION` is unchanged and no saved place is thrown away. A `focusTree` naming a card the filter hides (after Regenerate, Run Faker, Create, Add friend or a missing data set) turns the filter off, so the card the reader acted on is visible.
- **Fixes from review, before release:**
  - **Input box prompt:** the folder name and default title in the rename prompt are passed through `escapeForNotification`. VS Code's input box draws `[label](command:…)` in its prompt as a link that runs the command, and a folder name comes from disk.
  - **`__proto__` folder:** the stored names are written with `Object.fromEntries`, so a folder named `__proto__` keeps its name.
  - **Filter with no toggle:** the Favorites only filter applies only while its toggle is drawn, so a model with no tree to mark never hides its cards with no way to turn the filter off.
- **Not done:** a card's Structure search does not match the card's own name. Each search box searches the fields its tab draws, and the card's name is already in its header.
- **Tests.** The new `RecipeCockpitTreePreferences.test.ts` has 50 tests:
  - storage and validation: reading (malformed entries, `__proto__`, other shapes, a throwing `workspaceState`), writing (a `__proto__` folder included) and failed writes, `validateTreeName` (each refusal and each acceptance), `applyTreePreferences` and the update message;
  - routing: `renameTree` and `toggleFavoriteTree` for drawn, undrawn, unknown and ungrouped cards;
  - host behaviour, driven through `openRecipeCockpitPanel`: rename, an escaped prompt, clear, cancel, a name taken while the box was open, favorite on and off across a reload, a failed write;
  - the real panel script: titles and stars, no buttons on the ungrouped card, clicks posting only the key without toggling the card, in-place redraw and the stale-update drop, the filter with its count and empty state, restoring it from `getState` and from the host's place, a pre-#235 place, keeping it across a new model, a model with nothing to mark, and a focus turning it off.

  The existing place tests assert the new `isFavoritesOnly` field, and the header test asserts the action group's order: ☆, ✎, ▶ Run Faker.
## [3.50.2] - Run Faker opens a recipe that will not load at the line to fix

Closes [#232](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/232).

A recipe that was not valid YAML made **Run Faker by Recipe** (and the Recipe Cockpit's ▶ Run Faker) fail inside `yaml.load` and show the GitHub-issue error template with a stack trace, leaving the reader to find the file and count to the line. The usual cause is a recipe generated before v3.29.1 (#153), whose record-type picklist and multi-select picklist variants are bare `${{ … }}` lines under their `### TODO: -- RecordType Options --` comment.

- **The recipe opens at the failing line.** When `yaml.load` throws a `YAMLException`, `runFakerGenerationByRecipeFile` opens the recipe with the cursor on the line and column from the exception's `mark`, centered (`VSCodeWorkspaceService.openFileInEditorAtSelection`), and returns without the error template.
- **A warning names the file, the line, the column and the parser's reason.** The file name and the reason go through `RecipeYamlScalar.escapeForNotification`.
- **A recipe from before v3.29.1 is named as one.** `ExtensionCommandService.findBareRecordTypeVariantLineNumbers` flags each line that opens an expression (`${{`) directly under a `### TODO: -- RecordType Options --` line. The warning says the recipe was generated before v3.29.1, lists those line numbers (the first 20, then how many more), and says to put `# ` in front of each or regenerate. The editor selects the first one. The current pipeline only puts comments and `- ` choice items under such a TODO, and `DirectoryProcessor.generatedRecipeYaml.test.ts` asserts that no file it generates, in either backend, has a flagged line.
- **An error at the very end of a file with no final line break names the file's last line.** js-yaml appends a line break before parsing, so its `mark` can name a line one past the last. The warning and the cursor use the last line, with the cursor at its end.
- **Nothing is written to the recipe.** No data set folder is created either.
- **Both entry points, both backends.** The `yaml.load` runs before either backend, from the palette and from the cockpit. The command returns normally, so the cockpit still reloads focused on Previous Fake Sets with its Run Faker buttons enabled again.
- **Not changed:** any other error (an unreadable file, a missing objects wrapper, a backend failure) is reported through `ErrorHandlingService` exactly as before.
- **Tests.** `ExtensionCommandService/tests/mocks/` holds a pre-3.29.1 recipe per backend (the Recipe Cockpit's current writer fixture with its variants uncommented, which a test pins line for line) and a recipe with an unrelated indentation error. `ExtensionCommandService.test.ts` runs each from the picker and from a recipe file path, and covers the selection, the warning text, the file left unchanged, an unreadable path still reaching the error template, the escaping, the singular and capped line lists, an error at the end of a file with no final line break, and a non-`YAMLException` from `yaml.load` still reaching the error template. The #186 command-link test now asserts the warning instead of the error template. `VSCodeWorkspaceService.test.ts` covers `openFileInEditorAtSelection`.

## [3.50.1] - A recipe whose name merely contains ".." runs again under Run Faker

Closes [#185](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/185), a follow-up to [#176](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/176) / [#183](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/183), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Since 3.30.0, `DatasetSourceService.isSafeFolderOrFileName` refused any name that *contained* `..`, so **Run Faker by Recipe** failed for hand-placed recipes that ran before, such as `GeneratedRecipes/my..recipe.yml` or a recipe under a `team..v2/` folder. A name with no separator can only act as a path when it is exactly `..` or `.`.

- **Exact segments only.** `isSafeFolderOrFileName` now refuses an empty name, a name that is exactly `.` or `..`, and any name with `/` or `\`. `a..b`, `my..recipe.yml` and `..hidden` are accepted.
- **Write side.** Run Faker on `GeneratedRecipes/my..recipe.yml` generates data and records `recipeFileName: "my..recipe.yml"` with a `null` run and tree. A tree folder named `team..v2` is recorded as the tree, and the reader links it.
- **Read side.** A recorded `"../../etc"` is still `unknown` (it has a separator), and so is a recorded `".."`. A recorded `"a..b"` is `linked` only when a run folder with that name is known. Legacy inference applies the same rule to the tree name it reads from the recipe copy.
- **Outside the folder.** A recipe outside `GeneratedRecipes/` still fails before any data is generated: its path relative to the folder starts with a `..` segment. The error still names no part of the path (#183); its wording now says "is not a plain name" instead of "contains \"..\"".
- **The Recipe Cockpit's saved place** reads its run name through the same rule, so a place naming a run with `..` inside its name is read, and the run is still looked up among the runs on disk.
- **Not changed:** what Run Faker accepts outside `GeneratedRecipes/`, and recorded names are still never joined into paths.
- **Tests.** The `isSafeFolderOrFileName` table covers the accepted and refused names. The `DatasetSourceService` fixture gains a `team..v2` tree folder holding `my..recipe.yml`, a data set recording it (`linked`) and a data set recording a `".."` run (`unknown`). New cases cover a recorded `"a..b"` run with and without a matching run, legacy inference of a `team..v2` tree, and a copied tree name of exactly `..`. The command-link refusal test now refuses by a path outside the folder instead of an `a..b` folder. `ExtensionCommandService.test.ts` runs `my..recipe.yml` and a `team..v2` tree through both backends, and asserts the outside-the-folder error names none of `elsewhere`, `team..v2`, `my..recipe.yml` or the workspace root.

## [3.50.0] - The Recipe Cockpit keeps the reader's place when an action reloads the run

Closes [#225](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/225), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Regenerate recipe, ▶ Run Faker, Data-by-Org Create and the self-lookup **+** Add friend each reload the run and redraw every card. 3.48.0 restored the reader's place only on a document's first model, so after any of these actions every other card collapsed, every tab went back to Structure, every search emptied and the scroll went to the top. Only the action's own `focusTree` came back.

- **A later model of the same run keeps the place on screen.** When a model arrives in a document that has already drawn one, and its `selectedRunFolderName` is the run on screen, the panel builds the place from what is on screen before `resetPanelState` clears it (`takeSameRunPlace`, using the same `buildPanelPlace` that `savePanelPlace` uses). It then restores it through the 3.48.0 path: open cards, each card's tab, each tab's search as typed, status filters, opened Structure objects, picklist rows, Data-by-Org rows, expanded versions, and the scroll.
- **Regenerate carries the place to the run it wrote.** A successful Regenerate writes a NEW timestamped run folder, so a match by run name would never keep its place. Its reload posts `carryPlaceAcrossRuns: true` on the posted copy of the model (never the stored one, so a replay to a rebuilt document does not carry it), and the panel takes the place on screen whatever the run name. The cards keep their keys across runs, because a tree key is the tree's folder name. Only a literal `true` counts. The place is then saved under the new run.
- **The action's focus still wins for its own card.** `focusTree` is applied after the restore, so Run Faker lands on Previous Fake Sets, Create on Data-by-Org, and Add friend and Regenerate on Structure, while the other cards stay as the reader left them.
- **Another run starts fresh.** A run switch, or any other reload that lands on another run, restores nothing, as before. So does a model that follows one the panel failed to draw.
- **Entries the new model lacks are skipped one by one.** A tree folder that Regenerate renamed, or an object occurrence under a nickname that changed, is passed over and the rest is restored, without throwing.
- **Nothing new reaches the host.** Picklist values, version summaries and the org listing are still requested only after the new model's `rendered`, through the same pending/active allow-lists. A restored status filter and opened Data-by-Org rows still wait for that card's next `orgDescribe`. The restore saves once, after it finishes.
- **Tests.** `RecipeCockpitPlaceRestore.test.ts` runs the real panel script in one document: draw, open things, post a second model of the same run with and without each action's `focusTree`, and assert the restored DOM and scroll. It also covers Regenerate's marker carrying the place onto a new run name (and only a literal `true`), a reload onto another run, a run switch and back, a model after a failed draw, a renamed tree and nickname, requests ordered after the new `rendered`, a single save, a status filter and opened row waiting for the comparison, and a document whose saved place was already spent. Two `RecipeCockpitService.test.ts` cases that asserted a fresh draw now post another run, and its host tests assert that Regenerate's reload posts the marker, its replay does not, and Run Faker's reload never does.

## [3.49.0] - The Recipe Cockpit brings the reader back to their place after a close or a window reload

Closes [#230](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/230), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

3.48.0 (#222) kept the reader's place while the panel was open, in the webview's own state. That state goes away with the panel, so closing the cockpit or reloading the window (Developer: Reload Window, an extension update, a restart) still put it back to its first-load state.

- **The place is also kept in `workspaceState`**, under one key (`RECIPE_COCKPIT_PANEL_PLACE_STATE_KEY`). It is the same place 3.48.0 saves: the run name, the cards and objects the reader opened, each card's tab, each tab's search as typed, the status filter, the open picklist, Data-by-Org and version rows, whether the toolbar's org picker was in use, and the scroll.
- **Saved as it changes.** Every time the panel saves its place with `setState`, it also posts `savePlace` to the host. The host writes at most once every `RECIPE_COCKPIT_PANEL_PLACE_PERSIST_DELAY` (500 ms), always the latest place. A window reload or a crash may never run `onDidDispose`, so the place does not wait for it. Closing the panel writes a place that is still waiting.
- **The next Open Recipe Cockpit restores it.** A panel opened with nothing to carry over (after a close or a window reload) reads the saved place, loads the run it names, and hands the place to the panel with the model as `restorePlace`. The panel restores it exactly as 3.48.0 restores its own: once, on the document's first model, everything that asks the host only after `rendered`. The place goes on every replay of that model until its `rendered`, because a fresh panel usually says `ready` after its model was stored. A document that has its own `getState` uses that instead, since it is newer. A panel already open keeps its own place and does not read the saved one, unless its first load has not drawn yet (the command run twice), in which case the reload reads the saved place.
- **No automatic reopen.** No `WebviewPanelSerializer` is registered and no `onWebviewPanel:` activation event is added. A window reload leaves the cockpit closed and never loads a run, describes an object or contacts an org on its own. The place comes back only when the reader runs the command, after the same `recipeCockpitEnabled` flag and open-folder gate as always.
- **The saved place is never trusted.** `normalizePanelPlace` type-checks it field by field, both when it is read back and when the panel posts it. A place in another shape, or whose run is not a plain folder name (no separator, no `..`, at most `RECIPE_COCKPIT_PANEL_PLACE_MAX_TEXT_LENGTH` characters), is not read. Inside a valid place, each entry of the wrong type or past a bound is dropped on its own, an unknown tab reads as Structure and an unknown status as *all*. A place whose total size is past `RECIPE_COCKPIT_PANEL_PLACE_MAX_SERIALIZED_LENGTH` (4,000,000 characters, against a few KB for a real place) is not read either, since the per-list bounds multiply. Only the fields the place's shape names are kept, so no path, picklist value, org label or username can be written. The run is a name looked up among the runs on disk, never a path. A place that cannot be read, or whose run is gone (the newest run is loaded instead), is removed from `workspaceState` and the cockpit opens on the newest run as before. A `workspaceState` that throws is treated as holding nothing.
- **Only the drawn run's place is written.** The host accepts `savePlace` only for the run of the model the panel confirmed drawing, so a place posted before `rendered`, or naming another run, is not written. A restored panel sets up the same message subscription and allow-lists as a new one and enables nothing until `rendered`.
- **Not changed:** `retainContextWhenHidden` stays off. The reopen of an open panel (3.48.0) and the Data-by-Org org remembered in the workspace work as before.
- **Tests.** `RecipeCockpitPlacePersistence.test.ts` covers `normalizePanelPlace` (well-formed, malformed, paths, bounds, unknown fields), the total size bound, the `savePlace` route, the command run twice before the first draw, a pending write reaching the `workspaceState` it was saved under, close then reopen with the real panel script on both ends, a simulated window reload (fresh panel, same `workspaceState`, no dispose), the 500 ms throttle, the replay until `rendered`, a deleted run, malformed saved places, a throwing `workspaceState`, a restored panel enabling nothing before `rendered`, an open panel ignoring the saved place, names-only persistence, and the panel preferring its own `getState`. `extension.test.ts` asserts that activation registers no webview panel serializer and that the manifest declares no `onWebviewPanel:` event. `ExtensionCommandService.test.ts` asserts that a saved place is not read when the flag is off or no folder is open.

## [3.48.0] - The Recipe Cockpit keeps the reader's place when its tab is hidden and shown again, or when it is reopened

Closes [#222](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/222).

Switching away from the **Recipe Cockpit** tab and back put the panel back to its first-load state: every card collapsed, every tab back on Structure, every search empty and the scroll at the top. The panel is created without `retainContextWhenHidden` on purpose, so VS Code throws a hidden tab's document away. The host replayed the model on reveal, but nothing the reader had done in the page survived. Running **Open Recipe Cockpit** again on an open panel also loaded the newest run instead of the one the reader had picked, and dropped every comparison.

- **The panel keeps its place with `vscodeApi.setState`.** It saves the run, the scroll offset, whether the toolbar's org picker was in use and, per card: whether the reader opened it, its tab, each tab's search as typed, its status filter, the Structure objects the reader expanded (by api name and nickname, so two occurrences of one object are kept apart), the picklist rows opened, the Data-by-Org rows opened and the Previous Versions rows expanded. It saves names only: no path, no picklist value, no org label or username.
- **Restored once, on the document's first model, and only for the same run.** A rebuilt document reads the place once and spends it on the first `recipeData`, whatever that model is. A model of another run restores nothing. A later model in the same document (after Regenerate, Run Faker, Create, Add friend or a run switch) keeps what the page already holds, exactly as before. Nothing is saved until the place is spent, so the default view drawn first cannot overwrite it.
- **Everything that asks the host is restored after `rendered`.** An opened picklist row (`loadPicklistValues`), a Previous Versions tab (`loadVersionSummaries`) and a Data-by-Org tab or a picker the reader had used (`loadDataOrgs`) all wait until the ack has activated the model's allow-lists, in the same place a posted `focusTree` is applied. A `focusTree` is applied after the restore, so it wins for its card. The scroll is restored last. A panel whose reader never used the org picker still lists no orgs, since listing them runs the CLI's connection check.
- **A restored status filter and opened Data-by-Org rows wait for the card's comparison.** Applied before the replayed `orgDescribe`, the filter would hide every row and the rows could not open. They wait as `pendingStatusFilter` and `pendingDataExpandedObjectApiNames`, which the card's next comparison spends: applied if it is drawn, dropped if it failed. While they wait, they are still what is saved. They are for the comparison they were saved under, which only a replay brings back, so clicking **Compare** or **Choose another org…** drops them: a new comparison never opens already narrowed by a filter set on an old one.
- **A picklist's open state lives on the field.** A row built from a restored place opens as it was, asking the host for its values again.
- **A saved place is never trusted.** It is read inside a `try`. A place in another shape (`RECIPE_COCKPIT_PANEL_PLACE_VERSION`), or with no run, is ignored. Every field is type-checked, every name-keyed lookup has no prototype, and an entry naming a card, object, tab, version or status this model does not have is passed over without affecting the rest. A Data-by-Org or Previous Versions tab is built for its rows only when one of them is the card's own, so a stale name never runs the CLI's connection check.
- **What a save costs.** A save reads one flag per object and the open state of rows already drawn, then posts a few KB. A restore saves once, after it finishes, not once per tab it selects. Scrolling saves at most once every `RECIPE_COCKPIT_PANEL_PLACE_SCROLL_SAVE_DELAY` (200 ms), reading the position when the save runs.
- **Reopening keeps the run on screen.** Re-running the command on an open panel for the same workspace reloads the run that panel shows; a run that is gone falls back to the newest, as any run that cannot be found does. It keeps Data-by-Org's Create results (what **View errors** opens) and its request sequence. It holds the old model through the reload only when there are comparisons to check against it, and carries them only when the reloaded model draws the same rows (`buildComparedRowsSignature`: the run, every object field for field, and each card's objects; a card's history and the run list are not rows), re-tagged with the new `renderSequence`. Otherwise they are dropped, as before. A panel opened for another workspace carries nothing.
- **Not changed:** `retainContextWhenHidden` stays off, so a hidden tab still costs no document. The host's replay on `ready`, every allow-list and the Data-by-Org org remembered in the workspace are unchanged. Keeping the place after the panel is closed, or across a window reload, is out of scope.
- **Tests.** `RecipeCockpitPlaceRestore.test.ts` runs the real panel script twice, saving in the first run and restoring in the second. It covers every part of the place, the host requests posted after `rendered`, a Structure search, a Data-by-Org tab and the toolbar picker, another run, a later model, `focusTree`, repeated reloads, the scroll debounce, the status filter and opened Data-by-Org rows (waiting, applied, dropped on a failed comparison or a new Compare, saved while waiting), one save per restore, names-only saving, malformed, stale, prototype-named and unreadable saved places, a webview with no state API, `carryOrgDescribeMessages`, and the reopen (the picked run, a deleted run, another workspace, comparisons carried or dropped, Create results kept). `RecipeCockpitPanelHarness` gains `getState`/`setState`, a scroll and `scrollTo`.

## [3.47.0] - Recipe Cockpit: Data-by-Org is a tab on each tree card, every tab has its own search, and one org picker sits in the toolbar

Closes [#217](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/217), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Recipe Trees and Data-by-Org were two full-panel lists of the same trees. Switching between them lost your place, the one find box covered Structure but disappeared on Data-by-Org, and Compare sat on Structure, away from the org it compared against. Everything about one tree now sits under that tree's card.

- **Each card's tabs are Structure · Data-by-Org · Previous Versions · Previous Fake Sets.** Structure is selected by default, and the history tabs still appear only for a card with a history. The toolbar's **Recipe Trees · Data-by-Org** switch and the separate Data-by-Org view are gone. `RECIPE_COCKPIT_TREE_TABS` gains `dataByOrg`, and a `focusTree` can name it.
- **The Data-by-Org tab** lists the tree's objects with their record counts and **+ Create**, as the view did. Its rows are built the first time the tab opens. A Create's reload now opens the card it was clicked in on this tab.
- **One org picker in the toolbar**, with its type label and ⟳, serves every card's Data-by-Org tab. It still lists only sandbox and scratch orgs. The CLI connection check (`loadDataOrgs`) still runs lazily: the first time any card's Data-by-Org tab opens, or the first time **Choose an org…** in the toolbar is clicked, and never on panel open. Once the picker has been used, each later model (a run switch or a reload) asks again, so the counts follow it. Picking an org recounts every tab from the same `selectDataOrg {orgIndex}`: counts are held for the whole panel and drawn into a tab when it is built, so a tab opened after the counts arrived shows them. Every existing safeguard is unchanged: the remembered org is preselected without connecting, stale answers are dropped by `dataOrgRequestSequence` and `renderSequence`, production is never listed or connected to, and Create is guarded three times.
- **Compare moves to the Data-by-Org tab.** Compare, Choose another org…, progress, the summary, the status filter and Regenerate recipe sit at the top of that tab. Each object row shows its diff summary and, expanded, lists only the fields that differ, each with its badge and its type or picklist details. The status filter narrows those rows and no longer offers *unchanged*, since an unchanged field is not drawn. The Structure tab shows no badges, no org-only rows and no describe status. Compare uses the toolbar's org. **Choose another org…** still opens the full picker, production included, and does not change the toolbar's org. The host messages (`selectOrg {treeKey}`, `orgDescribe`, `orgProgress`, `regenerateRecipe`) and their allow-lists are unchanged; only where the panel draws them moved.
- **Every tab has its own search box.** The global find box, its match count and 🔍 scoping (`treeScopeKey`, `.treeScope`, `.treeScopeClear`) are gone. Each box filters only its own tab of its own card, keeps its text when you switch tabs or collapse the card, and starts empty when a new model is drawn. It matches only text the tab draws:
  - Structure: object and field names, label, controlling field, the sized type and the faker expression, as before.
  - Data-by-Org: object names and, once compared, the names of the fields that differ.
  - Previous Versions: the run folder name (now drawn on each version row) or the generated date.
  - Previous Fake Sets: the data set folder name.
  A search never hides an object. One with no match stays visible and collapsed, marked *no matching fields* or *no matches*. The history tabs hide the rows that do not match and count what is left. The `RECIPE_COCKPIT_AUTO_EXPAND_*` budget is spent per search box rather than across every tree.
- **Not changed:** host↔panel messages, allow-lists, the diff engine, the org listing, the Create safety rules, recipe generation and both faker backends. The issue's open questions are left as they were: the button keeps the label **Compare with an org…**, and there is no "Count all trees" action.
- **Tests.** `RecipeCockpitPanelHarness` gains `openTab`, `tabPanelOf`, `typeIntoTabSearch` and `dataObjectElements`. `typeIntoFilter` now types into one card's Structure search. `RecipeCockpitService.test.ts` covers the tab order and default, the global box and 🔍 being gone, each search box filtering only its own tab and card, keeping its text across a tab switch and a collapse, resetting on a new model, spending its own auto-expand budget, matching only drawn text in each tab, Compare drawing into the Data-by-Org tab (including a comparison answered before the tab opened), the differing-field rows and status filter, the history-tab searches, and a reload focused on Data-by-Org asking for the orgs after its ack. `RecipeCockpitDataByOrg.test.ts` covers the toolbar picker, `loadDataOrgs` only on first use (tab or picker) and never on open, and one selection recounting every tab, built or not. `RecipeCockpitCreateInOrg.test.ts` drives Create from the tab and asserts the reload's `dataByOrg` focus.

## [3.46.1] - Every error notification shows workspace text as plain text

Closes [#186](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/186), a follow-up to the #183 security review.

VS Code renders `[label](command:…)` in a notification as a link that runs the command when clicked (#164). `ErrorHandlingService.handleGenericError` put `error.message` into `showErrorMessage` unescaped, and every `handleCapturedError` caller reaches it. An error message can quote workspace text: a `js-yaml` parse error from **Run Faker by Recipe** quotes the recipe line it failed on, which a repository author wrote. #183 fixed one message by leaving its path out. This closes the class.

- **Generic errors are escaped centrally.** `handleGenericError` passes the error message through `RecipeYamlScalar.escapeForNotification` before `showErrorMessage`, so brackets, parentheses and every line break either YAML parser sees (U+0085, U+2028, U+2029 included) show as `\uXXXX` or `\n` text and no message can form a link. `executedCommand` is not escaped: it is always a command name the extension defines.
- **Missing config too.** `handleMissingTreecipeConfigSetup` escapes the stale-setting notice. `ConfigurationService` already escaped the path inside it, and `escapeForNotification` is idempotent on its own output (a test asserts this), so the notice shows no doubled escapes.
- **Report Issue keeps the raw text.** The `Report Issue to GitHub with Stack Trace` URL still carries the original message and stack. That text is URL-encoded into an issue body and never rendered as a notification.
- **A non-Error throw no longer throws inside the handler.** `handleCapturedError` read `error.message.startsWith` before routing, so a thrown string, `null` or `undefined` threw from the error handler itself. It now shows `Unknown error during command: …` like any other non-Error.
- **Not changed:** button labels, the URLs they open, and the warnings that already escape their own text.
- **Tests.** `ErrorHandlingService.test.ts` covers an escaped command-link message, the buttons, the raw Report Issue URL for both dialogs, the README URL, each line break, an empty message, a thrown string, `undefined`, `null` and a plain object, an escaped and an already-escaped stale notice, and idempotency. `ExtensionCommandService.test.ts` drives **Run Faker by Recipe** end to end on a recipe whose YAML fails to parse on a `[x](command:git.push)` line and asserts the text that reaches `showErrorMessage`.

## [3.46.0] - Generate Treecipe reports its progress and can be cancelled

Closes [#216](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/216).

**Generate Treecipe** showed nothing between the moment it started and its completion notification. It read the global value sets, walked every object directory, built the relationship trees and wrote the run with no feedback, so on a large org it looked like nothing was happening, and a run started by mistake could not be stopped. It now runs behind the same kind of cancellable progress notification as **Generate Picklist Dependency Tests** (#92).

- **One notification, titled `Generate Treecipe`, with Cancel.** It is a `ProgressLocation.Notification` because that is the location that can offer a cancel. It reports `Reading global value sets…`, then `Scanning objects…`, then `Scanning <Object> (N of M)` for each object, then `Building relationship trees…`, then `Writing recipe files… (cannot be cancelled)`. Object names go through `escapeForNotification`, because they are workspace text.
- **What "N of M" counts.** M is the number of top-level directories in the configured objects path, so it is known after one listing, before the walk descends. A configured path that is itself one object directory counts as `1 of 1`, and an empty objects directory reports `0 of 0` and completes.
- **Cancel stops the run before anything is written.** A cancel while the global value sets are read, while objects are scanned or while the trees are built throws `RecipeGenerationCancelledError` at the next check. The walk descends into no further directory, `createRecipeFilesInSubdirectory` is never called, no run folder is created and no completion notification is shown. The command then shows `Generate Treecipe was cancelled. No recipe files were written.` A cancel is not an error, so it never reaches `ErrorHandlingService`.
- **Writing cannot be cancelled.** Once writing starts the token is not read again, so a run folder is written whole or not at all, and the notification says so.
- **The walk sees no vscode type.** `DirectoryProcessor.processAllObjectsAndRelationships` and `processDirectory` take an optional `IRecipeGenerationProgress` (`report`, `isCancellationRequested`). It has the same shape as `IPicklistDependencyGenerationProgress` but is defined beside the walk, so `DirectoryProcessor` does not depend on the picklist service. Without one, the walk behaves exactly as before.
- **Not changed:** recipe output for both backends, the #206 completion notification and `isCompletionNotificationSuppressed`. The Recipe Cockpit's **Regenerate recipe** shows the progress notification too, and still reloads however the command ended, cancel included.
- **Tests.** `DirectoryProcessor.generationProgress.test.ts` runs both backends over a real temporary objects directory. It covers the reported messages in order, the same output with or without a progress port, a cancel mid-scan descending no further, a cancel during the tree build, an empty directory, and a configured path that is one object. `ExtensionCommandService.test.ts` covers the notification's options and phases, the walk reading the notification's token, a cancel at each phase (no write, the cancelled message, no error), a cancel during writing still writing the run, the cockpit's suppression option with a cancel, a failure still reaching `ErrorHandlingService`, and no notification when there is no workspace.

## [3.45.0] - The Recipe Cockpit's no-run empty state offers a Generate Treecipe button

Closes [#214](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/214).

Opening the Recipe Cockpit before any Generate Treecipe run used to show one sentence telling the reader to run the command and open the cockpit again. There was nothing to click.

- **A Generate Treecipe button** now sits under the empty state when no run exists under `treecipe/GeneratedRecipes`. It runs `treecipe.generateTreecipe` with `RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS`, so no completion toast appears, then reloads the cockpit on the newest run. That works for both faker-js (`recipe-fakerjs-*`) and snowfakery (`recipe-*`) runs. `RECIPE_COCKPIT_NO_RUN_MESSAGE` no longer says to reopen the cockpit.
- **It shares Regenerate recipe's path.** `regenerateRecipe` became `generateTreecipeAndReload(panel, state, focusTree?)`. Regenerate passes its card as the focus and the empty state passes none. The two share one in-flight flag, so the host never runs them at once. The cockpit reloads even when generation failed or was cancelled, and the failure still reaches `ErrorHandlingService` once. A reload with still no run draws the button pressable again.
- **The button is gated like every other panel action.** The panel posts `{ command: 'generateTreecipe' }` with no payload. `routePanelMessage` honours it only while `isGenerateTreecipeOffered` is set. That is a pending/active pair: `pendingIsGenerateTreecipeOffered` is set when a model with no run is posted, and only that model's `rendered` promotes it. It is emptied on every `ready`, on every new post and on a failure to draw. It is also refused while a generation or regeneration is in flight. The panel disables the button on the click, and only the host's reload redraws it.
- **Not changed:** a run whose objects wrapper cannot be read, and a run with no relationship trees, keep their own empty states without the button. Generate Treecipe itself is unchanged.
- **Tests.** `RecipeCockpitService.test.ts` covers the router (offered, before `rendered`, with a run on screen, in flight), the panel script (the button is drawn only in the no-run state, disables itself, posts once and comes back after a redraw), and the host (generate then reload on the run written, a double click, a failure that reloads and re-offers, a document reload that honours nothing until the empty state is drawn again, an empty state that failed to draw, and a model with a run posted over the empty state before and after its ack). Each of the last two fails when its reset is removed. The button joins #209's shared button rules (base, primary and disabled), so it draws like Run Faker and Create, and its pairs are already in the contrast test.

## [3.44.0] - The Recipe Cockpit's tree card header is one clickable row tile, and every cockpit button is a real, larger target

Closes [#209](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/209), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Every cockpit button was a bare link (`background: none; border: none; padding: 0`), so a tree card opened only from its one-character `▸`, and 🔍 and ▶ Run Faker were about one glyph each. A disabled button was the same button at 60% opacity, so while Faker ran the buttons still looked usable.

- **The header is a row tile.** `.treeHeader` is at least `4rem` tall with a pointer cursor and an accent bar on hover. A click anywhere on it (title, folder, counts, or the `▸`) opens or closes the card. The `▸` stays a real `<button>` with its `aria-label` and `aria-expanded`, and has no listener of its own: its click, from a mouse or from Enter/Space, bubbles to the row, so one click cannot toggle the card twice.
- **🔍 and ▶ Run Faker sit at the end of the row** in a `.treeHeaderActions` group. Clicks inside the group never toggle the card. The click is stopped on the GROUP rather than on each button, because a browser may pass a click on a DISABLED button (every Run Faker while one runs) to its ancestors without running the button's own listener.
- **Every cockpit button shares one rule:** `min-height: 2.25rem`, `0.4rem 0.8rem` padding and a visible border, about twice the old target. It covers the tree, object, picklist and version toggles, 🔍, Run Faker, the tabs, `+` add-friend, the history actions, Search every tree, the toolbar, Compare and Regenerate, and Data-by-Org's ⟳, toggle, `+ Create` and View errors. Run Faker, the toolbar, Compare, Regenerate and Create are filled with the accent.
- **Disabled buttons look disabled.** Two palette tokens are new: `disabledBg` `#E5E7EB` and `disabledText` `#4B5563` (6.1:1, added to the contrast test's pair list, now 27 pairs). One `:disabled` rule draws Run Faker, `+` add-friend, the toolbar, Compare, Regenerate and Create in them with `cursor: not-allowed`. Hover effects apply only to buttons that are not disabled.
- **Not changed:** no host↔panel message, allow-list, `renderSequence` handling or Run Faker sequencing. Run Faker is still disabled across every card on the click, until the host's `runFakerState`.
- **Tests.** `RecipeCockpitPanelHarness` now BUBBLES a dispatched event through `parentNode` until a listener stops it, and a disabled element skips its own listeners but still bubbles, which is the worst case a browser can give. New harness tests: the row, title, folder and `▸` each toggle the card. 🔍 scopes without toggling. Run Faker posts without toggling. A disabled Run Faker neither toggles nor posts. The actions are the row's last child. Stylesheet tests pin the shared button rule and the selectors it covers, the header tile, and the disabled rule. Removing the group's `stopPropagation` fails two of these tests.
- **Fixed in review (PR #212):**
  - The ⟳ button that refreshes Data-by-Org's org list is disabled during an org check, but the shared `:disabled` rule did not cover it, so it looked enabled. `.dataOrgRefresh:disabled` is now in the rule.
  - Hovering the selected tab drew its accent underline grey. The tab hover rule now skips `.selected`.
  - The header no longer sets `user-select: none`, so the tree title and folder name can be selected and copied again.
  - Clearing a container in the panel harness now detaches its children (`parentNode = null`), so an event on a stale element no longer bubbles into its former ancestors.

## [3.43.0] - Recipe Cockpit Create names the recipe fields the org lacks before anything is sent

Closes [#210](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/210), part of epic [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Data-by-Org's **+ Create** already refused an object the org does not have. When the object was there but some of its recipe fields were not, Create went ahead and Salesforce rejected every record (`INVALID_FIELD`), which the reader only learned from **View errors**.

- **Two new readiness reasons** in `RecipeCockpitRecordCreation.buildCreateReadiness`, after the sandbox, org-type, object and createable guards and before the required-lookup ones: a recipe field the describe does not have (`Account is missing 3 recipe fields in this org: Region__c, Tier__c, Score__c.`) and one it has but `createable` is not `true` (`… this org will not let you set: Legacy_Id__c.`). A reason spells out ten names and counts the rest (`and N more`); the readiness carries the full `missingFieldApiNames` and `notCreateableFieldApiNames`, for #211's deploy.
- **The fields checked are the ones the insert sends.** `RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames` reads them back from the same `extractObjectBlock` cut the Create runs, so recipe-only standard mappings and `RecordTypeId` are checked, and a friend's fields and a field the cockpit commented out are not.
- **Per tree and object, not per object.** One object can sit in several trees with different blocks, so Data-by-Org reads each tree's recipe once (`fs.promises`, workspace-contained) and posts a readiness per tree and object (`createTargets`) beside the object-wide one; a row draws its own and falls back to its object's. `computeCreateReadinessByTarget` checks them all against the describes the object guards already loaded, so a target costs no request, and a second check of the same org and object makes none.
- **Names match case-insensitively**, as Salesforce reads them and as `assignLookupIds` already did, through a null-prototype map, so a recipe field named `__proto__` or `constructor` is reported missing rather than read as inherited. A lookup the describe knows is never "not createable" (the Create fills or removes it), but a lookup it does not know stays in every record, so it is reported missing.
- **Fail closed.** A recipe file that cannot be read, or a block the writer refuses to cut, is that row's reason rather than an enabled Create. `performCreate` re-checks with the fields of the block it just cut, so a forged `createRecords` for an object the org cannot take reaches no modal and inserts nothing.
- **Not changed:** the production guard and its three checks, the required-lookup rules, and both faker backends.
- **Tests.** `RecipeCockpitRecordCreation.test.ts` (each reason, the ten-name cap, case, prototype names, ordering against the other guards, the unreadable-block reason), `RecipeCockpitRecipeWriter.test.ts` (the listed fields against every fixture's cut, friends and commented-out fields left out, refusals), `RecipeCockpitCreateInOrg.test.ts` (one object in two trees from one describe, no second request, the posted targets, a forged Create refused before the modal, an unreadable recipe, and the panel drawing a row's own reason over its object's as text).
- **Fixed in review (PR #213):**
  - **Data-by-Org scanned a tree's whole recipe once per object.** Each target went through `extractObjectBlock` → `locateObject`, so selecting an org blocked the extension host for time quadratic in a tree's objects: measured 5.7 s at 500 objects, 25.3 s at 1,000 and 91 s at 2,000. `RecipeCockpitRecipeWriter.listCreateBlockFieldApiNamesForObjects` lists every object of a recipe from ONE scan, and falls back to the per-object cut only for an object it cannot list from the scan (missing, written twice, no single `count:` line), so every refusal is word for word the same. Measured after: 36 ms at 1,000 objects, 77 ms at 2,000, 274 ms at 11,000 (10 MB). A test holds the batch equal to the per-object answer for every fixture and refusal, and another that it scans once.
  - The targets are grouped by object once and the recipe objects indexed by name once, where each was searched per object.
  - A row the fields refuse keeps its required lookups, so its tooltip still names them.

## [3.42.0] - Initiate Configuration File and Generate Treecipe end with one notification that opens or reveals what they wrote

Closes [#206](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/206).

**Initiate Configuration File** finished silently. **Generate Treecipe** raised four toasts per relationship tree plus one more (recipe, SOQL/SOSL template, Mermaid ERD, objects wrapper), so a six-tree run showed 19 notifications. None of them said where the files went, and every one fired from an `fs.writeFile` callback the command never awaited: the command settled before its files existed, and a failed write threw into a callback nothing caught, so the user was told it succeeded.

- **Initiate Configuration File** now shows `Created "treecipe/treecipe.config.json".` with **Open Configuration File** and **Reveal in Explorer**. `ConfigurationService.createTreecipeJSONConfigurationFile` returns the path it wrote, or `undefined` when either pick was dismissed, in which case nothing is shown.
- **Generate Treecipe** now shows ONE notification, `Generated N relationship-tree recipe(s) in "treecipe/GeneratedRecipes/<run>".`, with **Reveal in Explorer** (the run folder) and **Open Recipe** (the first tree's `.yml`, in `RecipeFiles` order; left out when the run wrote none). It is the same for faker-js (`recipe-fakerjs-*`) and snowfakery (`recipe-*`) runs.
- **Writes are awaited.** `DirectoryProcessor.createRecipeFilesInSubdirectory` writes through `fs.promises.writeFile`, resolves only once every file is on disk, and returns `{ runFolderPath, recipeFilePaths }`. A failed write now rejects naming the file, reaches `ErrorHandlingService`, and no success notification is shown.
- **The notification does not hold the command.** `VSCodeWorkspaceService.showCreatedFilesNotification` is called with `void`: a toast can stay unanswered forever, and `treecipe.generateTreecipe` returns its promise to the Recipe Cockpit.
- **Each click is checked again.** The file can be moved or deleted while the toast is open, so a button opens or reveals its target only if it still exists and passes `SfdxProjectService.isPathContainedInWorkspace` (the symlink half included). Otherwise it warns and does nothing. A rejected `revealInExplorer` is reported rather than left unhandled.
- **Paths in the message are escaped.** The workspace-relative path goes through `RecipeYamlScalar.escapeForNotification`, so a folder name carrying `[label](command:…)` cannot render as a link that runs a command.
- **The Recipe Cockpit's Regenerate recipe shows no notification.** It runs `treecipe.generateTreecipe` with `{ isCompletionNotificationSuppressed: true }` (`RECIPE_COCKPIT_GENERATE_TREECIPE_OPTIONS`), because it already reloads and focuses the regenerated tree. The command is callable by id, so only that exact object suppresses: a string, a truthy non-boolean, `null`, an array or a `Uri` still notifies.
- **Not changed:** Initiate still overwrites an existing `treecipe.config.json` without asking. Run Faker by Recipe, Insert Data Set by Directory and the picklist dependency commands keep their own messages.
- **Tests.** `DirectoryProcessor.createRecipeFilesInSubdirectory.test.ts` runs against a real temporary directory: the returned paths for both backends, every file on disk when the promise resolves, no notification of its own, and a failed write rejecting. `VSCodeWorkspaceService.createdFilesNotification.test.ts` covers each button, dismissal, an unanswered toast, a deleted target, a target outside the workspace or behind a symlink out of it, no workspace, a rejected reveal, and the escaped display path. `ExtensionCommandService.test.ts` covers both commands' notifications, cancel and failure, the suppression option and the arguments that must not suppress. `ConfigurationService.test.ts` asserts the returned path, and `RecipeCockpitService.test.ts` that Regenerate passes the option.
- **Fixed in review (PR #207):**
  - **A failed write settled the command while the rest of the run was still writing.** `Promise.all` rejects on the first failure, so the Recipe Cockpit's Regenerate could reload a run whose objects wrapper was half-written. The writes are now `Promise.allSettled`, and the first failure is raised only once nothing is still writing.
  - **OS error text reached a notification unescaped.** A Node `fs` error names the absolute path, and the workspace root's folder name is not an api name. A failed write now shows its error detail through `escapeForNotification`, as do the reveal-failure and `openFileInEditor` failure messages.
  - `extension.test.ts` asserts that the registered `treecipe.generateTreecipe` handler forwards its argument. Without that, dropping the argument there brought back the toast after the cockpit's Regenerate, and no test noticed.
  - A test that held only "returns a Promise" now asserts that an unanswered toast opens and reveals nothing.

## [3.41.0] - The Recipe Cockpit adds an object's friends under its nested self-lookup iteration, one at a time

Closes [#197](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/197), a follow-up to [#188](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/188).

3.35.0 gave an object with a self-lookup one nested child iteration of itself (`Account_child_NickName`) and, on purpose, none of the object's other friends, so a child Account had no Contacts or Opportunities. Adding them meant copying each friend block by hand and re-wiring its lookups.

- **Writer (`RecipeCockpitRecipeWriter.insertFriend`).** It takes the object, the iteration's nickname (required) and the friend's object, and patches LINES, like every other writer operation.
  - The friend's block is **copied from the occurrence above the iteration**, so hand edits, TODOs and comments there are kept and nothing is regenerated from metadata. Only its own block is copied: the friend's own `friends:` block stays with the original (a Contact's Case is not copied), so the recipe grows by one object per call.
  - The copy goes one `friends:` level deeper, after the iteration's last line, under its `friends:` block, which is written first when the iteration has none.
  - It gets a **nickname no occurrence in the file holds**: `Contact_NickName` becomes `Contact_child_NickName` (any other nickname gains `_child`), then `_2`, `_3`, … So the reader and the writer can still tell every occurrence apart.
  - Every field whose whole value was the **top occurrence's nickname** now holds the **iteration's** (`AccountId: Account_child_NickName`). A lookup to an ancestor above the top occurrence still names that ancestor, which is the iteration's ancestor too. Every other value, a TODO included, is copied as it is.
  - **Typed refusals:** `invalid-friend-object-api-name`, `invalid-object-nickname`, `object-not-found` and `duplicate-object` for an unknown or ambiguous iteration, `not-a-self-lookup-iteration` (the top occurrence, or a friend that is not its own object's iteration), `friend-not-found` (the object, a grandchild, or anything the top occurrence has no friend of), `duplicate-friend` (the top occurrence carries it twice), `friend-already-exists`, `duplicate-friends-block`, and `unsupported-friend-layout` (a friend or top occurrence without exactly one nickname, a nickname no api-name-shaped one can be made from, or an iteration whose `friends:` block is not its last). The result is read back through `scanRecipeObjects` and refused unless it reads as exactly one new friend of the iteration, with the nickname and fields it was given.
  - Every line outside the inserted block is byte-identical, line endings and a missing final newline included.
  - `listInsertableFriendObjectApiNames` lists what `insertFriend` would accept for an iteration, and is what the panel offers. The scan now records each object's `friendsLineIndexes`, and `extractObjectBlock` shares the own-block walk with the copy.
- **Recipe Cockpit.** A self-lookup iteration row (`Account_child_NickName · nested under Account_NickName`) shows a **+** on the Structure tab. It opens a list of the friends the occurrence above carries that the iteration does not, one button each (`+ Contact`, `+ Opportunity`). No other row has one, and a snowfakery recipe has no iteration, so none.
  - The panel posts only names: `addIterationFriend {treeKey, objectApiName, objectNickname, friendObjectApiName}`. The four together must be a key of `insertableFriendTargets`, a pending/active allow-list built from the rendered model (promoted on `rendered`, emptied on `ready`, a new post and a failure to draw), which maps to the host-only recipe file. No path or recipe text comes from the panel.
  - A click disables every **+** until the host's `addFriendState` gives them back. That state is replayed on a reveal, and a refused message answers it at once.
  - The host asks first, in a modal naming the file, the friend and the iteration. Then it runs `insertFriend` on the file as it is NOW, so an edit made since the draw is built on or refused, never overwritten. The file's containment and existence are checked before the modal and again after it.
  - After a write the run reloads with the card open on its Structure tab. The new friend is listed as `Contact_child_NickName · nested under Account_child_NickName`, its `↗ yml` links open the new lines, and the iteration's **+** offers only what it still lacks. A cancel, a refusal or a missing file writes nothing and reloads nothing.
  - The preview warning no longer says the cockpit never writes into a recipe.
- **Run time: no change.** `FakerJSRecipeProcessor` already hands each friend every ancestor's nickname, so the added friend's lookup resolves to the child Account it is generated under, for every iteration when `count > 1`. Insert Data Set inserts it after that Account, since Contacts are inserted after Accounts.
- **Snowfakery recipes are unaffected.**
- **Fixed in review (PR #208):** a source friend carrying a line break the JS split does not see (a lone carriage return, U+0085, U+2028, U+2029) is refused. YAML breaks there too, so text after it kept its old column when the copy moved a level deeper, and could leave a block scalar as a new field the read-back could not tell from the original.
  - **Listing what "+" offers was superlinear at load.** `parseRecipeSource` computes the list for every iteration, and each call walked the whole scan and rebuilt a set of every nickname in the file per candidate friend: 18.5 s for a recipe of 11,000 objects with 500 self-lookup iterations and 20 friends each. The scan is now indexed once per parse (`buildScannedFriendIndex`, passed to `listInsertableFriendObjectApiNames`), and the list checks only that a nickname can be made, leaving uniqueness to `insertFriend`. The same recipe now parses in about 0.2 s, the same as without the list, and a test holds it under 3 s. The panel also stopped re-setting every "+" drawn so far each time it draws one.
  - **A run switched while the confirmation was open** reloaded that other run, so the friend just written was not on screen. The reload now names the run the file belongs to, read at the click.
- **Tests.** `RecipeCockpitRecipeWriter.test.ts` covers the inserted lines, a second friend appended to an existing block, a block scalar and a blank line moved intact, an ancestor above the top occurrence kept, nickname collisions, every line-ending variant with the iteration both mid-file and on the last lines, the YAML the result loads as, and every refusal, over a new fixture `recipe-fakerjs-selfLookupFriends`. `RecipeCockpitAddFriend.test.ts` covers the model, the allow-list and router, the confirm/write/reload flow, a cancel, an edit made since the draw, a file removed before and during the modal, and the panel's **+**. `RelationshipService.nestedFriends.test.ts` takes a generated self-lookup recipe through `insertFriend`, Run Faker, the Collections API conversion and simulated inserts with every count at 2: each child Account gets exactly its own two Contacts.
- **Open questions answered:** the copy comes from the top occurrence's block rather than the wrapper's `FullRecipe`, so hand edits survive. **+** stays strictly one friend at a time. There is no matching **−** in this change.

## [3.40.0] - A lookup to a second parent that is not an ancestor is wired in faker-js recipes and resolves at run time

Closes [#189](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/189), a follow-up to [#46](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/46).

3.33.0 nested each child under its closest parent and wired every lookup to an ANCESTOR. A lookup to a second parent the child is not nested under still came out as `### TODO -- REFERENCE ID REQUIRED`: in the mock metadata, `MasterDetailMadness__c.MD_MegaMapMadness__c` (a master-detail, so every record failed to insert) and `Order_Item__c.Product__c`. Writing that parent's nickname by hand did not work either, because Run Faker renames a parent's records once it sits under `friends:` or has `count > 1` (`MegaMapMadness__c_NickName_1`, …).

- **Generation (`RelationshipService`, faker-js only).** `wireAncestorLookups` is now `wireLookupsToParents`. A lookup to a parent that is in the same tree, has a recipe, sits at a strictly LOWER relationship level than the child and is not an ancestor is written as that parent's YAML nickname. A lower level is inserted first, so its records already have Ids. Ancestor lookups are wired exactly as before.
- **Every other generated lookup TODO names its parent**: `### TODO -- REFERENCE ID REQUIRED -- User` for a parent with no recipe, and `-- Case__c` for a lookup that is part of a cycle (the parent is at the same or a higher level), including a self-lookup's top iteration (`ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account`). A field that looks up several such parents names each, in name order. This applies to nested trees only: a faker-js tree where nothing nests is still written byte for byte as the flat recipe, and only a line that is exactly the generated TODO is rewritten.
- **Run time (`FakerJSRecipeProcessor.resolveNonAncestorNicknameReferences`).** It runs once the WHOLE recipe has been generated, so a child written above its parent in the file resolves too. A field whose value is exactly the YAML nickname of an entry in the recipe, and that was not already resolved to an ancestor, is pointed at one of the records that entry generated. Records are taken round-robin in generation order, so the result is deterministic and children spread evenly. A record is never pointed at itself. Ancestor references keep 3.33.0's behavior: the record the child was generated under.
- **Records that share a nickname are numbered when something names them.** Insert resolves a nickname to the FIRST record holding it, and an entry with `count > 1` and no friends gives every record the same nickname. So, only for an entry a non-ancestor reference names, each record sharing a nickname is renamed `<nickname>_<n>`, skipping any name another record already holds. Those records have no friends, so nothing was generated under the old name. A data set with no such reference is written exactly as before.
- **Insert: no change.** Files are already inserted by relationship level, and `updateLookupReferencesInCollectionApiJson` already replaces a value that is exactly a nickname.
- **Snowfakery recipes are unchanged.**
- **Tests.** `RelationshipService.nestedFriends.test.ts` covers a wired second parent, a parent with no recipe, a cycle, a field naming several parents, the unchanged snowfakery recipe, and an end-to-end run where each `Order_Item__c` gets its own `Order__c` and the `Product__c` records in turn. `FakerJSRecipeProcessor.test.ts` covers a child written before its parent, a parent nested under `friends:`, an ancestor reference beside a spread one, repeatability, self-reference, nickname collisions, and values left alone. `DirectoryProcessor.generatedRecipeYaml.test.ts` takes the mock metadata through generation, Run Faker (every `count` raised to 2), the Collections API conversion and simulated inserts in relationship-level order: `MasterDetailMadness__c` and `Order_Item__c` resolve every lookup to records of the right object, each parent record used before any is used twice, and no inserted value is still a nickname. The Recipe Cockpit writer fixtures `recipe-fakerjs-nested` and `recipe-fakerjs-selfLookup` were regenerated.
- **Fixed in review (PR #205):**
  - **The run-time pass was quadratic.** It copied every record of the referenced entry once per reference, which took 13 s at 100k references to 10k records, blocking the extension host. Each entry's records are now listed once, and the referencing record is skipped by index, which gives the same pick a filtered copy would. The same case now runs in about 120 ms, and a test holds it under 3 s. The field scan also no longer allocates an entry pair per field.
  - **A polymorphic lookup with two qualifying parents was wired to the LAST by name.** It is now wired to the first.
  - `GeneratedRecord.fields` is `Record<string, unknown>` rather than `any`.
- **Known, not changed here:** the generator writes `Example_Everything__c.DependentPicklist__c` above its controlling `Picklist__c`, which Run Faker cannot evaluate. The new end-to-end test stubs dependent picklist evaluation for that reason.

## [3.39.0] - Org pickers list only orgs the Salesforce CLI reports as connected

Closes [#201](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/201), slice 9 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Every org picker was built from `AuthInfo.listAllAuthorizations()`, which returns every authorization file on disk, working or not. Expired or deleted scratch orgs, and orgs whose refresh token was revoked, were offered next to working ones. Picking one failed late, with a connection error that did not say the org was gone.

- **Source of truth: the CLI's connection status.** `SalesforceOrgService.listConnectedOrgAuthorizations()` runs `sf org list --json --verbose` through `PicklistDependencyCheckService.runSalesforceCli`, with a 60-second timeout (`runSalesforceCli` takes an optional timeout now). `--skip-connection-status` is never passed. It uses the same invocation the picklist check does: argv with no shell, and on Windows `sf.cmd` with quoted arguments through the shell, because Node refuses to spawn a `.cmd` file without one (EINVAL, since CVE-2024-27980). The arguments are constants.
- **The answer is read as untrusted.** Every field is type-checked.
  - A non-scratch org is usable only when `connectedStatus === "Connected"` exactly.
  - The CLI never pings a scratch org; it asks the org's Dev Hub. So a scratch org is usable when `status === "Active"`, `isExpired !== true`, and any `connectedStatus` it carries is `"Connected"`. This is narrower than the issue text, which required `connectedStatus` on every org and would have hidden every scratch org (checked against plugin-org 6.0.20's `OrgListUtil`).
  - Anything else is left out, failing closed: an error code such as `RefreshTokenAuthError`, `"Unknown"`, `Expired`, `Deleted`, or a missing or mistyped field. The reason is recorded as `expired`, `deleted` or `not connected`; `"Unknown"` counts as not connected.
  - An org the CLI names more than once keeps its first unusable answer, so one `Connected` entry cannot outvote another.
  - An authorization the answer does not mention is left out too: as `expired` when its auth file says so, otherwise `not connected`.
- **Only the usernames that survive are matched** against `AuthInfo.listAllAuthorizations()`. A username with no authorization file is left out. `isValidTargetOrgIdentifier` and, for Data-by-Org, `isKnownNonProductionAuthorization` still apply on top.
- **Session cache.** The answer is cached in `SalesforceOrgService` for the life of the extension host. Two pickers opened during a check share one process. A failure (`ENOENT`, a timeout, a non-zero exit, malformed JSON) is never cached, so the next picker asks again. `refreshConnectedOrgAuthorizations()` (Data-by-Org's ⟳, and #200 after it creates an org) asks again and replaces the answer. A check started before a clear never writes over the answer asked for after it.
- **Compare with an org…** (3.38.0's per-tree comparison) reuses the org Data-by-Org remembers only when the CLI still reports it connected, because that lookup now reads the same cached answer. Otherwise it asks, and **Choose another org…** offers only connected orgs, production included.
- **When the CLI cannot answer, no org is listed**, and the message says why (`OrgConnectionStatusUnavailableError`). It never falls back to every authorization unchecked.
- **All four pickers** read the shared listing: Data-by-Org's dropdown (`listDataOrgDetails`), **Compare with an org…** (`promptForAuthorizedOrg`), **Run Picklist Dependency Check**, and **Insert Data Set by Directory**. Insert Data Set used to ask for an alias in a free-text box; it now offers the same quick pick and connects by the chosen org's username.
- **Quick-pick commands** open a busy quick pick (*Checking org connections…*) at once, with nothing selectable until the CLI answers (`VSCodeWorkspaceService.promptForAuthenticatedOrgDetailOnceListed`). With nothing left to offer, the picker closes and the warning says how many orgs were left out and why: `No connected Salesforce org is authorized: 2 authorized orgs are not listed (1 expired, 1 not connected). Re-authorize one with "sf org login web" and try again.`
- **Data-by-Org:**
  - It shows *Checking org connections…* in place of the dropdown until the answer arrives.
  - The note counts each reason: `3 authorized orgs are not listed: 1 production, 1 expired, 1 not connected.` With nothing left and any org left out as unconnected, it says no connected sandbox or scratch org is authorized and how to re-authorize one.
  - A remembered org that is now expired, deleted or not connected is forgotten, and the view says so once: `The last org used, <alias>, is no longer connected.` It is written with `textContent`.
  - **⟳** now asks the CLI again, re-lists the orgs and re-selects the remembered org by username, which counts it again. It is shown even when no org is listed, so an org re-authorized meanwhile can be listed without reloading the window.
  - The list in hand is dropped before each check, so no org can be selected or created in while one is out. A new model, a `ready` or a later listing discards a stale answer.
- **Nothing logs out of, deletes or changes an org.** The only argv sent is `org list --json --verbose`.
- **Removed:** `VSCodeWorkspaceService.promptForAuthenticatedTargetOrg`, `promptForAuthenticatedOrgDetail` and `promptForUserInput`. Their only callers now go through `SalesforceOrgService.promptForAuthorizedOrg`.
- **Fixed in review (PR #202):**
  - **A newly authorized org was hidden for the rest of the session.** The cached answer read any authorization added after it as `not connected`, so following the warning's own advice (`sf org login web`, then try again) changed nothing.
    - The cache now records which authorizations existed when the CLI was asked (read before it runs), and an authorization added since causes the CLI to be asked again.
    - The quick-pick commands, which have no ⟳, also ask again once when a cached answer leaves them nothing to offer.
    - An expired scratch org the CLI leaves out is still an authorization the check answered, so it does not trigger a re-check.
  - **⟳ could leave Data-by-Org stuck on "counting…".** When ⟳ forgot the selected org (it was no longer connected), every row read "counting…" and the Create controls stayed on screen, because no selection followed. Rows now read "—" with Create hidden, and an answer still on its way for the cleared selection is dropped.
  - **Repeated ⟳ clicks started overlapping `sf org list` processes**, none of them killed. ⟳ is now disabled until the list it asked for arrives, and on the host `refreshConnectedOrgAuthorizations` shares a check already in flight instead of starting a second one.
  - **On Windows the 60-second timeout did not bound a hung check.** There the CLI runs as `cmd.exe` → `sf.cmd` → `node`. execFile's own `timeout` killed only `cmd.exe`, and its callback then waited on pipes the orphaned `node` still held, so a hung `sf org list` kept the picker busy past the timeout.
    - `runSalesforceCli` now runs its own timer. When it fires, the call resolves at once as `timedOut`, whatever the pipes are doing.
    - The whole process tree is killed: `taskkill /pid <pid> /T /F` on Windows, with a numeric pid and constant arguments and no shell, and a plain kill elsewhere. A cancellation of an Apex test run or a deploy kills the tree the same way.
    - `timedOut` is reported as a timeout even though a killed Windows process exits with code 1.
  - **The CLI's error text was shown unescaped in a warning notification.** It now goes through `RecipeYamlScalar.escapeForNotification`, because a notification renders `[label](command:…)` as a link that runs the command.
- **Tests:** `SalesforceOrgService` (with an `sf org list --json --verbose` fixture and matching authorization files in `tests/mocks/`), the Data-by-Org suite, `VSCodeWorkspaceService`, `CollectionsApiService`, `ExtensionCommandService`, and `RecipeCockpitConnectedOrgs.test.ts`, which runs all four pickers through one fixture and asserts a single `execFile`.

## [3.38.0] - The Recipe Cockpit compares each relationship tree with an org, and the Classic list is gone

Closes [#181](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/181), slice 8 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Until this slice the org comparison and **Regenerate recipe** lived only in the Classic list, a second layout of the same run beside the tree cards. They now live in each card's **Structure** tab, and the Classic list is removed.

- **Compare with an org…** is at the top of each card's Structure tab, and describes **that tree's objects only** (the objects of the card that have a recipe, once each).
  - It uses the org picked in **Data-by-Org**, or the one Data-by-Org remembers for this workspace (looked up in the CLI's local authorizations, which contacts no org). With neither, it asks with the authorized-org quick pick, as before.
  - **Choose another org…**, beside it, always opens the quick pick of every authorized org. Data-by-Org never lists a production org, so without it a reader who had once picked an org in Data-by-Org could no longer compare a tree with production (found in review).
  - The panel posts only the card's tree key (`selectOrg {treeKey}`, plus `chooseOrg: true` for the picker; anything but a literal `true` is the ordinary Compare). The host matches it against `describableObjectApiNamesByTreeKey`, a pending/active allow-list of the confirmed-drawn model (`collectDescribableObjectApiNamesByTreeKey`), and reads the objects from there.
  - `orgDescribe` and `orgProgress` now carry the `treeKey` they answer. Comparisons are kept per tree, so comparing a second card leaves the first card's answer on screen, and a reloaded document gets every card's comparison back.
- **Diff badges** (`new in org`, `removed from org`, `type changed`, `picklist changed`, `unchanged`) and their details attach to Structure field rows. A field only the org has is a row of its own on the object's first occurrence in the card. Each object header says how many fields the org described and what changed, or *not compared*.
- **The status filter works within a card.** It appears in the card once a comparison is drawn, narrows only that card's rows, combines with the find box, and keeps its card open even when nothing matches. A card outside the 🔍 scope is still counted in the toolbar while its own status filter narrows it. A new model resets it.
- **Regenerate recipe** sits beside the card's comparison with its existing wording and note. It posts the card's tree key, is routed only beside that card's stored comparison, and reloads the run into the cards with that card open on its Structure tab. A click disables Regenerate in every card, because the host runs one at a time and the reload redraws them all.
- **Structure rows show the faker expression.** The find box already matched fields by their expression, and with the Classic list gone that match would otherwise have nothing on screen to show for it.
- **The Classic list is removed:** its view, its rows, its filter, its stylesheet rules and its view button. The view switch is **Recipe Trees · Data-by-Org**. `describableObjectApiNames` and `orgDescribeMessage` are replaced by their per-tree forms, and no message type, allow-list or function serves only the old layout. An object's `recipeFileName`, which only the Classic list drew, is no longer posted.
- `RecipeCockpitMetadataDiff` is unchanged.

**Unhappy paths.**
- A describe that fails for one object marks only that object's rows *not compared*. The card's other objects keep their statuses.
- Switching run mid-comparison drops the stale answer (the existing `renderSequence` rule, on the host and in the panel).
- A comparison or progress message naming a card the model does not draw is ignored.
- A card that was never compared says nothing about an org, rather than *not compared*.

**Tests.** Every existing diff and regenerate test is ported to the cards rather than deleted: the router (`selectOrg` and `regenerateRecipe` by tree key, refused for a tree the model does not offer, for an inherited member name, before the ack and while in flight), the replay of several comparisons, the panel's badges, details, *not compared*, status filter, progress and regenerate in the Structure tab, and the host's describe, cache, connection failure, cancel, run switch and regenerate flows. New: comparisons and status filters stay in their own card, an answer for a collapsed card is drawn when it opens, a regenerate reload opens its card on Structure, and Compare uses the Data-by-Org org (picked, remembered, or the picker when neither is usable). The shared panel harness now drives the Structure tab.

## [3.37.0] - Create N fake records of one object in a sandbox from the Recipe Cockpit

Closes [#180](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/180), slice 7 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Adding more data for one object in an org meant generating a whole tree's data set, inserting all of it, and wiring the recipe's lookups to parent records by hand. Each object row in **Data-by-Org** now has a number input and **+ Create**.

- **Controls.** Once an org is selected, each object row of an expanded tree shows a number (1 by default) and **+ Create**. The panel will not post a count that is not a whole number from 1 to 200, and the host refuses any other count whatever the panel sends (`RecipeCockpitRecordCreation.isValidCreateCount`: `0`, `201`, `2.5`, `"abc"` and `"25"` are all refused).
- **Create is disabled, with the reason on the row,** when:
  - the org's `IsSandbox` is false, Developer Edition included (`Records are created only in a sandbox, and this org is Production · Developer Edition.`)
  - the Organization query failed — it fails closed
  - the object is not in the org, or not createable (the describe's object-level `createable`, now normalized as `isCreateable`)
  - a required parent has 0 records, or could not be counted
  - a required lookup is polymorphic
  - another Create is running (every button is disabled on the click, and the host's `createState` re-enables them, replayed to a reloaded document)
  - The answer is posted as `dataOrgReadiness` once the counts are in. An org that has not answered that it is a sandbox is asked nothing more.
- **Required lookups** are the lookups the describe marks `nillable: false` (every master-detail included), leaving out ones the org fills itself (`defaultedOnCreate`, now normalized — `OwnerId` is the usual one), ones the user cannot write, and `RecordTypeId`. Each is filled with a random existing Id from `SELECT Id FROM <Parent> LIMIT 2000` (`SalesforceOrgService.queryRecordIds`, which refuses a non-api name and keeps only Id-shaped answers). Every other lookup is removed from the records, so it is left blank rather than sent as a TODO or an ancestor's nickname.
- **Host-side modal** (`showWarningMessage` with `modal: true`) shows the org alias and username, Sandbox, the object, the count, each required lookup with its parent's record count, the backend and the recipe tree. Cancel writes nothing and contacts the org no further.
  - The org's type is queried again, on the connection the insert will use, before the modal — not read from the selection.
  - After the confirm, the host refuses if the selected org changed between the click and the confirm.
- **Generation:**
  - `RecipeCockpitRecipeWriter.extractObjectBlock` (pure, still no imports) cuts the object's own block from the tree's recipe: its header, properties and fields block with every comment, moved to column zero when it was a friend, its own `friends:` block left out, and `count:` set to N. An object written twice (#188) is picked by its nickname.
  - It is written as `BaseArtifactFiles/createRecipe-<Object>.yml` in a new data set folder (with the run's wrapper copied beside it, so **Insert…** works on it too), then run through the configured processor unchanged.
  - A recipe generated for the other backend is refused, with Run Faker's message.
  - Lookup TODOs and nickname values are replaced after generation (`RecipeCockpitRecordCreation.assignLookupIds`, pure, with its randomness handed in).
  - `RecordTypeId` uses the existing developer-name → Id swap.
- **Insert** goes through the Collections API callout the directory insert uses, with `allOrNone: false`, via the new `CollectionsApiService.insertRecordsWithoutRollback`: 200 records a request, each rejected record reported by its position with Salesforce's messages, a request that failed outright recorded as a failure of each of its records, and nothing deleted. Results are written to `InsertAttempts/insertAttempt-<ts>/insertAttemptResults-<ts>.json` as today.
- **`datasetSource.json`** gets `origin: "createInOrg"`, `orgUsername`, `createdObjectApiName` and `createdRecordIds` (`DatasetSourceService.buildCreateInOrgDatasetSource`; the reader type-checks all three, and requires them exactly when the origin is `createInOrg`). It names the tree's recipe run and folder, so the data set shows in that tree's **Previous Fake Sets** after the reload.
- **The row shows the result:** `✓ 25 created`, or `23 created · 2 failed` with **View errors**, which opens the results file. The result is kept on the host per org username, tree and object, and survives the reload a Create ends with. The object's cached count is cleared, so the reload re-counts it.
- **Allow-list.** The panel posts the org index, tree key, object api name and count. The host requires the index to be the org selected now and that org to have answered it is a sandbox, matches the tree and object against `creatableObjectKeys` (pending/active, from the rendered model's trees that have a recipe file) and resolves the recipe file from the host-only map ▶ Run Faker uses. A production org cannot be reached even with a forged message: the router refuses before any connection, and the readiness check refuses again after a fresh Organization query.
- **Both backends** produce N records with the required lookups set. Snowfakery still runs through `execFile` with no shell.
- **Data-by-Org never connects to a production org.** This tightens what 3.36.0 shipped.
  - **Before any connection:** the dropdown lists only orgs the Salesforce CLI knows are not production (`SalesforceOrgService.listDataOrgDetails`, `isKnownNonProductionAuthorization`): a scratch org, an org the CLI recorded as a sandbox, or one whose instance url is a sandbox's (`<domain>--<name>.sandbox.my.salesforce.com`, or the pre-enhanced-domain `<domain>--<name>.my.salesforce.com`). The url is read too because the CLI records a sandbox only when its production org is authorized as well. Anything else — production, a Developer Edition, an authorization that says nothing — is left out, and the view says how many were (`2 authorized orgs are not listed: …`). With none left, it says no sandbox or scratch org is authorized and how to authorize one. A remembered org that is no longer listed is forgotten.
  - **After connecting:** the Organization row is the deciding answer. An org that answers it is not a sandbox, or cannot say (the query failed), is asked nothing more: no count, no describe, no Create, and the view says why. This replaces 3.36.0's "type unknown, and the counts still load".
  - The Classic list's **Compare with an org…** and **Insert Data Set by Directory** are unchanged.
- **Fixed in review (PR #199):**
  - Create inserts only when the backend generated exactly the N records the dialog confirmed. Before this fix, a cut block that nested another `- object:` of the same object could insert more.
  - After the dialog, Create requires the SAME selection the reader confirmed. Choosing another org, ⟳, or a reload of the run all refuse it, rather than only a change of org.
  - Re-listing the orgs ends the current selection and selects the remembered org again by username in the new list. Before this fix, ⟳ re-selected by the old index, which could point at another org or nothing.
  - A failure to draw ends a selection still counting, as `ready` and a new model already did.
  - Optional lookups are removed, and required ones replaced, whatever case the recipe wrote the key in.
  - A failed insert request is reported per record as "whether this record was saved is unknown", not as a known failure.
  - `insertRecordsWithoutRollback` reads results as `unknown`, with no explicit `any`.
  - `RecordTypeService.getRecordTypeIdsByConnection` now sends only api names into its SOQL, and makes no query when none is left.
- **The preview warning says the cockpit can write to an org.** Before this slice it described a read-only panel. It now says Data-by-Org's **+ Create** inserts records into the selected org, that Data-by-Org never lists or connects to production, that Create is offered only for an org that reports itself as a sandbox, after a confirmation each time, and never deletes or rolls back.
- **`checkPackagedPaths.test.js` bundles the current source itself** (the packaging build's own options, into a temporary folder) instead of reading `out/`. It failed on a fresh checkout, where nothing had bundled yet, and would have passed on a stale `out/` that no longer matched the source.

**Tests.**
- **`RecipeCockpitRecordCreation.test.ts`** (new): the module imports nothing; count validation; required and blanked lookups; every guard (production, Developer Edition, a failed Organization query, a non-boolean sandbox flag, not in org, not createable, polymorphic, a parent with 0 records or not counted); lookup Id assignment tested pure, records left unchanged, picks kept in range.
- **`RecipeCockpitRecipeWriter`:** block extraction and count setting for every object at every depth of every fixture (fields equal to the original's, one top-level object, no friends), comments kept, friends left out, a duplicate picked by nickname, and every refusal.
- **`RecipeCockpitCreateInOrg.test.ts`** (new):
  - routing and allow-lists: valid routing, every refused count, another org's index, an object or tree not offered, no selection, an undrawn model, a production or unknown-type org, a Create in flight, View errors only for a failed result
  - `computeCreateReadiness`: a production org is asked nothing; a sandbox's describes and parent counts
  - the modal's detail, and modal cancel writing and querying nothing
  - both-backend generation through to the inserted Collections API records, the snowfakery `execFile` argv, the `createInOrg` source file and the reloaded Previous Fake Sets
  - the row result after the reload, re-counting, View errors and a missing results file
  - unhappy paths: the org changed before the confirm, an org that now answers Production, a backend mismatch, a parent deleted between counting and inserting (per-record failures, nothing rolled back), a deleted recipe file, a block that cannot be cut, no parent Ids, no records generated, a failed generation and a failed describe
  - the panel's controls, posted payload, client-side count refusal, results, stale readiness and the running state across a model
- **`CollectionsApiService`, `DatasetSourceService`, `SalesforceOrgService`:** the no-rollback insert, the `createInOrg` source round trip and link, `queryRecordIds`, and the new describe fields.

## [3.36.0] - The Recipe Cockpit's Data-by-Org view counts each tree's records in an org

Closes [#179](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/179), slice 6 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

There was no way to see, from the recipe's point of view, how much data an org holds for each object in each relationship tree.

- **A Data-by-Org view joins the view switch:** Recipe Trees · Data-by-Org · Classic list. It is the only place in the redesigned views that picks an org; the Classic list's **Compare with an org…** is unchanged. The find box is hidden in this view, since it lists no fields to find.
- **Org dropdown** (a native `<select>`):
  - Its options are the CLI's authorized orgs from `SalesforceOrgService`, labelled by alias, or by username when there is no alias.
  - The host posts LABELS only. The panel posts back the chosen option's **index into the list the host posted** (`selectDataOrg {orgIndex}`), never a name, and the host refuses anything that is not an integer index into that list. The username never reaches the panel.
  - With no authorized orgs it shows the existing "no authorized orgs" message.
- **On choosing an org** the host connects by username and queries `SELECT IsSandbox, OrganizationType FROM Organization`. The label reads **Sandbox**, or **Production · \<OrganizationType\>** (a Developer Edition is Production). A failed query reads **type unknown**, and the counts still load.
- **The choice is remembered per workspace** in `context.workspaceState`, keyed by username.
  - Reopening the cockpit preselects it, but contacts no org until the Data-by-Org view is opened. Listing the orgs reads only the CLI's local authorizations.
  - An org no longer authorized is dropped silently, and forgotten.
- **Counts:**
  - Every tree is listed in Recipe Trees order. Its header shows the object count and the total records in the org (`3 objects · 4,500 records in the org`, with `· 2 not counted` when some could not be).
  - Expanding a tree lists its objects in insert order with `SELECT COUNT() FROM <Object>` counts: a number, `not in org`, `no access` or `could not count`, with the reason on hover.
  - A later occurrence of an object (#188's child iteration) is the same object in the org, and is counted once.
  - Counts are posted as they arrive, ten at a time, with an `n of m` progress line.
- **New `SalesforceOrgService.countRecords`:**
  - checks each name with `isUsableObjectApiName` before any query, so `Account; DELETE` is refused and never reaches SOQL
  - runs 5 queries at a time
  - caches successes per username and object for the session, never failures
  - reports each object as `count`, `notInOrg` (`INVALID_TYPE`), `noAccess` (`INSUFFICIENT_ACCESS…`) or `failed`
  - `queryOrganizationType`, `normalizeOrganizationResult` and `buildOrgTypeLabel` are the org type; an answer not typed as expected is undefined, never a guess either way
- **A failed connection** is reported once for the whole org, not per object, and every row then reads `could not count`.
- **⟳** clears the selected org's cached counts and counts again.
- **Stale answers are dropped.** Each selection carries a `requestSequence`, and every count and selection message carries the model's `renderSequence`.
  - The host stops counting, and posts nothing more, for a selection the reader has replaced or a model that is no longer on screen. Choosing another org mid-count discards the first org's answers.
  - The panel drops a message for an older selection or an older model.
  - A new model empties the countable objects until its `rendered`, like every other allow-list. The panel asks again for the new model when Data-by-Org is on screen.
- **Read-only.** Nothing writes to an org.

**Tests.**
- **`SalesforceOrgService`:** `countRecords` and its cache (per username, per object, failures never cached, clearing one org or one object), the five-at-a-time limit, refusal of non-api names before any connection, a failed connection, cancellation, and the org-type query and its labels.
- **`RecipeCockpitDataByOrg.test.ts`** (new):
  - index-only routing, refusing a username, an alias, a string, an out-of-range, negative or fractional index, and a selection before the draw is confirmed
  - workspaceState persistence: remembered on select, preselected on reopen with no org contacted until asked, and an unauthorized org dropped without a warning
  - sandbox, Developer Edition and type-unknown labels; notInOrg; a failed connection reported once
  - stale-answer dropping: another org mid-count, and a new model mid-count; ⟳ re-counting
  - panel rendering: the view switch, tree and object order, the select's labels and posted index, counts and totals, uncountable objects, older selections and models dropped, a failed connection, ⟳, and labels written as text
- **`RecipeCockpitPanelHarness.ts`:** the fake-DOM harness that runs the real panel script, moved out of `RecipeCockpitService.test.ts` so both suites share it.
- **`ExtensionCommandService`:** the cockpit is handed the extension's `workspaceState`.

## [3.35.0] - A self-lookup adds a nested child iteration of the same object

Closes [#188](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/188), a follow-up to [#46](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/46) under [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

#46 left a self-lookup (`Account.ParentId → Account`) as `### TODO -- REFERENCE ID REQUIRED`, so every parent/child hierarchy of one object (parent accounts, manager users, parent cases) still had to be written by hand.

- **faker-js recipes add one nested child iteration for each object with a self-lookup.**
  - It is written last in the object's `friends:` block, under a comment naming the self-lookup fields, with the nickname `<Object>_child_NickName`.
  - Every self-lookup field of the child iteration holds the parent iteration's nickname. If an object has more than one self-lookup field (`ParentId`, `MasterRecordId`), all of them point at the same parent. The top iteration keeps its TODO.
  - Its other lookups to ancestors are wired as they are for any friend. The object counts as its own ancestor, so #46's `wireAncestorLookups` wires the self-lookup with no code of its own.
  - **Only one level, and no other friends.** The child iteration carries none of the object's `friends:` children, so nothing recurses. Adding them one by one from the cockpit is a separate issue.
  - A self-lookup filled in by a mapping or by hand is left as it is, in both iterations.
  - A tree whose only relationship is a self-lookup is now written through the nested combiner.
  - `RelationshipService.hasSelfLookup` and `buildSelfLookupIterationNickname` are the two rules.
- **Run Faker by Recipe needed no change.** #46's ancestor-nickname map already points each child iteration's `ParentId` at the parent record it is generated under, for every parent iteration when `count > 1`. Each child also gets a generated nickname of its own (`Account_Account_NickName_<n>`).
- **Insert Data Set by Directory inserts a file in rounds.**
  - A child Account and its parent are in the same `collectionsApi-Account.json`, and every record of a file used to go in one request. So the child was sent with the parent's nickname as its `ParentId`, and Salesforce rejected it.
  - `CollectionsApiService.partitionRecordsIntoInsertRounds` orders a file's records into rounds. A record whose field is the nickname of another record in the same file waits until a round inserts that record. A later round's lookups are resolved against the Ids the earlier rounds created.
  - A file with no such reference is one round: exactly the request it always was.
  - References that can never be met (a cycle) are sent together in a last round, as before.
  - An all-or-none failure in any round deletes what was saved and stops before the next round.
  - `readNicknameFromReferenceId` is the one rule for reading a nickname out of a reference id, shared with `updateLookupReferencesInCollectionApiJson`.
- **The Recipe Cockpit tells two occurrences of one object apart by nickname.**
  - `scanRecipeObjects` records each object's `nickname:` values (`nicknames`) and the header line of the object whose `friends:` block holds it (`parentHeaderIndex`).
  - **Reader:** `parseRecipeSource` still keys by api name and still reads the first occurrence there. A later occurrence becomes an `iterations` entry on it, with its own header and field lines and its parent's name and nickname, but only when the two can be told apart: each has a nickname no other occurrence of the object carries. Otherwise the first wins, as before.
  - **Model:** an object written twice carries its `nickname` and its `iterations`, and only their line numbers and values are posted. An object written once is posted exactly as before.
  - **Structure tab:** the card lists the child iteration right after its object (`Account_child_NickName · nested under Account_NickName`). An object a hand edit wrote twice at the top level is listed by its nickname alone, not as nested. Its `↗ yml` and header links open the nested occurrence's lines, and the open allow-list names each of them.
    - The card's object and field counts count the object once.
    - The find box matches an iteration by its nickname, and its rows by their own values.
    - A field only the iteration writes is drawn as read from the recipe file.
  - The Classic list is unchanged: one row per object.
  - **Writer:** every operation takes an optional `objectNickname`, and the refusal or edit names it.
    - With the nickname it changes only that occurrence.
    - Without it, an object written twice is still refused as `duplicate-object`, now saying a nickname is needed.
    - A nickname no occurrence carries is `object-not-found`; one that two carry is `duplicate-object`; a malformed one is the new `invalid-object-nickname`.
- **Snowfakery recipes are unchanged:** still flat, one entry per object, self-lookups still TODO.
- **Found in review, and fixed:**
  - **The child-iteration comment reopened #120.** It named the self-lookup fields straight from `RelationshipDetail`, which records a lookup's field name as the XML gave it, including one the api-name rule refused. A `<fullName>` with line breaks wrote a whole extra object into the recipe, and Run Faker by Recipe evaluated its `${{ … }}`.
    - Only api names reach the recipe now (`RelationshipService.getWritableSelfLookupFieldNames`, through `SalesforceApiName`).
    - A self-lookup whose every name was refused adds no iteration.
    - The #120 fixture gains a hostile self-lookup, which the real pipeline, both YAML parsers and Run Faker now hold to the same bar as every other name.
  - **Partitioning was quadratic in records sharing a nickname**, which every snowfakery record of an object does: 19 s at 50,000 records, blocking the extension host. The holder list is now appended to rather than copied, and a test pins 50,000 records under 2 s.
  - **A later insert round re-matched the whole run's reference map.** It is now matched only against the Ids this file's earlier rounds created; every earlier file's reference was already resolved.
  - `partitionRecordsIntoInsertRounds` takes and returns `unknown` rather than `any`.
  - A YAML comment after a `nickname:` value is no longer read as part of the nickname.

**Tests.**
- **`RelationshipService.nestedFriends.test.ts`** replaces "a self-lookup keeps its TODO" with:
  - the exact output for a lone self-lookup object
  - the iteration after other friends, with no friends of its own
  - several self-lookup fields
  - a nested object with a self-lookup (its ancestors wired too)
  - a hand-filled self-lookup
  - snowfakery unchanged
  - the cockpit writer fixture held to this generator's output
  - an end-to-end run: generate, count 3 Accounts with 2 child Accounts each, run the faker-js processor, convert to Collections API files, then simulate the inserts in rounds. Every child Account's `ParentId` is its own parent's Id.
- **`DirectoryProcessor.generatedRecipeYaml.test.ts`:** the mock metadata's `Example_Everything__c` has a self-lookup. Over the real pipeline, faker-js now writes it twice, with the iteration's lookup wired, and snowfakery once. Every occurrence, not only the last loaded, is held to its object's flat recipe. RecordTypeId is one developer name per occurrence. `recipe-fakerjs-nested--RelationshipTree_1.yml` is regenerated from this output.
- **`FakerJSRecipeProcessor`:** a same-object friend resolves to the parent iteration it was generated under, for each of two parent iterations.
- **`CollectionsApiService`:** rounds for no same-file reference, parent and child iterations, a chain, a reference to a record's own nickname, a cycle, malformed records, and `processAndInsertCollectionFile` resolving a later round to the earlier round's Ids and stopping on an all-or-none failure.
- **`RecipeCockpitRecipeWriter`** (new fixture `recipe-fakerjs-selfLookup--RelationshipTree_1.yml`):
  - each of the five operations refuses the api name alone, an unknown nickname and a malformed one
  - replace, insert, comment out and restore (byte for byte), count and rename each work by nickname
  - a shared nickname is refused
  - a field or property refusal names the occurrence
  - the full per-field suite (replace, comment out and restore, insert, set nickname and count, in all four line-ending variants) now addresses each occurrence by nickname, so the regenerated nested fixture's Example_Everything__c iteration goes through it too
- **`RecipeCockpitService`:**
  - the reader's iteration
  - three cases where the occurrences cannot be told apart
  - a parent with no nickname
  - an object written three times at the top level
  - the object view model
  - card order and field count, from `RecipeFiles` and from the fallback
  - the open allow-list and router
  - the panel: both occurrences drawn, each link opening its own line, counts not doubled, a find-box match on an iteration's nickname and values, and an iteration the object does not hold left undrawn

## [3.34.0] - Run Faker from a Recipe Cockpit tree card

Closes [#178](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/178), slice 5 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Generating data for one tree meant leaving the cockpit, running **Run Faker by Recipe**, and finding the right file in a recursive picker. Each tree card now has a **▶ Run Faker** button.

- **▶ Run Faker on each tree card.**
  - It runs that tree's recipe from the run on screen. Its tooltip names the recipe file.
  - It appears only on a card whose folder holds exactly one `.yml` recipe in that run, inside the workspace.
  - When the run ends (written, failed, refused or cancelled at the modal), the cockpit reloads the run with the card open on **Previous Fake Sets**. The new data set is listed there and in **Previous Versions**.
  - While it runs, every Run Faker button is disabled. The button you clicked reads *Running Faker…*. A reload of the panel mid-run keeps them disabled.
- **The panel posts the tree's key, never a path.**
  - The host looks the recipe file up in a host-only map built with the model (`runFakerRecipeFilePathsByTreeKey`).
  - A new pending/active allow-list (`runnableTreeKeys`) holds only what the confirmed-drawn model offered. It follows the same rules as the other history actions: promoted on `rendered`, emptied on `ready`, on a new post and on a failure to draw.
  - Only one run at a time is routed.
  - A click the host refuses still gets an answer. The panel disables every button on the click, so without `runFakerState` they would stay disabled. This can happen when you click cards that a new run's model has replaced but not yet confirmed drawing.
  - The reload after a run uses the run on screen when the run ends, so switching runs during generation is not undone.
  - A recipe file deleted after the draw gets a "no longer exists" warning, nothing runs, and the run is reloaded.
- **Run Faker by Recipe takes an optional recipe path:** `runFakerGenerationByRecipeFile(recipeFilePath?: string)`.
  - Its registration returns the handler's promise, so the cockpit reloads when the data set is written.
  - Without a path, the palette command works exactly as before.
  - With a path, it skips the picker but keeps the confirmation modal and the configured backend. The path it reads and hands to the backend is the resolved path the checks ran on. It runs nothing and warns for any of these:
    - a path that is not a `.yml` file
    - a path outside `GeneratedRecipes/`, or one that fails `isPathContainedInWorkspace`
    - a file that no longer exists
    - a recipe generated for the other backend: *This recipe was generated for faker-js — switch with "Select Faker Implementation".* (or *snowfakery*)
  - The backend rule is `VSCodeWorkspaceService.readRecipeFakerService`. A test holds it to the picker's real walk over a real directory for both backends, so the two cannot drift.
- Snowfakery still runs through `execFile` with no shell ([#115](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/115)).

**Tests.**
- **Handler:** with a path for both backends (picker skipped, modal kept, data set written); without a path (picker used); refusal of an outside, out-of-`GeneratedRecipes`, `..`, `.yaml` and non-recipe path; a deleted file; a backend mismatch each way; a cancelled modal.
- **Snowfakery:** the recipe path reaches `execFile` as one argument, with no `shell` option and no `exec`.
- **Registration** returns the run's promise and passes only a string path.
- **Cockpit routing:** each card's file name with its path kept on the host; no button for a recipe outside the workspace; resolution through the host map; refusal before the draw is confirmed, for an unknown key, for a wrong payload type and while a run is in flight; the running state replayed after the model.
- **Cockpit execution:** the command handed the file; the reload focused on **Previous Fake Sets** showing the new data set; a second run refused mid-run; a failed command still reloads and re-enables; a cancelled modal; a deleted recipe file; no run from a reloaded document.
- **Panel:** the button and its tooltip; every button disabled on a click and across a reload; re-enabled by the host's `runFakerState`.
## [3.33.0] - faker-js recipes nest related objects under friends: and wire their lookups

Closes [#46](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/46), under [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Generate Treecipe wrote every object in a relationship tree as its own top-level entry, and every lookup as `### TODO -- REFERENCE ID REQUIRED`. So a generated recipe linked nothing: children were not created per parent, and every lookup had to be filled in by hand. The faker-js processor has read `friends:` since 2.11.0 (#45), but nothing generated it.

- **faker-js recipes nest each child under its parent's `friends:` block.**
  - Each object is still written once per tree. A friend's `count` is records **per parent record**.
  - An object with several parents in the tree is nested under the **closest** one: the deepest by relationship level, ties broken by name with `<`, never `localeCompare` (#166). Only a parent at a strictly lower level qualifies, so the nesting is a forest even when the lookups have cycles.
  - A lookup target with no recipe of its own (`User` with no folder) is not nested under.
  - The comment naming each object and its relationships moves with it, inside its parent's `friends:` block.
- **Lookups to ancestors are wired.**
  - A child's lookup to its parent, and to every ancestor above it, is written as that ancestor's nickname instead of the TODO. For example, a grandchild's `Account__c` holds the top-level `Account_NickName`.
  - Only a line that is exactly the generated TODO is rewritten, so a lookup filled in by a mapping or by hand is left alone.
  - A lookup to a parent that is not an ancestor keeps its TODO. So does a self-lookup such as `Account.ParentId`; nesting a second iteration of the same object is [#188](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/188).
- **Unchanged output:**
  - A tree with no relationships is written byte for byte as before.
  - **Snowfakery recipes are unchanged:** still flat, lookups still TODO. `DirectoryProcessor` turns nesting on from the faker service that writes the object recipes, so it never reads the configuration a second time.
- **Run Faker by Recipe resolves a lookup to any ancestor**, not only the direct parent. `FakerJSRecipeProcessor` hands each friend a map from every ancestor's YAML nickname to the nickname of the record it is being generated under. So with two top-level Accounts, every grandchild's `Account__c` points at the Account above its own parent.
  - The map is a `Map`, because a nickname is recipe text and could be `__proto__`.
  - `replaceParentNicknameReferencesInFriendFields` is replaced by `replaceAncestorNicknameReferencesInFriendFields`.
- **Insert Data Set by Directory replaces only a lookup value that IS a nickname.**
  - `updateLookupReferencesInCollectionApiJson` used to `replaceAll` each nickname over the whole JSON. A friend's generated nickname contains its parent's (`Contact_Account_NickName` contains `Account_NickName`), so inserting the parent rewrote the friend's own `attributes.referenceId`, and every reference to the friend was lost.
  - It now replaces a JSON string only when the whole string is the nickname, and never a key. A value that merely contains a nickname, such as a description, is no longer rewritten.
- **The Recipe Cockpit reads and edits nested recipes.**
  - `RecipeCockpitRecipeWriter.scanRecipeObjects` keeps the open objects as a stack, one per `friends:` level. Each level moves every column of the layout contract four spaces deeper: `- object:`, `nickname:`/`count:`, `fields:`, field lines, continuations and the commented-out-field marker.
  - A `- object:` line opens a friend only at the next level down, and only inside its parent's `friends:` block. Anywhere else it is an unrecognized line, as before.
  - `RecipeCockpitService.parseRecipeSource` now reads through that same scan rather than a second copy of it, so the line the panel jumps to and the line an edit changes cannot disagree.
  - Every nested object gets its recipe file, `↗ yml`, field line numbers and recipe-only fields.
  - The fallback cards (a wrapper with no `RecipeFiles`) list nested objects in file order.
  - Every writer operation works at a friend's depth. A value passed to `insertField` or `replaceFieldValue` is written as for a top-level object, and its continuation lines are moved to the friend's depth.
  - An object written at two depths is refused by the writer and read first-wins, as a duplicate always has been.
  - A flat recipe scans exactly as before: depth zero is the old contract.

**Tests.**
- `RelationshipService.nestedFriends.test.ts` covers:
  - a single child, written out in full
  - several children
  - a child with two parents (nested under the closer one, both lookups wired)
  - a second parent that is not an ancestor (TODO kept)
  - a self-lookup
  - a lookup target with no recipe
  - a hand-filled lookup
  - a block scalar
  - the flat and snowfakery cases
  - independence from insertion order
  - an end-to-end run: generate, run the faker-js processor, convert to Collections API files, then simulate the inserts. Every grandchild resolves to its own parent and that parent's Account.
- The DirectoryProcessor suites now load what Generate Treecipe actually writes (`objectInfoWrapper.RecipeFiles`) rather than regenerating flat files. `DirectoryProcessor.generatedRecipeYaml.test.ts` asserts that, over the whole mock metadata, every object loads with the same fields as the flat recipe apart from the lookups nesting wired.
- The hostile picklist fixture is nested under a synthetic parent and must load identically in js-yaml and PyYAML. Run Faker over it must evaluate nothing.
- The writer's full per-field suite (replace, comment out and restore, insert, set nickname and count, in all four line-ending variants) also runs against a new fixture, `recipe-fakerjs-nested--RelationshipTree_1.yml`, which is the real pipeline's nested output for the mock metadata. Scanner edge cases cover siblings after grandchildren, a parent property after its `friends:` block, headers outside a `friends:` block or at the wrong column, and an object at two depths.
- New `CollectionsApiService` tests cover the nested-nickname collision, keys and a grandchild's two lookups. New `FakerJSRecipeProcessor` tests cover top-parent resolution with `count > 1` and the nearer ancestor winning a shared nickname.
## [3.32.0] - Recipe Cockpit tree cards show Previous Versions and Previous Fake Sets

Closes [#177](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/177), slice 4 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

You could not see how a tree's recipe changed across Generate Treecipe runs, or which data sets each version produced, without browsing `GeneratedRecipes/` and `FakeDataSets/` by hand. Each tree card now has two more tabs beside **Structure**.

- **Previous Versions.**
  - Lists every run that wrote this tree's folder, newest first by the run's timestamp suffix rather than its folder name.
  - A tree is matched across runs by its **folder name**, the one identity it keeps between runs.
  - Each row shows:
    - the date;
    - the backend;
    - the field count;
    - the change against the current version, worded from the version's side (`+2 fields` means that version had two more), or `same field count`;
    - `backend ≠` when the backend differs;
    - a `current` marker on the run on screen.
  - The field count comes from each run's objects wrapper, read only when the tab is **first opened** (`loadVersionSummaries`) and cached per run for the model on screen. It counts the fields the wrapper gives the tree's objects, so it excludes the recipe-only rows (standard-field mappings, the record type line) that the card header counts. A wrapper with no `RecipeFiles` is matched through the tree folder's recipe file instead.
  - A run whose wrapper cannot be read, or is missing, is listed as **"summary unavailable"** and can still be diffed.
- **Each version expands** to the data sets made from it, with their date and per-object record counts.
- **`Diff`** runs `vscode.diff` between that version's recipe for the tree and the current one: the single `.yml` in each tree folder. A version with no such file, or with more than one, offers no `Diff`.
- **Previous Fake Sets.**
  - Lists every data set linked to this tree (through #176's `datasetSource.json`, or inferred for an older data set), newest first.
  - The same-second `-<n>` suffix orders after the plain name.
  - Each is tagged `current version`, `version of <date>`, or **`version unknown`** when only the tree matched.
  - `DatasetSourceService` now returns a `treeFolderNameHint` on an `unknown` result that still names a plain tree folder: a recorded run that is gone, or legacy copies whose run is gone or disagrees.
- **Unmatched data sets** are counted in one panel notice, e.g. "3 data sets couldn't be matched to a recipe tree". These are data sets with no source, an unreadable one, a recipe outside any tree, or a tree that is not one of the cards on screen.
- **`Open`** reveals the data set folder in VS Code's Explorer (`revealInExplorer`).
- **`Insert…`** runs **Insert Data Set by Directory** with that folder pre-selected.
  - The handler takes an optional folder path, and its registration returns the promise.
  - The palette command still shows its folder picker, and the org and AllOrNone prompts are unchanged.
  - Because the command can be executed by id with any argument, a pre-selected folder is used only if it is an existing directory inside the workspace; otherwise the command warns and inserts nothing. The registration passes on only a string.
- **Names, never paths, and an allow-list per action.**
  - The panel posts tree keys, run folder names and data set folder names. Each is matched against its own allow-list drawn from the rendered model's histories: summaries, diffs, open, insert, and legacy counts.
  - Allow-lists go pending → active on `rendered`, and are emptied on every `ready`, every newly posted model and every failure to draw.
  - Each name is resolved through a host-only map (`IRecipeCockpitTreeHistoryTargets`) built when the model was. No path reaches the panel; a test pins that the posted histories name no workspace path.
  - Every recipe and data set path passes `isPathContainedInWorkspace` when the model is built (an outside path is left out, so its data set is absent and its version not diffable) and again, with an existence check, when it is used.
- **Legacy record counts.** A data set without `datasetSource.json` has its counts read from its `DatasetFilesForCollectionsApi/collectionsApi-<Object>.json` files when the version or the Fake Sets tab shows it, once per model however many rows show it (`DatasetSourceService.countLegacyRecordsByObject`). A file that is not JSON with a `records` array is named in the row rather than counted as zero.
- **Unhappy paths.**
  - A data set folder deleted after rendering: `Open` or `Insert…` says it no longer exists and reloads the run on screen. The host posts a `focusTree`, so the reader's card and tab re-open; it is kept only when it names a card of the model and a history tab.
  - A recipe file deleted after rendering: `Diff` says so instead of opening.
  - A legacy data set deleted before its counts are read says it is gone.
- **Other behaviour.**
  - A search that opens a card's rows switches that card back to Structure.
  - The ungrouped card, and a fallback card for a recipe file with no tree folder, have no history and draw only the Structure tab.
  - Every name read from disk is written with `textContent`, and the panel's name-keyed maps have no prototype.
- **Found in review, and fixed:**
  - **Opening Previous Versions parsed every run's wrapper in one synchronous pass.** At 370 MB per wrapper, 10 runs blocked the extension host on about 3.7 GB. Now:
    - Only the field counts are kept, in a cache keyed by the wrapper's path, size and modification time. The cache outlives a model, so a reload, run switch or regeneration re-reads only a wrapper that changed.
    - The current run's counts come from the load, which already parsed that wrapper.
    - Every other wrapper is read after a yield and posted on its own. Each post is cumulative and names only the runs it knows, so the rows fill in as wrappers are read.
    - Closing the panel stops the walk.
  - **Previous Fake Sets read every legacy data set's Collections API files as soon as the tab opened.** A legacy row on that tab now has a **Show record counts** button. Expanding a version is still its own request.
  - **`focusTree` was stored with the model, so every reveal replayed it** and re-opened a card the reader had closed. It now rides only on the post that follows the reload.
  - **A recipe file name was shown in a warning unescaped.** A name shaped like `[label](command:…)` would have rendered as a link that runs a command. The new warnings and the two older `openSource` warnings now go through `RecipeYamlScalar.escapeForNotification`.
  - **Two containment gaps.**
    - The tree recipe read by the fallback field count now passes workspace containment when it is used.
    - A data set whose `DatasetFilesForCollectionsApi` folder resolves outside the workspace is no longer counted.
  - Not changed: a double click on `Insert…` starts two inserts, each with its own org prompt, the same as running the palette command twice.
- New pure-ish module `RecipeCockpitService/RecipeCockpitTreeHistory.ts`: discovery, grouping, ordering, summaries and change wording, with fs only for directory listings. `DatasetSourceService` still imports only `fs` and `path`, and repeats the `DatasetFilesForCollectionsApi` folder name; a cockpit test holds it equal to `ConfigurationService`'s.

**Tests.**
- `RecipeCockpitService.test.ts`, against a new `historyWorkspace` fixture: the tree workspace's runs, a faker-js run with an unreadable wrapper, and data sets that are recorded, suffixed, legacy, of a gone run, loose, malformed, and of a tree that is not on screen.
  - Tested pure: `groupTreeHistories` (ordering, same-second ties, repeated folders, unmatched counting), summaries and change wording, and field counts with and without `RecipeFiles`.
  - The loader end to end, including paths outside the workspace.
  - Every history route: before `rendered`, unknown names, wrong types, a missing target, focus validation.
  - The real panel script: both tabs, summary answers for the model on screen only, version expansion, legacy count requests deduplicated, Open/Insert/Diff posts, focus after `rendered`, Structure on search, and text only.
  - The host executor through a fake webview: diff, reveal, insert, reload on a deleted data set, deleted recipe file, deleted legacy data set, and allow-lists emptied on `ready`.
  - One existing expectation changed: an expanded card now has three tabs, not one.
- `DatasetSourceService.test.ts` covers the tree hint (recorded and legacy, never on a linked or unsafe result) and `countLegacyRecordsByObject`.
- `ExtensionCommandService.test.ts` covers Insert with no folder (picker), a pre-selected folder (no picker, unchanged org and AllOrNone prompts), and a missing, outside or `..` folder (refused).
- `extension.test.ts` covers that the registration returns the insert and passes on only a string.

## [3.31.0] - The Recipe Cockpit shows each relationship tree as a card with a Structure tab

Closes [#175](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/175), slice 2 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

The cockpit listed every object in a run as one flat list. It didn't show which relationship tree an object belongs to, the order objects are inserted in, which lookup ties a child to its parent, a field's size, or a picklist's values. It now opens on **Recipe Trees**: one card per tree, showing its objects in insert order with their lookups, sized field types and picklist values.

- **Two views.** **Recipe Trees** is the default. The flat list is still there as **Classic list** and behaves exactly as before, with Compare with an org, the diff badges, the status filter and Regenerate recipe. Those controls show only in the Classic list until slice 8. The chosen view is kept when another run is loaded.
- **One collapsible card per tree**, in `RecipeFiles` order and collapsed at first:
  - Title: "Relationship Tree N".
  - Subtitle: the folder the tree was written to (`Account-thru-OtherChildObject__c`, `Lead-ONLY`).
  - Header counts: `N objects · M fields`.

  A card is identified by its folder name, not by N. Generate Treecipe and the cockpit now name that folder with one shared rule, `RelationshipService.buildRecipeTreeFolderName`. A card's tab strip has one tab, **Structure**; slice 4 adds the other two.
- **Structure tab.**
  - Objects appear in insert order. A lookup target with no recipe of its own (for example `User`) is not listed, as in the Classic list.
  - Each object shows the lookups tying it to a parent in the same tree, from `RelationshipDetail.parentObjectToFieldReferences`, e.g. `(AccountId → Account)`. A self-lookup shows as `(ParentId)`.
  - Field rows show the type with its size: `Text(50)`, `Currency(18,2)`, `Percent(5,2)`, and `Number(18,0)` for a precision with no scale. Other fields show the bare type.
  - `↗ yml` opens the recipe at the field's line.
  - A dependent picklist says `controlled by <field>`.
- **Generate Treecipe records `length`, `precision` and `scale`** on each `FieldInfo` in the objects wrapper, only when the field XML has them. A field without them serializes exactly as before. A run from before this change shows bare types, and nothing else differs.
- **Picklist and multi-select picklist rows expand to their values.** Each record type's values are grouped under a `Record type: <DeveloperName>` heading, in the `RecordTypesMap` order (#166 sorted it at load). A picklist with no values says "no values".
- **Picklist values are posted to the panel for display, one row at a time.** The issue set 60 MB at 120,000 fields as the line for loading values on expand instead, and posting them with the model measured 96.17 MB. So:
  - A row carries only `isPicklist`.
  - Expanding it posts `loadPicklistValues {objectApiName, fieldApiName}`. The message carries names, not a path.
  - The host answers only for a picklist row of the model the panel has confirmed drawing. That set is a new pending → active allow-list, promoted on `rendered` and emptied on every reload, new model and failure to draw. An answer for an older model, or for a row that did not ask, draws nothing.
  - Values are written with `textContent`.
  - The diff's own copy of the values is unchanged and is never posted.
- **Search filters across trees.**
  - The find box is shared with the Classic list.
  - A tree with no match stays on screen, collapsed and labelled "no matches".
  - The 🔍 on a tree header limits the search to that tree. A line says which tree is being searched, with a button to search every tree again. Other trees show "not searched" and keep whatever the reader had open.
  - Auto-expand spends one `RECIPE_COCKPIT_AUTO_EXPAND_*` budget across all trees, and opens a card only for an object it opens.
  - Picklist values are not searched, because the panel doesn't have them until a row is opened.
- **Unhappy paths.**
  - A wrapper with no or an empty `RecipeFiles` renders one card per recipe `.yml` in the run. Its objects are in file order with no lookups, and a notice says the tree data is missing.
  - An object no tree lists gets a "Not in a relationship tree" card, so it is never missing from the view.
  - A hand-edited wrapper that repeats a folder still gets two distinct cards.
- **Found in review, and fixed:**
  - **A keystroke filtered both views.** Each view's auto-expand builds rows, so a keystroke built up to 4,000 rows, half of them in the hidden view. It now filters only the view on screen, and the other view is filtered when the reader switches to it.
  - **Each field's search text was built twice.** The two views now share one lowercased search text per field. Each view also matches against the type it draws, so `text(50)` matches in Recipe Trees and not in the Classic list.
  - **An object named `__proto__` vanished from its card.** The panel's object index is now `Object.create(null)`.
  - **The 🔍 scope miscounted with an empty find box.** It now counts only the scoped tree.
  - **Rows sharing a key were not all answered.** When a hand-edited wrapper repeats a picklist field, every row that asked now gets the values, not only the last.
  - **Picklist values were read twice per field.** The diff's copy and the display copy now share one array.
- Open-source keys are allow-listed as before (pending → active on `rendered`). The tree's `↗ yml` and object links use the same keys as the Classic list.

### Measured

Run through the real `loadRecipeRunByRuns`, with a third of the fields being 50-value picklists, 100 fields per object and 10 objects per tree:

| Fields | Wrapper | Load | Posted with the model | Posted on expand (this release) | Before this release |
|---|---|---|---|---|---|
| 12,000 | 37.38 MB | 287 ms | 9.62 MB | 5.99 MB | 5.55 MB |
| 120,000 | 373.95 MB | 5.4 s | 96.17 MB | 59.94 MB | 55.47 MB |

One expanded row's answer is 1,054 bytes. Most of what is still posted is the faker expressions, which list all 50 values of each picklist. This release adds the type with size, the picklist marker and the trees: 0.44 MB at 12,000 fields and 4.47 MB at 120,000. These numbers are higher than 3.25.0's because those picklists had 15 values, not 50.

**Tests.**
- `RecipeCockpitService.test.ts`:
  - covers `formatFieldTypeWithSize` for every case above;
  - covers the tree model, built from a new fixture workspace with two tree folders and an older run with no `RecipeFiles`: order, folder keys, lookups and self-lookups, sizes, record-type values, the legacy fallback, an empty `RecipeFiles`, an unclaimed object and a repeated folder;
  - covers the `loadPicklistValues` route: refused before `rendered`, for a non-picklist row, an unknown object, wrong types and a smuggled separator;
  - runs the real panel script through `runPanelScript` for the default view and the switch, collapsed cards and their counts, the Structure tab, lookups, sized types, `↗ yml` against the allow-list, picklist expansion answered through the real router, stale and unasked answers, `textContent` only, search, scope, clearing and both auto-expand limits.
- An end-to-end test drives the host executor through a fake webview.
- `DirectoryProcessor.test.ts` checks that sizes are recorded only when the XML has them.
- `RelationshipService.test.ts` covers the folder-name rule.
- Expectations that pinned the old shape were updated: the field model, `trees: []`, the missing-tree-data notice on a run with no `RecipeFiles`, and the "values stay host-side" assertions this slice replaces.

## [3.30.0] - Every fake data set records the recipe run and tree that produced it

Closes [#176](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/176), slice 3 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

Run Faker by Recipe wrote `treecipe/FakeDataSets/dataset[-fakerjs]-<ts>/` with copies of the recipe and wrapper, but nothing in it said which Generate Treecipe run or relationship tree it came from, so the Recipe Cockpit had no way to show the data each recipe version produced. Two runs in the same second also failed, because the second `mkdirSync` hit `EEXIST`.

- **`BaseArtifactFiles/datasetSource.json`** is written on every run, with `schemaVersion: 1`, `origin: "runFaker"`, `recipeRunFolderName`, `recipeTreeFolderName`, `recipeFileName`, `fakerService`, `generatedAt` (ISO 8601) and `recordCountsByObject`. The counts come from the transformed Collections API records, so both backends write the same shape from their own processor output.
- **Names, not paths.** The names are taken from the recipe's position under `GeneratedRecipes/`. A recipe directly under it writes `null` for the run and tree; a recipe in a run folder with no tree folder writes a `null` tree. Every name is checked to contain no `/`, `\` or `..`. A recipe outside `GeneratedRecipes/` is reported as an error before any data is generated, rather than recording a name that is really a path.
- **Same-second runs.** The data set folder is created by trying `<name>`, then `<name>-2`, `<name>-3` and so on. `mkdirSync` is the existence check, so nothing can take a name between the check and the create. Any error other than `EEXIST` is still thrown.
- **New `DatasetSourceService/`**, which imports only `fs` and `path` (a test fails if it imports anything else). `readDatasetSource` never throws and returns:
  - `linked` for a type-checked file whose names match a run and tree folder on disk (`findKnownRecipeRuns`), or that records `null` for both;
  - `unknown` when a name is not a plain name (`"../../etc"`) or matches nothing on disk;
  - `unreadable` for malformed JSON, a failed type check, or a file that cannot be read;
  - for an **older data set** with no `datasetSource.json`, a link inferred from the copies' names: the run timestamp from `originalTreecipeWrapper-treecipeObjectsWrapper-<ts>.json` and the tree from `originalRecipe-<prefix>--<tree>-<ts>.yml`, with the recipe prefix choosing between the faker-js and snowfakery run of the same second. Zero or two copies of either, timestamps that disagree, or a run or tree no longer on disk read as `unknown`. A data set with neither copy is `absent`.
  - `parseDatasetFolderName` and `findDatasets` accept the `-<n>` suffix. A `__proto__` object in the record counts is kept as an own key.
- **`datasetSource.json` is written last**, after the wrapper copy. A run whose wrapper copy fails leaves no source file, so a half-written data set cannot read as `linked`. Found in review.
- **The refusal names no part of the path.** It reaches a VS Code notification unescaped, and a recipe file named `[label](command:…)` under a folder containing `..` would have rendered as a link that runs the command. Found in review.
- **`recordCountsByObject` is built with no prototype** on the write side too, so an object named `__proto__` keeps its count. Found in review.
- Run Faker's prompts, its modal and the files it already wrote are unchanged. **Insert Data Set by Directory** picks the wrapper copy by its prefix, so it ignores the new file; a test now lists `datasetSource.json` first to hold it to that.
- **Test harness: Node's lazily loaded rimraf is now loaded at worker start.** `fs.rmSync`, `fs.rm` and `fs.promises.rm` load Node's internal rimraf on their first call, and it copies `readdirSync` and the other functions it uses off `fs` at that moment. A test in `ExtensionCommandService.test.ts` had `readdirSync` spied to return `[]` when the first `rmSync` in the worker ran, so every later recursive `rmSync` in that worker, production code and other suites included, read each directory as empty and failed with `ENOTEMPTY`. `CoreModuleIsolation` cannot restore a copy it does not own, so `captureFunctionsOncePerWorker` now calls `loadLazyFsInternals` first, an `rmSync` of a path that does not exist. Found when the new temporary-workspace tests failed in the full file and passed alone.

**Tests.**
- `DatasetSourceService.test.ts`, with a fixture workspace of two runs (faker-js and snowfakery) and data sets in each format: recorded faker-js and snowfakery sources, a `-2` suffixed folder, a `null` run, `"../../etc"`, malformed JSON, a run no longer on disk, a linkable legacy data set, a legacy one with two wrapper copies, one with only a recipe copy, and one with no base artifacts. It also covers every refused field in the type check, legacy cases built in a temporary folder, folder name parsing, and a write-then-read round trip for each backend.
- `ExtensionCommandService.test.ts` runs the command against a real temporary workspace for each backend, through the real processor transform. It checks the written file, the `BaseArtifactFiles` listing, that the reader links what the writer wrote, the `null` run case, three runs in one second giving `-2` and `-3`, a dismissed modal writing nothing, and a recipe outside `GeneratedRecipes` failing before generation.
- `VSCodeWorkspaceService.test.ts` covers the next free suffix and a non-`EEXIST` failure. With the old folder creation in place, the suffix tests fail.
- `CoreModuleIsolation.test.ts` loads rimraf under a `readdirSync` spy and then removes a non-empty directory. Without the preload, it and the seven Run Faker tests fail.

## [3.29.11] - The Recipe Cockpit owns a single light colour palette, and no longer follows the VS Code colour theme

Closes [#174](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/174), slice 1 of [#173](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/173).

The cockpit read every colour from the VS Code theme (34 `--vscode-*` reads in its stylesheet). Under a dark theme it rendered as a flat black page with no visual hierarchy, and it changed with whatever theme the editor used. **It now looks the same under every theme, Dark+ and Light+ included.** Fonts still follow the editor's font settings. No behaviour changes.

- **One palette, one source.** `RECIPE_COCKPIT_PALETTE` in `RecipeCockpitService.ts` is a typed compile-time constant of fourteen colours, written into the stylesheet as `--sdt-*` custom properties on `:root` (`--sdt-page`, `--sdt-surface`, `--sdt-border`, `--sdt-header`, `--sdt-text`, `--sdt-muted`, `--sdt-accent`, `--sdt-on-accent`, `--sdt-row-hover`, `--sdt-chip-bg`, `--sdt-chip-text`, `--sdt-added`, `--sdt-removed`, `--sdt-changed`). `buildWebviewShellHtml` still takes only a nonce, and `buildContentSecurityPolicy` is unchanged.
- **No theme colour is read.** The only `--vscode-*` reads left are `--vscode-font-family`, `--vscode-editor-font-family` and `--vscode-font-size`. `html, body` get an explicit background and text colour, `color-scheme: light` makes native `<select>` and `<input>` popups render light, and scrollbars are styled from the palette.
- **Existing controls are restyled.** Each object is a card (surface on page, 1px border, 8px radius, soft shadow) with a header band. Rows highlight on hover, and keyboard focus shows an accent ring. The filter input and the run and status-filter dropdowns sit on the surface colour. Compare with an org and Regenerate recipe use the accent with on-accent text. The source links and ▸ toggles use the accent. The load and org status banners and notices are bordered surface strips. A field's type is a chip. The diff badges move from `gitDecoration-*` and `errorForeground` to `--sdt-added`, `--sdt-removed` and `--sdt-changed`.

**Tests.** `RecipeCockpitService.test.ts` pins the palette values and their `:root` declarations, fails on any `var(--sdt-…)` read the palette does not define, and fails on any `var(--vscode-…)` read other than the three font variables (shown by injecting `var(--vscode-editor-background)`). A contrast test computes the WCAG 2.x ratio for all 26 text/background pairs the stylesheet draws and requires at least 4.5:1. Putting `muted` back to `#6B7280` fails it and names `muted on page`, `muted on header` and `muted on rowHover`. Every existing cockpit test passes unmodified.

## [3.29.10] - A stale `treecipeConfigurationPath` setting no longer makes a present config read as missing

Closes [#171](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/171).

`ConfigurationService.getTreecipeConfigurationFilePath` used the `salesforce-data-treecipe.treecipeConfigurationPath` setting without checking it. The setting holds an absolute path saved the first time the config was found. When a project was moved, renamed or re-cloned, or `.vscode/settings.json` came from another machine, it named a file that was not there, and every command that reads the config failed with "Expected treecipe and config file missing" while `treecipe/treecipe.config.json` sat in the workspace. That covers Generate Treecipe, Run Faker by Recipe, the picklist dependency commands, Insert Data Set by Directory and Select Faker Implementation. Reproduced against the bundled extension before the fix.

- **A stored path is used only if it is inside the workspace and is a file.** Containment goes through `SfdxProjectService.isPathContainedInWorkspace`, lexical and realpath, so a symlink inside the workspace that points outside it is refused. It is checked first, so a path outside the workspace is never read even when the file exists: the value comes from `.vscode/settings.json`, which a repository controls. A relative value is resolved against the workspace root.
- **Otherwise the workspace default is used.** When `<workspace>/treecipe/treecipe.config.json` exists, the command reads it, the setting is rewritten to it through `setExtensionConfigValue`, and a warning names the replaced value and why (outside this workspace, does not exist, is not a file). The warning is shown once per stale value per session: one command reads the config several times before the asynchronous rewrite lands, and a rewrite that fails keeps the value stale.
- **With no workspace config either, the setting is left alone** and the existing missing-config flow runs, but the dialog now names the stale setting value. `getTreecipeConfigurationDetail` throws a `MissingTreecipeConfigurationError`, which keeps the message prefix `ErrorHandlingService` keys that flow on and carries the notice separately.
- **The setting is read with `inspect()`.** Only the workspace-folder or workspace value is used; a User-level value, which applies to every window, is ignored. No `package.json` scope can stop a User-level value for this kind of setting, so this is done in code. An empty or non-string value is treated as unset.
- Both the warning and the dialog show text the repository chose, so the value goes through `escapeForNotification`, which keeps it from forming a `[label](command:…)` link. That helper moved to `RecipeYamlScalar` so `ConfigurationService` can use it without importing `DirectoryProcessor`, which imports `ConfigurationService`; `DirectoryProcessor.escapeForNotification` delegates to it.
- **Drive letters compare case-insensitively.** VS Code gives the workspace root as `uri.fsPath`, with a lower-case drive (`c:\…`), while a hand-written setting usually says `C:\…`. The containment check compares strings, so a valid config inside the workspace would have been refused and replaced. `normalizeDriveLetterCase` lower-cases a leading drive letter on both sides; nothing else changes. Found in review.
- **The rewrite is guarded by the same once-per-value check as the warning.** `setExtensionConfigValue` reports its own failure, so rewriting on every read repeated a "could not be saved" warning per read in a window where the write fails. Found in review.
- A valid stored path and an unset setting behave as before. `inspect()` is called without a resource, so a value set only at workspace-folder scope in a multi-root workspace is not read, exactly as `get()` did not read it before.
- The setting's description in `package.json` now says all of this, and the README troubleshooting section covers the symptom.

**Tests.** `ConfigurationService.test.ts` resolves against real temporary workspaces: a valid stored path; a missing file, read through `getObjectsPathFromTreecipeJSONConfiguration` as in the reproduction; a directory; a path outside the workspace, asserting `readFileSync` never sees it; a real symlink pointing outside; a User-only value; a workspace-folder value winning over a workspace value; a relative value; empty, whitespace and non-string values; no setting; a stale value with no workspace config; one warning and one rewrite across repeated reads; a rejected rewrite, reported once; drive-letter case; and a stale value shaped like a command link. With the old resolver in place, 13 of them fail. `ErrorHandlingService.test.ts` covers the dialog with and without the notice, and routing of the typed error. `RecipeYamlScalar.test.ts` covers `escapeForNotification` where it now lives.

## [3.29.9] - The default RecordTypeId no longer depends on directory listing order, and is an active record type

Closes [#166](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/166), found by the code review of #165.

`RecordTypeService.getRecordTypeToApiFieldToRecordTypeWrapper` built its map in the order `vscode.workspace.fs.readDirectory` listed `recordTypes/`. That is the file system's order, which is not sorted on every platform (ext4 is one example). Since #157 the first entry is the `RecordTypeId` an unedited recipe inserts, so the same metadata could insert a different record type, and produce a noisy diff, on another machine or in CI. The same order also laid out the record-type sections in both backends.

- **Record types are sorted once, where they are loaded**, by developer name compared by UTF-16 code unit (`<`). `localeCompare` is not used because its result depends on the machine's locale. Every consumer reads the map in that order, with no sort of its own:
  - the `RecordTypeId` value and its commented options;
  - the picklist and multi-select record-type variants;
  - the dependent picklist record-type sections.

  Two files that declare the same developer name are tie-broken by file name, so which one wins doesn't depend on the listing either.
- **The loaded map has no prototype** (`Object.create(null)`). A record type named `__proto__` used to replace the map's prototype and disappear without a word. It is now an own key, which the api-name partition refuses with its `SKIPPED` TODO, like any other invalid name.
- **The default `RecordTypeId` is the first *active* record type** in that order. Inserting with an inactive one fails. `RecordTypeWrapper` gains `Active`, read from `<active>`: only an explicit `false` is inactive, and a missing tag counts as active. The value is type-checked rather than passed to `String()`: nested markup that carries a `<toString>` child makes `String()` throw, which would have aborted the whole walk. Found in review. An inactive record type is still listed as a commented option under the TODO, and its picklist variants are still written as before. If none is active, the first is used.
- A non-XML file in `recordTypes/` is still ignored, and an empty or missing `recordTypes/` still writes no `RecordTypeId` line. The mock `OneRecType`/`TwoRecType` were already in this order, so no fixture changed.

**Tests.**
- `RecordTypeService` loads a listing in sorted, reversed and arbitrary order and gets the same map. The developer names chosen differ between code-unit order and locale order. Further cases cover the duplicate-name tie-break, a non-XML file, an empty directory and every form of `<active>`.
- `RecipeService` covers default selection: an inactive `Alpha` sorts first, so `Beta` is chosen and `Alpha` stays a commented option. With none active, the first is still written.
- `DirectoryProcessor.generatedRecipeYaml.test.ts`, with each backend:
  - generates from a sorted and a reversed `recordTypes/` listing and gets byte-identical recipe files;
  - checks that the record-type sections follow developer name order;
  - with `OneRecType` marked inactive, checks that `RecordTypeId` is `TwoRecType`.

## [3.29.8] - A record type Id is resolved only in RecordTypeId, and only by an exact match for its own object

Closes [#167](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/167), found by the reviews of #165.

**Insert Data Set by Directory** swapped each `Object.DeveloperName` for the org's record type Id with a `replaceAll` over the whole Collections API JSON. Since #157 made a single generated `RecordTypeId` the normal path, that swap was the next thing between an unedited recipe and a successful insert:

| Problem | Example | Result |
|---|---|---|
| Prefix collision | the org returns `Business` before `Business_Customer` | `Account.Business_Customer` became `012…_Customer`, and the insert failed |
| Over-matching | a Text field's sentence or a reference id containing `Account.Business` | that value was rewritten with an Id |
| Silent miss | a `RecordTypeId` naming a record type the org does not have | sent as `Obj.Name`, rejected with an error that does not point at the cause |

`CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds` now parses the JSON and, for each record, replaces `record.RecordTypeId` only when it **equals** `${record.attributes.type}.${DeveloperName}` for a record type the org returned for that object. No other property is touched, and `Contact.Special` on an `Account` record is not resolved with `Contact`'s Id.

- **An unmatched value is left as it is**, and one warning per file names each object and its unmatched developer names, so Salesforce's rejection has an obvious cause. The names come from workspace files, so they go through `DirectoryProcessor.escapeForNotification` and cannot form a notification link; at most 20 are listed per object and the rest are counted.
- **A value with no dot**, such as an Id typed into the recipe, passes through without a warning.
- **The signature still takes and returns a JSON string**, so the lookup reference swap that follows it is unchanged. A file with nothing to resolve is returned exactly as read; one with a resolved Id is re-serialized with the same two-space indent the generator writes.
- An empty file, records with no `RecordTypeId` and an empty org result still pass through unchanged. An empty org result now also warns about any `RecordTypeId` it could not resolve.

## [3.29.7] - An object name that is not a Salesforce api name can no longer write recipe lines

Closes [#164](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/164), the follow-up #120 left open.

An object's name reached generated recipes with no check. It comes from two places the workspace controls:

| Name | Came from | Written into |
|---|---|---|
| Object api name | the object's **directory name** | `- object:` and `nickname:`, the combined recipe's `# Level` and `# Object (Parents: … )` comments, and the generated folder and file names |
| Lookup parent | a field's `<referenceTo>`, or a configured relationship mapping | the same comments and folder names, because the parent joins the relationship tree as an object |

On Linux and macOS a directory name can carry a line break, so a cloned repository could add recipe lines of its choosing. **Run Faker by Recipe** with faker-js evaluates their `${{ … }}` with `new Function()`. A `<referenceTo>` needs no unusual directory at all, only an XML character reference such as `&#10;`, and could also carry `../` into the folder path. Like #120, this was found by reading the code and not reproduced.

**The check is in one place**, `ObjectInfoWrapper.addKeyToObjectInfoMap`, the only way an object enters the map. Both routes go through it: the directory walk and a lookup's parent. Every writer reads its object names from that map, including `initiateRecipeByObjectName`, `RelationshipService`'s grouping and comments, the folder names, the SOQL and Mermaid templates, and the objects wrapper the Recipe Cockpit reads. So none of them ever sees a refused name.

- **A directory** whose name is not an api name (`[A-Za-z][A-Za-z0-9_]*`) is skipped, and nothing is written for it.
- **A lookup** whose parent is not an api name records no relationship. The field itself is still written, with the same `### TODO -- REFERENCE ID REQUIRED` value it already had.
- **Every refused name** is listed once in a single warning after the walk, through `DirectoryProcessor.escapeForNotification`. It is also recorded in `ObjectInfoWrapper.SkippedObjectApiNames`. That property is present only when something was refused, so an ordinary run serializes exactly as before.
  - A VS Code notification is not plain text: it turns `[label](command:…)` into a link that runs the command. Review found that a directory named like that produced a live link in the first draft of this warning, so a click could type into the user's terminal.
  - `escapeForNotification` now escapes `[`, `]`, `(` and `)` as `\uXXXX`, along with the line breaks `RecipeYamlScalar.escapeForComment` already handled, so no name can form a link.
  - The warning lists at most 20 names and counts the rest.
- **The rule is `SalesforceApiName`**, a new class that imports nothing, because `ObjectInfoWrapper`, `SOQLTemplateService` and `MermaidService` run without vscode and `RecipeService` does not. `RecipeService.isRecipeWritableFieldApiName` now delegates to it, so field, record type, controlling field and object names all follow one definition.
- **The map no longer reads inherited members.** `addKeyToObjectInfoMap` checked membership with `in`, so an object named `constructor` or `toString` was never added. It now uses an own-key check.

**Also bundled from the issue: SOQL templates.** `SOQLTemplateService` now leaves out of every query and the SOSL template anything the recipe refuses: a record type developer name, a field api name, or a lookup's `<referenceTo>`. The template is a file to read rather than run, but each of these could write a misleading query line.

**Also found in review: the Mermaid ERD.** `MermaidService` wrote every field name into the ` ```mermaid ` block, including names #120 refuses. A line break and a fence in one ended the block and wrote markdown of the name's choosing. Refused fields are now left out of the diagram's attributes and relationship labels.

Ordinary names are written byte-identically, and every existing fixture test passes unchanged. **Not covered, left on #164:** an object whose fields are all skipped is still written as `fields:` followed only by comments. Snowfakery 4.x rejects that file. An object with no fields already produced the same output before this change.

**Tests.**
- New `DirectoryProcessor.hostileObjectNames.test.ts` builds its fixture at run time, because a file name with a line break cannot be checked out on every platform git supports. The fixture has directories named with `\n`, `\r` and U+2028 followed by an injected object, and one named as a command link, beside `Account` and `ns__Thing__c`, and `ns__Thing__c` has a lookup whose `<referenceTo>` carries the same payload. With each backend, the test checks that:
  - only the ordinary objects reach the map, the relationship trees and the recipe files;
  - no recipe line names the injected object or field;
  - one warning names all five refused names, escaped;
  - js-yaml and PyYAML load every file identically;
  - each ordinary object's recipe, and each recipe file, is byte-identical to a run without the hostile names.

  Running faker-js over the files evaluates nothing the names carry. The tests are skipped on Windows, where such a directory cannot exist.
- `ObjectInfoWrapper.test.ts` covers refused names (line breaks, `../`, a space, a leading digit, an empty name, a non-string), accepted names including `constructor`, recording a name once, and the unchanged serialization.
- `RelationshipService.test.ts` covers a lookup to a refused parent, which records no relationship, adds no object and writes no comment naming it, and checks that an ordinary parent is recorded as before.
- `SOQLTemplateService.test.ts` covers a refused record type, field and `<referenceTo>`. `MermaidService.test.ts` covers a refused field, which leaves the fence count at two.
- The end-to-end fixture also has a directory named `[Regenerate now](command:workbench.action.terminal.sendSequence?…)`, and the test asserts the warning contains no link. Unit tests cover `escapeForNotification` (a command link, a link split by a line break, a nested link) and the 20-name cap. Undoing either review fix fails 6 tests.
- Loosening `SalesforceApiName` to accept any non-empty string fails 27 of the new tests.

## [3.29.6] - An unedited recipe for an object with record types inserts again

Closes [#157](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/157), found while scoping #153.

Generate Treecipe wrote `RecordTypeId` as a TODO followed by every record type on its own line:

```yaml
    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name ...
                    Example_Everything__c.OneRecType
                    Example_Everything__c.TwoRecType
```

YAML folds those lines into one value, `Example_Everything__c.OneRecType Example_Everything__c.TwoRecType`. **Insert Data Set by Directory** then replaced each developer name with its org Id, so the insert sent two Ids in one `RecordTypeId`, and Salesforce rejected it. A recipe nobody had edited could not be inserted.

The value is now the **first** record type, in the order generation already used. Each other record type is a commented line under the same TODO, the shape #153 gave record-type picklist variants:

```yaml
    RecordTypeId: Example_Everything__c.OneRecType
                    ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name ...
                    # Example_Everything__c.TwoRecType
```

- **To pick another record type**, swap its commented line in as the value.
- **With one record type**, the value is that record type, with no TODO and no commented line: there is nothing to choose.
- **With no record types**, there is still no `RecordTypeId` line.
- The line is written by `RecipeService.initiateRecipeByObjectName`, which both backends share, so it is identical in both.

**Tests.**
- `RecipeService.test.ts` pins the new output for one and several record types, with both backends, and loads it with js-yaml and with PyYAML.
- `DirectoryProcessor.generatedRecipeYaml.test.ts` runs the real pipeline with each backend, pins the lines, and asserts that js-yaml and PyYAML both load every `RecordTypeId` as exactly `Example_Everything__c.OneRecType`.
- New `CollectionsApiService.generatedRecordTypeId.test.ts` takes a generated recipe through faker output to the Collections API JSON and `updateCollectionApiJsonContentWithOrgRecordTypeIds`, and asserts that the insert carries exactly one org Id. faker-js runs the recipe for real. snowfakery is not installed, so its output is built from what PyYAML, snowfakery's reader, loads.
- The Recipe Cockpit's recipe-writer fixtures are regenerated, and the faker-js one is byte-identical to the pipeline's output. A new test shows the cockpit's reader lists `RecordTypeId` with the chosen record type as its value.
- Reverting the fix fails 30 of the new and updated tests.

## [3.29.5] - A metadata name that is not a Salesforce api name can no longer write recipe lines

Closes [#120](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/120), surfaced by the security review of #119. The review of this change (#163) found two more names with the same flaw, and they are fixed here too.

Three names from workspace XML were written into generated recipes with no check:

| Name | Came from | Written into |
|---|---|---|
| Field api name | the field's `<fullName>` | the recipe line's YAML **key** |
| Record type developer name | the record type's `<fullName>` | the `RecordTypeId` options and every record-type line in both backends |
| Controlling field | a dependent picklist's `<controllingField>` | the dependent picklist's `when: ${{ … }}` expression |

If one of these names carried a line break, it could add a recipe line of its own. **Run Faker by Recipe** with faker-js evaluates that line's `${{ … }}` with `new Function()`, which runs code in the extension host. For example, a `<fullName>` of `A&#10;    Injected: ${{ … }}&#10;    Z` was written as three field lines. The record type case was reproduced as code execution in review.

Each name is now written only when it is a Salesforce api name, meaning a letter followed by letters, digits and `_` (`RecipeService.isRecipeWritableFieldApiName`). Any other name is written as a single comment line instead:

```yaml
    ### TODO -- FIELD SKIPPED -- api name "A\n    Injected: ${{ … }}\n    Z" is not a valid Salesforce api name ([A-Za-z][A-Za-z0-9_]*); fix the field's <fullName> and regenerate
    ### TODO -- RECORD TYPE SKIPPED -- developer name "Evil\n    …" is not a valid Salesforce api name ([A-Za-z][A-Za-z0-9_]*); fix the record type's <fullName> and regenerate
    Dependent__c:  ### TODO -- DEPENDENT PICKLIST SKIPPED -- controlling field "Controlling__c\n    …" is not a valid Salesforce api name ([A-Za-z][A-Za-z0-9_]*); fix the <controllingField> of "Dependent__c" and regenerate
```

- **Field api names** are checked in `appendFieldRecipeToObjectRecipe`, the one method that writes every recipe key: OOTB mapping entries, field files, the record type line, and compound address and geolocation components. The field's value is dropped along with the key, because a value can carry the same name.
- **Record type developer names** are split once, by `RecipeService.partitionRecordTypesByWritableDeveloperName`, where the record types are loaded. `initiateRecipeByObjectName` lists only the valid ones under `RecordTypeId` and writes a TODO for each invalid one. `DirectoryProcessor` passes only the valid ones to field generation, which covers every record-type line in both backends. If no record type is valid, no `RecordTypeId` line is written.
- **Controlling fields** are checked in `getDependentPicklistRecipeFakerValue` before either backend is called. The dependent field keeps its key, and its value becomes the comment, which loads as `null`, as the existing TODO for a dependent picklist with no dependency settings already does.
- Every name in a TODO is escaped with `RecipeYamlScalar.escapeForComment`, so neither js-yaml nor PyYAML sees a line break in it (including U+0085, U+2028 and U+2029).
- Rejecting a name, rather than quoting it, was the open question on #120. A quoted key keeps the recipe valid, but it names a field no org can have.
- An empty `<fullName>` never reaches the recipe. `FieldInfo.create` already refuses it and stops generation, as before. At the writer, an empty, whitespace-only, `null` or `undefined` name gets the TODO line.

**Run Faker by Recipe with faker-js no longer throws on a field whose value is only a comment.** A field like that, such as `Dependent__c:  ### TODO …`, loads as `null`. `FakerJSRecipeProcessor.handleNonFakerJSExpressionSyntaxValueScenarios` checked it with `'if' in value`, which throws on `null` and on numbers. That had already failed the whole run for the TODO written for a dependent picklist with no dependency settings. It now checks for a non-null object first, so `null`, numbers and booleans pass through unchanged.

Valid names are written byte-identically to before, and every existing fixture test passes unchanged. **Not covered, tracked as a follow-up:** object names, which come from directory names and are written into `- object:` and `nickname:`, and the record type names written into SOQL templates.

**Tests.**
- New fixture `HostileFieldApiNameSalesforceMetadataDirectory` holds one object with:
  - fields whose `<fullName>` carries `\n`, `\r`, `\r\n`, U+2028, U+0085, a `: ` injection, a template literal, only whitespace, and a hostile `Location` name (whose two components inherit it);
  - a dependent picklist whose `<controllingField>` carries a line break, and another whose `<controllingField>` is an expression;
  - two record types whose `<fullName>` carries a line break (`\n` and U+2028);
  - an ordinary field, controlling picklist, record-type-scoped picklist and record type, so the valid path runs beside the refused one.
- `DirectoryProcessor.hostileFieldApiNames.test.ts` runs that fixture through the real pipeline with each backend. It checks that:
  - the object loads with only the declared valid fields, and both refused dependents are `null`;
  - each skipped field, record type and dependent picklist is exactly one TODO line;
  - no line names the injected field;
  - every file loads identically in js-yaml and PyYAML;
  - Run Faker by Recipe with faker-js evaluates nothing the names carry;
  - the ordinary `MockSalesforceMetadataDirectory` skips nothing.
- Removing any one of the three guards fails these tests: the controlling-field check, record types in the recipe header, or record types passed to field generation.
- `RecipeService.test.ts` covers each guard directly, in both backends, including a byte-identical check for ordinary names and record types. `FakerJSRecipeProcessor.test.ts` covers `null`, number and boolean field values.

## [3.29.4] - A picklist value named like a JavaScript built-in is kept as data

Closes [#160](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/160), found in the review of #159.

Picklist values were used as keys of plain `{}` maps. A value that is also the name of an `Object.prototype` member, such as `constructor`, `toString`, `valueOf`, `hasOwnProperty` or `__proto__`, read back the inherited member instead of a missing key. A picklist in a construction-industry org can have `constructor` as an ordinary value. The effects were:

| Where | Value | Before |
|---|---|---|
| `RecipeService.buildControllingValueToPicklistOptions` | controlling value | **Threw** `….push is not a function`. Generate Treecipe and Generate Picklist Dependency Tests both failed, since they share this map. |
| `XmlFileProcessor.extractPicklistDetailsFromValueSettings` (a dependent picklist backed by a global value set) | dependent value | **Threw** `… is not iterable` while the field XML was being parsed. |
| `PicklistDependencyTestService.buildExpectations` | declared controlling value that unlocks nothing | Would have **skipped** its `expectNone`, because `in` also sees the prototype. The first row hid this. |
| `PicklistDependencyTestService.resolveGlobalValueSetDependentValues` | controlling value `__proto__` | **Dropped silently.** Assigning `obj['__proto__']` on a `{}` replaces the prototype instead of adding a key. The issue didn't list this one; the end-to-end test found it. |

Each map is now built with `Object.create(null)`, the pattern `GlobalValueSetSingleton` and `PicklistDependencyMetadataWriterService` already use. Each membership check is an own-key check (`Object.prototype.hasOwnProperty.call`). The return type is still `Record<string, string[]>`, and both faker services still iterate it with `for…in`, so neither backend changes.

**Tests.**
- New fixture `PrototypeNamedSalesforceMetadataDirectory` holds two objects:
  - `PrototypeNamed__c`: a controlling picklist, a local dependent picklist, a global-value-set-backed dependent picklist, a multi-select and a record type, each carrying all five names plus one ordinary value.
  - `OnlyPrototype__c`: the unhappy path. Its controlling picklist is only `__proto__`, and its dependent picklist is only `constructor`.
- `DirectoryProcessor.prototypeNamedPicklistValues.test.ts` runs the fixture through the real pipeline with **each backend**. It checks:
  - both objects are written with exactly their declared fields;
  - every file loads identically in js-yaml and PyYAML;
  - the default and multi-select expressions carry each name;
  - each dependent field has one `when:` per controlling value, offering exactly what the value settings unlock;
  - Run Faker by Recipe with faker-js generates every name, and a global-value-set-backed dependent value is always one its controlling value unlocks;
  - Generate Picklist Dependency Tests emits an expectation for every name, and the Apex and `manifest.json` both round-trip them.
- The unit tests for each site cover all five names.
- Reverting any one `Object.create(null)` fails tests. With the maps null-prototyped, the own-key check in `buildControllingValueToPicklistOptions` is redundant, but it is kept, as #160 asks.

Ordinary metadata generates the same recipes and specs as before; every existing fixture test passes unchanged.

## [3.29.3] - CI runs again, and a recipe check that cannot run fails instead of skipping

Closes [#158](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/158). Test harness only; nothing a user sees changes.

The tests that read generated recipes the way snowfakery does need `python3` with PyYAML (its YAML parser) or Jinja2 (its template engine). Neither is a dependency of this extension, so on a machine without them those tests **skip**. That is right for a laptop and wrong for CI. A skip is green, and `checkJestTestCoverage.ps1` does not count skips, so a runner image that stopped shipping PyYAML would switch off every snowfakery-side check without anyone being told. These are the checks that caught U+2028 in #155 and `<<…>>` in #159.

All of them now go through one gate, `PythonTestHarness.testRequiringModules('yaml' | 'jinja2')`:

| Module importable? | `CI` set? | Test |
|---|---|---|
| yes | either | runs |
| no | no | skipped, as before |
| no | yes | **fails**: `python3 cannot import yaml, and CI is set, so this check fails rather than skipping. Install it with: python3 -m pip install PyYAML Jinja2` |

- **It fails the test, not the suite.** 3.29.2's gate threw while the suite was being collected, so a missing module in CI took down every js-yaml check in the same file with it. The stand-in registers the same test names, `.each` rows included, so the report says which checks did not run.
- **`DirectoryProcessor.generatedRecipeYaml.test.ts`** (#154), the suite #158 named, used its own probe that always skipped. It uses the gate now.
- **`PythonTestHarness`** is a static class. It holds the probe, the gate and the Python runners (`runPython`, `loadWithPyYaml`, `renderWithSnowfakeryJinja`) that `HostilePicklistValues.ts` used to export as loose functions; that file now holds only payload data.
- `CI` counts as set for any non-empty value except `false`.
- **The gate returns `GatedTest`, not `jest.It`.** It allows a call (with an optional timeout) and `.each` over an array table, and nothing else, because those are the only forms the CI stand-in implements. `.only`, `.concurrent` and a tagged-template `.each` off the gate are now **compile errors**. Before, they type-checked and would have crashed the whole file while it was being collected, in exactly the CI run the stand-in exists for.
- **Each module is probed once per gate**, including when the gate fails, and once per file where a `describe.each` runs the same gated test for both backends.

**Tests.** `PythonTestHarness.test.ts` stubs the probe with `jest.spyOn(childProcess, 'execFileSync')` and sets `CI` explicitly. It covers every row of the table, a missing `python3`, the gate's return value in each mode, the stand-in registering the same name (and the same `.each` table) with the failing body and any timeout, a single probe per module when the gate fails, and the message naming only the missing module. It was also run for real with a `python3` shim on `PATH` that refuses the import:
- the #154 suite reports **2 failed, 4 passed** with `CI=true`, and **2 skipped, 4 passed** without it;
- the Jinja-gated snowfakery suite fails all 27 `.each` rows by name.

No new dependency.

### CI has not run since 3.29.2, and now it does

3.29.2 added a step to `build.yaml` that installs PyYAML and Jinja2, written as the plain scalar `run: python3 -m pip install --only-binary=:all: PyYAML==…`. The `: ` inside it is a YAML mapping indicator, which is the same defect class 3.29.2 fixed for picklist values. GitHub could not parse the workflow at all. It reports that as a run with **no jobs**, concluded `failure` the moment it starts, with no log and no failing step. So:
- every push since that commit failed, including `main` after #159 merged;
- no pull request run started, which leaves a required check at "Expected — Waiting for status to be reported".

The step is now a block scalar (`run: |`), which runs exactly the same command. This is a workflow change, which #158 ruled out, but it repairs the workflow rather than changing what CI does.

A new guard, `.github/workflowScripts/tests/workflowFiles.test.js`, loads every workflow file with js-yaml and checks it has triggers, jobs, and steps that each run a command or use an action. Against the broken `build.yaml` it fails with `bad indentation of a mapping entry (77:53)`, the position GitHub rejected. An unparseable workflow now fails `npm run jest-test` locally, instead of failing silently on GitHub.

## [3.29.2] - Every picklist value is written into a recipe as inert data (security)

Closes [#155](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/155), from the security review of 3.29.1.

Picklist values come from field XML and global value set XML in whatever repository is open, so a metadata author controls them. Some reached the generated recipe **with no escaping at all**: a dependent picklist's choices (`- value` under `random_choice:`), a record type's dependent choices, and the controlling value in `when: ${{ Field == '...' }}`. The escaping the other sinks had missed three line breaks that PyYAML recognises and js-yaml does not: U+0085, U+2028 and U+2029. XML character references (`&#10;`, `&#x2028;`) decode into real breaks, so a value that reads as one line in the source could still carry one. So a value could:

- add a live field to the recipe after a line break. In faker-js, Run Faker by Recipe evaluates a field's `${{ }}` with `new Function` in the extension host. In snowfakery, U+2028 did this even in the default expression.
- close the `when:` string with `'` and put its own Jinja in the condition (snowfakery).
- be rendered by snowfakery as a template, if it was a dependent choice.

Now, in **both backends**, every picklist value reaches the recipe through one of two paths, and neither can change the recipe's structure or run anything:

- **Expressions** go through the backend's escaper: `escapePicklistValueForJavaScriptString(value, quote)` for faker-js (backticks for `arrayElement(s)`, apostrophes for `when:`) and `escapePicklistValueForJinjaStringLiteral` for snowfakery. Each also escapes:
  - line breaks and other non-printables, as `\n`, `\r` or `\uXXXX`;
  - `: ` and ` #` (as `\x20`), which end a plain YAML scalar or start a comment on the same line;
  - for faker-js only, `}`, because the processor ends an expression at the first `}}`.
- **Dependent choices** are YAML list items rather than expressions (`buildDependentPicklistChoiceItem`). An ordinary value is still written plain. A double-quoted YAML scalar is used instead for any of:
  - a value that would change the structure;
  - a value carrying a template delimiter;
  - a value YAML would read as a boolean, null or number. A `Yes`/`No` dependent picklist used to come back as `True`/`False`, and `007` as `7`.
- **snowfakery template delimiters.** In snowfakery, a choice carrying a template delimiter is also wrapped as a Jinja string literal (`"${{ '...' }}"`). snowfakery renders a string, quoted or not, in whichever Jinja environment its delimiters select, and its default mode (`snowfakery_version` 2) has **two**: `${{`/`${%`, and a legacy, unsandboxed `<<`/`<%` one. The first draft of this fix covered only `${`. Code review then showed a dependent value `<< cycler.__init__.__globals__.os.popen('…').read() >>` running a shell command under real snowfakery 4.2.1. Both families are covered now.
- The `### TODO` naming a controlling value a record type lacks escapes the value's line breaks, so the value stays inside the comment.

The shared YAML part is `RecipeYamlScalar`. Escaping is exact, not lossy: a CRLF is now kept as `\r\n` where it used to become `\n`, and every expression evaluates to exactly the value.

**`FakerJSRecipeProcessor` reads the `when:` literal properly.** It used to cut the condition at the first `}}` and strip every quote from the value, so `Rock 'n' Roll` matched nothing. It now reads a single- or double-quoted literal up to its closing quote and unescapes it (`parseWhenCondition`). A code point escape past U+10FFFF is left as written rather than throwing. A condition in any other shape falls back to the old reading, whose regex is now built once.

**Unchanged.** Recipes generated from the existing mock metadata are byte-identical in both backends. The one change in ordinary output: a controlling value containing an apostrophe is now escaped in `when:` (`'Rock \'n\' Roll'`). That condition was broken before, in both backends.

**Tests.**
- Each backend builds one object that reaches every place a picklist value can go, with 27 hostile values:
  - each of the six line breaks, followed by an injected field line;
  - an apostrophe breakout, a backtick breakout, `${...}`, `${{ ... }}`, `}}`, a trailing backslash, and `: `/` #`;
  - a template in each of snowfakery's syntaxes (`${{ 7*7 }}`, `<< 7*7 >>`, `<% if true %>X<% endif %>`);
  - eleven values YAML would read as a non-string (`Yes`, `No`, `on`, `true`, `null`, `~`, `007`, `1e3`, `0x1F`, `2024-01-01`, `.inf`).

  For each value, the tests assert:
  - the recipe has no extra line under either parser's rules;
  - js-yaml and PyYAML load it identically with no undeclared field;
  - faker-js evaluates every expression to exactly the value;
  - snowfakery's values render in Jinja to exactly the value, and the `when:` is true only for its own value. The Jinja harness copies snowfakery's own compiler selection across both of its environments.
- A new pipeline suite, `DirectoryProcessor.hostilePicklistValues.test.ts`, runs Generate Treecipe with each backend over `HostileSalesforceMetadataDirectory`. That fixture is a picklist, dependent picklist, multi-select, global value set and two record types carrying every payload, with line breaks written as XML character references.
  - Every file loads in both parsers with only declared fields.
  - Run Faker by Recipe generates 200 faker-js records from it, and a marker the payloads would set is never set.
  - Every dependent choice in the snowfakery recipe renders to exactly a declared value.
- Checked once by hand against the real snowfakery 4.2.1 CLI: 60 records from the hostile recipe carry only declared fields, every template payload comes back literal, and `Yes`, `No` and `007` come back as strings.
- **The tests fail against the fix removed.**
  - Against the first draft's services, 65 of the backend tests fail, and 9 of the pipeline tests fail when the processor is reverted too.
  - Dropping the `<<`/`<%` rule fails 3 tests. Dropping the non-string rule fails 18.
- **CI now installs pinned PyYAML and Jinja2**, so these checks run there. Outside CI they are skipped when the modules are missing; in CI a missing module fails the run.

**Not changed, and to be filed separately:** a controlling value named like an `Object.prototype` member (`constructor`, `toString`) breaks generation in `RecipeService`, because the value is looked up with `in` on an object literal. It is hostile metadata of the same kind, but not an escaping sink.

Recipes generated before this release are not rewritten; regenerating fixes them.

## [3.29.1] - Recipes with record-type picklists load again

Closes [#153](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/153), found while building the fixtures for 3.29.0.

When an object has record types, Generate Treecipe writes each `Picklist` and `MultiselectPicklist` field it has record-type values for as the field's default expression followed by a `### TODO` and an expression per record type. The TODOs are comments, but each record type's expression was a **bare line** indented under the field's value, and that is not YAML: js-yaml (faker-js) refused it with `bad indentation of a mapping entry` and PyYAML (snowfakery) with `expected <block end>, but found '<scalar>'`. Run Faker by Recipe loads the whole file, so **one such field stopped every object in its recipe from generating data**, in both backends.

Each record type's expression is now a **commented** line under its TODO:

```yaml
    Picklist__c: ${{ random_choice('cle', 'eastlake', 'madison', 'mentor', 'wickliffe', 'willoughby') }}
                    ### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Picklist__c
                    # ${{ random_choice('cle', 'eastlake') }}
```

The recipe runs as written, on the field's default values. To use one record type's values, swap its line in as the field's value. The indentation and the TODO wording are unchanged, so the Recipe Cockpit still lists the variants under the field.

- **Both backends**, in `buildRecordTypeBasedPicklistRecipeValue` and `buildRecordTypeBasedMultipicklistRecipeValue`. A field with no record-type values, and a record type with none for the field, generate exactly what they did before.
- **Tests.** faker-js had no test of its record-type output at all; it now pins the exact picklist and multi-select output. Both backends assert the field loads as YAML where `RecipeService` puts it, with the default as its value, and that a quote, `&` and `#` in a value are escaped in the commented line exactly as in the default. A new suite, `DirectoryProcessor.generatedRecipeYaml.test.ts`, runs the real Generate Treecipe pipeline over the mock metadata with each backend and loads every recipe file it writes with js-yaml, and with PyYAML wherever `python3` has it (the check is skipped, not failed, where it does not). Reverting the fix fails 18 tests.
- **The 3.29.0 recipe-writer fixtures get both fields back**, regenerated from the real pipeline; they differ from before by exactly those 20 lines.

Not changed: the `RecordTypeId` line is valid YAML but loads as every developer name joined into one string, which is a wrong value rather than an unloadable file, and is left for a separate issue. Recipes generated before this release are not rewritten; regenerating fixes them.

## [3.29.0] - The Recipe Cockpit's recipe writer

Closes [#148](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/148), the first of four slices of the cockpit's v2 write-back ([#58](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/58), under [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59)). Nothing a user can see changes yet: this is the one function every later write-back slice edits a recipe through.

`RecipeCockpitRecipeWriter` takes recipe text and returns new recipe text plus a description of what changed. Like `RecipeCockpitMetadataDiff` it has static methods only and **imports nothing**, and a test fails if it gains an import. It touches no disk, no webview and no `vscode`.

### Operations

Each is addressed by object api name and field api name, and returns either `{ isApplied: true, recipeText, edit }` or `{ isApplied: false, refusal }`. `edit` names the operation, the 1-based line it starts at, and the lines removed and inserted.

- `insertField(text, object, field, valueText)` appends to the object's `fields:` block, after its last line (a field, a continuation or a comment).
- `replaceFieldValue(text, object, field, valueText)` replaces the field line and every continuation line under it.
- `commentOutField(text, object, field, reason)` rewrites the field's lines as `    # ` comments under a `    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- <field> -- <n> lines -- <reason>` marker. It is reversible where deletion is not.
- `restoreCommentedOutField(text, object, field)` is its inverse, and gives back the original text byte for byte. It restores exactly the number of lines the marker declares, and only if they are still what `commentOutField` wrote; otherwise it refuses (`commented-out-field-altered`).
- `setObjectProperty(text, object, 'nickname' | 'count', value)` rewrites the one property line, the primitive slice 4 needs.

`valueText` is what follows `Field: `, exactly as the faker services build it: one line, or a first line followed by lines indented five spaces or more. A value starting with a newline (the dependent-picklist `if:` block) leaves `Field: ` with its trailing space, as `RecipeService.appendFieldRecipeToObjectRecipe` writes it. The open question on the issue (should the marker carry a date or an org) is answered by `reason`: the caller writes what it knows, and slice 3 knows the org.

### Refusals

A write never guesses. `parseRecipeSource` takes the first occurrence of an object or a field, which is the right rule for jumping to a line and the wrong one for changing it. The writer returns a typed refusal instead of changed text for: an unknown object or field, an object written twice, a field written twice, an object with no `fields:` block or with two, an `insertField` for a field that already exists, a property line missing or written twice, a value that would not read back as that one field (a second line under five spaces, a trailing blank line, a bare carriage return), a count that is not a whole number, a nickname that is not a name, and a field or object api name that is not one (so no value can smuggle a new `- object:` line in through its name). Restoring refuses a field that has been inserted again, one commented out twice, and a marker whose next line is not the field it names.

### Found in review

- **The marker carries its line count.** Without one, restore guessed where the field ended, and a comment of the reader's own directly below a commented-out field (`    #     keep this note`) was restored as a continuation of it: `Name: x` came back as `x keep this note`. Restore now reads exactly the declared lines and checks them.
- **Unicode line breaks are refused in a value.** PyYAML, which snowfakery reads recipes with, breaks lines at U+0085, U+2028 and U+2029, so `x\u2028- object: Evil` added an object the cockpit's reader cannot see. `valueText` carrying any of them, or a bare CR, is `invalid-value`. `reason` has every line break and control character collapsed to a space.
- **A value with a whitespace line of one to three spaces is refused**, because `commentOutField` could not give such a field back exactly: the writer used to accept a field it could not then remove.
- **No regular expression is built at runtime.** The first line under a marker is matched with `startsWith`; a hand-crafted marker with a field name of ~200k characters made V8 throw `Regular expression too large` out of an operation on an unrelated field.
- **Not done here:** every call re-splits and re-scans the whole file, so a batch of k edits is O(k·L) (measured: 100 edits on a 2.34 MB recipe, 5.8 s). A single edit is ~50 ms at 83,700 lines. A later slice that applies edits in bulk should add a one-scan batch entry point first.

### Why lines, not a YAML emitter

Both backends write recipes as template strings, and the `### TODO` comments in them carry meaning: which record type to pick, which lookup needs a reference. `js-yaml`, the only YAML library in the tree, drops every comment on `dump`, so a load-and-dump round trip is lossy by construction.

- **Chosen: line-level patching.** No new dependency. It keeps every comment, and it reuses the layout contract the cockpit already reads recipes by (`- object:` at column zero, `  fields:`, one field per line at four spaces, anything deeper as a continuation). Every line outside the touched field's own lines is byte-identical before and after, and so is its line ending: new lines take the ending of the line they follow, so a CRLF file stays CRLF, and a missing final newline stays missing.
- **Not chosen: the `yaml` package's comment-preserving `Document` API.** It is a new runtime dependency (and a `/supply-chain-check`), and it re-flows `${{ }}` scalars and block indentation, so it would still need every fidelity test below.

### One change to the reader

`RecipeCockpitService.parseRecipeSource` read any line of four spaces or fewer that was not a field as the end of the `fields:` block. A comment is not YAML structure, so one `    # note` hid every field written after it from the cockpit. A comment at field depth or shallower now ends the field above it and not the block. That is also where `commentOutField` leaves a field, and the round-trip tests fail if the rule is reverted.

### Tests and fixtures

`tests/mocks/recipeWriter/` holds Generate Treecipe's own output for the `DirectoryProcessingService` mock metadata, one file per backend. Each has a dependent-picklist `if:` block, record-type `### TODO` option blocks, compound address and geolocation fields, a `|` block scalar, `### TODO -- REFERENCE ID REQUIRED` lookups and the relationship-tree header comments. One edit, recorded in the test file: snowfakery writes every value inline, so the snowfakery Account's `Description` was made a `|` block scalar by hand. (`MultiPicklist__c` and `Picklist__c` were left out when this shipped, because the generators wrote them as YAML no parser accepts. 3.29.1 fixes the generators and restores both fields.)

Every field of both fixtures is replaced (single line and block scalar), commented out and restored, and every object gets an insert and both property writes, under LF and CRLF, with and without a final newline. After each one the test checks that every other line is byte-identical, that `parseRecipeSource` reports the intended change and every other object and field unchanged (wherever the edit moved its line), and that `js-yaml` still loads the result.

## [3.28.1] - Run Faker by Recipe passes the recipe path to snowfakery as an argument

Closes [#115](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/115).

`SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile` built `snowfakery <path> --output-format json` by string concatenation and ran it with `child_process.exec`, which goes through a shell. The path is the name of a recipe file in the workspace, which can come from a cloned repository. A recipe named `` a`id > /tmp/pwned`.yaml ``, `a$(...).yaml` or `a; rm -rf ~ ;.yaml` ran its payload when someone used **Run Faker by Recipe** on it. The same concatenation also broke on any workspace path with a space in it.

The call now uses `execFile('snowfakery', [path, '--output-format', 'json'], ...)`, as `PicklistDependencyCheckService` already does. The path reaches snowfakery as one argument and no shell is involved.

- **Unchanged:** the 10 MB `maxBuffer`, the error capture file and its `SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile` label, the `SnowfakeryEvaluationError` name, and the `snowfakery --version` install check. That check runs a constant string, so it stays on `exec`.
- **Windows resolves `snowfakery.exe` only.** With no shell, libuv searches PATH for `.com` and `.exe`, which is what pip and pipx install. A `.cmd`/`.bat` shim, such as a pyenv-win shim, is no longer found at generation, while the `snowfakery --version` check (still `exec`, through `cmd.exe`) would still pass. Since CVE-2024-27980, Node refuses to spawn a batch file without a shell anyway. The spawn failure is reported by the message below.
- **Spawn failures are named.** `execFile` reports a non-zero exit and a spawn that never ran through the same error object. A string `code` means the spawn failed, so an `ENOENT` now reads "The snowfakery CLI could not be started (ENOENT). Confirm snowfakery is installed and on PATH…" and keeps the original message after it. A non-zero exit keeps snowfakery's own message, which already includes its stderr.
- **Tests.** The mocked suite asserts the exact argv for ordinary paths, for paths containing backticks, `$()`, `;` and `&&`, and for a path with a space. A new suite, `SnowfakeryRecipeProcessor.shellInjection.test.ts` (POSIX only), spawns a real process against a stand-in `snowfakery` on PATH. The stand-in echoes its argv, and the suite checks that the argv is exactly three elements and that no marker file was created. Adding `shell: true` to the options fails 11 tests across the two suites.

## [3.28.0] - The Recipe Cockpit compares a recipe with an org

Closes [#57](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/57), the fifth slice of [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59). This completes the v1 "viewer + metadata diff" milestone.

**Describe in an org…** is now **Compare with an org…**. After the objects are described, the host runs `RecipeCockpitMetadataDiff.computeMetadataDiff` (3.27.0) over them, and the panel marks every field of the recipe with its status: *new in org*, *removed from org*, *type changed*, *picklist changed* or *unchanged*. A status filter narrows the rows, and **Regenerate recipe** hands off to Generate Treecipe.

### What the panel shows

- **A badge on every row of a compared object.** A type change says both types (`recipe: Number · org: string`). A picklist change names the values active in the org and missing from the recipe, and the other way round. A row names the first 20 values and counts the rest.
- **A row for each field only the org has.** It has no recipe line to open, so its name is not a link. Fields a recipe cannot write (`Id`, `CreatedDate`, formula fields) are not rows: each object's header counts them in its tooltip, as the diff engine does.
- **A per-object line on each header** (`1 new in org · 1 type changed`, or `no changes`) and a totals line under the describe summary.
- **"not compared", never a status, for an object that was not described.** Its tooltip gives the describe's own reason, so a cancelled describe says it was cancelled. The diff engine reads its org side as what the org has, so an object whose describe failed or was cancelled is left out of both sides by `buildRecipeDiffViewModel`. Passing it through would have reported every one of its fields as removed. The engine's comment asked for this in 3.27.0, and a test now fails if the filter is removed.
- **A connection failure clears the previous comparison** rather than leaving an older org's statuses under a summary that says nothing was reached.
- **A later comparison rebuilds the rows**, so a field only an earlier org had does not survive into the next answer.

### Filtering by status

A selector appears once a comparison is drawn, with *All fields*, *Changed fields only* and one entry per status. It combines with the text filter: typing an object's name still shows all its fields, and the status then narrows them. A row of an object that was not compared matches no status. Objects are never hidden, as before. Every status filter, like a text query, opens at most 25 matching objects and 2,000 rows by itself. A new model resets the selector to *All fields*, because a status left on would hide every row of a recipe that has not been compared yet.

Building this found one defect in the existing filter, which the tests now pin. With the find box empty, every object "matched" by name, so *Changed fields only* reported `2 of 2 objects` when one object had no changed rows.

### Progress and errors in the panel

The cancellable notification from 3.26.0 is still there. The panel now also shows a line (`Comparing with devhub (jd@example.com): described 3 of 12 objects…`) that the answer replaces. The host stores it like every other message, so a reveal in the middle of a describe replays it. It is dropped when the comparison ends in any way, including a dismissed picker or a run switched mid-describe. When a comparison ends without an answer to replace the line, the host posts an empty `orgProgress` so the panel hides it (found in review). It is tagged with the `renderSequence` of the model being compared, so it is never drawn over another run's rows.

The comparison is computed **outside** the connection's `try`. Before, a throw in the diff would have been reported as "Could not connect to devhub… Re-authorize the org", sending the reader to re-authorize an org that had answered. It now reaches `ErrorHandlingService` as the extension's own failure, and the next comparison is not refused as one still in flight.

### Regenerate recipe

This is the v1 "apply". It runs `treecipe.generateTreecipe`, the same unflagged command as the palette, and then loads the run it wrote. **It regenerates from the object metadata in the workspace, not from the org.** A field the comparison reports as new in the org reaches the recipe only after its metadata is retrieved into the project. The panel says so beside the button (`RECIPE_COCKPIT_REGENERATE_NOTE`), because otherwise the button looks like it fixes differences it cannot fix.

- **The command handler now returns its promise.** `extension.ts` used to start generation and return nothing, so `executeCommand` resolved at once and the cockpit would have reloaded before anything was written. A test in `extension.test.ts` pins the returned promise.
- `regenerateRecipe` carries no payload. The router honours it only when the panel has confirmed drawing the model, a comparison of that model with at least one compared object is stored, and no regeneration is already running. It counts as running until the **reload** finishes, not just the command. The comparison that allows the action is replaced only when the reloaded model renders, so clearing the flag earlier would let a second request slip through on the first one's comparison (found in security review). A panel closed during generation gets no load started into it.
- **A failed generation still reloads the panel.** The button disables itself on click and only a render resets it, so skipping the reload on failure would leave a button that can never be pressed again (found in review). The failure is still reported through `ErrorHandlingService`.
- The cockpit's flag gates the **button**, by gating the panel it is drawn in. No new entry point reaches cockpit code, so nothing needed a flag check of its own (per the issue's note).

### The protocol, and one deviation from the issue

The issue proposed `runOrgDiff {alias}` from the panel and a separate `diffData` reply. That was not followed. In 3.26.0 the panel's `selectOrg` deliberately carries no data: the host shows the org picker and reads which objects to describe from an allow-list, so the panel never names an org or an object. The comparison therefore rides on the existing `orgDescribe` message as a `diff` field, which keeps one stored answer and one replay order. The new host message is `orgProgress`, and the new panel message is `regenerateRecipe`.

`diff` is always present. A connection failure, or a message built with no comparison, carries an empty one, so the panel never has to check whether the field exists.

### What is posted, measured

An unchanged field is **not posted**. Every recipe row of a compared object with no entry is unchanged, so the payload grows with the differences rather than with the recipe. The recipe's picklist values still never leave the host. `loadRecipeRunByRuns` returns them next to the model, the panel state keeps them with the model they belong to, and `buildRecipeViewModelByRuns` is now a wrapper over it.

These numbers come from synthetic runs pushed through the real `buildRecipeDiffViewModel` and `buildOrgDescribeMessage`, with a third of the fields being 15-value picklists, and are compared with the recipe message for the same run. *Typical* changes 5% of fields. *Worst* is an org that shares nothing with the recipe: every picklist swaps all 15 values, every other field is retyped or removed, and each changed field has a new org field beside it.

| fields | typical: changed / build / message | worst: changed / build / message | recipe message |
|---:|---:|---:|---:|
| 405 | 42 / 3 ms / 0.01 MB | 810 / 3 ms / 0.16 MB | 0.06 MB |
| 12,000 | 1,200 / 45 ms / 0.25 MB | 24,000 / 74 ms / 4.72 MB | 1.67 MB |
| 120,000 | 12,000 / 349 ms / 2.47 MB | 240,000 / 595 ms / 47.16 MB | 16.71 MB |

The recipe message here has empty faker expressions, so it is smaller than the 3.25.0 figures. The comparison adds about 15% in the typical case. The worst case at 10x the epic's field count passes the Explorer's measured ceiling (39.79 MB), but it only happens when the reader compares with an org that has almost none of the recipe's fields, which is the wrong org. This slice adds no cap. The panel's own cost stays bounded by what it expands: a comparison rebuilds only the bodies of objects already open, and the auto-expand limits apply to status filters as to text.

### Testing

The tests cover `buildRecipeDiffViewModel` (every status, implied unchanged fields, failed and cancelled objects left out, and no picklist claim without recorded values), `loadRecipeRunByRuns`, and the `regenerateRecipe` router. On the host, they cover the comparison using the run's recorded picklist values, progress and its replay, a comparison that throws, and regeneration (the hand-off, the reload, a double click, a failure, and a panel closed mid-generation). The panel script runs against the fake DOM for badges, details, rows for fields only in the org, "not compared", the filters, rebuilding on a later answer, clearing on failure, progress, and the regenerate button. Ten mutations of the new guards were each checked to fail at least one test.

## [3.27.0] - The Recipe Cockpit's metadata diff engine

Closes [#56](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/56), the fourth slice of [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

`RecipeCockpitMetadataDiff.computeMetadataDiff(recipeObjects, orgObjects, recipePicklistValues)` compares the recipe's field set with the org's describe and classifies every field as `new-in-org`, `removed-from-org`, `type-changed`, `picklist-changed` or `unchanged`. Nothing calls it yet and the panel does not change: showing the differences is the next slice (#57).

### Pure, and it imports nothing

`RecipeCockpitMetadataDiff.ts` has no imports at all, and a test fails if one is added. It cannot reach `vscode`, `@salesforce/core`, an org or the configuration, and it does not check the cockpit's feature flag. The panel that will render it already sits behind the flag.

Its input types are structural. The cockpit's `IRecipeCockpitObjectViewModel` and `SalesforceOrgService`'s `INormalizedOrgObjectDescribe` satisfy them as they are, so neither side is converted into a third model. A test assigns both to the input types, so `ts-jest` fails that test file if either model drifts away from them.

### How it classifies

- **Types are mapped, not compared as strings.** The metadata `<type>` a recipe field carries and the type a describe returns use different words: `Text` describes as `string`, `Lookup`/`MasterDetail`/`Hierarchy` as `reference`, `Checkbox` as `boolean`, and `Number` as `double`, `int` or `long`. A string comparison would call nearly every field a type change. A field whose recipe type is empty (a standard-field mapping only the recipe file carries, such as `Account.Name`) or has no mapping (such as `Summary`) is marked `isTypeComparable: false` and is never reported as a type change.
- **A compound field's components are not compared on type.** `DirectoryProcessor.buildCompoundComponentFieldInfos` writes every component of a Location or Address field (`Loc__Latitude__s`, `Addr__Street__s`) into the wrapper typed `Text`, while the org describes latitude as `double` and street as `textarea`. A recipe type that is synthetic would have reported every geolocation and custom address field as changed in every org, so an `__s` field is `isTypeComparable: false`.
- **A type change outranks a picklist change.** Once the org has turned a picklist into a text field, its values are gone rather than changed.
- **Picklist values are compared only when both sides are picklists and the recipe recorded values.** The org side counts only ACTIVE values, because an inactive value is not one a record can be given. The result names the added and the removed values. A field the recipe recorded no values for makes no claim about them, while an empty recorded list does make one.
- **Org fields a recipe cannot write are counted, not listed.** `Id`, `CreatedDate` and every other field that is not createable appear on every describe and in no recipe. Listing them as `new-in-org` would bury the one new field a reader has to act on, so each object carries an `uncreateableOrgOnlyFieldCount` instead.
- **Objects on one side only** are `recipe-only` (every field `removed-from-org`) or `org-only` (every createable field `new-in-org`), and neither throws. The org side is taken to be what the org HAS, so a caller must leave out an object whose describe failed rather than let a timeout read as a deleted object.
- **Api names match case-insensitively**, as Salesforce matches them. The result keeps the recipe's spelling.
- **Deterministic output.** Objects, fields and picklist values are sorted by ordinal comparison rather than `localeCompare`, whose order depends on the extension host's locale. Status counts are totalled per object and across the diff.

### Recipe picklist values stay on the host

The model posted to the panel carries no picklist values. `normalizeObjectsWrapper` now also returns `picklistValuesByObjectApiName`, which holds each picklist field's active values from the objects wrapper's `FieldInfo.picklistValues`. A DEPENDENT picklist gets no entry. One backed by a global value set records only the values its `valueSettings` name, not the whole set (`XmlFileProcessor.extractPicklistDetailsFromValueSettings`). The wrapper does not say which value set a field used, so it cannot be told apart from a local one, and treating either list as the field's values would report every unlisted org value as added. That map is host-only: the field view model is unchanged, and a test pins that no field row gains a `picklistValues` key. The 3.25.0 payload measurements therefore still hold. #57 re-measures when it posts per-row diff data.

## [3.26.0] - The Recipe Cockpit describes a recipe's objects in an org

Closes [#55](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/55), the third slice of [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

The cockpit has a **Describe in an org…** button next to the filter. It opens a picker of every org the Salesforce CLI has authorized, then describes each object in the recipe on screen in the chosen org. The panel shows a summary line and, on each object's header, how many fields the org has for it or that it could not be described. This slice only connects and describes. Comparing the org with the recipe is the next slice (#56), and nothing here draws a difference.

### One connection helper, no new dependency

`SalesforceOrgService` is a new service. `getConnection` is now the only place an alias or username becomes a connection (`Org.create({ aliasOrUsername }).getConnection()` from `@salesforce/core`). `CollectionsApiService.getConnectionFromAlias` delegates to it, so the insert path and the describe path resolve an org the same way.

The picker reuses what `Run Picklist Dependency Check` already uses: `AuthInfo.listAllAuthorizations()` goes through `PicklistDependencyCheckService.buildAuthenticatedOrgDetails` and is shown by `VSCodeWorkspaceService.promptForAuthenticatedOrgDetail`. That new method takes a placeholder and returns the whole org detail, username included, and `promptForAuthenticatedTargetOrg` now delegates to it. With no authorized org, a warning says to run `sf org login web` rather than showing an empty picker.

### The describe

- **Pure normalization.** `normalizeDescribeResult` reduces a describe to what can be compared with a recipe field: api name, label, type, length, precision, scale, picklist values (value, label, active, default), controlling field, lookup targets, and nillable / createable / calculated. The result comes over the network, so every value is type-checked. A value of the wrong type defaults (`''`, `0`, `false`), and a field with no name is dropped. A describe with no field list is recorded as that object's failure instead of being passed on as an object with no fields.
- **Cached for the session, keyed by org username.** The cache is keyed by username, not alias, because an alias can be re-pointed at another org between two requests. A repeat request that the cache can answer makes no connection at all. Failures are never cached, because their usual causes (an expired session, an object not deployed yet) are things the reader fixes before asking again.
- **Only api names reach the org.** The object names come from files in the workspace, and jsforce joins a name into the describe URL's path without encoding it. A name that is not an sObject api name (a letter, then letters, digits and underscores, which covers namespaces and every `__c`/`__mdt`/`__e`/`__x` suffix) is recorded as that object's failure and never sent, so a crafted `x/../../query` cannot aim an authenticated request at another endpoint.
- **Connected by username.** The connection is opened with the username the cache is keyed by rather than the alias, so an alias re-pointed after the pick cannot cache one org's answer under another.
- **Failures are per object.** An object the org does not have is a normal result for a recipe generated from local metadata. It is recorded on that object (`NOT_FOUND: …`) and the other objects are still described. If the connection itself fails, that says something about the org, not about one object: the panel shows *Could not connect to …* and how to re-authorize, and a warning notification says the same. Either way the rows stay on screen and usable.
- **Progress and cancellation.** The describe runs under a cancellable `withProgress` notification that counts objects, with at most five describes in flight at once (`ORG_DESCRIBE_CONCURRENCY`). A cancelled request marks the objects it did not reach as cancelled rather than as failures.

### The protocol

It follows the rules the cockpit already had:

- **`selectOrg` carries no payload.** The panel only asks for a describe. Which objects get described comes from the host's own model (`describableObjectApiNames`), so nothing the panel posts can widen the request. That list is set when the model is posted, the same way as the other allow-lists, and takes effect only when the panel reports `rendered`. Every `ready` clears it.
- **A new model starts with nothing describable.** Posting a model empties the active list of objects to describe, not only the pending one. Otherwise a click between a new run's post and its `rendered` ack would describe the previous run's objects and tag the answer with the new model.
- **One request at a time.** A second click while the picker is open or a describe is running is ignored.
- **The answer is tied to the model it described.** The objects are captured before the picker opens. If the reader switches runs or closes the panel while the describe runs, the result is dropped rather than drawn over a different run's rows, and no warning is raised for it. A cancel the reader chose raises no warning either. The panel checks the `renderSequence` too. Loading another run clears the previous describe, and a reload replays the describe right after the model it belongs to.
- **Only a summary is posted.** The panel receives each object's field count or failure. The normalized field model stays in the host's cache, where the diff will read it.
- **The flag gate is unchanged.** The describe can only be started from the panel, which only exists once the workspace has opted in. This slice adds no command, keybinding or other way in.

## [3.25.0] - The Recipe Cockpit traverses a generated recipe

Closes [#54](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/54), the second slice of [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

**Salesforce Treecipe: Open Recipe Cockpit** now opens on the latest Generate Treecipe run. It lists every object in the recipe and, under each one, every field with its type and the faker expression behind it. A filter narrows the fields as you type, and clicking an object or field name opens the recipe `.yml` at that line. The panel is still behind the workspace flag from 3.24.0; comparing the recipe with an org is the next slice.

### What it reads

Every Generate Treecipe run already writes `treecipeObjectsWrapper-<timestamp>.json`, the full `ObjectInfoWrapper`, next to its recipe files. The cockpit reads that file rather than re-walking the metadata or parsing the YAML as data, so it shows the run that was generated, not a second derivation of it.

- **Runs are ordered by the timestamp in the folder name, not by the name itself.** A faker-js run folder is `recipe-fakerjs-<ts>` and a snowfakery run folder is `recipe-<ts>`. Sorting by name would put every faker-js run above every snowfakery run whatever their dates, and the test fixture is built so that mistake fails. A folder with no wrapper, or no run timestamp, is not listed.
- **Other runs are one selector away.** A `<select>` beside the filter lists every run, labelled with its UTC time and faker backend. A run that cannot be read keeps the selector on screen, so the reader can choose another.
- **The file is on disk, so nothing in it is trusted.** Every value is type-checked before it is rendered. A field entry with no api name is dropped and counted in a notice rather than drawn as a nameless row. An object the wrapper holds only because a lookup points at it, such as `User`, is not listed. `RelationshipService` still includes it in its tree's `RecipeFiles` objects, but no recipe is written for it, so an object with no `Fields` is kept only if a recipe file actually has an `- object:` entry for it.
- **Fields that only the recipe file carries are listed too.** Standard-field mappings (`Account.Name`) and the record type line are written straight into the recipe and never become a `FieldInfo`. A view built from the wrapper alone would tell a reader that Account has no `Name` while it is visible in the file. Those rows are marked *read from the recipe file*.

Line numbers come from the `.yml` files the run wrote. Both faker backends emit the same object header through `RecipeService` (`- object:` at column zero, `  fields:`, one field per four-space line), so one line reader serves both, with no backend-specific code and nothing for the two backends to drift apart on. Recipe files are read only if they resolve inside the workspace, with symlinks resolved through `SfdxProjectService.isPathContainedInWorkspace`. The check runs again when a row is clicked, because the file could have been swapped for a symlink since the panel loaded. An object whose file resolves elsewhere is still listed, with nothing to open.

### A filter never looks like a truncation

An object with no matching field stays on screen, collapsed and marked *no matching fields*, rather than disappearing. A hidden object would read as "not in the recipe". Typing an object's name shows all its fields. Otherwise a field matches on its name, label, type, controlling field or faker expression, and the object header shows `2 of 14 fields`.

Field rows are built on first expand, so a collapsed object costs only its header. A filter opens at most 25 matching objects on its own, and stops early once opening the next would build more than 2,000 rows. The first match always opens. Expanding an object builds all of its rows, and Salesforce allows 800 fields per object, so the object limit alone could build 20,000 rows on one keystroke. Objects past either limit stay collapsed, with their match counts shown. Clearing the filter re-opens the objects the reader had opened by hand.

### Measured, not capped

The epic asked whether 12,000 fields over `postMessage` needed a ceiling like the Explorer's. These numbers come from pushing synthetic runs through the real `buildRecipeViewModel`, with a third of the fields being 15-value picklists:

| fields | wrapper on disk | build | posted payload |
|---:|---:|---:|---:|
| 405 | 0.15 MB | 5 ms | 0.14 MB |
| 12,000 | 4.46 MB | 62 ms | 4.05 MB |
| 120,000 | 44.77 MB | 529 ms | 40.67 MB |

The payload is always smaller than the file it came from, and 10x the epic's worst case is about the Explorer's own measured ceiling (39.79 MB). This slice adds no cap. The diff overlay in #57 adds per-row data and should be measured again then.

### The protocol

The Explorer settled each of these, and the cockpit follows it rather than inventing a second approach:

- **The panel opens before the load** and names each phase (`Finding generated recipe runs…`, `Reading the generated recipe run…`) in its status line and the status bar, yielding between phases so they actually render.
- **Every host message is stored and posted only once the panel says `ready`,** and each `ready` (every reveal reloads the document) replays the model. Posting eagerly as well would render twice.
- **`routePanelMessage` stays a pure function.** It now takes the host's panel state and returns an action rather than a reply, so every allow-list decision is tested without a webview.
- **`openSource {filePath, lineNumber}` is matched, never validated.** The pair must be one the rendered model named, and both fields are type-checked first. A line the model did not name in a file it did, a stringified line number, and a path it never named are all refused the same way. `selectRun` is matched against the run names the selector offered.
- **Allow-lists take effect only when the panel reports `rendered`.** They are built when the model is posted, but a successful post only means the message left the host. Every `ready` clears the active lists until the replayed model is drawn again, so no action is honoured before its row is on screen. Each model carries a `renderSequence` that the panel echoes back, so a late acknowledgement of an older model cannot switch on a newer model's allow-lists.
- **A render guard and `renderFailed`.** A render that throws replaces the body with a failure notice. The failure goes to `ErrorHandlingService` once per distinct message. Only a failure to *draw* empties the allow-lists; a throw after the draw leaves the rows usable.
- **A run chosen while another is loading supersedes it.** A superseded load renders nothing, and if it fails, the failure is not reported. A load into a panel closed mid-flight renders nothing. A run deleted since the selector was drawn falls back to the latest run with a notice, and a run that fails to load puts the selector back on the run whose rows are still on screen.

The shell builder still takes a nonce and nothing else, and a test now pins that signature. Every value from the recipe is written with `textContent`, and a test asserts the document contains no `innerHTML`.

### Replaced from 3.24.0

The `ready`/`ack` handshake line is gone. The recipe replaces it as proof that the round trip happened, as that slice intended. `RECIPE_COCKPIT_READY_ACKNOWLEDGEMENT` is removed, and the status line now shows load phases. The preview warning no longer says the panel "renders no recipe data yet".

## [3.24.0] - The Recipe Cockpit opens: a webview surface, wired end to end and carrying nothing

Closes [#53](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/53), the first slice of [#59](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/59).

**Salesforce Treecipe: Open Recipe Cockpit** opens a panel that says what it is for and nothing else. That is the point of this release: the cockpit will traverse a generated recipe and diff it against a live org describe, and neither of those is here. What is here is the surface both will render into, proven to work before either has anything to prove it with.

### Nobody meets the cockpit by accident

Every slice of the cockpit ships behind `salesforce-data-treecipe.recipeCockpitEnabled`, and the command is where a workspace opts in: running **Open Recipe Cockpit** the first time shows a modal warning, and nothing opens until it is accepted. The warning says the panel is unfinished on purpose rather than broken, that the switch is scoped to this workspace and reversible from settings, and offers a **View Known Issues** button onto every issue carrying the `recipe-cockpit` label -- which is the link rather than the text beneath it, because a VS Code dialog renders its detail as plain text and has no clickable link in it. Choosing that button re-shows the warning instead of ending the command: a dialog closes on whichever button is clicked, so opening a browser would otherwise leave the reader to re-run the command to answer the question they went to research.

The check is in the command handler rather than a `when` clause on the palette entry. Hiding a command hides it from the palette and from nothing else -- a keybinding, a task or another extension can still execute it by id. Putting the gate where the panel is created is also what makes the later slices need no flag of their own: a cockpit that was never opted in to has no panel, so it has no model built, no message posted and nothing on screen for a panel action to have come from.

The flag is written at **workspace** scope through the existing `ConfigurationService` setter, so opting in to the preview in one project says nothing about the next one, and a dismissed warning writes nothing at all.

### A config write that did not land used to say nothing

Closes [#139](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/139), found while building the flag above.

`ConfigurationService.setExtensionConfigValue` left `update()`'s thenable unawaited. VS Code REJECTS that thenable in a window with no folder open -- there is no `.vscode/settings.json` for a workspace-scoped write to go into -- so the failure became an unhandled rejection: nothing written, nothing reported, and the caller carrying on as though it had succeeded. Invisible for a setting nothing reads back, and the whole defect for one a user was just asked to choose. The cockpit opt-in was accepted, dropped, and asked for again next time with nothing said about why.

The setter is now `async`, awaits the write, and answers a boolean, reporting a failure with the setting name and the reason. That is one change at the one place all five call sites go through, rather than five guards.

What the two callers who can act on the answer now do:

- **The cockpit refuses in a window with no workspace folder**, the same guard `Open Picklist Dependency Explorer` already uses, and that guard runs BEFORE the flag is read. The flag is written at workspace scope but read through the merged configuration -- default, then user, then workspace -- and it is contributed in `package.json`, so a reader who set it once at User scope would otherwise carry it into a folderless window and be handed a cockpit with no recipe to traverse. Checking the workspace first is what makes "no workspace, no cockpit" true for every reader rather than only for the ones who have not opted in yet. The cockpit traverses a generated recipe and diffs it against an org -- both workspace artifacts -- so asking a reader to opt in there would put a choice in front of them that there is nowhere to record and nothing to apply it to. And if the write fails for some other reason the panel still opens, because the reader opted in and a setting that could not be saved is no reason to refuse them what they asked for; what it says is that this workspace will ask again.
- **Activation stops writing where there is nowhere to write.** `useSnowfakeryAsDefault` was set unconditionally on every activation, which is how a user who opened a single file could be warned about a setting they never chose.

### What the slice actually establishes

A webview is the one part of an extension that cannot be verified by reading it. Its document runs in a separate context under a content security policy the extension does not get told it violated: a script the CSP denies does not fail loudly, it simply never runs, and the panel sits there rendering the markup that surrounded it. So the slice's deliverable is a completed round trip -- the panel's script runs, posts `ready`, the extension host answers `ack`, and the panel rewrites its own status line with what came back. A panel still reading "Connecting to the Treecipe extension host…" is a panel whose script did not run or whose message did not land, and it says so on screen rather than looking finished.

`routePanelMessage` is the whole host half of that protocol, as a pure function returning the reply or nothing. It is separated from the subscription that calls it so the routing is asserted without a live webview -- and so the traverse and diff commands are added to something already under test rather than to a closure inside an event handler.

### The constraints are set now, while there is nothing to bend them

The two properties that are cheap to establish in an empty panel and expensive to retrofit into a full one:

- **`buildWebviewShellHtml` takes a nonce and nothing else.** Recipes and org describes are metadata this extension does not control, so none of it will be interpolated into html: it arrives over `postMessage` and is written through `textContent`. That is what makes the builder need no escaping, rather than having escaping that a later field can be added without. Widening the signature to take a model is what would quietly re-open the markup context the guarantee rests on, so the tests pin the signature and pin that every inline block the shell emits carries the nonce -- an un-nonced one would be silently dead rather than a visible failure.
- **`localResourceRoots` is `[]`, not omitted.** Omitting it does not deny the grant; VS Code then defaults to the extension directory plus every open workspace folder. The cockpit loads no file of any kind.

### One panel, revealed rather than duplicated

The panel is held on the service, so re-running the command reveals the tab this window already has and rebuilds its document with a fresh nonce -- one held across loads would outlive the single document it authorizes. The message subscription is disposed before it is replaced, and again when the panel closes: two listeners answering one `ready` is one acknowledgement the panel never asked for, and it is the shape that grows into duplicated work as commands are added. A message from a panel closed before the host handled it is dropped, because posting to a disposed webview throws and that throw would reach the user as an extension error for the ordinary act of closing a tab.

The panel's own script is exercised by running it -- the real string the builder emits, against a fake DOM -- rather than asserted on as text. "The markup contains a message listener" would be equally true of one that ignored everything it received.

### What is deliberately not here yet

The explorer carries four mechanisms this panel does not: a host-held model replayed on `ready`, a measured ceiling on what is rendered, rows built on first expand, and a render guard with a `rendered` ack. None has anything to act on in a panel with no model -- a guard around a render that does not exist is untestable except trivially -- so they land with the slice that gives them something to bound. The interface constraints above are the ones that had to be set now, because they are the ones a later slice cannot add without unwinding what is already built on them.

The README documents the cockpit when it renders a recipe; documenting a panel that traverses nothing would describe a command by what it is going to do. CLAUDE.md, which is the architecture reference rather than the user's, records it now.
## [3.23.0] - The extension is bundled: 90% of the .vsix was node_modules nothing loaded

Closes [#137](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/137), the bundling half [#121](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/121) deferred to its own issue.

`vscode:prepublish` ran `tsc` and nothing else, so `vsce` resolved the whole production dependency tree and shipped every file in it. Of 7.53 MB and 2,722 paths, this project's own compiled output was 909 KB across 38 files -- **about 3%**. esbuild now bundles the extension into one file.

| | `.vsix` | files | raw |
|---|---|---|---|
| Before | 7.53 MB | 2,722 | 25.6 MB |
| After | **5.41 MB** | **2,261** | 17.2 MB |
| | **-2.12 MB (-28%)** | -461 | -8.4 MB |

What left was never loaded on any path. `xml2js/lib/xml2js.bc.js` is a prebuilt **browser** bundle, 3.23 MB against the 1 KB `xml2js.js` the Node entry point actually resolves. faker shipped its ESM half beside the `.cjs` half tsc output required, 0.91 MB zipped of a format nothing in a CommonJS extension can reach. And ~70 locale chunks, where nothing in `src/` names a locale.

### `@salesforce/core` stays external, and that is the whole risk boundary

`vscode` cannot be bundled -- the host injects it. `@salesforce/core` is external for an unrelated reason: pino's `thread-stream` transports spawn workers **from a file path**, which a bundler cannot rewrite. It stays a real `dependency` and still ships from `node_modules`, so org auth, the Collections API insert and the picklist dependency check run against exactly the code they ran against before.

That is also why the win is 28% rather than the "under 2 MB" a full bundle would reach: `@salesforce/core`'s 140-package closure is **85% of what remains**. Bundling it is its own issue, because the risk lands on the paths hardest to verify without a live org.

### tsc stops emitting, and that is load-bearing rather than tidy

esbuild strips types without checking them, so `compile` becomes `tsc --noEmit` -- still a typecheck, which is the only reason that CI step exists (nothing imports `src/extension.ts`, so ts-jest never reaches it).

Leaving `outDir` in play would have been the quiet failure. Output from both tools landing in `out/` ships the entire tsc tree **alongside** the bundle, and `checkPackagedPaths.js` could not have caught it: that tsc output legitimately requires faker, xml2js and js-yaml, so every assertion would pass while the package grew past where it started. `esbuild.js` clears `out/` for the same reason `.vscodeignore` still names the old test-output paths -- `vsce` packages the working directory, not the git index, so a checkout that ran the old build still has that tree on disk.

### The packaging guard is UNCHANGED, and it is what forced the dependency split

The issue expected assertions 2 and 3 to need re-pointing. They did not. The bundle's only non-builtin bare requires are its two externals, so the guard's existing property -- every `dependencies` key is required from packaged `out/**`, and every bare require is a builtin, `vscode`, or declared -- already describes a bundled build exactly:

- a package esbuild **inlined** but left in `dependencies` fails assertion 2, whose message already reads *"Move it to devDependencies"*
- a package left **external** by mistake and therefore not shipped fails assertion 3, which is the one that throws for an installed user rather than merely bloating the download

Those two halves are **not symmetric**, and the review that found it was right to press. What neither assertion can see is a package inlined AND moved to `devDependencies` that actually needed to stay external -- assertion 2 iterates `dependencies` only, and an inlined package emits no require for assertion 3 to find. It builds green and breaks at command time. Nothing on the package side can know a module must be external, so `esbuild.test.js` pins the split from the side that decides it: `EXTERNAL_MODULES` must equal the runtime `dependencies` plus the host-provided `vscode`, and every module it names must ship. That does not let the repo guess that some future package needs externalising -- it removes every way to record that judgement incompletely.

So `@faker-js/faker`, `js-yaml` and `xml2js` moved to `devDependencies` because the guard said to, not because a human remembered. Three tests pin the bundled shape against the same fixtures, and the guard passes unmodified against the real `vsce ls` listing.

`xml2js` does still ship: `@salesforce/core` -> `@jsforce/jsforce-node` drags it back in as an external transitive, dead `xml2js.bc.js` and all, where it is now the largest single item left at 16.6% of the package. Reclaiming it is tracked on #137 rather than done here.

### The published bundle is minified but keeps its names, because this extension reads its own stacks

`ErrorHandlingService` puts `error.stack` straight into the GitHub issue template it builds for a user. Minifying renames every class, so a reported stack named nothing a maintainer could act on -- `RecipeService` does not appear in a plain minified bundle at all. `keepNames` restores that for **8.8 KB (+0.9%)**, and a test now pins the choice: nothing asserted the minify options before, which is exactly how it went unremarked.

A source map would additionally restore file and line, and it is deliberately NOT shipped: Node does not apply one to `error.stack` unless started with `--enable-source-maps`, which the extension host is not, and the map measured **0.58 MB zipped -- ~11% of the package this change exists to shrink**. Frames therefore still read `extension.js:1:<column>`. That is a knowing trade, not an oversight.

### The watch loop is two watchers now

One tool no longer does both jobs, so `watch` runs esbuild and `watch:typecheck` runs `tsc --noEmit --watch`. VS Code runs them in parallel itself (`dependsOrder: "parallel"`), so the Problems panel still fills from the tsc half and no `concurrently` dependency was added. Editor squiggles never came from the build task at all -- those are the TypeScript language server.

The esbuild task carries a **background problem matcher** keyed on its own `[watch] build started` / `build finished` output. That is not cosmetic: `launch.json` runs the default build task as `preLaunchTask`, and VS Code only knows a background task's first run finished if a matcher says so -- without one it launches the host without waiting, and `esbuild.js` clears `out/` before starting the watcher, so F5 could reach a bundle that does not exist yet.

## [3.22.1] - The CI heap failures were a test mock escaping its own suite

### One assignment, in one test, could exhaust a 4 GB heap in a different suite

The Jest job on GitHub Actions had been failing roughly half the time with a worker exhausting its heap, always reported against `RelationshipService.test.ts`:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
FAIL src/treecipe/src/RelationshipService/tests/RelationshipService.test.ts
  A jest worker process (pid=2191) was terminated by another process: signal=SIGTERM
```

`RelationshipService.test.ts` is not where the memory went. Run on its own it peaks at 220 MB and passes under a 256 MB cap. The cause was in `VSCodeWorkspaceService.test.ts`:

```ts
const mockReaddir = jest.fn().mockResolvedValue([
    { name: 'other1', isDirectory: () => true },
    { name: 'other2', isDirectory: () => true }
]);
fs.promises.readdir = mockReaddir;
```

That is an **assignment**, not a `jest.spyOn`, and `fs` is a **Node core module**. Jest gives every test file a fresh module registry, but a core module is not part of it -- `require('fs')` hands every suite in a worker the same object -- and `restoreMocks` only restores what `jest.spyOn` registered, so an assignment leaves Jest nothing to undo. The replacement stayed installed for the rest of that worker's life.

What it left installed is the worst possible answer for a recursive walk: **every path, forever, reads as two entries, both directories.** `DirectoryProcessor.processDirectory` descends into every directory it is handed, and `RelationshipService.test.ts` opens with a `beforeAll` that walks a real metadata directory through `vscode.workspace.fs.readDirectory` -- which its own mock implements with `fs.promises.readdir`. So the walk branched 2^depth and never terminated, taking the worker to 4 GB in CI (8 GB locally) before Jest killed it.

Jest attributes a dead worker's failure to the file it was running, never to the file that poisoned it, which is why every report named the suite with no memory problem and none named the one with the defect.

**Why it was intermittent, and why it never reproduced locally.** It fires only when Jest schedules `RelationshipService.test.ts` onto the same worker after `VSCodeWorkspaceService.test.ts`. That is a scheduling outcome, not a property of the code, so it hit about half of CI runs. It essentially never hits a developer's machine because a warm Jest cache changes the per-file timings that drive the scheduling: cold-cache runs -- which is every CI run, on a fresh checkout -- reproduced it two times in three, warm-cache runs zero times in many.

**Why the 3.11.0 change did not fix it.** `10d1ce7` removed the per-child `Set` copy in `calculateLevelsRecursively`, which was a real allocation reduction and is still worth having. But it was not what exhausted the heap. The recursion this failure actually rides is in `processDirectory`, driven by a `readdir` that never returns a leaf, and no change to level calculation could have bounded it.

### Two fixes: the test, and the class of bug

- **The test uses `jest.spyOn`**, so `restoreMocks` can put `fs.promises.readdir` back. With this alone, the pair that reproduced the OOM deterministically now passes.
- **`jestSetup/CoreModuleIsolation.ts` restores core module functions after every test**, registered through `setupFilesAfterEnv`. It snapshots the plain function properties of `fs` and `fs.promises` before a suite loads and puts back anything whose identity changed -- so a future assignment costs the test that wrote it rather than an unrelated suite scheduled after it. Getter-backed properties are read through a descriptor and left alone, since a getter is not something an assignment could have replaced.

The regression test is executed, not asserted as text: one test replaces `fs.promises.readdir` by assignment exactly as the defect did, and the next test reads a real directory through it. Removing the guard fails that test.

No production code changed. `processDirectory` compares `entryType === vscode.FileType.Directory` with strict equality, and a symlinked directory carries `SymbolicLink | Directory`, so the unbounded walk this failure depends on is not reachable from a real filesystem -- only from a `readdir` that lies.

### It has now been watched moving, release by release

This branch has now been re-based across five releases, and the baseline was re-measured against every one of them. The failure did not sit still, and watching it move is itself the evidence:

| `main` at | full-suite cold runs | the two suites on one worker |
|---|---|---|
| 3.15.0 | **2 failures in 3** | OOM |
| 3.19.0 | 0 in 3 | OOM, 2 of 2 |
| 3.20.1 | 0 in 3 | OOM, 2 of 2 |
| **3.21.0** | **1 failure in 4** | OOM, 2 of 2 |
| 3.22.0 | 0 in 4 | OOM, 2 of 2 |

The right-hand column never moves. The left-hand one moves every release, because every release changes the per-file timings that decide which suites share a worker -- and that is the only variable this failure has ever turned on. A green `main` is a scheduling outcome, not a fixed defect.

On 3.21.0 the scheduling landed badly and `npm run jest-test-summary` on unmodified `main` produced this:

```
FAIL src/treecipe/src/RelationshipService/tests/RelationshipService.test.ts
  A jest worker process (pid=20249) was terminated by another process: signal=SIGTERM
Test Suites: 1 failed, 25 passed, 26 total
Time:        134.925 s
```

The original CI signature, in the real command, on the default branch of the day -- 135 s against a normal ~63 s, which is the heap thrashing before the worker is killed. #136 is what moved it into range: it deleted the provenance banner, the freshness check, the contents block and both header lines, and a large block of Explorer tests with them.

3.22.0 moved it back out again -- four clean runs. Nothing about the defect changed in either direction. The assignment is still on line 1603 of `VSCodeWorkspaceService.test.ts`, `restoreMocks` still cannot undo it, and the walk it feeds still has no leaf.

Forced onto one worker rather than waiting for the scheduler, it is deterministic:

```
jest --maxWorkers=1 --runTestsByPath \
  VSCodeWorkspaceService.test.ts RelationshipService.test.ts

3.22.0         FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory (2 of 2)
this release   Test Suites: 2 passed, 2 total / Tests: 96 passed, 96 total
```

Seven releases have shipped since this was first seen in CI. None of them touched the line that causes it, and every one of them changed the scheduling -- which is exactly why it has appeared to come and go, and why the next test file added anywhere in the project can bring it back without anyone editing the code that causes it.

### Three defects in the guard itself, found by review

The guard shipped with three wrong claims in its own comments, each disproved by running code rather than by reading it.

- **It said its `afterEach` runs LAST among `afterEach` hooks. It runs FIRST.** Hooks registered from `setupFilesAfterEnv` and hooks declared at the top level of a test file are both hooks of jest-circus's ROOT block, and root-block `afterEach` hooks run in declaration order -- setup files are evaluated first. The consequence is real but currently unexercised: a file-scope `afterEach` asserting on an `fs` spy would find the property already restored. No suite does that, restoring early is still the right trade, and the comment now says what the code does.
- **It said a getter "is not something an assignment could have replaced". On Node 20 that is false.** `fs.opendir`, `fs.opendirSync`, `fs.Dir`, `fs.ReadStream` and `fs.WriteStream` are getter/**setter** pairs: an assignment goes through the setter and sticks. Skipping every accessor property left the guard blind to directory and stream APIs -- the same class of call the original failure rode in on. Accessor properties that have a setter are now captured and restored; a getter with no setter stays skipped, because nothing can assign through it and invoking it to find out would run whatever it does.
- **It captured per test FILE, and now captures once per WORKER.** The snapshot is stashed on the shared `fs` object under a symbol. This one is a conservative baseline rather than a fix for a reproduced hole, and is written down as such: per-file capture demonstrably contains the defect this guard was written for -- that leak is installed inside a test body, so the file's own `afterEach` restores it before the file ends -- and attempts to demonstrate per-file capture ADOPTING an `afterAll` leak produced results that did not reproduce across runs. The probe was unreliable and settled nothing. It is done this way anyway, because "whatever is on the object when this file started" is not a defensible definition of pristine and the earliest observed state is.

Also from review: properties are enumerated with `getOwnPropertyNames` rather than `Object.keys`, since a non-enumerable function property is just as assignable; and the module name travels with the module instead of being derived from its position in an array.

27 suites, 1522 tests (1507 + 15), coverage 91.34/86.36/92.77/91.31 against 3.22.0's 91.28/86.28/92.74/91.24 -- up on all four axes, with zero per-file regressions and the one added file at 100/100/100/100. Cold-cache runs pass, and the pair that exhausts the heap on 3.22.0 passes here.

Every baseline quoted here was read from a CLEAN run. The 3.21.0 run that failed reported 88.09/81.75/90.41/88.00, which is not a coverage figure at all -- a whole suite did not execute. A failing run's coverage is not a baseline, and quoting it would have manufactured a three-point improvement for a change that touches no `src/` code.

3.20.1 added a CI step asserting what enters the `.vsix`. `vsce ls` was run against this branch and the new `checkPackagedPaths.js` run over its output: 2,720 packaged paths, **zero of them under `jestSetup/`**, check passed. The guard's directory is excluded twice over -- by the pre-existing `**/*.ts` rule and by the `jestSetup/**` line added here.

Both sides were measured with identical flags on Node 20. Two earlier baseline readings in this work were wrong, and both are recorded rather than discarded, because each would have put a false number in this file. One was the anomalous-first-coverage-run artifact 3.16.1 already documented: a fresh worktree reported `ErrorHandlingService.ts` a point higher, which showed up as a per-file regression this change cannot cause -- it touches no `src/` code, and that file's uncovered lines and functions are identical on both sides. Seven consecutive re-reads settled it. The other was a baseline measured in a worktree that had never been compiled, so 3.20.1's new packaged-paths test failed on a missing `out/` and the run it produced was not a baseline at all.

## [3.22.0] - Generation keeps the framework it generates against, and names the classes an earlier version orphaned

Closes [#133](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/133).

Two deploy failures, found together against a real org, and neither one names its own cause in the error it produces.

### The scaffolded framework was never refreshed, so generation emitted calls into a class that could not answer them

`scaffoldMissingFrameworkClasses` did exactly what its name said: it copied a framework class in when the file was absent, and returned early when it was there. There was no path that updated one. The comment defended it -- *"so a user who has already deployed or customized them keeps their copy"* -- and that intent is the bug, because **the framework is not frozen**:

| Framework class | Last changed |
|---|---|
| `SDTPicklistDependencySpec` | 3.2.0 -- `forRecordType`, `expectUnavailable`, `UNAVAILABLE`, `isRecordTypeScoped`, `label` |
| `SDTSchemaPicklistDependencySource` | 3.2.0 |
| `SDTPicklistDependencyValidator` | 3.4.0 |

Meanwhile `buildSpecStatement` emits against whatever the CURRENT extension knows. A workspace scaffolded before 3.2.0 kept a `SDTPicklistDependencySpec` with no `forRecordType` forever, and every regeneration wrote fresh calls to it:

```
Method does not exist or incorrect signature: void forRecordType(String, String, String)
  from the type SDTPicklistDependencySpec (143:42)
```

The generator was emitting calls against a framework API it never checked was present. Nothing looked: the result carried `unavailableClassNames` for a class that could not be supplied at all, and had no way to say *supplied, but older than what I generate against*. The org was the first thing to notice -- and it reported the error against the GENERATED class, not the stale one that could not resolve the call.

The six `SDT`-prefixed framework classes are now owned by this extension, which is what the prefix has always claimed: a class in your package directory starting with `SDT` was put there by Salesforce Data Treecipe. One that differs from the shipped source is **overwritten**, in place, at whichever path holds it -- refreshing into the framework directory while a stale copy sat at the classes root would deploy the same ApexClass twice, which Salesforce rejects, so the two are not interchangeable.

Three things it deliberately does not do. A class matching the shipped source is not rewritten, so its mtime does not move -- the same guarantee generated specs already had, and compared without line endings so a CRLF checkout on Windows does not report all six as stale on every run. An existing `.cls-meta.xml` is left alone, because it carries `apiVersion` and resetting a deliberate bump changes how the class deploys, which has nothing to do with the compile error this prevents; a meta xml that has gone *missing* beside a present `.cls` is still restored, since without it the class does not deploy at all. And a class present in the workspace that this extension cannot compare against is not reported unavailable: whatever little can be said about it, it is not a missing framework.

Overwriting a file someone already had is the one thing generation does that can discard their work, so it gets **its own warning** naming every class replaced and saying local edits went with it -- not a line folded into a success toast, which is how you find out from your git diff instead of from us. The summary document names them too.

### Making that path destructive meant guarding what it can destroy

Refreshing turns the framework step into the only thing generation does that replaces a file the user already had, and four cases only became reachable at the moment it did. Each is refused rather than written through, and every one of them reports.

**Symlinks.** `copyFileSync` follows a destination symlink and truncates whatever it points at, so a framework `.cls` that is a link would have had its target overwritten with shipped Apex — a file outside the workspace, reached from inside it. This was inert before: an existing file returned early, so nothing was ever written through anything. The containment checks upstream do not answer it either, because they resolve the *classes* directory, which realpaths inside the workspace exactly as it should — it is the leaf, and the framework subdirectory below it, that can each redirect on their own. Both are now checked, a dangling link included (it reads as absent to `existsSync`, so the "nothing here yet" branch would have *created* the file it points at).

**The same class at both paths.** A copy in the framework folder and another at the classes root is a `Duplicate ApexClass` deploy failure whatever the two contain, so refreshing one and reporting the class as handled would have put a success message in front of a broken deploy — which is what preferring one path silently did. Neither is written now; which copy to keep is the user's call.

**A write that throws.** A read-only checkout, or a lock held on Windows. The framework step runs *after* the Apex, the suite and the manifest are on disk, so an exception escaping the loop would have abandoned the run having already replaced some files, losing the very list the overwrite warning is built from. Each class is guarded on its own and a failure is reported.

**An unreadable shipped source.** Not evidence the workspace copy is stale — answering it that way sent the code into a copy *from* the file that could not be read. The workspace keeps what it has, which is the posture `unavailableClassNames` already encoded.

All four mean the same thing to a deploy — the framework is not at the version the specs call, so it may not compile — and differ only in the remedy, so they arrive as one warning with a clause each rather than four toasts describing one run four times. The overwrite warning names file **paths** rather than class names: a refresh writes to whichever path held the class, so naming one directory would send the reader to the wrong place for a legacy-root copy. And a restored `.cls-meta.xml` is now reported too — it is a file appearing in the user's diff, and the summary names what the run wrote.

### Three generations of the spec classes could sit on disk, and only two were recognised

3.0.0 renamed twice, not once: `SFTreecipePicklistDependencySpecs` to `SDTPicklistDependencySpecs`, then -- when the 40-character ApexClass limit rejected the deploy -- to `SDTPLDSpecs`. Only the first rename was ever handled. `legacySpecsClassNames` listed the `SFTreecipe` pair, and the stale sweep matched `/^SDTPLDSpecs_/`, so the middle generation fell between them and was reported by nothing.

It is also the generation that **cannot compile**. `SDTPicklistDependencySpecs_` spends 27 of the 40 characters before the object name begins:

```
Identifier name is too long: SDTPicklistDependencySpecs_Example_Everything_c (16:14)
```

`detectLegacyGeneratedArtifacts` now reports the whole family -- the aggregator, its test class, and every `SDTPicklistDependencySpecs_<Object>.cls` found by reading the classes directory, since an object api name is variable and there is no fixed name to check for. The warning says why it matters: a deploy failing on a 47-character identifier names a class this extension stopped generating, and nothing connected the two.

That detection turned the warning's path list from five bounded entries into a directory listing, so it is capped at ten with the remainder counted. A notification is one run of text that truncates, and the actionable half -- what to delete from the org, and why a per-object class fails the deploy -- is at the END of it; a workspace holding one legacy class per object would have pushed it past the cut. The paths share one directory anyway, which the enumerated few already show.

They are reported, not deleted -- the 3.0.0 posture, unchanged. What did change is that the per-object classes are named **together with the aggregator that calls them**, and deliberately kept out of `removeStalePerObjectSpecsClassFiles`. Sweeping them on their own would leave `SDTPicklistDependencySpecs.cls` calling classes that no longer exist, trading `identifier name is too long` for `variable does not exist` and leaving the user no better off.
## [3.21.0] - The Picklist Dependency Explorer opens on the find box: the provenance banner, the freshness check, the contents block and both header lines are gone

Closes [#134](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/134).

Four blocks sat between the panel title and the rows: a provenance banner, a table of contents, the scanned-objects path and a generation stamp. Every one of them was a statement *about* the rows rather than a way to reach one, and a reader who opened the panel to look a field up scrolled past all four to get to the find box. The find box is now the first thing the panel draws, and the only thing above the rows is what the ceiling dropped and what the metadata skipped -- the two caveats that say the panel is not showing everything.

### The freshness check went with the banner that was its only entry point

`Check against current metadata` lived in the provenance banner, and nothing else could start it. Removing the banner would have left the whole path unreachable rather than merely unused, so it is removed outright: the panel's `checkFreshness` message, the host's handler, the in-flight guard, the stored check context, the `applyFreshness` post and the replay that carried a resolved answer across a reveal.

`PicklistDependencyManifestService.resolveManifestFreshness` and the freshness types go with it. **`buildSourceFingerprint` and `collectSourceFingerprintEntries` stay** -- they are what `Generate Picklist Dependency Tests` writes `sourceFingerprint` into `manifest.json` with, and that half was never the check. The manifest schema and its version are unchanged, so an existing manifest still loads and an existing `sourceFingerprint` is still recorded; nothing compares it any more.

Four view model fields go with the rendering: `manifestFreshness`, `manifestFreshnessMessage`, `generatedAt` and `generatorVersion`. `modelSource`, `manifestLoadState`, `manifestLoadMessage`, `manifestFilePath` and `scannedObjectsDirectoryPath` all stay -- the empty state still names them, and it is the one place a metadata preview is still marked as one.

### Dropping the contents means the find box is the whole navigation surface

The contents listed the panel's sections and every object, and clicking an entry scrolled to it. It is gone, along with `registerPanelSection`, `updatePanelSectionLabel`, the section records and `jumpToObject`. The sections it listed still render; only the listing of them does not. On a large org the find box is now the only way to jump to an object, which is the trade this makes.

### A header line that a render reveals cannot make a failed render look finished if there is no header line

`revealHeaderLines` existed because the scanned path, written first, survived a throw in everything below it -- a heading and a path over an empty page reads exactly like a panel that loaded and found nothing. Both lines are out of the shell markup entirely rather than left in it unwritten, so there is nothing to hold back and nothing to hide again on failure. `renderPanelGuarded`, the `rendered` acknowledgement, the `window` error listener and the unhandled-rejection report are all untouched: a panel that cannot draw still replaces its body with a failure notice and still tells the host.

### What is unchanged

Both Apex commands, the run overlay (`applyRunToViewModel` and everything under it, still exported and still tested), the rendering ceiling, the value-query summary, deep links, the record type disclosures, and both panel action allow-lists.

## [3.20.1] - `ts-node` stops shipping to every extension user, and CI now asserts what enters the package

Closes [#121](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/121), and adds the regression guard [#67](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/67) asked for and never got.

`ts-node` was declared in `dependencies`. Nothing in `src/` imports it -- it exists for the `e2e-test` npm script and the `npx ts-node` note in `src/nodeDevelopmentSuppport/fakerjsRecipeParsing.ts`. But the extension is unbundled, so `vsce publish` resolves the production dependency tree and ships it, and every Marketplace install carried it.

It is now a `devDependency`.

### The cost was 4.15 MB, not the 1.6 MB `ts-node` weighs

`ts-node` declares `typescript` as a peer dependency, so the whole compiler was resolved into the production tree behind it. Measured on this tree, packaging the same source before and after:

| | Files (`vsce package`) | Paths (`vsce ls`) | `.vsix` |
|---|---|---|---|
| Before | 2,916 | 2,914 | 11.66 MB |
| After | 2,722 | 2,720 | 7.51 MB |

Both counts are given because they differ by two and the difference is not a discrepancy: `vsce package` also writes `extension.vsixmanifest` and `[Content_Types].xml`, which `vsce ls` does not list. The removal is **194 paths** on either measure.

194 paths and 20.4 MB uncompressed leave the package: `ts-node` (84 files), `typescript` (30), and the transitives unique to them -- `acorn`, `acorn-walk`, `@cspotcode/source-map-support`, `@jridgewell/*`, `arg`, `create-require`, `make-error`, `v8-compile-cache-lib`, `yn`, `@tsconfig/*`, `@types/node`, `undici-types`. Nothing is added.

Every bare `require()` in the shipped `out/**` still resolves from inside the packaged `.vsix`, and all nine commands are still declared in the packaged manifest and registered in `out/extension.js`.

### The guard is computed, so it is not a file people regenerate without reading

`vsce ls` runs in CI after compile, and `.github/workflowScripts/checkPackagedPaths.js` makes three assertions over the result:

1. **Every packaged path's first segment is one of eight checked-in names** -- `CHANGELOG.md`, `LICENSE`, `README.md`, `apexPicklistDependencyFramework`, `images`, `node_modules`, `out`, `package.json`. This is the `#67` class of leak: `.sfdx/` carrying an `apex.db` and the whole StandardApexLibrary, `.sf/orgs/<ORG_ID>/` naming the packaging developer's org, plus `docs/`, `coverage/`, `treecipe/` and `src/`. `.vscodeignore` excludes all of them today; nothing noticed when it stopped.
2. **Every key in `dependencies` is `require`d from some packaged `out/**` file.** This is the assertion that fails on `ts-node`, and it is the reason the guard is not a snapshot: a genuine runtime dependency is imported by construction, so adding one needs no edit here, while a build-only tool placed in `dependencies` is never imported and is caught the first time CI runs.
3. **Every bare `require()` in packaged output is a Node builtin, `vscode`, or declared in `dependencies`.** The other direction -- shipped code reaching for something only `devDependencies` install resolves on a contributor's machine and throws on a user's.

A checked-in list of all 2,720 paths would catch more, and would have to be regenerated by hand on every transitive bump. Only the eight top-level names are checked in; the dependency half is derived from the compiled output on every run.

**It is scanned off the packaged list, not off disk.** `.vscodeignore` removes `out/**/tests/**`, so the `require("jest-extended")` calls under it never ship. Walking `out/` on disk would report a runtime `devDependency` leak that does not exist -- which is exactly the false positive that made this worth checking before believing.

The listing is written to the runner temp directory rather than the workspace, because `vsce` packages the working directory rather than the git index, and a `vsce-ls.txt` left behind would be an unexpected top-level path in the next run.

### The reader is contained, and every read that can fail says so

`resolveContainedWorkspacePath` rejects an absolute path outright and resolves through `realpathSync` before requiring the result to sit under the workspace root, so the **symlink** half is covered and not only the lexical half -- `readFileSync` follows a symlink that `vsce ls` lists as a plain file. A path that escapes is reported as unread rather than opened. This is the same containment the extension applies to any manifest path it opens; `vsce ls` never emits a `..`, and the property is worth holding independently of the current absence of a producer that would exercise it.

A listed file that is missing still resolves lexically, so it is reported as **missing** rather than as an escape -- two different facts that should not collapse into one message. The listing read, the manifest parse and every source read return a diagnostic instead of a stack trace, and unread-path reports are emitted **ahead of** the assertions: a file that was not read contributed no requires, so assertion 2 would otherwise blame the dependency rather than the unread file.

Comments are stripped before the require scan, because a dependency named only in a comment would keep assertion 2 green for something nothing loads -- which is how #121 stayed hidden. Block comments and whole-line `//` comments go; a **trailing** `//` deliberately does not, since a `//` inside a string (`"https://..."`) would truncate the rest of a real line and turn a false positive into a false negative, the worse direction. A require written inside a string literal is therefore still counted, and a test pins that rather than leaving it to be rediscovered.

### What this deliberately does not do

Bundling with esbuild or webpack would cut the package far more than 4.15 MB and is the standard VS Code recommendation, but it is a build-system change with its own risk and belongs in its own issue. `vsce publish --no-dependencies` would ship a broken extension while the code is unbundled. `@faker-js/faker` (9.7 MB) and `@salesforce/core` (2.2 MB) stay -- both are genuinely required at runtime, as assertion 2 now proves rather than assumes.

## [3.20.0] - The Explorer answers "what does this controlling value unlock", instead of leaving the reader to find the row that says so

Closes [#127](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/127).

3.18.0 put controlling values in the find box, and stopped one level short of the answer. Typing `Canada` narrowed the panel to the objects and the fields whose rows carry it -- and then left the reader scanning up to `maxCombinationsPerNode` rows for the one headed `= Canada`. Worse, the tree is indexed by the DEPENDENT field: a node is a dependent picklist labelled `controlled by X`, so one controlling field governing three dependent fields is three sibling nodes, and "what does Canada unlock" was spread across all three with nothing composing it.

### Rows are filtered, not just nodes

A query that names a VALUE now hides the rows that do not carry it, and the match count reads `N of M combination(s) in the expanded object(s)` beside the object count. A query that names a CONTAINER -- an object or a field -- still shows every row that node has: the reader asked for the node, not for one value inside it, and narrowing it would answer a question they did not ask. That distinction needed a haystack the panel did not have. Since 3.18.0 `searchText` folds controlling values in with the api names, so it can no longer say whether the reader named the node; the panel now builds `nodeNameSearchText` from the names alone, lowercased once at build time like everything else in that path.

Filtering still only ever HIDES. Nothing is recomputed, nothing is dropped, and clearing the box puts every row back.

### One block that composes the answer

When the query matches a controlling value, each expanded object draws a summary above its tree: the value, then every dependent field it affects with what each one makes available. A value a record type does not assign reads *not available under this record type* rather than as an empty list -- the same distinction the row itself draws. It reports only what a value UNLOCKS: the complement is the one claim that needs a COMPLETE declared list to be true, and the rows already carry it with the caveat that goes with it.

A match inside a record type scope now opens the group and the scope holding it, on the same terms a record type NAME already did. Without that, a value query filtered the panel down to the field holding the answer and left the answer behind two collapsed disclosures.

### Dependent values are searchable, and the payload did not grow

This is issue #125's deferred option 2, taken on a different footing. #125 declined it because indexing dependent values "materialises the product in the payload" -- the expansion the manifest was restructured in 3.16.0 to stop. It is now derived IN THE PANEL from `allowedValues` the model already carries, so the posted message is byte for byte what it was; a test pins that no `searchText` in the payload names a dependent value.

The index is drawn from `allowedValues` rather than from `declaredValues`, and that is the difference between an exact answer and an unsound one. A first draft used `declaredValues` on the reasoning that it is a superset of every combination's `allowedValues` -- true of the model the builder produces, and **false after `applyModelLimits`**, which slices `declaredValues` at `maxDeclaredValuesPerNode` and never slices `allowedValues`. A value a rendered row visibly unlocked was therefore absent from the index, and the object was hidden with no notice at all. Matching on the unlockable set answers outright instead: a query it lacks matches no row, a query it has matches one, and there is no fallthrough scan of the model left on the keystroke path.

A row matches on its controlling value or on what it UNLOCKS, never on its forbidden complement. Every row that does not unlock a value forbids it, so matching the complement would show every row of the field and bury the answer among the rows that are not it.

### What it costs, measured in the state the code runs in

The first version of this entry carried a measurement table that described nothing. `applyNodeFilter` returns at `if (!sectionRecord.built)` before both the row filter and the summary, so a per-keystroke figure taken on a collapsed panel never executed either path this release adds. Re-measured through the real panel script with 25 objects expanded (`EXPAND_ALL_OBJECT_LIMIT`) at the combination ceiling -- 200 objects x 5 fields x 20 combinations = `maxRenderedCombinations`, each field declaring a picklist of the given size and each combination unlocking a quarter of it:

| | picklist 40 | picklist 200 |
|---|---|---|
| payload | 12.25 MB | 39.79 MB |
| index (object + node + scope) | 2.07 MB | 10.64 MB |
| first keystroke (builds the index) | 54 ms | 289 ms |
| keystroke, panel collapsed | 0.8 ms | 2.8 ms |
| keystroke, 25 expanded, exact value | 2.3 ms | 5 ms |
| keystroke, 25 expanded, matching prefix | 11.2 ms | 39 ms / 14,586 elements |

The last row is the pathological case: a query matching every controlling value in every expanded object, which a reader passes through on the way to typing a specific one. Two things made it survivable.

The summary is the product of matched combinations and their `allowedValues`, rebuilt per keystroke, and `allowedValues` is the one axis `applyModelLimits` never caps -- `EXPAND_ALL_OBJECT_LIMIT` does not help, because built objects accumulate and are never un-built. Uncapped it drew **129,500 elements in 852 ms** at that prefix, and 504,500 in 4.7 s at a picklist that unlocks in full. It now has its own two limits and says what it dropped, in the panel's existing truncation vocabulary.

And the model-side matcher is gone. It lowercased `allowedValues` on the fly so an unbuilt scope could answer for itself, which put ~980,000 fresh `toLowerCase()` calls per keystroke on a panel with **nothing expanded** -- 23 ms, against the 27 ms #125 rejected for exactly this mistake. Unbuilt content is answered by the index instead, and the collapsed-panel keystroke is 2.8 ms.

The rendering ceiling did not move. The index is bounded by `maxRenderedCombinations`, not by `maxDeclaredValuesPerNode` -- and note that `maxNodesPerObject` caps root *chains* rather than nodes, so an earlier "nodes x declared values" bound stated here was optimistic for a deep chain.

### Rows became a hideable axis, and three paths did not follow

A deep link pasted while a value query was active left the previous query's row visibility in place, so the panel marked a row focused, scrolled to it, and left it hidden; one level in, a scope body built by the deep link's own reveal was filtered against the pasted reference, which no value can contain, hiding every row in it. `showEveryNode` now restores every axis the filter can hide, and takes the summary down with it. The combination count now includes rows an opened record type scope put on screen -- an object whose combinations are all record-type-scoped previously reported no row count at all. And a parent field held on screen only because a downstream node matched says so, rather than rendering as a field that declares no combinations.

### A miss says whether it is a miss

Where the ceiling dropped rows, a value the reader types may be absent from what the panel holds rather than from their org -- and `0 of 12 objects shown` reads as the second. The count now says so whenever a query runs against a truncated model, not only when nothing matched: gating it on zero visible objects made the miss silent in the case that matters most, where some other object matches and the reader is looking at results with no reason to suspect a row was dropped. It is keyed on rows the ceiling removed rather than on a capped declared list, because the index is drawn from `allowedValues` -- a trimmed universe no longer costs the find box anything, and attaching the caveat to it would be its own kind of untrue. An untruncated model that matches nothing claims nothing about dropped rows.


## [3.19.0] - Geolocation compound fields expand into the Latitude and Longitude components an insert can write

Closes [#111](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/111).

A Geolocation field (`<type>Location</type>`) generated a link instead of a value:

```yaml
Store_Location__c: '### TODO -- SEE ONE PAGER - https://gist.github.com/jdschleicher/4abfd188a933598833285ee76e560445'
```

Like Address, Geolocation is a compound field the Collections API cannot accept. A record is inserted with its two component fields, `<FieldName>__Latitude__s` and `<FieldName>__Longitude__s`, so every Geolocation field in a recipe was hand-work: read the one pager, look up the naming convention, write two lines, delete the first.

Now it expands, the same way an Address does:

```yaml
Store_Location__Latitude__s: |
                ${{faker.location.latitude({ min: -90, max: 90 })}}
Store_Location__Longitude__s: |
                ${{faker.location.longitude({ min: -180, max: 180 })}}
```

and no line is emitted for `Store_Location__c` itself.

### It is the second consumer of #4's path, not a second path

`processFieldsDirectory` already collected compound fields during the walk and expanded them afterwards, returning several `FieldInfo` objects where every other field type returns one. Geolocation joins that collection rather than getting its own: `buildCompoundAddressComponentFieldInfos` is now `buildCompoundComponentFieldInfos`, and it picks the component recipes by compound kind and then applies the identical dedupe.

That dedupe is why sharing it matters rather than being tidy. A component is dropped for two reasons -- the object's OOTB static mappings already name it, or the object has that component as its own field file -- and both produce the same duplicate YAML key. Those reasons do not depend on which compound type produced the component, so they stay in one place.

`buildCompoundAddressComponentApiName` became `buildCompoundComponentApiName` for the same reason: Salesforce derives both compounds' component names by one rule, and the "Address" suffix swap holds for Geolocation rather than being incidental to it -- the components of a standard compound address ARE its geolocation, so `BillingAddress` *would* yield `BillingLatitude` and `BillingLongitude`, which are the real api names. To be clear about what this release does and does not do: nothing reaches that branch by the geolocation route, because only a `<type>Location</type>` field is expanded this way and in source metadata that is always a custom field. An `Address`-typed field still expands to the five address components and nothing else; emitting Lat/Long for standard address compounds would be its own change. `ICompoundAddressComponentRecipe` is now `ICompoundComponentRecipe`; the shape never was address-specific.

### Detection is `<type>Location</type>` and nothing else

There is no `customCompoundGeolocationFields` counterpart to the address config knob. That knob exists because a compound address field file can carry no `<type>` tag at all, in which case it parses as `AUTO_GENERATED` and no metadata signal is left to key on. A Geolocation field always declares its type, so there is no typeless case for config to rescue and a knob would only add a way to expand the wrong field.

A `<type>Text</type>` field merely *named* `Location__c` is therefore untouched, and stays one ordinary text recipe line.

### `<displayLocationInDecimal>` is deliberately not read

The tag controls whether the **org displays** a coordinate as degrees/minutes/seconds; the API accepts decimal degrees either way. So it cannot change generated output -- and rather than let that follow silently from the tag going unread, a test generates from a `true` fixture and a `false` fixture and asserts the component lines are identical.

### Bounds are in the expression, not in the faker default -- which costs a block scalar

The faker-js values state `{ min: -90, max: 90 }` and `{ min: -180, max: 180 }` explicitly, as `|` block scalars.

**The block form is not cosmetic.** A recipe value is a YAML *scalar*, and a plain one may not contain `": "`. Stating bounds puts a colon-space in the value, and `FakerJSRecipeProcessor` calls `yaml.load()` over the *whole* recipe file -- so a plain-scalar coordinate expression would not break its own line, it would make every field on every object in that file unreadable. Every faker-js expression in the service that carries a colon-space is emitted this way for exactly that reason (`number`, `percent`, `date`, `datetime`, `time`, and the precision/scale builders); these two now join them. Tests assert the property over *every* map the service exposes, not just the geolocation pair, so a future entry cannot reintroduce it. A generated coordinate is random, so sampling one proves nothing about the range a recipe constrains; putting the bounds in the recipe text makes the valid range something a reader and a test can both check, instead of a property of whichever faker version happens to be installed. Snowfakery's `fake.latitude` / `fake.longitude` take no bounds arguments -- those providers are defined over the valid ranges, which is what makes naming them the way that backend states the same thing.

### The gist link is gone from both backends

`'location'` is removed from `getMapSalesforceFieldToFakerValue()` in `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`. Tests assert the key is absent and that no value in either map carries the link, so no recipe path can still emit it.

`Event.Location` is untouched: it is a plain Text field in the OOTB static map, not a Geolocation compound field, and a test pins its composed street/city/state/zip value byte-identically.

### Interface

`IRecipeFakerService` gains `getGeolocationComponentToRecipeValueMap()`, implemented by both backends alongside the existing `getAddressComponentToRecipeValueMap()`.
## [3.18.0] - The Explorer's find box matches controlling values, and only the ones with a row on screen

Closes [#125](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/125).

The find box matched api names only: object, field, controlling field, record type. A reader asking "where does `Canada` appear as a controller?" had one route to the answer -- paste a combination reference -- and that requires already knowing which combination `Canada` lives in. This is the issue's option 1: **controlling values** join the haystack; dependent values do not.

### What is matched

Every combination row is headed by its controlling value, at field level and under each record type scope, so `buildNodeSearchText` now folds in the controlling value of every combination the node renders. Typing `Canada` shows every object with a row that says what `Canada` unlocks, and a single match still opens itself. The toolbar label reads **Find object, field or controlling value** and the placeholder names it too.

The values a combination *unlocks* are deliberately not matched. A combination carries what its controlling value allows, and folding those lists in puts the product of the two picklists into the payload -- the exact expansion the manifest was restructured in 3.16.0 to stop materialising. Option 2 in the issue is its own decision, to be taken with its own measurements. A dependent value is still reachable where it is a **controlling** value one level down the chain (`Ohio` is a State__c value and a City__c controller), because that node's rows show it as one; a leaf value such as `Columbus` matches nothing, and the count says `0 of N` rather than showing everything.

### The haystack is rebuilt from what survived the ceiling

Search text is computed by the build, on the uncapped model. `applyModelLimits` drops combinations on three axes -- per field, per scope, and the total budget -- and a haystack left over from the build would still match a value no surviving row shows, handing the reader an object with no visible reason for matching. That is the mirror image of the false claim the issue warned about, and it is the one the find box must never make: a match always has a row on screen to show for it.

So `applyModelLimits` ends with `rebuildSearchText`, after the total budget has run, and re-derives every node's and every object's haystack from the rows that remain. Tests pin the per-field cap, the total budget and the scope cap each removing a value from the haystack, and a model inside every cap keeping the build's text unchanged. A value the ceiling dropped is absent from the find box exactly as its row is absent from the panel, and it is counted in the same truncation notice.

### Measured, as the issue asked

The haystack grows with the number of **rendered** combinations, an axis `maxRenderedCombinations` already bounds. Re-measured on the 3.7.0 synthetic shapes through the real builder, against the current payload (which is smaller than the 3.7.0 table because the run overlay left it in 3.17.0):

| Scenario | Objects | Combinations rendered | Before | After |
|---|---|---|---|---|
| Healthy 100 × 3 × 50 (inside every cap) | 100 | 15,000 | 3.58 MB | 4.21 MB (+0.63 MB) |
| Healthy 400 × 3 × 400 (over every cap) | 250 | 20,000 | 7.72 MB | **8.58 MB (+0.86 MB)** |
| Healthy 100 × 3 × 300 | 100 | 20,000 | 5.59 MB | 6.45 MB (+0.86 MB) |

At the ceiling that is +11.1%, and it is bounded: the two 20,000-row shapes add the same 0.86 MB regardless of how many objects or fields carry them. Each rendered controlling value appears TWICE -- once in its node's haystack and once in its object's, which is what keeps the object-level match a single `indexOf` rather than a walk of the nodes on every keystroke -- so the search-text term is 2x what the node count suggests, and a future re-measure of the ceiling has to count both copies. The ceiling itself is unchanged.

### Two things review caught

**The haystack is joined on a newline, not a space.** Api names are `[A-Za-z0-9_]`, but a picklist value can carry spaces, and a space-joined haystack would let `america canada` match the tail of `North America` and the head of `Canada` -- an object with no row headed by that phrase, which is exactly the match with no visible reason this change exists to rule out. An `<input type="search">` can never contain a newline, so no query can match across the join; the panel already joins its record type haystack the same way for the same reason. A test pins that the phrase does not match while each value still does.

**A skip-only object gets the same derivation as every other object.** It used to build its haystack inline, without the record type the skip names, so that record type became findable only once the ceiling had rebuilt the text. It now goes through `buildObjectSearchText` with no root nodes, and a test asserts the first render and the rebuilt one agree.

### Tests

- `search text`: a node matches every controlling value it renders; a value only a record type scope renders is matched; dependent values are not folded in and a leaf value matches nothing; a value with spaces and mixed case is lowercased whole; two values that together spell a phrase do not match the phrase; a skip-only object matches the record type its skip names from the first build, and the ceiling leaves it unchanged
- `applyModelLimits`: a value dropped by the per-field cap, the total budget or the scope cap is no longer findable; a model inside every cap keeps the build's text
- `the panel layout, executed`: a controlling value typed into the real find box, through the real filter, shows the object whose rows carry it and hides the other, with the match count reading `1 of 2`; a leaf value reads `0 of 2`; the label and placeholder name controlling values

## [3.17.0] - The Picklist Dependency Explorer is a picture of the structure; the run overlay is disconnected, not deleted

Closes [#123](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/123).

The Explorer did two jobs. It drew the dependency structure -- which controlling value unlocks what -- and it reported the last Apex check run over the top of it: pass/fail badges on every row, a "Last check" banner, failure triage prose, a status filter, and buttons that opened the generated `.cls` at a spec method or the run's `report.md` at an object's entry.

Those two jobs answer different questions, and fusing them made the first one wait on the second. A picklist dependency is a fact about your metadata. It is fully described by `manifest.json`, which the generate command already writes. Whether your **org** still agrees with it is a different question, and `Run Picklist Dependency Check` already answers that one in its own output channel and its own report.

So the panel now does the first job only. **The overlay code is retained in full and simply has no caller** -- this is a disconnection, not a deletion.

### What the panel no longer does

`openPicklistDependencyExplorer` does not resolve the picklist dependency results folder at all, and the panel renders no badge, no banner, no triage, no status filter, and neither of the two actions that opened Apex. A test asserts on the *configuration read* rather than on the absence of an overlay, because that read is the first step of the whole coupling and nothing downstream can reach a run without it.

The `loadingResults` load phase is gone with it: an open now reports `readingManifest` then `buildingView`.

### What is retained, and still tested

Every method the overlay is built from is still on `PicklistDependencyExplorerService`, still exported, and still held to the behaviour it always had: `loadLatestResults` and the run-folder walk beneath it, `parseFailureLines` and `extractFailureMessageForControllingValue`, `applyFailuresToNodes`, `buildUnattributedFailureMessage`, the ten-kind triage map and its three accessors, `resolveRunReportFilePath`, `collectOpenableSpecTargets`, `collectOpenableRunReportTargets`, `buildOpenTargetKey`, and both Apex/report line finders. Their tests and their `Mock*Results*` fixtures come with them.

The orchestration that used to live *inside* `buildExplorerViewModel` -- look each object's generated test method up in the run, parse its failure lines, attribute them down the graph, decide whether anything landed nowhere, then set the statuses -- is now **`applyRunToViewModel`**, a method of its own. That is what makes "disconnected rather than deleted" concrete: the capability is whole and callable in one step, and re-connecting it is a wiring change rather than an archaeology exercise.

```ts
// what an Explorer open does
const viewModel = PicklistDependencyExplorerService.buildExplorerViewModelByManifest(...);

// what nothing currently does, but still works -- note the order
PicklistDependencyExplorerService.applyModelLimits(
    PicklistDependencyExplorerService.applyRunToViewModel(
        PicklistDependencyExplorerService.buildUncappedExplorerViewModelByManifest(...),
        resultsLoad
    )
);
```

**The order is part of the contract, and review caught that it had been inverted.** `applyModelLimits` drops rows; a failure naming a row that is already gone matches nothing, lands in the unattributed set, and holds the *whole* object at `'unknown'` -- every surviving row with it. Overlaying and then capping is the order the overlay ran in when it lived inside `buildExplorerViewModel`, so `buildUncappedExplorerViewModel` and `buildUncappedExplorerViewModelByManifest` exist to make that composition available. `buildExplorerViewModel` is unchanged for every existing caller -- it is now the uncapped build with the ceiling applied on the way out. Two tests pin both compositions, including the degraded one, so the wrong order cannot be reintroduced silently.

### The overlay fields are OPTIONAL, which is the load-bearing detail

`status`, `failures`, `failureCount`, `fieldLevelFailures`, `unattributedFailureMessages`, `runSummary`, `runLoadState`, `runLoadMessage` and `failureTriageByKind` are back on the view model interfaces as **optional**. `buildExplorerViewModel` never sets them; `applyRunToViewModel` assigns them.

That keeps three things true at once. A structural model carries no verdict, so the posted payload does not grow by one status and one empty array per rendered row. The panel cannot read a verdict that is not there. And **absent** and **`'unknown'`** stay different statements: absent means "this model is not about a run", `'unknown'` means "a run was overlaid and did not cover this row". Making them required with an `'unknown'` default would collapse the two and leave the three-state rendering one line away from the panel.

`generatedClassFilePath` is retained for the same reason -- `collectOpenableSpecTargets` reads it -- and still passes through `resolveOpenableManifestFilePath` on the way in. The guard is what makes keeping it safe; the current absence of a caller is not, because a future button would silently remove that.

### The panel names no Apex at all

`asserted by SDTPLDAccountSpecs.specAccountState()` on a field, `SDTPLDAccountSpecs.cls — test method …()` on an object, and `— asserted by SDTPicklistDependencyTests.cls` in the provenance banner are all gone from the panel. Which class or spec method was generated is not a fact about a dependency, and the panel is a picture of dependencies.

The names are NOT deleted -- they are on the view model and in `manifest.json`, and the retained overlay still reads them. They are simply not rendered.

They also come out of the find box. `buildNodeSearchText` and `buildObjectSearchText` no longer fold in the generated class, spec method or test method names: a query that matches text the reader cannot see returns a row with no visible reason for matching, so what is searchable is now exactly what is on screen.

The skipped-field wording moved to dependency language with it -- "asserted by nothing" is now "no generated coverage", the badge reads `not covered`, and the contents section is `Not covered`. Same rows, same reasons, no assertion vocabulary.

The provenance banner stays, minus the class name: it distinguishes a manifest-sourced model from a metadata preview, which is a statement about where the ROWS came from.

### Both Apex commands are untouched

`Generate Picklist Dependency Tests` and `Run Picklist Dependency Check` are unchanged, as are the emitted Apex, the test suite, the manifest schema and `report.md`. The generated names are still recorded per row in `manifest.json` and still carried on the view model -- the panel just does not render them, as above.

The freshness check is untouched: its button, its five states (`notChecked`, `pendingCheck`, `checkFailed`, stale, fresh) and its refusal paths all behave exactly as before. Freshness is a question about your *metadata*, not about a run. So is the render guard -- `renderPanelGuarded`, the `rendered` acknowledgement, the `window` error listener and the `render` vs `runtime` distinction are as they were in 3.15.0.

### The truncation rule had to be replaced, not just unwired

`applyModelLimits` kept a combination, scope or object the check had reported a failure for ahead of a passing one. A structural model has no statuses to prefer by, so that rule had nothing left to read.

What survives a cap is now **manifest order** -- the first that fit, on every axis, including the total budget, which is spent in document order. The manifest is emitted deterministically, so the same org truncates to the same rows on every open, and a reader who cannot find a combination can tell from the notice that it was *cut* rather than wondering whether it *moved*. Inventing any other order (longest, most combinations, alphabetical) would have sorted the panel by something the generated Apex does not.

Eight tests pin it, including one that runs the ceiling twice over the same model and asserts the same rows come back. An ordering nothing asserts is one a later refactor turns into "whatever the iteration produced".

One retention rule survived, and it is not about a run: an object carrying a **skipped field** is still kept past the cap. A skipped field is the only thing the panel shows that no generated spec covers, and dropping the object holding it would leave a dependency that was never specced indistinguishable from one that does not exist.

### Two truncation notices that were not true

Review of this change caught both, and both are about the ceiling describing itself accurately rather than about what it drops.

The node cap is applied to **root chains** -- a chain is dropped whole, because half a chain drawn as a graph misstates what controls what -- so a surviving chain brings every field beneath it. The notice nonetheless read "no object shows more than N at once". At a cap of 2, three chains of five fields renders **10** fields. The dropped count was right and the sentence was false; it now describes the cap in chains and says a rendered chain shows every field beneath it.

`applyTotalCombinationBudget` sliced a holder's combinations without incrementing that holder's own `truncatedCombinationCount`, and the panel renders those per-field and per-scope counts beneath their rows. A field the budget emptied therefore rendered as a field that declares **no combinations at all**, with no local notice -- "rendered as something it was not", one level below where the aggregate notice was telling the truth. Each holder is now told what it lost, and a holder wholly inside the budget is left alone rather than sliced into an identical copy.

Both were reachable on `main` too; this change rewrote the code and the wording around them, so they are fixed here rather than deferred. Three regression tests pin them, each asserting against the exact previous string or count.

### The top of the panel is the find box

The reader opens this panel to look one field up. Everything else at the top level is a caveat *about* the rows -- where they came from, whether they still match your metadata, what the rendering ceiling dropped, what was skipped -- and every one of them used to sit between the reader and the only control that gets them there.

The toolbar is now the **first** thing under the scanned-path line, ahead of the provenance banner and both notice blocks. It is already `position: sticky`, so first is also where it stays on screen once the reader is down among the object sections. With no objects in the model it is not drawn at all: there is nothing to filter, and `applyFilter` -- the only thing that fills its match count -- never runs.

The skipped-item list moved behind a disclosure and starts **collapsed**. What a reader has to see is the *count* -- that is what tells them the panel is not showing everything -- and the summary carries it either way. The list itself is one line per skipped item and is unbounded in how many the metadata skipped, which made it the longest block above the find box. Collapsed is not dropped: nothing is removed from the model, the section is still registered in the contents as `Not covered`, and every warning is still rendered under its own object, which is where a reader looking at that object meets it.

The generation stamp moved into the header. `generated 2026-09-03T12:00:00Z by Treecipe 3.17.0` now sits on its own small line directly under the panel title, indented, and the provenance banner no longer carries a copy -- it keeps its heading, its freshness message, its `Check again` button and the manifest path. Stated once, and where you meet it.

It is drawn only when there *is* one: a metadata preview was read from your source XML rather than generated, so its `generatedAt` is empty and no stamp appears. And it is revealed **last**, together with the scanned path, for the reason that line is: a header line filled from the model is exactly what made a failed render read as a finished one, so it stays hidden unless the whole body drew.

All of this is asserted by executing the real panel script against the fake DOM harness rather than by matching its source, because all of it is a property of the rendered page: *where* the find box lands among the blocks, whether the list is open when it first draws, what the stamp says. That took three honest fixes to the harness -- its `classList` now answers `contains` from the classes an element actually carries rather than from its own `add` history (a section collapsed via `createElement('div', 'hidden')` was reported visible); its fake elements start with the classes the **shell markup** declares, so a header line the panel never revealed is not reported visible either, with a test pinning the markup they mirror; and it records listeners, so a test can open the disclosure the way a reader does.

### Smaller things

Every combination row now starts collapsed. It used to open for a row a check had reported a failure on, and singling out a subset on any other basis would put a claim about the rows into a disclosure state.

The record type scope note changed for the same reason. It used to read "not asserted by the check: Apex describe returns picklist values without record type filtering" -- a statement about what verifies the row. It now says what the row **is**: the record type narrows the field-level dependency above it.

## [3.16.1] - customRelationshipMappings: the config wiring and the hierarchy result get tests

Closes [#47](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/47).

The `customRelationshipMappings` property itself shipped in 3.5.0. Auditing it against the acceptance criteria on #47 turned up three things the original change left open. No runtime behavior changes here -- this is the evidence that the feature does what it claims, plus the user-facing documentation it never got.

### The result the property exists for was never asserted

The existing tests stopped at `resolveParentReferenceForField` -- "which parent api name comes back". The criterion is about what happens *after* that: the object has to end up a child of the mapped parent, in the same relationship tree, written to the same Treecipe file, with the parent inserted first. Nothing carried a mapping that far.

Four tests now do, driving a mapping through `resolveParentReferenceForField` into `buildBidirectionalChildAndParentRelationshipReferences`, `processAllRelationships` and `generateSeparateRecipeFiles`, and asserting the levels, the tree grouping and the insertion order that comes out the far end. One of them mixes a custom-mapped lookup with an OOTB `AccountId` on the same object, since "custom entries extend OOTB entries" is only really shown when both resolve in one pass.

### The config read had no tests of its own

`DirectoryProcessor.getCustomRelationshipMappings` is what actually puts a user's `treecipe.config.json` in front of every `Lookup` field missing a `<referenceTo>` tag, and nothing tested it directly. Its lines were already *executed* by the existing `processDirectory` tests -- `DirectoryProcessor.ts` coverage does not move in this change, and is 63.57% before and after -- but executed is not asserted, and none of that reached the behavior below. It is memoized for a reason -- it is consulted per field but must read the file once per directory -- and it swallows the missing-config throw for a reason: a workspace with no Treecipe config still has to process normally rather than aborting the walk. Both of those are now pinned, including that a *failed* read is cached too, so a config-less workspace does not re-throw and re-catch once per field.

Pinning the accessor is not enough on its own, though, and a performance review of this change caught the gap: every one of those tests reaches the memo directly, so moving the read back into the per-field `forEach` -- or calling `ConfigurationService` straight from the call site -- would restore a synchronous `existsSync` + `readFileSync` + `JSON.parse` per unresolved lookup field and leave all of them green. A sixth test drives `processDirectory` over three objects contributing three unresolved lookup fields each and asserts **one** configuration read for the whole walk. Against that regression it reports nine.

### One test passed for the wrong reason, over unreachable code

`getMergedReferenceLookupMap` guards against a custom entry overwriting an OOTB one, and a test claimed to cover it using the key `"AccountId"`. It does not. A valid custom key is always `"ObjectApiName.FieldApiName"` and an OOTB key is always a bare field api name, so the two key spaces cannot intersect -- `"AccountId"` is rejected several lines earlier as a malformed key, and the override guard is unreachable. The assertion was right and the reason was wrong, which is the kind of test that stops being true without anyone noticing.

The test now says what actually preserves the OOTB entry, and a second one covers the case the old name implied: `"CustomObject__c.AccountId"` is a well-formed custom key whose field segment collides with an OOTB key, and both entries coexist. The guard is left in place as a cheap invariant for any future OOTB entry that is not a bare field name.

### Documentation

`customRelationshipMappings` was described here and nowhere a user would look. `README.md` now documents it under **Initiate Configuration File** -- the key format, a worked example, and the four ways an entry is quietly skipped, since a misspelled key fails silently by design and "check the key spelling" is the first thing to try when an object is still landing in the wrong tree.

Newly generated configs still omit the property. Absent already means `{}`, and a placeholder in every generated file buys nothing.

## [3.16.0] - The spec manifest carries the information content of the specs, not their cross product

Resolves [#102](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/102).

Reading and parsing `treecipe/PicklistDependencySpecs/manifest.json` was the single largest cost of opening the Picklist Dependency Explorer -- measured during 3.11.0 at roughly **59%** of the open, and named there as tracked rather than fixed.

The size was structural. Every expectation recorded its own `forbiddenValues`, so the file grew with *combinations x declared values* when the information content of those two lists is their **sum**. The view model had already had this exact treatment -- `IPicklistDependencyCombinationViewModel.hasForbiddenAssertion` carries no values for the same reason -- and the manifest had not.

### The complement is derived, not stored

A field entry now records `declaredValues` **once**, and an expectation whose forbidden set is the complement of its `dependentValues` within that universe records one boolean instead of the values:

```jsonc
{
    "controllingValue": "cle",
    "dependentValues": ["ohiocity"],
    "forbiddenValuesAreDeclaredComplement": true
}
```

`buildSpecDetailsByManifest` reconstructs the array on read, so **every consumer is unchanged** -- the Explorer's rows, and `PicklistDependencyMetadataWriterService`, whose whole transpose turns on that list because `expectNotAllowed` is what *removes* a pair. A reconstruction that quietly returned an empty list would leave writeback adding but never removing, so that is asserted directly rather than assumed.

Measured on a synthetic org of 150 objects x 8 dependent picklists x 40 controlling values x 120 declared values, serialized and parsed through the real builder (median of three runs; in-memory, so no disk read is included):

| | before | after |
|---|---|---|
| `manifest.json` | **315.7 MB** | **32.2 MB** |
| `JSON.parse` | ~1,400 ms | **~59 ms** |
| validate + normalize | ~119 ms | ~33 ms |
| `buildSpecDetailsByManifest` | ~41 ms | ~145 ms |
| **read → spec details** | **~1,560 ms** | **~237 ms** |

The reconstruction is the one thing that got *slower*, by ~104 ms, and it is named rather than buried: deriving 48,000 complements is work the old shape did not do. It buys back 13x that on the parse.

The issue's baseline of 153 MB / ~1.37 s came from the same shape with shorter api names; the parse times agree, and the ratios above are within one fixture on one machine, which is the only comparison worth quoting.

### Ordering the universe once per field, not once per complement

The generator emits its complement sorted, so a reconstruction that only filtered would return the right values in the wrong order -- identical to a set comparison, and not identical to the round trip the manifest is now held to. Sorting *inside* the complement measured **594 ms** against **59 ms** for the filter alone, which would have handed back most of what the parse saved. The universe is ordered once per field instead, and `buildDeclaredComplement` takes it already ordered.

### Three forbidden states, still three

- **the marker** -- the complement, which is what the generator always emits
- **a written-out `forbiddenValues` array** -- a set that is *not* the complement. `expectNone` and `expectUnavailable` both assert an **empty** one against a universe that is not empty, and the panel renders those two differently from each other
- **neither** -- a spec asserting only the positive half, which the panel must not draw a complement for at all

Deriving the marker is a *comparison*, not an assumption: `buildManifestExpectations` builds the complement and checks it against what the expectation actually declares, recording the values literally when they differ. That is what makes the round trip a property of the manifest rather than a coincidence of what the two generators happen to emit -- an Apex-parsed spec naming a partial `expectNotAllowed` list is entitled to forbid something that is not the complement, and rewriting it into one would assert something the spec never claimed.

The universe recorded is the one each spec was **drawn against**: for a record-type-scoped field that is what the record type assigns, not everything the field declares, which is why it is recorded per field *entry* rather than per field api name. It also has to be **complete** -- a truncated universe would have every consumer deriving a complement understate what the spec forbids, which is a false claim rather than a shorter one.

### `manifestVersion` is now 3

A version 2 manifest is structurally readable -- objects, fields and expectations in shapes this build walks -- which is exactly why it is refused by version rather than by shape. It carries no `declaredValues`, so every complement drawn against it would be empty and the panel would show specs that forbid nothing at all. It is refused with the existing "re-run Generate Picklist Dependency Tests" message.

### Two things the marker changed about reading a manifest from disk

`manifest.json` is a file a hand edit controls, and it is committed into repositories other people clone. Recording the complement as a marker changed the read path in two ways that the security review caught and this release closes.

**The format became decompressive.** The file now carries the *sum* of the two picklists while reading it still materializes their *product*. Under version 2 an expansion of forty million values needed a file that literally contained them — roughly 400 MB — so file size was its own ceiling. It no longer is: a **0.70 MB** manifest expands to **40,000,000** values, and the expansion happens on load, *before* `applyModelLimits`, which bounds what is rendered from a finished view model rather than what building one allocates.

Reading is now bounded by what a manifest expands to. The ceiling was **measured through the real builder**, not chosen:

| shape | file | reconstructed | time | heap |
|---|---|---|---|---|
| real large org, 1,200 fields | 8.95 MB | 5.7 M | 268 ms | 61 MB |
| 1 field, 5k values x 5k combos | 0.74 MB | 25.0 M | 1,716 ms | 261 MB |
| 1 field, 20k values x 2k combos | 0.70 MB | 40.0 M | 2,356 ms | 352 MB |
| 1 field, 20k values x 4k combos | 0.95 MB | 80.0 M | 3,022 ms | — |

**25 M** is 4.3x the largest real org measured and holds the load to roughly 260 MB. Only an expectation carrying the *marker* counts against it — one carrying its forbidden list literally already costs the file what it costs memory, which is the ratio version 2 had throughout. A test asserts the headroom over a real org rather than trusting the comment.

**A universe read from disk is complete or it is nothing.** `declaredValues` was filtered to strings on load, like every other tolerant entry parse. For this field that filter was itself the bug: a list read *partially* looks whole, and every complement drawn from it names fewer values than the spec forbids — a false claim rather than a shorter one, which is precisely what the complete-universe rule exists to prevent. It is also worse than the same edit was under version 2, where one bad element cost one expectation's list; here it would silently narrow the universe for **every** expectation on the field. A list that cannot be read whole is now treated exactly like one that is not there: no universe, and no "must not unlock" rendered anywhere on that field.

### CI: the worker recycle threshold now recycles before the suite that needs a clean one

This change added twenty-two tests and turned CI red — `RelationshipService.test.ts` OOM-ing a worker at the 4 GB ceiling, reported as `SIGTERM` with **zero failing tests**, which is the failure 3.11.0 mitigated and explicitly did not root-cause.

Measured rather than assumed, because the obvious reading — "the new tests are heavy" — is wrong:

- The manifest suite grew by **3 MB** (235 → 238 MB) across 18 new tests. The new tests are not the memory.
- `RelationshipService.test.ts` passes **alone under a 1 GB cap**. It is not a large allocation; it is a high allocation *rate*, which is only fatal on a worker that is already warm.
- What the twenty-two tests actually changed is *scheduling* — which suite lands last on a hot worker.

So the defect is unchanged and still main's: `calculateLevelsRecursively` is still exponential in depth, and any PR that adds tests can shuffle it onto a warm worker. `--workerIdleMemoryLimit` is the existing lever for exactly this, and 512 MB was above the ~500 MB a worker reaches before picking up the next file, so it never recycled in time. At **250 MB** the worker is recycled first.

Measured at CI's exact 4 GB cap, on this branch:

| `--workerIdleMemoryLimit` | result |
|---|---|
| 512 MB (before) | 1 of 2 runs green |
| **250 MB (now)** | **4 of 4 runs green** |

Applied to **both** `jest-test` and `jest-test-summary`, because CI runs the latter — flags on the former alone would have changed nothing, which is the same trap 3.11.0 called out. No test is skipped, disabled or quarantined. This remains a mitigation with a measurement attached, not a root cause: the traversal still wants its own issue.

### Tests

Every new guard was verified by reintroducing the defect -- dropping the reconstruction fails seven tests across all three services, including the existing round trip, the Explorer's row parity and the writeback's proposed metadata. The shape itself is pinned at small scale in `PicklistDependencyManifestService/tests`: a field whose controlling values each unlock exactly one of twelve values writes each value **twice**, where the old shape wrote it thirteen times.

## [3.15.0] - The Explorer says when it cannot draw, and the freshness check becomes something you ask for

Resolves [#108](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/108).

### A render that fails now says so

The Picklist Dependency Explorer could fail silently and completely. `renderPanel` ran its five render functions top to bottom inside the webview's message listener with no `try`/`catch` and no `onerror` anywhere in the panel script, and it wrote the scanned-path line FIRST. So a throw in any one of them left the heading and one line naming the objects directory over an empty page -- which is indistinguishable from a panel that loaded and found nothing.

Nothing reported it, and nothing could. A webview exception never reaches the extension host, so `failPicklistDependencyExplorerLoad` never ran: the host had posted a model, the post had succeeded, the status bar item disposed on schedule, and as far as it knew the load had finished. The error existed only in the webview developer tools, which nobody opens because nothing suggests there is anything to look at.

Three changes, together:

- **The render runs inside a guard.** A throw now replaces the body with a failure notice naming the error, rather than leaving a partial page. The partial page is not a smaller correct answer -- the objects that did draw are an arbitrary prefix of the model -- so it is cleared rather than left under a warning.
- **The scanned-path line is revealed last**, after the body it describes has drawn. It was the marker that made a failed render look like a finished one.
- **The panel tells the host either way.** A new `renderFailed` message carries the error and stack to `ErrorHandlingService.handleCapturedError`, the same path a host-side failure takes, and a `rendered` acknowledgement records that something is actually on screen. A `window` `error` listener catches throws outside the render -- a lazy expand, a row handler -- through the same channel.

A `render` failure is distinguished from a `runtime` throw after a successful draw. Only the first invalidates the panel and empties its action allow-lists; a handler that threw on a keystroke leaves the rows readable. Each distinct failure is reported once, because the `error` listener fires per event. `unhandledrejection` is covered too — an async throw in the panel was as silent as the bug this fixes.

**This is containment, not a root-cause fix.** The specific throw behind the report that prompted this has not been reproduced: every model array the panel dereferences is built as a concrete array by the model builders in the same process, and `buildManifestLoadByParsedContent` validates the manifest structurally before any of it. What changes today is that the next occurrence names itself instead of looking like an empty org.

### The freshness check is an action, not a toll

Opening the Explorer ran a recursive `statSync` walk of the entire objects directory -- ~113 ms across 7,800 field files, and materially worse on Windows-with-Defender or a network mount -- to answer a question the reader may not have asked. 3.11.0 moved that walk after the first paint, which fixed the blank window but not the cost.

The structure a reader opens the panel for is fully derivable from `manifest.json` alone. Staleness is a caveat *about* that structure, not a precondition for it. So the walk is gone from the open path entirely, and the provenance banner carries a **Check against current metadata** button. After an answer it reads **Check again**.

- **`notChecked` is a new resting state**, distinct from `pendingCheck`. `notChecked` means nobody has looked; `pendingCheck` means a walk is in flight. Collapsing the two would leave a panel nobody asked to check sitting forever behind a progress message for work that is not running. The banner states it -- *"Generated specs -- not checked against your current metadata"* -- rather than narrating it.
- **`checkFailed` is a new answer**: the walk ran and could not read the directory. It is separate from the two stale values because reporting "your metadata changed" for an `EACCES` sends a reader looking for an edit they never made.
- Neither is styled or labelled as stale, and neither ever claims `fresh`. All four non-fresh values keep the property the banner depends on: a panel that has not established agreement with metadata does not assert it.
- The `checkingFreshness` load phase is gone; an open's last reported phase is `buildingView`, and the status bar item is disposed when the model renders.

The check is gated on the render state rather than on a path allow-list, because the command carries no path: the host answers from the manifest it stored when it rendered, and refuses when it stored nothing. A metadata preview has no manifest to be stale against and is refused, as is the window before any model exists. A second click while a walk is in flight is dropped rather than queued, and an answer is not posted into a panel closed across the walk.

### Freshness checks contain their own I/O failures

`resolveManifestFreshness` catches a throw out of the fingerprint walk and returns `checkFailed` with the reason, naming the objects directory specifically when the cause is `ENOENT`. The walk happens on a click that may come long after the panel opened, and a throw escaping it would have been reported as the Explorer failing to *load* -- past a panel that had been on screen and usable the whole time.

Reaching that state required changing the **walk**, not just adding a `try`/`catch` around it. `collectSourceFingerprintEntries` swallows `readdirSync` and `statSync` failures per directory -- deliberately, so one locked subdirectory costs that subdirectory rather than the answer -- which meant a missing objects directory produced `sha256('')`, mismatched the recorded fingerprint, and was reported as *"your metadata has changed since these specs were generated"*, sending the reader to regenerate from a directory that is not there. The root is now read unguarded: below it, tolerance is unchanged. There is a regression test that uses the real walk against a real missing directory, because a mocked-throw test passes against the broken version.

Every refusal of a check also **answers** the panel. The click optimistically shows "checking" before the host has agreed to anything, so a silent return left a disabled button narrating a walk that was not running -- recoverable only by reopening the panel, and the exact state `notChecked` was introduced to abolish.
## [3.14.0] - Address compound fields expand into the component fields that can actually be inserted

Resolves [#4](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/4).

The Salesforce Collections API cannot accept a compound `Address` field -- a record is inserted with its *components*: `Street`, `City`, `State`, `PostalCode`, `Country`. Recipe generation had no way to say that. `RecipeService` emits exactly one line per field file, and `'address'` was absent from `getMapSalesforceFieldToFakerValue()`, so a `<type>Address</type>` field fell through to the default branch and produced `### TODO -- FieldType Not Handled -- address does not exist in this programs Salesforce field map.` A compound address field file carrying no `<type>` tag at all did worse: it parsed as `AUTO_GENERATED` and produced the "may be auto generated by Salesforce" placeholder. Either way the user hand-authored five lines per address field, per object.

The OOTB half of this was already done and is untouched -- Account, Contact, Lead and Contract have carried their `Billing*`/`Shipping*`/`Mailing*`/`Other*` components in `getOOTBObjectApiNameToFieldApiNameMap()` for some time. What was missing is every address field those four static maps do not name.

### One field file can now produce several recipe lines

`processFieldsDirectory` pushed one `FieldInfo` per field file and `processDirectory` appended one recipe line per `FieldInfo`. Rather than change that contract -- every other field type depends on it -- a compound address field returns *several* `FieldInfo` objects and none for the compound field itself. The one-line-per-`FieldInfo` invariant holds; only the number of `FieldInfo`s changes.

An empty result is therefore meaningful, and is the duplicate guard. A component is dropped for either of two reasons, and both would otherwise put the same key in an object recipe twice: the OOTB mappings already emit it, or the object HAS that component as its own field file. The second is why `Asset` matters -- it is in the OOTB mappings but names no address components, so its bare `Address` compound field expands to `Street`/`City`/... and would collide with a `Street.field-meta.xml` retrieved alongside it. Expansion therefore runs after the directory walk rather than inline, because directory order decides whether a component's own field file is read before or after the compound field and a duplicate key is invalid either way.

### Detection is metadata first, config second

`<type>Address</type>` is the primary signal, consistent with every other field type handler. For a compound field whose XML carries no usable type, an optional `customCompoundAddressFields` array in `treecipe.config.json` names those fields explicitly -- following `customRelationshipMappings` in both respects that matter. Its entries are keyed by object AND field (`Store__c.Legacy_Address__c`), not by bare field api name: a field api name repeats across objects, so a bare key would expand `Legacy_Address__c` on every object that happens to have one. And it is equally tolerant -- a value that is not an array, or entries that are not strings, degrade to nothing configured rather than throwing. Recipe generation for every other field in the workspace is worth more than reporting a hand edit.

### Component api names are derived, not listed

Salesforce names compound address components two ways and the compound field's own api name is the only signal for which:

| Compound field | Components |
|---|---|
| `Site_Address__c` | `Site_Address__Street__s`, `__City__s`, `__State__s`, `__PostalCode__s`, `__Country__s` |
| `BillingAddress` | `BillingStreet`, `BillingCity`, `BillingState`, `BillingPostalCode`, `BillingCountry` |
| `Address` (Lead) | `Street`, `City`, `State`, `PostalCode`, `Country` |

Lead's compound field is named `Address` outright, so the empty prefix and the bare component names it produces are a correct result rather than a fallback.

### State and Country, not StateCode and CountryCode

`StateCode` and `CountryCode` only exist in an org with State and Country Picklists enabled. `State` and `Country` exist either way, and source metadata does not say which org a recipe is destined for -- so emitting the coded form by default would produce recipes that fail to insert everywhere the feature is off. Both faker services assert they carry the plain components and neither coded one.

`GeocodeAccuracy` is not emitted: it is a component of the compound field but is populated by the org's geocoding clean rules, not by an insert.

## [3.13.0] - Generating picklist dependency tests reports what happened, and what to do about it

Resolves [#107](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/107).

A successful run used to report itself by concatenating up to five sentences into `vscode.window.showInformationMessage`. A VS Code notification is one line of unformatted text that truncates, so what a user actually saw was the spec counts and the beginning of the classes directory -- the manifest path, the record-type caveat, the scaffolded framework classes and the removed stale classes were all past the cut. And nothing in it said what to do next, which is the question a finished run leaves you with.

### The run is now a document, and the toast is one line

The generate command writes `treecipe/PicklistDependencySpecs/generation-summary.md` -- a sibling of `manifest.json`, never inside a package directory, for the same reason the manifest is not: a stray file there is not valid Salesforce metadata and would ride into `sf project deploy` and fail the deploy it describes. It opens in markdown preview once the run finishes -- after the spec class, so the report is what you are left looking at -- and the toast's **View Summary** re-opens it later.

**What happened** is one bullet per fact, and the optional ones are *omitted* rather than rendered as zero -- a run that scaffolded nothing has nothing to say about scaffolding, and a "0 classes scaffolded" row reads as something that failed rather than something that did not apply.

**What to do next** names the Explorer by its exact Command Palette title, says to review the generated Apex as a diff before deploying it, and links the walkthroughs: [running the tests inside the org](docs/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md), triggering a failure on purpose to prove the gate works, deciding whether the org or the source is right when one fails, and the technical design. The diagrams are **linked, not copied** -- a second rendering of those flows here would be a second derivation to keep in sync, which is the same reason the Explorer reads the manifest instead of re-walking the source XML.

The toast is now `Generated N picklist dependency spec(s) across M per-object class(es).` plus the deploy question, and carries **View Summary** and **Open Explorer** beside **Deploy and Run Against Org**.

### Reading the run does not cost the deploy offer

Every inspect action re-offers the deploy rather than ending the command on the click -- the principle **View Details** already followed, now generalised. Each is offered once, which is what makes the loop terminate: every pass either ends the run or spends an action, and there are at most three.

Opening what the run produced is subject to the same rule as writing it. A preview that will not open, or an explorer that throws, is a failed *view* of a generation that succeeded -- so it warns and puts the offer again rather than letting the rejection reach the command's catch and report a completed run as an error, dropping the deploy offer with it.

### What deliberately did not move

The warnings keep their own path. A missing framework class means the generated Apex will not compile at all, and an unparseable test suite means `Run Picklist Dependency Check` will not find the tests -- those are blockers, and folding them into a success document would bury them under good news. The skipped-field roll-up and its **View Details** output channel are unchanged.

The summary is a **report on** a finished write, not a step of it. By the time it is written the Apex, the suite and the manifest are all on disk, so a workspace that will not take one more markdown file warns about the report and leaves the run reporting the success it actually had -- no button for a document that does not exist, and no error for a generation that worked.

### Values from metadata cannot restructure the document

Api names, class names and paths reach this document from XML the extension does not control, and markdown has no escaping inside a code span -- only a longer fence. So the fence is grown past the longest backtick run in the value, a value that starts or ends with a backtick is padded, and **a line break is rendered as its escape sequence**: a blank line ends the paragraph the span lives in, so a value carrying one would otherwise become markup for everything after it. That last case was found by the test written for it, not by reading the code.
## [3.12.0] - Initiate Configuration: a picker that opens immediately, seeded from sfdx-project.json

Resolves [#100](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/100).

**Initiate Configuration File** built its entire directory list before it showed anything. `promptForObjectsPath` walked every non-hidden, non-`node_modules` directory in the workspace -- one `readdir` per directory, recursively -- and only then called `showQuickPick`. On a real repository that is thousands of stat calls with an empty screen in front of them.

It is worse from the warning notification. VS Code dismisses a notification the instant one of its buttons is clicked, and offers no way to keep it open, disable the button, or put a spinner in it. So clicking **Run Treecipe Initiation Setup** removed the last thing on screen that said anything was happening, and nothing replaced it until the walk finished.

### The picker opens first and fills as it scans

`promptForObjectsPath` now builds the quick pick up front, marks it `busy`, shows it, and streams directories in as the walk discovers them. The dead time is not narrated -- it is gone.

**The user's answer ends the command, not the scan.** Selecting a directory found in the first few milliseconds returns immediately; the walk is told to stop and unwinds on its own. This is the part that is easy to get wrong -- an earlier draft awaited the whole walk and only then read the selection, which put the original stall back one layer down and, worse, threw away an already-made selection if the user then hit Cancel. Both cases are now covered by tests that fail against that shape.

Item updates are **batched** (200 items or 100ms, whichever comes first). Assigning `.items` is an ext-host to renderer round trip that re-sends the entire list and re-runs the filter, so one assignment per directory is quadratic in payload on exactly the large workspaces this targets. The highlighted item is restored across each flush, because VS Code resets it to the top -- otherwise the scan would drag the user's cursor away from them while they were reading.

Alongside it, the scan runs under a **cancellable** progress notification. `ProgressLocation.Notification` rather than `Window` for the reason the picklist dependency commands already chose it: `Window` "supports neither cancellation nor discrete progress", so the token it hands you never fires. Cancelling before a selection stops the walk, closes the picker, and writes no configuration file.

### Options come from sfdx-project.json

Where a workspace has an `sfdx-project.json`, the scan is seeded from its `packageDirectories` instead of the workspace root, and the picker says so. To be clear about the size of this win: the walk already skipped `node_modules` and dotfolders, so most of the directory reduction predates this change -- seeding drops the remaining non-DX siblings and, more usefully, puts the directories a Salesforce developer actually wants at the top of the list.

> Select directory that contains the Salesforce objects - options from packageDirectories in sfdx-project.json

**Every** usable entry, not just the one marked `default` -- a multi-package repository can keep objects under several, and seeding from only the default would hide the rest. Entries are scanned in file order, so a team that lists `force-app` first means it. A `Browse all workspace directories...` item is always offered for the case where the answer is somewhere else.

### Every way the project file can disappoint you degrades to the old behavior

The commands that write Apex resolve a package directory through `resolveDefaultPackageDirectoryPath`, which **throws** on each of these, because they cannot proceed without one. Config initiation can, so it reads the same file through a tolerant resolver instead:

- No `sfdx-project.json` -- the user is not in a DX project, and still gets the full walk
- `packageDirectories` missing, empty, or with no usable `path` -- full walk
- A path that is absolute, escapes the workspace, or is not on disk -- skipped, and the remaining valid entries still seed the picker
- A project file that is present and **unparseable** -- full walk, plus a warning naming the file, because that one is a typo the user wants to know about rather than an absence

### Internals

`SfdxProjectService` is new, and deliberately a leaf: `fs` and `path`, no `vscode`, no other service. `VSCodeWorkspaceService` needed the containment logic that lived in `PicklistDependencyTestService`, and importing that service would have closed a cycle through `RecipeService` and `ErrorHandlingService`. `PicklistDependencyTestService` keeps its four helpers as delegations, `isPathContainedInWorkspace` injecting its own realpath resolver so it remains the one source of truth for how its paths resolve.

The value here is the cycle and the dependency weight of that one module graph, and **not** a startup saving: `extension.ts` imports `ExtensionCommandService`, which imports `@salesforce/core` at the top level, so that dependency is loaded on the first command regardless of what this service does.

Reading `sfdx-project.json` now requires a regular file rather than merely an existing path -- a repository can commit that name as a symlink to a character device, and reading one would hang the extension host on the first command a new user runs.

The walk also stopped calling `getWorkspaceRoot()` once per directory entry; it is resolved once and handed down the recursion.

## [3.11.0] - Picklist Dependency Explorer: the panel opens first and says what it is doing

Resolves [#97](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/97).

### Fixed first: the panel has rendered nothing since 3.8.0

The panel script is emitted from a template literal, so every backslash in it has to be doubled — `'\\n'` in the service source is what puts `'\n'` in the script. One site was written with a single backslash, which the template consumed, so the shipped script contained a string literal broken across a real newline:

```js
.join('
')
```

That is a `SyntaxError`. It kills the entire IIFE, so **every** version from 3.8.0 through 3.10.0 opened the Picklist Dependency Explorer to an empty panel — no structure, no banners, no toolbar. Nothing else in the extension was affected.

No test caught it because every test in this file asserts on the script as *text*, and text does not have to parse. Two guards now stand where it was: one compiles the emitted script with `new Function` (which needs no DOM and no new dependency, and answers the one question `toContain` cannot ask), and one anchors the exact site. Both were verified by reintroducing the defect and watching them fail.

Opening the Explorer on a large org looked like nothing happening. The panel was not created until a finished model existed, so every phase — reading the spec manifest, stat-walking the objects directory for staleness, building the view, serializing it — ran against a window showing nothing at all. On a synthetic org of 150 objects x 8 dependent picklists x 40 controlling values that was roughly two seconds of blank tab, with no way to tell which phase was slow or whether the command had failed.

### Fixed: relationship level calculation allocated a set per path

`RelationshipService.calculateLevelsRecursively` handed every child a **copy** of the visited set. The set holds the current path, so a copy per child means an object reachable by many paths is re-walked once per path — with a fresh allocation each time.

On a layered graph, the shape an org has when several objects share a child lookup:

| objects | recursive calls |
|---|---|
| 30 | 88,572 |
| 36 | 797,160 |
| 42 | **7,174,452** |

Each of those calls was allocating. That allocation rate is what exhausted CI's 4 GB heap, and on a deep enough org it would have done the same inside the extension while generating recipes.

The set is now added to on entry and removed on exit. A child sees exactly the same set it saw before — a sibling's subtree removes its own entries on the way out — so the cycle guard is unchanged and the per-child allocation is gone. **2.0-2.3x faster** on the graphs above.

Verified by differential run: the levels assigned across 600 random graphs, cyclic and acyclic, are **identical** to the previous implementation. That check earned its place — a first attempt also skipped re-walks that could not raise a level, which is the fix for the exponential *time*, and the differential caught it changing the levels of 1,531 objects, all in graphs containing a cycle. Those levels decide the insertion order of generated recipes, so that change needs its own issue rather than riding along with a memory fix. **The traversal is still exponential in depth.**

### CI: bounded jest workers, and a run that says where its memory went

A jest worker on CI was reaching the 4 GB V8 heap ceiling and dying, which failed the build with **zero failing tests** — the OOM and the reported `SIGTERM` are different processes, so the suite named in the log was collateral rather than the culprit. It was not specific to this change: `main` failed identically, and the same commit on another branch went both ways on consecutive runs.

Nothing in the run identified the real consumer, so the test scripts now ask:

- `--logHeapUsage` — every suite reports its heap, so the next failure names the consumer instead of its neighbour
- `--workerIdleMemoryLimit=512MB` — recycles a worker that grows past the limit, which bounds the accumulation this looks like (no suite exceeds 342 MB on its own, yet a worker reached 4 GB)
- `--maxWorkers=2` — lowers concurrent peak, and measured *faster* locally rather than slower

Applied to **both** `jest-test` and `jest-test-summary`, because CI runs the latter — flags on `jest-test` alone would have changed nothing about the failure.

This is a mitigation with a diagnostic attached, not a root cause: the failure does not reproduce locally even at CI's exact heap cap, where the suite passes with a 1 GB cap.

### The panel opens before the work, not after it

The webview shell is static — it carries no model — so it is created and shown the moment the command runs, in **0.01 ms**. What used to be a blank window is now a panel reporting the phase it is in:

- **Reading the generated spec manifest…**
- **Loading the most recent picklist dependency check results…**
- **Building the dependency view…**
- **Checking whether the generated specs still match your metadata…**

Each phase appears both in a status line at the top of the panel and in a status bar entry, so the load stays legible whether or not the panel has focus. The status bar entry is an explicit item rather than `ProgressLocation.Window`, which supports neither cancellation nor discrete progress; the generation command's progress notification is unchanged, because cancelling *its* walk is useful and this load has nothing to cancel.

### The staleness walk no longer blocks the first paint

`resolveManifestFreshness` stats every file under the objects directory to answer "could this have changed since generation". It produced a *caveat about* the structure rather than any part of it, so the structure is now painted first and the walk runs after, posting its answer into the banner when it lands.

Measured honestly, that walk is ~113 ms — about 5% of the open on local disk, not the largest phase (the manifest parse is, at ~59%). It is the phase most exposed to a slow filesystem, which is why it moved, but the earlier paint it buys on local disk is worth ~113 ms rather than seconds.

The load also now yields the extension host's event loop between phases. Without that, the whole open is one uninterrupted turn: VS Code batches webview posts and status bar writes and flushes them when the turn ends, so every phase line would arrive at once, after the work it describes had finished, and the panel would open having narrated nothing.

Until it lands the banner says so. Manifest freshness has a fourth state, `pendingCheck`, rendered as *"Generated specs — checking whether they still match your metadata…"*. It is deliberately neither "fresh" nor "stale": calling it fresh would assert agreement with metadata nothing had looked at yet, and calling it stale would send you to regenerate over a difference that may not exist.

### The model is posted, not embedded

The view model used to be serialized into a `<script type="application/json">` block inside the panel document — up to 18 MB of it for a large org. It now travels over `postMessage`, which changes three things:

- The document is independent of the model, which is what lets it be shown before one exists
- Revealing a hidden panel — the panel is deliberately not retained when hidden — is answered from the host's copy of the model, so the manifest is not re-read, the model is not rebuilt, and the objects directory is not re-walked. To be precise about what this does *not* buy: the old path did not re-run any of that on a reveal either, because VS Code retained the html it had been given. What changes is where the cost sits — a reveal now costs the host ~58 ms warm to re-serialize the model, in place of the webview re-parsing an 18 MB document
- **No metadata reaches the panel document at all.** Picklist values, api names and Apex failure messages are written into the DOM through `textContent`, so the escaping this service used to apply on the way into the html is gone rather than merely unused — there is no markup context left for a value to escape out of

### What did not move

The run results overlay stays *before* the first paint, and the measurement is why: loading `results.json` and attributing every failure to its combination costs **17 ms** of a two-second open, under 1%. Deferring it would also break something real — `applyModelLimits` keeps a failing combination over a passing one when the rendering ceiling has to drop rows, and it cannot do that against statuses that have not been applied yet. A row dropped for lack of a status is a row a failure then has nowhere to land on.

Two larger costs are named here rather than fixed: the manifest parse (~1.1 s of that open, because `manifest.json` records `forbiddenValues` per expectation and so grows with combinations x declared values) and the model build (~380 ms). Both are tracked separately.

## [3.10.0] - A dedicated Apex test suite for the generated picklist dependency tests

Resolves [#96](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/96).

**Generate Picklist Dependency Tests** wrote `SDTPLDSpecsTest.cls` and nothing that named it. The only way to run the generated assertions was to know the class name and hard-code it — in a CI pipeline, in `sf apex run test --tests`, or by finding it in Setup. This extension did exactly that too, invoking the class it happened to generate.

That makes the generated class name a public contract by accident. Rename it, split it per object, and every pipeline that referenced it breaks.

### The suite is the handle

Generation now also writes `<packageDir>/main/default/testSuites/SDTPicklistDependencyTests.testSuite-meta.xml`, an `ApexTestSuite` registering `SDTPLDSpecsTest`. It is the stable name a pipeline, Setup → **Apex Test Execution**, and this extension all address:

```
sf apex run test --suite-names SDTPicklistDependencyTests --target-org <alias>
```

The suite has one member today, and that is the point — its value is the stable handle, not the member count. Anything later added or split out is registered in the same suite, and nothing downstream changes.

### Regeneration merges, it does not reset

A test suite is a grouping a team curates. Someone may well add their own picklist-adjacent test class to it, so regeneration **unions** the generated member in and removes nothing:

- A member added by hand survives every regeneration
- Members are emitted sorted, so regenerating an unchanged project reproduces the file byte for byte and the suite stays out of source-control diffs
- A `.testSuite-meta.xml` that cannot be read as an `ApexTestSuite` is left **exactly** as it is, with a warning saying the generated tests are not registered in it — rather than being silently replaced by a file this command could understand

This is the same rule the metadata writeback follows: silence in the generated model is never an instruction to delete.

### The check runs the suite

**Run Picklist Dependency Check** now invokes `--suite-names` rather than `--tests`, so the extension and everyone else reach the tests by one route instead of two. The suite file is included in the deploy the command offers, because a deploy that sent the classes without it would succeed and then fail at the very next step.

The "is it deployed" check asks about **membership**, not existence, through one Tooling API query over `TestSuiteMembership`. A suite whose member class has been deleted still exists, and running it would report success having asserted nothing — the same vacuous-green failure the generated `specRegistryIsNotEmpty` guard exists to prevent one layer down.

### Refusing to run a suite the org does not have

A workspace generated before this release has every class and no suite. Left alone, the check would have found no suite in the org, offered a deploy, sent the classes **without** one, and then invoked `--suite-names` against an org that still had none — failing with the CLI's own unknown-suite error and nothing to say that regenerating is the fix. The deploy now requires the suite file up front and says exactly that instead.

### Reading a suite it did not write

The merge reads a file a hand edit or a cloned repository controls, so it is deliberately hard to fool:

- The "is this a suite" test is loose while the member reader is strict, so every occurrence of the element is **counted** and compared against what was read. A member written in a form the reader does not handle — an attribute, a self-closing tag, an unclosed element — makes the whole file unreadable and untouched, rather than parsing as absent and being dropped on write. Dropping a member is the one outcome the merge exists to prevent.
- Comments and CDATA are stripped before anything is counted or read, so a member deliberately **commented out** is not restored on the next regeneration.
- Entities are decoded on read to match the escaping on write. Without that a member stored as `A&amp;B` grew an entity on every run, which would have broken the byte-for-byte stability described above.
- A file that exists but cannot be **read at all** — a permissions failure, a lock held by another process — is now distinguished from "no file yet". Only `ENOENT` means there is no suite; anything else writes nothing and warns, because generating a fresh file over an unreadable one would drop every member it held.

### Containment that works on a directory that does not exist yet

`getRealDirectoryPath` could not resolve a directory that had not been created, and fell back to comparing the path lexically — which skips symlink resolution for the whole path, so a symlinked *ancestor* would satisfy the containment check that exists to catch exactly that. That was tolerable while every checked directory already existed; `testSuites` is guaranteed absent on a first run, which would have made the weak branch the normal one for it. It now resolves the nearest **existing** ancestor and re-appends the remaining segments. Every caller benefits, not just the new one.

The check command applies the same containment to `testSuites` that generation does, since it derives that path too in order to put the suite in the deploy.

### Also in this release

- The spec manifest records the suite name and file path, written by the run that generated the Apex rather than recomputed by a reader. `manifestVersion` is now **2**; a manifest written by 3.9.0 is refused with the existing "re-run the command" message rather than being read as if it named a suite.
- The change report no longer filters the suite out. It previously excluded every `-meta.xml`, which the suite file's own name ends with, so a run whose only change was the suite reported nothing. The filter now targets the `.cls-meta.xml` sidecar specifically.
- `writePlannedSpecsFiles` creates each planned file's own directory, since the planned set no longer lives in one place. It remembers which it has created, so a run emitting hundreds of classes does not repeat the same `mkdir` for the same directory inside a loop that cannot yield.
## [3.9.0] - Generate Picklist Dependency Tests: progress you can watch, warnings you get once

Resolves [#92](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/92).

**Generate Picklist Dependency Tests** was the only picklist dependency command that reported nothing while it ran. The check, the metadata writeback and both Explorer paths each wrapped their work in a progress scope; generation walked the entire objects directory, read every field's XML, resolved global value sets, planned every file and wrote the Apex — all with a frozen UI. On a large org's metadata it looked hung. Its warnings, meanwhile, arrived as up to four separate notifications *partway through the walk*, before you knew whether generation had even succeeded.

### Progress you can watch, and stop

The run now reports itself in a progress notification and the walk can be cancelled.

It started as a status bar spinner, and that turned out to be unimplementable as specified: `ProgressLocation.Window` "supports neither cancellation nor discrete progress" — it renders no cancel button, so the token behind it never fires, and no percentage bar either. Status bar and cancellation are mutually exclusive in the VS Code API. Cancellation won, which also puts this command in line with the check and the writeback rather than apart from them.

While walking, it reports a **growing** count of what it has found — `47 dependent picklist field(s) found so far, reading Account...`. Not a fraction: nothing at that point knows how many dependent picklists the tree holds, because establishing that is what the walk is doing. A denominator there would be a guess, and a guess that ran low would make the bar move backwards. Once collection finishes the total is real, and the write phase reports against it — `writing spec 12/47...`, advancing on unchanged files too, since on a re-run from unchanged metadata most classes are already correct and reporting only rewrites would leave the message stalled.

The run is in three parts — read, **ask**, write — and the change-plan confirmation sits between two progress scopes rather than inside one. A progress bar left spinning behind a modal asking whether to proceed is the thing being asked about.

**Cancellation is on the walk only, and that is deliberate.** The walk awaits the filesystem per directory, so its token genuinely flips and it stops between directories with nothing written; it is also the larger cost, and the one that grows with org size. The write phase is straight-line synchronous code — the host thread never yields, so a token could not flip part way through however often it were polled. A per-file check there would advertise responsiveness the runtime cannot deliver. Leaving the write uninterruptible is also what keeps the generated classes and the manifest a matched pair: a half-written set with no manifest describing it is a state nothing downstream can detect, because freshness is computed from the *objects* directory, which a write never touches. The honest design is not to create that state at all.

Declining the change-plan confirmation still reports what was skipped. That is the one path where the skips matter most — the user is deciding whether the generation is worth taking.

### One report at the end, grouped by what actually happened

The per-warning notifications are gone. Skips are now carried as identity rather than only as prose — every one records a typed `reason` — and the run closes with a single message that groups them, with **View Details** writing the full list to the output channel. Reading the warnings does not cost you the deploy offer; it is put again once the report is open.

The grouping keeps three outcomes apart, because they are not the same news:

- **Fields skipped** — no spec was generated (`invalid api name`, `no "valueSettings" markup`, `global value set not found`, and the record-type file failures)
- **Values dropped** — the field was specced, but values the global value set does not declare were left out of it
- **Record-type scopes skipped** — the record type assigns no values, so no combination is reachable through it; the field-level spec still covers the field

Rolling those into one "skipped" count would overstate what the run declined to do. The aggregate warning this replaces already took care to say so in prose; it is now structural, and the panel and the manifest group by the same table the summary does.

Where every candidate was skipped, the skips are folded into the *same* "no dependent picklists were found" message rather than arriving as a second toast — one run, one piece of news.

### Manifests written before this release still load

`manifest.json` now records each skipped field's reason. A manifest written by an earlier version carries none, and a hand-edited one can carry a string this build does not define. Both degrade to `unknown` rather than dropping the row: the warning text is still exactly what the run reported, and losing the entry would understate what generation left out — the one thing the skipped-field list exists to prevent.

### Notes

- No new command, and no change to `IRecipeFakerService` or `IFakerRecipeProcessor`. Neither faker backend is touched — this lives entirely on the Apex generation path
- The progress port handed to `PicklistDependencyTestService` is deliberately free of any `vscode` type, so what the walk reports and where it stops are unit-tested rather than asserted against a `withProgress` double
- A framework class that could not be scaffolded keeps its own warning rather than riding in the summary. It means the generated Apex will not compile at all, which is a different kind of news from a run report, and an information toast VS Code truncates is the wrong place for a blocker
## [3.8.0] - Picklist Dependency Explorer layout: less to scroll past, a contents to navigate by

Resolves [#93](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/93).

3.7.0 made the Explorer searchable. It was still a panel you had to scroll, because the longest thing on every row was the part fewest readers wanted and the record types sat flat beneath the fields with nothing separating them. This release is layout only — nothing about what the model carries, what the ceiling drops, or what any status means has changed.

### "must not unlock" collapses

A combination's forbidden set is the *complement* of what it unlocks, so it grows with the field's picklist while the unlock list stays short. A field declaring 40 values pushed the four values a controlling value actually unlocks off the screen under the 36 it forbids.

It is now a disclosure — `▸ must not unlock (14)` — collapsed by default, with two deliberate exceptions:

- **A failed row opens it.** A failed combination already opens its spec and run-report links for the same reason; `MISSING_VALUES` and `EXTRA_VALUES` are *about* the forbidden set, so putting it behind a click on a row already marked failed is a step with nothing on the other side of it.
- **A capped declared list still says so, uncollapsed.** Where `maxDeclaredValuesPerNode` capped a field's universe, the panel refuses to draw a complement against it and says why. That line is a claim about what the panel *cannot* show; behind a collapsed arrow an unexpanded row would read as "nothing forbidden here" — the exact false claim the branch exists to avoid.

The count in the summary is taken from the rendered list rather than computed a second way, so the label and the list cannot disagree. An empty complement renders no disclosure at all.

### A table of contents

Under the toolbar, collapsible, open on arrival:

- **Sections** — the banners and notices the panel actually rendered, each registered by the renderer that built it, past that renderer's own guard. A section the panel did not render cannot appear in its contents.
- **Objects** — every object with its counts, status and `not asserted` badge. Clicking one opens it, scrolls to it, and shows every one of its dependent picklists including the ones the active query was hiding: naming the object outranks the query *within* it.

Object entries hide and show with the filter, so the contents and the panel can never give two accounts of what is on screen. Every entry addresses a section the panel already built — the contents names nothing the panel is not showing, and opens no path of its own.

The **Jump to object** dropdown is retired. One thing it could do does not survive: that select listed every object unconditionally, so it could reach an object the filter had hidden, and a contents that lists only what the panel is showing has no entry to click for one. Widening the query is how you reach it now — the trade buys a contents that cannot disagree with the panel beside it.

### Record types are their own section

A field's record type scopes move under one collapsible `Record Types (4)` group instead of being appended flat beneath the field-level combinations. The separation is the point: a field-level combination is asserted by the generated check and a record-type-scoped one is not, and running them together as siblings made a reader work that out from the wording of a note.

The group header shows a **failed count** and **never a passed or unknown badge**. Apex describe returns picklist values without record type filtering, so nothing in the shipped framework verifies a scoped row — a green badge over the group would assert exactly what each scope's note exists to deny. A failed count is a different statement: it is about scopes a run *did* report against.

Where the rendering ceiling dropped scopes, the notice saying so sits **outside** the collapsible body, directly under the header. The header states the count of scopes the panel renders, which is not the field's record type count when some were dropped — a correction behind a click the reader has no reason to make is not a correction.

Scope bodies stay lazy. Opening the group reveals headings that already existed and builds no rows, so the record type axis still does not multiply the panel's element count. Two paths open the group when something inside it is the target: a pasted combination reference naming a scoped row, and a find-box query naming a record type — without them, the panel would filter down to the right field and then leave what was searched for behind a collapsed disclosure.

A group the *filter* opened, the filter closes again when its match lapses. The find box fires on every keystroke and matches on a bare substring, so a prefix of a query names record types the finished query does not — typing `Status__c` matches `Master` on its first letter — and opening without ever closing would leave exactly the wall of headings this group exists to collapse, held open by a query that no longer matches. The moment the reader touches a group themselves, though, the filter stops managing it in both directions: reopening one they just shut is the same kind of wrong as leaving one open that no longer matches.

### Unchanged

Filtering still only ever hides, and recomputes no status. `Expand all` still opens object sections only, bounded by the same 25-object limit — expanding every group and disclosure would reintroduce the volume this release removes. No model limit, manifest shape, or generated Apex changed.

## [3.7.0] - Picklist Dependency Explorer UX: find it, understand it, jump to it

Resolves [#83](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/83).

3.1.0 shipped the Explorer as one flat scroll of every dependent picklist in the org. It rendered the data correctly, and it was not usable at org scale: finding a field meant scrolling, a failed combination showed you the raw Apex failure kind without telling you what to do about it, and the whole model was built into the DOM up front. This release makes the panel somewhere you diagnose drift rather than somewhere you look once.

### Find a field without scrolling

A toolbar above the structure, sticky to the top of the panel:

- **Find object or field** — matches on object, field, controlling field, record type and generated method name. Searching for a field name reaches the object holding it, so you do not have to know which object that was. When exactly one object matches, it opens by itself
- **Status** — *any status* / *failed* / *passed* / *not checked*, so "what broke" is one selection rather than a scan
- **Jump to object** — every object by name; picking one opens and scrolls to it, even when the filter was hiding it
- **Expand all / Collapse all**, bounded: past 25 visible objects the panel says so and asks for a narrower filter rather than freezing

Filtering only ever hides. No status is recomputed and none is inferred from a row being hidden — an unverified combination stays unverified whether or not the filter is showing it.

Every combination also carries a **Copy reference** action. It copies the stable combination key the manifest recorded — `Object__c.Field__c [RecordType] @ Controlling Value` — and pasting that back into the find box reopens exactly that combination, in that object, under that record type. It survives a re-render in a way a scroll position does not, so it is something you can put in a review comment or a ticket.

### Opens and stays responsive at the pathological shape

PR #80 measured roughly 1.8M DOM elements at 100 objects × 3 dependent picklists × 5 record types, on top of an unbounded embedded payload. Both are now bounded:

- **An object's rows are built when you expand it**, not at load. Record type scopes already worked this way; the same rule now applies one level up, so opening the panel builds a heading per object and nothing else. Filtering runs against the model rather than the DOM, so it costs the same whether an object has been expanded or not
- **A measured ceiling on the model itself.** Per-axis caps shape the panel — at most 250 objects, 25 dependent picklists per object, 200 combinations per field, 25 record type scopes per field, 200 declared values per field — and one **total budget of 20,000 rendered combinations** across the whole model is what actually bounds its size. The caps alone do not: their product is millions of rows

The per-axis numbers were chosen; the total was **measured**, by serializing synthetic models through the real builder:

| Scenario | Objects | Combinations rendered | Embedded JSON |
|---|---|---|---|
| Healthy 100 × 3 × 50 (inside every cap) | 100 | 15,000 | 5.19 MB |
| Healthy 400 × 3 × 400 (over every cap) | 250 | 20,000 | **9.67 MB** |
| Every combination failing, 400 × 3 × 400 | 250 | 20,000 | **11.40 MB** |
| Every combination failing, 100 × 3 × 300 | 100 | 20,000 | 9.06 MB |

For reference, the unbounded payload this replaces reached about **17 MB** on a large org, and the same synthetic shapes measured **57 MB** and **144 MB** against an earlier draft of this ceiling that capped only the per-axis numbers.

Getting there took bounding three axes, not one. Combinations were the obvious one. Dependent picklists per object were unbounded. And `declaredValues` — the value universe a field's forbidden complement is drawn against — grows with the picklist rather than with how many combinations survive the budget, which made it the dominant term once the other two were capped.

Where that value universe is capped, the panel **stops drawing the "must not unlock" list** and says why: a complement of a partial universe understates what the spec forbids, which is a false claim rather than a shorter one.

The rule that decides what survives is fixed: **a combination, scope or object the check reported a failure for is never dropped in favour of a passing one**, and neither is an object carrying a skipped field. Where retained rows alone exceed a per-axis cap, they are all kept. Past the *total* budget even a reported failure can be dropped — an unbounded payload is worse for the reader than a bounded one — and that case is counted and named on its own, pointing at the run's `report.md` as the complete record. A dropped row is absent and counted, never re-labelled: the three-state guarantee holds under the ceiling exactly as it holds under a filter.

### A failure tells you what to do about it

Every failed combination now carries a **likely cause** and a **next step** in the words of someone who administers the org, alongside the Apex kind and message — never instead of them. All ten `SDTPicklistDependencyValidator` failure kinds are covered, and the two that no org state can cause say so explicitly:

- `MISSING_VALUES` → a value was unassigned from the dependent field, or the matrix was re-drawn; re-tick it in Setup, or re-generate to re-baseline
- `FORBIDDEN_VALUES_PRESENT` → the dependency was widened in the org, which is the direction that silently lets bad data in
- `CONTROLLING_FIELD_MISMATCH` → the dependency was re-pointed at another controlling field, which invalidates every combination for that field at once
- `CONTRADICTORY_EXPECTATION` and `CIRCULAR_DEPENDENCY` → a hand edit to generated Apex, not org drift. **Do not change the org**: nothing in it caused this
- `UPSTREAM_FAILURE` → this row was not evaluated at all; fix the named upstream spec first
- A kind this version has never seen is **not** explained away — the panel says it has no explanation and points at the raw Apex message

The prose is stored **once per failure kind** at the model root and looked up by kind in the panel, not copied onto every failure. Only an unrecognised kind carries its own text inline, because that text names the kind. Inlining it made the payload grow with how *broken* an org is rather than how large it is.

### Straight to the code and the run entry

A failed combination opens with its detail already showing, because it is the row you came for. Beside **Reveal in Explorer**:

- **Open spec method** — opens the generated `.cls` at the *declaration* of the spec method that asserts this row. A generated class names each method twice, at its declaration and inside `all()`; the declaration is the one you wanted
- **Open run report entry** — opens the run's `report.md` at that object's `### ` entry, which is the entry carrying the message

Each is offered only where the model names the code behind it, so a metadata preview offers neither — nothing asserts a preview row, and a link into a class that does not exist would contradict the banner above it.

### Webview posture unchanged

No external resource, no new runtime dependency, no local server. The content security policy is byte-for-byte what it was: `default-src 'none'` with the extension's own nonced inline style and script only, and every metadata-derived value still goes through `escapeHtml` or `escapeJsonForScriptBlock`.

Each new panel action is gated by **its own allow-list**, built from the model the panel was rendered from. The spec and report lists key on the file *and* the method together, so a message cannot pair a file the model named with a method name of its own choosing; **Copy reference** is matched against the combination keys the model actually declares.

An allow-list is only as trustworthy as the text it was built from, and `manifest.json` is a file on disk that a hand edit — or someone else's commit — controls. **Open spec method** is the first thing to turn a manifest-recorded path into a file the extension host actually reads, so `generatedClassFilePath` and `classesDirectoryPath` are now brought back inside the workspace before they can become openable targets, exactly as the objects directory already was. A path outside the workspace resolves to empty, which renders no button and contributes no allow-list entry — the same way a metadata preview already behaves.

## [3.6.0] - Update Picklist Dependency Metadata: writing spec intent back into source

Resolves [#81](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/81).

v3.4.0 made the generated Apex specs a durable statement of intent: edit a spec, the test goes red, fix the org, it goes green. But *"fix the org"* was entirely manual. You read a failure saying `Account.Region__c @ cle: missing [plant]` and hand-translated it into XML.

That translation is a **transpose**, which is what made it error-prone. The failure is indexed by **controlling** value; the metadata is indexed by **dependent** value — so making `cle` also unlock `plant` means editing the **`plant` block**, nowhere near where the failure message points you.

### The new command

**Update Picklist Dependency Metadata from Specs** (`treecipe.updatePicklistDependencyMetadata`) reads the generated Apex — including whatever you edited into it — and reconciles your source metadata to match. It runs opposite to Generate, and closes the loop the check opens.

| Command | Direction |
|---|---|
| Generate Picklist Dependency Tests | metadata → Apex specs |
| **Update Picklist Dependency Metadata from Specs** *(new)* | **Apex specs → metadata** |
| Run Picklist Dependency Check | Apex specs → org (assert) |

Nothing is written before you see it. The command reports every pair it would add or remove, in the words the failure used — `cle unlocks plant` — and declining leaves every file untouched. After writing, it offers to deploy the changed files to an org; declining that says explicitly that the changes are in your working tree and were not deployed.

### Intent is merged into your metadata, not substituted for it

A spec asserts what a controlling value **must** unlock (`expectAtLeast`) and what it **must not** (`expectNotAllowed`). Anything it names neither way — and any controlling value it never mentions — it makes no claim about, and writeback leaves alone. Reading those silences as deletions would let a one-line hand-written spec strip the rest of the file.

`expectNone` and `expectExactly` are the exception, and deliberately so: both state their dependent list *completely*, so anything else the metadata unlocks under that controlling value contradicts the spec and is removed.

### The controlling field is reconciled too

A dependent field's `valueSettings` can only name a controlling value the **controlling** field actually offers. When a spec asserts `madison unlocks willowick` and the controlling picklist declares no `madison`, the value is added to that field's own `valueSetDefinition` in the same run — otherwise the write would describe a combination no user could ever reach, and you would find out on deploy. Only values a spec asserts are *usable* count; a forbidden combination names nothing the controlling field has to start offering.

The controlling field is held to the same global-value-set rule as the dependent one, and when it is itself somebody's dependent field the added values fold into its existing plan rather than producing a second write of the same path.

### Three things it refuses to do

- **A global-value-set-backed field** can be rewired, but a new value is refused with a message naming the set to add it to first. The only place a new value could go is the shared `.globalValueSet-meta.xml`, whose blast radius reaches every other field pointing at it. That file is never edited.
- **An orphaning cascade** — removing a value that is itself the controlling field of another picklist — names the downstream field and skips that field's write. Every unaffected field still writes. Resolving it means editing the downstream field too, which is a decision about intent this command has no basis to make alone.
- **A spec class that cannot be parsed** aborts naming the file, and writes nothing at all. Treating an unparseable class as "this object has no dependencies" would silently skip the fields you edited.

### Your file's formatting survives

Only two spans of a field file are ever rewritten: the `valueSettings` region, and `valueSetDefinition` when a spec names a value the field cannot offer yet. The XML declaration, indentation, unrelated markup and trailing newline are preserved because they are never rebuilt.

Both `<valueSettings>` shapes are supported and preserved — grouped by `valueName` with repeated `controllingFieldValue`, and one pair per block. Rewriting a file into the other shape would make the first reconciliation a restructure of every block.

Order is normalized alphabetically on both axes on the first writeback, so a second writeback with no spec change produces **zero diff** — and after a writeback, running Generate produces byte-identical Apex. The two directions agree, and neither reports drift the other introduced.

A field file that is not pretty printed is handled rather than damaged: where a `<valueSettings>` block does not start its own line, the rewritten span stops at the tag instead of extending back over markup that has nothing to do with it. New picklist values are inserted ahead of the *real* `</valueSetDefinition>`, located against a comment-blanked copy so a commented-out close tag cannot put them in dead text.

### Correctness across a multi-object run

Field API names are not unique across objects — `Status__c` on Account and on Case are routine and different. Every path map and dependency-graph key is therefore keyed by **object and field**, so one object's dependency metadata can never be written into another object's file, and an orphaning cascade on `Account.Type__c` is not read as one on `Case.Sub_Type__c`. Reports name fields the same way.

The write sink checks containment itself: a field file resolving outside the configured objects directory — a symlink out of the tree included — is refused rather than written, independent of the API-name validation upstream.

Chain links survive the round trip. `.dependsOn(...)` names a spec *method*, and method names are deliberately lossy, so the link is derived from the parsed set — a field whose controlling field is itself specced in the same class — rather than reverse-engineered from the identifier. A field naming itself as its controlling field stays a root.


## [3.5.0] - The Spec Manifest: the Explorer and the generated Apex become one artifact

Resolves [#82](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/82).

The Explorer and the generated Apex were two independent derivations of the same thing. The panel re-walked your source XML every time it opened, while the Apex in your package directory had been generated at some earlier moment from whatever the metadata looked like *then*. Nothing guaranteed a row in the panel corresponded to a spec method that actually existed, and a failure was attributed by matching free text against combinations the panel had just re-derived rather than against the ones the spec declared.

This release makes them one artifact.

### Generation writes a manifest, from the same model, in the same run

**Generate Picklist Dependency Tests** now writes `treecipe/PicklistDependencySpecs/manifest.json` alongside the `.cls` files it emits, built from the same in-memory model — so the two cannot disagree by construction. It records, per object, the generated class name and file path and the test method name; per field, the spec method name, controlling field, upstream field and every expectation; plus `generatedAt`, the generator version, the objects directory scanned, and the skipped fields.

It goes under `treecipe/` rather than beside the `.cls` files on purpose: a stray `.json` inside a Salesforce package directory is not valid metadata, and would ride along into `sf project deploy` and fail the deploy of the very classes it describes.

### The Explorer renders the manifest, and never re-derives

Opening the panel now reads the manifest and does not walk the source metadata at all. What you see is what your tests assert:

- **Every node names the generated class and spec method that asserts it**, and every object names its test method
- **Every combination carries a stable key**, and failure attribution resolves against those keys. A failure naming a combination the manifest does not declare is still surfaced as unattributed — the three-state guarantee is unchanged, and an unverified combination is still never rendered as verified
- **A field the generator skipped now appears as its own row, marked *not asserted*, with the warning text**, instead of being absent. A field missing from both the Apex and the panel was indistinguishable from one with no dependency at all, which is the more dangerous of the two readings. An object whose every field was skipped is rendered too, rather than vanishing
- **A manifest recorded against a different objects directory, or against metadata that has since changed, renders with a staleness banner** naming the generate command — never a silent re-derivation. Staleness is a stat-only walk (path, mtime, size) rather than a re-parse, so it keeps the cost the manifest was introduced to avoid
- **No manifest** gives an empty state naming the generate command, plus an explicit **"Preview from metadata (not generated)"** action. The preview keeps 3.1.0's "no setup required" property, honestly: its banner says nothing asserts any row below it, and no row claims a spec method
- **A malformed manifest** reports the parse failure and offers the same preview, handled exactly as an unreadable `results.json` already was — never a blank panel

### The generated Apex reads at a glance

The point of emitting specs is that reading one beats clicking through the Salesforce dependency matrix UI, so the Apex is a deliverable here too:

- Each per-object class header lists the object's dependent picklists and the controlling field for each
- Each spec method is preceded by a comment stating its combinations in plain language — `"USA" unlocks East, West -- and must not unlock Baja`, `"Ontario" unlocks nothing`, `"Canada" is not available under record type US_Only`
- The comment and the assertions are built from one spec detail, so they cannot drift apart

A picklist value carrying a newline or a block comment terminator is neutralised before it reaches a comment. Neither is producible through the Salesforce UI, which is exactly why nothing else in the pipeline would have caught one.

Adding a value to a combination now shows as six changed lines rather than three — the three assertions and the three comments that describe them. The diff stays proportional to the change rather than to the file, and a comment that did *not* move when its assertion did would be the drift the comments exist to rule out.

### Also in this release

- Skipped fields are now carried as structured entries (object, field, record type) alongside the warning prose, so the panel can group them without scraping a free-text message
- The staleness fingerprint stops descending at a directory holding `fields`, exactly as the collection walk does — the sibling metadata directories under an object (`listViews`, `compactLayouts`, `webLinks`, and the rest) cannot contain a spec-contributing file, so skipping them removes roughly seven in ten of the directories visited while producing a byte-identical digest
- A field file reached through a **symlink** is now digested rather than dropped. A symlink reports itself, not its target, so one pointing at a `.field-meta.xml` was previously treated as a directory and silently left out — edits to it never moved the fingerprint, and the staleness banner never fired
- The manifest's `objectsDirectoryPath` is checked for workspace containment before any node path is built under it. It is the only string in the manifest that reaches the filesystem, and those paths become the allow-list the panel's reveal action trusts, so a manifest committed into a cloned repo cannot point that list outside the workspace
- Object and field api names in a manifest are held to the same gate the generator applies before emitting. An edited name outside that shape now costs its own entry instead of aborting the whole Explorer command
- The Explorer reads each object's test method name **from the manifest** rather than re-deriving it — re-deriving was itself a second derivation of the kind this release removes, and the two inputs diverge the moment an entry is dropped at the parse boundary
- The manifest's object set is the union of field-level and record-type-scoped specs, matching the set the Apex writer emits classes for, so an object producing only scoped specs cannot get a generated class with no manifest entry describing it
- A picklist naming **itself** as its controlling field no longer emits a self-recursive `dependsOn`. The Explorer already treated such a field as a root; the emitter now agrees
- Fixed an intermittent test failure where temp directory cleanup on some container filesystems returned `ENOTEMPTY` and failed a test whose assertions had all already passed

## [3.4.0] - Diff-Friendly Picklist Dependency Specs

Resolves [#78](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/78).

The generated Apex specs are meant to be committed and code-reviewed, but nothing about them was built for that. This release makes them deterministic, shows you what a regeneration would change before it changes it, and teaches the Apex framework to recognise the one edit that can never pass.

### Emission is deterministic, so a regeneration is a reviewable diff

Output ordering used to follow the filesystem and the order values happened to appear in the metadata, so identical metadata could regenerate to different bytes on different machines, and adding one picklist value produced a diff far larger than the change.

Three orders were erased:

- **Spec methods** are ordered by field api name, independent of `readDirectory` order. Sorting happens where the spec details are built, so the Apex, the generated test class and the Explorer all inherit one order rather than three that can drift.
- **Expectations** are ordered by controlling value, so a value moving between "unlocks something" and "unlocks nothing" no longer reorders the emitted block.
- **Every value list** — `expectAtLeast`, `expectNotAllowed`, `expectNone` — is sorted. Previously the forbidden list was the complement taken in declaration order, so inserting one value into the middle of a picklist shifted that value's position in **every forbidden list under every controlling value**.

Regenerating from unchanged metadata is now a byte-identical no-op, and a real metadata change arrives as a diff of only the lines that changed. Adding one value to one combination now touches three lines — the `expectAtLeast` that gains it and the two complements that gain it — instead of every list in the file.

Sorting uses code unit order rather than `localeCompare`, whose result depends on the host's ICU locale data and so would reintroduce the same portability problem in another form.

> **One-time reordering diff.** The first regeneration after upgrading reorders your existing generated classes. That diff is reviewable, which is the point — but review it on its own rather than mixed in with a metadata change.

### The command shows what it would do before it does it

**Generate Picklist Dependency Tests** now resolves the whole change against what is on disk before writing anything:

- A run that would **replace or delete** something prompts with a report naming what is new, what is overwritten, and which stale per-object classes would be deleted. A stale class is now **named rather than removed silently**.
- **Show Diff** opens VS Code's native diff editor between the file on disk and the content that would be written, then returns to the prompt. Cancelling writes nothing.
- A run that only **adds** files does not prompt — nothing is lost — and a run that would change nothing neither prompts nor writes. Files already carrying their proposed content are skipped rather than rewritten, so an unchanged regeneration no longer moves their mtimes.

This replaces the old blanket modal, which fired on the mere presence of generated files, could not say what was about to change, and warned that hand-tightened `expectExactly` lines "will be lost".

That warning no longer describes how these files work. The workflow the specs exist for — **declare the dependency you intend, watch the test go red, fix the org metadata until it goes green** — now survives regeneration: git is the merge base, your edit shows up as a working-tree diff, and you keep or revert it per hunk. The generated class header says so.

### A spec that contradicts itself is reported as a broken spec, not as org drift

`expectNotAllowed` is emitted as the complement of `expectAtLeast`, so adding a value to the positive list without removing it from the forbidden one makes the spec **unsatisfiable** — no org edit can make it pass. That is exactly the trap a hand edit falls into, and it used to report forever as a paired `MISSING_VALUES` and `FORBIDDEN_VALUES_PRESENT`, which reads as two org problems rather than one broken expectation.

`SDTPicklistDependencyValidator` now raises `CONTRADICTORY_EXPECTATION`, naming the object, field, controlling value and the overlapping values. It runs **before** `source.fetch()`, so it costs no describe — which matters most on the run where it fires, since the whole class is validated in one transaction against the CPU limit. `expectExactly` is checked alongside `expectAtLeast`, being the other mode that carries required values and producing the same unsatisfiable pairing.

### Recipe generation is unchanged

No faker service was touched. `IRecipeFakerService`, `IFakerRecipeProcessor` and both backends' dependent-picklist recipe output are exactly as they were.

## [3.3.1] - Global Value Sets Actually Load

Resolves [#85](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/85).

### Generate Treecipe now produces real values for global-value-set-backed picklists

`GlobalValueSetSingleton.initialize` took a leading boolean that gated whether it did any work at all, returning immediately when `false`. **Generate Treecipe** passed `false`, so the sets were never loaded and every picklist backed by one fell through recipe generation with no values:

```yaml
# before
Territory__c: '### TODO: This picklist field needs manually updated with either a standard value set list or global value set'

# after
Territory__c: ${{ faker.helpers.arrayElement([`Territory_North`,`Territory_South`]) }}
```

If your project uses global value sets, regenerating will replace those TODO placeholders with real generated values.

**Generate Treecipe no longer warns when a project has no `globalValueSets` directory.** That notice never actually appeared before — the call returned at its guard before reaching the check — and it would now fire on every run for the majority of projects, which have no global value sets at all. A field that genuinely needs a set still generates a TODO naming that field exactly, which is more useful than a directory-level toast.

### Security: picklist values are now escaped before being embedded in faker expressions

A picklist option is untrusted text — it comes from field metadata, or a global value set, in whatever repository the user opened — and both backends embedded it into an executable expression with no escaping, contrary to the rule stated in `CLAUDE.md`.

- **faker-js**: options are embedded in a JavaScript template literal that the recipe processor passes to `new Function()`. A value containing a backtick closed the literal, and the rest of the value was executed as code rather than read as data. A `${...}` interpolation did the same without needing a backtick.
- **Snowfakery**: options are embedded in a single-quoted Jinja2 string literal evaluated by the `snowfakery` CLI. A value containing an apostrophe closed the literal the same way.

Both backends now escape every option at every embedding site — backslash first, then the delimiter each language uses, then newlines, which also prevents a value from breaking the generated recipe's YAML structure. The two escapers are deliberately **separate**, because the backends embed into different languages and one escaper covering both would under-escape each.

Values without special characters generate byte-identical output; only a value containing a backtick, apostrophe, backslash, `${`, or newline changes — and only to be emitted correctly as data.

This flaw predates this release and was reachable through ordinary picklist values, not only global value sets. It was found by the security review on the PR that made global value sets reach recipe generation for the first time.

### The flag is gone rather than fixed

The parameter is removed, not renamed. It guarded a case that never existed — nothing initializes these sets at extension startup, so there was never an "already initialized" run to skip — while its name, `isGlobalValuesInitializedOnExtensionStartUp`, described a **state** where the guard read it as a **command**.

Three of its four callers reasoned from the name and passed the value that silently disabled the call: recipe generation, and both picklist dependency paths (fixed in 3.3.0). The demo harness was a fourth. A parameter no caller wants, and most callers get backwards, is not worth keeping — so it cannot be passed wrongly again.

The call is also `await`ed now. Recipe generation started its objects walk without waiting, so even a corrected flag left a race that could empty the same picklists.

### Coverage for the command that had none

`generateRecipeFromConfigurationDetail` had no tests at all, which is why the defect survived being found and fixed on three sibling call sites. It now has two, both asserting what the command **achieves** rather than which arguments it passed: that the sets are loaded, and that loading finishes before the walk begins. The second fails if the `await` is removed.

## [3.3.0] - Deep Dependency Chains and Global-Value-Set-Backed Dependent Picklists

Resolves [#76](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/76). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### A dependent picklist backed by a global value set now gets a correct spec

A dependent picklist can take its values from a **global value set**. Its field file carries the whole dependency configuration — `<controllingField>` and `<valueSettings>` — while the values themselves live in `globalValueSets/` beside the objects directory.

Generation read only the field file, so the declared-value universe was just the values carrying a `valueSettings` entry. Every `expectNotAllowed` complement was therefore taken against a partial universe, and a global value set value that **no** controlling value unlocks — the value that belongs in *every* complement — went unasserted entirely.

**Generate Picklist Dependency Tests** and the **Picklist Dependency Explorer** now read the global value sets beside the objects directory, the same way recipe generation does, and take the complement against what the set actually declares.

- A field references its set by **full name** (the file name), while the only name inside the set file is `<masterLabel>` — an admin-editable display label. Global value sets are now registered under **both** names, collapsing to one entry wherever they agree, so a set whose label was renamed is still reachable from the field pointing at it
- A field naming a global value set that is **not in the project** is skipped with an explicit warning naming the set and the `globalValueSets` directory, rather than being specced against an empty universe
- A `valueSettings` entry naming a value the set does **not** declare — usually a value removed from the set without cleaning up the field — is dropped from the spec and reported. No org exposes that value, so asserting it would generate a spec that must fail for a reason the spec cannot fix. A controlling value left unlocking nothing becomes `expectNone`, which is what the metadata now says about it
- **Inactive** global value set values are excluded from the universe. An inactive value cannot be selected in any org, so leaving it in turned a controlling value that unlocks nothing into an `expectNone` line the org's describe can never satisfy — a generated spec that must fail against correct metadata
- Reading the sets never takes the calling command down with it. A `globalValueSets` directory that cannot be listed, or one malformed set file, costs that set rather than every other object's specs
- Recipe YAML output is unchanged: recipe generation reads the same `valueSettings`-derived map it always did

### The demo harness now exercises the global value set path it always claimed to

`scripts/picklist-dependency-demo` writes a `Planets` global value set and a tier 3 `Planet__c` field backed by it, and its first drift phase rewires a value on exactly that field. The headless driver never initialized the global value set singleton, so `Planet__c` was skipped as "set not found" on every run: it never got a spec, the drift phase asserted against a spec that did not exist, and `-Step FullRun` stopped there. The driver now initializes the sets the same way the command does, so the global-value-set drift path is genuinely proven rather than silently absent.

### Dependency chains deeper than two links are covered

The generator has always been depth-agnostic, but every test stopped at two links, so nothing proved the one link a deeper chain has that a shallower one does not: a spec that **has** an upstream and **is** one.

The `Chain_Example__c` fixture now runs `Country__c → State__c → City__c → District__c` — four fields, three dependency links — and the Apex framework tests cover the three-link chain end to end:

- A healthy three-link chain validates every link with zero failures
- A break at the chain **root** yields one failure at its source plus exactly one `UPSTREAM_FAILURE` per downstream link, each naming its **immediate** upstream rather than the root — the chain is fixed one link at a time. The memoized result carries through, so the failing root is described once no matter how many links hang off it
- A break in the **middle** leaves the root green, reports the middle failure at its source, and defers only the leaf

`dependsOn` is emitted only where the controlling field is itself dependent, so a chain of three dependency links emits **two** `dependsOn` calls — the root of the `dependsOn` graph has nothing above it.

## [3.2.0] - Record-Type-Scoped Picklist Dependency Specs

Resolves [#77](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/77). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Generated specs now capture what each record type actually exposes

The generated specs asserted the field-level dependency map — the "bones" from `valueSettings`. Record types sit on top of those bones: each assigns its own subset of picklist values to the controlling and dependent fields, so the combinations reachable *through a record type* are narrower than the field-level map. Nothing captured them, so a value unassigned from a record type left every generated test passing.

Where an object has a `recordTypes/` directory, **Generate Picklist Dependency Tests** now emits the field-level spec unchanged, plus one narrowed spec per record type:

```apex
public static SDTPicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c_recordType_Cleveland_Only() {
    return SDTPicklistDependencySpec.forRecordType('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only')
            .controlledBy('City__c')
            .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
            .expectNotAllowed('cle', new List<String>{ 'willowick' })
            .expectUnavailable('eastlake');
}
```

- Controlling values are the field's, intersected with what the record type assigns to the controlling field; each value's unlocked values are intersected with what it assigns to the dependent field
- A controlling value the record type **does** assign but whose unlocked values it assigns none of becomes `expectNone`; one it does **not** assign becomes `expectUnavailable`. The two are different assertions — `expectNone` requires the value to exist, so using it for an unassigned value would fail against exactly the metadata that is correct
- The forbidden complement is taken against **the record type's** assigned values rather than everything the field declares — a value the record type does not expose is already unreachable through it
- A chained spec links to the upstream spec for the *same* record type, and the link is dropped when the record type assigns nothing to the upstream field, rather than naming a method that was never emitted
- Scoped specs are collected by `recordTypeSpecs()` per object and `SDTPLDSpecs.allRecordTypeScoped()` on the aggregator
- An object with **no** `recordTypes/` directory generates byte-identical output to 3.0.0

### A field a record type never mentions is treated as unassigned, not as fully assigned

The one genuinely ambiguous case in the metadata. Treating absence as "every value assigned" would assert a contract the metadata never stated, so the combination is skipped, a warning names the record type and the field, and the field-level spec still covers that field. This matches what recipe generation already does with the same markup.

### The Apex framework understands record type scope

- `SDTPicklistDependencySpec.forRecordType(object, field, recordTypeDeveloperName)` alongside `forField`, with `isRecordTypeScoped()` and a `label()` that carries the record type — the validator's dedupe and memoisation key, so a field's field-level spec never collapses onto its scoped ones
- `expectUnavailable(controllingValue)` (`MatchMode.UNAVAILABLE`), the record-type equivalent of `expectNone`: it asserts the controlling value is not reachable at all, and fails with the new `UNEXPECTED_CONTROLLING_VALUE` kind — naming the values it wrongly unlocks — if a record type later gains it
- Malformed record type markup is skipped with a warning rather than aborting generation: a `<picklistValues>` block missing its `<picklist>` child, nested markup where the developer name should be, and `<values>` entries with no `<fullName>` are all well-formed XML that previously threw part-way through the walk — one of them mid-write, leaving a half-regenerated class set on disk
- `SDTPicklistDependencyValidator.Failure` carries `recordTypeDeveloperName` and renders it in the scope: `MISSING_VALUES — Account.Region__c [US_Only] @ United States: ...`
- Record type developer names pass the same api name gate as object and field names before being embedded in Apex; an invalid one is skipped with a warning rather than emitted

### The Explorer shows them too

The Picklist Dependency Explorer (3.1.0) renders the field-level structure; record type scoping was invisible there, which would have left the panel quietly disagreeing with the Apex it sits beside.

- Each record type's narrowed combinations are nested under the field they narrow, collapsed until opened, with the scope's own values as the universe its "must not unlock" list complements against — a value the record type does not expose is already unreachable through it
- A controlling value the record type does not assign renders as **not available under this record type** rather than as unlocking nothing: a different claim, and the one `expectUnavailable` actually makes
- Scoped rows are counted apart from field-level ones in the header, and stay "not checked" even after a passing run — the check validates `SDTPLDSpecs.all()`, which holds the field-level specs only, so calling them passed would report a scope nothing verified as green. Every scope says so beside its own rows
- The Explorer's failure parser now understands the `[RecordType]` segment `SDTPicklistDependencyValidator` emits, so a scoped failure attributes to its record type instead of landing on the field-level row for the same controlling value — and a failure naming a record type the metadata no longer declares is reported with its scope rather than silently dropped

### Known limitation: the scoped specs are captured, not yet verified against an org

Apex `Schema` describe returns picklist values with **no** record type filtering, and the UI API that does is a REST callout that cannot run inside `@IsTest`. Rather than answer a scoped spec with field-level data — which would report a scope that was never checked as green — `SDTSchemaPicklistDependencySource` rejects one outright with a message saying why.

So `SDTPLDSpecsTest` continues to assert `SDTPLDSpecs.all()` only, the scoped specs sit in `allRecordTypeScoped()` ready for an `ISDTPicklistDependencySource` that can read record-type-filtered values, and the generation summary says as much rather than leaving you to infer it. **Run Picklist Dependency Check** is unchanged: it reports what the Apex tests report.
## [3.1.0] - Picklist Dependency Explorer

Resolves [#73](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/73). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### New command: **Salesforce Treecipe: Open Picklist Dependency Explorer**

The dependency data this extension already extracts had only ever been emitted as Apex and as `treecipe/PicklistDependencyResults/check-*/{results.json,report.md}`. There was nothing to *look* at — working out which controlling value unlocks what, or which combination just broke, meant reading generated Apex or a markdown dump.

`treecipe.openPicklistDependencyExplorer` opens a read-only panel showing object → controlling field → controlling value → allowed values, with the values a combination must **not** unlock rendered alongside them, and the most recent check overlaid as pass/fail per combination.

- **Chains are a graph, not repeated rows.** A field whose controlling field is itself a dependent picklist is nested under it, drawn once, however deep the chain runs
- **A failing combination names the failure kind and message** — `MISSING_VALUES`, `FORBIDDEN_VALUES_PRESENT`, `CONTROLLING_FIELD_MISMATCH` and the rest, read out of the run's Apex assertion message
- **Clicking a combination reveals the generating field's source XML path**, with a "Reveal in Explorer" action that opens the `.field-meta.xml`
- Nothing new is required to use it: no org, no Salesforce CLI, and no previous check run. Only `treecipe.config.json` pointing at your objects directory

### It is a webview, deliberately

No local HTTP server, no open port, no new runtime dependency, and no second process. The panel's content security policy is `default-src 'none'` with only the extension's own nonced inline style and script admitted, so it can load nothing from the network — `form-action` and `base-uri` are named explicitly because neither falls back to `default-src`. The nonce comes from the crypto RNG rather than `Math.random`, so the policy does not rest on there being no injection primitive to spend a predicted value on. `localResourceRoots` is set **empty** rather than omitted: omitting it does not deny the grant, it defaults to the extension directory plus every open workspace folder.

Every colour is a VS Code theme variable, so it follows your active light, dark or high contrast theme without the extension knowing which is active.

One panel is reused for the window and revealed on re-run, rather than a new tab stacking up per invocation, and `retainContextWhenHidden` is deliberately not set — the panel's state is entirely derived from the model, so a hidden panel costs nothing to rebuild. Scanning runs under a progress notification instead of leaving the command looking inert while it walks a large org's metadata.

Picklist values, api names and Apex failure messages all originate in metadata the extension does not control, so none of them are interpolated raw — they are HTML-escaped, and the model is handed to the panel as JSON inside a `application/json` block that a value containing `</script>` cannot close. The "Reveal in Explorer" handler opens a path only when the built view model itself named it, so a message from anywhere else cannot make the extension host open an arbitrary file.

### An unverified combination is never shown as verified

The generated test class asserts one method **per object**, so `results.json` carries object-level outcomes and the per-combination detail lives inside the failure message. Three states follow, and the panel distinguishes all three rather than collapsing them into pass/fail:

| Situation | Shown as |
|---|---|
| The run covered this object and every failure it reported was tied to a combination, but not this one | passed |
| The run named this exact combination as failing | failed, with every kind and message it reported |
| No check has run, the object was not in the run, or **any** of the object's failures could not be tied to a combination | **not checked**, with the unplaceable failure text surfaced on the object |

The third row is the point. Marking every combination of an unattributable failure as failed would overstate a drift that touched one of them; marking them passed would report green for a combination the org may well have broken. Neither is a claim the loaded artifact supports.

Attribution is therefore decided **before** any status is assigned. An earlier revision only asked whether the failure message parsed at all, not whether the parsed failures actually landed on a combination — so a failure naming a combination the local metadata no longer describes was silently discarded, leaving the object marked failed while every combination under it showed a green tick and the Apex message vanished from the panel entirely. Found in review, fixed, and pinned by regression tests.

A controlling value may itself contain `": "` — `Tier 1: Premium` is a legal Salesforce picklist value — so the failure line `KIND — Object.Field @ Tier 1: Premium: message` cannot be split by the line alone. The raw tail is carried through parsing and resolved against the controlling values the metadata actually declares, rather than guessing at the first colon.

`SDTPicklistDependencyValidator` raises `MISSING_VALUES` and `FORBIDDEN_VALUES_PRESENT` independently for the same controlling value, so **every** failure on a combination is kept and rendered. Showing only the first hid a real drift fact.

### The panel payload is linear in picklist size, not quadratic

`forbiddenValues` is the complement of the allowed values within the field's declared set, so carrying it per combination made the embedded model the *product* of the two picklists' sizes. Measured against the first revision: **62 MB** of embedded JSON and 2.25 M value elements for a large org, and 6.6 MB for a single 300 × 800 picklist — enough to freeze the webview renderer.

The node now carries its declared values once and the panel derives each combination's complement, which is the same rendering from the *sum* rather than the product. Same shapes after the change: 6.9 MB (**9× smaller**) and 0.08 MB (**83× smaller**). A test pins the linear shape so it cannot silently regress.

An expectation that never declared a forbidden list asserted only the positive half, and the panel still renders no complement for it — the derivation is exact, not an approximation.

### Unhappy paths render, they do not error

- **No results directory** — the structure renders in full, marked "not checked" throughout, naming the directory that was looked in and the command that would populate it
- **Malformed `results.json`** — a readable message and the structure without the overlay, never a blank panel. A file that parses but carries no `methodOutcomes` list is reported the same way
- **Zero dependent picklists** — an empty state naming the objects directory that was scanned, and what makes a picklist appear there
- **A run folder holding no `results.json`** is skipped rather than picked and then failed on, so a partially written run does not hide the last good one

The newest run is chosen by the timestamp in the `check-<org>-<timestamp>` folder name rather than by file mtime — every file in a fresh clone carries the checkout time, which would make "most recent" arbitrary for anyone committing their check artifacts.

### Known limitations

- **A combination added since the last check run shows as passed.** Results are recorded per object, and nothing in `results.json` fingerprints the specs it was generated from, so the panel cannot tell "this combination was verified" from "this combination was added to `valueSettings` after the run". Re-run the check after changing dependency metadata.
- **A dependent picklist whose field is skipped during collection does not appear**, for the same reasons generation skips it — an invalid api name, or no `valueSettings` markup. The count of skipped fields and the reason for each is shown at the top of the panel rather than being silently omitted.

## [3.0.0] - SDT-Prefixed Per-Object Picklist Dependency Specs with Negative Assertions

Resolves [#72](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/72). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### BREAKING: every Apex class this extension writes is now `SDT`-prefixed

The picklist dependency framework shipped unprefixed in 2.12.0 and the generated registry carried an `SFTreecipe` prefix. Both are renamed, so **anyone who deployed the framework between 2.12.0 and 2.14.0 has classes in their org that this version orphans**:

| Was | Now |
|---|---|
| `PicklistDependencyFramework/` (folder) | `SDTPicklistDependencyFramework/` |
| `IPicklistDependencySource` | `ISDTPicklistDependencySource` |
| `PicklistDependencySpec` | `SDTPicklistDependencySpec` |
| `PicklistDependencySnapshot` | `SDTPicklistDependencySnapshot` |
| `PicklistDependencyReport` | `SDTPicklistDependencyReport` |
| `PicklistDependencyValidator` | `SDTPicklistDependencyValidator` |
| `SchemaPicklistDependencySource` | `SDTSchemaPicklistDependencySource` |
| `SFTreecipePicklistDependencySpecs[Test]` | `SDTPicklistDependencySpecs[Test]` |

- One prefix, applied to everything: a class in your package directory starting with `SDT` was put there by Salesforce Data Treecipe, not by you, and cannot collide with your own `PicklistDependencySpec`
- **Generation detects the old layout and warns**, naming the exact paths to delete locally and the exact class names to delete from any org they reached. **Nothing is deleted for you** — these are files in your package directory that may well be committed and deployed, so removing them is your call
- Left in place, the two frameworks deploy side by side under different names and both compile, which is why the warning names them rather than staying quiet

### A dependent picklist backed by a global value set is now captured

Found by running the generator against real-world metadata artifacts. `controllingField` was read only inside the `valueSetDefinition` branch of `XmlFileProcessor`, so a picklist whose values come from a **global value set** parsed as not dependent at all — even with `<controllingField>` and full `<valueSettings>` markup in the field file.

Two consequences, both silent: no dependency spec was generated for such a field, and recipe generation treated it as a plain picklist rather than a dependent one.

- `controllingField` is now read for a global-value-set picklist too, and `globalValueSetName` continues to be recorded — both facts are true of the field
- Its dependency configuration is derived from `valueSettings`, which names every dependent value and the controlling values that unlock it. Only the value *definitions* live in the global value set; the dependency markup is local
- The field therefore travels the same path as any other dependent picklist: it gets a generated spec with `expectAtLeast` / `expectNotAllowed`, a `dependsOn` link when its controlling field is itself dependent, and a dependency-aware recipe value with record type sections
- **Limitation, deliberate:** the values captured are those carrying `valueSettings` configuration. A global value set value with no `valueSettings` entry is unlocked by no controlling value and does not appear — reading the global value set file to include it is not done, since generation reads the object metadata it was pointed at
- A global value set picklist that is *not* dependent is unchanged, asserted by test

### A dependent picklist absent from a record type no longer crashes recipe generation

Also found through real-world artifacts, and present on `main` — unrelated to the picklist dependency spec work.

A record type can expose the **controlling** field, with the controlling value available, and still not include the dependent field in its picklist sections. The controlling-field lookup was guarded; the dependent-field lookup two lines later was not, so the undefined dereference threw and took recipe generation down for the entire run rather than reporting a gap in one record type.

- Present identically in **both** faker backends; fixed in both
- Each now emits the same `### TODO: -- RecordType Options --` line it already emits when the controlling value is unavailable, and continues with the remaining record types
- Tests added to both backends first, confirmed failing with `Cannot read properties of undefined (reading 'forEach')` before the fix

### Generated class names fit the Salesforce 40-character ApexClass limit

Found in scratch-org testing: the first per-object naming used a `SDTPicklistDependencySpecs_` prefix, which spent **27 of the 40 characters** before the object name began. `SDTPicklistDependencySpecs_Treecipe_Demo_c` is 42 characters and the deploy was rejected — almost any custom object breached it.

- The generated registry family is now `SDTPLDSpecs`, `SDTPLDSpecsTest` and `SDTPLDSpecs_<Object>`. `PLD` is picklist-dependency abbreviated; the prefix drops to 12 characters, leaving 28 for the part of the name that identifies the class
- The six framework classes keep their descriptive names — they are fixed-length, all fit comfortably, and they are the ones a human actually reads
- A custom object api name can itself reach 40 characters, so a short prefix alone is not a guarantee. An over-long name is truncated and given a 6-character digest of the **full** api name: unique, and stable across runs. A positional suffix would have changed as metadata changed and orphaned the previously generated class in the org
- Truncation strips a trailing underscore before appending, since `__` is not legal in an Apex identifier
- Tests assert the invariant directly against a 40-character object api name, plus stability across runs and distinctness for two names sharing a truncated prefix

### Negative assertions: drift is now caught in both directions

Generated specs only ever asserted what a controlling value *must* unlock, so a value that drifted **into** a combination it does not belong in passed silently. Each controlling value now gets a second line:

```apex
.expectAtLeast('USA', new List<String>{ 'Ohio', 'Texas' })
.expectNotAllowed('USA', new List<String>{ 'Ontario' })
```

- New `expectNotAllowed(controllingValue, values)` builder and a `FORBIDDEN_VALUES_PRESENT` failure kind naming the specific offending values
- The forbidden list is the **complement** — every value the dependent field declares that this controlling value does not unlock — taken from the field's own `<valueSet>` rather than from its `valueSettings` map, so a value carrying no `valueSettings` entry at all (unreachable under every controlling value) lands in every complement
- **This deliberately does not switch the generator to `expectExactly`.** Exact matching would fire on any value an admin legitimately adds to the field after generation; the complement tolerates that while still failing on a value in the wrong bucket. The `expectAtLeast` design decision from #62 stands
- A controlling value whose complement is empty emits no line — it would assert nothing. A controlling value that unlocks nothing still emits `expectNone`, which is strictly stronger than listing what it must not unlock

### One spec class per object, with an aggregator

A registry covering every dependent picklist in a real org is not something anyone reads, and regenerating rewrote one file that every object's diff landed in.

- One `SDTPicklistDependencySpecs_<Object>.cls` per object, each with one spec method per dependent picklist on that object
- `SDTPicklistDependencySpecs.all()` becomes a thin aggregator calling each per-object `all()`. Callers depend on the aggregator, so a per-object class appearing or disappearing does not ripple outwards
- **Splitting per field was considered and rejected** — it multiplies files by the number of dependent picklists for no gain in readability, and separates a chained picklist from the field that controls it
- The generated test class keeps its existing one-`@IsTest`-method-per-object shape, so **Run Picklist Dependency Check** needs no change to how it invokes or parses results
- Object api names collapsing to one Apex identifier (`Foo__c` and `Foo_c` both yield `Foo_c`) take a numeric suffix, as spec method names already did
- **Stale classes are removed.** An object that loses its last dependent picklist leaves a generated class the new aggregator no longer calls — left on disk it still deploys, so the org keeps asserting a contract your metadata no longer describes. Only files matching the generated pattern and absent from the current run are removed, and the summary names them. The aggregator, the test class and your own Apex are never touched
- The check command discovers per-object classes from disk and adds them to the deploy set — without them the aggregator deploys and fails to compile against classes that are not there

### Chained dependencies are linked

Where a dependent picklist is itself the controlling field of another (`Country__c` → `State__c` → `City__c`), the lower spec now carries `.dependsOn(specFor_Chain_Example_c_State_c())`.

- The validator resolves the chain and reports a break **once at its source**; each downstream spec gets a single `UPSTREAM_FAILURE` naming the spec to fix first, instead of repeating the same describe mismatch for every dependent below it
- Upstream specs are resolved **on demand and memoized**, not assumed present in the caller's list — the generated test class validates one object at a time, and a controlling field shared by several dependents costs one describe rather than one per dependent
- A `CIRCULAR_DEPENDENCY` guard terminates a hand-edited cycle rather than exhausting the stack. Salesforce cannot express a cyclic picklist dependency; a hand-edited `dependsOn` can
- A spec listed twice is reported once
- **A controlling field always lives on the same object as the field it controls**, so an emitted `dependsOn` always names a sibling method in the same per-object class. There is no cross-object chain to link, and none is fabricated

### Testing

- New three-level chain fixture (`Chain_Example__c`: `Country__c` → `State__c` → `City__c`) drives complement, chain-linking and contract coverage
- The contract test asserting that every emitted builder exists on the shipped Apex class now covers `dependsOn` and `expectNotAllowed`, and additionally asserts the validator exposes the new failure kinds and that every framework class the generator scaffolds is actually present in the shipped directory
- Apex tests added for forbidden-value detection, tolerance of org-added values, unknown controlling values under a negative assertion, healthy and broken chains, upstream-not-in-list resolution, the cycle guard, and duplicate specs
- Coverage: 83.07% → 83.58% statements, 77.67% → 78.08% branches, 85.15% → 85.83% functions

### Deploy confirmation now states the real reason, and refuses when there is nothing to send

Two defects in the deploy prompt, both found in review.

- The confirmation opened with *"`SDTPLDSpecsTest` was not found in `<org>`"* on **both** paths. The end-to-end command deploys because it has just rewritten the classes, having never asked the org anything — so a user whose test class *was* deployed was told it was missing, and could reasonably conclude their previous deploy had failed. The opening line is the only thing anyone has to reason about before approving a deploy. It now names the real reason on each path
- The confirmation was built **before** the check for anything to deploy, so a workspace where generation never ran got an approval dialog reading *"The following 0 file(s) will be deployed:"* with a blank list, and only received the actionable "run Generate first" error after approving it. The validation is now extracted and runs before the modal

### Tests for three service files that changed without them

Against CLAUDE.md's "update tests each change" mandate, three files had shipped untested.

- **`DirectoryProcessor`** — the new object-child pruning changes recipe generation for *every* user, and its safety argument lived only in a comment. Pinned now: sibling directories are not read once `fields` is present, a directory with no `fields` child is still walked in full, the object is still registered, and — the load-bearing one — record types still resolve from the fields path even though `recordTypes` is pruned from the walk
- **`VSCodeWorkspaceService`** — org quick pick labelling and dismissal, and the output channel's lazy creation, reuse, subscription registration, and clear-before-append ordering. Review raised that an org with an empty identifier would be indistinguishable from a dismissed picker; verification showed `buildAuthenticatedOrgDetails` already drops an unusable identifier upstream, so a test pins that invariant rather than adding a redundant guard
- **`ConfigurationService`** — the two picklist dependency results path methods

Coverage: 83.58% → 84.59% statements, 78.08% → 79.22% branches, 85.83% → 87.47% functions. `VSCodeWorkspaceService` moved from 75% to 85% statements and 61.5% to 84.6% functions.

### A stray `undefined/` directory, and the bug that created it

`undefined/treecipe/GeneratedRecipes/RecipeGenerationErrors/` was committed to this branch by accident, carrying two error captures from a debugging run. It was not excluded by `.vscodeignore`, so it would have shipped in the `.vsix`.

The directory name was the symptom of a real defect. `VSCodeWorkspaceService.getWorkspaceRoot()` is declared to return a `string` but returns `undefined` when no workspace folder is open, and all three error-capture writers interpolated it straight into a template literal — producing the literal string `"undefined"` and silently creating an `undefined/treecipe/...` tree wherever the process happened to be running. Anything running outside an extension host, the headless demo driver included, hits this.

- The three writers now resolve their target through a shared guard that returns `undefined` rather than a path built from a missing root, and each skips the capture with a warning instead of writing somewhere nobody will look
- The committed directory is removed
- Tests cover all three writers plus the guard: no directory is created, no file is written, a warning is raised, and the resolved path never contains `"undefined"`

The wider issue is untouched and worth a separate look: `getWorkspaceRoot()` still lies about its return type, and nine other call sites interpolate its result the same way.

### End-to-end scratch org verification

Verified against a fresh scratch org: generation, deployment, a passing check, drift detection in both directions, and restore.

- The demo scaffold (`scripts/picklist-dependency-demo/`) covered only a plain two-tier dependency with a local `valueSetDefinition`, so a real scratch org run never exercised the chained or global-value-set paths this release added. It now writes a `Planets` global value set plus a third tier: `Dressing__c` (chained, local values, and a value containing a space) and `Planet__c` (chained, **global value set**). Generation produces 3 specs for the object, and `Planet__c` correctly emits both a spec and a `dependsOn` link
- **The Drift step could never have failed.** It broke a dependency by omitting a `valueSettings` entry, but Salesforce *merges* `valueSettings` on a `CustomField` deploy — the omitted entry stayed in the org, the deploy reported `Succeeded`, and the check correctly reported PASS against an org that never changed. Drift now *rewires* a value from one controlling value to another, which is what an admin actually does in Setup and asserts more: `MISSING_VALUES` on the old controlling value and `FORBIDDEN_VALUES_PRESENT` on the new one
- Drift runs in two phases, because a broken controlling field short-circuits every spec below it into a single `UPSTREAM_FAILURE`. Phase 1 drifts only the global-value-set field, so its own expectations are actually evaluated; phase 2 drifts the controlling field as well, proving the chain reports the break once at its source
- Fixed `.Count` on a single-element pipeline result failing under `Set-StrictMode -Version Latest`, which aborted `-Step Generate` whenever exactly one per-object spec class was produced — the demo's normal case

### One-command orchestration for the end-to-end run

The verification above took a dozen separate invocations plus hand-written anonymous Apex to root-cause. It is now a single command, and a VS Code task.

- **`-Step Verify`** reads the live controlling-value map out of the org through `SDTSchemaPicklistDependencySource` — the same source the check uses — and prints it. This is the question a deploy result cannot answer, and it previously had no command at all
- **`-Step FullRun`** chains `Preflight` → `Restore`, including both drift phases, in one invocation
- **A drift guard.** `Drift` now calls `Verify` before and after its own deploy and refuses to run the check unless the org genuinely moved, exiting `1` with the reason. Without it, a no-op drift deploy produces a `PASS` indistinguishable from a healthy run — which is exactly how the omission bug above survived
- **`-Interactive`** pauses at the three points a human has to judge something an assertion cannot: the generated contract before it deploys, and each drift report after it fails. Off by default, so the same script runs unattended in CI
- **`-Step Accept`** closes the loop. Drift has two legitimate endings and only one existed: `Restore` rejects the change by putting the org back. `Accept` treats the org as correct — it retrieves the org state into local source, regenerates the contract, redeploys and re-runs. Retrieving *before* regenerating is the whole point: generation reads local metadata, and drift deliberately leaves local source at the original contract, so regenerating alone produces a byte-identical contract that fails again identically. `Accept` fingerprints the generated classes either side of regeneration and refuses to re-run if nothing changed
- `-Step FullRun` now runs the complete lifecycle — stand up, pass, drift, fail, regenerate, pass — in one invocation
- **Every run now starts from a new scratch org.** `CreateOrg` used to reuse a live org carrying the same alias, which meant a run inherited the previous run's drift, deployed classes and source-tracking history — a green result proved the feature worked *there* rather than from nothing, and the reuse is what produced this harness's source-conflict failures. It now replaces that org; `-ReuseExistingOrg` opts back in for iterating on a single step
- Deploys pass `--ignore-conflicts`. The script authors every file it deploys, so local is authoritative by construction, and `Accept` creates a source-tracking conflict by design when it retrieves. Without this, every deploy after an `Accept` was refused
- Six `PICKLIST:` tasks in `.vscode/tasks.json` wrap the script, prompting for the scratch org alias and Dev Hub

### Removed: the anonymous-Apex CI runner

`scripts/apex/runPicklistDependencyChecks.apex` and `scripts/apex/run-picklist-dependency-checks.js` (with the `npm run picklist-dependency-check` script) are deleted. Every picklist dependency check now runs one way: from generated Apex that has been **deployed** to the target environment and executed as a test class in system context. The anonymous-Apex path ran as the authenticated user, so its result could vary — misleadingly — with that user's field-level security, and nothing invoked it: no CI workflow called the runner, `.vscodeignore` already excluded it from the `.vsix`, and the end-to-end demo harness deploys the generated classes instead. The `PICKLIST_DEPENDENCY_CHECK_RESULT` marker is unaffected — `SDTPicklistDependencyReport` still emits it

### Removed: the repository is no longer a Salesforce DX project

`force-app/`, `sfdx-project.json`, `config/project-scratch-def.json` and `.forceignore` are gone. This repository is a VS Code extension; the only Salesforce metadata it carries is the Apex framework source, which now lives in a directory named for exactly that purpose:

- **`apexPicklistDependencyFramework/SDTPicklistDependencyFramework/`** — the six runtime classes shipped in the `.vsix` and scaffolded into the user's package directory by Generate Picklist Dependency Tests. `scaffoldMissingFrameworkClasses` and the `.vscodeignore` negation both point here now
- **`apexPicklistDependencyFramework/frameworkApexTests/`** — the framework's own Apex unit tests and stub source, dev-only, never shipped
- **`apexPicklistDependencyFramework/README.md`** — documents what each half is for and how to deploy the tests
- The committed `SDTPLDSpecs.cls` placeholder is deleted outright: generation always emits a fresh aggregator, so a tracked copy existed only to be overwritten

The demo harness no longer deploys from the repository. `-Step Scaffold` generates a throwaway DX project under `scripts/picklist-dependency-demo/demoSalesforceProject/` (gitignored) — `sfdx-project.json` written on the fly, framework classes copied in from their source of truth, sample metadata and generated classes landing inside it — and every `sf` project command runs from that directory. This is also the more faithful demo: the extension's real consumers run it against their own DX project, and the staging project plays that role

### New: `docs/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md`

An org-side companion to the design record, written for the admin or developer looking at `SDTPLDSpecsTest` in a Salesforce org with no VS Code in front of them: what each deployed class is, how to read a generated spec line-by-line against the **Field Dependencies** grid in Setup, where the org side of the comparison actually comes from (including Execute Anonymous diagnostics that print the org's live view, flagged as diagnostics rather than the gate), the four ways to run the tests, the full failure-kind table, how to **trigger a failure on purpose** — and why omitting a `valueSettings` entry silently will not do it — and a decision tree for choosing between fixing the org and regenerating the specs. Linked from the README, the design record, and the demo runbook.

### Design record: the `validFor` mechanism is now fully documented

`docs/PICKLIST-DEPENDENCY-TECHNICAL-DESIGN.md` §6 now captures the entire `validFor` story rather than only the decode: where the bitmap comes from (the admin's Field Dependencies matrix, compressed and served by Salesforce's describe engine), a mermaid sequence diagram of the full deserialize-and-parse walkthrough — Setup click → `fetch()` → the `JSON.serialize` loophole → base64/hex/bit decode → snapshot → validator verdict, including the fail-loud path for a missing key — a worked bitmap-examples table pinned to `SDTSchemaPicklistDependencySourceTest`, and direct links to the official Salesforce documentation per API (SOAP describe, Apex `Schema.PicklistEntry`, UI API picklist values, Metadata API `valueSettings`), stating plainly that the JSON serialization behaviour itself is documented nowhere. A new **Appendix B** gives a self-contained anonymous-Apex procedure reproducing the contract from a blank org, referenced from the §12 verification checklist

### Cleaner assert messages

Assertion failures surfaced in a Salesforce org escaped every embedded double quote as `&quot;`, which buried the field and value names the message exists to report. Every double quote is gone from the messages `SDTPicklistDependencyValidator`, `SDTSchemaPicklistDependencySource`, and the generated test class produce — `Account.Type @ "Customer"` now reads `Account.Type @ Customer`. The word "reports", which reads as Salesforce Reports to an admin, is replaced with "the org has" throughout those messages.

## [2.14.0] - Run Picklist Dependency Check Command

Resolves [#69](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/69). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New command **Salesforce Treecipe: Run Picklist Dependency Check** (`treecipe.runPicklistDependencyCheck`) that deploys and runs the generated picklist dependency tests against an org and reports the outcome in VS Code. [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61) generated specs but shipped nothing that could execute them — `.vscodeignore` excludes `scripts/apex/**`, so the `npm run picklist-dependency-check` runner its verification story assumed is repo-local tooling that never reaches an extension user
- The target org is chosen from a quick pick built from `AuthInfo.listAllAuthorizations()`, preferring the alias and falling back to the username. Both are accepted by `sf --target-org`
- Results are written to a dedicated **Picklist Dependency Check** output channel, cleared on each run so the visible output always belongs to the run that just finished, with a pass/fail summary notification carrying the failure count
- **Every run is also saved to `treecipe/PicklistDependencyResults/check-<org>-<timestamp>/`** as `results.json` (machine-readable per-method outcomes) and `report.md` (human-readable). Because the output channel is cleared on each invocation, a check would otherwise leave nothing behind — nothing to commit, nothing to diff against the previous run, and nothing to attach to a review. Passing runs are persisted too, so a green check is on record rather than only a failing one. The org identifier is sanitized for the folder name, since a username is a valid target and contains characters that read poorly in a directory listing

### Directory walks now filter to what is actually consumed

- Both walks recursed into **every** child directory of an object — `recordTypes`, `listViews`, `webLinks`, and anything else Salesforce puts there — hunting for more `fields`. Nothing downstream reads those types: only `fields` is consumed, and record types are reached by navigating from the fields directory path rather than by the walk finding them
- A directory containing `fields` is an object directory, so its other children cannot contribute anything. Both walks now stop there. Measured on the fixture tree: **43 directory reads down to 32, and 11 non-field directories visited down to 0**, with identical output. The saving scales with the number of objects in the org rather than the number of dependent picklists
- Filtering on this invariant rather than deny-listing type names means no maintenance when Salesforce adds another object child type
- It also pins the object api name to the directory that actually holds the fields. A `fields` folder found deeper in the tree would previously have been attributed to whatever directory happened to contain it

### Fixed: files without the `.field-meta.xml` suffix were parsed as fields

- The field walk accepted **any** `.xml` file in a `fields` directory. Salesforce source format names every custom field `<ApiName>.field-meta.xml`, so a hand-saved copy, an export, or a scratch file carrying `CustomField` markup was parsed as a real field — generating picklist dependency specs for fields the org has no reason to have
- Reproduced against a fixture already in this repository. `MockSalesforceMetadataDirectory/objects/Example_Everything__c/fields/gfh__c.xml` holds dependent-picklist markup without the required suffix:

  | | specs generated | `gfh` references in the registry |
  |---|---|---|
  | Before | 2 | 4 |
  | After | 1 | 0 |

- **`isXMLFileType` is unchanged and still means "is an `.xml` file".** `GlobalValueSetSingleton` and `RecordTypeService` depend on it for `.globalValueSet-meta.xml` and `.recordType-meta.xml`, so narrowing it would have broken them. A separate `isSalesforceFieldMetadataFile` carries the stricter rule, and requires an api name before the suffix so a file called exactly `.field-meta.xml` is not treated as a field
- The same strictness is applied to `DirectoryProcessor`, which had the identical defect on the recipe generation path. **This changes recipe output for anyone whose `fields` directory contains a stray `.xml`** — such a field will no longer appear in a generated recipe, which is the intended behaviour
- The `gfh__c.xml` fixture is deliberately left in place as the regression case, with a test asserting no spec is generated for it while the properly named dependent picklist beside it still is

### Generated registry renamed, and one method per scenario

- The generated registry is now **`SFTreecipePicklistDependencySpecs`** (and `SFTreecipePicklistDependencySpecsTest`). The prefix makes it obvious the class was written into the user's package directory by this extension rather than by them, and removes any chance of colliding with a `PicklistDependencySpecs` of their own
- **Each dependent picklist is now its own method**, and `all()` returns the collection of them:

  ```apex
  public static PicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c() {
      return PicklistDependencySpec.forField('Dependency_Example__c', 'Neighborhood__c')
              .controlledBy('City__c')
              .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
              .expectNone('akron');
  }

  public static List<PicklistDependencySpec> all() {
      return new List<PicklistDependencySpec>{
          specFor_Dependency_Example_c_Neighborhood_c()
      };
  }
  ```

  A single dependency can now be read on its own, referenced by name from a hand-written test, or tightened to `expectExactly` without picking through one long list expression. A comment above each method names the object, field and controlling field
- Spec method names collapse runs of underscores for the same reason the test method names do — Apex identifiers may not contain two consecutive underscores — and take a numeric suffix when two scenarios collapse onto one identifier. The `specFor_` prefix also keeps the identifier valid when an api name starts with a digit
- The api names inside each spec are still emitted as **string literals** with their exact `__c` suffixes, so Schema describe resolves the real object and field

### Generation offers to run end to end

- After writing the classes, **Generate Picklist Dependency Tests** now offers to deploy and run them against an org in the same invocation. Accepting prompts for the target org, deploys, runs, and reports — generation through to verified results without leaving the command
- Implemented as a prompt on the existing command rather than a new one. A third picklist command in the palette would have been a worse trade for the same capability
- The offer comes **after** generation, not before: generating is useful on its own — reviewing a diff, or working without an org to hand — so dismissing leaves a completed generation rather than a cancelled command
- That path **always deploys**, where the standalone check deploys only when the test class is absent. The classes were just rewritten, so the org copy is stale by definition and a conditional deploy would run yesterday's contract against today's metadata. A test asserts `isSpecsTestClassDeployedInOrg` is never consulted on this path
- Both commands now share three private helpers — generation, org selection, and deploy-run-report — so the two entry points cannot drift in their handling of confirmations, cancellation, artifacts, or reporting

### Corrected: the generated Apex is now a real test class

- `PicklistDependencyTestService` now also emits `PicklistDependencySpecsTest.cls`, an `@IsTest` class asserting the spec registry through `PicklistDependencyValidator` and `SchemaPicklistDependencySource`. Despite the command being named "Generate Picklist Dependency Tests", what [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61) emitted was a plain data registry executed by anonymous Apex
- That design came from an epic decision that **stopped being true**: verification was anonymous Apex because the original `ConnectApi`-based source could not run inside `@IsTest`. `e6c624d` replaced it with `SchemaPicklistDependencySource`, and Schema describe has neither constraint — it runs inside `@IsTest` and returns the org's real metadata rather than isolated test data, so no `SeeAllData` and no test setup are involved
- One test method per object, so a failure names the object in the test results and each method gets its own CPU and heap budget rather than sharing one transaction across the whole registry — the describe work is what binds that limit
- A `specRegistryIsNotEmpty` guard method fails when the registry is empty. This is the `EMPTY` semantics of the anonymous-Apex marker protocol expressed as an assertion; without it the class would report green while asserting nothing
- Generated method names are derived from validated object API names, with a prefix applied when a name begins with a digit so the Apex identifier stays valid

### Salesforce CLI over the API equivalents

- The check runs `sf apex run test --json` rather than `connection.tooling.executeAnonymous()`. `executeAnonymous` returns compile and success status but **not** the debug log, and the entire per-combination report is emitted through `System.debug` — recovering it would have required a debugging header or a follow-up `ApexLog` query. `sf apex run test` returns structured per-method results, so no marker protocol and no debug-log scraping exist on the extension's path at all
- The optional deploy step uses `sf project deploy start --source-dir`, which avoids a zip library plus metadata-format packaging via `connection.metadata.deploy()` and avoids adding `@salesforce/source-deploy-retrieve` as a dependency
- That deploy names the eight classes this command owns individually rather than passing the whole `classes` directory. A user's package directory holds their own Apex, and a deploy approved to get a dependency check running must not carry unrelated work-in-progress classes into the org with it
- This adds no meaningful new requirement: `CollectionsApiService.getConnectionFromAlias` already resolves orgs through `Org.create({ aliasOrUsername })`, which reads the CLI's own auth files, so a user without the CLI has no authenticated orgs to select in the first place. Precedent for shelling out already exists in `SnowfakeryRecipeProcessor`
- On Windows the CLI is named as its `sf.cmd` shim directly. Since the Node fix for CVE-2024-27980, spawn refuses `.cmd`/`.bat` without a shell, and naming the shim keeps the argv form and its immunity to shell metacharacters instead of falling back to `shell: true`

### Unhappy paths

- No authenticated orgs reports how to authorize one rather than showing an empty quick pick
- Dismissing the org quick pick exits silently and runs nothing
- A missing test class prompts before deploying; declining exits cleanly and deploys nothing
- The Salesforce CLI missing from `PATH` reports an actionable message naming the CLI rather than a raw spawn error, and is never conflated with dependency drift
- A deploy that fails on compilation surfaces the component failure message rather than a raw stack trace
- An org with source tracking that reports conflicts gets actionable guidance naming the org and the `--ignore-conflicts` escape hatch, rather than the CLI's bare "N conflicts detected". Conflicts are deliberately not forced past automatically — the org copy may hold edits worth keeping, and this command reports drift rather than overwriting it

### Review fixes

Applied after a three-reviewer pass (architecture, performance, security) on PR [#70](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/70):

- **The CLI is invoked asynchronously.** Every call was `spawnSync`, which blocks the VS Code extension host — a single shared, single-threaded process — for the whole run, freezing every installed extension with no progress and no way out. All three calls now use `execFile` inside `vscode.window.withProgress({ cancellable: true })`, with the cancellation token wired to `child.kill()`
- **`--wait` is in MINUTES, not seconds.** The test run was sent `--wait 20`, written believing it meant seconds; it meant twenty minutes. Now bounded to 10, and the deploy passes an explicit `--wait` rather than inheriting the CLI's 33-minute default
- **The Windows handling was backwards.** Naming the `sf.cmd` shim directly was documented as preserving the argv form; since the Node fix for CVE-2024-27980, spawning a `.cmd` with arguments and *without* a shell fails with `EINVAL`, so it broke every invocation on win32 instead. Windows now enables the shell with every argument quoted, and a value containing a double quote is rejected rather than escaped. Other platforms keep the argv form unchanged
- **Test result keys are read case-insensitively.** Only `Outcome` was read, so an unexpected casing would have rendered every method failed — a false report of dependency drift, the one thing this command must never produce
- **`stderr` and the exit code are carried into parse failures.** An auth failure produced "Unexpected end of JSON input" with the real cause discarded
- **The org identifier is charset-validated** before reaching the CLI, rejecting anything that could be read as a flag rather than a value. Defence in depth given the argv form, and load-bearing on the Windows shell path
- **The classes directory is re-checked for workspace containment.** Containment was enforced on the package directory, then `main/default/classes` was appended unchecked — and `writeFileSync` follows symlinks
- **The deploy confirmation lists every file** it will send. Framework classes are scaffolded only when absent, so a workspace carrying its own copy deploys that copy; the user has to see which files those are
- **The output channel is disposed** via `context.subscriptions`, and typed `OrgAuthorization` replaces the `any[]` on the authorization boundary
- **The same Windows defect is fixed in `scripts/apex/run-picklist-dependency-checks.js`**, where it originated in [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60) and from which it was copied — comment included. That runner now enables the shell on Windows with quoted arguments, validates the `--target-org` value (which can arrive from argv or `SF_TARGET_ORG`, and on the shell path would otherwise be interpreted by `cmd.exe`), and reports `EINVAL` distinctly from `ENOENT`

### Fixed: generated test class would not deploy for any custom object

- **Apex identifiers may not contain two consecutive underscores**, and every custom object api name ends in `__c`. The generated method name embedded the api name verbatim, so `Example_Everything__c` produced `Example_Everything__c_picklistDependenciesMatchSourceMetadata` and the class failed to deploy with `Invalid character in identifier`. Runs of underscores are now collapsed: `Example_Everything_c_picklistDependenciesMatchSourceMetadata`
- Collapsing rather than stripping the suffix keeps `Thing__c` and `Thing__e` distinguishable as `Thing_c` and `Thing_e`
- The api name is still passed to the assertion as a **string literal**, keeping its exact `__c` suffix, so Schema describe resolves the real object — only the method identifier changed
- Collapsing can map two distinct api names onto one identifier (`Foo__c` and `Foo_c` both yield `Foo_c`), and two Apex methods with the same name will not compile, so later collisions now get a numeric suffix
- A whole-class guard test asserts no emitted identifier contains `__`, so any future change reintroducing this fails regardless of which helper produced the name

  This survived the earlier live-org deploy check because that check used `Account` and `Contact` — **standard** objects, which have no `__c` and were therefore unaffected. Verifying against standard objects alone was not enough to exercise the path every real registry takes.

### Framework classes moved into their own directory

- The six runtime framework classes now live in `force-app/main/default/classes/PicklistDependencyFramework/`, and are scaffolded into the matching `PicklistDependencyFramework` subfolder of the user's package directory. Salesforce resolves `ApexClass` by the enclosing `classes` directory and walks nested folders, so the layout deploys identically — verified locally with `sf project convert source`, which resolved a nested class to `ApexClass` in `package.xml`
- The split is for humans, not the platform: six files the user did not write stay separate from `PicklistDependencySpecs.cls` and `PicklistDependencySpecsTest.cls`, which are the contract they read and sometimes hand-tighten. The framework becomes removable in one action
- **`.vscodeignore` drops from twelve per-file negations to one directory negation.** The per-file list was a standing hazard: adding a framework class without adding two more lines would have silently shipped a `.vsix` whose generated code could not compile. Anything outside that directory is now excluded by construction rather than by omission — confirmed the package still carries exactly 12 files, the 6 classes and their metadata
- A workspace generated by an earlier version keeps working. The scaffolder skips a class present in **either** location, and the deploy resolves each class from one path only — Salesforce rejects the same `ApexClass` twice in a single deployment

### Verified against a live org

Confirmed in a scratch org rather than assumed from the docs:

- The generated `PicklistDependencySpecs.cls` and `PicklistDependencySpecsTest.cls` **compile** — deployed 8 of 8 components with no component failures, including a picklist value carrying an apostrophe, which exercises the Apex string-literal escaping
- `sf apex run test --json` returns `result.tests[]` with `MethodName`, `Outcome`, and `Message`, and `Message` is `null` rather than absent on passing methods
- A failing run exits **100**, confirming that a non-zero CLI exit must not be treated as an error — the payload still carries the per-method outcomes
- The multi-line assertion message survives the round trip, so the object name and the specific failing combination reach the output channel intact
- The CLI's `@salesforce/sfdx-scanner` plugin warning is written to **stderr**, leaving `stdout` as clean JSON — the service reads `stdout` specifically, so the warning cannot corrupt parsing
- A failing Apex test makes the CLI exit non-zero, which is deliberately **not** treated as an error — the result payload still carries the per-method outcomes the user needs to see

### Notes

- This repository's own `npm run picklist-dependency-check`, its anonymous-Apex entry point, and the `PICKLIST_DEPENDENCY_CHECK_RESULT` marker are unchanged and stay as local tooling
- No faker service change; neither `IRecipeFakerService` nor `IFakerRecipeProcessor` is touched, so no dual-backend parity work was required

## [2.13.0] - Generate Picklist Dependency Tests Command

Resolves [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New command **Salesforce Treecipe: Generate Picklist Dependency Tests** (`treecipe.generatePicklistDependencyTests`) that emits `PicklistDependencySpecs.cls` from local source metadata, replacing the hand-written registry that [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60) shipped. The parsing this needs already existed to drive dependent-picklist recipe generation; this is a second consumer of it, emitting Apex instead of YAML
- New `PicklistDependencyTestService` walks the configured `salesforceObjectsPath` and emits one spec per picklist field declaring a `controllingField`, each carrying `.controlledBy(controllingFieldApiName)` so the framework's `CONTROLLING_FIELD_MISMATCH` check is active
- Every controlling value is emitted as `expectAtLeast`, so source combinations must still exist while org-added values are tolerated. Tightening a line to `expectExactly` stays a deliberate edit by the spec owner — and is lost on regeneration, which the generated file header states plainly
- A controlling value that unlocks nothing is emitted as `expectNone`. These are only discoverable by diffing the dependent field's `valueSettings` against the **controlling field's own** picklist values, read from its sibling field file — the dependent field's markup alone cannot distinguish "unlocks nothing" from "does not exist". When the controlling field is not among the parsed fields, no `expectNone` lines are emitted rather than guessing
- The framework runtime classes are now shipped in the `.vsix` and scaffolded into the resolved package directory when missing. `.vscodeignore` excluded `force-app/**`, so a generated specs file would have had nothing to compile against in a user's workspace. Negation entries ship exactly the six runtime classes and their metadata, keeping `force-app` the single source of truth so the shipped copies cannot drift; the test classes, the stub source, and the placeholder `PicklistDependencySpecs.cls` are deliberately still excluded. An existing class in the workspace is never overwritten, so a customized copy is preserved
- Picklist values are escaped for Apex string literals (backslash, single quote, and newline, in that order); API names are emitted verbatim. Ampersands need no Apex escaping and are left alone. Note this is separate from the faker services' backtick-wrapping, which is a JS template-literal technique and not reusable here
- Output written to the `classes` folder of the package directory marked `default` in `sfdx-project.json`, falling back to the first entry when none is marked. `sourceApiVersion` drives the generated `-meta.xml`

### Unhappy paths

- A field with a `controllingField` but no `valueSettings` is reported as a warning naming the object and field, and skipped — the run continues and still generates every other spec
- No `sfdx-project.json`, no `packageDirectories` entries, or a resolved package directory with no `path` each raise an actionable error and write nothing
- An existing `PicklistDependencySpecs.cls` prompts before overwrite, warning that hand-tightened lines will be lost
- Zero dependent picklists in the metadata directory reports an informational message and writes no file, rather than emitting a class whose empty registry the framework would report as `EMPTY`

### Refactor

- The `controllingValueToPicklistOptions` build moved out of `RecipeService.getDependentPicklistRecipeFakerValue` into `RecipeService.buildControllingValueToPicklistOptions`, a static shared by recipe generation and spec generation. It reads only `picklistValues`, so it needs no record type parameter. Behavior is unchanged and both faker backends' existing dependent-picklist tests pass untouched as the regression guard

### Hardening

- Object, field, and controlling-field api names are validated against `^[A-Za-z0-9_]+$` and the spec is skipped with a warning when one fails. A field api name is a raw XML `<fullName>` text node and an object api name is a directory name on disk, so neither is trustworthy by construction — the api-name constraint is enforced by Salesforce, and this generator never talks to Salesforce. Api names are additionally escaped at emission, which is a no-op for every name that passes validation, so emission stays safe without depending on the caller having validated first
- The resolved package directory is confirmed to stay inside the workspace before anything is written. `path.join` normalizes a traversing path rather than rejecting it, so a `packageDirectories[].path` of `../../..` in a workspace `sfdx-project.json` would otherwise have created directories and written files outside the folder the user opened. Absolute paths are rejected outright
- A framework class that could not be supplied is now reported instead of silently skipped. The generated specs class does not compile without the framework, so the previous behavior handed the user a broken file with no indication of why. Both the class and its `-meta.xml` are checked before either is copied, so a missing meta file cannot leave an orphaned `.cls` behind
- `sourceApiVersion` is validated against `^\d+\.\d+$` before being interpolated into generated XML, falling back to the default otherwise
- Malformed `sfdx-project.json` raises an actionable parse error naming the file, rather than surfacing a raw `SyntaxError` behind a "report issue to GitHub" button for what is the user's own typo
- A missing objects directory reports an actionable message pointing at `salesforceObjectsPath`, the most likely misconfiguration
- The overwrite prompt now covers the generated `-meta.xml` as well as the `.cls`, so a hand-tuned `apiVersion` or `status` cannot be replaced without confirmation. The success message names the destination directory
- Skipped-field warnings are capped at three individual notifications followed by an aggregate count, so a managed package declaring dependent picklists without `valueSettings` cannot bury the user in toasts
- The directory walk tests `entryType` as a bitmask so a symlinked object directory is still walked, and accumulates results with `concat` rather than spread-into-push, which throws once an accumulated subtree exceeds the engine's argument limit

### CI and supply chain hardening

- `build.yaml` installs with `npm ci --ignore-scripts` instead of bare `npm install`. `npm ci` installs exactly what `package-lock.json` records, so a hijacked patch release inside an existing `^` version range cannot be pulled into CI — which is the axios-incident path and the reason the floating pins in `package.json` were a live risk rather than a theoretical one. `--ignore-scripts` additionally stops dependency install hooks from executing on the runner; verified that no dependency in this project builds a native addon, so nothing needs them
- `build.yaml` now runs `npm run compile` and `npm run lint`. The job was named `Compile-and-Test` but never compiled: `ts-jest` typechecks only files reachable from a test, and nothing imports `src/extension.ts`, so a type error in the extension entry point passed PR CI and first surfaced during release
- `release.yaml` pins `@vscode/vsce@3.9.2` rather than installing it unpinned. That install runs in the job holding `VSCE_PAT`, so a hijacked release of the publish tool itself would execute with the token in scope. The pinned version was verified to package this extension identically (103 files, 610.32 KB) before pinning
- `release.yaml` also uses `--ignore-scripts` and moves to `actions/setup-node@v4`, matching `build.yaml`
- Both workflows declare least-privilege `permissions: contents: read`; neither writes to the repository
- Dependencies were deliberately **not** re-pinned to exact versions. With `package-lock.json` committed and `npm ci` in use, the lockfile already determines exact resolution transitively, so exact pins in `package.json` would be redundant defense that makes routine dependency updates noisier. The meaningful fix was replacing `npm install` with `npm ci`

### Tests

- `ExtensionCommandService` gains its first `tests/` folder, covering the new command handler end to end: the write path, zero-dependent-picklist and missing-objects-directory paths, both branches of the overwrite prompt, unavailable and scaffolded framework classes, the skipped-field notification cap, and error routing through `ErrorHandlingService`. `initiateTreecipeConfigurationSetup` and `changeFakerImplementationService` are covered too. Note this *lowers* the reported total percentage while increasing tested code — the file was previously absent from the coverage report entirely, because no test imported it

### Delta review fixes

A second review pass over the fix commit itself found three defects introduced *by* the fixes, plus a gap in the workflow changes:

- The symlink bitmask made symlinked directories walkable without any cycle protection. The previous strict `entryType !== Directory` check had prevented recursion loops only as a side effect of skipping symlinks entirely; removing it meant a link pointing back up the tree (`objects/Thing__c/loop` → `objects`) would recurse until the stack was exhausted. The walk now carries a visited set keyed on the realpath-resolved directory
- Workspace containment rejected a package directory of `"."`, which is a legal `sfdx-project.json` value for a project keeping metadata at the repo root. It resolves to the workspace root itself, and the `startsWith(root + sep)` check treated the root as outside the root. Containment now accepts an exact root match, and additionally compares realpath-resolved paths so a symlink inside the workspace cannot point outside it
- The api name validation used `Array.find`, whose "not found" sentinel is `undefined` — the same value an invalid entry could itself hold, so the guard would not fire for an `undefined` api name. Switched to `findIndex`, which has no such collision
- `release.yaml` installed the pinned `@vscode/vsce` **with lifecycle scripts enabled**, in the job holding `VSCE_PAT`, immediately after `--ignore-scripts` had been added to the dependency install. Pinning the top-level package does not pin its 30 direct dependencies, which are all caret ranges resolved fresh at install time and include native modules that legitimately run install hooks. The global install now uses `--ignore-scripts` too
- The publish token moved from a command-line argument to the step environment. An argv-borne secret is readable by any concurrent process on the runner and is not covered by GitHub's log masking; `vsce` reads `VSCE_PAT` natively, so the `-p` flag was unnecessary. This also removes the token from PowerShell double-quote expansion
- The release job now checks out `main` explicitly with `persist-credentials: false`. On a closed `pull_request` the default ref is `refs/pull/N/merge`, the pre-merge test-merge commit, so a moving `main` could have published source that never existed on `main`
- The command-service test asserted on `stringContaining('PicklistDependencySpecs')`, which matches the class declaration that is emitted unconditionally — it would have passed even if every spec were dropped. It now asserts on real emitted spec content. The suite also clears the whole `vscode` mock factory rather than the two functions it happens to assert on

### Verification

- The generated Apex was validated against a live org via a check-only deploy alongside the framework classes, so the emitted builder calls and the escaping of values containing quotes, backslashes, and ampersands are confirmed to compile rather than merely inferred. A test also asserts every emitted builder method exists on the shipped `PicklistDependencySpec`, so a future change to that fluent API cannot silently break the generator
- Adversarial tests cover the untrusted-input paths directly: an api name carrying `'); System.abortJob('`, an object directory name containing a quote, a controlling field name with an embedded newline, a traversing and an absolute `packageDirectories[].path`, malformed project JSON, and a `sourceApiVersion` carrying XML markup

## [2.12.0] - Apex Picklist Dependency Validation Framework

Resolves [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62).

### Features

- New deployable Apex framework under `force-app/main/default/classes/` that asserts expected picklist dependency combinations against a live org, so a dependency an admin later rewires is caught in CI instead of surfacing as a confusing Collections API error at data-load time
- `PicklistDependencySpec` — fluent builder (`forField` / `controlledBy` / `expectExactly` / `expectAtLeast` / `expectNone`); match mode is per controlling-value line so a single expectation can be tightened to `expectExactly` without affecting the rest
- `PicklistDependencySnapshot` — ConnectApi-free snapshot; `valuesValidFor(controllingValue)` decodes `validFor` bit indexes against `controllerValues`, returning an empty set for a controlling value that unlocks nothing and `null` for one the org does not have
- `PicklistDependencyValidator` — returns a `Failure` list and never throws on a mismatch; failure kinds cover `MISSING_VALUES`, `UNEXPECTED_VALUES`, `UNKNOWN_CONTROLLING_VALUE`, `CONTROLLING_FIELD_MISMATCH`, and `LOOKUP_ERROR`. A source exception is recorded as `LOOKUP_ERROR` for that spec and the remaining specs still validate. `UNKNOWN_CONTROLLING_VALUE` failures list the controlling values the org actually reports
- `IPicklistDependencySource` — returns a plain `PicklistDependencySnapshot` rather than an org-API type, keeping the validator and its tests independent of how the data was obtained so a source can be stubbed
- `SchemaPicklistDependencySource` — reads live data through Schema describe, with no callout. `Schema.PicklistEntry` exposes no `getValidFor()` in Apex, but `JSON.serialize(entry)` emits a base64 `validFor` bitmap whose set bits are controlling-value indexes; index order is the controlling field's own `getPicklistValues()` order, verified to match the UI API's `controllerValues`. A non-dependent picklist is rejected up front by the `getController()` guard; past that guard an absent `validFor` means the undocumented serialization contract has changed, and is raised as an error rather than silently decoding to "valid for nothing". Checkbox controlling fields use `false` / `true` **in that order** — verified in a live org, where a value requiring the checkbox checked serializes as `QAAA` (bit 1) and one requiring it unchecked as `gAAA` (bit 0), matching the UI API's `controllerValues` of `{"false": 0, "true": 1}`. Note the metadata API spells these `checked` / `unchecked` in `valueSettings`, but a spec must use `true` / `false`
- `PicklistDependencyReport` — formats a run into a human-readable report plus a `PICKLIST_DEPENDENCY_CHECK_RESULT=PASS|FAIL|EMPTY` marker. An empty spec registry reports `EMPTY` rather than `PASS`, so a CI gate cannot go green having verified nothing
- `PicklistDependencySpecs` — hand-written spec registry today; the target of the upcoming "Generate Picklist Dependency Tests" command ([#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61))

### Performance

- `SchemaPicklistDependencySource` caches describe lookups for the life of the transaction — `Schema.getGlobalDescribe()`, the per-object field map, and the resolved `DescribeFieldResult`. The validator runs every spec in a single transaction against a shared 10,000 ms CPU limit, and these were previously recomputed per spec for an identical answer. Measured in a scratch org, timing describe resolution alone in isolated transactions: **63 distinct fields on one object — ~827 ms uncached vs ~25 ms cached**; the same field 100 times — ~1130 ms vs ~70 ms. The distinct-field case is the realistic one (a registry holds one spec per dependent field) and gains *more*, because `getGlobalDescribe()` is the dominant term and is now paid once rather than per spec. Roughly a tenth of the entire transaction budget returned. This matters ahead of [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61), whose generator will emit specs in bulk
- Describes are keyed on the `Schema.SObjectField` token rather than an `Object.Field` string. A controlling field is reached via `getController()`, which yields a token and no name — naming it would require the very `getDescribe()` the cache exists to avoid. Token keying covers the dependent *and* controlling paths with one map (the controlling describe previously bypassed the cache entirely and was paid per spec) and dedupes for free when one spec's controlling field is another spec's dependent field
- Object cache keys are lower-cased: Apex `Map<String, …>` compares case-sensitively while describe resolves case-insensitively, so specs written `account` and `Account` would otherwise each hold a duplicate field map
- Heap cost is **~43 KB per object** with its field describes retained. This scales with the number of *distinct objects* in the spec list, not with spec count — a registry spanning dozens of objects trades CPU for monotonically growing heap against the 6 MB limit
- Batching the `validFor` JSON round-trip per field instead of per picklist entry was implemented, measured, and **rejected**: one 32-entry serialization costs the same as 32 single-entry ones (~500 ms per 100 specs either way, with run-to-run noise exceeding the difference), because JSON cost tracks bytes rather than call count. It bought only a positional-alignment failure mode. The rationale is recorded on `validForOf` so it is not re-attempted. Note that comparing approaches *within* one transaction is invalid here — each successive block measured ~2x slower than the last regardless of what it did, so approaches must be timed in separate transactions

### Tooling

- Added `sfdx-project.json` (sourceApiVersion `64.0`) at the repo root, making this a Salesforce DX project alongside the extension source
- `scripts/apex/runPicklistDependencyChecks.apex` — anonymous Apex entry point; reports against the org's real metadata without deploying a test class
- `scripts/apex/run-picklist-dependency-checks.js` — Node CI runner; exits `0` on pass, `1` on expectation failure, `2` when the check cannot run (CLI missing, compile failure, unparseable output, an unreachable org, or an empty spec registry). Accepts `--target-org <alias>` and `--target-org=<alias>`; spawns `sf.cmd` on Windows, where the Node fix for CVE-2024-27980 blocks `spawn` from running `.cmd` shims; surfaces the CLI's own error name and message rather than reporting "no result payload"
- New npm scripts: `npm run picklist-dependency-check` (live org check) and `npm run apex-test` (runs `PicklistDependencyValidatorTest` and `SchemaPicklistDependencySourceTest`)
- `.vscodeignore` excludes `force-app/**`, `scripts/apex/**`, and `sfdx-project.json` from the published `.vsix`
- `.vscodeignore` also excludes the Salesforce CLI's local tooling and per-org state, which this repo only began producing once it became a DX project ([#67](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/67)). `.sfdx/**` alone carried 2,386 files including a 7.2 MB `apex.db` and the whole `StandardApexLibrary`; `.sf/**` carried per-org source-tracking state under `.sf/orgs/<ORG_ID>/`, naming the packaging developer's org and its metadata. Also excludes `coverage/**` — being in `.gitignore` does **not** exclude it, because `vsce` packages the working directory rather than the git index — plus `.claude/**` and `.github/**` as repo automation with no runtime role. Package drops from **5,515 files / 15 MB to 2,948 files / 11.55 MB**, with `out/`, `images/`, and production `node_modules/` intact. Never shipped: there is no `v2.12.0` tag or release

### Tests

- `PicklistDependencyValidatorTest` covers both match modes, `expectNone`, `validFor` decode (empty set vs `null`), unknown controlling value, controlling-field mismatch, source exceptions (isolated per spec), and report summarisation — driven by a `StubPicklistDependencySource` so no live org is required
- `SchemaPicklistDependencySourceTest` covers the base64 bitmap decode (single bit, multiple bits, bits past the first byte, padding beyond the controlling-value count, short bitmaps, `null` / blank) and the source's error paths: unknown object, missing-or-invisible field, and a field that is not dependent
- Describe caching is covered by asserting the repeat paths, since a cache that went stale would corrupt every spec after the first: a non-dependent field is rejected identically on a second fetch, and a warmed object cache still rejects both an unknown field on that object and an unknown object
- `cachedDescribesDoNotBleedBetweenFieldsOnTheSameObject` pins cache *identity* — that a cached describe is the field that was asked for, asserted via `getName()` across two passes. Verified by mutation: collapsing the describe key onto a single shared entry makes this test fail (`Expected: Type, Actual: Industry`) while the weaker repeat-path assertions still pass
- `objectCacheKeyIsCaseInsensitive` and `clearCachesForcesAColdResolveWithoutChangingResults` cover the lower-cased object key and the `@TestVisible clearCaches()` hook, the latter existing so a future FLS-variant test can switch running user with `System.runAs` without silently asserting against the previous user's cached describe
- Verified end to end against a scratch org with a real dependent picklist: 33/33 Apex tests pass, a matching spec exits `0`, an empty registry exits `2`, and a dependency value deleted from the org is reported as `MISSING_VALUES` with exit `1`
- Coverage caveat: `SchemaPicklistDependencySource` sits at 78%, and the uncovered block begins at the `describeOf(controllerToken)` call that routes the controlling-field describe through the cache. Every `fetch()` test uses `Account.Industry`, which is not a dependent picklist, so `fetch()` throws at the `getController()` guard and never reaches the snapshot-building path. No dependent-picklist field metadata exists under `force-app/`, so the end-to-end verification above is not reproducible without hand-configuring an org. Tracked in [#66](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/66)

### Notes

- No TypeScript service change: this slice consumes no `IRecipeFakerService` / `IFakerRecipeProcessor` surface, so both faker backends are unaffected. `jest.config.js` already ignores `force-app/`, so the Jest suite and coverage are unchanged
- Specs are not record-type scoped. Schema describe exposes no record-type-aware picklist values, so rather than ship a `.forRecordType()` builder that always fails, none is provided. Record-type scoping would require the UI API as a REST callout (Remote Site or Named Credential setup, and unusable inside `@IsTest`); it can be added later as a second `IPicklistDependencySource` behind the same interface
- The Apex framework is not covered by CI. GitHub Actions runs the Jest suite only, and the Apex tests plus `npm run picklist-dependency-check` need an authorized org; both are run manually against a scratch org

---

## [2.11.1] - Fix `.undefined/` directory quick pick items (deprecated fs.Dirent.path)

Resolves [#51](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/51).

### Bug Fixes

- Directory quick pick items in **Initiate Configuration File** (and the **Insert Data Set by Directory** dataset picker) rendered every folder as `.undefined/` instead of its relative path
- Root cause: `VSCodeWorkspaceService.buildDirectoryVSCodeQuickPickItemByDirectoryEntry` derived the path from `fs.Dirent.path`, which is deprecated ([DEP0178](https://nodejs.org/api/deprecations.html)) in favor of `dirent.parentPath` and returns `undefined` in the Node runtime bundled with recent VS Code/Electron builds — no code change caused this; a runtime update surfaced it
- The builder now takes the parent directory path from its caller (`getDirectoryQuickPickItemsByStartingDirectoryPath` / `getDataSetDirectoryQuickPickItemsByStartingDirectoryPath`) instead of reading the deprecated `Dirent.path`, making label generation runtime-independent
- `getAvailableRecipeFileQuickPickItemsByDirectory` (the **Run Faker by Recipe** file picker) had the same deprecated `entry.path` dependency, where `path.join(undefined, ...)` would throw and break recipe file selection entirely; it now uses the in-scope `folderPathToParse`
- Added regression tests: `buildDirectoryVSCodeQuickPickItemByDirectoryEntry` produces a defined label when `Dirent.path` is `undefined`, the recursive directory traversal builds a correct relative-path label without relying on `Dirent.path`, and the recipe file picker builds a correct `detail` path when `Dirent.path` is `undefined`

---

## [2.11.0] - friends Block Processing in FakerJS Recipe Processor

Resolves [#45](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/45).

### Features

- `FakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem` now detects a `friends:` array on YAML object entries and recursively processes each child entry for every iteration of the parent's `count`
- When `count > 1` and a `friends:` block is present, each parent iteration receives a unique per-iteration nickname (e.g. `Account_1`, `Account_2`) so child lookup references resolve to distinct parents instead of all pointing to the same record
- Lookup field values in `friends:` entries that reference the parent's YAML nickname are automatically rewritten to the parent's effective per-iteration nickname via `replaceParentNicknameReferencesInFriendFields`
- The `_originalYamlNickname` internal field propagates the declared YAML nickname through recursive calls so grandchild lookup fields (referencing an intermediate parent's YAML nickname) are correctly rewritten when the intermediate parent is assigned a generated nickname
- Nested `friends:` blocks (grandchild objects) are processed recursively — each level inherits its parent's generated nickname as ancestry context
- Recipes with no `friends:` block are unaffected; output is identical to prior behavior
- `CollectionsApiService.updateLookupReferencesInCollectionApiJson` now sorts nickname entries by length descending before string replacement, preventing shorter nicknames (e.g. `account`) from corrupting longer ones (e.g. `child_account`) via substring collision
- New `FakerJSRecipeProcessor.buildRecipeDataStructureSummary` static method summarises expected record counts and hierarchy from a parsed recipe YAML
- `ExtensionCommandService.runFakerGenerationByRecipeFile` now displays a VS Code modal confirmation dialog showing the data structure summary before generating fake data, allowing the user to review and confirm before any records are created

---

## [2.10.0] - Custom Relationship Mappings for Lookup Field Hierarchy Resolution

Resolves [#47](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/47).

### 🎯 Major Features

#### 1. **`customRelationshipMappings` Config Property**

`treecipe.config.json` now supports an optional `customRelationshipMappings` property — a flat map keyed by `"ObjectApiName.FieldApiName"` whose value is the parent object API name. This lets developers manually resolve custom lookup fields whose XML metadata is missing the `<referenceTo>` tag, so those objects get grouped into the correct relationship tree and Treecipe files are generated with the right insertion order.

**Example:**

```json
{
    "salesforceObjectsPath": "force-app/main/default/objects",
    "dataFakerService": "snowfakery",
    "customRelationshipMappings": {
        "CustomObject__c.Primary_Contact__c": "Contact",
        "Project__c.Owner_Account__c": "Account"
    }
}
```

#### 2. **OOTB Map is Always Preserved**

Custom entries **extend**, never override, the built-in OOTB map (`AccountId → Account`). Lookup resolution checks the full `ObjectApiName.FieldApiName` key in the custom map first, then falls back to OOTB by `FieldApiName`. If a custom entry collides with an OOTB key, OOTB wins.

#### 3. **Graceful Handling of Invalid Keys**

Malformed custom keys (missing dot separator, empty object/field segment, multiple dots) are silently skipped — no crash, behavior matches the pre-existing "no relationship resolved" outcome.

### 🔧 Technical Details

- New `ConfigurationService.getCustomRelationshipMappings()` static getter — returns `{}` when the property is absent or null
- New `TreecipeConfigDetail.customRelationshipMappings?: Record<string, string>` interface field
- New `RelationshipService.getMergedReferenceLookupMap(customRelationshipMappings)` — returns OOTB map merged with valid custom entries
- New `RelationshipService.resolveParentReferenceForField(objectApiName, fieldApiName, customRelationshipMappings)` — resolves a parent for a Lookup/MasterDetail/Hierarchy field, custom-first, OOTB fallback
- `DirectoryProcessor` lazy-loads custom mappings once per processor instance and consults them at lookup-resolution time when XML `<referenceTo>` is absent
- Unit tests added for `ConfigurationService.getCustomRelationshipMappings` (present, absent, null)
- Unit tests added for `RelationshipService.getMergedReferenceLookupMap` and `resolveParentReferenceForField` (OOTB-only, custom extends OOTB, OOTB never overridden, invalid keys skipped, fallback chain)

### 🧭 Out of Scope (Tracked Separately)

- Recipe YAML field-level content generation for custom lookup fields (`friends` block / dynamic relationship references)
- Distinguishing `Lookup` vs `MasterDetail` field types in custom mappings
- Overriding OOTB entries with custom mappings
- VS Code UI for editing custom mappings

---

## [2.9.0][PR#37](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/37) - Mermaid ERD Dedicated File & MermaidService Extraction

### 🎯 Major Features

#### 1. **Dedicated Mermaid ERD Markdown File**

The Mermaid entity relationship diagram has been moved out of the SOQL/SOSL template file and into its own dedicated companion file (`mermaid-erd--{tree-name}-{timestamp}.md`). This separates concerns: the SOQL/SOSL template file focuses purely on query templates, while the ERD file stands alone for diagram rendering and documentation.

**File naming:** `mermaid-erd--{treecipeTopToBottomLevelName}-{timestamp}.md` — written into the same subfolder as the recipe YAML and SOQL template.

#### 2. **Titled Mermaid ERD File**

The dedicated ERD file includes a descriptive header and explanatory prose before the diagram:

- `# Entity Relationship Diagram` title
- Description of what the diagram shows (typed fields, relationship cardinalities)
- Explanation of `|o--o{` (Lookup, optional parent) vs `||--o{` (MasterDetail, required parent) notation
- Generated timestamp and object list
- Cross-tree exclusion note

#### 3. **MermaidService Extraction**

Mermaid ERD generation logic has been extracted from `SOQLTemplateService` into a dedicated `MermaidService` (`src/treecipe/src/MermaidService/`), following the existing service-per-folder pattern. `SOQLTemplateService` delegates ERD generation to `MermaidService`.

### 🔧 Technical Details

- New `MermaidService` class with `buildMermaidERD()`, `generateMermaidMarkdown()`, and `generateMermaidMarkdownForTree()` methods
- `DirectoryProcessor` writes both `soql-sosl-templates--*.md` and `mermaid-erd--*.md` per recipe tree
- SOQL/SOSL template file no longer contains the `## Entity Relationship Diagram` section
- Unit tests added for `MermaidService`; `SOQLTemplateService` tests updated to reflect ERD removal

---

## [2.8.0][PR#36](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/36) - Feature: SOQL & SOSL Query Template Builder

### 🎯 Major Features

#### 1. **Per-Tree SOQL & SOSL Query Template File**

Each generated Treecipe recipe folder now includes a companion Markdown file (`soql-sosl-templates--{tree-name}-{timestamp}.md`) alongside the recipe YAML. The file is scoped to the objects in that specific relationship hierarchy — one template file per relationship tree, not one combined file for all objects.

**File location:** written into the same subfolder as the recipe YAML (e.g., `Account-thru-OrderItem/`).

#### 2. **Mermaid Entity Relationship Diagram**

The template file opens with a `mermaid erDiagram` block showing all entities and relationships for that tree:

- Object fields rendered as typed attributes (`string`, `number`, `date`, `datetime`, `boolean`)
- Lookup fields rendered as `|o--o{` relationship lines (optional parent)
- MasterDetail fields rendered as `||--o{` relationship lines (required parent)
- Cross-tree relationships intentionally excluded — the diagram reflects only the objects in the current recipe

#### 3. **Per-Object SOQL Query Sections**

For each object in the tree, the template includes:

- **Base Query** — `SELECT Id, <all fields> FROM Object__c`
- **Child-to-Parent Queries** — one per Lookup/MasterDetail field, using relationship dot-notation (`Account.Name`) with up to five parent fields traversed
- **Parent-to-Child Queries** — subquery per child object in the same tree (`SELECT Id, ... FROM ChildRelationship__r`)
- **Record Type Filtered Queries** — one `WHERE RecordType.DeveloperName = 'X'` variant per detected record type
- **SOSL Template** — `FIND {searchTerm} IN ALL FIELDS RETURNING Object(text-fields)` scoped to text-type fields only

### 🔧 Technical Details

- New `SOQLTemplateService` follows the existing service-per-folder pattern (`src/treecipe/src/SOQLTemplateService/`)
- `generateSOQLTemplateMarkdownForTree(objectInfoWrapper, treeObjectNames, timestamp)` filters the full wrapper to only the tree's objects, guaranteeing cross-tree isolation in both queries and the ERD
- `buildParentToChildSubqueries` skips children not present in the current filtered wrapper, preventing cross-tree relationship bleed
- Integration point: `DirectoryProcessor.createRecipeFilesInSubdirectory()` calls the service inside the per-recipe-file loop, immediately after writing the YAML, using the same `treecipeTopToBottomLevelName` in the filename
- 38 unit tests added in `SOQLTemplateService/tests/`

---

## [2.7.0] [PR#35](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/35) - Feature: Enhanced Text & Numeric Field Precision Handling

### 🎯 Major Features

#### 1. **Text and Numeric Value Constraints**
Added new methods for building text and numeric recipe values with constraints, enhancing control over generated data ranges and formats.

### 🔧 Technical Details

**Code Example - Currency Field XML to FakerJS YAML**:

Given a custom object field XML markup with precision and scale:

```xml
<fields>
  <fullName>Price__c</fullName>
  <description>Product price</description>
  <externalId>false</externalId>
  <label>Price</label>
  <precision>8</precision>
  <required>false</required>
  <scale>2</scale>
  <type>Currency</type>
  <unique>false</unique>
</fields>
```

The generated recipe automatically creates a faker expression that respects the precision (8) and scale (2):

```yaml
- object: My_Custom_Object__c
  fields:
    Price__c: ${{ faker.finance.amount({ min: 0, max: 999999, dec: 2 }) }}
```

This ensures the generated currency values:
- Have at most 8 total digits (precision)
- Have exactly 2 decimal places (scale)
- Are within the valid range (0 to 99,999.99)
- Match Salesforce field constraints

## [2.6.0] [PR#34](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/34) - Feature: Relationship Service & Bug Fix for Special Characters in Picklists

### 🎯 Major Features

#### 1. **Comprehensive Relationship Service **

Generating recipes command, now creates relationship "Treecipe" files. 

Each Treecipe file is a set of related objects that are attached based on their xml markup.

Based on your source code and the relationships definied with in each field's xml, there could be one or many Treecipe files created. 

This Treecipe will also be created so that each object is inerted based on the hiearchy of objects in the Treecipe file.

#### 2. **Bug Fix: Special Characters in Picklist Values**
Fixed critical bug where picklist values containing special characters (`&`, `'`, etc.) were breaking FakerJS expression generation.

**Problem**: Picklist values like "Beaches & Snorkeling" or "Family & Kids' Activities" were causing syntax errors when wrapped in single quotes.

**Solution**: Changed from single quotes to backticks (template literals) in `FakerJSRecipeFakerService`:
- `buildPicklistFakerArraySingleElementSyntaxByPicklistOptions()`: Now uses `` `${option}` ``
- `buildMultPicklistFakerArrayElementsSyntaxByPicklistOptions()`: Now uses `` `${option}` ``

**Benefits**:
- Natural handling of all special characters without escaping
- Consistent format across all picklist/multiselect expressions
- Future-proof for any special characters in picklist values
- No breaking changes to existing functionality

### 🧪 Testing

- Added comprehensive mock infrastructure for testing complex relationships
- Created `MockRelationshipService` with 7 pre-configured test scenarios
- Updated all picklist-related tests to use backtick format
- Added test validation for fields with XML entities (`&amp;`, `&apos;`)
- Created detailed test documentation with visual relationship diagrams

### 📝 Documentation

- Added scenario-specific markdown files documenting complex relationship patterns
- Included ASCII diagrams for visual understanding of object hierarchies
- Provided clear examples of expected sort orders and dependencies

### 🔧 Technical Details

**Files Modified**:
- `src/treecipe/src/RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService.ts`
- `src/treecipe/src/RecipeService/tests/FakerJSRecipeService.test.ts`
- `src/treecipe/src/XMLProcessingService/tests/mocks/XMLMarkupMockService.ts`
- `src/treecipe/src/RelationshipService/tests/RelationshipService.test.ts`
- `src/treecipe/src/RelationshipService/tests/mocks/MockRelationshipService.ts`

**New Test Documentation** (with Mermaid diagrams):
- [Scenario 3: Linear Chain with Multiple Children](src/treecipe/src/RelationshipService/tests/test-scenario-3-linear-chain.md)
- [Scenario 7: Diamond Pattern](src/treecipe/src/RelationshipService/tests/test-scenario-7-diamond-pattern.md)

## [2.5.1] [PR#33](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/33) - Bug : 2.5.1

Initial approach to capturing GlobalValueSets assumed that the singleton would be reset with every invocation of the "Generate Recipe" command.

This was far from how VS Code session and state management function lol

Instead of checking if the singleton was already initialized, we assume we need to retrieve the global value sets with every invocation. This allows for making updates to GlobalValueSet markup and files and re-running the Generate Recipe command and getting the updated faker function based on the latest from the Global Value Sets directory

## [2.5.0] [PR#32](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/32) - Feature : 2.5.0

### Global Value Set Map for avoiding additional TODO's when generating recipes from code base

To round out the remaining drivers of scenarios that drive the generation of picklist values, we have added GlobalValueSets.

This functionality is dependent upon there being a dedicated directory named "globalValueSets" that contain files with expected GlobalValueSet XML markup.  

This functionality relies on a singleton to initiate the a map of GlobalValueSets to associated available picklist values which mapps out to expected faker expressions for picklist fields.


## [2.4.0] [PR#29](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/29) - Feature : 2.4.0

### Standard Value Set Map for avoiding additional TODO's when generating recipes from code base

When generating recipes based on source code, there tends to be references to standardValueSets that require extra efforts to get their associated picklist values in a faker function because the OOTB standard value sets are picklists WITHOUT any necessary xml markup capturing what values make up the picklist.

This feature created a dedicated field api name to picklist values to allow for local management of OOTB standardPicklistValues.

It's not an exhaustive list but is a start and can be easily added on to.

## [2.3.0] [PR#27](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/27) - Feature : 2.3.0

Feature: Leverage nickname property from yaml object recipe that can combine with unique "record reference key" to allow for lookup reference replacements. 

With this update we can now leverage the yaml property "nickname" on a parent object.  When a child object needs to reference a parent to populate for a lookup or masterdetail field, it can provide the nickname as its value:

```yaml

- object: Account
  nickname: ParentAccountNickname
  fields:
    Name: ${{ faker.company.name() }} 

- object: Contact
  fields:
    FirstName: ${{ ... }}
    LastName: ${{ ... }}
    AccountId: ParentAccountNickname

```

## [2.2.0] [PR#26](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/26) - Feature : 2.2.0

Feature: Variable syntax capabilities using faker-js recipes

[Quick YouTube Walkthrough to reuse generated Date field](https://youtu.be/qiO35RUnq8U)

A great feature to snowfakery is [leveraging variable definitions](https://snowfakery.readthedocs.io/en/latest/index.html#define-variables). When generating fake data is the ability to reuse previously generated values, constants or hardcoded variable names. With this update, faker-js based recipes can leverage variable syntax as well.

This functionality introduces a way for specific variable syntax to be leveraged in fake data recipe generation.

```yaml

- var: dinoName 
  value: "indominous"

- var: animatedHero 
  value: batman

- var: randomDate
  value: |
    ${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date('2023-02-01') }).toISOString().split('T')[0] }}

- var: multipicklistFood
  value: ${{ (faker.helpers.arrayElements(['chorizo','pork','steak','tofu'])).join(';') }} 

- object: Account
  count: 1
  nickname: AccountWithCustomFieldsSetByVariables
  fields:
    VarDate__c: ${{ var.randomDate }}    
    VarAnimatedHero__c: ${{ var.animatedHero }}
    VarDinoName__c: ${{ var.dinoName }} 
    VarFood__c: ${{ var.multipicklistFood }}

```

## [2.1.0] [PR#25](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/25) - Feature and Bug Fix: 2.1.0

When generating recipes error handling was not granular and provided no specific detail into what Salesforce field in the local project base was causing an issue. This functionality wraps the field processing service in a try/catch and generates a error details page for self-service troubleshooting.

BUGFIX - as part of this work, there was a bug discovered for dependent picklists and global picklist markup. This update provides functionality that provides necessary logic to prevent recipe generation failure at run time.

## [2.0.4] [PR#21](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/21) - Bug: 2.0.4

Fix for extension error "Command Not Found" -- added "faker-js" into package.json dependencies instead of devDependencies configuriation

## [2.0.3] [PR#18](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/19) - Bug: 2.0.3

Third attempt to fix issue with "Command Not Found"

## [2.0.2] [PR#18](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/18) - Bug: 2.0.2

Second attempt to fix issue with "Command Not Found"

## [2.0.1] [PR#17](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/17) - Bug: 2.0.1

Attempting to fix issue with "Command Not Found"

## [2.0.0] [PR#16](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/16 )- Feature: Introducing "faker-js" as a native node module for generating fake values

Based upon the same YAML file approached used with snowfakery, this update introduces three capabilities to support a faker-js option to generating YAML recipe files and processing the generated faker recipes to production-like data:

1. New extension command to switch between snowfakery-cli and faker-js processors
2. FakerJSRecipeFakerService: based on inputs from field xml, provides expected syntax needed for faker-js recipe processor to work as expected
3. FakerJSRecipeProcessor: Given expected inputs within expected expression syntax indicators "${{ }}" , this processor will either evaluate the faker expression as expected or it will take additional expected outputs surrounding the syntax indicators and build structures to create an output that represents an accepted value structure for Salesforce field types ( Text, dependent picklist , multipicklist, and more )
4. In addition to the two new FakerJS files, the existing FakerRecipeService and FakerServiceProcessor files were renamed to be specific for snowfakery, "SnowfakeryFakerRecipeService" and "SnowfakeryServiceProcessor". This is to clearly describe file names containing expected handling logic for either snowfakery or faker-js. 
5. Custom functions for date and datetime field types for FakerJSRecipeProcessor similar to Snowfakery. 
6. Non-intrusive info box for inserting data sets  (doesn't prevent anything from being done in VS Code and shows the status of the files being processed)
7. On Non-intrusive progress window, selecting "Cancel" button will initiate "Delete Previous Records" functionality that will delete any saved records of that run
  

## [1.3.0] [PR#15](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/15) - Feature: Salesforce OOTB boilerplate faker recipes for several OOTB objects like Account, Contact 

- main feature - OOTB boilerplate recipe markup for several Salesforce CRM objects
- others 
  - added "TODO" verbiage for Picklist fields without xml valueSet markup. The verbiage indicates that the picklist field may need options from a standard value set or global value set
  - refactored RecordTypeService
  - added new unit tests to manage for several different scenarios of picklist xml markup
  - adding changelog :) 


## [1.2.1] [PR#13](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/13) - Bug: logic always expects a record types directory to exist under the custom object directory  

- bug fix stemming from record type logic always expecting a record types directory to exists and record type configurations to build picklists and multiselect picklists from


## [1.2.0] ([PR#12](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/12)) - Feature: Insert Created Datasets with Collections API Service 

- Takes expected artifacts already in Collections API format, generates "proof" artifacts, attempts insert of pre-structured files, and adds insert success/failure results in same timestamped directory as "proof" artifacts. 
- significant refactoring needed to properly setup proof files and introduce new "RecordTypeWrapper" object that incorporates a map of "RecordType.DeveloperName" to unique Record Type Id based on the targeted Salesforce org we are attempting to insert data against
- brief description of each file change below



## [1.1.0] ([PR#10](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/10)) - Feature: Source Record Type parsing for Record Type based Picklists and Multiselect Picklists  

- Introduce logic to parse the "recordTypes" directory within an objects directory and generate a key-value map of record type to associated xml markup details 
- updated unit tests to ensure scenarios where record types are included in the source directory, the generated recipes include the expected record type associated picklist options



## [1.0.0] ([PR#9](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/9)) - Feature: new command pallette option that prompts the User to select a previously created recipe file and executes the snowfakery cli command to generate fake data 

- New Extension command -> Run Snowfakery by Recipe File
  - Executing command will prompt to choose a recipe file to generate fake data from.  These files are found in the path "treecipe/GeneratedRecipes" 
  - Upon recipe file selection, snowfakery cli is executed against the recipe yaml file and results are outputted to json.
  - json is then formatted for for collections api a new timestamped "dataset" directory is created under the folder path "treecipe/FakeDataSets" and within this two files will be created under this directory:
    - The collectionsApi formatted file that has the recipe that generated it
    -  the originating recipe file that lead to the generated fake data
  - If snowfakery cli is not installed on your machine, an exception will be thrown 



## [0.2.1] ([PR#8](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/8)) - Bug: object variable being populated with full objects path instead of intended parsing of the path to get the object name 

- new features - organization - dedicated directory called "GeneratedRecipes" where all new recipes will be placed instead of alongside the root of treecipe folder
- fix windows bug where instead of last segment of path is returned to "object" yaml property, returns whole path:
![image](https://github.com/user-attachments/assets/8eb082af-83d7-40ac-a985-8ec75684bdc9)
- development tooling - new custom vscode task to open jest coverage results in browser and adjusting other jest custom task to create coverage files in coverage directory locally
- significant refactoring of DirectoryProcessor as unit tests were built to support validation of functionality and abstract away logic that could be in isolated methods ( DirectoryProcessor.ts also includes bug fix
- testing support - new methods in MockDirectoryService to mimic vscode.workspace.fs.readDirectory mocking and mocking vscode workspace
- new test suite for ErrorHandlingService



## [0.2.0] ([PR#5](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/5)) - Bug: Graceful error handling when recipes do not generate and associated Support Functionality 

- Introduces a error handling service around all available Treecipe VSCode extension commands
  - error handling includes VSCode Alerts that can:
     - auto-generate GitHub Issue in this repository with templated details needed to reproduce and triage
     - auto-rerun of extension command ( if the Generate Treecipe command is ran without being an initiated treecipe config file, a button is available to auto start the initiate command
  - standardize forward-slashes for objects path on creation of the treecipe.config.json file
  - gracefully handle OOTB Salesforce fields that do not have expected XML tags like "type".  
    - In the event of these scenarios, the recipe field is still generated for awareness and given a value of "REMOVE ME AS I MAY NOT BE ABLE TO GENERATE BECAUSE I AM OOTB FIELD LIKE Id or AccountNumber  


## [0.1.1] ([PR#3](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/3)) - Bug: Snowfakery configuration value casing issue 

- updates the bug fix along with associated jidoka ( countermeasure) tests to validate this scenario occurring again or not
- fix  casing issues with selected faker service type for snowfakery

---

- Initial release

## [0.1.0] ([PR#1](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/1)) - Configiuration service for faker service selection 

 - initial setup for factory pattern "choose your faker service" and associated VSCodeWorkplace and Extension Configuration Management based on faker service choice ( setting, getting configuration values )
 - faker service introduced refactoring needs for separating out expected recipe values in RecipeService into two dedicated recipe providers ( NPMFakerService, SnowfakeryFakerService) - NPMFakerService is not used at the moment and this entire setup was excessive from an actual usage stand point. I did learn some fun stuff and got to apply the factory pattern. In the future, the faker service could be chosen as part of configuration setup. For now it defaults to "Snowfakery"
 - Associated unit tests and supported mock service
 - GitHub Actions for automated jest tests validation and publishing jobs
