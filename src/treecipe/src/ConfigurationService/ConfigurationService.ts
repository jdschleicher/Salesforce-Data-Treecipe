
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';
import { IFakerService } from '../FakerService/IFakerService';
import { NPMFakerService } from '../FakerService/NPMFakerService';
import { SnowfakeryFakerService } from '../FakerService/SnowfakeryFakerService';

import * as fs from 'fs';
import path = require('path');
import * as vscode from 'vscode';


export interface ExtensionConfig {
    selectedFakerService?: string;
    treecipeConfigurationPath?: string;
}

export class ConfigurationService {
    
    private static instance: ConfigurationService;
    private static configSection = 'salesforce-data-treecipe';


    static getInstance(): ConfigurationService {
        if (!ConfigurationService.instance) {
            ConfigurationService.instance = new ConfigurationService();
        }
        return ConfigurationService.instance;
    }

    static getConfig(): ExtensionConfig {

        const vsCodeExtensionConfig = vscode.workspace.getConfiguration(this.configSection);
        
        return {
            selectedFakerService: vsCodeExtensionConfig.get('SELECTED_FAKER_SERVICE'),
            treecipeConfigurationPath: vsCodeExtensionConfig.get('TREECIPE_CONFIGURATION_PATH')
        };
    }

    static updateConfig(configUpdates: Partial<ExtensionConfig>) {
        const vsCodeExtensionConfig = vscode.workspace.getConfiguration(this.configSection);
        
        for (const [key, value] of Object.entries(configUpdates)) {
            vsCodeExtensionConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
        }
    }

    static getConfigValue<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
        return vscode.workspace.getConfiguration(this.configSection).get(key as string);
    }

    static setConfigValue<K extends keyof ExtensionConfig>( key: K, value: ExtensionConfig[K]) {

        const vsCodeExtensionConfig = vscode.workspace.getConfiguration(this.configSection);
        vsCodeExtensionConfig.update(key, value, vscode.ConfigurationTarget.Workspace);

    }

    static getObjectsPathFromConfiguration() {

        const configurationDetail = this.getTreecipeConfigurationDetail();
        return configurationDetail.salesforceObjectsPath;

    }

    static getTreecipeConfigurationDetail() {
        
        const configurationPath = this.getTreecipeConfigurationFilePath();
        
        let configurationJSON = null;
        try {
            configurationJSON = fs.readFileSync(configurationPath, 'utf-8');
        } catch(error) {
            console.log("A CONFIGURATION FILE WAS NOT PARSED. THE CONFIG MAY NOT YET EXIST. RUN THE COMMAND INITIATE CONFIGURATION");
        }

        const configurationDetail = JSON.parse(configurationJSON);
        return configurationDetail;
    }

    static getTreecipeConfigurationFilePath() {

        const treecipeConfigurationKey = "treecipeConfigurationPath";
        let configurationPath = this.getConfigValue(treecipeConfigurationKey);
        if ( !configurationPath ) {
            const workspaceRoot = VSCodeWorkspaceService.getWorkspaceRoot();
            const configurationFileName = this.getConfigurationFileName();
            const configurationDirectory = this.getDefaultTreecipeConfigurationFolderName();
            const fullConfigurationDirectoryPath = `${workspaceRoot}/${configurationDirectory}`;
            configurationPath = path.join(fullConfigurationDirectoryPath, configurationFileName);
            this.setConfigValue(treecipeConfigurationKey, configurationPath);

        }

        return configurationPath;
        
    }

    static async createConfigurationFile() {

        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();

        const expectedObjectsPath = await VSCodeWorkspaceService.promptForObjectsPath(workspaceRoot);
        if (!expectedObjectsPath) {
            return;
        };

        const selectedDataFakerService = await VSCodeWorkspaceService.promptForFakerServiceImplementation();
        if (!expectedObjectsPath) {
            return;
        };
        const configurationFileName = this.getConfigurationFileName();
        const configurationDetail = {
            salesforceObjectsPath: `${expectedObjectsPath}`,
            dataFakerService: selectedDataFakerService
        };

        const treecipeBaseDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const expectedTreecipeDirectoryPath = path.join(workspaceRoot, treecipeBaseDirectory);

        if (!fs.existsSync(expectedTreecipeDirectoryPath)) {
            fs.mkdirSync(expectedTreecipeDirectoryPath);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);
        const pathToCreateConfigurationFile = `${expectedTreecipeDirectoryPath}/${configurationFileName}`;
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);
        
    }

    static getDefaultTreecipeConfigurationFolderName() {
        const defaultTreecipeConfigurationFolder = "treecipe";
        return defaultTreecipeConfigurationFolder;
    }

    static getConfigurationFileName() {
        const configurationFileName = "treecipe.config.json";
        return configurationFileName;
    }

    static getFakerImplementationByConfigurationSelection(): IFakerService {

        const selectedFakerServiceKey = "selectedFakerService";
        const fakerConfigurationSelection = this.getConfigValue(selectedFakerServiceKey);
        switch (fakerConfigurationSelection) {
            case 'Snowfakery':
              return new SnowfakeryFakerService();
            case 'faker-js':
              return new NPMFakerService();
            default:
              throw new Error(`Unknown Faker Service selection: ${fakerConfigurationSelection}`);
          }
    
    }

}