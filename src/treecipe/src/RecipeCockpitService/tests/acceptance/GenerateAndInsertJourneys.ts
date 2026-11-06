import * as fs from 'fs';
import * as path from 'path';
import { RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL } from '../../RecipeCockpitService';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { INSERT_ORG_LABEL, insertsSent } from './TreecipeTabJourneys';
import { GENERATE_AND_INSERT_BUTTON_NAME, TREE_NAME, expectEqual, writtenDatasetFolder } from './TreecipeTabWorkspace';

/*
    Generate fake data and insert (#578): the happy path into a sandbox, and the four ways it must stop
    short -- a production org, no org chosen, Cancel in the confirmation, and a record Salesforce rejects
    when all-or-none is off. Each on its own copy of treecipeTabWorkspace.
*/

const CONFIRMATION_TITLE = `Generate ${TREE_NAME} and insert it into qa (qa@example.com.qa)?`;
const PRODUCTION_ORG = { username: 'admin@example.com.prod', aliases: ['prod'], orgId: '00D000000000PRDAAA', instanceUrl: 'https://example.my.salesforce.com', isSandbox: false };

const insertCallCount = (journey: RecipeCockpitJourney) => journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call)).length;

export const GENERATE_AND_INSERT_JOURNEYS: Array<{ name: string; run(journey: RecipeCockpitJourney): Promise<void> }> = [

    {
        name: 'generate and insert into a sandbox: totals, all-or-none, parents first, one notification, and a new data set row',
        run: async journey => {

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.click('button', /^Records, inserted parents first/);

            await journey.step('the confirmation lists each object\'s record total, parents first', () => {
                const screen = journey.screen();
                const confirmation = screen.get('alertdialog', CONFIRMATION_TITLE);
                screen.get('text', 'Generate 3 records and insert them into qa (qa@example.com.qa).', confirmation);
                expectEqual(screen.findAll('listitem', /^(Account|Contact|Visit__c): /, confirmation).map(listItem => listItem.name),
                    ['Account: 1', 'Contact: 1 (1 per Account)', 'Visit__c: 1 (1 per Contact)'], 'The record totals the confirmation lists');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent before the confirmation is answered');
            });

            await journey.answerConfirmation('Generate and insert');

            await journey.step('all-or-none is asked', () => {
                expectEqual(journey.prompts.filter(prompt => prompt.isWaiting).map(prompt => prompt.offeredLabels), [['AllOrNone: TRUE', 'AllOrNone: FALSE']], 'The prompt waiting');
            });

            await journey.answerQuickPick('AllOrNone: TRUE');
            const datasetFolder = writtenDatasetFolder(journey, fileChangeCountBefore);

            await journey.step('the records go parents first, each child pointing at the Id its parent was given', () => {
                const inserts = insertsSent(journey);
                expectEqual(inserts.map(insert => insert.objectApiName), ['Account', 'Contact', 'Visit__c'], 'The objects inserted, in order');
                const insertOptions = journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call)).map(orgCall => orgCall.args[1]);
                expectEqual(insertOptions, Array(3).fill({ allowRecursive: false, allOrNone: true }), 'The options of each insert');
                expectEqual(inserts[0].records[0].RecordTypeId, '012000000000001AAA', 'The Account\'s RecordTypeId, Business\'s Id in the org');
                expectEqual(typeof inserts[1].records[0].AccountId === 'string' && /^Accoun\d{12}$/.test(inserts[1].records[0].AccountId as string), true, `The Contact's AccountId (${inserts[1].records[0].AccountId}) is the Id given to the Account`);
                expectEqual(typeof inserts[2].records[0].Contact__c === 'string' && /^Contac\d{12}$/.test(inserts[2].records[0].Contact__c as string), true, `The Visit__c's Contact__c (${inserts[2].records[0].Contact__c}) is the Id given to the Contact`);
            });

            await journey.step('one notification says what landed, with View results', () => {
                expectEqual(journey.notifications.filter(notification => notification.kind !== 'information' || notification.buttons.length > 0)
                    .map(notification => ({ kind: notification.kind, text: notification.text, buttons: notification.buttons })),
                [{ kind: 'information', text: `3 records were inserted into qa (qa@example.com.qa) from ${TREE_NAME}.`, buttons: ['View results'] }], 'The notifications with something to say');
            });

            await journey.clickNotificationButton('View results');

            await journey.step('View results opens the data set\'s results file', () => {
                const openedPaths = journey.hostCalls.filter(hostCall => hostCall.call === 'workspace.openTextDocument').map(hostCall => String(hostCall.args[0]));
                expectEqual(openedPaths.length, 1, `Documents opened: ${JSON.stringify(openedPaths)}`);
                const openedRelativePath = path.relative(journey.workspaceRoot, openedPaths[0]).split(path.sep).join('/');
                expectEqual(openedRelativePath.startsWith(`${datasetFolder}/`) && fs.existsSync(openedPaths[0]), true, `The results file opened (${openedRelativePath}) is in ${datasetFolder}`);
            });

            const messagesBefore = journey.messages.length;
            await journey.openTab('Previously Used Data Sets');

            await journey.step('the new data set is the first row of Previously Used Data Sets, without a reload', () => {
                const screen = journey.screen();
                const datasetFolderName = datasetFolder.split('/').pop() as string;
                const rowHeadings = screen.lines(screen.get('tabpanel', 'Previously Used Data Sets')).filter(screenLine => /dataset-fakerjs-/.test(screenLine));
                expectEqual(rowHeadings.length > 0 && rowHeadings[0].includes(datasetFolderName), true, `The first data set row names ${datasetFolderName}: ${JSON.stringify(rowHeadings.slice(0, 3))}`);
                expectEqual(journey.messages.slice(messagesBefore).filter(message => message.command === 'ready').length, 0, 'Panel reloads while opening the tab');
            });

        }
    },

    {
        name: 'a production org: the button stays disabled with its reason, and a forged insertTree sends nothing',
        run: async journey => {

            journey.org.addAuthorization(PRODUCTION_ORG);
            fs.mkdirSync(path.join(journey.homePath, '.sf'));
            fs.writeFileSync(path.join(journey.homePath, '.sf', 'config.json'), JSON.stringify({ 'target-org': 'prod' }));
            await journey.click('button', 'Choose org…');

            await journey.step('prod is chosen, and the button says why it cannot insert', () => {
                const screen = journey.screen();
                expectEqual(screen.get('combobox', 'Salesforce org the generated data goes to').value, 'prod (default)', 'The org chosen');
                const treecipeTab = screen.get('tabpanel', 'Treecipe');
                expectEqual(screen.get('button', GENERATE_AND_INSERT_BUTTON_NAME, treecipeTab).states, ['disabled'], 'The Generate button');
                screen.get('text', 'Can\'t insert: prod answered that it is Production · Developer Edition, so the Treecipe tab asked it nothing more. It inserts records only into a sandbox or scratch org.', treecipeTab);
            });

            const orgCallCountBefore = journey.org.calls.length;
            await journey.forgePanelMessage({ command: 'insertTree', treeKey: TREE_NAME });

            await journey.step('the forged insertTree asks nothing and sends nothing', () => {
                expectEqual(journey.org.calls.slice(orgCallCountBefore).map(orgCall => orgCall.call), [], 'Calls on an org after the forged message');
                expectEqual(journey.prompts, [], 'Quick picks and input boxes');
                expectEqual(journey.notifications, [], 'Notifications');
                expectEqual(journey.fileChanges, [], 'Files written');
            });

        }
    },

    {
        name: 'no org chosen: the org is asked once, and dismissing it sends nothing and gives the button back',
        run: async journey => {

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);

            await journey.step('the org is asked once', () => {
                expectEqual(journey.prompts.map(prompt => ({ placeholder: prompt.placeholder, offeredLabels: prompt.offeredLabels, isWaiting: prompt.isWaiting })),
                    [{ placeholder: 'Select the sandbox or scratch org to generate this tree into', offeredLabels: ['qa', 'activeScratch'], isWaiting: true }], 'The prompts shown');
            });

            await journey.dismissQuickPick();

            await journey.step('nothing is written or sent, and the button is clickable again', () => {
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(journey.fileChanges, [], 'Files written');
                expectEqual(journey.screen().get('button', GENERATE_AND_INSERT_BUTTON_NAME).states, [], 'The Generate button');
                expectEqual(journey.prompts.length, 1, 'Prompts shown');
            });

        }
    },

    {
        name: 'Cancel in the confirmation: nothing is generated, written or sent',
        run: async journey => {

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.answerConfirmation('Cancel');

            await journey.step('nothing is generated, written or sent, and the button is clickable again', () => {
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'commands.executeCommand').map(hostCall => hostCall.args[0]), [], 'Commands run');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(journey.fileChanges, [], 'Files written');
                expectEqual(journey.prompts.filter(prompt => prompt.isWaiting), [], 'Prompts waiting');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
                expectEqual(journey.screen().get('button', GENERATE_AND_INSERT_BUTTON_NAME).states, [], 'The Generate button');
            });

        }
    },

    {
        name: 'a record Salesforce rejects without all-or-none: a warning with View errors and Open Troubleshooting, which opens the sub-tab the error points to',
        run: async journey => {

            journey.org.insertAnswer = (_username, objectApiName, records) => objectApiName === 'Contact'
                ? records.map(() => ({ success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'A contact needs a title.', fields: ['Title__c'] }] }))
                : undefined;

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.answerConfirmation('Generate and insert');
            await journey.answerQuickPick('AllOrNone: FALSE');

            await journey.step('the warning says what landed and what failed, with View errors and Open Troubleshooting', () => {
                expectEqual(journey.notifications.filter(notification => notification.buttons.length > 0).map(notification => ({ kind: notification.kind, text: notification.text, buttons: notification.buttons })), [{
                    kind: 'warning',
                    text: `2 records were inserted into qa (qa@example.com.qa) from ${TREE_NAME} and 1 failed. Nothing was rolled back. The first file that failed is collectionsApi-Contact.json; its Validation Rules in the Troubleshooting tab may fix it.`,
                    buttons: ['View failed file', 'View errors', 'Open Troubleshooting']
                }], 'The notification with buttons');
                // WHAT FOLLOWS A REJECTED PARENT IS NOT PINNED HERE: TODAY Visit__c IS SENT WITH Contact__c STILL ITS REFERENCE NAME
                expectEqual(insertsSent(journey).slice(0, 2).map(insert => insert.objectApiName), ['Account', 'Contact'], 'The first objects sent, in order');
            });

            await journey.clickNotificationButton('Open Troubleshooting');

            await journey.step('the Troubleshooting tab opens on Validation Rules', () => {
                const screen = journey.screen();
                expectEqual(screen.get('tab', RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL).states, ['selected'], 'The Troubleshooting tab');
                expectEqual(screen.get('tab', /^Validation Rules/).states, ['selected'], 'The Validation Rules sub-tab');
            });

        }
    }

];
