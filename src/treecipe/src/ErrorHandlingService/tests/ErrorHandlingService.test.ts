import * as vscode from 'vscode';
import { ErrorHandlingService } from '../ErrorHandlingService';
let storedButtons = ['Run Treecipe Initiation Setup'];

jest.mock('vscode', () => ({
    
    window: {
        showErrorMessage: jest.fn().mockResolvedValue((message, ...buttons) => {
            storedButtons = buttons;
            return Promise.resolve(buttons[0]); // Simulate clicking first button
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
            // Arrange
            const error = new Error('Test error');
            const executedCommand = 'testCommand';
            const reportIssueButton = ErrorHandlingService.reportIssueButton;
            
            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            showErrorMessageMock.mockResolvedValueOnce(reportIssueButton);
    
            const openExternalMock = vscode.env.openExternal as jest.Mock;
            openExternalMock.mockImplementation();
    

            // Spy on dependent methods
            jest.spyOn(ErrorHandlingService, 'buildGitHubIssueTemplateUrl').mockReturnValueOnce('http://mocked.url');

            // Act
            ErrorHandlingService.handleMissingTreecipeConfigSetup(error, executedCommand);
    
            // Assert
            expect(showErrorMessageMock).toHaveBeenCalledWith(
                `
                    Expected treecipe and config file missing
                `,
                'Run Treecipe Initiation Setup',
                ErrorHandlingService.reportIssueButton
            );
    
            expect(vscode.env.openExternal).toHaveBeenCalledWith(vscode.Uri.parse('http://mocked.url'));
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled(); // Ensure other commands weren't executed
        });

    });

    // describe('buildGitHubIssueTemplateUrl', () => {
    //     test('should build GitHub issue URL', () => {
    //         const errorMessage = 'test error message';
    //         const stackTrace = 'test stack trace';

    //         const url = ErrorHandlingService.buildGitHubIssueTemplateUrl(errorMessage, stackTrace);

    //         expect(url).toContain('https://github.com/jdschleicher/salesforce-data-treecipe/issues/new');
    //         expect(url).toContain(encodeURIComponent(errorMessage));
    //         expect(url).toContain(encodeURIComponent(stackTrace));
    //     });
    // });

});