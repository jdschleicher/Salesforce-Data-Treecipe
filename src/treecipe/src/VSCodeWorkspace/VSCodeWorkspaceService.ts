import * as vscode from 'vscode';
import path = require('path');
import * as fs from 'fs';
import * as os from 'os';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IAuthenticatedOrgDetail } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';


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

                const quickPickDirectoryItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry, workspaceRoot, directoryPath);
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

                const quickPickDirectoryItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry, workspaceRoot, directoryPath);
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

    static buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry: fs.Dirent, workspaceRoot: string, parentDirectoryPath: string) {

        // parentDirectoryPath is supplied by the caller rather than read from the deprecated
        // fs.Dirent.path (DEP0178), which returns undefined in recent Electron/Node runtimes
        const fullMachinePathToEntry = parentDirectoryPath;
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
                // folderPathToParse (the readdir argument) is the entry's parent directory; the
                // deprecated fs.Dirent.path (DEP0178) returns undefined in recent Electron/Node
                // runtimes, and path.join(undefined, ...) would throw
                const fullFilePathName = path.join(folderPathToParse, entry.name);
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

    /*
        Opens VS Code's own diff editor between a file on disk and content that has not been written
        yet, so a regeneration can be reviewed -- and cancelled -- before it replaces a hand edit.

        The proposed side is staged in a temp file because vscode.diff takes two URIs, and the only
        alternative is registering a TextDocumentContentProvider for a custom scheme at activation.
        A temp file needs nothing from activation and gives the diff editor a real document. The
        file name carries the generated class name so the diff tab reads as that class rather than
        as a random temp path.

        Returns whether the diff opened. A failure here must not abort generation: the diff is a
        convenience on the way to a decision the user still gets to make from the report.
    */
    static async showDiffForProposedContent(existingFilePath: string, proposedContent: string, diffEditorTitle: string): Promise<boolean> {

        try {

            const proposedContentDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-proposed-'));
            const proposedContentFilePath = path.join(proposedContentDirectoryPath, path.basename(existingFilePath));
            fs.writeFileSync(proposedContentFilePath, proposedContent);

            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(existingFilePath),
                vscode.Uri.file(proposedContentFilePath),
                diffEditorTitle
            );

            return true;

        } catch (error) {

            vscode.window.showErrorMessage(`Could not open a diff for "${existingFilePath}": ${error}`);
            return false;

        }

    }

    static getParentPath(pathToRemoveLastSegmentFrom: string): string {

        // IF THERE IS A FORWARD SLASH AT THE END OF THE PATH STRING , REMOVE IT
        const pathWithoutTrailingForwardSlash = pathToRemoveLastSegmentFrom.replace(/\/$/, '');

        const parentDirectoryPathSlashIndex = pathWithoutTrailingForwardSlash.lastIndexOf('/');
        const parentDirectoryPath = parentDirectoryPathSlashIndex > 0 ? pathWithoutTrailingForwardSlash.substring(0, parentDirectoryPathSlashIndex) : '';

        return parentDirectoryPath;

    }

    static buildAuthenticatedOrgQuickPickItems(authenticatedOrgDetails: IAuthenticatedOrgDetail[]): vscode.QuickPickItem[] {

        return authenticatedOrgDetails.map(authenticatedOrgDetail => ({
            label: authenticatedOrgDetail.alias || authenticatedOrgDetail.username,
            // THE USERNAME IS SHOWN EVEN WHEN IT IS THE LABEL SO TWO ALIASES ON ONE ORG STAY TELLABLE APART
            description: authenticatedOrgDetail.username,
            detail: authenticatedOrgDetail.targetOrgIdentifier
        }));

    }

    /*
        Returns undefined both when the user dismisses the quick pick and when no orgs are
        authenticated. The two are distinguished before this is called -- an empty quick pick would
        otherwise render as a list with nothing in it and no explanation of why.
    */
    static async promptForAuthenticatedTargetOrg(authenticatedOrgDetails: IAuthenticatedOrgDetail[]): Promise<string | undefined> {

        const orgQuickPickItems = this.buildAuthenticatedOrgQuickPickItems(authenticatedOrgDetails);

        const selectedOrgQuickPickItem = await vscode.window.showQuickPick(orgQuickPickItems, {
            placeHolder: 'Select the Salesforce org to check picklist dependencies against',
            ignoreFocusOut: true
        });

        return selectedOrgQuickPickItem?.detail;

    }

    /*
        One channel is reused across runs and cleared on each invocation, so what is on screen always
        belongs to the run that just finished rather than being appended to older output.

        Created lazily rather than at activation so a user who never runs the check never pays for it,
        and registered against the extension context on first use so VS Code disposes it on reload.
    */
    private static picklistDependencyCheckOutputChannel: vscode.OutputChannel;

    private static extensionSubscriptions: { push(disposable: vscode.Disposable): void };

    static registerExtensionSubscriptions(subscriptions: { push(disposable: vscode.Disposable): void }) {
        this.extensionSubscriptions = subscriptions;
    }

    static getPicklistDependencyCheckOutputChannel(): vscode.OutputChannel {

        if ( !this.picklistDependencyCheckOutputChannel ) {

            this.picklistDependencyCheckOutputChannel = vscode.window.createOutputChannel('Picklist Dependency Check');

            /*
                Nothing registers subscriptions in a jest run, so the channel is simply not tracked
                there -- an untracked channel in a test process has nothing to leak into.
            */
            this.extensionSubscriptions?.push(this.picklistDependencyCheckOutputChannel);

        }

        return this.picklistDependencyCheckOutputChannel;

    }

    static showPicklistDependencyCheckReport(report: string) {

        const outputChannel = this.getPicklistDependencyCheckOutputChannel();

        outputChannel.clear();
        outputChannel.appendLine(report);
        outputChannel.show(true);

    }

}