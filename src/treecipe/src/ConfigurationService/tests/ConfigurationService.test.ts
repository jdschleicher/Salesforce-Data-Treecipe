import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { ConfigurationService, MissingTreecipeConfigurationError } from '../ConfigurationService';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
            // update RETURNS A THENABLE, AND VS CODE REJECTS IT WHEN THERE IS NO WORKSPACE TO WRITE TO
            update: jest.fn().mockResolvedValue(undefined),
            // NO SETTING AT ANY SCOPE
            inspect: jest.fn(() => undefined),
        })),
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showQuickPick: jest.fn()
    },
    ConfigurationTarget: { Workspace: 2 },
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

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
            
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            jest.spyOn(fs, 'mkdirSync').mockReturnValue(mockTreecipeBaseDir);
            jest.spyOn(fs, 'writeFileSync').mockReturnValue();

            const configurationFilePath = await ConfigurationService.createTreecipeJSONConfigurationFile();
        
            // THE PATH Initiate Configuration File's NOTIFICATION OPENS AND REVEALS (#206)
            expect(configurationFilePath).toBe(`${mockWorkspaceRoot}/${mockTreecipeBaseDir}/${mockConfigFileName}`);

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

            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
            
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

        
            const configurationFilePath = await ConfigurationService.createTreecipeJSONConfigurationFile();
            
            expect(configurationFilePath).toBeUndefined();
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

            const configurationFilePath = await ConfigurationService.createTreecipeJSONConfigurationFile();
            
            expect(configurationFilePath).toBeUndefined();
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
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

            const actualTreecipeConfiguratoinDetail = ConfigurationService.getTreecipeConfigurationDetail();
            expect(actualTreecipeConfiguratoinDetail.dataFakerService).toBe("snowfakery");
        });

    });

    /*
        #171. The setting holds an absolute path saved the first time the config was found, so a moved
        or re-cloned project -- or a .vscode/settings.json committed from another machine -- left it
        naming a file that was not there, and every command reported the config missing while
        treecipe/treecipe.config.json sat in the workspace. Real directories, so containment and the
        symlink case are checked against a real file system rather than a mocked one.
    */
    describe('resolveTreecipeConfigurationFilePath', () => {

        const settingName = 'salesforce-data-treecipe.treecipeConfigurationPath';

        let sandboxDirectoryPath: string;
        let workspaceRoot: string;
        let workspaceConfigurationPath: string;
        let outsideDirectoryPath: string;
        let setExtensionConfigValueSpy: jest.SpyInstance;
        let showWarningMessageSpy: jest.SpyInstance;

        const writeConfigurationFile = (configurationFilePath: string, salesforceObjectsPath: string) => {
            fs.mkdirSync(path.dirname(configurationFilePath), { recursive: true });
            fs.writeFileSync(configurationFilePath, JSON.stringify({ salesforceObjectsPath, dataFakerService: 'faker-js' }));
        };

        // get() ANSWERS THE MERGED VALUE (default < User < workspace < folder), THE WAY VS CODE DOES
        const useTreecipeConfigurationPathSetting = (inspectedSetting: Record<string, unknown> | undefined) => {
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn(() => inspectedSetting?.workspaceFolderValue ?? inspectedSetting?.workspaceValue ?? inspectedSetting?.globalValue),
                update: jest.fn().mockResolvedValue(undefined),
                inspect: jest.fn(() => inspectedSetting)
            });
        };

        beforeEach(() => {

            sandboxDirectoryPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-config-path-')));
            workspaceRoot = path.join(sandboxDirectoryPath, 'workspace');
            outsideDirectoryPath = path.join(sandboxDirectoryPath, 'outside');
            fs.mkdirSync(workspaceRoot);
            fs.mkdirSync(outsideDirectoryPath);
            workspaceConfigurationPath = path.join(workspaceRoot, 'treecipe', 'treecipe.config.json');

            // SESSION STATE: WITHOUT THIS, A TEST REUSING A STALE VALUE WOULD PASS OR FAIL BY TEST ORDER
            ConfigurationService['replacedStaleTreecipeConfigurationPaths'].clear();

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(workspaceRoot);
            setExtensionConfigValueSpy = jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

        });

        afterEach(() => {
            fs.rmSync(sandboxDirectoryPath, { recursive: true, force: true });
        });

        test('given a stored path to a config file inside the workspace, uses it without a rewrite or a warning', () => {

            const storedConfigurationPath = path.join(workspaceRoot, 'custom', 'treecipe.config.json');
            writeConfigurationFile(storedConfigurationPath, './custom/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: storedConfigurationPath });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({ configurationFilePath: storedConfigurationPath });
            expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        // THE REPRODUCTION: THE PROJECT MOVED, AND THE SETTING STILL NAMES WHERE IT USED TO BE
        test('given a stored path that does not exist and a workspace config, reads the workspace config', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            const staleConfigurationPath = path.join(outsideDirectoryPath, 'old-location', 'treecipe', 'treecipe.config.json');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') });

            expect(ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration()).toBe('./force-app/main/default/objects/');

            useTreecipeConfigurationPathSetting({ workspaceValue: staleConfigurationPath });
            expect(ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration()).toBe('./force-app/main/default/objects/');

        });

        test('given a stored path that does not exist, rewrites the setting to the workspace config and says what it replaced', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            const staleConfigurationPath = path.join(workspaceRoot, 'moved-away', 'treecipe.config.json');
            useTreecipeConfigurationPathSetting({ workspaceValue: staleConfigurationPath });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({
                configurationFilePath: workspaceConfigurationPath,
                staleStoredPath: staleConfigurationPath,
                staleReason: 'not-found'
            });
            expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('treecipeConfigurationPath', workspaceConfigurationPath);

            const warning = String(showWarningMessageSpy.mock.calls[0][0]);
            expect(warning).toContain(settingName);
            expect(warning).toContain(staleConfigurationPath);
            expect(warning).toContain('does not exist');
            expect(warning).toContain(workspaceConfigurationPath);

        });

        test('given a stored path naming a directory, treats it as stale', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            const directoryPath = path.join(workspaceRoot, 'treecipe');
            useTreecipeConfigurationPathSetting({ workspaceValue: directoryPath });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution.configurationFilePath).toBe(workspaceConfigurationPath);
            expect(resolution.staleReason).toBe('not-a-file');
            expect(String(showWarningMessageSpy.mock.calls[0][0])).toContain('is not a file');

        });

        // A COMMITTED .vscode/settings.json CONTROLS THIS VALUE, SO IT IS REFUSED BEFORE ANYTHING READS IT
        test('given a stored path outside the workspace, never reads it, even though the file exists', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            const outsideConfigurationPath = path.join(outsideDirectoryPath, 'treecipe.config.json');
            writeConfigurationFile(outsideConfigurationPath, './outside/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: outsideConfigurationPath });
            const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

            const configurationDetail = ConfigurationService.getTreecipeConfigurationDetail();

            expect(configurationDetail.salesforceObjectsPath).toBe('./force-app/main/default/objects/');
            expect(readFileSyncSpy.mock.calls.map(call => String(call[0]))).not.toContain(outsideConfigurationPath);
            expect(String(showWarningMessageSpy.mock.calls[0][0])).toContain('is outside this workspace');

        });

        test('given a stored path through a symlink inside the workspace that points outside it, refuses it', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            writeConfigurationFile(path.join(outsideDirectoryPath, 'treecipe.config.json'), './outside/objects/');
            const symlinkPath = path.join(workspaceRoot, 'linked');
            fs.symlinkSync(outsideDirectoryPath, symlinkPath, 'dir');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(symlinkPath, 'treecipe.config.json') });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution.configurationFilePath).toBe(workspaceConfigurationPath);
            expect(resolution.staleReason).toBe('outside-workspace');

        });

        // A USER-LEVEL VALUE APPLIES TO EVERY WINDOW, SO A PATH SAVED FOR ONE PROJECT WAS READ BY ALL OF THEM
        test('given only a User-level value, ignores it and resolves the workspace default', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            const otherProjectConfigurationPath = path.join(outsideDirectoryPath, 'treecipe.config.json');
            writeConfigurationFile(otherProjectConfigurationPath, './other-project/objects/');
            useTreecipeConfigurationPathSetting({ globalValue: otherProjectConfigurationPath });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({ configurationFilePath: workspaceConfigurationPath });
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        test('given a workspace-folder value and a workspace value, the workspace-folder value wins', () => {

            const folderConfigurationPath = path.join(workspaceRoot, 'folder', 'treecipe.config.json');
            writeConfigurationFile(folderConfigurationPath, './folder/objects/');
            useTreecipeConfigurationPathSetting({
                workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json'),
                workspaceFolderValue: folderConfigurationPath
            });

            expect(ConfigurationService.resolveTreecipeConfigurationFilePath().configurationFilePath).toBe(folderConfigurationPath);

        });

        test('given a relative stored path, resolves it against the workspace root', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: 'treecipe/treecipe.config.json' });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({ configurationFilePath: workspaceConfigurationPath });

        });

        test.each([
            ['an empty string', ''],
            ['whitespace', '   '],
            ['a number', 42],
            ['an object', { path: '/somewhere' }]
        ])('given a stored value that is %s, treats it as unset and saves the default', (_description, storedValue) => {

            useTreecipeConfigurationPathSetting({ workspaceValue: storedValue });

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({ configurationFilePath: workspaceConfigurationPath });
            expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('treecipeConfigurationPath', workspaceConfigurationPath);
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        test('given a stale setting, getTreecipeConfigurationFilePath answers the path the resolver chose', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') });

            expect(ConfigurationService.getTreecipeConfigurationFilePath()).toBe(workspaceConfigurationPath);

        });

        test('given no setting at all, resolves and saves the workspace default as before', () => {

            useTreecipeConfigurationPathSetting(undefined);

            const resolution = ConfigurationService.resolveTreecipeConfigurationFilePath();

            expect(resolution).toEqual({ configurationFilePath: workspaceConfigurationPath });
            expect(setExtensionConfigValueSpy).toHaveBeenCalledWith('treecipeConfigurationPath', workspaceConfigurationPath);

        });

        test('given a stale setting and no workspace config, reports the stale value and leaves the setting alone', () => {

            const staleConfigurationPath = path.join(workspaceRoot, 'moved-away', 'treecipe.config.json');
            useTreecipeConfigurationPathSetting({ workspaceValue: staleConfigurationPath });

            let thrownError: unknown;
            try {
                ConfigurationService.getTreecipeConfigurationDetail();
            } catch (error) {
                thrownError = error;
            }

            expect(thrownError).toBeInstanceOf(MissingTreecipeConfigurationError);
            const missingConfigurationError = thrownError as MissingTreecipeConfigurationError;
            // THE PREFIX ErrorHandlingService KEYS THE MISSING-CONFIG FLOW ON
            expect(missingConfigurationError.message.startsWith('Missing treecipe configuration setup at expected path of:')).toBe(true);
            expect(missingConfigurationError.message).toContain(workspaceConfigurationPath);
            expect(missingConfigurationError.staleSettingNotice).toContain(settingName);
            expect(missingConfigurationError.staleSettingNotice).toContain(staleConfigurationPath);
            expect(missingConfigurationError.staleSettingNotice).toContain('does not exist');
            expect(setExtensionConfigValueSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).not.toHaveBeenCalled();

        });

        test('given no setting and no workspace config, the error carries no stale-setting notice', () => {

            useTreecipeConfigurationPathSetting(undefined);

            expect(() => ConfigurationService.getTreecipeConfigurationDetail()).toThrow(MissingTreecipeConfigurationError);
            try {
                ConfigurationService.getTreecipeConfigurationDetail();
            } catch (error) {
                expect((error as MissingTreecipeConfigurationError).staleSettingNotice).toBeUndefined();
            }

        });

        // ONE COMMAND READS THE CONFIG SEVERAL TIMES BEFORE THE ASYNCHRONOUS REWRITE LANDS
        test('given the same stale value on repeated reads, warns once', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') });

            ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            ConfigurationService.getCustomRelationshipMappings();
            ConfigurationService.getCustomCompoundAddressFields();

            expect(showWarningMessageSpy).toHaveBeenCalledTimes(1);

        });

        // A FAILED REWRITE WARNS ON ITS OWN, SO REPEATING THE WRITE PER READ REPEATED THAT WARNING PER READ
        test('given the same stale value on repeated reads, rewrites the setting once', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') });

            ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            ConfigurationService.getCustomRelationshipMappings();
            ConfigurationService.getCustomCompoundAddressFields();

            expect(setExtensionConfigValueSpy).toHaveBeenCalledTimes(1);

        });

        test('given the rewrite is rejected on every read, reports the failure once', async () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            setExtensionConfigValueSpy.mockRestore();
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn(),
                update: jest.fn().mockRejectedValue(new Error('Unable to write to Workspace Settings because no workspace is opened.')),
                inspect: jest.fn(() => ({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') }))
            });

            ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration();
            ConfigurationService.getCustomRelationshipMappings();
            ConfigurationService.getCustomCompoundAddressFields();
            await new Promise(resolve => setImmediate(resolve));

            const saveFailureWarnings = showWarningMessageSpy.mock.calls.map(call => String(call[0])).filter(warning => warning.includes('could not be saved'));
            expect(saveFailureWarnings).toHaveLength(1);

        });

        // uri.fsPath LOWER-CASES THE DRIVE; A HAND-WRITTEN SETTING USUALLY DOES NOT
        test('given paths that differ only in drive letter case, compares them as the same drive', () => {

            // path.resolve WOULD READ A WINDOWS PATH AS RELATIVE ON THIS RUNNER; THIS TEST IS ABOUT WHAT REACHES THE CHECK
            jest.spyOn(path, 'resolve').mockImplementation((...pathSegments: string[]) => pathSegments[pathSegments.length - 1]);
            const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValue(true);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats);

            ConfigurationService.getStaleTreecipeConfigurationPathReason('C:\\proj\\custom\\treecipe.config.json', 'c:\\proj');

            const [comparedPath, comparedWorkspaceRoot] = containmentSpy.mock.calls[0];
            expect(comparedPath).toBe('c:\\proj\\custom\\treecipe.config.json');
            expect(comparedWorkspaceRoot).toBe('c:\\proj');

        });

        test.each([
            ['C:\\proj\\treecipe.config.json', 'c:\\proj\\treecipe.config.json'],
            ['d:\\proj', 'd:\\proj'],
            ['/home/user/proj', '/home/user/proj'],
            ['relative/C:/path', 'relative/C:/path']
        ])('normalizeDriveLetterCase(%s) is %s', (filePath, expectedPath) => {

            expect(ConfigurationService.normalizeDriveLetterCase(filePath)).toBe(expectedPath);

        });

        test('given the rewrite is rejected, still reads the workspace config without throwing', async () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            setExtensionConfigValueSpy.mockRestore();
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn(),
                update: jest.fn().mockRejectedValue(new Error('Unable to write to Workspace Settings because no workspace is opened.')),
                inspect: jest.fn(() => ({ workspaceValue: path.join(workspaceRoot, 'moved-away', 'treecipe.config.json') }))
            });

            expect(ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration()).toBe('./force-app/main/default/objects/');
            await new Promise(resolve => setImmediate(resolve));

            const warnings = showWarningMessageSpy.mock.calls.map(call => String(call[0]));
            expect(warnings.some(warning => warning.includes('could not be saved'))).toBe(true);

        });

        // A NOTIFICATION RENDERS [label](command:...) AS A LINK THAT RUNS THE COMMAND, AND THIS VALUE IS REPOSITORY TEXT
        test('given a stale value shaped like a command link, the warning cannot render it as one', () => {

            writeConfigurationFile(workspaceConfigurationPath, './force-app/main/default/objects/');
            useTreecipeConfigurationPathSetting({ workspaceValue: path.join(workspaceRoot, '[run](command:workbench.action.terminal.new)', 'treecipe.config.json') });

            ConfigurationService.resolveTreecipeConfigurationFilePath();

            const warning = String(showWarningMessageSpy.mock.calls[0][0]);
            expect(warning).not.toContain('[run]');
            expect(warning).not.toContain('(command:');

        });

    });

    describe('getCustomCompoundAddressFields', () => {

        beforeEach(() => {
            jest.clearAllMocks();
        });

        test('given config with customCompoundAddressFields present, returns the configured field api names', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery",
    "customCompoundAddressFields": ["Site_Address__c", "BillingAddress"]
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

            const actualCompoundAddressFields = ConfigurationService.getCustomCompoundAddressFields();

            expect(actualCompoundAddressFields).toEqual(["Site_Address__c", "BillingAddress"]);

        });

        test('given config without customCompoundAddressFields property, returns empty array', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery"
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

            expect(ConfigurationService.getCustomCompoundAddressFields()).toEqual([]);

        });

        /*
            A hand edit that makes this an object rather than a list must not stop recipe generation
            for every other field in the workspace.
        */
        test('given customCompoundAddressFields that is not an array, returns empty array rather than throwing', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery",
    "customCompoundAddressFields": { "Site_Address__c": true }
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

            expect(() => ConfigurationService.getCustomCompoundAddressFields()).not.toThrow();
            expect(ConfigurationService.getCustomCompoundAddressFields()).toEqual([]);

        });

        test('given customCompoundAddressFields containing non-string entries, drops them and keeps the field api names', () => {

            const expectedConfigDetailJson = `{
    "salesforceObjectsPath": "/mock/objects/path",
    "dataFakerService": "snowfakery",
    "customCompoundAddressFields": ["Site_Address__c", 42, null, "BillingAddress"]
}`;

            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'readFileSync').mockReturnValue(expectedConfigDetailJson);
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

            expect(ConfigurationService.getCustomCompoundAddressFields()).toEqual(["Site_Address__c", "BillingAddress"]);

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
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

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
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

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
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

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
            jest.spyOn(ConfigurationService, 'setExtensionConfigValue').mockResolvedValue(true);

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

    describe('getPicklistDependencyResultsFolderName', () => {

        test('returns expected picklist dependency results folder name', () => {
            const expectedFolderName = "PicklistDependencyResults";
            const actualFolderName = ConfigurationService.getPicklistDependencyResultsFolderName();
            expect(actualFolderName).toBe(expectedFolderName);
        });

    });

    describe('getPicklistDependencyResultsFolderPath', () => {

        // ARTIFACTS BELONG UNDER THE SAME treecipe/ ROOT AS EVERY OTHER GENERATED FOLDER
        test('returns the results folder nested under the treecipe configuration folder', () => {
            const expectedFolderPath = "treecipe/PicklistDependencyResults";
            const actualFolderPath = ConfigurationService.getPicklistDependencyResultsFolderPath();
            expect(actualFolderPath).toBe(expectedFolderPath);
        });

        test('composes the path from the folder name rather than hardcoding it', () => {
            const actualFolderPath = ConfigurationService.getPicklistDependencyResultsFolderPath();
            expect(actualFolderPath).toContain(ConfigurationService.getDefaultTreecipeConfigurationFolderName());
            expect(actualFolderPath).toContain(ConfigurationService.getPicklistDependencyResultsFolderName());
        });

    });

    describe('getPicklistDependencySpecsFolderPath', () => {

        // ARTIFACTS BELONG UNDER THE SAME treecipe/ ROOT AS EVERY OTHER GENERATED FOLDER
        test('returns the specs folder nested under the treecipe configuration folder', () => {
            const expectedFolderPath = "treecipe/PicklistDependencySpecs";
            const actualFolderPath = ConfigurationService.getPicklistDependencySpecsFolderPath();
            expect(actualFolderPath).toBe(expectedFolderPath);
        });

        test('composes the path from the folder name rather than hardcoding it', () => {
            const actualFolderPath = ConfigurationService.getPicklistDependencySpecsFolderPath();
            expect(actualFolderPath).toContain(ConfigurationService.getDefaultTreecipeConfigurationFolderName());
            expect(actualFolderPath).toContain(ConfigurationService.getPicklistDependencySpecsFolderName());
        });

        /*
            The manifest is json, and a json file inside a Salesforce package directory is not valid
            metadata -- it would be picked up by "sf project deploy" and fail the deploy of the very
            classes it describes. Keeping it beside the results folder is what prevents that, so the
            two living apart is asserted rather than left to convention.
        */
        test('sits beside the results folder rather than inside a package directory', () => {
            const specsFolderPath = ConfigurationService.getPicklistDependencySpecsFolderPath();
            const resultsFolderPath = ConfigurationService.getPicklistDependencyResultsFolderPath();

            expect(specsFolderPath).not.toBe(resultsFolderPath);
            expect(specsFolderPath.split('/')[0]).toBe(resultsFolderPath.split('/')[0]);
            expect(specsFolderPath).not.toContain('classes');
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


    describe('setExtensionConfigValue', () => {

        const buildWorkspaceConfigurationWithUpdate = (update: jest.Mock) => {
            (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: jest.fn(), update });
        };

        it('given the write lands, reports success', async () => {

            const updateMock = jest.fn().mockResolvedValue(undefined);
            buildWorkspaceConfigurationWithUpdate(updateMock);

            const wasWritten = await ConfigurationService.setExtensionConfigValue('recipeCockpitEnabled', true);

            expect(wasWritten).toBe(true);
            expect(updateMock).toHaveBeenCalledWith('recipeCockpitEnabled', true, vscode.ConfigurationTarget.Workspace);

        });

        /*
            THE DEFECT.

            VS Code refuses a workspace write in a window with no folder open, because there is no
            .vscode/settings.json to write into. The rejection used to be left unawaited, which made
            it an unhandled rejection: nothing written, nothing reported, and the caller carrying on
            as though it had been.
        */
        it('given the write is rejected, answers false rather than rejecting', async () => {

            buildWorkspaceConfigurationWithUpdate(
                jest.fn().mockRejectedValue(new Error('Unable to write to Workspace Settings because no workspace is opened.'))
            );
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            const wasWritten = await ConfigurationService.setExtensionConfigValue('recipeCockpitEnabled', true);

            expect(wasWritten).toBe(false);

        });

        it('given the write is rejected, names the setting and the reason', async () => {

            buildWorkspaceConfigurationWithUpdate(
                jest.fn().mockRejectedValue(new Error('Unable to write to Workspace Settings because no workspace is opened.'))
            );
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage')
                .mockImplementation(() => undefined);

            await ConfigurationService.setExtensionConfigValue('recipeCockpitEnabled', true);

            const reportedWarning = String(showWarningMessageSpy.mock.calls[0][0]);
            expect(reportedWarning).toContain('salesforce-data-treecipe.recipeCockpitEnabled');
            expect(reportedWarning).toContain('no workspace is opened');

        });

        // A REJECTION THAT IS NOT AN Error STILL HAS TO PRODUCE A READABLE REASON RATHER THAN "[object Object]"
        it('given the rejection is not an Error, still reports a readable reason', async () => {

            buildWorkspaceConfigurationWithUpdate(jest.fn().mockRejectedValue('settings.json is read-only'));
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage')
                .mockImplementation(() => undefined);

            const wasWritten = await ConfigurationService.setExtensionConfigValue('selectedFakerService', 'faker-js');

            expect(wasWritten).toBe(false);
            expect(String(showWarningMessageSpy.mock.calls[0][0])).toContain('settings.json is read-only');

        });

    });

});
