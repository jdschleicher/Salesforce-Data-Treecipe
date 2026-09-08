# Claude Code Assistant Instructions - Salesforce Data Treecipe

## AI Context & Project Overview

You are assisting with **Salesforce Data Treecipe**, a **VS Code extension** (TypeScript) that auto-generates fake-data recipe YAML files from Salesforce object metadata (source format). It supports two faker backends: **faker-js** (built-in, no setup) and **snowfakery** (external Python CLI). The extension bridges Salesforce source-format XML metadata → YAML recipe files → Salesforce Collections API datasets.

## Key Project Files

- `src/extension.ts` - VS Code extension entry point; registers all commands
- `src/treecipe/src/` - All core service logic (one folder per service)
- `src/treecipe/src/RecipeFakerService.ts/` - **Directory** (not a file) containing `FakerJSRecipeFakerService/` and `SnowfakeryRecipeFakerService/` implementations
- `src/treecipe/src/FakerRecipeProcessor/` - Interface + FakerJS and Snowfakery recipe processor implementations
- `src/treecipe/src/DirectoryProcessingService/` - Parses Salesforce object metadata XML directories
- `src/treecipe/src/RelationshipService/` - Groups objects into Treecipe files by relationship hierarchy
- `src/treecipe/src/RecipeService/` - Orchestrates recipe YAML file creation
- `package.json` - Extension manifest; all five commands declared under `contributes.commands`
- `jest.config.js` - Jest configuration (`ts-jest`, `jest-extended`)
- `CHANGELOG.md` - Feature history; read before starting work to understand recent changes

## Primary Objectives

1. **Follow existing service patterns** - Each service is a class in its own folder; tests live in a `tests/` subfolder alongside the service file
2. **Field-type-driven generation** - Recipe output is determined by Salesforce XML `<type>` tag; use `<precision>` and `<scale>` to constrain numeric/currency values
3. **Support both faker backends** - Every field-type handler must have equivalent implementations in both `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`
4. **Write tests first** - Every service has a `tests/` folder with Jest specs; add or update tests with every change

## Quick Command Reference

```bash
# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on save)
npm run watch

# Run all tests with coverage
npm run jest-test

# Run tests with JSON + summary output (for CI)
npm run jest-test-summary

# Lint
npm run lint

# Run a single test file
npx jest path/to/SomeService.test.ts

# Package the extension
npx vsce package
```

## CRITICAL RULES - NO EXCEPTIONS

### After Every Code Change

1. **Run tests** - `npm run jest-test` — ALL must pass
2. **Check coverage** - Coverage must not regress
3. **Compile** - `npm run compile` — zero TypeScript errors
4. **Lint** - `npm run lint` — zero ESLint errors
5. Check that existing functionality is not broken
6. Follow the established code patterns in the project

### Testing Requirements

- **Tests are mandatory** - Run `npm run jest-test` after EVERY code change
- **Update tests each change** - When modifying any service, add or update the corresponding test file in its `tests/` folder
- **Tests must pass before committing** - Never commit code with failing tests
- **Test coverage grows with features** - Every new feature, bug fix, or refactor must include relevant test updates
- **Mock fixtures** - Place sample Salesforce XML metadata in `tests/mocks/` inside the relevant service folder
- Use Jest `describe`/`it` or `describe`/`test` blocks; use `jest-extended` matchers where appropriate
- `restoreMocks: true` is set globally — do not manually restore mocks between tests
- **Never replace a Node core module function by assignment** (`fs.promises.readdir = jest.fn()`); always use `jest.spyOn`. `restoreMocks` restores only what `jest.spyOn` registered, and a core module is shared by every suite in a worker rather than rebuilt with the module registry, so an assignment leaks into whichever suite jest schedules next. `jestSetup/CoreModuleIsolation.ts` puts such a replacement back after every test — it is a net, not a licence. Its `afterEach` runs BEFORE a test file's own root-level `afterEach` (root-block hooks run in declaration order, and setup files are evaluated first), so a file-scope `afterEach` cannot assert on an `fs` spy

### Code Style Mandates

- **TypeScript strict** - No implicit `any`; always define types/interfaces
- **Class-based services** - Each service is a `class` with `static` methods; no standalone functions scattered outside a class
- **Interface-first for faker services** - Both faker backends implement `IRecipeFakerService` and `IFakerRecipeProcessor`
- **No hard-coded Salesforce field values** - All field type mappings must be driven by the XML `<type>` value
- **Naming conventions** - PascalCase for classes/interfaces, camelCase for methods/variables; service files match their class name
- **No comments for self-evident code** - Only add comments where the logic is non-obvious

## Project Structure

```
jestSetup/                                   # Jest harness only — outside tsconfig rootDir, never packaged
├── CoreModuleIsolation.ts                   # Restores fs / fs.promises functions a test replaced
├── setupCoreModuleIsolation.ts              # setupFilesAfterEnv entry that registers the afterEach
└── tests/
src/
├── extension.ts                             # Extension entry point, command registration
└── treecipe/src/
    ├── CollectionsApiService/
    │   ├── CollectionsApiService.ts         # Formats fake data for Salesforce Collections API
    │   ├── ICollectionsApiJsonStructure.ts  # Interface for Collections API payload shape
    │   └── tests/
    ├── ConfigurationService/
    │   ├── ConfigurationService.ts          # Reads/writes treecipe.config.json
    │   └── tests/
    ├── DirectoryProcessingService/
    │   ├── DirectoryProcessor.ts            # Walks Salesforce objects/ directory, parses XML
    │   └── tests/
    │       └── mocks/                       # Sample Salesforce metadata XML fixtures
    ├── ErrorHandlingService/
    │   ├── ErrorHandlingService.ts          # try-catch wrappers, GitHub Issue template generation
    │   └── tests/
    ├── ExtensionCommandService/
    │   └── ExtensionCommandService.ts       # VS Code command handler implementations
    ├── FakerRecipeProcessor/
    │   ├── IFakerRecipeProcessor.ts         # Interface both processors implement
    │   ├── FakerJSRecipeProcessor/
    │   │   └── FakerJSRecipeProcessor.ts
    │   └── SnowfakeryRecipeProcessor/
    │       └── SnowfakeryRecipeProcessor.ts
    ├── GlobalValueSetSingleton/
    │   ├── GlobalValueSetSingleton.ts       # Shared picklist global value set state
    │   └── tests/
    ├── ObjectInfoWrapper/
    │   ├── ObjectInfo.ts                    # Typed wrapper for parsed Salesforce object metadata
    │   ├── ObjectInfoWrapper.ts
    │   ├── FieldInfo.ts
    │   └── tests/
    ├── RecipeFakerService.ts/               # DIRECTORY (not a file)
    │   ├── IRecipeFakerService.ts           # Interface both faker services implement
    │   ├── FakerJSRecipeFakerService/
    │   │   ├── FakerJSRecipeFakerService.ts # faker-js YAML recipe generation per field type
    │   │   ├── ProcessedYamlWrapper.ts
    │   │   └── tests/
    │   └── SnowfakeryRecipeFakerService/
    │       ├── SnowfakeryRecipeFakerService.ts # Snowfakery YAML recipe generation per field type
    │       └── tests/
    ├── PicklistDependencyCheckService/
    │   ├── PicklistDependencyCheckService.ts # Deploys and runs the generated picklist dependency tests against an org
    │   └── tests/
    ├── PicklistDependencyExplorerService/
    │   ├── PicklistDependencyExplorerService.ts # Builds the explorer STRUCTURE view model (from the spec manifest, or an explicit metadata preview) and the webview html shell. Also RETAINS the run-overlay capability (applyRunToViewModel and everything under it), which no Explorer open calls
    │   └── tests/
    │       └── mocks/                        # results.json / report.md fixtures for the retained overlay
    ├── PicklistDependencyMetadataWriterService/
    │   ├── PicklistDependencyMetadataWriterService.ts # Transposes Apex spec intent back into valueSettings and writes field metadata
    │   └── tests/
    │       └── mocks/
    ├── PicklistDependencyManifestService/
    │   ├── PicklistDependencyManifestService.ts # Builds/reads treecipe/PicklistDependencySpecs/manifest.json, stable combination keys, stat-based staleness fingerprint
    │   └── tests/
    ├── PicklistDependencyTestService/
    │   ├── PicklistDependencyTestService.ts  # Emits SDT-prefixed per-object Apex spec classes from picklist dependency metadata
    │   └── tests/
    │       └── mocks/
    ├── RecipeService/
    │   ├── RecipeService.ts                 # Orchestrates recipe YAML file creation end-to-end
    │   └── tests/
    │       └── mocks/
    ├── RecordTypeService/
    │   ├── RecordTypeService.ts             # Detects record types and related picklist options
    │   ├── RecordTypesWrapper.ts
    │   └── tests/
    ├── RelationshipService/
    │   ├── RelationshipService.ts           # Builds object relationship hierarchy for Treecipe grouping
    │   └── tests/
    │       └── mocks/
    ├── SfdxProjectService/
    │   ├── SfdxProjectService.ts             # sfdx-project.json parsing, workspace containment, tolerant packageDirectories resolution
    │   └── tests/
    ├── ValueSetService/
    │   └── ValueSetService.ts               # Parses picklist/global value set XML
    ├── VSCodeWorkspace/
    │   ├── VSCodeWorkspaceService.ts        # VS Code workspace/UI utilities (file picker, messages)
    │   └── tests/
    │       └── mocks/
    └── XMLProcessingService/
        ├── XmlFileProcessor.ts              # XML parsing utilities (xml2js wrapper)
        └── XMLFieldDetail.ts               # Typed field detail from parsed XML
```

## Architecture Patterns

### Extension Command Flow

```
User runs command (Cmd+Shift+P)
  → extension.ts registers command → ExtensionCommandService handler
    → ConfigurationService reads treecipe.config.json
      → DirectoryProcessingService walks salesforceObjectsPath
        → XmlFileProcessor parses each field's XML
          → ObjectInfoWrapper wraps parsed metadata
            → RecordTypeService / ValueSetService / RelationshipService enrich data
              → RecipeService orchestrates YAML generation
                → FakerJSRecipeFakerService OR SnowfakeryRecipeFakerService
                  → generates faker expression per field type
                → Writes YAML recipe file(s) to workspace
```

### Key Design Decisions

- **`RecipeFakerService.ts` is a directory** — it contains both faker implementations as subfolders; this naming is intentional and must not be changed
- **Apex written into a user's project is `SDT`-prefixed** — every class in `apexPicklistDependencyFramework/SDTPicklistDependencyFramework/` (the framework source shipped in the .vsix and scaffolded into the user's package directory), and every class the generator emits, starts with `SDT` so it cannot collide with the user's own Apex. Keep new Apex consistent with this
- **Both faker backends must stay in sync** — whenever a new field type handler is added to `FakerJSRecipeFakerService`, add the equivalent to `SnowfakeryRecipeFakerService`
- **Numeric/currency precision** — `<precision>` (total digits) and `<scale>` (decimal places) from XML drive `max` and `dec` parameters; `left_digits = precision - scale`
- **Picklist handling** — special characters (`&`, `'`, etc.) in picklist values must be escaped before embedding in faker expressions
- **The generated Apex test suite is the published handle, and regeneration MERGES it** — `SDTPicklistDependencyTests.testSuite-meta.xml` is what `--suite-names`, Setup and `Run Picklist Dependency Check` all address, so nothing downstream depends on the generated class name. Unlike the `.cls` files it is NOT owned outright: a suite is a grouping a team curates, so generation unions its member in and removes nothing, and a file it cannot parse as an `ApexTestSuite` is left exactly as it is with a warning. The suite lives in a `testSuites` sibling of the classes directory — one derivation, in `getTestSuitesDirectoryPath`, so the two cannot drift off `main/default` separately. Its file name ends in `-meta.xml` without being a sidecar, which is why report filtering keys on `.cls-meta.xml`
- **The deployed-check asks about suite MEMBERSHIP, never suite existence** — a suite whose member class was deleted still exists, and `--suite-names` against it runs zero tests and reports success. One Tooling API query over `TestSuiteMembership` answers both halves; anything cheaper is a green check that verified nothing
- **The transpose is the writeback's whole reason to exist** — a validator failure is indexed by *controlling* value (`cle @ missing [plant]`) while `valueSettings` is indexed by *dependent* value (`plant ← cle`), so acting on a failure by hand means editing a block the message never names. `PicklistDependencyMetadataWriterService` owns that direction; keep it one function with one direction
- **Anything spanning a run is keyed by object AND field** — a run reconciles every per-object spec class at once, and field api names repeat across objects (`Status__c` on Account and on Case). `PicklistDependencyMetadataWriterService.buildFieldKey` is the one place that shape is defined; use it for every path map, dependency-graph key and report line rather than the bare field api name
- **Writeback merges intent, it does not substitute for it** — a spec asserts what a controlling value must and must not unlock; anything it names neither way it makes no claim about. Only `expectNone` and `expectExactly` are exhaustive and may remove. Reading silence as deletion would let a one-line spec strip a file
- **The spec manifest is the single source for the Explorer** — `Generate Picklist Dependency Tests` emits the Apex classes and `treecipe/PicklistDependencySpecs/manifest.json` from one in-memory model in one run, and the Explorer renders the manifest rather than re-walking the source XML. Anything that changes what the generator emits must flow through the manifest too, or the panel and the Apex become two derivations again. The manifest never goes in a package directory — a stray `.json` there breaks `sf project deploy`
- **The manifest records the information content of the specs, not their cross product** — what a controlling value must NOT unlock is the complement of what it unlocks within the field's declared values, so recording it per expectation grew `manifest.json` with *combinations x declared values* (315.7 MB, a 1.4 s parse, ~59% of an Explorer open). A field entry carries `declaredValues` ONCE and an expectation carries `forbiddenValuesAreDeclaredComplement`; `buildSpecDetailsByManifest` reconstructs the array on read so every consumer — the Explorer's rows, and `PicklistDependencyMetadataWriterService`, whose transpose REMOVES pairs by that list — is unchanged. The marker is DERIVED AND COMPARED before it is recorded, never assumed: a forbidden set that is not the complement is written out literally, which is what makes the round trip a property rather than a coincidence of the two current generators. Three states stay distinct because the panel renders them differently — the marker, a written-out list (`expectNone` and `expectUnavailable` assert an EMPTY set against a non-empty universe), and neither, which asserts only the positive half. The universe is the one the spec was drawn against, so a record-type-scoped field records what the RECORD TYPE assigns; and it must be COMPLETE, per the complement rule above. Order it once per FIELD (`buildOrderedDeclaredValues`) rather than inside each complement — that was measured at 594 ms against 59 ms and would have handed back most of the parse saving
- **Recording a complement as a marker makes the manifest DECOMPRESSIVE, so reading it is bounded by what it expands to** — the file carries the sum of the two picklists while reading materializes their product, and that expansion happens on load, BEFORE `applyModelLimits`, which bounds what is rendered from a finished view model rather than what building one allocates. Under version 2 a forty-million-value expansion needed a ~400 MB file; now a 0.70 MB one does it. `countReconstructedDeclaredValues` counts what the MARKER expands (a literal forbidden list already costs the file what it costs memory) and a manifest past `maximumReconstructedDeclaredValues` is reported unreadable. That ceiling is MEASURED — 25 M is 4.3x the largest real org (1,200 fields reconstruct 5.7 M in 268 ms / 61 MB) and holds the load near 260 MB — and a test asserts the headroom rather than trusting the comment. And a universe read from disk is COMPLETE OR NOTHING: filtering `declaredValues` to the strings that parse leaves a list that looks whole, and every complement drawn from it understates what the spec forbids — one bad element would narrow the universe for every expectation on the field, where version 2 lost one expectation's list
- **The Explorer bounds what it renders, and never re-labels what it drops** — an object's rows are built on first expand, and `applyModelLimits` caps five axes plus one TOTAL budget (`maxRenderedCombinations`). The total is the part that bounds the payload: the per-axis caps only shape the panel, and their product is millions of rows. Bounding it took three axes, not one — combinations, dependent picklists per object, and `declaredValues`, which grows with a field's picklist rather than with how many combinations survive and was the dominant term once the others were capped. What SURVIVES a cap is MANIFEST ORDER — the first that fit, on every axis, including the total budget, which is spent in document order. That rule is asserted rather than left implicit: the panel used to retain rows a check had reported a failure for, and with no check to read there is no property of a row left to prefer by. Inventing one (longest, most combinations, alphabetical) would order the panel by something the generated Apex does not, and an unasserted order is one a refactor can turn into "whatever the iteration produced" — at which point a reader cannot tell a dropped row from a moved one. The single exception retains an object carrying a SKIPPED FIELD, which is a fact about the metadata rather than about a run. A dropped row is ABSENT and counted in a notice, never rendered as something it was not — and the notice has to be TRUE of the axis it describes: the node cap is applied to ROOT CHAINS and a surviving chain brings every field beneath it, so an object can render far more fields than `maxNodesPerObject`, and every holder the TOTAL budget empties increments its own `truncatedCombinationCount` rather than only the aggregate. A field emptied silently renders as a field that declares no combinations, which is the same false claim one level down. Filtering works the same way: it hides, and recomputes nothing. Whenever a cap is added or changed, RE-MEASURE — the numbers in CHANGELOG 3.7.0 come from serializing synthetic models through the real builder, and two earlier drafts of this ceiling were chosen by reasoning and were wrong by 5-13x
- **The panel answers a value query itself, from what it was already sent** — "what does `Canada` unlock" is a question about rows, and the tree is indexed by the DEPENDENT field, so one controlling field's effects sit in sibling nodes nothing composes. `renderControllingValueSummary` composes them, and the filter narrows to ROWS rather than stopping at nodes. Both are derived IN THE PANEL from `allowedValues` the model already carries, so the posted payload is unchanged — a test pins that no `searchText` in it names a dependent value. The distinction the row filter turns on needed a haystack that did not exist: since 3.18.0 `searchText` folds controlling values in with api names and so cannot say whether the reader named the NODE, which is what decides between showing all of a node's rows and narrowing it to one — hence `nodeNameSearchText`, names only, lowercased once at build time. `buildObjectValueIndex` is drawn from `allowedValues`, NEVER from `declaredValues`, and that is a soundness property rather than a preference: `declaredValues` is a superset of `allowedValues` in the model the builder produces and NOT after `applyModelLimits`, which slices `declaredValues` at `maxDeclaredValuesPerNode` and never slices `allowedValues` — a draft that indexed the universe hid objects whose rendered rows visibly unlocked the searched value. Matching the unlockable set is exact in both directions, so no fallthrough scan of the model survives on the keystroke path; the model-side matcher that used to serve unbuilt scopes is GONE, because lowercasing `allowedValues` per keystroke cost 23 ms on a panel with nothing expanded — the defect #125 measured at 27 ms and moved to build time. Unbuilt scopes are answered by a per-scope haystack instead, which also carries its controlling values because a scope decides whether its own group opens. A row matches on what it UNLOCKS and never on its complement: every row that does not unlock a value forbids it, so matching the complement would show every row of the field. ROWS ARE A HIDEABLE AXIS, and everything that resets visibility must reset them too — `showEveryNode` restores rows and scope filters and drops the summary, because a deep link pasted after a value query otherwise focuses and scrolls to a row it leaves hidden. The summary needs its OWN ceiling (`SUMMARY_MAX_CONTROLLING_VALUES`, `SUMMARY_MAX_VALUES`): it is the product of matched combinations and `allowedValues`, the one axis `applyModelLimits` never caps, and `EXPAND_ALL_OBJECT_LIMIT` does not bound it because built objects accumulate and are never un-built — uncapped, one intermediate keystroke drew 129,500 elements in 852 ms. MEASURE IN THE STATE THE CODE RUNS IN: `applyNodeFilter` returns before both new paths when an object is not built, so the first measurement of this feature was taken on a collapsed panel and described nothing. At the combination ceiling with 25 objects expanded and a 200-value picklist per field: 10.64 MB index against a 39.79 MB payload, 289 ms on the first keystroke (which builds essentially every object's index — the posted haystack only answers for the one object the reader named), 2.8 ms collapsed, 39 ms on a prefix matching everything. And a miss states whether it is one: the caveat is keyed on rows the ceiling dropped, fires whenever a query runs against a truncated model rather than only when nothing matched, and is no longer attached to a capped declared list, which no longer costs the find box anything
- **A complement is only ever drawn against a COMPLETE universe** — where `maxDeclaredValuesPerNode` capped a field's declared values, the panel stops rendering "must not unlock" and says why. A complement of a partial universe understates what the spec forbids, which is a false claim rather than a shorter one
- **The Explorer is a picture of the STRUCTURE, and the run overlay is DISCONNECTED rather than deleted** — a picklist dependency is a fact about the metadata, fully derivable from the spec manifest, so the panel renders in a workspace that has never had an org, a CLI or a deployed test. Whether the org still AGREES is what `Run Picklist Dependency Check` answers, in its own output channel and `report.md`. No Explorer open resolves the results folder, and the panel renders no badge, banner, triage, status filter or Apex-opening action. But every method the overlay is built from is RETAINED, exported and still tested — `loadLatestResults`, `parseFailureLines`, `applyFailuresToNodes`, the triage map, the openable-target collectors, the line finders — and the orchestration that used to sit inside `buildExplorerViewModel` is now `applyRunToViewModel`. It MUST run on an UNCAPPED model, before `applyModelLimits` — `buildUncappedExplorerViewModel` and `...ByManifest` exist for exactly that. The ceiling drops rows, and a failure naming a row that is already gone matches nothing, lands in the unattributed set and holds the WHOLE object at `'unknown'`, every surviving row with it; overlay-then-cap is the order the overlay ran in when it lived inside the build. Two tests pin both compositions, so the wrong one cannot be introduced unnoticed. The overlay fields on the view model are OPTIONAL, and that is the load-bearing detail: a structural build never sets them, so the posted payload does not grow per row, and ABSENT stays distinct from `'unknown'` — absent means "this model is not about a run", `'unknown'` means "a run was overlaid and did not cover this row". Making them required with an `'unknown'` default would collapse the two and put the three-state rendering one line from the panel. Both Apex commands are untouched, and `generatedClassName`, `specMethodName` and `testMethodName` are still carried on the model and in `manifest.json` — but the PANEL names none of them. Which class was generated is not a fact about a dependency, and a find box matching text the reader cannot see would return rows with no visible reason, so the generated names are out of `buildNodeSearchText`/`buildObjectSearchText` too: what is searchable is what is on screen. That rule cuts the other way as well: the haystack names the CONTROLLING value of every combination a node renders (dependent values stay out — they are the product the manifest stopped materialising), and because the build computes it on the UNCAPPED model, `applyModelLimits` ends with `rebuildSearchText` so a value whose row the ceiling dropped is not matched either. A match always has a row on screen to show for it. The haystack is joined on a NEWLINE (`SEARCH_TEXT_SEPARATOR`), because a value can carry spaces and a space join would let a phrase match across two values; and each value is serialized twice (node and object haystack), so a re-measure of the ceiling counts both copies. The provenance banner stays, minus the class name — it distinguishes a manifest-sourced model from a metadata preview, which is a statement about where the ROWS came from
- **Every panel action is gated by its own allow-list built from the rendered model** — reveal and copy-reference each check the posted value against what the model NAMES rather than validating it as a path. The HOST holds two of them now: the two keyed on a file AND an Apex method together went with the buttons that addressed them. Their COLLECTORS (`collectOpenableSpecTargets`, `collectOpenableRunReportTargets`, `buildOpenTargetKey`) are retained on the service alongside the rest of the overlay, so re-adding an action means re-adding its `new Set(...)` in `renderPicklistDependencyExplorerModel` and its reset at all four sites — never a handler that VALIDATES a posted path instead of MATCHING it
- **An allow-list is only as trustworthy as the text it was built from** — `manifest.json` is on disk and a hand edit controls it, and `loadManifest` accepts its paths as bare strings. Any manifest path that becomes something the extension host OPENS must go through `resolveOpenableManifestFilePath` first (`classesDirectoryPath`), the same containment `resolveRenderableObjectsDirectoryPath` applies to the objects directory. Out-of-workspace resolves to EMPTY, which renders no button and contributes no allow-list entry. `generatedClassFilePath` comes through here and is RETAINED, because `collectOpenableSpecTargets` reads it — what makes that safe is the containment it passes on the way in, NOT the current absence of a caller, which a future button would silently remove. Adding a new openable manifest field without this is how "the model named it" stops being a safety property
- **The explorer panel is a webview, and no metadata reaches its document at all** — picklist values, api names and Apex failure messages all originate in metadata the extension does not control, so none of them is interpolated into html. `buildWebviewShellHtml` takes a nonce and nothing else; the model is posted with `postMessage` and every node is written through `createElement`/`textContent`. That is why the escaping that used to guard this (`escapeHtml`, `escapeJsonForScriptBlock`) is gone rather than unused — there is no markup context left for a value to escape out of, and re-introducing one by interpolating a model value into the shell would quietly remove the guarantee. Its CSP admits only the extension's own nonced inline style and script, and the `Reveal in Explorer` handler opens a path only when the built view model itself named it
- **The find box is the FIRST thing the panel draws, and the caveats sit under it** — every other top-level block is a statement *about* the rows (where they came from, whether they still match the metadata, what the ceiling dropped, what was skipped), and a reader who opened the panel to look one field up was scrolling past all of it to reach the only control that gets them there. `renderToolbar` runs before `renderProvenanceBanner`, and only when the model has objects: with none there is nothing to filter and `applyFilter`, which is what fills the match count, never runs. The skipped-item list is behind a disclosure and starts COLLAPSED — the COUNT is what a reader has to see, since it is what says the panel is not showing everything, while the list is one line per skipped item and unbounded in how many the metadata skipped. Collapsed is not dropped: nothing leaves the model, the section is still registered in the contents, and every warning still renders under its own object. The generation stamp sits in the HEADER, on its own small line under the title, and the provenance banner carries no copy of it — stated once. Like the scanned path it is filled from the model, so it is revealed LAST (`revealHeaderLines`) and only when `generatedAt` is non-empty: a header line written early is what made a failed render read as a finished one, and a metadata preview was never generated so it has nothing to stamp. All of these are properties of the RENDERED PAGE rather than of the source, so they are asserted by running the real panel script against the fake DOM harness (`runPanelScript`) — which is also why that harness's `classList` answers `contains` from the classes an element actually carries rather than from its own `add` history: an element collapsed by `createElement('div', 'hidden')` was being reported visible, and a toggle driven off that answer opens a section the panel never closed — and why its fake elements START with the classes the shell markup declares, so a header line no render revealed is not reported visible either
- **The panel opens before the load and reports each phase; only what the structure does not depend on runs after the paint** — the shell is static, so it is shown immediately and names its phase in a banner and a status bar item. Reporting a phase is worth nothing without YIELDING: VS Code batches webview posts and status bar writes and flushes them at the end of the event-loop turn, so a load that never awaits narrates nothing however many phases it reports — `yieldToExtensionHost` between phases is what makes the reporting real, and it is also what lets the panel's `ready` be received mid-load. Every host message is stored and posted only once the panel is ready, which keeps the protocol idempotent: posting eagerly AND replaying on the handshake renders the whole model twice. The freshness stat walk is no longer part of an open AT ALL: it produces a caveat *about* the structure rather than a precondition for it, so it is a banner button, and an open's last reported phase is `buildingView`. A model built by an open carries `notChecked` — nobody has looked — which is distinct from `pendingCheck`, a walk actually in flight; collapsing the two leaves a panel nobody asked to check sitting behind a progress message for work that is not running. `checkFailed` is the walk that ran and could not read the directory, kept separate from the two stale values because reporting a metadata change for an `EACCES` sends a reader after an edit they never made. Reaching it took a change in the WALK, not just a `try`/`catch` at the call site: `collectSourceFingerprintEntries` swallows `readdirSync` and `statSync` failures per directory, so the root is now read unguarded — a missing root yielded `sha256('')`, which mismatches and was reported as "your metadata has changed", the exact false claim `checkFailed` exists to prevent. Every refusal of a check ANSWERS the panel, because the click optimistically shows "checking" and a silent return leaves a disabled button narrating a walk that is not running. None of the four non-fresh values claims agreement with metadata. The run overlay that used to sit between the manifest parse and the model build is UNWIRED, and its `loadingResults` phase with it — an open now reports `readingManifest` then `buildingView`. The overlay itself is still there as `applyRunToViewModel`; nothing on the open path calls it. Before a model is rendered, every panel action allow-list is EMPTY — the panel exists in a window where nothing is on screen for an action to have come from
- **Nothing else can report a panel that failed to draw, so the panel reports itself** — a webview exception never reaches the extension host: a render that threw part way used to leave the host believing the load finished, because it had posted a model and the post had succeeded. The whole render runs inside `renderPanelGuarded`, which replaces the body with a failure notice (a partial page is an arbitrary prefix of the model, not a smaller correct answer) and posts `renderFailed` to `ErrorHandlingService.handleCapturedError` — the same path a host-side failure takes. A `rendered` ack distinguishes "a model was sent" from "something is on screen", and a `window` `error` listener covers throws outside the render, such as a lazy expand. The scanned-path line is revealed LAST, after the body it describes has drawn: written first, it was the marker that made a failed render look like a finished one. Both panel→host messages are gated on a render message having been posted, like every other panel command. A failure to DRAW is distinguished from a `runtime` throw after a successful draw: only the first invalidates the panel and empties its action allow-lists, because a handler that threw on a keystroke leaves the rows on screen and readable. Each distinct failure is reported ONCE — the panel's `error` listener fires per event, and a throw in the filter's input handler would otherwise put one notification per keystroke in front of the reader
- **A test that replaces a NODE CORE module function must do it through `jest.spyOn`** — jest rebuilds the module registry per test file, but `require('fs')` hands every suite in a worker the same object, and `restoreMocks` can only restore what `jest.spyOn` registered. An assignment therefore outlives its own suite, and jest attributes the resulting failure to whichever file the poisoned worker was running rather than to the one that wrote it. A canned `fs.promises.readdir` answering every path with two directories is what exhausted a 4 GB heap in CI: `DirectoryProcessor.processDirectory` descends into every directory it is handed, so a `readdir` with no leaf branches forever. It reproduced two runs in three on a COLD jest cache — every CI run — and essentially never on a warm one, because the cache changes the per-file timings that decide which suites share a worker. `jestSetup/CoreModuleIsolation.ts` restores those functions after every test so the next such assignment costs its own test
- **`SfdxProjectService` is a leaf on purpose** — `fs` and `path` only, no `vscode` and no other service. `VSCodeWorkspaceService` needs the same workspace-containment logic the Apex-writing commands use, and importing `PicklistDependencyTestService` for it would close the cycle `VSCodeWorkspaceService → PicklistDependencyTestService → RecipeService → ErrorHandlingService → VSCodeWorkspaceService` and drag `@salesforce/core` into config initiation. `PicklistDependencyTestService` keeps its four helpers as delegations; `isPathContainedInWorkspace` passes its OWN realpath resolver down, so that service stays the single source of truth for how its paths resolve and the spies in its tests still intercept
- **Reading `sfdx-project.json` has two directions, and they are not interchangeable** — the commands that write Apex use `resolveDefaultPackageDirectoryPath`, which THROWS on a missing, unparseable or unusable project file because they cannot proceed without a package directory. Config initiation must proceed: a user who is not in a DX project still gets the full workspace walk, so it reads through `SfdxProjectService.resolvePackageDirectoryPaths`, which degrades every one of those cases to an empty list. The one case it reports is a file that IS there and cannot be parsed — an absence is a fact about the project, a parse failure is a typo the user wants told
- **The objects picker opens BEFORE its own scan, and the USER'S ANSWER ends the command** — `promptForObjectsPath` shows a `busy` quick pick and streams directories in as the walk finds them, because the notification whose button started the command is already gone (VS Code dismisses one the moment a button is clicked, and offers no way to keep it open or put a spinner in it). The selection is RACED against the scan and a response is itself a reason to stop walking: awaiting the walk and only then reading the selection puts the original stall back one layer down, and lets a later Cancel discard a choice the user already made. Item assignments are batched (200 items / 100ms) because `.items` is an ext-host round trip that re-sends the whole list, and the active item is restored across each flush or the scan drags the user's highlight to the top while they read. The cancellable `withProgress` is what makes the walk stoppable; `ProgressLocation.Window` cannot, so it is not used here either
- **The injectable realpath resolver on `isPathContainedInWorkspace` takes a REAL resolver, always** — it exists so a caller that owns its own `getRealDirectoryPath` stays the source of truth for how its paths resolve. An identity function passed here would defeat the symlink half of the containment check. The lexical half never passes through the resolver, so no injected resolver can make a `../` or absolute path pass — but it can hide a symlink escape
- **Relationship grouping** — `RelationshipService` determines which objects belong in the same Treecipe file and in what insertion order

### VS Code Commands (package.json)

| Command ID | Title |
|---|---|
| `treecipe.initiateConfiguration` | Initiate Configuration File |
| `treecipe.generateTreecipe` | Generate Treecipe |
| `treecipe.runFakerByRecipe` | Run Faker by Recipe |
| `treecipe.insertDataSetBySelectedDirectory` | Insert Data Set by Directory |
| `treecipe.changeFakerImplementationService` | Select Faker Implementation |
| `treecipe.generatePicklistDependencyTests` | Generate Picklist Dependency Tests |
| `treecipe.runPicklistDependencyCheck` | Run Picklist Dependency Check |
| `treecipe.openPicklistDependencyExplorer` | Open Picklist Dependency Explorer |
| `treecipe.updatePicklistDependencyMetadata` | Update Picklist Dependency Metadata from Specs |

---

## Implementation Checklist

When implementing a new feature or fixing a bug:

- [ ] Read the relevant service file(s) before making changes
- [ ] Add or update tests in the service's `tests/` folder
- [ ] If adding a new Salesforce field type handler, implement it in **both** `FakerJSRecipeFakerService` and `SnowfakeryRecipeFakerService`
- [ ] Add XML fixture files to `tests/mocks/` if the change depends on specific XML markup
- [ ] Run `npm run jest-test` — all tests pass, coverage does not regress
- [ ] Run `npm run compile` — zero TypeScript errors
- [ ] Run `npm run lint` — zero ESLint errors
- [ ] Update `CHANGELOG.md` with the change under an appropriate version heading

## Common Tasks

### Adding a New Salesforce Field Type Handler

1. Identify the Salesforce `<type>` value (e.g., `"Checkbox"`, `"Date"`)
2. Add a handler in `FakerJSRecipeFakerService.ts` that returns the appropriate faker-js expression
3. Add the equivalent handler in `SnowfakeryRecipeFakerService.ts`
4. Add tests for both in their respective `tests/` folders, with sample XML in `mocks/`

### Adding a New VS Code Command

1. Declare it in `package.json` under `contributes.commands`
2. Register it in `extension.ts`
3. Implement the handler in `ExtensionCommandService.ts`
4. Wrap in `ErrorHandlingService` for consistent error reporting

### Running Tests for a Specific Service

```bash
npx jest DirectoryProcessingService
npx jest FakerJSRecipeFakerService
npx jest --testPathPattern="RecipeFakerService"
```

### Checking What Changed Recently

```bash
# Read CHANGELOG.md top section, or:
git log --oneline -10
```

## Remember

- **Both faker backends** - New field type handlers must be implemented in both FakerJS and Snowfakery services
- **Tests first** - Add/update tests in the service's `tests/` folder before or alongside code changes
- **No comments for obvious code** - Only comment where logic is genuinely non-obvious
- **`RecipeFakerService.ts` is a directory** - Do not confuse it with the `.ts` file of the same name in the parent folder
- **Precision/scale math** - `left_digits = precision - scale`; `max = 10^left_digits - 1`; `dec = scale`
- **Special characters in picklists** - Always escape before embedding in faker expression strings

---

_This document is optimized for Claude Code. Refer to `README.md` for end-user documentation and `CHANGELOG.md` for version history._
