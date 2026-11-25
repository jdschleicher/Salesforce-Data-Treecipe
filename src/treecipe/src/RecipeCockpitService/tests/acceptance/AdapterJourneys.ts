import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import {
    ACCOUNT_COUNT,
    ACCOUNT_IDS,
    ADAPTER_TAB_NAME,
    CONTACT_ID,
    OLD_CONTACT_TITLE,
    PARENT_WHERE,
    SNAPSHOT_FILE_PATTERN,
    UPDATE_ATTEMPTS_FOLDER,
    chooseParent,
    loadQueriesSent,
    updatesSent
} from './AdapterWorkspace';
import { TREE_NAME, expectEqual, readWorkspaceFile } from './TreecipeTabWorkspace';

/*
    The Treecipe Adapter's journeys (#580), each on a cockpit of its own: load what an org already holds
    for a tree, mark the rows to change and generate new values cell by cell (#721), update those
    records (old values saved first), and restore them -- and the three ways an update, a load and a restore must stop short. #566 moves
    this tab's host code, and these must pass unchanged across it.
*/

export interface IAdapterJourney {
    name: string;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

const ONE_TIME_FRONTDOOR_URI = 'https://acme--qa.sandbox.my.salesforce.com/secur/frontdoor.jsp?otp=ONE-TIME-CODE';
const TYPED_CONTACT_TITLE = 'Head of Field Trials';
const ORG_WRITE_CALL = /^connection\.sobject\(.+\)\.(update|insert|create)$/;
const confirmationTitle = (journey: RecipeCockpitJourney) => {
    const screen = journey.screen();
    return [...screen.findAll('dialog'), ...screen.findAll('alertdialog')].map(confirmation => confirmation.name);
};
// A RECORD AS SENT, WITHOUT THE attributes ENTRY jsforce READS ITS TYPE FROM
const fieldsOf = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([fieldName]) => fieldName !== 'attributes'));
const adapterPanelLines = (journey: RecipeCockpitJourney) => journey.screen().lines(journey.screen().get('tabpanel', ADAPTER_TAB_NAME));

// LOAD, THEN ONE ACCOUNT AND THE CONTACT MARKED AND GIVEN A NEW VALUE EACH, AS EVERY UPDATE AND RESTORE NEEDS FIRST
async function loadAndChange(journey: RecipeCockpitJourney): Promise<void> {
    await chooseParent(journey);
    await journey.click('button', 'Load records');
    await journey.click('button', `Mark to update Account ${ACCOUNT_IDS[0]}`);
    await journey.click('button', `Generate a value for Region__c of Account ${ACCOUNT_IDS[0]}`);
    await journey.click('button', `Mark to update Contact ${CONTACT_ID}`);
    await journey.click('button', `Generate a value for Title__c of Contact ${CONTACT_ID}`);
}

const writtenSnapshotPath = (journey: RecipeCockpitJourney) => {
    const snapshotPaths = journey.fileChanges.filter(fileChange => fileChange.change === 'written' && SNAPSHOT_FILE_PATTERN.test(fileChange.relativePath)).map(fileChange => fileChange.relativePath);
    if ( snapshotPaths.length !== 1 ) {
        throw new Error(`expected one snapshot written, but found ${JSON.stringify(snapshotPaths)}. The notifications: ${JSON.stringify(journey.notifications.map(notification => `${notification.kind}: ${notification.text}`))}`);
    }
    return snapshotPaths[0];
};

export const ADAPTER_JOURNEYS: IAdapterJourney[] = [

    {
        name: 'load, mark, generate, update and restore: one SELECT per object narrowed to the parents with every recipe field, a paged table with clickable lookups, Change parent object asking first, rows marked and cells given new values or put back, the snapshot of the changed cells before any request, the adapted data set and recipe, and the old values sent back',
        run: async journey => {

            await chooseParent(journey);
            await journey.step('step 2 names the parent and its WHERE beside Change parent object, and says no row is marked', () => {
                const lines = adapterPanelLines(journey);
                expectEqual(lines.includes(`  text "Parent: Account · WHERE ${PARENT_WHERE}"`) && lines.includes('  button "Change parent object"') && lines.includes('  text "No rows marked to update"'), true, `The Adapter tab: ${lines.slice(0, 12).join(' | ')}`);
            });

            await journey.click('button', 'Load records');

            // 201 PARENT Ids DO NOT FIT ONE IN (…): THE CHILD QUERY GOES IN PARTS OF 150, EACH STILL NARROWED TO PARENTS' Ids
            await journey.step('a SELECT per object, each child narrowed to the Ids its parents were given, in parts of 150 Ids', () => {
                const queries = loadQueriesSent(journey);
                const inList = (accountIds: string[]) => accountIds.map(accountId => `'${accountId}'`).join(', ');
                expectEqual(queries.length, 4, `The load queries: ${JSON.stringify(queries.map(query => query.slice(0, 120)))}`);
                // EVERY FIELD THE TREECIPE LISTS IS READ (#720), WHATEVER IS TICKED: Id, THE LOOKUPS, THEN THE REST
                const selectedFieldsOf = (query: string) => /^SELECT (.+?) FROM /.exec(query)![1].split(', ');
                const fromOf = (query: string) => query.slice(query.indexOf(' FROM '));
                expectEqual(fromOf(queries[0]), ` FROM Account WHERE ${PARENT_WHERE}`, 'The parent query');
                expectEqual(fromOf(queries[1]), ` FROM Contact WHERE AccountId IN (${inList(ACCOUNT_IDS.slice(0, 150))})`, 'The Contact query for the first 150 Accounts');
                expectEqual(fromOf(queries[2]), ` FROM Contact WHERE AccountId IN (${inList(ACCOUNT_IDS.slice(150))})`, 'The Contact query for the other 51');
                expectEqual(fromOf(queries[3]), ` FROM Visit__c WHERE Contact__c IN ('${CONTACT_ID}')`, 'The Visit__c query');
                expectEqual(selectedFieldsOf(queries[0])[0] === 'Id' && selectedFieldsOf(queries[0]).includes('Region__c') && selectedFieldsOf(queries[0]).length > 3, true, `The Account fields read: ${JSON.stringify(selectedFieldsOf(queries[0]))}`);
                expectEqual(selectedFieldsOf(queries[1]).slice(0, 2), ['Id', 'AccountId'], 'The Contact query starts with its Id and its lookup to the parent');
                expectEqual(selectedFieldsOf(queries[1]).includes('Title__c'), true, `The Contact fields read: ${JSON.stringify(selectedFieldsOf(queries[1]))}`);
                expectEqual(new Set(selectedFieldsOf(queries[0])).size, selectedFieldsOf(queries[0]).length, 'Each Account field is read once');
                expectEqual(journey.notifications.map(notification => notification.text), [`Loaded ${ACCOUNT_COUNT + 1} records of ${TREE_NAME} from qa · qa@example.com.qa.`], 'The notifications');
            });

            await journey.step('each object\'s records are a table of 50 to a page with its page count, the mark column then Id, and the chip counts the parents loaded', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                screen.get('text', `Parent: Account · WHERE ${PARENT_WHERE} · ${ACCOUNT_COUNT} records`, adapterPanel);
                screen.get('text', 'Page 1 of 5', adapterPanel);
                screen.get('text', 'Page 1 of 1', adapterPanel);
                const tables = screen.findAll('table', undefined, adapterPanel);
                expectEqual(tables.map(table => screen.findAll('columnheader', undefined, table).slice(0, 2).map(header => header.name)), [['Update', 'Id 🔒'], ['Update', 'Id 🔒']], 'The first columns of the Account and Contact tables: the mark, then the Id, which cannot be changed');
                expectEqual(screen.findAll('row', undefined, tables[0]).filter(row => screen.findAll('cell', undefined, row).length > 0).length, 50, 'The Account rows on page 1');
                expectEqual(screen.findAll('button', ACCOUNT_IDS[49], tables[0]).length + screen.findAll('button', ACCOUNT_IDS[50], tables[0]).length, 1, 'Page 1 ends at the 50th Account');
            });

            await journey.click('button', 'Next page of Account records');
            await journey.step('Next shows the 51st to the 100th Account, read from the records already loaded', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                screen.get('text', 'Page 2 of 5', adapterPanel);
                const [accountTable] = screen.findAll('table', undefined, adapterPanel);
                screen.get('button', ACCOUNT_IDS[50], accountTable);
                screen.get('button', ACCOUNT_IDS[99], accountTable);
                expectEqual(screen.findAll('button', ACCOUNT_IDS[0], accountTable), [], 'The first Account on page 2');
                expectEqual(loadQueriesSent(journey).length, 4, 'Queries after paging');
            });

            // THE FIRST ACCOUNT IS NO LONGER IN ITS OWN TABLE (PAGE 2), SO THE ONLY LINK NAMED BY ITS Id IS THE CONTACT'S LOOKUP TO IT
            journey.org.callAnswer = (_username, call) => call === 'connection.requestGet' ? { frontdoor_uri: ONE_TIME_FRONTDOOR_URI } : undefined;
            await journey.click('button', ACCOUNT_IDS[0]);
            await journey.step('a lookup cell holding a whole Id opens that parent record in the org it was loaded from, through the one-time address', () => {
                const openedAddresses = journey.hostCalls.filter(hostCall => hostCall.call === 'env.openExternal').map(hostCall => String(hostCall.args[0]));
                expectEqual(openedAddresses, [`${ONE_TIME_FRONTDOOR_URI}&retURL=%2F${ACCOUNT_IDS[0]}`], 'The addresses opened');
            });

            await journey.click('button', 'Change parent object');
            await journey.waitForConfirmation();
            await journey.step('Change parent object asks before letting the loaded records go', () => {
                expectEqual(confirmationTitle(journey), [`Change the parent object of ${TREE_NAME}?`], 'The confirmation');
                journey.screen().get('text', `The ${ACCOUNT_COUNT + 1} loaded records are let go, and step 1 opens with the parent object and WHERE as they are. Nothing in the org changes.`);
            });
            await journey.answerConfirmation('Cancel');
            await journey.step('Cancel keeps step 2 and its records as they were', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                screen.get('text', 'Page 2 of 5', adapterPanel);
                screen.get('text', `Parent: Account · WHERE ${PARENT_WHERE} · ${ACCOUNT_COUNT} records`, adapterPanel);
                expectEqual(screen.findAll('button', 'Next', adapterPanel), [], 'Step 1 on screen');
            });

            // PAGE 2 IS ON SCREEN: ITS FIRST TWO ACCOUNTS ARE MARKED, THE COLUMN'S 🎲 FILLS BOTH, AND ↺ PUTS ONE BACK
            const regionCellOf = (accountId: string) => {
                const screen = journey.screen();
                const [accountTable] = screen.findAll('table', undefined, screen.get('tabpanel', ADAPTER_TAB_NAME));
                const headers = screen.findAll('columnheader', undefined, accountTable).map(header => header.name);
                const accountRow = screen.findAll('row', undefined, accountTable).find(row => screen.findAll('button', accountId, row).length > 0)!;
                return screen.findAll('cell', undefined, accountRow)[headers.findIndex(header => header.startsWith('Region__c'))].name;
            };
            await journey.step('no row offers a new value before it is marked, and the column\'s 🎲 waits for a marked row', () => {
                const screen = journey.screen();
                expectEqual(screen.findAll('button', `Generate a value for Region__c of Account ${ACCOUNT_IDS[50]}`), [], 'The 🎲 of a row not marked');
                expectEqual(screen.get('button', 'Generate Region__c for every marked Account row').states.includes('disabled'), true, 'The column\'s 🎲 with no row marked');
            });

            await journey.click('button', `Mark to update Account ${ACCOUNT_IDS[50]}`);
            await journey.click('button', `Mark to update Account ${ACCOUNT_IDS[51]}`);
            await journey.click('button', 'Generate Region__c for every marked Account row');
            await journey.step('the column\'s 🎲 gives each marked row a new value from the recipe\'s own backend, with no confirmation, and nothing is sent', () => {
                expectEqual(confirmationTitle(journey), [], 'Confirmations on screen');
                expectEqual([ACCOUNT_IDS[50], ACCOUNT_IDS[51]].every(accountId => !regionCellOf(accountId).startsWith('EMEA') && regionCellOf(accountId) !== ''), true, `The marked rows' Region__c: ${JSON.stringify([regionCellOf(ACCOUNT_IDS[50]), regionCellOf(ACCOUNT_IDS[51])])}`);
                expectEqual(regionCellOf(ACCOUNT_IDS[52]).startsWith('EMEA'), true, `A row not marked keeps its value: ${regionCellOf(ACCOUNT_IDS[52])}`);
                journey.screen().get('text', '2 rows marked · 2 records to update: Region__c');
                expectEqual(journey.org.calls.filter(orgCall => ORG_WRITE_CALL.test(orgCall.call)), [], 'Writes to the org');
            });

            await journey.click('button', `Put back the loaded Region__c of Account ${ACCOUNT_IDS[51]}`);
            await journey.step('↺ puts one cell back as loaded, so its record is no longer one to update', () => {
                expectEqual(regionCellOf(ACCOUNT_IDS[51]).startsWith('EMEA'), true, `The cell put back: ${regionCellOf(ACCOUNT_IDS[51])}`);
                journey.screen().get('text', '2 rows marked · 1 record to update: Region__c');
            });

            // ⌨ OPENS AN INPUT IN THE CELL: A VALUE THE FIELD CANNOT TAKE IS REFUSED BY NAME, AND ONE IT CAN IS THE CELL'S NEW VALUE
            await journey.click('button', `Mark to update Contact ${CONTACT_ID}`);
            await journey.click('button', `Type a value for Title__c of Contact ${CONTACT_ID}`);
            await journey.type(`New value for Title__c of Contact ${CONTACT_ID}`, TYPED_CONTACT_TITLE);
            await journey.click('button', 'Save');
            await journey.step('a value typed into a cell of a marked row is that cell\'s new value, and the Contact is one more record to update', () => {
                const screen = journey.screen();
                const contactTable = screen.findAll('table', undefined, screen.get('tabpanel', ADAPTER_TAB_NAME))[1];
                expectEqual(screen.findAll('cell', undefined, contactTable).some(cell => cell.name.startsWith(TYPED_CONTACT_TITLE)), true, `The Contact's cells: ${JSON.stringify(screen.findAll('cell', undefined, contactTable).map(cell => cell.name))}`);
                screen.get('text', '1 row marked · 1 record to update: Title__c');
            });
            await journey.step('the card counts the marked rows and the records an update would write, over both objects', () => {
                journey.screen().get('text', '3 rows marked · 2 records to update');
            });

            // THE SNAPSHOT MUST BE ON DISK BEFORE THE FIRST REQUEST: THE ORG'S ANSWER LOOKS FOR IT AS EACH UPDATE ARRIVES
            const snapshotFoundAtEachUpdate: boolean[] = [];
            journey.org.updateAnswer = () => {
                const attemptsFolder = path.join(journey.workspaceRoot, ...UPDATE_ATTEMPTS_FOLDER.split('/'));
                snapshotFoundAtEachUpdate.push(fs.existsSync(attemptsFolder) && fs.readdirSync(attemptsFolder).some(fileName => fileName.endsWith('-before.json')));
                return undefined;
            };

            await journey.click('button', /^Update \d+ records in qa · qa@example\.com\.qa$/);
            await journey.waitForConfirmation();
            await journey.step('the Update confirmation names the records, the tree and the sandbox', () => {
                expectEqual(confirmationTitle(journey), [`Update 2 records of ${TREE_NAME} in qa · qa@example.com.qa?`], 'The confirmation');
                expectEqual(updatesSent(journey), [], 'Updates before the confirmation is answered');
            });
            await journey.answerConfirmation('Update records');
            await journey.step('all-or-none is asked, as for an insert', () => {
                expectEqual(journey.prompts.filter(prompt => prompt.isWaiting).map(prompt => prompt.offeredLabels), [['AllOrNone: TRUE', 'AllOrNone: FALSE']], 'The prompt waiting');
            });
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(/ were updated in qa /, 0);

            const snapshotPath = writtenSnapshotPath(journey);

            await journey.step('the snapshot holds the old value of each changed cell only and was written before any request; the updates go parents first', () => {
                expectEqual(snapshotFoundAtEachUpdate.length > 0 && snapshotFoundAtEachUpdate.every(isFound => isFound), true, `The snapshot was on disk at each update: ${JSON.stringify(snapshotFoundAtEachUpdate)}`);
                const snapshotText = readWorkspaceFile(journey, snapshotPath);
                expectEqual([ACCOUNT_IDS[50], CONTACT_ID, OLD_CONTACT_TITLE].every(oldValuePart => snapshotText.includes(oldValuePart)), true, 'The snapshot holds the old values');
                expectEqual([ACCOUNT_IDS[0], ACCOUNT_IDS[51]].filter(untouchedId => snapshotText.includes(`"${untouchedId}"`)), [], 'Records in the snapshot that were not changed');
                const updates = updatesSent(journey);
                expectEqual(updates.map(update => `${update.objectApiName} × ${update.records.length}`), ['Account × 1', 'Contact × 1'], 'The update requests, in order');
                expectEqual(updates.every(update => JSON.stringify(update.options) === JSON.stringify({ allowRecursive: false, allOrNone: true })), true, 'Every request is all-or-none and never split');
                expectEqual(updates[0].records[0].Id === ACCOUNT_IDS[50] && Object.keys(fieldsOf(updates[0].records[0])).sort().join(',') === 'Id,Region__c', true, `An Account update carries its Id and the changed field only: ${JSON.stringify(updates[0].records[0])}`);
                expectEqual(fieldsOf(updates[1].records[0]), { Id: CONTACT_ID, Title__c: TYPED_CONTACT_TITLE }, 'The Contact update carries its Id and the value typed, and nothing else');
            });

            await journey.step('one notification names the snapshot and the adapted data set and recipe, which are written', () => {
                const snapshotFileName = path.basename(snapshotPath);
                const adaptedStamp = snapshotFileName.replace(/-before\.json$/, '');
                const updateNotification = journey.notifications.find(notification => notification.text.startsWith(`2 records of ${TREE_NAME} were updated`));
                expectEqual(updateNotification?.text, `2 records of ${TREE_NAME} were updated in qa · qa@example.com.qa. Their old values are in ${snapshotFileName}. The adapted data set is ${TREE_NAME}-adapted-${adaptedStamp}, and the adapted recipe recipe-fakerjs--${TREE_NAME}-2026-10-15T09-00-00-adapted-${adaptedStamp}.yml.`, 'The update notification');
                const adaptedFolder = `treecipe/FakeDataSets/${TREE_NAME}-adapted-${adaptedStamp}`;
                const adaptedRecipePath = `${adaptedFolder}/BaseArtifactFiles/recipe-fakerjs--${TREE_NAME}-2026-10-15T09-00-00-adapted-${adaptedStamp}.yml`;
                expectEqual(journey.fileChanges.some(fileChange => fileChange.relativePath === adaptedRecipePath) && journey.fileChanges.some(fileChange => fileChange.relativePath === `${adaptedFolder}/BaseArtifactFiles/datasetSource.json`), true, 'The adapted recipe and data set source are written');
                expectEqual(readWorkspaceFile(journey, adaptedRecipePath).includes('- object: Account'), true, 'The adapted recipe is a recipe of the tree');
            });

            const updateCountBefore = updatesSent(journey).length;
            await journey.click('button', `Restore previous values… ${path.basename(snapshotPath)}`);
            await journey.waitForConfirmation();
            await journey.step('the Restore confirmation names the snapshot', () => {
                expectEqual(confirmationTitle(journey).length, 1, 'Confirmations on screen');
                expectEqual(journey.screen().lines().some(screenLine => screenLine.includes(path.basename(snapshotPath))), true, 'The snapshot is named on screen');
            });
            const notificationCountBeforeRestore = journey.notifications.length;
            await journey.answerConfirmation('Restore values');
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(/ were restored in qa /, notificationCountBeforeRestore);

            await journey.step('the snapshot\'s old values are sent back, parents first, after the values they replace are saved in a snapshot of their own', () => {
                expectEqual(journey.notifications.slice(-1)[0]?.text.startsWith(`2 records of ${TREE_NAME} were restored in qa · qa@example.com.qa. Their old values are in `), true, `The restore notification: ${JSON.stringify(journey.notifications.slice(-1)[0]?.text)}`);
                const restores = updatesSent(journey).slice(updateCountBefore);
                expectEqual(restores.map(restore => `${restore.objectApiName} × ${restore.records.length}`), ['Account × 1', 'Contact × 1'], 'The restore requests, in order');
                expectEqual(fieldsOf(restores[0].records[0]), { Id: ACCOUNT_IDS[50], Region__c: 'EMEA' }, 'The changed Account gets its old value');
                expectEqual(fieldsOf(restores[1].records[0]), { Id: CONTACT_ID, Title__c: OLD_CONTACT_TITLE }, 'The Contact gets its old value');
            });

        }
    },

    {
        name: 'generate new records: an object below the parent has a second tab, a count per loaded parent makes count x parents records with the recipe\'s backend, each under a loaded parent, previewed in pages and written nowhere',
        run: async journey => {

            await chooseParent(journey);
            await journey.click('button', 'Load records');

            await journey.step('Contact, below the parent, has two tabs and opens on its loaded table; Account, the parent, has none', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                expectEqual(screen.findAll('tab', 'Generate new records', adapterPanel).length, 1, 'Generate new records tabs: only Contact was loaded below the parent with its section open');
                expectEqual(screen.get('tab', 'Edit existing records', adapterPanel).states.includes('selected'), true, 'Edit existing records is the tab a load opens');
            });

            await journey.click('tab', 'Generate new records');
            await journey.step('the tab says what the new records go under, and offers the count and Generate records', () => {
                const screen = journey.screen();
                screen.get('text', `Add new Contact records under the ${ACCOUNT_COUNT} Account records loaded.`);
                expectEqual(screen.get('button', 'Generate records of Contact').states.includes('disabled'), false, 'Generate records with parents loaded');
            });

            await journey.type('Contact records per loaded Account record', '2');
            await journey.click('button', 'Generate records of Contact');
            await journey.waitForConfirmation();
            await journey.step('the confirmation names the count, the parents and the total, and that nothing is written', () => {
                expectEqual(confirmationTitle(journey), [`Generate ${ACCOUNT_COUNT * 2} new Contact records under the loaded Account records?`], 'The confirmation');
                expectEqual(journey.screen().lines().some(screenLine => screenLine.includes(`2 per Account record, under ${ACCOUNT_COUNT} Account records: ${ACCOUNT_COUNT * 2} Contact records`)), true, 'The count, the parents and the total are on screen');
            });
            await journey.answerConfirmation('Generate records');
            await journey.waitForNotification(/^Generated \d+ new Contact records/, 0);

            await journey.step('the preview counts the records, shows 50 to a page with each record under a loaded Account in load order, and nothing reached the org', () => {
                const screen = journey.screen();
                const newRecordsPanel = screen.get('tabpanel', 'Generate new records of Contact');
                screen.get('text', `${ACCOUNT_COUNT * 2} new Contact records, 2 per Account record`, newRecordsPanel);
                screen.get('text', `Page 1 of ${Math.ceil(ACCOUNT_COUNT * 2 / 50)}`, newRecordsPanel);
                const [previewTable] = screen.findAll('table', undefined, newRecordsPanel);
                const previewRows = screen.findAll('row', undefined, previewTable).map(row => screen.findAll('cell', undefined, row).map(cell => cell.name)).filter(cells => cells.length > 0);
                expectEqual(previewRows.length, 50, 'Rows on the first page');
                expectEqual(previewRows.slice(0, 4).map(cells => cells[0]), [ACCOUNT_IDS[0], ACCOUNT_IDS[0], ACCOUNT_IDS[1], ACCOUNT_IDS[1]], 'The parent of the first four new records');
                expectEqual(journey.org.calls.filter(orgCall => ORG_WRITE_CALL.test(orgCall.call)), [], 'Writes to the org');
                expectEqual(journey.notifications.slice(-1)[0]?.text, `Generated ${ACCOUNT_COUNT * 2} new Contact records, 2 per loaded Account record. Nothing was written to the org.`, 'The notification');
            });

            await journey.click('button', 'Next page of new Contact records');
            await journey.step('Next shows the second page, cut from the records the host holds', () => {
                const screen = journey.screen();
                screen.get('text', `Page 2 of ${Math.ceil(ACCOUNT_COUNT * 2 / 50)}`, screen.get('tabpanel', 'Generate new records of Contact'));
            });

            await journey.click('tab', 'Edit existing records');
            await journey.step('the loaded table is still on the first tab', () => {
                const screen = journey.screen();
                screen.get('button', `Mark to update Contact ${CONTACT_ID}`);
            });

        }
    },

    {
        name: 'an update against another sandbox than the records were loaded from is refused, naming both orgs, and nothing is sent',
        run: async journey => {

            // A SECOND SANDBOX, SO THE REFUSAL IS THE ADAPTER'S OWN RULE AND NOT THE SANDBOX-ONLY ONE
            journey.org.addAuthorization({ username: 'staging@example.com.staging', aliases: ['staging'], orgId: '00D000000000STGAAA', instanceUrl: 'https://acme--staging.sandbox.my.salesforce.com', isSandbox: true });
            await loadAndChange(journey);
            await journey.click('button', 'Refresh orgs: check the org connections again');
            await journey.pickOrg('staging');

            const notificationCountBeforeUpdate = journey.notifications.length;
            await journey.click('button', /^Update \d+ records in /);
            await journey.waitForNotification(/^Nothing was updated: /, notificationCountBeforeUpdate);

            // REFUSED BEFORE ANY CONFIRMATION: THE READER IS NOT ASKED TO CONFIRM AN UPDATE THAT CANNOT GO
            await journey.step('the update is refused with the reason, before any confirmation, and nothing reaches either org', () => {
                expectEqual(confirmationTitle(journey), [], 'Confirmations on screen');
                expectEqual(journey.org.calls.filter(orgCall => ORG_WRITE_CALL.test(orgCall.call)), [], 'Writes to any org');
                expectEqual(journey.fileChanges.filter(fileChange => SNAPSHOT_FILE_PATTERN.test(fileChange.relativePath)), [], 'Snapshots written');
                const refusal = journey.notifications.slice(-1)[0];
                expectEqual({ kind: refusal?.kind, text: refusal?.text }, { kind: 'warning', text: `Nothing was updated: the records of ${TREE_NAME} were loaded from qa@example.com.qa, not staging · staging@example.com.staging. Load them again from the org selected now.` }, 'The refusal');
            });

        }
    },

    {
        name: 'a load whose WHERE holds FOR UPDATE is refused with the reason, and nothing is queried',
        run: async journey => {

            await chooseParent(journey, `${PARENT_WHERE} FOR UPDATE`);
            await journey.click('button', 'Load records');

            await journey.step('the reason is given, and no load query reaches the org', () => {
                expectEqual(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text })), [{
                    kind: 'warning',
                    text: 'Records were not loaded: The WHERE for Account holds FOR VIEW, FOR REFERENCE or FOR UPDATE, which change or lock records, and a load only reads.'
                }], 'The notifications');
                expectEqual(loadQueriesSent(journey), [], 'Load queries sent');
            });

        }
    },

    {
        name: 'a restore from a snapshot edited by hand out of shape refuses the whole file, and nothing is sent',
        run: async journey => {

            await loadAndChange(journey);
            await journey.click('button', /^Update \d+ records in qa · qa@example\.com\.qa$/);
            await journey.answerConfirmation('Update records');
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(/ were updated in qa /, 0);
            const snapshotPath = writtenSnapshotPath(journey);
            const updateCountBefore = updatesSent(journey).length;

            // ONE RECORD OF THE SNAPSHOT LOSES ITS Id: THE REST WOULD STILL READ, BUT A SNAPSHOT IS RESTORED WHOLE OR NOT AT ALL
            const snapshotFilePath = path.join(journey.workspaceRoot, ...snapshotPath.split('/'));
            const snapshotText = fs.readFileSync(snapshotFilePath, 'utf8');
            fs.writeFileSync(snapshotFilePath, snapshotText.replace(`"${CONTACT_ID}"`, '"not-an-id"'));

            const notificationCountBeforeRestore = journey.notifications.length;
            await journey.click('button', `Restore previous values… ${path.basename(snapshotPath)}`);
            await journey.waitForNotification(/^Nothing was restored: /, notificationCountBeforeRestore);

            await journey.step('the whole snapshot is refused with the reason, before any confirmation, and no record is sent back', () => {
                expectEqual(confirmationTitle(journey), [], 'Confirmations on screen');
                expectEqual(updatesSent(journey).slice(updateCountBefore), [], 'Restore requests sent');
                const refusal = journey.notifications.slice(-1)[0];
                expectEqual({ kind: refusal?.kind, text: refusal?.text }, {
                    kind: 'warning',
                    text: `Nothing was restored: ${path.basename(snapshotPath)} was refused, because a record of Contact in it has no Salesforce Id or no values.`
                }, 'The refusal');
            });

        }
    }

];
