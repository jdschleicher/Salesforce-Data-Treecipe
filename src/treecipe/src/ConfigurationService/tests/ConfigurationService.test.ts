import { Config } from '@salesforce/core';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService';

import * as fs from 'fs';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn(() => ({
            get: jest.fn((key) => {
                const mockConfig = {
                    selectedFakerService: 'snowfakery', // Replace with mock key-value pairs as needed
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
            const expectedMockedExtensionConfigValue = "snowfakery";
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

        test('given expected setup of "selectedFakerService" extension config value, returns expecte IRecipeFakerService implementation', () => {
            
            const actualImplementationFakerService = ConfigurationService.getFakerImplementationByExtensionConfigSelection();
            expect(actualImplementationFakerService).toBeInstanceOf(SnowfakeryRecipeFakerService);

        });

    });

        
    describe('createTreecipeJSONConfigurationFile', () => {

        beforeEach(() => {
            jest.clearAllMocks();
        });

        test('given mocked functions for VSCodeWorkspaceService, fs, and path, the expected values are used as arguments', async () => {
            
            const mockWorkspaceRoot = '/mock/workspace/root';
            const mockObjectsPath = '/mock/objects/path';
            const mockConfigFileName = 'treecipe.config.json';
            const mockTreecipeBaseDir = 'treecipe';
        
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
        
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'promptForObjectsPath').mockImplementation(async () => {
                return mockObjectsPath;
            });
            jest.spyOn(VSCodeWorkspaceService, 'promptForFakerServiceImplementation').mockImplementation(async () => {
                return 'faker-js';
            });

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockImplementation();
            
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            jest.spyOn(fs, 'mkdirSync').mockReturnValue(mockTreecipeBaseDir);
            jest.spyOn(fs, 'writeFileSync').mockReturnValue();

            await ConfigurationService.createTreecipeJSONConfigurationFile();
        
            expect(VSCodeWorkspaceService.getWorkspaceRoot).toHaveBeenCalled();
            expect(VSCodeWorkspaceService.promptForObjectsPath).toHaveBeenCalledWith(mockWorkspaceRoot);

            expect(fs.mkdirSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}`);
            expect(fs.existsSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}`);

            const expectedConfigJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "faker-js"
}`;
            expect(fs.writeFileSync).toHaveBeenCalledWith(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}/${mockConfigFileName}`, expectedConfigJson);

        });

        test('given mocked path value with windows backslashes in path, the expected path is set in treecipe configuration json file', async () => {
        
            const mockWorkspaceRoot = '/mock/workspace/root';
            const mockObjectsPath = '\\mock\\objects\\path';
            const mockConfigFileName = 'treecipe.config.json';
            const mockTreecipeBaseDir = 'treecipe';
        
            jest.spyOn(ConfigurationService, 'getExtensionConfigValue').mockReturnValue('snowfakery');
        
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'promptForObjectsPath').mockImplementation(async () => {
                return mockObjectsPath;
            });
            jest.spyOn(VSCodeWorkspaceService, 'promptForFakerServiceImplementation').mockImplementation(async () => {
                return 'snowfakery';
            });

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockImplementation();
            
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
    "dataFakerService": "snowfakery"
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
    "dataFakerService": "snowfakery"
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualTreecipeConfiguratoinDetail = ConfigurationService.getTreecipeConfigurationDetail();
            expect(actualTreecipeConfiguratoinDetail.dataFakerService).toBe("snowfakery");
        });

    });

    describe('getObjectsPathFromTreecipeJSONConfiguration', () => {

        test('given mocked configuration, returns expected objects path.', () => {
            
            const mockObjectsPath = '/mock/objects/path';
            const mockWorkspaceRoot = '/mock/workspace/root';

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "${mockObjectsPath}",
    "dataFakerService": "snowfakery"
}`;
            
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualConfigurationObjectsPath = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            expect(actualConfigurationObjectsPath).toBe(mockObjectsPath);

        });

    });

    describe('getFakeDataSetsFolderName', () => {

        test('returns expected treecipe dataset artifcats folder name', () => {
            const expectedFolderName = "FakeDataSets";
            const actualFolderName = ConfigurationService.getFakeDataSetsFolderName();
            expect(actualFolderName).toBe(expectedFolderName);
        });

    });

    describe('getFakeDataSetsFolderPath', () => {

        test('returns expected treecipe folder name for dataset artifacts folder path', () => {
            const expectedFolderPath = "treecipe/FakeDataSets";
            const actualFolderPath = ConfigurationService.getFakeDataSetsFolderPath();
            expect(actualFolderPath).toBe(expectedFolderPath);
        });

    });

    describe('getGeneratedRecipesDefaultFolderName', () => {

        test('returns expected generated recipe artifcats folder name', () => {
            const expectedFolderName = "GeneratedRecipes";
            const actualFolderName = ConfigurationService.getGeneratedRecipesDefaultFolderName();
            expect(actualFolderName).toBe(expectedFolderName);
        });

    });

    describe('getGeneratedRecipesFolderPath', () => {

        test('returns expected path from project root for treecipe generated recipe artifacts', () => {
            const expectedFolderPath = "treecipe/GeneratedRecipes";
            const actualFolderPath = ConfigurationService.getGeneratedRecipesFolderPath();
            expect(actualFolderPath).toBe(expectedFolderPath);
        });

    });

    describe('getBaseArtifactsFolderName', () => {

        test('returns expected base artifcats folder name', () => {
            const expectedFolderName = "BaseArtifactFiles";
            const actualFolderName = ConfigurationService.getBaseArtifactsFolderName();
            expect(actualFolderName).toBe(expectedFolderName);
        });

    });

    describe('getDatasetCollectionApiFilesFolderName', () => {

        test('returns expected dataset collections api folder name', () => {
            const expectedFolderName = "DatasetFilesForCollectionsApi";
            const actualFolderName = ConfigurationService.getDatasetCollectionApiFilesFolderName();
            expect(actualFolderName).toBe(expectedFolderName);
        });

    });

    describe('getTreecipeObjectsWrapperName', () => {

        test('returns expected treecipe object wrapper name', () => {

            const expectedWrapperName = 'treecipeObjectsWrapper';
            const actualWrapperName = ConfigurationService.getTreecipeObjectsWrapperName();

            expect(actualWrapperName).toBe(expectedWrapperName);

        });

    });

});



