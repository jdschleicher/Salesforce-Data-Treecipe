import { PicklistDependencyTestService } from '../PicklistDependencyTestService/PicklistDependencyTestService';

import { OrgAuthorization } from '@salesforce/core';

import * as fs from 'fs';
import * as path from 'path';
import { execFile, ExecFileOptionsWithStringEncoding } from 'child_process';

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

export interface ISalesforceCliInvocationResult {
    stdout: string;
    stderr: string;
    // NULL WHEN THE PROCESS WAS KILLED BY A SIGNAL RATHER THAN EXITING ON ITS OWN
    exitCode: number | null;
    spawnError?: NodeJS.ErrnoException;
}

/*
    The shape the CLI returns for "sf apex run test --json". Only the fields this service reads are
    modelled -- the payload carries considerably more, and typing the remainder would be inventing a
    contract rather than describing one.
*/
export interface ISalesforceApexTestMethodResult {
    MethodName?: string;
    methodName?: string;
    Outcome?: string;
    outcome?: string;
    Message?: string | null;
    message?: string | null;
}

export interface ISalesforceCliJsonPayload {
    name?: string;
    message?: string;
    result?: {
        tests?: ISalesforceApexTestMethodResult[];
        totalSize?: number;
        success?: boolean;
        numberComponentsDeployed?: number;
        details?: {
            componentFailures?: { fullName?: string; problem?: string } | { fullName?: string; problem?: string }[];
            componentSuccesses?: unknown[];
        };
    };
}

/*
    Why a deploy is being proposed. The two commands arrive at the same confirmation for different
    reasons, and the confirmation has to say which.
*/
export type PicklistDependencyDeployReason = 'specsTestClassAbsentFromOrg' | 'specsClassesJustRegenerated';

export class PicklistDependencyCheckService {

    /*
        A Salesforce org alias or username. Anything outside this set cannot be a real one, and the
        check exists so that a value beginning with "-" can never reach the CLI and be read as a flag
        rather than a value. Argv form already makes shell metacharacters inert, so this is defence in
        depth -- but it becomes load bearing the moment anyone reintroduces a shell.
    */
    private static targetOrgIdentifierPattern = /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]*$/;

    /*
        Windows ships the CLI as a .cmd shim, and a shim cannot be executed the way a real binary can.
        Since the Node fix for CVE-2024-27980, spawning a .cmd or .bat with arguments and without a
        shell fails outright with EINVAL, so naming "sf.cmd" directly does not preserve the argv form
        -- it breaks every invocation on win32. The shell is therefore enabled on Windows only, and
        every argument is quoted below. Nothing changes on other platforms, where the argv form is
        kept exactly as it was.
    */
    static isWindowsPlatform(): boolean {
        return process.platform === 'win32';
    }

    static getSalesforceCliExecutable(): string {
        return this.isWindowsPlatform() ? 'sf.cmd' : 'sf';
    }

    static getSpecsTestClassName(): string {
        return PicklistDependencyTestService.getSpecsTestClassName();
    }

    static isValidTargetOrgIdentifier(targetOrgIdentifier: string): boolean {
        return typeof targetOrgIdentifier === 'string' && this.targetOrgIdentifierPattern.test(targetOrgIdentifier);
    }

    static assertValidTargetOrgIdentifier(targetOrgIdentifier: string) {

        if ( !this.isValidTargetOrgIdentifier(targetOrgIdentifier) ) {
            throw new Error(`"${targetOrgIdentifier}" is not a usable Salesforce org alias or username. Re-authorize the org and run the command again.`);
        }

    }

    /*
        Only needed on Windows, where the shell is enabled. Double quotes are the only quoting cmd.exe
        honours, and a value containing one is rejected outright rather than escaped -- no real alias,
        username or package directory path contains a double quote, so rejecting is safer than trying
        to be clever about cmd.exe's escaping rules.
    */
    static quoteWindowsArgument(argumentValue: string): string {

        if ( argumentValue.includes('"') ) {
            throw new Error(`The value "${argumentValue}" contains a double quote and cannot be passed to the Salesforce CLI on Windows.`);
        }

        return `"${argumentValue}"`;

    }

    static buildSalesforceCliInvocation(salesforceCliArguments: string[]): { command: string; args: string[]; useShell: boolean } {

        if ( this.isWindowsPlatform() ) {
            return {
                command: this.getSalesforceCliExecutable(),
                args: salesforceCliArguments.map(salesforceCliArgument => this.quoteWindowsArgument(salesforceCliArgument)),
                useShell: true
            };
        }

        return { command: this.getSalesforceCliExecutable(), args: salesforceCliArguments, useShell: false };

    }

    /*
        Asynchronous on purpose. The VS Code extension host is single threaded and shared by every
        installed extension, so a synchronous spawn freezes the whole window -- and these commands are
        long running by nature: an Apex test run waits on an org side queue and a deploy waits on the
        Metadata API. onCancellationRequested kills the child so a user is never stuck waiting.
    */
    static runSalesforceCli(salesforceCliArguments: string[],
                            registerCancellation?: (killChildProcess: () => void) => void): Promise<ISalesforceCliInvocationResult> {

        const invocation = this.buildSalesforceCliInvocation(salesforceCliArguments);

        const execFileOptions: ExecFileOptionsWithStringEncoding = {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 8,
            shell: invocation.useShell,
            windowsHide: true
        };

        return new Promise<ISalesforceCliInvocationResult>(resolve => {

            const childProcess = execFile(invocation.command, invocation.args, execFileOptions, (executionError, stdout, stderr) => {

                /*
                    execFile reports both conditions through one error object, and "code" is what
                    tells them apart: a NUMBER is the child's exit status, a STRING is an errno from a
                    spawn that never ran (ENOENT, EINVAL). Only the latter is a real failure here --
                    a failing Apex test or deploy exits non zero while still writing the payload that
                    explains why, and that payload is exactly what the user needs to see.

                    The exit status is read off the error rather than off childProcess, because the
                    callback can fire before the const above is assigned.
                */
                const errorCode = (executionError as NodeJS.ErrnoException)?.code;

                const spawnError = typeof errorCode === 'string' ? executionError as NodeJS.ErrnoException : undefined;
                const exitCode = typeof errorCode === 'number' ? errorCode : (executionError ? null : 0);

                resolve({
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    exitCode,
                    spawnError
                });

            });

            if ( registerCancellation ) {
                registerCancellation(() => childProcess.kill());
            }

        });

    }

    /*
        Spawn failures are translated before any result parsing so that "the CLI never ran" and "the
        tests ran and failed" stay distinguishable. Collapsing them would let a missing CLI read as
        picklist dependency drift.
    */
    static parseSalesforceCliJsonOutput(invocationResult: ISalesforceCliInvocationResult): ISalesforceCliJsonPayload {

        if ( invocationResult.spawnError ) {

            const spawnErrorCode = invocationResult.spawnError.code;

            if ( spawnErrorCode === 'ENOENT' ) {
                throw new Error(`The Salesforce CLI ("${this.getSalesforceCliExecutable()}") is not installed or not on PATH. Install it, authorize an org, and run the command again.`);
            }

            if ( spawnErrorCode === 'EINVAL' ) {
                throw new Error(`The Salesforce CLI ("${this.getSalesforceCliExecutable()}") could not be started (EINVAL). Confirm the CLI is installed and on PATH, then run the command again.`);
            }

            throw new Error(`Failed to start the Salesforce CLI: ${invocationResult.spawnError.message}`);

        }

        try {
            return JSON.parse(invocationResult.stdout) as ISalesforceCliJsonPayload;
        } catch (parseError) {
            /*
                An auth or CLI level failure can produce no stdout at all, in which case the parser
                message alone ("Unexpected end of JSON input") hides the real cause. stderr and the
                exit code are carried through so the user sees what actually went wrong.
            */
            const stderrDetail = invocationResult.stderr?.trim();
            const exitCodeDetail = invocationResult.exitCode === null ? 'terminated by signal' : `exit code ${invocationResult.exitCode}`;
            const causeDetail = stderrDetail ? `${stderrDetail} (${exitCodeDetail})` : exitCodeDetail;

            throw new Error(`The Salesforce CLI did not return usable JSON — ${causeDetail}. Parser reported: ${(parseError as Error).message}`);
        }

    }

    static buildAuthenticatedOrgDetails(authorizations: OrgAuthorization[]): IAuthenticatedOrgDetail[] {

        if ( !Array.isArray(authorizations) ) {
            return [];
        }

        return authorizations.reduce((orgDetails: IAuthenticatedOrgDetail[], authorization) => {

            const username = authorization?.username;
            if ( !username ) {
                return orgDetails;
            }

            const alias = authorization.aliases?.length ? authorization.aliases[0] : undefined;
            const targetOrgIdentifier = alias || username;

            // AN UNUSABLE IDENTIFIER IS DROPPED HERE SO IT CANNOT REACH THE QUICK PICK AND THEN THE CLI
            if ( !this.isValidTargetOrgIdentifier(targetOrgIdentifier) ) {
                return orgDetails;
            }

            orgDetails.push({ targetOrgIdentifier, username, alias });

            return orgDetails;

        }, []);

    }

    /*
        A failing Apex test makes the CLI exit non-zero, so a non-zero status is NOT an error here --
        the result payload still carries the per-method outcomes and is what the user needs to see.
        Only a missing payload means the run itself could not happen.
    */
    static buildCheckOutcomeByTestRunPayload(parsedCliOutput: ISalesforceCliJsonPayload): IPicklistDependencyCheckOutcome {

        const testRunResult = parsedCliOutput?.result;

        if ( !testRunResult ) {
            const cliErrorDetail = [parsedCliOutput?.name, parsedCliOutput?.message].filter(Boolean).join(': ');
            throw new Error(cliErrorDetail || 'The Salesforce CLI returned no test result payload.');
        }

        const testMethodResults = Array.isArray(testRunResult.tests) ? testRunResult.tests : [];

        if ( testMethodResults.length === 0 ) {
            throw new Error(`No ${this.getSpecsTestClassName()} test methods ran in the target org. The class may not be deployed, or it may contain no generated specs.`);
        }

        /*
            Every key is read case insensitively. Reading "Outcome" alone would make an unexpected
            casing render every method as failed, which is a false report of picklist dependency
            drift -- precisely the condition this command exists to detect truthfully.
        */
        const methodOutcomes: IPicklistDependencyMethodOutcome[] = testMethodResults.map(testMethodResult => {

            const methodName = testMethodResult.MethodName ?? testMethodResult.methodName ?? 'unknown';
            const outcome = testMethodResult.Outcome ?? testMethodResult.outcome;
            const message = testMethodResult.Message ?? testMethodResult.message;

            return {
                methodName,
                passed: typeof outcome === 'string' && outcome.toLowerCase() === 'pass',
                message: message || undefined
            };

        });

        const failureCount = methodOutcomes.filter(methodOutcome => !methodOutcome.passed).length;

        return { passed: failureCount === 0, methodOutcomes, failureCount };

    }

    /*
        "--json" alone produces the structured payload this reads. "--result-format json" was also
        passed at first and is redundant -- verified against an org, both forms return an identical
        result shape, so only the flag that does the work is sent.

        "--wait" is in MINUTES, not seconds, and makes the run synchronous. Without it the CLI queues
        the tests and returns a job id, leaving nothing to report. Ten minutes is generous for a spec
        registry while still bounding how long a wedged org side queue can hold the command open, and
        the run is cancellable throughout.
    */
    private static apexTestRunWaitMinutes = '10';

    private static deployWaitMinutes = '10';

    static async runPicklistDependencyTests(targetOrgIdentifier: string,
                                            registerCancellation?: (killChildProcess: () => void) => void): Promise<IPicklistDependencyCheckOutcome> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        const salesforceCliArguments = [
            'apex', 'run', 'test',
            '--tests', this.getSpecsTestClassName(),
            '--target-org', targetOrgIdentifier,
            '--wait', this.apexTestRunWaitMinutes,
            '--json'
        ];

        const invocationResult = await this.runSalesforceCli(salesforceCliArguments, registerCancellation);
        const parsedCliOutput = this.parseSalesforceCliJsonOutput(invocationResult);

        return this.buildCheckOutcomeByTestRunPayload(parsedCliOutput);

    }

    /*
        The test class is queried rather than deployed blindly so the user is only prompted when a
        deploy is actually needed. A query failure is treated as "not deployed" -- prompting to
        deploy something already present is recoverable, silently skipping a required deploy is not.
    */
    static async isSpecsTestClassDeployedInOrg(targetOrgIdentifier: string): Promise<boolean> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        const salesforceCliArguments = [
            'data', 'query',
            '--query', `SELECT Id FROM ApexClass WHERE Name = '${this.getSpecsTestClassName()}' LIMIT 1`,
            '--target-org', targetOrgIdentifier,
            '--json'
        ];

        const invocationResult = await this.runSalesforceCli(salesforceCliArguments);

        if ( invocationResult.spawnError || !invocationResult.stdout ) {
            return false;
        }

        try {
            const parsedCliOutput = JSON.parse(invocationResult.stdout) as ISalesforceCliJsonPayload;
            return (parsedCliOutput?.result?.totalSize ?? 0) > 0;
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

        const frameworkDirectoryPath = PicklistDependencyTestService.getFrameworkDirectoryPath(classesDirectoryPath);

        /*
            Framework classes are scaffolded into their own directory, but a workspace generated by an
            earlier version has them loose at the classes root. Both locations are searched and the
            first hit wins, so an upgraded workspace keeps working and no class is ever sent twice
            under two paths -- Salesforce rejects a duplicate ApexClass in one deployment.
        */
        const frameworkClassFilePaths = PicklistDependencyTestService.getFrameworkClassNames()
            .map(frameworkClassName => {

                const scaffoldedPath = path.join(frameworkDirectoryPath, `${frameworkClassName}.cls`);
                if ( fs.existsSync(scaffoldedPath) ) {
                    return scaffoldedPath;
                }

                return path.join(classesDirectoryPath, `${frameworkClassName}.cls`);

            });

        // THE GENERATED CONTRACT STAYS AT THE CLASSES ROOT WHERE A DEVELOPER WOULD LOOK FOR IT
        const generatedClassFilePaths = [
            PicklistDependencyTestService.getSpecsClassName(),
            PicklistDependencyTestService.getSpecsTestClassName()
        ].map(generatedClassName => path.join(classesDirectoryPath, `${generatedClassName}.cls`));

        /*
            The aggregator calls into one generated class per object, so deploying it without them
            fails to compile in the org. They are discovered from disk rather than rebuilt from
            metadata: this command deploys what was generated, and re-deriving the list here would
            silently disagree with it whenever the metadata changed after the last generation.
        */
        const perObjectSpecsClassFilePaths = this.getPerObjectSpecsClassFilePaths(classesDirectoryPath);

        return [...frameworkClassFilePaths, ...perObjectSpecsClassFilePaths, ...generatedClassFilePaths]
            .filter(classFilePath => fs.existsSync(classFilePath));

    }

    static getPerObjectSpecsClassFilePaths(classesDirectoryPath: string): string[] {

        if ( !fs.existsSync(classesDirectoryPath) ) {
            return [];
        }

        return fs.readdirSync(classesDirectoryPath)
            .filter(fileName => PicklistDependencyTestService.isPerObjectSpecsClassFileName(fileName))
            .sort()
            .map(fileName => path.join(classesDirectoryPath, fileName));

    }

    /*
        Confirms there is actually something to deploy, and returns it.

        Callers run this BEFORE showing the deploy confirmation, not only inside the deploy itself.
        The confirmation lists the files that will be sent, so a workspace where generation never ran
        would otherwise render an approval dialog offering zero files and only produce the real,
        actionable error after the user approved it.
    */
    static assertDeployableClassesExist(classesDirectoryPath: string): string[] {

        if ( !fs.existsSync(classesDirectoryPath) ) {
            throw new Error(`No classes directory found at "${classesDirectoryPath}". Run "Generate Picklist Dependency Tests" first, then run the command again.`);
        }

        const classFilePathsToDeploy = this.getPicklistDependencyClassFilePaths(classesDirectoryPath);

        if ( classFilePathsToDeploy.length === 0 ) {
            throw new Error(`No picklist dependency classes were found in "${classesDirectoryPath}". Run "Generate Picklist Dependency Tests" first, then run the command again.`);
        }

        return classFilePathsToDeploy;

    }

    static async deployPicklistDependencyClasses(classesDirectoryPath: string,
                                                 targetOrgIdentifier: string,
                                                 registerCancellation?: (killChildProcess: () => void) => void): Promise<string> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        const classFilePathsToDeploy = this.assertDeployableClassesExist(classesDirectoryPath);

        const sourceDirArguments = classFilePathsToDeploy.flatMap(classFilePath => ['--source-dir', classFilePath]);

        /*
            "--wait" is supplied explicitly. The CLI default is 33 minutes, which is far longer than
            a handful of Apex classes can justify holding the command open for.
        */
        const salesforceCliArguments = [
            'project', 'deploy', 'start',
            ...sourceDirArguments,
            '--target-org', targetOrgIdentifier,
            '--wait', this.deployWaitMinutes,
            '--json'
        ];

        const invocationResult = await this.runSalesforceCli(salesforceCliArguments, registerCancellation);
        const parsedCliOutput = this.parseSalesforceCliJsonOutput(invocationResult);
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

    /*
        The confirmation names every file that will be sent. The framework classes are scaffolded only
        when absent, so a workspace carrying its own copy of one deploys that copy -- the user has to
        be able to see which files those are before approving.
    */
    static buildDeployConfirmationMessage(classesDirectoryPath: string,
                                          targetOrgIdentifier: string,
                                          deployReason: PicklistDependencyDeployReason): string {

        const classFileNames = this.getPicklistDependencyClassFilePaths(classesDirectoryPath)
            .map(classFilePath => path.basename(classFilePath));

        /*
            The opening line is the only thing a user has to reason about before approving a deploy,
            so it has to describe why THIS one is happening. The check command looked the test class
            up and did not find it. The end to end command has just rewritten the classes and never
            looked, so claiming the class "was not found" there tells a user whose class is deployed
            that it is missing -- and invites them to conclude their last deploy failed.
        */
        const deployReasonLine = deployReason === 'specsTestClassAbsentFromOrg'
            ? `${this.getSpecsTestClassName()} was not found in "${targetOrgIdentifier}".`
            : `The picklist dependency classes were just regenerated and will be redeployed to "${targetOrgIdentifier}".`;

        return `${deployReasonLine}\n\n`
            + `The following ${classFileNames.length} file(s) from "${classesDirectoryPath}" will be deployed:\n\n`
            + `${classFileNames.join('\n')}\n\n`
            + 'These are deployed as they exist in your workspace.';

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

    /*
        An org alias or username becomes part of a folder name, and a username is an email address
        containing characters that are legal on disk but awkward in a path. Only the characters that
        read cleanly in a directory listing are kept.
    */
    static buildResultsFolderName(targetOrgIdentifier: string, isoDateTimestamp: string): string {

        const filesystemSafeOrgIdentifier = targetOrgIdentifier.replace(/[^A-Za-z0-9._-]/g, '-');

        return `check-${filesystemSafeOrgIdentifier}-${isoDateTimestamp}`;

    }

    static buildResultsJson(targetOrgIdentifier: string,
                            isoDateTimestamp: string,
                            checkOutcome: IPicklistDependencyCheckOutcome): string {

        return JSON.stringify({
            targetOrg: targetOrgIdentifier,
            ranAt: isoDateTimestamp,
            passed: checkOutcome.passed,
            failureCount: checkOutcome.failureCount,
            methodsRun: checkOutcome.methodOutcomes.length,
            methodOutcomes: checkOutcome.methodOutcomes
        }, null, 2);

    }

    static buildResultsMarkdown(targetOrgIdentifier: string,
                                isoDateTimestamp: string,
                                checkOutcome: IPicklistDependencyCheckOutcome): string {

        let markdownLines: string[] = [
            '# Picklist Dependency Check',
            '',
            `- **Target org:** ${targetOrgIdentifier}`,
            `- **Ran at:** ${isoDateTimestamp}`,
            `- **Result:** ${checkOutcome.passed ? 'PASS' : 'FAIL'}`,
            `- **Methods run:** ${checkOutcome.methodOutcomes.length}`,
            `- **Failures:** ${checkOutcome.failureCount}`,
            '',
            '## Methods',
            '',
            '| Outcome | Method |',
            '|---------|--------|'
        ];

        checkOutcome.methodOutcomes.forEach(methodOutcome => {
            markdownLines.push(`| ${methodOutcome.passed ? 'PASS' : 'FAIL'} | \`${methodOutcome.methodName}\` |`);
        });

        const failedMethodOutcomes = checkOutcome.methodOutcomes.filter(methodOutcome => !methodOutcome.passed && methodOutcome.message);

        if ( failedMethodOutcomes.length > 0 ) {

            markdownLines.push('', '## Failure detail', '');

            failedMethodOutcomes.forEach(methodOutcome => {
                markdownLines.push(`### ${methodOutcome.methodName}`, '', '```', methodOutcome.message.trim(), '```', '');
            });

        }

        return markdownLines.join('\n');

    }

    /*
        The output channel is cleared on every run, so without this a check leaves nothing behind --
        nothing to commit, nothing to diff against the previous run, and nothing to attach to a
        review. Both shapes are written on purpose: results.json for anything that consumes the
        outcome, report.md for a person reading it.
    */
    static writeCheckResultArtifacts(resultsFolderPath: string,
                                     targetOrgIdentifier: string,
                                     isoDateTimestamp: string,
                                     checkOutcome: IPicklistDependencyCheckOutcome): string {

        const runResultsFolderPath = path.join(resultsFolderPath, this.buildResultsFolderName(targetOrgIdentifier, isoDateTimestamp));

        fs.mkdirSync(runResultsFolderPath, { recursive: true });

        fs.writeFileSync(
            path.join(runResultsFolderPath, 'results.json'),
            this.buildResultsJson(targetOrgIdentifier, isoDateTimestamp, checkOutcome)
        );

        fs.writeFileSync(
            path.join(runResultsFolderPath, 'report.md'),
            this.buildResultsMarkdown(targetOrgIdentifier, isoDateTimestamp, checkOutcome)
        );

        return runResultsFolderPath;

    }

    static buildResultSummaryMessage(checkOutcome: IPicklistDependencyCheckOutcome): string {

        if ( checkOutcome.passed ) {
            return 'Picklist dependency check passed. All expected controlling value combinations still exist in the target org.';
        }

        return `Picklist dependency check failed: ${checkOutcome.failureCount} of ${checkOutcome.methodOutcomes.length} test method(s) failed. See the "Picklist Dependency Check" output for detail.`;

    }

}
