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
- `package.json` - Extension manifest; commands under `contributes.commands`, the Treecipe Activity Bar container and view under `viewsContainers`/`views`/`viewsWelcome`
- `jest.config.js` - Jest configuration (`ts-jest`, `jest-extended`)
- `CHANGELOG.md` - Feature history; read before starting work to understand recent changes
- `src/treecipe/src/<Service>/DESIGN.md` - That service's design notes and the reasons behind them; read before changing the service (table under **Key Design Decisions**)

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
7. **After a change to any Recipe Cockpit list, table or row**, run `/cockpit-row-style` (#558)

### Testing Requirements

- **Tests are mandatory** - Run `npm run jest-test` after EVERY code change
- **Update tests each change** - When modifying any service, add or update the corresponding test file in its `tests/` folder
- **Tests must pass before committing** - Never commit code with failing tests
- **Test coverage grows with features** - Every new feature, bug fix, or refactor must include relevant test updates
- **Mock fixtures** - Place sample Salesforce XML metadata in `tests/mocks/` inside the relevant service folder
- Use Jest `describe`/`it` or `describe`/`test` blocks; use `jest-extended` matchers where appropriate
- `restoreMocks: true` is set globally — do not manually restore mocks between tests
- **Never replace a Node core module function by assignment** (`fs.promises.readdir = jest.fn()`); always use `jest.spyOn`. `restoreMocks` restores only what `jest.spyOn` registered, and a core module is shared by every suite in a worker rather than rebuilt with the module registry, so an assignment leaks into whichever suite jest schedules next. `jestSetup/CoreModuleIsolation.ts` puts such a replacement back after every test — it is a net, not a licence. Its `afterEach` runs BEFORE a test file's own root-level `afterEach` (root-block hooks run in declaration order, and setup files are evaluated first), so a file-scope `afterEach` cannot assert on an `fs` spy
- **Every dependency is one exact version** — `package.json` holds no ranges, `.npmrc` sets `save-exact=true`, and `.github/workflowScripts/tests/dependencyPins.test.js` fails on a range or a version the lockfile does not lock (#588). A dependency changes only in its own PR, with `/supply-chain-check`

### Code Style Mandates

- **TypeScript strict** - No implicit `any`; always define types/interfaces
- **Class-based services** - Each service is a `class` with `static` methods; no standalone functions scattered outside a class
- **Interface-first for faker services** - Both faker backends implement `IRecipeFakerService` and `IFakerRecipeProcessor`
- **No hard-coded Salesforce field values** - All field type mappings must be driven by the XML `<type>` value
- **Naming conventions** - PascalCase for classes/interfaces, camelCase for methods/variables; service files match their class name
- **No comments for self-evident code** - Only add comments where the logic is non-obvious

### Human-Readable Code — a change reads like the rule it implements

Someone who knows Salesforce metadata, Treecipe recipes and VS Code, but not this file, should understand a change from the code alone, and an agent should find it without reading more than it changes. Applies to new and changed code; do not rewrite untouched code just to comply.

- **Domain names** — `objectApiName`, `ruleName`, `treeKey`, never `tmp`, `data`, `flag`, `result2`
- **A rule and its data live together** — allowed values, limits and labels within a screen of the check that reads them
- **The smallest change that states the rule** — no counters, log lines, flags or helpers the request did not ask for; propose them instead
- **Several rules on one record are a named list** — each with a name, a check and a reason, run in order
- **Comments say why, in a line or two** — history goes in the PR or CHANGELOG; a hazard warning stays beside its line
- **Messages a person can act on** — name the object, field, file or org, the rule broken, and what to do
- **Mind what a reader must load** — prefer a checked `.ts` module over code in a template-literal string, a new file over growing one past ~2,000 lines, and a design note beside the service over history in this file

`/readable-code` checks a diff against these rules; `/readability-gauge` scores a file or area for a human and an agent and proposes refactors.

## Project Structure

```
.claude/settings.json                        # Project hooks: the flow guard on prompts, edits, shell commands and PR creation
.claude/hooks/flowGuard.js                   # src/ read-only until "approve plan #N" after /next-task N; no push or PR until Phase 1 passed on HEAD
.claude/hooks/prFlowPhase1.js                # /pr-flow Phase 1 (compile, lint, debug audit, CHANGELOG sync, tests); records a pass for HEAD in .claude/flow-state/
.claude/skills/cockpit-help-sync/            # Keeps the cockpit's ? help and docs/RECIPE-COCKPIT-GUIDE.md in step, re-takes its screenshots
.claude/skills/cockpit-row-style/            # Holds every cockpit list to the row presentation standard (#558): two-line row header, bordered row box, column table
.claude/skills/readable-code/                # Readability review of a diff for a human and an agent: CLAUDE.md's Human-Readable Code rules, token cost of where code and guidance are added (from salesforce-to-git)
.claude/skills/readability-gauge/            # Scores a file or area for a human and an agent on nine dimensions (read size and feedback loop included) plus a guidance budget, measures tokens and seconds per change, and proposes refactors (from salesforce-to-git)
docs/RECIPE-COCKPIT-GUIDE.md                 # The guide the cockpit's "Open the full guide" opens; pictures in docs/images/recipe-cockpit/
developmentSupportScripts/recipe-cockpit-screenshots/ # Renders the real cockpit shell from the historyWorkspace fixture and writes the guide's pictures
jestSetup/                                   # Jest harness only — outside tsconfig rootDir, never packaged
├── CoreModuleIsolation.ts                   # Restores fs / fs.promises functions a test replaced
├── setupCoreModuleIsolation.ts              # setupFilesAfterEnv entry that registers the afterEach
└── tests/
src/
├── extension.ts                             # Extension entry point, command registration
└── treecipe/src/
    ├── tests/
    │   └── ServiceLayers.test.ts            # SERVICE_LAYERS, the one layer table (#570), and KNOWN_LAYER_VIOLATIONS, which only shrinks
    ├── CockpitKit/                          # What every cockpit shares (#524): palette, button kinds, org picker CSS, in-panel confirmation; imports only crypto
    │   └── tests/                           # Every kit piece appears verbatim and once in the Recipe Cockpit's document, so its suites cover the kit
    ├── CollectionsApiService/
    │   ├── CollectionsApiService.ts         # Formats fake data for Salesforce Collections API
    │   ├── ICollectionsApiJsonStructure.ts  # Interface for Collections API payload shape
    │   └── tests/
    ├── ConfigurationService/
    │   ├── ConfigurationService.ts          # Reads/writes treecipe.config.json
    │   └── tests/
    ├── DatasetInsertAttemptService/
    │   ├── DatasetInsertAttemptService.ts   # Each insert's insertAttemptSummary-<ts>.json (#469) and the data set row status read from it
    │   └── tests/
    ├── DatasetSourceService/
    │   ├── DatasetSourceService.ts          # A data set's BaseArtifactFiles/datasetSource.json: written, read, inferred; data set folder names
    │   └── tests/
    │       └── mocks/                       # A workspace with two recipe runs and data sets in every format: recorded, suffixed, null run, traversal name, malformed, legacy, legacy with two wrappers, no artifacts
    ├── DirectoryProcessingService/
    │   ├── DirectoryProcessor.ts            # Walks Salesforce objects/ directory, parses XML
    │   └── tests/
    │       └── mocks/                       # Sample Salesforce metadata XML fixtures
    ├── ErrorHandlingService/
    │   ├── ErrorHandlingService.ts          # try-catch wrappers, GitHub Issue template generation
    │   └── tests/
    ├── ExtensionCommandService/
    │   ├── ExtensionCommandService.ts       # VS Code command handler implementations
    │   └── tests/                           # GenerationCommands.golden.test.ts: both generation commands against golden/ (#571)
    │       ├── golden/                      # Every file Generate Treecipe and Run Faker write for the mock metadata, per backend; UPDATE_GOLDEN=1 rewrites
    │       └── mocks/                       # A pre-3.29.1 recipe per backend (bare record-type variants) and a recipe with an unrelated YAML error
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
    ├── RecipeCockpitService/
    │   ├── RecipeCockpitService.ts           # Owns the Recipe Cockpit webview panel: shell, model, message router and executor
    │   ├── RecipeCockpitPermissionSetAssign.ts # "Assign permission sets to me…" (#274): discover, plan and insert assignments; no vscode
    │   ├── RecipeCockpitPermissionSetGenerate.ts # "Generate permission set…" (#306): one tree's create/read permission set; no vscode
    │   ├── RecipeCockpitMetadataDeploy.ts    # Troubleshooting tab deploys (#346): what a tree holds, package.xml, CLI argv and answer; no vscode
    │   ├── RecipeCockpitMetadataDeployPackage.ts # Deploys without the CLI (#505): Metadata API zip and jsforce deploy; no vscode
    │   ├── RecipeCockpitTreeUpdaterQuery.ts  # Treecipe Adapter load (#416, #444): the plan and one SELECT per object; no vscode
    │   ├── RecipeCockpitOrgChangeDetection.ts # Treecipe Adapter's Retrieve latest metadata (#445, #447): staging folder and field comparison
    │   ├── RecipeCockpitAdaptedDataset.ts    # What a landed Adapter update leaves (#448): adapted data set and recipe; no vscode
    │   ├── RecipeCockpitRunArtifacts.ts      # Where a tree's run files live (#470): RunArtifacts folders and writers
    │   ├── RecipeCockpitDatasetJourney.ts    # A data set row's insert journey (#471)
    │   ├── RecipeCockpitRunHistory.ts        # Troubleshooting History (#485): step summaries written and listed
    │   ├── RecipeCockpitRecordUpdate.ts      # Treecipe Adapter update (#418) and restore snapshots (#419); no vscode
    │   ├── RecipeCockpitQuery.ts             # Query tab (#367): queries, query check, paging, preview, exports; no vscode
    │   ├── RecipeCockpitValidationRuleList.ts # Validation Rules sub-tab list (#327); no vscode
    │   ├── RecipeCockpitMetadataRetrieve.ts  # Troubleshooting retrieves (#326, #382): org listing, package.xml, CLI answer; no vscode
    │   ├── RecipeCockpitMetadataRetrievePackage.ts # Retrieves without the CLI (#506): jsforce retrieve, zip read, source-format write; no vscode
    │   ├── RecipeCockpitObjectSelection.ts   # Pure cascade of the Treecipe tab's tree icons (#219): what a card's direct exclusions auto-exclude, which lookups they disable; imports nothing
    │   ├── RecipeCockpitRecipeWriter.ts      # Pure line-level recipe patcher; imports nothing
    │   ├── RecipeCockpitFixedValueStore.ts   # The <recipe>.fixedValues.json file (#342); imports only SalesforceApiName and the writer
    │   ├── RecipeCockpitRemovedTodoStore.ts  # The <recipe>.removedTodos.json file (#391); imports only SalesforceApiName and the writer
    │   ├── RecipeCockpitConfirmContent.ts    # What an in-panel confirmation says (#457); imports nothing
    │   ├── RecipeCockpitInsertFailureTriage.ts # A failed insert's first error → its Troubleshooting sub-tab (#375); imports nothing
    │   ├── RecipeCockpitRecordCreation.ts    # Pure rules of the tree insert; imports nothing
    │   ├── RecipeCockpitTreeHistory.ts       # A tree card's Previously Used Data Sets
    │   └── tests/                            # RecipeCockpitPanelHarness.ts runs the real panel script against a fake DOM
    │       ├── acceptance/                   # Journeys (#577): the real host and panel on a temp fixture copy, read by role and name, never by class or id
    │       └── mocks/                        # Workspace fixtures, listed in DESIGN.md
    ├── RecipeFakerService.ts/               # DIRECTORY (not a file)
    │   ├── IRecipeFakerService.ts           # Interface both faker services implement
    │   ├── FakerJSRecipeFakerService/
    │   │   ├── FakerJSRecipeFakerService.ts # faker-js YAML recipe generation per field type
    │   │   ├── ProcessedYamlWrapper.ts
    │   │   └── tests/
    │   ├── SnowfakeryRecipeFakerService/
    │   │   ├── SnowfakeryRecipeFakerService.ts # Snowfakery YAML recipe generation per field type
    │   │   └── tests/
    │   ├── RecipeFieldConstraint/
    │   │   ├── RecipeFieldConstraint.ts     # A field's faker constraint (#323), used by #324's validation rules; imports nothing
    │   │   └── tests/                       # ConstrainedExpressionGeneration.test.ts: the contract both backends are held to
    │   └── RecipeYamlScalar/
    │       ├── RecipeYamlScalar.ts          # The YAML half of writing an untrusted picklist value: line breaks either parser sees, plain-vs-quoted list items
    │       └── tests/                   # PythonTestHarness.test.ts pins the gate below
    │           └── mocks/                   # HostilePicklistValues payloads and PythonTestHarness (PyYAML / Jinja runners, fail in CI, #158)
    ├── PicklistDependencyCheckService/
    │   ├── PicklistDependencyCheckService.ts # Deploys and runs picklist dependency tests on a @salesforce/core connection; runSalesforceCli, the one place an sf process starts
    │   └── tests/                            # SalesforceCliCallSites.test.ts: every remaining sf call site by file and method (#496), child_process importers, no direct jsforce import
    ├── PicklistDependencyExplorerService/
    │   ├── PicklistDependencyExplorerService.ts # Builds the Explorer structure view model and webview shell; retains the run overlay
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
    │   ├── SalesforceApiName.ts             # The one api-name rule every metadata NAME is held to before it reaches a recipe; imports nothing
    │   └── tests/
    │       └── mocks/
    ├── RecordTypeSelectionService/
    │   ├── SavedRecordTypeSelection.ts      # A record type selection saved in treecipe.config.json (#196); no vscode
    │   └── tests/
    ├── RecordTypeService/
    │   ├── RecordTypeService.ts             # Detects record types and related picklist options
    │   ├── RecordTypeSelection.ts           # The record types chosen per object (#193, #194); imports only RecordTypeWrapper
    │   ├── RecordTypesWrapper.ts
    │   └── tests/
    ├── RelationshipService/
    │   ├── RelationshipService.ts           # Builds the relationship hierarchy and tree recipes; faker-js nests under friends:
    │   ├── StandardFieldParentReferenceMap.ts # The parent of a well-known standard lookup/hierarchy field with no <referenceTo>, by Object.Field (Account.ParentId → Account, #400); imports nothing
    │   └── tests/
    │       └── mocks/
    ├── SalesforceOrgService/
    │   ├── SalesforceOrgService.ts           # Shared @salesforce/core connection, connected-org listing, describe cache, org type and default org reads
    │   └── tests/
    │       └── mocks/                        # Describe, authorization and ping fixtures, AuthInfo answers
    ├── SOQLTemplateService/
    │   ├── SOQLTemplateService.ts           # The soql-sosl-templates--<tree>-<ts>.md Generate Treecipe writes per tree, and the same queries as data (listTreeQueries, #367) for the Recipe Cockpit's Query tab
    │   └── tests/
    ├── ScratchOrgService/
    │   ├── ScratchOrgService.ts              # "+ New scratch org": plan, create argv or scratchOrgCreate, result files
    │   └── tests/
    │       └── mocks/                        # projectWorkspace/ (sfdx-project.json with two package directories, config/project-scratch-def.json) and the CLI's --json answers: create success, create limit reached
    ├── SfdxProjectService/
    │   ├── SfdxProjectService.ts             # sfdx-project.json parsing, workspace containment, tolerant packageDirectories resolution, and the strict every-package-directory read a deploy needs
    │   └── tests/
    ├── TreecipeSideBarService/
    │   ├── TreecipeSideBarService.ts         # The Activity Bar's Treecipe view (#456)
    │   └── tests/
    ├── ValidationRuleAnalyzerService/
    │   ├── ValidationRuleAnalyzerService.ts # Reads an active validation rule into one single-field constraint (#324); vscode-free
    │   └── tests/
    │       └── mocks/                       # #41's Opportunity rule files, one per shape plus an inactive and a multi-field rule
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

### Layers

**A folder under `src/treecipe/src` imports only its own layer or a lower one, never in a cycle** (epic #570). The layers run from 0 (leaf: imports no other service) through platform, metadata model, generation and insert, and features, to 5 (commands, `src/extension.ts`). Each folder's layer is `SERVICE_LAYERS` in `src/treecipe/src/tests/ServiceLayers.test.ts`, the only copy of the table. That test fails on an upward import, a folder-level cycle, a folder with no layer, a file outside any folder, and a `KNOWN_LAYER_VIOLATIONS` entry that no longer happens or is no longer a violation. The list holds today's violations, each with the slice that removes it (#572, #574, #575), and only shrinks. A new folder gets its layer in the same change. Shared code a lower layer needs moves down; it is not added to the list.

`ExtensionCommandService/tests/GenerationCommands.golden.test.ts` runs Generate Treecipe and Run Faker by Recipe and compares every file they write with `tests/golden/`. A move that claims "behaviour unchanged" passes it with no change to those files. `UPDATE_GOLDEN=1` rewrites them, and the PR then says what a user now gets differently.

### Key Design Decisions

The rules below hold for a change in ANY area. Each service's design notes, with the reasons and measurements behind them, are in a `DESIGN.md` beside it (see **Design notes** below): read the `DESIGN.md` of every service a change touches before changing it, and put a new design note there, never here.

#### Recipe generation

- **`RecipeFakerService.ts` is a directory** — it contains both faker implementations as subfolders; this naming is intentional and must not be changed
- **Both faker backends must stay in sync** — whenever a new field type handler is added to `FakerJSRecipeFakerService`, add the equivalent to `SnowfakeryRecipeFakerService`
- **Numeric/currency precision** — `<precision>` (total digits) and `<scale>` (decimal places) from XML drive `max` and `dec` parameters; `left_digits = precision - scale`
- **Picklist handling** — special characters (`&`, `'`, etc.) in picklist values must be escaped before embedding in faker expressions
- **Relationship grouping** — `RelationshipService` determines which objects belong in the same Treecipe file and in what insertion order
- **Every picklist value reaches a recipe through its backend's escaper, never raw** — `escapePicklistValueForJavaScriptString` (faker-js), `escapePicklistValueForJinjaStringLiteral` (snowfakery), the YAML half in `RecipeYamlScalar` (PyYAML also breaks at U+0085, U+2028, U+2029). Snowfakery renders BOTH `${{ … }}` and the legacy, unsandboxed `<< … >>`. A new sink must be added to `buildRecipeWithEveryPicklistSink` and the hostile pipeline suites. `RecipeService/DESIGN.md`
- **A metadata NAME reaches a recipe only if it IS a Salesforce api name** (`SalesforceApiName`, imports nothing) — one guard per name: `appendFieldRecipeToObjectRecipe` for field keys, `partitionRecordTypesByWritableDeveloperName` for record types, `getDependentPicklistRecipeFakerValue` for controlling fields, `ObjectInfoWrapper.addKeyToObjectInfoMap` for objects. A refused name is one escaped `### TODO -- … SKIPPED` comment. `RecipeService/DESIGN.md`
- **Workspace text shown in a VS Code notification or input-box message goes through `escapeForNotification`** — it renders `[label](command:…)` as a link that RUNS the command. `ErrorHandlingService.handleGenericError` escapes centrally.
- **A map keyed by picklist values, or by any name from a workspace file, has no prototype** — `Object.create(null)` and an own-key check, never `in` or a `{}` map (`__proto__`, `constructor`). `RecipeService/DESIGN.md`, `RecipeCockpitService/DESIGN.md`
- **Generated output is deterministic** — sort with `<`, never `localeCompare`, and once where data is loaded, so a recipe never depends on the machine. `RecipeService/DESIGN.md`
- **Record types and validation rules are applied in `RecipeService`, never in a backend**, so neither backend has a second path to keep in sync. `RecipeService/DESIGN.md`, `RelationshipService/DESIGN.md`
- **Every line generation emits must load as YAML in both backends** — `DirectoryProcessor.generatedRecipeYaml.test.ts` loads every file the real pipeline writes.
- **A workspace without a feature's input writes byte-identical output** — new optional data is set only when present.

#### Recipe Cockpit, every cockpit after it, and every webview

- **Behind `recipeCockpitEnabled`, gated in the command handler**, not by a `when` clause. Every other door (status bar, Activity Bar view) runs the palette command id with no arguments.
- **The shell builder takes a nonce and nothing else** (the Picklist Dependency Explorer's too), `localResourceRoots: []`, CSP admits only the nonced style and script, no external file or URL. Every value reaches the panel by `postMessage` and is written with `textContent`; glyphs are built with `createElementNS`. A link out is a message to the host, never an `href`.
- **Every panel action is matched against a pending/active allow-list built from the RENDERED model** — pending at post, active only on the panel's `rendered` echoing that `renderSequence`, emptied on `ready`, a new post and a failure to draw. The panel posts names and indexes, never a path, org, username or value it could choose. `routePanelMessage` is pure and returns an action.
- **Every path the host opens or writes passes `SfdxProjectService.isPathContainedInWorkspace`** when the model is built AND when it is used; no link is followed; new files are written `wx`.
- **Workspace and org text is untrusted** — every file and every answer from an org or the CLI is type-checked field by field, size-capped, and parsed with no prototype.
- **An org write reaches only a sandbox or scratch org** — the Organization row must answer `IsSandbox: true`, asked again on the connection that writes, after the confirmation. Insert Data Set by Directory's looser Developer Edition rule is deliberate.
- **Confirmations are asked in the panel (`confirmInPanel`), and the host plans and checks every guard again after the answer.** The palette commands keep VS Code's modal.
- **A run's outcome is one notification**, its file the notification's button, never a line in the panel. Run locks are per window and replayed to a reopened panel.
- **A recipe is written by patching lines (`RecipeCockpitRecipeWriter`, imports nothing), never by a YAML round trip**; every untouched line stays byte-identical.
- **Every colour comes from the one `--sdt-*` palette; every button from `createButton(kind, …)`; every list row from one of the three row types (`/cockpit-row-style`)**; a new text/background pair goes into the contrast test.
- **The ? help and `docs/RECIPE-COCKPIT-GUIDE.md` say the same thing** (`/cockpit-help-sync`).

The cockpit's design notes, grouped by tab and concern, are `src/treecipe/src/RecipeCockpitService/DESIGN.md`.

#### Orgs and the Salesforce CLI

- **Org work goes through `SalesforceOrgService.getConnection`; never `import` `jsforce`** (a devDependency only). Every remaining `sf` call is listed in `PicklistDependencyCheckService/tests/SalesforceCliCallSites.test.ts`; a new one needs a reason in its issue and its entry there. An access token is never written, logged, posted to a webview or quoted in a notification, and a browser opens an org only through a one-time `singleaccess` frontdoor address, never `frontdoor.jsp?sid=`. `PicklistDependencyCheckService/DESIGN.md`, `RecipeCockpitService/DESIGN.md`
- **Every org picker lists only authorizations that answer a ping, and fails closed.** `SalesforceOrgService/DESIGN.md`
- **A CLI call with a `cwd` runs the absolute `sf` from `findSalesforceCliOnPath` (project mode)** — a repository can plant `sf.cmd` in its own folder. `ScratchOrgService/DESIGN.md`
- **Nothing builds an `sf org delete` argv.**

#### Picklist dependencies

- **Apex written into a user's project is `SDT`-prefixed** — every class in `apexPicklistDependencyFramework/SDTPicklistDependencyFramework/` (the framework source shipped in the .vsix and scaffolded into the user's package directory), and every class the generator emits, starts with `SDT` so it cannot collide with the user's own Apex. Keep new Apex consistent with this
- **The spec manifest is the single source for the Explorer**, and anything spanning a run is keyed by object AND field (`buildFieldKey`). `PicklistDependencyManifestService/DESIGN.md`, `PicklistDependencyMetadataWriterService/DESIGN.md`, `PicklistDependencyExplorerService/DESIGN.md`, `PicklistDependencyCheckService/DESIGN.md`

#### Workspace, configuration and tests

- **`treecipe.config.json` and `.vscode/settings.json` arrive with a cloned repository** — `salesforceObjectsPath` is resolved only by `ConfigurationService.resolveObjectsDirectoryPath`, and `treecipeConfigurationPath` only by `resolveTreecipeConfigurationFilePath`. `ConfigurationService/DESIGN.md`, `SfdxProjectService/DESIGN.md`
- **A workspace-scoped config write can reject** — `setExtensionConfigValue` returns whether it landed. `VSCodeWorkspace/DESIGN.md`
- **A test replaces a Node core module function only through `jest.spyOn`** (see Testing Requirements). `jestSetup/DESIGN.md`

#### Design notes

| Area | Read before changing it |
|---|---|
| Jest harness | [`jestSetup/DESIGN.md`](jestSetup/DESIGN.md) |
| Cockpit kit | [`src/treecipe/src/CockpitKit/DESIGN.md`](src/treecipe/src/CockpitKit/DESIGN.md) |
| Collections API insert | [`src/treecipe/src/CollectionsApiService/DESIGN.md`](src/treecipe/src/CollectionsApiService/DESIGN.md) |
| Configuration service | [`src/treecipe/src/ConfigurationService/DESIGN.md`](src/treecipe/src/ConfigurationService/DESIGN.md) |
| Data set insert attempts | [`src/treecipe/src/DatasetInsertAttemptService/DESIGN.md`](src/treecipe/src/DatasetInsertAttemptService/DESIGN.md) |
| Data set source records | [`src/treecipe/src/DatasetSourceService/DESIGN.md`](src/treecipe/src/DatasetSourceService/DESIGN.md) |
| Directory processing | [`src/treecipe/src/DirectoryProcessingService/DESIGN.md`](src/treecipe/src/DirectoryProcessingService/DESIGN.md) |
| Extension commands | [`src/treecipe/src/ExtensionCommandService/DESIGN.md`](src/treecipe/src/ExtensionCommandService/DESIGN.md) |
| Picklist dependency check and org access | [`src/treecipe/src/PicklistDependencyCheckService/DESIGN.md`](src/treecipe/src/PicklistDependencyCheckService/DESIGN.md) |
| Picklist Dependency Explorer | [`src/treecipe/src/PicklistDependencyExplorerService/DESIGN.md`](src/treecipe/src/PicklistDependencyExplorerService/DESIGN.md) |
| Picklist dependency spec manifest | [`src/treecipe/src/PicklistDependencyManifestService/DESIGN.md`](src/treecipe/src/PicklistDependencyManifestService/DESIGN.md) |
| Picklist dependency writeback | [`src/treecipe/src/PicklistDependencyMetadataWriterService/DESIGN.md`](src/treecipe/src/PicklistDependencyMetadataWriterService/DESIGN.md) |
| Recipe Cockpit | [`src/treecipe/src/RecipeCockpitService/DESIGN.md`](src/treecipe/src/RecipeCockpitService/DESIGN.md) |
| Faker services | [`src/treecipe/src/RecipeFakerService.ts/DESIGN.md`](src/treecipe/src/RecipeFakerService.ts/DESIGN.md) |
| Recipe generation | [`src/treecipe/src/RecipeService/DESIGN.md`](src/treecipe/src/RecipeService/DESIGN.md) |
| Saved record type selections | [`src/treecipe/src/RecordTypeSelectionService/DESIGN.md`](src/treecipe/src/RecordTypeSelectionService/DESIGN.md) |
| Record types | [`src/treecipe/src/RecordTypeService/DESIGN.md`](src/treecipe/src/RecordTypeService/DESIGN.md) |
| Relationship trees | [`src/treecipe/src/RelationshipService/DESIGN.md`](src/treecipe/src/RelationshipService/DESIGN.md) |
| Salesforce org service | [`src/treecipe/src/SalesforceOrgService/DESIGN.md`](src/treecipe/src/SalesforceOrgService/DESIGN.md) |
| Scratch org service | [`src/treecipe/src/ScratchOrgService/DESIGN.md`](src/treecipe/src/ScratchOrgService/DESIGN.md) |
| sfdx project service | [`src/treecipe/src/SfdxProjectService/DESIGN.md`](src/treecipe/src/SfdxProjectService/DESIGN.md) |
| Activity Bar Treecipe view | [`src/treecipe/src/TreecipeSideBarService/DESIGN.md`](src/treecipe/src/TreecipeSideBarService/DESIGN.md) |
| VS Code workspace services | [`src/treecipe/src/VSCodeWorkspace/DESIGN.md`](src/treecipe/src/VSCodeWorkspace/DESIGN.md) |
| Validation rule analyzer | [`src/treecipe/src/ValidationRuleAnalyzerService/DESIGN.md`](src/treecipe/src/ValidationRuleAnalyzerService/DESIGN.md) |

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
| `treecipe.openRecipeCockpit` | Open Recipe Cockpit |

---

## Implementation Checklist

When implementing a new feature or fixing a bug:

- [ ] Start with `/next-task <N>`: a hook (`.claude/hooks/flowGuard.js`) keeps `src/` read-only until the person replies `approve plan #<N>`, and refuses `git push` or a PR until `node .claude/hooks/prFlowPhase1.js` (`/pr-flow` Phase 1) has passed on HEAD
- [ ] Read the relevant service file(s), and the `DESIGN.md` beside each, before making changes
- [ ] Put a new design note in that service's `DESIGN.md`, not here: `CLAUDE.md` stays under 100 KB (`/docs-check`)
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
