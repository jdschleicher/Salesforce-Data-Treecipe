import { ChildProcess, exec, execFile, ExecFileException } from 'child_process';

import { SnowfakeryRecipeProcessor } from '../SnowfakeryRecipeProcessor';



jest.mock('child_process', () => ({
    exec: jest.fn(),
    execFile: jest.fn()
}));

import * as fs from 'fs';

import { VSCodeWorkspaceService } from '../../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../../ErrorHandlingService/ErrorHandlingService';

jest.mock('vscode', () => ({

    window: {
      showInformationMessage: jest.fn()
    },
    workspace: {
      workspaceFolders: jest.fn()
    }
  
}), { virtual: true });


describe('Shared SnowfakeryRecipeProcessor tests', () => {

    const snowfakeryRecipeProcessor = new SnowfakeryRecipeProcessor();
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

            const expectedBaseSnowfakeryInstallationErrorMessage = 'An error occurred in checking for snowfakery installation';
            await expect(snowfakeryRecipeProcessor.isRecipeProcessorSetup()).rejects.toThrow(
                `${ expectedBaseSnowfakeryInstallationErrorMessage }: ${ expectedCliErrorMessage }`
            );

        });

    });

    describe('generateFakeDataBySelectedRecipeFile', () => {

        const mockedExecFile = jest.mocked(execFile);
        const mockedExec = jest.mocked(exec);
        const expectedExecFileOptions = { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 };

        beforeEach(() => {
            mockedExecFile.mockReset();
            mockedExec.mockReset();
        });

        const mockExecFileCallback = (cliCommandError: Error | null, standardOut: unknown) => {
            mockedExecFile.mockImplementation(((command, args, options, handleCliCommandCallback) => {
                handleCliCommandCallback(cliCommandError, standardOut, '');
                return {} as ChildProcess;
            }) as typeof execFile);
        };

        const mockErrorCaptureDependencies = () => {
            jest.spyOn(fs, 'writeFile').mockReturnValue();
            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('rootMock/mock');
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockReturnValue();
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockImplementation();
        };

        test('should return generated fake data for an ordinary path, passing it as an argument with the 10 MB buffer', async () => {
            
            const expectedFakeData = { data: 'fake data' };
            mockExecFileCallback(null, expectedFakeData);
  
            const mockRecipeFilePath = 'path/to/recipe.yml';
            const result = await snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile(mockRecipeFilePath);
  
            expect(mockedExecFile).toHaveBeenCalledWith(
                'snowfakery',
                [mockRecipeFilePath, '--output-format', 'json'],
                expectedExecFileOptions,
                expect.any(Function)
            );
            expect(mockedExec).not.toHaveBeenCalled();
            expect(result).toBe(expectedFakeData);

        });

        test.each([
            ['backticks', 'recipes/a`touch pwned`.yaml'],
            ['command substitution', 'recipes/a$(touch pwned).yaml'],
            ['a command separator', 'recipes/a; touch pwned ;.yaml'],
            ['a conditional chain', 'recipes/a && touch pwned && b.yaml'],
            ['a space', '/Users/some one/My Project/recipes/recipe.yaml']
        ])('should pass a recipe path containing %s through as one literal argument', async (_description, recipeFilePath) => {

            mockExecFileCallback(null, '[]');

            await snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath);

            expect(mockedExecFile).toHaveBeenCalledTimes(1);
            const [command, args, options] = mockedExecFile.mock.calls[0] as unknown as [string, string[], { shell?: unknown }];
            expect(command).toBe('snowfakery');
            expect(args).toEqual([recipeFilePath, '--output-format', 'json']);
            expect(options.shell).toBeUndefined();
            expect(mockedExec).not.toHaveBeenCalled();

        });

        test('should capture and reject with the CLI message when snowfakery exits non zero', async () => {
            
            mockErrorCaptureDependencies();
            const captureSpy = jest.spyOn(ErrorHandlingService, 'createFakerExpressionEvaluationErrorCaptureFile');

            const expectedCliErrorMessage = 'Command failed: snowfakery path/to/recipe.yml --output-format json\nbad recipe';
            const cliErrorMock: ExecFileException = Object.assign(new Error(expectedCliErrorMessage), { code: 1 });
            mockExecFileCallback(cliErrorMock, '');

            const rejection = snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile('path/to/recipe.yml');

            await expect(rejection).rejects.toThrow(expectedCliErrorMessage);
            await expect(rejection).rejects.toMatchObject({ name: 'SnowfakeryEvaluationError', message: expectedCliErrorMessage });
            expect(captureSpy).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'SnowfakeryEvaluationError', message: expectedCliErrorMessage }),
                'SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile'
            );

        });

        test('should capture and reject with an install hint when snowfakery cannot be spawned', async () => {

            mockErrorCaptureDependencies();
            const captureSpy = jest.spyOn(ErrorHandlingService, 'createFakerExpressionEvaluationErrorCaptureFile');

            const spawnError: ExecFileException = Object.assign(new Error('spawn snowfakery ENOENT'), { code: 'ENOENT' });
            mockExecFileCallback(spawnError, '');

            const rejection = snowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile('path/to/recipe.yml');

            await expect(rejection).rejects.toThrow('The snowfakery CLI could not be started (ENOENT)');
            await expect(rejection).rejects.toThrow('spawn snowfakery ENOENT');
            expect(captureSpy).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'SnowfakeryEvaluationError' }),
                'SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile'
            );

        });

    });

    describe('transformFakerJsonDataToCollectionApiFormattedFilesBySObject', () => {
        
        test('given two different objects from snowfakery generation, calls createCollectionsApiFile twice', () => {
            
            const snowfakeryJsonFileContent = JSON.stringify([
                { id: 1, _table: 'Account', name: 'Test Account', nickname: 'coolCompanyNickname' },
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
                                    referenceId: 'Account_Reference_1__coolCompanyNickname'
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
