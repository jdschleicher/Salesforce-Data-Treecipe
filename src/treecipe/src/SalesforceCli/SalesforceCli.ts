import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, execFile, ExecFileOptionsWithStringEncoding } from 'child_process';
import type { OrgAuthorization } from '@salesforce/core';

/*
    The one place an sf process starts. It sits in the platform layer so the services below the
    features can run the CLI without importing one. Every caller is listed in
    tests/SalesforceCliCallSites.test.ts.
*/

export interface IAuthenticatedOrgDetail {
    // THE ALIAS WHEN ONE IS SET, OTHERWISE THE USERNAME -- BOTH ARE ACCEPTED BY "sf --target-org"
    targetOrgIdentifier: string;
    username: string;
    alias?: string;
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

export class SalesforceCli {

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

}
