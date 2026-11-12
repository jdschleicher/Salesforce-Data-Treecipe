import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import { ScratchOrgService } from '../ScratchOrgService/ScratchOrgService';
import { OrgLoginOutcome, WorkspaceTargetOrgWrite } from '../SalesforceOrgService/SalesforceOrgLogin';

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

export const RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PROMPT = 'The sandbox\'s subdomain: the part of its login address before .sandbox.my.salesforce.com.';
export const RECIPE_COCKPIT_AUTHORIZE_ORG_SANDBOX_SUBDOMAIN_PLACEHOLDER = 'acme--qa';
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
    // SET ONLY WHEN SETTING THE ALIAS WAS TRIED AND FAILED; AN ALIAS IS NOT TRIED ON AN ORG THAT IS NOT LISTED
    aliasFailureMessage?: string;
    placement?: AuthorizedOrgPlacement;
    isDefaultRequested: boolean;
    targetOrgWrite?: WorkspaceTargetOrgWrite;
    // THE DEFAULT ORG THE CLI STILL RESOLVES AFTER THE WRITE, WHEN AN ENVIRONMENT VARIABLE NAMES ANOTHER
    overridingDefaultOrgIdentifier?: string;
}

export interface IOrgAuthorizeNotification {
    severity: 'information' | 'warning' | 'error';
    text: string;
}

// CORE SAVES AN AUTHORIZATION BEFORE THE BROWSER SHOWS ITS SUCCESS PAGE, SO A LOGIN THAT DID NOT FINISH HERE MAY STILL HAVE LANDED
const MAY_STILL_BE_AUTHORIZED_TEXT = 'If you had already logged in in your browser, the org may still have been authorized: press ⟳ to check.';

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
                    `Login address: ${authorizePlan.loginUrl}`,
                    'Target Org Manager lists the org once it answers a connection check, and only when it is a sandbox or scratch org.',
                    'Nothing is deployed to the org and no record is written.',
                    `Ticking the box also selects the org here and sets target-org in this workspace's .sf/config.json.`
                ]
            }]
        };

    }

    // NO PARENTHESES IN ANY TEXT HERE: A NOTIFICATION ESCAPES THEM
    static buildNotification(authorizeResult: IOrgAuthorizeResult): IOrgAuthorizeNotification {

        const loginOutcome = authorizeResult.loginOutcome;

        switch ( loginOutcome.kind ) {
            case 'cancelled':
                return { severity: 'information', text: `Authorize org was cancelled. ${MAY_STILL_BE_AUTHORIZED_TEXT}` };
            case 'timedOut':
                return { severity: 'warning', text: `Authorize org stopped waiting: no login was completed in time. ${MAY_STILL_BE_AUTHORIZED_TEXT}` };
            case 'portInUse':
                return { severity: 'warning', text: `Authorize org could not start: local port 1717, which the Salesforce login answers on, is in use. Finish or stop the other login, such as an "sf org login web" still waiting, then press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} again.` };
            case 'failed':
                return { severity: 'error', text: `Authorize org did not finish. The login reported: ${loginOutcome.failureMessage}. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.` };
        }

        const alias = authorizeResult.alias;
        const isListed = authorizeResult.placement === 'listed';
        const isAliasSet = alias !== undefined && isListed && authorizeResult.aliasFailureMessage === undefined;
        const orgText = isAliasSet ? `${alias} · ${loginOutcome.username}` : loginOutcome.username;
        const setAliasByHandText = `set it with "sf alias set ${alias}=${loginOutcome.username}".`;
        const aliasText = alias === undefined || isAliasSet
            ? ''
            : isListed
                ? ` The alias ${alias} could not be set: ${authorizeResult.aliasFailureMessage}. To set it yourself, ${setAliasByHandText}`
                : ` The alias ${alias} was not set. If you still want it, ${setAliasByHandText}`;
        const notDefaultText = authorizeResult.isDefaultRequested ? ' It was not selected or made this workspace\'s default org.' : '';

        if ( authorizeResult.placement === 'notSandboxOrScratch' ) {
            return { severity: 'warning', text: `${orgText} is authorized, but it is not a sandbox or scratch org. Target Org Manager lists only those and the Salesforce CLI's default org.${notDefaultText}${aliasText}` };
        }

        if ( !isListed ) {
            return { severity: 'warning', text: `${orgText} is authorized, but it did not answer the connection check yet: press ⟳ to check again.${notDefaultText}${aliasText}` };
        }

        if ( !authorizeResult.isDefaultRequested ) {
            return { severity: aliasText ? 'warning' : 'information', text: `${orgText} is authorized and listed in Target Org Manager.${aliasText}` };
        }

        const targetOrgWrite = authorizeResult.targetOrgWrite;

        if ( targetOrgWrite?.isWritten !== true ) {
            const writeFailureMessage = targetOrgWrite?.isWritten === false ? targetOrgWrite.failureMessage : 'the workspace config was not written.';
            return { severity: 'warning', text: `${orgText} is authorized and selected in Target Org Manager, but it was not made this workspace's default org: ${writeFailureMessage}${aliasText}` };
        }

        if ( authorizeResult.overridingDefaultOrgIdentifier !== undefined ) {
            return { severity: 'warning', text: `${orgText} is authorized, selected in Target Org Manager, and set as target-org in this workspace's .sf/config.json. An environment variable still makes ${authorizeResult.overridingDefaultOrgIdentifier} the default org: unset SF_TARGET_ORG to use the workspace's.${aliasText}` };
        }

        return { severity: aliasText ? 'warning' : 'information', text: `${orgText} is authorized, selected in Target Org Manager, and this workspace's default org.${aliasText}` };

    }

}
