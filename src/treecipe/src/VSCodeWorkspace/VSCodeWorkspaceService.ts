import * as vscode from 'vscode';
import path = require('path');
import * as fs from 'fs';
import * as os from 'os';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import { IAuthenticatedOrgDetail } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

// WHAT A FAKER-JS RUN FOLDER AND ITS RECIPE FILES ARE NAMED WITH, AND A SNOWFAKERY ONE IS NOT
export const FAKER_JS_RECIPE_INDICATOR = 'recipe-fakerjs';

export const RECIPE_COCKPIT_COMMAND_ID = 'treecipe.openRecipeCockpit';
export const RECIPE_COCKPIT_STATUS_BAR_SETTING_KEY = 'showRecipeCockpitStatusBarItem';
export const RECIPE_COCKPIT_STATUS_BAR_TEXT = '$(list-tree) Treecipe';
export const RECIPE_COCKPIT_STATUS_BAR_TOOLTIP = 'Open Recipe Cockpit';
export const RECIPE_COCKPIT_STATUS_BAR_ITEM_ID = 'salesforce-data-treecipe.recipeCockpit';
export const RECIPE_COCKPIT_STATUS_BAR_ITEM_NAME = 'Treecipe Recipe Cockpit';


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

// A BUTTON ON A COMMAND'S COMPLETION NOTIFICATION, AND THE FILE OR FOLDER THE COMMAND JUST WROTE THAT IT ACTS ON
export interface ICreatedFileNotificationAction {
    label: string;
    targetPath: string;
    kind: 'revealInExplorer' | 'openInEditor';
}

export const ORG_CONNECTION_CHECK_PLACEHOLDER = 'Checking org connections…';

export const PARENT_PICKER_RANDOM_LABEL = 'Random parent';
export const PARENT_PICKER_BLANK_LABEL = 'Leave blank';
export const PARENT_PICKER_SELECT_ALL_LABEL = 'Select all matches';
export const PARENT_PICKER_NO_NAME_LABEL = '(no name)';
export const PARENT_PICKER_SEARCH_DELAY_MILLISECONDS = 300;

// ONE RECORD A PARENT SEARCH RETURNED, SHAPED LIKE SalesforceOrgService'S MATCH WITHOUT IMPORTING IT (IT IMPORTS THIS FILE)
export interface IParentPickerRecord {
    recordId: string;
    recordName: string;
}

export interface IParentPickerSearchResult {
    matches: IParentPickerRecord[];
    hasMoreMatches: boolean;
}

/*
    One lookup's picker (#254). searchUnavailableReason is set when the parent cannot be searched --
    its describe marks no name field, or it could not be described -- and the picker then offers
    Random (and Leave blank) only and says why.
*/
export interface IParentPickerOptions {
    fieldApiName: string;
    parentObjectApiName: string;
    isRequired: boolean;
    nameFieldApiName?: string;
    searchUnavailableReason?: string;
    resultLimit: number;
    search: (searchText: string) => Promise<IParentPickerSearchResult>;
    searchDelayMilliseconds?: number;
}

export type ParentPickerAnswer =
    | { kind: 'random' }
    | { kind: 'blank' }
    | { kind: 'chosen'; records: IParentPickerRecord[] };

type ParentPickerItem = vscode.QuickPickItem & { parentPickerRole: 'random' | 'blank' | 'selectAll' | 'record' | 'message'; parentRecord?: IParentPickerRecord };

// THE ORGS A PICKER OFFERS, AND WHAT TO SAY INSTEAD WHEN IT OFFERS NONE
export interface IAuthenticatedOrgListingForPicker<TOrgDetail extends IAuthenticatedOrgDetail = IAuthenticatedOrgDetail> {
    orgDetails: TOrgDetail[];
    emptyListMessage: string;
    // LABELLED "(default)" -- NEVER SELECTED ON THE READER'S BEHALF
    defaultUsername?: string;
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

    /*
        Which backend a recipe under GeneratedRecipes was generated for, by the rule the picker below
        filters with: a faker-js recipe's file name carries "recipe-fakerjs" and so does its run
        folder; a snowfakery recipe's name and folders carry it nowhere. A recipe whose name and
        folders disagree is offered by the picker for neither backend, so it is undefined here.
    */
    static readRecipeFakerService(generatedRecipesFolderPath: string, recipeFilePath: string): 'faker-js' | 'snowfakery' | undefined {

        const relativeRecipeFolderPath = path.relative(path.resolve(generatedRecipesFolderPath), path.dirname(path.resolve(recipeFilePath)));
        const relativeFolderNames = relativeRecipeFolderPath === '' ? [] : relativeRecipeFolderPath.split(path.sep);

        const isFakerJSFileName = path.basename(recipeFilePath).includes(FAKER_JS_RECIPE_INDICATOR);
        const isUnderFakerJSFolder = relativeFolderNames.length === 0 || relativeFolderNames[0].includes(FAKER_JS_RECIPE_INDICATOR);
        const isUnderSnowfakeryFolders = relativeFolderNames.every(folderName => !folderName.includes(FAKER_JS_RECIPE_INDICATOR));

        if ( isFakerJSFileName && isUnderFakerJSFolder ) {
            return 'faker-js';
        }

        if ( !isFakerJSFileName && isUnderSnowfakeryFolders ) {
            return 'snowfakery';
        }

        return undefined;

    }

    static async getAvailableRecipeFileQuickPickItemsByDirectory(recipeFileQuickPickItems: vscode.QuickPickItem[], folderPathToParse: string) {

        const selectedDataFakerService = ConfigurationService.getSelectedDataFakerServiceConfig();
        const expectedFakerJSRecipeFileIndicator = FAKER_JS_RECIPE_INDICATOR;

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

        /*
            Two runs in the same second used to throw EEXIST here. mkdirSync is the existence check, so
            there is no window between testing a name and taking it: the first free of "<name>",
            "<name>-2", "<name>-3"... is the one this call created.
        */
        for ( let collisionSuffix = 1; ; collisionSuffix++ ) {

            const candidateFolderName = ( collisionSuffix === 1 )
                                            ? uniqueTimeStampedFakeDataSetsFolderName
                                            : `${uniqueTimeStampedFakeDataSetsFolderName}-${collisionSuffix}`;
            const fullPathToUniqueTimeStampedFakeDataSetsFolder = `${expectedFakeDataSetsFolerPath}/${candidateFolderName}`;

            try {
                fs.mkdirSync(fullPathToUniqueTimeStampedFakeDataSetsFolder);
                return fullPathToUniqueTimeStampedFakeDataSetsFolder;
            } catch (mkdirError) {
                if ( (mkdirError as NodeJS.ErrnoException)?.code !== 'EEXIST' ) {
                    throw mkdirError;
                }
            }

        }

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

          vscode.window.showErrorMessage(RecipeYamlScalar.escapeForNotification(`Failed to open file: ${filePath} - ${error}`));
          
        }
    }

    /*
        Opens a file with one line's columns selected and the line centered, for a reader sent
        to fix that line by hand. An equal start and end column places the cursor there.
    */
    static async openFileInEditorAtSelection(filePath: string,
                                                zeroBasedLineNumber: number,
                                                zeroBasedStartColumn: number,
                                                zeroBasedEndColumn: number) {

        try {

          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          const textEditor = await vscode.window.showTextDocument(document);

          const anchorPosition = new vscode.Position(zeroBasedLineNumber, zeroBasedStartColumn);
          const activePosition = new vscode.Position(zeroBasedLineNumber, zeroBasedEndColumn);
          textEditor.selection = new vscode.Selection(anchorPosition, activePosition);
          textEditor.revealRange(new vscode.Range(anchorPosition, activePosition), vscode.TextEditorRevealType.InCenter);

        } catch (error) {

          vscode.window.showErrorMessage(RecipeYamlScalar.escapeForNotification(`Failed to open file: ${filePath} - ${error}`));

        }

    }

    static async copyTextToClipboard(textToCopy: string) {

        await vscode.env.clipboard.writeText(textToCopy);

    }

    static showWarningMessage(message: string) {

        vscode.window.showWarningMessage(message);

    }

    /*
        A notification whose one button opens a file the run wrote (#301, #310). The path is the
        host's own and is checked again on the click, since the file can have been removed or
        replaced by a link out of the workspace since; with no path there is no button. NOT AWAITED,
        so the run ends without waiting for the reader.
    */
    static showNotificationWithWorkspaceFile(severity: 'information' | 'warning' | 'error',
                                                notificationText: string,
                                                actionLabel: string,
                                                filePath: string | undefined,
                                                workspaceRoot: string,
                                                missingFileText: string) {

        const actions = filePath ? [actionLabel] : [];
        const shownNotification = severity === 'information'
            ? vscode.window.showInformationMessage(notificationText, ...actions)
            : severity === 'warning'
                ? vscode.window.showWarningMessage(notificationText, ...actions)
                : vscode.window.showErrorMessage(notificationText, ...actions);

        Promise.resolve(shownNotification)
            .then(chosenAction => chosenAction === actionLabel && filePath
                ? this.openWorkspaceResultFile(filePath, workspaceRoot, missingFileText)
                : undefined)
            .catch(() => undefined);

    }

    static async openWorkspaceResultFile(filePath: string, workspaceRoot: string, missingFileText: string) {

        const isUsable = fs.existsSync(filePath)
                            && SfdxProjectService.isPathContainedInWorkspace(path.resolve(filePath), path.resolve(workspaceRoot));
        if ( !isUsable ) {
            this.showWarningMessage(missingFileText);
            return;
        }

        await this.openFileInEditor(filePath);

    }

    static showInformationMessage(message: string) {

        vscode.window.showInformationMessage(message);

    }

    /*
        The returned promise settles when the reader clicks or dismisses, which can be never, so a
        command reports completion with `void` rather than awaiting this -- awaiting it held
        executeCommand, and every caller of it, on an unanswered toast. A target is checked again
        when clicked: the file can be moved or deleted while the toast is up, and a path outside
        the workspace is never revealed or opened whoever built the action.
    */
    static showCreatedFilesNotification(message: string, actions: ICreatedFileNotificationAction[]): Promise<void> {

        const actionLabels = actions.map(action => action.label);

        return Promise.resolve(vscode.window.showInformationMessage(message, ...actionLabels))
            .then(selectedLabel => {
                const selectedAction = actions.find(action => action.label === selectedLabel);
                return selectedAction ? this.runCreatedFileNotificationAction(selectedAction) : undefined;
            });

    }

    static async runCreatedFileNotificationAction(action: ICreatedFileNotificationAction): Promise<void> {

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if ( !workspaceRoot ) {
            return;
        }

        const resolvedTargetPath = path.resolve(action.targetPath);
        if ( !fs.existsSync(resolvedTargetPath) || !SfdxProjectService.isPathContainedInWorkspace(resolvedTargetPath, path.resolve(workspaceRoot)) ) {
            void vscode.window.showWarningMessage(`"${this.toWorkspaceRelativeDisplayPath(resolvedTargetPath, workspaceRoot)}" is no longer in this workspace, so it cannot be shown.`);
            return;
        }

        if ( action.kind === 'openInEditor' ) {
            await this.openFileInEditor(resolvedTargetPath);
            return;
        }

        try {
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(resolvedTargetPath));
        } catch (revealError) {
            void vscode.window.showErrorMessage(`Failed to reveal "${this.toWorkspaceRelativeDisplayPath(resolvedTargetPath, workspaceRoot)}" in the Explorer: ${RecipeYamlScalar.escapeForNotification(revealError instanceof Error ? revealError.message : String(revealError))}`);
        }

    }

    // FORWARD SLASHES ON EVERY PLATFORM, ESCAPED FOR A NOTIFICATION -- A FOLDER NAME IS WORKSPACE TEXT AND A `[label](command:...)` IN ONE WOULD RENDER AS A LINK THAT RUNS A COMMAND
    static toWorkspaceRelativeDisplayPath(targetPath: string, workspaceRoot: string): string {

        const relativePath = path.relative(workspaceRoot, targetPath).split(path.sep).join('/');
        return RecipeYamlScalar.escapeForNotification(relativePath);

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

    /*
        The status bar entry into the Recipe Cockpit (#251). It runs the SAME command the palette
        does, so the feature flag, the opt-in warning and the singleton reveal all still apply, and
        showing it does nothing else: no run is loaded, no org contacted and no webview created
        until it is clicked.

        Created only once the setting asks for it, so a workspace with the setting off, or a window
        with no folder, has no item at all. The setting is followed live; the item and the listener
        are disposed with the extension.
    */
    static registerRecipeCockpitStatusBarItem(subscriptions: { push(disposable: vscode.Disposable): void }) {

        if ( !vscode.workspace.workspaceFolders?.length ) {
            return;
        }

        let recipeCockpitStatusBarItem: vscode.StatusBarItem | undefined;

        const applyVisibility = () => {

            const isShown = ConfigurationService.getExtensionConfigValue(RECIPE_COCKPIT_STATUS_BAR_SETTING_KEY) !== false;

            if ( !isShown ) {
                recipeCockpitStatusBarItem?.hide();
                return;
            }

            if ( !recipeCockpitStatusBarItem ) {
                // AN ID AND NAME LABEL THE ITEM IN THE STATUS BAR'S OWN HIDE MENU, AND LET VS CODE REMEMBER A HIDE
                recipeCockpitStatusBarItem = vscode.window.createStatusBarItem(RECIPE_COCKPIT_STATUS_BAR_ITEM_ID, vscode.StatusBarAlignment.Left);
                recipeCockpitStatusBarItem.name = RECIPE_COCKPIT_STATUS_BAR_ITEM_NAME;
                recipeCockpitStatusBarItem.text = RECIPE_COCKPIT_STATUS_BAR_TEXT;
                recipeCockpitStatusBarItem.tooltip = RECIPE_COCKPIT_STATUS_BAR_TOOLTIP;
                recipeCockpitStatusBarItem.command = RECIPE_COCKPIT_COMMAND_ID;
            }

            recipeCockpitStatusBarItem.show();

        };

        applyVisibility();

        const configurationListener = vscode.workspace.onDidChangeConfiguration(configurationChange => {
            if ( configurationChange.affectsConfiguration(`salesforce-data-treecipe.${RECIPE_COCKPIT_STATUS_BAR_SETTING_KEY}`) ) {
                applyVisibility();
            }
        });

        subscriptions.push(configurationListener);
        subscriptions.push({ dispose: () => recipeCockpitStatusBarItem?.dispose() });

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

    static buildAuthenticatedOrgQuickPickItems(authenticatedOrgDetails: IAuthenticatedOrgDetail[], defaultUsername?: string): vscode.QuickPickItem[] {

        return authenticatedOrgDetails.map(authenticatedOrgDetail => ({
            label: `${authenticatedOrgDetail.alias || authenticatedOrgDetail.username}${defaultUsername !== undefined && authenticatedOrgDetail.username === defaultUsername ? ' (default)' : ''}`,
            // THE USERNAME IS SHOWN EVEN WHEN IT IS THE LABEL SO TWO ALIASES ON ONE ORG STAY TELLABLE APART
            description: authenticatedOrgDetail.username,
            detail: authenticatedOrgDetail.targetOrgIdentifier
        }));

    }

    /*
        The org quick pick for a listing that is still being worked out -- asking the Salesforce CLI
        which orgs are connected can take a few seconds. The picker opens at once, busy and with no
        items, so nothing can be selected until the listing answers; dismissing it in the meantime
        ends the command. A listing with no org closes the picker and says why instead of showing
        an empty list, which would look like a picker that failed to load.
    */
    static async promptForAuthenticatedOrgDetailOnceListed<TOrgDetail extends IAuthenticatedOrgDetail>(orgListing: Promise<IAuthenticatedOrgListingForPicker<TOrgDetail>>,
                                                            placeHolder: string): Promise<TOrgDetail | undefined> {

        const orgQuickPick = vscode.window.createQuickPick();
        orgQuickPick.placeholder = ORG_CONNECTION_CHECK_PLACEHOLDER;
        orgQuickPick.ignoreFocusOut = true;
        orgQuickPick.busy = true;
        orgQuickPick.enabled = false;
        orgQuickPick.items = [];

        let listedOrgDetails: TOrgDetail[] = [];

        const orgSelection = new Promise<TOrgDetail | undefined>((resolveSelection) => {

            orgQuickPick.onDidAccept(() => {
                const selectedQuickPickItem = orgQuickPick.selectedItems[0];
                resolveSelection(selectedQuickPickItem
                    ? listedOrgDetails.find(orgDetail => orgDetail.targetOrgIdentifier === selectedQuickPickItem.detail
                                                            && orgDetail.username === selectedQuickPickItem.description)
                    : undefined);
                orgQuickPick.hide();
            });

            orgQuickPick.onDidHide(() => resolveSelection(undefined));

        });

        orgQuickPick.show();

        try {

            const listingOrDismissal = await Promise.race([
                orgListing,
                orgSelection.then(() => undefined)
            ]);

            if ( !listingOrDismissal ) {
                return undefined;
            }

            if ( listingOrDismissal.orgDetails.length === 0 ) {
                orgQuickPick.hide();
                this.showWarningMessage(listingOrDismissal.emptyListMessage);
                return undefined;
            }

            listedOrgDetails = listingOrDismissal.orgDetails;
            orgQuickPick.items = this.buildAuthenticatedOrgQuickPickItems(listedOrgDetails, listingOrDismissal.defaultUsername);
            orgQuickPick.placeholder = placeHolder;
            orgQuickPick.busy = false;
            orgQuickPick.enabled = true;

            return await orgSelection;

        } finally {

            orgQuickPick.dispose();

        }

    }

    /*
        Org and search text as a quick pick shows it. A label renders "$(name)" as a theme icon, so
        the "$(" is broken with a zero-width space; it renders no markdown, so nothing else needs
        escaping, and escaping for a notification would show its backslashes.
    */
    static toQuickPickLabelText(labelText: string): string {

        return labelText.replace(/\$\(/g, '$\u200B(');

    }

    /*
        The parent picker of one lookup (#254). Nothing is checked when it opens, and nothing is ever
        applied implicitly: accepting with nothing checked, or dismissing it, answers undefined, which
        the Create treats as a cancel. Random (and, for an optional lookup, Leave blank) is chosen by
        checking it, which clears the search and keeps it cleared while it stays checked. Typing
        searches the parent's name field after a short pause, and only the newest search's answer is
        drawn. Checked records are kept across searches, so several can be gathered from several
        searches; Select all matches -- or VS Code's own check-all -- checks every record the current
        search listed. A record set is answered in the order the picker lists it.
    */
    static async promptForParentRecords(pickerOptions: IParentPickerOptions): Promise<ParentPickerAnswer | undefined> {

        const parentQuickPick = vscode.window.createQuickPick<ParentPickerItem>();
        const parentLabel = RecipeYamlScalar.escapeForNotification(pickerOptions.parentObjectApiName);
        const isSearchable = !!pickerOptions.nameFieldApiName && !pickerOptions.searchUnavailableReason;

        const defaultItems: ParentPickerItem[] = [
            ...( pickerOptions.isRequired ? [] : [{ label: PARENT_PICKER_BLANK_LABEL, description: 'leave this lookup empty', parentPickerRole: 'blank' as const, alwaysShow: true }] ),
            { label: PARENT_PICKER_RANDOM_LABEL, description: `a random existing ${parentLabel} record per new record`, parentPickerRole: 'random', alwaysShow: true }
        ];
        const selectAllItem: ParentPickerItem = { label: PARENT_PICKER_SELECT_ALL_LABEL, parentPickerRole: 'selectAll', alwaysShow: true };
        const messageItem = (messageText: string): ParentPickerItem => ({ label: messageText, kind: vscode.QuickPickItemKind.Separator, parentPickerRole: 'message', alwaysShow: true });

        const keptRecordItemsById = new Map<string, ParentPickerItem>();
        let listedRecordItems: ParentPickerItem[] = [];
        let searchMessageItems: ParentPickerItem[] = [];
        let previousSelection: ParentPickerItem[] = [];
        let searchSequence = 0;
        let searchTimer: ReturnType<typeof setTimeout> | undefined;

        const baseTitle = `${RecipeYamlScalar.escapeForNotification(pickerOptions.fieldApiName)} → ${parentLabel} (${pickerOptions.isRequired ? 'required' : 'optional'})`;
        // A SEPARATOR CAN BE HIDDEN WHILE THE INPUT FILTERS, SO WHAT A SEARCH ANSWERED IS ALSO SAID IN THE TITLE
        const setSearchStatus = (statusText: string) => { parentQuickPick.title = statusText ? `${baseTitle} — ${statusText}` : baseTitle; };
        setSearchStatus('');
        parentQuickPick.placeholder = isSearchable
            ? `Type to search ${parentLabel} by ${RecipeYamlScalar.escapeForNotification(pickerOptions.nameFieldApiName as string)}, or check ${PARENT_PICKER_RANDOM_LABEL}${pickerOptions.isRequired ? '' : ` or ${PARENT_PICKER_BLANK_LABEL}`}`
            : `${parentLabel} cannot be searched, so only ${PARENT_PICKER_RANDOM_LABEL}${pickerOptions.isRequired ? '' : ` or ${PARENT_PICKER_BLANK_LABEL}`} can be chosen`;
        parentQuickPick.canSelectMany = true;
        parentQuickPick.ignoreFocusOut = true;
        parentQuickPick.matchOnDescription = false;
        parentQuickPick.matchOnDetail = false;

        const unavailableMessageItems = isSearchable
            ? []
            : [messageItem(this.toQuickPickLabelText(pickerOptions.searchUnavailableReason ?? `${pickerOptions.parentObjectApiName} has no name field to search`))];

        const isDefaultChosen = () => previousSelection.some(selectedItem => selectedItem.parentPickerRole === 'random' || selectedItem.parentPickerRole === 'blank');

        const drawItems = (selectedItems: ParentPickerItem[]) => {
            const listedIds = new Set(listedRecordItems.map(listedItem => listedItem.parentRecord?.recordId));
            const keptOffListItems = [...keptRecordItemsById.values()].filter(keptItem => !listedIds.has(keptItem.parentRecord?.recordId));
            parentQuickPick.items = [
                ...defaultItems,
                ...unavailableMessageItems,
                ...( keptOffListItems.length > 0 ? [messageItem('Checked from earlier searches'), ...keptOffListItems] : [] ),
                ...searchMessageItems,
                ...( listedRecordItems.length > 1 ? [selectAllItem] : [] ),
                ...listedRecordItems
            ];
            previousSelection = selectedItems;
            parentQuickPick.selectedItems = selectedItems;
        };

        const toRecordItem = (parentRecord: IParentPickerRecord): ParentPickerItem => keptRecordItemsById.get(parentRecord.recordId) ?? {
            label: parentRecord.recordName ? this.toQuickPickLabelText(parentRecord.recordName) : PARENT_PICKER_NO_NAME_LABEL,
            description: parentRecord.recordId,
            parentPickerRole: 'record',
            parentRecord: parentRecord,
            alwaysShow: true
        };

        const runSearch = async (searchText: string) => {

            const thisSearch = ++searchSequence;
            parentQuickPick.busy = true;

            try {

                const searchResult = await pickerOptions.search(searchText);
                if ( thisSearch !== searchSequence ) {
                    return;
                }
                listedRecordItems = searchResult.matches.map(toRecordItem);
                const searchStatus = searchResult.matches.length === 0
                    ? `No ${pickerOptions.parentObjectApiName} record matches "${this.toQuickPickLabelText(searchText)}"`
                    : searchResult.hasMoreMatches
                        ? `The first ${pickerOptions.resultLimit} matches are listed; more match, so refine your search`
                        : `${searchResult.matches.length} ${searchResult.matches.length === 1 ? 'match' : 'matches'}`;
                searchMessageItems = [messageItem(searchStatus)];
                setSearchStatus(searchStatus);

            } catch (searchError) {

                if ( thisSearch !== searchSequence ) {
                    return;
                }
                listedRecordItems = [];
                const failureStatus = this.toQuickPickLabelText(`The search failed: ${searchError instanceof Error ? searchError.message : String(searchError)}`);
                searchMessageItems = [messageItem(failureStatus)];
                setSearchStatus(failureStatus);

            }

            parentQuickPick.busy = false;
            drawItems([...keptRecordItemsById.values()]);

        };

        // ANY CHANGE MAKES EVERY SEARCH IN FLIGHT STALE, AND A SEARCH STILL WAITING ON ITS PAUSE IS NOT SENT
        const cancelPendingSearch = () => {
            searchSequence++;
            if ( searchTimer ) {
                clearTimeout(searchTimer);
                searchTimer = undefined;
            }
        };

        parentQuickPick.onDidChangeValue(changedValue => {

            cancelPendingSearch();

            if ( !isSearchable || isDefaultChosen() ) {
                if ( changedValue !== '' ) {
                    parentQuickPick.value = '';
                }
                return;
            }

            const searchText = changedValue.trim();

            if ( searchText === '' ) {
                parentQuickPick.busy = false;
                listedRecordItems = [];
                searchMessageItems = [];
                setSearchStatus('');
                drawItems([...keptRecordItemsById.values()]);
                return;
            }

            searchTimer = setTimeout(() => { searchTimer = undefined; void runSearch(searchText); }, pickerOptions.searchDelayMilliseconds ?? PARENT_PICKER_SEARCH_DELAY_MILLISECONDS);

        });

        parentQuickPick.onDidChangeSelection(selectedItems => {

            const previouslySelected = new Set(previousSelection);
            const addedItems = selectedItems.filter(selectedItem => !previouslySelected.has(selectedItem));
            const addedDefault = addedItems.find(addedItem => addedItem.parentPickerRole === 'random' || addedItem.parentPickerRole === 'blank');
            // VS CODE'S CHECK-ALL ADDS THE DEFAULTS AND THE RECORDS AT ONCE: THAT IS A SELECT ALL, NEVER A CHOICE OF Random OR Leave blank
            const addedRecordOrSelectAll = addedItems.some(addedItem => addedItem.parentPickerRole === 'record' || addedItem.parentPickerRole === 'selectAll');

            if ( addedDefault && !addedRecordOrSelectAll ) {
                cancelPendingSearch();
                keptRecordItemsById.clear();
                listedRecordItems = [];
                searchMessageItems = [];
                parentQuickPick.busy = false;
                parentQuickPick.value = '';
                setSearchStatus('');
                drawItems([addedDefault]);
                return;
            }

            const listedRecordItemsNow = listedRecordItems;
            const isSelectAll = addedItems.some(addedItem => addedItem.parentPickerRole === 'selectAll') || ( !!addedDefault && listedRecordItemsNow.length > 0 );
            const selectedRecordItems = isSelectAll
                ? [...new Set([...selectedItems.filter(selectedItem => selectedItem.parentPickerRole === 'record'), ...listedRecordItemsNow])]
                : selectedItems.filter(selectedItem => selectedItem.parentPickerRole === 'record');

            keptRecordItemsById.clear();
            selectedRecordItems.forEach(selectedItem => keptRecordItemsById.set((selectedItem.parentRecord as IParentPickerRecord).recordId, selectedItem));

            const hasDroppedOtherItems = selectedItems.length !== selectedRecordItems.length;
            if ( isSelectAll || hasDroppedOtherItems ) {
                drawItems(selectedRecordItems);
            } else {
                previousSelection = selectedRecordItems;
            }

        });

        const pickerAnswer = new Promise<ParentPickerAnswer | undefined>(resolveAnswer => {

            parentQuickPick.onDidAccept(() => {
                const chosenDefault = previousSelection.find(selectedItem => selectedItem.parentPickerRole === 'random' || selectedItem.parentPickerRole === 'blank');
                const chosenRecords = previousSelection
                    .filter(selectedItem => selectedItem.parentPickerRole === 'record' && selectedItem.parentRecord)
                    .map(selectedItem => selectedItem.parentRecord as IParentPickerRecord);
                resolveAnswer(chosenDefault
                    ? { kind: chosenDefault.parentPickerRole as 'random' | 'blank' }
                    : chosenRecords.length > 0 ? { kind: 'chosen', records: chosenRecords } : undefined);
                parentQuickPick.hide();
            });

            parentQuickPick.onDidHide(() => resolveAnswer(undefined));

        });

        drawItems([]);
        parentQuickPick.show();

        try {
            return await pickerAnswer;
        } finally {
            if ( searchTimer ) {
                clearTimeout(searchTimer);
            }
            searchSequence++;
            parentQuickPick.dispose();
        }

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