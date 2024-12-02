
import { ConfigurationService } from '../ConfigurationService';

describe('getTreecipeConfigurationFileName', () => {

    test('given getTreecipeConfigurationFileName called, expected file name returned', () => {
        const expectedFileName = "treecipe.config.json";
        const actualConfigurationFileName = ConfigurationService.getTreecipeConfigurationFileName();

        expect(actualConfigurationFileName).toBe(expectedFileName);
    });

});

describe('getDefaultTreecipeConfigurationFolderName', () => {
    const expectedFolderName = "treecipe";
    const actualConfigurationFolderName = ConfigurationService.getDefaultTreecipeConfigurationFolderName();

    expect(actualConfigurationFolderName).toBe(expectedFolderName);
});

