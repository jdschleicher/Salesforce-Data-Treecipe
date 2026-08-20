# Picklist Dependency Contract Testing — End-to-End Guide

How to exercise Treecipe's picklist dependency testing from nothing to a proven, failing-on-drift
check, against a real scratch org.

> **Repo tooling, not shipped.** This folder is excluded from the `.vsix` via `.vscodeignore`. It
> exists to test and demonstrate the feature, not to reach extension users.

---

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

# stand it all up and confirm source and org agree
./Invoke-PicklistDependencyDemo.ps1

# prove the check catches a rewired dependency
./Invoke-PicklistDependencyDemo.ps1 -Step Drift

# put the org back
./Invoke-PicklistDependencyDemo.ps1 -Step Restore

# when you are finished
./Invoke-PicklistDependencyDemo.ps1 -Step Teardown
```

On macOS or Linux, `pwsh ./Invoke-PicklistDependencyDemo.ps1` if the script is not marked executable.

---

## What each step does

| Step | Action | Expected |
|---|---|---|
| `Preflight` | Verifies CLI, Dev Hub, node, compiled output | all green |
| `Scaffold` | Writes `config/project-scratch-def.json` and a sample dependent picklist under `force-app` | files on disk |
| `CreateOrg` | Creates the scratch org (reuses a live one with the same alias) | org created |
| `Deploy` | Deploys the sample **object** plus the six framework classes | 7+ components |
| `Generate` | Builds `PicklistDependencySpecs.cls` + `PicklistDependencySpecsTest.cls` from **local** metadata | 1 spec, 1 object |
| `Check` | Deploys all eight owned classes, runs the tests, writes artifacts | **PASS** |
| `Drift` | Removes `cle → tremont` from the **org only**, re-runs | **FAIL** |
| `Restore` | Puts the org dependency back, re-runs | **PASS** |
| `Teardown` | Deletes the scratch org | org deleted |

`All` runs `Preflight` through `Check`. `Drift`, `Restore` and `Teardown` are opt-in because they
mutate or destroy the org.

### Do the framework classes have to come first?

**For generation, no.** The "Generate Picklist Dependency Tests" command *scaffolds* the framework
into your package directory as part of generating, so the framework, the spec registry and the test
class all land together. Generation only writes files — it never reads the framework.

**For deployment, they must arrive together — but not in a separate earlier deploy.** The generated
classes do not compile without the framework, and Salesforce compiles a deployment set as one unit.
So the extension sends all eight in a single transaction, and this script does the same. Deploying
only the two generated classes to a fresh org fails with `Invalid type: PicklistDependencySpec`.

`-Step Deploy` is still required, but for the **sample object**: the Apex test resolves
`Treecipe_Demo__c.Neighborhood__c` through Schema describe, so the fields must exist in the org or
every method fails with `LOOKUP_ERROR`.

### The sample dependency

```
City__c (controlling)          Neighborhood__c (dependent)
  cle           ───────────►     ohiocity, tremont
  eastlake      ───────────►     willowick
  akron         ───────────►     (nothing)   ← emitted as expectNone
```

Which generates:

```apex
PicklistDependencySpec.forField('Treecipe_Demo__c', 'Neighborhood__c')
    .controlledBy('City__c')
    .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
    .expectAtLeast('eastlake', new List<String>{ 'willowick' })
    .expectNone('akron')
```

`expectAtLeast` is what the generator always emits: combinations in source must still exist, while
values the org has *added* since are tolerated. Tightening a line to `expectExactly` is a deliberate
hand edit — and is lost on regeneration, which the generated file header states plainly.

---

## The Drift step, in detail

This is the step worth understanding, because it is the only one that proves the feature works.

1. `Neighborhood__c` is rewritten locally **without** the `cle → tremont` entry
2. That reduced field is deployed to the org — and **only** that field
3. The local file is immediately restored to the original contract

The org and local source now genuinely disagree. Source still asserts `cle` unlocks `tremont`; the
org no longer allows it.

**The specs are deliberately not regenerated.** Regenerating would rewrite the contract to match the
drift and hide exactly the problem the check exists to find.

Re-running the check produces a failing Apex test whose assertion message names the object, the
field, the controlling value, and the specific missing value:

```
FAIL  Treecipe_Demo__c_picklistDependenciesMatchSourceMetadata
      System.AssertException: Assertion Failed: Picklist dependency drift on Treecipe_Demo__c
      -- 1 combination(s) no longer match local source metadata:
        - MISSING_VALUES — Treecipe_Demo__c.Neighborhood__c @ "cle": Expected values no longer valid: [tremont]
```

The method name and message format above are taken from the shipped code, not paraphrased:
`buildTestMethodNameByObjectApiName` produces the method name, and
`PicklistDependencyValidator.Failure.toLine()` produces `KIND — Object.Field @ "value": message`.

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

> **Note on the deploy prompt:** it only appears when `PicklistDependencySpecsTest` is absent from the
> target org. Point at a fresh org to exercise that branch.

---

## Known gaps

- **The Windows `sf.cmd` path is unverified on Windows.** Both the extension service and
  `scripts/apex/run-picklist-dependency-checks.js` enable the shell on win32 because, since the Node
  fix for CVE-2024-27980, spawning a `.cmd` with arguments and *without* a shell fails with `EINVAL`.
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
| `the org reports source conflicts` | org and local both changed | Use a fresh scratch org, or resolve with `sf project retrieve start` |
| `No PicklistDependencySpecsTest test methods ran` | class not deployed | Run `-Step Check`, which deploys all eight classes before running |
| `Invalid type: PicklistDependencySpec` | framework missing from the deployment set | Deploy the framework alongside the generated classes, never on its own — `-Step Check` does this |
| Every method fails with `LOOKUP_ERROR` | the sample object is not in the org | Run `-Step Deploy`; the test resolves the fields through Schema describe |
| `no dependent picklists found` | no `controllingField` in metadata | Run `-Step Scaffold`, or point at metadata that has a dependency |
| Check fails right after `Scaffold` | org still has old field shape | Run `-Step Deploy` before `-Step Check` |

---

## Cleaning up

```powershell
./Invoke-PicklistDependencyDemo.ps1 -Step Teardown
```

Deletes the scratch org. The sample metadata under `force-app/main/default/objects/Treecipe_Demo__c`
and the generated classes are left on disk — remove them by hand if you do not want them:

```bash
rm -rf force-app/main/default/objects/Treecipe_Demo__c
rm -f force-app/main/default/classes/PicklistDependencySpecsTest.cls*
git checkout force-app/main/default/classes/PicklistDependencySpecs.cls
```

That last line matters: the repo's committed `PicklistDependencySpecs.cls` is an intentional
placeholder, and `-Step Generate` overwrites it.
