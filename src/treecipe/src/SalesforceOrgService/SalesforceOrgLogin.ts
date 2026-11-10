import { StateAggregator, WebOAuthServer } from '@salesforce/core';
import { SalesforceCli } from '../SalesforceCli/SalesforceCli';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

import * as fs from 'fs';
import * as path from 'path';

/*
    "Authorize org" (#630): a browser login to an existing org through @salesforce/core's
    WebOAuthServer, with no sf process, and the workspace's default org written when the reader
    asked for it. No vscode: the caller hands in how the login page is opened and how a cancel
    arrives. Nothing here returns, logs or quotes a token; an outcome names the username only.
*/
export const SANDBOX_LOGIN_URL = 'https://test.salesforce.com';

// A LOGIN PAGE IS A SANDBOX'S SHARED ADDRESS OR AN ORG'S OWN MY DOMAIN, AND NOTHING ELSE
const MY_DOMAIN_HOST_SUFFIX = '.my.salesforce.com';

export const LOGIN_URL_REFUSAL = `Enter ${SANDBOX_LOGIN_URL} or the org's My Domain address, for example https://acme--qa.sandbox.my.salesforce.com.`;

export const ORG_LOGIN_TIMEOUT_MILLISECONDS = 5 * 60 * 1000;

const LOGIN_FAILURE_MESSAGE_MAX_LENGTH = 300;

const WORKSPACE_CONFIG_FOLDER_NAME = '.sf';
const WORKSPACE_CONFIG_FILE_NAME = 'config.json';
const WORKSPACE_CONFIG_MAX_BYTES = 1024 * 1024;
const TARGET_ORG_CONFIG_KEY = 'target-org';

export type OrgLoginOutcome =
    | { kind: 'authorized'; username: string; aliasFailureMessage?: string }
    | { kind: 'cancelled' }
    | { kind: 'timedOut' }
    | { kind: 'portInUse' }
    | { kind: 'failed'; failureMessage: string };

export interface IOrgLoginRun {
    openLoginPage: (authorizationUrl: string) => Promise<boolean> | PromiseLike<boolean>;
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
        The login page is opened by the caller, and the login is over when core's local server has
        the browser's answer, the caller cancels, or the time runs out. Core's server has no public
        stop and no timeout of its own, so a cancel or a timeout closes it here: left listening, it
        would hold the port and refuse the next login.
    */
    static async authorizeWithBrowser(loginUrl: string, alias: string | undefined, loginRun: IOrgLoginRun): Promise<OrgLoginOutcome> {

        const normalizedLoginUrl = this.normalizeLoginUrl(loginUrl);

        if ( normalizedLoginUrl === undefined ) {
            return { kind: 'failed', failureMessage: LOGIN_URL_REFUSAL };
        }

        let oauthServer: WebOAuthServer;

        try {
            oauthServer = await WebOAuthServer.create({ oauthConfig: { loginUrl: normalizedLoginUrl } });
            await oauthServer.start();
        } catch (startError) {
            return this.isPortInUseError(startError)
                ? { kind: 'portInUse' }
                : { kind: 'failed', failureMessage: this.toFailureMessage(startError) };
        }

        const stopListening = () => {
            try {
                ( oauthServer as unknown as { webServer?: { close?: () => void } } ).webServer?.close?.();
            } catch {
                // ALREADY CLOSED
            }
        };

        type LoginRaceResult = { username: string } | { loginError: unknown } | 'cancelled' | 'timedOut';

        let timeoutTimer: NodeJS.Timeout | undefined;
        const abandoned = new Promise<LoginRaceResult>(resolve => {
            loginRun.onCancellationRequested(() => resolve('cancelled'));
            timeoutTimer = setTimeout(() => resolve('timedOut'), loginRun.timeoutMilliseconds ?? ORG_LOGIN_TIMEOUT_MILLISECONDS);
        });
        const answered: Promise<LoginRaceResult> = oauthServer.authorizeAndSave().then(
            authInfo => ({ username: authInfo.getUsername() }),
            loginError => ({ loginError: loginError })
        );

        try {

            let isLoginPageOpened = false;

            try {
                isLoginPageOpened = await loginRun.openLoginPage(oauthServer.getAuthorizationUrl());
            } catch {
                isLoginPageOpened = false;
            }

            if ( !isLoginPageOpened ) {
                return { kind: 'failed', failureMessage: 'the login page could not be opened in a browser' };
            }

            const raceResult = await Promise.race([answered, abandoned]);

            if ( raceResult === 'cancelled' || raceResult === 'timedOut' ) {
                return { kind: raceResult };
            }

            if ( 'loginError' in raceResult ) {
                return { kind: 'failed', failureMessage: this.toFailureMessage(raceResult.loginError) };
            }

            if ( !SalesforceCli.isValidTargetOrgIdentifier(raceResult.username) ) {
                return { kind: 'failed', failureMessage: 'the login answered without a usable username' };
            }

            const aliasFailureMessage = alias === undefined ? undefined : await this.setAlias(alias, raceResult.username);

            return {
                kind: 'authorized',
                username: raceResult.username,
                ...( aliasFailureMessage ? { aliasFailureMessage: aliasFailureMessage } : {} )
            };

        } finally {

            clearTimeout(timeoutTimer);
            stopListening();

        }

    }

    // THE ORG IS AUTHORIZED WHETHER OR NOT ITS ALIAS LANDS, SO A FAILURE HERE IS TOLD, NOT THROWN
    private static async setAlias(alias: string, username: string): Promise<string | undefined> {

        try {
            StateAggregator.clearInstance();
            const stateAggregator = await StateAggregator.getInstance();
            await stateAggregator.aliases.setAndSave(alias, username);
            return undefined;
        } catch (aliasError) {
            return this.toFailureMessage(aliasError);
        }

    }

    private static isPortInUseError(startError: unknown): boolean {

        const errorName = String(( startError as { name?: unknown } )?.name ?? '');
        const errorCode = String(( startError as { code?: unknown } )?.code ?? '');

        return errorName === 'PortInUseError' || errorName === 'EADDRINUSE' || errorCode === 'EADDRINUSE';

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

            return { isWritten: false, failureMessage: `${displayPath} could not be written (${this.toFailureMessage(writeError)}). ${setByHandAdvice}` };

        }

    }

    private static toConfigText(config: object): string {

        return JSON.stringify(config, null, 2) + '\n';

    }

}
