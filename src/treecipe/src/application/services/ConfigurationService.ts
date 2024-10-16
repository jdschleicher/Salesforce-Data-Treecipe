
import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';


export class ConfigurationService {

    static async createConfigurationFile() {

        const workspaceRoot = vscode.workspace.workspaceFolders
                                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                    : undefined;

        const expectedObjectsPath = await this.promptForObjectsPath(workspaceRoot);
        
        const configurationFileName = ".treecipe.config.json";
        const configurationDetail = {
            salesforceObjectsPath: `"${expectedObjectsPath}"`
        };

        const treecipeBaseDirectory = ".treecipe";
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);
        // if (!vscode.workspace.fs.stat(treecipeBaseDirectoryUri)) {
        //     await vscode.workspace.fs.createDirectory(treecipeBaseDirectoryUri);
        // }

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);
        const pathToCreateConfigurationFile = `${expectedTreecipeDirectoryPath}/${configurationFileName}`;
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);

        // const treecipeConfigUri = vscode.Uri.file(pathToCreateConfigurationFile);
        // const encodedData = new TextEncoder().encode(configurationJsonData); // Convert string to Uint8Array
    
        // try {
        //     await vscode.workspace.fs.writeFile(treecipeConfigUri, encodedData);
        //     vscode.window.showInformationMessage(`Configuration file created at: ${pathToCreateConfigurationFile}`);
        // } catch (error) {
        //     vscode.window.showErrorMessage(`Failed to create configuration file: ${error}`);
        // }
        
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
                return undefined; // User cancelled
            }

            const objectsPath = selection.label;
            if (fs.existsSync(objectsPath) && fs.statSync(objectsPath).isDirectory()) {
                return objectsPath;
            } else {
                void vscode.window.showErrorMessage('The selected directory does not contain an "objects" subdirectory.');
            }

        }
    }

    private static async getDirectoryItems(dirPath: string): Promise<vscode.QuickPickItem[]> {
        // const items: vscode.QuickPickItem[] = [
        //     { label: '.', description: 'Select this directory' },
        //     { label: '..', description: 'Go to parent directory' }
        // ];
        

        // const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        let items: vscode.QuickPickItem[] = [];
        items = await this.readdirRecursive(dirPath, items);
      

        return items;
    }

    private static async readdirRecursive(dirPath, items) {


        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {

            if (entry.isDirectory()) {

                items.push({
                    label: entry.path,
                    description: 'Directory',
                    iconPath: new vscode.ThemeIcon('folder')
                });

                const fullPath = path.join(dirPath, entry.name);
                await this.readdirRecursive(fullPath, items);

            }
        }
      
        return items;

      }

}