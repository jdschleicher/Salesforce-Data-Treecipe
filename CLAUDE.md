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

### Code Style Mandates

- **TypeScript strict** - No implicit `any`; always define types/interfaces
- **Class-based services** - Each service is a `class` with `static` methods; no standalone functions scattered outside a class
- **Interface-first for faker services** - Both faker backends implement `IRecipeFakerService` and `IFakerRecipeProcessor`
- **No hard-coded Salesforce field values** - All field type mappings must be driven by the XML `<type>` value
- **Naming conventions** - PascalCase for classes/interfaces, camelCase for methods/variables; service files match their class name
- **No comments for self-evident code** - Only add comments where the logic is non-obvious

## Project Structure

```
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
    │   ├── PicklistDependencyExplorerService.ts # Builds the explorer view model (from the spec manifest, or an explicit metadata preview) and the webview html shell
    │   └── tests/
    │       └── mocks/
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
- **The Explorer bounds what it renders, and never re-labels what it drops** — an object's rows are built on first expand, and `applyModelLimits` caps five axes plus one TOTAL budget (`maxRenderedCombinations`). The total is the part that bounds the payload: the per-axis caps only shape the panel, and their product is millions of rows. Bounding it took three axes, not one — combinations, dependent picklists per object, and `declaredValues`, which grows with a field's picklist rather than with how many combinations survive and was the dominant term once the others were capped. A failing row is never dropped in favour of a passing one; past the total budget even a failure can be dropped, and that case is counted separately and points at `report.md` as the complete record. A dropped row is ABSENT and counted in a notice, never rendered as something it was not. Filtering works the same way: it hides, and recomputes no status. The three-state guarantee holds under both. Whenever a cap is added or changed, RE-MEASURE — the numbers in CHANGELOG 3.7.0 come from serializing synthetic models through the real builder, and two earlier drafts of this ceiling were chosen by reasoning and were wrong by 5-13x
- **A complement is only ever drawn against a COMPLETE universe** — where `maxDeclaredValuesPerNode` capped a field's declared values, the panel stops rendering "must not unlock" and says why. A complement of a partial universe understates what the spec forbids, which is a false claim rather than a shorter one
- **A failure is explained alongside its Apex kind, never instead of it** — `buildFailureTriage` maps every `SDTPicklistDependencyValidator.FailureKind` to a likely cause and a next step. A kind with no entry gets a default that SAYS it has none; inventing an explanation for an unrecognised failure is the one thing the panel must not do. The prose lives ONCE per kind in the model's `failureTriageByKind` and is looked up by kind in the panel — only an unrecognised kind carries it inline, because that text names the kind
- **Every panel action is gated by its own allow-list built from the rendered model** — reveal, open-spec-method, open-run-report and copy-reference each check the posted value against what the model NAMES rather than validating it as a path. The spec and report lists key on the file AND the method together, so a legitimate file cannot be paired with a method name of the sender's choosing
- **An allow-list is only as trustworthy as the text it was built from** — `manifest.json` is on disk and a hand edit controls it, and `loadManifest` accepts its paths as bare strings. Any manifest path that becomes something the extension host OPENS must go through `resolveOpenableManifestFilePath` first (`generatedClassFilePath`, `classesDirectoryPath`), the same containment `resolveRenderableObjectsDirectoryPath` applies to the objects directory. Out-of-workspace resolves to EMPTY, which renders no button and contributes no allow-list entry. Adding a new openable manifest field without this is how "the model named it" stops being a safety property
- **The explorer panel is a webview, and no metadata reaches its document at all** — picklist values, api names and Apex failure messages all originate in metadata the extension does not control, so none of them is interpolated into html. `buildWebviewShellHtml` takes a nonce and nothing else; the model is posted with `postMessage` and every node is written through `createElement`/`textContent`. That is why the escaping that used to guard this (`escapeHtml`, `escapeJsonForScriptBlock`) is gone rather than unused — there is no markup context left for a value to escape out of, and re-introducing one by interpolating a model value into the shell would quietly remove the guarantee. Its CSP admits only the extension's own nonced inline style and script, and the `Reveal in Explorer` handler opens a path only when the built view model itself named it
- **The panel opens before the load and reports each phase; only what the structure does not depend on runs after the paint** — the shell is static, so it is shown immediately and names its phase in a banner and a status bar item. Reporting a phase is worth nothing without YIELDING: VS Code batches webview posts and status bar writes and flushes them at the end of the event-loop turn, so a load that never awaits narrates nothing however many phases it reports — `yieldToExtensionHost` between phases is what makes the reporting real, and it is also what lets the panel's `ready` be received mid-load. Every host message is stored and posted only once the panel is ready, which keeps the protocol idempotent: posting eagerly AND replaying on the handshake renders the whole model twice. The freshness stat walk moved after the first paint because it produces a caveat *about* the structure, and until it answers the model carries `pendingCheck`, which is neither fresh nor stale. It is ~5% of the open, not the dominant phase — the manifest parse is. The run overlay deliberately did NOT move: it was measured at 17 ms of a two-second open, and `applyModelLimits` can only keep a failing combination over a passing one if statuses are already applied. Before a model is rendered, every panel action allow-list is EMPTY — the panel now exists in a window where nothing is on screen for an action to have come from
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
