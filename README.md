# Salesforce-Data-Recipe

**Salesforce-Data-Recipe** is a Visual Studio Code extension designed to streamline the process of generating production-like data during development in order to support building Quality in. This extension auto-generates a data-recipe yaml file based on what is already in the source object metadata xml of your project.

---

## Commands

### 1. **Salesforce Treecipe: Initiate Configuration File**
This command initiates the creation of a configuration file that is required before using other features of the extension.

#### How It Works:

- Select **"Salesforce Treecipe: Initiate Configuration File"** from the command palette.
- You will be prompted to type the **source directory** in your codebase where Salesforce objects are stored in source format. Begin typing the folder and the directories will auto-filter to match directories based on the entered text.

Once the configuration file is generated, you can begin using the **Generate Treecipe** command.

---

### 2. **Salesforce Treecipe: Generate Treecipe**
This command generates a **Treecipe**, a structured representation of your Salesforce data, based on your configuration.

#### Prerequisite:
- **Generate Treecipe** will **not** work until you have completed the configuration step and selected a **Salesforce objects directory**.
- If the configuration file is missing or incomplete, you will be prompted to initiate the configuration first.

Once your configuration file and objects directory are set up, running this command will generate a custom tree structure to assist in your Salesforce development and data handling.

---

#### VIDEO WALKTHROUGH 



https://github.com/user-attachments/assets/4b904d36-3c3c-401c-a047-8387800e504e



---

## Features

- **Easy Configuration Setup**: Define your Salesforce object directory in just a few steps.
- **Dynamic Tree Generation**: Once configured, quickly generate Treecipe data trees tailored to your project.

---

## Getting Started

### Installation
1. Open **Visual Studio Code**.
2. Go to the **Extensions** panel and search for **Salesforce-Data-Recipe**.
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

## Troubleshooting

- **"Generate Treecipe" not working**: Ensure that you’ve successfully run **Initiate Configuration File** and selected a valid Salesforce objects directory. The **Generate Treecipe** command depends on the configuration file being present and properly set up.
  
- **Missing Configuration File**: If the configuration file is missing, the **Generate Treecipe** command will prompt you to initiate the configuration first.

---

## Contributing

This project and codebase will be open-sourced shortly :)

---

## License

This extension is licensed under the [MIT License](LICENSE).
