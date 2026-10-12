import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, ISalesforceCliProjectOptions, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IDevHubOrgDetail } from '../SalesforceOrgService/SalesforceOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

// AN ALIAS THE CLI KEEPS IN ~/.sfdx/alias.json AND THE READER TYPES BACK: LONG ENOUGH FOR A NAME, SHORT ENOUGH FOR A PICKER
export const SCRATCH_ORG_ALIAS_MAX_LENGTH = 80;

// WHAT AN https: URL FROM "sf org open --url-only" MAY BE, BEFORE IT IS HANDED TO THE READER'S BROWSER
export const ORG_OPEN_URL_PROTOCOL = 'https:';

export const ORG_OPEN_TIMEOUT_MILLISECONDS = 60000;

// WINDOWS RESERVES THESE AS DEVICE NAMES, WITH OR WITHOUT AN EXTENSION: A FOLDER BY THAT NAME CANNOT BE MADE
export const WINDOWS_RESERVED_FOLDER_NAME_PATTERN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export const SCRATCH_ORG_DURATION_DAYS = 7;

export const SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH = path.join('config', 'project-scratch-def.json');

export const ORG_OPERATIONS_FOLDER_NAME = 'OrgOperations';

export type OrgOperationName = 'scratch-create' | 'scratch-deploy' | 'metadata-deploy' | 'permission-set-deploy' | 'permission-set-assign';

export type ScratchOrgSetupPhase = 'creating' | 'deploying';

// A DEPLOY'S --json LISTS EVERY FILE AND COMPONENT, SO A LARGE PROJECT'S ANSWER OUTGROWS THE 8 MB OTHER COMMANDS USE
export const SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES = 1024 * 1024 * 256;

// WHAT A SAVED RESULT NEVER CARRIES: THE CREATE'S authFields WHOLE, AND ANY KEY THAT NAMES A CREDENTIAL ANYWHERE ELSE
export const ORG_OPERATION_REDACTED_KEYS: readonly string[] = ['authFields'];

export const ORG_OPERATION_SECRET_KEY_PATTERN = /token|password|secret|privatekey|sfdxauthurl|authcode/i;

export const ORG_OPERATION_RESULT_FILE_ATTEMPTS = 100;

export const ORG_OPERATION_REDACTED_VALUE = '[redacted by Salesforce Data Treecipe]';

/*
    What the repository's own files decide about the org, named in the confirmation because the
    reader confirms them: a definition file can set the admin's email and the username (so whoever
    wrote it may be able to take over the org through a password reset), and sfdx-project.json's
    replacements can copy local files or environment variables into the deployed metadata.
*/
export interface IScratchOrgDefinitionSummary {
    edition?: string;
    adminEmail?: string;
    username?: string;
}

/*
    Everything a scratch org setup uses, resolved on the HOST from the workspace and the Dev Hub the
    reader picked -- the panel names none of it. The confirmation lists exactly this.
*/
export interface IScratchOrgPlan {
    workspaceRoot: string;
    definitionFilePath: string;
    definitionFileRelativePath: string;
    // AS sfdx-project.json DECLARES THEM: THE CLI RESOLVES THEM ITSELF, SINCE THE DEPLOY NAMES NO --source-dir
    packageDirectoryPaths: string[];
    devHub: IDevHubOrgDetail;
    // THE READER'S OWN (#279): NO DEFAULT, AND CHECKED AGAIN HERE WHATEVER THE INPUT BOX ALREADY SAID
    alias: string;
    // ANOTHER AUTHORIZED ORG HOLDING THE ALIAS NOW: THE CLI RE-POINTS IT TO THE NEW ORG, AND THE MODAL SAYS SO
    aliasHolderUsername?: string;
    durationDays: number;
    definitionSummary: IScratchOrgDefinitionSummary;
    hasFileOrEnvironmentReplacements: boolean;
}

// WHAT THE READER ANSWERED IN THE ALIAS BOX, AND WHICH ORG HOLDS THAT ALIAS NOW, IF ANY
export interface IScratchOrgAliasChoice {
    alias: string;
    aliasHolderUsername?: string;
}

export type OrgOpenParseResult =
    { isOpenable: true; url: string }
    | { isOpenable: false; failureMessage: string };

export type ScratchOrgCreateParseResult =
    { isCreated: true; username: string }
    | { isCreated: false; failureMessage: string };

/*
    What a deploy's --json says about its components, shared by the scratch org deploy (#200) and
    the cockpit's missing-metadata deploy (#211). The package.xml entry the CLI lists among the
    successes is not a component anyone asked for, so it is not counted.
*/
export interface IDeployComponentCounts {
    isSucceeded: boolean;
    componentSuccessCount: number;
    componentFailureCount: number;
    componentFailureProblems: string[];
    numberComponentsDeployed?: number;
}

export type SourceDeployParseResult =
    { isDeployed: true; deployedComponentCount: number }
    | { isDeployed: false; componentFailureCount: number; failureMessage: string };

/*
    How a setup ended. Once a username exists the org is KEPT whatever happened next -- nothing here
    deletes one -- so every outcome past the create carries it, for the caller to list and select.
*/
export type ScratchOrgSetupOutcome =
    { kind: 'createFailed'; failureMessage: string; outputFilePath?: string }
    | { kind: 'createCancelled' }
    | { kind: 'deployed'; username: string; deployedComponentCount: number; outputFilePath?: string }
    | { kind: 'deployFailed'; username: string; componentFailureCount: number; failureMessage: string; outputFilePath?: string }
    // THE DEPLOY RAN BUT ITS ANSWER WAS TOO LARGE TO READ: IT MAY WELL HAVE SUCCEEDED, SO IT IS NOT REPORTED AS FAILED
    | { kind: 'deployUnconfirmed'; username: string }
    // isDeployStarted IS FALSE FOR A CANCEL THAT LANDED BETWEEN THE CREATE AND THE DEPLOY
    | { kind: 'deployCancelled'; username: string; isDeployStarted: boolean };

export interface IScratchOrgSetupHooks {
    onPhase: (phase: ScratchOrgSetupPhase) => void;
    // CALLED ONCE PER PROCESS WITH WHAT KILLS IT
    registerCancellation: (killChildProcess: () => void) => void;
    isCancellationRequested: () => boolean;
    now?: () => Date;
}

/*
    Creates a scratch org through the Dev Hub the reader picked (#243) and deploys the project's
    source to it (#200). It imports no vscode itself: the cockpit owns the confirmation, the progress and the panel, and this
    service owns the argv, the reading of the CLI's --json answer and the result files.

    Every process goes through PicklistDependencyCheckService.runSalesforceCli -- execFile with an
    argv, no shell except the quoted one Windows' sf.cmd shim needs. Nothing here ever runs
    "sf org delete": an org this creates is the reader's to keep or delete.
*/
export class ScratchOrgService {

    // LOCAL TIME: A RESULT FILE'S NAME IS READ BY A PERSON
    static buildCompactTimestamp(date: Date): string {

        const twoDigits = (value: number) => String(value).padStart(2, '0');

        return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`;

    }

    /*
        Why an alias cannot be used, or undefined when it can (#279). It is an argv value, the
        folder a failed create's result is saved under, and a name the CLI resolves --target-org
        against, so it is held to all three: an identifier the CLI is handed elsewhere, a folder
        name that names no other folder, and no "@", which would read as a username. It starts with
        a letter or digit and does not end with ".", which Windows strips from a folder name, and it
        is not a Windows device name, which no folder can have.
    */
    static validateScratchOrgAlias(alias: unknown): string | undefined {

        if ( typeof alias !== 'string' || alias === '' ) {
            return 'Enter an alias for the new scratch org.';
        }

        if ( alias.length > SCRATCH_ORG_ALIAS_MAX_LENGTH ) {
            return `An alias is at most ${SCRATCH_ORG_ALIAS_MAX_LENGTH} characters.`;
        }

        if ( alias.includes('@') ) {
            return 'An alias cannot contain "@", which would read as a username.';
        }

        if ( !PicklistDependencyCheckService.isValidTargetOrgIdentifier(alias)
                || !this.isUsableOrgOperationFolderName(alias)
                || !/^[A-Za-z0-9]/.test(alias)
                || alias.endsWith('.') ) {
            return 'An alias is letters, digits and . _ + -, starts with a letter or digit, and does not end with ".".';
        }

        if ( WINDOWS_RESERVED_FOLDER_NAME_PATTERN.test(alias) ) {
            return `"${alias}" is a name Windows reserves for a device, so it cannot be an alias.`;
        }

        return undefined;

    }

    /*
        Refuses, before any process, every input the setup cannot run with: the project file, then
        the definition file. Both are checked BEFORE the Dev Hub is asked for, so a project that
        cannot be deployed refuses without a picker. No Dev Hub chosen is no plan: undefined, and
        nothing was started. The definition path is fixed, and still checked to resolve inside the
        workspace, because config/ can be a symlink out of it.
    */
    static async resolveScratchOrgPlan(workspaceRoot: string,
                                        chooseDevHub: () => Promise<IDevHubOrgDetail | undefined>,
                                        chooseAlias: (devHub: IDevHubOrgDetail) => Promise<IScratchOrgAliasChoice | undefined>): Promise<IScratchOrgPlan | undefined> {

        const packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const definitionFilePath = path.join(resolvedWorkspaceRoot, SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH);

        if ( !SfdxProjectService.isPathContainedInWorkspace(definitionFilePath, resolvedWorkspaceRoot) ) {
            throw new Error(`The scratch org definition file "${SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH}" resolves outside this workspace, so no scratch org was created.`);
        }

        if ( !SfdxProjectService.isExistingFile(definitionFilePath) ) {
            throw new Error(`No scratch org definition file found at "${definitionFilePath}", so no scratch org was created. Add "${SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH}" to the project and try again.`);
        }

        const devHub = await chooseDevHub();

        if ( !devHub ) {
            return undefined;
        }

        // NO ALIAS IS NO PLAN, LIKE NO DEV HUB: ESCAPE IN THE BOX IS A CANCEL
        const aliasChoice = await chooseAlias(devHub);

        if ( !aliasChoice ) {
            return undefined;
        }

        const aliasRefusal = this.validateScratchOrgAlias(aliasChoice.alias);

        if ( aliasRefusal ) {
            throw new Error(`No scratch org was created: ${aliasRefusal}`);
        }

        return {
            workspaceRoot: resolvedWorkspaceRoot,
            definitionFilePath: definitionFilePath,
            definitionFileRelativePath: SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH,
            packageDirectoryPaths: packageDirectoryPaths,
            devHub: devHub,
            alias: aliasChoice.alias,
            ...( aliasChoice.aliasHolderUsername ? { aliasHolderUsername: aliasChoice.aliasHolderUsername } : {} ),
            durationDays: SCRATCH_ORG_DURATION_DAYS,
            definitionSummary: this.readDefinitionSummary(definitionFilePath),
            hasFileOrEnvironmentReplacements: SfdxProjectService.hasFileOrEnvironmentReplacements(resolvedWorkspaceRoot)
        };

    }

    // ONLY STRING VALUES, AND NONE AT ALL FROM A FILE THE CLI WILL REFUSE ANYWAY
    static readDefinitionSummary(definitionFilePath: string): IScratchOrgDefinitionSummary {

        let definition: unknown;

        try {
            definition = JSON.parse(fs.readFileSync(definitionFilePath, 'utf-8'));
        } catch {
            return {};
        }

        if ( definition === null || typeof definition !== 'object' || Array.isArray(definition) ) {
            return {};
        }

        const readString = (key: string) => {
            const value = ( definition as Record<string, unknown> )[key];
            return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
        };

        return { edition: readString('edition'), adminEmail: readString('adminEmail'), username: readString('username') };

    }

    static buildScratchOrgCreateArguments(scratchOrgPlan: IScratchOrgPlan): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(scratchOrgPlan.alias);
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(scratchOrgPlan.devHub.username);

        return [
            'org', 'create', 'scratch',
            // RELATIVE TO THE WORKSPACE THE CLI RUNS IN, SO NO PATH OF THE READER'S MACHINE REACHES cmd.exe'S %VAR% EXPANSION
            '--definition-file', scratchOrgPlan.definitionFileRelativePath,
            '--alias', scratchOrgPlan.alias,
            '--duration-days', String(scratchOrgPlan.durationDays),
            // THE USERNAME, NOT AN ALIAS: AN ALIAS CAN BE RE-POINTED BETWEEN THE PICK AND THE RUN
            '--target-dev-hub', scratchOrgPlan.devHub.username,
            '--json'
        ];

    }

    /*
        No --source-dir, so the CLI deploys every package directory sfdx-project.json names, and no
        --ignore-errors, so the deploy is all or nothing: one failing component rolls it back. The
        target is the USERNAME the create answered with, never the alias: the reader chose the
        alias (#279), and an alias can be re-pointed between the create and the deploy.
    */
    static buildSourceDeployArguments(username: string): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(username);

        return ['project', 'deploy', 'start', '--target-org', username, '--json'];

    }

    // --url-only: THE EXTENSION OPENS THE URL ITSELF, WHICH ALSO WORKS WHERE THE CLI HAS NO BROWSER (REMOTE, WSL, CODESPACES)
    static buildOrgOpenArguments(username: string): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(username);

        return ['org', 'open', '--target-org', username, '--url-only', '--json'];

    }

    // NOT PROJECT MODE: NO cwd, SO sf IS FOUND ON PATH THE WAY "sf org list" FINDS IT
    static async resolveOrgOpenUrl(username: string): Promise<OrgOpenParseResult> {

        const invocationResult = await PicklistDependencyCheckService.runSalesforceCli(this.buildOrgOpenArguments(username), undefined, ORG_OPEN_TIMEOUT_MILLISECONDS);

        return this.parseOrgOpenOutput(invocationResult);

    }

    /*
        "sf org open --url-only --json" (#279). The answer is untrusted and the URL carries a
        session id, so it is only ever handed to the browser: openable on status 0 and a result.url
        that parses as https:, and a failure message never quotes it.
    */
    static parseOrgOpenOutput(invocationResult: ISalesforceCliInvocationResult): OrgOpenParseResult {

        if ( invocationResult.spawnError ) {
            return {
                isOpenable: false,
                failureMessage: invocationResult.spawnError.code === 'ENOENT'
                    ? `The Salesforce CLI ("${PicklistDependencyCheckService.getSalesforceCliExecutable()}") is required to open an org, and it is not installed or not on PATH. Install it and try again.`
                    : `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}`
            };
        }

        if ( invocationResult.timedOut ) {
            return { isOpenable: false, failureMessage: 'The Salesforce CLI did not answer in time.' };
        }

        const payload = this.readCliJsonPayload(invocationResult);
        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result) ? payload.result as Record<string, unknown> : undefined;
        const url = result?.url;

        if ( payload?.status === 0 && typeof url === 'string' ) {

            let parsedUrl: URL | undefined;

            try {
                parsedUrl = new URL(url);
            } catch {
                parsedUrl = undefined;
            }

            return parsedUrl && parsedUrl.protocol === ORG_OPEN_URL_PROTOCOL
                ? { isOpenable: true, url: parsedUrl.toString() }
                : { isOpenable: false, failureMessage: 'The Salesforce CLI answered with an address that is not https, so it was not opened.' };

        }

        if ( payload?.status === 0 ) {
            return { isOpenable: false, failureMessage: 'The Salesforce CLI answered without an address to open.' };
        }

        return { isOpenable: false, failureMessage: this.redactSecretText(this.buildCliFailureDetail(payload, invocationResult)) };

    }

    static buildCliRequiredMessage(): string {

        return `The Salesforce CLI ("${PicklistDependencyCheckService.getSalesforceCliExecutable()}") is required to create a scratch org, and it is not installed or not on PATH. Install it and try again.`;

    }

    // THE CLI'S --json IS UNTRUSTED: ANYTHING THAT IS NOT AN OBJECT IS NO ANSWER AT ALL
    static readCliJsonPayload(invocationResult: ISalesforceCliInvocationResult): Record<string, unknown> | undefined {

        try {
            const parsedPayload: unknown = JSON.parse(invocationResult.stdout);
            return parsedPayload !== null && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)
                ? parsedPayload as Record<string, unknown>
                : undefined;
        } catch {
            return undefined;
        }

    }

    // THE CLI'S OWN WORDS FOR A FAILURE: ITS name AND message, ELSE stderr, ELSE THE EXIT STATUS
    static buildCliFailureDetail(payload: Record<string, unknown> | undefined, invocationResult: ISalesforceCliInvocationResult): string {

        const payloadDetail = [payload?.name, payload?.message]
            .filter((detailPart): detailPart is string => typeof detailPart === 'string' && detailPart.trim() !== '')
            .join(': ');

        if ( payloadDetail ) {
            return payloadDetail;
        }

        const stderrDetail = typeof invocationResult.stderr === 'string' ? invocationResult.stderr.trim() : '';
        const exitDetail = invocationResult.timedOut
            ? 'it timed out'
            : invocationResult.exitCode === null ? 'it was terminated by a signal' : `exit code ${invocationResult.exitCode}`;

        return stderrDetail
            ? `${stderrDetail} (${exitDetail})`
            : `The Salesforce CLI did not return usable JSON (${exitDetail}).`;

    }

    /*
        Created only when the CLI says status 0 AND names a username that could be handed back to
        it. Anything else -- a non-zero status, output that is not JSON, a username that is not
        one -- is a failure, never a success with nothing to select.
    */
    static parseScratchOrgCreateOutput(invocationResult: ISalesforceCliInvocationResult,
                                        payload: Record<string, unknown> | undefined = this.readCliJsonPayload(invocationResult)): ScratchOrgCreateParseResult {

        if ( invocationResult.spawnError ) {
            return { isCreated: false, failureMessage: invocationResult.spawnError.code === 'ENOENT' ? this.buildCliRequiredMessage() : `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        if ( invocationResult.isOutputTooLarge ) {
            return { isCreated: false, failureMessage: 'The Salesforce CLI\'s answer was too large to read, so whether a scratch org was created is unknown: check with "sf org list".' };
        }

        const result = payload?.result;
        const username = result !== null && typeof result === 'object' ? ( result as Record<string, unknown> ).username : undefined;

        if ( payload?.status === 0 && typeof username === 'string' && PicklistDependencyCheckService.isValidTargetOrgIdentifier(username) ) {
            return { isCreated: true, username: username };
        }

        if ( payload?.status === 0 ) {
            return { isCreated: false, failureMessage: 'The Salesforce CLI reported the scratch org created but named no usable username for it.' };
        }

        return { isCreated: false, failureMessage: this.buildCliFailureDetail(payload, invocationResult) };

    }

    static parseSourceDeployOutput(invocationResult: ISalesforceCliInvocationResult,
                                    payload: Record<string, unknown> | undefined = this.readCliJsonPayload(invocationResult)): SourceDeployParseResult {

        if ( invocationResult.spawnError ) {
            return { isDeployed: false, componentFailureCount: 0, failureMessage: invocationResult.spawnError.code === 'ENOENT' ? this.buildCliRequiredMessage() : `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        const deployComponentCounts = this.readDeployComponentCounts(payload);
        const componentFailureCount = deployComponentCounts.componentFailureCount;

        if ( deployComponentCounts.isSucceeded ) {
            return { isDeployed: true, deployedComponentCount: deployComponentCounts.numberComponentsDeployed ?? deployComponentCounts.componentSuccessCount };
        }

        return { isDeployed: false, componentFailureCount: componentFailureCount, failureMessage: this.buildCliFailureDetail(payload, invocationResult) };

    }

    // A DEPLOY SUCCEEDED ONLY ON status 0, result.success true AND NO COMPONENT FAILURE: ANYTHING ELSE, A MALFORMED ANSWER INCLUDED, IS A FAILURE
    static readDeployComponentCounts(payload: Record<string, unknown> | undefined): IDeployComponentCounts {

        const result = payload?.result !== null && typeof payload?.result === 'object' && !Array.isArray(payload?.result) ? payload.result as Record<string, unknown> : undefined;
        const details = result?.details !== null && typeof result?.details === 'object' ? result.details as Record<string, unknown> : undefined;
        const toEntries = (entries: unknown): unknown[] => Array.isArray(entries) ? entries : entries !== null && typeof entries === 'object' ? [entries] : [];
        const componentFailures = toEntries(details?.componentFailures);
        const componentSuccesses = toEntries(details?.componentSuccesses)
            .filter(componentSuccess => !( componentSuccess !== null && typeof componentSuccess === 'object' && ( componentSuccess as Record<string, unknown> ).fullName === 'package.xml' ));
        const componentFailureProblems = componentFailures.map(componentFailure => {
            const failureRecord = componentFailure !== null && typeof componentFailure === 'object' ? componentFailure as Record<string, unknown> : {};
            return [failureRecord.fullName, failureRecord.problem]
                .filter((failurePart): failurePart is string => typeof failurePart === 'string' && failurePart.trim() !== '')
                .join(': ');
        }).filter(problem => problem !== '');

        return {
            isSucceeded: payload?.status === 0 && result?.success === true && componentFailures.length === 0,
            componentSuccessCount: componentSuccesses.length,
            componentFailureCount: componentFailures.length,
            componentFailureProblems: componentFailureProblems,
            ...( typeof result?.numberComponentsDeployed === 'number' ? { numberComponentsDeployed: result.numberComponentsDeployed } : {} )
        };

    }

    // A FOLDER NAME ONLY IF IT CANNOT NAME ANOTHER FOLDER: NO SEPARATOR OF EITHER PLATFORM, NOT "." OR ".."
    static isUsableOrgOperationFolderName(folderName: unknown): folderName is string {

        return typeof folderName === 'string'
                && folderName.trim() !== ''
                && folderName !== '.'
                && folderName !== '..'
                && !/[\\/\0]/.test(folderName);

    }

    /*
        treecipe/OrgOperations/<username or alias>/<timestamp>-<operation>.json, one shared folder
        for every CLI result the cockpit saves. Built here, never from a panel message, and
        undefined when it would land outside the workspace.
    */
    static buildOrgOperationResultFilePath(workspaceRoot: string, folderName: string, operationName: OrgOperationName, date: Date): string | undefined {

        if ( !this.isUsableOrgOperationFolderName(folderName) ) {
            return undefined;
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const resultFilePath = path.join(resolvedWorkspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, folderName, `${this.buildCompactTimestamp(date)}-${operationName}.json`);

        return SfdxProjectService.isPathContainedInWorkspace(resultFilePath, resolvedWorkspaceRoot) ? resultFilePath : undefined;

    }

    /*
        The CLI's answer as it gave it -- pretty printed when it is JSON, otherwise wrapped with its
        stderr and exit status so the file still says what happened. A failed write only means
        there is no output to view; it never changes what the run reports.
    */
    /*
        Written REDACTED, because the folder is in the workspace and treecipe/ is usually committed:
        a create's answer carries the new org's authFields (its access token among them). The
        folder also gets a .gitignore of its own that ignores everything in it, written once and
        never overwritten. The file itself is written with "wx", so a link planted at its name is
        never followed.
    */
    static writeOrgOperationResult(workspaceRoot: string,
                                    folderName: string,
                                    operationName: OrgOperationName,
                                    invocationResult: ISalesforceCliInvocationResult,
                                    date: Date,
                                    payload: Record<string, unknown> | undefined = this.readCliJsonPayload(invocationResult)): string | undefined {

        const resultFilePath = this.buildOrgOperationResultFilePath(workspaceRoot, folderName, operationName, date);

        if ( !resultFilePath ) {
            return undefined;
        }

        const resultFileContent = payload
            ? JSON.stringify(this.redactSecrets(payload), null, 2)
            : JSON.stringify({ stdout: this.redactSecretText(invocationResult.stdout), stderr: this.redactSecretText(invocationResult.stderr), exitCode: invocationResult.exitCode }, null, 2);

        try {
            fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
            this.writeOrgOperationsGitignore(workspaceRoot);
        } catch {
            return undefined;
        }

        // TWO OPERATIONS IN ONE SECOND (A SECOND DEPLOY, #211) TAKE THE FIRST FREE OF <name>, <name>-2, ... RATHER THAN LOSE THE LATER RESULT
        for ( let attempt = 1; attempt <= ORG_OPERATION_RESULT_FILE_ATTEMPTS; attempt++ ) {
            const attemptFilePath = attempt === 1 ? resultFilePath : resultFilePath.replace(/\.json$/, `-${attempt}.json`);
            try {
                fs.writeFileSync(attemptFilePath, resultFileContent, { encoding: 'utf-8', flag: 'wx' });
                return attemptFilePath;
            } catch (writeError) {
                if ( ( writeError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    static writeOrgOperationsGitignore(workspaceRoot: string) {

        try {
            fs.writeFileSync(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, '.gitignore'), '*\n', { encoding: 'utf-8', flag: 'wx' });
        } catch {
            // ALREADY THERE -- OR NOT WRITABLE, WHICH THE RESULT FILE'S OWN WRITE WILL SAY
        }

    }

    static redactSecrets(value: unknown): unknown {

        if ( Array.isArray(value) ) {
            return value.map(element => this.redactSecrets(element));
        }

        if ( value === null || typeof value !== 'object' ) {
            return value;
        }

        const redactedValue: Record<string, unknown> = {};

        for ( const [key, childValue] of Object.entries(value as Record<string, unknown>) ) {
            redactedValue[key] = ORG_OPERATION_REDACTED_KEYS.includes(key) || ORG_OPERATION_SECRET_KEY_PATTERN.test(key)
                ? ORG_OPERATION_REDACTED_VALUE
                : this.redactSecrets(childValue);
        }

        return redactedValue;

    }

    // OUTPUT THAT IS NOT JSON IS KEPT AS TEXT, WITH ANYTHING SHAPED LIKE AN ACCESS TOKEN OR AN AUTH URL TAKEN OUT
    static redactSecretText(text: string): string {

        return String(text ?? '')
            // A FRONTDOOR ADDRESS ("sf org open --url-only") LOGS WHOEVER HAS IT IN, WHATEVER FORM ITS SESSION PARAMETER TAKES
            .replace(/https?:\/\/[^\s"']*[?&](?:sid|otp)=[^\s"']*/gi, ORG_OPERATION_REDACTED_VALUE)
            .replace(/00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]+/g, ORG_OPERATION_REDACTED_VALUE)
            .replace(/force:\/\/[^\s"']+/g, ORG_OPERATION_REDACTED_VALUE);

    }

    /*
        Create, then deploy, each killed by a cancellation. A create the reader cancelled reports
        nothing about an org -- the Dev Hub may still have made one -- and a deploy that did not
        finish keeps the org it was deploying to. A spawn failure writes no file.
    */
    static async runScratchOrgSetup(scratchOrgPlan: IScratchOrgPlan, setupHooks: IScratchOrgSetupHooks): Promise<ScratchOrgSetupOutcome> {

        const now = setupHooks.now ?? (() => new Date());
        const createOptions: ISalesforceCliProjectOptions = { workingDirectoryPath: scratchOrgPlan.workspaceRoot };
        const deployOptions: ISalesforceCliProjectOptions = { workingDirectoryPath: scratchOrgPlan.workspaceRoot, maxBufferBytes: SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES };

        setupHooks.onPhase('creating');

        const createInvocation = await PicklistDependencyCheckService.runSalesforceCli(
            this.buildScratchOrgCreateArguments(scratchOrgPlan),
            setupHooks.registerCancellation,
            undefined,
            createOptions
        );

        // PARSED BEFORE THE CANCEL IS READ: A CANCEL THAT LANDED AS THE CREATE SUCCEEDED STILL HAS AN ORG TO KEEP
        const createPayload = this.readCliJsonPayload(createInvocation);
        const createResult = this.parseScratchOrgCreateOutput(createInvocation, createPayload);

        if ( 'failureMessage' in createResult ) {

            if ( setupHooks.isCancellationRequested() ) {
                return { kind: 'createCancelled' };
            }

            return {
                kind: 'createFailed',
                failureMessage: createResult.failureMessage,
                outputFilePath: createInvocation.spawnError || createInvocation.isOutputTooLarge
                    ? undefined
                    : this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, scratchOrgPlan.alias, 'scratch-create', createInvocation, now(), createPayload)
            };

        }

        const username = createResult.username;
        this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, username, 'scratch-create', createInvocation, now(), createPayload);

        if ( setupHooks.isCancellationRequested() ) {
            return { kind: 'deployCancelled', username: username, isDeployStarted: false };
        }

        setupHooks.onPhase('deploying');

        const deployInvocation = await PicklistDependencyCheckService.runSalesforceCli(
            this.buildSourceDeployArguments(username),
            setupHooks.registerCancellation,
            undefined,
            deployOptions
        );

        if ( setupHooks.isCancellationRequested() ) {
            return { kind: 'deployCancelled', username: username, isDeployStarted: true };
        }

        if ( deployInvocation.isOutputTooLarge ) {
            return { kind: 'deployUnconfirmed', username: username };
        }

        const deployPayload = this.readCliJsonPayload(deployInvocation);
        const deployResult = this.parseSourceDeployOutput(deployInvocation, deployPayload);
        const outputFilePath = deployInvocation.spawnError
            ? undefined
            : this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, username, 'scratch-deploy', deployInvocation, now(), deployPayload);

        if ( 'failureMessage' in deployResult ) {
            return { kind: 'deployFailed', username: username, componentFailureCount: deployResult.componentFailureCount, failureMessage: deployResult.failureMessage, outputFilePath: outputFilePath };
        }

        return { kind: 'deployed', username: username, deployedComponentCount: deployResult.deployedComponentCount, outputFilePath: outputFilePath };

    }

}
