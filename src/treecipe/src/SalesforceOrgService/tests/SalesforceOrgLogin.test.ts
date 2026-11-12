import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@salesforce/core', () => ({
    WebOAuthServer: { create: jest.fn() },
    StateAggregator: { clearInstance: jest.fn(), getInstance: jest.fn() }
}));

import { StateAggregator, WebOAuthServer } from '@salesforce/core';

import {
    IOrgLoginRun,
    LOGIN_URL_REFUSAL,
    SalesforceOrgLogin,
    SANDBOX_LOGIN_URL,
    SANDBOX_SUBDOMAIN_REFUSAL
} from '../SalesforceOrgLogin';

const AUTHORIZATION_URL = 'https://test.salesforce.com/services/oauth2/authorize?client_id=PlatformCLI&state=abc';
const ACCESS_TOKEN = '00D000000000001!AQEAQaccessTokenSecret';
const QA_USERNAME = 'qa@example.com.qa';

interface IFakeOauthServer {
    start: jest.Mock;
    getAuthorizationUrl: jest.Mock;
    authorizeAndSave: jest.Mock;
    webServer: { close: jest.Mock };
}

function buildFakeOauthServer(authorizeAndSave: () => Promise<unknown>): IFakeOauthServer {
    return {
        start: jest.fn().mockResolvedValue(undefined),
        getAuthorizationUrl: jest.fn().mockReturnValue(AUTHORIZATION_URL),
        authorizeAndSave: jest.fn().mockImplementation(authorizeAndSave),
        webServer: { close: jest.fn() }
    };
}

function buildAuthInfo(username: string) {
    return { getUsername: () => username, getFields: () => ({ username: username, accessToken: ACCESS_TOKEN }) };
}

function buildLoginRun(overrides: Partial<IOrgLoginRun> = {}): IOrgLoginRun & { openLoginPage: jest.Mock } {
    return {
        openLoginPage: jest.fn().mockResolvedValue(true),
        onCancellationRequested: () => undefined,
        ...overrides
    } as IOrgLoginRun & { openLoginPage: jest.Mock };
}

describe('SalesforceOrgLogin (#630)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('normalizeLoginUrl and validateLoginUrl', () => {

        it('accepts the sandbox address and an org\'s My Domain address, answered as a bare https origin', () => {

            expect(SalesforceOrgLogin.normalizeLoginUrl(SANDBOX_LOGIN_URL)).toBe(SANDBOX_LOGIN_URL);
            expect(SalesforceOrgLogin.normalizeLoginUrl('  https://TEST.salesforce.com/  ')).toBe(SANDBOX_LOGIN_URL);
            expect(SalesforceOrgLogin.normalizeLoginUrl('https://acme--qa.sandbox.my.salesforce.com')).toBe('https://acme--qa.sandbox.my.salesforce.com');
            expect(SalesforceOrgLogin.validateLoginUrl('https://acme--qa.sandbox.my.salesforce.com/')).toBeUndefined();

        });

        it.each([
            ['http, not https', 'http://test.salesforce.com'],
            ['a host that is not Salesforce\'s', 'https://test.salesforce.com.evil.example.com'],
            ['a look-alike suffix', 'https://evilmy.salesforce.com'],
            ['the bare suffix', 'https://.my.salesforce.com'],
            ['production\'s shared login', 'https://login.salesforce.com'],
            ['a user name in the address', 'https://someone@test.salesforce.com'],
            ['a port', 'https://test.salesforce.com:8443'],
            ['a path', 'https://test.salesforce.com/services/oauth2/authorize'],
            ['a query', 'https://test.salesforce.com/?startURL=x'],
            ['text that is not an address', 'qa sandbox'],
            ['nothing', ''],
            ['a value that is not text', 42]
        ])('refuses %s', (_caseName, loginUrl) => {

            expect(SalesforceOrgLogin.normalizeLoginUrl(loginUrl)).toBeUndefined();
            expect(SalesforceOrgLogin.validateLoginUrl(loginUrl)).toBe(LOGIN_URL_REFUSAL);

        });

    });

    describe('buildSandboxLoginUrl and validateSandboxSubdomain', () => {

        const QA_SANDBOX_LOGIN_URL = 'https://acme--qa.sandbox.my.salesforce.com';

        it.each([
            ['the subdomain', 'acme--qa'],
            ['the subdomain with spaces and capitals', '  ACME--QA '],
            ['the whole address', 'https://acme--qa.sandbox.my.salesforce.com'],
            ['the whole address with a trailing slash', 'https://acme--qa.sandbox.my.salesforce.com/'],
            ['the whole address with https\'s own port, which the address drops', 'https://acme--qa.sandbox.my.salesforce.com:443'],
            ['the host without https://', 'acme--qa.sandbox.my.salesforce.com']
        ])('answers the sandbox login address for %s', (_caseName, typedSubdomain) => {

            expect(SalesforceOrgLogin.buildSandboxLoginUrl(typedSubdomain)).toBe(QA_SANDBOX_LOGIN_URL);
            expect(SalesforceOrgLogin.validateSandboxSubdomain(typedSubdomain)).toBeUndefined();

        });

        it('accepts single hyphens on either side of the "--", and answers an address normalizeLoginUrl accepts', () => {

            const loginUrl = SalesforceOrgLogin.buildSandboxLoginUrl('my-co--uat-2');

            expect(loginUrl).toBe('https://my-co--uat-2.sandbox.my.salesforce.com');
            expect(SalesforceOrgLogin.normalizeLoginUrl(loginUrl)).toBe(loginUrl);

        });

        it.each([
            ['nothing', ''],
            ['only spaces', '   '],
            ['a production My Domain name, with no "--"', 'acme'],
            ['a Developer Edition name', 'acme-dev-ed'],
            ['a leading hyphen', '-acme--qa'],
            ['a trailing hyphen', 'acme--qa-'],
            ['two "--"', 'a--b--c'],
            ['a triple hyphen', 'acme---qa'],
            ['a slash', 'acme--qa/x'],
            ['an at sign', 'someone@acme--qa'],
            ['a question mark', 'acme--qa?x'],
            ['a hash', 'acme--qa#x'],
            ['a space inside', 'acme --qa'],
            ['an underscore', 'acme--q_a'],
            ['a subdomain longer than a DNS label', `${'a'.repeat(30)}--${'b'.repeat(32)}`],
            ['another host', 'acme--qa.evil.com'],
            ['a sandbox host under another host', 'acme--qa.sandbox.my.salesforce.com.evil.com'],
            ['a production My Domain address', 'https://acme.my.salesforce.com'],
            ['a Developer Edition address', 'https://acme--qa.develop.my.salesforce.com'],
            ['the shared sandbox login', SANDBOX_LOGIN_URL],
            ['http, not https', 'http://acme--qa.sandbox.my.salesforce.com'],
            ['a port', 'https://acme--qa.sandbox.my.salesforce.com:8443'],
            ['a path', 'https://acme--qa.sandbox.my.salesforce.com/path'],
            ['a query', 'https://acme--qa.sandbox.my.salesforce.com/?q=1'],
            ['a user name in the address', 'https://someone@acme--qa.sandbox.my.salesforce.com'],
            ['a nested subdomain', 'x.acme--qa.sandbox.my.salesforce.com'],
            ['a value that is not text', 42]
        ])('refuses %s', (_caseName, typedSubdomain) => {

            expect(SalesforceOrgLogin.buildSandboxLoginUrl(typedSubdomain)).toBeUndefined();
            expect(SalesforceOrgLogin.validateSandboxSubdomain(typedSubdomain)).toBe(SANDBOX_SUBDOMAIN_REFUSAL);

        });

    });

    describe('authorizeWithBrowser', () => {

        it('opens core\'s authorization address, answers the username, and closes the local server', async () => {

            const oauthServer = buildFakeOauthServer(() => Promise.resolve(buildAuthInfo(QA_USERNAME)));
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);
            const loginRun = buildLoginRun();

            const loginOutcome = await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, loginRun);

            expect(loginOutcome).toEqual({ kind: 'authorized', username: QA_USERNAME });
            expect(WebOAuthServer.create).toHaveBeenCalledWith({ oauthConfig: { loginUrl: SANDBOX_LOGIN_URL } });
            expect(loginRun.openLoginPage).toHaveBeenCalledWith(AUTHORIZATION_URL);
            expect(oauthServer.webServer.close).toHaveBeenCalled();
            expect(StateAggregator.getInstance).not.toHaveBeenCalled();
            expect(JSON.stringify(loginOutcome)).not.toContain(ACCESS_TOKEN);

        });

        it('refuses an address that is not a Salesforce login page before any server starts', async () => {

            expect(await SalesforceOrgLogin.authorizeWithBrowser('https://evil.example.com', buildLoginRun()))
                .toEqual({ kind: 'failed', failureMessage: LOGIN_URL_REFUSAL });
            expect(WebOAuthServer.create).not.toHaveBeenCalled();

        });

        it.each([
            ['core\'s PortInUseError', Object.assign(new Error('Cannot start the OAuth redirect server on port 1717.'), { name: 'PortInUseError' })],
            ['the socket\'s EADDRINUSE', Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })]
        ])('answers portInUse for %s and opens no browser', async (_caseName, startError) => {

            const oauthServer = buildFakeOauthServer(() => Promise.resolve(buildAuthInfo(QA_USERNAME)));
            oauthServer.start.mockRejectedValue(startError);
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);
            const loginRun = buildLoginRun();

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, loginRun)).toEqual({ kind: 'portInUse' });
            expect(loginRun.openLoginPage).not.toHaveBeenCalled();

        });

        it('answers cancelled when the caller cancels, and closes the local server so the port is free', async () => {

            const oauthServer = buildFakeOauthServer(() => new Promise(() => undefined));
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);
            let cancelLogin: () => void = () => undefined;
            const loginRun = buildLoginRun({
                onCancellationRequested: cancel => { cancelLogin = cancel; },
                openLoginPage: jest.fn().mockImplementation(async () => { cancelLogin(); return true; })
            });

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, loginRun)).toEqual({ kind: 'cancelled' });
            expect(oauthServer.webServer.close).toHaveBeenCalled();

        });

        it('honours a cancel while the browser has still not reported that it opened', async () => {

            const oauthServer = buildFakeOauthServer(() => new Promise(() => undefined));
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);
            let cancelLogin: () => void = () => undefined;
            const loginRun = buildLoginRun({
                onCancellationRequested: cancel => { cancelLogin = cancel; },
                openLoginPage: jest.fn().mockImplementation(() => { setImmediate(cancelLogin); return new Promise<boolean>(() => undefined); })
            });

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, loginRun)).toEqual({ kind: 'cancelled' });
            expect(oauthServer.webServer.close).toHaveBeenCalled();

        });

        it('sets no alias itself: the caller does, once it knows which kind of org answered', async () => {

            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(buildFakeOauthServer(() => Promise.resolve(buildAuthInfo(QA_USERNAME))));

            await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, buildLoginRun());

            expect(StateAggregator.getInstance).not.toHaveBeenCalled();

        });

        it('answers timedOut when no login is completed in time', async () => {

            const oauthServer = buildFakeOauthServer(() => new Promise(() => undefined));
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, buildLoginRun({ timeoutMilliseconds: 5 })))
                .toEqual({ kind: 'timedOut' });
            expect(oauthServer.webServer.close).toHaveBeenCalled();

        });

        it('answers failed with one short line when the login is refused', async () => {

            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(buildFakeOauthServer(() => Promise.reject(new Error(`end-user denied\nauthorization ${'x'.repeat(500)}`))));

            const loginOutcome = await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, buildLoginRun());

            expect(loginOutcome.kind).toBe('failed');
            const failureMessage = ( loginOutcome as { failureMessage: string } ).failureMessage;
            expect(failureMessage).toStartWith('end-user denied authorization');
            expect(failureMessage).not.toContain('\n');
            expect(failureMessage.length).toBeLessThanOrEqual(300);

        });

        it('answers failed when the browser cannot be opened, and closes the local server', async () => {

            const oauthServer = buildFakeOauthServer(() => new Promise(() => undefined));
            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(oauthServer);

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, buildLoginRun({ openLoginPage: jest.fn().mockResolvedValue(false) })))
                .toEqual({ kind: 'failed', failureMessage: 'the login page could not be opened in a browser' });
            expect(oauthServer.webServer.close).toHaveBeenCalled();

        });

        it('answers failed when the login names no usable username', async () => {

            ( WebOAuthServer.create as jest.Mock ).mockResolvedValue(buildFakeOauthServer(() => Promise.resolve(buildAuthInfo('--target-org'))));

            expect(await SalesforceOrgLogin.authorizeWithBrowser(SANDBOX_LOGIN_URL, buildLoginRun()))
                .toEqual({ kind: 'failed', failureMessage: 'the login answered with a username this extension cannot use, so it is not listed here' });

        });

    });

    describe('setAlias', () => {

        it('sets the alias on the username, read from fresh state', async () => {

            const setAndSave = jest.fn().mockResolvedValue(undefined);
            ( StateAggregator.getInstance as jest.Mock ).mockResolvedValue({ aliases: { setAndSave: setAndSave } });

            expect(await SalesforceOrgLogin.setAlias('qa', QA_USERNAME)).toBeUndefined();
            expect(StateAggregator.clearInstance).toHaveBeenCalled();
            expect(setAndSave).toHaveBeenCalledWith('qa', QA_USERNAME);

        });

        it('answers why, in one line, when the alias cannot be set', async () => {

            ( StateAggregator.getInstance as jest.Mock ).mockResolvedValue({ aliases: { setAndSave: jest.fn().mockRejectedValue(new Error('alias file\nis locked')) } });

            expect(await SalesforceOrgLogin.setAlias('qa', QA_USERNAME)).toBe('alias file is locked');

        });

    });

    describe('writeWorkspaceTargetOrg', () => {

        let workspaceRoot: string;

        beforeEach(() => {
            workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-org-login-'));
        });

        afterEach(() => {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        });

        const readConfig = () => JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.sf', 'config.json'), 'utf8'));

        it('creates .sf/config.json with target-org when the workspace has none', () => {

            expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa')).toEqual({ isWritten: true });
            expect(readConfig()).toEqual({ 'target-org': 'qa' });

        });

        it('replaces target-org and keeps every other key', () => {

            fs.mkdirSync(path.join(workspaceRoot, '.sf'));
            fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), JSON.stringify({ 'target-dev-hub': 'hub', 'target-org': 'old' }));

            expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, QA_USERNAME)).toEqual({ isWritten: true });
            expect(readConfig()).toEqual({ 'target-dev-hub': 'hub', 'target-org': QA_USERNAME });

        });

        it.each([
            ['an array', '[]'],
            ['text that is not JSON', 'target-org=old']
        ])('leaves a config that is %s as it was and says how to set the default by hand', (_caseName, configText) => {

            fs.mkdirSync(path.join(workspaceRoot, '.sf'));
            fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), configText);

            const targetOrgWrite = SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa');

            expect(targetOrgWrite.isWritten).toBeFalse();
            expect(( targetOrgWrite as { failureMessage: string } ).failureMessage).toEndWith('Set it with "sf config set target-org=qa".');
            expect(fs.readFileSync(path.join(workspaceRoot, '.sf', 'config.json'), 'utf8')).toBe(configText);

        });

        it('leaves a config.json that is a folder, or over 1 MB, as it was', () => {

            fs.mkdirSync(path.join(workspaceRoot, '.sf', 'config.json'), { recursive: true });
            expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa')).toMatchObject({ isWritten: false, failureMessage: expect.stringContaining('is not a file this extension can update') });

            fs.rmdirSync(path.join(workspaceRoot, '.sf', 'config.json'));
            const oversizedConfigText = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) });
            fs.writeFileSync(path.join(workspaceRoot, '.sf', 'config.json'), oversizedConfigText);
            expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa').isWritten).toBeFalse();
            expect(fs.readFileSync(path.join(workspaceRoot, '.sf', 'config.json'), 'utf8')).toBe(oversizedConfigText);

        });

        it('answers a failure, never throws, when .sf cannot be made', () => {

            fs.writeFileSync(path.join(workspaceRoot, '.sf'), 'a file where the folder belongs');

            const targetOrgWrite = SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa');

            expect(targetOrgWrite.isWritten).toBeFalse();
            expect(( targetOrgWrite as { failureMessage: string } ).failureMessage).not.toMatch(/[()]/);

        });

        it('writes nothing through a .sf that links outside the workspace', () => {

            const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-org-login-outside-'));

            try {
                fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, '.sf'), 'dir');

                const targetOrgWrite = SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa');

                expect(targetOrgWrite.isWritten).toBeFalse();
                expect(( targetOrgWrite as { failureMessage: string } ).failureMessage).toStartWith('.sf points outside this workspace.');
                expect(fs.readdirSync(outsideFolderPath)).toEqual([]);
            } finally {
                fs.rmSync(outsideFolderPath, { recursive: true, force: true });
            }

        });

        it('writes nothing through a config.json that is a link', () => {

            const outsideFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdt-org-login-outside-')), 'elsewhere.json');
            fs.writeFileSync(outsideFilePath, '{}');

            try {
                fs.mkdirSync(path.join(workspaceRoot, '.sf'));
                fs.symlinkSync(outsideFilePath, path.join(workspaceRoot, '.sf', 'config.json'), 'file');

                expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, 'qa').isWritten).toBeFalse();
                expect(fs.readFileSync(outsideFilePath, 'utf8')).toBe('{}');
            } finally {
                fs.rmSync(path.dirname(outsideFilePath), { recursive: true, force: true });
            }

        });

        it('refuses an identifier the CLI could not be handed', () => {

            expect(SalesforceOrgLogin.writeWorkspaceTargetOrg(workspaceRoot, '--global')).toEqual({ isWritten: false, failureMessage: 'the org has no usable alias or username' });
            expect(fs.existsSync(path.join(workspaceRoot, '.sf'))).toBeFalse();

        });

    });

});
