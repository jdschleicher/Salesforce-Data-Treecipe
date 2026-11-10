import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('@salesforce/core', () => ({}));
jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import {
    IOrgAuthorizeResult,
    RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
    RecipeCockpitOrgAuthorize
} from '../RecipeCockpitOrgAuthorize';
import { RecipeCockpitConfirmContent } from '../RecipeCockpitConfirmContent';
import { SANDBOX_LOGIN_URL } from '../../SalesforceOrgService/SalesforceOrgLogin';

const QA_USERNAME = 'qa@example.com.qa';
const AUTHORIZED = { kind: 'authorized' as const, username: QA_USERNAME };

const notificationOf = (authorizeResult: Partial<IOrgAuthorizeResult>) =>
    RecipeCockpitOrgAuthorize.buildNotification({ loginOutcome: AUTHORIZED, isDefaultRequested: false, ...authorizeResult });

describe('RecipeCockpitOrgAuthorize: what "Authorize org" asks and says (#630)', () => {

    describe('validateAlias', () => {

        it('takes an empty alias as no alias, and holds a typed one to the scratch org alias rule', () => {

            expect(RecipeCockpitOrgAuthorize.validateAlias('')).toBeUndefined();
            expect(RecipeCockpitOrgAuthorize.validateAlias('qa-sandbox')).toBeUndefined();
            expect(RecipeCockpitOrgAuthorize.validateAlias('qa@sandbox')).toContain('"@"');
            expect(RecipeCockpitOrgAuthorize.validateAlias('--target-org')).toStartWith('An alias is letters');

        });

    });

    describe('the confirmation', () => {

        it('names the login host in its question, and the address, the alias and what the box adds in its lines', () => {

            const authorizePlan = { loginUrl: SANDBOX_LOGIN_URL, alias: 'qa' };

            expect(RecipeCockpitOrgAuthorize.buildConfirmMessage(authorizePlan)).toBe('Log in to a Salesforce org at test.salesforce.com in your browser?');

            const confirmText = RecipeCockpitConfirmContent.flatten(RecipeCockpitOrgAuthorize.buildConfirmContent(authorizePlan));

            expect(confirmText).toContain('Alias: qa');
            expect(confirmText).toContain('Login address: https://test.salesforce.com (sandboxes)');
            expect(confirmText).toContain('Nothing is deployed to the org and no record is written.');
            expect(confirmText).toContain('sets target-org in this workspace\'s .sf/config.json');
            expect(confirmText).not.toContain('will move it');

        });

        it('says "Alias: none" without one, and warns when the alias is another org\'s', () => {

            expect(RecipeCockpitConfirmContent.flatten(RecipeCockpitOrgAuthorize.buildConfirmContent({ loginUrl: 'https://acme--qa.sandbox.my.salesforce.com' })))
                .toContain('Alias: none');

            const movedAliasContent = RecipeCockpitOrgAuthorize.buildConfirmContent({ loginUrl: SANDBOX_LOGIN_URL, alias: 'qa', aliasHolderUsername: 'old@example.com' });

            expect(movedAliasContent.warnings).toEqual(['"qa" is currently old@example.com. Authorizing will move it to the org you log in to.']);

        });

    });

    describe('the one notification a login ends in', () => {

        it.each([
            [{ kind: 'cancelled' as const }, 'information', 'Authorize org was cancelled. No org was authorized.'],
            [{ kind: 'timedOut' as const }, 'warning', `No login was completed in time, so no org was authorized. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.`],
            [{ kind: 'failed' as const, failureMessage: 'end-user denied authorization' }, 'error', `No org was authorized: end-user denied authorization. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.`]
        ])('says what to do when no org was authorized: %j', (loginOutcome, severity, text) => {

            expect(notificationOf({ loginOutcome: loginOutcome, isDefaultRequested: true })).toEqual({ severity: severity, text: text });

        });

        it('names the port and the other login when the port is in use', () => {

            const notification = notificationOf({ loginOutcome: { kind: 'portInUse' } });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toContain('1717 unless sfdx-project.json sets oauthLocalPort');
            expect(notification.text).toEndWith(`then press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} again.`);

        });

        it('says the org is listed, by alias and username, when the box was not ticked', () => {

            expect(notificationOf({ alias: 'qa', placement: 'listed' }))
                .toEqual({ severity: 'information', text: `qa · ${QA_USERNAME} is authorized and listed in Target Org Manager.` });
            expect(notificationOf({ placement: 'listed' }).text).toBe(`${QA_USERNAME} is authorized and listed in Target Org Manager.`);

        });

        it('says the org is selected and the workspace default when the box was ticked and the config was written', () => {

            expect(notificationOf({ alias: 'qa', placement: 'listed', isDefaultRequested: true, targetOrgWrite: { isWritten: true } }))
                .toEqual({ severity: 'information', text: `qa · ${QA_USERNAME} is authorized, selected in Target Org Manager, and this workspace's default org.` });

        });

        it('still counts the login as done when the config could not be written, and says why', () => {

            const notification = notificationOf({ placement: 'listed', isDefaultRequested: true, targetOrgWrite: { isWritten: false, failureMessage: '.sf/config.json is not a JSON object. Set it with "sf config set target-org=qa".' } });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toBe(`${QA_USERNAME} is authorized and selected in Target Org Manager, but it was not made this workspace's default org: .sf/config.json is not a JSON object. Set it with "sf config set target-org=qa".`);

        });

        it('says an org that is not a sandbox or scratch org is authorized but not listed, selected or made the default', () => {

            expect(notificationOf({ placement: 'notSandboxOrScratch', isDefaultRequested: true }))
                .toEqual({ severity: 'warning', text: `${QA_USERNAME} is authorized, but it is not a sandbox or scratch org, so Target Org Manager does not list it. It was not selected or made this workspace's default org.` });
            expect(notificationOf({ placement: 'notSandboxOrScratch' }).text).not.toContain('It was not selected');

        });

        it('points at ⟳ for an org that did not answer the connection check', () => {

            expect(notificationOf({ placement: 'notConnected' }))
                .toEqual({ severity: 'warning', text: `${QA_USERNAME} is authorized, but it did not answer the connection check yet: press ⟳ to check again.` });

        });

        it('names the org by username alone, and how to set the alias by hand, when the alias did not land', () => {

            const notification = notificationOf({ loginOutcome: { ...AUTHORIZED, aliasFailureMessage: 'alias file is locked' }, alias: 'qa', placement: 'listed' });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toBe(`${QA_USERNAME} is authorized and listed in Target Org Manager. The alias qa could not be set (alias file is locked): set it with "sf alias set qa=${QA_USERNAME}".`);

        });

    });

});
