import { PicklistDependencyTestService } from '../PicklistDependencyTestService/PicklistDependencyTestService';

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';

export interface IAuthenticatedOrgDetail {
    // THE ALIAS WHEN ONE IS SET, OTHERWISE THE USERNAME -- BOTH ARE ACCEPTED BY "sf --target-org"
    targetOrgIdentifier: string;
    username: string;
    alias?: string;
}

export interface IPicklistDependencyMethodOutcome {
    methodName: string;
    passed: boolean;
    message?: string;
}

export interface IPicklistDependencyCheckOutcome {
    passed: boolean;
    methodOutcomes: IPicklistDependencyMethodOutcome[];
    failureCount: number;
}

export class PicklistDependencyCheckService {

    /*
        Windows ships the CLI as a .cmd shim. Since the Node fix for CVE-2024-27980 spawn refuses to
        execute .cmd/.bat without a shell, so the shim is named directly -- that keeps the argv form
        and its immunity to shell metacharacters instead of falling back to shell: true.
    */
    static getSalesforceCliExecutable(): string {
        return process.platform === 'win32' ? 'sf.cmd' : 'sf';
    }

    static getSpecsTestClassName(): string {
        return PicklistDependencyTestService.getSpecsTestClassName();
    }

    static buildAuthenticatedOrgDetails(authorizations: any[]): IAuthenticatedOrgDetail[] {

        if ( !Array.isArray(authorizations) ) {
            return [];
        }

        return authorizations.reduce((orgDetails: IAuthenticatedOrgDetail[], authorization) => {

            const username = authorization?.username;
            if ( !username ) {
                return orgDetails;
            }

            const alias = authorization.aliases?.length ? authorization.aliases[0] : undefined;

            orgDetails.push({
                targetOrgIdentifier: alias || username,
                username,
                alias
            });

            return orgDetails;

        }, []);

    }

    /*
        Spawn failures are translated before any result parsing so that "the CLI never ran" and "the
        tests ran and failed" stay distinguishable. Collapsing them would let a missing CLI read as
        picklist dependency drift.
    */
    private static parseSalesforceCliJsonOutput(spawnResult: SpawnSyncReturns<string>): any {

        if ( spawnResult.error ) {

            const spawnErrorCode = (spawnResult.error as NodeJS.ErrnoException).code;
            if ( spawnErrorCode === 'ENOENT' ) {
                throw new Error(`The Salesforce CLI ("${this.getSalesforceCliExecutable()}") is not installed or not on PATH. Install it, authorize an org, and run the command again.`);
            }

            throw new Error(`Failed to start the Salesforce CLI: ${spawnResult.error.message}`);

        }

        try {
            return JSON.parse(spawnResult.stdout);
        } catch (parseError) {
            throw new Error(`Could not parse Salesforce CLI JSON output: ${(parseError as Error).message}`);
        }

    }

    /*
        A failing Apex test makes the CLI exit non-zero, so a non-zero status is NOT an error here --
        the result payload still carries the per-method outcomes and is what the user needs to see.
        Only a missing payload means the run itself could not happen.
    */
    static buildCheckOutcomeByTestRunPayload(parsedCliOutput: any): IPicklistDependencyCheckOutcome {

        const testRunResult = parsedCliOutput?.result;

        if ( !testRunResult ) {
            const cliErrorDetail = [parsedCliOutput?.name, parsedCliOutput?.message].filter(Boolean).join(': ');
            throw new Error(cliErrorDetail || 'The Salesforce CLI returned no test result payload.');
        }

        const testMethodResults = Array.isArray(testRunResult.tests) ? testRunResult.tests : [];

        if ( testMethodResults.length === 0 ) {
            throw new Error(`No ${this.getSpecsTestClassName()} test methods ran in the target org. The class may not be deployed, or it may contain no generated specs.`);
        }

        const methodOutcomes: IPicklistDependencyMethodOutcome[] = testMethodResults.map((testMethodResult: any) => ({
            methodName: testMethodResult.MethodName || testMethodResult.methodName || 'unknown',
            passed: testMethodResult.Outcome === 'Pass',
            message: testMethodResult.Message || undefined
        }));

        const failureCount = methodOutcomes.filter(methodOutcome => !methodOutcome.passed).length;

        return {
            passed: failureCount === 0,
            methodOutcomes,
            failureCount
        };

    }

    static runPicklistDependencyTests(targetOrgIdentifier: string): IPicklistDependencyCheckOutcome {

        /*
            "--json" alone produces the structured payload this reads. "--result-format json" was
            also passed at first and is redundant -- verified against an org, both forms return an
            identical result shape, so only the flag that does the work is sent.

            "--wait" makes the run synchronous. Without it the CLI queues the tests and returns a
            job id, and there would be nothing to report.
        */
        const salesforceCliArguments = [
            'apex', 'run', 'test',
            '--tests', this.getSpecsTestClassName(),
            '--target-org', targetOrgIdentifier,
            '--wait', '20',
            '--json'
        ];

        const spawnResult = spawnSync(this.getSalesforceCliExecutable(), salesforceCliArguments, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 64
        });

        const parsedCliOutput = this.parseSalesforceCliJsonOutput(spawnResult);

        return this.buildCheckOutcomeByTestRunPayload(parsedCliOutput);

    }

    /*
        The test class is queried rather than deployed blindly so the user is only prompted when a
        deploy is actually needed. A query failure is treated as "not deployed" -- prompting to
        deploy something already present is recoverable, silently skipping a required deploy is not.
    */
    static isSpecsTestClassDeployedInOrg(targetOrgIdentifier: string): boolean {

        const salesforceCliArguments = [
            'data', 'query',
            '--query', `SELECT Id FROM ApexClass WHERE Name = '${this.getSpecsTestClassName()}' LIMIT 1`,
            '--target-org', targetOrgIdentifier,
            '--json'
        ];

        const spawnResult = spawnSync(this.getSalesforceCliExecutable(), salesforceCliArguments, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 8
        });

        if ( spawnResult.error || !spawnResult.stdout ) {
            return false;
        }

        try {
            const parsedCliOutput = JSON.parse(spawnResult.stdout);
            return parsedCliOutput?.result?.totalSize > 0;
        } catch {
            return false;
        }

    }

    /*
        The classes this command owns are named individually rather than deploying the whole classes
        directory. A user's package directory holds their own Apex, and a deploy they approved to get
        a picklist dependency check running must not carry unrelated work-in-progress classes into
        the org with it.
    */
    static getPicklistDependencyClassFilePaths(classesDirectoryPath: string): string[] {

        const ownedClassNames = [
            ...PicklistDependencyTestService.getFrameworkClassNames(),
            PicklistDependencyTestService.getSpecsClassName(),
            PicklistDependencyTestService.getSpecsTestClassName()
        ];

        return ownedClassNames
            .map(ownedClassName => path.join(classesDirectoryPath, `${ownedClassName}.cls`))
            .filter(classFilePath => fs.existsSync(classFilePath));

    }

    static deployPicklistDependencyClasses(classesDirectoryPath: string, targetOrgIdentifier: string): string {

        if ( !fs.existsSync(classesDirectoryPath) ) {
            throw new Error(`No classes directory found at "${classesDirectoryPath}". Run "Generate Picklist Dependency Tests" first, then run the command again.`);
        }

        const classFilePathsToDeploy = this.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        if ( classFilePathsToDeploy.length === 0 ) {
            throw new Error(`No picklist dependency classes were found in "${classesDirectoryPath}". Run "Generate Picklist Dependency Tests" first, then run the command again.`);
        }

        const sourceDirArguments = classFilePathsToDeploy.flatMap(classFilePath => ['--source-dir', classFilePath]);

        const salesforceCliArguments = [
            'project', 'deploy', 'start',
            ...sourceDirArguments,
            '--target-org', targetOrgIdentifier,
            '--json'
        ];

        const spawnResult = spawnSync(this.getSalesforceCliExecutable(), salesforceCliArguments, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 64
        });

        const parsedCliOutput = this.parseSalesforceCliJsonOutput(spawnResult);
        const deployResult = parsedCliOutput?.result;

        if ( deployResult?.success === true ) {
            const deployedComponentCount = deployResult.numberComponentsDeployed ?? deployResult.details?.componentSuccesses?.length ?? 0;
            return `Deployed ${deployedComponentCount} component(s) to the target org.`;
        }

        /*
            An org with source tracking rejects the deploy outright when it sees the classes as
            changed on both sides, and the CLI's own wording ("N conflicts detected") does not say
            what to do about it. Conflicts are not forced past automatically -- the org copy may hold
            edits worth keeping, and this command exists to report drift rather than overwrite it.
        */
        if ( parsedCliOutput?.name === 'SourceConflictError' ) {
            throw new Error(`The picklist dependency classes conflict with the copies already in "${targetOrgIdentifier}". Retrieve or resolve them first, or deploy manually with "sf project deploy start --ignore-conflicts" if the local copies should win.`);
        }

        const componentFailures = deployResult?.details?.componentFailures;
        const normalizedComponentFailures = Array.isArray(componentFailures) ? componentFailures : [componentFailures].filter(Boolean);

        if ( normalizedComponentFailures.length > 0 ) {
            const failureSummary = normalizedComponentFailures
                .map(componentFailure => `${componentFailure.fullName}: ${componentFailure.problem}`)
                .join('; ');
            throw new Error(`The picklist dependency classes failed to deploy: ${failureSummary}`);
        }

        const cliErrorDetail = [parsedCliOutput?.name, parsedCliOutput?.message].filter(Boolean).join(': ');
        throw new Error(cliErrorDetail || 'The picklist dependency classes failed to deploy for an unknown reason.');

    }

    static buildOutputChannelReport(targetOrgIdentifier: string, checkOutcome: IPicklistDependencyCheckOutcome): string {

        let reportLines: string[] = [
            `Picklist Dependency Check — ${targetOrgIdentifier}`,
            `  methods run: ${checkOutcome.methodOutcomes.length}`,
            `  failures:    ${checkOutcome.failureCount}`,
            ''
        ];

        checkOutcome.methodOutcomes.forEach(methodOutcome => {

            reportLines.push(`  ${methodOutcome.passed ? 'PASS' : 'FAIL'}  ${methodOutcome.methodName}`);

            if ( !methodOutcome.passed && methodOutcome.message ) {
                /*
                    Apex assertion messages arrive with literal newlines, so each is indented to stay
                    visually attached to the method that produced it.
                */
                methodOutcome.message.split('\n').forEach(messageLine => {
                    reportLines.push(`        ${messageLine.trim()}`);
                });
            }

        });

        return reportLines.join('\n');

    }

    static buildResultSummaryMessage(checkOutcome: IPicklistDependencyCheckOutcome): string {

        if ( checkOutcome.passed ) {
            return 'Picklist dependency check passed. All expected controlling value combinations still exist in the target org.';
        }

        return `Picklist dependency check failed: ${checkOutcome.failureCount} of ${checkOutcome.methodOutcomes.length} test method(s) failed. See the "Picklist Dependency Check" output for detail.`;

    }

}
