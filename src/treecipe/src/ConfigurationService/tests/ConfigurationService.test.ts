import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ConfigurationService } from '../ConfigurationService';

import * as fs from 'fs';
import * as vscode from 'vscode';

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

        test('given mocked empty return for VSCodeWorkspaceService.promptForObjectsPath to mimic no selection, prevents method from completing', async () => {
            
        
            const noSelectionMimic = null;
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(noSelectionMimic);
            jest.spyOn(VSCodeWorkspaceService, 'promptForObjectsPath').mockImplementation(async () => {
                return noSelectionMimic;
            });

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue');
            jest.spyOn(ConfigurationService, 'createTreecipeConfigFile');

        
            await ConfigurationService.createTreecipeJSONConfigurationFile();
            
            expect(ConfigurationService.setExtensionConfigValue).not.toHaveBeenCalled();
            expect(ConfigurationService.createTreecipeConfigFile).not.toHaveBeenCalled();

        });

        test('given mocked empty return for VSCodeWorkspaceService.promptForFakerServiceImplementation to mimic no selection, prevents method from completing', async () => {
            
        
            const mockWorkspaceRoot = '/mock/workspace/root';
            const mockObjectsPath = '/mock/objects/path';
                   
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(VSCodeWorkspaceService, 'promptForObjectsPath').mockImplementation(async () => {
                return mockObjectsPath;
            });

            const noSelectionMimic = null;
            jest.spyOn(VSCodeWorkspaceService, 'promptForFakerServiceImplementation').mockImplementation(async () => {
                return noSelectionMimic;
            });

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue');
            jest.spyOn(ConfigurationService, 'createTreecipeConfigFile');

            await ConfigurationService.createTreecipeJSONConfigurationFile();
            
            expect(ConfigurationService.setExtensionConfigValue).not.toHaveBeenCalled();
            expect(ConfigurationService.createTreecipeConfigFile).not.toHaveBeenCalled();

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

    describe('getCustomRelationshipMappings', () => {

        beforeEach(() => {
            jest.clearAllMocks();
        });

        test('given config with customRelationshipMappings present, returns the mapping object', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery",
    "customRelationshipMappings": {
        "CustomObject__c.Primary_Contact__c": "Contact",
        "Project__c.Owner_Account__c": "Account"
    }
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualMappings = ConfigurationService.getCustomRelationshipMappings();

            expect(actualMappings).toEqual({
                "CustomObject__c.Primary_Contact__c": "Contact",
                "Project__c.Owner_Account__c": "Account"
            });

        });

        test('given config without customRelationshipMappings property, returns empty object', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery"
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualMappings = ConfigurationService.getCustomRelationshipMappings();

            expect(actualMappings).toEqual({});

        });

        test('given config with customRelationshipMappings set to null, returns empty object', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery",
    "customRelationshipMappings": null
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockReturnValue();

            const actualMappings = ConfigurationService.getCustomRelationshipMappings();

            expect(actualMappings).toEqual({});

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

    describe('getDatasetFilesForCollectionsApiFolderName', () => {

        test('returns expected dataset collections api folder name', () => {

            const expectedCollectionsApiFolderName = 'DatasetFilesForCollectionsApi';
            const actualCollectionsApiFolderName = ConfigurationService.getDatasetFilesForCollectionsApiFolderName();

            expect(actualCollectionsApiFolderName).toBe(expectedCollectionsApiFolderName);

        });

    });

    describe('getFakerRecipeProcessorByExtensionConfigSelection', () => {
      
        test('returns SnowfakeryRecipeProcessor when config is "snowfakery"', () => {
          
            jest
                .spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig')
                .mockReturnValue('snowfakery');
        
            const processor = ConfigurationService.getFakerRecipeProcessorByExtensionConfigSelection();
            expect(processor).toBeInstanceOf(SnowfakeryRecipeProcessor);
        
        });
      
        test('returns FakerJSRecipeProcessor when config is "faker-js"', () => {
          
            jest
                .spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig')
                .mockReturnValue('faker-js');
      
            const processor = ConfigurationService.getFakerRecipeProcessorByExtensionConfigSelection();
            expect(processor).toBeInstanceOf(FakerJSRecipeProcessor);
        
        });
      
        test('throws an error when config is unknown', () => {
          
            jest
                .spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig')
                .mockReturnValue('unknown-option');
        
            expect(() =>
                ConfigurationService.getFakerRecipeProcessorByExtensionConfigSelection()
            ).toThrowError('Unknown Faker Recipe Processor selection: unknown-option');

        });
      });

    describe('getSfdxProjectDetail', () => {

        test('given no sfdx-project.json in the workspace, an actionable error naming the expected path is thrown', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            expect(() => ConfigurationService.getSfdxProjectDetail('/mock/workspace'))
                .toThrowError('No "sfdx-project.json" found at');

        });

        test('given an sfdx-project.json, the parsed project detail is returned', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'mock-project' }));

            expect(ConfigurationService.getSfdxProjectDetail('/mock/workspace').name).toBe('mock-project');

        });

    });

    describe('getSourceApiVersionFromSfdxProject', () => {

        test('given a declared sourceApiVersion, that version is returned', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ sourceApiVersion: '62.0' }));

            expect(ConfigurationService.getSourceApiVersionFromSfdxProject('/mock/workspace')).toBe('62.0');

        });

        test('given no declared sourceApiVersion, a default api version is returned', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({}));

            expect(ConfigurationService.getSourceApiVersionFromSfdxProject('/mock/workspace')).toBe('64.0');

        });

    });

    describe('resolvePackageDirectoryPath', () => {

        const mockSfdxProjectDetail = (sfdxProjectDetail: any) => {
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(sfdxProjectDetail));
        };

        test('given a single package directory, that directory is used without prompting', async () => {

            mockSfdxProjectDetail({ packageDirectories: [{ path: 'force-app' }] });
            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick');

            expect(await ConfigurationService.resolvePackageDirectoryPath('/mock/workspace')).toBe('force-app');
            expect(showQuickPickSpy).not.toHaveBeenCalled();

        });

        test('given multiple package directories with one marked default, the default is used without prompting', async () => {

            mockSfdxProjectDetail({
                packageDirectories: [
                    { path: 'utils' },
                    { path: 'force-app', default: true }
                ]
            });
            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick');

            expect(await ConfigurationService.resolvePackageDirectoryPath('/mock/workspace')).toBe('force-app');
            expect(showQuickPickSpy).not.toHaveBeenCalled();

        });

        test('given multiple package directories with none marked default, the user is prompted', async () => {

            mockSfdxProjectDetail({
                packageDirectories: [
                    { path: 'utils' },
                    { path: 'force-app' }
                ]
            });
            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue('utils' as any);

            expect(await ConfigurationService.resolvePackageDirectoryPath('/mock/workspace')).toBe('utils');
            expect(showQuickPickSpy).toHaveBeenCalledWith(['utils', 'force-app'], expect.anything());

        });

        test('given the user dismisses the package directory prompt, undefined is returned so nothing is written', async () => {

            mockSfdxProjectDetail({
                packageDirectories: [
                    { path: 'utils' },
                    { path: 'force-app' }
                ]
            });
            jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as any);

            expect(await ConfigurationService.resolvePackageDirectoryPath('/mock/workspace')).toBeUndefined();

        });

        test('given no packageDirectories entries, an actionable error is thrown', async () => {

            mockSfdxProjectDetail({ packageDirectories: [] });

            await expect(ConfigurationService.resolvePackageDirectoryPath('/mock/workspace'))
                .rejects.toThrowError('declares no "packageDirectories"');

        });

    });

    describe('resolveApexClassesDirectoryPath', () => {

        test('given a package directory with an existing nested classes directory, that directory is used', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readdirSync').mockImplementation((readPath: any) => {

                const normalizedReadPath = String(readPath).replace(/\\/g, '/');
                if (normalizedReadPath.endsWith('/force-app')) {
                    return [{ name: 'main', isDirectory: () => true }] as any;
                }
                if (normalizedReadPath.endsWith('/force-app/main')) {
                    return [{ name: 'default', isDirectory: () => true }] as any;
                }
                if (normalizedReadPath.endsWith('/force-app/main/default')) {
                    return [{ name: 'classes', isDirectory: () => true }] as any;
                }

                return [] as any;

            });

            const resolvedClassesDirectoryPath = ConfigurationService.resolveApexClassesDirectoryPath('/mock/workspace/force-app');

            expect(resolvedClassesDirectoryPath.replace(/\\/g, '/')).toBe('/mock/workspace/force-app/main/default/classes');

        });

        test('given a package directory with no classes directory, the conventional main/default/classes path is returned', () => {

            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            const resolvedClassesDirectoryPath = ConfigurationService.resolveApexClassesDirectoryPath('/mock/workspace/force-app');

            expect(resolvedClassesDirectoryPath.replace(/\\/g, '/')).toBe('/mock/workspace/force-app/main/default/classes');

        });

    });

});



