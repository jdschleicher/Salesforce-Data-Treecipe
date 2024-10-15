
import * as fs from 'fs';

export class ConfigurationService {

    static createConfigurationFile(expectedFieldPath: string) {

        const configurationFileName = ".treecipe.config.json";
        const configurationDetail = {
            salesforceObjectsPath: ""
        };

        const treeCipeBaseDirectory = ".treecipe";
        if (!fs.existsSync(treeCipeBaseDirectory)) {
            fs.mkdirSync(treeCipeBaseDirectory);
        }

        const configurationJsonData = JSON.stringify(configurationDetail, null, 4);
        const pathToCreateConfigurationFile = `${treeCipeBaseDirectory}/${configurationFileName}`;
        fs.writeFileSync(pathToCreateConfigurationFile, configurationJsonData);
        
    }

}