
import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';


export class ConfigurationService {
    
    static async getObjectsPathFromConfiguration() {

        const configurationDetail = await this.getConfigurationDetail();
        return configurationDetail.salesforceObjectsPath;

    }

    static async getConfigurationDetail() {
        const configurationFileName = this.getConfigurationFileName();
        const configurationDirectory = this.getDefaultTreecipeConfigurationFolder();
        const workspaceRoot = await this.getWorkspaceRoot();

        const fullConfigurationDirectoryPath = `${workspaceRoot}/${configurationDirectory}`;
        const configurationPath = path.join(fullConfigurationDirectoryPath, configurationFileName);
        
        let configurationJSON = null;
        try {
            configurationJSON = fs.readFileSync(configurationPath, 'utf-8');
        } catch(error) {
            console.log("A CONFIGURATION FILE WAS NOT PARSED. THE CONFIG MAY NOT YET EXIST. RUN THE COMMAND INITIATE CONFIGURATION")
        }

        const configurationDetail = JSON.parse(configurationJSON);
        return configurationDetail;
    }


    static async createConfigurationFile() {

        const workspaceRoot = await this.getWorkspaceRoot();

        const expectedObjectsPath = await this.promptForObjectsPath(workspaceRoot);
        if (!expectedObjectsPath) {
            return;
        };
        const configurationFileName = this.getConfigurationFileName();
        const configurationDetail = {
            salesforceObjectsPath: `${expectedObjectsPath}`
        };

        const treecipeBaseDirectory = this.getDefaultTreecipeConfigurationFolder();
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);
        const pathToCreateConfigurationFile = `${expectedTreecipeDirectoryPath}/${configurationFileName}`;
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);
        
    }
    
    static async promptForObjectsPath(workspaceRoot:string ): Promise<string | undefined> {

        console.log('Workspace Root:', workspaceRoot);

        if (!workspaceRoot) {
            void vscode.window.showErrorMessage('No workspace folder found');
            return undefined;
        }

        let currentPath = workspaceRoot;
        
        while (true) {
            
            const items = await this.getDirectoryItems(currentPath);
            
            const selection = await vscode.window.showQuickPick(
                items,
                {
                    placeHolder: 'Select directory that contains the Salesforce objects',
                    ignoreFocusOut: true
                }
            );

            if (!selection) {
                // IF NOT SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
                return undefined; 
            } else {
                return selection.label;
            }

        }
    }

    private static async getDirectoryItems(dirPath: string): Promise<vscode.QuickPickItem[]> {
        

        let items: vscode.QuickPickItem[] = [];
        items = await this.readdirRecursive(dirPath, items);
      

        return items;
    }

    private static async readdirRecursive(dirPath:string, items) {

        const workspaceRoot = await this.getWorkspaceRoot();

        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
  
            if (entry.isDirectory()) { 

                const fullMachinePathToEntry = entry.path;
                const currentDirectoryName = entry.name;

                const fullEntryPath = `${fullMachinePathToEntry}/${currentDirectoryName}`;
                const quickPickRelativePath = fullEntryPath.split(workspaceRoot)[1];
                const quickpickLabel = `.${quickPickRelativePath}/`;

                items.push({
                    label: quickpickLabel,
                    description: 'Directory',
                    iconPath: new vscode.ThemeIcon('folder')
                });

                const fullPath = path.join(dirPath, entry.name);
                console.log(fullPath);


                await this.readdirRecursive(fullPath, items);

            }
        }
      
        return items;

    }

    static getDefaultTreecipeConfigurationFolder() {
        const defaultTreecipeConfigurationFolder = ".treecipe";
        return defaultTreecipeConfigurationFolder;
    }

    static getConfigurationFileName() {
        const configurationFileName = ".treecipe.config.json";
        return configurationFileName;
    }
    
    static async getWorkspaceRoot() {
        const workspaceRoot:string = vscode.workspace.workspaceFolders
                                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                    : undefined;

        return workspaceRoot;
    }

}