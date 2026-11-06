import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { TREECIPE_TAB_FIXTURE, TREE_NAME, expectEqual, readWorkspaceFile } from './TreecipeTabWorkspace';

/*
    The Query tab's journeys (#579) on treecipeTabWorkspace, whose run carries the soql-sosl-templates
    file Generate Treecipe wrote: the queries the tab lists are that file's. A query reaches the org as
    connection.query on the fake connection, and a record opens in the browser only through the org's
    one-time singleaccess frontdoor address (CLAUDE.md, Orgs and the Salesforce CLI).
*/

export interface IQueryJourney {
    name: string;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

const BASE_QUERY_GROUP = { role: 'group', name: 'Account · Base Query' };
const BASE_QUERY_BOX = 'SOQL for Account · Base Query';
const GENERATED_BASE_QUERY = 'SELECT Id,\n       Rating__c,\n       Region__c\nFROM Account';
const QUERY_RESULTS_FOLDER = `treecipe/GeneratedRecipes/recipe-fakerjs-2026-10-15T09-00-00/${TREE_NAME}/RunArtifacts/QueryResults`;
const ACCOUNT_ROWS = [
    { attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/001000000000001AAA' }, Id: '001000000000001AAA', Rating__c: 'Hot', Region__c: 'EMEA' },
    { attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/001000000000002AAA' }, Id: '001000000000002AAA', Rating__c: 'Cold', Region__c: 'APAC' }
];
// WHAT THE ORG'S /services/oauth2/singleaccess ANSWERS: AN ADDRESS THAT LOGS IN ONCE, NEVER THE SESSION'S ACCESS TOKEN
const ONE_TIME_FRONTDOOR_URI = 'https://acme--qa.sandbox.my.salesforce.com/secur/frontdoor.jsp?otp=ONE-TIME-CODE';

export async function openQueryJourney(): Promise<RecipeCockpitJourney> {
    const journey = new RecipeCockpitJourney();
    journey.settings.set('salesforce-data-treecipe.selectedFakerService', 'faker-js');
    await journey.open(TREECIPE_TAB_FIXTURE);
    journey.org.queryAnswer = (_username, soql) => soql === GENERATED_BASE_QUERY ? { totalSize: ACCOUNT_ROWS.length, done: true, records: ACCOUNT_ROWS } : undefined;
    journey.org.callAnswer = (_username, call) => call === 'connection.requestGet' ? { frontdoor_uri: ONE_TIME_FRONTDOOR_URI } : undefined;
    await journey.click('button', 'Choose org…');
    await journey.pickOrg('qa');
    await journey.openTab('Query');
    return journey;
}

const queriesSent = (journey: RecipeCockpitJourney) => journey.org.calls
    .filter(orgCall => orgCall.call === 'connection.query' && !/\bFROM\s+Organization\b/.test(String(orgCall.args[0])))
    .map(orgCall => String(orgCall.args[0]));

export const QUERY_JOURNEYS: IQueryJourney[] = [

    {
        name: 'the Query tab: run the generated query and see its rows, keep an edit across a reopen, export CSV under RunArtifacts/QueryResults, and open a row\'s Id through the one-time frontdoor',
        run: async journey => {

            await journey.step('the Base Query is the one Generate Treecipe wrote, and nothing can be exported before a run', () => {
                const screen = journey.screen();
                const baseQueryGroup = screen.get(BASE_QUERY_GROUP.role, BASE_QUERY_GROUP.name);
                expectEqual(screen.get('textbox', BASE_QUERY_BOX, baseQueryGroup).value, GENERATED_BASE_QUERY, 'The Base Query');
                expectEqual(['Export JSON', 'Export CSV'].map(buttonName => screen.get('button', buttonName, baseQueryGroup).states), [['disabled'], ['disabled']], 'The export buttons');
            });

            await journey.click('button', 'Run in qa', BASE_QUERY_GROUP);

            await journey.step('the query is sent once as written, and the preview shows its two rows', () => {
                expectEqual(queriesSent(journey), [GENERATED_BASE_QUERY], 'The queries sent');
                const screen = journey.screen();
                const baseQueryGroup = screen.get(BASE_QUERY_GROUP.role, BASE_QUERY_GROUP.name);
                screen.get('text', '2 records from qa · qa@example.com.qa', baseQueryGroup);
                expectEqual(screen.findAll('columnheader', undefined, baseQueryGroup).map(header => header.name), ['Id', 'Rating__c', 'Region__c'], 'The preview columns');
                expectEqual(screen.findAll('row', undefined, baseQueryGroup).slice(1).map(row => screen.findAll('cell', undefined, row).map(cell => cell.name)),
                    [['001000000000001AAA', 'Hot', 'EMEA'], ['001000000000002AAA', 'Cold', 'APAC']], 'The preview rows');
            });

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', 'Export CSV', BASE_QUERY_GROUP);

            await journey.step('Export CSV writes the two rows under RunArtifacts/QueryResults/, and says where', () => {
                const exportedPaths = journey.fileChanges.slice(fileChangeCountBefore).map(fileChange => fileChange.relativePath).filter(relativePath => relativePath.startsWith(`${QUERY_RESULTS_FOLDER}/`));
                expectEqual(exportedPaths.length === 1 && /\/\d{8}-\d{6}-Account-base\.csv$/.test(exportedPaths[0]), true, `The files exported: ${JSON.stringify(exportedPaths)}`);
                const csvLines = readWorkspaceFile(journey, exportedPaths[0]).trim().split(/\r?\n/);
                expectEqual(csvLines, ['Id,Rating__c,Region__c', '001000000000001AAA,Hot,EMEA', '001000000000002AAA,Cold,APAC'], 'The CSV');
                expectEqual(journey.notifications.filter(notification => notification.buttons.length > 0).map(notification => ({ text: notification.text, buttons: notification.buttons })),
                    [{ text: `Exported 2 records from qa · qa@example.com.qa to ${exportedPaths[0]}.`, buttons: ['Open file'] }], 'The notifications with buttons');
                expectEqual(queriesSent(journey).length, 1, 'Queries sent by the export');
            });

            await journey.click('button', '001000000000001AAA', BASE_QUERY_GROUP);

            await journey.step('the row\'s Id opens the org through the one-time singleaccess address, returning to the record, and never with a session id', () => {
                expectEqual(journey.org.calls.filter(orgCall => orgCall.call === 'connection.requestGet').map(orgCall => orgCall.args),
                    [['https://acme--qa.sandbox.my.salesforce.com/services/oauth2/singleaccess']], 'The frontdoor requests');
                const openedAddresses = journey.hostCalls.filter(hostCall => hostCall.call === 'env.openExternal').map(hostCall => String(hostCall.args[0]));
                expectEqual(openedAddresses, [`${ONE_TIME_FRONTDOOR_URI}&retURL=%2F001000000000001AAA`], 'The addresses opened');
                expectEqual(openedAddresses.some(address => /[?&]sid=/.test(address)), false, 'An address carrying a session id');
            });

            const editedQuery = 'SELECT Id, Region__c FROM Account WHERE Region__c = \'EMEA\'';
            await journey.type(BASE_QUERY_BOX, editedQuery);
            await journey.reopen();

            await journey.step('after the cockpit is closed and opened again, the Query tab shows the edited query', () => {
                const screen = journey.screen();
                expectEqual(screen.get('tab', 'Query').states, ['selected'], 'The Query tab');
                expectEqual(screen.get('textbox', BASE_QUERY_BOX).value, editedQuery, 'The Base Query after the reopen');
            });

        }
    },

    {
        name: 'an edited query holding ";" outside a quoted value is refused with the reason, and no request is sent',
        run: async journey => {

            await journey.type(BASE_QUERY_BOX, 'SELECT Id FROM Account; DELETE FROM Account');
            await journey.click('button', 'Run in qa', BASE_QUERY_GROUP);

            await journey.step('a warning says why, no query reaches the org, and nothing can be exported', () => {
                expectEqual(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text })),
                    [{ kind: 'warning', text: 'The query was not run: The query must be one statement: a ";" outside a quoted value starts another.' }], 'The notifications');
                expectEqual(queriesSent(journey), [], 'The queries sent');
                const screen = journey.screen();
                expectEqual(['Export JSON', 'Export CSV'].map(buttonName => screen.get('button', buttonName, screen.get(BASE_QUERY_GROUP.role, BASE_QUERY_GROUP.name)).states), [['disabled'], ['disabled']], 'The export buttons');
                expectEqual(journey.fileChanges, [], 'Files written');
            });

            // A ";" INSIDE A QUOTED VALUE IS PART OF THE VALUE, SO THE SAME BOX RUNS THAT QUERY
            await journey.type(BASE_QUERY_BOX, 'SELECT Id FROM Account WHERE Region__c = \'EMEA; APAC\'');
            await journey.click('button', 'Run in qa', BASE_QUERY_GROUP);

            await journey.step('the quoted ";" is sent as one query, with no second warning, and its answer is drawn', () => {
                expectEqual(queriesSent(journey), ['SELECT Id FROM Account WHERE Region__c = \'EMEA; APAC\''], 'The queries sent');
                expectEqual(journey.notifications.filter(notification => notification.kind === 'warning').length, 1, 'Warnings shown');
                const screen = journey.screen();
                screen.get('text', '0 records from qa · qa@example.com.qa', screen.get(BASE_QUERY_GROUP.role, BASE_QUERY_GROUP.name));
            });

        }
    }

];
