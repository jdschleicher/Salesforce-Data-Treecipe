import { PicklistDependencyCheckService } from "../PicklistDependencyCheckService";

import { OrgAuthorization } from '@salesforce/core';

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

function buildTestRunPayload(tests: any[]): any {
    return {
        status: 0,
        result: {
            summary: { outcome: tests.some(test => test.Outcome === 'Fail') ? 'Failed' : 'Passed' },
            tests
        }
    };
}

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
        Message: 'Picklist dependency drift on Account -- 1 combination(s) no longer match local source metadata:\n  - MISSING_VALUES — Account.Type @ "Customer": expected Direct, Channel but org allows only Direct'
    },
    { MethodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }
];

describe('shouldTranslateApexTestRunResults', () => {

    it('shouldReportPassedWhenEveryMethodPasses', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(passingTestMethods)
        );

        expect(checkOutcome.passed).toBeTrue();
        expect(checkOutcome.failureCount).toBe(0);
        expect(checkOutcome.methodOutcomes).toHaveLength(2);

    });

    it('shouldReportFailedWithCountWhenAMethodFails', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(failingTestMethods)
        );

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);
        expect(PicklistDependencyCheckService.buildResultSummaryMessage(checkOutcome)).toContain('1 of 2 test method(s) failed');

    });

    it('shouldCarryTheAssertionMessageThroughForFailedMethods', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(failingTestMethods)
        );

        const failedMethodOutcome = checkOutcome.methodOutcomes.find(methodOutcome => !methodOutcome.passed);

        expect(failedMethodOutcome.message).toContain('Account.Type @ "Customer"');

    });

    it('shouldThrowWhenNoResultPayloadIsReturned', () => {

        const authFailurePayload = { status: 1, name: 'NoOrgFound', message: 'No authorization information found' };

        expect(() => PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(authFailurePayload))
            .toThrow('NoOrgFound: No authorization information found');

    });

    it('shouldThrowWhenNoTestMethodsRan', () => {

        expect(() => PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(buildTestRunPayload([])))
            .toThrow('No PicklistDependencySpecsTest test methods ran');

    });

});

/*
    Reading only the PascalCase keys would make an unexpected casing render every method as failed --
    a false report of picklist dependency drift, which is the one thing this command must never do.
*/
describe('shouldReadTestResultKeysCaseInsensitively', () => {

    it('shouldAcceptLowerCaseMethodNameKey', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([{ methodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }])
        );

        expect(checkOutcome.methodOutcomes[0].methodName).toBe('specRegistryIsNotEmpty');

    });

    it('shouldNotReportFalseDriftWhenOutcomeKeyArrivesLowerCase', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([
                { methodName: 'Account_picklistDependenciesMatchSourceMetadata', outcome: 'Pass' },
                { methodName: 'specRegistryIsNotEmpty', outcome: 'Pass' }
            ])
        );

        expect(checkOutcome.passed).toBeTrue();
        expect(checkOutcome.failureCount).toBe(0);

    });

    it('shouldTreatOutcomeValueCaseInsensitively', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([{ MethodName: 'specRegistryIsNotEmpty', Outcome: 'pass' }])
        );

        expect(checkOutcome.passed).toBeTrue();

    });

    it('shouldAcceptLowerCaseMessageKeyOnAFailedMethod', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([{ methodName: 'Account_picklistDependenciesMatchSourceMetadata', outcome: 'Fail', message: 'drift detail' }])
        );

        expect(checkOutcome.methodOutcomes[0].message).toBe('drift detail');

    });

});

describe('shouldNeverTreatEmptyRegistryAsSuccess', () => {

    it('shouldSurfaceEmptyRegistryAsAFailingMethodWithGuidance', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([{
                MethodName: 'specRegistryIsNotEmpty',
                Outcome: 'Fail',
                Message: 'No picklist dependency specs are registered, so this run verified nothing.'
            }])
        );

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.methodOutcomes[0].message).toContain('verified nothing');

    });

});

describe('shouldBuildReadableOutputChannelReport', () => {

    it('shouldListEveryMethodWithItsOutcome', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(buildTestRunPayload(failingTestMethods));
        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);

        expect(report).toContain('Picklist Dependency Check — devHub');
        expect(report).toContain('failures:    1');
        expect(report).toContain('FAIL  Account_picklistDependenciesMatchSourceMetadata');
        expect(report).toContain('PASS  specRegistryIsNotEmpty');

    });

    it('shouldIndentEachLineOfAMultiLineAssertionMessage', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(buildTestRunPayload(failingTestMethods));
        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);
        const missingValuesLine = report.split('\n').find(reportLine => reportLine.includes('MISSING_VALUES'));

        expect(missingValuesLine).toStartWith('        ');

    });

    it('shouldNotEmitAMessageBlockForPassingMethods', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(buildTestRunPayload(passingTestMethods));
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

    it('shouldReturnOutcomeFromAnAsyncTestRun', async () => {

        stubSalesforceCli({ stdout: JSON.stringify(buildTestRunPayload(passingTestMethods)) });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeTrue();

    });

    it('shouldStillReportFailuresWhenTheCliExitsNonZeroForFailingTests', async () => {

        stubSalesforceCli({ stdout: JSON.stringify(buildTestRunPayload(failingTestMethods)), exitCode: 100 });

        const checkOutcome = await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);

    });

    it('shouldRequestOnlyTheGeneratedTestClassAndBoundTheWait', async () => {

        const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify(buildTestRunPayload(passingTestMethods)) });

        await PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];

        expect(salesforceCliArguments).toIncludeAllMembers(['apex', 'run', 'test', '--tests', 'PicklistDependencySpecsTest']);
        expect(salesforceCliArguments).toIncludeAllMembers(['--target-org', 'devHub']);

        /*
            --wait is in MINUTES. An unbounded or very large value would hold the command open long
            past anything a spec registry can justify.
        */
        const waitMinutes = Number(salesforceCliArguments[salesforceCliArguments.indexOf('--wait') + 1]);
        expect(waitMinutes).toBeGreaterThan(0);
        expect(waitMinutes).toBeLessThanOrEqual(10);

    });

    it('shouldKillTheChildProcessWhenCancellationIsRequested', async () => {

        const { killMock } = stubSalesforceCli({ stdout: JSON.stringify(buildTestRunPayload(passingTestMethods)) });

        let capturedKill: (() => void) | undefined;
        await PicklistDependencyCheckService.runPicklistDependencyTests('devHub', killChildProcess => { capturedKill = killChildProcess; });

        expect(capturedKill).toBeDefined();
        capturedKill();
        expect(killMock).toHaveBeenCalled();

    });

    it('shouldBoundTheDeployWaitRatherThanUsingTheThirtyThreeMinuteDefault', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];

        expect(salesforceCliArguments).toContain('--wait');
        const waitMinutes = Number(salesforceCliArguments[salesforceCliArguments.indexOf('--wait') + 1]);
        expect(waitMinutes).toBeLessThanOrEqual(10);

    });

});

describe('shouldTranslateSalesforceCliSpawnFailures', () => {

    it('shouldThrowActionableMessageWhenCliIsNotInstalled', async () => {

        stubSalesforceCli({ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('not installed or not on PATH');

    });

    it('shouldThrowActionableMessageOnEinvalRatherThanARawSpawnError', async () => {

        stubSalesforceCli({ error: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }) });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .rejects.toThrow('EINVAL');

    });

    it('shouldIncludeStderrAndExitCodeWhenOutputIsNotParseableJson', async () => {

        stubSalesforceCli({ stdout: '', stderr: 'ERROR running apex: No authorization found', exitCode: 1 });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
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

    it('shouldThrowBeforeInvokingTheCliForAnUnusableIdentifier', async () => {

        const { execFileSpy } = stubSalesforceCli({ stdout: '{}' });

        await expect(PicklistDependencyCheckService.runPicklistDependencyTests('--target-org'))
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

    it('shouldReturnEmptyListWhenNoOrgsAreAuthenticated', () => {
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails([])).toBeEmpty();
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails(undefined as unknown as OrgAuthorization[])).toBeEmpty();
    });

});

describe('shouldDetectWhetherTestClassIsDeployedInOrg', () => {

    it('shouldReturnTrueWhenTestClassQueryReturnsARecord', async () => {

        stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { totalSize: 1, records: [{ Id: '01p' }] } }) });

        await expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).resolves.toBeTrue();

    });

    it('shouldReturnFalseWhenTestClassQueryReturnsNoRecords', async () => {

        stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { totalSize: 0, records: [] } }) });

        await expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).resolves.toBeFalse();

    });

    it('shouldReturnFalseWhenQueryFailsRatherThanAssumingDeployed', async () => {

        stubSalesforceCli({ error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });

        await expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).resolves.toBeFalse();

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
        stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        const deploySummary = await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        expect(deploySummary).toContain('8 component(s)');

    });

    it('shouldDeployOnlyTheClassesThisCommandOwnsRatherThanTheWholeDirectory', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const { execFileSpy } = stubSalesforceCli({ stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } }) });

        await PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        const salesforceCliArguments = execFileSpy.mock.calls[0][1] as string[];
        const deployedPaths = salesforceCliArguments.filter(cliArgument => cliArgument.endsWith('.cls'));

        expect(deployedPaths).toSatisfyAll((deployedPath: string) => deployedPath.includes('PicklistDependency'));
        expect(salesforceCliArguments).not.toContain('/workspace/classes');

    });

    it('shouldThrowComponentFailureDetailWhenDeployFails', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        stubSalesforceCli({
            stdout: JSON.stringify({
                status: 1,
                result: { success: false, details: { componentFailures: [{ fullName: 'PicklistDependencySpecsTest', problem: 'Method does not exist' }] } }
            })
        });

        await expect(PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .rejects.toThrow('PicklistDependencySpecsTest: Method does not exist');

    });

    it('shouldThrowActionableGuidanceWhenSourceTrackingReportsConflicts', async () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        stubSalesforceCli({ stdout: JSON.stringify({ status: 1, name: 'SourceConflictError', message: '16 conflicts detected' }) });

        await expect(PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .rejects.toThrow('Retrieve or resolve them first');

    });

});

describe('shouldNameEveryFileInTheDeployConfirmation', () => {

    it('shouldListTheOwnedClassFileNamesAndTheTargetOrg', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);

        const confirmationMessage = PicklistDependencyCheckService.buildDeployConfirmationMessage('/workspace/classes', 'devHub');

        expect(confirmationMessage).toContain('devHub');
        expect(confirmationMessage).toContain('PicklistDependencySpecsTest.cls');
        expect(confirmationMessage).toContain('PicklistDependencyValidator.cls');
        // THE USER MUST BE ABLE TO SEE THAT WORKSPACE COPIES ARE WHAT GETS SENT
        expect(confirmationMessage).toContain('as they exist in your workspace');

    });

});

describe('shouldPersistCheckResultsToTheTreecipeDirectory', () => {

    const isoDateTimestamp = '2026-08-16T14-22-08';

    function buildCheckOutcome(passed: boolean) {
        return PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(passed ? passingTestMethods : failingTestMethods)
        );
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
        expect(resultsJson.methodOutcomes[0].message).toContain('Account.Type @ "Customer"');

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
