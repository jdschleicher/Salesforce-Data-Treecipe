import * as vscode from 'vscode';
import { ErrorHandlingService } from '../ErrorHandlingService';

jest.mock('vscode', () => ({
    
    window: {
        showErrorMessage: jest.fn().mockResolvedValue((message, ...buttons) => {
            return Promise.resolve(buttons); // Simulate clicking first button
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
    },
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
            
            const mockedUri = {
                scheme: 'http',
                authority: 'mocked.url',
                path: '/',
                query: '',
                fragment: '',
                toString: jest.fn().mockReturnValue('http://mocked.url')
            };
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