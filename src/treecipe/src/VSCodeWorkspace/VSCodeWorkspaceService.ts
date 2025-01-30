import * as vscode from 'vscode';
import path = require('path');
import * as fs from 'fs';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';


export class VSCodeWorkspaceService {

    static getWorkspaceRoot():string {

        const workspaceRoot:string = vscode.workspace.workspaceFolders
                                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                                    : undefined;

        if (!workspaceRoot) {
            void vscode.window.showErrorMessage('No workspace folder found');
            return undefined;
        }

        return workspaceRoot;
    }

    static async promptForObjectsPath(workspaceRoot:string ): Promise<string | undefined> {

        let currentPath = workspaceRoot;
        while (true) {
            
            const items = await this.getPotentialTreecipeObjectDirectoryPathsQuickPickItems(currentPath);
            
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

    static async getPotentialTreecipeObjectDirectoryPathsQuickPickItems(dirPath: string): Promise<vscode.QuickPickItem[]> {
        
        let items: vscode.QuickPickItem[] = [];
        items = await this.getDirectoryQuickPickItemsByStartingDirectoryPath(dirPath, items);
      
        return items;

    }

    static async getDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath:string, items): Promise<vscode.QuickPickItem[]> {

        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
  
            if ( this.isPossibleTreecipeUsableDirectory(entry) ) {

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

                const fullPath = path.join(directoryPath, entry.name);
                console.log(fullPath);

                await this.getDirectoryQuickPickItemsByStartingDirectoryPath(fullPath, items);

            }

        }
      
        return items;

    }

    static isPossibleTreecipeUsableDirectory(entry: fs.Dirent):boolean {
      
        return (
            entry.isDirectory() 
            && !( entry.name.includes("node_modules") || this.isHiddenFolder(entry.name))
        );     
        
    }

    static isHiddenFolder(folderName: string): boolean {
        return folderName.startsWith('.');
    }

    static async promptForFakerServiceImplementation(): Promise<string | undefined> {
        
        let items: vscode.QuickPickItem[] = [
            {
                label: 'snowfakery',
                description: 'CumulusCI Python port of Faker - https://snowfakery.readthedocs.io/en/latest/',
                iconPath: new vscode.ThemeIcon('database')
            },
            {
                label: 'faker-js',
                description: 'Javascript port of Faker - https://fakerjs.dev/',
                iconPath: new vscode.ThemeIcon('database')
            }
        ];
            
        const fakerServiceSelection = await vscode.window.showQuickPick(
            items,
            {
                placeHolder: 'Select Data Faker Service',
                ignoreFocusOut: true
            }
        );

        if (!fakerServiceSelection) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return undefined; 
        } else {

            ConfigurationService.setExtensionConfigValue('selectedFakerService', fakerServiceSelection.label);
            return fakerServiceSelection.label;
        }

    }

    static async promptForDirectoryToGenerateQuickItemsForFileSelection(directoryPathToParseFilesFrom: string, vsCodeQuickPickItemPromptLabel: string): Promise<vscode.QuickPickItem | undefined> {

        const workspaceRoot = this.getWorkspaceRoot();
        const generatedRecipesFolderPath = `${workspaceRoot}/${directoryPathToParseFilesFrom}`;

        const availableRecipeFileQuickPickitems: vscode.QuickPickItem[] = await this.getAvailableFileQuickPickItemsByDirectory(generatedRecipesFolderPath);
        
        const selection = await vscode.window.showQuickPick(
            availableRecipeFileQuickPickitems,
            {
                placeHolder: vsCodeQuickPickItemPromptLabel,
                ignoreFocusOut: true
            }
        );

        if (!selection) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return undefined; 
        }
        
        return selection;    

    }

    static async getAvailableFileQuickPickItemsByDirectory(folderPathToParse: string) {

        let recipeFileQuickPickItems: vscode.QuickPickItem[] = [];
        const entries = await fs.promises.readdir(folderPathToParse, { withFileTypes: true });
        for (const entry of entries) {
  
            if (entry.isFile()) {

                const quickpickLabel = `${entry.name}`; 
                const fullFilePathName = path.join(entry.path, entry.name);
                recipeFileQuickPickItems.push({
                    label: quickpickLabel,
                    description: 'File',
                    iconPath: new vscode.ThemeIcon('file'),
                    detail: fullFilePathName
                });

            }

        }
      
        return recipeFileQuickPickItems;

    }

    static async promptForUserInput(userPromptForInputMessage: string) {

        const userResponse = await vscode.window.showInputBox({
            placeHolder: userPromptForInputMessage
        });

        return userResponse;

    }
    

}