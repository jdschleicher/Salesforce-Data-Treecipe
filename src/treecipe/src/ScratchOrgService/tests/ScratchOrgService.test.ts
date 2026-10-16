import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// THE CLI HELPER'S OWN IMPORTS REACH vscode; NOTHING HERE CALLS IT
jest.mock('vscode', () => ({}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IScratchOrgAliasChoice,
    IScratchOrgPlan,
    ORG_OPEN_TIMEOUT_MILLISECONDS,
    ORG_OPERATIONS_FOLDER_NAME,
    ORG_OPERATION_RESULT_FILE_ATTEMPTS,
    SCRATCH_ORG_ALIAS_MAX_LENGTH,
    SCRATCH_ORG_DURATION_DAYS,
    ORG_OPERATION_REDACTED_VALUE,
    ScratchOrgService,
    ScratchOrgSetupPhase
} from '../ScratchOrgService';
import { ISalesforceCliInvocationResult, PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { IDevHubOrgDetail, TARGET_DEV_HUB_ENVIRONMENT_VARIABLE } from '../../SalesforceOrgService/SalesforceOrgService';

const MOCKS_PATH = path.join(__dirname, 'mocks');
const PROJECT_WORKSPACE_PATH = path.join(MOCKS_PATH, 'projectWorkspace');
const readFixture = (fixtureName: string) => fs.readFileSync(path.join(MOCKS_PATH, fixtureName), 'utf-8');

const SCRATCH_CREATE_SUCCESS = readFixture('scratchCreateSuccess.json');
const SCRATCH_CREATE_LIMIT_REACHED = readFixture('scratchCreateLimitReached.json');

const NEW_SCRATCH_USERNAME = 'test-newscratch@example.com';
const DEV_HUB_AUTHORIZATION = { username: 'hub@example.com', aliases: ['devhub'], isDevHub: true, instanceUrl: 'https://acme.my.salesforce.com' };

const CHOSEN_DEV_HUB: IDevHubOrgDetail = { targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub' };

const CHOSEN_ALIAS = 'qa-accounts';

const chooseChosenAlias = async (): Promise<IScratchOrgAliasChoice> => ({ alias: CHOSEN_ALIAS });

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

    const resolvePlan = async (chooseDevHub: () => Promise<IDevHubOrgDetail | undefined> = async () => CHOSEN_DEV_HUB,
                               chooseAlias: (devHub: IDevHubOrgDetail) => Promise<IScratchOrgAliasChoice | undefined> = chooseChosenAlias) => (
        await ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, chooseDevHub, chooseAlias)
    ) as IScratchOrgPlan;

    describe('validateScratchOrgAlias (#279)', () => {

        it('accepts letters, digits and . _ + -', () => {

            ['qa-accounts', 'UAT.2', 'a', 'team_one+data', 'x'.repeat(SCRATCH_ORG_ALIAS_MAX_LENGTH)].forEach(alias => {
                expect(ScratchOrgService.validateScratchOrgAlias(alias)).toBeUndefined();
            });

        });

        it('refuses an empty alias, and anything that is not a string', () => {

            expect(ScratchOrgService.validateScratchOrgAlias('')).toBe('Enter an alias for the new scratch org.');
            expect(ScratchOrgService.validateScratchOrgAlias(undefined)).toBe('Enter an alias for the new scratch org.');
            expect(ScratchOrgService.validateScratchOrgAlias(42)).toBe('Enter an alias for the new scratch org.');

        });

        it('refuses an alias that would read as a username, a flag, a path or two arguments', () => {

            expect(ScratchOrgService.validateScratchOrgAlias('qa@example.com')).toContain('"@"');
            ['-qa', 'qa accounts', 'qa"x', 'qa/x', 'qa\\x', '.', '..', 'qa\nx', 'qa;x', 'qa$x', '[qa](command:x)'].forEach(alias => {
                expect(ScratchOrgService.validateScratchOrgAlias(alias)).toBe('An alias is letters, digits and . _ + -, starts with a letter or digit, and does not end with ".".');
            });

        });

        it('refuses an alias that does not start with a letter or digit, or ends with "." (Windows strips it from a folder name)', () => {

            ['_qa', '+qa', '.qa', '...', 'qa.', 'qa..'].forEach(alias => {
                expect(ScratchOrgService.validateScratchOrgAlias(alias)).toBe('An alias is letters, digits and . _ + -, starts with a letter or digit, and does not end with ".".');
            });
            expect(ScratchOrgService.validateScratchOrgAlias('qa.v2')).toBeUndefined();

        });

        it('refuses a Windows device name, with or without an extension, in any case', () => {

            ['CON', 'con', 'Prn', 'aux', 'NUL', 'com1', 'LPT9', 'nul.txt', 'con.qa'].forEach(alias => {
                expect(ScratchOrgService.validateScratchOrgAlias(alias)).toBe(`"${alias}" is a name Windows reserves for a device, so it cannot be an alias.`);
            });
            ['console', 'auxiliary', 'com10', 'nullable'].forEach(alias => {
                expect(ScratchOrgService.validateScratchOrgAlias(alias)).toBeUndefined();
            });

        });

        it('refuses an alias longer than the limit', () => {

            expect(ScratchOrgService.validateScratchOrgAlias('x'.repeat(SCRATCH_ORG_ALIAS_MAX_LENGTH + 1))).toBe(`An alias is at most ${SCRATCH_ORG_ALIAS_MAX_LENGTH} characters.`);

        });

    });

    describe('resolveScratchOrgPlan', () => {

        it('resolves the definition file, the chosen Dev Hub, the alias and 7 days, names nothing to deploy (#358), and starts no process', async () => {

            const scratchOrgPlan = await resolvePlan();

            expect(scratchOrgPlan).not.toHaveProperty('packageDirectoryPaths');
            expect(scratchOrgPlan).not.toHaveProperty('hasFileOrEnvironmentReplacements');
            expect(scratchOrgPlan.definitionFilePath).toBe(path.join(path.resolve(workspaceRoot), 'config', 'project-scratch-def.json'));
            expect(scratchOrgPlan.definitionFileRelativePath).toBe(path.join('config', 'project-scratch-def.json'));
            expect(scratchOrgPlan.devHub).toEqual(CHOSEN_DEV_HUB);
            expect(scratchOrgPlan.alias).toBe(CHOSEN_ALIAS);
            expect(scratchOrgPlan.aliasHolderUsername).toBeUndefined();
            expect(scratchOrgPlan.durationDays).toBe(7);
            expect(scratchOrgPlan.definitionSummary).toEqual({ edition: 'Developer', adminEmail: undefined, username: undefined });
            expect(execFile).not.toHaveBeenCalled();

        });

        it('uses the Dev Hub the reader chose, whatever the CLI has set as its default (#243)', async () => {

            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });
            const otherDevHub: IDevHubOrgDetail = { targetOrgIdentifier: 'otherHub', username: 'other-hub@example.com', alias: 'otherHub' };

            expect(( await resolvePlan(async () => otherDevHub) ).devHub).toEqual(otherDevHub);
            expect(execFile).not.toHaveBeenCalled();

        });

        it('is no plan when no Dev Hub is chosen, and starts no process (#243)', async () => {

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, async () => undefined, chooseChosenAlias)).resolves.toBeUndefined();
            expect(execFile).not.toHaveBeenCalled();

        });

        it('asks for the alias after the Dev Hub, passing the chosen Dev Hub, and never when no Dev Hub was chosen (#279)', async () => {

            const chooseAlias = jest.fn(chooseChosenAlias);

            await resolvePlan(async () => CHOSEN_DEV_HUB, chooseAlias);
            expect(chooseAlias).toHaveBeenCalledWith(CHOSEN_DEV_HUB);

            chooseAlias.mockClear();
            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, async () => undefined, chooseAlias)).resolves.toBeUndefined();
            expect(chooseAlias).not.toHaveBeenCalled();

        });

        it('is no plan when the alias box is dismissed, and starts no process (#279)', async () => {

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, async () => CHOSEN_DEV_HUB, async () => undefined)).resolves.toBeUndefined();
            expect(execFile).not.toHaveBeenCalled();

        });

        it('checks the alias again whatever the box said, and refuses an unusable one before any process (#279)', async () => {

            await expect(resolvePlan(async () => CHOSEN_DEV_HUB, async () => ({ alias: '--json' }))).rejects.toThrow('No scratch org was created: An alias is letters');
            await expect(resolvePlan(async () => CHOSEN_DEV_HUB, async () => ({ alias: '' }))).rejects.toThrow('No scratch org was created: Enter an alias');
            await expect(resolvePlan(async () => CHOSEN_DEV_HUB, async () => ({ alias: '..' }))).rejects.toThrow('No scratch org was created');
            expect(execFile).not.toHaveBeenCalled();

        });

        it('carries the org that holds the alias now, so the modal can say it will be moved (#279)', async () => {

            const scratchOrgPlan = await resolvePlan(async () => CHOSEN_DEV_HUB, async () => ({ alias: 'uat', aliasHolderUsername: 'old-uat@example.com' }));

            expect(scratchOrgPlan.alias).toBe('uat');
            expect(scratchOrgPlan.aliasHolderUsername).toBe('old-uat@example.com');

        });

        it('checks the project before asking for a Dev Hub, so an undeployable project opens no picker (#243)', async () => {

            fs.rmSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'));
            const chooseDevHub = jest.fn(async () => CHOSEN_DEV_HUB);

            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, chooseDevHub, chooseChosenAlias)).rejects.toThrow('No scratch org definition file found');
            expect(chooseDevHub).not.toHaveBeenCalled();

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await expect(ScratchOrgService.resolveScratchOrgPlan(workspaceRoot, chooseDevHub, chooseChosenAlias)).rejects.toThrow('No "sfdx-project.json" found at');
            expect(chooseDevHub).not.toHaveBeenCalled();

        });

        it('refuses a missing config/project-scratch-def.json, naming the file it expected', async () => {

            fs.rmSync(path.join(workspaceRoot, 'config', 'project-scratch-def.json'));

            await expect(resolvePlan())
                .rejects.toThrow(`No scratch org definition file found at "${path.join(path.resolve(workspaceRoot), 'config', 'project-scratch-def.json')}"`);

        });

        it('refuses a definition file that resolves outside the workspace through a symlinked config folder', async () => {

            const outsideConfigPath = path.join(temporaryRoot, 'outsideConfig');
            fs.mkdirSync(outsideConfigPath);
            fs.writeFileSync(path.join(outsideConfigPath, 'project-scratch-def.json'), '{}');
            fs.rmSync(path.join(workspaceRoot, 'config'), { recursive: true });
            fs.symlinkSync(outsideConfigPath, path.join(workspaceRoot, 'config'), 'dir');

            await expect(resolvePlan()).rejects.toThrow('resolves outside this workspace');

        });

        it('refuses a missing sfdx-project.json before reading anything else', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            fs.rmSync(path.join(workspaceRoot, '.sf'), { recursive: true });

            await expect(resolvePlan()).rejects.toThrow('No "sfdx-project.json" found at');

        });

        it('refuses an unparseable sfdx-project.json', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ "packageDirectories": [');

            await expect(resolvePlan()).rejects.toThrow('as JSON');

        });

    });

    describe('the argv', () => {

        const PLAN: IScratchOrgPlan = {
            workspaceRoot: '/workspace',
            definitionFilePath: '/workspace/config/project-scratch-def.json',
            definitionFileRelativePath: 'config/project-scratch-def.json',
            devHub: { targetOrgIdentifier: 'devhub', username: 'hub@example.com', alias: 'devhub', configSource: 'project' },
            alias: 'qa-accounts',
            durationDays: SCRATCH_ORG_DURATION_DAYS,
            definitionSummary: {}
        };

        it('creates with the definition file relative to the workspace, the alias the reader chose, 7 days and the chosen Dev Hub by USERNAME (#243)', () => {

            expect(ScratchOrgService.buildScratchOrgCreateArguments(PLAN)).toEqual([
                'org', 'create', 'scratch',
                '--definition-file', 'config/project-scratch-def.json',
                '--alias', 'qa-accounts',
                '--duration-days', '7',
                '--target-dev-hub', 'hub@example.com',
                '--json'
            ]);

        });

        it('refuses an identifier that would read as a flag', () => {

            expect(() => ScratchOrgService.buildScratchOrgCreateArguments({ ...PLAN, devHub: { ...PLAN.devHub, username: '--json' } })).toThrow('is not a usable Salesforce org alias or username');

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

        // #358: "+ New scratch org" CREATES AND SELECTS; WHAT REACHES THE ORG IS THE READER'S TO DEPLOY
        it('builds no "sf project deploy" argv in the scratch org service', () => {

            expect(fs.readFileSync(path.join(__dirname, '..', 'ScratchOrgService.ts'), 'utf-8')).not.toMatch(/['"]project['"]\s*,\s*['"]deploy['"]/);
            expect(ScratchOrgService).not.toHaveProperty('buildSourceDeployArguments');
            expect(ScratchOrgService).not.toHaveProperty('parseSourceDeployOutput');

        });

    });

    describe('opening an org in the browser (#279)', () => {

        const ORG_OPEN_URL = 'https://acme--uat.sandbox.my.salesforce.com/secur/frontdoor.jsp?sid=00D000000000001!AQEAQsecret';

        it('asks for the URL only, by USERNAME, as JSON', () => {

            expect(ScratchOrgService.buildOrgOpenArguments('uat@example.com')).toEqual(['org', 'open', '--target-org', 'uat@example.com', '--url-only', '--json']);
            expect(() => ScratchOrgService.buildOrgOpenArguments('--json')).toThrow('is not a usable Salesforce org alias or username');

        });

        it('opens an https: URL the CLI answered with on status 0', () => {

            expect(ScratchOrgService.parseOrgOpenOutput(invocation(JSON.stringify({ status: 0, result: { orgId: '00D000000000001', url: ORG_OPEN_URL, username: 'uat@example.com' } }))))
                .toEqual({ isOpenable: true, url: ORG_OPEN_URL });

        });

        it('opens nothing that is not https:', () => {

            ['http://acme.my.salesforce.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'command:workbench.action.terminal.new', 'not a url'].forEach(url => {
                const parseResult = ScratchOrgService.parseOrgOpenOutput(invocation(JSON.stringify({ status: 0, result: { url } })));
                expect(parseResult).toEqual({ isOpenable: false, failureMessage: 'The Salesforce CLI answered with an address that is not https, so it was not opened.' });
            });

        });

        it('opens nothing for an answer with no URL, a non-zero status or output that is not JSON', () => {

            expect(ScratchOrgService.parseOrgOpenOutput(invocation(JSON.stringify({ status: 0, result: { url: 42 } }))))
                .toEqual({ isOpenable: false, failureMessage: 'The Salesforce CLI answered without an address to open.' });
            expect(ScratchOrgService.parseOrgOpenOutput(invocation(JSON.stringify({ status: 0, result: [ORG_OPEN_URL] }))))
                .toEqual({ isOpenable: false, failureMessage: 'The Salesforce CLI answered without an address to open.' });
            expect(ScratchOrgService.parseOrgOpenOutput(invocation(JSON.stringify({ status: 1, name: 'NoAuthInfoFound', message: 'No authorization information found for uat@example.com.' }), 1)))
                .toEqual({ isOpenable: false, failureMessage: 'NoAuthInfoFound: No authorization information found for uat@example.com.' });
            expect(ScratchOrgService.parseOrgOpenOutput(invocation('not json', 1)).isOpenable).toBe(false);

        });

        it('never quotes a session id from the output in a failure message', () => {

            const parseResult = ScratchOrgService.parseOrgOpenOutput({ stdout: 'not json', stderr: `Opening ${ORG_OPEN_URL}`, exitCode: 1 });

            expect(parseResult.isOpenable).toBe(false);
            expect(JSON.stringify(parseResult)).not.toContain('AQEAQsecret');

        });

        it('redacts a frontdoor address however its session parameter is spelled', () => {

            ['https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=abc.def', 'https://acme.my.salesforce.com/secur/frontdoor.jsp?otp=one-time&startURL=%2F', 'http://x.example.com/a?b=1&SID=zzz'].forEach(address => {
                const redactedText = ScratchOrgService.redactSecretText(`failed to open ${address} in time`);
                expect(redactedText).toBe(`failed to open ${ORG_OPERATION_REDACTED_VALUE} in time`);
            });
            expect(ScratchOrgService.redactSecretText('see https://help.salesforce.com/s/?language=en_US')).toBe('see https://help.salesforce.com/s/?language=en_US');

        });

        it('says the CLI is required when it is not installed, and says a timeout is one', () => {

            expect(ScratchOrgService.parseOrgOpenOutput({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }))
                .toEqual({ isOpenable: false, failureMessage: expect.stringContaining('is required to open an org') });
            expect(ScratchOrgService.parseOrgOpenOutput({ stdout: '', stderr: '', exitCode: null, timedOut: true }))
                .toEqual({ isOpenable: false, failureMessage: 'The Salesforce CLI did not answer in time.' });

        });

        it('runs "sf org open" with no working directory, not in project mode', async () => {

            const cliCalls: Array<{ argumentList: string[]; options: Record<string, unknown> }> = [];
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], options: Record<string, unknown>, callback: Function) => {
                cliCalls.push({ argumentList, options });
                setImmediate(() => callback(null, JSON.stringify({ status: 0, result: { url: ORG_OPEN_URL } }), ''));
                return { kill: jest.fn() };
            });

            await expect(ScratchOrgService.resolveOrgOpenUrl('uat@example.com')).resolves.toEqual({ isOpenable: true, url: ORG_OPEN_URL });
            expect(cliCalls).toHaveLength(1);
            expect(cliCalls[0].argumentList).toEqual(['org', 'open', '--target-org', 'uat@example.com', '--url-only', '--json']);
            expect(cliCalls[0].options.cwd).toBeUndefined();
            expect(ORG_OPEN_TIMEOUT_MILLISECONDS).toBeGreaterThan(0);

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

        it('are failures of the create, naming the spawn error', () => {

            expect(ScratchOrgService.parseScratchOrgCreateOutput(invocation('', null, { spawnError }))).toEqual({ isCreated: false, failureMessage: 'The Salesforce CLI could not be started: spawn EACCES' });

        });

    });

    // READ BY THE TROUBLESHOOTING TAB'S DEPLOYS (#346); THE SCRATCH ORG RUN DEPLOYS NOTHING SINCE #358
    describe('readDeployComponentCounts', () => {

        it('reads a malformed answer as a failure with nothing counted, and counts the successes, never package.xml, when the CLI gives no total', () => {

            [undefined, {}, { status: 0 }, { status: 0, result: null }, { status: 0, result: [] }, { status: 0, result: 'x' }].forEach(payload => {
                expect(ScratchOrgService.readDeployComponentCounts(payload as Record<string, unknown> | undefined))
                    .toEqual({ isSucceeded: false, componentSuccessCount: 0, componentFailureCount: 0 });
            });

            const withoutTotal = { status: 0, result: { success: true, details: { componentSuccesses: [{ fullName: 'package.xml' }, { fullName: 'Account' }, { fullName: 'Contact' }] } } };
            expect(ScratchOrgService.readDeployComponentCounts(withoutTotal)).toEqual({ isSucceeded: true, componentSuccessCount: 2, componentFailureCount: 0 });
            expect(ScratchOrgService.readDeployComponentCounts({ ...withoutTotal, result: { ...withoutTotal.result, numberComponentsDeployed: 3 } }))
                .toEqual({ isSucceeded: true, componentSuccessCount: 2, componentFailureCount: 0, numberComponentsDeployed: 3 });

        });

        it.each([
            ['a non-zero status', { status: 1, result: { success: true } }],
            ['success not literally true', { status: 0, result: { success: 'true' } }],
            ['one component failure written as an object', { status: 0, result: { success: true, details: { componentFailures: { fullName: 'Account' } } } }]
        ])('is a failure on %s', (_label, payload) => {

            expect(ScratchOrgService.readDeployComponentCounts(payload as Record<string, unknown>).isSucceeded).toBe(false);

        });

    });

    describe('writeOrgOperationResult', () => {

        it('wraps output that is not JSON with its stderr and exit status', () => {

            const resultFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'treecipe-x', 'scratch-create', { stdout: 'not json', stderr: 'boom', exitCode: 1 }, PLAN_DATE);

            expect(JSON.parse(fs.readFileSync(resultFilePath, 'utf-8'))).toEqual({ stdout: 'not json', stderr: 'boom', exitCode: 1 });

        });

        // TWO OPERATIONS IN ONE SECOND -- A SECOND METADATA DEPLOY (#211) -- KEEP BOTH RESULTS
        it('writes a later result of the same second beside the first as <name>-2, never over it', () => {

            const firstFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'permission-set-assign', invocation('{"status":0}'), PLAN_DATE);
            const secondFilePath = ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'permission-set-assign', invocation('{"status":1}'), PLAN_DATE);

            expect(path.basename(firstFilePath)).toBe('20261010-142233-permission-set-assign.json');
            expect(path.basename(secondFilePath)).toBe('20261010-142233-permission-set-assign-2.json');
            expect(JSON.parse(fs.readFileSync(firstFilePath, 'utf-8'))).toEqual({ status: 0 });
            expect(JSON.parse(fs.readFileSync(secondFilePath, 'utf-8'))).toEqual({ status: 1 });

        });

        it('answers undefined once every name of the second is taken, rather than writing over one', () => {

            const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((filePath: fs.PathOrFileDescriptor) => {
                if ( String(filePath).endsWith('.json') ) {
                    throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
                }
            });

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'permission-set-assign', invocation('{}'), PLAN_DATE)).toBeUndefined();
            expect(writeSpy.mock.calls.filter(([filePath]) => String(filePath).endsWith('.json'))).toHaveLength(ORG_OPERATION_RESULT_FILE_ATTEMPTS);

        });

        it('stops at a write that fails for any reason but an existing file, rather than trying the next name', () => {

            const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((filePath: fs.PathOrFileDescriptor) => {
                if ( String(filePath).endsWith('.json') ) {
                    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
                }
            });

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'qa@example.com', 'permission-set-assign', invocation('{}'), PLAN_DATE)).toBeUndefined();
            expect(writeSpy.mock.calls.filter(([filePath]) => String(filePath).endsWith('.json'))).toHaveLength(1);

        });

        it('writes nothing for an unusable folder name, and answers undefined when the write fails', () => {

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, '..', 'scratch-create', invocation('{}'), PLAN_DATE)).toBeUndefined();

            fs.writeFileSync(path.join(workspaceRoot, 'treecipe'), 'a file where the folder goes');

            expect(ScratchOrgService.writeOrgOperationResult(workspaceRoot, 'treecipe-x', 'scratch-create', invocation('{}'), PLAN_DATE)).toBeUndefined();

        });

    });

    describe('buildOrgOperationResultFilePath', () => {

        it('is treecipe/OrgOperations/<folder>/<timestamp>-<operation>.json', () => {

            expect(ScratchOrgService.buildOrgOperationResultFilePath(workspaceRoot, NEW_SCRATCH_USERNAME, 'scratch-create', PLAN_DATE))
                .toBe(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME, '20261010-142233-scratch-create.json'));

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
            const scratchOrgPlan = await resolvePlan();
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

        it('only creates (#358): ONE process, with the workspace as the working directory, through execFile with no shell, and saves its result', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_SUCCESS }]);

            const { outcome, reportedPhases } = await runSetup();

            expect(reportedPhases).toEqual(['creating']);
            expect(cliCalls).toHaveLength(1);
            expect(cliCalls[0].argumentList.slice(0, 3)).toEqual(['org', 'create', 'scratch']);
            expect(cliCalls[0].command).toBe(process.platform === 'win32' ? `"${installedSalesforceCliPath}"` : installedSalesforceCliPath);
            expect(cliCalls[0].options).toMatchObject({ shell: process.platform === 'win32', cwd: path.resolve(workspaceRoot), maxBuffer: 1024 * 1024 * 8 });
            expect(cliCalls[0].argumentList).toEqual(expect.arrayContaining(['--alias', CHOSEN_ALIAS]));

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME);
            expect(outcome).toEqual({ kind: 'created', username: NEW_SCRATCH_USERNAME, outputFilePath: path.join(operationsFolderPath, '20261010-142233-scratch-create.json') });
            expect(fs.readdirSync(operationsFolderPath)).toEqual(['20261010-142233-scratch-create.json']);

            // THE CREATE'S authFields CARRY THE NEW ORG'S ACCESS TOKEN, AND THE FOLDER SITS IN A WORKSPACE THAT IS USUALLY COMMITTED
            const savedCreate = fs.readFileSync(path.join(operationsFolderPath, '20261010-142233-scratch-create.json'), 'utf-8');
            expect(savedCreate).not.toContain('accessToken');
            expect(savedCreate).not.toContain('00D000000000077!REDACTED');
            expect(JSON.parse(savedCreate).result.username).toBe(NEW_SCRATCH_USERNAME);
            expect(fs.readFileSync(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, '.gitignore'), 'utf-8')).toBe('*\n');

        });

        it('saves a failed create\'s output under the requested alias', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_LIMIT_REACHED, error: exitError(1) }]);

            const { outcome } = await runSetup();

            expect(cliCalls).toHaveLength(1);
            expect(outcome.kind).toBe('createFailed');
            expect(( outcome as { outputFilePath: string } ).outputFilePath)
                .toBe(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, 'qa-accounts', '20261010-142233-scratch-create.json'));

        });

        it('leaves no file and no org behind when sf is not installed', async () => {

            answerCliCalls([{ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }]);

            const { outcome } = await runSetup();

            expect(outcome).toEqual({ kind: 'createFailed', failureMessage: ScratchOrgService.buildCliRequiredMessage(), outputFilePath: undefined });
            expect(fs.existsSync(path.join(workspaceRoot, 'treecipe'))).toBe(false);

        });

        it('on Windows creates nothing from a UNC project folder, which cmd.exe would swap for the Windows folder, and says how to open it instead (#285)', async () => {

            answerCliCalls([{ stdout: SCRATCH_CREATE_SUCCESS }]);
            const uncWorkspaceRoot = '\\\\wsl.localhost\\Ubuntu\\home\\me\\project';
            const scratchOrgPlan = { ...await resolvePlan(), workspaceRoot: uncWorkspaceRoot };
            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);

            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, {
                onPhase: () => undefined,
                registerCancellation: () => undefined,
                isCancellationRequested: () => false,
                now: () => PLAN_DATE
            });

            expect(cliCalls).toHaveLength(0);
            expect(outcome).toMatchObject({ kind: 'createFailed', outputFilePath: undefined });
            expect(( outcome as { failureMessage: string } ).failureMessage).toContain(`"${uncWorkspaceRoot}" is a network UNC path`);

        });

        it('kills the create and reports nothing about an org when cancelled during it', async () => {

            answerCliCalls([{ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }]);

            const { outcome } = await runSetup({ requestedAtPhase: 'creating' });

            expect(killedProcessCount).toBe(1);
            expect(cliCalls).toHaveLength(1);
            expect(outcome).toEqual({ kind: 'createCancelled' });

        });

        it('reports a create that answered malformed JSON as a failure, selecting nothing', async () => {

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

            const scratchOrgPlan = await resolvePlan();
            const outcome = await ScratchOrgService.runScratchOrgSetup(scratchOrgPlan, { onPhase: jest.fn(), registerCancellation: jest.fn(), isCancellationRequested: () => isCancelled, now: () => PLAN_DATE });

            const createFilePath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, NEW_SCRATCH_USERNAME, '20261010-142233-scratch-create.json');
            expect(outcome).toEqual({ kind: 'created', username: NEW_SCRATCH_USERNAME, outputFilePath: createFilePath });
            expect(fs.existsSync(createFilePath)).toBe(true);

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

            await expect(resolvePlan()).rejects.toThrow('The package directory "unpackaged"');

        });

    });

});
