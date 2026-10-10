import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// THE CLI HELPER'S OWN IMPORTS REACH vscode; NOTHING HERE CALLS IT
jest.mock('vscode', () => ({}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IScratchOrgPlan,
    ORG_OPERATIONS_FOLDER_NAME,
    SCRATCH_ORG_DURATION_DAYS,
    ORG_OPERATION_REDACTED_VALUE,
    SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES,
    ScratchOrgService,
    ScratchOrgSetupPhase
} from '../ScratchOrgService';
import { ISalesforceCliInvocationResult } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { NO_DEFAULT_DEV_HUB_MESSAGE, TARGET_DEV_HUB_ENVIRONMENT_VARIABLE } from '../../SalesforceOrgService/SalesforceOrgService';

const MOCKS_PATH = path.join(__dirname, 'mocks');
const PROJECT_WORKSPACE_PATH = path.join(MOCKS_PATH, 'projectWorkspace');
const readFixture = (fixtureName: string) => fs.readFileSync(path.join(MOCKS_PATH, fixtureName), 'utf-8');

const SCRATCH_CREATE_SUCCESS = readFixture('scratchCreateSuccess.json');
const SCRATCH_CREATE_LIMIT_REACHED = readFixture('scratchCreateLimitReached.json');
const DEPLOY_SUCCESS = readFixture('deploySuccess.json');
const DEPLOY_ONE_COMPONENT_FAILURE = readFixture('deployOneComponentFailure.json');

const NEW_SCRATCH_USERNAME = 'test-newscratch@example.com';
const DEV_HUB_AUTHORIZATION = { username: 'hub@example.com', aliases: ['devhub'], isDevHub: true, instanceUrl: 'https://acme.my.salesforce.com' };

const invocation = (stdout: string, exitCode: number | null = 0, extra: Partial<ISalesforceCliInvocationResult> = {}): ISalesforceCliInvocationResult => ({ stdout, stderr: '', exitCode, ...extra });

describe('ScratchOrgService (#200)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    let homeDirectoryPath: string;
    let savedDevHubEnvironmentValue: string | undefined;
    let savedPathVariable: string | undefined;
    let installedSalesforceCliPath: string;

    beforeEach(() => {

        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-scratch-org-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        homeDirectoryPath = path.join(temporaryRoot, 'home');
        fs.cpSync(PROJECT_WORKSPACE_PATH, workspaceRoot, { recursive: true });
        fs.mkdirSync(path.join(workspaceRoot, '.sf'), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), JSON.stringify({ 'target-dev-hub': 'devhub' }));
        fs.mkdirSync(homeDirectoryPath, { recursive: true });

        // THE CLI IS RUN BY THE ABSOLUTE PATH OF THE FIRST sf ON PATH OUTSIDE THE WORKSPACE
        const installedBinPath = path.join(temporaryRoot, 'installed', 'bin');
        fs.mkdirSync(installedBinPath, { recursive: true });
        fs.writeFileSync(path.join(installedBinPath, 'sf'), '');
        fs.writeFileSync(path.join(installedBinPath, 'sf.cmd'), '');
        installedSalesforceCliPath = path.join(installedBinPath, process.platform === 'win32' ? 'sf.cmd' : 'sf');
        savedPathVariable = process.env.PATH;
        process.env.PATH = installedBinPath;

        // THE MACHINE RUNNING THE SUITE MAY HAVE A DEV HUB OF ITS OWN SET -- NEITHER THE VARIABLE NOR ~/.sf IS READ HERE
        savedDevHubEnvironmentValue = process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
        delete process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
        jest.spyOn(os, 'homedir').mockReturnValue(homeDirectoryPath);

        (AuthInfo.listAllAuthorizations as jest.Mock).mockResolvedValue([DEV_HUB_AUTHORIZATION]);
        (execFile as unknown as jest.Mock).mockReset();

    });

    afterEach(() => {

        process.env.PATH = savedPathVariable;

        if ( savedDevHubEnvironmentValue === undefined ) {
            delete process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE];
        } else {
            process.env[TARGET_DEV_HUB_ENVIRONMENT_VARIABLE] = savedDevHubEnvironmentValue;
        }

        fs.rmSync(temporaryRoot, { recursive: true, force: true });

    });

    const PLAN_DATE = new Date(2026, 9, 10, 14, 22, 33);

    describe('buildScratchOrgAlias', () => {

        it('is treecipe-<yyyyMMdd-HHmmss> in local time', () => {

            expect(ScratchOrgService.buildScratchOrgAlias(PLAN_DATE)).toBe('treecipe-20261010-142233');
            expect(ScratchOrgService.buildScratchOrgAlias(new Date(2027, 0, 2, 3, 4, 5))).toBe('treecipe-20270102-030405');

        });

    });

    describe('resolveScratchOrgPlan', () => {

        it('resolves every package directory, the definition file, the default Dev Hub, the alias and 7 days, and starts no process', async () => {

            const scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE);

            expect(scratchOrgPlan.packageDirectoryPaths).toEqual(['force-app', 'unpackaged']);
            expect(scratchOrgPlan.definitionFilePath).toBe(path.join(path.resolve(workspaceRoot), 'config', 'project-scratch-def.json'));
            expect(scratchOrgPlan.definitionFileRelativePath).toBe(path.join('config', 'project-scratch-def.json'));
            expect(scratchOrgPlan.devHub).toEqual({ targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub', configSource: 'project' });
            expect(scratchOrgPlan.alias).toBe('treecipe-20261010-142233');
            expect(scratchOrgPlan.durationDays).toBe(7);
            expect(scratchOrgPlan.definitionSummary).toEqual({ edition: 'Developer', adminEmail: undefined, username: undefined });
            expect(scratchOrgPlan.hasFileOrEnvironmentReplacements).toBe(false);
            expect(execFile).not.toHaveBeenCalled();

        });

        it('refuses with no default Dev Hub, naming "sf config set target-dev-hub"', async () => {

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE)).rejects.toThrow(NO_DEFAULT_DEV_HUB_MESSAGE);
            expect(NO_DEFAULT_DEV_HUB_MESSAGE).toContain('sf config set target-dev-hub=<alias>');
            expect(execFile).not.toHaveBeenCalled();

        });

        it('refuses a missing config/project-scratch-def.json, naming the file it expected', async () => {

            fs.rmSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'));

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE))
                .rejects.toThrow(`No scratch org definition file found at "${path.join(path.resolve(workspaceRoot), 'config', 'project-scratch-def.json')}"`);

        });

        it('refuses a definition file that resolves outside the workspace through a symlinked config folder', async () => {

            const outsideConfigPath = path.join(temporaryRoot, 'outsideConfig');
            fs.mkdirSync(outsideConfigPath);
            fs.writeFileSync(path.join(outsideConfigPath, 'project-scratch-def.json'), '{}');
            fs.rmSync(path.join(workspaceRoot, 'config'), { recursive: true });
            fs.symlinkSync(outsideConfigPath, path.join(workspaceRoot, 'config'), 'dir');

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE)).rejects.toThrow('resolves outside this workspace');

        });

        it('refuses a missing sfdx-project.json before reading anything else', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE)).rejects.toThrow('No "sfdx-project.json" found at');

        });

        it('refuses an unparseable sfdx-project.json', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ "packageDirectories": [');

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE)).rejects.toThrow('as JSON');

        });

    });

    describe('the argv', () => {

        const PLAN: IScratchOrgPlan = {
            workspaceRoot: '/workspace',
            definitionFilePath: '/workspace/config/project-scratch-def.json',
            definitionFileRelativePath: 'config/project-scratch-def.json',
            packageDirectoryPaths: ['force-app'],
            devHub: { targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub', configSource: 'project' },
            alias: 'treecipe-20261010-142233',
            durationDays: SCRATCH_ORG_DURATION_DAYS,
            definitionSummary: {},
            hasFileOrEnvironmentReplacements: false
        };

        it('creates with the definition file relative to the workspace, the generated alias, 7 days and the default Dev Hub', () => {

            expect(ScratchOrgService.buildScratchOrgCreateArguments(PLAN)).toEqual([
                'org', 'create', 'scratch',
                '--definition-file', 'config/project-scratch-def.json',
                '--alias', 'treecipe-20261010-142233',
                '--duration-days', '7',
                '--target-dev-hub', 'devhub',
                '--json'
            ]);

        });

        it('deploys with no --source-dir and no --ignore-errors, so the CLI deploys every package directory all or nothing', () => {

            const deployArguments = ScratchOrgService.buildSourceDeployArguments(PLAN);

            expect(deployArguments).toEqual(['project', 'deploy', 'start', '--target-org', 'treecipe-20261010-142233', '--json']);
            expect(deployArguments).not.toContain('--ignore-errors');
            expect(deployArguments).not.toContain('--source-dir');

        });

        it('refuses an identifier that would read as a flag', () => {

            expect(() => ScratchOrgService.buildScratchOrgCreateArguments({ ...PLAN, devHub: { ...PLAN.devHub, targetOrgIdentifier: '--json' } })).toThrow('is not a usable Salesforce org alias or username');

        });

        it('builds no "sf org delete" argv anywhere in the extension source', () => {

            const collectSourceFilePaths = (directoryPath: string): string[] => fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => {
                const entryPath = path.join(directoryPath, directoryEntry.name);
                if ( directoryEntry.isDirectory() ) {
                    return directoryEntry.name === 'tests' ? [] : collectSourceFilePaths(entryPath);
                }
                return entryPath.endsWith('.ts') ? [entryPath] : [];
            });

            const sourceFilePaths = collectSourceFilePaths(path.join(__dirname, '..', '..', '..', '..'));

            expect(sourceFilePaths).toContain(path.join(__dirname, '..', 'ScratchOrgService.ts'));
            sourceFilePaths.forEach(sourceFilePath => {
                expect(fs.readFileSync(sourceFilePath, 'utf-8')).not.toMatch(/['"]org['"]\s*,\s*['"]delete['"]/);
            });
            expect(fs.readFileSync(path.join(__dirname, '..', 'ScratchOrgService.ts'), 'utf-8')).not.toMatch(/['"]delete['"]/);

        });

    });

    describe('parseScratchOrgCreateOutput', () => {

        it('reads the username of a created org', () => {

            expect(ScratchOrgService.parseScratchOrgCreateOutput(invocation(SCRATCH_CREATE_SUCCESS))).toEqual({ isCreated: true, username: NEW_SCRATCH_USERNAME });

        });

        it('carries the CLI\'s message for a failed create, such as the Dev Hub\'s scratch org limit', () => {

            const parsedResult = ScratchOrgService.parseScratchOrgCreateOutput(invocation(SCRATCH_CREATE_LIMIT_REACHED, 1));

            expect(parsedResult.isCreated).toBe(false);
            expect(( parsedResult as { failureMessage: string } ).failureMessage).toStartWith('LIMIT_EXCEEDED: The signup request failed because this organization has reached its active scratch org limit');

        });

        it.each([
            ['not JSON', 'Warning: something\nnot json'],
            ['a JSON array', '[]'],
            ['status 0 with no result', '{"status":0}'],
            ['status 0 with a username that is not one', '{"status":0,"result":{"username":"--target-org"}}'],
            ['status 0 with a numeric username', '{"status":0,"result":{"username":7}}'],
            ['a username with a non-zero status', '{"status":1,"result":{"username":"test@example.com"}}']
        ])('reports malformed output (%s) as a failure, never a success', (_label, stdout) => {

            expect(ScratchOrgService.parseScratchOrgCreateOutput(invocation(stdout, 0)).isCreated).toBe(false);

        });

        it('says the Salesforce CLI is required when sf is not installed', () => {

            const spawnError = Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' });

            expect(ScratchOrgService.parseScratchOrgCreateOutput(invocation('', null, { spawnError }))).toEqual({
                isCreated: false,
                failureMessage: ScratchOrgService.buildCliRequiredMessage()
            });
            expect(ScratchOrgService.buildCliRequiredMessage()).toContain('Salesforce CLI');
            expect(ScratchOrgService.buildCliRequiredMessage()).toContain('is required');

        });

    });

    describe('buildCliFailureDetail', () => {

        it.each([
            ['stderr and an exit code', { stdout: '', stderr: ' ERROR running org create ', exitCode: 2 }, 'ERROR running org create (exit code 2)'],
            ['stderr after a signal', { stdout: '', stderr: 'killed', exitCode: null }, 'killed (it was terminated by a signal)'],
            ['stderr after a timeout', { stdout: '', stderr: 'slow', exitCode: null, timedOut: true }, 'slow (it timed out)'],
            ['nothing at all', { stdout: '', stderr: '', exitCode: 1 }, 'The Salesforce CLI did not return usable JSON (exit code 1).']
        ])('says what it can from %s', (_label, invocationResult, expectedDetail) => {

            expect(ScratchOrgService.buildCliFailureDetail(undefined, invocationResult as ISalesforceCliInvocationResult)).toBe(expectedDetail);

        });

        it('prefers the payload\'s name and message, skipping blank ones', () => {

            expect(ScratchOrgService.buildCliFailureDetail({ name: '  ', message: 'No Dev Hub' }, invocation(''))).toBe('No Dev Hub');

        });

    });

    describe('spawn failures other than ENOENT', () => {

        const spawnError = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });

        it('are failures of the create and of the deploy, naming the spawn error', () => {

            expect(ScratchOrgService.parseScratchOrgCreateOutput(invocation('', null, { spawnError }))).toEqual({ isCreated: false, failureMessage: 'The Salesforce CLI could not be started: spawn EACCES' });
            expect(ScratchOrgService.parseSourceDeployOutput(invocation('', null, { spawnError }))).toEqual({ isDeployed: false, componentFailureCount: 0, failureMessage: 'The Salesforce CLI could not be started: spawn EACCES' });

        });

        it('says the CLI is required when the deploy cannot find sf', () => {

            expect(ScratchOrgService.parseSourceDeployOutput(invocation('', null, { spawnError: Object.assign(new Error('x'), { code: 'ENOENT' }) })))
                .toEqual({ isDeployed: false, componentFailureCount: 0, failureMessage: ScratchOrgService.buildCliRequiredMessage() });

        });

    });

    describe('parseSourceDeployOutput', () => {

        it('reads a successful deploy\'s component count', () => {

            expect(ScratchOrgService.parseSourceDeployOutput(invocation(DEPLOY_SUCCESS))).toEqual({ isDeployed: true, deployedComponentCount: 3 });

        });

        it('counts the component failures of a failed deploy, among its successes', () => {

            expect(ScratchOrgService.parseSourceDeployOutput(invocation(DEPLOY_ONE_COMPONENT_FAILURE, 1))).toEqual({
                isDeployed: false,
                componentFailureCount: 1,
                failureMessage: 'FailedDeployError: Deploy failed.'
            });

        });

        it.each([
            ['not JSON', 'oops'],
            ['success with a non-zero status', '{"status":1,"result":{"success":true}}'],
            ['status 0 with success not literally true', '{"status":0,"result":{"success":"true"}}'],
            ['status 0 and success with a component failure', '{"status":0,"result":{"success":true,"details":{"componentFailures":{"fullName":"X"}}}}']
        ])('reports malformed output (%s) as a failure', (_label, stdout) => {

            expect(ScratchOrgService.parseSourceDeployOutput(invocation(stdout)).isDeployed).toBe(false);

        });

    });

    describe('writeOrgOperationResult', () => {

        it('wraps output that is not JSON with its stderr and exit status', () => {

            const resultFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'treecipe-x', 'scratch-create', { stdout: 'not json', stderr: 'boom', exitCode: 1 }, PLAN_DATE);

            expect(JSON.parse(fs.readFileSync(resultFilePath, 'utf-8'))).toEqual({ stdout: 'not json', stderr: 'boom', exitCode: 1 });

        });

        it('writes nothing for an unusable folder name, and answers undefined when the write fails', () => {

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, '..', 'scratch-create', invocation('{}'), PLAN_DATE)).toBeUndefined();

            fs.writeFileSync(path.join(workspaceRoot, 'treecipe'), 'a file where the folder goes');

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'treecipe-x', 'scratch-create', invocation('{}'), PLAN_DATE)).toBeUndefined();

        });

    });

    describe('a deploy that cannot start', () => {

        it('keeps the org and writes no deploy file', async () => {

            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: Function) => {
                setImmediate(() => argumentList[0] === 'org'
                    ? callback(null, SCRATCH_CREATE_SUCCESS, '')
                    : callback(Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }), '', ''));
                return { kill: jest.fn() };
            });

            const scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE);
            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, { onPhase: jest.fn(), registerCancellation: jest.fn(), isCancellationRequested: () => false, now: () => PLAN_DATE });

            expect(outcome).toEqual({ kind: 'deployFailed', username: NEW_SCRATCH_USERNAME, componentFailureCount: 0, failureMessage: ScratchOrgService.buildCliRequiredMessage(), outputFilePath: undefined });

        });

    });

    describe('buildOrgOperationResultFilePath', () => {

        it('is treecipe/OrgOperations/<folder>/<timestamp>-<operation>.json', () => {

            expect(ScratchOrgService.buildOrgOperationResultFilePath(workspaceRoot, NEW_SCRATCH_USERNAME, 'scratch-deploy', PLAN_DATE))
                .toBe(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME, '20261010-142233-scratch-deploy.json'));

        });

        it.each(['', '.', '..', 'a/b', 'a\\b', '../escape', 'nul\0byte'])('refuses the folder name %p', folderName => {

            expect(ScratchOrgService.buildOrgOperationResultFilePath(workspaceRoot, folderName, 'scratch-create', PLAN_DATE)).toBeUndefined();

        });

        it('refuses a path that a symlinked treecipe folder carries out of the workspace', () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outsideTreecipe');
            fs.mkdirSync(outsideFolderPath);
            fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, 'treecipe'), 'dir');

            expect(ScratchOrgService.buildOrgOperationResultFilePath(workspaceRoot, NEW_SCRATCH_USERNAME, 'scratch-create', PLAN_DATE)).toBeUndefined();

        });

    });

    describe('runScratchOrgSetup', () => {

        type CliAnswer = { stdout: string; error?: unknown; onCall?: () => void };

        let cliCalls: Array<{ command: string; argumentList: string[]; options: Record<string, unknown> }>;
        let killedProcessCount: number;

        const answerCliCalls = (cliAnswers: CliAnswer[]) => {
            (execFile as unknown as jest.Mock).mockImplementation((command: string, argumentList: string[], options: Record<string, unknown>, callback: Function) => {
                cliCalls.push({ command, argumentList, options });
                const cliAnswer = cliAnswers.shift();
                cliAnswer.onCall?.();
                setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                return { kill: jest.fn(() => { killedProcessCount++; }) };
            });
        };

        const runSetup = async (cancellation: { requestedAtPhase?: ScratchOrgSetupPhase } = {}) => {
            const scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE);
            const reportedPhases: ScratchOrgSetupPhase[] = [];
            let isCancelled = false;
            let killCurrentProcess: () => void;
            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, {
                onPhase: setupPhase => reportedPhases.push(setupPhase),
                registerCancellation: killChildProcess => {
                    killCurrentProcess = killChildProcess;
                    if ( cancellation.requestedAtPhase === reportedPhases[reportedPhases.length - 1] ) {
                        isCancelled = true;
                        killCurrentProcess();
                    }
                },
                isCancellationRequested: () => isCancelled,
                now: () => PLAN_DATE
            });
            return { outcome, reportedPhases };
        };

        const exitError = (exitCode: number) => Object.assign(new Error(`Command failed with exit code ${exitCode}`), { code: exitCode });

        beforeEach(() => {
            cliCalls = [];
            killedProcessCount = 0;
        });

        it('creates, then deploys to the alias with the workspace as the working directory, through execFile with no shell, and saves both results', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_SUCCESS }, { stdout: DEPLOY_SUCCESS }]);

            const { outcome, reportedPhases } = await runSetup();

            expect(reportedPhases).toEqual(['creating', 'deploying']);
            expect(cliCalls.map(cliCall => cliCall.argumentList.slice(0, 3))).toEqual([['org', 'create', 'scratch'], ['project', 'deploy', 'start']]);
            cliCalls.forEach(cliCall => {
                expect(cliCall.command).toBe(process.platform === 'win32' ? `"${installedSalesforceCliPath}"` : installedSalesforceCliPath);
                expect(cliCall.options).toMatchObject({ shell: process.platform === 'win32', cwd: path.resolve(workspaceRoot) });
            });
            expect(cliCalls[1].argumentList).not.toContain('--ignore-errors');

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME);
            expect(outcome).toEqual({ kind: 'deployed', username: NEW_SCRATCH_USERNAME, deployedComponentCount: 3, outputFilePath: path.join(operationsFolderPath, '20261010-142233-scratch-deploy.json') });
            expect(fs.readdirSync(operationsFolderPath).sort()).toEqual(['20261010-142233-scratch-create.json', '20261010-142233-scratch-deploy.json']);
            expect(JSON.parse(fs.readFileSync(path.join(operationsFolderPath, '20261010-142233-scratch-deploy.json'), 'utf-8'))).toEqual(JSON.parse(DEPLOY_SUCCESS));

            // THE CREATE'S authFields CARRY THE NEW ORG'S ACCESS TOKEN, AND THE FOLDER SITS IN A WORKSPACE THAT IS USUALLY COMMITTED
            const savedCreate = fs.readFileSync(path.join(operationsFolderPath, '20261010-142233-scratch-create.json'), 'utf-8');
            expect(savedCreate).not.toContain('accessToken');
            expect(savedCreate).not.toContain('00D000000000077!REDACTED');
            expect(JSON.parse(savedCreate).result.username).toBe(NEW_SCRATCH_USERNAME);
            expect(fs.readFileSync(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, '.gitignore'), 'utf-8')).toBe('*\n');

        });

        it('attempts no deploy when the create fails, and saves its output under the requested alias', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_LIMIT_REACHED, error: exitError(1) }]);

            const { outcome } = await runSetup();

            expect(cliCalls).toHaveLength(1);
            expect(outcome.kind).toBe('createFailed');
            expect(( outcome as { outputFilePath: string } ).outputFilePath)
                .toBe(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, 'treecipe-20261010-142233', '20261010-142233-scratch-create.json'));

        });

        it('keeps the org and counts the component failures when the deploy fails', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_SUCCESS }, { stdout: DEPLOY_ONE_COMPONENT_FAILURE, error: exitError(1) }]);

            const { outcome } = await runSetup();

            expect(outcome).toMatchObject({ kind: 'deployFailed', username: NEW_SCRATCH_USERNAME, componentFailureCount: 1 });
            expect(fs.existsSync(( outcome as { outputFilePath: string } ).outputFilePath)).toBe(true);

        });

        it('leaves no file and no org behind when sf is not installed', async () => {

            answerCliCalls([{ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }]);

            const { outcome } = await runSetup();

            expect(outcome).toEqual({ kind: 'createFailed', failureMessage: ScratchOrgService.buildCliRequiredMessage(), outputFilePath: undefined });
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe'))).toBe(false);

        });

        it('kills the create and reports nothing about an org when cancelled during it', async () => {

            answerCliCalls([{ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }]);

            const { outcome } = await runSetup({ requestedAtPhase: 'creating' });

            expect(killedProcessCount).toBe(1);
            expect(cliCalls).toHaveLength(1);
            expect(outcome).toEqual({ kind: 'createCancelled' });

        });

        it('kills the deploy and keeps the org when cancelled during it', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_SUCCESS }, { stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }]);

            const { outcome } = await runSetup({ requestedAtPhase: 'deploying' });

            expect(killedProcessCount).toBe(1);
            expect(outcome).toEqual({ kind: 'deployCancelled', username: NEW_SCRATCH_USERNAME, isDeployStarted: true });

        });

        it('reports a create that answered malformed JSON as a failure and deploys nothing', async () => {

            answerCliCalls([{ stdout: '{"status":0,"result":{}}' }]);

            const { outcome } = await runSetup();

            expect(outcome.kind).toBe('createFailed');
            expect(cliCalls).toHaveLength(1);

        });

    });

    describe('hardening (#240 review)', () => {

        it('keeps the org when a cancel lands just as the create succeeds', async () => {

            let isCancelled = false;
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, _argumentList: string[], _options: unknown, callback: Function) => {
                isCancelled = true;
                setImmediate(() => callback(null, SCRATCH_CREATE_SUCCESS, ''));
                return { kill: jest.fn() };
            });

            const scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE);
            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, { onPhase: jest.fn(), registerCancellation: jest.fn(), isCancellationRequested: () => isCancelled, now: () => PLAN_DATE });

            expect(outcome).toEqual({ kind: 'deployCancelled', username: NEW_SCRATCH_USERNAME, isDeployStarted: false });
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME, '20261010-142233-scratch-create.json'))).toBe(true);

        });

        it('reports a deploy whose answer outgrew the buffer as unconfirmed, not failed, and gives the deploy a larger buffer', async () => {

            const bufferSizes: number[] = [];
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], options: { maxBuffer: number }, callback: Function) => {
                bufferSizes.push(options.maxBuffer);
                setImmediate(() => argumentList[0] === 'org'
                    ? callback(null, SCRATCH_CREATE_SUCCESS, '')
                    : callback(Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), '', ''));
                return { pid: 9, kill: jest.fn() };
            });

            const scratchOrgPlan = await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE);
            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, { onPhase: jest.fn(), registerCancellation: jest.fn(), isCancellationRequested: () => false, now: () => PLAN_DATE });

            expect(outcome).toEqual({ kind: 'deployUnconfirmed', username: NEW_SCRATCH_USERNAME });
            expect(bufferSizes).toEqual([1024 * 1024 * 8, SCRATCH_ORG_DEPLOY_MAX_BUFFER_BYTES]);

        });

        it('says a create whose answer outgrew the buffer may still have made an org', () => {

            expect(ScratchOrgService.parseScratchOrgCreateOutput({ stdout: '', stderr: '', exitCode: null, isOutputTooLarge: true }))
                .toEqual({ isCreated: false, failureMessage: expect.stringContaining('check with "sf org list"') });

        });

        it('redacts every credential-shaped key, wherever it is nested, and token-shaped text in output that is not JSON', () => {

            expect(ScratchOrgService.redactSecrets({
                status: 0,
                result: { username: 'u@example.com', authFields: { accessToken: 'x' }, nested: [{ refreshToken: 'r', clientSecret: 's', password: 'p', privateKey: 'k', sfdxAuthUrl: 'force://a', keep: 'yes' }] }
            })).toEqual({
                status: 0,
                result: { username: 'u@example.com', authFields: ORG_OPERATION_REDACTED_VALUE, nested: [{ refreshToken: ORG_OPERATION_REDACTED_VALUE, clientSecret: ORG_OPERATION_REDACTED_VALUE, password: ORG_OPERATION_REDACTED_VALUE, privateKey: ORG_OPERATION_REDACTED_VALUE, sfdxAuthUrl: ORG_OPERATION_REDACTED_VALUE, keep: 'yes' }] }
            });
            expect(ScratchOrgService.redactSecretText('token 00D000000000077!AQ.abc_def- and force://PlatformCLI::x@y end'))
                .toBe(`token ${ORG_OPERATION_REDACTED_VALUE} and ${ORG_OPERATION_REDACTED_VALUE} end`);

        });

        it('never overwrites a result file or a .gitignore already there, nor follows a link planted at the name', () => {

            const operationsPath = path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME);
            fs.mkdirSync(path.join(operationsPath, 'treecipe-x'), { recursive: true });
            fs.writeFileSync(path.join(operationsPath, '.gitignore'), 'mine\n');
            const outsideFilePath = path.join(temporaryRoot, 'outside.json');
            fs.writeFileSync(outsideFilePath, 'untouched');
            fs.symlinkSync(outsideFilePath, path.join(operationsPath, 'treecipe-x', '20261010-142233-scratch-create.json'));

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'treecipe-x', 'scratch-create', invocation('{}'), PLAN_DATE)).toBeUndefined();
            expect(fs.readFileSync(outsideFilePath, 'utf-8')).toBe('untouched');
            expect(fs.readFileSync(path.join(operationsPath, '.gitignore'), 'utf-8')).toBe('mine\n');

        });

        it('reads the definition\'s edition, admin email and username, and only strings', () => {

            fs.writeFileSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'), JSON.stringify({ edition: 'Enterprise', adminEmail: 'author@example.com', username: 7 }));

            expect(ScratchOrgService.readDefinitionSummary(path.join(workspaceRoot, 'config', 'project-scratch-def.json')))
                .toEqual({ edition: 'Enterprise', adminEmail: 'author@example.com', username: undefined });
            expect(ScratchOrgService.readDefinitionSummary(path.join(workspaceRoot, 'missing.json'))).toEqual({});

            fs.writeFileSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'), '[]');
            expect(ScratchOrgService.readDefinitionSummary(path.join(workspaceRoot, 'config', 'project-scratch-def.json'))).toEqual({});

        });

        it('refuses a package directory that does not exist before any org is made', async () => {

            fs.rmSync(path.join(workspaceRoot, 'unpackaged'), { recursive: true });

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE)).rejects.toThrow('The package directory "unpackaged"');

        });

        it('notes replacements that copy local files or environment variables into the deploy', async () => {

            const sfdxProjectFilePath = path.join(workspaceRoot, 'sfdx-project.json');
            fs.writeFileSync(sfdxProjectFilePath, JSON.stringify({ ...JSON.parse(fs.readFileSync(sfdxProjectFilePath, 'utf-8')), replacements: [{ filename: 'x', stringToReplace: 'y', replaceWithEnv: 'HOME' }] }));

            expect(( await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, PLAN_DATE) ).hasFileOrEnvironmentReplacements).toBe(true);

        });

    });

});
