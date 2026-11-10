import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { expectEqual } from './TreecipeTabWorkspace';

/*
    Authorize org (#630): a reader with a sandbox that is not authorized yet logs in to it from Target
    Org Manager. Ticking the confirmation's box selects it and makes it this workspace's default org;
    leaving it unticked only lists it; and a production org is authorized but never listed or made the
    default. Each on its own copy of treecipeTabWorkspace. The login is the CLI's "sf org login web",
    answered by the journey's fake CLI, which saves the org as the real one would.
*/

const ORG_PICKER_NAME = 'Salesforce org the generated data goes to';
const DEFAULT_ORG_CHECKBOX_NAME = 'Make this my selected target org and this workspace\'s default org';
const CONFIRMATION_TITLE = 'Log in to a Salesforce org at test.salesforce.com in your browser?';
const NEW_SANDBOX = { username: 'new@example.com.newsbx', orgId: '00D000000000NEWAAA', instanceUrl: 'https://acme--newsbx.sandbox.my.salesforce.com', isSandbox: true };
const PRODUCTION_ORG = { username: 'admin@example.com.prod', orgId: '00D000000000PRDAAA', instanceUrl: 'https://example.my.salesforce.com', isSandbox: false };

type BrowserLoginAuthorization = typeof NEW_SANDBOX | typeof PRODUCTION_ORG;

const isLoginWeb = (argv: string[]) => argv.slice(0, 3).join(' ') === 'org login web';

// THE READER LOGS IN IN THE BROWSER THE CLI OPENED: THE CLI SAVES THE ORG AND ANSWERS ITS FIELDS, TOKEN INCLUDED
function answerBrowserLogin(journey: RecipeCockpitJourney, authorization: BrowserLoginAuthorization) {
    journey.cli.answer = argv => {
        if ( !isLoginWeb(argv) ) { return undefined; }
        journey.org.addAuthorization(authorization);
        return { stdout: JSON.stringify({ status: 0, result: { username: authorization.username, orgId: authorization.orgId, instanceUrl: authorization.instanceUrl, accessToken: '00D!fakeAccessToken' } }), exitCode: 0 };
    };
}

const workspaceConfigPath = (journey: RecipeCockpitJourney) => path.join(journey.workspaceRoot, '.sf', 'config.json');
const notificationsShown = (journey: RecipeCockpitJourney) => journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text }));

async function logInFromTheButton(journey: RecipeCockpitJourney, alias: string, isDefaultTicked: boolean): Promise<void> {

    await journey.click('button', 'Authorize org');
    await journey.answerQuickPick('Sandbox');
    await journey.answerInputBox(alias);
    await journey.waitForConfirmation();

    await journey.step('the confirmation names the login address and offers the box unticked', () => {
        const screen = journey.screen();
        const confirmation = screen.get('dialog', CONFIRMATION_TITLE);
        expectEqual(screen.get('checkbox', DEFAULT_ORG_CHECKBOX_NAME, confirmation).states.includes('checked'), false, 'The box starts ticked');
        expectEqual(journey.cli.calls.filter(cliCall => isLoginWeb(cliCall.argv)).length, 0, 'Logins started before the confirmation is answered');
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

            answerBrowserLogin(journey, NEW_SANDBOX);
            await logInFromTheButton(journey, 'newsbx', true);
            await journey.waitFor('button', 'Authorize org', undefined, { isEnabled: true });

            await journey.step('the Salesforce CLI logged in at the sandbox login page, with no alias and no project folder', () => {
                expectEqual(journey.cli.calls, [{ argv: ['org', 'login', 'web', '--instance-url', 'https://test.salesforce.com', '--no-prompt', '--json'] }], 'sf processes run');
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'env.openExternal').length, 0, 'Browsers the extension opened itself');
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

            answerBrowserLogin(journey, NEW_SANDBOX);
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

            answerBrowserLogin(journey, PRODUCTION_ORG);
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
