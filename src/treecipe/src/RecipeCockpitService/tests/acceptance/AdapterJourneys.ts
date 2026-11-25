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
    chooseParentAndFields,
    loadQueriesSent,
    updatesSent
} from './AdapterWorkspace';
import { TREE_NAME, expectEqual, readWorkspaceFile } from './TreecipeTabWorkspace';

/*
    The Treecipe Adapter's journeys (#580), each on a cockpit of its own: load what an org already holds
    for a tree, generate new values for the chosen fields, update the records (old values saved first),
    and restore them -- and the three ways an update, a load and a restore must stop short. #566 moves
    this tab's host code, and these must pass unchanged across it.
*/

export interface IAdapterJourney {
    name: string;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

const ONE_TIME_FRONTDOOR_URI = 'https://acme--qa.sandbox.my.salesforce.com/secur/frontdoor.jsp?otp=ONE-TIME-CODE';
const ORG_WRITE_CALL = /^connection\.sobject\(.+\)\.(update|insert|create)$/;
const confirmationTitle = (journey: RecipeCockpitJourney) => {
    const screen = journey.screen();
    return [...screen.findAll('dialog'), ...screen.findAll('alertdialog')].map(confirmation => confirmation.name);
};
// A RECORD AS SENT, WITHOUT THE attributes ENTRY jsforce READS ITS TYPE FROM
const fieldsOf = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([fieldName]) => fieldName !== 'attributes'));
const adapterPanelLines = (journey: RecipeCockpitJourney) => journey.screen().lines(journey.screen().get('tabpanel', ADAPTER_TAB_NAME));

// LOAD AND GENERATE, AS EVERY UPDATE AND RESTORE NEEDS THEM FIRST
async function loadAndGenerate(journey: RecipeCockpitJourney): Promise<void> {
    await chooseParentAndFields(journey);
    await journey.click('button', 'Load records');
    await journey.click('button', 'Generate values');
    await journey.answerConfirmation('Generate values');
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
        name: 'load, generate, update and restore: one SELECT per object narrowed to the parents with every recipe field, a paged table with clickable lookups, Change parent object asking first, a preview of current and new values, the snapshot before any request, PATCHes of 200, the adapted data set and recipe, and the old values sent back',
        run: async journey => {

            await chooseParentAndFields(journey);
            await journey.step('step 2 names the parent and its WHERE beside Change parent object, and counts the fields chosen', () => {
                const lines = adapterPanelLines(journey);
                expectEqual(lines.includes(`  text "Parent: Account · WHERE ${PARENT_WHERE}"`) && lines.includes('  button "Change parent object"') && lines.includes('  text "2 fields chosen on 2 objects"'), true, `The Adapter tab: ${lines.slice(0, 12).join(' | ')}`);
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

            await journey.step('each object\'s records are a table of 50 to a page with its page count, Id first, and the chip counts the parents loaded', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                screen.get('text', `Parent: Account · WHERE ${PARENT_WHERE} · ${ACCOUNT_COUNT} records`, adapterPanel);
                screen.get('text', 'Page 1 of 5', adapterPanel);
                screen.get('text', 'Page 1 of 1', adapterPanel);
                const tables = screen.findAll('table', undefined, adapterPanel);
                expectEqual(tables.map(table => screen.findAll('columnheader', undefined, table)[0].name), ['Id', 'Id'], 'The first column of the Account and Contact tables');
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

            await journey.click('button', 'Generate values');
            await journey.waitForConfirmation();
            await journey.step('the Generate confirmation names the fields and the records it fills, and that nothing is written', () => {
                expectEqual(confirmationTitle(journey), [`Generate new values for 2 fields of ${TREE_NAME}?`], 'The confirmation');
                const screen = journey.screen();
                screen.get('text', 'Generated by the recipe\'s own backend, faker-js. Nothing is written to the org or the recipe file.');
                screen.get('button', `Account: ${ACCOUNT_COUNT} records`);
                screen.get('button', 'Contact: 1 record');
            });
            await journey.answerConfirmation('Generate values');

            await journey.step('the preview shows each record\'s current and new value, and nothing is sent', () => {
                const screen = journey.screen();
                const adapterPanel = screen.get('tabpanel', ADAPTER_TAB_NAME);
                screen.get('text', `New values for ${ACCOUNT_COUNT} records, not written to the org yet. Showing the first 10`, adapterPanel);
                const previewHeaders = screen.findAll('columnheader', undefined, adapterPanel).map(header => header.name);
                expectEqual(previewHeaders.includes('Region__c (current)') && previewHeaders.includes('Region__c (new)') && previewHeaders.includes('Title__c (new)'), true, `The preview columns: ${JSON.stringify(previewHeaders)}`);
                const firstNewRow = screen.findAll('row', undefined, adapterPanel).map(row => screen.findAll('cell', undefined, row).map(cell => cell.name)).find(cells => cells.length === 3 && cells[0] === ACCOUNT_IDS[0]);
                expectEqual(firstNewRow !== undefined && firstNewRow[1] === 'EMEA' && firstNewRow[2] !== 'EMEA' && firstNewRow[2] !== '', true, `The first Account's current and new value: ${JSON.stringify(firstNewRow)}`);
                expectEqual(journey.org.calls.filter(orgCall => ORG_WRITE_CALL.test(orgCall.call)), [], 'Writes to the org');
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
                expectEqual(confirmationTitle(journey), [`Update ${ACCOUNT_COUNT + 1} records of ${TREE_NAME} in qa · qa@example.com.qa?`], 'The confirmation');
                expectEqual(updatesSent(journey), [], 'Updates before the confirmation is answered');
            });
            await journey.answerConfirmation('Update records');
            await journey.step('all-or-none is asked, as for an insert', () => {
                expectEqual(journey.prompts.filter(prompt => prompt.isWaiting).map(prompt => prompt.offeredLabels), [['AllOrNone: TRUE', 'AllOrNone: FALSE']], 'The prompt waiting');
            });
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(/ were updated in qa /, 0);

            const snapshotPath = writtenSnapshotPath(journey);

            await journey.step('the snapshot holds every old value and was written before any request; the updates go parents first, at most 200 a request', () => {
                expectEqual(snapshotFoundAtEachUpdate.length > 0 && snapshotFoundAtEachUpdate.every(isFound => isFound), true, `The snapshot was on disk at each update: ${JSON.stringify(snapshotFoundAtEachUpdate)}`);
                const snapshotText = readWorkspaceFile(journey, snapshotPath);
                expectEqual([ACCOUNT_IDS[0], ACCOUNT_IDS[ACCOUNT_COUNT - 1], CONTACT_ID, OLD_CONTACT_TITLE].every(oldValuePart => snapshotText.includes(oldValuePart)), true, 'The snapshot holds the old values');
                const updates = updatesSent(journey);
                expectEqual(updates.map(update => `${update.objectApiName} × ${update.records.length}`), ['Account × 200', 'Account × 1', 'Contact × 1'], 'The update requests, in order');
                expectEqual(updates.every(update => JSON.stringify(update.options) === JSON.stringify({ allowRecursive: false, allOrNone: true })), true, 'Every request is all-or-none and never split');
                expectEqual(updates[0].records[0].Id === ACCOUNT_IDS[0] && Object.keys(fieldsOf(updates[0].records[0])).sort().join(',') === 'Id,Region__c', true, `An Account update carries its Id and the chosen field only: ${JSON.stringify(updates[0].records[0])}`);
                expectEqual(Object.keys(fieldsOf(updates[2].records[0])).sort().join(','), 'Id,Title__c', 'The Contact update carries its Id and the chosen field only');
            });

            await journey.step('one notification names the snapshot and the adapted data set and recipe, which are written', () => {
                const snapshotFileName = path.basename(snapshotPath);
                const adaptedStamp = snapshotFileName.replace(/-before\.json$/, '');
                const updateNotification = journey.notifications.find(notification => notification.text.startsWith(`${ACCOUNT_COUNT + 1} records of ${TREE_NAME} were updated`));
                expectEqual(updateNotification?.text, `${ACCOUNT_COUNT + 1} records of ${TREE_NAME} were updated in qa · qa@example.com.qa. Their old values are in ${snapshotFileName}. The adapted data set is ${TREE_NAME}-adapted-${adaptedStamp}, and the adapted recipe recipe-fakerjs--${TREE_NAME}-2026-10-15T09-00-00-adapted-${adaptedStamp}.yml.`, 'The update notification');
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

            await journey.step('the snapshot\'s old values are sent back, parents first, at most 200 a request, after the values they replace are saved in a snapshot of their own', () => {
                expectEqual(journey.notifications.slice(-1)[0]?.text.startsWith(`${ACCOUNT_COUNT + 1} records of ${TREE_NAME} were restored in qa · qa@example.com.qa. Their old values are in `), true, `The restore notification: ${JSON.stringify(journey.notifications.slice(-1)[0]?.text)}`);
                const restores = updatesSent(journey).slice(updateCountBefore);
                expectEqual(restores.map(restore => `${restore.objectApiName} × ${restore.records.length}`), ['Account × 200', 'Account × 1', 'Contact × 1'], 'The restore requests, in order');
                expectEqual(fieldsOf(restores[0].records[0]), { Id: ACCOUNT_IDS[0], Region__c: 'EMEA' }, 'The first Account gets its old value');
                expectEqual(fieldsOf(restores[2].records[0]), { Id: CONTACT_ID, Title__c: OLD_CONTACT_TITLE }, 'The Contact gets its old value');
            });

        }
    },

    {
        name: 'an update against another sandbox than the records were loaded from is refused, naming both orgs, and nothing is sent',
        run: async journey => {

            // A SECOND SANDBOX, SO THE REFUSAL IS THE ADAPTER'S OWN RULE AND NOT THE SANDBOX-ONLY ONE
            journey.org.addAuthorization({ username: 'staging@example.com.staging', aliases: ['staging'], orgId: '00D000000000STGAAA', instanceUrl: 'https://acme--staging.sandbox.my.salesforce.com', isSandbox: true });
            await loadAndGenerate(journey);
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

            await chooseParentAndFields(journey, `${PARENT_WHERE} FOR UPDATE`);
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

            await loadAndGenerate(journey);
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
