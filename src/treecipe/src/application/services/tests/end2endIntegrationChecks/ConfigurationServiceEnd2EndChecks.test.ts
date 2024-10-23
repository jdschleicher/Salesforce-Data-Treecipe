import { ConfigurationService } from "../../ConfigurationService";
import * as fs from 'fs';


describe('createConfigurationFile', () => {

    

    test('given a vscode workspace root directory, a dedicated extension directory is created with base config file', () => {
  
    const expectedNewDirectory = ".treecipe";
    const expectedFileName = ".treecipe.config.json";

    const expectedConfigJson = 
`{
    "salesforceObjectsPath": ""
}`;

    const expectedFieldPath = `${expectedNewDirectory}/${expectedFileName}`;

    ConfigurationService.createConfigurationFile();
    const createdFileContent = fs.readFileSync(expectedFieldPath, 'utf-8');

    expect(createdFileContent).toBe(expectedConfigJson);

  });

});

// create configuration .treecipe directory 
// create .treecipe.config.json file inside treecipe directory 
// create timestamped directory for treecipe generation
// recipe yaml file created matches expected markup

// 

describe('getConfigurationFileName', () => {

    test('given getConfigurationFileName called, expected file name returned', () => {
        const expectedFileName = ".treecipe.config.json";
        const actualConfigurationFileName = ConfigurationService.getConfigurationFileName();

        expect(actualConfigurationFileName).toBe(expectedFileName);
    });

});

describe('getDefaultTreecipeConfigurationFolderName', () => {
    const expectedFolderName = ".treecipe";
    const actualConfigurationFolderName = ConfigurationService.getDefaultTreecipeConfigurationFolderName();

    expect(actualConfigurationFolderName).toBe(expectedFolderName);
});
