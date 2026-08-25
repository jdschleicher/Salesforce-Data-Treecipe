# Picklist Dependency Testing — Flow Diagrams

Visual companion to [`README.md`](./README.md). That file is the runbook — what to type and what to
expect. This file is the map — what actually moves, in what order, and where each step can stop.

Every diagram below is drawn from shipped code, not from intent:
`ExtensionCommandService`, `PicklistDependencyTestService`, `PicklistDependencyCheckService`,
and `Invoke-PicklistDependencyDemo.ps1`.

| Diagram | Answers |
|---|---|
| [1. The contract loop](#1-the-contract-loop) | What is the feature, in one picture |
| [2. Demo script step machine](#2-demo-script-step-machine) | What each `-Step` does and what gates it |
| [3. Generate command](#3-generate-picklist-dependency-tests) | What happens on generate, including every early exit |
| [4. Run check command](#4-run-picklist-dependency-check) | Deploy-or-skip, cancellation, artifacts |
| [5. The deployment set](#5-the-deployment-set) | Why all eight classes ship in one transaction |
| [6. Drift detection](#6-drift-detection-the-step-that-proves-it) | How a rewired org gets caught |
| [7. Metadata to assertion](#7-metadata-to-assertion) | XML → Apex → verdict, value by value |

---

## 1. The contract loop

Source metadata is the contract. The org is the thing under test. The generated Apex is the bridge.

```mermaid
flowchart LR
    subgraph disk["Local source format"]
        XML["fields/*.field-meta.xml<br/>controllingField + valueSettings"]
    end

    subgraph vscode["Treecipe extension"]
        GEN["Generate Picklist<br/>Dependency Tests"]
        CHK["Run Picklist<br/>Dependency Check"]
    end

    subgraph classes["packageDir/main/default/classes"]
        FW["PicklistDependencyFramework/<br/>6 scaffolded classes"]
        SPECS["SFTreecipePicklistDependencySpecs.cls<br/>the contract"]
        TEST["SFTreecipePicklistDependencySpecsTest.cls<br/>the assertions"]
    end

    subgraph org["Target Salesforce org"]
        DESCRIBE["Schema describe<br/>live dependency map"]
        APEX["Apex test run"]
    end

    ART["treecipe/PicklistDependencyResults/<br/>results.json + report.md"]

    XML --> GEN
    GEN --> SPECS
    GEN --> TEST
    GEN --> FW
    FW --> CHK
    SPECS --> CHK
    TEST --> CHK
    CHK -->|"sf project deploy start"| APEX
    APEX --> DESCRIBE
    DESCRIBE -->|"PASS or drift failure"| ART
```

The point of the loop: that map already existed inside Treecipe to drive recipe generation, and used
to die at YAML-write time. Turning it into Apex makes it executable, so an admin rewiring the
dependency later fails a test instead of surfacing as a confusing Collections API error at data load.

---

## 2. Demo script step machine

`./Invoke-PicklistDependencyDemo.ps1 -Step <Step>`. `All` runs `Preflight` → `Check`.
`Drift`, `Restore` and `Teardown` are opt-in because they mutate or destroy the org.

```mermaid
flowchart TD
    START(["./Invoke-PicklistDependencyDemo.ps1"]) --> PRE

    PRE["Preflight<br/>sf CLI, Dev Hub, node, out/"]
    PRE -->|"missing prerequisite"| STOP["Stop with an actionable message"]
    PRE -->|"all green"| SCAF

    SCAF["Scaffold<br/>project-scratch-def.json +<br/>Treecipe_Demo__c dependent picklist"]
    SCAF --> CREATE["CreateOrg<br/>reuses a live org with the same alias"]
    CREATE --> DEPLOY["Deploy<br/>sample object + 6 framework classes<br/>7+ components"]
    DEPLOY --> GENERATE["Generate<br/>Specs.cls + SpecsTest.cls<br/>from LOCAL metadata only"]
    GENERATE --> CHECK["Check<br/>deploy all 8 owned classes, run tests"]
    CHECK ==>|"expected"| PASS1["PASS<br/>source and org agree"]

    PASS1 -.->|"opt in"| DRIFT["Drift<br/>remove cle to tremont in the ORG only"]
    DRIFT ==>|"expected"| FAIL["FAIL<br/>named, specific, non-zero exit"]
    FAIL -.->|"opt in"| RESTORE["Restore<br/>put the org dependency back"]
    RESTORE ==> PASS2["PASS again"]
    PASS2 -.->|"opt in"| TEAR["Teardown<br/>delete the scratch org"]

    style PASS1 fill:#1b5e20,color:#fff
    style PASS2 fill:#1b5e20,color:#fff
    style FAIL fill:#b71c1c,color:#fff
    style STOP fill:#b71c1c,color:#fff
```

`Deploy` is not optional even though generation reads nothing from the org: the Apex test resolves
`Treecipe_Demo__c.Neighborhood__c` through Schema describe, so the fields must exist in the org or
every method fails with `LOOKUP_ERROR`.

The script drives the same compiled services the VS Code commands drive, through
`treecipe-headless.js` — the commands themselves cannot be invoked outside an extension host.

```mermaid
flowchart LR
    PS1["Invoke-PicklistDependencyDemo.ps1"] --> HL["treecipe-headless.js<br/>generate | check"]
    HL --> OUT["out/ compiled services"]
    OUT --> TS["PicklistDependencyTestService"]
    OUT --> CS["PicklistDependencyCheckService"]
    VSC["VS Code commands"] --> ECS["ExtensionCommandService"]
    ECS --> TS
    ECS --> CS
    style VSC stroke-dasharray: 4 4
```

---

## 3. Generate Picklist Dependency Tests

`treecipe.generatePicklistDependencyTests` → `ExtensionCommandService.generatePicklistDependencyTests`.
Generation only writes files. It never reads the org.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Cmd as ExtensionCommandService
    participant Config as ConfigurationService
    participant Gen as PicklistDependencyTestService
    participant Recipe as RecipeService
    participant Disk as Workspace files

    User->>Cmd: Generate Picklist Dependency Tests
    Cmd->>Cmd: getWorkspaceRoot
    Note over Cmd: no workspace → throw
    Cmd->>Config: getObjectsPathFromTreecipeJSONConfiguration
    Config-->>Cmd: salesforceObjectsPath
    Note over Cmd: directory missing → throw naming<br/>treecipe.config.json

    Cmd->>Gen: collectSpecDetailsByObjectsDirectory
    Gen->>Gen: walk objects, stop at any dir holding fields/
    Gen->>Gen: read *.field-meta.xml only
    loop each field with controllingField
        Gen->>Gen: validate object, field, controlling api names
        Gen->>Recipe: buildControllingValueToPicklistOptions
        Recipe-->>Gen: controllingValue → dependent values
        Gen->>Gen: buildExpectations, add expectNone for<br/>controlling values that unlock nothing
    end
    Gen-->>Cmd: specDetails + skippedFieldWarnings

    Cmd-->>User: warn on up to 3 skipped fields, then a rollup
    Note over Cmd: 0 specs → info message, nothing written, return

    Cmd->>Gen: resolveDefaultPackageDirectoryPath, getClassesDirectoryPath
    Cmd->>Gen: assertClassesDirectoryContainedInWorkspace
    Cmd-->>User: confirm overwrite of existing generated files
    Cmd->>Gen: getSourceApiVersion from sfdx-project.json
    Cmd->>Disk: write Specs.cls + meta.xml
    Cmd->>Disk: write SpecsTest.cls + meta.xml
    Cmd->>Gen: scaffoldMissingFrameworkClasses
    Gen->>Disk: copy any of the 6 framework classes not already present
    Cmd-->>User: open Specs.cls, offer "deploy and run now?"
    User->>Cmd: yes
    Cmd->>Cmd: deployRunAndReportPicklistDependencyCheck, alwaysDeploy = true
```

Step 27 always deploys: the classes were just rewritten, so the org copy is stale by definition and a
conditional deploy would run yesterday's contract against today's metadata.

---

## 4. Run Picklist Dependency Check

`treecipe.runPicklistDependencyCheck`. Same shared helper as the tail of generate, with
`alwaysDeploy = false`.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Cmd as ExtensionCommandService
    participant Chk as PicklistDependencyCheckService
    participant CLI as sf CLI child process
    participant Org as Target org
    participant Disk as treecipe/PicklistDependencyResults

    User->>Cmd: Run Picklist Dependency Check
    Cmd->>Chk: buildAuthenticatedOrgDetails from AuthInfo.listAllAuthorizations
    Chk-->>Cmd: alias as label, username as description
    Cmd-->>User: org quick pick
    User-->>Cmd: pick org
    Note over Cmd: dismissed → silent return

    rect rgb(240, 240, 250)
        Note over Cmd,Org: withProgress, cancellable — cancel kills the child process
        alt alwaysDeploy is false
            Cmd->>Chk: isSpecsTestClassDeployedInOrg
            Chk->>CLI: sf data query ApexClass
            CLI-->>Chk: present or absent
        end
        alt deploy required
            Cmd-->>User: modal listing all 8 file names
            Note over Cmd: declined → "nothing was deployed", return
            Cmd->>Chk: deployPicklistDependencyClasses
            Chk->>CLI: sf project deploy start
            CLI->>Org: 8 classes, one transaction
        end
        Cmd->>Chk: runPicklistDependencyTests
        Chk->>CLI: sf apex run test --tests SpecsTest --json
        CLI->>Org: execute
        Org-->>CLI: per-method outcomes
        CLI-->>Chk: json payload
        Chk-->>Cmd: buildCheckOutcomeByTestRunPayload
    end

    Cmd->>Cmd: buildOutputChannelReport
    Cmd-->>User: output channel, cleared per run
    Cmd->>Chk: writeCheckResultArtifacts
    Chk->>Disk: check-<org>-<timestamp>/results.json + report.md
    Cmd-->>User: pass info / fail warning naming the artifact folder
```

The output channel is cleared on every invocation, so the artifact folder is what survives —
committable, diffable between runs, attachable to a review. Passing runs are written too: a green
check belongs on record, not just a failing one.

---

## 5. The deployment set

Eight classes, one transaction. Not a convention — a compile requirement.

```mermaid
flowchart TB
    subgraph tx["One sf project deploy start"]
        direction TB
        subgraph gen["Generated — yours to read"]
            SPECS["SFTreecipePicklistDependencySpecs"]
            TEST["SFTreecipePicklistDependencySpecsTest"]
        end
        subgraph fw["PicklistDependencyFramework/ — scaffolded boilerplate"]
            I["IPicklistDependencySource"]
            SPEC["PicklistDependencySpec"]
            SNAP["PicklistDependencySnapshot"]
            REP["PicklistDependencyReport"]
            VAL["PicklistDependencyValidator"]
            SRC["SchemaPicklistDependencySource"]
        end
    end

    SPECS -->|"compile dependency"| SPEC
    TEST --> SPECS
    TEST --> VAL
    VAL --> SNAP
    VAL --> REP
    VAL --> I
    SRC -.->|"implements"| I
    SRC -->|"Schema describe"| ORG[("Target org")]

    BAD["Deploying only the 2 generated classes"] -.->|"Invalid type:<br/>PicklistDependencySpec"| FAILS(["deploy fails"])
    style FAILS fill:#b71c1c,color:#fff
```

Salesforce resolves `ApexClass` by the enclosing `classes` directory and walks nested folders, so the
subdirectory deploys identically to a flat layout. The split is for humans: the framework is
replaceable boilerplate you can delete in one action; the two generated files are the contract you
actually engage with. Workspaces generated by an earlier version keep the framework loose at the
classes root — both layouts work, and each class is resolved from one path only, since Salesforce
rejects the same `ApexClass` twice in one deployment.

---

## 6. Drift detection, the step that proves it

A check that only ever passes proves nothing.

```mermaid
sequenceDiagram
    autonumber
    participant Local as Local source
    participant Org as Scratch org
    participant Check as Check run

    Note over Local,Org: after -Step Check, both agree
    Local->>Check: cle unlocks ohiocity, tremont
    Org->>Check: cle unlocks ohiocity, tremont
    Check-->>Check: PASS

    Note over Local,Org: -Step Drift
    Local->>Local: rewrite Neighborhood__c WITHOUT cle → tremont
    Local->>Org: deploy that one reduced field
    Local->>Local: immediately restore the original file
    Note over Local,Org: source and org now genuinely disagree

    Note over Check: specs are deliberately NOT regenerated —<br/>regenerating would rewrite the contract to match<br/>the drift and hide the exact problem
    Local->>Check: cle unlocks ohiocity, tremont
    Org->>Check: cle unlocks ohiocity
    Check-->>Check: FAIL, MISSING_VALUES on tremont
```

The failure names the object, the field, the controlling value, and the specific missing value:

```
FAIL  Treecipe_Demo_c_picklistDependenciesMatchSourceMetadata
      System.AssertException: Assertion Failed: Picklist dependency drift on Treecipe_Demo__c
      -- 1 combination(s) no longer match local source metadata:
        - MISSING_VALUES — Treecipe_Demo__c.Neighborhood__c @ "cle": Expected values no longer valid: [tremont]
```

The method name is `Treecipe_Demo_c_...`, not `Treecipe_Demo__c_...`: Apex identifiers may not
contain two consecutive underscores, so runs of underscores in the object api name are collapsed by
`buildTestMethodNameByObjectApiName`. The api name itself reaches the assertion as a string literal
and keeps its exact `__c` suffix, so the describe still resolves the real object.

---

## 7. Metadata to assertion

One dependent field, end to end.

```mermaid
flowchart TB
    A["City__c picklist values<br/>cle, eastlake, akron"] --> C
    B["Neighborhood__c valueSettings<br/>ohiocity ← cle<br/>tremont ← cle<br/>willowick ← eastlake"] --> C

    C["buildControllingValueToPicklistOptions<br/>cle → ohiocity, tremont<br/>eastlake → willowick"]
    C --> D["buildExpectations<br/>diff against the controlling field's own values<br/>akron unlocks nothing → expectNone"]
    D --> E["buildSpecStatement<br/>api names validated, literals escaped"]
    E --> F["forField.controlledBy<br/>.expectAtLeast cle, ohiocity + tremont<br/>.expectAtLeast eastlake, willowick<br/>.expectNone akron"]
    F --> G["PicklistDependencyValidator<br/>vs SchemaPicklistDependencySource"]
    G --> H{"org still satisfies<br/>every expectation?"}
    H -->|yes| PASS["PASS"]
    H -->|no| FAIL["FAIL — KIND — Object.Field @ value: message"]

    style PASS fill:#1b5e20,color:#fff
    style FAIL fill:#b71c1c,color:#fff
```

`expectAtLeast` is what the generator always emits: combinations present in source must still exist,
while values the org has *added* since are tolerated. Tightening a line to `expectExactly` is a
deliberate hand edit — and is lost on regeneration, which the generated file header states plainly.

A field with a `controllingField` but no `valueSettings` markup is reported and skipped rather than
aborting the run, as is a field whose object, field, or controlling api name is not a plain
Salesforce identifier.

---

## What the diagrams cannot cover

The VS Code UI layer has no automated coverage — Jest mocks `vscode`, and the demo script drives the
compiled services rather than the extension host. The manual checklist in
[`README.md`](./README.md#testing-through-the-vs-code-ui-instead) is the only thing exercising the
quick pick, the cancellable progress notification, the deploy modal, and the output channel.
