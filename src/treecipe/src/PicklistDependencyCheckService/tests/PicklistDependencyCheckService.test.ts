import { PicklistDependencyCheckService, PicklistDependencyTestRunCancelledError, SALESFORCE_CLI_UNC_WORKING_DIRECTORY_ERROR_CODE } from "../PicklistDependencyCheckService";

import { OrgAuthorization } from '@salesforce/core';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';

import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as childProcess from 'child_process';

jest.mock('vscode', () => ({
    window: {
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        createOutputChannel: jest.fn()
    },
    Uri: {
        file: (filePath: string) => ({ fsPath: filePath })
    }
}), { virtual: true });

/*
    execFile is invoked as execFile(command, args, options, callback) and the service reads exitCode
    and kill() off the returned child, so the stub has to supply both rather than only the callback.
*/
function stubSalesforceCli(options: { stdout?: string; stderr?: string; exitCode?: number | null; error?: NodeJS.ErrnoException }) {

    const killMock = jest.fn();

    const execFileSpy = jest.spyOn(childProcess, 'execFile').mockImplementation(((
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
        /*
            Non-zero exits reach the callback as an error whose "code" is a NUMBER, which is how the
            service tells an exit status apart from a spawn errno. Modelling that here keeps the stub
            honest rather than letting the service read an exitCode the real API would not supply.
        */
        const exitError = options.error
            ?? (options.exitCode ? Object.assign(new Error(`Command failed with exit code ${options.exitCode}`), { code: options.exitCode }) : null);

        callback(exitError, options.stdout ?? '', options.stderr ?? '');
        return { kill: killMock } as any;
    }) as any);

    return { execFileSpy, killMock };

}

function buildOrgAuthorization(overrides: Partial<OrgAuthorization>): OrgAuthorization {
    return {
        orgId: '00D000000000000EAA',
        username: 'dev@example.com',
        oauthMethod: 'web',
        aliases: [],
        configs: [],
        isExpired: false,
        ...overrides
    } as OrgAuthorization;
}

const passingTestMethods = [
    { MethodName: 'Account_picklistDependenciesMatchSourceMetadata', Outcome: 'Pass' },
    { MethodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }
];

const failingTestMethods = [
    {
        MethodName: 'Account_picklistDependenciesMatchSourceMetadata',
        Outcome: 'Fail',
        Message: 'Picklist dependency drift on Account -- 1 combination(s) no longer match local source metadata:\n  - MISSING_VALUES — Account.Type @ Customer: expected Direct, Channel but org allows only Direct'
    },
    { MethodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }
];

describe('shouldTranslateApexTestRunResults', () => {

    it('shouldReportPassedWhenEveryMethodPasses', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(passingTestMethods);

        expect(checkOutcome.passed).toBeTrue();
        expect(checkOutcome.failureCount).toBe(0);
        expect(checkOutcome.methodOutcomes).toHaveLength(2);

    });

    it('shouldReportFailedWithCountWhenAMethodFails', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(failingTestMethods);

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);
        expect(PicklistDependencyCheckService.buildResultSummaryMessage(checkOutcome)).toContain('1 of 2 test method(s) failed');

    });

    it('shouldCarryTheAssertionMessageThroughForFailedMethods', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(failingTestMethods);

        const failedMethodOutcome = checkOutcome.methodOutcomes.find(methodOutcome => !methodOutcome.passed);

        expect(failedMethodOutcome.message).toContain('Account.Type @ Customer');

    });

    it.each([
        ['no list', undefined],
        ['an object', { records: [] }],
        ['a string', 'Pass']
    ])('shouldThrowRatherThanReportWhenTheResultsAre %s', (_description, testResults) => {

        expect(() => PicklistDependencyCheckService.buildCheckOutcomeByTestResults(testResults))
            .toThrow('no readable Apex test results');

    });

    it('shouldReadAFieldThatIsNotTextAsAbsentRatherThanTrustingIt', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([
            { MethodName: 42, Outcome: { pass: true }, Message: ['drift'] },
            null
        ]);

        expect(checkOutcome.methodOutcomes).toEqual([
            { methodName: 'unknown', passed: false, message: undefined },
            { methodName: 'unknown', passed: false, message: undefined }
        ]);

    });

    it('shouldReportACompileFailureAsAFailedMethodWithItsMessage', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([
            { MethodName: 'specRegistryIsNotEmpty', Outcome: 'CompileFail', Message: 'Dependent class is invalid and needs recompilation' }
        ]);

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.methodOutcomes[0].message).toContain('needs recompilation');

    });

    it('shouldThrowWhenNoTestMethodsRan', () => {

        expect(() => PicklistDependencyCheckService.buildCheckOutcomeByTestResults([]))
            .toThrow('No SDTPLDSpecsTest test methods ran');

    });

});

/*
    Reading only the PascalCase keys would make an unexpected casing render every method as failed --
    a false report of picklist dependency drift, which is the one thing this command must never do.
*/
describe('shouldReadTestResultKeysCaseInsensitively', () => {

    it('shouldAcceptLowerCaseMethodNameKey', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([{ methodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }]);

        expect(checkOutcome.methodOutcomes[0].methodName).toBe('specRegistryIsNotEmpty');

    });

    it('shouldNotReportFalseDriftWhenOutcomeKeyArrivesLowerCase', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([
                { methodName: 'Account_picklistDependenciesMatchSourceMetadata', outcome: 'Pass' },
                { methodName: 'specRegistryIsNotEmpty', outcome: 'Pass' }
            ]);

        expect(checkOutcome.passed).toBeTrue();
        expect(checkOutcome.failureCount).toBe(0);

    });

    it('shouldTreatOutcomeValueCaseInsensitively', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([{ MethodName: 'specRegistryIsNotEmpty', Outcome: 'pass' }]);

        expect(checkOutcome.passed).toBeTrue();

    });

    it('shouldAcceptLowerCaseMessageKeyOnAFailedMethod', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([{ methodName: 'Account_picklistDependenciesMatchSourceMetadata', outcome: 'Fail', message: 'drift detail' }]);

        expect(checkOutcome.methodOutcomes[0].message).toBe('drift detail');

    });

});

describe('shouldNeverTreatEmptyRegistryAsSuccess', () => {

    it('shouldSurfaceEmptyRegistryAsAFailingMethodWithGuidance', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults([{
                MethodName: 'specRegistryIsNotEmpty',
                Outcome: 'Fail',
                Message: 'No picklist dependency specs are registered, so this run verified nothing.'
            }]);

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.methodOutcomes[0].message).toContain('verified nothing');

    });

});

describe('shouldBuildReadableOutputChannelReport', () => {

    it('shouldListEveryMethodWithItsOutcome', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(failingTestMethods);
        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);

        expect(report).toContain('Picklist Dependency Check — devHub');
        expect(report).toContain('failures:    1');
        expect(report).toContain('FAIL  Account_picklistDependenciesMatchSourceMetadata');
        expect(report).toContain('PASS  specRegistryIsNotEmpty');

    });

    it('shouldIndentEachLineOfAMultiLineAssertionMessage', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(failingTestMethods);
        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);
        const missingValuesLine = report.split('\n').find(reportLine => reportLine.includes('MISSING_VALUES'));

        expect(missingValuesLine).toStartWith('        ');

    });

    it('shouldNotEmitAMessageBlockForPassingMethods', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestResults(passingTestMethods);
        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);

        expect(report).not.toContain('MISSING_VALUES');
        expect(report).toContain('failures:    0');

    });

});

describe('shouldRunTheSalesforceCliAsynchronously', () => {

    it('shouldNotUseSpawnSyncAnywhereInTheService', () => {

        const serviceSource = fs.readFileSync(`${__dirname}/../PicklistDependencyCheckService.ts`, 'utf8');

        // spawnSync WOULD BLOCK THE SHARED VS CODE EXTENSION HOST FOR THE WHOLE CLI RUN
        expect(serviceSource).not.toContain('spawnSync');

    });

    describe('runSalesforceCli from the project (#200)', () => {

        const os = jest.requireActual('os');
        const path = jest.requireActual('path');

        let temporaryRoot: string;
        let workspacePath: string;
        let installedBinPath: string;
        let savedPathVariable: string | undefined;

        const captureExecFile = (callbackError: unknown = null) => {
            const capturedCalls: Array<{ command: string; options: Record<string, any> }> = [];
            const killMock = jest.fn();
            jest.spyOn(childProcess, 'execFile').mockImplementation(((
                command: string, _args: string[], options: Record<string, any>, callback: (...callbackArguments: unknown[]) => void
            ) => {
                capturedCalls.push({ command, options });
                if ( command !== 'taskkill' ) {
                    setImmediate(() => callback(callbackError, '{"status":0}', ''));
                }
                return { pid: 77, kill: killMock } as any;
            }) as any);
            return { capturedCalls, killMock };
        };

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-sf-path-'));
            workspacePath = path.join(temporaryRoot, 'workspace');
            installedBinPath = path.join(temporaryRoot, 'installed', 'bin');
            fs.mkdirSync(path.join(workspacePath, 'bin'), { recursive: true });
            fs.mkdirSync(installedBinPath, { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => {
                fs.writeFileSync(path.join(installedBinPath, executableName), '');
                // WHAT A CLONED REPOSITORY COULD COMMIT
                fs.writeFileSync(path.join(workspacePath, executableName), '');
                fs.writeFileSync(path.join(workspacePath, 'bin', executableName), '');
            });
            savedPathVariable = process.env.PATH;
        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('runs in the workspace, by the absolute path of the installed sf, never one in the workspace or on a relative PATH entry', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            process.env.PATH = ['', '.', 'bin', path.join(workspacePath, 'bin'), workspacePath, installedBinPath].join(':');
            const { capturedCalls } = captureExecFile();

            await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start', '--json'], undefined, undefined, { workingDirectoryPath: workspacePath });

            expect(capturedCalls[0].command).toBe(path.join(installedBinPath, 'sf'));
            expect(capturedCalls[0].options).toMatchObject({ cwd: workspacePath, shell: false, maxBuffer: 1024 * 1024 * 8 });
            expect(capturedCalls[0].options).not.toHaveProperty('env');

        });

        it('on Windows quotes the absolute sf.cmd and tells cmd.exe not to search the current directory', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            process.env.PATH = [workspacePath, installedBinPath].join(';');
            const { capturedCalls } = captureExecFile();

            await PicklistDependencyCheckService.runSalesforceCli(['org', 'create', 'scratch', '--json'], undefined, undefined, { workingDirectoryPath: workspacePath, maxBufferBytes: 1234 });

            expect(capturedCalls[0].command).toBe(`"${path.join(installedBinPath, 'sf.cmd')}"`);
            expect(capturedCalls[0].options).toMatchObject({ cwd: workspacePath, shell: true, maxBuffer: 1234 });
            expect(capturedCalls[0].options.env.NoDefaultCurrentDirectoryInExePath).toBe('1');

        });

        it('answers as an uninstalled CLI, starting nothing, when the only sf on PATH is the workspace\'s', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            process.env.PATH = [workspacePath, path.join(workspacePath, 'bin')].join(':');
            const { capturedCalls } = captureExecFile();

            const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(['org', 'list'], undefined, undefined, { workingDirectoryPath: workspacePath });

            expect(capturedCalls).toHaveLength(0);
            expect(invocationResult.spawnError?.code).toBe('ENOENT');

        });

        it('reports output past maxBuffer as too large rather than as a CLI that never started, and ends the process tree', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            process.env.PATH = installedBinPath;
            const { capturedCalls } = captureExecFile(Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));

            const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start'], undefined, undefined, { workingDirectoryPath: workspacePath });

            expect(invocationResult).toEqual({ stdout: '', stderr: '', exitCode: null, isOutputTooLarge: true });
            expect(capturedCalls.map(capturedCall => capturedCall.command)).toContain('taskkill');

        });

        it.each([
            '\\\\fileserver\\share\\project',
            '\\\\wsl.localhost\\Ubuntu\\home\\me\\project',
            '\\\\?\\UNC\\fileserver\\share\\project',
            '//fileserver/share/project'
        ])('on Windows refuses the UNC folder %s, starting nothing, since cmd.exe would run the CLI in the Windows folder instead (#285)', async (uncWorkingDirectoryPath) => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            process.env.PATH = installedBinPath;
            const { capturedCalls } = captureExecFile();

            const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start', '--json'], undefined, undefined, { workingDirectoryPath: uncWorkingDirectoryPath });

            expect(capturedCalls).toHaveLength(0);
            expect(invocationResult.exitCode).toBeNull();
            expect(invocationResult.spawnError?.code).toBe(SALESFORCE_CLI_UNC_WORKING_DIRECTORY_ERROR_CODE);
            expect(invocationResult.spawnError?.message).toContain(`"${uncWorkingDirectoryPath}"`);
            expect(invocationResult.spawnError?.message).toContain('Nothing was run');
            expect(() => PicklistDependencyCheckService.parseSalesforceCliJsonOutput(invocationResult)).toThrow(/UNC path/);

        });

        it('reads only a leading double slash of either kind as UNC, and nothing that is not a string', () => {

            expect(PicklistDependencyCheckService.isUncPath('\\\\server\\share')).toBe(true);
            expect(PicklistDependencyCheckService.isUncPath('//server/share')).toBe(true);
            expect(PicklistDependencyCheckService.isUncPath('C:\\Users\\me\\project')).toBe(false);
            expect(PicklistDependencyCheckService.isUncPath('C:/Users/me/project')).toBe(false);
            expect(PicklistDependencyCheckService.isUncPath('\\single\\slash')).toBe(false);
            expect(PicklistDependencyCheckService.isUncPath(undefined as unknown as string)).toBe(false);

        });

        it('runs from a drive-letter folder on Windows and from a double-slash folder elsewhere, which only Windows reads as UNC', async () => {

            const isWindowsSpy = jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            process.env.PATH = installedBinPath;
            const { capturedCalls } = captureExecFile();

            await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start'], undefined, undefined, { workingDirectoryPath: workspacePath });
            isWindowsSpy.mockReturnValue(false);
            await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start'], undefined, undefined, { workingDirectoryPath: `/${workspacePath}` });

            expect(capturedCalls.map(capturedCall => capturedCall.options.cwd)).toEqual([workspacePath, `/${workspacePath}`]);

        });

        it('changes nothing for a caller with no project options', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            const { capturedCalls } = captureExecFile();

            await PicklistDependencyCheckService.runSalesforceCli(['org', 'list', '--json']);

            expect(capturedCalls[0].command).toBe('sf');
            expect(capturedCalls[0].options).not.toHaveProperty('cwd');
            expect(capturedCalls[0].options).not.toHaveProperty('env');

        });

    });

    describe('runSalesforceCli from the project, with a real process (#285)', () => {

        const os = jest.requireActual('os');
        const path = jest.requireActual('path');

        let temporaryRoot: string;
        let savedPathVariable: string | undefined;
        let savedWorkingDirectoryPath: string;

        beforeEach(() => {
            temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-sf-cwd-')));
            savedPathVariable = process.env.PATH;
            savedWorkingDirectoryPath = process.cwd();
        });

        afterEach(() => {
            process.chdir(savedWorkingDirectoryPath);
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        // A SHELL SCRIPT STANDS IN FOR sf, SO THIS RUNS WHERE /bin/sh DOES
        (process.platform === 'win32' ? it.skip : it)('starts the CLI in the workspace even when the extension host itself is running from the machine root', async () => {

            const workspacePath = path.join(temporaryRoot, 'workspace');
            const installedBinPath = path.join(temporaryRoot, 'installed', 'bin');
            fs.mkdirSync(workspacePath, { recursive: true });
            fs.mkdirSync(installedBinPath, { recursive: true });
            fs.writeFileSync(path.join(installedBinPath, 'sf'), '#!/bin/sh\nprintf \'{"status":0,"cwd":"%s"}\' "$(pwd -P)"\n', { mode: 0o755 });
            process.env.PATH = `${installedBinPath}:${savedPathVariable ?? ''}`;
            process.chdir(path.parse(process.cwd()).root);

            const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(['project', 'deploy', 'start', '--json'], undefined, 10000, { workingDirectoryPath: workspacePath });

            expect(invocationResult.spawnError).toBeUndefined();
            expect(JSON.parse(invocationResult.stdout).cwd).toBe(workspacePath);

        });

    });

    describe('runSalesforceCli timeout', () => {

        // A CLI THAT NEVER ANSWERS: execFile HOLDS ITS CALLBACK, AS IT DOES WHILE A GRANDCHILD KEEPS THE PIPES OPEN
        const stubHungSalesforceCli = () => {

            const killMock = jest.fn();
            const execFileSpy = jest.spyOn(childProcess, 'execFile').mockImplementation(((
                command: string, _args: string[], _options: unknown, callback: (...callbackArguments: unknown[]) => void
            ) => {
                if ( command === 'taskkill' ) {
                    callback(null, '', '');
                }
                return { pid: 4242, kill: killMock } as any;
            }) as any);

            return { execFileSpy, killMock };

        };

        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('resolves as timed out when the timeout passes, whatever the pipes are still doing, and kills the child', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            const { killMock } = stubHungSalesforceCli();

            const invocation = PicklistDependencyCheckService.runSalesforceCli(['org', 'list', '--json'], undefined, 60000);
            jest.advanceTimersByTime(60000);

            expect(await invocation).toEqual({ stdout: '', stderr: '', exitCode: null, timedOut: true });
            expect(killMock).toHaveBeenCalledTimes(1);

        });

        it('on Windows, ends the whole process tree with taskkill rather than killing only cmd.exe', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            const { execFileSpy, killMock } = stubHungSalesforceCli();

            const invocation = PicklistDependencyCheckService.runSalesforceCli(['org', 'list', '--json'], undefined, 60000);
            jest.advanceTimersByTime(60000);

            expect((await invocation).timedOut).toBe(true);
            const taskkillCall = execFileSpy.mock.calls.find(([command]) => command === 'taskkill');
            expect(taskkillCall?.[1]).toEqual(['/pid', '4242', '/T', '/F']);
            expect(taskkillCall?.[2]).not.toHaveProperty('shell');
            expect(killMock).not.toHaveBeenCalled();

        });

        it('on Windows, a cancellation ends the whole process tree too', () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            const { execFileSpy } = stubHungSalesforceCli();

            let cancel: (() => void) | undefined;
            void PicklistDependencyCheckService.runSalesforceCli(['apex', 'run', 'test'], killChildProcess => { cancel = killChildProcess; });
            cancel();

            expect(execFileSpy.mock.calls.filter(([command]) => command === 'taskkill')).toHaveLength(1);

        });

        it('kills nothing when the CLI answers before the timeout, and never marks that answer timed out', async () => {

            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);
            const { killMock } = stubSalesforceCli({ stdout: '{"status":0}' });

            const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(['org', 'list', '--json'], undefined, 60000);
            jest.advanceTimersByTime(60000);

            expect(invocationResult).toEqual({ stdout: '{"status":0}', stderr: '', exitCode: 0, spawnError: undefined });
            expect(killMock).not.toHaveBeenCalled();

        });

        it('sets no timer at all when no timeout is asked for', async () => {

            const { killMock } = stubHungSalesforceCli();

            void PicklistDependencyCheckService.runSalesforceCli(['apex', 'run', 'test']);
            jest.advanceTimersByTime(24 * 60 * 60 * 1000);

            expect(killMock).not.toHaveBeenCalled();

        });

    });

    it('shouldBoundTheDeployWaitRatherThanUsingTheThirtyThreeMinuteDefault', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];

        expect(salesforceCliArguments).toContain('--wait');
        const waitMinutes = Number(salesforceCliArguments[salesforceCliArguments.indexOf('--wait') + 1]);
        expect(waitMinutes).toBeLessThanOrEqual(10);

    });

});

/*
    The run goes through the Tooling API on a @salesforce/core connection (#503). The fake answers
    runTestsAsynchronous with a job id, the AsyncApexJob poll with each status in turn (the last one
    repeated), ApexTestResult with its pages and ApexTestQueueItem with the items an abort sets.
*/
describe('shouldRunThePicklistDependencySuiteThroughTheToolingApi', () => {

    const testRunId = '7070000000000AAAAA';

    interface ITestRunConnectionOptions {
        startAnswer?: unknown;
        statuses?: ({ Status: string; ExtendedStatus?: string } | undefined)[];
        statusAnswer?: unknown;
        testResultPages?: unknown[][];
        queueItems?: unknown[];
        updateAnswer?: (record: { Id: string }) => unknown;
        onStatusQuery?: (callCount: number) => void;
    }

    function stubTestRunConnection(options: ITestRunConnectionOptions) {

        const statuses = options.statuses ?? [{ Status: 'Completed' }];
        const testResultPages = options.testResultPages ?? [passingTestMethods];
        let statusCallCount = 0;

        const runTestsAsynchronous = jest.fn().mockResolvedValue('startAnswer' in options ? options.startAnswer : testRunId);

        const query = jest.fn().mockImplementation(async () => {
            statusCallCount++;
            options.onStatusQuery?.(statusCallCount);
            if ( 'statusAnswer' in options ) {
                return options.statusAnswer;
            }
            const jobRecord = statuses[Math.min(statusCallCount, statuses.length) - 1];
            return { done: true, records: jobRecord ? [jobRecord] : [] };
        });

        const toolingQuery = jest.fn().mockImplementation(async (soql: string) => {
            if ( soql.includes('FROM ApexTestQueueItem') ) {
                return { done: true, records: options.queueItems ?? [] };
            }
            return {
                done: testResultPages.length <= 1,
                nextRecordsUrl: testResultPages.length > 1 ? '/services/data/v60.0/tooling/query/01g-2000' : undefined,
                records: testResultPages[0]
            };
        });

        const queryMore = jest.fn().mockImplementation(async (nextRecordsUrl: string) => {
            const pageIndex = Number(nextRecordsUrl.split('-').pop()) / 2000;
            return {
                done: pageIndex >= testResultPages.length - 1,
                nextRecordsUrl: pageIndex < testResultPages.length - 1 ? `/services/data/v60.0/tooling/query/01g-${(pageIndex + 1) * 2000}` : undefined,
                records: testResultPages[pageIndex]
            };
        });

        const update = jest.fn().mockImplementation(async (_type: string, record: { Id: string }) =>
            options.updateAnswer ? options.updateAnswer(record) : { id: record.Id, success: true, errors: [] });

        const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue({
            query,
            tooling: { runTestsAsynchronous, query: toolingQuery, queryMore, update }
        } as any);

        const execFileSpy = jest.spyOn(childProcess, 'execFile');

        return { getConnectionSpy, execFileSpy, runTestsAsynchronous, query, toolingQuery, queryMore, update };

    }

    beforeEach(() => {
        jest.replaceProperty(PicklistDependencyCheckService, 'apexTestRunPollIntervalMilliseconds', 0);
    });

    it('shouldRunBySuiteNameNeverByClassNameAndStartNoProcess', async () => {

        const { getConnectionSpy, execFileSpy, runTestsAsynchronous } = stubTestRunConnection({});

        await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(getConnectionSpy).toHaveBeenCalledWith('devHub');
        expect(runTestsAsynchronous).toHaveBeenCalledTimes(1);
        expect(runTestsAsynchronous).toHaveBeenCalledWith({ suiteNames: 'SDTPicklistDependencyTests' });
        expect(execFileSpy).not.toHaveBeenCalled();

    });

    it('shouldKeepTheWaitLimitAtTenMinutes', () => {
        expect(PicklistDependencyCheckService.apexTestRunWaitMilliseconds).toBe(10 * 60 * 1000);
    });

    it('shouldPollTheJobUntilItFinishesThenReadItsResults', async () => {

        const { query, toolingQuery } = stubTestRunConnection({
            statuses: [undefined, { Status: 'Queued' }, { Status: 'Processing' }, { Status: 'Completed' }]
        });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeTrue();
        expect(query).toHaveBeenCalledTimes(4);
        expect(query.mock.calls[0][0]).toBe(`SELECT Status, ExtendedStatus FROM AsyncApexJob WHERE Id = '${testRunId}'`);
        expect(toolingQuery).toHaveBeenCalledTimes(1);
        expect(toolingQuery.mock.calls[0][0]).toContain(`FROM ApexTestResult WHERE AsyncApexJobId = '${testRunId}'`);

    });

    it('shouldReportEveryFailedMethodWithItsMessage', async () => {

        stubTestRunConnection({ testResultPages: [failingTestMethods] });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);
        expect(checkOutcome.methodOutcomes[0].message).toContain('Account.Type @ Customer');

    });

    it('shouldReadEveryPageOfResults', async () => {

        const { queryMore } = stubTestRunConnection({ testResultPages: [[passingTestMethods[0]], [failingTestMethods[0]], [passingTestMethods[1]]] });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(queryMore).toHaveBeenCalledTimes(2);
        expect(checkOutcome.methodOutcomes).toHaveLength(3);
        expect(checkOutcome.failureCount).toBe(1);

    });

    it('shouldThrowWhenNoTestMethodsRan', async () => {

        stubTestRunConnection({ testResultPages: [[]] });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('No SDTPLDSpecsTest test methods ran');

    });

    it('shouldReportACompileFailureRowAsAFailedMethod', async () => {

        stubTestRunConnection({
            statuses: [{ Status: 'Failed' }],
            testResultPages: [[{ MethodName: 'specRegistryIsNotEmpty', Outcome: 'CompileFail', Message: 'Dependent class is invalid and needs recompilation' }]]
        });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.methodOutcomes[0].message).toContain('needs recompilation');

    });

    it('shouldSayWhyAFailedJobRanNothing', async () => {

        stubTestRunConnection({
            statuses: [{ Status: 'Failed', ExtendedStatus: 'Class SDTPLDSpecsTest failed to compile' }],
            testResultPages: [[]]
        });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow(`The picklist dependency test run ${testRunId} failed in "devHub" without running a test method: Class SDTPLDSpecsTest failed to compile`);

    });

    it('shouldNotReportAJobSomeoneElseAbortedAsAResult', async () => {

        const { toolingQuery } = stubTestRunConnection({ statuses: [{ Status: 'Aborted' }] });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('was aborted in "devHub" before it finished');

        expect(toolingQuery).not.toHaveBeenCalled();

    });

    it.each([
        ['nothing', undefined],
        ['an empty string', ''],
        ['an object', { id: testRunId }],
        ['a string that is not an id', "707' OR Id != '"]
    ])('shouldQueryNothingWhenTheStartAnswerIs %s', async (_description, startAnswer) => {

        const { query } = stubTestRunConnection({ startAnswer });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('returned no test run id');

        expect(query).not.toHaveBeenCalled();

    });

    it('shouldAcceptAJobIdAnsweredAsAJsonString', async () => {

        const { query } = stubTestRunConnection({ startAnswer: `"${testRunId}"` });

        await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(query.mock.calls[0][0]).toContain(`'${testRunId}'`);

    });

    it('shouldThrowRatherThanWaitWhenTheStatusAnswerHasNoRecordsList', async () => {

        stubTestRunConnection({ statusAnswer: { done: true } });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('no records list');

    });

    it('shouldLeaveARunThatOutlastsTheWaitRunningAndSaySo', async () => {

        jest.replaceProperty(PicklistDependencyCheckService, 'apexTestRunWaitMilliseconds', 25);
        jest.replaceProperty(PicklistDependencyCheckService, 'apexTestRunPollIntervalMilliseconds', 5);

        const { update, toolingQuery } = stubTestRunConnection({ statuses: [{ Status: 'Processing' }] });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow(`The picklist dependency test run ${testRunId} did not finish within`);

        expect(update).not.toHaveBeenCalled();
        expect(toolingQuery).not.toHaveBeenCalled();

    });

    describe('the wait bounds every request', () => {

        beforeEach(() => {
            jest.replaceProperty(PicklistDependencyCheckService, 'apexTestRunWaitMilliseconds', 20);
        });

        it('shouldGiveUpOnAConnectionThatNeverOpens', async () => {

            const { getConnectionSpy } = stubTestRunConnection({});
            getConnectionSpy.mockReturnValue(new Promise(() => undefined));

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
                .rejects.toThrow('No connection to "devHub" opened within');

        });

        it('shouldGiveUpOnAStartTheOrgNeverAnswersAndAbortItIfItLaterStarts', async () => {

            let answerStart: ((testRunIdAnswer: string) => void) | undefined;
            const { runTestsAsynchronous, update } = stubTestRunConnection({ queueItems: [{ Id: '7090000000000AAAAA' }] });
            runTestsAsynchronous.mockReturnValue(new Promise<string>(resolve => { answerStart = resolve; }));

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
                .rejects.toThrow('"devHub" did not answer the request to start the SDTPicklistDependencyTests test suite within');

            answerStart(testRunId);
            await new Promise(resolve => setImmediate(resolve));

            expect(update).toHaveBeenCalledTimes(1);

        });

        it('shouldGiveUpOnResultsThatNeverArrive', async () => {

            const { toolingQuery } = stubTestRunConnection({});
            toolingQuery.mockReturnValue(new Promise(() => undefined));

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
                .rejects.toThrow(`The picklist dependency test run ${testRunId} finished in "devHub", but its results could not be read within`);

        });

    });

    it('shouldNameTheRunAndSayItMayStillBeGoingWhenAStatusPollFails', async () => {

        const { query, update } = stubTestRunConnection({});
        query.mockRejectedValue(new Error('INVALID_SESSION_ID: Session expired or invalid'));

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow(`The status of the picklist dependency test run ${testRunId} could not be read from "devHub", so the check stopped waiting; the run may still be going there. INVALID_SESSION_ID: Session expired or invalid`);

        expect(update).not.toHaveBeenCalled();

    });

    it('shouldWordTheTimeoutWithTheTenMinuteWait', () => {

        expect(PicklistDependencyCheckService.buildTestRunTimedOutMessage('devHub', testRunId))
            .toContain(`${testRunId} did not finish within 10 minutes in "devHub", so no results were written. It is still running there`);

    });

    describe('cancel', () => {

        function startCancellableRun(options: ITestRunConnectionOptions & { cancelOnStatusQuery?: number }) {

            let cancelTestRun: (() => void) | undefined;

            const connection = stubTestRunConnection({
                statuses: [{ Status: 'Processing' }],
                ...options,
                onStatusQuery: callCount => {
                    if ( callCount === (options.cancelOnStatusQuery ?? 2) ) {
                        cancelTestRun();
                    }
                }
            });

            const runPromise = PicklistDependencyCheckService.runPicklistDependencyTests('devHub', registeredCancel => { cancelTestRun = registeredCancel; });

            return { ...connection, runPromise };

        }

        it('shouldAbortTheTestJobInTheOrgAndSaySo', async () => {

            const { runPromise, toolingQuery, update } = startCancellableRun({
                queueItems: [{ Id: '7090000000000AAAAA', Status: 'Processing' }, { Id: '7090000000000BBBBB', Status: 'Queued' }]
            });

            const cancelError = await runPromise.then(() => undefined, (error: Error) => error);

            expect(cancelError).toBeInstanceOf(PicklistDependencyTestRunCancelledError);
            expect(cancelError.message).toBe(`Picklist dependency check cancelled. The test run ${testRunId} was aborted in "devHub" (2 queued test class(es) stopped).`);

            const queueItemQuery = toolingQuery.mock.calls.map(([soql]) => soql as string).find(soql => soql.includes('ApexTestQueueItem'));
            expect(queueItemQuery).toBe(`SELECT Id, Status FROM ApexTestQueueItem WHERE ParentJobId = '${testRunId}' AND Status IN ('Holding', 'Queued', 'Preparing', 'Processing')`);

            expect(update.mock.calls).toEqual([
                ['ApexTestQueueItem', { Id: '7090000000000AAAAA', Status: 'Aborted' }],
                ['ApexTestQueueItem', { Id: '7090000000000BBBBB', Status: 'Aborted' }]
            ]);

        });

        it('shouldStopPollingOnceCancelled', async () => {

            const { runPromise, query } = startCancellableRun({ queueItems: [{ Id: '7090000000000AAAAA' }] });

            await runPromise.catch(() => undefined);

            expect(query).toHaveBeenCalledTimes(2);

        });

        it('shouldSayThereWasNothingToAbortWhenNoQueueItemIsStillRunning', async () => {

            const { runPromise, update } = startCancellableRun({ queueItems: [] });

            await expect(runPromise).rejects.toThrow(`The test run ${testRunId} had already finished in "devHub", so there was nothing to abort.`);
            expect(update).not.toHaveBeenCalled();

        });

        it('shouldNeverSendAQueueItemIdTheOrgAnsweredOutOfShape', async () => {

            const { runPromise, update } = startCancellableRun({ queueItems: [{ Id: "709' OR Id != '" }, { Status: 'Queued' }, null] });

            await expect(runPromise).rejects.toThrow('nothing to abort');
            expect(update).not.toHaveBeenCalled();

        });

        it.each([
            ['an item the org refused', () => ({ success: false, errors: [{ message: 'INSUFFICIENT_ACCESS' }] })],
            ['an update that throws', () => { throw new Error('INVALID_SESSION_ID'); }]
        ])('shouldSayTheRunMayStillBeRunningFor %s', async (_description, updateAnswer) => {

            const { runPromise } = startCancellableRun({ queueItems: [{ Id: '7090000000000AAAAA' }], updateAnswer });

            const cancelError = await runPromise.then(() => undefined, (error: Error) => error);

            expect(cancelError).toBeInstanceOf(PicklistDependencyTestRunCancelledError);
            expect(cancelError.message).toContain(`the test run ${testRunId} could not be aborted in "devHub" and may still be running there`);

        });

        it('shouldStopWaitingForAStartThatHangsAndAbortTheRunOnceTheOrgAnswers', async () => {

            let cancelTestRun: (() => void) | undefined;
            let answerStart: ((testRunIdAnswer: string) => void) | undefined;
            const { runTestsAsynchronous, update, query } = stubTestRunConnection({ queueItems: [{ Id: '7090000000000AAAAA' }] });
            runTestsAsynchronous.mockImplementation(() => new Promise<string>(resolve => {
                answerStart = resolve;
                cancelTestRun();
            }));

            const cancelError = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub', registeredCancel => { cancelTestRun = registeredCancel; })
                .then(() => undefined, (error: Error) => error);

            expect(cancelError).toBeInstanceOf(PicklistDependencyTestRunCancelledError);
            expect(cancelError.message).toBe('Picklist dependency check cancelled while the test run was starting in "devHub". If the org starts it, it is aborted as soon as the org answers.');
            expect(update).not.toHaveBeenCalled();

            answerStart(testRunId);
            await new Promise(resolve => setImmediate(resolve));

            expect(update).toHaveBeenCalledWith('ApexTestQueueItem', { Id: '7090000000000AAAAA', Status: 'Aborted' });
            expect(query).not.toHaveBeenCalled();

        });

        it('shouldAbortNothingWhenALateStartAnswerIsNotARunId', async () => {

            let cancelTestRun: (() => void) | undefined;
            let answerStart: ((startAnswer: unknown) => void) | undefined;
            const { runTestsAsynchronous, toolingQuery, update } = stubTestRunConnection({});
            runTestsAsynchronous.mockImplementation(() => new Promise<unknown>(resolve => {
                answerStart = resolve;
                cancelTestRun();
            }));

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub', registeredCancel => { cancelTestRun = registeredCancel; }))
                .rejects.toThrow('while the test run was starting');

            answerStart({ id: testRunId });
            await new Promise(resolve => setImmediate(resolve));

            expect(toolingQuery).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();

        });

        it('shouldStopWaitingForAConnectionThatHangs', async () => {

            let cancelTestRun: (() => void) | undefined;
            const { getConnectionSpy, runTestsAsynchronous } = stubTestRunConnection({});
            getConnectionSpy.mockImplementation(() => {
                cancelTestRun();
                return new Promise(() => undefined);
            });

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub', registeredCancel => { cancelTestRun = registeredCancel; }))
                .rejects.toThrow('cancelled before the test run started. Nothing was run in "devHub".');

            expect(runTestsAsynchronous).not.toHaveBeenCalled();

        });

        it('shouldSayTheRunMayStillBeRunningWhenTheAbortNeverAnswers', async () => {

            jest.replaceProperty(PicklistDependencyCheckService, 'apexTestRunAbortTimeoutMilliseconds', 10);

            const { runPromise } = startCancellableRun({
                queueItems: [{ Id: '7090000000000AAAAA' }],
                updateAnswer: () => new Promise(() => undefined)
            });

            await expect(runPromise).rejects.toThrow(`the test run ${testRunId} could not be aborted in "devHub" and may still be running there`);

        });

        it('shouldStartNothingWhenCancelledBeforeTheConnectionOpened', async () => {

            let cancelTestRun: (() => void) | undefined;
            const { getConnectionSpy, runTestsAsynchronous } = stubTestRunConnection({});
            getConnectionSpy.mockImplementation(async () => {
                cancelTestRun();
                return { tooling: { runTestsAsynchronous } } as any;
            });

            await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub', registeredCancel => { cancelTestRun = registeredCancel; }))
                .rejects.toThrow('cancelled before the test run started. Nothing was run in "devHub".');

            expect(runTestsAsynchronous).not.toHaveBeenCalled();

        });

    });

    /*
        results.json and report.md are built from the outcome alone, so an outcome read from
        ApexTestResult rows writes exactly what the CLI's payload wrote for the same methods.
    */
    describe('artifacts', () => {

        const os = jest.requireActual('os');
        const path = jest.requireActual('path');
        const realFs = jest.requireActual('fs');

        let temporaryRoot: string;

        beforeEach(() => {
            temporaryRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'pld-tooling-run-'));
        });

        afterEach(() => {
            realFs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it.each([
            ['all pass', passingTestMethods],
            ['some fail', failingTestMethods]
        ])('shouldWriteTheSameResultsJsonAndReportFor %s', async (_description, testMethods) => {

            stubTestRunConnection({ testResultPages: [testMethods] });

            const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');
            const runResultsFolderPath = PicklistDependencyCheckService.writeCheckResultArtifacts(temporaryRoot, 'devHub', '2026-10-29T10-00-00', checkOutcome);

            const expectedMethodOutcomes = testMethods.map((testMethod: { MethodName: string; Outcome: string; Message?: string }) => ({
                methodName: testMethod.MethodName,
                passed: testMethod.Outcome === 'Pass',
                ...( testMethod.Message ? { message: testMethod.Message } : {} )
            }));
            const failureCount = expectedMethodOutcomes.filter(methodOutcome => !methodOutcome.passed).length;

            expect(JSON.parse(realFs.readFileSync(path.join(runResultsFolderPath, 'results.json'), 'utf8'))).toEqual({
                targetOrg: 'devHub',
                ranAt: '2026-10-29T10-00-00',
                passed: failureCount === 0,
                failureCount,
                methodsRun: expectedMethodOutcomes.length,
                methodOutcomes: expectedMethodOutcomes
            });

            expect(realFs.readFileSync(path.join(runResultsFolderPath, 'report.md'), 'utf8')).toBe(
                PicklistDependencyCheckService.buildResultsMarkdown('devHub', '2026-10-29T10-00-00', {
                    passed: failureCount === 0,
                    failureCount,
                    methodOutcomes: expectedMethodOutcomes.map(methodOutcome => ({ message: undefined, ...methodOutcome }))
                })
            );

        });

    });

});

describe('shouldTranslateSalesforceCliSpawnFailures', () => {

    it('shouldThrowActionableMessageWhenCliIsNotInstalled', async () => {

        stubSalesforceCli({ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });

        await expect(PicklistDependencyCheckService.deploySourcePaths(['/workspace/classes/SDTPLDSpecsTest.cls'], 'devHub'))
            .rejects.toThrow('not installed or not on PATH');

    });

    it('shouldThrowActionableMessageOnEinvalRatherThanARawSpawnError', async () => {

        stubSalesforceCli({ error: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }) });

        await expect(PicklistDependencyCheckService.deploySourcePaths(['/workspace/classes/SDTPLDSpecsTest.cls'], 'devHub'))
            .rejects.toThrow('EINVAL');

    });

    it('shouldIncludeStderrAndExitCodeWhenOutputIsNotParseableJson', async () => {

        stubSalesforceCli({ stdout: '', stderr: 'ERROR running apex: No authorization found', exitCode: 1 });

        await expect(PicklistDependencyCheckService.deploySourcePaths(['/workspace/classes/SDTPLDSpecsTest.cls'], 'devHub'))
            .rejects.toThrow('No authorization found');

    });

});

describe('shouldValidateTheTargetOrgIdentifier', () => {

    it('shouldAcceptOrdinaryAliasesAndUsernames', () => {
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('devHub')).toBeTrue();
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('test-abc123@example.com')).toBeTrue();
    });

    it('shouldRejectAnIdentifierThatWouldBeReadAsACliFlag', () => {
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('--json')).toBeFalse();
    });

    it('shouldRejectShellMetacharacters', () => {
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('dev;rm -rf /')).toBeFalse();
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('dev$(whoami)')).toBeFalse();
        expect(PicklistDependencyCheckService.isValidTargetOrgIdentifier('dev"quote')).toBeFalse();
    });

    it('shouldThrowBeforeOpeningAConnectionForAnUnusableIdentifier', async () => {

        const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('--target-org'))
            .rejects.toThrow('not a usable Salesforce org alias');

        expect(getConnectionSpy).not.toHaveBeenCalled();

    });

    it('shouldThrowBeforeInvokingTheCliForAnUnusableIdentifier', async () => {

        const { execFileSpy } = stubSalesforceCli({ stdout: '{}' });

        await expect(PicklistDependencyCheckService.deploySourcePaths(['/workspace/classes/SDTPLDSpecsTest.cls'], '--target-org'))
            .rejects.toThrow('not a usable Salesforce org alias');

        expect(execFileSpy).not.toHaveBeenCalled();

    });

});

describe('shouldBuildAuthenticatedOrgQuickPickDetails', () => {

    it('shouldPreferAliasOverUsernameAsTargetOrgIdentifier', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'dev@example.com', aliases: ['devHub'] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].targetOrgIdentifier).toBe('devHub');

    });

    it('shouldFallBackToUsernameWhenNoAliasIsSet', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'scratch@example.com', aliases: [] })
        ]);

        expect(orgDetails[0].targetOrgIdentifier).toBe('scratch@example.com');
        expect(orgDetails[0].alias).toBeUndefined();

    });

    it('shouldSkipAuthorizationsWithoutAUsername', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: undefined as unknown as string, aliases: ['brokenEntry'] }),
            buildOrgAuthorization({ username: 'valid@example.com', aliases: [] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].username).toBe('valid@example.com');

    });

    it('shouldDropAnOrgWhoseIdentifierCouldNotSafelyReachTheCli', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'ok@example.com', aliases: ['--json'] }),
            buildOrgAuthorization({ username: 'valid@example.com', aliases: [] })
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].username).toBe('valid@example.com');

    });

    it('shouldLabelByTheAuthorizationsOwnAliasElseLeaveTheAliasUnset', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'qa@example.com', aliases: [] }),
            buildOrgAuthorization({ username: 'uat@example.com', aliases: ['uat'] })
        ]);

        expect(orgDetails).toEqual([
            { targetOrgIdentifier: 'qa@example.com', username: 'qa@example.com', alias: undefined },
            { targetOrgIdentifier: 'uat', username: 'uat@example.com', alias: 'uat' }
        ]);

    });

    it('shouldSkipAnAuthorizationAliasThatIsNotANonEmptyString', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            buildOrgAuthorization({ username: 'qa@example.com', aliases: [42, '', 'qa'] as unknown as string[] }),
            buildOrgAuthorization({ username: 'uat@example.com', aliases: 'uat' as unknown as string[] })
        ]);

        expect(orgDetails).toEqual([
            { targetOrgIdentifier: 'qa', username: 'qa@example.com', alias: 'qa' },
            { targetOrgIdentifier: 'uat@example.com', username: 'uat@example.com', alias: undefined }
        ]);

    });

    it('shouldReturnEmptyListWhenNoOrgsAreAuthenticated', () => {
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails([])).toBeEmpty();
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails(undefined as unknown as OrgAuthorization[])).toBeEmpty();
    });

});

describe('shouldDetectWhetherTestSuiteIsDeployedInOrg', () => {

    function stubToolingConnection(toolingQuery: jest.Mock) {

        const query = jest.fn();
        const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue({ query, tooling: { query: toolingQuery } } as any);
        const execFileSpy = jest.spyOn(childProcess, 'execFile');

        return { getConnectionSpy, execFileSpy, query };

    }

    it('shouldReturnTrueWhenTheSuiteMembershipQueryReturnsARecord', async () => {

        stubToolingConnection(jest.fn().mockResolvedValue({ totalSize: 1, done: true, records: [{ Id: '05F' }] }));

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub')).resolves.toBeTrue();

    });

    it('shouldReturnFalseWhenTheSuiteMembershipQueryReturnsNoRecords', async () => {

        stubToolingConnection(jest.fn().mockResolvedValue({ totalSize: 0, done: true, records: [] }));

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub')).resolves.toBeFalse();

    });

    it('shouldReturnFalseWhenTheQueryRejectsRatherThanAssumingDeployed', async () => {

        stubToolingConnection(jest.fn().mockRejectedValue(new Error('INVALID_SESSION_ID')));

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub')).resolves.toBeFalse();

    });

    it('shouldReturnFalseWhenNoConnectionOpensRatherThanAssumingDeployed', async () => {

        jest.spyOn(SalesforceOrgService, 'getConnection').mockRejectedValue(new Error('No authorization information found for devHub.'));

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub')).resolves.toBeFalse();

    });

    it.each([
        ['no records list', { totalSize: 1 }],
        ['records that are not a list', { totalSize: 1, records: { Id: '05F' } }],
        ['no answer at all', undefined],
        ['an answer that is not an object', 'deployed']
    ])('shouldReturnFalseForAnAnswerWith %s', async (_description, answer) => {

        stubToolingConnection(jest.fn().mockResolvedValue(answer));

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub')).resolves.toBeFalse();

    });

    /*
        Membership rather than mere existence: a suite whose member class was deleted still exists,
        and running it would pass having asserted nothing.
    */
    it('shouldQueryTestSuiteMembershipThroughTheToolingApiOnTheNamedOrg', async () => {

        const toolingQuery = jest.fn().mockResolvedValue({ totalSize: 1, done: true, records: [{ Id: '05F' }] });
        const { getConnectionSpy, query } = stubToolingConnection(toolingQuery);

        await PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub');

        expect(getConnectionSpy).toHaveBeenCalledWith('devHub');
        expect(query).not.toHaveBeenCalled();
        expect(toolingQuery).toHaveBeenCalledTimes(1);

        const soql = toolingQuery.mock.calls[0][0] as string;

        expect(soql).toContain('FROM TestSuiteMembership');
        expect(soql).toContain("ApexTestSuite.TestSuiteName = 'SDTPicklistDependencyTests'");
        expect(soql).toContain("ApexClass.Name = 'SDTPLDSpecsTest'");

    });

    it('shouldStartNoSalesforceCliProcess', async () => {

        const { execFileSpy } = stubToolingConnection(jest.fn().mockResolvedValue({ totalSize: 1, done: true, records: [{ Id: '05F' }] }));

        await PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('devHub');

        expect(execFileSpy).not.toHaveBeenCalled();

    });

    it('shouldRefuseAnUnusableOrgIdentifierBeforeAnyConnectionOpens', async () => {

        const { getConnectionSpy } = stubToolingConnection(jest.fn());

        await expect(PicklistDependencyCheckService.isSpecsTestSuiteDeployedInOrg('dev hub; rm')).rejects.toThrow('is not a usable Salesforce org alias or username');

        expect(getConnectionSpy).not.toHaveBeenCalled();

    });

});

describe('shouldDeployPicklistDependencyClasses', () => {

    it('shouldThrowGuidanceWhenClassesDirectoryDoesNotExist', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(false);

        await expect(PicklistDependencyCheckService.deployPicklistDependencyClasses('/no/such/classes', 'devHub'))
            .rejects.toThrow('Generate Picklist Dependency Tests');

    });

    it('shouldReturnDeployedComponentSummaryOnSuccess', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        const deploySummary = await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        expect(deploySummary).toContain('8 component(s)');

    });

    it('shouldDeployOnlyTheClassesThisCommandOwnsRatherThanTheWholeDirectory', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];
        const deployedPaths = salesforceCliArguments.filter(cliArgument => cliArgument.endsWith('.cls'));

        /*
            Every class this command owns is SDT-prefixed -- that IS the ownership rule, and it is
            what keeps a user's own Apex in the same directory out of a deploy they approved for the
            check. Matching on "PicklistDependency" would miss the generated SDTPLDSpecs family.
        */
        expect(deployedPaths).toSatisfyAll((deployedPath: string) => /\/I?SDT[A-Za-z0-9_]*\.cls$/.test(deployedPath));
        expect(salesforceCliArguments).not.toContain('/workspace/classes');

    });

    it('shouldThrowComponentFailureDetailWhenDeployFails', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        stubSalesforceCli({
            stdout: JSON.stringify({
                status: 1,
                result: { success: false, details: { componentFailures: [{ fullName: 'SDTPLDSpecsTest', problem: 'Method does not exist' }] } }
            })
        });

        await expect(PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .rejects.toThrow('SDTPLDSpecsTest: Method does not exist');

    });

    it('shouldThrowActionableGuidanceWhenSourceTrackingReportsConflicts', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
        stubSalesforceCli({ stdout: JSON.stringify({ status: 1, name: 'SourceConflictError', message: '16 conflicts detected' }) });

        await expect(PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .rejects.toThrow('Retrieve or resolve them first');

    });

    /*
        The writeback command's deploy entry point. Phrased around the field metadata rather than
        the Apex classes, because a user who just approved a metadata write should not be told
        "the picklist dependency classes" failed.
    */
    describe('deploySourcePaths', () => {

        const changedFieldFilePaths = ['/workspace/objects/Account/fields/Neighborhood__c.field-meta.xml'];

        it('shouldDeployExactlyThePathsItWasGiven', async () => {

            const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 1 } }) });

            const deploySummary = await PicklistDependencyCheckService.deploySourcePaths(changedFieldFilePaths, 'devHub');

            expect(deploySummary).toContain('1 component(s)');

            const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];

            expect(salesforceCliArguments).toContain('--source-dir');
            expect(salesforceCliArguments).toContain(changedFieldFilePaths[0]);
            expect(salesforceCliArguments).toContain('devHub');

        });

        it('shouldThrowComponentFailureDetailNamingTheFieldMetadataRatherThanTheClasses', async () => {

            stubSalesforceCli({
                stdout: JSON.stringify({
                    status: 1,
                    result: { success: false, details: { componentFailures: [{ fullName: 'Account.Neighborhood__c', problem: 'Invalid controlling value' }] } }
                })
            });

            await expect(PicklistDependencyCheckService.deploySourcePaths(changedFieldFilePaths, 'devHub'))
                .rejects.toThrow('The changed field metadata failed to deploy: Account.Neighborhood__c: Invalid controlling value');

        });

        it('shouldThrowActionableGuidanceWhenSourceTrackingReportsConflicts', async () => {

            stubSalesforceCli({ stdout: JSON.stringify({ status: 1, name: 'SourceConflictError', message: '2 conflicts detected' }) });

            await expect(PicklistDependencyCheckService.deploySourcePaths(changedFieldFilePaths, 'devHub'))
                .rejects.toThrow('Retrieve or resolve them first');

        });

        it('shouldThrowTheCliErrorWhenNoComponentFailureIsReported', async () => {

            stubSalesforceCli({ stdout: JSON.stringify({ status: 1, name: 'GenericTimeoutError', message: 'The deploy timed out' }) });

            await expect(PicklistDependencyCheckService.deploySourcePaths(changedFieldFilePaths, 'devHub'))
                .rejects.toThrow('GenericTimeoutError: The deploy timed out');

        });

        // AN ORG IDENTIFIER IS VALIDATED BEFORE ANY ARGV IS BUILT, SO IT CANNOT MASQUERADE AS A FLAG
        it('shouldRefuseAnOrgIdentifierThatCouldBeReadAsAFlag', async () => {

            const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true } }) });

            await expect(PicklistDependencyCheckService.deploySourcePaths(changedFieldFilePaths, '--targetusername'))
                .rejects.toThrow();

            expect(execFileSpy).not.toHaveBeenCalled();

        });

        it('shouldRefuseADeployWithNoSourcePaths', async () => {

            const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true } }) });

            await expect(PicklistDependencyCheckService.deploySourcePaths([], 'devHub'))
                .rejects.toThrow('no source files to deploy');

            expect(execFileSpy).not.toHaveBeenCalled();

        });

    });

});

describe('shouldResolveFrameworkClassesFromEitherLocation', () => {

    const classesDirectoryPath = '/workspace/classes';
    const frameworkDirectoryPath = `${classesDirectoryPath}/SDTPicklistDependencyFramework`;

    it('shouldPreferTheScaffoldedFrameworkDirectory', () => {

        jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        expect(classFilePaths.some(p => p === `${frameworkDirectoryPath}/SDTPicklistDependencyValidator.cls`)).toBeTrue();

    });

    it('shouldIncludeEveryPerObjectSpecsClassTheAggregatorCallsInto', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([
            'SDTPLDSpecs_Account.cls',
            'SDTPLDSpecs_Dependency_Example_c.cls',
            'SDTPLDSpecs.cls',
            'SDTPLDSpecsTest.cls',
            'SomeUnrelatedClass.cls'
        ] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        // WITHOUT THESE THE AGGREGATOR DEPLOYS AND FAILS TO COMPILE AGAINST CLASSES THAT ARE NOT THERE
        expect(classFilePaths).toContain(`${classesDirectoryPath}/SDTPLDSpecs_Account.cls`);
        expect(classFilePaths).toContain(`${classesDirectoryPath}/SDTPLDSpecs_Dependency_Example_c.cls`);

        // AND THE USER'S OWN APEX IS STILL LEFT OUT OF A DEPLOY THEY APPROVED FOR THE CHECK
        expect(classFilePaths).not.toContain(`${classesDirectoryPath}/SomeUnrelatedClass.cls`);

        // NO CLASS IS SENT TWICE -- SALESFORCE REJECTS A DUPLICATE ApexClass IN ONE DEPLOYMENT
        expect(new Set(classFilePaths).size).toBe(classFilePaths.length);

    });

    /*
        A workspace generated before the framework moved has the classes loose at the root. Sending
        the same ApexClass twice under two paths in one deployment is rejected by Salesforce, so
        exactly one path per class must be produced.
    */
    it('shouldFallBackToTheClassesRootForAnUpgradedWorkspace', () => {

        jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => !String(checkedPath).includes('SDTPicklistDependencyFramework'));
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        expect(classFilePaths.some(p => p === `${classesDirectoryPath}/SDTPicklistDependencyValidator.cls`)).toBeTrue();
        expect(classFilePaths.some(p => p.includes('PicklistDependencyFramework'))).toBeFalse();

    });

    it('shouldNeverEmitTheSameClassTwiceWhenBothLocationsHaveIt', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths(classesDirectoryPath);
        const classFileNames = classFilePaths.map(p => p.split('/').pop());

        expect(new Set(classFileNames).size).toBe(classFileNames.length);

    });

    it('shouldKeepTheGeneratedContractAtTheClassesRoot', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        expect(classFilePaths).toContain(`${classesDirectoryPath}/SDTPLDSpecs.cls`);
        expect(classFilePaths).toContain(`${classesDirectoryPath}/SDTPLDSpecsTest.cls`);

    });

});

describe('shouldNameEveryFileInTheDeployConfirmation', () => {

    it('shouldListTheOwnedClassFileNamesAndTheTargetOrg', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const confirmationMessage = PicklistDependencyCheckService.buildDeployConfirmationMessage('/workspace/classes', 'devHub', 'specsTestSuiteAbsentFromOrg');

        expect(confirmationMessage).toContain('devHub');
        expect(confirmationMessage).toContain('SDTPLDSpecsTest.cls');
        expect(confirmationMessage).toContain('SDTPicklistDependencyValidator.cls');
        // THE RUN INVOKES --suite-names, SO A DEPLOY THAT OMITTED THE SUITE WOULD FAIL AT THE NEXT STEP
        expect(confirmationMessage).toContain('SDTPicklistDependencyTests.testSuite-meta.xml');
        // THE USER MUST BE ABLE TO SEE THAT WORKSPACE COPIES ARE WHAT GETS SENT
        expect(confirmationMessage).toContain('as they exist in your workspace');

    });

    /*
        The end to end command deploys because it just rewrote the classes, having never asked the
        org anything. Telling that user the test class "was not found" is simply false, and invites
        them to conclude their previous deploy failed.
    */
    it('shouldSayTheSuiteWasNotFoundOnlyWhenTheOrgWasActuallyAsked', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const absentFromOrgMessage = PicklistDependencyCheckService.buildDeployConfirmationMessage('/workspace/classes', 'devHub', 'specsTestSuiteAbsentFromOrg');
        const regeneratedMessage = PicklistDependencyCheckService.buildDeployConfirmationMessage('/workspace/classes', 'devHub', 'specsClassesJustRegenerated');

        expect(absentFromOrgMessage).toContain('does not exist, or no longer contains');

        expect(regeneratedMessage).not.toContain('does not exist, or no longer contains');
        expect(regeneratedMessage).toContain('just regenerated');
        expect(regeneratedMessage).toContain('devHub');

    });

});

describe('shouldRefuseToProposeADeployWithNothingToSend', () => {

    /*
        The confirmation lists the files that will be sent, so this has to fail BEFORE the modal is
        built -- otherwise the user approves a dialog offering zero files and only then learns they
        needed to run Generate first.
    */
    it('shouldThrowAnActionableErrorWhenTheClassesDirectoryIsMissing', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(() => PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes'))
            .toThrow('No classes directory found at "/workspace/classes"');

        expect(() => PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes'))
            .toThrow('Generate Picklist Dependency Tests');

    });

    it('shouldThrowAnActionableErrorWhenNoOwnedClassesAreOnDisk', () => {

        // THE DIRECTORY IS THERE, BUT NOTHING THE COMMAND OWNS HAS BEEN GENERATED INTO IT
        jest.spyOn(fs, 'existsSync').mockImplementation((candidatePath: any) => candidatePath === '/workspace/classes');
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        expect(() => PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes'))
            .toThrow('No picklist dependency classes were found');

    });

    it('shouldReturnTheDeployableClassPathsWhenGenerationHasRun', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const deployableClassPaths = PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes');

        expect(deployableClassPaths.length).toBeGreaterThan(0);
        expect(deployableClassPaths.some(classPath => classPath.includes('SDTPLDSpecsTest.cls'))).toBe(true);
        expect(deployableClassPaths.some(classPath => classPath.endsWith('SDTPicklistDependencyTests.testSuite-meta.xml'))).toBe(true);

    });

    it('shouldKeepTheSuiteOutOfTheClassOnlyListWhileIncludingItInWhatIsDeployed', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const classFilePaths = PicklistDependencyCheckService.getPicklistDependencyClassFilePaths('/workspace/classes');
        const sourceFilePaths = PicklistDependencyCheckService.getPicklistDependencySourceFilePaths('/workspace/classes');

        expect(classFilePaths.some(filePath => filePath.endsWith('.testSuite-meta.xml'))).toBe(false);
        expect(sourceFilePaths.some(filePath => filePath.endsWith('.testSuite-meta.xml'))).toBe(true);

    });

    it('shouldOmitTheSuiteFromTheSourceListWhenItHasNotBeenGeneratedYet', () => {

        jest.spyOn(fs, 'existsSync').mockImplementation((candidatePath: any) => !String(candidatePath).endsWith('.testSuite-meta.xml'));
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        const sourceFilePaths = PicklistDependencyCheckService.getPicklistDependencySourceFilePaths('/workspace/classes');

        // THE PATH LIST REPORTS WHAT IS ON DISK; REQUIRING THE SUITE IS assertDeployableClassesExist'S JOB
        expect(sourceFilePaths.some(filePath => filePath.endsWith('.testSuite-meta.xml'))).toBe(false);

    });

    /*
        The upgrade path this release creates. A workspace generated before the suite existed has
        every class and no suite, so without this the org check reports "not deployed", the deploy is
        offered and accepted, the classes go up WITHOUT the suite, and the very next step invokes
        "--suite-names" against an org that has none -- failing with the raw CLI error and nothing to
        say that regenerating is the fix.
    */
    it('shouldRefuseToDeployWhenTheSuiteHasNotBeenGeneratedYet', () => {

        jest.spyOn(fs, 'existsSync').mockImplementation((candidatePath: any) => !String(candidatePath).endsWith('.testSuite-meta.xml'));
        jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);

        expect(() => PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes'))
            .toThrow('No Apex test suite was found');

        expect(() => PicklistDependencyCheckService.assertDeployableClassesExist('/workspace/classes'))
            .toThrow('Generate Picklist Dependency Tests');

    });

});

describe('shouldPersistCheckResultsToTheTreecipeDirectory', () => {

    const isoDateTimestamp = '2026-08-16T14-22-08';

    function buildCheckOutcome(passed: boolean) {
        return PicklistDependencyCheckService.buildCheckOutcomeByTestResults(passed ? passingTestMethods : failingTestMethods);
    }

    it('shouldNameTheRunFolderByOrgAndTimestamp', () => {

        const resultsFolderName = PicklistDependencyCheckService.buildResultsFolderName('devHub', isoDateTimestamp);

        expect(resultsFolderName).toBe('check-devHub-2026-08-16T14-22-08');

    });

    it('shouldReplaceCharactersThatReadPoorlyInADirectoryListing', () => {

        // A USERNAME IS A VALID TARGET ORG IDENTIFIER AND CONTAINS AN "@"
        const resultsFolderName = PicklistDependencyCheckService.buildResultsFolderName('test-abc@example.com', isoDateTimestamp);

        expect(resultsFolderName).not.toContain('@');
        expect(resultsFolderName).toStartWith('check-test-abc-example.com');

    });

    it('shouldWriteMachineReadableJsonCarryingEveryMethodOutcome', () => {

        const resultsJson = JSON.parse(
            PicklistDependencyCheckService.buildResultsJson('devHub', isoDateTimestamp, buildCheckOutcome(false))
        );

        expect(resultsJson.targetOrg).toBe('devHub');
        expect(resultsJson.ranAt).toBe(isoDateTimestamp);
        expect(resultsJson.passed).toBeFalse();
        expect(resultsJson.failureCount).toBe(1);
        expect(resultsJson.methodsRun).toBe(2);
        expect(resultsJson.methodOutcomes).toHaveLength(2);
        expect(resultsJson.methodOutcomes[0].message).toContain('Account.Type @ Customer');

    });

    it('shouldWriteHumanReadableMarkdownNamingTheOrgAndTheFailures', () => {

        const resultsMarkdown = PicklistDependencyCheckService.buildResultsMarkdown('devHub', isoDateTimestamp, buildCheckOutcome(false));

        expect(resultsMarkdown).toContain('# Picklist Dependency Check');
        expect(resultsMarkdown).toContain('**Target org:** devHub');
        expect(resultsMarkdown).toContain('**Result:** FAIL');
        expect(resultsMarkdown).toContain('| FAIL | `Account_picklistDependenciesMatchSourceMetadata` |');
        expect(resultsMarkdown).toContain('## Failure detail');
        expect(resultsMarkdown).toContain('MISSING_VALUES');

    });

    it('shouldOmitTheFailureDetailSectionWhenEverythingPassed', () => {

        const resultsMarkdown = PicklistDependencyCheckService.buildResultsMarkdown('devHub', isoDateTimestamp, buildCheckOutcome(true));

        expect(resultsMarkdown).toContain('**Result:** PASS');
        expect(resultsMarkdown).not.toContain('## Failure detail');

    });

    it('shouldWriteBothArtifactsIntoATimestampedRunFolder', () => {

        const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
        const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

        const runResultsFolderPath = PicklistDependencyCheckService.writeCheckResultArtifacts(
            '/workspace/treecipe/PicklistDependencyResults',
            'devHub',
            isoDateTimestamp,
            buildCheckOutcome(false)
        );

        expect(runResultsFolderPath).toContain('check-devHub-2026-08-16T14-22-08');
        expect(mkdirSyncSpy).toHaveBeenCalledWith(runResultsFolderPath, { recursive: true });

        const writtenFilePaths = writeFileSyncSpy.mock.calls.map(writeCall => String(writeCall[0]));
        expect(writtenFilePaths.some(writtenPath => writtenPath.endsWith('results.json'))).toBeTrue();
        expect(writtenFilePaths.some(writtenPath => writtenPath.endsWith('report.md'))).toBeTrue();

    });

    it('shouldPersistAPassingRunTooSoAGreenCheckIsAlsoOnRecord', () => {

        jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
        const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

        PicklistDependencyCheckService.writeCheckResultArtifacts(
            '/workspace/treecipe/PicklistDependencyResults',
            'devHub',
            isoDateTimestamp,
            buildCheckOutcome(true)
        );

        expect(writeFileSyncSpy).toHaveBeenCalledTimes(2);

    });

});

describe('shouldHandleTheWindowsCliShim', () => {

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('shouldUseAShellOnWindowsBecauseSpawningACmdShimWithoutOneFailsWithEinval', () => {

        jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);

        const invocation = PicklistDependencyCheckService.buildSalesforceCliInvocation(['apex', 'run', 'test']);

        expect(invocation.command).toBe('sf.cmd');
        expect(invocation.useShell).toBeTrue();
        // EVERY ARGUMENT IS QUOTED ONCE THE SHELL IS IN PLAY
        expect(invocation.args).toSatisfyAll((argumentValue: string) => argumentValue.startsWith('"') && argumentValue.endsWith('"'));

    });

    it('shouldKeepTheArgvFormOnNonWindowsPlatforms', () => {

        jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(false);

        const invocation = PicklistDependencyCheckService.buildSalesforceCliInvocation(['apex', 'run', 'test']);

        expect(invocation.command).toBe('sf');
        expect(invocation.useShell).toBeFalse();
        expect(invocation.args).toEqual(['apex', 'run', 'test']);

    });

    it('shouldRejectAnArgumentContainingADoubleQuoteRatherThanEscapingIt', () => {

        jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);

        expect(() => PicklistDependencyCheckService.buildSalesforceCliInvocation(['--target-org', 'dev"org']))
            .toThrow('contains a double quote');

    });

});
