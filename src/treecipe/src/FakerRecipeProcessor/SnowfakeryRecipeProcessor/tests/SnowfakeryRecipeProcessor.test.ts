import { ChildProcess, exec } from 'child_process';

import { SnowfakeryRecipeProcessor } from '../SnowfakeryRecipeProcessor';

jest.mock('vscode', () => ({

  window: {
    showInformationMessage: jest.fn()
  }

}), { virtual: true });

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

describe('Shared SnowfakeryRecipeProcessor tests', () => {

    const snowfakeryRecipeProcessor = new SnowfakeryRecipeProcessor();
    const expectedBaseSnowfakeryInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';

    describe('isRecipeProcessorSetup', () => {

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

            const result = await snowfakeryRecipeProcessor.isRecipeProcessorSetup();

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

            await expect(snowfakeryRecipeProcessor.isRecipeProcessorSetup()).rejects.toThrow(
                `${ expectedBaseSnowfakeryInstallationErrorMessage }: ${ expectedCliErrorMessage }`
            );

        });

    });

    describe('generateFakeDataBySelectedRecipeFile', () => {

        const mockedRunSnowfakeryExecChildProcessCommand = jest.mocked(exec);

        test('should return generated fake data from SnowfakeryMockService', async () => {
            
            const expectedFakeData = { data: 'fake data' };

            /*
              the below cliErrorMock set to null is what is needed to simulate a successful execution
              with this cliErroMock arg as null, the logic will result in truthy 
            */ 

            const cliErrorMock = null;
            const mockedMaxBuffer = {maxBuffer:  10485760};
            const execChildProcessMockImplementation = (cliCommand, mockedMaxBuffer, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedFakeData);
                return {} as ChildProcess;
            };
  
            mockedRunSnowfakeryExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);
  
            const mockRecipeFilePath = 'path/to/recipe.yml';
            const result = await snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile(mockRecipeFilePath);
  
            expect(mockedRunSnowfakeryExecChildProcessCommand).toHaveBeenCalledWith(
                  `snowfakery ${ mockRecipeFilePath } --output-format json`,
                  mockedMaxBuffer,
                  expect.any(Function)
            );
            expect(result).toBe(expectedFakeData);

        });

        test('should throw expected error message when Snowfakery command cli is not found', async () => {
            
            const expectedCliErrorMessage = 'Command failed';
            const cliErrorMock = new Error(expectedCliErrorMessage);
            const expectedFailureStdOut = 'command not found: snowfakery';
            const mockedMaxBuffer = {maxBuffer:  10485760};

            const execChildProcessMockImplementation = (cliCommand, mockedMaxBuffer, handleCliCommandCallback) => {
                handleCliCommandCallback(cliErrorMock, expectedFailureStdOut);
                return {} as ChildProcess;
            };

            mockedRunSnowfakeryExecChildProcessCommand.mockImplementation(execChildProcessMockImplementation);
            const mockRecipeFilePath = 'path/to/recipe.yml';
            await expect(snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile(mockRecipeFilePath)).rejects.toThrow(
                `${ expectedBaseSnowfakeryInstallationErrorMessage }: ${ expectedCliErrorMessage }`
            );

        });

    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('given two different objects from snowfakery generation, calls createCollectionsApiFile twice', () => {
            
            const snowfakeryJsonFileContent = JSON.stringify([
                { id: 1, _table: 'Account', name: 'Test Account' },
                { id: 2, _table: 'Contact', firstName: 'John', lastName: 'Doe' }
            ]);

            const expectedTransformedDataMap = new Map<string, Object>(
                [
                    [
                        "Account", {
                            allOrNone: true,
                            records: [
                                {
                                    attributes: {
                                    type: 'Account',
                                    referenceId: 'Account_Reference_1'
                                },
                                name: 'Test Account'
                            }
                            ]
                
                        }
                    ],
                    [

                        "Contact", {
                            allOrNone: true,
                            records: [
                                {
                                    attributes: {
                                        type: 'Contact',
                                        referenceId: 'Contact_Reference_2'
                                    },
                                    firstName: 'John',
                                    lastName: 'Doe' 
                                }
                            ]
                        }
                ]
                ]
            );

            const actualTransformedData = snowfakeryRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(
                snowfakeryJsonFileContent
            );

            expect(actualTransformedData).toEqual(expectedTransformedDataMap);

        });

        afterEach(() => {        
            jest.restoreAllMocks();
        });

        
    });

    
});
