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

    static async getDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath:string, quickPickItems: vscode.QuickPickItem[]): Promise<vscode.QuickPickItem[]> {

        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();

        for (const entry of entries) {
  
            if ( this.isPossibleTreecipeUsableDirectory(entry) ) {

                const quickPickDirectoryItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry, workspaceRoot);
                quickPickItems.push(quickPickDirectoryItem);

                const fullPath = path.join(directoryPath, entry.name);
                await this.getDirectoryQuickPickItemsByStartingDirectoryPath(fullPath, quickPickItems);

            }

        }
      
        return quickPickItems;

    }

    static async getDataSetDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath:string, quickPickItems: vscode.QuickPickItem[]): Promise<vscode.QuickPickItem[]> {

        const datasetEntries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();

        const selectedFakerService = ConfigurationService.getSelectedDataFakerServiceConfig();
        const expectedFakerJSDirectoryName = 'dataset-fakerjs';
        const expectedSnowfakeryDirectoryName = 'dataset';
        const isFakerJS = (selectedFakerService === 'faker-js');
        const isSnowfakery = (selectedFakerService === 'snowfakery');

        for (const entry of datasetEntries) {

            const isFakerJSDatasetWhenFakerJSSelected = (isFakerJS && entry.name.includes(expectedFakerJSDirectoryName));
            const isSnowfakeryDatasetWhenSnowfakerySelected = (isSnowfakery 
                                                                && entry.name.includes(expectedSnowfakeryDirectoryName)
                                                                && !(entry.name.includes(expectedFakerJSDirectoryName)));

            if ( isFakerJSDatasetWhenFakerJSSelected || isSnowfakeryDatasetWhenSnowfakerySelected ) {

                const quickPickDirectoryItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry, workspaceRoot);
                quickPickItems.push(quickPickDirectoryItem);

            }
  
        }
      
        return quickPickItems;

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

    static buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry: fs.Dirent, workspaceRoot: string) {
        
        const fullMachinePathToEntry = entry.path;
        const currentDirectoryName = entry.name;

        const fullEntryPath = `${fullMachinePathToEntry}/${currentDirectoryName}`;
        const quickPickRelativePath = fullEntryPath.split(workspaceRoot)[1];
        const quickpickLabel = `.${quickPickRelativePath}/`;

        const quickPickItem = {
            label: quickpickLabel,
            description: 'Directory',
            iconPath: new vscode.ThemeIcon('folder'),
            detail: fullEntryPath
        };

        return quickPickItem;

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
            return fakerServiceSelection.label;
        }

    }

    static async promptForDirectoryToGenerateQuickItemsForFileSelection(directoryPathToParseSearchForRecipeFilesFrom: string, vsCodeQuickPickItemPromptLabel: string): Promise<vscode.QuickPickItem | undefined> {

        const workspaceRoot = this.getWorkspaceRoot();
        const generatedRecipesFolderPath = `${workspaceRoot}/${directoryPathToParseSearchForRecipeFilesFrom}`;

        let availableRecipeFileQuickPickitems: vscode.QuickPickItem[] = [];
        const quickPickItems = await this.getAvailableRecipeFileQuickPickItemsByDirectory(availableRecipeFileQuickPickitems, generatedRecipesFolderPath);
        availableRecipeFileQuickPickitems.concat(quickPickItems);

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

    static async getAvailableRecipeFileQuickPickItemsByDirectory(recipeFileQuickPickItems: vscode.QuickPickItem[], folderPathToParse: string) {

        const selectedDataFakerService = ConfigurationService.getSelectedDataFakerServiceConfig();
        const expectedFakerJSRecipeFileIndicator = 'recipe-fakerjs';

        const entries = await fs.promises.readdir(folderPathToParse, { withFileTypes: true });
        for (const entry of entries) {
  
            if (entry.isFile() && 
                ( path.extname(entry.name) === '.yaml' || path.extname(entry.name) === '.yml' )) {

                const isFakerJSFileWithSnowfakerySelectedAsFakerService = (selectedDataFakerService === 'snowfakery' && entry.name.includes(expectedFakerJSRecipeFileIndicator));
                const isNotFakerJSFileWithFakerJSAsFakerService = (selectedDataFakerService === 'faker-js' && !entry.name.includes(expectedFakerJSRecipeFileIndicator));
                if (isFakerJSFileWithSnowfakerySelectedAsFakerService || isNotFakerJSFileWithFakerJSAsFakerService) {
                    // IF THERE IS A MISMATCH BETWEEN THE CURRENT SELECTED FAKER SERVICE AND THE DIRECTORY NAME THAT INDICATES WHAT FAKER SERVICE WAS USED TO GENERATE FAKER EXPRESSIONS 
                    // THEN DO NOT INCLUDE THIS DIRECTORY IN THE RESULTING RECIPES TO PROCESS
                    continue;
                }

                const quickpickLabel = `${entry.name}`; 
                const fullFilePathName = path.join(entry.path, entry.name);
                recipeFileQuickPickItems.push({
                    label: quickpickLabel,
                    description: 'File',
                    iconPath: new vscode.ThemeIcon('file'),
                    detail: fullFilePathName
                });

            } else if ( entry.isDirectory()) {
                
                const recipeDirectoryPathToParseUri = path.join(folderPathToParse, entry.name);

                const isFakerJSDirectoryWithSnowfakerySelectedAsFakerService = (selectedDataFakerService === 'snowfakery' && recipeDirectoryPathToParseUri.includes(expectedFakerJSRecipeFileIndicator));
                const isNotFakerJSDirectoryWithFakerJSAsFakerService = (selectedDataFakerService === 'faker-js' && !recipeDirectoryPathToParseUri.includes(expectedFakerJSRecipeFileIndicator));
                if (isFakerJSDirectoryWithSnowfakerySelectedAsFakerService || isNotFakerJSDirectoryWithFakerJSAsFakerService) {
                    // IF THERE IS A MISMATCH BETWEEN THE CURRENT SELECTED FAKER SERVICE AND THE DIRECTORY NAME THAT INDICATES WHAT FAKER SERVICE WAS USED TO GENERATE FAKER EXPRESSIONS 
                    // THEN DO NOT INCLUDE THIS DIRECTORY IN THE RESULTING RECIPES TO PROCESS
                    continue;
                }
                
                const recipeFileVSCodeItems: vscode.QuickPickItem[] = await this.getAvailableRecipeFileQuickPickItemsByDirectory(recipeFileQuickPickItems, recipeDirectoryPathToParseUri);
                if ( recipeFileVSCodeItems.length > 0 ) {
                    recipeFileQuickPickItems.concat(recipeFileVSCodeItems);
                }

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

    static async getFileContentByPath(filePath: string) {

        const fileUri = vscode.Uri.file(filePath);
        const fileContentUriData = await vscode.workspace.fs.readFile(fileUri);
        const fileContent = Buffer.from(fileContentUriData).toString('utf8');
        return fileContent;

    }

    static getNowIsoDateTimestamp() {
        // expecting format '2024-11-25T16-24-15'
        return (
            new Date().toISOString().split(".")[0].replace(/:/g,"-")
        ); 
    }

    static async getFilesInDirectory(directoryToGetFilesFrom: string): Promise<string[]> {

        const entries = await fs.promises.readdir(directoryToGetFilesFrom, { withFileTypes: true });
       
        const filesFromDirectory: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(directoryToGetFilesFrom, entry.name);
            if (entry.isFile()) {
                filesFromDirectory.push(fullPath);
            }
        }

        return filesFromDirectory;

    }

    static createUniqueTimeStampedFakeDataSetsFolderName(uniqueTimeStampedFakeDataSetsFolderName: string):string {

        const fakeDataSetsFolderPath = ConfigurationService.getFakeDataSetsFolderPath();
        const workspaceRoot = this.getWorkspaceRoot();
        const expectedFakeDataSetsFolerPath = `${workspaceRoot}/${fakeDataSetsFolderPath}`;

        if (!fs.existsSync(expectedFakeDataSetsFolerPath)) {
            fs.mkdirSync(expectedFakeDataSetsFolerPath);
        }

        const fullPathToUniqueTimeStampedFakeDataSetsFolder = `${expectedFakeDataSetsFolerPath}/${uniqueTimeStampedFakeDataSetsFolderName}`;
        fs.mkdirSync(`${fullPathToUniqueTimeStampedFakeDataSetsFolder}`);

        return fullPathToUniqueTimeStampedFakeDataSetsFolder;

    }

    static createFakeDatasetsTimeStampedFolderName(isoDateTimestamp):string {
        
        let fakeDataSetsFolderName = '';
        const selectedDataFakerService = ConfigurationService.getSelectedDataFakerServiceConfig();
        if ( selectedDataFakerService === 'faker-js' ) {
            fakeDataSetsFolderName = `dataset-fakerjs-${isoDateTimestamp}`;
        } else {
            fakeDataSetsFolderName = `dataset-${isoDateTimestamp}`;
        }

        return fakeDataSetsFolderName;

    }

    static async openFileInEditor(filePath: string) {

        try {

          const uri = vscode.Uri.file(filePath);
          const document = await vscode.workspace.openTextDocument(uri); 
          await vscode.window.showTextDocument(document);     

        } catch (error) {

          vscode.window.showErrorMessage(`Failed to open file: ${filePath} - ${error}`);
          
        }
    }

    static showWarningMessage(message: string) {

        vscode.window.showWarningMessage(message);

    }
    
}