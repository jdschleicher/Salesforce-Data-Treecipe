import * as fs from 'fs';
import * as path from 'path';
import { RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL } from '../../RecipeCockpitService';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { RECORD_TYPE_SET_MODE_LABELS } from '../../RecipeCockpitRecordTypeRecipe';
import { GENERATE_AND_INSERT_BUTTON_NAME, INSERT_ORG_LABEL, RECIPE_FILE_NAME, RECIPE_RELATIVE_PATH, TREE_NAME, expectEqual, fileChangesSince, generateAndInsert, insertsSent, readFixtureFile, readWorkspaceFile, writtenDatasetFolder } from './TreecipeTabWorkspace';

/*
    Generate fake data and insert (#578): the happy path into a sandbox, and the four ways it must stop
    short -- a production org, no org chosen, Cancel in the confirmation, and a record Salesforce rejects
    when all-or-none is off. Since #623 the record types ticked under Manage record types are what the
    generate uses, in one folded data set. Each on its own copy of treecipeTabWorkspace. The forged insertTree into
    production has two controls (#599): the same message into qa does open the confirmation, and one
    naming a tree no card shows is refused into qa too, so the sandbox-only rule is what stops it.
*/

const CONFIRMATION_TITLE = `Generate ${TREE_NAME} and insert it into qa (qa@example.com.qa)?`;
const CONFIGURATION_RELATIVE_PATH = 'treecipe/treecipe.config.json';
// A CHILD OF Account THE RUN WAS NOT GENERATED WITH: IT JOINS THE TREE WITHOUT CHANGING ITS FOLDER NAME
const NOTE_ACCOUNT_LOOKUP_FIELD = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Account__c</fullName>
    <deleteConstraint>SetNull</deleteConstraint>
    <externalId>false</externalId>
    <label>Account</label>
    <referenceTo>Account</referenceTo>
    <relationshipLabel>Notes</relationshipLabel>
    <relationshipName>Notes</relationshipName>
    <required>false</required>
    <type>Lookup</type>
</CustomField>
`;
const FOLDED_MODE_LABEL = RECORD_TYPE_SET_MODE_LABELS.folded;
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

            await journey.waitForConfirmation();
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
    },

    {
        name: 'a forged insertTree into qa, the production journey\'s positive control: it opens the confirmation, and Cancel generates, writes and sends nothing',
        run: async journey => {

            await journey.click('button', 'Choose org…');
            await journey.pickOrg(INSERT_ORG_LABEL);
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.forgePanelMessage({ command: 'insertTree', treeKey: TREE_NAME });

            await journey.waitForConfirmation();
            await journey.step('the forged insertTree opens the insert confirmation, and nothing is sent yet', () => {
                journey.screen().get('alertdialog', CONFIRMATION_TITLE);
                expectEqual(insertCallCount(journey), 0, 'Inserts sent before the confirmation is answered');
            });

            await journey.answerConfirmation('Cancel');

            await journey.step('nothing is generated, written or sent after Cancel', () => {
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'commands.executeCommand').map(hostCall => hostCall.args[0]), [], 'Commands run');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(journey.fileChanges.slice(fileChangeCountBefore), [], 'Files written');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
            });

        }
    },

    {
        name: 'record types: ticking Partner and generating asks the folded question, and writes one data set with an Account block and its own children per record type (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');

            await journey.step('the section no longer offers to regenerate the run', () => {
                expectEqual(journey.screen().findAll('button', /Regenerate with these record types|Use defaults/).length, 0, 'Regenerate buttons on screen');
            });

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.waitForConfirmation();
            await journey.click('button', /^Records, inserted parents first/);

            await journey.step('the confirmation offers the folded data set, with the totals of a recipe that has both record types', () => {
                const screen = journey.screen();
                const confirmation = screen.get('alertdialog', CONFIRMATION_TITLE);
                expectEqual(screen.findAll('radio', undefined, confirmation).map(radio => ({ name: radio.name, states: radio.states })),
                    [{ name: FOLDED_MODE_LABEL, states: ['checked'] }], 'The record type set modes offered');
                screen.get('text', 'Generate 6 records and insert them into qa (qa@example.com.qa).', confirmation);
                expectEqual(screen.findAll('listitem', /^(Account|Contact|Visit__c): /, confirmation).map(listItem => listItem.name),
                    ['Account: 2', 'Contact: 2 (1 per Account)', 'Visit__c: 2 (1 per Contact)'], 'The record totals the confirmation lists');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [], 'Files written before the confirmation is answered');
            });

            await journey.answerConfirmation('Generate and insert');
            await journey.answerQuickPick('AllOrNone: TRUE');
            const datasetFolder = writtenDatasetFolder(journey, fileChangeCountBefore);

            await journey.step('each record type\'s Account is inserted, each with a Contact of its own', () => {
                const inserts = insertsSent(journey);
                expectEqual(inserts.map(insert => `${insert.objectApiName}: ${insert.records.length}`), ['Account: 2', 'Contact: 2', 'Visit__c: 2'], 'The records inserted, parents first');
                expectEqual(inserts[0].records.map(account => account.RecordTypeId), ['012000000000001AAA', '012000000000002AAA'], 'The RecordTypeId of each Account: Business, then Partner');
                const contactAccountIds = inserts[1].records.map(contact => contact.AccountId);
                expectEqual(new Set(contactAccountIds).size === 2 && contactAccountIds.every(accountId => typeof accountId === 'string' && /^Accoun\d{12}$/.test(accountId)), true,
                    `Each Contact points at a different inserted Account: ${JSON.stringify(contactAccountIds)}`);
            });

            await journey.step('no Generate Treecipe run is written; the data set keeps the recipe it was generated from, and names its record types', () => {
                const writtenPaths = journey.fileChanges.slice(fileChangeCountBefore).map(fileChange => fileChange.relativePath);
                expectEqual(writtenPaths.filter(relativePath => relativePath.startsWith('treecipe/GeneratedRecipes/')), [], 'Files written under GeneratedRecipes');
                const derivedRecipe = readWorkspaceFile(journey, `${datasetFolder}/BaseArtifactFiles/filteredRecipe-${RECIPE_FILE_NAME}`);
                expectEqual(derivedRecipe.split('\n').filter(recipeLine => /^\s*(- object|RecordTypeId): /.test(recipeLine)).map(recipeLine => recipeLine.trim()), [
                    '- object: Account', 'RecordTypeId: Account.Business', '- object: Contact', '- object: Visit__c',
                    '- object: Account', 'RecordTypeId: Account.Partner', '- object: Contact', '- object: Visit__c'
                ], 'The blocks of the recipe saved in the data set');
                expectEqual(JSON.parse(readWorkspaceFile(journey, `${datasetFolder}/BaseArtifactFiles/datasetSource.json`)).recordTypesByObject, { Account: ['Business', 'Partner'] }, 'The record types datasetSource.json names');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The run\'s recipe file');
            });

            await journey.openTab('Previously Used Data Sets');

            await journey.step('the new data set row names its record types', () => {
                const screen = journey.screen();
                const rowLines = screen.lines(screen.get('tabpanel', 'Previously Used Data Sets'));
                expectEqual(rowLines.some(rowLine => rowLine.includes('Record types: Account · Business, Partner')), true, `A row tagged with Business and Partner: ${JSON.stringify(rowLines.slice(0, 6))}`);
            });

        }
    },

    {
        name: 'record types with the card\'s settings: a count and an unticked field reach every record type block, each with its own picklist values (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            await journey.click('button', 'Create 1 Account record(s), edit count');
            await journey.type('Account record(s)', '2');
            await journey.press('Account record(s)', 'Enter');
            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('checkbox', 'Region__c: Ticked — click to leave this field out');

            await generateAndInsert(journey);

            await journey.step('two Accounts of each record type are sent, none with Region__c, each with a Rating__c its record type allows', () => {
                const [accountInsert, contactInsert, visitInsert] = insertsSent(journey);
                expectEqual([accountInsert, contactInsert, visitInsert].map(insert => `${insert.objectApiName} × ${insert.records.length}`), ['Account × 4', 'Contact × 4', 'Visit__c × 4'], 'The records sent, in order');
                expectEqual(accountInsert.records.map(account => account.RecordTypeId), ['012000000000001AAA', '012000000000001AAA', '012000000000002AAA', '012000000000002AAA'], 'The RecordTypeId of each Account');
                expectEqual(accountInsert.records.some(account => 'Region__c' in account), false, 'An Account sent with Region__c');
                expectEqual(accountInsert.records.map(account => ['Hot', 'Warm'].includes(String(account.Rating__c)) ? 'Business value' : account.Rating__c === 'Cold' ? 'Partner value' : `unexpected ${account.Rating__c}`),
                    ['Business value', 'Business value', 'Partner value', 'Partner value'], 'The Rating__c of each Account');
                expectEqual(new Set(contactInsert.records.map(contact => contact.AccountId)).size, 4, 'Accounts the four Contacts point at');
            });

        }
    },

    {
        name: 'Remember this selection: Cancel saves nothing, and the ticks are saved in treecipe.config.json when the generate runs (#623)',
        run: async journey => {

            const configurationBefore = readWorkspaceFile(journey, CONFIGURATION_RELATIVE_PATH);
            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            await journey.click('checkbox', 'Remember this selection');

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.waitForConfirmation();

            await journey.step('the confirmation says what treecipe.config.json will hold', () => {
                const screen = journey.screen();
                screen.get('listitem', 'Remember this selection: treecipe.config.json will hold these record types for Generate Treecipe: Account: Business, Partner.', screen.get('alertdialog', CONFIRMATION_TITLE));
            });

            await journey.answerConfirmation('Cancel');

            await journey.step('Cancel leaves treecipe.config.json as it was', () => {
                expectEqual(readWorkspaceFile(journey, CONFIGURATION_RELATIVE_PATH), configurationBefore, 'treecipe.config.json after Cancel');
            });

            await generateAndInsert(journey);

            await journey.step('the generate saved the ticks, with every record type Account had', () => {
                const configuration = JSON.parse(readWorkspaceFile(journey, CONFIGURATION_RELATIVE_PATH));
                expectEqual(configuration.recordTypeSelections, { Account: ['Business', 'Partner'] }, 'recordTypeSelections');
                expectEqual(configuration.recordTypesWhenSelectionSaved, { Account: ['Business', 'Partner'] }, 'recordTypesWhenSelectionSaved');
                expectEqual(configuration.salesforceObjectsPath, JSON.parse(configurationBefore).salesforceObjectsPath, 'salesforceObjectsPath');
            });

        }
    },

    {
        name: 'Remember this selection with every object at its default: the confirmation says the saved record types will be removed, and the generate removes them (#623)',
        run: async journey => {

            const configurationPath = path.join(journey.workspaceRoot, ...CONFIGURATION_RELATIVE_PATH.split('/'));
            const configurationBefore = JSON.parse(readWorkspaceFile(journey, CONFIGURATION_RELATIVE_PATH));
            fs.writeFileSync(configurationPath, JSON.stringify({ ...configurationBefore, recordTypeSelections: { Account: ['Partner'] }, recordTypesWhenSelectionSaved: { Account: ['Business', 'Partner'] } }, null, 4));

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Remember this selection');
            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.waitForConfirmation();

            await journey.step('the confirmation offers no mode, and says the saved record types will be removed', () => {
                const screen = journey.screen();
                const confirmation = screen.get('alertdialog', CONFIRMATION_TITLE);
                expectEqual(screen.findAll('radio', undefined, confirmation).length, 0, 'Radios in the confirmation');
                screen.get('listitem', 'Remember this selection: every object is ticked at its default record type, so any record types saved in treecipe.config.json will be removed.', confirmation);
            });

            await journey.answerConfirmation('Generate and insert');
            await journey.answerQuickPick('AllOrNone: TRUE');

            await journey.step('treecipe.config.json no longer holds a saved selection, and one default Account was sent', () => {
                expectEqual(JSON.parse(readWorkspaceFile(journey, CONFIGURATION_RELATIVE_PATH)), configurationBefore, 'treecipe.config.json');
                expectEqual(insertsSent(journey)[0].records.map(account => account.RecordTypeId), ['012000000000001AAA'], 'The RecordTypeId of each Account');
            });

        }
    },

    {
        name: 'an object added to the tree\'s metadata since the run: nothing is asked, generated or sent, and the warning names it (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            const noteFieldsPath = path.join(journey.workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Note__c', 'fields');
            fs.mkdirSync(noteFieldsPath, { recursive: true });
            fs.writeFileSync(path.join(noteFieldsPath, 'Account__c.field-meta.xml'), NOTE_ACCOUNT_LOOKUP_FIELD);
            const fileChangeCountBefore = journey.fileChanges.length;

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);

            await journey.step('one warning names the new object and what to do, and nothing else happened', () => {
                expectEqual(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text })), [{
                    kind: 'warning',
                    text: `Nothing was generated or inserted for ${TREE_NAME}: the object metadata now puts Note__c in this tree, which this run does not have. Run "Generate Treecipe" again, then tick the record types.`
                }], 'The notifications');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [], 'Files written');
            });

        }
    },

    {
        name: 'a ticked record type gone from the object metadata: the confirmation names it, and the object is generated with its default (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            fs.rmSync(path.join(journey.workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'recordTypes', 'Partner.recordType-meta.xml'));

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.waitForConfirmation();

            await journey.step('the confirmation says Partner was dropped, and totals one Account', () => {
                const screen = journey.screen();
                const confirmation = screen.get('alertdialog', CONFIRMATION_TITLE);
                screen.get('listitem', 'Account no longer has the record type Partner in the object metadata, so its ticks were dropped and it is generated with its default record type.', confirmation);
                screen.get('text', 'Generate 3 records and insert them into qa (qa@example.com.qa).', confirmation);
            });

            await journey.answerConfirmation('Generate and insert');
            await journey.answerQuickPick('AllOrNone: TRUE');

            await journey.step('one Account is sent, with Business\'s RecordTypeId', () => {
                const [accountInsert] = insertsSent(journey);
                expectEqual(accountInsert.records.map(account => account.RecordTypeId), ['012000000000001AAA'], 'The RecordTypeId of each Account');
            });

        }
    },

    {
        name: 'the object metadata no longer builds the card\'s tree: nothing is asked, generated or sent, and the warning says to run Generate Treecipe (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            fs.rmSync(path.join(journey.workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Visit__c'), { recursive: true });
            const fileChangeCountBefore = journey.fileChanges.length;

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);

            await journey.step('one warning names the tree and what to do, and nothing else happened', () => {
                expectEqual(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text })), [{
                    kind: 'warning',
                    text: `Nothing was generated or inserted for ${TREE_NAME}: the object metadata no longer builds this tree, so its recipe could not be built for the ticked record types. Run "Generate Treecipe" again, then tick the record types.`
                }], 'The notifications');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [], 'Files written');
                expectEqual(journey.screen().get('button', GENERATE_AND_INSERT_BUTTON_NAME).states, [], 'The Generate button');
            });

        }
    },

    {
        name: 'a forged answer naming a mode the confirmation did not offer: nothing is generated, written or sent (#623)',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.waitForConfirmation();

            const confirmRequest = journey.messages.filter(message => message.direction === 'host → panel' && message.command === 'confirmRequest').pop();
            await journey.forgePanelMessage({ command: 'confirmResponse', confirmationId: ( confirmRequest?.message as { confirmationId: string } ).confirmationId, choice: 0, recordTypeSetMode: 'separate' });

            await journey.step('the forged answer is read as Cancel', () => {
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'commands.executeCommand').map(hostCall => hostCall.args[0]), [], 'Commands run');
                expectEqual(journey.prompts.filter(prompt => prompt.isWaiting), [], 'Prompts waiting');
                expectEqual(insertCallCount(journey), 0, 'Inserts sent');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [], 'Files written');
            });

        }
    },

    {
        name: 'record types left as generated: the confirmation offers no mode, and a posted regenerateWithRecordTypes does nothing (#623)',
        run: async journey => {

            await journey.click('button', 'Choose org…');
            await journey.pickOrg(INSERT_ORG_LABEL);
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.forgePanelMessage({ command: 'regenerateWithRecordTypes', treeKey: TREE_NAME, recordTypeSelection: { Account: ['Partner'] } });

            await journey.step('the removed regenerate message runs no command and writes nothing', () => {
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'commands.executeCommand').map(hostCall => hostCall.args[0]), [], 'Commands run');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [], 'Files written');
            });

            await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
            await journey.waitForConfirmation();

            await journey.step('the confirmation offers no record type set mode', () => {
                const screen = journey.screen();
                expectEqual(screen.findAll('radio', undefined, screen.get('alertdialog', CONFIRMATION_TITLE)).length, 0, 'Radios in the confirmation');
            });

            await journey.answerConfirmation('Cancel');

        }
    },

    {
        name: 'a forged insertTree naming a tree no card shows, into qa: it asks nothing and sends nothing',
        run: async journey => {

            await journey.click('button', 'Choose org…');
            await journey.pickOrg(INSERT_ORG_LABEL);
            const orgCallCountBefore = journey.org.calls.length;
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.forgePanelMessage({ command: 'insertTree', treeKey: 'No-Such-Tree' });

            await journey.step('the forged insertTree for an unknown tree asks nothing and sends nothing', () => {
                expectEqual(journey.org.calls.slice(orgCallCountBefore).map(orgCall => orgCall.call), [], 'Calls on an org after the forged message');
                expectEqual(journey.hostCalls.filter(hostCall => hostCall.call === 'commands.executeCommand').map(hostCall => hostCall.args[0]), [], 'Commands run');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
                expectEqual(journey.prompts, [], 'Quick picks and input boxes');
                expectEqual(journey.notifications, [], 'Notifications');
                expectEqual(journey.fileChanges.slice(fileChangeCountBefore), [], 'Files written');
            });

        }
    }

];
