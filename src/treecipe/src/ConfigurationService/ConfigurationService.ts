
import * as fs from 'fs';
import path = require('path');
import { VSCodeWorkspaceService } from '../VSCodeWorkspace/VSCodeWorkspaceService';


export class ConfigurationService {
    
    static async getObjectsPathFromConfiguration() {

        const configurationDetail = await this.getConfigurationDetail();
        return configurationDetail.salesforceObjectsPath;

    }

    static async getConfigurationDetail() {
        const configurationFileName = this.getConfigurationFileName();
        const configurationDirectory = this.getDefaultTreecipeConfigurationFolderName();
        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();

        const fullConfigurationDirectoryPath = `${workspaceRoot}/${configurationDirectory}`;
        const configurationPath = path.join(fullConfigurationDirectoryPath, configurationFileName);
        
        let configurationJSON = null;
        try {
            configurationJSON = fs.readFileSync(configurationPath, 'utf-8');
        } catch(error) {
            console.log("A CONFIGURATION FILE WAS NOT PARSED. THE CONFIG MAY NOT YET EXIST. RUN THE COMMAND INITIATE CONFIGURATION");
        }

        const configurationDetail = JSON.parse(configurationJSON);
        return configurationDetail;
    }


    static async createConfigurationFile() {

        const workspaceRoot = await VSCodeWorkspaceService.getWorkspaceRoot();

        const expectedObjectsPath = await VSCodeWorkspaceService.promptForObjectsPath(workspaceRoot);
        if (!expectedObjectsPath) {
            return;
        };
        const configurationFileName = this.getConfigurationFileName();
        const configurationDetail = {
            salesforceObjectsPath: `${expectedObjectsPath}`
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
        const defaultTreecipeConfigurationFolder = ".treecipe";
        return defaultTreecipeConfigurationFolder;
    }

    static getConfigurationFileName() {
        const configurationFileName = ".treecipe.config.json";
        return configurationFileName;
    }
    

}