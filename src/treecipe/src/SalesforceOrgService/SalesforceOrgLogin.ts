import { StateAggregator } from '@salesforce/core';
import { ISalesforceCliInvocationResult, SalesforceCli } from '../SalesforceCli/SalesforceCli';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

import * as fs from 'fs';
import * as path from 'path';

/*
    "Authorize org" (#630): a browser login to an existing org run by the Salesforce CLI itself
    ("sf org login web"), so the authorization is saved by the CLI's own @salesforce/core, with the
    encryption key the CLI's own environment selects, and every later sf command can use it. A
    login saved by the extension's in-process core was not always readable by the CLI. No vscode:
    the caller hands in how a cancel arrives. Nothing here returns, logs or quotes a token; the
    CLI's answer carries the access token, so only its username is read from it.
*/
export const SANDBOX_LOGIN_URL = 'https://test.salesforce.com';

// A LOGIN PAGE IS A SANDBOX'S SHARED ADDRESS OR AN ORG'S OWN MY DOMAIN, AND NOTHING ELSE
const MY_DOMAIN_HOST_SUFFIX = '.my.salesforce.com';

export const LOGIN_URL_REFUSAL = `Enter ${SANDBOX_LOGIN_URL} or the org's My Domain address, for example https://acme--qa.sandbox.my.salesforce.com.`;

export const ORG_LOGIN_TIMEOUT_MILLISECONDS = 5 * 60 * 1000;

const LOGIN_FAILURE_MESSAGE_MAX_LENGTH = 300;

// core's WebOAuthServer reports a busy local login port as messages.createError('portInUse')
const CLI_PORT_IN_USE_ERROR_NAME = 'PortInUseError';

export const CLI_NOT_FOUND_FAILURE_MESSAGE = 'the Salesforce CLI, sf, is not installed or not on PATH. Install it, or add it to PATH and restart VS Code';

const WORKSPACE_CONFIG_FOLDER_NAME = '.sf';
const WORKSPACE_CONFIG_FILE_NAME = 'config.json';
const WORKSPACE_CONFIG_MAX_BYTES = 1024 * 1024;
const TARGET_ORG_CONFIG_KEY = 'target-org';

export type OrgLoginOutcome =
    | { kind: 'authorized'; username: string }
    | { kind: 'cancelled' }
    | { kind: 'timedOut' }
    | { kind: 'portInUse' }
    | { kind: 'failed'; failureMessage: string };

export interface IOrgLoginRun {
    onCancellationRequested: (cancelLogin: () => void) => void;
    timeoutMilliseconds?: number;
}

export type WorkspaceTargetOrgWrite =
    | { isWritten: true }
    | { isWritten: false; failureMessage: string };

export class SalesforceOrgLogin {

    // THE ADDRESS AS THE LOGIN WILL USE IT, OR undefined FOR ANYTHING THAT IS NOT A SALESFORCE LOGIN PAGE
    static normalizeLoginUrl(loginUrl: unknown): string | undefined {

        if ( typeof loginUrl !== 'string' ) {
            return undefined;
        }

        let parsedUrl: URL;

        try {
            parsedUrl = new URL(loginUrl.trim());
        } catch {
            return undefined;
        }

        const hostName = parsedUrl.hostname.toLowerCase();
        const isSalesforceLoginHost = `https://${hostName}` === SANDBOX_LOGIN_URL
            || ( hostName.endsWith(MY_DOMAIN_HOST_SUFFIX) && hostName.length > MY_DOMAIN_HOST_SUFFIX.length );
        const isBareAddress = parsedUrl.username === '' && parsedUrl.password === '' && parsedUrl.port === ''
            && parsedUrl.pathname === '/' && parsedUrl.search === '' && parsedUrl.hash === '';

        return parsedUrl.protocol === 'https:' && isSalesforceLoginHost && isBareAddress
            ? `https://${hostName}`
            : undefined;

    }

    static validateLoginUrl(loginUrl: unknown): string | undefined {

        return this.normalizeLoginUrl(loginUrl) === undefined ? LOGIN_URL_REFUSAL : undefined;

    }

    /*
        No --alias and no --set-default: the caller sets the alias only once it knows the org is a
        sandbox or scratch org, and writes the workspace's default itself. --no-prompt keeps the
        CLI from waiting on a question nobody can see. Run with no project folder, so a cloned
        repository's sfdx-project.json cannot move the login address or the local port.
    */
    static buildLoginWebArguments(normalizedLoginUrl: string): string[] {

        return ['org', 'login', 'web', '--instance-url', normalizedLoginUrl, '--no-prompt', '--json'];

    }

    /*
        The CLI opens the browser and waits for its answer. A cancel or the timeout kills the
        process, which also frees the local login port. The CLI saves the authorization BEFORE the
        browser has loaded its success page, so a cancel or a timeout that lands in between leaves
        an org authorized: neither outcome may be worded as "nothing was authorized".
    */
    static async authorizeWithBrowser(loginUrl: string, loginRun: IOrgLoginRun): Promise<OrgLoginOutcome> {

        const normalizedLoginUrl = this.normalizeLoginUrl(loginUrl);

        if ( normalizedLoginUrl === undefined ) {
            return { kind: 'failed', failureMessage: LOGIN_URL_REFUSAL };
        }

        let isCancelled = false;

        const loginResult = await SalesforceCli.runSalesforceCli(
            this.buildLoginWebArguments(normalizedLoginUrl),
            killLogin => loginRun.onCancellationRequested(() => {
                isCancelled = true;
                killLogin();
            }),
            loginRun.timeoutMilliseconds ?? ORG_LOGIN_TIMEOUT_MILLISECONDS
        );

        if ( isCancelled ) {
            return { kind: 'cancelled' };
        }

        if ( loginResult.timedOut ) {
            return { kind: 'timedOut' };
        }

        return this.readLoginAnswer(loginResult);

    }

    // THE CLI'S --json ANSWER IS UNTRUSTED TEXT THAT ALSO HOLDS THE ACCESS TOKEN: ONLY status, name, message AND result.username ARE READ
    static readLoginAnswer(loginResult: ISalesforceCliInvocationResult): OrgLoginOutcome {

        if ( loginResult.spawnError ) {
            return {
                kind: 'failed',
                failureMessage: loginResult.spawnError.code === 'ENOENT'
                    ? CLI_NOT_FOUND_FAILURE_MESSAGE
                    : `the Salesforce CLI could not be started: ${this.toFailureMessage(loginResult.spawnError)}`
            };
        }

        let loginAnswer: unknown;

        try {
            loginAnswer = JSON.parse(loginResult.stdout);
        } catch {
            const stderrText = loginResult.stderr.trim();
            return { kind: 'failed', failureMessage: stderrText ? this.toFailureMessage(stderrText) : 'the Salesforce CLI did not answer with JSON' };
        }

        if ( loginAnswer === null || typeof loginAnswer !== 'object' || Array.isArray(loginAnswer) ) {
            return { kind: 'failed', failureMessage: 'the Salesforce CLI did not answer with a JSON object' };
        }

        const { status: answerStatus, name: errorName, message: errorMessage, result: loginFields } = loginAnswer as Record<string, unknown>;

        if ( answerStatus !== 0 || loginResult.exitCode !== 0 ) {
            if ( errorName === CLI_PORT_IN_USE_ERROR_NAME ) {
                return { kind: 'portInUse' };
            }
            return { kind: 'failed', failureMessage: typeof errorMessage === 'string' && errorMessage.trim() ? this.toFailureMessage(errorMessage) : 'the Salesforce CLI reported a failure with no message' };
        }

        const username = loginFields !== null && typeof loginFields === 'object' ? ( loginFields as Record<string, unknown> ).username : undefined;

        if ( typeof username !== 'string' || !SalesforceCli.isValidTargetOrgIdentifier(username) ) {
            return { kind: 'failed', failureMessage: 'the login answered with a username this extension cannot use, so it is not listed here' };
        }

        return { kind: 'authorized', username: username };

    }

    // THE ORG IS AUTHORIZED WHETHER OR NOT ITS ALIAS LANDS, SO A FAILURE HERE IS ANSWERED AS ITS MESSAGE, NOT THROWN
    static async setAlias(alias: string, username: string): Promise<string | undefined> {

        try {
            StateAggregator.clearInstance();
            const stateAggregator = await StateAggregator.getInstance();
            await stateAggregator.aliases.setAndSave(alias, username);
            return undefined;
        } catch (aliasError) {
            return this.toFailureMessage(aliasError);
        }

    }

    // ONE SHORT LINE: THE TEXT MAY BE THE BROWSER REQUEST'S OWN error_description
    private static toFailureMessage(loginError: unknown): string {

        const errorText = String(( loginError as { message?: unknown } )?.message ?? loginError);

        return errorText.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').trim().slice(0, LOGIN_FAILURE_MESSAGE_MAX_LENGTH);

    }

    /*
        Sets target-org in <workspace>/.sf/config.json, the file "sf config set target-org" writes
        without --global, and leaves every other key as it was. The extension only read this file
        before #630. The folder must really be inside the workspace and the file must not be a
        link, so a cloned repository cannot point the write somewhere else.
    */
    static writeWorkspaceTargetOrg(workspaceRoot: string, orgIdentifier: string): WorkspaceTargetOrgWrite {

        if ( !SalesforceCli.isValidTargetOrgIdentifier(orgIdentifier) ) {
            return { isWritten: false, failureMessage: 'the org has no usable alias or username' };
        }

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const configFolderPath = path.join(resolvedWorkspaceRoot, WORKSPACE_CONFIG_FOLDER_NAME);
        const configFilePath = path.join(configFolderPath, WORKSPACE_CONFIG_FILE_NAME);
        const displayPath = `${WORKSPACE_CONFIG_FOLDER_NAME}/${WORKSPACE_CONFIG_FILE_NAME}`;
        const setByHandAdvice = `Set it with "sf config set ${TARGET_ORG_CONFIG_KEY}=${orgIdentifier}".`;

        try {

            fs.mkdirSync(configFolderPath, { recursive: true });

            if ( !SfdxProjectService.isPathContainedInWorkspace(configFolderPath, resolvedWorkspaceRoot) ) {
                return { isWritten: false, failureMessage: `${WORKSPACE_CONFIG_FOLDER_NAME} points outside this workspace. ${setByHandAdvice}` };
            }

            const configFileStats = fs.lstatSync(configFilePath, { throwIfNoEntry: false });

            if ( !configFileStats ) {
                fs.writeFileSync(configFilePath, this.toConfigText({ [TARGET_ORG_CONFIG_KEY]: orgIdentifier }), { flag: 'wx' });
                return { isWritten: true };
            }

            if ( !configFileStats.isFile() || configFileStats.size > WORKSPACE_CONFIG_MAX_BYTES ) {
                return { isWritten: false, failureMessage: `${displayPath} is not a file this extension can update. ${setByHandAdvice}` };
            }

            const existingConfig: unknown = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));

            if ( existingConfig === null || typeof existingConfig !== 'object' || Array.isArray(existingConfig) ) {
                return { isWritten: false, failureMessage: `${displayPath} is not a JSON object. ${setByHandAdvice}` };
            }

            fs.writeFileSync(configFilePath, this.toConfigText({ ...existingConfig, [TARGET_ORG_CONFIG_KEY]: orgIdentifier }));

            return { isWritten: true };

        } catch (writeError) {

            return { isWritten: false, failureMessage: `${displayPath} could not be written: ${this.toFailureMessage(writeError)}. ${setByHandAdvice}` };

        }

    }

    private static toConfigText(config: object): string {

        return JSON.stringify(config, null, 2) + '\n';

    }

}
