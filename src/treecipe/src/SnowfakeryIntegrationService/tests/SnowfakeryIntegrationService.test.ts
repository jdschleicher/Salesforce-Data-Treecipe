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
    mkdirSync: jest.fn()
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
            jest.spyOn(VSCodeWorkspaceService, 'promptForRecipeFileToProcess').mockResolvedValue(expectedQuickPickItem);

            const result = await SnowfakeryIntegrationService.selectSnowfakeryRecipeFileToProcess();

            expect(VSCodeWorkspaceService.promptForRecipeFileToProcess).toHaveBeenCalled();
            expect(result).toBe(expectedQuickPickItem);
        });

    });

    describe('runSnowfakeryFakeDataGenerationBySelectedRecipeFile', () => {

        const mockedRunSnowfakeryExecChildProcessCommand = jest.mocked(exec);

        test('should return generated fake data from SnowfakeryMockService', async () => {
            
            const expectedFakeData = { data: 'fake data' };
            // jest.spyOn(SnowfakeryMockService, 'generateFakeData').mockResolvedValue(expectedFakeData);

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

    });

    describe('transformSnowfakeryJsonData', () => {
        
        test('should transform Snowfakery JSON data to collections API format', () => {
            
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

            const result = SnowfakeryIntegrationService.transformSnowfakeryJsonData(snowfakeryJsonFileContent);
            expect(result).toEqual(expectedTransformedData);

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

});
