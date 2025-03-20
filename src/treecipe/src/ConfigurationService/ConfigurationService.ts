
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerService } from '../FakerService/IFakerService';
import { SnowfakeryFakerService } from '../FakerService/SnowfakeryFakerService/SnowfakeryFakerService';
import { FakerJSService } from '../FakerService/FakerJSService/FakerJSService';
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

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);

        const configurationFileName = this.getTreecipeConfigurationFileName();

        const pathToCreateConfigurationFile = `${ expectedTreecipeDirectoryPath}/${configurationFileName }`;
        
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);
        
    }

    static getSelectedDataFakerServiceConfig() {
        const selectedFakerServiceKey = "selectedFakerService";
        const fakerConfigurationSelection = this.getExtensionConfigValue(selectedFakerServiceKey);

        return fakerConfigurationSelection;
    }

    // getDataFakerService

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

    static getFakerImplementationByExtensionConfigSelection(): IFakerService {

        const fakerConfigurationSelection = this.getSelectedDataFakerServiceConfig();
        switch (fakerConfigurationSelection) {
            case 'snowfakery':
              return new SnowfakeryFakerService();
            case 'faker-js':
              return new FakerJSService();
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


}