import { PicklistDependencyTestService } from '../PicklistDependencyTestService/PicklistDependencyTestService';

import { Connection, OrgAuthorization } from '@salesforce/core';
import { SalesforceOrgService } from '../SalesforceOrgService/SalesforceOrgService';

import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, execFile, ExecFileOptionsWithStringEncoding } from 'child_process';

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
    // SET ONLY WHEN THE CALLER'S TIMEOUT ENDED THE RUN -- A KILLED WINDOWS PROCESS EXITS 1, NOT BY A SIGNAL
    timedOut?: boolean;
    // SET WHEN stdout OUTGREW maxBuffer: THE CLI RAN, AND WAS KILLED BEFORE ITS ANSWER COULD BE READ -- NOT A SPAWN FAILURE
    isOutputTooLarge?: boolean;
}

/*
    A command run FROM the project, such as a deploy with no --source-dir, which reads
    sfdx-project.json from its working directory. See runSalesforceCli for why that changes how
    the CLI is found.
*/
export interface ISalesforceCliProjectOptions {
    workingDirectoryPath: string;
    maxBufferBytes?: number;
}

export const SALESFORCE_CLI_DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024 * 8;

export const SALESFORCE_CLI_UNC_WORKING_DIRECTORY_ERROR_CODE = 'EUNCWORKINGDIRECTORY';

/*
    An ApexTestResult row as the Tooling API returns it. Only the fields this service reads are
    modelled, and each is type-checked before it is read: the row comes from the org.
*/
export interface ISalesforceApexTestMethodResult {
    MethodName?: unknown;
    methodName?: unknown;
    Outcome?: unknown;
    outcome?: unknown;
    Message?: unknown;
    message?: unknown;
}

// AN AsyncApexJob'S STATUS WHILE THE SUITE RUNS: Queued, Preparing, Processing, THEN Completed, Failed OR Aborted
export interface ITestRunStatus {
    status: string;
    extendedStatus?: string;
}

/*
    A cancelled check. The message says whether the test job was aborted in the org, so the caller
    shows it as it is rather than as an error.
*/
export class PicklistDependencyTestRunCancelledError extends Error {

    constructor(message: string) {
        super(message);
        this.name = 'PicklistDependencyTestRunCancelledError';
    }

}

export interface ISalesforceCliJsonPayload {
    name?: string;
    message?: string;
    result?: {
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
export type PicklistDependencyDeployReason = 'specsTestSuiteAbsentFromOrg' | 'specsClassesJustRegenerated';

/*
    The shape of the deploy CLI's --json output that these commands actually read.

    Narrow on purpose: the CLI emits a great deal more, and typing only what is consumed keeps the
    failure message honest about what it depends on. Every member is optional because a failing
    invocation may emit any subset of them, or none.
*/
export interface ISalesforceDeployComponentFailure {
    fullName?: string;
    problem?: string;
}

export interface ISalesforceDeployCliOutput {
    name?: string;
    message?: string;
    result?: {
        details?: {
            componentFailures?: ISalesforceDeployComponentFailure | ISalesforceDeployComponentFailure[];
        };
    };
}

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

    static getSpecsTestSuiteName(): string {
        return PicklistDependencyTestService.getTestSuiteName();
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

        The timeout is this method's own rather than execFile's, for Windows: there the CLI runs as
        cmd.exe -> sf.cmd -> node, execFile's timeout kills only cmd.exe, and its callback waits on
        stdio the orphaned node still holds -- so a hung CLI outlived the timeout. A timeout now kills
        the whole tree and resolves at once as timedOut, whatever the pipes are still doing.
    */
    /*
        projectOptions runs the CLI with the WORKSPACE as its working directory, which is what a
        command reading sfdx-project.json needs -- and a working directory a cloned repository
        controls. On Windows cmd.exe looks for "sf.cmd" in the current directory BEFORE PATH, and an
        npm shim then looks there for "node", so a repository could commit either and have it run as
        the user. In that mode the CLI is therefore run by the ABSOLUTE path of the first "sf" found
        on PATH, never from a relative PATH entry or one inside the working directory, and cmd.exe is
        told not to search the current directory at all (NoDefaultCurrentDirectoryInExePath). A CLI
        that cannot be found that way answers as ENOENT, exactly as an uninstalled one does.
    */
    static runSalesforceCli(salesforceCliArguments: string[],
                            registerCancellation?: (killChildProcess: () => void) => void,
                            timeoutMilliseconds?: number,
                            projectOptions?: ISalesforceCliProjectOptions): Promise<ISalesforceCliInvocationResult> {

        let invocation = this.buildSalesforceCliInvocation(salesforceCliArguments);
        let projectExecFileOptions: Partial<ExecFileOptionsWithStringEncoding> = {};

        if ( projectOptions ) {

            // ON WINDOWS cmd.exe CANNOT START IN A UNC FOLDER: IT SAYS SO ON stderr AND RUNS IN C:\Windows INSTEAD, SO THE CLI READS NO PROJECT (#285)
            if ( this.isWindowsPlatform() && this.isUncPath(projectOptions.workingDirectoryPath) ) {
                return Promise.resolve({
                    stdout: '',
                    stderr: '',
                    exitCode: null,
                    spawnError: Object.assign(new Error(this.buildUncWorkingDirectoryMessage(projectOptions.workingDirectoryPath)), { code: SALESFORCE_CLI_UNC_WORKING_DIRECTORY_ERROR_CODE })
                });
            }

            const salesforceCliExecutablePath = this.findSalesforceCliOnPath(process.env.PATH ?? process.env.Path ?? '', projectOptions.workingDirectoryPath);

            if ( !salesforceCliExecutablePath ) {
                return Promise.resolve({
                    stdout: '',
                    stderr: '',
                    exitCode: null,
                    spawnError: Object.assign(new Error(`spawn ${this.getSalesforceCliExecutable()} ENOENT`), { code: 'ENOENT' })
                });
            }

            invocation = {
                ...invocation,
                command: this.isWindowsPlatform() ? this.quoteWindowsArgument(salesforceCliExecutablePath) : salesforceCliExecutablePath
            };
            projectExecFileOptions = {
                cwd: projectOptions.workingDirectoryPath,
                ...( this.isWindowsPlatform() ? { env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } } : {} )
            };

        }

        const execFileOptions: ExecFileOptionsWithStringEncoding = {
            encoding: 'utf8',
            maxBuffer: projectOptions?.maxBufferBytes ?? SALESFORCE_CLI_DEFAULT_MAX_BUFFER_BYTES,
            shell: invocation.useShell,
            windowsHide: true,
            ...projectExecFileOptions
        };

        return new Promise<ISalesforceCliInvocationResult>(resolve => {

            let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
            let hasAnswered = false;

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

                // A STRING CODE TOO, BUT THE CLI DID RUN: execFile KILLED IT FOR WRITING MORE THAN maxBuffer
                if ( errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ) {
                    hasAnswered = true;
                    if ( timeoutTimer !== undefined ) {
                        clearTimeout(timeoutTimer);
                    }
                    // ON WINDOWS execFile'S OWN KILL ENDS ONLY cmd.exe
                    this.killProcessTree(childProcess);
                    resolve({ stdout: '', stderr: stderr ?? '', exitCode: null, isOutputTooLarge: true });
                    return;
                }

                const spawnError = typeof errorCode === 'string' ? executionError as NodeJS.ErrnoException : undefined;
                const exitCode = typeof errorCode === 'number' ? errorCode : (executionError ? null : 0);

                hasAnswered = true;

                if ( timeoutTimer !== undefined ) {
                    clearTimeout(timeoutTimer);
                }

                resolve({
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    exitCode,
                    spawnError
                });

            });

            if ( timeoutMilliseconds !== undefined && !hasAnswered ) {
                timeoutTimer = setTimeout(() => {
                    this.killProcessTree(childProcess);
                    resolve({ stdout: '', stderr: '', exitCode: null, timedOut: true });
                }, timeoutMilliseconds);
            }

            if ( registerCancellation ) {
                registerCancellation(() => this.killProcessTree(childProcess));
            }

        });

    }

    // \\server\share, \\wsl.localhost\..., \\?\UNC\... -- AND THE SAME WITH FORWARD SLASHES
    static isUncPath(candidatePath: string): boolean {
        return typeof candidatePath === 'string' && /^[\\/]{2}/.test(candidatePath);
    }

    static buildUncWorkingDirectoryMessage(workingDirectoryPath: string): string {
        return `the project folder "${workingDirectoryPath}" is a network UNC path, and on Windows the Salesforce CLI runs through cmd.exe, which cannot start in one and would run in the Windows folder instead, outside the project. Nothing was run. Open the project from a drive letter by mapping the share to a drive, or reopen a WSL folder with the WSL extension, and try again.`;
    }

    /*
        The first "sf" on PATH (sf.cmd or sf.exe on Windows) as an absolute path. Relative entries,
        empty ones and any inside the working directory are skipped: each of those resolves against
        a directory the repository controls.
    */
    static findSalesforceCliOnPath(pathVariable: string, workingDirectoryPath: string): string | undefined {

        const executableNames = this.isWindowsPlatform() ? ['sf.cmd', 'sf.exe'] : ['sf'];
        const pathDelimiter = this.isWindowsPlatform() ? ';' : ':';
        const resolvedWorkingDirectoryPath = path.resolve(workingDirectoryPath);

        for ( const pathEntry of pathVariable.split(pathDelimiter) ) {

            const trimmedPathEntry = pathEntry.trim().replace(/^"(.*)"$/, '$1');

            if ( !trimmedPathEntry || !path.isAbsolute(trimmedPathEntry) ) {
                continue;
            }

            const resolvedPathEntry = path.resolve(trimmedPathEntry);
            const relativeToWorkingDirectory = path.relative(resolvedWorkingDirectoryPath, resolvedPathEntry);

            if ( relativeToWorkingDirectory === '' || ( !relativeToWorkingDirectory.startsWith('..') && !path.isAbsolute(relativeToWorkingDirectory) ) ) {
                continue;
            }

            for ( const executableName of executableNames ) {

                const candidatePath = path.join(resolvedPathEntry, executableName);

                try {
                    if ( fs.statSync(candidatePath).isFile() ) {
                        return candidatePath;
                    }
                } catch {
                    // NOT HERE -- THE NEXT PATH ENTRY
                }

            }

        }

        return undefined;

    }

    /*
        On Windows the CLI is cmd.exe's grandchild, so killing the child alone orphans the node
        process doing the work. taskkill /T ends the tree; its arguments are a numeric pid and
        constants, run without a shell. Elsewhere sf is the child itself, and a plain kill reaches it.
    */
    static killProcessTree(childProcess: Pick<ChildProcess, 'pid' | 'kill'>) {

        if ( this.isWindowsPlatform() && typeof childProcess.pid === 'number' ) {
            execFile('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
            return;
        }

        childProcess.kill();

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

    // THE FIRST NON-EMPTY STRING ALIAS AN AUTHORIZATION CARRIES -- ITS aliases COME FROM FILES ON DISK, SO NOTHING ELSE IS ASSUMED
    static readFirstAuthorizationAlias(authorization: OrgAuthorization | null | undefined): string | undefined {

        const aliases: unknown = authorization?.aliases;

        if ( !Array.isArray(aliases) ) {
            return undefined;
        }

        return aliases.find((alias: unknown): alias is string => typeof alias === 'string' && alias.length > 0);

    }

    static buildAuthenticatedOrgDetails(authorizations: OrgAuthorization[]): IAuthenticatedOrgDetail[] {

        if ( !Array.isArray(authorizations) ) {
            return [];
        }

        return authorizations.reduce((orgDetails: IAuthenticatedOrgDetail[], authorization) => {

            const username = authorization?.username;
            if ( typeof username !== 'string' || !username ) {
                return orgDetails;
            }

            const authorizationAlias = this.readFirstAuthorizationAlias(authorization);
            const targetOrgIdentifier = authorizationAlias || username;

            // AN UNUSABLE IDENTIFIER IS DROPPED HERE SO IT CANNOT REACH THE QUICK PICK AND THEN THE CLI
            if ( !this.isValidTargetOrgIdentifier(targetOrgIdentifier) ) {
                return orgDetails;
            }

            const alias = authorizationAlias;

            orgDetails.push({ targetOrgIdentifier, username, alias });

            return orgDetails;

        }, []);

    }

    /*
        A failing Apex test is not an error here -- its row carries the outcome and message the user
        needs to see. Only a run that produced no rows at all means nothing was checked.

        The rows are ApexTestResult records the org returned, so the list and every field are
        type-checked rather than trusted.
    */
    static buildCheckOutcomeByTestResults(testMethodResults: unknown): IPicklistDependencyCheckOutcome {

        if ( !Array.isArray(testMethodResults) ) {
            throw new Error('The org returned no readable Apex test results.');
        }

        if ( testMethodResults.length === 0 ) {
            throw new Error(`No ${this.getSpecsTestClassName()} test methods ran in the target org. The class may not be deployed, or it may contain no generated specs.`);
        }

        /*
            Every key is read case insensitively. Reading "Outcome" alone would make an unexpected
            casing render every method as failed, which is a false report of picklist dependency
            drift -- precisely the condition this command exists to detect truthfully.
        */
        const methodOutcomes: IPicklistDependencyMethodOutcome[] = testMethodResults.map((testMethodResult: unknown) => {

            const result: ISalesforceApexTestMethodResult = testMethodResult !== null && typeof testMethodResult === 'object'
                ? testMethodResult as ISalesforceApexTestMethodResult
                : {};

            const methodName = this.readStringField(result.MethodName) ?? this.readStringField(result.methodName) ?? 'unknown';
            const outcome = this.readStringField(result.Outcome) ?? this.readStringField(result.outcome);
            const message = this.readStringField(result.Message) ?? this.readStringField(result.message);

            return {
                methodName,
                passed: typeof outcome === 'string' && outcome.toLowerCase() === 'pass',
                message: message || undefined
            };

        });

        const failureCount = methodOutcomes.filter(methodOutcome => !methodOutcome.passed).length;

        return { passed: failureCount === 0, methodOutcomes, failureCount };

    }

    private static readStringField(fieldValue: unknown): string | undefined {
        return typeof fieldValue === 'string' ? fieldValue : undefined;
    }

    /*
        The longest the check waits for the org to finish the suite, as "sf apex run test --wait 10"
        did before #503. Generous for a spec registry while still bounding how long a wedged org side
        queue can hold the command open, and the run is cancellable throughout. A run still going
        when it runs out is left running in the org, as the CLI left it.
    */
    static readonly apexTestRunWaitMilliseconds = 10 * 60 * 1000;

    static apexTestRunPollIntervalMilliseconds = 2000;

    // HOW LONG A CANCEL WAITS FOR THE ORG TO TAKE THE ABORT BEFORE SAYING IT MAY STILL BE RUNNING
    static apexTestRunAbortTimeoutMilliseconds = 30 * 1000;

    private static deployWaitMinutes = '10';

    private static salesforceIdPattern = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

    // APEX TEST QUEUE ITEMS STILL WAITING OR RUNNING; ABORTING ANY OTHER IS REFUSED BY THE ORG
    private static abortableTestQueueItemStatuses = ['Holding', 'Queued', 'Preparing', 'Processing'];

    private static finishedTestRunStatuses = ['Completed', 'Failed', 'Aborted'];

    /*
        Runs the generated suite through the Tooling API on a @salesforce/core connection (#503): no
        sf process. The run is started with runTestsAsynchronous by SUITE, never by class name -- the
        suite is the handle this feature publishes, so a pipeline, Setup and this command all address
        the same one. Its AsyncApexJob is polled until it finishes or the wait runs out, and the
        outcome is read from its ApexTestResult rows.

        registerCancellation hands the caller a function that cancels the run. A cancel ABORTS the
        test job in the org (its ApexTestQueueItems are set to Aborted, as "sf apex run test"'s own
        abort does) rather than only stopping the wait, and ends in a
        PicklistDependencyTestRunCancelledError saying whether the abort landed.
    */
    static async runPicklistDependencyTests(targetOrgIdentifier: string,
                                            registerCancellation?: (cancelTestRun: () => void) => void): Promise<IPicklistDependencyCheckOutcome> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        let isCancellationRequested = false;
        let resolveCancellation: () => void = () => undefined;
        const whenCancelled = new Promise<'cancelled'>(resolve => {
            resolveCancellation = () => resolve('cancelled');
        });

        registerCancellation?.(() => {
            isCancellationRequested = true;
            resolveCancellation();
        });

        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        const whenTimedOut = new Promise<'timedOut'>(resolve => {
            deadlineTimer = setTimeout(() => resolve('timedOut'), this.apexTestRunWaitMilliseconds);
        });

        try {

            const connection = await SalesforceOrgService.getConnection(targetOrgIdentifier);

            if ( isCancellationRequested ) {
                throw new PicklistDependencyTestRunCancelledError(`Picklist dependency check cancelled before the test run started. Nothing was run in "${targetOrgIdentifier}".`);
            }

            // NOT RACED: A RUN THE ORG STARTED AFTER A CANCEL STILL HAS TO BE ABORTED, SO ITS ID IS WAITED FOR
            const startAnswer: unknown = await connection.tooling.runTestsAsynchronous({ suiteNames: this.getSpecsTestSuiteName() });
            const testRunId = this.readTestRunId(startAnswer);

            const raceWithStop = <T>(request: Promise<T>, isDeadlineApplied: boolean): Promise<T | 'cancelled' | 'timedOut'> => {
                request.catch(() => undefined);
                return Promise.race([request, whenCancelled, ...( isDeadlineApplied ? [whenTimedOut] : [] )]);
            };

            let finishedStatus: ITestRunStatus | undefined;

            while ( !finishedStatus ) {

                if ( isCancellationRequested ) {
                    break;
                }

                const status = await raceWithStop(this.readTestRunStatus(connection, testRunId), true);

                if ( status === 'cancelled' ) {
                    break;
                }

                if ( status === 'timedOut' ) {
                    throw new Error(this.buildTestRunTimedOutMessage(targetOrgIdentifier, testRunId));
                }

                if ( status && this.finishedTestRunStatuses.includes(status.status) ) {
                    finishedStatus = status;
                    break;
                }

                const pause = await raceWithStop(new Promise<'paused'>(resolve => setTimeout(() => resolve('paused'), this.apexTestRunPollIntervalMilliseconds)), true);

                if ( pause === 'timedOut' ) {
                    throw new Error(this.buildTestRunTimedOutMessage(targetOrgIdentifier, testRunId));
                }

            }

            if ( !finishedStatus ) {
                throw new PicklistDependencyTestRunCancelledError(await this.abortTestRun(connection, testRunId, targetOrgIdentifier));
            }

            if ( finishedStatus.status === 'Aborted' ) {
                throw new Error(`The picklist dependency test run ${testRunId} was aborted in "${targetOrgIdentifier}" before it finished, so nothing was checked. Run the command again.`);
            }

            const testResults = await raceWithStop(this.readTestResults(connection, testRunId), false);

            if ( testResults === 'cancelled' || testResults === 'timedOut' ) {
                throw new PicklistDependencyTestRunCancelledError(`Picklist dependency check cancelled. The test run ${testRunId} had already finished in "${targetOrgIdentifier}", so there was nothing to abort; its results were not read.`);
            }

            // A FAILED JOB WITH NO ROWS SAYS WHY ONLY IN ITS ExtendedStatus
            if ( finishedStatus.status === 'Failed' && testResults.length === 0 ) {
                const failureDetail = finishedStatus.extendedStatus ? `: ${finishedStatus.extendedStatus}` : '.';
                throw new Error(`The picklist dependency test run ${testRunId} failed in "${targetOrgIdentifier}" without running a test method${failureDetail}`);
            }

            return this.buildCheckOutcomeByTestResults(testResults);

        } finally {

            if ( deadlineTimer !== undefined ) {
                clearTimeout(deadlineTimer);
            }

        }

    }

    // runTestsAsynchronous ANSWERS THE AsyncApexJob ID AS A BARE STRING; ANYTHING ELSE IS NOT QUOTED INTO A QUERY
    static readTestRunId(startAnswer: unknown): string {

        const testRunId = typeof startAnswer === 'string' ? startAnswer.trim().replace(/^"(.*)"$/, '$1') : undefined;

        if ( !testRunId || !this.salesforceIdPattern.test(testRunId) ) {
            throw new Error(`The org did not start the ${this.getSpecsTestSuiteName()} test suite: it returned no test run id.`);
        }

        return testRunId;

    }

    static buildTestRunTimedOutMessage(targetOrgIdentifier: string, testRunId: string): string {

        const waitMinutes = this.apexTestRunWaitMilliseconds / 60000;

        return `The picklist dependency test run ${testRunId} did not finish within ${waitMinutes} minutes in "${targetOrgIdentifier}", so no results were written. It is still running there; see Setup > Apex Test Execution, or run the command again once it has finished.`;

    }

    // UNDEFINED WHILE THE JOB IS NOT VISIBLE YET; AN ANSWER WITH NO RECORDS LIST THROWS RATHER THAN READING AS "NOT FINISHED"
    static async readTestRunStatus(connection: Connection, testRunId: string): Promise<ITestRunStatus | undefined> {

        const queryResult: unknown = await connection.query(`SELECT Status, ExtendedStatus FROM AsyncApexJob WHERE Id = '${testRunId}'`);
        const records = this.readRecords(queryResult);
        const jobRecord: unknown = records[0];

        if ( jobRecord === null || typeof jobRecord !== 'object' ) {
            return undefined;
        }

        const status = this.readStringField((jobRecord as { Status?: unknown }).Status);

        if ( !status ) {
            return undefined;
        }

        return { status, extendedStatus: this.readStringField((jobRecord as { ExtendedStatus?: unknown }).ExtendedStatus) || undefined };

    }

    static async readTestResults(connection: Connection, testRunId: string): Promise<unknown[]> {

        const testResults: unknown[] = [];

        let queryResult: unknown = await connection.tooling.query(
            `SELECT MethodName, Outcome, Message, ApexClass.Name FROM ApexTestResult WHERE AsyncApexJobId = '${testRunId}' ORDER BY ApexClass.Name, MethodName`
        );

        testResults.push(...this.readRecords(queryResult));

        while ( this.readNextRecordsUrl(queryResult) ) {
            queryResult = await connection.tooling.queryMore(this.readNextRecordsUrl(queryResult) as string);
            testResults.push(...this.readRecords(queryResult));
        }

        return testResults;

    }

    private static readRecords(queryResult: unknown): unknown[] {

        const records = queryResult !== null && typeof queryResult === 'object' ? (queryResult as { records?: unknown }).records : undefined;

        if ( !Array.isArray(records) ) {
            throw new Error('The org returned an answer with no records list.');
        }

        return records;

    }

    private static readNextRecordsUrl(queryResult: unknown): string | undefined {

        const answer = queryResult as { done?: unknown; nextRecordsUrl?: unknown };

        return answer.done === false && typeof answer.nextRecordsUrl === 'string' && answer.nextRecordsUrl ? answer.nextRecordsUrl : undefined;

    }

    /*
        Sets every queue item of the run that is still waiting or running to Aborted -- what Setup's
        Abort and the CLI's own abort do. Answers the sentence the cancel reports, never throws: a
        cancel always ends the check, and the sentence says whether the org stopped the run.
    */
    static async abortTestRun(connection: Connection, testRunId: string, targetOrgIdentifier: string): Promise<string> {

        const notAbortedMessage = `Picklist dependency check cancelled, but the test run ${testRunId} could not be aborted in "${targetOrgIdentifier}" and may still be running there. Abort it from Setup > Apex Test Execution.`;

        const abort = async (): Promise<string> => {

            const abortableStatuses = this.abortableTestQueueItemStatuses.map(status => `'${status}'`).join(', ');
            const queryResult: unknown = await connection.tooling.query(
                `SELECT Id, Status FROM ApexTestQueueItem WHERE ParentJobId = '${testRunId}' AND Status IN (${abortableStatuses})`
            );

            const queueItemIds = this.readRecords(queryResult)
                .map((record: unknown) => record !== null && typeof record === 'object' ? (record as { Id?: unknown }).Id : undefined)
                .filter((queueItemId): queueItemId is string => typeof queueItemId === 'string' && this.salesforceIdPattern.test(queueItemId));

            if ( queueItemIds.length === 0 ) {
                return `Picklist dependency check cancelled. The test run ${testRunId} had already finished in "${targetOrgIdentifier}", so there was nothing to abort.`;
            }

            const saveResults: unknown[] = [];

            for ( const queueItemId of queueItemIds ) {
                saveResults.push(await connection.tooling.update('ApexTestQueueItem', { Id: queueItemId, Status: 'Aborted' }));
            }

            const isEveryItemAborted = saveResults.every(saveResult => saveResult !== null && typeof saveResult === 'object' && (saveResult as { success?: unknown }).success === true);

            return isEveryItemAborted
                ? `Picklist dependency check cancelled. The test run ${testRunId} was aborted in "${targetOrgIdentifier}" (${queueItemIds.length} queued test class(es) stopped).`
                : notAbortedMessage;

        };

        let abortTimer: ReturnType<typeof setTimeout> | undefined;

        try {

            const abortRequest = abort();
            abortRequest.catch(() => undefined);

            return await Promise.race([
                abortRequest,
                new Promise<string>(resolve => {
                    abortTimer = setTimeout(() => resolve(notAbortedMessage), this.apexTestRunAbortTimeoutMilliseconds);
                })
            ]);

        } catch {
            return notAbortedMessage;
        } finally {
            if ( abortTimer !== undefined ) {
                clearTimeout(abortTimer);
            }
        }

    }

    /*
        The org is queried rather than deployed to blindly so the user is only prompted when a deploy
        is actually needed. A query failure is treated as "not deployed" -- prompting to deploy
        something already present is recoverable, silently skipping a required deploy is not.

        MEMBERSHIP is what is asked about, not the suite's existence. A suite whose member class has
        been deleted still exists, and a run of the suite against it runs zero tests
        and reports success -- a green check that verified nothing, which is the exact failure mode
        the generated specRegistryIsNotEmpty guard exists to prevent one layer down. One query over
        TestSuiteMembership answers "is the suite there AND does it still contain the generated test
        class", which is the only state in which the check is meaningful.

        TestSuiteMembership is a Tooling API object, so it is asked through the connection's tooling
        query rather than its plain one. The connection is @salesforce/core's (#497): no sf process.
        A failed connection or query, or an answer with no records list, is read as "not deployed".
    */
    static async isSpecsTestSuiteDeployedInOrg(targetOrgIdentifier: string): Promise<boolean> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        const testSuiteMembershipQuery = `SELECT Id FROM TestSuiteMembership`
                                            + ` WHERE ApexTestSuite.TestSuiteName = '${this.getSpecsTestSuiteName()}'`
                                            + ` AND ApexClass.Name = '${this.getSpecsTestClassName()}' LIMIT 1`;

        try {

            const connection = await SalesforceOrgService.getConnection(targetOrgIdentifier);
            const queryResult: unknown = await connection.tooling.query(testSuiteMembershipQuery);
            const records = queryResult !== null && typeof queryResult === 'object' ? (queryResult as { records?: unknown }).records : undefined;

            return Array.isArray(records) && records.length > 0;

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

    /*
        Everything this command deploys: the Apex classes, plus the test suite that names the test
        class among them.

        Separate from getPicklistDependencyClassFilePaths so that method keeps returning only
        classes and stays honest about its name. The suite is not optional here -- the run invokes
        "--suite-names", so a deploy that sent the classes without it would succeed and then fail at
        the very next step with the CLI's own wording about an unknown suite.
    */
    static getPicklistDependencySourceFilePaths(classesDirectoryPath: string): string[] {

        const testSuiteFilePath = PicklistDependencyTestService.getTestSuiteFilePath(classesDirectoryPath);

        return [
            ...this.getPicklistDependencyClassFilePaths(classesDirectoryPath),
            ...(fs.existsSync(testSuiteFilePath) ? [testSuiteFilePath] : [])
        ];

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

        const classFilePathsToDeploy = this.getPicklistDependencySourceFilePaths(classesDirectoryPath);

        if ( classFilePathsToDeploy.length === 0 ) {
            throw new Error(`No picklist dependency classes were found in "${classesDirectoryPath}". Run "Generate Picklist Dependency Tests" first, then run the command again.`);
        }

        /*
            The suite is REQUIRED, not merely included when present.

            The run invokes "--suite-names", so a deploy that sent the classes without the suite
            would succeed and then fail at the very next step with the CLI's own wording about an
            unknown suite -- with nothing to tell the user that regenerating is what fixes it.

            This is the ordinary upgrade path rather than a corner case: a workspace generated
            before the suite existed has every class and no suite, so the org check reports "not
            deployed", the deploy is offered and accepted, and the run then fails. Refusing here,
            before the confirmation is built, turns that into one actionable message.
        */
        const testSuiteFilePath = PicklistDependencyTestService.getTestSuiteFilePath(classesDirectoryPath);

        if ( !fs.existsSync(testSuiteFilePath) ) {
            throw new Error(`No Apex test suite was found at "${testSuiteFilePath}". The check runs the ${this.getSpecsTestSuiteName()} test suite, so it cannot run without it -- a workspace generated by an earlier version has the classes but not the suite. Run "Generate Picklist Dependency Tests" again to add it, then run the command again.`);
        }

        return classFilePathsToDeploy;

    }

    /*
        Deploys named source paths to an org.

        Split out of deployPicklistDependencyClasses so the metadata writeback command can reuse the
        CLI plumbing, the wait, the json parsing and the source-tracking conflict wording without
        pretending its changed field files are Apex classes. That method now supplies the class paths
        and this one does the deploy, so there is one place that knows how a deploy is invoked.
    */
    static async deploySourcePaths(sourceFilePaths: string[],
                                    targetOrgIdentifier: string,
                                    registerCancellation?: (killChildProcess: () => void) => void): Promise<string> {

        this.assertValidTargetOrgIdentifier(targetOrgIdentifier);

        if ( sourceFilePaths.length === 0 ) {
            throw new Error('There are no source files to deploy.');
        }

        const sourceDirArguments = sourceFilePaths.flatMap(sourceFilePath => ['--source-dir', sourceFilePath]);

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

        throw new Error(this.buildDeployFailureMessage(parsedCliOutput, targetOrgIdentifier, 'The changed field metadata'));

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
        throw new Error(this.buildDeployFailureMessage(parsedCliOutput, targetOrgIdentifier, 'The picklist dependency classes'));

    }

    /*
        Why a deploy failed, in the CLI's terms plus what to do about it.

        Shared by both deploy entry points and phrased around what was being deployed, so the
        writeback command can report a failed field-metadata deploy without claiming Apex classes
        were involved.
    */
    static buildDeployFailureMessage(parsedCliOutput: ISalesforceDeployCliOutput | undefined, targetOrgIdentifier: string, deployedSubject: string): string {

        /*
            An org with source tracking rejects the deploy outright when it sees the source as
            changed on both sides, and the CLI's own wording ("N conflicts detected") does not say
            what to do about it. Conflicts are not forced past automatically -- the org copy may hold
            edits worth keeping, and these commands exist to report drift rather than overwrite it.
        */
        if ( parsedCliOutput?.name === 'SourceConflictError' ) {
            return `${deployedSubject} conflict with the copies already in "${targetOrgIdentifier}". Retrieve or resolve them first, or deploy manually with "sf project deploy start --ignore-conflicts" if the local copies should win.`;
        }

        const componentFailures = parsedCliOutput?.result?.details?.componentFailures;
        const normalizedComponentFailures = Array.isArray(componentFailures) ? componentFailures : [componentFailures].filter(Boolean);

        if ( normalizedComponentFailures.length > 0 ) {
            const failureSummary = normalizedComponentFailures
                .map(componentFailure => `${componentFailure.fullName}: ${componentFailure.problem}`)
                .join('; ');
            return `${deployedSubject} failed to deploy: ${failureSummary}`;
        }

        const cliErrorDetail = [parsedCliOutput?.name, parsedCliOutput?.message].filter(Boolean).join(': ');

        return cliErrorDetail || `${deployedSubject} failed to deploy for an unknown reason.`;

    }

    /*
        The confirmation names every file that will be sent. The framework classes are scaffolded only
        when absent, so a workspace carrying its own copy of one deploys that copy -- the user has to
        be able to see which files those are before approving.
    */
    static buildDeployConfirmationMessage(classesDirectoryPath: string,
                                          targetOrgIdentifier: string,
                                          deployReason: PicklistDependencyDeployReason): string {

        const classFileNames = this.getPicklistDependencySourceFilePaths(classesDirectoryPath)
            .map(classFilePath => path.basename(classFilePath));

        /*
            The opening line is the only thing a user has to reason about before approving a deploy,
            so it has to describe why THIS one is happening. The check command looked the test class
            up and did not find it. The end to end command has just rewritten the classes and never
            looked, so claiming the class "was not found" there tells a user whose class is deployed
            that it is missing -- and invites them to conclude their last deploy failed.
        */
        const deployReasonLine = deployReason === 'specsTestSuiteAbsentFromOrg'
            ? `The ${this.getSpecsTestSuiteName()} test suite in "${targetOrgIdentifier}" does not exist, or no longer contains ${this.getSpecsTestClassName()}.`
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
