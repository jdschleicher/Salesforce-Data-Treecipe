# Change Log

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
