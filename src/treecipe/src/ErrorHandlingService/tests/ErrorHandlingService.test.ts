import * as vscode from 'vscode';
import { ErrorHandlingService } from '../ErrorHandlingService';
import { MockVSCodeWorkspaceService } from '../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService';
import * as fs from 'fs';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

jest.mock('vscode', () => ({
    
    window: {
        showErrorMessage: jest.fn().mockResolvedValue((message, ...buttons) => {
            return Promise.resolve(buttons);
        }),
    },
    env: {
        openExternal: jest.fn(),
    },
    Uri: {
        parse: jest.fn((url) => ({ url })),
    },
    commands: {
        executeCommand: jest.fn(),
    }
    
}), { virtual: true });

describe('ErrorHandlingService', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('handleCapturedError', () => {

        test('given expected "missing config error", should call handleMissingTreecipeConfigSetup and vscode.window.showErrorMessage', () => {
            const error = new Error(ErrorHandlingService.expectedMissingConfigError);
            const executedCommand = 'testCommand';
            const handleMissingTreecipeConfigSetupSpy = jest.spyOn(ErrorHandlingService, 'handleMissingTreecipeConfigSetup');

            ErrorHandlingService.handleCapturedError(error, executedCommand);

            expect(vscode.window.showErrorMessage).toHaveBeenCalled();
            expect(handleMissingTreecipeConfigSetupSpy).toHaveBeenCalled();

        });

        test('given error message outside expected error messages like "missing config error", should handle generic error', () => {
            const error = new Error('Generic error');
            const executedCommand = 'testCommand';
            const handleGenericErrorMethod = jest.spyOn(ErrorHandlingService, 'handleGenericError');

            ErrorHandlingService.handleCapturedError(error, executedCommand);

            expect(vscode.window.showErrorMessage).toHaveBeenCalled();
            expect(handleGenericErrorMethod).toHaveBeenCalled();
        });

    });

    describe('handleMissingTreecipeConfigSetup', () => {

        it('should execute report issue button behavior when selected', async () => {

            const error = new Error('Test error');
            const executedCommand = 'testCommand';
            const reportIssueButton = ErrorHandlingService.reportIssueButton;
            
            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            showErrorMessageMock.mockResolvedValueOnce(reportIssueButton);

            const expectedUrl = 'http://mocked.url';
            jest.spyOn(ErrorHandlingService, 'buildGitHubIssueTemplateUrl').mockReturnValueOnce(expectedUrl);

            const mockedUri = MockVSCodeWorkspaceService.getFakeVSCodeUri();
            jest.spyOn(vscode.Uri, 'parse').mockReturnValue(mockedUri as unknown as vscode.Uri);

            const openExternalMock = jest.spyOn(vscode.env, 'openExternal').mockImplementation(jest.fn());
         
            await ErrorHandlingService.handleMissingTreecipeConfigSetup(error, executedCommand);
    
            expect(showErrorMessageMock).toHaveBeenCalledWith(
                "Expected treecipe and config file missing",
                'Run Treecipe Initiation Setup',
                ErrorHandlingService.reportIssueButton
            );

            expect(openExternalMock).toHaveBeenCalled();

            showErrorMessageMock.mockRestore();
            openExternalMock.mockRestore();
            jest.restoreAllMocks();
        
        });

    });

    describe('error capture files when no workspace folder is open', () => {

        /*
            getWorkspaceRoot is declared to return a string but returns undefined with no workspace
            open. Interpolating that produced a literal "undefined/treecipe/..." directory, which was
            committed to this repository by accident before it was noticed.
        */

        const captureWriters: [string, (error: Error, command: string) => void][] = [
            ['createGenerateRecipeErrorCaptureFile', ErrorHandlingService.createGenerateRecipeErrorCaptureFile.bind(ErrorHandlingService)],
            ['createGetRecipeFakerErrorCaptureFile', ErrorHandlingService.createGetRecipeFakerErrorCaptureFile.bind(ErrorHandlingService)],
            ['createFakerExpressionEvaluationErrorCaptureFile', ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile.bind(ErrorHandlingService)]
        ];

        test.each(captureWriters)('%s creates no "undefined" directory and writes no file', (writerName, captureWriter) => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);
            const makeDirectorySpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(jest.fn());
            const writeFileSpy = jest.spyOn(fs, 'writeFile').mockImplementation(jest.fn() as never);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(jest.fn());

            captureWriter(new Error('boom'), 'treecipe.generateTreecipe');

            expect(makeDirectorySpy).not.toHaveBeenCalled();
            expect(writeFileSpy).not.toHaveBeenCalled();
            expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('No workspace folder found'));
        });

        test('resolveErrorCaptureFolderPath returns undefined rather than a path containing "undefined"', () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue(undefined);

            expect(ErrorHandlingService.resolveErrorCaptureFolderPath('RecipeGenerationErrors')).toBeUndefined();
        });

        test('resolveErrorCaptureFolderPath builds the path under the workspace root when one exists', () => {

            jest.spyOn(VSCodeWorkspaceService, 'getWorkspaceRoot').mockReturnValue('/tmp/some-workspace');

            const resolvedPath = ErrorHandlingService.resolveErrorCaptureFolderPath('RecipeGenerationErrors');

            expect(resolvedPath).toContain('/tmp/some-workspace/treecipe/');
            expect(resolvedPath).toContain('RecipeGenerationErrors');
            expect(resolvedPath).not.toContain('undefined');
        });

    });

    describe('buildGitHubIssueTemplateUrl', () => {
        test('should build GitHub issue URL', () => {
            const errorMessage = 'test error message';
            const stackTrace = 'test stack trace';

            const url = ErrorHandlingService.buildGitHubIssueTemplateUrl(errorMessage, stackTrace);

            expect(url).toContain('https://github.com/jdschleicher/salesforce-data-treecipe/issues/new');
            
            const encodedStackTrace = encodeURIComponent(stackTrace).replace(/%20/g, '+');
            expect(url).toContain(encodedStackTrace);

            const encodedErrorMessage = encodeURIComponent(errorMessage).replace(/%20/g, '+');
            expect(url).toContain(encodedErrorMessage);

        });

    });

});