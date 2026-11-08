import * as vscode from 'vscode';
import { ErrorHandlingService } from '../ErrorHandlingService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { MissingTreecipeConfigurationError } from '../MissingTreecipeConfigurationError';
import { MockVSCodeWorkspaceService } from '../../VSCodeWorkspace/tests/mocks/MockVSCodeWorkspaceService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RecipeYamlScalar } from '../../RecipeYamlScalar/RecipeYamlScalar';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

jest.mock('vscode', () => ({
    
    window: {
        showErrorMessage: jest.fn().mockResolvedValue((message, ...buttons) => {
            return Promise.resolve(buttons);
        }),
        showWarningMessage: jest.fn().mockResolvedValue(undefined),
        showTextDocument: jest.fn().mockResolvedValue({}),
    },
    workspace: {
        workspaceFolders: undefined,
        openTextDocument: jest.fn((uri) => Promise.resolve({ uri })),
    },
    env: {
        openExternal: jest.fn(),
    },
    Uri: {
        parse: jest.fn((url) => ({ url })),
        file: jest.fn((fsPath) => ({ fsPath })),
    },
    commands: {
        executeCommand: jest.fn(),
    }
    
}), { virtual: true });

// THE WORKSPACE A USER HAS OPEN, AS VS CODE REPORTS IT; undefined IS NO FOLDER OPEN
const openWorkspaceFolder = (workspaceRoot: string | undefined) => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = workspaceRoot ? [{ uri: { fsPath: workspaceRoot } }] : undefined;
};

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

        it('runs the initiation setup when that button is chosen', async () => {

            const showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
            showErrorMessageMock.mockResolvedValueOnce('Run Treecipe Initiation Setup');

            ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'generateRecipeFromConfigurationDetail');
            await new Promise(resolve => setImmediate(resolve));

            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('treecipe.initiateConfiguration');
            expect(vscode.env.openExternal).not.toHaveBeenCalled();

        });

        describe('re-running the original command after setup (#101)', () => {

            const configurationFilePath = '/workspace/treecipe/treecipe.config.json';
            let showErrorMessageMock: jest.Mock;
            let executeCommandMock: jest.Mock;

            beforeEach(() => {
                showErrorMessageMock = vscode.window.showErrorMessage as jest.Mock;
                showErrorMessageMock.mockResolvedValueOnce('Run Treecipe Initiation Setup');
                executeCommandMock = vscode.commands.executeCommand as jest.Mock;
            });

            it('given setup wrote a config, re-runs the original command by its id only after setup settles', async () => {

                const executionOrder: string[] = [];
                executeCommandMock.mockImplementation(async (commandId: string) => {
                    executionOrder.push(`start ${commandId}`);
                    await new Promise(resolve => setImmediate(resolve));
                    executionOrder.push(`end ${commandId}`);
                    return commandId === 'treecipe.initiateConfiguration' ? configurationFilePath : undefined;
                });

                await ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'generatePicklistDependencyTests');

                expect(executeCommandMock.mock.calls).toEqual([
                    ['treecipe.initiateConfiguration'],
                    ['treecipe.generatePicklistDependencyTests']
                ]);
                expect(executionOrder).toEqual([
                    'start treecipe.initiateConfiguration',
                    'end treecipe.initiateConfiguration',
                    'start treecipe.generatePicklistDependencyTests',
                    'end treecipe.generatePicklistDependencyTests'
                ]);

            });

            it('given a pick was dismissed and setup wrote nothing, does not re-run and shows no error', async () => {

                executeCommandMock.mockResolvedValue(undefined);

                await ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'generateRecipeFromConfigurationDetail');

                expect(executeCommandMock.mock.calls).toEqual([['treecipe.initiateConfiguration']]);
                expect(showErrorMessageMock).toHaveBeenCalledTimes(1);

            });

            it('given setup rejects, does not re-run and nothing escapes', async () => {

                executeCommandMock.mockRejectedValue(new Error('setup blew up'));
                jest.spyOn(console, 'error').mockImplementation(() => undefined);

                await expect(ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'runFakerGenerationByRecipeFile')).resolves.toBeUndefined();

                expect(executeCommandMock.mock.calls).toEqual([['treecipe.initiateConfiguration']]);

            });

            it('given the original command was setup itself, runs setup once and does not loop', async () => {

                executeCommandMock.mockResolvedValue(configurationFilePath);

                await ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'initiateTreecipeConfigurationSetup');

                expect(executeCommandMock.mock.calls).toEqual([['treecipe.initiateConfiguration']]);

            });

            it.each(['notAMappedCommand', '__proto__', 'constructor', 'toString'])('given the unmapped command name %s, runs setup and re-runs nothing', async (unmappedCommandName) => {

                executeCommandMock.mockResolvedValue(configurationFilePath);

                await expect(ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), unmappedCommandName)).resolves.toBeUndefined();

                expect(executeCommandMock.mock.calls).toEqual([['treecipe.initiateConfiguration']]);

            });

            it('given the re-run itself rejects, nothing escapes', async () => {

                executeCommandMock.mockImplementation(async (commandId: string) => {
                    if (commandId === 'treecipe.initiateConfiguration') {
                        return configurationFilePath;
                    }
                    throw new Error('re-run blew up');
                });
                jest.spyOn(console, 'error').mockImplementation(() => undefined);

                await expect(ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'openRecipeCockpit')).resolves.toBeUndefined();

                expect(executeCommandMock.mock.calls).toEqual([['treecipe.initiateConfiguration'], ['treecipe.openRecipeCockpit']]);

            });

        });

        it('given the notification is dismissed, runs no command and opens nothing', async () => {

            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValueOnce(undefined);

            await ErrorHandlingService.handleMissingTreecipeConfigSetup(new Error('missing'), 'generatePicklistDependencyTests');

            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(vscode.env.openExternal).not.toHaveBeenCalled();

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

        const captureWriters: [string, (error: Error, command: string) => void, string][] = [
            ['createGenerateRecipeErrorCaptureFile', ErrorHandlingService.createGenerateRecipeErrorCaptureFile.bind(ErrorHandlingService), 'No workspace folder found, so the recipe generation error could not be captured to a file.'],
            ['createGetRecipeFakerErrorCaptureFile', ErrorHandlingService.createGetRecipeFakerErrorCaptureFile.bind(ErrorHandlingService), 'No workspace folder found, so the faker value error could not be captured to a file.'],
            ['createFakerExpressionEvaluationErrorCaptureFile', ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile.bind(ErrorHandlingService), 'No workspace folder found, so the faker-js expression error could not be captured to a file.']
        ];

        beforeEach(() => openWorkspaceFolder(undefined));

        test.each(captureWriters)('%s creates no "undefined" directory, writes no file and says why', (_writerName, captureWriter, expectedWarning) => {

            const makeDirectorySpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(jest.fn());
            const writeFileSpy = jest.spyOn(fs, 'writeFile').mockImplementation(jest.fn() as never);

            captureWriter(new Error('boom'), 'treecipe.generateTreecipe');

            expect(makeDirectorySpy).not.toHaveBeenCalled();
            expect(writeFileSpy).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expectedWarning);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder found');
            expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        });

        // ErrorHandlingService NAMES THE FOLDER ITSELF SO IT IMPORTS NO CONFIGURATION SERVICE (#574); THE TWO MUST NOT DRIFT
        // THE CAPTURE FILE NAME USES THE SAME STAMP AS EVERY OTHER FILE TREECIPE WRITES
        test('stamps capture files exactly as VSCodeWorkspaceService.getNowIsoDateTimestamp does', () => {

            jest.useFakeTimers({ now: new Date('2026-10-13T10:05:09.123Z') });
            try {
                expect(ErrorHandlingService.getCaptureFileTimestamp()).toBe('2026-10-13T10-05-09');
                expect(ErrorHandlingService.getCaptureFileTimestamp()).toBe(VSCodeWorkspaceService.getNowIsoDateTimestamp());
            } finally {
                jest.useRealTimers();
            }
        });

        test('captures into the same GeneratedRecipes folder ConfigurationService names', () => {

            expect(ErrorHandlingService.generatedRecipesFolderName).toBe(ConfigurationService.getGeneratedRecipesDefaultFolderName());
        });

        // VS CODE CAN REPORT AN EMPTY LIST RATHER THAN undefined; getWorkspaceRoot THREW A TypeError THERE, THIS SAYS NO FOLDER IS OPEN
        test('given an empty workspace folder list, resolveErrorCaptureFolderPath answers undefined and says no folder is open', () => {

            (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [];

            expect(ErrorHandlingService.resolveErrorCaptureFolderPath('RecipeGenerationErrors')).toBeUndefined();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder found');
        });

        test('resolveErrorCaptureFolderPath returns undefined rather than a path containing "undefined"', () => {

            expect(ErrorHandlingService.resolveErrorCaptureFolderPath('RecipeGenerationErrors')).toBeUndefined();
        });

        test('resolveErrorCaptureFolderPath builds the path under the workspace root when one exists', () => {

            openWorkspaceFolder('/tmp/some-workspace');

            const resolvedPath = ErrorHandlingService.resolveErrorCaptureFolderPath('RecipeGenerationErrors');

            expect(resolvedPath).toBe('/tmp/some-workspace/treecipe/GeneratedRecipes/RecipeGenerationErrors');
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        });

    });

    describe('error capture files in an open workspace', () => {

        const captureWriters: [string, (error: Error, command: string) => void, string, string, string][] = [
            ['createGenerateRecipeErrorCaptureFile', ErrorHandlingService.createGenerateRecipeErrorCaptureFile.bind(ErrorHandlingService), 'RecipeGenerationErrors', 'generateRecipeError_2026-10-13T10-00-00.json', 'XMLFileProcessor error captured in file: generateRecipeError_2026-10-13T10-00-00.json'],
            ['createGetRecipeFakerErrorCaptureFile', ErrorHandlingService.createGetRecipeFakerErrorCaptureFile.bind(ErrorHandlingService), 'RecipeGenerationErrors', 'getFakerJSValueError2026-10-13T10-00-00.json', 'XMLFileProcessor error captured in file: getFakerJSValueError2026-10-13T10-00-00.json'],
            ['createFakerExpressionEvaluationErrorCaptureFile', ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile.bind(ErrorHandlingService), 'FakerJSExpressionErrors', 'fakerJSExpressionError2026-10-13T10-00-00.json', 'faker-js expression error captured in: treecipe.generateTreecipe']
        ];

        afterEach(() => jest.useRealTimers());

        test.each(captureWriters)('%s creates its folder, writes the error as JSON, says so once and opens the file', async (_writerName, captureWriter, errorsFolderName, expectedFileName, expectedWarning) => {

            const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-error-capture-'));
            openWorkspaceFolder(workspaceRoot);
            jest.useFakeTimers({ now: new Date('2026-10-13T10:00:00.000Z'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });

            try {

                const capturedError = Object.assign(new Error('boom'), { detail: 'what went wrong' });
                captureWriter(capturedError, 'treecipe.generateTreecipe');
                await new Promise(resolve => setTimeout(resolve, 20));

                const errorsFolderPath = `${workspaceRoot}/treecipe/GeneratedRecipes/${errorsFolderName}`;
                const writtenFileNames = fs.readdirSync(errorsFolderPath);

                expect(writtenFileNames).toEqual([expectedFileName]);
                expect(JSON.parse(fs.readFileSync(`${errorsFolderPath}/${expectedFileName}`, 'utf-8'))).toEqual({ detail: 'what went wrong' });
                expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
                expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expectedWarning);
                expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
                expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
                expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: `${errorsFolderPath}/${expectedFileName}` });
                expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);

            } finally {
                fs.rmSync(workspaceRoot, { recursive: true, force: true });
            }

        });

        test('given the capture file cannot be opened, says so with the path escaped', async () => {

            const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-error-capture-[x](command:evil)-'));
            openWorkspaceFolder(workspaceRoot);
            (vscode.workspace.openTextDocument as jest.Mock).mockRejectedValueOnce(new Error('cannot open'));

            try {

                ErrorHandlingService.createGenerateRecipeErrorCaptureFile(new Error('boom'), 'treecipe.generateTreecipe');
                await new Promise(resolve => setTimeout(resolve, 20));

                expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
                const [shownMessage] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
                expect(shownMessage).toStartWith('Failed to open file: ');
                expect(shownMessage).toContain('cannot open');
                expect(shownMessage).not.toContain('[x](command:evil)');

            } finally {
                fs.rmSync(workspaceRoot, { recursive: true, force: true });
            }

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