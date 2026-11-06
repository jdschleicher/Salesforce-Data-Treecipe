import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import {
    ACCOUNT_VALIDATION_RULES_FOLDER,
    DEPLOYED_FIELD_NAMES,
    DEPLOY_COMPONENT_FAILED_ANSWER,
    DEPLOY_SUCCEEDED_ANSWER,
    DEPLOY_SUCCEEDED_RESULT,
    ORG_OPERATIONS_FOLDER,
    ORG_PICKER_NAME,
    ORG_VALIDATION_RULES,
    SANDBOX_ORG_LABEL,
    SANDBOX_USERNAME,
    TROUBLESHOOTING_TREE_NAME,
    answerValidationRuleRetrieve,
    chooseOrg,
    confirmationLines,
    expectEqual,
    fileChangesSince,
    historyRows,
    openTroubleshootingJourney,
    openTroubleshootingSubTab,
    readWorkspaceFile,
    writtenFileMatching
} from './TroubleshootingWorkspace';

/*
    The Troubleshooting tab's journeys (#579), each on a cockpit of its own. A CLI call is checked as
    the argv the cockpit built, a jsforce call as the call on the fake connection, and a file by its
    content; never the cockpit's internal state. #566 moves this tab's host code and #574 the CLI gate,
    and these must pass unchanged across both.
*/

export interface ITroubleshootingJourney {
    name: string;
    open(): Promise<RecipeCockpitJourney>;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

const DEPLOY_CONFIRMATION_TITLE = `Deploy 7 components for ${TROUBLESHOOTING_TREE_NAME} to ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}?`;
const DEPLOYED_NOTIFICATION_TEXT = `Deployed 7 components for ${TROUBLESHOOTING_TREE_NAME} to ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}.`;
const FIELD_DEPLOY_PACKAGE_PATTERN = new RegExp(`^${ORG_OPERATIONS_FOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{8}-\\d{6}-field-deploy-package\\.xml$`);
const PRODUCTION_ORG = { username: 'admin@example.com.prod', aliases: ['prod'], orgId: '00D000000000PRDAAA', instanceUrl: 'https://example.my.salesforce.com', isSandbox: false };

const notificationsWithButtons = (journey: RecipeCockpitJourney) => journey.notifications
    .filter(notification => notification.buttons.length > 0)
    .map(notification => ({ kind: notification.kind, text: notification.text, buttons: notification.buttons }));

// OPENS THE FIELDS SUB-TAB WITH qa CHOSEN, CLICKS Deploy fields & dependencies… AND CHECKS WHAT THE CONFIRMATION LISTS
async function startFieldDeploy(journey: RecipeCockpitJourney): Promise<void> {

    await chooseOrg(journey, SANDBOX_ORG_LABEL);
    await openTroubleshootingSubTab(journey, 'Fields');

    // THE CARD'S COUNT LINE IS ITS BUTTON'S DESCRIPTION, AS A SCREEN READER READS IT AFTER THE NAME
    await journey.step('the Fields card counts what Deploy fields sends before anything is asked', () => {
        const deployCard = journey.screen().get('button', 'Deploy fields & dependencies…');
        expectEqual((deployCard.description ?? '').endsWith(' 6 CustomField and 1 CustomObject; 5 standard fields never deployed; 2 custom fields with no readable source file.'), true,
            `The Deploy fields card's count line, at the end of its description: ${JSON.stringify(deployCard.description)}`);
    });

    await journey.click('button', 'Deploy fields & dependencies…');
    await journey.click('button', /^Components 7/);

    await journey.step('the confirmation counts and lists the components it deploys', () => {
        const lines = confirmationLines(journey);
        expectEqual(lines[0], `alertdialog "${DEPLOY_CONFIRMATION_TITLE}"`, 'The confirmation');
        expectEqual(lines.filter(line => /listitem "\d+ Custom(Field|Object): /.test(line)).map(line => line.trim()), [
            `listitem "6 CustomField: ${DEPLOYED_FIELD_NAMES.join(', ')}"`,
            'listitem "1 CustomObject: OtherChildObject__c"'
        ], 'The components listed');
        expectEqual(lines.some(line => line.includes('button "Ticking the box below also deploys, in the same package.xml 5"')), true, 'The count of what the box would add');
        expectEqual(journey.cli.calls, [], 'CLI calls before the confirmation is answered');
    });

}

// THE ONE HISTORY ROW A FIELD DEPLOY ADDS: STEP, ORG, OUTCOME, AND THE package.xml AND OUTPUT IT WROTE
function expectOneDeployHistoryRow(journey: RecipeCockpitJourney, outcome: string) {
    const rows = historyRows(journey);
    expectEqual(rows.length, 1, `History rows: ${JSON.stringify(rows)}`);
    const [, stepCell, orgCell, outcomeCell, runCell, filesCell] = rows[0];
    expectEqual({ stepCell, orgCell, outcomeCell, runCell }, { stepCell: 'Deploy fields & dependencies', orgCell: SANDBOX_ORG_LABEL, outcomeCell: outcome, runCell: 'current version' }, 'The History row');
    expectEqual(/^\d{8}-\d{6}-field-deploy-package\.xml \d{8}-\d{6}-field-deploy\.json$/.test(filesCell), true, `The History row's files (${filesCell})`);
}

export const TROUBLESHOOTING_JOURNEYS: ITroubleshootingJourney[] = [

    {
        name: 'Deploy fields… through the CLI: the confirmation lists the components, the package.xml and argv, one notification with View output, and a History row',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            journey.cli.answer = argv => argv.slice(0, 3).join(' ') === 'project deploy start' ? DEPLOY_SUCCEEDED_ANSWER : undefined;
            await startFieldDeploy(journey);
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Deploy');

            const packagePath = writtenFileMatching(journey, fileChangeCountBefore, FIELD_DEPLOY_PACKAGE_PATTERN);

            await journey.step('the package.xml names every component, and the CLI is run once with --manifest on it', () => {
                const packageXml = readWorkspaceFile(journey, packagePath);
                expectEqual(DEPLOYED_FIELD_NAMES.every(fieldName => packageXml.includes(`<members>${fieldName}</members>`)), true, `The package.xml names every field: ${packageXml}`);
                expectEqual(packageXml.includes('<members>OtherChildObject__c</members>') && packageXml.includes('<name>CustomObject</name>'), true, 'The package.xml names OtherChildObject__c as a CustomObject');
                expectEqual(journey.cli.calls.map(cliCall => ({ argv: cliCall.argv, workingDirectoryPath: cliCall.workingDirectoryPath })),
                    [{ argv: ['project', 'deploy', 'start', '--json', '--target-org', SANDBOX_USERNAME, '--manifest', packagePath], workingDirectoryPath: journey.workspaceRoot }], 'The CLI calls');
                expectEqual(journey.org.calls.some(orgCall => orgCall.call.startsWith('connection.metadata.')), false, 'A Metadata API call on the connection');
            });

            await journey.step('one notification says what was deployed, with View output', () => {
                expectEqual(notificationsWithButtons(journey), [{ kind: 'information', text: DEPLOYED_NOTIFICATION_TEXT, buttons: ['View output'] }], 'The notifications with buttons');
            });

            await journey.clickNotificationButton('View output');

            await journey.step('View output opens the deploy\'s output file', () => {
                const openedPaths = journey.hostCalls.filter(hostCall => hostCall.call === 'workspace.openTextDocument').map(hostCall => path.relative(journey.workspaceRoot, String(hostCall.args[0])).split(path.sep).join('/'));
                expectEqual(openedPaths.length === 1 && /\/\d{8}-\d{6}-field-deploy\.json$/.test(openedPaths[0]) && openedPaths[0].startsWith(ORG_OPERATIONS_FOLDER), true, `Documents opened: ${JSON.stringify(openedPaths)}`);
            });

            await journey.click('tab', 'History');
            await journey.step('a History row records the deploy as Succeeded', () => expectOneDeployHistoryRow(journey, 'Succeeded 7 succeeded'));

        }
    },

    {
        name: 'Deploy fields… with metadataDeployMethod jsforce: the zip goes through metadata.deploy, with no CLI call, the same notification and a History row',
        open: () => openTroubleshootingJourney({ 'salesforce-data-treecipe.metadataDeployMethod': 'jsforce' }),
        run: async journey => {

            journey.org.callAnswer = (_username, call) => call === 'connection.metadata.deploy' ? { id: DEPLOY_SUCCEEDED_RESULT.id }
                : call === 'connection.metadata.checkDeployStatus' ? DEPLOY_SUCCEEDED_RESULT
                : undefined;
            await startFieldDeploy(journey);
            await journey.answerConfirmation('Deploy');

            await journey.step('one zip naming every component is sent through metadata.deploy, its status read once, and no CLI is run', () => {
                const metadataCalls = journey.org.calls.filter(orgCall => orgCall.call.startsWith('connection.metadata.'));
                expectEqual(metadataCalls.map(metadataCall => `${metadataCall.username} ${metadataCall.call}`),
                    [`${SANDBOX_USERNAME} connection.metadata.deploy`, `${SANDBOX_USERNAME} connection.metadata.checkDeployStatus`], 'The Metadata API calls, in order');
                const [zipInput] = metadataCalls[0].args;
                if ( !Buffer.isBuffer(zipInput) ) { throw new Error(`metadata.deploy was sent ${typeof zipInput}, not a zip.`); }
                // A ZIP ENTRY'S NAME IS STORED UNCOMPRESSED IN ITS HEADER, SO EACH FILE THE ZIP HOLDS CAN BE READ OFF IT
                const zipText = zipInput.toString('latin1');
                expectEqual({ isZip: zipText.startsWith('PK\u0003\u0004'), hasPackage: zipText.includes('package.xml'), hasAccount: zipText.includes('objects/Account.object'), hasOtherChild: zipText.includes('objects/OtherChildObject__c.object') },
                    { isZip: true, hasPackage: true, hasAccount: true, hasOtherChild: true }, 'What the zip holds');
                expectEqual(metadataCalls[1].args, [DEPLOY_SUCCEEDED_RESULT.id, true], 'The status check names the deploy Id');
                expectEqual(journey.cli.calls, [], 'CLI calls');
            });

            await journey.step('the same notification says what was deployed, with View output', () => {
                expectEqual(notificationsWithButtons(journey), [{ kind: 'information', text: DEPLOYED_NOTIFICATION_TEXT, buttons: ['View output'] }], 'The notifications with buttons');
            });

            await journey.click('tab', 'History');
            await journey.step('a History row records the deploy as Succeeded', () => expectOneDeployHistoryRow(journey, 'Succeeded 7 succeeded'));

        }
    },

    {
        name: 'Retrieve validation rules…: the org is listed through metadata.list, the confirmation counts the files it overwrites, the CLI\'s files are read, and the list is redrawn',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            journey.org.callAnswer = (_username, call) => call === 'connection.metadata.list' ? ORG_VALIDATION_RULES : undefined;
            journey.cli.answer = argv => argv.slice(0, 3).join(' ') === 'project retrieve start' ? answerValidationRuleRetrieve(journey) : undefined;
            await chooseOrg(journey, SANDBOX_ORG_LABEL);
            await openTroubleshootingSubTab(journey, 'Validation Rules');

            await journey.step('the list holds the project\'s two rules', () => {
                const screen = journey.screen();
                screen.get('text', '2 rules', screen.get('tabpanel', 'Validation Rules'));
            });

            await journey.click('button', 'Retrieve validation rules…');

            await journey.step('the org\'s rules are listed through metadata.list, and the confirmation names what the tree retrieves and how many local files it overwrites', () => {
                expectEqual(journey.org.calls.filter(orgCall => orgCall.call === 'connection.metadata.list').map(orgCall => orgCall.args), [[{ type: 'ValidationRule' }]], 'The metadata.list calls');
                const lines = confirmationLines(journey);
                expectEqual(lines[0], `alertdialog "Retrieve 2 validation rules of 3 objects of ${TROUBLESHOOTING_TREE_NAME} from ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}?"`, 'The confirmation');
                expectEqual(lines.some(line => line.includes('1 existing local validation rule file for these objects will be overwritten with the org\'s version wherever the org holds the same rule.')), true, `The overwrite count: ${lines.join(' | ')}`);
                expectEqual(journey.cli.calls, [], 'CLI calls before the confirmation is answered');
            });

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Retrieve');

            await journey.step('the CLI retrieves by --manifest, its two files are in the project, and the notification offers Generate Treecipe', () => {
                const packagePath = writtenFileMatching(journey, fileChangeCountBefore, /\/\d{8}-\d{6}-validation-rule-retrieve-package\.xml$/);
                expectEqual(journey.cli.calls.map(cliCall => cliCall.argv), [['project', 'retrieve', 'start', '--json', '--target-org', SANDBOX_USERNAME, '--manifest', packagePath]], 'The CLI calls');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore).filter(fileChange => fileChange.includes(ACCOUNT_VALIDATION_RULES_FOLDER)), [
                    `written ${ACCOUNT_VALIDATION_RULES_FOLDER}/Budget_Not_Negative.validationRule-meta.xml`,
                    `written ${ACCOUNT_VALIDATION_RULES_FOLDER}/Name_Required.validationRule-meta.xml`
                ], 'The rule files written');
                expectEqual(notificationsWithButtons(journey), [{
                    kind: 'information',
                    text: `Retrieved 2 validation rules for 1 of 3 objects of ${TROUBLESHOOTING_TREE_NAME} from ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}: Account. Generate Treecipe applies them to the recipe.`,
                    buttons: ['Generate Treecipe']
                }], 'The notifications with buttons');
            });

            await journey.step('the Validation Rules list is redrawn from the files: three rules, the new one included, with the org\'s message', () => {
                const screen = journey.screen();
                const validationRulesPanel = screen.get('tabpanel', 'Validation Rules');
                screen.get('text', '3 rules', validationRulesPanel);
                screen.get('button', 'Account 2 rules 2 not in this run', validationRulesPanel);
                screen.get('text', 'Name_Required', validationRulesPanel);
                screen.get('text', 'Error message: Budget_Not_Negative failed in the org.', validationRulesPanel);
            });

        }
    },

    {
        name: 'Assign permission sets to me…: the multi-select, one PermissionSetAssignment insert, and each set\'s outcome in the notification',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            journey.org.queryAnswer = (_username, soql) => {
                if ( /FROM PermissionSet WHERE/.test(soql) ) {
                    return { totalSize: 2, done: true, records: [{ Id: '0PS000000000001AAA', Name: 'Account_Tree_Access', NamespacePrefix: null }, { Id: '0PS000000000002AAA', Name: 'SDT_Account_thru_OtherChildObject_c', NamespacePrefix: null }] };
                }
                return /FROM User WHERE/.test(soql) ? { totalSize: 1, done: true, records: [{ Id: '005000000000001AAA' }] } : undefined;
            };
            // THE ORG TAKES THE TREE'S SDT_ SET AND REFUSES Account_Tree_Access, SO EACH SET'S OUTCOME IS ITS OWN
            journey.org.insertAnswer = (_username, objectApiName, records) => objectApiName === 'PermissionSetAssignment'
                ? records.map(record => record.PermissionSetId === '0PS000000000001AAA'
                    ? { success: false, errors: [{ statusCode: 'INSUFFICIENT_ACCESS_OR_READONLY', message: 'You do not have access to assign this permission set.', fields: [] }] }
                    : { success: true, id: '0Pa000000000001AAA', errors: [] })
                : undefined;
            await chooseOrg(journey, SANDBOX_ORG_LABEL);
            await openTroubleshootingSubTab(journey, 'Permissions');
            await journey.click('button', 'Assign permission sets to me…');

            await journey.step('a multi-select offers the project\'s permission sets for the tree, none ticked', () => {
                expectEqual(journey.prompts.map(prompt => ({ placeholder: prompt.placeholder, offeredLabels: prompt.offeredLabels, canPickMany: prompt.canPickMany, pickedLabels: prompt.pickedLabels })),
                    [{ placeholder: 'Choose the permission sets to assign to you for this tree', offeredLabels: ['Account_Tree_Access', 'SDT_Account_thru_OtherChildObject_c'], canPickMany: true, pickedLabels: [] }], 'The prompts');
            });

            await journey.answerQuickPickMany(['Account_Tree_Access', 'SDT_Account_thru_OtherChildObject_c']);
            await journey.step('the confirmation names the two sets and the user they go to', () => {
                expectEqual(confirmationLines(journey)[0], `alertdialog "Assign 2 permission sets for ${TROUBLESHOOTING_TREE_NAME} to ${SANDBOX_USERNAME} in ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}?"`, 'The confirmation');
            });
            await journey.answerConfirmation('Assign');

            await journey.step('one PermissionSetAssignment request carries both rows for the authorized user', () => {
                const assignmentCalls = journey.org.calls.filter(orgCall => /^connection\.sobject\(PermissionSetAssignment\)\.(create|insert)$/.test(orgCall.call));
                expectEqual(assignmentCalls.map(assignmentCall => ({ call: assignmentCall.call, records: assignmentCall.args[0], options: assignmentCall.args[1] })), [{
                    call: 'connection.sobject(PermissionSetAssignment).create',
                    records: [{ AssigneeId: '005000000000001AAA', PermissionSetId: '0PS000000000001AAA' }, { AssigneeId: '005000000000001AAA', PermissionSetId: '0PS000000000002AAA' }],
                    options: { allowRecursive: false, allOrNone: false }
                }], 'The assignment requests');
            });

            await journey.step('one notification gives each set its own outcome: the refused one with its reason, then the one assigned', () => {
                expectEqual(journey.notifications.map(notification => notification.text), [
                    `Account_Tree_Access could not be assigned to ${SANDBOX_USERNAME} in ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}: You do not have access to assign this permission set. Assigned: SDT_Account_thru_OtherChildObject_c.`
                ], 'The notifications');
            });

        }
    },

    {
        name: 'Generate permission set…: the tree\'s SDT_ file is written under SDT_Treecipe/, and Copy deploy command puts the deploy command on the clipboard',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            const permissionSetPath = 'force-app/main/default/permissionsets/SDT_Treecipe/SDT_Account_thru_OtherChildObject_c.permissionset-meta.xml';
            const permissionSetBefore = readWorkspaceFile(journey, permissionSetPath);
            await openTroubleshootingSubTab(journey, 'Permissions');
            await journey.click('button', 'Generate permission set…');

            await journey.step('the confirmation names the file it overwrites and what it grants', () => {
                const lines = confirmationLines(journey);
                expectEqual(lines[0], `alertdialog "Overwrite the permission set SDT_Account_thru_OtherChildObject_c for ${TROUBLESHOOTING_TREE_NAME}?"`, 'The confirmation');
                expectEqual(lines.some(line => line.includes(`listitem "File: ${permissionSetPath}"`)), true, 'The file it names');
                expectEqual(lines.some(line => line.includes('listitem "Grants Create and Read on 3 objects and access to 6 fields, read-only where the org computes the value."')), true, 'What it grants');
            });

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Write permission set');

            await journey.step('the SDT_ file is rewritten with create and read on the tree\'s objects, and the run\'s PermissionSets record is written', () => {
                expectEqual(fileChangesSince(journey, fileChangeCountBefore).includes(`written ${permissionSetPath}`), true, `Files written: ${JSON.stringify(fileChangesSince(journey, fileChangeCountBefore))}`);
                writtenFileMatching(journey, fileChangeCountBefore, /\/RunArtifacts\/PermissionSets\/\d{8}-\d{6}-permission-set-generate\.json$/);
                const permissionSetXml = readWorkspaceFile(journey, permissionSetPath);
                expectEqual(permissionSetXml === permissionSetBefore, false, 'The file changed');
                expectEqual(['Account', 'Contact', 'OtherChildObject__c'].every(objectApiName => permissionSetXml.includes(`<object>${objectApiName}</object>`)), true, 'The object permissions it holds');
                expectEqual(['<allowCreate>true</allowCreate>', '<allowRead>true</allowRead>'].every(permission => permissionSetXml.includes(permission)), true, 'Create and Read are granted');
            });

            await journey.clickNotificationButton('Copy deploy command');

            await journey.step('Copy deploy command puts an sf deploy of that file on the clipboard, and runs nothing', () => {
                const copied = journey.hostCalls.filter(hostCall => hostCall.call === 'env.clipboard.writeText').map(hostCall => String(hostCall.args[0]));
                expectEqual(copied, ['sf project deploy start --metadata PermissionSet:SDT_Account_thru_OtherChildObject_c'], 'The clipboard');
                expectEqual(journey.cli.calls, [], 'CLI calls');
            });

        }
    },

    {
        name: 'the TODO\'s sub-tab: Remove a TODO, then Restore it, and the recipe line goes, then comes back byte for byte',
        open: () => new RecipeCockpitJourney().open('validationRuleWorkspace'),
        run: async journey => {

            const recipePath = 'treecipe/GeneratedRecipes/recipe-fakerjs-2026-10-01T09-00-00/Gadget__c-thru-Widget__c/recipe-fakerjs--Gadget__c-thru-Widget__c-2026-10-01T09-00-00.yml';
            const removedTodosPath = recipePath.replace(/\.yml$/, '.removedTodos.json');
            const todoLine = '    ### TODO -- VALIDATION RULE NOT APPLIED -- "Complex_Formula" -- its formula is not one of the single-field shapes Treecipe applies';
            const recipeBefore = readWorkspaceFile(journey, recipePath);
            expectEqual(recipeBefore.split('\n')[41], todoLine, 'Line 42 of the recipe before');

            await journey.openTab('Troubleshooting');
            await journey.click('button', 'Remove TODO: on the object, line 42');

            await journey.step('the confirmation shows the TODO and the line it deletes', () => {
                const lines = confirmationLines(journey);
                expectEqual(lines[0], 'dialog "Remove this TODO from the recipe?"', 'The confirmation');
                expectEqual(lines.some(line => line.includes(`"${path.basename(recipePath)}": line 42 is deleted. Every other line of the file is left as it is.`)), true, `What it writes: ${lines.join(' | ')}`);
            });

            let fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Remove TODO');

            await journey.step('line 42 is gone, every other line is as it was, and the TODO is listed under Removed', () => {
                expectEqual(fileChangesSince(journey, fileChangeCountBefore).sort(), [`written ${recipePath}`, `written ${removedTodosPath}`].sort(), 'Files written');
                const recipeLinesBefore = recipeBefore.split('\n');
                expectEqual(readWorkspaceFile(journey, recipePath), [...recipeLinesBefore.slice(0, 41), ...recipeLinesBefore.slice(42)].join('\n'), 'The recipe without line 42');
                const screen = journey.screen();
                screen.get('tab', 'Removed (1)');
                screen.get('tab', 'Open (3)');
            });

            await journey.click('tab', 'Removed (1)');
            fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', /^Restore: on the object, ### TODO -- VALIDATION RULE NOT APPLIED -- "Complex_Formula"/);

            await journey.step('the Restore confirmation says the line goes back as line 42 and the removed-TODOs file no longer lists it', () => {
                const lines = confirmationLines(journey);
                expectEqual(lines[0], 'dialog "Put this TODO back in the recipe?"', 'The confirmation');
                expectEqual(lines.some(line => line.includes(`"${path.basename(recipePath)}": the line goes back as line 42, and "${path.basename(removedTodosPath)}" no longer lists it.`)), true, `What it writes: ${lines.join(' | ')}`);
            });

            await journey.answerConfirmation('Restore TODO');

            await journey.step('the recipe is byte for byte what it was, and nothing is listed under Removed', () => {
                expectEqual(readWorkspaceFile(journey, recipePath), recipeBefore, 'The recipe after Restore');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore).includes(`written ${recipePath}`), true, `Files written: ${JSON.stringify(fileChangesSince(journey, fileChangeCountBefore))}`);
                journey.screen().get('tab', 'Removed (0)');
                journey.screen().get('tab', 'Open (4)');
            });

        }
    },

    {
        name: 'a deploy to a non-sandbox is refused before any process, with the reason in a warning',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            journey.org.addAuthorization(PRODUCTION_ORG);
            fs.mkdirSync(path.join(journey.homePath, '.sf'));
            fs.writeFileSync(path.join(journey.homePath, '.sf', 'config.json'), JSON.stringify({ 'target-org': 'prod' }));
            await journey.click('button', 'Choose org…');
            await journey.step('prod, the CLI\'s default, is chosen', () => {
                expectEqual(journey.screen().get('combobox', ORG_PICKER_NAME).value, 'prod (default)', 'The org chosen');
            });
            await openTroubleshootingSubTab(journey, 'Fields');
            await journey.click('button', 'Deploy fields & dependencies…');

            await journey.step('a warning says why, and no CLI process, deploy or file is started', () => {
                expectEqual(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text })),
                    [{ kind: 'warning', text: 'Nothing was deployed: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.' }], 'The notifications');
                expectEqual(journey.cli.calls, [], 'CLI calls');
                expectEqual(journey.org.calls.filter(orgCall => orgCall.call.startsWith('connection.metadata.')), [], 'Metadata API calls');
                expectEqual(journey.fileChanges, [], 'Files written');
                expectEqual(journey.screen().findAll('alertdialog').length, 0, 'Confirmations on screen');
            });

        }
    },

    {
        name: 'a retrieve with no org chosen asks for one once, and a dismissed prompt runs nothing',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            await openTroubleshootingSubTab(journey, 'Validation Rules');
            await journey.click('button', 'Retrieve validation rules…');

            await journey.step('the org is asked once, offering the sandbox and scratch orgs that answer', () => {
                expectEqual(journey.prompts.map(prompt => ({ placeholder: prompt.placeholder, offeredLabels: prompt.offeredLabels, isWaiting: prompt.isWaiting })),
                    [{ placeholder: 'Choose the org to retrieve this tree\'s validation rules from', offeredLabels: ['qa', 'activeScratch'], isWaiting: true }], 'The prompts');
            });

            await journey.dismissQuickPick();

            await journey.step('nothing is listed, retrieved or written, and the button is clickable again', () => {
                expectEqual(journey.cli.calls, [], 'CLI calls');
                expectEqual(journey.org.calls.filter(orgCall => !/^(Org\.create|org\.refreshAuth)$/.test(orgCall.call)), [], 'Calls on an org beyond the connection check');
                expectEqual(journey.fileChanges, [], 'Files written');
                expectEqual(journey.notifications, [], 'Notifications');
                expectEqual(journey.prompts.length, 1, 'Prompts shown');
                expectEqual(journey.screen().get('button', 'Retrieve validation rules…').states, [], 'The Retrieve button');
            });

        }
    },

    {
        name: 'a deploy whose CLI answer reports a failed component: a warning naming the component, and a History row marked failed',
        open: () => openTroubleshootingJourney(),
        run: async journey => {

            journey.cli.answer = argv => argv.slice(0, 3).join(' ') === 'project deploy start' ? DEPLOY_COMPONENT_FAILED_ANSWER : undefined;
            await startFieldDeploy(journey);
            await journey.answerConfirmation('Deploy');

            await journey.step('a warning names the failed component and its problem, with View output', () => {
                expectEqual(notificationsWithButtons(journey), [{
                    kind: 'warning',
                    text: `Nothing was deployed to ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME}: Account.Rating__c: Value set Account_Ratings not found`,
                    buttons: ['View output']
                }], 'The notifications with buttons');
            });

            await journey.click('tab', 'History');
            await journey.step('the History row is marked Failed, naming the component', () => expectOneDeployHistoryRow(journey, 'Failed 1 failed · Account.Rating__c: Value set Account_Ratings not found'));

        }
    }

];
