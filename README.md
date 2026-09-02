# Salesforce-Data-Treecipe

**Salesforce-Data-Treecipe** is a Visual Studio Code extension designed to streamline the process of generating production-like data during development in order to support building Quality in.

This extension auto-generates a recipe yaml file based on the running, local project structure. Said differently, what is already in the "source" for the project.

From the generated "Fake-Data Generating YAML Files", additional commands can be used following the recipe generation to build Collections API datasets that can be committed and reused as needed.

Users have two choices of "Fake Data" implementations:

* [faker-js](https://fakerjs.dev/) - Can handle simple to complicated data generation and uploads
* [snowfakery](https://snowfakery.readthedocs.io/en/latest/) - All of the above and way more for advanced data generation scenarios

---

## Table of Contents

  - [Prerequisites for Snowfakery](#prerequisites-for-snowfakery)
  - [VS Code Extension Installation](#vs-code-extension-installation)
  - ["How To" YouTube Walkthroughs:](#how-to-youtube-walkthroughs)
  - [Get started by walking through the below commands](#get-started-by-walking-through-the-below-commands)
    - [1. **Salesforce Treecipe: Initiate Configuration File**](#1-salesforce-treecipe-initiate-configuration-file)
      - [How It Works:](#how-it-works)
      - [Corresponding Video:](#corresponding-video)
    - [2. **Salesforce Treecipe: Generate Treecipe**](#2-salesforce-treecipe-generate-treecipe)
      - [Prerequisite:](#prerequisite)
      - [Corresponding Video:](#corresponding-video-1)
    - [3. **Salesforce Treecipe: Run Faker by Recipe**](#3-salesforce-treecipe-run-faker-by-recipe)
      - [Corresponding Video:](#corresponding-video-2)
    - [4. **Salesforce Treecipe: Insert Data Set by Directory**](#4-salesforce-treecipe-insert-data-set-by-directory)
    - [5. **Salesforce Treecipe: Generate Picklist Dependency Tests**](#5-salesforce-treecipe-generate-picklist-dependency-tests)
    - [6. **Salesforce Treecipe: Run Picklist Dependency Check**](#6-salesforce-treecipe-run-picklist-dependency-check)
  - [VIDEO WALKTHROUGHS](#video-walkthroughs)
      - [Initiate Treecipe Configuration with expected Objects directory](#initiate-treecipe-configuration-with-expected-objects-directory)
      - [Generate Treecipe based on treecipe.config.jcon (keep an eye out for OOTB fields and "REMOVE ME" lines)](#generate-treecipe-based-on-treecipeconfigjcon-keep-an-eye-out-for-ootb-fields-and-remove-me-lines)
      - [Run Snowfakery by existing recipe yaml file](#run-snowfakery-by-existing-recipe-yaml-file)
      - [Insert Data Set by Directory](#insert-data-set-by-directory)
  - [Troubleshooting, Exception Handling, and Reporting Bugs](#troubleshooting-exception-handling-and-reporting-bugs)
      - [Video Walkthrough:](#video-walkthrough)
  - [Contributing](#contributing)
  - [License](#license)
  - [Install Snowfakery CLI](#install-snowfakery-cli)
    - [Snowfakery CLI Installation and Usage](#snowfakery-cli-installation-and-usage)
      - [Overview](#overview)
      - [Prerequisites](#prerequisites)
      - [Installation](#installation)
      - [Verify the Installation](#verify-the-installation)
      - [Usage (Without Salesforce Data Treecipe Extension)](#usage-without-salesforce-data-treecipe-extension)
      - [Uninstalling Snowfakery](#uninstalling-snowfakery)

---

## Prerequisites for Snowfakery

### If using [snowfakery](https://snowfakery.readthedocs.io/en/latest/) as Faker service instead of [faker-js](https://fakerjs.dev/).

"faker-js" can be natively installed with VS Code extensions and does not require machine setup steps.

1. [Install Snowfakery CLI](#install-snowfakery)

---

## VS Code Extension Installation

1. Open **Visual Studio Code**.
2. Go to the **Extensions** panel and search for **Salesforce-Data-Treecipe**.
3. Click **Install**.

---

## "How To" YouTube Walkthroughs:

* [Salesforce Data Treecipe Initiation, Setup, and Simple Account and Contact Example in VS Code:](https://youtu.be/xCB7vcB4nqM?si=e3N2HmtI2Ca-U7m3)

---

## Get started by walking through the below commands

Note: press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.

1. [Initiate Configuration File](#1-salesforce-treecipe-initiate-configuration-file)
2. [Generate Treecipe](#2-salesforce-treecipe-generate-treecipe)
3. [Run Snowfakery by Recipe(Treecipe) to create FakeDataSet](#3-salesforce-treecipe-run-faker-by-recipe)
4. [Insert Data Set by Directory](#4-salesforce-treecipe-insert-data-set-by-directory)
5. [Generate Picklist Dependency Tests](#5-salesforce-treecipe-generate-picklist-dependency-tests)
6. [Run Picklist Dependency Check](#6-salesforce-treecipe-run-picklist-dependency-check)

Note: **Select Faker Implementation** is also available from the Command Palette at any time to switch between the `faker-js` and `snowfakery` backends.

---

### <a name="1-salesforce-treecipe-initiate-configuration-file"></a>1. **Salesforce Treecipe: Initiate Configuration File**

This [command initiates the creation of a configuration file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/tree/main#initiate-treecipe-configuration-with-expected-objects-directory) that is required before using other features of the extension.

The command creates a root directory folder called "treecipe" and within it a configuration file called "treecipe.config.json".

This file is auto generated based on the field configurations detailed selection made when prompted "Select objects directory".

The end result treecipe.config.json file is expected to look like the below:

* **salesforceObjectsPath** - will vary based on selected directory in your VS Code workspace
* **dataFakerService** - can be 'snowfakery' or 'faker-js'

```json
{
    "salesforceObjectsPath": "./force-app/main/default/objects/",
    "dataFakerService": "faker-js"
}
```

#### How It Works:

* Select **"Salesforce Treecipe: Initiate Configuration File"** from the command palette.
* You will be prompted to type the **source directory** in your codebase where Salesforce objects are stored in source format. Begin typing the folder and the directories will auto-filter to match directories based on the entered text.

Once the configuration file is generated, you can begin using the **Generate Treecipe** command.

#### Corresponding Video:

[https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#initiate-treecipe-configuration-with-expected-objects-directory](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#initiate-treecipe-configuration-with-expected-objects-directory)

---

### <a name="2-salesforce-treecipe-generate-treecipe"></a>2. **Salesforce Treecipe: Generate Treecipe**

This command [generates a **Treecipe**](https://github.com/jdschleicher/Salesforce-Data-Treecipe/tree/main#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-), a structured representation of your Salesforce data, based on your treecipe configuration and the objects directory it is pointed to.

It parses the "salesforceObjectsPath" directory path that was provided when running the "Initiate Configuration File" command above, and then generates a yaml file of objects and associated fields found in that directory.

As part of this yaml file generation there are some items to be aware of:

* **"TODO" items:** Review sections marked with "TODO" before generating fake data. These mark areas that need clarification or input.
* **Handling of field files without xml markup:** OOTB fields (e.g., AccountNumber, Name) lack XML detail. Some (like Name) need faker values manually added.
* **Record Type Picklist, Dependent Picklist, Multiselect Picklist Selections:** Object folders are parsed to detect record types and relevant picklist faker options.

**NOTE:**

If this command is run before "Initiate Configuration File" is completed, a warning will appear in VS Code prompting to run it.

#### Prerequisite:

* **Generate Treecipe** requires a valid configuration file and selected Salesforce objects directory.

#### Corresponding Video:

[https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-)

---

### <a name="3-salesforce-treecipe-run-faker-by-recipe"></a>3. **Salesforce Treecipe: Run Faker by Recipe**

This command [prompts the user to select an existing recipe(Treecipe) file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file) to generate fake data from.

With the selection made, the snowfakery CLI will execute against the yaml file and produce json structured, production-like data which is then converted for usage with Salesforce [Collection Api](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_sobjects_collections_create.htm)

#### Corresponding Video:

[https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file)

---

### <a name="4-salesforce-treecipe-insert-data-set-by-directory"></a>4. **Salesforce Treecipe: Insert Data Set by Directory**

This command prompts the user for the following items:

1. Select a pre-existing "dataset" directory with expected Collections-Api structure files
2. Enter name of already locally authenticated Salesforce alias (**DO NOT USE PRODUCTION ORG!!!**)
3. Select "ALL OR NONE" option.

   * "false" keeps successfully inserted records
   * "true" rolls back all inserted records

---

### <a name="5-salesforce-treecipe-generate-picklist-dependency-tests"></a>5. **Salesforce Treecipe: Generate Picklist Dependency Tests**

This command generates an Apex test class that asserts your picklist dependencies still exist in an org, so a dependency an admin later rewires is caught by a failing test instead of surfacing as a confusing Collections API error at data-load time.

**Prerequisite:** "Initiate Configuration File" must have been run, and the workspace must be a Salesforce DX project with an `sfdx-project.json`.

The command:

1. Walks the `salesforceObjectsPath` from `treecipe.config.json`
2. Emits one spec per picklist field that declares a `controllingField`, derived from the `valueSettings` in its field metadata
3. Writes one `SDTPLDSpecs_<Object>.cls` per object that has dependent picklists, each holding one spec method per dependent picklist on that object
4. Writes `SDTPLDSpecs.cls`, an aggregator whose `all()` pulls in every per-object class. Callers depend on the aggregator, so a per-object class appearing or disappearing as your metadata changes does not ripple outwards
5. Writes `SDTPLDSpecsTest.cls`, an `@IsTest` class with one test method per object that asserts that object's specs against the org the test runs in, plus a guard method that fails when the spec registry is empty
6. Scaffolds the Apex validation framework classes it depends on (`SDTPicklistDependencySpec`, `SDTPicklistDependencyValidator`, `SDTSchemaPicklistDependencySource`, and supporting classes) into a `SDTPicklistDependencyFramework` subfolder, if they are not already present. Keeping them in their own directory separates the six files you did not write from the generated contract you do engage with, and makes them removable in one action — Salesforce resolves `ApexClass` by the enclosing `classes` directory and walks nested folders, so the layout deploys identically

#### What each spec asserts

Every controlling value gets **two** assertions, which together catch drift in both directions:

| Emitted line | Catches |
|---|---|
| `expectAtLeast('USA', new List<String>{ 'Ohio', 'Texas' })` | A value **removed** from the combination |
| `expectNotAllowed('USA', new List<String>{ 'Ontario' })` | A value that **drifted into** the combination |
| `expectNone('Antarctica')` | A controlling value that must unlock nothing gaining values |

The forbidden list is the complement: every value the dependent field declares that this controlling value does not unlock. That is deliberately weaker than `expectExactly` — a value an admin legitimately adds to the field after generation is tolerated, while a value moving into the wrong bucket still fails. Tightening a line to `expectExactly` is a deliberate edit — note that regenerating overwrites the file, so hand edits are lost.

#### Record type scoped specs

A record type assigns its own subset of picklist values to the controlling and dependent fields, so the combinations reachable **through one record type** are narrower than what the field itself declares. Where an object has a `recordTypes/` directory, the per-object class gets those narrowed combinations too, alongside the field-level ones:

```apex
public static SDTPicklistDependencySpec specFor_Dependency_Example_c_Neighborhood_c_recordType_Cleveland_Only() {
    return SDTPicklistDependencySpec.forRecordType('Dependency_Example__c', 'Neighborhood__c', 'Cleveland_Only')
            .controlledBy('City__c')
            .expectAtLeast('cle', new List<String>{ 'ohiocity', 'tremont' })
            .expectNotAllowed('cle', new List<String>{ 'willowick' })
            .expectUnavailable('eastlake');
}
```

* The controlling values are the field's, intersected with what the record type assigns to the controlling field; the unlocked values are intersected with what it assigns to the dependent field
* A controlling value the record type **does** assign but whose unlocked values it assigns none of becomes `expectNone` — it must exist under that record type and unlock nothing
* A controlling value the record type does **not** assign becomes `expectUnavailable` — under that record type the value is absent rather than empty, and `expectNone` would demand it exist
* A field the record type's XML never mentions is treated as **unassigned** for that record type, not as fully assigned: the combination is skipped and reported as a warning, and the field-level spec still covers the field
* The scoped specs are collected by `recordTypeSpecs()` on the per-object class and `SDTPLDSpecs.allRecordTypeScoped()` on the aggregator

**They are not asserted by `SDTPLDSpecsTest`, and that is deliberate.** Apex `Schema` describe returns picklist values without any record type filtering, so the describe-backed source cannot answer a record-type-scoped spec — it rejects one outright rather than checking it against the whole field and reporting a scope it never verified as green. The scoped specs deploy with the rest of the contract and are ready for an `ISDTPicklistDependencySource` that can read record-type-filtered values; until then they are a captured contract, not a running one. An object with no `recordTypes/` directory generates exactly what it did before.

#### Chained dependencies

Where a dependent picklist is itself the controlling field of another (`Country__c` → `State__c` → `City__c`), the generated spec for the lower link carries a `dependsOn` naming the spec above it:

```apex
public static SDTPicklistDependencySpec specFor_Chain_Example_c_City_c() {
    return SDTPicklistDependencySpec.forField('Chain_Example__c', 'City__c')
            .controlledBy('State__c')
            .dependsOn(specFor_Chain_Example_c_State_c())
            .expectAtLeast('Ohio', new List<String>{ 'Cleveland', 'Columbus' })
            .expectNotAllowed('Ohio', new List<String>{ 'Austin', 'Toronto' });
}
```

When the upstream spec fails, the break is reported once where it actually is, and the downstream spec reports a single `UPSTREAM_FAILURE` naming the spec to fix first — rather than repeating the same describe mismatch for every dependent below it.

Notes:

* A field with a `controllingField` but no `valueSettings` markup is reported as a warning and skipped; the rest of the run continues
* A record type that assigns no values to the controlling or the dependent field of a dependency is reported the same way, and only that combination is skipped
* If no dependent picklists are found, an informational message is shown and no file is written
* If the generated classes already exist, you are prompted before they are overwritten
* A per-object class left over from an object that no longer declares a dependent picklist is removed and named in the summary, so the org stops asserting a contract your metadata no longer describes
* **Upgrading from 2.12.x–2.14.x:** the Apex classes were unprefixed then. If a `PicklistDependencyFramework` folder or an `SFTreecipePicklistDependencySpecs.cls` is still in your project, the command warns and names what to delete — locally and in any org you deployed them to. Nothing is deleted for you

The generated assertions read the org's **real** metadata. Schema describe is not isolated by `@IsTest`, so no test setup data and no `SeeAllData` are involved.

#### End-to-end in one command

After generating, the command offers to **deploy and run the tests against an org right away**. Accept it and you are prompted for the target org, the classes are deployed, the tests run, and the results land in the output channel and the `treecipe` directory — generation through to verified results without leaving the command.

The offer comes *after* generation rather than before, because generating is useful on its own: reviewing what changed, or working without an org to hand, needs the files and nothing else. Dismissing the prompt leaves you with a completed generation, not a cancelled command.

This path **always deploys**, unlike "Run Picklist Dependency Check" below, which deploys only when the test class is missing. The classes were just rewritten, so the org copy is stale by definition — a conditional deploy would run yesterday's contract against today's metadata.

Once generated, you can also run the check any time with "Run Picklist Dependency Check" below.

#### Once the classes are in your org

Everything above is the VS Code side. For the org side — what each deployed class is, how to read a generated spec against the **Field Dependencies** grid in Setup, how to run the tests from Setup or the Developer Console, how to trigger a failure on purpose to prove the gate works, and how to decide whether to fix the org or regenerate the specs — see the **[Picklist Dependency In-Org Guide](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/docs/PICKLIST-DEPENDENCY-IN-ORG-GUIDE.md)**. It is written for an admin or developer looking at `SDTPLDSpecsTest` in an org, and assumes nothing about this extension.

---

### <a name="6-salesforce-treecipe-run-picklist-dependency-check"></a>6. **Salesforce Treecipe: Run Picklist Dependency Check**

This command deploys and runs the generated picklist dependency tests against an org and reports the result in VS Code.

**Prerequisite:** "Generate Picklist Dependency Tests" must have been run, and the Salesforce CLI (`sf`) must be installed with at least one authorized org.

The command:

1. Lists your authenticated orgs and prompts you to pick the target
2. Checks whether `SDTPLDSpecsTest` exists in that org, and offers to deploy the classes if it does not — nothing is deployed without explicit confirmation
3. Runs the test class with `sf apex run test`
4. Writes a per-method report to the **Picklist Dependency Check** output channel and shows a pass/fail summary notification
5. Saves the results into `treecipe/PicklistDependencyResults/check-<org>-<timestamp>/` as `results.json` and `report.md`

A failing method names the object, field, controlling value, and the specific missing values.

Notes:

* If no orgs are authenticated, you are told how to authorize one rather than shown an empty picker
* Declining the deploy prompt exits cleanly and deploys nothing
* The output channel is cleared on each run, so what you see always belongs to the run that just finished
* Because the channel is cleared, every run is also written to disk under `treecipe/PicklistDependencyResults/` — one timestamped folder per run, so results stay committable and diffable between runs. Passing runs are saved too, not only failures

---

## VIDEO WALKTHROUGHS

#### Initiate Treecipe Configuration with expected Objects directory

[https://github.com/user-attachments/assets/f8401f28-a04c-4abc-a56f-c860cce96dee](https://github.com/user-attachments/assets/f8401f28-a04c-4abc-a56f-c860cce96dee)

#### Generate Treecipe based on treecipe.config.jcon (keep an eye out for OOTB fields and "REMOVE ME" lines)

[https://github.com/user-attachments/assets/fd127b55-d434-4a73-9d65-cf4172fbce6f](https://github.com/user-attachments/assets/fd127b55-d434-4a73-9d65-cf4172fbce6f)

#### Run Snowfakery by existing recipe yaml file

[https://github.com/user-attachments/assets/d7dfcf70-70f8-4ce3-b254-280e2bbb0b7d](https://github.com/user-attachments/assets/d7dfcf70-70f8-4ce3-b254-280e2bbb0b7d)

#### Insert Data Set by Directory

[https://github.com/user-attachments/assets/a0491f86-9360-4450-afae-f71fe07dbc21](https://github.com/user-attachments/assets/a0491f86-9360-4450-afae-f71fe07dbc21)

---

## Troubleshooting, Exception Handling, and Reporting Bugs

See below for troubleshooting when specific commands are not working:

* **Salesforce Treecipe - Generate Treecipe - generateRecipeFromConfigurationDetail:**

  * Ensure "Initiate Configuration File" was successfully run
  * Ensure path in treecipe.config.json uses forward-slashes
  * Ensure "defaultFakerService" is set to "snowfakery"

* **Salesforce Treecipe: Initiate Configuration File - initiateTreecipeConfigurationSetup:**

  * Ensure expected project directory was selected

**NOTE:**

All commands are wrapped in try-catch and will prompt a "Report a Bug" dialog. This generates a GitHub Issue template with a stack trace.

#### Video Walkthrough:

[https://github.com/user-attachments/assets/dff4a3cb-e244-4959-9dec-dcf094f713c2](https://github.com/user-attachments/assets/dff4a3cb-e244-4959-9dec-dcf094f713c2)

---

## Contributing

This project and codebase will be open-sourced shortly :)

---

## License

This extension is licensed under the [MIT License](LICENSE).

---

## <a name="install-snowfakery-cli"></a>Install Snowfakery CLI

### Snowfakery CLI Installation and Usage

#### Overview

Snowfakery is a tool for generating synthetic data. This document provides instructions for installing and using the Snowfakery CLI on any operating system.

#### Prerequisites

* **Python 3.8+** is required:

  ```bash
  python --version
  ```

  [https://www.python.org/downloads/](https://www.python.org/downloads/)

* **pip** (Python package manager):
  [https://pip.pypa.io/en/stable/installation/](https://pip.pypa.io/en/stable/installation/)

#### Installation

```bash
pip install snowfakery
```

#### Verify the Installation

```bash
snowfakery --version
```

#### Usage (Without Salesforce Data Treecipe Extension)

```bash
snowfakery generate <path_to_your_snowfakery_recipe>
```

Official documentation:
[https://snowfakery.readthedocs.io/](https://snowfakery.readthedocs.io/)

#### Uninstalling Snowfakery

```bash
pip uninstall snowfakery
```
