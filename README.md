# Salesforce-Data-Treecipe

**Salesforce-Data-Treecipe** is a Visual Studio Code extension designed to streamline the process of generating production-like data during development in order to support building Quality in. This extension auto-generates a recipe yaml file based on what is already in the source object metadata xml of your project.

---

## Get Started by following the below commands:

1. [Initiate Configuration File](#command1)
2. [Generate Treecipe](#command2)
3. [Run Snowfakery by Recipe(Treecipe)](#command3)

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

---

### 2.<a name="command2"></a> **Salesforce Treecipe: Generate Treecipe**
This command [generates a **Treecipe**](https://github.com/jdschleicher/Salesforce-Data-Treecipe/tree/main#generate-treecipe-based-on-treecipeconfigjcon--keep-an-eye-out-for-ootb-fields-and-remove-me-lines-), a structured representation of your Salesforce data, based on your configuration.

It parses the "salesforceObjectsPath" directory path that was provided when running the "Initiate Configuration File" command above and generate a yaml file of objects and associated fields.

**NOTE:** 

If this command is ran before "Initiate Configuration File" command, an exception will be handled and you a VSCode warning box will render showing an option to run the "Initiate Configuration File" command. 

There is also an option to "Report a Bug" if the initiation command has already been completed.

#### Prerequisite:
- **Generate Treecipe** will **not** work until you have completed the configuration step and selected a **Salesforce objects directory**.
- If the configuration file is missing or incomplete, you will be prompted to initiate the configuration first.

Once your configuration file and objects directory are set up, running this command will generate a custom tree structure to assist in your Salesforce development and data handling.

---

 ### <a name="command3"></a> 3. **Salesforce Treecipe: Run Snowfakery by Recipe(Treecipe)**
 
This command [prompts the user to select an existing recipe(Treecipe) file](https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/README.md#run-snowfakery-by-existing-recipe-yaml-file) to generate fake data from.

With the selection made, the snowfakery CLI will execute against they yaml file and produce json structured, production-like data which is then converted for usage with Salesforce [Collection Api](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_sobjects_collections_create.htm)


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

## Features

- **Easy Configuration Setup**: Define your Salesforce object directory in just a few steps.
- **Dynamic Tree Generation**: Once configured, quickly generate Treecipe data trees tailored to your project.

---

## Getting Started

### Installation
1. Open **Visual Studio Code**.
2. Go to the **Extensions** panel and search for **Salesforce-Data-Treecipe**.
3. Click **Install**.

### Usage
1. After installation, press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.
2. Choose one of the following commands:
   - **Initiate Configuration File**: Set up your Salesforce object directory.
   - **Generate Treecipe**: Generate a tree based on the configuration.

---

## Configuration

After running **Initiate Configuration File**, you will be prompted to choose the **source directory** in your codebase where Salesforce objects are stored. This directory must be in **source format**.

### Example Directory Structure:

```plaintext
my-project/
├── force-app/
│   └── main/
│       └── default/
│           └── objects/
│               ├── Account.object-meta.xml
│               ├── Contact.object-meta.xml
│               └── ...

```

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
