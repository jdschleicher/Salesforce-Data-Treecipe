import * as vscode from 'vscode';
import { ErrorHandlingService } from '../ErrorHandlingService';
import { MissingTreecipeConfigurationError } from '../../ConfigurationService/ConfigurationService';
import { MockVSCodeWorkspaceService } from '../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService';
import * as fs from 'fs';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

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


        // #171: A STALE SETTING IS WHY A PRESENT CONFIG READS AS MISSING, SO THE DIALOG SAYS WHERE IT LOOKED
        it('given a missing config resolved past a stale setting, names the setting in the dialog', async () => {

            const staleSettingNotice = 'The "salesforce-data-treecipe.treecipeConfigurationPath" setting names "/old/location/treecipe/treecipe.config.json", which does not exist.';
            const error = new MissingTreecipeConfigurationError(
                `${ErrorHandlingService.expectedMissingConfigError} /workspace/treecipe/treecipe.config.json -- or unknown failure`,
                staleSettingNotice
            );

            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            showErrorMessageMock.mockClear();
            showErrorMessageMock.mockResolvedValueOnce(undefined);

            await ErrorHandlingService.handleMissingTreecipeConfigSetup(error, 'generateRecipeFromConfigurationDetail');

            expect(showErrorMessageMock).toHaveBeenCalledWith(
                `Expected treecipe and config file missing. ${staleSettingNotice}`,
                'Run Treecipe Initiation Setup',
                ErrorHandlingService.reportIssueButton
            );

        });

        it('given a missing config with no stale setting, keeps the dialog text unchanged', async () => {

            const error = new MissingTreecipeConfigurationError(
                `${ErrorHandlingService.expectedMissingConfigError} /workspace/treecipe/treecipe.config.json -- or unknown failure`
            );

            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            showErrorMessageMock.mockClear();
            showErrorMessageMock.mockResolvedValueOnce(undefined);

            await ErrorHandlingService.handleMissingTreecipeConfigSetup(error, 'generateRecipeFromConfigurationDetail');

            expect(showErrorMessageMock).toHaveBeenCalledWith(
                'Expected treecipe and config file missing',
                'Run Treecipe Initiation Setup',
                ErrorHandlingService.reportIssueButton
            );

        });

        it('given the typed missing-config error, still routes to the missing-config flow', () => {

            const handleMissingTreecipeConfigSetupSpy = jest.spyOn(ErrorHandlingService, 'handleMissingTreecipeConfigSetup')
                .mockImplementation(() => undefined);

            ErrorHandlingService.handleCapturedError(
                new MissingTreecipeConfigurationError(`${ErrorHandlingService.expectedMissingConfigError} /workspace -- or unknown failure`, 'notice'),
                'generateRecipeFromConfigurationDetail'
            );

            expect(handleMissingTreecipeConfigSetupSpy).toHaveBeenCalled();

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

    // #186: EVERY handleCapturedError CALLER REACHES THESE NOTIFICATIONS, AND A MESSAGE CAN QUOTE WORKSPACE TEXT
    describe('notification escaping', () => {

        const commandLinkPayload = '[x](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22rm%22%7D)';
        const executedCommand = 'runFakerGenerationByRecipeFile';

        const getShownNotificationText = (): string => {
            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
            return showErrorMessageMock.mock.calls[0][0];
        };

        const flushSelectionHandler = () => new Promise(resolve => setImmediate(resolve));

        test('given a message carrying a command link, shows it as text with no link', () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);

            ErrorHandlingService.handleCapturedError(new Error(`bad line: ${commandLinkPayload}`), executedCommand);

            const shownText = getShownNotificationText();
            expect(shownText).toContain(RecipeYamlScalar.escapeForNotification(commandLinkPayload));
            expect(shownText).not.toMatch(/[[\]()]/);
            expect(shownText).not.toContain('](command:');

        });

        test('keeps the buttons unchanged', () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);

            ErrorHandlingService.handleCapturedError(new Error(commandLinkPayload), executedCommand);

            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            expect(showErrorMessageMock.mock.calls[0].slice(1)).toEqual([
                ErrorHandlingService.reportIssueButton,
                'Review Troubleshooting From README'
            ]);

        });

        test('given Report Issue is chosen, the issue url carries the RAW message and stack', async () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(ErrorHandlingService.reportIssueButton);
            const buildUrlSpy = jest.spyOn(ErrorHandlingService, 'buildGitHubIssueTemplateUrl');
            const error = new Error(`bad line: ${commandLinkPayload}`);

            ErrorHandlingService.handleCapturedError(error, executedCommand);
            await flushSelectionHandler();

            expect(buildUrlSpy).toHaveBeenCalledWith(`${executedCommand}: bad line: ${commandLinkPayload}`, error.stack);
            const openedUrl = (vscode.Uri.parse as jest.Mock).mock.calls[0][0] as string;
            expect(new URL(openedUrl).searchParams.get('body')).toContain(commandLinkPayload);
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);

        });

        test('given Review Troubleshooting is chosen, opens the same README url as before', async () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce('Review Troubleshooting From README');

            ErrorHandlingService.handleCapturedError(new Error(commandLinkPayload), executedCommand);
            await flushSelectionHandler();

            expect(vscode.Uri.parse).toHaveBeenCalledWith('https://github.com/jdschleicher/Salesforce-Data-Treecipe?tab=readme-ov-file#troubleshooting');

        });

        test.each([
            ['U+2028', '\u2028', '\\u2028'],
            ['U+2029', '\u2029', '\\u2029'],
            ['U+0085', '\u0085', '\\u0085'],
            ['line feed', '\n', '\\n'],
            ['carriage return', '\r', '\\r']
        ])('given a message carrying a %s line break, shows it escaped', (breakName, lineBreak, escapedBreak) => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);

            ErrorHandlingService.handleCapturedError(new Error(`first${lineBreak}second`), executedCommand);

            const shownText = getShownNotificationText();
            expect(shownText).toContain(`first${escapedBreak}second`);
            expect(shownText).not.toContain(`first${lineBreak}`);

        });

        test('given an Error with an empty message, shows the command name and no stray text', () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);

            ErrorHandlingService.handleCapturedError(new Error(''), executedCommand);

            expect(getShownNotificationText()).toContain(`*** ${executedCommand}:  ***`);

        });

        test.each([
            ['a thrown string', commandLinkPayload],
            ['undefined', undefined],
            ['null', null],
            ['a plain object', { message: commandLinkPayload }]
        ])('given %s, routes to the generic error without throwing and shows no workspace text', async (throwName, thrown) => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(ErrorHandlingService.reportIssueButton);
            const buildUrlSpy = jest.spyOn(ErrorHandlingService, 'buildGitHubIssueTemplateUrl');

            expect(() => ErrorHandlingService.handleCapturedError(thrown as unknown as Error, executedCommand)).not.toThrow();
            await flushSelectionHandler();

            const shownText = getShownNotificationText();
            expect(shownText).toContain(`Unknown error during command: ${executedCommand}`);
            expect(shownText).not.toContain('command:workbench');
            expect(buildUrlSpy).toHaveBeenCalledWith(`Unknown error during command: ${executedCommand}`, 'No stack trace available');

        });

        test('given a missing-config error whose stale notice carries a command link, shows it escaped', () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);
            const error = new MissingTreecipeConfigurationError(
                `${ErrorHandlingService.expectedMissingConfigError} /workspace -- or unknown failure`,
                `The setting names "${commandLinkPayload}\u2028", which does not exist.`
            );

            ErrorHandlingService.handleCapturedError(error, executedCommand);

            const shownText = getShownNotificationText();
            expect(shownText).not.toMatch(/[[\]()\u2028]/);
            expect(shownText).toContain(RecipeYamlScalar.escapeForNotification(commandLinkPayload));

        });

        test('given a stale notice ConfigurationService already escaped, shows it without doubled escapes', () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);
            const alreadyEscapedNotice = `The setting names "${RecipeYamlScalar.escapeForNotification(`/old/${commandLinkPayload}\n`)}", which does not exist.`;
            const error = new MissingTreecipeConfigurationError(
                `${ErrorHandlingService.expectedMissingConfigError} /workspace -- or unknown failure`,
                alreadyEscapedNotice
            );

            ErrorHandlingService.handleCapturedError(error, executedCommand);

            expect(getShownNotificationText()).toBe(`Expected treecipe and config file missing. ${alreadyEscapedNotice}`);

        });

        test.each([
            commandLinkPayload,
            'line\nbreak\r\u2028\u2029\u0085',
            'already \\u005b escaped \\n text',
            'tab\tand \u0000 control',
            ''
        ])('escapeForNotification is idempotent on its own output: %p', (value) => {

            const escapedOnce = RecipeYamlScalar.escapeForNotification(value);

            expect(RecipeYamlScalar.escapeForNotification(escapedOnce)).toBe(escapedOnce);

        });

        test('given a missing-config error chosen for Report Issue, the url carries the RAW message', async () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(ErrorHandlingService.reportIssueButton);
            const buildUrlSpy = jest.spyOn(ErrorHandlingService, 'buildGitHubIssueTemplateUrl');
            const rawMessage = `${ErrorHandlingService.expectedMissingConfigError} /work/${commandLinkPayload}`;
            const error = new MissingTreecipeConfigurationError(rawMessage, 'notice');

            ErrorHandlingService.handleCapturedError(error, executedCommand);
            await flushSelectionHandler();

            expect(buildUrlSpy).toHaveBeenCalledWith(`${executedCommand}:${rawMessage}`, error.stack);

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