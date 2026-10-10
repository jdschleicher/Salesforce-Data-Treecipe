import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, ISalesforceCliProjectOptions, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IDevHubOrgDetail } from '../SalesforceOrgService/SalesforceOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

export const SCRATCH_ORG_ALIAS_PREFIX = 'treecipe-';

export const SCRATCH_ORG_DURATION_DAYS = 7;

export const SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH = path.join('config', 'project-scratch-def.json');

export const ORG_OPERATIONS_FOLDER_NAME = 'OrgOperations';

export type OrgOperationName = 'scratch-create' | 'scratch-deploy';

export type ScratchOrgSetupPhase = 'creating' | 'deploying';

// A DEPLOY'S --json LISTS EVERY FILE AND COMPONENT, SO A LARGE PROJECT'S ANSWER OUTGROWS THE 8 MB OTHER COMMANDS USE
export const SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES = 1024 * 1024 * 256;

// WHAT A SAVED RESULT NEVER CARRIES: THE CREATE'S authFields WHOLE, AND ANY KEY THAT NAMES A CREDENTIAL ANYWHERE ELSE
export const ORG_OPERATION_REDACTED_KEYS: readonly string[] = ['authFields'];

export const ORG_OPERATION_SECRET_KEY_PATTERN = /token|password|secret|privatekey|sfdxauthurl|authcode/i;

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
    alias: string;
    durationDays: number;
    definitionSummary: IScratchOrgDefinitionSummary;
    hasFileOrEnvironmentReplacements: boolean;
}

export type ScratchOrgCreateParseResult =
    { isCreated: true; username: string }
    | { isCreated: false; failureMessage: string };

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
    Creates a scratch org through the CLI's default Dev Hub and deploys the project's source to it
    (#200). It imports no vscode itself: the cockpit owns the confirmation, the progress and the panel, and this
    service owns the argv, the reading of the CLI's --json answer and the result files.

    Every process goes through PicklistDependencyCheckService.runSalesforceCli -- execFile with an
    argv, no shell except the quoted one Windows' sf.cmd shim needs. Nothing here ever runs
    "sf org delete": an org this creates is the reader's to keep or delete.
*/
export class ScratchOrgService {

    // LOCAL TIME, SINCE THE ALIAS IS FOR THE READER: treecipe-20261010-142233
    static buildCompactTimestamp(date: Date): string {

        const twoDigits = (value: number) => String(value).padStart(2, '0');

        return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`;

    }

    static buildScratchOrgAlias(date: Date): string {

        return `${SCRATCH_ORG_ALIAS_PREFIX}${this.buildCompactTimestamp(date)}`;

    }

    /*
        Refuses, before any process, every input the setup cannot run with: the project file, then
        the definition file, then the Dev Hub. The definition path is fixed, and still checked to
        resolve inside the workspace, because config/ can be a symlink out of it.
    */
    /*
        The project is checked BEFORE the Dev Hub is asked for, so a project that cannot be deployed
        refuses without a picker. No Dev Hub chosen is no plan: undefined, and nothing was started.
    */
    static async resolveScratchOrgPlan(workspaceRoot: string,
                                        chooseDevHub: () => Promise<IDevHubOrgDetail | undefined>,
                                        date: Date = new Date()): Promise<IScratchOrgPlan | undefined> {

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

        return {
            workspaceRoot: resolvedWorkspaceRoot,
            definitionFilePath: definitionFilePath,
            definitionFileRelativePath: SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH,
            packageDirectoryPaths: packageDirectoryPaths,
            devHub: devHub,
            alias: this.buildScratchOrgAlias(date),
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
        --ignore-errors, so the deploy is all or nothing: one failing component rolls it back.
    */
    static buildSourceDeployArguments(scratchOrgPlan: IScratchOrgPlan): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(scratchOrgPlan.alias);

        return ['project', 'deploy', 'start', '--target-org', scratchOrgPlan.alias, '--json'];

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

        const result = payload?.result !== null && typeof payload?.result === 'object' ? payload.result as Record<string, unknown> : undefined;
        const details = result?.details !== null && typeof result?.details === 'object' ? result.details as Record<string, unknown> : undefined;
        const componentFailures = details?.componentFailures;
        const componentFailureCount = Array.isArray(componentFailures)
            ? componentFailures.length
            : componentFailures !== null && typeof componentFailures === 'object' ? 1 : 0;

        if ( payload?.status === 0 && result?.success === true && componentFailureCount === 0 ) {
            const componentSuccesses = details?.componentSuccesses;
            const deployedComponentCount = typeof result.numberComponentsDeployed === 'number'
                ? result.numberComponentsDeployed
                : Array.isArray(componentSuccesses) ? componentSuccesses.length : 0;
            return { isDeployed: true, deployedComponentCount: deployedComponentCount };
        }

        return { isDeployed: false, componentFailureCount: componentFailureCount, failureMessage: this.buildCliFailureDetail(payload, invocationResult) };

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
            fs.writeFileSync(resultFilePath, resultFileContent, { encoding: 'utf-8', flag: 'wx' });
            return resultFilePath;
        } catch {
            return undefined;
        }

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
            this.buildSourceDeployArguments(scratchOrgPlan),
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
