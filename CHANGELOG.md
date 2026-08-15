# Change Log

## [2.12.0] - Generate Picklist Dependency Tests Command

Resolves [#61](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/61). Part of epic [#62](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/62). Builds on the framework from [#60](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/60) below.

### Features

- New command **Generate Picklist Dependency Tests** (`treecipe.generatePicklistDependencyTests`) — walks the configured `salesforceObjectsPath` and emits `PicklistDependencySpecs.cls` with one `PicklistDependencySpec` per field carrying a `controllingField`, replacing the hand-written registry that drifted from source metadata the moment it was written
- `PicklistDependencyTestService` — collects spec details from parsed field XML and serializes them to Apex targeting the `forField` / `controlledBy` / `expectAtLeast` / `expectNone` fluent API
- Generated lines always use `expectAtLeast`, so source combinations must still exist while org-added values are tolerated; `expectExactly` is never emitted and a line tightened to it will not survive regeneration
- A controlling value that unlocks nothing is emitted as `expectNone`. Recovering those requires the controlling field's own value set — a value with no `valueSettings` entry is absent from the dependency map entirely — so the controlling field's XML is read alongside the dependent field's. When the controlling field cannot be resolved locally (global value set, standard value set, or defined outside the parsed directory) only the values `valueSettings` actually names are asserted: a narrower contract, never a wrong one
- A `valueSettings` entry naming a controlling value the controlling field no longer declares is still asserted rather than dropped — that is precisely where drift lives
- Every emitted spec carries `.controlledBy(...)` so the framework's `CONTROLLING_FIELD_MISMATCH` check stays active
- Output is deterministic — objects, fields, and expectations are ordered (expectations follow the controlling field's own value set order), so regenerating against unchanged metadata produces a byte-identical file and a clean diff

### Distribution

- The published `.vsix` excludes `force-app/**`, so an extension user had none of the framework classes a generated specs file compiles against. The six runtime framework classes are now bundled as extension assets under `resources/apex/` and copied into the resolved package directory alongside the generated file when missing — existing files are never overwritten, so a customized framework class survives regeneration
- `StubPicklistDependencySource` is deliberately not bundled: it exists only for the framework's own Apex tests and should never be scaffolded into a user's org
- `resources/apex/` mirrors `force-app/main/default/classes/`, which remains the source of truth. A test asserts each bundled copy is byte-identical to its counterpart, so drift fails the suite instead of shipping a stale framework

### Refactors

- `RecipeService.buildControllingValueToPicklistOptions` extracted from `getDependentPicklistRecipeFakerValue` and now shared by recipe generation and Apex spec emission. It takes no record-type parameter: `valueSettings` maps a controlling value to its dependent values irrespective of record type, and record types govern which picklist values are *available*, not which controlling value unlocks which dependent value
- `ConfigurationService` gained `sfdx-project.json` resolution — package directory (single entry or the one marked `default`; prompts only when several exist and none is default), `sourceApiVersion` for the generated `-meta.xml`, and Apex classes directory resolution that prefers a `classes` directory the project already has

### Unhappy paths

- No `sfdx-project.json`, or a project declaring no `packageDirectories` → actionable error naming the expected path; nothing is written
- A field with a `controllingField` but no `valueSettings` markup → warning naming the object and field; the run continues and the remaining fields are still emitted
- Zero dependent picklists found → informational message, no file written
- An existing `PicklistDependencySpecs.cls` → modal confirmation before overwrite, warning that lines tightened to `expectExactly` will be lost
- Dismissing the package directory prompt → nothing is written

### Tests

- New `PicklistDependencyTestService` suite covering collection, expectation ordering, `expectNone`, the unresolvable-controlling-field fallback, the skipped-field warning, deterministic regeneration, Apex escaping, bundled asset presence and byte-identity, and scaffolding (copies missing, never overwrites)
- Apex string literals are escaped for both `'` and `\` — the backslash is escaped first so the quote escape is not itself doubled. Fixtures cover a controlling value of `O'Brien`, a value of `Back\Slash`, and a dependent value of `Value's One`
- `ConfigurationService` tests cover every `sfdx-project.json` resolution path including the prompt and its dismissal; `RecipeService` tests assert the extracted map builder directly
- Existing FakerJS and Snowfakery dependent-picklist tests pass unchanged, which is the regression guard for the `RecipeService` extraction
- The one-spec-per-`(object, field)` invariant is pinned by test: the Apex validator calls `fetch()` once per spec and iterates that spec's expectations against the single snapshot it holds, which is the basis on which snapshot memoization was declined in [#65](https://github.com/jdschleicher/Salesforce-Data-Treecipe/pull/65). Nothing in the Apex registry or validator merges duplicate entries, so this generator is where the assumption has to hold. Mutation verified — emitting one spec per expectation instead fails 7 tests
- Suite grew from 355 to 406 tests; coverage improved on every metric (lines 83.23% → 84.12%, branches 78.45% → 79.51%, functions 85.03% → 86.09%)

### Notes

- No faker backend change: this consumes parsed metadata upstream of `IRecipeFakerService`, so neither `FakerJSRecipeFakerService` nor `SnowfakeryRecipeFakerService` gains a handler
- Specs remain field-level and not record-type scoped, consistent with the framework's `PicklistDependencySpec` API
- Generation reads local source metadata only — org-connected describe stays Recipe Cockpit territory ([#55](https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues/55))

---

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
