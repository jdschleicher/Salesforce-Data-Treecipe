
import * as fs from 'fs';
import { ConfigurationService } from '../ConfigurationService';

describe('createConfigurationFile', () => {


  test('given a vscode workspace root directory, a dedicated extension directory is created with base config file', () => {
  
    const expectedNewDirectory = ".treecipe";
    const expectedFileName = ".treecipe.config.json";

    const expectedConfigJson = 
`{
    "salesforceObjectsPath": ""
}`;

    const expectedFieldPath = `${expectedNewDirectory}/${expectedFileName}`;

    ConfigurationService.createConfigurationFile(expectedFieldPath);
    const createdFileContent = fs.readFileSync(expectedFieldPath, 'utf-8');

    expect(createdFileContent).toBe(expectedConfigJson);

  });

});

