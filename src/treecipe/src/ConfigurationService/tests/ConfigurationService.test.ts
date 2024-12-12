
import { SnowfakeryFakerService } from '../../FakerService/SnowfakeryFakerService/SnowfakeryFakerService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService';


import * as fs from 'fs';
import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn(() => ({
            get: jest.fn((key) => {
                const mockConfig = {
                    selectedFakerService: 'Snowfakery', // Replace with mock key-value pairs as needed
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
            const expectedMockedExtensionConfigValue = "Snowfakery";
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

    describe('getFakerImplementationByExtensionConfigSelection', () => {

        test('given expected setup of "selectedFakerService" extension config value, returns expecte IFakerService implementation', () => {
            
            const actualImplementationFakerService = ConfigurationService.getFakerImplementationByExtensionConfigSelection();
            expect(actualImplementationFakerService).toBeInstanceOf(SnowfakeryFakerService);

        });

    });

        
    describe('createTreecipeJSONConfigurationFile', () => {

        beforeEach(() => {
            jest.clearAllMocks();
        });

        test('given mocked functions for VSCodeWorkspaceService, fs, and path, the expected values are used as arguments', async () => {
            // Setup mock values
            const mockWorkspaceRoot = '/mock/workspace/root';
            const mockObjectsPath = '/mock/objects/path';
            const mockConfigFileName = 'treecipe.config.json';
            const mockTreecipeBaseDir = 'treecipe';
        
            // // Mock method implementations
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue(true);
        
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'promptForObjectsPath').mockImplementation(async () => {
                return mockObjectsPath;
            });

            
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            jest.spyOn(fs, 'mkdirSync').mockReturnValue(mockTreecipeBaseDir);
            jest.spyOn(fs, 'writeFileSync').mockReturnValue();

            await ConfigurationService.createTreecipeJSONConfigurationFile();
        
            // Assertions
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();
            expect(VSCodeWorkspaceService.promptForObjectsPath).toHaveBeenCalledWith(mockWorkspaceRoot);

            expect(fs.mkdirSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}`);
            expect(fs.existsSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}`);

            const expectedConfigJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "Snowfakery"
}`;
            expect(fs.writeFileSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}/${mockConfigFileName}`, expectedConfigJson);

          });

    });

    describe('getTreecipeConfigurationDetail', () => {

        beforeEach(() => {
            jest.clearAllMocks();
        });
  
        test('given mocked functions, returns expected configuration detail', () => {
            
            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "Snowfakery"
}`;

            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualTreecipeConfiguratoinDetail = ConfigurationService.getTreecipeConfigurationDetail();
            expect(actualTreecipeConfiguratoinDetail.dataFakerService).toBe("Snowfakery");
        });

    });

    describe('getObjectsPathFromTreecipeJSONConfiguration', () => {

        test('given mocked configuration, returns expected objects path.', () => {
            
            const mockObjectsPath = '/mock/objects/path';

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "${mockObjectsPath}",
    "dataFakerService": "Snowfakery"
}`;
            
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualConfigurationObjectsPath = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            expect(actualConfigurationObjectsPath).toBe(mockObjectsPath);

        });

    });
        

});



