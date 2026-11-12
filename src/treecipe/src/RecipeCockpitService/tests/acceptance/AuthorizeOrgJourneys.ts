import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { expectEqual } from './TreecipeTabWorkspace';

/*
    Authorize org (#630): a reader with a sandbox that is not authorized yet logs in to it from Target
    Org Manager. Ticking the confirmation's box selects it and makes it this workspace's default org;
    leaving it unticked only lists it; and a production org is authorized but never listed or made the
    default. Each on its own copy of treecipeTabWorkspace. No sf process runs in any of them.
*/

const ORG_PICKER_NAME = 'Salesforce org the generated data goes to';
const DEFAULT_ORG_CHECKBOX_NAME = 'Make this my selected target org and this workspace\'s default org';
const SANDBOX_SUBDOMAIN = 'acme--newsbx';
const SANDBOX_LOGIN_ADDRESS = 'https://acme--newsbx.sandbox.my.salesforce.com';
const CONFIRMATION_TITLE = 'Log in to a Salesforce org at acme--newsbx.sandbox.my.salesforce.com in your browser?';
const NEW_SANDBOX = { username: 'new@example.com.newsbx', orgId: '00D000000000NEWAAA', instanceUrl: 'https://acme--newsbx.sandbox.my.salesforce.com', isSandbox: true };
const PRODUCTION_ORG = { username: 'admin@example.com.prod', orgId: '00D000000000PRDAAA', instanceUrl: 'https://example.my.salesforce.com', isSandbox: false };

const workspaceConfigPath = (journey: RecipeCockpitJourney) => path.join(journey.workspaceRoot, '.sf', 'config.json');
const notificationsShown = (journey: RecipeCockpitJourney) => journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text }));

async function logInFromTheButton(journey: RecipeCockpitJourney, alias: string, isDefaultTicked: boolean): Promise<void> {

    await journey.click('button', 'Authorize org');
    await journey.answerInputBox(SANDBOX_SUBDOMAIN);
    await journey.answerInputBox(alias);
    await journey.waitForConfirmation();

    await journey.step('the confirmation names the login address and offers the box unticked', () => {
        const screen = journey.screen();
        const confirmation = screen.get('dialog', CONFIRMATION_TITLE);
        expectEqual(screen.get('checkbox', DEFAULT_ORG_CHECKBOX_NAME, confirmation).states.includes('checked'), false, 'The box starts ticked');
        expectEqual(journey.org.calls.filter(orgCall => orgCall.call === 'WebOAuthServer.create').length, 0, 'Logins started before the confirmation is answered');
    });

    if ( isDefaultTicked ) {
        await journey.click('checkbox', DEFAULT_ORG_CHECKBOX_NAME);
    }

    await journey.answerConfirmation('Authorize org');

}

export const AUTHORIZE_ORG_JOURNEYS: Array<{ name: string; run(journey: RecipeCockpitJourney): Promise<void> }> = [

    {
        name: 'authorize a sandbox with the box ticked: it is selected and becomes this workspace\'s default org',
        run: async journey => {

            journey.org.browserLoginAuthorization = NEW_SANDBOX;
            await logInFromTheButton(journey, 'newsbx', true);
            await journey.waitFor('button', 'Authorize org', undefined, { isEnabled: true });

            await journey.step('the browser was opened on the sandbox login page, through @salesforce/core and no sf process', () => {
                expectEqual(journey.org.calls.filter(orgCall => orgCall.call === 'WebOAuthServer.create').map(orgCall => orgCall.args), [[SANDBOX_LOGIN_ADDRESS]], 'The login address');
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'env.openExternal').map(hostCall => hostCall.args[0]),
                    [`${SANDBOX_LOGIN_ADDRESS}/services/oauth2/authorize?client_id=PlatformCLI`], 'What the browser opened');
                expectEqual(journey.cli.calls, [], 'sf processes run');
            });

            await journey.step('newsbx is the org selected, and the workspace\'s default org', () => {
                expectEqual(journey.screen().get('combobox', ORG_PICKER_NAME).value, 'newsbx (default)', 'The org chosen');
                expectEqual(JSON.parse(fs.readFileSync(workspaceConfigPath(journey), 'utf8')), { 'target-org': 'newsbx' }, '.sf/config.json');
            });

            await journey.step('one notification says so', () => {
                expectEqual(notificationsShown(journey),
                    [{ kind: 'information', text: 'newsbx · new@example.com.newsbx is authorized, selected in Target Org Manager, and this workspace\'s default org.' }], 'The notifications');
            });

        }
    },

    {
        name: 'authorize a sandbox with the box unticked: it is listed, and nothing is selected or written',
        run: async journey => {

            journey.org.browserLoginAuthorization = NEW_SANDBOX;
            await logInFromTheButton(journey, 'newsbx', false);
            await journey.waitFor('button', 'Authorize org', undefined, { isEnabled: true });

            await journey.step('newsbx is offered, not chosen, and no workspace config was written', () => {
                expectEqual(journey.optionLabelsOf(ORG_PICKER_NAME).includes('newsbx'), true, `newsbx is among the orgs offered: ${JSON.stringify(journey.optionLabelsOf(ORG_PICKER_NAME))}`);
                expectEqual(journey.screen().get('combobox', ORG_PICKER_NAME).value.startsWith('newsbx'), false, 'newsbx is the org chosen');
                expectEqual(fs.existsSync(workspaceConfigPath(journey)), false, '.sf/config.json exists');
                expectEqual(notificationsShown(journey), [{ kind: 'information', text: 'newsbx · new@example.com.newsbx is authorized and listed in Target Org Manager.' }], 'The notifications');
            });

        }
    },

    {
        name: 'authorize a production org with the box ticked: it is authorized, but never listed, selected or made the default',
        run: async journey => {

            journey.org.browserLoginAuthorization = PRODUCTION_ORG;
            await logInFromTheButton(journey, '', true);
            await journey.waitFor('button', 'Authorize org', undefined, { isEnabled: true });

            await journey.step('the org is not offered, no workspace config was written, and one warning says why', () => {
                expectEqual(journey.optionLabelsOf(ORG_PICKER_NAME).some(optionLabel => optionLabel.includes('admin@example.com.prod')), false, 'The production org is offered');
                expectEqual(fs.existsSync(workspaceConfigPath(journey)), false, '.sf/config.json exists');
                expectEqual(notificationsShown(journey), [{
                    kind: 'warning',
                    text: 'admin@example.com.prod is authorized, but it is not a sandbox or scratch org. Target Org Manager lists only those and the Salesforce CLI\'s default org. It was not selected or made this workspace\'s default org.'
                }], 'The notifications');
            });

        }
    }

];
