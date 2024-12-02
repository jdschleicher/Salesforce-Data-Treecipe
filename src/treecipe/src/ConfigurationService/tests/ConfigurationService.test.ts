
import { ConfigurationService } from '../ConfigurationService';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn(() => ({
            get: jest.fn((key) => {
                const mockConfig = {
                    selectedFakerService: 'expectedMockValue', // Replace with mock key-value pairs as needed
                };
                return mockConfig[key];
            }),
        })),
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn()
    },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });




describe('Shared ConfigurationService Tests', () => {


    describe ('getExtensionConfigValue', () => {

        test('given expected setup of "selectedFakerService" extension config value, returns expected config value', () => {
          
            const requiredInterfaceConfigKeyToMockValue = "selectedFakerService";
            const actualMockedExtensionConfigValue = ConfigurationService.getExtensionConfigValue(requiredInterfaceConfigKeyToMockValue);
            const expectedMockedExtensionConfigValue = "expectedMockValue";
            expect(actualMockedExtensionConfigValue).toBe(expectedMockedExtensionConfigValue);
        
        });
    
   

    });

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


});



