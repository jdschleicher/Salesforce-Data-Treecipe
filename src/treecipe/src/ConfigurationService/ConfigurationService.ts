
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { IRecipeFakerService } from '../RecipeFakerService.ts/IRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeFakerService } from '../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeProcessor } from '../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { FakerJSRecipeProcessor } from '../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';

import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';
import { IFakerRecipeProcessor } from '../FakerRecipeProcessor/IFakerRecipeProcessor';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

export interface ExtensionConfig {
    selectedFakerService?: string;
    treecipeConfigurationPath?: string;
    useSnowfakeryAsDefault: boolean;
    recipeCockpitEnabled?: boolean;
}

export interface TreecipeConfigDetail {
    salesforceObjectsPath: string;
    dataFakerService: string;
    customRelationshipMappings?: Record<string, string>;
    customCompoundAddressFields?: string[];
}

export type StaleTreecipeConfigurationPathReason = 'outside-workspace' | 'not-found' | 'not-a-file';

export interface ITreecipeConfigurationPathResolution {
    configurationFilePath: string;
    staleStoredPath?: string;
    staleReason?: StaleTreecipeConfigurationPathReason;
}

/*
    Keeps the message prefix ErrorHandlingService keys the missing-config flow on, and carries the
    stale setting separately so the dialog can name where the extension looked.
*/
export class MissingTreecipeConfigurationError extends Error {

    constructor(message: string, readonly staleSettingNotice?: string) {
        super(message);
        this.name = 'MissingTreecipeConfigurationError';
    }

}

export class ConfigurationService {
    
    private static configSection = 'salesforce-data-treecipe';

    private static readonly treecipeConfigurationPathKey = 'treecipeConfigurationPath';

    private static readonly replacedStaleTreecipeConfigurationPaths = new Set<string>();

    static getExtensionConfigValue<extensionKey extends keyof ExtensionConfig>(key: extensionKey): ExtensionConfig[extensionKey] {
        
        const vsCodeWorkspaceConfig = vscode.workspace.getConfiguration(this.configSection);
        return vsCodeWorkspaceConfig.get(key as string);
    
    }

    /*
        The workspace-folder or workspace value only. get() merges in the User value too, and a User
        value applies to every window -- so a path saved for one project would be read by all of them.
    */
    static getWorkspaceScopedExtensionConfigValue<extensionKey extends keyof ExtensionConfig>(key: extensionKey): ExtensionConfig[extensionKey] {

        const vsCodeWorkspaceConfig = vscode.workspace.getConfiguration(this.configSection);
        const inspectedValue = vsCodeWorkspaceConfig.inspect<ExtensionConfig[extensionKey]>(key as string);
        return inspectedValue?.workspaceFolderValue ?? inspectedValue?.workspaceValue;

    }

    /*
        Writes a setting at WORKSPACE scope, and answers whether it landed.

        update() returns a thenable that REJECTS -- VS Code refuses a workspace write in a window
        with no folder open, because there is no .vscode/settings.json to write into. Leaving that
        thenable unawaited made every failure an unhandled rejection: nothing was written, nothing
        was reported, and the caller carried on as though it had been. That is invisible for a
        setting nothing reads back, and it is the whole defect for one a user was asked to choose:
        the cockpit's preview opt-in was accepted, dropped, and asked for again next time.

        The boolean is what a caller acts on. The warning here names the setting and the reason for
        the callers that cannot -- a write buried in a path with nothing to say to the user.
    */
    static async setExtensionConfigValue<K extends keyof ExtensionConfig>( key: K, value: ExtensionConfig[K]): Promise<boolean> {

        const vsCodeWorkspaceConfig = vscode.workspace.getConfiguration(this.configSection);

        try {

            await vsCodeWorkspaceConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
            return true;

        } catch(error) {

            const failureReason = error instanceof Error ? error.message : String(error);
            VSCodeWorkspaceService.showWarningMessage(`"${this.configSection}.${String(key)}" could not be saved to this workspace's settings: ${failureReason}`);
            return false;

        }

    }

    static getObjectsPathFromTreecipeJSONConfiguration():string {

        const configurationDetail = this.getTreecipeConfigurationDetail();
        return configurationDetail.salesforceObjectsPath;

    }

    static getCustomRelationshipMappings(): Record<string, string> {

        const configurationDetail = this.getTreecipeConfigurationDetail();
        const customRelationshipMappings = configurationDetail?.customRelationshipMappings;
        if (!customRelationshipMappings || typeof customRelationshipMappings !== 'object') {
            return {};
        }

        return customRelationshipMappings;

    }

    /*
        A compound Address field whose XML carries no usable <type> tag parses as AUTO_GENERATED and
        cannot be detected from metadata alone, so this list lets a user name those fields explicitly.
        Malformed config degrades to no configured fields rather than throwing -- recipe generation
        for every other field in the workspace is worth more than reporting a hand edit here.
    */
    static getCustomCompoundAddressFields(): string[] {

        const configurationDetail = this.getTreecipeConfigurationDetail();
        const customCompoundAddressFields = configurationDetail?.customCompoundAddressFields;
        if (!Array.isArray(customCompoundAddressFields)) {
            return [];
        }

        return customCompoundAddressFields.filter((fieldApiName) => typeof fieldApiName === 'string');

    }

    static getTreecipeConfigurationDetail():any {
        
        const configurationPathResolution = this.resolveTreecipeConfigurationFilePath();
        const configurationPath = configurationPathResolution.configurationFilePath;
        let configurationJSON = null;
        if (fs.existsSync(configurationPath)) {
            configurationJSON = fs.readFileSync(configurationPath, 'utf-8');
        } else {
            const staleSettingNotice = configurationPathResolution.staleStoredPath
                ? this.buildStaleTreecipeConfigurationPathNotice(configurationPathResolution.staleStoredPath, configurationPathResolution.staleReason)
                : undefined;
            throw new MissingTreecipeConfigurationError(
                `Missing treecipe configuration setup at expected path of: ${ configurationPath } -- or unknown failure`,
                staleSettingNotice
            );
        }

        const configurationDetail = JSON.parse(configurationJSON);
        return configurationDetail;
    }

    static getTreecipeConfigurationFilePath(): string {

        return this.resolveTreecipeConfigurationFilePath().configurationFilePath;

    }

    /*
        The setting holds an ABSOLUTE path saved the first time the config was found, so moving or
        re-cloning the project, or a .vscode/settings.json committed from another machine, leaves it
        naming a file that is not there -- and every command then reported the config missing while
        treecipe/treecipe.config.json sat in the workspace (#171). A stored path is used only when it
        is inside this workspace and is a file; otherwise the workspace default is used.

        The setting is rewritten only when the default EXISTS. With neither present the setting is
        left alone and the caller reports the stale value, so the user can see where it looked.
    */
    static resolveTreecipeConfigurationFilePath(): ITreecipeConfigurationPathResolution {

        const storedConfigurationPath = this.getWorkspaceScopedExtensionConfigValue(this.treecipeConfigurationPathKey);
        const isStoredConfigurationPathSet = typeof storedConfigurationPath === 'string' && storedConfigurationPath.trim() !== '';

        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const defaultConfigurationPath = this.buildDefaultTreecipeConfigurationFilePath(workspaceRoot);

        if ( !isStoredConfigurationPathSet ) {
            /*
                This resolver is synchronous and returns the path whether or not the write lands.
                setExtensionConfigValue reports its own failure, so the void is what it means:
                the caller has nothing to do with the answer.
            */
            void this.setExtensionConfigValue(this.treecipeConfigurationPathKey, defaultConfigurationPath);
            return { configurationFilePath: defaultConfigurationPath };
        }

        const resolvedStoredConfigurationPath = workspaceRoot
            ? path.resolve(workspaceRoot, storedConfigurationPath)
            : storedConfigurationPath;
        const staleReason = this.getStaleTreecipeConfigurationPathReason(resolvedStoredConfigurationPath, workspaceRoot);

        if ( !staleReason ) {
            return { configurationFilePath: resolvedStoredConfigurationPath };
        }

        if ( fs.existsSync(defaultConfigurationPath) ) {
            this.replaceStaleTreecipeConfigurationPathOnce(storedConfigurationPath, staleReason, defaultConfigurationPath);
        }

        return {
            configurationFilePath: defaultConfigurationPath,
            staleStoredPath: storedConfigurationPath,
            staleReason
        };

    }

    static buildDefaultTreecipeConfigurationFilePath(workspaceRoot: string): string {

        const configurationFileName = this.getTreecipeConfigurationFileName();
        const configurationDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const fullConfigurationDirectoryPath = `${workspaceRoot}/${configurationDirectory}`;
        return path.join(fullConfigurationDirectoryPath, configurationFileName);

    }

    // CONTAINMENT FIRST, SO A PATH OUTSIDE THE WORKSPACE IS NEVER STATTED AS A CANDIDATE, LET ALONE READ
    static getStaleTreecipeConfigurationPathReason(resolvedConfigurationPath: string, workspaceRoot: string): StaleTreecipeConfigurationPathReason | undefined {

        if ( !workspaceRoot
                || !SfdxProjectService.isPathContainedInWorkspace(
                        this.normalizeDriveLetterCase(resolvedConfigurationPath),
                        this.normalizeDriveLetterCase(path.resolve(workspaceRoot))) ) {
            return 'outside-workspace';
        }

        if ( !fs.existsSync(resolvedConfigurationPath) ) {
            return 'not-found';
        }

        if ( !fs.statSync(resolvedConfigurationPath).isFile() ) {
            return 'not-a-file';
        }

        return undefined;

    }

    static buildStaleTreecipeConfigurationPathNotice(staleConfigurationPath: string, staleReason: StaleTreecipeConfigurationPathReason): string {

        const staleReasonDescriptions: Record<StaleTreecipeConfigurationPathReason, string> = {
            'outside-workspace': 'is outside this workspace',
            'not-found': 'does not exist',
            'not-a-file': 'is not a file'
        };

        const escapedStaleConfigurationPath = RecipeYamlScalar.escapeForNotification(staleConfigurationPath);
        return `The "${this.configSection}.${this.treecipeConfigurationPathKey}" setting names "${escapedStaleConfigurationPath}", which ${staleReasonDescriptions[staleReason]}.`;

    }

    /*
        VS Code hands the workspace root over as uri.fsPath, whose drive letter is LOWER case, while a
        hand-written setting usually carries "C:". The containment check compares strings, so without
        this a config inside the workspace read as outside it and was replaced -- #171 again, for a
        valid custom path. Windows drive letters are case-insensitive; nothing else is touched.
    */
    static normalizeDriveLetterCase(filePath: string): string {

        return /^[A-Za-z]:/.test(filePath)
            ? filePath.charAt(0).toLowerCase() + filePath.slice(1)
            : filePath;

    }

    /*
        The rewrite AND the warning, once per stale value per session: one command reads the config
        several times, each read lands before the asynchronous rewrite does, and a rewrite that fails
        keeps the value stale -- setExtensionConfigValue warns on its own failure, so repeating the
        write would repeat that warning on every read.
    */
    private static replaceStaleTreecipeConfigurationPathOnce(staleConfigurationPath: string,
                                                              staleReason: StaleTreecipeConfigurationPathReason,
                                                              defaultConfigurationPath: string): void {

        if ( this.replacedStaleTreecipeConfigurationPaths.has(staleConfigurationPath) ) {
            return;
        }
        this.replacedStaleTreecipeConfigurationPaths.add(staleConfigurationPath);

        void this.setExtensionConfigValue(this.treecipeConfigurationPathKey, defaultConfigurationPath);

        const staleSettingNotice = this.buildStaleTreecipeConfigurationPathNotice(staleConfigurationPath, staleReason);
        const escapedDefaultConfigurationPath = RecipeYamlScalar.escapeForNotification(defaultConfigurationPath);
        VSCodeWorkspaceService.showWarningMessage(`${staleSettingNotice} Using "${escapedDefaultConfigurationPath}" instead and updating this workspace's setting.`);

    }

    // THE PATH WRITTEN, OR undefined WHEN EITHER PICK WAS DISMISSED AND NOTHING WAS WRITTEN
    static async createTreecipeJSONConfigurationFile(): Promise<string | undefined> {

        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const expectedObjectsPath = await VSCodeWorkspaceService.promptForObjectsPath(workspaceRoot);
        if (!expectedObjectsPath) {
            // IF NO SELECTION THE USER DIDN'T SELECT OR MOVED AWAY FROM SCREEN
            return;
        };

        let selectedDataFakerService = await VSCodeWorkspaceService.promptForFakerServiceImplementation();
        if (!selectedDataFakerService) {
            // NO SELECTION MADE
            return;
        };
        await ConfigurationService.setExtensionConfigValue('selectedFakerService', selectedDataFakerService);

        const configurationDetail = {
            // REPLACE ALL BACKSLASHES WITH FORWARD SLASHES IN PATH SO THERE IS CONSISTENT VALUE AND READ DIRECTORY WORKS AS EXPECTED
            salesforceObjectsPath: `${expectedObjectsPath.replace(/\\/g, "/")}`,
            dataFakerService: selectedDataFakerService
        };

        const treecipeBaseDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);

        return this.createTreecipeConfigFile(configurationDetail, expectedTreecipeDirectoryPath);

    }

    static async createTreecipeConfigFile(treecipeContrigurationDetail, expectedTreecipeDirectoryPath: string): Promise<string> {

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(treecipeContrigurationDetail, null, 4);

        const configurationFileName = this.getTreecipeConfigurationFileName();

        const pathToCreateConfigurationFile = `${ expectedTreecipeDirectoryPath}/${configurationFileName }`;
        
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);

        return pathToCreateConfigurationFile;

    }

    static async updateTreecipeConfigFile(treecipeContrigurationDetail) {

        const configurationFileName = this.getTreecipeConfigurationFileName();
        const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
        const treecipeBaseDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);

        const pathToCreateConfigurationFile = `${ expectedTreecipeDirectoryPath}/${configurationFileName }`;
        
        const configurationJsonData = JSON.stringify(treecipeContrigurationDetail, null, 4);
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);

    }

    static getSelectedDataFakerServiceConfig() {
        const selectedFakerServiceKey = "selectedFakerService";
        const fakerConfigurationSelection = this.getExtensionConfigValue(selectedFakerServiceKey);

        return fakerConfigurationSelection;
    }

    static getDefaultTreecipeConfigurationFolderName() {
        const defaultTreecipeConfigurationFolder = "treecipe";
        return defaultTreecipeConfigurationFolder;
    }

    static getGeneratedRecipesDefaultFolderName() {
        const generatedRecipesFolderName = 'GeneratedRecipes';
        return generatedRecipesFolderName;
    }

    static getGeneratedRecipesFolderPath() {
        
        const defaultTreecipeConfigurationFolder = this.getDefaultTreecipeConfigurationFolderName();
        const generatedRecipesFolderName = this.getGeneratedRecipesDefaultFolderName();
        return (`${defaultTreecipeConfigurationFolder}/${generatedRecipesFolderName}`);

    }

    static getTreecipeConfigurationFileName() {
        const configurationFileName = "treecipe.config.json";
        return configurationFileName;
    }

    static getFakerImplementationByExtensionConfigSelection(): IRecipeFakerService {

        const fakerConfigurationSelection = this.getSelectedDataFakerServiceConfig();
        switch (fakerConfigurationSelection) {
            case 'snowfakery':
              return new SnowfakeryRecipeFakerService();
            case 'faker-js':
              return new FakerJSRecipeFakerService();
            default:
              throw new Error(`Unknown Faker Service selection: ${fakerConfigurationSelection}`);
          }
    
    }

    static getFakerRecipeProcessorByExtensionConfigSelection(): IFakerRecipeProcessor {

        const fakerConfigurationSelection = this.getSelectedDataFakerServiceConfig();
        switch (fakerConfigurationSelection) {
            case 'snowfakery':
              return new SnowfakeryRecipeProcessor();
            case 'faker-js':
              return new FakerJSRecipeProcessor();
            default:
              throw new Error(`Unknown Faker Recipe Processor selection: ${fakerConfigurationSelection}`);
          }
    
    }

    static getFakeDataSetsFolderName() {
        const fakeDataSetsFolderName = 'FakeDataSets';
        return fakeDataSetsFolderName;
    }

    static getFakeDataSetsFolderPath() {
        
        const defaultTreecipeConfigurationFolder = this.getDefaultTreecipeConfigurationFolderName();
        const generatedRecipesFolderName = this.getFakeDataSetsFolderName();
        return (`${defaultTreecipeConfigurationFolder}/${generatedRecipesFolderName}`);

    }

    static getPicklistDependencyResultsFolderName() {
        const picklistDependencyResultsFolderName = 'PicklistDependencyResults';
        return picklistDependencyResultsFolderName;
    }

    static getPicklistDependencyResultsFolderPath() {

        const defaultTreecipeConfigurationFolder = this.getDefaultTreecipeConfigurationFolderName();
        const picklistDependencyResultsFolderName = this.getPicklistDependencyResultsFolderName();
        return (`${defaultTreecipeConfigurationFolder}/${picklistDependencyResultsFolderName}`);

    }

    static getPicklistDependencySpecsFolderName() {
        const picklistDependencySpecsFolderName = 'PicklistDependencySpecs';
        return picklistDependencySpecsFolderName;
    }

    /*
        Sibling to the results folder, and deliberately NOT the Apex "classes" directory. The
        manifest is a json file, and a stray json in a package directory is not valid Salesforce
        metadata -- it would ride along into "sf project deploy" and fail the deploy it describes.
    */
    static getPicklistDependencySpecsFolderPath() {

        const defaultTreecipeConfigurationFolder = this.getDefaultTreecipeConfigurationFolderName();
        const picklistDependencySpecsFolderName = this.getPicklistDependencySpecsFolderName();
        return (`${defaultTreecipeConfigurationFolder}/${picklistDependencySpecsFolderName}`);

    }

    static getTreecipeObjectsWrapperName() {

        const treecipeObjectsWrapperPrefix = 'treecipeObjectsWrapper';
        return treecipeObjectsWrapperPrefix;

    }

    static getBaseArtifactsFolderName() {
        const baseArtifactsFolderName = 'BaseArtifactFiles';
        return baseArtifactsFolderName;
    }

    static getDatasetCollectionApiFilesFolderName() {
        const collectionsApiFilesFolderName = 'DatasetFilesForCollectionsApi';
        return collectionsApiFilesFolderName;
    }

    static getDatasetFilesForCollectionsApiFolderName() {
        const datasetFilesForCollectionsApiFolderName = 'DatasetFilesForCollectionsApi';
        return datasetFilesForCollectionsApiFolderName;
    }


}