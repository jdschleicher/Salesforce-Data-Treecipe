import * as vscode from 'vscode';
import path = require('path');
import * as fs from 'fs';
import * as os from 'os';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IAuthenticatedOrgDetail } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';


/*
    The narrow port the directory walk reports through. Two plain functions and no vscode type, so
    the walk's reporting and its stopping point are testable without a withProgress double.
*/
export interface IDirectoryScanProgress {
    report(message: string): void;
    isCancellationRequested(): boolean;
}

export interface IObjectsDirectoryScanRoots {
    scanRootPaths: string[];
    isSeededFromSfdxProject: boolean;
}

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

    /*
        The label of the item that abandons the sfdx-project.json seeding and walks the whole
        workspace. Compared by identity when the first picker closes, so it must not collide with
        a directory label -- every one of those is built as "./<relative path>/".
    */
    static readonly browseAllWorkspaceDirectoriesLabel = 'Browse all workspace directories...';

    // BOUNDS THE .items ROUND TRIPS DESCRIBED IN showObjectsDirectoryQuickPick
    static readonly maxPendingQuickPickItems = 200;
    static readonly quickPickFlushIntervalMilliseconds = 100;

    /*
        Opens the picker FIRST and fills it as the walk finds directories.

        The old shape built the entire item list before calling showQuickPick, so a workspace-wide
        recursive readdir ran with nothing on screen -- and the notification whose button started
        this has already been dismissed by VS Code, which offers no way to keep it open or put a
        spinner in it. A busy quick pick is the only surface that can appear before the work is
        done; the progress notification alongside it is what carries the cancel affordance.
    */
    static async promptForObjectsPath(workspaceRoot:string ): Promise<string | undefined> {

        const objectsDirectoryScanRoots = this.resolveObjectsDirectoryScanRoots(workspaceRoot);
        const selectedLabel = await this.showObjectsDirectoryQuickPick(workspaceRoot, objectsDirectoryScanRoots);

        if ( selectedLabel !== this.browseAllWorkspaceDirectoriesLabel ) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return selectedLabel;
        }

        return await this.showObjectsDirectoryQuickPick(
            workspaceRoot,
            { scanRootPaths: [workspaceRoot], isSeededFromSfdxProject: false }
        );

    }

    /*
        Where the walk starts. packageDirectories entries when sfdx-project.json names usable ones,
        and the workspace root otherwise -- a user who is not in a DX project must still get the
        full walk, which is why this reads the project file through the tolerant resolver rather
        than PicklistDependencyTestService.resolveDefaultPackageDirectoryPath, which throws.
    */
    static resolveObjectsDirectoryScanRoots(workspaceRoot: string): IObjectsDirectoryScanRoots {

        const resolvedPackageDirectories = SfdxProjectService.resolvePackageDirectoryPaths(workspaceRoot);

        if ( resolvedPackageDirectories.unreadableProjectFileMessage ) {
            this.showWarningMessage(`${resolvedPackageDirectories.unreadableProjectFileMessage} Every directory in the workspace will be listed instead.`);
        }

        if ( resolvedPackageDirectories.packageDirectoryPaths.length === 0 ) {
            return { scanRootPaths: [workspaceRoot], isSeededFromSfdxProject: false };
        }

        return {
            scanRootPaths: resolvedPackageDirectories.packageDirectoryPaths,
            isSeededFromSfdxProject: true
        };

    }

    /*
        The user's answer ends this, NOT the scan.

        An earlier shape awaited the whole walk and only then awaited the selection, which put the
        stall this command exists to remove back one layer down: accepting an item 200ms in closed
        the picker and then waited for every remaining directory. Worse, a Cancel after that point
        discarded the selection the user had already made and wrote no config at all.

        So the two are raced, and a response is itself a reason to stop walking -- the walk's
        cancellation predicate ORs it in, and the detached remainder unwinds at its next check
        without touching a picker that is on its way out.
    */
    private static async showObjectsDirectoryQuickPick(workspaceRoot: string,
                                                        objectsDirectoryScanRoots: IObjectsDirectoryScanRoots): Promise<string | undefined> {

        const objectsDirectoryQuickPick = vscode.window.createQuickPick();
        objectsDirectoryQuickPick.placeholder = objectsDirectoryScanRoots.isSeededFromSfdxProject
                                                ? 'Select directory that contains the Salesforce objects - options from packageDirectories in sfdx-project.json'
                                                : 'Select directory that contains the Salesforce objects';
        objectsDirectoryQuickPick.ignoreFocusOut = true;
        objectsDirectoryQuickPick.busy = true;

        const discoveredQuickPickItems: vscode.QuickPickItem[] = objectsDirectoryScanRoots.isSeededFromSfdxProject
                                                                ? [ this.buildBrowseAllWorkspaceDirectoriesQuickPickItem() ]
                                                                : [];
        objectsDirectoryQuickPick.items = [...discoveredQuickPickItems];
        objectsDirectoryQuickPick.show();

        let userHasRespondedToPicker = false;

        const objectsDirectorySelection = new Promise<string | undefined>((resolveSelection) => {

            objectsDirectoryQuickPick.onDidAccept(() => {
                userHasRespondedToPicker = true;
                resolveSelection(objectsDirectoryQuickPick.selectedItems[0]?.label);
                objectsDirectoryQuickPick.hide();
            });

            objectsDirectoryQuickPick.onDidHide(() => {
                userHasRespondedToPicker = true;
                resolveSelection(undefined);
            });

        });

        /*
            Assigning .items is an ext-host to renderer round trip that re-sends the WHOLE list and
            re-runs the filter, so doing it per directory is quadratic in the payload on exactly the
            large workspaces this command targets. Batching bounds it, and the active item is
            restored across the assignment because VS Code resets the highlight to the top -- which
            would otherwise drag the user's selection away from them mid-scan.
        */
        let pendingDiscoveredItemCount = 0;
        let lastItemFlushTime = Date.now();

        const flushDiscoveredItems = () => {

            if ( userHasRespondedToPicker || pendingDiscoveredItemCount === 0 ) {
                return;
            }

            const activeQuickPickItem = objectsDirectoryQuickPick.activeItems[0];
            objectsDirectoryQuickPick.items = [...discoveredQuickPickItems];

            if ( activeQuickPickItem ) {
                objectsDirectoryQuickPick.activeItems = [activeQuickPickItem];
            }

            pendingDiscoveredItemCount = 0;
            lastItemFlushTime = Date.now();

        };

        const onItemDiscovered = (discoveredQuickPickItem: vscode.QuickPickItem) => {

            if ( userHasRespondedToPicker ) {
                return;
            }

            discoveredQuickPickItems.push(discoveredQuickPickItem);
            pendingDiscoveredItemCount++;

            const flushIsDue = (pendingDiscoveredItemCount >= this.maxPendingQuickPickItems)
                                || ((Date.now() - lastItemFlushTime) >= this.quickPickFlushIntervalMilliseconds);

            if ( flushIsDue ) {
                flushDiscoveredItems();
            }

        };

        try {

            const scanCompletion = this.runObjectsDirectoryScanWithProgress(
                workspaceRoot,
                objectsDirectoryScanRoots,
                onItemDiscovered,
                () => userHasRespondedToPicker
            ).then((wasCancelledByUser) => {
                flushDiscoveredItems();
                if ( !userHasRespondedToPicker ) {
                    objectsDirectoryQuickPick.busy = false;
                }
                return wasCancelledByUser;
            });

            // A RESPONSE WINS THE RACE AND IS NEVER A SCAN CANCELLATION, WHICH IS WHY IT YIELDS false
            const scanWasCancelled = await Promise.race([
                scanCompletion,
                objectsDirectorySelection.then(() => false)
            ]);

            if ( scanWasCancelled && !userHasRespondedToPicker ) {
                objectsDirectoryQuickPick.hide();
                return undefined;
            }

            return await objectsDirectorySelection;

        } finally {
            // REACHED ON A readdir REJECTION TOO, WHICH OTHERWISE LEFT A BUSY PICKER ON SCREEN FOREVER
            userHasRespondedToPicker = true;
            objectsDirectoryQuickPick.dispose();
        }

    }

    /*
        ProgressLocation.Notification rather than Window for the same reason the picklist dependency
        commands chose it: Window "supports neither cancellation nor discrete progress", so the
        token it hands you never fires and a workspace-wide walk could not be called off.

        The port handed to the walk is two plain functions and no vscode type, so what the walk
        reports and where it stops are testable without a withProgress double.
    */
    private static async runObjectsDirectoryScanWithProgress(workspaceRoot: string,
                                                                objectsDirectoryScanRoots: IObjectsDirectoryScanRoots,
                                                                onItemDiscovered: (discoveredQuickPickItem: vscode.QuickPickItem) => void,
                                                                hasUserResponded: () => boolean = () => false): Promise<boolean> {

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Treecipe: Initiate Configuration File',
            cancellable: true
        }, async (progress, cancellationToken) => {

            progress.report({
                message: objectsDirectoryScanRoots.isSeededFromSfdxProject
                            ? 'Scanning packageDirectories from sfdx-project.json...'
                            : 'Scanning workspace directories...'
            });

            const directoryScanProgress: IDirectoryScanProgress = {
                report: (message: string) => progress.report({ message }),
                // A RESPONSE STOPS THE WALK, BUT ONLY THE TOKEN COUNTS AS A CANCELLATION BELOW
                isCancellationRequested: () => cancellationToken.isCancellationRequested || hasUserResponded()
            };

            await this.collectObjectDirectoryQuickPickItems(
                objectsDirectoryScanRoots.scanRootPaths,
                workspaceRoot,
                onItemDiscovered,
                directoryScanProgress
            );

            return cancellationToken.isCancellationRequested;

        });

    }

    static buildBrowseAllWorkspaceDirectoriesQuickPickItem(): vscode.QuickPickItem {

        return {
            label: this.browseAllWorkspaceDirectoriesLabel,
            description: 'Scan every directory in the workspace instead',
            iconPath: new vscode.ThemeIcon('search')
        };

    }

    /*
        A scan root that is not the workspace root is itself offered as an option -- the walk only
        yields descendants, and a packageDirectories entry pointing straight at an objects
        directory would otherwise be the one directory missing from the list.
    */
    static async collectObjectDirectoryQuickPickItems(scanRootPaths: string[],
                                                        workspaceRoot: string,
                                                        onItemDiscovered?: (discoveredQuickPickItem: vscode.QuickPickItem) => void,
                                                        directoryScanProgress?: IDirectoryScanProgress): Promise<vscode.QuickPickItem[]> {

        const collectedQuickPickItems: vscode.QuickPickItem[] = [];

        for ( const scanRootPath of scanRootPaths ) {

            if ( directoryScanProgress?.isCancellationRequested() ) {
                break;
            }

            if ( scanRootPath !== workspaceRoot ) {

                const scanRootQuickPickItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryPath(scanRootPath, workspaceRoot);
                collectedQuickPickItems.push(scanRootQuickPickItem);
                onItemDiscovered?.(scanRootQuickPickItem);

            }

            await this.getDirectoryQuickPickItemsByStartingDirectoryPath(
                scanRootPath,
                collectedQuickPickItems,
                onItemDiscovered,
                directoryScanProgress,
                workspaceRoot
            );

        }

        return collectedQuickPickItems;

    }

    static async getPotentialTreecipeObjectDirectoryPathsQuickPickItems(dirPath: string): Promise<vscode.QuickPickItem[]> {
        
        let items: vscode.QuickPickItem[] = [];
        items = await this.getDirectoryQuickPickItemsByStartingDirectoryPath(dirPath, items);
      
        return items;

    }

    static async getDirectoryQuickPickItemsByStartingDirectoryPath(directoryPath:string,
                                                                    quickPickItems: vscode.QuickPickItem[],
                                                                    onItemDiscovered?: (discoveredQuickPickItem: vscode.QuickPickItem) => void,
                                                                    directoryScanProgress?: IDirectoryScanProgress,
                                                                    workspaceRootPath?: string): Promise<vscode.QuickPickItem[]> {

        if ( directoryScanProgress?.isCancellationRequested() ) {
            return quickPickItems;
        }

        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        // RESOLVED ONCE PER CALL AND HANDED DOWN THE RECURSION RATHER THAN READ PER ENTRY
        const workspaceRoot = workspaceRootPath ?? VSCodeWorkspaceService.getWorkspaceRoot();

        for (const entry of entries) {
  
            if ( directoryScanProgress?.isCancellationRequested() ) {
                return quickPickItems;
            }

            if ( this.isPossibleTreecipeUsableDirectory(entry) ) {

                const quickPickDirectoryItem = this.buildDirectoryVSCodeQuickPickItemByDirectoryEntry(entry, workspaceRoot, directoryPath);
                quickPickItems.push(quickPickDirectoryItem);
                onItemDiscovered?.(quickPickDirectoryItem);
                directoryScanProgress?.report(`Found ${quickPickItems.length} directories - ${quickPickDirectoryItem.label}`);

                const fullPath = path.join(directoryPath, entry.name);
                await this.getDirectoryQuickPickItemsByStartingDirectoryPath(fullPath, quickPickItems, onItemDiscovered, directoryScanProgress, workspaceRoot);

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

        return this.buildDirectoryVSCodeQuickPickItemByDirectoryPath(fullEntryPath, workspaceRoot);

    }

    static buildDirectoryVSCodeQuickPickItemByDirectoryPath(fullEntryPath: string, workspaceRoot: string): vscode.QuickPickItem {

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

    /*
        oneBasedLineNumber is optional and ignored when it is 0, which is what the panel's line
        finders return for "the file does not declare this". Opening the file at the top is the
        right answer there -- the reader still lands in the class or report they asked for, rather
        than at a line that happens to be first.
    */
    static async openFileInEditor(filePath: string, oneBasedLineNumber?: number) {

        try {

          const uri = vscode.Uri.file(filePath);
          const document = await vscode.workspace.openTextDocument(uri); 
          const textEditor = await vscode.window.showTextDocument(document);     

          if ( !oneBasedLineNumber || oneBasedLineNumber < 1 ) {
            return;
          }

          const targetPosition = new vscode.Position(oneBasedLineNumber - 1, 0);
          textEditor.selection = new vscode.Selection(targetPosition, targetPosition);
          textEditor.revealRange(new vscode.Range(targetPosition, targetPosition), vscode.TextEditorRevealType.InCenter);

        } catch (error) {

          vscode.window.showErrorMessage(`Failed to open file: ${filePath} - ${error}`);
          
        }
    }

    static async copyTextToClipboard(textToCopy: string) {

        await vscode.env.clipboard.writeText(textToCopy);

    }

    static showWarningMessage(message: string) {

        vscode.window.showWarningMessage(message);

    }

    static showInformationMessage(message: string) {

        vscode.window.showInformationMessage(message);

    }

    /*
        A status bar entry naming what a long-running command is currently doing.

        An explicit StatusBarItem rather than ProgressLocation.Window, which is the other way to put
        progress down there: Window "supports neither cancellation nor discrete progress"
        (vscode.d.ts), and the reason to be in the status bar at all here is to stay legible while
        the user is looking at another tab -- not to offer a cancel this load does not have. The
        generation command chose Notification for the opposite reason, because cancelling its walk
        IS useful; the two are consistent in picking the surface that can carry what they need.

        The caller owns the returned item and must dispose it -- an item left behind outlives the
        work it describes and reads as a command still running.
    */
    static createStatusBarPhaseItem(initialMessage: string): vscode.StatusBarItem {

        const statusBarPhaseItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarPhaseItem.text = initialMessage;
        statusBarPhaseItem.show();

        return statusBarPhaseItem;

    }

    // THE STAGING DIRECTORY BEHIND THE DIFF CURRENTLY OPEN, RECLAIMED WHEN THE NEXT ONE IS STAGED
    private static previousProposedContentDirectoryPath: string | undefined;

    private static reclaimPreviousProposedContentDirectory() {

        if ( !this.previousProposedContentDirectoryPath ) {
            return;
        }

        try {
            fs.rmSync(this.previousProposedContentDirectoryPath, { recursive: true, force: true });
        } catch {
            // A TEMP DIRECTORY THAT WILL NOT DELETE IS NOT WORTH FAILING A DIFF OVER
        }

        this.previousProposedContentDirectoryPath = undefined;

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

            /*
                The previous staging directory is reclaimed first. Without this, each press of
                "Show Diff" left another one behind for the life of the machine, and the prompt
                offering it loops -- so a user comparing several classes in one run accumulated one
                per click. Only the directory this method itself created is removed, and only the
                one before the diff now being opened, so no editor loses the document under it.
            */
            this.reclaimPreviousProposedContentDirectory();

            const proposedContentDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-proposed-'));
            VSCodeWorkspaceService.previousProposedContentDirectoryPath = proposedContentDirectoryPath;

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

    /*
        Opened as a PREVIEW rather than as a text editor: the document is a report to read, and its
        bullets, links and headings are the whole reason it is markdown instead of the output channel
        the warnings use.
    */
    static async showMarkdownPreview(markdownFilePath: string) {

        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(markdownFilePath));

    }

    static showPicklistDependencyCheckReport(report: string) {

        const outputChannel = this.getPicklistDependencyCheckOutputChannel();

        outputChannel.clear();
        outputChannel.appendLine(report);
        outputChannel.show(true);

    }

}