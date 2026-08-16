import { PicklistDependencyCheckService } from "../PicklistDependencyCheckService";

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
        expect(failedMethodOutcome.message).toContain('expected Direct, Channel');

    });

    it('shouldAcceptLowerCaseMethodNameKeyFromTheCli', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload([{ methodName: 'specRegistryIsNotEmpty', Outcome: 'Pass' }])
        );

        expect(checkOutcome.methodOutcomes[0].methodName).toBe('specRegistryIsNotEmpty');

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

describe('shouldNeverTreatEmptyRegistryAsSuccess', () => {

    /*
        The empty registry case is an assertion inside the generated test class rather than a marker,
        so it reaches the extension as an ordinary failing method.
    */
    it('shouldSurfaceEmptyRegistryAsAFailingMethodWithGuidance', () => {

        const emptyRegistryTestMethods = [
            {
                MethodName: 'specRegistryIsNotEmpty',
                Outcome: 'Fail',
                Message: 'No picklist dependency specs are registered, so this run verified nothing. Re-run the "Generate Picklist Dependency Tests" command.'
            }
        ];

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(emptyRegistryTestMethods)
        );

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);
        expect(checkOutcome.methodOutcomes[0].message).toContain('verified nothing');

    });

});

describe('shouldBuildReadableOutputChannelReport', () => {

    it('shouldListEveryMethodWithItsOutcome', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(failingTestMethods)
        );

        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);

        expect(report).toContain('Picklist Dependency Check — devHub');
        expect(report).toContain('failures:    1');
        expect(report).toContain('FAIL  Account_picklistDependenciesMatchSourceMetadata');
        expect(report).toContain('PASS  specRegistryIsNotEmpty');

    });

    it('shouldIndentEachLineOfAMultiLineAssertionMessage', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(failingTestMethods)
        );

        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);
        const missingValuesLine = report.split('\n').find(reportLine => reportLine.includes('MISSING_VALUES'));

        expect(missingValuesLine).toStartWith('        ');

    });

    it('shouldNotEmitAMessageBlockForPassingMethods', () => {

        const checkOutcome = PicklistDependencyCheckService.buildCheckOutcomeByTestRunPayload(
            buildTestRunPayload(passingTestMethods)
        );

        const report = PicklistDependencyCheckService.buildOutputChannelReport('devHub', checkOutcome);

        expect(report).not.toContain('MISSING_VALUES');
        expect(report).toContain('failures:    0');

    });

});

describe('shouldTranslateSalesforceCliSpawnFailures', () => {

    it('shouldThrowActionableMessageWhenCliIsNotInstalled', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            error: Object.assign(new Error('spawnSync sf ENOENT'), { code: 'ENOENT' })
        } as any);

        expect(() => PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .toThrow('not installed or not on PATH');

    });

    it('shouldThrowWhenCliOutputIsNotParseableJson', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({ stdout: 'not json at all' } as any);

        expect(() => PicklistDependencyCheckService.runPicklistDependencyTests('devHub'))
            .toThrow('Could not parse Salesforce CLI JSON output');

    });

    it('shouldStillReportFailuresWhenTheCliExitsNonZeroForFailingTests', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            status: 100,
            stdout: JSON.stringify(buildTestRunPayload(failingTestMethods))
        } as any);

        const checkOutcome = PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        expect(checkOutcome.passed).toBeFalse();
        expect(checkOutcome.failureCount).toBe(1);

    });

    it('shouldRequestOnlyTheGeneratedTestClass', () => {

        const spawnSyncSpy = jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify(buildTestRunPayload(passingTestMethods))
        } as any);

        PicklistDependencyCheckService.runPicklistDependencyTests('devHub');

        const salesforceCliArguments = spawnSyncSpy.mock.calls[0][1] as string[];

        expect(salesforceCliArguments).toIncludeAllMembers(['apex', 'run', 'test', '--tests', 'PicklistDependencySpecsTest']);
        expect(salesforceCliArguments).toIncludeAllMembers(['--target-org', 'devHub']);

    });

});

describe('shouldBuildAuthenticatedOrgQuickPickDetails', () => {

    it('shouldPreferAliasOverUsernameAsTargetOrgIdentifier', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            { username: 'dev@example.com', aliases: ['devHub'] }
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].targetOrgIdentifier).toBe('devHub');
        expect(orgDetails[0].username).toBe('dev@example.com');

    });

    it('shouldFallBackToUsernameWhenNoAliasIsSet', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            { username: 'scratch@example.com', aliases: [] }
        ]);

        expect(orgDetails[0].targetOrgIdentifier).toBe('scratch@example.com');
        expect(orgDetails[0].alias).toBeUndefined();

    });

    it('shouldSkipAuthorizationsWithoutAUsername', () => {

        const orgDetails = PicklistDependencyCheckService.buildAuthenticatedOrgDetails([
            { aliases: ['brokenEntry'] },
            { username: 'valid@example.com', aliases: [] }
        ]);

        expect(orgDetails).toHaveLength(1);
        expect(orgDetails[0].username).toBe('valid@example.com');

    });

    it('shouldReturnEmptyListWhenNoOrgsAreAuthenticated', () => {
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails([])).toBeEmpty();
        expect(PicklistDependencyCheckService.buildAuthenticatedOrgDetails(undefined as unknown as any[])).toBeEmpty();
    });

});

describe('shouldDetectWhetherTestClassIsDeployedInOrg', () => {

    it('shouldReturnTrueWhenTestClassQueryReturnsARecord', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify({ status: 0, result: { totalSize: 1, records: [{ Id: '01p000000000000' }] } })
        } as any);

        expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).toBeTrue();

    });

    it('shouldReturnFalseWhenTestClassQueryReturnsNoRecords', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify({ status: 0, result: { totalSize: 0, records: [] } })
        } as any);

        expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).toBeFalse();

    });

    it('shouldReturnFalseWhenQueryFailsRatherThanAssumingDeployed', () => {

        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            error: Object.assign(new Error('spawnSync sf ENOENT'), { code: 'ENOENT' })
        } as any);

        expect(PicklistDependencyCheckService.isSpecsTestClassDeployedInOrg('devHub')).toBeFalse();

    });

});

describe('shouldDeployPicklistDependencyClasses', () => {

    it('shouldThrowGuidanceWhenClassesDirectoryDoesNotExist', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(() => PicklistDependencyCheckService.deployPicklistDependencyClasses('/no/such/classes', 'devHub'))
            .toThrow('Generate Picklist Dependency Tests');

    });

    it('shouldReturnDeployedComponentSummaryOnSuccess', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } })
        } as any);

        const deploySummary = PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        expect(deploySummary).toContain('8 component(s)');

    });

    it('shouldDeployOnlyTheClassesThisCommandOwnsRatherThanTheWholeDirectory', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const spawnSyncSpy = jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify({ status: 0, result: { success: true, numberComponentsDeployed: 8 } })
        } as any);

        PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub');

        const salesforceCliArguments = spawnSyncSpy.mock.calls[0][1] as string[];
        const deployedPaths = salesforceCliArguments.filter(cliArgument => cliArgument.endsWith('.cls'));

        expect(deployedPaths).toSatisfyAll((deployedPath: string) => deployedPath.includes('PicklistDependency'));
        expect(deployedPaths.some(deployedPath => deployedPath.endsWith('PicklistDependencySpecsTest.cls'))).toBeTrue();
        expect(salesforceCliArguments).not.toContain('/workspace/classes');

    });

    it('shouldThrowGuidanceWhenNoOwnedClassesArePresentInTheDirectory', () => {

        jest.spyOn(fs, 'existsSync').mockImplementation((checkedPath: any) => !String(checkedPath).endsWith('.cls'));

        expect(() => PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .toThrow('No picklist dependency classes were found');

    });

    it('shouldThrowComponentFailureDetailWhenDeployFails', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            stdout: JSON.stringify({
                status: 1,
                result: {
                    success: false,
                    details: {
                        componentFailures: [
                            { fullName: 'PicklistDependencySpecsTest', problem: 'Method does not exist: assertNoPicklistDependencyFailuresForObject' }
                        ]
                    }
                }
            })
        } as any);

        expect(() => PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .toThrow('PicklistDependencySpecsTest: Method does not exist');

    });

    it('shouldThrowActionableGuidanceWhenSourceTrackingReportsConflicts', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            status: 1,
            stdout: JSON.stringify({ status: 1, name: 'SourceConflictError', message: '16 conflicts detected' })
        } as any);

        expect(() => PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .toThrow('Retrieve or resolve them first');

    });

    it('shouldThrowActionableMessageWhenCliIsNotInstalledDuringDeploy', () => {

        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            error: Object.assign(new Error('spawnSync sf ENOENT'), { code: 'ENOENT' })
        } as any);

        expect(() => PicklistDependencyCheckService.deployPicklistDependencyClasses('/workspace/classes', 'devHub'))
            .toThrow('not installed or not on PATH');

    });

});
