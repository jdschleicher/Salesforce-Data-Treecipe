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
const QA_SANDBOX_LOGIN_URL = 'https://acme--qa.sandbox.my.salesforce.com';

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

            const authorizePlan = { loginUrl: QA_SANDBOX_LOGIN_URL, alias: 'qa' };

            expect(RecipeCockpitOrgAuthorize.buildConfirmMessage(authorizePlan)).toBe('Log in to a Salesforce org at acme--qa.sandbox.my.salesforce.com in your browser?');

            const confirmText = RecipeCockpitConfirmContent.flatten(RecipeCockpitOrgAuthorize.buildConfirmContent(authorizePlan));

            expect(confirmText).toContain('Alias: qa');
            expect(confirmText).toContain(`Login address: ${QA_SANDBOX_LOGIN_URL}`);
            expect(confirmText).toContain('Nothing is deployed to the org and no record is written.');
            expect(confirmText).toContain('sets target-org in this workspace\'s .sf/config.json');
            expect(confirmText).not.toContain('will move it');
            expect(confirmText).toContain('Authorize with Salesforce CLI runs sf org login web');
            expect(confirmText).toContain('Authorize with @salesforce/core logs in inside VS Code without starting the CLI');

        });

        it('says "Alias: none" without one, and warns when the alias is another org\'s', () => {

            expect(RecipeCockpitConfirmContent.flatten(RecipeCockpitOrgAuthorize.buildConfirmContent({ loginUrl: 'https://acme--qa.sandbox.my.salesforce.com' })))
                .toContain('Alias: none');

            const movedAliasContent = RecipeCockpitOrgAuthorize.buildConfirmContent({ loginUrl: QA_SANDBOX_LOGIN_URL, alias: 'qa', aliasHolderUsername: 'old@example.com' });

            expect(movedAliasContent.warnings).toEqual(['"qa" is currently old@example.com. Authorizing will move it to the org you log in to.']);

        });

    });

    describe('the one notification a login ends in', () => {

        it('never says nothing was authorized after a cancel or a timeout, since core may already have saved the org', () => {

            expect(notificationOf({ loginOutcome: { kind: 'cancelled' }, isDefaultRequested: true }))
                .toEqual({ severity: 'information', text: 'Authorize org was cancelled. If you had already logged in in your browser, the org may still have been authorized: press ⟳ to check.' });
            expect(notificationOf({ loginOutcome: { kind: 'timedOut' } }))
                .toEqual({ severity: 'warning', text: 'Authorize org stopped waiting: no login was completed in time. If you had already logged in in your browser, the org may still have been authorized: press ⟳ to check.' });

        });

        it('words a refused login as what the login reported, not as the extension\'s own words', () => {

            expect(notificationOf({ loginOutcome: { kind: 'failed', failureMessage: 'end-user denied authorization' } }))
                .toEqual({ severity: 'error', text: `Authorize org did not finish. The login reported: end-user denied authorization. Press ${RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL} to try again.` });

        });

        it('names the port and the other login when the port is in use', () => {

            const notification = notificationOf({ loginOutcome: { kind: 'portInUse' } });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toContain('local port 1717');
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

        it('says an org that is not a sandbox or scratch org is authorized but not selected or made the default, and that its alias was not set', () => {

            expect(notificationOf({ placement: 'notSandboxOrScratch', isDefaultRequested: true }))
                .toEqual({ severity: 'warning', text: `${QA_USERNAME} is authorized, but it is not a sandbox or scratch org. Target Org Manager lists only those and the Salesforce CLI's default org. It was not selected or made this workspace's default org.` });
            expect(notificationOf({ placement: 'notSandboxOrScratch' }).text).not.toContain('It was not selected');
            expect(notificationOf({ placement: 'notSandboxOrScratch', alias: 'qa' }).text)
                .toEndWith(`default org. The alias qa was not set. If you still want it, set it with "sf alias set qa=${QA_USERNAME}".`);

        });

        it('points at ⟳ for an org that did not answer the connection check', () => {

            expect(notificationOf({ placement: 'notConnected' }))
                .toEqual({ severity: 'warning', text: `${QA_USERNAME} is authorized, but it did not answer the connection check yet: press ⟳ to check again.` });

        });

        it('names the org by username alone, and how to set the alias by hand, when the alias did not land', () => {

            const notification = notificationOf({ alias: 'qa', aliasFailureMessage: 'alias file is locked', placement: 'listed' });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toBe(`${QA_USERNAME} is authorized and listed in Target Org Manager. The alias qa could not be set: alias file is locked. To set it yourself, set it with "sf alias set qa=${QA_USERNAME}".`);

        });

        it('says an environment variable still decides the default org when one overrides the workspace config', () => {

            const notification = notificationOf({ alias: 'qa', placement: 'listed', isDefaultRequested: true, targetOrgWrite: { isWritten: true }, overridingDefaultOrgIdentifier: 'other-org' });

            expect(notification.severity).toBe('warning');
            expect(notification.text).toBe(`qa · ${QA_USERNAME} is authorized, selected in Target Org Manager, and set as target-org in this workspace's .sf/config.json. An environment variable still makes other-org the default org: unset SF_TARGET_ORG to use the workspace's.`);

        });

        it('uses no parentheses in any ending, since a notification escapes them', () => {

            const endings: Partial<IOrgAuthorizeResult>[] = [
                { loginOutcome: { kind: 'cancelled' } }, { loginOutcome: { kind: 'timedOut' } }, { loginOutcome: { kind: 'portInUse' } },
                { alias: 'qa', placement: 'listed' }, { alias: 'qa', placement: 'listed', aliasFailureMessage: 'locked' },
                { alias: 'qa', placement: 'notSandboxOrScratch', isDefaultRequested: true }, { alias: 'qa', placement: 'notConnected' },
                { placement: 'listed', isDefaultRequested: true, targetOrgWrite: { isWritten: true } },
                { placement: 'listed', isDefaultRequested: true, targetOrgWrite: { isWritten: true }, overridingDefaultOrgIdentifier: 'other' },
                { placement: 'listed', isDefaultRequested: true }
            ];

            endings.forEach(ending => expect(notificationOf(ending).text).not.toMatch(/[()]/));

        });

    });

});
