
import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';


export class ConfigurationService {

    static async createConfigurationFile() {

        const expectedObjectsPath = await this.promptForObjectsPath();

        const configurationFileName = ".treecipe.config.json";
        const configurationDetail = {
            salesforceObjectsPath: `"${expectedObjectsPath}"`
        };

        const treecipeBaseDirectory = ".treecipe";
        if (!fs.existsSync(treecipeBaseDirectory)) {
            fs.mkdirSync(treecipeBaseDirectory);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);
        const pathToCreateConfigurationFile = `${treecipeBaseDirectory}/${configurationFileName}`;
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);
        
    }
    
    static async promptForObjectsPath(): Promise<string | undefined> {

        const workspaceRoot = vscode.workspace.workspaceFolders
                                ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                : undefined;

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

            if (selection.label === '..') {
                currentPath = path.dirname(currentPath);
            } else if (selection.label === '.') {
                // Check if 'objects' directory exists in the current path
                const objectsPath = path.join(currentPath, 'objects');
                if (fs.existsSync(objectsPath) && fs.statSync(objectsPath).isDirectory()) {
                    return path.relative(workspaceRoot, currentPath);
                } else {
                    void vscode.window.showErrorMessage('The selected directory does not contain an "objects" subdirectory.');
                }
            } else {
                currentPath = path.join(currentPath, selection.label);
            }


        }
    }

    private static async getDirectoryItems(dirPath: string): Promise<vscode.QuickPickItem[]> {
        const items: vscode.QuickPickItem[] = [
            { label: '.', description: 'Select this directory' },
            { label: '..', description: 'Go to parent directory' }
        ];

        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                items.push({
                    label: entry.name,
                    description: 'Directory',
                    iconPath: new vscode.ThemeIcon('folder')
                });
            }
        }

        return items;
    }

}