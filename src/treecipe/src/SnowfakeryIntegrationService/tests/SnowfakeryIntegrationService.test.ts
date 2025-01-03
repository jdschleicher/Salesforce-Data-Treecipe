import { ChildProcess, exec } from 'child_process';

import { SnowfakeryIntegrationService } from '../SnowfakeryIntegrationService';

jest.mock('vscode', () => ({

  window: {
    showInformationMessage: jest.fn()
  }

}), { virtual: true });

jest.mock('child_process', () => ({
    exec: jest.fn()
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

});
