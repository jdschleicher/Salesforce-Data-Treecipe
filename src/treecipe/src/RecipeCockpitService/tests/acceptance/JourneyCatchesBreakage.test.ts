import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitService, RECIPE_COCKPIT_RUN_PICKER_LABEL, RECIPE_COCKPIT_TREECIPE_PICKER_LABEL } from '../../RecipeCockpitService';
import { JOURNEY_FIXTURES_ROOT, RecipeCockpitJourney } from './RecipeCockpitJourney';
import { FIRST_JOURNEY_FIXTURE, runFirstJourney } from './FirstJourney';

/*
    A journey is worth only the breakage it catches (#577): each test breaks the cockpit the way a
    refactor could, and the first journey must fail, naming the step and what the reader saw.
*/
describe('the first journey catches a broken cockpit (#577)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    const runJourneyExpectingFailure = async () => {
        journey = await new RecipeCockpitJourney().open(FIRST_JOURNEY_FIXTURE);
        return runFirstJourney(journey).then(() => { throw new Error('The first journey passed on a broken cockpit.'); }, (journeyError: Error) => journeyError.message);
    };

    test('passes on the cockpit as it is', async () => {

        journey = await new RecipeCockpitJourney().open(FIRST_JOURNEY_FIXTURE);
        await expect(runFirstJourney(journey)).resolves.toBeUndefined();

    });

    test('fails naming the Treecipes dropdown and the step when the dropdown no longer listens for a change', async () => {

        const buildShellHtml = RecipeCockpitService.buildWebviewShellHtml.bind(RecipeCockpitService);
        const changeListener = 'treePickerElement.addEventListener(\'change\', function () {';
        jest.spyOn(RecipeCockpitService, 'buildWebviewShellHtml').mockImplementation((nonce: string) => {
            const shellHtml = buildShellHtml(nonce);
            // THE BREAKAGE MUST REALLY BE MADE: A SHELL THAT NO LONGER HOLDS THIS LINE NEEDS THIS TEST UPDATED, NOT A PASS
            expect(shellHtml).toContain(changeListener);
            return shellHtml.replace(changeListener, 'void (\'change\', function () {');
        });

        const failureMessage = await runJourneyExpectingFailure();

        expect(failureMessage).toStartWith('Step "choosing "Lead-ONLY" shows its objects in insert order › choose the treecipe "Lead-ONLY"" failed:');
        expect(failureMessage).toContain(`the "${RECIPE_COCKPIT_TREECIPE_PICKER_LABEL}" dropdown was set to "Lead-ONLY", but the card shown is still "Account-thru-OtherChildObject__c"`);

    });

    test('fails naming the step when routePanelMessage refuses selectRun', async () => {

        const routePanelMessage = RecipeCockpitService.routePanelMessage.bind(RecipeCockpitService);
        jest.spyOn(RecipeCockpitService, 'routePanelMessage').mockImplementation((panelMessage, panelState) =>
            panelMessage?.command === 'selectRun' ? undefined : routePanelMessage(panelMessage, panelState));

        const failureMessage = await runJourneyExpectingFailure();

        expect(failureMessage).toStartWith('Step "choosing an older run shows its trees › choose the run "2026-09-01 00:00:00 UTC · snowfakery"" failed:');
        expect(failureMessage).toContain(`the "${RECIPE_COCKPIT_RUN_PICKER_LABEL}" dropdown was set to "2026-09-01 00:00:00 UTC · snowfakery", but the cockpit drew no run for it`);

    });

    test('each journey works on its own copy of the fixture, so a write in one never reaches another', async () => {

        const writtenFileName = 'written-by-the-first-journey.txt';

        const firstJourney = await new RecipeCockpitJourney().open(FIRST_JOURNEY_FIXTURE);
        const firstWorkspaceRoot = firstJourney.workspaceRoot;
        fs.writeFileSync(path.join(firstWorkspaceRoot, writtenFileName), 'only here');
        await firstJourney.close();

        journey = await new RecipeCockpitJourney().open(FIRST_JOURNEY_FIXTURE);

        expect(journey.workspaceRoot).not.toBe(firstWorkspaceRoot);
        expect(fs.existsSync(path.join(journey.workspaceRoot, writtenFileName))).toBeFalse();
        expect(fs.existsSync(path.join(JOURNEY_FIXTURES_ROOT, FIRST_JOURNEY_FIXTURE, writtenFileName))).toBeFalse();
        // CLOSING REMOVES THE COPY
        expect(fs.existsSync(firstWorkspaceRoot)).toBeFalse();

    });

});
