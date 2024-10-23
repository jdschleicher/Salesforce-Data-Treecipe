import * as vscode from 'vscode';
import path = require('path');
import * as fs from 'fs';



export class VSCodeWorkspaceService {

    static async getWorkspaceRoot() {
        const workspaceRoot:string = vscode.workspace.workspaceFolders
                                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                    : undefined;

        return workspaceRoot;
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
                // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
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

        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();

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

}