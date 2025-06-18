# Salesforce-Data-Treecipe

**Salesforce-Data-Treecipe** is a Visual Studio Code extension designed to streamline the process of generating production-like data during development in order to support building Quality in.

This extension auto-generates a recipe yaml file based on the running, local project structure. Said differently, what is already in the "source" for the project.

From the generated "Fake-Data Generating YAML Files", additional commands can be used following the recipe generation to build Collections API datasets that can be committed and reused as needed.

Users have two choices of "Fake Data" implementations:

* [faker-js](https://fakerjs.dev/) - Can handle simple to complicated data generation and uploads
* [snowfakery](https://snowfakery.readthedocs.io/en/latest/) - All of the above and way more for advanced data generation scenarios

---

## Table of Contents

- [Salesforce-Data-Treecipe](#salesforce-data-treecipe)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites for Snowfakery](#prerequisites-for-snowfakery)
    - [If using snowfakery as Faker service instead of faker-js.](#if-using-snowfakery-as-faker-service-instead-of-faker-js)
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
