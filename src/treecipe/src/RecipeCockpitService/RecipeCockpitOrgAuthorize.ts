import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { OrgLoginOutcome, SANDBOX_LOGIN_URL, WorkspaceTargetOrgWrite } from '../SalesforceOrgService/SalesforceOrgLogin';

/*
    What "Authorize org" (#630) asks and says: the button's labels, the prompts, the confirmation
    and the one notification a login ends in. No vscode, so every sentence is tested as text; the
    cockpit escapes a notification before it is shown.
*/
export const RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL = 'Authorize org';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL = 'Authorizing org…';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP = 'Log in to an existing sandbox in your browser so Target Org Manager can list it.';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_CONFIRM_LABEL = 'Authorize org';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_DEFAULT_CHECKBOX_LABEL = 'Make this my selected target org and this workspace\'s default org';

export const RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_CHOICE_LABEL = 'Sandbox';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_MY_DOMAIN_CHOICE_LABEL = 'Custom My Domain';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_LOGIN_ADDRESS_PLACEHOLDER = 'Where to log in';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_MY_DOMAIN_PROMPT = 'The org\'s My Domain address, as its login page shows it.';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_MY_DOMAIN_PLACEHOLDER = 'https://acme--qa.sandbox.my.salesforce.com';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PROMPT = 'Alias for the org: the name the Salesforce CLI, the org picker and later commands will know it by. Leave it empty for no alias.';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_ALIAS_PLACEHOLDER = 'for example qa-sandbox';

export interface IOrgAuthorizePlan {
    loginUrl: string;
    alias?: string;
    aliasHolderUsername?: string;
}

// WHERE THE AUTHORIZED ORG STANDS IN TARGET ORG MANAGER'S LIST ONCE THE CONNECTIONS ARE CHECKED AGAIN
export type AuthorizedOrgPlacement = 'listed' | 'notSandboxOrScratch' | 'notConnected';

export interface IOrgAuthorizeResult {
    loginOutcome: OrgLoginOutcome;
    alias?: string;
    placement?: AuthorizedOrgPlacement;
    isDefaultRequested: boolean;
    targetOrgWrite?: WorkspaceTargetOrgWrite;
}

export interface IOrgAuthorizeNotification {
    severity: 'information' | 'warning' | 'error';
    text: string;
}

export class RecipeCockpitOrgAuthorize {

    // AN EMPTY ALIAS IS "NO ALIAS"; ANYTHING TYPED IS HELD TO THE RULE A NEW SCRATCH ORG'S ALIAS IS
    static validateAlias(alias: string): string | undefined {

        return alias === '' ? undefined : ScratchOrgService.validateScratchOrgAlias(alias);

    }

    static buildLoginHostName(loginUrl: string): string {

        return loginUrl.replace(/^https:\/\//, '');

    }

    static buildConfirmMessage(authorizePlan: IOrgAuthorizePlan): string {

        return `Log in to a Salesforce org at ${this.buildLoginHostName(authorizePlan.loginUrl)} in your browser?`;

    }

    static buildConfirmContent(authorizePlan: IOrgAuthorizePlan): IRecipeCockpitConfirmContent {

        const isSandboxLogin = authorizePlan.loginUrl === SANDBOX_LOGIN_URL;

        return {
            summary: [
                'Your browser opens the Salesforce login page. Once you log in and allow access, the org is saved with your other Salesforce CLI authorizations.',
                authorizePlan.alias ? `Alias: ${authorizePlan.alias}` : 'Alias: none'
            ],
            warnings: authorizePlan.alias && authorizePlan.aliasHolderUsername
                ? [`"${authorizePlan.alias}" is currently ${authorizePlan.aliasHolderUsername}. Authorizing will move it to the org you log in to.`]
                : [],
            sections: [{
                title: 'What happens',
                lines: [
                    `Login address: ${authorizePlan.loginUrl}${isSandboxLogin ? ' (sandboxes)' : ''}`,
                    'Target Org Manager lists the org once it answers a connection check, and only when it is a sandbox or scratch org.',
                    'Nothing is deployed to the org and no record is written.',
                    `Ticking the box also selects the org here and sets target-org in this workspace's .sf/config.json.`
                ]
            }]
        };

    }

    static buildNotification(authorizeResult: IOrgAuthorizeResult): IOrgAuthorizeNotification {

        const loginOutcome = authorizeResult.loginOutcome;

        switch ( loginOutcome.kind ) {
            case 'cancelled':
                return { severity: 'information', text: 'Authorize org was cancelled. No org was authorized.' };
            case 'timedOut':
                return { severity: 'warning', text: `No login was completed in time, so no org was authorized. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.` };
            case 'portInUse':
                return { severity: 'warning', text: `Authorize org could not start: the local port the Salesforce login answers on (1717 unless sfdx-project.json sets oauthLocalPort) is in use. Finish or stop the other login, such as an "sf org login web" still waiting, then press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} again.` };
            case 'failed':
                return { severity: 'error', text: `No org was authorized: ${loginOutcome.failureMessage}. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.` };
        }

        const isAliasSet = authorizeResult.alias !== undefined && loginOutcome.aliasFailureMessage === undefined;
        // NO PARENTHESES: A NOTIFICATION ESCAPES THEM
        const orgText = isAliasSet ? `${authorizeResult.alias} · ${loginOutcome.username}` : loginOutcome.username;
        const aliasText = loginOutcome.aliasFailureMessage === undefined
            ? ''
            : ` The alias ${authorizeResult.alias} could not be set (${loginOutcome.aliasFailureMessage}): set it with "sf alias set ${authorizeResult.alias}=${loginOutcome.username}".`;
        const notDefaultText = authorizeResult.isDefaultRequested ? ' It was not selected or made this workspace\'s default org.' : '';

        if ( authorizeResult.placement === 'notSandboxOrScratch' ) {
            return { severity: 'warning', text: `${orgText} is authorized, but it is not a sandbox or scratch org, so Target Org Manager does not list it.${notDefaultText}${aliasText}` };
        }

        if ( authorizeResult.placement !== 'listed' ) {
            return { severity: 'warning', text: `${orgText} is authorized, but it did not answer the connection check yet: press ⟳ to check again.${notDefaultText}${aliasText}` };
        }

        if ( !authorizeResult.isDefaultRequested ) {
            return { severity: aliasText ? 'warning' : 'information', text: `${orgText} is authorized and listed in Target Org Manager.${aliasText}` };
        }

        const targetOrgWrite = authorizeResult.targetOrgWrite;

        if ( targetOrgWrite?.isWritten === true ) {
            return { severity: aliasText ? 'warning' : 'information', text: `${orgText} is authorized, selected in Target Org Manager, and this workspace's default org.${aliasText}` };
        }

        const writeFailureMessage = targetOrgWrite?.isWritten === false ? targetOrgWrite.failureMessage : 'the workspace config was not written.';

        return { severity: 'warning', text: `${orgText} is authorized and selected in Target Org Manager, but it was not made this workspace's default org: ${writeFailureMessage}${aliasText}` };

    }

}
