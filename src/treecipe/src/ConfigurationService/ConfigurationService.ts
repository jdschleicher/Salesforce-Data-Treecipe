
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

export interface ExtensionConfig {
    selectedFakerService?: string;
    treecipeConfigurationPath?: string;
    useSnowfakeryAsDefault: boolean;
}

export interface TreecipeConfigDetail {
    salesforceObjectsPath: string;
    dataFakerService: string;
    customRelationshipMappings?: Record<string, string>;
}

export class ConfigurationService {
    
    private static configSection = 'salesforce-data-treecipe';

    static getExtensionConfigValue<extensionKey extends keyof ExtensionConfig>(key: extensionKey): ExtensionConfig[extensionKey] {
        
        const vsCodeWorkspaceConfig = vscode.workspace.getConfiguration(this.configSection);
        return vsCodeWorkspaceConfig.get(key as string);
    
    }

    static setExtensionConfigValue<K extends keyof ExtensionConfig>( key: K, value: ExtensionConfig[K]) {

        const vsCodeWorkspaceConfig = vscode.workspace.getConfiguration(this.configSection);
        vsCodeWorkspaceConfig.update(key, value, vscode.ConfigurationTarget.Workspace);

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

    static getTreecipeConfigurationDetail():any {
        
        const configurationPath = this.getTreecipeConfigurationFilePath();
        let configurationJSON = null;
        if (fs.existsSync(configurationPath)) {
            configurationJSON = fs.readFileSync(configurationPath, 'utf-8');
        } else {
            const error = new Error(); 
            error.message = `Missing treecipe configuration setup at expected path of: ${ configurationPath } -- or unknown failure`; 
            throw(error);
        }

        const configurationDetail = JSON.parse(configurationJSON);
        return configurationDetail;
    }

    static getTreecipeConfigurationFilePath() {

        const treecipeConfigurationKey = "treecipeConfigurationPath";
        let configurationPath = this.getExtensionConfigValue(treecipeConfigurationKey);
        if ( !configurationPath ) {

            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
            const configurationFileName = this.getTreecipeConfigurationFileName();
            const configurationDirectory = this.getDefaultTreecipeConfigurationFolderName();
            const fullConfigurationDirectoryPath = `${workspaceRoot}/${configurationDirectory}`;
            configurationPath = path.join(fullConfigurationDirectoryPath, configurationFileName);
            this.setExtensionConfigValue(treecipeConfigurationKey, configurationPath);

        }

        return configurationPath;
        
    }

    static async createTreecipeJSONConfigurationFile() {

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
        ConfigurationService.setExtensionConfigValue('selectedFakerService', selectedDataFakerService);

        const configurationDetail = {
            // REPLACE ALL BACKSLASHES WITH FORWARD SLASHES IN PATH SO THERE IS CONSISTENT VALUE AND READ DIRECTORY WORKS AS EXPECTED
            salesforceObjectsPath: `${expectedObjectsPath.replace(/\\/g, "/")}`,
            dataFakerService: selectedDataFakerService
        };

        const treecipeBaseDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);

        this.createTreecipeConfigFile(configurationDetail, expectedTreecipeDirectoryPath);

    }

    static async createTreecipeConfigFile(treecipeContrigurationDetail, expectedTreecipeDirectoryPath) {

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(treecipeContrigurationDetail, null, 4);

        const configurationFileName = this.getTreecipeConfigurationFileName();

        const pathToCreateConfigurationFile = `${ expectedTreecipeDirectoryPath}/${configurationFileName }`;
        
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);

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

    static getSfdxProjectFileName() {
        const sfdxProjectFileName = 'sfdx-project.json';
        return sfdxProjectFileName;
    }

    static getSfdxProjectDetail(workspaceRoot: string): any {

        const sfdxProjectFilePath = path.join(workspaceRoot, this.getSfdxProjectFileName());

        if ( !(fs.existsSync(sfdxProjectFilePath)) ) {
            throw new Error(`No "${this.getSfdxProjectFileName()}" found at "${sfdxProjectFilePath}". Open this command from the root of a Salesforce DX project so the generated Apex can be written to a package directory.`);
        }

        return JSON.parse(fs.readFileSync(sfdxProjectFilePath, 'utf-8'));

    }

    static getSourceApiVersionFromSfdxProject(workspaceRoot: string): string {

        const sfdxProjectDetail = this.getSfdxProjectDetail(workspaceRoot);
        const defaultSourceApiVersion = '64.0';
        return sfdxProjectDetail?.sourceApiVersion ?? defaultSourceApiVersion;

    }

    /*
        Resolves which package directory generated Apex belongs in. A project with one entry, or one
        entry marked "default", answers itself; only a genuinely ambiguous project prompts. Returns
        undefined when the user dismisses that prompt so callers can abort without writing anything.
    */
    static async resolvePackageDirectoryPath(workspaceRoot: string): Promise<string | undefined> {

        const sfdxProjectDetail = this.getSfdxProjectDetail(workspaceRoot);
        const packageDirectories = sfdxProjectDetail?.packageDirectories;

        if ( !(Array.isArray(packageDirectories)) || packageDirectories.length === 0 ) {
            throw new Error(`"${this.getSfdxProjectFileName()}" declares no "packageDirectories". Add at least one package directory before generating picklist dependency tests.`);
        }

        if ( packageDirectories.length === 1 ) {
            return packageDirectories[0].path;
        }

        const defaultPackageDirectory = packageDirectories.find(packageDirectory => packageDirectory.default === true);
        if ( defaultPackageDirectory ) {
            return defaultPackageDirectory.path;
        }

        const packageDirectoryQuickPickItems = packageDirectories.map(packageDirectory => packageDirectory.path);
        const selectedPackageDirectoryPath = await vscode.window.showQuickPick(packageDirectoryQuickPickItems, {
            placeHolder: 'Select the package directory to write the generated Apex picklist dependency specs into'
        });

        return selectedPackageDirectoryPath;

    }

    /*
        Prefers a "classes" directory the project already has so generated Apex lands beside existing
        Apex rather than in a second, competing source tree.
    */
    static resolveApexClassesDirectoryPath(packageDirectoryFullPath: string): string {

        const existingClassesDirectoryPath = this.findExistingApexClassesDirectoryPath(packageDirectoryFullPath);
        if ( existingClassesDirectoryPath ) {
            return existingClassesDirectoryPath;
        }

        return path.join(packageDirectoryFullPath, 'main', 'default', 'classes');

    }

    private static findExistingApexClassesDirectoryPath(directoryPath: string): string | null {

        if ( !(fs.existsSync(directoryPath)) ) {
            return null;
        }

        const childDirectoryNames = fs.readdirSync(directoryPath, { withFileTypes: true })
                                        .filter(directoryEntry => directoryEntry.isDirectory())
                                        .map(directoryEntry => directoryEntry.name)
                                        .sort((firstName, secondName) => firstName.localeCompare(secondName));

        if ( childDirectoryNames.includes('classes') ) {
            return path.join(directoryPath, 'classes');
        }

        for ( const childDirectoryName of childDirectoryNames ) {

            const nestedClassesDirectoryPath = this.findExistingApexClassesDirectoryPath(path.join(directoryPath, childDirectoryName));
            if ( nestedClassesDirectoryPath ) {
                return nestedClassesDirectoryPath;
            }

        }

        return null;

    }

}