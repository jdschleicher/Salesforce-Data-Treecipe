import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitService, RECIPE_COCKPIT_RUN_PICKER_LABEL } from '../../RecipeCockpitService';
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

    test('screen() prints as indented lines of role, name, value and state, and acts only on its own nodes', () => {

        const screen = journey.screen();
        const treecipePicker = screen.get('combobox', 'Treecipe');

        expect(screen.lines(treecipePicker)).toEqual([
            'combobox "Treecipe" = "Account-thru-OtherChildObject__c"',
            '  option "Account-thru-OtherChildObject__c" [selected]',
            '  option "Lead-ONLY"'
        ]);
        expect(screen.lines()).toContain('  tab "Treecipe" [selected]');
        expect(() => journey.screen().elementOf(treecipePicker)).toThrow('The combobox "Treecipe" is not from this screen.');
        expect(() => screen.get('tab', /^Tr/)).toThrow('3 tabs named "/^Tr/" are on screen, so which one is meant is unclear.');
        expect(() => screen.get('row', 'Account')).toThrow('No row named "Account" is on screen. The rows on screen: none.');

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

    test('a file written or removed in a step is recorded under that step; a call between steps, as between steps', async () => {

        const recipePath = 'treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/Lead-ONLY/recipe--Lead-ONLY-2026-09-20T10-00-00.yml';

        await journey.step('remove the Lead recipe', () => fs.rmSync(path.join(journey.workspaceRoot, recipePath)));
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
        await journey.workspaceState.update('treecipe.someKey', { kept: true });
        await journey.workspaceState.update('treecipe.someKey', undefined);

        expect(journey.fileChanges).toEqual([{ change: 'removed', relativePath: recipePath, step: 'remove the Lead recipe' }]);
        expect(journey.hostCalls).toEqual([{ call: 'commands.executeCommand', args: ['workbench.action.reloadWindow'], step: '(between steps)' }]);
        expect(journey.workspaceState.get('treecipe.someKey')).toBeUndefined();

    });

    test('a disabled control is not clicked, and the step says so', async () => {

        await journey.chooseTree('Lead-ONLY');
        await journey.openTab('Query');

        await expect(journey.click('button', 'Export JSON')).rejects.toThrow('Step "click the button "Export JSON"" failed: the button "Export JSON" is disabled.');
        expect(journey.fileChanges).toEqual([]);

    });

    test('a host that throws on a panel message fails the step, saying what it threw', async () => {

        const routePanelMessage = RecipeCockpitService.routePanelMessage.bind(RecipeCockpitService);
        jest.spyOn(RecipeCockpitService, 'routePanelMessage').mockImplementation((panelMessage, panelState) => {
            if ( panelMessage?.command === 'selectRun' ) { throw new Error('routing broke'); }
            return routePanelMessage(panelMessage, panelState);
        });

        await expect(journey.chooseRun(OLDER_RUN_LABEL)).rejects.toThrow(`Step "choose the run "${OLDER_RUN_LABEL}"" failed: the host threw while handling a panel message: routing broke`);

    });

    test('a host that never answers and asks the reader nothing fails the step, rather than hanging the suite', async () => {

        jest.spyOn(RecipeCockpitService, 'routePanelMessage').mockImplementation(() => ({ kind: 'selectRun', runFolderName: 'never' }));
        jest.spyOn(RecipeCockpitService as any, 'runPanelAction').mockImplementation(() => new Promise(() => undefined));

        await expect(journey.chooseRun(OLDER_RUN_LABEL)).rejects.toThrow('failed: the cockpit did not go idle: 1 host handler(s) were still running.');

    });

    test('a journey reads no screen before it opens, and its steps record no file outside a workspace', async () => {

        const unopenedJourney = new RecipeCockpitJourney();

        expect(() => unopenedJourney.screen()).toThrow('The cockpit has no panel open.');
        await expect(unopenedJourney.step('look around', () => 'nothing')).resolves.toBe('nothing');
        expect(unopenedJourney.fileChanges).toEqual([]);
        await expect(unopenedJourney.open('noSuchFixture')).rejects.toThrow(/^No fixture workspace "noSuchFixture" in /);

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
        const dismissedInput = vscode.window.showInputBox({ prompt: 'Duration' });
        await journey.answerInputBox(undefined);
        await expect(dismissedInput).resolves.toBeUndefined();

        await expect(enteredAlias).resolves.toBe('qa-scratch');
        await expect(chosenItem).resolves.toEqual({ label: 'Second' });
        expect(journey.prompts).toEqual([
            { kind: 'inputBox', title: 'New scratch org', prompt: 'Alias', placeholder: undefined, value: 'seven', offeredLabels: [], isWaiting: false },
            { kind: 'quickPick', title: undefined, placeholder: 'Pick one', offeredLabels: ['First', 'Second'], isWaiting: false },
            { kind: 'inputBox', title: undefined, prompt: 'Duration', placeholder: undefined, value: undefined, offeredLabels: [], isWaiting: false }
        ]);
        expect(journey.steps.slice(-2)).toEqual(['answer the input box with "qa-scratch"', 'dismiss the input box']);

    });

});
