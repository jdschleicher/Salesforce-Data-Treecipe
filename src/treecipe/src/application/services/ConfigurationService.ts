
import * as fs from 'fs';

export class ConfigurationService {

    static createConfigurationFile(expectedFieldPath: string) {

        const fileName = ".treecipe.config.json";
        const configurationDetail = {
            salesforceObjectsPath: ""
        };
    
        const configurationJsonData = JSON.stringify(configurationDetail, null, 2);
        fs.writeFileSync(fileName, configurationJsonData);
        
    }

}