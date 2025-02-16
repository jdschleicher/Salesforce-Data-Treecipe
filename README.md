# Salesforce-Data-Treecipe

**Salesforce-Data-Treecipe** is a Visual Studio Code extension designed to streamline the process of generating production-like data during development in order to support building Quality in. This extension auto-generates a recipe yaml file based on what is already in the source object metadata xml of your project.

---

## Prerequisites

1. [Install Snowfakery CLI](#install-snowfakery) 
   
---

## VS Code Extension Installation

1. Open **Visual Studio Code**.
2. Go to the **Extensions** panel and search for **Salesforce-Data-Treecipe**.
3. Click **Install**.

---

## Get started by walking through the below commands (see corresponding video for each step):

Note: press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.

1. [Initiate Configuration File](#command1)
2. [Generate Treecipe](#command2)
3. [Run Snowfakery by Recipe(Treecipe) to create FakeDataSet](#command3)
4. [Insert Data Set by Directory ](#command4)

---



 ### <a name="command1"></a> 1. **Salesforce Treecipe: Initiate Configuration File**
 
This [command initiates the creation of a configuration file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/tree/main#initiate-treecipe-configuration-with-expected-objects-directory) that is required before using other features of the extension.

The command creates a root directory folder called "treecipe" and within it a configuration file called "treecipe.config.json". 

This file is auto generated based on the selection made from the prompted "Select objects directory". 

The end result treecipe.config.json file is expected to look like the below:

- **salesforceObjectsPath** - will vary based on selected directory in your VS Code workspace
- **dataFakerService** - this value must be 'snowfakery' - in a distant future release there is a chance the faker-js could be used as a value
```json
{
    "salesforceObjectsPath": "./force-app/main/default/objects/",
    "dataFakerService": "snowfakery"
}
```

#### How It Works:

- Select **"Salesforce Treecipe: Initiate Configuration File"** from the command palette.
- You will be prompted to type the **source directory** in your codebase where Salesforce objects are stored in source format. Begin typing the folder and the directories will auto-filter to match directories based on the entered text.

Once the configuration file is generated, you can begin using the **Generate Treecipe** command.


#### Corresponding Video:

https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#initiate-treecipe-configuration-with-expected-objects-directory

---

### 2.<a name="command2"></a> **Salesforce Treecipe: Generate Treecipe**
This command [generates a **Treecipe**](https://github.com/jdschleicher/Salesforce-Data-Treecipe/tree/main#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-), a structured representation of your Salesforce data, based on your configuration.

It parses the "salesforceObjectsPath" directory path that was provided when running the "Initiate Configuration File" command above, and then generates a yaml file of objects and associated fields found in that directory.

As part of this yaml file generation there are some items to be aware of:
- **"TODO" items:** Because this tool can only make decisions based upon what's found in the metadata and markjup, similiar to LLM tools, it requires a "Person in the Middle" to review sections of the yaml where a comment labled "TODO" is found. Before generating a fake data set from an expected yaml file, that yaml file should be reviewed for "TODO" items and have each TODO cleared based on the message. Sometimes the "TODO" message is to confirm that a field that was added to the yaml file did not have xml markup and is an OOTB field. Other times the "TODO" is needed to select which record type values to choose for a picklist field. There could be several record types for an object and generating data for that object requires choosing what associated record type choices to populate for the fake data set.
- **Handling of field files without xml markup:** For OOTB fields like AccountNumber or Name on the Account object, there is not detailed XML markup found in their field files. These occurrences are marked with a "TODO" item because they need to be either cleared or provided a faker value. For example, AccountNumber is an auto-generated field and doesn't need a faker value. However Account "Name" field will need a faker value, "${{ fake.company }}". In upcoming releases, there will be an auto mapper that handles OOTB objects and fields but for now requires a set of eyes to review the OOTB updates.
- **Record Type Picklist, Dependent Picklist, Multiselect Picklist Selections:** At the start of the yaml file generation for an object found in the project source, an expected structure is parsed in order to confirm if there are different Record Types associated with the object. Within the objects folder [there should be a structure (shown below)](https://github.com/jdschleicher/Salesforce-Data-Treecipe/edit/feature/handleLocalRecordTypeMarkup/README.md#example-directory-structure) that allows the yaml generation logic to parse the "recordTypes" directory and provide picklist faker options based on each record type:

**NOTE:** 

If this command is ran before "Initiate Configuration File" command, an exception will be handled and you a VSCode warning box will render showing an option to run the "Initiate Configuration File" command. 

There is also an option to "Report a Bug" if the initiation command has already been completed.

#### Prerequisite:
- **Generate Treecipe** will **not** work until you have completed the configuration step and selected a **Salesforce objects directory**.
- If the configuration file is missing or incomplete, you will be prompted to initiate the configuration first.

Once your configuration file and objects directory are set up, running this command will generate a custom tree structure to assist in your Salesforce development and data handling.


#### Corresponding Video:

https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-

---

 ### <a name="command3"></a> 3. **Salesforce Treecipe: Run Snowfakery by Recipe(Treecipe) to create FakeDataSet**
 
This command [prompts the user to select an existing recipe(Treecipe) file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file) to generate fake data from.

With the selection made, the snowfakery CLI will execute against they yaml file and produce json structured, production-like data which is then converted for usage with Salesforce [Collection Api](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_sobjects_collections_create.htm)

#### Corresponding Video:

https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file

---

 ### <a name="command4"></a> 4. **Salesforce Treecipe: Insert Data Set by Directory**
 
This command prompts the user for the following items:
1. Select a pre-existing "dataset" directory with expected Collections-Api structure files
2. Enter name of already locally authenticated Salesforce alis (DO NOT USE PRODUCTION ORG!!!)
3. Select "ALL OR NONE" option. 
   1. "false" will not perform any roll back and keep any successfully inserted records as is
   2. "true" will roll back all inserted records



---

### VIDEO WALKTHROUGHS:

#### Initiate Treecipe Configuration with expected Objects directory


https://github.com/user-attachments/assets/f8401f28-a04c-4abc-a56f-c860cce96dee


---

#### Generate Treecipe based on treecipe.config.jcon ( keep an eye out for OOTB fields and "REMOVE ME" lines )


https://github.com/user-attachments/assets/fd127b55-d434-4a73-9d65-cf4172fbce6f


---

#### Run Snowfakery by existing recipe yaml file


https://github.com/user-attachments/assets/d7dfcf70-70f8-4ce3-b254-280e2bbb0b7d



---

#### Insert Data Set by Directory





---


## Troubleshooting, Exception Handling, and Reporting Bugs


See below for troubleshooting when specific commands are not working:

- "**Salesforce Treecipe - Generate Treecipe - generateRecipeFromConfigurationDetail**": 
  - Ensure that you’ve successfully run **Initiate Configuration File** and selected a valid Salesforce objects directory. The **Generate Treecipe** command depends on the configuration file being present and properly set up.
  - Ensure the captured objects path in the **treecipe.config.json** has forward-slashes. In windows machines the path can be generated with double back-slashes and would need to be replaced with one forward-slash
  - Ensure the "defaultFakerService" property in the **treecipe.config.json** is set to "snowfakery"
  
- "**Salesforce Treecipe: Initiate Configuration File - initiateTreecipeConfigurationSetup**": 
  - Ensure an expected project directory was selected when prompted

**NOTE:**

All extension commands are wrapped in a try-catch and will prompt a "Report a Bug" that will auto-generate a GitHub Issue template for a bug that includes the stack trace. This would support quick turn-around time for known issues. 

See below for a video walkthough:




https://github.com/user-attachments/assets/dff4a3cb-e244-4959-9dec-dcf094f713c2




---


## Contributing

This project and codebase will be open-sourced shortly :)

---

## License

This extension is licensed under the [MIT License](LICENSE).

---

### <a name="install-snowfakery"></a> Install Snowfakery CLI


#### Snowfakery CLI Installation and Usage

#### Overview

Snowfakery is a tool for generating synthetic data. This document provides instructions for installing and using the Snowfakery CLI on any operating system.

#### Prerequisites

- **Python 3.8+** is required. You can verify your Python version by running:
  
  ```bash
  python --version
  ```

  If you need to install or upgrade Python, you can download the latest version from the official Python website:  
  [https://www.python.org/downloads/](https://www.python.org/downloads/).

- **pip** (Python package manager) should also be installed. You can follow the installation instructions here:  
  [https://pip.pypa.io/en/stable/installation/](https://pip.pypa.io/en/stable/installation/).

#### Installation

##### 1. Install Snowfakery via pip

To install Snowfakery globally, open your terminal or command prompt and run the following command:

```bash
pip install snowfakery
```

#### 2. Verify the Installation

After installation, verify that Snowfakery is installed by checking the version:

```bash
snowfakery --version
```

You should see the version number of Snowfakery printed in the terminal, confirming a successful installation.

#### Usage (Withou Salesforce Data Treecipe Extension)

Once installed, you can generate synthetic data by running Snowfakery from the command line:

```bash
snowfakery generate <path_to_your_snowfakery_recipe>
```

For more information about writing Snowfakery recipes and using the tool, please refer to the official documentation:  
[https://snowfakery.readthedocs.io/](https://snowfakery.readthedocs.io/)

#### Uninstalling Snowfakery

If you wish to uninstall Snowfakery, you can do so using pip:

```bash
pip uninstall snowfakery
```

