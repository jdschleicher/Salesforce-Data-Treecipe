
import { ConfigurationService } from '../ConfigurationService';

describe('getConfigurationFileName', () => {

    test('given getConfigurationFileName called, expected file name returned', () => {
        const expectedFileName = "treecipe.config.json";
        const actualConfigurationFileName = ConfigurationService.getConfigurationFileName();

        expect(actualConfigurationFileName).toBe(expectedFileName);
    });

});

describe('getDefaultTreecipeConfigurationFolderName', () => {
    const expectedFolderName = "treecipe";
    const actualConfigurationFolderName = ConfigurationService.getDefaultTreecipeConfigurationFolderName();

    expect(actualConfigurationFolderName).toBe(expectedFolderName);
});

