import { ChildProcess, exec } from 'child_process';
import * as fs from 'fs';

import { SnowfakeryIntegrationService } from '../SnowfakeryIntegrationService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

jest.mock('vscode', () => ({

  window: {
    showInformationMessage: jest.fn()
  }

}), { virtual: true });

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFile: jest.fn()
}));

describe('Shared SnowfakeryIntegrationService tests', () => {

    describe('isSnowfakeryInstalled', () => {

        /* 
            below leverages exec import from child_process allowing us to mock the exec funtion
            during runtime of the unit test
        */
        const mockedExecChildProcessCommand = jest.mocked(exec);

        test('should return true when Snowfakery is installed', async () => {
       
            /*
              the below cliErrorMock set to null is what is needed to simulate a successful execution
              with this cliErroMock arg as null, the logic will result in truthy 
            */ 
            const cliErrorMock = null;
            const expectedSuccessfulMockedStdOut = 'snowfakery version 4.0.0';
            const execChildProcessMockImplementation = (cliCommand, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedSuccessfulMockedStdOut);
                return {} as ChildProcess;
            };

            mockedExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);

            const result = await SnowfakeryIntegrationService.isSnowfakeryInstalled();

            expect(mockedExecChildProcessCommand).toHaveBeenCalledWith(
                'snowfakery --version',
                expect.any(Function)
            );
            expect(result).toBe(true);

        });

        test('should throw expected error message when Snowfakery command cli is not found', async () => {
            
            const expectedCliErrorMessage = 'Command failed';
            const cliErrorMock = new Error(expectedCliErrorMessage);
            const expectedFailureStdOut = 'command not found: snowfakery';

            const execChildProcessMockImplementation = (cliCommand, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedFailureStdOut);
                return {} as ChildProcess;
            };

            mockedExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);
    
            await expect(SnowfakeryIntegrationService.isSnowfakeryInstalled()).rejects.toThrow(
                `${ SnowfakeryIntegrationService.baseSnowfakeryInstallationErrorMessage }: ${ expectedCliErrorMessage }`
            );

        });

    });

    describe('selectSnowfakeryRecipeFileToProcess', () => {
        
        test('should return selected recipe file path name', async () => {
            const expectedQuickPickItem = { label: 'recipe.yml', description: 'A sample recipe file' };
            jest.spyOn(VSCodeWorkspaceService, 'promptForDirectoryToGenerateFIleQuickItemsFrom').mockResolvedValue(expectedQuickPickItem);

            const result = await SnowfakeryIntegrationService.selectSnowfakeryRecipeFileToProcess();

            expect(VSCodeWorkspaceService.promptForDirectoryToGenerateFIleQuickItemsFrom).toHaveBeenCalled();
            expect(result).toBe(expectedQuickPickItem);
        });

    });

    describe('runSnowfakeryFakeDataGenerationBySelectedRecipeFile', () => {

        const mockedRunSnowfakeryExecChildProcessCommand = jest.mocked(exec);

        test('should return generated fake data from SnowfakeryMockService', async () => {
            
            const expectedFakeData = { data: 'fake data' };

            /*
              the below cliErrorMock set to null is what is needed to simulate a successful execution
              with this cliErroMock arg as null, the logic will result in truthy 
            */ 
            const cliErrorMock = null;
            const execChildProcessMockImplementation = (cliCommand, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedFakeData);
                return {} as ChildProcess;
            };
  
            mockedRunSnowfakeryExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);
  
            const mockRecipeFilePath = 'path/to/recipe.yml';
            const result = await SnowfakeryIntegrationService.runSnowfakeryFakeDataGenerationBySelectedRecipeFile(mockRecipeFilePath);
  
            expect(mockedRunSnowfakeryExecChildProcessCommand).toHaveBeenCalledWith(
                  `snowfakery ${ mockRecipeFilePath } --output-format json`,
                  expect.any(Function)
            );
            expect(result).toBe(expectedFakeData);

        });

        test('should throw expected error message when Snowfakery command cli is not found', async () => {
            
            const expectedCliErrorMessage = 'Command failed';
            const cliErrorMock = new Error(expectedCliErrorMessage);
            const expectedFailureStdOut = 'command not found: snowfakery';

            const execChildProcessMockImplementation = (cliCommand, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedFailureStdOut);
                return {} as ChildProcess;
            };

            mockedRunSnowfakeryExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);
            const mockRecipeFilePath = 'path/to/recipe.yml';
            await expect(SnowfakeryIntegrationService.runSnowfakeryFakeDataGenerationBySelectedRecipeFile(mockRecipeFilePath)).rejects.toThrow(
                `${ SnowfakeryIntegrationService.baseSnowfakeryInstallationErrorMessage }: ${ expectedCliErrorMessage }`
            );

        });

    });

    describe('transformSnowfakeryJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('given two different objects from snowfakery generation, calls createCollectionsApiFile twice', () => {
            
            const snowfakeryJsonFileContent = JSON.stringify([
                { id: 1, _table: 'Account', name: 'Test Account' },
                { id: 2, _table: 'Contact', firstName: 'John', lastName: 'Doe' }
            ]);

            const expectedTransformedData = [
                {
                    attributes: {
                        type: 'Account',
                        referenceId: 'Account_Reference_1'
                    },
                    name: 'Test Account'
                },
                {
                    attributes: {
                        type: 'Contact',
                        referenceId: 'Contact_Reference_2'
                    },
                    firstName: 'John',
                    lastName: 'Doe'
                }
            ];

            // watch createCollectionsApiFile
            jest.spyOn(SnowfakeryIntegrationService, "createCollectionsApiFile");

            const mockedCreateCollectionsApiCall = jest.mocked(SnowfakeryIntegrationService.createCollectionsApiFile);

            const fakeFunction = jest.fn();

            const fakePathToUniqueTimeStampedFakeDataSetsFolder = "mock/fake/path";
            
            mockedCreateCollectionsApiCall.mockImplementation(fakeFunction);

            const result = SnowfakeryIntegrationService.transformSnowfakeryJsonDataToCollectionApiFormattedFilesBySObject(
                snowfakeryJsonFileContent, 
                fakePathToUniqueTimeStampedFakeDataSetsFolder
            );

            expect(SnowfakeryIntegrationService.createCollectionsApiFile).toHaveBeenCalledTimes(2);

        });

        afterEach(() => {        
            jest.restoreAllMocks();
        });
        
    });

    describe('createUniqueTimeStampedFakeDataSetsFolderName', () => {
        
        test('should create a unique timestamped folder for fake data sets', () => {
            const mockWorkspaceRoot = '/mock/workspace';
            const mockFakeDataSetsFolderPath = 'treecipe/FakeDataSets';
            const mockExpectedFolderPath = `${mockWorkspaceRoot}/${mockFakeDataSetsFolderPath}`;
            const mockUniqueFolderName = 'dataset-2024-11-25T16-24-15';
            const mockFullPathToUniqueFolder = `${mockExpectedFolderPath}/${mockUniqueFolderName}`;

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(mockWorkspaceRoot);
            jest.spyOn(SnowfakeryIntegrationService, 'createFakeDataSetsTimeStampedFolderName').mockReturnValue(mockUniqueFolderName);

            (fs.existsSync as jest.Mock).mockReturnValue(true);

            const result = SnowfakeryIntegrationService.createUniqueTimeStampedFakeDataSetsFolderName();

            expect(fs.existsSync).toHaveBeenCalledWith(mockExpectedFolderPath);
            expect(fs.mkdirSync).toHaveBeenCalledWith(mockFullPathToUniqueFolder);
            expect(result).toBe(mockFullPathToUniqueFolder);
        
        });

    });

    describe('createCollectionsApiFile', () => {

        test('should create a collections API file with the correct content', () => {
            
            const mockCollectionsApiFormattedRecords = [
                {
                    attributes: {
                        type: 'Account',
                        referenceId: 'Account_Reference_1'
                    },
                    name: 'Test Account'
                },
                {
                    attributes: {
                        type: 'Account',
                        referenceId: 'Account_Reference_2'
                    },
                    name: 'Test Account 2'
                },
            ];

            const expectedObjectName = 'Account';
            const mockUniqueTimeStampedFakeDataSetsFolderName = '/mock/workspace/treecipe/FakeDataSets/dataset-2024-11-25T16-24-15';

            SnowfakeryIntegrationService.createCollectionsApiFile(
                expectedObjectName,
                mockCollectionsApiFormattedRecords,
                mockUniqueTimeStampedFakeDataSetsFolderName
            );

            const expectedFileName = `${mockUniqueTimeStampedFakeDataSetsFolderName}/collectionsApi-${expectedObjectName}.json`;
            const jsonMockCollectionsApiFormattedRecords = JSON.stringify(mockCollectionsApiFormattedRecords, null, 2);
            expect(fs.writeFile).toHaveBeenCalledWith(
                expectedFileName,
                jsonMockCollectionsApiFormattedRecords,
                expect.any(Function)
            );

        });

    });

    describe('buildCollectionsApiFileNameBySobjectName', () => {

        test('should build the correct collections API file name based on the selected recipe file name', () => {
            
            const expectedObjectName = 'Account';
            const expectedFileName = `collectionsApi-${expectedObjectName}.json`;

            const actualBuiltFileName = SnowfakeryIntegrationService.buildCollectionsApiFileNameBySobjectName(expectedObjectName);
            expect(actualBuiltFileName).toBe(expectedFileName);

        });
        
    });

    describe('createFakeDataSetsTimeStampedFolderName', () => {

        test('should create a unique timestamped folder name', () => {

            const mockDate = new Date('2024-11-25T16:24:15Z');
            jest.spyOn(global, 'Date').mockReturnValue(mockDate);

            jest.spyOn(global, 'Date').mockImplementation();
            jest.spyOn(mockDate, 'toISOString').mockReturnValue('2024-11-25T16:24:15.000Z');

            const expectedFolderName = 'dataset-2024-11-25T16-24-15';

            const actualFolderName = SnowfakeryIntegrationService.createFakeDataSetsTimeStampedFolderName();
            expect(actualFolderName).toBe(expectedFolderName);

        });

    });

});
