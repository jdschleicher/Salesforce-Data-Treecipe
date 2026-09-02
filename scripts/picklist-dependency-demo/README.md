# Picklist Dependency Contract Testing — End-to-End Guide

How to exercise Treecipe's picklist dependency testing from nothing to a proven, failing-on-drift
check, against a real scratch org.

> **Repo tooling, not shipped.** This folder is excluded from the `.vsix` via `.vscodeignore`. It
> exists to test and demonstrate the feature, not to reach extension users.

> **Diagrams:** [`PICKLIST-DEPENDENCY-FLOW.md`](./PICKLIST-DEPENDENCY-FLOW.md) draws the same flow as
> mermaid — the contract loop, the step machine, both command sequences, the deployment set, and how
> drift is caught.

---

> Looking at these classes from inside a Salesforce org rather than running the harness? The
> [in-org guide](../../docs/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md) covers reading the deployed classes,
> running the tests from Setup, and fixing a failure.

## What this proves

Treecipe already knows every dependent picklist's controlling-value → allowed-values map — it builds
one to drive recipe generation. That knowledge used to die at YAML-write time. Nothing noticed when
an admin later rewired a dependency in the org, and the failure surfaced as a confusing Collections
API error at data-load time instead of a clear "that combination no longer exists".

The feature turns that map into an **executable contract**: source metadata says `City = cle` unlocks
`ohiocity` and `tremont`; a generated Apex test asks the org whether that is still true.

**A check that only ever passes proves nothing.** The walkthrough below deliberately breaks the
dependency in the org and confirms the check catches it, names it, and exits non-zero.

---

## Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Salesforce CLI | `sf --version` | Provides `sf org create scratch`, `project deploy start`, `apex run test` |
| Authorized Dev Hub | `sf org list` | `sf org login web --set-default-dev-hub` if absent |
| Node.js | `node --version` | Runs the headless driver |
| PowerShell 7+ | `pwsh --version` | Cross-platform — macOS and Linux included |
| Compiled output | `ls out/` | `npm run compile`; the script does this for you if missing |

The `Preflight` step verifies every one of these and stops with an actionable message rather than
failing halfway through.

---

## The fast path

```powershell
cd scripts/picklist-dependency-demo

# the whole thing in one invocation: stand it up, prove it passes,
# prove both drift paths fail, put the org back
./Invoke-PicklistDependencyDemo.ps1 -Step FullRun

# same run, pausing so you can read the generated contract and each drift report
./Invoke-PicklistDependencyDemo.ps1 -Step FullRun -Interactive

# ask the org what it actually believes each dependency is
./Invoke-PicklistDependencyDemo.ps1 -Step Verify

# when you are finished
./Invoke-PicklistDependencyDemo.ps1 -Step Teardown
```

Individual steps still run on their own — `-Step Check`, `-Step Drift`, `-Step Restore` and the rest
are unchanged. `FullRun` chains them in the order a verification run actually needs.

**From VS Code:** `Cmd/Ctrl+Shift+P` → **Run Task** → any of the `PICKLIST:` tasks. They prompt for
the scratch org alias and Dev Hub, then call this script.

On macOS or Linux, `pwsh ./Invoke-PicklistDependencyDemo.ps1` if the script is not marked executable.

---

## What each step does

| Step | Action | Expected |
|---|---|---|
| `Preflight` | Verifies CLI, Dev Hub, node, compiled output | all green |
| `Scaffold` | Generates the staging DX project (`demoSalesforceProject/` with an on-the-fly `sfdx-project.json`), copies in the framework classes from `apexPicklistDependencyFramework/`, then writes the scratch definition, the `Planets` global value set, and a three-tier sample dependent picklist | files on disk |
| `CreateOrg` | **Deletes** a live org carrying the same alias, then creates a fresh one | org created |
| `Deploy` | Deploys the **global value set** and the sample **object** plus the six framework classes | 8+ components |
| `Generate` | Builds `SDTPLDSpecs.cls`, `SDTPLDSpecs_Treecipe_Demo_c.cls` and `SDTPLDSpecsTest.cls` from **local** metadata | 3 specs, 1 object |
| `Check` | Deploys all nine owned classes, runs the tests, writes artifacts | **PASS** |
| `Verify` | Reads the live controlling-value map out of the org through `SDTSchemaPicklistDependencySource` | printed map |
| `Drift` | Two phases, both **org only**: rewires `mars` on the global-value-set field, then also rewires `tremont` on the controlling field | **FAIL** twice |
| `Restore` | **Rejects** the drift — rewires the org back, re-runs | **PASS** |
| `Accept` | **Accepts** the drift — retrieves it into local source, regenerates the contract, redeploys, re-runs | **PASS** |
| `Teardown` | Deletes the scratch org | org deleted |
| `FullRun` | The whole lifecycle: stand up → pass → drift → fail → regenerate → pass | **PASS**, **FAIL**, **FAIL**, **PASS** |

`All` runs `Preflight` through `Check` and stops. `FullRun` runs the complete contract lifecycle.
`Drift`, `Restore`, `Accept` and `Teardown` remain opt-in individually because they mutate or destroy
the org.

### Drift has two legitimate endings

Detecting drift is half the loop. What you do next depends on who was right:

| | `Restore` | `Accept` |
|---|---|---|
| Assumes | the org change was a mistake | the org change was intentional |
| Acts on | the org — rewires it back | local source — retrieves the org state in |
| Then | re-runs, expecting PASS | regenerates the contract, redeploys, re-runs, expecting PASS |
| Ends with | the original contract, everywhere | an updated contract that matches the new reality |

**`Accept` retrieves before it regenerates, and the order is the entire point.** Generation reads
*local* metadata, and `Drift` deliberately leaves local source asserting the original contract. So
regenerating on its own produces a byte-identical contract and the check fails again for exactly the
same reason. Local has to learn what the org says first.

`Accept` guards against that: it fingerprints the generated classes before and after, and refuses to
re-run if regeneration changed nothing. And it passes for the right reason — accepting the `mars`
rewire produces a contract that *forbids* `mars` on `ohiocity` and requires it on `willowick`, rather
than one that quietly stopped asserting anything:

```apex
.expectAtLeast('ohiocity', new List<String>{ 'earth' })
.expectNotAllowed('ohiocity', new List<String>{ 'venus', 'mars', 'saturn' })
.expectAtLeast('willowick', new List<String>{ 'mars', 'saturn' })
```

After `Accept`, local source carries the org's values. `-Step Scaffold` followed by `-Step Deploy`
resets both back to the documented sample.

### Every run starts from a new org

`CreateOrg` replaces a live scratch org carrying the same alias rather than reusing it. The run is a
clean-room verification and a reused org is not one: it still holds the previous run's drift, its
deployed classes and its source-tracking history, so a green result proves the feature works *there*
rather than from nothing. Reuse is also what produced this harness's source-conflict failures.

Deleting is scoped to a scratch org matching this script's own alias, and only after that alias was
matched against the Dev Hub's scratch org list — never a sandbox or production.

Pass `-ReuseExistingOrg` to keep the existing org, which is what you want while iterating on a single
step against an org you already stood up. The individual steps — `Check`, `Verify`, `Drift`,
`Restore`, `Accept` — never create or delete anything, so they always target the org you have.

### `-Interactive`: where the script stops and asks you to look

Three points in the run cannot be graded by an assertion, so `-Interactive` pauses at each and prints
the path to open. It is off by default: a blocked `Read-Host` in CI is a hung job, not a checkpoint.

| After | What to open | What you are judging |
|---|---|---|
| `Generate` | the generated per-object spec classes | did it capture every dependent picklist, and capture them correctly |
| `Drift` phase 1 | the newest `report.md` | does the failure name the right field, controlling value and kind |
| `Drift` phase 2 | the newest `report.md` | is the break reported once at its source, not once per link |

One judgement is deliberately **not** a pause, because the script cannot prompt for what it does not
know to ask: whether the sample metadata still covers what you changed. When a release adds a new
dependent-picklist shape, the scaffold has to grow to match it, or a fully green run proves only that
the old shapes still work.

### `-Step Verify`: what the org actually believes

The most useful question when a run surprises you, and the one a deploy result cannot answer. It
reads the live map through the same source the check uses:

```
+ Treecipe_Demo__c.Planet__c
    ohiocity => earth, mars
    tremont => venus
    willowick => saturn
```

### The drift guard

`Drift` calls `Verify` internally, before and after its own deploy, and refuses to continue unless
the org genuinely moved:

```
x the drift deploy reported success but Treecipe_Demo__c.Planet__c is UNCHANGED in the org.
  Salesforce merges valueSettings: an entry omitted from the payload is not removed.
  Rewire an entry that is still present instead of leaving one out.
x refusing to run the check against an org that never drifted -- it would report a meaningless PASS.
```

This exits `1`. It exists because the original drift lever was a silent no-op for exactly this
reason, and the run it produced was indistinguishable from a healthy one — a green `PASS` from a step
built to go red.

### Do the framework classes have to come first?

**For generation, no.** The "Generate Picklist Dependency Tests" command *scaffolds* the framework
into your package directory as part of generating, so the framework, the spec registry and the test
class all land together. Generation only writes files — it never reads the framework.

**For deployment, they must arrive together — but not in a separate earlier deploy.** The generated
classes do not compile without the framework, and Salesforce compiles a deployment set as one unit.
So the extension sends them all in a single transaction, and this script does the same. Deploying
only the generated classes to a fresh org fails with `Invalid type: SDTPicklistDependencySpec`.

### Where the classes land

```
<packageDir>/main/default/classes/
  SDTPicklistDependencyFramework/          <- scaffolded, six files you did not write
    ISDTPicklistDependencySource.cls
    SDTPicklistDependencySpec.cls
    SDTPicklistDependencySnapshot.cls
    SDTPicklistDependencyReport.cls
    SDTPicklistDependencyValidator.cls
    SDTSchemaPicklistDependencySource.cls
  SDTPLDSpecs.cls                    <- generated aggregator
  SDTPLDSpecs_Treecipe_Demo_c.cls    <- generated contract, yours to read and tighten
  SDTPLDSpecsTest.cls                <- generated assertions
```

Salesforce resolves `ApexClass` by the enclosing `classes` directory and walks nested folders, so the
subdirectory deploys identically to a flat layout. The split is for humans: the framework is
replaceable boilerplate you can delete in one action, while the two generated files are the contract
you actually engage with.

A workspace generated by an earlier version has the framework loose at the classes root. Both layouts
keep working — the scaffolder skips a class present in either location, and the deploy resolves each
class from one path only, since Salesforce rejects the same `ApexClass` twice in one deployment.

`-Step Deploy` is still required, but for the **sample object and its global value set**: the Apex
test resolves `Treecipe_Demo__c.Neighborhood__c` through Schema describe, so the fields must exist in
the org or every method fails with `LOOKUP_ERROR`.

### The sample dependency

Three tiers, so the walkthrough covers every shape the generator has to handle rather than only the
simplest one.

```
City__c (plain)        Neighborhood__c (dependent)     Dressing__c  (dependent, local values)
  cle        ────────►   ohiocity, tremont               ohiocity ──► ranch, french
  eastlake   ────────►   willowick                       tremont  ──► blue cheese
  akron      ────────►   (nothing) ← expectNone          willowick──► (nothing) ← expectNone

                         Neighborhood__c also controls   Planet__c (dependent, GLOBAL value set)
                                                          ohiocity ──► earth, mars
                                                          tremont  ──► venus
                                                          willowick──► saturn
```

Why each tier is there:

| Tier | Field | Proves |
|---|---|---|
| 1 | `City__c` | a plain controlling picklist |
| 2 | `Neighborhood__c` | a dependent picklist with a local `valueSetDefinition` |
| 3 | `Dressing__c` | a **chained** dependency — its controlling field is itself dependent, so the spec emits `dependsOn`. `blue cheese` carries a space, so the generated literal has to be quoted correctly |
| 3 | `Planet__c` | a dependent picklist whose values come from a **global value set** (`Planets`). It has no local `valueSetDefinition` at all — only `controllingField` and `valueSettings` — which is precisely the shape that used to parse as *not dependent* and produce no spec |

`Planets` is a real `GlobalValueSet` under the staging project's `force-app/main/default/globalValueSets/`, and it must be
in the same deployment as the object: `Planet__c` references it by name, so an object-only deploy
fails against a fresh org.

Which generates, for the global-value-set field:

```apex
SDTPicklistDependencySpec.forField('Treecipe_Demo__c', 'Planet__c')
    .controlledBy('Neighborhood__c')
    .dependsOn(specFor_Treecipe_Demo_c_Neighborhood_c())
    .expectAtLeast('ohiocity', new List<String>{ 'earth', 'mars' })
    .expectNotAllowed('ohiocity', new List<String>{ 'venus', 'saturn' })
    .expectAtLeast('tremont', new List<String>{ 'venus' })
    .expectNotAllowed('tremont', new List<String>{ 'earth', 'mars', 'saturn' })
    .expectAtLeast('willowick', new List<String>{ 'saturn' })
    .expectNotAllowed('willowick', new List<String>{ 'earth', 'mars', 'venus' });
```

`expectAtLeast` is what the generator always emits: combinations in source must still exist, while
values the org has *added* since are tolerated. Tightening a line to `expectExactly` is a deliberate
hand edit — and is lost on regeneration, which the generated file header states plainly.

---

## The Drift step, in detail

This is the step worth understanding, because it is the only one that proves the feature works.

It runs in **two phases**, and each ends with the local file back at the original contract, so source
and org genuinely disagree while the specs are never regenerated. Regenerating would rewrite the
contract to match the drift and hide exactly the problem the check exists to find.

### Why it rewires rather than deletes

The obvious way to break a dependency is to drop a `valueSettings` entry from the payload. **That
does not work, and it fails silently.** Salesforce *merges* `valueSettings` on a `CustomField`
deploy: an entry left out is not removed from the org, the deploy still returns `Succeeded`, and the
check then correctly reports PASS against an org that never changed. A drift lever built that way
proves nothing while looking like it passed.

Moving an entry that is still present *is* applied. So each phase rewires a value from one
controlling value to another — which is also what an admin actually does in Setup, and is the
stronger assertion: the old controlling value loses the value (`MISSING_VALUES`) and the new one
gains it (`FORBIDDEN_VALUES_PRESENT`), exercising `expectAtLeast` and the `expectNotAllowed`
complement in one step.

### Phase 1 — the global-value-set field, on its own

`mars` moves from `ohiocity` to `willowick` on `Planet__c`. `Neighborhood__c` is deliberately left
correct, because it is `Planet__c`'s controlling field and a broken upstream short-circuits
everything below it. Drifting both at once would mean `Planet__c`'s own expectations never get
evaluated — the global value set path would look covered while proving nothing about itself.

```
FAIL  Treecipe_Demo_c_picklistDependenciesMatchSourceMetadata
      Picklist dependency drift on Treecipe_Demo__c -- 2 combination(s) no longer match local source metadata:
        - MISSING_VALUES — Treecipe_Demo__c.Planet__c @ ohiocity: Expected values no longer valid: [mars]
        - FORBIDDEN_VALUES_PRESENT — Treecipe_Demo__c.Planet__c @ willowick: Org unlocks values this controlling value must not unlock: [mars]
```

### Phase 2 — the controlling field as well

`tremont` moves from `cle` to `eastlake` on `Neighborhood__c`. Now the break is upstream of both
tier-3 fields, and the chain reports it once at its source rather than repeating the same describe
mismatch down every link:

```
FAIL  Treecipe_Demo_c_picklistDependenciesMatchSourceMetadata
      Picklist dependency drift on Treecipe_Demo__c -- 4 combination(s) no longer match local source metadata:
        - UPSTREAM_FAILURE — Treecipe_Demo__c.Dressing__c: Controlling field spec Treecipe_Demo__c.Neighborhood__c failed (MISSING_VALUES), so this spec was not evaluated. Fix Treecipe_Demo__c.Neighborhood__c first.
        - MISSING_VALUES — Treecipe_Demo__c.Neighborhood__c @ cle: Expected values no longer valid: [tremont]
        - FORBIDDEN_VALUES_PRESENT — Treecipe_Demo__c.Neighborhood__c @ eastlake: Org unlocks values this controlling value must not unlock: [tremont]
        - UPSTREAM_FAILURE — Treecipe_Demo__c.Planet__c: Controlling field spec Treecipe_Demo__c.Neighborhood__c failed (MISSING_VALUES), so this spec was not evaluated. Fix Treecipe_Demo__c.Neighborhood__c first.
```

Both outputs above are copied from real runs against a scratch org, not paraphrased.
`buildTestMethodNameByObjectApiName` produces the method name, and
`SDTPicklistDependencyValidator.Failure.toLine()` produces `KIND — Object.Field @ value: message`.

Note the method name is `Treecipe_Demo_c_...`, not `Treecipe_Demo__c_...`. **Apex identifiers may not
contain two consecutive underscores**, so runs of underscores in the object api name are collapsed.
The api name itself is passed to the assertion as a string literal and keeps its exact `__c` suffix,
so the describe still resolves the real object.

---

## Where results land

Every run writes a timestamped folder under the workspace:

```
treecipe/
  PicklistDependencyResults/
    check-treecipe-picklist-demo-2026-08-20T09-14-22/
      results.json     machine-readable per-method outcomes
      report.md        human-readable summary + failure detail
```

Passing runs are saved too — a green check belongs on record, not just a failing one. The VS Code
output channel is cleared on every invocation, so these files are what survive: committable,
diffable between runs, attachable to a review.

---

## Testing through the VS Code UI instead

The script calls the same compiled services the commands call, but it cannot exercise the VS Code UI
layer. To test that:

1. `F5` in VS Code → **Run Extension**
2. In the Extension Development Host, open this repository as the workspace
3. `Cmd/Ctrl+Shift+P` → **Salesforce Treecipe: Generate Picklist Dependency Tests**
4. `Cmd/Ctrl+Shift+P` → **Salesforce Treecipe: Run Picklist Dependency Check**
5. Pick the scratch org from the quick pick

Worth watching, because automated tests mock `vscode` and cannot reach these:

- [ ] Org quick pick shows the alias as label and username as description
- [ ] Progress notification appears **with a Cancel button**, and cancelling genuinely stops the run
- [ ] Deploy modal lists all eight file names before anything is sent
- [ ] Output channel opens, is cleared per run, and indents multi-line assertion messages
- [ ] Summary notification names the artifact folder

> **Note on the deploy prompt:** it only appears when `SDTPLDSpecsTest` is absent from the
> target org. Point at a fresh org to exercise that branch.

---

## Known gaps

- **A dependency cannot be broken by omission.** Salesforce merges `valueSettings` on a `CustomField`
  deploy, so removing an entry from the payload leaves the org unchanged and still reports
  `Succeeded`. This is a property of the platform, not of Treecipe, but it is worth knowing before
  writing any other drift scenario: rewire an entry, do not delete one. The `Restore` step relies on
  the same fact — it rewires the values back rather than re-adding them.

- **The Windows `sf.cmd` path is unverified on Windows.** The extension service enables the shell
  on win32 because, since the Node fix for CVE-2024-27980, spawning a `.cmd` with arguments and
  *without* a shell fails with `EINVAL`.
  That reasoning follows documented Node behavior but has not been run on Windows. This PowerShell
  script is unaffected — PowerShell resolves and invokes the shim itself.
- **The VS Code UI layer has no automated coverage** beyond unit tests against a mocked `vscode`.
  Hence the manual checklist above.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `the Salesforce CLI ("sf") is not installed` | not on `PATH` | Install the CLI; in a debug host, confirm VS Code inherited your `PATH` |
| `no Dev Hub is authorized` | no Dev Hub | `sf org login web --set-default-dev-hub` |
| `npm run compile did not produce ... out/` | TypeScript errors | Run `npm run compile` directly and read the errors |
| `the org reports source conflicts` | org and local both moved since the last sync — normal after `-Step Accept`, which retrieves | The script deploys with `--ignore-conflicts`, because it authored every file it deploys and local is authoritative by construction. If you see this, you are on an older copy of the script |
| `No SDTPLDSpecsTest test methods ran` | class not deployed | Run `-Step Check`, which deploys all eight classes before running |
| `Invalid type: SDTPicklistDependencySpec` | framework missing from the deployment set | Deploy the framework alongside the generated classes, never on its own — `-Step Check` does this |
| Every method fails with `LOOKUP_ERROR` | the sample object is not in the org | Run `-Step Deploy`; the test resolves the fields through Schema describe |
| `no dependent picklists found` | no `controllingField` in metadata | Run `-Step Scaffold`, or point at metadata that has a dependency |
| Check fails right after `Scaffold` | org still has old field shape | Run `-Step Deploy` before `-Step Check` |
| `Drift` reports PASS when FAIL was expected | the org never actually drifted | Confirm the lever *rewires* a `valueSettings` entry rather than omitting it; omitted entries are merged away and deploy reports `Succeeded` |
| Deploy fails on an unknown value set | `Planets` not in the deployment | `-Step Deploy` sends the global value set with the object; deploying the object alone fails |

---

## Cleaning up

```powershell
./Invoke-PicklistDependencyDemo.ps1 -Step Teardown
```

Deletes the scratch org. The staging DX project is left on disk — it is gitignored and
`-Step Scaffold` rewrites it deterministically, so removing it is optional:

```bash
rm -rf scripts/picklist-dependency-demo/demoSalesforceProject
```

Nothing the demo writes lives in tracked source: the framework classes it deploys are copies of
`apexPicklistDependencyFramework/SDTPicklistDependencyFramework/`, and every generated or sample
file lands inside the staging project.
