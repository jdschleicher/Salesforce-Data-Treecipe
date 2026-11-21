import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { RECIPE_COCKPIT_RUN_PICKER_LABEL } from '../../RecipeCockpitService';
import {
    INSERT_ORG_LABEL,
    INSERT_OUTCOME_NOTIFICATION,
    RECIPE_RELATIVE_PATH,
    RUN_FOLDER_RELATIVE_PATH,
    TREE_NAME,
    expectEqual,
    insertsSent,
    readFixtureFile,
    readWorkspaceFile
} from './TreecipeTabWorkspace';

/*
    "Customize and create new recipe" (#677), each journey on its own copy of treecipeTabWorkspace
    (Account → Contact → Visit__c, faker-js): what the modal shows as the reader removes things, what
    Save as new Treecipe writes, the custom tree it opens, and what that tree then generates and sends.
*/

const CUSTOM_FOLDER_NAME = `custom-${TREE_NAME}`;
const recipeObjectNames = (recipeText: string) => [...recipeText.matchAll(/^\s*- object: (\S+)$/gm)].map(objectLine => objectLine[1]);

function readCustomFolder(journey: RecipeCockpitJourney, folderName: string): { recipeText: string; definition: Record<string, unknown> } {
    const folderPath = path.join(journey.workspaceRoot, ...RUN_FOLDER_RELATIVE_PATH.split('/'), folderName);
    const fileNames = fs.readdirSync(folderPath).sort();
    const recipeFileName = fileNames.find(fileName => fileName.endsWith('.yml'));
    expectEqual(fileNames.length === 2 && !!recipeFileName && fileNames.includes('customTreecipe.json'), true, `${folderName} holds one recipe and customTreecipe.json (it holds ${fileNames.join(', ')})`);
    return {
        recipeText: fs.readFileSync(path.join(folderPath, recipeFileName as string), 'utf8'),
        definition: JSON.parse(fs.readFileSync(path.join(folderPath, 'customTreecipe.json'), 'utf8'))
    };
}

export const CUSTOM_TREECIPE_JOURNEYS: Array<{ name: string; run(journey: RecipeCockpitJourney): Promise<void> }> = [

    {
        name: 'remove a lookup and see what it takes, restore it, remove an object, save as a new Treecipe, then generate from it and customize it again',
        run: async journey => {

            await journey.click('button', 'Customize and create new recipe');

            await journey.step('the modal lists the tree with a red ✕ per object, and Save is off until something is removed', () => {
                const screen = journey.screen();
                screen.get('dialog', 'Customize and create new recipe');
                screen.get('button', 'Remove Account from the new recipe');
                screen.get('button', 'Remove Contact.AccountId from the new recipe');
                screen.get('text', 'Remove an object or a field with ✕ to make a new Treecipe.');
                expectEqual(screen.get('button', 'Save as new Treecipe').states.includes('disabled'), true, 'Save as new Treecipe is disabled');
            });

            await journey.click('button', 'Remove Contact.AccountId from the new recipe');

            await journey.step('removing Contact\'s only lookup into the tree takes Contact and Visit__c with it', () => {
                const screen = journey.screen();
                screen.get('text', 'Removed with Contact.AccountId');
                screen.get('text', 'Removed with Contact');
                screen.get('text', /^New recipe keeps 1 of 3 objects · /);
                screen.get('button', 'Restore Contact.AccountId');
            });

            await journey.click('button', 'Restore Contact.AccountId');

            await journey.step('↺ brings back exactly what it took', () => {
                const screen = journey.screen();
                expectEqual(screen.findAll('text', /^Removed with /).length, 0, 'Rows still removed');
                screen.get('text', /^New recipe keeps 3 of 3 objects · /);
            });

            await journey.click('button', 'Remove Visit__c from the new recipe');
            await journey.click('button', 'Save as new Treecipe');
            await journey.type('Name (optional)', 'Accounts and contacts');
            const notificationCountBefore = journey.notifications.length;
            await journey.click('button', 'Save');
            await journey.waitForNotification(new RegExp(`^Saved ${CUSTOM_FOLDER_NAME}, `), notificationCountBefore);

            await journey.step('custom-<tree> holds the recipe without Visit__c and its customTreecipe.json, and the source recipe is as it was', () => {
                const { recipeText, definition } = readCustomFolder(journey, CUSTOM_FOLDER_NAME);
                expectEqual(recipeObjectNames(recipeText), ['Account', 'Contact'], 'The objects of the custom recipe');
                expectEqual(definition.originalTreeFolderName, TREE_NAME, 'customTreecipe.json originalTreeFolderName');
                expectEqual(definition.removedObjectApiNames, ['Visit__c'], 'customTreecipe.json removedObjectApiNames');
                expectEqual(definition.name, 'Accounts and contacts', 'customTreecipe.json name');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The source recipe file');
            });

            await journey.step('the cockpit now shows the custom tree, chosen in the Recipe run list, named and marked as a copy', () => {
                const screen = journey.screen();
                expectEqual(/ · custom-Account-thru-Visit__c$/.test(screen.get('combobox', RECIPE_COCKPIT_RUN_PICKER_LABEL).value as string), true, 'The Recipe run list shows the custom tree');
                screen.get('text', 'Accounts and contacts');
                screen.get('text', `custom copy of ${TREE_NAME}`);
                expectEqual(screen.findAll('button', /^Visit__c: /).length, 0, 'Visit__c rows on the custom card');
            });

            const insertNotificationsBefore = journey.notifications.length;
            const generateButtonName = new RegExp(`^Generate fake data and insert (into \\S+ )?for Accounts and contacts \\(`);
            await journey.waitFor('button', generateButtonName, undefined, { isEnabled: true });
            await journey.click('button', generateButtonName);
            await journey.answerQuickPick(INSERT_ORG_LABEL);
            await journey.answerConfirmation('Generate and insert');
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(INSERT_OUTCOME_NOTIFICATION, insertNotificationsBefore);

            await journey.step('the custom tree generates and sends Account then Contact, nothing of Visit__c', () => {
                expectEqual(insertsSent(journey).map(insert => insert.objectApiName), ['Account', 'Contact'], 'The objects inserted, in order');
            });

            await journey.click('button', 'Customize and create new recipe');
            await journey.click('button', 'Remove Contact.Description from the new recipe');
            await journey.click('button', 'Save as new Treecipe');
            const secondNotificationsBefore = journey.notifications.length;
            await journey.click('button', 'Save');
            await journey.waitForNotification(new RegExp(`^Saved ${CUSTOM_FOLDER_NAME}-2, `), secondNotificationsBefore);

            await journey.step('customizing the custom tree saves custom-<original tree>-2, copied from the custom tree', () => {
                const { recipeText, definition } = readCustomFolder(journey, `${CUSTOM_FOLDER_NAME}-2`);
                expectEqual(recipeObjectNames(recipeText), ['Account', 'Contact'], 'The objects of the second custom recipe');
                // Account AND Contact BOTH WRITE A Description: ONLY Contact'S GOES
                expectEqual((recipeText.match(/^\s+Description: /gm) ?? []).length, 1, 'Description lines in the second custom recipe');
                expectEqual(definition.removedFields, [{ objectApiName: 'Contact', fieldApiNames: ['Description'] }], 'customTreecipe.json removedFields');
                expectEqual(definition.sourceTreeFolderName, CUSTOM_FOLDER_NAME, 'customTreecipe.json sourceTreeFolderName');
                expectEqual(definition.originalTreeFolderName, TREE_NAME, 'customTreecipe.json originalTreeFolderName');
            });

        }
    },

    {
        name: 'Cancel closes the modal and writes nothing; removing the root asks first',
        run: async journey => {

            await journey.click('button', 'Customize and create new recipe');
            await journey.click('button', 'Remove Account from the new recipe');

            await journey.step('removing Account, the root, asks before taking the whole tree', () => {
                const screen = journey.screen();
                screen.get('alert', /^Remove Account\? Account is the root of this tree\./);
                screen.get('button', 'Keep Account');
            });

            await journey.click('button', 'Remove Account');

            await journey.step('with the root gone, nothing is left and Save stays off', () => {
                const screen = journey.screen();
                screen.get('text', 'Nothing is left to save. Restore the root object to keep the tree.');
                expectEqual(screen.get('button', 'Save as new Treecipe').states.includes('disabled'), true, 'Save as new Treecipe is disabled');
            });

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', 'Cancel');

            await journey.step('Cancel closes the modal and nothing was written', () => {
                expectEqual(journey.screen().findAll('dialog', 'Customize and create new recipe').length, 0, 'Open modals');
                expectEqual(journey.fileChanges.slice(fileChangeCountBefore), [], 'Files written');
            });

        }
    }

];
