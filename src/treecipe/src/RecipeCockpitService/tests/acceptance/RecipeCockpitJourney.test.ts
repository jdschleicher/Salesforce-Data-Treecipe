import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RecipeCockpitService, RECIPE_COCKPIT_RUN_PICKER_LABEL } from '../../RecipeCockpitService';
import { PicklistDependencyCheckService } from '../../../PicklistDependencyCheckService/PicklistDependencyCheckService';
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

        // EVERY ACTION WAITS FOR ITS TARGET UP TO THE STALL LIMIT BEFORE IT FAILS (#580); A SHORT ONE KEEPS SIX FAILURES WITHIN THE TEST'S TIME
        journey.settleStallLimitMs = 100;
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

    test('the cockpit reads the journey\'s own home folder, in every step of every test, and none of the machine\'s default-org variables', async () => {

        // A CLI DEFAULT IN THE JOURNEY'S HOME IS THE ONE THE ORG LIST MARKS; THE MACHINE'S OWN HOME IS NEVER READ
        fs.mkdirSync(path.join(journey.homePath, '.sf'));
        fs.writeFileSync(path.join(journey.homePath, '.sf', 'config.json'), JSON.stringify({ 'target-org': 'qa' }));

        await journey.step('read the home folder', () => {
            expect(os.homedir()).toBe(journey.homePath);
            expect(process.env.SF_TARGET_ORG).toBeUndefined();
        });
        await journey.chooseTree('Lead-ONLY');

        expect(journey.optionLabelsOf(JOURNEY_ORG_PICKER_NAME).filter(label => label.startsWith('qa'))).toEqual([expect.stringMatching(/^qa .*default/i)]);

    });

    test('a disabled control is not clicked, and the step says so', async () => {

        journey.settleStallLimitMs = 100;
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
        journey.settleStallLimitMs = 100;

        await expect(journey.chooseRun(OLDER_RUN_LABEL)).rejects.toThrow('failed: the cockpit did not go idle: 1 host handler(s) were still running after 100 ms with nothing delivered and nothing asked of the reader.');

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

        await journey.waitForConfirmation();
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


    test('a node\'s description is the shown text aria-describedby points at, as a screen reader reads it after the name, and is absent where there is none (#579)', async () => {

        await journey.openTab('Troubleshooting');
        await journey.click('tab', 'Fields');
        const screen = journey.screen();
        const deployCard = screen.get('button', 'Deploy fields & dependencies…');

        expect(deployCard.description).toStartWith('Insert failed with INVALID_FIELD?');
        expect(deployCard.description).not.toContain('Deploy fields & dependencies…');
        expect(screen.get('tab', 'Fields')).not.toHaveProperty('description');
        // lines() PRINTS ROLE, NAME, VALUE AND STATE ONLY, SO EVERY JOURNEY'S EXPECTED LINES ARE UNCHANGED BY IT
        expect(screen.lines(screen.get('tabpanel', 'Fields')).some(screenLine => screenLine.includes('INVALID_FIELD'))).toBeFalse();

    });

    test('waitFor returns once what the reader expects is on screen, and fails within the stall limit naming what is missing or still disabled (#580)', async () => {

        journey.settleStallLimitMs = 100;
        await journey.waitFor('combobox', 'Treecipe');
        await journey.chooseTree('Lead-ONLY');
        await journey.openTab('Query');

        await expect(journey.waitFor('button', 'No such button')).rejects.toThrow('Step "wait for the button "No such button"" failed: No button named "No such button" is on screen.');
        await expect(journey.waitFor('button', 'Export JSON', undefined, { isEnabled: true })).rejects.toThrow('the button "Export JSON" stayed disabled for 100 ms.');
        await journey.waitFor('button', 'Export JSON');

    });

    test('reopen closes the cockpit and opens it again through the command activate() registered, keeping what the window saved (#579)', async () => {

        await journey.chooseTree('Lead-ONLY');
        const readyCountBefore = journey.messages.filter(entry => entry.command === 'ready').length;

        expect(journey.registeredCommands.has('treecipe.openRecipeCockpit')).toBeTrue();
        await journey.reopen();

        expect(journey.messages.filter(entry => entry.command === 'ready').length).toBe(readyCountBefore + 1);
        expect(journey.shownTreeName()).toBe('Lead-ONLY');
        expect(journey.steps).toContain('close the cockpit and open it again');

    });

    test('every sf call in a step goes to journey.cli: recorded as its argv and folder, answered as scripted, and an unscripted one reads as a CLI that could not start, naming the argv (#579)', async () => {

        journey.cli.answer = argv => argv[0] === '--version' ? { stdout: '@salesforce/cli/2.0.0', exitCode: 0 } : undefined;

        const [versionAnswer, unscriptedAnswer] = await journey.step('run the CLI twice', () => Promise.all([
            PicklistDependencyCheckService.runSalesforceCli(['--version']),
            PicklistDependencyCheckService.runSalesforceCli(['org', 'list', '--json'], undefined, undefined, { workingDirectoryPath: journey.workspaceRoot })
        ]));

        expect(versionAnswer).toEqual({ stdout: '@salesforce/cli/2.0.0', stderr: '', exitCode: 0 });
        expect(unscriptedAnswer.exitCode).toBeNull();
        expect(unscriptedAnswer.spawnError).toMatchObject({ code: 'ENOENT', message: 'The journey\'s fake sf CLI has no answer for: sf org list --json. Script it on journey.cli.answer.' });
        expect(journey.cli.calls).toEqual([{ argv: ['--version'] }, { argv: ['org', 'list', '--json'], workingDirectoryPath: journey.workspaceRoot }]);

    });

    test('answerQuickPickMany answers a multi-select with exactly the labels given, and refuses one it does not offer (#579)', async () => {

        const items = [{ label: 'Account_Tree_Access' }, { label: 'SDT_Tree', picked: true }, { label: 'Other' }];
        const firstPick = vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: 'Choose sets' });
        await journey.step('the multi-select is shown', () => undefined);

        expect(journey.prompts).toEqual([{ kind: 'quickPick', placeholder: 'Choose sets', offeredLabels: ['Account_Tree_Access', 'SDT_Tree', 'Other'], isWaiting: true, canPickMany: true, pickedLabels: ['SDT_Tree'] }]);
        await expect(journey.answerQuickPickMany(['Missing'])).rejects.toThrow('the multi-select offers no "Missing". It offers: "Account_Tree_Access", "SDT_Tree", "Other".');

        await journey.answerQuickPickMany(['Account_Tree_Access', 'Other']);
        expect(await firstPick).toEqual([items[0], items[2]]);

        const singlePick = vscode.window.showQuickPick(['one', 'two']);
        await journey.step('a single-choice quick pick is shown', () => undefined);
        await expect(journey.answerQuickPickMany(['one'])).rejects.toThrow('No multi-select quick pick is open.');
        await journey.answerQuickPick('two');
        expect(await singlePick).toBe('two');

    });

});

describe('RecipeCockpitJourney.open with overlays (#579)', () => {

    test('copies each overlay over the fixture in order, into the journey\'s own copy', async () => {

        const journey = await new RecipeCockpitJourney().open('treeWorkspace', { overlays: ['metadataDeployWorkspace', 'troubleshootingConfigOverlay'] });
        try {
            expect(fs.existsSync(path.join(journey.workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00'))).toBeTrue();
            expect(fs.existsSync(path.join(journey.workspaceRoot, 'sfdx-project.json'))).toBeTrue();
            expect(JSON.parse(fs.readFileSync(path.join(journey.workspaceRoot, 'treecipe', 'treecipe.config.json'), 'utf8')).salesforceObjectsPath).toBe('./force-app/main/default/objects');
            expect(fs.existsSync(path.join(__dirname, '..', 'mocks', 'treeWorkspace', 'sfdx-project.json'))).toBeFalse();
        } finally {
            await journey.close();
        }

    });

    test('names an overlay that is not a fixture, and creates nothing', async () => {

        await expect(new RecipeCockpitJourney().open('treeWorkspace', { overlays: ['noSuchOverlay'] })).rejects.toThrow('No fixture workspace "noSuchOverlay" in ');

    });

});
