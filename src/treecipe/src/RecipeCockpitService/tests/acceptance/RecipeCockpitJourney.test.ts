import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as vscode from 'vscode';
import * as path from 'path';
import { RECIPE_COCKPIT_RUN_PICKER_LABEL } from '../../RecipeCockpitService';
import { JOURNEY_ORG_PICKER_NAME, RecipeCockpitJourney } from './RecipeCockpitJourney';

/*
    The harness itself (#577): every action a journey can take, on the real cockpit, and what each
    records. The first journey uses only some of them; a later journey must find the rest working.
*/
const TREECIPES_SEARCH_NAME = 'Search treecipes, objects, fields and record types';
const OLDER_RUN_LABEL = '2026-09-01 00:00:00 UTC · snowfakery';

describe('RecipeCockpitJourney (#577)', () => {

    let journey: RecipeCockpitJourney;

    beforeEach(async () => {
        journey = await new RecipeCockpitJourney().open('historyWorkspace');
    });

    afterEach(async () => {
        await journey.close();
    });

    test('records the message log in both directions, by step', () => {

        expect(journey.messages.slice(0, 3).map(entry => `${entry.direction} ${entry.command}`)).toEqual(['panel → host ready', 'host → panel recipeData', 'panel → host rendered']);
        expect(journey.messages.every(entry => entry.step === 'open the cockpit on historyWorkspace')).toBeTrue();
        expect(journey.steps).toEqual(['open the cockpit on historyWorkspace']);

    });

    test('click and type act on what is on screen, by role and name', async () => {

        await journey.click('button', 'About this cockpit');
        expect(journey.screen().get('button', 'About this cockpit').states).toContain('expanded');

        await journey.type(TREECIPES_SEARCH_NAME, 'Lead');
        const screen = journey.screen();
        expect(screen.get('searchbox', TREECIPES_SEARCH_NAME).value).toBe('Lead');
        expect(screen.findAll('button', undefined, screen.get('list', 'Search results')).map(result => result.name)).toEqual(['treecipe Lead-ONLY in Lead-ONLY', 'object Lead in Lead-ONLY']);

        await journey.click('button', 'object Lead in Lead-ONLY', { role: 'list', name: 'Search results' });
        expect(journey.shownTreeName()).toBe('Lead-ONLY');

    });

    test('a failed action says what is on screen instead, and in which step', async () => {

        await expect(journey.click('button', 'No such button')).rejects.toThrow(/^Step "click the button "No such button"" failed: No button named "No such button" is on screen\. The buttons on screen: "Open CHANGELOG on GitHub", /);
        await expect(journey.chooseTree('No such tree')).rejects.toThrow('Step "choose the treecipe "No such tree"" failed: the "Treecipe" dropdown offers no "No such tree". It offers: "Account-thru-OtherChildObject__c", "Lead-ONLY".');
        await expect(journey.type('No such box', 'x')).rejects.toThrow(/failed: no text boxes named "No such box" are on screen\./);
        await expect(journey.answerConfirmation('Cancel')).rejects.toThrow('failed: No confirmation is on screen.');
        await expect(journey.answerQuickPick('qa')).rejects.toThrow('failed: No quick pick is open.');
        await expect(journey.answerInputBox('x')).rejects.toThrow('failed: No input box is open.');
        await expect(journey.clickNotificationButton('Open file')).rejects.toThrow('failed: No notification on screen has a "Open file" button. Waiting: none.');

    });

    test('pickOrg selects an org in Target Org Manager, and the fake org records the calls on it', async () => {

        await journey.chooseTree('Lead-ONLY');
        expect(journey.optionLabelsOf(JOURNEY_ORG_PICKER_NAME)).toEqual(['Choose org…', 'qa', 'activeScratch']);

        await journey.pickOrg('qa');

        expect(journey.screen().get('combobox', JOURNEY_ORG_PICKER_NAME).value).toBe('qa');
        expect(journey.org.calls).toContainEqual({ username: 'qa@example.com.qa', call: 'connection.query', args: ['SELECT IsSandbox, OrganizationType FROM Organization'] });
        // A CONNECTION CALL THE FAKE HAS NO ANSWER FOR NAMES ITSELF, AND THE COCKPIT SAYS SO ON SCREEN
        expect(journey.screen().findAll('text', /The journey's fake org has no answer for connection\.describe on qa@example\.com\.qa/)).toHaveLength(1);

    });

    test('answerQuickPick answers the org picker; notifications, written files and a notification button are recorded', async () => {

        await journey.chooseTree('Lead-ONLY');
        await journey.openTab('Query');
        await journey.click('button', 'Run…', { role: 'group', name: 'Lead · Base Query' });

        expect(journey.prompts).toEqual([expect.objectContaining({ kind: 'quickPick', offeredLabels: ['qa', 'activeScratch'], isWaiting: true })]);

        await journey.answerQuickPick('qa');

        expect(journey.prompts[0].isWaiting).toBeFalse();
        expect(journey.org.calls).toContainEqual({ username: 'qa@example.com.qa', call: 'connection.query', args: ['SELECT Id,\n       Company,\n       Status\nFROM Lead'] });
        expect(journey.notifications).toEqual([expect.objectContaining({ kind: 'information', text: 'The Lead Base Query returned 0 records from qa · qa@example.com.qa.', buttons: [] })]);

        await journey.click('button', 'Export JSON');

        // THE FIRST FILE UNDER RunArtifacts BRINGS THE FOLDER'S .gitignore WITH IT (#470)
        expect(journey.fileChanges).toEqual([
            { change: 'written', relativePath: 'treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/RunArtifacts/.gitignore', step: 'click the button "Export JSON"' },
            {
                change: 'written',
                relativePath: expect.stringMatching(/^treecipe\/GeneratedRecipes\/recipe-2026-09-20T10-00-00\/Lead-ONLY\/RunArtifacts\/QueryResults\/.+-Lead-base\.json$/),
                step: 'click the button "Export JSON"'
            }
        ]);
        expect(journey.waitingNotificationTexts()).toEqual([expect.stringMatching(/^Exported 0 records from qa · qa@example\.com\.qa to treecipe\/GeneratedRecipes\//)]);

        await journey.clickNotificationButton('Open file');

        expect(journey.waitingNotificationTexts()).toEqual([]);
        expect(journey.hostCalls.filter(hostCall => hostCall.call === 'workspace.openTextDocument')).toEqual([{
            call: 'workspace.openTextDocument',
            args: [path.join(journey.workspaceRoot, journey.fileChanges[1].relativePath)],
            step: 'click "Open file" on the notification'
        }]);

    });

    test('answerConfirmation answers an in-panel confirmation by its button', async () => {

        await journey.click('button', 'Contact: Included — click to exclude');
        await journey.chooseOption(RECIPE_COCKPIT_RUN_PICKER_LABEL, OLDER_RUN_LABEL);

        const screen = journey.screen();
        const confirmation = screen.get('dialog', `Switch to ${OLDER_RUN_LABEL}?`);
        expect(screen.findAll('button', undefined, confirmation).map(button => button.name)).toEqual(expect.arrayContaining(['Reset selections', 'Cancel']));

        await journey.answerConfirmation('Reset selections');

        expect(journey.screen().findAll('dialog')).toEqual([]);
        expect(journey.screen().get('combobox', RECIPE_COCKPIT_RUN_PICKER_LABEL).value).toBe(OLDER_RUN_LABEL);
        expect(journey.shownTreeName()).toBe('Account-thru-Contact');

    });

    test('answerInputBox and answerQuickPick answer what the host asked, and record what it offered', async () => {

        const enteredAlias = vscode.window.showInputBox({ title: 'New scratch org', prompt: 'Alias', value: 'seven' });
        const chosenItem = vscode.window.showQuickPick([{ label: 'First' }, { label: 'Second' }], { placeHolder: 'Pick one' });
        // THE QUICK PICK WAITS FOR ITS ITEMS BEFORE IT SHOWS, AS VS CODE'S DOES
        await new Promise(resolveTick => setImmediate(resolveTick));

        await expect(journey.answerQuickPick('Third')).rejects.toThrow('failed: the quick pick offers no "Third". It offers: "First", "Second".');
        await journey.answerQuickPick('Second');
        await journey.answerInputBox('qa-scratch');

        await expect(enteredAlias).resolves.toBe('qa-scratch');
        await expect(chosenItem).resolves.toEqual({ label: 'Second' });
        expect(journey.prompts).toEqual([
            { kind: 'inputBox', title: 'New scratch org', prompt: 'Alias', placeholder: undefined, value: 'seven', offeredLabels: [], isWaiting: false },
            { kind: 'quickPick', title: undefined, placeholder: 'Pick one', offeredLabels: ['First', 'Second'], isWaiting: false }
        ]);

    });

});
