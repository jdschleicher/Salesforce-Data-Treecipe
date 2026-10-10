import * as fs from 'fs';
import * as path from 'path';

import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IDefaultDevHubDetail, SalesforceOrgService } from '../SalesforceOrgService/SalesforceOrgService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

export const SCRATCH_ORG_ALIAS_PREFIX = 'treecipe-';

export const SCRATCH_ORG_DURATION_DAYS = 7;

export const SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH = path.join('config', 'project-scratch-def.json');

export const ORG_OPERATIONS_FOLDER_NAME = 'OrgOperations';

export type OrgOperationName = 'scratch-create' | 'scratch-deploy';

export type ScratchOrgSetupPhase = 'creating' | 'deploying';

/*
    Everything a scratch org setup uses, resolved on the HOST from the workspace and the CLI's own
    configuration -- the panel names none of it. The confirmation lists exactly this.
*/
export interface IScratchOrgPlan {
    workspaceRoot: string;
    definitionFilePath: string;
    definitionFileRelativePath: string;
    // AS sfdx-project.json DECLARES THEM: THE CLI RESOLVES THEM ITSELF, SINCE THE DEPLOY NAMES NO --source-dir
    packageDirectoryPaths: string[];
    devHub: IDefaultDevHubDetail;
    alias: string;
    durationDays: number;
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
    | { kind: 'deployCancelled'; username: string };

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
    static async resolveScratchOrgPlan(workspaceRoot: string, date: Date = new Date()): Promise<IScratchOrgPlan> {

        const packageDirectoryPaths = SfdxProjectService.resolveDeployablePackageDirectoryPaths(workspaceRoot);

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const definitionFilePath = path.join(resolvedWorkspaceRoot, SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH);

        if ( !SfdxProjectService.isPathContainedInWorkspace(definitionFilePath, resolvedWorkspaceRoot) ) {
            throw new Error(`The scratch org definition file "${SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH}" resolves outside this workspace, so no scratch org was created.`);
        }

        if ( !SfdxProjectService.isExistingFile(definitionFilePath) ) {
            throw new Error(`No scratch org definition file found at "${definitionFilePath}", so no scratch org was created. Add "${SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH}" to the project and try again.`);
        }

        const devHub = await SalesforceOrgService.resolveDefaultDevHub(resolvedWorkspaceRoot);

        return {
            workspaceRoot: resolvedWorkspaceRoot,
            definitionFilePath: definitionFilePath,
            definitionFileRelativePath: SCRATCH_ORG_DEFINITION_FILE_RELATIVE_PATH,
            packageDirectoryPaths: packageDirectoryPaths,
            devHub: devHub,
            alias: this.buildScratchOrgAlias(date),
            durationDays: SCRATCH_ORG_DURATION_DAYS
        };

    }

    static buildScratchOrgCreateArguments(scratchOrgPlan: IScratchOrgPlan): string[] {

        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(scratchOrgPlan.alias);
        PicklistDependencyCheckService.assertValidTargetOrgIdentifier(scratchOrgPlan.devHub.targetOrgIdentifier);

        return [
            'org', 'create', 'scratch',
            '--definition-file', scratchOrgPlan.definitionFilePath,
            '--alias', scratchOrgPlan.alias,
            '--duration-days', String(scratchOrgPlan.durationDays),
            '--target-dev-hub', scratchOrgPlan.devHub.targetOrgIdentifier,
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
    static parseScratchOrgCreateOutput(invocationResult: ISalesforceCliInvocationResult): ScratchOrgCreateParseResult {

        if ( invocationResult.spawnError ) {
            return { isCreated: false, failureMessage: invocationResult.spawnError.code === 'ENOENT' ? this.buildCliRequiredMessage() : `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        const payload = this.readCliJsonPayload(invocationResult);
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

    static parseSourceDeployOutput(invocationResult: ISalesforceCliInvocationResult): SourceDeployParseResult {

        if ( invocationResult.spawnError ) {
            return { isDeployed: false, componentFailureCount: 0, failureMessage: invocationResult.spawnError.code === 'ENOENT' ? this.buildCliRequiredMessage() : `The Salesforce CLI could not be started: ${invocationResult.spawnError.message}` };
        }

        const payload = this.readCliJsonPayload(invocationResult);
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
    static writeOrgOperationResult(workspaceRoot: string,
                                    folderName: string,
                                    operationName: OrgOperationName,
                                    invocationResult: ISalesforceCliInvocationResult,
                                    date: Date): string | undefined {

        const resultFilePath = this.buildOrgOperationResultFilePath(workspaceRoot, folderName, operationName, date);

        if ( !resultFilePath ) {
            return undefined;
        }

        const payload = this.readCliJsonPayload(invocationResult);
        const resultFileContent = payload
            ? JSON.stringify(payload, null, 2)
            : JSON.stringify({ stdout: invocationResult.stdout, stderr: invocationResult.stderr, exitCode: invocationResult.exitCode }, null, 2);

        try {
            fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
            fs.writeFileSync(resultFilePath, resultFileContent, 'utf-8');
            return resultFilePath;
        } catch {
            return undefined;
        }

    }

    /*
        Create, then deploy, each killed by a cancellation. A create the reader cancelled reports
        nothing about an org -- the Dev Hub may still have made one -- and a deploy that did not
        finish keeps the org it was deploying to. A spawn failure writes no file.
    */
    static async runScratchOrgSetup(scratchOrgPlan: IScratchOrgPlan, setupHooks: IScratchOrgSetupHooks): Promise<ScratchOrgSetupOutcome> {

        const now = setupHooks.now ?? (() => new Date());

        setupHooks.onPhase('creating');

        const createInvocation = await PicklistDependencyCheckService.runSalesforceCli(
            this.buildScratchOrgCreateArguments(scratchOrgPlan),
            setupHooks.registerCancellation,
            undefined,
            scratchOrgPlan.workspaceRoot
        );

        if ( setupHooks.isCancellationRequested() ) {
            return { kind: 'createCancelled' };
        }

        const createResult = this.parseScratchOrgCreateOutput(createInvocation);

        if ( 'failureMessage' in createResult ) {
            return {
                kind: 'createFailed',
                failureMessage: createResult.failureMessage,
                outputFilePath: createInvocation.spawnError ? undefined : this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, scratchOrgPlan.alias, 'scratch-create', createInvocation, now())
            };
        }

        const username = ( createResult as { username: string } ).username;
        this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, username, 'scratch-create', createInvocation, now());

        if ( setupHooks.isCancellationRequested() ) {
            return { kind: 'deployCancelled', username: username };
        }

        setupHooks.onPhase('deploying');

        const deployInvocation = await PicklistDependencyCheckService.runSalesforceCli(
            this.buildSourceDeployArguments(scratchOrgPlan),
            setupHooks.registerCancellation,
            undefined,
            scratchOrgPlan.workspaceRoot
        );

        if ( setupHooks.isCancellationRequested() ) {
            return { kind: 'deployCancelled', username: username };
        }

        const deployResult = this.parseSourceDeployOutput(deployInvocation);
        const outputFilePath = deployInvocation.spawnError ? undefined : this.writeOrgOperationResult(scratchOrgPlan.workspaceRoot, username, 'scratch-deploy', deployInvocation, now());

        if ( 'failureMessage' in deployResult ) {
            return { kind: 'deployFailed', username: username, componentFailureCount: deployResult.componentFailureCount, failureMessage: deployResult.failureMessage, outputFilePath: outputFilePath };
        }

        return { kind: 'deployed', username: username, deployedComponentCount: deployResult.deployedComponentCount, outputFilePath: outputFilePath };

    }

}
